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

export interface PlaytestExperienceReport {
  schemaVersion: 'stage6_local_playtest_v1';
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
}

/**
 * Bounded, privacy-conscious local player-experience telemetry tracker (TRN-35).
 * Captures zero PII and never sends network requests.
 */
export class PlaytestExperienceTracker {
  public static readonly MAX_DEATH_SAMPLES = 16;

  private deathLocations: BoundedDeathSample[] = [];
  private ammoExhaustionEvents = 0;
  private vehicleUsageSec = 0;
  private extractionAttempts = 0;
  private checkpointRestarts = 0;
  private lastAmmoExhaustedFlag = false;

  reset(): void {
    this.deathLocations = [];
    this.ammoExhaustionEvents = 0;
    this.vehicleUsageSec = 0;
    this.extractionAttempts = 0;
    this.checkpointRestarts = 0;
    this.lastAmmoExhaustedFlag = false;
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
    return {
      schemaVersion: 'stage6_local_playtest_v1',
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
    };
  }
}
