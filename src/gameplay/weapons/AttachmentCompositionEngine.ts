import { ATTACHMENT_BY_ID, AttachmentFlyweight, getAttachmentsForWeaponCategory } from '@/src/data/attachments';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { AttachmentSlot, EquippedWeaponAttachments } from '@/src/schemas/campaign.schema';
import { WeaponUpgradeState } from '@/src/schemas/save.schema';
import { WeaponConfig, WeaponId } from '@/src/schemas/weapon.schema';

export interface ResolvedWeaponProfile extends WeaponConfig {
  readonly soundRadiusMeters: number;
  readonly isSuppressed: boolean;
  readonly appliedAttachmentIds: readonly string[];
  readonly tradeOffSummary: {
    pros: string[];
    cons: string[];
  };
}

export interface BuildValidationReport {
  weaponId: WeaponId;
  valid: boolean;
  incompatibleIds: string[];
  strictlyDominatesBase: boolean;
  violatedClamps: string[];
  roleEnvelopeIntact: boolean;
  resolved: ResolvedWeaponProfile;
}

export const DEFAULT_EQUIPPED_ATTACHMENTS: Readonly<EquippedWeaponAttachments> = Object.freeze({
  optic: null,
  muzzle: null,
  barrel: null,
  underbarrel: null,
  magazine: null,
});

const BASE_SOUND_RADIUS_BY_CATEGORY: Readonly<Record<WeaponConfig['category'], number>> = Object.freeze({
  rifle: 44,
  smg: 36,
  sniper: 62,
  shotgun: 48,
  lmg: 54,
  sidearm: 30,
  launcher: 72,
});

const ROLE_RANGE_CEILING: Readonly<Record<WeaponConfig['category'], number>> = Object.freeze({
  rifle: 265,
  smg: 145, // SMG can never out-range rifles/snipers
  sniper: 490,
  shotgun: 74, // Shotgun can never become a mid-range rifle
  lmg: 295,
  sidearm: 128,
  launcher: 520,
});

const ROLE_MOBILITY_CEILING: Readonly<Record<WeaponConfig['category'], number>> = Object.freeze({
  rifle: 1.04,
  smg: 1.12,
  sniper: 0.94,
  shotgun: 1.03,
  lmg: 0.91, // LMG can never exceed rifle/SMG sprint mobility
  sidearm: 1.14,
  launcher: 0.9,
});

/**
 * Applies diminishing returns when stacking multiple multipliers in the same direction
 * so combining 3+ recoil or speed attachments cannot collapse recoil/reload to broken values.
 */
function combineWithDiminishingReturns(multipliers: readonly number[], minFloor: number, maxCeil: number): number {
  let raw = 1.0;
  for (let i = 0; i < multipliers.length; i++) {
    raw *= multipliers[i];
  }
  // Compress deviations past +/-25% using soft hyperbolic curve
  const delta = raw - 1.0;
  const softened =
    Math.abs(delta) <= 0.25
      ? raw
      : 1.0 + Math.sign(delta) * (0.25 + (Math.abs(delta) - 0.25) * 0.62);
  return Math.max(minFloor, Math.min(maxCeil, softened));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Pure multi-stage deterministic weapon stat-composition pipeline (TRN-40):
 * 1. Base Weapon Flyweight
 * 2. Existing Stage 1–6 Weapon Upgrades (damage, recoil, capacity, reload)
 * 3. Slot-compatible Attachment Trade-Off Modifiers with diminishing returns
 * 4. Physical safety clamps & weapon-role envelope ceilings
 */
export function resolveWeaponConfig(
  base: WeaponConfig,
  upgrades?: Partial<WeaponUpgradeState>,
  equipped?: Partial<EquippedWeaponAttachments>
): ResolvedWeaponProfile {
  const dmgLv = upgrades?.damage ?? 0;
  const recLv = upgrades?.recoil ?? 0;
  const capLv = upgrades?.capacity ?? 0;
  const relLv = upgrades?.reload ?? 0;

  // Stage 2: Base + existing progression upgrade levels
  let damage = base.damage * (1 + dmgLv * 0.08);
  let recoilPitch = base.recoilPitch * (1 - recLv * 0.07);
  let recoilYaw = base.recoilYaw * (1 - recLv * 0.07);
  let magazineSize = Math.max(1, Math.round(base.magazineSize * (1 + capLv * 0.12)));
  let reloadTimeSec = base.reloadTimeSec * (1 - relLv * 0.07);

  let rangeMeters = base.rangeMeters;
  let muzzleVelocity = base.muzzleVelocity;
  let spreadHipRad = base.spreadHipRad;
  let spreadAdsRad = base.spreadAdsRad;
  let equipTimeSec = base.equipTimeSec;
  let sprintToFireSec = base.sprintToFireSec;
  let adsFov = base.adsFov;
  let mobilityFactor = base.mobilityFactor;
  let armorPenetration = base.armorPenetration;
  let hasOpticalScope = base.hasOpticalScope;
  let soundRadiusMeters = BASE_SOUND_RADIUS_BY_CATEGORY[base.category];

  // Collect valid slot-matched attachments
  const slots: AttachmentSlot[] = ['optic', 'muzzle', 'barrel', 'underbarrel', 'magazine'];
  const applied: AttachmentFlyweight[] = [];

  if (equipped) {
    for (const slot of slots) {
      const id = equipped[slot];
      if (!id) continue;
      const att = ATTACHMENT_BY_ID[id];
      if (!att) continue;
      if (att.slot !== slot) continue;
      if (!att.compatibleCategories.includes(base.category)) continue;
      applied.push(att);
    }
  }

  // Stage 3: Combine attachment modifiers with diminishing-return guards
  const dmgMults: number[] = [];
  const rangeMults: number[] = [];
  const velMults: number[] = [];
  const recPitchMults: number[] = [];
  const recYawMults: number[] = [];
  const hipMults: number[] = [];
  const adsSpreadMults: number[] = [];
  const equipMults: number[] = [];
  const stfMults: number[] = [];
  const reloadMults: number[] = [];
  const magMults: number[] = [];
  const soundMults: number[] = [];

  let mobilityDeltaTotal = 0;
  let armorPenDeltaTotal = 0;
  let adsFovDeltaTotal = 0;

  for (const att of applied) {
    const m = att.modifiers;
    if (m.damageMult !== undefined) dmgMults.push(m.damageMult);
    if (m.rangeMult !== undefined) rangeMults.push(m.rangeMult);
    if (m.muzzleVelocityMult !== undefined) velMults.push(m.muzzleVelocityMult);
    if (m.recoilPitchMult !== undefined) recPitchMults.push(m.recoilPitchMult);
    if (m.recoilYawMult !== undefined) recYawMults.push(m.recoilYawMult);
    if (m.spreadHipMult !== undefined) hipMults.push(m.spreadHipMult);
    if (m.spreadAdsMult !== undefined) adsSpreadMults.push(m.spreadAdsMult);
    if (m.equipTimeMult !== undefined) equipMults.push(m.equipTimeMult);
    if (m.sprintToFireMult !== undefined) stfMults.push(m.sprintToFireMult);
    if (m.reloadTimeMult !== undefined) reloadMults.push(m.reloadTimeMult);
    if (m.magazineSizeMult !== undefined) magMults.push(m.magazineSizeMult);
    if (m.soundRadiusMult !== undefined) soundMults.push(m.soundRadiusMult);
    if (m.mobilityDelta !== undefined) mobilityDeltaTotal += m.mobilityDelta;
    if (m.armorPenDelta !== undefined) armorPenDeltaTotal += m.armorPenDelta;
    if (m.adsFovDelta !== undefined) adsFovDeltaTotal += m.adsFovDelta;
    if (m.grantsOpticalScope) hasOpticalScope = true;
  }

  damage *= combineWithDiminishingReturns(dmgMults, 0.78, 1.2);
  rangeMeters *= combineWithDiminishingReturns(rangeMults, 0.65, 1.38);
  muzzleVelocity *= combineWithDiminishingReturns(velMults, 0.7, 1.32);
  recoilPitch *= combineWithDiminishingReturns(recPitchMults, 0.56, 1.55);
  recoilYaw *= combineWithDiminishingReturns(recYawMults, 0.56, 1.55);
  spreadHipRad *= combineWithDiminishingReturns(hipMults, 0.62, 1.45);
  spreadAdsRad *= combineWithDiminishingReturns(adsSpreadMults, 0.55, 1.45);
  equipTimeSec *= combineWithDiminishingReturns(equipMults, 0.7, 1.5);
  sprintToFireSec *= combineWithDiminishingReturns(stfMults, 0.7, 1.55);
  reloadTimeSec *= combineWithDiminishingReturns(reloadMults, 0.68, 1.5);
  magazineSize = Math.max(
    1,
    Math.round(magazineSize * combineWithDiminishingReturns(magMults, 0.72, 1.45))
  );
  soundRadiusMeters *= combineWithDiminishingReturns(soundMults, 0.42, 1.5);
  mobilityFactor += clamp(mobilityDeltaTotal, -0.14, 0.11);
  armorPenetration += armorPenDeltaTotal;
  adsFov += adsFovDeltaTotal;

  // Stage 4: Hard physical safety clamps & role-envelope ceilings
  damage = Number(clamp(damage, 5, 480).toFixed(2));
  rangeMeters = Number(clamp(rangeMeters, 24, ROLE_RANGE_CEILING[base.category]).toFixed(2));
  muzzleVelocity = Number(clamp(muzzleVelocity, 24, 820).toFixed(2));
  recoilPitch = Number(clamp(recoilPitch, base.recoilPitch * 0.48, 0.14).toFixed(5));
  recoilYaw = Number(clamp(recoilYaw, base.recoilYaw * 0.48, 0.06).toFixed(5));
  spreadHipRad = Number(clamp(spreadHipRad, 0.008, 0.14).toFixed(5));
  spreadAdsRad = Number(clamp(spreadAdsRad, 0.00025, 0.08).toFixed(5));
  equipTimeSec = Number(clamp(equipTimeSec, 0.12, 1.25).toFixed(3));
  sprintToFireSec = Number(clamp(sprintToFireSec, 0.06, 0.65).toFixed(3));
  reloadTimeSec = Number(clamp(reloadTimeSec, 0.75, 5.8).toFixed(3));
  mobilityFactor = Number(clamp(mobilityFactor, 0.65, ROLE_MOBILITY_CEILING[base.category]).toFixed(3));
  armorPenetration = Number(clamp(armorPenetration, 0.1, 1.0).toFixed(3));
  adsFov = Number(clamp(adsFov, 14, 72).toFixed(1));
  soundRadiusMeters = Number(clamp(soundRadiusMeters, 12, 110).toFixed(1));

  const isSuppressed = applied.some((a) => a.id === 'muzzle_tactical_suppressor');

  // Explainable delta summary compared against base+upgrade (without attachments)
  const pros: string[] = [];
  const cons: string[] = [];
  for (const att of applied) {
    pros.push(`${att.shortName}: ${att.prosSummary}`);
    cons.push(`${att.shortName}: ${att.consSummary}`);
  }

  return {
    ...base,
    damage,
    rangeMeters,
    muzzleVelocity,
    recoilPitch,
    recoilYaw,
    spreadHipRad,
    spreadAdsRad,
    equipTimeSec,
    sprintToFireSec,
    reloadTimeSec,
    magazineSize,
    mobilityFactor,
    armorPenetration,
    adsFov,
    hasOpticalScope,
    soundRadiusMeters,
    isSuppressed,
    appliedAttachmentIds: applied.map((a) => a.id),
    tradeOffSummary: { pros, cons },
  };
}

/**
 * Validates a full weapon attachment configuration against the base weapon for:
 * - Slot/category compatibility
 * - NaN/out-of-bounds clamp violations
 * - Strict Pareto dominance (a non-empty build must never strictly improve without any trade-off)
 * - Weapon-role envelope preservation
 */
export function validateWeaponBuild(
  base: WeaponConfig,
  equipped: Partial<EquippedWeaponAttachments>
): BuildValidationReport {
  const incompatibleIds: string[] = [];
  const slots: AttachmentSlot[] = ['optic', 'muzzle', 'barrel', 'underbarrel', 'magazine'];
  for (const slot of slots) {
    const id = equipped[slot];
    if (!id) continue;
    const att = ATTACHMENT_BY_ID[id];
    if (!att || att.slot !== slot || !att.compatibleCategories.includes(base.category)) {
      incompatibleIds.push(id);
    }
  }

  const baseline = resolveWeaponConfig(base, undefined, DEFAULT_EQUIPPED_ATTACHMENTS);
  const resolved = resolveWeaponConfig(base, undefined, equipped);

  const violatedClamps: string[] = [];
  const numericChecks: Array<[string, number]> = [
    ['damage', resolved.damage],
    ['rangeMeters', resolved.rangeMeters],
    ['muzzleVelocity', resolved.muzzleVelocity],
    ['recoilPitch', resolved.recoilPitch],
    ['recoilYaw', resolved.recoilYaw],
    ['spreadHipRad', resolved.spreadHipRad],
    ['spreadAdsRad', resolved.spreadAdsRad],
    ['equipTimeSec', resolved.equipTimeSec],
    ['sprintToFireSec', resolved.sprintToFireSec],
    ['reloadTimeSec', resolved.reloadTimeSec],
    ['magazineSize', resolved.magazineSize],
    ['mobilityFactor', resolved.mobilityFactor],
    ['soundRadiusMeters', resolved.soundRadiusMeters],
  ];
  for (const [k, val] of numericChecks) {
    if (!Number.isFinite(val) || val <= 0) {
      violatedClamps.push(`${k}=${val}`);
    }
  }

  // Evaluate Pareto trade-offs across all 11 performance axes (positive = better than baseline)
  const eps = 1e-4;
  const deltas = [
    resolved.damage - baseline.damage,
    resolved.rangeMeters - baseline.rangeMeters,
    resolved.muzzleVelocity - baseline.muzzleVelocity,
    baseline.recoilPitch - resolved.recoilPitch,
    baseline.recoilYaw - resolved.recoilYaw,
    baseline.spreadAdsRad - resolved.spreadAdsRad,
    baseline.spreadHipRad - resolved.spreadHipRad,
    baseline.equipTimeSec - resolved.equipTimeSec,
    baseline.sprintToFireSec - resolved.sprintToFireSec,
    baseline.reloadTimeSec - resolved.reloadTimeSec,
    resolved.magazineSize - baseline.magazineSize,
    resolved.mobilityFactor - baseline.mobilityFactor,
    baseline.soundRadiusMeters - resolved.soundRadiusMeters,
    resolved.armorPenetration - baseline.armorPenetration,
  ];

  const hasAnyGain = deltas.some((d) => d > eps);
  const hasAnyTradeOff = deltas.some((d) => d < -eps);
  const strictlyDominatesBase =
    resolved.appliedAttachmentIds.length > 0 && hasAnyGain && !hasAnyTradeOff;

  const roleEnvelopeIntact =
    resolved.rangeMeters <= ROLE_RANGE_CEILING[base.category] + eps &&
    resolved.mobilityFactor <= ROLE_MOBILITY_CEILING[base.category] + eps;

  const valid =
    incompatibleIds.length === 0 &&
    violatedClamps.length === 0 &&
    !strictlyDominatesBase &&
    roleEnvelopeIntact;

  return {
    weaponId: base.id,
    valid,
    incompatibleIds,
    strictlyDominatesBase,
    violatedClamps,
    roleEnvelopeIntact,
    resolved,
  };
}

/**
 * Exhaustive combination auditor across all 9 weapons × all valid attachment permutations.
 * Used directly by our TRN-40 / TRN-42 adversarial test suite to prove zero Pareto-dominant exploits exist.
 */
export function auditAllWeaponAttachmentCombinations(): {
  totalConfigurationsChecked: number;
  failures: BuildValidationReport[];
} {
  const failures: BuildValidationReport[] = [];
  let totalConfigurationsChecked = 0;

  for (const weapon of WEAPON_CATALOG) {
    const optics = [null, ...getAttachmentsForWeaponCategory(weapon.category, 'optic').map((a) => a.id)];
    const muzzles = [null, ...getAttachmentsForWeaponCategory(weapon.category, 'muzzle').map((a) => a.id)];
    const barrels = [null, ...getAttachmentsForWeaponCategory(weapon.category, 'barrel').map((a) => a.id)];
    const underbarrels = [
      null,
      ...getAttachmentsForWeaponCategory(weapon.category, 'underbarrel').map((a) => a.id),
    ];
    const mags = [null, ...getAttachmentsForWeaponCategory(weapon.category, 'magazine').map((a) => a.id)];

    for (const optic of optics) {
      for (const muzzle of muzzles) {
        for (const barrel of barrels) {
          for (const underbarrel of underbarrels) {
            for (const magazine of mags) {
              totalConfigurationsChecked++;
              const report = validateWeaponBuild(weapon, {
                optic,
                muzzle,
                barrel,
                underbarrel,
                magazine,
              });
              if (!report.valid) {
                failures.push(report);
              }
            }
          }
        }
      }
    }
  }

  return { totalConfigurationsChecked, failures };
}
