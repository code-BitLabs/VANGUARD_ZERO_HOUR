import { Difficulty, MissionGrade } from '@/src/schemas/common.schema';
import { ReplayModifierId } from '@/src/data/challenges';

export interface BoundedDeathSample {
  elapsedSec: number;
  x: number;
  y: number;
  z: number;
  attackerArchetype: string;
  weaponLabel: string;
}

export interface PlaytestFrictionFinding {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  area: 'squad' | 'economy' | 'pacing' | 'combat';
  summary: string;
  recommendation: string;
}

export interface PlaytestExperienceReport {
  schemaVersion: 'stage8_local_playtest_v2';
  privacyNotice: 'Local-only anonymous gameplay metrics; never transmitted externally.';
  missionId: number;
  difficulty: Difficulty;
  activeModifiers: ReplayModifierId[];
  outcome: 'victory' | 'defeat' | 'abandoned';
  grade: MissionGrade | 'F';
  durationSec: number;
  timeFirstDetectionSec: number | null;
  timeFirstDamageSec: number | null;
  timeFirstKillSec: number | null;
  kills: number;
  headshots: number;
  playerAccuracyPct: number;
  deathsCount: number;
  deathLocations: BoundedDeathSample[];
  ammoExhaustionEvents: number;
  resupplyStationsUsed: number;
  healthPickupsCollected: number;
  vehicleUsageSec: number;
  extractionAttempts: number;
  optionalObjectivesCompleted: number;
  checkpointRestarts: number;
  objectiveCompletedAtSec: Record<string, number | null>;
  killsByWeapon: Record<string, number>;
  damageByDomain: { ground: number; air: number; vehicle: number };
  // Stage 8 TRN-48 Squad & Pacing Telemetry
  squadCommandsIssued: number;
  squadCommandBreakdown: Record<string, number>;
  avgCommandLatencyMs: number;
  maxCommandLatencyMs: number;
  squadDownedEvents: number;
  squadMiaEvents: number;
  operatorRescuesByMedic: number;
  operatorRescuesByPlayer: number;
  formationTimeSec: Record<string, number>;
  encounterStageDurationsSec: Record<string, number>;
}

/**
 * Bounded, privacy-conscious local player-experience telemetry tracker (TRN-35 + TRN-48).
 * Captures zero PII, never transmits externally, and never alters combat difficulty invisibly.
 */
export class PlaytestExperienceTracker {
  public static readonly MAX_DEATH_SAMPLES = 16;

  private deathLocations: BoundedDeathSample[] = [];
  private ammoExhaustionEvents = 0;
  private vehicleUsageSec = 0;
  private extractionAttempts = 0;
  private checkpointRestarts = 0;
  private lastAmmoExhaustedFlag = false;

  // Stage 8 TRN-48 counters
  private squadCommandsIssued = 0;
  private squadCommandBreakdown: Record<string, number> = {};
  private commandLatencySumMs = 0;
  private commandLatencyCount = 0;
  private maxCommandLatencyMs = 0;
  private squadDownedEvents = 0;
  private squadMiaEvents = 0;
  private operatorRescuesByMedic = 0;
  private operatorRescuesByPlayer = 0;
  private formationTimeSec: Record<string, number> = {};
  private encounterStageDurationsSec: Record<string, number> = {};

  reset(): void {
    this.deathLocations = [];
    this.ammoExhaustionEvents = 0;
    this.vehicleUsageSec = 0;
    this.extractionAttempts = 0;
    this.checkpointRestarts = 0;
    this.lastAmmoExhaustedFlag = false;

    this.squadCommandsIssued = 0;
    this.squadCommandBreakdown = {};
    this.commandLatencySumMs = 0;
    this.commandLatencyCount = 0;
    this.maxCommandLatencyMs = 0;
    this.squadDownedEvents = 0;
    this.squadMiaEvents = 0;
    this.operatorRescuesByMedic = 0;
    this.operatorRescuesByPlayer = 0;
    this.formationTimeSec = {};
    this.encounterStageDurationsSec = {};
  }

  recordVehicleTime(dt: number, inVehicle: boolean): void {
    if (inVehicle && dt > 0) {
      this.vehicleUsageSec += Math.min(0.25, dt);
    }
  }

  observeActiveWeaponAmmo(ammoInMag: number, reserveAmmo: number): void {
    const empty = ammoInMag <= 0 && reserveAmmo <= 0;
    if (empty && !this.lastAmmoExhaustedFlag) {
      this.ammoExhaustionEvents++;
    }
    this.lastAmmoExhaustedFlag = empty;
  }

  recordExtractionAttempt(): void {
    this.extractionAttempts++;
  }

  recordCheckpointRestart(): void {
    this.checkpointRestarts++;
  }

  recordSquadCommand(order: string, latencyMs?: number): void {
    this.squadCommandsIssued++;
    this.squadCommandBreakdown[order] = (this.squadCommandBreakdown[order] ?? 0) + 1;
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.recordSquadCommandLatency(latencyMs);
    }
  }

  recordSquadCommandLatency(latencyMs: number): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    const clamped = Math.min(5000, latencyMs);
    this.commandLatencySumMs += clamped;
    this.commandLatencyCount++;
    if (clamped > this.maxCommandLatencyMs) {
      this.maxCommandLatencyMs = clamped;
    }
  }

  recordSquadDowned(count = 1): void {
    this.squadDownedEvents += Math.max(0, Math.floor(count));
  }

  recordSquadMia(count = 1): void {
    this.squadMiaEvents += Math.max(0, Math.floor(count));
  }

  recordOperatorRescue(byMedic: boolean): void {
    if (byMedic) {
      this.operatorRescuesByMedic++;
    } else {
      this.operatorRescuesByPlayer++;
    }
  }

  recordFormationTime(formation: string, dt: number): void {
    if (dt <= 0) return;
    const safeDt = Math.min(0.25, dt);
    this.formationTimeSec[formation] = (this.formationTimeSec[formation] ?? 0) + safeDt;
  }

  recordEncounterStageTime(stageIndex: number, dt: number): void {
    if (dt <= 0) return;
    const key = `stage_${stageIndex}`;
    const safeDt = Math.min(0.25, dt);
    this.encounterStageDurationsSec[key] = (this.encounterStageDurationsSec[key] ?? 0) + safeDt;
  }

  recordDeathLocation(sample: BoundedDeathSample): void {
    if (this.deathLocations.length >= PlaytestExperienceTracker.MAX_DEATH_SAMPLES) {
      this.deathLocations.shift();
    }
    this.deathLocations.push({
      elapsedSec: Number(sample.elapsedSec.toFixed(1)),
      x: Number(sample.x.toFixed(1)),
      y: Number(sample.y.toFixed(1)),
      z: Number(sample.z.toFixed(1)),
      attackerArchetype: sample.attackerArchetype,
      weaponLabel: sample.weaponLabel,
    });
  }

  buildReport(params: {
    missionId: number;
    difficulty: Difficulty;
    activeModifiers: readonly ReplayModifierId[];
    outcome: 'victory' | 'defeat' | 'abandoned';
    grade: MissionGrade | 'F';
    durationSec: number;
    timeFirstDetectionSec: number | null;
    timeFirstDamageSec: number | null;
    timeFirstKillSec: number | null;
    kills: number;
    headshots: number;
    playerAccuracyPct: number;
    deathsCount: number;
    resupplyStationsUsed: number;
    healthPickupsCollected: number;
    optionalObjectivesCompleted: number;
    objectiveCompletedAtSec: Record<string, number | null>;
    killsByWeapon: Record<string, number>;
    damageByDomain: { ground: number; air: number; vehicle: number };
  }): PlaytestExperienceReport {
    const roundedFormations: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.formationTimeSec)) {
      roundedFormations[k] = Number(v.toFixed(1));
    }
    const roundedStages: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.encounterStageDurationsSec)) {
      roundedStages[k] = Number(v.toFixed(1));
    }

    const avgLatency =
      this.commandLatencyCount > 0 ? this.commandLatencySumMs / this.commandLatencyCount : 0;

    return {
      schemaVersion: 'stage8_local_playtest_v2',
      privacyNotice: 'Local-only anonymous gameplay metrics; never transmitted externally.',
      missionId: params.missionId,
      difficulty: params.difficulty,
      activeModifiers: [...params.activeModifiers],
      outcome: params.outcome,
      grade: params.grade,
      durationSec: Math.round(params.durationSec),
      timeFirstDetectionSec: params.timeFirstDetectionSec,
      timeFirstDamageSec: params.timeFirstDamageSec,
      timeFirstKillSec: params.timeFirstKillSec,
      kills: params.kills,
      headshots: params.headshots,
      playerAccuracyPct: params.playerAccuracyPct,
      deathsCount: params.deathsCount,
      deathLocations: [...this.deathLocations],
      ammoExhaustionEvents: this.ammoExhaustionEvents,
      resupplyStationsUsed: params.resupplyStationsUsed,
      healthPickupsCollected: params.healthPickupsCollected,
      vehicleUsageSec: Number(this.vehicleUsageSec.toFixed(1)),
      extractionAttempts: this.extractionAttempts,
      optionalObjectivesCompleted: params.optionalObjectivesCompleted,
      checkpointRestarts: this.checkpointRestarts,
      objectiveCompletedAtSec: { ...params.objectiveCompletedAtSec },
      killsByWeapon: { ...params.killsByWeapon },
      damageByDomain: { ...params.damageByDomain },
      squadCommandsIssued: this.squadCommandsIssued,
      squadCommandBreakdown: { ...this.squadCommandBreakdown },
      avgCommandLatencyMs: Number(avgLatency.toFixed(1)),
      maxCommandLatencyMs: Number(this.maxCommandLatencyMs.toFixed(1)),
      squadDownedEvents: this.squadDownedEvents,
      squadMiaEvents: this.squadMiaEvents,
      operatorRescuesByMedic: this.operatorRescuesByMedic,
      operatorRescuesByPlayer: this.operatorRescuesByPlayer,
      formationTimeSec: roundedFormations,
      encounterStageDurationsSec: roundedStages,
    };
  }
}

/**
 * Deterministic, strictly read-only playtest friction analyzer (TRN-48).
 * Converts local playtest telemetry into actionable balance/UX insights without ever
 * silently manipulating in-combat difficulty or rubber-banding enemy damage.
 */
export function diagnosePlaytestFriction(
  report: PlaytestExperienceReport
): PlaytestFrictionFinding[] {
  const findings: PlaytestFrictionFinding[] = [];

  if (report.maxCommandLatencyMs > 120) {
    findings.push({
      code: 'SQUAD_COMMAND_LATENCY_HIGH',
      severity: 'warning',
      area: 'squad',
      summary: `Peak squad command latency reached ${report.maxCommandLatencyMs}ms (target <= 100ms).`,
      recommendation: 'Verify immediate directive preemption on player orders and nav scheduler budget.',
    });
  }

  if (report.durationSec >= 90 && report.squadCommandsIssued === 0) {
    findings.push({
      code: 'SQUAD_COMMANDS_UNUSED',
      severity: 'info',
      area: 'squad',
      summary: 'No squad commands were issued during a sustained mission run.',
      recommendation: 'Ensure Q-radial and F1-F4 order cues are clearly discoverable in HUD.',
    });
  }

  if (report.squadMiaEvents >= 2) {
    findings.push({
      code: 'SQUAD_CASUALTY_SPIKE',
      severity: 'warning',
      area: 'squad',
      summary: `${report.squadMiaEvents} fireteam operators went MIA (${report.squadDownedEvents} downed events).`,
      recommendation: 'Review encounter crossfire density or deploy Field Medic / Hold Cover orders earlier.',
    });
  }

  if (report.ammoExhaustionEvents >= 3 && report.resupplyStationsUsed === 0) {
    findings.push({
      code: 'AMMO_STATION_DISCOVERABILITY',
      severity: 'warning',
      area: 'economy',
      summary: `Player exhausted active weapon ammo ${report.ammoExhaustionEvents} times without using a supply station.`,
      recommendation: 'Increase tactical ammo beacon visibility or place an earlier route crate.',
    });
  } else if (report.ammoExhaustionEvents >= 4) {
    findings.push({
      code: 'AMMO_ECONOMY_STRAIN',
      severity: 'warning',
      area: 'economy',
      summary: `High ammo exhaustion frequency (${report.ammoExhaustionEvents} events) despite ${report.resupplyStationsUsed} resupplies.`,
      recommendation: 'Audit reserve ammo multipliers for high-ROF weapons in this mission.',
    });
  }

  if (report.outcome === 'abandoned' && report.durationSec >= 45) {
    findings.push({
      code: 'MISSION_ABANDONMENT_FRICTION',
      severity: 'warning',
      area: 'pacing',
      summary: `Mission ${report.missionId} was abandoned after ${report.durationSec}s with ${report.deathsCount} deaths.`,
      recommendation: 'Inspect checkpoint spacing and objective guidance around the active stage.',
    });
  }

  if (report.deathsCount >= 3 || report.checkpointRestarts >= 3) {
    findings.push({
      code: 'COMBAT_SPIKE_DETECTED',
      severity: 'warning',
      area: 'combat',
      summary: `Player experienced ${report.deathsCount} deaths and ${report.checkpointRestarts} checkpoint restarts.`,
      recommendation: 'Review death coordinates and attacker archetype distribution for unfair spike overlap.',
    });
  }

  if (findings.length === 0) {
    findings.push({
      code: 'SESSION_BALANCED',
      severity: 'info',
      area: 'pacing',
      summary: `Mission ${report.missionId} (${report.difficulty}) completed cleanly with balanced pacing and sustainment.`,
      recommendation: 'No critical gameplay friction detected in this session.',
    });
  }

  return findings;
}
