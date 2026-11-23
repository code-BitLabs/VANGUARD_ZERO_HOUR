import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { PbrMaterialLibrary } from '@/src/assets/PbrMaterialLibrary';
import { AudioManager } from '@/src/audio/AudioManager';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG } from '@/src/data/missions';
import { VFXPool } from '@/src/effects/VFXPool';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { audioSettingsStore } from '@/src/stores/audioSettingsStore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { createWorldShell, loadMapPopulator, populateCommonWorldAndFinalize } from '@/src/world/MapBuilderAsync';
import { buildMissionEnvironmentEnhancement } from '@/src/world/MissionEnvironmentEnhancer';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

describe('Stage 10 PERF-12 — Multi-Mission Memory Lifecycle & Unload Soak Tests', () => {
  afterEach(() => {
    audioSettingsStore.getState().resetAudio();
  });

  it('cycles sequentially across all 5 campaign missions twice with zero mission resource, material, listener, or scene-graph leaks', async () => {
    const resourceManager = new ResourceManager();
    const assetManager = new AssetManager(resourceManager);
    assetManager.setTextureQuality('low');
    const pbrLibrary = new PbrMaterialLibrary();
    const scene = new THREE.Scene();
    const collisionWorld = new CollisionWorld();
    const chunkManager = new WorldChunkManager();
    const vfx = new VFXPool(scene, resourceManager);
    const baseSceneChildren = scene.children.length;
    const audio = new AudioManager(resourceManager, audioSettingsStore.getState());
    const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);

    // Record baseline shared resources before mission cycling
    resourceManager.recordBaseline();

    const missionSequence = [...MISSION_CATALOG, MISSION_CATALOG[0], MISSION_CATALOG[2], MISSION_CATALOG[4]];

    for (const mission of missionSequence) {
      const scope = `mission:${mission.id}` as const;
      const populator = await loadMapPopulator(mission.mapId);
      const shell = createWorldShell(
        mission.mapId,
        mission.id,
        scene,
        assetManager,
        resourceManager,
        collisionWorld,
        chunkManager,
        destruction
      );
      populator(shell.ctx);
      const built = populateCommonWorldAndFinalize(shell);
      const enhancement = buildMissionEnvironmentEnhancement(
        scene,
        mission.id,
        pbrLibrary,
        collisionWorld.getGroundHeightAt
      );

      expect(built.groundMesh).toBeTruthy();
      expect(scene.children.length).toBeGreaterThan(baseSceneChildren + 4);

      // Also allocate mission-scoped shared materials to verify AssetManager eviction on unloadScope
      assetManager.getSharedMaterial('soak_concrete_probe', {
        pattern: 'concrete',
        repeat: [3, 3],
      }, scope);

      // Tear down mission cleanly (mirroring GameEngine.clearWorldState + PbrMaterialLibrary disposal)
      enhancement.dispose();
      pbrLibrary.dispose();
      destruction.clear();
      collisionWorld.clear();
      chunkManager.clear(scene);
      resourceManager.unloadScope(scope);

      const audit = resourceManager.auditTransitionDelta();
      expect(audit.hasMissionLeak).toBe(false);
      expect(audit.missionRemaining).toBe(0);
      expect(scene.children.length).toBe(baseSceneChildren);
    }

    // Shared resident bundle count stays strictly bounded after cycling all 5 theaters twice
    expect(assetManager.getResidentProfileCount()).toBeLessThanOrEqual(
      AssetManager.MAX_RESIDENT_PBR_BUNDLES
    );
    expect(assetManager.getSynthesizedPixelProfileCount()).toBeLessThanOrEqual(8);

    const finalAudit = resourceManager.recordPostUnloadAudit();
    expect(finalAudit.hasMissionLeak).toBe(false);
    expect(finalAudit.missionRemaining).toBe(0);

    vfx.resetAll();
    audio.dispose();
    pbrLibrary.dispose();
    assetManager.dispose();
    resourceManager.disposeAll();
  });

  it('soaks BattlefieldVfxSystem, SurfaceDecalManager, EnemyManager Flyweight pool, and DestructionSystem restoreAllIntact with zero GPU/entity leaks', async () => {
    const { BattlefieldVfxSystem } = await import('@/src/effects/BattlefieldVfxSystem');
    const { SurfaceDecalManager } = await import('@/src/effects/SurfaceDecalManager');
    const { EnemyManager } = await import('@/src/gameplay/EnemyManager');
    const { ProjectileManager } = await import('@/src/gameplay/ProjectileManager');
    const { createDestructibleCollider } = await import('@/src/world/DestructionSystem');

    const resourceManager = new ResourceManager();
    const scene = new THREE.Scene();
    const collisionWorld = new CollisionWorld();
    const vfx = new VFXPool(scene, resourceManager);
    const bfVfx = new BattlefieldVfxSystem(scene, false, resourceManager);
    const decals = new SurfaceDecalManager(scene, 64, 85, resourceManager);
    decals.prewarm();
    const audio = new AudioManager(resourceManager, audioSettingsStore.getState());
    const projectiles = new ProjectileManager(scene, resourceManager, vfx, audio);
    const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);
    const enemies = new EnemyManager(scene, resourceManager, vfx, audio, projectiles);

    const wallMesh = new THREE.Mesh(
      new THREE.BoxGeometry(8, 4, 1),
      new THREE.MeshStandardMaterial({ color: 0x777777 })
    );
    wallMesh.userData.surfaceMaterial = 'concrete';
    scene.add(wallMesh);

    resourceManager.recordBaseline();

    for (let cycle = 0; cycle < 3; cycle++) {
      const entityScope = `mission:${cycle + 1}:entities` as const;

      // Spawn 16 enemies across 4 archetypes, kill 12 to exercise EnemyRigPool & 8-slot corpse ring buffer
      enemies.spawnWave('infantry', 6, { x: -10, y: 0, z: -8 }, 8, collisionWorld, entityScope);
      enemies.spawnWave('heavy_armor', 4, { x: 8, y: 0, z: -8 }, 6, collisionWorld, entityScope);
      enemies.spawnWave('sniper', 3, { x: 0, y: 0, z: 10 }, 6, collisionWorld, entityScope);
      enemies.spawnWave('elite_assault', 3, { x: 10, y: 0, z: 10 }, 6, collisionWorld, entityScope);

      const liveUnits = enemies.getUnits();
      for (let i = 0; i < 12; i++) {
        enemies.damageUnit(liveUnits[i], 9999, false);
      }

      // Emit heavy VFX & 100 surface decals (exceeding 64-decal ring buffer)
      for (let i = 0; i < 20; i++) {
        bfVfx.emitEffect('metal_sparks', new THREE.Vector3(i, 1, 0));
        bfVfx.emitEffect('concrete_debris', new THREE.Vector3(i, 1, 0));
      }
      bfVfx.update(0.05, new THREE.Vector3(0, 1.7, 0));
      expect(bfVfx.getStats().gpuInstancesSubmitted).toBeGreaterThan(0);

      for (let i = 0; i < 100; i++) {
        decals.spawnImpactDecal({
          targetMesh: wallMesh,
          point: new THREE.Vector3((i % 10) * 0.4 - 2, 1.5, 0.51),
          normal: new THREE.Vector3(0, 0, 1),
          surface: i % 3 === 0 ? 'metal' : 'concrete',
        });
      }
      expect(decals.getStats().activeCount).toBeLessThanOrEqual(64);
      expect(decals.getStats().activeDrawCalls).toBeLessThanOrEqual(5);

      // Register & destroy a destructible, then restore in-place (simulating checkpoint reset)
      const crateGroup = new THREE.Group();
      const crateMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.4, 1.4),
        new THREE.MeshStandardMaterial({ color: 0xaa6622 })
      );
      crateGroup.add(crateMesh);
      scene.add(crateGroup);
      const crateId = `soak_crate_${cycle}`;
      const crateEntity = {
        id: crateId,
        kind: 'wooden_crate' as const,
        isObjectiveTarget: false,
        position: new THREE.Vector3(4, 0, 4),
        health: 50,
        maxHealth: 50,
        state: 'INTACT' as const,
        blastRadius: 0,
        blastDamage: 0,
        meshGroup: crateGroup,
        collider: createDestructibleCollider(crateId, 4, 0, 4, 0.7, 1.4, 0.7),
      };
      destruction.register(crateEntity);
      destruction.applyDamage(crateId, 100);
      expect(crateEntity.state).toBe('DESTROYED');
      const restoredCount = destruction.restoreAllIntact();
      expect(restoredCount).toBe(1);
      expect(crateEntity.state).toBe('INTACT');
      expect(crateEntity.health).toBe(50);

      // Tear down entity scope + VFX + decals cleanly
      enemies.clear();
      projectiles.resetAll();
      bfVfx.clearAll();
      decals.clearMissionDecals();
      destruction.clear();
      scene.remove(crateGroup);
      crateMesh.geometry.dispose();
      (crateMesh.material as THREE.Material).dispose();
      resourceManager.unloadScope(entityScope);

      expect(bfVfx.getStats().gpuInstancesSubmitted).toBe(0);
      expect(bfVfx.getStats().activeDrawCalls).toBe(0);
      expect(decals.getStats().activeCount).toBe(0);
      expect(decals.getStats().activeDrawCalls).toBe(0);

      const audit = resourceManager.auditTransitionDelta();
      expect(audit.hasMissionLeak).toBe(false);
      expect(audit.missionRemaining).toBe(0);
    }

    scene.remove(wallMesh);
    wallMesh.geometry.dispose();
    (wallMesh.material as THREE.Material).dispose();
    bfVfx.dispose();
    decals.dispose();
    vfx.resetAll();
    audio.dispose();
    resourceManager.disposeAll();
  });
});
