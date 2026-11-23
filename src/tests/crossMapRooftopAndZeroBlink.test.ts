import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG } from '@/src/data/missions';
import { PerformanceGovernor } from '@/src/engine/PerformanceGovernor';
import { EngineRenderer } from '@/src/engine/Renderer';
import { RenderingQualityDirector } from '@/src/engine/RenderingQualityDirector';
import { ShadowCascadeController } from '@/src/engine/ShadowCascadeController';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { buildMissionEnvironmentEnhancement } from '@/src/world/MissionEnvironmentEnhancer';
import { PbrMaterialLibrary } from '@/src/assets/PbrMaterialLibrary';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

describe('Cross-Map Rooftop Standardization, Prop Clearance & Zero-Blink Combat Pacing', () => {
  it('enforces walkable <=32° slopes and unified switchback stairs across ALL 5 missions (4 maps)', () => {
    for (const mission of MISSION_CATALOG) {
      const scene = new THREE.Scene();
      const res = new ResourceManager();
      const assets = new AssetManager(res);
      const collision = new CollisionWorld();
      const chunks = new WorldChunkManager();
      const destruction = new DestructionSystem(collision.physicsWorld, {} as never, {} as never);

      buildWorldMap(
        mission.mapId,
        mission.id,
        scene,
        assets,
        res,
        collision,
        chunks,
        destruction
      );

      const slopes = collision.getSlopes();
      expect(slopes.length, `mission ${mission.id} (${mission.mapId}) should have slopes`).toBeGreaterThan(0);

      for (const slope of slopes) {
        expect(
          slope.maxSlopeDeg,
          `mission ${mission.id} slope "${slope.id}" exceeded safe climbable angle`
        ).toBeLessThanOrEqual(32);
        expect(slope.id.endsWith('_ramp')).toBe(false);
      }

      // Every building staircase must have mid-landing & top-bridge safety guardrails
      const allColliders = collision.spatialHash.queryAABB(
        -160,
        -160,
        160,
        160,
        COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
        []
      );
      const flight1Slopes = slopes.filter((s) => s.id.endsWith('_flight1'));
      expect(flight1Slopes.length).toBeGreaterThan(0);
      for (const f1 of flight1Slopes) {
        const stairPrefix = f1.id.slice(0, -'_flight1'.length);
        expect(
          allColliders.some((c) => c.id === `${stairPrefix}_top_rail_back`),
          `missing top back guardrail for ${stairPrefix} on mission ${mission.id}`
        ).toBe(true);
        expect(
          allColliders.some((c) => c.id === `${stairPrefix}_top_rail_outer`),
          `missing top outer guardrail for ${stairPrefix} on mission ${mission.id}`
        ).toBe(true);
      }
    }
  });

  it('lets a character capsule walk smoothly from ground up Desert bunker_0 and Jungle camp switchback stairs onto the roof', () => {
    const scenarios = [
      { mapId: 'desert_base' as const, missionId: 2, stairId: 'bunker_0_stair', expectedRoofDelta: 5.5 },
      { mapId: 'desert_base' as const, missionId: 2, stairId: 'bunker_1_stair', expectedRoofDelta: 5.5 },
      { mapId: 'jungle_zone' as const, missionId: 4, stairId: 'camp_-22_-16_stair', expectedRoofDelta: 4.5 },
      { mapId: 'jungle_zone' as const, missionId: 4, stairId: 'camp_22_-18_stair', expectedRoofDelta: 4.5 },
    ];

    for (const sc of scenarios) {
      const scene = new THREE.Scene();
      const res = new ResourceManager();
      const assets = new AssetManager(res);
      const collision = new CollisionWorld();
      const chunks = new WorldChunkManager();
      const destruction = new DestructionSystem(collision.physicsWorld, {} as never, {} as never);

      buildWorldMap(sc.mapId, sc.missionId, scene, assets, res, collision, chunks, destruction);

      const slopes = collision.getSlopes();
      const f1 = slopes.find((s) => s.id === `${sc.stairId}_flight1`);
      const f2 = slopes.find((s) => s.id === `${sc.stairId}_flight2`);
      expect(f1, `missing ${sc.stairId}_flight1`).toBeDefined();
      expect(f2, `missing ${sc.stairId}_flight2`).toBeDefined();

      // Walk along Flight 1 from bottom to top in 0.24m steps
      const f1StartX = f1!.centerX - f1!.dirX * f1!.halfLength;
      const f1StartZ = f1!.centerZ - f1!.dirZ * f1!.halfLength;
      const f1EndX = f1!.centerX + f1!.dirX * f1!.halfLength;
      const f1EndZ = f1!.centerZ + f1!.dirZ * f1!.halfLength;

      const pos = new THREE.Vector3(f1StartX, collision.getTerrainHeightOnly(f1StartX, f1StartZ), f1StartZ);
      const startY = pos.y;
      const vel = new THREE.Vector3(0, 0, 0);

      const walkToward = (tx: number, tz: number, steps: number) => {
        for (let i = 0; i < steps; i++) {
          const dx = tx - pos.x;
          const dz = tz - pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.15) break;
          const step = Math.min(0.24, dist);
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          vel.y = -0.5;
          collision.resolveCapsule(pos, vel, 0.42, 1.75, 0.55);
        }
      };

      // 1. Ascend Flight 1 onto mid-landing
      walkToward(f1EndX + f1!.dirX * 0.6, f1EndZ + f1!.dirZ * 0.6, 45);
      expect(pos.y, `${sc.stairId} failed to climb Flight 1`).toBeGreaterThan(startY + sc.expectedRoofDelta * 0.4);

      // 2. Traverse mid-landing laterally to Flight 2 start
      const f2StartX = f2!.centerX - f2!.dirX * f2!.halfLength;
      const f2StartZ = f2!.centerZ - f2!.dirZ * f2!.halfLength;
      const f2EndX = f2!.centerX + f2!.dirX * f2!.halfLength;
      const f2EndZ = f2!.centerZ + f2!.dirZ * f2!.halfLength;

      walkToward(f2StartX, f2StartZ, 30);

      // 3. Ascend Flight 2 onto top landing / rooftop elevation
      walkToward(f2EndX + f2!.dirX * 0.6, f2EndZ + f2!.dirZ * 0.6, 45);
      expect(pos.y, `${sc.stairId} failed to reach roof elevation`).toBeGreaterThanOrEqual(
        startY + sc.expectedRoofDelta - 0.35
      );
    }
  });

  it('keeps Mission 2 pipelines, Mission 3 searchlights, and Mission 5 slag channels clear of buildings and lifts', () => {
    const pbrLib = new PbrMaterialLibrary();
    // Mission 2: pipelines & gantry posts must sit outside bunker_0 (x in [-35,-21]) & bunker_1 (x in [21,35])
    const m2Scene = new THREE.Scene();
    const m2Enh = buildMissionEnvironmentEnhancement(m2Scene, 2, pbrLib, () => 0);
    m2Enh.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const px = obj.position.x;
        const pz = obj.position.z;
        const inBunker0 = px >= -35.5 && px <= -20.5 && pz >= -38.5 && pz <= -25.5;
        const inBunker1 = px >= 20.5 && px <= 35.5 && pz >= -42.5 && pz <= -29.5;
        expect(inBunker0, `M2 mesh at (${px}, ${pz}) clipped bunker_0`).toBe(false);
        expect(inBunker1, `M2 mesh at (${px}, ${pz}) clipped bunker_1`).toBe(false);
      }
    });
    m2Enh.dispose();

    // Mission 3: volumetric searchlight pivots must sit on rooftops (y >= 20) clear of building walls
    const m3Scene = new THREE.Scene();
    const m3Enh = buildMissionEnvironmentEnhancement(m3Scene, 3, pbrLib, () => 0);
    const pivots = m3Enh.group.children.filter((c) => c instanceof THREE.Group);
    expect(pivots.length).toBe(2);
    for (const p of pivots) {
      expect(p.position.y).toBeGreaterThanOrEqual(20);
    }
    m3Enh.dispose();

    // Mission 5: molten slag channels must stay clear of cargo lift shafts at x = ±17.6
    const m5Scene = new THREE.Scene();
    const m5Enh = buildMissionEnvironmentEnhancement(m5Scene, 5, pbrLib, () => 0);
    m5Enh.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        expect(Math.abs(obj.position.x)).toBeLessThan(13);
      }
    });
    m5Enh.dispose();
    pbrLib.dispose();
  });

  it('locks canvas size, DPR, and shadow allocations during live combat adaptation (zero blinks & zero GPU stalls)', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 560);
    const vmCamera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 20);
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
    const configureSpy = vi.spyOn(shadowCascades, 'configure');
    const initialCsm = (shadowCascades as unknown as { csm: unknown }).csm;

    const qualityDirector = new RenderingQualityDirector('high_end_desktop');
    for (let i = 0; i < 1200; i++) {
      qualityDirector.recordFrame({ cpuFrameMs: 42, drawCalls: 180, triangles: 240000 });
    }
    expect(qualityDirector.getTelemetry().degradationStep).toBeGreaterThanOrEqual(5);

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

    // Live combat director step-down with lockSurfaceAndShadows: true
    fakeRenderer.applyDirectorDimensions(1.25, null, true, {
      allowCsmRebuild: false,
      deferResize: true,
      lockSurfaceAndShadows: true,
    });
    // Live combat governor step-down with lockSurfaceAndShadows: true
    const gov = new PerformanceGovernor('low', true);
    fakeRenderer.applyGovernorProfile(gov.getProfile(), true, true, null, {
      deferResize: true,
      allowShadowToggle: false,
      lockSurfaceAndShadows: true,
    });

    // Render multiple frames after combat adaptation
    fakeRenderer.renderFrame(false);
    fakeRenderer.renderFrame(false);

    // ZERO canvas/composer resizes (no buffer wipe blink), ZERO shadow reallocations (no freeze)
    expect(setSize).not.toHaveBeenCalled();
    expect(setPixelRatio).not.toHaveBeenCalled();
    expect(composerSetSize).not.toHaveBeenCalled();
    expect(configureSpy).not.toHaveBeenCalled();
    expect((shadowCascades as unknown as { csm: unknown }).csm).toBe(initialCsm);
    // VFX bloom adaptation still took effect cleanly without stalling
    expect(fakeRenderer.getPostProcessState().bloomPassEnabled).toBe(false);
  });
});
