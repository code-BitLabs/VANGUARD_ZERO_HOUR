import * as THREE from 'three';
import { createActor } from 'xstate';
import { AudioManager } from '@/src/audio/AudioManager';
import { isDeveloperModeActiveForSetting } from '@/src/config/devMode';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { getMissionById } from '@/src/data/missions';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import { VFXPool } from '@/src/effects/VFXPool';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { BallisticSolver, SOLID_OBSTRUCTION_MASK } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { DiagnosticRulesEngine } from '@/src/gameplay/diagnostics/DiagnosticRulesEngine';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ExplosiveCallbacks, ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ExplosionEvent, ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { VEHICLE_CAMERA_MODE_LABELS } from '@/src/gameplay/VehicleCameraRig';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { HitscanTarget, WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { Difficulty, MissionGrade } from '@/src/schemas/common.schema';
import { EXPLOSIVE_BY_ID } from '@/src/schemas/explosive.schema';
import { MiniMapBlip } from '@/src/schemas/events.schema';
import { MissionConfig } from '@/src/schemas/mission.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { audioSettingsStore } from '@/src/stores/audioSettingsStore';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { progressionStore } from '@/src/stores/progressionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { WorkerBridge } from '@/src/workers/WorkerBridge';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { SceneLights, setupLightingRig } from '@/src/world/LightingRig';
import { buildWorldMap, BuiltWorldData } from '@/src/world/MapBuilder';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';
import { CombatDebugRenderer } from './CombatDebugRenderer';
import { engineLifecycleMachine } from './EngineLifecycle';
import { GameLoop } from './GameLoop';
import { detectGpuCapability, GpuCapabilityReport } from './GpuCapabilityDetector';
import { InputManager } from './InputManager';
import { PerformanceGovernor } from './PerformanceGovernor';
import { PerformanceMonitor } from './PerformanceMonitor';
import { EngineRenderer } from './Renderer';

export class GameEngine {
  private readonly resourceManager = new ResourceManager();
  private readonly assetManager: AssetManager;
  private readonly renderer: EngineRenderer;
  private readonly governor: PerformanceGovernor;
  private readonly monitor = new PerformanceMonitor();
  private readonly audio: AudioManager;
  private readonly input: InputManager;
  private readonly loop: GameLoop;
  private readonly lifecycle = createActor(engineLifecycleMachine);

  private readonly collisionWorld = new CollisionWorld();
  private readonly chunkManager = new WorldChunkManager();
  private readonly telemetry = new CombatTelemetryRecorder();
  private readonly rulesEngine = new DiagnosticRulesEngine();
  private readonly coordinator = new CombatEngagementCoordinator(this.telemetry);
  private readonly ballistics: BallisticSolver;
  private readonly debugRenderer: CombatDebugRenderer;
  private readonly vfx: VFXPool;
  private readonly projectiles: ProjectileManager;
  private readonly explosives: ExplosiveManager;
  private readonly destruction: DestructionSystem;
  private readonly player: PlayerController;
  private readonly weapons: WeaponSystem;
  private readonly enemies: EnemyManager;
  private readonly vehicles: VehicleManager;
  private readonly airCombat: AirCombatManager;

  private workerBridge: WorkerBridge | null = null;
  private lights: SceneLights | null = null;
  private worldData: BuiltWorldData | null = null;
  private missionDirector: MissionDirector | null = null;
  private activeMission: MissionConfig | null = null;
  private activeScope: ResourceScope | null = null;
  private activeAbortController: AbortController | null = null;
  private dioramaAngle = 0;
  private dioramaLoaded = false;
  private reinforcementTimer = 28;
  private hudDecayAccum = 0;
  private debugPublishAccum = 0;
  private suppressAutoPauseOnUnlock = false;
  private gpuReport: GpuCapabilityReport | null = null;
  private initialProbeFrames: number[] = [];
  private initialProbeSettled = false;
  private readonly _audioDir = new THREE.Vector3();
  private readonly cachedExplosiveCallbacks: ExplosiveCallbacks = {
    onEnemyKilled: (unit, weaponLabel) => {
      gameSessionStore.getState().triggerHit(false, true, 120);
      this.missionDirector?.onEnemyKilled(false, 120);
      gameSessionStore.getState().pushKillFeed({
        id: `${unit.id}_${Date.now()}`,
        killer: 'VANGUARD-1',
        victim: unit.displayName,
        weaponName: weaponLabel,
        isHeadshot: false,
        timestamp: Date.now(),
      });
    },
    onAirKilled: (unit, weaponLabel) => {
      gameSessionStore.getState().triggerHit(false, true, 180);
      this.missionDirector?.onAirUnitKilled(350, unit.type);
      gameSessionStore.getState().pushKillFeed({
        id: `${unit.id}_${Date.now()}`,
        killer: 'VANGUARD-1',
        victim: unit.displayName,
        weaponName: weaponLabel,
        isHeadshot: false,
        timestamp: Date.now(),
      });
    },
    onConvoyDestroyed: () => {
      this.missionDirector?.onConvoyVehicleDestroyed(400);
    },
    onDestructibleDestroyed: (_id, kind) => {
      this.missionDirector?.onDestructibleTargetDestroyed(300, kind);
    },
    onAlert: (msg, dur) => {
      this.missionDirector?.showAlert(msg, dur);
    },
  };

  private unsubscribers: Array<() => void> = [];

  constructor(private readonly container: HTMLElement) {
    const audioSettings = audioSettingsStore.getState();

    this.assetManager = new AssetManager(this.resourceManager);
    this.renderer = new EngineRenderer(
      container,
      this.resourceManager,
      () => uiStore.getState().setContextLost(true),
      () => {
        this.assetManager.markTexturesNeedUpdate();
        uiStore.getState().setContextLost(false);
      }
    );
    this.assetManager.configureRenderer(this.renderer.renderer);

    this.gpuReport = detectGpuCapability(this.renderer.renderer);
    const initialGraphics = settingsStore.getState().graphics;
    if (!initialGraphics.autoDetectedPresetApplied && initialGraphics.qualityMode === 'auto') {
      settingsStore.getState().applyAutoDetectedGraphics(this.gpuReport.recommendedSettings);
    }

    const settings = settingsStore.getState();
    this.governor = new PerformanceGovernor(settings.graphics.quality, settings.graphics.adaptiveGovernor);
    this.governor.configureFromSettings(settings.graphics);
    this.assetManager.setTextureQuality(settings.graphics.textureQuality);
    this.renderer.applyGovernorProfile(
      this.governor.getProfile(),
      settings.graphics.shadowsEnabled,
      settings.graphics.bloomEnabled,
      this.lights
    );

    this.audio = new AudioManager(this.resourceManager, audioSettings);
    this.input = new InputManager(
      this.resourceManager,
      settings.input,
      (locked) => {
        uiStore.getState().setPointerLocked(locked);
        if (locked) {
          this.suppressAutoPauseOnUnlock = false;
          return;
        }
        // Auto-pause only if pointer lock drops unexpectedly during active play (not when freeing cursor for F4 diagnostics)
        if (uiStore.getState().screen === 'playing') {
          if (this.suppressAutoPauseOnUnlock) {
            this.suppressAutoPauseOnUnlock = false;
          } else {
            this.pauseMission();
          }
        }
      },
      () => {
        const scr = uiStore.getState().screen;
        if (scr === 'playing') this.pauseMission();
        else if (scr === 'paused') this.resumeMission();
      }
    );
    this.input.attach(this.renderer.renderer.domElement);

    this.debugRenderer = new CombatDebugRenderer(this.renderer.scene, this.resourceManager);
    this.vfx = new VFXPool(this.renderer.scene, this.resourceManager);
    this.ballistics = new BallisticSolver(this.vfx, this.telemetry);
    this.projectiles = new ProjectileManager(
      this.renderer.scene,
      this.resourceManager,
      this.vfx,
      this.audio,
      this.telemetry
    );
    this.explosives = new ExplosiveManager(
      this.renderer.scene,
      this.resourceManager,
      this.vfx,
      this.audio,
      this.projectiles,
      this.telemetry
    );
    this.destruction = new DestructionSystem(this.collisionWorld.physicsWorld, this.vfx, this.audio);
    this.player = new PlayerController(this.audio);
    this.weapons = new WeaponSystem(this.renderer.viewModelScene, this.audio, this.vfx, this.projectiles);
    this.enemies = new EnemyManager(
      this.renderer.scene,
      this.resourceManager,
      this.vfx,
      this.audio,
      this.projectiles,
      this.coordinator,
      this.ballistics,
      this.telemetry
    );
    this.vehicles = new VehicleManager(
      this.renderer.scene,
      this.resourceManager,
      this.vfx,
      this.audio,
      this.coordinator,
      this.ballistics,
      this.telemetry
    );
    this.airCombat = new AirCombatManager(
      this.renderer.scene,
      this.resourceManager,
      this.vfx,
      this.audio,
      this.coordinator,
      this.ballistics,
      this.telemetry
    );

    this.loop = new GameLoop({
      sampleInput: this.onSampleInput,
      fixedStep: this.onFixedStep,
      scheduleAI: this.onScheduleAI,
      updateAnimationAndVfx: this.onUpdateVfx,
      updateAudio: this.onUpdateAudio,
      render: this.onRender,
      publishUiSnapshot: this.publishHudSnapshot,
      onFrameMeasured: this.onFrameMeasured,
    });
    this.loop.setFpsCap(settings.graphics.fpsCap);

    this.bindReactiveSettings();

    this.lifecycle.start();
    this.lifecycle.send({ type: 'READY' });

    // Load live background 3D diorama for Title/Menu screens, then capture shared baseline
    this.setupMenuDiorama();
    this.resourceManager.recordBaseline();
    this.loop.start();
  }

  getInputManager(): InputManager {
    return this.input;
  }

  getGpuCapabilityReport(): GpuCapabilityReport | null {
    return this.gpuReport;
  }

  reapplyAutoGraphics(): GpuCapabilityReport {
    const probeAvg =
      this.initialProbeFrames.length > 8
        ? this.initialProbeFrames.slice(5).reduce((a, b) => a + b, 0) /
          Math.max(1, this.initialProbeFrames.length - 5)
        : null;
    const report = detectGpuCapability(this.renderer.renderer, probeAvg);
    this.gpuReport = report;
    settingsStore.getState().applyAutoDetectedGraphics(report.recommendedSettings);
    return report;
  }

  private bindReactiveSettings(): void {
    this.unsubscribers.push(
      settingsStore.subscribe((state) => {
        this.input.updateSettings(state.input);
        this.governor.configureFromSettings(state.graphics);
        this.assetManager.setTextureQuality(state.graphics.textureQuality);
        this.loop.setFpsCap(state.graphics.fpsCap);
        const effProf = this.governor.getProfile();
        this.vfx.setBudgetRatio(effProf.particleBudgetRatio);
        this.renderer.applyGovernorProfile(
          effProf,
          state.graphics.shadowsEnabled,
          state.graphics.bloomEnabled,
          this.lights
        );
      }),
      audioSettingsStore.subscribe((state) => {
        this.audio.applySettings(state);
      }),
      uiStore.subscribe(
        (s) => ({
          open: s.combatDebugOpen,
          collapsed: s.combatDebugCollapsed,
          screen: s.screen,
        }),
        ({ open, collapsed, screen }) => {
          if (screen === 'playing' && open && !collapsed) {
            this.releasePointerLockForDebug();
          }
        }
      ),
      uiStore.subscribe(
        (s) => s.debugSimPaused,
        (debugSimPaused) => {
          if (uiStore.getState().screen === 'playing') {
            this.loop.setPaused(debugSimPaused);
          }
        }
      )
    );

    // [F3] Engine Performance Diagnostics, [F4] Combat AI Debug Overlay, and [Tab] Free-Cursor Toggle
    this.resourceManager.trackEventListener(
      window,
      'keydown',
      ((e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          return;
        }
        const devActive = isDeveloperModeActiveForSetting(settingsStore.getState().developer.devModeEnabled);
        if (e.code === 'F3') {
          if (!devActive) return;
          e.preventDefault();
          uiStore.getState().toggleDiagnostics();
        } else if (e.code === 'F4') {
          if (!devActive) return;
          e.preventDefault();
          const ui = uiStore.getState();
          if (e.shiftKey) {
            if (!ui.combatDebugOpen) {
              ui.setCombatDebugCollapsed(false);
              ui.setCombatDebugOpen(true);
              this.releasePointerLockForDebug();
            } else {
              ui.toggleCombatDebugCollapsed();
              if (!uiStore.getState().combatDebugCollapsed) {
                this.releasePointerLockForDebug();
              }
            }
          } else if (!ui.combatDebugOpen) {
            ui.setCombatDebugCollapsed(false);
            ui.setCombatDebugOpen(true);
            this.releasePointerLockForDebug();
          } else if (ui.combatDebugCollapsed && this.input.isPointerLocked()) {
            ui.setCombatDebugCollapsed(false);
            this.releasePointerLockForDebug();
          } else {
            ui.setCombatDebugOpen(false);
          }
        } else if (e.code === 'Tab' && uiStore.getState().screen === 'playing') {
          e.preventDefault();
          if (this.input.isPointerLocked()) {
            this.releasePointerLockForDebug();
          } else {
            this.requestPointerLock();
          }
        }
      }) as EventListener,
      'shared'
    );

    const handleLifecycleHide = () => {
      this.input.exitPointerLock();
      this.input.clearAllInputs();
      this.audio.suspend();
      if (uiStore.getState().screen === 'playing') {
        this.pauseMission();
      }
    };

    this.resourceManager.trackEventListener(
      document,
      'visibilitychange',
      () => {
        if (document.hidden) {
          handleLifecycleHide();
        } else if (uiStore.getState().screen !== 'paused') {
          this.audio.resume();
        }
      },
      'shared'
    );

    this.resourceManager.trackEventListener(window, 'pagehide', handleLifecycleHide, 'shared');
  }

  private setupMenuDiorama(): void {
    this.clearWorldState();
    const scope: ResourceScope = 'mission:diorama';
    this.activeScope = scope;
    const profile = this.governor.getProfile();
    const gSettings = settingsStore.getState().graphics;
    this.lights = setupLightingRig(
      this.renderer.scene,
      'sunset',
      profile.shadowMapSize,
      profile.shadowDistance,
      this.resourceManager
    );
    this.renderer.applyGovernorProfile(
      profile,
      gSettings.shadowsEnabled,
      gSettings.bloomEnabled,
      this.lights
    );
    this.worldData = buildWorldMap(
      'warzone_city',
      0,
      this.renderer.scene,
      this.assetManager,
      this.resourceManager,
      this.collisionWorld,
      this.chunkManager,
      this.destruction
    );
    this.dioramaLoaded = true;
  }

  async startMission(missionId: number, difficulty: Difficulty, preferredWeapon?: WeaponId): Promise<void> {
    this.audio.unlock();
    this.input.clearAllInputs();
    const mission = getMissionById(missionId);
    missionSelectionStore.getState().setSelectedMission(mission.id);
    missionSelectionStore.getState().setDifficulty(difficulty);

    // Cleanly unload prior diorama or mission before starting next one
    this.unloadCurrentWorld();

    this.lifecycle.send({ type: 'SELECT_MISSION', missionId: mission.id });
    uiStore.getState().setScreen('loading');
    gameSessionStore.getState().resetSession();

    const scope: ResourceScope = `mission:${mission.id}`;
    this.activeScope = scope;
    this.activeMission = mission;
    this.activeAbortController = this.resourceManager.createAbortController(scope);
    const signal = this.activeAbortController.signal;

    try {
      const stages = [
        'Streaming Terrain & Architecture',
        'Compiling Collision BVH & NavGrid',
        'Deploying Armored Vehicles & Air Support',
        'Calibrating Ballistics & Spatial Audio',
      ];

      for (let i = 0; i < stages.length; i++) {
        if (signal.aborted) throw new DOMException('Load cancelled', 'AbortError');
        gameSessionStore.getState().setLoadProgress({
          loaded: i + 1,
          total: stages.length,
          currentAsset: stages[i],
          percent: Math.round(((i + 1) / stages.length) * 100),
          usedFallbackCount: this.assetManager.getFallbackCount(),
        });
        await new Promise((r) => window.setTimeout(r, 45));
      }

      this.lifecycle.send({ type: 'ASSETS_LOADED' });
      if (signal.aborted) throw new DOMException('Load cancelled', 'AbortError');

      this.populateMissionWorld(mission, difficulty, scope, preferredWeapon);

      this.lifecycle.send({ type: 'WORLD_READY' });
      this.audio.startMissionAmbienceAndMusic();
      this.suppressAutoPauseOnUnlock = false;
      uiStore.getState().setDebugSimPaused(false);
      this.loop.setPaused(false);
      uiStore.getState().setScreen('playing');
      if (!(uiStore.getState().combatDebugOpen && !uiStore.getState().combatDebugCollapsed)) {
        this.requestPointerLock();
      }
      this.publishHudSnapshot();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.unloadToMenu();
        return;
      }
      this.lifecycle.send({
        type: 'LOAD_FAILED',
        message: err instanceof Error ? err.message : 'Mission initialization failed',
      });
      this.unloadToMenu();
      uiStore.getState().showToast('Deployment Failed', 'Returned safely to tactical HQ.', 'error');
    }
  }

  private populateMissionWorld(
    mission: MissionConfig,
    difficulty: Difficulty,
    scope: ResourceScope,
    preferredWeapon?: WeaponId
  ): void {
    const profile = this.governor.getProfile();
    const gSettings = settingsStore.getState().graphics;
    this.lights = setupLightingRig(
      this.renderer.scene,
      mission.lighting,
      profile.shadowMapSize,
      profile.shadowDistance,
      this.resourceManager
    );
    this.renderer.applyGovernorProfile(
      profile,
      gSettings.shadowsEnabled,
      gSettings.bloomEnabled,
      this.lights
    );

    this.worldData = buildWorldMap(
      mission.mapId,
      mission.id,
      this.renderer.scene,
      this.assetManager,
      this.resourceManager,
      this.collisionWorld,
      this.chunkManager,
      this.destruction
    );

    this.workerBridge = new WorkerBridge(this.resourceManager, scope);
    this.workerBridge.uploadCollisionGrid(this.collisionWorld.spatialHash);

    this.player.spawn(
      mission.playerSpawn.x,
      mission.playerSpawn.y,
      mission.playerSpawn.z,
      mission.playerYaw
    );
    const startWeapon =
      preferredWeapon ?? ((mission.recommendedLoadout[0] as WeaponId) || 'assault_rifle');
    this.weapons.resetLoadout(startWeapon);

    this.telemetry.reset();
    this.telemetry.setMissionId(mission.id);
    this.monitor.reset();
    this.rulesEngine.reset();
    this.explosives.reset();
    this.coordinator.reset();
    this.coordinator.setDifficulty(difficulty);
    this.enemies.setDifficulty(difficulty);
    this.vehicles.setDifficulty(difficulty);
    this.airCombat.setDifficulty(difficulty);

    for (const w of mission.initialWaves) {
      this.enemies.spawnWave(w.archetype, w.count, w.spawnArea, w.radius, this.collisionWorld, scope);
    }

    for (const v of mission.vehicles) {
      this.vehicles.spawnVehicle(v.type, v.position, v.yaw, v.hostile, v.isConvoyTarget, this.collisionWorld, scope);
    }

    for (const a of mission.airUnits) {
      for (let k = 0; k < a.count; k++) {
        const angle = (k / Math.max(1, a.count)) * Math.PI * 2 + Math.random() * 0.4;
        this.airCombat.spawnUnit(a.type, a.altitude, a.orbitRadius, angle, scope);
      }
    }

    this.missionDirector = new MissionDirector(mission, difficulty);
    this.reinforcementTimer = 28;
    this.dioramaLoaded = false;
  }

  getLifecycleState(): string {
    return String(this.lifecycle.getSnapshot().value);
  }

  cancelLoad(): void {
    this.activeAbortController?.abort();
    this.lifecycle.send({ type: 'CANCEL_LOAD' });
    this.unloadToMenu();
  }

  pauseMission(): void {
    if (uiStore.getState().screen !== 'playing') return;
    this.suppressAutoPauseOnUnlock = false;
    uiStore.getState().setDebugSimPaused(false);
    this.input.exitPointerLock();
    this.input.clearAllInputs();
    this.loop.setPaused(true);
    this.lifecycle.send({ type: 'PAUSE' });
    uiStore.getState().setScreen('paused');
  }

  resumeMission(): void {
    if (uiStore.getState().screen !== 'paused') return;
    this.audio.resume();
    this.audio.unlock();
    this.suppressAutoPauseOnUnlock = false;
    uiStore.getState().setDebugSimPaused(false);
    this.loop.setPaused(false);
    this.lifecycle.send({ type: 'RESUME' });
    uiStore.getState().setScreen('playing');
    if (!(uiStore.getState().combatDebugOpen && !uiStore.getState().combatDebugCollapsed)) {
      this.requestPointerLock();
    }
  }

  restartCheckpoint(): void {
    if (!this.activeMission) return;
    const mission = this.activeMission;
    const difficulty = missionSelectionStore.getState().difficulty;
    const currentWeaponId = this.weapons.getActiveState().config.id;
    const scope: ResourceScope = `mission:${mission.id}`;

    this.audio.resume();
    this.audio.unlock();
    this.audio.stopMissionLoops();
    this.input.clearAllInputs();
    this.workerBridge?.dispose();
    this.workerBridge = null;
    this.clearWorldState();
    this.telemetry.recordMissionRestart();

    this.activeScope = scope;
    this.activeMission = mission;
    gameSessionStore.getState().resetSession();

    this.populateMissionWorld(mission, difficulty, scope, currentWeaponId);
    this.missionDirector?.showAlert('MISSION RESTARTED — FULL BASELINE RESTORED', 2.8);

    this.lifecycle.send({ type: 'RESTART_MISSION' });
    this.audio.startMissionAmbienceAndMusic();
    this.suppressAutoPauseOnUnlock = false;
    uiStore.getState().setDebugSimPaused(false);
    this.loop.setPaused(false);
    uiStore.getState().setScreen('playing');
    if (!(uiStore.getState().combatDebugOpen && !uiStore.getState().combatDebugCollapsed)) {
      this.requestPointerLock();
    }
    this.publishHudSnapshot();
  }

  abortToMenu(targetScreen: 'title' | 'campaign' = 'campaign'): void {
    this.suppressAutoPauseOnUnlock = false;
    uiStore.getState().setDebugSimPaused(false);
    this.input.exitPointerLock();
    this.unloadToMenu(targetScreen);
  }

  requestPointerLock(): void {
    this.suppressAutoPauseOnUnlock = false;
    this.input.requestPointerLock(this.renderer.renderer.domElement);
  }

  releasePointerLockForDebug(): void {
    if (this.input.isPointerLocked() || Boolean(document.pointerLockElement)) {
      this.suppressAutoPauseOnUnlock = true;
      this.input.exitPointerLock();
    }
  }

  resize(): void {
    this.renderer.resize();
  }

  playUiSound(): void {
    this.audio.unlock();
    this.audio.play2D('ui_click', 3, 0.35);
  }

  private unloadToMenu(targetScreen: 'title' | 'campaign' = 'title'): void {
    this.input.clearAllInputs();
    this.unloadCurrentWorld();
    const curState = this.lifecycle.getSnapshot().value;
    if (curState === 'error') {
      this.lifecycle.send({ type: 'RECOVER' });
    } else if (curState !== 'menu') {
      this.lifecycle.send({ type: 'UNLOAD' });
    }
    this.lifecycle.send({ type: 'UNLOADED' });
    this.loop.setPaused(false);
    this.setupMenuDiorama();
    uiStore.getState().setScreen(targetScreen);
  }

  private unloadCurrentWorld(): void {
    this.audio.stopMissionLoops();
    this.workerBridge?.dispose();
    this.workerBridge = null;
    this.clearWorldState();
    this.resourceManager.recordPostUnloadAudit();
  }

  private clearWorldState(): void {
    this.vfx.resetAll();
    this.projectiles.resetAll();
    this.explosives.reset();
    this.enemies.clear();
    this.vehicles.clear();
    this.airCombat.clear();
    this.destruction.clear();
    this.collisionWorld.clear();
    this.chunkManager.clear(this.renderer.scene);
    this.coordinator.reset();
    this.telemetry.reset();
    this.rulesEngine.reset();
    this.debugRenderer.setVisible(false);

    this.resourceManager.unloadScope('mission:lights');
    this.resourceManager.unloadScope('mission:audio');
    if (this.activeScope) {
      this.resourceManager.unloadScope(this.activeScope);
      this.activeScope = null;
    }
    this.lights = null;
    this.worldData = null;
    this.missionDirector = null;
    this.activeMission = null;
  }

  private onSampleInput = (): void => {
    if (uiStore.getState().screen !== 'playing' || !this.activeMission || !this.missionDirector) return;

    // [E] Context-sensitive interact: Supply crate, plant charge on objective cache, or enter/exit vehicle
    if (this.input.wasActionPressed('interact')) {
      const handledInteract = this.tryContextualInteract();
      if (!handledInteract) {
        this.vehicles.togglePlayerVehicle(this.player, this.collisionWorld);
      }
    }

    const inVehicle = this.vehicles.getPlayerVehicle() !== null;
    if (inVehicle && this.input.wasActionPressed('vehicleCamera')) {
      const nextCam = this.vehicles.cycleCameraMode();
      this.audio.play2D('ui_click', 3, 0.35);
      this.missionDirector.showAlert(`CAMERA: ${VEHICLE_CAMERA_MODE_LABELS[nextCam]}`, 1.4);
    }
    const settings = settingsStore.getState();
    const devActive = isDeveloperModeActiveForSetting(settings.developer.devModeEnabled);
    const sandboxAuthorized = devActive && settings.developer.sandboxOrdnanceAuthorized;
    const req = progressionStore.getState().save.requisitionPoints;

    // [C] / [Shift+C] / Touch C4 Detonate
    if (!inVehicle && this.input.wasActionPressed('c4Detonate')) {
      this.explosives.handleC4Action(
        this.renderer.camera,
        this.collisionWorld,
        this.vehicles,
        this.activeScope,
        true,
        (msg, dur) => this.missionDirector?.showAlert(msg, dur)
      );
    } else if (!inVehicle && this.input.wasActionPressed('c4')) {
      const shiftHeld = this.input.isKeyHeld('ShiftLeft') || this.input.isKeyHeld('ShiftRight');
      this.explosives.handleC4Action(
        this.renderer.camera,
        this.collisionWorld,
        this.vehicles,
        this.activeScope,
        shiftHeld,
        (msg, dur) => this.missionDirector?.showAlert(msg, dur)
      );
    }

    // [V] Call Selected Conventional Bomb Strike / [Shift+V] Cycle Bomb Type
    if (this.input.wasActionPressed('cycleBomb')) {
      const nextId = this.explosives.cycleBombType();
      const prof = EXPLOSIVE_BY_ID[nextId];
      this.missionDirector.showAlert(
        `ORDNANCE SELECTED: ${prof.shortName} (${prof.requisitionCost} REQ)`,
        2.0
      );
    } else if (this.input.wasActionPressed('bombStrike')) {
      const shiftHeld = this.input.isKeyHeld('ShiftLeft') || this.input.isKeyHeld('ShiftRight');
      if (shiftHeld) {
        const nextId = this.explosives.cycleBombType();
        const prof = EXPLOSIVE_BY_ID[nextId];
        this.missionDirector.showAlert(
          `ORDNANCE SELECTED: ${prof.shortName} (${prof.requisitionCost} REQ)`,
          2.0
        );
      } else {
        this.explosives.callBombStrike(
          this.renderer.camera,
          this.collisionWorld,
          (cost) => progressionStore.getState().spendRequisition(cost),
          sandboxAuthorized,
          this.activeScope,
          (msg, dur) => this.missionDirector?.showAlert(msg, dur)
        );
      }
    }

    // [N] Strategic Nuclear Weapon Request + [Enter] Confirm / [Backspace] Cancel
    if (this.input.wasActionPressed('strategicNuke')) {
      this.explosives.requestStrategicNuke(
        this.renderer.camera,
        this.collisionWorld,
        req,
        sandboxAuthorized,
        (msg, dur) => this.missionDirector?.showAlert(msg, dur)
      );
    }
    if (this.input.wasKeyPressed('Enter') || this.input.wasActionPressed('confirmNuke')) {
      this.explosives.confirmStrategicNuke(
        (cost) => progressionStore.getState().spendRequisition(cost),
        sandboxAuthorized,
        this.activeScope,
        (msg, dur) => this.missionDirector?.showAlert(msg, dur)
      );
    }
    if (this.input.wasKeyPressed('Backspace') || this.input.wasActionPressed('cancelNuke')) {
      this.explosives.cancelStrategicNuke();
    }
  };

  private tryContextualInteract(): boolean {
    if (!this.worldData || !this.missionDirector) return false;
    // Check supply crates
    for (const c of this.worldData.supplyCrates) {
      if (!c.used && c.position.distanceTo(this.player.position) < 3.4) {
        c.used = true;
        c.mesh.visible = false;
        this.player.resupply();
        this.weapons.resupplyAll();
        this.explosives.resupplyC4(2);
        this.audio.play2D('reload', 6, 0.65);
        this.missionDirector.showAlert('RESUPPLY CRATE COLLECTED (+AMMO / +ARMOR / +MEDS / +2 C4)', 2.8);
        return true;
      }
    }
    // Check weapons caches / destructible objectives to sabotage directly via [E]
    for (const d of this.destruction.getAll()) {
      if (d.state !== 'DESTROYED' && d.isObjectiveTarget && d.position.distanceTo(this.player.position) < 4.2) {
        this.destruction.applyDamage(
          d.id,
          9999,
          this.handleExplosion,
          (ent) => this.missionDirector?.onDestructibleTargetDestroyed(300, ent.kind)
        );
        return true;
      }
    }
    return false;
  }

  private onFixedStep = (dt: number): void => {
    const screen = uiStore.getState().screen;
    if (screen !== 'playing' || !this.missionDirector || !this.activeMission) {
      // Gentle menu diorama orbit pan
      if (this.dioramaLoaded) {
        this.dioramaAngle += dt * 0.08;
        this.renderer.camera.position.set(
          Math.cos(this.dioramaAngle) * 52,
          22,
          Math.sin(this.dioramaAngle) * 52
        );
        this.renderer.camera.lookAt(0, 6, 0);
      }
      return;
    }

    const tPhys0 = performance.now();
    this.collisionWorld.physicsWorld.beginFrame(dt);
    const inVehicle = this.vehicles.getPlayerVehicle() !== null;
    const weaponCfg = this.weapons.getActiveState().config;
    const settings = settingsStore.getState();

    this.player.update(
      dt,
      this.input,
      this.collisionWorld,
      this.weapons.isAds,
      weaponCfg.mobilityFactor,
      settings.graphics.headBobIntensity,
      inVehicle
    );

    if (!inVehicle) {
      this.player.syncCamera(
        this.renderer.camera,
        settings.graphics.fov,
        weaponCfg.adsFov,
        this.weapons.isAds,
        dt
      );
    }

    // Build combined hitscan & lock-on targets
    const enemyTargets = this.enemies.getHitscanTargets((unit, dmg, isHead, killed) => {
      gameSessionStore.getState().triggerHit(isHead, killed, dmg);
      this.audio.play2D(isHead ? 'headshot' : 'hit_marker', 8, 0.55);
      if (killed) {
        this.missionDirector?.onEnemyKilled(isHead, 120);
        gameSessionStore.getState().pushKillFeed({
          id: `${unit.id}_${Date.now()}`,
          killer: 'VANGUARD-1',
          victim: unit.displayName,
          weaponName: this.weapons.getActiveState().config.shortName,
          isHeadshot: isHead,
          timestamp: Date.now(),
        });
      }
    });

    const airTargets = this.airCombat.getHitscanTargets((unit, killed) => {
      gameSessionStore.getState().triggerHit(false, killed, 25);
      this.audio.play2D('hit_marker', 8, 0.5);
      if (killed) {
        this.missionDirector?.onAirUnitKilled(350, unit.type);
        gameSessionStore.getState().pushKillFeed({
          id: `${unit.id}_${Date.now()}`,
          killer: 'VANGUARD-1',
          victim: unit.displayName,
          weaponName: this.weapons.getActiveState().config.shortName,
          isHeadshot: false,
          timestamp: Date.now(),
        });
      }
    });

    const vehicleTargets = this.vehicles.getHitscanTargets((veh, killed) => {
      gameSessionStore.getState().triggerHit(false, killed, 20);
      this.audio.play2D('hit_marker', 7, 0.45);
      if (killed) {
        if (veh.isConvoyTarget) {
          this.missionDirector?.onConvoyVehicleDestroyed(400);
        } else {
          this.missionDirector?.onEnemyKilled(false, 280);
        }
        gameSessionStore.getState().pushKillFeed({
          id: `${veh.id}_${Date.now()}`,
          killer: 'VANGUARD-1',
          victim: veh.displayName,
          weaponName: this.weapons.getActiveState().config.shortName,
          isHeadshot: false,
          timestamp: Date.now(),
        });
      }
    });

    const allHitscan: HitscanTarget[] = [...enemyTargets, ...airTargets, ...vehicleTargets];
    const lockCandidates = [...this.airCombat.getLockCandidates(), ...this.vehicles.getLockCandidates()];

    const tGame0 = performance.now();
    this.weapons.update(
      dt,
      this.input,
      this.player,
      this.renderer.camera,
      this.collisionWorld,
      allHitscan,
      lockCandidates,
      (colliderId, dmg) => {
        this.destruction.applyDamage(
          colliderId,
          dmg,
          this.handleExplosion,
          (ent) => this.missionDirector?.onDestructibleTargetDestroyed(300, ent.kind)
        );
      },
      inVehicle
    );

    // Vehicles & Roof Turret
    this.vehicles.update(
      dt,
      this.input,
      this.player,
      this.renderer.camera,
      this.collisionWorld,
      this.worldData?.roadWaypoints ?? [],
      (origin, dir) => {
        // Check solid world/building/cover/destructible obstruction before scoring hits
        const playerVehicleId = this.vehicles.getPlayerVehicle()?.collider.id;
        const wallHit: RayHit = {
          hit: false,
          distance: 110,
          pointX: 0,
          pointY: 0,
          pointZ: 0,
          normalX: 0,
          normalY: 1,
          normalZ: 0,
          collider: null,
        };
        const hitWall = this.collisionWorld.sweptSegmentTest(
          origin.x,
          origin.y,
          origin.z,
          dir.x,
          dir.y,
          dir.z,
          110,
          SOLID_OBSTRUCTION_MASK,
          wallHit,
          playerVehicleId
        );

        let bestDist = hitWall ? wallHit.distance : 110;
        let hitTarget: HitscanTarget | null = null;
        let hitZone = 'upper_torso' as 'head' | 'upper_torso' | 'lower_body';
        for (const t of allHitscan) {
          if (!t.alive) continue;
          const checkZone = (
            center: THREE.Vector3,
            radius: number,
            zone: 'head' | 'upper_torso' | 'lower_body'
          ) => {
            const toX = center.x - origin.x;
            const toY = center.y - origin.y;
            const toZ = center.z - origin.z;
            const proj = toX * dir.x + toY * dir.y + toZ * dir.z;
            if (proj < 0 || proj > bestDist) return;
            const perpSq = toX * toX + toY * toY + toZ * toZ - proj * proj;
            if (perpSq <= (radius + 0.45) * (radius + 0.45)) {
              bestDist = proj;
              hitTarget = t;
              hitZone = zone;
            }
          };
          checkZone(t.position, t.hitRadius, 'upper_torso');
          if (t.lowerBodyPosition && t.lowerBodyRadius) {
            checkZone(t.lowerBodyPosition, t.lowerBodyRadius, 'lower_body');
          }
          if (t.headPosition && t.headRadius) {
            checkZone(t.headPosition, t.headRadius, 'head');
          }
        }
        if (hitTarget) {
          const isHead = hitZone === 'head';
          const zoneMult = hitZone === 'head' ? 1.5 : hitZone === 'lower_body' ? 0.85 : 1.0;
          (hitTarget as HitscanTarget).onHit(Math.round(26 * zoneMult), isHead, (hitTarget as HitscanTarget).position, hitZone);
        } else if (hitWall && wallHit.collider) {
          if (wallHit.collider.layer & COLLISION_LAYER.DESTRUCTIBLE) {
            this.destruction.applyDamage(
              wallHit.collider.id,
              26,
              this.handleExplosion,
              (ent) => this.missionDirector?.onDestructibleTargetDestroyed(300, ent.kind)
            );
            this.vfx.spawnImpact(wallHit.pointX, wallHit.pointY, wallHit.pointZ, 'metal');
          } else {
            this.vfx.spawnImpact(wallHit.pointX, wallHit.pointY, wallHit.pointZ, 'concrete');
          }
        }
      },
      () => this.missionDirector?.onConvoyVehicleDestroyed(400),
      settings.graphics.fov
    );

    // Pooled projectiles (rockets, guided missiles, grenades, aerial bombs, TRIDENT-X)
    const tProj0 = performance.now();
    const prox = [
      ...this.enemies.getPositionsForProximity(),
      ...this.airCombat.getPositionsForProximity(),
    ];
    const explosiveCallbacks = this.getExplosiveCallbacks();
    this.projectiles.update(
      dt,
      this.collisionWorld,
      (ev) => this.handleExplosionEvent(ev),
      prox
    );
    const tProjEnd = performance.now();
    this.monitor.recordPhase('projectilesFlight', tProjEnd - tProj0);

    const tExp0 = performance.now();
    this.explosives.update(
      dt,
      this.player,
      this.renderer.camera,
      this.collisionWorld,
      this.enemies,
      this.vehicles,
      this.airCombat,
      this.destruction,
      inVehicle,
      settings.accessibility.reducedMotion,
      explosiveCallbacks
    );
    this.monitor.recordPhase('explosions', performance.now() - tExp0);

    // Extraction Beacon check for Mission 5
    if (this.activeMission.extractionPoint) {
      const ep = this.activeMission.extractionPoint;
      const distEx = Math.hypot(this.player.position.x - ep.x, this.player.position.z - ep.z);
      if (distEx < 8.5) {
        this.missionDirector.onExtractionReached();
      }
    }

    // Dynamic enemy reinforcement drop if mission is still active and count drops low
    this.reinforcementTimer -= dt;
    if (this.reinforcementTimer <= 0 && this.enemies.getActiveCount() < 4 && this.activeScope) {
      this.reinforcementTimer = 26;
      this.enemies.spawnWave(
        'elite_assault',
        3,
        { x: (Math.random() - 0.5) * 44, y: 0, z: -28 },
        12,
        this.collisionWorld,
        this.activeScope
      );
      this.missionDirector.showSubtitle('INTEL: Enemy reinforcement squad spotted moving in.', 3.8);
    }

    if (!this.player.alive) {
      this.telemetry.recordPlayerDeath();
    }
    this.telemetry.setPlayerWeaponTelemetry(
      this.weapons.shotsFired,
      this.weapons.shotsHit,
      this.weapons.enemyZoneHits
    );
    this.telemetry.setObjectiveCompletionTelemetry(
      this.missionDirector.getObjectiveCompletionTimestamps()
    );

    const missionTick = this.missionDirector.update(dt, this.player.health, this.player.armor);
    if (missionTick.finished) {
      this.completeMission(missionTick.victory);
    }

    this.hudDecayAccum += dt;
    if (this.hudDecayAccum >= 0.08) {
      this.hudDecayAccum = 0;
      gameSessionStore.getState().decayDamageArcs();
    }

    // Tick Combat Engagement Coordinator leases and exposure telemetry
    this.coordinator.tick(this.telemetry.getElapsedSec());
    const groundRows = this.enemies.getDebugInspectorRows(this.player);
    const airRows = this.airCombat.getDebugInspectorRows(this.player);
    const vehRows = this.vehicles.getDebugInspectorRows(this.player);
    const allDebugUnits = [...groundRows, ...airRows, ...vehRows];
    const anyEnemyHasLos = allDebugUnits.some((u) => u.hasLos);
    this.telemetry.tickExposure(dt, anyEnemyHasLos);

    const devActive = isDeveloperModeActiveForSetting(settings.developer.devModeEnabled);
    const debugOpen = devActive && uiStore.getState().combatDebugOpen;
    if (devActive) {
      this.debugPublishAccum += dt;
      const publishPeriod = debugOpen ? 0.1 : 0.45;
      if (this.debugPublishAccum >= publishPeriod) {
        this.debugPublishAccum = 0;
        const drawInfo = this.renderer.getDrawInfo();
        const resSnap = this.resourceManager.getSnapshot();
        const audit = this.resourceManager.getLastUnloadAudit();

        this.telemetry.setPlayerMovementTelemetry(
          this.player.getMovementTelemetry(
            weaponCfg.shortName,
            this.weapons.getEquipTimerSec(),
            this.weapons.getReloadStage(),
            this.weapons.getReloadProgress()
          )
        );
        this.telemetry.setFlightSamples([
          ...this.projectiles.getFlightTelemetrySamples(),
          ...this.airCombat.getFlightTelemetrySamples(),
        ]);
        this.telemetry.setOrdnanceSummary(this.explosives.getTelemetrySummary());
        this.telemetry.setPerformanceTelemetry(this.monitor.getLatestTelemetry());
        this.telemetry.setResourceTelemetry({
          geometries: drawInfo.geometries,
          materials: resSnap.byCategory.material,
          textures: drawInfo.textures,
          renderTargets: resSnap.byCategory.renderTarget,
          listeners: resSnap.byCategory.listener,
          timers: resSnap.byCategory.timer,
          audioVoices: this.audio.getActiveVoiceCount(),
          activePooledVfx: this.vfx.getActiveCount(),
          poolCapacityVfx: this.vfx.getPoolCapacity(),
          activePooledProjectiles: this.projectiles.getActiveCount(),
          poolCapacityProjectiles: this.projectiles.getPoolCapacity(),
          activeC4Count: this.explosives.getActiveC4Count(),
          totalCreated: resSnap.totalCreated,
          totalDisposed: resSnap.totalDisposed,
          sharedCount: resSnap.sharedCount,
          missionCount: resSnap.missionCount,
          hasMissionLeak: audit.hasMissionLeak,
          missionRemaining: audit.missionRemaining,
          sharedDelta: audit.sharedDelta,
        });

        const dynamicPhysicsBodies = [
          this.player.getPhysicsInspectorRow(),
          ...this.enemies.getPhysicsInspectorRows(),
          ...this.vehicles.getPhysicsInspectorRows(),
          ...this.airCombat.getPhysicsInspectorRows(),
          ...this.projectiles.getPhysicsInspectorRows(),
        ];
        const physSnap = this.collisionWorld.physicsWorld.buildDiagnosticsSnapshot(
          dynamicPhysicsBodies
        );
        this.telemetry.setPhysicsDiagnostics(physSnap);

        const coordSnap = this.coordinator.getSnapshot();
        const prelimSnap = this.telemetry.buildSnapshot(
          coordSnap,
          allDebugUnits,
          this.projectiles.getActiveCount()
        );
        const warnings = this.rulesEngine.evaluate(prelimSnap);
        this.telemetry.setWarnings(warnings);
        prelimSnap.warnings = warnings;
        gameSessionStore.getState().updateCombatDebug(prelimSnap);

        if (debugOpen) {
          this.debugRenderer.update(
            settings.developer.debugShow3DGizmos,
            allDebugUnits,
            prelimSnap.recentShots,
            this.player.position,
            settings.developer.debugShowFlightPaths,
            prelimSnap.flightSamples,
            prelimSnap.recentExplosions,
            settings.developer.debugShowPhysicsColliders,
            prelimSnap.physics,
            this.vehicles.getCameraDebugRay()
          );
        } else {
          this.debugRenderer.setVisible(false);
        }
      }
    } else {
      this.debugRenderer.setVisible(false);
    }

    this.monitor.recordPhase('physics', tGame0 - tPhys0);
    this.monitor.recordPhase('gameplay', performance.now() - tGame0);
    this.input.endFrame();
  };

  private getExplosiveCallbacks(): ExplosiveCallbacks {
    return this.cachedExplosiveCallbacks;
  }

  private handleExplosionEvent = (ev: ExplosionEvent): void => {
    const t0 = performance.now();
    const settings = settingsStore.getState();
    this.explosives.resolveExplosion(
      ev,
      this.player,
      this.collisionWorld,
      this.enemies,
      this.vehicles,
      this.airCombat,
      this.destruction,
      settings.accessibility.reducedMotion,
      this.getExplosiveCallbacks()
    );
    this.monitor.recordPhase('explosions', performance.now() - t0);
  };

  private handleExplosion = (x: number, y: number, z: number, radius: number, damage: number): void => {
    this.handleExplosionEvent({
      explosiveId: 'grenade_shell',
      category: 'launcher',
      x,
      y,
      z,
      innerRadius: Math.max(1.2, radius * 0.25),
      radius,
      damage,
      falloffExponent: 1.3,
      vehicleDamageMultiplier: 1.25,
      destructionPower: 1.35,
      fromPlayer: true,
      sourceUnitId: 'ordnance',
      sourceSquadId: 'ordnance',
      sourceDomain: 'ground',
    });
  };

  private onScheduleAI = (dt: number): void => {
    if (uiStore.getState().screen !== 'playing' || !this.activeScope || !this.workerBridge) return;
    const t0 = performance.now();

    this.enemies.update(
      dt,
      this.player,
      this.collisionWorld,
      this.worldData?.coverNodes ?? [],
      this.workerBridge,
      this.governor.getProfile().aiMidIntervalSec,
      (x, y, z) => {
        if (this.activeScope) {
          this.airCombat.spawnDynamicDrone(x, y, z, this.activeScope);
        }
      }
    );
    this.airCombat.update(dt, this.player, this.collisionWorld);

    this.monitor.recordPhase('ai', performance.now() - t0);
  };

  private onUpdateVfx = (dt: number): void => {
    this.vfx.update(dt);
    if (this.worldData) {
      const elapsed = performance.now() * 0.001;
      for (const prop of this.worldData.animatedProps) {
        prop.update(elapsed);
      }
    }
  };

  private onUpdateAudio = (): void => {
    this.renderer.camera.getWorldDirection(this._audioDir);
    this.audio.updateListener(
      this.renderer.camera.position.x,
      this.renderer.camera.position.y,
      this.renderer.camera.position.z,
      this._audioDir.x,
      this._audioDir.y,
      this._audioDir.z
    );
  };

  private onRender = (): void => {
    const t0 = performance.now();
    this.chunkManager.updateVisibility(this.renderer.camera, this.governor.getProfile().drawDistance);
    const showVm = uiStore.getState().screen === 'playing' && this.vehicles.getPlayerVehicle() === null;
    this.renderer.renderFrame(showVm);
    this.monitor.recordPhase('render', performance.now() - t0);
  };

  private onFrameMeasured = (frameMs: number): void => {
    const dt = 1 / 60;

    if (!this.initialProbeSettled) {
      this.initialProbeFrames.push(frameMs);
      if (this.initialProbeFrames.length >= 45) {
        this.initialProbeSettled = true;
        const steady = this.initialProbeFrames.slice(5);
        const avgProbeMs = steady.reduce((a, b) => a + b, 0) / Math.max(1, steady.length);
        const refined = detectGpuCapability(this.renderer.renderer, avgProbeMs);
        this.gpuReport = refined;
        const currentGraphics = settingsStore.getState().graphics;
        const tierOrder = ['low', 'medium', 'high', 'ultra'] as const;
        if (
          currentGraphics.qualityMode === 'auto' &&
          tierOrder.indexOf(refined.recommendedTier) < tierOrder.indexOf(currentGraphics.quality)
        ) {
          settingsStore.getState().applyAutoDetectedGraphics(refined.recommendedSettings);
        }
      }
    }

    const changed = this.governor.recordSample(frameMs, this.monitor.getCpuTimeMs(), dt);
    if (changed) {
      const settings = settingsStore.getState();
      const prof = this.governor.getProfile();
      this.renderer.applyGovernorProfile(
        prof,
        settings.graphics.shadowsEnabled,
        settings.graphics.bloomEnabled,
        this.lights
      );
      this.vfx.setBudgetRatio(prof.particleBudgetRatio);
    }

    this.monitor.tick(
      dt,
      frameMs,
      this.renderer,
      this.resourceManager,
      this.governor,
      this.vfx.getActiveCount() + this.projectiles.getActiveCount(),
      this.audio.getActiveVoiceCount(),
      this.enemies.getActiveCount()
    );
  };

  private publishHudSnapshot = (): void => {
    if (!this.missionDirector || !this.activeMission) return;
    const wState = this.weapons.getActiveState();
    const veh = this.vehicles.getPlayerVehicle();
    const nearVeh = !veh ? this.vehicles.getNearestInteractableVehicle(this.player.position) : null;
    const boss = this.airCombat.getActiveBossInfo();

    let interactPrompt: string | null = null;
    if (veh) {
      interactPrompt = `[E] Exit ${veh.displayName}`;
    } else if (nearVeh) {
      interactPrompt = `[E] Drive ${nearVeh.displayName}`;
    } else if (this.worldData) {
      for (const c of this.worldData.supplyCrates) {
        if (!c.used && c.position.distanceTo(this.player.position) < 3.4) {
          interactPrompt = '[E] Resupply Ammo & Armor';
          break;
        }
      }
      if (!interactPrompt) {
        for (const d of this.destruction.getAll()) {
          if (d.state !== 'DESTROYED' && d.isObjectiveTarget && d.position.distanceTo(this.player.position) < 4.2) {
            interactPrompt = '[E] Plant Detonation Charge';
            break;
          }
        }
      }
    }

    const blips: MiniMapBlip[] = [
      ...this.enemies.getMiniMapBlips(),
      ...this.airCombat.getMiniMapBlips(),
      ...this.vehicles.getMiniMapBlips(),
      ...this.missionDirector.getObjectiveBlips(),
    ];

    gameSessionStore.getState().updateHudSnapshot({
      health: Math.round(this.player.health),
      maxHealth: this.player.maxHealth,
      armor: Math.round(this.player.armor),
      maxArmor: this.player.maxArmor,
      weaponId: wState.config.id,
      weaponName: wState.config.shortName,
      fireMode: this.weapons.getActiveFireMode(),
      ammoInMag: wState.ammoInMag,
      magSize: wState.magSize,
      reserveAmmo: wState.reserveAmmo,
      grenades: this.player.grenades,
      isReloading: this.weapons.isReloading,
      reloadProgress: this.weapons.getReloadProgress(),
      isAds: this.weapons.isAds,
      isScoped: this.weapons.isScoped,
      isSprinting: this.player.isSprinting,
      isCrouching: this.player.isCrouching,
      isSliding: this.player.isSliding,
      crosshairSpread:
        (this.weapons.isAds ? wState.config.spreadAdsRad : wState.config.spreadHipRad) +
        this.player.currentSpeed * 0.002,
      playerX: this.player.position.x,
      playerZ: this.player.position.z,
      playerYaw: this.player.yaw,
      inVehicle: Boolean(veh),
      vehicleName: veh?.displayName ?? '',
      vehicleHealth: veh ? Math.round((veh.health / veh.maxHealth) * 100) : 100,
      vehicleMaxHealth: 100,
      vehicleSpeedKmh: veh ? Math.round(Math.abs(veh.speed) * 3.6) : 0,
      vehicleCameraMode: this.vehicles.getCameraMode(),
      interactPrompt,
      subtitleText: settingsStore.getState().accessibility.subtitles ? this.missionDirector.subtitleText : null,
      missionAlert: this.missionDirector.alertText,
      elapsedSec: Math.floor(this.missionDirector.elapsedSec),
      score: this.missionDirector.score,
      kills: this.missionDirector.kills,
      headshots: this.missionDirector.headshots,
      shotsFired: this.weapons.shotsFired,
      shotsHit: this.weapons.shotsHit,
      lockOn: this.weapons.getLockOnState(),
      objectives: this.missionDirector.getObjectiveStatuses(),
      blips,
      activeBossLabel: boss?.label ?? null,
      activeBossHealthPct: boss?.healthPct ?? 0,
      ordnance: this.explosives.getOrdnanceHud(
        this.player.position,
        progressionStore.getState().save.requisitionPoints,
        isDeveloperModeActiveForSetting(settingsStore.getState().developer.devModeEnabled) &&
          settingsStore.getState().developer.sandboxOrdnanceAuthorized
      ),
    });
  };

  private completeMission(victory: boolean): void {
    if (!this.activeMission || !this.missionDirector) return;
    this.input.exitPointerLock();
    this.input.clearAllInputs();
    this.loop.setPaused(true);

    const summary = this.missionDirector.buildSummary(victory);
    const difficulty = missionSelectionStore.getState().difficulty;
    const { newAchievements } = progressionStore.getState().recordMissionResult({
      missionId: this.activeMission.id,
      difficulty,
      victory: summary.victory,
      score: summary.score,
      grade: summary.grade as MissionGrade,
      xpEarned: summary.xpEarned,
      requisitionEarned: summary.requisitionEarned,
      kills: summary.kills,
      headshots: summary.headshots,
      airKills: summary.airKills,
      durationSec: summary.durationSec,
    });

    const accuracyPct =
      this.weapons.shotsFired > 0
        ? Math.min(100, Math.round((this.weapons.shotsHit / this.weapons.shotsFired) * 100))
        : 0;

    gameSessionStore.getState().setDebrief({
      missionId: this.activeMission.id,
      difficulty,
      ...summary,
      accuracyPct,
      newAchievements,
    });

    this.lifecycle.send({ type: 'MISSION_ENDED' });
    uiStore.getState().setScreen('debrief');
  }

  getWeaponCatalogItem(id: WeaponId) {
    return WEAPON_BY_ID[id];
  }

  dispose(): void {
    this.loop.stop();
    this.unloadCurrentWorld();
    this.debugRenderer.setVisible(false);
    this.weapons.dispose();
    this.explosives.dispose();
    this.vehicles.dispose();
    this.destruction.dispose();
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
    this.audio.dispose();
    this.assetManager.dispose();
    this.renderer.dispose();
    this.resourceManager.disposeAll();
  }
}
