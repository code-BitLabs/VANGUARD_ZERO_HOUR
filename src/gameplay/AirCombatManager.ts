import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { formatCollisionLayer } from '@/src/engine/physics/PhysicsLayers';
import type { PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import {
  AUTHORITATIVE_COMBAT_CONFIG,
  DIFFICULTY_COMBAT_PROFILES,
  ENEMY_WEAPON_PROFILES,
  EnemyAwarenessState,
} from '@/src/schemas/combat.schema';
import { Difficulty } from '@/src/schemas/common.schema';
import { MiniMapBlip } from '@/src/schemas/events.schema';
import {
  AIR_FLIGHT_PROFILES,
  AirFlightProfile,
} from '@/src/schemas/explosive.schema';
import { AirUnitType } from '@/src/schemas/mission.schema';
import { BallisticSolver } from './BallisticSolver';
import { CombatEngagementCoordinator } from './CombatEngagementCoordinator';
import {
  CombatTelemetryRecorder,
  EnemyDebugInspectorRow,
  FlightTelemetrySample,
} from './CombatTelemetryRecorder';
import { PlayerController } from './PlayerController';
import { HitscanTarget } from './WeaponSystem';

export type AirFlightPhase =
  | 'CRUISE'
  | 'DECELERATE'
  | 'HOVER_LOITER'
  | 'REPOSITION'
  | 'APPROACH'
  | 'STRAFE_PASS'
  | 'STANDOFF_HOVER'
  | 'INBOUND_APPROACH'
  | 'ATTACK_PASS'
  | 'CLIMB_EGRESS'
  | 'WIDE_TURN';

export interface AirUnit {
  id: string;
  squadId: string;
  type: AirUnitType;
  displayName: string;
  profile: AirFlightProfile;
  alive: boolean;
  crashing: boolean;
  health: number;
  maxHealth: number;
  altitude: number;
  orbitRadius: number;
  orbitAngle: number;
  flightPhase: AirFlightPhase;
  phaseTimerSec: number;
  flightTimeSec: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  waypoint: THREE.Vector3;
  headingYaw: number;
  rollBankRad: number;
  pitchRad: number;
  lastTurnRateDegPerSec: number;
  lastAccelMag: number;
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
  fireTimer: number;
  burstShotsRemaining: number;
  burstShotIndex: number;
  ammoInMag: number;
  magSize: number;
  isReloading: boolean;
  reloadTimerSec: number;
  lastSpreadRad: number;
  lastDamageDealt: number;
  lastDamageTimeSec: number | null;
  crashTimer: number;
  meshRoot: THREE.Group;
  rotor: THREE.Object3D | null;
}

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export class AirCombatManager {
  private units: AirUnit[] = [];
  private seq = 0;
  private difficulty: Difficulty = 'normal';
  private readonly _muzzlePos = new THREE.Vector3();
  private readonly _toWaypoint = new THREE.Vector3();
  private readonly _desiredVel = new THREE.Vector3();

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

  getUnits(): readonly AirUnit[] {
    return this.units;
  }

  spawnUnit(
    type: AirUnitType,
    altitude: number,
    orbitRadius: number,
    startAngle: number,
    scope: ResourceScope
  ): void {
    const profile = AIR_FLIGHT_PROFILES[type];
    const rig = this.buildAirRig(type, scope);
    const effectiveRadius = Math.max(orbitRadius, profile.minTurnRadiusMeters * 0.75);
    const x = Math.cos(startAngle) * effectiveRadius;
    const z = Math.sin(startAngle) * effectiveRadius;
    const headingYaw = startAngle + Math.PI * 0.5;

    rig.root.position.set(x, altitude, z);
    this.scene.add(rig.root);
    this.resourceManager.register('object3d', scope, () => this.scene.remove(rig.root));

    const id = `air_${++this.seq}`;
    const squadId = 'squad_air_wing';
    this.coordinator?.registerUnit(id, squadId);

    const diffProf = DIFFICULTY_COMBAT_PROFILES[this.difficulty];
    const weaponProf = ENEMY_WEAPON_PROFILES.enemy_autocannon;

    const initialPhase: AirFlightPhase =
      type === 'fighter_jet' || type === 'transport'
        ? 'INBOUND_APPROACH'
        : type === 'attack_drone'
          ? 'CRUISE'
          : 'APPROACH';

    const initVel = new THREE.Vector3(
      Math.sin(headingYaw) * profile.initialSpeed,
      0,
      Math.cos(headingYaw) * profile.initialSpeed
    );

    const nextAngle = startAngle + 0.85;
    const wp = new THREE.Vector3(
      Math.cos(nextAngle) * effectiveRadius,
      altitude,
      Math.sin(nextAngle) * effectiveRadius
    );

    this.units.push({
      id,
      squadId,
      type,
      displayName: profile.displayName,
      profile,
      alive: true,
      crashing: false,
      health: profile.maxHealth,
      maxHealth: profile.maxHealth,
      altitude,
      orbitRadius: effectiveRadius,
      orbitAngle: startAngle,
      flightPhase: initialPhase,
      phaseTimerSec: 3.5,
      flightTimeSec: 0,
      position: new THREE.Vector3(x, altitude, z),
      velocity: initVel,
      waypoint: wp,
      headingYaw,
      rollBankRad: 0,
      pitchRad: 0,
      lastTurnRateDegPerSec: 0,
      lastAccelMag: 0,
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
      initialGraceTimerSec: diffProf.airInitialGraceSec + (this.seq % 3) * 0.65,
      reactionTimerSec: 0,
      fireTimer: 1.4 + (this.seq % 4) * 0.45,
      burstShotsRemaining: 0,
      burstShotIndex: 0,
      ammoInMag: weaponProf.magazineSize,
      magSize: weaponProf.magazineSize,
      isReloading: false,
      reloadTimerSec: 0,
      lastSpreadRad: weaponProf.baseSpreadRad,
      lastDamageDealt: 0,
      lastDamageTimeSec: null,
      crashTimer: 0,
      meshRoot: rig.root,
      rotor: rig.rotor,
    });
  }

  spawnDynamicDrone(x: number, y: number, z: number, scope: ResourceScope): void {
    const angle = Math.atan2(z, x);
    this.spawnUnit('attack_drone', Math.max(10, y), Math.max(18, Math.hypot(x, z)), angle, scope);
  }

  damageUnit(unit: AirUnit, damage: number, onAirKilled?: (u: AirUnit) => void): boolean {
    if (!unit.alive || unit.crashing) return false;
    unit.health -= damage;
    if (unit.health <= 0) {
      const prevState = unit.state;
      unit.health = 0;
      unit.alive = false;
      unit.crashing = true;
      unit.state = 'DEAD';
      unit.crashTimer = 0;
      this.telemetry?.recordStateTransition(unit.id, unit.squadId, 'air', prevState, 'DEAD');
      this.coordinator?.notifyUnitDisabled(unit.id, unit.squadId, 'air', 'death');
      this.vfx.spawnExplosion(unit.position.x, unit.position.y, unit.position.z, 1.5);
      this.audio.playSpatial('explosion', unit.position.x, unit.position.y, unit.position.z, 8, 0.9);
      onAirKilled?.(unit);
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
    onAirKilled?: (u: AirUnit) => void
  ): void {
    for (const u of this.units) {
      if (!u.alive || u.crashing) continue;
      const dist = Math.hypot(u.position.x - x, u.position.y - y, u.position.z - z);
      if (dist <= radius + 3.2) {
        const falloff = Math.max(0.35, 1 - dist / (radius + 3.5));
        this.damageUnit(u, damage * falloff, onAirKilled);
      }
    }
  }

  getHitscanTargets(onAirHit: (unit: AirUnit, killed: boolean) => void): HitscanTarget[] {
    return this.units
      .filter((u) => u.alive && !u.crashing)
      .map((u) => ({
        id: u.id,
        kind: 'air',
        name: u.displayName,
        alive: u.alive,
        position: u.position,
        hitRadius: u.type === 'attack_drone' ? 1.5 : u.type === 'gunship' ? 4.4 : 3.2,
        onHit: (damage) => {
          const killed = this.damageUnit(u, damage);
          onAirHit(u, killed);
        },
      }));
  }

  getLockCandidates(): Array<{ id: string; alive: boolean; position: THREE.Vector3; label: string }> {
    return this.units
      .filter((u) => u.alive && !u.crashing)
      .map((u) => ({
        id: u.id,
        alive: u.alive,
        position: u.position,
        label: u.displayName.toUpperCase(),
      }));
  }

  getPositionsForProximity(): Array<{ position: THREE.Vector3; radius: number }> {
    return this.units
      .filter((u) => u.alive && !u.crashing)
      .map((u) => ({
        position: u.position,
        radius: u.type === 'attack_drone' ? 1.8 : 3.8,
      }));
  }

  getActiveBossInfo(context?: {
    playerPosition?: THREE.Vector3;
    isPrimaryObjective?: boolean;
    lockStatus?: 'none' | 'scanning' | 'acquiring' | 'locked';
  }): { label: string; healthPct: number } | null {
    const boss = this.units.find((u) => u.alive && !u.crashing && (u.type === 'gunship' || u.type === 'helicopter'));
    if (!boss) return null;

    if (context) {
      const nowSec = this.telemetry?.getElapsedSec() ?? 0;
      const damaged = boss.health < boss.maxHealth;
      const activelyAttackingPlayer =
        boss.lastDamageDealt > 0 &&
        boss.lastDamageTimeSec !== null &&
        nowSec - boss.lastDamageTimeSec <= 8;
      const lockedOn = context.lockStatus === 'acquiring' || context.lockStatus === 'locked';
      const primaryObj = Boolean(context.isPrimaryObjective);

      if (!damaged && !activelyAttackingPlayer && !lockedOn && !primaryObj) {
        return null;
      }
    }

    return {
      label: boss.displayName.toUpperCase(),
      healthPct: boss.health / boss.maxHealth,
    };
  }

  getMiniMapBlips(): MiniMapBlip[] {
    return this.units
      .filter((u) => u.alive)
      .map((u) => ({ id: u.id, x: u.position.x, z: u.position.z, kind: 'air' }));
  }

  update(rawDt: number, player: PlayerController, collision?: CollisionWorld): void {
    const dt = Math.min(rawDt, 0.05);
    const nowSec = this.telemetry?.getElapsedSec() ?? 0;
    const diffProf = DIFFICULTY_COMBAT_PROFILES[this.difficulty];
    const weaponProf = ENEMY_WEAPON_PROFILES.enemy_autocannon;

    for (const u of this.units) {
      if (u.rotor) {
        u.rotor.rotation.y += dt * (u.crashing ? 6 : 24);
      }

      if (u.crashing) {
        u.crashTimer += dt;
        u.velocity.y -= 13.5 * dt;
        u.position.addScaledVector(u.velocity, dt);
        u.meshRoot.position.copy(u.position);
        u.meshRoot.rotation.z += dt * 2.2;
        u.meshRoot.rotation.x += dt * 1.4;
        const crashFloorY = collision
          ? Math.max(0.5, collision.getMaxObstacleHeightInArea(u.position.x, u.position.z, 2.2) + 0.5)
          : 0.5;
        if (u.position.y <= crashFloorY) {
          u.crashing = false;
          u.meshRoot.visible = false;
          this.vfx.spawnExplosion(u.position.x, crashFloorY, u.position.z, 2.0);
        }
        continue;
      }

      if (!u.alive) continue;

      u.flightTimeSec += dt;
      this.stepAircraftKinematics(u, dt, player, collision);

      if (u.type === 'transport') continue;

      // Respect initial air reconnaissance grace timer so aircraft never shred the player at t = 0
      if (u.initialGraceTimerSec > 0) {
        u.initialGraceTimerSec = Math.max(0, u.initialGraceTimerSec - dt);
        continue;
      }

      if (u.isReloading) {
        u.reloadTimerSec -= dt;
        if (u.reloadTimerSec <= 0) {
          u.isReloading = false;
          u.ammoInMag = u.magSize;
        }
      }

      const dist = u.position.distanceTo(player.position);
      let rawLos = false;
      let exposedTargetPoint = player.position;
      let blockerId: string | null = null;

      if (player.alive && dist <= 115 && collision && this.ballistics) {
        const losRes = this.ballistics.checkLineOfSight(
          u.position.x,
          u.position.y - 0.6,
          u.position.z,
          player,
          collision,
          115
        );
        rawLos = losRes.visible;
        exposedTargetPoint = losRes.exposedPoint;
        blockerId = losRes.blockerId;
      } else if (player.alive && dist <= 115 && !collision) {
        rawLos = true;
      }

      const prevLos = u.hasLos;
      const prevState = u.state;
      u.hasLos = rawLos;
      u.losBlockerId = blockerId;

      if (rawLos) {
        if (!prevLos && u.obstructionStartSec !== null) {
          const recovSec = Number(Math.max(0, nowSec - u.obstructionStartSec).toFixed(2));
          u.lastLosRecoverySec = recovSec;
          u.obstructionStartSec = null;
          if (recovSec > 0.05) {
            this.telemetry?.recordEvent(
              'ALERT_STATE',
              u.id,
              u.squadId,
              'air',
              `${u.displayName} recovered LOS after ${recovSec.toFixed(2)}s`
            );
          }
        }
        u.losLostDurationSec = 0;
        if (!u.lastKnownPosition) u.lastKnownPosition = new THREE.Vector3();
        u.lastKnownPosition.copy(exposedTargetPoint);
        u.lkpTimestampSec = nowSec;
        if (!u.detectedPlayer) {
          u.detectedPlayer = true;
          this.telemetry?.recordEvent(
            'DETECTED',
            u.id,
            u.squadId,
            'air',
            `${u.displayName} acquired visual on player at ${dist.toFixed(0)}m`
          );
        }
        if (u.state === 'UNAWARE' || u.state === 'SEARCHING') {
          u.state = 'ALERTED';
          u.reactionTimerSec = diffProf.reactionDelayBaseSec + 0.25;
        }
      } else {
        u.losLostDurationSec += dt;
        if (prevLos) {
          u.obstructionStartSec = nowSec;
          this.telemetry?.recordEvent(
            'LOST_LOS',
            u.id,
            u.squadId,
            'air',
            `${u.displayName} lost visual contact (blocked by ${blockerId ?? 'cover'})`
          );
        }
        if (u.state === 'ENGAGING' || u.state === 'ALERTED') {
          if (u.losLostDurationSec >= AUTHORITATIVE_COMBAT_CONFIG.losGraceSec) {
            this.coordinator?.releaseLease(u.id, 'air_lost_los');
            u.state = 'SEARCHING';
          }
        }
      }

      if (u.state === 'ALERTED') {
        u.reactionTimerSec = Math.max(0, u.reactionTimerSec - dt);
        if (u.reactionTimerSec <= 0 && rawLos) {
          const leaseKind = u.type === 'gunship' ? 'HEAVY' : 'DIRECT';
          const granted =
            this.coordinator?.requestLease({
              unitId: u.id,
              squadId: u.squadId,
              domain: 'air',
              role: 'air_strike',
              kind: leaseKind,
              distanceMeters: dist,
              hasLos: true,
              isWeaponReady: !u.isReloading,
            }) ?? true;
          if (granted) {
            u.state = 'ENGAGING';
          }
        }
      }

      if (u.state !== prevState) {
        this.telemetry?.recordStateTransition(u.id, u.squadId, 'air', prevState, u.state);
      }

      u.fireTimer = Math.max(0, u.fireTimer - dt);
      const lease = this.coordinator?.getUnitLease(u.id);
      const allowedToFire =
        u.state === 'ENGAGING' &&
        rawLos &&
        !u.isReloading &&
        player.alive &&
        (Boolean(lease) || !this.coordinator);

      if (
        u.state === 'ENGAGING' &&
        !rawLos &&
        !u.isReloading &&
        player.alive &&
        u.fireTimer <= 0
      ) {
        u.blockedShotAttempts++;
        u.fireTimer = 0.25;
        this.telemetry?.recordEvent(
          'SHOT_BLOCKED_COVER',
          u.id,
          u.squadId,
          'air',
          `${u.displayName} shot blocked during grace (blocker=${blockerId ?? 'cover'})`
        );
      }

      if (allowedToFire && u.fireTimer <= 0 && collision && this.ballistics) {
        if (u.burstShotsRemaining <= 0) {
          u.burstShotsRemaining = Math.min(u.ammoInMag, u.type === 'attack_drone' ? 3 : 4);
          u.burstShotIndex = 0;
        }

        this._muzzlePos.set(u.position.x, u.position.y - 0.6, u.position.z);
        const shotRes = this.ballistics.fireWeaponRay(
          {
            unitId: u.id,
            squadId: u.squadId,
            domain: 'air',
            weaponClass: 'enemy_autocannon',
            muzzleOrigin: this._muzzlePos,
            aimTarget: exposedTargetPoint,
            distanceMeters: dist,
            unitAccuracy: u.type === 'gunship' ? 0.58 : 0.48,
            isMoving: u.velocity.length() > 1.5,
            aimDurationSec: 0.4,
            burstShotIndex: u.burstShotIndex,
            isSuppressedOrStaggered: false,
            isSuppressionFire: false,
            difficultyProfile: diffProf,
          },
          player,
          collision
        );

        this.audio.playSpatial('shot_lmg', u.position.x, u.position.y, u.position.z, 4, 0.45);
        u.lastSpreadRad = shotRes.spreadRad;
        if (shotRes.hitPlayer && shotRes.damageApplied > 0) {
          u.lastDamageDealt = shotRes.damageApplied;
          u.lastDamageTimeSec = nowSec;
        }

        u.ammoInMag--;
        u.burstShotsRemaining--;
        u.burstShotIndex++;

        if (u.ammoInMag <= 0) {
          u.isReloading = true;
          u.reloadTimerSec = weaponProf.reloadDurationSec;
          this.coordinator?.releaseLease(u.id, 'air_reload');
        } else if (u.burstShotsRemaining > 0) {
          u.fireTimer = weaponProf.shotIntervalSec;
        } else {
          u.fireTimer =
            (u.type === 'gunship' ? 1.5 : u.type === 'attack_drone' ? 1.8 : 2.1) *
            diffProf.burstPauseMultiplier;
          this.coordinator?.releaseLease(u.id, 'air_strafe_complete', true);
          const beforeCooldown = u.state;
          u.state = 'ALERTED';
          u.reactionTimerSec = 0.65;
          this.telemetry?.recordStateTransition(u.id, u.squadId, 'air', beforeCooldown, 'ALERTED');
        }
      }
    }
  }

  private stepAircraftKinematics(
    u: AirUnit,
    dt: number,
    player: PlayerController,
    collision?: CollisionWorld
  ): void {
    const prof = u.profile;
    u.phaseTimerSec -= dt;

    let targetSpeed = prof.cruiseSpeed;
    let aimYawAtPlayer = false;

    if (u.type === 'attack_drone') {
      if (u.flightPhase === 'CRUISE') {
        targetSpeed = prof.cruiseSpeed;
        if (u.position.distanceTo(u.waypoint) < 8 || u.phaseTimerSec <= 0) {
          u.flightPhase = 'DECELERATE';
          u.phaseTimerSec = 0.9;
        }
      } else if (u.flightPhase === 'DECELERATE') {
        targetSpeed = 0.8;
        if (u.phaseTimerSec <= 0 || u.velocity.length() < 1.6) {
          u.flightPhase = 'HOVER_LOITER';
          u.phaseTimerSec =
            prof.hoverDurationMinSec +
            Math.random() * (prof.hoverDurationMaxSec - prof.hoverDurationMinSec);
        }
      } else if (u.flightPhase === 'HOVER_LOITER') {
        targetSpeed = 0.4;
        aimYawAtPlayer = true;
        if (u.phaseTimerSec <= 0) {
          u.flightPhase = 'REPOSITION';
          u.phaseTimerSec = 4.2;
          u.orbitAngle += 0.9 + Math.random() * 0.7;
          u.waypoint.set(
            Math.cos(u.orbitAngle) * u.orbitRadius,
            u.altitude + (Math.random() - 0.5) * 3.0,
            Math.sin(u.orbitAngle) * u.orbitRadius
          );
        }
      } else {
        targetSpeed = prof.maxSpeed * 0.88;
        if (u.position.distanceTo(u.waypoint) < 9 || u.phaseTimerSec <= 0) {
          u.flightPhase = 'CRUISE';
          u.phaseTimerSec = 2.6;
        }
      }
    } else if (u.type === 'helicopter' || u.type === 'gunship') {
      if (u.flightPhase === 'APPROACH') {
        targetSpeed = prof.maxSpeed * 0.86;
        if (u.position.distanceTo(u.waypoint) < 14 || u.phaseTimerSec <= 0) {
          u.flightPhase = 'STRAFE_PASS';
          u.phaseTimerSec = 4.4;
          u.orbitAngle += 0.72;
          u.waypoint.set(
            Math.cos(u.orbitAngle) * u.orbitRadius,
            u.altitude,
            Math.sin(u.orbitAngle) * u.orbitRadius
          );
        }
      } else if (u.flightPhase === 'STRAFE_PASS') {
        targetSpeed = prof.cruiseSpeed;
        aimYawAtPlayer = true;
        if (u.phaseTimerSec <= 0 || u.position.distanceTo(u.waypoint) < 12) {
          u.flightPhase = 'STANDOFF_HOVER';
          u.phaseTimerSec =
            prof.hoverDurationMinSec +
            Math.random() * (prof.hoverDurationMaxSec - prof.hoverDurationMinSec);
        }
      } else {
        targetSpeed = 1.2;
        aimYawAtPlayer = true;
        if (u.phaseTimerSec <= 0) {
          u.flightPhase = 'APPROACH';
          u.phaseTimerSec = 5.0;
          u.orbitAngle += 0.85;
          u.waypoint.set(
            Math.cos(u.orbitAngle) * u.orbitRadius,
            u.altitude + (Math.random() - 0.5) * 4.0,
            Math.sin(u.orbitAngle) * u.orbitRadius
          );
        }
      }
    } else {
      // Fighter Jets & Cargo Transports: wide approach -> attack pass -> climb egress -> wide turn
      const wideRadius = Math.max(u.orbitRadius, prof.minTurnRadiusMeters);
      if (u.flightPhase === 'INBOUND_APPROACH') {
        targetSpeed = prof.cruiseSpeed;
        if (u.position.distanceTo(u.waypoint) < 22 || u.phaseTimerSec <= 0) {
          u.flightPhase = 'ATTACK_PASS';
          u.phaseTimerSec = 3.2;
          // Pass across battle zone toward opposite side
          u.waypoint.set(
            player.position.x + Math.sin(u.headingYaw) * 95,
            Math.max(22, u.altitude - 4),
            player.position.z + Math.cos(u.headingYaw) * 95
          );
        }
      } else if (u.flightPhase === 'ATTACK_PASS') {
        targetSpeed = prof.maxSpeed;
        if (u.phaseTimerSec <= 0) {
          u.flightPhase = 'CLIMB_EGRESS';
          u.phaseTimerSec = 3.4;
          u.waypoint.set(
            Math.cos(u.orbitAngle + 1.4) * wideRadius,
            u.altitude + 12,
            Math.sin(u.orbitAngle + 1.4) * wideRadius
          );
        }
      } else if (u.flightPhase === 'CLIMB_EGRESS') {
        targetSpeed = prof.cruiseSpeed * 0.94;
        if (u.phaseTimerSec <= 0) {
          u.flightPhase = 'WIDE_TURN';
          u.phaseTimerSec = 5.5;
          u.orbitAngle += 2.1;
          u.waypoint.set(
            Math.cos(u.orbitAngle) * wideRadius,
            u.altitude,
            Math.sin(u.orbitAngle) * wideRadius
          );
        }
      } else {
        targetSpeed = prof.cruiseSpeed * 0.86;
        if (u.phaseTimerSec <= 0 || u.position.distanceTo(u.waypoint) < 28) {
          u.flightPhase = 'INBOUND_APPROACH';
          u.phaseTimerSec = 4.6;
          u.orbitAngle += 0.9;
          u.waypoint.set(
            player.position.x * 0.4 + Math.cos(u.orbitAngle) * (wideRadius * 0.55),
            u.altitude,
            player.position.z * 0.4 + Math.sin(u.orbitAngle) * (wideRadius * 0.55)
          );
        }
      }
    }

    // Steering direction & bounded angular turn rate
    this._toWaypoint.subVectors(u.waypoint, u.position);
    const desiredYaw =
      aimYawAtPlayer
        ? Math.atan2(player.position.x - u.position.x, player.position.z - u.position.z)
        : this._toWaypoint.lengthSq() > 1
          ? Math.atan2(this._toWaypoint.x, this._toWaypoint.z)
          : u.headingYaw;

    const yawDiff = wrapAngle(desiredYaw - u.headingYaw);
    const maxYawStep = THREE.MathUtils.degToRad(prof.maxTurnRateDegPerSec) * dt;
    const appliedYawStep = THREE.MathUtils.clamp(yawDiff, -maxYawStep, maxYawStep);
    u.headingYaw = wrapAngle(u.headingYaw + appliedYawStep);
    u.lastTurnRateDegPerSec = Math.abs(THREE.MathUtils.radToDeg(appliedYawStep / Math.max(dt, 0.0001)));

    // Desired velocity along movement vector (fixed-wing flies forward; VTOL flies toward waypoint)
    if (u.type === 'fighter_jet' || u.type === 'transport') {
      const distWp = Math.max(1, this._toWaypoint.length());
      const vyDesired = THREE.MathUtils.clamp((this._toWaypoint.y / distWp) * targetSpeed, -10, 10);
      const horizSpeed = Math.sqrt(Math.max(1, targetSpeed * targetSpeed - vyDesired * vyDesired));
      this._desiredVel.set(
        Math.sin(u.headingYaw) * horizSpeed,
        vyDesired,
        Math.cos(u.headingYaw) * horizSpeed
      );
    } else if (this._toWaypoint.lengthSq() > 0.25) {
      this._desiredVel.copy(this._toWaypoint).normalize().multiplyScalar(targetSpeed);
    } else {
      this._desiredVel.set(0, 0, 0);
    }

    // Smooth acceleration / deceleration toward desired velocity
    const curSpeed = u.velocity.length();
    const rate = targetSpeed >= curSpeed ? prof.acceleration : prof.deceleration;
    const dvX = this._desiredVel.x - u.velocity.x;
    const dvY = this._desiredVel.y - u.velocity.y;
    const dvZ = this._desiredVel.z - u.velocity.z;
    const dvLen = Math.hypot(dvX, dvY, dvZ);
    const maxDv = rate * dt;
    if (dvLen > maxDv && dvLen > 0.0001) {
      const scale = maxDv / dvLen;
      u.velocity.x += dvX * scale;
      u.velocity.y += dvY * scale;
      u.velocity.z += dvZ * scale;
      u.lastAccelMag = rate;
    } else {
      u.velocity.copy(this._desiredVel);
      u.lastAccelMag = dvLen / Math.max(dt, 0.0001);
    }

    // Enforce maxSpeed cap
    const postSpeed = u.velocity.length();
    if (postSpeed > prof.maxSpeed) {
      u.velocity.multiplyScalar(prof.maxSpeed / postSpeed);
    }

    u.position.addScaledVector(u.velocity, dt);
    const hoverBob =
      u.flightPhase === 'HOVER_LOITER' || u.flightPhase === 'STANDOFF_HOVER'
        ? Math.sin(u.flightTimeSec * 2.2) * 0.22 * dt
        : 0;

    let minSafeY = 8;
    if (collision) {
      const localRoofY = collision.getMaxObstacleHeightInArea(u.position.x, u.position.z, 6);
      const lookaheadRoofY = collision.getMaxObstacleHeightInArea(
        u.position.x + u.velocity.x * 1.2,
        u.position.z + u.velocity.z * 1.2,
        6
      );
      minSafeY = Math.max(8, Math.max(localRoofY, lookaheadRoofY) + 5.5);
      if (u.waypoint.y < minSafeY) {
        u.waypoint.y = minSafeY + 1.5;
      }
    }
    if (u.position.y + hoverBob < minSafeY) {
      u.position.y = THREE.MathUtils.lerp(u.position.y, minSafeY, Math.min(1, dt * 6));
      if (u.velocity.y < 0) u.velocity.y = 0;
    } else {
      u.position.y = u.position.y + hoverBob;
    }

    // Smooth roll banking & nose pitch based on turn rate and forward speed
    const turnSign = Math.sign(yawDiff);
    const turnRatio = Math.min(1, Math.abs(yawDiff) / 0.55);
    const targetBank = -turnSign * turnRatio * THREE.MathUtils.degToRad(prof.maxBankDeg);
    const targetPitch =
      u.type === 'fighter_jet' || u.type === 'transport'
        ? THREE.MathUtils.clamp(-u.velocity.y / Math.max(8, postSpeed), -0.35, 0.35)
        : (postSpeed / prof.maxSpeed) * THREE.MathUtils.degToRad(prof.maxPitchDeg);

    u.rollBankRad = THREE.MathUtils.lerp(u.rollBankRad, targetBank, Math.min(1, dt * 4.5));
    u.pitchRad = THREE.MathUtils.lerp(u.pitchRad, targetPitch, Math.min(1, dt * 4.5));

    u.meshRoot.position.copy(u.position);
    u.meshRoot.rotation.set(u.pitchRad, u.headingYaw, u.rollBankRad, 'YXZ');
  }

  getFlightTelemetrySamples(): FlightTelemetrySample[] {
    const samples: FlightTelemetrySample[] = [];
    for (const u of this.units) {
      if (!u.alive || u.crashing) continue;
      const speed = u.velocity.length();
      const inv = speed > 0.001 ? 1 / speed : 0;
      const speedOutlier = speed > u.profile.maxSpeed * 1.06;
      if (speedOutlier) {
        this.telemetry?.recordSpeedOutlier();
      }
      samples.push({
        id: u.id,
        domain: 'aircraft',
        category: u.type,
        x: Number(u.position.x.toFixed(1)),
        y: Number(u.position.y.toFixed(1)),
        z: Number(u.position.z.toFixed(1)),
        speed: Number(speed.toFixed(2)),
        acceleration: Number(u.lastAccelMag.toFixed(1)),
        maxSpeed: u.profile.maxSpeed,
        dirX: Number((speed > 0.001 ? u.velocity.x * inv : Math.sin(u.headingYaw)).toFixed(2)),
        dirY: Number((speed > 0.001 ? u.velocity.y * inv : 0).toFixed(2)),
        dirZ: Number((speed > 0.001 ? u.velocity.z * inv : Math.cos(u.headingYaw)).toFixed(2)),
        turnRateDegPerSec: Number(u.lastTurnRateDegPerSec.toFixed(1)),
        maxTurnRateDegPerSec: u.profile.maxTurnRateDegPerSec,
        flightTimeSec: Number(u.flightTimeSec.toFixed(2)),
        remainingLifeSec: null,
        trackingState: u.detectedPlayer ? 'ENGAGED' : 'PATROL',
        timeToImpactSec: null,
        stateLabel: u.flightPhase,
        speedOutlier,
      });
    }
    return samples;
  }

  getDebugInspectorRows(player: PlayerController): EnemyDebugInspectorRow[] {
    const nowSec = this.telemetry?.getElapsedSec() ?? 0;
    const rows: EnemyDebugInspectorRow[] = [];

    for (const u of this.units) {
      if (!u.alive || u.crashing || u.type === 'transport') continue;
      const dist = u.position.distanceTo(player.position);
      const lease = this.coordinator?.getUnitLease(u.id) ?? null;
      const waiting = this.coordinator?.isUnitWaiting(u.id) ?? false;
      const stats = this.telemetry?.getEnemyStats(u.id) ?? { damage: 0, hits: 0, shots: 0 };

      rows.push({
        id: u.id,
        displayName: u.displayName,
        squadId: u.squadId,
        domain: 'air',
        role: 'air_strike',
        state: u.state,
        detectedPlayer: u.detectedPlayer,
        hasLos: u.hasLos,
        losBlockerId: u.losBlockerId,
        distanceMeters: Number(dist.toFixed(1)),
        x: Number(u.position.x.toFixed(1)),
        y: Number(u.position.y.toFixed(1)),
        z: Number(u.position.z.toFixed(1)),
        yaw: u.headingYaw,
        fovDeg: 120,
        detectionRange: 115,
        hearingRange: 0,
        lkpX: u.lastKnownPosition ? Number(u.lastKnownPosition.x.toFixed(1)) : null,
        lkpY: u.lastKnownPosition ? Number(u.lastKnownPosition.y.toFixed(1)) : null,
        lkpZ: u.lastKnownPosition ? Number(u.lastKnownPosition.z.toFixed(1)) : null,
        lkpAgeSec: u.lastKnownPosition ? Number(Math.max(0, nowSec - u.lkpTimestampSec).toFixed(1)) : 0,
        reactionTimerSec: Number(Math.max(u.initialGraceTimerSec, u.reactionTimerSec).toFixed(2)),
        fireCooldownSec: Number(u.fireTimer.toFixed(2)),
        ammoInMag: u.ammoInMag,
        magSize: u.magSize,
        isReloading: u.isReloading,
        currentSpreadDeg: Number(((u.lastSpreadRad * 180) / Math.PI).toFixed(2)),
        accuracyPct: stats.shots > 0 ? Number(((stats.hits / stats.shots) * 100).toFixed(0)) : 50,
        tokenStatus: lease ? lease.kind : waiting ? 'WAITING' : 'NONE',
        allowedToFire: Boolean(lease) && u.hasLos && !u.isReloading,
        blockedByCover: !u.hasLos && u.losBlockerId !== null,
        shotsFired: stats.shots,
        shotsHit: stats.hits,
        totalDamageDealt: Number(stats.damage.toFixed(1)),
        lastDamageAmount: Number(u.lastDamageDealt.toFixed(1)),
        lastDamageTimeSec: u.lastDamageTimeSec !== null ? Number(u.lastDamageTimeSec.toFixed(1)) : null,
        obstructionDurationSec:
          u.obstructionStartSec !== null ? Number(Math.max(0, nowSec - u.obstructionStartSec).toFixed(2)) : 0,
        blockedShotAttempts: u.blockedShotAttempts,
        lastLosRecoverySec: u.lastLosRecoverySec,
      });
    }

    return rows;
  }

  hasAnyUnitWithLos(): boolean {
    for (const u of this.units) {
      if (u.alive && !u.crashing && u.hasLos) return true;
    }
    return false;
  }

  clear(): void {
    this.units = [];
  }

  getPhysicsInspectorRows(): PhysicsBodyInspectorRow[] {
    const out: PhysicsBodyInspectorRow[] = [];
    for (const u of this.units) {
      if (!u.alive && !u.crashing) continue;
      const spd = u.velocity.length();
      const r = u.type === 'attack_drone' ? 1.5 : u.type === 'gunship' ? 4.4 : 3.2;
      out.push({
        id: u.id,
        entityType: 'aircraft',
        classification: 'kinematic',
        shape: 'sphere',
        dimensions: `r=${r}m`,
        x: Number(u.position.x.toFixed(2)),
        y: Number(u.position.y.toFixed(2)),
        z: Number(u.position.z.toFixed(2)),
        yaw: Number(u.meshRoot.rotation.y.toFixed(2)),
        vx: Number(u.velocity.x.toFixed(2)),
        vy: Number(u.velocity.y.toFixed(2)),
        vz: Number(u.velocity.z.toFixed(2)),
        ax: 0,
        ay: 0,
        az: 0,
        speed: Number(spd.toFixed(2)),
        massKg: u.type === 'attack_drone' ? 140 : 4200,
        layer: COLLISION_LAYER.ENEMY,
        layerLabel: formatCollisionLayer(COLLISION_LAYER.ENEMY),
        mask: COLLISION_LAYER.WORLD | COLLISION_LAYER.PROJECTILE,
        maskLabel: formatCollisionLayer(COLLISION_LAYER.WORLD | COLLISION_LAYER.PROJECTILE),
        physicalState: 'HOVERING',
        lastCollisionId: null,
        lastNormalX: 0,
        lastNormalY: 1,
        lastNormalZ: 0,
        contactCount: 0,
      });
    }
    return out;
  }

  private buildAirRig(type: AirUnitType, scope: ResourceScope): { root: THREE.Group; rotor: THREE.Object3D | null } {
    const root = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      color: type === 'attack_drone' ? 0x1e293b : type === 'gunship' ? 0x292524 : 0x374151,
      metalness: 0.72,
      roughness: 0.35,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.8,
    });
    this.resourceManager.registerMaterial(hullMat, scope);
    this.resourceManager.registerMaterial(accentMat, scope);

    let rotor: THREE.Object3D | null = null;

    if (type === 'attack_drone') {
      const coreGeo = new THREE.BoxGeometry(1.1, 0.35, 1.4);
      const armGeo = new THREE.BoxGeometry(2.6, 0.1, 0.14);
      const eyeGeo = new THREE.SphereGeometry(0.18, 8, 8);
      [coreGeo, armGeo, eyeGeo].forEach((g) => this.resourceManager.registerGeometry(g, scope));
      root.add(new THREE.Mesh(coreGeo, hullMat));
      const arms = new THREE.Mesh(armGeo, hullMat);
      arms.rotation.y = Math.PI / 4;
      const arms2 = new THREE.Mesh(armGeo, hullMat);
      arms2.rotation.y = -Math.PI / 4;
      const eye = new THREE.Mesh(eyeGeo, accentMat);
      eye.position.set(0, -0.08, 0.72);
      root.add(arms, arms2, eye);
      rotor = arms;
    } else if (type === 'fighter_jet' || type === 'transport') {
      const scale = type === 'transport' ? 1.5 : 1.0;
      const fuseGeo = new THREE.CylinderGeometry(0.65 * scale, 0.85 * scale, 8.5 * scale, 10);
      fuseGeo.rotateX(Math.PI / 2);
      const wingGeo = new THREE.BoxGeometry(9.6 * scale, 0.16, 2.4 * scale);
      const tailGeo = new THREE.BoxGeometry(0.18, 1.9 * scale, 1.5 * scale);
      [fuseGeo, wingGeo, tailGeo].forEach((g) => this.resourceManager.registerGeometry(g, scope));
      root.add(new THREE.Mesh(fuseGeo, hullMat));
      const wing = new THREE.Mesh(wingGeo, hullMat);
      wing.position.z = -0.4;
      const tail = new THREE.Mesh(tailGeo, hullMat);
      tail.position.set(0, 1.0 * scale, -3.4 * scale);
      const burner = new THREE.Mesh(new THREE.SphereGeometry(0.45 * scale, 8, 8), accentMat);
      this.resourceManager.registerGeometry(burner.geometry, scope);
      burner.position.z = -4.3 * scale;
      root.add(wing, tail, burner);
    } else {
      const scale = type === 'gunship' ? 1.45 : 1.0;
      const bodyGeo = new THREE.BoxGeometry(1.9 * scale, 1.8 * scale, 6.2 * scale);
      const boomGeo = new THREE.BoxGeometry(0.55 * scale, 0.55 * scale, 4.8 * scale);
      const wingGeo = new THREE.BoxGeometry(4.4 * scale, 0.22, 1.1 * scale);
      const bladeGeo = new THREE.BoxGeometry(9.2 * scale, 0.08, 0.35 * scale);
      [bodyGeo, boomGeo, wingGeo, bladeGeo].forEach((g) => this.resourceManager.registerGeometry(g, scope));

      root.add(new THREE.Mesh(bodyGeo, hullMat));
      const boom = new THREE.Mesh(boomGeo, hullMat);
      boom.position.set(0, 0.3 * scale, -4.6 * scale);
      const stubWing = new THREE.Mesh(wingGeo, hullMat);
      stubWing.position.set(0, -0.2 * scale, 0.4 * scale);
      const podL = new THREE.Mesh(new THREE.SphereGeometry(0.28 * scale, 8, 8), accentMat);
      this.resourceManager.registerGeometry(podL.geometry, scope);
      podL.position.set(0, -0.8 * scale, 2.4 * scale);

      const rotorGroup = new THREE.Group();
      rotorGroup.position.set(0, 1.15 * scale, 0);
      const b1 = new THREE.Mesh(bladeGeo, hullMat);
      const b2 = new THREE.Mesh(bladeGeo, hullMat);
      b2.rotation.y = Math.PI / 2;
      rotorGroup.add(b1, b2);
      rotor = rotorGroup;

      root.add(boom, stubWing, podL, rotorGroup);
    }

    return { root, rotor };
  }
}
