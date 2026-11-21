import * as THREE from 'three';
import { AGENT_PROFILE_ALL_INFANTRY_MASK } from '@/src/navigation/AgentTraversalProfile';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { createDestructibleCollider } from '../DestructionSystem';
import {
  buildBuildingRooftopAccess,
  buildElevatedSkybridge,
  buildMultiStopCargoLift,
} from '../VerticalStructuresBuilder';
import { buildFuelTank, buildMovingGantry } from '../builders/WorldPropsAndLandmarks';
import type { MapPopulationContext } from '../MapBuilderShared';

export function populateIndustrialComplex(ctx: MapPopulationContext): void {
  const {
    scene,
    assetManager,
    resourceManager,
    collisionWorld,
    chunkManager,
    destructionSystem,
    scope,
    verticalCtx,
    animatedProps,
    navPortals,
    placeEnterableBuilding,
    placeSupplyCrateAt,
  } = ctx;

  const warehouses: Array<[number, number, number, number, number]> = [
    [-28, 22, 18, 7.0, 22],
    [28, 20, 18, 7.0, 22],
    [-30, -24, 20, 14.0, 24],
    [30, -26, 20, 14.0, 24],
  ];
  const whBaseYs: number[] = [];
  warehouses.forEach(([wx, wz, ww, wh, wd], i) => {
    whBaseYs.push(placeEnterableBuilding(`warehouse_${i}`, wx, wz, ww, wh, wd, 'warehouse', false, true));
  });

  buildBuildingRooftopAccess(verticalCtx, {
    buildingId: 'warehouse_0',
    x: -28,
    baseY: whBaseYs[0],
    z: 22,
    width: 18,
    depth: 22,
    roofY: whBaseYs[0] + 7.0,
    accessSide: '+x',
    accessType: 'switchback_stair',
    ladderAccess: { side: '+z', offsetAlongWall: -4.5 },
  });
  buildBuildingRooftopAccess(verticalCtx, {
    buildingId: 'warehouse_1',
    x: 28,
    baseY: whBaseYs[1],
    z: 20,
    width: 18,
    depth: 22,
    roofY: whBaseYs[1] + 7.0,
    accessSide: '-x',
    accessType: 'switchback_stair',
    ladderAccess: { side: '+z', offsetAlongWall: 4.5 },
  });

  const w2RoofSurf = buildBuildingRooftopAccess(verticalCtx, {
    buildingId: 'warehouse_2',
    x: -30,
    baseY: whBaseYs[2],
    z: -24,
    width: 20,
    depth: 24,
    roofY: whBaseYs[2] + 14.0,
    accessSide: '+x',
    accessType: 'lift_only',
    liftBridgeZ: -24,
    ladderAccess: { side: '+z', offsetAlongWall: -5.0 },
  });
  const w3RoofSurf = buildBuildingRooftopAccess(verticalCtx, {
    buildingId: 'warehouse_3',
    x: 30,
    baseY: whBaseYs[3],
    z: -26,
    width: 20,
    depth: 24,
    roofY: whBaseYs[3] + 14.0,
    accessSide: '-x',
    accessType: 'lift_only',
    liftBridgeZ: -24,
  });

  const skybridgeSurf = buildElevatedSkybridge(
    verticalCtx,
    'foundry_skybridge',
    w2RoofSurf,
    w3RoofSurf,
    -14.6,
    14.6,
    -24,
    7.0,
    4.2
  );
  navPortals.splice(navPortals.length - 2, 2);

  buildMultiStopCargoLift(verticalCtx, {
    liftId: 'lift_m5_west',
    liftName: 'WEST FOUNDRY LIFT',
    shaftCenterX: -17.6,
    shaftCenterZ: -24,
    entryAxis: 'x',
    entrySign: -1,
    stops: [
      { floorId: 'ground', label: 'L1 FOUNDRY (0.0M)', elevationY: 0, surfaceId: 0, gateSign: 1 },
      { floorId: 'mezzanine', label: 'L2 SKYBRIDGE (+7.0M)', elevationY: 7.0, surfaceId: skybridgeSurf, gateSign: 1 },
      { floorId: 'gantry_roof', label: 'L3 ROOF DECK (+14.0M)', elevationY: whBaseYs[2] + 14.0, surfaceId: w2RoofSurf, gateSign: -1 },
    ],
  });

  buildMultiStopCargoLift(verticalCtx, {
    liftId: 'lift_m5_east',
    liftName: 'EAST FOUNDRY LIFT',
    shaftCenterX: 17.6,
    shaftCenterZ: -24,
    entryAxis: 'x',
    entrySign: 1,
    stops: [
      { floorId: 'ground', label: 'L1 FOUNDRY (0.0M)', elevationY: 0, surfaceId: 0, gateSign: -1 },
      { floorId: 'mezzanine', label: 'L2 SKYBRIDGE (+7.0M)', elevationY: 7.0, surfaceId: skybridgeSurf, gateSign: -1 },
      { floorId: 'gantry_roof', label: 'L3 ROOF DECK (+14.0M)', elevationY: whBaseYs[3] + 14.0, surfaceId: w3RoofSurf, gateSign: 1 },
    ],
  });

  placeSupplyCrateAt('supply_m5_roof_west', -30, whBaseYs[2] + 14.0, -24);
  placeSupplyCrateAt('supply_m5_roof_east', 30, whBaseYs[3] + 14.0, -26);

  void AGENT_PROFILE_ALL_INFANTRY_MASK;

  const gantry = buildMovingGantry(assetManager, resourceManager, scope);
  gantry.position.set(0, 14, -4);
  scene.add(gantry);
  resourceManager.register('object3d', scope, () => scene.remove(gantry));
  for (const gx of [-20.5, 20.5]) {
    collisionWorld.addStaticBox({
      id: `gantry_pillar_${gx > 0 ? 'E' : 'W'}`,
      minX: gx - 0.6,
      minY: 0,
      minZ: -4.8,
      maxX: gx + 0.6,
      maxY: 14.5,
      maxZ: -3.2,
      layer: COLLISION_LAYER.WORLD,
      tag: 'building_pillar',
    });
  }
  animatedProps.push({
    update: (elapsed) => {
      const trolley = gantry.getObjectByName('gantry_trolley');
      if (trolley) trolley.position.x = Math.sin(elapsed * 0.7) * 14;
    },
  });

  [
    { x: -16, z: 8 },
    { x: 16, z: -6 },
    { x: -14, z: -38 },
  ].forEach((pos, i) => {
    const container = buildFuelTank(assetManager, resourceManager, scope);
    container.position.set(pos.x, 0, pos.z);
    chunkManager.registerObject(container, pos.x, pos.z, scene);
    destructionSystem.register({
      id: `ind_container_${i}`,
      kind: 'fuel_tank',
      isObjectiveTarget: true,
      position: new THREE.Vector3(pos.x, 0, pos.z),
      health: 170,
      maxHealth: 170,
      state: 'INTACT',
      blastRadius: 10,
      blastDamage: 170,
      meshGroup: container,
      collider: createDestructibleCollider(`ind_container_${i}`, pos.x, 0, pos.z, 2.5, 4.5, 2.5),
    });
  });
}
