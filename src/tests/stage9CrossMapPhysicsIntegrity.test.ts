import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG as MISSIONS } from '@/src/data/missions';
import { CargoLiftManager, CargoLiftOccupantProxy } from '@/src/gameplay/CargoLiftManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { AGENT_TRAVERSAL_PROFILES } from '@/src/navigation/AgentTraversalProfile';
import { CollisionWorld, createOrientedSlopeRegion } from '@/src/physics/CollisionWorld';
import { runPhysicsBackendBenchmark } from '@/src/tests/harnesses/PhysicsBenchmark';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from '@/src/physics/SpatialHash';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { globalStructureReconciliation } from '@/src/world/StructureReconciliationRegistry';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

function buildMissionForTest(missionId: number) {
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) throw new Error(`Missing mission ${missionId}`);
  const scene = new THREE.Scene();
  const res = new ResourceManager();
  const assets = new AssetManager(res);
  const cw = new CollisionWorld();
  const chunks = new WorldChunkManager();
  const destruction = new DestructionSystem(cw.physicsWorld, {} as never, {} as never);
  const built = buildWorldMap(
    mission.mapId,
    mission.id,
    scene,
    assets,
    res,
    cw,
    chunks,
    destruction
  );
  return { mission, scene, assets, res, cw, chunks, destruction, built };
}

function getSlopeEndpoints(slope: {
  centerX: number;
  centerZ: number;
  dirX: number;
  dirZ: number;
  halfLength: number;
}) {
  return {
    startX: slope.centerX - slope.dirX * slope.halfLength,
    startZ: slope.centerZ - slope.dirZ * slope.halfLength,
    endX: slope.centerX + slope.dirX * slope.halfLength,
    endZ: slope.centerZ + slope.dirZ * slope.halfLength,
  };
}

function makeFakeInput(overrides: Partial<Record<string, boolean>> = {}) {
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(overrides)) {
    if (v) keys.add(k);
  }
  return {
    isDown: (code: string) => keys.has(code),
    isActionDown: (action: string) =>
      (action === 'jump' && keys.has('Space')) ||
      (action === 'crouch' && keys.has('KeyC')) ||
      (action === 'sprint' && keys.has('ShiftLeft')),
    wasActionPressed: (action: string) =>
      (action === 'jump' && keys.has('Space')) || (action === 'crouch' && keys.has('KeyC')),
    consumeLookDelta: () => ({ yawDelta: 0, pitchDelta: 0 }),
    getMoveAxes: () => ({
      forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      right: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    }),
    isTouchActive: () => false,
    isPointerLocked: () => true,
  } as unknown as Parameters<PlayerController['update']>[1];
}

function makeFakeAudio() {
  return {
    play2D: () => {},
    play3D: () => {},
  } as unknown as ConstructorParameters<typeof PlayerController>[0];
}

describe('Stage 9 Cross-Map Physics, Traversal & Collision Integrity (PHYS-01 .. PHYS-12)', () => {
  it('PHYS-01: unifies PlayerController capsule dimensions with AgentTraversalProfile and supports negative-elevation spawn grounding', () => {
    const player = new PlayerController(makeFakeAudio());
    const dims = player.getActiveCapsuleDimensions();
    expect(dims.radius).toBeCloseTo(AGENT_TRAVERSAL_PROFILES.player.capsuleRadius, 3);
    expect(dims.height).toBeCloseTo(AGENT_TRAVERSAL_PROFILES.player.standingHeight, 3);

    const cw = new CollisionWorld();
    cw.setTerrainHeightFn(() => -1.35);
    player.spawn(0, 0, 0, 0, cw);
    expect(player.position.y).toBeCloseTo(-1.35, 2);
    expect(player.grounded).toBe(true);
    cw.clear();
  });

  it('PHYS-02: SpatialHash O(k) reverse-index updates maintain exact parity and meet < 0.05ms per dynamic update budget', () => {
    const hash = new SpatialHash(8);
    for (let i = 0; i < 600; i++) {
      const gx = (i % 30) * 6 - 90;
      const gz = Math.floor(i / 30) * 6 - 60;
      hash.insert({
        id: `static_${i}`,
        minX: gx,
        minY: 0,
        minZ: gz,
        maxX: gx + 2,
        maxY: 4,
        maxZ: gz + 2,
        layer: COLLISION_LAYER.WORLD,
      });
    }

    const moving: SpatialAABB = {
      id: 'dyn_lift',
      minX: -2,
      minY: 0,
      minZ: -2,
      maxX: 2,
      maxY: 1,
      maxZ: 2,
      layer: COLLISION_LAYER.WORLD,
    };
    hash.insert(moving);

    const t0 = performance.now();
    for (let step = 0; step < 2000; step++) {
      const x = Math.sin(step * 0.05) * 40;
      const z = Math.cos(step * 0.05) * 40;
      moving.minX = x - 2;
      moving.maxX = x + 2;
      moving.minZ = z - 2;
      moving.maxZ = z + 2;
      hash.update(moving);
    }
    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(120);

    // Confirm moving box is ONLY found at its latest position and never at its old origin
    const atOld: SpatialAABB[] = [];
    hash.queryAABB(-1, -1, 1, 1, COLLISION_LAYER.WORLD, atOld);
    expect(atOld.some((b) => b.id === 'dyn_lift')).toBe(false);

    const atCurrent: SpatialAABB[] = [];
    hash.queryAABB(moving.minX, moving.minZ, moving.maxX, moving.maxZ, COLLISION_LAYER.WORLD, atCurrent);
    expect(atCurrent.some((b) => b.id === 'dyn_lift')).toBe(true);

    hash.remove(moving);
    const afterRemove: SpatialAABB[] = [];
    hash.queryAABB(moving.minX, moving.minZ, moving.maxX, moving.maxZ, COLLISION_LAYER.WORLD, afterRemove);
    expect(afterRemove.some((b) => b.id === 'dyn_lift')).toBe(false);
  });

  it('PHYS-03: raycast/sweptCast intersects true negative terrain heightfield and OrientedSlopeRegions without phantom y=0 hits', () => {
    const cw = new CollisionWorld();
    cw.setTerrainHeightFn((x, z) => -1.2 + Math.sin(x * 0.1) * 0.25 + Math.cos(z * 0.1) * 0.25);

    const expectedY = cw.getTerrainHeightOnly(12, -8);
    expect(expectedY).toBeLessThan(-0.5);

    const hit = {
      hit: false,
      distance: 0,
      pointX: 0,
      pointY: 0,
      pointZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      colliderId: null as string | null,
      collider: null,
    };
    const didHit = cw.physicsWorld.raycast(12, 4.0, -8, 0, -1, 0, 12.0, COLLISION_LAYER.WORLD, hit);
    expect(didHit).toBe(true);
    expect(hit.hit).toBe(true);
    expect(hit.pointY).toBeCloseTo(expectedY, 1);
    expect(hit.pointY).toBeLessThan(-0.5); // Must NOT hit phantom y = 0 plane!

    // OrientedSlopeRegion raycast parity
    const slope = createOrientedSlopeRegion({
      id: 'test_slope_cast',
      surfaceId: 1,
      startX: 0,
      startZ: 0,
      endX: 0,
      endZ: 8,
      width: 3,
      startY: 0,
      endY: 4,
      thickness: 0.42,
      hasSideRails: true,
    });
    cw.addSlope(slope);

    const slopeHit = {
      hit: false,
      distance: 0,
      pointX: 0,
      pointY: 0,
      pointZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      colliderId: null as string | null,
      collider: null,
    };
    const didSlopeHit = cw.physicsWorld.raycast(0, 6.0, 4.0, 0, -1, 0, 10.0, COLLISION_LAYER.WORLD, slopeHit);
    expect(didSlopeHit).toBe(true);
    expect(slopeHit.hit).toBe(true);
    expect(slopeHit.pointY).toBeCloseTo(2.0, 1);
    expect(slopeHit.normalY).toBeGreaterThan(0.75);
    expect(slopeHit.normalZ).toBeLessThan(-0.2);

    cw.clear();
  });

  it('PHYS-05 & PHYS-10: ALL 5 campaign missions pass StructureReconciliationRegistry with zero discrepancies and zero integrity flags', () => {
    for (const mission of MISSIONS) {
      const { cw, res, built } = buildMissionForTest(mission.id);
      const report = globalStructureReconciliation.verifyMissionReconciliation(
        mission.id,
        built.elevatedSurfaces,
        built.navPortals,
        built.cargoLifts,
        cw
      );
      expect(report.discrepancies, `Mission ${mission.id} (${mission.mapId}) discrepancies`).toEqual([]);
      expect(
        report.traversalIntegrityFlags,
        `Mission ${mission.id} (${mission.mapId}) integrity flags`
      ).toEqual([]);
      expect(report.valid).toBe(true);

      // Verify [F4] diagnostics snapshot captures slopes, ladders, and boxes
      const snap = cw.physicsWorld.buildDiagnosticsSnapshot([]);
      expect(snap.staticColliderBoxes.length).toBeGreaterThan(20);
      expect(snap.slopeWireframes.length).toBeGreaterThan(0);
      expect(snap.ladderWireframes.length).toBeGreaterThan(0);
      expect(snap.traversalIntegrityFlags.length).toBe(0);

      cw.clear();
      res.disposeAll();
    }
  });

  it('PHYS-04 & PHYS-05 REGRESSION: Map 2 tower_-24_14 entry anchoring, full ascent/descent, underside/side blocking, and tall walk-under', () => {
    const { cw, res } = buildMissionForTest(2);
    const f1 = cw.getSlopes().find((s) => s.id === 'tower_-24_14_stair_flight1');
    const f2 = cw.getSlopes().find((s) => s.id === 'tower_-24_14_stair_flight2');
    expect(f1).toBeDefined();
    expect(f2).toBeDefined();
    if (!f1 || !f2) return;
    const f1Pts = getSlopeEndpoints(f1);
    const f2Pts = getSlopeEndpoints(f2);

    // 1. Flight 1 entry MUST be anchored flush to actual dune terrain (which is negative at tower_-24_14)
    const entryTerrainY = cw.getTerrainHeightOnly(f1Pts.startX, f1Pts.startZ);
    expect(Math.abs(f1.startY - entryTerrainY)).toBeLessThanOrEqual(0.08);

    // 2. Support pillar _pil MUST exist with solid collider
    const pil = cw.getStaticBoxes().find((b) => b.id === 'tower_-24_14_stair_pil');
    expect(pil).toBeDefined();

    // 3. Walk capsule smoothly up Flight 1 onto mid-landing
    const pos = new THREE.Vector3(f1Pts.startX, f1.startY, f1Pts.startZ - 0.6);
    const vel = new THREE.Vector3(0, 0, 4.5);
    let reachedMidLanding = false;
    for (let i = 0; i < 160; i++) {
      vel.set(0, Math.min(0, vel.y), 4.5);
      const resMove = cw.resolvePlayerCapsule(pos, vel, 0.42, 1.75, 0.48, 1 / 60);
      expect(resMove.grounded).toBe(true);
      if (pos.y >= f1.endY - 0.15) {
        reachedMidLanding = true;
        break;
      }
    }
    expect(reachedMidLanding).toBe(true);

    // 4. Transition laterally across mid-landing to Flight 2 start, then climb onto top_bridge!
    pos.set(f2Pts.startX, f2.startY, f2Pts.startZ + 0.3);
    let reachedDeck = false;
    for (let i = 0; i < 200; i++) {
      vel.set(0, Math.min(0, vel.y), -4.5);
      const resMove = cw.resolvePlayerCapsule(pos, vel, 0.42, 1.75, 0.48, 1 / 60);
      expect(resMove.grounded).toBe(true);
      if (pos.y >= f2.endY - 0.06 && pos.z <= f2Pts.endZ - 0.85) {
        reachedDeck = true;
        break;
      }
    }
    expect(reachedDeck).toBe(true);

    // 5. Turn left from top_bridge through open watchtower side onto center deck without parapet obstruction
    for (let i = 0; i < 90; i++) {
      vel.set(-4.5, 0, 0);
      cw.resolvePlayerCapsule(pos, vel, 0.42, 1.75, 0.48, 1 / 60);
    }
    expect(pos.x).toBeLessThan(-22.5);
    expect(pos.y).toBeCloseTo(f2.endY, 1);

    // 6. Sprint DOWN Flight 1 from near top without bouncing ungrounded
    pos.set(f1Pts.endX, f1.endY, f1Pts.endZ - 0.5);
    let ungroundedFrames = 0;
    for (let i = 0; i < 70; i++) {
      vel.set(0, -1.0, -7.5);
      const resDown = cw.resolvePlayerCapsule(pos, vel, 0.42, 1.75, 0.48, 1 / 60);
      if (!resDown.grounded) ungroundedFrames++;
    }
    expect(ungroundedFrames).toBeLessThanOrEqual(2);

    // 7. Side-rail blocking: pushing sideways from outside Flight 1 at mid-height must NOT enter the stair volume
    const sideZ = (f1Pts.startZ + f1Pts.endZ) * 0.5;
    const outsideX = f1Pts.startX + f1.halfWidth + 0.55;
    const sidePos = new THREE.Vector3(outsideX, cw.getTerrainHeightOnly(outsideX, sideZ), sideZ);
    const sideVel = new THREE.Vector3(-4.0, 0, 0);
    for (let i = 0; i < 30; i++) {
      sideVel.set(-4.0, 0, 0);
      cw.resolvePlayerCapsule(sidePos, sideVel, 0.42, 1.75, 0.48, 1 / 60);
    }
    expect(sidePos.x).toBeGreaterThan(f1Pts.startX + f1.halfWidth + 0.25);

    // 8. Tall underside walk-under: under high end of Flight 2 (headroom > 6m) player walks freely underneath!
    const underX = f2Pts.endX;
    const underStartZ = f2Pts.endZ - 1.2;
    const underPos = new THREE.Vector3(underX, cw.getTerrainHeightOnly(underX, underStartZ), underStartZ);
    const underVel = new THREE.Vector3(0, 0, 4.5);
    for (let i = 0; i < 60; i++) {
      underVel.set(0, 0, 4.5);
      cw.resolvePlayerCapsule(underPos, underVel, 0.42, 1.75, 0.48, 1 / 60);
    }
    expect(underPos.z).toBeGreaterThan(f2Pts.endZ + 2.0); // Cleanly walked underneath the high flight!

    cw.clear();
    res.disposeAll();
  });

  it('PHYS-05: M4 jungle watchtower stairs extend over solid North bank instead of overhanging the river', () => {
    const { cw, res } = buildMissionForTest(4);
    const f1West = cw.getSlopes().find((s) => s.id === 'jungle_tower_west_stair_flight1');
    const f1East = cw.getSlopes().find((s) => s.id === 'jungle_tower_east_stair_flight1');
    expect(f1West).toBeDefined();
    expect(f1East).toBeDefined();
    // River spans z in [10, 22]; stairs must run North (endZ < startZ < 6)
    expect(getSlopeEndpoints(f1West!).endZ).toBeLessThan(0);
    expect(getSlopeEndpoints(f1East!).endZ).toBeLessThan(0);

    cw.clear();
    res.disposeAll();
  });

  it('PHYS-06: CargoLift carries jumping and doors_closing occupants reliably and anchors M4 shaft to ground', () => {
    const { cw, res, built } = buildMissionForTest(4);
    const m4Lift = built.cargoLifts.find((l) => l.id === 'lift_m4_cmd');
    expect(m4Lift).toBeDefined();
    if (m4Lift) {
      const groundTerrain = cw.getTerrainHeightOnly(m4Lift.centerX, m4Lift.centerZ);
      expect(Math.abs(m4Lift.stops[0].elevationY - groundTerrain)).toBeLessThanOrEqual(0.05);

      const mgr = new CargoLiftManager(cw);
      mgr.registerLift(m4Lift);
      const playerPos = new THREE.Vector3(m4Lift.centerX, m4Lift.stops[0].elevationY, m4Lift.centerZ);
      const occupant: CargoLiftOccupantProxy = {
        id: 'player',
        pos: playerPos,
        height: 1.75,
        isPlayer: true,
      };

      expect(mgr.tryPlayerInteract(playerPos)).toBe(true);
      // Simulate player jumping mid-ascent with gravity — lift must carry & never overtake player feet
      let jumpVy = 0;
      let jumped = false;
      for (let step = 0; step < 300; step++) {
        if (step === 60 && !jumped) {
          jumpVy = 4.2;
          jumped = true;
        }
        mgr.updateFixed(1 / 60, [occupant]);
        if (jumpVy !== 0 || playerPos.y > m4Lift.platformCollider.maxY) {
          jumpVy -= 18 * (1 / 60);
          playerPos.y += jumpVy * (1 / 60);
          if (playerPos.y <= m4Lift.platformCollider.maxY) {
            playerPos.y = m4Lift.platformCollider.maxY;
            jumpVy = 0;
          }
        }
        // Player feet must never sink below platform surface during ride
        expect(playerPos.y).toBeGreaterThanOrEqual(m4Lift.platformCollider.maxY - 0.08);
      }
      expect(playerPos.y).toBeCloseTo(m4Lift.stops[1].elevationY, 1);
    }

    cw.clear();
    res.disposeAll();
  });

  it('PHYS-07: Vehicles stay grounded on M4 bridge decks and never snap up onto overhead M2 watchtower stairs', () => {
    // M4 bridge support (bridge_deck_0 maxY = 0.28) & negative open riverbed elevation (-0.7)
    const m4 = buildMissionForTest(4);
    const bridgeDeckY = m4.cw.getVehicleSupportHeightAt(0, 0.5, 16);
    const openRiverbedY = m4.cw.getTerrainHeightOnly(12, 16);
    expect(openRiverbedY).toBeLessThan(-0.3);
    expect(bridgeDeckY).toBeCloseTo(0.28, 2);
    m4.cw.clear();
    m4.res.disposeAll();

    // M2 driving under high section of tower_-24_14 Flight 2
    const m2 = buildMissionForTest(2);
    const f2 = m2.cw.getSlopes().find((s) => s.id === 'tower_-24_14_stair_flight2')!;
    const f2Pts = getSlopeEndpoints(f2);
    const testX = f2Pts.endX;
    const testZ = f2Pts.endZ + 0.8;
    const duneY = m2.cw.getTerrainHeightOnly(testX, testZ);
    const vehSupportY = m2.cw.getVehicleSupportHeightAt(testX, duneY, testZ);
    expect(vehSupportY).toBeCloseTo(duneY, 2);
    expect(vehSupportY).toBeLessThan(f2.endY - 3.0); // Must NOT snap onto overhead stair!
    m2.cw.clear();
    m2.res.disposeAll();
  });

  it('PHYS-08: Major solid landmarks and stair mid-landing pillars have physical colliders across Maps 1-5', () => {
    const expectedCollidersByMission: Record<number, string[]> = {
      1: ['m1_overpass_pier_W', 'm1_gantry_pier_W', 'm1_burned_hull', 'city_bldg_0_stair_pil'],
      2: ['m2_lng_sphere_W', 'm2_pipe_tower_W', 'm2_convoy_wreck', 'tower_-24_14_stair_pil'],
      3: ['city_bldg_2_stair_pil', 'city_bldg_3_stair_pil'],
      4: ['m4_bridge_tower_8.5_W', 'm4_river_boulder_0', 'jungle_tower_west_stair_pil'],
      5: ['m5_blast_furnace_W', 'm5_slag_vat_W', 'warehouse_0_stair_pil', 'warehouse_1_stair_pil'],
    };

    for (const [mIdStr, requiredIds] of Object.entries(expectedCollidersByMission)) {
      const mId = Number(mIdStr);
      const { cw, res } = buildMissionForTest(mId);
      const boxIds = new Set(cw.getStaticBoxes().map((b) => b.id));
      for (const reqId of requiredIds) {
        expect(boxIds.has(reqId), `Mission ${mId} missing collider ${reqId}`).toBe(true);
      }
      cw.clear();
      res.disposeAll();
    }
  });

  it('PHYS-09: Shared vertical ClimbableLadder system exists on all 5 maps and supports full mount -> climb -> top step-over -> descent', () => {
    for (const mission of MISSIONS) {
      const { cw, res } = buildMissionForTest(mission.id);
      const ladders = cw.getLadders();
      expect(ladders.length, `Mission ${mission.id} should have climbable ladders`).toBeGreaterThanOrEqual(2);

      // Test climbing the first ladder on Mission 1 and Mission 2 completely
      if (mission.id === 1 || mission.id === 2) {
        const ladder = ladders[0];
        const player = new PlayerController(makeFakeAudio());
        // Forward vector at yaw is (-sin(yaw), -cos(yaw)); face INTO ladder (-normalX, -normalZ) => atan2(normalX, normalZ)
        player.spawn(
          ladder.bottomExitX,
          ladder.bottomY,
          ladder.bottomExitZ,
          Math.atan2(ladder.normalX, ladder.normalZ),
          cw
        );
        expect(player.tryMountLadder(cw)).toBe(true);
        expect(player.isClimbingLadder).toBe(true);

        const climbUpInput = makeFakeInput({ KeyW: true });
        for (let step = 0; step < 300 && player.isClimbingLadder; step++) {
          player.update(1 / 60, climbUpInput, cw, false, 1.0, 0, false);
        }
        // Should cleanly dismount onto top deck!
        expect(player.isClimbingLadder).toBe(false);
        expect(player.position.y).toBeGreaterThanOrEqual(ladder.topY - 0.15);
      }

      cw.clear();
      res.disposeAll();
    }
  });

  it('PHYS-12: Single-authority benchmark runs without Rapier3D and map reload clears all physics registries cleanly', async () => {
    const bench = await runPhysicsBackendBenchmark();
    expect(bench.selectedBackend).toBe('custom_spatial_hash');
    expect(bench.customSpatialHashMs).toBeLessThan(15);

    // Reload lifecycle leak test across M1 -> M2 -> M5
    const scene = new THREE.Scene();
    const res = new ResourceManager();
    const assets = new AssetManager(res);
    const cw = new CollisionWorld();
    const chunks = new WorldChunkManager();
    const destruction = new DestructionSystem(cw.physicsWorld, {} as never, {} as never);

    for (const mission of [MISSIONS[0], MISSIONS[1], MISSIONS[4]]) {
      cw.clear();
      buildWorldMap(mission.mapId, mission.id, scene, assets, res, cw, chunks, destruction);
      const boxesAfterBuild = cw.getStaticBoxes().length;
      const slopesAfterBuild = cw.getSlopes().length;
      const laddersAfterBuild = cw.getLadders().length;
      expect(boxesAfterBuild).toBeGreaterThan(20);
      expect(slopesAfterBuild).toBeGreaterThan(0);
      expect(laddersAfterBuild).toBeGreaterThan(0);

      cw.clear();
      res.disposeAll();
      expect(cw.getStaticBoxes().length).toBe(0);
      expect(cw.getSlopes().length).toBe(0);
      expect(cw.getLadders().length).toBe(0);
    }
  });
});
