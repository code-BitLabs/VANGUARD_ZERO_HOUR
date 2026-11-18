import { createActor } from 'xstate';
import { beforeEach, describe, expect, it } from 'vitest';
import { getMissionById, MISSION_CATALOG } from '@/src/data/missions';
import { engineLifecycleMachine } from '@/src/engine/EngineLifecycle';
import { MissionCheckpointSnapshot, selectMissionCheckpointAnchor } from '@/src/gameplay/MissionCheckpoint';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import {
  TacticalEvaluationContext,
  TacticalGuidanceSystem,
  TIER3_MECHANIC_CARDS,
} from '@/src/gameplay/TacticalGuidanceSystem';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { settingsStore } from '@/src/stores/settingsStore';

describe('Stage 4B: Mission Lifecycle, Stage-Gated Progression, Target-Bound Demolition & Tactical Guidance', () => {
  beforeEach(() => {
    missionSelectionStore.getState().resetDismissedHints();
    settingsStore.getState().updateAccessibility({ tacticalHints: true, subtitles: true });
  });

  describe('TRN-13 — Mission Lifecycle State Machine Integrity', () => {
    it('supports full deployment, 3x consecutive restarts, 3x checkpoint retries, pause/resume, debrief -> next mission, and abort to menu without dropped events', () => {
      const actor = createActor(engineLifecycleMachine);
      actor.start();

      expect(actor.getSnapshot().value).toBe('boot');
      actor.send({ type: 'READY' });
      expect(actor.getSnapshot().value).toBe('menu');

      // 1. Deploy Mission 1
      actor.send({ type: 'SELECT_MISSION', missionId: 1 });
      expect(actor.getSnapshot().value).toBe('preloading');
      actor.send({ type: 'ASSETS_LOADED' });
      expect(actor.getSnapshot().value).toBe('initializingWorld');
      actor.send({ type: 'WORLD_READY' });
      expect(actor.getSnapshot().value).toBe('playing');

      // 2. 3x consecutive checkpoint retries from playing and paused
      for (let i = 0; i < 3; i++) {
        actor.send({ type: 'RESTART_MISSION' });
        expect(actor.getSnapshot().value).toBe('playing');
      }

      // 3. Pause -> Resume -> Pause -> Restart Mission
      actor.send({ type: 'PAUSE' });
      expect(actor.getSnapshot().value).toBe('paused');
      actor.send({ type: 'RESUME' });
      expect(actor.getSnapshot().value).toBe('playing');
      actor.send({ type: 'PAUSE' });
      actor.send({ type: 'RESTART_MISSION' });
      expect(actor.getSnapshot().value).toBe('playing');

      // 4. 3x consecutive full mission restarts (SELECT_MISSION from playing / preloading)
      for (let i = 0; i < 3; i++) {
        actor.send({ type: 'SELECT_MISSION', missionId: 1 });
        expect(actor.getSnapshot().value).toBe('preloading');
        actor.send({ type: 'ASSETS_LOADED' });
        actor.send({ type: 'WORLD_READY' });
        expect(actor.getSnapshot().value).toBe('playing');
      }

      // 5. Mission Ended -> Debrief -> Checkpoint Retry (RESTART_MISSION) -> Playing
      actor.send({ type: 'MISSION_ENDED' });
      expect(actor.getSnapshot().value).toBe('debrief');
      actor.send({ type: 'RESTART_MISSION' });
      expect(actor.getSnapshot().value).toBe('playing');

      // 6. Mission Ended -> Debrief -> Next Mission (SELECT_MISSION) -> Playing
      actor.send({ type: 'MISSION_ENDED' });
      expect(actor.getSnapshot().value).toBe('debrief');
      actor.send({ type: 'SELECT_MISSION', missionId: 2 });
      expect(actor.getSnapshot().value).toBe('preloading');
      actor.send({ type: 'ASSETS_LOADED' });
      actor.send({ type: 'WORLD_READY' });
      expect(actor.getSnapshot().value).toBe('playing');
      expect(actor.getSnapshot().context.missionId).toBe(2);

      // 7. Return to Base (UNLOAD -> UNLOADED -> menu) -> Redeploy
      actor.send({ type: 'UNLOAD' });
      expect(actor.getSnapshot().value).toBe('unloading');
      actor.send({ type: 'UNLOADED' });
      expect(actor.getSnapshot().value).toBe('menu');

      actor.stop();
    });
  });

  describe('TRN-14 — Stage-Gated Objective Progression & Retroactive Target Credit Ledger', () => {
    it('configures all 5 campaign operations with sequential stages, titles, and prerequisites', () => {
      expect(MISSION_CATALOG).toHaveLength(5);
      for (const mission of MISSION_CATALOG) {
        expect(mission.objectives.length).toBeGreaterThanOrEqual(3);
        const dir = new MissionDirector(mission, 'normal');
        const statuses = dir.getObjectiveStatuses();

        expect(dir.getActiveStageIndex()).toBe(1);
        expect(dir.getTotalStages()).toBe(mission.objectives.length);
        expect(statuses[0].status).toBe('active');
        expect(statuses[0].isPrimary).toBe(true);

        for (let i = 1; i < statuses.length; i++) {
          expect(['locked', 'blocked']).toContain(statuses[i].status);
          expect(statuses[i].isPrimary).toBe(false);
          expect(statuses[i].blockedReason).toBeTruthy();
        }
      }
    });

    it('logs retroactive target credit when later-stage targets are destroyed early and never soft-locks when earlier stages complete', () => {
      const m1 = getMissionById(1);
      const dir = new MissionDirector(m1, 'normal');

      // Stage 1 is obj_city_squads (10 kills). Player destroys Stage 2 radars AND Stage 3 helicopter early!
      dir.onDestructibleTargetDestroyed(300, 'radar_relay', 'radar_early_1', 'weapon');
      dir.onDestructibleTargetDestroyed(300, 'radar_relay', 'radar_early_2', 'weapon');
      dir.onAirUnitKilled(350, 'helicopter');

      // Retroactive credit is recorded on Stage 2 & Stage 3, while Stage 1 remains the active stage
      expect(dir.getRetroactiveCreditedObjectiveIds()).toContain('obj_city_radars');
      expect(dir.getRetroactiveCreditedObjectiveIds()).toContain('obj_city_heli');
      expect(dir.getActiveStageIndex()).toBe(1);

      const statusesDuringStage1 = dir.getObjectiveStatuses();
      expect(statusesDuringStage1[0].status).toBe('active');
      expect(statusesDuringStage1[1].completed).toBe(true);
      expect(statusesDuringStage1[2].completed).toBe(true);

      // Now complete Stage 1 (10 infantry kills) -> mission automatically advances past Stage 2 & 3 and finishes in victory!
      for (let i = 0; i < 10; i++) {
        dir.onEnemyKilled(false, 120);
      }
      const tick = dir.update(1.0, 100, 100);
      expect(tick.finished).toBe(true);
      expect(tick.victory).toBe(true);
    });
  });

  describe('TRN-14.3 — Target-Bound Demolition Validation (plant_charge vs destroy_targets)', () => {
    it('satisfies Mission 4 plant_charge objective as completed when using [E] charge or placed C4 detonation, and enforces targetId idempotence', () => {
      const m4 = getMissionById(4);
      const dir = new MissionDirector(m4, 'normal');

      // Complete Stage 1 (10 infantry kills) so Stage 2 (obj_jungle_cache, targetCount = 2) is active
      for (let i = 0; i < 10; i++) {
        dir.onEnemyKilled(false, 100);
      }
      expect(dir.getActiveStageIndex()).toBe(2);

      // Cache 1: Plant charge via [E] interact_charge
      dir.onChargePlanted(300, 'cache_alpha', 'interact_charge');
      // Duplicate call with same targetId (e.g. from mesh destruction callback) must be ignored
      dir.onDestructibleTargetDestroyed(300, 'weapons_cache', 'cache_alpha', 'interact_charge');

      let cacheStatus = dir.getObjectiveStatuses().find((o) => o.id === 'obj_jungle_cache')!;
      expect(cacheStatus.current).toBe(1);
      expect(cacheStatus.bypassed).toBe(false);

      // Cache 2: Detonate placed C4 within 6.5m demolition zone
      dir.onDestructibleTargetDestroyed(300, 'weapons_cache', 'cache_bravo', 'c4');

      cacheStatus = dir.getObjectiveStatuses().find((o) => o.id === 'obj_jungle_cache')!;
      expect(cacheStatus.current).toBe(2);
      expect(cacheStatus.completed).toBe(true);
      expect(cacheStatus.bypassed).toBe(false);
      expect(cacheStatus.status).toBe('completed');
      expect(dir.getActiveStageIndex()).toBe(3);
    });

    it('marks plant_charge objective as bypassed (not completed) when caches are destroyed by RPGs or gunfire, preventing deadlocks while withholding demolition bonus', () => {
      const m4 = getMissionById(4);
      const dirClean = new MissionDirector(m4, 'normal');
      const dirBypassed = new MissionDirector(m4, 'normal');

      // Clean run: 2 C4 / [E] charges
      dirClean.onChargePlanted(300, 'c1', 'interact_charge');
      dirClean.onChargePlanted(300, 'c2', 'interact_charge');

      // Uncalibrated blast run: player shoots caches with RPG ('explosion') and rifle ('weapon')
      dirBypassed.onDestructibleTargetDestroyed(300, 'weapons_cache', 'c1', 'explosion');
      expect(dirBypassed.alertText).toContain('DEMOLITION BYPASSED');
      expect(dirBypassed.subtitleText).toContain('uncalibrated blast');

      dirBypassed.onDestructibleTargetDestroyed(300, 'weapons_cache', 'c2', 'weapon');

      const bypassedObj = dirBypassed.getObjectiveStatuses().find((o) => o.id === 'obj_jungle_cache')!;
      expect(bypassedObj.completed).toBe(true);
      expect(bypassedObj.bypassed).toBe(true);
      expect(bypassedObj.status).toBe('bypassed');
      expect(dirBypassed.getBypassedObjectiveIds()).toEqual(['obj_jungle_cache']);
      expect(dirBypassed.score).toBeLessThan(dirClean.score);
    });
  });

  describe('TRN-14.4 & TRN-14.5 — Extraction Gating & Anti-Stall Wave Reinforcement Progression', () => {
    it('blocks premature extraction with clear prerequisite diagnostics and unlocks automatically when prior stages complete', () => {
      const m5 = getMissionById(5);
      const dir = new MissionDirector(m5, 'normal');

      expect(dir.getExtractionStatus()).toBe('locked');
      expect(dir.getExtractionBlockReason()).toContain('STAGE 1/4');
      expect(dir.onExtractionReached()).toBe(false);
      expect(dir.alertText).toContain('EXTRACTION LOCKED');

      // Complete Stage 1 (3 industrial vats)
      dir.onDestructibleTargetDestroyed(300, 'fuel_tank', 'vat_1', 'weapon');
      dir.onDestructibleTargetDestroyed(300, 'fuel_tank', 'vat_2', 'weapon');
      dir.onDestructibleTargetDestroyed(300, 'fuel_tank', 'vat_3', 'weapon');

      expect(dir.getExtractionStatus()).toBe('locked');
      expect(dir.getExtractionBlockReason()).toContain('STAGE 2/4');

      // Complete Stage 2 (12 elite siege kills)
      for (let i = 0; i < 12; i++) {
        dir.onEnemyKilled(false, 100);
      }
      expect(dir.getExtractionStatus()).toBe('locked');
      expect(dir.getExtractionBlockReason()).toContain('STAGE 3/4');

      // Complete Stage 3 (1 command gunship)
      dir.onAirUnitKilled(350, 'gunship');

      // Extraction is now unlocked and active as Stage 4
      expect(dir.getActiveStageIndex()).toBe(4);
      expect(dir.getExtractionStatus()).toBe('available');
      expect(dir.getExtractionBlockReason()).toBeNull();
      expect(dir.onExtractionReached()).toBe(true);
      expect(dir.getExtractionStatus()).toBe('completed');
    });

    it('immediately triggers anti-stall reinforcements when aliveEnemyCount drops below remaining required wave kills', () => {
      const m5 = getMissionById(5);
      const dir = new MissionDirector(m5, 'normal');

      // Complete Stage 1 (3 vats) so Stage 2 (obj_ind_resistance, targetCount = 12) is active
      dir.onDestructibleTargetDestroyed(300, 'fuel_tank', 'vat_1', 'weapon');
      dir.onDestructibleTargetDestroyed(300, 'fuel_tank', 'vat_2', 'weapon');
      dir.onDestructibleTargetDestroyed(300, 'fuel_tank', 'vat_3', 'weapon');
      expect(dir.getActiveStageIndex()).toBe(2);

      // Suppose player killed 8 of the 12 required enemies (4 required kills remain, only 2 alive enemies left)
      for (let i = 0; i < 8; i++) {
        dir.onEnemyKilled(false, 100);
      }
      dir.update(5.0, 100, 100);

      const decision = dir.evaluateWaveProgression(2);
      expect(decision.shouldSpawnReinforcements).toBe(true);
      expect(decision.spawnCount).toBeGreaterThanOrEqual(3);
      expect(decision.waveStatusText).toContain('REINFORCEMENTS DEPLOYING');
    });
  });

  describe('TRN-14.6 — Checkpoint Persistence with Stage & Bypass State', () => {
    it('restores bypassed objectives, neutralized target IDs, and active stage index across checkpoint recovery', () => {
      const m4 = getMissionById(4);
      const dir = new MissionDirector(m4, 'normal');

      for (let i = 0; i < 10; i++) {
        dir.onEnemyKilled(false, 100);
      }
      dir.onDestructibleTargetDestroyed(300, 'weapons_cache', 'cache_0', 'explosion');
      dir.onDestructibleTargetDestroyed(300, 'weapons_cache', 'cache_1', 'explosion');

      expect(dir.getActiveStageIndex()).toBe(3);
      expect(dir.getBypassedObjectiveIds()).toEqual(['obj_jungle_cache']);

      const snap: MissionCheckpointSnapshot = {
        missionId: 4,
        difficulty: 'normal',
        checkpointSequence: dir.getCheckpointSequence(),
        activeObjectiveIndex: dir.getActiveObjectiveIndex(),
        activeStageIndex: dir.getActiveStageIndex(),
        completedObjectiveIds: dir.getCompletedObjectiveIds(),
        bypassedObjectiveIds: dir.getBypassedObjectiveIds(),
        destroyedTargetIds: dir.getNeutralizedTargetIds(),
        playerSpawn: selectMissionCheckpointAnchor(m4, dir.getActiveObjectiveIndex()),
        healthAtCheckpoint: 85,
        armorAtCheckpoint: 70,
        activeWeaponId: 'assault_rifle',
        weaponAmmoState: {},
        scoreAtCheckpoint: dir.score,
        killsAtCheckpoint: dir.kills,
        headshotsAtCheckpoint: dir.headshots,
        airKillsAtCheckpoint: dir.airKills,
      };

      const restored = new MissionDirector(m4, 'normal', undefined, snap);
      expect(restored.getActiveStageIndex()).toBe(3);
      expect(restored.getBypassedObjectiveIds()).toEqual(['obj_jungle_cache']);
      expect(restored.getNeutralizedTargetIds()).toEqual(['cache_0', 'cache_1']);
      const cacheObj = restored.getObjectiveStatuses().find((o) => o.id === 'obj_jungle_cache')!;
      expect(cacheObj.status).toBe('bypassed');
      expect(cacheObj.bypassed).toBe(true);
    });
  });

  describe('Section 5 — Three-Tier Military Tactical Guidance System', () => {
    const baseCtx: TacticalEvaluationContext = {
      nowSec: 10,
      controlScheme: 'keyboard_mouse',
      tacticalHintsEnabled: true,
      isIntenseCombat: false,
      isPlayerDowned: false,
      isNukeActive: false,
      healthPct: 0.9,
      magazineAmmo: 20,
      reserveAmmo: 120,
      isReloading: false,
      isNearDemolitionCache: false,
      isNearSabotageTarget: false,
      isNearVehicle: false,
      isInsideVehicle: false,
      hasActiveAirObjective: false,
      hasEquippedStingerOrRpg: false,
      hasC4Available: true,
      isPlantChargeStageActive: false,
      extractionStatus: 'not_applicable',
      extractionBlockReason: null,
      isPlayerNearExtraction: false,
      activeObjectiveType: 'eliminate_wave',
    };

    it('prioritizes critical survival hints over tactical/onboarding hints, suppresses onboarding during intense combat, and respects dismissal and settings toggles', () => {
      const guidance = new TacticalGuidanceSystem();

      // 1. Critical low health overrides everything
      const critHint = guidance.evaluateTier1Hint({
        ...baseCtx,
        healthPct: 0.22,
        isNearDemolitionCache: true,
      });
      expect(critHint?.id).toBe('critical_find_cover');
      expect(critHint?.priority).toBe('critical');

      // 2. Near demolition cache triggers tactical_plant_charge_near
      const demoHint = guidance.evaluateTier1Hint({
        ...baseCtx,
        nowSec: 15,
        isNearDemolitionCache: true,
      });
      expect(demoHint?.id).toBe('tactical_plant_charge_near');
      expect(demoHint?.priority).toBe('tactical');

      // 3. Dismissing tactical_plant_charge_near suppresses it permanently until reset
      missionSelectionStore.getState().dismissTacticalHint('tactical_plant_charge_near');
      expect(
        guidance.evaluateTier1Hint({
          ...baseCtx,
          nowSec: 20,
          isNearDemolitionCache: true,
        })
      ).toBeNull();

      // 4. Onboarding hint is suppressed during intense combat
      expect(
        guidance.evaluateTier1Hint({
          ...baseCtx,
          nowSec: 25,
          isIntenseCombat: true,
          hasActiveAirObjective: true,
          hasEquippedStingerOrRpg: false,
        })
      ).toBeNull();

      // 5. When intense combat subsides, onboarding_air_lock appears
      const airHint = guidance.evaluateTier1Hint({
        ...baseCtx,
        nowSec: 26,
        isIntenseCombat: false,
        hasActiveAirObjective: true,
        hasEquippedStingerOrRpg: false,
      });
      expect(airHint?.id).toBe('onboarding_air_lock');

      // 6. Disabling tacticalHintsEnabled suppresses non-critical hints
      expect(
        guidance.evaluateTier1Hint({
          ...baseCtx,
          nowSec: 30,
          tacticalHintsEnabled: false,
          hasActiveAirObjective: true,
        })
      ).toBeNull();

      // 7. Tier 2 radio deduplication & Tier 3 mechanic cards
      expect(guidance.shouldEmitRadioSubtitle('stage_2_active', 30, 8)).toBe(true);
      expect(guidance.shouldEmitRadioSubtitle('stage_2_active', 33, 8)).toBe(false);
      expect(guidance.shouldEmitRadioSubtitle('stage_2_active', 40, 8)).toBe(true);
      expect(TIER3_MECHANIC_CARDS.length).toBeGreaterThanOrEqual(6);
    });
  });
});
