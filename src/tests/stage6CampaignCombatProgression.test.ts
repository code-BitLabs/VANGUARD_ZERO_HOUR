import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { MUSIC_TRACK_CATALOG } from '@/src/audio/MusicCatalog';
import { MusicPlayerController, MusicTrackLoader } from '@/src/audio/MusicPlayerController';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import {
  computeCombinedModifierEffects,
  evaluateWeaponMastery,
  getChallengesForMission,
  REPLAY_MODIFIERS,
  TACTICAL_CHALLENGES,
} from '@/src/data/challenges';
import { MISSION_CATALOG } from '@/src/data/missions';
import { ACHIEVEMENT_DEFINITIONS } from '@/src/data/ranks';
import { VFXPool } from '@/src/effects/VFXPool';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { PlaytestExperienceTracker } from '@/src/gameplay/diagnostics/PlaytestTelemetrySummary';
import { EncounterDirector } from '@/src/gameplay/EncounterDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { SquadTacticsCoordinator } from '@/src/gameplay/ai/SquadTacticsCoordinator';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { migrateProgressionSave } from '@/src/schemas/save.schema';
import { AudioSettingsSchema } from '@/src/schemas/settings.schema';
import { progressionStore } from '@/src/stores/progressionStore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

function createMockAudioContext() {
  let ctxTime = 0;
  let activeCreatedSources = 0;
  let activeStoppedSources = 0;

  const makeGain = () => ({
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(function (this: { value: number }, v: number) {
        this.value = v;
      }),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  const ctx = {
    get currentTime() {
      return ctxTime;
    },
    state: 'running' as AudioContextState,
    sampleRate: 22050,
    destination: {},
    advanceTime(sec: number) {
      ctxTime += sec;
    },
    createGain: vi.fn(() => makeGain()),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: vi.fn(() => {
      activeCreatedSources++;
      let stopped = false;
      return {
        buffer: null as AudioBuffer | null,
        loop: false,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(() => {
          if (!stopped) {
            stopped = true;
            activeStoppedSources++;
          }
        }),
      };
    }),
    resume: vi.fn(async () => {}),
    suspend: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    getStats: () => ({
      created: activeCreatedSources,
      stopped: activeStoppedSources,
      live: activeCreatedSources - activeStoppedSources,
    }),
  };

  return ctx as unknown as AudioContext & {
    advanceTime: (sec: number) => void;
    getStats: () => { created: number; stopped: number; live: number };
  };
}

describe('TRN-30: Campaign Experience, Encounter Director & Live Mission Set Pieces', () => {
  it('assigns distinct mission-tailored reinforcement archetypes across all 5 canonical missions', () => {
    const director = new EncounterDirector();
    const seenByMission = new Map<number, Set<string>>();

    for (const mission of MISSION_CATALOG) {
      director.reset(mission.id);
      const set = new Set<string>();
      for (let stage = 1; stage <= 3; stage++) {
        const w1 = director.selectReinforcementWave(mission.id, stage, 3);
        const w2 = director.selectReinforcementWave(mission.id, stage, 3);
        set.add(w1.archetype);
        set.add(w2.archetype);
        expect(w1.radioCallout.length).toBeGreaterThan(12);
        expect(w1.count).toBeGreaterThanOrEqual(2);
      }
      seenByMission.set(mission.id, set);
    }

    // M2 features vehicle_crew/heavy_armor; M3 features drone_operator/sniper; M5 features heavy_armor/rocket_trooper
    expect(seenByMission.get(2)?.has('vehicle_crew')).toBe(true);
    expect(seenByMission.get(3)?.has('drone_operator')).toBe(true);
    expect(seenByMission.get(3)?.has('sniper')).toBe(true);
    expect(seenByMission.get(5)?.has('heavy_armor')).toBe(true);
    expect(seenByMission.get(5)?.has('rocket_trooper')).toBe(true);
  });

  it('triggers M1 counter-flank, M2 refinery alarm, M4 bridgehead ambush, and M5 extraction pursuit once each', () => {
    const director = new EncounterDirector();

    // Mission 1: Stage 2 triggers AA counter-flank once
    director.reset(1);
    const m1a = director.update({
      dt: 0.1,
      elapsedSec: 25,
      missionId: 1,
      activeStageIndex: 2,
      totalStages: 3,
      extractionAvailable: false,
      aliveEnemies: 4,
      anyEnemyHasLos: true,
      hasActiveBoss: false,
      playerPos: new THREE.Vector3(0, 0, -10),
      playerAlive: true,
      playerInVehicle: false,
    });
    expect(m1a.triggeredSetPieceId).toBe('m1_aa_counterflank');
    expect(m1a.reinforcementSpec).not.toBeNull();

    const m1b = director.update({
      dt: 0.1,
      elapsedSec: 26,
      missionId: 1,
      activeStageIndex: 2,
      totalStages: 3,
      extractionAvailable: false,
      aliveEnemies: 4,
      anyEnemyHasLos: true,
      hasActiveBoss: false,
      playerPos: new THREE.Vector3(0, 0, -10),
      playerAlive: true,
      playerInVehicle: false,
    });
    expect(m1b.triggeredSetPieceId).toBeNull();

    // Mission 2: pushing north of z < -20 triggers refinery perimeter breach
    director.reset(2);
    const m2 = director.update({
      dt: 0.1,
      elapsedSec: 30,
      missionId: 2,
      activeStageIndex: 2,
      totalStages: 3,
      extractionAvailable: false,
      aliveEnemies: 3,
      anyEnemyHasLos: false,
      hasActiveBoss: false,
      playerPos: new THREE.Vector3(4, 0, -25),
      playerAlive: true,
      playerInVehicle: true,
    });
    expect(m2.triggeredSetPieceId).toBe('m2_depot_perimeter_alarm');

    // Mission 4: crossing bridgehead z < 12 triggers ambush
    director.reset(4);
    const m4 = director.update({
      dt: 0.1,
      elapsedSec: 18,
      missionId: 4,
      activeStageIndex: 1,
      totalStages: 3,
      extractionAvailable: false,
      aliveEnemies: 5,
      anyEnemyHasLos: true,
      hasActiveBoss: false,
      playerPos: new THREE.Vector3(0, 0, 8),
      playerAlive: true,
      playerInVehicle: false,
    });
    expect(m4.triggeredSetPieceId).toBe('m4_bridgehead_ambush');

    // Mission 5: molten slag hazard deals heat damage on foot & extraction triggers pursuit
    director.reset(5);
    let slagDamage = 0;
    for (let i = 0; i < 6; i++) {
      const out = director.update({
        dt: 0.1,
        elapsedSec: 40 + i * 0.1,
        missionId: 5,
        activeStageIndex: 2,
        totalStages: 3,
        extractionAvailable: false,
        aliveEnemies: 4,
        anyEnemyHasLos: false,
        hasActiveBoss: false,
        playerPos: new THREE.Vector3(-22, 0.2, -2),
        playerAlive: true,
        playerInVehicle: false,
      });
      slagDamage += out.environmentalHazardDamage;
    }
    expect(slagDamage).toBeGreaterThan(0);

    const m5Ex = director.update({
      dt: 0.1,
      elapsedSec: 90,
      missionId: 5,
      activeStageIndex: 3,
      totalStages: 3,
      extractionAvailable: true,
      aliveEnemies: 2,
      anyEnemyHasLos: false,
      hasActiveBoss: false,
      playerPos: new THREE.Vector3(0, 0, -30),
      playerAlive: true,
      playerInVehicle: false,
    });
    expect(m5Ex.phase).toBe('EXTRACTION_PURSUIT');
    expect(m5Ex.triggeredSetPieceId).toBe('m5_extraction_pursuit');
    expect(m5Ex.recommendedMood).toBe('mission_climax');
  });

  it('sweeps M3 night searchlights, detects exposed players, and disables beams when towers are destroyed', () => {
    const director = new EncounterDirector();
    director.reset(3);
    const towers = director.getSearchlights();
    expect(towers.length).toBe(2);

    // At elapsedSec = 0, west tower at (-18, 9.5, -14) points along baseYaw = 0.45 rad
    const beamX = -18 + Math.sin(0.45) * 16;
    const beamZ = -14 + Math.cos(0.45) * 16;

    const spotted = director.update({
      dt: 0.1,
      elapsedSec: 0,
      missionId: 3,
      activeStageIndex: 1,
      totalStages: 3,
      extractionAvailable: false,
      aliveEnemies: 4,
      anyEnemyHasLos: false,
      hasActiveBoss: false,
      playerPos: new THREE.Vector3(beamX, 0, beamZ),
      playerAlive: true,
      playerInVehicle: false,
    });
    expect(spotted.searchlightDetectedPlayer).toBe(true);
    expect(spotted.triggeredSetPieceId).toBe('m3_searchlight_spot');

    // Destroy both searchlight towers -> no longer detects player & optional objective unlockable
    expect(director.markSearchlightDestroyed('m3_searchlight_west')).toBe(true);
    expect(director.areAllSearchlightsDisabled()).toBe(false);
    expect(director.markSearchlightDestroyed('m3_searchlight_east')).toBe(true);
    expect(director.areAllSearchlightsDisabled()).toBe(true);

    const afterDestroy = director.update({
      dt: 0.1,
      elapsedSec: 10,
      missionId: 3,
      activeStageIndex: 1,
      totalStages: 3,
      extractionAvailable: false,
      aliveEnemies: 4,
      anyEnemyHasLos: false,
      hasActiveBoss: false,
      playerPos: new THREE.Vector3(beamX, 0, beamZ),
      playerAlive: true,
      playerInVehicle: false,
    });
    expect(afterDestroy.searchlightDetectedPlayer).toBe(false);
    expect(director.recordOptionalObjectiveCompleted('m3_blackout_searchlights')).toBe(true);
    expect(director.recordOptionalObjectiveCompleted('m3_blackout_searchlights')).toBe(false);
    expect(director.getOptionalObjectivesCompletedCount()).toBe(1);
  });
});

describe('TRN-31: Squad Tactics Coordinator & Boss Encounter Mechanics', () => {
  it('differentiates all 7 enemy archetypes across suppress-and-flank, overwatch relocation, anti-armor, and fallback postures', () => {
    const tactics = new SquadTacticsCoordinator();

    const orders = tactics.evaluateSquads(
      [
        {
          id: 'u_heavy',
          squadId: 'sq_alpha',
          archetype: 'heavy_armor',
          role: 'suppressor',
          alive: true,
          healthRatio: 1,
          hasLos: true,
          isSuppressedOrHit: false,
          distanceToPlayer: 26,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 4,
        },
        {
          id: 'u_raider',
          squadId: 'sq_alpha',
          archetype: 'elite_assault',
          role: 'flanker',
          alive: true,
          healthRatio: 1,
          hasLos: false,
          isSuppressedOrHit: false,
          distanceToPlayer: 22,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 0,
        },
        {
          id: 'u_sniper',
          squadId: 'sq_bravo',
          archetype: 'sniper',
          role: 'marksman',
          alive: true,
          healthRatio: 1,
          hasLos: true,
          isSuppressedOrHit: false,
          distanceToPlayer: 55,
          elevationDelta: 4,
          shotsFiredSinceRelocate: 3,
        },
        {
          id: 'u_rocket',
          squadId: 'sq_bravo',
          archetype: 'rocket_trooper',
          role: 'anti_armor',
          alive: true,
          healthRatio: 1,
          hasLos: true,
          isSuppressedOrHit: false,
          distanceToPlayer: 34,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 0,
        },
        {
          id: 'u_drone',
          squadId: 'sq_bravo',
          archetype: 'drone_operator',
          role: 'operator',
          alive: true,
          healthRatio: 1,
          hasLos: false,
          isSuppressedOrHit: false,
          distanceToPlayer: 38,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 0,
        },
        {
          id: 'u_crew',
          squadId: 'sq_charlie',
          archetype: 'vehicle_crew',
          role: 'suppressor',
          alive: true,
          healthRatio: 1,
          hasLos: true,
          isSuppressedOrHit: false,
          distanceToPlayer: 24,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 0,
        },
        {
          id: 'u_inf',
          squadId: 'sq_charlie',
          archetype: 'infantry',
          role: 'rifleman',
          alive: true,
          healthRatio: 1,
          hasLos: true,
          isSuppressedOrHit: false,
          distanceToPlayer: 25,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 0,
        },
      ],
      true,
      true
    );

    expect(orders.get('u_heavy')?.order).toBe('PIN_SUPPRESS');
    expect(orders.get('u_heavy')?.squadPosture).toBe('SUPPRESS_AND_FLANK');
    expect(['FLANK_LEFT', 'FLANK_RIGHT']).toContain(orders.get('u_raider')?.order);
    expect(orders.get('u_sniper')?.order).toBe('OVERWATCH_HOLD');
    expect(orders.get('u_sniper')?.shouldRelocateOverwatch).toBe(true);
    expect(orders.get('u_rocket')?.order).toBe('ANTI_ARMOR_FLUSH');
    expect(orders.get('u_rocket')?.priorityTargetPlayerVehicle).toBe(true);
    expect(orders.get('u_drone')?.order).toBe('BACKLINE_DRONE_SUPPORT');
    expect(orders.get('u_crew')?.order).toBe('PIN_SUPPRESS');
    expect(orders.get('u_inf')?.order).toBe('COVER_ADVANCE');

    // Casualty fallback: when sq_alpha loses 1 of 2 members (50% casualty ratio), survivor shifts to FALLBACK_REGROUP
    const fallbackOrders = tactics.evaluateSquads(
      [
        {
          id: 'u_heavy',
          squadId: 'sq_alpha',
          archetype: 'heavy_armor',
          role: 'suppressor',
          alive: false,
          healthRatio: 0,
          hasLos: false,
          isSuppressedOrHit: false,
          distanceToPlayer: 26,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 0,
        },
        {
          id: 'u_raider',
          squadId: 'sq_alpha',
          archetype: 'elite_assault',
          role: 'flanker',
          alive: true,
          healthRatio: 0.45,
          hasLos: true,
          isSuppressedOrHit: true,
          distanceToPlayer: 18,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 0,
        },
      ],
      false,
      false
    );
    expect(fallbackOrders.get('u_raider')?.squadPosture).toBe('FALLBACK_REGROUP');
    expect(fallbackOrders.get('u_raider')?.order).toBe('REGROUP_FALLBACK');
  });

  it('cycles boss gunship attack phases, emits threat warning on salvo telegraph, and applies 1.45x vulnerability multiplier', () => {
    const scene = new THREE.Scene();
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, AudioSettingsSchema.parse({}));
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const coord = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(vfx, telemetry);
    const air = new AirCombatManager(scene, rm, vfx, audio, coord, ballistics, telemetry);
    const collisionWorld = new CollisionWorld();
    const player = new PlayerController(audio);
    player.spawn(0, 1.65, 20, 0);

    air.spawnUnit('gunship', 26, 36, 0, 'mission:1');
    const gunship = air.getUnits()[0];
    expect(gunship).toBeDefined();
    expect(gunship.bossAttackPhase).toBe('PATROL');
    expect(gunship.isVulnerable).toBe(false);

    // Advance into SALVO_TELEGRAPH and confirm active threat warning
    gunship.detectedPlayer = true;
    gunship.hasLos = true;
    gunship.initialGraceTimerSec = 0;
    gunship.bossAttackPhase = 'SALVO_TELEGRAPH';
    gunship.bossPhaseTimerSec = 0.7;

    const warn = air.getActiveBossThreatWarning(player);
    expect(warn).not.toBeNull();
    expect(warn?.kind).toBe('rocket');

    const telegraphInfo = air.getActiveBossInfo({
      playerPosition: player.position,
      isPrimaryObjective: true,
    });
    expect(telegraphInfo?.phaseLabel).toContain('SALVO');
    expect(telegraphInfo?.isVulnerable).toBe(false);

    // Normal damage vs COOLING_VULNERABLE 1.45x damage
    const startHp = gunship.health;
    air.damageUnit(gunship, 100);
    expect(startHp - gunship.health).toBeCloseTo(100, 1);

    gunship.bossAttackPhase = 'COOLING_VULNERABLE';
    gunship.isVulnerable = true;
    const vulnInfo = air.getActiveBossInfo({
      playerPosition: player.position,
      isPrimaryObjective: true,
    });
    expect(vulnInfo?.isVulnerable).toBe(true);
    expect(vulnInfo?.phaseLabel).toContain('VULNERABLE');

    const beforeVulnHp = gunship.health;
    air.damageUnit(gunship, 100);
    expect(beforeVulnHp - gunship.health).toBeCloseTo(145, 1);

    // Confirm phase transitions under update loop without NaN
    air.update(0.1, player, collisionWorld);
    expect(Number.isFinite(gunship.position.x)).toBe(true);
    rm.unloadScope('mission:1');
  });
});

describe('TRN-32: Destructible Searchlight Towers, Wooden Cover Crates & Zero-Leak World Unload', () => {
  it('builds all 5 canonical missions with M3 destructible searchlights, wooden cover crates, and zero ResourceManager mission leaks', () => {
    const rm = new ResourceManager();
    const assetMgr = new AssetManager(rm);
    const audio = new AudioManager(rm, AudioSettingsSchema.parse({}));

    rm.recordBaseline();

    for (const mission of MISSION_CATALOG) {
      const scene = new THREE.Scene();
      const collisionWorld = new CollisionWorld();
      const chunkManager = new WorldChunkManager();
      const vfx = new VFXPool(scene, rm);
      const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);

      const built = buildWorldMap(
        mission.mapId,
        mission.id,
        scene,
        assetMgr,
        rm,
        collisionWorld,
        chunkManager,
        destruction
      );

      const crates = destruction.getAll().filter((e) => e.kind === 'wooden_crate');
      expect(crates.length).toBeGreaterThanOrEqual(3);

      if (mission.id === 3) {
        const towers = destruction.getAll().filter((e) => e.kind === 'searchlight_tower');
        expect(towers.length).toBe(2);
        const west = towers.find((t) => t.id === 'm3_searchlight_west');
        expect(west).toBeDefined();
        const beamBefore = west!.meshGroup.getObjectByName('searchlight_beam');
        expect(beamBefore?.visible).toBe(true);

        const destroyed = destruction.applyDamage(west!.id, 999, () => {});
        expect(destroyed).toBe(true);
        expect(beamBefore?.visible).toBe(false);
      }

      expect(built.supplyCrates.length).toBeGreaterThanOrEqual(3);

      destruction.clear();
      collisionWorld.clear();
      chunkManager.clear(scene);
      vfx.resetAll();
      rm.unloadScope('mission:world');
      rm.unloadScope(`mission:${mission.id}`);
      const audit = rm.recordPostUnloadAudit();
      expect(audit.hasMissionLeak).toBe(false);
    }
  });
});

describe('TRN-33: Adaptive Background Music Director Hysteresis & Manual Override Respect', () => {
  it('transitions smoothly by mood with hysteresis and strictly yields when the player manually selects a track', async () => {
    const mockCtx = createMockAudioContext();
    const destGain = mockCtx.createGain();
    const loader: MusicTrackLoader = {
      loadTrack: async (track, ctx) => ctx.createBuffer(2, Math.floor(track.durationSec * 100), 100),
    };

    const ctrl = new MusicPlayerController({
      tracks: MUSIC_TRACK_CATALOG,
      initialTrackId: MUSIC_TRACK_CATALOG[0].id,
      customLoader: loader,
    });
    ctrl.attachAudioContext(mockCtx, destGain);
    await ctrl.play();

    // Force immediate mood shift to mission_climax
    await ctrl.applyAdaptiveMood('mission_climax', true);
    const climaxSnap = ctrl.getSnapshot();
    expect(climaxSnap.trackMood).toBe('mission_climax');
    expect(climaxSnap.activeSourceCount).toBe(1);

    // Within 14s hysteresis cooldown, a non-forced shift to atmospheric_exploration must be ignored
    await ctrl.applyAdaptiveMood('atmospheric_exploration', false);
    expect(ctrl.getSnapshot().trackMood).toBe('mission_climax');

    // Advance 15s (using fixed <=0.25s simulation ticks) and confirm adaptive mood shifts smoothly
    for (let i = 0; i < 64; i++) {
      ctrl.tick(0.25);
    }
    await ctrl.applyAdaptiveMood('atmospheric_exploration', false);
    expect(ctrl.getSnapshot().trackMood).toBe('atmospheric_exploration');
    expect(ctrl.getSnapshot().activeSourceCount).toBe(1);

    // Player manually picks track 0 -> userTrackLocked = true, adaptive must yield!
    await ctrl.selectTrack(MUSIC_TRACK_CATALOG[0].id, { autoPlay: true, fromUser: true });
    expect(ctrl.getSnapshot().userTrackLocked).toBe(true);
    for (let i = 0; i < 80; i++) {
      ctrl.tick(0.25);
    }
    await ctrl.applyAdaptiveMood('mission_climax', true);
    expect(ctrl.getSnapshot().trackId).toBe(MUSIC_TRACK_CATALOG[0].id);

    // Re-enabling adaptive unlocks user override
    ctrl.setAdaptiveEnabled(true);
    expect(ctrl.getSnapshot().userTrackLocked).toBe(false);
    await ctrl.applyAdaptiveMood('mission_climax', true);
    expect(ctrl.getSnapshot().trackMood).toBe('mission_climax');
    expect(mockCtx.getStats().live).toBe(1);
    ctrl.dispose();
  });
});

describe('TRN-34: Save Schema Revision 3 Migration, Replay Modifiers, Challenges & Weapon Mastery', () => {
  it('upgrades canonical v2 saves to schemaRevision 4 without losing existing progress', () => {
    const v2Rev2 = migrateProgressionSave({
      version: 2,
      schemaRevision: 2,
      xp: 900,
      requisitionPoints: 250,
      totalKills: 42,
      totalHeadshots: 11,
    });
    expect(v2Rev2.recoveredFromCorruption).toBe(false);
    expect(v2Rev2.save.version).toBe(2);
    expect(v2Rev2.save.schemaRevision).toBe(4);
    expect(v2Rev2.save.xp).toBe(900);
    expect(v2Rev2.save.completedChallenges).toEqual([]);
    expect(v2Rev2.save.activeModifiers).toEqual([]);
    expect(v2Rev2.save.weaponMasteryKills).toEqual({});

    const v2Legacy = migrateProgressionSave({
      version: 2,
      xp: 1400,
      requisitionPoints: 500,
      totalKills: 70,
      totalHeadshots: 25,
      achievements: ['first_blood'],
      missionRecords: {
        '1': { missionId: 1, completed: true, bestScore: 3200, bestHeadshots: 6 },
      },
      weaponUpgrades: {},
      updatedAt: 1000,
    });
    expect(v2Legacy.recoveredFromCorruption).toBe(false);
    expect(v2Legacy.save.schemaRevision).toBe(4);
    expect(v2Legacy.save.missionRecords['1'].bestScore).toBe(3200);
    expect(v2Legacy.save.missionRecords['1'].optionalObjectivesCompleted).toBe(0);
  });

  it('defines 10 mission challenges (2 per mission), 4 replay modifiers, 10 commendations, and evaluates progression rewards', () => {
    expect(TACTICAL_CHALLENGES.length).toBe(10);
    for (let m = 1; m <= 5; m++) {
      expect(getChallengesForMission(m).length).toBe(2);
    }
    expect(REPLAY_MODIFIERS.length).toBe(4);
    expect(ACHIEVEMENT_DEFINITIONS.length).toBe(10);

    const combined = computeCombinedModifierEffects(['scarce_supply', 'iron_operator']);
    expect(combined.ammoGrantScale).toBe(0.65);
    expect(combined.disableCheckpoints).toBe(true);
    expect(combined.requisitionBonusPct).toBe(60);
    expect(combined.scoreMultiplier).toBeGreaterThan(1.5);

    const masteryBefore = evaluateWeaponMastery('assault_rifle', 0);
    const masteryAfter = evaluateWeaponMastery('assault_rifle', 25);
    expect(masteryBefore.tier).toBe('unranked');
    expect(masteryAfter.tier).toBe('silver');

    progressionStore.getState().resetAllProgress();
    progressionStore.getState().toggleModifier('precision_doctrine');
    expect(progressionStore.getState().save.activeModifiers).toContain('precision_doctrine');

    const outcome = progressionStore.getState().recordMissionResult({
      missionId: 1,
      difficulty: 'hard',
      victory: true,
      score: 4000,
      grade: 'S',
      xpEarned: 600,
      requisitionEarned: 200,
      kills: 26,
      headshots: 10,
      airKills: 1,
      durationSec: 180,
      accuracyPct: 55,
      deathsCount: 0,
      optionalObjectivesCompleted: 1,
      killsByWeapon: { assault_rifle: 26 },
      activeModifiers: ['precision_doctrine'],
    });

    expect(outcome.newChallenges).toContain('m1_urban_surgeon');
    expect(outcome.newChallenges).toContain('m1_clean_sweep');
    expect(outcome.challengeXpBonus).toBeGreaterThan(0);
    expect(outcome.modifierReqBonus).toBe(50); // 25% of 200 REQ
    expect(outcome.masteryTierUps.some((t) => t.weaponId === 'assault_rifle')).toBe(true);
    expect(outcome.newAchievements).toContain('tactical_specialist');
    expect(outcome.newAchievements).toContain('iron_vanguard');
    expect(outcome.newAchievements).toContain('weapon_master');

    progressionStore.getState().clearModifiers();
    expect(progressionStore.getState().save.activeModifiers).toEqual([]);
    progressionStore.getState().resetAllProgress();
  });
});

describe('TRN-35: Bounded Privacy-Conscious Local Playtest Telemetry', () => {
  it('caps death location samples at MAX_DEATH_SAMPLES and emits zero PII', () => {
    const tracker = new PlaytestExperienceTracker();
    tracker.reset();

    for (let i = 0; i < 30; i++) {
      tracker.recordDeathLocation({
        elapsedSec: i * 5,
        x: i,
        y: 0,
        z: -i,
        attackerArchetype: 'sniper',
        weaponLabel: 'M24-S',
      });
    }

    tracker.recordVehicleTime(12.5, true); // clamped per step to 0.25s -> verifies dt safety
    tracker.observeActiveWeaponAmmo(0, 0);
    tracker.observeActiveWeaponAmmo(0, 0); // consecutive dry frame does not double-count
    tracker.observeActiveWeaponAmmo(30, 60);
    tracker.observeActiveWeaponAmmo(0, 0); // second exhaustion event
    tracker.recordExtractionAttempt();
    tracker.recordCheckpointRestart();

    const report = tracker.buildReport({
      missionId: 5,
      difficulty: 'normal',
      activeModifiers: ['scarce_supply'],
      outcome: 'victory',
      grade: 'A',
      durationSec: 210,
      timeFirstDetectionSec: 4.5,
      timeFirstDamageSec: 9.2,
      timeFirstKillSec: 11.0,
      kills: 24,
      headshots: 7,
      playerAccuracyPct: 48.5,
      deathsCount: 1,
      resupplyStationsUsed: 3,
      healthPickupsCollected: 4,
      optionalObjectivesCompleted: 1,
      objectiveCompletedAtSec: { m5_obj1: 65, m5_obj2: 140 },
      killsByWeapon: { assault_rifle: 20, rocket_launcher: 4 },
      damageByDomain: { ground: 110, air: 25, vehicle: 15 },
    });

    expect(report.deathLocations.length).toBe(PlaytestExperienceTracker.MAX_DEATH_SAMPLES);
    expect(report.ammoExhaustionEvents).toBe(2);
    expect(report.extractionAttempts).toBe(1);
    expect(report.checkpointRestarts).toBe(1);
    expect(report.vehicleUsageSec).toBe(0.3);
    expect(report.privacyNotice).toContain('Local-only');
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/email|ipAddress|userAgent|cookie/i);
  });
});
