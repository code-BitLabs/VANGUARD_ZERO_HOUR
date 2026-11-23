import * as THREE from 'three';
import { createDestructibleCollider } from '../DestructionSystem';
import { buildBuildingRooftopAccess, buildWalkableWatchtower } from '../VerticalStructuresBuilder';
import { buildFuelTank } from '../builders/WorldPropsAndLandmarks';
import type { MapPopulationContext } from '../MapBuilderShared';

export function populateDesertBase(ctx: MapPopulationContext): void {
  const {
    scene,
    assetManager,
    resourceManager,
    chunkManager,
    destructionSystem,
    scope,
    verticalCtx,
    heightFn,
    placeEnterableBuilding,
    placeSupplyCrateAt,
  } = ctx;

  const bunkers: Array<[number, number, number, number, number, boolean]> = [
    [-28, -32, 14, 6, 12, true],
    [28, -36, 14, 6, 12, true],
    [0, -64, 24, 9, 14, false],
  ];
  const bunkerBaseYs: number[] = [];
  bunkers.forEach(([bx, bz, bw, bh, bd, accessible], i) => {
    bunkerBaseYs.push(
      placeEnterableBuilding(`bunker_${i}`, bx, bz, bw, bh, bd, 'bunker', false, accessible)
    );
  });
  buildBuildingRooftopAccess(verticalCtx, {
    buildingId: 'bunker_0',
    x: -28,
    baseY: bunkerBaseYs[0],
    z: -32,
    width: 14,
    depth: 12,
    roofY: bunkerBaseYs[0] + 6.0,
    accessSide: '+x',
    accessType: 'switchback_stair',
    ladderAccess: { side: '+z', offsetAlongWall: -3.4 },
  });
  buildBuildingRooftopAccess(verticalCtx, {
    buildingId: 'bunker_1',
    x: 28,
    baseY: bunkerBaseYs[1],
    z: -36,
    width: 14,
    depth: 12,
    roofY: bunkerBaseYs[1] + 6.0,
    accessSide: '-x',
    accessType: 'switchback_stair',
    ladderAccess: { side: '+z', offsetAlongWall: 3.4 },
  });
  placeSupplyCrateAt('supply_m2_bunker0_roof', -28, bunkerBaseYs[0] + 6.0, -32);

  for (const [tx, tz] of [
    [-24, 14],
    [24, 12],
    [-34, -56],
    [34, -56],
  ]) {
    const ty = heightFn(tx, tz);
    buildWalkableWatchtower(
      verticalCtx,
      `tower_${tx}_${tz}`,
      tx,
      tz,
      ty,
      tx < 0 ? '+x' : '-x',
      tz < 0 ? -1 : 1
    );
  }

  [
    { x: 18, z: -48 },
    { x: 26, z: -50 },
    { x: 34, z: -48 },
  ].forEach((pos, i) => {
    const tankY = heightFn(pos.x, pos.z);
    const tank = buildFuelTank(assetManager, resourceManager, scope);
    tank.position.set(pos.x, tankY, pos.z);
    chunkManager.registerObject(tank, pos.x, pos.z, scene);
    destructionSystem.register({
      id: `fuel_tank_${i}`,
      kind: 'fuel_tank',
      isObjectiveTarget: true,
      position: new THREE.Vector3(pos.x, tankY, pos.z),
      health: 150,
      maxHealth: 150,
      state: 'INTACT',
      blastRadius: 11,
      blastDamage: 180,
      meshGroup: tank,
      collider: createDestructibleCollider(`fuel_tank_${i}`, pos.x, tankY, pos.z, 2.5, 4.5, 2.5),
    });
  });
}
