import { z } from 'zod';
import { FireModeSchema, WeaponIdSchema } from './weapon.schema';

export const KillFeedItemSchema = z.object({
  id: z.string(),
  killer: z.string(),
  victim: z.string(),
  weaponName: z.string(),
  isHeadshot: z.boolean(),
  timestamp: z.number(),
});
export type KillFeedItem = z.infer<typeof KillFeedItemSchema>;

export const HitFeedbackSchema = z.object({
  id: z.number().int().nonnegative(),
  isHeadshot: z.boolean(),
  isKill: z.boolean(),
  damage: z.number().nonnegative(),
});
export type HitFeedback = z.infer<typeof HitFeedbackSchema>;

export const ObjectiveStatusSchema = z.object({
  id: z.string(),
  title: z.string(),
  current: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  completed: z.boolean(),
});
export type ObjectiveStatus = z.infer<typeof ObjectiveStatusSchema>;

export const MiniMapBlipSchema = z.object({
  id: z.string(),
  x: z.number(),
  z: z.number(),
  kind: z.enum(['enemy', 'air', 'vehicle', 'objective', 'friendly_vehicle']),
});
export type MiniMapBlip = z.infer<typeof MiniMapBlipSchema>;

export const DamageArcSchema = z.object({
  id: z.number().int().nonnegative(),
  angleRad: z.number(),
  intensity: z.number().min(0).max(1),
});
export type DamageArc = z.infer<typeof DamageArcSchema>;

export const LockOnStateSchema = z.object({
  status: z.enum(['none', 'scanning', 'acquiring', 'locked']),
  progress: z.number().min(0).max(1),
  targetLabel: z.string(),
});
export type LockOnState = z.infer<typeof LockOnStateSchema>;

export const TacticalOrdnanceHudSchema = z.object({
  c4Inventory: z.number().int().nonnegative(),
  c4Deployed: z.number().int().nonnegative(),
  c4MaxDeployed: z.number().int().positive(),
  c4PlacementValid: z.boolean(),
  selectedBombId: z.string(),
  selectedBombShort: z.string(),
  selectedBombCost: z.number().int().nonnegative(),
  bombCooldownSec: z.number().nonnegative(),
  bombMaxCooldownSec: z.number().nonnegative(),
  nukeCost: z.number().int().nonnegative(),
  nukeUsed: z.boolean(),
  nukePendingConfirmSec: z.number().nonnegative(),
  nukeCountdownSec: z.number().nonnegative(),
  inFalloutZone: z.boolean(),
  falloutRemainingSec: z.number().nonnegative(),
  requisitionPoints: z.number().int().nonnegative(),
  sandboxAuthorized: z.boolean(),
});
export type TacticalOrdnanceHud = z.infer<typeof TacticalOrdnanceHudSchema>;

export const HudSnapshotSchema = z.object({
  health: z.number().min(0).max(100),
  maxHealth: z.number().positive(),
  armor: z.number().min(0).max(100),
  maxArmor: z.number().positive(),
  weaponId: WeaponIdSchema,
  weaponName: z.string(),
  fireMode: FireModeSchema,
  ammoInMag: z.number().int().nonnegative(),
  magSize: z.number().int().positive(),
  reserveAmmo: z.number().int().nonnegative(),
  grenades: z.number().int().nonnegative(),
  isReloading: z.boolean(),
  reloadProgress: z.number().min(0).max(1),
  isAds: z.boolean(),
  isScoped: z.boolean(),
  isSprinting: z.boolean(),
  isCrouching: z.boolean(),
  isSliding: z.boolean(),
  crosshairSpread: z.number().nonnegative(),
  playerX: z.number(),
  playerZ: z.number(),
  playerYaw: z.number(),
  inVehicle: z.boolean(),
  vehicleName: z.string(),
  vehicleHealth: z.number().min(0).max(100),
  vehicleMaxHealth: z.number().positive(),
  vehicleSpeedKmh: z.number().nonnegative(),
  interactPrompt: z.string().nullable(),
  subtitleText: z.string().nullable(),
  missionAlert: z.string().nullable(),
  elapsedSec: z.number().nonnegative(),
  score: z.number().int().nonnegative(),
  kills: z.number().int().nonnegative(),
  headshots: z.number().int().nonnegative(),
  shotsFired: z.number().int().nonnegative(),
  shotsHit: z.number().int().nonnegative(),
  lockOn: LockOnStateSchema,
  objectives: z.array(ObjectiveStatusSchema),
  blips: z.array(MiniMapBlipSchema),
  activeBossLabel: z.string().nullable(),
  activeBossHealthPct: z.number().min(0).max(1),
  ordnance: TacticalOrdnanceHudSchema.optional(),
});
export type HudSnapshot = z.infer<typeof HudSnapshotSchema>;
