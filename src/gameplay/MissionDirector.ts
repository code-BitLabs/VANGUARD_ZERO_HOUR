import { DIFFICULTY_COMBAT_PROFILES } from '@/src/schemas/combat.schema';
import { Difficulty, MissionGrade } from '@/src/schemas/common.schema';
import { MiniMapBlip, ObjectiveStatus } from '@/src/schemas/events.schema';
import {
  AirUnitType,
  DemolitionPolicy,
  MissionConfig,
  ObjectiveActionMetadata,
  ObjectiveLifecycleStatus,
  ObjectiveType,
} from '@/src/schemas/mission.schema';
import {
  clampCheckpointVitals,
  MissionAttemptContext,
  MissionCheckpointSnapshot,
} from './MissionCheckpoint';

export type DemolitionCause = 'interact_charge' | 'c4' | 'explosion' | 'weapon';

export interface MissionCombatMetricsInput {
  shotsFired?: number;
  shotsHit?: number;
  deathsCount?: number;
  damageReceived?: number;
  survivalTimeSec?: number;
}

export interface MissionRuntimeSummary {
  victory: boolean;
  score: number;
  grade: MissionGrade;
  xpEarned: number;
  requisitionEarned: number;
  kills: number;
  headshots: number;
  airKills: number;
  durationSec: number;
  shotsFired: number;
  shotsHit: number;
  accuracyPct: number;
  headshotPct: number;
  deathsCount: number;
  damageReceived: number;
  survivalTimeSec: number;
}

export interface WaveProgressionStatus {
  hasActiveWaveObjective: boolean;
  remainingRequiredKills: number;
  aliveEnemies: number;
  shouldSpawnReinforcements: boolean;
  spawnCount: number;
  statusText: string | null;
  waveStatusText: string | null;
}

interface InternalObjectiveState {
  id: string;
  title: string;
  description: string;
  type: ObjectiveType;
  current: number;
  target: number;
  completed: boolean;
  bypassed: boolean;
  isOptional: boolean;
  stageIndex: number;
  stageTitle: string;
  prerequisiteIds: string[];
  demolitionPolicy: DemolitionPolicy;
  demolitionZoneRadius: number;
  bonusScore: number;
  bypassScore: number;
  blockedExplanation?: string;
  status: ObjectiveLifecycleStatus;
  completedAtSec: number | null;
  markerPos: { x: number; y: number; z: number };
  targetAirUnitTypes?: AirUnitType[];
  actionMeta?: ObjectiveActionMetadata;
  /** Count of targets destroyed via unauthorized weapons/explosives on a charge_or_c4_only objective */
  unauthorizedDestructionCount: number;
}

export class MissionDirector {
  private objectives: InternalObjectiveState[] = [];
  private activeStageIndex = 1;
  private totalStages = 1;
  private readonly destroyedTargetIds = new Set<string>();
  private readonly retroactiveCreditedObjectiveIds = new Set<string>();
  private lastKillTimestampSec = 0;
  private antiStallReinforcementCooldownSec = 0;

  public score = 0;
  public kills = 0;
  public headshots = 0;
  public airKills = 0;
  public elapsedSec = 0;
  public alertText: string | null = null;
  public subtitleText: string | null = null;
  private alertTimer = 0;
  private subtitleTimer = 0;
  private extractionWarnCooldown = 0;
  private checkpointHealth = 125;
  private checkpointArmor = 125;
  private checkpointSequence = 0;
  private missionEnded = false;

  constructor(
    private readonly config: MissionConfig,
    private readonly difficulty: Difficulty,
    private readonly attemptContext?: MissionAttemptContext,
    restoredSnapshot?: MissionCheckpointSnapshot,
    private readonly onObjectiveCompleted?: (
      completedObjectiveId: string,
      activeObjectiveIndex: number
    ) => void
  ) {
    this.reset();
    if (restoredSnapshot) {
      this.restoreFromCheckpoint(restoredSnapshot);
    }
  }

  reset(): void {
    const prof = DIFFICULTY_COMBAT_PROFILES[this.difficulty];
    this.destroyedTargetIds.clear();
    this.retroactiveCreditedObjectiveIds.clear();

    let maxStage = 1;
    this.objectives = this.config.objectives.map((o, idx) => {
      const stageIdx = o.stageIndex ?? idx + 1;
      if (stageIdx > maxStage) maxStage = stageIdx;
      return {
        id: o.id,
        title: o.title,
        description: o.description,
        type: o.type,
        current: 0,
        target: o.targetCount,
        completed: false,
        bypassed: false,
        isOptional: o.isOptional ?? false,
        stageIndex: stageIdx,
        stageTitle: o.stageTitle || `STAGE ${stageIdx} — TACTICAL OPERATION`,
        prerequisiteIds: o.prerequisiteIds ? [...o.prerequisiteIds] : [],
        demolitionPolicy: o.demolitionPolicy ?? 'any_destruction',
        demolitionZoneRadius: o.demolitionZoneRadius ?? 6.5,
        bonusScore: o.bonusScore ?? 350,
        bypassScore: o.bypassScore ?? 125,
        blockedExplanation: o.blockedExplanation,
        status: stageIdx === 1 ? 'active' : 'locked',
        completedAtSec: null,
        markerPos: { ...o.markerPos },
        targetAirUnitTypes: o.targetAirUnitTypes ? [...o.targetAirUnitTypes] : undefined,
        actionMeta: o.actionMeta ? { ...o.actionMeta } : undefined,
        unauthorizedDestructionCount: 0,
      };
    });

    this.totalStages = maxStage;
    this.activeStageIndex = 1;
    this.recomputeStageLifecycle(false);

    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.airKills = 0;
    this.elapsedSec = this.attemptContext ? this.attemptContext.cumulativeElapsedSec : 0;
    this.lastKillTimestampSec = this.elapsedSec;
    this.antiStallReinforcementCooldownSec = 0;
    this.extractionWarnCooldown = 0;
    this.checkpointHealth = prof.playerMaxHealth;
    this.checkpointArmor = prof.playerMaxArmor;
    this.checkpointSequence = 0;
    this.missionEnded = false;

    const stageTitle = this.getActiveStageTitle();
    this.showAlert(`${this.config.codeName}: ${this.config.title.toUpperCase()}`, 4.2);
    this.showSubtitle(
      `COMMAND: ${this.config.subtitle}. ${stageTitle} is now active.`,
      5.0
    );
  }

  private restoreFromCheckpoint(snapshot: MissionCheckpointSnapshot): void {
    const prof = DIFFICULTY_COMBAT_PROFILES[this.difficulty];
    const completedSet = new Set(snapshot.completedObjectiveIds);
    const bypassedSet = new Set(snapshot.bypassedObjectiveIds ?? []);
    this.destroyedTargetIds.clear();
    for (const tid of snapshot.destroyedTargetIds ?? []) {
      this.destroyedTargetIds.add(tid);
    }

    const syncedElapsed = this.attemptContext
      ? this.attemptContext.cumulativeElapsedSec
      : this.elapsedSec;
    this.elapsedSec = syncedElapsed;
    this.lastKillTimestampSec = syncedElapsed;

    for (const o of this.objectives) {
      if (completedSet.has(o.id) || bypassedSet.has(o.id)) {
        o.current = o.target;
        o.completed = true;
        o.bypassed = bypassedSet.has(o.id);
        o.status = o.bypassed ? 'bypassed' : 'completed';
        o.completedAtSec = Number(syncedElapsed.toFixed(2));
      } else {
        o.current = 0;
        o.completed = false;
        o.bypassed = false;
        o.completedAtSec = null;
        o.unauthorizedDestructionCount = 0;
      }
    }

    this.recomputeStageLifecycle(false);

    this.score = snapshot.scoreAtCheckpoint;
    this.kills = snapshot.killsAtCheckpoint;
    this.headshots = snapshot.headshotsAtCheckpoint;
    this.airKills = snapshot.airKillsAtCheckpoint;
    this.checkpointSequence = snapshot.checkpointSequence;
    const clampedVitals = clampCheckpointVitals(
      snapshot.healthAtCheckpoint,
      snapshot.armorAtCheckpoint,
      prof.playerMaxHealth,
      prof.playerMaxArmor
    );
    this.checkpointHealth = clampedVitals.health;
    this.checkpointArmor = clampedVitals.armor;
    this.missionEnded = false;

    const activeIdx = this.getActiveObjectiveIndex();
    const activeObj = this.objectives[activeIdx];
    this.showAlert(
      activeObj
        ? `CHECKPOINT RESTORED — STAGE ${this.activeStageIndex}/${this.totalStages}: ${activeObj.title.toUpperCase()}`
        : 'CHECKPOINT RESTORED',
      3.4
    );
    this.showSubtitle('COMMAND: Resuming from last verified stage checkpoint.', 3.8);
  }

  /**
   * Re-evaluates stage gating and objective lifecycle statuses (`locked`, `available`,
   * `active`, `completed`, `bypassed`, `blocked`) deterministically.
   * When a new stage unlocks and an objective in that stage was already fulfilled early
   * via retroactive target neutralization, it automatically cascades to the next stage.
   */
  private recomputeStageLifecycle(emitNotifications: boolean): void {
    const prevStage = this.activeStageIndex;

    // Find lowest stage index with at least one non-optional incomplete objective
    let nextStage = this.totalStages;
    for (let s = 1; s <= this.totalStages; s++) {
      const stagePrimaries = this.objectives.filter(
        (o) => o.stageIndex === s && !o.isOptional
      );
      if (stagePrimaries.length === 0) continue;
      const allStageDone = stagePrimaries.every((o) => o.completed);
      if (!allStageDone) {
        nextStage = s;
        break;
      }
    }
    this.activeStageIndex = nextStage;

    const resolvedIds = new Set(
      this.objectives.filter((o) => o.completed).map((o) => o.id)
    );

    for (const o of this.objectives) {
      if (o.completed) {
        o.status = o.bypassed ? 'bypassed' : 'completed';
        continue;
      }

      const prereqsMet = o.prerequisiteIds.every((pid) => resolvedIds.has(pid));
      if (o.isOptional) {
        o.status = prereqsMet ? 'available' : 'locked';
        continue;
      }

      if (o.stageIndex === this.activeStageIndex && prereqsMet) {
        o.status = 'active';
      } else if (o.type === 'vehicle_extract' && !prereqsMet) {
        o.status = 'locked';
      } else {
        o.status = 'locked';
      }
    }

    if (emitNotifications && this.activeStageIndex > prevStage) {
      const activePrimary = this.getActivePrimaryObjective();
      if (activePrimary) {
        const wasRetroactive = this.retroactiveCreditedObjectiveIds.has(activePrimary.id);
        this.showAlert(
          `${activePrimary.stageTitle} — ${activePrimary.title.toUpperCase()}`,
          3.6
        );
        this.showSubtitle(
          wasRetroactive
            ? `COMMAND: Prior target neutralization verified. Proceeding with ${activePrimary.title}.`
            : `COMMAND: Stage ${prevStage} complete. ${activePrimary.stageTitle}: ${activePrimary.description}`,
          4.4
        );
      }
    }
  }

  public getActiveStageIndex(): number {
    return this.activeStageIndex;
  }

  public getTotalStages(): number {
    return this.totalStages;
  }

  public getActiveStageTitle(): string {
    const primary = this.getActivePrimaryObjective();
    if (primary) return primary.stageTitle;
    const last = this.objectives[this.objectives.length - 1];
    return last?.stageTitle ?? `STAGE ${this.activeStageIndex}`;
  }

  public getActivePrimaryObjective(): InternalObjectiveState | null {
    return (
      this.objectives.find((o) => !o.completed && o.status === 'active') ??
      this.objectives.find((o) => !o.completed && !o.isOptional) ??
      null
    );
  }

  public getBypassedObjectiveIds(): string[] {
    return this.objectives.filter((o) => o.bypassed).map((o) => o.id);
  }

  public getDestroyedTargetIds(): string[] {
    return Array.from(this.destroyedTargetIds);
  }

  public getNeutralizedTargetIds(): string[] {
    return Array.from(this.destroyedTargetIds);
  }

  public getRetroactiveCreditedObjectiveIds(): string[] {
    return Array.from(this.retroactiveCreditedObjectiveIds);
  }

  /**
   * Dynamically updates the tracked world marker position for incomplete objectives
   * of the given type (e.g., live nearest convoy vehicle tracking for convoy_intercept).
   */
  public updateObjectiveMarkerPosition(
    type: ObjectiveType,
    x: number,
    y: number,
    z: number
  ): void {
    for (let i = 0; i < this.objectives.length; i++) {
      const o = this.objectives[i];
      if (o.type === type && !o.completed) {
        o.markerPos.x = x;
        o.markerPos.y = y;
        o.markerPos.z = z;
      }
    }
  }

  public getExtractionStatus(): 'not_applicable' | 'locked' | 'available' | 'extracting' | 'completed' {
    const extractObj = this.objectives.find((o) => o.type === 'vehicle_extract');
    if (!extractObj) return 'not_applicable';
    if (extractObj.completed) return 'completed';
    const nonExtract = this.objectives.filter((o) => o.type !== 'vehicle_extract' && !o.isOptional);
    const allPrereqsComplete = nonExtract.every((o) => o.completed);
    return allPrereqsComplete ? 'available' : 'locked';
  }

  public getExtractionBlockReason(): string | null {
    const extractObj = this.objectives.find((o) => o.type === 'vehicle_extract');
    if (!extractObj || extractObj.completed) return null;
    const incomplete = this.objectives.filter(
      (o) => o.type !== 'vehicle_extract' && !o.isOptional && !o.completed
    );
    if (incomplete.length === 0) return null;
    const primary = incomplete[0];
    const rem = Math.max(0, primary.target - primary.current);
    return `STAGE ${primary.stageIndex}/${this.totalStages} — Complete ${primary.stageTitle}: ${primary.title} (${rem} remaining)`;
  }

  /**
   * Evaluates active `eliminate_wave` progression and detects anti-stall conditions
   * when alive enemies drop below remaining required kills or when stragglers stall >10s.
   */
  public evaluateWaveProgression(aliveEnemyCount: number): WaveProgressionStatus {
    const activeWave = this.objectives.find(
      (o) =>
        o.type === 'eliminate_wave' &&
        !o.completed &&
        (o.status === 'active' || o.stageIndex === this.activeStageIndex)
    );

    if (!activeWave) {
      return {
        hasActiveWaveObjective: false,
        remainingRequiredKills: 0,
        aliveEnemies: aliveEnemyCount,
        shouldSpawnReinforcements: false,
        spawnCount: 0,
        statusText: null,
        waveStatusText: null,
      };
    }

    const remainingRequiredKills = Math.max(0, activeWave.target - activeWave.current);
    const deficit = remainingRequiredKills - aliveEnemyCount;
    const timeSinceKill = this.elapsedSec - this.lastKillTimestampSec;

    const needsImmediateTopUp =
      deficit > 0 && this.antiStallReinforcementCooldownSec <= 0;
    const needsStallReinforcement =
      aliveEnemyCount < 3 &&
      remainingRequiredKills > 0 &&
      timeSinceKill >= 10.0 &&
      this.antiStallReinforcementCooldownSec <= 0;

    const shouldSpawn = needsImmediateTopUp || needsStallReinforcement;
    const spawnCount = shouldSpawn
      ? Math.max(2, Math.min(5, Math.max(deficit, 3)))
      : 0;

    if (shouldSpawn) {
      this.antiStallReinforcementCooldownSec = 8.0;
    }

    const statusText = shouldSpawn
      ? `REINFORCEMENTS DEPLOYING (+${spawnCount}) — HOSTILES REMAINING: ${remainingRequiredKills} (${aliveEnemyCount} ACTIVE IN SECTOR)`
      : `HOSTILES REMAINING: ${remainingRequiredKills} (${aliveEnemyCount} ACTIVE IN SECTOR)`;

    return {
      hasActiveWaveObjective: true,
      remainingRequiredKills,
      aliveEnemies: aliveEnemyCount,
      shouldSpawnReinforcements: shouldSpawn,
      spawnCount,
      statusText,
      waveStatusText: statusText,
    };
  }

  /**
   * Derives a concise, platform-accurate tactical instruction from the currently active
   * stage objective and live progress so players always know what to do next.
   */
  getActiveActionDirective(
    inputDevice: 'touch' | 'keyboard',
    inVehicle: boolean,
    rpgEquipped: boolean
  ): string | null {
    const active = this.getActivePrimaryObjective();
    if (!active) return null;

    const remaining = Math.max(0, active.target - active.current);
    const isTouch = inputDevice === 'touch';
    const meta = active.actionMeta;
    const targetName = meta?.targetLabel || active.title;
    const stagePrefix = `NEXT ACTION [STAGE ${active.stageIndex}/${this.totalStages}]:`;

    if (active.type === 'vehicle_extract' || meta?.actionKind === 'reach_extraction') {
      if (inVehicle) {
        return isTouch
          ? `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Hold GAS and steer to the green ${targetName} marker`
          : `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Hold [W] to drive into the green ${targetName} beacon`;
      }
      return isTouch
        ? `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Sprint or tap [USE] near a truck to drive into the ${targetName}`
        : `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Sprint or press [E] to board a vehicle and reach the ${targetName}`;
    }

    if (meta?.actionKind === 'destroy_convoy' || active.type === 'convoy_intercept') {
      if (inVehicle) {
        return isTouch
          ? `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Pursue convoy (${remaining} left) — tap [FIRE] turret or exit & use [RPG]`
          : `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Pursue convoy (${remaining} left) — [LMB] fire roof turret or use [7] RPG`;
      }
      return isTouch
        ? `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Destroy ${remaining} ${targetName} — tap [RPG] button or [USE] to board Strike Jeep`
        : `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Destroy ${remaining} ${targetName} — press [7] for RPG-7V or [E] to board Strike Jeep`;
    }

    if (
      active.type === 'plant_charge' ||
      active.demolitionPolicy === 'charge_or_c4_only' ||
      meta?.actionKind === 'plant_charge'
    ) {
      return isTouch
        ? `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Approach ${targetName} (${remaining} left) and tap [USE] to plant charge or detonate [C4]`
        : `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Approach ${targetName} (${remaining} left) and press [E] to plant charge or detonate [C] C4`;
    }

    if (meta?.actionKind === 'sabotage_or_shoot' || active.type === 'destroy_targets') {
      return isTouch
        ? `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Destroy ${remaining} ${targetName} — shoot, tap [RPG], or tap [USE] at close range`
        : `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Destroy ${remaining} ${targetName} — shoot, press [7] RPG, or press [E] up close`;
    }

    if (
      meta?.actionKind === 'lock_and_destroy_aircraft' ||
      meta?.actionKind === 'destroy_aircraft' ||
      active.type === 'air_defense'
    ) {
      if (rpgEquipped) {
        return isTouch
          ? `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Lead target and tap [FIRE] to launch RPG at ${targetName} (${remaining} left)`
          : `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Lead target and press [LMB] to fire RPG at ${targetName} (${remaining} left)`;
      }
      return isTouch
        ? `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Tap [RPG] or [8] Guided Launcher to shoot down ${remaining} ${targetName}`
        : `NEXT ACTION: [${active.stageIndex}/${this.totalStages}] Press [7] RPG-7V or [8] Guided Missile (hold RMB to lock) to down ${remaining} ${targetName}`;
    }

    void stagePrefix;
    // Default: engage_infantry / eliminate_wave
    return isTouch
      ? `NEXT ACTION: [STAGE ${active.stageIndex}/${this.totalStages}] Follow diamond HUD markers and eliminate ${remaining} ${targetName}`
      : `NEXT ACTION: [STAGE ${active.stageIndex}/${this.totalStages}] Follow diamond HUD markers and eliminate ${remaining} ${targetName} ([LMB] Fire / [RMB] Aim)`;
  }

  showAlert(text: string, duration = 3.2): void {
    this.alertText = text;
    this.alertTimer = duration;
  }

  showSubtitle(text: string, duration = 4.2): void {
    this.subtitleText = text;
    this.subtitleTimer = duration;
  }

  onEnemyKilled(isHeadshot: boolean, points: number): void {
    this.kills++;
    if (isHeadshot) this.headshots++;
    this.score += points + (isHeadshot ? 50 : 0);
    this.lastKillTimestampSec = this.elapsedSec;
    this.advanceObjectiveProgress('eliminate_wave', 1, {
      allowRetroactiveLockedStage: false,
    });
  }

  onAirUnitKilled(points: number, unitType?: AirUnitType): void {
    this.kills++;
    this.airKills++;
    this.score += points;
    this.lastKillTimestampSec = this.elapsedSec;
    // Fixed world aircraft kills are recorded even if the air stage is currently locked (retroactive credit)
    this.advanceObjectiveProgress('air_defense', 1, {
      airUnitType: unitType,
      allowRetroactiveLockedStage: true,
    });
  }

  /**
   * Context-aware, target-bound demolition and destruction handler.
   * Separates physical destruction (`DestructionSystem`) from mission-action validation:
   * - For `plant_charge` (`demolitionPolicy: 'charge_or_c4_only'`), `interact_charge` or `c4`
   *   satisfies the demolition requirement cleanly.
   * - If an RPG, grenade, vehicle weapon, or gunfire (`explosion` | `weapon`) physically
   *   destroys a `charge_or_c4_only` target before the charge is planted, we record the
   *   target as destroyed and mark the objective as `bypassed` (`bypassed: true`) with reduced
   *   salvage credit so the player is never stuck attempting to plant a charge on a non-existent cache.
   */
  onDestructibleTargetDestroyed(
    points: number,
    targetKind?: string,
    targetId?: string,
    cause: DemolitionCause = 'explosion'
  ): void {
    if (targetId) {
      if (this.destroyedTargetIds.has(targetId)) {
        return; // Prevent duplicate credit for the same physical world entity
      }
      this.destroyedTargetIds.add(targetId);
    }

    if (targetKind === 'weapons_cache') {
      const authorizedDemolition = cause === 'interact_charge' || cause === 'c4';
      this.score += authorizedDemolition ? points : Math.round(points * 0.45);
      this.advanceObjectiveProgress('plant_charge', 1, {
        allowRetroactiveLockedStage: true,
        unauthorizedDemolition: !authorizedDemolition,
      });
      return;
    }

    this.score += points;
    if (targetKind) {
      this.advanceObjectiveProgress('destroy_targets', 1, {
        allowRetroactiveLockedStage: true,
      });
      return;
    }

    const hasActiveDestroy = this.objectives.some(
      (o) => o.type === 'destroy_targets' && !o.completed
    );
    if (hasActiveDestroy) {
      this.advanceObjectiveProgress('destroy_targets', 1, {
        allowRetroactiveLockedStage: true,
      });
    } else {
      this.advanceObjectiveProgress('plant_charge', 1, {
        allowRetroactiveLockedStage: true,
        unauthorizedDemolition: cause !== 'interact_charge' && cause !== 'c4',
      });
    }
  }

  /**
   * Invoked when the player explicitly plants a demolition charge via `[E]` or
   * detonates a placed C4 pack within the target's valid demolition zone.
   */
  onChargePlanted(
    points: number,
    targetId?: string,
    cause: 'interact_charge' | 'c4' = 'interact_charge'
  ): void {
    if (targetId) {
      if (this.destroyedTargetIds.has(targetId)) {
        return;
      }
      this.destroyedTargetIds.add(targetId);
    }
    this.score += points;
    this.advanceObjectiveProgress('plant_charge', 1, {
      allowRetroactiveLockedStage: true,
      unauthorizedDemolition: false,
      demolitionCause: cause,
    });
  }

  onConvoyVehicleDestroyed(points: number): void {
    this.score += points;
    this.lastKillTimestampSec = this.elapsedSec;
    this.advanceObjectiveProgress('convoy_intercept', 1, {
      allowRetroactiveLockedStage: true,
    });
  }

  onExtractionReached(): boolean {
    const nonExtract = this.objectives.filter(
      (o) => o.type !== 'vehicle_extract' && !o.isOptional
    );
    const incomplete = nonExtract.filter((o) => !o.completed);
    if (incomplete.length === 0) {
      this.advanceObjectiveProgress('vehicle_extract', 1, {
        allowRetroactiveLockedStage: false,
      });
      return true;
    }
    if (this.extractionWarnCooldown <= 0) {
      this.extractionWarnCooldown = 3.5;
      const primary = incomplete[0];
      const rem = Math.max(0, primary.target - primary.current);
      this.showAlert(
        `EXTRACTION LOCKED — COMPLETE STAGE ${primary.stageIndex}/${this.totalStages}: ${primary.title.toUpperCase()} (${rem} LEFT)`,
        3.4
      );
      this.showSubtitle(
        `COMMAND: Negative on extraction. ${primary.stageTitle} (${primary.title}) must be completed first.`,
        4.0
      );
    }
    return false;
  }

  private advanceObjectiveProgress(
    type: ObjectiveType,
    delta: number,
    options: {
      airUnitType?: AirUnitType;
      allowRetroactiveLockedStage: boolean;
      unauthorizedDemolition?: boolean;
      demolitionCause?: 'interact_charge' | 'c4';
    }
  ): void {
    // Prefer currently active stage objective first; fall back to locked stage if retroactive credit is allowed
    const candidates = this.objectives.filter((o) => {
      if (o.type !== type || o.completed) return false;
      if (
        type === 'air_defense' &&
        o.targetAirUnitTypes &&
        o.targetAirUnitTypes.length > 0 &&
        options.airUnitType &&
        !o.targetAirUnitTypes.includes(options.airUnitType)
      ) {
        return false;
      }
      if (o.status === 'active' || o.stageIndex === this.activeStageIndex) {
        return true;
      }
      return options.allowRetroactiveLockedStage;
    });

    if (candidates.length === 0) return;

    // Sort so active stage objectives receive credit before future locked stages
    candidates.sort((a, b) => a.stageIndex - b.stageIndex);
    const targetObj = candidates[0];
    const isRetroactiveEarlyCredit = targetObj.stageIndex > this.activeStageIndex;

    if (
      options.unauthorizedDemolition &&
      targetObj.demolitionPolicy === 'charge_or_c4_only'
    ) {
      targetObj.unauthorizedDestructionCount += delta;
    }

    targetObj.current = Math.min(targetObj.target, targetObj.current + delta);

    if (isRetroactiveEarlyCredit) {
      this.retroactiveCreditedObjectiveIds.add(targetObj.id);
    }

    if (targetObj.current >= targetObj.target) {
      targetObj.completed = true;
      targetObj.completedAtSec = Number(this.elapsedSec.toFixed(2));

      const wasBypassed =
        targetObj.demolitionPolicy === 'charge_or_c4_only' &&
        targetObj.unauthorizedDestructionCount > 0;
      targetObj.bypassed = wasBypassed;
      targetObj.status = wasBypassed ? 'bypassed' : 'completed';

      this.score += wasBypassed ? targetObj.bypassScore : targetObj.bonusScore;
      this.checkpointSequence++;

      if (wasBypassed) {
        this.showAlert(
          `DEMOLITION BYPASSED — ${targetObj.title.toUpperCase()} DESTROYED WITHOUT CHARGE (+${targetObj.bypassScore} PTS)`,
          3.8
        );
        this.showSubtitle(
          'COMMAND: Target destroyed by uncalibrated blast. Salvage bonus reduced — proceeding to next stage.',
          4.4
        );
      } else if (isRetroactiveEarlyCredit) {
        this.showAlert(
          `EARLY TARGET NEUTRALIZED: ${targetObj.title.toUpperCase()} (CREDIT LOGGED FOR STAGE ${targetObj.stageIndex})`,
          3.4
        );
        this.showSubtitle(
          `COMMAND: Confirmed early destruction of ${targetObj.title}. Credit logged — finish Stage ${this.activeStageIndex} first.`,
          4.2
        );
      } else {
        this.showAlert(`STAGE ${targetObj.stageIndex} COMPLETE: ${targetObj.title.toUpperCase()}`, 3.4);
      }

      this.recomputeStageLifecycle(!wasBypassed && !isRetroactiveEarlyCredit);

      const allDone = this.objectives
        .filter((obj) => !obj.isOptional)
        .every((obj) => obj.completed);
      if (!allDone) {
        this.onObjectiveCompleted?.(targetObj.id, this.getActiveObjectiveIndex());
      }
    } else if (options.unauthorizedDemolition && targetObj.demolitionPolicy === 'charge_or_c4_only') {
      const rem = Math.max(0, targetObj.target - targetObj.current);
      this.showAlert(
        `DEMOLITION BYPASSED — CACHE DESTROYED WITHOUT CHARGE (${rem} REMAINING)`,
        3.4
      );
      this.showSubtitle(
        `COMMAND: Munitions cache destroyed by uncalibrated blast instead of demolition charge. Use [E] or [C] C4 on remaining target.`,
        4.2
      );
    } else if (isRetroactiveEarlyCredit) {
      this.showSubtitle(
        `COMMAND: Stage ${targetObj.stageIndex} target neutralized early (${targetObj.current}/${targetObj.target} logged). Complete Stage ${this.activeStageIndex} to advance.`,
        3.8
      );
    }
  }

  update(
    dt: number,
    playerHealth: number,
    playerArmor: number
  ): { finished: boolean; victory: boolean } {
    this.elapsedSec += dt;
    if (this.attemptContext) {
      this.attemptContext.cumulativeElapsedSec = this.elapsedSec;
    }
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) this.alertText = null;
    }
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitleText = null;
    }
    if (this.extractionWarnCooldown > 0) {
      this.extractionWarnCooldown = Math.max(0, this.extractionWarnCooldown - dt);
    }
    if (this.antiStallReinforcementCooldownSec > 0) {
      this.antiStallReinforcementCooldownSec = Math.max(
        0,
        this.antiStallReinforcementCooldownSec - dt
      );
    }

    if (playerHealth > 40) {
      this.checkpointHealth = Math.max(65, playerHealth);
      this.checkpointArmor = Math.max(50, playerArmor);
    }

    if (this.missionEnded) return { finished: true, victory: playerHealth > 0 };

    if (playerHealth <= 0) {
      this.missionEnded = true;
      return { finished: true, victory: false };
    }

    const allDone = this.objectives
      .filter((o) => !o.isOptional)
      .every((o) => o.completed);
    if (allDone) {
      this.missionEnded = true;
      return { finished: true, victory: true };
    }

    return { finished: false, victory: false };
  }

  getCheckpointStats(): { health: number; armor: number } {
    return { health: this.checkpointHealth, armor: this.checkpointArmor };
  }

  getCheckpointSequence(): number {
    return this.checkpointSequence;
  }

  getCheckpointDeathsCount(): number {
    return this.attemptContext?.checkpointDeathsCount ?? 0;
  }

  getCompletedObjectiveIds(): string[] {
    return this.objectives.filter((o) => o.completed).map((o) => o.id);
  }

  getActiveObjectiveIndex(): number {
    const activePrimaryIdx = this.objectives.findIndex(
      (o) => !o.completed && o.status === 'active'
    );
    if (activePrimaryIdx !== -1) return activePrimaryIdx;
    const idx = this.objectives.findIndex((o) => !o.completed && !o.isOptional);
    return idx === -1 ? this.objectives.length : idx;
  }

  getIncompleteObjectivesMeta(): Array<{
    type: ObjectiveType;
    actionMeta?: ObjectiveActionMetadata;
  }> {
    return this.objectives
      .filter((o) => !o.completed)
      .map((o) => ({ type: o.type, actionMeta: o.actionMeta }));
  }

  getObjectiveStatuses(): ObjectiveStatus[] {
    const activeIdx = this.getActiveObjectiveIndex();
    const resolvedIds = new Set(
      this.objectives.filter((o) => o.completed).map((o) => o.id)
    );

    return this.objectives.map((o, idx) => {
      let blockedReason: string | null = null;
      if (!o.completed && o.status === 'locked') {
        const missingPrereqs = o.prerequisiteIds
          .filter((pid) => !resolvedIds.has(pid))
          .map((pid) => this.objectives.find((cand) => cand.id === pid)?.title ?? pid);
        blockedReason =
          o.blockedExplanation ??
          (missingPrereqs.length > 0
            ? `Requires: ${missingPrereqs.join(', ')}`
            : `Locked until Stage ${o.stageIndex}`);
      }

      return {
        id: o.id,
        title: o.title,
        description: o.description,
        type: o.type,
        current: o.current,
        target: o.target,
        completed: o.completed,
        bypassed: o.bypassed,
        isPrimary: idx === activeIdx && !o.completed,
        stageIndex: o.stageIndex,
        stageTitle: o.stageTitle,
        status: o.status,
        prerequisiteIds: [...o.prerequisiteIds],
        blockedReason,
        demolitionPolicy: o.demolitionPolicy,
        markerPos: { ...o.markerPos },
      };
    });
  }

  getObjectiveCompletionTimestamps(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const o of this.objectives) {
      out[o.id] = o.completedAtSec;
    }
    return out;
  }

  private readonly _blipPool: MiniMapBlip[] = [];

  fillObjectiveBlips(out: MiniMapBlip[]): void {
    let slotIdx = 0;
    for (let i = 0; i < this.objectives.length; i++) {
      const o = this.objectives[i];
      if (o.completed) continue;
      // Show active stage objectives (and available optional objectives) on radar so the player isn't overwhelmed
      if (o.status !== 'active' && o.status !== 'available') continue;
      let slot = this._blipPool[slotIdx];
      if (!slot) {
        slot = {
          id: o.id,
          x: o.markerPos.x,
          z: o.markerPos.z,
          kind: 'objective',
        };
        this._blipPool.push(slot);
      } else {
        slot.id = o.id;
        slot.x = o.markerPos.x;
        slot.z = o.markerPos.z;
        slot.kind = 'objective';
      }
      out.push(slot);
      slotIdx++;
    }
  }

  getObjectiveBlips(): MiniMapBlip[] {
    return this.objectives
      .filter((o) => !o.completed && (o.status === 'active' || o.status === 'available'))
      .map((o) => ({
        id: o.id,
        x: o.markerPos.x,
        z: o.markerPos.z,
        kind: 'objective',
      }));
  }

  buildSummary(
    victory: boolean,
    combatStats?: MissionCombatMetricsInput
  ): MissionRuntimeSummary {
    const diffBonus: Record<Difficulty, number> = {
      easy: 0.85,
      normal: 1.0,
      hard: 1.35,
      extreme: 1.75,
    };

    const shotsFired = Math.max(0, Math.round(combatStats?.shotsFired ?? 0));
    const shotsHit = Math.max(
      0,
      Math.min(shotsFired, Math.round(combatStats?.shotsHit ?? 0))
    );
    const accuracyPct = shotsFired > 0 ? Math.round((shotsHit / shotsFired) * 100) : 0;
    const headshotPct =
      this.kills > 0 ? Math.round((this.headshots / this.kills) * 100) : 0;
    const deathsCount = Math.max(
      0,
      Math.round(combatStats?.deathsCount ?? this.getCheckpointDeathsCount())
    );
    const damageReceived = Math.max(0, Math.round(combatStats?.damageReceived ?? 0));
    const survivalTimeSec = Math.max(
      0,
      Math.round(combatStats?.survivalTimeSec ?? this.elapsedSec)
    );

    const timeBonus = victory
      ? Math.max(0, Math.round((this.config.parTimeSec - this.elapsedSec) * 6))
      : 0;
    const accuracyBonus = victory && shotsFired >= 5 ? Math.round(accuracyPct * 4) : 0;
    const deathPenalty = deathsCount * 350;
    const rawTotal = Math.max(0, this.score + timeBonus + accuracyBonus - deathPenalty);
    const totalScore = Math.round(rawTotal * diffBonus[this.difficulty]);

    let grade: MissionGrade = 'C';
    if (victory) {
      const meetsAccuracyForS = shotsFired === 0 || accuracyPct >= 20;
      if (
        totalScore >= 2600 &&
        this.elapsedSec <= this.config.parTimeSec * 1.15 &&
        deathsCount === 0 &&
        meetsAccuracyForS
      ) {
        grade = 'S';
      } else if (totalScore >= 1800 && deathsCount <= 1) {
        grade = 'A';
      } else if (totalScore >= 1100 && deathsCount <= 3) {
        grade = 'B';
      }
    }

    const xpEarned = victory
      ? Math.round(
          (this.config.baseXpReward + totalScore * 0.25) * diffBonus[this.difficulty]
        )
      : Math.round(this.kills * 22);
    const requisitionEarned = victory
      ? Math.round(140 + totalScore * 0.08)
      : Math.round(25 + this.kills * 4);

    return {
      victory,
      score: totalScore,
      grade,
      xpEarned,
      requisitionEarned,
      kills: this.kills,
      headshots: this.headshots,
      airKills: this.airKills,
      durationSec: Math.round(this.elapsedSec),
      shotsFired,
      shotsHit,
      accuracyPct,
      headshotPct,
      deathsCount,
      damageReceived,
      survivalTimeSec,
    };
  }
}
