import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Difficulty, DifficultySchema } from '@/src/schemas/common.schema';

const CAMPAIGN_PREF_KEY = 'vanguard_zero_hour_campaign_pref_v1';

interface PersistedCampaignPref {
  selectedMissionId: number;
  difficulty: Difficulty;
  hasSeenCampaignBriefing: boolean;
  seenMissionBriefings: Record<string, string>;
  hasSeenVehicleControlHint: boolean;
}

function loadPersistedPref(): PersistedCampaignPref {
  try {
    const raw = localStorage.getItem(CAMPAIGN_PREF_KEY);
    if (!raw) {
      return {
        selectedMissionId: 1,
        difficulty: 'normal',
        hasSeenCampaignBriefing: false,
        seenMissionBriefings: {},
        hasSeenVehicleControlHint: false,
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedCampaignPref>;
    const missionId =
      typeof parsed.selectedMissionId === 'number' &&
      parsed.selectedMissionId >= 1 &&
      parsed.selectedMissionId <= 5
        ? Math.floor(parsed.selectedMissionId)
        : 1;
    const diffRes = DifficultySchema.safeParse(parsed.difficulty);
    const seenMap: Record<string, string> = {};
    if (parsed.seenMissionBriefings && typeof parsed.seenMissionBriefings === 'object') {
      for (const [k, v] of Object.entries(parsed.seenMissionBriefings)) {
        if (typeof v === 'string' && v.length > 0) {
          seenMap[k] = v;
        }
      }
    }
    return {
      selectedMissionId: missionId,
      difficulty: diffRes.success ? diffRes.data : 'normal',
      hasSeenCampaignBriefing: Boolean(parsed.hasSeenCampaignBriefing),
      seenMissionBriefings: seenMap,
      hasSeenVehicleControlHint: Boolean(parsed.hasSeenVehicleControlHint),
    };
  } catch {
    return {
      selectedMissionId: 1,
      difficulty: 'normal',
      hasSeenCampaignBriefing: false,
      seenMissionBriefings: {},
      hasSeenVehicleControlHint: false,
    };
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
  seenMissionBriefings: Record<string, string>;
  hasSeenVehicleControlHint: boolean;
  setSelectedMission: (id: number) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  markCampaignBriefingSeen: () => void;
  hasSeenMissionBriefing: (missionKey: string, briefingVersion: string) => boolean;
  markMissionBriefingSeen: (missionKey: string, briefingVersion: string) => void;
  markVehicleControlHintSeen: () => void;
}

const initial = loadPersistedPref();

function persistFromState(state: MissionSelectionState): void {
  savePersistedPref({
    selectedMissionId: state.selectedMissionId,
    difficulty: state.difficulty,
    hasSeenCampaignBriefing: state.hasSeenCampaignBriefing,
    seenMissionBriefings: state.seenMissionBriefings,
    hasSeenVehicleControlHint: state.hasSeenVehicleControlHint,
  });
}

export const missionSelectionStore = createStore<MissionSelectionState>()((set, get) => ({
  selectedMissionId: initial.selectedMissionId,
  difficulty: initial.difficulty,
  hasSeenCampaignBriefing: initial.hasSeenCampaignBriefing,
  seenMissionBriefings: initial.seenMissionBriefings,
  hasSeenVehicleControlHint: initial.hasSeenVehicleControlHint,
  setSelectedMission: (selectedMissionId) => {
    set({ selectedMissionId });
    persistFromState(get());
  },
  setDifficulty: (difficulty) => {
    set({ difficulty });
    persistFromState(get());
  },
  markCampaignBriefingSeen: () => {
    if (get().hasSeenCampaignBriefing) return;
    set({ hasSeenCampaignBriefing: true });
    persistFromState(get());
  },
  hasSeenMissionBriefing: (missionKey, briefingVersion) => {
    return get().seenMissionBriefings[missionKey] === briefingVersion;
  },
  markMissionBriefingSeen: (missionKey, briefingVersion) => {
    const cur = get().seenMissionBriefings;
    if (cur[missionKey] === briefingVersion) return;
    const nextMap = { ...cur, [missionKey]: briefingVersion };
    set({ seenMissionBriefings: nextMap, hasSeenCampaignBriefing: true });
    persistFromState(get());
  },
  markVehicleControlHintSeen: () => {
    if (get().hasSeenVehicleControlHint) return;
    set({ hasSeenVehicleControlHint: true });
    persistFromState(get());
  },
}));

export function useMissionSelectionStore<T>(selector: (state: MissionSelectionState) => T): T {
  return useStore(missionSelectionStore, selector);
}
