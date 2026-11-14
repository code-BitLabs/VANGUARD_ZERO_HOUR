import * as THREE from 'three';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { MapId } from '@/src/schemas/common.schema';
import { createDestructibleCollider, DestructionSystem } from './DestructionSystem';
import { WorldChunkManager } from './WorldChunkManager';

export interface BuiltWorldData {
  coverNodes: THREE.Vector3[];
  roadWaypoints: THREE.Vector3[];
  supplyCrates: Array<{ id: string; position: THREE.Vector3; used: boolean; mesh: THREE.Group }>;
  animatedProps: Array<{ update: (elapsed: number) => void }>;
  extractionBeacon: THREE.Group | null;
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

  // Extended terrain mesh (280m x 280m so there is never an abrupt void drop-off)
  const groundGeo = new THREE.PlaneGeometry(320, 320, 48, 48);
  groundGeo.rotateX(-Math.PI / 2);
  const posAttr = groundGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    posAttr.setY(i, heightFn(vx, vz));
  }
  groundGeo.computeVertexNormals();
  resourceManager.registerGeometry(groundGeo, scope, `geo_ground_${missionId}`);

  const groundPattern =
    mapId === 'desert_base'
      ? 'sand'
      : mapId === 'jungle_zone'
        ? 'jungle_ground'
        : mapId === 'industrial_complex'
          ? 'concrete'
          : 'asphalt';
  const groundMat = assetManager.getSharedMaterial(`ground_${groundPattern}`, {
    pattern: groundPattern,
    repeat: [24, 24],
    roughness: 0.9,
    metalness: 0.05,
    color: mapId === 'desert_base' ? 0xd2b48c : mapId === 'jungle_zone' ? 0x5c7448 : 0x777c82,
  });
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
    damagedTop = false
  ) => {
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
      assetManager,
      resourceManager,
      scope
    );
    grp.position.set(x, y, z);
    chunkManager.registerObject(grp, x, z, scene);
    collisionWorld.physicsWorld.registerBvhMesh(grp.children[0] as THREE.Mesh);

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
    const roofMaxY = Math.max(ceilingMinY + 0.5, y + h);
    collisionWorld.addStaticBox({
      id: `${id}_ceiling_upper`,
      minX: x - halfW,
      minY: ceilingMinY,
      minZ: z - halfD,
      maxX: x + halfW,
      maxY: roofMaxY,
      maxZ: z + halfD,
      layer: COLLISION_LAYER.WORLD,
      tag: 'building_ceiling',
      entityId: id,
    });

    // Only register upper stories as frustum occluder so ground-floor doorway sightlines are never culled
    if (h >= 8) {
      chunkManager.registerOccluder({
        minX: x - w * 0.44,
        minY: y + groundH,
        minZ: z - d * 0.44,
        maxX: x + w * 0.44,
        maxY: y + h * 0.9,
        maxZ: z + d * 0.44,
      });
    }
  };

  // Helper to place open-leg watchtowers with 4 corner pillar colliders and an elevated deck
  const placeWatchtower = (id: string, x: number, z: number) => {
    const y = Math.max(0, heightFn(x, z));
    const grp = buildWatchtower(assetManager, resourceManager, scope);
    grp.position.set(x, y, z);
    chunkManager.registerObject(grp, x, z, scene);

    for (const [lx, lz, tagIdx] of [
      [-1.4, -1.4, 'NW'],
      [1.4, -1.4, 'NE'],
      [-1.4, 1.4, 'SW'],
      [1.4, 1.4, 'SE'],
    ] as const) {
      collisionWorld.addStaticBox({
        id: `${id}_leg_${tagIdx}`,
        minX: x + lx - 0.3,
        minY: y,
        minZ: z + lz - 0.3,
        maxX: x + lx + 0.3,
        maxY: y + 9.0,
        maxZ: z + lz + 0.3,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_pillar',
        entityId: id,
      });
    }

    // Elevated platform deck at y = 8.8..9.2m and roof at y = 10.6..12.2m
    collisionWorld.addStaticBox({
      id: `${id}_deck`,
      minX: x - 2.1,
      minY: y + 8.8,
      minZ: z - 2.1,
      maxX: x + 2.1,
      maxY: y + 9.25,
      maxZ: z + 2.1,
      layer: COLLISION_LAYER.WORLD,
      tag: 'building_ceiling',
      entityId: id,
    });
    collisionWorld.addStaticBox({
      id: `${id}_roof`,
      minX: x - 2.2,
      minY: y + 10.6,
      minZ: z - 2.2,
      maxX: x + 2.2,
      maxY: y + 12.2,
      maxZ: z + 2.2,
      layer: COLLISION_LAYER.WORLD,
      tag: 'building_roof',
      entityId: id,
    });
  };

  // Map-specific primary architecture & landmarks
  if (mapId === 'warzone_city') {
    const buildings: Array<[number, number, number, number, number]> = [
      [-28, 30, 14, 18, 14],
      [28, 28, 16, 22, 16],
      [-30, -8, 16, 24, 18],
      [30, -10, 14, 16, 16],
      [-26, -42, 18, 26, 14],
      [26, -44, 16, 20, 16],
      [-56, 8, 18, 28, 20],
      [56, 6, 18, 25, 20],
    ];
    buildings.forEach(([bx, bz, bw, bh, bd], idx) => {
      placeEnterableBuilding(`city_bldg_${idx}`, bx, bz, bw, bh, bd, 'city', idx % 2 === 0);
    });

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
    const bunkers: Array<[number, number, number, number, number]> = [
      [-28, -32, 14, 6, 12],
      [28, -36, 14, 6, 12],
      [0, -64, 24, 9, 14],
    ];
    bunkers.forEach(([bx, bz, bw, bh, bd], i) => {
      placeEnterableBuilding(`bunker_${i}`, bx, bz, bw, bh, bd, 'bunker');
    });
    // Watchtowers with open physical leg pillars
    for (const [tx, tz] of [
      [-24, 14],
      [24, 12],
      [-34, -56],
      [34, -56],
    ]) {
      placeWatchtower(`tower_${tx}_${tz}`, tx, tz);
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
    // Military camp huts
    for (const [cx, cz] of [
      [-22, -16],
      [22, -18],
      [0, -46],
    ]) {
      placeEnterableBuilding(`camp_${cx}_${cz}`, cx, cz, 10, 5, 8, 'bunker');
    }
    // Instanced dense canopy trees (64 trees in 1 InstancedMesh pair = 2 draw calls!)
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
    // Industrial Complex: Warehouses, moving overhead crane, explosive chemical containers
    const warehouses: Array<[number, number, number, number, number]> = [
      [-28, 22, 18, 12, 22],
      [28, 20, 18, 12, 22],
      [-30, -24, 20, 14, 24],
      [30, -26, 20, 14, 24],
    ];
    warehouses.forEach(([wx, wz, ww, wh, wd], i) => {
      placeEnterableBuilding(`warehouse_${i}`, wx, wz, ww, wh, wd, 'warehouse');
    });

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
    const crate = buildSupplyCrate(assetManager, resourceManager, scope);
    crate.position.set(kx, ky, kz);
    chunkManager.registerObject(crate, kx, kz, scene);
    collisionWorld.addStaticBox({
      id: `supply_${i}`,
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
      id: `supply_${i}`,
      position: new THREE.Vector3(kx, ky, kz),
      used: false,
      mesh: crate,
    });
  });

  // Natural mountain/perimeter ridge ring around 116m radius so outdoor maps feel expansive
  buildPerimeterRidges(scene, mapId, assetManager, resourceManager, scope);

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

  return { coverNodes, roadWaypoints, supplyCrates, animatedProps, extractionBeacon };
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
  assets: AssetManager,
  res: ResourceManager,
  scope: ResourceScope
): THREE.Group {
  const g = new THREE.Group();

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

  const glassMat = assets.getSharedMaterial('bldg_glass', {
    color: 0x1e293b,
    roughness: 0.15,
    metalness: 0.85,
  });

  const addBox = (
    bx: number,
    by: number,
    bz: number,
    bw: number,
    bh: number,
    bd: number,
    mat: THREE.Material
  ) => {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    res.registerGeometry(geo, scope);
    const mesh = new THREE.Mesh(geo, mat);
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
  addBox(0, 0.04, 0, w - 0.1, 0.08, d - 0.1, trimMat);

  // Front (+Z) & Back (-Z) ground-floor walls with doorway openings
  const frontBackSegW = Math.max(0.4, halfW - halfDoor);
  const lintelH = Math.max(0.25, groundH - doorH);
  for (const zSign of [-1, 1]) {
    const wz = zSign * (halfD - wallT * 0.5);
    addBox(-halfDoor - frontBackSegW * 0.5, groundH * 0.5, wz, frontBackSegW, groundH, wallT, wallMat);
    addBox(halfDoor + frontBackSegW * 0.5, groundH * 0.5, wz, frontBackSegW, groundH, wallT, wallMat);
    addBox(0, doorH + lintelH * 0.5, wz, doorW, lintelH, wallT, wallMat);
    // Door frame trim posts
    addBox(-halfDoor + 0.06, doorH * 0.5, wz, 0.12, doorH, wallT + 0.08, trimMat);
    addBox(halfDoor - 0.06, doorH * 0.5, wz, 0.12, doorH, wallT + 0.08, trimMat);
  }

  // Left (-X) & Right (+X) ground-floor walls with tactical window openings
  const sideSegD = Math.max(0.4, halfD - wallT - halfWin);
  const winLintelH = Math.max(0.25, groundH - winTopY);
  for (const xSign of [-1, 1]) {
    const wx = xSign * (halfW - wallT * 0.5);
    addBox(wx, groundH * 0.5, -halfWin - sideSegD * 0.5, wallT, groundH, sideSegD, wallMat);
    addBox(wx, groundH * 0.5, halfWin + sideSegD * 0.5, wallT, groundH, sideSegD, wallMat);
    addBox(wx, sillH * 0.5, 0, wallT, sillH, winW, wallMat);
    addBox(wx, sillH - 0.05, 0, wallT + 0.1, 0.1, winW + 0.1, trimMat);
    addBox(wx, winTopY + winLintelH * 0.5, 0, wallT, winLintelH, winW, wallMat);
  }

  // Interior partition wall for larger buildings
  if (w >= 14 && d >= 12) {
    const partW = w * 0.3;
    addBox(-w * 0.07, (groundH - 0.1) * 0.5, 0, partW, groundH - 0.1, 0.46, wallMat);
  }

  // Upper stories (above groundH) + roof parapet
  const upperH = Math.max(0.6, h - groundH);
  addBox(0, groundH + upperH * 0.5, 0, w, upperH, d, wallMat);

  const roof = addBox(0, h + 0.35, 0, w + 0.5, 0.7, d + 0.5, trimMat);
  if (damagedTop) {
    roof.rotation.z = 0.05;
  }

  // Upper-story window bands for tall buildings
  if (h >= 10) {
    const winGeo = new THREE.BoxGeometry(w * 0.76, 1.35, d + 0.12);
    res.registerGeometry(winGeo, scope);
    for (let yRow = groundH + 2.4; yRow <= h - 2.2; yRow += 3.8) {
      const win = new THREE.Mesh(winGeo, glassMat);
      win.position.y = yRow;
      g.add(win);
    }
  }

  return g;
}

function buildWatchtower(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const steel = assets.getSharedMaterial('tower_steel', {
    pattern: 'metal_plate',
    roughness: 0.48,
    metalness: 0.7,
    color: 0x4b5563,
  });
  const legGeo = new THREE.CylinderGeometry(0.18, 0.24, 9.2, 8);
  res.registerGeometry(legGeo, scope);
  for (const [lx, lz] of [
    [-1.4, -1.4],
    [1.4, -1.4],
    [-1.4, 1.4],
    [1.4, 1.4],
  ]) {
    const leg = new THREE.Mesh(legGeo, steel);
    leg.position.set(lx, 4.6, lz);
    leg.castShadow = true;
    g.add(leg);
  }
  const deckGeo = new THREE.BoxGeometry(4.2, 0.4, 4.2);
  res.registerGeometry(deckGeo, scope);
  const deck = new THREE.Mesh(deckGeo, steel);
  deck.position.y = 9.0;
  g.add(deck);

  const roofGeo = new THREE.ConeGeometry(3.2, 1.6, 4);
  res.registerGeometry(roofGeo, scope);
  const roof = new THREE.Mesh(roofGeo, steel);
  roof.position.y = 11.4;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  return g;
}

function buildMovingGantry(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const yellow = assets.getSharedMaterial('gantry_amber', {
    color: 0xd97706,
    roughness: 0.42,
    metalness: 0.62,
  });
  const beamGeo = new THREE.BoxGeometry(42, 1.2, 1.6);
  res.registerGeometry(beamGeo, scope);
  const beam = new THREE.Mesh(beamGeo, yellow);
  g.add(beam);

  const trolley = new THREE.Group();
  trolley.name = 'gantry_trolley';
  const boxGeo = new THREE.BoxGeometry(3.2, 1.8, 2.4);
  res.registerGeometry(boxGeo, scope);
  const box = new THREE.Mesh(boxGeo, yellow);
  box.position.y = -1.2;
  trolley.add(box);
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
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.52, 7.5, 7);
  const crownGeo = new THREE.ConeGeometry(3.6, 6.2, 7);
  res.registerGeometry(trunkGeo, scope);
  res.registerGeometry(crownGeo, scope);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3828, roughness: 0.95 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2d4c24, roughness: 0.85 });
  res.registerMaterial(trunkMat, scope);
  res.registerMaterial(crownMat, scope);

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
  trunks.castShadow = true;
  crowns.castShadow = true;

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
    dummy.rotation.y = angle;
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);

    dummy.position.set(x, y + 8.4 * s, z);
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);

    tint.setHSL(0.28 + (i % 4) * 0.02, 0.42, 0.24 + (i % 3) * 0.04);
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
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();

  scene.add(trunks);
  scene.add(crowns);
  res.register('object3d', scope, () => {
    scene.remove(trunks);
    scene.remove(crowns);
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
