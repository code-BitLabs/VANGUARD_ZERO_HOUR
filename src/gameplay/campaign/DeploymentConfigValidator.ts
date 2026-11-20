import { getMissionById } from '@/src/data/missions';
import { resolveDeployableFireteam } from '@/src/data/squadRoster';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import {
  DeploymentMode,
  InitialFormation,
  MissionLoadoutConfig,
  ReplayMode,
  SquadOperatorRecord,
  SquadRoleId,
} from '@/src/schemas/campaign.schema';
import { Difficulty } from '@/src/schemas/common.schema';
import theaterUrbanDawnImg from '@/src/assets/images/theater_urban_dawn_1795162698497.jpg';
import theaterDesertConvoyImg from '@/src/assets/images/theater_desert_convoy_1795162698073.jpg';
import theaterNightFoundryImg from '@/src/assets/images/theater_night_foundry_1795162697888.jpg';

export interface MissionArtworkDescriptor {
  imageSrc: string;
  alt: string;
  theaterLabel: string;
  weatherLabel: string;
  lightingLabel: string;
  fallbackGradient: string;
}

export function resolveMissionPreviewArtwork(missionId: number): MissionArtworkDescriptor {
  switch (missionId) {
    case 1:
      return {
        imageSrc: theaterUrbanDawnImg,
        alt: 'Operation Iron Dawn urban financial district at daybreak',
        theaterLabel: 'Urban Financial District',
        weatherLabel: 'Clear Dawn Haze',
        lightingLabel: 'Daybreak',
        fallbackGradient: 'linear-gradient(135deg, #1b2838 0%, #2a3a4d 48%, #523b24 100%)',
      };
    case 2:
      return {
        imageSrc: theaterDesertConvoyImg,
        alt: 'Operation Red Dust desert highway and oil refinery depot',
        theaterLabel: 'Arid Highway & Refinery',
        weatherLabel: 'Dry Dust Winds',
        lightingLabel: 'Harsh Noon',
        fallbackGradient: 'linear-gradient(135deg, #2d2118 0%, #5c3d24 52%, #1d2229 100%)',
      };
    case 3:
      return {
        imageSrc: theaterNightFoundryImg,
        alt: 'Operation Nightfall floodlit coastal radar plaza at midnight',
        theaterLabel: 'Coastal Radar Complex',
        weatherLabel: 'Midnight Fog',
        lightingLabel: 'Night Searchlights',
        fallbackGradient: 'linear-gradient(135deg, #0d1624 0%, #162944 50%, #101720 100%)',
      };
    case 4:
      return {
        imageSrc: theaterDesertConvoyImg,
        alt: 'Operation Viper Canopy river valley bridgehead and ridge',
        theaterLabel: 'River Valley Bridgehead',
        weatherLabel: 'Humid Overcast',
        lightingLabel: 'Canopy Twilight',
        fallbackGradient: 'linear-gradient(135deg, #14261f 0%, #213d30 50%, #131c1e 100%)',
      };
    case 5:
    default:
      return {
        imageSrc: theaterNightFoundryImg,
        alt: 'Operation Blackout heavy industrial steel foundry fortress at night',
        theaterLabel: 'Industrial Foundry Fortress',
        weatherLabel: 'Ash & Slag Glow',
        lightingLabel: 'Night Industrial',
        fallbackGradient: 'linear-gradient(135deg, #1e1416 0%, #3d2118 52%, #101318 100%)',
      };
  }
}

export interface FormationTacticalProfile {
  id: InitialFormation;
  label: string;
  shortTag: string;
  implication: string;
  bestFor: string;
}

export const FORMATION_TACTICAL_PROFILES: readonly FormationTacticalProfile[] = [
  {
    id: 'WEDGE',
    label: 'Wedge',
    shortTag: 'BALANCED',
    implication: 'Balanced forward firepower with clear flanking sightlines and low crossfire risk.',
    bestFor: 'Open streets, desert highways, and versatile pushes.',
  },
  {
    id: 'COLUMN',
    label: 'Column',
    shortTag: 'CORRIDOR',
    implication: 'Tight single-file movement through chokepoints, bridges, and narrow alleys.',
    bestFor: 'Alleys, bridges, and foundry catwalk approaches.',
  },
  {
    id: 'LINE',
    label: 'Line',
    shortTag: 'SUPPRESSION',
    implication: 'Wide firing arc maximizing forward suppression across broad avenues or plazas.',
    bestFor: 'Holding defensive perimeters and suppressing exposed squads.',
  },
  {
    id: 'COMPACT',
    label: 'Compact',
    shortTag: 'CLOSE GUARD',
    implication: 'Tight perimeter around the commander for rapid revives and CQB room clearing.',
    bestFor: 'Night plazas, ambushes, and close-quarters extraction.',
  },
];

export interface SquadCompositionPreset {
  id: 'assault_spearhead' | 'support_anchor' | 'recon_overwatch' | 'anti_armor_strike';
  name: string;
  tagline: string;
  preferredRoles: readonly [SquadRoleId, SquadRoleId, SquadRoleId];
  defaultFormation: InitialFormation;
}

export const SQUAD_COMPOSITION_PRESETS: readonly SquadCompositionPreset[] = [
  {
    id: 'assault_spearhead',
    name: 'Assault Spearhead',
    tagline: 'Frontline breacher, heavy suppressor, and combat medic.',
    preferredRoles: ['assault', 'support', 'medic'],
    defaultFormation: 'WEDGE',
  },
  {
    id: 'support_anchor',
    name: 'Support & Sustain',
    tagline: 'Sustained fire superiority with dual protection and triage.',
    preferredRoles: ['support', 'medic', 'anti_armor'],
    defaultFormation: 'LINE',
  },
  {
    id: 'recon_overwatch',
    name: 'Recon Overwatch',
    tagline: 'Long-range target marking, flanking assault, and rapid sustain.',
    preferredRoles: ['recon', 'assault', 'medic'],
    defaultFormation: 'COLUMN',
  },
  {
    id: 'anti_armor_strike',
    name: 'Anti-Armor Strike',
    tagline: 'Dedicated vehicle and heavy-armor elimination with flank cover.',
    preferredRoles: ['anti_armor', 'support', 'recon'],
    defaultFormation: 'WEDGE',
  },
];

export function resolveSquadPresetIds(
  presetId: SquadCompositionPreset['id'],
  roster: readonly SquadOperatorRecord[]
): { squadIds: string[]; missingRoles: SquadRoleId[]; formation: InitialFormation } {
  const preset =
    SQUAD_COMPOSITION_PRESETS.find((p) => p.id === presetId) ?? SQUAD_COMPOSITION_PRESETS[0];
  const activeOps = roster.filter((op) => op.status === 'active');
  const chosen: string[] = [];
  const missingRoles: SquadRoleId[] = [];

  for (const role of preset.preferredRoles) {
    const match = activeOps.find((op) => op.role === role && !chosen.includes(op.id));
    if (match) {
      chosen.push(match.id);
    } else {
      missingRoles.push(role);
    }
  }

  for (const op of activeOps) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(op.id)) {
      chosen.push(op.id);
    }
  }

  return {
    squadIds: chosen,
    missingRoles,
    formation: preset.defaultFormation,
  };
}

export interface SoloMissionPreparationSummary {
  missionId: number;
  recommendedPrimaryRole: string;
  tacticalBrief: string;
  soloBonusCaches: number;
  traumaCharges: number;
  pacingSummary: string;
}

export function getSoloMissionPreparationSummary(missionId: number): SoloMissionPreparationSummary {
  switch (missionId) {
    case 1:
      return {
        missionId: 1,
        recommendedPrimaryRole: 'Mid-range Carbine + Anti-Air Rocket',
        tacticalBrief:
          'Use financial district colonnades to break sightlines before disabling the rooftop AA relays.',
        soloBonusCaches: 2,
        traumaCharges: 1,
        pacingSummary: 'Staggered urban pushes; max 1 enemy squad focuses you at once.',
      };
    case 2:
      return {
        missionId: 2,
        recommendedPrimaryRole: 'Precision Rifle + Anti-Armor Launcher',
        tacticalBrief:
          'Ambush the Highway 14 convoy from elevated desert berms before breaching the refinery fuel yard.',
        soloBonusCaches: 2,
        traumaCharges: 1,
        pacingSummary: 'Spaced convoy escorts with extra cover supply caches near the refinery.',
      };
    case 3:
      return {
        missionId: 3,
        recommendedPrimaryRole: 'Suppressed Carbine/SMG + Guided Missile',
        tacticalBrief:
          'Shoot out sweeping searchlight towers first to deny midnight spotter triangulation.',
        soloBonusCaches: 2,
        traumaCharges: 1,
        pacingSummary: 'Measured night reinforcement waves with longer tactical breathers.',
      };
    case 4:
      return {
        missionId: 4,
        recommendedPrimaryRole: 'Versatile Rifle + High-Impact Heavy',
        tacticalBrief:
          'Hold north-bank bridgehead cover during the treeline ambush and clear sniper ridges deliberately.',
        soloBonusCaches: 2,
        traumaCharges: 1,
        pacingSummary: 'Throttled flanking pressure across the bridge crossing.',
      };
    case 5:
    default:
      return {
        missionId: 5,
        recommendedPrimaryRole: 'High-Capacity Rifle/LMG + Heavy AT',
        tacticalBrief:
          'Avoid molten slag vats, pace juggernaut engagements around pillars, and sprint north at extraction.',
        soloBonusCaches: 3,
        traumaCharges: 1,
        pacingSummary: 'Controlled siege pacing with 3 finite foundry sustainment caches.',
      };
  }
}

export interface DeploymentValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  fixStep: 1 | 2 | 3;
}

export interface DeploymentValidationResult {
  canDeploy: boolean;
  issues: DeploymentValidationIssue[];
  resolvedFireteamCallsigns: string[];
  reserveCount: number;
  substitutedNames: string[];
  sanitizedSquadIds: string[];
}

export function validateDeploymentConfig(params: {
  missionId: number;
  deploymentMode: DeploymentMode;
  difficulty: Difficulty;
  replayMode: ReplayMode;
  loadout: MissionLoadoutConfig;
  roster: readonly SquadOperatorRecord[];
  hasConfirmedDeploymentMode: boolean;
}): DeploymentValidationResult {
  const issues: DeploymentValidationIssue[] = [];
  const mission = getMissionById(params.missionId);
  if (!mission) {
    issues.push({
      severity: 'error',
      code: 'INVALID_MISSION',
      message: 'Selected operation is invalid.',
      fixStep: 1,
    });
  }

  if (!params.hasConfirmedDeploymentMode) {
    issues.push({
      severity: 'warning',
      code: 'MODE_UNCONFIRMED',
      message: 'Confirm Solo Operator or Fireteam play style before deploying.',
      fixStep: 2,
    });
  }

  if (!WEAPON_BY_ID[params.loadout.primaryWeapon]) {
    issues.push({
      severity: 'error',
      code: 'INVALID_PRIMARY',
      message: 'Primary weapon selection is missing.',
      fixStep: 3,
    });
  }
  if (!WEAPON_BY_ID[params.loadout.secondaryWeapon]) {
    issues.push({
      severity: 'error',
      code: 'INVALID_SECONDARY',
      message: 'Secondary weapon selection is missing.',
      fixStep: 3,
    });
  }
  if (!WEAPON_BY_ID[params.loadout.heavyWeapon]) {
    issues.push({
      severity: 'error',
      code: 'INVALID_HEAVY',
      message: 'Heavy weapon selection is missing.',
      fixStep: 3,
    });
  }

  if (params.deploymentMode === 'solo') {
    const recoveringCount = params.roster.filter((op) => op.status === 'recovering').length;
    if (recoveringCount > 0 && params.replayMode !== 'clean_replay') {
      issues.push({
        severity: 'warning',
        code: 'SOLO_HQ_RECOVERY_INFO',
        message: `${recoveringCount} recovering Fireteam operator${recoveringCount > 1 ? 's' : ''} will continue resting safely at HQ during this Solo operation.`,
        fixStep: 2,
      });
    }
    return {
      canDeploy: !issues.some((i) => i.severity === 'error'),
      issues,
      resolvedFireteamCallsigns: [],
      reserveCount: 0,
      substitutedNames: [],
      sanitizedSquadIds: [],
    };
  }

  // Fireteam validation: dedupe, reject recovering/KIA, enforce max 3, transparent reserve backfill
  const uniqueIds = Array.from(new Set(params.loadout.squadIds)).slice(0, 3);
  if (uniqueIds.length !== params.loadout.squadIds.length) {
    issues.push({
      severity: 'warning',
      code: 'DUPLICATE_SQUAD_DEDUPED',
      message: 'Duplicate operator slots were automatically normalized.',
      fixStep: 3,
    });
  }

  const ineligible = uniqueIds.filter((id) => {
    const op = params.roster.find((r) => r.id === id);
    return !op || op.status !== 'active';
  });
  if (ineligible.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'INELIGIBLE_OPERATORS_SUBSTITUTED',
      message: `${ineligible.length} selected operator${ineligible.length > 1 ? 's are' : ' is'} unavailable and will be backfilled by active or reserve specialists.`,
      fixStep: 3,
    });
  }

  const eligibleSelected = uniqueIds.filter((id) => {
    const op = params.roster.find((r) => r.id === id);
    return Boolean(op && op.status === 'active');
  });

  const resolved = resolveDeployableFireteam(params.roster, eligibleSelected, 3);
  if (resolved.reserveCount > 0) {
    issues.push({
      severity: 'warning',
      code: 'RESERVE_BACKFILL_ACTIVE',
      message: `${resolved.reserveCount} Tactical Reserve specialist${resolved.reserveCount > 1 ? 's' : ''} assigned to maintain a full 3-operator fireteam.`,
      fixStep: 3,
    });
  }

  return {
    canDeploy: !issues.some((i) => i.severity === 'error'),
    issues,
    resolvedFireteamCallsigns: resolved.operators.map((op) => op.callsign),
    reserveCount: resolved.reserveCount,
    substitutedNames: resolved.substitutedNames,
    sanitizedSquadIds: resolved.operators.map((op) => op.id),
  };
}
