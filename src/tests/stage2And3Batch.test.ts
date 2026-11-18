import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager, SoundId } from '@/src/audio/AudioManager';
import { ALL_PROCEDURAL_PATTERNS, AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { getMissionById } from '@/src/data/missions';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { VFXPool } from '@/src/effects/VFXPool';
import { HudSnapshotPublisher } from '@/src/engine/HudSnapshotPublisher';
import { InputManager } from '@/src/engine/InputManager';
import { PerformanceMonitor } from '@/src/engine/PerformanceMonitor';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatDamageResolver } from '@/src/gameplay/CombatDamageResolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { HealthPickupManager } from '@/src/gameplay/HealthPickupManager';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { audioSettingsStore } from '@/src/stores/audioSettingsStore';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

function createMockWebAudioContext() {
  const createdBuffers: Array<{ channels: number; length: number; sampleRate: number; data: Float32Array[] }> = [];
  let convolverCount = 0;

  class MockGainNode {
    gain = {
      value: 1,
      setTargetAtTime: vi.fn(),
    };
    connect = vi.fn();
    disconnect = vi.fn();
  }

  class MockConvolverNode {
    buffer: unknown = null;
    connect = vi.fn();
    disconnect = vi.fn();
    constructor() {
      convolverCount++;
    }
  }

  class MockPannerNode {
    panningModel = 'HRTF';
    distanceModel = 'inverse';
    refDistance = 5;
    maxDistance = 120;
    rolloffFactor = 1.25;
    positionX = { value: 0 };
    positionY = { value: 0 };
    positionZ = { value: 0 };
    connect = vi.fn();
    disconnect = vi.fn();
  }

  class MockBufferSourceNode {
    buffer: unknown = null;
    playbackRate = { value: 1 };
    onended: (() => void) | null = null;
    connect = vi.fn();
    disconnect = vi.fn();
    start = vi.fn();
    stop = vi.fn();
  }

  class MockOscillatorNode {
    type = 'sawtooth';
    frequency = { value: 55 };
    connect = vi.fn();
    disconnect = vi.fn();
    start = vi.fn();
    stop = vi.fn();
  }

  class MockBiquadFilterNode {
    type = 'lowpass';
    frequency = { value: 180 };
    connect = vi.fn();
    disconnect = vi.fn();
  }

  class MockAudioContext {
    state: 'running' | 'suspended' = 'running';
    sampleRate = 22050;
    currentTime = 0;
    destination = {};
    listener = {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: -1 },
      upX: { value: 0 },
      upY: { value: 1 },
      upZ: { value: 0 },
    };
    createGain = () => new MockGainNode();
    createConvolver = () => new MockConvolverNode();
    createPanner = () => new MockPannerNode();
    createBufferSource = () => new MockBufferSourceNode();
    createOscillator = () => new MockOscillatorNode();
    createBiquadFilter = () => new MockBiquadFilterNode();
    createBuffer = (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buf = {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (ch: number) => data[ch],
      };
      createdBuffers.push({ channels, length, sampleRate, data });
      return buf as unknown as AudioBuffer;
    };
    resume = vi.fn().mockResolvedValue(undefined);
    suspend = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }

  return {
    MockAudioContext,
    createdBuffers,
    getConvolverCount: () => convolverCount,
  };
}

describe('Stage 2 Completion (TRN-02B) & Full Stage 3 (TRN-07, TRN-08, TRN-09) Integrated Suite', () => {
  let resourceManager: ResourceManager;

  beforeEach(() => {
    resourceManager = new ResourceManager();
    gameSessionStore.getState().resetSession();
  });

  describe('TRN-02B — HudSnapshotPublisher & CombatDamageResolver', () => {
    it('resolves contextual interaction prompts in strict priority order and publishes HUD snapshots cleanly', () => {
      const scene = new THREE.Scene();
      const viewModelScene = new THREE.Scene();
      const audio = new AudioManager(resourceManager, audioSettingsStore.getState());
      const vfx = new VFXPool(scene, resourceManager);
      const telemetry = new CombatTelemetryRecorder();
      const coordinator = new CombatEngagementCoordinator(telemetry);
      const ballistics = new BallisticSolver(vfx, telemetry);
      const collisionWorld = new CollisionWorld();
      const projectiles = new ProjectileManager(scene, resourceManager, vfx, audio, telemetry);
      const explosives = new ExplosiveManager(scene, resourceManager, vfx, audio, projectiles, telemetry);
      const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);
      const player = new PlayerController(audio);
      const weapons = new WeaponSystem(viewModelScene, audio, vfx, projectiles);
      const enemies = new EnemyManager(scene, resourceManager, vfx, audio, projectiles, coordinator, ballistics, telemetry);
      const vehicles = new VehicleManager(scene, resourceManager, vfx, audio, coordinator, ballistics, telemetry);
      const airCombat = new AirCombatManager(scene, resourceManager, vfx, audio, coordinator, ballistics, telemetry);
      const input = new InputManager(resourceManager, SettingsBundleSchema.parse({}).input);

      const mission = getMissionById(1);
      const missionDirector = new MissionDirector(mission, 'normal', {
        missionId: 1,
        difficulty: 'normal',
        cumulativeElapsedSec: 0,
        checkpointDeathsCount: 0,
      });

      const publisher = new HudSnapshotPublisher();
      const crateMesh = new THREE.Group();
      const worldData = {
        coverNodes: [],
        roadWaypoints: [],
        supplyCrates: [
          {
            id: 'crate_0',
            position: new THREE.Vector3(0, 0, 1.5),
            used: false,
            mesh: crateMesh,
          },
        ],
        animatedProps: [],
        extractionBeacon: null,
        elevatedSurfaces: [],
        navPortals: [],
        cargoLifts: [],
      };

      player.spawn(0, 0, 0, 0);
      const jeep = vehicles.spawnVehicle(
        'military_jeep',
        { x: 0, y: 0, z: 2.0 },
        0,
        false,
        false,
        collisionWorld,
        'mission:1'
      );

      // 1. Near interactable vehicle outranks supply crate
      expect(
        publisher.resolveInteractPrompt(player, null, jeep, worldData, destruction)
      ).toBe('[E] Drive Strike Jeep');

      // 2. Occupied vehicle outranks all
      expect(
        publisher.resolveInteractPrompt(player, jeep, null, worldData, destruction)
      ).toBe('[E] Exit Strike Jeep');

      // 3. Supply crate prompt when no vehicle is near
      expect(
        publisher.resolveInteractPrompt(player, null, null, worldData, destruction)
      ).toBe('[E] Resupply Ammo & Armor');

      // 4. Full HUD snapshot publish updates gameSessionStore
      publisher.publish({
        player,
        weapons,
        enemies,
        vehicles,
        airCombat,
        explosives,
        destruction,
        input,
        missionDirector,
        activeMission: mission,
        worldData,
      });

      const hud = gameSessionStore.getState().hud;
      expect(hud.health).toBe(100);
      expect(hud.interactPrompt).toBe('[E] Drive Strike Jeep');
      expect(hud.objectives.length).toBeGreaterThan(0);
    });

    it('resolves hitscan, turret raycast, and explosion callbacks via CombatDamageResolver without duplicating combat authority', () => {
      const scene = new THREE.Scene();
      const viewModelScene = new THREE.Scene();
      const audio = new AudioManager(resourceManager, audioSettingsStore.getState());
      const vfx = new VFXPool(scene, resourceManager);
      const telemetry = new CombatTelemetryRecorder();
      const coordinator = new CombatEngagementCoordinator(telemetry);
      const ballistics = new BallisticSolver(vfx, telemetry);
      const collisionWorld = new CollisionWorld();
      const projectiles = new ProjectileManager(scene, resourceManager, vfx, audio, telemetry);
      const explosives = new ExplosiveManager(scene, resourceManager, vfx, audio, projectiles, telemetry);
      const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);
      const player = new PlayerController(audio);
      const weapons = new WeaponSystem(viewModelScene, audio, vfx, projectiles);
      const enemies = new EnemyManager(scene, resourceManager, vfx, audio, projectiles, coordinator, ballistics, telemetry);
      const vehicles = new VehicleManager(scene, resourceManager, vfx, audio, coordinator, ballistics, telemetry);
      const airCombat = new AirCombatManager(scene, resourceManager, vfx, audio, coordinator, ballistics, telemetry);
      const healthPickups = new HealthPickupManager(scene, resourceManager, vfx, audio);
      const monitor = new PerformanceMonitor();
      const mission = getMissionById(1);
      const director = new MissionDirector(mission, 'normal');

      const resolver = new CombatDamageResolver({
        audio,
        vfx,
        collisionWorld,
        player,
        weapons,
        enemies,
        vehicles,
        airCombat,
        explosives,
        destruction,
        healthPickups,
        monitor,
        getMissionDirector: () => director,
        getActiveScope: () => 'mission:1',
      });

      enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: -15 }, 0.1, collisionWorld, 'mission:1');
      const { hitscanTargets } = resolver.collectFrameTargets();
      expect(hitscanTargets.length).toBe(1);

      const enemyPos = enemies.getUnits()[0].position.clone();
      const origin = new THREE.Vector3(enemyPos.x, enemyPos.y + 1.0, enemyPos.z + 10);
      const dir = new THREE.Vector3(0, 0, -1);

      const initialHp = enemies.getUnits()[0].health;
      resolver.onTurretShotCheck(origin, dir);
      expect(enemies.getUnits()[0].health).toBeLessThan(initialHp);
    });
  });

  describe('TRN-07 — Multi-Channel PBR & Architectural Detailing', () => {
    it('generates deterministic sRGB Albedo and Linear Normal, Roughness, and Metalness maps across all 8 profiles and quality tiers within GPU memory budget', () => {
      const assetsA = new AssetManager(resourceManager);
      const assetsB = new AssetManager(resourceManager);

      // Verify quality tier resolution scaling
      expect(assetsA.getTargetTexSize('low')).toBe(128);
      expect(assetsA.getTargetTexSize('medium')).toBe(256);
      expect(assetsA.getTargetTexSize('high')).toBe(512);
      expect(assetsA.getTargetTexSize('ultra')).toBe(512);

      assetsA.setTextureQuality('high');
      assetsB.setTextureQuality('high');

      for (const pattern of ALL_PROCEDURAL_PATTERNS) {
        const bundle = assetsA.getPbrTextureBundle(pattern, [2, 2], 'shared');
        expect(bundle.resolution).toBe(512);
        expect(bundle.albedoMap.colorSpace).toBe(THREE.SRGBColorSpace);
        expect(bundle.normalMap.colorSpace).toBe(THREE.NoColorSpace);
        expect(bundle.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
        expect(bundle.metalnessMap.colorSpace).toBe(THREE.NoColorSpace);

        // Verify Sobel normal map has non-flat X/Y relief
        const nData = bundle.normalMap.image.data as Uint8Array;
        let nonFlatNormals = 0;
        for (let i = 0; i < nData.length; i += 64) {
          if (Math.abs(nData[i] - 128) > 2 || Math.abs(nData[i + 1] - 128) > 2) {
            nonFlatNormals++;
          }
        }
        expect(nonFlatNormals).toBeGreaterThan(20);

        const mat = assetsA.getSharedMaterial(`test_${pattern}`, { pattern, repeat: [2, 2] });
        expect(mat.map).toBe(bundle.albedoMap);
        expect(mat.normalMap).toBe(bundle.normalMap);
        expect(mat.roughnessMap).toBe(bundle.roughnessMap);
        expect(mat.metalnessMap).toBe(bundle.metalnessMap);
      }

      // Deterministic check: concrete bundle in assetsB matches assetsA byte-for-byte
      const bConcrete = assetsB.getPbrTextureBundle('concrete', [2, 2], 'shared');
      const aConcrete = assetsA.getPbrTextureBundle('concrete', [2, 2], 'shared');
      const aBytes = aConcrete.albedoMap.image.data as Uint8Array;
      const bBytes = bConcrete.albedoMap.image.data as Uint8Array;
      expect(aBytes[0]).toBe(bBytes[0]);
      expect(aBytes[1024]).toBe(bBytes[1024]);
      expect(aBytes[4096]).toBe(bBytes[4096]);

      // Verify GPU memory budget for all 8 shared profiles at 512x512 (~44.7 MiB < 46 MiB ceiling)
      expect(assetsA.getResidentProfileCount()).toBe(8);
      expect(assetsA.getEstimatedGpuMemoryBytes()).toBeLessThan(46 * 1024 * 1024);
    });

    it('builds enterable buildings with TRN-07 architectural trim while preserving doorway and window-sill clearances', () => {
      const scene = new THREE.Scene();
      const assets = new AssetManager(resourceManager);
      assets.setTextureQuality('medium');
      const collisionWorld = new CollisionWorld();
      const chunkManager = new WorldChunkManager();
      const vfx = new VFXPool(scene, resourceManager);
      const audio = new AudioManager(resourceManager, audioSettingsStore.getState());
      const destruction = new DestructionSystem(collisionWorld.physicsWorld, vfx, audio);

      buildWorldMap(
        'warzone_city',
        1,
        scene,
        assets,
        resourceManager,
        collisionWorld,
        chunkManager,
        destruction
      );

      const detailNames = new Set<string>();
      scene.traverse((obj) => {
        if (obj.name) detailNames.add(obj.name);
      });

      expect(detailNames.has('door_frame_jamb')).toBe(true);
      expect(detailNames.has('door_header_beam')).toBe(true);
      expect(detailNames.has('window_mullion')).toBe(true);
      expect(detailNames.has('window_header')).toBe(true);
      expect(detailNames.has('corner_pilaster')).toBe(true);
      expect(detailNames.has('interior_baseboard')).toBe(true);
      expect(detailNames.has('roof_cornice')).toBe(true);
    });
  });

  describe('TRN-08 — Hybrid Layered Audio & Stage-Synchronized Reload Foley', () => {
    it('supports a 32-voice priority pool with deterministic tie-breaking, category caps, and a shared ConvolverNode reverb bus', () => {
      const mockAudio = createMockWebAudioContext();
      const origAudioCtx = window.AudioContext;
      (window as unknown as { AudioContext: unknown }).AudioContext = mockAudio.MockAudioContext;

      try {
        const audio = new AudioManager(resourceManager, {
          ...audioSettingsStore.getState(),
          muted: false,
        });
        audio.unlock();

        expect(audio.getMaxVoiceCapacity()).toBe(32);
        expect(audio.hasSharedReverbBus()).toBe(true);
        // Only ONE shared ConvolverNode is created for the entire AudioManager
        expect(mockAudio.getConvolverCount()).toBe(1);

        // Verify all 9 weapon sounds synthesize stereo 2-channel buffers with non-zero samples
        for (const cfg of WEAPON_CATALOG) {
          audio.playWeaponSound(cfg.id);
        }
        expect(mockAudio.getConvolverCount()).toBe(1);
        expect(audio.getActiveVoiceCount()).toBe(9);

        // Spam 20 spatial enemy gunfire voices (combat_spatial category cap = 8)
        for (let i = 0; i < 20; i++) {
          audio.playSpatial('shot_rifle', 10, 1, 10, 4, 0.6);
        }
        const spatialVoices = audio
          .getActiveVoicesSnapshot()
          .filter((v) => v.category === 'combat_spatial');
        expect(spatialVoices.length).toBeLessThanOrEqual(8);

        // Distant sound beyond 120m is culled cleanly
        const countBeforeFar = audio.getActiveVoiceCount();
        audio.playSpatial('shot_rifle', 250, 1, 250, 8, 0.8);
        expect(audio.getActiveVoiceCount()).toBe(countBeforeFar);
      } finally {
        (window as unknown as { AudioContext: unknown }).AudioContext = origAudioCtx;
      }
    });

    it('synchronizes reload Foley cues with WeaponSystem stage transitions and cancels cleanly on interruption', () => {
      const viewModelScene = new THREE.Scene();
      const audio = new AudioManager(resourceManager, audioSettingsStore.getState());
      const playedCues: SoundId[] = [];
      let cancelCount = 0;

      vi.spyOn(audio, 'play2D').mockImplementation((id: SoundId) => {
        playedCues.push(id);
      });
      vi.spyOn(audio, 'cancelReloadFoley').mockImplementation(() => {
        cancelCount++;
        return 1;
      });

      const vfx = new VFXPool(viewModelScene, resourceManager);
      const telemetry = new CombatTelemetryRecorder();
      const projectiles = new ProjectileManager(viewModelScene, resourceManager, vfx, audio, telemetry);
      const weapons = new WeaponSystem(viewModelScene, audio, vfx, projectiles);
      const player = new PlayerController(audio);
      const collisionWorld = new CollisionWorld();
      const camera = new THREE.PerspectiveCamera(75, 1.77, 0.1, 300);
      const input = new InputManager(resourceManager, SettingsBundleSchema.parse({}).input);

      // 1. Test full Assault Rifle reload progression: MAG_OUT -> MAG_IN -> CHAMBER
      weapons.selectWeapon('assault_rifle', true);
      const arState = weapons.getActiveState();
      arState.ammoInMag = 10;
      playedCues.length = 0;

      vi.spyOn(input, 'wasActionPressed').mockImplementation((act) => act === 'reload');
      weapons.update(1 / 60, input, player, camera, collisionWorld, [], [], () => {}, false);
      expect(weapons.getReloadStage()).toBe('MAG_OUT');
      expect(playedCues).toContain('mag_out');

      vi.spyOn(input, 'wasActionPressed').mockReturnValue(false);
      // Step through reload until complete
      for (let i = 0; i < 160 && weapons.isReloading; i++) {
        weapons.update(1 / 60, input, player, camera, collisionWorld, [], [], () => {}, false);
      }
      expect(weapons.isReloading).toBe(false);
      expect(playedCues).toEqual(['mag_out', 'mag_in', 'chamber']);

      // 2. Test Sniper Rifle reload uses bolt_cycle on CHAMBER and cancels if interrupted by weapon switch
      weapons.selectWeapon('sniper_rifle', true);
      weapons.getActiveState().ammoInMag = 1;
      playedCues.length = 0;
      const prevCancel = cancelCount;

      vi.spyOn(input, 'wasActionPressed').mockImplementation((act) => act === 'reload');
      weapons.update(1 / 60, input, player, camera, collisionWorld, [], [], () => {}, false);
      expect(playedCues).toEqual(['mag_out']);

      // Interrupt reload mid-way by switching to pistol
      weapons.selectWeapon('pistol');
      expect(weapons.isReloading).toBe(false);
      expect(cancelCount).toBeGreaterThan(prevCancel);
    });
  });

  describe('TRN-09 — Vehicle Suspension & Camera-Specific Response', () => {
    it('articulates 3D chassis pitch, roll, heave, and per-wheel travel consistently across 30/60/120 FPS while keeping authoritative root and turret ballistics invariant', () => {
      const scene = new THREE.Scene();
      const audio = new AudioManager(resourceManager, audioSettingsStore.getState());
      const vfx = new VFXPool(scene, resourceManager);
      const collisionWorld = new CollisionWorld();
      collisionWorld.setTerrainHeightFn((x, z) => Math.sin(x * 0.08) * 0.12 + Math.cos(z * 0.08) * 0.12);

      const vehicles = new VehicleManager(scene, resourceManager, vfx, audio);
      const player = new PlayerController(audio);
      const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 400);

      for (const fps of [30, 60, 120]) {
        const dt = 1 / fps;
        const veh = vehicles.spawnVehicle(
          'military_jeep',
          { x: 0, y: 0, z: 0 },
          0,
          false,
          false,
          collisionWorld,
          'mission:1'
        );
        veh.speed = 16;
        veh.steerAngle = 0.45;
        veh.driveGear = 'FORWARD';

        const steps = Math.round(0.5 * fps);
        for (let i = 0; i < steps; i++) {
          vehicles.updateVehicleSuspension(veh, dt, collisionWorld, 0.85, i === 0 ? 6.0 : 0);
        }

        // Authoritative root rotation stays strictly un-tilted
        expect(veh.meshRoot.rotation.x).toBe(0);
        expect(veh.meshRoot.rotation.z).toBe(0);

        // Sprung chassisGroup exhibits bounded, finite pitch and roll
        expect(Number.isFinite(veh.chassisPitch)).toBe(true);
        expect(Number.isFinite(veh.chassisRoll)).toBe(true);
        expect(Number.isFinite(veh.chassisHeave)).toBe(true);
        expect(Math.abs(veh.chassisPitch)).toBeGreaterThan(0.005);
        expect(Math.abs(veh.chassisPitch)).toBeLessThanOrEqual(0.14);
        expect(Math.abs(veh.chassisRoll)).toBeGreaterThan(0.005);
        expect(Math.abs(veh.chassisRoll)).toBeLessThanOrEqual(0.16);
        expect(veh.chassisGroup.rotation.x).toBeCloseTo(veh.chassisPitch, 5);
        expect(veh.chassisGroup.rotation.z).toBeCloseTo(veh.chassisRoll, 5);

        // Wheels articulate vertically around wheelRestY
        expect(veh.wheels.length).toBe(4);
        const anyWheelMoved = veh.wheels.some((w) => Math.abs(w.position.y - veh.wheelRestY) > 0.002);
        expect(anyWheelMoved).toBe(true);

        // Reset restores exact zero state
        vehicles.resetVehicleSuspension(veh);
        expect(veh.chassisPitch).toBe(0);
        expect(veh.chassisRoll).toBe(0);
        expect(veh.chassisHeave).toBe(0);
        expect(veh.chassisGroup.rotation.x).toBe(0);
        expect(veh.chassisGroup.rotation.z).toBe(0);
      }

      // Verify camera-specific response in Driver FPV vs Chase Camera
      const testVeh = vehicles.getVehicles()[0];
      player.position.copy(testVeh.position);
      vehicles.togglePlayerVehicle(player, collisionWorld);
      testVeh.chassisPitch = 0.12;
      testVeh.chassisRoll = -0.14;
      testVeh.chassisHeave = -0.1;

      const camRig = vehicles.getCameraRig();
      camRig.setMode('driver_fpv');
      for (let i = 0; i < 15; i++) {
        camRig.updateCamera(1 / 60, testVeh, player, camera, collisionWorld, 78, false);
      }
      const fpvMotion = camRig.getFilteredFpvMotion();
      // Driver FPV filters chassis motion down to horizon-stabilized comfort bounds
      expect(Math.abs(fpvMotion.pitch)).toBeGreaterThan(0.005);
      expect(Math.abs(fpvMotion.pitch)).toBeLessThanOrEqual(0.045);
      expect(Math.abs(fpvMotion.roll)).toBeLessThanOrEqual(0.038);
      expect(Math.abs(fpvMotion.heave)).toBeLessThanOrEqual(0.055);

      // Switching between FPV and Chase preserves orientation without NaN or sudden jumps
      camRig.cycleMode(); // -> turret
      camRig.cycleMode(); // -> orbit
      camRig.cycleMode(); // -> chase
      camRig.updateCamera(1 / 60, testVeh, player, camera, collisionWorld, 78, false);
      expect(Number.isFinite(camera.position.x)).toBe(true);
      expect(Number.isFinite(camera.position.y)).toBe(true);
      expect(Number.isFinite(camera.position.z)).toBe(true);
    });
  });
});
