import * as THREE from 'three';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { MapId } from '@/src/schemas/common.schema';
import { DestructionSystem } from './DestructionSystem';
import {
  BuiltWorldData,
  createWorldShell,
  MapPopulator,
  populateCommonWorldAndFinalize,
} from './MapBuilderShared';
import { WorldChunkManager } from './WorldChunkManager';
import { populateCityDistrict } from './maps/mapCityDistrict';
import { populateDesertBase } from './maps/mapDesertBase';
import { populateIndustrialComplex } from './maps/mapIndustrialComplex';
import { populateJungleZone } from './maps/mapJungleZone';

export type { BuiltWorldData } from './MapBuilderShared';

function getStaticMapPopulator(mapId: MapId): MapPopulator {
  switch (mapId) {
    case 'warzone_city':
      return populateCityDistrict;
    case 'desert_base':
      return populateDesertBase;
    case 'jungle_zone':
      return populateJungleZone;
    case 'industrial_complex':
    default:
      return populateIndustrialComplex;
  }
}

export function buildWorldMap(
  mapId: MapId,
  missionId: number,
  scene: THREE.Scene,
  assetManager: AssetManager,
  resourceManager: ResourceManager,
  collisionWorld: CollisionWorld,
  chunkManager: WorldChunkManager,
  destructionSystem: DestructionSystem
): BuiltWorldData {
  const shell = createWorldShell(
    mapId,
    missionId,
    scene,
    assetManager,
    resourceManager,
    collisionWorld,
    chunkManager,
    destructionSystem
  );
  getStaticMapPopulator(mapId)(shell.ctx);
  return populateCommonWorldAndFinalize(shell);
}
