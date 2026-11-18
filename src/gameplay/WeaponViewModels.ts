import * as THREE from 'three';
import { WeaponId } from '@/src/schemas/weapon.schema';

export type WeaponReloadAnimStyle =
  | 'box_mag'
  | 'bolt_mag'
  | 'pump_shell'
  | 'belt_box'
  | 'warhead_insert'
  | 'rotary_drum';

export interface WeaponAnimProfile {
  hipPos: readonly [number, number, number];
  adsPos: readonly [number, number, number];
  hipRotY: number;
  recoilKickZ: number;
  recoilPitch: number;
  recoilRoll: number;
  recoilStiffness: number;
  recoilDamping: number;
  adsSpeed: number;
  swayScale: number;
  sprintCantX: number;
  sprintCantY: number;
  sprintCantZ: number;
  reloadStyle: WeaponReloadAnimStyle;
}

export interface ViewModelRig {
  root: THREE.Group;
  muzzleFlash: THREE.Mesh;
  muzzleBasePos: THREE.Vector3;
  slideOrBolt: THREE.Object3D | null;
  slideRestZ: number;
  magazine: THREE.Object3D | null;
  magazineRestPos: THREE.Vector3;
  secondaryPart: THREE.Object3D | null;
  secondaryRestPos: THREE.Vector3;
  animProfile: WeaponAnimProfile;
}

export interface ViewModelMaterialBank {
  gunmetal: THREE.MeshStandardMaterial;
  darkPolymer: THREE.MeshStandardMaterial;
  oliveTube: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  opticGlass: THREE.MeshStandardMaterial;
  flashMat: THREE.MeshBasicMaterial;
}

export const WEAPON_ANIM_PROFILES: Record<WeaponId, WeaponAnimProfile> = {
  assault_rifle: {
    hipPos: [0.23, -0.2, -0.44],
    adsPos: [0.0, -0.145, -0.32],
    hipRotY: -0.03,
    recoilKickZ: 0.062,
    recoilPitch: 0.085,
    recoilRoll: 0.025,
    recoilStiffness: 290,
    recoilDamping: 22,
    adsSpeed: 15,
    swayScale: 1.0,
    sprintCantX: -0.28,
    sprintCantY: 0.42,
    sprintCantZ: 0.14,
    reloadStyle: 'box_mag',
  },
  smg: {
    hipPos: [0.21, -0.19, -0.4],
    adsPos: [0.0, -0.138, -0.3],
    hipRotY: -0.02,
    recoilKickZ: 0.045,
    recoilPitch: 0.062,
    recoilRoll: 0.032,
    recoilStiffness: 340,
    recoilDamping: 24,
    adsSpeed: 18,
    swayScale: 0.88,
    sprintCantX: -0.24,
    sprintCantY: 0.36,
    sprintCantZ: 0.12,
    reloadStyle: 'box_mag',
  },
  sniper_rifle: {
    hipPos: [0.25, -0.21, -0.46],
    adsPos: [0.0, -0.155, -0.31],
    hipRotY: -0.035,
    recoilKickZ: 0.105,
    recoilPitch: 0.145,
    recoilRoll: 0.045,
    recoilStiffness: 210,
    recoilDamping: 18,
    adsSpeed: 10.5,
    swayScale: 1.15,
    sprintCantX: -0.32,
    sprintCantY: 0.48,
    sprintCantZ: 0.16,
    reloadStyle: 'bolt_mag',
  },
  shotgun: {
    hipPos: [0.24, -0.205, -0.44],
    adsPos: [0.0, -0.145, -0.34],
    hipRotY: -0.03,
    recoilKickZ: 0.095,
    recoilPitch: 0.135,
    recoilRoll: 0.04,
    recoilStiffness: 240,
    recoilDamping: 19,
    adsSpeed: 13.5,
    swayScale: 1.05,
    sprintCantX: -0.28,
    sprintCantY: 0.42,
    sprintCantZ: 0.15,
    reloadStyle: 'pump_shell',
  },
  lmg: {
    hipPos: [0.25, -0.22, -0.46],
    adsPos: [0.0, -0.155, -0.34],
    hipRotY: -0.04,
    recoilKickZ: 0.072,
    recoilPitch: 0.095,
    recoilRoll: 0.035,
    recoilStiffness: 220,
    recoilDamping: 19,
    adsSpeed: 10,
    swayScale: 1.2,
    sprintCantX: -0.34,
    sprintCantY: 0.5,
    sprintCantZ: 0.18,
    reloadStyle: 'belt_box',
  },
  pistol: {
    hipPos: [0.2, -0.175, -0.37],
    adsPos: [0.0, -0.125, -0.28],
    hipRotY: -0.015,
    recoilKickZ: 0.048,
    recoilPitch: 0.095,
    recoilRoll: 0.022,
    recoilStiffness: 380,
    recoilDamping: 25,
    adsSpeed: 20,
    swayScale: 0.75,
    sprintCantX: 0.34,
    sprintCantY: 0.22,
    sprintCantZ: 0.08,
    reloadStyle: 'box_mag',
  },
  rocket_launcher: {
    hipPos: [0.24, -0.155, -0.44],
    adsPos: [0.068, -0.095, -0.38],
    hipRotY: -0.04,
    recoilKickZ: 0.14,
    recoilPitch: 0.16,
    recoilRoll: 0.05,
    recoilStiffness: 170,
    recoilDamping: 16,
    adsSpeed: 9.5,
    swayScale: 1.25,
    sprintCantX: -0.26,
    sprintCantY: 0.45,
    sprintCantZ: 0.14,
    reloadStyle: 'warhead_insert',
  },
  guided_missile: {
    hipPos: [0.25, -0.165, -0.44],
    adsPos: [0.075, -0.105, -0.38],
    hipRotY: -0.045,
    recoilKickZ: 0.125,
    recoilPitch: 0.14,
    recoilRoll: 0.04,
    recoilStiffness: 175,
    recoilDamping: 16,
    adsSpeed: 9,
    swayScale: 1.25,
    sprintCantX: -0.28,
    sprintCantY: 0.46,
    sprintCantZ: 0.14,
    reloadStyle: 'warhead_insert',
  },
  grenade_launcher: {
    hipPos: [0.22, -0.165, -0.44],
    adsPos: [0.0, -0.105, -0.38],
    hipRotY: -0.03,
    recoilKickZ: 0.09,
    recoilPitch: 0.12,
    recoilRoll: 0.035,
    recoilStiffness: 230,
    recoilDamping: 19,
    adsSpeed: 12.5,
    swayScale: 1.1,
    sprintCantX: -0.28,
    sprintCantY: 0.42,
    sprintCantZ: 0.14,
    reloadStyle: 'rotary_drum',
  },
};

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
    rx = 0,
    parent: THREE.Object3D = root
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    parent.add(m);
    return m;
  };

  let slideOrBolt: THREE.Object3D | null = null;
  let magazine: THREE.Object3D | null = null;
  let secondaryPart: THREE.Object3D | null = null;
  let muzzleZ = -0.62;
  let muzzleY = 0.03;

  if (weaponId === 'assault_rifle') {
    addPart(new THREE.BoxGeometry(0.065, 0.09, 0.38), gunmetal, 0, 0, -0.1);
    addPart(new THREE.BoxGeometry(0.055, 0.075, 0.34), darkPolymer, 0, 0.005, -0.42); // handguard
    addPart(new THREE.BoxGeometry(0.058, 0.012, 0.36), steel, 0, 0.048, -0.26); // top rail
    addPart(new THREE.CylinderGeometry(0.013, 0.013, 0.32, 10), steel, 0, 0.022, -0.66, Math.PI / 2); // barrel
    addPart(new THREE.CylinderGeometry(0.018, 0.016, 0.06, 10), gunmetal, 0, 0.022, -0.82, Math.PI / 2); // compensator

    const magGroup = new THREE.Group();
    magGroup.position.set(0, -0.12, -0.16);
    addPart(new THREE.BoxGeometry(0.038, 0.16, 0.075), darkPolymer, 0, 0, 0, 0.08, magGroup);
    addPart(new THREE.BoxGeometry(0.042, 0.022, 0.08), steel, 0, -0.08, -0.008, 0.08, magGroup);
    root.add(magGroup);
    magazine = magGroup;

    addPart(new THREE.BoxGeometry(0.04, 0.11, 0.055), darkPolymer, 0, -0.09, 0.04); // grip
    addPart(new THREE.BoxGeometry(0.048, 0.06, 0.09), gunmetal, 0, 0.075, -0.12); // holo sight
    addPart(new THREE.BoxGeometry(0.034, 0.034, 0.01), opticGlass, 0, 0.078, -0.12);
    // Keep slideRestZ at exact -0.14 for Test N compatibility
    slideOrBolt = addPart(new THREE.BoxGeometry(0.018, 0.022, 0.08), steel, 0.036, 0.02, -0.14);
    secondaryPart = addPart(new THREE.BoxGeometry(0.044, 0.018, 0.032), steel, 0, 0.035, 0.04); // T-charging handle
    muzzleZ = -0.86;
    muzzleY = 0.022;
  } else if (weaponId === 'smg') {
    addPart(new THREE.BoxGeometry(0.058, 0.085, 0.3), gunmetal, 0, 0, -0.12);
    addPart(new THREE.CylinderGeometry(0.019, 0.019, 0.25, 10), darkPolymer, 0, 0.018, -0.38, Math.PI / 2); // suppressor
    const magGroup = new THREE.Group();
    magGroup.position.set(0, -0.11, -0.18);
    addPart(new THREE.BoxGeometry(0.032, 0.17, 0.048), darkPolymer, 0, 0, 0, 0.06, magGroup);
    root.add(magGroup);
    magazine = magGroup;

    addPart(new THREE.BoxGeometry(0.036, 0.095, 0.05), darkPolymer, 0, -0.08, 0.02);
    addPart(new THREE.BoxGeometry(0.04, 0.045, 0.06), gunmetal, 0, 0.065, -0.1);
    addPart(new THREE.BoxGeometry(0.028, 0.028, 0.01), opticGlass, 0, 0.068, -0.1);
    slideOrBolt = addPart(new THREE.BoxGeometry(0.018, 0.018, 0.055), steel, -0.033, 0.024, -0.2);
    muzzleZ = -0.52;
    muzzleY = 0.018;
  } else if (weaponId === 'sniper_rifle') {
    addPart(new THREE.BoxGeometry(0.06, 0.085, 0.48), oliveTube, 0, -0.01, -0.1);
    addPart(new THREE.CylinderGeometry(0.014, 0.016, 0.58, 10), steel, 0, 0.02, -0.6, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.045, 0.028, 0.06), gunmetal, 0, 0.02, -0.9, 0); // muzzle brake
    addPart(new THREE.CylinderGeometry(0.028, 0.028, 0.28, 12), gunmetal, 0, 0.085, -0.16, Math.PI / 2); // 6x scope
    addPart(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 12), opticGlass, 0, 0.085, -0.02, Math.PI / 2);

    const magGroup = new THREE.Group();
    magGroup.position.set(0, -0.09, -0.12);
    addPart(new THREE.BoxGeometry(0.042, 0.09, 0.08), darkPolymer, 0, 0, 0, 0, magGroup);
    root.add(magGroup);
    magazine = magGroup;

    const boltGroup = new THREE.Group();
    boltGroup.position.set(0.04, 0.025, -0.04);
    addPart(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 8), steel, 0, 0, 0, Math.PI / 2, boltGroup);
    addPart(new THREE.SphereGeometry(0.014, 8, 8), steel, 0.024, -0.012, 0.02, 0, boltGroup);
    root.add(boltGroup);
    slideOrBolt = boltGroup;
    muzzleZ = -0.94;
    muzzleY = 0.02;
  } else if (weaponId === 'shotgun') {
    addPart(new THREE.BoxGeometry(0.065, 0.09, 0.36), gunmetal, 0, 0, -0.08);
    addPart(new THREE.BoxGeometry(0.044, 0.1, 0.06), darkPolymer, 0, -0.085, 0.05);
    addPart(new THREE.CylinderGeometry(0.018, 0.018, 0.46, 10), steel, 0, 0.024, -0.46, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.016, 0.016, 0.39, 10), darkPolymer, 0, -0.016, -0.43, Math.PI / 2); // mag tube
    slideOrBolt = addPart(new THREE.BoxGeometry(0.062, 0.055, 0.16), darkPolymer, 0, -0.018, -0.36); // pump
    secondaryPart = addPart(new THREE.BoxGeometry(0.016, 0.026, 0.055), steel, 0.036, 0.012, -0.1); // bolt carrier
    muzzleZ = -0.71;
    muzzleY = 0.024;
  } else if (weaponId === 'lmg') {
    addPart(new THREE.BoxGeometry(0.09, 0.11, 0.44), gunmetal, 0, 0, -0.12);
    addPart(new THREE.BoxGeometry(0.07, 0.08, 0.28), darkPolymer, 0, -0.005, -0.44);
    addPart(new THREE.CylinderGeometry(0.016, 0.018, 0.48, 10), steel, 0, 0.025, -0.56, Math.PI / 2);

    const boxGroup = new THREE.Group();
    boxGroup.position.set(-0.03, -0.11, -0.14);
    addPart(new THREE.BoxGeometry(0.12, 0.13, 0.13), oliveTube, 0, 0, 0, 0, boxGroup);
    addPart(new THREE.BoxGeometry(0.06, 0.04, 0.04), steel, 0.03, 0.07, 0, 0, boxGroup); // brass belt link stub
    root.add(boxGroup);
    magazine = boxGroup;

    // Top feed tray cover (flips open during belt_box reload)
    const feedCoverPivot = new THREE.Group();
    feedCoverPivot.position.set(0, 0.06, -0.24);
    addPart(new THREE.BoxGeometry(0.075, 0.026, 0.22), steel, 0, 0.012, 0.12, 0, feedCoverPivot);
    root.add(feedCoverPivot);
    secondaryPart = feedCoverPivot;

    slideOrBolt = addPart(new THREE.BoxGeometry(0.02, 0.025, 0.07), steel, 0.05, 0.018, -0.14);
    muzzleZ = -0.82;
    muzzleY = 0.025;
  } else if (weaponId === 'pistol') {
    addPart(new THREE.BoxGeometry(0.042, 0.055, 0.22), darkPolymer, 0, -0.01, -0.1);
    slideOrBolt = addPart(new THREE.BoxGeometry(0.044, 0.042, 0.24), gunmetal, 0, 0.028, -0.11);
    addPart(new THREE.BoxGeometry(0.038, 0.11, 0.052), darkPolymer, 0, -0.07, -0.02);

    const magGroup = new THREE.Group();
    magGroup.position.set(0, -0.085, -0.02);
    addPart(new THREE.BoxGeometry(0.03, 0.1, 0.042), steel, 0, 0, 0, 0, magGroup);
    root.add(magGroup);
    magazine = magGroup;

    addPart(new THREE.BoxGeometry(0.016, 0.014, 0.012), opticGlass, 0, 0.055, -0.21); // tritium front post
    muzzleZ = -0.26;
    muzzleY = 0.028;
  } else if (weaponId === 'rocket_launcher') {
    // RPG-7V / AT-4X Bazooka Launcher Tube, Heat Shield, Venturi Cone & Conical PG-7V Warhead
    addPart(new THREE.CylinderGeometry(0.056, 0.056, 0.88, 14), oliveTube, 0, 0.02, -0.22, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.068, 0.068, 0.34, 14), darkPolymer, 0, 0.02, -0.18, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.054, 0.092, 0.16, 14), steel, 0, 0.02, 0.24, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.072, 0.064, 0.1, 14), darkPolymer, 0, 0.02, -0.64, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.04, 0.11, 0.055), darkPolymer, 0, -0.06, -0.18);
    addPart(new THREE.BoxGeometry(0.046, 0.065, 0.08), opticGlass, -0.068, 0.055, -0.26);

    const warheadGroup = new THREE.Group();
    warheadGroup.position.set(0, 0.02, -0.74);
    const warheadBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.092, 0.044, 0.16, 14),
      oliveTube
    );
    warheadBody.rotation.x = Math.PI / 2;
    const warheadNose = new THREE.Mesh(new THREE.ConeGeometry(0.092, 0.18, 14), steel);
    warheadNose.rotation.x = -Math.PI / 2;
    warheadNose.position.z = -0.17;
    warheadGroup.add(warheadBody, warheadNose);
    root.add(warheadGroup);
    slideOrBolt = warheadGroup;
    muzzleZ = -0.94;
    muzzleY = 0.02;
  } else if (weaponId === 'guided_missile') {
    addPart(new THREE.CylinderGeometry(0.082, 0.082, 0.98, 14), gunmetal, 0, 0.02, -0.22, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.094, 0.094, 0.14, 14), oliveTube, 0, 0.02, -0.66, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.11, 0.1, 0.18), darkPolymer, -0.07, 0.04, -0.3);
    addPart(new THREE.BoxGeometry(0.04, 0.06, 0.02), opticGlass, -0.09, 0.06, -0.21);
    slideOrBolt = addPart(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 12), steel, 0, 0.02, -0.68, Math.PI / 2);
    muzzleZ = -0.8;
    muzzleY = 0.02;
  } else {
    // grenade_launcher (rotary cylinder)
    addPart(new THREE.BoxGeometry(0.07, 0.09, 0.34), gunmetal, 0, 0.01, -0.08);
    addPart(new THREE.BoxGeometry(0.044, 0.11, 0.055), darkPolymer, 0, -0.08, 0.04);
    const drumGroup = new THREE.Group();
    drumGroup.position.set(0, 0.0, -0.22);
    addPart(new THREE.CylinderGeometry(0.072, 0.072, 0.14, 12), darkPolymer, 0, 0, 0, Math.PI / 2, drumGroup);
    // Brass cylinder ridges so rotary indexing is visually clear
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      addPart(
        new THREE.CylinderGeometry(0.016, 0.016, 0.144, 8),
        steel,
        Math.cos(ang) * 0.045,
        Math.sin(ang) * 0.045,
        0,
        Math.PI / 2,
        drumGroup
      );
    }
    root.add(drumGroup);
    slideOrBolt = drumGroup;
    addPart(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 12), steel, 0, 0.02, -0.44, Math.PI / 2);
    muzzleZ = -0.62;
    muzzleY = 0.02;
  }

  // Muzzle flash star mesh
  const muzzleFlash = new THREE.Mesh(new THREE.OctahedronGeometry(0.068, 0), flashMat);
  muzzleFlash.position.set(0, muzzleY, muzzleZ);
  muzzleFlash.visible = false;
  root.add(muzzleFlash);

  return {
    root,
    muzzleFlash,
    muzzleBasePos: new THREE.Vector3(0, muzzleY, muzzleZ),
    slideOrBolt,
    slideRestZ: slideOrBolt ? slideOrBolt.position.z : 0,
    magazine,
    magazineRestPos: magazine ? magazine.position.clone() : new THREE.Vector3(),
    secondaryPart,
    secondaryRestPos: secondaryPart ? secondaryPart.position.clone() : new THREE.Vector3(),
    animProfile: WEAPON_ANIM_PROFILES[weaponId],
  };
}
