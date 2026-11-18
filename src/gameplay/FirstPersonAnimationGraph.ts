import * as THREE from 'three';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { HandGripPoseId } from './OperatorArmRig';

export type AnimationGraphStateId =
  | 'IDLE'
  | 'LOCOMOTION'
  | 'SPRINT'
  | 'ADS'
  | 'RELOAD'
  | 'WEAPON_SWITCH'
  | 'VAULT'
  | 'LANDING'
  | 'EQUIPMENT'
  | 'DEATH';

export type AnimationInterruptionReason =
  | 'sprint_started'
  | 'weapon_switched'
  | 'weapon_switch_cancels_reload'
  | 'vault_started'
  | 'vehicle_entered'
  | 'player_downed'
  | 'reload_cancelled'
  | 'ads_entered'
  | 'ads_interrupts_sprint';

export interface InterruptionSemanticRecord {
  interruptedState: AnimationGraphStateId;
  reason: AnimationInterruptionReason;
  reloadStageAtInterrupt: 'READY' | 'MAG_OUT' | 'MAG_IN' | 'CHAMBER';
  timestampSec: number;
  magazineReturnedToRest: boolean;
  handsReturnedToGripSockets: boolean;
  boltReturnedToBattery: boolean;
}

export interface PerOpticSightConfig {
  weaponId: WeaponId;
  opticType: 'red_dot_reflex' | 'holographic_eotech' | 'iron_aperture' | 'sniper_6x_scope' | 'launcher_ladder';
  /** Local optical axis offset relative to weapon root [x, y, z] */
  sightAxisOffset: readonly [number, number, number];
  /** Distance from camera lens to optic ocular housing in ADS (meters) */
  eyeReliefMeters: number;
  /** Target world camera FOV when fully aligned in ADS */
  adsWorldFovDeg: number;
  /** Target viewmodel camera FOV in ADS */
  adsViewModelFovDeg: number;
  /** Visual recoil dampening factor while aiming down sights [0..1] */
  adsVisualRecoilMultiplier: number;
}

export const PER_WEAPON_OPTIC_CONFIGS: Record<WeaponId, PerOpticSightConfig> = {
  assault_rifle: {
    weaponId: 'assault_rifle',
    opticType: 'red_dot_reflex',
    sightAxisOffset: [0, -0.072, -0.35],
    eyeReliefMeters: 0.19,
    adsWorldFovDeg: 58,
    adsViewModelFovDeg: 50,
    adsVisualRecoilMultiplier: 0.52,
  },
  smg: {
    weaponId: 'smg',
    opticType: 'holographic_eotech',
    sightAxisOffset: [0, -0.068, -0.31],
    eyeReliefMeters: 0.17,
    adsWorldFovDeg: 64,
    adsViewModelFovDeg: 52,
    adsVisualRecoilMultiplier: 0.55,
  },
  shotgun: {
    weaponId: 'shotgun',
    opticType: 'iron_aperture',
    sightAxisOffset: [0, -0.064, -0.34],
    eyeReliefMeters: 0.21,
    adsWorldFovDeg: 66,
    adsViewModelFovDeg: 54,
    adsVisualRecoilMultiplier: 0.62,
  },
  sniper_rifle: {
    weaponId: 'sniper_rifle',
    opticType: 'sniper_6x_scope',
    sightAxisOffset: [0, -0.068, -0.3],
    eyeReliefMeters: 0.14,
    adsWorldFovDeg: 18,
    adsViewModelFovDeg: 44,
    adsVisualRecoilMultiplier: 0.45,
  },
  lmg: {
    weaponId: 'lmg',
    opticType: 'holographic_eotech',
    sightAxisOffset: [0, -0.078, -0.35],
    eyeReliefMeters: 0.21,
    adsWorldFovDeg: 60,
    adsViewModelFovDeg: 50,
    adsVisualRecoilMultiplier: 0.56,
  },
  pistol: {
    weaponId: 'pistol',
    opticType: 'iron_aperture',
    sightAxisOffset: [0, -0.056, -0.25],
    eyeReliefMeters: 0.25,
    adsWorldFovDeg: 68,
    adsViewModelFovDeg: 54,
    adsVisualRecoilMultiplier: 0.58,
  },
  grenade_launcher: {
    weaponId: 'grenade_launcher',
    opticType: 'launcher_ladder',
    sightAxisOffset: [0, -0.075, -0.33],
    eyeReliefMeters: 0.2,
    adsWorldFovDeg: 62,
    adsViewModelFovDeg: 52,
    adsVisualRecoilMultiplier: 0.6,
  },
  rocket_launcher: {
    weaponId: 'rocket_launcher',
    opticType: 'launcher_ladder',
    sightAxisOffset: [0.02, -0.072, -0.28],
    eyeReliefMeters: 0.18,
    adsWorldFovDeg: 56,
    adsViewModelFovDeg: 48,
    adsVisualRecoilMultiplier: 0.65,
  },
  guided_missile: {
    weaponId: 'guided_missile',
    opticType: 'sniper_6x_scope',
    sightAxisOffset: [0.02, -0.07, -0.27],
    eyeReliefMeters: 0.16,
    adsWorldFovDeg: 42,
    adsViewModelFovDeg: 46,
    adsVisualRecoilMultiplier: 0.5,
  },
};

export interface AnimationGraphEvaluationInput {
  dt: number;
  weaponId: WeaponId;
  alive: boolean;
  inVehicle: boolean;
  grounded: boolean;
  currentSpeed: number;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  isVaulting: boolean;
  isAds: boolean;
  isReloading: boolean;
  reloadStage: 'READY' | 'MAG_OUT' | 'MAG_IN' | 'CHAMBER';
  reloadProgress: number;
  equipProgress01: number;
  landingSpringOffset: number;
  rightGripLocal: THREE.Vector3;
  leftForegripLocal: THREE.Vector3;
  magazineSocketLocal: THREE.Vector3;
  chargingHandleSocketLocal: THREE.Vector3;
}

export interface AnimationGraphPoseOutput {
  activeState: AnimationGraphStateId;
  leftHandTargetLocal: THREE.Vector3;
  leftHandPose: HandGripPoseId;
  triggerPull01: number;
  opticSightConfig: PerOpticSightConfig;
  magazineAttachedToWeapon: boolean;
  boltReturnNormalized: boolean;
}

/**
 * TRN-19 Sections 4.3, 4.4 & Final Engineering Amendment Section 5:
 * State-Driven, Frame-Rate-Independent First-Person Animation Graph.
 *
 * Strictly separated from authoritative weapon mechanics (`WeaponSystem` & `BallisticSolver`):
 * - Never consumes ammo, completes reloads, spawns projectiles, or alters authoritative camera aim.
 * - Evaluates deterministic state transitions and clean interruption semantics (`handleInterruption`)
 *   so sprint-cancel, weapon switch, vault, vehicle entry, or death mid-reload never leaves
 *   hands or magazines in invalid poses.
 */
export class FirstPersonAnimationGraph {
  private currentState: AnimationGraphStateId = 'IDLE';
  private previousReloading = false;
  private previousWeaponId: WeaponId = 'assault_rifle';
  private lastReloadStage: 'READY' | 'MAG_OUT' | 'MAG_IN' | 'CHAMBER' = 'READY';
  private elapsedSec = 0;
  private triggerPulse = 0;
  private interruptionRecoverBlend = 0;
  private readonly _leftHandTarget = new THREE.Vector3();
  private readonly interruptionHistory: InterruptionSemanticRecord[] = [];

  getCurrentState(): AnimationGraphStateId {
    return this.currentState;
  }

  getInterruptionHistory(): ReadonlyArray<InterruptionSemanticRecord> {
    return this.interruptionHistory;
  }

  notifyShotFired(_recoilMul = 1.0): void {
    this.triggerPulse = 1.0;
  }

  /**
   * Explicitly records and executes deterministic interruption recovery.
   */
  handleInterruption(
    reason: AnimationInterruptionReason,
    reloadStageAtInterrupt: 'READY' | 'MAG_OUT' | 'MAG_IN' | 'CHAMBER' = this.lastReloadStage
  ): InterruptionSemanticRecord {
    const rec: InterruptionSemanticRecord = {
      interruptedState: this.currentState,
      reason,
      reloadStageAtInterrupt,
      timestampSec: Number(this.elapsedSec.toFixed(3)),
      magazineReturnedToRest: true,
      handsReturnedToGripSockets: true,
      boltReturnedToBattery: true,
    };
    this.interruptionHistory.push(rec);
    if (this.interruptionHistory.length > 32) {
      this.interruptionHistory.shift();
    }
    this.interruptionRecoverBlend = 1.0;
    this.previousReloading = false;
    this.lastReloadStage = 'READY';

    if (reason === 'player_downed') {
      this.currentState = 'DEATH';
    } else if (reason === 'weapon_switched' || reason === 'weapon_switch_cancels_reload') {
      this.currentState = 'WEAPON_SWITCH';
    } else if (reason === 'vault_started') {
      this.currentState = 'VAULT';
    } else if (reason === 'sprint_started') {
      this.currentState = 'SPRINT';
    } else if (reason === 'ads_entered' || reason === 'ads_interrupts_sprint') {
      this.currentState = 'ADS';
    } else {
      this.currentState = 'IDLE';
    }

    return rec;
  }

  evaluate(input: AnimationGraphEvaluationInput): AnimationGraphPoseOutput {
    const dt = Math.max(0, Math.min(0.1, input.dt));
    this.elapsedSec += dt;
    this.triggerPulse = Math.max(0, this.triggerPulse - dt * 9.5);
    this.interruptionRecoverBlend = Math.max(0, this.interruptionRecoverBlend - dt * 8.5);

    // 1. Detect interruption of an active reload or ADS state
    if (this.previousReloading && !input.isReloading && input.reloadProgress < 0.98) {
      let reason: AnimationInterruptionReason = 'reload_cancelled';
      if (!input.alive) reason = 'player_downed';
      else if (input.inVehicle) reason = 'vehicle_entered';
      else if (input.weaponId !== this.previousWeaponId) reason = 'weapon_switched';
      else if (input.isVaulting) reason = 'vault_started';
      else if (input.isSprinting) reason = 'sprint_started';
      this.handleInterruption(reason, this.lastReloadStage);
    } else if (input.weaponId !== this.previousWeaponId) {
      this.handleInterruption('weapon_switched', this.lastReloadStage);
    }

    this.previousWeaponId = input.weaponId;
    this.previousReloading = input.isReloading;
    if (input.isReloading) {
      this.lastReloadStage = input.reloadStage;
    } else {
      this.lastReloadStage = 'READY';
    }

    // 2. Resolve authoritative graph state
    if (!input.alive) {
      this.currentState = 'DEATH';
    } else if (input.isVaulting) {
      this.currentState = 'VAULT';
    } else if (input.equipProgress01 > 0.05) {
      this.currentState = 'WEAPON_SWITCH';
    } else if (input.isReloading) {
      this.currentState = 'RELOAD';
    } else if (input.isAds) {
      this.currentState = 'ADS';
    } else if (input.isSprinting) {
      this.currentState = 'SPRINT';
    } else if (Math.abs(input.landingSpringOffset) > 0.08) {
      this.currentState = 'LANDING';
    } else if (input.grounded && input.currentSpeed > 0.65) {
      this.currentState = 'LOCOMOTION';
    } else {
      this.currentState = 'IDLE';
    }

    // 3. Evaluate Left-Hand IK Target & Finger Pose across Reload Timeline vs Standard Hold
    this._leftHandTarget.copy(input.leftForegripLocal);
    let leftHandPose: HandGripPoseId =
      input.weaponId === 'assault_rifle' ||
      input.weaponId === 'smg' ||
      input.weaponId === 'grenade_launcher'
        ? 'vertical_grip_wrap'
        : 'foregrip_cradle';

    if (input.isReloading && input.alive && !input.inVehicle && !input.isVaulting) {
      if (input.reloadStage === 'MAG_OUT' || input.reloadStage === 'MAG_IN') {
        const phaseBlend =
          input.reloadStage === 'MAG_OUT'
            ? Math.min(1, input.reloadProgress / 0.25)
            : Math.min(1, (0.78 - input.reloadProgress) / 0.18);
        this._leftHandTarget.lerpVectors(
          input.leftForegripLocal,
          input.magazineSocketLocal,
          THREE.MathUtils.clamp(phaseBlend, 0, 1)
        );
        leftHandPose = 'mag_pinch_grab';
      } else if (input.reloadStage === 'CHAMBER') {
        const u = Math.max(0, Math.min(1, (input.reloadProgress - 0.78) / 0.22));
        const bell = Math.sin(u * Math.PI);
        this._leftHandTarget.lerpVectors(
          input.leftForegripLocal,
          input.chargingHandleSocketLocal,
          bell
        );
        leftHandPose = bell > 0.25 ? 'charging_bolt_hook' : leftHandPose;
      }
    }

    const opticSightConfig = PER_WEAPON_OPTIC_CONFIGS[input.weaponId] ?? PER_WEAPON_OPTIC_CONFIGS.assault_rifle;

    return {
      activeState: this.currentState,
      leftHandTargetLocal: this._leftHandTarget,
      leftHandPose,
      triggerPull01: this.triggerPulse,
      opticSightConfig,
      magazineAttachedToWeapon: !input.isReloading || input.reloadStage === 'CHAMBER',
      boltReturnNormalized: !input.isReloading,
    };
  }
}
