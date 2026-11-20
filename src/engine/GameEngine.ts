import * as THREE from 'three';
import { createActor } from 'xstate';
import { AudioManager } from '@/src/audio/AudioManager';
import { isDeveloperModeActiveForSetting } from '@/src/config/devMode';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { getMissionById } from '@/src/data/missions';
import {
  CombinedModifierEffects,
  computeCombinedModifierEffects,
  ReplayModifierId,
} from '@/src/data/challenges';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import { VFXPool } from '@/src/effects/VFXPool';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CargoLiftManager, CargoLiftOccupantProxy } from '@/src/gameplay/CargoLiftManager';
import { CombatDamageResolver } from '@/src/gameplay/CombatDamageResolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { DiagnosticRulesEngine } from '@/src/gameplay/diagnostics/DiagnosticRulesEngine';
import {
  diagnosePlaytestFriction,
  PlaytestExperienceTracker,
} from '@/src/gameplay/diagnostics/PlaytestTelemetrySummary';
import { EncounterDirector } from '@/src/gameplay/EncounterDirector';
import { SoloEncounterDirector } from '@/src/gameplay/SoloEncounterDirector';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { HealthPickupManager } from '@/src/gameplay/HealthPickupManager';
import {
  CheckpointHazardPoint,
  clampCheckpointVitals,
  MissionAttemptContext,
  MissionCheckpointSnapshot,
  selectMissionCheckpointAnchor,
  validateSafeCheckpointSpawn,
} from '@/src/gameplay/MissionCheckpoint';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import {
  SustainmentContext,
  SustainmentEconomyManager,
  SustainmentVehicleTarget,
} from '@/src/gameplay/SustainmentEconomyManager';
import { VEHICLE_CAMERA_MODE_LABELS } from '@/src/gameplay/VehicleCameraRig';
import { VehicleEntity, VehicleManager } from '@/src/gameplay/VehicleManager';
import { TACTICAL_EQUIPMENT_CATALOG } from '@/src/data/attachments';
import {
  CampaignRebaseDiff,
  MissionConsequenceModifiers,
  resolveMissionConsequences,
} from '@/src/gameplay/campaign/CampaignEventLedger';
import { buildMissionCampaignEventDrafts } from '@/src/gameplay/campaign/MissionOutcomeBuilder';
import { hardwareReadinessHarness } from '@/src/gameplay/diagnostics/HardwareReadinessHarness';
import { DeploymentMode } from '@/src/schemas/campaign.schema';
import {
  FriendlySquadManager,
  SquadEnemyReadView,
  SquadHudSummary,
} from '@/src/gameplay/squad/FriendlySquadManager';
import {
  SquadCommandSource,
  SquadOrderType,
} from '@/src/gameplay/squad/SquadIntentRouter';
import { SQUAD_ARCHETYPE_FLYWEIGHTS } from '@/src/data/squadRoster';
import {
  DialogueTriggerInput,
  SquadDialogueDirector,
} from '@/src/gameplay/narrative/SquadDialogueDirector';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { buildSupplyCrate } from '@/src/world/builders/WorldPropsAndLandmarks';
import { PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { DIFFICULTY_COMBAT_PROFILES } from '@/src/schemas/combat.schema';
import { Difficulty, MissionGrade } from '@/src/schemas/common.schema';
import { EXPLOSIVE_BY_ID } from '@/src/schemas/explosive.schema';
import { AirUnitType, MissionConfig } from '@/src/schemas/mission.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { audioSettingsStore } from '@/src/stores/audioSettingsStore';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { MissionResultPayload, progressionStore } from '@/src/stores/progressionStore';
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
import { HudSnapshotPublisher } from './HudSnapshotPublisher';
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
  private readonly healthPickups: HealthPickupManager;
  private readonly sustainment = new SustainmentEconomyManager();
  private readonly encounterDirector = new EncounterDirector();
  private readonly soloDirector = new SoloEncounterDirector();
  private readonly friendlySquad = new FriendlySquadManager();
  private readonly squadDialogue = new SquadDialogueDirector();
  private activeDeploymentMode: DeploymentMode = 'fireteam';
  private activeOperationRunId = '';
  private activeCampaignConsequences: MissionConsequenceModifiers | null = null;
  private latestSquadHudSummary: SquadHudSummary | undefined = undefined;
  private friendlySuppressorActiveThisTick = false;
  private lastDialogueStageIndex = 1;
  private extractionLiveAnnounced = false;
  private readonly _squadForwardScratch = new THREE.Vector3();
  private readonly _squadRayOriginScratch = new THREE.Vector3();
  private readonly _squadRayDirScratch = new THREE.Vector3();
  private readonly _squadEnemyViewsScratch: SquadEnemyReadView[] = [];
  private readonly playtestTracker = new PlaytestExperienceTracker();
  private readonly hudPublisher = new HudSnapshotPublisher();
  private readonly combatDamage: CombatDamageResolver;
  private readonly cargoLiftManager = new CargoLiftManager(this.collisionWorld);
  private readonly _liftOccupantScratch: CargoLiftOccupantProxy[] = [];
  private lastDuckedSubtitle: string | null = null;
  private lastDuckedAlert: string | null = null;
  private weaponKillsMap: Record<string, number> = {};
  private activeModifiers: ReplayModifierId[] = [];
  private activeModifierEffects: CombinedModifierEffects = computeCombinedModifierEffects([]);
  private lastExtractionAttemptLogged = false;

  private workerBridge: WorkerBridge | null = null;
  private lights: SceneLights | null = null;
  private worldData: BuiltWorldData | null = null;
  private missionDirector: MissionDirector | null = null;
  private activeMission: MissionConfig | null = null;
  private activeScope: ResourceScope | null = null;
  private activeAbortController: AbortController | null = null;
  private attemptContext: MissionAttemptContext | null = null;
  private activeCheckpointSnapshot: MissionCheckpointSnapshot | null = null;
  private pendingDefeatPayload: MissionResultPayload | null = null;
  private dioramaAngle = 0;
  private dioramaLoaded = false;
  private reinforcementTimer = 28;
  private debugPublishAccum = 0;
  private suppressAutoPauseOnUnlock = false;
  private gpuReport: GpuCapabilityReport | null = null;
  private initialProbeFrames: number[] = [];
  private initialProbeSettled = false;
  private downedTimerSec = 0;
  private downedActive = false;
  private readonly _audioDir = new THREE.Vector3();
  private readonly _aimAssistForward = new THREE.Vector3();

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

    this.audio = new AudioManager(this.resourceManager, audioSettings, (prefs) => {
      const cur = audioSettingsStore.getState();
      if (
        cur.musicTrackId !== prefs.musicTrackId ||
        cur.musicShuffle !== prefs.musicShuffle ||
        cur.musicRepeatMode !== prefs.musicRepeatMode ||
        cur.musicEnabled !== prefs.musicEnabled
      ) {
        cur.updateAudio(prefs);
      }
    });
    this.input = new InputManager(
      this.resourceManager,
      settings.input,
      (locked) => {
        const wasLocked = uiStore.getState().pointerLocked;
        uiStore.getState().setPointerLocked(locked);
        if (locked) {
          this.suppressAutoPauseOnUnlock = false;
          return;
        }
        // Auto-pause only if pointer lock was active and dropped unexpectedly during active play
        if (wasLocked && uiStore.getState().screen === 'playing') {
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
    this.destruction.setOnColliderRegionChanged((box) => {
      this.workerBridge?.updateCollisionRegion(
        this.collisionWorld.spatialHash,
        box.minX - 1,
        box.minZ - 1,
        box.maxX + 1,
        box.maxZ + 1
      );
    });
    this.player = new PlayerController(this.audio);
    this.player.onHealthRegenerated = (amt) => {
      this.telemetry.recordHealthRegenerated(amt);
    };
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
    this.healthPickups = new HealthPickupManager(
      this.renderer.scene,
      this.resourceManager,
      this.vfx,
      this.audio
    );
    this.combatDamage = new CombatDamageResolver({
      audio: this.audio,
      vfx: this.vfx,
      collisionWorld: this.collisionWorld,
      player: this.player,
      weapons: this.weapons,
      enemies: this.enemies,
      vehicles: this.vehicles,
      airCombat: this.airCombat,
      explosives: this.explosives,
      destruction: this.destruction,
      healthPickups: this.healthPickups,
      sustainment: this.sustainment,
      monitor: this.monitor,
      telemetry: this.telemetry,
      getMissionDirector: () => this.missionDirector,
      getActiveScope: () => this.activeScope,
      getDifficulty: () => missionSelectionStore.getState().difficulty,
      onWeaponKill: (weaponId) => {
        this.weaponKillsMap[weaponId] = (this.weaponKillsMap[weaponId] ?? 0) + 1;
      },
      onNonObjectiveDestructibleDestroyed: (id, kind) => {
        if (kind === 'searchlight_tower' && this.encounterDirector.markSearchlightDestroyed(id)) {
          if (this.missionDirector) {
            this.missionDirector.score += 150;
          }
          if (this.encounterDirector.areAllSearchlightsDisabled()) {
            if (this.encounterDirector.recordOptionalObjectiveCompleted('m3_blackout_searchlights')) {
              if (this.missionDirector) {
                this.missionDirector.score += 350;
                this.missionDirector.showAlert('OPTIONAL COMPLETE: NIGHT SEARCHLIGHTS BLACKED OUT (+350)', 3.2);
                this.missionDirector.showSubtitle('OVERWATCH: Both searchlight towers neutralized — night cover secured.', 3.4);
              }
            }
          } else {
            this.missionDirector?.showAlert('SEARCHLIGHT TOWER DESTROYED (+150)', 2.0);
          }
        }
      },
      onHostileVehicleDestroyed: (veh) => {
        if (!this.activeMission) return;
        if (this.activeMission.id === 1 && !veh.isConvoyTarget) {
          if (this.encounterDirector.recordOptionalObjectiveCompleted('m1_urban_technical')) {
            if (this.missionDirector) {
              this.missionDirector.score += 300;
              this.missionDirector.showAlert('OPTIONAL COMPLETE: URBAN TECHNICAL NEUTRALIZED (+300)', 2.8);
            }
          }
        } else if (this.activeMission.id === 5 && !veh.isConvoyTarget) {
          if (this.encounterDirector.recordOptionalObjectiveCompleted('m5_foundry_armor')) {
            if (this.missionDirector) {
              this.missionDirector.score += 350;
              this.missionDirector.showAlert('OPTIONAL COMPLETE: FOUNDRY ARMOR DESTROYED (+350)', 2.8);
            }
          }
        }
      },
    });
    this.cargoLiftManager.onPortalStateChange((u) => {
      this.workerBridge?.updatePortalState(u.portalId, u.enabled, u.dynamicWaitCostSec, u.activeOccupants);
    });

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
    this.loop.setSoftwareGlPacing(this.renderer.isSoftwareGl);

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
        this.governor.setTargetRefreshRate(state.graphics.targetRefreshRate ?? 60);
        this.renderer.setRendererBackendPreference(state.graphics.rendererBackend ?? 'auto');
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
        } else if (
          (e.code === (settingsStore.getState().input.bindings.tacticalOverview ?? 'Tab') ||
            e.code === 'Tab') &&
          uiStore.getState().screen === 'playing'
        ) {
          e.preventDefault();
          uiStore.getState().toggleTacticalOverview();
          if (this.input.isPointerLocked()) {
            this.releasePointerLockForDebug();
          } else if (!uiStore.getState().tacticalOverviewOpen) {
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
    this.resourceManager.trackEventListener(
      window,
      'pageshow',
      () => {
        if (!document.hidden && uiStore.getState().screen !== 'paused') {
          this.audio.resume();
        }
      },
      'shared'
    );
  }

  private setupMenuDiorama(): void {
    this.clearWorldState();
    const scope: ResourceScope = 'mission:0';
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

  async startMission(
    missionId: number,
    difficulty: Difficulty,
    preferredWeapon?: WeaponId,
    deploymentMode?: DeploymentMode
  ): Promise<void> {
    this.audio.unlock();
    this.input.clearAllInputs();
    this.flushPendingDefeatProgression();
    const mission = getMissionById(missionId);
    const resolvedMode: DeploymentMode =
      deploymentMode ?? missionSelectionStore.getState().getDeploymentModeForMission(mission.id);
    this.activeDeploymentMode = resolvedMode;
    this.activeOperationRunId = `op_${mission.id}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    missionSelectionStore.getState().setSelectedMission(mission.id);
    missionSelectionStore.getState().setDifficulty(difficulty);
    missionSelectionStore.getState().setDeploymentMode(resolvedMode, mission.id);

    // Cleanly unload prior diorama or mission before starting next one
    this.unloadCurrentWorld();

    this.activeCheckpointSnapshot = null;
    this.attemptContext = {
      missionId: mission.id,
      difficulty,
      cumulativeElapsedSec: 0,
      checkpointDeathsCount: 0,
    };

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

  private flushPendingDefeatProgression(): void {
    if (!this.pendingDefeatPayload) return;
    progressionStore.getState().recordMissionResult(this.pendingDefeatPayload);
    this.pendingDefeatPayload = null;
  }

  private captureCheckpointSnapshot(): MissionCheckpointSnapshot | null {
    if (!this.activeMission || !this.missionDirector) return null;
    if (this.activeModifierEffects.disableCheckpoints) {
      this.activeCheckpointSnapshot = null;
      return null;
    }
    const activeObjIdx = this.missionDirector.getActiveObjectiveIndex();
    const completedIds = this.missionDirector.getCompletedObjectiveIds();
    const bypassedIds = this.missionDirector.getBypassedObjectiveIds();
    const destroyedTargetIds = this.missionDirector.getDestroyedTargetIds();
    const ammoSnap = this.weapons.captureAmmoSnapshot();
    const anchor = selectMissionCheckpointAnchor(this.activeMission, activeObjIdx);

    const snapshot: MissionCheckpointSnapshot = {
      missionId: this.activeMission.id,
      difficulty: missionSelectionStore.getState().difficulty,
      checkpointSequence: this.missionDirector.getCheckpointSequence(),
      activeObjectiveIndex: activeObjIdx,
      activeStageIndex: this.missionDirector.getActiveStageIndex(),
      completedObjectiveIds: completedIds,
      bypassedObjectiveIds: bypassedIds,
      destroyedTargetIds,
      sustainmentSnapshot: this.sustainment.captureSnapshot(),
      playerSpawn: anchor,
      healthAtCheckpoint: this.player.health,
      armorAtCheckpoint: this.player.armor,
      grenadesAtCheckpoint: this.player.grenades,
      c4AtCheckpoint: this.explosives.getC4Inventory(),
      activeWeaponId: ammoSnap.activeWeaponId,
      weaponAmmoState: ammoSnap.weaponAmmoState,
      scoreAtCheckpoint: this.missionDirector.score,
      killsAtCheckpoint: this.missionDirector.kills,
      headshotsAtCheckpoint: this.missionDirector.headshots,
      airKillsAtCheckpoint: this.missionDirector.airKills,
    };
    this.activeCheckpointSnapshot = snapshot;
    return snapshot;
  }

  private reconstructCompletedDestructibles(
    mission: MissionConfig,
    completedIds: ReadonlySet<string>,
    destroyedTargetIds: ReadonlySet<string>
  ): void {
    const completedTypes = new Set(
      mission.objectives.filter((o) => completedIds.has(o.id)).map((o) => o.type)
    );

    for (const ent of this.destruction.getAll()) {
      if (ent.state === 'DESTROYED') continue;
      if (destroyedTargetIds.has(ent.id)) {
        this.destruction.markDestroyedSilently(ent.id);
        continue;
      }
      if (!ent.isObjectiveTarget) continue;
      if (completedTypes.has('plant_charge') && ent.kind === 'weapons_cache') {
        this.destruction.markDestroyedSilently(ent.id);
      } else if (
        completedTypes.has('destroy_targets') &&
        (ent.kind === 'radar_relay' || ent.kind === 'fuel_tank')
      ) {
        this.destruction.markDestroyedSilently(ent.id);
      }
    }
  }

  private populateMissionWorld(
    mission: MissionConfig,
    difficulty: Difficulty,
    scope: ResourceScope,
    preferredWeapon?: WeaponId,
    restoredCheckpoint?: MissionCheckpointSnapshot
  ): void {
    if (!this.attemptContext || this.attemptContext.missionId !== mission.id) {
      this.attemptContext = {
        missionId: mission.id,
        difficulty,
        cumulativeElapsedSec: 0,
        checkpointDeathsCount: 0,
      };
    }

    const profile = this.governor.getProfile();
    const gSettings = settingsStore.getState().graphics;
    this.lights = setupLightingRig(
      this.renderer.scene,
      mission.lighting,
      profile.shadowMapSize,
      profile.shadowDistance,
      this.resourceManager,
      mission.id
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

    const completedSet = new Set([
      ...(restoredCheckpoint?.completedObjectiveIds ?? []),
      ...(restoredCheckpoint?.bypassedObjectiveIds ?? []),
    ]);
    const destroyedTargetSet = new Set(restoredCheckpoint?.destroyedTargetIds ?? []);
    if (restoredCheckpoint && (completedSet.size > 0 || destroyedTargetSet.size > 0)) {
      this.reconstructCompletedDestructibles(mission, completedSet, destroyedTargetSet);
    }

    this.cargoLiftManager.clear();
    for (const liftDef of this.worldData.cargoLifts) {
      this.cargoLiftManager.registerLift(liftDef);
    }

    this.workerBridge = new WorkerBridge(this.resourceManager, scope);
    this.workerBridge.uploadNavigationSurfaces(
      this.collisionWorld.spatialHash,
      this.worldData.elevatedSurfaces,
      this.worldData.navPortals,
      this.collisionWorld.getGroundHeightAt
    );
    if (restoredCheckpoint) {
      this.cargoLiftManager.normalizeForCheckpoint();
    }
    this.enemies.setCargoLiftManager(this.cargoLiftManager);
    this.enemies.setWorkerBridge(this.workerBridge);

    // Stage 7 TRN-39: Resolve deterministic cross-mission campaign consequences for active replayMode
    const saveSnapshot = progressionStore.getState().save;
    const replayMode = missionSelectionStore.getState().replayMode;
    this.activeCampaignConsequences = resolveMissionConsequences(
      mission.id,
      saveSnapshot.campaignLedger,
      replayMode
    );
    const bonusSupplyCharges = this.activeCampaignConsequences.bonusSupplyCharges;

    const isSoloMode = this.activeDeploymentMode === 'solo';
    this.soloDirector.reset(isSoloMode, mission.id, difficulty);

    this.sustainment.clear();
    for (const sc of this.worldData.supplyCrates) {
      this.sustainment.registerStation({
        id: sc.id,
        kind: sc.kind ?? 'ammo_crate',
        position: sc.position,
        maxCharges: (sc.maxCharges ?? 2) + bonusSupplyCharges,
        mesh: sc.mesh,
        statusLightMesh: sc.statusLightMesh ?? null,
      });
    }
    if (isSoloMode) {
      for (const soloStation of this.soloDirector.getSoloBonusSupplyStations(mission.id)) {
        const groundY = this.collisionWorld.getGroundHeightAt(
          soloStation.position.x,
          soloStation.position.z
        );
        this.sustainment.registerStation({
          id: soloStation.id,
          kind: soloStation.kind,
          position: new THREE.Vector3(
            soloStation.position.x,
            Number.isFinite(groundY) ? groundY : soloStation.position.y,
            soloStation.position.z
          ),
          maxCharges: soloStation.maxCharges,
          label: soloStation.label,
        });
      }
    }
    if (restoredCheckpoint?.sustainmentSnapshot) {
      this.sustainment.restoreSnapshot(restoredCheckpoint.sustainmentSnapshot);
    }

    this.telemetry.reset();
    this.telemetry.setMissionId(mission.id);
    this.encounterDirector.reset(
      mission.id,
      this.activeCampaignConsequences,
      this.activeDeploymentMode
    );
    if (!restoredCheckpoint) {
      this.playtestTracker.reset();
      this.weaponKillsMap = {};
    }
    this.lastExtractionAttemptLogged = false;

    this.activeModifiers = [...(progressionStore.getState().save.activeModifiers ?? [])];
    this.activeModifierEffects = computeCombinedModifierEffects(this.activeModifiers);

    this.monitor.reset();
    this.rulesEngine.reset();
    this.explosives.reset();
    this.coordinator.reset();
    this.coordinator.setDifficulty(difficulty);
    this.coordinator.setSoloConstraints(this.soloDirector.getEngagementConstraints());
    this.enemies.setDifficulty(difficulty);
    this.vehicles.setDifficulty(difficulty);
    this.vehicles.setMapId(mission.mapId);
    this.airCombat.setDifficulty(difficulty);
    this.player.setDifficultyProfile(DIFFICULTY_COMBAT_PROFILES[difficulty]);
    this.player.setIncomingDamageScale(this.activeModifierEffects.enemyDamageMultiplier);
    this.weapons.setDamageModifiers(this.activeModifierEffects.headshotDamageMultiplier, 1.0);
    this.downedActive = false;
    this.downedTimerSec = 0;
    this.lastDuckedSubtitle = null;
    this.lastDuckedAlert = null;
    gameSessionStore.getState().setDownedState(null);

    const completedObjectives = mission.objectives.filter((o) => completedSet.has(o.id));
    const incompleteObjectives = mission.objectives.filter((o) => !completedSet.has(o.id));
    const convoyCompleted = completedObjectives.some((o) => o.type === 'convoy_intercept');
    const waveCompleted = completedObjectives.some((o) => o.type === 'eliminate_wave');

    const neededAirTypes = new Set<AirUnitType>();
    let hasIncompleteOpenAirObj = false;
    for (const o of incompleteObjectives) {
      if (o.type === 'air_defense') {
        if (o.targetAirUnitTypes && o.targetAirUnitTypes.length > 0) {
          for (const t of o.targetAirUnitTypes) neededAirTypes.add(t);
        } else {
          hasIncompleteOpenAirObj = true;
        }
      }
    }
    const completedAirTypes = new Set<AirUnitType>();
    for (const o of completedObjectives) {
      if (o.type === 'air_defense' && o.targetAirUnitTypes) {
        for (const t of o.targetAirUnitTypes) completedAirTypes.add(t);
      }
    }

    if (!waveCompleted) {
      for (const w of mission.initialWaves) {
        this.enemies.spawnWave(w.archetype, w.count, w.spawnArea, w.radius, this.collisionWorld, scope);
      }
    } else if (incompleteObjectives.length > 0) {
      const nextGroundObj =
        incompleteObjectives.find((o) => o.type !== 'air_defense') ?? incompleteObjectives[0];
      this.enemies.spawnWave(
        'elite_assault',
        2,
        { x: nextGroundObj.markerPos.x, y: 0, z: nextGroundObj.markerPos.z },
        10,
        this.collisionWorld,
        scope
      );
    }

    for (const v of mission.vehicles) {
      if (convoyCompleted && v.isConvoyTarget) continue;
      this.vehicles.spawnVehicle(v.type, v.position, v.yaw, v.hostile, v.isConvoyTarget, this.collisionWorld, scope);
    }

    for (const a of mission.airUnits) {
      if (
        completedAirTypes.has(a.type) &&
        !hasIncompleteOpenAirObj &&
        !neededAirTypes.has(a.type)
      ) {
        continue;
      }
      for (let k = 0; k < a.count; k++) {
        const angle = (k / Math.max(1, a.count)) * Math.PI * 2 + Math.random() * 0.4;
        this.airCombat.spawnUnit(a.type, a.altitude, a.orbitRadius, angle, scope);
      }
    }

    this.healthPickups.spawnMapMedStations(mission.mapId, this.collisionWorld, scope, difficulty);

    const activeLoadout = saveSnapshot.activeMissionLoadout;
    const equipSpec = TACTICAL_EQUIPMENT_CATALOG[activeLoadout.tacticalEquipment];
    const carriedSlots: WeaponId[] = [
      activeLoadout.primaryWeapon,
      activeLoadout.secondaryWeapon,
      activeLoadout.heavyWeapon,
    ];
    const startWeapon = preferredWeapon ?? activeLoadout.primaryWeapon;

    if (restoredCheckpoint) {
      const hazards: CheckpointHazardPoint[] = [];
      for (const u of this.enemies.getUnits()) {
        if (u.alive) hazards.push({ x: u.position.x, z: u.position.z });
      }
      for (const veh of this.vehicles.getVehicles()) {
        if (veh.alive && veh.hostile) hazards.push({ x: veh.position.x, z: veh.position.z });
      }
      for (const ent of this.destruction.getAll()) {
        if (ent.state !== 'DESTROYED' && ent.blastRadius > 0) {
          hazards.push({ x: ent.position.x, z: ent.position.z });
        }
      }

      const safeSpawn = validateSafeCheckpointSpawn(
        restoredCheckpoint.playerSpawn,
        { ...mission.playerSpawn, yaw: mission.playerYaw },
        this.collisionWorld,
        hazards
      );
      this.player.spawn(safeSpawn.x, safeSpawn.y, safeSpawn.z, safeSpawn.yaw);
      const vitals = clampCheckpointVitals(
        restoredCheckpoint.healthAtCheckpoint,
        restoredCheckpoint.armorAtCheckpoint,
        this.player.maxHealth,
        this.player.maxArmor
      );
      this.player.applyCheckpointVitals(vitals.health, vitals.armor);
      if (typeof restoredCheckpoint.grenadesAtCheckpoint === 'number') {
        this.player.grenades = Math.max(1, Math.min(4, restoredCheckpoint.grenadesAtCheckpoint));
      }
      if (typeof restoredCheckpoint.c4AtCheckpoint === 'number') {
        this.explosives.setC4Inventory(restoredCheckpoint.c4AtCheckpoint);
      }

      this.weapons.resetLoadout(startWeapon, carriedSlots);
      this.weapons.restoreCheckpointLoadout(
        restoredCheckpoint,
        mission,
        incompleteObjectives.map((o) => ({ type: o.type, actionMeta: o.actionMeta }))
      );
    } else {
      this.player.spawn(
        mission.playerSpawn.x,
        mission.playerSpawn.y,
        mission.playerSpawn.z,
        mission.playerYaw
      );
      this.weapons.resetLoadout(startWeapon, carriedSlots);
      if (equipSpec.bonusGrenades > 0) {
        this.player.resupplyGrenades(equipSpec.bonusGrenades, 6);
      }
      const extraC4 = equipSpec.bonusC4 + (this.activeCampaignConsequences?.bonusStartingC4 ?? 0);
      if (extraC4 > 0) {
        this.explosives.resupplyC4(extraC4, 5);
      }
    }

    // Stage 7 TRN-37 & Redesign: Respect Solo vs. Fireteam deployment mode strictly
    this.latestSquadHudSummary = undefined;
    this.friendlySuppressorActiveThisTick = false;
    this.squadDialogue.reset();
    this.lastDialogueStageIndex = 1;
    this.extractionLiveAnnounced = false;

    if (this.activeDeploymentMode === 'solo') {
      this.friendlySquad.dispose(this.renderer.scene);
    } else {
      this.friendlySquad.initializeForMission({
        scene: this.renderer.scene,
        resourceManager: this.resourceManager,
        scope,
        roster: saveSnapshot.squadRoster,
        preferredSquadIds: activeLoadout.squadIds,
        spawnOrigin: {
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z,
        },
        difficulty,
        bonusMedCharges: equipSpec.bonusSquadMedCharges,
        initialFormation: activeLoadout.initialFormation ?? 'WEDGE',
      });

      const deployedOps = this.friendlySquad.getOperators();
      const leadOp = deployedOps[0];
      if (leadOp) {
        this.emitSquadDialogue({
          event: 'mission_deploy',
          nowSec: 0,
          operatorId: leadOp.id,
          callsign: leadOp.record.callsign,
          role: leadOp.role,
          missionId: mission.id,
        });
      }
      const firstConsequence = this.activeCampaignConsequences?.activeSummaries[0];
      if (firstConsequence && deployedOps[1]) {
        this.emitSquadDialogue({
          event: 'campaign_consequence_ack',
          nowSec: 4.5,
          operatorId: deployedOps[1].id,
          callsign: deployedOps[1].record.callsign,
          role: deployedOps[1].role,
          missionId: mission.id,
          consequenceEventId: firstConsequence.eventId,
        });
      }
    }

    // Immediately align camera with spawned player eye position before Frame 0 render/projection
    this.player.syncCamera(
      this.renderer.camera,
      gSettings.fov,
      this.weapons.getActiveState().config.adsFov,
      false,
      0
    );

    this.missionDirector = new MissionDirector(
      mission,
      difficulty,
      this.attemptContext,
      restoredCheckpoint,
      () => {
        if (!this.activeModifierEffects.disableCheckpoints) {
          this.captureCheckpointSnapshot();
          this.missionDirector?.showAlert('CHECKPOINT SAVED', 2.4);
        }
      }
    );
    if (!restoredCheckpoint && !this.activeModifierEffects.disableCheckpoints) {
      this.captureCheckpointSnapshot();
    }
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

    // Player chose checkpoint recovery rather than abandoning a failed attempt
    this.pendingDefeatPayload = null;
    if (this.attemptContext) {
      this.attemptContext.checkpointDeathsCount += 1;
    }
    const preservedAttempt = this.attemptContext;
    const snapshotToRestore = this.activeCheckpointSnapshot;

    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.audio.resume();
    this.audio.unlock();
    this.audio.stopMissionLoops();
    this.input.clearAllInputs();
    this.workerBridge?.dispose();
    this.workerBridge = null;
    this.clearWorldState();
    this.telemetry.recordMissionRestart();
    this.playtestTracker.recordCheckpointRestart();

    this.attemptContext = preservedAttempt;
    this.activeCheckpointSnapshot = snapshotToRestore;
    this.activeScope = scope;
    this.activeMission = mission;
    gameSessionStore.getState().resetSession();

    this.populateMissionWorld(
      mission,
      difficulty,
      scope,
      currentWeaponId,
      snapshotToRestore ?? undefined
    );

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
    this.flushPendingDefeatProgression();
    this.attemptContext = null;
    this.activeCheckpointSnapshot = null;
    this.suppressAutoPauseOnUnlock = false;
    uiStore.getState().setDebugSimPaused(false);
    this.input.exitPointerLock();
    this.unloadToMenu(targetScreen);
  }

  requestPointerLock(): void {
    const touchOverride = uiStore.getState().touchHudOverride;
    const touchMode = settingsStore.getState().input.touchMode;
    const isCoarse =
      typeof window !== 'undefined' &&
      Boolean(
        window.matchMedia?.('(pointer: coarse)')?.matches ||
          (typeof navigator !== 'undefined' &&
            navigator.maxTouchPoints > 0 &&
            Math.max(window.innerWidth, window.innerHeight) <= 1366)
      );
    const touchActive =
      touchOverride !== null ? touchOverride : touchMode === 'always_on' ? true : touchMode === 'always_off' ? false : isCoarse;
    if (touchActive) return;

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
    this.enemies.setCargoLiftManager(null);
    this.enemies.setWorkerBridge(null);
    this.cargoLiftManager.clear();
    this.vehicles.forceExitIfOccupied(this.player, this.collisionWorld);
    this.vehicles.clear();
    this.airCombat.clear();
    this.healthPickups.clear();
    this.sustainment.clear();
    this.friendlySquad.dispose(this.renderer.scene);
    this.latestSquadHudSummary = undefined;
    this.destruction.clear();
    this.collisionWorld.clear();
    this.chunkManager.clear(this.renderer.scene);
    this.coordinator.reset();
    this.telemetry.reset();
    this.rulesEngine.reset();
    this.hudPublisher.reset();
    this.debugRenderer.setVisible(false);

    this.resourceManager.unloadScope('mission:lights');
    this.resourceManager.unloadScope('mission:audio');
    this.resourceManager.unloadScope('mission:0');
    this.resourceManager.unloadScope('mission:diorama');
    this.resourceManager.unloadScope('mission:world');
    if (this.activeScope) {
      this.resourceManager.unloadScope(this.activeScope);
      this.activeScope = null;
    }
    this.lights = null;
    this.worldData = null;
    this.missionDirector = null;
    this.activeMission = null;
    this.downedActive = false;
    this.downedTimerSec = 0;
    gameSessionStore.getState().setDownedState(null);
  }

  private onSampleInput = (): void => {
    if (uiStore.getState().screen !== 'playing' || !this.activeMission || !this.missionDirector) return;

    // [E] Context-sensitive interact: Supply crate, plant charge on objective cache, or enter/exit vehicle
    if (this.input.wasActionPressed('interact')) {
      const handledInteract = this.tryContextualInteract();
      if (!handledInteract) {
        this.vehicles.togglePlayerVehicle(this.player, this.collisionWorld);
        this.input.clearVirtualVehicleInputs();
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

    // Solo Operator Emergency Trauma Self-Recovery on [F] while downed
    if (
      this.activeDeploymentMode === 'solo' &&
      this.downedActive &&
      this.input.wasKeyPressed('KeyF')
    ) {
      this.triggerSoloSelfRecovery();
    }

    // Stage 7 TRN-37: Desktop Squad Quick Keys [F1]-[F4] (Fireteam mode only)
    if (this.activeDeploymentMode === 'fireteam') {
      if (this.input.wasKeyPressed('F1')) {
        this.issueSquadCommand('REGROUP', 'desktop_quick_key');
      } else if (this.input.wasKeyPressed('F2')) {
        this.issueSquadCommand('MOVE', 'desktop_quick_key');
      } else if (this.input.wasKeyPressed('F3')) {
        this.issueSquadCommand('ATTACK_TARGET', 'desktop_quick_key');
      } else if (this.input.wasKeyPressed('F4')) {
        this.issueSquadCommand('FLANK', 'desktop_quick_key');
      }
    }
  };

  /**
   * Triggers the limited 1-charge Solo Operator emergency trauma self-recovery while downed.
   */
  public triggerSoloSelfRecovery(): boolean {
    if (
      this.activeDeploymentMode !== 'solo' ||
      !this.activeMission ||
      !this.downedActive ||
      this.player.alive
    ) {
      return false;
    }
    const outcome = this.soloDirector.useTraumaSelfRecovery();
    if (!outcome.ok) return false;

    this.player.applyCheckpointVitals(outcome.restoredHealth, outcome.restoredArmor);
    this.downedActive = false;
    this.downedTimerSec = 0;
    this.renderer.camera.rotation.z = 0;
    gameSessionStore.getState().setDownedState(null);
    this.coordinator.setSoloConstraints(this.soloDirector.getEngagementConstraints());
    this.audio.play2D('ui_click', 5, 0.55);
    this.missionDirector?.showAlert(
      'EMERGENCY TRAUMA INJECTOR DEPLOYED — REPOSITION TO COVER',
      3.0
    );
    this.publishHudSnapshot();
    return true;
  }

  /**
   * TRN-37 Public Squad Command Entry Point (used by Desktop Hold-Q Radial, F1-F4 Quick Keys,
   * Tactical Map Pings, and Mobile Thumb-Safe Command Strip).
   */
  public issueSquadCommand(
    order: SquadOrderType,
    source: SquadCommandSource,
    operatorId?: string | null,
    explicitWorldPos?: { x: number; y: number; z: number } | null
  ): boolean {
    if (this.activeDeploymentMode === 'solo') return false;
    if (!this.activeMission || !this.player.alive) return false;
    this.renderer.camera.getWorldPosition(this._squadRayOriginScratch);
    this.renderer.camera.getWorldDirection(this._squadRayDirScratch);

    // Resolve crosshair context (enemy, friendly vehicle, or terrain point)
    let targetEnemyId: string | null = null;
    let targetVehicleId: string | null = null;
    let worldPoint = explicitWorldPos ?? null;

    if (!worldPoint) {
      let bestEnemyDot = 0.96;
      for (const u of this.enemies.getUnits()) {
        if (!u.alive) continue;
        const toE = this._squadForwardScratch.subVectors(u.position, this._squadRayOriginScratch);
        const dist = toE.length();
        if (dist > 95 || dist < 1) continue;
        const dot = toE.divideScalar(dist).dot(this._squadRayDirScratch);
        if (dot > bestEnemyDot) {
          bestEnemyDot = dot;
          targetEnemyId = u.id;
          worldPoint = { x: u.position.x, y: u.position.y, z: u.position.z };
        }
      }

      if (!targetEnemyId) {
        for (const v of this.vehicles.getVehicles()) {
          if (!v.alive || v.hostile) continue;
          const toV = this._squadForwardScratch.subVectors(v.position, this._squadRayOriginScratch);
          const dist = toV.length();
          if (dist > 45 || dist < 1) continue;
          const dot = toV.divideScalar(dist).dot(this._squadRayDirScratch);
          if (dot > 0.94) {
            targetVehicleId = v.id;
            worldPoint = { x: v.position.x, y: v.position.y, z: v.position.z };
            break;
          }
        }
      }

      if (!worldPoint) {
        const hit: RayHit = {
          hit: false,
          distance: 65,
          pointX: 0,
          pointY: 0,
          pointZ: 0,
          normalX: 0,
          normalY: 1,
          normalZ: 0,
          collider: null,
        };
        const didHit = this.collisionWorld.sweptSegmentTest(
          this._squadRayOriginScratch.x,
          this._squadRayOriginScratch.y,
          this._squadRayOriginScratch.z,
          this._squadRayDirScratch.x,
          this._squadRayDirScratch.y,
          this._squadRayDirScratch.z,
          65,
          PHYSICS_MASKS.BALLISTIC_RAY,
          hit
        );
        if (didHit && hit.hit) {
          worldPoint = { x: hit.pointX, y: hit.pointY, z: hit.pointZ };
        } else {
          const fallbackX = this._squadRayOriginScratch.x + this._squadRayDirScratch.x * 18;
          const fallbackZ = this._squadRayOriginScratch.z + this._squadRayDirScratch.z * 18;
          const fallbackY = this.collisionWorld.getGroundHeightAt(fallbackX, fallbackZ);
          worldPoint = { x: fallbackX, y: fallbackY, z: fallbackZ };
        }
      }
    }

    // Contextual smart ping resolution (used by mobile single-tap ping & smart F-keys)
    let resolvedOrder = order;
    if (source === 'mobile_context_ping') {
      if (targetEnemyId) resolvedOrder = 'ATTACK_TARGET';
      else if (targetVehicleId) resolvedOrder = 'BOARD_VEHICLE';
      else resolvedOrder = 'MOVE';
    } else if (order === 'BOARD_VEHICLE' && !targetVehicleId) {
      const nearestVeh = this.vehicles.getNearestFriendlyVehicle(this.player.position, 28);
      if (nearestVeh) targetVehicleId = nearestVeh.id;
    }

    const res = this.friendlySquad.issueCommand(
      {
        order: resolvedOrder,
        source,
        operatorId: operatorId ?? null,
        targetPos: worldPoint,
        targetEnemyId,
        targetVehicleId,
        issuedAtSec: this.telemetry.getElapsedSec(),
      },
      this.buildSquadIntentValidationCtx()
    );

    if (res.accepted && res.intent) {
      this.audio.play2D('squad_order_confirm', 6, 0.54, 0.02);
      this.playtestTracker.recordSquadCommand(resolvedOrder);
      const respondingOp =
        (operatorId
          ? this.friendlySquad.getOperators().find((o) => o.id === operatorId && o.alive)
          : null) ??
        this.friendlySquad.getOperators().find((o) => o.alive);
      if (respondingOp) {
        this.emitSquadDialogue({
          event: 'order_ack',
          nowSec: this.telemetry.getElapsedSec(),
          operatorId: respondingOp.id,
          callsign: respondingOp.record.callsign,
          role: respondingOp.role,
          order: resolvedOrder,
        });
      }
      this.missionDirector?.showSubtitle(`SQUAD: ${res.intent.label}`, 2.4);
      return true;
    }
    if (res.reason && source !== 'system_fallback') {
      this.missionDirector?.showAlert(res.reason, 1.8);
    }
    return false;
  }

  private emitSquadDialogue(input: DialogueTriggerInput): void {
    const transmission = this.squadDialogue.trigger(input);
    if (!transmission) return;
    this.audio.playOperatorRadioVoice(
      {
        basePitchHz: transmission.voice.baseFreqHz,
        formantPitchHz: transmission.voice.secondFreqHz,
        cadenceMs: transmission.voice.cadenceMs,
        radioClickHz: transmission.voice.squelchToneHz,
      },
      transmission.priority
    );
  }

  /**
   * TRN-38 Field Armory Weapon Swap at designated Sustainment Stations.
   */
  public swapFieldWeapon(replaceSlotIndex: number, nextWeaponId: WeaponId): { ok: boolean; message: string } {
    if (!this.activeMission || !this.player.alive) {
      return { ok: false, message: 'Unavailable outside active mission.' };
    }
    if (!this.isPlayerNearSupplySwapStation()) {
      return { ok: false, message: 'Move near an active Ammo Resupply Station to swap weapons.' };
    }
    const res = this.weapons.swapWeaponAtSupplyStation({
      replaceSlotIndex,
      nextWeaponId,
      reqCost: 60,
      useAmmoTradeoffIfLowReq: true,
    });
    this.missionDirector?.showAlert(res.message, 2.5);
    return res;
  }

  private isPlayerNearSupplySwapStation(): boolean {
    const stations = this.sustainment.getStations();
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      if (s.destroyed || s.kind !== 'ammo_crate') continue;
      if (s.position.distanceTo(this.player.position) <= 5.2) {
        return true;
      }
    }
    return false;
  }

  private buildSquadIntentValidationCtx() {
    return {
      playerPos: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
      },
      isEnemyAlive: (id: string) => {
        const u = this.enemies.getUnits().find((e) => e.id === id);
        return Boolean(u && u.alive);
      },
      getEnemyPos: (id: string) => {
        const u = this.enemies.getUnits().find((e) => e.id === id && e.alive);
        return u ? { x: u.position.x, y: u.position.y, z: u.position.z } : null;
      },
      isVehicleBoardable: (id: string) => {
        const v = this.vehicles.getVehicles().find((veh) => veh.id === id);
        return Boolean(v && v.alive && !v.hostile && v.passengerOccupantIds.length < v.maxPassengerSeats);
      },
      getVehiclePos: (id: string) => {
        const v = this.vehicles.getVehicles().find((veh) => veh.id === id && veh.alive);
        return v ? { x: v.position.x, y: v.position.y, z: v.position.z } : null;
      },
    };
  }

  private wrapVehicleForSustainment(veh: VehicleEntity | null): SustainmentVehicleTarget | null {
    if (!veh) return null;
    return {
      id: veh.id,
      alive: veh.alive,
      hostile: veh.hostile,
      displayName: veh.displayName,
      health: veh.health,
      maxHealth: veh.maxHealth,
      speed: veh.speed,
      position: veh.position,
      turretAmmo: veh.turretAmmo,
      maxTurretAmmo: veh.maxTurretAmmo,
      lastDamagedAtSec: veh.lastDamagedAtSec,
      repairAndRearm: (hullFraction, turretAmmoFraction) =>
        this.vehicles.repairAndRearmVehicle(veh, hullFraction, turretAmmoFraction),
    };
  }

  private buildSustainmentContext(): SustainmentContext {
    const playerVeh = this.vehicles.getPlayerVehicle();
    const nearbyFriendly = !playerVeh
      ? this.vehicles.getNearestFriendlyVehicle(this.player.position, 7.5)
      : null;
    return {
      player: this.player,
      weapons: this.weapons,
      explosives: this.explosives,
      playerVehicle: this.wrapVehicleForSustainment(playerVeh),
      nearbyFriendlyVehicle: this.wrapVehicleForSustainment(nearbyFriendly),
      difficulty: missionSelectionStore.getState().difficulty,
      nowSec: this.telemetry.getElapsedSec(),
      ammoGrantScale: this.activeModifierEffects.ammoGrantScale,
    };
  }

  private tryContextualInteract(): boolean {
    if (!this.worldData || !this.missionDirector) return false;
    // Check authoritative tactical sustainment stations (ammo crates, med/armor stations, vehicle repair bays)
    const sustainCtx = this.buildSustainmentContext();
    const origin = sustainCtx.playerVehicle
      ? sustainCtx.playerVehicle.position
      : this.player.position;
    const nearbyStation = this.sustainment.findNearestStation(
      origin,
      Boolean(sustainCtx.playerVehicle)
    );
    if (nearbyStation) {
      const res = this.sustainment.beginInteraction(sustainCtx, nearbyStation.station.id);
      if (res.ok) {
        this.audio.play2D('ui_click', 5, 0.5);
        return true;
      }
      // If inside a vehicle and already full/depleted at bay, allow [E] to exit vehicle unless actively blocked
      if (
        !sustainCtx.playerVehicle ||
        res.code === 'vehicle_moving' ||
        res.code === 'vehicle_under_fire' ||
        res.code === 'cooldown'
      ) {
        this.audio.play2D('empty_click', 4, 0.45);
        this.missionDirector.showAlert(res.message, 2.2);
        return true;
      }
    }
    // Check weapons caches / destructible objectives to plant charge or sabotage directly via [E]
    for (const d of this.destruction.getAll()) {
      if (
        d.state !== 'DESTROYED' &&
        d.isObjectiveTarget &&
        d.position.distanceTo(this.player.position) < 4.2
      ) {
        if (d.kind === 'weapons_cache') {
          this.missionDirector.onChargePlanted(300, d.id, 'interact_charge');
          this.destruction.markDestroyedSilently(d.id);
          this.vfx.spawnExplosion(
            d.position.x,
            d.position.y + 0.8,
            d.position.z,
            1.4
          );
          this.audio.playSpatial('explosion', d.position.x, d.position.y, d.position.z, 9, 0.9);
          return true;
        }
        this.destruction.applyDamage(
          d.id,
          9999,
          this.combatDamage.handleExplosion,
          (ent) =>
            this.missionDirector?.onDestructibleTargetDestroyed(
              300,
              ent.kind,
              ent.id,
              'interact_charge'
            )
        );
        return true;
      }
    }
    if (!this.vehicles.getPlayerVehicle() && this.cargoLiftManager.tryPlayerInteract(this.player.position)) {
      this.audio.play2D('ui_click', 4, 0.45);
      return true;
    }
    return false;
  }

  private onFixedStep = (dt: number): void => {
    this.audio.tick(dt);
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

    this.player.touchAimFrictionScale = inVehicle ? 1.0 : this.computeTouchAimFrictionScale();

    if (this.cargoLiftManager.getLiftCount() > 0) {
      this.enemies.fillLiftOccupantProxies(this.player, this._liftOccupantScratch);
      this.cargoLiftManager.updateFixed(dt, this._liftOccupantScratch);
    }

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

    // Build combined hitscan & lock-on targets without per-tick array/closure allocations
    const { hitscanTargets, lockCandidates } = this.combatDamage.collectFrameTargets();

    const tGame0 = performance.now();
    const shotsBefore = this.weapons.shotsFired;
    this.weapons.update(
      dt,
      this.input,
      this.player,
      this.renderer.camera,
      this.collisionWorld,
      hitscanTargets,
      lockCandidates,
      this.combatDamage.onWeaponApplyDestructionDamage,
      inVehicle
    );
    if (this.weapons.shotsFired > shotsBefore) {
      const seenSquads = new Set<string>();
      const squadCentroids: Array<{ squadId: string; spotterUnitId: string; x: number; y: number; z: number }> = [];
      for (const u of this.enemies.getUnits()) {
        if (!u.alive) continue;
        const sqId = u.squadId || 'default';
        if (seenSquads.has(sqId)) continue;
        seenSquads.add(sqId);
        squadCentroids.push({
          squadId: sqId,
          spotterUnitId: u.id,
          x: u.position.x,
          y: u.position.y,
          z: u.position.z,
        });
      }
      this.encounterDirector.intelBoard.emitAcousticEvent({
        source: 'gunshot',
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        soundRadiusMeters: this.weapons.getActiveWeaponSoundRadiusMeters(),
        squadCentroids,
        observedPlayerInVehicle: inVehicle,
        observedFriendlySuppressor: this.friendlySuppressorActiveThisTick,
      });
    }

    // Vehicles & Roof Turret
    const hadManualLookInput = this.input.hasPendingLookDelta();
    this.vehicles.update(
      dt,
      this.input,
      this.player,
      this.renderer.camera,
      this.collisionWorld,
      this.worldData?.roadWaypoints ?? [],
      this.combatDamage.onTurretShotCheck,
      this.combatDamage.onVehicleConvoyDestroyed,
      settings.graphics.fov,
      hadManualLookInput
    );

    // Collectible 3D Heart Health Pickups
    const nowDrivingVehicle = this.vehicles.getPlayerVehicle() !== null;
    this.healthPickups.update(
      dt,
      this.player,
      nowDrivingVehicle,
      (msg, dur) => this.missionDirector?.showAlert(msg, dur),
      (msg, dur) => this.missionDirector?.showSubtitle(msg, dur),
      (healedAmount) => this.telemetry.recordHealthPickupCollected(healedAmount)
    );

    // Authoritative tactical sustainment economy channeling & emergency ordnance anti-softlock safeguard
    const sustainCtx = this.buildSustainmentContext();
    const sustainResult = this.sustainment.update(dt, sustainCtx);
    if (sustainResult) {
      if (sustainResult.ok && sustainResult.code === 'completed') {
        if (sustainResult.hpAdded) this.telemetry.recordHealthRegenerated(sustainResult.hpAdded);
        if (sustainResult.armorAdded) this.telemetry.recordArmorRestored(sustainResult.armorAdded);
        this.telemetry.recordSupplyCrateUsed();
        this.audio.play2D('reload', 6, 0.65);
        this.missionDirector.showAlert(sustainResult.message, 2.8);
      } else if (!sustainResult.ok) {
        this.audio.play2D('empty_click', 4, 0.4);
        this.missionDirector.showAlert(sustainResult.message, 2.2);
      }
    }

    if (this.activeScope && this.player.alive) {
      const objStatuses = this.missionDirector.getObjectiveStatuses();
      const requiresHeavyOrdnance = objStatuses.some(
        (o) =>
          !o.completed &&
          (o.type === 'air_defense' ||
            o.type === 'convoy_intercept' ||
            o.type === 'destroy_targets' ||
            o.type === 'plant_charge')
      );
      if (
        requiresHeavyOrdnance &&
        !this.sustainment.hasAvailableAmmoStation() &&
        !this.weapons.hasAnyHeavyOrdnanceAmmo() &&
        this.explosives.getC4Inventory() === 0
      ) {
        const dropY = this.collisionWorld.getGroundHeightAt(
          this.player.position.x + 2.4,
          this.player.position.z + 2.4
        );
        const podMesh = buildSupplyCrate(this.assetManager, this.resourceManager, this.activeScope);
        const pod = this.sustainment.tryDeployEmergencyOrdnancePod({
          requiresHeavyOrdnance: true,
          weapons: this.weapons,
          explosives: this.explosives,
          playerPos: this.player.position,
          groundY: dropY,
          mesh: podMesh,
        });
        if (pod) {
          podMesh.position.copy(pod.position);
          this.renderer.scene.add(podMesh);
          this.resourceManager.register('object3d', this.activeScope, () => {
            this.renderer.scene.remove(podMesh);
          });
          this.missionDirector.showSubtitle(
            'COMMAND: Emergency Ordnance Pod air-dropped at your flank — resupply heavy launchers [E].',
            4.0
          );
          this.audio.duckMusicForDialogue(3.6, 0.32);
        }
      }
    }

    // Pooled projectiles (rockets, guided missiles, grenades, aerial bombs, TRIDENT-X)
    const tProj0 = performance.now();
    const proxScratch = this.combatDamage.collectProximityPositions();
    const explosiveCallbacks = this.combatDamage.getExplosiveCallbacks();
    this.projectiles.update(
      dt,
      this.collisionWorld,
      this.combatDamage.handleExplosionEvent,
      proxScratch
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
    if (this.activeMission.extractionPoint && this.player.alive) {
      const ep = this.activeMission.extractionPoint;
      const distEx = Math.hypot(this.player.position.x - ep.x, this.player.position.z - ep.z);
      if (distEx < 8.5) {
        if (!this.lastExtractionAttemptLogged) {
          this.playtestTracker.recordExtractionAttempt();
          this.lastExtractionAttemptLogged = true;
        }
        this.missionDirector.onExtractionReached();
      } else {
        this.lastExtractionAttemptLogged = false;
      }
    }

    // Track local playtest telemetry (bounded, zero PII)
    this.playtestTracker.recordVehicleTime(dt, nowDrivingVehicle);
    const activeWepState = this.weapons.getActiveState();
    this.playtestTracker.observeActiveWeaponAmmo(activeWepState.ammoInMag, activeWepState.reserveAmmo);

    // Stage 6 Encounter Director: mission pacing, live set pieces, searchlights, foundry hazards & adaptive score
    const anyEnemyHasLosPre =
      this.enemies.hasAnyEnemyWithLos() ||
      this.airCombat.hasAnyUnitWithLos() ||
      this.vehicles.hasAnyHostileWithLos();
    const isFinalObjectivePre =
      this.missionDirector.getActiveObjectiveIndex() >=
      Math.max(1, this.activeMission.objectives.length - 1);
    const hasBossActivePre =
      this.airCombat.getActiveBossInfo({
        playerPosition: this.player.position,
        isPrimaryObjective: isFinalObjectivePre,
        lockStatus: this.weapons.getLockOnState().status,
      }) !== null;

    const encounterOut = this.encounterDirector.update({
      dt,
      elapsedSec: this.missionDirector.elapsedSec,
      missionId: this.activeMission.id,
      activeStageIndex: this.missionDirector.getActiveStageIndex(),
      totalStages: this.missionDirector.getTotalStages(),
      extractionAvailable: this.missionDirector.getExtractionStatus() === 'available',
      aliveEnemies: this.enemies.getActiveCount(),
      anyEnemyHasLos: anyEnemyHasLosPre,
      hasActiveBoss: hasBossActivePre,
      playerPos: this.player.position,
      playerAlive: this.player.alive,
      playerInVehicle: nowDrivingVehicle,
      friendlySuppressorActive: this.friendlySuppressorActiveThisTick,
    });

    if (encounterOut.alertText) {
      this.missionDirector.showAlert(encounterOut.alertText, 3.0);
    }
    if (encounterOut.subtitleText) {
      this.missionDirector.showSubtitle(encounterOut.subtitleText, 3.8);
    }
    if (encounterOut.searchlightDetectedPlayer) {
      this.enemies.alertSquadsNearPosition(
        this.player.position,
        42,
        this.telemetry.getElapsedSec()
      );
    }
    if (encounterOut.environmentalHazardDamage > 0 && this.player.alive) {
      this.player.applyDamage(
        encounterOut.environmentalHazardDamage,
        this.player.position.x,
        this.player.position.z
      );
      if (encounterOut.environmentalHazardLabel) {
        this.missionDirector.showAlert(encounterOut.environmentalHazardLabel, 1.8);
      }
    }
    if (encounterOut.reinforcementSpec && this.activeScope) {
      const sp = encounterOut.reinforcementSpec;
      this.enemies.spawnWave(
        sp.archetype,
        sp.count,
        sp.spawnPos,
        sp.radius,
        this.collisionWorld,
        this.activeScope
      );
    }
    this.audio.applyAdaptiveMusicMood(encounterOut.recommendedMood);

    // Adaptive Solo Encounter Director evaluation (never nerfs enemy HP or weapon damage)
    if (this.activeDeploymentMode === 'solo') {
      const activeWepSolo = this.weapons.getActiveState();
      const maxReserveRef = Math.max(1, activeWepSolo.magSize * 4);
      const soloTick = this.soloDirector.update({
        dt,
        elapsedSec: this.missionDirector.elapsedSec,
        playerHealthRatio: this.player.health / Math.max(1, this.player.maxHealth),
        playerArmorRatio: this.player.armor / Math.max(1, this.player.maxArmor),
        reserveAmmoRatio: Math.min(1, activeWepSolo.reserveAmmo / maxReserveRef),
        rolling2sDamage: this.telemetry.getRollingDamage(2.0),
        aliveEnemies: this.enemies.getActiveCount(),
        activeAttackers: this.coordinator.getActiveDirectCount(),
      });
      this.coordinator.setSoloConstraints(soloTick.constraints);
      if (soloTick.calloutText) {
        this.missionDirector.showSubtitle(soloTick.calloutText, 3.6);
      }
    }

    // Dynamic anti-stall & mission-tailored reinforcement progression
    this.reinforcementTimer -= dt;
    const aliveEnemies = this.enemies.getActiveCount();
    const waveProg = this.missionDirector.evaluateWaveProgression(aliveEnemies);

    if (
      this.activeScope &&
      (waveProg.shouldSpawnReinforcements ||
        (this.reinforcementTimer <= 0 && aliveEnemies < 4))
    ) {
      const intervalScale =
        (this.activeCampaignConsequences?.reinforcementIntervalMult ?? 1.0) *
        this.soloDirector.getReinforcementIntervalMultiplier();
      this.reinforcementTimer = Math.round(24 * intervalScale);
      const countToSpawn = waveProg.shouldSpawnReinforcements ? waveProg.spawnCount : 3;
      const waveSpec = this.encounterDirector.selectReinforcementWave(
        this.activeMission.id,
        this.missionDirector.getActiveStageIndex(),
        countToSpawn
      );
      this.enemies.spawnWave(
        waveSpec.archetype,
        waveSpec.count,
        waveSpec.spawnPos,
        waveSpec.radius,
        this.collisionWorld,
        this.activeScope
      );
      this.missionDirector.showSubtitle(
        waveProg.shouldSpawnReinforcements
          ? `COMMAND: ${waveSpec.radioCallout}`
          : `INTEL: ${waveSpec.radioCallout}`,
        3.8
      );
    }

    this.telemetry.setPlayerWeaponTelemetry(
      this.weapons.shotsFired,
      this.weapons.shotsHit,
      this.weapons.enemyZoneHits
    );
    this.telemetry.setObjectiveCompletionTelemetry(
      this.missionDirector.getObjectiveCompletionTimestamps()
    );

    if (!this.player.alive) {
      const canUseSoloTraumaRevive =
        this.activeDeploymentMode === 'solo' && this.soloDirector.canUseTraumaSelfRecovery();
      const downedWindowSec = canUseSoloTraumaRevive ? 4.8 : 2.4;

      if (!this.downedActive) {
        this.downedActive = true;
        this.downedTimerSec = downedWindowSec;
        this.input.clearAllInputs();
        this.releasePointerLockForDebug();
        this.telemetry.recordPlayerDeath();
        const fatal = this.telemetry.getFatalDamageAttribution();
        this.playtestTracker.recordDeathLocation({
          elapsedSec: this.missionDirector.elapsedSec,
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z,
          attackerArchetype: fatal?.attackerArchetype ?? 'hazard',
          weaponLabel: fatal?.weaponLabel ?? 'Environment',
        });
      } else {
        this.downedTimerSec = Math.max(0, this.downedTimerSec - dt);
      }

      // Gently lower and tilt camera during the downed / kill-cam phase
      const downedProgress = Math.min(1, 1 - this.downedTimerSec / downedWindowSec);
      this.renderer.camera.position.y = Math.max(
        this.player.position.y + 0.35,
        this.renderer.camera.position.y - downedProgress * 0.85
      );
      this.renderer.camera.rotation.z = downedProgress * 0.22;

      gameSessionStore.getState().setDownedState({
        active: true,
        remainingSec: Number(this.downedTimerSec.toFixed(1)),
        fatalSource: this.telemetry.getFatalDamageAttribution(),
        lastHits: this.telemetry.getLastFiveDamageEvents(),
        canRestartCheckpoint:
          !this.activeModifierEffects.disableCheckpoints &&
          this.activeCheckpointSnapshot !== null,
        canUseSoloTraumaRevive,
      });

      if (this.downedTimerSec <= 0) {
        gameSessionStore.getState().setDownedState(null);
        this.completeMission(false);
        return;
      }
    } else {
      const missionTick = this.missionDirector.update(dt, this.player.health, this.player.armor);
      // Automatic subtle music ducking whenever fresh tactical radio dialogue or mission announcements appear
      if (this.missionDirector.subtitleText && this.missionDirector.subtitleText !== this.lastDuckedSubtitle) {
        this.lastDuckedSubtitle = this.missionDirector.subtitleText;
        this.audio.duckMusicForDialogue(3.0, 0.34);
      } else if (!this.missionDirector.subtitleText) {
        this.lastDuckedSubtitle = null;
      }
      if (this.missionDirector.alertText && this.missionDirector.alertText !== this.lastDuckedAlert) {
        this.lastDuckedAlert = this.missionDirector.alertText;
        this.audio.duckMusicForDialogue(2.0, 0.42);
      } else if (!this.missionDirector.alertText) {
        this.lastDuckedAlert = null;
      }
      if (missionTick.finished) {
        this.completeMission(missionTick.victory);
        return;
      }
    }

    this.hudPublisher.tickDamageArcDecay(dt);

    // Update climax encounter state (boss aircraft active or final objective stage)
    const isFinalObjective =
      this.missionDirector.getActiveObjectiveIndex() >=
      Math.max(1, this.activeMission.objectives.length - 1);
    const hasBossActive =
      this.airCombat.getActiveBossInfo({
        playerPosition: this.player.position,
        isPrimaryObjective: isFinalObjective,
        lockStatus: this.weapons.getLockOnState().status,
      }) !== null;
    this.coordinator.setEncounterClimaxActive(isFinalObjective || hasBossActive);

    // Tick Combat Engagement Coordinator leases and exposure telemetry (zero allocation)
    this.coordinator.tick(this.telemetry.getElapsedSec());
    const anyEnemyHasLos =
      this.enemies.hasAnyEnemyWithLos() ||
      this.airCombat.hasAnyUnitWithLos() ||
      this.vehicles.hasAnyHostileWithLos();
    this.telemetry.tickExposure(dt, anyEnemyHasLos);

    const devActive = isDeveloperModeActiveForSetting(settings.developer.devModeEnabled);
    const debugOpen = devActive && uiStore.getState().combatDebugOpen;
    if (devActive) {
      this.debugPublishAccum += dt;
      const publishPeriod = debugOpen ? 0.1 : 0.45;
      if (this.debugPublishAccum >= publishPeriod) {
        this.debugPublishAccum = 0;
        const groundRows = this.enemies.getDebugInspectorRows(this.player);
        const airRows = this.airCombat.getDebugInspectorRows(this.player);
        const vehRows = this.vehicles.getDebugInspectorRows(this.player);
        const allDebugUnits = [...groundRows, ...airRows, ...vehRows];
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

  private onSpawnDynamicDrone = (x: number, y: number, z: number): void => {
    if (this.activeScope) {
      this.airCombat.spawnDynamicDrone(x, y, z, this.activeScope);
    }
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
      this.onSpawnDynamicDrone
    );
    this.airCombat.update(dt, this.player, this.collisionWorld);

    // Stage 7 TRN-37: Coordinated Friendly Fireteam Update & Player Rescue Step
    // Solo Operator invariant: zero friendly squad ticks, zero squad nav solves
    if (this.activeDeploymentMode === 'solo') {
      this.latestSquadHudSummary = undefined;
      this.friendlySuppressorActiveThisTick = false;
      if (this.missionDirector) {
        this.playtestTracker.recordEncounterStageTime(
          this.missionDirector.getActiveStageIndex(),
          dt
        );
      }
      return;
    }

    this.renderer.camera.getWorldDirection(this._squadForwardScratch);
    const enemyUnits = this.enemies.getUnits();
    this._squadEnemyViewsScratch.length = 0;
    for (let i = 0; i < enemyUnits.length; i++) {
      const eu = enemyUnits[i];
      this._squadEnemyViewsScratch.push({
        id: eu.id,
        alive: eu.alive,
        position: eu.position,
        isArmoredOrVehicle: eu.archetype === 'heavy_armor' || eu.archetype === 'rocket_trooper',
        isElevated: eu.position.y - this.player.position.y > 2.2,
      });
    }
    const seatViews = this.vehicles.getFriendlySeatViews();
    this.friendlySquad.stepPlayerRescue(
      dt,
      this.player.position,
      this.input.isActionHeld('interact')
    );
    const squadOut = this.friendlySquad.update({
      dt,
      playerPos: this.player.position,
      playerForward: this._squadForwardScratch,
      playerAlive: this.player.alive,
      collision: this.collisionWorld,
      enemies: this._squadEnemyViewsScratch,
      vehicles: seatViews,
      intentValidationCtx: this.buildSquadIntentValidationCtx(),
    });
    this.latestSquadHudSummary = squadOut.hudSummary;
    this.friendlySuppressorActiveThisTick = squadOut.friendlySuppressorActive;
    const elapsedNow = this.telemetry.getElapsedSec();

    // Stage 8 TRN-48: Track squad responsiveness, formations, casualties & encounter stage pacing
    this.playtestTracker.recordFormationTime(squadOut.hudSummary.activeFormation, dt);
    if (this.missionDirector) {
      const stageIdx = this.missionDirector.getActiveStageIndex();
      this.playtestTracker.recordEncounterStageTime(stageIdx, dt);
      if (stageIdx > this.lastDialogueStageIndex) {
        this.lastDialogueStageIndex = stageIdx;
        const aliveOp = this.friendlySquad.getOperators().find((o) => o.alive);
        if (aliveOp) {
          this.emitSquadDialogue({
            event: 'stage_advance',
            nowSec: elapsedNow,
            operatorId: aliveOp.id,
            callsign: aliveOp.record.callsign,
            role: aliveOp.role,
          });
        }
      }
      if (
        !this.extractionLiveAnnounced &&
        this.missionDirector.getExtractionStatus() === 'available'
      ) {
        this.extractionLiveAnnounced = true;
        const aliveOp = this.friendlySquad.getOperators().find((o) => o.alive);
        this.emitSquadDialogue({
          event: 'extraction_live',
          nowSec: elapsedNow,
          operatorId: aliveOp?.id ?? 'overwatch_hq',
          callsign: aliveOp?.record.callsign ?? 'OVERWATCH HQ',
          role: aliveOp?.role ?? 'recon',
        });
      }
    }

    const activeWepForCue = this.weapons.getActiveState();
    if (
      activeWepForCue.reserveAmmo > 0 &&
      activeWepForCue.reserveAmmo <= activeWepForCue.magSize &&
      activeWepForCue.ammoInMag <= Math.ceil(activeWepForCue.magSize * 0.25)
    ) {
      const supportOp =
        this.friendlySquad.getOperators().find((o) => o.alive && o.role === 'support') ??
        this.friendlySquad.getOperators().find((o) => o.alive);
      if (supportOp) {
        this.emitSquadDialogue({
          event: 'low_ammo_warn',
          nowSec: elapsedNow,
          operatorId: supportOp.id,
          callsign: supportOp.record.callsign,
          role: supportOp.role,
        });
      }
    }

    const sqTel = squadOut.telemetryEvents;
    for (let i = 0; i < sqTel.commandLatencySamplesMs.length; i++) {
      this.playtestTracker.recordSquadCommandLatency(sqTel.commandLatencySamplesMs[i]);
    }
    if (sqTel.downedEventsThisTick.length > 0) {
      this.playtestTracker.recordSquadDowned(sqTel.downedEventsThisTick.length);
      this.audio.play2D('operator_downed_alarm', 8, 0.65, 0.01);
      const firstDown = sqTel.downedEventsThisTick[0];
      this.emitSquadDialogue({
        event: 'operator_downed',
        nowSec: elapsedNow,
        operatorId: firstDown.operatorId,
        callsign: firstDown.callsign,
        role: firstDown.role,
      });
    }
    if (sqTel.miaEventsThisTick.length > 0) {
      this.playtestTracker.recordSquadMia(sqTel.miaEventsThisTick.length);
    }
    for (let i = 0; i < sqTel.medicRevivesThisTick; i++) {
      this.playtestTracker.recordOperatorRescue(true);
    }
    for (let i = 0; i < sqTel.playerRevivesThisTick; i++) {
      this.playtestTracker.recordOperatorRescue(false);
    }
    if (sqTel.revivedEventsThisTick.length > 0) {
      const rev = sqTel.revivedEventsThisTick[0];
      this.emitSquadDialogue({
        event: rev.byMedic ? 'medic_revive' : 'player_revive',
        nowSec: elapsedNow,
        operatorId: rev.operatorId,
        callsign: rev.byMedic ? rev.rescuerCallsign : rev.callsign,
        role: rev.byMedic ? 'medic' : rev.role,
      });
    }

    if (squadOut.radioCallout) {
      this.missionDirector?.showSubtitle(`FIRETEAM: ${squadOut.radioCallout}`, 3.0);
    }
    for (let i = 0; i < squadOut.fireRequests.length; i++) {
      const req = squadOut.fireRequests[i];
      const targetEnemy = enemyUnits.find((eu) => eu.id === req.enemyId && eu.alive);
      if (targetEnemy) {
        const killed = this.enemies.damageUnit(targetEnemy, req.damage, false);
        if (killed) {
          const isHvt =
            targetEnemy.archetype === 'heavy_armor' ||
            targetEnemy.archetype === 'sniper' ||
            targetEnemy.archetype === 'elite_assault';
          this.friendlySquad.recordOperatorKill(
            req.operatorId,
            targetEnemy.archetype === 'heavy_armor'
          );
          if (isHvt) {
            const killerOp = this.friendlySquad.getOperators().find((o) => o.id === req.operatorId);
            if (killerOp) {
              this.emitSquadDialogue({
                event: 'high_value_kill',
                nowSec: elapsedNow,
                operatorId: killerOp.id,
                callsign: killerOp.record.callsign,
                role: killerOp.role,
              });
            }
          }
          this.encounterDirector.intelBoard.notifyUnitEliminated(targetEnemy.id);
        }
      }
    }

    this.monitor.recordPhase('ai', performance.now() - t0);
    hardwareReadinessHarness.recordFrameTimeMs(dt * 1000);
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

  private onRender = (dt = 1 / 60): void => {
    const t0 = performance.now();
    const isPlaying = uiStore.getState().screen === 'playing';
    const inVehicle = this.vehicles.getPlayerVehicle() !== null;
    if (isPlaying && !inVehicle && this.activeMission && this.player.alive && this.input.hasPendingLookDelta()) {
      const settings = settingsStore.getState();
      const weaponCfg = this.weapons.getActiveState().config;
      this.player.touchAimFrictionScale = this.computeTouchAimFrictionScale();
      this.player.applyLookInput(this.input, this.weapons.isAds);
      this.player.syncCamera(
        this.renderer.camera,
        settings.graphics.fov,
        weaponCfg.adsFov,
        this.weapons.isAds,
        dt
      );
    }
    if (this.activeMission && this.lights) {
      this.lights.updateShadowFocus(
        this.player.position.x,
        this.player.position.y,
        this.player.position.z,
        this.governor.getProfile().shadowDistance
      );
    }
    this.chunkManager.updateVisibility(this.renderer.camera, this.governor.getProfile().drawDistance);
    const showVm = isPlaying && !inVehicle;
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

  private computeTouchAimFrictionScale(): number {
    const inputSettings = settingsStore.getState().input;
    if (!inputSettings.mobileAimAssist) return 1.0;
    if (this.hudPublisher.resolveEffectiveDevice(this.input) !== 'touch') return 1.0;

    this.renderer.camera.getWorldDirection(this._aimAssistForward);
    const camPos = this.renderer.camera.position;
    const coneCosThreshold = Math.cos(0.115); // ~6.6 deg friction cone
    let bestProximity = 0;

    const units = this.enemies.getUnits();
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive || !u.hasLos) continue;
      const dx = u.position.x - camPos.x;
      const dy = u.position.y + 1.15 - camPos.y;
      const dz = u.position.z - camPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < 1.0 || distSq > 65 * 65) continue;
      const invDist = 1 / Math.sqrt(distSq);
      const dot =
        (dx * this._aimAssistForward.x +
          dy * this._aimAssistForward.y +
          dz * this._aimAssistForward.z) *
        invDist;
      if (dot >= coneCosThreshold) {
        const prox = (dot - coneCosThreshold) / (1 - coneCosThreshold);
        if (prox > bestProximity) bestProximity = prox;
      }
    }

    if (bestProximity <= 0) return 1.0;
    const strength = Math.max(0.1, Math.min(0.75, inputSettings.mobileAimAssistStrength ?? 0.35));
    return Math.max(0.55, Math.min(1.0, 1 - strength * 0.65 * bestProximity));
  }

  private publishHudSnapshot = (): void => {
    const sustainmentPrompt = this.activeMission
      ? this.sustainment.getPromptForContext(this.buildSustainmentContext())
      : null;
    const activeRadio = this.squadDialogue.getActiveTransmission(this.telemetry.getElapsedSec());
    this.hudPublisher.publish({
      player: this.player,
      weapons: this.weapons,
      enemies: this.enemies,
      vehicles: this.vehicles,
      airCombat: this.airCombat,
      explosives: this.explosives,
      destruction: this.destruction,
      input: this.input,
      missionDirector: this.missionDirector,
      activeMission: this.activeMission,
      worldData: this.worldData,
      cargoLiftManager: this.cargoLiftManager,
      sustainmentPrompt,
      encounterPhase: this.encounterDirector.getPhase(),
      optionalObjectivesCompleted: this.encounterDirector.getOptionalObjectivesCompletedCount(),
      activeModifiers: this.activeModifiers,
      camera: this.renderer.camera,
      squadSummary: this.activeDeploymentMode === 'solo' ? undefined : this.latestSquadHudSummary,
      carriedWeaponIds: [...this.weapons.getCarriedMissionSlots()],
      nearSupplySwapStation: this.isPlayerNearSupplySwapStation(),
      deploymentMode: this.activeDeploymentMode,
      soloTraumaKit:
        this.activeDeploymentMode === 'solo'
          ? this.soloDirector.getTraumaKitStatus()
          : undefined,
      activeRadioSubtitle: activeRadio
        ? {
            id: activeRadio.id,
            callsign: activeRadio.callsign,
            roleBadge: SQUAD_ARCHETYPE_FLYWEIGHTS[activeRadio.role]?.shortBadge ?? 'CMD',
            text: activeRadio.text,
            priority: activeRadio.priority,
          }
        : null,
    });
  };

  private completeMission(victory: boolean): void {
    if (!this.activeMission || !this.missionDirector) return;
    this.downedActive = false;
    this.downedTimerSec = 0;
    gameSessionStore.getState().setDownedState(null);
    this.input.exitPointerLock();
    this.input.clearAllInputs();
    this.loop.setPaused(true);

    const checkpointDeaths = this.attemptContext?.checkpointDeathsCount ?? 0;
    const totalDeaths = checkpointDeaths + (victory ? 0 : 1);
    const summary = this.missionDirector.buildSummary(victory, {
      shotsFired: this.weapons.shotsFired,
      shotsHit: this.weapons.shotsHit,
      deathsCount: totalDeaths,
      damageReceived: this.telemetry.getTotalDamageReceived(),
      survivalTimeSec: this.telemetry.getElapsedSec(),
    });
    const difficulty = missionSelectionStore.getState().difficulty;
    const replayMode = missionSelectionStore.getState().replayMode;
    const optionalCompleted = this.encounterDirector.getOptionalObjectivesCompletedCount();
    const squadReports =
      this.activeDeploymentMode === 'solo' ? [] : this.friendlySquad.buildMissionReports();
    const campaignEventDrafts = buildMissionCampaignEventDrafts({
      missionId: this.activeMission.id,
      victory: summary.victory,
      optionalObjectivesCompleted: optionalCompleted,
      completedOptionalIds: this.encounterDirector.getCompletedOptionalObjectiveIds(),
      allSearchlightsDisabled: this.encounterDirector.areAllSearchlightsDisabled(),
      squadReports,
    });
    const resultPayload: MissionResultPayload = {
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
      accuracyPct: summary.accuracyPct,
      deathsCount: totalDeaths,
      optionalObjectivesCompleted: optionalCompleted,
      killsByWeapon: { ...this.weaponKillsMap },
      activeModifiers: [...this.activeModifiers],
      replayMode,
      deploymentMode: this.activeDeploymentMode,
      operationRunId: this.activeOperationRunId,
      campaignEventDrafts,
      squadReports,
    };

    let newAchievements: string[] = [];
    let newChallenges: string[] = [];
    let challengeXpBonus = 0;
    let challengeReqBonus = 0;
    let modifierReqBonus = 0;
    let masteryTierUps: Array<{ weaponId: string; tier: string }> = [];
    let committedCampaignEvents = 0;
    let stagedRebaseDiff: CampaignRebaseDiff | null = null;
    let pendingRebaseDrafts: typeof campaignEventDrafts = [];
    let recoveredOperatorCallsigns: string[] = [];
    let hqRecoveryProgressedCount = 0;

    if (victory) {
      this.pendingDefeatPayload = null;
      const outcome = progressionStore.getState().recordMissionResult(resultPayload);
      newAchievements = outcome.newAchievements;
      newChallenges = outcome.newChallenges;
      challengeXpBonus = outcome.challengeXpBonus;
      challengeReqBonus = outcome.challengeReqBonus;
      modifierReqBonus = outcome.modifierReqBonus;
      masteryTierUps = outcome.masteryTierUps;
      committedCampaignEvents = outcome.committedCampaignEvents;
      stagedRebaseDiff = outcome.stagedRebaseDiff;
      pendingRebaseDrafts = outcome.pendingRebaseDrafts;
      recoveredOperatorCallsigns = outcome.recoveredOperatorCallsigns;
      hqRecoveryProgressedCount = outcome.hqRecoveryProgressedCount;
      this.audio.applyAdaptiveMusicMood('tactical_atmosphere', true);
    } else {
      // Defer defeat progression write until the player permanently aborts/replays instead of checkpoint-restarting
      this.pendingDefeatPayload = resultPayload;
    }

    const telemetryMetrics = this.telemetry.buildSnapshot(
      this.coordinator.getSnapshot(),
      [],
      0
    ).metrics;
    const playtestReport = this.playtestTracker.buildReport({
      missionId: this.activeMission.id,
      difficulty,
      activeModifiers: this.activeModifiers,
      outcome: victory ? 'victory' : 'defeat',
      grade: victory ? (summary.grade as MissionGrade) : 'F',
      durationSec: summary.durationSec,
      timeFirstDetectionSec: telemetryMetrics.timeFirstDetectionSec ?? null,
      timeFirstDamageSec: telemetryMetrics.timeFirstDamageSec ?? null,
      timeFirstKillSec: telemetryMetrics.timeFirstKillSec ?? null,
      kills: summary.kills,
      headshots: summary.headshots,
      playerAccuracyPct: summary.accuracyPct,
      deathsCount: totalDeaths,
      resupplyStationsUsed: telemetryMetrics.supplyCratesUsed ?? 0,
      healthPickupsCollected: telemetryMetrics.healthPickupsCollected ?? 0,
      optionalObjectivesCompleted: optionalCompleted,
      objectiveCompletedAtSec: telemetryMetrics.objectiveCompletedAtSec ?? {},
      killsByWeapon: { ...this.weaponKillsMap },
      damageByDomain: telemetryMetrics.damageByDomain,
    });
    const frictionFindings = diagnosePlaytestFriction(playtestReport);
    hardwareReadinessHarness.setLatestPlaytestReport(playtestReport, frictionFindings);

    gameSessionStore.getState().setDebrief({
      missionId: this.activeMission.id,
      difficulty,
      ...summary,
      optionalObjectivesCompleted: optionalCompleted,
      activeModifiers: [...this.activeModifiers],
      fatalSource: this.telemetry.getFatalDamageAttribution(),
      lastHits: this.telemetry.getLastFiveDamageEvents(),
      newAchievements,
      newChallenges,
      challengeXpBonus,
      challengeReqBonus,
      modifierReqBonus,
      masteryTierUps,
      canRestartCheckpoint:
        !victory &&
        !this.activeModifierEffects.disableCheckpoints &&
        this.activeCheckpointSnapshot !== null,
      checkpointDeathsCount: checkpointDeaths,
      playtestReport,
      replayMode,
      deploymentMode: this.activeDeploymentMode,
      committedCampaignEvents,
      stagedRebaseDiff,
      pendingRebaseDrafts,
      squadReports,
      recoveredOperatorCallsigns,
      hqRecoveryProgressedCount,
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
    this.friendlySquad.dispose(this.renderer.scene);
    this.debugRenderer.setVisible(false);
    this.weapons.dispose();
    this.explosives.dispose();
    this.vehicles.dispose();
    this.cargoLiftManager.dispose();
    this.destruction.dispose();
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
    this.audio.dispose();
    this.assetManager.dispose();
    this.renderer.dispose();
    this.resourceManager.disposeAll();
  }
}
