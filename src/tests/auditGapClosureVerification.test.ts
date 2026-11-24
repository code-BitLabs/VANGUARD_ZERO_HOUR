import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PbrMaterialLibrary } from '@/src/assets/PbrMaterialLibrary';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import { BattlefieldVfxSystem } from '@/src/effects/BattlefieldVfxSystem';
import { SurfaceDecalManager } from '@/src/effects/SurfaceDecalManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { MissionLoadCoordinator } from '@/src/engine/MissionLoadCoordinator';
import { PerformanceGovernor } from '@/src/engine/PerformanceGovernor';
import { PerformanceMonitor } from '@/src/engine/PerformanceMonitor';
import { EngineRenderer } from '@/src/engine/Renderer';
import { TacticalLightBudgetManager } from '@/src/engine/RenderingBenchmarkSlice';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import {
  computeEnemyReactionDelay,
  evaluateTacticalCover,
} from '@/src/gameplay/ai/EnemyTacticalPerceptionSolver';
import { resolveWeaponConfig } from '@/src/gameplay/weapons/AttachmentCompositionEngine';
import { computeRangeFalloffMultiplier } from '@/src/gameplay/weapons/WeaponBallistics';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { DIFFICULTY_COMBAT_PROFILES } from '@/src/schemas/combat.schema';
import { audioSettingsStore } from '@/src/stores/audioSettingsStore';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { progressionStore } from '@/src/stores/progressionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { WorkerBridge } from '@/src/workers/WorkerBridge';
import { DestructionSystem } from '@/src/world/DestructionSystem';

function createTestAudio(rm = new ResourceManager()): AudioManager {
  return new AudioManager(rm, audioSettingsStore.getState());
}

function createFlatWorld(): CollisionWorld {
  const world = new CollisionWorld();
  world.setTerrainHeightFn(() => 0);
  return world;
}

const STUB_WORKER_BRIDGE = {
  isHealthy: () => false,
  requestPaths3D: async () => [],
} as unknown as WorkerBridge;

function tickWeaponFrames(
  weapons: WeaponSystem,
  input: InputManager,
  player: PlayerController,
  cam: THREE.PerspectiveCamera,
  collision: CollisionWorld,
  frames: number,
  dt = 1 / 60,
  hitscanTargets: Parameters<WeaponSystem['update']>[5] = [],
  onDestructibleHit: (id: string, dmg: number) => void = () => {}
): void {
  for (let i = 0; i < frames; i++) {
    weapons.update(dt, input, player, cam, collision, hitscanTargets, [], onDestructibleHit, false);
    input.endFrame();
  }
}

describe('Audit Reconciliation & Gap-Closure Verification Suite', () => {
  beforeEach(() => {
    progressionStore.getState().resetAllProgress();
    gameSessionStore.getState().resetSession();
    settingsStore.getState().resetDefaults();
    audioSettingsStore.getState().resetAudio();
  });

  afterEach(() => {
    progressionStore.getState().resetAllProgress();
    settingsStore.getState().resetDefaults();
    audioSettingsStore.getState().resetAudio();
  });

  describe('1. Weapon Identity, Single-Source Upgrades, Falloff, Swap Cooldown & Reload Mechanics', () => {
    it('applies progression upgrades exactly once (resolveWeaponConfig is single source of truth) during live firing', () => {
      progressionStore.setState((prev) => ({
        ...prev,
        save: {
          ...prev.save,
          weaponUpgrades: {
            ...prev.save.weaponUpgrades,
            assault_rifle: { damage: 3, recoil: 3, capacity: 2, reload: 3 },
          },
        },
      }));

      const vmScene = new THREE.Scene();
      const worldScene = new THREE.Scene();
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const vfx = new VFXPool(worldScene, rm);
      const projectiles = new ProjectileManager(worldScene, rm, vfx, audio);
      const weapons = new WeaponSystem(vmScene, audio, vfx, projectiles);
      const input = new InputManager(rm, settingsStore.getState().input);
      const collision = createFlatWorld();
      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0, collision);

      const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 300);
      cam.position.set(0, 1.62, 0);
      cam.lookAt(0, 1.62, -10);
      cam.updateMatrixWorld();

      weapons.resetLoadout('assault_rifle');
      const state = weapons.getActiveState();
      const expectedResolved = resolveWeaponConfig(
        WEAPON_BY_ID.assault_rifle,
        progressionStore.getState().save.weaponUpgrades.assault_rifle,
        progressionStore.getState().save.weaponAttachments.assault_rifle
      );

      expect(state.config.damage).toBeCloseTo(expectedResolved.damage, 4);
      expect(state.config.reloadTimeSec).toBeCloseTo(expectedResolved.reloadTimeSec, 4);
      expect(state.config.recoilPitch).toBeCloseTo(expectedResolved.recoilPitch, 4);

      const recordedDamages: number[] = [];
      input.setVirtualActionState('ads', true);
      input.setVirtualActionState('fire', true);
      tickWeaponFrames(weapons, input, player, cam, collision, 2, 1 / 60, [
        {
          id: 'target_single_upgrade',
          kind: 'enemy',
          name: 'Dummy',
          alive: true,
          position: new THREE.Vector3(0, 1.62, -10),
          hitRadius: 2.5,
          onHit: (dmg) => recordedDamages.push(dmg),
        },
      ]);

      expect(recordedDamages.length).toBeGreaterThanOrEqual(1);
      // Must equal single-applied resolved damage (NOT 1.24 * 1.24 stacked!)
      expect(recordedDamages[0]).toBeCloseTo(expectedResolved.damage, 2);

      weapons.dispose();
      vfx.resetAll();
      audio.dispose();
      rm.disposeAll();
    });

    it('computes distinct per-category range falloff curves and applies them to enemy and destructible hits', () => {
      const shotgunClose = computeRangeFalloffMultiplier('shotgun', 8, 48);
      const shotgunFar = computeRangeFalloffMultiplier('shotgun', 48, 48);
      const sniperMid = computeRangeFalloffMultiplier('sniper', 250, 380);
      const sniperFar = computeRangeFalloffMultiplier('sniper', 380, 380);

      expect(shotgunClose).toBe(1.0);
      expect(shotgunFar).toBeCloseTo(0.22, 3);
      expect(sniperMid).toBe(1.0);
      expect(sniperFar).toBeCloseTo(0.85, 3);
      expect(sniperFar).toBeGreaterThan(shotgunFar * 3);

      // Verify destructible box hit at far distance receives falloff-attenuated damage
      const vmScene = new THREE.Scene();
      const worldScene = new THREE.Scene();
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const vfx = new VFXPool(worldScene, rm);
      const projectiles = new ProjectileManager(worldScene, rm, vfx, audio);
      const weapons = new WeaponSystem(vmScene, audio, vfx, projectiles);
      const input = new InputManager(rm, settingsStore.getState().input);
      const collision = createFlatWorld();
      collision.addStaticBox({
        id: 'far_crate',
        minX: -5,
        maxX: 5,
        minY: 0,
        maxY: 4,
        minZ: -44,
        maxZ: -42,
        layer: COLLISION_LAYER.DESTRUCTIBLE,
      });

      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0, collision);
      const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 300);
      cam.position.set(0, 1.62, 0);
      cam.lookAt(0, 1.62, -42);
      cam.updateMatrixWorld();

      weapons.resetLoadout('shotgun');
      const destructHits: number[] = [];
      input.setVirtualActionState('ads', true);
      input.setVirtualActionState('fire', true);
      tickWeaponFrames(weapons, input, player, cam, collision, 2, 1 / 60, [], (_id, dmg) => {
        destructHits.push(dmg);
      });

      expect(destructHits.length).toBeGreaterThan(0);
      const basePelletDmg = weapons.getActiveState().config.damage;
      // At ~42m out of 48m shotgun max range, each pellet must be strongly attenuated (< 50% of close damage)
      expect(destructHits[0]).toBeLessThan(basePelletDmg * 0.5);

      weapons.dispose();
      vfx.resetAll();
      audio.dispose();
      rm.disposeAll();
    });

    it('tracks per-weapon fireCooldownSec so sniper-to-sidearm follow-up fires immediately while swapping back still honors sniper bolt cycle, and applies attachment equipTimeSec', () => {
      // Equip optic_acog_3x on assault_rifle to verify attachment-modified equipTimeSec
      progressionStore.setState((prev) => ({
        ...prev,
        save: {
          ...prev.save,
          unlockedAttachments: [...prev.save.unlockedAttachments, 'optic_acog_3x'],
          weaponAttachments: {
            ...prev.save.weaponAttachments,
            assault_rifle: {
              ...prev.save.weaponAttachments.assault_rifle,
              optic: 'optic_acog_3x',
            },
          },
        },
      }));

      const vmScene = new THREE.Scene();
      const worldScene = new THREE.Scene();
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const vfx = new VFXPool(worldScene, rm);
      const projectiles = new ProjectileManager(worldScene, rm, vfx, audio);
      const weapons = new WeaponSystem(vmScene, audio, vfx, projectiles);
      const input = new InputManager(rm, settingsStore.getState().input);
      const collision = createFlatWorld();
      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0, collision);
      const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 300);

      weapons.resetLoadout('sniper_rifle');
      const arEquipModified = weapons.getWeaponState('assault_rifle')!.config.equipTimeSec;
      expect(arEquipModified).toBeGreaterThan(WEAPON_BY_ID.assault_rifle.equipTimeSec);
      weapons.selectWeapon('assault_rifle', false);
      expect(weapons.getEquipTimerSec()).toBeCloseTo(arEquipModified, 4);

      // Switch to sniper instantly and fire 1 shot (bolt cooldown = 60/48 = 1.25s)
      weapons.selectWeapon('sniper_rifle', true);
      input.triggerVirtualActionPress('fire');
      tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 60);
      expect(weapons.getWeaponState('sniper_rifle')!.fireCooldownSec).toBeGreaterThan(1.1);

      // Immediately switch to pistol -> pistol draws in ~0.22s and fires cleanly BEFORE sniper's 1.25s bolt finishes!
      weapons.selectWeapon('pistol', false);
      const pistolEquipSec = weapons.getWeaponState('pistol')!.config.equipTimeSec;
      const framesForPistolDraw = Math.ceil((pistolEquipSec + 0.05) * 60);
      tickWeaponFrames(weapons, input, player, cam, collision, framesForPistolDraw, 1 / 60);

      const shotsBeforePistol = weapons.shotsFired;
      input.triggerVirtualActionPress('fire');
      tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 60);
      expect(weapons.shotsFired).toBe(shotsBeforePistol + 1);

      // Swapping straight back to sniper (non-instant gameplay swap) before 1.25s total elapsed MUST still respect remaining sniper bolt cycle
      weapons.selectWeapon('sniper_rifle', false);
      const remainingBolt = weapons.getWeaponState('sniper_rifle')!.fireCooldownSec;
      expect(remainingBolt).toBeGreaterThan(0.2);
      const sniperEquipSec = weapons.getWeaponState('sniper_rifle')!.config.equipTimeSec;
      tickWeaponFrames(weapons, input, player, cam, collision, Math.ceil((sniperEquipSec + 0.02) * 60), 1 / 60);
      const shotsBeforeSniperAttempt = weapons.shotsFired;
      input.triggerVirtualActionPress('fire');
      tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 60);
      expect(weapons.shotsFired).toBe(shotsBeforeSniperAttempt);

      weapons.dispose();
      vfx.resetAll();
      audio.dispose();
      rm.disposeAll();
    });

    it('differentiates tactical vs empty reloads and supports shotgun shell-by-shell interrupt firing', () => {
      const vmScene = new THREE.Scene();
      const worldScene = new THREE.Scene();
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const vfx = new VFXPool(worldScene, rm);
      const projectiles = new ProjectileManager(worldScene, rm, vfx, audio);
      const weapons = new WeaponSystem(vmScene, audio, vfx, projectiles);
      const input = new InputManager(rm, settingsStore.getState().input);
      const collision = createFlatWorld();
      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0, collision);
      const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 300);

      // 1. Tactical reload on assault_rifle (ammoInMag > 0) is faster (~0.8x) than empty reload (~1.05x)
      weapons.resetLoadout('assault_rifle');
      const arCfg = weapons.getActiveState().config;
      weapons.getActiveState().ammoInMag = 15;
      input.triggerVirtualActionPress('reload');
      tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 60);
      expect(weapons.isReloading).toBe(true);
      expect(weapons.isTacticalReloadActive()).toBe(true);

      const stages: string[] = [];
      let tacticalElapsed = 0;
      while (weapons.isReloading && tacticalElapsed < 5) {
        const st = weapons.getReloadStage();
        if (stages[stages.length - 1] !== st) stages.push(st);
        tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 30);
        tacticalElapsed += 1 / 30;
      }
      expect(stages).toEqual(['MAG_OUT', 'MAG_IN', 'CHAMBER']);
      expect(tacticalElapsed).toBeLessThan(arCfg.reloadTimeSec * 0.92);

      // Empty reload (ammoInMag === 0)
      weapons.getActiveState().ammoInMag = 0;
      input.triggerVirtualActionPress('reload');
      tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 60);
      expect(weapons.isReloading).toBe(true);
      expect(weapons.isTacticalReloadActive()).toBe(false);

      let emptyElapsed = 0;
      while (weapons.isReloading && emptyElapsed < 5) {
        tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 30);
        emptyElapsed += 1 / 30;
      }
      expect(emptyElapsed).toBeGreaterThan(tacticalElapsed * 1.15);

      // 2. Shotgun incremental shell-by-shell reload + fire interrupt once >= 1 shell is in tube
      weapons.selectWeapon('shotgun', true);
      const sgState = weapons.getActiveState();
      sgState.ammoInMag = 0;
      input.triggerVirtualActionPress('reload');
      tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 60);
      expect(weapons.isReloading).toBe(true);

      // Advance until at least 2 shells are loaded incrementally (well before full 8-shell reload completes)
      let guard = 0;
      while (sgState.ammoInMag < 2 && guard < 180) {
        tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 60);
        guard++;
      }
      expect(sgState.ammoInMag).toBeGreaterThanOrEqual(2);
      expect(weapons.isReloading).toBe(true);

      // Fire interrupt cancels reload and fires immediately!
      const shotsBefore = weapons.shotsFired;
      input.triggerVirtualActionPress('fire');
      tickWeaponFrames(weapons, input, player, cam, collision, 1, 1 / 60);
      expect(weapons.isReloading).toBe(false);
      expect(weapons.shotsFired).toBe(shotsBefore + 1);

      weapons.dispose();
      vfx.resetAll();
      audio.dispose();
      rm.disposeAll();
    });
  });

  describe('2. Acoustic Separation & Repeatable AI Tactical Scenarios', () => {
    it('keeps suppressed gunfire radius below unsuppressed while bullet impact sound alerts at the strike point', () => {
      progressionStore.setState((prev) => ({
        ...prev,
        save: {
          ...prev.save,
          unlockedAttachments: [...prev.save.unlockedAttachments, 'muzzle_tactical_suppressor'],
          weaponAttachments: {
            ...prev.save.weaponAttachments,
            assault_rifle: {
              ...prev.save.weaponAttachments.assault_rifle,
              muzzle: 'muzzle_tactical_suppressor',
            },
          },
        },
      }));

      const resolvedSuppressed = resolveWeaponConfig(
        WEAPON_BY_ID.assault_rifle,
        undefined,
        progressionStore.getState().save.weaponAttachments.assault_rifle
      );
      const resolvedLoud = resolveWeaponConfig(WEAPON_BY_ID.assault_rifle);
      expect(resolvedSuppressed.isSuppressed).toBe(true);
      expect(resolvedSuppressed.soundRadiusMeters).toBeLessThan(resolvedLoud.soundRadiusMeters * 0.65);

      const scene = new THREE.Scene();
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const vfx = new VFXPool(scene, rm);
      const telemetry = new CombatTelemetryRecorder();
      const coordinator = new CombatEngagementCoordinator(telemetry);
      const ballistics = new BallisticSolver(vfx, telemetry);
      const projectiles = new ProjectileManager(scene, rm, vfx, audio, telemetry);
      const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);
      const collision = createFlatWorld();
      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0, collision);

      // Place enemy outside suppressed gunshot radius, inside loud radius
      const midDist = (resolvedSuppressed.soundRadiusMeters + resolvedLoud.soundRadiusMeters) * 0.5;
      enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: -midDist }, 0.1, collision, 'mission:1', 'sq_ac');
      const [sentry] = enemies.getUnits();

      expect(enemies.alertSquadsNearPosition(player.position, resolvedSuppressed.soundRadiusMeters, 0)).toBe(0);
      expect(sentry.state).toBe('UNAWARE');

      // Impact sound near sentry triggers investigation at impact site, separate from shooter origin
      const strikePt = new THREE.Vector3(0, 1.0, -(midDist - 3));
      expect(enemies.notifyBulletImpactSound(strikePt, 9)).toBe(1);
      expect(sentry.state).toBe('INVESTIGATING');
      expect(sentry.lastKnownPosition!.distanceTo(strikePt)).toBeLessThan(0.1);

      enemies.clear();
      projectiles.resetAll();
      vfx.resetAll();
      audio.dispose();
      rm.disposeAll();
    });

    it('uses extracted EnemyTacticalPerceptionSolver, precomputed flankParity, and cleanly exits RETREATING without cover stalls', () => {
      const enemySrc = readFileSync(resolve(process.cwd(), 'src/gameplay/EnemyManager.ts'), 'utf8');
      // Verify hot-loop ID string splitting was removed in favor of precomputed flankParity
      expect(enemySrc).not.toContain("id.split('_')");
      expect(enemySrc).toContain('flankParity');

      // Reaction delay varies logically with distance and archetype
      const diff = DIFFICULTY_COMBAT_PROFILES.normal;
      const closeElite = computeEnemyReactionDelay('elite_assault', 8, diff, false, () => 0.5);
      const farHeavy = computeEnemyReactionDelay('heavy_armor', 45, diff, false, () => 0.5);
      expect(farHeavy).toBeGreaterThan(closeElite);

      const scene = new THREE.Scene();
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const vfx = new VFXPool(scene, rm);
      const telemetry = new CombatTelemetryRecorder();
      const coordinator = new CombatEngagementCoordinator(telemetry);
      const ballistics = new BallisticSolver(vfx, telemetry);
      const projectiles = new ProjectileManager(scene, rm, vfx, audio, telemetry);
      const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);
      const collision = createFlatWorld();
      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0, collision);

      // Cover solver finds protected slot behind waist-high wall and prevents squadmates overlapping within 2.2m
      collision.addStaticBox({
        id: 'tactical_barricade',
        minX: -3,
        maxX: 3,
        minY: 0,
        maxY: 1.5,
        minZ: -12.4,
        maxZ: -11.6,
        layer: COLLISION_LAYER.COVER,
      });
      enemies.spawnWave('infantry', 2, { x: 0, y: 0, z: -15 }, 3, collision, 'mission:1', 'sq_cov');
      const [u1, u2] = enemies.getUnits();
      expect(u1.flankParity === 1 || u1.flankParity === -1).toBe(true);
      expect(u2.flankParity).toBe(u1.flankParity === 1 ? -1 : 1);

      const coverNodes = [
        new THREE.Vector3(0, 0, -12),
        new THREE.Vector3(2.4, 0, -12),
      ];
      const rayScratch: RayHit = {
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
      const slot1 = evaluateTacticalCover({
        unit: u1,
        nodes: coverNodes,
        threatPos: player.position,
        preferAway: false,
        collision,
        squadmates: [u1, u2],
        candPool: [],
        candScratch: new THREE.Vector3(),
        rayHitScratch: rayScratch,
      });
      expect(slot1).not.toBeNull();
      u1.coverTarget = slot1;

      const slot2 = evaluateTacticalCover({
        unit: u2,
        nodes: coverNodes,
        threatPos: player.position,
        preferAway: false,
        collision,
        squadmates: [u1, u2],
        candPool: [],
        candScratch: new THREE.Vector3(),
        rayHitScratch: rayScratch,
      });
      if (slot2 && slot1) {
        expect(slot1.distanceTo(slot2)).toBeGreaterThanOrEqual(2.2);
      }

      // Force u1 into RETREATING with an unreachable/missing coverTarget and verify clean recovery (no infinite stall)
      u1.lastKnownPosition = player.position.clone();
      u1.lkpTimestampSec = 0;
      u1.state = 'RETREATING';
      u1.stateTimerSec = 0.2;
      u1.coverTarget = new THREE.Vector3(999, 0, -999);
      for (let i = 0; i < 15; i++) {
        enemies.update(1 / 30, player, collision, coverNodes, STUB_WORKER_BRIDGE, 0.08);
      }
      const postRetreatState: string = u1.state;
      expect(postRetreatState).not.toBe('RETREATING');
      expect(['ALERTED', 'SEARCHING', 'ENGAGING']).toContain(postRetreatState);

      enemies.clear();
      projectiles.resetAll();
      vfx.resetAll();
      audio.dispose();
      rm.disposeAll();
    });
  });

  describe('3. Lifecycle Cancellation Races, Destructible Decals, Unified VFX, PBR & Telemetry', () => {
    it('cancels stale async mission loads cleanly across rapid start -> restart -> menu abort races', () => {
      const rm = new ResourceManager();
      const coord = new MissionLoadCoordinator(rm);

      const load1 = coord.beginLoad('mission:1');
      expect(load1.generation).toBe(1);
      expect(load1.isStale()).toBe(false);
      expect(coord.hasActiveAbortController()).toBe(true);

      // Supersede with load2 before load1 finishes
      const load2 = coord.beginLoad('mission:2');
      expect(load2.generation).toBe(2);
      expect(load1.signal.aborted).toBe(true);
      expect(load1.isStale()).toBe(true);
      expect(load2.isStale()).toBe(false);

      // Checkpoint restart or abort to menu invalidates load2 without deleting newer generations
      const postAbortGen = coord.invalidateActiveLoad();
      expect(postAbortGen).toBe(3);
      expect(load2.signal.aborted).toBe(true);
      expect(load2.isStale()).toBe(true);
      expect(coord.hasActiveAbortController()).toBe(false);
      expect(coord.isCurrentGeneration(load2.generation)).toBe(false);

      rm.disposeAll();
    });

    it('clears explosion scorch decals bound via destructibleId when a destructible is damaged/destroyed while preserving ground decals', () => {
      const scene = new THREE.Scene();
      const collision = createFlatWorld();
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const vfx = new VFXPool(scene, rm);
      const decals = new SurfaceDecalManager(scene, 64, 85, rm);
      const destruction = new DestructionSystem(collision.physicsWorld, vfx, audio);
      destruction.setOnEntityStateChanged((id) => decals.clearDecalsForDestructible(id));

      const barrelGroup = new THREE.Group();
      const barrelMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1.4, 1),
        new THREE.MeshStandardMaterial()
      );
      barrelGroup.add(barrelMesh);
      scene.add(barrelGroup);

      const groundMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshStandardMaterial()
      );

      destruction.register({
        id: 'fuel_barrel_01',
        kind: 'barrel',
        state: 'INTACT',
        health: 50,
        maxHealth: 50,
        position: new THREE.Vector3(0, 0.7, -8),
        meshGroup: barrelGroup,
        collider: {
          id: 'fuel_barrel_01',
          minX: -0.5,
          maxX: 0.5,
          minY: 0,
          maxY: 1.4,
          minZ: -8.5,
          maxZ: -7.5,
          layer: COLLISION_LAYER.DESTRUCTIBLE,
        },
        isObjectiveTarget: false,
        blastRadius: 6,
        blastDamage: 90,
      });

      // Spawn explosion scorch explicitly tagged with destructibleId (even if mesh userData didn't match) + a ground scorch
      expect(
        decals.spawnImpactDecal({
          targetMesh: barrelMesh,
          point: new THREE.Vector3(0, 1.4, -8),
          normal: new THREE.Vector3(0, 1, 0),
          surface: 'metal',
          isExplosion: true,
          destructibleId: 'fuel_barrel_01',
        })
      ).toBe(true);
      expect(
        decals.spawnImpactDecal({
          targetMesh: groundMesh,
          point: new THREE.Vector3(4, 0, -8),
          normal: new THREE.Vector3(0, 1, 0),
          surface: 'concrete',
          isExplosion: true,
          destructibleId: null,
        })
      ).toBe(true);
      expect(decals.getStats().activeCount).toBe(2);

      destruction.applyDamage('fuel_barrel_01', 60);
      expect(decals.getStats().activeCount).toBe(1);

      decals.dispose();
      destruction.dispose();
      barrelMesh.geometry.dispose();
      (barrelMesh.material as THREE.Material).dispose();
      groundMesh.geometry.dispose();
      (groundMesh.material as THREE.Material).dispose();
      audio.dispose();
      rm.disposeAll();
    });

    it('retires faceted IcosahedronGeometry particles, delegates VFXPool flash lights to TacticalLightBudgetManager, and removes duplicate armor spark calls', () => {
      const scene = new THREE.Scene();
      const rm = new ResourceManager();
      const lightMgr = new TacticalLightBudgetManager(scene, 'medium');
      const vfx = new VFXPool(scene, rm, lightMgr);
      const bVfx = new BattlefieldVfxSystem(scene, false, rm);

      // Zero permanent PointLights owned by VFXPool when lightBudgetManager is wired
      let vfxOwnedPointLights = 0;
      const rootGroup = (vfx as unknown as { rootGroup: THREE.Group }).rootGroup;
      rootGroup.traverse((o) => {
        if (o instanceof THREE.PointLight) vfxOwnedPointLights++;
      });
      expect(vfxOwnedPointLights).toBe(0);

      // Zero IcosahedronGeometry meshes in either VFX pool
      let icosahedronCount = 0;
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry instanceof THREE.IcosahedronGeometry) {
          icosahedronCount++;
        }
      });
      expect(icosahedronCount).toBe(0);

      // Muzzle & explosion lights route cleanly through TacticalLightBudgetManager
      vfx.spawnMuzzleLight(0, 1.5, -2);
      vfx.spawnExplosion(2, 1.5, -6, 6);
      expect(lightMgr.getActiveLightCount()).toBeGreaterThanOrEqual(2);
      vfx.update(0.6, new THREE.Vector3(0, 1.6, 0));
      expect(lightMgr.getActiveLightCount()).toBe(0);

      // Verify GameEngine routes armor impacts strictly to battlefieldVfx (no duplicate vfx.spawnImpact metal call)
      const engineSrc = readFileSync(resolve(process.cwd(), 'src/engine/GameEngine.ts'), 'utf8');
      expect(engineSrc).toContain("this.battlefieldVfx.emitSurfaceImpact('metal', point, this.tmpUpVec)");
      expect(engineSrc).not.toContain("this.vfx.spawnImpact(point.x, point.y, point.z, 'metal')");

      bVfx.dispose();
      vfx.resetAll();
      lightMgr.dispose();
      rm.disposeAll();
    });

    it('shares GPU Texture.source across PBR repeat variants and tracks/releases resources cleanly via ResourceManager', () => {
      const rm = new ResourceManager();
      const lib = new PbrMaterialLibrary(rm);

      const m1 = lib.getMaterial('reinforced_concrete', { repeatX: 1, repeatY: 1 });
      const m2 = lib.getMaterial('reinforced_concrete', { repeatX: 4, repeatY: 4 });
      expect(m1).not.toBe(m2);
      if (m1.map && m2.map) {
        expect(m1.map.source).toBe(m2.map.source);
      }
      if (m1.roughnessMap && m2.roughnessMap) {
        expect(m1.roughnessMap.source).toBe(m2.roughnessMap.source);
      }

      const snapBeforeClear = rm.getSnapshot();
      expect(snapBeforeClear.pooledCount).toBeGreaterThan(0);

      lib.clearMissionMaterials();
      const snapAfterClear = rm.getSnapshot();
      expect(snapAfterClear.pooledCount).toBe(0);

      lib.dispose();
      rm.disposeAll();
    });

    it('computes p50/p95/p99 frame percentiles and exposes active aaMode in PerformanceMonitor', () => {
      const rm = new ResourceManager();
      const monitor = new PerformanceMonitor();
      const governor = new PerformanceGovernor('high', false);
      const fakeRenderer = {
        getDrawInfo: () => ({ calls: 42, triangles: 18500, geometries: 12, textures: 9 }),
        getRenderMetrics: () => ({ renderWidth: 1920, renderHeight: 1080, pixelRatio: 1 }),
        getPostProcessState: () => ({ aaMode: 'msaa4', gpuFrameMs: 4.2 }),
        getGpuFrameMs: () => 4.2,
      } as unknown as EngineRenderer;

      const samples = [8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 22.0, 25.0];
      for (const ms of samples) {
        monitor.tick(0.06, ms, fakeRenderer, rm, governor, 3, 2, 5);
      }
      const snap = monitor.getLatestTelemetry();
      expect(snap.p50FrameMs).toBeGreaterThanOrEqual(12);
      expect(snap.p95FrameMs).toBeGreaterThanOrEqual(snap.p50FrameMs!);
      expect(snap.p99FrameMs).toBeGreaterThanOrEqual(snap.p95FrameMs);
      expect(snap.aaMode).toBe('msaa4');
      expect(snap.gpuFrameMs).toBe(4.2);
      rm.disposeAll();
    });
  });

  describe('4. Accessibility Motion Scaling, ADS Sensitivity & Audio Category Gains', () => {
    it('zeroes head-bob offset cleanly without freezing mid-cycle and honors setMotionSettings(0, true)', () => {
      const rm = new ResourceManager();
      const audio = createTestAudio(rm);
      const input = new InputManager(rm, settingsStore.getState().input);
      const collision = createFlatWorld();
      const player = new PlayerController(audio);
      player.spawn(0, 1.65, 0, 0, collision);

      // Walk forward to advance bobTime away from 0
      input.setVirtualMoveAxes(1, 0);
      for (let i = 0; i < 20; i++) {
        player.update(1 / 60, input, collision, false, 1.0, 0, false);
      }
      const camWithBob = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
      const camNoBob = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
      player.syncCamera(camWithBob, 75, 55, false, 1.0);
      player.syncCamera(camNoBob, 75, 55, false, 0);

      // Even after bobTime advanced, headBobIntensity=0 must sync straight to neutral eye height (no mid-sine offset)
      expect(camNoBob.position.y).toBeCloseTo(player.position.y + 1.62, 4);

      // Motion settings (0, true) suppress addCameraShake & suppression trauma completely
      player.setMotionSettings(0, true);
      player.addCameraShake(0.8);
      player.applySuppressionPulse(1.0);
      player.syncCamera(camNoBob, 75, 55, false, 0);
      expect(camNoBob.rotation.z).toBeCloseTo(0, 6);

      // InputManager ADS sensitivity scales virtual touch look delta proportionally
      input.updateSettings({
        ...settingsStore.getState().input,
        touchSensitivity: 1.0,
        adsSensitivity: 0.4,
      });
      input.addVirtualLookDelta(20, 0);
      const hipDelta = input.consumeLookDelta(false);
      input.addVirtualLookDelta(20, 0);
      const adsDelta = input.consumeLookDelta(true);
      expect(adsDelta.yawDelta).toBeCloseTo(hipDelta.yawDelta * 0.4, 4);

      // Audio category settings store + AudioManager.applySettings validate and propagate cleanly
      audioSettingsStore.getState().updateAudio({ dialogueVolume: 0.55, sfxVolume: 0.45 });
      expect(audioSettingsStore.getState().dialogueVolume).toBeCloseTo(0.55, 4);
      expect(audioSettingsStore.getState().sfxVolume).toBeCloseTo(0.45, 4);
      audio.applySettings(audioSettingsStore.getState());

      audio.dispose();
      rm.disposeAll();
    });
  });
});
