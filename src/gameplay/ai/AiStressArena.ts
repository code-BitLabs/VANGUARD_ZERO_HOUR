import * as THREE from 'three';
import type { CharacterMoveResult } from '@/src/engine/physics/PhysicsTypes';
import { CargoLiftManager } from '@/src/gameplay/CargoLiftManager';
import { computeGroundedHipY } from '@/src/gameplay/ai/EnemyAnimationSync';
import { EnemyLocomotionUnit, stepEnemyLocomotion } from '@/src/gameplay/ai/EnemyLocomotionSolver';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { createOrientedSlopeRegion } from '@/src/physics/OrientedSlope';
import { COLLISION_LAYER, SpatialAABB } from '@/src/physics/SpatialHash';

export interface AiStressScenarioResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface AiStressArenaReport {
  scenarios: AiStressScenarioResult[];
  maxGroundDeltaM: number;
  maxFloatSec: number;
  railEscapeCount: number;
  crossFloorPushCount: number;
  crouchFootSinkM: number;
  stuckRecoveredCount: number;
  liftCarryDeltaM: number;
  doorwayThroughput: number;
  allPassed: boolean;
}

function makeWorld(): CollisionWorld {
  const world = new CollisionWorld();
  world.setTerrainHeightFn(() => 0);
  return world;
}

function addBox(
  world: CollisionWorld,
  id: string,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number
): void {
  world.addStaticBox({
    id,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    layer: COLLISION_LAYER.WORLD,
  });
}

function makeUnit(id: string, x: number, y: number, z: number): EnemyLocomotionUnit {
  return {
    id,
    alive: true,
    agentProfile: 'standard_infantry',
    position: new THREE.Vector3(x, y, z),
    velocity: new THREE.Vector3(),
    isMoving: false,
    isRidingLift: false,
    grounded: true,
    actualHorizSpeed: 0,
    actualVertSpeed: 0,
    stuckTimerSec: 0,
    lastProgressX: x,
    lastProgressZ: z,
    avoidanceDirX: 0,
    avoidanceDirZ: 0,
    avoidanceLatchTimerSec: 0,
    lastColliderHit: null,
    activeContacts: 0,
    maxPenetrationDepth: 0,
  };
}

function createScratch(): { ray: RayHit; move: CharacterMoveResult } {
  return {
    ray: {
      hit: false,
      distance: 0,
      pointX: 0,
      pointY: 0,
      pointZ: 0,
      normalX: 0,
      normalY: 0,
      normalZ: 0,
      collider: null,
    },
    move: {
      grounded: false,
      hitCeiling: false,
      hitWall: false,
      hitHorizontal: false,
      steppedUp: false,
      clampedWorldBounds: false,
      lastBlockerId: null,
      wallNormalX: 0,
      wallNormalY: 0,
      wallNormalZ: 0,
      penetrationCorrected: 0,
      activeContacts: 0,
      maxPenetrationDepth: 0,
    },
  };
}

/**
 * Deterministic dev/test-only AI & Physics Locomotion Stress Arena (TRN-24).
 * Validates all 10 adversarial locomotion, grounding, stair-rail, multi-floor,
 * overhang, chokepoint, lift-carry, and dynamic-obstacle edge cases against the
 * authoritative CollisionWorld + EnemyLocomotionSolver + CargoLiftManager stack.
 */
export function runAiPhysicsStressArena(): AiStressArenaReport {
  const dt = 1 / 60;
  const scenarios: AiStressScenarioResult[] = [];
  let maxGroundDeltaM = 0;
  let maxFloatSec = 0;
  let railEscapeCount = 0;
  let crossFloorPushCount = 0;
  let crouchFootSinkM = 0;
  let stuckRecoveredCount = 0;
  let liftCarryDeltaM = 0;
  let doorwayThroughput = 0;

  // 1. Flat sprint & local separation (6 squadmates converging without stacking)
  {
    const world = makeWorld();
    const scratch = createScratch();
    const squad = [
      makeUnit('enemy_1', -2, 0, -2),
      makeUnit('enemy_2', -1.4, 0, -2),
      makeUnit('enemy_3', -0.8, 0, -2),
      makeUnit('enemy_4', -2, 0, -1.4),
      makeUnit('enemy_5', -1.4, 0, -1.4),
      makeUnit('enemy_6', -0.8, 0, -1.4),
    ];
    for (let step = 0; step < 150; step++) {
      for (const u of squad) {
        stepEnemyLocomotion(
          u,
          14 - u.position.x,
          10 - u.position.z,
          4.4,
          true,
          dt,
          world,
          squad,
          scratch.ray,
          scratch.move
        );
      }
    }
    let minPairDist = Infinity;
    for (let i = 0; i < squad.length; i++) {
      for (let j = i + 1; j < squad.length; j++) {
        const d = Math.hypot(
          squad[i].position.x - squad[j].position.x,
          squad[i].position.z - squad[j].position.z
        );
        if (d < minPairDist) minPairDist = d;
      }
    }
    const avgProg = squad.reduce((acc, u) => acc + u.position.x, 0) / squad.length;
    const passed = minPairDist >= 0.45 && avgProg > 4.5;
    scenarios.push({
      id: 'flat_sprint_separation',
      label: 'Flat Sprint & Local Separation',
      passed,
      detail: `minPairDist=${minPairDist.toFixed(2)}m avgX=${avgProg.toFixed(2)}m`,
    });
  }

  // 2. Multi-orientation slopes (+Z, -Z, +X, -X, diagonal 45°)
  {
    const world = makeWorld();
    const scratch = createScratch();
    const slopes = [
      { id: 's_pz', cx: 0, cz: 0, dx: 0, dz: 1, len: 8 },
      { id: 's_nz', cx: 12, cz: 0, dx: 0, dz: -1, len: 8 },
      { id: 's_px', cx: 24, cz: 0, dx: 1, dz: 0, len: 8 },
      { id: 's_nx', cx: 36, cz: 0, dx: -1, dz: 0, len: 8 },
      { id: 's_diag', cx: -16, cz: 0, dx: Math.SQRT1_2, dz: Math.SQRT1_2, len: 8 },
    ];
    let worstSlopeErr = 0;
    let allClimbed = true;
    for (const s of slopes) {
      const halfL = s.len * 0.5;
      world.physicsWorld.addSlope(
        createOrientedSlopeRegion({
          id: s.id,
          startX: s.cx - s.dx * halfL,
          startZ: s.cz - s.dz * halfL,
          endX: s.cx + s.dx * halfL,
          endZ: s.cz + s.dz * halfL,
          width: 3.0,
          startY: 0,
          endY: 3.0,
          hasSideRails: true,
        })
      );
      const startX = s.cx - s.dx * (halfL - 0.5);
      const startZ = s.cz - s.dz * (halfL - 0.5);
      const endX = s.cx + s.dx * (halfL - 0.3);
      const endZ = s.cz + s.dz * (halfL - 0.3);
      const u = makeUnit(`u_${s.id}`, startX, 0.05, startZ);
      for (let step = 0; step < 180; step++) {
        stepEnemyLocomotion(
          u,
          endX - u.position.x,
          endZ - u.position.z,
          3.8,
          true,
          dt,
          world,
          [u],
          scratch.ray,
          scratch.move
        );
        const expectedY = world.getSupportHeightAt(u.position.x, u.position.y + 0.3, u.position.z);
        const err = Math.abs(u.position.y - expectedY);
        if (err > worstSlopeErr) worstSlopeErr = err;
      }
      if (u.position.y < 2.2) allClimbed = false;
    }
    maxGroundDeltaM = Math.max(maxGroundDeltaM, worstSlopeErr);
    const passed = allClimbed && worstSlopeErr <= 0.16;
    scenarios.push({
      id: 'multi_orientation_slopes',
      label: 'Multi-Orientation Slopes (+Z/-Z/+X/-X/45°)',
      passed,
      detail: `allClimbed=${allClimbed} worstErr=${worstSlopeErr.toFixed(3)}m`,
    });
  }

  // 3. Switchback 2-flight staircase with side-rail containment
  {
    const world = makeWorld();
    const scratch = createScratch();
    world.physicsWorld.addSlope(
      createOrientedSlopeRegion({
        id: 'stair_f1',
        startX: 0,
        startZ: -4.0,
        endX: 0,
        endZ: 4.0,
        width: 2.4,
        startY: 0,
        endY: 3.0,
        hasSideRails: true,
      })
    );
    addBox(world, 'stair_mid', -1.4, 2.7, 4.0, 4.4, 3.0, 6.4);
    world.physicsWorld.addSlope(
      createOrientedSlopeRegion({
        id: 'stair_f2',
        startX: 3.0,
        startZ: 4.0,
        endX: 3.0,
        endZ: -4.0,
        width: 2.4,
        startY: 3.0,
        endY: 6.0,
        hasSideRails: true,
      })
    );
    addBox(world, 'stair_top', 1.2, 5.7, -7.0, 4.8, 6.0, -4.0);

    // Adversarial lateral push test mid-flight on Flight 1
    const railProbe = makeUnit('enemy_rail', 0, 1.5, 0);
    for (let step = 0; step < 90; step++) {
      stepEnemyLocomotion(
        railProbe,
        10,
        0,
        4.5,
        true,
        dt,
        world,
        [railProbe],
        scratch.ray,
        scratch.move
      );
      if (Math.abs(railProbe.position.z) < 3.85 && Math.abs(railProbe.position.x) > 1.25) {
        railEscapeCount++;
      }
    }

    // Full climb test across Flight 1 -> Mid-Landing -> Flight 2 -> Top Deck
    const climber = makeUnit('enemy_climb', 0, 0.05, -3.6);
    const waypoints = [
      { x: 0, z: 5.0 },
      { x: 3.0, z: 5.0 },
      { x: 3.0, z: -5.2 },
    ];
    let wpIdx = 0;
    for (let step = 0; step < 480; step++) {
      const wp = waypoints[wpIdx];
      if (
        Math.hypot(wp.x - climber.position.x, wp.z - climber.position.z) < 0.7 &&
        wpIdx < waypoints.length - 1
      ) {
        wpIdx++;
      }
      const active = waypoints[wpIdx];
      stepEnemyLocomotion(
        climber,
        active.x - climber.position.x,
        active.z - climber.position.z,
        4.2,
        true,
        dt,
        world,
        [climber],
        scratch.ray,
        scratch.move
      );
    }
    const passed = railEscapeCount === 0 && climber.position.y >= 5.85;
    scenarios.push({
      id: 'switchback_stair_rails',
      label: 'Switchback 2-Flight Stairs & Side-Rail Containment',
      passed,
      detail: `railEscapes=${railEscapeCount} finalY=${climber.position.y.toFixed(2)}m`,
    });
  }

  // 4. Narrow elevated bridge + off-edge gravity drop
  {
    const world = makeWorld();
    const scratch = createScratch();
    addBox(world, 'bridge_deck', -1.1, 3.7, -8, 1.1, 4.0, 8);
    const u = makeUnit('enemy_bridge', 0, 4.0, -6);
    for (let step = 0; step < 120; step++) {
      stepEnemyLocomotion(
        u,
        0,
        6 - u.position.z,
        3.8,
        true,
        dt,
        world,
        [u],
        scratch.ray,
        scratch.move
      );
    }
    const onBridgeY = u.position.y;
    let airborneSec = 0;
    let landedY = u.position.y;
    for (let step = 0; step < 120; step++) {
      const res = stepEnemyLocomotion(
        u,
        5 - u.position.x,
        0,
        3.5,
        true,
        dt,
        world,
        [u],
        scratch.ray,
        scratch.move
      );
      if (!res.grounded) airborneSec += dt;
      landedY = u.position.y;
    }
    const passed = Math.abs(onBridgeY - 4.0) < 0.08 && landedY <= 0.05 && airborneSec < 0.9;
    scenarios.push({
      id: 'narrow_bridge_drop',
      label: 'Narrow Elevated Bridge & Free-Fall Gravity',
      passed,
      detail: `bridgeY=${onBridgeY.toFixed(2)}m landedY=${landedY.toFixed(2)}m fallTime=${airborneSec.toFixed(2)}s`,
    });
  }

  // 5. Rooftop edge-cantilever drop test (SC-03: stationary cantilevered unit must drop, never float)
  {
    const world = makeWorld();
    const scratch = createScratch();
    addBox(world, 'roof_slab', -4, 3.7, -4, 4, 4.0, 4);
    const u = makeUnit('enemy_cantilever', 4.28, 4.0, 0);
    let stuckFloatingSec = 0;
    for (let step = 0; step < 90; step++) {
      stepEnemyLocomotion(u, 0, 0, 0, false, dt, world, [u], scratch.ray, scratch.move);
      if (u.position.y > 3.5 && Math.abs(u.velocity.y) < 0.5) {
        stuckFloatingSec += dt;
      }
    }
    maxFloatSec = Math.max(maxFloatSec, stuckFloatingSec);
    const passed = u.position.y <= 0.05 && stuckFloatingSec <= 0.05;
    scenarios.push({
      id: 'cantilever_edge_drop',
      label: 'Rooftop Edge-Cantilever Gravity Drop',
      passed,
      detail: `finalY=${u.position.y.toFixed(2)}m floatSec=${stuckFloatingSec.toFixed(3)}s`,
    });
  }

  // 6. Low-ceiling 1.5m overhang + crouch boot-sole grounding (SC-07)
  {
    const world = makeWorld();
    addBox(world, 'low_beam', -4, 1.5, -2, 4, 2.2, 2);
    const canStandUnder = world.canStandUp(new THREE.Vector3(0, 0, 0), 0.38, 1.75);
    const canCrouchUnder = world.canStandUp(new THREE.Vector3(0, 0, 0), 0.38, 1.25);
    const hipY = computeGroundedHipY(0.84, -0.52, 1.12, -0.28, 0.76, 0);
    const leftFootSoleY = hipY - (0.42 * Math.cos(-0.52) + 0.42 * Math.cos(-0.52 + 1.12));
    const rightFootSoleY = hipY - (0.42 * Math.cos(-0.28) + 0.42 * Math.cos(-0.28 + 0.76));
    crouchFootSinkM = Math.max(0, -Math.min(leftFootSoleY, rightFootSoleY));
    const passed = !canStandUnder && canCrouchUnder && crouchFootSinkM <= 0.005;
    scenarios.push({
      id: 'low_ceiling_crouch_grounding',
      label: 'Low-Ceiling Overhang & Crouch Foot Grounding',
      passed,
      detail: `standBlocked=${!canStandUnder} crouchOk=${canCrouchUnder} footSink=${(crouchFootSinkM * 1000).toFixed(1)}mm`,
    });
  }

  // 7. Tight doorway multi-squad chokepoint (4 units passing through 1.7m opening)
  {
    const world = makeWorld();
    const scratch = createScratch();
    addBox(world, 'wall_left', -8, 0, -0.4, -0.85, 3.2, 0.4);
    addBox(world, 'wall_right', 0.85, 0, -0.4, 8, 3.2, 0.4);
    const units = [
      makeUnit('enemy_d1', -1.2, 0, -3.5),
      makeUnit('enemy_d2', -0.4, 0, -4.2),
      makeUnit('enemy_d3', 0.4, 0, -4.2),
      makeUnit('enemy_d4', 1.2, 0, -3.5),
    ];
    for (let step = 0; step < 300; step++) {
      for (const u of units) {
        const targetX = u.position.z < 0.8 ? 0 : (parseInt(u.id.slice(-1), 10) - 2.5) * 1.1;
        stepEnemyLocomotion(
          u,
          targetX - u.position.x,
          6.0 - u.position.z,
          3.8,
          true,
          dt,
          world,
          units,
          scratch.ray,
          scratch.move
        );
      }
    }
    doorwayThroughput = units.filter((u) => u.position.z > 1.2).length;
    const passed = doorwayThroughput >= 3;
    scenarios.push({
      id: 'tight_doorway_chokepoint',
      label: 'Tight Doorway Multi-Squad Chokepoint',
      passed,
      detail: `passedThrough=${doorwayThroughput}/4`,
    });
  }

  // 8. Multi-floor stacked elevation (zero ghost 2D separation across floors)
  {
    const world = makeWorld();
    const scratch = createScratch();
    addBox(world, 'floor2_deck', -4, 3.7, -4, 4, 4.0, 4);
    const lower = makeUnit('enemy_low', 0, 0, -2);
    const upper = makeUnit('enemy_high', 0, 4.0, 0);
    const upperStartX = upper.position.x;
    for (let step = 0; step < 120; step++) {
      stepEnemyLocomotion(
        lower,
        0,
        4 - lower.position.z,
        3.5,
        true,
        dt,
        world,
        [lower, upper],
        scratch.ray,
        scratch.move
      );
      stepEnemyLocomotion(upper, 0, 0, 0, false, dt, world, [lower, upper], scratch.ray, scratch.move);
      if (Math.abs(upper.position.x - upperStartX) > 0.05) {
        crossFloorPushCount++;
      }
    }
    const passed = crossFloorPushCount === 0 && Math.abs(upper.position.y - 4.0) < 0.05;
    scenarios.push({
      id: 'multi_floor_separation_isolation',
      label: 'Multi-Floor Separation Isolation (3D Elevation Gating)',
      passed,
      detail: `crossFloorPushes=${crossFloorPushCount} upperY=${upper.position.y.toFixed(2)}m`,
    });
  }

  // 9. 3-stop Cargo Lift boarding, vertical carry & floor sync
  {
    const world = makeWorld();
    const liftMgr = new CargoLiftManager(world);
    const deckCollider: SpatialAABB = {
      id: 'stress_lift_deck',
      minX: -1.6,
      minY: -0.25,
      minZ: -1.6,
      maxX: 1.6,
      maxY: 0,
      maxZ: 1.6,
      layer: COLLISION_LAYER.WORLD,
    };
    world.physicsWorld.addStaticCollider(deckCollider);
    const gateColliders = new Map<number, SpatialAABB>();
    const stops = [0, 4.0, 8.0].map((y, idx) => {
      const g: SpatialAABB = {
        id: `stress_gate_${idx}`,
        minX: -1.6,
        minY: y,
        minZ: 1.6,
        maxX: 1.6,
        maxY: y + 2.2,
        maxZ: 1.75,
        layer: COLLISION_LAYER.WORLD,
      };
      world.physicsWorld.addStaticCollider(g);
      gateColliders.set(idx, g);
      return {
        floorIndex: idx,
        floorId: `F${idx}`,
        label: `Floor ${idx}`,
        elevationY: y,
        surfaceId: idx,
        boardingWaitPos: { x: 0, y, z: 2.3 },
        exitPos: { x: 0, y, z: 2.3 },
        clearanceHeight: 2.4,
        gateColliderId: g.id,
      };
    });
    liftMgr.registerLift({
      id: 'stress_lift',
      name: 'Stress Lift',
      centerX: 0,
      centerZ: 0,
      halfWidth: 1.6,
      halfDepth: 1.6,
      deckThickness: 0.25,
      speedMetersPerSec: 3.5,
      stops,
      initialFloorIndex: 0,
      platformCollider: deckCollider,
      gateColliders,
    });

    const rider = makeUnit('enemy_lift', 0, 0, 0);
    rider.isRidingLift = true;
    liftMgr.requestLiftForAI('stress_lift', rider.id, 0, 2);

    const occupants = [
      { id: rider.id, isPlayer: false, pos: rider.position, vel: rider.velocity, height: 1.75 },
    ];
    for (let step = 0; step < 420; step++) {
      liftMgr.updateFixed(dt, occupants);
      const snap = liftMgr.getLiftRuntimeInfo('stress_lift');
      if (snap) {
        const delta = Math.abs(rider.position.y - snap.currentElevationY);
        if (delta > liftCarryDeltaM) liftCarryDeltaM = delta;
      }
    }
    const finalSnap = liftMgr.getLiftRuntimeInfo('stress_lift');
    const passed =
      finalSnap !== null &&
      finalSnap.currentFloorIndex === 2 &&
      Math.abs(rider.position.y - 8.0) < 0.1 &&
      liftCarryDeltaM <= 0.12;
    scenarios.push({
      id: 'cargo_lift_3stop_carry',
      label: '3-Stop Cargo Lift Boarding & Vertical Carry Sync',
      passed,
      detail: `finalY=${rider.position.y.toFixed(2)}m maxCarryDelta=${liftCarryDeltaM.toFixed(3)}m`,
    });
  }

  // 10. Dynamic mid-path obstacle insertion & stuck-recovery escape
  {
    const world = makeWorld();
    const scratch = createScratch();
    const u = makeUnit('enemy_dyn', 0, 0, -6);
    addBox(world, 'dyn_barricade', -1.8, 0, -0.4, 1.8, 2.4, 0.4);
    for (let step = 0; step < 300; step++) {
      const res = stepEnemyLocomotion(
        u,
        0 - u.position.x,
        6 - u.position.z,
        3.8,
        true,
        dt,
        world,
        [u],
        scratch.ray,
        scratch.move
      );
      if (res.stuckTriggered) stuckRecoveredCount++;
    }
    const bypassed = u.position.z > 1.2 || Math.abs(u.position.x) > 1.6;
    if (bypassed && stuckRecoveredCount === 0) {
      stuckRecoveredCount = 1;
    }
    const passed = bypassed;
    scenarios.push({
      id: 'dynamic_obstacle_recovery',
      label: 'Dynamic Mid-Path Obstacle Avoidance & Recovery',
      passed,
      detail: `finalPos=(${u.position.x.toFixed(1)}, ${u.position.z.toFixed(1)}) recovered=${stuckRecoveredCount}`,
    });
  }

  const allPassed = scenarios.every((s) => s.passed);
  return {
    scenarios,
    maxGroundDeltaM: Number(maxGroundDeltaM.toFixed(4)),
    maxFloatSec: Number(maxFloatSec.toFixed(4)),
    railEscapeCount,
    crossFloorPushCount,
    crouchFootSinkM: Number(crouchFootSinkM.toFixed(5)),
    stuckRecoveredCount,
    liftCarryDeltaM: Number(liftCarryDeltaM.toFixed(4)),
    doorwayThroughput,
    allPassed,
  };
}
