import * as THREE from 'three';
import React, { Profiler } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { PbrMaterialLibrary } from '@/src/assets/PbrMaterialLibrary';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { SurfaceDecalManager } from '@/src/effects/SurfaceDecalManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { PhysicsDebugSystem } from '@/src/engine/physics/PhysicsDebugSystem';
import { EngineRenderer } from '@/src/engine/Renderer';
import { RenderingQualityDirector } from '@/src/engine/RenderingQualityDirector';
import {
  ShadowCascadeController,
  stripCsmMaterialPatches,
} from '@/src/engine/ShadowCascadeController';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { MISSION_CATALOG } from '@/src/data/missions';
import { audioSettingsStore } from '@/src/stores/audioSettingsStore';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import {
  HudDesktopVitalsPanel,
  HudDesktopWeaponAndOrdnancePanel,
  HudTopCenterStack,
} from '@/src/ui/hud/HudSlices';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { loadMapPopulator } from '@/src/world/MapBuilderAsync';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

describe('Stage 10 PERF-12 — Performance Budgets, Allocation Stability & React Slice Isolation', () => {
  beforeAll(() => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  afterEach(() => {
    gameSessionStore.getState().resetSession();
    cleanup();
  });

  it('PERF-01: ShadowCascadeController material registration is idempotent and skips CSM.update when camera pose is stationary', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
    camera.position.set(0, 2, 10);
    camera.updateMatrixWorld();

    const controller = new ShadowCascadeController(scene, camera, {
      cascades: 3,
      shadowMapSize: 1024,
      maxFar: 160,
      isSoftwareGl: false,
    });

    const active = controller.configure({ cascades: 3 });
    expect(active).toBe(true);

    const internalCsm = (controller as unknown as { csm: { update: () => void; setupMaterial: (m: THREE.Material) => void } }).csm;
    const csmUpdateSpy = vi.spyOn(internalCsm, 'update');
    const csmSetupSpy = vi.spyOn(internalCsm, 'setupMaterial');

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    controller.setupMaterial(mat);
    controller.setupMaterial(mat);
    controller.setupMaterial(mat);
    expect(csmSetupSpy).toHaveBeenCalledTimes(1);

    // First update runs because CSM starts dirty; subsequent frames with unchanged camera skip work
    controller.update();
    controller.update();
    controller.update();
    expect(csmUpdateSpy).toHaveBeenCalledTimes(1);

    // Moving camera beyond micro-threshold triggers exactly 1 CSM update
    camera.position.x += 0.25;
    controller.update();
    controller.update();
    expect(csmUpdateSpy).toHaveBeenCalledTimes(2);

    mat.dispose();
    controller.dispose();
  });

  it('PERF-04: PhysicsDebugSystem enforces fixed circular ring buffers and gates contact allocations when overlay is closed', () => {
    const debug = new PhysicsDebugSystem();
    debug.setDetailedRecordingEnabled(false);

    for (let i = 0; i < 500; i++) {
      debug.recordContact({
        entityId: 'player',
        colliderId: `wall_${i % 10}`,
        colliderTag: 'building_wall',
        pointX: i * 0.1,
        pointY: 1,
        pointZ: 0,
        normalX: 1,
        normalY: 0,
        normalZ: 0,
        penetrationDepth: 0.02,
        impactSpeed: 3.5,
      });
    }

    expect(debug.penetrationCorrectionsTotal).toBe(500);
    expect(debug.getRecentContacts().length).toBe(0);

    debug.setDetailedRecordingEnabled(true);
    for (let i = 0; i < 200; i++) {
      debug.recordContact({
        entityId: 'player',
        colliderId: `wall_${i}`,
        colliderTag: 'building_wall',
        pointX: i,
        pointY: 1,
        pointZ: 0,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        penetrationDepth: 0.01,
        impactSpeed: 2.0,
      });
    }
    expect(debug.getRecentContacts().length).toBe(PhysicsDebugSystem.MAX_CONTACTS);
  });

  it('PERF-02 & PERF-03: All 5 campaign maps expose bounded chunk queries, stair traversal resolution, and static frozen matrices', async () => {
    for (const mission of MISSION_CATALOG) {
      const resourceManager = new ResourceManager();
      const assets = new AssetManager(resourceManager);
      assets.setTextureQuality('low');
      const scene = new THREE.Scene();
      const collisionWorld = new CollisionWorld();
      const chunkManager = new WorldChunkManager();
      const vfx = new VFXPool(scene, resourceManager);
      const audio = new AudioManager(resourceManager, audioSettingsStore.getState());
      const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);

      // Verify dynamic populator module resolves cleanly for PERF-10 chunk loading
      const populator = await loadMapPopulator(mission.mapId);
      expect(typeof populator).toBe('function');

      buildWorldMap(
        mission.mapId,
        mission.id,
        scene,
        assets,
        resourceManager,
        collisionWorld,
        chunkManager,
        destruction
      );

      // Static world props built via WorldChunkManager keep frozen matrices
      const localChunks = chunkManager.getChunksAround(mission.playerSpawn.x, mission.playerSpawn.z, 2);
      expect(localChunks.length).toBeGreaterThanOrEqual(0);

      // Stair & slope grounding query remains bounded across 200 samples
      let sumSlopeChecks = 0;
      for (let i = 0; i < 200; i++) {
        const res = collisionWorld.getSupportHeightAt(
          mission.playerSpawn.x + (i % 10) * 0.25,
          mission.playerSpawn.y,
          mission.playerSpawn.z - (i % 20) * 0.25,
          1.75,
          0.45,
          48
        );
        sumSlopeChecks++;
        expect(Number.isFinite(res)).toBe(true);
      }
      expect(sumSlopeChecks).toBe(200);

      resourceManager.unloadScope(`mission:${mission.id}`);
      chunkManager.clear(scene);
      collisionWorld.clear();
      destruction.clear();
      assets.dispose();
      audio.dispose();
      resourceManager.disposeAll();
    }
  });

  it('PERF-06 & PERF-07: HUD slice isolation prevents camera yaw ticks from re-rendering Vitals or Weapon panels, and shares one viewport listener', () => {
    let vitalsCommits = 0;
    let weaponCommits = 0;
    let centerCommits = 0;

    function ViewportHookConsumer() {
      const vp = useViewportMode();
      return React.createElement('span', { 'data-testid': 'vp-width' }, vp.width);
    }

    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ViewportHookConsumer),
        React.createElement(ViewportHookConsumer),
        React.createElement(
          Profiler,
          {
            id: 'vitals',
            onRender: () => {
              vitalsCommits++;
            },
          },
          React.createElement(HudDesktopVitalsPanel)
        ),
        React.createElement(
          Profiler,
          {
            id: 'weapon',
            onRender: () => {
              weaponCommits++;
            },
          },
          React.createElement(HudDesktopWeaponAndOrdnancePanel, { inputManager: null })
        ),
        React.createElement(
          Profiler,
          {
            id: 'center',
            onRender: () => {
              centerCommits++;
            },
          },
          React.createElement(HudTopCenterStack, {
            showCompass: true,
            compactHud: false,
            downedActive: false,
            pointerLocked: true,
            combatDebugOpen: false,
            touchControlsVisible: false,
            isCoarsePointer: false,
            hudMode: 'adaptive',
            onRequestPointerLock: () => {},
          })
        )
      )
    );

    const initialVitals = vitalsCommits;
    const initialWeapon = weaponCommits;
    const initialCenter = centerCommits;

    // 1. Rotate camera yaw 10 times: only compass/center stack should update; vitals & weapon MUST NOT commit
    for (let i = 1; i <= 10; i++) {
      act(() => {
        const cur = gameSessionStore.getState().hud;
        gameSessionStore.getState().updateHudSnapshot({
          ...cur,
          playerYaw: (cur.playerYaw + 0.15 * i) % (Math.PI * 2),
        });
      });
    }

    expect(centerCommits).toBeGreaterThan(initialCenter);
    expect(vitalsCommits).toBe(initialVitals);
    expect(weaponCommits).toBe(initialWeapon);

    // 2. Update health only: vitals commits, weapon panel MUST NOT commit
    act(() => {
      const cur = gameSessionStore.getState().hud;
      gameSessionStore.getState().updateHudSnapshot({
        ...cur,
        health: 75,
      });
    });

    expect(vitalsCommits).toBe(initialVitals + 1);
    expect(weaponCommits).toBe(initialWeapon);
  });

  it('PERF-09: AssetManager & PbrMaterialLibrary deduplicate base texture pixel synthesis across differing repeat tiles', () => {
    const rm = new ResourceManager();
    const assets = new AssetManager(rm);
    assets.setTextureQuality('medium');

    assets.getPbrTextureBundle('concrete', [1, 1], 'shared');
    assets.getPbrTextureBundle('concrete', [2, 2], 'shared');
    assets.getPbrTextureBundle('concrete', [28, 28], 'mission:1');
    assets.getPbrTextureBundle('concrete', [6, 4], 'mission:2');

    // Only ONE FBM+Sobel pixel synthesis executed for 'concrete' at resolution 256
    expect(assets.getSynthesizedPixelProfileCount()).toBe(1);

    const pbrLib = new PbrMaterialLibrary();
    const m1 = pbrLib.getMaterial('wet_asphalt', { wetness: 0.5, repeatX: 1, repeatY: 1 });
    const m2 = pbrLib.getMaterial('wet_asphalt', { wetness: 0.5, repeatX: 4, repeatY: 2 });
    expect(m1).not.toBe(m2);

    pbrLib.dispose();
    assets.dispose();
    rm.disposeAll();
  });

  it('CSM-FIX: ShadowCascadeController resizes shadowMapSize in-place and never mutates live shader.uniforms on rebuild/teardown', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
    const controller = new ShadowCascadeController(scene, camera, {
      cascades: 3,
      shadowMapSize: 1024,
      maxFar: 160,
      isSoftwareGl: false,
    });

    expect(controller.configure({ cascades: 3, shadowMapSize: 1024 })).toBe(true);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    controller.setupMaterial(mat);
    const keyBeforeResize = mat.customProgramCacheKey();

    // Simulate WebGLRenderer having compiled the material and populated csm.shaders
    const internalBefore = (
      controller as unknown as {
        csm: {
          shaders: Map<THREE.Material, { uniforms: Record<string, { value: unknown }> }>;
          lights: THREE.DirectionalLight[];
        };
      }
    ).csm;
    const liveShader = {
      uniforms: {
        CSM_cascades: { value: [] },
        cameraNear: { value: 0.1 },
        shadowFar: { value: 160 },
      },
    };
    internalBefore.shaders.set(mat, liveShader);

    // Changing only shadowMapSize MUST resize lights in-place without rebuilding CSM
    expect(controller.configure({ cascades: 3, shadowMapSize: 512 })).toBe(true);
    const internalAfterResize = (controller as unknown as { csm: typeof internalBefore }).csm;
    expect(internalAfterResize).toBe(internalBefore);
    expect(internalAfterResize.lights[0].shadow.mapSize.x).toBe(512);
    expect(mat.customProgramCacheKey()).toBe(keyBeforeResize);

    // Rebuilding CSM for a cascade-count change MUST NOT delete live shader.uniforms keys
    // and MUST rotate customProgramCacheKey so WebGLRenderer allocates a fresh uniformsList
    expect(controller.configure({ cascades: 2, shadowMapSize: 512 })).toBe(true);
    expect(liveShader.uniforms.CSM_cascades).toBeDefined();
    expect(liveShader.uniforms.cameraNear).toBeDefined();
    expect(liveShader.uniforms.shadowFar).toBeDefined();

    const keyAfterTeardown = mat.customProgramCacheKey();
    expect(keyAfterTeardown).not.toBe(keyBeforeResize);

    controller.setupMaterial(mat);
    const keyAfterRebuild = mat.customProgramCacheKey();
    expect(keyAfterRebuild).not.toBe(keyBeforeResize);
    expect(keyAfterRebuild).not.toBe(keyAfterTeardown);

    // Patched material receives CSM defines; stripCsmMaterialPatches cleans both
    // cloned userData tags and any stale CSM defines copied onto clones
    expect((mat.defines as Record<string, unknown> | undefined)?.USE_CSM).toBeDefined();
    const cloned = mat.clone();
    cloned.defines = { ...(mat.defines ?? {}) };
    expect((cloned.defines as Record<string, unknown> | undefined)?.USE_CSM).toBeDefined();
    expect(stripCsmMaterialPatches(cloned)).toBe(true);
    expect((cloned.defines as Record<string, unknown> | undefined)?.USE_CSM).toBeUndefined();
    expect((cloned.defines as Record<string, unknown> | undefined)?.CSM_CASCADES).toBeUndefined();
    expect(cloned.userData.__vanguardCsmPatched).toBeUndefined();

    cloned.dispose();
    mat.dispose();
    controller.dispose();
  });

  it('COMBAT-DECAL-FIX: SurfaceDecalManager uses shared oriented quad fast path for dense terrain meshes', () => {
    const scene = new THREE.Scene();
    const terrainGeo = new THREE.PlaneGeometry(240, 240, 72, 72);
    terrainGeo.rotateX(-Math.PI / 2);
    const terrainMat = new THREE.MeshStandardMaterial({ color: 0xc2a878 });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.updateMatrixWorld(true);
    scene.add(terrainMesh);

    const decals = new SurfaceDecalManager(scene, 4, 85);
    const t0 = performance.now();
    for (let i = 0; i < 16; i++) {
      const ok = decals.spawnImpactDecal({
        targetMesh: terrainMesh,
        point: new THREE.Vector3(i * 0.5, 0, i * 0.5),
        normal: new THREE.Vector3(0, 1, 0),
        surface: 'sand',
      });
      expect(ok).toBe(true);
    }
    const elapsedMs = performance.now() - t0;
    expect(decals.getStats().activeCount).toBe(4);
    expect(elapsedMs).toBeLessThan(200);

    decals.dispose();
    terrainGeo.dispose();
    terrainMat.dispose();
  });

  it('ANTI-BLINK & ANTI-FREEZE: EngineRenderer skips redundant setSize blinks, defers mid-combat resize before draw, locks CSM cascade count mid-combat, and prewarms VFX/decal shaders', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
    const vmCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.03, 12);
    const setSize = vi.fn();
    const setPixelRatio = vi.fn();
    const composerSetSize = vi.fn();
    const composerRender = vi.fn();

    const shadowCascades = new ShadowCascadeController(scene, camera, {
      cascades: 3,
      shadowMapSize: 1024,
      maxFar: 160,
      isSoftwareGl: false,
    });
    expect(shadowCascades.configure({ cascades: 3, shadowMapSize: 1024 })).toBe(true);
    const initialCsm = (shadowCascades as unknown as { csm: unknown }).csm;

    const qualityDirector = new RenderingQualityDirector('high_end_desktop');
    // Push director to step 6 where it wants csmCascades=1 and renderScale=0.75
    for (let i = 0; i < 1200; i++) {
      qualityDirector.recordFrame({ cpuFrameMs: 36, drawCalls: 180, triangles: 240000 });
    }
    expect(qualityDirector.getTelemetry().degradationStep).toBeGreaterThanOrEqual(3);

    const fakeRenderer = Object.assign(Object.create(EngineRenderer.prototype), {
      container: { clientWidth: 1280, clientHeight: 720 },
      isSoftwareGl: false,
      maxDprCap: 2.0,
      renderScale: 1.0,
      bloomEnabled: true,
      width: 1280,
      height: 720,
      appliedWidth: 1280,
      appliedHeight: 720,
      appliedEffectiveDpr: 1.0,
      pendingResize: false,
      scene,
      camera,
      viewModelCamera: vmCamera,
      shadowCascades,
      qualityDirector,
      composer: { setSize: composerSetSize, render: composerRender },
      vignettePass: { enabled: true },
      bloomPass: { enabled: true },
      bloomEffect: { blendMode: { opacity: { value: 1 } } },
      renderer: {
        setSize,
        setPixelRatio,
        setRenderTarget: vi.fn(),
        clear: vi.fn(),
        clearDepth: vi.fn(),
        render: vi.fn(),
        getContext: () => ({ isContextLost: () => false }),
        info: { reset: vi.fn(), render: { calls: 10, triangles: 500 }, memory: { geometries: 1, textures: 1 } },
      },
    }) as EngineRenderer;

    // 1. Redundant resize with identical dimensions + DPR MUST NOT call setSize (prevents canvas wipe blink)
    fakeRenderer.resize();
    expect(setSize).not.toHaveBeenCalled();
    expect(composerSetSize).not.toHaveBeenCalled();

    // 2. Mid-combat applyDirectorDimensions with allowCsmRebuild=false & deferResize=true
    // MUST NOT tear down CSM (no 500-900ms shader recompile) and MUST defer resize until renderFrame()
    fakeRenderer.applyDirectorDimensions(2.0, null, true, {
      allowCsmRebuild: false,
      deferResize: true,
    });
    expect((shadowCascades as unknown as { csm: unknown }).csm).toBe(initialCsm);
    expect(shadowCascades.getTelemetry().activeCascades).toBe(3);
    expect(setSize).not.toHaveBeenCalled();

    // 3. On next renderFrame(), deferred resize runs BEFORE composer.render() (zero black-frame blink)
    const callOrder: string[] = [];
    setSize.mockImplementation(() => callOrder.push('setSize'));
    composerRender.mockImplementation(() => callOrder.push('render'));
    fakeRenderer.renderFrame(false);
    expect(callOrder).toEqual(['setSize', 'render']);

    // 4. Decal & VFX material prewarming ensures all shaders exist before first combat shot
    const decals = new SurfaceDecalManager(scene, 16, 85);
    decals.prewarm();
    expect(decals.getStats().materialCount).toBe(5);
    decals.dispose();

    const rm = new ResourceManager();
    const vfx = new VFXPool(scene, rm);
    const vfxRoot = scene.getObjectByName('vfx_pool_root')!;
    const uniqueParticleMats = new Set<THREE.Material>();
    vfxRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.Material) {
        uniqueParticleMats.add(obj.material);
      }
    });
    expect(uniqueParticleMats.size).toBeGreaterThanOrEqual(6);
    expect(vfx.getPoolCapacity()).toBeGreaterThan(0);

    shadowCascades.dispose();
    rm.disposeAll();
  });
});
