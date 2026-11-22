import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { EnemyArchetype } from '@/src/schemas/enemy.schema';
import { HOSTILE_FACTION_PALETTES } from '@/src/world/VisualBible';

export interface SoldierRigBuild {
  root: THREE.Group;
  pelvisGroup: THREE.Group;
  torsoGroup: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  weaponArm: THREE.Object3D;
  rightForearm: THREE.Group;
  leftArm: THREE.Group;
  leftForearm: THREE.Group;
  headMesh: THREE.Object3D;
  muzzleFlash: THREE.Mesh;
  hipRestY: number;
}

export function buildSoldierRig(
  accentHex: string,
  archetype: EnemyArchetype,
  scope: ResourceScope,
  resourceManager: ResourceManager
): SoldierRigBuild {
  const root = new THREE.Group();
  root.name = `enemy_rig_${archetype}`;
  // Increased enemy silhouette scale and contrast for immediate target readability
  const scale = archetype === 'heavy_armor' ? 1.22 : 1.1;
  root.scale.setScalar(scale);

  const hipRestY = 0.84;
  const palette = HOSTILE_FACTION_PALETTES[archetype];

  const baseColor = new THREE.Color(accentHex || palette.primaryArmorColorHex);
  const armorMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor.clone().multiplyScalar(0.18),
    emissiveIntensity: 0.55,
    roughness: palette.armorRoughness,
    metalness: palette.armorMetalness,
  });
  const uniformMat = new THREE.MeshStandardMaterial({
    color: palette.secondaryFabricColorHex,
    roughness: 0.74,
    metalness: 0.14,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: palette.accentIdentificationColorHex,
    roughness: 0.52,
    metalness: 0.38,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x3a3029, roughness: 0.82 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x181c22, metalness: 0.84, roughness: 0.28 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: palette.opticGlowColorHex,
    emissive: palette.opticGlowColorHex,
    emissiveIntensity: 1.4,
  });
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfde047,
    transparent: true,
    opacity: 0.92,
  });
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x05070a,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
  });

  [armorMat, uniformMat, trimMat, skinMat, gunMat, visorMat, flashMat, shadowMat].forEach((m) =>
    resourceManager.registerMaterial(m, scope)
  );

  // Geometries registered cleanly under mission scope
  const shadowGeo = new THREE.CircleGeometry(0.42, 14);
  shadowGeo.rotateX(-Math.PI / 2);
  const pelvisGeo = new THREE.BoxGeometry(0.44, 0.16, 0.27);
  const torsoChestGeo = new THREE.BoxGeometry(archetype === 'heavy_armor' ? 0.58 : 0.5, 0.53, 0.31);
  const chestPlateGeo = new THREE.BoxGeometry(archetype === 'heavy_armor' ? 0.52 : 0.42, 0.36, 0.35);
  const pouchGeo = new THREE.BoxGeometry(0.11, 0.14, 0.06);
  const thighGeo = new THREE.BoxGeometry(0.19, 0.42, 0.2);
  const kneePadGeo = new THREE.BoxGeometry(0.18, 0.11, 0.06);
  const shinGeo = new THREE.BoxGeometry(0.16, 0.34, 0.17);
  const bootGeo = new THREE.BoxGeometry(0.17, 0.1, 0.24);
  const upperArmGeo = new THREE.BoxGeometry(0.14, 0.28, 0.14);
  const pauldronGeo = new THREE.BoxGeometry(0.18, 0.16, 0.18);
  const forearmGeo = new THREE.BoxGeometry(0.12, 0.26, 0.12);
  const headGeo = new THREE.BoxGeometry(0.27, 0.29, 0.28);
  const helmetGeo = new THREE.BoxGeometry(0.32, 0.16, 0.33);
  const visorGeo = new THREE.BoxGeometry(0.24, 0.085, 0.065);
  const packGeo = new THREE.BoxGeometry(0.34, 0.38, 0.16);
  const rifleBodyGeo =
    archetype === 'rocket_trooper'
      ? new THREE.CylinderGeometry(0.058, 0.058, 0.96, 10)
      : new THREE.BoxGeometry(0.07, 0.09, archetype === 'sniper' ? 0.94 : archetype === 'heavy_armor' ? 0.8 : 0.64);
  const rifleMagGeo = new THREE.BoxGeometry(0.04, 0.14, 0.065);
  const flashGeo = new THREE.OctahedronGeometry(0.09, 0);

  [
    shadowGeo,
    pelvisGeo,
    torsoChestGeo,
    chestPlateGeo,
    pouchGeo,
    thighGeo,
    kneePadGeo,
    shinGeo,
    bootGeo,
    upperArmGeo,
    pauldronGeo,
    forearmGeo,
    headGeo,
    helmetGeo,
    visorGeo,
    packGeo,
    rifleBodyGeo,
    rifleMagGeo,
    flashGeo,
  ].forEach((g) => resourceManager.registerGeometry(g, scope));

  // Grounding contact shadow disc at y = 0.015m
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.015;
  root.add(contactShadow);

  // 1. Pelvis / waist belt (+ EOD groin plate for heavy_armor)
  const pelvisGroup = new THREE.Group();
  pelvisGroup.position.set(0, hipRestY, 0);
  const pelvisMesh = new THREE.Mesh(pelvisGeo, uniformMat);
  pelvisMesh.position.y = 0.04;
  pelvisMesh.castShadow = true;
  pelvisGroup.add(pelvisMesh);

  if (archetype === 'heavy_armor') {
    const groinPlate = new THREE.Mesh(pouchGeo, armorMat);
    groinPlate.scale.set(2.2, 1.4, 1.0);
    groinPlate.position.set(0, -0.04, 0.14);
    pelvisGroup.add(groinPlate);
  }
  root.add(pelvisGroup);

  // 2 & 3. Articulated Left & Right Legs (hip pivot at y=0.84 -> thigh 0.42m -> knee at -0.42m -> shin+boot to 0.00m)
  const buildLeg = (sideX: number) => {
    const hip = new THREE.Group();
    hip.position.set(sideX, hipRestY, 0);
    const thigh = new THREE.Mesh(thighGeo, uniformMat);
    thigh.position.set(0, -0.21, 0);
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, -0.42, 0);
    const kneePad = new THREE.Mesh(kneePadGeo, trimMat);
    kneePad.position.set(0, -0.02, 0.09);
    const shin = new THREE.Mesh(shinGeo, armorMat);
    shin.position.set(0, -0.17, 0);
    const boot = new THREE.Mesh(bootGeo, gunMat);
    boot.position.set(0, -0.37, 0.035);
    knee.add(kneePad, shin, boot);
    hip.add(knee);
    root.add(hip);
    return { hip, knee };
  };

  const leftLegBuilt = buildLeg(-0.13);
  const rightLegBuilt = buildLeg(0.13);

  // 4. Articulated Torso -> Head, Weapon Arm (+Forearm & Weapon), Left Support Arm (+Forearm)
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, hipRestY, 0);

  const chestMesh = new THREE.Mesh(torsoChestGeo, uniformMat);
  chestMesh.position.set(0, 0.34, 0);
  chestMesh.castShadow = true;
  const armorPlateMesh = new THREE.Mesh(chestPlateGeo, armorMat);
  armorPlateMesh.position.set(0, 0.36, 0.01);
  torsoGroup.add(chestMesh, armorPlateMesh);

  // Front magazine pouches on plate carrier
  for (const px of [-0.11, 0, 0.11]) {
    const pouch = new THREE.Mesh(pouchGeo, trimMat);
    pouch.position.set(px, 0.28, 0.195);
    torsoGroup.add(pouch);
  }

  // Archetype-specific dorsal backpack / silhouette hardware
  const backpack = new THREE.Mesh(packGeo, trimMat);
  backpack.position.set(0, 0.36, -0.22);
  torsoGroup.add(backpack);

  if (archetype === 'heavy_armor') {
    // Massive EOD blast collar framing head
    const collarGeo = new THREE.BoxGeometry(0.48, 0.16, 0.38);
    resourceManager.registerGeometry(collarGeo, scope);
    const collar = new THREE.Mesh(collarGeo, armorMat);
    collar.position.set(0, 0.58, 0.02);
    torsoGroup.add(collar);
  } else if (archetype === 'rocket_trooper') {
    // Dorsal 2-rocket quiver protruding above shoulders for unmistakable silhouette
    const tubeGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.52, 8);
    resourceManager.registerGeometry(tubeGeo, scope);
    for (const rx of [-0.11, 0.11]) {
      const rTube = new THREE.Mesh(tubeGeo, armorMat);
      rTube.position.set(rx, 0.54, -0.26);
      torsoGroup.add(rTube);
    }
  } else if (archetype === 'drone_operator') {
    // Dual tall EW whip antennas rising above backpack
    const antGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.72, 6);
    resourceManager.registerGeometry(antGeo, scope);
    for (const ax of [-0.14, 0.14]) {
      const ant = new THREE.Mesh(antGeo, gunMat);
      ant.position.set(ax, 0.78, -0.24);
      torsoGroup.add(ant);
      const tip = new THREE.Mesh(pouchGeo, visorMat);
      tip.scale.set(0.32, 0.32, 0.32);
      tip.position.set(ax, 1.14, -0.24);
      torsoGroup.add(tip);
    }
  } else if (archetype === 'sniper') {
    // Asymmetric ghillie drape across shoulders and back
    const capeGeo = new THREE.BoxGeometry(0.56, 0.48, 0.12);
    resourceManager.registerGeometry(capeGeo, scope);
    const cape = new THREE.Mesh(capeGeo, armorMat);
    cape.position.set(0, 0.38, -0.2);
    cape.rotation.z = 0.06;
    torsoGroup.add(cape);
  }

  // Head + Helmet + Glowing Visor (child of torsoGroup)
  const headMesh = new THREE.Group();
  headMesh.position.set(0, 0.68, 0);
  const head = new THREE.Mesh(headGeo, skinMat);
  const helmet = new THREE.Mesh(helmetGeo, armorMat);
  helmet.position.set(0, 0.09, -0.01);
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.02, 0.135);
  headMesh.add(head, helmet, visor);

  if (archetype === 'elite_assault' || archetype === 'sniper') {
    // NVG / rangefinder optics pod on helmet brow
    const nvg = new THREE.Mesh(pouchGeo, visorMat);
    nvg.scale.set(1.3, 0.55, 1.2);
    nvg.position.set(0, 0.11, 0.17);
    headMesh.add(nvg);
  }
  torsoGroup.add(headMesh);

  // Right Weapon Arm -> Forearm -> Weapon + MuzzleFlash
  const weaponArm = new THREE.Group();
  weaponArm.position.set(0.28, 0.52, 0.02);
  const rUpper = new THREE.Mesh(upperArmGeo, armorMat);
  rUpper.position.set(0, -0.14, 0);
  weaponArm.add(rUpper);

  if (archetype === 'heavy_armor' || archetype === 'elite_assault') {
    const rPauldron = new THREE.Mesh(pauldronGeo, trimMat);
    rPauldron.position.set(0.03, -0.06, 0);
    weaponArm.add(rPauldron);
  }

  const rightForearm = new THREE.Group();
  rightForearm.position.set(0, -0.26, 0);
  const rFore = new THREE.Mesh(forearmGeo, skinMat);
  rFore.position.set(0, -0.04, 0.13);
  rFore.rotation.x = Math.PI / 2;
  rightForearm.add(rFore);

  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(-0.07, -0.03, 0.3);
  const rifleBody = new THREE.Mesh(rifleBodyGeo, archetype === 'rocket_trooper' ? armorMat : gunMat);
  if (archetype === 'rocket_trooper') {
    rifleBody.rotation.x = Math.PI / 2;
    rifleBody.position.set(0, 0.06, 0.08);
  } else {
    rifleBody.position.set(0, 0, 0.1);
  }
  weaponPivot.add(rifleBody);

  if (archetype !== 'rocket_trooper') {
    const mag = new THREE.Mesh(rifleMagGeo, gunMat);
    mag.position.set(0, -0.085, 0.1);
    mag.rotation.x = 0.12;
    weaponPivot.add(mag);
  }

  const muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
  const muzzleOffsetZ = archetype === 'sniper' ? 0.6 : archetype === 'rocket_trooper' ? 0.58 : 0.45;
  muzzleFlash.position.set(0, archetype === 'rocket_trooper' ? 0.06 : 0.01, muzzleOffsetZ);
  muzzleFlash.visible = false;
  weaponPivot.add(muzzleFlash);

  rightForearm.add(weaponPivot);
  weaponArm.add(rightForearm);
  torsoGroup.add(weaponArm);

  // Left Support Arm -> Forearm
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.28, 0.52, 0.02);
  const lUpper = new THREE.Mesh(upperArmGeo, armorMat);
  lUpper.position.set(0, -0.14, 0);
  leftArm.add(lUpper);

  if (archetype === 'heavy_armor' || archetype === 'elite_assault') {
    const lPauldron = new THREE.Mesh(pauldronGeo, trimMat);
    lPauldron.position.set(-0.03, -0.06, 0);
    leftArm.add(lPauldron);
  }

  const leftForearm = new THREE.Group();
  leftForearm.position.set(0, -0.26, 0);
  const lFore = new THREE.Mesh(forearmGeo, skinMat);
  lFore.position.set(0, -0.02, 0.12);
  lFore.rotation.x = Math.PI / 2;
  leftForearm.add(lFore);
  leftArm.add(leftForearm);
  torsoGroup.add(leftArm);

  root.add(torsoGroup);

  return {
    root,
    pelvisGroup,
    torsoGroup,
    leftLeg: leftLegBuilt.hip,
    rightLeg: rightLegBuilt.hip,
    leftKnee: leftLegBuilt.knee,
    rightKnee: rightLegBuilt.knee,
    weaponArm,
    rightForearm,
    leftArm,
    leftForearm,
    headMesh,
    muzzleFlash,
    hipRestY,
  };
}
