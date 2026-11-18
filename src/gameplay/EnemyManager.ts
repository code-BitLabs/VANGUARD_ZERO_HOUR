import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { ENEMY_BY_ARCHETYPE } from '@/src/data/enemies';
import { VFXPool } from '@/src/effects/VFXPool';
import { formatCollisionLayer, PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import type { CharacterMoveResult, PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
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
import { IncomingThreatWarning, MiniMapBlip } from '@/src/schemas/events.schema';
import {
  AgentProfileId,
  getAgentTraversalProfile,
  PortalKind,
} from '@/src/navigation/AgentTraversalProfile';
import { WorkerBridge } from '@/src/workers/WorkerBridge';
import { buildSoldierRig } from '@/src/world/rigs/EnemyRigBuilder';
import { BallisticSolver, SOLID_OBSTRUCTION_MASK } from './BallisticSolver';
import { CargoLiftManager, CargoLiftOccupantProxy } from './CargoLiftManager';
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
  hasValidWaypoint: boolean;
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
  avoidanceDirX: number;
  avoidanceDirZ: number;
  avoidanceLatchTimerSec: number;
  meshRoot: THREE.Group;
  pelvisGroup: THREE.Group;
  torsoGroup: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  weaponArm: THREE.Object3D;
  rightForearm: THREE.Group;
  leftArm: THREE.Group;
  leftForearm: THREE.Group;
  headMesh: THREE.Object3D;
  muzzleFlash: THREE.Mesh;
  hipRestY: number;
  animCrouchBlend: number;
  animAimBlend: number;
  animFireRecoilTimer: number;
  animMuzzleFlashTimer: number;
  animHitDirYaw: number;
  animHitHeadshot: boolean;
  animPrevYaw: number;
  animTurnLean: number;
  animTime: number;
  hasSpawnedDrone: boolean;
  healthDropEvaluated: boolean;
  telegraphTimerSec: number;
  telegraphDurationSec: number;
  telegraphKind: 'sniper' | 'rocket' | null;
  agentProfile: AgentProfileId;
  activePortalId: number;
  activePortalKind: PortalKind | null;
  targetLiftId: string | null;
  targetFloorIndex: number;
  portalWaitTimerSec: number;
  isRidingLift: boolean;
}

const WHISKER_COS_35 = Math.cos((35 * Math.PI) / 180);
const WHISKER_SIN_35 = Math.sin((35 * Math.PI) / 180);

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
  private readonly _rocketDir = new THREE.Vector3();
  private readonly _coverCandScratch = new THREE.Vector3();
  private readonly _coverRayHit: RayHit = {
    hit: false,
    distance: 0,
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 0,
    normalZ: 0,
    collider: null,
  };
  private readonly _whiskerRayHit: RayHit = {
    hit: false,
    distance: 0,
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 0,
    normalZ: 0,
    collider: null,
  };
  private readonly _moveResultScratch: CharacterMoveResult = {
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
  private readonly _hitscanPool: Array<{
    target: HitscanTarget;
    unit: EnemyUnit | null;
    cb: ((unit: EnemyUnit, damage: number, isHeadshot: boolean, killed: boolean) => void) | null;
  }> = [];
  private readonly _proxPool: Array<{ position: THREE.Vector3; radius: number }> = [];
  private readonly _blipPool: MiniMapBlip[] = [];
  private readonly _liftProxyPool: CargoLiftOccupantProxy[] = [];
  private cargoLiftManager: CargoLiftManager | null = null;
  private activeWorkerBridge: WorkerBridge | null = null;
  private sniperLaserLine: THREE.Line | null = null;
  private sniperLaserPositions: Float32Array | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly resourceManager: ResourceManager,
    private readonly vfx: VFXPool,
    private readonly audio: AudioManager,
    private readonly projectiles: ProjectileManager,
    private readonly coordinator?: CombatEngagementCoordinator,
    private readonly ballistics?: BallisticSolver,
    private readonly telemetry?: CombatTelemetryRecorder
  ) {
    const laserPositions = new Float32Array(6);
    const laserGeo = new THREE.BufferGeometry();
    laserGeo.setAttribute('position', new THREE.BufferAttribute(laserPositions, 3));
    const laserMat = new THREE.LineBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.82,
    });
    this.resourceManager.registerGeometry(laserGeo, 'shared', 'sniper_laser_geo');
    this.resourceManager.registerMaterial(laserMat, 'shared', 'sniper_laser_mat');
    const laserLine = new THREE.Line(laserGeo, laserMat);
    laserLine.frustumCulled = false;
    laserLine.visible = false;
    this.scene.add(laserLine);
    this.resourceManager.register('object3d', 'shared', () => this.scene.remove(laserLine));
    this.sniperLaserLine = laserLine;
    this.sniperLaserPositions = laserPositions;
  }

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    const prof = DIFFICULTY_COMBAT_PROFILES[difficulty];
    this.difficultyMult = prof.damageMultiplier;
    this.coordinator?.setDifficulty(difficulty);
    for (let i = 0; i < this.enemies.length; i++) {
      this.syncUnitHitboxes(this.enemies[i]);
    }
  }

  setCargoLiftManager(mgr: CargoLiftManager | null): void {
    this.cargoLiftManager = mgr;
  }

  setWorkerBridge(bridge: WorkerBridge | null): void {
    this.activeWorkerBridge = bridge;
  }

  fillLiftOccupantProxies(player: PlayerController, out: CargoLiftOccupantProxy[]): void {
    out.length = 0;
    let slotIdx = 0;
    const ensureProxy = (
      id: string,
      isPlayer: boolean,
      pos: THREE.Vector3,
      vel: THREE.Vector3,
      height: number
    ) => {
      let proxy = this._liftProxyPool[slotIdx];
      if (!proxy) {
        proxy = { id, isPlayer, pos, vel, height };
        this._liftProxyPool.push(proxy);
      } else {
        proxy.id = id;
        proxy.isPlayer = isPlayer;
        proxy.pos = pos;
        proxy.vel = vel;
        proxy.height = height;
      }
      out.push(proxy);
      slotIdx++;
    };

    if (player.alive) {
      ensureProxy('player', true, player.position, player.velocity, player.isCrouching ? 1.15 : 1.8);
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) continue;
      const prof = getAgentTraversalProfile(u.agentProfile);
      ensureProxy(u.id, false, u.position, u.velocity, prof.standingHeight);
    }
  }

  getUnits(): readonly EnemyUnit[] {
    return this.enemies;
  }

  getActiveThreatWarning(player: PlayerController): IncomingThreatWarning | null {
    let bestUnit: EnemyUnit | null = null;
    let bestProgress = -1;

    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive || !u.telegraphKind || u.telegraphDurationSec <= 0 || u.telegraphTimerSec <= 0) {
        continue;
      }
      const progress = Math.min(
        1,
        Math.max(0, 1 - u.telegraphTimerSec / Math.max(0.05, u.telegraphDurationSec))
      );
      if (progress > bestProgress) {
        bestProgress = progress;
        bestUnit = u;
      }
    }

    if (!bestUnit || !bestUnit.telegraphKind) return null;

    return {
      kind: bestUnit.telegraphKind,
      label:
        bestUnit.telegraphKind === 'sniper'
          ? 'SNIPER LASER LOCK — TAKE COVER'
          : 'INCOMING RPG LOCK — EVADE',
      progress: Number(bestProgress.toFixed(2)),
      angleRad: player.computeRelativeThreatAngle(bestUnit.position.x, bestUnit.position.z),
    };
  }

  private syncUnitHitboxes(u: EnemyUnit): void {
    const baseScale = u.archetype === 'heavy_armor' ? 1.22 : 1.1;
    const hitboxScale = DIFFICULTY_COMBAT_PROFILES[this.difficulty].enemyHitboxScale;
    const widthScale = baseScale * hitboxScale;
    const stanceScale = 1 - 0.22 * u.animCrouchBlend;
    const px = u.position.x;
    const py = u.position.y;
    const pz = u.position.z;

    // Contiguous 3-zone vertical hit volumes with zero gaps:
    // Lower body (legs): 0.00 -> 0.75 * baseScale * stanceScale
    // Upper torso: 0.75 -> 1.45 * baseScale * stanceScale
    // Head sphere: centered at 1.65 * baseScale * stanceScale (radius 0.32 * widthScale spans 1.33..1.97)
    const legTopY = py + 0.75 * baseScale * stanceScale;
    const torsoTopY = py + 1.45 * baseScale * stanceScale;

    u.headPosition.set(px, py + 1.65 * baseScale * stanceScale, pz);
    u.bodyCenter.set(px, (legTopY + torsoTopY) * 0.5, pz);
    u.lowerBodyCenter.set(px, (py + legTopY) * 0.5, pz);

    const torsoHalfW = 0.39 * widthScale;
    u.torsoBoxMin.set(px - torsoHalfW, legTopY, pz - torsoHalfW);
    u.torsoBoxMax.set(px + torsoHalfW, torsoTopY, pz + torsoHalfW);

    const lowerHalfW = 0.35 * widthScale;
    u.lowerBodyBoxMin.set(px - lowerHalfW, py, pz - lowerHalfW);
    u.lowerBodyBoxMax.set(px + lowerHalfW, legTopY, pz + lowerHalfW);
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
    const agentProfile: AgentProfileId =
      archetype === 'heavy_armor' ? 'heavy_infantry' : 'standard_infantry';
    const traversalProfile = getAgentTraversalProfile(agentProfile);
    const squadId = customSquadId ?? `squad_${++this.waveSeq}_${archetype}`;
    const rng = this.ballistics?.rng;
    const diffProf = DIFFICULTY_COMBAT_PROFILES[this.difficulty];
    const elevatedSpawn = center.y > 0.4;

    for (let i = 0; i < count; i++) {
      const randA = rng ? rng.next() : Math.random();
      const randR = rng ? rng.next() : Math.random();
      const a = (i / Math.max(1, count)) * Math.PI * 2 + randA * 0.45;
      const r =
        count <= 1
          ? 0
          : elevatedSpawn || radius < 2.5
            ? Math.min(radius, 0.75 + randR * Math.max(0.25, radius - 0.75))
            : 2 + randR * Math.max(0.5, radius - 2);
      const x = Math.max(-105, Math.min(105, center.x + Math.cos(a) * r));
      const z = Math.max(-105, Math.min(105, center.z + Math.sin(a) * r));
      const y = elevatedSpawn
        ? collision.getSupportHeightAt(
            x,
            center.y + 0.8,
            z,
            traversalProfile.standingHeight,
            traversalProfile.maxStepHeight,
            traversalProfile.maxSlopeDeg
          )
        : collision.getGroundHeightAt(x, z);
      const spawnPos = new THREE.Vector3(x, y, z);
      const spawnVel = new THREE.Vector3(0, 0, 0);
      const unitId = `enemy_${++this.seq}`;
      // Push spawn position out of any solid walls or barriers immediately
      collision.resolvePlayerCapsule(
        spawnPos,
        spawnVel,
        traversalProfile.capsuleRadius,
        traversalProfile.standingHeight,
        traversalProfile.maxStepHeight,
        0.016,
        unitId,
        undefined,
        undefined,
        traversalProfile.maxSlopeDeg
      );

      const rig = buildSoldierRig(cfg.accentColor, archetype, scope, this.resourceManager);
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
        hasValidWaypoint: false,
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
        avoidanceDirX: 0,
        avoidanceDirZ: 0,
        avoidanceLatchTimerSec: 0,
        meshRoot: rig.root,
        pelvisGroup: rig.pelvisGroup,
        torsoGroup: rig.torsoGroup,
        leftLeg: rig.leftLeg,
        rightLeg: rig.rightLeg,
        leftKnee: rig.leftKnee,
        rightKnee: rig.rightKnee,
        weaponArm: rig.weaponArm,
        rightForearm: rig.rightForearm,
        leftArm: rig.leftArm,
        leftForearm: rig.leftForearm,
        headMesh: rig.headMesh,
        muzzleFlash: rig.muzzleFlash,
        hipRestY: rig.hipRestY,
        animCrouchBlend: 0,
        animAimBlend: 0,
        animFireRecoilTimer: 0,
        animMuzzleFlashTimer: 0,
        animHitDirYaw: 0,
        animHitHeadshot: false,
        animPrevYaw: patrolYaw,
        animTurnLean: 0,
        animTime: (i * 0.43) % 6.28,
        hasSpawnedDrone: false,
        healthDropEvaluated: false,
        telegraphTimerSec: 0,
        telegraphDurationSec: 0,
        telegraphKind: null,
        agentProfile,
        activePortalId: -1,
        activePortalKind: null,
        targetLiftId: null,
        targetFloorIndex: -1,
        portalWaitTimerSec: 0,
        isRidingLift: false,
      };
      this.syncUnitHitboxes(unit);
      this.enemies.push(unit);
    }
  }

  fillHitscanTargets(
    out: HitscanTarget[],
    onEnemyHit: (unit: EnemyUnit, damage: number, isHeadshot: boolean, killed: boolean) => void
  ): void {
    let slotIdx = 0;
    const hitboxScale = DIFFICULTY_COMBAT_PROFILES[this.difficulty].enemyHitboxScale;
    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) continue;
      const scale = (u.archetype === 'heavy_armor' ? 1.22 : 1.1) * hitboxScale;
      let slot = this._hitscanPool[slotIdx];
      if (!slot) {
        const newSlot: {
          target: HitscanTarget;
          unit: EnemyUnit | null;
          cb: ((unit: EnemyUnit, damage: number, isHeadshot: boolean, killed: boolean) => void) | null;
        } = {
          unit: null,
          cb: null,
          target: {
            id: u.id,
            kind: 'enemy',
            name: u.displayName,
            alive: true,
            position: u.bodyCenter,
            hitRadius: 0.56 * scale,
            headPosition: u.headPosition,
            headRadius: 0.32 * scale,
            lowerBodyPosition: u.lowerBodyCenter,
            lowerBodyRadius: 0.42 * scale,
            torsoBoxMin: u.torsoBoxMin,
            torsoBoxMax: u.torsoBoxMax,
            lowerBodyBoxMin: u.lowerBodyBoxMin,
            lowerBodyBoxMax: u.lowerBodyBoxMax,
            onHit: (damage, isHeadshot, hitPoint) => {
              const cur = newSlot.unit;
              if (!cur) return;
              const killed = this.damageUnit(cur, damage, isHeadshot, hitPoint);
              newSlot.cb?.(cur, damage, isHeadshot, killed);
            },
          },
        };
        this._hitscanPool.push(newSlot);
        slot = newSlot;
      }
      slot.unit = u;
      slot.cb = onEnemyHit;
      const t = slot.target;
      t.id = u.id;
      t.name = u.displayName;
      t.alive = u.alive;
      t.position = u.bodyCenter;
      t.hitRadius = 0.56 * scale;
      t.headPosition = u.headPosition;
      t.headRadius = 0.32 * scale;
      t.lowerBodyPosition = u.lowerBodyCenter;
      t.lowerBodyRadius = 0.42 * scale;
      t.torsoBoxMin = u.torsoBoxMin;
      t.torsoBoxMax = u.torsoBoxMax;
      t.lowerBodyBoxMin = u.lowerBodyBoxMin;
      t.lowerBodyBoxMax = u.lowerBodyBoxMax;
      out.push(t);
      slotIdx++;
    }
  }

  getHitscanTargets(
    onEnemyHit: (unit: EnemyUnit, damage: number, isHeadshot: boolean, killed: boolean) => void
  ): HitscanTarget[] {
    const out: HitscanTarget[] = [];
    const hitboxScale = DIFFICULTY_COMBAT_PROFILES[this.difficulty].enemyHitboxScale;
    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) continue;
      const scale = (u.archetype === 'heavy_armor' ? 1.22 : 1.1) * hitboxScale;
      out.push({
        id: u.id,
        kind: 'enemy',
        name: u.displayName,
        alive: u.alive,
        position: u.bodyCenter,
        hitRadius: 0.56 * scale,
        headPosition: u.headPosition,
        headRadius: 0.32 * scale,
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
    unit.animHitHeadshot = isHeadshot;
    if (stimulusOrigin) {
      const hitWorldYaw = Math.atan2(stimulusOrigin.x - unit.position.x, stimulusOrigin.z - unit.position.z);
      unit.animHitDirYaw = this.normalizeAngle(hitWorldYaw - unit.yaw);
    } else {
      unit.animHitDirYaw = 0;
    }

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
      this.cargoLiftManager?.cancelRequestsForEntity(unit.id);
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
    this.activeWorkerBridge = workerBridge;
    const px = player.position.x;
    const py = player.position.y;
    const pz = player.position.z;

    // Batch off-thread Hierarchical Multi-Elevation 3D A* path requests every 0.45s
    this.pathSyncAccum += dt;
    if (this.pathSyncAccum >= 0.45) {
      this.pathSyncAccum = 0;
      const activeToRoute = this.enemies
        .filter(
          (e) =>
            e.alive &&
            !e.isRidingLift &&
            e.state !== 'DEAD' &&
            e.state !== 'UNAWARE' &&
            e.state !== 'SUSPICIOUS' &&
            (e.coverTarget !== null || e.lastKnownPosition !== null)
        )
        .slice(0, 8);
      if (activeToRoute.length > 0 && workerBridge.isHealthy()) {
        const queries3D = activeToRoute.map((e) => {
          const target =
            e.coverTarget && (e.state === 'REPOSITIONING' || e.state === 'RETREATING')
              ? e.coverTarget
              : (e.lastKnownPosition ?? e.patrolOrigin);
          const targetY =
            e.coverTarget && (e.state === 'REPOSITIONING' || e.state === 'RETREATING')
              ? e.coverTarget.y
              : e.lastKnownPosition
                ? Math.max(0, e.lastKnownPosition.y - 1.0)
                : e.patrolOrigin.y;
          return {
            sx: e.position.x,
            sy: e.position.y,
            sz: e.position.z,
            tx: target.x,
            ty: Number.isFinite(targetY) ? targetY : py,
            tz: target.z,
            profileId: e.agentProfile,
          };
        });
        void workerBridge.requestPaths3D(queries3D).then((waypoints) => {
          if (!waypoints || this.enemies.length === 0) return;
          for (let i = 0; i < Math.min(waypoints.length, activeToRoute.length); i++) {
            const u = activeToRoute[i];
            const wp = waypoints[i];
            if (u.alive && !u.isRidingLift) {
              u.waypoint.set(wp.wx, wp.wy, wp.wz);
              u.hasValidWaypoint = true;
              u.activePortalId = wp.portalId;
              u.activePortalKind = wp.portalKind;
              u.targetLiftId = wp.liftId;
              u.targetFloorIndex = wp.targetFloorIndex;
            }
          }
        });
      }
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) {
        u.deathTimer += dt;
        this.stepUnitDeathAnimation(u);
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

      this.stepUnitAnimation(u, dt, player, dist);
      this.syncUnitHitboxes(u);
    }

    // Update 3D sniper laser sight line for active sniper telegraph
    if (this.sniperLaserLine && this.sniperLaserPositions) {
      let laserUnit: EnemyUnit | null = null;
      for (let i = 0; i < this.enemies.length; i++) {
        const u = this.enemies[i];
        if (u.alive && u.telegraphKind === 'sniper' && u.telegraphTimerSec > 0 && u.hasLos) {
          laserUnit = u;
          break;
        }
      }
      if (laserUnit && player.alive) {
        const crouchYOffset = laserUnit.animCrouchBlend * 0.24;
        this.sniperLaserPositions[0] = laserUnit.position.x + Math.sin(laserUnit.yaw) * 0.5;
        this.sniperLaserPositions[1] = laserUnit.position.y + 1.48 - crouchYOffset;
        this.sniperLaserPositions[2] = laserUnit.position.z + Math.cos(laserUnit.yaw) * 0.5;
        this.sniperLaserPositions[3] = player.position.x;
        this.sniperLaserPositions[4] = player.position.y + (player.isCrouching ? 0.9 : 1.35);
        this.sniperLaserPositions[5] = player.position.z;
        const posAttr = this.sniperLaserLine.geometry.getAttribute('position');
        posAttr.needsUpdate = true;
        this.sniperLaserLine.visible = true;
      } else {
        this.sniperLaserLine.visible = false;
      }
    }
  }

  private stepUnitDeathAnimation(u: EnemyUnit): void {
    u.muzzleFlash.visible = false;
    u.animMuzzleFlashTimer = 0;

    const rawT = Math.min(1, u.deathTimer / 0.52);
    const t = rawT * rawT * (3 - 2 * rawT);
    const idNum = parseInt(u.id.split('_')[1] ?? '1', 10) || 1;
    const fallForwardSign = idNum % 2 === 0 ? 1 : -1;

    const hipY = THREE.MathUtils.lerp(u.hipRestY, 0.16, t);
    u.meshRoot.position.copy(u.position);
    u.meshRoot.rotation.set(0, u.yaw, 0);

    u.pelvisGroup.position.y = hipY;
    u.torsoGroup.position.y = hipY;
    u.leftLeg.position.y = hipY;
    u.rightLeg.position.y = hipY;

    // Knees buckle while torso slumps cleanly to ground level
    u.leftLeg.rotation.set(-0.92 * t, 0, -0.1 * t);
    u.rightLeg.rotation.set(-0.48 * t, 0, 0.1 * t);
    u.leftKnee.rotation.x = 1.48 * t;
    u.rightKnee.rotation.x = 1.12 * t;

    u.torsoGroup.rotation.set(fallForwardSign * 1.32 * t, 0, 0.24 * fallForwardSign * t);
    u.headMesh.rotation.set(0.38 * fallForwardSign * t, 0.18 * t, 0);
    u.weaponArm.rotation.set(0.45 * t, -0.2 * t, 0.42 * t);
    u.rightForearm.rotation.set(0.25 * t, 0, 0);
    u.leftArm.rotation.set(0.38 * t, 0.2 * t, -0.35 * t);
    u.leftForearm.rotation.set(0.2 * t, 0, 0);
  }

  private stepUnitAnimation(
    u: EnemyUnit,
    dt: number,
    player: PlayerController,
    dist: number
  ): void {
    u.animTime += dt;
    u.hitReactTimer = Math.max(0, u.hitReactTimer - dt);
    u.animFireRecoilTimer = Math.max(0, u.animFireRecoilTimer - dt);
    u.animMuzzleFlashTimer = Math.max(0, u.animMuzzleFlashTimer - dt);

    const flashActive = u.animMuzzleFlashTimer > 0;
    u.muzzleFlash.visible = flashActive;
    if (flashActive) {
      u.muzzleFlash.rotation.z += dt * 48;
      const flicker = 0.8 + 0.45 * Math.abs(Math.sin(u.animTime * 90));
      u.muzzleFlash.scale.setScalar(flicker);
    }

    u.meshRoot.position.copy(u.position);
    u.meshRoot.rotation.y = u.yaw;

    // Turn angular velocity lean
    const safeDt = Math.max(dt, 1e-4);
    const yawDelta = this.normalizeAngle(u.yaw - u.animPrevYaw);
    u.animPrevYaw = u.yaw;
    const targetTurnLean = THREE.MathUtils.clamp(-(yawDelta / safeDt) * 0.025, -0.14, 0.14);
    u.animTurnLean = THREE.MathUtils.lerp(u.animTurnLean, targetTurnLean, 1 - Math.exp(-12 * dt));

    // Tactical crouch / cover posture when reloading or stationary at cover / suppressing / retreating
    const wantsCrouch =
      u.isReloading ||
      (!u.isMoving &&
        (u.coverTarget !== null || u.state === 'SUPPRESSING' || u.state === 'RETREATING'));
    u.animCrouchBlend = THREE.MathUtils.lerp(
      u.animCrouchBlend,
      wantsCrouch ? 1 : 0,
      1 - Math.exp(-9.5 * dt)
    );

    const targetAim =
      u.state === 'ENGAGING' || u.state === 'ALERTED' || u.state === 'SUPPRESSING'
        ? 1
        : u.state === 'SUSPICIOUS' ||
            u.state === 'INVESTIGATING' ||
            u.state === 'SEARCHING' ||
            u.state === 'REPOSITIONING'
          ? 0.55
          : 0;
    u.animAimBlend = THREE.MathUtils.lerp(
      u.animAimBlend,
      targetAim,
      1 - Math.exp(-11 * dt)
    );

    // Speed-synced gait cycle (eliminates foot sliding)
    const groundSpeed = u.isMoving ? Math.hypot(u.velocity.x, u.velocity.z) : 0;
    const moveFactor = Math.min(1, groundSpeed / 1.2);
    if (groundSpeed > 0.15) {
      u.walkPhase += dt * groundSpeed * 2.55;
    }

    const strideAmp =
      Math.min(0.68, groundSpeed * 0.155) * (1 - 0.25 * u.animCrouchBlend) * moveFactor;
    const sinP = Math.sin(u.walkPhase);

    const idleLeftHip = -0.58 * u.animCrouchBlend - 0.08 * u.animAimBlend;
    const idleRightHip = -0.32 * u.animCrouchBlend + 0.1 * u.animAimBlend;
    const moveLeftHip = sinP * strideAmp - 0.52 * u.animCrouchBlend;
    const moveRightHip = -sinP * strideAmp - 0.34 * u.animCrouchBlend;

    const legDamp = 1 - Math.exp(-14 * dt);
    u.leftLeg.rotation.x = THREE.MathUtils.lerp(
      u.leftLeg.rotation.x,
      THREE.MathUtils.lerp(idleLeftHip, moveLeftHip, moveFactor),
      legDamp
    );
    u.rightLeg.rotation.x = THREE.MathUtils.lerp(
      u.rightLeg.rotation.x,
      THREE.MathUtils.lerp(idleRightHip, moveRightHip, moveFactor),
      legDamp
    );

    // Anatomical knee flexion (never hyperextends negative)
    const idleLeftKnee = 0.08 + 1.12 * u.animCrouchBlend;
    const idleRightKnee = 0.08 + 0.72 * u.animCrouchBlend;
    const moveLeftKnee = Math.max(0.06, -sinP * 0.62 * moveFactor) + 0.1 + 1.05 * u.animCrouchBlend;
    const moveRightKnee = Math.max(0.06, sinP * 0.62 * moveFactor) + 0.1 + 0.68 * u.animCrouchBlend;

    u.leftKnee.rotation.x = THREE.MathUtils.lerp(
      u.leftKnee.rotation.x,
      THREE.MathUtils.lerp(idleLeftKnee, moveLeftKnee, moveFactor),
      legDamp
    );
    u.rightKnee.rotation.x = THREE.MathUtils.lerp(
      u.rightKnee.rotation.x,
      THREE.MathUtils.lerp(idleRightKnee, moveRightKnee, moveFactor),
      legDamp
    );

    // Pelvis height coupling (crouch drop + subtle grounded walk bounce)
    const walkBobY =
      groundSpeed > 0.15 ? Math.abs(sinP) * 0.032 * Math.min(1, groundSpeed / 4.2) : 0;
    const hipY = u.hipRestY - 0.24 * u.animCrouchBlend + walkBobY;
    u.pelvisGroup.position.y = hipY;
    u.torsoGroup.position.y = hipY;
    u.leftLeg.position.y = hipY;
    u.rightLeg.position.y = hipY;

    // Hit stagger envelope (0 -> 1 -> 0 bell across 0.22s)
    const hitEnv = u.hitReactTimer > 0 ? Math.sin((u.hitReactTimer / 0.22) * Math.PI) : 0;
    const hitPitch = -hitEnv * (u.animHitHeadshot ? 0.36 : 0.24);
    const hitTwist = hitEnv * Math.sin(u.animHitDirYaw) * 0.32;

    // Forward sprint lean + torso counter-twist + turn lean
    const forwardLean = 0.14 * moveFactor + 0.16 * u.animCrouchBlend;
    const walkTwist = -sinP * 0.08 * moveFactor;
    u.torsoGroup.rotation.set(
      forwardLean + hitPitch,
      walkTwist + hitTwist + (u.isReloading ? 0.18 : 0),
      u.animTurnLean + hitEnv * Math.cos(u.animHitDirYaw) * 0.08
    );

    // Aim pitch toward target elevation
    let targetPitch = 0;
    if (u.state === 'ENGAGING' || u.state === 'ALERTED' || u.state === 'SUPPRESSING') {
      const targetY =
        u.hasLos
          ? player.position.y + (player.isCrouching ? 0.95 : 1.35)
          : (u.lastKnownPosition?.y ?? u.position.y + 1.3);
      targetPitch = THREE.MathUtils.clamp(
        Math.atan2(targetY - (u.position.y + 1.38), Math.max(2.5, dist)),
        -0.55,
        0.55
      );
    }

    const headScanYaw = u.state === 'UNAWARE' ? Math.sin(u.animTime * 1.15) * 0.24 : 0;
    u.headMesh.rotation.x = THREE.MathUtils.lerp(
      u.headMesh.rotation.x,
      -targetPitch * 0.72 - hitEnv * (u.animHitHeadshot ? 0.52 : 0.22) + (u.isReloading ? 0.22 : 0),
      1 - Math.exp(-12 * dt)
    );
    u.headMesh.rotation.y = THREE.MathUtils.lerp(
      u.headMesh.rotation.y,
      headScanYaw - walkTwist * 0.6,
      1 - Math.exp(-8 * dt)
    );

    // Fire recoil impulse & two-handed weapon arm / reload choreography
    const recoilAlpha = u.animFireRecoilTimer > 0 ? u.animFireRecoilTimer / 0.095 : 0;
    const armDamp = 1 - Math.exp(-16 * dt);

    if (u.isReloading) {
      const reloadPulse = Math.sin(u.animTime * 9.5);
      u.weaponArm.rotation.x = THREE.MathUtils.lerp(u.weaponArm.rotation.x, -0.36 + reloadPulse * 0.08, armDamp);
      u.weaponArm.rotation.y = THREE.MathUtils.lerp(u.weaponArm.rotation.y, -0.26, armDamp);
      u.rightForearm.rotation.x = THREE.MathUtils.lerp(u.rightForearm.rotation.x, -0.15, armDamp);

      u.leftArm.rotation.x = THREE.MathUtils.lerp(u.leftArm.rotation.x, -0.24 + reloadPulse * 0.22, armDamp);
      u.leftArm.rotation.y = THREE.MathUtils.lerp(u.leftArm.rotation.y, 0.34, armDamp);
      u.leftForearm.rotation.x = THREE.MathUtils.lerp(u.leftForearm.rotation.x, -0.35 - reloadPulse * 0.15, armDamp);
    } else {
      const carryPitch = 0.34; // UNAWARE relaxed low-ready
      const alertPitch = -0.12; // INVESTIGATING / SEARCHING
      const aimPitch = -0.28 - targetPitch; // ALERTED / ENGAGING / SUPPRESSING

      const baseArmPitch =
        u.animAimBlend <= 0.55
          ? THREE.MathUtils.lerp(carryPitch, alertPitch, u.animAimBlend / 0.55)
          : THREE.MathUtils.lerp(alertPitch, aimPitch, (u.animAimBlend - 0.55) / 0.45);

      const armSwing = -sinP * 0.16 * moveFactor * (1 - 0.75 * u.animAimBlend);
      const targetRightArmX = baseArmPitch - hitEnv * 0.32 - recoilAlpha * 0.18 + armSwing;
      const targetRightArmY = THREE.MathUtils.lerp(-0.18, 0.04, u.animAimBlend);

      u.weaponArm.rotation.x = THREE.MathUtils.lerp(u.weaponArm.rotation.x, targetRightArmX, armDamp);
      u.weaponArm.rotation.y = THREE.MathUtils.lerp(u.weaponArm.rotation.y, targetRightArmY, armDamp);
      u.rightForearm.rotation.x = THREE.MathUtils.lerp(
        u.rightForearm.rotation.x,
        -recoilAlpha * 0.24,
        1 - Math.exp(-24 * dt)
      );

      // Left support arm reaches smoothly across to foregrip as aimBlend rises
      const targetLeftArmX = THREE.MathUtils.lerp(0.22 + sinP * 0.25 * moveFactor, -0.34 - targetPitch * 0.85, u.animAimBlend);
      const targetLeftArmY = THREE.MathUtils.lerp(0.08, 0.44, u.animAimBlend);
      const targetLeftForeX = THREE.MathUtils.lerp(0.05, -0.22 - recoilAlpha * 0.12, u.animAimBlend);

      u.leftArm.rotation.x = THREE.MathUtils.lerp(u.leftArm.rotation.x, targetLeftArmX, armDamp);
      u.leftArm.rotation.y = THREE.MathUtils.lerp(u.leftArm.rotation.y, targetLeftArmY, armDamp);
      u.leftForearm.rotation.x = THREE.MathUtils.lerp(u.leftForearm.rotation.x, targetLeftForeX, armDamp);
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
      u.coverTarget = this.findTacticalCover(
        u,
        coverNodes,
        u.lastKnownPosition ?? player.position,
        true,
        collision
      );
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
                  u,
                  coverNodes,
                  u.lastKnownPosition ?? u.position,
                  false,
                  collision
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
            if (!u.coverTarget) {
              u.coverTarget = this.findTacticalCover(
                u,
                coverNodes,
                u.lastKnownPosition ?? player.position,
                false,
                collision
              );
            }
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
                u,
                coverNodes,
                u.lastKnownPosition ?? u.position,
                false,
                collision
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
    let holdForLift = false;
    const agentProf = getAgentTraversalProfile(u.agentProfile);
    const preferredRange =
      u.archetype === 'sniper' ? 52 : u.archetype === 'rocket_trooper' ? 40 : 22;
    const wpDist = Math.hypot(u.waypoint.x - u.position.x, u.waypoint.z - u.position.z);
    if (u.hasValidWaypoint && wpDist <= 0.6 && !u.targetLiftId) {
      u.hasValidWaypoint = false;
    }
    const hasWaypoint = u.hasValidWaypoint && (wpDist > 0.6 || u.targetLiftId !== null);

    // Multi-stop cargo lift coordination for AI vertical traversal
    if (u.targetLiftId && this.cargoLiftManager) {
      const portal =
        u.activePortalId >= 0 ? this.activeWorkerBridge?.getPortalById(u.activePortalId) ?? null : null;
      const fromFloor = portal?.fromFloorIndex ?? 0;
      const toFloor = u.targetFloorIndex >= 0 ? u.targetFloorIndex : (portal?.toFloorIndex ?? 1);
      const liftInfo = this.cargoLiftManager.getLiftRuntimeInfo(u.targetLiftId);

      if (portal && Math.abs(u.position.y - portal.toY) < 0.75) {
        // Arrived at target deck elevation: walk cleanly off lift toward portal exit
        u.isRidingLift = false;
        u.targetLiftId = null;
        u.activePortalId = -1;
        u.activePortalKind = null;
        u.waypoint.set(portal.toX, portal.toY, portal.toZ);
        u.hasValidWaypoint = true;
      } else if (liftInfo) {
        this.cargoLiftManager.requestLiftForAI(u.targetLiftId, u.id, fromFloor, toFloor);
        const distToWait = portal
          ? Math.hypot(portal.fromX - u.position.x, portal.fromZ - u.position.z)
          : 99;
        const canBoard = this.cargoLiftManager.canAiBoardLift(u.targetLiftId, u.id, fromFloor);
        if (
          u.isRidingLift ||
          (liftInfo.state === 'traveling' || liftInfo.state === 'doors_closing' || liftInfo.state === 'docking')
        ) {
          if (wpDist < 2.2) {
            u.isRidingLift = true;
            holdForLift = true;
          } else if (distToWait < 1.6 && !canBoard) {
            holdForLift = true;
          }
        } else if (!canBoard && distToWait < 1.6) {
          holdForLift = true;
        }
      }
    } else {
      u.isRidingLift = false;
    }

    if (u.state === 'UNAWARE') {
      u.patrolTimer -= dt;
      if (u.patrolTimer <= 0) {
        u.patrolTimer = 3.5 + (this.ballistics?.rng.next() ?? 0.5) * 2.5;
        u.patrolYaw = this.normalizeAngle(u.patrolYaw + Math.PI * 0.65);
      }
    } else if (holdForLift) {
      moveX = 0;
      moveZ = 0;
    } else if (u.state === 'RETREATING' && u.coverTarget) {
      moveX = (hasWaypoint ? u.waypoint.x : u.coverTarget.x) - u.position.x;
      moveZ = (hasWaypoint ? u.waypoint.z : u.coverTarget.z) - u.position.z;
    } else if (u.state === 'REPOSITIONING') {
      if (u.role === 'flanker' && u.lastKnownPosition && !u.targetLiftId) {
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
      if (distToLkp > 4.5 || u.targetLiftId !== null) {
        moveX = (hasWaypoint ? u.waypoint.x : u.lastKnownPosition.x) - u.position.x;
        moveZ = (hasWaypoint ? u.waypoint.z : u.lastKnownPosition.z) - u.position.z;
      }
    } else if (u.state === 'ENGAGING' && dist > preferredRange && u.lastKnownPosition) {
      moveX = (hasWaypoint ? u.waypoint.x : u.lastKnownPosition.x) - u.position.x;
      moveZ = (hasWaypoint ? u.waypoint.z : u.lastKnownPosition.z) - u.position.z;
    }

    const moveLen = Math.hypot(moveX, moveZ);
    if (moveLen > 0.6 && u.state !== 'SUPPRESSING' && !holdForLift) {
      u.isMoving = true;
      const spd =
        cfg.moveSpeed *
        (u.state === 'RETREATING' ? 1.15 : u.state === 'INVESTIGATING' ? 0.65 : 0.9);
      const hx = moveX / moveLen;
      const hz = moveZ / moveLen;

      // TRN-01E: 3-ray forward whisker fan (0 deg @ 2.2m, +/-35 deg @ 1.6m) at waist/chest height (y + 0.9m)
      const rayY = u.position.y + 0.9;
      let steerX = hx;
      let steerZ = hz;

      const hitCenter = collision.sweptSegmentTest(
        u.position.x,
        rayY,
        u.position.z,
        hx,
        0,
        hz,
        2.2,
        PHYSICS_MASKS.CHARACTER_SOLID,
        this._whiskerRayHit,
        u.id
      );
      const centerDist = hitCenter ? this._whiskerRayHit.distance : 2.2;
      const centerNx = hitCenter ? this._whiskerRayHit.normalX : 0;
      const centerNz = hitCenter ? this._whiskerRayHit.normalZ : 0;

      const lx = hx * WHISKER_COS_35 - hz * WHISKER_SIN_35;
      const lz = hx * WHISKER_SIN_35 + hz * WHISKER_COS_35;
      const hitLeft = collision.sweptSegmentTest(
        u.position.x,
        rayY,
        u.position.z,
        lx,
        0,
        lz,
        1.6,
        PHYSICS_MASKS.CHARACTER_SOLID,
        this._whiskerRayHit,
        u.id
      );
      const leftDist = hitLeft ? this._whiskerRayHit.distance : 1.6;

      const rx = hx * WHISKER_COS_35 + hz * WHISKER_SIN_35;
      const rz = -hx * WHISKER_SIN_35 + hz * WHISKER_COS_35;
      const hitRight = collision.sweptSegmentTest(
        u.position.x,
        rayY,
        u.position.z,
        rx,
        0,
        rz,
        1.6,
        PHYSICS_MASKS.CHARACTER_SOLID,
        this._whiskerRayHit,
        u.id
      );
      const rightDist = hitRight ? this._whiskerRayHit.distance : 1.6;

      if (hitCenter) {
        const urgency = Math.min(1.6, Math.max(0.45, (2.2 - centerDist) / 1.35));
        const unitParity = (parseInt(u.id.split('_')[1] ?? '1', 10) || 1) % 2 === 0 ? 1 : -1;
        let turnSign = unitParity;
        if (leftDist > rightDist + 0.12) {
          turnSign = 1;
        } else if (rightDist > leftDist + 0.12) {
          turnSign = -1;
        } else if (u.avoidanceLatchTimerSec > 0) {
          const cross = hx * u.avoidanceDirZ - hz * u.avoidanceDirX;
          if (Math.abs(cross) > 0.1) turnSign = cross > 0 ? 1 : -1;
        }

        // Tangent vector along wall if hit normal is horizontal, else orthogonal to heading
        let tanX = -hz * turnSign;
        let tanZ = hx * turnSign;
        if (Math.hypot(centerNx, centerNz) > 0.2) {
          const wnX = -centerNz;
          const wnZ = centerNx;
          const alignDesired = wnX * tanX + wnZ * tanZ;
          const s = alignDesired >= 0 ? 1 : -1;
          tanX = wnX * s;
          tanZ = wnZ * s;
        }
        steerX = hx * 0.25 + tanX * urgency;
        steerZ = hz * 0.25 + tanZ * urgency;
        const sLen = Math.hypot(steerX, steerZ) || 1;
        u.avoidanceDirX = steerX / sLen;
        u.avoidanceDirZ = steerZ / sLen;
        u.avoidanceLatchTimerSec = 0.36;
      } else {
        if (hitLeft) {
          const pushR = ((1.6 - leftDist) / 1.6) * 0.95;
          steerX += hz * pushR;
          steerZ += -hx * pushR;
        }
        if (hitRight) {
          const pushL = ((1.6 - rightDist) / 1.6) * 0.95;
          steerX += -hz * pushL;
          steerZ += hx * pushL;
        }
        if (u.avoidanceLatchTimerSec > 0) {
          u.avoidanceLatchTimerSec = Math.max(0, u.avoidanceLatchTimerSec - dt);
          const latchDot = u.avoidanceDirX * hx + u.avoidanceDirZ * hz;
          if (latchDot > -0.6) {
            steerX = steerX * 0.45 + u.avoidanceDirX * 0.55;
            steerZ = steerZ * 0.45 + u.avoidanceDirZ * 0.55;
          }
        }
      }

      const steerLen = Math.hypot(steerX, steerZ) || 1;
      let vx = (steerX / steerLen) * spd;
      let vz = (steerZ / steerLen) * spd;

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
        agentProf.capsuleRadius,
        agentProf.standingHeight,
        agentProf.maxStepHeight,
        dt,
        u.id,
        undefined,
        this._moveResultScratch,
        agentProf.maxSlopeDeg
      );
      if (moveRes.hitHorizontal && Math.hypot(moveRes.wallNormalX, moveRes.wallNormalZ) > 0.2) {
        const tx = -moveRes.wallNormalZ;
        const tz = moveRes.wallNormalX;
        const tangentProj = vx * tx + vz * tz;
        const parity = (parseInt(u.id.split('_')[1] ?? '1', 10) || 1) % 2 === 0 ? 1 : -1;
        const slideSign = Math.abs(tangentProj) > 0.2 * spd ? (tangentProj >= 0 ? 1 : -1) : parity;
        u.avoidanceDirX = tx * slideSign;
        u.avoidanceDirZ = tz * slideSign;
        u.avoidanceLatchTimerSec = Math.max(u.avoidanceLatchTimerSec, 0.35);
      }
      u.lastColliderHit = moveRes.lastBlockerId;
      u.activeContacts = moveRes.activeContacts ?? 0;
      u.maxPenetrationDepth = moveRes.maxPenetrationDepth ?? 0;
    } else {
      u.isMoving = false;
      u.velocity.set(0, 0, 0);
      u.activeContacts = 0;
      u.maxPenetrationDepth = 0;
      u.avoidanceLatchTimerSec = Math.max(0, u.avoidanceLatchTimerSec - dt);
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

    // Cancel any active sniper/rocket telegraph if LOS is lost or unit is interrupted
    if (u.telegraphKind !== null && (!canFireDirect || !rawLos || u.isReloading || u.hitReactTimer > 0)) {
      u.telegraphKind = null;
      u.telegraphTimerSec = 0;
      u.telegraphDurationSec = 0;
    }

    if ((canFireDirect || canFireSuppress) && u.fireTimer <= 0) {
      const requiresTelegraph =
        canFireDirect &&
        (u.archetype === 'sniper' || u.archetype === 'rocket_trooper' || u.weaponClass === 'enemy_sniper' || u.weaponClass === 'enemy_rocket');

      if (requiresTelegraph && u.burstShotsRemaining <= 0) {
        if (u.telegraphKind === null) {
          u.telegraphKind =
            u.archetype === 'sniper' || u.weaponClass === 'enemy_sniper' ? 'sniper' : 'rocket';
          u.telegraphDurationSec = diffProfile.sniperRocketWarningSec;
          u.telegraphTimerSec = diffProfile.sniperRocketWarningSec;
          this.audio.playSpatial(
            'lock_beep',
            u.position.x,
            u.position.y + 1.5,
            u.position.z,
            6,
            0.55
          );
          return;
        }
        if (u.telegraphTimerSec > 0) {
          u.telegraphTimerSec = Math.max(0, u.telegraphTimerSec - dt);
          if (u.telegraphTimerSec > 0) {
            return;
          }
        }
        u.telegraphKind = null;
        u.telegraphDurationSec = 0;
      }

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
    const crouchYOffset = u.animCrouchBlend * 0.24;
    this._muzzlePos.set(
      u.position.x + Math.sin(u.yaw) * 0.45,
      u.position.y + 1.44 - crouchYOffset,
      u.position.z + Math.cos(u.yaw) * 0.45
    );
    u.animFireRecoilTimer = 0.095;
    u.animMuzzleFlashTimer = 0.055;
    u.muzzleFlash.visible = true;
    this.vfx.spawnMuzzleLight(this._muzzlePos.x, this._muzzlePos.y, this._muzzlePos.z);

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
      this._rocketDir
        .subVectors(this._aimTarget, this._muzzlePos)
        .normalize();
      this.projectiles.spawn({
        kind: 'enemy_rocket',
        fromPlayer: false,
        origin: this._muzzlePos,
        direction: this._rocketDir,
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
          attackerArchetype: u.archetype,
          attackerName: u.displayName,
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

  /**
   * TRN-01D & TRN-17: Geometry-driven 3D anatomical multi-point cover evaluation.
   * Resolves candidate support elevation across multi-level surfaces, checks standing clearance,
   * squad separation >= 2.2m, crouched chest/head protection, and parapet pop-up firing viability.
   */
  findTacticalCover(
    unit: EnemyUnit,
    nodes: THREE.Vector3[],
    threatPos: THREE.Vector3,
    preferAway: boolean,
    collision: CollisionWorld
  ): THREE.Vector3 | null {
    let bestX = 0;
    let bestY = 0;
    let bestZ = 0;
    let found = false;
    let bestScore = -1e9;
    const prof = getAgentTraversalProfile(unit.agentProfile);
    const threatEyeY =
      (threatPos.y > 0.4 ? threatPos.y : collision.getGroundHeightAt(threatPos.x, threatPos.z)) +
      1.45;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const dx = n.x - threatPos.x;
      const dz = n.z - threatPos.z;
      const dThreatNode = Math.hypot(dx, dz);
      if (dThreatNode < 0.5) continue;

      const inv = 1 / dThreatNode;
      const candX = n.x + dx * inv * 1.1;
      const candZ = n.z + dz * inv * 1.1;
      const candY =
        n.y > 0.4
          ? collision.getSupportHeightAt(
              candX,
              n.y + 0.8,
              candZ,
              prof.standingHeight,
              prof.maxStepHeight,
              prof.maxSlopeDeg
            )
          : collision.getGroundHeightAt(candX, candZ);
      this._coverCandScratch.set(candX, candY, candZ);

      if (!collision.canStandUp(this._coverCandScratch, prof.capsuleRadius, prof.standingHeight, unit.id)) {
        continue;
      }

      // Enforce >= 2.2m separation from any living squadmate's coverTarget or position
      let claimedBySquad = false;
      for (let j = 0; j < this.enemies.length; j++) {
        const other = this.enemies[j];
        if (!other.alive || other.id === unit.id || other.squadId !== unit.squadId) continue;
        if (other.coverTarget) {
          const cdx = other.coverTarget.x - candX;
          const cdz = other.coverTarget.z - candZ;
          if (cdx * cdx + cdz * cdz < 2.2 * 2.2) {
            claimedBySquad = true;
            break;
          }
        }
        const pdx = other.position.x - candX;
        const pdz = other.position.z - candZ;
        if (pdx * pdx + pdz * pdz < 2.2 * 2.2) {
          claimedBySquad = true;
          break;
        }
      }
      if (claimedBySquad) continue;

      // Multi-point 3D anatomical raycasts (crouched chest +0.72m / head +1.08m, standing head +1.58m)
      const rdx = candX - threatPos.x;
      const rdz = candZ - threatPos.z;
      const rdyCrouchChest = candY + 0.72 - threatEyeY;
      const rDistCC = Math.hypot(rdx, rdyCrouchChest, rdz);
      if (rDistCC < 0.8) continue;

      const invCC = 1 / rDistCC;
      const crouchChestBlocked = collision.sweptSegmentTest(
        threatPos.x,
        threatEyeY,
        threatPos.z,
        rdx * invCC,
        rdyCrouchChest * invCC,
        rdz * invCC,
        rDistCC - 0.45,
        SOLID_OBSTRUCTION_MASK,
        this._coverRayHit,
        unit.id
      );
      if (!crouchChestBlocked || !this._coverRayHit.hit) continue;

      const rdyCrouchHead = candY + 1.08 - threatEyeY;
      const rDistCH = Math.hypot(rdx, rdyCrouchHead, rdz);
      const invCH = 1 / Math.max(0.8, rDistCH);
      const crouchHeadBlocked = collision.sweptSegmentTest(
        threatPos.x,
        threatEyeY,
        threatPos.z,
        rdx * invCH,
        rdyCrouchHead * invCH,
        rdz * invCH,
        Math.max(0.3, rDistCH - 0.45),
        SOLID_OBSTRUCTION_MASK,
        this._coverRayHit,
        unit.id
      );
      if (!crouchHeadBlocked || !this._coverRayHit.hit) continue;

      // Check standing eye/head exposure: parapet cover shields crouch while allowing pop-up return fire
      const rdyStandHead = candY + 1.58 - threatEyeY;
      const rDistSH = Math.hypot(rdx, rdyStandHead, rdz);
      const invSH = 1 / Math.max(0.8, rDistSH);
      const standHeadBlocked = collision.sweptSegmentTest(
        threatPos.x,
        threatEyeY,
        threatPos.z,
        rdx * invSH,
        rdyStandHead * invSH,
        rdz * invSH,
        Math.max(0.3, rDistSH - 0.45),
        SOLID_OBSTRUCTION_MASK,
        this._coverRayHit,
        unit.id
      );

      const dSelf = Math.hypot(unit.position.x - candX, unit.position.y - candY, unit.position.z - candZ);
      const dThreatCand = Math.hypot(candX - threatPos.x, candZ - threatPos.z);
      const parapetBonus = !standHeadBlocked && !preferAway ? 3.5 : 1.0;
      const elevationBonus = candY > threatPos.y + 3.0 ? 2.5 : 0;
      const score =
        (preferAway ? dThreatCand : -Math.abs(dThreatCand - 22)) -
        dSelf * 0.8 +
        parapetBonus +
        elevationBonus;
      if (score > bestScore) {
        bestScore = score;
        bestX = candX;
        bestY = candY;
        bestZ = candZ;
        found = true;
      }
    }

    return found ? new THREE.Vector3(bestX, bestY, bestZ) : null;
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

  fillPositionsForProximity(out: Array<{ position: THREE.Vector3; radius: number }>): void {
    let slotIdx = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const u = this.enemies[i];
      if (!u.alive) continue;
      let slot = this._proxPool[slotIdx];
      if (!slot) {
        slot = { position: u.bodyCenter, radius: 0.95 };
        this._proxPool.push(slot);
      } else {
        slot.position = u.bodyCenter;
        slot.radius = 0.95;
      }
      out.push(slot);
      slotIdx++;
    }
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

  fillMiniMapBlips(out: MiniMapBlip[], playerPos?: THREE.Vector3): void {
    let slotIdx = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive) continue;

      const dist = playerPos
        ? Math.hypot(e.position.x - playerPos.x, e.position.z - playerPos.z)
        : 0;

      let detectionSource: NonNullable<MiniMapBlip['detectionSource']> = 'recon';
      let confidence = 0.9;
      let ageSec = 0;

      if (e.hasLos || e.state === 'ENGAGING') {
        detectionSource = 'los';
        confidence = 1.0;
        ageSec = 0;
      } else if (e.animFireRecoilTimer > 0 || e.state === 'SUPPRESSING') {
        detectionSource = 'acoustic';
        confidence = 0.85;
        ageSec = 0.2;
      } else if (
        e.detectedPlayer ||
        e.state === 'ALERTED' ||
        e.state === 'REPOSITIONING' ||
        (playerPos ? dist <= 26 : e.losBlockerId === null)
      ) {
        detectionSource = 'recon';
        confidence = 0.9;
        ageSec = 0;
      } else if (e.lastKnownPosition !== null && e.losLostDurationSec < 5.5) {
        detectionSource = 'stale';
        confidence = Number(Math.max(0.25, 0.75 * (1 - e.losLostDurationSec / 5.5)).toFixed(2));
        ageSec = Number(e.losLostDurationSec.toFixed(1));
      } else {
        // Stationary UNAWARE enemy occluded behind cover beyond close recon range -> no wallhack blip!
        continue;
      }

      const elevDelta = playerPos ? Number((e.position.y - playerPos.y).toFixed(1)) : 0;
      const elevCode: NonNullable<MiniMapBlip['elevationCode']> =
        elevDelta > 2.2 ? 'above' : elevDelta < -2.2 ? 'below' : 'same';

      let slot = this._blipPool[slotIdx];
      if (!slot) {
        slot = {
          id: e.id,
          x: e.position.x,
          y: e.position.y,
          z: e.position.z,
          kind: 'enemy',
          elevationDeltaM: elevDelta,
          elevationCode: elevCode,
          detectionSource,
          confidence,
          ageSec,
        };
        this._blipPool.push(slot);
      } else {
        slot.id = e.id;
        slot.x = e.position.x;
        slot.y = e.position.y;
        slot.z = e.position.z;
        slot.kind = 'enemy';
        slot.elevationDeltaM = elevDelta;
        slot.elevationCode = elevCode;
        slot.detectionSource = detectionSource;
        slot.confidence = confidence;
        slot.ageSec = ageSec;
      }
      out.push(slot);
      slotIdx++;
    }
  }

  getMiniMapBlips(playerPos?: THREE.Vector3): MiniMapBlip[] {
    const blips: MiniMapBlip[] = [];
    this.fillMiniMapBlips(blips, playerPos);
    return blips.map((b) => ({ ...b }));
  }

  clear(): void {
    for (let i = 0; i < this.enemies.length; i++) {
      this.cargoLiftManager?.cancelRequestsForEntity(this.enemies[i].id);
    }
    this.enemies = [];
    this.waveSeq = 0;
    this.pathSyncAccum = 0;
    for (let i = 0; i < this._hitscanPool.length; i++) {
      this._hitscanPool[i].unit = null;
      this._hitscanPool[i].cb = null;
      this._hitscanPool[i].target.alive = false;
      this._hitscanPool[i].target.position = this._muzzlePos;
      this._hitscanPool[i].target.headPosition = this._muzzlePos;
      this._hitscanPool[i].target.lowerBodyPosition = this._muzzlePos;
      this._hitscanPool[i].target.torsoBoxMin = undefined;
      this._hitscanPool[i].target.torsoBoxMax = undefined;
      this._hitscanPool[i].target.lowerBodyBoxMin = undefined;
      this._hitscanPool[i].target.lowerBodyBoxMax = undefined;
    }
    this._proxPool.length = 0;
    this._blipPool.length = 0;
    this._liftProxyPool.length = 0;
    if (this.sniperLaserLine) {
      this.sniperLaserLine.visible = false;
    }
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
}
