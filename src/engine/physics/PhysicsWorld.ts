import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import {
  OrientedSlopeRegion,
  sampleSlopeTopAt,
} from '@/src/physics/OrientedSlope';
import {
  findMountableLadder,
  LadderMountCandidate,
  LadderVolume,
} from '@/src/physics/LadderVolume';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from '@/src/physics/SpatialHash';
import {
  CircleBoxContact2D,
  CollisionSystem,
  RaycastHitResult,
  VAULT_MAX_PROBE_DISTANCE,
  VAULT_PROBE_LAYER_MASK,
  VaultProbeResult,
} from './CollisionSystem';
import { CollisionResponseSystem } from './CollisionResponseSystem';
import { PhysicsDebugSystem } from './PhysicsDebugSystem';
import { formatCollisionLayer, PHYSICS_MASKS } from './PhysicsLayers';
import {
  CharacterMoveResult,
  ColliderWireframeBox,
  LadderDebugWireframe,
  PhysicsBodyInspectorRow,
  PhysicsWorldDiagnosticsSnapshot,
  SlopeDebugWireframe,
  TraversalIntegrityFlag,
  VehicleMoveResult,
} from './PhysicsTypes';

// Patch Three.js prototype once for three-mesh-bvh accelerated static mesh queries
let bvhPatched = false;
function ensureThreeMeshBvhPatched(): void {
  if (bvhPatched) return;
  bvhPatched = true;
  const geoProto = THREE.BufferGeometry.prototype as unknown as {
    computeBoundsTree?: typeof computeBoundsTree;
    disposeBoundsTree?: typeof disposeBoundsTree;
  };
  geoProto.computeBoundsTree = computeBoundsTree;
  geoProto.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

/**
 * Single authoritative PhysicsWorld owning CollisionSystem, SpatialHash broad-phase,
 * three-mesh-bvh static mesh acceleration, custom FPS CharacterController,
 * Vehicle OBB impulse deflection, and F4 physics telemetry.
 */
export class PhysicsWorld {
  public static readonly FIXED_TIMESTEP_SEC = 1 / 60;
  public static readonly DEFAULT_WORLD_BOUND = 106;

  public readonly spatialHash = new SpatialHash(8);
  public readonly collisionSystem = new CollisionSystem();
  public readonly debugSystem = new PhysicsDebugSystem();
  public readonly responseSystem: CollisionResponseSystem;

  private slopes: OrientedSlopeRegion[] = [];
  private readonly slopeCellSize = 8;
  private readonly slopeCells = new Map<number, number[]>();
  private slopeVisitStamp = new Int32Array(256);
  private slopeStampCounter = 0;
  private readonly _slopeQueryScratch: OrientedSlopeRegion[] = [];
  private readonly _raySlopeScratch: OrientedSlopeRegion[] = [];
  private ladders: LadderVolume[] = [];
  private traversalIntegrityFlags: TraversalIntegrityFlag[] = [];
  private terrainHeightFn: (x: number, z: number) => number = () => 0;
  private worldBoundLimit = PhysicsWorld.DEFAULT_WORLD_BOUND;

  private bvhGeometries = new Set<THREE.BufferGeometry>();
  private readonly _supportQueryScratch: SpatialAABB[] = [];
  private readonly _supportContact2D: CircleBoxContact2D = {
    overlaps: false,
    penetration: 0,
    normalX: 0,
    normalZ: 0,
    contactX: 0,
    contactZ: 0,
  };

  constructor() {
    ensureThreeMeshBvhPatched();
    this.responseSystem = new CollisionResponseSystem(this.collisionSystem, this.debugSystem);
  }

  setWorldBoundLimit(limit: number): void {
    this.worldBoundLimit = Math.max(40, limit);
  }

  getWorldBoundLimit(): number {
    return this.worldBoundLimit;
  }

  setTerrainHeightFn(fn: (x: number, z: number) => number): void {
    this.terrainHeightFn = fn;
  }

  beginFrame(dt: number): void {
    this.collisionSystem.resetFrameCounters();
    this.debugSystem.tick(dt);
  }

  registerBvhMesh(mesh: THREE.Mesh): void {
    if (!mesh || !mesh.isMesh) return;
    if (mesh.userData?.skipBvh || mesh.userData?.dynamicPlatform) return;
    const lowerName = (mesh.name || '').toLowerCase();
    if (
      !mesh.userData?.forceBvh &&
      (lowerName.includes('trim') ||
        lowerName.includes('baseboard') ||
        lowerName.includes('glass') ||
        lowerName.includes('mullion') ||
        lowerName.includes('beacon') ||
        lowerName.includes('foliage') ||
        lowerName.includes('decal') ||
        lowerName.includes('lift_platform') ||
        lowerName.includes('lift_gate'))
    ) {
      return;
    }

    const geo = mesh.geometry as THREE.BufferGeometry & {
      computeBoundsTree?: () => void;
      boundsTree?: unknown;
    };
    if (!geo || typeof geo.computeBoundsTree !== 'function') return;
    if (this.bvhGeometries.has(geo)) return;
    const posAttr = geo.getAttribute('position');
    if (!posAttr || posAttr.count < 12) return;

    mesh.updateWorldMatrix(true, false);
    if (!geo.boundsTree) {
      geo.computeBoundsTree();
    }
    this.bvhGeometries.add(geo);
  }

  getBvhGeometryCount(): number {
    return this.bvhGeometries.size;
  }

  addStaticCollider(box: SpatialAABB): void {
    if (box.layer === 0) {
      this.debugSystem.invalidLayerMaskCount++;
    }
    this.spatialHash.insert(box);
  }

  registerStaticCollider(box: SpatialAABB): void {
    this.addStaticCollider(box);
  }

  updateCollider(box: SpatialAABB): void {
    this.spatialHash.update(box);
  }

  removeCollider(box: SpatialAABB): void {
    this.spatialHash.remove(box);
  }

  getStaticColliderIds(): string[] {
    return this.spatialHash.getAllBoxes().map((b) => b.id);
  }

  private hashSlopeCell(cx: number, cz: number): number {
    return ((cx + 16384) * 73856093) ^ ((cz + 16384) * 19349663);
  }

  private indexSlope(slope: OrientedSlopeRegion, idx: number): void {
    const pad = slope.halfLength + slope.halfWidth + 0.5;
    const minCx = Math.floor((slope.centerX - pad) / this.slopeCellSize);
    const maxCx = Math.floor((slope.centerX + pad) / this.slopeCellSize);
    const minCz = Math.floor((slope.centerZ - pad) / this.slopeCellSize);
    const maxCz = Math.floor((slope.centerZ + pad) / this.slopeCellSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = this.hashSlopeCell(cx, cz);
        let list = this.slopeCells.get(key);
        if (!list) {
          list = [];
          this.slopeCells.set(key, list);
        }
        list.push(idx);
      }
    }
  }

  private querySlopesAABB(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    out: OrientedSlopeRegion[]
  ): OrientedSlopeRegion[] {
    out.length = 0;
    if (this.slopes.length === 0) return out;
    if (this.slopes.length > this.slopeVisitStamp.length) {
      let nextCap = this.slopeVisitStamp.length * 2;
      while (nextCap < this.slopes.length) nextCap *= 2;
      this.slopeVisitStamp = new Int32Array(nextCap);
    }
    let stamp = ++this.slopeStampCounter;
    if (stamp >= 1_000_000_000) {
      this.slopeVisitStamp.fill(0);
      this.slopeStampCounter = 1;
      stamp = 1;
    }

    const minCx = Math.floor(minX / this.slopeCellSize);
    const maxCx = Math.floor(maxX / this.slopeCellSize);
    const minCz = Math.floor(minZ / this.slopeCellSize);
    const maxCz = Math.floor(maxZ / this.slopeCellSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const list = this.slopeCells.get(this.hashSlopeCell(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const idx = list[i];
          if (this.slopeVisitStamp[idx] === stamp) continue;
          this.slopeVisitStamp[idx] = stamp;
          out.push(this.slopes[idx]);
        }
      }
    }
    return out;
  }

  addSlope(slope: OrientedSlopeRegion): void {
    const idx = this.slopes.length;
    this.slopes.push(slope);
    this.indexSlope(slope, idx);
  }

  getSlopes(): readonly OrientedSlopeRegion[] {
    return this.slopes;
  }

  addLadder(ladder: LadderVolume): void {
    this.ladders.push(ladder);
  }

  getLadders(): readonly LadderVolume[] {
    return this.ladders;
  }

  findMountableLadder(
    x: number,
    feetY: number,
    z: number,
    lookX: number,
    lookZ: number,
    maxDist = 1.25
  ): LadderMountCandidate | null {
    return findMountableLadder(this.ladders, x, feetY, z, lookX, lookZ, maxDist);
  }

  setTraversalIntegrityFlags(flags: TraversalIntegrityFlag[]): void {
    this.traversalIntegrityFlags = flags;
  }

  getTraversalIntegrityFlags(): readonly TraversalIntegrityFlag[] {
    return this.traversalIntegrityFlags;
  }

  getTerrainHeightOnly = (x: number, z: number): number => {
    return this.terrainHeightFn(x, z);
  };

  getGroundHeightAt = (x: number, z: number, referenceFeetY?: number): number => {
    let h = this.terrainHeightFn(x, z);
    const nearbySlopes = this.querySlopesAABB(x - 0.5, z - 0.5, x + 0.5, z + 0.5, this._slopeQueryScratch);
    for (let i = 0; i < nearbySlopes.length; i++) {
      const sh = sampleSlopeTopAt(nearbySlopes[i], x, z, referenceFeetY, 0.55);
      if (sh !== null && sh > h) {
        h = sh;
      }
    }
    return h;
  };

  /**
   * Resolves ground/bridge/gentle-ramp support elevation for ground vehicles at `(x, refY, z)`.
   * Includes walkable bridge decks and road slabs while rejecting overhead stairs above `refY + 0.65m`.
   */
  getVehicleSupportHeightAt = (x: number, refY: number, z: number): number => {
    let bestY = this.terrainHeightFn(x, z);

    // Check gentle vehicle-traversable ramps only (<= 28 deg) and strictly below overhead threshold
    const nearbySlopes = this.querySlopesAABB(x - 0.5, z - 0.5, x + 0.5, z + 0.5, this._slopeQueryScratch);
    for (let i = 0; i < nearbySlopes.length; i++) {
      const s = nearbySlopes[i];
      if (s.maxSlopeDeg > 28) continue;
      const sh = sampleSlopeTopAt(s, x, z, refY, 0.5);
      if (sh !== null && sh > bestY && sh <= refY + 0.65) {
        bestY = sh;
      }
    }

    // Check walkable static bridge/deck/floor slabs within wheel climb reach
    const queryR = 0.6;
    const candidates = this.spatialHash.queryAABB(
      x - queryR,
      z - queryR,
      x + queryR,
      z + queryR,
      COLLISION_LAYER.WORLD,
      this._supportQueryScratch
    );
    for (let i = 0; i < candidates.length; i++) {
      const box = candidates[i];
      if (box.maxY > bestY && box.maxY <= refY + 0.65) {
        // Require center overlap so vehicles do not float off bridge edges
        if (this.collisionSystem.testCircleBox2D(x, z, 0.35, box, this._supportContact2D)) {
          bestY = box.maxY;
        }
      }
    }

    return bestY;
  };

  /**
   * Resolves the highest valid walkable support surface (terrain, oriented slope, or static/lift box top)
   * reachable at `(x, feetY, z)` with valid vertical capsule headroom.
   */
  getSupportHeightAt(
    x: number,
    feetY: number,
    z: number,
    capsuleHeight = 1.75,
    stepHeight = 0.55,
    maxSlopeDeg = 45,
    layerMask: number = PHYSICS_MASKS.CHARACTER_SOLID
  ): number {
    let bestY = this.terrainHeightFn(x, z);

    const nearbySlopes = this.querySlopesAABB(x - 0.5, z - 0.5, x + 0.5, z + 0.5, this._slopeQueryScratch);
    for (let i = 0; i < nearbySlopes.length; i++) {
      const s = nearbySlopes[i];
      if (s.maxSlopeDeg > maxSlopeDeg) continue;
      const sh = sampleSlopeTopAt(s, x, z, feetY, stepHeight);
      if (sh !== null && sh > bestY) {
        if (
          this.collisionSystem.hasVerticalCapsuleClearanceFast(
            this.spatialHash,
            x,
            sh,
            z,
            0.34,
            capsuleHeight,
            layerMask
          )
        ) {
          bestY = sh;
        }
      }
    }

    const queryR = 0.42;
    const candidates = this.spatialHash.queryAABB(
      x - queryR,
      z - queryR,
      x + queryR,
      z + queryR,
      layerMask,
      this._supportQueryScratch
    );
    for (let i = 0; i < candidates.length; i++) {
      const box = candidates[i];
      if (box.maxY > bestY && box.maxY <= feetY + stepHeight + 0.35) {
        if (this.collisionSystem.testCircleBox2D(x, z, 0.18, box, this._supportContact2D)) {
          if (
            this.collisionSystem.hasVerticalCapsuleClearanceFast(
              this.spatialHash,
              x,
              box.maxY,
              z,
              0.34,
              capsuleHeight,
              layerMask
            )
          ) {
            bestY = box.maxY;
          }
        }
      }
    }

    return bestY;
  }

  private readonly getTerrainOnlyHeightAt = (x: number, z: number): number => {
    return this.terrainHeightFn(x, z);
  };

  /**
   * Resolves a character capsule (Player or Enemy) with iterative collide-and-slide,
   * verified step-climbing, overhead ceiling checks, generalized slopes, and world boundary clamping.
   */
  resolveCharacterCapsule(
    entityId: string,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number,
    stepHeight: number,
    layerMask: number = PHYSICS_MASKS.CHARACTER_SOLID,
    outResult?: CharacterMoveResult,
    maxSlopeDeg = 45
  ): boolean {
    const nearbySlopes = this.querySlopesAABB(
      pos.x - radius - 1.2,
      pos.z - radius - 1.2,
      pos.x + radius + 1.2,
      pos.z + radius + 1.2,
      this._slopeQueryScratch
    );
    return this.responseSystem.resolveCharacterCapsule(
      entityId,
      this.spatialHash,
      pos,
      vel,
      radius,
      height,
      stepHeight,
      this.worldBoundLimit,
      layerMask,
      this.getTerrainOnlyHeightAt,
      outResult,
      nearbySlopes,
      maxSlopeDeg
    );
  }

  /**
   * Checks whether a crouched/sliding character at `pos` has enough vertical overhead clearance
   * to stand up to `targetHeight` without clipping into a ceiling, overhang, bridge, or door lintel.
   */
  canStandUp(
    entityId: string,
    pos: THREE.Vector3,
    radius: number,
    targetHeight: number,
    layerMask: number = PHYSICS_MASKS.CHARACTER_SOLID
  ): boolean {
    const res = this.collisionSystem.hasVerticalCapsuleClearance(
      this.spatialHash,
      pos.x,
      pos.y,
      pos.z,
      radius,
      targetHeight,
      layerMask
    );
    if (!res.clear && res.blocker) {
      this.debugSystem.recordCeilingStandupBlocked(entityId, pos.x, pos.y + targetHeight, pos.z, res.blocker.id);
    }
    return res.clear;
  }

  /**
   * Probes whether a character at `pos` moving along `(dirX, dirZ)` can vault over or mantle onto
   * a low obstacle (`0.46m–1.15m`) using the unified SpatialHash and CollisionSystem.
   */
  probeVaultObstacle(
    pos: THREE.Vector3,
    dirX: number,
    dirZ: number,
    radius: number,
    standingHeight: number,
    out: VaultProbeResult,
    maxReach = VAULT_MAX_PROBE_DISTANCE,
    layerMask = VAULT_PROBE_LAYER_MASK
  ): boolean {
    const nearbySlopes = this.querySlopesAABB(
      pos.x - maxReach - 1.5,
      pos.z - maxReach - 1.5,
      pos.x + maxReach + 1.5,
      pos.z + maxReach + 1.5,
      this._slopeQueryScratch
    );
    return this.collisionSystem.probeVaultObstacle(
      this.spatialHash,
      pos.x,
      pos.y,
      pos.z,
      dirX,
      dirZ,
      radius,
      standingHeight,
      this.worldBoundLimit,
      this.getGroundHeightAt,
      out,
      maxReach,
      layerMask,
      nearbySlopes,
      this.getTerrainOnlyHeightAt
    );
  }

  /**
   * Resolves vehicle OBB movement with sliding impulse deflection, speed loss, high-speed hull damage,
   * bridge-deck support, and overhead-stair exclusion.
   */
  resolveVehicleMovement(
    vehicleId: string,
    pos: THREE.Vector3,
    yaw: number,
    speed: number,
    halfWidth: number,
    halfLength: number,
    massKg: number,
    dt: number,
    selfCollider: SpatialAABB
  ): { newYaw: number; newSpeed: number; result: VehicleMoveResult } {
    const pad = halfLength + halfWidth + 3.0;
    const nearbySlopes = this.querySlopesAABB(
      pos.x - pad,
      pos.z - pad,
      pos.x + pad,
      pos.z + pad,
      this._slopeQueryScratch
    );
    return this.responseSystem.resolveVehicleMovement(
      vehicleId,
      this.spatialHash,
      pos,
      yaw,
      speed,
      halfWidth,
      halfLength,
      massKg,
      dt,
      this.worldBoundLimit - 2,
      selfCollider,
      this.getVehicleSupportHeightAt,
      nearbySlopes
    );
  }

  private readonly _areaQueryScratch: SpatialAABB[] = [];

  /**
   * Queries maximum roof/structure height in an area `(x ± radius, z ± radius)` so aircraft
   * maintain safe clearance above buildings and terrain.
   */
  getMaxObstacleHeightInArea(x: number, z: number, radius: number): number {
    let maxH = this.getGroundHeightAt(x, z);
    this._areaQueryScratch.length = 0;
    const hits = this.spatialHash.queryAABB(
      x - radius,
      z - radius,
      x + radius,
      z + radius,
      COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER | COLLISION_LAYER.DESTRUCTIBLE,
      this._areaQueryScratch
    );
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].maxY > maxH) {
        maxH = hits[i].maxY;
      }
    }
    return maxH;
  }

  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    layerMask: number,
    outHit: RaycastHitResult,
    ignoreColliderId?: string | null
  ): boolean {
    const endX = ox + dx * maxDist;
    const endZ = oz + dz * maxDist;
    const nearbySlopes =
      (layerMask & COLLISION_LAYER.WORLD) !== 0 && this.slopes.length > 0
        ? this.querySlopesAABB(
            Math.min(ox, endX) - 0.5,
            Math.min(oz, endZ) - 0.5,
            Math.max(ox, endX) + 0.5,
            Math.max(oz, endZ) + 0.5,
            this._raySlopeScratch
          )
        : this._raySlopeScratch;
    if ((layerMask & COLLISION_LAYER.WORLD) === 0) nearbySlopes.length = 0;
    return this.collisionSystem.sweptCast(
      this.spatialHash,
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      maxDist,
      0,
      layerMask,
      outHit,
      ignoreColliderId,
      nearbySlopes,
      this.getTerrainOnlyHeightAt
    );
  }

  sphereCast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    radius: number,
    layerMask: number,
    outHit: RaycastHitResult,
    ignoreColliderId?: string | null
  ): boolean {
    const endX = ox + dx * maxDist;
    const endZ = oz + dz * maxDist;
    const nearbySlopes =
      (layerMask & COLLISION_LAYER.WORLD) !== 0 && this.slopes.length > 0
        ? this.querySlopesAABB(
            Math.min(ox, endX) - radius - 0.5,
            Math.min(oz, endZ) - radius - 0.5,
            Math.max(ox, endX) + radius + 0.5,
            Math.max(oz, endZ) + radius + 0.5,
            this._raySlopeScratch
          )
        : this._raySlopeScratch;
    if ((layerMask & COLLISION_LAYER.WORLD) === 0) nearbySlopes.length = 0;
    return this.collisionSystem.sweptCast(
      this.spatialHash,
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      maxDist,
      radius,
      layerMask,
      outHit,
      ignoreColliderId,
      nearbySlopes,
      this.getTerrainOnlyHeightAt
    );
  }

  /**
   * Builds the live F4 Physics Diagnostics snapshot including body counts, query metrics,
   * interactive body inspector rows, contact normals, and static collider wireframe boxes.
   */
  buildDiagnosticsSnapshot(
    dynamicBodies: PhysicsBodyInspectorRow[]
  ): PhysicsWorldDiagnosticsSnapshot {
    const allStatic = this.spatialHash.getAllBoxes();
    const staticColliderBoxes: ColliderWireframeBox[] = [];
    const staticInspectorRows: PhysicsBodyInspectorRow[] = [];

    let staticCount = 0;
    for (let i = 0; i < allStatic.length; i++) {
      const b = allStatic[i];
      if ((b.layer & (COLLISION_LAYER.ENEMY | COLLISION_LAYER.PLAYER)) !== 0) {
        continue;
      }
      if ((b.layer & COLLISION_LAYER.VEHICLE) !== 0) {
        if (staticColliderBoxes.length < 1200) {
          staticColliderBoxes.push({
            id: b.id,
            minX: Number(b.minX.toFixed(2)),
            minY: Number(b.minY.toFixed(2)),
            minZ: Number(b.minZ.toFixed(2)),
            maxX: Number(b.maxX.toFixed(2)),
            maxY: Number(b.maxY.toFixed(2)),
            maxZ: Number(b.maxZ.toFixed(2)),
            yaw: b.yaw ?? 0,
            centerX: b.centerX,
            centerZ: b.centerZ,
            halfExtX: b.halfExtX,
            halfExtZ: b.halfExtZ,
            layer: b.layer,
            tag: b.tag ?? 'vehicle',
          });
        }
        continue;
      }
      staticCount++;
      if (staticColliderBoxes.length < 1200) {
        staticColliderBoxes.push({
          id: b.id,
          minX: Number(b.minX.toFixed(2)),
          minY: Number(b.minY.toFixed(2)),
          minZ: Number(b.minZ.toFixed(2)),
          maxX: Number(b.maxX.toFixed(2)),
          maxY: Number(b.maxY.toFixed(2)),
          maxZ: Number(b.maxZ.toFixed(2)),
          yaw: b.yaw ?? 0,
          centerX: b.centerX,
          centerZ: b.centerZ,
          halfExtX: b.halfExtX,
          halfExtZ: b.halfExtZ,
          layer: b.layer,
          tag: b.tag ?? 'world',
        });
      }
      if (staticInspectorRows.length < 40) {
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        const d = b.maxZ - b.minZ;
        staticInspectorRows.push({
          id: b.id,
          entityType:
            (b.layer & COLLISION_LAYER.DESTRUCTIBLE) !== 0
              ? 'destructible'
              : (b.layer & COLLISION_LAYER.COVER) !== 0
                ? 'cover'
                : 'building',
          classification: 'static',
          shape: b.yaw ? 'obb' : 'box',
          dimensions: `${w.toFixed(1)}×${h.toFixed(1)}×${d.toFixed(1)}m`,
          x: Number(((b.minX + b.maxX) * 0.5).toFixed(1)),
          y: Number(((b.minY + b.maxY) * 0.5).toFixed(1)),
          z: Number(((b.minZ + b.maxZ) * 0.5).toFixed(1)),
          yaw: Number((b.yaw ?? 0).toFixed(2)),
          vx: 0,
          vy: 0,
          vz: 0,
          ax: 0,
          ay: 0,
          az: 0,
          speed: 0,
          massKg: 0,
          layer: b.layer,
          layerLabel: formatCollisionLayer(b.layer),
          mask: 0,
          maskLabel: 'STATIC_RECEIVER',
          physicalState: 'STATIC',
          lastCollisionId: null,
          lastNormalX: 0,
          lastNormalY: 1,
          lastNormalZ: 0,
          contactCount: 0,
        });
      }
    }

    let dynCount = 0;
    let kinCount = 0;
    let charCount = 0;
    let activePairs = 0;
    for (let i = 0; i < dynamicBodies.length; i++) {
      const db = dynamicBodies[i];
      if (db.classification === 'dynamic') dynCount++;
      else if (db.classification === 'kinematic') kinCount++;
      else if (db.classification === 'character') charCount++;
      if (db.contactCount > 0) activePairs += db.contactCount;
    }

    const slopeWireframes: SlopeDebugWireframe[] = this.slopes.map((s) => ({
      id: s.id,
      centerX: s.centerX,
      centerZ: s.centerZ,
      dirX: s.dirX,
      dirZ: s.dirZ,
      halfLength: s.halfLength,
      halfWidth: s.halfWidth,
      startY: s.startY,
      endY: s.endY,
      thickness: s.thickness,
      hasSideRails: Boolean(s.hasSideRails),
    }));

    const ladderWireframes: LadderDebugWireframe[] = this.ladders.map((l) => ({
      id: l.id,
      x: l.x,
      z: l.z,
      bottomY: l.bottomY,
      topY: l.topY,
      width: l.width,
      normalX: l.normalX,
      normalZ: l.normalZ,
      topExitX: l.topExitX,
      topExitY: l.topExitY,
      topExitZ: l.topExitZ,
    }));

    return {
      solverBackend: 'Custom FPS Controller + SpatialHash/BVH',
      fixedTimestepSec: Number(PhysicsWorld.FIXED_TIMESTEP_SEC.toFixed(4)),
      worldBoundsMin: -this.worldBoundLimit,
      worldBoundsMax: this.worldBoundLimit,
      totalBodies: staticCount + dynamicBodies.length,
      staticBodiesCount: staticCount,
      dynamicBodiesCount: dynCount,
      kinematicBodiesCount: kinCount,
      characterBodiesCount: charCount,
      activeCollisionPairs: activePairs,
      collisionChecksPerFrame: this.collisionSystem.narrowPhaseChecksThisFrame,
      raycastsPerFrame: this.collisionSystem.raycastsThisFrame,
      shapeCastsPerFrame: this.collisionSystem.shapeCastsThisFrame,
      blockedMovementsTotal: this.debugSystem.blockedMovementsTotal,
      penetrationCorrectionsTotal: this.debugSystem.penetrationCorrectionsTotal,
      ceilingStandupBlocksTotal: this.debugSystem.ceilingStandupBlocksTotal,
      tunnelingPreventedTotal: this.debugSystem.tunnelingPreventedTotal,
      worldBoundaryClampsTotal: this.debugSystem.worldBoundaryClampsTotal,
      vehicleBuildingImpactsTotal: this.debugSystem.vehicleBuildingImpactsTotal,
      invalidLayerMaskCount: this.debugSystem.invalidLayerMaskCount,
      bodies: [...dynamicBodies, ...staticInspectorRows],
      recentContacts: this.debugSystem.getRecentContacts(),
      blockedVectors: this.debugSystem.getBlockedVectors(),
      physicsWarnings: this.debugSystem.getWarnings(),
      staticColliderBoxes,
      slopeWireframes,
      ladderWireframes,
      traversalIntegrityFlags: this.traversalIntegrityFlags,
    };
  }

  clear(): void {
    this.spatialHash.clear();
    this.slopes = [];
    this.slopeCells.clear();
    this.slopeVisitStamp.fill(0);
    this.slopeStampCounter = 0;
    this.ladders = [];
    this.traversalIntegrityFlags = [];
    this.terrainHeightFn = () => 0;
    this.debugSystem.reset();
    this.collisionSystem.resetFrameCounters();

    for (const geo of this.bvhGeometries) {
      const g = geo as THREE.BufferGeometry & { disposeBoundsTree?: () => void };
      if (typeof g.disposeBoundsTree === 'function') {
        g.disposeBoundsTree();
      }
    }
    this.bvhGeometries.clear();
  }
}
