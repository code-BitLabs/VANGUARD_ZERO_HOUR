import { CollisionTag, SpatialAABB } from '@/src/physics/SpatialHash';

export type PhysicsBodyClassification = 'static' | 'dynamic' | 'kinematic' | 'character' | 'trigger';

export type PhysicsShapeKind = 'box' | 'obb' | 'capsule' | 'sphere' | 'compound';

export type PhysicalMotionState =
  | 'STATIC'
  | 'GROUNDED'
  | 'AIRBORNE'
  | 'CROUCHED'
  | 'SLIDING'
  | 'VAULTING'
  | 'CLIMBING'
  | 'CRUISING'
  | 'DEFLECTING'
  | 'HOVERING'
  | 'BALLISTIC';

export interface PhysicsContactPoint {
  id: number;
  timestampSec: number;
  entityId: string;
  colliderId: string;
  colliderTag: CollisionTag | 'world';
  pointX: number;
  pointY: number;
  pointZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  penetrationDepth: number;
  impactSpeed: number;
}

export interface BlockedMovementVector {
  entityId: string;
  originX: number;
  originY: number;
  originZ: number;
  desiredDx: number;
  desiredDz: number;
  resolvedDx: number;
  resolvedDz: number;
  blockerId: string;
  normalX: number;
  normalY: number;
  normalZ: number;
  timestampSec: number;
}

export interface PhysicsBodyInspectorRow {
  id: string;
  entityType: 'player' | 'enemy' | 'vehicle' | 'aircraft' | 'projectile' | 'building' | 'cover' | 'destructible';
  classification: PhysicsBodyClassification;
  shape: PhysicsShapeKind;
  dimensions: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
  speed: number;
  massKg: number;
  layer: number;
  layerLabel: string;
  mask: number;
  maskLabel: string;
  physicalState: PhysicalMotionState;
  lastCollisionId: string | null;
  lastNormalX: number;
  lastNormalY: number;
  lastNormalZ: number;
  contactCount: number;
}

export interface PhysicsWarningRecord {
  id: string;
  ruleId:
    | 'PLAYER_SOLID_OVERLAP'
    | 'ENEMY_SOLID_OVERLAP'
    | 'VEHICLE_BUILDING_OVERLAP'
    | 'PROJECTILE_TUNNELING_PREVENTED'
    | 'REPEATED_PENETRATION_CORRECTION'
    | 'CEILING_STANDUP_BLOCKED'
    | 'INVALID_COLLISION_MASK'
    | 'ORPHANED_PHYSICS_BODY'
    | 'EXCESSIVE_VELOCITY_CLAMP'
    | 'UNEXPECTED_TELEPORTATION'
    | 'OUT_OF_BOUNDS_CLAMP'
    | 'PHYSICS_STEP_SPIKE';
  classification: 'CONFIRMED' | 'HEURISTIC';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  timestampSec: number;
  entityId: string;
  subsystem: string;
  x: number;
  y: number;
  z: number;
  description: string;
  expectedBehavior: string;
  actualBehavior: string;
  suggestedInvestigation: string;
}

export interface ColliderWireframeBox {
  id: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  yaw: number;
  centerX?: number;
  centerZ?: number;
  halfExtX?: number;
  halfExtZ?: number;
  layer: number;
  tag: CollisionTag | 'world';
}

export interface SlopeDebugWireframe {
  id: string;
  centerX: number;
  centerZ: number;
  dirX: number;
  dirZ: number;
  halfLength: number;
  halfWidth: number;
  startY: number;
  endY: number;
  thickness: number;
  hasSideRails: boolean;
}

export interface LadderDebugWireframe {
  id: string;
  x: number;
  z: number;
  bottomY: number;
  topY: number;
  width: number;
  normalX: number;
  normalZ: number;
  topExitX: number;
  topExitY: number;
  topExitZ: number;
}

export interface TraversalIntegrityFlag {
  id: string;
  severity: 'ERROR' | 'WARN';
  code: 'FLOATING_ENTRY' | 'BLOCKED_PARAPET_EXIT' | 'FLOATING_LIFT_BASE' | 'MISSING_PILLAR_COLLIDER';
  x: number;
  y: number;
  z: number;
  message: string;
}

export interface PhysicsWorldDiagnosticsSnapshot {
  solverBackend: 'Custom FPS Controller + SpatialHash/BVH';
  rapierInitialized: boolean;
  fixedTimestepSec: number;
  worldBoundsMin: number;
  worldBoundsMax: number;
  totalBodies: number;
  staticBodiesCount: number;
  dynamicBodiesCount: number;
  kinematicBodiesCount: number;
  characterBodiesCount: number;
  activeCollisionPairs: number;
  collisionChecksPerFrame: number;
  raycastsPerFrame: number;
  shapeCastsPerFrame: number;
  blockedMovementsTotal: number;
  penetrationCorrectionsTotal: number;
  ceilingStandupBlocksTotal: number;
  tunnelingPreventedTotal: number;
  worldBoundaryClampsTotal: number;
  vehicleBuildingImpactsTotal: number;
  invalidLayerMaskCount: number;
  bodies: PhysicsBodyInspectorRow[];
  recentContacts: PhysicsContactPoint[];
  blockedVectors: BlockedMovementVector[];
  physicsWarnings: PhysicsWarningRecord[];
  staticColliderBoxes: ColliderWireframeBox[];
  slopeWireframes: SlopeDebugWireframe[];
  ladderWireframes: LadderDebugWireframe[];
  traversalIntegrityFlags: TraversalIntegrityFlag[];
}

export interface CharacterMoveResult {
  grounded: boolean;
  hitCeiling: boolean;
  hitWall: boolean;
  hitHorizontal?: boolean;
  steppedUp: boolean;
  clampedWorldBounds: boolean;
  lastBlockerId: string | null;
  wallNormalX: number;
  wallNormalY: number;
  wallNormalZ: number;
  groundNormalX?: number;
  groundNormalY?: number;
  groundNormalZ?: number;
  activeSlopeId?: string | null;
  penetrationCorrected: number;
  activeContacts?: number;
  maxPenetrationDepth?: number;
}

export interface VehicleMoveResult {
  collidedBuilding: boolean;
  collidedBarrier: boolean;
  collidedVehicleId: string | null;
  clampedWorldBounds: boolean;
  impactSpeed: number;
  hullDamageApplied: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  blockerId: string | null;
  blockerCollider: SpatialAABB | null;
}
