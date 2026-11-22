import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG } from '@/src/data/missions';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { clampCheckpointVitals } from '@/src/gameplay/MissionCheckpoint';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { DIFFICULTY_COMBAT_PROFILES } from '@/src/schemas/combat.schema';
import { AudioSettingsSchema, InputSettingsSchema } from '@/src/schemas/settings.schema';
import { WorkerBridge } from '@/src/workers/WorkerBridge';

describe('Stage 4A — TRN-12 Survivability, Recovery, TRN-10 Threat Arcs & Debrief, TRN-11 Mobile Aim Assist', () => {
  it('defines exact Stage 4A difficulty survivability profiles (Easy, Normal, Hard, Extreme)', () => {
    const easy = DIFFICULTY_COMBAT_PROFILES.easy;
    const normal = DIFFICULTY_COMBAT_PROFILES.normal;
    const hard = DIFFICULTY_COMBAT_PROFILES.hard;
    const extreme = DIFFICULTY_COMBAT_PROFILES.extreme;

    expect(easy.playerMaxHealth).toBe(150);
    expect(easy.playerMaxArmor).toBe(150);
    expect(easy.armorAbsorption).toBeCloseTo(0.85, 3);
    expect(easy.hpRegenDelaySec).toBeCloseTo(3.2, 2);
    expect(easy.hpRegenRatePerSec).toBeCloseTo(14, 2);
    expect(easy.hpRegenCap).toBe(100);
    expect(easy.playerSpawnGraceSec).toBeCloseTo(6.0, 2);
    expect(easy.sniperRocketWarningSec).toBeCloseTo(1.4, 2);
    expect(easy.enemyHitboxScale).toBeCloseTo(1.12, 2);

    expect(normal.playerMaxHealth).toBe(125);
    expect(normal.playerMaxArmor).toBe(125);
    expect(normal.armorAbsorption).toBeCloseTo(0.78, 3);
    expect(normal.hpRegenDelaySec).toBeCloseTo(4.0, 2);
    expect(normal.hpRegenRatePerSec).toBeCloseTo(11, 2);
    expect(normal.hpRegenCap).toBe(85);
    expect(normal.playerSpawnGraceSec).toBeCloseTo(4.5, 2);
    expect(normal.sniperRocketWarningSec).toBeCloseTo(1.0, 2);
    expect(normal.enemyHitboxScale).toBeCloseTo(1.08, 2);

    expect(hard.playerMaxHealth).toBe(100);
    expect(hard.playerMaxArmor).toBe(100);
    expect(hard.armorAbsorption).toBeCloseTo(0.68, 3);
    expect(hard.hpRegenDelaySec).toBeCloseTo(5.0, 2);
    expect(hard.hpRegenRatePerSec).toBeCloseTo(8, 2);
    expect(hard.hpRegenCap).toBe(65);
    expect(hard.playerSpawnGraceSec).toBeCloseTo(2.5, 2);
    expect(hard.sniperRocketWarningSec).toBeCloseTo(0.65, 2);
    expect(hard.enemyHitboxScale).toBeCloseTo(1.0, 2);

    expect(extreme.playerMaxHealth).toBe(100);
    expect(extreme.playerMaxArmor).toBe(75);
    expect(extreme.armorAbsorption).toBeCloseTo(0.55, 3);
    expect(extreme.hpRegenDelaySec).toBeCloseTo(6.5, 2);
    expect(extreme.hpRegenRatePerSec).toBeCloseTo(6, 2);
    expect(extreme.hpRegenCap).toBe(50);
    expect(extreme.playerSpawnGraceSec).toBeCloseTo(1.5, 2);
    expect(extreme.sniperRocketWarningSec).toBeCloseTo(0.4, 2);
    expect(extreme.enemyHitboxScale).toBeCloseTo(1.0, 2);
  });

  it('enforces player spawn grace window and blocks incoming enemy damage until grace expires', () => {
    const res = new ResourceManager();
    const audio = new AudioManager(res, AudioSettingsSchema.parse({ muted: true }));
    const player = new PlayerController(audio);
    player.setDifficultyProfile(DIFFICULTY_COMBAT_PROFILES.normal);
    player.spawn(0, 1.65, 0, 0);

    expect(player.health).toBe(125);
    expect(player.armor).toBe(125);
    expect(player.isSpawnProtected()).toBe(true);
    expect(player.getSpawnProtectionRemainingSec()).toBeCloseTo(4.5, 2);

    // Damage during spawn protection is ignored
    const blocked = player.applyValidatedShotDamage(101, 40, 0, -10);
    expect(blocked).toBe(0);
    expect(player.health).toBe(125);
    expect(player.armor).toBe(125);

    // Advance player update past 4.5s spawn protection
    const input = new InputManager(res, InputSettingsSchema.parse({}));
    const collision = new CollisionWorld();
    for (let i = 0; i < 48; i++) {
      player.update(0.1, input, collision, false, 1.0, 0, false);
    }
    expect(player.isSpawnProtected()).toBe(false);

    // Damage after grace expires uses Normal 78% armor absorption
    player.applyDamage(50, 0, -10);
    const breakdown = player.getLastDamageBreakdown();
    expect(breakdown.armorAbsorbed).toBeCloseTo(50 * 0.78, 1);
    expect(breakdown.healthLost).toBeCloseTo(50 * 0.22, 1);
  });

  it('regenerates HP up to difficulty cap after delay without regenerating armor', () => {
    const res = new ResourceManager();
    const audio = new AudioManager(res, AudioSettingsSchema.parse({ muted: true }));
    const player = new PlayerController(audio);
    player.setDifficultyProfile(DIFFICULTY_COMBAT_PROFILES.normal);
    player.spawn(0, 1.65, 0, 0);

    const input = new InputManager(res, InputSettingsSchema.parse({}));
    const collision = new CollisionWorld();

    // Expire spawn protection first
    for (let i = 0; i < 46; i++) {
      player.update(0.1, input, collision, false, 1.0, 0, false);
    }

    // Apply damage and set player to 40 HP / 50 Armor
    player.applyDamage(20, 0, -10);
    player.health = 40;
    player.armor = 50;

    // Step 3.0s (< 4.0s Normal regen delay): no regeneration yet
    for (let i = 0; i < 30; i++) {
      player.update(0.1, input, collision, false, 1.0, 0, false);
    }
    expect(player.isRegenerating).toBe(false);
    expect(player.health).toBeCloseTo(40, 2);

    // Step another 6.0s (total 9.0s > 4.0s delay): regenerates at 11 HP/s up to Normal cap (85 HP)
    for (let i = 0; i < 60; i++) {
      player.update(0.1, input, collision, false, 1.0, 0, false);
    }
    expect(player.health).toBeCloseTo(85, 1);
    expect(player.armor).toBe(50);
  });

  it('computes accurate player-relative directional threat arc angles (0=front, +PI/2=right, -PI/2=left, PI=behind)', () => {
    const res = new ResourceManager();
    const audio = new AudioManager(res, AudioSettingsSchema.parse({ muted: true }));
    const player = new PlayerController(audio);
    player.spawn(0, 1.65, 0, 0); // Yaw = 0 faces -Z, right is +X

    const frontAngle = player.computeRelativeThreatAngle(0, -20);
    const rightAngle = player.computeRelativeThreatAngle(20, 0);
    const leftAngle = player.computeRelativeThreatAngle(-20, 0);
    const backAngle = player.computeRelativeThreatAngle(0, 20);

    expect(frontAngle).toBeCloseTo(0, 2);
    expect(rightAngle).toBeCloseTo(Math.PI / 2, 2);
    expect(leftAngle).toBeCloseTo(-Math.PI / 2, 2);
    expect(Math.abs(backAngle)).toBeCloseTo(Math.PI, 2);
  });

  it('resolves contiguous 3-zone enemy hitboxes (legs 0..0.75, torso 0.75..1.45, head ~1.65) with zero dead zones', () => {
    const scene = new THREE.Scene();
    const res = new ResourceManager();
    const vfx = new VFXPool(scene, res);
    const audio = new AudioManager(res, AudioSettingsSchema.parse({ muted: true }));
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(null, telemetry);
    const proj = new ProjectileManager(scene, res, vfx, audio, telemetry);
    const collision = new CollisionWorld();
    const enemyManager = new EnemyManager(scene, res, vfx, audio, proj, coordinator, ballistics, telemetry);

    enemyManager.setDifficulty('normal');
    enemyManager.spawnWave('infantry', 1, { x: 0, y: 0, z: -15 }, 0.1, collision, 'mission:test');
    const unit = enemyManager.getUnits()[0];
    unit.position.set(0, 0, -15);
    const stubWorker = { isHealthy: () => false, requestPaths: async () => null } as unknown as WorkerBridge;
    const player = new PlayerController(audio);
    player.spawn(0, 1.65, 0, 0);
    enemyManager.update(0.016, player, collision, [], stubWorker, 0.1);

    const targets: import('@/src/gameplay/WeaponSystem').HitscanTarget[] = [];
    enemyManager.fillHitscanTargets(targets, () => {});
    expect(targets.length).toBe(1);
    const target = targets[0];

    // Verify contiguous vertical coverage (scaled by 1.1x rig scale: 0..0.825m and 0.825..1.595m) with zero dead zone gap
    expect(target.lowerBodyBoxMin?.y).toBeCloseTo(0, 2);
    expect(target.lowerBodyBoxMax?.y).toBeCloseTo(0.75 * 1.1, 2);
    expect(target.torsoBoxMin?.y).toBeCloseTo(target.lowerBodyBoxMax?.y ?? 0, 4);
    expect(target.torsoBoxMax?.y).toBeCloseTo(1.45 * 1.1, 2);
    expect(target.headPosition?.y).toBeCloseTo(1.65 * 1.1, 2);

    // WeaponSystem hitscan at seam y=0.75m hits without falling through a dead zone
    const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 200);
    const weapons = new WeaponSystem(scene, audio, vfx, proj);
    weapons.resetLoadout('sniper_rifle');

    cam.position.set(0, 0.75, 0);
    cam.lookAt(0, 0.75, -15);
    cam.updateMatrixWorld();

    const input = new InputManager(res, InputSettingsSchema.parse({}));
    input.setVirtualActionState('ads', true);
    input.triggerVirtualActionPress('fire');

    let hitRegistered = false;
    const hitTargets: import('@/src/gameplay/WeaponSystem').HitscanTarget[] = [];
    enemyManager.fillHitscanTargets(hitTargets, () => {
      hitRegistered = true;
    });
    weapons.update(0.016, input, player, cam, collision, hitTargets, [], () => {}, false);
    expect(hitRegistered).toBe(true);
  });

  it('telegraphs sniper and rocket windup before firing and exposes HUD incoming threat warning', () => {
    const scene = new THREE.Scene();
    const res = new ResourceManager();
    const vfx = new VFXPool(scene, res);
    const audio = new AudioManager(res, AudioSettingsSchema.parse({ muted: true }));
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    const ballistics = new BallisticSolver(null, telemetry);
    const proj = new ProjectileManager(scene, res, vfx, audio, telemetry);
    const collision = new CollisionWorld();
    const enemyManager = new EnemyManager(scene, res, vfx, audio, proj, coordinator, ballistics, telemetry);
    const player = new PlayerController(audio);
    const stubWorker = { isHealthy: () => false, requestPaths: async () => null } as unknown as WorkerBridge;

    coordinator.setDifficulty('normal');
    enemyManager.setDifficulty('normal');
    player.setDifficultyProfile(DIFFICULTY_COMBAT_PROFILES.normal);
    player.spawn(0, 1.65, 0, 0);

    enemyManager.spawnWave('sniper', 1, { x: 0, y: 0, z: -25 }, 0.1, collision, 'mission:test');
    const sniper = enemyManager.getUnits()[0];
    sniper.position.set(0, 0, -25);
    sniper.yaw = 0;
    sniper.initialGraceTimerSec = 0;
    sniper.reactionTimerSec = 0;
    sniper.fireTimer = 0;
    sniper.state = 'ENGAGING';
    sniper.hasLos = true;

    telemetry.tickExposure(0.05, true);
    enemyManager.update(0.05, player, collision, [], stubWorker, 0.1);

    expect(sniper.telegraphKind).toBe('sniper');
    expect(sniper.telegraphTimerSec).toBeGreaterThan(0.5);
    const warning = enemyManager.getActiveThreatWarning(player);
    expect(warning).not.toBeNull();
    expect(warning?.kind).toBe('sniper');
  });

  it('records fatal damage attribution, last-5 damage breakdown, and survival buckets in CombatTelemetryRecorder', () => {
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    telemetry.tickExposure(12.4, true, true);

    telemetry.recordPlayerDamage(
      1,
      'enemy_1',
      'sq_1',
      'ground',
      'enemy_sniper',
      'head',
      55,
      0,
      55,
      {
        rawDamage: 55,
        attackerArchetype: 'sniper',
        attackerName: 'Marksman Unit',
        weaponLabel: 'Enemy Sniper Rifle',
        distanceMeters: 42.5,
        inVehicle: false,
        incomingAngleRad: 0.1,
      }
    );
    telemetry.recordPlayerDeath();

    const snap = telemetry.buildSnapshot(coordinator.getSnapshot(), [], 0);
    expect(snap.metrics.playerDeathCount).toBe(1);
    expect(snap.metrics.survivalBucket).toBe('0-15s');
    expect(snap.metrics.lastFiveDamageEvents?.length).toBe(1);

    const fatal = telemetry.getFatalDamageAttribution();
    expect(fatal).not.toBeNull();
    expect(fatal?.attackerName).toBe('Marksman Unit');
    expect(fatal?.weaponLabel).toBe('Enemy Sniper Rifle');
    expect(fatal?.distanceMeters).toBeCloseTo(42.5, 1);
  });

  it('calculates deterministic S/A/B/C mission debrief rank and scales checkpoint vitals with difficulty', () => {
    const director = new MissionDirector(MISSION_CATALOG[0], 'normal');
    director.kills = 18;
    director.headshots = 9;
    director.score = 3600;
    director.elapsedSec = 120;

    const sSummary = director.buildSummary(true, {
      shotsFired: 50,
      shotsHit: 32,
      deathsCount: 0,
      damageReceived: 80,
      survivalTimeSec: 120,
    });
    expect(sSummary.grade).toBe('S');
    expect(sSummary.accuracyPct).toBe(64);
    expect(sSummary.headshotPct).toBe(50);

    // High death count downgrades rank deterministically
    director.score = 1400;
    director.kills = 10;
    director.headshots = 1;
    director.elapsedSec = 420;
    const lowSummary = director.buildSummary(true, {
      shotsFired: 100,
      shotsHit: 18,
      deathsCount: 3,
      damageReceived: 390,
      survivalTimeSec: 420,
    });
    expect(['B', 'C']).toContain(lowSummary.grade);

    // Difficulty-scaled checkpoint clamping (75 HP / 50 Armor floor, up to 150/150 Easy ceiling)
    const easyFloor = clampCheckpointVitals(10, 0, 150, 150);
    expect(easyFloor.health).toBe(75);
    expect(easyFloor.armor).toBe(50);
    const easyHigh = clampCheckpointVitals(140, 135, 150, 150);
    expect(easyHigh.health).toBe(140);
    expect(easyHigh.armor).toBe(135);
  });

  it('applies TRN-11 rotational friction aim assistance only to touch look deltas and never to mouse look', () => {
    const res = new ResourceManager();
    const input = new InputManager(
      res,
      InputSettingsSchema.parse({
        mobileAimAssist: true,
        mobileAimAssistStrength: 0.5,
        touchLookSmoothing: 0,
      })
    );

    input.addVirtualLookDelta(100, 50);
    const unassisted = input.consumeLookDelta(false, 1.0);

    input.addVirtualLookDelta(100, 50);
    const assisted = input.consumeLookDelta(false, 0.6);

    expect(assisted.yawDelta).toBeCloseTo(unassisted.yawDelta * 0.6, 4);
    expect(assisted.pitchDelta).toBeCloseTo(unassisted.pitchDelta * 0.6, 4);
  });
});
