import * as THREE from 'three';
import { createDestructibleCollider } from '../DestructionSystem';
import { buildBuildingRooftopAccess, buildMultiStopCargoLift } from '../VerticalStructuresBuilder';
import { buildRadarRelay, buildSearchlightTower } from '../builders/WorldPropsAndLandmarks';
import type { MapPopulationContext } from '../MapBuilderShared';

export function populateCityDistrict(ctx: MapPopulationContext): void {
  const {
    missionId,
    scene,
    assetManager,
    resourceManager,
    chunkManager,
    destructionSystem,
    scope,
    verticalCtx,
    heightFn,
    animatedProps,
    placeEnterableBuilding,
    placeSupplyCrateAt,
  } = ctx;

  const isNightM3 = missionId === 3;
  const buildings: Array<[number, number, number, number, number, boolean]> = [
    [-28, 30, 14, isNightM3 ? 16.0 : 6.5, 14, true],
    [28, 28, 16, isNightM3 ? 16.0 : 22, 16, isNightM3],
    [-30, -8, 16, isNightM3 ? 6.5 : 16.0, 18, true],
    [30, -10, 14, 6.5, 16, true],
    [-26, -42, 18, 26, 14, false],
    [26, -44, 16, 20, 16, false],
    [-56, 8, 18, 28, 20, false],
    [56, 6, 18, 25, 20, false],
  ];
  const baseYs: number[] = [];
  buildings.forEach(([bx, bz, bw, bh, bd, accessible], idx) => {
    const by = placeEnterableBuilding(
      `city_bldg_${idx}`,
      bx,
      bz,
      bw,
      bh,
      bd,
      'city',
      !accessible && idx % 2 === 0,
      accessible
    );
    baseYs.push(by);
  });

  if (!isNightM3) {
    buildBuildingRooftopAccess(verticalCtx, {
      buildingId: 'city_bldg_0',
      x: -28,
      baseY: baseYs[0],
      z: 30,
      width: 14,
      depth: 14,
      roofY: baseYs[0] + 6.5,
      accessSide: '+x',
      accessType: 'switchback_stair',
      ladderAccess: { side: '+z', offsetAlongWall: -3.4 },
    });
    buildBuildingRooftopAccess(verticalCtx, {
      buildingId: 'city_bldg_3',
      x: 30,
      baseY: baseYs[3],
      z: -10,
      width: 14,
      depth: 16,
      roofY: baseYs[3] + 6.5,
      accessSide: '-x',
      accessType: 'switchback_stair',
      ladderAccess: { side: '+z', offsetAlongWall: 3.4 },
    });
    const b2RoofSurf = buildBuildingRooftopAccess(verticalCtx, {
      buildingId: 'city_bldg_2',
      x: -30,
      baseY: baseYs[2],
      z: -8,
      width: 16,
      depth: 18,
      roofY: baseYs[2] + 16.0,
      accessSide: '+x',
      accessType: 'lift_only',
      liftBridgeZ: -8,
    });
    buildMultiStopCargoLift(verticalCtx, {
      liftId: 'lift_m1_north',
      liftName: 'NORTH SECTOR LIFT',
      shaftCenterX: -18.9,
      shaftCenterZ: -8,
      entryAxis: 'x',
      entrySign: -1,
      stops: [
        { floorId: 'ground', label: 'GROUND (0.0M)', elevationY: 0, surfaceId: 0 },
        {
          floorId: 'rooftop',
          label: 'OVERWATCH (+16.0M)',
          elevationY: baseYs[2] + 16.0,
          surfaceId: b2RoofSurf,
        },
      ],
    });
    placeSupplyCrateAt('supply_m1_roof_b2', -30, baseYs[2] + 16.0, -8);
  } else {
    const b0Surf = buildBuildingRooftopAccess(verticalCtx, {
      buildingId: 'city_bldg_0',
      x: -28,
      baseY: baseYs[0],
      z: 30,
      width: 14,
      depth: 14,
      roofY: baseYs[0] + 16.0,
      accessSide: '+x',
      accessType: 'lift_only',
      liftBridgeZ: 30,
    });
    buildMultiStopCargoLift(verticalCtx, {
      liftId: 'lift_m3_west',
      liftName: 'AA WEST LIFT',
      shaftCenterX: -17.9,
      shaftCenterZ: 30,
      entryAxis: 'x',
      entrySign: -1,
      stops: [
        { floorId: 'ground', label: 'PLAZA (0.0M)', elevationY: 0, surfaceId: 0 },
        { floorId: 'aa_deck', label: 'AA ROOF (+16.0M)', elevationY: baseYs[0] + 16.0, surfaceId: b0Surf },
      ],
    });
    placeSupplyCrateAt('supply_m3_roof_west', -28, baseYs[0] + 16.0, 30);

    const b1Surf = buildBuildingRooftopAccess(verticalCtx, {
      buildingId: 'city_bldg_1',
      x: 28,
      baseY: baseYs[1],
      z: 28,
      width: 16,
      depth: 16,
      roofY: baseYs[1] + 16.0,
      accessSide: '-x',
      accessType: 'lift_only',
      liftBridgeZ: 28,
    });
    buildMultiStopCargoLift(verticalCtx, {
      liftId: 'lift_m3_east',
      liftName: 'AA EAST LIFT',
      shaftCenterX: 16.9,
      shaftCenterZ: 28,
      entryAxis: 'x',
      entrySign: 1,
      stops: [
        { floorId: 'ground', label: 'PLAZA (0.0M)', elevationY: 0, surfaceId: 0 },
        { floorId: 'aa_deck', label: 'AA ROOF (+16.0M)', elevationY: baseYs[1] + 16.0, surfaceId: b1Surf },
      ],
    });
    placeSupplyCrateAt('supply_m3_roof_east', 28, baseYs[1] + 16.0, 28);

    buildBuildingRooftopAccess(verticalCtx, {
      buildingId: 'city_bldg_2',
      x: -30,
      baseY: baseYs[2],
      z: -8,
      width: 16,
      depth: 18,
      roofY: baseYs[2] + 6.5,
      accessSide: '+x',
      accessType: 'switchback_stair',
      ladderAccess: { side: '+z', offsetAlongWall: -4.0 },
    });
    buildBuildingRooftopAccess(verticalCtx, {
      buildingId: 'city_bldg_3',
      x: 30,
      baseY: baseYs[3],
      z: -10,
      width: 14,
      depth: 16,
      roofY: baseYs[3] + 6.5,
      accessSide: '-x',
      accessType: 'switchback_stair',
      ladderAccess: { side: '+z', offsetAlongWall: 3.4 },
    });
  }

  if (missionId === 3) {
    const m3Towers = [
      { id: 'm3_searchlight_west', x: -18, z: -14, baseYaw: 0.45, amp: 0.72, speed: 0.65 },
      { id: 'm3_searchlight_east', x: 18, z: -16, baseYaw: -0.45, amp: 0.72, speed: 0.58 },
    ];
    for (const tw of m3Towers) {
      const ty = heightFn(tw.x, tw.z);
      const towerMesh = buildSearchlightTower(assetManager, resourceManager, scope);
      towerMesh.position.set(tw.x, ty, tw.z);
      chunkManager.registerObject(towerMesh, tw.x, tw.z, scene);
      destructionSystem.register({
        id: tw.id,
        kind: 'searchlight_tower',
        isObjectiveTarget: false,
        position: new THREE.Vector3(tw.x, ty, tw.z),
        health: 110,
        maxHealth: 110,
        state: 'INTACT',
        blastRadius: 4.0,
        blastDamage: 45,
        meshGroup: towerMesh,
        collider: createDestructibleCollider(tw.id, tw.x, ty, tw.z, 1.35, 10.2, 1.35),
      });
      const head = towerMesh.getObjectByName('searchlight_head');
      animatedProps.push({
        update: (elapsed) => {
          if (head && head.visible) {
            head.rotation.y = tw.baseYaw + Math.sin(elapsed * tw.speed) * tw.amp;
          }
        },
      });
    }
  }

  if (missionId === 1) {
    [
      { x: -18, z: -26 },
      { x: 18, z: -30 },
    ].forEach((pos, i) => {
      const radar = buildRadarRelay(assetManager, resourceManager, scope);
      radar.position.set(pos.x, 0, pos.z);
      chunkManager.registerObject(radar, pos.x, pos.z, scene);
      destructionSystem.register({
        id: `radar_${i}`,
        kind: 'radar_relay',
        isObjectiveTarget: true,
        position: new THREE.Vector3(pos.x, 0, pos.z),
        health: 160,
        maxHealth: 160,
        state: 'INTACT',
        blastRadius: 6,
        blastDamage: 120,
        meshGroup: radar,
        collider: createDestructibleCollider(`radar_${i}`, pos.x, 0, pos.z, 2, 4.2, 2),
      });
      animatedProps.push({
        update: (elapsed) => {
          const dish = radar.getObjectByName('radar_dish');
          if (dish) dish.rotation.y = elapsed * 1.4;
        },
      });
    });
  }
}
