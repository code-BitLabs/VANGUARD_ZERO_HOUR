import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COLLISION_LAYER, SpatialAABB } from '@/src/physics/SpatialHash';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import {
  buildCsvExport,
  buildPhysicsJsonReport,
  buildPhysicsMarkdownAuditReport,
} from '@/src/gameplay/diagnostics/DiagnosticExporter';

function createEmptyHit(): RayHit {
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

function addEnterableTestRoom(world: CollisionWorld): void {
  // Room centered at (0, 0, -20), width 12 (x: -6..6), depth 12 (z: -26..-14), height 4.5, wall thickness 0.65
  const t = 0.65;
  const h = 4.5;
  const doorW = 2.5;
  const doorH = 2.6;
  const sillH = 1.12;
  const winTop = 2.38;

  // Front wall (z = -14) with central doorway (x: -1.25 .. +1.25)
  world.addStaticBox({
    id: 'room_front_left',
    minX: -6,
    minY: 0,
    minZ: -14 - t,
    maxX: -doorW * 0.5,
    maxY: h,
    maxZ: -14,
    layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
    tag: 'building_wall',
  });
  world.addStaticBox({
    id: 'room_front_right',
    minX: doorW * 0.5,
    minY: 0,
    minZ: -14 - t,
    maxX: 6,
    maxY: h,
    maxZ: -14,
    layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
    tag: 'building_wall',
  });
  world.addStaticBox({
    id: 'room_front_lintel',
    minX: -doorW * 0.5,
    minY: doorH,
    minZ: -14 - t,
    maxX: doorW * 0.5,
    maxY: h,
    maxZ: -14,
    layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
    tag: 'building_door_lintel',
  });

  // Back wall (z = -26) with central window aperture (x: -1.3 .. +1.3, y: 1.12 .. 2.38)
  world.addStaticBox({
    id: 'room_back_left',
    minX: -6,
    minY: 0,
    minZ: -26,
    maxX: -1.3,
    maxY: h,
    maxZ: -26 + t,
    layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
    tag: 'building_wall',
  });
  world.addStaticBox({
    id: 'room_back_right',
    minX: 1.3,
    minY: 0,
    minZ: -26,
    maxX: 6,
    maxY: h,
    maxZ: -26 + t,
    layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
    tag: 'building_wall',
  });
  world.addStaticBox({
    id: 'room_back_sill',
    minX: -1.3,
    minY: 0,
    minZ: -26,
    maxX: 1.3,
    maxY: sillH,
    maxZ: -26 + t,
    layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER | COLLISION_LAYER.WINDOW_SILL,
    tag: 'building_window_sill',
  });
  world.addStaticBox({
    id: 'room_back_win_lintel',
    minX: -1.3,
    minY: winTop,
    minZ: -26,
    maxX: 1.3,
    maxY: h,
    maxZ: -26 + t,
    layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
    tag: 'building_window_lintel',
  });

  // Roof ceiling slab (y: 4.15 .. 4.55)
  world.addStaticBox({
    id: 'room_ceiling',
    minX: -6,
    minY: h - 0.35,
    minZ: -26,
    maxX: 6,
    maxY: h + 0.05,
    maxZ: -14,
    layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
    tag: 'building_ceiling',
  });
}

describe('VANGUARD: ZERO HOUR — Unified PhysicsWorld & World Collision Integrity', () => {
  it('blocks player and enemy capsules against solid building walls while allowing entry through doorways', () => {
    const world = new CollisionWorld();
    addEnterableTestRoom(world);

    // 1. Try walking straight into the solid left front wall at x = -3.5, z = -13.4 -> -15.5
    const blockedPos = new THREE.Vector3(-3.5, 0, -13.4);
    const blockedVel = new THREE.Vector3(0, 0, -8.0);
    for (let i = 0; i < 20; i++) {
      world.resolvePlayerCapsule(blockedPos, blockedVel, 0.42, 1.8, 0.42, 1 / 60, 'player');
    }
    // Must stay outside the front wall face (z >= -13.58) and never teleport to the roof (y === 0)
    expect(blockedPos.z).toBeGreaterThanOrEqual(-13.6);
    expect(blockedPos.y).toBeCloseTo(0, 3);

    // 2. Walk through the central doorway at x = 0.0, z = -13.2 -> into the room interior
    const doorPos = new THREE.Vector3(0, 0, -13.2);
    const doorVel = new THREE.Vector3(0, 0, -6.0);
    for (let i = 0; i < 30; i++) {
      world.resolvePlayerCapsule(doorPos, doorVel, 0.42, 1.8, 0.42, 1 / 60, 'player');
    }
    expect(doorPos.z).toBeLessThan(-15.0);
    expect(doorPos.y).toBeCloseTo(0, 3);
  });

  it('blocks standing movement at window sills without false step-up, while allowing bullets and grenades through window apertures', () => {
    const world = new CollisionWorld();
    addEnterableTestRoom(world);

    // 1. Player walking toward back window sill (height 1.12m > stepHeight 0.42m) must be blocked horizontally
    const pos = new THREE.Vector3(0, 0, -24.5);
    const vel = new THREE.Vector3(0, 0, -7.0);
    for (let i = 0; i < 25; i++) {
      world.resolvePlayerCapsule(pos, vel, 0.42, 1.8, 0.42, 1 / 60, 'player');
    }
    expect(pos.z).toBeGreaterThan(-25.6);
    expect(pos.y).toBeCloseTo(0, 3);

    // 2. Ballistic ray through window aperture (y = 1.65m, between sill 1.12m and lintel 2.38m) passes unobstructed
    const apertureHit = createEmptyHit();
    const didHitAperture = world.sweptSegmentTest(
      0,
      1.65,
      -22,
      0,
      0,
      -1,
      8.0,
      COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      apertureHit
    );
    expect(didHitAperture).toBe(false);

    // 3. Ballistic ray at sill height (y = 0.65m) is blocked by the window sill
    const sillHit = createEmptyHit();
    const didHitSill = world.sweptSegmentTest(
      0,
      0.65,
      -22,
      0,
      0,
      -1,
      8.0,
      COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      sillHit
    );
    expect(didHitSill).toBe(true);
    expect(sillHit.collider?.id).toBe('room_back_sill');

    // 4. Thrown grenade (sphere radius 0.14m) through window aperture at y = 1.7m passes cleanly
    const grenadeHit = createEmptyHit();
    const didHitGrenade = world.sweptSphereTest(
      0,
      1.7,
      -23,
      0,
      0,
      -1,
      5.0,
      0.14,
      COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      grenadeHit
    );
    expect(didHitGrenade).toBe(false);
  });

  it('enforces ceiling stand-up checks (canStandUp) under low overhangs', () => {
    const world = new CollisionWorld();
    // Low duct overhang at y = 1.25 .. 1.95
    world.addStaticBox({
      id: 'low_duct',
      minX: -2,
      minY: 1.25,
      minZ: -2,
      maxX: 2,
      maxY: 1.95,
      maxZ: 2,
      layer: COLLISION_LAYER.WORLD,
      tag: 'building_ceiling',
    });

    // Crouched player (1.05m) at (0, 0, 0) cannot stand up to 1.8m because 1.25 < 1.8
    expect(world.canStandUp(new THREE.Vector3(0, 0, 0), 0.42, 1.8, 'player')).toBe(false);
    // Outside the overhang at (5, 0, 0), player can stand up freely
    expect(world.canStandUp(new THREE.Vector3(5, 0, 0), 0.42, 1.8, 'player')).toBe(true);
  });

  it('computes true 3D surface normals on roof slabs, ceiling undersides, and rotated OBB barriers', () => {
    const world = new CollisionWorld();
    addEnterableTestRoom(world);

    // Downward ray onto roof slab (y: 6 -> 3 at x=0, z=-20) must return normal (0, +1, 0)
    const roofHit = createEmptyHit();
    expect(world.sweptSegmentTest(0, 6.0, -20, 0, -1, 0, 3.0, COLLISION_LAYER.WORLD, roofHit)).toBe(
      true
    );
    expect(roofHit.normalY).toBeCloseTo(1, 4);

    // Upward ray into ceiling underside (y: 2 -> 5 at x=0, z=-20) must return normal (0, -1, 0)
    const ceilHit = createEmptyHit();
    expect(world.sweptSegmentTest(0, 2.0, -20, 0, 1, 0, 3.0, COLLISION_LAYER.WORLD, ceilHit)).toBe(
      true
    );
    expect(ceilHit.normalY).toBeCloseTo(-1, 4);

    // Rotated OBB barrier at (10, 0..1.4, 10) rotated by 45 degrees (PI / 4)
    const yaw = Math.PI / 4;
    world.addStaticBox({
      id: 'obb_barrier_45',
      minX: 7,
      minY: 0,
      minZ: 7,
      maxX: 13,
      maxY: 1.4,
      maxZ: 13,
      layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      tag: 'cover_barrier',
      yaw,
      centerX: 10,
      centerZ: 10,
      halfExtX: 2.0,
      halfExtZ: 0.4,
    });

    const obbHit = createEmptyHit();
    expect(world.sweptSegmentTest(10, 0.7, 6, 0, 0, 1, 8.0, COLLISION_LAYER.WORLD, obbHit)).toBe(
      true
    );
    expect(obbHit.collider?.id).toBe('obb_barrier_45');
    expect(Math.hypot(obbHit.normalX, obbHit.normalZ)).toBeCloseTo(1, 3);
  });

  it('resolves vehicle OBB collision with sliding deflection, speed reduction, high-speed impact damage, and world boundary clamping', () => {
    const world = new CollisionWorld();
    addEnterableTestRoom(world);

    const selfCol: SpatialAABB = {
      id: 'veh_test_1',
      minX: -4.8,
      minY: 0,
      minZ: -13.6,
      maxX: -2.2,
      maxY: 2.2,
      maxZ: -9.0,
      layer: COLLISION_LAYER.VEHICLE,
      tag: 'vehicle',
    };

    // 1. High-speed angled vehicle collision against building front wall (yaw=0.25 heads in -Z toward wall at z=-14)
    const vehPos = new THREE.Vector3(-3.5, 0, -11.8);
    const vehRes = world.resolveVehicleMovement(
      vehPos,
      0.25, // heading toward -Z wall at slight angle
      16.0, // 16 m/s
      1.3,
      2.3,
      0.1,
      'veh_test_1',
      selfCol
    );
    expect(vehRes.hitObstacle).toBe(true);
    expect(Math.abs(vehRes.newSpeed)).toBeLessThan(16.0);
    expect(vehRes.impactSpeed).toBeGreaterThan(7.5);
    expect(vehRes.hullDamageApplied).toBeGreaterThan(0);

    // 2. World boundary enforcement near edge (yaw = -PI/2 heads in +X)
    const edgePos = new THREE.Vector3(103.8, 0, 0);
    const edgeRes = world.resolveVehicleMovement(
      edgePos,
      -Math.PI / 2,
      20.0,
      1.3,
      2.3,
      0.1,
      'veh_edge',
      selfCol
    );
    expect(edgeRes.clampedBoundary).toBe(true);
    expect(edgePos.x).toBeLessThanOrEqual(world.physicsWorld.getWorldBoundLimit());
  });

  it('prevents high-speed projectile tunneling across 30Hz, 60Hz, and 120Hz frame steps', () => {
    const world = new CollisionWorld();
    addEnterableTestRoom(world);

    for (const fps of [30, 60, 120]) {
      const dt = 1 / fps;
      const speed = 95; // 95 m/s rocket/SAM
      let z = -8.0;
      let intercepted = false;
      const hit = createEmptyHit();
      for (let step = 0; step < 30; step++) {
        const stepDist = speed * dt;
        const didHit = world.sweptSegmentTest(
          -3.5,
          1.5,
          z,
          0,
          0,
          -1,
          stepDist,
          COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
          hit
        );
        if (didHit) {
          intercepted = true;
          expect(hit.pointZ).toBeCloseTo(-14.0, 2);
          break;
        }
        z -= stepDist;
      }
      expect(intercepted).toBe(true);
    }
  });

  it('builds complete physics diagnostic snapshots and exports valid JSON, Markdown, and CSV artifacts', () => {
    const world = new CollisionWorld();
    addEnterableTestRoom(world);
    world.physicsWorld.beginFrame(1 / 60);

    const pos = new THREE.Vector3(-3.5, 0, -13.7);
    const vel = new THREE.Vector3(0, 0, -9.0);
    world.resolvePlayerCapsule(pos, vel, 0.42, 1.8, 0.42, 1 / 60, 'player');

    const physSnap = world.physicsWorld.buildDiagnosticsSnapshot([
      {
        id: 'player',
        entityType: 'player',
        classification: 'character',
        shape: 'capsule',
        dimensions: 'r=0.42m h=1.80m',
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: 0,
        vx: vel.x,
        vy: vel.y,
        vz: vel.z,
        ax: 0,
        ay: 0,
        az: 0,
        speed: 9.0,
        massKg: 85,
        layer: COLLISION_LAYER.PLAYER,
        layerLabel: 'PLAYER',
        mask: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
        maskLabel: 'WORLD|COVER',
        physicalState: 'GROUNDED',
        lastCollisionId: 'room_front_left',
        lastNormalX: 0,
        lastNormalY: 0,
        lastNormalZ: 1,
        contactCount: 1,
      },
    ]);

    expect(physSnap.staticBodiesCount).toBeGreaterThanOrEqual(8);
    expect(physSnap.characterBodiesCount).toBe(1);

    const recorder = new CombatTelemetryRecorder();
    recorder.setPhysicsDiagnostics(physSnap);
    const fullSnap = recorder.buildSnapshot(
      {
        difficulty: 'veteran',
        maxGlobalAttackers: 3,
        currentGlobalAttackers: 1,
        availableGlobalTokens: 2,
        maxGlobalHeavyAttackers: 1,
        currentGlobalHeavyAttackers: 0,
        maxGlobalSuppressors: 2,
        currentGlobalSuppressors: 0,
        waitingAttackersCount: 0,
        pressureThrottled: false,
        rolling2sDamage: 0,
        damageBurstThreshold2s: 65,
        squads: [],
      },
      [],
      0
    );

    const jsonStr = buildPhysicsJsonReport(fullSnap);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.schemaVersion).toBe('vanguard.physics.diagnostics.v1');
    expect(parsed.physics.staticBodiesCount).toBeGreaterThanOrEqual(8);

    const mdStr = buildPhysicsMarkdownAuditReport(fullSnap);
    expect(mdStr).toContain('Physics & Collision Integrity Audit Report');
    expect(mdStr).toContain('| player | player | character | capsule |');

    const colCsv = buildCsvExport(fullSnap, 'collision_events');
    expect(colCsv).toContain('eventType,timestampSec,entityId,colliderId');

    const movCsv = buildCsvExport(fullSnap, 'object_movement');
    expect(movCsv).toContain('player,player,character,capsule');
  });
});
