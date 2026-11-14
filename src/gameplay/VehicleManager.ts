import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER, SpatialAABB } from '@/src/physics/SpatialHash';
import {
  AUTHORITATIVE_COMBAT_CONFIG,
  DIFFICULTY_COMBAT_PROFILES,
  ENEMY_WEAPON_PROFILES,
  EnemyAwarenessState,
} from '@/src/schemas/combat.schema';
import { Difficulty } from '@/src/schemas/common.schema';
import { MiniMapBlip } from '@/src/schemas/events.schema';
import { VehicleType } from '@/src/schemas/mission.schema';
import { BallisticSolver } from './BallisticSolver';
import { CombatEngagementCoordinator } from './CombatEngagementCoordinator';
import { CombatTelemetryRecorder, EnemyDebugInspectorRow } from './CombatTelemetryRecorder';
import { PlayerController } from './PlayerController';
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
  waypointIndex: number;
  collider: SpatialAABB;
  meshRoot: THREE.Group;
  wheels: THREE.Object3D[];
  turret: THREE.Object3D;
}

export class VehicleManager {
  private vehicles: VehicleEntity[] = [];
  private seq = 0;
  private difficulty: Difficulty = 'normal';
  private readonly _muzzlePos = new THREE.Vector3();
  private readonly _turretDir = new THREE.Vector3();
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
    rig.root.rotation.y = yaw;
    this.scene.add(rig.root);
    this.resourceManager.register('object3d', scope, () => this.scene.remove(rig.root));

    const id = `veh_${++this.seq}`;
    const squadId = hostile ? 'squad_armor_convoy' : 'squad_friendly';
    if (hostile) {
      this.coordinator?.registerUnit(id, squadId);
    }

    const isHeavy = type === 'armored_truck' || type === 'enemy_apc';
    const halfW = isHeavy ? 1.45 : 1.2;
    const halfL = isHeavy ? 2.8 : 2.2;
    const collider: SpatialAABB = {
      id: `collider_${id}`,
      minX: pos.x - halfW,
      minY: y,
      minZ: pos.z - halfL,
      maxX: pos.x + halfW,
      maxY: y + 2.35,
      maxZ: pos.z + halfL,
      layer: COLLISION_LAYER.VEHICLE,
    };
    collision.spatialHash.insert(collider);

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
      waypointIndex: 0,
      collider,
      meshRoot: rig.root,
      wheels: rig.wheels,
      turret: rig.turret,
    });
  }

  private syncVehicleCollider(v: VehicleEntity, collision: CollisionWorld): void {
    const isHeavy = v.type === 'armored_truck' || v.type === 'enemy_apc';
    const halfW = isHeavy ? 1.45 : 1.2;
    const halfL = isHeavy ? 2.2 : 1.8;
    v.collider.minX = v.position.x - halfW;
    v.collider.maxX = v.position.x + halfW;
    v.collider.minY = v.position.y;
    v.collider.maxY = v.position.y + 2.35;
    v.collider.minZ = v.position.z - halfL;
    v.collider.maxZ = v.position.z + halfL;
    collision.spatialHash.update(v.collider);
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

  togglePlayerVehicle(player: PlayerController): boolean {
    const current = this.getPlayerVehicle();
    if (current) {
      current.occupiedByPlayer = false;
      current.speed *= 0.25;
      player.position.set(
        current.position.x + Math.cos(current.yaw) * 3.0,
        current.position.y,
        current.position.z - Math.sin(current.yaw) * 3.0
      );
      this.audio.play2D('ui_click', 4, 0.45);
      return false;
    }

    const near = this.getNearestInteractableVehicle(player.position);
    if (near) {
      near.occupiedByPlayer = true;
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
      veh.health = 0;
      veh.alive = false;
      veh.occupiedByPlayer = false;
      veh.state = 'DEAD';
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
        if (c instanceof THREE.Mesh && c.material instanceof THREE.MeshStandardMaterial) {
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
    onConvoyDestroyed?: (v: VehicleEntity) => void
  ): void {
    const nowSec = this.telemetry?.getElapsedSec() ?? 0;
    const diffProf = DIFFICULTY_COMBAT_PROFILES[this.difficulty];

    for (const v of this.vehicles) {
      if (!v.alive) continue;

      v.turretFireCooldown = Math.max(0, v.turretFireCooldown - dt);

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

        const nextX = Math.max(-104, Math.min(104, v.position.x - Math.sin(v.yaw) * v.speed * dt));
        const nextZ = Math.max(-104, Math.min(104, v.position.z - Math.cos(v.yaw) * v.speed * dt));
        v.position.set(nextX, collision.getGroundHeightAt(nextX, nextZ), nextZ);
        this.syncVehicleCollider(v, collision);
        player.position.copy(v.position);

        v.meshRoot.position.copy(v.position);
        v.meshRoot.rotation.y = v.yaw;
        const targetRoll = axes.right * 0.055 * Math.min(1, Math.abs(v.speed) / 14);
        const targetPitch = -axes.forward * 0.036;
        v.chassisRoll = THREE.MathUtils.lerp(v.chassisRoll, targetRoll, Math.min(1, dt * 8));
        v.chassisPitch = THREE.MathUtils.lerp(v.chassisPitch, targetPitch, Math.min(1, dt * 8));
        v.meshRoot.rotation.z = v.chassisRoll;
        v.meshRoot.rotation.x = v.chassisPitch;

        const camYaw = player.yaw;
        const camDist = 8.4;
        const camH = 3.6 + Math.sin(player.pitch) * 1.4;
        camera.position.set(
          v.position.x + Math.sin(camYaw) * camDist,
          v.position.y + camH,
          v.position.z + Math.cos(camYaw) * camDist
        );
        camera.lookAt(v.position.x, v.position.y + 1.5, v.position.z);

        v.turret.rotation.y = camYaw - v.yaw;
        if (input.isMouseHeld(0) && v.turretFireCooldown <= 0) {
          v.turretFireCooldown = 0.12;
          camera.getWorldDirection(this._turretDir);
          this._muzzlePos.set(v.position.x, v.position.y + 2.45, v.position.z);
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
            v.position.x += (dx / distWp) * v.speed * dt;
            v.position.z += (dz / distWp) * v.speed * dt;
            v.position.y = collision.getGroundHeightAt(v.position.x, v.position.z);
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
    this.vehicles = [];
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
  ): { root: THREE.Group; wheels: THREE.Object3D[]; turret: THREE.Object3D } {
    const root = new THREE.Group();
    const wheels: THREE.Object3D[] = [];

    const bodyColor = hostile ? (type === 'enemy_apc' ? 0x4b3b34 : 0x57534e) : 0x3b4936;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.65, metalness: 0.35 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.9 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: hostile ? 0xef4444 : 0x38bdf8,
      emissive: hostile ? 0x991b1b : 0x0369a1,
      emissiveIntensity: 0.35,
      metalness: 0.8,
      roughness: 0.15,
    });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.3 });

    [bodyMat, tireMat, glassMat, gunMat].forEach((m) => this.resourceManager.registerMaterial(m, scope));

    const isHeavy = type === 'armored_truck' || type === 'enemy_apc';
    const w = isHeavy ? 2.8 : 2.3;
    const l = isHeavy ? 5.6 : 4.4;

    const chassisGeo = new THREE.BoxGeometry(w, 1.0, l);
    const cabinGeo = new THREE.BoxGeometry(w * 0.86, 0.95, l * 0.48);
    const windGeo = new THREE.BoxGeometry(w * 0.78, 0.55, 0.12);
    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.42, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    [chassisGeo, cabinGeo, windGeo, wheelGeo].forEach((g) => this.resourceManager.registerGeometry(g, scope));

    const chassis = new THREE.Mesh(chassisGeo, bodyMat);
    chassis.position.y = 0.95;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    root.add(chassis);

    const cabin = new THREE.Mesh(cabinGeo, bodyMat);
    cabin.position.set(0, 1.85, -0.2);
    cabin.castShadow = true;
    root.add(cabin);

    const windshield = new THREE.Mesh(windGeo, glassMat);
    windshield.position.set(0, 1.9, -0.2 - l * 0.24);
    root.add(windshield);

    const zOffsets = isHeavy ? [-1.8, 0, 1.8] : [-1.45, 1.45];
    for (const wz of zOffsets) {
      for (const wx of [-w * 0.52, w * 0.52]) {
        const wheel = new THREE.Mesh(wheelGeo, tireMat);
        wheel.position.set(wx, 0.55, wz);
        wheel.castShadow = true;
        root.add(wheel);
        wheels.push(wheel);
      }
    }

    const turret = new THREE.Group();
    turret.position.set(0, 2.45, 0.1);
    const baseGeo = new THREE.CylinderGeometry(0.45, 0.55, 0.28, 10);
    const barrelGeo = new THREE.CylinderGeometry(0.06, 0.07, 1.6, 8);
    barrelGeo.rotateX(Math.PI / 2);
    this.resourceManager.registerGeometry(baseGeo, scope);
    this.resourceManager.registerGeometry(barrelGeo, scope);

    turret.add(new THREE.Mesh(baseGeo, gunMat));
    const barrel = new THREE.Mesh(barrelGeo, gunMat);
    barrel.position.set(0, 0.1, -0.75);
    turret.add(barrel);
    root.add(turret);

    return { root, wheels, turret };
  }
}
