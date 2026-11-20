import {
  AttachmentSlot,
  MissionLoadoutConfig,
  NamedLoadoutPreset,
  OperatorCamoId,
  OperatorHelmetId,
  OperatorPatchId,
  TacticalEquipmentId,
} from '@/src/schemas/campaign.schema';
import { WeaponCategory } from '@/src/schemas/weapon.schema';

export interface AttachmentStatModifiers {
  damageMult?: number;
  rangeMult?: number;
  muzzleVelocityMult?: number;
  recoilPitchMult?: number;
  recoilYawMult?: number;
  spreadHipMult?: number;
  spreadAdsMult?: number;
  adsFovDelta?: number;
  equipTimeMult?: number;
  sprintToFireMult?: number;
  reloadTimeMult?: number;
  magazineSizeMult?: number;
  mobilityDelta?: number;
  soundRadiusMult?: number;
  armorPenDelta?: number;
  grantsOpticalScope?: boolean;
}

export interface AttachmentFlyweight {
  readonly id: string;
  readonly slot: AttachmentSlot;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly prosSummary: string;
  readonly consSummary: string;
  readonly compatibleCategories: readonly WeaponCategory[];
  readonly reqCost: number;
  readonly minMasteryKills: number;
  readonly modifiers: Readonly<AttachmentStatModifiers>;
}

const ALL_BALLISTIC: readonly WeaponCategory[] = ['rifle', 'smg', 'sniper', 'shotgun', 'lmg', 'sidearm'];
const PRIMARY_AUTO: readonly WeaponCategory[] = ['rifle', 'smg', 'lmg'];
const RIFLE_SNIPER_LMG: readonly WeaponCategory[] = ['rifle', 'sniper', 'lmg'];
const ALL_WEAPONS: readonly WeaponCategory[] = [
  'rifle',
  'smg',
  'sniper',
  'shotgun',
  'lmg',
  'sidearm',
  'launcher',
];

export const ATTACHMENT_CATALOG: readonly AttachmentFlyweight[] = Object.freeze<readonly AttachmentFlyweight[]>([
  // --- OPTICS ---
  Object.freeze<AttachmentFlyweight>({
    id: 'optic_reflex_micro',
    slot: 'optic',
    name: 'Kobra Micro Reflex',
    shortName: 'Micro Reflex',
    description: 'Low-profile holographic sight accelerating close-to-mid target acquisition.',
    prosSummary: '-10% ADS spread · Faster snap handling',
    consSummary: '-8% effective long-range zoom clarity',
    compatibleCategories: ['rifle', 'smg', 'shotgun', 'lmg', 'sidearm'],
    reqCost: 90,
    minMasteryKills: 0,
    modifiers: Object.freeze({
      spreadAdsMult: 0.9,
      equipTimeMult: 0.94,
      sprintToFireMult: 0.93,
      rangeMult: 0.94,
      adsFovDelta: 2,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'optic_acog_3x',
    slot: 'optic',
    name: 'TA-31 3x Tactical Optic',
    shortName: '3x ACOG',
    description: 'Mid-range prism optic tightening ADS precision at the cost of CQB snap speed.',
    prosSummary: '-24% ADS spread · +12% effective range',
    consSummary: '+14% equip/sprint-to-fire · -0.02 mobility',
    compatibleCategories: RIFLE_SNIPER_LMG,
    reqCost: 140,
    minMasteryKills: 10,
    modifiers: Object.freeze({
      spreadAdsMult: 0.76,
      rangeMult: 1.12,
      adsFovDelta: -10,
      equipTimeMult: 1.14,
      sprintToFireMult: 1.15,
      mobilityDelta: -0.02,
      spreadHipMult: 1.12,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'optic_thermal_targeter',
    slot: 'optic',
    name: 'FLIR Ballistic Targeter',
    shortName: 'FLIR Sight',
    description: 'High-contrast targeting sight for night/smoke ops and launchers.',
    prosSummary: '-20% ADS spread · +14% range',
    consSummary: '+18% handling delay · -0.04 mobility',
    compatibleCategories: ['rifle', 'sniper', 'lmg', 'launcher'],
    reqCost: 220,
    minMasteryKills: 25,
    modifiers: Object.freeze({
      spreadAdsMult: 0.8,
      rangeMult: 1.14,
      adsFovDelta: -8,
      equipTimeMult: 1.18,
      sprintToFireMult: 1.18,
      mobilityDelta: -0.04,
      grantsOpticalScope: true,
    }),
  }),

  // --- MUZZLES ---
  Object.freeze<AttachmentFlyweight>({
    id: 'muzzle_tactical_suppressor',
    slot: 'muzzle',
    name: 'Whisper-7 Tactical Suppressor',
    shortName: 'Suppressor',
    description: 'Reduces acoustic gunshot detection radius and softens muzzle rise.',
    prosSummary: '-55% gunshot noise radius · -10% vertical recoil',
    consSummary: '-12% range · -14% muzzle velocity · +8% equip time',
    compatibleCategories: ['rifle', 'smg', 'sniper', 'sidearm'],
    reqCost: 130,
    minMasteryKills: 5,
    modifiers: Object.freeze({
      soundRadiusMult: 0.45,
      recoilPitchMult: 0.9,
      rangeMult: 0.88,
      muzzleVelocityMult: 0.86,
      equipTimeMult: 1.08,
      mobilityDelta: -0.02,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'muzzle_compensator',
    slot: 'muzzle',
    name: 'Vanguard Dual-Port Brake',
    shortName: 'Compensator',
    description: 'Redirects gas upward to tame automatic climb while amplifying report.',
    prosSummary: '-20% vertical recoil · -12% horizontal recoil',
    consSummary: '+28% gunshot noise radius · +8% hip spread',
    compatibleCategories: ALL_BALLISTIC,
    reqCost: 110,
    minMasteryKills: 5,
    modifiers: Object.freeze({
      recoilPitchMult: 0.8,
      recoilYawMult: 0.88,
      soundRadiusMult: 1.28,
      spreadHipMult: 1.08,
      equipTimeMult: 1.05,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'muzzle_full_choke',
    slot: 'muzzle',
    name: 'Breacher Tight Choke',
    shortName: 'Tight Choke',
    description: 'Tightens shotgun pellet dispersion for extended corridor reach.',
    prosSummary: '-22% ADS & hip spread · +18% range',
    consSummary: '+15% vertical recoil · +10% reload time',
    compatibleCategories: ['shotgun'],
    reqCost: 120,
    minMasteryKills: 8,
    modifiers: Object.freeze({
      spreadAdsMult: 0.78,
      spreadHipMult: 0.82,
      rangeMult: 1.18,
      recoilPitchMult: 1.15,
      reloadTimeMult: 1.1,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'muzzle_shaped_booster',
    slot: 'muzzle',
    name: 'Tandem Booster Nozzle',
    shortName: 'Booster Nozzle',
    description: 'Accelerates warhead launch velocity and armor penetration.',
    prosSummary: '+18% velocity · +0.10 armor penetration',
    consSummary: '+22% recoil · +25% acoustic signature · +12% reload',
    compatibleCategories: ['launcher'],
    reqCost: 180,
    minMasteryKills: 10,
    modifiers: Object.freeze({
      muzzleVelocityMult: 1.18,
      armorPenDelta: 0.1,
      recoilPitchMult: 1.22,
      soundRadiusMult: 1.25,
      reloadTimeMult: 1.12,
    }),
  }),

  // --- BARRELS ---
  Object.freeze<AttachmentFlyweight>({
    id: 'barrel_heavy_precision',
    slot: 'barrel',
    name: 'Heavy Fluted Match Barrel',
    shortName: 'Heavy Barrel',
    description: 'Increases ballistic reach and velocity at a clear mobility penalty.',
    prosSummary: '+18% range · +14% velocity · -10% ADS spread',
    consSummary: '-0.06 mobility · +16% sprint-to-fire · +12% equip time',
    compatibleCategories: ['rifle', 'sniper', 'lmg', 'shotgun'],
    reqCost: 160,
    minMasteryKills: 15,
    modifiers: Object.freeze({
      rangeMult: 1.18,
      muzzleVelocityMult: 1.14,
      spreadAdsMult: 0.9,
      mobilityDelta: -0.06,
      sprintToFireMult: 1.16,
      equipTimeMult: 1.12,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'barrel_cqb_short',
    slot: 'barrel',
    name: 'CQB Shortened Carbine Tube',
    shortName: 'CQB Barrel',
    description: 'Trims front weight for room clearing and rapid corner peeks.',
    prosSummary: '+0.05 mobility · -18% sprint-to-fire · -14% equip time',
    consSummary: '-18% range · +16% vertical recoil · +14% ADS spread',
    compatibleCategories: ['rifle', 'smg', 'shotgun', 'sidearm', 'lmg'],
    reqCost: 130,
    minMasteryKills: 10,
    modifiers: Object.freeze({
      mobilityDelta: 0.05,
      sprintToFireMult: 0.82,
      equipTimeMult: 0.86,
      rangeMult: 0.82,
      recoilPitchMult: 1.16,
      spreadAdsMult: 1.14,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'barrel_lightweight_tube',
    slot: 'barrel',
    name: 'Composite Launch Tube',
    shortName: 'Carbon Tube',
    description: 'Reduces launcher carry weight and shoulder-raise time.',
    prosSummary: '+0.06 mobility · -16% equip time · -12% reload time',
    consSummary: '-14% range · -12% muzzle velocity',
    compatibleCategories: ['launcher'],
    reqCost: 170,
    minMasteryKills: 8,
    modifiers: Object.freeze({
      mobilityDelta: 0.06,
      equipTimeMult: 0.84,
      reloadTimeMult: 0.88,
      rangeMult: 0.86,
      muzzleVelocityMult: 0.88,
    }),
  }),

  // --- UNDERBARREL / STOCK ---
  Object.freeze<AttachmentFlyweight>({
    id: 'underbarrel_vertical_grip',
    slot: 'underbarrel',
    name: 'Tactical Vertical Foregrip',
    shortName: 'Vertical Grip',
    description: 'Stabilizes sustained recoil during full-auto fire at minor ADS cost.',
    prosSummary: '-18% vertical recoil · -14% hip spread',
    consSummary: '+12% sprint-to-fire · -0.02 mobility',
    compatibleCategories: PRIMARY_AUTO.concat(['shotgun']),
    reqCost: 100,
    minMasteryKills: 5,
    modifiers: Object.freeze({
      recoilPitchMult: 0.82,
      spreadHipMult: 0.86,
      sprintToFireMult: 1.12,
      mobilityDelta: -0.02,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'underbarrel_skeleton_stock',
    slot: 'underbarrel',
    name: 'Skeletonized Striker Stock',
    shortName: 'Skeleton Stock',
    description: 'Boosts strafe/sprint speed and fast ADS at the price of recoil stability.',
    prosSummary: '+0.04 mobility · -16% sprint-to-fire · -10% equip',
    consSummary: '+16% vertical recoil · +14% horizontal recoil',
    compatibleCategories: ALL_WEAPONS,
    reqCost: 115,
    minMasteryKills: 8,
    modifiers: Object.freeze({
      mobilityDelta: 0.04,
      sprintToFireMult: 0.84,
      equipTimeMult: 0.9,
      recoilPitchMult: 1.16,
      recoilYawMult: 1.14,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'underbarrel_bipod_brace',
    slot: 'underbarrel',
    name: 'Reinforced Overwatch Bipod',
    shortName: 'Overwatch Bipod',
    description: 'Drastically reduces long-range sway and horizontal drift when braced.',
    prosSummary: '-24% horizontal recoil · -18% ADS spread',
    consSummary: '-0.05 mobility · +18% sprint-to-fire · +12% equip',
    compatibleCategories: ['sniper', 'lmg', 'rifle'],
    reqCost: 150,
    minMasteryKills: 15,
    modifiers: Object.freeze({
      recoilYawMult: 0.76,
      spreadAdsMult: 0.82,
      mobilityDelta: -0.05,
      sprintToFireMult: 1.18,
      equipTimeMult: 1.12,
    }),
  }),

  // --- MAGAZINES ---
  Object.freeze<AttachmentFlyweight>({
    id: 'mag_extended_drum',
    slot: 'magazine',
    name: 'Extended Capacity Mag',
    shortName: 'Extended Mag',
    description: 'Sustains longer engagements with heavier reload and handling burden.',
    prosSummary: '+30% magazine capacity',
    consSummary: '+20% reload time · -0.04 mobility · +10% equip time',
    compatibleCategories: ['rifle', 'smg', 'sniper', 'shotgun', 'lmg', 'sidearm'],
    reqCost: 135,
    minMasteryKills: 12,
    modifiers: Object.freeze({
      magazineSizeMult: 1.3,
      reloadTimeMult: 1.2,
      mobilityDelta: -0.04,
      equipTimeMult: 1.1,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'mag_fast_polymer',
    slot: 'magazine',
    name: 'Fast-Swap Polymer Mag',
    shortName: 'Fast Mag',
    description: 'Lightweight magazine accelerating reload speed with slightly smaller capacity.',
    prosSummary: '-20% reload time · +0.02 mobility',
    consSummary: '-15% magazine capacity',
    compatibleCategories: ['rifle', 'smg', 'lmg', 'sidearm', 'shotgun'],
    reqCost: 125,
    minMasteryKills: 10,
    modifiers: Object.freeze({
      reloadTimeMult: 0.8,
      mobilityDelta: 0.02,
      magazineSizeMult: 0.85,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'mag_ap_rounds',
    slot: 'magazine',
    name: 'Tungsten AP Rounds',
    shortName: 'AP Rounds',
    description: 'High-pressure penetrator ammunition built against heavy armor & vehicles.',
    prosSummary: '+0.18 armor penetration · +8% damage',
    consSummary: '+20% recoil · -15% magazine capacity · +12% reload',
    compatibleCategories: ['rifle', 'sniper', 'lmg', 'sidearm'],
    reqCost: 190,
    minMasteryKills: 25,
    modifiers: Object.freeze({
      armorPenDelta: 0.18,
      damageMult: 1.08,
      recoilPitchMult: 1.2,
      recoilYawMult: 1.15,
      magazineSizeMult: 0.85,
      reloadTimeMult: 1.12,
    }),
  }),
  Object.freeze<AttachmentFlyweight>({
    id: 'mag_quick_pack',
    slot: 'magazine',
    name: 'Rapid-Load Ordnance Pack',
    shortName: 'Rapid Pack',
    description: 'Streamlined harness speeding up launcher cycling at slight weight penalty.',
    prosSummary: '-18% reload time',
    consSummary: '-0.03 mobility · +10% equip time',
    compatibleCategories: ['launcher'],
    reqCost: 175,
    minMasteryKills: 12,
    modifiers: Object.freeze({
      reloadTimeMult: 0.82,
      mobilityDelta: -0.03,
      equipTimeMult: 1.1,
    }),
  }),
]);

export const ATTACHMENT_BY_ID: Readonly<Record<string, AttachmentFlyweight>> = Object.freeze(
  ATTACHMENT_CATALOG.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<string, AttachmentFlyweight>
  )
);

export function getAttachmentsForWeaponCategory(
  category: WeaponCategory,
  slot?: AttachmentSlot
): AttachmentFlyweight[] {
  return ATTACHMENT_CATALOG.filter(
    (a) => a.compatibleCategories.includes(category) && (!slot || a.slot === slot)
  );
}

// --- TACTICAL EQUIPMENT FLYWEIGHTS (TRN-38) ---
export interface TacticalEquipmentSpec {
  readonly id: TacticalEquipmentId;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly bonusGrenades: number;
  readonly bonusC4: number;
  readonly bonusSquadMedCharges: number;
  readonly smokeCharges: number;
}

export const TACTICAL_EQUIPMENT_CATALOG: Readonly<Record<TacticalEquipmentId, TacticalEquipmentSpec>> =
  Object.freeze({
    frag_pack: Object.freeze({
      id: 'frag_pack',
      name: 'M67 Fragmentation Bandolier',
      shortName: 'Frag Pack',
      description: '+2 starting frag grenades for clearing fortified cover and bunkers.',
      bonusGrenades: 2,
      bonusC4: 0,
      bonusSquadMedCharges: 1,
      smokeCharges: 0,
    }),
    c4_breach_kit: Object.freeze({
      id: 'c4_breach_kit',
      name: 'C4 Demolition Breaching Kit',
      shortName: 'C4 Breach Kit',
      description: '+2 C4 demolition charges for AA relays, fuel depots, and armor traps.',
      bonusGrenades: 0,
      bonusC4: 2,
      bonusSquadMedCharges: 1,
      smokeCharges: 0,
    }),
    field_trauma_kit: Object.freeze({
      id: 'field_trauma_kit',
      name: 'Combat Trauma & Rescue Rig',
      shortName: 'Trauma Kit',
      description: '+3 squad rescue trauma charges and faster downed operator stabilization.',
      bonusGrenades: 0,
      bonusC4: 0,
      bonusSquadMedCharges: 3,
      smokeCharges: 1,
    }),
    smoke_conceal_kit: Object.freeze({
      id: 'smoke_conceal_kit',
      name: 'Thermal Smoke & Flanking Kit',
      shortName: 'Smoke Kit',
      description: '+2 smoke concealment canisters plus +1 grenade to break hostile LOS.',
      bonusGrenades: 1,
      bonusC4: 0,
      bonusSquadMedCharges: 2,
      smokeCharges: 2,
    }),
  });

// --- BUILT-IN ROLE LOADOUT PRESETS (TRN-38) ---
export const DEFAULT_ROLE_LOADOUT_PRESETS: readonly NamedLoadoutPreset[] = Object.freeze([
  Object.freeze({
    id: 'preset_assault',
    name: 'Assault Breacher',
    roleTag: 'assault',
    isBuiltIn: true,
    config: Object.freeze({
      primaryWeapon: 'assault_rifle',
      secondaryWeapon: 'shotgun',
      heavyWeapon: 'grenade_launcher',
      tacticalEquipment: 'frag_pack',
      squadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
    }) as MissionLoadoutConfig,
  }),
  Object.freeze({
    id: 'preset_engineer',
    name: 'Combat Engineer',
    roleTag: 'engineer',
    isBuiltIn: true,
    config: Object.freeze({
      primaryWeapon: 'lmg',
      secondaryWeapon: 'pistol',
      heavyWeapon: 'rocket_launcher',
      tacticalEquipment: 'c4_breach_kit',
      squadIds: ['bulwark_3', 'anvil_5', 'lifeline_6'],
    }) as MissionLoadoutConfig,
  }),
  Object.freeze({
    id: 'preset_anti_armor',
    name: 'Anti-Armor Specialist',
    roleTag: 'anti_armor',
    isBuiltIn: true,
    config: Object.freeze({
      primaryWeapon: 'assault_rifle',
      secondaryWeapon: 'smg',
      heavyWeapon: 'guided_missile',
      tacticalEquipment: 'c4_breach_kit',
      squadIds: ['anvil_5', 'bulwark_3', 'specter_4'],
    }) as MissionLoadoutConfig,
  }),
  Object.freeze({
    id: 'preset_recon',
    name: 'Night Recon Marksman',
    roleTag: 'recon',
    isBuiltIn: true,
    config: Object.freeze({
      primaryWeapon: 'sniper_rifle',
      secondaryWeapon: 'smg',
      heavyWeapon: 'guided_missile',
      tacticalEquipment: 'smoke_conceal_kit',
      squadIds: ['specter_4', 'vanguard_2', 'lifeline_6'],
    }) as MissionLoadoutConfig,
  }),
]);

// --- MISSION-SPECIFIC NON-BLOCKING RECOMMENDATIONS (TRN-38) ---
export interface MissionLoadoutRecommendation {
  readonly missionId: number;
  readonly suggestedPresetId: string;
  readonly summary: string;
  readonly terrainNote: string;
  readonly threatNote: string;
}

export const MISSION_LOADOUT_RECOMMENDATIONS: Readonly<Record<number, MissionLoadoutRecommendation>> =
  Object.freeze({
    1: Object.freeze({
      missionId: 1,
      suggestedPresetId: 'preset_assault',
      summary: 'Balanced rifle + CQB backup with Assault, Support, and Medic fireteam.',
      terrainNote: 'Multi-level urban avenues with rooftop overwatch and street barricades.',
      threatNote: 'Infantry squads, rooftop marksmen, AA relays, and gunship climax.',
    }),
    2: Object.freeze({
      missionId: 2,
      suggestedPresetId: 'preset_anti_armor',
      summary: 'Anti-armor launcher + C4 kit with Anvil-5 for convoy and bunker pushes.',
      terrainNote: 'Open highway convoy corridor transitioning into fortified fuel compound.',
      threatNote: 'Armored convoy vehicles, heavy juggernauts, and AT specialists.',
    }),
    3: Object.freeze({
      missionId: 3,
      suggestedPresetId: 'preset_recon',
      summary: 'Suppressed precision or SMG + FIM-92X guided launcher for night air defense.',
      terrainNote: 'Low-visibility searchlight plaza with elevated catwalks and cargo lifts.',
      threatNote: 'Drones, attack helicopters, thermal snipers, and searchlight sweeps.',
    }),
    4: Object.freeze({
      missionId: 4,
      suggestedPresetId: 'preset_engineer',
      summary: 'High-capacity suppression + demolition kit for river crossings and jungle bunkers.',
      terrainNote: 'Dense canopy, narrow bridges, and staggered watchtower elevations.',
      threatNote: 'Flanking jungle raiders, river gunboats/armor, and elevated ambush squads.',
    }),
    5: Object.freeze({
      missionId: 5,
      suggestedPresetId: 'preset_engineer',
      summary: 'Sustained firepower, guided ordnance, and Combat Trauma kit for final assault.',
      terrainNote: 'Industrial fortress foundry with molten hazards, lifts, and multi-tier catwalks.',
      threatNote: 'Combined arms: heavy armor, elite squads, air cover, and command climax.',
    }),
  });

// --- OPERATOR COSMETICS FLYWEIGHTS (TRN-40) ---
export interface OperatorCosmeticItem<T extends string> {
  readonly id: T;
  readonly name: string;
  readonly description: string;
  readonly primaryColorHex: number;
  readonly accentColorHex: number;
  readonly reqCost: number;
  readonly unlockHint: string;
  readonly unlockedByDefault?: boolean;
}

export const OPERATOR_CAMO_CATALOG: readonly OperatorCosmeticItem<OperatorCamoId>[] = Object.freeze([
  Object.freeze({
    id: 'obsidian_ops',
    name: 'Obsidian Standard',
    description: 'Baseline matte-slate Task Force Zero combat rig.',
    primaryColorHex: 0x26313d,
    accentColorHex: 0x38bdf8,
    reqCost: 0,
    unlockHint: 'Default issue',
    unlockedByDefault: true,
  }),
  Object.freeze({
    id: 'desert_sandstorm',
    name: 'Red Dust Arid',
    description: 'Weathered tan-ochre armor plates calibrated for desert convoy ops.',
    primaryColorHex: 0x8a7254,
    accentColorHex: 0xf59e0b,
    reqCost: 140,
    unlockHint: '140 REQ or Op 2 clear',
  }),
  Object.freeze({
    id: 'nightfall_slate',
    name: 'Nightfall Stealth',
    description: 'Low-albedo charcoal laminate built for nocturnal reconnaissance.',
    primaryColorHex: 0x181e29,
    accentColorHex: 0x22d3ee,
    reqCost: 180,
    unlockHint: '180 REQ or Op 3 clear',
  }),
  Object.freeze({
    id: 'viper_canopy',
    name: 'Viper Woodland',
    description: 'Deep olive tactical fatigues for jungle and river crossings.',
    primaryColorHex: 0x2e4234,
    accentColorHex: 0x84cc16,
    reqCost: 200,
    unlockHint: '200 REQ or Op 4 clear',
  }),
  Object.freeze({
    id: 'vanguard_carbon',
    name: 'Vanguard Carbon Elite',
    description: 'Reinforced carbon-graphite weave reserved for veteran commanders.',
    primaryColorHex: 0x1c1f26,
    accentColorHex: 0xfbbf24,
    reqCost: 320,
    unlockHint: '320 REQ or Mastery Commendation',
  }),
]);

export const OPERATOR_HELMET_CATALOG: readonly OperatorCosmeticItem<OperatorHelmetId>[] = Object.freeze([
  Object.freeze({
    id: 'standard_ops',
    name: 'FAST Tactical Shell',
    description: 'Standard ballistic helmet with comms headset.',
    primaryColorHex: 0x334155,
    accentColorHex: 0x38bdf8,
    reqCost: 0,
    unlockHint: 'Default issue',
    unlockedByDefault: true,
  }),
  Object.freeze({
    id: 'ballistic_visor',
    name: 'Amber Ballistic Visor',
    description: 'Reinforced wrap-around visor with HUD projection tint.',
    primaryColorHex: 0x27272a,
    accentColorHex: 0xf59e0b,
    reqCost: 150,
    unlockHint: '150 REQ',
  }),
  Object.freeze({
    id: 'recon_nvg',
    name: 'Quad-Tube NVG Mount',
    description: 'Panoramic night-vision optics rig for low-light operations.',
    primaryColorHex: 0x1e293b,
    accentColorHex: 0x34d399,
    reqCost: 210,
    unlockHint: '210 REQ',
  }),
  Object.freeze({
    id: 'heavy_breacher',
    name: 'Juggernaut Mandible Guard',
    description: 'Armored lower-face shield favored by point breachers.',
    primaryColorHex: 0x1f2937,
    accentColorHex: 0xef4444,
    reqCost: 260,
    unlockHint: '260 REQ',
  }),
]);

export const OPERATOR_PATCH_CATALOG: readonly OperatorCosmeticItem<OperatorPatchId>[] = Object.freeze([
  Object.freeze({
    id: 'task_force_zero',
    name: 'Task Force Zero',
    description: 'Official Vanguard spearhead shoulder insignia.',
    primaryColorHex: 0x0f172a,
    accentColorHex: 0x38bdf8,
    reqCost: 0,
    unlockHint: 'Default issue',
    unlockedByDefault: true,
  }),
  Object.freeze({
    id: 'iron_dawn_crest',
    name: 'Iron Dawn Crest',
    description: 'Awarded to operators who broke the urban AA grid.',
    primaryColorHex: 0x1e293b,
    accentColorHex: 0xf59e0b,
    reqCost: 100,
    unlockHint: '100 REQ',
  }),
  Object.freeze({
    id: 'desert_spear',
    name: 'Highway 14 Spear',
    description: 'Convoy hunter unit tab.',
    primaryColorHex: 0x451a03,
    accentColorHex: 0xfbbf24,
    reqCost: 120,
    unlockHint: '120 REQ',
  }),
  Object.freeze({
    id: 'night_owl',
    name: 'Midnight Overwatch',
    description: 'Nightfall radar-strike commendation patch.',
    primaryColorHex: 0x0f172a,
    accentColorHex: 0x22d3ee,
    reqCost: 140,
    unlockHint: '140 REQ',
  }),
  Object.freeze({
    id: 'apex_commander',
    name: 'Zero Hour Apex',
    description: 'Distinguished fireteam commander crest.',
    primaryColorHex: 0x18181b,
    accentColorHex: 0xeab308,
    reqCost: 240,
    unlockHint: '240 REQ',
  }),
]);
