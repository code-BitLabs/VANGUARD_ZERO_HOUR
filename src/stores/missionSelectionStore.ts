import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import {
  DeploymentMode,
  DeploymentModeSchema,
  ReplayMode,
  ReplayModeSchema,
} from '@/src/schemas/campaign.schema';
import { Difficulty, DifficultySchema } from '@/src/schemas/common.schema';
import { safeGetItem, safeSetItem } from '@/src/storage/safeStorage';

const CAMPAIGN_PREF_KEY = 'vanguard_zero_hour_campaign_pref_v1';

interface PersistedCampaignPref {
  selectedMissionId: number;
  difficulty: Difficulty;
  replayMode: ReplayMode;
  deploymentMode: DeploymentMode;
  missionDeploymentModes: Record<string, DeploymentMode>;
  hasConfirmedDeploymentMode: boolean;
  hasSeenCampaignBriefing: boolean;
  seenMissionBriefings: Record<string, string>;
  hasSeenVehicleControlHint: boolean;
  dismissedHintIds: Record<string, boolean>;
}

const DEFAULT_PERSISTED_PREF: PersistedCampaignPref = {
  selectedMissionId: 1,
  difficulty: 'normal',
  replayMode: 'canonical',
  deploymentMode: 'fireteam',
  missionDeploymentModes: {},
  hasConfirmedDeploymentMode: false,
  hasSeenCampaignBriefing: false,
  seenMissionBriefings: {},
  hasSeenVehicleControlHint: false,
  dismissedHintIds: {},
};

function loadPersistedPref(): PersistedCampaignPref {
  try {
    const raw = safeGetItem(CAMPAIGN_PREF_KEY);
    if (!raw) {
      return {
        ...DEFAULT_PERSISTED_PREF,
        missionDeploymentModes: {},
        seenMissionBriefings: {},
        dismissedHintIds: {},
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
    const replayRes = ReplayModeSchema.safeParse(parsed.replayMode);
    const modeRes = DeploymentModeSchema.safeParse(parsed.deploymentMode);
    const modeMap: Record<string, DeploymentMode> = {};
    if (parsed.missionDeploymentModes && typeof parsed.missionDeploymentModes === 'object') {
      for (const [k, v] of Object.entries(parsed.missionDeploymentModes)) {
        const res = DeploymentModeSchema.safeParse(v);
        if (res.success) {
          modeMap[k] = res.data;
        }
      }
    }
    const seenMap: Record<string, string> = {};
    if (parsed.seenMissionBriefings && typeof parsed.seenMissionBriefings === 'object') {
      for (const [k, v] of Object.entries(parsed.seenMissionBriefings)) {
        if (typeof v === 'string' && v.length > 0) {
          seenMap[k] = v;
        }
      }
    }
    const dismissedMap: Record<string, boolean> = {};
    if (parsed.dismissedHintIds && typeof parsed.dismissedHintIds === 'object') {
      for (const [k, v] of Object.entries(parsed.dismissedHintIds)) {
        if (Boolean(v)) {
          dismissedMap[k] = true;
        }
      }
    }
    return {
      selectedMissionId: missionId,
      difficulty: diffRes.success ? diffRes.data : 'normal',
      replayMode: replayRes.success ? replayRes.data : 'canonical',
      deploymentMode: modeRes.success ? modeRes.data : 'fireteam',
      missionDeploymentModes: modeMap,
      hasConfirmedDeploymentMode: Boolean(parsed.hasConfirmedDeploymentMode),
      hasSeenCampaignBriefing: Boolean(parsed.hasSeenCampaignBriefing),
      seenMissionBriefings: seenMap,
      hasSeenVehicleControlHint: Boolean(parsed.hasSeenVehicleControlHint),
      dismissedHintIds: dismissedMap,
    };
  } catch {
    return {
      ...DEFAULT_PERSISTED_PREF,
      missionDeploymentModes: {},
      seenMissionBriefings: {},
      dismissedHintIds: {},
    };
  }
}

function savePersistedPref(pref: PersistedCampaignPref): void {
  try {
    safeSetItem(CAMPAIGN_PREF_KEY, JSON.stringify(pref));
  } catch {
    // Ignore storage failures
  }
}

export interface MissionSelectionState {
  selectedMissionId: number;
  difficulty: Difficulty;
  replayMode: ReplayMode;
  deploymentMode: DeploymentMode;
  missionDeploymentModes: Record<string, DeploymentMode>;
  hasConfirmedDeploymentMode: boolean;
  hasSeenCampaignBriefing: boolean;
  seenMissionBriefings: Record<string, string>;
  hasSeenVehicleControlHint: boolean;
  dismissedHintIds: Record<string, boolean>;
  setSelectedMission: (id: number) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  setReplayMode: (mode: ReplayMode) => void;
  setDeploymentMode: (mode: DeploymentMode, missionId?: number) => void;
  confirmDeploymentMode: (mode: DeploymentMode, missionId?: number) => void;
  getDeploymentModeForMission: (missionId: number) => DeploymentMode;
  reloadPersistedPrefs: () => void;
  markCampaignBriefingSeen: () => void;
  hasSeenMissionBriefing: (missionKey: string, briefingVersion: string) => boolean;
  markMissionBriefingSeen: (missionKey: string, briefingVersion: string) => void;
  markVehicleControlHintSeen: () => void;
  dismissTacticalHint: (hintId: string) => void;
  isTacticalHintDismissed: (hintId: string) => boolean;
  resetDismissedHints: () => void;
}

const initial = loadPersistedPref();

function persistFromState(state: MissionSelectionState): void {
  savePersistedPref({
    selectedMissionId: state.selectedMissionId,
    difficulty: state.difficulty,
    replayMode: state.replayMode,
    deploymentMode: state.deploymentMode,
    missionDeploymentModes: state.missionDeploymentModes,
    hasConfirmedDeploymentMode: state.hasConfirmedDeploymentMode,
    hasSeenCampaignBriefing: state.hasSeenCampaignBriefing,
    seenMissionBriefings: state.seenMissionBriefings,
    hasSeenVehicleControlHint: state.hasSeenVehicleControlHint,
    dismissedHintIds: state.dismissedHintIds,
  });
}

export const missionSelectionStore = createStore<MissionSelectionState>()((set, get) => ({
  selectedMissionId: initial.selectedMissionId,
  difficulty: initial.difficulty,
  replayMode: initial.replayMode,
  deploymentMode: initial.deploymentMode,
  missionDeploymentModes: initial.missionDeploymentModes,
  hasConfirmedDeploymentMode: initial.hasConfirmedDeploymentMode,
  hasSeenCampaignBriefing: initial.hasSeenCampaignBriefing,
  seenMissionBriefings: initial.seenMissionBriefings,
  hasSeenVehicleControlHint: initial.hasSeenVehicleControlHint,
  dismissedHintIds: initial.dismissedHintIds,
  setSelectedMission: (selectedMissionId) => {
    const state = get();
    const override = state.missionDeploymentModes[String(selectedMissionId)];
    set({
      selectedMissionId,
      deploymentMode: override ?? state.deploymentMode,
    });
    persistFromState(get());
  },
  setDifficulty: (difficulty) => {
    set({ difficulty });
    persistFromState(get());
  },
  setReplayMode: (replayMode) => {
    set({ replayMode });
    persistFromState(get());
  },
  setDeploymentMode: (mode, missionId) => {
    const targetMission = missionId ?? get().selectedMissionId;
    const nextOverrides = {
      ...get().missionDeploymentModes,
      [String(targetMission)]: mode,
    };
    set({
      deploymentMode: mode,
      missionDeploymentModes: nextOverrides,
    });
    persistFromState(get());
  },
  confirmDeploymentMode: (mode, missionId) => {
    const targetMission = missionId ?? get().selectedMissionId;
    const nextOverrides = {
      ...get().missionDeploymentModes,
      [String(targetMission)]: mode,
    };
    set({
      deploymentMode: mode,
      missionDeploymentModes: nextOverrides,
      hasConfirmedDeploymentMode: true,
    });
    persistFromState(get());
  },
  getDeploymentModeForMission: (missionId) => {
    const state = get();
    return state.missionDeploymentModes[String(missionId)] ?? state.deploymentMode;
  },
  reloadPersistedPrefs: () => {
    const fresh = loadPersistedPref();
    set({
      selectedMissionId: fresh.selectedMissionId,
      difficulty: fresh.difficulty,
      replayMode: fresh.replayMode,
      deploymentMode: fresh.deploymentMode,
      missionDeploymentModes: fresh.missionDeploymentModes,
      hasConfirmedDeploymentMode: fresh.hasConfirmedDeploymentMode,
      hasSeenCampaignBriefing: fresh.hasSeenCampaignBriefing,
      seenMissionBriefings: fresh.seenMissionBriefings,
      hasSeenVehicleControlHint: fresh.hasSeenVehicleControlHint,
      dismissedHintIds: fresh.dismissedHintIds,
    });
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
  dismissTacticalHint: (hintId) => {
    if (get().dismissedHintIds[hintId]) return;
    const nextDismissed = { ...get().dismissedHintIds, [hintId]: true };
    set({ dismissedHintIds: nextDismissed });
    persistFromState(get());
  },
  isTacticalHintDismissed: (hintId) => {
    return Boolean(get().dismissedHintIds[hintId]);
  },
  resetDismissedHints: () => {
    set({ dismissedHintIds: {} });
    persistFromState(get());
  },
}));

export function useMissionSelectionStore<T>(selector: (state: MissionSelectionState) => T): T {
  return useStore(missionSelectionStore, selector);
}

