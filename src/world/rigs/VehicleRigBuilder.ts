import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { VehicleType } from '@/src/schemas/mission.schema';

export interface VehicleRigBuild {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  turret: THREE.Object3D;
  turretGun: THREE.Object3D;
  driverSeatLocal: THREE.Vector3;
  turretOpticLocal: THREE.Vector3;
  fpvHiddenMeshes: THREE.Object3D[];
}

export function buildVehicleRig(
  type: VehicleType,
  hostile: boolean,
  scope: ResourceScope,
  resourceManager: ResourceManager
): VehicleRigBuild {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const wheels: THREE.Object3D[] = [];
  const fpvHiddenMeshes: THREE.Object3D[] = [];

  const bodyColor = hostile ? (type === 'enemy_apc' ? 0x4b3b34 : 0x57534e) : 0x3b4936;
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.65, metalness: 0.35 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.78, metalness: 0.45 });
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.88, metalness: 0.2 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: hostile ? 0xfca5a5 : 0x7dd3fc,
    emissive: hostile ? 0x450a0a : 0x0c4a6e,
    emissiveIntensity: 0.16,
    metalness: 0.15,
    roughness: 0.12,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xfde047,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.3 });

  [bodyMat, trimMat, interiorMat, tireMat, glassMat, headlightMat, gunMat].forEach((m) =>
    resourceManager.registerMaterial(m, scope)
  );

  const isHeavy = type === 'armored_truck' || type === 'enemy_apc';
  const w = isHeavy ? 2.75 : 2.28;
  const l = isHeavy ? 5.5 : 4.4;

  // Lower hull chassis frame + sloped front hood + rear cargo deck (keeps cab open & sightlines clear)
  const lowerHullGeo = new THREE.BoxGeometry(w, 0.62, l);
  const hoodGeo = new THREE.BoxGeometry(w * 0.88, 0.36, l * 0.28);
  const doorSillGeo = new THREE.BoxGeometry(0.14, 0.44, l * 0.42);
  const rearBulkheadGeo = new THREE.BoxGeometry(w * 0.9, 0.56, l * 0.26);
  const pillarGeo = new THREE.BoxGeometry(0.09, 0.92, 0.09);
  const roofGeo = new THREE.BoxGeometry(w * 0.86, 0.08, l * 0.44);
  const windGeo = new THREE.BoxGeometry(w * 0.78, 0.56, 0.05);
  const dashGeo = new THREE.BoxGeometry(w * 0.78, 0.26, 0.36);
  const seatGeo = new THREE.BoxGeometry(0.46, 0.55, 0.42);
  const wheelRimGeo = new THREE.TorusGeometry(0.17, 0.025, 8, 16);
  const lightGeo = new THREE.BoxGeometry(0.24, 0.14, 0.08);
  const wheelGeo = new THREE.CylinderGeometry(0.54, 0.54, 0.4, 14);
  wheelGeo.rotateZ(Math.PI / 2);

  [
    lowerHullGeo,
    hoodGeo,
    doorSillGeo,
    rearBulkheadGeo,
    pillarGeo,
    roofGeo,
    windGeo,
    dashGeo,
    seatGeo,
    wheelRimGeo,
    lightGeo,
    wheelGeo,
  ].forEach((g) => resourceManager.registerGeometry(g, scope));

  const lowerHull = new THREE.Mesh(lowerHullGeo, bodyMat);
  lowerHull.position.y = 0.82;
  lowerHull.castShadow = true;
  lowerHull.receiveShadow = true;
  root.add(lowerHull);

  const hood = new THREE.Mesh(hoodGeo, bodyMat);
  hood.position.set(0, 1.24, -l * 0.33);
  hood.castShadow = true;
  hood.receiveShadow = true;
  root.add(hood);

  const cabCenterZ = isHeavy ? -0.95 : -0.22;
  const cabHalfZ = l * 0.21;

  // Side door sills & interior seats/dashboard
  for (const sx of [-w * 0.43, w * 0.43]) {
    const doorSill = new THREE.Mesh(doorSillGeo, bodyMat);
    doorSill.position.set(sx, 1.32, cabCenterZ);
    doorSill.castShadow = true;
    root.add(doorSill);
  }

  const rearDeck = new THREE.Mesh(rearBulkheadGeo, bodyMat);
  rearDeck.position.set(0, 1.38, l * 0.31);
  rearDeck.castShadow = true;
  root.add(rearDeck);

  // Rollcage / A-B pillars supporting roof canopy cleanly without occluding forward windshield
  const pillarZPositions = [cabCenterZ - cabHalfZ + 0.08, cabCenterZ + cabHalfZ - 0.08];
  const pillarXPositions = [-w * 0.41, w * 0.41];
  for (const pz of pillarZPositions) {
    for (const px of pillarXPositions) {
      const pillar = new THREE.Mesh(pillarGeo, trimMat);
      pillar.position.set(px, 1.78, pz);
      pillar.castShadow = true;
      root.add(pillar);
    }
  }

  // Overhead roof plate (hidden automatically only while in Driver FPV so looking up/around stays clear)
  const roof = new THREE.Mesh(roofGeo, bodyMat);
  roof.position.set(0, 2.26, cabCenterZ);
  roof.castShadow = true;
  root.add(roof);
  fpvHiddenMeshes.push(roof);

  // Transparent armored glass windshield
  const windshield = new THREE.Mesh(windGeo, glassMat);
  windshield.position.set(0, 1.82, cabCenterZ - cabHalfZ + 0.05);
  windshield.rotation.x = 0.22;
  windshield.renderOrder = 2;
  root.add(windshield);

  // Interior dashboard, seats, and steering wheel
  const dash = new THREE.Mesh(dashGeo, interiorMat);
  dash.position.set(0, 1.36, cabCenterZ - cabHalfZ + 0.24);
  root.add(dash);

  const driverX = isHeavy ? -0.52 : -0.44;
  for (const sx of [driverX, -driverX]) {
    const seat = new THREE.Mesh(seatGeo, interiorMat);
    seat.position.set(sx, 1.36, cabCenterZ + 0.16);
    root.add(seat);
  }

  const steeringWheel = new THREE.Mesh(wheelRimGeo, trimMat);
  steeringWheel.position.set(driverX, 1.5, cabCenterZ - cabHalfZ + 0.36);
  steeringWheel.rotation.x = -0.52;
  root.add(steeringWheel);

  // Headlights at front bumper (-Z)
  for (const lx of [-w * 0.33, w * 0.33]) {
    const hl = new THREE.Mesh(lightGeo, headlightMat);
    hl.position.set(lx, 1.02, -l * 0.5 - 0.02);
    root.add(hl);
  }

  const zOffsets = isHeavy ? [-1.85, 0, 1.85] : [-1.45, 1.45];
  for (const wz of zOffsets) {
    for (const wx of [-w * 0.48, w * 0.48]) {
      const wheel = new THREE.Mesh(wheelGeo, tireMat);
      wheel.position.set(wx, 0.54, wz);
      wheel.castShadow = true;
      root.add(wheel);
      wheels.push(wheel);
    }
  }

  // Roof turret mount + elevating gun assembly
  const turret = new THREE.Group();
  turret.rotation.order = 'YXZ';
  turret.position.set(0, 2.34, isHeavy ? 0.15 : 0.12);
  const turretGun = new THREE.Group();

  const baseGeo = new THREE.CylinderGeometry(0.42, 0.52, 0.24, 12);
  const cradleGeo = new THREE.BoxGeometry(0.28, 0.22, 0.48);
  const barrelGeo = new THREE.CylinderGeometry(0.055, 0.07, 1.6, 8);
  barrelGeo.rotateX(Math.PI / 2);
  [baseGeo, cradleGeo, barrelGeo].forEach((g) => resourceManager.registerGeometry(g, scope));

  turret.add(new THREE.Mesh(baseGeo, gunMat));
  turretGun.position.set(0, 0.16, 0);
  turretGun.add(new THREE.Mesh(cradleGeo, gunMat));
  const barrel = new THREE.Mesh(barrelGeo, gunMat);
  barrel.position.set(0, 0.02, -0.82);
  turretGun.add(barrel);
  turret.add(turretGun);
  root.add(turret);
  fpvHiddenMeshes.push(turret);

  const driverSeatLocal = new THREE.Vector3(driverX, isHeavy ? 1.98 : 1.76, cabCenterZ - 0.05);
  const turretOpticLocal = new THREE.Vector3(0, 2.74, turret.position.z);

  return {
    root,
    wheels,
    turret,
    turretGun,
    driverSeatLocal,
    turretOpticLocal,
    fpvHiddenMeshes,
  };
}
