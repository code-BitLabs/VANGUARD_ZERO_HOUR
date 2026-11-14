import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { BallisticSolver } from '@/src/gameplay/BallisticSolver';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { DiagnosticRulesEngine } from '@/src/gameplay/diagnostics/DiagnosticRulesEngine';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { DIFFICULTY_COMBAT_PROFILES, ENEMY_WEAPON_PROFILES } from '@/src/schemas/combat.schema';
import { AudioSettingsSchema } from '@/src/schemas/settings.schema';
import { settingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { WorkerBridge } from '@/src/workers/WorkerBridge';
import { createDestructibleCollider, DestructionSystem } from '@/src/world/DestructionSystem';

describe('Tactical Combat AI, Coordinator, Physical Cover Ballistics & Debug Telemetry (Tests A–J)', () => {
  let telemetry: CombatTelemetryRecorder;
  let coordinator: CombatEngagementCoordinator;
  let ballistics: BallisticSolver;
  let collision: CollisionWorld;
  let player: PlayerController;
  let audio: AudioManager;
  let resources: ResourceManager;

  beforeEach(() => {
    telemetry = new CombatTelemetryRecorder();
    coordinator = new CombatEngagementCoordinator(telemetry);
    ballistics = new BallisticSolver(null, telemetry);
    collision = new CollisionWorld();
    resources = new ResourceManager();
    audio = new AudioManager(resources, AudioSettingsSchema.parse({ muted: true }));
    player = new PlayerController(audio);
    player.spawn(0, 0, 0, 0);
  });

  it('Test A: enforces multi-squad simultaneous direct shooter caps across all difficulties', () => {
    const difficulties = ['easy', 'normal', 'hard', 'extreme'] as const;

    for (const diff of difficulties) {
      coordinator.reset();
      coordinator.setDifficulty(diff);
      const expectedCap = DIFFICULTY_COMBAT_PROFILES[diff].maxGlobalAttackers;

      let grantedCount = 0;
      for (let i = 0; i < 10; i++) {
        const squadId = i < 5 ? 'squad_alpha' : 'squad_bravo';
        const granted = coordinator.requestLease({
          unitId: `enemy_${i}`,
          squadId,
          domain: 'ground',
          role: 'rifleman',
          kind: 'DIRECT',
          distanceMeters: 15 + i,
          hasLos: true,
          isWeaponReady: true,
        });
        if (granted) grantedCount++;
      }

      expect(grantedCount).toBe(expectedCap);
      const snap = coordinator.getSnapshot();
      expect(snap.currentGlobalAttackers).toBe(expectedCap);
    }
  });

  it('Test B: enforces cross-domain Ground + Air + Vehicle attacker & heavy token caps', () => {
    coordinator.setDifficulty('normal'); // maxGlobalAttackers = 3, maxGlobalHeavyAttackers = 1

    // 1. Ground rifleman acquires token 1
    expect(
      coordinator.requestLease({
        unitId: 'ground_1',
        squadId: 'sq_1',
        domain: 'ground',
        role: 'rifleman',
        kind: 'DIRECT',
        distanceMeters: 18,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(true);

    // 2. Hostile vehicle turret acquires token 2
    expect(
      coordinator.requestLease({
        unitId: 'veh_1',
        squadId: 'vehicles_hostile',
        domain: 'vehicle',
        role: 'vehicle_turret',
        kind: 'DIRECT',
        distanceMeters: 24,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(true);

    // 3. Attack helicopter (heavy) acquires token 3 AND the single HEAVY token
    expect(
      coordinator.requestLease({
        unitId: 'heli_1',
        squadId: 'air_wing',
        domain: 'air',
        role: 'air_strike',
        kind: 'HEAVY',
        distanceMeters: 32,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(true);

    // 4. Second heavy unit or 4th attacker is denied because global cap (3) and heavy cap (1) are full
    expect(
      coordinator.requestLease({
        unitId: 'ground_heavy_2',
        squadId: 'sq_2',
        domain: 'ground',
        role: 'anti_armor',
        kind: 'HEAVY',
        distanceMeters: 20,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(false);

    expect(
      coordinator.requestLease({
        unitId: 'drone_2',
        squadId: 'air_wing',
        domain: 'air',
        role: 'air_strike',
        kind: 'DIRECT',
        distanceMeters: 22,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(false);
  });

  it('Test C: rotates expired leases to prevent starvation and throttles new leases on burst damage', () => {
    coordinator.setDifficulty('easy'); // maxGlobalAttackers = 2, burst threshold = 42 HP

    expect(
      coordinator.requestLease({
        unitId: 'e1',
        squadId: 'sq_1',
        domain: 'ground',
        role: 'rifleman',
        kind: 'DIRECT',
        distanceMeters: 15,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(true);

    expect(
      coordinator.requestLease({
        unitId: 'e2',
        squadId: 'sq_1',
        domain: 'ground',
        role: 'rifleman',
        kind: 'DIRECT',
        distanceMeters: 16,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(true);

    // Waiting enemy e3 is denied, which registers waiting demand
    expect(
      coordinator.requestLease({
        unitId: 'e3',
        squadId: 'sq_1',
        domain: 'ground',
        role: 'rifleman',
        kind: 'DIRECT',
        distanceMeters: 14,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(false);

    // Advance elapsed time past maxLeaseSec (3.5s) -> tick expires e1 & e2 leases and puts them on 0.85s cooldown
    telemetry.tickExposure(3.7, true);
    coordinator.tick(telemetry.getElapsedSec());
    expect(coordinator.getUnitLease('e1')).toBeNull();

    // Waiting enemy e3 can now acquire a direct lease
    expect(
      coordinator.requestLease({
        unitId: 'e3',
        squadId: 'sq_1',
        domain: 'ground',
        role: 'rifleman',
        kind: 'DIRECT',
        distanceMeters: 14,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(true);

    // Trigger burst damage above Easy threshold (42 HP in 2s)
    telemetry.recordPlayerDamage(1, 'e3', 'sq_1', 'ground', 'enemy_assault_rifle', 'upper_torso', 45);
    coordinator.tick(telemetry.getElapsedSec());
    expect(coordinator.getSnapshot().pressureThrottled).toBe(true);

    // New direct lease request during burst throttle window is denied while >=1 active shooter exists
    expect(
      coordinator.requestLease({
        unitId: 'e4',
        squadId: 'sq_2',
        domain: 'ground',
        role: 'rifleman',
        kind: 'DIRECT',
        distanceMeters: 12,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(false);
  });

  it('Test D: crouching behind a 1.45m solid cover barrier blocks 100% of LOS and enemy shots (including suppression)', () => {
    // Place 1.45m concrete barrier at z = -4 between player (0,0,0) and enemy (0,0,-15)
    collision.addStaticBox({
      id: 'cover_test_barrier',
      minX: -2.2,
      minY: 0,
      minZ: -4.85,
      maxX: 2.2,
      maxY: 1.45,
      maxZ: -3.15,
      layer: COLLISION_LAYER.COVER,
    });

    player.isCrouching = true; // crouched height = 1.15m < 1.45m barrier
    const eyeOrigin = new THREE.Vector3(0, 1.55, -15);

    const los = ballistics.checkLineOfSight(eyeOrigin.x, eyeOrigin.y, eyeOrigin.z, player, collision, 60);
    expect(los.visible).toBe(false);
    expect(los.blockerId).toBe('cover_test_barrier');

    // Fire 20 aimed and suppression bursts at the crouched player's LKP behind cover
    const initialHealth = player.health;
    const initialArmor = player.armor;
    const aimPoint = new THREE.Vector3(0, 1.0, 0);

    for (let i = 0; i < 20; i++) {
      const res = ballistics.fireWeaponRay(
        {
          unitId: 'suppressor_1',
          squadId: 'sq_1',
          domain: 'ground',
          weaponClass: 'enemy_lmg',
          muzzleOrigin: eyeOrigin,
          aimTarget: aimPoint,
          distanceMeters: 15,
          unitAccuracy: 0.9,
          isMoving: false,
          aimDurationSec: 1.2,
          burstShotIndex: i % 4,
          isSuppressedOrStaggered: false,
          isSuppressionFire: i % 2 === 0,
          difficultyProfile: DIFFICULTY_COMBAT_PROFILES.normal,
        },
        player,
        collision
      );
      expect(res.hitPlayer).toBe(false);
      expect(res.damageApplied).toBe(0);
    }

    expect(player.health).toBe(initialHealth);
    expect(player.armor).toBe(initialArmor);

    const snap = telemetry.buildSnapshot(coordinator.getSnapshot(), [], 0);
    expect(snap.metrics.totalShotsHit).toBe(0);
    expect(snap.metrics.totalShotsBlockedByCover).toBeGreaterThanOrEqual(18);
    expect(snap.metrics.coverBlockedPercentage).toBeGreaterThanOrEqual(90);
  });

  it('Test E: destructible cover transitions INTACT -> DAMAGED -> DESTROYED and updates SpatialHash colliders', () => {
    const scene = new THREE.Scene();
    const vfx = new VFXPool(scene, resources);
    const destruction = new DestructionSystem(collision.spatialHash, vfx, audio);

    const meshGroup = new THREE.Group();
    const collider = createDestructibleCollider('dest_cover_1', 0, 0, -5, 2.0, 1.45, 0.85);
    destruction.register({
      id: 'dest_cover_1',
      kind: 'destructible_barrier',
      isObjectiveTarget: false,
      position: new THREE.Vector3(0, 0, -5),
      health: 100,
      maxHealth: 100,
      state: 'INTACT',
      blastRadius: 3,
      blastDamage: 20,
      meshGroup,
      collider,
    });

    const eyeOrigin = new THREE.Vector3(0, 1.35, -14);
    player.isCrouching = true; // 1.15m tall

    // 1. INTACT (1.45m tall): Crouched player is completely hidden
    expect(
      ballistics.checkLineOfSight(eyeOrigin.x, eyeOrigin.y, eyeOrigin.z, player, collision, 60).visible
    ).toBe(false);

    // 2. Apply 60 damage -> DAMAGED (50% threshold): collider height drops to 65% (~0.94m)
    destruction.applyDamage('dest_cover_1', 60, () => {});
    const damagedLos = ballistics.checkLineOfSight(
      eyeOrigin.x,
      eyeOrigin.y,
      eyeOrigin.z,
      player,
      collision,
      60
    );
    expect(damagedLos.visible).toBe(true); // Crouched head (0.98m) now peeks above 0.94m damaged barrier

    // 3. Apply another 50 damage -> DESTROYED: collider is removed from SpatialHash completely
    destruction.applyDamage('dest_cover_1', 50, () => {});
    const rayOut = {
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
    const hitCheck = collision.sweptSegmentTest(
      0,
      0.5,
      -14,
      0,
      0,
      1,
      20,
      COLLISION_LAYER.DESTRUCTIBLE,
      rayOut
    );
    expect(hitCheck).toBe(false);
  });

  it('Test F: stance-aware partial exposure (standing vs crouching behind low cover and corner peeking)', () => {
    // Low wall of height 1.28m at z = -4
    collision.addStaticBox({
      id: 'low_wall',
      minX: -2.0,
      minY: 0,
      minZ: -4.5,
      maxX: 2.0,
      maxY: 1.28,
      maxZ: -3.5,
      layer: COLLISION_LAYER.COVER,
    });

    const eyeOrigin = new THREE.Vector3(0, 1.55, -14);

    // Standing (1.80m): head (1.62m) is exposed above 1.28m wall
    player.isCrouching = false;
    const standingLos = ballistics.checkLineOfSight(
      eyeOrigin.x,
      eyeOrigin.y,
      eyeOrigin.z,
      player,
      collision,
      60
    );
    expect(standingLos.visible).toBe(true);
    expect(standingLos.exposedZone === 'head' || standingLos.exposedZone === 'upper_torso').toBe(true);

    // Crouching (1.15m): all 5 sample points (max 0.98m) are below 1.28m wall
    player.isCrouching = true;
    const crouchingLos = ballistics.checkLineOfSight(
      eyeOrigin.x,
      eyeOrigin.y,
      eyeOrigin.z,
      player,
      collision,
      60
    );
    expect(crouchingLos.visible).toBe(false);

    // Corner peeking: move standing player to x = 2.05 (right edge of wall at x = 2.0)
    player.isCrouching = false;
    player.position.set(2.05, 0, 0);
    const peekLos = ballistics.checkLineOfSight(
      eyeOrigin.x,
      eyeOrigin.y,
      eyeOrigin.z,
      player,
      collision,
      60
    );
    expect(peekLos.visible).toBe(true);
    expect(peekLos.exposedZone === 'upper_torso' || peekLos.exposedZone === 'head').toBe(true);
  });

  it('Test G: immediately releases tokens on reload, LOS loss, or enemy death', () => {
    coordinator.setDifficulty('easy'); // max 2 attackers
    coordinator.requestLease({
      unitId: 'u1',
      squadId: 'sq_1',
      domain: 'ground',
      role: 'rifleman',
      kind: 'DIRECT',
      distanceMeters: 15,
      hasLos: true,
      isWeaponReady: true,
    });
    coordinator.requestLease({
      unitId: 'u2',
      squadId: 'sq_1',
      domain: 'ground',
      role: 'rifleman',
      kind: 'DIRECT',
      distanceMeters: 16,
      hasLos: true,
      isWeaponReady: true,
    });

    expect(coordinator.getSnapshot().currentGlobalAttackers).toBe(2);

    // u1 reloads -> releases token
    coordinator.releaseLease('u1', 'reload');
    expect(coordinator.getUnitLease('u1')).toBeNull();
    expect(coordinator.getSnapshot().currentGlobalAttackers).toBe(1);

    // u3 can immediately acquire the freed slot
    expect(
      coordinator.requestLease({
        unitId: 'u3',
        squadId: 'sq_1',
        domain: 'ground',
        role: 'rifleman',
        kind: 'DIRECT',
        distanceMeters: 18,
        hasLos: true,
        isWeaponReady: true,
      })
    ).toBe(true);

    // u2 dies -> releases token
    coordinator.notifyUnitDisabled('u2', 'sq_1', 'ground', 'death');
    expect(coordinator.getUnitLease('u2')).toBeNull();
    expect(coordinator.getSnapshot().currentGlobalAttackers).toBe(1);
  });

  it('Test H: enforces single-damage shotId deduplication per ray and independent multi-pellet shotgun rays', () => {
    const startHp = player.health + player.armor;

    // Applying the same shotId twice only damages the player once
    const first = player.applyValidatedShotDamage(9001, 20, 0, -10);
    const second = player.applyValidatedShotDamage(9001, 20, 0, -10);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(player.health + player.armor).toBeCloseTo(startHp - first, 4);

    // Firing a shotgun burst (6 pellets) generates 6 independent shot traces in telemetry
    const eyeOrigin = new THREE.Vector3(0, 1.3, -6);
    const aimPoint = new THREE.Vector3(0, 1.2, 0);
    const beforeShots = telemetry.buildSnapshot(coordinator.getSnapshot(), [], 0).metrics.totalShotsFired;

    ballistics.fireWeaponRay(
      {
        unitId: 'shotgunner_1',
        squadId: 'sq_1',
        domain: 'ground',
        weaponClass: 'enemy_shotgun',
        muzzleOrigin: eyeOrigin,
        aimTarget: aimPoint,
        distanceMeters: 6,
        unitAccuracy: 0.75,
        isMoving: false,
        aimDurationSec: 0.8,
        burstShotIndex: 0,
        isSuppressedOrStaggered: false,
        isSuppressionFire: false,
        difficultyProfile: DIFFICULTY_COMBAT_PROFILES.normal,
      },
      player,
      collision
    );

    const afterShots = telemetry.buildSnapshot(coordinator.getSnapshot(), [], 0).metrics.totalShotsFired;
    expect(afterShots - beforeShots).toBe(ENEMY_WEAPON_PROFILES.enemy_shotgun.pelletCount);
  });

  it('Test I: maintains bounded ring-buffer memory invariance over 2,500+ combat events and shots', () => {
    for (let i = 0; i < 2500; i++) {
      telemetry.recordEvent('TOKEN_ACQUIRED', `unit_${i % 12}`, 'sq_1', 'ground', `Event ${i}`);
      telemetry.recordShot({
        shotId: i + 1,
        unitId: `unit_${i % 12}`,
        squadId: 'sq_1',
        domain: 'ground',
        weaponClass: 'enemy_assault_rifle',
        isSuppression: false,
        originX: 0,
        originY: 1.5,
        originZ: -10,
        endX: 0,
        endY: 1.2,
        endZ: 0,
        spreadRad: 0.02,
        outcome: i % 2 === 0 ? 'blocked_cover' : 'hit_player',
        blockerColliderId: i % 2 === 0 ? 'cover_1' : null,
        hitZone: i % 2 === 0 ? null : 'upper_torso',
        damageDealt: i % 2 === 0 ? 0 : 8,
      });
      telemetry.recordPlayerDamage(
        i + 1,
        `unit_${i % 12}`,
        'sq_1',
        'ground',
        'enemy_assault_rifle',
        'upper_torso',
        8
      );
    }

    const counts = telemetry.getBufferCounts();
    expect(counts.events).toBeLessThanOrEqual(CombatTelemetryRecorder.MAX_EVENTS);
    expect(counts.shots).toBeLessThanOrEqual(CombatTelemetryRecorder.MAX_SHOTS);
    expect(counts.damages).toBeLessThanOrEqual(CombatTelemetryRecorder.MAX_DAMAGE_RECORDS);
  });

  it('Test J: synchronizes [F4] uiStore.combatDebugOpen and settingsStore.developer.combatDebugOverlay 1:1', () => {
    uiStore.getState().setCombatDebugOpen(false);
    expect(uiStore.getState().combatDebugOpen).toBe(false);
    expect(settingsStore.getState().developer.combatDebugOverlay).toBe(false);

    // Toggle via [F4] handler action
    uiStore.getState().toggleCombatDebug();
    expect(uiStore.getState().combatDebugOpen).toBe(true);
    expect(settingsStore.getState().developer.combatDebugOverlay).toBe(true);

    // Toggle via Settings -> Developer Tools store action
    settingsStore.getState().updateDeveloper({ combatDebugOverlay: false });
    expect(settingsStore.getState().developer.combatDebugOverlay).toBe(false);
    expect(uiStore.getState().combatDebugOpen).toBe(false);
  });

  it('Test K: immediately blocks firing when a moving vehicle obstructs LOS, preserves LKP during grace, and logs LOS recovery', () => {
    const localScene = new THREE.Scene();
    const localRes = new ResourceManager();
    const localVfx = new VFXPool(localScene, localRes);
    const localProj = new ProjectileManager(localScene, localRes, localVfx, audio, telemetry);
    const localEn = new EnemyManager(localScene, localRes, localVfx, audio, localProj, coordinator, ballistics, telemetry);
    const stubWorker = { isHealthy: () => false, requestPaths: async () => null } as unknown as WorkerBridge;
    const rules = new DiagnosticRulesEngine();

    coordinator.setDifficulty('normal');
    player.spawn(0, 0, 0, 0);
    localEn.spawnWave('infantry', 1, { x: 0, y: 0, z: -18 }, 0.5, collision, 'mission:test');
    const unit = localEn.getUnits()[0];
    // Face player directly
    unit.position.set(0, 0, -18);
    unit.yaw = 0;

    // Step until enemy acquires player, clears reaction delay, and enters ENGAGING
    for (let i = 0; i < 45; i++) {
      telemetry.tickExposure(0.05, true);
      localEn.update(0.05, player, collision, [], stubWorker, 0.1);
      if (unit.state === 'ENGAGING') break;
    }
    expect(unit.state).toBe('ENGAGING');
    expect(unit.hasLos).toBe(true);

    // Insert a moving vehicle collider directly between enemy (0,0,-18) and player (0,0,0)
    const movingVehCollider = {
      id: 'collider_veh_5',
      minX: -2.0,
      minY: 0,
      minZ: -10,
      maxX: 2.0,
      maxY: 2.4,
      maxZ: -7,
      layer: COLLISION_LAYER.VEHICLE,
    };
    collision.spatialHash.insert(movingVehCollider);

    const hpBeforeBlock = player.health + player.armor;
    unit.fireTimer = 0;
    // Step 0.25s (< 0.45s grace period)
    for (let i = 0; i < 5; i++) {
      telemetry.tickExposure(0.05, false);
      localEn.update(0.05, player, collision, [], stubWorker, 0.1);
    }

    // Firing must be immediately blocked during LOS obstruction even while still in grace
    expect(unit.hasLos).toBe(false);
    expect(unit.losBlockerId).toBe('collider_veh_5');
    expect(player.health + player.armor).toBe(hpBeforeBlock);

    const rowsDuringGrace = localEn.getDebugInspectorRows(player);
    expect(rowsDuringGrace[0].allowedToFire).toBe(false);
    expect(rowsDuringGrace[0].blockedShotAttempts).toBeGreaterThanOrEqual(1);
    expect(rowsDuringGrace[0].obstructionDurationSec).toBeGreaterThan(0);

    const graceSnap = telemetry.buildSnapshot(coordinator.getSnapshot(), rowsDuringGrace, 0);
    const graceWarnings = rules.evaluate(graceSnap);
    expect(graceWarnings.some((w: { ruleId: string }) => w.ruleId === 'AI_OMNISCIENT_DETECTION')).toBe(false);

    // Step another 1.15s (total 1.4s > 1.2s losGraceSec) -> enemy cleanly transitions to SEARCHING/SUPPRESSING without invalid jump
    for (let i = 0; i < 23; i++) {
      telemetry.tickExposure(0.05, false);
      localEn.update(0.05, player, collision, [], stubWorker, 0.1);
    }
    expect(['SEARCHING', 'SUPPRESSING']).toContain(unit.state);
    expect(unit.lastKnownPosition).not.toBeNull();
    expect(localEn.getDebugInspectorRows(player)[0].invalidTransitionCount ?? 0).toBe(0);

    // Vehicle moves away -> LOS recovers and recovery duration is recorded
    collision.spatialHash.remove(movingVehCollider);
    telemetry.tickExposure(0.05, true);
    localEn.update(0.05, player, collision, [], stubWorker, 0.1);
    const recoveredRows = localEn.getDebugInspectorRows(player);
    expect(recoveredRows[0].hasLos).toBe(true);
    expect(recoveredRows[0].lastLosRecoverySec).toBeGreaterThan(0);
  });

  it('Test L: tracks multi-step FSM transitions in real time without snapshot-aliasing false positives', () => {
    telemetry.recordStateTransition('enemy_34', 'sq_1', 'ground', 'UNAWARE', 'ALERTED');
    telemetry.recordStateTransition('enemy_34', 'sq_1', 'ground', 'ALERTED', 'ENGAGING');
    telemetry.recordStateTransition('enemy_34', 'sq_1', 'ground', 'ENGAGING', 'REPOSITIONING');
    telemetry.recordStateTransition('enemy_34', 'sq_1', 'ground', 'REPOSITIONING', 'ALERTED');
    telemetry.recordStateTransition('enemy_34', 'sq_1', 'ground', 'ALERTED', 'RETREATING');
    telemetry.recordStateTransition('enemy_34', 'sq_1', 'ground', 'RETREATING', 'DEAD');

    const row = {
      id: 'enemy_34',
      displayName: 'Elite',
      squadId: 'sq_1',
      domain: 'ground' as const,
      role: 'rifleman',
      state: 'DEAD' as const,
      detectedPlayer: true,
      hasLos: false,
      losBlockerId: null,
      distanceMeters: 20,
      x: 0,
      y: 0,
      z: -20,
      yaw: 0,
      fovDeg: 110,
      detectionRange: 65,
      hearingRange: 30,
      lkpX: null,
      lkpY: null,
      lkpZ: null,
      lkpAgeSec: 0,
      reactionTimerSec: 0,
      fireCooldownSec: 0,
      ammoInMag: 20,
      magSize: 30,
      isReloading: false,
      currentSpreadDeg: 2,
      accuracyPct: 50,
      tokenStatus: 'NONE' as const,
      allowedToFire: false,
      blockedByCover: false,
      shotsFired: 0,
      shotsHit: 0,
      totalDamageDealt: 0,
      lastDamageAmount: 0,
      lastDamageTimeSec: null,
    };

    const snap = telemetry.buildSnapshot(coordinator.getSnapshot(), [row], 0);
    expect(snap.enemies[0].stateTransitionCount).toBe(6);
    expect(snap.enemies[0].invalidTransitionCount).toBe(0);
    expect(snap.enemies[0].lastTransition).toBe('RETREATING->DEAD');

    // Genuine invalid jump (UNAWARE -> ENGAGING bypassing ALERTED) IS still caught
    telemetry.recordStateTransition('enemy_buggy', 'sq_1', 'ground', 'UNAWARE', 'ENGAGING');
    const buggyRow = { ...row, id: 'enemy_buggy', state: 'ENGAGING' as const };
    const snap2 = telemetry.buildSnapshot(coordinator.getSnapshot(), [buggyRow], 0);
    expect(snap2.enemies[0].invalidTransitionCount).toBe(1);
    expect(snap2.enemies[0].lastTransition).toBe('UNAWARE->ENGAGING');
  });

  it('Test M: covers full enemy height with 3 prioritized hitbox zones (head, upper_torso, lower_body/legs) and tracks zone hits', async () => {
    const { WeaponSystem } = await import('@/src/gameplay/WeaponSystem');
    const localScene = new THREE.Scene();
    const vmScene = new THREE.Scene();
    const localRes = new ResourceManager();
    const localVfx = new VFXPool(localScene, localRes);
    const localProj = new ProjectileManager(localScene, localRes, localVfx, audio, telemetry);
    const localEn = new EnemyManager(localScene, localRes, localVfx, audio, localProj, coordinator, ballistics, telemetry);
    const weapons = new WeaponSystem(vmScene, audio, localVfx, localProj);

    weapons.resetLoadout('sniper_rifle'); // 0 ADS spread so rays are deterministic
    weapons.isAds = true;

    localEn.spawnWave('heavy_armor', 1, { x: 0, y: 0, z: -12 }, 0.01, collision, 'mission:test');
    const unit = localEn.getUnits()[0];
    unit.position.set(0, 0, -12);

    const targets = localEn.getHitscanTargets(() => {});
    expect(targets).toHaveLength(1);
    expect(targets[0].lowerBodyBoxMin).toBeDefined();
    expect(targets[0].torsoBoxMin).toBeDefined();

    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 300);

    // 1. Aim at legs (y = 0.38m at z = -12) -> hits lower_body
    cam.position.set(0, 0.38, 0);
    cam.lookAt(0, 0.38, -12);
    cam.updateMatrixWorld(true);
    const hp0 = unit.health;
    (
      weapons as unknown as {
        fireShot: (
          s: ReturnType<typeof weapons.getActiveState>,
          p: PlayerController,
          c: THREE.PerspectiveCamera,
          w: CollisionWorld,
          t: typeof targets,
          cb: () => void
        ) => void;
      }
    ).fireShot(weapons.getActiveState(), player, cam, collision, targets, () => {});
    expect(unit.health).toBeLessThan(hp0);
    expect(weapons.enemyZoneHits.lower_body).toBe(1);

    // 2. Aim at chest (y = 1.10m at z = -12) -> hits upper_torso
    const hp1 = unit.health;
    cam.position.set(0, 1.1, 0);
    cam.lookAt(0, 1.1, -12);
    cam.updateMatrixWorld(true);
    (
      weapons as unknown as {
        fireShot: (
          s: ReturnType<typeof weapons.getActiveState>,
          p: PlayerController,
          c: THREE.PerspectiveCamera,
          w: CollisionWorld,
          t: typeof targets,
          cb: () => void
        ) => void;
      }
    ).fireShot(
      weapons.getActiveState(),
      player,
      cam,
      collision,
      localEn.getHitscanTargets(() => {}),
      () => {}
    );
    expect(unit.health).toBeLessThan(hp1);
    expect(weapons.enemyZoneHits.upper_torso).toBe(1);

    weapons.dispose();
    localRes.disposeAll();
  });
});
