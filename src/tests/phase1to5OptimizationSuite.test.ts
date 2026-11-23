import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PbrMaterialLibrary } from '@/src/assets/PbrMaterialLibrary';
import { AudioManager } from '@/src/audio/AudioManager';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG } from '@/src/data/missions';
import { BattlefieldVfxSystem } from '@/src/effects/BattlefieldVfxSystem';
import { SurfaceDecalManager } from '@/src/effects/SurfaceDecalManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { resolveAntiAliasingPolicy } from '@/src/engine/AntiAliasingPolicy';
import { createLifecycleActor, engineLifecycleMachine } from '@/src/engine/EngineLifecycle';
import { GameLoop } from '@/src/engine/GameLoop';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { audioSettingsStore } from '@/src/stores/audioSettingsStore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { createWorldShell, loadMapPopulator, populateCommonWorldAndFinalize } from '@/src/world/MapBuilderAsync';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';
import { NavigationSolver } from '@/src/workers/navigationCore';

describe('Phases 1–5 Engineering, Rendering, Memory & Architecture Regression Suite', () => {
  describe('Phase 1 — Input Parity, Dense VFX Compaction & Adaptive Timing', () => {
    it('maintains 30/60/120/144Hz discrete edge-triggered input parity without double-triggering on 0-substep frames', () => {
      for (const hz of [30, 60, 120, 144]) {
        const dt = 1 / hz;
        let sampleCalls = 0;
        let fixedSteps = 0;
        let lastRawDt = 0;
        const alphas: number[] = [];

        const loop = new GameLoop({
          sampleInput: () => {
            sampleCalls++;
          },
          fixedStep: () => {
            fixedSteps++;
          },
          scheduleAI: () => {},
          updateAnimationAndVfx: (_dt, alpha) => {
            alphas.push(alpha);
          },
          updateAudio: () => {},
          render: () => {},
          publishUiSnapshot: () => {},
          onFrameMeasured: (_ms, rawDt) => {
            lastRawDt = rawDt;
          },
        });

        for (let f = 0; f < hz; f++) {
          loop.stepFrameForTest(dt, 4.0);
        }

        expect(fixedSteps).toBeGreaterThanOrEqual(58);
        expect(fixedSteps).toBeLessThanOrEqual(61);
        expect(sampleCalls).toBeLessThanOrEqual(fixedSteps);
        expect(lastRawDt).toBeCloseTo(dt, 4);
        expect(alphas.every((a) => a >= 0 && a <= 1.0001)).toBe(true);
      }
    });

    it('submits 0 idle GPU instances in BattlefieldVfxSystem and compacts active slots densely on expiry', () => {
      const scene = new THREE.Scene();
      const rm = new ResourceManager();
      const vfx = new BattlefieldVfxSystem(scene, false, rm);

      expect(vfx.getStats().gpuInstancesSubmitted).toBe(0);
      expect(vfx.getStats().activeDrawCalls).toBe(0);

      vfx.emitEffect('muzzle_flash', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), 1);
      vfx.emitEffect('metal_sparks', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0), 1);
      const afterEmit = vfx.getStats();
      expect(afterEmit.activeParticles).toBeGreaterThan(0);
      expect(afterEmit.gpuInstancesSubmitted).toBe(afterEmit.activeParticles);

      for (let i = 0; i < 30; i++) {
        vfx.update(0.05, new THREE.Vector3(0, 1.7, 0));
      }
      const afterExpire = vfx.getStats();
      expect(afterExpire.activeParticles).toBe(0);
      expect(afterExpire.gpuInstancesSubmitted).toBe(0);
      expect(afterExpire.activeDrawCalls).toBe(0);

      vfx.dispose();
      rm.disposeAll();
    });
  });

  describe('Phase 2 — Hybrid Adaptive AA, Static Chunk Merging & Instanced Decals', () => {
    it('resolves AntiAliasingPolicy accurately across desktop 1080p, 4K, mobile, low tier, WebGL1, software GL, and user overrides', () => {
      const base = {
        requestedMode: 'auto' as const,
        antialiasingEnabled: true,
        isSoftwareGl: false,
        isWebGL2: true,
        maxSamples: 4,
        msaaFramebufferSupported: true,
        canvasPixelCount: 1920 * 1080,
        isMobileOrCoarse: false,
        qualityTier: 'high' as const,
        adaptiveDowngradeStep: 0,
      };

      expect(resolveAntiAliasingPolicy(base)).toMatchObject({
        activeMode: 'msaa4',
        multisampling: 4,
        useSmaa: false,
      });

      expect(
        resolveAntiAliasingPolicy({ ...base, canvasPixelCount: 3840 * 2160 })
      ).toMatchObject({
        activeMode: 'msaa2',
        multisampling: 2,
        useSmaa: false,
      });

      expect(resolveAntiAliasingPolicy({ ...base, qualityTier: 'medium' })).toMatchObject({
        activeMode: 'msaa2',
        multisampling: 2,
        useSmaa: false,
      });

      expect(resolveAntiAliasingPolicy({ ...base, qualityTier: 'low' })).toMatchObject({
        activeMode: 'smaa',
        multisampling: 0,
        useSmaa: true,
      });

      expect(resolveAntiAliasingPolicy({ ...base, isMobileOrCoarse: true })).toMatchObject({
        activeMode: 'smaa',
        multisampling: 0,
        useSmaa: true,
      });

      expect(resolveAntiAliasingPolicy({ ...base, isWebGL2: false })).toMatchObject({
        activeMode: 'smaa',
        multisampling: 0,
        useSmaa: true,
      });
      expect(
        resolveAntiAliasingPolicy({ ...base, msaaFramebufferSupported: false })
      ).toMatchObject({
        activeMode: 'smaa',
        multisampling: 0,
        useSmaa: true,
      });

      expect(resolveAntiAliasingPolicy({ ...base, isSoftwareGl: true })).toMatchObject({
        activeMode: 'off',
        multisampling: 0,
        useSmaa: false,
      });

      expect(
        resolveAntiAliasingPolicy({ ...base, requestedMode: 'msaa4', maxSamples: 2 })
      ).toMatchObject({
        activeMode: 'msaa2',
        multisampling: 2,
        useSmaa: false,
      });

      expect(resolveAntiAliasingPolicy({ ...base, requestedMode: 'off' })).toMatchObject({
        activeMode: 'off',
        multisampling: 0,
        useSmaa: false,
      });
    });

    it('merges static chunk meshes and keeps Mission 1 BVH count compact without breaking colliders', async () => {
      const rm = new ResourceManager();
      const assets = new AssetManager(rm);
      assets.setTextureQuality('low');
      const scene = new THREE.Scene();
      const collision = new CollisionWorld();
      const chunks = new WorldChunkManager();
      const vfx = new VFXPool(scene, rm);
      const audio = new AudioManager(rm, audioSettingsStore.getState());
      const destruction = new DestructionSystem(collision.physicsWorld, vfx, audio);

      const m1 = MISSION_CATALOG[0];
      const populator = await loadMapPopulator(m1.mapId);
      const shell = createWorldShell(
        m1.mapId,
        m1.id,
        scene,
        assets,
        rm,
        collision,
        chunks,
        destruction
      );
      populator(shell.ctx);
      populateCommonWorldAndFinalize(shell);

      let mergedChunkMeshes = 0;
      let totalSceneMeshes = 0;
      let bvhMeshCount = 0;
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          totalSceneMeshes++;
          if (obj.name.startsWith('merged_chunk_')) {
            mergedChunkMeshes++;
          }
          const geo = (obj as THREE.Mesh).geometry as THREE.BufferGeometry & { boundsTree?: unknown };
          if (geo && geo.boundsTree) bvhMeshCount++;
        }
      });

      expect(mergedChunkMeshes).toBeGreaterThan(0);
      // Merged M1 mesh count and BVH count must be dramatically lower than pre-merge baseline (350+ meshes, 139 BVHs)
      expect(totalSceneMeshes).toBeLessThan(220);
      expect(bvhMeshCount).toBeLessThan(65);

      destruction.clear();
      collision.clear();
      chunks.clear(scene);
      rm.unloadScope(`mission:${m1.id}`);
      audio.dispose();
      assets.dispose();
      rm.disposeAll();
    });

    it('keeps SurfaceDecalManager strictly <= 5 draw calls even after 200 mixed impacts', () => {
      const scene = new THREE.Scene();
      const rm = new ResourceManager();
      const decals = new SurfaceDecalManager(scene, 128, 85, rm);
      decals.prewarm();

      const target = new THREE.Mesh(
        new THREE.BoxGeometry(10, 5, 1),
        new THREE.MeshStandardMaterial()
      );
      const surfaces = ['concrete', 'metal', 'wood', 'glass'] as const;
      for (let i = 0; i < 200; i++) {
        decals.spawnImpactDecal({
          targetMesh: target,
          point: new THREE.Vector3((i % 20) * 0.3 - 3, 1.5, 0.51),
          normal: new THREE.Vector3(0, 0, 1),
          surface: surfaces[i % surfaces.length],
          isExplosion: i % 25 === 0,
        });
      }

      const stats = decals.getStats();
      expect(stats.activeCount).toBe(128);
      expect(stats.activeDrawCalls).toBeLessThanOrEqual(5);

      decals.dispose();
      target.geometry.dispose();
      (target.material as THREE.Material).dispose();
      rm.disposeAll();
    });
  });

  describe('Phase 3 — RM-Packed PBR, Flyweight Enemy Pool & Zero Three.js Warnings', () => {
    it('packs roughness + metalness into one shared Texture.source across repeats and emits zero Three.js undefined warnings', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const rm = new ResourceManager();
        const assets = new AssetManager(rm);
        assets.setTextureQuality('low');

        const b1 = assets.getPbrTextureBundle('concrete', [1, 1]);
        const b2 = assets.getPbrTextureBundle('concrete', [4, 4]);
        // RM-packed: roughnessMap and metalnessMap share the exact same GPU Texture
        expect(b1.roughnessMap).toBe(b1.metalnessMap);
        // Repeat aliases share the exact same underlying GPU Texture.source (zero duplicate GPU upload)
        expect(b1.albedoMap.source).toBe(b2.albedoMap.source);
        expect(b1.normalMap.source).toBe(b2.normalMap.source);
        expect(b1.roughnessMap.source).toBe(b2.roughnessMap.source);
        expect(assets.getSynthesizedPixelProfileCount()).toBe(1);

        // PbrMaterialLibrary should construct domain materials with zero Three.js undefined warnings
        const lib = new PbrMaterialLibrary();
        lib.getMaterial('wet_asphalt', { repeatX: 1, repeatY: 1, wetness: 0.5 });
        lib.getMaterial('reinforced_concrete', { repeatX: 2, repeatY: 2 });
        lib.getMaterial('rust', { repeatX: 1, repeatY: 1 });
        lib.getMaterial('desert_sand', { repeatX: 3, repeatY: 3 });
        lib.dispose();

        const undefinedWarnings = warnSpy.mock.calls.filter((args) =>
          String(args[0] ?? '').includes('parameter is undefined')
        );
        expect(undefinedWarnings.length).toBe(0);

        assets.dispose();
        rm.disposeAll();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('shares Flyweight geometries & materials across 20 spawned enemies and caps active corpses to 8', () => {
      const scene = new THREE.Scene();
      const rm = new ResourceManager();
      const collision = new CollisionWorld();
      const vfx = new VFXPool(scene, rm);
      const audio = new AudioManager(rm, audioSettingsStore.getState());
      const projectiles = new ProjectileManager(scene, rm, vfx, audio);
      const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles);
      const entityScope = 'mission:1:entities' as const;

      enemies.spawnWave('infantry', 8, { x: -12, y: 0, z: 8 }, 8, collision, entityScope);
      enemies.spawnWave('heavy_armor', 4, { x: 10, y: 0, z: 8 }, 6, collision, entityScope);
      enemies.spawnWave('sniper', 4, { x: -6, y: 0, z: -10 }, 6, collision, entityScope);
      enemies.spawnWave('elite_assault', 4, { x: 8, y: 0, z: -10 }, 6, collision, entityScope);

      const uniqueGeos = new Set<string>();
      const uniqueMats = new Set<string>();
      for (const u of enemies.getUnits()) {
        u.meshRoot.traverse((obj: THREE.Object3D) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            uniqueGeos.add(mesh.geometry.uuid);
            const mat = mesh.material;
            if (Array.isArray(mat)) {
              for (const m of mat) uniqueMats.add(m.uuid);
            } else if (mat) {
              uniqueMats.add(mat.uuid);
            }
          }
        });
      }

      // 20 enemies across 4 archetypes previously created ~380 geometries & ~160 materials; Flyweight palette keeps it <= 28
      expect(uniqueGeos.size).toBeLessThanOrEqual(28);
      expect(uniqueMats.size).toBeLessThanOrEqual(20);

      // Kill 14 enemies — corpse ring buffer must recycle oldest corpses so <= 8 visible dead roots remain
      const allUnits = enemies.getUnits();
      for (let i = 0; i < 14; i++) {
        enemies.damageUnit(allUnits[i], 9999, false);
      }
      const visibleDeadCount = allUnits.filter((u) => !u.alive && u.meshRoot.visible).length;
      expect(visibleDeadCount).toBeLessThanOrEqual(8);

      enemies.clear();
      projectiles.resetAll();
      rm.unloadScope(entityScope);
      audio.dispose();
      rm.disposeAll();
    });
  });

  describe('Phase 4 — K-Nearest Portal Pre-Filtering with Automatic Fallback', () => {
    it('evaluates at most 4 nearest start portals when unobstructed and automatically falls back when nearest portals are blocked', () => {
      const solver = new NavigationSolver();
      const w = 40;
      const h = 40;
      const groundBlocked = new Uint8Array(w * h);
      const roofBlocked = new Uint8Array(10 * 10);

      const portals = Array.from({ length: 10 }, (_, i) => ({
        portalId: i + 1,
        portalKey: `stair_${i}`,
        kind: 'stair' as const,
        fromSurfaceId: 0,
        toSurfaceId: 1,
        fromFloorIndex: 0,
        toFloorIndex: 1,
        fromX: -16 + i * 3.2,
        fromY: 0,
        fromZ: -8,
        toX: -4 + (i % 5) * 2,
        toY: 4,
        toZ: 0,
        bidirectional: true,
        width: 2,
        clearanceHeight: 2.5,
        slopeDeg: 30,
        baseCost: 4,
        dynamicWaitCost: 0,
        allowedProfilesMask: 0xff,
        maxConcurrentOccupants: 0,
        activeOccupants: 0,
        enabled: true,
      }));

      solver.initMultiSurfaceNavigation(
        { width: w, height: h, cellSize: 1, originX: -20, originZ: -20, blocked: groundBlocked },
        [
          {
            surfaceId: 1,
            name: 'roof_1',
            width: 10,
            height: 10,
            cellSize: 1,
            originX: -5,
            originZ: -5,
            elevationY: 4,
            minY: 3.5,
            maxY: 6.5,
            blocked: roofBlocked,
          },
        ],
        portals
      );

      // Unobstructed query: K-nearest pre-filter should cap A* calls far below full 10+10=20 scan
      const ok1 = solver.computeNextWaypoint3D(-15, 0, -10, 0, 4, 0, 1);
      expect(ok1).toBe(true);
      expect(solver.lastPortalAStarCalls).toBeLessThanOrEqual(8);

      // Wall off the 4 nearest ground portals (x = -16 .. -6.4, z = -8) so only portals 4..9 are reachable
      for (let gx = 0; gx < 16; gx++) {
        for (let gz = 10; gz <= 14; gz++) {
          groundBlocked[gz * w + gx] = 1;
        }
      }
      solver.initMultiSurfaceNavigation(
        { width: w, height: h, cellSize: 1, originX: -20, originZ: -20, blocked: groundBlocked },
        [
          {
            surfaceId: 1,
            name: 'roof_1',
            width: 10,
            height: 10,
            cellSize: 1,
            originX: -5,
            originZ: -5,
            elevationY: 4,
            minY: 3.5,
            maxY: 6.5,
            blocked: roofBlocked,
          },
        ],
        portals
      );

      // Fallback expansion must automatically discover the remaining reachable portals
      const ok2 = solver.computeNextWaypoint3D(-15, 0, -15, 0, 4, 0, 1);
      expect(ok2).toBe(true);
      expect(solver.lastPortalAStarCalls).toBeGreaterThan(8);
    });
  });

  describe('Phase 5 — Zero-Dependency EngineLifecycle FSM Parity', () => {
    it('notifies subscribers, tracks missionId & errorMessage context, and ignores invalid or post-stop events', () => {
      const actor = createLifecycleActor(engineLifecycleMachine);
      const phases: string[] = [];
      const sub = actor.subscribe((snap) => phases.push(snap.value));

      // Before start(), events are ignored
      actor.send({ type: 'READY' });
      expect(actor.getSnapshot().value).toBe('boot');

      actor.start();
      actor.send({ type: 'READY' });
      actor.send({ type: 'SELECT_MISSION', missionId: 3 });
      expect(actor.getSnapshot().context.missionId).toBe(3);

      actor.send({ type: 'LOAD_FAILED', message: 'Asset timeout' });
      expect(actor.getSnapshot().value).toBe('error');
      expect(actor.getSnapshot().context.errorMessage).toBe('Asset timeout');

      actor.send({ type: 'RECOVER' });
      expect(actor.getSnapshot().value).toBe('unloading');
      actor.send({ type: 'UNLOADED' });
      expect(actor.getSnapshot().value).toBe('menu');
      expect(actor.getSnapshot().context.missionId).toBeNull();
      expect(actor.getSnapshot().context.errorMessage).toBeNull();

      sub.unsubscribe();
      actor.stop();
      actor.send({ type: 'SELECT_MISSION', missionId: 2 });
      expect(actor.getSnapshot().value).toBe('menu');
      expect(phases).toEqual(['menu', 'preloading', 'error', 'unloading', 'menu']);
    });
  });
});
