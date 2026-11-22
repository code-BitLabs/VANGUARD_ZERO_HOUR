import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG } from '@/src/data/missions';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { InputManager } from '@/src/engine/InputManager';
import { PerformanceGovernor } from '@/src/engine/PerformanceGovernor';
import {
  TACTICAL_LIGHT_BUDGETS,
  TacticalLightBudgetManager,
  evaluateRenderingVerticalSlice,
} from '@/src/engine/RenderingBenchmarkSlice';
import { VFXPool } from '@/src/effects/VFXPool';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import {
  FirstPersonAnimationGraph,
  PER_WEAPON_OPTIC_CONFIGS,
} from '@/src/gameplay/FirstPersonAnimationGraph';
import { buildOperatorArmRig, solveTwoBoneArmIK } from '@/src/gameplay/OperatorArmRig';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import {
  buildWeaponViewModel,
  createViewModelMaterialBank,
  disposeViewModelMaterialBank,
} from '@/src/gameplay/WeaponViewModels';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { EnemyArchetypeSchema } from '@/src/schemas/enemy.schema';
import { MiniMapBlip } from '@/src/schemas/events.schema';
import { VehicleTypeSchema } from '@/src/schemas/mission.schema';
import {
  ControlBindingsSchema,
  GraphicsSettingsSchema,
  InputSettingsSchema,
  SettingsBundleSchema,
} from '@/src/schemas/settings.schema';
import { WeaponIdSchema } from '@/src/schemas/weapon.schema';
import { uiStore } from '@/src/stores/uiStore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { setupLightingRig } from '@/src/world/LightingRig';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { globalStructureReconciliation } from '@/src/world/StructureReconciliationRegistry';
import {
  MISSION_VISUAL_PROFILES,
  VANGUARD_ARCHITECTURAL_STANDARDS,
  getMissionVisualProfile,
} from '@/src/world/VisualBible';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';
import { buildSoldierRig } from '@/src/world/rigs/EnemyRigBuilder';
import { buildVehicleRig } from '@/src/world/rigs/VehicleRigBuilder';

describe('Stage 5B — Visual Bible, Geometry Reconciliation & 5 Mission World Transformations (TRN-18)', () => {
  it('defines distinct visual profiles for all 5 missions and preserves +9.0m watchtower standard', () => {
    expect(VANGUARD_ARCHITECTURAL_STANDARDS.watchtowerDeckElevationM).toBe(9.0);
    expect(VANGUARD_ARCHITECTURAL_STANDARDS.watchtowerMidLandingElevationM).toBe(4.5);

    const opCodes = new Set<string>();
    for (let id = 1; id <= 5; id++) {
      const profile = getMissionVisualProfile(id);
      expect(profile.missionId).toBe(id);
      expect(profile.terrainSplatLayers.baseLayer).toBeTruthy();
      expect(profile.terrainSplatLayers.baseLayerColor).toBeGreaterThan(0);
      expect(profile.macroLandmarks.length).toBeGreaterThanOrEqual(2);
      expect(profile.standardizedCameras.length).toBeGreaterThanOrEqual(2);
      opCodes.add(profile.operationCode);
    }
    expect(opCodes.size).toBe(5);
    expect(Object.keys(MISSION_VISUAL_PROFILES)).toHaveLength(5);
  });

  it('reconciles Stage 5A collision/navigation geometry with Stage 5B visual landmarks across all 5 missions', () => {
    const rm = new ResourceManager();
    const assets = new AssetManager(rm);
    const chunks = new WorldChunkManager();

    for (const mission of MISSION_CATALOG) {
      const scene = new THREE.Scene();
      const cw = new CollisionWorld();
      const vfx = new VFXPool(scene, rm);
      const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
      const destruction = new DestructionSystem(cw.physicsWorld, vfx, audio);

      const built = buildWorldMap(
        mission.mapId,
        mission.id,
        scene,
        assets,
        rm,
        cw,
        chunks,
        destruction
      );

      const report = globalStructureReconciliation.verifyMissionReconciliation(
        mission.id,
        built.elevatedSurfaces,
        built.navPortals,
        built.cargoLifts,
        cw
      );

      expect(report.valid).toBe(true);
      expect(report.discrepancies).toHaveLength(0);
      expect(report.totalStructures).toBeGreaterThan(0);

      // Verify terrain vertex color splatting attribute exists
      let foundColoredTerrain = false;
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (
          mesh.isMesh &&
          mesh.geometry.getAttribute('color') &&
          mesh.geometry.attributes.position.count > 1000
        ) {
          foundColoredTerrain = true;
        }
      });
      expect(foundColoredTerrain).toBe(true);
    }

    rm.disposeAll();
  });
});

describe('Stage 5B — 3-Way Rendering Evaluation, Sky Dome, Light Pool & Multi-Refresh Governor (TRN-20)', () => {
  it('evaluates all 3 rendering candidates and produces a structured vertical-slice benchmark report', () => {
    const report = evaluateRenderingVerticalSlice('auto', 7.5);
    expect(Object.keys(report.evaluatedBackends)).toEqual([
      'webgl_renderer_baseline',
      'webgpu_renderer_native',
      'webgpu_renderer_webgl2_fallback',
    ]);
    expect(report.selectedBackend).toBe('webgl_renderer_baseline');
    expect(report.activeRuntimeBackend).toBe('webgl2');
    expect(report.evaluatedBackends.webgl_renderer_baseline.supportsEffectComposerPostProcessing).toBe(true);
  });

  it('enforces per-tier active point-light budgets and recycling in TacticalLightBudgetManager', () => {
    const scene = new THREE.Scene();
    const mgr = new TacticalLightBudgetManager(scene, 'low');
    expect(mgr.getBudget().maxActivePointLights).toBe(TACTICAL_LIGHT_BUDGETS.low.maxActivePointLights);

    mgr.requestTransientLight({
      category: 'explosion',
      x: 0,
      y: 2,
      z: -5,
      colorHex: 0xffaa00,
      intensity: 3.5,
      distance: 15,
      durationSec: 0.4,
    });
    mgr.requestTransientLight({
      category: 'muzzle',
      x: 0,
      y: 1.6,
      z: -2,
      colorHex: 0xffe066,
      intensity: 2.5,
      distance: 10,
      durationSec: 0.08,
    });
    const thirdGranted = mgr.requestTransientLight({
      category: 'beacon',
      x: 4,
      y: 2,
      z: -10,
      colorHex: 0xff0000,
      intensity: 4,
      distance: 20,
      durationSec: 0.5,
    });

    expect(thirdGranted).toBe(false);
    expect(mgr.getActiveLightCount()).toBeLessThanOrEqual(
      TACTICAL_LIGHT_BUDGETS.low.maxActivePointLights
    );
    expect(mgr.getSaturatedFallbackCount()).toBe(1);

    mgr.update(0.2); // muzzle flash expires after 0.08s
    expect(mgr.getActiveLightCount()).toBe(1);

    mgr.dispose();
  });

  it('creates an atmospheric GLSL skyDome and synchronizes mission visual profiles in setupLightingRig', () => {
    const rm = new ResourceManager();
    for (let missionId = 1; missionId <= 5; missionId++) {
      const scene = new THREE.Scene();
      const rig = setupLightingRig(scene, 'daylight', 1024, 90, rm, missionId);
      expect(rig.skyDome).toBeInstanceOf(THREE.Mesh);
      expect(rig.skyDome.material).toBeInstanceOf(THREE.ShaderMaterial);
      const profile = getMissionVisualProfile(missionId);
      expect(rig.sun.intensity).toBeCloseTo(profile.sunLightIntensity, 2);
      rig.dispose();
    }
    rm.disposeAll();
  });

  it('scales PerformanceGovernor frame-time budgets across 60Hz, 90Hz, and 120Hz displays', () => {
    const gov = new PerformanceGovernor('high', true);

    gov.setTargetRefreshRate(120);
    expect(gov.getTargetRefreshRate()).toBe(120);

    // At 120Hz (budget = 8.33ms, degrade > 9.5ms), sustained 13ms frames should step down from high -> medium
    let steppedDown = false;
    for (let i = 0; i < 200; i++) {
      if (gov.recordSample(13.0, 9.5, 0.02)) {
        steppedDown = true;
      }
    }
    expect(steppedDown).toBe(true);
    expect(gov.getTier()).toBe('medium');

    gov.setTargetRefreshRate(90);
    expect(gov.getTargetRefreshRate()).toBe(90);

    gov.setTargetRefreshRate(60);
    expect(gov.getTargetRefreshRate()).toBe(60);
  });
});

describe('Stage 5B — Operator Arm IK Rig, Interruptible Animation Graph, Weapons, Enemies & Vehicles (TRN-19)', () => {
  it('solves 2-bone analytical arm IK without NaN across normal, zero-distance, and over-extended reach', () => {
    const armRig = buildOperatorArmRig();

    for (const target of [
      new THREE.Vector3(0.0, -0.09, -0.22),
      armRig.leftArm.shoulderRoot.position.clone(), // zero distance
      new THREE.Vector3(0.5, 0.4, -3.5), // extreme over-extension
    ]) {
      solveTwoBoneArmIK(armRig.leftArm, target);
      expect(Number.isNaN(armRig.leftArm.shoulderRoot.rotation.x)).toBe(false);
      expect(Number.isNaN(armRig.leftArm.shoulderRoot.rotation.y)).toBe(false);
      expect(Number.isNaN(armRig.leftArm.elbowJoint.rotation.x)).toBe(false);
      expect(Number.isNaN(armRig.leftArm.wristJoint.rotation.x)).toBe(false);
    }

    armRig.dispose();
  });

  it('builds articulated operator arm rig and all 9 weapon viewmodels with named sockets and slideRestZ invariant', () => {
    const armRig = buildOperatorArmRig();
    expect(Object.keys(armRig.leftArm.fingers)).toHaveLength(5);
    expect(Object.keys(armRig.rightArm.fingers)).toHaveLength(5);
    armRig.dispose();

    const bank = createViewModelMaterialBank();
    for (const weaponId of WeaponIdSchema.options) {
      const rig = buildWeaponViewModel(weaponId, bank);
      expect(rig.muzzleSocket).toBeInstanceOf(THREE.Object3D);
      expect(rig.opticSightSocket).toBeInstanceOf(THREE.Object3D);
      expect(rig.rightHandGripSocket).toBeInstanceOf(THREE.Object3D);
      expect(rig.leftHandForegripSocket).toBeInstanceOf(THREE.Object3D);
      expect(rig.magazineSocket).toBeInstanceOf(THREE.Object3D);
      expect(rig.chargingHandleSocket).toBeInstanceOf(THREE.Object3D);
      expect(rig.operatorArms).toBeDefined();
      expect(PER_WEAPON_OPTIC_CONFIGS[weaponId]).toBeDefined();

      if (weaponId === 'assault_rifle') {
        expect(rig.slideRestZ).toBeCloseTo(-0.14, 5);
      }
      rig.operatorArms.dispose();
    }
    disposeViewModelMaterialBank(bank);
  });

  it('executes deterministic interruption transitions in FirstPersonAnimationGraph without stuck states', () => {
    const graph = new FirstPersonAnimationGraph();

    const r1 = graph.handleInterruption('ads_interrupts_sprint');
    expect(graph.getCurrentState()).toBe('ADS');
    expect(r1.handsReturnedToGripSockets).toBe(true);

    const r2 = graph.handleInterruption('weapon_switch_cancels_reload', 'MAG_OUT');
    expect(graph.getCurrentState()).toBe('WEAPON_SWITCH');
    expect(r2.magazineReturnedToRest).toBe(true);
    expect(r2.boltReturnedToBattery).toBe(true);

    const out = graph.evaluate({
      dt: 0.016,
      weaponId: 'sniper_rifle',
      alive: true,
      inVehicle: false,
      grounded: true,
      currentSpeed: 3.5,
      isSprinting: false,
      isCrouching: false,
      isSliding: false,
      isVaulting: false,
      isAds: true,
      isReloading: false,
      reloadStage: 'READY',
      reloadProgress: 0,
      equipProgress01: 0,
      landingSpringOffset: 0,
      rightGripLocal: new THREE.Vector3(0.0, -0.07, 0.06),
      leftForegripLocal: new THREE.Vector3(0.0, -0.03, -0.34),
      magazineSocketLocal: new THREE.Vector3(0.0, -0.1, -0.11),
      chargingHandleSocketLocal: new THREE.Vector3(0.03, 0.05, -0.08),
    });

    expect(out.activeState).toBe('ADS');
    expect(Number.isNaN(out.leftHandTargetLocal.x)).toBe(false);
    expect(out.opticSightConfig.adsWorldFovDeg).toBe(18);
    expect(graph.getInterruptionHistory().length).toBeGreaterThanOrEqual(2);
  });

  it('builds all 7 enemy archetypes with faction palettes and 4 tactical vehicle rigs', () => {
    const rm = new ResourceManager();

    for (const archetype of EnemyArchetypeSchema.options) {
      const rig = buildSoldierRig('#dc2626', archetype, 'mission:1', rm);
      expect(rig.root).toBeInstanceOf(THREE.Group);
      expect(rig.headMesh).toBeInstanceOf(THREE.Object3D);
      expect(rig.muzzleFlash).toBeInstanceOf(THREE.Mesh);
      expect(rig.torsoGroup).toBeInstanceOf(THREE.Group);
    }

    for (const kind of VehicleTypeSchema.options) {
      const vRig = buildVehicleRig(kind, kind.startsWith('enemy_'), 'mission:1', rm);
      expect(vRig.chassisGroup).toBeInstanceOf(THREE.Group);
      expect(vRig.turret).toBeInstanceOf(THREE.Object3D);
      expect(vRig.fpvHiddenMeshes.length).toBeGreaterThan(0);
    }

    rm.disposeAll();
  });
});

describe('Stage 5B — Context-Adaptive Tactical HUD, Radar Intelligence & Action-Binding Authority (TRN-21)', () => {
  it('excludes unspotted UNAWARE enemies from radar blips while surfacing LOS and stale contacts with elevation codes', () => {
    const scene = new THREE.Scene();
    const rm = new ResourceManager();
    const cw = new CollisionWorld();
    // Place an opaque wall between player at (0, 0, 0) and enemy at (0, 0, -32)
    cw.addStaticBox({
      id: 'radar_test_wall',
      minX: -12,
      minY: 0,
      minZ: -16,
      maxX: 12,
      maxY: 6,
      maxZ: -14,
      layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      tag: 'building_wall',
    });

    const vfx = new VFXPool(scene, rm);
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const projectiles = new ProjectileManager(scene, rm, vfx, audio);
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(vfx, telemetry);
    const mgr = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);

    mgr.spawnWave('infantry', 1, { x: 0, y: 0, z: -32 }, 0.2, cw, 'mission:1');
    mgr.spawnWave('sniper', 1, { x: 14, y: 9.0, z: -28 }, 0.2, cw, 'mission:1');

    const enemies = mgr.getUnits() as Array<(ReturnType<EnemyManager['getUnits']>[number])>;
    expect(enemies).toHaveLength(2);
    enemies[0].position.set(0, 0, -32);
    enemies[1].position.set(14, 9.0, -28);

    // 1. Both UNAWARE, occluded / outside close recon range (dist > 26m) -> 0 blips (no wallhack!)
    enemies[0].state = 'UNAWARE';
    enemies[0].hasLos = false;
    enemies[0].detectedPlayer = false;
    enemies[0].lastKnownPosition = null;
    enemies[0].losBlockerId = 'radar_test_wall';

    enemies[1].state = 'UNAWARE';
    enemies[1].hasLos = false;
    enemies[1].detectedPlayer = false;
    enemies[1].lastKnownPosition = null;
    enemies[1].losBlockerId = 'radar_test_wall';

    const blipsHidden: MiniMapBlip[] = [];
    mgr.fillMiniMapBlips(blipsHidden, new THREE.Vector3(0, 0, 0));
    expect(blipsHidden).toHaveLength(0);

    // 2. Sniper gains LOS at +9.0m elevation -> appears with detectionSource='los' and elevationCode='above'
    enemies[1].state = 'ENGAGING';
    enemies[1].hasLos = true;
    enemies[1].detectedPlayer = true;

    // Rifleman loses LOS after being spotted -> appears with detectionSource='stale'
    enemies[0].state = 'UNAWARE';
    enemies[0].hasLos = false;
    enemies[0].detectedPlayer = false;
    enemies[0].lastKnownPosition = new THREE.Vector3(0, 0, 0);
    enemies[0].losLostDurationSec = 3.0;

    const blipsDetected: MiniMapBlip[] = [];
    mgr.fillMiniMapBlips(blipsDetected, new THREE.Vector3(0, 0, 0));
    expect(blipsDetected).toHaveLength(2);

    const sniperBlip = blipsDetected.find((b) => b.id === enemies[1].id)!;
    expect(sniperBlip.detectionSource).toBe('los');
    expect(sniperBlip.elevationCode).toBe('above');
    expect(sniperBlip.elevationDeltaM).toBeGreaterThanOrEqual(8);

    const staleBlip = blipsDetected.find((b) => b.id === enemies[0].id)!;
    expect(staleBlip.detectionSource).toBe('stale');
    expect(staleBlip.confidence).toBeLessThan(0.8);

    mgr.clear();
    rm.disposeAll();
  });

  it('preserves [N] TRIDENT-X and binds [TAB] to non-pausing Tactical Overview Drawer', () => {
    const defaults = ControlBindingsSchema.parse({});
    expect(defaults.strategicNuke).toBe('KeyN');
    expect(defaults.tacticalOverview).toBe('Tab');

    const fullSettings = GraphicsSettingsSchema.parse({});
    expect(fullSettings.targetRefreshRate).toBe(60);
    expect(fullSettings.rendererBackend).toBe('auto');

    const bundle = SettingsBundleSchema.parse({});
    expect(bundle.hud.preset).toBe('minimal_diegetic');
    expect(bundle.hud.opacity).toBeGreaterThan(0);

    uiStore.getState().setTacticalOverviewOpen(false);
    expect(uiStore.getState().tacticalOverviewOpen).toBe(false);
    uiStore.getState().toggleTacticalOverview();
    expect(uiStore.getState().tacticalOverviewOpen).toBe(true);
    uiStore.getState().setTacticalOverviewOpen(false);
  });

  it('configures realistic optic eye-relief and ADS world FOV across all 9 weapons', () => {
    expect(Object.keys(PER_WEAPON_OPTIC_CONFIGS)).toHaveLength(WEAPON_CATALOG.length);
    expect(PER_WEAPON_OPTIC_CONFIGS.sniper_rifle.adsWorldFovDeg).toBe(18);
    expect(PER_WEAPON_OPTIC_CONFIGS.sniper_rifle.opticType).toBe('sniper_6x_scope');
    expect(PER_WEAPON_OPTIC_CONFIGS.assault_rifle.opticType).toBe('red_dot_reflex');
  });

  it('discards initial OS/browser pointer-lock cursor-warp mousemove spikes while preserving normal mouse look', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, InputSettingsSchema.parse({}));
    const priv = input as unknown as {
      pointerLocked: boolean;
      ignoreNextLargeLockedWarp: boolean;
      handleMouseMove: (e: { movementX: number; movementY: number }) => void;
    };

    // Simulate pointerlockchange false -> true arming warp guard
    priv.pointerLocked = true;
    priv.ignoreNextLargeLockedWarp = true;

    // First spurious Chromium warp event resetting from Deploy button coords (-1067, -661)
    priv.handleMouseMove({ movementX: -1067, movementY: -661 });
    const afterWarp = input.consumeLookDelta(false, 1.0);
    expect(afterWarp.yawDelta).toBe(0);
    expect(afterWarp.pitchDelta).toBe(0);

    // Subsequent legitimate mouse deltas apply cleanly
    priv.handleMouseMove({ movementX: 24, movementY: -12 });
    const normalMove = input.consumeLookDelta(false, 1.0);
    expect(normalMove.yawDelta).toBeGreaterThan(0);
    expect(normalMove.pitchDelta).toBeLessThan(0);

    // Secondary huge compositor warp spike (> 450px) is also rejected
    priv.handleMouseMove({ movementX: 900, movementY: -500 });
    const afterSpike = input.consumeLookDelta(false, 1.0);
    expect(afterSpike.yawDelta).toBe(0);
    expect(afterSpike.pitchDelta).toBe(0);

    rm.disposeAll();
  });
});
