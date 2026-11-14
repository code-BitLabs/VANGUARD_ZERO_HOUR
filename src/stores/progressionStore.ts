import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Difficulty, MissionGrade } from '@/src/schemas/common.schema';
import { ProgressionSave } from '@/src/schemas/save.schema';
import { WeaponId, WeaponUpgradeKey } from '@/src/schemas/weapon.schema';
import { SaveManager } from '@/src/storage/SaveManager';

export interface MissionResultPayload {
  missionId: number;
  difficulty: Difficulty;
  victory: boolean;
  score: number;
  grade: MissionGrade;
  xpEarned: number;
  requisitionEarned: number;
  kills: number;
  headshots: number;
  airKills: number;
  durationSec: number;
}

export interface ProgressionStoreState {
  save: ProgressionSave;
  recoveredFromCorruption: boolean;
  migratedFromV1: boolean;
  recordMissionResult: (result: MissionResultPayload) => { newAchievements: string[] };
  upgradeWeapon: (weaponId: WeaponId, key: WeaponUpgradeKey) => boolean;
  spendRequisition: (amount: number) => boolean;
  getUpgradeLevel: (weaponId: WeaponId, key: WeaponUpgradeKey) => number;
  resetAllProgress: () => void;
}

const loaded = SaveManager.loadProgression();

export const UPGRADE_COSTS = [100, 180, 280, 420, 600] as const;

export const progressionStore = createStore<ProgressionStoreState>()(
  subscribeWithSelector((set, get) => ({
    save: loaded.save,
    recoveredFromCorruption: loaded.recoveredFromCorruption,
    migratedFromV1: loaded.migratedFromV1,
    getUpgradeLevel: (weaponId, key) => {
      return get().save.weaponUpgrades[weaponId]?.[key] ?? 0;
    },
    spendRequisition: (amount) => {
      if (amount <= 0) return true;
      const current = get().save;
      if (current.requisitionPoints < amount) return false;
      const nextSave: ProgressionSave = {
        ...current,
        requisitionPoints: current.requisitionPoints - amount,
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return true;
    },
    upgradeWeapon: (weaponId, key) => {
      const current = get().save;
      const curLevels = current.weaponUpgrades[weaponId] ?? {
        damage: 0,
        recoil: 0,
        capacity: 0,
        reload: 0,
      };
      const level = curLevels[key] ?? 0;
      if (level >= 5) return false;
      const cost = UPGRADE_COSTS[level];
      if (current.requisitionPoints < cost) return false;

      const nextSave: ProgressionSave = {
        ...current,
        requisitionPoints: current.requisitionPoints - cost,
        weaponUpgrades: {
          ...current.weaponUpgrades,
          [weaponId]: {
            ...curLevels,
            [key]: level + 1,
          },
        },
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return true;
    },
    recordMissionResult: (result) => {
      const current = get().save;
      const key = String(result.missionId);
      const prevRec = current.missionRecords[key] ?? {
        missionId: result.missionId,
        completed: false,
        bestScore: 0,
        bestHeadshots: 0,
      };

      const gradeRank: Record<MissionGrade, number> = { S: 4, A: 3, B: 2, C: 1 };
      const prevGradeRank = prevRec.bestGrade ? gradeRank[prevRec.bestGrade] : 0;
      const nextGrade =
        result.victory && gradeRank[result.grade] >= prevGradeRank ? result.grade : prevRec.bestGrade;

      const nextRecords = {
        ...current.missionRecords,
        [key]: {
          missionId: result.missionId,
          completed: prevRec.completed || result.victory,
          bestScore: Math.max(prevRec.bestScore, result.score),
          bestGrade: nextGrade,
          fastestTimeSec:
            result.victory && (!prevRec.fastestTimeSec || result.durationSec < prevRec.fastestTimeSec)
              ? result.durationSec
              : prevRec.fastestTimeSec,
          bestHeadshots: Math.max(prevRec.bestHeadshots, result.headshots),
          highestDifficulty: result.victory ? result.difficulty : prevRec.highestDifficulty,
        },
      };

      const unlocked = new Set(current.achievements);
      const newAchievements: string[] = [];
      const unlock = (id: string) => {
        if (!unlocked.has(id)) {
          unlocked.add(id);
          newAchievements.push(id);
        }
      };

      if (result.victory) {
        unlock('first_blood');
        if (result.headshots >= 5) unlock('sharpshooter');
        if (result.airKills >= 3) unlock('sky_sweeper');
        if (result.missionId === 2) unlock('convoy_buster');
        if (result.grade === 'S') unlock('s_rank_elite');
        const completedAll = [1, 2, 3, 4, 5].every((mId) => nextRecords[String(mId)]?.completed);
        if (completedAll) unlock('veteran_cleared');
      }

      const nextSave: ProgressionSave = {
        ...current,
        xp: current.xp + result.xpEarned,
        requisitionPoints: current.requisitionPoints + result.requisitionEarned,
        totalKills: current.totalKills + result.kills,
        totalHeadshots: current.totalHeadshots + result.headshots,
        missionRecords: nextRecords,
        achievements: Array.from(unlocked),
        updatedAt: Date.now(),
      };

      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      void SaveManager.appendCombatLog({
        id: `${result.missionId}_${Date.now()}`,
        missionId: result.missionId,
        difficulty: result.difficulty,
        victory: result.victory,
        score: result.score,
        grade: result.grade,
        kills: result.kills,
        headshots: result.headshots,
        durationSec: result.durationSec,
        timestamp: Date.now(),
      });

      return { newAchievements };
    },
    resetAllProgress: () => {
      const fresh = SaveManager.resetProgression();
      set({ save: fresh, recoveredFromCorruption: false, migratedFromV1: false });
    },
  }))
);

export function useProgressionStore<T>(selector: (state: ProgressionStoreState) => T): T {
  return useStore(progressionStore, selector);
}
