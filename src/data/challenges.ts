import { Difficulty, MissionGrade } from '@/src/schemas/common.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';

export type ReplayModifierId =
  | 'scarce_supply'
  | 'precision_doctrine'
  | 'high_lethality'
  | 'iron_operator';

export interface ReplayModifierDefinition {
  id: ReplayModifierId;
  title: string;
  shortLabel: string;
  description: string;
  scoreMultiplier: number;
  requisitionBonusPct: number;
  ammoGrantScale: number;
  headshotDamageMultiplier: number;
  enemyDamageMultiplier: number;
  disableCheckpoints: boolean;
}

export const REPLAY_MODIFIERS: readonly ReplayModifierDefinition[] = [
  {
    id: 'scarce_supply',
    title: 'Scarce Supply',
    shortLabel: 'Scarce Supply',
    description: 'Ammo crates grant 35% less reserve ammunition. Rewards shot discipline and scavenged routes.',
    scoreMultiplier: 1.2,
    requisitionBonusPct: 20,
    ammoGrantScale: 0.65,
    headshotDamageMultiplier: 1.0,
    enemyDamageMultiplier: 1.0,
    disableCheckpoints: false,
  },
  {
    id: 'precision_doctrine',
    title: 'Precision Doctrine',
    shortLabel: 'Precision Doctrine',
    description: 'Headshots deal +35% bonus damage while hostile fire hits 15% harder.',
    scoreMultiplier: 1.25,
    requisitionBonusPct: 25,
    ammoGrantScale: 1.0,
    headshotDamageMultiplier: 1.35,
    enemyDamageMultiplier: 1.15,
    disableCheckpoints: false,
  },
  {
    id: 'high_lethality',
    title: 'High Lethality',
    shortLabel: 'High Lethality',
    description: 'Hostile squads deal +30% damage across all ranges. Demands strict cover usage.',
    scoreMultiplier: 1.35,
    requisitionBonusPct: 35,
    ammoGrantScale: 1.0,
    headshotDamageMultiplier: 1.1,
    enemyDamageMultiplier: 1.3,
    disableCheckpoints: false,
  },
  {
    id: 'iron_operator',
    title: 'Iron Operator',
    shortLabel: 'Iron Operator',
    description: 'No mid-mission checkpoint restarts. Clear the operation in one continuous run.',
    scoreMultiplier: 1.4,
    requisitionBonusPct: 40,
    ammoGrantScale: 1.0,
    headshotDamageMultiplier: 1.0,
    enemyDamageMultiplier: 1.0,
    disableCheckpoints: true,
  },
] as const;

export const REPLAY_MODIFIER_BY_ID: Record<ReplayModifierId, ReplayModifierDefinition> =
  REPLAY_MODIFIERS.reduce(
    (acc, mod) => {
      acc[mod.id] = mod;
      return acc;
    },
    {} as Record<ReplayModifierId, ReplayModifierDefinition>
  );

export interface CombinedModifierEffects {
  scoreMultiplier: number;
  requisitionBonusPct: number;
  ammoGrantScale: number;
  headshotDamageMultiplier: number;
  enemyDamageMultiplier: number;
  disableCheckpoints: boolean;
}

export function computeCombinedModifierEffects(
  modifierIds: readonly ReplayModifierId[]
): CombinedModifierEffects {
  let scoreMultiplier = 1.0;
  let requisitionBonusPct = 0;
  let ammoGrantScale = 1.0;
  let headshotDamageMultiplier = 1.0;
  let enemyDamageMultiplier = 1.0;
  let disableCheckpoints = false;

  const seen = new Set<ReplayModifierId>();
  for (const id of modifierIds) {
    if (seen.has(id)) continue;
    const def = REPLAY_MODIFIER_BY_ID[id];
    if (!def) continue;
    seen.add(id);
    scoreMultiplier *= def.scoreMultiplier;
    requisitionBonusPct += def.requisitionBonusPct;
    ammoGrantScale *= def.ammoGrantScale;
    headshotDamageMultiplier *= def.headshotDamageMultiplier;
    enemyDamageMultiplier *= def.enemyDamageMultiplier;
    if (def.disableCheckpoints) disableCheckpoints = true;
  }

  return {
    scoreMultiplier: Number(scoreMultiplier.toFixed(2)),
    requisitionBonusPct,
    ammoGrantScale: Math.max(0.4, Number(ammoGrantScale.toFixed(2))),
    headshotDamageMultiplier: Number(headshotDamageMultiplier.toFixed(2)),
    enemyDamageMultiplier: Number(enemyDamageMultiplier.toFixed(2)),
    disableCheckpoints,
  };
}

export interface MissionChallengeEvalContext {
  missionId: number;
  victory: boolean;
  difficulty: Difficulty;
  grade: MissionGrade;
  durationSec: number;
  parTimeSec: number;
  kills: number;
  headshots: number;
  airKills: number;
  accuracyPct: number;
  deathsCount: number;
  optionalObjectivesCompleted: number;
  activeModifiers: readonly ReplayModifierId[];
}

export interface TacticalChallengeDefinition {
  id: string;
  missionId: number;
  title: string;
  description: string;
  xpBonus: number;
  requisitionBonus: number;
  evaluate: (ctx: MissionChallengeEvalContext) => boolean;
}

export const TACTICAL_CHALLENGES: readonly TacticalChallengeDefinition[] = [
  {
    id: 'm1_urban_surgeon',
    missionId: 1,
    title: 'Boulevard Precision',
    description: 'Finish OP. IRON DAWN with at least 35% accuracy and 4+ headshots.',
    xpBonus: 250,
    requisitionBonus: 120,
    evaluate: (ctx) => ctx.victory && ctx.missionId === 1 && ctx.accuracyPct >= 35 && ctx.headshots >= 4,
  },
  {
    id: 'm1_clean_sweep',
    missionId: 1,
    title: 'Overwatch Silencer',
    description: 'Complete the optional rooftop overwatch objective with zero deaths.',
    xpBonus: 300,
    requisitionBonus: 150,
    evaluate: (ctx) =>
      ctx.victory && ctx.missionId === 1 && ctx.optionalObjectivesCompleted >= 1 && ctx.deathsCount === 0,
  },
  {
    id: 'm2_highway_blitz',
    missionId: 2,
    title: 'Desert Blitz',
    description: 'Clear OP. RED DUST under 210 seconds.',
    xpBonus: 280,
    requisitionBonus: 140,
    evaluate: (ctx) => ctx.victory && ctx.missionId === 2 && ctx.durationSec <= 210,
  },
  {
    id: 'm2_zero_casualty',
    missionId: 2,
    title: 'Armored Escort',
    description: 'Complete OP. RED DUST with zero deaths and optional objective cleared.',
    xpBonus: 320,
    requisitionBonus: 160,
    evaluate: (ctx) =>
      ctx.victory && ctx.missionId === 2 && ctx.deathsCount === 0 && ctx.optionalObjectivesCompleted >= 1,
  },
  {
    id: 'm3_blackout_ghost',
    missionId: 3,
    title: 'Lights Out',
    description: 'Complete OP. NIGHTFALL after neutralizing the night searchlight relay.',
    xpBonus: 300,
    requisitionBonus: 160,
    evaluate: (ctx) => ctx.victory && ctx.missionId === 3 && ctx.optionalObjectivesCompleted >= 1,
  },
  {
    id: 'm3_sky_dominance',
    missionId: 3,
    title: 'Midnight Air Marshal',
    description: 'Shoot down 6+ aerial targets in OP. NIGHTFALL on Operator or higher.',
    xpBonus: 350,
    requisitionBonus: 180,
    evaluate: (ctx) =>
      ctx.victory &&
      ctx.missionId === 3 &&
      ctx.airKills >= 6 &&
      ctx.difficulty !== 'easy',
  },
  {
    id: 'm4_bridgehead_ace',
    missionId: 4,
    title: 'Canopy Stalker',
    description: 'Clear OP. VIPER CANOPY with 5+ headshots and optional sniper nest cleared.',
    xpBonus: 320,
    requisitionBonus: 170,
    evaluate: (ctx) =>
      ctx.victory && ctx.missionId === 4 && ctx.headshots >= 5 && ctx.optionalObjectivesCompleted >= 1,
  },
  {
    id: 'm4_swift_sabotage',
    missionId: 4,
    title: 'River Lightning',
    description: 'Finish OP. VIPER CANOPY faster than par time with zero deaths.',
    xpBonus: 360,
    requisitionBonus: 190,
    evaluate: (ctx) =>
      ctx.victory && ctx.missionId === 4 && ctx.durationSec <= ctx.parTimeSec && ctx.deathsCount === 0,
  },
  {
    id: 'm5_iron_siege',
    missionId: 5,
    title: 'Foundry Breaker',
    description: 'Complete OP. BLACKOUT with the optional APC guard neutralized.',
    xpBonus: 400,
    requisitionBonus: 220,
    evaluate: (ctx) => ctx.victory && ctx.missionId === 5 && ctx.optionalObjectivesCompleted >= 1,
  },
  {
    id: 'm5_vanguard_legend',
    missionId: 5,
    title: 'Zero Hour Legend',
    description: 'Earn an S-Rank on OP. BLACKOUT or clear with any Replay Modifier active.',
    xpBonus: 500,
    requisitionBonus: 260,
    evaluate: (ctx) =>
      ctx.victory &&
      ctx.missionId === 5 &&
      (ctx.grade === 'S' || ctx.activeModifiers.length > 0),
  },
] as const;

export function getChallengesForMission(missionId: number): TacticalChallengeDefinition[] {
  return TACTICAL_CHALLENGES.filter((c) => c.missionId === missionId);
}

export type WeaponMasteryTier = 'unranked' | 'bronze' | 'silver' | 'gold' | 'vanguard';

export interface WeaponMasteryStatus {
  weaponId: WeaponId;
  kills: number;
  tier: WeaponMasteryTier;
  nextTierKills: number | null;
  progressPct: number;
  unlockedFinishLabel: string | null;
}

export const WEAPON_MASTERY_THRESHOLDS: ReadonlyArray<{
  tier: WeaponMasteryTier;
  minKills: number;
  finishLabel: string | null;
}> = [
  { tier: 'unranked', minKills: 0, finishLabel: null },
  { tier: 'bronze', minKills: 10, finishLabel: 'Field Olive Coating' },
  { tier: 'silver', minKills: 25, finishLabel: 'Brushed Titanium Frame' },
  { tier: 'gold', minKills: 50, finishLabel: 'Carbon Matte Spec-Ops' },
  { tier: 'vanguard', minKills: 100, finishLabel: 'Vanguard Zero-Hour Finish' },
];

export function evaluateWeaponMastery(weaponId: WeaponId, kills: number): WeaponMasteryStatus {
  const safeKills = Math.max(0, Math.floor(kills));
  let curIdx = 0;
  for (let i = 0; i < WEAPON_MASTERY_THRESHOLDS.length; i++) {
    if (safeKills >= WEAPON_MASTERY_THRESHOLDS[i].minKills) {
      curIdx = i;
    }
  }
  const cur = WEAPON_MASTERY_THRESHOLDS[curIdx];
  const next = WEAPON_MASTERY_THRESHOLDS[curIdx + 1] ?? null;
  const progressPct = next
    ? Math.min(
        100,
        Math.round(((safeKills - cur.minKills) / Math.max(1, next.minKills - cur.minKills)) * 100)
      )
    : 100;

  return {
    weaponId,
    kills: safeKills,
    tier: cur.tier,
    nextTierKills: next ? next.minKills : null,
    progressPct,
    unlockedFinishLabel: cur.finishLabel,
  };
}
