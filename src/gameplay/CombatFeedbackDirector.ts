import * as THREE from 'three';
import { AudioManager, SoundId } from '@/src/audio/AudioManager';
import { HitKind } from '@/src/schemas/events.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';

/**
 * Per-weapon grounded tactical recoil & camera-feel signature.
 * Gives each of the 9 weapons a distinct mechanical identity (first-shot snap,
 * vertical climb bias, horizontal sway pattern, spring stiffness/damping, and caliber punch).
 */
export interface WeaponRecoilSignature {
  readonly firstShotMultiplier: number;
  readonly verticalClimbBias: number;
  readonly horizontalDriftBias: number;
  readonly springStiffness: number;
  readonly springDamping: number;
  readonly adsStiffnessBonus: number;
  readonly rollKickRad: number;
  readonly fovPunchDeg: number;
  readonly hitImpulseWeight: number;
}

export const WEAPON_RECOIL_SIGNATURES: Readonly<Record<WeaponId, WeaponRecoilSignature>> = Object.freeze({
  assault_rifle: {
    firstShotMultiplier: 1.22,
    verticalClimbBias: 1.0,
    horizontalDriftBias: 0.16,
    springStiffness: 175,
    springDamping: 22,
    adsStiffnessBonus: 45,
    rollKickRad: 0.008,
    fovPunchDeg: 0.55,
    hitImpulseWeight: 1.0,
  },
  smg: {
    firstShotMultiplier: 1.08,
    verticalClimbBias: 0.82,
    horizontalDriftBias: -0.05,
    springStiffness: 220,
    springDamping: 26,
    adsStiffnessBonus: 40,
    rollKickRad: 0.006,
    fovPunchDeg: 0.35,
    hitImpulseWeight: 0.72,
  },
  sniper_rifle: {
    firstShotMultiplier: 1.35,
    verticalClimbBias: 1.25,
    horizontalDriftBias: 0.08,
    springStiffness: 105,
    springDamping: 16,
    adsStiffnessBonus: 28,
    rollKickRad: 0.019,
    fovPunchDeg: 1.75,
    hitImpulseWeight: 1.85,
  },
  shotgun: {
    firstShotMultiplier: 1.28,
    verticalClimbBias: 1.18,
    horizontalDriftBias: 0.12,
    springStiffness: 130,
    springDamping: 18,
    adsStiffnessBonus: 25,
    rollKickRad: 0.022,
    fovPunchDeg: 1.45,
    hitImpulseWeight: 1.95,
  },
  lmg: {
    firstShotMultiplier: 1.15,
    verticalClimbBias: 1.06,
    horizontalDriftBias: 0.22,
    springStiffness: 145,
    springDamping: 20,
    adsStiffnessBonus: 65,
    rollKickRad: 0.012,
    fovPunchDeg: 0.72,
    hitImpulseWeight: 1.22,
  },
  pistol: {
    firstShotMultiplier: 1.1,
    verticalClimbBias: 0.92,
    horizontalDriftBias: 0.04,
    springStiffness: 255,
    springDamping: 29,
    adsStiffnessBonus: 35,
    rollKickRad: 0.005,
    fovPunchDeg: 0.3,
    hitImpulseWeight: 0.78,
  },
  rocket_launcher: {
    firstShotMultiplier: 1.3,
    verticalClimbBias: 1.35,
    horizontalDriftBias: 0.0,
    springStiffness: 88,
    springDamping: 15,
    adsStiffnessBonus: 18,
    rollKickRad: 0.026,
    fovPunchDeg: 2.1,
    hitImpulseWeight: 2.4,
  },
  guided_missile: {
    firstShotMultiplier: 1.2,
    verticalClimbBias: 1.2,
    horizontalDriftBias: 0.0,
    springStiffness: 96,
    springDamping: 16,
    adsStiffnessBonus: 20,
    rollKickRad: 0.02,
    fovPunchDeg: 1.65,
    hitImpulseWeight: 2.4,
  },
  grenade_launcher: {
    firstShotMultiplier: 1.18,
    verticalClimbBias: 1.15,
    horizontalDriftBias: 0.06,
    springStiffness: 122,
    springDamping: 18,
    adsStiffnessBonus: 24,
    rollKickRad: 0.016,
    fovPunchDeg: 1.15,
    hitImpulseWeight: 1.8,
  },
});

const HIT_PRIORITY: Readonly<Record<HitKind, number>> = Object.freeze({
  flesh: 1,
  armor_deflect: 2,
  armor_break: 3,
  headshot: 4,
  kill: 5,
});

export interface ImpactFeedbackEvent {
  readonly hitKind: HitKind;
  readonly isHeadshot: boolean;
  readonly isKill: boolean;
  readonly armorBroken: boolean;
  readonly damage: number;
}

/**
 * Coordinates grounded tactical combat feedback without cluttering GameEngine:
 * - Coalesces multi-pellet hits (e.g. 8-pellet shotgun blast in a single frame) into one
 *   prioritized hit audio cue & HUD pulse so the 32-voice audio pool never clips.
 * - Differentiates flesh, armor deflection, armor shatter, headshot, and kill-confirm cues.
 * - Triggers directional supersonic bullet-crack audio on near-misses with cooldown gating.
 * - Scales camera-motion intensity cleanly against independent accessibility & gameplay settings.
 */
export class CombatFeedbackDirector {
  private pendingHit: ImpactFeedbackEvent | null = null;
  private accumulatedDamage = 0;
  private lastBulletCrackMs = -1000;

  constructor(private readonly audio: AudioManager) {}

  /**
   * Computes effective camera-motion multiplier respecting independent Gameplay & Accessibility settings.
   */
  public getCameraMotionScale(): number {
    const state = settingsStore.getState();
    const base = state.gameplay.cameraShakeIntensity;
    const reduced = state.accessibility.reducedMotion ? 0.35 : 1.0;
    const shakeRed = state.accessibility.screenShakeReduction ? 0.5 : 1.0;
    return Math.max(0, Math.min(1.2, base * reduced * shakeRed));
  }

  public queueImpactFeedback(ev: ImpactFeedbackEvent): void {
    this.accumulatedDamage += Math.max(0, ev.damage);
    if (!this.pendingHit) {
      this.pendingHit = ev;
      return;
    }
    const curPrio = HIT_PRIORITY[this.pendingHit.hitKind];
    const nextPrio = HIT_PRIORITY[ev.hitKind];
    this.pendingHit = {
      hitKind: nextPrio >= curPrio ? ev.hitKind : this.pendingHit.hitKind,
      isHeadshot: this.pendingHit.isHeadshot || ev.isHeadshot,
      isKill: this.pendingHit.isKill || ev.isKill,
      armorBroken: this.pendingHit.armorBroken || ev.armorBroken,
      damage: this.accumulatedDamage,
    };
  }

  /**
   * Flushes coalesced hit audio & HUD feedback once per fixed combat step.
   */
  public flushFrameFeedback(): ImpactFeedbackEvent | null {
    const ev = this.pendingHit;
    if (!ev) return null;
    const totalDmg = Math.round(this.accumulatedDamage);
    this.pendingHit = null;
    this.accumulatedDamage = 0;

    gameSessionStore
      .getState()
      .triggerHit(ev.isHeadshot, ev.isKill, totalDmg, ev.hitKind);

    const primarySound = this.selectSoundForHit(ev);
    this.audio.play2D(primarySound, ev.isKill ? 9 : 8, ev.isKill ? 0.64 : 0.56, 0.03);

    // Layer crisp kill-confirm thump when a headshot or armor break also finishes the target
    if (ev.isKill && primarySound !== 'kill_confirm') {
      this.audio.play2D('kill_confirm', 9, 0.58, 0.02);
    } else if (ev.armorBroken && primarySound !== 'armor_break') {
      this.audio.play2D('armor_break', 8, 0.56, 0.03);
    }

    return { ...ev, damage: totalDmg };
  }

  private selectSoundForHit(ev: ImpactFeedbackEvent): SoundId {
    if (ev.isHeadshot) return 'headshot';
    if (ev.armorBroken || ev.hitKind === 'armor_break') return 'armor_break';
    if (ev.isKill) return 'kill_confirm';
    if (ev.hitKind === 'armor_deflect') return 'armor_hit';
    return 'hit_marker';
  }

  /**
   * Plays a directional supersonic bullet snap-whiz when hostile rounds pass near the player's head.
   */
  public notifyNearMissPass(
    passPoint: THREE.Vector3,
    intensity: number,
    nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
  ): boolean {
    if (nowMs - this.lastBulletCrackMs < 110) return false;
    this.lastBulletCrackMs = nowMs;
    const vol = Math.max(0.32, Math.min(0.82, 0.42 + intensity * 0.4));
    this.audio.playSpatial('bullet_crack', passPoint.x, passPoint.y, passPoint.z, 8, vol);
    return true;
  }

  public reset(): void {
    this.pendingHit = null;
    this.accumulatedDamage = 0;
    this.lastBulletCrackMs = -1000;
  }
}
