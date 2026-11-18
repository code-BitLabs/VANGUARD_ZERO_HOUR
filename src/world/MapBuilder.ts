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

export interface BuiltWorldData {
  coverNodes: THREE.Vector3[];
  roadWaypoints: THREE.Vector3[];
  supplyCrates: Array<{ id: string; position: THREE.Vector3; used: boolean; mesh: THREE.Group }>;
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

  const placeSupplyCrateAt = (id: string, kx: number, ky: number, kz: number) => {
    const crate = buildSupplyCrate(assetManager, resourceManager, scope);
    crate.position.set(kx, ky, kz);
    chunkManager.registerObject(crate, kx, kz, scene);
    collisionWorld.addStaticBox({
      id,
      minX: kx - 0.78,
      minY: ky,
      minZ: kz - 0.54,
      maxX: kx + 0.78,
      maxY: ky + 0.92,
      maxZ: kz + 0.54,
      layer: COLLISION_LAYER.COVER,
      tag: 'supply_crate',
    });
    supplyCrates.push({
      id,
      position: new THREE.Vector3(kx, ky, kz),
      used: false,
      mesh: crate,
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

    // Night searchlights for Mission 3
    if (missionId === 3) {
      for (const sx of [-24, 24]) {
        const beamGeo = new THREE.ConeGeometry(6, 45, 16, 1, true);
        resourceManager.registerGeometry(beamGeo, scope);
        const beamMat = new THREE.MeshBasicMaterial({
          color: 0x93c5fd,
          transparent: true,
          opacity: 0.14,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        resourceManager.registerMaterial(beamMat, scope);
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(sx, 22, -22);
        beam.rotation.z = sx < 0 ? -0.35 : 0.35;
        scene.add(beam);
        resourceManager.register('object3d', scope, () => scene.remove(beam));
        animatedProps.push({
          update: (elapsed) => {
            beam.rotation.x = Math.sin(elapsed * 0.9 + sx) * 0.25;
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

  // Resupply Ammo & Armor Crates (Interact [E]) — registered with physical colliders
  const crateCoords: Array<[number, number]> = [
    [-6, 46],
    [12, 2],
    [-12, -30],
  ];
  crateCoords.forEach(([kx, kz], i) => {
    const ky = Math.max(0, heightFn(kx, kz));
    placeSupplyCrateAt(`supply_${i}`, kx, ky, kz);
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

function buildMissionEnvironmentalStorytelling(
  missionId: number,
  mapId: MapId,
  scene: THREE.Scene,
  assets: AssetManager,
  res: ResourceManager,
  chunkManager: WorldChunkManager,
  animatedProps: Array<{ update: (elapsed: number) => void }>,
  scope: ResourceScope
): void {
  const grp = new THREE.Group();
  grp.name = `mission_${missionId}_landmarks`;

  const steelMat = assets.getSharedMaterial('landmark_steel', {
    pattern: 'metal_plate',
    roughness: 0.44,
    metalness: 0.74,
    color: 0x3b4450,
  });
  const concreteMat = assets.getSharedMaterial('landmark_concrete', {
    pattern: 'concrete',
    roughness: 0.88,
    metalness: 0.08,
    color: 0x686e75,
  });
  const hazardMat = assets.getSharedMaterial('landmark_hazard', {
    pattern: 'warning_stripe',
    roughness: 0.6,
    metalness: 0.25,
  });

  const addLandmarkBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rx = 0,
    ry = 0,
    rz = 0
  ): THREE.Mesh => {
    const geo = new THREE.BoxGeometry(w, h, d);
    res.registerGeometry(geo, scope);
    const m = new THREE.Mesh(geo, mat);
    m.userData.skipBvh = true;
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };

  if (missionId === 1) {
    // M1 OP. IRON DAWN: Collapsed Elevated Overpass Span framing Northern Horizon + Burned Transit Bus + Street Gantries
    addLandmarkBox(3.4, 9.2, 3.4, -22, 4.6, -78, concreteMat);
    addLandmarkBox(3.4, 9.2, 3.4, 22, 4.6, -78, concreteMat);
    addLandmarkBox(24, 1.6, 8.5, -14, 9.4, -78, concreteMat, 0, 0, -0.14); // fractured west overpass deck
    addLandmarkBox(24, 1.6, 8.5, 14, 9.4, -78, concreteMat, 0, 0, 0.12); // fractured east overpass deck
    addLandmarkBox(18, 0.55, 0.55, 0, 8.8, -78, steelMat, 0, 0, 0.06); // exposed steel girder

    // Overhead highway directional sign gantry at z = 12 (8.2m clearance above boulevard)
    addLandmarkBox(0.45, 8.6, 0.45, -11.5, 4.3, 12, steelMat);
    addLandmarkBox(0.45, 8.6, 0.45, 11.5, 4.3, 12, steelMat);
    addLandmarkBox(24.0, 0.55, 0.55, 0, 8.4, 12, steelMat);
    const signBoardMat = assets.getSharedMaterial('m1_sign_green', {
      color: 0x14532d,
      roughness: 0.55,
      metalness: 0.25,
    });
    addLandmarkBox(9.5, 2.1, 0.2, -3.5, 8.4, 12.35, signBoardMat);
    addLandmarkBox(6.5, 1.8, 0.2, 5.2, 8.4, 12.35, hazardMat);
  } else if (missionId === 2 || mapId === 'desert_base') {
    // M2 OP. RED DUST: Twin Pressurized LNG Horton-Spheres + Overhead Refinery Pipeline Bridge + Solar Array
    const sphereGeo = new THREE.SphereGeometry(5.8, 18, 14);
    res.registerGeometry(sphereGeo, scope);
    const tankWhiteMat = assets.getSharedMaterial('m2_lng_sphere', {
      color: 0xd6cfc2,
      roughness: 0.42,
      metalness: 0.58,
    });
    for (const sx of [-48, 48]) {
      const sph = new THREE.Mesh(sphereGeo, tankWhiteMat);
      sph.userData.skipBvh = true;
      sph.position.set(sx, 7.6, -44);
      sph.castShadow = true;
      grp.add(sph);
      for (const [lx, lz] of [
        [-3.5, -3.5],
        [3.5, -3.5],
        [-3.5, 3.5],
        [3.5, 3.5],
      ]) {
        addLandmarkBox(0.55, 7.2, 0.55, sx + lx, 3.6, -44 + lz, steelMat);
      }
    }
    // Overhead twin refinery pipeline bridge at z = -18 (y = 7.8m clearance)
    addLandmarkBox(0.6, 8.0, 0.6, -18, 4.0, -18, steelMat);
    addLandmarkBox(0.6, 8.0, 0.6, 18, 4.0, -18, steelMat);
    const pipeGeo = new THREE.CylinderGeometry(0.48, 0.48, 37, 12);
    pipeGeo.rotateZ(Math.PI / 2);
    res.registerGeometry(pipeGeo, scope);
    for (const pzOff of [-0.65, 0.65]) {
      const pipe = new THREE.Mesh(pipeGeo, steelMat);
      pipe.userData.skipBvh = true;
      pipe.position.set(0, 7.6, -18 + pzOff);
      grp.add(pipe);
    }
  }

  if (missionId === 3) {
    // M3 OP. NIGHTFALL: Geodesic Radome Domes on Northern Towers + Wet Rain-Slicked Specular Boulevard Puddles + Cyan Tactical Billboards
    const radomeGeo = new THREE.IcosahedronGeometry(3.8, 1);
    res.registerGeometry(radomeGeo, scope);
    const radomeMat = assets.getSharedMaterial('m3_radome', {
      color: 0xcbd5e1,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.22,
      roughness: 0.35,
      metalness: 0.45,
    });
    for (const [rx, ry, rz] of [
      [-26, 29.5, -42],
      [26, 23.5, -44],
    ] as const) {
      const dome = new THREE.Mesh(radomeGeo, radomeMat);
      dome.userData.skipBvh = true;
      dome.position.set(rx, ry, rz);
      grp.add(dome);
    }

    // Rain-slicked specular asphalt reflection puddles along the nocturnal boulevard
    const puddleMat = assets.getSharedMaterial('m3_rain_puddle', {
      color: 0x0f172a,
      roughness: 0.05,
      metalness: 0.92,
    });
    const puddleGeo = new THREE.CircleGeometry(3.6, 16);
    puddleGeo.rotateX(-Math.PI / 2);
    res.registerGeometry(puddleGeo, scope);
    for (const [px, pz, sx, sz] of [
      [-3.5, 24, 1.4, 2.1],
      [4.2, 6, 1.2, 1.8],
      [-2.8, -12, 1.5, 2.3],
      [3.6, -32, 1.3, 1.9],
    ] as const) {
      const puddle = new THREE.Mesh(puddleGeo, puddleMat);
      puddle.userData.skipBvh = true;
      puddle.position.set(px, 0.032, pz);
      puddle.scale.set(sx, 1, sz);
      grp.add(puddle);
    }

    // Emissive cyan/amber blackout sector beacons on high-rise facades
    const neonCyan = assets.getSharedMaterial('m3_neon_cyan', {
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.15,
    });
    addLandmarkBox(0.18, 9.5, 0.45, -19.8, 10.5, 30, neonCyan);
    addLandmarkBox(0.18, 9.5, 0.45, 19.8, 10.5, 28, neonCyan);
  }

  if (missionId === 4 || mapId === 'jungle_zone') {
    // M4 OP. VIPER CANOPY: Suspension Bridge Cable Towers + Mossy River Boulders + Camo Net Canopies
    const boulderGeo = new THREE.DodecahedronGeometry(1.35, 1);
    res.registerGeometry(boulderGeo, scope);
    const mossRockMat = assets.getSharedMaterial('m4_moss_boulder', {
      color: 0x3b4d38,
      roughness: 0.92,
      metalness: 0.05,
    });
    for (const [bx, bz, s] of [
      [-14, 15.5, 1.3],
      [-9, 17.2, 0.9],
      [11, 14.8, 1.4],
      [16, 17.6, 1.0],
      [-40, 16.0, 1.5],
      [40, 15.2, 1.4],
    ] as const) {
      const rock = new THREE.Mesh(boulderGeo, mossRockMat);
      rock.userData.skipBvh = true;
      rock.position.set(bx, -0.25, bz);
      rock.scale.set(s * 1.3, s * 0.75, s);
      grp.add(rock);
    }
    // Bridge suspension arch portals on central bridge (x = 0, z = 8 & z = 24)
    for (const bz of [8.5, 23.5]) {
      addLandmarkBox(0.45, 5.8, 0.45, -4.1, 2.9, bz, steelMat);
      addLandmarkBox(0.45, 5.8, 0.45, 4.1, 2.9, bz, steelMat);
      addLandmarkBox(8.8, 0.42, 0.45, 0, 5.6, bz, steelMat);
    }
  }

  if (missionId === 5 || mapId === 'industrial_complex') {
    // M5 OP. ZERO HOUR: Twin 28m Volcanic Blast Furnace Stacks + Glowing Molten Slag Channels & Vats
    const furnaceBodyGeo = new THREE.CylinderGeometry(3.6, 4.8, 26, 16);
    const slagVatGeo = new THREE.CylinderGeometry(2.6, 2.2, 1.8, 14);
    const slagSurfaceGeo = new THREE.CircleGeometry(2.45, 14);
    slagSurfaceGeo.rotateX(-Math.PI / 2);
    res.registerGeometry(furnaceBodyGeo, scope);
    res.registerGeometry(slagVatGeo, scope);
    res.registerGeometry(slagSurfaceGeo, scope);

    const moltenMat = assets.getSharedMaterial('m5_molten_slag', {
      color: 0xff5722,
      emissive: 0xea580c,
      emissiveIntensity: 1.45,
      roughness: 0.25,
    });

    for (const fx of [-50, 50]) {
      const stack = new THREE.Mesh(furnaceBodyGeo, steelMat);
      stack.userData.skipBvh = true;
      stack.position.set(fx, 13, -32);
      stack.castShadow = true;
      grp.add(stack);

      const crownGlow = addLandmarkBox(8.2, 1.2, 8.2, fx, 25.2, -32, moltenMat);
      crownGlow.userData.skipBvh = true;
    }

    // Twin Molten Slag Cooling Vats outside central lane (x = ±22, z = -2)
    for (const vx of [-22, 22]) {
      const vat = new THREE.Mesh(slagVatGeo, steelMat);
      vat.userData.skipBvh = true;
      vat.position.set(vx, 0.9, -2);
      grp.add(vat);

      const lava = new THREE.Mesh(slagSurfaceGeo, moltenMat);
      lava.userData.skipBvh = true;
      lava.position.set(vx, 1.82, -2);
      grp.add(lava);
    }

    animatedProps.push({
      update: (elapsed) => {
        moltenMat.emissiveIntensity = 1.25 + 0.35 * Math.sin(elapsed * 3.2);
      },
    });
  }

  void chunkManager;
  scene.add(grp);
  res.register('object3d', scope, () => scene.remove(grp));
}

function buildEnterableBuildingMesh(
  w: number,
  h: number,
  d: number,
  groundH: number,
  wallT: number,
  doorW: number,
  doorH: number,
  winW: number,
  sillH: number,
  winTopY: number,
  style: 'city' | 'bunker' | 'warehouse',
  damagedTop: boolean,
  accessibleRoof: boolean,
  assets: AssetManager,
  res: ResourceManager,
  scope: ResourceScope
): THREE.Group {
  const g = new THREE.Group();
  g.name = `enterable_building_${style}`;

  const wallMat =
    style === 'bunker'
      ? assets.getSharedMaterial('bunker_sand_concrete', {
          pattern: 'concrete',
          repeat: [2, 1],
          roughness: 0.92,
          color: 0x8c7b65,
        })
      : style === 'warehouse'
        ? assets.getSharedMaterial('ind_metal', {
            pattern: 'metal_plate',
            repeat: [3, 2],
            roughness: 0.45,
            metalness: 0.72,
            color: 0x4b5560,
          })
        : assets.getSharedMaterial('bldg_concrete', {
            pattern: 'concrete',
            repeat: [3, 4],
            roughness: 0.88,
            metalness: 0.08,
            color: 0x6c727a,
          });

  const trimMat =
    style === 'warehouse'
      ? assets.getSharedMaterial('ind_stripe', {
          pattern: 'warning_stripe',
          repeat: [4, 1],
          roughness: 0.65,
          metalness: 0.25,
        })
      : assets.getSharedMaterial('bldg_steel', {
          pattern: 'metal_plate',
          repeat: [2, 2],
          roughness: 0.45,
          metalness: 0.72,
          color: 0x333b44,
        });

  const structuralMat = assets.getSharedMaterial('bldg_weathered_structural', {
    pattern: 'weathered_structural',
    repeat: [2, 3],
    roughness: 0.62,
    metalness: 0.48,
    color: style === 'bunker' ? 0x6d6356 : 0x47515c,
  });

  const glassMat = assets.getSharedMaterial('bldg_glass', {
    color: 0x1e293b,
    roughness: 0.15,
    metalness: 0.85,
  });

  // Geometry cache scoped to this building to prevent redundant BoxGeometry allocations
  const localGeoCache = new Map<string, THREE.BoxGeometry>();
  const getBoxGeo = (bw: number, bh: number, bd: number): THREE.BoxGeometry => {
    const key = `${bw.toFixed(3)}_${bh.toFixed(3)}_${bd.toFixed(3)}`;
    let geo = localGeoCache.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(bw, bh, bd);
      res.registerGeometry(geo, scope);
      localGeoCache.set(key, geo);
    }
    return geo;
  };

  const addBox = (
    bx: number,
    by: number,
    bz: number,
    bw: number,
    bh: number,
    bd: number,
    mat: THREE.Material,
    name?: string,
    skipBvh = false
  ) => {
    const geo = getBoxGeo(bw, bh, bd);
    const mesh = new THREE.Mesh(geo, mat);
    if (name) mesh.name = name;
    if (skipBvh) mesh.userData.skipBvh = true;
    mesh.position.set(bx, by, bz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  const halfW = w * 0.5;
  const halfD = d * 0.5;
  const halfDoor = doorW * 0.5;
  const halfWin = winW * 0.5;

  // Interior floor slab
  addBox(0, 0.04, 0, w - 0.1, 0.08, d - 0.1, trimMat, 'interior_floor');

  // Front (+Z) & Back (-Z) ground-floor walls with doorway openings, jamb frames, headers & interior baseboards
  const frontBackSegW = Math.max(0.4, halfW - halfDoor);
  const lintelH = Math.max(0.25, groundH - doorH);
  const baseboardH = 0.16;
  const baseboardT = 0.05;
  for (const zSign of [-1, 1]) {
    const wz = zSign * (halfD - wallT * 0.5);
    addBox(-halfDoor - frontBackSegW * 0.5, groundH * 0.5, wz, frontBackSegW, groundH, wallT, wallMat);
    addBox(halfDoor + frontBackSegW * 0.5, groundH * 0.5, wz, frontBackSegW, groundH, wallT, wallMat);
    addBox(0, doorH + lintelH * 0.5, wz, doorW, lintelH, wallT, wallMat);
    // Door frame jamb posts & structural header beam (strictly outside clear doorway opening)
    addBox(-halfDoor - 0.07, doorH * 0.5, wz, 0.14, doorH, wallT + 0.1, structuralMat, 'door_frame_jamb');
    addBox(halfDoor + 0.07, doorH * 0.5, wz, 0.14, doorH, wallT + 0.1, structuralMat, 'door_frame_jamb');
    addBox(0, doorH + 0.11, wz, doorW + 0.36, 0.22, wallT + 0.14, structuralMat, 'door_header_beam');

    // Exterior tactical doorway canopy hood above lintel
    addBox(0, doorH + 0.32, wz + zSign * 0.38, doorW + 0.8, 0.14, 0.65, structuralMat, 'door_canopy_hood', true);

    // Interior baseboard along left/right wall segments (flush with inner wall face)
    const innerZ = zSign * (halfD - wallT - baseboardT * 0.5);
    const segBaseW = Math.max(0.25, frontBackSegW - wallT);
    addBox(
      -halfDoor - segBaseW * 0.5 - 0.1,
      baseboardH * 0.5 + 0.08,
      innerZ,
      segBaseW,
      baseboardH,
      baseboardT,
      structuralMat,
      'interior_baseboard'
    );
    addBox(
      halfDoor + segBaseW * 0.5 + 0.1,
      baseboardH * 0.5 + 0.08,
      innerZ,
      segBaseW,
      baseboardH,
      baseboardT,
      structuralMat,
      'interior_baseboard'
    );
  }

  // Left (-X) & Right (+X) ground-floor walls with tactical window openings, window casings & interior baseboards
  const sideSegD = Math.max(0.4, halfD - wallT - halfWin);
  const winLintelH = Math.max(0.25, groundH - winTopY);
  const winOpenH = Math.max(0.4, winTopY - sillH);
  for (const xSign of [-1, 1]) {
    const wx = xSign * (halfW - wallT * 0.5);
    addBox(wx, groundH * 0.5, -halfWin - sideSegD * 0.5, wallT, groundH, sideSegD, wallMat);
    addBox(wx, groundH * 0.5, halfWin + sideSegD * 0.5, wallT, groundH, sideSegD, wallMat);
    addBox(wx, sillH * 0.5, 0, wallT, sillH, winW, wallMat);
    addBox(wx, sillH - 0.05, 0, wallT + 0.16, 0.12, winW + 0.24, trimMat, 'window_sill_ledge');
    addBox(wx, winTopY + winLintelH * 0.5, 0, wallT, winLintelH, winW, wallMat);
    // Window side casing mullions & header trim (leaves tactical window opening 100% unobstructed)
    addBox(wx, sillH + winOpenH * 0.5, -halfWin - 0.06, wallT + 0.08, winOpenH, 0.12, structuralMat, 'window_mullion');
    addBox(wx, sillH + winOpenH * 0.5, halfWin + 0.06, wallT + 0.08, winOpenH, 0.12, structuralMat, 'window_mullion');
    addBox(wx, winTopY + 0.07, 0, wallT + 0.12, 0.16, winW + 0.32, structuralMat, 'window_header');

    // Continuous interior baseboard along side wall inner face
    const innerX = xSign * (halfW - wallT - baseboardT * 0.5);
    addBox(
      innerX,
      baseboardH * 0.5 + 0.08,
      0,
      baseboardT,
      baseboardH,
      Math.max(1.0, d - wallT * 2 - 0.1),
      structuralMat,
      'interior_baseboard'
    );
  }

  // Four exterior structural corner pilasters + style-specific facade buttresses / H-columns
  const pilasterSize = style === 'bunker' ? 0.52 : 0.38;
  for (const xSign of [-1, 1]) {
    for (const zSign of [-1, 1]) {
      addBox(
        xSign * (halfW - pilasterSize * 0.35),
        h * 0.5,
        zSign * (halfD - pilasterSize * 0.35),
        pilasterSize,
        h,
        pilasterSize,
        structuralMat,
        'corner_pilaster'
      );
    }
  }

  // Mid-elevation structural stringcourse band separating ground story from upper stories
  addBox(0, groundH + 0.06, 0, w + 0.28, 0.22, d + 0.28, structuralMat, 'story_cornice_band');

  // Style-specific upper facade articulation (HVAC units, structural ribs, ventilation louvers)
  if (style === 'city' && h >= 6) {
    for (const zSign of [-1, 1]) {
      addBox(
        -w * 0.28,
        groundH + 1.35,
        zSign * (halfD + 0.24),
        1.1,
        0.78,
        0.48,
        structuralMat,
        'facade_hvac_unit',
        true
      );
      addBox(
        w * 0.28,
        groundH + 1.35,
        zSign * (halfD + 0.24),
        1.1,
        0.78,
        0.48,
        structuralMat,
        'facade_hvac_unit',
        true
      );
    }
  } else if (style === 'warehouse') {
    for (const zOff of [-d * 0.28, d * 0.28]) {
      for (const xSign of [-1, 1]) {
        addBox(
          xSign * (halfW + 0.12),
          h * 0.5,
          zOff,
          0.26,
          h,
          0.32,
          structuralMat,
          'warehouse_h_column',
          true
        );
      }
    }
  }

  // Interior partition wall & structural column trim for larger buildings
  if (w >= 14 && d >= 12) {
    const partW = w * 0.3;
    addBox(-w * 0.07, (groundH - 0.1) * 0.5, 0, partW, groundH - 0.1, 0.46, wallMat);
    addBox(-w * 0.07 + partW * 0.5, (groundH - 0.1) * 0.5, 0, 0.22, groundH - 0.1, 0.54, structuralMat, 'structural_column');
  }

  // Upper stories (above groundH) + optional decorative roof cap (skipped when rooftop is walkable!)
  const upperH = Math.max(0.6, h - groundH);
  addBox(0, groundH + upperH * 0.5, 0, w, upperH, d, wallMat);

  if (!accessibleRoof) {
    const roof = addBox(0, h + 0.35, 0, w + 0.5, 0.7, d + 0.5, trimMat, 'roof_parapet');
    const cornice = addBox(0, h + 0.72, 0, w + 0.76, 0.18, d + 0.76, structuralMat, 'roof_cornice');
    // Rooftop mechanical penthouse & comms mast on non-walkable roofs
    addBox(w * 0.18, h + 1.45, -d * 0.15, w * 0.32, 1.5, d * 0.32, structuralMat, 'roof_penthouse', true);
    if (damagedTop) {
      roof.rotation.z = 0.05;
      cornice.rotation.z = 0.05;
    }
  } else {
    // Walkable rooftop non-slip deck finish flush at y = h
    addBox(0, h - 0.04, 0, w - 0.04, 0.08, d - 0.04, trimMat, 'walkable_roof_deck');
  }

  // Upper-story window bands + vertical mullions for tall buildings
  if (h >= 10) {
    const winBandW = w * 0.76;
    for (let yRow = groundH + 2.4; yRow <= h - 2.2; yRow += 3.8) {
      addBox(0, yRow, 0, winBandW, 1.35, d + 0.12, glassMat, 'upper_window_band');
      for (const mx of [-winBandW * 0.28, 0, winBandW * 0.28]) {
        addBox(mx, yRow, 0, 0.16, 1.42, d + 0.18, structuralMat, 'upper_window_mullion');
      }
    }
  }

  return g;
}

function buildMovingGantry(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const yellow = assets.getSharedMaterial('gantry_amber', {
    color: 0xd97706,
    roughness: 0.42,
    metalness: 0.62,
  });
  const steel = assets.getSharedMaterial('gantry_steel', {
    color: 0x334155,
    roughness: 0.48,
    metalness: 0.75,
  });
  const beamGeo = new THREE.BoxGeometry(42, 1.2, 1.6);
  res.registerGeometry(beamGeo, scope);
  const beam = new THREE.Mesh(beamGeo, yellow);
  g.add(beam);

  const trolley = new THREE.Group();
  trolley.name = 'gantry_trolley';
  const boxGeo = new THREE.BoxGeometry(3.2, 1.8, 2.4);
  const cableGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8);
  const ladleGeo = new THREE.CylinderGeometry(1.1, 0.85, 1.6, 12);
  res.registerGeometry(boxGeo, scope);
  res.registerGeometry(cableGeo, scope);
  res.registerGeometry(ladleGeo, scope);
  const box = new THREE.Mesh(boxGeo, yellow);
  box.position.y = -1.2;
  const cable = new THREE.Mesh(cableGeo, steel);
  cable.position.y = -3.4;
  const ladle = new THREE.Mesh(ladleGeo, steel);
  ladle.position.y = -5.2;
  trolley.add(box, cable, ladle);
  g.add(trolley);
  return g;
}

function buildCompositeBridge(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const wood = assets.getSharedMaterial('bridge_wood', {
    pattern: 'crate_wood',
    repeat: [2, 6],
    roughness: 0.85,
  });
  const steel = assets.getSharedMaterial('bridge_steel', {
    color: 0x374151,
    roughness: 0.5,
    metalness: 0.7,
  });
  const deckGeo = new THREE.BoxGeometry(8.6, 0.45, 16);
  res.registerGeometry(deckGeo, scope);
  const deck = new THREE.Mesh(deckGeo, wood);
  deck.position.y = 0.15;
  deck.receiveShadow = true;
  g.add(deck);

  const railGeo = new THREE.BoxGeometry(0.25, 1.1, 16);
  res.registerGeometry(railGeo, scope);
  for (const rx of [-4.1, 4.1]) {
    const rail = new THREE.Mesh(railGeo, steel);
    rail.position.set(rx, 0.75, 0);
    g.add(rail);
  }
  return g;
}

function buildConcreteBarrier(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const mat = assets.getSharedMaterial('barrier_concrete', {
    pattern: 'concrete',
    roughness: 0.9,
    color: 0x7c8288,
  });
  const stripe = assets.getSharedMaterial('barrier_stripe', {
    pattern: 'warning_stripe',
    roughness: 0.7,
  });
  const baseGeo = new THREE.BoxGeometry(4.2, 0.5, 1.4);
  res.registerGeometry(baseGeo, scope);
  const base = new THREE.Mesh(baseGeo, mat);
  base.position.y = 0.25;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  const topGeo = new THREE.BoxGeometry(4.0, 0.9, 0.75);
  res.registerGeometry(topGeo, scope);
  const top = new THREE.Mesh(topGeo, mat);
  top.position.y = 0.95;
  top.castShadow = true;
  g.add(top);

  const trimGeo = new THREE.BoxGeometry(3.8, 0.22, 0.8);
  res.registerGeometry(trimGeo, scope);
  const trim = new THREE.Mesh(trimGeo, stripe);
  trim.position.y = 1.2;
  g.add(trim);
  return g;
}

function buildExplosiveBarrel(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const red = assets.getSharedMaterial('barrel_red', {
    color: 0xb91c1c,
    roughness: 0.42,
    metalness: 0.55,
  });
  const band = assets.getSharedMaterial('barrel_band', {
    color: 0xf59e0b,
    roughness: 0.5,
    metalness: 0.3,
  });
  const cylGeo = new THREE.CylinderGeometry(0.48, 0.48, 1.35, 14);
  res.registerGeometry(cylGeo, scope);
  const cyl = new THREE.Mesh(cylGeo, red);
  cyl.position.y = 0.675;
  cyl.castShadow = true;
  g.add(cyl);

  const ringGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.22, 14);
  res.registerGeometry(ringGeo, scope);
  const ring = new THREE.Mesh(ringGeo, band);
  ring.position.y = 0.72;
  g.add(ring);
  return g;
}

function buildFuelTank(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const tankMat = assets.getSharedMaterial('fuel_tank_steel', {
    color: 0xc2410c,
    roughness: 0.38,
    metalness: 0.62,
  });
  const trimMat = assets.getSharedMaterial('fuel_tank_trim', {
    pattern: 'warning_stripe',
    roughness: 0.6,
  });
  const bodyGeo = new THREE.CylinderGeometry(2.1, 2.1, 4.2, 16);
  res.registerGeometry(bodyGeo, scope);
  const body = new THREE.Mesh(bodyGeo, tankMat);
  body.position.y = 2.1;
  body.castShadow = true;
  g.add(body);

  const domeGeo = new THREE.SphereGeometry(2.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  res.registerGeometry(domeGeo, scope);
  const dome = new THREE.Mesh(domeGeo, tankMat);
  dome.position.y = 4.2;
  g.add(dome);

  const ringGeo = new THREE.CylinderGeometry(2.16, 2.16, 0.55, 16);
  res.registerGeometry(ringGeo, scope);
  const ring = new THREE.Mesh(ringGeo, trimMat);
  ring.position.y = 1.2;
  g.add(ring);
  return g;
}

function buildRadarRelay(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const baseMat = assets.getSharedMaterial('radar_base', {
    pattern: 'metal_plate',
    color: 0x475569,
    roughness: 0.45,
    metalness: 0.72,
  });
  const dishMat = assets.getSharedMaterial('radar_dish', {
    color: 0x06b6d4,
    emissive: 0x0891b2,
    emissiveIntensity: 0.55,
    roughness: 0.3,
    metalness: 0.75,
  });
  const pedGeo = new THREE.CylinderGeometry(0.9, 1.3, 2.4, 8);
  res.registerGeometry(pedGeo, scope);
  const ped = new THREE.Mesh(pedGeo, baseMat);
  ped.position.y = 1.2;
  ped.castShadow = true;
  g.add(ped);

  const dishPivot = new THREE.Group();
  dishPivot.name = 'radar_dish';
  dishPivot.position.y = 2.8;
  const dishGeo = new THREE.CylinderGeometry(1.7, 0.4, 0.8, 12);
  dishGeo.rotateX(Math.PI / 3);
  res.registerGeometry(dishGeo, scope);
  const dish = new THREE.Mesh(dishGeo, dishMat);
  dishPivot.add(dish);
  g.add(dishPivot);
  return g;
}

function buildWeaponsCache(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const wood = assets.getSharedMaterial('cache_wood', {
    pattern: 'crate_wood',
    roughness: 0.82,
    color: 0x8b6b43,
  });
  const amber = assets.getSharedMaterial('cache_amber', {
    color: 0xf59e0b,
    emissive: 0xb45309,
    emissiveIntensity: 0.5,
  });
  const boxGeo = new THREE.BoxGeometry(3.2, 1.6, 2.4);
  res.registerGeometry(boxGeo, scope);
  const box = new THREE.Mesh(boxGeo, wood);
  box.position.y = 0.8;
  box.castShadow = true;
  g.add(box);

  const beaconGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  res.registerGeometry(beaconGeo, scope);
  const beacon = new THREE.Mesh(beaconGeo, amber);
  beacon.position.y = 1.9;
  g.add(beacon);
  return g;
}

function buildSupplyCrate(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const olive = assets.getSharedMaterial('supply_olive', {
    color: 0x3f4e37,
    roughness: 0.65,
    metalness: 0.25,
  });
  const glow = assets.getSharedMaterial('supply_cyan', {
    color: 0x06b6d4,
    emissive: 0x06b6d4,
    emissiveIntensity: 0.8,
  });
  const bodyGeo = new THREE.BoxGeometry(1.5, 0.9, 1.0);
  res.registerGeometry(bodyGeo, scope);
  const body = new THREE.Mesh(bodyGeo, olive);
  body.position.y = 0.45;
  body.castShadow = true;
  g.add(body);

  const stripGeo = new THREE.BoxGeometry(1.54, 0.14, 1.04);
  res.registerGeometry(stripGeo, scope);
  const strip = new THREE.Mesh(stripGeo, glow);
  strip.position.y = 0.72;
  g.add(strip);
  return g;
}

function buildInstancedJungleTrees(
  scene: THREE.Scene,
  heightFn: (x: number, z: number) => number,
  res: ResourceManager,
  collisionWorld: CollisionWorld,
  scope: ResourceScope
): void {
  const count = 60;
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.56, 7.8, 8);
  const crownGeo = new THREE.DodecahedronGeometry(3.6, 1);
  const subCrownGeo = new THREE.ConeGeometry(3.2, 4.4, 8);
  const fernGeo = new THREE.ConeGeometry(1.4, 1.2, 6);
  res.registerGeometry(trunkGeo, scope);
  res.registerGeometry(crownGeo, scope);
  res.registerGeometry(subCrownGeo, scope);
  res.registerGeometry(fernGeo, scope);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3828, roughness: 0.95 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2d4c24, roughness: 0.82 });
  const palmCrownMat = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.78 });
  res.registerMaterial(trunkMat, scope);
  res.registerMaterial(crownMat, scope);
  res.registerMaterial(palmCrownMat, scope);

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
  const subCrowns = new THREE.InstancedMesh(subCrownGeo, palmCrownMat, count);
  const ferns = new THREE.InstancedMesh(fernGeo, palmCrownMat, count);
  trunks.castShadow = true;
  crowns.castShadow = true;
  subCrowns.castShadow = true;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placed = 0;

  for (let i = 0; i < 120 && placed < count; i++) {
    const angle = i * 2.39996;
    const rad = 18 + (i % 14) * 6.5;
    const x = Math.cos(angle) * rad;
    const z = Math.sin(angle) * rad;
    if (Math.abs(x) < 10 || (z > 6 && z < 26)) continue;

    const y = Math.max(0, heightFn(x, z));
    const s = 0.85 + (i % 5) * 0.1;

    dummy.position.set(x, y + 3.75 * s, z);
    dummy.scale.setScalar(s);
    dummy.rotation.set((i % 3 === 0 ? 0.06 : -0.04), angle, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);

    // Upper emergent hardwood dome
    dummy.position.set(x, y + 8.1 * s, z);
    dummy.scale.set(s * 1.15, s * 0.85, s * 1.15);
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);

    // Mid-tier tropical palm/canopy skirt
    dummy.position.set(x + 0.35, y + 6.4 * s, z - 0.25);
    dummy.scale.set(s * 1.05, s * 0.9, s * 1.05);
    dummy.updateMatrix();
    subCrowns.setMatrixAt(placed, dummy.matrix);

    // Ground-level tropical fern cluster around trunk base
    dummy.position.set(x, y + 0.55, z);
    dummy.scale.set(1.2, 0.85, 1.2);
    dummy.updateMatrix();
    ferns.setMatrixAt(placed, dummy.matrix);

    tint.setHSL(0.28 + (i % 4) * 0.02, 0.46, 0.24 + (i % 3) * 0.04);
    crowns.setColorAt(placed, tint);

    collisionWorld.addStaticBox({
      id: `tree_${placed}`,
      minX: x - 0.65,
      minY: y,
      minZ: z - 0.65,
      maxX: x + 0.65,
      maxY: y + 7,
      maxZ: z + 0.65,
      layer: COLLISION_LAYER.WORLD,
    });
    placed++;
  }

  trunks.count = placed;
  crowns.count = placed;
  subCrowns.count = placed;
  ferns.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  subCrowns.instanceMatrix.needsUpdate = true;
  ferns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();
  subCrowns.computeBoundingSphere();
  ferns.computeBoundingSphere();

  scene.add(trunks, crowns, subCrowns, ferns);
  res.register('object3d', scope, () => {
    scene.remove(trunks, crowns, subCrowns, ferns);
  });
}

function buildPerimeterRidges(
  scene: THREE.Scene,
  mapId: MapId,
  assets: AssetManager,
  res: ResourceManager,
  scope: ResourceScope
): void {
  const count = 32;
  const rockGeo = new THREE.DodecahedronGeometry(11, 1);
  res.registerGeometry(rockGeo, scope);
  const rockMat = assets.getSharedMaterial(`ridge_${mapId}`, {
    color: mapId === 'desert_base' ? 0x9b7653 : mapId === 'jungle_zone' ? 0x354730 : 0x363c44,
    roughness: 0.94,
    metalness: 0.06,
  });
  const ridges = new THREE.InstancedMesh(rockGeo, rockMat, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = 126 + (i % 3) * 8;
    dummy.position.set(Math.cos(a) * r, 3 + (i % 4) * 2.5, Math.sin(a) * r);
    dummy.scale.set(1.6 + (i % 3) * 0.4, 1.2 + (i % 4) * 0.45, 1.5);
    dummy.rotation.y = a;
    dummy.updateMatrix();
    ridges.setMatrixAt(i, dummy.matrix);
  }
  ridges.instanceMatrix.needsUpdate = true;
  ridges.computeBoundingSphere();
  scene.add(ridges);
  res.register('object3d', scope, () => scene.remove(ridges));
}

function buildExtractionBeacon(res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const ringGeo = new THREE.TorusGeometry(4.5, 0.22, 8, 28);
  ringGeo.rotateX(Math.PI / 2);
  res.registerGeometry(ringGeo, scope);
  const mat = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.85 });
  res.registerMaterial(mat, scope);
  const ring = new THREE.Mesh(ringGeo, mat);
  ring.position.y = 0.3;
  g.add(ring);

  const colGeo = new THREE.CylinderGeometry(0.4, 1.6, 36, 12, 1, true);
  res.registerGeometry(colGeo, scope);
  const colMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  res.registerMaterial(colMat, scope);
  const col = new THREE.Mesh(colGeo, colMat);
  col.position.y = 18;
  g.add(col);
  return g;
}

