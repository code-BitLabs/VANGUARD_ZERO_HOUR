import { z } from 'zod';
import { DEFAULT_ROLE_LOADOUT_PRESETS } from '@/src/data/attachments';
import { createDefaultCoreRoster } from '@/src/data/squadRoster';
import { synthesizeLegacyCampaignLedger } from '@/src/gameplay/campaign/CampaignEventLedger';
import {
  CampaignLedgerSchema,
  EquippedWeaponAttachmentsSchema,
  MissionLoadoutConfigSchema,
  NamedLoadoutPresetSchema,
  OperatorCustomizationSchema,
  SquadOperatorRecordSchema,
} from './campaign.schema';
import { DifficultySchema, GradeSchema } from './common.schema';
import { WeaponIdSchema, WeaponUpgradeKeySchema } from './weapon.schema';

export const WeaponUpgradeStateSchema = z.record(WeaponUpgradeKeySchema, z.number().int().min(0).max(5));
export type WeaponUpgradeState = z.infer<typeof WeaponUpgradeStateSchema>;

export const ReplayModifierIdSchema = z.enum([
  'scarce_supply',
  'precision_doctrine',
  'high_lethality',
  'iron_operator',
]);

export const MissionRecordSchema = z.object({
  missionId: z.number().int().min(1).max(5),
  completed: z.boolean().default(false),
  bestScore: z.number().int().nonnegative().default(0),
  bestGrade: GradeSchema.optional(),
  fastestTimeSec: z.number().positive().optional(),
  bestHeadshots: z.number().int().nonnegative().default(0),
  bestAccuracyPct: z.number().int().min(0).max(100).default(0),
  optionalObjectivesCompleted: z.number().int().nonnegative().default(0),
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
  schemaRevision: z.number().int().min(2).default(4),
  xp: z.number().int().nonnegative().default(0),
  requisitionPoints: z.number().int().nonnegative().default(500),
  totalKills: z.number().int().nonnegative().default(0),
  totalHeadshots: z.number().int().nonnegative().default(0),
  missionRecords: z.record(z.string(), MissionRecordSchema).default({}),
  weaponUpgrades: z.record(z.string(), WeaponUpgradeStateSchema).default({}),
  weaponMasteryKills: z.record(z.string(), z.number().int().nonnegative()).default({}),
  completedChallenges: z.array(z.string()).default([]),
  activeModifiers: z.array(ReplayModifierIdSchema).default([]),
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
  // Stage 7 persistent campaign & squad state (schemaRevision >= 4)
  campaignLedger: CampaignLedgerSchema.default({
    nextSequence: 1,
    events: [],
    timelineRevision: 1,
    shiftedDownstreamMissions: [],
  }),
  squadRoster: z.array(SquadOperatorRecordSchema).default(() => createDefaultCoreRoster()),
  activeMissionLoadout: MissionLoadoutConfigSchema.default({
    primaryWeapon: 'assault_rifle',
    secondaryWeapon: 'pistol',
    heavyWeapon: 'rocket_launcher',
    tacticalEquipment: 'frag_pack',
    squadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
  }),
  loadoutPresets: z
    .array(NamedLoadoutPresetSchema)
    .default(() => DEFAULT_ROLE_LOADOUT_PRESETS.map((p) => ({ ...p, config: { ...p.config, squadIds: [...p.config.squadIds] } }))),
  unlockedAttachments: z.array(z.string()).default([]),
  weaponAttachments: z.record(z.string(), EquippedWeaponAttachmentsSchema).default({}),
  unlockedCosmetics: z
    .array(z.string())
    .default(['camo:obsidian_ops', 'helmet:standard_ops', 'patch:task_force_zero']),
  playerCustomization: OperatorCustomizationSchema.default({
    camoId: 'obsidian_ops',
    helmetId: 'standard_ops',
    patchId: 'task_force_zero',
  }),
  ironmanSquadEnabled: z.boolean().default(false),
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
  accuracyPct: z.number().int().min(0).max(100).default(0),
  optionalCompleted: z.number().int().nonnegative().default(0),
  activeModifiers: z.array(ReplayModifierIdSchema).default([]),
  timestamp: z.number().int().nonnegative(),
});
export type CombatLogEntry = z.infer<typeof CombatLogEntrySchema>;

export const DEFAULT_PROGRESSION_SAVE: ProgressionSave = ProgressionSaveSchema.parse({});

function extractCompletedMissionIds(records: Record<string, MissionRecord>): number[] {
  return Object.values(records)
    .filter((r) => r.completed)
    .map((r) => r.missionId)
    .sort((a, b) => a - b);
}

function backfillStage7Fields(save: ProgressionSave): ProgressionSave {
  const completedIds = extractCompletedMissionIds(save.missionRecords);
  const needsLegacyLedger =
    save.campaignLedger.events.length === 0 && completedIds.length > 0;
  const roster =
    save.squadRoster && save.squadRoster.length >= 5
      ? save.squadRoster
      : createDefaultCoreRoster();
  const presets =
    save.loadoutPresets && save.loadoutPresets.length > 0
      ? save.loadoutPresets
      : DEFAULT_ROLE_LOADOUT_PRESETS.map((p) => ({
          ...p,
          config: { ...p.config, squadIds: [...p.config.squadIds] },
        }));

  return {
    ...save,
    schemaRevision: Math.max(4, save.schemaRevision ?? 4),
    campaignLedger: needsLegacyLedger
      ? synthesizeLegacyCampaignLedger(completedIds)
      : save.campaignLedger,
    squadRoster: roster,
    loadoutPresets: presets,
  };
}

export function migrateProgressionSave(raw: unknown): {
  save: ProgressionSave;
  recoveredFromCorruption: boolean;
  migratedFromV1: boolean;
} {
  const v2 = ProgressionSaveSchema.safeParse(raw);
  if (v2.success) {
    return {
      save: backfillStage7Fields(v2.data),
      recoveredFromCorruption: false,
      migratedFromV1: false,
    };
  }

  const v1 = ProgressionSaveV1Schema.safeParse(raw);
  if (v1.success) {
    const completedIds = extractCompletedMissionIds(v1.data.missionRecords);
    const migrated = ProgressionSaveSchema.parse({
      ...DEFAULT_PROGRESSION_SAVE,
      version: 2,
      schemaRevision: 4,
      xp: v1.data.xp,
      requisitionPoints: v1.data.requisitionPoints,
      missionRecords: v1.data.missionRecords,
      weaponUpgrades: v1.data.weaponUpgrades,
      achievements: v1.data.achievements,
      campaignLedger: synthesizeLegacyCampaignLedger(completedIds),
      squadRoster: createDefaultCoreRoster(),
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
