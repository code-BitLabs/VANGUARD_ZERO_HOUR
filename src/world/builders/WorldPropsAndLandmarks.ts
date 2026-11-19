import * as THREE from 'three';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { MapId } from '@/src/schemas/common.schema';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

export function buildMissionEnvironmentalStorytelling(
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
    // M1 OP. IRON DAWN: Collapsed Elevated Overpass Span framing Northern Horizon + Steel Highway Portal Gantry
    addLandmarkBox(3.4, 9.2, 3.4, -22, 4.6, -78, concreteMat);
    addLandmarkBox(3.4, 9.2, 3.4, 22, 4.6, -78, concreteMat);
    addLandmarkBox(24, 1.6, 8.5, -14, 9.4, -78, concreteMat, 0, 0, -0.14);
    addLandmarkBox(24, 1.6, 8.5, 14, 9.4, -78, concreteMat, 0, 0, 0.12);
    addLandmarkBox(18, 0.55, 0.55, 0, 8.8, -78, steelMat, 0, 0, 0.06);

    // Overhead steel box-truss highway gantry at z = 12 (8.2m clearance above boulevard, grounded on concrete piers)
    addLandmarkBox(1.4, 1.4, 1.4, -10.8, 0.7, 12, concreteMat);
    addLandmarkBox(1.4, 1.4, 1.4, 10.8, 0.7, 12, concreteMat);
    addLandmarkBox(0.55, 8.8, 0.55, -10.8, 5.2, 12, steelMat);
    addLandmarkBox(0.55, 8.8, 0.55, 10.8, 5.2, 12, steelMat);
    // Upper & lower box-truss chords + vertical stanchions so signage is unmistakably anchored
    addLandmarkBox(22.2, 0.36, 0.48, 0, 9.3, 12, steelMat);
    addLandmarkBox(22.2, 0.36, 0.48, 0, 7.5, 12, steelMat);
    for (const sx of [-7.8, -3.9, 0, 3.9, 7.8]) {
      addLandmarkBox(0.24, 1.8, 0.34, sx, 8.4, 12, steelMat);
    }
    const signFrameMat = assets.getSharedMaterial('m1_gantry_slate', {
      pattern: 'metal_plate',
      color: 0x26313d,
      roughness: 0.62,
      metalness: 0.45,
    });
    // Backed steel directional sign panel flush against truss with riveted mounting brackets
    addLandmarkBox(7.2, 1.55, 0.22, -2.6, 8.4, 12.26, signFrameMat);
    addLandmarkBox(7.4, 0.14, 0.28, -2.6, 9.22, 12.26, steelMat);
    addLandmarkBox(7.4, 0.14, 0.28, -2.6, 7.58, 12.26, steelMat);
    addLandmarkBox(4.8, 1.35, 0.22, 4.6, 8.4, 12.26, hazardMat);
    addLandmarkBox(5.0, 0.14, 0.28, 4.6, 9.12, 12.26, steelMat);
    addLandmarkBox(5.0, 0.14, 0.28, 4.6, 7.68, 12.26, steelMat);
  } else if (missionId === 2 || mapId === 'desert_base') {
    // M2 OP. RED DUST: Twin Pressurized LNG Horton-Spheres + Overhead Refinery Pipeline Bridge
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
    // M3 OP. NIGHTFALL: Geodesic Radome Domes + Rain-Slicked Specular Puddles + Cyan Facade Beacons
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

    const neonCyan = assets.getSharedMaterial('m3_neon_cyan', {
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.15,
    });
    addLandmarkBox(0.18, 9.5, 0.45, -19.8, 10.5, 30, neonCyan);
    addLandmarkBox(0.18, 9.5, 0.45, 19.8, 10.5, 28, neonCyan);
  }

  if (missionId === 4 || mapId === 'jungle_zone') {
    // M4 OP. VIPER CANOPY: Suspension Bridge Cable Towers + Mossy River Boulders
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
    for (const bz of [8.5, 23.5]) {
      addLandmarkBox(0.45, 5.8, 0.45, -4.1, 2.9, bz, steelMat);
      addLandmarkBox(0.45, 5.8, 0.45, 4.1, 2.9, bz, steelMat);
      addLandmarkBox(8.8, 0.42, 0.45, 0, 5.6, bz, steelMat);
    }
  }

  if (missionId === 5 || mapId === 'industrial_complex') {
    // M5 OP. ZERO HOUR: Twin 28m Volcanic Blast Furnace Stacks + Glowing Molten Slag Vats
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

export function buildEnterableBuildingMesh(
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

  addBox(0, 0.04, 0, w - 0.1, 0.08, d - 0.1, trimMat, 'interior_floor');

  const frontBackSegW = Math.max(0.4, halfW - halfDoor);
  const lintelH = Math.max(0.25, groundH - doorH);
  const baseboardH = 0.16;
  const baseboardT = 0.05;
  for (const zSign of [-1, 1]) {
    const wz = zSign * (halfD - wallT * 0.5);
    addBox(-halfDoor - frontBackSegW * 0.5, groundH * 0.5, wz, frontBackSegW, groundH, wallT, wallMat);
    addBox(halfDoor + frontBackSegW * 0.5, groundH * 0.5, wz, frontBackSegW, groundH, wallT, wallMat);
    addBox(0, doorH + lintelH * 0.5, wz, doorW, lintelH, wallT, wallMat);
    addBox(-halfDoor - 0.07, doorH * 0.5, wz, 0.14, doorH, wallT + 0.1, structuralMat, 'door_frame_jamb');
    addBox(halfDoor + 0.07, doorH * 0.5, wz, 0.14, doorH, wallT + 0.1, structuralMat, 'door_frame_jamb');
    addBox(0, doorH + 0.11, wz, doorW + 0.36, 0.22, wallT + 0.14, structuralMat, 'door_header_beam');
    addBox(0, doorH + 0.32, wz + zSign * 0.38, doorW + 0.8, 0.14, 0.65, structuralMat, 'door_canopy_hood', true);

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
    addBox(wx, sillH + winOpenH * 0.5, -halfWin - 0.06, wallT + 0.08, winOpenH, 0.12, structuralMat, 'window_mullion');
    addBox(wx, sillH + winOpenH * 0.5, halfWin + 0.06, wallT + 0.08, winOpenH, 0.12, structuralMat, 'window_mullion');
    addBox(wx, winTopY + 0.07, 0, wallT + 0.12, 0.16, winW + 0.32, structuralMat, 'window_header');

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

  addBox(0, groundH + 0.06, 0, w + 0.28, 0.22, d + 0.28, structuralMat, 'story_cornice_band');

  if (style === 'city' && h >= 6) {
    for (const zSign of [-1, 1]) {
      addBox(-w * 0.28, groundH + 1.35, zSign * (halfD + 0.24), 1.1, 0.78, 0.48, structuralMat, 'facade_hvac_unit', true);
      addBox(w * 0.28, groundH + 1.35, zSign * (halfD + 0.24), 1.1, 0.78, 0.48, structuralMat, 'facade_hvac_unit', true);
    }
  } else if (style === 'warehouse') {
    for (const zOff of [-d * 0.28, d * 0.28]) {
      for (const xSign of [-1, 1]) {
        addBox(xSign * (halfW + 0.12), h * 0.5, zOff, 0.26, h, 0.32, structuralMat, 'warehouse_h_column', true);
      }
    }
  }

  if (w >= 14 && d >= 12) {
    const partW = w * 0.3;
    addBox(-w * 0.07, (groundH - 0.1) * 0.5, 0, partW, groundH - 0.1, 0.46, wallMat);
    addBox(-w * 0.07 + partW * 0.5, (groundH - 0.1) * 0.5, 0, 0.22, groundH - 0.1, 0.54, structuralMat, 'structural_column');
  }

  const upperH = Math.max(0.6, h - groundH);
  addBox(0, groundH + upperH * 0.5, 0, w, upperH, d, wallMat);

  if (!accessibleRoof) {
    const roof = addBox(0, h + 0.35, 0, w + 0.5, 0.7, d + 0.5, trimMat, 'roof_parapet');
    const cornice = addBox(0, h + 0.72, 0, w + 0.76, 0.18, d + 0.76, structuralMat, 'roof_cornice');
    addBox(w * 0.18, h + 1.45, -d * 0.15, w * 0.32, 1.5, d * 0.32, structuralMat, 'roof_penthouse', true);
    if (damagedTop) {
      roof.rotation.z = 0.05;
      cornice.rotation.z = 0.05;
    }
  } else {
    addBox(0, h - 0.04, 0, w - 0.04, 0.08, d - 0.04, trimMat, 'walkable_roof_deck');
  }

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

export function buildMovingGantry(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
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

export function buildCompositeBridge(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
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

export function buildConcreteBarrier(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
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

export function buildExplosiveBarrel(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
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

export function buildFuelTank(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
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

export function buildRadarRelay(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
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

export function buildWeaponsCache(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
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

export function buildSupplyCrate(assets: AssetManager, res: ResourceManager, scope: ResourceScope): THREE.Group {
  const g = new THREE.Group();
  const olive = assets.getSharedMaterial('supply_olive', {
    color: 0x3f4e37,
    roughness: 0.65,
    metalness: 0.25,
  });
  const glow = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  res.registerMaterial(glow, scope);
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
  g.userData.statusLightMesh = strip;
  return g;
}

export function buildMedArmorStation(
  assets: AssetManager,
  res: ResourceManager,
  scope: ResourceScope
): THREE.Group {
  const g = new THREE.Group();
  const cabinetMat = assets.getSharedMaterial('med_station_cabinet', {
    color: 0xdbe4ee,
    roughness: 0.45,
    metalness: 0.28,
  });
  const trimMat = assets.getSharedMaterial('med_station_trim', {
    color: 0x1e293b,
    roughness: 0.55,
    metalness: 0.45,
  });
  const crossMat = assets.getSharedMaterial('med_station_cross', {
    color: 0xdc2626,
    emissive: 0x991b1b,
    emissiveIntensity: 0.35,
    roughness: 0.35,
  });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  res.registerMaterial(lightMat, scope);

  const baseGeo = new THREE.BoxGeometry(1.35, 1.38, 0.82);
  res.registerGeometry(baseGeo, scope);
  const base = new THREE.Mesh(baseGeo, cabinetMat);
  base.position.y = 0.69;
  base.castShadow = true;
  g.add(base);

  const capGeo = new THREE.BoxGeometry(1.42, 0.14, 0.88);
  res.registerGeometry(capGeo, scope);
  const cap = new THREE.Mesh(capGeo, trimMat);
  cap.position.y = 1.42;
  g.add(cap);

  const crossHGeo = new THREE.BoxGeometry(0.42, 0.12, 0.04);
  const crossVGeo = new THREE.BoxGeometry(0.12, 0.42, 0.04);
  res.registerGeometry(crossHGeo, scope);
  res.registerGeometry(crossVGeo, scope);
  for (const zSign of [-1, 1]) {
    const ch = new THREE.Mesh(crossHGeo, crossMat);
    ch.position.set(0, 0.84, zSign * 0.42);
    const cv = new THREE.Mesh(crossVGeo, crossMat);
    cv.position.set(0, 0.84, zSign * 0.42);
    g.add(ch, cv);
  }

  const lightGeo = new THREE.BoxGeometry(1.24, 0.1, 0.86);
  res.registerGeometry(lightGeo, scope);
  const lightBar = new THREE.Mesh(lightGeo, lightMat);
  lightBar.position.y = 1.24;
  g.add(lightBar);
  g.userData.statusLightMesh = lightBar;
  return g;
}

export function buildVehicleServiceBay(
  assets: AssetManager,
  res: ResourceManager,
  scope: ResourceScope
): THREE.Group {
  const g = new THREE.Group();
  const steelMat = assets.getSharedMaterial('service_bay_steel', {
    pattern: 'metal_plate',
    color: 0x334155,
    roughness: 0.52,
    metalness: 0.72,
  });
  const hazardMat = assets.getSharedMaterial('service_bay_hazard', {
    pattern: 'warning_stripe',
    roughness: 0.6,
    metalness: 0.25,
  });
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  res.registerMaterial(beaconMat, scope);

  // Drive-on steel pad (flush with road so vehicles drive freely onto it)
  const padGeo = new THREE.BoxGeometry(5.6, 0.08, 7.2);
  res.registerGeometry(padGeo, scope);
  const pad = new THREE.Mesh(padGeo, steelMat);
  pad.position.y = 0.04;
  pad.receiveShadow = true;
  pad.userData.skipBvh = true;
  g.add(pad);

  // Side repair bollards & overhead tool gantry (clearance 4.2m so APC/truck pass safely)
  const postGeo = new THREE.BoxGeometry(0.32, 4.2, 0.32);
  const railGeo = new THREE.BoxGeometry(5.8, 0.34, 0.42);
  const kerbGeo = new THREE.BoxGeometry(0.28, 0.22, 6.8);
  res.registerGeometry(postGeo, scope);
  res.registerGeometry(railGeo, scope);
  res.registerGeometry(kerbGeo, scope);

  for (const xSign of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, steelMat);
    post.position.set(xSign * 2.75, 2.1, 0);
    post.castShadow = true;
    post.userData.skipBvh = true;
    g.add(post);

    const kerb = new THREE.Mesh(kerbGeo, hazardMat);
    kerb.position.set(xSign * 2.75, 0.11, 0);
    kerb.userData.skipBvh = true;
    g.add(kerb);
  }

  const overhead = new THREE.Mesh(railGeo, steelMat);
  overhead.position.set(0, 4.25, 0);
  overhead.userData.skipBvh = true;
  g.add(overhead);

  const beaconGeo = new THREE.BoxGeometry(3.4, 0.16, 0.48);
  res.registerGeometry(beaconGeo, scope);
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.set(0, 4.02, 0);
  beacon.userData.skipBvh = true;
  g.add(beacon);
  g.userData.statusLightMesh = beacon;
  return g;
}

export function buildInstancedJungleTrees(
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
    dummy.rotation.set(i % 3 === 0 ? 0.06 : -0.04, angle, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);

    dummy.position.set(x, y + 8.1 * s, z);
    dummy.scale.set(s * 1.15, s * 0.85, s * 1.15);
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);

    dummy.position.set(x + 0.35, y + 6.4 * s, z - 0.25);
    dummy.scale.set(s * 1.05, s * 0.9, s * 1.05);
    dummy.updateMatrix();
    subCrowns.setMatrixAt(placed, dummy.matrix);

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

export function buildPerimeterRidges(
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

export function buildExtractionBeacon(res: ResourceManager, scope: ResourceScope): THREE.Group {
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
