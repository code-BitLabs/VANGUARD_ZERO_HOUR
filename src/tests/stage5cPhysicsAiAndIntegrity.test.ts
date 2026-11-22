import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { HealthPickupManager } from '@/src/gameplay/HealthPickupManager';
import { runAiPhysicsStressArena } from '@/src/tests/harnesses/AiStressArena';
import {
  computeGroundedHipY,
  EnemyAnimTarget,
  stepEnemyLocomotionAnimation,
  updateOccludedSniperLaser,
} from '@/src/gameplay/ai/EnemyAnimationSync';
import {
  ENEMY_GRAVITY_MPS2,
  EnemyLocomotionUnit,
  stepEnemyLocomotion,
} from '@/src/gameplay/ai/EnemyLocomotionSolver';
import { DiagnosticRulesEngine } from '@/src/gameplay/diagnostics/DiagnosticRulesEngine';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { createOrientedSlopeRegion } from '@/src/physics/OrientedSlope';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';
import type { CharacterMoveResult } from '@/src/engine/physics/PhysicsTypes';
import type { MapId } from '@/src/schemas/common.schema';

function makeScratch(): { ray: RayHit; move: CharacterMoveResult } {
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

function makeLocoUnit(id: string, x: number, y: number, z: number): EnemyLocomotionUnit {
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

describe('Stage 5C — Physics, AI Locomotion, VFX, Diagnostics & Resource Scope Integrity', () => {
  it('SC-01: Menu diorama + all 5 missions + HealthPickupManager unload with zero mission resource leaks', () => {
    const res = new ResourceManager();
    const assets = new AssetManager(res);
    const audio = new AudioManager(res, SettingsBundleSchema.parse({}).audio);

    const missions: Array<{ id: number; mapId: MapId }> = [
      { id: 0, mapId: 'warzone_city' },
      { id: 1, mapId: 'warzone_city' },
      { id: 2, mapId: 'desert_base' },
      { id: 3, mapId: 'warzone_city' },
      { id: 4, mapId: 'jungle_zone' },
      { id: 5, mapId: 'industrial_complex' },
    ];

    for (const m of missions) {
      const scene = new THREE.Scene();
      const collision = new CollisionWorld();
      collision.setTerrainHeightFn(() => 0);
      const chunks = new WorldChunkManager();
      const vfx = new VFXPool(scene, res);
      const destruction = new DestructionSystem(collision.physicsWorld, vfx, audio);
      const healthPickups = new HealthPickupManager(scene, res, vfx, audio);
      const scope = `mission:${m.id}` as const;

      res.recordBaseline();
      buildWorldMap(m.mapId, m.id, scene, assets, res, collision, chunks, destruction);
      healthPickups.spawnPickup({ x: 4, y: 0, z: 4 }, 'station', scope, null, 25);

      // Unload exact mission scope (mirrors GameEngine.clearWorldState)
      healthPickups.clear();
      destruction.clear();
      chunks.clear(scene);
      res.unloadScope(scope);

      const audit = res.auditTransitionDelta();
      expect(
        audit.hasMissionLeak,
        `Mission ${m.id} leaked ${audit.missionRemaining} resources`
      ).toBe(false);
      expect(audit.missionRemaining).toBe(0);
    }

    res.disposeAll();
  });

  it('SC-02 & SC-03: Stationary and moving enemies fall at real gravity off ledges and cannot cantilever-hover or escape railed stairs', () => {
    const world = new CollisionWorld();
    world.setTerrainHeightFn(() => 0);
    const scratch = makeScratch();
    // Elevated roof deck at y = 5.0
    world.addStaticBox({
      id: 'roof',
      minX: -5,
      minY: 4.7,
      minZ: -5,
      maxX: 5,
      maxY: 5.0,
      maxZ: 5,
      layer: COLLISION_LAYER.WORLD,
    });

    // 1. Stationary unit placed 0.25m past roof edge (center over air) must drop promptly at ~21.5 m/s^2
    const stationary = makeLocoUnit('enemy_stat', 5.25, 5.0, 0);
    for (let i = 0; i < 60; i++) {
      stepEnemyLocomotion(stationary, 0, 0, 0, false, 1 / 60, world, [stationary], scratch.ray, scratch.move);
    }
    // 1.0s free-fall at 21.5 m/s^2 covers > 5.0m easily (old bug drifted only 0.2m!)
    expect(stationary.position.y).toBeLessThan(0.05);
    expect(stationary.grounded).toBe(true);
    expect(ENEMY_GRAVITY_MPS2).toBeGreaterThanOrEqual(20);

    // 2. Unit on railed staircase pushed sideways cannot escape laterally off the flight
    world.physicsWorld.addSlope(
      createOrientedSlopeRegion({
        id: 'railed_stair',
        startX: 20,
        startZ: -4.0,
        endX: 20,
        endZ: 4.0,
        width: 2.5,
        startY: 0,
        endY: 3.0,
        hasSideRails: true,
      })
    );
    const stairUnit = makeLocoUnit('enemy_stair', 20, 1.5, 0);
    for (let i = 0; i < 90; i++) {
      stepEnemyLocomotion(stairUnit, 12, 0, 4.5, true, 1 / 60, world, [stairUnit], scratch.ray, scratch.move);
      if (Math.abs(stairUnit.position.z) < 3.84) {
        expect(Math.abs(stairUnit.position.x - 20)).toBeLessThanOrEqual(1.25);
      }
    }
  });

  it('SC-04: VFXPool resets recycled particle scale immediately (no giant translucent red spheres) and caps ballistic tracer length', () => {
    const scene = new THREE.Scene();
    const res = new ResourceManager();
    const vfx = new VFXPool(scene, res);

    // Flood particle pool with large smoke plumes (scale 2.2) and advance them to max scale
    for (let i = 0; i < 120; i++) {
      vfx.spawnExplosion(0, 1, 0, 2.2);
    }
    vfx.update(0.25);
    // Let those particles expire back into pool
    vfx.update(2.0);

    // Now spawn blood mist & verify EVERY active instanced blood particle matrix has compact scale (never inherited 5m smoke scale)
    vfx.spawnImpact(0, 1.4, 0, 'blood');
    const rootGroup = scene.children[0] as THREE.Group;
    const bloodBatchMesh = rootGroup.getObjectByName('vfx_blood_instanced') as THREE.InstancedMesh;
    expect(bloodBatchMesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(bloodBatchMesh.visible).toBe(true);
    expect(bloodBatchMesh.count).toBeGreaterThan(0);

    const mat4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < bloodBatchMesh.count; i++) {
      bloodBatchMesh.getMatrixAt(i, mat4);
      mat4.decompose(pos, quat, scale);
      expect(scale.x).toBeLessThanOrEqual(0.2);
      expect(scale.y).toBeLessThanOrEqual(0.2);
      expect(scale.z).toBeLessThanOrEqual(0.2);
    }

    // Spawn a 65m long-range shot tracer and confirm it is rendered as a short traveling streak (<= 3.8m), NEVER a 65m beam
    vfx.spawnTracer(0, 1.6, 0, 0, 1.6, -65);
    const tracerBatchMesh = rootGroup.getObjectByName('vfx_tracer_instanced') as THREE.InstancedMesh;
    expect(tracerBatchMesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(tracerBatchMesh.visible).toBe(true);
    expect(tracerBatchMesh.count).toBe(1);
    tracerBatchMesh.getMatrixAt(0, mat4);
    mat4.decompose(pos, quat, scale);
    expect(scale.z).toBeLessThanOrEqual(3.81);
    expect(scale.x).toBeLessThanOrEqual(1.1);

    // Advance past tracer lifetime -> must deactivate cleanly
    vfx.update(0.5);
    expect(tracerBatchMesh.count).toBe(0);
    expect(tracerBatchMesh.visible).toBe(false);

    res.disposeAll();
  });

  it('SC-06: DiagnosticRulesEngine deduplicates repeated warnings, tracks occurrence counts, and expires stale entries', () => {
    const engine = new DiagnosticRulesEngine();
    const recorder = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(recorder);

    const makeSnap = (elapsedSec: number, invalidAttempts: number) => {
      recorder.reset();
      for (let i = 0; i < invalidAttempts; i++) {
        recorder.recordInvalidAttackAttempt();
      }
      const snap = recorder.buildSnapshot(coordinator.getSnapshot(), [], 0);
      snap.metrics.elapsedSec = elapsedSec;
      return snap;
    };

    // First trigger at t = 1s
    engine.evaluate(makeSnap(1.0, 1));
    // Re-trigger same rule at t = 5s (past 3s cooldown) -> must deduplicate into single entry with (x2)
    engine.evaluate(makeSnap(5.0, 2));

    const active = engine.getWarnings();
    const unauth = active.filter((w) => w.ruleId === 'AI_UNAUTH_ATTACK_ATTEMPT');
    expect(unauth.length).toBe(1);
    expect(unauth[0].measuredEvidence).toContain('(x2)');

    // Advance to t = 25s with clean telemetry -> WARNING (18s TTL) must expire cleanly
    engine.evaluate(makeSnap(25.0, 0));
    expect(engine.getWarnings().some((w) => w.ruleId === 'AI_UNAUTH_ATTACK_ATTEMPT')).toBe(false);
  });

  it('SC-07: Grounded hip kinematics prevent crouch boot sink, walk cycle uses real displacement, and sniper laser occludes on solid walls', () => {
    // 1. Crouch boot-sole check across standing, walking, climbing, and full tactical crouch
    const poses = [
      { lHip: 0, lKnee: 0.08, rHip: 0, rKnee: 0.08 },
      { lHip: -0.52, lKnee: 1.12, rHip: -0.28, rKnee: 0.76 },
      { lHip: 0.48, lKnee: 0.85, rHip: -0.45, rKnee: 0.42 },
    ];
    for (const p of poses) {
      const hipY = computeGroundedHipY(0.84, p.lHip, p.lKnee, p.rHip, p.rKnee, 0);
      const leftSoleY = hipY - (0.42 * Math.cos(p.lHip) + 0.42 * Math.cos(p.lHip + p.lKnee));
      const rightSoleY = hipY - (0.42 * Math.cos(p.rHip) + 0.42 * Math.cos(p.rHip + p.rKnee));
      expect(Math.min(leftSoleY, rightSoleY)).toBeGreaterThanOrEqual(-0.005);
    }

    // 2. Walk phase does NOT advance when unit is blocked (actualHorizSpeed = 0 even if velocity is non-zero)
    const dummyAnim: EnemyAnimTarget = {
      id: 'enemy_1',
      alive: true,
      state: 'ENGAGING',
      position: new THREE.Vector3(0, 0, 0),
      velocity: new THREE.Vector3(0, 0, 4.0),
      yaw: 0,
      hasLos: true,
      lastKnownPosition: null,
      coverTarget: null,
      isMoving: true,
      isReloading: false,
      hitReactTimer: 0,
      deathTimer: 0,
      walkPhase: 0,
      actualHorizSpeed: 0,
      actualVertSpeed: 0,
      meshRoot: new THREE.Group(),
      pelvisGroup: new THREE.Group(),
      torsoGroup: new THREE.Group(),
      leftLeg: new THREE.Group(),
      rightLeg: new THREE.Group(),
      leftKnee: new THREE.Group(),
      rightKnee: new THREE.Group(),
      weaponArm: new THREE.Group(),
      rightForearm: new THREE.Group(),
      leftArm: new THREE.Group(),
      leftForearm: new THREE.Group(),
      headMesh: new THREE.Group(),
      muzzleFlash: new THREE.Mesh(),
      hipRestY: 0.84,
      animCrouchBlend: 0,
      animAimBlend: 0,
      animFireRecoilTimer: 0,
      animMuzzleFlashTimer: 0,
      animHitDirYaw: 0,
      animHitHeadshot: false,
      animPrevYaw: 0,
      animTurnLean: 0,
      animTime: 0,
      telegraphKind: 'sniper',
      telegraphTimerSec: 0.6,
    };
    stepEnemyLocomotionAnimation(dummyAnim, 0.2, new THREE.Vector3(0, 0, 20), false, 20);
    expect(dummyAnim.walkPhase).toBe(0);

    // 3. Sniper laser raycast occlusion stops cleanly on an intervening wall at z = 7.5 instead of piercing to player at z = 20
    const world = new CollisionWorld();
    world.setTerrainHeightFn(() => 0);
    world.addStaticBox({
      id: 'cover_wall',
      minX: -4,
      minY: 0,
      minZ: 7.5,
      maxX: 4,
      maxY: 3.5,
      maxZ: 8.5,
      layer: COLLISION_LAYER.WORLD,
    });
    const positions = new Float32Array(6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const laserLine = new THREE.Line(geo, new THREE.LineBasicMaterial());
    const scratch = makeScratch();

    updateOccludedSniperLaser(
      laserLine,
      positions,
      [dummyAnim],
      true,
      new THREE.Vector3(0, 0, 20),
      false,
      world,
      scratch.ray
    );
    expect(laserLine.visible).toBe(true);
    // Beam end Z must clamp at front face of cover_wall (~7.5m), NOT pierce through to 20m
    expect(positions[5]).toBeLessThan(8.0);
    expect(positions[5]).toBeGreaterThan(7.0);
  });

  it('TRN-24: Full 10-scenario deterministic AI & Physics Locomotion Stress Arena passes all invariants', () => {
    const report = runAiPhysicsStressArena();
    for (const s of report.scenarios) {
      expect(s.passed, `${s.label} failed: ${s.detail}`).toBe(true);
    }
    expect(report.allPassed).toBe(true);
    expect(report.railEscapeCount).toBe(0);
    expect(report.crossFloorPushCount).toBe(0);
    expect(report.crouchFootSinkM).toBeLessThanOrEqual(0.005);
    expect(report.liftCarryDeltaM).toBeLessThanOrEqual(0.12);
    expect(report.doorwayThroughput).toBeGreaterThanOrEqual(3);
    expect(report.stuckRecoveredCount).toBeGreaterThanOrEqual(1);
  });
});
