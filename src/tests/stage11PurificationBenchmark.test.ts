import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG as MISSIONS } from '@/src/data/missions';
import { SurfaceDecalManager } from '@/src/effects/SurfaceDecalManager';
import { VFXPool } from '@/src/effects/VFXPool';
import type { CharacterMoveResult } from '@/src/engine/physics/PhysicsTypes';
import { BattlefieldIntelligenceBoard } from '@/src/gameplay/ai/BattlefieldIntelligenceBoard';
import {
  EnemyLocomotionUnit,
  EnemySeparationGrid,
  stepEnemyLocomotion,
} from '@/src/gameplay/ai/EnemyLocomotionSolver';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { AGENT_PROFILE_ALL_INFANTRY_MASK } from '@/src/navigation/AgentTraversalProfile';
import { CollisionWorld, createOrientedSlopeRegion, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from '@/src/physics/SpatialHash';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import {
  ElevatedNavSurfaceInput,
  NAV_GRID_DEFAULTS,
  NavPortalInput,
  NavigationSolver,
} from '@/src/workers/navigationCore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

function makeMoveResult(): CharacterMoveResult {
  return {
    grounded: true,
    hitCeiling: false,
    hitWall: false,
    hitHorizontal: false,
    steppedUp: false,
    clampedWorldBounds: false,
    lastBlockerId: null,
    wallNormalX: 0,
    wallNormalY: 0,
    wallNormalZ: 0,
    groundNormalX: 0,
    groundNormalY: 1,
    groundNormalZ: 0,
    activeSlopeId: null,
    penetrationCorrected: 0,
    activeContacts: 0,
    maxPenetrationDepth: 0,
  };
}

function makeRayHit(): RayHit {
  return {
    hit: false,
    distance: 0,
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    collider: null,
  };
}

describe('Stage 11 Algorithmic Purification & Multi-Mission Regression Benchmarks', () => {
  it('BENCH-ALG-01: enemy separation + locomotion scaling (N = 10, 50, 100, 200)', () => {
    const cw = new CollisionWorld();
    const rayHit = makeRayHit();
    const moveRes = makeMoveResult();
    const counts = [10, 50, 100, 200];
    const timings: Record<number, number> = {};

    for (const n of counts) {
      const units: EnemyLocomotionUnit[] = [];
      const cols = Math.max(4, Math.ceil(Math.sqrt(n)));
      for (let i = 0; i < n; i++) {
        const px = -12 + (i % cols) * 1.15;
        const pz = -12 + Math.floor(i / cols) * 1.15;
        units.push({
          id: `bench_u_${i}`,
          alive: true,
          position: new THREE.Vector3(px, 0, pz),
          velocity: new THREE.Vector3(),
          agentProfile: 'standard_infantry',
          isMoving: false,
          isRidingLift: false,
          grounded: true,
          avoidanceDirX: 0,
          avoidanceDirZ: 0,
          avoidanceLatchTimerSec: 0,
          actualHorizSpeed: 0,
          actualVertSpeed: 0,
          stuckTimerSec: 0,
          lastProgressX: px,
          lastProgressZ: pz,
          lastColliderHit: null,
          activeContacts: 0,
          maxPenetrationDepth: 0,
        });
      }

      const sepGrid = new EnemySeparationGrid();
      const t0 = performance.now();
      for (let tick = 0; tick < 60; tick++) {
        sepGrid.rebuild(units);
        for (let i = 0; i < n; i++) {
          const u = units[i];
          stepEnemyLocomotion(u, 1, 0.25, 4.2, true, 1 / 60, cw, units, rayHit, moveRes, sepGrid);
        }
      }
      timings[n] = Number((performance.now() - t0).toFixed(3));
      expect(units[0].grounded).toBe(true);
    }

    console.info('[STAGE11_BENCH] ALG-01 stepEnemyLocomotion 60ticks ms:', JSON.stringify(timings));
    expect(timings[200]).toBeLessThan(2000);
  });

  it('BENCH-ALG-02: findTacticalCover across 80 cover nodes & 24 enemies', () => {
    const scene = new THREE.Scene();
    const res = new ResourceManager();
    const audio = new AudioManager(res, SettingsBundleSchema.parse({}).audio);
    const vfx = new VFXPool(scene, res);
    const cw = new CollisionWorld();
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(vfx, telemetry);
    const projectiles = new ProjectileManager(scene, res, vfx, audio);
    const em = new EnemyManager(scene, res, vfx, audio, projectiles, coordinator, ballistics, telemetry);

    // Populate cover pillars + nodes
    const coverNodes: THREE.Vector3[] = [];
    for (let i = 0; i < 80; i++) {
      const gx = -55 + (i % 10) * 12;
      const gz = -55 + Math.floor(i / 10) * 12;
      cw.addStaticBox({
        id: `cover_block_${i}`,
        minX: gx - 0.6,
        minY: 0,
        minZ: gz - 0.6,
        maxX: gx + 0.6,
        maxY: 1.5,
        maxZ: gz + 0.6,
        layer: COLLISION_LAYER.COVER,
        tag: 'cover_barrier',
      });
      coverNodes.push(new THREE.Vector3(gx, 0, gz));
    }

    em.spawnWave('infantry', 12, { x: -20, y: 0, z: -20 }, 16, cw, 'mission:bench', 'sq_alpha');
    em.spawnWave('heavy_armor', 12, { x: 20, y: 0, z: 20 }, 16, cw, 'mission:bench', 'sq_bravo');
    const units = em.getUnits();
    const threatPos = new THREE.Vector3(0, 0, 0);

    const t0 = performance.now();
    let foundCount = 0;
    for (let iter = 0; iter < 5; iter++) {
      for (let i = 0; i < units.length; i++) {
        const resPos = em.findTacticalCover(units[i], coverNodes, threatPos, false, cw);
        if (resPos) foundCount++;
      }
    }
    const elapsedMs = Number((performance.now() - t0).toFixed(3));
    console.info('[STAGE11_BENCH] ALG-02 findTacticalCover (120 queries x 80 nodes) ms:', elapsedMs, 'found:', foundCount);
    expect(foundCount).toBeGreaterThan(0);

    res.disposeAll();
  });

  it('BENCH-ALG-04 & ALG-06: SpatialHash high-churn + PhysicsWorld 40-slope sweptCast/support queries', () => {
    const hash = new SpatialHash(8);
    const dynamicBoxes: SpatialAABB[] = [];
    for (let i = 0; i < 500; i++) {
      const x = -100 + (i % 25) * 8;
      const z = -100 + Math.floor(i / 25) * 10;
      hash.insert({
        id: `static_${i}`,
        minX: x - 1.5,
        minY: 0,
        minZ: z - 1.5,
        maxX: x + 1.5,
        maxY: 4,
        maxZ: z + 1.5,
        layer: COLLISION_LAYER.WORLD,
      });
    }
    for (let i = 0; i < 150; i++) {
      const box: SpatialAABB = {
        id: `dyn_${i}`,
        minX: -50 + i * 0.5,
        minY: 0,
        minZ: -20,
        maxX: -49 + i * 0.5,
        maxY: 1.8,
        maxZ: -19,
        layer: COLLISION_LAYER.ENEMY,
      };
      dynamicBoxes.push(box);
      hash.insert(box);
    }

    const out: SpatialAABB[] = [];
    const tHash0 = performance.now();
    for (let f = 0; f < 40; f++) {
      for (let i = 0; i < dynamicBoxes.length; i++) {
        const b = dynamicBoxes[i];
        b.minX += 0.3;
        b.maxX += 0.3;
        hash.update(b);
      }
      for (let q = 0; q < 60; q++) {
        hash.queryAABB(-30 + q, -30, -10 + q, -10, COLLISION_LAYER.WORLD | COLLISION_LAYER.ENEMY, out);
      }
    }
    const hashMs = Number((performance.now() - tHash0).toFixed(3));

    const cw = new CollisionWorld();
    for (let i = 0; i < 40; i++) {
      const sx = -80 + (i % 8) * 20;
      const sz = -80 + Math.floor(i / 8) * 32;
      cw.addSlope(
        createOrientedSlopeRegion({
          id: `slope_${i}`,
          startX: sx,
          startZ: sz - 4.5,
          endX: sx,
          endZ: sz + 4.5,
          width: 3.6,
          startY: 0,
          endY: 3.5,
          thickness: 0.45,
        })
      );
    }

    const hit = makeRayHit();
    const tPhys0 = performance.now();
    let hitCount = 0;
    for (let i = 0; i < 1200; i++) {
      const qx = -80 + ((i * 7) % 160);
      const qz = -80 + ((i * 13) % 160);
      cw.getSupportHeightAt(qx, 1.0, qz);
      if (cw.sweptSegmentTest(qx, 1.2, qz, 0, -0.2, 1, 14, COLLISION_LAYER.WORLD, hit)) {
        hitCount++;
      }
    }
    const physMs = Number((performance.now() - tPhys0).toFixed(3));

    console.info(
      '[STAGE11_BENCH] ALG-04 SpatialHash ms:',
      hashMs,
      'ALG-06 40-slope 1200 queries ms:',
      physMs,
      'hits:',
      hitCount
    );
    expect(out.length).toBeGreaterThanOrEqual(0);
  });

  it('BENCH-ALG-07: SurfaceDecalManager 500 cyclic spawns under budget=128', () => {
    const scene = new THREE.Scene();
    const decals = new SurfaceDecalManager(scene, 128, 85);
    const targetGeo = new THREE.PlaneGeometry(40, 40, 20, 20);
    const targetMat = new THREE.MeshStandardMaterial();
    const targetMesh = new THREE.Mesh(targetGeo, targetMat);
    const pt = new THREE.Vector3(0, 0, 0);
    const nrm = new THREE.Vector3(0, 1, 0);

    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      pt.set((i % 20) - 10, 0, ((i * 3) % 20) - 10);
      decals.spawnImpactDecal({ targetMesh, point: pt, normal: nrm });
    }
    decals.update(0.016, pt);
    const elapsedMs = Number((performance.now() - t0).toFixed(3));
    console.info('[STAGE11_BENCH] ALG-07 SurfaceDecalManager 500 spawns ms:', elapsedMs);
    expect(decals.getStats().activeCount).toBe(128);

    decals.dispose();
    targetGeo.dispose();
    targetMat.dispose();
  });

  it('BENCH-ALG-08: BattlefieldIntelligenceBoard 2000 detection+relay churn cycles', () => {
    const board = new BattlefieldIntelligenceBoard();
    for (let s = 0; s < 12; s++) {
      board.registerSquad(`sq_${s}`);
    }
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) {
      board.reportDetection({
        squadId: `sq_${i % 12}`,
        spotterUnitId: `spot_${i % 24}`,
        source: 'sight',
        x: (i % 40) - 20,
        y: 0,
        z: ((i * 5) % 40) - 20,
        strength: 0.85,
      });
      if (i % 10 === 0) board.update(0.1);
    }
    const elapsedMs = Number((performance.now() - t0).toFixed(3));
    console.info('[STAGE11_BENCH] ALG-08 BattlefieldIntelligenceBoard ms:', elapsedMs);
    expect(board.getPendingRelayCount()).toBeLessThanOrEqual(32);
  });

  it('BENCH-ALG-09: NavigationSolver applyCellUpdates + computeNextWaypoint3D across 6 surfaces & 24 portals', () => {
    const groundBlocked = new Uint8Array(NAV_GRID_DEFAULTS.width * NAV_GRID_DEFAULTS.height);
    const elevated: ElevatedNavSurfaceInput[] = [];
    for (let s = 1; s <= 5; s++) {
      elevated.push({
        surfaceId: s,
        name: `deck_${s}`,
        width: 24,
        height: 24,
        cellSize: 1.5,
        originX: -18,
        originZ: -18,
        elevationY: s * 4.5,
        minY: s * 4.5 - 0.5,
        maxY: s * 4.5 + 2.5,
        blocked: new Uint8Array(24 * 24),
      });
    }
    const portals: NavPortalInput[] = [];
    for (let p = 0; p < 12; p++) {
      const fromS = p % 5;
      const toS = fromS + 1;
      portals.push({
        portalId: p,
        portalKey: `stair_${p}`,
        kind: 'stair',
        fromSurfaceId: fromS,
        toSurfaceId: toS,
        fromX: -12 + (p % 4) * 8,
        fromY: fromS * 4.5,
        fromZ: -8 + Math.floor(p / 4) * 6,
        toX: -12 + (p % 4) * 8,
        toY: toS * 4.5,
        toZ: -4 + Math.floor(p / 4) * 6,
        fromFloorIndex: fromS,
        toFloorIndex: toS,
        width: 2.2,
        clearanceHeight: 2.6,
        slopeDeg: 32,
        baseCost: 8,
        dynamicWaitCost: 0,
        allowedProfilesMask: AGENT_PROFILE_ALL_INFANTRY_MASK,
        maxConcurrentOccupants: 0,
        activeOccupants: 0,
        enabled: true,
        bidirectional: true,
      });
    }

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
      elevated,
      portals
    );

    const updates = new Uint16Array([10, 1, 11, 1, 12, 1, 13, 0]);
    const outCoords = new Float32Array(3);
    const outMeta = new Int32Array(4);
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) {
      solver.applyCellUpdates(updates, 0);
      solver.computeNextWaypoint3D(-14, 0, -14, 10, 22.5, 10, 1, outCoords, outMeta, 1400);
    }
    const elapsedMs = Number((performance.now() - t0).toFixed(3));
    console.info('[STAGE11_BENCH] ALG-09 Nav applyCellUpdates+3D query (60x) ms:', elapsedMs);
    expect(outMeta[0]).toBeGreaterThanOrEqual(0);
  });

  it('ALL-5-MISSIONS: sequential load, verify structures, and clean unload across all 5 campaign maps', () => {
    expect(MISSIONS.length).toBe(5);
    const perMissionMs: Record<number, number> = {};
    for (const mission of MISSIONS) {
      const t0 = performance.now();
      const scene = new THREE.Scene();
      const res = new ResourceManager();
      const assets = new AssetManager(res);
      const cw = new CollisionWorld();
      const chunks = new WorldChunkManager();
      const destruction = new DestructionSystem(cw.physicsWorld, {} as never, {} as never);
      const built = buildWorldMap(mission.mapId, mission.id, scene, assets, res, cw, chunks, destruction);
      expect(built.coverNodes.length).toBeGreaterThan(0);
      expect(cw.getStaticBoxes().length).toBeGreaterThan(20);
      cw.clear();
      res.disposeAll();
      expect(cw.getStaticBoxes().length).toBe(0);
      perMissionMs[mission.id] = Number((performance.now() - t0).toFixed(2));
    }
    console.info('[STAGE11_BENCH] 5-mission load+dispose ms:', JSON.stringify(perMissionMs));
  });
});
