import * as THREE from 'three';
import { createDestructibleCollider } from '../DestructionSystem';
import {
  buildBuildingRooftopAccess,
  buildMultiStopCargoLift,
  buildWalkableWatchtower,
} from '../VerticalStructuresBuilder';
import { buildInstancedJungleTrees, buildWeaponsCache } from '../builders/WorldPropsAndLandmarks';
import type { MapPopulationContext } from '../MapBuilderShared';

export function populateJungleZone(ctx: MapPopulationContext): void {
  const {
    scene,
    assetManager,
    resourceManager,
    collisionWorld,
    chunkManager,
    destructionSystem,
    scope,
    verticalCtx,
    heightFn,
    placeEnterableBuilding,
    placeSupplyCrateAt,
  } = ctx;

  for (const [tx, tz, side] of [
    [-18, 4, '-x'],
    [18, 4, '+x'],
  ] as const) {
    const ty = heightFn(tx, tz);
    buildWalkableWatchtower(
      verticalCtx,
      `jungle_tower_${tx < 0 ? 'west' : 'east'}`,
      tx,
      tz,
      ty,
      side,
      -1
    );
  }

  const campConfigs: Array<[number, number, number, 'switchback_stair' | 'lift_only']> = [
    [-22, -16, 5.0, 'switchback_stair'],
    [22, -18, 5.0, 'switchback_stair'],
    [0, -46, 8.5, 'lift_only'],
  ];
  for (const [cx, cz, ch, accessType] of campConfigs) {
    const cy = placeEnterableBuilding(`camp_${cx}_${cz}`, cx, cz, 10, ch, 8, 'bunker', false, true);
    const surfId = buildBuildingRooftopAccess(verticalCtx, {
      buildingId: `camp_${cx}_${cz}`,
      x: cx,
      baseY: cy,
      z: cz,
      width: 10,
      depth: 8,
      roofY: cy + ch,
      accessSide: cx > 0 ? '-x' : '+x',
      accessType,
      liftBridgeZ: cz,
      ladderAccess:
        accessType === 'switchback_stair'
          ? { side: '+z', offsetAlongWall: cx < 0 ? -3.0 : 3.0 }
          : undefined,
    });
    if (accessType === 'lift_only') {
      buildMultiStopCargoLift(verticalCtx, {
        liftId: 'lift_m4_cmd',
        liftName: 'COMMAND DECK LIFT',
        shaftCenterX: cx + 8.1,
        shaftCenterZ: cz,
        entryAxis: 'x',
        entrySign: -1,
        stops: [
          { floorId: 'ground', label: 'COMPOUND (0.0M)', elevationY: cy, surfaceId: 0 },
          { floorId: 'cmd_deck', label: 'COMMS ROOF (+8.5M)', elevationY: cy + ch, surfaceId: surfId },
        ],
      });
      placeSupplyCrateAt('supply_m4_cmd_roof', cx, cy + ch, cz);
    }
  }

  buildInstancedJungleTrees(scene, heightFn, resourceManager, collisionWorld, scope);

  [
    { x: 18, z: -34 },
    { x: -16, z: -40 },
  ].forEach((pos, i) => {
    const cacheY = heightFn(pos.x, pos.z);
    const cache = buildWeaponsCache(assetManager, resourceManager, scope);
    cache.position.set(pos.x, cacheY, pos.z);
    chunkManager.registerObject(cache, pos.x, pos.z, scene);
    destructionSystem.register({
      id: `cache_${i}`,
      kind: 'weapons_cache',
      isObjectiveTarget: true,
      position: new THREE.Vector3(pos.x, cacheY, pos.z),
      health: 140,
      maxHealth: 140,
      state: 'INTACT',
      blastRadius: 8,
      blastDamage: 150,
      meshGroup: cache,
      collider: createDestructibleCollider(`cache_${i}`, pos.x, cacheY, pos.z, 2.2, 2.4, 2.2),
    });
  });
}
