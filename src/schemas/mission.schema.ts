import { z } from 'zod';
import { LightingTimeSchema, MapIdSchema, Vec3Schema } from './common.schema';
import { EnemyArchetypeSchema } from './enemy.schema';

export const ObjectiveTypeSchema = z.enum([
  'eliminate_wave',
  'destroy_targets',
  'convoy_intercept',
  'air_defense',
  'plant_charge',
  'vehicle_extract',
]);
export type ObjectiveType = z.infer<typeof ObjectiveTypeSchema>;

export const AirUnitTypeSchema = z.enum(['helicopter', 'attack_drone', 'fighter_jet', 'transport', 'gunship']);
export type AirUnitType = z.infer<typeof AirUnitTypeSchema>;

export const ObjectiveActionKindSchema = z.enum([
  'eliminate_infantry',
  'engage_infantry',
  'destroy_vehicle',
  'destroy_convoy',
  'destroy_aircraft',
  'lock_and_destroy_aircraft',
  'sabotage_target',
  'sabotage_or_shoot',
  'plant_charge',
  'plant_charge_or_destroy',
  'reach_extraction',
]);
export type ObjectiveActionKind = z.infer<typeof ObjectiveActionKindSchema>;

export const ObjectiveActionMetadataSchema = z.object({
  actionKind: ObjectiveActionKindSchema,
  targetLabel: z.string(),
  recommendedSlot: z.number().int().min(1).max(9).optional(),
  requiresInteractKey: z.boolean().default(false),
  prerequisiteHint: z.string().optional(),
});
export type ObjectiveActionMetadata = z.infer<typeof ObjectiveActionMetadataSchema>;

export const ObjectiveSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  type: ObjectiveTypeSchema,
  targetCount: z.number().int().positive(),
  markerPos: Vec3Schema,
  targetAirUnitTypes: z.array(AirUnitTypeSchema).optional(),
  isOptional: z.boolean().default(false),
  actionMeta: ObjectiveActionMetadataSchema.optional(),
});
export type MissionObjectiveConfig = z.infer<typeof ObjectiveSchema>;

export const WaveSpawnSchema = z.object({
  archetype: EnemyArchetypeSchema,
  count: z.number().int().positive(),
  spawnArea: Vec3Schema,
  radius: z.number().positive().default(14),
});

export const AirSpawnSchema = z.object({
  type: AirUnitTypeSchema,
  count: z.number().int().positive(),
  altitude: z.number().positive(),
  orbitRadius: z.number().positive().default(55),
});

export const VehicleTypeSchema = z.enum(['military_jeep', 'armored_truck', 'enemy_technical', 'enemy_apc']);
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const VehicleSpawnSchema = z.object({
  type: VehicleTypeSchema,
  position: Vec3Schema,
  yaw: z.number().default(0),
  hostile: z.boolean().default(false),
  isConvoyTarget: z.boolean().default(false),
});

export const MissionSchema = z.object({
  id: z.number().int().min(1).max(5),
  missionKey: z.string().default('mission_1'),
  briefingVersion: z.string().default('v1.2'),
  codeName: z.string(),
  title: z.string(),
  subtitle: z.string(),
  mapId: MapIdSchema,
  mapName: z.string(),
  lighting: LightingTimeSchema,
  briefing: z.string(),
  locationDetail: z.string().optional(),
  threatSummary: z.array(z.string()).default([]),
  requiredActionsSummary: z.array(z.string()).default([]),
  extractionConditions: z.string().optional(),
  recommendedLoadout: z.array(z.string()).min(1),
  playerSpawn: Vec3Schema,
  playerYaw: z.number().default(0),
  parTimeSec: z.number().positive(),
  baseXpReward: z.number().int().positive(),
  objectives: z.array(ObjectiveSchema).min(1),
  initialWaves: z.array(WaveSpawnSchema),
  airUnits: z.array(AirSpawnSchema),
  vehicles: z.array(VehicleSpawnSchema),
  extractionPoint: Vec3Schema.optional(),
});
export type MissionConfig = z.infer<typeof MissionSchema>;
