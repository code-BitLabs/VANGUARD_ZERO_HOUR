import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Difficulty } from '@/src/schemas/common.schema';

export interface MissionSelectionState {
  selectedMissionId: number;
  difficulty: Difficulty;
  setSelectedMission: (id: number) => void;
  setDifficulty: (difficulty: Difficulty) => void;
}

export const missionSelectionStore = createStore<MissionSelectionState>()((set) => ({
  selectedMissionId: 1,
  difficulty: 'normal',
  setSelectedMission: (selectedMissionId) => set({ selectedMissionId }),
  setDifficulty: (difficulty) => set({ difficulty }),
}));

export function useMissionSelectionStore<T>(selector: (state: MissionSelectionState) => T): T {
  return useStore(missionSelectionStore, selector);
}
