import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG } from '@/src/data/missions';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager, EnemyUnit } from '@/src/gameplay/EnemyManager';
import { ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { HealthPickupManager } from '@/src/gameplay/HealthPickupManager';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { VehicleCameraRig } from '@/src/gameplay/VehicleCameraRig';
import {
  VEHICLE_REVERSE_CONFIRM_SEC,
  VehicleManager,
} from '@/src/gameplay/VehicleManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { DEFAULT_SETTINGS } from '@/src/schemas/settings.schema';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import {
  computeMobileHudLayout,
  computeMobileVehicleHudLayout,
} from '@/src/ui/hud/mobileHudLayoutEngine';
import { DestructionSystem } from '@/src/world/DestructionSystem';

describe('VANGUARD: ZERO HOUR — Player Feedback Repairs (FND-14 through FND-19)', () => {
  let resourceManager: ResourceManager;
  let audio: AudioManager;
  let input: InputManager;
  let collision: CollisionWorld;

  beforeEach(() => {
    resourceManager = new ResourceManager();
    audio = new AudioManager(resourceManager, {
      masterVolume: 0.5,
      sfxVolume: 0.5,
      musicVolume: 0.2,
      ambienceVolume: 0.2,
      muted: true,
    });
    input = new InputManager(
      resourceManager,
      DEFAULT_SETTINGS.input,
      () => {},
      () => {}
    );
    collision = new CollisionWorld();
    collision.setTerrainHeightFn((_x: number, _z: number) => 0);
  });

  describe('FND-14 — Player Movement & Input Reliability (Requirements 1 & 2)', () => {
    it('supports WASD and Arrow keys for 8-direction normalized movement and camera-relative strafing', () => {
      const target = document.createElement('div');
      input.attach(target);

      // Hold ArrowLeft -> strafe left (-1)
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' }));
      expect(input.getMoveAxes()).toEqual({ forward: 0, right: -1 });

      // Hold ArrowUp + ArrowRight -> normalized diagonal (0.7071, 0.7071)
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft', key: 'ArrowLeft' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' }));
      const diag = input.getMoveAxes();
      expect(diag.forward).toBeCloseTo(Math.SQRT1_2, 4);
      expect(diag.right).toBeCloseTo(Math.SQRT1_2, 4);
      expect(Math.hypot(diag.forward, diag.right)).toBeCloseTo(1.0, 4);

      // Verify camera-relative strafe across 4 yaw orientations
      const player = new PlayerController(audio);
      const yaws = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      for (const yaw of yaws) {
        player.spawn(0, 1.7, 0, yaw);
        input.clearAllInputs();
        input.setVirtualMoveAxes(0, 1); // pure right strafe
        for (let i = 0; i < 10; i++) {
          player.update(1 / 60, input, collision, false, 1.0, 0, false);
        }
        const expectedRightX = Math.cos(yaw);
        const expectedRightZ = -Math.sin(yaw);
        const dotRight =
          player.position.x * expectedRightX + player.position.z * expectedRightZ;
        expect(dotRight).toBeGreaterThan(0.25);
      }
    });

    it('maintains diagonal sprint (W+A / W+D) and allows lateral steering during slide', () => {
      const player = new PlayerController(audio);
      player.spawn(0, 1.7, 0, 0);

      // Diagonal forward-right + sprint
      input.setVirtualMoveAxes(0.75, 0.65);
      input.setVirtualActionState('sprint', true);
      for (let i = 0; i < 15; i++) {
        player.update(1 / 60, input, collision, false, 1.0, 0, false);
      }
      expect(player.isSprinting).toBe(true);
      expect(player.position.x).toBeGreaterThan(0.3);
      expect(player.position.z).toBeLessThan(-0.3);

      // Trigger slide and steer left while sliding
      input.setVirtualActionState('crouch', true);
      input.setVirtualMoveAxes(0.8, -0.9);
      const xBeforeSteer = player.position.x;
      for (let i = 0; i < 12; i++) {
        player.update(1 / 60, input, collision, false, 1.0, 0, false);
      }
      expect(player.isSliding).toBe(true);
      expect(player.velocity.x).toBeLessThan(0.5);
      expect(player.position.x - xBeforeSteer).toBeLessThan(0.5);
    });

    it('clears all virtual and keyboard inputs and notifies listeners on clearAllInputs()', () => {
      let clearedCount = 0;
      const unsub = input.onVirtualInputsCleared(() => {
        clearedCount++;
      });

      input.setVirtualMoveAxes(0.9, -0.8);
      input.setVirtualVehiclePedal('gas', 1);
      input.setVirtualVehicleSteerButton('left', true);
      input.setVirtualActionState('fire', true);

      input.clearAllInputs();
      expect(clearedCount).toBeGreaterThanOrEqual(1);
      expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });
      expect(input.getVehicleControls()).toEqual({
        gas: 0,
        brakeReverse: 0,
        steer: 0,
        handbrake: false,
      });
      expect(input.isActionHeld('fire')).toBe(false);
      unsub();
    });
  });

  describe('FND-15 — Vehicle Physics, Hysteresis Reverse & Chase Camera (Requirement 3)', () => {
    it('steers left/right progressively, transitions smoothly from brake to reverse with hysteresis, and stays independent of camera look', () => {
      const scene = new THREE.Scene();
      const vfx = new VFXPool(scene, resourceManager);
      const telemetry = new CombatTelemetryRecorder();
      const coordinator = new CombatEngagementCoordinator(telemetry);
      const ballistics = new BallisticSolver(vfx, telemetry);
      const vehicles = new VehicleManager(
        scene,
        resourceManager,
        vfx,
        audio,
        coordinator,
        ballistics,
        telemetry
      );
      const player = new PlayerController(audio);
      player.spawn(0, 1.7, 2, 0);
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);

      const jeep = vehicles.spawnVehicle(
        'military_jeep',
        { x: 0, y: 0, z: 0 },
        0,
        false,
        false,
        collision,
        'mission:1'
      );
      vehicles.togglePlayerVehicle(player, collision);
      expect(jeep.occupiedByPlayer).toBe(true);

      // 1. Accelerate forward + steer left (A / touch left) while rotating camera look independently
      input.setVirtualVehiclePedal('gas', 1);
      input.setVirtualVehicleSteerButton('left', true);
      input.addVirtualLookDelta(180, -25);

      const startYaw = jeep.yaw;
      for (let i = 0; i < 45; i++) {
        const hadManualLook = input.hasPendingLookDelta();
        vehicles.update(
          1 / 60,
          input,
          player,
          camera,
          collision,
          [],
          () => {},
          () => {},
          75,
          hadManualLook
        );
      }
      expect(jeep.speed).toBeGreaterThan(4.0);
      expect(jeep.driveGear).toBe('FORWARD');
      expect(jeep.steerAngle).toBeLessThan(-0.15);
      expect(jeep.yaw).toBeGreaterThan(startYaw + 0.15);

      // 2. Release steering -> steerAngle smoothly self-centers toward 0
      input.setVirtualVehicleSteerButton('left', false);
      const peakSteerMag = Math.abs(jeep.steerAngle);
      for (let i = 0; i < 20; i++) {
        vehicles.update(1 / 60, input, player, camera, collision, [], () => {}, () => {}, 75, false);
      }
      expect(Math.abs(jeep.steerAngle)).toBeLessThan(peakSteerMag * 0.4);

      // 3. Release gas and hold Brake/Reverse -> vehicle brakes first (BRAKING -> NEUTRAL_HOLD -> REVERSE)
      input.setVirtualVehiclePedal('gas', 0);
      input.setVirtualVehiclePedal('brakeReverse', 1);

      let sawBraking = false;
      let sawNeutralHold = false;
      for (let i = 0; i < 180; i++) {
        vehicles.update(1 / 60, input, player, camera, collision, [], () => {}, () => {}, 75, false);
        if (jeep.driveGear === 'BRAKING') sawBraking = true;
        if (jeep.driveGear === 'NEUTRAL_HOLD') sawNeutralHold = true;
        if (jeep.driveGear === 'REVERSE' && jeep.speed < -2.0) break;
      }
      expect(sawBraking).toBe(true);
      expect(sawNeutralHold).toBe(true);
      expect(jeep.driveGear).toBe('REVERSE');
      expect(jeep.speed).toBeLessThan(-1.5);
      expect(VEHICLE_REVERSE_CONFIRM_SEC).toBeGreaterThanOrEqual(0.12);
    });

    it('smoothly aligns chase camera with vehicle heading when not manually looking and preserves manual look during hold window', () => {
      const scene = new THREE.Scene();
      const vfx = new VFXPool(scene, resourceManager);
      const vehicles = new VehicleManager(scene, resourceManager, vfx, audio);
      const jeep = vehicles.spawnVehicle(
        'military_jeep',
        { x: 0, y: 0, z: 0 },
        0,
        false,
        false,
        collision,
        'mission:1'
      );
      const rig = new VehicleCameraRig();
      const player = new PlayerController(audio);
      player.spawn(0, 1.7, 0, 0);
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);

      rig.resetForVehicleEntry(jeep, player);
      // Vehicle turns to yaw = +0.8 rad at speed = 12 m/s without manual camera input -> player.yaw follows smoothly
      jeep.yaw = 0.8;
      jeep.speed = 12;
      for (let i = 0; i < 60; i++) {
        rig.updateCamera(1 / 60, jeep, player, camera, collision, 75, false);
      }
      expect(player.yaw).toBeGreaterThan(0.5);

      // Manual camera drag overrides auto-follow for 1.15s
      player.yaw = -0.7;
      rig.notifyManualLookInput();
      expect(rig.getManualLookHoldTimer()).toBeGreaterThan(1.0);
      rig.updateCamera(1 / 60, jeep, player, camera, collision, 75, false);
      expect(player.yaw).toBeCloseTo(-0.7, 4);
    });
  });

  describe('FND-16 & FND-17 — Structured Mission Instructions & Versioned Briefings (Requirement 4)', () => {
    it('provides structured actionMeta for all objectives and derives platform-specific directives', () => {
      for (const m of MISSION_CATALOG) {
        expect(m.missionKey.length).toBeGreaterThan(5);
        expect(m.briefingVersion).toBe('v1.2');
        expect(m.threatSummary.length).toBeGreaterThanOrEqual(2);
        expect(m.requiredActionsSummary.length).toBeGreaterThanOrEqual(2);
        for (const obj of m.objectives) {
          expect(obj.actionMeta).toBeDefined();
        }
      }

      const director = new MissionDirector(MISSION_CATALOG[0], 'normal');
      const touchDir = director.getActiveActionDirective('touch', false, false);
      const desktopDir = director.getActiveActionDirective('keyboard', false, false);
      expect(touchDir).toContain('NEXT ACTION:');
      expect(desktopDir).toContain('[LMB] Fire');

      // Complete first objective -> directive advances to AA Radars with [RPG] / [7] RPG
      for (let i = 0; i < 10; i++) {
        director.onEnemyKilled(false, 100);
      }
      expect(director.getActiveActionDirective('touch', false, false)).toContain('tap [RPG]');
      expect(director.getActiveActionDirective('keyboard', false, false)).toContain('press [7] RPG');
    });

    it('tracks seenMissionBriefings by (missionKey, briefingVersion) so updated versions require review', () => {
      const store = missionSelectionStore.getState();
      store.markMissionBriefingSeen('mission_1_dawn_spear', 'v1.1');

      expect(
        missionSelectionStore.getState().hasSeenMissionBriefing('mission_1_dawn_spear', 'v1.1')
      ).toBe(true);
      expect(
        missionSelectionStore.getState().hasSeenMissionBriefing('mission_1_dawn_spear', 'v1.2')
      ).toBe(false);

      store.markMissionBriefingSeen('mission_1_dawn_spear', 'v1.2');
      expect(
        missionSelectionStore.getState().hasSeenMissionBriefing('mission_1_dawn_spear', 'v1.2')
      ).toBe(true);
    });
  });

  describe('FND-18 — Collectible 3D Heart Health Pickups & Resource Ownership (Requirement 5)', () => {
    it('heals damaged players (+35 HP clamped to 100), does not consume at full health, and prevents duplicate enemy drops or double-dispose', () => {
      const scene = new THREE.Scene();
      const vfx = new VFXPool(scene, resourceManager);
      const manager = new HealthPickupManager(scene, resourceManager, vfx, audio);
      const player = new PlayerController(audio);

      manager.spawnPickup({ x: 0, y: 0, z: 0 }, 'map_station', 'mission:1');
      expect(manager.getActiveCount()).toBe(1);

      // 1. Full health (100/100) player walks over pickup -> NOT consumed
      player.spawn(0, 1.7, 0, 0);
      expect(player.health).toBe(100);
      let subtitleMsg = '';
      manager.update(
        0.1,
        player,
        false,
        () => {},
        (sub) => {
          subtitleMsg = sub;
        }
      );
      expect(manager.getActiveCount()).toBe(1);
      expect(subtitleMsg).toContain('Health already full');

      // 2. Damaged player (50/100) walks over pickup -> consumed, heals +35 -> 85 HP
      player.health = 50;
      let alertMsg = '';
      manager.update(
        0.1,
        player,
        false,
        (msg) => {
          alertMsg = msg;
        }
      );
      expect(player.health).toBe(85);
      expect(manager.getActiveCount()).toBe(0);
      expect(alertMsg).toContain('+35 HP');

      // 3. Single-evaluation guard per enemy death
      const fakeEnemy = {
        id: 'enemy_test_99',
        position: new THREE.Vector3(4, 0, 4),
        healthDropEvaluated: false,
      } as unknown as EnemyUnit;

      // Force low player health (20 HP => 55% drop chance) and evaluate twice on the same enemy
      player.health = 20;
      const origRandom = Math.random;
      Math.random = () => 0.1; // guaranteed drop on first evaluation
      try {
        const firstDrop = manager.tryEvaluateEnemyDrop(fakeEnemy, player.health, 100, 'mission:1');
        const secondDrop = manager.tryEvaluateEnemyDrop(fakeEnemy, player.health, 100, 'mission:1');
        expect(firstDrop).toBe(true);
        expect(secondDrop).toBe(false);
        expect(fakeEnemy.healthDropEvaluated).toBe(true);
        expect(manager.getActiveEnemyDropCount()).toBe(1);
      } finally {
        Math.random = origRandom;
      }

      // 4. Clean scope unload without throwing or double-disposing shared geometries
      manager.clear();
      expect(() => resourceManager.unloadScope('mission:1')).not.toThrow();
      expect(() => resourceManager.unloadScope('mission:world')).not.toThrow();
    });
  });

  describe('FND-19 — Slot 7 RPG / Bazooka, Blast Occlusion & Self-Damage Cap (Requirement 6)', () => {
    it('equips Slot 7 rocket_launcher, caps player self-damage at 45 HP, and blocks splash behind solid walls', () => {
      const viewScene = new THREE.Scene();
      const worldScene = new THREE.Scene();
      const vfx = new VFXPool(worldScene, resourceManager);
      const telemetry = new CombatTelemetryRecorder();
      const projectiles = new ProjectileManager(worldScene, resourceManager, vfx, audio, telemetry);
      const weapons = new WeaponSystem(viewScene, audio, vfx, projectiles);

      weapons.resetLoadout('assault_rifle');
      const rpgState = weapons.getWeaponState('rocket_launcher');
      expect(rpgState).toBeDefined();
      expect(WEAPON_BY_ID.rocket_launcher.slot).toBe(7);
      expect(rpgState?.ammoInMag).toBe(1);
      expect(rpgState?.reserveAmmo).toBe(7);

      // Queue Slot 7 -> switches to RPG-7V without firing
      input.queueWeaponSlot(7);
      const player = new PlayerController(audio);
      player.spawn(0, 1.7, 0, 0);
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
      weapons.update(0.1, input, player, camera, collision, [], [], () => {}, false);
      expect(weapons.getActiveState().config.id).toBe('rocket_launcher');
      expect(weapons.shotsFired).toBe(0);

      // Verify ExplosiveManager self-damage cap (<= 45 HP) and solid wall occlusion
      const explosives = new ExplosiveManager(
        worldScene,
        resourceManager,
        vfx,
        audio,
        projectiles,
        telemetry
      );
      const coordinator = new CombatEngagementCoordinator(telemetry);
      const ballistics = new BallisticSolver(vfx, telemetry);
      const enemies = new EnemyManager(
        worldScene,
        resourceManager,
        vfx,
        audio,
        projectiles,
        coordinator,
        ballistics,
        telemetry
      );
      const vehicles = new VehicleManager(
        worldScene,
        resourceManager,
        vfx,
        audio,
        coordinator,
        ballistics,
        telemetry
      );
      const airCombat = new AirCombatManager(
        worldScene,
        resourceManager,
        vfx,
        audio,
        coordinator,
        ballistics,
        telemetry
      );
      const destruction = new DestructionSystem(collision.physicsWorld, vfx, audio);

      // Point-blank player rocket detonation -> self-damage capped at 45 total raw damage
      player.spawn(0, 1.7, 0, 0);
      player.armor = 0;
      player.health = 100;
      explosives.resolveExplosion(
        {
          explosiveId: 'rocket',
          category: 'launcher',
          x: 0.5,
          y: 1.0,
          z: 0.5,
          innerRadius: 2.2,
          radius: 7.8,
          damage: 260,
          falloffExponent: 1.35,
          vehicleDamageMultiplier: 1.65,
          destructionPower: 1.8,
          fromPlayer: true,
          sourceUnitId: 'player',
          sourceSquadId: 'player',
          sourceDomain: 'ground',
        },
        player,
        collision,
        enemies,
        vehicles,
        airCombat,
        destruction,
        false,
        {
          onEnemyKilled: () => {},
          onAirKilled: () => {},
          onConvoyDestroyed: () => {},
          onDestructibleDestroyed: () => {},
          onAlert: () => {},
        }
      );
      expect(player.health).toBeGreaterThanOrEqual(55);

      // Solid building wall between blast and enemy completely blocks splash damage
      collision.addStaticBox({
        id: 'solid_wall_1',
        minX: -4.0,
        minY: 0,
        minZ: -0.5,
        maxX: 4.0,
        maxY: 4.5,
        maxZ: 0.5,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_wall',
      });
      enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: 3.0 }, 0.01, collision, 'mission:1');
      const unit = enemies.getUnits()[0];
      const startEnemyHp = unit.health;

      explosives.resolveExplosion(
        {
          explosiveId: 'rocket',
          category: 'launcher',
          x: 0,
          y: 1.0,
          z: -3.0,
          innerRadius: 2.2,
          radius: 8.5,
          damage: 260,
          falloffExponent: 1.35,
          vehicleDamageMultiplier: 1.65,
          destructionPower: 1.8,
          fromPlayer: true,
          sourceUnitId: 'player',
          sourceSquadId: 'player',
          sourceDomain: 'ground',
        },
        player,
        collision,
        enemies,
        vehicles,
        airCombat,
        destruction,
        false,
        {
          onEnemyKilled: () => {},
          onAirKilled: () => {},
          onConvoyDestroyed: () => {},
          onDestructibleDestroyed: () => {},
          onAlert: () => {},
        }
      );
      expect(unit.health).toBe(startEnemyHp);
    });
  });

  describe('HUD Layout Engine — Zero Overlap Across Infantry & Vehicle Modes (Requirement 8)', () => {
    it('guarantees zero overlapping controls across viewports for both Infantry and Vehicle HUDs', () => {
      const viewports = [
        { width: 844, height: 390 },
        { width: 915, height: 412 },
        { width: 844, height: 315 },
        { width: 1024, height: 768 },
      ];

      const inputCfg = settingsStore.getState().input;
      for (const vp of viewports) {
        const infLayout = computeMobileHudLayout(inputCfg, vp, {
          inVehicle: false,
          grenadeCount: 2,
          c4DeployedCount: 1,
        });
        expect(infLayout.overlappingPairs).toEqual([]);

        const vehButtonsLayout = computeMobileVehicleHudLayout(
          { ...inputCfg, touchVehicleSteeringMode: 'buttons', touchVehicleLeftHanded: false },
          vp
        );
        expect(vehButtonsLayout.overlappingPairs).toEqual([]);

        const vehWheelLeftLayout = computeMobileVehicleHudLayout(
          { ...inputCfg, touchVehicleSteeringMode: 'wheel', touchVehicleLeftHanded: true },
          vp
        );
        expect(vehWheelLeftLayout.overlappingPairs).toEqual([]);
      }
    });
  });
});
