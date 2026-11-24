import { WeaponConfig } from '@/src/schemas/weapon.schema';

export interface CategoryFalloffProfile {
  /** Fraction of max rangeMeters before attenuation begins */
  readonly effectiveRangeFraction: number;
  /** Minimum damage multiplier reached at max rangeMeters */
  readonly minDamageMultiplier: number;
}

export const CATEGORY_FALLOFF_PROFILES: Readonly<
  Record<WeaponConfig['category'], CategoryFalloffProfile>
> = Object.freeze({
  shotgun: {
    effectiveRangeFraction: 0.28,
    minDamageMultiplier: 0.22,
  },
  smg: {
    effectiveRangeFraction: 0.38,
    minDamageMultiplier: 0.42,
  },
  sidearm: {
    effectiveRangeFraction: 0.35,
    minDamageMultiplier: 0.45,
  },
  rifle: {
    effectiveRangeFraction: 0.55,
    minDamageMultiplier: 0.62,
  },
  lmg: {
    effectiveRangeFraction: 0.6,
    minDamageMultiplier: 0.68,
  },
  sniper: {
    effectiveRangeFraction: 0.78,
    minDamageMultiplier: 0.85,
  },
  launcher: {
    effectiveRangeFraction: 1.0,
    minDamageMultiplier: 1.0,
  },
});

/**
 * Computes deterministic distance attenuation for ballistic weapons.
 * Close-range engagements inside the effective range retain 1.0x damage,
 * smoothly attenuating down to the category floor at `maxRangeMeters`.
 */
export function computeRangeFalloffMultiplier(
  category: WeaponConfig['category'],
  distanceMeters: number,
  maxRangeMeters: number
): number {
  const safeMax = Math.max(1, maxRangeMeters);
  const clampedDist = Math.max(0, Math.min(safeMax, distanceMeters));
  const profile = CATEGORY_FALLOFF_PROFILES[category];
  const effectiveRange = safeMax * profile.effectiveRangeFraction;

  if (clampedDist <= effectiveRange || profile.effectiveRangeFraction >= 0.999) {
    return 1.0;
  }

  const falloffSpan = Math.max(0.001, safeMax - effectiveRange);
  const t = Math.min(1, (clampedDist - effectiveRange) / falloffSpan);
  return 1.0 + (profile.minDamageMultiplier - 1.0) * t;
}
