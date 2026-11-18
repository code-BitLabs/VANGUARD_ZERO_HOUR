import type { ActiveTacticalHint } from '../schemas/events.schema';
import { missionSelectionStore } from '../stores/missionSelectionStore';

export type ControlScheme = 'touch' | 'desktop_kb_mouse' | 'keyboard_mouse' | 'gamepad';

export interface TacticalEvaluationContext {
  nowSec: number;
  controlScheme: ControlScheme;
  tacticalHintsEnabled: boolean;
  isIntenseCombat: boolean;
  isPlayerDowned: boolean;
  isNukeActive: boolean;
  healthPct: number;
  magazineAmmo: number;
  reserveAmmo: number;
  isReloading: boolean;
  isNearDemolitionCache: boolean;
  isNearSabotageTarget: boolean;
  isNearVehicle: boolean;
  isInsideVehicle: boolean;
  hasActiveAirObjective: boolean;
  hasEquippedStingerOrRpg: boolean;
  hasC4Available: boolean;
  isPlantChargeStageActive: boolean;
  extractionStatus: 'not_applicable' | 'locked' | 'available' | 'extracting' | 'completed';
  extractionBlockReason: string | null;
  isPlayerNearExtraction: boolean;
  activeObjectiveType: string | null;
}

export interface Tier3MechanicCard {
  id: string;
  badge: string;
  title: string;
  summary: string;
  desktopControls: string;
  mobileControls: string;
  tacticalNotes: string[];
}

export const TIER3_MECHANIC_CARDS: readonly Tier3MechanicCard[] = [
  {
    id: 'demolition_protocol',
    badge: 'DEMOLITION',
    title: 'Target-Bound Cache Demolition ([E] / C4)',
    summary:
      'Munitions cache demolition objectives require deliberate charge placement inside the 6.5m demolition zone.',
    desktopControls: 'Approach cache and press [E] Plant Charge, or press [5] C4 -> LMB Place -> [G] Detonate',
    mobileControls: 'Approach cache and tap [INTERACT], or tap [C4] -> [PLACE] -> [DETONATE]',
    tacticalNotes: [
      'Pressing [E] or detonating placed C4 within 6.5m satisfies the demolition objective for full command score.',
      'Destroying a munitions cache from afar with RPGs, grenades, or cannon fire physically ruins the cache and marks the demolition objective as BYPASSED (reduced salvage score).',
      'Standard sabotage targets (AA Radar Relays, Fuel Depots) can be destroyed by any explosive, heavy fire, or [E] sabotage.',
    ],
  },
  {
    id: 'air_defense_lock',
    badge: 'ANTI-AIR',
    title: 'FIM-92X Stinger & Air Threat Interdiction',
    summary:
      'Gunships, transport helicopters, and autonomous drones require dedicated anti-air tracking or heavy ordnance.',
    desktopControls: 'Press [8] FIM-92X Stinger (or [7] RPG-7) -> Hold RMB (ADS) on aircraft for tone lock -> LMB Fire',
    mobileControls: 'Tap [STINGER] or [RPG] on weapon bar -> Hold [ADS] on aircraft -> Tap [FIRE]',
    tacticalNotes: [
      'FIM-92X Stinger missiles lock onto airborne signatures while aiming down sights.',
      'Supply crates across the AO replenish Stinger and RPG-7 rockets during multi-wave air engagements.',
    ],
  },
  {
    id: 'close_air_support',
    badge: 'SUPPORT',
    title: 'A-10 Warthog Close Air Support',
    summary:
      'Requests a low-altitude 30mm GAU-8 strafing run and cluster munition pass along your forward line of sight.',
    desktopControls: 'Aim at target corridor and press [V] Air Strike',
    mobileControls: 'Aim at target corridor and tap [AIR STRIKE] support button',
    tacticalNotes: [
      'Ideal for hardened armor columns, bunker clusters, and dense reinforcement waves.',
      'Subject to tactical cooldown after each sortie.',
    ],
  },
  {
    id: 'trident_strategic',
    badge: 'STRATEGIC',
    title: 'TRIDENT-X Tactical Nuclear Strike',
    summary:
      'Deploys a theater-wide thermonuclear warhead with a 10-second detonation countdown and EMP shockwave.',
    desktopControls: 'Aim at distant target sector and press [N] TRIDENT-X Strike',
    mobileControls: 'Tap [NUKE] strategic button',
    tacticalNotes: [
      'Maintain safe standoff distance (>85m) and seek hard cover before zero-hour detonation.',
      'Caution: Using wide-area ordnance near unplanted munitions caches will bypass precision demolition bonuses.',
    ],
  },
  {
    id: 'armored_vehicles',
    badge: 'ARMOR OPS',
    title: 'IFV / Tank Piloting & Coaxial Weapons',
    summary:
      'Commandeer field-deployed light tanks, armored troop carriers, and recon strike helicopters.',
    desktopControls: '[E] Board / Exit Vehicle · [WASD] Drive · [LMB] Primary Cannon · [F] Coaxial MG · [C] Camera',
    mobileControls: 'Tap [BOARD] near vehicle · Left Stick Drive · [FIRE] Cannon · [COAX] MG · [CAM] View',
    tacticalNotes: [
      'Armored hulls absorb small-arms fire; monitor vehicle hull integrity on the bottom HUD bar.',
      'Disembark before hull integrity reaches 0% to avoid catastrophic cook-off damage.',
    ],
  },
  {
    id: 'mobile_claw_hud',
    badge: 'ERGONOMICS',
    title: 'Adaptive Touch HUD & 3/4-Finger Claw Presets',
    summary:
      'Customize button coordinates, scale, opacity, and rotational-friction aim assist for mobile or tablet play.',
    desktopControls: 'Pause [ESC] -> Settings -> Controls / HUD',
    mobileControls: 'Pause -> Customize Touch HUD (Drag & Pinch Controls, or select 2-Thumb / 3-Finger / 4-Finger Preset)',
    tacticalNotes: [
      'Rotational-friction aim assist slows look sensitivity over hostile silhouettes without snapping.',
      'All custom button placements persist automatically across campaign deployments.',
    ],
  },
];

interface HintCooldownRecord {
  lastShownSec: number;
  timesShown: number;
}

/**
 * Deterministic Three-Tier Military Tactical Guidance System.
 * - Tier 1: Compact, non-blocking contextual HUD prompts with priority, cooldowns, auto-clear, and dismissal persistence.
 * - Tier 2: Deduplicated tactical radio subtitle helper.
 * - Tier 3: Structured field-manual mechanic cards for Pause / Controls screens.
 */
export class TacticalGuidanceSystem {
  private cooldowns = new Map<string, HintCooldownRecord>();
  private activeHint: ActiveTacticalHint | null = null;
  private activeHintExpiresAtSec = 0;
  private lastRadioSubtitleKey = '';
  private lastRadioSubtitleTimeSec = -999;

  public reset(): void {
    this.activeHint = null;
    this.activeHintExpiresAtSec = 0;
    this.lastRadioSubtitleKey = '';
    this.lastRadioSubtitleTimeSec = -999;
  }

  public clearCooldowns(): void {
    this.cooldowns.clear();
    this.reset();
  }

  /**
   * Evaluates whether a Tier 2 radio subtitle should be emitted (deduplicating rapid identical calls).
   */
  public shouldEmitRadioSubtitle(key: string, nowSec: number, minIntervalSec = 8): boolean {
    if (key === this.lastRadioSubtitleKey && nowSec - this.lastRadioSubtitleTimeSec < minIntervalSec) {
      return false;
    }
    this.lastRadioSubtitleKey = key;
    this.lastRadioSubtitleTimeSec = nowSec;
    return true;
  }

  /**
   * Evaluates current combat and objective context to produce the highest-priority Tier 1 HUD hint,
   * or null if suppressed, dismissed, or no hint is needed.
   */
  public evaluateTier1Hint(ctx: TacticalEvaluationContext): ActiveTacticalHint | null {
    // Hard suppression during downed state or nuclear detonation sequence
    if (ctx.isPlayerDowned || ctx.isNukeActive) {
      this.activeHint = null;
      return null;
    }

    const isTouch = ctx.controlScheme === 'touch';

    // 1. CRITICAL SURVIVAL HINTS (Always evaluated unless downed/nuke; bypass low-priority suppression)
    if (ctx.healthPct > 0 && ctx.healthPct <= 0.28) {
      return this.activateCandidate(
        {
          id: 'critical_find_cover',
          tier: 1,
          priority: 'critical',
          text: 'CRITICAL TRAUMA — BREAK LINE OF SIGHT & SEEK HARD COVER',
          actionKey: isTouch ? 'COVER' : 'C / SPRINT',
          dismissible: false,
        },
        ctx.nowSec,
        2.5,
        0, // immediate re-trigger while critical
      );
    }

    if (ctx.magazineAmmo === 0 && ctx.reserveAmmo > 0 && !ctx.isReloading && !ctx.isInsideVehicle) {
      return this.activateCandidate(
        {
          id: 'critical_reload_now',
          tier: 1,
          priority: 'critical',
          text: isTouch ? 'MAGAZINE DEPLETED — TAP [RELOAD]' : 'MAGAZINE DEPLETED — PRESS [R] TO RELOAD',
          actionKey: isTouch ? 'RELOAD' : 'R',
          dismissible: false,
        },
        ctx.nowSec,
        2.0,
        0,
      );
    }

    // If user disabled Tactical Hints in Settings, suppress all non-critical tactical/onboarding hints
    if (!ctx.tacticalHintsEnabled) {
      this.activeHint = null;
      return null;
    }

    // 2. IMMEDIATE CONTEXTUAL OBJECTIVE / INTERACTION HINTS (Tier 1 Tactical)
    if (ctx.isNearDemolitionCache && !ctx.isInsideVehicle) {
      return this.activateCandidate(
        {
          id: 'tactical_plant_charge_near',
          tier: 1,
          priority: 'tactical',
          text: isTouch
            ? 'DEMOLITION ZONE — TAP [INTERACT] OR PLACE [C4] TO DESTROY CACHE'
            : 'DEMOLITION ZONE — PRESS [E] TO PLANT CHARGE OR DETONATE PLACED [5] C4',
          actionKey: isTouch ? 'INTERACT / C4' : 'E / 5',
          dismissible: true,
        },
        ctx.nowSec,
        3.0,
        1.5,
      );
    }

    if (ctx.isPlayerNearExtraction && ctx.extractionStatus === 'locked' && ctx.extractionBlockReason) {
      return this.activateCandidate(
        {
          id: 'tactical_extraction_locked',
          tier: 1,
          priority: 'tactical',
          text: `EXTRACTION LOCKED — ${ctx.extractionBlockReason.toUpperCase()}`,
          actionKey: 'OBJECTIVE',
          dismissible: true,
        },
        ctx.nowSec,
        4.0,
        2.0,
      );
    }

    if (ctx.isNearSabotageTarget && !ctx.isInsideVehicle) {
      return this.activateCandidate(
        {
          id: 'tactical_sabotage_near',
          tier: 1,
          priority: 'tactical',
          text: isTouch
            ? 'TARGET IN RANGE — TAP [INTERACT] TO SABOTAGE OR USE EXPLOSIVES'
            : 'TARGET IN RANGE — PRESS [E] TO SABOTAGE OR ENGAGE WITH ORDNANCE',
          actionKey: isTouch ? 'INTERACT' : 'E',
          dismissible: true,
        },
        ctx.nowSec,
        3.0,
        4.0,
      );
    }

    // Suppress lower-priority onboarding hints during intense combat
    if (ctx.isIntenseCombat) {
      if (this.activeHint && this.activeHint.priority === 'onboarding') {
        this.activeHint = null;
      }
      if (this.activeHint && ctx.nowSec < this.activeHintExpiresAtSec) {
        return this.activeHint;
      }
      this.activeHint = null;
      return null;
    }

    // 3. ADAPTIVE ONBOARDING & MECHANIC HINTS (Cooldown-gated, dismissible, auto-clearing)
    if (ctx.hasActiveAirObjective && !ctx.hasEquippedStingerOrRpg && !ctx.isInsideVehicle) {
      const candidate = this.tryOnboardingCandidate(
        {
          id: 'onboarding_air_lock',
          tier: 1,
          priority: 'onboarding',
          text: isTouch
            ? 'AIR THREAT ACTIVE — TAP [STINGER] OR [RPG] & HOLD [ADS] TO LOCK ON'
            : 'AIR THREAT ACTIVE — EQUIP [8] FIM-92X STINGER & HOLD RMB TO LOCK ON',
          actionKey: isTouch ? 'STINGER' : '8',
          dismissible: true,
        },
        ctx.nowSec,
        6.0,
        24.0,
        3,
      );
      if (candidate) return candidate;
    }

    if (ctx.isPlantChargeStageActive && ctx.hasC4Available && !ctx.isNearDemolitionCache && !ctx.isInsideVehicle) {
      const candidate = this.tryOnboardingCandidate(
        {
          id: 'onboarding_demolition_stage',
          tier: 1,
          priority: 'onboarding',
          text: isTouch
            ? 'DEMOLITION STAGE — APPROACH CACHE FOR [INTERACT] CHARGE OR PLACE [C4] WITHIN 6.5M'
            : 'DEMOLITION STAGE — APPROACH CACHE FOR [E] CHARGE OR PLACE [5] C4 WITHIN 6.5M',
          actionKey: isTouch ? 'C4 / E' : 'E / 5',
          dismissible: true,
        },
        ctx.nowSec,
        6.5,
        32.0,
        2,
      );
      if (candidate) return candidate;
    }

    if (ctx.isNearVehicle && !ctx.isInsideVehicle) {
      const candidate = this.tryOnboardingCandidate(
        {
          id: 'onboarding_vehicle_board',
          tier: 1,
          priority: 'onboarding',
          text: isTouch
            ? 'ARMORED VEHICLE READY — TAP [BOARD] TO PILOTING & CANNON CONTROLS'
            : 'ARMORED VEHICLE READY — PRESS [E] TO BOARD & [F] FOR COAXIAL MG',
          actionKey: isTouch ? 'BOARD' : 'E',
          dismissible: true,
        },
        ctx.nowSec,
        5.0,
        28.0,
        2,
      );
      if (candidate) return candidate;
    }

    // Keep current hint alive if it hasn't expired and its condition wasn't invalidated
    if (this.activeHint && ctx.nowSec < this.activeHintExpiresAtSec) {
      if (
        (this.activeHint.id === 'critical_find_cover' && ctx.healthPct > 0.35) ||
        (this.activeHint.id === 'critical_reload_now' && (ctx.magazineAmmo > 0 || ctx.isReloading)) ||
        (this.activeHint.id === 'tactical_plant_charge_near' && !ctx.isNearDemolitionCache) ||
        (this.activeHint.id === 'tactical_extraction_locked' && (!ctx.isPlayerNearExtraction || ctx.extractionStatus !== 'locked')) ||
        (this.activeHint.id === 'onboarding_air_lock' && ctx.hasEquippedStingerOrRpg)
      ) {
        this.activeHint = null;
        return null;
      }
      return this.activeHint;
    }

    this.activeHint = null;
    return null;
  }

  private activateCandidate(
    hint: ActiveTacticalHint,
    nowSec: number,
    durationSec: number,
    minCooldownSec: number,
  ): ActiveTacticalHint | null {
    if (hint.dismissible && missionSelectionStore.getState().isTacticalHintDismissed(hint.id)) {
      return null;
    }
    const record = this.cooldowns.get(hint.id);
    if (record && minCooldownSec > 0 && nowSec - record.lastShownSec < minCooldownSec) {
      if (this.activeHint?.id === hint.id && nowSec < this.activeHintExpiresAtSec) {
        return this.activeHint;
      }
      return null;
    }
    this.cooldowns.set(hint.id, {
      lastShownSec: nowSec,
      timesShown: (record?.timesShown ?? 0) + 1,
    });
    this.activeHint = hint;
    this.activeHintExpiresAtSec = nowSec + durationSec;
    return this.activeHint;
  }

  private tryOnboardingCandidate(
    hint: ActiveTacticalHint,
    nowSec: number,
    durationSec: number,
    cooldownSec: number,
    maxTimesPerSession: number,
  ): ActiveTacticalHint | null {
    if (missionSelectionStore.getState().isTacticalHintDismissed(hint.id)) {
      return null;
    }
    if (this.activeHint?.id === hint.id && nowSec < this.activeHintExpiresAtSec) {
      return this.activeHint;
    }
    const record = this.cooldowns.get(hint.id);
    if (record) {
      if (record.timesShown >= maxTimesPerSession) return null;
      if (nowSec - record.lastShownSec < cooldownSec) return null;
    }
    this.cooldowns.set(hint.id, {
      lastShownSec: nowSec,
      timesShown: (record?.timesShown ?? 0) + 1,
    });
    this.activeHint = hint;
    this.activeHintExpiresAtSec = nowSec + durationSec;
    return this.activeHint;
  }
}
