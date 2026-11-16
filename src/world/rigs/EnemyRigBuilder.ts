import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { EnemyArchetype } from '@/src/schemas/enemy.schema';

export interface SoldierRigBuild {
  root: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  weaponArm: THREE.Object3D;
  headMesh: THREE.Object3D;
}

export function buildSoldierRig(
  accentHex: string,
  archetype: EnemyArchetype,
  scope: ResourceScope,
  resourceManager: ResourceManager
): SoldierRigBuild {
  const root = new THREE.Group();
  const scale = archetype === 'heavy_armor' ? 1.18 : 1.0;
  root.scale.setScalar(scale);

  const armorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    roughness: 0.65,
    metalness: archetype === 'heavy_armor' ? 0.55 : 0.25,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x332b26, roughness: 0.8 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x181c22, metalness: 0.8, roughness: 0.35 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: archetype === 'sniper' || archetype === 'drone_operator' ? 0x06b6d4 : 0xef4444,
    emissive: archetype === 'sniper' || archetype === 'drone_operator' ? 0x0891b2 : 0xb91c1c,
    emissiveIntensity: 0.85,
  });

  resourceManager.registerMaterial(armorMat, scope);
  resourceManager.registerMaterial(skinMat, scope);
  resourceManager.registerMaterial(gunMat, scope);
  resourceManager.registerMaterial(visorMat, scope);

  const torsoGeo = new THREE.BoxGeometry(0.52, 0.64, 0.32);
  const legGeo = new THREE.BoxGeometry(0.19, 0.72, 0.2);
  const headGeo = new THREE.BoxGeometry(0.28, 0.3, 0.28);
  const visorGeo = new THREE.BoxGeometry(0.24, 0.08, 0.06);
  const armGeo = new THREE.BoxGeometry(0.14, 0.14, 0.45);
  const rifleGeo = new THREE.BoxGeometry(0.08, 0.1, 0.68);
  [torsoGeo, legGeo, headGeo, visorGeo, armGeo, rifleGeo].forEach((g) =>
    resourceManager.registerGeometry(g, scope)
  );

  const torso = new THREE.Mesh(torsoGeo, armorMat);
  torso.position.y = 1.06;
  torso.castShadow = true;
  root.add(torso);

  const leftLeg = new THREE.Mesh(legGeo, armorMat);
  leftLeg.position.set(-0.14, 0.38, 0);
  leftLeg.castShadow = true;
  root.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, armorMat);
  rightLeg.position.set(0.14, 0.38, 0);
  rightLeg.castShadow = true;
  root.add(rightLeg);

  const headMesh = new THREE.Group();
  headMesh.position.set(0, 1.56, 0);
  const head = new THREE.Mesh(headGeo, armorMat);
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.02, 0.14);
  headMesh.add(head, visor);
  root.add(headMesh);

  const weaponArm = new THREE.Group();
  weaponArm.position.set(0.32, 1.24, 0.15);
  const arm = new THREE.Mesh(armGeo, skinMat);
  const rifle = new THREE.Mesh(rifleGeo, gunMat);
  rifle.position.set(-0.08, -0.02, 0.26);
  weaponArm.add(arm, rifle);
  root.add(weaponArm);

  return { root, leftLeg, rightLeg, weaponArm, headMesh };
}
