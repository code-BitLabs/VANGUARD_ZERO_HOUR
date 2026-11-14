import { z } from 'zod';

export const Vec3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
export type Vec3 = z.infer<typeof Vec3Schema>;

export const DifficultySchema = z.enum(['easy', 'normal', 'hard', 'extreme']);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const QualityTierSchema = z.enum(['low', 'medium', 'high', 'ultra']);
export type QualityTier = z.infer<typeof QualityTierSchema>;

export const GradeSchema = z.enum(['S', 'A', 'B', 'C']);
export type MissionGrade = z.infer<typeof GradeSchema>;

export const ColorblindModeSchema = z.enum(['standard', 'deuteranopia', 'protanopia', 'tritanopia']);
export type ColorblindMode = z.infer<typeof ColorblindModeSchema>;

export const MapIdSchema = z.enum(['warzone_city', 'desert_base', 'jungle_zone', 'industrial_complex']);
export type MapId = z.infer<typeof MapIdSchema>;

export const LightingTimeSchema = z.enum(['daylight', 'sunset', 'night', 'misty_dawn', 'storm_dusk']);
export type LightingTime = z.infer<typeof LightingTimeSchema>;

export const DIFFICULTY_MULTIPLIERS: Record<
  Difficulty,
  { enemyHp: number; enemyDamage: number; enemyAccuracy: number; xpBonus: number; label: string }
> = {
  easy: { enemyHp: 0.75, enemyDamage: 0.65, enemyAccuracy: 0.65, xpBonus: 0.85, label: 'Easy' },
  normal: { enemyHp: 1.0, enemyDamage: 1.0, enemyAccuracy: 0.85, xpBonus: 1.0, label: 'Normal' },
  hard: { enemyHp: 1.3, enemyDamage: 1.35, enemyAccuracy: 1.05, xpBonus: 1.35, label: 'Hard' },
  extreme: { enemyHp: 1.6, enemyDamage: 1.75, enemyAccuracy: 1.25, xpBonus: 1.75, label: 'Extreme' },
};
