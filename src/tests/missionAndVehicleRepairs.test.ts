import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { getMissionById } from '@/src/data/missions';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { DIFFICULTY_COMBAT_PROFILES } from '@/src/schemas/combat.schema';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { WorkerBridge } from '@/src/workers/WorkerBridge';

describe('Mission Filtering, Initial Enemy Grace, Vehicle Turret & OBB Collision Authority', () => {
  it('filters Mission 3 air_defense objectives strictly by targetAirUnitTypes (drones vs helicopters)', () => {
    const m3 = getMissionById(3);
    const dir = new MissionDirector(m3, 'normal');

    // Killing 4 attack drones should only advance the drone objective, not the gunship/helicopter objective
    dir.onAirUnitKilled(200, 'attack_drone');
    dir.onAirUnitKilled(200, 'attack_drone');
    dir.onAirUnitKilled(200, 'attack_drone');
    dir.onAirUnitKilled(200, 'attack_drone');

    let statuses = dir.getObjectiveStatuses();
    const droneObj = statuses.find((o) => o.id === 'obj_night_drones')!;
    const heliObj = statuses.find((o) => o.id === 'obj_night_helis')!;
    expect(droneObj.current).toBe(4);
    expect(droneObj.completed).toBe(true);
    expect(heliObj.current).toBe(0);

    // Killing 2 helicopters + 1 gunship advances obj_night_helis (targetCount=3)
    dir.onAirUnitKilled(350, 'helicopter');
    dir.onAirUnitKilled(350, 'helicopter');
    dir.onAirUnitKilled(350, 'gunship');
    statuses = dir.getObjectiveStatuses();
    expect(statuses.find((o) => o.id === 'obj_night_helis')!.completed).toBe(true);
  });

  it('gives spawned ground enemies difficulty-scaled initialGraceTimerSec and wakes immediately on player gunshot', () => {
    expect(DIFFICULTY_COMBAT_PROFILES.easy.groundInitialGraceSec).toBeGreaterThan(
      DIFFICULTY_COMBAT_PROFILES.normal.groundInitialGraceSec
    );
    expect(DIFFICULTY_COMBAT_PROFILES.normal.groundInitialGraceSec).toBeGreaterThan(
      DIFFICULTY_COMBAT_PROFILES.extreme.groundInitialGraceSec
    );

    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const ballistics = new BallisticSolver(null, telemetry);
    const projectiles = new ProjectileManager(scene, rm, vfx, audio, telemetry);
    const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, undefined, ballistics, telemetry);
    enemies.setDifficulty('normal');

    const collision = new CollisionWorld();
    const player = new PlayerController(audio);
    player.spawn(0, 1.7, 0);
    const stubWorker = { isHealthy: () => false, requestPaths: async () => null } as unknown as WorkerBridge;

    enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: -20 }, 0.5, collision, 'mission:1', 'squad_alpha');
    const unit = enemies.getUnits()[0];
    expect(unit.initialGraceTimerSec).toBeGreaterThan(0);

    // Without gunshot, unit remains UNAWARE during initial grace ticks
    enemies.update(0.1, player, collision, [], stubWorker, 0.1);
    expect(unit.state).toBe('UNAWARE');
    expect(unit.initialGraceTimerSec).toBeGreaterThan(0);

    // Firing a gunshot emits acoustic event within 48m and immediately clears initial grace
    player.emitAcousticEvent(48, telemetry.getElapsedSec());
    enemies.update(0.1, player, collision, [], stubWorker, 0.1);
    expect(unit.initialGraceTimerSec).toBe(0);
    expect(unit.state).toBe('SUSPICIOUS');

    rm.disposeAll();
  });

  it('drives Strike Jeep turret via input.isActionHeld(fire) and applies single OBB collision damage on high-speed wall impact', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const vfx = new VFXPool(scene, rm);
    const vm = new VehicleManager(scene, rm, vfx, audio);
    const collision = new CollisionWorld();
    collision.addStaticBox({
      id: 'wall_test',
      minX: -10,
      minY: 0,
      minZ: -12,
      maxX: 10,
      maxY: 4,
      maxZ: -10,
      layer: COLLISION_LAYER.WORLD,
    });

    const input = new InputManager(rm, SettingsBundleSchema.parse({}).input);
    const player = new PlayerController(audio);
    player.spawn(0, 1.7, 0);
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);

    vm.spawnVehicle('military_jeep', { x: 0, y: 0, z: 0 }, 0, false, false, collision, 'mission:1');
    const jeep = vm.getVehicles()[0];
    jeep.occupiedByPlayer = true;
    jeep.turretFireCooldown = 0;

    const turretHitSpy = vi.fn();
    input.setVirtualActionState('fire', true);
    vm.update(0.016, input, player, camera, collision, [], turretHitSpy);
    expect(turretHitSpy).toHaveBeenCalledTimes(1);

    // Test single authoritative OBB impact damage on collision with wall_test
    const initialHull = jeep.health;
    jeep.position.set(0, 0, -7.8);
    jeep.speed = 20;
    const moveRes = collision.resolveVehicleMovement(
      jeep.position,
      0,
      jeep.speed,
      jeep.halfWidth,
      jeep.halfLength,
      0.05,
      jeep.id,
      jeep.collider.id
    );
    expect(moveRes.hitObstacle).toBe(true);
    expect(moveRes.hullDamageApplied).toBeGreaterThan(0);

    input.setVirtualActionState('fire', false);
    jeep.position.set(0, 0, -7.8);
    jeep.speed = 20;
    vm.update(0.05, input, player, camera, collision, [], turretHitSpy);
    expect(jeep.health).toBeLessThan(initialHull);

    rm.disposeAll();
  });
});
