import * as THREE from 'three';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from '@/src/physics/SpatialHash';
import { CircleBoxContact2D, CollisionSystem } from './CollisionSystem';
import { PhysicsDebugSystem } from './PhysicsDebugSystem';
import { CharacterMoveResult, VehicleMoveResult } from './PhysicsTypes';

/**
 * Handles iterative collide-and-slide character capsule resolution, horizontal-verified step climbing,
 * ceiling collision clamping, and vehicle OBB sliding impulse deflection.
 */
export class CollisionResponseSystem {
  private readonly queryScratch: SpatialAABB[] = [];
  private readonly contact2D: CircleBoxContact2D = {
    overlaps: false,
    penetration: 0,
    normalX: 0,
    normalZ: 0,
    contactX: 0,
    contactZ: 0,
  };

  constructor(
    private readonly collisionSystem: CollisionSystem,
    private readonly debugSystem: PhysicsDebugSystem
  ) {}

  /**
   * Resolves a character capsule (Player or Enemy) against static and dynamic world geometry.
   * Uses iterative collide-and-slide (up to 4 passes) so acute corners never push the capsule through walls,
   * verifies horizontal overlap BEFORE stepping up, checks overhead clearance at the stepped height,
   * and blocks upward head penetration into overhangs/ceilings.
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
    outResult?: CharacterMoveResult
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

    // 2. Iterative horizontal & vertical capsule resolution (4 iterations prevent corner seam pushing)
    const maxIterations = 4;
    for (let iter = 0; iter < maxIterations; iter++) {
      const candidates = spatialHash.queryAABB(
        pos.x - radius - 0.8,
        pos.z - radius - 0.8,
        pos.x + radius + 0.8,
        pos.z + radius + 0.8,
        layerMask,
        this.queryScratch
      );

      let anyCorrectionThisPass = false;

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
          pos.y = box.minY - height - 0.005;
          vel.y = 0;
          res.hitCeiling = true;
          res.lastBlockerId = box.id;
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

        // Ignore boxes completely above head or completely below feet
        if (headY <= box.minY + 0.005 || feetY >= box.maxY - 0.005) {
          continue;
        }

        // Landing on top of a platform / roof / crate when descending onto its top surface
        const topPenetration = box.maxY - feetY;
        if (vel.y <= 0.05 && topPenetration >= 0 && topPenetration <= 0.18 && this.contact2D.penetration > 0.04) {
          pos.y = box.maxY;
          if (vel.y < 0) vel.y = 0;
          res.grounded = true;
          continue;
        }

        // Step-up check: ONLY when horizontally overlapping AND obstacle top is within stepHeight
        // AND there is vertical capsule clearance at the stepped-up height!
        if (
          stepHeight > 0 &&
          vel.y <= 0.15 &&
          topPenetration > 0.01 &&
          topPenetration <= stepHeight
        ) {
          const clearance = this.collisionSystem.hasVerticalCapsuleClearance(
            spatialHash,
            pos.x,
            box.maxY,
            pos.z,
            radius * 0.92,
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

    // 3. Support standing on elevated horizontal surfaces (roofs, watchtower decks, stairs, crates)
    let supportSurfaceY = getTerrainHeightAt(pos.x, pos.z);
    const supportCandidates = spatialHash.queryAABB(
      pos.x - radius * 0.85,
      pos.z - radius * 0.85,
      pos.x + radius * 0.85,
      pos.z + radius * 0.85,
      layerMask,
      this.queryScratch
    );
    for (let i = 0; i < supportCandidates.length; i++) {
      const box = supportCandidates[i];
      if (pos.y + 0.28 >= box.maxY && box.maxY > supportSurfaceY) {
        if (this.collisionSystem.testCircleBox2D(pos.x, pos.z, radius * 0.85, box, this.contact2D)) {
          supportSurfaceY = box.maxY;
        }
      }
    }

    if (pos.y <= supportSurfaceY + 0.04 && vel.y <= 0) {
      pos.y = supportSurfaceY;
      vel.y = 0;
      res.grounded = true;
    }

    return res.grounded;
  }

  /**
   * Resolves ground vehicle movement against buildings, barriers, world boundaries, and other vehicles.
   * Implements sliding impulse deflection, speed loss proportional to collision angle, and high-speed hull damage.
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
    getTerrainHeightAt: (x: number, z: number) => number
  ): { newYaw: number; newSpeed: number; result: VehicleMoveResult } {
    const result: VehicleMoveResult = {
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
    // This prevents both translation AND rotation of the vehicle nose/tail through buildings!
    const discRadius = halfWidth * 0.96;
    const axleOffset = Math.max(0.4, halfLength - discRadius * 0.85);
    const discOffsets = [-axleOffset, 0, axleOffset];

    const queryMask =
      COLLISION_LAYER.WORLD |
      COLLISION_LAYER.COVER |
      COLLISION_LAYER.DESTRUCTIBLE |
      COLLISION_LAYER.WINDOW_SILL |
      COLLISION_LAYER.VEHICLE;

    let newYaw = yaw;
    let newSpeed = speed;

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

      for (let dIdx = 0; dIdx < discOffsets.length; dIdx++) {
        const dOff = discOffsets[dIdx];
        const curFwdX = -Math.sin(newYaw);
        const curFwdZ = -Math.cos(newYaw);
        const discX = pos.x + curFwdX * dOff;
        const discZ = pos.z + curFwdZ * dOff;

        for (let i = 0; i < candidates.length; i++) {
          const box = candidates[i];
          if (box.id === selfCollider.id) continue;
          // Ignore overhead lintels above vehicle roof (vehicle height ~ 2.35m)
          if (box.minY >= pos.y + 2.35 || box.maxY <= pos.y + 0.38) continue;

          if (!this.collisionSystem.testCircleBox2D(discX, discZ, discRadius, box, this.contact2D)) {
            continue;
          }

          const pen = this.contact2D.penetration;
          if (pen <= 1e-5) continue;

          const nx = this.contact2D.normalX;
          const nz = this.contact2D.normalZ;

          // Push vehicle out of penetration immediately
          pos.x += nx * (pen + 0.004);
          pos.z += nz * (pen + 0.004);

          // Compute impact normal speed
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

          // Sliding impulse deflection: remove inward normal velocity + apply tangential scrape friction
          if (vn < 0) {
            const restitution = 0.06; // Very low bounce so vehicles don't pinball
            vx -= (1 + restitution) * vn * nx;
            vz -= (1 + restitution) * vn * nz;
            // Tangential friction loss proportional to normal impact ratio
            const headOnRatio = Math.min(1, impactMag / Math.max(1, Math.abs(newSpeed)));
            const scrapeRetention = Math.max(0.18, 1 - headOnRatio * 0.72);
            vx *= scrapeRetention;
            vz *= scrapeRetention;

            // Slight yaw deflection when front or rear axle clips a wall at a glancing angle
            if (dOff !== 0 && headOnRatio < 0.82 && Math.abs(newSpeed) > 2.5) {
              const cross = curFwdX * nz - curFwdZ * nx;
              newYaw += Math.sign(cross) * Math.min(0.08, impactMag * 0.008);
            }
          }

          // Re-project scalar longitudinal speed along updated heading
          const nextFwdX = -Math.sin(newYaw);
          const nextFwdZ = -Math.cos(newYaw);
          newSpeed = vx * nextFwdX + vz * nextFwdZ;

          // High-speed impact damage (> 7.5 m/s normal impact speed)
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

    pos.y = getTerrainHeightAt(pos.x, pos.z);
    return { newYaw, newSpeed, result };
  }
}
