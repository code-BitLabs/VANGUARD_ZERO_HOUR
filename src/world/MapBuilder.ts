import * as THREE from 'three';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { CargoLiftDefinition } from '@/src/gameplay/CargoLiftManager';
import { AGENT_PROFILE_ALL_INFANTRY_MASK } from '@/src/navigation/AgentTraversalProfile';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { MapId } from '@/src/schemas/common.schema';
import { ElevatedNavSurfaceDescriptor } from '@/src/workers/WorkerBridge';
import { NavPortalInput } from '@/src/workers/navigationCore';
import { createDestructibleCollider, DestructionSystem } from './DestructionSystem';
import {
  buildBuildingRooftopAccess,
  buildElevatedSkybridge,
  buildMultiStopCargoLift,
  buildWalkableWatchtower,
  VerticalWorldContext,
} from './VerticalStructuresBuilder';
import { WorldChunkManager } from './WorldChunkManager';
import { getMissionVisualProfile } from './VisualBible';
import { globalStructureReconciliation } from './StructureReconciliationRegistry';
import { SustainmentStationKind } from '@/src/gameplay/SustainmentEconomyManager';
import {
  buildCompositeBridge,
  buildConcreteBarrier,
  buildEnterableBuildingMesh,
  buildExplosiveBarrel,
  buildExtractionBeacon,
  buildFuelTank,
  buildInstancedJungleTrees,
  buildMedArmorStation,
  buildMissionEnvironmentalStorytelling,
  buildMovingGantry,
  buildPerimeterRidges,
  buildRadarRelay,
  buildSearchlightTower,
  buildSupplyCrate,
  buildVehicleServiceBay,
  buildWeaponsCache,
  buildWoodenSupplyStack,
} from './builders/WorldPropsAndLandmarks';

export interface BuiltWorldData {
  coverNodes: THREE.Vector3[];
  roadWaypoints: THREE.Vector3[];
  supplyCrates: Array<{
    id: string;
    kind?: SustainmentStationKind;
    maxCharges?: number;
    position: THREE.Vector3;
    used: boolean;
    mesh: THREE.Group;
    statusLightMesh?: THREE.Mesh | null;
  }>;
  animatedProps: Array<{ update: (elapsed: number) => void }>;
  extractionBeacon: THREE.Group | null;
  elevatedSurfaces: ElevatedNavSurfaceDescriptor[];
  navPortals: NavPortalInput[];
  cargoLifts: CargoLiftDefinition[];
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
  const scope: ResourceScope = `mission:${missionId}`;
  const coverNodes: THREE.Vector3[] = [];
  const roadWaypoints: THREE.Vector3[] = [
    new THREE.Vector3(0, 0, 58),
    new THREE.Vector3(6, 0, 22),
    new THREE.Vector3(-4, 0, -14),
    new THREE.Vector3(4, 0, -52),
  ];
  const supplyCrates: BuiltWorldData['supplyCrates'] = [];
  const animatedProps: BuiltWorldData['animatedProps'] = [];
  const elevatedSurfaces: ElevatedNavSurfaceDescriptor[] = [];
  const navPortals: NavPortalInput[] = [];
  const cargoLifts: CargoLiftDefinition[] = [];
  let surfaceCounter = 1;
  let portalCounter = 0;

  globalStructureReconciliation.clearMission(missionId);
  const visualProfile = getMissionVisualProfile(missionId);

  const verticalCtx: VerticalWorldContext = {
    missionId,
    scene,
    assetManager,
    resourceManager,
    collisionWorld,
    chunkManager,
    scope,
    coverNodes,
    elevatedSurfaces,
    navPortals,
    cargoLifts,
    nextSurfaceId: () => surfaceCounter++,
    nextPortalId: () => portalCounter++,
  };

  // Terrain height function per map (keeps central roads flat & playable, edges rolling)
  const heightFn = (x: number, z: number): number => {
    const roadDist = Math.abs(x);
    if (mapId === 'desert_base') {
      if (roadDist < 14) return 0;
      return Math.sin(x * 0.04) * Math.cos(z * 0.04) * 1.4 + Math.max(0, (Math.hypot(x, z) - 90) * 0.14);
    }
    if (mapId === 'jungle_zone') {
      // River channel between z = 10 and z = 22
      if (z > 10 && z < 22 && Math.abs(x) > 8 && Math.abs(x + 28) > 6 && Math.abs(x - 28) > 6) {
        return -0.7;
      }
      return Math.sin(x * 0.05 + z * 0.04) * 0.45 + Math.max(0, (Math.hypot(x, z) - 96) * 0.15);
    }
    return Math.max(0, (Math.hypot(x, z) - 102) * 0.18);
  };
  collisionWorld.setTerrainHeightFn(heightFn);

  // Extended terrain mesh (320m x 320m at 72x72 subdivision with multi-layer splat/slope/curvature/moisture vertex colors)
  const groundGeo = new THREE.PlaneGeometry(320, 320, 72, 72);
  groundGeo.rotateX(-Math.PI / 2);
  const posAttr = groundGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    posAttr.setY(i, heightFn(vx, vz));
  }
  groundGeo.computeVertexNormals();

  // Compute multi-layer splat / slope / moisture / debris vertex color modulation
  const normAttr = groundGeo.attributes.normal;
  const colorArr = new Float32Array(posAttr.count * 3);
  const cBase = new THREE.Color(visualProfile.terrainSplatLayers.baseLayerColor);
  const cSlope = new THREE.Color(visualProfile.terrainSplatLayers.slopeRockColor);
  const cMoist = new THREE.Color(visualProfile.terrainSplatLayers.moisturePathColor);
  const cDebris = new THREE.Color(visualProfile.terrainSplatLayers.debrisHighlightColor);
  const cWork = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const vz = posAttr.getZ(i);
    const ny = normAttr.getY(i);
    const slopeFactor = Math.min(1, Math.max(0, (1 - ny) * 3.8));
    const moistureFactor =
      mapId === 'jungle_zone'
        ? Math.max(0, 1 - Math.abs(vz - 16) / 14)
        : Math.max(0, 1 - Math.abs(Math.abs(vx) - 10) / 8) * 0.65;
    const microNoise = 0.5 + 0.5 * Math.sin(vx * 0.17 + vz * 0.23) * Math.cos(vx * 0.11 - vz * 0.19);
    const crestFactor = Math.min(1, Math.max(0, vy / 6.0)) * microNoise;

    cWork.copy(cBase);
    cWork.lerp(cMoist, moistureFactor * 0.55);
    cWork.lerp(cSlope, slopeFactor * 0.75);
    cWork.lerp(cDebris, crestFactor * 0.42);
    // Keep brightness normalized so texture details pop cleanly
    cWork.multiplyScalar(1.18);
    colorArr[i * 3] = Math.min(1, cWork.r);
    colorArr[i * 3 + 1] = Math.min(1, cWork.g);
    colorArr[i * 3 + 2] = Math.min(1, cWork.b);
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  resourceManager.registerGeometry(groundGeo, scope, `geo_ground_${missionId}`);

  const groundPattern =
    mapId === 'desert_base'
      ? 'sand'
      : mapId === 'jungle_zone'
        ? 'jungle_ground'
        : mapId === 'industrial_complex'
          ? 'concrete'
          : 'asphalt';
  const baseGroundMat = assetManager.getSharedMaterial(`ground_${groundPattern}`, {
    pattern: groundPattern,
    repeat: [28, 28],
    roughness: missionId === 3 ? 0.42 : 0.88,
    metalness: missionId === 3 ? 0.22 : 0.05,
    color: 0xffffff,
  });
  const groundMat = baseGroundMat.clone();
  groundMat.vertexColors = true;
  groundMat.needsUpdate = true;
  resourceManager.registerMaterial(groundMat, scope);

  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  resourceManager.register('object3d', scope, () => scene.remove(groundMesh));

  // Road strip for city, desert, industrial (offset by +0.025 Y to prevent Z-fighting)
  if (mapId !== 'jungle_zone') {
    const roadGeo = new THREE.PlaneGeometry(18, 220);
    roadGeo.rotateX(-Math.PI / 2);
    resourceManager.registerGeometry(roadGeo, scope);
    const roadMat = assetManager.getSharedMaterial('road_asphalt', {
      pattern: 'asphalt',
      repeat: [2, 18],
      roughness: 0.85,
      metalness: 0.08,
      color: 0x555b62,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.position.y = 0.025;
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);
    resourceManager.register('object3d', scope, () => scene.remove(roadMesh));
  } else {
    // Jungle river water plane + 3 tactical bridges
    const riverGeo = new THREE.PlaneGeometry(260, 14);
    riverGeo.rotateX(-Math.PI / 2);
    resourceManager.registerGeometry(riverGeo, scope);
    const riverMat = assetManager.getSharedMaterial('river_water', {
      color: 0x1d4e56,
      roughness: 0.18,
      metalness: 0.45,
      transparent: true,
      opacity: 0.86,
    });
    const river = new THREE.Mesh(riverGeo, riverMat);
    river.position.set(0, -0.15, 16);
    scene.add(river);
    resourceManager.register('object3d', scope, () => scene.remove(river));

    for (const bx of [-28, 0, 28]) {
      const bridge = buildCompositeBridge(assetManager, resourceManager, scope);
      bridge.position.set(bx, 0, 16);
      chunkManager.registerObject(bridge, bx, 16, scene);
      // Bridge deck (within stepHeight so walking onto bridge is smooth)
      collisionWorld.addStaticBox({
        id: `bridge_deck_${bx}`,
        minX: bx - 4.3,
        minY: -0.5,
        minZ: 8,
        maxX: bx + 4.3,
        maxY: 0.28,
        maxZ: 24,
        layer: COLLISION_LAYER.WORLD,
        tag: 'bridge',
      });
      // Bridge left & right steel guardrails
      for (const side of [-1, 1]) {
        const rx = bx + side * 4.1;
        collisionWorld.addStaticBox({
          id: `bridge_rail_${bx}_${side > 0 ? 'R' : 'L'}`,
          minX: rx - 0.22,
          minY: 0.25,
          minZ: 8,
          maxX: rx + 0.22,
          maxY: 1.35,
          maxZ: 24,
          layer: COLLISION_LAYER.COVER,
          tag: 'cover_barrier',
        });
      }
    }
  }

  // Helper to place enterable ground-floor buildings with compound wall, doorway, window, interior, and ceiling colliders
  const placeEnterableBuilding = (
    id: string,
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    style: 'city' | 'bunker' | 'warehouse',
    damagedTop = false,
    accessibleRoof = false
  ): number => {
    const y = Math.max(0, heightFn(x, z));
    const groundH = Math.min(h, 4.0);
    const wallT = 0.5;
    const doorW = Math.min(2.6, w * 0.34);
    const doorH = Math.min(2.6, groundH - 0.45);
    const winW = Math.min(3.4, d * 0.36);
    const sillH = 1.12;
    const winTopY = Math.min(2.45, groundH - 0.4);

    const grp = buildEnterableBuildingMesh(
      w,
      h,
      d,
      groundH,
      wallT,
      doorW,
      doorH,
      winW,
      sillH,
      winTopY,
      style,
      damagedTop,
      accessibleRoof,
      assetManager,
      resourceManager,
      scope
    );
    grp.position.set(x, y, z);
    chunkManager.registerObject(grp, x, z, scene);
    grp.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        collisionWorld.physicsWorld.registerBvhMesh(child);
      }
    });

    const halfW = w * 0.5;

    const halfD = d * 0.5;
    const halfDoor = doorW * 0.5;
    const halfWin = winW * 0.5;

    // 1. Front (+Z) and Back (-Z) Walls with Centered Doorway Openings + Overhead Door Lintels
    for (const [faceLabel, zSign] of [
      ['front', 1],
      ['back', -1],
    ] as const) {
      const wallMinZ = zSign > 0 ? z + halfD - wallT : z - halfD;
      const wallMaxZ = zSign > 0 ? z + halfD : z - halfD + wallT;

      // Left wall segment
      collisionWorld.addStaticBox({
        id: `${id}_${faceLabel}_wall_L`,
        minX: x - halfW,
        minY: y,
        minZ: wallMinZ,
        maxX: x - halfDoor,
        maxY: y + groundH,
        maxZ: wallMaxZ,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_wall',
        entityId: id,
      });
      // Right wall segment
      collisionWorld.addStaticBox({
        id: `${id}_${faceLabel}_wall_R`,
        minX: x + halfDoor,
        minY: y,
        minZ: wallMinZ,
        maxX: x + halfW,
        maxY: y + groundH,
        maxZ: wallMaxZ,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_wall',
        entityId: id,
      });
      // Doorway header lintel above door opening
      collisionWorld.addStaticBox({
        id: `${id}_${faceLabel}_door_lintel`,
        minX: x - halfDoor,
        minY: y + doorH,
        minZ: wallMinZ,
        maxX: x + halfDoor,
        maxY: y + groundH,
        maxZ: wallMaxZ,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_door_lintel',
        entityId: id,
      });
    }

    // 2. Left (-X) and Right (+X) Walls with Tactical Window Sills & Lintels
    for (const [sideLabel, xSign] of [
      ['left', -1],
      ['right', 1],
    ] as const) {
      const wallMinX = xSign > 0 ? x + halfW - wallT : x - halfW;
      const wallMaxX = xSign > 0 ? x + halfW : x - halfW + wallT;

      // Rear wall segment (-Z side of window)
      collisionWorld.addStaticBox({
        id: `${id}_${sideLabel}_wall_B`,
        minX: wallMinX,
        minY: y,
        minZ: z - halfD + wallT,
        maxX: wallMaxX,
        maxY: y + groundH,
        maxZ: z - halfWin,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_wall',
        entityId: id,
      });
      // Front wall segment (+Z side of window)
      collisionWorld.addStaticBox({
        id: `${id}_${sideLabel}_wall_F`,
        minX: wallMinX,
        minY: y,
        minZ: z + halfWin,
        maxX: wallMaxX,
        maxY: y + groundH,
        maxZ: z + halfD - wallT,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_wall',
        entityId: id,
      });
      // Window lower sill (blocks walking/vehicles, provides crouch/chest cover, open above 1.12m for shooting)
      collisionWorld.addStaticBox({
        id: `${id}_${sideLabel}_window_sill`,
        minX: wallMinX,
        minY: y,
        minZ: z - halfWin,
        maxX: wallMaxX,
        maxY: y + sillH,
        maxZ: z + halfWin,
        layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.WINDOW_SILL,
        tag: 'building_window_sill',
        entityId: id,
      });
      // Window upper lintel
      collisionWorld.addStaticBox({
        id: `${id}_${sideLabel}_window_lintel`,
        minX: wallMinX,
        minY: y + winTopY,
        minZ: z - halfWin,
        maxX: wallMaxX,
        maxY: y + groundH,
        maxZ: z + halfWin,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_window_lintel',
        entityId: id,
      });
    }

    // 3. Interior Partition Wall & Tactical Cover Nodes for medium/large buildings
    if (w >= 14 && d >= 12) {
      collisionWorld.addStaticBox({
        id: `${id}_interior_partition`,
        minX: x - w * 0.22,
        minY: y,
        minZ: z - 0.24,
        maxX: x + w * 0.08,
        maxY: y + groundH - 0.1,
        maxZ: z + 0.24,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_interior_wall',
        entityId: id,
      });
      coverNodes.push(
        new THREE.Vector3(x - w * 0.15, y, z + 1.6),
        new THREE.Vector3(x + w * 0.2, y, z - 1.6)
      );
    } else {
      coverNodes.push(new THREE.Vector3(x, y, z));
    }

    // 4. Ceiling / Upper Stories Collider (starts at y + groundH - 0.15 up to full building roof y + h)
    const ceilingMinY = y + groundH - 0.15;
    const roofMaxY = accessibleRoof ? y + h : Math.max(ceilingMinY + 0.5, y + h);
    collisionWorld.addStaticBox({
      id: `${id}_ceiling_upper`,
      minX: x - halfW,
      minY: ceilingMinY,
      minZ: z - halfD,
      maxX: x + halfW,
      maxY: roofMaxY,
      maxZ: z + halfD,
      layer: COLLISION_LAYER.WORLD,
      tag: accessibleRoof ? 'elevated_deck' : 'building_ceiling',
      entityId: id,
    });

    // Only register tall non-accessible upper stories as frustum occluders so rooftops remain rendered smoothly
    if (h >= 8 && !accessibleRoof) {
      chunkManager.registerOccluder({
        minX: x - w * 0.44,
        minY: y + groundH,
        minZ: z - d * 0.44,
        maxX: x + w * 0.44,
        maxY: y + h * 0.9,
        maxZ: z + d * 0.44,
      });
    }

    globalStructureReconciliation.registerStructure({
      missionId,
      structureId: id,
      kind: 'enterable_building',
      visualKitId:
        style === 'bunker'
          ? 'kit_desert_fortified_bunker'
          : style === 'warehouse'
            ? 'kit_foundry_warehouse_hall'
            : h >= 14
              ? 'kit_urban_highrise_aa_tower'
              : 'kit_urban_concrete_midrise',
      centerX: x,
      centerZ: z,
      baseY: y,
      authoritativeWalkableSopY: accessibleRoof ? y + h : y,
      width: w,
      depth: d,
      parapetHeight: 1.15,
      surfaceIds: [],
      portalKeys: [],
      colliderIds: [
        `${id}_front_wall_L`,
        `${id}_front_wall_R`,
        `${id}_back_wall_L`,
        `${id}_back_wall_R`,
        `${id}_ceiling_upper`,
      ],
    });

    return y;
  };

  const placeSupplyCrateAt = (
    id: string,
    kx: number,
    ky: number,
    kz: number,
    kind: SustainmentStationKind = 'ammo_crate',
    maxCharges = 2
  ) => {
    const mesh =
      kind === 'med_armor_station'
        ? buildMedArmorStation(assetManager, resourceManager, scope)
        : kind === 'vehicle_service_bay'
          ? buildVehicleServiceBay(assetManager, resourceManager, scope)
          : buildSupplyCrate(assetManager, resourceManager, scope);
    mesh.position.set(kx, ky, kz);
    chunkManager.registerObject(mesh, kx, kz, scene);
    if (kind !== 'vehicle_service_bay') {
      collisionWorld.addStaticBox({
        id,
        minX: kx - 0.78,
        minY: ky,
        minZ: kz - 0.54,
        maxX: kx + 0.78,
        maxY: ky + (kind === 'med_armor_station' ? 1.48 : 0.92),
        maxZ: kz + 0.54,
        layer: COLLISION_LAYER.COVER,
        tag: 'supply_crate',
      });
    }
    supplyCrates.push({
      id,
      kind,
      maxCharges,
      position: new THREE.Vector3(kx, ky, kz),
      used: false,
      mesh,
      statusLightMesh: (mesh.userData.statusLightMesh as THREE.Mesh | undefined) ?? null,
    });
  };

  // Map-specific primary architecture, vertical structures & landmarks
  if (mapId === 'warzone_city') {
    const isNightM3 = missionId === 3;
    const buildings: Array<[number, number, number, number, number, boolean]> = [
      // 0: South-West boulevard building (M1 6.5m stair roof / M3 16m illuminated AA lift high-rise)
      [-28, 30, 14, isNightM3 ? 16.0 : 6.5, 14, true],
      // 1: South-East boulevard building (M1 22m backdrop / M3 16m illuminated AA lift high-rise)
      [28, 28, 16, isNightM3 ? 16.0 : 22, 16, isNightM3],
      // 2: Mid-North West building (M1 16m Cargo Lift high-rise / M3 6.5m stair roof)
      [-30, -8, 16, isNightM3 ? 6.5 : 16.0, 18, true],
      // 3: Mid-North East building (M1 & M3 6.5m stair overwatch roof)
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
      // M1 OP. IRON DAWN: 2-story exterior switchback rooftops on bldg 0 & bldg 3 + Cargo Lift on bldg 2 (16m)
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
      // M3 OP. NIGHTFALL: 2 illuminated 16m AA Cargo Lift towers + 2 mid-rise 6.5m stair rooftops
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
      });
    }

    // Night destructible sweeping Searchlight Towers for Mission 3 (synced with EncounterDirector!)
    if (missionId === 3) {
      const m3Towers = [
        { id: 'm3_searchlight_west', x: -18, z: -14, baseYaw: 0.45, amp: 0.72, speed: 0.65 },
        { id: 'm3_searchlight_east', x: 18, z: -16, baseYaw: -0.45, amp: 0.72, speed: 0.58 },
      ];
      for (const tw of m3Towers) {
        const ty = Math.max(0, heightFn(tw.x, tw.z));
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

    // Objective 2 targets: 2 AA Radar Relays for Mission 1
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
  } else if (mapId === 'desert_base') {
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
      accessType: 'single_ramp',
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
      accessType: 'single_ramp',
    });
    placeSupplyCrateAt('supply_m2_bunker0_roof', -28, bunkerBaseYs[0] + 6.0, -32);

    // All 4 Desert Watchtowers upgraded with 2.4m switchback stair-ramps (9.0m decks + ElevatedNavSurfaces)
    for (const [tx, tz] of [
      [-24, 14],
      [24, 12],
      [-34, -56],
      [34, -56],
    ]) {
      const ty = Math.max(0, heightFn(tx, tz));
      buildWalkableWatchtower(
        verticalCtx,
        `tower_${tx}_${tz}`,
        tx,
        tz,
        ty,
        tx < 0 ? '+x' : '-x'
      );
    }

    // 3 Destructible Fuel Storage Tanks
    [
      { x: 20, z: -42 },
      { x: 26, z: -48 },
      { x: 32, z: -42 },
    ].forEach((pos, i) => {
      const tank = buildFuelTank(assetManager, resourceManager, scope);
      tank.position.set(pos.x, 0, pos.z);
      chunkManager.registerObject(tank, pos.x, pos.z, scene);
      destructionSystem.register({
        id: `fuel_tank_${i}`,
        kind: 'fuel_tank',
        isObjectiveTarget: true,
        position: new THREE.Vector3(pos.x, 0, pos.z),
        health: 150,
        maxHealth: 150,
        state: 'INTACT',
        blastRadius: 11,
        blastDamage: 180,
        meshGroup: tank,
        collider: createDestructibleCollider(`fuel_tank_${i}`, pos.x, 0, pos.z, 2.5, 4.5, 2.5),
      });
    });
  } else if (mapId === 'jungle_zone') {
    // 2 River-Valley Walkable Watchtowers overlooking the 3 bridges
    for (const [tx, tz, side] of [
      [-18, 4, '-x'],
      [18, 4, '+x'],
    ] as const) {
      const ty = Math.max(0, heightFn(tx, tz));
      buildWalkableWatchtower(
        verticalCtx,
        `jungle_tower_${tx < 0 ? 'west' : 'east'}`,
        tx,
        tz,
        ty,
        side
      );
    }

    // Military camp huts with accessible ramps & North Command Lift
    const campConfigs: Array<[number, number, number, 'single_ramp' | 'lift_only']> = [
      [-22, -16, 5.0, 'single_ramp'],
      [22, -18, 5.0, 'single_ramp'],
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

    // Instanced dense canopy trees (60 trees in 1 InstancedMesh pair = 2 draw calls!)
    buildInstancedJungleTrees(scene, heightFn, resourceManager, collisionWorld, scope);

    // 2 Weapons Caches for Mission 4
    [
      { x: 18, z: -34 },
      { x: -16, z: -40 },
    ].forEach((pos, i) => {
      const cache = buildWeaponsCache(assetManager, resourceManager, scope);
      cache.position.set(pos.x, 0, pos.z);
      chunkManager.registerObject(cache, pos.x, pos.z, scene);
      destructionSystem.register({
        id: `cache_${i}`,
        kind: 'weapons_cache',
        isObjectiveTarget: true,
        position: new THREE.Vector3(pos.x, 0, pos.z),
        health: 140,
        maxHealth: 140,
        state: 'INTACT',
        blastRadius: 8,
        blastDamage: 150,
        meshGroup: cache,
        collider: createDestructibleCollider(`cache_${i}`, pos.x, 0, pos.z, 2.2, 2.4, 2.2),
      });
    });
  } else {
    // M5 OP. BLACKOUT — Industrial Complex: Exterior Stair Warehouses (7m), Mezzanine Skybridge (7m),
    // and Dual 3-Stop Multi-Floor Foundry Cargo Lifts (0m Ground <-> 7m Skybridge <-> 14m Rooftops)
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

    // South Foundry Exterior Stair Rooftops (+7.0m)
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
    });

    // North Foundry High-Bay Rooftops (+14.0m) connected via 3-stop lifts
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

    // Elevated Structural Steel Mezzanine Skybridge (+7.0m) spanning across central foundry lane (x = -15.6 .. +15.6)
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
    // Remove direct roof portal connections added by buildElevatedSkybridge; skybridge connects via the two 3-stop lifts at y = 7.0m!
    navPortals.splice(navPortals.length - 2, 2);

    // 3-Stop Multi-Floor Cargo Lift West (0m Ground <-> 7m Skybridge <-> 14m West Foundry Roof)
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

    // 3-Stop Multi-Floor Cargo Lift East (0m Ground <-> 7m Skybridge <-> 14m East Foundry Roof)
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

    // Connect skybridge portal links straight onto the skybridge deck at x = ±14.6
    // (Note: lift portals already target exitPos at ±14.0m on skybridgeSurf; ensure open cells in WorkerBridge!)
    void AGENT_PROFILE_ALL_INFANTRY_MASK;

    // Moving overhead industrial gantry crane with physical support pillars
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

    // 3 Explosive Industrial Munitions Containers
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

  // Tactical Cover Barriers & Cover Nodes (shared across all 4 maps) with oriented OBB collision
  const coverPositions: Array<[number, number, number]> = [
    [-8, 36, 0],
    [9, 28, 0.2],
    [-11, 10, -0.15],
    [10, 4, 0.1],
    [-10, -14, 0.15],
    [11, -20, -0.2],
    [-8, -38, 0],
    [9, -42, 0.25],
    [0, -16, 0],
    [0, 18, 0],
  ];

  // TRN-12: Dedicated starter concrete cover barrier ahead of player spawn for immediate opening cover
  if (mapId === 'warzone_city') {
    coverPositions.push(missionId === 3 ? [0, 38.2, 0] : [0, 54.2, 0]);
  } else if (mapId === 'desert_base') {
    coverPositions.push([-6, 64.2, 0]);
  } else if (mapId === 'jungle_zone') {
    coverPositions.push([0, 58.2, 0]);
  } else if (mapId === 'industrial_complex') {
    coverPositions.push([0, 60.2, 0]);
  }

  coverPositions.forEach(([cx, cz, rot], i) => {
    const cy = Math.max(0, heightFn(cx, cz));
    const barrier = buildConcreteBarrier(assetManager, resourceManager, scope);
    barrier.position.set(cx, cy, cz);
    barrier.rotation.y = rot;
    chunkManager.registerObject(barrier, cx, cz, scene);
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const hx = 2.1;
    const hz = 0.7;
    const aabbHx = hx * cos + hz * sin;
    const aabbHz = hx * sin + hz * cos;
    collisionWorld.addStaticBox({
      id: `cover_${i}`,
      minX: cx - aabbHx,
      minY: cy,
      minZ: cz - aabbHz,
      maxX: cx + aabbHx,
      maxY: cy + 1.45,
      maxZ: cz + aabbHz,
      yaw: rot,
      centerX: cx,
      centerZ: cz,
      halfExtX: hx,
      halfExtZ: hz,
      layer: COLLISION_LAYER.COVER,
      tag: 'cover_barrier',
    });
    coverNodes.push(new THREE.Vector3(cx, cy, cz + (cz > 0 ? -1.8 : 1.8)));
  });

  // Destructible Tactical Sandbag/Crate Barricades (can degrade INTACT -> DAMAGED -> DESTROYED)
  const destructibleCoverCoords: Array<[number, number]> = [
    [-4, 26],
    [5, -8],
    [-5, -24],
  ];
  destructibleCoverCoords.forEach(([dcx, dcz], i) => {
    const dcy = Math.max(0, heightFn(dcx, dcz));
    const barricade = buildConcreteBarrier(assetManager, resourceManager, scope);
    barricade.position.set(dcx, dcy, dcz);
    chunkManager.registerObject(barricade, dcx, dcz, scene);
    destructionSystem.register({
      id: `destructible_cover_${i}`,
      kind: 'destructible_barrier',
      isObjectiveTarget: false,
      position: new THREE.Vector3(dcx, dcy, dcz),
      health: 120,
      maxHealth: 120,
      state: 'INTACT',
      blastRadius: 3.5,
      blastDamage: 35,
      meshGroup: barricade,
      collider: createDestructibleCollider(`destructible_cover_${i}`, dcx, dcy, dcz, 2.1, 1.45, 0.85),
    });
    coverNodes.push(new THREE.Vector3(dcx, dcy, dcz + (dcz > 0 ? -1.8 : 1.8)));
  });

  // Destructible Wooden Supply Crate Stacks (splinter on heavy fire, adding micro-cover variety)
  const woodenCrateCoords: Array<[number, number]> = [
    [-13, 20],
    [13, -2],
    [-12, -32],
  ];
  woodenCrateCoords.forEach(([wcx, wcz], i) => {
    const wcy = Math.max(0, heightFn(wcx, wcz));
    const stack = buildWoodenSupplyStack(assetManager, resourceManager, scope);
    stack.position.set(wcx, wcy, wcz);
    chunkManager.registerObject(stack, wcx, wcz, scene);
    destructionSystem.register({
      id: `wooden_crate_${i}`,
      kind: 'wooden_crate',
      isObjectiveTarget: false,
      position: new THREE.Vector3(wcx, wcy, wcz),
      health: 65,
      maxHealth: 65,
      state: 'INTACT',
      blastRadius: 0,
      blastDamage: 0,
      meshGroup: stack,
      collider: createDestructibleCollider(`wooden_crate_${i}`, wcx, wcy, wcz, 1.25, 1.85, 0.75),
    });
  });

  // Destructible Explosive Barrels scattered tactically near combat lanes
  const barrelCoords: Array<[number, number]> = [
    [-5, 22],
    [7, 14],
    [-14, -4],
    [13, -14],
    [-7, -28],
    [8, -32],
    [15, 32],
    [-16, -48],
  ];
  barrelCoords.forEach(([bx, bz], i) => {
    const by = Math.max(0, heightFn(bx, bz));
    const barrel = buildExplosiveBarrel(assetManager, resourceManager, scope);
    barrel.position.set(bx, by, bz);
    chunkManager.registerObject(barrel, bx, bz, scene);
    destructionSystem.register({
      id: `barrel_${i}`,
      kind: 'barrel',
      isObjectiveTarget: false,
      position: new THREE.Vector3(bx, by, bz),
      health: 45,
      maxHealth: 45,
      state: 'INTACT',
      blastRadius: 7.5,
      blastDamage: 145,
      meshGroup: barrel,
      collider: createDestructibleCollider(`barrel_${i}`, bx, by, bz, 0.65, 1.5, 0.65),
    });
  });

  // Mission-tailored Tactical Sustainment Stations (Ammo Crates, Med/Armor Stations, Vehicle Repair Bays)
  const ammoCrateCoords: Array<[number, number, number]> =
    missionId === 2
      ? [
          [-8, 52, 2],
          [14, 6, 2],
          [-14, -32, 2],
        ]
      : missionId === 3
        ? [
            [-6, 36, 3],
            [12, 2, 3],
            [-12, -26, 2],
          ]
        : missionId === 4
          ? [
              [-6, 48, 2],
              [10, -4, 2],
              [-14, -30, 2],
            ]
          : missionId === 5
            ? [
                [-8, 50, 2],
                [14, 12, 2],
                [-12, -28, 3],
              ]
            : [
                [-6, 46, 2],
                [12, 2, 2],
                [-12, -30, 2],
              ];
  ammoCrateCoords.forEach(([kx, kz, charges], i) => {
    const ky = Math.max(0, heightFn(kx, kz));
    placeSupplyCrateAt(`supply_${i}`, kx, ky, kz, 'ammo_crate', charges);
  });

  const medArmorCoords: Array<[number, number]> =
    missionId === 2
      ? [
          [11, 40],
          [-12, -16],
        ]
      : missionId === 3
        ? [
            [10, 26],
            [-14, -14],
          ]
        : missionId === 4
          ? [
              [8, 34],
              [-10, -18],
            ]
          : missionId === 5
            ? [
                [10, 32],
                [-14, -12],
                [12, -46],
              ]
            : [
                [10, 34],
                [-12, -12],
              ];
  medArmorCoords.forEach(([mx, mz], i) => {
    const my = Math.max(0, heightFn(mx, mz));
    placeSupplyCrateAt(`med_station_${i}`, mx, my, mz, 'med_armor_station', 2);
  });

  // Vehicle Repair & Rearm Bays along driveable highway corridors on vehicle-active missions
  const vehicleBayCoords: Array<[number, number]> =
    missionId === 2
      ? [
          [-9, 32],
          [9, -18],
        ]
      : missionId === 5
        ? [
            [-10, 34],
            [9, -34],
          ]
        : missionId === 1 || missionId === 3
          ? [[-9, 24]]
          : [[-9, 36]];
  vehicleBayCoords.forEach(([vx, vz], i) => {
    const vy = Math.max(0, heightFn(vx, vz));
    placeSupplyCrateAt(`vehicle_bay_${i}`, vx, vy, vz, 'vehicle_service_bay', 2);
  });

  // Natural mountain/perimeter ridge ring around 116m radius so outdoor maps feel expansive
  buildPerimeterRidges(scene, mapId, assetManager, resourceManager, scope);

  // Stage 5B TRN-18: Macro / Meso / Micro Mission-Specific Environmental Composition
  buildMissionEnvironmentalStorytelling(
    missionId,
    mapId,
    scene,
    assetManager,
    resourceManager,
    chunkManager,
    animatedProps,
    scope
  );

  // Extraction Beacon for Mission 5
  let extractionBeacon: THREE.Group | null = null;
  if (missionId === 5) {
    extractionBeacon = buildExtractionBeacon(resourceManager, scope);
    extractionBeacon.position.set(0, 0, -72);
    scene.add(extractionBeacon);
    resourceManager.register('object3d', scope, () => {
      if (extractionBeacon) scene.remove(extractionBeacon);
    });
  }

  return {
    coverNodes,
    roadWaypoints,
    supplyCrates,
    animatedProps,
    extractionBeacon,
    elevatedSurfaces,
    navPortals,
    cargoLifts,
  };
}


