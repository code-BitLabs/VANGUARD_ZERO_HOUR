import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { WorkerBridge } from '@/src/workers/WorkerBridge';
import {
  applyCellUpdates,
  hasGridLineOfSight,
  NAV_GRID_DEFAULTS,
  NavGridState,
  NavigationSolver,
  worldToCellIndex,
} from '@/src/workers/navigationCore';
import { createDestructibleCollider, DestructionSystem } from '@/src/world/DestructionSystem';

function makeEmptyGrid(): NavGridState {
  return {
    width: NAV_GRID_DEFAULTS.width,
    height: NAV_GRID_DEFAULTS.height,
    cellSize: NAV_GRID_DEFAULTS.cellSize,
    originX: NAV_GRID_DEFAULTS.originX,
    originZ: NAV_GRID_DEFAULTS.originZ,
    blocked: new Uint8Array(NAV_GRID_DEFAULTS.width * NAV_GRID_DEFAULTS.height),
  };
}

function setCellBlocked(g: NavGridState, wx: number, wz: number, blocked: 0 | 1): number {
  const idx = worldToCellIndex(wx, wz, g);
  if (idx !== -1) g.blocked[idx] = blocked;
  return idx;
}

describe('TRN-01 Tactical AI Navigation & Cover Intelligence', () => {
  it('TRN-01A: maps [-160m, +160m) half-open bounds accurately and rejects OOB/non-finite queries with -1', () => {
    const g = makeEmptyGrid();

    expect(worldToCellIndex(-160, -160, g)).toBe(0);
    expect(worldToCellIndex(159.99, 159.99, g)).toBe(25599);
    expect(worldToCellIndex(160, 0, g)).toBe(-1);
    expect(worldToCellIndex(0, 160, g)).toBe(-1);
    expect(worldToCellIndex(-160.01, 0, g)).toBe(-1);
    expect(worldToCellIndex(Number.NaN, 0, g)).toBe(-1);
    expect(worldToCellIndex(Number.POSITIVE_INFINITY, 0, g)).toBe(-1);

    const solver = new NavigationSolver();
    solver.initGrid(g.width, g.height, g.cellSize, g.originX, g.originZ, g.blocked);
    expect(solver.oobQueryCount).toBe(0);
    expect(solver.computeNextWaypoint(160, 0, 10, 10)).toBe(false);
    expect(solver.oobQueryCount).toBe(1);
    expect(solver.computeNextWaypoint(0, 0, -160.5, 0)).toBe(false);
    expect(solver.oobQueryCount).toBe(2);
  });

  it('TRN-01B: preserves binary min-heap invariants, handles uint32 wraparound, and recovers partial reachable paths on blocked goals', () => {
    const g = makeEmptyGrid();
    // Seal off a 10m x 10m room around (20, 20)
    for (let z = 14; z <= 26; z += 2) {
      for (let x = 14; x <= 26; x += 2) {
        if (x === 14 || x === 26 || z === 14 || z === 26) {
          setCellBlocked(g, x, z, 1);
        }
      }
    }

    const solver = new NavigationSolver();
    solver.initGrid(g.width, g.height, g.cellSize, g.originX, g.originZ, g.blocked);

    // Force uint32 generation wraparound boundary before search
    solver.setSearchGenerationForTest(0xffffffff);
    const ok = solver.computeNextWaypoint(0, 0, 20, 20, 4096);
    expect(ok).toBe(true);
    expect(solver.getSearchGeneration()).toBe(1);
    expect(solver.lastGoalReached).toBe(false);
    // Must pick a reachable exterior waypoint right outside the [14, 28) sealed perimeter (never inside walls or goal)
    const wx = solver.outWaypoint[0];
    const wz = solver.outWaypoint[1];
    const insideOrOnWalls = wx >= 14 && wx < 28 && wz >= 14 && wz < 28;
    expect(insideOrOnWalls).toBe(false);
    const wpCell = worldToCellIndex(wx, wz, g);
    expect(g.blocked[wpCell]).toBe(0);
    expect(solver.isNodeOpenForTest(wpCell)).toBe(false);
    const heapCheck = solver.inspectHeapForTest();
    expect(heapCheck.heapPosMatches).toBe(true);
    expect(heapCheck.hasDuplicates).toBe(false);

    // Budget exhaustion recovery: limit maxIter to 60 on long detour wall
    const g2 = makeEmptyGrid();
    for (let x = -40; x <= 40; x += 2) {
      setCellBlocked(g2, x, 0, 1);
    }
    solver.initGrid(g2.width, g2.height, g2.cellSize, g2.originX, g2.originZ, g2.blocked);
    solver.computeNextWaypoint(0, 20, 0, -20, 60);
    expect(solver.lastExhaustedBudget).toBe(true);
    expect(solver.lastGoalReached).toBe(false);
    const partialCell = worldToCellIndex(solver.outWaypoint[0], solver.outWaypoint[1], g2);
    expect(g2.blocked[partialCell]).toBe(0);
    // Waypoint must remain on reachable z > 0 side rather than jumping through z=0 wall to (0, -20)
    expect(solver.outWaypoint[1]).toBeGreaterThan(0);
  });

  it('TRN-01B + TRN-01F: routes across jungle river bridge (maxIter=4096) and prevents diagonal corner-clipping', () => {
    const g = makeEmptyGrid();
    // River channel across entire map at z in [10, 20], with 3 bridges at x in [-28, 0, 28] (8m wide)
    for (let cz = 0; cz < g.height; cz++) {
      const wz = g.originZ + (cz + 0.5) * g.cellSize;
      if (wz > 10 && wz < 22) {
        for (let cx = 0; cx < g.width; cx++) {
          const wx = g.originX + (cx + 0.5) * g.cellSize;
          const onBridge = Math.abs(wx) <= 4 || Math.abs(wx + 28) <= 4 || Math.abs(wx - 28) <= 4;
          if (!onBridge) g.blocked[cz * g.width + cx] = 1;
        }
      }
    }

    const solver = new NavigationSolver();
    solver.initGrid(g.width, g.height, g.cellSize, g.originX, g.originZ, g.blocked);
    const ok = solver.computeNextWaypoint(-16, 40, -14, -10, 4096);
    expect(ok).toBe(true);
    expect(solver.lastGoalReached).toBe(true);
    expect(solver.lastIterations).toBeLessThanOrEqual(4096);
    // Verify Bresenham corner-clip prevention directly on a blocked orthogonal corner
    const cGrid = makeEmptyGrid();
    const b1 = setCellBlocked(cGrid, 3, 1, 1);
    expect(b1).not.toBe(-1);
    const cx0 = Math.floor((1 - cGrid.originX) / cGrid.cellSize);
    const cz0 = Math.floor((1 - cGrid.originZ) / cGrid.cellSize);
    const cx1 = Math.floor((3 - cGrid.originX) / cGrid.cellSize);
    const cz1 = Math.floor((3 - cGrid.originZ) / cGrid.cellSize);
    expect(hasGridLineOfSight(cx0, cz0, cx1, cz1, cGrid)).toBe(false);

    // Open corridor string-pulling aims directly at visible goal rather than staircase step
    solver.initGrid(cGrid.width, cGrid.height, cGrid.cellSize, cGrid.originX, cGrid.originZ, cGrid.blocked);
    solver.computeNextWaypoint(-10, -10, -10, -40);
    expect(solver.outWaypoint[0]).toBeCloseTo(-10, 2);
    expect(solver.outWaypoint[1]).toBeCloseTo(-40, 2);
  });

  it('TRN-01C: incrementally unblocks destroyed barrier cells in navgrid and fires DestructionSystem callback', () => {
    const g = makeEmptyGrid();
    // Blocking wall along z = 0 with a destructible barrier at x = 0..4
    const destructibleCells: number[] = [];
    for (let x = -30; x <= 30; x += 2) {
      const idx = setCellBlocked(g, x, 0, 1);
      if (x >= -1 && x <= 3) destructibleCells.push(idx);
    }

    const solver = new NavigationSolver();
    solver.initGrid(g.width, g.height, g.cellSize, g.originX, g.originZ, g.blocked);
    solver.computeNextWaypoint(1, 10, 1, -10);
    // Detour around intact wall forces large X offset
    expect(Math.abs(solver.outWaypoint[0])).toBeGreaterThan(8);

    // Destroy barrier -> compact [cellIdx, 0] pair update
    const updates = new Uint16Array(destructibleCells.length * 2);
    destructibleCells.forEach((cellIdx, i) => {
      updates[i * 2] = cellIdx;
      updates[i * 2 + 1] = 0;
    });
    expect(applyCellUpdates(updates, g)).toBe(destructibleCells.length);

    solver.computeNextWaypoint(1, 10, 1, -10);
    expect(solver.lastGoalReached).toBe(true);
    expect(Math.abs(solver.outWaypoint[0] - 1)).toBeLessThan(1.5);
    expect(solver.outWaypoint[1]).toBeCloseTo(-10, 1);

    // Verify DestructionSystem fires unified collider-region callback when destroyed
    const cw = new CollisionWorld();
    const scene = new THREE.Scene();
    const rm = new ResourceManager();
    const vfx = new VFXPool(scene, rm);
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const ds = new DestructionSystem(cw.physicsWorld, vfx, audio);
    const changedRegions: string[] = [];
    ds.setOnColliderRegionChanged((box) => changedRegions.push(box.id));
    ds.register({
      id: 'destructible_test_barrier',
      kind: 'destructible_barrier',
      isObjectiveTarget: false,
      position: new THREE.Vector3(0, 0, 0),
      health: 50,
      maxHealth: 50,
      state: 'INTACT',
      blastRadius: 0,
      blastDamage: 0,
      meshGroup: new THREE.Group(),
      collider: createDestructibleCollider('destructible_test_barrier', 0, 0, 0, 2, 1.5, 0.8),
    });
    ds.applyDamage('destructible_test_barrier', 60);
    expect(changedRegions).toContain('destructible_test_barrier');
  });

  it('TRN-01D: selects LOS-verified leeward cover, rejects exposed nodes, and enforces >= 2.2m squad separation', () => {
    const cw = new CollisionWorld();
    cw.setTerrainHeightFn(() => 0);

    // Barrier A occludes threat at (0, 0, 30) from node at (0, 0, 12)
    cw.addStaticBox({
      id: 'cover_A',
      minX: -2.2,
      minY: 0,
      minZ: 12.6,
      maxX: 2.2,
      maxY: 1.5,
      maxZ: 14.0,
      layer: COLLISION_LAYER.COVER,
      tag: 'cover_barrier',
    });
    // Barrier B at x = 8 occludes threat at (0, 0, 30) from node at (8, 0, 12)
    cw.addStaticBox({
      id: 'cover_B',
      minX: 5.8,
      minY: 0,
      minZ: 12.6,
      maxX: 10.2,
      maxY: 1.5,
      maxZ: 14.0,
      layer: COLLISION_LAYER.COVER,
      tag: 'cover_barrier',
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

    em.spawnWave('infantry', 2, { x: 0, y: 0, z: 6 }, 2, cw, 'mission:1', 'squad_alpha');
    const [u1, u2] = em.getUnits();
    const threatPos = new THREE.Vector3(0, 0, 30);

    // Exposed node in open field (no barrier in front) must be rejected
    const exposedOnly = [new THREE.Vector3(-14, 0, 12)];
    expect(em.findTacticalCover(u1, exposedOnly, threatPos, false, cw)).toBeNull();

    // Two occluded nodes: u1 claims A, u2 must pick B (>= 2.2m apart)
    const nodes = [new THREE.Vector3(0, 0, 12), new THREE.Vector3(8, 0, 12)];
    const c1 = em.findTacticalCover(u1, nodes, threatPos, false, cw);
    expect(c1).not.toBeNull();
    u1.coverTarget = c1;

    const c2 = em.findTacticalCover(u2, nodes, threatPos, false, cw);
    expect(c2).not.toBeNull();
    expect(c1!.distanceTo(c2!)).toBeGreaterThanOrEqual(2.2);
  });

  it('TRN-01E: flanker units use 3-ray whiskers + wall tangent sliding to navigate L-shaped obstacle without stalling', () => {
    const cw = new CollisionWorld();
    cw.setTerrainHeightFn(() => 0);
    // L-shaped wall blocking direct flank trajectory around z = 0
    cw.addStaticBox({
      id: 'l_wall_h',
      minX: -4,
      minY: 0,
      minZ: -0.6,
      maxX: 4,
      maxY: 3.0,
      maxZ: 0.6,
      layer: COLLISION_LAYER.WORLD,
      tag: 'building_wall',
    });
    cw.addStaticBox({
      id: 'l_wall_v',
      minX: 3.2,
      minY: 0,
      minZ: -5,
      maxX: 4.4,
      maxY: 3.0,
      maxZ: 0.6,
      layer: COLLISION_LAYER.WORLD,
      tag: 'building_wall',
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

    const player = new PlayerController(audio);
    player.spawn(0, 0, -18, 0);

    em.spawnWave('elite_assault', 1, { x: 0, y: 0, z: 3.2 }, 0, cw, 'mission:1', 'squad_flank');
    const unit = em.getUnits()[0];
    unit.state = 'REPOSITIONING';
    unit.stateTimerSec = 5.0;
    unit.lastKnownPosition = new THREE.Vector3(0, 0, -18);
    unit.initialGraceTimerSec = 0;

    const stubWorker = { isHealthy: () => false, requestPaths: async () => null } as unknown as WorkerBridge;
    const startPos = unit.position.clone();
    let maxConsecutiveStallSec = 0;
    let curStallSec = 0;

    for (let i = 0; i < 120; i++) {
      const prevX = unit.position.x;
      const prevZ = unit.position.z;
      em.update(1 / 60, player, cw, [], stubWorker, 0.1);
      const stepDist = Math.hypot(unit.position.x - prevX, unit.position.z - prevZ);
      if (unit.isMoving && stepDist < 0.005) {
        curStallSec += 1 / 60;
        if (curStallSec > maxConsecutiveStallSec) maxConsecutiveStallSec = curStallSec;
      } else {
        curStallSec = 0;
      }
    }

    expect(unit.position.distanceTo(startPos)).toBeGreaterThan(2.0);
    expect(maxConsecutiveStallSec).toBeLessThan(0.5);
  });

  it('TRN-01 Performance Benchmark: measures A* query latency and 15-enemy EnemyManager.update() tick CPU', () => {
    const g = makeEmptyGrid();
    // River + bridges map for realistic complex detour workload
    for (let cz = 0; cz < g.height; cz++) {
      const wz = g.originZ + (cz + 0.5) * g.cellSize;
      if (wz > 10 && wz < 22) {
        for (let cx = 0; cx < g.width; cx++) {
          const wx = g.originX + (cx + 0.5) * g.cellSize;
          const onBridge = Math.abs(wx) <= 4 || Math.abs(wx + 28) <= 4 || Math.abs(wx - 28) <= 4;
          if (!onBridge) g.blocked[cz * g.width + cx] = 1;
        }
      }
    }
    // Add sealed goal room for unreachable recovery benchmark
    for (let z = -66; z <= -54; z += 2) {
      for (let x = 54; x <= 66; x += 2) {
        if (x === 54 || x === 66 || z === -66 || z === -54) setCellBlocked(g, x, z, 1);
      }
    }

    const solver = new NavigationSolver();
    solver.initGrid(g.width, g.height, g.cellSize, g.originX, g.originZ, g.blocked);

    // Warmup JIT
    for (let i = 0; i < 20; i++) {
      solver.computeNextWaypoint(-16, 40, -14, -10);
    }

    const tOpen0 = performance.now();
    for (let i = 0; i < 200; i++) {
      solver.computeNextWaypoint(-10, -20, 12, -52);
    }
    const openMsPerQuery = (performance.now() - tOpen0) / 200;

    const tDetour0 = performance.now();
    for (let i = 0; i < 100; i++) {
      solver.computeNextWaypoint(-80, 40, -80, -40);
    }
    const detourMsPerQuery = (performance.now() - tDetour0) / 100;
    const detourIters = solver.lastIterations;

    const tUnreach0 = performance.now();
    for (let i = 0; i < 25; i++) {
      solver.computeNextWaypoint(0, 40, 60, -60, 4096);
    }
    const unreachMsPerQuery = (performance.now() - tUnreach0) / 25;

    // 15-enemy EnemyManager.update() benchmark
    const cw = new CollisionWorld();
    cw.setTerrainHeightFn(() => 0);
    cw.addStaticBox({
      id: 'bench_cover',
      minX: -3,
      minY: 0,
      minZ: 10,
      maxX: 3,
      maxY: 1.5,
      maxZ: 11.4,
      layer: COLLISION_LAYER.COVER,
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
    const player = new PlayerController(audio);
    player.spawn(0, 0, 35, 0);
    em.spawnWave('infantry', 15, { x: 0, y: 0, z: 0 }, 14, cw, 'mission:1');
    for (const u of em.getUnits()) {
      u.state = 'ENGAGING';
      u.initialGraceTimerSec = 0;
      u.lastKnownPosition = player.position.clone();
    }
    const stubWorker = { isHealthy: () => false, requestPaths: async () => null } as unknown as WorkerBridge;
    const coverNodes = [new THREE.Vector3(0, 0, 9), new THREE.Vector3(10, 0, 9)];

    const tAi0 = performance.now();
    for (let f = 0; f < 60; f++) {
      em.update(1 / 60, player, cw, coverNodes, stubWorker, 0.1);
    }
    const aiMsPerTick = (performance.now() - tAi0) / 60;

    console.info(
      `[TRN-01 BENCHMARK] open=${openMsPerQuery.toFixed(4)}ms, river_detour=${detourMsPerQuery.toFixed(4)}ms (iters=${detourIters}), unreach_partial=${unreachMsPerQuery.toFixed(4)}ms, ai_15_units=${aiMsPerTick.toFixed(4)}ms/tick`
    );

    expect(openMsPerQuery).toBeLessThan(1.0);
    expect(detourMsPerQuery).toBeLessThan(2.0);
    expect(aiMsPerTick).toBeLessThan(2.5);
  });
});
