import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PbrMaterialLibrary } from '@/src/assets/PbrMaterialLibrary';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { createDefaultCoreRoster } from '@/src/data/squadRoster';
import { WEAPON_BY_ID, WEAPON_CATALOG } from '@/src/data/weapons';
import { SurfaceDecalManager } from '@/src/effects/SurfaceDecalManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { resolveAntiAliasingPolicy } from '@/src/engine/AntiAliasingPolicy';
import { InputManager } from '@/src/engine/InputManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import {
  CombatFeedbackDirector,
  WEAPON_RECOIL_SIGNATURES,
} from '@/src/gameplay/CombatFeedbackDirector';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { SquadTacticsCoordinator } from '@/src/gameplay/ai/SquadTacticsCoordinator';
import { FriendlySquadManager } from '@/src/gameplay/squad/FriendlySquadManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { DIFFICULTY_COMBAT_PROFILES } from '@/src/schemas/combat.schema';
import { WorkerBridge } from '@/src/workers/WorkerBridge';
import { audioSettingsStore } from '@/src/stores/audioSettingsStore';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { DestructionSystem } from '@/src/world/DestructionSystem';

function createTestAudio(rm = new ResourceManager()): AudioManager {
  return new AudioManager(rm, audioSettingsStore.getState());
}

function createFlatCollisionWorld(): CollisionWorld {
  const world = new CollisionWorld();
  world.setTerrainHeightFn(() => 0);
  return world;
}

function addCoverWall(
  world: CollisionWorld,
  id: string,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number
): void {
  world.addStaticBox({
    id,
    minX: cx - w * 0.5,
    maxX: cx + w * 0.5,
    minY: cy - h * 0.5,
    maxY: cy + h * 0.5,
    minZ: cz - d * 0.5,
    maxZ: cz + d * 0.5,
    layer: COLLISION_LAYER.COVER,
  });
}

function createCombatHarness() {
  const scene = new THREE.Scene();
  const rm = new ResourceManager();
  const audio = createTestAudio(rm);
  const vfx = new VFXPool(scene, rm);
  const telemetry = new CombatTelemetryRecorder();
  const coordinator = new CombatEngagementCoordinator(telemetry);
  const ballistics = new BallisticSolver(vfx, telemetry);
  const projectiles = new ProjectileManager(scene, rm, vfx, audio, telemetry);
  const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);
  const collision = createFlatCollisionWorld();
  const cleanup = () => {
    enemies.clear();
    projectiles.resetAll();
    vfx.resetAll();
    audio.dispose();
    rm.disposeAll();
  };
  return { scene, rm, audio, vfx, telemetry, coordinator, ballistics, projectiles, enemies, collision, cleanup };
}

const STUB_WORKER_BRIDGE = {
  isHealthy: () => false,
  requestPaths3D: async () => [],
} as unknown as WorkerBridge;

describe('VANGUARD: ZERO HOUR — Tactical Combat, AI Scenarios & Rendering Correctness Suite', () => {
  beforeEach(() => {
    gameSessionStore.getState().resetSession();
    settingsStore.setState((prev) => ({
      ...prev,
      gameplay: {
        ...prev.gameplay,
        cameraShakeIntensity: 1.0,
      },
      accessibility: {
        ...prev.accessibility,
        reducedMotion: false,
        screenShakeReduction: false,
      },
    }));
  });

  describe('1. Rendering Pipeline Correctness (ViewModel Composer, Single-Pass ToneMapping & AA)', () => {
    it('enforces single-pass ACES Filmic ToneMapping and routes ViewModel inside EffectComposer after Bloom and before ToneMapping/SMAA', () => {
      const rendererSrc = readFileSync(resolve(process.cwd(), 'src/engine/Renderer.ts'), 'utf8');

      // Single-pass tone mapping: renderer.toneMapping disabled while composer ToneMappingEffect runs
      expect(rendererSrc).toContain('this.renderer.toneMapping = THREE.NoToneMapping');
      expect(rendererSrc).toContain('ToneMappingMode.ACES_FILMIC');

      // ViewModel pass configured with depth-only clear, no background clear, no shadow re-render
      expect(rendererSrc).toContain(
        'const viewModelPass = new RenderPass(this.viewModelScene, this.viewModelCamera)'
      );
      expect(rendererSrc).toContain('viewModelPass.clearPass.setClearFlags(false, true, false)');
      expect(rendererSrc).toContain('viewModelPass.clearPass.enabled = true');
      expect(rendererSrc).toContain('viewModelPass.ignoreBackground = true');
      expect(rendererSrc).toContain('viewModelPass.skipShadowMapUpdate = true');

      // Exact pass ordering in rebuildComposer: main -> bloom -> viewModel -> vignette/toneMapping -> smaa
      const bloomIdx = rendererSrc.indexOf('composer.addPass(bloomPass)');
      const vmIdx = rendererSrc.indexOf('composer.addPass(viewModelPass)');
      const vigIdx = rendererSrc.indexOf('composer.addPass(vignettePass)');
      const smaaIdx = rendererSrc.indexOf('composer.addPass(smaaPass)');
      expect(bloomIdx).toBeGreaterThan(-1);
      expect(vmIdx).toBeGreaterThan(bloomIdx);
      expect(vigIdx).toBeGreaterThan(vmIdx);
      expect(smaaIdx).toBeGreaterThan(vigIdx);

      // Software GL studio environment fallback + WebGL2 timer query support present
      expect(rendererSrc).toContain('buildSoftwareStudioEnvironment');
      expect(rendererSrc).toContain('EXT_disjoint_timer_query_webgl2');
    });

    it('resolves safe AA modes across desktop MSAA, mobile SMAA, and software GL fallback', () => {
      const desktopHigh = resolveAntiAliasingPolicy({
        requestedMode: 'auto',
        antialiasingEnabled: true,
        isSoftwareGl: false,
        isWebGL2: true,
        maxSamples: 4,
        msaaFramebufferSupported: true,
        canvasPixelCount: 1920 * 1080,
        isMobileOrCoarse: false,
        qualityTier: 'high',
        adaptiveDowngradeStep: 0,
      });
      expect(desktopHigh.activeMode).toBe('msaa4');
      expect(desktopHigh.multisampling).toBe(4);
      expect(desktopHigh.useSmaa).toBe(false);

      const mobile = resolveAntiAliasingPolicy({
        requestedMode: 'auto',
        antialiasingEnabled: true,
        isSoftwareGl: false,
        isWebGL2: true,
        maxSamples: 4,
        msaaFramebufferSupported: true,
        canvasPixelCount: 1170 * 2532,
        isMobileOrCoarse: true,
        qualityTier: 'medium',
        adaptiveDowngradeStep: 0,
      });
      expect(mobile.activeMode).toBe('smaa');
      expect(mobile.multisampling).toBe(0);
      expect(mobile.useSmaa).toBe(true);
    });
  });

  describe('2. Tier 1 Stability — Destructible Decals, Warm PBR Reloads & Oriented Brass Casings', () => {
    it('automatically evicts decals bound to a destructible when it becomes DAMAGED or DESTROYED while preserving intact surface decals', () => {
      const scene = new THREE.Scene();
      const collision = createFlatCollisionWorld();
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const vfx = new VFXPool(scene, rm);
      const decals = new SurfaceDecalManager(scene, 64);
      const destruction = new DestructionSystem(collision.physicsWorld, vfx, audio);

      destruction.setOnEntityStateChanged((id) => {
        decals.clearDecalsForDestructible(id);
      });

      const crateGroup = new THREE.Group();
      const crateMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.0, 1.2),
        new THREE.MeshStandardMaterial()
      );
      crateMesh.userData.impactMaterial = 'wood';
      crateGroup.add(crateMesh);
      scene.add(crateGroup);

      const crateEntity = {
        id: 'crate_alpha',
        kind: 'destructible_barrier' as const,
        state: 'INTACT' as const,
        health: 60,
        maxHealth: 60,
        position: new THREE.Vector3(0, 0.5, -5),
        meshGroup: crateGroup,
        collider: {
          id: 'crate_alpha',
          minX: -0.6,
          maxX: 0.6,
          minY: 0,
          maxY: 1.0,
          minZ: -5.6,
          maxZ: -4.4,
          layer: COLLISION_LAYER.DESTRUCTIBLE,
        },
        isObjectiveTarget: false,
        blastRadius: 0,
        blastDamage: 0,
      };
      destruction.register(crateEntity);
      // Registration automatically tags mesh with destructibleId
      expect(crateMesh.userData.destructibleId).toBe('crate_alpha');

      const wallMesh = new THREE.Mesh(
        new THREE.BoxGeometry(4, 3, 0.5),
        new THREE.MeshStandardMaterial()
      );
      wallMesh.userData.impactMaterial = 'concrete';

      // Spawn 2 decals on the destructible crate and 1 decal on the intact wall
      expect(
        decals.spawnImpactDecal({
          targetMesh: crateMesh,
          point: new THREE.Vector3(0, 0.5, -4.4),
          normal: new THREE.Vector3(0, 0, 1),
          surface: 'wood',
        })
      ).toBe(true);
      expect(
        decals.spawnImpactDecal({
          targetMesh: crateMesh,
          point: new THREE.Vector3(0.2, 0.6, -4.4),
          normal: new THREE.Vector3(0, 0, 1),
          surface: 'wood',
        })
      ).toBe(true);
      expect(
        decals.spawnImpactDecal({
          targetMesh: wallMesh,
          point: new THREE.Vector3(2, 1.0, -5),
          normal: new THREE.Vector3(0, 0, 1),
          surface: 'concrete',
        })
      ).toBe(true);
      expect(decals.getStats().activeCount).toBe(3);

      // Damage crate below 50% -> transitions to DAMAGED -> decals on crate auto-evicted
      destruction.applyDamage('crate_alpha', 35);
      expect(crateEntity.state).toBe('DAMAGED');
      expect(decals.getStats().activeCount).toBe(1);

      // Add another decal to damaged crate, then destroy it -> auto-evicted again
      decals.spawnImpactDecal({
        targetMesh: crateMesh,
        point: new THREE.Vector3(0, 0.4, -4.4),
        normal: new THREE.Vector3(0, 0, 1),
        surface: 'wood',
      });
      expect(decals.getStats().activeCount).toBe(2);
      destruction.applyDamage('crate_alpha', 40);
      expect(crateEntity.state).toBe('DESTROYED');
      expect(decals.getStats().activeCount).toBe(1);

      decals.dispose();
      destruction.dispose();
      crateMesh.geometry.dispose();
      (crateMesh.material as THREE.Material).dispose();
      wallMesh.geometry.dispose();
      (wallMesh.material as THREE.Material).dispose();
      audio.dispose();
      rm.disposeAll();
    });

    it('disposes mission PBR materials via clearMissionMaterials() while keeping procedural base canvases warm', () => {
      const lib = new PbrMaterialLibrary();
      const mat1 = lib.getMaterial('reinforced_concrete', { repeatX: 2, repeatY: 2 });
      expect(mat1).toBeInstanceOf(THREE.MeshStandardMaterial);
      const internal = lib as unknown as {
        materials: Map<string, THREE.MeshStandardMaterial>;
        textures: THREE.Texture[];
      };
      expect(internal.materials.size).toBeGreaterThanOrEqual(1);

      lib.clearMissionMaterials();
      expect(internal.materials.size).toBe(0);
      expect(internal.textures.length).toBe(0);

      // Warm reload succeeds cleanly and rebuilds fresh GPU material
      const mat2 = lib.getMaterial('reinforced_concrete', { repeatX: 2, repeatY: 2 });
      expect(mat2).not.toBe(mat1);
      expect(internal.materials.size).toBe(1);

      lib.dispose();
    });

    it('renders ejected brass casings with oriented cylindrical geometry rather than spheres', () => {
      const scene = new THREE.Scene();
      const rm = new ResourceManager();
      const vfx = new VFXPool(scene, rm);

      vfx.spawnShellCasing(0, 1.5, 0, 1.0, 0.2);
      vfx.update(0.016);

      let foundCylinderBrass = false;
      scene.traverse((obj) => {
        if (
          obj instanceof THREE.InstancedMesh &&
          obj.geometry instanceof THREE.CylinderGeometry &&
          obj.count > 0
        ) {
          foundCylinderBrass = true;
        }
      });
      expect(foundCylinderBrass).toBe(true);

      vfx.resetAll();
      rm.disposeAll();
    });
  });

  describe('3. Weapon Identity, Analytical Recoil Parity & Real Armor Penetration', () => {
    it('solves recoil spring analytically with < 0.5% divergence between 60Hz and 144Hz update rates', () => {
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const input = new InputManager(rm, settingsStore.getState().input);
      const p60 = new PlayerController(audio);
      const p144 = new PlayerController(audio);
      p60.spawn(0, 1.65, 0, 0);
      p144.spawn(0, 1.65, 0, 0);

      const sig = WEAPON_RECOIL_SIGNATURES.assault_rifle;
      p60.addRecoilKick(0.022, 0.004, sig, false, 1.0);
      p144.addRecoilKick(0.022, 0.004, sig, false, 1.0);

      const collision = createFlatCollisionWorld();

      // Simulate 0.25s at 60Hz (15 steps) vs 144Hz (36 steps)
      for (let i = 0; i < 15; i++) {
        p60.update(1 / 60, input, collision, false, 1.0, 0, false);
      }
      for (let i = 0; i < 36; i++) {
        p144.update(1 / 144, input, collision, false, 1.0, 0, false);
      }

      const r60 = p60.getRecoilState();
      const r144 = p144.getRecoilState();
      const relDiff =
        Math.abs(r60.pitchOffset - r144.pitchOffset) / Math.max(1e-5, Math.abs(r60.pitchOffset));
      expect(relDiff).toBeLessThan(0.005);
      audio.dispose();
      rm.disposeAll();
    });

    it('provides distinct recoil & impulse signatures across all 9 catalog weapons and honors tactical pull-down compensation', () => {
      for (const cfg of WEAPON_CATALOG) {
        const sig = WEAPON_RECOIL_SIGNATURES[cfg.id];
        expect(sig).toBeDefined();
        expect(sig.springStiffness).toBeGreaterThan(50);
        expect(sig.hitImpulseWeight).toBeGreaterThan(0.5);
      }

      // Pistol & SMG have snappier recovery stiffness than heavy Sniper / Shotgun / LMG
      expect(WEAPON_RECOIL_SIGNATURES.pistol.springStiffness).toBeGreaterThan(
        WEAPON_RECOIL_SIGNATURES.assault_rifle.springStiffness
      );
      expect(WEAPON_RECOIL_SIGNATURES.assault_rifle.springStiffness).toBeGreaterThan(
        WEAPON_RECOIL_SIGNATURES.sniper_rifle.springStiffness
      );
      expect(WEAPON_RECOIL_SIGNATURES.shotgun.hitImpulseWeight).toBeGreaterThan(
        WEAPON_RECOIL_SIGNATURES.smg.hitImpulseWeight * 2
      );

      // Tactical pull-down absorbs positive recoil climb before pitching camera downward
      const audio = createTestAudio();
      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0);
      player.addRecoilKick(0.04, 0, WEAPON_RECOIL_SIGNATURES.assault_rifle, false, 1.0);
      const before = player.getRecoilState().pitchOffset;
      expect(before).toBeGreaterThan(0.01);

      const mockInput = {
        consumeLookDelta: () => ({ yawDelta: 0, pitchDelta: before * 0.6 }),
      } as unknown as Parameters<PlayerController['applyLookInput']>[0];
      player.applyLookInput(mockInput, false, 1 / 60);

      expect(player.getRecoilState().pitchOffset).toBeCloseTo(before * 0.4, 4);
      expect(player.pitch).toBeCloseTo(0, 5);
      audio.dispose();
    });

    it('differentiates armor penetration on heavy_armor targets: low-AP SMG/Shotgun deflect off plates while high-AP Sniper/LMG punch through', () => {
      const h = createCombatHarness();

      h.enemies.spawnWave('heavy_armor', 1, { x: 0, y: 0, z: -15 }, 0.5, h.collision, 'mission:1', 'sq_ap1');
      h.enemies.spawnWave('heavy_armor', 1, { x: 6, y: 0, z: -15 }, 0.5, h.collision, 'mission:1', 'sq_ap2');
      const [heavyLowAp, heavyHighAp] = h.enemies.getUnits();
      expect(heavyLowAp).toBeDefined();
      expect(heavyHighAp).toBeDefined();
      expect(heavyLowAp.armor).toBeGreaterThan(0);

      const startHpLow = heavyLowAp.health;
      const startHpHigh = heavyHighAp.health;

      // Deal identical 40 raw damage with SMG AP (0.25) vs Sniper AP (0.92)
      h.enemies.damageUnit(
        heavyLowAp,
        40,
        false,
        new THREE.Vector3(0, 1.5, 0),
        WEAPON_BY_ID.smg.armorPenetration,
        WEAPON_RECOIL_SIGNATURES.smg.hitImpulseWeight
      );
      h.enemies.damageUnit(
        heavyHighAp,
        40,
        false,
        new THREE.Vector3(6, 1.5, 0),
        WEAPON_BY_ID.sniper_rifle.armorPenetration,
        WEAPON_RECOIL_SIGNATURES.sniper_rifle.hitImpulseWeight
      );

      const hpLostLowAp = startHpLow - heavyLowAp.health;
      const hpLostHighAp = startHpHigh - heavyHighAp.health;

      expect(hpLostHighAp).toBeGreaterThan(hpLostLowAp * 1.7);
      expect(heavyLowAp.lastHitKind).toBe('armor_deflect');

      // Shatter remaining armor with follow-up hit -> triggers armor_break
      heavyLowAp.armor = 5;
      h.enemies.damageUnit(
        heavyLowAp,
        25,
        false,
        new THREE.Vector3(0, 1.5, 0),
        WEAPON_BY_ID.lmg.armorPenetration,
        WEAPON_RECOIL_SIGNATURES.lmg.hitImpulseWeight
      );
      expect(heavyLowAp.armor).toBe(0);
      expect(heavyLowAp.lastArmorBroken).toBe(true);
      expect(heavyLowAp.lastHitKind).toBe('armor_break');

      h.cleanup();
    });
  });

  describe('4. Acoustic Correctness — Single Source of Truth, Separate Events & Wall Occlusion', () => {
    it('uses computed weapon soundRadiusMeters as the acoustic source of truth and separates bullet-impact sound from shooter origin', () => {
      const h = createCombatHarness();
      const player = new PlayerController(h.audio);
      player.spawn(0, 1.65, 0, 0, h.collision);

      // Guard placed at 36m: outside suppressed radius (14m), inside unsuppressed AR radius
      h.enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: -36 }, 0.2, h.collision, 'mission:1', 'sq_stealth');
      const [guard] = h.enemies.getUnits();
      expect(guard.state).toBe('UNAWARE');

      // Suppressed shot radius (14m) does NOT alert guard at 36m
      const alertedSuppressed = h.enemies.alertSquadsNearPosition(player.position, 14, 1.0);
      expect(alertedSuppressed).toBe(0);
      expect(guard.state).toBe('UNAWARE');

      // Bullet impact near the guard alerts guard to INVESTIGATING the impact site, NOT the shooter at z=0
      const impactPt = new THREE.Vector3(0, 1.0, -32);
      const alertedImpact = h.enemies.notifyBulletImpactSound(impactPt, 8.5);
      expect(alertedImpact).toBe(1);
      expect(guard.state).toBe('INVESTIGATING');
      expect(guard.lastKnownPosition).not.toBeNull();
      expect(guard.lastKnownPosition!.distanceTo(impactPt)).toBeLessThan(0.1);
      expect(guard.lastKnownPosition!.distanceTo(player.position)).toBeGreaterThan(25);

      // Verify WeaponSystem uses cfg.soundRadiusMeters (zero hardcoded 58/75 override) and 5.5m mechanical reload
      const wsSrc = readFileSync(resolve(process.cwd(), 'src/gameplay/WeaponSystem.ts'), 'utf8');
      expect(wsSrc).toContain('player.emitAcousticEvent(cfg.soundRadiusMeters,');
      expect(wsSrc).toContain('player.emitAcousticEvent(5.5,');
      expect(wsSrc).not.toContain('player.emitAcousticEvent(58,');
      expect(wsSrc).not.toContain('player.emitAcousticEvent(75,');

      h.cleanup();
    });

    it('emits exact computed cfg.soundRadiusMeters on player acoustic event when firing WeaponSystem', () => {
      const vmScene = new THREE.Scene();
      const worldScene = new THREE.Scene();
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const vfx = new VFXPool(worldScene, rm);
      const projectiles = new ProjectileManager(worldScene, rm, vfx, audio);
      const weapons = new WeaponSystem(vmScene, audio, vfx, projectiles);
      const input = new InputManager(rm, settingsStore.getState().input);
      const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 300);
      const collision = createFlatCollisionWorld();
      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0, collision);

      const acousticSpy = vi.spyOn(player, 'emitAcousticEvent');
      weapons.resetLoadout('assault_rifle');
      const expectedArRadius = weapons.getActiveWeaponSoundRadiusMeters();
      input.setVirtualActionState('fire', true);
      for (let i = 0; i < 30; i++) {
        weapons.update(1 / 60, input, player, cam, collision, [], [], () => {}, false);
        input.endFrame();
        if (acousticSpy.mock.calls.length > 0) break;
      }

      expect(acousticSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(acousticSpy.mock.calls[0][0]).toBeCloseTo(expectedArRadius, 4);

      weapons.dispose();
      vfx.resetAll();
      audio.dispose();
      rm.disposeAll();
    });

    it('supports budgeted wall occlusion probes on AudioManager spatial voices', () => {
      const audio = createTestAudio();
      audio.setSpatialOcclusionProbe((_lx, _ly, _lz, sx) => sx > 5);
      expect(audio.getOccludedSpatialCount()).toBe(0);
      audio.dispose();
    });
  });

  describe('5. Hit Readability, Shotgun Coalescing, Near-Miss & Accessibility Scaling', () => {
    it('coalesces an 8-pellet shotgun blast into 1 prioritized HUD hitmarker and sound cue without clipping', () => {
      const audio = createTestAudio();
      const play2DSpy = vi.spyOn(audio, 'play2D');
      const director = new CombatFeedbackDirector(audio);

      for (let i = 0; i < 5; i++) {
        director.queueImpactFeedback({
          hitKind: 'armor_deflect',
          isHeadshot: false,
          isKill: false,
          armorBroken: false,
          damage: 9,
        });
      }
      for (let i = 0; i < 2; i++) {
        director.queueImpactFeedback({
          hitKind: 'flesh',
          isHeadshot: false,
          isKill: false,
          armorBroken: false,
          damage: 14,
        });
      }
      director.queueImpactFeedback({
        hitKind: 'armor_break',
        isHeadshot: false,
        isKill: true,
        armorBroken: true,
        damage: 18,
      });

      const flushed = director.flushFrameFeedback();
      expect(flushed).not.toBeNull();
      expect(flushed!.isKill).toBe(true);
      expect(flushed!.armorBroken).toBe(true);
      expect(flushed!.damage).toBe(5 * 9 + 2 * 14 + 18);

      // 1 primary armor_break + 1 layered kill_confirm = 2 voices total (not 8)
      expect(play2DSpy).toHaveBeenCalledTimes(2);
      expect(play2DSpy.mock.calls[0][0]).toBe('armor_break');
      expect(play2DSpy.mock.calls[1][0]).toBe('kill_confirm');

      const hudHit = gameSessionStore.getState().hitFeedback;
      expect(hudHit).not.toBeNull();
      expect(hudHit!.isKill).toBe(true);
      expect(hudHit!.damage).toBe(91);

      audio.dispose();
    });

    it('triggers directional near-miss bullet crack on close hostile flyby and honors independent accessibility camera-motion settings', () => {
      const audio = createTestAudio();
      const spatialSpy = vi.spyOn(audio, 'playSpatial');
      const director = new CombatFeedbackDirector(audio);
      const player = new PlayerController(audio);
      const collision = createFlatCollisionWorld();
      player.spawn(0, 1.65, 0, 0, collision);

      const telemetry = new CombatTelemetryRecorder();
      const solver = new BallisticSolver(null, telemetry);
      let nearMissHits = 0;
      solver.onPlayerNearMiss = (pt, intensity) => {
        nearMissHits++;
        director.notifyNearMissPass(pt, intensity, 500);
      };

      // Aim 0.7m to the right of the player's head so bullet whizzes closely without hitting
      solver.fireWeaponRay(
        {
          unitId: 'sniper_nm',
          squadId: 'sq_nm',
          domain: 'ground',
          weaponClass: 'enemy_sniper',
          muzzleOrigin: new THREE.Vector3(0.7, 1.58, -25),
          aimTarget: new THREE.Vector3(0.7, 1.58, 10),
          distanceMeters: 25,
          unitAccuracy: 0.99,
          isMoving: false,
          aimDurationSec: 1.5,
          burstShotIndex: 0,
          isSuppressedOrStaggered: false,
          isSuppressionFire: false,
          difficultyProfile: DIFFICULTY_COMBAT_PROFILES.normal,
        },
        player,
        collision
      );

      expect(nearMissHits).toBe(1);
      expect(spatialSpy).toHaveBeenCalledWith(
        'bullet_crack',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        8,
        expect.any(Number)
      );

      // Accessibility camera-motion scaling checks
      expect(director.getCameraMotionScale()).toBeCloseTo(1.0, 3);
      settingsStore.setState((s) => ({
        ...s,
        accessibility: { ...s.accessibility, reducedMotion: true, screenShakeReduction: true },
      }));
      expect(director.getCameraMotionScale()).toBeCloseTo(0.175, 3);

      // Setting cameraShakeIntensity to 0 eliminates camera roll/FOV punch while preserving recoil pitch control
      settingsStore.setState((s) => ({
        ...s,
        gameplay: { ...s.gameplay, cameraShakeIntensity: 0 },
      }));
      const scaleZero = director.getCameraMotionScale();
      expect(scaleZero).toBe(0);
      player.addRecoilKick(0.03, 0, WEAPON_RECOIL_SIGNATURES.sniper_rifle, false, scaleZero);
      expect(player.getRecoilState().rollKick).toBe(0);
      expect(player.getRecoilState().fovKick).toBe(0);
      expect(player.getRecoilState().pitchOffset).toBeGreaterThan(0);

      audio.dispose();
    });
  });

  describe('6. Repeatable AI Behavioral Scenarios (Flanking, Cover, Grenades, Directional Death & Squad Pooling)', () => {
    it('executes actual lateral flanking displacement for elite_assault under SUPPRESS_AND_FLANK', () => {
      const h = createCombatHarness();
      const player = new PlayerController(h.audio);
      player.spawn(0, 1.65, 0, 0, h.collision);

      h.enemies.spawnWave('heavy_armor', 1, { x: 0, y: 0, z: -24 }, 0.2, h.collision, 'mission:1', 'sq_tactic');
      h.enemies.spawnWave('elite_assault', 1, { x: 2.0, y: 0, z: -24 }, 0.2, h.collision, 'mission:1', 'sq_tactic');
      const [heavy, flanker] = h.enemies.getUnits();

      h.enemies.alertSquadsNearPosition(player.position, 65, 1.0);
      heavy.state = 'ENGAGING';
      flanker.state = 'REPOSITIONING';
      flanker.lastKnownPosition = player.position.clone();
      const startX = flanker.position.x;

      for (let i = 0; i < 90; i++) {
        h.enemies.update(1 / 30, player, h.collision, [], STUB_WORKER_BRIDGE, 0.08);
      }

      // Flanker must have actually displaced laterally (not just changed an internal enum)
      const lateralDisplacement = Math.abs(flanker.position.x - startX);
      expect(lateralDisplacement).toBeGreaterThan(1.2);

      h.cleanup();
    });

    it('blocks enemy direct LOS and gunfire when player crouches behind solid waist-high cover', () => {
      const audio = createTestAudio();
      const collision = createFlatCollisionWorld();
      addCoverWall(collision, 'cover_wall_1', 0, 0.725, -3, 4, 1.45, 0.6);

      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0, collision);
      player.isCrouching = true;

      const solver = new BallisticSolver(null, new CombatTelemetryRecorder());
      const vis = solver.checkLineOfSight(0, 1.5, -20, player, collision, 40);
      expect(vis.visible).toBe(false);
      expect(vis.blockerId).toBe('cover_wall_1');

      audio.dispose();
    });

    it('flushes a player holding behind cover with an active hostile frag grenade and surfaces a live grenade HUD threat warning', () => {
      const h = createCombatHarness();
      addCoverWall(h.collision, 'cover_flush_wall', 0, 0.9, -4, 5, 1.8, 0.6);

      const player = new PlayerController(h.audio);
      player.spawn(0, 1.65, 0, 0, h.collision);
      player.isCrouching = true;

      h.enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: -18 }, 0.2, h.collision, 'mission:1', 'sq_frag');
      const [grenadier] = h.enemies.getUnits();
      grenadier.state = 'SUPPRESSING';
      grenadier.stateTimerSec = 2.4;
      grenadier.initialGraceTimerSec = 0;
      grenadier.lastKnownPosition = player.position.clone();
      grenadier.lkpTimestampSec = 0;
      grenadier.grenadeCooldown = 0;

      // Step combat while player holds behind cover -> grenadier throws cover-flush frag
      for (let i = 0; i < 60; i++) {
        h.enemies.update(1 / 30, player, h.collision, [], STUB_WORKER_BRIDGE, 0.08);
        h.projectiles.update(1 / 30, h.collision, () => {}, []);
        const near = h.projectiles.getNearestHostileGrenade(player.position, 10.5);
        if (near) break;
      }

      const activeGrenade = h.projectiles.getNearestHostileGrenade(player.position, 28);
      expect(activeGrenade).not.toBeNull();
      expect(activeGrenade!.distanceM).toBeLessThan(28);

      const warning = h.enemies.getActiveThreatWarning(player);
      expect(warning).not.toBeNull();
      expect(warning!.kind).toBe('grenade');
      expect(Number.isFinite(warning!.angleRad)).toBe(true);
      expect(warning!.progress).toBeGreaterThanOrEqual(0);
      expect(warning!.progress).toBeLessThanOrEqual(1);

      h.cleanup();
    });

    it('produces directional death collapse (backward on frontal shot, forward on rear shot) scaled by weapon impulse', () => {
      const h = createCombatHarness();

      h.enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: -10 }, 0.2, h.collision, 'mission:1', 'sq_dir');
      h.enemies.spawnWave('infantry', 1, { x: 4, y: 0, z: -10 }, 0.2, h.collision, 'mission:1', 'sq_dir');
      const [frontTarget, rearTarget] = h.enemies.getUnits();

      // Enemy facing +Z (yaw = 0)
      frontTarget.yaw = 0;
      h.enemies.damageUnit(
        frontTarget,
        500,
        false,
        new THREE.Vector3(0, 1.5, 0), // shot from +Z (in front)
        WEAPON_BY_ID.shotgun.armorPenetration,
        WEAPON_RECOIL_SIGNATURES.shotgun.hitImpulseWeight
      );
      expect(frontTarget.alive).toBe(false);
      expect(frontTarget.deathFallSign).toBe(-1); // knocked backward
      expect(frontTarget.deathImpulseStrength).toBeCloseTo(
        WEAPON_RECOIL_SIGNATURES.shotgun.hitImpulseWeight,
        3
      );

      rearTarget.yaw = 0;
      h.enemies.damageUnit(
        rearTarget,
        500,
        false,
        new THREE.Vector3(4, 1.5, -25), // shot from -Z (behind)
        WEAPON_BY_ID.smg.armorPenetration,
        WEAPON_RECOIL_SIGNATURES.smg.hitImpulseWeight
      );
      expect(rearTarget.alive).toBe(false);
      expect(rearTarget.deathFallSign).toBe(1); // pitched forward
      expect(rearTarget.deathImpulseStrength ?? 0).toBeLessThan(
        frontTarget.deathImpulseStrength ?? 0
      );

      h.cleanup();
    });

    it('reuses pooled SquadTacticalOrder instances across repeated evaluations with zero per-tick object churn and exposes friendly squad order world pings', () => {
      const coordinator = new SquadTacticsCoordinator();
      const units = [
        {
          id: 'u1',
          squadId: 'alpha',
          archetype: 'heavy_armor' as const,
          role: 'suppressor' as const,
          alive: true,
          healthRatio: 1,
          hasLos: true,
          isSuppressedOrHit: false,
          distanceToPlayer: 22,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 1,
        },
        {
          id: 'u2',
          squadId: 'alpha',
          archetype: 'elite_assault' as const,
          role: 'flanker' as const,
          alive: true,
          healthRatio: 1,
          hasLos: true,
          isSuppressedOrHit: false,
          distanceToPlayer: 20,
          elevationDelta: 0,
          shotsFiredSinceRelocate: 0,
        },
      ];

      const firstMap = coordinator.evaluateSquads(units, false, false);
      const firstU1 = firstMap.get('u1');
      const firstU2 = firstMap.get('u2');
      expect(firstU1?.order).toBe('PIN_SUPPRESS');
      expect(firstU2?.order === 'FLANK_LEFT' || firstU2?.order === 'FLANK_RIGHT').toBe(true);

      // Second evaluation reuses the exact same Map and pooled order objects
      const secondMap = coordinator.evaluateSquads(units, false, true);
      expect(secondMap).toBe(firstMap);
      expect(secondMap.get('u1')).toBe(firstU1);
      expect(secondMap.get('u2')).toBe(firstU2);

      // FriendlySquadManager order ping exposes world target coordinates for HUD marker
      const friendly = new FriendlySquadManager();
      friendly.initializeForMission({
        scene: null,
        resourceManager: null,
        scope: null,
        roster: createDefaultCoreRoster(),
        preferredSquadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
        spawnOrigin: { x: 0, y: 0, z: 0 },
        difficulty: 'normal',
      });
      friendly.issueCommand(
        {
          order: 'HOLD',
          source: 'desktop_quick_key',
          targetPos: { x: 5, y: 0, z: -12 },
          issuedAtSec: 1.0,
        },
        {
          playerPos: new THREE.Vector3(0, 0, 0),
          isEnemyAlive: () => false,
          getEnemyPos: () => null,
          isVehicleBoardable: () => false,
          getVehiclePos: () => null,
        }
      );
      const ping = friendly.getActiveOrderPingTarget();
      expect(ping).not.toBeNull();
      expect(ping!.x).toBeCloseTo(5, 2);
      expect(ping!.z).toBeCloseTo(-12, 2);
      expect(ping!.label).toBe('Hold Position');

      friendly.dispose(null);
    });
  });
});
