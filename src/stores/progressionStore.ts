import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  ATTACHMENT_BY_ID,
  OPERATOR_CAMO_CATALOG,
  OPERATOR_HELMET_CATALOG,
  OPERATOR_PATCH_CATALOG,
} from '@/src/data/attachments';
import {
  computeCombinedModifierEffects,
  evaluateWeaponMastery,
  getChallengesForMission,
  ReplayModifierId,
} from '@/src/data/challenges';
import { getMissionById } from '@/src/data/missions';
import { evaluateOperatorSpecializations } from '@/src/data/squadRoster';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import {
  advanceRosterAfterOperation,
  CampaignEventDraft,
  CampaignRebaseDiff,
  commitCampaignEvents,
  previewCampaignRebaseDiff,
} from '@/src/gameplay/campaign/CampaignEventLedger';
import { DEFAULT_EQUIPPED_ATTACHMENTS } from '@/src/gameplay/weapons/AttachmentCompositionEngine';
import {
  AttachmentSlot,
  DeploymentMode,
  EquippedWeaponAttachments,
  MissionLoadoutConfig,
  NamedLoadoutPreset,
  OperatorCustomization,
  ReplayMode,
  SavedWeaponBuild,
} from '@/src/schemas/campaign.schema';
import { Difficulty, MissionGrade } from '@/src/schemas/common.schema';
import { ProgressionSave } from '@/src/schemas/save.schema';
import { WeaponId, WeaponUpgradeKey } from '@/src/schemas/weapon.schema';
import { SaveManager } from '@/src/storage/SaveManager';

export interface SquadOperatorMissionReport {
  operatorId: string;
  callsign: string;
  role: string;
  deployed: boolean;
  survived: boolean;
  becameMia: boolean;
  timesDowned: number;
  severeInjury: boolean;
  kills: number;
  revivesPerformed: number;
  vehiclesDisabled: number;
  spotsMarked: number;
  suppressionAssists: number;
}

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
  accuracyPct?: number;
  deathsCount?: number;
  optionalObjectivesCompleted?: number;
  killsByWeapon?: Record<string, number>;
  activeModifiers?: ReplayModifierId[];
  replayMode?: ReplayMode;
  deploymentMode?: DeploymentMode;
  operationRunId?: string;
  campaignEventDrafts?: CampaignEventDraft[];
  squadReports?: SquadOperatorMissionReport[];
}

export interface MissionProgressionOutcome {
  newAchievements: string[];
  newChallenges: string[];
  challengeXpBonus: number;
  challengeReqBonus: number;
  modifierReqBonus: number;
  masteryTierUps: Array<{ weaponId: WeaponId; tier: string }>;
  committedCampaignEvents: number;
  stagedRebaseDiff: CampaignRebaseDiff | null;
  pendingRebaseDrafts: CampaignEventDraft[];
  recoveredOperatorCallsigns: string[];
  hqRecoveryProgressedCount: number;
}

export interface ProgressionStoreState {
  save: ProgressionSave;
  recoveredFromCorruption: boolean;
  migratedFromV1: boolean;
  recordMissionResult: (result: MissionResultPayload) => MissionProgressionOutcome;
  commitStagedCampaignRebase: (missionId: number, drafts: CampaignEventDraft[]) => number;
  upgradeWeapon: (weaponId: WeaponId, key: WeaponUpgradeKey) => boolean;
  spendRequisition: (amount: number) => boolean;
  getUpgradeLevel: (weaponId: WeaponId, key: WeaponUpgradeKey) => number;
  toggleModifier: (modifierId: ReplayModifierId) => void;
  clearModifiers: () => void;
  // Stage 7 & Redesign actions
  updateMissionLoadout: (config: Partial<MissionLoadoutConfig>) => void;
  applyLoadoutPreset: (presetId: string) => boolean;
  saveCustomLoadoutPreset: (name: string, config: MissionLoadoutConfig) => NamedLoadoutPreset;
  deleteCustomLoadoutPreset: (presetId: string) => boolean;
  unlockAttachment: (weaponId: WeaponId, attachmentId: string) => { ok: boolean; reason?: string };
  equipAttachment: (weaponId: WeaponId, slot: AttachmentSlot, attachmentId: string | null) => boolean;
  applyWeaponAttachmentsBulk: (weaponId: WeaponId, equipped: EquippedWeaponAttachments) => boolean;
  saveNamedWeaponBuild: (
    weaponId: WeaponId,
    name: string,
    attachments: EquippedWeaponAttachments
  ) => SavedWeaponBuild;
  deleteNamedWeaponBuild: (buildId: string) => boolean;
  unlockCosmetic: (kind: 'camo' | 'helmet' | 'patch', id: string) => boolean;
  setOperatorCustomization: (operatorId: string, customization: Partial<OperatorCustomization>) => void;
  setPlayerCustomization: (customization: Partial<OperatorCustomization>) => void;
  expediteOperatorRecovery: (operatorId: string) => boolean;
  toggleIronmanSquad: () => void;
  resetAllProgress: () => void;
}

const loaded = SaveManager.loadProgression();

export const UPGRADE_COSTS = [100, 180, 280, 420, 600] as const;
export const EXPEDITE_RECOVERY_REQ_COST = 150;

export const progressionStore = createStore<ProgressionStoreState>()(
  subscribeWithSelector((set, get) => ({
    save: loaded.save,
    recoveredFromCorruption: loaded.recoveredFromCorruption,
    migratedFromV1: loaded.migratedFromV1,
    getUpgradeLevel: (weaponId, key) => {
      return get().save.weaponUpgrades[weaponId]?.[key] ?? 0;
    },
    toggleModifier: (modifierId) => {
      const current = get().save;
      const setMods = new Set<ReplayModifierId>(current.activeModifiers ?? []);
      if (setMods.has(modifierId)) {
        setMods.delete(modifierId);
      } else {
        setMods.add(modifierId);
      }
      const nextSave: ProgressionSave = {
        ...current,
        activeModifiers: Array.from(setMods),
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
    },
    clearModifiers: () => {
      const current = get().save;
      if ((current.activeModifiers ?? []).length === 0) return;
      const nextSave: ProgressionSave = {
        ...current,
        activeModifiers: [],
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
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
        bestAccuracyPct: 0,
        optionalObjectivesCompleted: 0,
      };

      const activeMods = result.activeModifiers ?? current.activeModifiers ?? [];
      const modEffects = computeCombinedModifierEffects(activeMods);
      const adjustedScore =
        result.victory && activeMods.length > 0
          ? Math.round(result.score * modEffects.scoreMultiplier)
          : result.score;
      const modifierReqBonus =
        result.victory && modEffects.requisitionBonusPct > 0
          ? Math.round(result.requisitionEarned * (modEffects.requisitionBonusPct / 100))
          : 0;

      const gradeRank: Record<MissionGrade, number> = { S: 4, A: 3, B: 2, C: 1 };
      const prevGradeRank = prevRec.bestGrade ? gradeRank[prevRec.bestGrade] : 0;
      const nextGrade =
        result.victory && gradeRank[result.grade] >= prevGradeRank ? result.grade : prevRec.bestGrade;

      const optCount = result.optionalObjectivesCompleted ?? 0;
      const accuracyPct = result.accuracyPct ?? 0;

      const nextRecords = {
        ...current.missionRecords,
        [key]: {
          missionId: result.missionId,
          completed: prevRec.completed || result.victory,
          bestScore: Math.max(prevRec.bestScore, adjustedScore),
          bestGrade: nextGrade,
          fastestTimeSec:
            result.victory && (!prevRec.fastestTimeSec || result.durationSec < prevRec.fastestTimeSec)
              ? result.durationSec
              : prevRec.fastestTimeSec,
          bestHeadshots: Math.max(prevRec.bestHeadshots, result.headshots),
          bestAccuracyPct: Math.max(prevRec.bestAccuracyPct ?? 0, accuracyPct),
          optionalObjectivesCompleted: Math.max(prevRec.optionalObjectivesCompleted ?? 0, optCount),
          highestDifficulty: result.victory ? result.difficulty : prevRec.highestDifficulty,
        },
      };

      // Update per-weapon mastery kills & detect tier-ups
      const nextMasteryKills: Record<string, number> = { ...(current.weaponMasteryKills ?? {}) };
      const masteryTierUps: Array<{ weaponId: WeaponId; tier: string }> = [];
      if (result.killsByWeapon) {
        for (const [wId, added] of Object.entries(result.killsByWeapon)) {
          if (added <= 0) continue;
          const prevKills = nextMasteryKills[wId] ?? 0;
          const newKills = prevKills + Math.round(added);
          nextMasteryKills[wId] = newKills;
          const beforeTier = evaluateWeaponMastery(wId as WeaponId, prevKills).tier;
          const afterTier = evaluateWeaponMastery(wId as WeaponId, newKills).tier;
          if (beforeTier !== afterTier) {
            masteryTierUps.push({ weaponId: wId as WeaponId, tier: afterTier });
          }
        }
      }

      // Evaluate mission tactical challenges
      const completedChallenges = new Set<string>(current.completedChallenges ?? []);
      const newChallenges: string[] = [];
      let challengeXpBonus = 0;
      let challengeReqBonus = 0;
      const missionCfg = getMissionById(result.missionId);
      const missionChallenges = getChallengesForMission(result.missionId);
      for (const ch of missionChallenges) {
        if (completedChallenges.has(ch.id)) continue;
        const passed = ch.evaluate({
          missionId: result.missionId,
          victory: result.victory,
          difficulty: result.difficulty,
          grade: result.grade,
          durationSec: result.durationSec,
          parTimeSec: missionCfg.parTimeSec,
          kills: result.kills,
          headshots: result.headshots,
          airKills: result.airKills,
          accuracyPct,
          deathsCount: result.deathsCount ?? 0,
          optionalObjectivesCompleted: optCount,
          activeModifiers: activeMods,
        });
        if (passed) {
          completedChallenges.add(ch.id);
          newChallenges.push(ch.id);
          challengeXpBonus += ch.xpBonus;
          challengeReqBonus += ch.requisitionBonus;
        }
      }

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
        if (optCount >= 1) unlock('tactical_specialist');
        if (completedChallenges.size >= 3) unlock('challenge_master');
        if (activeMods.length > 0) unlock('iron_vanguard');
        const completedAll = [1, 2, 3, 4, 5].every((mId) => nextRecords[String(mId)]?.completed);
        if (completedAll) unlock('veteran_cleared');
      }

      if (Object.values(nextMasteryKills).some((k) => k >= 25)) {
        unlock('weapon_master');
      }

      // Stage 7: Campaign Event Ledger & Squad Roster Continuity
      const replayMode: ReplayMode =
        result.replayMode ?? (prevRec.completed ? 'campaign_replay' : 'canonical');
      const incomingDrafts = result.campaignEventDrafts ?? [];
      const completedMissionIds = Object.values(nextRecords)
        .filter((r) => r.completed)
        .map((r) => r.missionId);

      let nextLedger = current.campaignLedger;
      let committedCampaignEvents = 0;
      let stagedRebaseDiff: CampaignRebaseDiff | null = null;
      let pendingRebaseDrafts: CampaignEventDraft[] = [];

      if (result.victory && incomingDrafts.length > 0) {
        if (replayMode === 'canonical') {
          const commitRes = commitCampaignEvents(
            current.campaignLedger,
            result.missionId,
            incomingDrafts,
            'canonical',
            completedMissionIds
          );
          nextLedger = commitRes.ledger;
          committedCampaignEvents = commitRes.committedCount;
        } else if (replayMode === 'campaign_replay') {
          const diff = previewCampaignRebaseDiff(
            current.campaignLedger,
            result.missionId,
            incomingDrafts,
            completedMissionIds
          );
          if (diff.hasCanonicalDifference) {
            // Do NOT mutate canonical ledger automatically during Campaign Replay; wait for explicit player rebase confirmation
            stagedRebaseDiff = diff;
            pendingRebaseDrafts = incomingDrafts.slice();
          }
        }
        // clean_replay: strictly score/challenges/mastery only, never touches canonical ledger
      }

      // Advance squad roster recovery & field specializations (never decrements on Clean Replay; deduplicated per run)
      const prevCredited = current.creditedOperationRunIds ?? [];
      const nextRosterRaw = advanceRosterAfterOperation(current.squadRoster, {
        replayMode,
        victory: result.victory,
        difficulty: result.difficulty,
        ironmanActive: current.ironmanSquadEnabled,
        deploymentMode: result.deploymentMode ?? 'fireteam',
        missionElapsedSec: result.durationSec,
        operationRunId: result.operationRunId,
        creditedOperationRunIds: prevCredited,
        operatorReports: result.deploymentMode === 'solo' ? [] : (result.squadReports ?? []),
      });
      const nextRoster = nextRosterRaw.map((op) => ({
        ...op,
        unlockedSpecializations: evaluateOperatorSpecializations(op),
      }));

      // Track which recovering HQ operators advanced or returned to Active duty
      const recoveredOperatorCallsigns: string[] = [];
      let hqRecoveryProgressedCount = 0;
      for (const prevOp of current.squadRoster) {
        if (prevOp.status !== 'recovering') continue;
        const nextOp = nextRoster.find((o) => o.id === prevOp.id);
        if (!nextOp) continue;
        if (nextOp.status === 'active') {
          recoveredOperatorCallsigns.push(nextOp.callsign);
          hqRecoveryProgressedCount += 1;
        } else if (
          (nextOp.recoveryElapsedSec ?? 0) > (prevOp.recoveryElapsedSec ?? 0) ||
          nextOp.recoveryOpsRemaining < prevOp.recoveryOpsRemaining
        ) {
          hqRecoveryProgressedCount += 1;
        }
      }

      const shouldCreditRunId =
        replayMode !== 'clean_replay' &&
        Boolean(result.operationRunId) &&
        !prevCredited.includes(result.operationRunId!) &&
        (result.victory || result.durationSec >= 45);
      const nextCreditedRunIds = shouldCreditRunId
        ? [...prevCredited.slice(-39), result.operationRunId!]
        : prevCredited;

      // Unlock mission-earned camos automatically on first clear
      const unlockedCosmeticsSet = new Set(current.unlockedCosmetics ?? []);
      if (result.victory) {
        if (result.missionId === 2) unlockedCosmeticsSet.add('camo:desert_sandstorm');
        if (result.missionId === 3) unlockedCosmeticsSet.add('camo:nightfall_slate');
        if (result.missionId === 4) unlockedCosmeticsSet.add('camo:viper_canopy');
        if (result.grade === 'S') unlockedCosmeticsSet.add('camo:vanguard_carbon');
      }

      const nextSave: ProgressionSave = {
        ...current,
        xp: current.xp + result.xpEarned + challengeXpBonus,
        requisitionPoints:
          current.requisitionPoints + result.requisitionEarned + challengeReqBonus + modifierReqBonus,
        totalKills: current.totalKills + result.kills,
        totalHeadshots: current.totalHeadshots + result.headshots,
        missionRecords: nextRecords,
        weaponMasteryKills: nextMasteryKills,
        completedChallenges: Array.from(completedChallenges),
        achievements: Array.from(unlocked),
        campaignLedger: nextLedger,
        squadRoster: nextRoster,
        creditedOperationRunIds: nextCreditedRunIds,
        unlockedCosmetics: Array.from(unlockedCosmeticsSet),
        updatedAt: Date.now(),
      };

      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      void SaveManager.appendCombatLog({
        id: `${result.missionId}_${Date.now()}`,
        missionId: result.missionId,
        difficulty: result.difficulty,
        victory: result.victory,
        score: adjustedScore,
        grade: result.grade,
        kills: result.kills,
        headshots: result.headshots,
        durationSec: result.durationSec,
        accuracyPct,
        optionalCompleted: optCount,
        activeModifiers: activeMods,
        timestamp: Date.now(),
      });

      return {
        newAchievements,
        newChallenges,
        challengeXpBonus,
        challengeReqBonus,
        modifierReqBonus,
        masteryTierUps,
        committedCampaignEvents,
        stagedRebaseDiff,
        pendingRebaseDrafts,
        recoveredOperatorCallsigns,
        hqRecoveryProgressedCount,
      };
    },
    commitStagedCampaignRebase: (missionId, drafts) => {
      const current = get().save;
      const completedMissionIds = Object.values(current.missionRecords)
        .filter((r) => r.completed)
        .map((r) => r.missionId);
      const commitRes = commitCampaignEvents(
        current.campaignLedger,
        missionId,
        drafts,
        'campaign_replay',
        completedMissionIds
      );
      if (commitRes.committedCount === 0) return 0;
      const nextSave: ProgressionSave = {
        ...current,
        campaignLedger: commitRes.ledger,
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return commitRes.committedCount;
    },
    updateMissionLoadout: (partial) => {
      const current = get().save;
      const merged: MissionLoadoutConfig = {
        ...current.activeMissionLoadout,
        ...partial,
        squadIds: partial.squadIds ? partial.squadIds.slice(0, 3) : current.activeMissionLoadout.squadIds,
      };
      const nextSave: ProgressionSave = {
        ...current,
        activeMissionLoadout: merged,
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
    },
    applyLoadoutPreset: (presetId) => {
      const current = get().save;
      const preset = current.loadoutPresets.find((p) => p.id === presetId);
      if (!preset) return false;
      const nextSave: ProgressionSave = {
        ...current,
        activeMissionLoadout: {
          ...preset.config,
          squadIds: [...preset.config.squadIds],
        },
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return true;
    },
    saveCustomLoadoutPreset: (name, config) => {
      const current = get().save;
      const cleanName = name.trim().slice(0, 32) || `Custom Kit ${current.loadoutPresets.length + 1}`;
      const preset: NamedLoadoutPreset = {
        id: `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: cleanName,
        roleTag: 'custom',
        isBuiltIn: false,
        config: {
          ...config,
          squadIds: config.squadIds.slice(0, 3),
        },
      };
      const nextPresets = [...current.loadoutPresets.slice(0, 11), preset];
      const nextSave: ProgressionSave = {
        ...current,
        loadoutPresets: nextPresets,
        activeMissionLoadout: { ...preset.config, squadIds: [...preset.config.squadIds] },
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return preset;
    },
    deleteCustomLoadoutPreset: (presetId) => {
      const current = get().save;
      const target = current.loadoutPresets.find((p) => p.id === presetId);
      if (!target || target.isBuiltIn) return false;
      const nextSave: ProgressionSave = {
        ...current,
        loadoutPresets: current.loadoutPresets.filter((p) => p.id !== presetId),
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return true;
    },
    unlockAttachment: (weaponId, attachmentId) => {
      const current = get().save;
      const att = ATTACHMENT_BY_ID[attachmentId];
      const weapon = WEAPON_BY_ID[weaponId];
      if (!att || !weapon) return { ok: false, reason: 'Invalid weapon or attachment.' };
      if (!att.compatibleCategories.includes(weapon.category)) {
        return { ok: false, reason: 'Attachment is incompatible with this weapon class.' };
      }
      const key = `${weaponId}:${attachmentId}`;
      if (current.unlockedAttachments.includes(key)) {
        return { ok: true };
      }
      const masteryKills = current.weaponMasteryKills[weaponId] ?? 0;
      if (masteryKills < att.minMasteryKills) {
        return {
          ok: false,
          reason: `Requires ${att.minMasteryKills} kills with ${weapon.shortName} (${masteryKills}/${att.minMasteryKills}).`,
        };
      }
      if (current.requisitionPoints < att.reqCost) {
        return { ok: false, reason: `Requires ${att.reqCost} REQ.` };
      }
      const nextSave: ProgressionSave = {
        ...current,
        requisitionPoints: current.requisitionPoints - att.reqCost,
        unlockedAttachments: [...current.unlockedAttachments, key],
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return { ok: true };
    },
    equipAttachment: (weaponId, slot, attachmentId) => {
      const current = get().save;
      const weapon = WEAPON_BY_ID[weaponId];
      if (!weapon) return false;
      if (attachmentId !== null) {
        const att = ATTACHMENT_BY_ID[attachmentId];
        if (!att || att.slot !== slot || !att.compatibleCategories.includes(weapon.category)) {
          return false;
        }
        const key = `${weaponId}:${attachmentId}`;
        if (
          !current.unlockedAttachments.includes(key) &&
          !current.unlockedAttachments.includes(attachmentId)
        ) {
          return false;
        }
      }
      const prevEquipped = current.weaponAttachments[weaponId] ?? { ...DEFAULT_EQUIPPED_ATTACHMENTS };
      const nextSave: ProgressionSave = {
        ...current,
        weaponAttachments: {
          ...current.weaponAttachments,
          [weaponId]: {
            ...prevEquipped,
            [slot]: attachmentId,
          },
        },
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return true;
    },
    applyWeaponAttachmentsBulk: (weaponId, equipped) => {
      const current = get().save;
      const weapon = WEAPON_BY_ID[weaponId];
      if (!weapon) return false;
      const slots: AttachmentSlot[] = ['optic', 'muzzle', 'barrel', 'underbarrel', 'magazine'];
      for (const slot of slots) {
        const attId = equipped[slot];
        if (attId !== null) {
          const att = ATTACHMENT_BY_ID[attId];
          if (!att || att.slot !== slot || !att.compatibleCategories.includes(weapon.category)) {
            return false;
          }
          const key = `${weaponId}:${attId}`;
          if (
            !current.unlockedAttachments.includes(key) &&
            !current.unlockedAttachments.includes(attId)
          ) {
            return false;
          }
        }
      }
      const nextSave: ProgressionSave = {
        ...current,
        weaponAttachments: {
          ...current.weaponAttachments,
          [weaponId]: { ...equipped },
        },
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return true;
    },
    saveNamedWeaponBuild: (weaponId, name, attachments) => {
      const current = get().save;
      const weapon = WEAPON_BY_ID[weaponId];
      const existing = current.savedWeaponBuilds ?? [];
      const cleanName =
        name.trim().slice(0, 32) || `${weapon?.shortName ?? weaponId} Build ${existing.length + 1}`;
      const build: SavedWeaponBuild = {
        id: `wb_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        weaponId,
        name: cleanName,
        attachments: { ...attachments },
        createdAt: Date.now(),
      };
      const nextSave: ProgressionSave = {
        ...current,
        savedWeaponBuilds: [build, ...existing].slice(0, 24),
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return build;
    },
    deleteNamedWeaponBuild: (buildId) => {
      const current = get().save;
      const existing = current.savedWeaponBuilds ?? [];
      if (!existing.some((b) => b.id === buildId)) return false;
      const nextSave: ProgressionSave = {
        ...current,
        savedWeaponBuilds: existing.filter((b) => b.id !== buildId),
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return true;
    },
    unlockCosmetic: (kind, id) => {
      const current = get().save;
      const token = `${kind}:${id}`;
      if (current.unlockedCosmetics.includes(token)) return true;
      const item =
        kind === 'camo'
          ? OPERATOR_CAMO_CATALOG.find((c) => c.id === id)
          : kind === 'helmet'
            ? OPERATOR_HELMET_CATALOG.find((c) => c.id === id)
            : OPERATOR_PATCH_CATALOG.find((c) => c.id === id);
      if (!item) return false;
      if (current.requisitionPoints < item.reqCost) return false;
      const nextSave: ProgressionSave = {
        ...current,
        requisitionPoints: current.requisitionPoints - item.reqCost,
        unlockedCosmetics: [...current.unlockedCosmetics, token],
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return true;
    },
    setOperatorCustomization: (operatorId, customization) => {
      const current = get().save;
      const nextRoster = current.squadRoster.map((op) =>
        op.id === operatorId
          ? { ...op, customization: { ...op.customization, ...customization } }
          : op
      );
      const nextSave: ProgressionSave = {
        ...current,
        squadRoster: nextRoster,
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
    },
    setPlayerCustomization: (customization) => {
      const current = get().save;
      const nextSave: ProgressionSave = {
        ...current,
        playerCustomization: { ...current.playerCustomization, ...customization },
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
    },
    expediteOperatorRecovery: (operatorId) => {
      const current = get().save;
      const target = current.squadRoster.find((op) => op.id === operatorId);
      if (!target || target.status !== 'recovering' || target.recoveryOpsRemaining <= 0) {
        return false;
      }
      if (current.requisitionPoints < EXPEDITE_RECOVERY_REQ_COST) return false;
      const nextRoster = current.squadRoster.map((op) => {
        if (op.id !== operatorId) return op;
        const remaining = Math.max(0, op.recoveryOpsRemaining - 1);
        return {
          ...op,
          recoveryOpsRemaining: remaining,
          recoveryElapsedSec: remaining === 0 ? 0 : op.recoveryElapsedSec ?? 0,
          recoveryTargetSec: remaining === 0 ? 0 : remaining * 180,
          status: remaining === 0 ? ('active' as const) : ('recovering' as const),
          injurySeverity: remaining === 0 ? ('none' as const) : op.injurySeverity,
        };
      });
      const nextSave: ProgressionSave = {
        ...current,
        requisitionPoints: current.requisitionPoints - EXPEDITE_RECOVERY_REQ_COST,
        squadRoster: nextRoster,
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
      return true;
    },
    toggleIronmanSquad: () => {
      const current = get().save;
      const nextSave: ProgressionSave = {
        ...current,
        ironmanSquadEnabled: !current.ironmanSquadEnabled,
        updatedAt: Date.now(),
      };
      set({ save: nextSave });
      SaveManager.saveProgression(nextSave);
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
