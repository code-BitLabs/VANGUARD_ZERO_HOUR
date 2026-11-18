import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { EnemyArchetype } from '@/src/schemas/enemy.schema';

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
  // TRN-12: Increased enemy silhouette scale and contrast for immediate target readability
  const scale = archetype === 'heavy_armor' ? 1.22 : 1.1;
  root.scale.setScalar(scale);

  const hipRestY = 0.84;

  const baseColor = new THREE.Color(accentHex);
  const armorMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor.clone().multiplyScalar(0.18),
    emissiveIntensity: 0.55,
    roughness: 0.52,
    metalness: archetype === 'heavy_armor' ? 0.58 : 0.3,
  });
  const uniformMat = new THREE.MeshStandardMaterial({
    color: 0x2b323d,
    roughness: 0.74,
    metalness: 0.14,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x3a3029, roughness: 0.82 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x181c22, metalness: 0.82, roughness: 0.32 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: archetype === 'sniper' || archetype === 'drone_operator' ? 0x22d3ee : 0xf87171,
    emissive: archetype === 'sniper' || archetype === 'drone_operator' ? 0x06b6d4 : 0xef4444,
    emissiveIntensity: 1.35,
  });
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfde047,
    transparent: true,
    opacity: 0.92,
  });

  [armorMat, uniformMat, skinMat, gunMat, visorMat, flashMat].forEach((m) =>
    resourceManager.registerMaterial(m, scope)
  );

  // Geometries registered cleanly under mission scope
  const pelvisGeo = new THREE.BoxGeometry(0.44, 0.16, 0.27);
  const torsoChestGeo = new THREE.BoxGeometry(archetype === 'heavy_armor' ? 0.58 : 0.5, 0.53, 0.31);
  const chestPlateGeo = new THREE.BoxGeometry(archetype === 'heavy_armor' ? 0.5 : 0.42, 0.36, 0.35);
  const thighGeo = new THREE.BoxGeometry(0.19, 0.42, 0.2);
  const shinGeo = new THREE.BoxGeometry(0.16, 0.34, 0.17);
  const bootGeo = new THREE.BoxGeometry(0.17, 0.1, 0.24);
  const upperArmGeo = new THREE.BoxGeometry(0.14, 0.28, 0.14);
  const forearmGeo = new THREE.BoxGeometry(0.12, 0.26, 0.12);
  const headGeo = new THREE.BoxGeometry(0.27, 0.29, 0.28);
  const helmetGeo = new THREE.BoxGeometry(0.32, 0.15, 0.33);
  const visorGeo = new THREE.BoxGeometry(0.24, 0.085, 0.065);
  const rifleBodyGeo =
    archetype === 'rocket_trooper'
      ? new THREE.CylinderGeometry(0.055, 0.055, 0.95, 10)
      : new THREE.BoxGeometry(0.07, 0.09, archetype === 'sniper' ? 0.92 : archetype === 'heavy_armor' ? 0.78 : 0.64);
  const rifleMagGeo = new THREE.BoxGeometry(0.04, 0.14, 0.065);
  const flashGeo = new THREE.OctahedronGeometry(0.09, 0);

  [
    pelvisGeo,
    torsoChestGeo,
    chestPlateGeo,
    thighGeo,
    shinGeo,
    bootGeo,
    upperArmGeo,
    forearmGeo,
    headGeo,
    helmetGeo,
    visorGeo,
    rifleBodyGeo,
    rifleMagGeo,
    flashGeo,
  ].forEach((g) => resourceManager.registerGeometry(g, scope));

  // 1. Pelvis / waist belt
  const pelvisGroup = new THREE.Group();
  pelvisGroup.position.set(0, hipRestY, 0);
  const pelvisMesh = new THREE.Mesh(pelvisGeo, uniformMat);
  pelvisMesh.position.y = 0.04;
  pelvisMesh.castShadow = true;
  pelvisGroup.add(pelvisMesh);
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
    const shin = new THREE.Mesh(shinGeo, armorMat);
    shin.position.set(0, -0.17, 0);
    shin.castShadow = true;
    const boot = new THREE.Mesh(bootGeo, gunMat);
    boot.position.set(0, -0.37, 0.035);
    boot.castShadow = true;
    knee.add(shin, boot);
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
  armorPlateMesh.castShadow = true;
  torsoGroup.add(chestMesh, armorPlateMesh);

  // Head + Helmet + Glowing Visor (child of torsoGroup)
  const headMesh = new THREE.Group();
  headMesh.position.set(0, 0.68, 0);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.castShadow = true;
  const helmet = new THREE.Mesh(helmetGeo, armorMat);
  helmet.position.set(0, 0.09, -0.01);
  helmet.castShadow = true;
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.02, 0.135);
  headMesh.add(head, helmet, visor);
  torsoGroup.add(headMesh);

  // Right Weapon Arm -> Forearm -> Weapon + MuzzleFlash
  const weaponArm = new THREE.Group();
  weaponArm.position.set(0.28, 0.52, 0.02);
  const rUpper = new THREE.Mesh(upperArmGeo, armorMat);
  rUpper.position.set(0, -0.14, 0);
  rUpper.castShadow = true;
  weaponArm.add(rUpper);

  const rightForearm = new THREE.Group();
  rightForearm.position.set(0, -0.26, 0);
  const rFore = new THREE.Mesh(forearmGeo, skinMat);
  rFore.position.set(0, -0.04, 0.13);
  rFore.rotation.x = Math.PI / 2;
  rFore.castShadow = true;
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
  rifleBody.castShadow = true;
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
  lUpper.castShadow = true;
  leftArm.add(lUpper);

  const leftForearm = new THREE.Group();
  leftForearm.position.set(0, -0.26, 0);
  const lFore = new THREE.Mesh(forearmGeo, skinMat);
  lFore.position.set(0, -0.02, 0.12);
  lFore.rotation.x = Math.PI / 2;
  lFore.castShadow = true;
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

