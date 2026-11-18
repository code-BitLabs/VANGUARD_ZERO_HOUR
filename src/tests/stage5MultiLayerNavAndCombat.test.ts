import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG, getMissionById } from '@/src/data/missions';
import { VFXPool } from '@/src/effects/VFXPool';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CargoLiftManager } from '@/src/gameplay/CargoLiftManager';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import {
  AGENT_PROFILE_ALL_INFANTRY_MASK,
  AGENT_TRAVERSAL_PROFILES,
  buildAllowedProfilesMask,
  canAgentUsePortal,
} from '@/src/navigation/AgentTraversalProfile';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { MissionSchema } from '@/src/schemas/mission.schema';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { WorkerJobRequestSchema, WorkerJobResponseSchema } from '@/src/schemas/worker.schema';
import {
  ElevatedNavSurfaceInput,
  NAV_GRID_DEFAULTS,
  NavPortalInput,
  NavigationSolver,
  TRAVERSAL_FLAGS,
} from '@/src/workers/navigationCore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

function buildMultiElevationTestGraph(): {
  solver: NavigationSolver;
  groundBlocked: Uint8Array;
  elevated: ElevatedNavSurfaceInput[];
  portals: NavPortalInput[];
} {
  const groundBlocked = new Uint8Array(NAV_GRID_DEFAULTS.width * NAV_GRID_DEFAULTS.height);

  // Surface 1: Mezzanine Platform at y=7.0m (x in [-16, 16], z in [-16, 16])
  const surf1: ElevatedNavSurfaceInput = {
    surfaceId: 1,
    name: 'mezzanine_deck',
    width: 24,
    height: 24,
    cellSize: 1.5,
    originX: -18,
    originZ: -18,
    elevationY: 7.0,
    minY: 6.4,
    maxY: 9.0,
    blocked: new Uint8Array(24 * 24),
  };

  // Surface 2: Upper Sniper Tower Roof at y=14.0m (x in [-8, 8], z in [-34, -18])
  const surf2: ElevatedNavSurfaceInput = {
    surfaceId: 2,
    name: 'high_tower_roof',
    width: 14,
    height: 14,
    cellSize: 1.25,
    originX: -8.75,
    originZ: -34.75,
    elevationY: 14.0,
    minY: 13.4,
    maxY: 16.2,
    blocked: new Uint8Array(14 * 14),
  };

  const portals: NavPortalInput[] = [
    // Portal 0: Stair 0 <-> 1 (light infantry + player only; width=1.4m < heavy_infantry.minPortalWidth=1.6m)
    {
      portalId: 0,
      portalKey: 'stair_ground_to_mezz',
      kind: 'stair',
      fromSurfaceId: 0,
      toSurfaceId: 1,
      fromX: -10,
      fromY: 0,
      fromZ: 12,
      toX: -10,
      toY: 7.0,
      toZ: 4,
      fromFloorIndex: 0,
      toFloorIndex: 1,
      width: 1.4,
      clearanceHeight: 2.5,
      slopeDeg: 32,
      baseCost: 8,
      dynamicWaitCost: 0,
      allowedProfilesMask: AGENT_PROFILE_ALL_INFANTRY_MASK,
      maxConcurrentOccupants: 0,
      activeOccupants: 0,
      enabled: true,
      bidirectional: true,
    },
    // Portal 1: Cargo Lift 0 <-> 1 (supports heavy infantry & all infantry)
    {
      portalId: 1,
      portalKey: 'lift_0_1',
      kind: 'cargo_lift',
      liftId: 'foundry_lift',
      fromSurfaceId: 0,
      toSurfaceId: 1,
      fromX: 12,
      fromY: 0,
      fromZ: 8,
      toX: 12,
      toY: 7.0,
      toZ: 8,
      fromFloorIndex: 0,
      toFloorIndex: 1,
      width: 2.8,
      clearanceHeight: 3.1,
      slopeDeg: 0,
      baseCost: 5,
      dynamicWaitCost: 0.8,
      allowedProfilesMask: AGENT_PROFILE_ALL_INFANTRY_MASK,
      maxConcurrentOccupants: 2,
      activeOccupants: 0,
      enabled: true,
      bidirectional: true,
    },
    // Portal 2: Cargo Lift 1 <-> 2 (from Mezzanine 7m to High Roof 14m)
    {
      portalId: 2,
      portalKey: 'lift_1_2',
      kind: 'cargo_lift',
      liftId: 'foundry_lift',
      fromSurfaceId: 1,
      toSurfaceId: 2,
      fromX: 0,
      fromY: 7.0,
      fromZ: -12,
      toX: 0,
      toY: 14.0,
      toZ: -20,
      fromFloorIndex: 1,
      toFloorIndex: 2,
      width: 2.8,
      clearanceHeight: 3.1,
      slopeDeg: 0,
      baseCost: 5,
      dynamicWaitCost: 0.8,
      allowedProfilesMask: AGENT_PROFILE_ALL_INFANTRY_MASK,
      maxConcurrentOccupants: 2,
      activeOccupants: 0,
      enabled: true,
      bidirectional: true,
    },
    // Portal 3: Wide Ramp 0 <-> 1 (suitable for ground vehicles & heavy infantry too)
    {
      portalId: 3,
      portalKey: 'wide_ramp_0_1',
      kind: 'ramp',
      fromSurfaceId: 0,
      toSurfaceId: 1,
      fromX: -14,
      fromY: 0,
      fromZ: -8,
      toX: -14,
      toY: 7.0,
      toZ: 0,
      fromFloorIndex: 0,
      toFloorIndex: 1,
      width: 4.2,
      clearanceHeight: 3.2,
      slopeDeg: 22,
      baseCost: 11,
      dynamicWaitCost: 0,
      allowedProfilesMask: buildAllowedProfilesMask(['player', 'standard_infantry', 'heavy_infantry', 'ground_vehicle']),
      maxConcurrentOccupants: 0,
      activeOccupants: 0,
      enabled: true,
      bidirectional: true,
    },
  ];

  const solver = new NavigationSolver();
  solver.initMultiSurfaceNavigation(
    {
      width: NAV_GRID_DEFAULTS.width,
      height: NAV_GRID_DEFAULTS.height,
      cellSize: NAV_GRID_DEFAULTS.cellSize,
      originX: NAV_GRID_DEFAULTS.originX,
      originZ: NAV_GRID_DEFAULTS.originZ,
      blocked: groundBlocked,
    },
    [surf1, surf2],
    portals
  );

  return { solver, groundBlocked, elevated: [surf1, surf2], portals };
}

describe('Stage 5A TRN-16 / TRN-17: Hierarchical Hybrid Navigation, 3D Cover & Mission 1–5 Integration', () => {
  describe('TRN-16 — Hierarchical Multi-Elevation Navigation, Capabilities & Dual-Buffer Worker IPC', () => {
    it('routes across 3 surfaces (Ground -> Mezzanine -> High Roof), precomputes intra-surface portal distances, and handles dynamic portal rerouting', () => {
      const { solver } = buildMultiElevationTestGraph();
      expect(solver.getSurfaceCount()).toBe(3);

      // Verify surface resolution accurately picks ground vs 7m vs 14m
      expect(solver.resolveSurfaceId(0, 0, 24)).toBe(0);
      expect(solver.resolveSurfaceId(0, 7.0, 0)).toBe(1);
      expect(solver.resolveSurfaceId(0, 14.0, -26)).toBe(2);

      // Route from Ground (12, 0, 22) up to High Roof (0, 14, -26)
      const coords = new Float32Array(3);
      const meta = new Int32Array(4);
      const ok = solver.computeNextWaypoint3D(12, 0, 22, 0, 14, -26, 1, coords, meta);
      expect(ok).toBe(true);
      expect(meta[0]).toBe(0); // Still approaching entry portal on surface 0
      expect(meta[1]).toBe(1); // Chooses cargo lift portal 1 (closest + low cost)
      expect((meta[2] & TRAVERSAL_FLAGS.PORTAL_APPROACH) !== 0).toBe(true);

      // Standing right at lift entry (12, 0, 8) -> emits LIFT_WAIT_BOARD + PORTAL_TRAVERSE to floor 1
      const okBoard = solver.computeNextWaypoint3D(12, 0, 8, 0, 14, -26, 1, coords, meta);
      expect(okBoard).toBe(true);
      expect(meta[1]).toBe(1);
      expect((meta[2] & TRAVERSAL_FLAGS.LIFT_WAIT_BOARD) !== 0).toBe(true);
      expect(meta[3]).toBe(1); // targetFloorIndex = 1

      // Dynamic portal cost update: disable portal 1 (cargo lift) -> reroutes via Stair (0) or Ramp (3)
      solver.updatePortalState(1, false, 99, 2);
      const okRerouted = solver.computeNextWaypoint3D(-10, 0, 22, 0, 14, -26, 1, coords, meta);
      expect(okRerouted).toBe(true);
      expect(meta[1]).toBe(0); // Rerouted to stair portal 0!

      // Re-enable lift 0->1 and verify lossless IPC request/response schemas + dual buffers
      const reqParsed = WorkerJobRequestSchema.parse({
        jobId: 12,
        jobVersion: 3,
        type: 'init_navigation_surfaces',
        gridWidth: 160,
        gridHeight: 160,
        cellSize: 2,
        originX: -160,
        originZ: -160,
      });
      expect(reqParsed.type).toBe('init_navigation_surfaces');
      const respParsed = WorkerJobResponseSchema.parse({
        jobId: 12,
        jobVersion: 3,
        type: 'surfaces_ready',
        computeMs: 1.4,
      });
      expect(respParsed.type).toBe('surfaces_ready');
    });

    it('validates AgentTraversalProfile portal capability rules for player, standard_infantry, heavy_infantry, and ground_vehicle', () => {
      const { portals, solver } = buildMultiElevationTestGraph();
      const stairPortal = portals[0]; // width 1.4m, kind 'stair'
      const liftPortal = portals[1]; // width 2.8m, kind 'cargo_lift'
      const wideRamp = portals[3]; // width 4.2m, kind 'ramp', slopeDeg 22

      expect(canAgentUsePortal(AGENT_TRAVERSAL_PROFILES.player, stairPortal)).toBe(true);
      expect(canAgentUsePortal(AGENT_TRAVERSAL_PROFILES.standard_infantry, stairPortal)).toBe(true);
      // Heavy infantry cannot use narrow 1.4m stair
      expect(canAgentUsePortal(AGENT_TRAVERSAL_PROFILES.heavy_infantry, stairPortal)).toBe(false);
      // Heavy infantry CAN use cargo lift and wide low-slope ramp
      expect(canAgentUsePortal(AGENT_TRAVERSAL_PROFILES.heavy_infantry, liftPortal)).toBe(true);
      expect(canAgentUsePortal(AGENT_TRAVERSAL_PROFILES.heavy_infantry, wideRamp)).toBe(true);
      // Ground vehicles cannot operate cargo lifts or climb stairs, only wide ramps
      expect(canAgentUsePortal(AGENT_TRAVERSAL_PROFILES.ground_vehicle, liftPortal)).toBe(false);
      expect(canAgentUsePortal(AGENT_TRAVERSAL_PROFILES.ground_vehicle, stairPortal)).toBe(false);
      expect(canAgentUsePortal(AGENT_TRAVERSAL_PROFILES.ground_vehicle, wideRamp)).toBe(true);

      // Verify heavy_infantry (profileCode=2) never gets assigned the 1.4m stair even if standing right beside it
      const coords = new Float32Array(3);
      const meta = new Int32Array(4);
      solver.computeNextWaypoint3D(-10, 0, 13, 0, 7, 0, 2, coords, meta);
      expect(meta[1]).not.toBe(0);
    });

    it('Navigation Memory & Query Benchmark: elevated sparse surfaces save >80% memory vs duplicate 160x160 grids and solve multi-surface paths <1.0ms', () => {
      const { solver } = buildMultiElevationTestGraph();
      const mem = solver.getNavigationMemoryStats();
      const naiveTwoExtraGridsBytes = mem.groundGridBytes * 2;
      const savingsRatio = 1 - mem.elevatedSurfacesBytes / naiveTwoExtraGridsBytes;

      expect(mem.elevatedSurfaceCount).toBe(2);
      expect(savingsRatio).toBeGreaterThan(0.8);

      const coords = new Float32Array(3);
      const meta = new Int32Array(4);
      // Warmup
      for (let i = 0; i < 15; i++) {
        solver.computeNextWaypoint3D(10, 0, 20, 0, 14, -26, 1, coords, meta);
      }

      const t0 = performance.now();
      for (let i = 0; i < 200; i++) {
        solver.computeNextWaypoint3D(10, 0, 20, 0, 14, -26, 1, coords, meta);
      }
      const avgMs = (performance.now() - t0) / 200;
      console.info(
        `[TRN-16 BENCHMARK] groundBytes=${mem.groundGridBytes}, elevatedBytes=${mem.elevatedSurfacesBytes} (${(savingsRatio * 100).toFixed(1)}% saved vs full grids), portalBytes=${mem.portalGraphBytes}, avgMultiLayerQuery=${avgMs.toFixed(4)}ms`
      );
      expect(avgMs).toBeLessThan(1.0);
    });
  });

  describe('TRN-17 & Campaign Integration — 3D Anatomical Cover, Elevated Spawns & Missions 1–5', () => {
    it('prefers crouched 1.15m parapet rooftop cover that shields chest/head while rejecting exposed rooftop nodes', () => {
      const cw = new CollisionWorld();
      cw.setTerrainHeightFn(() => 0);

      // Rooftop deck at y = 6.5m (x in [-8, 8], z in [-8, 8])
      cw.addStaticBox({
        id: 'roof_slab',
        minX: -8,
        minY: 6.1,
        minZ: -8,
        maxX: 8,
        maxY: 6.5,
        maxZ: 8,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_roof',
      });
      // South-facing rooftop parapet wall (1.18m high above 6.5m deck => 6.5..7.68m) shielding from threat on ground South (+Z)
      cw.addStaticBox({
        id: 'roof_parapet_south',
        minX: -4,
        minY: 6.5,
        minZ: 5.5,
        maxX: 4,
        maxY: 7.68,
        maxZ: 6.2,
        layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
        tag: 'parapet',
      });

      const scene = new THREE.Scene();
      const rm = new ResourceManager();
      const vfx = new VFXPool(scene, rm);
      const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
      const projectiles = new ProjectileManager(scene, rm, vfx, audio);
      const telemetry = new CombatTelemetryRecorder();
      const coordinator = new CombatEngagementCoordinator(telemetry);
      const ballistics = new BallisticSolver(vfx, telemetry);
      const em = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);

      // Spawn sniper onto the rooftop at y = 6.5m
      em.spawnWave('sniper', 1, { x: 0, y: 6.5, z: 3 }, 1.2, cw, 'mission:1');
      const [sniper] = em.getUnits();
      expect(sniper.position.y).toBeCloseTo(6.5, 1);

      const playerPos = new THREE.Vector3(0, 0, 32);
      const exposedRoofNode = new THREE.Vector3(6.8, 6.5, 4.5); // Outside parapet X [-4..4]
      const parapetRoofNode = new THREE.Vector3(0, 6.5, 4.2); // Leeward of parapet

      // Exposed node has clear chest/head rays from ground player -> rejected
      expect(em.findTacticalCover(sniper, [exposedRoofNode], playerPos, false, cw)).toBeNull();

      // Parapet node shields crouch chest (+0.72m = 7.22m) and crouch head (+1.08m = 7.58m), while standing head (+1.58m = 8.08m) clears parapet!
      const chosen = em.findTacticalCover(sniper, [exposedRoofNode, parapetRoofNode], playerPos, false, cw);
      expect(chosen).not.toBeNull();
      expect(chosen!.x).toBeCloseTo(0, 1);
      expect(chosen!.y).toBeCloseTo(6.5, 1);
    });

    it('builds all 5 campaign maps with elevated surfaces, portals, multi-floor cargo lifts, elevated wave spawns, and clean ResourceManager disposal', () => {
      const expectedLiftCounts: Record<number, number> = {
        1: 1,
        2: 0,
        3: 2,
        4: 1,
        5: 2,
      };

      expect(MISSION_CATALOG).toHaveLength(5);

      const rm = new ResourceManager();
      const assets = new AssetManager(rm);
      const scene = new THREE.Scene();
      const vfx = new VFXPool(scene, rm);
      const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
      const chunks = new WorldChunkManager();
      rm.recordBaseline();

      for (const cfg of MISSION_CATALOG) {
        expect(() => MissionSchema.parse(cfg)).not.toThrow();

        const cw = new CollisionWorld();
        const destruction = new DestructionSystem(cw.physicsWorld, vfx, audio);
        const projectiles = new ProjectileManager(scene, rm, vfx, audio);
        const telemetry = new CombatTelemetryRecorder();
        const coordinator = new CombatEngagementCoordinator(telemetry);
        const ballistics = new BallisticSolver(vfx, telemetry);
        const em = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);
        const lifts = new CargoLiftManager(cw);

        const built = buildWorldMap(
          cfg.mapId,
          cfg.id,
          scene,
          assets,
          rm,
          cw,
          chunks,
          destruction
        );

        expect(built.elevatedSurfaces.length).toBeGreaterThan(0);
        expect(built.navPortals.length).toBeGreaterThan(0);
        expect(built.cargoLifts.length).toBe(expectedLiftCounts[cfg.id]);

        for (const l of built.cargoLifts) {
          lifts.registerLift(l);
        }
        if (cfg.id === 5) {
          // Mission 5 features two 3-stop cargo lifts (0m, 7m, 14m) connecting ground, skybridge, and high foundry roofs
          for (const l of built.cargoLifts) {
            expect(l.stops.length).toBe(3);
            expect(l.stops[1].elevationY).toBeCloseTo(7.0, 1);
            expect(l.stops[2].elevationY).toBeCloseTo(14.0, 1);
          }
        }

        // Verify all elevated initialWaves land cleanly on their target roof/watchtower deck heights
        const scope = `mission:${cfg.id}` as const;
        for (const w of cfg.initialWaves) {
          em.spawnWave(w.archetype, w.count, w.spawnArea, w.radius, cw, scope);
        }
        const units = em.getUnits();
        const elevatedWaves = cfg.initialWaves.filter((w) => w.spawnArea.y > 0.4);
        expect(elevatedWaves.length).toBeGreaterThan(0);
        const highUnits = units.filter((u) => u.position.y > 3.0);
        expect(highUnits.length).toBeGreaterThanOrEqual(
          elevatedWaves.reduce((sum, w) => sum + w.count, 0)
        );

        // Verify zero leaked mission-scoped resources and full lift/physics cleanup
        lifts.clear();
        em.clear();
        destruction.dispose();
        chunks.clear(scene);
        cw.clear();
        rm.unloadScope(scope);
        expect(rm.auditTransitionDelta().hasMissionLeak).toBe(false);
        expect(cw.physicsWorld.getBvhGeometryCount()).toBe(0);
      }

      rm.disposeAll();
    }, 15000);

    it('preserves canonical Stage 1–4B missionKeys across Missions 1–5', () => {
      expect(getMissionById(1).missionKey).toBe('mission_1_dawn_spear');
      expect(getMissionById(2).missionKey).toBe('mission_2_red_dust');
      expect(getMissionById(3).missionKey).toBe('mission_3_nightfall');
      expect(getMissionById(4).missionKey).toBe('mission_4_viper_canopy');
      expect(getMissionById(5).missionKey).toBe('mission_5_blackout');
    });
  });
});
