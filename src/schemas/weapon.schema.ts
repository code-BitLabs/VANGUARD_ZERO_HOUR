import { z } from 'zod';

export const WeaponIdSchema = z.enum([
  'assault_rifle',
  'smg',
  'sniper_rifle',
  'shotgun',
  'lmg',
  'pistol',
  'rocket_launcher',
  'guided_missile',
  'grenade_launcher',
]);
export type WeaponId = z.infer<typeof WeaponIdSchema>;

export const FireModeSchema = z.enum(['auto', 'burst', 'semi', 'lockon']);
export type FireMode = z.infer<typeof FireModeSchema>;

export const ProjectileTypeSchema = z.enum(['hitscan', 'rocket', 'guided_missile', 'grenade_shell']);
export type ProjectileType = z.infer<typeof ProjectileTypeSchema>;

export const WeaponUpgradeKeySchema = z.enum(['damage', 'recoil', 'capacity', 'reload']);
export type WeaponUpgradeKey = z.infer<typeof WeaponUpgradeKeySchema>;

export const WeaponSchema = z.object({
  id: WeaponIdSchema,
  slot: z.number().int().min(1).max(9),
  name: z.string().min(1),
  shortName: z.string().min(1),
  category: z.enum(['rifle', 'smg', 'sniper', 'shotgun', 'lmg', 'sidearm', 'launcher']),
  description: z.string(),
  damage: z.number().positive(),
  headshotMultiplier: z.number().min(1).default(2.0),
  armorPenetration: z.number().min(0).max(1).default(0.35),
  fireRateRpm: z.number().positive(),
  magazineSize: z.number().int().positive(),
  reserveAmmo: z.number().int().nonnegative(),
  reloadTimeSec: z.number().positive(),
  equipTimeSec: z.number().positive(),
  sprintToFireSec: z.number().nonnegative().default(0.16),
  rangeMeters: z.number().positive(),
  pelletCount: z.number().int().positive().default(1),
  projectileType: ProjectileTypeSchema,
  muzzleVelocity: z.number().positive().default(120),
  blastRadius: z.number().nonnegative().default(0),
  spreadHipRad: z.number().nonnegative(),
  spreadAdsRad: z.number().nonnegative(),
  recoilPitch: z.number().nonnegative(),
  recoilYaw: z.number().nonnegative(),
  recoilRecovery: z.number().positive(),
  adsFov: z.number().min(14).max(75),
  hasOpticalScope: z.boolean().default(false),
  fireModes: z.array(FireModeSchema).min(1),
  mobilityFactor: z.number().min(0.5).max(1.1).default(1.0),
});
export type WeaponConfig = z.infer<typeof WeaponSchema>;
