import { AudioManager } from '@/src/audio/AudioManager';
import { isDeveloperModeActiveForSetting } from '@/src/config/devMode';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import {
  CombatDebugSnapshot,
  CombatTelemetryRecorder,
} from '@/src/gameplay/CombatTelemetryRecorder';
import { DiagnosticRulesEngine } from '@/src/gameplay/diagnostics/DiagnosticRulesEngine';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { SettingsBundle } from '@/src/schemas/settings.schema';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { uiStore } from '@/src/stores/uiStore';
import { CombatDebugRenderer } from './CombatDebugRenderer';
import { PerformanceMonitor } from './PerformanceMonitor';
import { EngineRenderer } from './Renderer';

export interface DebugTelemetryDependencies {
  readonly renderer: EngineRenderer;
  readonly resourceManager: ResourceManager;
  readonly monitor: PerformanceMonitor;
  readonly telemetry: CombatTelemetryRecorder;
  readonly rulesEngine: DiagnosticRulesEngine;
  readonly coordinator: CombatEngagementCoordinator;
  readonly debugRenderer: CombatDebugRenderer;
  readonly collisionWorld: CollisionWorld;
  readonly player: PlayerController;
  readonly weapons: WeaponSystem;
  readonly enemies: EnemyManager;
  readonly vehicles: VehicleManager;
  readonly airCombat: AirCombatManager;
  readonly projectiles: ProjectileManager;
  readonly explosives: ExplosiveManager;
  readonly vfx: VFXPool;
  readonly audio: AudioManager;
}

/**
 * AUD-07 & AUD-12: Coordinates F4 diagnostics publishing and 3D gizmos.
 * Collapsed bubble mode publishes lightweight FPS/frame/coordinator summaries at 2 Hz
 * without constructing full per-entity inspector rows, physics snapshots, or rules sweeps.
 */
export class DebugTelemetryPublisher {
  private debugPublishAccum = 0;

  constructor(private readonly deps: DebugTelemetryDependencies) {}

  reset(): void {
    this.debugPublishAccum = 0;
    this.deps.debugRenderer.setVisible(false);
    this.deps.enemies.setDetailedTelemetryActive(false);
    this.deps.collisionWorld.physicsWorld.debugSystem.setDetailedRecordingEnabled(false);
  }

  stepAndPublish(
    dt: number,
    settings: Pick<SettingsBundle, 'developer'>,
    weaponShortName: string
  ): void {
    const devActive = isDeveloperModeActiveForSetting(settings.developer.devModeEnabled);
    const uiState = uiStore.getState();
    const debugOpen = devActive && uiState.combatDebugOpen;
    const debugCollapsed = uiState.combatDebugCollapsed;
    const any3DGizmoEnabled =
      settings.developer.debugShow3DGizmos ||
      settings.developer.debugShowFlightPaths ||
      settings.developer.debugShowPhysicsColliders;

    // Gate expensive out-of-FOV LOS raycasts and physics contact buffers unless actively inspected
    const detailedActive = debugOpen && (!debugCollapsed || any3DGizmoEnabled);
    this.deps.enemies.setDetailedTelemetryActive(debugOpen && !debugCollapsed);
    this.deps.collisionWorld.physicsWorld.debugSystem.setDetailedRecordingEnabled(
      debugOpen && (!debugCollapsed || settings.developer.debugShowPhysicsColliders)
    );

    if (!debugOpen) {
      this.debugPublishAccum = 0;
      this.deps.debugRenderer.setVisible(false);
      return;
    }

    this.debugPublishAccum += dt;
    // 5 Hz when expanded/gizmos active, 2 Hz when collapsed into the compact bubble
    const publishPeriod = detailedActive ? 0.2 : 0.5;
    if (this.debugPublishAccum < publishPeriod) {
      return;
    }
    this.debugPublishAccum = 0;

    if (!detailedActive) {
      // AUD-07: Fast collapsed F4 path — update lightweight FPS/frame/coordinator metrics only
      const perf = this.deps.monitor.getLatestTelemetry();
      const coordSnap = this.deps.coordinator.getSnapshot();
      const prevSnap = gameSessionStore.getState().combatDebug;
      this.deps.telemetry.setPerformanceTelemetry(perf);

      const lightSnap: CombatDebugSnapshot = prevSnap
        ? {
            ...prevSnap,
            coordinator: coordSnap,
            performance: {
              ...perf,
              phases: { ...perf.phases },
            },
          }
        : this.deps.telemetry.buildSnapshot(coordSnap, [], this.deps.projectiles.getActiveCount());

      gameSessionStore.getState().updateCombatDebug(lightSnap);
      this.deps.debugRenderer.setVisible(false);
      return;
    }

    const {
      enemies,
      airCombat,
      vehicles,
      player,
      renderer,
      resourceManager,
      weapons,
      projectiles,
      explosives,
      monitor,
      audio,
      vfx,
      collisionWorld,
      coordinator,
      telemetry,
      rulesEngine,
      debugRenderer,
    } = this.deps;

    const groundRows = enemies.getDebugInspectorRows(player);
    const airRows = airCombat.getDebugInspectorRows(player);
    const vehRows = vehicles.getDebugInspectorRows(player);
    const allDebugUnits = [...groundRows, ...airRows, ...vehRows];
    const drawInfo = renderer.getDrawInfo();
    const resSnap = resourceManager.getSnapshot();
    const audit = resourceManager.getLastUnloadAudit();

    telemetry.setPlayerMovementTelemetry(
      player.getMovementTelemetry(
        weaponShortName,
        weapons.getEquipTimerSec(),
        weapons.getReloadStage(),
        weapons.getReloadProgress()
      )
    );
    telemetry.setFlightSamples([
      ...projectiles.getFlightTelemetrySamples(),
      ...airCombat.getFlightTelemetrySamples(),
    ]);
    telemetry.setOrdnanceSummary(explosives.getTelemetrySummary());
    telemetry.setPerformanceTelemetry(monitor.getLatestTelemetry());
    telemetry.setResourceTelemetry({
      geometries: drawInfo.geometries,
      materials: resSnap.byCategory.material,
      textures: drawInfo.textures,
      renderTargets: resSnap.byCategory.renderTarget,
      listeners: resSnap.byCategory.listener,
      timers: resSnap.byCategory.timer,
      audioVoices: audio.getActiveVoiceCount(),
      activePooledVfx: vfx.getActiveCount(),
      poolCapacityVfx: vfx.getPoolCapacity(),
      activePooledProjectiles: projectiles.getActiveCount(),
      poolCapacityProjectiles: projectiles.getPoolCapacity(),
      activeC4Count: explosives.getActiveC4Count(),
      totalCreated: resSnap.totalCreated,
      totalDisposed: resSnap.totalDisposed,
      sharedCount: resSnap.sharedCount,
      missionCount: resSnap.missionCount,
      hasMissionLeak: audit.hasMissionLeak,
      missionRemaining: audit.missionRemaining,
      sharedDelta: audit.sharedDelta,
    });

    const dynamicPhysicsBodies = [
      player.getPhysicsInspectorRow(),
      ...enemies.getPhysicsInspectorRows(),
      ...vehicles.getPhysicsInspectorRows(),
      ...airCombat.getPhysicsInspectorRows(),
      ...projectiles.getPhysicsInspectorRows(),
    ];
    const physSnap = collisionWorld.physicsWorld.buildDiagnosticsSnapshot(dynamicPhysicsBodies);
    telemetry.setPhysicsDiagnostics(physSnap);

    const coordSnap = coordinator.getSnapshot();
    const prelimSnap = telemetry.buildSnapshot(
      coordSnap,
      allDebugUnits,
      projectiles.getActiveCount()
    );
    const warnings = rulesEngine.evaluate(prelimSnap);
    telemetry.setWarnings(warnings);
    prelimSnap.warnings = warnings;
    gameSessionStore.getState().updateCombatDebug(prelimSnap);

    const cap = player.getActiveCapsuleDimensions();
    const lastMove = player.getLastMoveResult();
    debugRenderer.update(
      settings.developer.debugShow3DGizmos,
      allDebugUnits,
      prelimSnap.recentShots,
      player.position,
      settings.developer.debugShowFlightPaths,
      prelimSnap.flightSamples,
      prelimSnap.recentExplosions,
      settings.developer.debugShowPhysicsColliders,
      prelimSnap.physics,
      vehicles.getCameraDebugRay(),
      {
        radius: cap.radius,
        height: cap.height,
        velocityX: player.velocity.x,
        velocityY: player.velocity.y,
        velocityZ: player.velocity.z,
        groundNormalX: lastMove?.groundNormalX ?? 0,
        groundNormalY: lastMove?.groundNormalY ?? 1,
        groundNormalZ: lastMove?.groundNormalZ ?? 0,
        grounded: player.grounded,
        climbing: player.isClimbingLadder,
      }
    );
  }
}
