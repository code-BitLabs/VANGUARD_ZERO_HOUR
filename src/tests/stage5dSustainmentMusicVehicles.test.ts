import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { MUSIC_TRACK_CATALOG, synthesizeMusicTrackBuffer } from '@/src/audio/MusicCatalog';
import { MusicPlayerController, MusicTrackLoader } from '@/src/audio/MusicPlayerController';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG } from '@/src/data/missions';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import {
  DIFFICULTY_RECOVERY_PROFILES,
  SustainmentContext,
  SustainmentEconomyManager,
  SustainmentVehicleTarget,
} from '@/src/gameplay/SustainmentEconomyManager';
import {
  VEHICLE_REVERSE_CONFIRM_SEC,
  VEHICLE_REVERSE_ENTER_SPEED,
  VEHICLE_REVERSE_EXIT_SPEED,
  VehicleManager,
} from '@/src/gameplay/VehicleManager';
import {
  getVehicleHandlingSpec,
  stepVehicleHandling,
} from '@/src/gameplay/vehicle/VehicleHandlingProfile';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { AudioSettingsSchema, InputSettingsSchema } from '@/src/schemas/settings.schema';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

function createMockAudioContext() {
  let ctxTime = 0;
  let activeCreatedSources = 0;
  let activeStoppedSources = 0;
  let currentState: AudioContextState = 'running';

  const makeGain = () => ({
    gain: {
      value: 1,
      setValueAtTime: vi.fn((v: number) => {
        // track value directly
        void v;
      }),
      linearRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(function (this: { value: number }, v: number) {
        this.value = v;
      }),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  const ctx = {
    get currentTime() {
      return ctxTime;
    },
    get state() {
      return currentState;
    },
    sampleRate: 22050,
    destination: {},
    advanceTime(sec: number) {
      ctxTime += sec;
    },
    createGain: vi.fn(() => makeGain()),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
      const chs = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (idx: number) => chs[idx],
      } as unknown as AudioBuffer;
    }),
    createBufferSource: vi.fn(() => {
      activeCreatedSources++;
      let stopped = false;
      const src = {
        buffer: null as AudioBuffer | null,
        loop: false,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(() => {
          if (!stopped) {
            stopped = true;
            activeStoppedSources++;
          }
        }),
      };
      return src;
    }),
    resume: vi.fn(async () => {
      currentState = 'running';
    }),
    suspend: vi.fn(async () => {
      currentState = 'suspended';
    }),
    close: vi.fn(async () => {
      currentState = 'closed';
    }),
    getStats: () => ({
      created: activeCreatedSources,
      stopped: activeStoppedSources,
      live: activeCreatedSources - activeStoppedSources,
    }),
  };

  return ctx as unknown as AudioContext & {
    advanceTime: (sec: number) => void;
    getStats: () => { created: number; stopped: number; live: number };
  };
}

function makeTestSustainmentHarness() {
  const res = new ResourceManager();
  const audio = new AudioManager(res, AudioSettingsSchema.parse({}));
  const scene = new THREE.Scene();
  const vfx = new VFXPool(scene, res);
  const projectiles = new ProjectileManager(scene, res, vfx, audio);
  const weapons = new WeaponSystem(new THREE.Scene(), audio, vfx, projectiles);
  const player = new PlayerController(audio);
  player.spawn(0, 1.7, 0, 0);

  let c4Inv = 3;
  const explosives = {
    getC4Inventory: () => c4Inv,
    resupplyC4: (count: number, maxCap = 3) => {
      const before = c4Inv;
      c4Inv = Math.min(maxCap, c4Inv + count);
      return Math.max(0, c4Inv - before);
    },
    setC4: (v: number) => {
      c4Inv = v;
    },
  };

  const sustainment = new SustainmentEconomyManager();
  const buildCtx = (overrides?: Partial<SustainmentContext>): SustainmentContext => ({
    player,
    weapons,
    explosives,
    playerVehicle: null,
    nearbyFriendlyVehicle: null,
    difficulty: 'normal',
    nowSec: 10,
    ...overrides,
  });

  return { res, audio, weapons, player, explosives, sustainment, buildCtx };
}

describe('Stage 5D Workstream A — Player & Vehicle Sustainment Economy (Adversarial)', () => {
  it('resupplies partially empty ballistic + explosive inventory within strict caps and refuses full capacity with 0 charges consumed', () => {
    const { weapons, player, explosives, sustainment, buildCtx } = makeTestSustainmentHarness();
    const station = sustainment.registerStation({
      id: 'ammo_1',
      kind: 'ammo_crate',
      position: new THREE.Vector3(1.2, 0, 0),
      maxCharges: 2,
    });

    // 1. At full capacity: refuse and consume 0 charges
    player.grenades = 4;
    explosives.setC4(3);
    const fullCheck = sustainment.beginInteraction(buildCtx(), station.id);
    expect(fullCheck.ok).toBe(false);
    expect(fullCheck.code).toBe('already_full');
    expect(station.chargesRemaining).toBe(2);

    // 2. Partially empty rifle, launcher, grenades, and C4
    const rifle = weapons.getWeaponState('assault_rifle')!;
    const rpg = weapons.getWeaponState('rocket_launcher')!;
    const maxRifleReserve = rifle.reserveAmmo;
    const maxRpgReserve = rpg.reserveAmmo;
    rifle.reserveAmmo = 15;
    rpg.reserveAmmo = 0;
    player.grenades = 1;
    explosives.setC4(1);

    const startRes = sustainment.beginInteraction(buildCtx(), station.id);
    expect(startRes.ok).toBe(true);
    expect(startRes.code).toBe('channel_started');

    // Repeated interaction while channeling must be rejected (anti-exploit)
    const spamDuringChannel = sustainment.beginInteraction(buildCtx(), station.id);
    expect(spamDuringChannel.ok).toBe(false);
    expect(spamDuringChannel.code).toBe('anti_spam_guard');

    // Complete 0.55s channel
    let outcome = null;
    for (let i = 0; i < 6; i++) {
      outcome = sustainment.update(0.1, buildCtx());
    }
    expect(outcome?.ok).toBe(true);
    expect(outcome?.code).toBe('completed');
    expect(station.chargesRemaining).toBe(1);
    expect(rifle.reserveAmmo).toBeGreaterThan(15);
    expect(rifle.reserveAmmo).toBeLessThanOrEqual(maxRifleReserve);
    expect(rpg.reserveAmmo).toBe(1); // separate capped explosive grant (not unlimited)
    expect(rpg.reserveAmmo).toBeLessThanOrEqual(maxRpgReserve);
    expect(player.grenades).toBe(2);
    expect(explosives.getC4Inventory()).toBe(2);

    // Immediate repeated interaction after completion must be blocked by global repeat guard + cooldown
    const immediateRepeat = sustainment.beginInteraction(buildCtx(), station.id);
    expect(immediateRepeat.ok).toBe(false);
    expect(['anti_spam_guard', 'cooldown']).toContain(immediateRepeat.code);
  });

  it('interrupts ammo resupply cleanly on weapon switch or operator death without consuming station charges', () => {
    const { weapons, player, sustainment, buildCtx } = makeTestSustainmentHarness();
    const station = sustainment.registerStation({
      id: 'ammo_interrupt',
      kind: 'ammo_crate',
      position: new THREE.Vector3(1, 0, 0),
      maxCharges: 2,
    });

    weapons.getWeaponState('assault_rifle')!.reserveAmmo = 0;

    // Case A: Switch weapon mid-channel
    expect(sustainment.beginInteraction(buildCtx(), station.id).ok).toBe(true);
    sustainment.update(0.2, buildCtx());
    weapons.selectWeapon('pistol', true);
    const switchResult = sustainment.update(0.1, buildCtx());
    expect(switchResult?.ok).toBe(false);
    expect(switchResult?.code).toBe('interrupted_weapon_switch');
    expect(station.chargesRemaining).toBe(2);
    expect(weapons.getWeaponState('assault_rifle')!.reserveAmmo).toBe(0);

    // Case B: Player dies mid-channel
    expect(sustainment.beginInteraction(buildCtx(), station.id).ok).toBe(true);
    sustainment.update(0.2, buildCtx());
    player.alive = false;
    const deathResult = sustainment.update(0.1, buildCtx());
    expect(deathResult?.ok).toBe(false);
    expect(deathResult?.code).toBe('interrupted_death');
    expect(station.chargesRemaining).toBe(2);
  });

  it('preserves consumed & destroyed station states across checkpoint restore and deploys one-time emergency ordnance pod on exhaustion', () => {
    const { weapons, player, explosives, sustainment, buildCtx } = makeTestSustainmentHarness();
    const st1 = sustainment.registerStation({
      id: 'ammo_cp_1',
      kind: 'ammo_crate',
      position: new THREE.Vector3(1, 0, 0),
      maxCharges: 1,
    });
    const st2 = sustainment.registerStation({
      id: 'ammo_cp_2',
      kind: 'ammo_crate',
      position: new THREE.Vector3(10, 0, 0),
      maxCharges: 2,
    });

    // Consume st1 & destroy st2 via explosion
    weapons.getWeaponState('assault_rifle')!.reserveAmmo = 0;
    sustainment.beginInteraction(buildCtx(), st1.id);
    for (let i = 0; i < 6; i++) sustainment.update(0.1, buildCtx());
    expect(st1.chargesRemaining).toBe(0);

    const destroyedIds = sustainment.damageStationsInRadius(new THREE.Vector3(10, 0, 0), 5, 300);
    expect(destroyedIds).toContain(st2.id);
    expect(st2.destroyed).toBe(true);

    // Capture checkpoint snapshot and simulate reload into a fresh SustainmentEconomyManager
    const snapshot = sustainment.captureSnapshot();
    const restored = new SustainmentEconomyManager();
    restored.registerStation({ id: 'ammo_cp_1', kind: 'ammo_crate', position: new THREE.Vector3(1, 0, 0), maxCharges: 1 });
    restored.registerStation({ id: 'ammo_cp_2', kind: 'ammo_crate', position: new THREE.Vector3(10, 0, 0), maxCharges: 2 });
    restored.restoreSnapshot(snapshot);

    expect(restored.getStationById('ammo_cp_1')!.chargesRemaining).toBe(0);
    expect(restored.getStationById('ammo_cp_2')!.destroyed).toBe(true);

    // Exhaust all heavy ordnance during a mandatory objective → emergency pod deploys ONCE
    for (const id of ['rocket_launcher', 'guided_missile', 'grenade_launcher'] as const) {
      const w = weapons.getWeaponState(id)!;
      w.ammoInMag = 0;
      w.reserveAmmo = 0;
    }
    explosives.setC4(0);
    const pod1 = restored.tryDeployEmergencyOrdnancePod({
      requiresHeavyOrdnance: true,
      weapons,
      explosives,
      playerPos: player.position,
      groundY: 0,
    });
    expect(pod1).not.toBeNull();
    expect(pod1?.chargesRemaining).toBe(1);

    // Never deploys a second unlimited pod
    restored.damageStation(pod1!.id, 999);
    const pod2 = restored.tryDeployEmergencyOrdnancePod({
      requiresHeavyOrdnance: true,
      weapons,
      explosives,
      playerPos: player.position,
      groundY: 0,
    });
    expect(pod2).toBeNull();
  });

  it('enforces difficulty-scaled med/armor recovery and vehicle repair bay safety (speed + combat window)', () => {
    expect(DIFFICULTY_RECOVERY_PROFILES.easy.medStationHp).toBeGreaterThan(
      DIFFICULTY_RECOVERY_PROFILES.normal.medStationHp
    );
    expect(DIFFICULTY_RECOVERY_PROFILES.normal.medStationHp).toBeGreaterThan(
      DIFFICULTY_RECOVERY_PROFILES.extreme.medStationHp
    );

    const { sustainment, buildCtx } = makeTestSustainmentHarness();
    const bay = sustainment.registerStation({
      id: 'bay_1',
      kind: 'vehicle_service_bay',
      position: new THREE.Vector3(0, 0, 0),
      maxCharges: 2,
    });

    const mockVeh: SustainmentVehicleTarget = {
      id: 'jeep_1',
      alive: true,
      hostile: false,
      displayName: 'Strike Jeep',
      health: 120,
      maxHealth: 260,
      speed: 8.5,
      position: new THREE.Vector3(0, 0, 1),
      turretAmmo: 40,
      maxTurretAmmo: 180,
      lastDamagedAtSec: 9.5,
      repairAndRearm(hullFrac, ammoFrac) {
        const beforeH = this.health;
        const beforeA = this.turretAmmo;
        this.health = Math.min(this.maxHealth, this.health + Math.ceil(this.maxHealth * hullFrac));
        this.turretAmmo = Math.min(
          this.maxTurretAmmo,
          this.turretAmmo + Math.ceil(this.maxTurretAmmo * ammoFrac)
        );
        return {
          hullAdded: this.health - beforeH,
          turretAmmoAdded: this.turretAmmo - beforeA,
          alreadyFull: this.health === beforeH && this.turretAmmo === beforeA,
        };
      },
    };

    // Moving too fast → refused
    const movingRes = sustainment.beginInteraction(
      buildCtx({ playerVehicle: mockVeh, nowSec: 15 }),
      bay.id
    );
    expect(movingRes.ok).toBe(false);
    expect(movingRes.code).toBe('vehicle_moving');

    // Halted, but took damage 0.5s ago → refused (under fire)
    mockVeh.speed = 0;
    const combatRes = sustainment.beginInteraction(
      buildCtx({ playerVehicle: mockVeh, nowSec: 10.0 }),
      bay.id
    );
    expect(combatRes.ok).toBe(false);
    expect(combatRes.code).toBe('vehicle_under_fire');

    // Safe halted & out of fire → repairs hull + rearms turret ammo
    expect(
      sustainment.beginInteraction(buildCtx({ playerVehicle: mockVeh, nowSec: 14.0 }), bay.id).ok
    ).toBe(true);
    let done = null;
    for (let i = 0; i < 10; i++) {
      const res = sustainment.update(
        0.1,
        buildCtx({ playerVehicle: mockVeh, nowSec: 14.0 + i * 0.1 })
      );
      if (res) done = res;
    }
    expect(done?.ok).toBe(true);
    expect(mockVeh.health).toBeGreaterThan(120);
    expect(mockVeh.turretAmmo).toBeGreaterThan(40);
    expect(bay.chargesRemaining).toBe(1);
  });
});

describe('Stage 5D Workstream B — Multi-Track Background Music System (Adversarial)', () => {
  it('enforces subtle default volume, single-source guarantee on rapid start/stop/restart, and track switching', async () => {
    const defaults = AudioSettingsSchema.parse({});
    expect(defaults.musicVolume).toBeLessThanOrEqual(0.3);
    expect(defaults.dialogueVolume).toBeGreaterThanOrEqual(0.8);

    const mockCtx = createMockAudioContext();
    const musicBus = mockCtx.createGain();
    const ctrl = new MusicPlayerController();
    ctrl.attachAudioContext(mockCtx, musicBus);

    // Rapid start/stop cycles
    for (let i = 0; i < 8; i++) {
      await ctrl.play({ fromUser: true });
      ctrl.pause({ fromUser: true });
    }
    await ctrl.play({ fromUser: true });
    expect(ctrl.getActiveSourceCount()).toBe(1);
    expect(mockCtx.getStats().live).toBe(1);

    // Switch tracks while playing
    await ctrl.next(true);
    expect(ctrl.getCurrentTrack().id).toBe(MUSIC_TRACK_CATALOG[1].id);
    expect(ctrl.getActiveSourceCount()).toBe(1);
    expect(mockCtx.getStats().live).toBe(1);

    // Simulated repeated mission restarts must NEVER duplicate music sources
    for (let restart = 0; restart < 5; restart++) {
      await ctrl.startForMission('combat_intensity', false);
    }
    expect(ctrl.getActiveSourceCount()).toBe(1);
    expect(mockCtx.getStats().live).toBe(1);

    ctrl.dispose();
    expect(mockCtx.getStats().live).toBe(0);
  });

  it('handles seek near beginning/end, visibility suspend/resume, failed tracks, and dialogue ducking volume restoration', async () => {
    const mockCtx = createMockAudioContext();
    const musicBus = mockCtx.createGain();
    let failFirstTrack = true;

    const flakyLoader: MusicTrackLoader = {
      async loadTrack(track, ctx) {
        if (failFirstTrack && track.id === MUSIC_TRACK_CATALOG[0].id) {
          throw new Error('Simulated 404 audio asset');
        }
        return synthesizeMusicTrackBuffer(ctx, { ...track, durationSec: 4 });
      },
    };

    const ctrl = new MusicPlayerController({ customLoader: flakyLoader });
    ctrl.attachAudioContext(mockCtx, musicBus);

    // Track 0 fails → falls back automatically to Track 1 and plays cleanly
    const played = await ctrl.play({ fromUser: true });
    expect(played).toBe(true);
    expect(ctrl.getSnapshot().errorTrackIds).toContain(MUSIC_TRACK_CATALOG[0].id);
    expect(ctrl.getCurrentTrack().id).toBe(MUSIC_TRACK_CATALOG[1].id);
    expect(ctrl.getActiveSourceCount()).toBe(1);

    // Seek near beginning (negative clamped to 0) and near end (past duration clamped safely)
    await ctrl.seek(-5);
    expect(ctrl.getSnapshot().currentTimeSec).toBe(0);
    await ctrl.seek(999);
    expect(ctrl.getSnapshot().currentTimeSec).toBeLessThan(ctrl.getSnapshot().durationSec);
    expect(ctrl.getActiveSourceCount()).toBe(1);

    // Browser visibility hide / mission pause → suspends cleanly; resume restores without duplicating
    mockCtx.advanceTime(1.2);
    ctrl.suspendForLifecycle();
    expect(ctrl.getSnapshot().isPausedByLifecycle).toBe(true);
    expect(ctrl.getActiveSourceCount()).toBe(0);

    await ctrl.resumeFromLifecycle();
    expect(ctrl.getSnapshot().isPlaying).toBe(true);
    expect(ctrl.getActiveSourceCount()).toBe(1);
    expect(mockCtx.getStats().live).toBe(1);

    // Dialogue ducking lowers duckLevel then deterministically restores exact 1.0
    ctrl.duckForDialogue(1.0, 0.3);
    for (let i = 0; i < 6; i++) ctrl.tick(0.05);
    expect(ctrl.getSnapshot().duckLevel).toBeLessThan(0.5);

    for (let i = 0; i < 40; i++) ctrl.tick(0.1);
    expect(ctrl.getSnapshot().duckLevel).toBeCloseTo(1.0, 2);

    failFirstTrack = false;
    ctrl.dispose();
  });
});

describe('Stage 5D Workstream C — Vehicle Handling, Slopes, Obstacles & Occupied Reset', () => {
  it('differentiates low-speed vs high-speed turning radius and vehicle classes cleanly', () => {
    const jeepLow = stepVehicleHandling({
      type: 'military_jeep',
      mapId: 'warzone_city',
      dt: 0.05,
      gas: 0.4,
      brakeReverse: 0,
      steer: 1,
      handbrake: false,
      speed: 4.5,
      maxSpeed: 24,
      steerAngle: 0.9,
      driveGear: 'FORWARD',
      reverseConfirmTimer: 0,
      slopePitchRad: 0,
      reverseEnterSpeed: VEHICLE_REVERSE_ENTER_SPEED,
      reverseExitSpeed: VEHICLE_REVERSE_EXIT_SPEED,
      reverseConfirmSec: VEHICLE_REVERSE_CONFIRM_SEC,
    });
    const truckLow = stepVehicleHandling({
      type: 'armored_truck',
      mapId: 'warzone_city',
      dt: 0.05,
      gas: 0.4,
      brakeReverse: 0,
      steer: 1,
      handbrake: false,
      speed: 4.5,
      maxSpeed: 18,
      steerAngle: 0.9,
      driveGear: 'FORWARD',
      reverseConfirmTimer: 0,
      slopePitchRad: 0,
      reverseEnterSpeed: VEHICLE_REVERSE_ENTER_SPEED,
      reverseExitSpeed: VEHICLE_REVERSE_EXIT_SPEED,
      reverseConfirmSec: VEHICLE_REVERSE_CONFIRM_SEC,
    });

    // Jeep turns tighter (smaller turning radius) than heavy Armored Truck
    expect(jeepLow.effectiveTurnRadiusM).toBeLessThan(truckLow.effectiveTurnRadiusM);
    expect(Math.abs(jeepLow.yawDeltaRad)).toBeGreaterThan(Math.abs(truckLow.yawDeltaRad));

    // High-speed steering attenuates target steerAngle for stability
    let highSpeedSteer = 0;
    for (let i = 0; i < 25; i++) {
      const s = stepVehicleHandling({
        type: 'military_jeep',
        mapId: 'warzone_city',
        dt: 0.05,
        gas: 1,
        brakeReverse: 0,
        steer: 1,
        handbrake: false,
        speed: 23,
        maxSpeed: 24,
        steerAngle: highSpeedSteer,
        driveGear: 'FORWARD',
        reverseConfirmTimer: 0,
        slopePitchRad: 0,
        reverseEnterSpeed: VEHICLE_REVERSE_ENTER_SPEED,
        reverseExitSpeed: VEHICLE_REVERSE_EXIT_SPEED,
        reverseConfirmSec: VEHICLE_REVERSE_CONFIRM_SEC,
      });
      highSpeedSteer = s.steerAngle;
    }
    expect(highSpeedSteer).toBeLessThan(0.65);
    expect(highSpeedSteer).toBeGreaterThan(0.45);
  });

  it('reverses reliably on uphill and downhill slopes without stalling or losing control', () => {
    // Nose pitched down (-0.25 rad) means reversing is climbing UPHILL
    let speed = 0;
    let gear: 'FORWARD' | 'BRAKING' | 'NEUTRAL_HOLD' | 'REVERSE' = 'NEUTRAL_HOLD';
    let revTimer = 0;
    for (let i = 0; i < 30; i++) {
      const s = stepVehicleHandling({
        type: 'military_jeep',
        mapId: 'desert_base',
        dt: 0.05,
        gas: 0,
        brakeReverse: 1,
        steer: 0,
        handbrake: false,
        speed,
        maxSpeed: 24,
        steerAngle: 0,
        driveGear: gear,
        reverseConfirmTimer: revTimer,
        slopePitchRad: -0.25,
        reverseEnterSpeed: VEHICLE_REVERSE_ENTER_SPEED,
        reverseExitSpeed: VEHICLE_REVERSE_EXIT_SPEED,
        reverseConfirmSec: VEHICLE_REVERSE_CONFIRM_SEC,
      });
      speed = s.speed;
      gear = s.driveGear;
      revTimer = s.reverseConfirmTimer;
    }
    expect(gear).toBe('REVERSE');
    expect(speed).toBeLessThan(-4.5);
    expect(speed).toBeGreaterThanOrEqual(-getVehicleHandlingSpec('military_jeep').maxReverseSpeed);
  });

  it('handles uneven terrain, obstacle steering collision, moving exit, and occupied world reset cleanly', () => {
    const res = new ResourceManager();
    const scene = new THREE.Scene();
    const audio = new AudioManager(res, AudioSettingsSchema.parse({}));
    const vfx = new VFXPool(scene, res);
    const collision = new CollisionWorld();
    // Uneven rolling terrain + solid obstacle ahead
    collision.setTerrainHeightFn((x, z) => Math.sin(x * 0.18) * Math.cos(z * 0.18) * 1.1);
    collision.addStaticBox({
      id: 'test_wall',
      minX: -6,
      minY: -2,
      minZ: -12,
      maxX: 6,
      maxY: 4,
      maxZ: -10,
      layer: COLLISION_LAYER.WORLD,
    });

    const input = new InputManager(res, InputSettingsSchema.parse({}), () => {}, () => {});
    const player = new PlayerController(audio);
    player.spawn(0, 1.7, 2, 0);
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    const vehicles = new VehicleManager(scene, res, vfx, audio);
    const veh = vehicles.spawnVehicle(
      'military_jeep',
      { x: 0, y: 0, z: 0 },
      0,
      false,
      false,
      collision,
      'mission:1'
    );

    // Enter vehicle
    expect(vehicles.togglePlayerVehicle(player, collision)).toBe(true);
    expect(player.isOccupyingVehicle()).toBe(true);

    // Drive forward while steering into obstacle across uneven terrain
    veh.speed = 14;
    veh.steerAngle = 0.45;
    for (let i = 0; i < 40; i++) {
      vehicles.update(0.05, input, player, camera, collision, [], () => {});
    }
    // Must never tunnel past the wall at z = -10, and camera + chassis remain finite
    expect(veh.position.z).toBeGreaterThan(-10.6);
    expect(Number.isFinite(camera.position.x)).toBe(true);
    expect(Number.isFinite(camera.position.y)).toBe(true);
    expect(Number.isFinite(camera.position.z)).toBe(true);
    expect(Math.abs(veh.chassisPitch)).toBeLessThan(0.6);

    // Exit while moving: brakes vehicle safely and releases shield
    veh.speed = 18;
    expect(vehicles.togglePlayerVehicle(player, collision)).toBe(false);
    expect(player.isOccupyingVehicle()).toBe(false);
    expect(Math.abs(veh.speed)).toBeLessThanOrEqual(2.41);

    // Re-enter and simulate world reset while occupied
    player.position.copy(veh.position).add(new THREE.Vector3(2, 0, 0));
    expect(vehicles.togglePlayerVehicle(player, collision)).toBe(true);
    vehicles.forceExitIfOccupied(player, collision);
    vehicles.clear();
    expect(player.isOccupyingVehicle()).toBe(false);
    expect(vehicles.getPlayerVehicle()).toBeNull();
  });
});

describe('Stage 5D Workstream D — All 5 Missions Integration, Extraction Gate & Zero-Leak Unload', () => {
  it('enforces extraction prerequisites on Mission 5 and allows finishing with critically low HP', () => {
    const m5 = MISSION_CATALOG[4];
    const dir = new MissionDirector(m5, 'normal');

    // Attempt extraction before completing mandatory stages → blocked
    expect(dir.getExtractionStatus()).toBe('locked');
    expect(dir.onExtractionReached()).toBe(false);
    expect(dir.getExtractionBlockReason()).toBeTruthy();

    // Complete stages 1, 2, 3
    for (let i = 0; i < 3; i++) dir.onDestructibleTargetDestroyed(300, 'fuel_tank', `vat_${i}`, 'weapon');
    for (let i = 0; i < 12; i++) dir.onEnemyKilled(false, 120);
    dir.onAirUnitKilled(500, 'gunship');

    expect(dir.getExtractionStatus()).toBe('available');
    expect(dir.onExtractionReached()).toBe(true);

    // Finish even with 1 HP / 0 Armor remaining
    const tick = dir.update(0.1, 1, 0);
    expect(tick.finished).toBe(true);
    expect(tick.victory).toBe(true);
  });

  it('builds all 5 campaign missions with tailored sustainment stations and unloads with zero resource leaks', () => {
    const res = new ResourceManager();
    const assets = new AssetManager(res);
    const scene = new THREE.Scene();
    const audio = new AudioManager(res, AudioSettingsSchema.parse({}));
    const vfx = new VFXPool(scene, res);
    res.recordBaseline();

    for (const mission of MISSION_CATALOG) {
      const scope = `mission:${mission.id}` as const;
      const collision = new CollisionWorld();
      const chunkManager = new WorldChunkManager();
      const destruction = new DestructionSystem(collision.physicsWorld, vfx, audio);

      const world = buildWorldMap(
        mission.mapId,
        mission.id,
        scene,
        assets,
        res,
        collision,
        chunkManager,
        destruction
      );

      const ammoStations = world.supplyCrates.filter((c) => c.kind === 'ammo_crate');
      const medStations = world.supplyCrates.filter((c) => c.kind === 'med_armor_station');
      const vehicleBays = world.supplyCrates.filter((c) => c.kind === 'vehicle_service_bay');

      expect(ammoStations.length).toBeGreaterThanOrEqual(3);
      expect(medStations.length).toBeGreaterThanOrEqual(2);
      expect(vehicleBays.length).toBeGreaterThanOrEqual(1);

      // Unload cleanly & verify zero mission resource leaks
      destruction.clear();
      collision.clear();
      chunkManager.clear(scene);
      res.unloadScope(scope);
      const audit = res.recordPostUnloadAudit();
      expect(audit.hasMissionLeak).toBe(false);
    }

    audio.dispose();
  });
});
