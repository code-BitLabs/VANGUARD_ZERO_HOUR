import {
  OperatorSpecializationId,
  SquadOperatorRecord,
  SquadRoleId,
} from '@/src/schemas/campaign.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';

export interface SquadArchetypeFlyweight {
  readonly role: SquadRoleId;
  readonly roleLabel: string;
  readonly shortBadge: string;
  readonly primaryWeapon: WeaponId;
  readonly maxHealth: number;
  readonly maxArmor: number;
  readonly moveSpeedMps: number;
  readonly preferredRangeMin: number;
  readonly preferredRangeMax: number;
  readonly suppressionPower: number;
  readonly armorDamageMult: number;
  readonly spotRangeMeters: number;
  readonly autonomousReviveCharges: number;
  readonly rigAccentHex: number;
  readonly summary: string;
}

export const SQUAD_ARCHETYPE_FLYWEIGHTS: Readonly<Record<SquadRoleId, SquadArchetypeFlyweight>> =
  Object.freeze({
    assault: Object.freeze({
      role: 'assault',
      roleLabel: 'Assault Breacher',
      shortBadge: 'ASLT',
      primaryWeapon: 'assault_rifle',
      maxHealth: 135,
      maxArmor: 70,
      moveSpeedMps: 6.1,
      preferredRangeMin: 10,
      preferredRangeMax: 34,
      suppressionPower: 1.0,
      armorDamageMult: 1.0,
      spotRangeMeters: 52,
      autonomousReviveCharges: 0,
      rigAccentHex: 0x38bdf8,
      summary: 'Leads bounding pushes, executes flanks, and clears close-to-mid resistance.',
    }),
    support: Object.freeze({
      role: 'support',
      roleLabel: 'Heavy Support',
      shortBadge: 'SUPP',
      primaryWeapon: 'lmg',
      maxHealth: 155,
      maxArmor: 95,
      moveSpeedMps: 5.3,
      preferredRangeMin: 16,
      preferredRangeMax: 48,
      suppressionPower: 1.85,
      armorDamageMult: 1.15,
      spotRangeMeters: 55,
      autonomousReviveCharges: 0,
      rigAccentHex: 0xf59e0b,
      summary: 'Pins hostile squads with sustained SAW bursts so teammates can flank safely.',
    }),
    recon: Object.freeze({
      role: 'recon',
      roleLabel: 'Recon Marksman',
      shortBadge: 'RCON',
      primaryWeapon: 'sniper_rifle',
      maxHealth: 120,
      maxArmor: 55,
      moveSpeedMps: 6.3,
      preferredRangeMin: 26,
      preferredRangeMax: 78,
      suppressionPower: 0.75,
      armorDamageMult: 1.2,
      spotRangeMeters: 85,
      autonomousReviveCharges: 0,
      rigAccentHex: 0x22d3ee,
      summary: 'Spots distant enemies/elevated snipers for shared squad awareness and precision picks.',
    }),
    anti_armor: Object.freeze({
      role: 'anti_armor',
      roleLabel: 'Anti-Armor Specialist',
      shortBadge: 'AT-SP',
      primaryWeapon: 'rocket_launcher',
      maxHealth: 145,
      maxArmor: 85,
      moveSpeedMps: 5.5,
      preferredRangeMin: 18,
      preferredRangeMax: 58,
      suppressionPower: 1.25,
      armorDamageMult: 2.25,
      spotRangeMeters: 62,
      autonomousReviveCharges: 0,
      rigAccentHex: 0xf97316,
      summary: 'Prioritizes enemy convoys, heavy armor, and entrenched weapon positions.',
    }),
    medic: Object.freeze({
      role: 'medic',
      roleLabel: 'Field Medic',
      shortBadge: 'MED',
      primaryWeapon: 'smg',
      maxHealth: 130,
      maxArmor: 65,
      moveSpeedMps: 6.2,
      preferredRangeMin: 8,
      preferredRangeMax: 28,
      suppressionPower: 0.85,
      armorDamageMult: 0.9,
      spotRangeMeters: 48,
      autonomousReviveCharges: 2,
      rigAccentHex: 0x34d399,
      summary: 'Performs autonomous triage (up to 2 field revives/op) and stabilizes injured allies.',
    }),
  });

export interface OperatorSpecializationSpec {
  readonly id: OperatorSpecializationId;
  readonly role: SquadRoleId;
  readonly name: string;
  readonly unlockDescription: string;
  readonly bonusSummary: string;
  /** Capped modest utility bonus (0.06..0.12) so experienced operators help without becoming mandatory */
  readonly utilityBonus: number;
}

export const OPERATOR_SPECIALIZATIONS: Readonly<Record<OperatorSpecializationId, OperatorSpecializationSpec>> =
  Object.freeze({
    breach_specialist: Object.freeze({
      id: 'breach_specialist',
      role: 'assault',
      name: 'Breach Specialist',
      unlockDescription: '12+ combat eliminations across operations',
      bonusSummary: '+8% CQB damage & +10% flank movement composure',
      utilityBonus: 0.08,
    }),
    suppressive_anchor: Object.freeze({
      id: 'suppressive_anchor',
      role: 'support',
      name: 'Suppressive Anchor',
      unlockDescription: '10+ suppression assists across operations',
      bonusSummary: '+12% suppression output & +10% morale resistance',
      utilityBonus: 0.12,
    }),
    armor_spotter: Object.freeze({
      id: 'armor_spotter',
      role: 'recon',
      name: 'Overwatch Spotter',
      unlockDescription: '12+ hostile threats marked for the fireteam',
      bonusSummary: '+10% recon marking range & shared intel duration',
      utilityBonus: 0.1,
    }),
    ordnance_expert: Object.freeze({
      id: 'ordnance_expert',
      role: 'anti_armor',
      name: 'Ordnance Specialist',
      unlockDescription: '4+ armored vehicles or heavy threats neutralized',
      bonusSummary: '+10% anti-armor effectiveness & faster launcher cycle',
      utilityBonus: 0.1,
    }),
    combat_triage: Object.freeze({
      id: 'combat_triage',
      role: 'medic',
      name: 'Combat Triage',
      unlockDescription: '3+ squad revives performed in active combat',
      bonusSummary: '-12% rescue channel duration & +10% post-revive HP',
      utilityBonus: 0.12,
    }),
  });

export function createDefaultCoreRoster(): SquadOperatorRecord[] {
  return [
    {
      id: 'vanguard_2',
      callsign: 'Vanguard-2 "Reaper"',
      role: 'assault',
      status: 'active',
      recoveryOpsRemaining: 0,
      recoveryElapsedSec: 0,
      recoveryTargetSec: 0,
      injurySeverity: 'none',
      missionsDeployed: 0,
      missionsSurvived: 0,
      kills: 0,
      revivesPerformed: 0,
      vehiclesDisabled: 0,
      spotsMarked: 0,
      suppressionAssists: 0,
      timesDowned: 0,
      timesMia: 0,
      xp: 0,
      unlockedSpecializations: [],
      customization: { camoId: 'obsidian_ops', helmetId: 'standard_ops', patchId: 'task_force_zero' },
    },
    {
      id: 'bulwark_3',
      callsign: 'Bulwark-3 "Hammer"',
      role: 'support',
      status: 'active',
      recoveryOpsRemaining: 0,
      recoveryElapsedSec: 0,
      recoveryTargetSec: 0,
      injurySeverity: 'none',
      missionsDeployed: 0,
      missionsSurvived: 0,
      kills: 0,
      revivesPerformed: 0,
      vehiclesDisabled: 0,
      spotsMarked: 0,
      suppressionAssists: 0,
      timesDowned: 0,
      timesMia: 0,
      xp: 0,
      unlockedSpecializations: [],
      customization: { camoId: 'obsidian_ops', helmetId: 'heavy_breacher', patchId: 'task_force_zero' },
    },
    {
      id: 'specter_4',
      callsign: 'Specter-4 "Ghost"',
      role: 'recon',
      status: 'active',
      recoveryOpsRemaining: 0,
      recoveryElapsedSec: 0,
      recoveryTargetSec: 0,
      injurySeverity: 'none',
      missionsDeployed: 0,
      missionsSurvived: 0,
      kills: 0,
      revivesPerformed: 0,
      vehiclesDisabled: 0,
      spotsMarked: 0,
      suppressionAssists: 0,
      timesDowned: 0,
      timesMia: 0,
      xp: 0,
      unlockedSpecializations: [],
      customization: { camoId: 'obsidian_ops', helmetId: 'recon_nvg', patchId: 'task_force_zero' },
    },
    {
      id: 'anvil_5',
      callsign: 'Anvil-5 "Sledge"',
      role: 'anti_armor',
      status: 'active',
      recoveryOpsRemaining: 0,
      recoveryElapsedSec: 0,
      recoveryTargetSec: 0,
      injurySeverity: 'none',
      missionsDeployed: 0,
      missionsSurvived: 0,
      kills: 0,
      revivesPerformed: 0,
      vehiclesDisabled: 0,
      spotsMarked: 0,
      suppressionAssists: 0,
      timesDowned: 0,
      timesMia: 0,
      xp: 0,
      unlockedSpecializations: [],
      customization: { camoId: 'obsidian_ops', helmetId: 'ballistic_visor', patchId: 'task_force_zero' },
    },
    {
      id: 'lifeline_6',
      callsign: 'Lifeline-6 "Doc"',
      role: 'medic',
      status: 'active',
      recoveryOpsRemaining: 0,
      recoveryElapsedSec: 0,
      recoveryTargetSec: 0,
      injurySeverity: 'none',
      missionsDeployed: 0,
      missionsSurvived: 0,
      kills: 0,
      revivesPerformed: 0,
      vehiclesDisabled: 0,
      spotsMarked: 0,
      suppressionAssists: 0,
      timesDowned: 0,
      timesMia: 0,
      xp: 0,
      unlockedSpecializations: [],
      customization: { camoId: 'obsidian_ops', helmetId: 'standard_ops', patchId: 'task_force_zero' },
    },
  ];
}

const RESERVE_CALLSIGNS: Readonly<Record<SquadRoleId, string>> = Object.freeze({
  assault: 'Reserve-A "Striker"',
  support: 'Reserve-S "Bastion"',
  recon: 'Reserve-R "Hawk"',
  anti_armor: 'Reserve-T "Javelin"',
  medic: 'Reserve-M "Pulse"',
});

/**
 * Deterministic Reserve Specialist factory.
 * Guarantees no mandatory operation is ever softlocked even if all 5 core operators are recovering or KIA under Ironman.
 */
export function createReserveSpecialist(role: SquadRoleId, slotIndex: number): SquadOperatorRecord {
  return {
    id: `reserve_${role}_${slotIndex}`,
    callsign: RESERVE_CALLSIGNS[role],
    role,
    status: 'active',
    recoveryOpsRemaining: 0,
    recoveryElapsedSec: 0,
    recoveryTargetSec: 0,
    injurySeverity: 'none',
    missionsDeployed: 0,
    missionsSurvived: 0,
    kills: 0,
    revivesPerformed: 0,
    vehiclesDisabled: 0,
    spotsMarked: 0,
    suppressionAssists: 0,
    timesDowned: 0,
    timesMia: 0,
    xp: 0,
    unlockedSpecializations: [],
    customization: { camoId: 'obsidian_ops', helmetId: 'standard_ops', patchId: 'task_force_zero' },
  };
}

/**
 * Resolves exactly `targetCount` (default 3) deployable operators from preferred IDs and the roster.
 * - Disallows duplicate core operators.
 * - Automatically backfills recovering/KIA slots with matching-role Reserve Specialists.
 */
export function resolveDeployableFireteam(
  roster: readonly SquadOperatorRecord[],
  preferredIds: readonly string[],
  targetCount = 3
): { operators: SquadOperatorRecord[]; reserveCount: number; substitutedNames: string[] } {
  const byId = new Map<string, SquadOperatorRecord>();
  for (const op of roster) {
    byId.set(op.id, op);
  }

  const chosen: SquadOperatorRecord[] = [];
  const usedIds = new Set<string>();
  const substitutedNames: string[] = [];
  let reserveCount = 0;

  const fallbackOrder: SquadRoleId[] = ['assault', 'support', 'medic', 'recon', 'anti_armor'];

  for (let i = 0; i < preferredIds.length && chosen.length < targetCount; i++) {
    const id = preferredIds[i];
    if (usedIds.has(id)) continue;
    const record = byId.get(id);
    if (record && record.status === 'active') {
      chosen.push(record);
      usedIds.add(record.id);
    } else if (record) {
      // Core operator is recovering or KIA: backfill with a Reserve Specialist of the same role
      const reserve = createReserveSpecialist(record.role, chosen.length + 1);
      chosen.push(reserve);
      usedIds.add(reserve.id);
      reserveCount++;
      substitutedNames.push(`${record.callsign} -> ${reserve.callsign}`);
    }
  }

  // Fill any remaining slots with healthy core operators first
  for (const op of roster) {
    if (chosen.length >= targetCount) break;
    if (op.status === 'active' && !usedIds.has(op.id)) {
      chosen.push(op);
      usedIds.add(op.id);
    }
  }

  // If all core operators are unavailable, guarantee full fireteam via Reserve Specialists
  let roleCursor = 0;
  while (chosen.length < targetCount) {
    const role = fallbackOrder[roleCursor % fallbackOrder.length];
    const reserve = createReserveSpecialist(role, chosen.length + 1);
    chosen.push(reserve);
    reserveCount++;
    roleCursor++;
  }

  return { operators: chosen, reserveCount, substitutedNames };
}

/**
 * Evaluates newly earned specializations from real field performance.
 */
export function evaluateOperatorSpecializations(op: SquadOperatorRecord): OperatorSpecializationId[] {
  const unlocked = new Set<OperatorSpecializationId>(op.unlockedSpecializations);
  if (op.role === 'assault' && op.kills >= 12) unlocked.add('breach_specialist');
  if (op.role === 'support' && op.suppressionAssists >= 10) unlocked.add('suppressive_anchor');
  if (op.role === 'recon' && op.spotsMarked >= 12) unlocked.add('armor_spotter');
  if (op.role === 'anti_armor' && op.vehiclesDisabled >= 4) unlocked.add('ordnance_expert');
  if (op.role === 'medic' && op.revivesPerformed >= 3) unlocked.add('combat_triage');
  return Array.from(unlocked);
}
