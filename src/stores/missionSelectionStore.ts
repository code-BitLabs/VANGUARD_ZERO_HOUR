import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Difficulty, DifficultySchema } from '@/src/schemas/common.schema';

const CAMPAIGN_PREF_KEY = 'vanguard_zero_hour_campaign_pref_v1';

interface PersistedCampaignPref {
  selectedMissionId: number;
  difficulty: Difficulty;
  hasSeenCampaignBriefing: boolean;
}

function loadPersistedPref(): PersistedCampaignPref {
  try {
    const raw = localStorage.getItem(CAMPAIGN_PREF_KEY);
    if (!raw) {
      return { selectedMissionId: 1, difficulty: 'normal', hasSeenCampaignBriefing: false };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedCampaignPref>;
    const missionId =
      typeof parsed.selectedMissionId === 'number' &&
      parsed.selectedMissionId >= 1 &&
      parsed.selectedMissionId <= 5
        ? Math.floor(parsed.selectedMissionId)
        : 1;
    const diffRes = DifficultySchema.safeParse(parsed.difficulty);
    return {
      selectedMissionId: missionId,
      difficulty: diffRes.success ? diffRes.data : 'normal',
      hasSeenCampaignBriefing: Boolean(parsed.hasSeenCampaignBriefing),
    };
  } catch {
    return { selectedMissionId: 1, difficulty: 'normal', hasSeenCampaignBriefing: false };
  }
}

function savePersistedPref(pref: PersistedCampaignPref): void {
  try {
    localStorage.setItem(CAMPAIGN_PREF_KEY, JSON.stringify(pref));
  } catch {
    // Ignore storage failures
  }
}

export interface MissionSelectionState {
  selectedMissionId: number;
  difficulty: Difficulty;
  hasSeenCampaignBriefing: boolean;
  setSelectedMission: (id: number) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  markCampaignBriefingSeen: () => void;
}

const initial = loadPersistedPref();

export const missionSelectionStore = createStore<MissionSelectionState>()((set, get) => ({
  selectedMissionId: initial.selectedMissionId,
  difficulty: initial.difficulty,
  hasSeenCampaignBriefing: initial.hasSeenCampaignBriefing,
  setSelectedMission: (selectedMissionId) => {
    set({ selectedMissionId });
    savePersistedPref({
      selectedMissionId,
      difficulty: get().difficulty,
      hasSeenCampaignBriefing: get().hasSeenCampaignBriefing,
    });
  },
  setDifficulty: (difficulty) => {
    set({ difficulty });
    savePersistedPref({
      selectedMissionId: get().selectedMissionId,
      difficulty,
      hasSeenCampaignBriefing: get().hasSeenCampaignBriefing,
    });
  },
  markCampaignBriefingSeen: () => {
    if (get().hasSeenCampaignBriefing) return;
    set({ hasSeenCampaignBriefing: true });
    savePersistedPref({
      selectedMissionId: get().selectedMissionId,
      difficulty: get().difficulty,
      hasSeenCampaignBriefing: true,
    });
  },
}));

export function useMissionSelectionStore<T>(selector: (state: MissionSelectionState) => T): T {
  return useStore(missionSelectionStore, selector);
}
