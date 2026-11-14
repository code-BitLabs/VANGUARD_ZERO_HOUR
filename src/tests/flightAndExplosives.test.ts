import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import {
  buildCsvExport,
  buildJsonDiagnosticReport,
  buildMarkdownDiagnosticReport,
  compareDiagnosticSnapshots,
} from '@/src/gameplay/diagnostics/DiagnosticExporter';
import { DiagnosticRulesEngine } from '@/src/gameplay/diagnostics/DiagnosticRulesEngine';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ExplosiveCallbacks, ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ExplosionEvent, ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { AIR_FLIGHT_PROFILES, EXPLOSIVE_BY_ID } from '@/src/schemas/explosive.schema';
import { AudioSettingsSchema } from '@/src/schemas/settings.schema';
import { DestructionSystem } from '@/src/world/DestructionSystem';

function makeCallbacks(): ExplosiveCallbacks {
  return {
    onEnemyKilled: () => {},
    onAirKilled: () => {},
    onConvoyDestroyed: () => {},
    onDestructibleDestroyed: () => {},
    onAlert: () => {},
  };
}

describe('Flight Physics, Gameplay Feel, Explosive Weapons & Advanced Diagnostics Overhaul', () => {
  let scene: THREE.Scene;
  let resources: ResourceManager;
  let vfx: VFXPool;
  let audio: AudioManager;
  let telemetry: CombatTelemetryRecorder;
  let coordinator: CombatEngagementCoordinator;
  let collision: CollisionWorld;
  let projectiles: ProjectileManager;
  let player: PlayerController;
  let enemies: EnemyManager;
  let vehicles: VehicleManager;
  let airCombat: AirCombatManager;
  let destruction: DestructionSystem;
  let explosives: ExplosiveManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    resources = new ResourceManager();
    vfx = new VFXPool(scene, resources);
    audio = new AudioManager(resources, AudioSettingsSchema.parse({ muted: true }));
    telemetry = new CombatTelemetryRecorder();
    coordinator = new CombatEngagementCoordinator(telemetry);
    collision = new CollisionWorld();
    projectiles = new ProjectileManager(scene, resources, vfx, audio, telemetry);
    player = new PlayerController(audio);
    player.spawn(0, 0, 0, 0);
    enemies = new EnemyManager(scene, resources, vfx, audio, projectiles, coordinator, undefined, telemetry);
    vehicles = new VehicleManager(scene, resources, vfx, audio, coordinator, undefined, telemetry);
    airCombat = new AirCombatManager(scene, resources, vfx, audio, coordinator, undefined, telemetry);
    destruction = new DestructionSystem(collision.spatialHash, vfx, audio);
    explosives = new ExplosiveManager(scene, resources, vfx, audio, projectiles, telemetry);
  });

  it('maintains frame-rate-independent rocket boost kinematics and speed caps across 30, 60, and 144 FPS', () => {
    const runAtFps = (fps: number): { dist: number; maxObservedSpeed: number } => {
      const localScene = new THREE.Scene();
      const localRes = new ResourceManager();
      const localVfx = new VFXPool(localScene, localRes);
      const localProj = new ProjectileManager(localScene, localRes, localVfx, audio, telemetry);
      const localCol = new CollisionWorld();

      localProj.spawn({
        kind: 'rocket',
        fromPlayer: true,
        origin: new THREE.Vector3(0, 12, 0),
        direction: new THREE.Vector3(0, 0, -1),
      });

      const dt = 1 / fps;
      const steps = Math.round(1.5 * fps);
      let maxObservedSpeed = 0;
      let lastZ = 0;

      for (let i = 0; i < steps; i++) {
        localProj.update(dt, localCol, () => {}, []);
        const samples = localProj.getFlightTelemetrySamples();
        if (samples.length > 0) {
          maxObservedSpeed = Math.max(maxObservedSpeed, samples[0].speed);
          lastZ = samples[0].z;
        }
      }
      return { dist: Math.abs(lastZ), maxObservedSpeed };
    };

    const r30 = runAtFps(30);
    const r60 = runAtFps(60);
    const r144 = runAtFps(144);
    const rocketMax = EXPLOSIVE_BY_ID.rocket.kinematics.maxSpeed;

    expect(r30.maxObservedSpeed).toBeLessThanOrEqual(rocketMax * 1.02);
    expect(r60.maxObservedSpeed).toBeLessThanOrEqual(rocketMax * 1.02);
    expect(r144.maxObservedSpeed).toBeLessThanOrEqual(rocketMax * 1.02);

    // Travel distances across 30/60/144 FPS should agree within ~3.5%
    expect(Math.abs(r30.dist - r60.dist) / r60.dist).toBeLessThan(0.04);
    expect(Math.abs(r144.dist - r60.dist) / r60.dist).toBeLessThan(0.04);
  });

  it('bounds guided missile angular turn rate and supports target evasion counterplay', () => {
    const target = {
      id: 'jet_1',
      alive: true,
      position: new THREE.Vector3(0, 18, -32),
    };

    projectiles.spawn({
      kind: 'guided_missile',
      fromPlayer: true,
      origin: new THREE.Vector3(0, 18, 0),
      direction: new THREE.Vector3(0, 0, -1),
      homingTarget: target,
    });

    const maxTurn = EXPLOSIVE_BY_ID.guided_missile.kinematics.maxTurnRateDegPerSec;
    // Let missile arm and enter terminal radius (< 18m)
    for (let i = 0; i < 45; i++) {
      projectiles.update(1 / 60, collision, () => {}, []);
      const s = projectiles.getFlightTelemetrySamples()[0];
      if (s) {
        expect(s.turnRateDegPerSec).toBeLessThanOrEqual(maxTurn * 1.1);
      }
    }

    // Target breaks sharply behind the missile nose inside terminal zone
    target.position.set(18, 18, 8);
    let sawEvaded = false;
    for (let i = 0; i < 20; i++) {
      projectiles.update(1 / 60, collision, () => {}, []);
      const s = projectiles.getFlightTelemetrySamples()[0];
      if (s && s.trackingState === 'evaded') {
        sawEvaded = true;
        break;
      }
    }
    expect(sawEvaded).toBe(true);
  });

  it('reflects grenades off 3D obstacles and detonates after fuse expiration', () => {
    collision.addStaticBox({
      id: 'bounce_wall',
      minX: -5,
      minY: 0,
      minZ: -6,
      maxX: 5,
      maxY: 6,
      maxZ: -5,
      layer: COLLISION_LAYER.WORLD,
    });

    let detonatedEv: ExplosionEvent | null = null;
    projectiles.spawn({
      kind: 'hand_grenade',
      fromPlayer: true,
      origin: new THREE.Vector3(0, 2, 0),
      direction: new THREE.Vector3(0, 0, -1),
      speed: 18,
    });

    // Advance past bounce and fuse duration (~3.3s)
    for (let i = 0; i < 220; i++) {
      projectiles.update(1 / 60, collision, (ev) => {
        detonatedEv = ev;
      }, []);
      if (detonatedEv) break;
    }

    expect(detonatedEv).not.toBeNull();
    // Should bounce back toward +Z instead of tunneling through wall at z = -5
    expect(detonatedEv!.z).toBeGreaterThan(-5.1);
  });

  it('splits cluster_munition_bomb into pooled submunitions when descending below 28m altitude', () => {
    const explosions: ExplosionEvent[] = [];
    projectiles.spawn({
      kind: 'cluster_munition_bomb',
      fromPlayer: true,
      origin: new THREE.Vector3(0, 50, 0),
      direction: new THREE.Vector3(0, -1, 0),
      speed: 16,
    });

    let maxConcurrentProjectiles = 0;
    for (let i = 0; i < 300; i++) {
      projectiles.update(1 / 60, collision, (ev) => explosions.push(ev), []);
      maxConcurrentProjectiles = Math.max(maxConcurrentProjectiles, projectiles.getActiveCount());
    }

    expect(maxConcurrentProjectiles).toBeGreaterThanOrEqual(6);
    expect(explosions.filter((e) => e.explosiveId === 'cluster_submunition').length).toBe(6);
  });

  it('transitions aircraft through state-driven flight phases without speed or turn-rate outliers', () => {
    airCombat.spawnUnit('attack_drone', 18, 22, 0, 'mission:1');
    airCombat.spawnUnit('fighter_jet', 40, 120, Math.PI, 'mission:1');

    const observedDronePhases = new Set<string>();
    const observedJetPhases = new Set<string>();

    for (let i = 0; i < 650; i++) {
      airCombat.update(1 / 60, player, collision);
      const samples = airCombat.getFlightTelemetrySamples();
      for (const s of samples) {
        const cap =
          s.category === 'attack_drone'
            ? AIR_FLIGHT_PROFILES.attack_drone.maxSpeed
            : AIR_FLIGHT_PROFILES.fighter_jet.maxSpeed;
        expect(s.speed).toBeLessThanOrEqual(cap * 1.02);
        expect(s.speedOutlier).toBe(false);
        if (s.category === 'attack_drone') observedDronePhases.add(s.stateLabel);
        if (s.category === 'fighter_jet') observedJetPhases.add(s.stateLabel);
      }
    }

    expect(observedDronePhases.has('CRUISE')).toBe(true);
    expect(observedDronePhases.has('HOVER_LOITER')).toBe(true);
    expect(observedJetPhases.size).toBeGreaterThanOrEqual(2);
  });

  it('enforces C4 max deployed cap (4), staggered detonation, and explosion damage deduplication guard', () => {
    collision.addStaticBox({
      id: 'c4_wall',
      minX: -10,
      minY: 0,
      minZ: -3,
      maxX: 10,
      maxY: 6,
      maxZ: -2,
      layer: COLLISION_LAYER.WORLD,
    });

    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
    cam.position.set(0, 1.6, 0);
    cam.lookAt(0, 1.6, -2);
    cam.updateMatrixWorld();

    explosives.resupplyC4(4);
    for (let i = 0; i < 5; i++) {
      explosives.updatePreview(cam, collision, false);
      explosives.handleC4Action(cam, collision, vehicles, 'mission:1');
    }

    // Max 4 deployed even if 5 attempts made
    expect(explosives.getActiveC4Count()).toBe(4);

    // Detonate remotely and advance past 90ms stagger chain
    const triggered = explosives.detonateAllC4();
    expect(triggered).toBe(4);
    for (let i = 0; i < 40; i++) {
      explosives.update(
        1 / 60,
        player,
        cam,
        collision,
        enemies,
        vehicles,
        airCombat,
        destruction,
        false,
        false,
        makeCallbacks()
      );
    }
    expect(explosives.getActiveC4Count()).toBe(0);
    expect(explosives.getTelemetrySummary().c4Detonations).toBe(4);

    // Player explosionId deduplication check
    player.spawn(0, 0, 0, 0);
    const dmg1 = player.applyValidatedExplosionDamage(999, 25, 1, 1);
    const dmg2 = player.applyValidatedExplosionDamage(999, 25, 1, 1);
    expect(dmg1).toBe(25);
    expect(dmg2).toBe(0);
  });

  it('enforces Strategic Nuclear Weapon 2-step confirmation, 1-per-mission cap, countdown, and Fallout Zone', () => {
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300);
    cam.position.set(0, 2, 10);
    cam.lookAt(0, 0, -25);
    cam.updateMatrixWorld();

    // Denied if requisition insufficient and sandbox disabled
    expect(explosives.requestStrategicNuke(cam, collision, 200, false)).toBe(false);

    // Step 1: Request with sufficient REQ
    expect(explosives.requestStrategicNuke(cam, collision, 2000, false)).toBe(true);
    expect(explosives.getOrdnanceHud(player.position, 2000, false).nukePendingConfirmSec).toBeGreaterThan(0);

    // Step 2: Confirm launch
    let spent = 0;
    const confirmed = explosives.confirmStrategicNuke(
      (cost) => {
        spent = cost;
        return true;
      },
      false,
      'mission:1'
    );
    expect(confirmed).toBe(true);
    expect(spent).toBe(1500);
    expect(explosives.getTelemetrySummary().nukeUsed).toBe(true);

    // Cannot request a second time in same mission
    expect(explosives.requestStrategicNuke(cam, collision, 5000, true)).toBe(false);

    // Advance countdown + projectile descent until strategic detonation creates Fallout Zone
    const cb = makeCallbacks();
    for (let i = 0; i < 650; i++) {
      projectiles.update(
        1 / 60,
        collision,
        (ev) =>
          explosives.resolveExplosion(
            ev,
            player,
            collision,
            enemies,
            vehicles,
            airCombat,
            destruction,
            false,
            cb
          ),
        []
      );
      explosives.update(1 / 60, player, cam, collision, enemies, vehicles, airCombat, destruction, false, false, cb);
      if (explosives.getTelemetrySummary().falloutActive) break;
    }

    expect(explosives.getTelemetrySummary().falloutActive).toBe(true);
    expect(explosives.getTelemetrySummary().falloutRemainingSec).toBeGreaterThan(50);
  });

  it('evaluates DiagnosticRulesEngine warnings and generates valid JSON, CSV, Markdown, and Baseline Comparison reports', () => {
    const rules = new DiagnosticRulesEngine();
    const snap = telemetry.buildSnapshot(coordinator.getSnapshot(), [], 0);

    // Inject an artificial token cap breach and speed outlier to verify rules engine detection
    snap.coordinator.currentGlobalAttackers = 6;
    snap.coordinator.maxGlobalAttackers = 3;
    snap.flightSamples = [
      {
        id: 'proj_test_1',
        domain: 'projectile',
        category: 'rocket',
        x: 0,
        y: 10,
        z: -20,
        speed: 95,
        acceleration: 0,
        maxSpeed: 44,
        dirX: 0,
        dirY: 0,
        dirZ: -1,
        turnRateDegPerSec: 0,
        maxTurnRateDegPerSec: 0,
        flightTimeSec: 1.0,
        remainingLifeSec: 4.0,
        trackingState: 'untargeted',
        timeToImpactSec: null,
        stateLabel: 'IMPACT',
        speedOutlier: true,
      },
    ];

    const warnings = rules.evaluate(snap);
    snap.warnings = warnings;
    expect(warnings.some((w) => w.ruleId === 'AI_TOKEN_CAP_VIOLATION')).toBe(true);
    expect(warnings.some((w) => w.ruleId === 'FLIGHT_SPEED_OUTLIER')).toBe(true);

    // Verify exports
    const jsonStr = buildJsonDiagnosticReport(snap);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.schemaVersion).toBe('vanguard.diagnostics.v2');
    expect(parsed.snapshot.warnings.length).toBeGreaterThanOrEqual(2);

    const md = buildMarkdownDiagnosticReport(snap);
    expect(md).toContain('VANGUARD: ZERO HOUR');
    expect(md).toContain('AI_TOKEN_CAP_VIOLATION');

    const csvFlight = buildCsvExport(snap, 'projectiles_flight');
    expect(csvFlight).toContain('proj_test_1');
    expect(buildCsvExport(snap, 'warnings')).toContain('FLIGHT_SPEED_OUTLIER');
    expect(buildCsvExport(snap, 'performance')).toContain('p95FrameMs');
    expect(buildCsvExport(snap, 'resources')).toContain('hasMissionLeak');
    expect(buildCsvExport(snap, 'enemy_ai')).toContain('squadId');
    expect(buildCsvExport(snap, 'damage')).toContain('armorAbsorbed');

    // Verify Before-and-After Baseline Session Comparison
    const improvedCurrent = structuredClone(snap);
    improvedCurrent.performance.avgFps = 62;
    improvedCurrent.performance.p95FrameMs = 17.2;
    improvedCurrent.warnings = [];

    const baselineSnap = structuredClone(snap);
    baselineSnap.performance.avgFps = 45;
    baselineSnap.performance.p95FrameMs = 28.0;

    const comparison = compareDiagnosticSnapshots(baselineSnap, improvedCurrent);
    const fpsRow = comparison.find((r) => r.metric === 'Average FPS');
    const warnRow = comparison.find((r) => r.metric === 'Active Warnings');
    expect(fpsRow?.verdict).toBe('Improved');
    expect(warnRow?.verdict).toBe('Improved');
  });

  it('ignores initial shader-warmup and stale spikes while auditing ResourceManager leaks strictly post-unload', () => {
    const rules = new DiagnosticRulesEngine();
    const rm = new ResourceManager();
    rm.recordBaseline();

    // Active mission scope holds 120 live mission geometries -> post-unload audit must stay CLEAN mid-mission
    for (let i = 0; i < 120; i++) {
      rm.register('geometry', 'mission:1', () => {});
    }
    const midMissionAudit = rm.getLastUnloadAudit();
    expect(midMissionAudit.hasMissionLeak).toBe(false);
    expect(midMissionAudit.missionRemaining).toBe(0);

    // Warmup spike at elapsed 0.2s or stale spike 12s old should NOT trigger PERF_FRAME_SPIKE
    telemetry.tickExposure(0.2, false);
    const warmupSnap = telemetry.buildSnapshot(coordinator.getSnapshot(), [], 0);
    warmupSnap.performance.lastSpikeMs = 63;
    warmupSnap.performance.lastSpikeAgeSec = 0.1;
    warmupSnap.performance.p95FrameMs = 17;
    warmupSnap.resources.hasMissionLeak = midMissionAudit.hasMissionLeak;
    warmupSnap.resources.missionRemaining = midMissionAudit.missionRemaining;

    const warmupWarnings = rules.evaluate(warmupSnap);
    expect(warmupWarnings.some((w) => w.ruleId === 'PERF_FRAME_SPIKE')).toBe(false);
    expect(warmupWarnings.some((w) => w.ruleId === 'RESOURCE_LEAK_SUSPECTED')).toBe(false);

    // Advance past warmup with a stale 12s-old spike -> still clean
    telemetry.tickExposure(2.5, false);
    const staleSnap = telemetry.buildSnapshot(coordinator.getSnapshot(), [], 0);
    staleSnap.performance.lastSpikeMs = 63;
    staleSnap.performance.lastSpikeAgeSec = 12.0;
    staleSnap.performance.p95FrameMs = 18;
    expect(rules.evaluate(staleSnap).some((w) => w.ruleId === 'PERF_FRAME_SPIKE')).toBe(false);

    // Fresh spike (2s ago) after warmup DOES trigger PERF_FRAME_SPIKE
    staleSnap.performance.lastSpikeAgeSec = 2.0;
    expect(rules.evaluate(staleSnap).some((w) => w.ruleId === 'PERF_FRAME_SPIKE')).toBe(true);

    // Unload mission:1 cleanly -> post-unload audit remains CLEAN; if another scope wasn't unloaded, it catches the leak
    rm.unloadScope('mission:1');
    expect(rm.recordPostUnloadAudit().hasMissionLeak).toBe(false);

    rm.register('geometry', 'mission:2', () => {});
    rm.unloadScope('mission:1'); // wrong scope unloaded -> real leak!
    const leakAudit = rm.recordPostUnloadAudit();
    expect(leakAudit.hasMissionLeak).toBe(true);
    expect(leakAudit.missionRemaining).toBe(1);
  });
});
