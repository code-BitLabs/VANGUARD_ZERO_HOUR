import {
  CombatDomain,
  EnemyAwarenessState,
  EnemyWeaponClass,
  PlayerHitZone,
} from '@/src/schemas/combat.schema';
import { PhysicsWorldDiagnosticsSnapshot } from '@/src/engine/physics/PhysicsTypes';

export type CombatEventKind =
  | 'DETECTED'
  | 'LOST_LOS'
  | 'ALERT_STATE'
  | 'AIM_START'
  | 'TOKEN_ACQUIRED'
  | 'TOKEN_RELEASED'
  | 'SHOT_FIRED'
  | 'SHOT_HIT'
  | 'SHOT_MISSED'
  | 'SHOT_BLOCKED_COVER'
  | 'PLAYER_DAMAGED'
  | 'TARGET_SWITCHED'
  | 'SUPPRESSION_START'
  | 'FLANK_START'
  | 'PRESSURE_THROTTLE'
  | 'PROJECTILE_SPAWN'
  | 'PROJECTILE_DETONATE'
  | 'AIRCRAFT_STATE'
  | 'EXPLOSION'
  | 'C4_EVENT'
  | 'STRIKE_CALLED'
  | 'NUKE_EVENT'
  | 'DESTRUCTION'
  | 'PERF_SPIKE'
  | 'RULE_WARNING';

export interface CombatEventRecord {
  id: number;
  timestampSec: number;
  kind: CombatEventKind;
  unitId: string;
  squadId: string;
  domain: CombatDomain;
  summary: string;
}

export type BlockerCategory = 'WORLD' | 'COVER' | 'VEHICLE' | 'DESTRUCTIBLE';

export interface ShotTelemetryRecord {
  shotId: number;
  timestampSec: number;
  unitId: string;
  squadId: string;
  domain: CombatDomain;
  weaponClass: EnemyWeaponClass;
  isSuppression: boolean;
  originX: number;
  originY: number;
  originZ: number;
  endX: number;
  endY: number;
  endZ: number;
  spreadRad: number;
  outcome: 'hit_player' | 'blocked_cover' | 'missed';
  blockerColliderId: string | null;
  blockerCategory?: BlockerCategory | null;
  hitZone: PlayerHitZone | null;
  damageDealt: number;
  raycastMs?: number;
}

export interface DamageTelemetryRecord {
  shotId: number;
  timestampSec: number;
  unitId: string;
  squadId: string;
  domain: CombatDomain;
  weaponClass: EnemyWeaponClass;
  hitZone: PlayerHitZone;
  damage: number;
  armorAbsorbed: number;
  healthLost: number;
}

export interface EnemyDebugInspectorRow {
  id: string;
  displayName: string;
  squadId: string;
  domain: CombatDomain;
  role: string;
  state: EnemyAwarenessState;
  detectedPlayer: boolean;
  hasLos: boolean;
  losBlockerId: string | null;
  distanceMeters: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  fovDeg: number;
  detectionRange: number;
  hearingRange: number;
  lkpX: number | null;
  lkpY: number | null;
  lkpZ: number | null;
  lkpAgeSec: number;
  reactionTimerSec: number;
  fireCooldownSec: number;
  ammoInMag: number;
  magSize: number;
  isReloading: boolean;
  currentSpreadDeg: number;
  accuracyPct: number;
  tokenStatus: 'DIRECT' | 'HEAVY' | 'SUPPRESS' | 'WAITING' | 'NONE';
  allowedToFire: boolean;
  blockedByCover: boolean;
  shotsFired: number;
  shotsHit: number;
  totalDamageDealt: number;
  lastDamageAmount: number;
  lastDamageTimeSec: number | null;
  stateTransitionCount?: number;
  invalidTransitionCount?: number;
  obstructionDurationSec?: number;
  blockedShotAttempts?: number;
  lastLosRecoverySec?: number | null;
  lastTransition?: string | null;
}

export interface SquadStatusSnapshot {
  squadId: string;
  memberCount: number;
  aliveCount: number;
  activeShooters: number;
  maxSquadAttackers: number;
  activeSuppressors: number;
  maxSquadSuppressors: number;
  waitingCount: number;
}

export interface CoordinatorTelemetrySnapshot {
  difficulty: string;
  maxGlobalAttackers: number;
  currentGlobalAttackers: number;
  availableGlobalTokens: number;
  maxGlobalHeavyAttackers: number;
  currentGlobalHeavyAttackers: number;
  maxGlobalSuppressors: number;
  currentGlobalSuppressors: number;
  waitingAttackersCount: number;
  pressureThrottled: boolean;
  rolling2sDamage: number;
  damageBurstThreshold2s: number;
  squads: SquadStatusSnapshot[];
}

export interface FlightTelemetrySample {
  id: string;
  domain: 'projectile' | 'aircraft';
  category: string;
  x: number;
  y: number;
  z: number;
  speed: number;
  acceleration: number;
  maxSpeed: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  turnRateDegPerSec: number;
  maxTurnRateDegPerSec: number;
  flightTimeSec: number;
  remainingLifeSec: number | null;
  trackingState: string;
  timeToImpactSec: number | null;
  stateLabel: string;
  speedOutlier: boolean;
}

export interface ExplosionTelemetryRecord {
  explosionId: number;
  timestampSec: number;
  explosiveId: string;
  category: string;
  x: number;
  y: number;
  z: number;
  innerRadius: number;
  outerRadius: number;
  maxDamage: number;
  entitiesHit: number;
  occludedCount: number;
  totalDamageDealt: number;
  isStrategic: boolean;
}

export interface DestructionTelemetryRecord {
  id: string;
  timestampSec: number;
  kind: string;
  previousState: string;
  newState: string;
  isObjective: boolean;
}

export interface PlayerMovementTelemetry {
  speed: number;
  horizontalSpeed: number;
  velX: number;
  velY: number;
  velZ: number;
  stance: 'standing' | 'crouching' | 'sliding';
  grounded: boolean;
  airTimeSec: number;
  lastJumpImpulse: number;
  lastLandImpulse: number;
  accelState: 'IDLE' | 'ACCELERATING' | 'CRUISE' | 'DECELERATING' | 'AIRBORNE' | 'SLIDING';
  recoilPitchDeg: number;
  recoilYawDeg: number;
  suppressionLevel: number;
  trauma: number;
  weaponName: string;
  equipTimerSec: number;
  reloadStage: 'READY' | 'MAG_OUT' | 'MAG_IN' | 'CHAMBER';
  reloadProgress: number;
}

export interface PerformanceTelemetrySnapshot {
  fps: number;
  avgFps: number;
  minFps: number;
  maxFps: number;
  frameMs: number;
  avgFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  cpuTimeMs: number;
  phases: {
    ai: number;
    ballistics: number;
    physics: number;
    projectilesFlight: number;
    explosions: number;
    render: number;
    audio: number;
    ui: number;
  };
  drawCalls: number;
  triangles: number;
  spikeCount: number;
  lastSpikeMs: number;
  lastSpikeAgeSec?: number;
  lastSpikeSubsystem: string;
  governorTier: string;
  renderScale: number;
  fps1PercentLow?: number;
  renderWidth?: number;
  renderHeight?: number;
  pixelRatio?: number;
  memoryUsedMb?: number | null;
  gpuTimerNote: string;
}

export interface ResourceTelemetrySnapshot {
  geometries: number;
  materials: number;
  textures: number;
  renderTargets: number;
  listeners: number;
  timers: number;
  audioVoices: number;
  activePooledVfx: number;
  poolCapacityVfx: number;
  activePooledProjectiles: number;
  poolCapacityProjectiles: number;
  activeC4Count: number;
  totalCreated: number;
  totalDisposed: number;
  sharedCount: number;
  missionCount: number;
  hasMissionLeak: boolean;
  missionRemaining: number;
  sharedDelta: number;
}

export interface OrdnanceTelemetrySummary {
  c4Inventory: number;
  c4Deployed: number;
  c4MaxDeployed: number;
  c4Detonations: number;
  bombStrikesCalled: number;
  selectedBombId: string;
  bombCooldownSec: number;
  nukeUsed: boolean;
  nukeCountdownSec: number;
  falloutActive: boolean;
  falloutRemainingSec: number;
}

export interface DiagnosticWarning {
  id: string;
  ruleId: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  timestampSec: number;
  subsystem: string;
  entityId: string;
  measuredEvidence: string;
  expectedBehavior: string;
  actualBehavior: string;
  suggestedInvestigation: string;
  eventIds: number[];
}

export interface BallisticsTelemetryStats {
  raycastsExecuted: number;
  raycastAvgMs: number;
  raycastMaxMs: number;
  blockedByCategory: Record<BlockerCategory, number>;
}

export interface CombatAggregateMetrics {
  elapsedSec: number;
  enemiesAwareCount: number;
  enemiesAimingCount: number;
  enemiesFiringCount: number;
  incomingProjectilesCount: number;
  damageLast5s: number;
  damageLast10s: number;
  damageLast30s: number;
  totalDamageReceived: number;
  totalArmorAbsorbed: number;
  totalHealthLost: number;
  duplicateDamageBlockedCount: number;
  hitZoneCounts: Record<PlayerHitZone, number>;
  totalShotsFired: number;
  totalShotsHit: number;
  totalShotsMissed: number;
  totalShotsBlockedByCover: number;
  enemyHitPercentage: number;
  coverBlockedPercentage: number;
  uniqueEnemiesDetectedPlayer: number;
  uniqueEnemiesGrantedToken: number;
  uniqueEnemiesFired: number;
  timeFirstDetectionSec: number | null;
  timeFirstDamageSec: number | null;
  firstDetectToFirstDamageSec: number | null;
  timeSpentExposedSec: number;
  timeSpentInCoverSec: number;
  lastLeftCoverTimeSec: number | null;
  leaveCoverToFirstHitSec: number | null;
  damageByDomain: Record<CombatDomain, number>;
  damageByWeapon: Record<string, number>;
  damageByEnemy: Array<{ unitId: string; damage: number; hits: number; shots: number }>;
  tokenAcquisitionAvgMs: number;
  tokenStarvationCount: number;
  invalidAttackAttempts: number;
  tunnelingBlockedCount: number;
  speedOutliersCount: number;
  timePlayerDeathSec?: number | null;
  fatalDamageSource?: {
    unitId: string;
    squadId: string;
    domain: CombatDomain;
    weaponClass: EnemyWeaponClass;
    hitZone: PlayerHitZone;
    timestampSec: number;
  } | null;
  playerShotsFired?: number;
  playerShotsHit?: number;
  playerAccuracyPct?: number;
  playerEnemyZoneHits?: { head: number; upper_torso: number; lower_body: number };
  objectiveCompletedAtSec?: Record<string, number | null>;
  missionRestartCount?: number;
}

export interface CombatDebugSnapshot {
  missionId: number;
  coordinator: CoordinatorTelemetrySnapshot;
  metrics: CombatAggregateMetrics;
  ballisticsStats: BallisticsTelemetryStats;
  enemies: EnemyDebugInspectorRow[];
  recentEvents: CombatEventRecord[];
  recentShots: ShotTelemetryRecord[];
  recentDamages: DamageTelemetryRecord[];
  playerMovement: PlayerMovementTelemetry;
  flightSamples: FlightTelemetrySample[];
  recentExplosions: ExplosionTelemetryRecord[];
  recentDestructions: DestructionTelemetryRecord[];
  ordnanceSummary: OrdnanceTelemetrySummary;
  performance: PerformanceTelemetrySnapshot;
  resources: ResourceTelemetrySnapshot;
  warnings: DiagnosticWarning[];
  physics: PhysicsWorldDiagnosticsSnapshot;
}

const VALID_STATE_TRANSITIONS = new Set<string>([
  'UNAWARE->SUSPICIOUS',
  'UNAWARE->ALERTED',
  'UNAWARE->INVESTIGATING',
  'UNAWARE->RETREATING',
  'UNAWARE->DEAD',
  'SUSPICIOUS->INVESTIGATING',
  'SUSPICIOUS->ALERTED',
  'SUSPICIOUS->UNAWARE',
  'SUSPICIOUS->RETREATING',
  'SUSPICIOUS->DEAD',
  'INVESTIGATING->ALERTED',
  'INVESTIGATING->SEARCHING',
  'INVESTIGATING->UNAWARE',
  'INVESTIGATING->RETREATING',
  'INVESTIGATING->DEAD',
  'ALERTED->ENGAGING',
  'ALERTED->SUPPRESSING',
  'ALERTED->SEARCHING',
  'ALERTED->REPOSITIONING',
  'ALERTED->RETREATING',
  'ALERTED->UNAWARE',
  'ALERTED->DEAD',
  'ENGAGING->ALERTED',
  'ENGAGING->SUPPRESSING',
  'ENGAGING->SEARCHING',
  'ENGAGING->REPOSITIONING',
  'ENGAGING->RETREATING',
  'ENGAGING->DEAD',
  'SUPPRESSING->ENGAGING',
  'SUPPRESSING->ALERTED',
  'SUPPRESSING->SEARCHING',
  'SUPPRESSING->REPOSITIONING',
  'SUPPRESSING->RETREATING',
  'SUPPRESSING->DEAD',
  'SEARCHING->ALERTED',
  'SEARCHING->ENGAGING',
  'SEARCHING->INVESTIGATING',
  'SEARCHING->REPOSITIONING',
  'SEARCHING->RETREATING',
  'SEARCHING->UNAWARE',
  'SEARCHING->DEAD',
  'REPOSITIONING->ALERTED',
  'REPOSITIONING->ENGAGING',
  'REPOSITIONING->SUPPRESSING',
  'REPOSITIONING->SEARCHING',
  'REPOSITIONING->RETREATING',
  'REPOSITIONING->DEAD',
  'RETREATING->ALERTED',
  'RETREATING->REPOSITIONING',
  'RETREATING->SEARCHING',
  'RETREATING->DEAD',
]);

export class CombatTelemetryRecorder {
  public static readonly MAX_EVENTS = 500;
  public static readonly MAX_SHOTS = 256;
  public static readonly MAX_DAMAGE_RECORDS = 192;
  public static readonly MAX_EXPLOSIONS = 96;
  public static readonly MAX_DESTRUCTIONS = 96;

  private seqEvent = 0;
  private seqShot = 0;
  private seqExplosion = 0;
  private elapsedSec = 0;
  private missionId = 1;

  private eventsRing: CombatEventRecord[] = [];
  private shotsRing: ShotTelemetryRecord[] = [];
  private damageRing: DamageTelemetryRecord[] = [];
  private explosionsRing: ExplosionTelemetryRecord[] = [];
  private destructionsRing: DestructionTelemetryRecord[] = [];
  private warningsList: DiagnosticWarning[] = [];

  private totalShotsFired = 0;
  private totalShotsHit = 0;
  private totalShotsMissed = 0;
  private totalShotsBlockedByCover = 0;
  private totalDamageReceived = 0;
  private totalArmorAbsorbed = 0;
  private totalHealthLost = 0;
  private duplicateDamageBlockedCount = 0;
  private tunnelingBlockedCount = 0;
  private speedOutliersCount = 0;
  private tokenStarvationCount = 0;
  private invalidAttackAttempts = 0;
  private tokenLatencySumMs = 0;
  private tokenLatencySamples = 0;

  private raycastsExecuted = 0;
  private raycastMsSum = 0;
  private raycastMaxMs = 0;
  private blockedByCategory: Record<BlockerCategory, number> = {
    WORLD: 0,
    COVER: 0,
    VEHICLE: 0,
    DESTRUCTIBLE: 0,
  };

  private hitZoneCounts: Record<PlayerHitZone, number> = {
    head: 0,
    upper_torso: 0,
    lower_body: 0,
    splash: 0,
  };

  private detectedSet = new Set<string>();
  private grantedTokenSet = new Set<string>();
  private firedSet = new Set<string>();

  private timeFirstDetectionSec: number | null = null;
  private timeFirstDamageSec: number | null = null;
  private timePlayerDeathSec: number | null = null;
  private fatalDamageSource: {
    unitId: string;
    squadId: string;
    domain: CombatDomain;
    weaponClass: EnemyWeaponClass;
    hitZone: PlayerHitZone;
    timestampSec: number;
  } | null = null;
  private playerShotsFired = 0;
  private playerShotsHit = 0;
  private playerEnemyZoneHits = { head: 0, upper_torso: 0, lower_body: 0 };
  private objectiveCompletedAtSec: Record<string, number | null> = {};
  private missionRestartCount = 0;
  private timeSpentExposedSec = 0;
  private timeSpentInCoverSec = 0;
  private currentlyExposed = false;
  private lastLeftCoverTimeSec: number | null = null;
  private leaveCoverToFirstHitSec: number | null = null;

  private damageByDomain: Record<CombatDomain, number> = {
    ground: 0,
    air: 0,
    vehicle: 0,
  };
  private damageByWeapon = new Map<string, number>();
  private statsByEnemy = new Map<string, { damage: number; hits: number; shots: number }>();
  private lastEnemyStates = new Map<string, EnemyAwarenessState>();
  private enemyTransitionCounts = new Map<
    string,
    { transitions: number; invalid: number; lastTransition: string | null }
  >();
  private enemyTransitionDirectTracked = new Set<string>();

  private latestPlayerMovement: PlayerMovementTelemetry = {
    speed: 0,
    horizontalSpeed: 0,
    velX: 0,
    velY: 0,
    velZ: 0,
    stance: 'standing',
    grounded: true,
    airTimeSec: 0,
    lastJumpImpulse: 0,
    lastLandImpulse: 0,
    accelState: 'IDLE',
    recoilPitchDeg: 0,
    recoilYawDeg: 0,
    suppressionLevel: 0,
    trauma: 0,
    weaponName: 'M416-V',
    equipTimerSec: 0,
    reloadStage: 'READY',
    reloadProgress: 0,
  };

  private latestFlightSamples: FlightTelemetrySample[] = [];
  private latestOrdnance: OrdnanceTelemetrySummary = {
    c4Inventory: 3,
    c4Deployed: 0,
    c4MaxDeployed: 4,
    c4Detonations: 0,
    bombStrikesCalled: 0,
    selectedBombId: 'standard_aerial_bomb',
    bombCooldownSec: 0,
    nukeUsed: false,
    nukeCountdownSec: 0,
    falloutActive: false,
    falloutRemainingSec: 0,
  };

  private latestPerformance: PerformanceTelemetrySnapshot = {
    fps: 60,
    avgFps: 60,
    minFps: 60,
    maxFps: 60,
    frameMs: 16.6,
    avgFrameMs: 16.6,
    p95FrameMs: 16.6,
    p99FrameMs: 16.6,
    cpuTimeMs: 0,
    phases: {
      ai: 0,
      ballistics: 0,
      physics: 0,
      projectilesFlight: 0,
      explosions: 0,
      render: 0,
      audio: 0,
      ui: 0,
    },
    drawCalls: 0,
    triangles: 0,
    spikeCount: 0,
    lastSpikeMs: 0,
    lastSpikeAgeSec: 999,
    lastSpikeSubsystem: 'none',
    governorTier: 'high',
    renderScale: 1,
    fps1PercentLow: 60,
    renderWidth: 1280,
    renderHeight: 720,
    pixelRatio: 1,
    memoryUsedMb: null,
    gpuTimerNote: 'WebGL2 CPU draw/triangle counters (hardware GPU timer query unavailable in browser)',
  };

  private latestResources: ResourceTelemetrySnapshot = {
    geometries: 0,
    materials: 0,
    textures: 0,
    renderTargets: 0,
    listeners: 0,
    timers: 0,
    audioVoices: 0,
    activePooledVfx: 0,
    poolCapacityVfx: 208,
    activePooledProjectiles: 0,
    poolCapacityProjectiles: 64,
    activeC4Count: 0,
    totalCreated: 0,
    totalDisposed: 0,
    sharedCount: 0,
    missionCount: 0,
    hasMissionLeak: false,
    missionRemaining: 0,
    sharedDelta: 0,
  };

  private latestPhysics: PhysicsWorldDiagnosticsSnapshot = {
    solverBackend: 'Custom FPS Controller + SpatialHash/BVH',
    rapierInitialized: false,
    fixedTimestepSec: 0.0167,
    worldBoundsMin: -106,
    worldBoundsMax: 106,
    totalBodies: 0,
    staticBodiesCount: 0,
    dynamicBodiesCount: 0,
    kinematicBodiesCount: 0,
    characterBodiesCount: 0,
    activeCollisionPairs: 0,
    collisionChecksPerFrame: 0,
    raycastsPerFrame: 0,
    shapeCastsPerFrame: 0,
    blockedMovementsTotal: 0,
    penetrationCorrectionsTotal: 0,
    ceilingStandupBlocksTotal: 0,
    tunnelingPreventedTotal: 0,
    worldBoundaryClampsTotal: 0,
    vehicleBuildingImpactsTotal: 0,
    invalidLayerMaskCount: 0,
    bodies: [],
    recentContacts: [],
    blockedVectors: [],
    physicsWarnings: [],
    staticColliderBoxes: [],
  };

  setMissionId(missionId: number): void {
    if (this.missionId !== missionId) {
      this.missionRestartCount = 0;
    }
    this.missionId = missionId;
  }

  recordMissionRestart(): void {
    this.missionRestartCount++;
  }

  reset(): void {
    this.seqEvent = 0;
    this.seqShot = 0;
    this.seqExplosion = 0;
    this.elapsedSec = 0;
    this.eventsRing = [];
    this.shotsRing = [];
    this.damageRing = [];
    this.explosionsRing = [];
    this.destructionsRing = [];
    this.warningsList = [];
    this.totalShotsFired = 0;
    this.totalShotsHit = 0;
    this.totalShotsMissed = 0;
    this.totalShotsBlockedByCover = 0;
    this.totalDamageReceived = 0;
    this.totalArmorAbsorbed = 0;
    this.totalHealthLost = 0;
    this.duplicateDamageBlockedCount = 0;
    this.tunnelingBlockedCount = 0;
    this.speedOutliersCount = 0;
    this.tokenStarvationCount = 0;
    this.invalidAttackAttempts = 0;
    this.tokenLatencySumMs = 0;
    this.tokenLatencySamples = 0;
    this.raycastsExecuted = 0;
    this.raycastMsSum = 0;
    this.raycastMaxMs = 0;
    this.blockedByCategory = { WORLD: 0, COVER: 0, VEHICLE: 0, DESTRUCTIBLE: 0 };
    this.hitZoneCounts = { head: 0, upper_torso: 0, lower_body: 0, splash: 0 };
    this.detectedSet.clear();
    this.grantedTokenSet.clear();
    this.firedSet.clear();
    this.timeFirstDetectionSec = null;
    this.timeFirstDamageSec = null;
    this.timePlayerDeathSec = null;
    this.fatalDamageSource = null;
    this.playerShotsFired = 0;
    this.playerShotsHit = 0;
    this.playerEnemyZoneHits = { head: 0, upper_torso: 0, lower_body: 0 };
    this.objectiveCompletedAtSec = {};
    this.timeSpentExposedSec = 0;
    this.timeSpentInCoverSec = 0;
    this.currentlyExposed = false;
    this.lastLeftCoverTimeSec = null;
    this.leaveCoverToFirstHitSec = null;
    this.damageByDomain = { ground: 0, air: 0, vehicle: 0 };
    this.damageByWeapon.clear();
    this.statsByEnemy.clear();
    this.lastEnemyStates.clear();
    this.enemyTransitionCounts.clear();
    this.enemyTransitionDirectTracked.clear();
    this.latestFlightSamples = [];
  }

  tickExposure(dt: number, isPlayerExposedToAnyLos: boolean): void {
    this.elapsedSec += dt;
    if (isPlayerExposedToAnyLos) {
      if (!this.currentlyExposed) {
        this.currentlyExposed = true;
        this.lastLeftCoverTimeSec = this.elapsedSec;
      }
      this.timeSpentExposedSec += dt;
    } else {
      this.currentlyExposed = false;
      this.timeSpentInCoverSec += dt;
    }
  }

  getElapsedSec(): number {
    return this.elapsedSec;
  }

  nextShotId(): number {
    return ++this.seqShot;
  }

  nextExplosionId(): number {
    return ++this.seqExplosion;
  }

  recordDuplicateDamageBlocked(): void {
    this.duplicateDamageBlockedCount++;
  }

  recordTunnelingBlocked(): void {
    this.tunnelingBlockedCount++;
  }

  recordSpeedOutlier(): void {
    this.speedOutliersCount++;
  }

  recordTokenLatency(ms: number): void {
    this.tokenLatencySumMs += ms;
    this.tokenLatencySamples++;
  }

  recordTokenStarvation(): void {
    this.tokenStarvationCount++;
  }

  recordInvalidAttackAttempt(): void {
    this.invalidAttackAttempts++;
  }

  recordRaycastTiming(ms: number, blockerCategory: BlockerCategory | null): void {
    this.raycastsExecuted++;
    this.raycastMsSum += ms;
    if (ms > this.raycastMaxMs) this.raycastMaxMs = ms;
    if (blockerCategory) {
      this.blockedByCategory[blockerCategory] = (this.blockedByCategory[blockerCategory] ?? 0) + 1;
    }
  }

  recordExplosion(rec: Omit<ExplosionTelemetryRecord, 'timestampSec'>): void {
    const full: ExplosionTelemetryRecord = {
      ...rec,
      timestampSec: Number(this.elapsedSec.toFixed(2)),
    };
    if (this.explosionsRing.length >= CombatTelemetryRecorder.MAX_EXPLOSIONS) {
      this.explosionsRing.shift();
    }
    this.explosionsRing.push(full);
    this.recordEvent(
      rec.isStrategic ? 'NUKE_EVENT' : 'EXPLOSION',
      rec.explosiveId,
      'ordnance',
      'ground',
      `${rec.explosiveId} detonated (r=${rec.outerRadius}m, hit=${rec.entitiesHit}, occluded=${rec.occludedCount}, dmg=${rec.totalDamageDealt.toFixed(0)})`
    );
  }

  recordDestruction(rec: Omit<DestructionTelemetryRecord, 'timestampSec'>): void {
    const full: DestructionTelemetryRecord = {
      ...rec,
      timestampSec: Number(this.elapsedSec.toFixed(2)),
    };
    if (this.destructionsRing.length >= CombatTelemetryRecorder.MAX_DESTRUCTIONS) {
      this.destructionsRing.shift();
    }
    this.destructionsRing.push(full);
    this.recordEvent(
      'DESTRUCTION',
      rec.id,
      'world',
      'ground',
      `${rec.kind} [${rec.id}] transitioned ${rec.previousState} -> ${rec.newState}`
    );
  }

  setPlayerMovementTelemetry(movement: PlayerMovementTelemetry): void {
    this.latestPlayerMovement = movement;
  }

  setFlightSamples(samples: FlightTelemetrySample[]): void {
    this.latestFlightSamples = samples;
  }

  setOrdnanceSummary(summary: OrdnanceTelemetrySummary): void {
    this.latestOrdnance = summary;
  }

  setPerformanceTelemetry(perf: PerformanceTelemetrySnapshot): void {
    this.latestPerformance = perf;
  }

  setResourceTelemetry(res: ResourceTelemetrySnapshot): void {
    this.latestResources = res;
  }

  setWarnings(warnings: DiagnosticWarning[]): void {
    this.warningsList = warnings;
  }

  setPhysicsDiagnostics(physics: PhysicsWorldDiagnosticsSnapshot): void {
    this.latestPhysics = physics;
    if (physics.tunnelingPreventedTotal > this.tunnelingBlockedCount) {
      this.tunnelingBlockedCount = physics.tunnelingPreventedTotal;
    }
  }

  recordPlayerDeath(): void {
    if (this.timePlayerDeathSec !== null) return;
    this.timePlayerDeathSec = Number(this.elapsedSec.toFixed(2));
    const lastDmg = this.damageRing[this.damageRing.length - 1];
    if (lastDmg) {
      this.fatalDamageSource = {
        unitId: lastDmg.unitId,
        squadId: lastDmg.squadId,
        domain: lastDmg.domain,
        weaponClass: lastDmg.weaponClass,
        hitZone: lastDmg.hitZone,
        timestampSec: lastDmg.timestampSec,
      };
    }
  }

  setPlayerWeaponTelemetry(
    shotsFired: number,
    shotsHit: number,
    zoneHits: { head: number; upper_torso: number; lower_body: number }
  ): void {
    this.playerShotsFired = shotsFired;
    this.playerShotsHit = shotsHit;
    this.playerEnemyZoneHits = { ...zoneHits };
  }

  setObjectiveCompletionTelemetry(timestamps: Record<string, number | null>): void {
    this.objectiveCompletedAtSec = { ...timestamps };
  }

  recordEvent(
    kind: CombatEventKind,
    unitId: string,
    squadId: string,
    domain: CombatDomain,
    summary: string
  ): number {
    if (kind === 'DETECTED') {
      this.detectedSet.add(unitId);
      if (this.timeFirstDetectionSec === null) {
        this.timeFirstDetectionSec = this.elapsedSec;
      }
    } else if (kind === 'TOKEN_ACQUIRED') {
      this.grantedTokenSet.add(unitId);
    }

    const id = ++this.seqEvent;
    const rec: CombatEventRecord = {
      id,
      timestampSec: Number(this.elapsedSec.toFixed(2)),
      kind,
      unitId,
      squadId,
      domain,
      summary,
    };

    if (this.eventsRing.length >= CombatTelemetryRecorder.MAX_EVENTS) {
      this.eventsRing.shift();
    }
    this.eventsRing.push(rec);
    return id;
  }

  recordShot(record: Omit<ShotTelemetryRecord, 'timestampSec'> & { timestampSec?: number }): void {
    const ts = record.timestampSec ?? Number(this.elapsedSec.toFixed(2));
    const full: ShotTelemetryRecord = {
      ...record,
      timestampSec: ts,
    };

    this.totalShotsFired++;
    this.firedSet.add(record.unitId);

    const enemyStat = this.statsByEnemy.get(record.unitId) ?? { damage: 0, hits: 0, shots: 0 };
    enemyStat.shots++;

    if (record.outcome === 'hit_player') {
      this.totalShotsHit++;
      enemyStat.hits++;
      enemyStat.damage += record.damageDealt;
    } else if (record.outcome === 'blocked_cover') {
      this.totalShotsBlockedByCover++;
    } else {
      this.totalShotsMissed++;
    }
    this.statsByEnemy.set(record.unitId, enemyStat);

    if (this.shotsRing.length >= CombatTelemetryRecorder.MAX_SHOTS) {
      this.shotsRing.shift();
    }
    this.shotsRing.push(full);
  }

  recordPlayerDamage(
    shotId: number,
    unitId: string,
    squadId: string,
    domain: CombatDomain,
    weaponClass: EnemyWeaponClass,
    hitZone: PlayerHitZone,
    damage: number,
    armorAbsorbed = 0,
    healthLost = damage
  ): void {
    if (damage <= 0) return;

    if (this.timeFirstDamageSec === null) {
      this.timeFirstDamageSec = this.elapsedSec;
    }
    if (this.lastLeftCoverTimeSec !== null && this.leaveCoverToFirstHitSec === null) {
      this.leaveCoverToFirstHitSec = Math.max(0, this.elapsedSec - this.lastLeftCoverTimeSec);
    }

    this.totalDamageReceived += damage;
    this.totalArmorAbsorbed += armorAbsorbed;
    this.totalHealthLost += healthLost;
    this.hitZoneCounts[hitZone] = (this.hitZoneCounts[hitZone] ?? 0) + 1;
    this.damageByDomain[domain] = (this.damageByDomain[domain] ?? 0) + damage;
    this.damageByWeapon.set(weaponClass, (this.damageByWeapon.get(weaponClass) ?? 0) + damage);

    const rec: DamageTelemetryRecord = {
      shotId,
      timestampSec: Number(this.elapsedSec.toFixed(2)),
      unitId,
      squadId,
      domain,
      weaponClass,
      hitZone,
      damage,
      armorAbsorbed,
      healthLost,
    };

    if (this.damageRing.length >= CombatTelemetryRecorder.MAX_DAMAGE_RECORDS) {
      this.damageRing.shift();
    }
    this.damageRing.push(rec);

    this.recordEvent(
      'PLAYER_DAMAGED',
      unitId,
      squadId,
      domain,
      `${unitId} (${weaponClass}) hit ${hitZone} for ${damage.toFixed(1)} dmg`
    );
  }

  getRollingDamage(windowSec: number): number {
    const cutoff = this.elapsedSec - windowSec;
    let sum = 0;
    for (let i = this.damageRing.length - 1; i >= 0; i--) {
      const d = this.damageRing[i];
      if (d.timestampSec < cutoff) break;
      sum += d.damage;
    }
    return sum;
  }

  getEnemyStats(unitId: string): { damage: number; hits: number; shots: number } {
    return this.statsByEnemy.get(unitId) ?? { damage: 0, hits: 0, shots: 0 };
  }

  recordStateTransition(
    unitId: string,
    squadId: string,
    domain: CombatDomain,
    prevState: EnemyAwarenessState,
    nextState: EnemyAwarenessState
  ): void {
    if (prevState === nextState) return;
    this.enemyTransitionDirectTracked.add(unitId);
    let counters = this.enemyTransitionCounts.get(unitId);
    if (!counters) {
      counters = { transitions: 0, invalid: 0, lastTransition: null };
      this.enemyTransitionCounts.set(unitId, counters);
    }
    const edge = `${prevState}->${nextState}`;
    counters.transitions++;
    counters.lastTransition = edge;
    if (!VALID_STATE_TRANSITIONS.has(edge)) {
      counters.invalid++;
      this.recordEvent(
        'ALERT_STATE',
        unitId,
        squadId,
        domain,
        `Unexpected FSM transition ${edge}`
      );
    }
    this.lastEnemyStates.set(unitId, nextState);
  }

  observeEnemyStates(enemies: EnemyDebugInspectorRow[]): void {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      let counters = this.enemyTransitionCounts.get(e.id);
      if (!counters) {
        counters = { transitions: 0, invalid: 0, lastTransition: null };
        this.enemyTransitionCounts.set(e.id, counters);
      }
      if (!this.enemyTransitionDirectTracked.has(e.id)) {
        const prev = this.lastEnemyStates.get(e.id);
        if (prev && prev !== e.state) {
          const edge = `${prev}->${e.state}`;
          counters.transitions++;
          counters.lastTransition = edge;
          if (!VALID_STATE_TRANSITIONS.has(edge)) {
            counters.invalid++;
          }
        }
        this.lastEnemyStates.set(e.id, e.state);
      }
      e.stateTransitionCount = counters.transitions;
      e.invalidTransitionCount = counters.invalid;
      e.lastTransition = counters.lastTransition;
    }
  }

  buildSnapshot(
    coordinator: CoordinatorTelemetrySnapshot,
    enemies: EnemyDebugInspectorRow[],
    incomingProjectilesCount: number
  ): CombatDebugSnapshot {
    this.observeEnemyStates(enemies);

    let aware = 0;
    let aiming = 0;
    let firing = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.state !== 'UNAWARE' && e.state !== 'DEAD') aware++;
      if (e.state === 'ALERTED' || e.state === 'ENGAGING' || e.state === 'SUPPRESSING') aiming++;
      if (e.allowedToFire && (e.state === 'ENGAGING' || e.state === 'SUPPRESSING')) firing++;
    }

    const damageByWeaponObj: Record<string, number> = {};
    this.damageByWeapon.forEach((v, k) => {
      damageByWeaponObj[k] = Number(v.toFixed(1));
    });

    const damageByEnemyArr = Array.from(this.statsByEnemy.entries())
      .map(([unitId, st]) => ({
        unitId,
        damage: Number(st.damage.toFixed(1)),
        hits: st.hits,
        shots: st.shots,
      }))
      .sort((a, b) => b.damage - a.damage)
      .slice(0, 12);

    const hitPct =
      this.totalShotsFired > 0
        ? Number(((this.totalShotsHit / this.totalShotsFired) * 100).toFixed(1))
        : 0;
    const blockedPct =
      this.totalShotsFired > 0
        ? Number(((this.totalShotsBlockedByCover / this.totalShotsFired) * 100).toFixed(1))
        : 0;

    const firstDetectToFirstDamageSec =
      this.timeFirstDetectionSec !== null && this.timeFirstDamageSec !== null
        ? Number(Math.max(0, this.timeFirstDamageSec - this.timeFirstDetectionSec).toFixed(2))
        : null;

    const rayAvg =
      this.raycastsExecuted > 0 ? Number((this.raycastMsSum / this.raycastsExecuted).toFixed(3)) : 0;

    return {
      missionId: this.missionId,
      coordinator,
      metrics: {
        elapsedSec: Number(this.elapsedSec.toFixed(1)),
        enemiesAwareCount: aware,
        enemiesAimingCount: aiming,
        enemiesFiringCount: firing,
        incomingProjectilesCount,
        damageLast5s: Number(this.getRollingDamage(5).toFixed(1)),
        damageLast10s: Number(this.getRollingDamage(10).toFixed(1)),
        damageLast30s: Number(this.getRollingDamage(30).toFixed(1)),
        totalDamageReceived: Number(this.totalDamageReceived.toFixed(1)),
        totalArmorAbsorbed: Number(this.totalArmorAbsorbed.toFixed(1)),
        totalHealthLost: Number(this.totalHealthLost.toFixed(1)),
        duplicateDamageBlockedCount: this.duplicateDamageBlockedCount,
        hitZoneCounts: { ...this.hitZoneCounts },
        totalShotsFired: this.totalShotsFired,
        totalShotsHit: this.totalShotsHit,
        totalShotsMissed: this.totalShotsMissed,
        totalShotsBlockedByCover: this.totalShotsBlockedByCover,
        enemyHitPercentage: hitPct,
        coverBlockedPercentage: blockedPct,
        uniqueEnemiesDetectedPlayer: this.detectedSet.size,
        uniqueEnemiesGrantedToken: this.grantedTokenSet.size,
        uniqueEnemiesFired: this.firedSet.size,
        timeFirstDetectionSec:
          this.timeFirstDetectionSec !== null ? Number(this.timeFirstDetectionSec.toFixed(2)) : null,
        timeFirstDamageSec:
          this.timeFirstDamageSec !== null ? Number(this.timeFirstDamageSec.toFixed(2)) : null,
        firstDetectToFirstDamageSec,
        timeSpentExposedSec: Number(this.timeSpentExposedSec.toFixed(1)),
        timeSpentInCoverSec: Number(this.timeSpentInCoverSec.toFixed(1)),
        lastLeftCoverTimeSec:
          this.lastLeftCoverTimeSec !== null ? Number(this.lastLeftCoverTimeSec.toFixed(2)) : null,
        leaveCoverToFirstHitSec:
          this.leaveCoverToFirstHitSec !== null
            ? Number(this.leaveCoverToFirstHitSec.toFixed(2))
            : null,
        damageByDomain: {
          ground: Number(this.damageByDomain.ground.toFixed(1)),
          air: Number(this.damageByDomain.air.toFixed(1)),
          vehicle: Number(this.damageByDomain.vehicle.toFixed(1)),
        },
        damageByWeapon: damageByWeaponObj,
        damageByEnemy: damageByEnemyArr,
        tokenAcquisitionAvgMs:
          this.tokenLatencySamples > 0
            ? Number((this.tokenLatencySumMs / this.tokenLatencySamples).toFixed(2))
            : 0,
        tokenStarvationCount: this.tokenStarvationCount,
        invalidAttackAttempts: this.invalidAttackAttempts,
        tunnelingBlockedCount: this.tunnelingBlockedCount,
        speedOutliersCount: this.speedOutliersCount,
        timePlayerDeathSec: this.timePlayerDeathSec,
        fatalDamageSource: this.fatalDamageSource ? { ...this.fatalDamageSource } : null,
        playerShotsFired: this.playerShotsFired,
        playerShotsHit: this.playerShotsHit,
        playerAccuracyPct:
          this.playerShotsFired > 0
            ? Number(((this.playerShotsHit / this.playerShotsFired) * 100).toFixed(1))
            : 0,
        playerEnemyZoneHits: { ...this.playerEnemyZoneHits },
        objectiveCompletedAtSec: { ...this.objectiveCompletedAtSec },
        missionRestartCount: this.missionRestartCount,
      },
      ballisticsStats: {
        raycastsExecuted: this.raycastsExecuted,
        raycastAvgMs: rayAvg,
        raycastMaxMs: Number(this.raycastMaxMs.toFixed(3)),
        blockedByCategory: { ...this.blockedByCategory },
      },
      enemies,
      recentEvents: [...this.eventsRing].reverse(),
      recentShots: this.shotsRing.slice(-64),
      recentDamages: [...this.damageRing].reverse().slice(0, 48),
      playerMovement: { ...this.latestPlayerMovement },
      flightSamples: [...this.latestFlightSamples],
      recentExplosions: [...this.explosionsRing].reverse(),
      recentDestructions: [...this.destructionsRing].reverse(),
      ordnanceSummary: { ...this.latestOrdnance },
      performance: {
        ...this.latestPerformance,
        phases: { ...this.latestPerformance.phases },
      },
      resources: { ...this.latestResources },
      warnings: [...this.warningsList],
      physics: this.latestPhysics,
    };
  }

  getBufferCounts(): { events: number; shots: number; damages: number; explosions: number } {
    return {
      events: this.eventsRing.length,
      shots: this.shotsRing.length,
      damages: this.damageRing.length,
      explosions: this.explosionsRing.length,
    };
  }
}
