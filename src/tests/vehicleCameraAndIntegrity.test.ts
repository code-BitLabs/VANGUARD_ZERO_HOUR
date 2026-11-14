import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { AudioSettingsSchema, SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { createDestructibleCollider, DestructionSystem } from '@/src/world/DestructionSystem';

describe('Vehicle Camera System, Rig Integrity, Grenade CCD & Destruction Parity', () => {
  let scene: THREE.Scene;
  let resources: ResourceManager;
  let vfx: VFXPool;
  let audio: AudioManager;
  let telemetry: CombatTelemetryRecorder;
  let coordinator: CombatEngagementCoordinator;
  let collision: CollisionWorld;
  let player: PlayerController;
  let vehicles: VehicleManager;
  let input: InputManager;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    scene = new THREE.Scene();
    resources = new ResourceManager();
    vfx = new VFXPool(scene, resources);
    audio = new AudioManager(resources, AudioSettingsSchema.parse({ muted: true }));
    telemetry = new CombatTelemetryRecorder();
    coordinator = new CombatEngagementCoordinator(telemetry);
    collision = new CollisionWorld();
    player = new PlayerController(audio);
    player.spawn(0, 0, 2, Math.PI * 0.5);
    vehicles = new VehicleManager(scene, resources, vfx, audio, coordinator, undefined, telemetry);
    input = new InputManager(resources, SettingsBundleSchema.parse({}).input);
    camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 320);
  });

  it('positions Chase Camera cleanly outside Strike Jeep with unobstructed forward sightline (fixes green-block bug)', () => {
    vehicles.spawnVehicle('military_jeep', { x: 0, y: 0, z: 0 }, 0, false, false, collision, 'mission:1');
    const jeep = vehicles.getVehicles()[0];

    const entered = vehicles.togglePlayerVehicle(player, collision);
    expect(entered).toBe(true);
    expect(jeep.occupiedByPlayer).toBe(true);
    // Aligns look direction to vehicle forward on entry
    expect(player.yaw).toBeCloseTo(jeep.yaw, 3);

    for (let i = 0; i < 10; i++) {
      vehicles.update(1 / 60, input, player, camera, collision, [], () => {});
    }
    jeep.meshRoot.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    // Must NOT snap to 1.8m inside the cabin! Nominal chase distance is > 6m
    const camDist = camera.position.distanceTo(jeep.centerPos);
    expect(camDist).toBeGreaterThan(5.5);

    // Camera center ray along view direction must reach past the jeep without hitting any opaque cab block right in front of the lens
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const raycaster = new THREE.Raycaster(camera.position, dir, 0.05, 4.0);
    const opaqueMeshes: THREE.Object3D[] = [];
    jeep.meshRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.visible) {
        const mat = obj.material as THREE.Material;
        if (!mat.transparent) {
          opaqueMeshes.push(obj);
        }
      }
    });
    const hits = raycaster.intersectObjects(opaqueMeshes, false);
    // Any hit inside 3.0m of camera lens means the camera view is occluded by vehicle geometry!
    const nearHits = hits.filter((h) => h.distance < 3.0);
    expect(nearHits).toHaveLength(0);
  });

  it('clamps vehicle Chase Camera against rear walls cleanly without ever dipping inside cabin or wall', () => {
    vehicles.spawnVehicle('military_jeep', { x: 0, y: 0, z: 0 }, 0, false, false, collision, 'mission:1');
    // Solid building wall 4.6m behind the jeep (z = +4.6..+5.6)
    collision.addStaticBox({
      id: 'rear_wall',
      minX: -10,
      minY: 0,
      minZ: 4.6,
      maxX: 10,
      maxY: 6,
      maxZ: 5.6,
      layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      tag: 'building_wall',
    });

    vehicles.togglePlayerVehicle(player, collision);
    for (let i = 0; i < 30; i++) {
      vehicles.update(1 / 60, input, player, camera, collision, [], () => {});
    }

    // Camera must clamp in front of rear_wall (z < 4.6) and remain outside the jeep hull (z > 2.2 or y >= 2.55)
    expect(camera.position.z).toBeLessThan(4.55);
    const clearOutsideRear = camera.position.z > 2.25;
    const clearAboveRoof = camera.position.y >= 2.55;
    expect(clearOutsideRear || clearAboveRoof).toBe(true);
  });

  it('supports switching across Chase, Driver FPV, Gunner Turret, and Orbit views with clear sightlines and clean exit', () => {
    vehicles.spawnVehicle('military_jeep', { x: 0, y: 0, z: 0 }, 0, false, false, collision, 'mission:1');
    const jeep = vehicles.getVehicles()[0];
    vehicles.togglePlayerVehicle(player, collision);

    expect(vehicles.getCameraMode()).toBe('chase');

    // Cycle -> driver_fpv
    expect(vehicles.cycleCameraMode()).toBe('driver_fpv');
    for (let i = 0; i < 10; i++) {
      vehicles.update(1 / 60, input, player, camera, collision, [], () => {});
    }
    jeep.meshRoot.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    // Driver FPV forward ray through windshield must NOT hit any opaque chassis/cabin block within 20m!
    const fpvDir = new THREE.Vector3();
    camera.getWorldDirection(fpvDir);
    const opaqueMeshes: THREE.Object3D[] = [];
    jeep.meshRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.visible) {
        const mat = obj.material as THREE.Material;
        if (!mat.transparent) {
          opaqueMeshes.push(obj);
        }
      }
    });
    const fpvHits = new THREE.Raycaster(camera.position, fpvDir, 0.05, 20).intersectObjects(opaqueMeshes, false);
    expect(fpvHits).toHaveLength(0);

    // Cycle -> turret
    expect(vehicles.cycleCameraMode()).toBe('turret');
    for (let i = 0; i < 10; i++) {
      vehicles.update(1 / 60, input, player, camera, collision, [], () => {});
    }
    expect(camera.position.y).toBeGreaterThanOrEqual(2.55);

    // Cycle -> orbit -> chase
    expect(vehicles.cycleCameraMode()).toBe('orbit');
    for (let i = 0; i < 10; i++) {
      vehicles.update(1 / 60, input, player, camera, collision, [], () => {});
    }
    expect(camera.position.distanceTo(jeep.centerPos)).toBeGreaterThan(8.5);
    expect(vehicles.cycleCameraMode()).toBe('chase');

    // Exit restores all previously hidden meshes
    vehicles.togglePlayerVehicle(player, collision);
    expect(jeep.occupiedByPlayer).toBe(false);
    let anyHiddenStructural = false;
    jeep.meshRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !obj.visible) anyHiddenStructural = true;
    });
    expect(anyHiddenStructural).toBe(false);
  });

  it('uses YXZ Euler order on vehicle chassis and matches collider extents to vehicle footprint', () => {
    vehicles.spawnVehicle('armored_truck', { x: 0, y: 0, z: 0 }, Math.PI * 0.5, false, false, collision, 'mission:1');
    const truck = vehicles.getVehicles()[0];
    expect(truck.meshRoot.rotation.order).toBe('YXZ');
    // Heavy truck visual length 5.5m -> halfExtZ >= 2.7
    expect(truck.collider.halfExtZ).toBeGreaterThanOrEqual(2.7);
  });

  it('reflects grenades accurately on thin walls without phantom early impact or tunneling (fixed sweptSphereTest args)', () => {
    const projectiles = new ProjectileManager(scene, resources, vfx, audio, telemetry);
    // Thin wall 0.35m thick at z = -5.0..-5.35
    collision.addStaticBox({
      id: 'thin_wall',
      minX: -5,
      minY: 0,
      minZ: -5.35,
      maxX: 5,
      maxY: 6,
      maxZ: -5.0,
      layer: COLLISION_LAYER.WORLD,
    });

    projectiles.spawn({
      kind: 'hand_grenade',
      fromPlayer: true,
      origin: new THREE.Vector3(0, 2.0, -2.5),
      direction: new THREE.Vector3(0, 0, -1),
      speed: 24,
    });

    // At maxSpeed=22 m/s with exponential drag over 1/30s (~0.72m step), step 1 advances cleanly past -3.15 without premature bounce
    projectiles.update(1 / 30, collision, () => {}, []);
    let sample = projectiles.getFlightTelemetrySamples()[0];
    expect(sample.z).toBeLessThan(-3.05);
    expect(sample.z).toBeGreaterThan(-3.5);
    expect(sample.dirZ).toBeLessThan(-0.9); // Still heading forward

    // Advance more frames until it reaches wall at z = -5.0 and reflects back (+Z) without tunneling past z = -5.35
    for (let i = 0; i < 15; i++) {
      projectiles.update(1 / 30, collision, () => {}, []);
    }
    sample = projectiles.getFlightTelemetrySamples()[0];
    expect(sample.z).toBeGreaterThan(-5.0);
    expect(sample.dirZ).toBeGreaterThan(0);
  });

  it('synchronizes DestructionSystem registration, damage resize, destruction removal, and clear with PhysicsWorld', () => {
    const destruction = new DestructionSystem(collision.physicsWorld, vfx, audio);
    const group = new THREE.Group();
    const col = createDestructibleCollider('sync_barrier_1', 0, 0, -10, 2.0, 1.5, 0.6);
    destruction.register({
      id: 'sync_barrier_1',
      kind: 'destructible_barrier',
      isObjectiveTarget: false,
      position: new THREE.Vector3(0, 0, -10),
      health: 100,
      maxHealth: 100,
      state: 'INTACT',
      blastRadius: 0,
      blastDamage: 0,
      meshGroup: group,
      collider: col,
    });

    expect(collision.spatialHash.getBoxCount()).toBe(1);

    // Damage below 50% shrinks height to 65%
    destruction.applyDamage('sync_barrier_1', 60);
    expect(col.maxY).toBeCloseTo(1.5 * 0.65, 3);

    // Destroy removes from both SpatialHash and PhysicsWorld
    destruction.applyDamage('sync_barrier_1', 50);
    expect(collision.spatialHash.getBoxCount()).toBe(0);
    expect(collision.physicsWorld.getStaticColliderIds()).not.toContain('sync_barrier_1');
  });
});
