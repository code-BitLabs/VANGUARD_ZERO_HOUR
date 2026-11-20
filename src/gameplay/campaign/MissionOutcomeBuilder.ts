import { CampaignEventDraft } from './CampaignEventLedger';
import { SquadOperatorMissionReport } from '@/src/stores/progressionStore';

/**
 * Pure mission-completion consequence mapper (TRN-39).
 * Translates completed mission outcomes, optional tactical objectives, and squad survival
 * into structured, deterministic CampaignEventDrafts without bloating GameEngine.
 */
export function buildMissionCampaignEventDrafts(params: {
  missionId: number;
  victory: boolean;
  optionalObjectivesCompleted: number;
  completedOptionalIds: readonly string[];
  allSearchlightsDisabled: boolean;
  squadReports: readonly SquadOperatorMissionReport[];
}): CampaignEventDraft[] {
  if (!params.victory) return [];
  const drafts: CampaignEventDraft[] = [];

  if (params.missionId === 1) {
    drafts.push({
      eventId: 'op1_comms_destroyed',
      missionId: 1,
      outcome: 'achieved',
      summary: 'Urban AA relay communications neutralized during Operation Iron Dawn.',
    });
    drafts.push({
      eventId: 'op1_intel_secured',
      missionId: 1,
      outcome: params.optionalObjectivesCompleted >= 1 ? 'achieved' : 'bypassed',
      summary:
        params.optionalObjectivesCompleted >= 1
          ? 'Secondary technical & urban recon intel captured for Highway 14.'
          : 'Secondary urban recon skipped — Highway 14 inner garrison remains unverified.',
    });
  } else if (params.missionId === 2) {
    drafts.push({
      eventId: 'op2_convoy_neutralized',
      missionId: 2,
      outcome: 'achieved',
      summary: 'Highway 14 armored convoy neutralized.',
    });
    drafts.push({
      eventId: 'op2_fuel_cache_secured',
      missionId: 2,
      outcome: 'achieved',
      summary: 'Refinery fuel & munitions reserves seized for downstream operations.',
    });
    drafts.push({
      eventId: 'op2_bunker_intel_captured',
      missionId: 2,
      outcome: params.optionalObjectivesCompleted >= 1 ? 'achieved' : 'bypassed',
      summary:
        params.optionalObjectivesCompleted >= 1
          ? 'Refinery cipher logs extracted — Nightfall elevated defenses mapped.'
          : 'Refinery cipher bypassed — Nightfall thermal scans stay unconfirmed.',
    });
  } else if (params.missionId === 3) {
    drafts.push({
      eventId: 'op3_radar_network_disabled',
      missionId: 3,
      outcome: 'achieved',
      summary: 'Nightfall air-defense radar grid blinded across downstream sectors.',
    });
    drafts.push({
      eventId: 'op3_searchlights_blacked_out',
      missionId: 3,
      outcome: params.allSearchlightsDisabled ? 'achieved' : 'bypassed',
      summary: params.allSearchlightsDisabled
        ? 'All Nightfall searchlight towers destroyed.'
        : 'Searchlight perimeter left partially intact.',
    });
  } else if (params.missionId === 4) {
    drafts.push({
      eventId: 'op4_river_watchtowers_cleared',
      missionId: 4,
      outcome: 'achieved',
      summary: 'Viper Canopy river bridgeheads and watchtowers secured.',
    });
    drafts.push({
      eventId: 'op4_jungle_cache_secured',
      missionId: 4,
      outcome: 'achieved',
      summary: 'Forward canopy supply cache recovered for final foundry assault.',
    });
    drafts.push({
      eventId: 'op4_comms_jammer_planted',
      missionId: 4,
      outcome: params.optionalObjectivesCompleted >= 1 ? 'achieved' : 'bypassed',
      summary:
        params.optionalObjectivesCompleted >= 1
          ? 'Jungle relay jammer deployed — Blackout QRF coordination degraded.'
          : 'Relay jammer skipped — Blackout QRF retains baseline response speed.',
    });
  } else if (params.missionId === 5) {
    drafts.push({
      eventId: 'op5_command_core_neutralized',
      missionId: 5,
      outcome: 'achieved',
      summary: 'Operation Blackout foundry command core neutralized.',
    });
  }

  // Record squad survival & casualty milestones
  const anyMia = params.squadReports.some((r) => r.becameMia);
  for (const r of params.squadReports) {
    if (r.becameMia) {
      drafts.push({
        eventId: 'squad_operator_mia',
        missionId: params.missionId,
        outcome: 'failed',
        operatorId: r.operatorId,
        summary: `${r.callsign} extracted MIA during Operation ${params.missionId}.`,
      });
    } else if (r.timesDowned > 0 && r.survived) {
      drafts.push({
        eventId: 'squad_operator_rescued',
        missionId: params.missionId,
        outcome: 'achieved',
        operatorId: r.operatorId,
        summary: `${r.callsign} rescued under fire during Operation ${params.missionId}.`,
      });
    }
  }
  if (!anyMia && params.squadReports.length > 0) {
    drafts.push({
      eventId: 'squad_clean_sweep',
      missionId: params.missionId,
      outcome: 'achieved',
      summary: `Full fireteam extracted without MIA casualties in Operation ${params.missionId}.`,
    });
  }

  return drafts;
}
