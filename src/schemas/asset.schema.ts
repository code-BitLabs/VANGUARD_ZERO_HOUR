import { z } from 'zod';
import { QualityTierSchema } from './common.schema';

export const AssetKindSchema = z.enum([
  'glb',
  'ktx2',
  'procedural_mesh',
  'procedural_texture',
  'audio_buffer',
  'hybrid_assembly',
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetCategorySchema = z.enum([
  'weapon',
  'operator_arm',
  'enemy',
  'vehicle',
  'air_unit',
  'architecture',
  'prop',
  'foliage',
  'material',
  'audio',
]);
export type AssetCategory = z.infer<typeof AssetCategorySchema>;

export const AssetCompressionKindSchema = z.enum([
  'none',
  'meshopt',
  'draco',
  'ktx2_basisu',
  'procedural_assembly',
]);
export type AssetCompressionKind = z.infer<typeof AssetCompressionKindSchema>;

export const AssetSocketDescriptorSchema = z.object({
  name: z.string().min(1),
  localPosition: z.tuple([z.number(), z.number(), z.number()]),
  localRotationEuler: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  required: z.boolean().default(true),
});
export type AssetSocketDescriptor = z.infer<typeof AssetSocketDescriptorSchema>;

export const ScreenSpaceLodProfileSchema = z.object({
  /** Screen-space projected height ratio [0..1] above which LOD0 renders */
  lod0MinProjectedRatio: z.number().min(0.01).max(1.0).default(0.095),
  /** Screen-space projected height ratio [0..1] above which LOD1 renders (below uses LOD2) */
  lod1MinProjectedRatio: z.number().min(0.005).max(0.8).default(0.035),
  /** Fractional hysteresis band (e.g., 0.18 = ±18%) preventing rapid LOD oscillation */
  hysteresisBand: z.number().min(0.05).max(0.45).default(0.18),
  /** Maximum LOD index allowed to cast dynamic shadows (0 = LOD0 only, 1 = LOD0+LOD1) */
  maxShadowCasterLod: z.number().int().min(0).max(2).default(1),
  /** Fallback distance thresholds in meters when screen projection is unavailable */
  fallbackDistancesMeters: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).default([
    28,
    72,
    160,
  ]),
});
export type ScreenSpaceLodProfile = z.infer<typeof ScreenSpaceLodProfileSchema>;

export const AssetProvenanceSchema = z.object({
  sourceType: z.enum(['authored_glb', 'dcc_blender', 'procedural_cad', 'hybrid_authored_procedural']),
  author: z.string().min(1).default('Vanguard Engineering Studio'),
  license: z.enum(['CC0-1.0', 'CC-BY-4.0', 'MIT', 'PROPRIETARY-FIRST-PARTY']).default('PROPRIETARY-FIRST-PARTY'),
  attributionText: z.string().default('Vanguard: Zero Hour First-Party Production Pipeline'),
  sourceVersion: z.string().min(1).default('5B.1.0'),
});
export type AssetProvenance = z.infer<typeof AssetProvenanceSchema>;

export const GameplayProfileLinksSchema = z.object({
  physicsProfileId: z.string().min(1),
  hitVolumeProfileId: z.string().min(1),
  navObstacleProfileId: z.string().min(1),
  decoupledFromVisualHierarchy: z.literal(true).default(true),
});
export type GameplayProfileLinks = z.infer<typeof GameplayProfileLinksSchema>;

/**
 * Layer 1: AssetDefinition — Canonical identity, provenance, sockets, rig contracts, and gameplay links.
 */
export const AssetDefinitionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  category: AssetCategorySchema,
  tags: z.array(z.string()).default([]),
  provenance: AssetProvenanceSchema,
  unitScaleMeters: z.number().positive().default(1.0),
  coordinateConvention: z.literal('right_handed_y_up_neg_z_forward').default('right_handed_y_up_neg_z_forward'),
  pivotNormalization: z.enum(['bottom_center', 'center_of_mass', 'weapon_grip_origin', 'socket_aligned']).default('bottom_center'),
  expectedDimensionsMeters: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    depth: z.number().positive(),
    toleranceRatio: z.number().min(0.05).max(1.5).default(0.35),
  }),
  sockets: z.array(AssetSocketDescriptorSchema).default([]),
  requiredAnimationClips: z.array(z.string()).default([]),
  lodProfile: ScreenSpaceLodProfileSchema.default(() => ScreenSpaceLodProfileSchema.parse({})),
  gameplayLinks: GameplayProfileLinksSchema,
  maxTriangleBudgetLod0: z.number().int().positive().default(12000),
  maxTextureMemoryBytes: z.number().int().positive().default(8 * 1024 * 1024),
  streamingPriority: z.enum(['critical_preload', 'mission_preload', 'on_demand']).default('mission_preload'),
  defaultVariantId: z.string().min(1),
  fallbackVariantId: z.string().min(1),
});
export type AssetDefinition = z.infer<typeof AssetDefinitionSchema>;

/**
 * Layer 2: AssetVariant — Selected quality, biome, faction, or damage state variant of an AssetDefinition.
 */
export const AssetVariantSchema = z.object({
  variantId: z.string().min(1),
  definitionId: z.string().min(1),
  label: z.string().min(1),
  minQualityTier: QualityTierSchema.default('low'),
  biomeTag: z.enum(['all', 'urban', 'desert', 'night_aa', 'jungle', 'industrial']).default('all'),
  damageState: z.enum(['pristine', 'weathered', 'damaged', 'destroyed']).default('weathered'),
  artifactIdsByLod: z.object({
    lod0: z.string().min(1),
    lod1: z.string().min(1).optional(),
    lod2: z.string().min(1).optional(),
  }),
  materialProfileIds: z.array(z.string()).default([]),
});
export type AssetVariant = z.infer<typeof AssetVariantSchema>;

/**
 * Layer 3: AssetArtifact — Processed runtime file or deterministic assembly payload with content hash.
 */
export const AssetArtifactSchema = z.object({
  artifactId: z.string().min(1),
  definitionId: z.string().min(1),
  kind: AssetKindSchema,
  localUri: z.string().optional(),
  generatorKey: z.string().min(1),
  contentHashSha256: z.string().min(16),
  buildVersion: z.string().min(1).default('5B.2026.11'),
  compression: AssetCompressionKindSchema.default('procedural_assembly'),
  estimatedTriangles: z.number().int().nonnegative(),
  estimatedTextureBytes: z.number().int().nonnegative().default(0),
  dependencies: z.array(z.string()).default([]),
});
export type AssetArtifact = z.infer<typeof AssetArtifactSchema>;

export const PerAssetProcessingReportSchema = z.object({
  definitionId: z.string().min(1),
  variantId: z.string().min(1),
  artifactId: z.string().min(1),
  contentHashSha256: z.string(),
  compressionSelected: AssetCompressionKindSchema,
  compressionRationale: z.string(),
  lodCount: z.number().int().min(1).max(4),
  lod0Triangles: z.number().int().nonnegative(),
  lod1Triangles: z.number().int().nonnegative(),
  lod2Triangles: z.number().int().nonnegative(),
  socketsVerified: z.array(z.string()),
  uvsPresent: z.boolean(),
  boundsMeasuredMeters: z.tuple([z.number(), z.number(), z.number()]),
  licenseVerified: z.boolean(),
  passedQualityGate: z.boolean(),
  issues: z.array(z.string()),
});
export type PerAssetProcessingReport = z.infer<typeof PerAssetProcessingReportSchema>;

export const AssetManifestEntrySchema = z.object({
  id: z.string().min(1),
  kind: AssetKindSchema,
  url: z.string().optional(),
  fallbackGenerator: z.string().min(1),
  shared: z.boolean().default(false),
});
export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;

export const AssetLoadProgressSchema = z.object({
  loaded: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  currentAsset: z.string(),
  percent: z.number().min(0).max(100),
  usedFallbackCount: z.number().int().nonnegative().default(0),
});
export type AssetLoadProgress = z.infer<typeof AssetLoadProgressSchema>;

