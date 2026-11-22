import * as THREE from 'three';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { stripCsmMaterialPatches } from '@/src/engine/ShadowCascadeController';
import { CargoLiftDefinition } from '@/src/gameplay/CargoLiftManager';
import { SustainmentStationKind } from '@/src/gameplay/SustainmentEconomyManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { MapId } from '@/src/schemas/common.schema';
import { ElevatedNavSurfaceDescriptor } from '@/src/workers/WorkerBridge';
import { NavPortalInput } from '@/src/workers/navigationCore';
import { createDestructibleCollider, DestructionSystem } from './DestructionSystem';
import { globalStructureReconciliation } from './StructureReconciliationRegistry';
import { VerticalWorldContext } from './VerticalStructuresBuilder';
import { getMissionVisualProfile } from './VisualBible';
import { WorldChunkManager } from './WorldChunkManager';
import {
  buildCompositeBridge,
  buildConcreteBarrier,
  buildEnterableBuildingMesh,
  buildExplosiveBarrel,
  buildExtractionBeacon,
  buildMissionEnvironmentalStorytelling,
  buildPerimeterRidges,
  buildSupplyCrate,
  buildMedArmorStation,
  buildVehicleServiceBay,
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
  groundMesh?: THREE.Mesh;
  roadMesh?: THREE.Mesh | null;
  colliderMeshes?: Map<string, THREE.Mesh>;
}

export interface MapPopulationContext {
  readonly mapId: MapId;
  readonly missionId: number;
  readonly scene: THREE.Scene;
  readonly assetManager: AssetManager;
  readonly resourceManager: ResourceManager;
  readonly collisionWorld: CollisionWorld;
  readonly chunkManager: WorldChunkManager;
  readonly destructionSystem: DestructionSystem;
  readonly scope: ResourceScope;
  readonly verticalCtx: VerticalWorldContext;
  readonly heightFn: (x: number, z: number) => number;
  readonly animatedProps: BuiltWorldData['animatedProps'];
  readonly navPortals: NavPortalInput[];
  placeEnterableBuilding: (
    id: string,
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    style: 'city' | 'bunker' | 'warehouse',
    damagedTop?: boolean,
    accessibleRoof?: boolean
  ) => number;
  placeSupplyCrateAt: (
    id: string,
    kx: number,
    ky: number,
    kz: number,
    kind?: SustainmentStationKind,
    maxCharges?: number
  ) => void;
}

export type MapPopulator = (ctx: MapPopulationContext) => void;

function findPrimaryMesh(obj: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  obj.traverse((child) => {
    if (!found && child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh)) {
      found = child;
    }
  });
  return found;
}

export interface WorldShellState {
  ctx: MapPopulationContext;
  coverNodes: THREE.Vector3[];
  roadWaypoints: THREE.Vector3[];
  supplyCrates: BuiltWorldData['supplyCrates'];
  animatedProps: BuiltWorldData['animatedProps'];
  elevatedSurfaces: ElevatedNavSurfaceDescriptor[];
  navPortals: NavPortalInput[];
  cargoLifts: CargoLiftDefinition[];
  groundMesh: THREE.Mesh;
  roadMesh: THREE.Mesh | null;
  colliderMeshes: Map<string, THREE.Mesh>;
}

export function createWorldShell(
  mapId: MapId,
  missionId: number,
  scene: THREE.Scene,
  assetManager: AssetManager,
  resourceManager: ResourceManager,
  collisionWorld: CollisionWorld,
  chunkManager: WorldChunkManager,
  destructionSystem: DestructionSystem
): WorldShellState {
  const scope: ResourceScope = `mission:${missionId}`;
  const coverNodes: THREE.Vector3[] = [];
  const roadWaypoints: THREE.Vector3[] =
    mapId === 'desert_base'
      ? [
          new THREE.Vector3(4, 0, 38),
          new THREE.Vector3(4, 0, 4),
          new THREE.Vector3(4, 0, -28),
          new THREE.Vector3(-4, 0, -28),
          new THREE.Vector3(-4, 0, 4),
          new THREE.Vector3(-4, 0, 38),
        ]
      : [
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
  const colliderMeshes = new Map<string, THREE.Mesh>();
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
    colliderMeshes,
  };

  // Terrain height function per map (keeps central roads flat & playable, edges rolling)
  const heightFn = (x: number, z: number): number => {
    const roadDist = Math.abs(x);
    if (mapId === 'desert_base') {
      if (roadDist <= 12) return 0;
      const t = Math.min(1, (roadDist - 12) / 10);
      const smooth = t * t * (3 - 2 * t);
      return (
        (Math.sin(x * 0.04) * Math.cos(z * 0.04) * 1.4 +
          Math.max(0, (Math.hypot(x, z) - 90) * 0.14)) *
        smooth
      );
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

  // Extended terrain mesh (320m x 320m at 128x128 subdivision for 2.5m ground fidelity matching physics heightFn)
  const groundGeo = new THREE.PlaneGeometry(320, 320, 128, 128);
  groundGeo.rotateX(-Math.PI / 2);
  const posAttr = groundGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    posAttr.setY(i, heightFn(vx, vz));
  }
  groundGeo.computeVertexNormals();

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
    const microNoise =
      0.5 + 0.5 * Math.sin(vx * 0.17 + vz * 0.23) * Math.cos(vx * 0.11 - vz * 0.19);
    const crestFactor = Math.min(1, Math.max(0, vy / 6.0)) * microNoise;

    cWork.copy(cBase);
    cWork.lerp(cMoist, moistureFactor * 0.55);
    cWork.lerp(cSlope, slopeFactor * 0.75);
    cWork.lerp(cDebris, crestFactor * 0.42);
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
  stripCsmMaterialPatches(groundMat);
  groundMat.vertexColors = true;
  groundMat.needsUpdate = true;
  resourceManager.registerMaterial(groundMat, scope);

  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  groundMesh.matrixAutoUpdate = false;
  groundMesh.updateMatrix();
  scene.add(groundMesh);
  colliderMeshes.set('__terrain__', groundMesh);
  resourceManager.register('object3d', scope, () => scene.remove(groundMesh));

  let roadMesh: THREE.Mesh | null = null;
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
    roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.position.y = 0.025;
    roadMesh.receiveShadow = true;
    roadMesh.matrixAutoUpdate = false;
    roadMesh.updateMatrix();
    scene.add(roadMesh);
    colliderMeshes.set('__road__', roadMesh);
    const createdRoad = roadMesh;
    resourceManager.register('object3d', scope, () => scene.remove(createdRoad));
  } else {
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
    river.matrixAutoUpdate = false;
    river.updateMatrix();
    scene.add(river);
    resourceManager.register('object3d', scope, () => scene.remove(river));

    for (const bx of [-28, 0, 28]) {
      const bridge = buildCompositeBridge(assetManager, resourceManager, scope);
      bridge.position.set(bx, 0, 16);
      chunkManager.registerObject(bridge, bx, 16, scene);
      const bridgeMesh = findPrimaryMesh(bridge);
      if (bridgeMesh) {
        colliderMeshes.set(`bridge_deck_${bx}`, bridgeMesh);
        colliderMeshes.set(`bridge_rail_${bx}_L`, bridgeMesh);
        colliderMeshes.set(`bridge_rail_${bx}_R`, bridgeMesh);
      }
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
    const y = heightFn(x, z);
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
    let primaryBldgMesh: THREE.Mesh | null = null;
    grp.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (!primaryBldgMesh && !(child instanceof THREE.InstancedMesh)) {
          primaryBldgMesh = child;
        }
        collisionWorld.physicsWorld.registerBvhMesh(child);
      }
    });
    if (primaryBldgMesh) {
      colliderMeshes.set(id, primaryBldgMesh);
      colliderMeshes.set(`${id}_ceiling_upper`, primaryBldgMesh);
      colliderMeshes.set(`${id}_interior_partition`, primaryBldgMesh);
      for (const f of ['front', 'back']) {
        colliderMeshes.set(`${id}_${f}_wall_L`, primaryBldgMesh);
        colliderMeshes.set(`${id}_${f}_wall_R`, primaryBldgMesh);
        colliderMeshes.set(`${id}_${f}_door_lintel`, primaryBldgMesh);
      }
      for (const s of ['left', 'right']) {
        colliderMeshes.set(`${id}_${s}_wall_B`, primaryBldgMesh);
        colliderMeshes.set(`${id}_${s}_wall_F`, primaryBldgMesh);
        colliderMeshes.set(`${id}_${s}_window_sill`, primaryBldgMesh);
        colliderMeshes.set(`${id}_${s}_window_lintel`, primaryBldgMesh);
      }
    }

    const halfW = w * 0.5;
    const halfD = d * 0.5;
    const halfDoor = doorW * 0.5;
    const halfWin = winW * 0.5;

    for (const [faceLabel, zSign] of [
      ['front', 1],
      ['back', -1],
    ] as const) {
      const wallMinZ = zSign > 0 ? z + halfD - wallT : z - halfD;
      const wallMaxZ = zSign > 0 ? z + halfD : z - halfD + wallT;

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

    for (const [sideLabel, xSign] of [
      ['left', -1],
      ['right', 1],
    ] as const) {
      const wallMinX = xSign > 0 ? x + halfW - wallT : x - halfW;
      const wallMaxX = xSign > 0 ? x + halfW : x - halfW + wallT;

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
      const crateMesh = findPrimaryMesh(mesh);
      if (crateMesh) colliderMeshes.set(id, crateMesh);
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

  const ctx: MapPopulationContext = {
    mapId,
    missionId,
    scene,
    assetManager,
    resourceManager,
    collisionWorld,
    chunkManager,
    destructionSystem,
    scope,
    verticalCtx,
    heightFn,
    animatedProps,
    navPortals,
    placeEnterableBuilding,
    placeSupplyCrateAt,
  };

  return {
    ctx,
    coverNodes,
    roadWaypoints,
    supplyCrates,
    animatedProps,
    elevatedSurfaces,
    navPortals,
    cargoLifts,
    groundMesh,
    roadMesh,
    colliderMeshes,
  };
}

export function populateCommonWorldAndFinalize(shell: WorldShellState): BuiltWorldData {
  const {
    ctx,
    coverNodes,
    roadWaypoints,
    supplyCrates,
    animatedProps,
    elevatedSurfaces,
    navPortals,
    cargoLifts,
    groundMesh,
    roadMesh,
    colliderMeshes,
  } = shell;
  const {
    mapId,
    missionId,
    scene,
    assetManager,
    resourceManager,
    collisionWorld,
    chunkManager,
    destructionSystem,
    scope,
    heightFn,
    placeSupplyCrateAt,
  } = ctx;

  // Tactical Cover Barriers & Cover Nodes (shared across all maps) with oriented OBB collision
  const coverPositions: Array<[number, number, number]> = [
    [-8, 36, 0],
    [9, 28, 0.2],
    [-11, 10, -0.15],
    [10, 4, 0.1],
    [-10, -14, 0.15],
    [11, -20, -0.2],
    [-8, -38, 0],
    [9, -42, 0.25],
    ...(mapId === 'desert_base'
      ? ([
          [-9.5, -16, 0.15],
          [9.5, 18, -0.15],
        ] as Array<[number, number, number]>)
      : ([
          [0, -16, 0],
          [0, 18, 0],
        ] as Array<[number, number, number]>)),
  ];

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
    const cy = heightFn(cx, cz);
    const barrier = buildConcreteBarrier(assetManager, resourceManager, scope);
    barrier.position.set(cx, cy, cz);
    barrier.rotation.y = rot;
    chunkManager.registerObject(barrier, cx, cz, scene);
    const barrierMesh = findPrimaryMesh(barrier);
    if (barrierMesh) colliderMeshes.set(`cover_${i}`, barrierMesh);
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

  const destructibleCoverCoords: Array<[number, number]> = [
    [-4, 26],
    [5, -8],
    [-5, -24],
  ];
  destructibleCoverCoords.forEach(([dcx, dcz], i) => {
    const dcy = heightFn(dcx, dcz);
    const barricade = buildConcreteBarrier(assetManager, resourceManager, scope);
    barricade.position.set(dcx, dcy, dcz);
    chunkManager.registerObject(barricade, dcx, dcz, scene);
    const dMesh = findPrimaryMesh(barricade);
    if (dMesh) colliderMeshes.set(`destructible_cover_${i}`, dMesh);
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

  const woodenCrateCoords: Array<[number, number]> = [
    [-13, 20],
    [13, -2],
    [-12, -32],
  ];
  woodenCrateCoords.forEach(([wcx, wcz], i) => {
    const wcy = heightFn(wcx, wcz);
    const stack = buildWoodenSupplyStack(assetManager, resourceManager, scope);
    stack.position.set(wcx, wcy, wcz);
    chunkManager.registerObject(stack, wcx, wcz, scene);
    const wMesh = findPrimaryMesh(stack);
    if (wMesh) colliderMeshes.set(`wooden_crate_${i}`, wMesh);
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
    const by = heightFn(bx, bz);
    const barrel = buildExplosiveBarrel(assetManager, resourceManager, scope);
    barrel.position.set(bx, by, bz);
    chunkManager.registerObject(barrel, bx, bz, scene);
    const bMesh = findPrimaryMesh(barrel);
    if (bMesh) colliderMeshes.set(`barrel_${i}`, bMesh);
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
    const ky = heightFn(kx, kz);
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
    const my = heightFn(mx, mz);
    placeSupplyCrateAt(`med_station_${i}`, mx, my, mz, 'med_armor_station', 2);
  });

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
    const vy = heightFn(vx, vz);
    placeSupplyCrateAt(`vehicle_bay_${i}`, vx, vy, vz, 'vehicle_service_bay', 2);
  });

  buildPerimeterRidges(scene, mapId, assetManager, resourceManager, scope);

  buildMissionEnvironmentalStorytelling(
    missionId,
    mapId,
    scene,
    assetManager,
    resourceManager,
    chunkManager,
    animatedProps,
    scope,
    collisionWorld
  );

  let extractionBeacon: THREE.Group | null = null;
  if (missionId === 5) {
    extractionBeacon = buildExtractionBeacon(resourceManager, scope);
    extractionBeacon.position.set(0, 0, -72);
    scene.add(extractionBeacon);
    resourceManager.register('object3d', scope, () => {
      if (extractionBeacon) scene.remove(extractionBeacon);
    });
  }

  globalStructureReconciliation.verifyMissionReconciliation(
    missionId,
    elevatedSurfaces,
    navPortals,
    cargoLifts,
    collisionWorld
  );

  return {
    coverNodes,
    roadWaypoints,
    supplyCrates,
    animatedProps,
    extractionBeacon,
    elevatedSurfaces,
    navPortals,
    cargoLifts,
    groundMesh,
    roadMesh,
    colliderMeshes,
  };
}
