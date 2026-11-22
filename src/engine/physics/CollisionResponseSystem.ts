import * as THREE from 'three';
import {
  evaluateOrientedSlopeAt,
  OrientedSlopeEvaluation,
  OrientedSlopeHorizontalBlock,
  OrientedSlopeRegion,
  resolveOrientedSlopeHorizontalBlock,
} from '@/src/physics/OrientedSlope';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from '@/src/physics/SpatialHash';
import { CircleBoxContact2D, CollisionSystem } from './CollisionSystem';
import { PhysicsDebugSystem } from './PhysicsDebugSystem';
import { CharacterMoveResult, VehicleMoveResult } from './PhysicsTypes';

/**
 * Handles iterative collide-and-slide character capsule resolution, horizontal-verified step climbing,
 * generalized multi-orientation slope traversal, headroom-aware underside/side-rail blocking,
 * terrain gradient enforcement, and bridge-aware vehicle OBB deflection.
 */
export class CollisionResponseSystem {
  private readonly queryScratch: SpatialAABB[] = [];
  private readonly nearbySlopesScratch: OrientedSlopeRegion[] = [];
  private readonly contact2D: CircleBoxContact2D = {
    overlaps: false,
    penetration: 0,
    normalX: 0,
    normalZ: 0,
    contactX: 0,
    contactZ: 0,
  };
  private readonly slopeEvalScratch: OrientedSlopeEvaluation = {
    withinFootprint: false,
    topY: 0,
    bottomY: 0,
    u: 0,
    v: 0,
    t: 0,
    slopeDeg: 0,
    supportsFeet: false,
    hitsUndersideCeiling: false,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
  };
  private readonly slopeBlockScratch: OrientedSlopeHorizontalBlock = {
    blocked: false,
    pushX: 0,
    pushZ: 0,
    normalX: 0,
    normalZ: 0,
    penetration: 0,
    reason: 'exterior_side',
  };

  constructor(
    private readonly collisionSystem: CollisionSystem,
    private readonly debugSystem: PhysicsDebugSystem
  ) {}

  private readonly _terrainNormalScratch = { nx: 0, ny: 1, nz: 0, slopeDeg: 0 };
  private readonly vehicleMoveResultScratch: VehicleMoveResult = {
    collidedBuilding: false,
    collidedBarrier: false,
    collidedVehicleId: null,
    clampedWorldBounds: false,
    impactSpeed: 0,
    hullDamageApplied: 0,
    normalX: 0,
    normalY: 0,
    normalZ: 0,
    blockerId: null,
    blockerCollider: null,
  };
  private readonly vehicleMoveReturnScratch: {
    newYaw: number;
    newSpeed: number;
    result: VehicleMoveResult;
  } = {
    newYaw: 0,
    newSpeed: 0,
    result: this.vehicleMoveResultScratch,
  };

  /**
   * Computes terrain heightfield upward unit normal via central finite differences.
   */
  private sampleTerrainNormal(
    getTerrainHeightAt: (x: number, z: number) => number,
    x: number,
    z: number
  ): { nx: number; ny: number; nz: number; slopeDeg: number } {
    const eps = 0.35;
    const hL = getTerrainHeightAt(x - eps, z);
    const hR = getTerrainHeightAt(x + eps, z);
    const hD = getTerrainHeightAt(x, z - eps);
    const hU = getTerrainHeightAt(x, z + eps);
    const dHx = (hR - hL) / (2 * eps);
    const dHz = (hU - hD) / (2 * eps);
    const nx = -dHx;
    const ny = 1;
    const nz = -dHz;
    const invLen = 1 / Math.hypot(nx, ny, nz);
    const uny = ny * invLen;
    const slopeDeg = (Math.acos(Math.max(-1, Math.min(1, uny))) * 180) / Math.PI;
    this._terrainNormalScratch.nx = nx * invLen;
    this._terrainNormalScratch.ny = uny;
    this._terrainNormalScratch.nz = nz * invLen;
    this._terrainNormalScratch.slopeDeg = slopeDeg;
    return this._terrainNormalScratch;
  }

  /**
   * Resolves a character capsule (Player or Enemy) against static and dynamic world geometry.
   * Uses iterative collide-and-slide (up to 4 passes) with slope-first seam handoff,
   * headroom-aware underside/exterior side-rail blocking, verified step climbing,
   * overhead ceiling checks, terrain slope enforcement, and world boundary clamping.
   */
  resolveCharacterCapsule(
    entityId: string,
    spatialHash: SpatialHash,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number,
    stepHeight: number,
    worldBoundLimit: number,
    layerMask: number,
    getTerrainHeightAt: (x: number, z: number) => number,
    outResult?: CharacterMoveResult,
    slopes: readonly OrientedSlopeRegion[] = [],
    maxSlopeDeg = 45
  ): boolean {
    const res: CharacterMoveResult = outResult ?? {
      grounded: false,
      hitCeiling: false,
      hitWall: false,
      steppedUp: false,
      clampedWorldBounds: false,
      lastBlockerId: null,
      wallNormalX: 0,
      wallNormalY: 0,
      wallNormalZ: 0,
      groundNormalX: 0,
      groundNormalY: 1,
      groundNormalZ: 0,
      activeSlopeId: null,
      penetrationCorrected: 0,
    };

    res.grounded = false;
    res.hitCeiling = false;
    res.hitWall = false;
    res.steppedUp = false;
    res.clampedWorldBounds = false;
    res.lastBlockerId = null;
    res.wallNormalX = 0;
    res.wallNormalY = 0;
    res.wallNormalZ = 0;
    res.groundNormalX = 0;
    res.groundNormalY = 1;
    res.groundNormalZ = 0;
    res.activeSlopeId = null;
    res.penetrationCorrected = 0;

    // 1. Enforce authoritative world boundaries first
    if (pos.x < -worldBoundLimit) {
      pos.x = -worldBoundLimit;
      if (vel.x < 0) vel.x = 0;
      res.clampedWorldBounds = true;
    } else if (pos.x > worldBoundLimit) {
      pos.x = worldBoundLimit;
      if (vel.x > 0) vel.x = 0;
      res.clampedWorldBounds = true;
    }
    if (pos.z < -worldBoundLimit) {
      pos.z = -worldBoundLimit;
      if (vel.z < 0) vel.z = 0;
      res.clampedWorldBounds = true;
    } else if (pos.z > worldBoundLimit) {
      pos.z = worldBoundLimit;
      if (vel.z > 0) vel.z = 0;
      res.clampedWorldBounds = true;
    }
    if (res.clampedWorldBounds) {
      this.debugSystem.recordWorldBoundaryClamp(entityId, pos.x, pos.y, pos.z);
    }

    const startX = pos.x;
    const startZ = pos.z;

    // 1.1 Broadphase pre-filter OrientedSlopeRegions ONCE into nearbySlopesScratch for all 7 passes below
    const nearbySlopes = this.nearbySlopesScratch;
    nearbySlopes.length = 0;
    const slopeBroadPad = radius + 2.5;
    for (let i = 0; i < slopes.length; i++) {
      const s = slopes[i];
      const reachSpan = s.halfLength + s.halfWidth + slopeBroadPad;
      if (
        Math.abs(s.centerX - pos.x) <= reachSpan &&
        Math.abs(s.centerZ - pos.z) <= reachSpan
      ) {
        nearbySlopes.push(s);
      }
    }

    // 1.25 Slope-first pre-evaluation so ascending/descending agents cleanly hand off onto
    // stair landings and rooftop decks instead of snagging on landing AABB lips.
    let preSlopeTopY = -Infinity;
    let preSlopeActive: OrientedSlopeRegion | null = null;
    for (let i = 0; i < nearbySlopes.length; i++) {
      const s = nearbySlopes[i];
      if (s.maxSlopeDeg > maxSlopeDeg) continue;
      if (evaluateOrientedSlopeAt(s, pos.x, pos.y, pos.z, radius, height, stepHeight, this.slopeEvalScratch)) {
        if (this.slopeEvalScratch.supportsFeet && this.slopeEvalScratch.topY > preSlopeTopY) {
          preSlopeTopY = this.slopeEvalScratch.topY;
          preSlopeActive = s;
        }
      }
    }

    const localTerrainYPre = getTerrainHeightAt(pos.x, pos.z);

    // 1.5 Pre-pass: Generalized OrientedSlopeRegion underside ceiling clamp when jumping under a walkable span
    // Runs BEFORE horizontal ejection so jumping straight up under a tall-enough ramp hits the ceiling cleanly
    // (hitCeiling = true, vel.y = 0) instead of being pushed sideways out from beneath the ramp.
    for (let i = 0; i < nearbySlopes.length; i++) {
      const s = nearbySlopes[i];
      if (!evaluateOrientedSlopeAt(s, pos.x, pos.y, pos.z, radius, height, stepHeight, this.slopeEvalScratch)) {
        continue;
      }
      if (this.slopeEvalScratch.hitsUndersideCeiling) {
        const ceilingY = this.slopeEvalScratch.bottomY;
        const clampedY = ceilingY - height - 0.005;
        if (clampedY >= localTerrainYPre - 0.02) {
          const pen = pos.y + height - ceilingY;
          pos.y = clampedY;
          if (vel.y > 0) vel.y = 0;
          res.hitCeiling = true;
          res.lastBlockerId = s.id;
          this.debugSystem.recordContact({
            entityId,
            colliderId: s.id,
            colliderTag: 'stair_ramp',
            pointX: pos.x,
            pointY: ceilingY,
            pointZ: pos.z,
            normalX: -this.slopeEvalScratch.normalX,
            normalY: -this.slopeEvalScratch.normalY,
            normalZ: -this.slopeEvalScratch.normalZ,
            penetrationDepth: Math.max(0.01, pen),
            impactSpeed: Math.abs(vel.y),
          });
        }
      }
    }

    // 2. Iterative horizontal & vertical capsule resolution (4 iterations prevent corner seam pushing)
    const maxIterations = 4;
    for (let iter = 0; iter < maxIterations; iter++) {
      let anyCorrectionThisPass = false;

      // 2a. Headroom-aware OrientedSlopeRegion underside & exterior side-rail horizontal blocking
      for (let i = 0; i < nearbySlopes.length; i++) {
        const s = nearbySlopes[i];
        if (
          resolveOrientedSlopeHorizontalBlock(
            s,
            pos.x,
            pos.y,
            pos.z,
            radius,
            height,
            stepHeight,
            this.slopeBlockScratch
          )
        ) {
          pos.x += this.slopeBlockScratch.pushX;
          pos.z += this.slopeBlockScratch.pushZ;

          const nx = this.slopeBlockScratch.normalX;
          const nz = this.slopeBlockScratch.normalZ;
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) {
            vel.x -= vn * nx;
            vel.z -= vn * nz;
          }

          res.hitWall = true;
          res.lastBlockerId = `${s.id}_${this.slopeBlockScratch.reason}`;
          res.wallNormalX = nx;
          res.wallNormalY = 0;
          res.wallNormalZ = nz;
          res.penetrationCorrected += this.slopeBlockScratch.penetration;
          anyCorrectionThisPass = true;

          if (iter === 0) {
            this.debugSystem.recordContact({
              entityId,
              colliderId: res.lastBlockerId,
              colliderTag: 'stair_ramp',
              pointX: pos.x - nx * radius,
              pointY: pos.y + height * 0.5,
              pointZ: pos.z - nz * radius,
              normalX: nx,
              normalY: 0,
              normalZ: nz,
              penetrationDepth: this.slopeBlockScratch.penetration,
              impactSpeed: Math.abs(vn),
            });
          }
        }
      }

      // 2b. Static & dynamic SpatialAABB colliders
      const candidates = spatialHash.queryAABB(
        pos.x - radius - 0.8,
        pos.z - radius - 0.8,
        pos.x + radius + 0.8,
        pos.z + radius + 0.8,
        layerMask,
        this.queryScratch
      );

      for (let i = 0; i < candidates.length; i++) {
        const box = candidates[i];
        const feetY = pos.y;
        const headY = pos.y + height;

        // First test horizontal 2D circle-vs-box/OBB intersection!
        const overlapsHoriz = this.collisionSystem.testCircleBox2D(
          pos.x,
          pos.z,
          radius,
          box,
          this.contact2D
        );
        if (!overlapsHoriz) continue;

        // Upward jump / head hitting underside of overhang, bridge, or door lintel
        if (
          vel.y > 0 &&
          headY > box.minY &&
          feetY < box.minY &&
          headY - box.minY <= Math.max(0.65, vel.y * 0.05 + 0.35)
        ) {
          const clampedY = box.minY - height - 0.005;
          const terrainFloorY = getTerrainHeightAt(pos.x, pos.z);
          if (clampedY >= terrainFloorY - 0.02) {
            pos.y = clampedY;
            vel.y = 0;
            res.hitCeiling = true;
            res.lastBlockerId = box.id;
            res.wallNormalX = 0;
            res.wallNormalY = -1;
            res.wallNormalZ = 0;
            this.debugSystem.recordContact({
              entityId,
              colliderId: box.id,
              colliderTag: box.tag ?? 'world',
              pointX: pos.x,
              pointY: box.minY,
              pointZ: pos.z,
              normalX: 0,
              normalY: -1,
              normalZ: 0,
              penetrationDepth: headY - box.minY,
              impactSpeed: Math.abs(vel.y),
            });
            continue;
          }
        }

        // Ignore boxes completely above head or completely below feet
        if (headY <= box.minY + 0.005 || feetY >= box.maxY - 0.005) {
          continue;
        }

        // Slope-to-landing seam handoff: if agent is actively ascending an OrientedSlopeRegion
        // whose top surface meets this landing/roof slab, step seamlessly onto the slab instead of wall-rejecting.
        const effectiveFeetY = preSlopeActive ? Math.max(feetY, preSlopeTopY) : feetY;
        const topPenetration = box.maxY - effectiveFeetY;
        const rawTopPenetration = box.maxY - feetY;

        // Landing on top of a platform / roof / crate when descending onto its top surface
        const footSupportRadius = Math.max(0.14, radius * 0.48);
        const minFootPen = Math.max(0.04, radius - footSupportRadius);
        if (vel.y <= 0.05 && rawTopPenetration >= 0 && rawTopPenetration <= 0.18 && this.contact2D.penetration > minFootPen) {
          const clearance = this.collisionSystem.hasVerticalCapsuleClearance(
            spatialHash,
            pos.x,
            box.maxY,
            pos.z,
            radius * 0.9,
            height,
            layerMask
          );
          if (clearance.clear) {
            pos.y = box.maxY;
            if (vel.y < 0) vel.y = 0;
            res.grounded = true;
            continue;
          }
        }

        // Step-up check: ONLY when actively moving horizontally into the step (or transitioning off an active slope)
        // AND obstacle top is within stepHeight AND vertical clearance exists.
        // Prevents stationary/retreating agents cantilevered off a cliff edge from snapping back up onto the ledge!
        const allowedStep = preSlopeActive ? Math.max(stepHeight, 0.52) : stepHeight;
        const movingIntoStep =
          vel.x * this.contact2D.normalX + vel.z * this.contact2D.normalZ < -0.05;
        if (
          allowedStep > 0 &&
          vel.y <= 0.25 &&
          (preSlopeActive !== null || movingIntoStep) &&
          topPenetration > (preSlopeActive !== null ? -0.05 : 0.01) &&
          topPenetration <= allowedStep
        ) {
          const clearance = this.collisionSystem.hasVerticalCapsuleClearance(
            spatialHash,
            pos.x,
            box.maxY,
            pos.z,
            radius * 0.9,
            height,
            layerMask
          );
          if (clearance.clear) {
            pos.y = box.maxY;
            if (vel.y < 0) vel.y = 0;
            res.grounded = true;
            res.steppedUp = true;
            continue;
          }
        }

        // Solid wall / barrier horizontal collision response: push out + slide along tangent plane
        const pen = this.contact2D.penetration;
        if (pen > 1e-5) {
          const nx = this.contact2D.normalX;
          const nz = this.contact2D.normalZ;
          pos.x += nx * (pen + 0.0015);
          pos.z += nz * (pen + 0.0015);

          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) {
            vel.x -= vn * nx;
            vel.z -= vn * nz;
          }

          res.hitWall = true;
          res.lastBlockerId = box.id;
          res.wallNormalX = nx;
          res.wallNormalY = 0;
          res.wallNormalZ = nz;
          res.penetrationCorrected += pen;
          anyCorrectionThisPass = true;

          if (iter === 0) {
            this.debugSystem.recordContact({
              entityId,
              colliderId: box.id,
              colliderTag: box.tag ?? 'world',
              pointX: this.contact2D.contactX,
              pointY: pos.y + height * 0.5,
              pointZ: this.contact2D.contactZ,
              normalX: nx,
              normalY: 0,
              normalZ: nz,
              penetrationDepth: pen,
              impactSpeed: Math.abs(vn),
            });
          }
        }
      }

      if (!anyCorrectionThisPass) break;
    }

    if (res.hitWall && res.lastBlockerId) {
      this.debugSystem.recordBlockedMovement({
        entityId,
        originX: startX,
        originY: pos.y,
        originZ: startZ,
        desiredDx: vel.x * (1 / 60),
        desiredDz: vel.z * (1 / 60),
        resolvedDx: pos.x - startX,
        resolvedDz: pos.z - startZ,
        blockerId: res.lastBlockerId,
        normalX: res.wallNormalX,
        normalY: 0,
        normalZ: res.wallNormalZ,
      });
    }

    // 2.5 Generalized OrientedSlopeRegion underside ceiling clamping (only when tall enough to stand/jump underneath;
    // never clamps pos.y below local terrain!)
    const localTerrainY = getTerrainHeightAt(pos.x, pos.z);
    for (let i = 0; i < nearbySlopes.length; i++) {
      const s = nearbySlopes[i];
      if (!evaluateOrientedSlopeAt(s, pos.x, pos.y, pos.z, radius, height, stepHeight, this.slopeEvalScratch)) {
        continue;
      }
      if (this.slopeEvalScratch.hitsUndersideCeiling) {
        const ceilingY = this.slopeEvalScratch.bottomY;
        const clampedY = ceilingY - height - 0.005;
        if (clampedY >= localTerrainY - 0.02) {
          const pen = pos.y + height - ceilingY;
          pos.y = clampedY;
          if (vel.y > 0) vel.y = 0;
          res.hitCeiling = true;
          res.lastBlockerId = s.id;
          this.debugSystem.recordContact({
            entityId,
            colliderId: s.id,
            colliderTag: 'stair_ramp',
            pointX: pos.x,
            pointY: ceilingY,
            pointZ: pos.z,
            normalX: -this.slopeEvalScratch.normalX,
            normalY: -this.slopeEvalScratch.normalY,
            normalZ: -this.slopeEvalScratch.normalZ,
            penetrationDepth: Math.max(0.01, pen),
            impactSpeed: Math.abs(vel.y),
          });
        }
      }
    }

    // 3. Support standing on terrain, generalized oriented slopes, and headroom-verified elevated surfaces
    let supportSurfaceY = localTerrainY;
    let slopeSupported = false;
    let activeSlope: OrientedSlopeRegion | null = null;
    let groundNx = 0;
    let groundNy = 1;
    let groundNz = 0;

    const terrainNormal = this.sampleTerrainNormal(getTerrainHeightAt, pos.x, pos.z);
    groundNx = terrainNormal.nx;
    groundNy = terrainNormal.ny;
    groundNz = terrainNormal.nz;

    for (let i = 0; i < nearbySlopes.length; i++) {
      const s = nearbySlopes[i];
      if (s.maxSlopeDeg > maxSlopeDeg) continue;
      if (!evaluateOrientedSlopeAt(s, pos.x, pos.y, pos.z, radius, height, stepHeight, this.slopeEvalScratch)) {
        continue;
      }
      if (this.slopeEvalScratch.supportsFeet && this.slopeEvalScratch.topY > supportSurfaceY) {
        const clearance = this.collisionSystem.hasVerticalCapsuleClearance(
          spatialHash,
          pos.x,
          this.slopeEvalScratch.topY,
          pos.z,
          radius * 0.85,
          height,
          layerMask
        );
        if (clearance.clear) {
          supportSurfaceY = this.slopeEvalScratch.topY;
          slopeSupported = true;
          activeSlope = s;
          groundNx = this.slopeEvalScratch.normalX;
          groundNy = this.slopeEvalScratch.normalY;
          groundNz = this.slopeEvalScratch.normalZ;
        }
      }
    }

    // 3.25 Slanted lateral side-rail containment on railed stairs/ramps so walking characters
    // cannot clip or tunnel horizontally through side rails and hover off the side of a staircase
    if (!activeSlope && nearbySlopes.length > 0) {
      for (let i = 0; i < nearbySlopes.length; i++) {
        const s = nearbySlopes[i];
        if (!s.hasSideRails || s.maxSlopeDeg > maxSlopeDeg) continue;
        if (evaluateOrientedSlopeAt(s, startX, pos.y, startZ, radius, height, stepHeight, this.slopeEvalScratch)) {
          if (this.slopeEvalScratch.supportsFeet && Math.abs(this.slopeEvalScratch.u) < s.halfLength - 0.16) {
            activeSlope = s;
            if (this.slopeEvalScratch.topY > supportSurfaceY) {
              supportSurfaceY = this.slopeEvalScratch.topY;
              slopeSupported = true;
              groundNx = this.slopeEvalScratch.normalX;
              groundNy = this.slopeEvalScratch.normalY;
              groundNz = this.slopeEvalScratch.normalZ;
            }
            break;
          }
        }
      }
    }
    if (activeSlope && activeSlope.hasSideRails && pos.y < supportSurfaceY + 0.85) {
      const relX = pos.x - activeSlope.centerX;
      const relZ = pos.z - activeSlope.centerZ;
      const u = relX * activeSlope.dirX + relZ * activeSlope.dirZ;
      const v = -relX * activeSlope.dirZ + relZ * activeSlope.dirX;
      // Leave entry and exit ends open for seamless landing transitions
      if (Math.abs(u) < activeSlope.halfLength - 0.16) {
        const maxSafeV = Math.max(0.12, activeSlope.halfWidth - radius * 0.78 - 0.06);
        if (Math.abs(v) > maxSafeV) {
          const latNx = -activeSlope.dirZ;
          const latNz = activeSlope.dirX;
          const clampedV = Math.sign(v) * maxSafeV;
          const corr = clampedV - v;
          pos.x += latNx * corr;
          pos.z += latNz * corr;
          // Cancel outward velocity normal to rail
          const pushSign = Math.sign(corr);
          const rnx = latNx * pushSign;
          const rnz = latNz * pushSign;
          const vn = vel.x * rnx + vel.z * rnz;
          if (vn < 0) {
            vel.x -= vn * rnx;
            vel.z -= vn * rnz;
          }
          res.hitWall = true;
          res.lastBlockerId = `${activeSlope.id}_rail`;
          res.wallNormalX = rnx;
          res.wallNormalY = 0;
          res.wallNormalZ = rnz;
        }
      }
    }

    // 3.5 Elevated horizontal slab support: require foot-base overlap (radius * 0.48) rather than
    // outer shoulder scrape so capsules cantilevered off platform edges fall cleanly under gravity
    let slabSupported = false;
    const footSupportRadius = Math.max(0.14, radius * 0.48);
    const boxStepTol = Math.max(0.28, Math.min(0.48, stepHeight));
    const supportCandidates = spatialHash.queryAABB(
      pos.x - footSupportRadius,
      pos.z - footSupportRadius,
      pos.x + footSupportRadius,
      pos.z + footSupportRadius,
      layerMask,
      this.queryScratch
    );
    for (let i = 0; i < supportCandidates.length; i++) {
      const box = supportCandidates[i];
      if (pos.y + boxStepTol >= box.maxY && box.maxY > supportSurfaceY) {
        if (this.collisionSystem.testCircleBox2D(pos.x, pos.z, footSupportRadius, box, this.contact2D)) {
          const clearance = this.collisionSystem.hasVerticalCapsuleClearance(
            spatialHash,
            pos.x,
            box.maxY,
            pos.z,
            radius * 0.85,
            height,
            layerMask
          );
          if (clearance.clear) {
            supportSurfaceY = box.maxY;
            slopeSupported = false;
            slabSupported = true;
            activeSlope = null;
            groundNx = 0;
            groundNy = 1;
            groundNz = 0;
          }
        }
      }
    }

    // 3.75 Enforce maxSlopeDeg on steep natural terrain cliffs (when standing on bare terrain)
    if (!slopeSupported && !slabSupported && terrainNormal.slopeDeg > maxSlopeDeg && pos.y <= supportSurfaceY + 0.15) {
      const moveDx = pos.x - startX;
      const moveDz = pos.z - startZ;
      const horizNormalLen = Math.hypot(terrainNormal.nx, terrainNormal.nz);
      if (horizNormalLen > 1e-4) {
        const downX = terrainNormal.nx / horizNormalLen;
        const downZ = terrainNormal.nz / horizNormalLen;
        const moveDotDown = moveDx * downX + moveDz * downZ;
        if (moveDotDown < 0) {
          // Reject uphill movement component on too-steep terrain
          pos.x -= moveDotDown * downX;
          pos.z -= moveDotDown * downZ;
          const velDotDown = vel.x * downX + vel.z * downZ;
          if (velDotDown < 0) {
            vel.x -= velDotDown * downX;
            vel.z -= velDotDown * downZ;
          }
          supportSurfaceY = getTerrainHeightAt(pos.x, pos.z);
          res.hitWall = true;
          res.lastBlockerId = 'terrain_steep_slope';
          res.wallNormalX = downX;
          res.wallNormalY = terrainNormal.ny;
          res.wallNormalZ = downZ;
        }
      }
    }

    // 4. Speed-scaled downward stick tolerance so sprinting down 28° stairs stays smoothly grounded
    let snapStickTolerance = 0.08;
    if (slopeSupported && activeSlope && vel.y <= 0 && vel.y > -7.5) {
      const hSpeed = Math.hypot(vel.x, vel.z);
      const tanSlope = Math.tan((Math.min(55, activeSlope.maxSlopeDeg) * Math.PI) / 180);
      snapStickTolerance = Math.max(0.32, Math.min(0.68, hSpeed * (1 / 60) * tanSlope + 0.28));
    }

    if (pos.y <= supportSurfaceY + snapStickTolerance && vel.y <= 0) {
      pos.y = supportSurfaceY;
      vel.y = 0;
      res.grounded = true;
      res.groundNormalX = groundNx;
      res.groundNormalY = groundNy;
      res.groundNormalZ = groundNz;
      res.activeSlopeId = activeSlope ? activeSlope.id : null;
    }

    return res.grounded;
  }

  /**
   * Resolves ground vehicle movement against buildings, barriers, low stair undersides,
   * world boundaries, and other vehicles, with bridge-aware ground support so vehicles
   * traverse bridges cleanly and never snap onto overhead staircases.
   */
  resolveVehicleMovement(
    vehicleId: string,
    spatialHash: SpatialHash,
    pos: THREE.Vector3,
    yaw: number,
    speed: number,
    halfWidth: number,
    halfLength: number,
    massKg: number,
    dt: number,
    worldBoundLimit: number,
    selfCollider: SpatialAABB,
    getVehicleSupportHeightAt: (x: number, refY: number, z: number) => number,
    slopes: readonly OrientedSlopeRegion[] = []
  ): { newYaw: number; newSpeed: number; result: VehicleMoveResult } {
    const result = this.vehicleMoveResultScratch;
    result.collidedBuilding = false;
    result.collidedBarrier = false;
    result.collidedVehicleId = null;
    result.clampedWorldBounds = false;
    result.impactSpeed = 0;
    result.hullDamageApplied = 0;
    result.normalX = 0;
    result.normalY = 0;
    result.normalZ = 0;
    result.blockerId = null;
    result.blockerCollider = null;

    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    let vx = fwdX * speed;
    let vz = fwdZ * speed;

    // Advance candidate position
    pos.x += vx * dt;
    pos.z += vz * dt;

    // 1. World boundary enforcement
    if (pos.x < -worldBoundLimit) {
      pos.x = -worldBoundLimit;
      vx = Math.max(0, vx);
      result.clampedWorldBounds = true;
    } else if (pos.x > worldBoundLimit) {
      pos.x = worldBoundLimit;
      vx = Math.min(0, vx);
      result.clampedWorldBounds = true;
    }
    if (pos.z < -worldBoundLimit) {
      pos.z = -worldBoundLimit;
      vz = Math.max(0, vz);
      result.clampedWorldBounds = true;
    } else if (pos.z > worldBoundLimit) {
      pos.z = worldBoundLimit;
      vz = Math.min(0, vz);
      result.clampedWorldBounds = true;
    }
    if (result.clampedWorldBounds) {
      speed *= 0.45;
      this.debugSystem.recordWorldBoundaryClamp(vehicleId, pos.x, pos.y, pos.z);
    }

    // 2. Multi-disc OBB approximation (front axle disc, center hull disc, rear axle disc)
    const discRadius = halfWidth * 0.96;
    const axleOffset = Math.max(0.4, halfLength - discRadius * 0.85);

    const queryMask =
      COLLISION_LAYER.WORLD |
      COLLISION_LAYER.COVER |
      COLLISION_LAYER.DESTRUCTIBLE |
      COLLISION_LAYER.WINDOW_SILL |
      COLLISION_LAYER.VEHICLE;

    let newYaw = yaw;
    let newSpeed = speed;
    const vehicleHeight = 2.35;

    const vehSlopes = this.nearbySlopesScratch;
    vehSlopes.length = 0;
    const vehSlopePad = halfLength + discRadius + 2.5;
    for (let sIdx = 0; sIdx < slopes.length; sIdx++) {
      const s = slopes[sIdx];
      const reach = s.halfLength + s.halfWidth + vehSlopePad;
      if (Math.abs(s.centerX - pos.x) <= reach && Math.abs(s.centerZ - pos.z) <= reach) {
        vehSlopes.push(s);
      }
    }

    for (let iter = 0; iter < 3; iter++) {
      const boundR = halfLength + 1.5;
      const candidates = spatialHash.queryAABB(
        pos.x - boundR,
        pos.z - boundR,
        pos.x + boundR,
        pos.z + boundR,
        queryMask,
        this.queryScratch
      );

      let hadCollision = false;

      for (let dIdx = 0; dIdx < 3; dIdx++) {
        const dOff = dIdx === 0 ? axleOffset : dIdx === 1 ? 0 : -axleOffset;
        const curFwdX = -Math.sin(newYaw);
        const curFwdZ = -Math.cos(newYaw);
        const discX = pos.x + curFwdX * dOff;
        const discZ = pos.z + curFwdZ * dOff;

        // 2a. Block vehicles from driving through low stair/ramp flanks or low undersides
        for (let sIdx = 0; sIdx < vehSlopes.length; sIdx++) {
          const s = vehSlopes[sIdx];
          if (
            resolveOrientedSlopeHorizontalBlock(
              s,
              discX,
              pos.y,
              discZ,
              discRadius,
              vehicleHeight,
              0.35,
              this.slopeBlockScratch
            )
          ) {
            const nx = this.slopeBlockScratch.normalX;
            const nz = this.slopeBlockScratch.normalZ;
            const pen = this.slopeBlockScratch.penetration;
            pos.x += nx * (pen + 0.004);
            pos.z += nz * (pen + 0.004);
            const vn = vx * nx + vz * nz;
            if (vn < 0) {
              vx -= 1.06 * vn * nx;
              vz -= 1.06 * vn * nz;
              vx *= 0.65;
              vz *= 0.65;
              newSpeed = vx * curFwdX + vz * curFwdZ;
            }
            result.collidedBuilding = true;
            if (Math.abs(vn) > result.impactSpeed) {
              result.impactSpeed = Math.abs(vn);
              result.normalX = nx;
              result.normalY = 0;
              result.normalZ = nz;
              result.blockerId = `${s.id}_${this.slopeBlockScratch.reason}`;
            }
            hadCollision = true;
          }
        }

        // 2b. Static & dynamic AABBs
        for (let i = 0; i < candidates.length; i++) {
          const box = candidates[i];
          if (box.id === selfCollider.id) continue;
          // Ignore overhead decks/lintels above vehicle roof and walkable bridge/road slabs beneath tires
          if (box.minY >= pos.y + vehicleHeight || box.maxY <= pos.y + 0.45) continue;

          if (!this.collisionSystem.testCircleBox2D(discX, discZ, discRadius, box, this.contact2D)) {
            continue;
          }

          const pen = this.contact2D.penetration;
          if (pen <= 1e-5) continue;

          const nx = this.contact2D.normalX;
          const nz = this.contact2D.normalZ;

          pos.x += nx * (pen + 0.004);
          pos.z += nz * (pen + 0.004);

          const vn = vx * nx + vz * nz;
          const impactMag = Math.abs(vn);

          if (impactMag > result.impactSpeed) {
            result.impactSpeed = impactMag;
            result.normalX = nx;
            result.normalY = 0;
            result.normalZ = nz;
            result.blockerId = box.id;
            result.blockerCollider = box;
          }

          if ((box.layer & COLLISION_LAYER.WORLD) !== 0 || (box.layer & COLLISION_LAYER.WINDOW_SILL) !== 0) {
            result.collidedBuilding = true;
          } else if ((box.layer & (COLLISION_LAYER.COVER | COLLISION_LAYER.DESTRUCTIBLE)) !== 0) {
            result.collidedBarrier = true;
          } else if ((box.layer & COLLISION_LAYER.VEHICLE) !== 0) {
            result.collidedVehicleId = box.entityId ?? box.id;
          }

          if (vn < 0) {
            const restitution = 0.06;
            vx -= (1 + restitution) * vn * nx;
            vz -= (1 + restitution) * vn * nz;
            const headOnRatio = Math.min(1, impactMag / Math.max(1, Math.abs(newSpeed)));
            const scrapeRetention = Math.max(0.18, 1 - headOnRatio * 0.72);
            vx *= scrapeRetention;
            vz *= scrapeRetention;

            if (dOff !== 0 && headOnRatio < 0.82 && Math.abs(newSpeed) > 2.5) {
              const cross = curFwdX * nz - curFwdZ * nx;
              newYaw += Math.sign(cross) * Math.min(0.08, impactMag * 0.008);
            }
          }

          const nextFwdX = -Math.sin(newYaw);
          const nextFwdZ = -Math.cos(newYaw);
          newSpeed = vx * nextFwdX + vz * nextFwdZ;

          if (impactMag > 7.5 && iter === 0) {
            const massFactor = massKg / 1800;
            const dmg = (impactMag - 7.0) * 3.8 * massFactor;
            result.hullDamageApplied = Math.max(result.hullDamageApplied, dmg);
          }

          if (iter === 0) {
            this.debugSystem.recordVehicleImpact(
              vehicleId,
              box.id,
              box.tag ?? 'world',
              this.contact2D.contactX,
              pos.y + 1.0,
              this.contact2D.contactZ,
              nx,
              0,
              nz,
              pen,
              impactMag
            );
          }

          hadCollision = true;
        }
      }

      if (!hadCollision) break;
    }

    // Bridge-aware, overhead-stair-safe vehicle ground support
    pos.y = getVehicleSupportHeightAt(pos.x, pos.y, pos.z);
    this.vehicleMoveReturnScratch.newYaw = newYaw;
    this.vehicleMoveReturnScratch.newSpeed = newSpeed;
    this.vehicleMoveReturnScratch.result = result;
    return this.vehicleMoveReturnScratch;
  }
}
