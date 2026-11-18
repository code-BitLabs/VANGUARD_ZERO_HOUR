import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { EnemyArchetype } from '@/src/schemas/enemy.schema';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { WorkerBridge } from '@/src/workers/WorkerBridge';
import { buildSoldierRig } from '@/src/world/rigs/EnemyRigBuilder';

function createWeaponTestHarness() {
  const resources = new ResourceManager();
  const scene = new THREE.Scene();
  const vmScene = new THREE.Scene();
  const audio = new AudioManager(resources, SettingsBundleSchema.parse({ audio: { muted: true } }).audio);
  const vfx = new VFXPool(scene, resources);
  const telemetry = new CombatTelemetryRecorder();
  const projectiles = new ProjectileManager(scene, resources, vfx, audio, telemetry);
  const weapons = new WeaponSystem(vmScene, audio, vfx, projectiles);
  const input = new InputManager(resources, SettingsBundleSchema.parse({}).input);
  const player = new PlayerController(audio);
  player.spawn(0, 0, 0, 0);
  const collision = new CollisionWorld();
  collision.setTerrainHeightFn(() => 0);
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
  camera.position.set(0, 1.66, 0);
  camera.updateMatrixWorld(true);

  return {
    resources,
    scene,
    vmScene,
    audio,
    vfx,
    projectiles,
    weapons,
    input,
    player,
    collision,
    camera,
    cleanup() {
      weapons.dispose();
      resources.disposeAll();
    },
  };
}

function getWeaponInternalRigs(weapons: WeaponSystem) {
  return (
    weapons as unknown as {
      rigs: Map<
        string,
        {
          root: THREE.Group;
          muzzleFlash: THREE.Mesh;
          slideOrBolt: THREE.Object3D | null;
          slideRestZ: number;
          magazine: THREE.Object3D | null;
          magazineRestPos: THREE.Vector3;
          secondaryPart: THREE.Object3D | null;
          animProfile: { hipPos: readonly [number, number, number]; adsPos: readonly [number, number, number] };
        }
      >;
      viewModelMuzzleLight: THREE.PointLight;
    }
  );
}

describe('TRN-06: Weapon ViewModel & Articulated Enemy Animation', () => {
  it('smoothly transitions ADS, triggers muzzle PointLight + weapon-specific slide/bolt/drum/warhead recoil, and settles cleanly', () => {
    const h = createWeaponTestHarness();
    const internal = getWeaponInternalRigs(h.weapons);

    // 1. Assault Rifle ADS blend + firing kick + muzzle light
    h.weapons.resetLoadout('assault_rifle');
    const arRig = internal.rigs.get('assault_rifle')!;
    h.input.setVirtualActionState('ads', true);
    for (let i = 0; i < 30; i++) {
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
    }
    expect(h.weapons.isAds).toBe(true);
    expect(Math.abs(arRig.root.position.x)).toBeLessThan(0.015);
    expect(arRig.root.position.y).toBeCloseTo(arRig.animProfile.adsPos[1], 2);

    // Fire 1 shot in ADS -> flash visible, muzzle light bright, recoil kick active
    h.input.setVirtualActionState('fire', true);
    h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
    h.input.endFrame();
    h.input.setVirtualActionState('fire', false);
    expect(h.weapons.shotsFired).toBe(1);
    expect(arRig.muzzleFlash.visible).toBe(true);
    expect(internal.viewModelMuzzleLight.intensity).toBeGreaterThan(2.5);

    // Let flash fade and slide settle
    for (let i = 0; i < 45; i++) {
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
    }
    expect(arRig.muzzleFlash.visible).toBe(false);
    expect(internal.viewModelMuzzleLight.intensity).toBe(0);
    expect(arRig.slideOrBolt!.position.z).toBeCloseTo(arRig.slideRestZ, 3);

    // 2. Grenade Launcher rotary drum indexes 60 deg (PI/3) on shot
    h.input.setVirtualActionState('ads', false);
    h.weapons.selectWeapon('grenade_launcher', true);
    const glRig = internal.rigs.get('grenade_launcher')!;
    const drumZ0 = glRig.slideOrBolt!.rotation.z;
    h.input.setVirtualActionState('fire', true);
    h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
    h.input.endFrame();
    h.input.setVirtualActionState('fire', false);
    for (let i = 0; i < 25; i++) {
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
    }
    expect(glRig.slideOrBolt!.rotation.z - drumZ0).toBeCloseTo(Math.PI / 3, 2);

    // 3. Sniper rifle bolt throws (lifts rotation.z & retracts slideOrBolt) shortly after shot
    h.weapons.selectWeapon('sniper_rifle', true);
    const sniperRig = internal.rigs.get('sniper_rifle')!;
    h.input.setVirtualActionState('fire', true);
    h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
    h.input.endFrame();
    h.input.setVirtualActionState('fire', false);
    for (let i = 0; i < 18; i++) {
      // ~0.31s post-shot, mid bolt-cycle window (0.14..0.72s)
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
    }
    expect(Math.abs(sniperRig.slideOrBolt!.rotation.z)).toBeGreaterThan(0.3);
    expect(sniperRig.slideOrBolt!.position.z).toBeGreaterThan(sniperRig.slideRestZ + 0.02);

    h.cleanup();
  });

  it('drives 3-stage reload keyframes and enforces strict weapon authority when reload is aborted by weapon switch', () => {
    const h = createWeaponTestHarness();
    const internal = getWeaponInternalRigs(h.weapons);
    h.weapons.resetLoadout('assault_rifle');
    const arRig = internal.rigs.get('assault_rifle')!;
    const restMagY = arRig.magazineRestPos.y;

    // Spend 1 round so reload can start
    h.input.setVirtualActionState('fire', true);
    h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
    h.input.endFrame();
    h.input.setVirtualActionState('fire', false);
    expect(h.weapons.getActiveState().ammoInMag).toBe(29);

    // Trigger reload
    h.input.setVirtualActionState('reload', true);
    h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
    h.input.endFrame();
    h.input.setVirtualActionState('reload', false);
    expect(h.weapons.isReloading).toBe(true);

    // Advance into MAG_OUT (~0.35s) -> magazine drops out cleanly
    for (let i = 0; i < 18; i++) {
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
    }
    expect(h.weapons.getReloadStage()).toBe('MAG_OUT');
    expect(arRig.magazine!.position.y).toBeLessThan(restMagY - 0.05);
    expect(h.weapons.getActiveState().ammoInMag).toBe(29);

    // Interrupt reload mid-way by switching to slot 2 (SMG) -> must NOT grant ammo and must reset mag/pose
    h.input.queueWeaponSlot(2);
    h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
    h.input.endFrame();
    expect(h.weapons.isReloading).toBe(false);
    expect(h.weapons.getWeaponState('assault_rifle')!.ammoInMag).toBe(29);
    expect(arRig.magazine!.position.y).toBeCloseTo(restMagY, 4);
    expect(h.weapons.getActiveState().config.id).toBe('smg');

    // Switch back to AR, complete full reload across MAG_OUT -> MAG_IN -> CHAMBER -> READY
    h.weapons.selectWeapon('assault_rifle', true);
    h.input.setVirtualActionState('reload', true);
    h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
    h.input.endFrame();
    h.input.setVirtualActionState('reload', false);

    let sawChamberBoltPull = false;
    for (let i = 0; i < 130; i++) {
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
      if (h.weapons.getReloadStage() === 'CHAMBER' && arRig.slideOrBolt!.position.z > arRig.slideRestZ + 0.02) {
        sawChamberBoltPull = true;
      }
      if (!h.weapons.isReloading) break;
    }
    expect(sawChamberBoltPull).toBe(true);
    expect(h.weapons.isReloading).toBe(false);
    expect(h.weapons.getActiveState().ammoInMag).toBe(30);
    expect(arRig.magazine!.position.y).toBeCloseTo(restMagY, 3);

    h.cleanup();
  });

  it('couples player.isVaulting tuck and landing spring offset into viewmodel pose without granting free shots', () => {
    const h = createWeaponTestHarness();
    const internal = getWeaponInternalRigs(h.weapons);
    h.weapons.resetLoadout('assault_rifle');
    const arRig = internal.rigs.get('assault_rifle')!;

    for (let i = 0; i < 20; i++) {
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
    }
    const steadyHipY = arRig.root.position.y;

    // Enter vault while holding ADS + fire -> ADS suppressed, weapon tucks down, no shots fired
    h.player.isVaulting = true;
    h.input.setVirtualActionState('ads', true);
    h.input.setVirtualActionState('fire', true);
    for (let i = 0; i < 15; i++) {
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
    }
    expect(h.weapons.isAds).toBe(false);
    expect(h.weapons.shotsFired).toBe(0);
    expect(arRig.root.position.y).toBeLessThan(steadyHipY - 0.08);
    expect(arRig.root.rotation.x).toBeLessThan(-0.12);

    // Exit vault and apply landing spring compression
    h.player.isVaulting = false;
    h.input.setVirtualActionState('ads', false);
    h.input.setVirtualActionState('fire', false);
    (h.player as unknown as { landCompressionOffset: number }).landCompressionOffset = -0.18;
    for (let i = 0; i < 10; i++) {
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
    }
    expect(arRig.root.position.y).toBeLessThan(steadyHipY - 0.01);

    h.cleanup();
  });

  it('drives articulated enemy rigs across patrol, speed-synced locomotion, aim/fire muzzle flash, crouch/cover, hit flinch, and grounded death collapse', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({ audio: { muted: true } }).audio);
    const vfx = new VFXPool(scene, rm);
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(vfx, telemetry);
    const projectiles = new ProjectileManager(scene, rm, vfx, audio, telemetry);
    const collision = new CollisionWorld();
    collision.setTerrainHeightFn(() => 0);

    // Cover barrier between player (0,0,16) and enemy
    collision.addStaticBox({
      id: 'enemy_cover_wall',
      minX: -2,
      minY: 0,
      minZ: -1,
      maxX: 2,
      maxY: 1.4,
      maxZ: 0.4,
      layer: COLLISION_LAYER.COVER,
      tag: 'cover_barrier',
    });

    const player = new PlayerController(audio);
    player.spawn(0, 0, 16, 0);
    const enemies = new EnemyManager(scene, rm, vfx, audio, projectiles, coordinator, ballistics, telemetry);
    const stubWorker = { isHealthy: () => false, requestPaths: async () => null } as unknown as WorkerBridge;

    enemies.spawnWave('infantry', 1, { x: 0, y: 0, z: -12 }, 0.1, collision, 'mission:1');
    const unit = enemies.getUnits()[0];
    unit.position.set(0, 0, -12);
    unit.yaw = 0;
    unit.initialGraceTimerSec = 0;

    // 1. Stationary UNAWARE: zero walkPhase advance (no foot slide), low-ready arm carry
    const initialPhase = unit.walkPhase;
    for (let i = 0; i < 15; i++) {
      enemies.update(1 / 60, player, collision, [], stubWorker, 0.1);
      // Keep enemy unaware by keeping unit pointed away first
      unit.yaw = Math.PI;
      unit.state = 'UNAWARE';
      unit.isMoving = false;
      unit.velocity.set(0, 0, 0);
    }
    expect(unit.walkPhase).toBeCloseTo(initialPhase, 5);
    expect(unit.weaponArm.rotation.x).toBeGreaterThan(0.1);

    // 2. Speed-synced locomotion + anatomical knees (never negative hyperextension)
    unit.state = 'ENGAGING';
    unit.isMoving = true;
    unit.velocity.set(0, 0, 4.5);
    const movePhase0 = unit.walkPhase;
    for (let i = 0; i < 20; i++) {
      unit.isMoving = true;
      unit.velocity.set(0, 0, 4.5);
      (enemies as unknown as { stepUnitAnimation: (u: typeof unit, dt: number, p: PlayerController, d: number) => void }).stepUnitAnimation(
        unit,
        1 / 60,
        player,
        28
      );
      expect(unit.leftKnee.rotation.x).toBeGreaterThan(0);
      expect(unit.rightKnee.rotation.x).toBeGreaterThan(0);
    }
    expect(unit.walkPhase).toBeGreaterThan(movePhase0 + 1.0);

    // 3. Tactical crouch + reload pose + left support arm engagement
    unit.isMoving = false;
    unit.velocity.set(0, 0, 0);
    unit.coverTarget = new THREE.Vector3(0, 0, -2);
    unit.isReloading = true;
    unit.reloadTimerSec = 1.2;
    unit.ammoInMag = 0;
    for (let i = 0; i < 30; i++) {
      (enemies as unknown as { stepUnitAnimation: (u: typeof unit, dt: number, p: PlayerController, d: number) => void }).stepUnitAnimation(
        unit,
        1 / 60,
        player,
        14
      );
    }
    expect(unit.animCrouchBlend).toBeGreaterThan(0.85);
    expect(unit.pelvisGroup.position.y).toBeLessThan(unit.hipRestY - 0.15);
    expect(unit.leftKnee.rotation.x).toBeGreaterThan(0.8);
    // Strict authority: animation never grants ammo while isReloading stays true
    expect(unit.ammoInMag).toBe(0);

    // 4. Engaged firing recoil & muzzle flash visibility
    unit.isReloading = false;
    unit.coverTarget = null;
    unit.state = 'ENGAGING';
    unit.hasLos = true;
    (enemies as unknown as { executeEnemyWeaponShot: (...args: unknown[]) => void }).executeEnemyWeaponShot(
      unit,
      { accuracy: 0.7, canUseRockets: false },
      { baseSpreadRad: 0.02, isProjectile: false, baseDamage: 8 },
      { damageMultiplier: 1, reactionDelayBaseSec: 0.25, reactionDelayJitterSec: 0, burstPauseMultiplier: 1, spreadMultiplier: 1 },
      14,
      false,
      player.position,
      player,
      collision
    );
    (enemies as unknown as { stepUnitAnimation: (u: typeof unit, dt: number, p: PlayerController, d: number) => void }).stepUnitAnimation(
      unit,
      1 / 60,
      player,
      14
    );
    expect(unit.muzzleFlash.visible).toBe(true);
    expect(unit.animFireRecoilTimer).toBeGreaterThan(0);

    // 5. Hit reaction stagger & grounded multi-joint death collapse (no horizontal root motion)
    const preHitX = unit.position.x;
    const preHitZ = unit.position.z;
    enemies.damageUnit(unit, 15, true, new THREE.Vector3(2, 1.5, 0));
    expect(unit.hitReactTimer).toBeGreaterThan(0.2);
    expect(unit.animHitHeadshot).toBe(true);
    (enemies as unknown as { stepUnitAnimation: (u: typeof unit, dt: number, p: PlayerController, d: number) => void }).stepUnitAnimation(
      unit,
      0.05,
      player,
      14
    );
    expect(unit.torsoGroup.rotation.x).toBeLessThan(0.2);

    // Fatal damage -> multi-joint collapse grounded at groundY, flash off, alive stays false
    const killed = enemies.damageUnit(unit, 9999, false);
    expect(killed).toBe(true);
    expect(unit.alive).toBe(false);
    for (let i = 0; i < 40; i++) {
      enemies.update(1 / 60, player, collision, [], stubWorker, 0.1);
    }
    expect(unit.alive).toBe(false);
    expect(unit.muzzleFlash.visible).toBe(false);
    expect(unit.pelvisGroup.position.y).toBeCloseTo(0.16, 2);
    expect(Math.abs(unit.torsoGroup.rotation.x)).toBeGreaterThan(1.0);
    expect(unit.leftKnee.rotation.x).toBeGreaterThan(1.1);
    expect(unit.position.x).toBeCloseTo(preHitX, 5);
    expect(unit.position.z).toBeCloseTo(preHitZ, 5);

    enemies.clear();
    rm.unloadScope('mission:1');
    rm.disposeAll();
  });

  it('maintains frame-rate independence across 30Hz, 60Hz, and 120Hz for weapons and enemy animation', () => {
    const runWeaponSample = (hz: number) => {
      const h = createWeaponTestHarness();
      h.weapons.resetLoadout('assault_rifle');
      h.input.setVirtualActionState('ads', true);
      const totalSteps = Math.round(0.6 * hz);
      const dt = 1 / hz;
      for (let i = 0; i < totalSteps; i++) {
        h.weapons.update(dt, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
        h.input.endFrame();
      }
      const rig = getWeaponInternalRigs(h.weapons).rigs.get('assault_rifle')!;
      const res = {
        x: rig.root.position.x,
        y: rig.root.position.y,
        z: rig.root.position.z,
        rx: rig.root.rotation.x,
      };
      h.cleanup();
      return res;
    };

    const w30 = runWeaponSample(30);
    const w60 = runWeaponSample(60);
    const w120 = runWeaponSample(120);
    expect(Math.abs(w30.x - w120.x)).toBeLessThan(0.005);
    expect(Math.abs(w60.y - w120.y)).toBeLessThan(0.005);
    expect(Math.abs(w60.z - w120.z)).toBeLessThan(0.005);

    const runEnemySample = (hz: number) => {
      const rm = new ResourceManager();
      const scene = new THREE.Scene();
      const audio = new AudioManager(rm, SettingsBundleSchema.parse({ audio: { muted: true } }).audio);
      const vfx = new VFXPool(scene, rm);
      const proj = new ProjectileManager(scene, rm, vfx, audio);
      const cw = new CollisionWorld();
      cw.setTerrainHeightFn(() => 0);
      const player = new PlayerController(audio);
      player.spawn(0, 0, 20, 0);
      const em = new EnemyManager(scene, rm, vfx, audio, proj);
      em.spawnWave('infantry', 1, { x: 0, y: 0, z: 0 }, 0.1, cw, 'mission:1');
      const u = em.getUnits()[0];
      u.state = 'ENGAGING';
      u.isReloading = true;
      u.reloadTimerSec = 2.0;

      const dt = 1 / hz;
      const steps = Math.round(0.5 * hz);
      const stepAnim = (em as unknown as { stepUnitAnimation: (unit: typeof u, dt: number, p: PlayerController, d: number) => void }).stepUnitAnimation.bind(em);
      for (let i = 0; i < steps; i++) {
        stepAnim(u, dt, player, 20);
      }
      const pose = {
        hipY: u.pelvisGroup.position.y,
        crouch: u.animCrouchBlend,
        knee: u.leftKnee.rotation.x,
      };
      em.clear();
      rm.unloadScope('mission:1');
      rm.disposeAll();
      return pose;
    };

    const e30 = runEnemySample(30);
    const e60 = runEnemySample(60);
    const e120 = runEnemySample(120);
    expect(Math.abs(e30.crouch - e120.crouch)).toBeLessThan(0.015);
    expect(Math.abs(e60.hipY - e120.hipY)).toBeLessThan(0.006);
    expect(Math.abs(e60.knee - e120.knee)).toBeLessThan(0.015);
  });

  it('guarantees zero GPU resource leaks across all 9 weapons and 6 enemy archetypes on dispose/unload', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const vmScene = new THREE.Scene();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({ audio: { muted: true } }).audio);
    const vfx = new VFXPool(scene, rm);
    const proj = new ProjectileManager(scene, rm, vfx, audio);

    rm.recordBaseline();
    const weapons = new WeaponSystem(vmScene, audio, vfx, proj);
    expect(WEAPON_CATALOG).toHaveLength(9);
    weapons.dispose();
    expect(vmScene.children.length).toBe(0);

    const archetypes: EnemyArchetype[] = [
      'infantry',
      'elite_assault',
      'heavy_armor',
      'sniper',
      'rocket_trooper',
      'drone_operator',
    ];
    for (let cycle = 0; cycle < 4; cycle++) {
      for (const arch of archetypes) {
        const rig = buildSoldierRig('#ef4444', arch, 'mission:1', rm);
        expect(rig.root.children.length).toBeGreaterThanOrEqual(4);
        scene.add(rig.root);
        rm.register('object3d', 'mission:1', () => scene.remove(rig.root));
      }
      rm.unloadScope('mission:1');
      const delta = rm.auditTransitionDelta();
      expect(delta.hasMissionLeak).toBe(false);
      expect(delta.missionRemaining).toBe(0);
    }

    rm.disposeAll();
  });

  it('TRN-06 Performance Benchmark: measures WeaponSystem and EnemyManager animation CPU cost at 5, 15, and 30 units', () => {
    const h = createWeaponTestHarness();
    h.weapons.resetLoadout('assault_rifle');
    h.input.setVirtualActionState('ads', true);
    const w0 = performance.now();
    for (let i = 0; i < 180; i++) {
      h.weapons.update(1 / 60, h.input, h.player, h.camera, h.collision, [], [], () => {}, false);
      h.input.endFrame();
    }
    const weaponMsPerTick = (performance.now() - w0) / 180;
    h.cleanup();

    const runEnemyBench = (count: number) => {
      const rm = new ResourceManager();
      const scene = new THREE.Scene();
      const audio = new AudioManager(rm, SettingsBundleSchema.parse({ audio: { muted: true } }).audio);
      const vfx = new VFXPool(scene, rm);
      const proj = new ProjectileManager(scene, rm, vfx, audio);
      const cw = new CollisionWorld();
      cw.setTerrainHeightFn(() => 0);
      const p = new PlayerController(audio);
      p.spawn(0, 0, 30, 0);
      const em = new EnemyManager(scene, rm, vfx, audio, proj);
      const worker = { isHealthy: () => false, requestPaths: async () => null } as unknown as WorkerBridge;
      em.spawnWave('infantry', count, { x: 0, y: 0, z: -20 }, 16, cw, 'mission:1');
      for (const u of em.getUnits()) {
        u.state = 'ENGAGING';
        u.initialGraceTimerSec = 0;
      }

      const t0 = performance.now();
      for (let i = 0; i < 60; i++) {
        em.update(1 / 60, p, cw, [], worker, 0.1);
      }
      const msPerTick = (performance.now() - t0) / 60;
      em.clear();
      rm.unloadScope('mission:1');
      rm.disposeAll();
      return msPerTick;
    };

    const e5 = runEnemyBench(5);
    const e15 = runEnemyBench(15);
    const e30 = runEnemyBench(30);

    console.log(
      `[TRN-06 BENCHMARK] weapon_update=${weaponMsPerTick.toFixed(4)}ms/tick, enemies_5=${e5.toFixed(4)}ms/tick, enemies_15=${e15.toFixed(4)}ms/tick, enemies_30=${e30.toFixed(4)}ms/tick`
    );

    expect(weaponMsPerTick).toBeLessThan(0.5);
    expect(e15).toBeLessThan(5.0);
    expect(e30).toBeLessThan(10.0);
  });
});
