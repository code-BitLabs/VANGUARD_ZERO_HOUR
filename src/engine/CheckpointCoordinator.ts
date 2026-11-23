import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { BattlefieldVfxSystem } from '@/src/effects/BattlefieldVfxSystem';
import { SurfaceDecalManager } from '@/src/effects/SurfaceDecalManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { CargoLiftManager } from '@/src/gameplay/CargoLiftManager';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { DiagnosticRulesEngine } from '@/src/gameplay/diagnostics/DiagnosticRulesEngine';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { HealthPickupManager } from '@/src/gameplay/HealthPickupManager';
import {
  MissionCheckpointSnapshot,
  selectMissionCheckpointAnchor,
} from '@/src/gameplay/MissionCheckpoint';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { SustainmentEconomyManager } from '@/src/gameplay/SustainmentEconomyManager';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { FriendlySquadManager } from '@/src/gameplay/squad/FriendlySquadManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { Difficulty } from '@/src/schemas/common.schema';
import { MissionConfig } from '@/src/schemas/mission.schema';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { BuiltWorldData } from '@/src/world/MapBuilderAsync';
import { DebugTelemetryPublisher } from './DebugTelemetryPublisher';
import { HudSnapshotPublisher } from './HudSnapshotPublisher';

export interface CheckpointCaptureContext {
  readonly mission: MissionConfig;
  readonly difficulty: Difficulty;
  readonly missionDirector: MissionDirector;
  readonly player: PlayerController;
  readonly weapons: WeaponSystem;
  readonly explosives: ExplosiveManager;
  readonly sustainment: SustainmentEconomyManager;
  readonly disableCheckpoints: boolean;
}

export interface InPlaceCheckpointResetContext {
  readonly scene: THREE.Scene;
  readonly resourceManager: ResourceManager;
  readonly entityScope: ResourceScope;
  readonly vfx: VFXPool;
  readonly battlefieldVfx: BattlefieldVfxSystem;
  readonly surfaceDecals: SurfaceDecalManager;
  readonly projectiles: ProjectileManager;
  readonly explosives: ExplosiveManager;
  readonly enemies: EnemyManager;
  readonly vehicles: VehicleManager;
  readonly airCombat: AirCombatManager;
  readonly healthPickups: HealthPickupManager;
  readonly sustainment: SustainmentEconomyManager;
  readonly friendlySquad: FriendlySquadManager;
  readonly destruction: DestructionSystem;
  readonly cargoLiftManager: CargoLiftManager;
  readonly player: PlayerController;
  readonly collisionWorld: CollisionWorld;
  readonly coordinator: CombatEngagementCoordinator;
  readonly telemetry: CombatTelemetryRecorder;
  readonly rulesEngine: DiagnosticRulesEngine;
  readonly hudPublisher: HudSnapshotPublisher;
  readonly telemetryPublisher: DebugTelemetryPublisher;
}

/**
 * Phase 3 Task 3.3 / Phase 5 Extraction:
 * Owns checkpoint snapshot serialization and sub-8ms in-place mission resets that restore
 * all dynamic entities and destructibles without tearing down static chunk geometry,
 * CollisionWorld BVHs, CSM lighting, or compiled shaders.
 */
export class CheckpointCoordinator {
  captureSnapshot(ctx: CheckpointCaptureContext): MissionCheckpointSnapshot | null {
    if (ctx.disableCheckpoints) {
      return null;
    }
    const activeObjIdx = ctx.missionDirector.getActiveObjectiveIndex();
    const completedIds = ctx.missionDirector.getCompletedObjectiveIds();
    const bypassedIds = ctx.missionDirector.getBypassedObjectiveIds();
    const destroyedTargetIds = ctx.missionDirector.getDestroyedTargetIds();
    const ammoSnap = ctx.weapons.captureAmmoSnapshot();
    const anchor = selectMissionCheckpointAnchor(ctx.mission, activeObjIdx);

    return {
      missionId: ctx.mission.id,
      difficulty: ctx.difficulty,
      checkpointSequence: ctx.missionDirector.getCheckpointSequence(),
      activeObjectiveIndex: activeObjIdx,
      activeStageIndex: ctx.missionDirector.getActiveStageIndex(),
      completedObjectiveIds: completedIds,
      bypassedObjectiveIds: bypassedIds,
      destroyedTargetIds,
      sustainmentSnapshot: ctx.sustainment.captureSnapshot(),
      playerSpawn: anchor,
      healthAtCheckpoint: ctx.player.health,
      armorAtCheckpoint: ctx.player.armor,
      grenadesAtCheckpoint: ctx.player.grenades,
      c4AtCheckpoint: ctx.explosives.getC4Inventory(),
      activeWeaponId: ammoSnap.activeWeaponId,
      weaponAmmoState: ammoSnap.weaponAmmoState,
      scoreAtCheckpoint: ctx.missionDirector.score,
      killsAtCheckpoint: ctx.missionDirector.kills,
      headshotsAtCheckpoint: ctx.missionDirector.headshots,
      airKillsAtCheckpoint: ctx.missionDirector.airKills,
    };
  }

  canResetInPlace(
    activeMission: MissionConfig | null,
    worldData: BuiltWorldData | null,
    worldScope: ResourceScope | null,
    entityScope: ResourceScope | null
  ): boolean {
    return Boolean(activeMission && worldData && worldScope && entityScope);
  }

  /**
   * Resets all dynamic combat actors, transient VFX/decals, and destructible states in place
   * while preserving the entire static world (WorldChunkManager, merged geometry, BVHs, lights).
   */
  resetDynamicStateInPlace(ctx: InPlaceCheckpointResetContext): number {
    ctx.vfx.resetAll();
    ctx.battlefieldVfx.clearAll();
    ctx.surfaceDecals.clearMissionDecals();
    ctx.projectiles.resetAll();
    ctx.explosives.reset();
    ctx.enemies.clear();
    ctx.vehicles.forceExitIfOccupied(ctx.player, ctx.collisionWorld);
    ctx.vehicles.clear();
    ctx.airCombat.clear();
    ctx.healthPickups.clear();
    ctx.sustainment.clear();
    ctx.friendlySquad.dispose(ctx.scene);
    ctx.coordinator.reset();
    ctx.telemetry.reset();
    ctx.rulesEngine.reset();
    ctx.hudPublisher.reset();
    ctx.telemetryPublisher.reset();

    // Dispose only the dynamic entity scope; static world geometry & BVHs stay resident
    ctx.resourceManager.unloadScope(ctx.entityScope);

    // Restore every destructible entity (crates, relays, fuel tanks) cleanly back to intact state
    const restoredCount = ctx.destruction.restoreAllIntact();
    ctx.cargoLiftManager.normalizeForCheckpoint();
    ctx.player.snapInterpolation();

    return restoredCount;
  }
}
