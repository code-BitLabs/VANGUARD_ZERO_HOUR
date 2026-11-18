import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { VehicleType } from '@/src/schemas/mission.schema';

export interface BuiltVehicleRig {
  root: THREE.Group;
  chassisGroup: THREE.Group;
  wheels: THREE.Object3D[];
  suspensionStruts: THREE.Object3D[];
  wheelRestY: number;
  wheelLocalPositions: ReadonlyArray<readonly [number, number, number]>;
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
  res: ResourceManager
): BuiltVehicleRig {
  const root = new THREE.Group();
  root.name = `vehicle_root_${type}`;

  // Sprung chassis assembly (receives pitch, roll, and vertical heave independently of authoritative root & wheels)
  const chassisGroup = new THREE.Group();
  chassisGroup.name = `vehicle_chassis_${type}`;
  root.add(chassisGroup);

  const isHeavy = type === 'armored_truck' || type === 'enemy_apc';
  const bodyColor = hostile
    ? type === 'enemy_apc'
      ? 0x4b3621
      : 0x6b4423
    : type === 'armored_truck'
      ? 0x3b4d3b
      : 0x4b5320;

  const hullMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.58,
    metalness: 0.45,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x1f242b,
    roughness: 0.68,
    metalness: 0.42,
  });
  const interiorMat = new THREE.MeshStandardMaterial({
    color: 0x28303a,
    roughness: 0.82,
    metalness: 0.2,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x141619,
    roughness: 0.9,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    roughness: 0.14,
    metalness: 0.85,
    transparent: true,
    opacity: 0.32,
  });
  const gunMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.35,
    metalness: 0.82,
  });
  const gaugeGlowMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x10b981,
    emissiveIntensity: 0.85,
    roughness: 0.3,
  });

  res.registerMaterial(hullMat, scope);
  res.registerMaterial(trimMat, scope);
  res.registerMaterial(interiorMat, scope);
  res.registerMaterial(tireMat, scope);
  res.registerMaterial(glassMat, scope);
  res.registerMaterial(gunMat, scope);
  res.registerMaterial(gaugeGlowMat, scope);

  const w = isHeavy ? 2.8 : 2.3;
  const h = isHeavy ? 1.35 : 1.05;
  const l = isHeavy ? 5.4 : 4.2;

  // 1. Lower Armored Chassis & Engine Bay (leaves open driver cabin well so FPV camera never sits inside a solid box)
  const floorGeo = new THREE.BoxGeometry(w, 0.46, l);
  res.registerGeometry(floorGeo, scope);
  const lowerHull = new THREE.Mesh(floorGeo, hullMat);
  lowerHull.position.y = 0.68;
  lowerHull.castShadow = true;
  lowerHull.receiveShadow = true;
  chassisGroup.add(lowerHull);

  // Front Hood / Engine Bay (-Z is forward)
  const hoodLen = l * 0.32;
  const hoodGeo = new THREE.BoxGeometry(w * 0.96, h - 0.38, hoodLen);
  res.registerGeometry(hoodGeo, scope);
  const hood = new THREE.Mesh(hoodGeo, hullMat);
  hood.position.set(0, 0.91 + (h - 0.38) * 0.5, -l * 0.5 + hoodLen * 0.5);
  hood.castShadow = true;
  hood.receiveShadow = true;
  chassisGroup.add(hood);

  // Side Armored Door Sills (below window line)
  const cabinLen = l * 0.38;
  const sillGeo = new THREE.BoxGeometry(0.16, 0.52, cabinLen);
  res.registerGeometry(sillGeo, scope);
  for (const sx of [-w * 0.46, w * 0.46]) {
    const doorSill = new THREE.Mesh(sillGeo, hullMat);
    doorSill.position.set(sx, 1.16, -l * 0.04);
    doorSill.castShadow = true;
    chassisGroup.add(doorSill);
  }

  // Rear Cargo / Troop Deck (+Z is rear)
  const rearLen = l * 0.3;
  const rearGeo = new THREE.BoxGeometry(w * 0.98, h - 0.24, rearLen);
  res.registerGeometry(rearGeo, scope);
  const rearDeck = new THREE.Mesh(rearGeo, hullMat);
  rearDeck.position.set(0, 0.91 + (h - 0.24) * 0.5, l * 0.5 - rearLen * 0.5);
  rearDeck.castShadow = true;
  rearDeck.receiveShadow = true;
  chassisGroup.add(rearDeck);

  // 2. Open-Cabin Pillars, Roof Canopy, Windshield Frame & Interior Cockpit (Seat, Dash, Steering Wheel)
  const fpvHiddenMeshes: THREE.Object3D[] = [];
  const cabinRoofGroup = new THREE.Group();
  chassisGroup.add(cabinRoofGroup);
  fpvHiddenMeshes.push(cabinRoofGroup);

  const roofY = 0.9 + h + 0.54;
  const pillarH = 0.72;
  const pillarGeo = new THREE.BoxGeometry(0.1, pillarH, 0.1);
  res.registerGeometry(pillarGeo, scope);

  const aPillarZ = -l * 0.21;
  const bPillarZ = l * 0.14;
  for (const px of [-w * 0.43, w * 0.43]) {
    const aPillar = new THREE.Mesh(pillarGeo, trimMat);
    aPillar.position.set(px, roofY - pillarH * 0.5, aPillarZ);
    chassisGroup.add(aPillar);

    const bPillar = new THREE.Mesh(pillarGeo, trimMat);
    bPillar.position.set(px, roofY - pillarH * 0.5, bPillarZ);
    cabinRoofGroup.add(bPillar);
  }

  const roofGeo = new THREE.BoxGeometry(w * 0.9, 0.1, cabinLen + 0.2);
  res.registerGeometry(roofGeo, scope);
  const roof = new THREE.Mesh(roofGeo, hullMat);
  roof.position.set(0, roofY, -l * 0.03);
  roof.castShadow = true;
  cabinRoofGroup.add(roof);

  // Semi-transparent ballistic windshield pane at front of cab
  const wsGeo = new THREE.BoxGeometry(w * 0.82, pillarH * 0.86, 0.04);
  res.registerGeometry(wsGeo, scope);
  const windshield = new THREE.Mesh(wsGeo, glassMat);
  windshield.position.set(0, roofY - pillarH * 0.48, aPillarZ);
  chassisGroup.add(windshield);

  // Interior Dashboard & Glowing Tactical Instrument Cluster
  const dashGeo = new THREE.BoxGeometry(w * 0.84, 0.28, 0.34);
  res.registerGeometry(dashGeo, scope);
  const dash = new THREE.Mesh(dashGeo, interiorMat);
  dash.position.set(0, 1.36, aPillarZ + 0.18);
  chassisGroup.add(dash);

  const clusterGeo = new THREE.BoxGeometry(0.42, 0.1, 0.04);
  res.registerGeometry(clusterGeo, scope);
  const cluster = new THREE.Mesh(clusterGeo, gaugeGlowMat);
  cluster.position.set(-w * 0.2, 1.44, aPillarZ + 0.35);
  chassisGroup.add(cluster);

  // Steering Wheel on Driver Side (-X)
  const wheelRimGeo = new THREE.TorusGeometry(0.17, 0.024, 8, 16);
  res.registerGeometry(wheelRimGeo, scope);
  const steeringWheel = new THREE.Mesh(wheelRimGeo, trimMat);
  steeringWheel.position.set(-w * 0.2, 1.45, aPillarZ + 0.48);
  steeringWheel.rotation.x = -0.42;
  chassisGroup.add(steeringWheel);

  // Driver Seat Backrest (hidden in FPV so looking back/sideways never clips seat geometry)
  const seatGeo = new THREE.BoxGeometry(0.52, 0.62, 0.14);
  res.registerGeometry(seatGeo, scope);
  const seat = new THREE.Mesh(seatGeo, interiorMat);
  seat.position.set(-w * 0.2, 1.32, -l * 0.01 + 0.26);
  chassisGroup.add(seat);
  fpvHiddenMeshes.push(seat);

  // Front Headlights & Armored Bullbar + Rear Brake Lights
  const lightGeo = new THREE.BoxGeometry(0.28, 0.16, 0.08);
  const bumperGeo = new THREE.BoxGeometry(w * 0.96, 0.28, 0.22);
  const skirtGeo = new THREE.BoxGeometry(0.12, 0.34, l * 0.72);
  const shadowPlaneGeo = new THREE.PlaneGeometry(w * 1.15, l * 1.08);
  shadowPlaneGeo.rotateX(-Math.PI / 2);
  res.registerGeometry(lightGeo, scope);
  res.registerGeometry(bumperGeo, scope);
  res.registerGeometry(skirtGeo, scope);
  res.registerGeometry(shadowPlaneGeo, scope);

  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xfacc15,
    emissiveIntensity: 0.9,
  });
  const brakeLightMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 0.85,
  });
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x05070a,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  res.registerMaterial(lightMat, scope);
  res.registerMaterial(brakeLightMat, scope);
  res.registerMaterial(shadowMat, scope);

  // Grounding contact shadow plate under root
  const shadowMesh = new THREE.Mesh(shadowPlaneGeo, shadowMat);
  shadowMesh.position.y = 0.03;
  root.add(shadowMesh);

  // Front armored bullbar bumper
  const frontBumper = new THREE.Mesh(bumperGeo, trimMat);
  frontBumper.position.set(0, 0.76, -l * 0.5 - 0.08);
  frontBumper.castShadow = true;
  chassisGroup.add(frontBumper);

  // Side armored reactive-armor skirt plates
  for (const sx of [-w * 0.51, w * 0.51]) {
    const skirt = new THREE.Mesh(skirtGeo, trimMat);
    skirt.position.set(sx, 0.88, 0);
    skirt.castShadow = true;
    chassisGroup.add(skirt);
  }

  for (const lx of [-w * 0.34, w * 0.34]) {
    const hl = new THREE.Mesh(lightGeo, lightMat);
    hl.position.set(lx, 1.05, -l * 0.5 - 0.02);
    chassisGroup.add(hl);

    const tl = new THREE.Mesh(lightGeo, brakeLightMat);
    tl.position.set(lx, 1.02, l * 0.5 + 0.02);
    chassisGroup.add(tl);
  }

  // 3. Unsprung Wheels + Visible Coilover Struts
  const wheels: THREE.Object3D[] = [];
  const suspensionStruts: THREE.Object3D[] = [];
  const wheelRestY = 0.55;
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.42, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  res.registerGeometry(wheelGeo, scope);

  const hubGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.45, 10);
  hubGeo.rotateZ(Math.PI / 2);
  res.registerGeometry(hubGeo, scope);

  const strutGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.48, 8);
  res.registerGeometry(strutGeo, scope);

  const wx = w * 0.52;
  const wz = l * 0.34;
  const wheelLocalPositions: ReadonlyArray<readonly [number, number, number]> =
    type === 'enemy_apc'
      ? [
          [-wx, wheelRestY, -wz], // 0: Front-Left
          [wx, wheelRestY, -wz], // 1: Front-Right
          [-wx, wheelRestY, wz], // 2: Rear-Left
          [wx, wheelRestY, wz], // 3: Rear-Right
          [-wx, wheelRestY, 0], // 4: Mid-Left (6x6 APC)
          [wx, wheelRestY, 0], // 5: Mid-Right (6x6 APC)
        ]
      : [
          [-wx, wheelRestY, -wz], // 0: Front-Left
          [wx, wheelRestY, -wz], // 1: Front-Right
          [-wx, wheelRestY, wz], // 2: Rear-Left
          [wx, wheelRestY, wz], // 3: Rear-Right
        ];

  for (const [x, y, z] of wheelLocalPositions) {
    const wheelAssembly = new THREE.Group();
    wheelAssembly.position.set(x, y, z);

    const tire = new THREE.Mesh(wheelGeo, tireMat);
    tire.castShadow = true;
    wheelAssembly.add(tire);

    const hub = new THREE.Mesh(hubGeo, trimMat);
    wheelAssembly.add(hub);

    root.add(wheelAssembly);
    wheels.push(wheelAssembly);

    // Suspension coilover strut mounted between wheel well and chassis
    const strut = new THREE.Mesh(strutGeo, gunMat);
    strut.position.set(x * 0.86, y + 0.28, z);
    chassisGroup.add(strut);
    suspensionStruts.push(strut);
  }

  // 4. Roof Turret & Heavy MG / Autocannon (mounted on sprung chassisGroup)
  const turret = new THREE.Group();
  turret.position.set(0, roofY + 0.06, 0.12);

  const ringGeo = new THREE.CylinderGeometry(0.58, 0.65, 0.26, 12);
  res.registerGeometry(ringGeo, scope);
  const ring = new THREE.Mesh(ringGeo, gunMat);
  turret.add(ring);

  // Armored turret shield plates + thermal sight pod
  const shieldGeo = new THREE.BoxGeometry(0.88, 0.38, 0.08);
  const opticPodGeo = new THREE.BoxGeometry(0.22, 0.2, 0.28);
  res.registerGeometry(shieldGeo, scope);
  res.registerGeometry(opticPodGeo, scope);
  const shield = new THREE.Mesh(shieldGeo, hullMat);
  shield.position.set(0, 0.26, -0.42);
  const opticPod = new THREE.Mesh(opticPodGeo, trimMat);
  opticPod.position.set(0.28, 0.32, -0.28);
  turret.add(shield, opticPod);

  const turretGun = new THREE.Group();
  const barrelGeo = new THREE.BoxGeometry(0.16, 0.16, 1.55);
  res.registerGeometry(barrelGeo, scope);
  const barrel = new THREE.Mesh(barrelGeo, gunMat);
  barrel.position.set(0, 0.2, -0.78);
  turretGun.add(barrel);

  turret.add(turretGun);
  chassisGroup.add(turret);

  // Driver FPV eye anchor (inside open cabin, looking cleanly through windshield over hood)
  const driverSeatLocal = new THREE.Vector3(-w * 0.2, roofY - 0.32, -l * 0.04);
  // Turret Gunner optic anchor (above turret ring & shield, clear of roof & barrel)
  const turretOpticLocal = new THREE.Vector3(0, roofY + 0.62, 0.04);

  return {
    root,
    chassisGroup,
    wheels,
    suspensionStruts,
    wheelRestY,
    wheelLocalPositions,
    turret,
    turretGun,
    driverSeatLocal,
    turretOpticLocal,
    fpvHiddenMeshes,
  };
}
