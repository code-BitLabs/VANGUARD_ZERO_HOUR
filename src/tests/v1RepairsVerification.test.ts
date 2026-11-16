import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { getMissionById } from '@/src/data/missions';
import { VFXPool } from '@/src/effects/VFXPool';
import { PhysicsWorld } from '@/src/engine/physics/PhysicsWorld';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { HitscanTarget } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { setupLightingRig } from '@/src/world/LightingRig';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { buildAirRig } from '@/src/world/rigs/AirRigBuilder';
import { buildSoldierRig } from '@/src/world/rigs/EnemyRigBuilder';
import { buildVehicleRig } from '@/src/world/rigs/VehicleRigBuilder';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

describe('V1 Final Production Repairs & Stress Verification', () => {
  it('REP-08: tracks player beyond static frustum bounds with texel-snapped quantization and no-op safety when shadows disabled', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();

    // Shadows enabled: mapSize = 1024, shadowDistance = 64 -> texelSize = 128 / 1024 = 0.125m
    const lights = setupLightingRig(scene, 'daylight', 1024, 64, rm);
    const initialTarget = lights.sun.target.position.clone();

    // Sub-texel jitter (0.01m) should stay quantized on the same texel in light space
    lights.updateShadowFocus(0.01, 0, 0.01, 64);
    expect(lights.sun.target.position.x).toBeCloseTo(initialTarget.x, 5);
    expect(lights.sun.target.position.y).toBeCloseTo(initialTarget.y, 5);
    expect(lights.sun.target.position.z).toBeCloseTo(initialTarget.z, 5);

    // Moving far across the map (e.g. 92m, well past 64m origin frustum) centers the frustum near player
    lights.updateShadowFocus(92, 1.5, -88, 64);
    expect(Math.hypot(lights.sun.target.position.x - 92, lights.sun.target.position.z + 88)).toBeLessThan(1.0);
    // Sun maintains constant offset relative to snapped target
    const sunDelta = lights.sun.position.clone().sub(lights.sun.target.position);
    expect(sunDelta.x).toBeCloseTo(65, 4);
    expect(sunDelta.y).toBeCloseTo(95, 4);
    expect(sunDelta.z).toBeCloseTo(45, 4);

    // Updating governor shadowDistance updates frustum bounds cleanly
    lights.updateShadowFocus(50, 0, 50, 48);
    expect(lights.sun.shadow.camera.right).toBe(48);
    expect(lights.sun.shadow.camera.left).toBe(-48);

    // Shadows disabled (mapSize = 0) -> updateShadowFocus is a safe no-op
    const lowLights = setupLightingRig(scene, 'night', 0, 32, rm);
    const originPos = lowLights.sun.target.position.clone();
    lowLights.updateShadowFocus(100, 0, 100, 32);
    expect(lowLights.sun.target.position.equals(originPos)).toBe(true);

    rm.disposeAll();
  });

  it('FND-10: excludes own vehicle collider via ignoreColliderId instead of removing/reinserting SpatialHash nodes', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const ballistics = new BallisticSolver(vfx, telemetry);
    const collision = new CollisionWorld();
    const player = new PlayerController(audio);
    player.spawn(0, 1.7, 18);

    const vehicles = new VehicleManager(scene, rm, vfx, audio, undefined, ballistics, telemetry);
    vehicles.spawnVehicle('enemy_apc', { x: 0, y: 0, z: 0 }, 0, true, true, collision, 'mission:1');
    const apc = vehicles.getVehicles()[0];
    expect(apc).toBeDefined();

    // Without ignoreColliderId, a ray starting from the turret roof hits its own APC hull (blocker)
    const selfHitRes = ballistics.checkLineOfSight(
      apc.position.x,
      apc.position.y + 1.8,
      apc.position.z,
      player,
      collision,
      68
    );
    expect(selfHitRes.visible).toBe(false);
    expect(selfHitRes.blockerId).toBe(apc.collider.id);

    // With ignoreColliderId = apc.collider.id, LOS ignores own hull AND keeps APC collider in SpatialHash
    const removeSpy = vi.spyOn(collision.spatialHash, 'remove');
    const insertSpy = vi.spyOn(collision.spatialHash, 'insert');
    const clearRes = ballistics.checkLineOfSight(
      apc.position.x,
      apc.position.y + 1.8,
      apc.position.z,
      player,
      collision,
      68,
      apc.collider.id
    );
    expect(clearRes.visible).toBe(true);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();

    vehicles.clear();
    rm.disposeAll();
  });

  it('REP-05 & FND-09 & FND-12: reuses scratch buffers across target fill* APIs, capsule steps, and reports accurate solverBackend', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const ballistics = new BallisticSolver(vfx, telemetry);
    const projectiles = new ProjectileManager(scene, rm, vfx, audio);
    const collision = new CollisionWorld();
    const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, undefined, ballistics, telemetry);
    const air = new AirCombatManager(scene, rm, vfx, audio, undefined, ballistics, telemetry);
    const vehicles = new VehicleManager(scene, rm, vfx, audio, undefined, ballistics, telemetry);

    expect(
      telemetry.buildSnapshot(
        {
          difficulty: 'normal',
          maxGlobalAttackers: 3,
          currentGlobalAttackers: 0,
          availableGlobalTokens: 3,
          maxGlobalHeavyAttackers: 1,
          currentGlobalHeavyAttackers: 0,
          maxGlobalSuppressors: 2,
          currentGlobalSuppressors: 0,
          waitingAttackersCount: 0,
          pressureThrottled: false,
          rolling2sDamage: 0,
          damageBurstThreshold2s: 60,
          squads: [],
        },
        [],
        0
      ).physics.solverBackend
    ).toBe('Custom FPS Controller + SpatialHash/BVH');
    expect(collision.physicsWorld.buildDiagnosticsSnapshot([]).solverBackend).toBe(
      'Custom FPS Controller + SpatialHash/BVH'
    );

    // PhysicsWorld.getMaxObstacleHeightInArea reuses internal scratch across calls
    const pw = new PhysicsWorld();
    pw.addStaticCollider({
      id: 'b1',
      minX: 8,
      minY: 0,
      minZ: 8,
      maxX: 12,
      maxY: 12,
      maxZ: 12,
      layer: COLLISION_LAYER.WORLD,
    });
    expect(pw.getMaxObstacleHeightInArea(10, 10, 5)).toBe(12);
    expect(pw.getMaxObstacleHeightInArea(40, 40, 5)).toBe(0);

    // CollisionWorld.resolvePlayerCapsule reuses provided outResult object
    const moveScratch = {
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
    };
    const pos = new THREE.Vector3(0, 0, 0);
    const vel = new THREE.Vector3(1, -5, 0);
    const resRef = collision.resolvePlayerCapsule(pos, vel, 0.45, 1.8, 0.45, 1 / 60, 'player', undefined, moveScratch);
    expect(resRef).toBe(moveScratch);
    expect(resRef.grounded).toBe(true);

    // Verify fillHitscanTargets reuses wrapper objects cleanly and dispatches hits to the correct unit
    enemies.spawnWave('infantry', 2, { x: 0, y: 0, z: -20 }, 4, collision, 'mission:1');
    air.spawnUnit('attack_drone', 18, 20, 0, 'mission:1');
    vehicles.spawnVehicle('enemy_technical', { x: 12, y: 0, z: -25 }, 0, true, false, collision, 'mission:1');

    const hitscanBuf: HitscanTarget[] = [];
    const onEnemyHit = vi.fn();
    const onAirHit = vi.fn();
    const onVehHit = vi.fn();

    enemies.fillHitscanTargets(hitscanBuf, onEnemyHit);
    air.fillHitscanTargets(hitscanBuf, onAirHit);
    vehicles.fillHitscanTargets(hitscanBuf, onVehHit);
    expect(hitscanBuf).toHaveLength(4);
    const firstFrameEnemyWrapper = hitscanBuf[0];

    // Second frame refills identical array without allocating new HitscanTarget wrappers
    hitscanBuf.length = 0;
    enemies.fillHitscanTargets(hitscanBuf, onEnemyHit);
    expect(hitscanBuf[0]).toBe(firstFrameEnemyWrapper);

    hitscanBuf[0].onHit(30, true, hitscanBuf[0].position, 'head');
    expect(onEnemyHit).toHaveBeenCalledTimes(1);

    enemies.clear();
    air.clear();
    vehicles.clear();
    rm.disposeAll();
  });

  it('REP-10: procedural rig builders + 12-cycle multi-mission ResourceManager load/unload produces zero resource leaks', () => {
    const rm = new ResourceManager();
    const assets = new AssetManager(rm);
    const scene = new THREE.Scene();

    // Verify rig builders independently
    const soldier = buildSoldierRig('#ef4444', 'heavy_armor', 'mission:rig_unit', rm);
    expect(soldier.root.children.length).toBeGreaterThanOrEqual(4);
    const veh = buildVehicleRig('enemy_apc', true, 'mission:rig_unit', rm);
    expect(veh.wheels.length).toBe(6);
    expect(veh.fpvHiddenMeshes.length).toBe(2);
    const air = buildAirRig('gunship', 'mission:rig_unit', rm);
    expect(air.rotor).not.toBeNull();
    rm.unloadScope('mission:rig_unit');

    rm.recordBaseline();

    // Stress-test 12 consecutive mission load + build + rig + unload cycles
    const vfx = new VFXPool(scene, rm);
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const chunkMgr = new WorldChunkManager();
    for (let i = 0; i < 12; i++) {
      const missionId = ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5;
      const scope: ResourceScope = `mission:${missionId}`;
      const mission = getMissionById(missionId);
      const cw = new CollisionWorld();
      const destruction = new DestructionSystem(cw.physicsWorld, vfx, audio);
      const ctrl = rm.createAbortController(scope);

      buildWorldMap(mission.mapId, missionId, scene, assets, rm, cw, chunkMgr, destruction);
      setupLightingRig(scene, mission.lighting, 1024, 60, rm);
      buildSoldierRig('#f97316', 'infantry', scope, rm);
      buildVehicleRig('military_jeep', false, scope, rm);
      buildAirRig('helicopter', scope, rm);

      expect(ctrl.signal.aborted).toBe(false);
      rm.unloadScope('mission:lights');
      rm.unloadScope(scope);
      destruction.dispose();
      chunkMgr.clear(scene);
      cw.clear();
      expect(ctrl.signal.aborted).toBe(true);

      const delta = rm.auditTransitionDelta();
      expect(delta.hasMissionLeak).toBe(false);
      expect(delta.missionRemaining).toBe(0);
    }

    rm.disposeAll();
  });

  it('zero-alloc BallisticSolver.checkLineOfSight reuses result object while preserving ignoreColliderId and wall obstruction accuracy', () => {
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const telemetry = new CombatTelemetryRecorder();
    const ballistics = new BallisticSolver(null, telemetry);
    const collision = new CollisionWorld();
    const player = new PlayerController(audio);
    player.spawn(0, 0, 20);

    // Self vehicle hull right in front of turret + unrelated solid wall further along the line
    collision.addStaticBox({
      id: 'self_hull',
      minX: -1.5,
      minY: 0,
      minZ: -2,
      maxX: 1.5,
      maxY: 2.5,
      maxZ: 2,
      layer: COLLISION_LAYER.VEHICLE,
    });
    collision.addStaticBox({
      id: 'stone_wall',
      minX: -3,
      minY: 0,
      minZ: 9,
      maxX: 3,
      maxY: 3.5,
      maxZ: 10.5,
      layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
    });

    // Ignoring self_hull should still hit stone_wall!
    const blockedRes = ballistics.checkLineOfSight(0, 1.8, 0, player, collision, 50, 'self_hull');
    expect(blockedRes.visible).toBe(false);
    expect(blockedRes.blockerId).toBe('stone_wall');

    // Moving player in front of stone_wall -> LOS clears and reuses same result wrapper reference
    player.spawn(0, 0, 7);
    const clearRes = ballistics.checkLineOfSight(0, 1.8, 0, player, collision, 50, 'self_hull');
    expect(clearRes).toBe(blockedRes);
    expect(clearRes.visible).toBe(true);
    expect(clearRes.exposedZone).toBe('upper_torso');

    rm.disposeAll();
  });

  it('AudioManager dispose and repeated mission:audio restart cycles leave zero leaked audio nodes', () => {
    const stopped: number[] = [];
    const disconnected: number[] = [];
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const makeGain = () => ({
      gain: {
        value: 1,
        setTargetAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(() => {
        disconnected.push(1);
      }),
    });
    const fakeCtx = {
      state: 'running' as AudioContextState,
      sampleRate: 44100,
      currentTime: 0,
      destination: {},
      listener: {},
      suspend: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      close: closeSpy,
      createGain: makeGain,
      createBiquadFilter: () => ({
        type: 'lowpass',
        frequency: { value: 260 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createBuffer: (_ch: number, len: number) => ({
        getChannelData: () => new Float32Array(len),
      }),
      createBufferSource: () => ({
        buffer: null,
        loop: false,
        connect: vi.fn(),
        disconnect: vi.fn(() => {
          disconnected.push(1);
        }),
        start: vi.fn(),
        stop: vi.fn(() => {
          stopped.push(1);
        }),
      }),
    };
    const FakeAudioContext = vi.fn(function FakeCtx() {
      return fakeCtx;
    });
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const rm = new ResourceManager();
    const audio = new AudioManager(rm, { ...SettingsBundleSchema.parse({}).audio, muted: false });
    audio.unlock();
    rm.recordBaseline();

    for (let cycle = 0; cycle < 5; cycle++) {
      audio.startMissionAmbienceAndMusic();
      expect(rm.getSnapshot().missionCount).toBe(1);
      if (cycle % 2 === 0) {
        audio.stopMissionLoops();
        expect(rm.getSnapshot().missionCount).toBe(0);
      }
      rm.unloadScope('mission:audio');
      expect(rm.getSnapshot().missionCount).toBe(0);
    }

    audio.dispose();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(stopped.length).toBe(5);
    expect(disconnected.length).toBeGreaterThanOrEqual(5);

    // Post-dispose playback calls must safely no-op without throwing
    expect(() => audio.play2D('ui_click', 3, 0.4)).not.toThrow();
    expect(() => audio.startMissionAmbienceAndMusic()).not.toThrow();
    expect(rm.getSnapshot().missionCount).toBe(0);

    vi.unstubAllGlobals();
    rm.disposeAll();
  });

  it('EnemyManager, AirCombatManager, and VehicleManager clear() release pools and refill cleanly on mission reload', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const ballistics = new BallisticSolver(vfx, telemetry);
    const projectiles = new ProjectileManager(scene, rm, vfx, audio);
    const collision = new CollisionWorld();

    const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, undefined, ballistics, telemetry);
    const air = new AirCombatManager(scene, rm, vfx, audio, undefined, ballistics, telemetry);
    const vehicles = new VehicleManager(scene, rm, vfx, audio, undefined, ballistics, telemetry);

    enemies.spawnWave('infantry', 3, { x: 0, y: 0, z: -20 }, 4, collision, 'mission:1');
    air.spawnUnit('helicopter', 24, 30, 0, 'mission:1');
    vehicles.spawnVehicle('enemy_apc', { x: 10, y: 0, z: -25 }, 0, true, false, collision, 'mission:1');

    const buf: HitscanTarget[] = [];
    enemies.fillHitscanTargets(buf, () => {});
    air.fillHitscanTargets(buf, () => {});
    vehicles.fillHitscanTargets(buf, () => {});
    expect(buf).toHaveLength(5);

    enemies.clear();
    air.clear();
    vehicles.clear();
    expect(enemies.getActiveCount()).toBe(0);
    expect(air.getUnits()).toHaveLength(0);
    expect(vehicles.getVehicles()).toHaveLength(0);

    // Reloading mission refills cleanly without stale units
    enemies.spawnWave('elite_assault', 1, { x: 0, y: 0, z: -15 }, 2, collision, 'mission:2');
    buf.length = 0;
    enemies.fillHitscanTargets(buf, () => {});
    air.fillHitscanTargets(buf, () => {});
    vehicles.fillHitscanTargets(buf, () => {});
    expect(buf).toHaveLength(1);
    expect(buf[0].alive).toBe(true);

    enemies.clear();
    air.clear();
    vehicles.clear();
    rm.disposeAll();
  });
});
