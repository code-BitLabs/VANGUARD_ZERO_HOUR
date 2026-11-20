import { Difficulty } from '@/src/schemas/common.schema';
import { EnemyArchetype } from '@/src/schemas/enemy.schema';

export type SoloPressureState = 'CALM' | 'ENGAGED' | 'HIGH_PRESSURE' | 'RELIEF_WINDOW';

export interface SoloEngagementConstraints {
  maxGlobalAttackers: number;
  maxClimaxGlobalAttackers: number;
  maxSquadAttackers: number;
  maxSquadSuppressors: number;
  maxSimultaneousFocusSquads: number;
}

export interface SoloBonusSupplyStationSpec {
  id: string;
  kind: 'ammo_crate' | 'med_armor_station';
  position: { x: number; y: number; z: number };
  maxCharges: number;
  label: string;
}

export interface SoloDirectorTelemetryInput {
  dt: number;
  elapsedSec: number;
  playerHealthRatio: number;
  playerArmorRatio: number;
  reserveAmmoRatio: number;
  rolling2sDamage: number;
  aliveEnemies: number;
  activeAttackers: number;
}

export interface SoloTraumaKitStatus {
  chargesRemaining: number;
  maxCharges: number;
  cooldownRemainingSec: number;
  pressureState: SoloPressureState;
}

export interface SoloTraumaReviveOutcome {
  ok: boolean;
  restoredHealth: number;
  restoredArmor: number;
  stabilizationSec: number;
  reason?: string;
}

/**
 * Dedicated Adaptive Solo Encounter Director.
 *
 * Balances Solo Operator deployments without reducing enemy HP, weapon damage,
 * or boss mechanics:
 * - Limits simultaneous attackers and caps focusing squads to 1
 * - Staggers reinforcement waves and grants longer tactical breathers
 * - Evaluates health, reserve ammo, and recent damage burst to prevent unfair death spirals
 * - Supplies finite strategic cover caches per mission
 * - Grants 1 limited emergency self-recovery trauma charge per mission
 */
export class SoloEncounterDirector {
  private active = false;
  private missionId = 1;
  private difficulty: Difficulty = 'normal';
  private pressureState: SoloPressureState = 'CALM';
  private reliefWindowRemainingSec = 0;
  private reliefCooldownRemainingSec = 0;
  private traumaChargesRemaining = 1;
  private readonly maxTraumaCharges = 1;
  private traumaCooldownSec = 0;
  private lastRecoveryCalloutAtSec = -99;

  reset(active: boolean, missionId: number, difficulty: Difficulty): void {
    this.active = active;
    this.missionId = missionId;
    this.difficulty = difficulty;
    this.pressureState = 'CALM';
    this.reliefWindowRemainingSec = 0;
    this.reliefCooldownRemainingSec = 0;
    this.traumaChargesRemaining = active ? this.maxTraumaCharges : 0;
    this.traumaCooldownSec = 0;
    this.lastRecoveryCalloutAtSec = -99;
  }

  isActive(): boolean {
    return this.active;
  }

  getPressureState(): SoloPressureState {
    return this.pressureState;
  }

  getTraumaKitStatus(): SoloTraumaKitStatus {
    return {
      chargesRemaining: this.traumaChargesRemaining,
      maxCharges: this.maxTraumaCharges,
      cooldownRemainingSec: Number(this.traumaCooldownSec.toFixed(1)),
      pressureState: this.pressureState,
    };
  }

  canUseTraumaSelfRecovery(): boolean {
    return this.active && this.traumaChargesRemaining > 0 && this.traumaCooldownSec <= 0;
  }

  useTraumaSelfRecovery(): SoloTraumaReviveOutcome {
    if (!this.active) {
      return {
        ok: false,
        restoredHealth: 0,
        restoredArmor: 0,
        stabilizationSec: 0,
        reason: 'Solo trauma kit is only issued on Solo Operator deployments.',
      };
    }
    if (this.traumaChargesRemaining <= 0) {
      return {
        ok: false,
        restoredHealth: 0,
        restoredArmor: 0,
        stabilizationSec: 0,
        reason: 'Emergency trauma charge already expended this operation.',
      };
    }
    if (this.traumaCooldownSec > 0) {
      return {
        ok: false,
        restoredHealth: 0,
        restoredArmor: 0,
        stabilizationSec: 0,
        reason: `Trauma injector cycling (${Math.ceil(this.traumaCooldownSec)}s).`,
      };
    }

    this.traumaChargesRemaining -= 1;
    this.traumaCooldownSec = 45;
    this.reliefWindowRemainingSec = Math.max(this.reliefWindowRemainingSec, 5.5);
    this.pressureState = 'RELIEF_WINDOW';

    return {
      ok: true,
      restoredHealth: 55,
      restoredArmor: 25,
      stabilizationSec: 2.5,
    };
  }

  update(input: SoloDirectorTelemetryInput): {
    constraints: SoloEngagementConstraints | null;
    calloutText: string | null;
  } {
    if (!this.active) {
      return { constraints: null, calloutText: null };
    }

    const safeDt = Math.max(0, Math.min(0.25, input.dt));
    if (this.traumaCooldownSec > 0) {
      this.traumaCooldownSec = Math.max(0, this.traumaCooldownSec - safeDt);
    }
    if (this.reliefCooldownRemainingSec > 0) {
      this.reliefCooldownRemainingSec = Math.max(0, this.reliefCooldownRemainingSec - safeDt);
    }

    let calloutText: string | null = null;

    const criticalVitals =
      input.playerHealthRatio <= 0.34 ||
      (input.playerHealthRatio <= 0.48 && input.rolling2sDamage >= 28);
    const lowAmmoCrisis = input.reserveAmmoRatio <= 0.18 && input.playerHealthRatio <= 0.6;

    if (this.reliefWindowRemainingSec > 0) {
      this.reliefWindowRemainingSec = Math.max(0, this.reliefWindowRemainingSec - safeDt);
      this.pressureState = 'RELIEF_WINDOW';
    } else if ((criticalVitals || lowAmmoCrisis) && this.reliefCooldownRemainingSec <= 0) {
      this.reliefWindowRemainingSec = 5.0;
      this.reliefCooldownRemainingSec = 18.0;
      this.pressureState = 'RELIEF_WINDOW';
      if (input.elapsedSec - this.lastRecoveryCalloutAtSec >= 20) {
        this.lastRecoveryCalloutAtSec = input.elapsedSec;
        calloutText = lowAmmoCrisis
          ? 'OVERWATCH: Hostile push staggered — reposition to a Solo supply cache.'
          : 'OVERWATCH: Reposition behind cover — incoming push staggered.';
      }
    } else if (input.rolling2sDamage >= 22 || input.activeAttackers >= 2 || input.playerHealthRatio <= 0.58) {
      this.pressureState = 'HIGH_PRESSURE';
    } else if (input.aliveEnemies > 0 && input.activeAttackers > 0) {
      this.pressureState = 'ENGAGED';
    } else {
      this.pressureState = 'CALM';
    }

    return {
      constraints: this.getEngagementConstraints(),
      calloutText,
    };
  }

  getEngagementConstraints(): SoloEngagementConstraints | null {
    if (!this.active) return null;

    // Never nerf enemy damage or HP; strictly bound simultaneous attackers & multi-squad focus
    const baseMaxAttackers =
      this.difficulty === 'easy'
        ? 1
        : this.difficulty === 'normal'
          ? 2
          : this.difficulty === 'hard'
            ? 2
            : 2;

    const effectiveMax =
      this.pressureState === 'RELIEF_WINDOW' ? 1 : baseMaxAttackers;

    return {
      maxGlobalAttackers: effectiveMax,
      maxClimaxGlobalAttackers: this.pressureState === 'RELIEF_WINDOW' ? 1 : Math.min(2, baseMaxAttackers + 1),
      maxSquadAttackers: effectiveMax,
      maxSquadSuppressors: this.pressureState === 'RELIEF_WINDOW' ? 0 : 1,
      maxSimultaneousFocusSquads: 1,
    };
  }

  getReinforcementIntervalMultiplier(): number {
    if (!this.active) return 1.0;
    return this.pressureState === 'RELIEF_WINDOW' ? 1.55 : 1.35;
  }

  getStageBreatherBonusSec(): number {
    if (!this.active) return 0;
    return 4.0;
  }

  adjustReinforcementWave(requestedCount: number, archetype: EnemyArchetype): {
    count: number;
    staggerDelaySec: number;
    calloutPrefix: string;
  } {
    if (!this.active) {
      return { count: requestedCount, staggerDelaySec: 0, calloutPrefix: '' };
    }
    const reduced =
      requestedCount >= 3
        ? requestedCount - 1
        : this.pressureState === 'RELIEF_WINDOW' && requestedCount >= 2
          ? 1
          : requestedCount;
    const isHeavy = archetype === 'heavy_armor' || archetype === 'rocket_trooper';
    return {
      count: Math.max(1, isHeavy ? Math.min(2, reduced) : reduced),
      staggerDelaySec: this.pressureState === 'RELIEF_WINDOW' ? 4.0 : 2.2,
      calloutPrefix: '[SOLO TELEGRAPH]',
    };
  }

  getSoloBonusSupplyStations(missionId: number = this.missionId): SoloBonusSupplyStationSpec[] {
    if (!this.active) return [];
    switch (missionId) {
      case 1:
        return [
          {
            id: 'solo_m1_med_cache_east',
            kind: 'med_armor_station',
            position: { x: 14, y: 0, z: 4 },
            maxCharges: 2,
            label: 'SOLO TRAUMA & ARMOR CACHE',
          },
          {
            id: 'solo_m1_ammo_cache_north',
            kind: 'ammo_crate',
            position: { x: -12, y: 0, z: -18 },
            maxCharges: 2,
            label: 'SOLO TACTICAL AMMO STASH',
          },
        ];
      case 2:
        return [
          {
            id: 'solo_m2_med_cache_berm',
            kind: 'med_armor_station',
            position: { x: -14, y: 0, z: -8 },
            maxCharges: 2,
            label: 'SOLO TRAUMA & ARMOR CACHE',
          },
          {
            id: 'solo_m2_ammo_cache_depot',
            kind: 'ammo_crate',
            position: { x: 12, y: 0, z: -32 },
            maxCharges: 2,
            label: 'SOLO TACTICAL AMMO STASH',
          },
        ];
      case 3:
        return [
          {
            id: 'solo_m3_med_cache_plaza',
            kind: 'med_armor_station',
            position: { x: 14, y: 0, z: -6 },
            maxCharges: 2,
            label: 'SOLO TRAUMA & ARMOR CACHE',
          },
          {
            id: 'solo_m3_ammo_cache_west',
            kind: 'ammo_crate',
            position: { x: -15, y: 0, z: -22 },
            maxCharges: 2,
            label: 'SOLO TACTICAL AMMO STASH',
          },
        ];
      case 4:
        return [
          {
            id: 'solo_m4_med_cache_bridge',
            kind: 'med_armor_station',
            position: { x: -10, y: 0, z: 8 },
            maxCharges: 2,
            label: 'SOLO TRAUMA & ARMOR CACHE',
          },
          {
            id: 'solo_m4_ammo_cache_ridge',
            kind: 'ammo_crate',
            position: { x: 14, y: 0, z: -18 },
            maxCharges: 2,
            label: 'SOLO TACTICAL AMMO STASH',
          },
        ];
      case 5:
      default:
        return [
          {
            id: 'solo_m5_med_cache_entry',
            kind: 'med_armor_station',
            position: { x: -12, y: 0, z: 8 },
            maxCharges: 2,
            label: 'SOLO TRAUMA & ARMOR CACHE',
          },
          {
            id: 'solo_m5_ammo_cache_core',
            kind: 'ammo_crate',
            position: { x: 12, y: 0, z: -16 },
            maxCharges: 2,
            label: 'SOLO TACTICAL AMMO STASH',
          },
          {
            id: 'solo_m5_med_cache_north',
            kind: 'med_armor_station',
            position: { x: -8, y: 0, z: -34 },
            maxCharges: 2,
            label: 'SOLO EXTRACTION TRAUMA CACHE',
          },
        ];
    }
  }
}
