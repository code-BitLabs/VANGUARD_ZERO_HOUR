import { z } from 'zod';
import { WeaponIdSchema } from './weapon.schema';

export const ReplayModeSchema = z.enum(['canonical', 'campaign_replay', 'clean_replay']);
export type ReplayMode = z.infer<typeof ReplayModeSchema>;

export const CampaignEventCategorySchema = z.enum(['canonical', 'staged_replay', 'score_only']);
export type CampaignEventCategory = z.infer<typeof CampaignEventCategorySchema>;

export const CampaignEventIdSchema = z.enum([
  'op1_comms_destroyed',
  'op1_intel_secured',
  'op1_rooftop_snipers_cleared',
  'op2_convoy_neutralized',
  'op2_fuel_cache_secured',
  'op2_bunker_intel_captured',
  'op3_radar_network_disabled',
  'op3_searchlights_blacked_out',
  'op3_drone_relay_hacked',
  'op4_river_watchtowers_cleared',
  'op4_jungle_cache_secured',
  'op4_comms_jammer_planted',
  'op5_fortress_breached',
  'op5_command_core_neutralized',
  'squad_operator_mia',
  'squad_operator_rescued',
  'squad_operator_kia_ironman',
  'squad_clean_sweep',
]);
export type CampaignEventId = z.infer<typeof CampaignEventIdSchema>;

export const CampaignEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  eventId: CampaignEventIdSchema,
  missionId: z.number().int().min(1).max(5),
  category: CampaignEventCategorySchema.default('canonical'),
  schemaVersion: z.number().int().min(1).default(1),
  outcome: z.enum(['achieved', 'failed', 'bypassed']).default('achieved'),
  operatorId: z.string().optional(),
  summary: z.string().min(1),
  payloadHash: z.string().min(1),
  synthesizedFromLegacySave: z.boolean().optional(),
  supersededBySequence: z.number().int().nonnegative().optional(),
});
export type CampaignEvent = z.infer<typeof CampaignEventSchema>;

export const CampaignLedgerSchema = z.object({
  nextSequence: z.number().int().nonnegative().default(1),
  events: z.array(CampaignEventSchema).default([]),
  timelineRevision: z.number().int().nonnegative().default(1),
  shiftedDownstreamMissions: z.array(z.number().int().min(1).max(5)).default([]),
});
export type CampaignLedger = z.infer<typeof CampaignLedgerSchema>;

export const SquadRoleIdSchema = z.enum(['assault', 'support', 'recon', 'anti_armor', 'medic']);
export type SquadRoleId = z.infer<typeof SquadRoleIdSchema>;

export const OperatorStatusSchema = z.enum(['active', 'recovering', 'kia']);
export type OperatorStatus = z.infer<typeof OperatorStatusSchema>;

export const OperatorSpecializationIdSchema = z.enum([
  'breach_specialist',
  'suppressive_anchor',
  'armor_spotter',
  'ordnance_expert',
  'combat_triage',
]);
export type OperatorSpecializationId = z.infer<typeof OperatorSpecializationIdSchema>;

export const OperatorCamoIdSchema = z.enum([
  'obsidian_ops',
  'desert_sandstorm',
  'nightfall_slate',
  'viper_canopy',
  'vanguard_carbon',
]);
export type OperatorCamoId = z.infer<typeof OperatorCamoIdSchema>;

export const OperatorHelmetIdSchema = z.enum([
  'standard_ops',
  'ballistic_visor',
  'recon_nvg',
  'heavy_breacher',
]);
export type OperatorHelmetId = z.infer<typeof OperatorHelmetIdSchema>;

export const OperatorPatchIdSchema = z.enum([
  'task_force_zero',
  'iron_dawn_crest',
  'desert_spear',
  'night_owl',
  'apex_commander',
]);
export type OperatorPatchId = z.infer<typeof OperatorPatchIdSchema>;

export const OperatorCustomizationSchema = z.object({
  camoId: OperatorCamoIdSchema.default('obsidian_ops'),
  helmetId: OperatorHelmetIdSchema.default('standard_ops'),
  patchId: OperatorPatchIdSchema.default('task_force_zero'),
});
export type OperatorCustomization = z.infer<typeof OperatorCustomizationSchema>;

export const SquadOperatorRecordSchema = z.object({
  id: z.string().min(1),
  callsign: z.string().min(1),
  role: SquadRoleIdSchema,
  status: OperatorStatusSchema.default('active'),
  recoveryOpsRemaining: z.number().int().min(0).max(4).default(0),
  injurySeverity: z.enum(['none', 'light', 'severe']).default('none'),
  missionsDeployed: z.number().int().nonnegative().default(0),
  missionsSurvived: z.number().int().nonnegative().default(0),
  kills: z.number().int().nonnegative().default(0),
  revivesPerformed: z.number().int().nonnegative().default(0),
  vehiclesDisabled: z.number().int().nonnegative().default(0),
  spotsMarked: z.number().int().nonnegative().default(0),
  suppressionAssists: z.number().int().nonnegative().default(0),
  timesDowned: z.number().int().nonnegative().default(0),
  timesMia: z.number().int().nonnegative().default(0),
  xp: z.number().int().nonnegative().default(0),
  unlockedSpecializations: z.array(OperatorSpecializationIdSchema).default([]),
  customization: OperatorCustomizationSchema.default({
    camoId: 'obsidian_ops',
    helmetId: 'standard_ops',
    patchId: 'task_force_zero',
  }),
});
export type SquadOperatorRecord = z.infer<typeof SquadOperatorRecordSchema>;

export const TacticalEquipmentIdSchema = z.enum([
  'frag_pack',
  'c4_breach_kit',
  'field_trauma_kit',
  'smoke_conceal_kit',
]);
export type TacticalEquipmentId = z.infer<typeof TacticalEquipmentIdSchema>;

export const MissionLoadoutConfigSchema = z.object({
  primaryWeapon: WeaponIdSchema.default('assault_rifle'),
  secondaryWeapon: WeaponIdSchema.default('pistol'),
  heavyWeapon: WeaponIdSchema.default('rocket_launcher'),
  tacticalEquipment: TacticalEquipmentIdSchema.default('frag_pack'),
  squadIds: z.array(z.string()).min(1).max(3).default(['vanguard_2', 'bulwark_3', 'lifeline_6']),
});
export type MissionLoadoutConfig = z.infer<typeof MissionLoadoutConfigSchema>;

export const NamedLoadoutPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(32),
  roleTag: z.enum(['assault', 'engineer', 'anti_armor', 'recon', 'custom']).default('custom'),
  isBuiltIn: z.boolean().default(false),
  config: MissionLoadoutConfigSchema,
});
export type NamedLoadoutPreset = z.infer<typeof NamedLoadoutPresetSchema>;

export const AttachmentSlotSchema = z.enum(['optic', 'muzzle', 'barrel', 'underbarrel', 'magazine']);
export type AttachmentSlot = z.infer<typeof AttachmentSlotSchema>;

export const EquippedWeaponAttachmentsSchema = z.object({
  optic: z.string().nullable().default(null),
  muzzle: z.string().nullable().default(null),
  barrel: z.string().nullable().default(null),
  underbarrel: z.string().nullable().default(null),
  magazine: z.string().nullable().default(null),
});
export type EquippedWeaponAttachments = z.infer<typeof EquippedWeaponAttachmentsSchema>;
