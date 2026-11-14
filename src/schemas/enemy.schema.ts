import { z } from 'zod';
import { EnemyAwarenessStateSchema } from './combat.schema';

export const EnemyArchetypeSchema = z.enum([
  'infantry',
  'heavy_armor',
  'sniper',
  'elite_assault',
  'rocket_trooper',
  'drone_operator',
  'vehicle_crew',
]);
export type EnemyArchetype = z.infer<typeof EnemyArchetypeSchema>;

export const SquadRoleSchema = z.enum([
  'rifleman',
  'flanker',
  'suppressor',
  'marksman',
  'anti_armor',
  'operator',
]);
export type SquadRole = z.infer<typeof SquadRoleSchema>;

// Support both the 9-state awareness states and legacy aliases for backwards compatibility
export const EnemyFSMStateSchema = z.union([
  EnemyAwarenessStateSchema,
  z.enum(['PATROL', 'ALERT', 'ENGAGE', 'TAKE_COVER', 'FLANK', 'RETREAT', 'SEARCH', 'DEAD']),
]);
export type EnemyFSMState = z.infer<typeof EnemyFSMStateSchema>;

export const EnemyConfigSchema = z.object({
  archetype: EnemyArchetypeSchema,
  displayName: z.string(),
  role: SquadRoleSchema,
  maxHealth: z.number().positive(),
  maxArmor: z.number().nonnegative(),
  moveSpeed: z.number().positive(),
  detectionRange: z.number().positive(),
  attackRange: z.number().positive(),
  fireRateSec: z.number().positive(),
  damagePerHit: z.number().positive(),
  accuracy: z.number().min(0.1).max(1),
  grenadeChance: z.number().min(0).max(1),
  canUseRockets: z.boolean().default(false),
  canSpawnDrones: z.boolean().default(false),
  xpReward: z.number().int().positive(),
  scoreReward: z.number().int().positive(),
  accentColor: z.string(),
});
export type EnemyConfig = z.infer<typeof EnemyConfigSchema>;
