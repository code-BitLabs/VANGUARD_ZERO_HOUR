import * as THREE from 'three';
import { PhysicsWorld, TerrainSlopeRegion } from '@/src/engine/physics/PhysicsWorld';
import { PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import { CharacterMoveResult, VehicleMoveResult } from '@/src/engine/physics/PhysicsTypes';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from './SpatialHash';

export interface RayHit {
  hit: boolean;
  distance: number;
  pointX: number;
  pointY: number;
  pointZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  collider: SpatialAABB | null;
}

export type SlopeRegion = TerrainSlopeRegion;

/**
 * Authoritative CollisionWorld facade backed by the unified PhysicsWorld.
 * Preserves full compatibility with all gameplay systems while routing every movement,
 * capsule, vehicle, ceiling, and swept-ray query through PhysicsWorld.
 */
export class CollisionWorld {
  public readonly physicsWorld = new PhysicsWorld();
  public readonly spatialHash: SpatialHash;

  constructor() {
    this.spatialHash = this.physicsWorld.spatialHash;
  }

  addStaticBox(box: SpatialAABB): void {
    this.physicsWorld.addStaticCollider(box);
  }

  addSlope(slope: SlopeRegion): void {
    this.physicsWorld.addSlope(slope);
  }

  setTerrainHeightFn(fn: (x: number, z: number) => number): void {
    this.physicsWorld.setTerrainHeightFn(fn);
  }

  getGroundHeightAt(x: number, z: number): number {
    return this.physicsWorld.getGroundHeightAt(x, z);
  }

  getMaxObstacleHeightInArea(x: number, z: number, radius: number): number {
    return this.physicsWorld.getMaxObstacleHeightInArea(x, z, radius);
  }

  /**
   * Resolves a vertical capsule (center X/Z, bottom Y, radius, height) against static and dynamic colliders.
   * Returns true if the capsule is grounded after resolution.
   */
  resolveCapsule(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number,
    stepHeight = 0.45,
    entityId = 'player',
    layerMask: number = PHYSICS_MASKS.CHARACTER_SOLID,
    outResult?: CharacterMoveResult
  ): boolean {
    return this.physicsWorld.resolveCharacterCapsule(
      entityId,
      pos,
      vel,
      radius,
      height,
      stepHeight,
      layerMask,
      outResult
    );
  }

  /**
   * Integrates character velocity for step `dt` and resolves capsule against all solid world, cover,
   * window-sill, vehicle, and destructible colliders. Returns full CharacterMoveResult.
   */
  resolvePlayerCapsule(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number,
    stepHeight = 0.45,
    dt = 1 / 60,
    entityId = 'player',
    layerMask: number = PHYSICS_MASKS.CHARACTER_SOLID,
    outResult?: CharacterMoveResult
  ): CharacterMoveResult {
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    const out: CharacterMoveResult = outResult ?? {
      grounded: false,
      hitCeiling: false,
      hitWall: false,
      hitHorizontal: false,
      steppedUp: false,
      clampedWorldBounds: false,
      lastBlockerId: null,
      wallNormalX: 0,
      wallNormalY: 0,
      wallNormalZ: 0,
      penetrationCorrected: 0,
      activeContacts: 0,
      maxPenetrationDepth: 0,
    };
    out.grounded = false;
    out.hitCeiling = false;
    out.hitWall = false;
    out.hitHorizontal = false;
    out.steppedUp = false;
    out.clampedWorldBounds = false;
    out.lastBlockerId = null;
    out.wallNormalX = 0;
    out.wallNormalY = 0;
    out.wallNormalZ = 0;
    out.penetrationCorrected = 0;
    out.activeContacts = 0;
    out.maxPenetrationDepth = 0;
    this.physicsWorld.resolveCharacterCapsule(
      entityId,
      pos,
      vel,
      radius,
      height,
      stepHeight,
      layerMask,
      out
    );
    out.hitHorizontal = out.hitWall;
    out.activeContacts = (out.hitWall ? 1 : 0) + (out.hitCeiling ? 1 : 0) + (out.grounded ? 1 : 0);
    out.maxPenetrationDepth = out.penetrationCorrected;
    return out;
  }

  /**
   * Checks whether a crouched/sliding character at `pos` has enough vertical overhead clearance
   * to stand up to `targetHeight` without clipping into a ceiling, overhang, bridge, or door lintel.
   */
  canStandUp(
    pos: THREE.Vector3,
    radius: number,
    targetHeight: number,
    entityId = 'player',
    layerMask: number = PHYSICS_MASKS.CHARACTER_SOLID
  ): boolean {
    return this.physicsWorld.canStandUp(entityId, pos, radius, targetHeight, layerMask);
  }

  /**
   * Resolves ground vehicle OBB movement with sliding impulse deflection, speed loss, and high-speed hull damage.
   */
  resolveVehicleMovement(
    pos: THREE.Vector3,
    yaw: number,
    speed: number,
    halfWidth: number,
    halfLength: number,
    dt: number,
    vehicleId: string,
    selfColliderOrId: SpatialAABB | string
  ): {
    newYaw: number;
    newSpeed: number;
    hitObstacle: boolean;
    impactSpeed: number;
    hullDamageApplied: number;
    lastBlockerId: string | null;
    blockerCollider: SpatialAABB | null;
    clampedBoundary: boolean;
    result: VehicleMoveResult;
  } {
    const selfCol: SpatialAABB =
      typeof selfColliderOrId === 'string'
        ? {
            id: selfColliderOrId,
            minX: pos.x - halfWidth,
            minY: pos.y,
            minZ: pos.z - halfLength,
            maxX: pos.x + halfWidth,
            maxY: pos.y + 2.35,
            maxZ: pos.z + halfLength,
            layer: COLLISION_LAYER.VEHICLE,
          }
        : selfColliderOrId;
    const res = this.physicsWorld.resolveVehicleMovement(
      vehicleId,
      pos,
      yaw,
      speed,
      halfWidth,
      halfLength,
      4500,
      dt,
      selfCol
    );
    const r = res.result;
    const hitObstacle =
      r.collidedBuilding || r.collidedBarrier || r.collidedVehicleId !== null;
    return {
      newYaw: res.newYaw,
      newSpeed: res.newSpeed,
      hitObstacle,
      impactSpeed: r.impactSpeed,
      hullDamageApplied: r.hullDamageApplied,
      lastBlockerId: r.blockerId,
      blockerCollider: r.blockerCollider,
      clampedBoundary: r.clampedWorldBounds,
      result: r,
    };
  }

  /**
   * Swept segment / raycast test against SpatialHash AABBs & OBBs + ground plane y=0.
   * Computes true 3D surface normals (±X, ±Y, ±Z and rotated OBB normals).
   */
  sweptSegmentTest(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    layerMask: number,
    outHit: RayHit,
    ignoreColliderId?: string | null
  ): boolean {
    return this.physicsWorld.raycast(
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      maxDist,
      layerMask,
      outHit,
      ignoreColliderId
    );
  }

  /**
   * Swept sphere continuous collision detection (CCD) for projectiles and camera spring-arms.
   */
  sweptSphereTest(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    radius: number,
    layerMask: number,
    outHit: RayHit,
    ignoreColliderId?: string | null
  ): boolean {
    return this.physicsWorld.sphereCast(
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

  clear(): void {
    this.physicsWorld.clear();
  }
}
