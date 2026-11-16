import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { AirUnitType } from '@/src/schemas/mission.schema';

export interface AirRigBuild {
  root: THREE.Group;
  rotor: THREE.Object3D | null;
}

export function buildAirRig(
  type: AirUnitType,
  scope: ResourceScope,
  resourceManager: ResourceManager
): AirRigBuild {
  const root = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({
    color: type === 'attack_drone' ? 0x1e293b : type === 'gunship' ? 0x292524 : 0x374151,
    metalness: 0.72,
    roughness: 0.35,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 0.8,
  });
  resourceManager.registerMaterial(hullMat, scope);
  resourceManager.registerMaterial(accentMat, scope);

  let rotor: THREE.Object3D | null = null;

  if (type === 'attack_drone') {
    const coreGeo = new THREE.BoxGeometry(1.1, 0.35, 1.4);
    const armGeo = new THREE.BoxGeometry(2.6, 0.1, 0.14);
    const eyeGeo = new THREE.SphereGeometry(0.18, 8, 8);
    [coreGeo, armGeo, eyeGeo].forEach((g) => resourceManager.registerGeometry(g, scope));
    root.add(new THREE.Mesh(coreGeo, hullMat));
    const arms = new THREE.Mesh(armGeo, hullMat);
    arms.rotation.y = Math.PI / 4;
    const arms2 = new THREE.Mesh(armGeo, hullMat);
    arms2.rotation.y = -Math.PI / 4;
    const eye = new THREE.Mesh(eyeGeo, accentMat);
    eye.position.set(0, -0.08, 0.72);
    root.add(arms, arms2, eye);
    rotor = arms;
  } else if (type === 'fighter_jet' || type === 'transport') {
    const scale = type === 'transport' ? 1.5 : 1.0;
    const fuseGeo = new THREE.CylinderGeometry(0.65 * scale, 0.85 * scale, 8.5 * scale, 10);
    fuseGeo.rotateX(Math.PI / 2);
    const wingGeo = new THREE.BoxGeometry(9.6 * scale, 0.16, 2.4 * scale);
    const tailGeo = new THREE.BoxGeometry(0.18, 1.9 * scale, 1.5 * scale);
    [fuseGeo, wingGeo, tailGeo].forEach((g) => resourceManager.registerGeometry(g, scope));
    root.add(new THREE.Mesh(fuseGeo, hullMat));
    const wing = new THREE.Mesh(wingGeo, hullMat);
    wing.position.z = -0.4;
    const tail = new THREE.Mesh(tailGeo, hullMat);
    tail.position.set(0, 1.0 * scale, -3.4 * scale);
    const burner = new THREE.Mesh(new THREE.SphereGeometry(0.45 * scale, 8, 8), accentMat);
    resourceManager.registerGeometry(burner.geometry, scope);
    burner.position.z = -4.3 * scale;
    root.add(wing, tail, burner);
  } else {
    const scale = type === 'gunship' ? 1.45 : 1.0;
    const bodyGeo = new THREE.BoxGeometry(1.9 * scale, 1.8 * scale, 6.2 * scale);
    const boomGeo = new THREE.BoxGeometry(0.55 * scale, 0.55 * scale, 4.8 * scale);
    const wingGeo = new THREE.BoxGeometry(4.4 * scale, 0.22, 1.1 * scale);
    const bladeGeo = new THREE.BoxGeometry(9.2 * scale, 0.08, 0.35 * scale);
    [bodyGeo, boomGeo, wingGeo, bladeGeo].forEach((g) => resourceManager.registerGeometry(g, scope));

    root.add(new THREE.Mesh(bodyGeo, hullMat));
    const boom = new THREE.Mesh(boomGeo, hullMat);
    boom.position.set(0, 0.3 * scale, -4.6 * scale);
    const stubWing = new THREE.Mesh(wingGeo, hullMat);
    stubWing.position.set(0, -0.2 * scale, 0.4 * scale);
    const podL = new THREE.Mesh(new THREE.SphereGeometry(0.28 * scale, 8, 8), accentMat);
    resourceManager.registerGeometry(podL.geometry, scope);
    podL.position.set(0, -0.8 * scale, 2.4 * scale);

    const rotorGroup = new THREE.Group();
    rotorGroup.position.set(0, 1.15 * scale, 0);
    const b1 = new THREE.Mesh(bladeGeo, hullMat);
    const b2 = new THREE.Mesh(bladeGeo, hullMat);
    b2.rotation.y = Math.PI / 2;
    rotorGroup.add(b1, b2);
    rotor = rotorGroup;

    root.add(boom, stubWing, podL, rotorGroup);
  }

  return { root, rotor };
}
