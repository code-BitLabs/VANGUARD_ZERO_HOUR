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
import { Difficulty } from '@/src/schemas/common.schema';
import { MiniMapBlip, VehicleCameraMode } from '@/src/schemas/events.schema';
import { VehicleType } from '@/src/schemas/mission.schema';
import { BallisticSolver } from './BallisticSolver';
import { CombatEngagementCoordinator } from './CombatEngagementCoordinator';
import { CombatTelemetryRecorder, EnemyDebugInspectorRow } from './CombatTelemetryRecorder';
import { PlayerController } from './PlayerController';
import { CameraSpringDebugRay, VehicleCameraRig } from './VehicleCameraRig';
import { HitscanTarget } from './WeaponSystem';

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
  position: THREE.Vector3;
  centerPos: THREE.Vector3;
  yaw: number;
  speed: number;
  maxSpeed: number;
  chassisPitch: number;
  chassisRoll: number;
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
  wheels: THREE.Object3D[];
  turret: THREE.Object3D;
  turretGun: THREE.Object3D;
  driverSeatLocal: THREE.Vector3;
  turretOpticLocal: THREE.Vector3;
  fpvHiddenMeshes: THREE.Object3D[];
}

export class VehicleManager {
  private vehicles: VehicleEntity[] = [];
  private seq = 0;
  private difficulty: Difficulty = 'normal';
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

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
  }

  getVehicles(): readonly VehicleEntity[] {
    return this.vehicles;
  }

  spawnVehicle(
    type: VehicleType,
    pos: { x: number; y: number; z: number },
    yaw: number,
    hostile: boolean,
    isConvoyTarget: boolean,
    collision: CollisionWorld,
    scope: ResourceScope
  ): void {
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
    const rig = this.buildVehicleRig(type, hostile, scope);
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

    this.vehicles.push({
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
      position: new THREE.Vector3(pos.x, y, pos.z),
      centerPos: new THREE.Vector3(pos.x, y + 1.2, pos.z),
      yaw,
      speed: 0,
      maxSpeed: maxSpeedMap[type],
      chassisPitch: 0,
      chassisRoll: 0,
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
      wheels: rig.wheels,
      turret: rig.turret,
      turretGun: rig.turretGun,
      driverSeatLocal: rig.driverSeatLocal,
      turretOpticLocal: rig.turretOpticLocal,
      fpvHiddenMeshes: rig.fpvHiddenMeshes,
    });
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

  togglePlayerVehicle(player: PlayerController, collision?: CollisionWorld): boolean {
    const current = this.getPlayerVehicle();
    if (current) {
      current.occupiedByPlayer = false;
      current.speed *= 0.25;
      this.cameraRig.onVehicleExit(current);

      // Test exit candidates (left door, right door, rear, front-left) so player never exits into/through a solid wall
      const sideDist = current.halfWidth + 1.35;
      const rearDist = current.halfLength + 1.45;
      const candidates = [
        [-Math.cos(current.yaw) * sideDist, Math.sin(current.yaw) * sideDist],
        [Math.cos(current.yaw) * sideDist, -Math.sin(current.yaw) * sideDist],
        [Math.sin(current.yaw) * rearDist, Math.cos(current.yaw) * rearDist],
        [-Math.sin(current.yaw) * rearDist, -Math.cos(current.yaw) * rearDist],
      ];
      let chosenX = current.position.x + candidates[0][0];
      let chosenZ = current.position.z + candidates[0][1];
      let chosenY = current.position.y;

      if (collision) {
        const testPos = new THREE.Vector3();
        const bound = collision.physicsWorld.getWorldBoundLimit() - 1;
        for (const [ox, oz] of candidates) {
          const tx = THREE.MathUtils.clamp(current.position.x + ox, -bound, bound);
          const tz = THREE.MathUtils.clamp(current.position.z + oz, -bound, bound);
          const ty = collision.getGroundHeightAt(tx, tz);
          testPos.set(tx, ty, tz);

          const dx = tx - current.position.x;
          const dz = tz - current.position.z;
          const dist = Math.hypot(dx, dz);
          const pathBlocked =
            dist > 0.1 &&
            collision.sweptSegmentTest(
              current.position.x,
              current.position.y + 1.1,
              current.position.z,
              dx / dist,
              0,
              dz / dist,
              dist + 0.35,
              PHYSICS_MASKS.CHARACTER_SOLID,
              this._exitRayHit,
              current.collider.id
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
      this.audio.play2D('ui_click', 4, 0.45);
      return false;
    }

    const near = this.getNearestInteractableVehicle(player.position);
    if (near) {
      near.occupiedByPlayer = true;
      this.cameraRig.resetForVehicleEntry(near, player);
      this.audio.play2D('engine', 5, 0.55);
      return true;
    }
    return false;
  }

  damageVehicle(
    veh: VehicleEntity,
    damage: number,
    onConvoyDestroyed?: (v: VehicleEntity) => void
  ): boolean {
    if (!veh.alive) return false;
    veh.health -= damage;
    if (veh.health <= 0) {
      const prevState = veh.state;
      const wasOccupied = veh.occupiedByPlayer;
      veh.health = 0;
      veh.alive = false;
      veh.occupiedByPlayer = false;
      veh.state = 'DEAD';
      if (wasOccupied) {
        this.cameraRig.onVehicleExit(veh);
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
    onConvoyDestroyed?: (v: VehicleEntity) => void
  ): void {
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const dist = Math.hypot(v.position.x - x, v.position.y + 1 - y, v.position.z - z);
      if (dist <= radius + 1.8) {
        const falloff = Math.max(0.25, 1 - dist / (radius + 2));
        this.damageVehicle(v, damage * falloff, onConvoyDestroyed);
      }
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
    baseFov = 78
  ): void {
    const nowSec = this.telemetry?.getElapsedSec() ?? 0;
    const diffProf = DIFFICULTY_COMBAT_PROFILES[this.difficulty];

    for (const v of this.vehicles) {
      if (!v.alive) continue;

      v.turretFireCooldown = Math.max(0, v.turretFireCooldown - dt);

      const halfW = v.halfWidth;
      const halfL = v.halfLength;

      if (v.occupiedByPlayer) {
        const axes = input.getMoveAxes();
        const accel = axes.forward * 24;
        if (Math.abs(axes.forward) > 0.1) {
          v.speed = THREE.MathUtils.clamp(v.speed + accel * dt, -10, v.maxSpeed);
        } else {
          v.speed = THREE.MathUtils.lerp(v.speed, 0, Math.min(1, dt * 2.8));
        }

        const steerDir = Math.abs(v.speed) > 0.4 ? Math.sign(v.speed) : 1;
        v.yaw -= axes.right * 1.9 * steerDir * dt * Math.min(1, Math.abs(v.speed) / 6 + 0.35);

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
            this.damageVehicle(v, moveRes.hullDamageApplied, onConvoyDestroyed);
            player.addCameraShake(Math.min(0.45, moveRes.impactSpeed * 0.02));
          }
          // If rammed another vehicle, apply momentum transfer & hull damage to the struck vehicle
          if (moveRes.blockerCollider?.layer === COLLISION_LAYER.VEHICLE) {
            const otherVeh = this.vehicles.find(
              (o) => o.alive && o.collider.id === moveRes.blockerCollider?.id
            );
            if (otherVeh) {
              const ramDmg = Math.max(18, moveRes.impactSpeed * 5.2);
              this.damageVehicle(otherVeh, ramDmg, onConvoyDestroyed);
            }
          }
        }

        this.syncVehicleCollider(v, collision);
        player.position.copy(v.position);

        v.meshRoot.position.copy(v.position);
        const targetRoll = axes.right * 0.055 * Math.min(1, Math.abs(v.speed) / 14);
        const targetPitch = -axes.forward * 0.036;
        v.chassisRoll = THREE.MathUtils.lerp(v.chassisRoll, targetRoll, Math.min(1, dt * 8));
        v.chassisPitch = THREE.MathUtils.lerp(v.chassisPitch, targetPitch, Math.min(1, dt * 8));
        v.meshRoot.rotation.set(v.chassisPitch, v.yaw, v.chassisRoll, 'YXZ');

        // Multi-mode VehicleCameraRig (Chase, Driver FPV, Gunner Turret, Tactical Orbit)
        this.cameraRig.updateCamera(dt, v, player, camera, collision, baseFov);

        v.turret.rotation.y = player.yaw - v.yaw;
        v.turretGun.rotation.x = THREE.MathUtils.clamp(player.pitch, -0.35, 0.65);
        v.meshRoot.updateMatrixWorld(true);

        if (input.isMouseHeld(0) && v.turretFireCooldown <= 0) {
          v.turretFireCooldown = 0.12;
          camera.getWorldDirection(this._turretDir);
          if (this.cameraRig.getMode() === 'driver_fpv') {
            this._muzzlePos.set(v.position.x, v.position.y + 2.45, v.position.z);
          } else {
            this._muzzlePos.set(0, 0.12, -1.55).applyMatrix4(v.turretGun.matrixWorld);
          }
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
      } else if (v.hostile) {
        if (roadWaypoints.length > 0) {
          const wp = roadWaypoints[v.waypointIndex % roadWaypoints.length];
          const dx = wp.x - v.position.x;
          const dz = wp.z - v.position.z;
          const distWp = Math.hypot(dx, dz);
          if (distWp < 6) {
            v.waypointIndex = (v.waypointIndex + 1) % roadWaypoints.length;
          } else {
            const targetYaw = Math.atan2(-dx, -dz);
            v.yaw = targetYaw;
            v.speed = v.maxSpeed;
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
          v.meshRoot.position.copy(v.position);
          v.meshRoot.rotation.y = v.yaw;
        }

        if (v.isReloading) {
          v.reloadTimerSec -= dt;
          if (v.reloadTimerSec <= 0) {
            v.isReloading = false;
            v.ammoInMag = v.magSize;
          }
        }

        // Hostile turret perception, global lease check & physical spread raycast
        const dPlayer = v.position.distanceTo(player.position);
        const weaponClass = v.type === 'enemy_apc' ? 'enemy_autocannon' : 'enemy_lmg';
        const weaponProf = ENEMY_WEAPON_PROFILES[weaponClass];

        let rawLos = false;
        let exposedTargetPoint = player.position;
        let blockerId: string | null = null;

        if (player.alive && dPlayer < 68 && this.ballistics) {
          // Temporarily exclude own vehicle collider from self-blocking turret muzzle
          collision.spatialHash.remove(v.collider);
          const losRes = this.ballistics.checkLineOfSight(
            v.position.x,
            v.position.y + 2.45,
            v.position.z,
            player,
            collision,
            68
          );
          collision.spatialHash.insert(v.collider);
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
          collision.spatialHash.remove(v.collider);
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
            },
            player,
            collision
          );
          collision.spatialHash.insert(v.collider);

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

      if (v.occupiedByPlayer && Math.abs(v.speed) > 10) {
        for (const other of this.vehicles) {
          if (other === v || !other.alive || !other.hostile) continue;
          if (v.position.distanceTo(other.position) < 4.2) {
            this.damageVehicle(other, 95, onConvoyDestroyed);
            this.damageVehicle(v, 18);
            v.speed *= -0.3;
          }
        }
      }
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

  private buildVehicleRig(
    type: VehicleType,
    hostile: boolean,
    scope: ResourceScope
  ): {
    root: THREE.Group;
    wheels: THREE.Object3D[];
    turret: THREE.Object3D;
    turretGun: THREE.Object3D;
    driverSeatLocal: THREE.Vector3;
    turretOpticLocal: THREE.Vector3;
    fpvHiddenMeshes: THREE.Object3D[];
  } {
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const wheels: THREE.Object3D[] = [];
    const fpvHiddenMeshes: THREE.Object3D[] = [];

    const bodyColor = hostile ? (type === 'enemy_apc' ? 0x4b3b34 : 0x57534e) : 0x3b4936;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.65, metalness: 0.35 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.78, metalness: 0.45 });
    const interiorMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.88, metalness: 0.2 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.9 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: hostile ? 0xfca5a5 : 0x7dd3fc,
      emissive: hostile ? 0x450a0a : 0x0c4a6e,
      emissiveIntensity: 0.16,
      metalness: 0.15,
      roughness: 0.12,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xfde047,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.3 });

    [bodyMat, trimMat, interiorMat, tireMat, glassMat, headlightMat, gunMat].forEach((m) =>
      this.resourceManager.registerMaterial(m, scope)
    );

    const isHeavy = type === 'armored_truck' || type === 'enemy_apc';
    const w = isHeavy ? 2.75 : 2.28;
    const l = isHeavy ? 5.5 : 4.4;

    // Lower hull chassis frame + sloped front hood + rear cargo deck (keeps cab open & sightlines clear)
    const lowerHullGeo = new THREE.BoxGeometry(w, 0.62, l);
    const hoodGeo = new THREE.BoxGeometry(w * 0.88, 0.36, l * 0.28);
    const doorSillGeo = new THREE.BoxGeometry(0.14, 0.44, l * 0.42);
    const rearBulkheadGeo = new THREE.BoxGeometry(w * 0.9, 0.56, l * 0.26);
    const pillarGeo = new THREE.BoxGeometry(0.09, 0.92, 0.09);
    const roofGeo = new THREE.BoxGeometry(w * 0.86, 0.08, l * 0.44);
    const windGeo = new THREE.BoxGeometry(w * 0.78, 0.56, 0.05);
    const dashGeo = new THREE.BoxGeometry(w * 0.78, 0.26, 0.36);
    const seatGeo = new THREE.BoxGeometry(0.46, 0.55, 0.42);
    const wheelRimGeo = new THREE.TorusGeometry(0.17, 0.025, 8, 16);
    const lightGeo = new THREE.BoxGeometry(0.24, 0.14, 0.08);
    const wheelGeo = new THREE.CylinderGeometry(0.54, 0.54, 0.4, 14);
    wheelGeo.rotateZ(Math.PI / 2);

    [
      lowerHullGeo,
      hoodGeo,
      doorSillGeo,
      rearBulkheadGeo,
      pillarGeo,
      roofGeo,
      windGeo,
      dashGeo,
      seatGeo,
      wheelRimGeo,
      lightGeo,
      wheelGeo,
    ].forEach((g) => this.resourceManager.registerGeometry(g, scope));

    const lowerHull = new THREE.Mesh(lowerHullGeo, bodyMat);
    lowerHull.position.y = 0.82;
    lowerHull.castShadow = true;
    lowerHull.receiveShadow = true;
    root.add(lowerHull);

    const hood = new THREE.Mesh(hoodGeo, bodyMat);
    hood.position.set(0, 1.24, -l * 0.33);
    hood.castShadow = true;
    hood.receiveShadow = true;
    root.add(hood);

    const cabCenterZ = isHeavy ? -0.95 : -0.22;
    const cabHalfZ = l * 0.21;

    // Side door sills & interior seats/dashboard
    for (const sx of [-w * 0.43, w * 0.43]) {
      const doorSill = new THREE.Mesh(doorSillGeo, bodyMat);
      doorSill.position.set(sx, 1.32, cabCenterZ);
      doorSill.castShadow = true;
      root.add(doorSill);
    }

    const rearDeck = new THREE.Mesh(rearBulkheadGeo, bodyMat);
    rearDeck.position.set(0, 1.38, l * 0.31);
    rearDeck.castShadow = true;
    root.add(rearDeck);

    // Rollcage / A-B pillars supporting roof canopy cleanly without occluding forward windshield
    const pillarZPositions = [cabCenterZ - cabHalfZ + 0.08, cabCenterZ + cabHalfZ - 0.08];
    const pillarXPositions = [-w * 0.41, w * 0.41];
    for (const pz of pillarZPositions) {
      for (const px of pillarXPositions) {
        const pillar = new THREE.Mesh(pillarGeo, trimMat);
        pillar.position.set(px, 1.78, pz);
        pillar.castShadow = true;
        root.add(pillar);
      }
    }

    // Overhead roof plate (hidden automatically only while in Driver FPV so looking up/around stays clear)
    const roof = new THREE.Mesh(roofGeo, bodyMat);
    roof.position.set(0, 2.26, cabCenterZ);
    roof.castShadow = true;
    root.add(roof);
    fpvHiddenMeshes.push(roof);

    // Transparent armored glass windshield
    const windshield = new THREE.Mesh(windGeo, glassMat);
    windshield.position.set(0, 1.82, cabCenterZ - cabHalfZ + 0.05);
    windshield.rotation.x = 0.22;
    windshield.renderOrder = 2;
    root.add(windshield);

    // Interior dashboard, seats, and steering wheel
    const dash = new THREE.Mesh(dashGeo, interiorMat);
    dash.position.set(0, 1.36, cabCenterZ - cabHalfZ + 0.24);
    root.add(dash);

    const driverX = isHeavy ? -0.52 : -0.44;
    for (const sx of [driverX, -driverX]) {
      const seat = new THREE.Mesh(seatGeo, interiorMat);
      seat.position.set(sx, 1.36, cabCenterZ + 0.16);
      root.add(seat);
    }

    const steeringWheel = new THREE.Mesh(wheelRimGeo, trimMat);
    steeringWheel.position.set(driverX, 1.5, cabCenterZ - cabHalfZ + 0.36);
    steeringWheel.rotation.x = -0.52;
    root.add(steeringWheel);

    // Headlights at front bumper (-Z)
    for (const lx of [-w * 0.33, w * 0.33]) {
      const hl = new THREE.Mesh(lightGeo, headlightMat);
      hl.position.set(lx, 1.02, -l * 0.5 - 0.02);
      root.add(hl);
    }

    const zOffsets = isHeavy ? [-1.85, 0, 1.85] : [-1.45, 1.45];
    for (const wz of zOffsets) {
      for (const wx of [-w * 0.48, w * 0.48]) {
        const wheel = new THREE.Mesh(wheelGeo, tireMat);
        wheel.position.set(wx, 0.54, wz);
        wheel.castShadow = true;
        root.add(wheel);
        wheels.push(wheel);
      }
    }

    // Roof turret mount + elevating gun assembly
    const turret = new THREE.Group();
    turret.rotation.order = 'YXZ';
    turret.position.set(0, 2.34, isHeavy ? 0.15 : 0.12);
    const turretGun = new THREE.Group();

    const baseGeo = new THREE.CylinderGeometry(0.42, 0.52, 0.24, 12);
    const cradleGeo = new THREE.BoxGeometry(0.28, 0.22, 0.48);
    const barrelGeo = new THREE.CylinderGeometry(0.055, 0.07, 1.6, 8);
    barrelGeo.rotateX(Math.PI / 2);
    [baseGeo, cradleGeo, barrelGeo].forEach((g) => this.resourceManager.registerGeometry(g, scope));

    turret.add(new THREE.Mesh(baseGeo, gunMat));
    turretGun.position.set(0, 0.16, 0);
    turretGun.add(new THREE.Mesh(cradleGeo, gunMat));
    const barrel = new THREE.Mesh(barrelGeo, gunMat);
    barrel.position.set(0, 0.02, -0.82);
    turretGun.add(barrel);
    turret.add(turretGun);
    root.add(turret);
    fpvHiddenMeshes.push(turret);

    const driverSeatLocal = new THREE.Vector3(driverX, isHeavy ? 1.98 : 1.76, cabCenterZ - 0.05);
    const turretOpticLocal = new THREE.Vector3(0, 2.74, turret.position.z);

    return {
      root,
      wheels,
      turret,
      turretGun,
      driverSeatLocal,
      turretOpticLocal,
      fpvHiddenMeshes,
    };
  }
}
