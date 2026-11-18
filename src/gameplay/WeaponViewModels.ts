import * as THREE from 'three';
import { WeaponId } from '@/src/schemas/weapon.schema';
import {
  buildOperatorArmRig,
  createOperatorArmMaterialPalette,
  disposeOperatorArmMaterialPalette,
  HandGripPoseId,
  OperatorArmMaterialPalette,
  OperatorArmRigInstance,
} from './OperatorArmRig';
import { PER_WEAPON_OPTIC_CONFIGS } from './FirstPersonAnimationGraph';

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
  // Stage 5B TRN-19: Explicit named weapon sockets & articulated operator arm IK rig
  muzzleSocket: THREE.Object3D;
  opticSightSocket: THREE.Object3D;
  rightHandGripSocket: THREE.Object3D;
  leftHandForegripSocket: THREE.Object3D;
  magazineSocket: THREE.Object3D;
  chargingHandleSocket: THREE.Object3D;
  rightGripLocal: THREE.Vector3;
  leftForegripLocal: THREE.Vector3;
  magazineSocketLocal: THREE.Vector3;
  chargingHandleSocketLocal: THREE.Vector3;
  operatorArms: OperatorArmRigInstance;
}

export interface ViewModelMaterialBank {
  gunmetal: THREE.MeshStandardMaterial;
  darkPolymer: THREE.MeshStandardMaterial;
  oliveTube: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  tanCerakote: THREE.MeshStandardMaterial;
  opticGlass: THREE.MeshStandardMaterial;
  reticleEmissive: THREE.MeshBasicMaterial;
  flashMat: THREE.MeshBasicMaterial;
  armPalette: OperatorArmMaterialPalette;
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
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x20262e, metalness: 0.82, roughness: 0.31 }),
    darkPolymer: new THREE.MeshStandardMaterial({ color: 0x13171c, metalness: 0.18, roughness: 0.72 }),
    oliveTube: new THREE.MeshStandardMaterial({ color: 0x3b4933, metalness: 0.35, roughness: 0.56 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x525d6b, metalness: 0.88, roughness: 0.22 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc29b38, metalness: 0.86, roughness: 0.28 }),
    tanCerakote: new THREE.MeshStandardMaterial({ color: 0x6b5b45, metalness: 0.38, roughness: 0.58 }),
    opticGlass: new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.65,
      metalness: 0.92,
      roughness: 0.08,
    }),
    reticleEmissive: new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
    }),
    flashMat: new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.92,
    }),
    armPalette: createOperatorArmMaterialPalette(),
  };
}

export function disposeViewModelMaterialBank(bank: ViewModelMaterialBank): void {
  bank.gunmetal.dispose();
  bank.darkPolymer.dispose();
  bank.oliveTube.dispose();
  bank.steel.dispose();
  bank.brass.dispose();
  bank.tanCerakote.dispose();
  bank.opticGlass.dispose();
  bank.reticleEmissive.dispose();
  bank.flashMat.dispose();
  disposeOperatorArmMaterialPalette(bank.armPalette);
}

function getDefaultSupportPoseForWeapon(weaponId: WeaponId): HandGripPoseId {
  switch (weaponId) {
    case 'pistol':
      return 'pistol_two_hand_cup';
    case 'shotgun':
      return 'shotgun_pump_grip';
    case 'rocket_launcher':
    case 'guided_missile':
      return 'launcher_shoulder_cradle';
    case 'lmg':
      return 'foregrip_vertical';
    default:
      return 'foregrip_c_clamp';
  }
}

export function buildWeaponViewModel(
  weaponId: WeaponId,
  sharedBank?: ViewModelMaterialBank
): ViewModelRig {
  const root = new THREE.Group();
  root.name = `viewmodel_${weaponId}`;

  const bank = sharedBank ?? createViewModelMaterialBank();
  const {
    gunmetal,
    darkPolymer,
    oliveTube,
    steel,
    brass,
    tanCerakote,
    opticGlass,
    reticleEmissive,
    flashMat,
  } = bank;

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

  const addPicatinnyRail = (
    length: number,
    y: number,
    zCenter: number,
    toothCount = 8,
    parent: THREE.Object3D = root
  ): void => {
    addPart(new THREE.BoxGeometry(0.032, 0.008, length), steel, 0, y, zCenter, 0, parent);
    const step = length / Math.max(1, toothCount);
    const startZ = zCenter - length * 0.5 + step * 0.5;
    for (let i = 0; i < toothCount; i++) {
      addPart(
        new THREE.BoxGeometry(0.036, 0.006, step * 0.48),
        gunmetal,
        0,
        y + 0.006,
        startZ + i * step,
        0,
        parent
      );
    }
  };

  let slideOrBolt: THREE.Object3D | null = null;
  let magazine: THREE.Object3D | null = null;
  let secondaryPart: THREE.Object3D | null = null;
  let muzzleZ = -0.62;
  let muzzleY = 0.03;

  // Socket anchors in weapon-root space
  const rightGripLocal = new THREE.Vector3(0.0, -0.088, 0.035);
  const leftForegripLocal = new THREE.Vector3(-0.015, -0.022, -0.34);
  const magazineSocketLocal = new THREE.Vector3(0.0, -0.12, -0.16);
  const chargingHandleSocketLocal = new THREE.Vector3(0.036, 0.024, -0.14);

  if (weaponId === 'assault_rifle') {
    // M4A1-S Upper & Lower Receiver + Buffer Tube + Collapsible Sopmod Stock
    addPart(new THREE.BoxGeometry(0.064, 0.088, 0.36), gunmetal, 0, 0.002, -0.09);
    addPart(new THREE.BoxGeometry(0.056, 0.048, 0.16), darkPolymer, 0, -0.028, -0.04); // lower receiver magwell flare
    addPart(new THREE.CylinderGeometry(0.018, 0.018, 0.18, 10), gunmetal, 0, 0.016, 0.16, Math.PI / 2); // buffer tube
    addPart(new THREE.BoxGeometry(0.048, 0.11, 0.15), darkPolymer, 0, -0.012, 0.21); // tactical stock
    addPart(new THREE.BoxGeometry(0.052, 0.116, 0.022), tanCerakote, 0, -0.012, 0.286); // rubber buttpad

    // Free-Float M-LOK Handguard + Ventilation Slots + PEQ-15 Laser Module
    addPart(new THREE.BoxGeometry(0.055, 0.074, 0.35), darkPolymer, 0, 0.006, -0.42);
    for (let s = 0; s < 4; s++) {
      addPart(new THREE.BoxGeometry(0.059, 0.014, 0.046), steel, 0, 0.012, -0.30 - s * 0.072);
    }
    addPicatinnyRail(0.52, 0.048, -0.26, 12);
    // Top-mounted AN/PEQ-15 laser aiming module (offset slightly left so optic sight line is clear)
    addPart(new THREE.BoxGeometry(0.036, 0.022, 0.075), tanCerakote, -0.018, 0.056, -0.49);
    addPart(new THREE.CylinderGeometry(0.005, 0.005, 0.016, 8), opticGlass, -0.026, 0.058, -0.532, Math.PI / 2);

    // Angled Foregrip on M-LOK under-rail
    addPart(new THREE.BoxGeometry(0.032, 0.042, 0.09), darkPolymer, 0, -0.042, -0.38, 0.25);

    // Barrel + Gas Block + Multi-port Compensator
    addPart(new THREE.CylinderGeometry(0.013, 0.013, 0.34, 12), steel, 0, 0.022, -0.66, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.024, 0.036, 0.034), gunmetal, 0, 0.028, -0.58); // low-profile gas block
    addPart(new THREE.CylinderGeometry(0.018, 0.016, 0.065, 12), gunmetal, 0, 0.022, -0.825, Math.PI / 2);

    // Polymer Windowed PMAG Magazine
    const magGroup = new THREE.Group();
    magGroup.position.set(0, -0.12, -0.16);
    addPart(new THREE.BoxGeometry(0.038, 0.16, 0.075), darkPolymer, 0, 0, 0, 0.08, magGroup);
    addPart(new THREE.BoxGeometry(0.04, 0.09, 0.018), brass, 0, 0.01, -0.005, 0.08, magGroup); // brass cartridge window
    addPart(new THREE.BoxGeometry(0.042, 0.022, 0.082), tanCerakote, 0, -0.08, -0.008, 0.08, magGroup);
    root.add(magGroup);
    magazine = magGroup;

    // Ergonomic Pistol Grip + Trigger Guard + Curved Trigger
    addPart(new THREE.BoxGeometry(0.04, 0.11, 0.055), darkPolymer, 0, -0.09, 0.04, -0.18);
    addPart(new THREE.BoxGeometry(0.018, 0.006, 0.05), gunmetal, 0, -0.048, -0.025); // trigger guard
    addPart(new THREE.BoxGeometry(0.008, 0.026, 0.01), steel, 0, -0.034, -0.015, 0.22); // trigger blade

    // Holographic EOTech-style Reflex Sight
    addPart(new THREE.BoxGeometry(0.048, 0.058, 0.092), gunmetal, 0, 0.075, -0.12);
    addPart(new THREE.BoxGeometry(0.036, 0.034, 0.008), opticGlass, 0, 0.078, -0.12);
    addPart(new THREE.BoxGeometry(0.004, 0.004, 0.002), reticleEmissive, 0, 0.078, -0.115);

    // Keep slideRestZ at exact -0.14 for Test N compatibility
    slideOrBolt = addPart(new THREE.BoxGeometry(0.018, 0.022, 0.08), steel, 0.036, 0.02, -0.14);
    secondaryPart = addPart(new THREE.BoxGeometry(0.044, 0.018, 0.032), steel, 0, 0.035, 0.04); // T-charging handle
    muzzleZ = -0.86;
    muzzleY = 0.022;

    rightGripLocal.set(0.0, -0.088, 0.04);
    leftForegripLocal.set(-0.012, -0.028, -0.37);
    magazineSocketLocal.set(0, -0.12, -0.16);
    chargingHandleSocketLocal.set(0.0, 0.035, 0.04);
  } else if (weaponId === 'smg') {
    // Vector-9 / MP7 Tactical PDW Receiver + Folding Cheek Rest + Integrated Vertical Grip
    addPart(new THREE.BoxGeometry(0.058, 0.088, 0.31), gunmetal, 0, 0, -0.12);
    addPart(new THREE.BoxGeometry(0.048, 0.068, 0.12), darkPolymer, 0, -0.032, -0.19); // forward magwell housing
    addPart(new THREE.BoxGeometry(0.028, 0.085, 0.038), darkPolymer, 0, -0.065, -0.25); // vertical foregrip
    addPicatinnyRail(0.28, 0.048, -0.12, 8);
    addPart(new THREE.CylinderGeometry(0.021, 0.021, 0.24, 12), darkPolymer, 0, 0.018, -0.38, Math.PI / 2); // suppressor
    addPart(new THREE.CylinderGeometry(0.023, 0.023, 0.035, 12), steel, 0, 0.018, -0.29, Math.PI / 2); // suppressor locking collar

    const magGroup = new THREE.Group();
    magGroup.position.set(0, -0.11, -0.18);
    addPart(new THREE.BoxGeometry(0.032, 0.175, 0.048), darkPolymer, 0, 0, 0, 0.08, magGroup);
    addPart(new THREE.BoxGeometry(0.036, 0.02, 0.054), tanCerakote, 0, -0.088, -0.006, 0.08, magGroup);
    root.add(magGroup);
    magazine = magGroup;

    addPart(new THREE.BoxGeometry(0.036, 0.095, 0.05), darkPolymer, 0, -0.08, 0.02, -0.12);
    addPart(new THREE.BoxGeometry(0.04, 0.045, 0.06), gunmetal, 0, 0.065, -0.1);
    addPart(new THREE.BoxGeometry(0.028, 0.028, 0.008), opticGlass, 0, 0.068, -0.1);
    addPart(new THREE.BoxGeometry(0.0035, 0.0035, 0.002), reticleEmissive, 0, 0.068, -0.095);
    slideOrBolt = addPart(new THREE.BoxGeometry(0.018, 0.018, 0.055), steel, -0.033, 0.024, -0.2);
    muzzleZ = -0.52;
    muzzleY = 0.018;

    rightGripLocal.set(0.0, -0.08, 0.02);
    leftForegripLocal.set(-0.008, -0.062, -0.25);
    magazineSocketLocal.set(0, -0.11, -0.18);
    chargingHandleSocketLocal.set(-0.033, 0.024, -0.2);
  } else if (weaponId === 'sniper_rifle') {
    // SR-50 Longbow Precision Chassis + Cheek Riser + Fluted Bull Barrel + Folding Bipod + 6x Scope
    addPart(new THREE.BoxGeometry(0.062, 0.086, 0.49), oliveTube, 0, -0.01, -0.1);
    addPart(new THREE.BoxGeometry(0.054, 0.045, 0.14), darkPolymer, 0, 0.034, 0.12); // adjustable cheek riser
    addPart(new THREE.CylinderGeometry(0.014, 0.017, 0.58, 12), steel, 0, 0.02, -0.6, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.048, 0.03, 0.068), gunmetal, 0, 0.02, -0.9, 0); // dual-baffle arrowhead brake
    // Folding bipod legs tucked along forend
    addPart(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 8), gunmetal, -0.032, -0.048, -0.44, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 8), gunmetal, 0.032, -0.048, -0.44, Math.PI / 2);

    // 6x Variable Precision Scope + Objective Bell + Elevation/Windage Turrets
    addPart(new THREE.CylinderGeometry(0.026, 0.026, 0.28, 14), gunmetal, 0, 0.085, -0.16, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.033, 0.026, 0.07, 14), gunmetal, 0, 0.085, -0.31, Math.PI / 2); // sunshade bell
    addPart(new THREE.CylinderGeometry(0.014, 0.014, 0.026, 10), steel, 0, 0.114, -0.15); // elevation turret
    addPart(new THREE.CylinderGeometry(0.024, 0.024, 0.016, 12), opticGlass, 0, 0.085, -0.02, Math.PI / 2);

    const magGroup = new THREE.Group();
    magGroup.position.set(0, -0.09, -0.12);
    addPart(new THREE.BoxGeometry(0.044, 0.095, 0.088), darkPolymer, 0, 0, 0, 0, magGroup);
    addPart(new THREE.BoxGeometry(0.046, 0.018, 0.092), steel, 0, -0.045, 0, 0, magGroup);
    root.add(magGroup);
    magazine = magGroup;

    addPart(new THREE.BoxGeometry(0.04, 0.105, 0.052), darkPolymer, 0, -0.085, 0.05, -0.15);

    const boltGroup = new THREE.Group();
    boltGroup.position.set(0.04, 0.025, -0.04);
    addPart(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 8), steel, 0, 0, 0, Math.PI / 2, boltGroup);
    addPart(new THREE.SphereGeometry(0.014, 8, 8), steel, 0.024, -0.012, 0.02, 0, boltGroup);
    root.add(boltGroup);
    slideOrBolt = boltGroup;
    muzzleZ = -0.94;
    muzzleY = 0.02;

    rightGripLocal.set(0.0, -0.085, 0.05);
    leftForegripLocal.set(-0.012, -0.025, -0.34);
    magazineSocketLocal.set(0, -0.09, -0.12);
    chargingHandleSocketLocal.set(0.055, 0.025, -0.04);
  } else if (weaponId === 'shotgun') {
    // M870 Breacher Tactical Shotgun + Perforated Heat Shield + Side Shell Saddle + Ghost Ring Sight
    addPart(new THREE.BoxGeometry(0.065, 0.09, 0.36), gunmetal, 0, 0, -0.08);
    addPart(new THREE.BoxGeometry(0.044, 0.1, 0.06), darkPolymer, 0, -0.085, 0.05, -0.16);
    addPart(new THREE.CylinderGeometry(0.018, 0.018, 0.46, 12), steel, 0, 0.024, -0.46, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 12), gunmetal, 0, 0.028, -0.39, Math.PI / 2); // perforated heat shield
    addPart(new THREE.CylinderGeometry(0.016, 0.016, 0.41, 12), darkPolymer, 0, -0.016, -0.43, Math.PI / 2); // mag tube
    // Left receiver 4-shell tactical carrier with brass bases
    for (let sh = 0; sh < 4; sh++) {
      addPart(new THREE.CylinderGeometry(0.009, 0.009, 0.052, 8), tanCerakote, -0.036, 0.004, -0.02 - sh * 0.034);
      addPart(new THREE.CylinderGeometry(0.0095, 0.0095, 0.012, 8), brass, -0.036, 0.026, -0.02 - sh * 0.034);
    }
    addPart(new THREE.BoxGeometry(0.024, 0.022, 0.018), steel, 0, 0.054, -0.02); // ghost ring rear sight
    addPart(new THREE.BoxGeometry(0.008, 0.016, 0.012), opticGlass, 0, 0.044, -0.66); // fiber-optic front bead

    slideOrBolt = addPart(new THREE.BoxGeometry(0.064, 0.058, 0.17), darkPolymer, 0, -0.018, -0.36); // ribbed pump forend
    secondaryPart = addPart(new THREE.BoxGeometry(0.016, 0.026, 0.055), steel, 0.036, 0.012, -0.1); // bolt carrier
    muzzleZ = -0.71;
    muzzleY = 0.024;

    rightGripLocal.set(0.0, -0.085, 0.05);
    leftForegripLocal.set(0.0, -0.028, -0.36);
    magazineSocketLocal.set(0.0, -0.045, -0.16);
    chargingHandleSocketLocal.set(0.0, -0.018, -0.36);
  } else if (weaponId === 'lmg') {
    // M249 Vulcan Squad Automatic Weapon + Heat Shield + Brass Disintegrating Link Belt + Box Mag
    addPart(new THREE.BoxGeometry(0.09, 0.11, 0.44), gunmetal, 0, 0, -0.12);
    addPart(new THREE.BoxGeometry(0.072, 0.082, 0.28), darkPolymer, 0, -0.005, -0.44);
    addPart(new THREE.CylinderGeometry(0.016, 0.018, 0.49, 12), steel, 0, 0.025, -0.56, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.068, 0.032, 0.26), steel, 0, 0.046, -0.44); // perforated barrel heat shield
    // Top carry handle (folded right so sight line stays clear)
    addPart(new THREE.CylinderGeometry(0.007, 0.007, 0.09, 8), darkPolymer, 0.056, 0.055, -0.31, 0);

    const boxGroup = new THREE.Group();
    boxGroup.position.set(-0.03, -0.11, -0.14);
    addPart(new THREE.BoxGeometry(0.12, 0.13, 0.13), oliveTube, 0, 0, 0, 0, boxGroup);
    // Visible brass ammo belt links feeding up from box into feed tray
    for (let b = 0; b < 5; b++) {
      addPart(
        new THREE.CylinderGeometry(0.006, 0.006, 0.058, 8),
        brass,
        0.028,
        0.055 + b * 0.014,
        -0.015 + b * 0.004,
        0,
        boxGroup
      );
    }
    root.add(boxGroup);
    magazine = boxGroup;

    // Top feed tray cover (flips open during belt_box reload)
    const feedCoverPivot = new THREE.Group();
    feedCoverPivot.position.set(0, 0.06, -0.24);
    addPart(new THREE.BoxGeometry(0.075, 0.026, 0.22), steel, 0, 0.012, 0.12, 0, feedCoverPivot);
    addPicatinnyRail(0.16, 0.027, 0.12, 6, feedCoverPivot);
    root.add(feedCoverPivot);
    secondaryPart = feedCoverPivot;

    addPart(new THREE.BoxGeometry(0.042, 0.11, 0.055), darkPolymer, 0, -0.09, 0.04, -0.15);
    slideOrBolt = addPart(new THREE.BoxGeometry(0.02, 0.025, 0.07), steel, 0.05, 0.018, -0.14);
    muzzleZ = -0.82;
    muzzleY = 0.025;

    rightGripLocal.set(0.0, -0.09, 0.04);
    leftForegripLocal.set(-0.02, -0.045, -0.40);
    magazineSocketLocal.set(-0.03, -0.11, -0.14);
    chargingHandleSocketLocal.set(0.05, 0.018, -0.14);
  } else if (weaponId === 'pistol') {
    // P226 Tactical Sidearm + Serrated Slide + Under-barrel Rail Light + Tritium 3-Dot Night Sights
    addPart(new THREE.BoxGeometry(0.042, 0.052, 0.22), darkPolymer, 0, -0.01, -0.1);
    addPart(new THREE.BoxGeometry(0.034, 0.024, 0.068), gunmetal, 0, -0.028, -0.17); // tactical weapon light
    addPart(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 10), opticGlass, 0, -0.028, -0.206, Math.PI / 2);

    const slideGroup = new THREE.Group();
    slideGroup.position.set(0, 0.028, -0.11);
    addPart(new THREE.BoxGeometry(0.044, 0.042, 0.24), gunmetal, 0, 0, 0, 0, slideGroup);
    addPart(new THREE.BoxGeometry(0.038, 0.014, 0.016), steel, 0, 0.025, 0.095, 0, slideGroup); // rear sight notch
    addPart(new THREE.BoxGeometry(0.012, 0.014, 0.012), opticGlass, 0, 0.026, -0.105, 0, slideGroup); // tritium front post
    root.add(slideGroup);
    slideOrBolt = slideGroup;

    addPart(new THREE.BoxGeometry(0.038, 0.11, 0.052), darkPolymer, 0, -0.07, -0.02, -0.14);

    const magGroup = new THREE.Group();
    magGroup.position.set(0, -0.085, -0.02);
    addPart(new THREE.BoxGeometry(0.03, 0.1, 0.042), steel, 0, 0, 0, -0.14, magGroup);
    addPart(new THREE.BoxGeometry(0.034, 0.016, 0.048), darkPolymer, 0, -0.052, 0.006, -0.14, magGroup);
    root.add(magGroup);
    magazine = magGroup;

    muzzleZ = -0.26;
    muzzleY = 0.028;

    rightGripLocal.set(0.0, -0.07, -0.02);
    leftForegripLocal.set(-0.016, -0.072, -0.03);
    magazineSocketLocal.set(0, -0.085, -0.02);
    chargingHandleSocketLocal.set(0, 0.032, -0.08);
  } else if (weaponId === 'rocket_launcher') {
    // RPG-7V / AT-4X Bazooka Launcher Tube, Heat Shield, Venturi Cone & Conical PG-7V Warhead
    addPart(new THREE.CylinderGeometry(0.056, 0.056, 0.88, 16), oliveTube, 0, 0.02, -0.22, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.068, 0.068, 0.34, 16), tanCerakote, 0, 0.02, -0.18, Math.PI / 2); // thermal wood/composite shield
    addPart(new THREE.CylinderGeometry(0.054, 0.092, 0.16, 16), steel, 0, 0.02, 0.24, Math.PI / 2); // rear Venturi bell
    addPart(new THREE.CylinderGeometry(0.072, 0.064, 0.1, 16), darkPolymer, 0, 0.02, -0.64, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.04, 0.11, 0.055), darkPolymer, 0, -0.06, -0.18, -0.12); // primary firing grip
    addPart(new THREE.BoxGeometry(0.038, 0.1, 0.05), darkPolymer, 0, -0.06, -0.02, -0.08); // rear stabilizer grip
    addPart(new THREE.BoxGeometry(0.046, 0.065, 0.08), gunmetal, -0.068, 0.055, -0.26); // side PGO-7 optical sight
    addPart(new THREE.BoxGeometry(0.036, 0.048, 0.012), opticGlass, -0.068, 0.056, -0.22);

    const warheadGroup = new THREE.Group();
    warheadGroup.position.set(0, 0.02, -0.74);
    const warheadBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.092, 0.044, 0.16, 16),
      oliveTube
    );
    warheadBody.rotation.x = Math.PI / 2;
    const warheadNose = new THREE.Mesh(new THREE.ConeGeometry(0.092, 0.18, 16), steel);
    warheadNose.rotation.x = -Math.PI / 2;
    warheadNose.position.z = -0.17;
    const piezoTip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.045, 10), brass);
    piezoTip.rotation.x = Math.PI / 2;
    piezoTip.position.z = -0.27;
    warheadGroup.add(warheadBody, warheadNose, piezoTip);
    root.add(warheadGroup);
    slideOrBolt = warheadGroup;
    muzzleZ = -0.94;
    muzzleY = 0.02;

    rightGripLocal.set(0.0, -0.065, -0.18);
    leftForegripLocal.set(-0.042, -0.038, -0.44);
    magazineSocketLocal.set(0, 0.02, -0.74);
    chargingHandleSocketLocal.set(-0.055, 0.02, -0.58);
  } else if (weaponId === 'guided_missile') {
    // FGM-148 Javelin / Lock-On Command Launch Unit (CLU) + Thermal Seeker Hood + Foam End Caps
    addPart(new THREE.CylinderGeometry(0.082, 0.082, 0.98, 16), gunmetal, 0, 0.02, -0.22, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.096, 0.096, 0.14, 16), oliveTube, 0, 0.02, -0.66, Math.PI / 2);
    addPart(new THREE.CylinderGeometry(0.094, 0.094, 0.12, 16), oliveTube, 0, 0.02, 0.22, Math.PI / 2);
    addPart(new THREE.BoxGeometry(0.11, 0.11, 0.19), darkPolymer, -0.072, 0.04, -0.3); // CLU electronics housing
    addPart(new THREE.BoxGeometry(0.044, 0.064, 0.016), opticGlass, -0.092, 0.06, -0.205); // FLIR seeker display
    addPart(new THREE.CylinderGeometry(0.032, 0.032, 0.04, 12), opticGlass, -0.085, 0.055, -0.40, Math.PI / 2); // forward IR lens
    slideOrBolt = addPart(new THREE.CylinderGeometry(0.052, 0.052, 0.18, 12), steel, 0, 0.02, -0.68, Math.PI / 2);
    muzzleZ = -0.8;
    muzzleY = 0.02;

    rightGripLocal.set(0.02, -0.055, -0.18);
    leftForegripLocal.set(-0.085, -0.025, -0.32);
    magazineSocketLocal.set(0, 0.02, -0.68);
    chargingHandleSocketLocal.set(-0.075, 0.04, -0.3);
  } else {
    // M32 Six-Shot Rotary Grenade Launcher
    addPart(new THREE.BoxGeometry(0.07, 0.09, 0.34), gunmetal, 0, 0.01, -0.08);
    addPart(new THREE.BoxGeometry(0.044, 0.11, 0.055), darkPolymer, 0, -0.08, 0.04, -0.15);
    addPart(new THREE.BoxGeometry(0.032, 0.085, 0.042), darkPolymer, 0, -0.048, -0.42, 0.12); // forward vertical grip
    addPicatinnyRail(0.24, 0.058, -0.42, 7);
    addPart(new THREE.BoxGeometry(0.026, 0.038, 0.016), opticGlass, 0, 0.072, -0.34); // quadrant reflex leaf

    const drumGroup = new THREE.Group();
    drumGroup.position.set(0, 0.0, -0.22);
    addPart(new THREE.CylinderGeometry(0.072, 0.072, 0.14, 14), darkPolymer, 0, 0, 0, Math.PI / 2, drumGroup);
    // 6 fluted 40mm chambers with visible golden-brass 40x46mm grenade casings
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      const cx = Math.cos(ang) * 0.045;
      const cy = Math.sin(ang) * 0.045;
      addPart(
        new THREE.CylinderGeometry(0.017, 0.017, 0.144, 10),
        steel,
        cx,
        cy,
        0,
        Math.PI / 2,
        drumGroup
      );
      addPart(
        new THREE.CylinderGeometry(0.014, 0.014, 0.148, 8),
        brass,
        cx,
        cy,
        0.002,
        Math.PI / 2,
        drumGroup
      );
    }
    root.add(drumGroup);
    slideOrBolt = drumGroup;
    addPart(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 12), steel, 0, 0.02, -0.44, Math.PI / 2);
    muzzleZ = -0.62;
    muzzleY = 0.02;

    rightGripLocal.set(0.0, -0.08, 0.04);
    leftForegripLocal.set(-0.008, -0.048, -0.42);
    magazineSocketLocal.set(-0.08, -0.02, -0.22);
    chargingHandleSocketLocal.set(-0.06, 0.02, -0.22);
  }

  // Muzzle flash star mesh
  const muzzleFlash = new THREE.Mesh(new THREE.OctahedronGeometry(0.068, 0), flashMat);
  muzzleFlash.position.set(0, muzzleY, muzzleZ);
  muzzleFlash.visible = false;
  root.add(muzzleFlash);

  // Explicit named sockets attached to root for animation graph & IK targeting
  const opticCfg = PER_WEAPON_OPTIC_CONFIGS[weaponId];
  const muzzleSocket = new THREE.Object3D();
  muzzleSocket.name = 'socket_muzzle';
  muzzleSocket.position.set(0, muzzleY, muzzleZ);

  const opticSightSocket = new THREE.Object3D();
  opticSightSocket.name = 'socket_optic_sight';
  opticSightSocket.position.set(
    opticCfg.sightAxisOffset[0],
    opticCfg.sightAxisOffset[1],
    opticCfg.sightAxisOffset[2]
  );

  const rightHandGripSocket = new THREE.Object3D();
  rightHandGripSocket.name = 'socket_right_hand_grip';
  rightHandGripSocket.position.copy(rightGripLocal);

  const leftHandForegripSocket = new THREE.Object3D();
  leftHandForegripSocket.name = 'socket_left_hand_foregrip';
  leftHandForegripSocket.position.copy(leftForegripLocal);

  const magazineSocket = new THREE.Object3D();
  magazineSocket.name = 'socket_magazine';
  magazineSocket.position.copy(magazineSocketLocal);

  const chargingHandleSocket = new THREE.Object3D();
  chargingHandleSocket.name = 'socket_charging_handle';
  chargingHandleSocket.position.copy(chargingHandleSocketLocal);

  root.add(
    muzzleSocket,
    opticSightSocket,
    rightHandGripSocket,
    leftHandForegripSocket,
    magazineSocket,
    chargingHandleSocket
  );

  // Build articulated first-person operator arm rig and solve default hold pose
  const operatorArms = buildOperatorArmRig(bank.armPalette);
  root.add(operatorArms.root);
  const supportPose = getDefaultSupportPoseForWeapon(weaponId);
  const firingPose: HandGripPoseId =
    weaponId === 'rocket_launcher' || weaponId === 'guided_missile'
      ? 'launcher_shoulder_cradle'
      : 'rifle_grip_trigger';
  operatorArms.solveWeaponHold(leftForegripLocal, rightGripLocal, supportPose, firingPose, 0);

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
    muzzleSocket,
    opticSightSocket,
    rightHandGripSocket,
    leftHandForegripSocket,
    magazineSocket,
    chargingHandleSocket,
    rightGripLocal,
    leftForegripLocal,
    magazineSocketLocal,
    chargingHandleSocketLocal,
    operatorArms,
  };
}
