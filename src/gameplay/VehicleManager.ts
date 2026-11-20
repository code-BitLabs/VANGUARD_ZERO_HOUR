import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { formatCollisionLayer, PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import type { PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER, SpatialAABB } from '@/src/physics/SpatialHash';
import {
  AUTHORITATIVE_COMBAT_CONFIG,
  DIFFICULTY_COMBAT_PROFILES,
  ENEMY_WEAPON_PROFILES,
  EnemyAwarenessState,
} from '@/src/schemas/combat.schema';
import { Difficulty, MapId } from '@/src/schemas/common.schema';
import { MiniMapBlip, VehicleCameraMode, VehicleDriveGear } from '@/src/schemas/events.schema';
import { VehicleType } from '@/src/schemas/mission.schema';
import { buildVehicleRig } from '@/src/world/rigs/VehicleRigBuilder';
import { BallisticSolver } from './BallisticSolver';
import { CombatEngagementCoordinator } from './CombatEngagementCoordinator';
import { CombatTelemetryRecorder, EnemyDebugInspectorRow } from './CombatTelemetryRecorder';
import { PlayerController } from './PlayerController';
import { CameraSpringDebugRay, VehicleCameraRig } from './VehicleCameraRig';
import { getVehicleHandlingSpec, stepVehicleHandling } from './vehicle/VehicleHandlingProfile';
import { resetSuspensionState, stepVehicleSuspension } from './vehicle/VehicleKinematics';
import { HitscanTarget } from './WeaponSystem';
import type { SquadVehicleSeatView } from './squad/FriendlySquadManager';

export const VEHICLE_REVERSE_ENTER_SPEED = 0.45;
export const VEHICLE_REVERSE_EXIT_SPEED = 0.85;
export const VEHICLE_REVERSE_CONFIRM_SEC = 0.16;

export interface VehicleEntity {
  id: string;
  squadId: string;
  type: VehicleType;
  displayName: string;
  hostile: boolean;
  isConvoyTarget: boolean;
  alive: boolean;
  occupiedByPlayer: boolean;
  health: number;
  maxHealth: number;
  turretAmmo: number;
  maxTurretAmmo: number;
  lastDamagedAtSec: number;
  position: THREE.Vector3;
  centerPos: THREE.Vector3;
  yaw: number;
  speed: number;
  maxSpeed: number;
  steerAngle: number;
  driveGear: VehicleDriveGear;
  reverseConfirmTimer: number;
  handbrakeActive: boolean;
  chassisPitch: number;
  chassisPitchVel: number;
  chassisRoll: number;
  chassisRollVel: number;
  chassisHeave: number;
  chassisHeaveVel: number;
  prevSpeed: number;
  prevTerrainY: number;
  wheelRestY: number;
  wheelLocalPositions: ReadonlyArray<readonly [number, number, number]>;
  wheelCompression: [number, number, number, number];
  wheelVelocity: [number, number, number, number];
  halfWidth: number;
  halfLength: number;
  state: EnemyAwarenessState;
  hasLos: boolean;
  losBlockerId: string | null;
  losLostDurationSec: number;
  obstructionStartSec: number | null;
  blockedShotAttempts: number;
  lastLosRecoverySec: number | null;
  detectedPlayer: boolean;
  lastKnownPosition: THREE.Vector3 | null;
  lkpTimestampSec: number;
  initialGraceTimerSec: number;
  reactionTimerSec: number;
  turretFireCooldown: number;
  burstShotsRemaining: number;
  burstShotIndex: number;
  ammoInMag: number;
  magSize: number;
  isReloading: boolean;
  reloadTimerSec: number;
  lastSpreadRad: number;
  lastDamageDealt: number;
  lastDamageTimeSec: number | null;
  lastColliderHit: string | null;
  activeContacts: number;
  waypointIndex: number;
  collider: SpatialAABB;
  meshRoot: THREE.Group;
  chassisGroup: THREE.Group;
  wheels: THREE.Object3D[];
  suspensionStruts: THREE.Object3D[];
  turret: THREE.Object3D;
  turretGun: THREE.Object3D;
  driverSeatLocal: THREE.Vector3;
  turretOpticLocal: THREE.Vector3;
  fpvHiddenMeshes: THREE.Object3D[];
  passengerOccupantIds: string[];
  maxPassengerSeats: number;
}

export class VehicleManager {
  private vehicles: VehicleEntity[] = [];
  private seq = 0;
  private difficulty: Difficulty = 'normal';
  private mapId: MapId = 'warzone_city';
  private simTimeSec = 0;
  private readonly cameraRig = new VehicleCameraRig();
  private readonly _muzzlePos = new THREE.Vector3();
  private readonly _turretDir = new THREE.Vector3();
  private readonly _exitRayHit: RayHit = {
    hit: false,
    distance: 0,
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    collider: null,
  };
  private charredMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly _hitscanPool: Array<{
    target: HitscanTarget;
    veh: VehicleEntity | null;
    cb: ((veh: VehicleEntity, killed: boolean) => void) | null;
  }> = [];
  private readonly _lockPool: Array<{ id: string; alive: boolean; position: THREE.Vector3; label: string }> = [];
  private readonly _blipPool: MiniMapBlip[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly resourceManager: ResourceManager,
    private readonly vfx: VFXPool,
    private readonly audio: AudioManager,
    private readonly coordinator?: CombatEngagementCoordinator,
    private readonly ballistics?: BallisticSolver,
    private readonly telemetry?: CombatTelemetryRecorder
  ) {}

  getCameraMode(): VehicleCameraMode {
    return this.cameraRig.getMode();
  }

  setCameraMode(mode: VehicleCameraMode): void {
    this.cameraRig.setMode(mode);
  }

  cycleCameraMode(): VehicleCameraMode {
    return this.cameraRig.cycleMode();
  }

  getCameraDebugRay(): CameraSpringDebugRay {
    return this.cameraRig.getDebugRay();
  }

  getCameraRig(): VehicleCameraRig {
    return this.cameraRig;
  }

  setMapId(mapId: MapId): void {
    this.mapId = mapId;
  }

  getMapId(): MapId {
    return this.mapId;
  }

  notifyManualLookInput(): void {
    this.cameraRig.notifyManualLookInput();
  }

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
  }

  getVehicles(): readonly VehicleEntity[] {
    return this.vehicles;
  }

  /**
   * TRN-37: Exposes friendly vehicle passenger seat occupancy views to FriendlySquadManager
   * with atomic seat reservation and safe lateral egress points.
   */
  getFriendlySeatViews(): SquadVehicleSeatView[] {
    const out: SquadVehicleSeatView[] = [];
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.hostile) continue;
      out.push({
        id: v.id,
        alive: v.alive,
        hostile: v.hostile,
        position: v.position,
        yaw: v.yaw,
        healthRatio: v.maxHealth > 0 ? v.health / v.maxHealth : 0,
        maxPassengerSeats: v.maxPassengerSeats,
        occupantIds: v.passengerOccupantIds,
        tryBoardSeat: (operatorId: string) => {
          if (!v.alive || v.hostile) return false;
          if (v.passengerOccupantIds.includes(operatorId)) return true;
          if (v.passengerOccupantIds.length >= v.maxPassengerSeats) return false;
          v.passengerOccupantIds.push(operatorId);
          return true;
        },
        releaseSeat: (operatorId: string) => {
          const idx = v.passengerOccupantIds.indexOf(operatorId);
          if (idx >= 0) {
            v.passengerOccupantIds.splice(idx, 1);
          }
          const sideSign = idx % 2 === 0 ? 1 : -1;
          const exitDist = v.halfWidth + 1.5;
          return {
            x: v.position.x + Math.cos(v.yaw) * exitDist * sideSign,
            y: v.position.y,
            z: v.position.z - Math.sin(v.yaw) * exitDist * sideSign,
          };
        },
      });
    }
    return out;
  }

  spawnVehicle(
    type: VehicleType,
    pos: { x: number; y: number; z: number },
    yaw: number,
    hostile: boolean,
    isConvoyTarget: boolean,
    collision: CollisionWorld,
    scope: ResourceScope
  ): VehicleEntity {
    const names: Record<VehicleType, string> = {
      military_jeep: 'Strike Jeep',
      armored_truck: 'Armored Extraction Truck',
      enemy_technical: 'Hostile Technical',
      enemy_apc: 'Hostile APC',
    };
    const maxHpMap: Record<VehicleType, number> = {
      military_jeep: 380,
      armored_truck: 620,
      enemy_technical: 280,
      enemy_apc: 460,
    };
    const maxSpeedMap: Record<VehicleType, number> = {
      military_jeep: 28,
      armored_truck: 23,
      enemy_technical: 16,
      enemy_apc: 13,
    };

    const y = collision.getGroundHeightAt(pos.x, pos.z);
    const rig = buildVehicleRig(type, hostile, scope, this.resourceManager);
    rig.root.position.set(pos.x, y, pos.z);
    rig.root.rotation.order = 'YXZ';
    rig.root.rotation.y = yaw;
    this.scene.add(rig.root);
    this.resourceManager.register('object3d', scope, () => this.scene.remove(rig.root));

    const id = `veh_${++this.seq}`;
    const squadId = hostile ? 'squad_armor_convoy' : 'squad_friendly';
    if (hostile) {
      this.coordinator?.registerUnit(id, squadId);
    }

    const isHeavy = type === 'armored_truck' || type === 'enemy_apc';
    const halfW = isHeavy ? 1.48 : 1.25;
    const halfL = isHeavy ? 2.75 : 2.25;
    const cosY = Math.abs(Math.cos(yaw));
    const sinY = Math.abs(Math.sin(yaw));
    const worldHalfX = halfW * cosY + halfL * sinY;
    const worldHalfZ = halfW * sinY + halfL * cosY;

    const collider: SpatialAABB = {
      id: `collider_${id}`,
      minX: pos.x - worldHalfX,
      minY: y,
      minZ: pos.z - worldHalfZ,
      maxX: pos.x + worldHalfX,
      maxY: y + 2.4,
      maxZ: pos.z + worldHalfZ,
      layer: COLLISION_LAYER.VEHICLE,
      tag: 'vehicle',
      entityId: id,
      yaw,
      centerX: pos.x,
      centerZ: pos.z,
      halfExtX: halfW,
      halfExtZ: halfL,
    };
    collision.physicsWorld.registerStaticCollider(collider);

    const weaponProf = ENEMY_WEAPON_PROFILES[type === 'enemy_apc' ? 'enemy_autocannon' : 'enemy_lmg'];
    const diffProf = DIFFICULTY_COMBAT_PROFILES[this.difficulty];

    const handlingSpec = getVehicleHandlingSpec(type);
    const entity: VehicleEntity = {
      id,
      squadId,
      type,
      displayName: names[type],
      hostile,
      isConvoyTarget,
      alive: true,
      occupiedByPlayer: false,
      health: maxHpMap[type],
      maxHealth: maxHpMap[type],
      turretAmmo: handlingSpec.maxTurretAmmo,
      maxTurretAmmo: handlingSpec.maxTurretAmmo,
      lastDamagedAtSec: -999,
      position: new THREE.Vector3(pos.x, y, pos.z),
      centerPos: new THREE.Vector3(pos.x, y + 1.2, pos.z),
      yaw,
      speed: 0,
      maxSpeed: maxSpeedMap[type],
      steerAngle: 0,
      driveGear: 'NEUTRAL_HOLD',
      reverseConfirmTimer: 0,
      handbrakeActive: false,
      chassisPitch: 0,
      chassisPitchVel: 0,
      chassisRoll: 0,
      chassisRollVel: 0,
      chassisHeave: 0,
      chassisHeaveVel: 0,
      prevSpeed: 0,
      prevTerrainY: y,
      wheelRestY: rig.wheelRestY,
      wheelLocalPositions: rig.wheelLocalPositions,
      wheelCompression: [0, 0, 0, 0],
      wheelVelocity: [0, 0, 0, 0],
      halfWidth: halfW,
      halfLength: halfL,
      state: 'UNAWARE',
      hasLos: false,
      losBlockerId: null,
      losLostDurationSec: 0,
      obstructionStartSec: null,
      blockedShotAttempts: 0,
      lastLosRecoverySec: null,
      detectedPlayer: false,
      lastKnownPosition: null,
      lkpTimestampSec: -999,
      initialGraceTimerSec: hostile ? diffProf.airInitialGraceSec * 0.55 + (this.seq % 3) * 0.35 : 0,
      reactionTimerSec: 0,
      turretFireCooldown: 1.0 + (this.seq % 3) * 0.4,
      burstShotsRemaining: 0,
      burstShotIndex: 0,
      ammoInMag: weaponProf.magazineSize,
      magSize: weaponProf.magazineSize,
      isReloading: false,
      reloadTimerSec: 0,
      lastSpreadRad: weaponProf.baseSpreadRad,
      lastDamageDealt: 0,
      lastDamageTimeSec: null,
      lastColliderHit: null,
      activeContacts: 0,
      waypointIndex: 0,
      collider,
      meshRoot: rig.root,
      chassisGroup: rig.chassisGroup,
      wheels: rig.wheels,
      suspensionStruts: rig.suspensionStruts,
      turret: rig.turret,
      turretGun: rig.turretGun,
      driverSeatLocal: rig.driverSeatLocal,
      turretOpticLocal: rig.turretOpticLocal,
      fpvHiddenMeshes: rig.fpvHiddenMeshes,
      passengerOccupantIds: [],
      maxPassengerSeats: hostile ? 0 : isHeavy ? 3 : 2,
    };
    this.vehicles.push(entity);
    return entity;
  }

  public resetVehicleSuspension(veh: VehicleEntity): void {
    resetSuspensionState(veh);
  }

  public updateVehicleSuspension(
    veh: VehicleEntity,
    dt: number,
    collision: CollisionWorld,
    netLongitudinalInput: number,
    impactImpulse = 0
  ): void {
    stepVehicleSuspension(veh, dt, collision, netLongitudinalInput, impactImpulse);
  }

  private syncVehicleCollider(v: VehicleEntity, collision: CollisionWorld): void {
    const halfW = v.halfWidth;
    const halfL = v.halfLength;
    const cosY = Math.abs(Math.cos(v.yaw));
    const sinY = Math.abs(Math.sin(v.yaw));
    const worldHalfX = halfW * cosY + halfL * sinY;
    const worldHalfZ = halfW * sinY + halfL * cosY;

    v.collider.minX = v.position.x - worldHalfX;
    v.collider.maxX = v.position.x + worldHalfX;
    v.collider.minY = v.position.y;
    v.collider.maxY = v.position.y + 2.4;
    v.collider.minZ = v.position.z - worldHalfZ;
    v.collider.maxZ = v.position.z + worldHalfZ;
    v.collider.yaw = v.yaw;
    v.collider.centerX = v.position.x;
    v.collider.centerZ = v.position.z;
    v.collider.halfExtX = halfW;
    v.collider.halfExtZ = halfL;
    collision.physicsWorld.updateCollider(v.collider);
  }

  getPlayerVehicle(): VehicleEntity | null {
    return this.vehicles.find((v) => v.occupiedByPlayer && v.alive) ?? null;
  }

  getNearestInteractableVehicle(playerPos: THREE.Vector3): VehicleEntity | null {
    let best: VehicleEntity | null = null;
    let bestDist = 5.0;
    for (const v of this.vehicles) {
      if (!v.alive || v.hostile || v.occupiedByPlayer) continue;
      const d = v.position.distanceTo(playerPos);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  }

  getNearestFriendlyVehicle(pos: THREE.Vector3, maxDist = 7.5): VehicleEntity | null {
    let best: VehicleEntity | null = null;
    let bestDist = maxDist;
    for (const v of this.vehicles) {
      if (!v.alive || v.hostile) continue;
      const d = v.position.distanceTo(pos);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  }

  repairAndRearmVehicle(
    veh: VehicleEntity,
    hullFraction: number,
    turretAmmoFraction: number
  ): { hullAdded: number; turretAmmoAdded: number; alreadyFull: boolean } {
    if (!veh.alive) {
      return { hullAdded: 0, turretAmmoAdded: 0, alreadyFull: true };
    }
    const beforeHp = veh.health;
    const beforeAmmo = veh.turretAmmo;
    const hpGrant = Math.ceil(veh.maxHealth * Math.max(0.05, hullFraction));
    const ammoGrant = Math.ceil(veh.maxTurretAmmo * Math.max(0.05, turretAmmoFraction));
    veh.health = Math.min(veh.maxHealth, veh.health + hpGrant);
    veh.turretAmmo = Math.min(veh.maxTurretAmmo, veh.turretAmmo + ammoGrant);
    const hullAdded = Math.max(0, Math.round(veh.health - beforeHp));
    const turretAmmoAdded = Math.max(0, Math.round(veh.turretAmmo - beforeAmmo));
    return {
      hullAdded,
      turretAmmoAdded,
      alreadyFull: hullAdded === 0 && turretAmmoAdded === 0,
    };
  }

  forceExitIfOccupied(player: PlayerController, collision?: CollisionWorld): void {
    const current = this.getPlayerVehicle();
    if (current) {
      this.ejectPlayerFromVehicle(current, player, collision);
    } else {
      player.setOccupiedVehicleShield(null, null);
    }
  }

  private ejectPlayerFromVehicle(
    veh: VehicleEntity,
    player: PlayerController,
    collision?: CollisionWorld
  ): void {
    veh.occupiedByPlayer = false;
    // Moving exit safety: damp speed progressively so vehicle never runs over the dismounting player
    veh.speed = Math.sign(veh.speed) * Math.min(Math.abs(veh.speed) * 0.25, 2.4);
    veh.steerAngle = 0;
    veh.driveGear = 'NEUTRAL_HOLD';
    veh.reverseConfirmTimer = 0;
    veh.handbrakeActive = false;
    this.resetVehicleSuspension(veh);
    player.setOccupiedVehicleShield(null, null);
    this.cameraRig.onVehicleExit(veh);

    // Test exit candidates (left door, right door, rear, front-left) so player never exits into/through a solid wall
    const sideDist = veh.halfWidth + 1.35;
    const rearDist = veh.halfLength + 1.45;
    const candidates = [
      [-Math.cos(veh.yaw) * sideDist, Math.sin(veh.yaw) * sideDist],
      [Math.cos(veh.yaw) * sideDist, -Math.sin(veh.yaw) * sideDist],
      [Math.sin(veh.yaw) * rearDist, Math.cos(veh.yaw) * rearDist],
      [-Math.sin(veh.yaw) * rearDist, -Math.cos(veh.yaw) * rearDist],
    ];
    let chosenX = veh.position.x + candidates[0][0];
    let chosenZ = veh.position.z + candidates[0][1];
    let chosenY = veh.position.y;

    if (collision) {
      const testPos = new THREE.Vector3();
      const bound = collision.physicsWorld.getWorldBoundLimit() - 1;
      for (const [ox, oz] of candidates) {
        const tx = THREE.MathUtils.clamp(veh.position.x + ox, -bound, bound);
        const tz = THREE.MathUtils.clamp(veh.position.z + oz, -bound, bound);
        const ty =
          veh.position.y > 0.35
            ? collision.getSupportHeightAt(tx, veh.position.y + 1.2, tz, 1.8, 0.5)
            : collision.getGroundHeightAt(tx, tz);
        testPos.set(tx, ty, tz);

        const dx = tx - veh.position.x;
        const dz = tz - veh.position.z;
        const dist = Math.hypot(dx, dz);
        const pathBlocked =
          dist > 0.1 &&
          collision.sweptSegmentTest(
            veh.position.x,
            veh.position.y + 1.1,
            veh.position.z,
            dx / dist,
            0,
            dz / dist,
            dist + 0.35,
            PHYSICS_MASKS.CHARACTER_SOLID,
            this._exitRayHit,
            veh.collider.id
          );

        if (!pathBlocked && collision.canStandUp(testPos, 0.45, 1.8, 'player')) {
          chosenX = tx;
          chosenY = ty;
          chosenZ = tz;
          break;
        }
      }
    }

    player.position.set(chosenX, chosenY, chosenZ);
    player.velocity.set(0, 0, 0);
    player.pitch = THREE.MathUtils.clamp(player.pitch, -0.45, 0.45);
  }

  togglePlayerVehicle(player: PlayerController, collision?: CollisionWorld): boolean {
    const current = this.getPlayerVehicle();
    if (current) {
      this.ejectPlayerFromVehicle(current, player, collision);
      this.audio.play2D('ui_click', 4, 0.45);
      return false;
    }

    const near = this.getNearestInteractableVehicle(player.position);
    if (near) {
      near.occupiedByPlayer = true;
      this.resetVehicleSuspension(near);
      player.setOccupiedVehicleShield(near.collider.id, (amount) => {
        const destroyed = this.damageVehicle(near, amount, undefined, player, collision);
        return {
          hullDestroyed: destroyed,
          residualPlayerDamage: destroyed ? Math.min(24, amount * 0.35) : 0,
        };
      });
      this.cameraRig.resetForVehicleEntry(near, player);
      this.audio.play2D('engine', 5, 0.55);
      return true;
    }
    return false;
  }

  damageVehicle(
    veh: VehicleEntity,
    damage: number,
    onConvoyDestroyed?: (v: VehicleEntity) => void,
    player?: PlayerController,
    collision?: CollisionWorld
  ): boolean {
    if (!veh.alive) return false;
    veh.health -= damage;
    veh.lastDamagedAtSec = this.telemetry?.getElapsedSec() ?? this.simTimeSec;
    if (veh.health <= 0) {
      const prevState = veh.state;
      const wasOccupied = veh.occupiedByPlayer;
      veh.health = 0;
      veh.alive = false;
      veh.occupiedByPlayer = false;
      veh.state = 'DEAD';
      if (wasOccupied) {
        if (player) {
          this.ejectPlayerFromVehicle(veh, player, collision);
        } else {
          this.cameraRig.onVehicleExit(veh);
        }
      }
      if (veh.hostile) {
        this.telemetry?.recordStateTransition(veh.id, veh.squadId, 'vehicle', prevState, 'DEAD');
      }
      this.coordinator?.notifyUnitDisabled(veh.id, veh.squadId, 'vehicle', 'death');
      this.vfx.spawnExplosion(veh.position.x, veh.position.y + 1.2, veh.position.z, 1.8);
      this.audio.playSpatial('explosion', veh.position.x, veh.position.y + 1, veh.position.z, 9, 0.95);
      if (!this.charredMaterial) {
        this.charredMaterial = new THREE.MeshStandardMaterial({
          color: 0x1f2428,
          roughness: 0.85,
          metalness: 0.3,
        });
      }
      const charredMat = this.charredMaterial;
      veh.meshRoot.traverse((c) => {
        if (
          c instanceof THREE.Mesh &&
          c.material instanceof THREE.MeshStandardMaterial &&
          !c.material.transparent
        ) {
          c.material = charredMat;
        }
      });
      if (veh.hostile && veh.isConvoyTarget) {
        onConvoyDestroyed?.(veh);
      }
      return true;
    }
    return false;
  }

  applyRadialExplosion(
    x: number,
    y: number,
    z: number,
    radius: number,
    damage: number,
    onConvoyDestroyed?: (v: VehicleEntity) => void,
    player?: PlayerController,
    collision?: CollisionWorld
  ): void {
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const dist = Math.hypot(v.position.x - x, v.position.y + 1 - y, v.position.z - z);
      if (dist <= radius + 1.8) {
        const falloff = Math.max(0.25, 1 - dist / (radius + 2));
        this.damageVehicle(v, damage * falloff, onConvoyDestroyed, player, collision);
      }
    }
  }

  fillHitscanTargets(
    out: HitscanTarget[],
    onHitCallback: (veh: VehicleEntity, killed: boolean) => void
  ): void {
    let slotIdx = 0;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (!v.alive || !v.hostile) continue;
      let slot = this._hitscanPool[slotIdx];
      if (!slot) {
        const newSlot: {
          target: HitscanTarget;
          veh: VehicleEntity | null;
          cb: ((veh: VehicleEntity, killed: boolean) => void) | null;
        } = {
          veh: null,
          cb: null,
          target: {
            id: v.id,
            kind: 'vehicle',
            name: v.displayName,
            alive: true,
            position: v.centerPos,
            hitRadius: 2.35,
            onHit: (damage) => {
              const cur = newSlot.veh;
              if (!cur) return;
              const killed = this.damageVehicle(cur, damage * 0.65);
              newSlot.cb?.(cur, killed);
            },
          },
        };
        this._hitscanPool.push(newSlot);
        slot = newSlot;
      }
      slot.veh = v;
      slot.cb = onHitCallback;
      slot.target.id = v.id;
      slot.target.name = v.displayName;
      slot.target.alive = v.alive;
      slot.target.position = v.centerPos;
      out.push(slot.target);
      slotIdx++;
    }
  }

  getHitscanTargets(onHitCallback: (veh: VehicleEntity, killed: boolean) => void): HitscanTarget[] {
    return this.vehicles
      .filter((v) => v.alive && v.hostile)
      .map((v) => ({
        id: v.id,
        kind: 'vehicle',
        name: v.displayName,
        alive: v.alive,
        position: v.centerPos,
        hitRadius: 2.35,
        onHit: (damage) => {
          const killed = this.damageVehicle(v, damage * 0.65);
          onHitCallback(v, killed);
        },
      }));
  }

  fillLockCandidates(
    out: Array<{ id: string; alive: boolean; position: THREE.Vector3; label: string }>
  ): void {
    let slotIdx = 0;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (!v.alive || !v.hostile) continue;
      let slot = this._lockPool[slotIdx];
      if (!slot) {
        slot = {
          id: v.id,
          alive: v.alive,
          position: v.centerPos,
          label: v.displayName.toUpperCase(),
        };
        this._lockPool.push(slot);
      } else {
        slot.id = v.id;
        slot.alive = v.alive;
        slot.position = v.centerPos;
        slot.label = v.displayName.toUpperCase();
      }
      out.push(slot);
      slotIdx++;
    }
  }

  getLockCandidates(): Array<{ id: string; alive: boolean; position: THREE.Vector3; label: string }> {
    return this.vehicles
      .filter((v) => v.alive && v.hostile)
      .map((v) => ({
        id: v.id,
        alive: v.alive,
        position: v.centerPos,
        label: v.displayName.toUpperCase(),
      }));
  }

  update(
    dt: number,
    input: InputManager,
    player: PlayerController,
    camera: THREE.PerspectiveCamera,
    collision: CollisionWorld,
    roadWaypoints: THREE.Vector3[],
    onTurretHitEnemyCheck: (origin: THREE.Vector3, dir: THREE.Vector3) => void,
    onConvoyDestroyed?: (v: VehicleEntity) => void,
    baseFov = 78,
    hasManualLookInput = false
  ): void {
    this.simTimeSec += dt;
    const nowSec = this.telemetry?.getElapsedSec() ?? this.simTimeSec;
    const diffProf = DIFFICULTY_COMBAT_PROFILES[this.difficulty];

    for (const v of this.vehicles) {
      if (!v.alive) continue;

      v.turretFireCooldown = Math.max(0, v.turretFireCooldown - dt);

      const halfW = v.halfWidth;
      const halfL = v.halfLength;

      if (v.occupiedByPlayer) {
        const ctrl = input.getVehicleControls();
        v.handbrakeActive = ctrl.handbrake;

        // Sample terrain slope pitch along vehicle forward axis (-sin(yaw), -cos(yaw))
        const fwdX = -Math.sin(v.yaw);
        const fwdZ = -Math.cos(v.yaw);
        const probeHalf = Math.max(1.2, halfL * 0.78);
        const frontY = collision.getGroundHeightAt(
          v.position.x + fwdX * probeHalf,
          v.position.z + fwdZ * probeHalf
        );
        const rearY = collision.getGroundHeightAt(
          v.position.x - fwdX * probeHalf,
          v.position.z - fwdZ * probeHalf
        );
        const slopePitchRad = Math.atan2(frontY - rearY, probeHalf * 2);

        const step = stepVehicleHandling({
          type: v.type,
          mapId: this.mapId,
          dt,
          gas: ctrl.gas,
          brakeReverse: ctrl.brakeReverse,
          steer: ctrl.steer,
          handbrake: ctrl.handbrake,
          speed: v.speed,
          maxSpeed: v.maxSpeed,
          steerAngle: v.steerAngle,
          driveGear: v.driveGear,
          reverseConfirmTimer: v.reverseConfirmTimer,
          slopePitchRad,
          reverseEnterSpeed: VEHICLE_REVERSE_ENTER_SPEED,
          reverseExitSpeed: VEHICLE_REVERSE_EXIT_SPEED,
          reverseConfirmSec: VEHICLE_REVERSE_CONFIRM_SEC,
        });

        v.speed = step.speed;
        v.steerAngle = step.steerAngle;
        v.driveGear = step.driveGear;
        v.reverseConfirmTimer = step.reverseConfirmTimer;
        v.yaw += step.yawDeltaRad;

        // Visual front wheel steer & rolling wheel spin
        for (let wi = 0; wi < v.wheels.length; wi++) {
          const wheel = v.wheels[wi];
          wheel.rotation.x += v.speed * dt * 1.4;
          if (wi < 2) {
            wheel.rotation.y = -v.steerAngle * 0.52;
          }
        }

        const moveRes = collision.resolveVehicleMovement(
          v.position,
          v.yaw,
          v.speed,
          halfW,
          halfL,
          dt,
          v.id,
          v.collider.id
        );
        v.speed = moveRes.newSpeed;
        v.yaw = moveRes.newYaw;
        v.lastColliderHit = moveRes.lastBlockerId;
        v.activeContacts = moveRes.hitObstacle ? 1 : 0;

        if (moveRes.hitObstacle && moveRes.impactSpeed > 4.0) {
          this.vfx.spawnImpact(
            v.position.x - Math.sin(v.yaw) * halfL,
            v.position.y + 0.9,
            v.position.z - Math.cos(v.yaw) * halfL,
            'metal'
          );
          if (moveRes.hullDamageApplied > 0) {
            const destroyedByImpact = this.damageVehicle(
              v,
              moveRes.hullDamageApplied,
              onConvoyDestroyed,
              player,
              collision
            );
            player.addCameraShake(Math.min(0.45, moveRes.impactSpeed * 0.02));
            if (destroyedByImpact) continue;
          }
          // If rammed another vehicle, apply momentum transfer & hull damage to the struck vehicle
          if (moveRes.blockerCollider?.layer === COLLISION_LAYER.VEHICLE) {
            const otherVeh = this.vehicles.find(
              (o) => o.alive && o.collider.id === moveRes.blockerCollider?.id
            );
            if (otherVeh) {
              const ramDmg = Math.max(18, moveRes.impactSpeed * 5.2);
              this.damageVehicle(otherVeh, ramDmg, onConvoyDestroyed, player, collision);
            }
          }
        }

        this.syncVehicleCollider(v, collision);
        player.position.copy(v.position);

        const netLongitudinal = ctrl.gas - ctrl.brakeReverse;
        const impactImpulse = moveRes.hitObstacle ? moveRes.impactSpeed : 0;
        this.updateVehicleSuspension(v, dt, collision, netLongitudinal, impactImpulse);

        // Synchronize visual turret orientation and world matrix BEFORE camera rig update
        const gunPitch = THREE.MathUtils.clamp(player.pitch, -0.35, 0.65);
        v.turret.rotation.y = player.yaw - v.yaw;
        v.turretGun.rotation.x = gunPitch;
        v.meshRoot.updateMatrixWorld(true);

        // Multi-mode VehicleCameraRig (Chase, Driver FPV, Gunner Turret, Tactical Orbit)
        this.cameraRig.updateCamera(dt, v, player, camera, collision, baseFov, hasManualLookInput);

        if (input.isActionHeld('fire') && v.turretFireCooldown <= 0) {
          if (v.turretAmmo <= 0) {
            v.turretFireCooldown = 0.38;
            this.audio.play2D('empty_click', 4, 0.5);
          } else {
            v.turretAmmo = Math.max(0, v.turretAmmo - 1);
            v.turretFireCooldown = 0.12;
            camera.getWorldDirection(this._turretDir);
            // Authoritative turret raycast origin is anchored to un-tilted vehicle root + turret mount
            // so visual chassis suspension pitch/roll/heave never skews ballistic raycast origin or aim.
            const isHeavy = v.type === 'armored_truck' || v.type === 'enemy_apc';
            const turretBaseY = 0.9 + (isHeavy ? 1.35 : 1.05) + 0.6 + 0.12;
            const cosP = Math.cos(gunPitch);
            this._muzzlePos.set(
              v.position.x - Math.sin(player.yaw) * cosP * 1.55,
              v.position.y + turretBaseY + Math.sin(gunPitch) * 1.55,
              v.position.z - Math.cos(player.yaw) * cosP * 1.55
            );
            this.audio.play2D('shot_lmg', 7, 0.55);
            this.vfx.spawnMuzzleLight(this._muzzlePos.x, this._muzzlePos.y, this._muzzlePos.z);
            this.vfx.spawnTracer(
              this._muzzlePos.x,
              this._muzzlePos.y,
              this._muzzlePos.z,
              this._muzzlePos.x + this._turretDir.x * 95,
              this._muzzlePos.y + this._turretDir.y * 95,
              this._muzzlePos.z + this._turretDir.z * 95
            );
            onTurretHitEnemyCheck(this._muzzlePos, this._turretDir);
          }
        }
      } else if (v.hostile) {
        if (v.initialGraceTimerSec > 0) {
          v.initialGraceTimerSec = Math.max(0, v.initialGraceTimerSec - dt);
        }
        if (roadWaypoints.length > 0) {
          const wp = roadWaypoints[v.waypointIndex % roadWaypoints.length];
          const dx = wp.x - v.position.x;
          const dz = wp.z - v.position.z;
          const distWp = Math.hypot(dx, dz);
          if (distWp < 6) {
            v.waypointIndex = (v.waypointIndex + 1) % roadWaypoints.length;
          } else {
            const targetYaw = Math.atan2(-dx, -dz);
            let yawDiff = targetYaw - v.yaw;
            while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
            while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
            const yawStep = THREE.MathUtils.clamp(yawDiff, -2.2 * dt, 2.2 * dt);
            v.steerAngle = THREE.MathUtils.clamp(-yawDiff * 0.45, -0.5, 0.5);
            v.yaw += yawStep;
            v.speed = THREE.MathUtils.lerp(v.speed, v.maxSpeed, Math.min(1, dt * 4.5));
            const moveRes = collision.resolveVehicleMovement(
              v.position,
              v.yaw,
              v.speed,
              halfW,
              halfL,
              dt,
              v.id,
              v.collider.id
            );
            v.speed = moveRes.newSpeed;
            v.yaw = moveRes.newYaw;
            v.lastColliderHit = moveRes.lastBlockerId;
            v.activeContacts = moveRes.hitObstacle ? 1 : 0;
            this.syncVehicleCollider(v, collision);
          }
          this.updateVehicleSuspension(v, dt, collision, 0.35, 0);
        }

        if (v.isReloading) {
          v.reloadTimerSec -= dt;
          if (v.reloadTimerSec <= 0) {
            v.isReloading = false;
            v.ammoInMag = v.magSize;
          }
        }

        if (v.initialGraceTimerSec > 0) {
          continue;
        }

        // Hostile turret perception, global lease check & physical spread raycast
        const dPlayer = v.position.distanceTo(player.position);
        const weaponClass = v.type === 'enemy_apc' ? 'enemy_autocannon' : 'enemy_lmg';
        const weaponProf = ENEMY_WEAPON_PROFILES[weaponClass];


        let rawLos = false;
        let exposedTargetPoint = player.position;
        let blockerId: string | null = null;

        if (player.alive && dPlayer < 68 && this.ballistics) {
          const losRes = this.ballistics.checkLineOfSight(
            v.position.x,
            v.position.y + 2.45,
            v.position.z,
            player,
            collision,
            68,
            v.collider.id
          );
          rawLos = losRes.visible;
          exposedTargetPoint = losRes.exposedPoint;
          blockerId = losRes.blockerId;
        }

        const prevLos = v.hasLos;
        const prevState = v.state;
        v.hasLos = rawLos;
        v.losBlockerId = blockerId;

        if (rawLos) {
          if (!prevLos && v.obstructionStartSec !== null) {
            const recovSec = Number(Math.max(0, nowSec - v.obstructionStartSec).toFixed(2));
            v.lastLosRecoverySec = recovSec;
            v.obstructionStartSec = null;
            if (recovSec > 0.05) {
              this.telemetry?.recordEvent(
                'ALERT_STATE',
                v.id,
                v.squadId,
                'vehicle',
                `${v.displayName} recovered LOS after ${recovSec.toFixed(2)}s`
              );
            }
          }
          v.losLostDurationSec = 0;
          if (!v.lastKnownPosition) v.lastKnownPosition = new THREE.Vector3();
          v.lastKnownPosition.copy(exposedTargetPoint);
          v.lkpTimestampSec = nowSec;
          if (!v.detectedPlayer) {
            v.detectedPlayer = true;
            this.telemetry?.recordEvent(
              'DETECTED',
              v.id,
              v.squadId,
              'vehicle',
              `${v.displayName} turret acquired player at ${dPlayer.toFixed(0)}m`
            );
          }
          if (v.state === 'UNAWARE' || v.state === 'SEARCHING') {
            v.state = 'ALERTED';
            v.reactionTimerSec = diffProf.reactionDelayBaseSec + 0.2;
          }
        } else {
          v.losLostDurationSec += dt;
          if (prevLos) {
            v.obstructionStartSec = nowSec;
            this.telemetry?.recordEvent(
              'LOST_LOS',
              v.id,
              v.squadId,
              'vehicle',
              `${v.displayName} lost visual contact (blocked by ${blockerId ?? 'cover'})`
            );
          }
          if (v.state === 'ENGAGING' || v.state === 'ALERTED') {
            if (v.losLostDurationSec >= AUTHORITATIVE_COMBAT_CONFIG.losGraceSec) {
              this.coordinator?.releaseLease(v.id, 'vehicle_lost_los');
              v.state = 'SEARCHING';
            }
          }
        }

        if (v.state === 'ALERTED') {
          v.reactionTimerSec = Math.max(0, v.reactionTimerSec - dt);
          if (v.reactionTimerSec <= 0 && rawLos) {
            const granted =
              this.coordinator?.requestLease({
                unitId: v.id,
                squadId: v.squadId,
                domain: 'vehicle',
                role: 'vehicle_turret',
                kind: 'DIRECT',
                distanceMeters: dPlayer,
                hasLos: true,
                isWeaponReady: !v.isReloading,
              }) ?? true;
            if (granted) {
              v.state = 'ENGAGING';
            }
          }
        }

        if (v.state !== prevState) {
          this.telemetry?.recordStateTransition(v.id, v.squadId, 'vehicle', prevState, v.state);
        }

        const lease = this.coordinator?.getUnitLease(v.id);
        const allowedToFire =
          v.state === 'ENGAGING' &&
          rawLos &&
          !v.isReloading &&
          player.alive &&
          (Boolean(lease) || !this.coordinator);

        if (
          v.state === 'ENGAGING' &&
          !rawLos &&
          !v.isReloading &&
          player.alive &&
          v.turretFireCooldown <= 0
        ) {
          v.blockedShotAttempts++;
          v.turretFireCooldown = 0.25;
          this.telemetry?.recordEvent(
            'SHOT_BLOCKED_COVER',
            v.id,
            v.squadId,
            'vehicle',
            `${v.displayName} shot blocked during grace (blocker=${blockerId ?? 'cover'})`
          );
        }

        if (allowedToFire && v.turretFireCooldown <= 0 && this.ballistics) {
          if (v.burstShotsRemaining <= 0) {
            v.burstShotsRemaining = Math.min(v.ammoInMag, 4);
            v.burstShotIndex = 0;
          }

          this._muzzlePos.set(v.position.x, v.position.y + 2.45, v.position.z);
          const shotRes = this.ballistics.fireWeaponRay(
            {
              unitId: v.id,
              squadId: v.squadId,
              domain: 'vehicle',
              weaponClass,
              muzzleOrigin: this._muzzlePos,
              aimTarget: exposedTargetPoint,
              distanceMeters: dPlayer,
              unitAccuracy: v.type === 'enemy_apc' ? 0.56 : 0.48,
              isMoving: v.speed > 1.0,
              aimDurationSec: 0.4,
              burstShotIndex: v.burstShotIndex,
              isSuppressedOrStaggered: false,
              isSuppressionFire: false,
              difficultyProfile: diffProf,
              ignoreColliderId: v.collider.id,
              attackerArchetype: v.type,
              attackerName: v.displayName,
            },
            player,
            collision
          );

          this.audio.playSpatial('shot_lmg', v.position.x, v.position.y + 2, v.position.z, 5, 0.48);
          v.lastSpreadRad = shotRes.spreadRad;
          if (shotRes.hitPlayer && shotRes.damageApplied > 0) {
            v.lastDamageDealt = shotRes.damageApplied;
            v.lastDamageTimeSec = nowSec;
          }

          v.ammoInMag--;
          v.burstShotsRemaining--;
          v.burstShotIndex++;

          if (v.ammoInMag <= 0) {
            v.isReloading = true;
            v.reloadTimerSec = weaponProf.reloadDurationSec;
            this.coordinator?.releaseLease(v.id, 'vehicle_reload');
          } else if (v.burstShotsRemaining > 0) {
            v.turretFireCooldown = weaponProf.shotIntervalSec;
          } else {
            v.turretFireCooldown =
              (v.type === 'enemy_apc' ? 1.45 : 1.75) * diffProf.burstPauseMultiplier;
            this.coordinator?.releaseLease(v.id, 'vehicle_burst_complete', true);
            const beforeCooldown = v.state;
            v.state = 'ALERTED';
            v.reactionTimerSec = 0.55;
            this.telemetry?.recordStateTransition(v.id, v.squadId, 'vehicle', beforeCooldown, 'ALERTED');
          }
        }
      }

      for (const w of v.wheels) {
        w.rotation.x -= v.speed * dt * 1.4;
      }
      v.centerPos.set(v.position.x, v.position.y + 1.2, v.position.z);
    }
  }

  getDebugInspectorRows(player: PlayerController): EnemyDebugInspectorRow[] {
    const nowSec = this.telemetry?.getElapsedSec() ?? 0;
    const rows: EnemyDebugInspectorRow[] = [];

    for (const v of this.vehicles) {
      if (!v.alive || !v.hostile) continue;
      const dist = v.position.distanceTo(player.position);
      const lease = this.coordinator?.getUnitLease(v.id) ?? null;
      const waiting = this.coordinator?.isUnitWaiting(v.id) ?? false;
      const stats = this.telemetry?.getEnemyStats(v.id) ?? { damage: 0, hits: 0, shots: 0 };

      rows.push({
        id: v.id,
        displayName: v.displayName,
        squadId: v.squadId,
        domain: 'vehicle',
        role: 'vehicle_turret',
        state: v.state,
        detectedPlayer: v.detectedPlayer,
        hasLos: v.hasLos,
        losBlockerId: v.losBlockerId,
        distanceMeters: Number(dist.toFixed(1)),
        x: Number(v.position.x.toFixed(1)),
        y: Number(v.position.y.toFixed(1)),
        z: Number(v.position.z.toFixed(1)),
        yaw: v.yaw,
        fovDeg: 120,
        detectionRange: 68,
        hearingRange: 0,
        lkpX: v.lastKnownPosition ? Number(v.lastKnownPosition.x.toFixed(1)) : null,
        lkpY: v.lastKnownPosition ? Number(v.lastKnownPosition.y.toFixed(1)) : null,
        lkpZ: v.lastKnownPosition ? Number(v.lastKnownPosition.z.toFixed(1)) : null,
        lkpAgeSec: v.lastKnownPosition ? Number(Math.max(0, nowSec - v.lkpTimestampSec).toFixed(1)) : 0,
        reactionTimerSec: Number(v.reactionTimerSec.toFixed(2)),
        fireCooldownSec: Number(v.turretFireCooldown.toFixed(2)),
        ammoInMag: v.ammoInMag,
        magSize: v.magSize,
        isReloading: v.isReloading,
        currentSpreadDeg: Number(((v.lastSpreadRad * 180) / Math.PI).toFixed(2)),
        accuracyPct: stats.shots > 0 ? Number(((stats.hits / stats.shots) * 100).toFixed(0)) : 52,
        tokenStatus: lease ? lease.kind : waiting ? 'WAITING' : 'NONE',
        allowedToFire: Boolean(lease) && v.hasLos && !v.isReloading,
        blockedByCover: !v.hasLos && v.losBlockerId !== null,
        shotsFired: stats.shots,
        shotsHit: stats.hits,
        totalDamageDealt: Number(stats.damage.toFixed(1)),
        lastDamageAmount: Number(v.lastDamageDealt.toFixed(1)),
        lastDamageTimeSec: v.lastDamageTimeSec !== null ? Number(v.lastDamageTimeSec.toFixed(1)) : null,
        obstructionDurationSec:
          v.obstructionStartSec !== null ? Number(Math.max(0, nowSec - v.obstructionStartSec).toFixed(2)) : 0,
        blockedShotAttempts: v.blockedShotAttempts,
        lastLosRecoverySec: v.lastLosRecoverySec,
      });
    }

    return rows;
  }

  hasAnyHostileWithLos(): boolean {
    for (const v of this.vehicles) {
      if (v.alive && v.hostile && v.hasLos) return true;
    }
    return false;
  }

  getHostileVehicles(): VehicleEntity[] {
    return this.vehicles.filter((v) => v.alive && v.hostile);
  }

  fillMiniMapBlips(out: MiniMapBlip[]): void {
    let slotIdx = 0;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (!v.alive) continue;
      let slot = this._blipPool[slotIdx];
      const kind = v.hostile ? 'vehicle' : 'friendly_vehicle';
      if (!slot) {
        slot = { id: v.id, x: v.position.x, z: v.position.z, kind };
        this._blipPool.push(slot);
      } else {
        slot.id = v.id;
        slot.x = v.position.x;
        slot.z = v.position.z;
        slot.kind = kind;
      }
      out.push(slot);
      slotIdx++;
    }
  }

  getMiniMapBlips(): MiniMapBlip[] {
    return this.vehicles
      .filter((v) => v.alive)
      .map((v) => ({
        id: v.id,
        x: v.position.x,
        z: v.position.z,
        kind: v.hostile ? 'vehicle' : 'friendly_vehicle',
      }));
  }

  clear(): void {
    this.cameraRig.onVehicleExit(this.getPlayerVehicle());
    this.vehicles = [];
    for (let i = 0; i < this._hitscanPool.length; i++) {
      this._hitscanPool[i].veh = null;
      this._hitscanPool[i].cb = null;
      this._hitscanPool[i].target.alive = false;
      this._hitscanPool[i].target.position = this._muzzlePos;
    }
    this._lockPool.length = 0;
    this._blipPool.length = 0;
  }

  getPhysicsInspectorRows(): PhysicsBodyInspectorRow[] {
    const out: PhysicsBodyInspectorRow[] = [];
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const isHeavy = v.type === 'armored_truck' || v.type === 'enemy_apc';
      const w = Number((v.halfWidth * 2).toFixed(2));
      const l = Number((v.halfLength * 2).toFixed(2));
      const vx = -Math.sin(v.yaw) * v.speed;
      const vz = -Math.cos(v.yaw) * v.speed;
      out.push({
        id: v.id,
        entityType: 'vehicle',
        classification: 'dynamic',
        shape: 'obb',
        dimensions: `${w}m × 2.4m × ${l}m`,
        x: Number(v.position.x.toFixed(2)),
        y: Number(v.position.y.toFixed(2)),
        z: Number(v.position.z.toFixed(2)),
        yaw: Number(v.yaw.toFixed(2)),
        vx: Number(vx.toFixed(2)),
        vy: 0,
        vz: Number(vz.toFixed(2)),
        ax: 0,
        ay: 0,
        az: 0,
        speed: Number(Math.abs(v.speed).toFixed(2)),
        massKg: isHeavy ? 6800 : 3800,
        layer: COLLISION_LAYER.VEHICLE,
        layerLabel: formatCollisionLayer(COLLISION_LAYER.VEHICLE),
        mask: PHYSICS_MASKS.VEHICLE_SOLID,
        maskLabel: formatCollisionLayer(PHYSICS_MASKS.VEHICLE_SOLID),
        physicalState: v.activeContacts > 0 ? 'DEFLECTING' : Math.abs(v.speed) > 0.25 ? 'CRUISING' : 'GROUNDED',
        lastCollisionId: v.lastColliderHit,
        lastNormalX: 0,
        lastNormalY: 1,
        lastNormalZ: 0,
        contactCount: v.activeContacts,
      });
    }
    return out;
  }

  dispose(): void {
    this.clear();
    this.charredMaterial?.dispose();
    this.charredMaterial = null;
  }
}
