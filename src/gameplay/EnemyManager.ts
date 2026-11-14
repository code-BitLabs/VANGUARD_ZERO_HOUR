import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { ENEMY_BY_ARCHETYPE } from '@/src/data/enemies';
import { VFXPool } from '@/src/effects/VFXPool';
import { formatCollisionLayer, PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import type { PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import {
  AUTHORITATIVE_COMBAT_CONFIG,
  DIFFICULTY_COMBAT_PROFILES,
  ENEMY_WEAPON_PROFILES,
  EnemyAwarenessState,
  EnemyWeaponClass,
} from '@/src/schemas/combat.schema';
import { Difficulty } from '@/src/schemas/common.schema';
import { EnemyArchetype, SquadRole } from '@/src/schemas/enemy.schema';
import { MiniMapBlip } from '@/src/schemas/events.schema';
import { WorkerBridge } from '@/src/workers/WorkerBridge';
import { BallisticSolver } from './BallisticSolver';
import { CombatEngagementCoordinator } from './CombatEngagementCoordinator';
import { CombatTelemetryRecorder, EnemyDebugInspectorRow } from './CombatTelemetryRecorder';
import { PlayerController } from './PlayerController';
import { ProjectileManager } from './ProjectileManager';
import { HitscanTarget } from './WeaponSystem';

export interface EnemyUnit {
  id: string;
  squadId: string;
  archetype: EnemyArchetype;
  displayName: string;
  role: SquadRole;
  weaponClass: EnemyWeaponClass;
  alive: boolean;
  health: number;
  maxHealth: number;
  armor: number;
  state: EnemyAwarenessState;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  bodyCenter: THREE.Vector3;
  headPosition: THREE.Vector3;
  lowerBodyCenter: THREE.Vector3;
  torsoBoxMin: THREE.Vector3;
  torsoBoxMax: THREE.Vector3;
  lowerBodyBoxMin: THREE.Vector3;
  lowerBodyBoxMax: THREE.Vector3;
  yaw: number;
  patrolOrigin: THREE.Vector3;
  patrolYaw: number;
  patrolTimer: number;
  waypoint: THREE.Vector3;
  coverTarget: THREE.Vector3 | null;
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
  stateTimerSec: number;
  reactionTimerSec: number;
  aimDurationSec: number;
  fireTimer: number;
  burstShotsRemaining: number;
  burstShotIndex: number;
  ammoInMag: number;
  magSize: number;
  isReloading: boolean;
  reloadTimerSec: number;
  grenadeCooldown: number;
  hitReactTimer: number;
  deathTimer: number;
  walkPhase: number;
  aiAccum: number;
  isMoving: boolean;
  lastSpreadRad: number;
  lastDamageDealt: number;
  lastDamageTimeSec: number | null;
  lastColliderHit: string | null;
  activeContacts: number;
  maxPenetrationDepth: number;
  meshRoot: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  weaponArm: THREE.Object3D;
  headMesh: THREE.Object3D;
  hasSpawnedDrone: boolean;
}

function mapArchetypeToWeapon(archetype: EnemyArchetype, index: number): EnemyWeaponClass {
  switch (archetype) {
    case 'sniper':
      return 'enemy_sniper';
    case 'heavy_armor':
    case 'vehicle_crew':
      return 'enemy_lmg';
    case 'rocket_trooper':
      return 'enemy_rocket';
    case 'drone_operator':
      return 'enemy_smg';
    case 'elite_assault':
      return index % 3 === 2 ? 'enemy_shotgun' : 'enemy_assault_rifle';
    case 'infantry':
    default:
      return index % 4 === 3 ? 'enemy_smg' : 'enemy_assault_rifle';
  }
}

export class EnemyManager {
  private enemies: EnemyUnit[] = [];
  private seq = 0;
  private waveSeq = 0;
  private pathSyncAccum = 0;
  private difficulty: Difficulty = 'normal';
  private difficultyMult = 1.0;

  private readonly _muzzlePos = new THREE.Vector3();
  private readonly _aimTarget = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly resourceManager: ResourceManager,
    private readonly vfx: VFXPool,
    private readonly audio: AudioManager,
    private readonly projectiles: ProjectileManager,
    private readonly coordinator?: CombatEngagementCoordinator,
    private readonly ballistics?: BallisticSolver,
    private readonly telemetry?: CombatTelemetryRecorder
  ) {}

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    const prof = DIFFICULTY_COMBAT_PROFILES[difficulty];
    this.difficultyMult = prof.damageMultiplier;
    this.coordinator?.setDifficulty(difficulty);
  }

  getUnits(): readonly EnemyUnit[] {
    return this.enemies;
  }

  private syncUnitHitboxes(u: EnemyUnit): void {
    const scale = u.archetype === 'heavy_armor' ? 1.16 : 1.0;
    const px = u.position.x;
    const py = u.position.y;
    const pz = u.position.z;

    u.headPosition.set(px, py + 1.65 * scale, pz);
    u.bodyCenter.set(px, py + 1.08 * scale, pz);
    u.lowerBodyCenter.set(px, py + 0.4 * scale, pz);

    const torsoHalfW = 0.38 * scale;
    u.torsoBoxMin.set(px - torsoHalfW, py + 0.75 * scale, pz - torsoHalfW);
    u.torsoBoxMax.set(px + torsoHalfW, py + 1.44 * scale, pz + torsoHalfW);

    const lowerHalfW = 0.34 * scale;
    u.lowerBodyBoxMin.set(px - lowerHalfW, py, pz - lowerHalfW);
    u.lowerBodyBoxMax.set(px + lowerHalfW, py + 0.75 * scale, pz + lowerHalfW);
  }

  spawnWave(
    archetype: EnemyArchetype,
    count: number,
    center: { x: number; y: number; z: number },
    radius: number,
    collision: CollisionWorld,
    scope: ResourceScope,
    customSquadId?: string
  ): void {
    const cfg = ENEMY_BY_ARCHETYPE[archetype];
    const squadId = customSquadId ?? `squad_${++this.waveSeq}_${archetype}`;
    const rng = this.ballistics?.rng;
    const diffProf = DIFFICULTY_COMBAT_PROFILES[this.difficulty];

    for (let i = 0; i < count; i++) {
      const randA = rng ? rng.next() : Math.random();
      const randR = rng ? rng.next() : Math.random();
      const a = (i / Math.max(1, count)) * Math.PI * 2 + randA * 0.45;
      const r = count === 1 ? 0 : 2 + randR * Math.max(0.5, radius - 2);
      const x = Math.max(-105, Math.min(105, center.x + Math.cos(a) * r));
      const z = Math.max(-105, Math.min(105, center.z + Math.sin(a) * r));
      const y = collision.getGroundHeightAt(x, z);
      const spawnPos = new THREE.Vector3(x, y, z);
      const spawnVel = new THREE.Vector3(0, 0, 0);
      const unitId = `enemy_${++this.seq}`;
      // Push spawn position out of any solid walls or barriers immediately
      collision.resolvePlayerCapsule(spawnPos, spawnVel, 0.4, 1.75, 0.45, 0.016, unitId);

      const rig = this.buildSoldierRig(cfg.accentColor, archetype, scope);
      rig.root.position.copy(spawnPos);
      this.scene.add(rig.root);
      this.resourceManager.register('object3d', scope, () => this.scene.remove(rig.root));

      const hp = Math.round(cfg.maxHealth * (0.85 + 0.15 * this.difficultyMult));
      const armor = Math.round(cfg.maxArmor * this.difficultyMult);
      const weaponClass = mapArchetypeToWeapon(archetype, i);
      const weaponProf = ENEMY_WEAPON_PROFILES[weaponClass];

      // Stagger initial patrol facing angles so not every unit stares straight down the spawn road
      const patrolYaw = ((i * 1.618 + this.seq * 0.7) % 1) * Math.PI * 2 - Math.PI;
      rig.root.rotation.y = patrolYaw;

      this.coordinator?.registerUnit(unitId, squadId);

      const unit: EnemyUnit = {
        id: unitId,
        squadId,
        archetype,
        displayName: cfg.displayName,
        role: cfg.role,
        weaponClass,
        alive: true,
        health: hp,
        maxHealth: hp,
        armor,
        state: 'UNAWARE',
        position: spawnPos,
        velocity: spawnVel,
        bodyCenter: new THREE.Vector3(),
        headPosition: new THREE.Vector3(),
        lowerBodyCenter: new THREE.Vector3(),
        torsoBoxMin: new THREE.Vector3(),
        torsoBoxMax: new THREE.Vector3(),
        lowerBodyBoxMin: new THREE.Vector3(),
        lowerBodyBoxMax: new THREE.Vector3(),
        yaw: patrolYaw,
        patrolOrigin: spawnPos.clone(),
        patrolYaw,
        patrolTimer: 1.5 + (i % 4) * 0.9,
        waypoint: spawnPos.clone(),
        coverTarget: null,
        hasLos: false,
        losBlockerId: null,
        losLostDurationSec: 99,
        obstructionStartSec: null,
        blockedShotAttempts: 0,
        lastLosRecoverySec: null,
        detectedPlayer: false,
        lastKnownPosition: null,
        lkpTimestampSec: -999,
        initialGraceTimerSec: diffProf.groundInitialGraceSec + (i % 3) * 0.25,
        stateTimerSec: 0,
        reactionTimerSec: 0,
        aimDurationSec: 0,
        fireTimer: 0.4 + (i % 5) * 0.18,
        burstShotsRemaining: 0,
        burstShotIndex: 0,
        ammoInMag: weaponProf.magazineSize,
        magSize: weaponProf.magazineSize,
        isReloading: false,
        reloadTimerSec: 0,
        grenadeCooldown: 7 + (i % 4) * 2.5,
        hitReactTimer: 0,
        deathTimer: 0,
        walkPhase: (i * 0.8) % (Math.PI * 2),
        aiAccum: (i % 6) * 0.02,
        isMoving: false,
        lastSpreadRad: weaponProf.baseSpreadRad,
        lastDamageDealt: 0,
        lastDamageTimeSec: null,
        lastColliderHit: null,
        activeContacts: 0,
        maxPenetrationDepth: 0,
        meshRoot: rig.root,
        leftLeg: rig.leftLeg,
        rightLeg: rig.rightLeg,
        weaponArm: rig.weaponArm,
        headMesh: rig.headMesh,
        hasSpawnedDrone: false,
      };
      this.syncUnitHitboxes(unit);
      this.enemies.push(unit);
    }
  }

  getHitscanTargets(
    onEnemyHit: (unit: EnemyUnit, damage: number, isHeadshot: boolean, killed: boolean) => void
  ): HitscanTarget[] {
    const out: HitscanTarget[] = [];
    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) continue;
      const scale = u.archetype === 'heavy_armor' ? 1.16 : 1.0;
      out.push({
        id: u.id,
        kind: 'enemy',
        name: u.displayName,
        alive: u.alive,
        position: u.bodyCenter,
        hitRadius: 0.56 * scale,
        headPosition: u.headPosition,
        headRadius: 0.3 * scale,
        lowerBodyPosition: u.lowerBodyCenter,
        lowerBodyRadius: 0.42 * scale,
        torsoBoxMin: u.torsoBoxMin,
        torsoBoxMax: u.torsoBoxMax,
        lowerBodyBoxMin: u.lowerBodyBoxMin,
        lowerBodyBoxMax: u.lowerBodyBoxMax,
        onHit: (damage, isHeadshot, hitPoint) => {
          const killed = this.damageUnit(u, damage, isHeadshot, hitPoint);
          onEnemyHit(u, damage, isHeadshot, killed);
        },
      });
    }
    return out;
  }

  damageUnit(
    unit: EnemyUnit,
    damage: number,
    isHeadshot: boolean,
    stimulusOrigin?: THREE.Vector3
  ): boolean {
    if (!unit.alive) return false;
    unit.initialGraceTimerSec = 0;
    let remaining = damage;
    if (unit.armor > 0 && !isHeadshot) {
      const absorb = Math.min(unit.armor, damage * 0.45);
      unit.armor -= absorb;
      remaining -= absorb;
    }
    unit.health -= remaining;

    unit.hitReactTimer = 0.22;

    // Release active shooting token while staggered by incoming hit
    this.coordinator?.releaseLease(unit.id, 'staggered_by_hit');

    const nowSec = this.telemetry?.getElapsedSec() ?? 0;
    if (unit.state === 'UNAWARE' || unit.state === 'SUSPICIOUS') {
      const prev = unit.state;
      unit.state = 'INVESTIGATING';
      unit.stateTimerSec = AUTHORITATIVE_COMBAT_CONFIG.investigateDurationSec;
      this.telemetry?.recordStateTransition(unit.id, unit.squadId, 'ground', prev, 'INVESTIGATING');
      if (stimulusOrigin) {
        if (!unit.lastKnownPosition) unit.lastKnownPosition = new THREE.Vector3();
        unit.lastKnownPosition.copy(stimulusOrigin);
        unit.lkpTimestampSec = nowSec;
      }
      this.telemetry?.recordEvent(
        'ALERT_STATE',
        unit.id,
        unit.squadId,
        'ground',
        `${unit.id} took fire -> INVESTIGATING`
      );
    }

    if (unit.health <= 0) {
      const prevBeforeDeath = unit.state;
      unit.health = 0;
      unit.alive = false;
      unit.state = 'DEAD';
      unit.deathTimer = 0;
      this.telemetry?.recordStateTransition(unit.id, unit.squadId, 'ground', prevBeforeDeath, 'DEAD');
      this.coordinator?.notifyUnitDisabled(unit.id, unit.squadId, 'ground', 'death');
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
    onEnemyKilled: (u: EnemyUnit) => void
  ): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) continue;
      const dist = Math.hypot(u.position.x - x, u.position.y + 1 - y, u.position.z - z);
      if (dist <= radius) {
        const falloff = 1 - (dist / radius) * 0.72;
        const killed = this.damageUnit(u, damage * falloff, false);
        if (killed) onEnemyKilled(u);
      }
    }
  }

  update(
    dt: number,
    player: PlayerController,
    collision: CollisionWorld,
    coverNodes: THREE.Vector3[],
    workerBridge: WorkerBridge,
    aiMidIntervalSec: number,
    onSpawnDrone?: (x: number, y: number, z: number) => void
  ): void {
    const px = player.position.x;
    const pz = player.position.z;

    // Batch off-thread A* path requests every 0.45s using LKP or cover targets (NEVER wall-hack player pos!)
    this.pathSyncAccum += dt;
    if (this.pathSyncAccum >= 0.45) {
      this.pathSyncAccum = 0;
      const activeToRoute = this.enemies
        .filter(
          (e) =>
            e.alive &&
            e.state !== 'DEAD' &&
            e.state !== 'UNAWARE' &&
            e.state !== 'SUSPICIOUS' &&
            (e.coverTarget !== null || e.lastKnownPosition !== null)
        )
        .slice(0, 8);
      if (activeToRoute.length > 0 && workerBridge.isHealthy()) {
        const queries = activeToRoute.map((e) => {
          const target =
            e.coverTarget && (e.state === 'REPOSITIONING' || e.state === 'RETREATING')
              ? e.coverTarget
              : (e.lastKnownPosition ?? e.patrolOrigin);
          return { sx: e.position.x, sz: e.position.z, tx: target.x, tz: target.z };
        });
        void workerBridge.requestPaths(queries).then((waypoints) => {
          if (!waypoints || this.enemies.length === 0) return;
          for (let i = 0; i < Math.min(waypoints.length, activeToRoute.length); i++) {
            const u = activeToRoute[i];
            if (u.alive) {
              u.waypoint.set(waypoints[i].wx, u.position.y, waypoints[i].wz);
            }
          }
        });
      }
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) {
        u.deathTimer += dt;
        const fall = Math.min(1, u.deathTimer * 3.8);
        u.meshRoot.rotation.x = -fall * (Math.PI * 0.48);
        u.meshRoot.position.y = u.position.y + 0.15 * fall;
        if (u.deathTimer > 6) {
          u.meshRoot.visible = false;
        }
        continue;
      }

      const cfg = ENEMY_BY_ARCHETYPE[u.archetype];
      const distSq =
        (u.position.x - px) * (u.position.x - px) + (u.position.z - pz) * (u.position.z - pz);
      const dist = Math.sqrt(distSq);

      const isCloseOrCombat =
        dist < 55 ||
        u.state === 'ENGAGING' ||
        u.state === 'SUPPRESSING' ||
        u.state === 'ALERTED' ||
        u.state === 'REPOSITIONING' ||
        u.state === 'SEARCHING';
      const stepInterval = isCloseOrCombat ? 0.016 : dist < 95 ? aiMidIntervalSec : 0.35;

      u.aiAccum += dt;
      if (u.aiAccum >= stepInterval) {
        const aiDt = u.aiAccum;
        u.aiAccum = 0;
        this.stepEnemyAI(u, cfg, aiDt, dist, collision, coverNodes, player, onSpawnDrone);
      }

      // Smooth procedural animation every frame
      u.hitReactTimer = Math.max(0, u.hitReactTimer - dt);
      u.meshRoot.position.copy(u.position);
      u.meshRoot.rotation.y = u.yaw;

      if (u.isMoving) {
        u.walkPhase += dt * 9;
        u.leftLeg.rotation.x = Math.sin(u.walkPhase) * 0.55;
        u.rightLeg.rotation.x = -Math.sin(u.walkPhase) * 0.55;
      } else {
        u.leftLeg.rotation.x *= 0.85;
        u.rightLeg.rotation.x *= 0.85;
      }
      u.weaponArm.rotation.x =
        u.hitReactTimer > 0
          ? -0.45
          : u.isReloading
            ? -0.32
            : u.state === 'ENGAGING' || u.state === 'SUPPRESSING' || u.state === 'ALERTED'
              ? -0.05
              : 0.25;
      u.headMesh.rotation.x = u.hitReactTimer > 0 ? -0.35 : 0;

      this.syncUnitHitboxes(u);
    }
  }

  private stepEnemyAI(
    u: EnemyUnit,
    cfg: (typeof ENEMY_BY_ARCHETYPE)[EnemyArchetype],
    dt: number,
    dist: number,
    collision: CollisionWorld,
    coverNodes: THREE.Vector3[],
    player: PlayerController,
    onSpawnDrone?: (x: number, y: number, z: number) => void
  ): void {
    const nowSec = this.telemetry?.getElapsedSec() ?? 0;
    const diffProfile = DIFFICULTY_COMBAT_PROFILES[this.difficulty];
    const weaponProf = ENEMY_WEAPON_PROFILES[u.weaponClass];
    const sq = this.coordinator?.getOrCreateSquad(u.squadId);

    // 1. Reload timer management
    if (u.isReloading) {
      u.reloadTimerSec -= dt;
      if (u.reloadTimerSec <= 0) {
        u.isReloading = false;
        u.ammoInMag = u.magSize;
      }
    }

    if (u.initialGraceTimerSec > 0) {
      const acousticRadius = player.getActiveAcousticRadius(nowSec);
      if (player.alive && acousticRadius > 0 && dist <= acousticRadius) {
        u.initialGraceTimerSec = 0;
      } else {
        u.initialGraceTimerSec = Math.max(0, u.initialGraceTimerSec - dt);
        if (u.initialGraceTimerSec > 0 && u.state === 'UNAWARE') {
          return;
        }
      }
    }


    // 2. Vision Cone & 5-Point Physical LOS Check
    const toPlayerX = player.position.x - u.position.x;
    const toPlayerZ = player.position.z - u.position.z;
    const angleToPlayer = Math.atan2(toPlayerX, toPlayerZ);
    const yawDiff = Math.abs(this.normalizeAngle(angleToPlayer - u.yaw));

    const activeFovDeg =
      u.state === 'UNAWARE' || u.state === 'SUSPICIOUS' || u.state === 'INVESTIGATING'
        ? dist <= AUTHORITATIVE_COMBAT_CONFIG.peripheralRangeMeters
          ? AUTHORITATIVE_COMBAT_CONFIG.peripheralFovDeg
          : AUTHORITATIVE_COMBAT_CONFIG.primaryFovDeg
        : AUTHORITATIVE_COMBAT_CONFIG.alertedFovDeg;

    const halfFovRad = ((activeFovDeg * 0.5) * Math.PI) / 180;
    const withinVisionCone = player.alive && dist <= cfg.detectionRange && yawDiff <= halfFovRad;

    let rawLos = false;
    let exposedTargetPoint = player.position;
    let blockerId: string | null = null;

    if (withinVisionCone && this.ballistics) {
      const losRes = this.ballistics.checkLineOfSight(
        u.position.x,
        u.position.y + 1.56,
        u.position.z,
        player,
        collision,
        cfg.detectionRange
      );
      rawLos = losRes.visible;
      exposedTargetPoint = losRes.exposedPoint;
      blockerId = losRes.blockerId;
    } else if (player.alive && dist <= cfg.detectionRange && this.ballistics) {
      // Check if blocked by cover for telemetry even when out of FOV
      const losRes = this.ballistics.checkLineOfSight(
        u.position.x,
        u.position.y + 1.56,
        u.position.z,
        player,
        collision,
        cfg.detectionRange
      );
      blockerId = losRes.blockerId;
    }

    const prevLos = u.hasLos;
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
            'ground',
            `${u.id} recovered LOS after ${recovSec.toFixed(2)}s`
          );
        }
      }
      u.losLostDurationSec = 0;
      if (!u.lastKnownPosition) u.lastKnownPosition = new THREE.Vector3();
      u.lastKnownPosition.copy(exposedTargetPoint);
      u.lkpTimestampSec = nowSec;
      sq?.reportSighting(exposedTargetPoint.x, exposedTargetPoint.y, exposedTargetPoint.z, nowSec);

      if (!u.detectedPlayer) {
        u.detectedPlayer = true;
        this.telemetry?.recordEvent(
          'DETECTED',
          u.id,
          u.squadId,
          'ground',
          `${u.id} (${u.role}) visually acquired player at ${dist.toFixed(1)}m`
        );
      }
    } else {
      u.losLostDurationSec += dt;
      if (prevLos) {
        u.obstructionStartSec = nowSec;
        this.telemetry?.recordEvent(
          'LOST_LOS',
          u.id,
          u.squadId,
          'ground',
          `${u.id} lost visual contact (blocked by ${blockerId ?? 'cover/fov'})`
        );
      }
    }

    // 3. Acoustic Hearing & Squad Radio Sighting Check (when LOS is false)
    const acousticRadius = player.getActiveAcousticRadius(nowSec);
    const heardPlayer = player.alive && acousticRadius > 0 && dist <= acousticRadius;
    if (heardPlayer && !rawLos) {
      if (!u.lastKnownPosition) u.lastKnownPosition = new THREE.Vector3();
      u.lastKnownPosition.set(player.position.x, player.position.y + 1.0, player.position.z);
      u.lkpTimestampSec = nowSec;
    }

    const sharedSighting = sq?.getSharedSighting(nowSec) ?? null;
    if (!rawLos && sharedSighting && (!u.lastKnownPosition || sharedSighting.ageSec < nowSec - u.lkpTimestampSec)) {
      if (!u.lastKnownPosition) u.lastKnownPosition = new THREE.Vector3();
      u.lastKnownPosition.copy(sharedSighting.position);
      u.lkpTimestampSec = nowSec - sharedSighting.ageSec;
    }

    const lkpAgeSec = u.lastKnownPosition ? Math.max(0, nowSec - u.lkpTimestampSec) : 999;

    // 4. 9-State Awareness & Tactical FSM Transitions
    const prevState = u.state;

    if (u.health < u.maxHealth * 0.28 && u.state !== 'RETREATING') {
      u.state = 'RETREATING';
      u.coverTarget = this.findTacticalCover(u.position, coverNodes, u.lastKnownPosition ?? player.position, true);
      this.coordinator?.releaseLease(u.id, 'retreating');
    } else {
      switch (u.state) {
        case 'UNAWARE': {
          if (rawLos) {
            u.state = 'ALERTED';
            u.reactionTimerSec = this.computeReactionDelay(u, dist, diffProfile, false);
            this.audio.playSpatial('enemy_callout', u.position.x, u.position.y + 1.5, u.position.z, 3, 0.45);
          } else if (heardPlayer || (sharedSighting && sharedSighting.ageSec < 3.0)) {
            u.state = 'SUSPICIOUS';
            u.stateTimerSec = AUTHORITATIVE_COMBAT_CONFIG.suspiciousDurationSec;
          }
          break;
        }

        case 'SUSPICIOUS': {
          u.stateTimerSec -= dt;
          if (rawLos) {
            u.state = 'ALERTED';
            u.reactionTimerSec = this.computeReactionDelay(u, dist, diffProfile, true);
            this.audio.playSpatial('enemy_callout', u.position.x, u.position.y + 1.5, u.position.z, 3, 0.45);
          } else if (u.stateTimerSec <= 0) {
            if (u.lastKnownPosition && lkpAgeSec < AUTHORITATIVE_COMBAT_CONFIG.lkpDecaySec) {
              u.state = 'INVESTIGATING';
              u.stateTimerSec = AUTHORITATIVE_COMBAT_CONFIG.investigateDurationSec;
            } else {
              u.state = 'UNAWARE';
            }
          }
          break;
        }

        case 'INVESTIGATING': {
          u.stateTimerSec -= dt;
          if (rawLos) {
            u.state = 'ALERTED';
            u.reactionTimerSec = this.computeReactionDelay(u, dist, diffProfile, true);
            this.audio.playSpatial('enemy_callout', u.position.x, u.position.y + 1.5, u.position.z, 3, 0.45);
          } else if (u.stateTimerSec <= 0 || lkpAgeSec > AUTHORITATIVE_COMBAT_CONFIG.lkpDecaySec) {
            u.state = 'UNAWARE';
          }
          break;
        }

        case 'ALERTED': {
          u.reactionTimerSec = Math.max(0, u.reactionTimerSec - dt);
          if (u.reactionTimerSec <= 0) {
            if (rawLos && dist <= cfg.attackRange) {
              const leaseKind = cfg.canUseRockets ? 'HEAVY' : 'DIRECT';
              const granted =
                this.coordinator?.requestLease({
                  unitId: u.id,
                  squadId: u.squadId,
                  domain: 'ground',
                  role: u.role,
                  kind: leaseKind,
                  distanceMeters: dist,
                  hasLos: true,
                  isWeaponReady: !u.isReloading && u.hitReactTimer <= 0,
                }) ?? true;

              if (granted) {
                u.state = 'ENGAGING';
              } else {
                u.state = 'REPOSITIONING';
                u.stateTimerSec = 1.6;
                u.coverTarget = this.findTacticalCover(
                  u.position,
                  coverNodes,
                  u.lastKnownPosition ?? u.position,
                  false
                );
              }
            } else if (!rawLos && u.lastKnownPosition && lkpAgeSec <= AUTHORITATIVE_COMBAT_CONFIG.suppressionMaxAgeSec) {
              const grantedSuppress =
                (u.role === 'suppressor' || u.role === 'rifleman') &&
                (this.coordinator?.requestLease({
                  unitId: u.id,
                  squadId: u.squadId,
                  domain: 'ground',
                  role: u.role,
                  kind: 'SUPPRESS',
                  distanceMeters: dist,
                  hasLos: false,
                  isWeaponReady: !u.isReloading && u.hitReactTimer <= 0,
                }) ?? false);

              u.state = grantedSuppress ? 'SUPPRESSING' : 'SEARCHING';
              u.stateTimerSec = grantedSuppress ? 2.6 : 6.0;
            } else {
              u.state = 'SEARCHING';
              u.stateTimerSec = 6.0;
            }
          }
          break;
        }

        case 'ENGAGING': {
          if (u.isReloading || u.hitReactTimer > 0) {
            this.coordinator?.releaseLease(u.id, u.isReloading ? 'reloading' : 'staggered');
            u.state = 'REPOSITIONING';
            u.stateTimerSec = 1.4;
            break;
          }

          if (!rawLos) {
            if (u.losLostDurationSec >= AUTHORITATIVE_COMBAT_CONFIG.losGraceSec) {
              this.coordinator?.releaseLease(u.id, 'los_grace_expired');
              if (
                u.lastKnownPosition &&
                lkpAgeSec <= AUTHORITATIVE_COMBAT_CONFIG.suppressionMaxAgeSec &&
                (u.role === 'suppressor' || u.role === 'rifleman')
              ) {
                const supGranted =
                  this.coordinator?.requestLease({
                    unitId: u.id,
                    squadId: u.squadId,
                    domain: 'ground',
                    role: u.role,
                    kind: 'SUPPRESS',
                    distanceMeters: dist,
                    hasLos: false,
                    isWeaponReady: !u.isReloading,
                  }) ?? false;
                u.state = supGranted ? 'SUPPRESSING' : 'SEARCHING';
                u.stateTimerSec = supGranted ? 2.4 : 6.0;
              } else {
                u.state = 'SEARCHING';
                u.stateTimerSec = 6.0;
              }
            }
          } else {
            // Confirm lease is still active (e.g., not rotated out by anti-starvation)
            const leaseKind = cfg.canUseRockets ? 'HEAVY' : 'DIRECT';
            const stillHasLease =
              this.coordinator?.requestLease({
                unitId: u.id,
                squadId: u.squadId,
                domain: 'ground',
                role: u.role,
                kind: leaseKind,
                distanceMeters: dist,
                hasLos: true,
                isWeaponReady: !u.isReloading && u.hitReactTimer <= 0,
              }) ?? true;

            if (!stillHasLease) {
              u.state = 'REPOSITIONING';
              u.stateTimerSec = 1.5;
              u.coverTarget = this.findTacticalCover(
                u.position,
                coverNodes,
                u.lastKnownPosition ?? u.position,
                false
              );
            }
          }
          break;
        }

        case 'SUPPRESSING': {
          u.stateTimerSec -= dt;
          if (rawLos) {
            this.coordinator?.releaseLease(u.id, 'regained_los');
            u.state = 'ALERTED';
            u.reactionTimerSec = 0.18;
          } else if (
            u.isReloading ||
            u.stateTimerSec <= 0 ||
            lkpAgeSec > AUTHORITATIVE_COMBAT_CONFIG.suppressionMaxAgeSec
          ) {
            this.coordinator?.releaseLease(u.id, 'suppression_complete');
            u.state = 'SEARCHING';
            u.stateTimerSec = 5.5;
          }
          break;
        }

        case 'REPOSITIONING': {
          u.stateTimerSec -= dt;
          if (u.stateTimerSec <= 0) {
            if (rawLos) {
              u.state = 'ALERTED';
              u.reactionTimerSec = 0.2;
            } else {
              u.state = 'SEARCHING';
              u.stateTimerSec = 5.5;
            }
          }
          break;
        }

        case 'SEARCHING': {
          u.stateTimerSec -= dt;
          if (rawLos) {
            u.state = 'ALERTED';
            u.reactionTimerSec = this.computeReactionDelay(u, dist, diffProfile, true);
          } else if (lkpAgeSec > AUTHORITATIVE_COMBAT_CONFIG.lkpDecaySec || u.stateTimerSec <= 0) {
            u.state = 'INVESTIGATING';
            u.stateTimerSec = 3.0;
          }
          break;
        }

        case 'RETREATING': {
          if (u.coverTarget && u.position.distanceTo(u.coverTarget) < 2.2) {
            u.state = rawLos ? 'ALERTED' : 'SEARCHING';
            u.reactionTimerSec = 0.35;
            u.stateTimerSec = 4.0;
          }
          break;
        }
      }
    }

    if (u.state !== prevState) {
      this.telemetry?.recordStateTransition(u.id, u.squadId, 'ground', prevState, u.state);
      if (u.state === 'SUPPRESSING') {
        this.telemetry?.recordEvent(
          'SUPPRESSION_START',
          u.id,
          u.squadId,
          'ground',
          `${u.id} suppressing LKP`
        );
      } else if (u.state === 'REPOSITIONING' && u.role === 'flanker') {
        this.telemetry?.recordEvent(
          'FLANK_START',
          u.id,
          u.squadId,
          'ground',
          `${u.id} flanking around cover`
        );
      } else if (u.state === 'ALERTED') {
        this.telemetry?.recordEvent(
          'AIM_START',
          u.id,
          u.squadId,
          'ground',
          `${u.id} aiming (reaction ${u.reactionTimerSec.toFixed(2)}s)`
        );
      }
    }

    // 5. Drone operator special ability: deploys a live tactical attack drone once in combat
    if (
      cfg.canSpawnDrones &&
      !u.hasSpawnedDrone &&
      (u.state === 'ENGAGING' || u.state === 'ALERTED') &&
      dist < 68
    ) {
      u.hasSpawnedDrone = true;
      onSpawnDrone?.(u.position.x, u.position.y + 8, u.position.z);
    }

    // 6. Orientation & Movement (NEVER snap to live player coordinates when LOS is false!)
    let lookTargetX = u.position.x + Math.sin(u.patrolYaw);
    let lookTargetZ = u.position.z + Math.cos(u.patrolYaw);

    if (rawLos) {
      lookTargetX = exposedTargetPoint.x;
      lookTargetZ = exposedTargetPoint.z;
      u.aimDurationSec += dt;
    } else if (u.lastKnownPosition && u.state !== 'UNAWARE') {
      lookTargetX = u.lastKnownPosition.x;
      lookTargetZ = u.lastKnownPosition.z;
      u.aimDurationSec = Math.max(0, u.aimDurationSec - dt * 2);
    } else {
      u.aimDurationSec = 0;
    }

    const desiredYaw = Math.atan2(lookTargetX - u.position.x, lookTargetZ - u.position.z);
    const maxTurnRad = (u.state === 'UNAWARE' ? 2.2 : 5.5) * dt;
    u.yaw = this.stepYawTowards(u.yaw, desiredYaw, maxTurnRad);

    let moveX = 0;
    let moveZ = 0;
    const preferredRange =
      u.archetype === 'sniper' ? 52 : u.archetype === 'rocket_trooper' ? 40 : 22;
    const hasWaypoint = Math.hypot(u.waypoint.x - u.position.x, u.waypoint.z - u.position.z) > 0.6;

    if (u.state === 'UNAWARE') {
      u.patrolTimer -= dt;
      if (u.patrolTimer <= 0) {
        u.patrolTimer = 3.5 + (this.ballistics?.rng.next() ?? 0.5) * 2.5;
        u.patrolYaw = this.normalizeAngle(u.patrolYaw + Math.PI * 0.65);
      }
    } else if (u.state === 'RETREATING' && u.coverTarget) {
      moveX = (hasWaypoint ? u.waypoint.x : u.coverTarget.x) - u.position.x;
      moveZ = (hasWaypoint ? u.waypoint.z : u.coverTarget.z) - u.position.z;
    } else if (u.state === 'REPOSITIONING') {
      if (u.role === 'flanker' && u.lastKnownPosition) {
        const side = parseInt(u.id.split('_')[1] ?? '1', 10) % 2 === 0 ? 1 : -1;
        const dx = u.lastKnownPosition.x - u.position.x;
        const dz = u.lastKnownPosition.z - u.position.z;
        moveX = dx * 0.35 - dz * side * 0.85;
        moveZ = dz * 0.35 + dx * side * 0.85;
      } else if (u.coverTarget) {
        moveX = (hasWaypoint ? u.waypoint.x : u.coverTarget.x) - u.position.x;
        moveZ = (hasWaypoint ? u.waypoint.z : u.coverTarget.z) - u.position.z;
      }
    } else if (
      (u.state === 'INVESTIGATING' || u.state === 'SEARCHING') &&
      u.lastKnownPosition
    ) {
      const distToLkp = Math.hypot(
        u.lastKnownPosition.x - u.position.x,
        u.lastKnownPosition.z - u.position.z
      );
      if (distToLkp > 4.5) {
        moveX = (hasWaypoint ? u.waypoint.x : u.lastKnownPosition.x) - u.position.x;
        moveZ = (hasWaypoint ? u.waypoint.z : u.lastKnownPosition.z) - u.position.z;
      }
    } else if (u.state === 'ENGAGING' && dist > preferredRange && u.lastKnownPosition) {
      moveX = (hasWaypoint ? u.waypoint.x : u.lastKnownPosition.x) - u.position.x;
      moveZ = (hasWaypoint ? u.waypoint.z : u.lastKnownPosition.z) - u.position.z;
    }

    const moveLen = Math.hypot(moveX, moveZ);
    if (moveLen > 0.6 && u.state !== 'SUPPRESSING') {
      u.isMoving = true;
      const spd =
        cfg.moveSpeed *
        (u.state === 'RETREATING' ? 1.15 : u.state === 'INVESTIGATING' ? 0.65 : 0.9);
      let vx = (moveX / moveLen) * spd;
      let vz = (moveZ / moveLen) * spd;

      // Local enemy-vs-enemy separation force to prevent crowd stacking
      const minSep = 0.92;
      for (let j = 0; j < this.enemies.length; j++) {
        const other = this.enemies[j];
        if (!other.alive || other.id === u.id) continue;
        const sdx = u.position.x - other.position.x;
        const sdz = u.position.z - other.position.z;
        const sDistSq = sdx * sdx + sdz * sdz;
        if (sDistSq > 1e-5 && sDistSq < minSep * minSep) {
          const sDist = Math.sqrt(sDistSq);
          const push = ((minSep - sDist) / minSep) * 3.5;
          vx += (sdx / sDist) * push;
          vz += (sdz / sDist) * push;
        }
      }

      u.velocity.set(vx, -12.0 * dt, vz);
      const moveRes = collision.resolvePlayerCapsule(
        u.position,
        u.velocity,
        0.4,
        1.75,
        0.45,
        dt,
        u.id
      );
      u.lastColliderHit = moveRes.lastBlockerId;
      u.activeContacts = moveRes.activeContacts ?? 0;
      u.maxPenetrationDepth = moveRes.maxPenetrationDepth ?? 0;
    } else {
      u.isMoving = false;
      u.velocity.set(0, 0, 0);
      u.activeContacts = 0;
      u.maxPenetrationDepth = 0;
    }

    // 7. Controlled Burst Firing & Suppression Execution
    u.fireTimer = Math.max(0, u.fireTimer - dt);
    u.grenadeCooldown = Math.max(0, u.grenadeCooldown - dt);

    const activeLease = this.coordinator ? this.coordinator.getUnitLease(u.id) : null;
    const canFireDirect =
      u.state === 'ENGAGING' &&
      rawLos &&
      dist <= weaponProf.maxRangeMeters &&
      player.alive &&
      !u.isReloading &&
      u.hitReactTimer <= 0 &&
      (activeLease?.kind === 'DIRECT' || activeLease?.kind === 'HEAVY' || !this.coordinator);

    const canFireSuppress =
      u.state === 'SUPPRESSING' &&
      !rawLos &&
      u.lastKnownPosition !== null &&
      lkpAgeSec <= AUTHORITATIVE_COMBAT_CONFIG.suppressionMaxAgeSec &&
      dist <= weaponProf.maxRangeMeters &&
      player.alive &&
      !u.isReloading &&
      u.hitReactTimer <= 0 &&
      activeLease?.kind === 'SUPPRESS';

    if (
      u.state === 'ENGAGING' &&
      !rawLos &&
      player.alive &&
      !u.isReloading &&
      u.hitReactTimer <= 0 &&
      u.fireTimer <= 0
    ) {
      u.blockedShotAttempts++;
      u.fireTimer = 0.25;
      this.telemetry?.recordEvent(
        'SHOT_BLOCKED_COVER',
        u.id,
        u.squadId,
        'ground',
        `${u.id} direct shot blocked during grace (blocker=${blockerId ?? 'cover'})`
      );
    }

    if ((canFireDirect || canFireSuppress) && u.fireTimer <= 0) {
      // Start a new burst if burstShotsRemaining === 0
      if (u.burstShotsRemaining <= 0) {
        const rng = this.ballistics?.rng;
        const minB = weaponProf.roundsPerBurstMin;
        const maxB = weaponProf.roundsPerBurstMax;
        u.burstShotsRemaining = Math.min(
          u.ammoInMag,
          minB + Math.floor((rng ? rng.next() : Math.random()) * (maxB - minB + 1))
        );
        u.burstShotIndex = 0;
      }

      if (u.burstShotsRemaining > 0) {
        this.executeEnemyWeaponShot(
          u,
          cfg,
          weaponProf,
          diffProfile,
          dist,
          canFireSuppress,
          exposedTargetPoint,
          player,
          collision
        );

        u.ammoInMag--;
        u.burstShotsRemaining--;
        u.burstShotIndex++;

        if (u.ammoInMag <= 0) {
          u.isReloading = true;
          u.reloadTimerSec = weaponProf.reloadDurationSec;
          u.burstShotsRemaining = 0;
          this.coordinator?.releaseLease(u.id, 'magazine_empty_reload');
        } else if (u.burstShotsRemaining > 0) {
          u.fireTimer = weaponProf.shotIntervalSec;
        } else {
          const rng = this.ballistics?.rng;
          const pause =
            weaponProf.burstCooldownMinSec +
            (rng ? rng.next() : Math.random()) *
              (weaponProf.burstCooldownMaxSec - weaponProf.burstCooldownMinSec);
          u.fireTimer = pause * diffProfile.burstPauseMultiplier;
        }
      }
    }
  }

  private executeEnemyWeaponShot(
    u: EnemyUnit,
    cfg: (typeof ENEMY_BY_ARCHETYPE)[EnemyArchetype],
    weaponProf: (typeof ENEMY_WEAPON_PROFILES)[EnemyWeaponClass],
    diffProfile: (typeof DIFFICULTY_COMBAT_PROFILES)[Difficulty],
    dist: number,
    isSuppression: boolean,
    exposedTargetPoint: THREE.Vector3,
    player: PlayerController,
    collision: CollisionWorld
  ): void {
    this._muzzlePos.set(
      u.position.x + Math.sin(u.yaw) * 0.45,
      u.position.y + 1.44,
      u.position.z + Math.cos(u.yaw) * 0.45
    );

    if (isSuppression && u.lastKnownPosition) {
      // Aim at cover edge near LKP, NEVER at live player position behind cover!
      const jitterX = ((this.ballistics?.rng.next() ?? 0.5) - 0.5) * 1.1;
      const jitterZ = ((this.ballistics?.rng.next() ?? 0.5) - 0.5) * 1.1;
      this._aimTarget.set(
        u.lastKnownPosition.x + jitterX,
        u.lastKnownPosition.y + 0.15,
        u.lastKnownPosition.z + jitterZ
      );
    } else {
      this._aimTarget.copy(exposedTargetPoint);
    }

    if (weaponProf.isProjectile || cfg.canUseRockets) {
      const rDir = new THREE.Vector3()
        .subVectors(this._aimTarget, this._muzzlePos)
        .normalize();
      this.projectiles.spawn({
        kind: 'enemy_rocket',
        fromPlayer: false,
        origin: this._muzzlePos.clone(),
        direction: rDir,
        speed: 36,
        damage: weaponProf.baseDamage * diffProfile.damageMultiplier,
        blastRadius: 4.8,
        sourceUnitId: u.id,
        sourceSquadId: u.squadId,
        sourceDomain: 'ground',
      });
      this.audio.playSpatial('shot_rocket', u.position.x, u.position.y + 1.5, u.position.z, 5, 0.55);
      this.telemetry?.recordEvent(
        'SHOT_FIRED',
        u.id,
        u.squadId,
        'ground',
        `${u.id} fired RPG rocket`
      );
      return;
    }

    const soundId =
      u.weaponClass === 'enemy_sniper'
        ? 'shot_sniper'
        : u.weaponClass === 'enemy_shotgun'
          ? 'shot_shotgun'
          : u.weaponClass === 'enemy_lmg'
            ? 'shot_lmg'
            : 'shot_rifle';
    this.audio.playSpatial(soundId, u.position.x, u.position.y + 1.5, u.position.z, 4, 0.42);

    if (this.ballistics) {
      const shotRes = this.ballistics.fireWeaponRay(
        {
          unitId: u.id,
          squadId: u.squadId,
          domain: 'ground',
          weaponClass: u.weaponClass,
          muzzleOrigin: this._muzzlePos,
          aimTarget: this._aimTarget,
          distanceMeters: dist,
          unitAccuracy: cfg.accuracy,
          isMoving: u.isMoving,
          aimDurationSec: u.aimDurationSec,
          burstShotIndex: u.burstShotIndex,
          isSuppressedOrStaggered: u.hitReactTimer > 0,
          isSuppressionFire: isSuppression,
          difficultyProfile: diffProfile,
        },
        player,
        collision
      );

      u.lastSpreadRad = shotRes.spreadRad;
      if (shotRes.hitPlayer && shotRes.damageApplied > 0) {
        u.lastDamageDealt = shotRes.damageApplied;
        u.lastDamageTimeSec = this.telemetry?.getElapsedSec() ?? 0;
      }
    }
  }

  private computeReactionDelay(
    u: EnemyUnit,
    dist: number,
    diffProfile: (typeof DIFFICULTY_COMBAT_PROFILES)[Difficulty],
    alreadySuspicious: boolean
  ): number {
    const rng = this.ballistics?.rng;
    const jitter = ((rng ? rng.next() : 0.5) * 2 - 1) * diffProfile.reactionDelayJitterSec;
    const distFactor = Math.min(0.32, Math.max(0, (dist - 15) * 0.0045));
    const roleFactor = u.archetype === 'elite_assault' ? -0.06 : u.archetype === 'heavy_armor' ? 0.08 : 0;
    const stateBonus = alreadySuspicious ? -0.1 : 0;
    return Math.max(0.16, diffProfile.reactionDelayBaseSec + jitter + distFactor + roleFactor + stateBonus);
  }

  private findTacticalCover(
    pos: THREE.Vector3,
    nodes: THREE.Vector3[],
    threatPos: THREE.Vector3,
    preferAway: boolean
  ): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = -1e9;
    for (const n of nodes) {
      const dSelf = pos.distanceTo(n);
      const dThreat = Math.hypot(n.x - threatPos.x, n.z - threatPos.z);
      const score = (preferAway ? dThreat : -Math.abs(dThreat - 22)) - dSelf * 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  private normalizeAngle(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  private stepYawTowards(current: number, target: number, maxStep: number): number {
    const diff = this.normalizeAngle(target - current);
    if (Math.abs(diff) <= maxStep) return target;
    return current + Math.sign(diff) * maxStep;
  }

  getDebugInspectorRows(player: PlayerController): EnemyDebugInspectorRow[] {
    const nowSec = this.telemetry?.getElapsedSec() ?? 0;
    const rows: EnemyDebugInspectorRow[] = [];

    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) continue;
      const cfg = ENEMY_BY_ARCHETYPE[u.archetype];
      const dist = u.position.distanceTo(player.position);
      const lease = this.coordinator?.getUnitLease(u.id) ?? null;
      const waiting = this.coordinator?.isUnitWaiting(u.id) ?? false;
      const stats = this.telemetry?.getEnemyStats(u.id) ?? { damage: 0, hits: 0, shots: 0 };

      const fovDeg =
        u.state === 'UNAWARE' || u.state === 'SUSPICIOUS' || u.state === 'INVESTIGATING'
          ? AUTHORITATIVE_COMBAT_CONFIG.primaryFovDeg
          : AUTHORITATIVE_COMBAT_CONFIG.alertedFovDeg;

      const tokenStatus = lease
        ? lease.kind
        : waiting
          ? 'WAITING'
          : 'NONE';

      rows.push({
        id: u.id,
        displayName: u.displayName,
        squadId: u.squadId,
        domain: 'ground',
        role: u.role,
        state: u.state,
        detectedPlayer: u.detectedPlayer,
        hasLos: u.hasLos,
        losBlockerId: u.losBlockerId,
        distanceMeters: Number(dist.toFixed(1)),
        x: Number(u.position.x.toFixed(1)),
        y: Number(u.position.y.toFixed(1)),
        z: Number(u.position.z.toFixed(1)),
        yaw: u.yaw,
        fovDeg,
        detectionRange: cfg.detectionRange,
        hearingRange: AUTHORITATIVE_COMBAT_CONFIG.hearingSprintMeters,
        lkpX: u.lastKnownPosition ? Number(u.lastKnownPosition.x.toFixed(1)) : null,
        lkpY: u.lastKnownPosition ? Number(u.lastKnownPosition.y.toFixed(1)) : null,
        lkpZ: u.lastKnownPosition ? Number(u.lastKnownPosition.z.toFixed(1)) : null,
        lkpAgeSec: u.lastKnownPosition ? Number(Math.max(0, nowSec - u.lkpTimestampSec).toFixed(1)) : 0,
        reactionTimerSec: Number(u.reactionTimerSec.toFixed(2)),
        fireCooldownSec: Number(u.fireTimer.toFixed(2)),
        ammoInMag: u.ammoInMag,
        magSize: u.magSize,
        isReloading: u.isReloading,
        currentSpreadDeg: Number(((u.lastSpreadRad * 180) / Math.PI).toFixed(2)),
        accuracyPct:
          stats.shots > 0 ? Number(((stats.hits / stats.shots) * 100).toFixed(0)) : Math.round(cfg.accuracy * 100),
        tokenStatus,
        allowedToFire:
          Boolean(lease) &&
          (lease?.kind === 'SUPPRESS' ? !u.hasLos : u.hasLos) &&
          !u.isReloading &&
          u.hitReactTimer <= 0,
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

  hasAnyEnemyWithLos(): boolean {
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].alive && this.enemies[i].hasLos) return true;
    }
    return false;
  }

  getActiveCount(): number {
    let c = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].alive) c++;
    }
    return c;
  }

  getPositionsForProximity(): Array<{ position: THREE.Vector3; radius: number }> {
    const out: Array<{ position: THREE.Vector3; radius: number }> = [];
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].alive) {
        out.push({ position: this.enemies[i].bodyCenter, radius: 0.95 });
      }
    }
    return out;
  }

  getMiniMapBlips(): MiniMapBlip[] {
    const blips: MiniMapBlip[] = [];
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;
      blips.push({ id: e.id, x: e.position.x, z: e.position.z, kind: 'enemy' });
    }
    return blips;
  }

  clear(): void {
    this.enemies = [];
    this.waveSeq = 0;
  }

  getPhysicsInspectorRows(): PhysicsBodyInspectorRow[] {
    const out: PhysicsBodyInspectorRow[] = [];
    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) continue;
      const spd = Math.hypot(u.velocity.x, u.velocity.z);
      out.push({
        id: u.id,
        entityType: 'enemy',
        classification: 'character',
        shape: 'capsule',
        dimensions: 'r=0.40m h=1.75m',
        x: Number(u.position.x.toFixed(2)),
        y: Number(u.position.y.toFixed(2)),
        z: Number(u.position.z.toFixed(2)),
        yaw: Number(u.yaw.toFixed(2)),
        vx: Number(u.velocity.x.toFixed(2)),
        vy: Number(u.velocity.y.toFixed(2)),
        vz: Number(u.velocity.z.toFixed(2)),
        ax: 0,
        ay: 0,
        az: 0,
        speed: Number(spd.toFixed(2)),
        massKg: 80,
        layer: COLLISION_LAYER.ENEMY,
        layerLabel: formatCollisionLayer(COLLISION_LAYER.ENEMY),
        mask: PHYSICS_MASKS.ENEMY_SOLID,
        maskLabel: formatCollisionLayer(PHYSICS_MASKS.ENEMY_SOLID),
        physicalState: 'GROUNDED',
        lastCollisionId: u.lastColliderHit,
        lastNormalX: 0,
        lastNormalY: 1,
        lastNormalZ: 0,
        contactCount: u.activeContacts,
      });
    }
    return out;
  }

  private buildSoldierRig(
    accentHex: string,
    archetype: EnemyArchetype,
    scope: ResourceScope
  ): {
    root: THREE.Group;
    leftLeg: THREE.Object3D;
    rightLeg: THREE.Object3D;
    weaponArm: THREE.Object3D;
    headMesh: THREE.Object3D;
  } {
    const root = new THREE.Group();
    const scale = archetype === 'heavy_armor' ? 1.18 : 1.0;
    root.scale.setScalar(scale);

    const armorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      roughness: 0.65,
      metalness: archetype === 'heavy_armor' ? 0.55 : 0.25,
    });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x332b26, roughness: 0.8 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x181c22, metalness: 0.8, roughness: 0.35 });
    const visorMat = new THREE.MeshStandardMaterial({
      color: archetype === 'sniper' || archetype === 'drone_operator' ? 0x06b6d4 : 0xef4444,
      emissive: archetype === 'sniper' || archetype === 'drone_operator' ? 0x0891b2 : 0xb91c1c,
      emissiveIntensity: 0.85,
    });

    this.resourceManager.registerMaterial(armorMat, scope);
    this.resourceManager.registerMaterial(skinMat, scope);
    this.resourceManager.registerMaterial(gunMat, scope);
    this.resourceManager.registerMaterial(visorMat, scope);

    const torsoGeo = new THREE.BoxGeometry(0.52, 0.64, 0.32);
    const legGeo = new THREE.BoxGeometry(0.19, 0.72, 0.2);
    const headGeo = new THREE.BoxGeometry(0.28, 0.3, 0.28);
    const visorGeo = new THREE.BoxGeometry(0.24, 0.08, 0.06);
    const armGeo = new THREE.BoxGeometry(0.14, 0.14, 0.45);
    const rifleGeo = new THREE.BoxGeometry(0.08, 0.1, 0.68);
    [torsoGeo, legGeo, headGeo, visorGeo, armGeo, rifleGeo].forEach((g) =>
      this.resourceManager.registerGeometry(g, scope)
    );

    const torso = new THREE.Mesh(torsoGeo, armorMat);
    torso.position.y = 1.06;
    torso.castShadow = true;
    root.add(torso);

    const leftLeg = new THREE.Mesh(legGeo, armorMat);
    leftLeg.position.set(-0.14, 0.38, 0);
    leftLeg.castShadow = true;
    root.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, armorMat);
    rightLeg.position.set(0.14, 0.38, 0);
    rightLeg.castShadow = true;
    root.add(rightLeg);

    const headMesh = new THREE.Group();
    headMesh.position.set(0, 1.56, 0);
    const head = new THREE.Mesh(headGeo, armorMat);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.02, 0.14);
    headMesh.add(head, visor);
    root.add(headMesh);

    const weaponArm = new THREE.Group();
    weaponArm.position.set(0.32, 1.24, 0.15);
    const arm = new THREE.Mesh(armGeo, skinMat);
    const rifle = new THREE.Mesh(rifleGeo, gunMat);
    rifle.position.set(-0.08, -0.02, 0.26);
    weaponArm.add(arm, rifle);
    root.add(weaponArm);

    return { root, leftLeg, rightLeg, weaponArm, headMesh };
  }
}
