import { PbrMaterialLibrary } from '@/src/assets/PbrMaterialLibrary';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { BattlefieldVfxSystem } from '@/src/effects/BattlefieldVfxSystem';
import { SurfaceDecalManager } from '@/src/effects/SurfaceDecalManager';
import { SpatialAcousticEngine } from '@/src/audio/SpatialAcousticEngine';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { Difficulty, MapId } from '@/src/schemas/common.schema';
import { MissionConfig } from '@/src/schemas/mission.schema';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { SceneLights, setupLightingRig } from '@/src/world/LightingRig';
import {
  BuiltWorldData,
  createWorldShell,
  loadMapPopulator,
  MapPopulator,
  populateCommonWorldAndFinalize,
} from '@/src/world/MapBuilderAsync';
import {
  buildMissionEnvironmentEnhancement,
  getMissionAtmosphereDirective,
  MissionEnhancementHandle,
} from '@/src/world/MissionEnvironmentEnhancer';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';
import { PerformanceGovernor } from './PerformanceGovernor';
import { EngineRenderer } from './Renderer';

export interface MissionArchitectureLoadResult {
  lights: SceneLights;
  worldData: BuiltWorldData;
  missionEnhancement: MissionEnhancementHandle;
}

export interface MissionLifecycleDependencies {
  readonly renderer: EngineRenderer;
  readonly assetManager: AssetManager;
  readonly resourceManager: ResourceManager;
  readonly collisionWorld: CollisionWorld;
  readonly chunkManager: WorldChunkManager;
  readonly destruction: DestructionSystem;
  readonly vehicles: VehicleManager;
  readonly pbrLibrary: PbrMaterialLibrary;
  readonly surfaceDecals: SurfaceDecalManager;
  readonly battlefieldVfx: BattlefieldVfxSystem;
  readonly spatialAcoustics: SpatialAcousticEngine;
  readonly governor: PerformanceGovernor;
}

/**
 * AUD-12 & AUD-02: Owns mission populator caching, async frame yields, world architecture
 * assembly, checkpoint destructible reconstruction, and pre-combat shader/material prewarming.
 */
export class MissionLifecycleLoader {
  private readonly mapPopulatorCache = new Map<MapId, MapPopulator>();

  constructor(private readonly deps: MissionLifecycleDependencies) {}

  async yieldToFrame(): Promise<void> {
    return new Promise((resolve) => {
      if (
        typeof window !== 'undefined' &&
        typeof window.requestAnimationFrame === 'function' &&
        typeof document !== 'undefined' &&
        !document.hidden
      ) {
        window.requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  reportLoadStage(loaded: number, total: number, currentAsset: string): void {
    gameSessionStore.getState().setLoadProgress({
      loaded,
      total,
      currentAsset,
      percent: Math.round((loaded / total) * 100),
      usedFallbackCount: this.deps.assetManager.getFallbackCount(),
    });
  }

  async resolvePopulator(mapId: MapId): Promise<MapPopulator> {
    let populator = this.mapPopulatorCache.get(mapId);
    if (!populator) {
      populator = await loadMapPopulator(mapId);
      this.mapPopulatorCache.set(mapId, populator);
    }
    return populator;
  }

  getCachedPopulator(mapId: MapId): MapPopulator {
    const populator = this.mapPopulatorCache.get(mapId);
    if (!populator) {
      throw new Error(`Map module not loaded for ${mapId}`);
    }
    return populator;
  }

  populateWorldArchitecture(
    mission: MissionConfig,
    _difficulty: Difficulty,
    _scope: ResourceScope,
    populator: MapPopulator
  ): MissionArchitectureLoadResult {
    const {
      renderer,
      governor,
      resourceManager,
      assetManager,
      collisionWorld,
      chunkManager,
      destruction,
      pbrLibrary,
      surfaceDecals,
      battlefieldVfx,
      spatialAcoustics,
    } = this.deps;

    const profile = governor.getProfile();
    const gSettings = settingsStore.getState().graphics;
    const lights = setupLightingRig(
      renderer.scene,
      mission.lighting,
      profile.shadowMapSize,
      profile.shadowDistance,
      resourceManager,
      mission.id
    );
    renderer.applyGovernorProfile(
      profile,
      gSettings.shadowsEnabled,
      gSettings.bloomEnabled,
      lights
    );

    const shell = createWorldShell(
      mission.mapId,
      mission.id,
      renderer.scene,
      assetManager,
      resourceManager,
      collisionWorld,
      chunkManager,
      destruction
    );
    populator(shell.ctx);
    const worldData = populateCommonWorldAndFinalize(shell);

    const directive = getMissionAtmosphereDirective(mission.id);
    renderer.setExposure(directive.exposure);
    const missionEnhancement = buildMissionEnvironmentEnhancement(
      renderer.scene,
      mission.id,
      pbrLibrary,
      collisionWorld.getGroundHeightAt
    );

    surfaceDecals.clearMissionDecals();
    battlefieldVfx.clearAll();
    battlefieldVfx.clearIndoorShelters();
    for (const surf of worldData.elevatedSurfaces) {
      if (surf.elevationY >= 2.2) {
        battlefieldVfx.registerIndoorShelter({
          minX: surf.minX,
          maxX: surf.maxX,
          minZ: surf.minZ,
          maxZ: surf.maxZ,
          ceilingY: surf.elevationY,
        });
      }
    }
    battlefieldVfx.setEnvironmentWeather(
      directive.weatherMode,
      directive.windX,
      directive.windZ
    );
    spatialAcoustics.setAcousticSpace(directive.acousticSpace);
    renderer.applyDirectorDimensions(gSettings.maxDpr, lights, gSettings.shadowsEnabled);

    return { lights, worldData, missionEnhancement };
  }

  /**
   * Phase 3 Task 3.3: Micro-yielded async world architecture assembly that breaks up
   * lighting, map geometry generation, static chunk merging/BVH registration, and atmosphere
   * across animation frames to keep loading animations responsive.
   */
  async populateWorldArchitectureAsync(
    mission: MissionConfig,
    _difficulty: Difficulty,
    _scope: ResourceScope,
    populator: MapPopulator,
    signal?: AbortSignal
  ): Promise<MissionArchitectureLoadResult> {
    const {
      renderer,
      governor,
      resourceManager,
      assetManager,
      collisionWorld,
      chunkManager,
      destruction,
      pbrLibrary,
      surfaceDecals,
      battlefieldVfx,
      spatialAcoustics,
    } = this.deps;

    const checkAbort = () => {
      if (signal?.aborted) throw new DOMException('Load cancelled', 'AbortError');
    };

    const profile = governor.getProfile();
    const gSettings = settingsStore.getState().graphics;
    const lights = setupLightingRig(
      renderer.scene,
      mission.lighting,
      profile.shadowMapSize,
      profile.shadowDistance,
      resourceManager,
      mission.id
    );
    renderer.applyGovernorProfile(
      profile,
      gSettings.shadowsEnabled,
      gSettings.bloomEnabled,
      lights
    );

    const shell = createWorldShell(
      mission.mapId,
      mission.id,
      renderer.scene,
      assetManager,
      resourceManager,
      collisionWorld,
      chunkManager,
      destruction
    );
    checkAbort();
    await this.yieldToFrame();
    checkAbort();

    populator(shell.ctx);
    checkAbort();
    await this.yieldToFrame();
    checkAbort();

    const worldData = populateCommonWorldAndFinalize(shell);
    checkAbort();
    await this.yieldToFrame();
    checkAbort();

    const directive = getMissionAtmosphereDirective(mission.id);
    renderer.setExposure(directive.exposure);
    const missionEnhancement = buildMissionEnvironmentEnhancement(
      renderer.scene,
      mission.id,
      pbrLibrary,
      collisionWorld.getGroundHeightAt
    );

    surfaceDecals.clearMissionDecals();
    battlefieldVfx.clearAll();
    battlefieldVfx.clearIndoorShelters();
    for (const surf of worldData.elevatedSurfaces) {
      if (surf.elevationY >= 2.2) {
        battlefieldVfx.registerIndoorShelter({
          minX: surf.minX,
          maxX: surf.maxX,
          minZ: surf.minZ,
          maxZ: surf.maxZ,
          ceilingY: surf.elevationY,
        });
      }
    }
    battlefieldVfx.setEnvironmentWeather(
      directive.weatherMode,
      directive.windX,
      directive.windZ
    );
    spatialAcoustics.setAcousticSpace(directive.acousticSpace);
    renderer.applyDirectorDimensions(gSettings.maxDpr, lights, gSettings.shadowsEnabled);

    return { lights, worldData, missionEnhancement };
  }

  reconstructCompletedDestructibles(
    mission: MissionConfig,
    completedIds: ReadonlySet<string>,
    destroyedTargetIds: ReadonlySet<string>
  ): void {
    const completedTypes = new Set(
      mission.objectives.filter((o) => completedIds.has(o.id)).map((o) => o.type)
    );

    for (const ent of this.deps.destruction.getAll()) {
      if (ent.state === 'DESTROYED') continue;
      if (destroyedTargetIds.has(ent.id)) {
        this.deps.destruction.markDestroyedSilently(ent.id);
        continue;
      }
      if (!ent.isObjectiveTarget) continue;
      if (completedTypes.has('plant_charge') && ent.kind === 'weapons_cache') {
        this.deps.destruction.markDestroyedSilently(ent.id);
      } else if (
        completedTypes.has('destroy_targets') &&
        (ent.kind === 'radar_relay' || ent.kind === 'fuel_tank')
      ) {
        this.deps.destruction.markDestroyedSilently(ent.id);
      }
    }
  }

  prewarmCombatShaders(): void {
    this.deps.surfaceDecals.prewarm();
    this.deps.destruction.prewarm(this.deps.renderer.scene);
    this.deps.vehicles.prewarm();
    this.deps.renderer.registerSceneShadowsAndPrecompile();
  }

  async prewarmCombatShadersAsync(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    this.deps.surfaceDecals.prewarm();
    this.deps.destruction.prewarm(this.deps.renderer.scene);
    this.deps.vehicles.prewarm();
    await this.deps.renderer.registerSceneShadowsAndPrecompileAsync(signal);
  }
}
