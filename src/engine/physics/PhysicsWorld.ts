import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from '@/src/physics/SpatialHash';
import { CollisionSystem, RaycastHitResult } from './CollisionSystem';
import { CollisionResponseSystem } from './CollisionResponseSystem';
import { PhysicsDebugSystem } from './PhysicsDebugSystem';
import { formatCollisionLayer, PHYSICS_MASKS } from './PhysicsLayers';
import {
  CharacterMoveResult,
  ColliderWireframeBox,
  PhysicsBodyInspectorRow,
  PhysicsWorldDiagnosticsSnapshot,
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

export interface TerrainSlopeRegion {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  startZ: number;
  endZ: number;
  startY: number;
  endY: number;
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

  private slopes: TerrainSlopeRegion[] = [];
  private terrainHeightFn: (x: number, z: number) => number = () => 0;
  private worldBoundLimit = PhysicsWorld.DEFAULT_WORLD_BOUND;

  private bvhGeometries = new Set<THREE.BufferGeometry>();

  constructor() {
    ensureThreeMeshBvhPatched();
    this.responseSystem = new CollisionResponseSystem(this.collisionSystem, this.debugSystem);
  }

  isRapierInitialized(): boolean {
    return false;
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
    const geo = mesh.geometry as THREE.BufferGeometry & { computeBoundsTree?: () => void };
    if (geo && typeof geo.computeBoundsTree === 'function' && !this.bvhGeometries.has(geo)) {
      geo.computeBoundsTree();
      this.bvhGeometries.add(geo);
    }
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

  addSlope(slope: TerrainSlopeRegion): void {
    this.slopes.push(slope);
  }

  getGroundHeightAt = (x: number, z: number): number => {
    let h = this.terrainHeightFn(x, z);
    for (let i = 0; i < this.slopes.length; i++) {
      const s = this.slopes[i];
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) {
        const t = Math.max(0, Math.min(1, (z - s.startZ) / (s.endZ - s.startZ)));
        const sh = s.startY + (s.endY - s.startY) * t;
        if (sh > h) h = sh;
      }
    }
    return h;
  };

  /**
   * Resolves a character capsule (Player or Enemy) with iterative collide-and-slide,
   * verified step-climbing, overhead ceiling checks, and world boundary clamping.
   */
  resolveCharacterCapsule(
    entityId: string,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number,
    stepHeight: number,
    layerMask: number = PHYSICS_MASKS.CHARACTER_SOLID,
    outResult?: CharacterMoveResult
  ): boolean {
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
      this.getGroundHeightAt,
      outResult
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
   * Resolves vehicle OBB movement with sliding impulse deflection, speed loss, and high-speed hull damage.
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
      this.getGroundHeightAt
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
      ignoreColliderId
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
      ignoreColliderId
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
        if (staticColliderBoxes.length < 220) {
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
      if (staticColliderBoxes.length < 220) {
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

    return {
      solverBackend: 'Custom FPS Controller + SpatialHash/BVH',
      rapierInitialized: this.isRapierInitialized(),
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
    };
  }

  clear(): void {
    this.spatialHash.clear();
    this.slopes = [];
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
