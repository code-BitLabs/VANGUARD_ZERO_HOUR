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

/**
 * Flyweight geometry & material cache for ground vehicles, scoped to (ResourceManager, ResourceScope).
 * Automatically evicts when ResourceManager.unloadScope(scope) runs.
 */
class VehicleVisualPalette {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.Material>();

  constructor(
    private readonly res: ResourceManager,
    private readonly scope: ResourceScope
  ) {}

  getOrCreateGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geo = this.geometries.get(key);
    if (!geo) {
      geo = factory();
      this.res.registerGeometry(geo, this.scope, `veh_geo:${this.scope}:${key}`);
      this.geometries.set(key, geo);
    }
    return geo;
  }

  getOrCreateMaterial<T extends THREE.Material>(key: string, factory: () => T): T {
    let mat = this.materials.get(key) as T | undefined;
    if (!mat) {
      mat = factory();
      this.res.registerMaterial(mat, this.scope, `veh_mat:${this.scope}:${key}`);
      this.materials.set(key, mat);
    }
    return mat;
  }

  clear(): void {
    this.geometries.clear();
    this.materials.clear();
  }
}

const vehiclePaletteByManager = new WeakMap<
  ResourceManager,
  Map<ResourceScope, VehicleVisualPalette>
>();

function getOrCreateVehiclePalette(
  res: ResourceManager,
  scope: ResourceScope
): VehicleVisualPalette {
  let byScope = vehiclePaletteByManager.get(res);
  if (!byScope) {
    byScope = new Map();
    vehiclePaletteByManager.set(res, byScope);
  }
  let palette = byScope.get(scope);
  if (!palette) {
    palette = new VehicleVisualPalette(res, scope);
    byScope.set(scope, palette);
    const scopeMapRef = byScope;
    const paletteRef = palette;
    res.register(
      'other',
      scope,
      () => {
        paletteRef.clear();
        if (scopeMapRef.get(scope) === paletteRef) {
          scopeMapRef.delete(scope);
        }
      },
      `vehicle_palette_cache:${scope}`
    );
  }
  return palette;
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
  const sizeTag = isHeavy ? 'heavy' : 'light';
  const bodyColor = hostile
    ? type === 'enemy_apc'
      ? 0x4b3621
      : 0x6b4423
    : type === 'armored_truck'
      ? 0x3b4d3b
      : 0x4b5320;

  const palette = getOrCreateVehiclePalette(res, scope);

  const hullMat = palette.getOrCreateMaterial(`hull_${bodyColor.toString(16)}`, () =>
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.58,
      metalness: 0.45,
    })
  );
  const trimMat = palette.getOrCreateMaterial('trim', () =>
    new THREE.MeshStandardMaterial({
      color: 0x1f242b,
      roughness: 0.68,
      metalness: 0.42,
    })
  );
  const interiorMat = palette.getOrCreateMaterial('interior', () =>
    new THREE.MeshStandardMaterial({
      color: 0x28303a,
      roughness: 0.82,
      metalness: 0.2,
    })
  );
  const tireMat = palette.getOrCreateMaterial('tire', () =>
    new THREE.MeshStandardMaterial({
      color: 0x141619,
      roughness: 0.9,
    })
  );
  const glassMat = palette.getOrCreateMaterial('glass', () =>
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.14,
      metalness: 0.85,
      transparent: true,
      opacity: 0.32,
    })
  );
  const gunMat = palette.getOrCreateMaterial('gun', () =>
    new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.35,
      metalness: 0.82,
    })
  );
  const gaugeGlowMat = palette.getOrCreateMaterial('gauge', () =>
    new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 0.85,
      roughness: 0.3,
    })
  );
  const lightMat = palette.getOrCreateMaterial('headlight', () =>
    new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xfacc15,
      emissiveIntensity: 0.9,
    })
  );
  const brakeLightMat = palette.getOrCreateMaterial('brakelight', () =>
    new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.85,
    })
  );
  const shadowMat = palette.getOrCreateMaterial('shadow', () =>
    new THREE.MeshBasicMaterial({
      color: 0x05070a,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    })
  );

  const w = isHeavy ? 2.8 : 2.3;
  const h = isHeavy ? 1.35 : 1.05;
  const l = isHeavy ? 5.4 : 4.2;

  // 1. Lower Armored Chassis & Engine Bay
  const floorGeo = palette.getOrCreateGeometry(`floor_${sizeTag}`, () => new THREE.BoxGeometry(w, 0.46, l));
  const lowerHull = new THREE.Mesh(floorGeo, hullMat);
  lowerHull.position.y = 0.68;
  lowerHull.castShadow = true;
  lowerHull.receiveShadow = true;
  chassisGroup.add(lowerHull);

  const hoodLen = l * 0.32;
  const hoodGeo = palette.getOrCreateGeometry(
    `hood_${sizeTag}`,
    () => new THREE.BoxGeometry(w * 0.96, h - 0.38, hoodLen)
  );
  const hood = new THREE.Mesh(hoodGeo, hullMat);
  hood.position.set(0, 0.91 + (h - 0.38) * 0.5, -l * 0.5 + hoodLen * 0.5);
  hood.castShadow = true;
  hood.receiveShadow = true;
  chassisGroup.add(hood);

  const cabinLen = l * 0.38;
  const sillGeo = palette.getOrCreateGeometry(
    `sill_${sizeTag}`,
    () => new THREE.BoxGeometry(0.16, 0.52, cabinLen)
  );
  for (const sx of [-w * 0.46, w * 0.46]) {
    const doorSill = new THREE.Mesh(sillGeo, hullMat);
    doorSill.position.set(sx, 1.16, -l * 0.04);
    chassisGroup.add(doorSill);
  }

  const rearLen = l * 0.3;
  const rearGeo = palette.getOrCreateGeometry(
    `rear_${sizeTag}`,
    () => new THREE.BoxGeometry(w * 0.98, h - 0.24, rearLen)
  );
  const rearDeck = new THREE.Mesh(rearGeo, hullMat);
  rearDeck.position.set(0, 0.91 + (h - 0.24) * 0.5, l * 0.5 - rearLen * 0.5);
  rearDeck.castShadow = true;
  rearDeck.receiveShadow = true;
  chassisGroup.add(rearDeck);

  // 2. Open-Cabin Pillars, Roof Canopy, Windshield Frame & Interior Cockpit
  const fpvHiddenMeshes: THREE.Object3D[] = [];
  const cabinRoofGroup = new THREE.Group();
  chassisGroup.add(cabinRoofGroup);
  fpvHiddenMeshes.push(cabinRoofGroup);

  const roofY = 0.9 + h + 0.54;
  const pillarH = 0.72;
  const pillarGeo = palette.getOrCreateGeometry('pillar', () => new THREE.BoxGeometry(0.1, pillarH, 0.1));

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

  const roofGeo = palette.getOrCreateGeometry(
    `roof_${sizeTag}`,
    () => new THREE.BoxGeometry(w * 0.9, 0.1, cabinLen + 0.2)
  );
  const roof = new THREE.Mesh(roofGeo, hullMat);
  roof.position.set(0, roofY, -l * 0.03);
  roof.castShadow = true;
  cabinRoofGroup.add(roof);

  const wsGeo = palette.getOrCreateGeometry(
    `windshield_${sizeTag}`,
    () => new THREE.BoxGeometry(w * 0.82, pillarH * 0.86, 0.04)
  );
  const windshield = new THREE.Mesh(wsGeo, glassMat);
  windshield.position.set(0, roofY - pillarH * 0.48, aPillarZ);
  chassisGroup.add(windshield);

  const dashGeo = palette.getOrCreateGeometry(
    `dash_${sizeTag}`,
    () => new THREE.BoxGeometry(w * 0.84, 0.28, 0.34)
  );
  const dash = new THREE.Mesh(dashGeo, interiorMat);
  dash.position.set(0, 1.36, aPillarZ + 0.18);
  chassisGroup.add(dash);

  const clusterGeo = palette.getOrCreateGeometry('cluster', () => new THREE.BoxGeometry(0.42, 0.1, 0.04));
  const cluster = new THREE.Mesh(clusterGeo, gaugeGlowMat);
  cluster.position.set(-w * 0.2, 1.44, aPillarZ + 0.35);
  chassisGroup.add(cluster);

  const wheelRimGeo = palette.getOrCreateGeometry(
    'steering_wheel',
    () => new THREE.TorusGeometry(0.17, 0.024, 8, 16)
  );
  const steeringWheel = new THREE.Mesh(wheelRimGeo, trimMat);
  steeringWheel.position.set(-w * 0.2, 1.45, aPillarZ + 0.48);
  steeringWheel.rotation.x = -0.42;
  chassisGroup.add(steeringWheel);

  const seatGeo = palette.getOrCreateGeometry('seat', () => new THREE.BoxGeometry(0.52, 0.62, 0.14));
  const seat = new THREE.Mesh(seatGeo, interiorMat);
  seat.position.set(-w * 0.2, 1.32, -l * 0.01 + 0.26);
  chassisGroup.add(seat);
  fpvHiddenMeshes.push(seat);

  const lightGeo = palette.getOrCreateGeometry('light', () => new THREE.BoxGeometry(0.28, 0.16, 0.08));
  const bumperGeo = palette.getOrCreateGeometry(
    `bumper_${sizeTag}`,
    () => new THREE.BoxGeometry(w * 0.96, 0.28, 0.22)
  );
  const skirtGeo = palette.getOrCreateGeometry(
    `skirt_${sizeTag}`,
    () => new THREE.BoxGeometry(0.12, 0.34, l * 0.72)
  );
  const shadowPlaneGeo = palette.getOrCreateGeometry(`shadow_${sizeTag}`, () => {
    const g = new THREE.PlaneGeometry(w * 1.15, l * 1.08);
    g.rotateX(-Math.PI / 2);
    return g;
  });

  const shadowMesh = new THREE.Mesh(shadowPlaneGeo, shadowMat);
  shadowMesh.position.y = 0.03;
  root.add(shadowMesh);

  const frontBumper = new THREE.Mesh(bumperGeo, trimMat);
  frontBumper.position.set(0, 0.76, -l * 0.5 - 0.08);
  chassisGroup.add(frontBumper);

  for (const sx of [-w * 0.51, w * 0.51]) {
    const skirt = new THREE.Mesh(skirtGeo, trimMat);
    skirt.position.set(sx, 0.88, 0);
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
  const wheelGeo = palette.getOrCreateGeometry('wheel', () => {
    const g = new THREE.CylinderGeometry(0.55, 0.55, 0.42, 14);
    g.rotateZ(Math.PI / 2);
    return g;
  });
  const hubGeo = palette.getOrCreateGeometry('hub', () => {
    const g = new THREE.CylinderGeometry(0.24, 0.24, 0.45, 10);
    g.rotateZ(Math.PI / 2);
    return g;
  });
  const strutGeo = palette.getOrCreateGeometry(
    'strut',
    () => new THREE.CylinderGeometry(0.08, 0.09, 0.48, 8)
  );

  const wx = w * 0.52;
  const wz = l * 0.34;
  const wheelLocalPositions: ReadonlyArray<readonly [number, number, number]> =
    type === 'enemy_apc'
      ? [
          [-wx, wheelRestY, -wz],
          [wx, wheelRestY, -wz],
          [-wx, wheelRestY, wz],
          [wx, wheelRestY, wz],
          [-wx, wheelRestY, 0],
          [wx, wheelRestY, 0],
        ]
      : [
          [-wx, wheelRestY, -wz],
          [wx, wheelRestY, -wz],
          [-wx, wheelRestY, wz],
          [wx, wheelRestY, wz],
        ];

  for (const [x, y, z] of wheelLocalPositions) {
    const wheelAssembly = new THREE.Group();
    wheelAssembly.position.set(x, y, z);

    const tire = new THREE.Mesh(wheelGeo, tireMat);
    wheelAssembly.add(tire);

    const hub = new THREE.Mesh(hubGeo, trimMat);
    wheelAssembly.add(hub);

    root.add(wheelAssembly);
    wheels.push(wheelAssembly);

    const strut = new THREE.Mesh(strutGeo, gunMat);
    strut.position.set(x * 0.86, y + 0.28, z);
    chassisGroup.add(strut);
    suspensionStruts.push(strut);
  }

  // 4. Roof Turret & Heavy MG / Autocannon
  const turret = new THREE.Group();
  turret.position.set(0, roofY + 0.06, 0.12);

  const ringGeo = palette.getOrCreateGeometry(
    'turret_ring',
    () => new THREE.CylinderGeometry(0.58, 0.65, 0.26, 12)
  );
  const ring = new THREE.Mesh(ringGeo, gunMat);
  turret.add(ring);

  const shieldGeo = palette.getOrCreateGeometry(
    'turret_shield',
    () => new THREE.BoxGeometry(0.88, 0.38, 0.08)
  );
  const opticPodGeo = palette.getOrCreateGeometry(
    'turret_optic',
    () => new THREE.BoxGeometry(0.22, 0.2, 0.28)
  );
  const shield = new THREE.Mesh(shieldGeo, hullMat);
  shield.position.set(0, 0.26, -0.42);
  const opticPod = new THREE.Mesh(opticPodGeo, trimMat);
  opticPod.position.set(0.28, 0.32, -0.28);
  turret.add(shield, opticPod);

  const turretGun = new THREE.Group();
  const barrelGeo = palette.getOrCreateGeometry(
    'turret_barrel',
    () => new THREE.BoxGeometry(0.16, 0.16, 1.55)
  );
  const barrel = new THREE.Mesh(barrelGeo, gunMat);
  barrel.position.set(0, 0.2, -0.78);
  turretGun.add(barrel);

  turret.add(turretGun);
  chassisGroup.add(turret);

  const driverSeatLocal = new THREE.Vector3(-w * 0.2, roofY - 0.32, -l * 0.04);
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
