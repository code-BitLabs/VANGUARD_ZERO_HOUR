import { z } from 'zod';

export const AssetKindSchema = z.enum(['glb', 'ktx2', 'procedural_mesh', 'procedural_texture', 'audio_buffer']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

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
