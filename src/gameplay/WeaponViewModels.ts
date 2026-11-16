import * as THREE from 'three';
import { WeaponId } from '@/src/schemas/weapon.schema';

export interface ViewModelRig {
  root: THREE.Group;
  muzzleFlash: THREE.Mesh;
  slideOrBolt: THREE.Object3D | null;
  slideRestZ: number;
}

export interface ViewModelMaterialBank {
  gunmetal: THREE.MeshStandardMaterial;
  darkPolymer: THREE.MeshStandardMaterial;
  oliveTube: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  opticGlass: THREE.MeshStandardMaterial;
  flashMat: THREE.MeshBasicMaterial;
}

export function createViewModelMaterialBank(): ViewModelMaterialBank {
  return {
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x20262e, metalness: 0.78, roughness: 0.34 }),
    darkPolymer: new THREE.MeshStandardMaterial({ color: 0x13171c, metalness: 0.2, roughness: 0.72 }),
    oliveTube: new THREE.MeshStandardMaterial({ color: 0x3b4933, metalness: 0.35, roughness: 0.58 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.85, roughness: 0.24 }),
    opticGlass: new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.55,
      metalness: 0.9,
      roughness: 0.1,
    }),
    flashMat: new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.92,
    }),
  };
}

export function disposeViewModelMaterialBank(bank: ViewModelMaterialBank): void {
  bank.gunmetal.dispose();
  bank.darkPolymer.dispose();
  bank.oliveTube.dispose();
  bank.steel.dispose();
  bank.opticGlass.dispose();
  bank.flashMat.dispose();
}

export function buildWeaponViewModel(
  weaponId: WeaponId,
  sharedBank?: ViewModelMaterialBank
): ViewModelRig {
  const root = new THREE.Group();

  const bank = sharedBank ?? createViewModelMaterialBank();
  const { gunmetal, darkPolymer, oliveTube, steel, opticGlass, flashMat } = bank;

  const addPart = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    root.add(m);
    return m;
  };

  let slideOrBolt: THREE.Object3D | null = null;
  let muzzleZ = -0.62;
  let muzzleY = 0.03;

  if (weaponId === 'assault_rifle') {
    addPart(new THREE.BoxGeometry(0.065, 0.09, 0.38), gunmetal, 0, 0, -0.1);
    addPart(new THREE.BoxGeometry(0.055, 0.075, 0.34), darkPolymer, 0, 0.005, -0.42); // handguard
    addPart(new THREE.CylinderGeometry(0.013, 0.013, 0.3, 10), steel, 0, 0.022, -0.65, Math.PI / 2); // barrel
    addPart(new THREE.BoxGeometry(0.038, 0.16, 0.075), darkPolymer, 0, -0.12, -0.16); // mag
    addPart(new THREE.BoxGeometry(0.04, 0.11, 0.055), darkPolymer, 0, -0.09, 0.04); // grip
    addPart(new THREE.BoxGeometry(0.048, 0.06, 0.09), gunmetal, 0, 0.075, -0.12); // holo sight
    addPart(new THREE.BoxGeometry(0.034, 0.034, 0.01), opticGlass, 0, 0.078, -0.12);
    slideOrBolt = addPart(new THREE.BoxGeometry(0.018, 0.022, 0.08), steel, 0.036, 0.02, -0.14);
    muzzleZ = -0.82;
    muzzleY = 0.022;
  } else if (weaponId === 'smg') {
    addPart(new THREE.BoxGeometry(0.058, 0.085, 0.3), gunmetal, 0, 0, -0.12);
    addPart(new THREE.CylinderGeometry(0.019, 0.019, 0.24, 10), darkPolymer, 0, 0.018, -0.38, Math.PI / 2); // suppressor
    addPart(new THREE.BoxGeometry(0.032, 0.17, 0.048), darkPolymer, 0, -0.11, -0.18);
    addPart(new THREE.BoxGeometry(0.036, 0.095, 0.05), darkPolymer, 0, -0.08, 0.02);
    addPart(new THREE.BoxGeometry(0.04, 0.045, 0.06), gunmetal, 0, 0.065, -0.1);
    addPart(new THREE.BoxGeometry(0.028, 0.028, 0.01), opticGlass, 0, 0.068, -0.1);
    muzzleZ = -0.52;
    muzzleY = 0.018;
  } else if (weaponId === 'sniper_rifle') {
    addPart(new THREE.BoxGeometry(0.06, 0.085, 0.48), oliveTube, 0, -0.01, -0.1);
    addPart(new THREE.CylinderGeometry(0.014, 0.016, 0.56, 10), steel, 0, 0.02, -0.6, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.028, 0.028, 0.28, 12), gunmetal, 0, 0.085, -0.16, Math.PI / 2); // 6x scope
    addPart(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 12), opticGlass, 0, 0.085, -0.02, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.042, 0.09, 0.08), darkPolymer, 0, -0.09, -0.12);
    slideOrBolt = addPart(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 8), steel, 0.04, 0.025, -0.04);
    muzzleZ = -0.9;
    muzzleY = 0.02;
  } else if (weaponId === 'shotgun') {
    addPart(new THREE.BoxGeometry(0.065, 0.09, 0.36), gunmetal, 0, 0, -0.08);
    addPart(new THREE.CylinderGeometry(0.018, 0.018, 0.44, 10), steel, 0, 0.024, -0.45, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.016, 0.016, 0.38, 10), darkPolymer, 0, -0.016, -0.42, Math.PI / 2); // underbarrel tube
    slideOrBolt = addPart(new THREE.BoxGeometry(0.062, 0.055, 0.16), darkPolymer, 0, -0.018, -0.36); // pump
    muzzleZ = -0.69;
    muzzleY = 0.024;
  } else if (weaponId === 'lmg') {
    addPart(new THREE.BoxGeometry(0.09, 0.11, 0.44), gunmetal, 0, 0, -0.12);
    addPart(new THREE.CylinderGeometry(0.016, 0.018, 0.46, 10), steel, 0, 0.025, -0.55, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.12, 0.13, 0.13), oliveTube, -0.03, -0.11, -0.14); // ammo box
    addPart(new THREE.BoxGeometry(0.07, 0.04, 0.06), steel, 0, 0.075, -0.08);
    muzzleZ = -0.8;
    muzzleY = 0.025;
  } else if (weaponId === 'pistol') {
    addPart(new THREE.BoxGeometry(0.042, 0.055, 0.22), darkPolymer, 0, -0.01, -0.1);
    slideOrBolt = addPart(new THREE.BoxGeometry(0.044, 0.042, 0.24), gunmetal, 0, 0.028, -0.11);
    addPart(new THREE.BoxGeometry(0.038, 0.11, 0.052), darkPolymer, 0, -0.07, -0.02);
    muzzleZ = -0.26;
    muzzleY = 0.028;
  } else if (weaponId === 'rocket_launcher') {
    // RPG-7V / AT-4X Bazooka Launcher Tube, Heat Shield, Venturi Cone & Conical PG-7V Warhead
    addPart(new THREE.CylinderGeometry(0.056, 0.056, 0.88, 14), oliveTube, 0, 0.02, -0.22, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.068, 0.068, 0.34, 14), darkPolymer, 0, 0.02, -0.18, Math.PI / 2); // heat shield
    addPart(new THREE.CylinderGeometry(0.054, 0.092, 0.16, 14), steel, 0, 0.02, 0.24, Math.PI / 2); // rear venturi exhaust cone
    addPart(new THREE.CylinderGeometry(0.072, 0.064, 0.1, 14), darkPolymer, 0, 0.02, -0.64, Math.PI / 2); // muzzle collar
    addPart(new THREE.BoxGeometry(0.04, 0.11, 0.055), darkPolymer, 0, -0.06, -0.18); // forward grip
    addPart(new THREE.BoxGeometry(0.046, 0.065, 0.08), opticGlass, -0.068, 0.055, -0.26); // optical iron sight
    // Protruding conical PG-7V warhead (assigned to slideOrBolt so it recoils/hides when chamber is empty)
    const warheadGroup = new THREE.Group();
    warheadGroup.position.set(0, 0.02, -0.74);
    const warheadBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.092, 0.044, 0.16, 14),
      oliveTube
    );
    warheadBody.rotation.x = Math.PI / 2;
    const warheadNose = new THREE.Mesh(
      new THREE.ConeGeometry(0.092, 0.18, 14),
      steel
    );
    warheadNose.rotation.x = -Math.PI / 2;
    warheadNose.position.z = -0.17;
    warheadGroup.add(warheadBody, warheadNose);
    root.add(warheadGroup);
    slideOrBolt = warheadGroup;
    muzzleZ = -0.92;
    muzzleY = 0.02;
  } else if (weaponId === 'guided_missile') {
    addPart(new THREE.CylinderGeometry(0.082, 0.082, 0.98, 14), gunmetal, 0, 0.02, -0.22, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.11, 0.1, 0.18), darkPolymer, -0.07, 0.04, -0.3); // seeker unit
    addPart(new THREE.BoxGeometry(0.04, 0.06, 0.02), opticGlass, -0.09, 0.06, -0.21);
    muzzleZ = -0.76;
    muzzleY = 0.02;
  } else {
    // grenade_launcher (rotary cylinder)
    addPart(new THREE.BoxGeometry(0.07, 0.09, 0.34), gunmetal, 0, 0.01, -0.08);
    slideOrBolt = addPart(new THREE.CylinderGeometry(0.072, 0.072, 0.14, 12), darkPolymer, 0, 0.0, -0.22, Math.PI / 2); // drum
    addPart(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 12), steel, 0, 0.02, -0.44, Math.PI / 2);
    muzzleZ = -0.62;
    muzzleY = 0.02;
  }

  // Muzzle flash star mesh
  const muzzleFlash = new THREE.Mesh(new THREE.OctahedronGeometry(0.065, 0), flashMat);
  muzzleFlash.position.set(0, muzzleY, muzzleZ);
  muzzleFlash.visible = false;
  root.add(muzzleFlash);

  return {
    root,
    muzzleFlash,
    slideOrBolt,
    slideRestZ: slideOrBolt ? slideOrBolt.position.z : 0,
  };
}

