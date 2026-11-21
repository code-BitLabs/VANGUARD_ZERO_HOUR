import { MapId } from '@/src/schemas/common.schema';
import {
  BuiltWorldData,
  createWorldShell,
  MapPopulator,
  populateCommonWorldAndFinalize,
  WorldShellState,
} from './MapBuilderShared';

export type { BuiltWorldData, MapPopulator, WorldShellState };
export { createWorldShell, populateCommonWorldAndFinalize };

export async function loadMapPopulator(mapId: MapId): Promise<MapPopulator> {
  switch (mapId) {
    case 'warzone_city': {
      const mod = await import('./maps/mapCityDistrict');
      return mod.populateCityDistrict;
    }
    case 'desert_base': {
      const mod = await import('./maps/mapDesertBase');
      return mod.populateDesertBase;
    }
    case 'jungle_zone': {
      const mod = await import('./maps/mapJungleZone');
      return mod.populateJungleZone;
    }
    case 'industrial_complex':
    default: {
      const mod = await import('./maps/mapIndustrialComplex');
      return mod.populateIndustrialComplex;
    }
  }
}
