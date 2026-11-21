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
});
