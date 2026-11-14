import { z } from 'zod';
import { DifficultySchema, GradeSchema } from './common.schema';
import { WeaponIdSchema, WeaponUpgradeKeySchema } from './weapon.schema';

export const WeaponUpgradeStateSchema = z.record(WeaponUpgradeKeySchema, z.number().int().min(0).max(5));
export type WeaponUpgradeState = z.infer<typeof WeaponUpgradeStateSchema>;

export const MissionRecordSchema = z.object({
  missionId: z.number().int().min(1).max(5),
  completed: z.boolean().default(false),
  bestScore: z.number().int().nonnegative().default(0),
  bestGrade: GradeSchema.optional(),
  fastestTimeSec: z.number().positive().optional(),
  bestHeadshots: z.number().int().nonnegative().default(0),
  highestDifficulty: DifficultySchema.optional(),
});
export type MissionRecord = z.infer<typeof MissionRecordSchema>;

export const ProgressionSaveV1Schema = z.object({
  version: z.literal(1),
  xp: z.number().int().nonnegative().default(0),
  requisitionPoints: z.number().int().nonnegative().default(500),
  missionRecords: z.record(z.string(), MissionRecordSchema).default({}),
  weaponUpgrades: z.record(z.string(), WeaponUpgradeStateSchema).default({}),
  achievements: z.array(z.string()).default([]),
});

export const ProgressionSaveSchema = z.object({
  version: z.literal(2).default(2),
  xp: z.number().int().nonnegative().default(0),
  requisitionPoints: z.number().int().nonnegative().default(500),
  totalKills: z.number().int().nonnegative().default(0),
  totalHeadshots: z.number().int().nonnegative().default(0),
  missionRecords: z.record(z.string(), MissionRecordSchema).default({}),
  weaponUpgrades: z.record(z.string(), WeaponUpgradeStateSchema).default({}),
  achievements: z.array(z.string()).default([]),
  selectedLoadout: z.array(WeaponIdSchema).min(1).default([
    'assault_rifle',
    'smg',
    'sniper_rifle',
    'shotgun',
    'lmg',
    'pistol',
    'rocket_launcher',
    'guided_missile',
    'grenade_launcher',
  ]),
  updatedAt: z.number().int().nonnegative().default(() => Date.now()),
});
export type ProgressionSave = z.infer<typeof ProgressionSaveSchema>;

export const CombatLogEntrySchema = z.object({
  id: z.string(),
  missionId: z.number().int().min(1).max(5),
  difficulty: DifficultySchema,
  victory: z.boolean(),
  score: z.number().int().nonnegative(),
  grade: GradeSchema,
  kills: z.number().int().nonnegative(),
  headshots: z.number().int().nonnegative(),
  durationSec: z.number().nonnegative(),
  timestamp: z.number().int().nonnegative(),
});
export type CombatLogEntry = z.infer<typeof CombatLogEntrySchema>;

export const DEFAULT_PROGRESSION_SAVE: ProgressionSave = ProgressionSaveSchema.parse({});

export function migrateProgressionSave(raw: unknown): {
  save: ProgressionSave;
  recoveredFromCorruption: boolean;
  migratedFromV1: boolean;
} {
  const v2 = ProgressionSaveSchema.safeParse(raw);
  if (v2.success) {
    return { save: v2.data, recoveredFromCorruption: false, migratedFromV1: false };
  }

  const v1 = ProgressionSaveV1Schema.safeParse(raw);
  if (v1.success) {
    const migrated = ProgressionSaveSchema.parse({
      ...DEFAULT_PROGRESSION_SAVE,
      version: 2,
      xp: v1.data.xp,
      requisitionPoints: v1.data.requisitionPoints,
      missionRecords: v1.data.missionRecords,
      weaponUpgrades: v1.data.weaponUpgrades,
      achievements: v1.data.achievements,
      updatedAt: Date.now(),
    });
    return { save: migrated, recoveredFromCorruption: false, migratedFromV1: true };
  }

  return {
    save: ProgressionSaveSchema.parse({}),
    recoveredFromCorruption: raw !== null && raw !== undefined,
    migratedFromV1: false,
  };
}
