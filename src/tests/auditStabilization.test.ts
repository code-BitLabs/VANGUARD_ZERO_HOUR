import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as THREE from 'three';
import { setDevModeEnvOverrideForTests } from '@/src/config/devMode';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { getMissionById } from '@/src/data/missions';
import { DebugTelemetryPublisher } from '@/src/engine/DebugTelemetryPublisher';
import { HudSnapshotPublisher } from '@/src/engine/HudSnapshotPublisher';
import { MissionLifecycleLoader } from '@/src/engine/MissionLifecycleLoader';
import { PerformanceMonitor } from '@/src/engine/PerformanceMonitor';
import { TacticalLightBudgetManager } from '@/src/engine/RenderingBenchmarkSlice';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { DiagnosticRulesEngine } from '@/src/gameplay/diagnostics/DiagnosticRulesEngine';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { ProgressionSaveSchema } from '@/src/schemas/save.schema';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { audioSettingsStore } from '@/src/stores/audioSettingsStore';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { BACKUP_KEY, SAVE_KEY, SaveManager } from '@/src/storage/SaveManager';
import { SettingsManager } from '@/src/storage/SettingsManager';
import { clearMemoryStorageFallbackForTests } from '@/src/storage/safeStorage';
import { CombatDebugOverlay } from '@/src/ui/debug/CombatDebugOverlay';
import { SquadCommandHud } from '@/src/ui/hud/SquadCommandHud';
import { WorkerBridge } from '@/src/workers/WorkerBridge';
import { DestructionSystem } from '@/src/world/DestructionSystem';

interface MockAudioHandles {
  sources: Array<{
    disconnect: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }>;
  panners: Array<{
    panningModel: string;
    disconnect: ReturnType<typeof vi.fn>;
  }>;
  gains: Array<{
    disconnect: ReturnType<typeof vi.fn>;
  }>;
}

function installMockAudioContext(): MockAudioHandles {
  const handles: MockAudioHandles = { sources: [], panners: [], gains: [] };

  class MockAudioContext {
    state: AudioContextState = 'running';
    currentTime = 0;
    sampleRate = 44100;
    destination = {} as AudioDestinationNode;
    listener = {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: -1 },
      upX: { value: 0 },
      upY: { value: 1 },
      upZ: { value: 0 },
    };

    resume = vi.fn(() => Promise.resolve());
    suspend = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());

    createGain() {
      const g = {
        gain: { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      handles.gains.push(g);
      return g as unknown as GainNode;
    }

    createBuffer(_ch: number, length: number, sampleRate: number) {
      const chData = new Float32Array(length);
      return {
        length,
        sampleRate,
        duration: length / sampleRate,
        numberOfChannels: 1,
        getChannelData: () => chData,
      } as unknown as AudioBuffer;
    }

    createBufferSource() {
      const s = {
        buffer: null as AudioBuffer | null,
        loop: false,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      handles.sources.push(s);
      return s as unknown as AudioBufferSourceNode;
    }

    createPanner() {
      const p = {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 1,
        maxDistance: 100,
        rolloffFactor: 1,
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      handles.panners.push(p);
      return p as unknown as PannerNode;
    }

    createConvolver() {
      return {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as ConvolverNode;
    }

    createOscillator() {
      return {
        type: 'sine',
        frequency: { value: 440, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      } as unknown as OscillatorNode;
    }

    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: { value: 1000 },
        Q: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as BiquadFilterNode;
    }
  }

  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: MockAudioContext,
  });

  return handles;
}

describe('Stage 10 Audit Stabilization Suite (AUD-01 .. AUD-12)', () => {
  const originalAudioCtxDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
  const originalWorker = globalThis.Worker;
  const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeEach(() => {
    clearMemoryStorageFallbackForTests();
    gameSessionStore.getState().resetSession();
    uiStore.getState().setCombatDebugOpen(false);
    uiStore.getState().setCombatDebugCollapsed(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearMemoryStorageFallbackForTests();
    uiStore.getState().setScreen('title');
    settingsStore.getState().updateDeveloper({ devModeEnabled: false });
    setDevModeEnvOverrideForTests(null);
    if (originalAudioCtxDescriptor) {
      Object.defineProperty(window, 'AudioContext', originalAudioCtxDescriptor);
    } else {
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    }
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
    }
    globalThis.Worker = originalWorker;
  });

  it('AUD-01 & AUD-05: AudioManager prewarms core buffers, disconnects finished Web Audio nodes, and tiers HRTF vs equalpower by distance', () => {
    const handles = installMockAudioContext();
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, { ...audioSettingsStore.getState(), muted: false });

    audio.unlock();
    const built = audio.prewarmBuffersSync(['shot_rifle', 'explosion', 'hit_marker']);
    expect(built).toBeGreaterThanOrEqual(3);
    expect(audio.hasCachedBuffer('shot_rifle')).toBe(true);
    expect(audio.hasCachedBuffer('explosion')).toBe(true);
    expect(audio.getCachedBufferCount()).toBeGreaterThanOrEqual(3);

    // Close spatial play (< 35m) -> HRTF + disconnect on ended
    audio.playSpatial('shot_rifle', 10, 1.7, 0, 5, 0.8);
    expect(handles.panners).toHaveLength(1);
    expect(handles.panners[0].panningModel).toBe('HRTF');

    // Distant spatial play (>= 35m) -> equalpower
    audio.playSpatial('shot_rifle', 50, 1.7, 0, 5, 0.8);
    expect(handles.panners).toHaveLength(2);
    expect(handles.panners[1].panningModel).toBe('equalpower');

    // Trigger source completion and ensure source & panner nodes disconnect cleanly
    handles.sources[0].onended?.();
    expect(handles.sources[0].disconnect).toHaveBeenCalledTimes(1);
    expect(handles.panners[0].disconnect).toHaveBeenCalledTimes(1);

    // Trigger idempotency when calling onended again
    handles.sources[0].onended?.();
    expect(handles.sources[0].disconnect).toHaveBeenCalledTimes(1);

    audio.dispose();
  });

  it('AUD-02: Prewarms destruction & vehicle charred materials, diversifies projectile pool materials, and hooks dynamic spawn shadow registration', () => {
    const scene = new THREE.Scene();
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, audioSettingsStore.getState());
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(vfx, telemetry);
    const collisionWorld = new CollisionWorld();

    const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);
    const charredDestructMat = destruction.prewarm(scene);
    expect(charredDestructMat).toBeInstanceOf(THREE.MeshStandardMaterial);
    // Probe added to scene during prewarm, removed on clear
    expect(scene.children.some((c) => c instanceof THREE.Mesh && c.material === charredDestructMat)).toBe(true);
    destruction.clear();
    expect(scene.children.some((c) => c instanceof THREE.Mesh && c.material === charredDestructMat)).toBe(false);

    const vehicles = new VehicleManager(scene, rm, vfx, audio, coordinator, ballistics, telemetry);
    const charredVehMat = vehicles.prewarm();
    expect(charredVehMat).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(scene.children.some((c) => c instanceof THREE.Mesh && c.material === charredVehMat)).toBe(true);
    vehicles.clear();
    expect(scene.children.some((c) => c instanceof THREE.Mesh && c.material === charredVehMat)).toBe(false);

    const projectiles = new ProjectileManager(scene, rm, vfx, audio, telemetry);
    const projRoot = scene.getObjectByName('projectile_pool_root') as THREE.Group;
    const distinctMats = new Set(
      projRoot.children.map((c) => (c as THREE.Mesh).material)
    );
    expect(distinctMats.size).toBe(4);

    const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);
    const addedEnemyObjects: THREE.Object3D[] = [];
    enemies.setOnObjectAddedToScene((obj) => addedEnemyObjects.push(obj));
    enemies.spawnWave('infantry', 2, { x: 0, y: 0, z: -15 }, 2, collisionWorld, 'mission:1');
    expect(addedEnemyObjects).toHaveLength(2);

    const airCombat = new AirCombatManager(scene, rm, vfx, audio, coordinator, ballistics, telemetry);
    const addedAirObjects: THREE.Object3D[] = [];
    airCombat.setOnObjectAddedToScene((obj) => addedAirObjects.push(obj));
    airCombat.spawnDynamicDrone(4, 0, -10, 'mission:1');
    expect(addedAirObjects).toHaveLength(1);
  });

  it('AUD-03: Skips out-of-FOV LOS raycasts when detailed F4 telemetry is inactive while preserving tick-0 in-FOV checks', () => {
    const scene = new THREE.Scene();
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, audioSettingsStore.getState());
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(vfx, telemetry);
    const collisionWorld = new CollisionWorld();
    const projectiles = new ProjectileManager(scene, rm, vfx, audio, telemetry);
    const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);
    const workerBridge = new WorkerBridge(rm, 'mission:1');
    const player = new PlayerController(audio);
    player.spawn(0, 0, 0, 0, collisionWorld); // facing -Z

    const losSpy = vi.spyOn(ballistics, 'checkLineOfSight');

    // Out of FOV (unit at z=+25 facing +Z away from player at origin) -> skips raycast when detailed telemetry is off
    enemies.setDetailedTelemetryActive(false);
    enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: 25 }, 0, collisionWorld, 'mission:1');
    const outUnit = enemies.getUnits()[0];
    outUnit.initialGraceTimerSec = 0;
    outUnit.yaw = 0;
    enemies.update(1 / 60, player, collisionWorld, [], workerBridge, 0.1);
    expect(losSpy).not.toHaveBeenCalled();

    // Turning detailed telemetry on activates out-of-FOV LOS sampling for debug inspector rows
    enemies.setDetailedTelemetryActive(true);
    enemies.update(0.3, player, collisionWorld, [], workerBridge, 0.1);
    expect(losSpy).toHaveBeenCalled();

    // Clear & verify in-FOV enemy (unit at z=-25 facing +Z directly toward player at origin) DOES run LOS on tick 0 even with telemetry off
    losSpy.mockClear();
    enemies.clear();
    enemies.setDetailedTelemetryActive(false);
    enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: -25 }, 0, collisionWorld, 'mission:1');
    const inUnit = enemies.getUnits()[0];
    inUnit.initialGraceTimerSec = 0;
    inUnit.yaw = 0;
    enemies.update(1 / 60, player, collisionWorld, [], workerBridge, 0.1);
    expect(losSpy).toHaveBeenCalled();
  });

  it('AUD-04: TacticalLightBudgetManager keeps all 8 pooled PointLights visible=true across tier changes and expirations', () => {
    const scene = new THREE.Scene();
    const mgr = new TacticalLightBudgetManager(scene, 'high');
    const poolLights = scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight);
    expect(poolLights).toHaveLength(8);
    expect(poolLights.every((l) => l.visible)).toBe(true);

    mgr.requestTransientLight({
      category: 'explosion',
      x: 5,
      y: 1,
      z: -5,
      colorHex: 0xff8833,
      intensity: 6,
      distance: 12,
      durationSec: 0.2,
    });
    expect(mgr.getActiveLightCount()).toBe(1);

    mgr.setQualityTier('low');
    mgr.setQualityTier('ultra');
    mgr.update(0.5);
    expect(mgr.getActiveLightCount()).toBe(0);
    expect(poolLights.every((l) => l.visible)).toBe(true);
    expect(poolLights.every((l) => l.intensity === 0)).toBe(true);
  });

  it('AUD-06: HudSnapshotPublisher preserves blips and objectives array references when entity/objective state is unchanged', () => {
    const scene = new THREE.Scene();
    const viewModelScene = new THREE.Scene();
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, audioSettingsStore.getState());
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(vfx, telemetry);
    const collisionWorld = new CollisionWorld();
    const projectiles = new ProjectileManager(scene, rm, vfx, audio, telemetry);
    const explosives = new ExplosiveManager(scene, rm, vfx, audio, projectiles, telemetry);
    const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);
    const player = new PlayerController(audio);
    const weapons = new WeaponSystem(viewModelScene, audio, vfx, projectiles);
    const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);
    const vehicles = new VehicleManager(scene, rm, vfx, audio, coordinator, ballistics, telemetry);
    const airCombat = new AirCombatManager(scene, rm, vfx, audio, coordinator, ballistics, telemetry);
    const input = new InputManager(rm, SettingsBundleSchema.parse({}).input);

    const mission = getMissionById(1);
    const missionDirector = new MissionDirector(mission, 'normal', {
      missionId: 1,
      difficulty: 'normal',
      cumulativeElapsedSec: 0,
      checkpointDeathsCount: 0,
    });
    const worldData = {
      coverNodes: [],
      roadWaypoints: [],
      supplyCrates: [],
      animatedProps: [],
      extractionBeacon: null,
      elevatedSurfaces: [],
      navPortals: [],
      cargoLifts: [],
    };
    player.spawn(0, 0, 0, 0);

    const publisher = new HudSnapshotPublisher();
    const ctx = {
      player,
      weapons,
      enemies,
      vehicles,
      airCombat,
      explosives,
      destruction,
      input,
      missionDirector,
      activeMission: mission,
      worldData,
    };

    const snap1 = publisher.buildSnapshot(ctx)!;
    const snap2 = publisher.buildSnapshot(ctx)!;
    expect(snap1.blips).toBe(snap2.blips);
    expect(snap1.objectives).toBe(snap2.objectives);

    // Mutate state by spawning a vehicle so blips list changes identity
    vehicles.spawnVehicle('military_jeep', { x: 12, y: 0, z: -12 }, 0, false, false, collisionWorld, 'mission:1');
    const snap3 = publisher.buildSnapshot(ctx)!;
    expect(snap3.blips).not.toBe(snap2.blips);
    expect(snap3.objectives).toBe(snap2.objectives);
  });

  it('AUD-07: Collapsed F4 diagnostics mode publishes lightweight FPS/coordinator telemetry without per-unit inspector sweeps', () => {
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, audioSettingsStore.getState());
    const scene = new THREE.Scene();
    const viewModelScene = new THREE.Scene();
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(vfx, telemetry);
    const collisionWorld = new CollisionWorld();
    const projectiles = new ProjectileManager(scene, rm, vfx, audio, telemetry);
    const explosives = new ExplosiveManager(scene, rm, vfx, audio, projectiles, telemetry);
    const player = new PlayerController(audio);
    const weapons = new WeaponSystem(viewModelScene, audio, vfx, projectiles);
    const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);
    const vehicles = new VehicleManager(scene, rm, vfx, audio, coordinator, ballistics, telemetry);
    const airCombat = new AirCombatManager(scene, rm, vfx, audio, coordinator, ballistics, telemetry);
    const rulesEngine = new DiagnosticRulesEngine();
    const monitor = new PerformanceMonitor();
    const debugRenderer = { update: vi.fn(), setVisible: vi.fn() };
    const renderer = { getDrawInfo: () => ({ calls: 10, triangles: 100, geometries: 5, textures: 2 }) };

    const enemyInspectorSpy = vi.spyOn(enemies, 'getDebugInspectorRows');
    const vehicleInspectorSpy = vi.spyOn(vehicles, 'getDebugInspectorRows');
    const rulesSpy = vi.spyOn(rulesEngine, 'evaluate');
    const telActiveSpy = vi.spyOn(enemies, 'setDetailedTelemetryActive');

    const publisher = new DebugTelemetryPublisher({
      renderer: renderer as never,
      resourceManager: rm,
      monitor,
      telemetry,
      rulesEngine,
      coordinator,
      debugRenderer: debugRenderer as never,
      collisionWorld,
      player,
      weapons,
      enemies,
      vehicles,
      airCombat,
      projectiles,
      explosives,
      vfx,
      audio,
    });

    setDevModeEnvOverrideForTests({ VITE_DEV_MODE: 'true', DEV: true, PROD: false });
    settingsStore.getState().updateDeveloper({ devModeEnabled: true });
    uiStore.getState().setCombatDebugOpen(true);
    uiStore.getState().setCombatDebugCollapsed(true);

    const coordSpy = vi.spyOn(coordinator, 'getSnapshot');
    const settings = SettingsBundleSchema.parse({
      developer: {
        devModeEnabled: true,
        debugShow3DGizmos: false,
        debugShowFlightPaths: false,
        debugShowPhysicsColliders: false,
      },
    });

    publisher.stepAndPublish(0.6, settings, 'M416-V');

    expect(telActiveSpy).toHaveBeenCalledWith(false);
    expect(coordSpy).toHaveBeenCalledTimes(1);
    expect(enemyInspectorSpy).not.toHaveBeenCalled();
    expect(vehicleInspectorSpy).not.toHaveBeenCalled();
    expect(rulesSpy).not.toHaveBeenCalled();
    expect(debugRenderer.setVisible).toHaveBeenCalledWith(false);
    expect(gameSessionStore.getState().combatDebug).not.toBeNull();

    // Render CombatDebugOverlay in expanded mode and verify active tab isolation
    uiStore.getState().setScreen('playing');
    settingsStore.getState().updateDeveloper({ devModeEnabled: true });
    uiStore.getState().setCombatDebugCollapsed(false);
    render(
      React.createElement(CombatDebugOverlay, {
        onRequestPointerLock: vi.fn(),
      })
    );
    expect(screen.getByText(/Combat & Engine Diagnostics/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Physics' }));
    expect(screen.getByText(/Physics Solver/i)).toBeTruthy();
  });

  it('AUD-08: DestructionSystem caches getAll() cleanly with dirty invalidation and supports O(1) getById()', () => {
    const scene = new THREE.Scene();
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, audioSettingsStore.getState());
    const vfx = new VFXPool(scene, rm);
    const collisionWorld = new CollisionWorld();
    const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);

    const aabb = {
      id: 'barrel_1',
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
      layer: COLLISION_LAYER.DESTRUCTIBLE,
    };
    destruction.register({
      id: 'barrel_1',
      kind: 'barrel',
      isObjectiveTarget: false,
      position: new THREE.Vector3(0.5, 0, 0.5),
      health: 50,
      maxHealth: 50,
      state: 'INTACT',
      blastRadius: 5,
      blastDamage: 80,
      meshGroup: new THREE.Group(),
      collider: aabb,
    });

    const firstList = destruction.getAll();
    const secondList = destruction.getAll();
    expect(firstList).toBe(secondList);
    expect(firstList).toHaveLength(1);
    expect(destruction.getById('barrel_1')?.id).toBe('barrel_1');
    expect(destruction.getById('missing')).toBeUndefined();

    destruction.clear();
    const clearedList = destruction.getAll();
    expect(clearedList).toHaveLength(0);
    expect(destruction.getById('barrel_1')).toBeUndefined();
  });

  it('AUD-09: WorkerBridge coalesces overlapping/adjacent explosion collider regions into one navgrid update', () => {
    const postedMessages: unknown[] = [];
    class MockWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: ErrorEvent) => void) | null = null;
      postMessage = vi.fn((msg: unknown) => {
        postedMessages.push(msg);
      });
      terminate = vi.fn();
    }
    globalThis.Worker = MockWorker as unknown as typeof Worker;

    const rm = new ResourceManager();
    const bridge = new WorkerBridge(rm, 'mission:1');
    const collisionWorld = new CollisionWorld();

    bridge.scheduleCollisionRegionUpdate(0, 0, 2, 2);
    bridge.scheduleCollisionRegionUpdate(8, 8, 10, 10);
    expect(bridge.hasPendingCollisionRegionUpdate()).toBe(true);

    const flushed = bridge.flushCollisionRegionUpdates(collisionWorld.spatialHash);
    expect(flushed).toBe(true);
    expect(bridge.hasPendingCollisionRegionUpdate()).toBe(false);
    expect(postedMessages).toHaveLength(1);
    expect((postedMessages[0] as { type: string }).type).toBe('update_cells');

    // Second flush with no dirty region is a no-op
    expect(bridge.flushCollisionRegionUpdates(collisionWorld.spatialHash)).toBe(false);
    bridge.dispose();
  });

  it('AUD-10: SaveManager and SettingsManager survive SecurityError and recover from QuotaExceededError by shedding secondary keys', () => {
    // 1. Restricted sandbox throwing SecurityError when accessing localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Blocked in sandboxed iframe', 'SecurityError');
      },
    });

    const loadedSave = SaveManager.loadProgression();
    expect(loadedSave.save.xp).toBeGreaterThanOrEqual(0);
    const loadedSettings = SettingsManager.load();
    expect(loadedSettings.version).toBe(2);

    const updatedSave = ProgressionSaveSchema.parse({ ...loadedSave.save, xp: 420 });
    expect(SaveManager.saveProgression(updatedSave)).toBe(true);
    expect(SaveManager.loadProgression().save.xp).toBe(420);

    // 2. QuotaExceededError when BACKUP_KEY occupies quota
    const backing = new Map<string, string>();
    backing.set(BACKUP_KEY, 'legacy_backup_payload');
    const mockStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === SAVE_KEY && backing.has(BACKUP_KEY)) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
        backing.set(k, v);
      },
      removeItem: (k: string) => {
        backing.delete(k);
      },
      clear: () => backing.clear(),
      key: (idx: number) => Array.from(backing.keys())[idx] ?? null,
      get length() {
        return backing.size;
      },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: mockStorage,
    });

    const quotaSave = ProgressionSaveSchema.parse({ ...loadedSave.save, xp: 999 });
    expect(SaveManager.saveProgression(quotaSave)).toBe(true);
    expect(backing.has(BACKUP_KEY)).toBe(false);
    expect(SaveManager.loadProgression().save.xp).toBe(999);
  });

  it('AUD-11: SquadCommandHud does not attach global window mousemove listener while radial menu is closed', () => {
    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    render(
      React.createElement(SquadCommandHud, {
        compactHud: false,
        downedActive: false,
        hud: {
          deploymentMode: 'fireteam',
          inVehicle: false,
          nearSupplySwapStation: false,
          carriedWeaponIds: ['assault_rifle', 'pistol', 'rocket_launcher'],
          squad: {
            activeOrderLabel: 'FOLLOW',
            activeFormation: 'WEDGE',
            squadMedCharges: 2,
            downedCount: 0,
            nearestDownedOperatorId: null,
            nearestDownedDistanceM: 99,
            playerRevivingOperatorId: null,
            playerReviveProgress: 0,
            operators: [],
          },
        },
        onIssueCommand: vi.fn(),
        onSwapFieldWeapon: vi.fn(),
      })
    );

    const mouseMoveCalls = addListenerSpy.mock.calls.filter(([evt]) => evt === 'mousemove');
    expect(mouseMoveCalls).toHaveLength(0);
  });

  it('AUD-12: MissionLifecycleLoader coordinates combat shader prewarming cleanly across decals, destruction, vehicles, and renderer', () => {
    const scene = new THREE.Scene();
    const surfaceDecals = { prewarm: vi.fn() };
    const destruction = { prewarm: vi.fn() };
    const vehicles = { prewarm: vi.fn() };
    const renderer = { scene, registerSceneShadowsAndPrecompile: vi.fn() };

    const loader = new MissionLifecycleLoader({
      renderer: renderer as never,
      assetManager: { getFallbackCount: () => 0 } as never,
      resourceManager: {} as never,
      collisionWorld: {} as never,
      chunkManager: {} as never,
      destruction: destruction as never,
      vehicles: vehicles as never,
      pbrLibrary: {} as never,
      surfaceDecals: surfaceDecals as never,
      battlefieldVfx: {} as never,
      spatialAcoustics: {} as never,
      governor: {} as never,
    });

    loader.prewarmCombatShaders();
    expect(surfaceDecals.prewarm).toHaveBeenCalledTimes(1);
    expect(destruction.prewarm).toHaveBeenCalledWith(scene);
    expect(vehicles.prewarm).toHaveBeenCalledTimes(1);
    expect(renderer.registerSceneShadowsAndPrecompile).toHaveBeenCalledTimes(1);
  });
});
