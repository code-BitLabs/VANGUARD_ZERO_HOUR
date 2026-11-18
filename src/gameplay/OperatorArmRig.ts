import * as THREE from 'three';
import { WeaponId } from '@/src/schemas/weapon.schema';

export type HandGripPoseId =
  | 'pistol_grip_trigger'
  | 'rifle_grip_trigger'
  | 'foregrip_cradle'
  | 'foregrip_c_clamp'
  | 'foregrip_vertical'
  | 'vertical_grip_wrap'
  | 'pistol_two_hand_cup'
  | 'shotgun_pump_grip'
  | 'mag_pinch_grab'
  | 'charging_bolt_hook'
  | 'knife_reverse_grip'
  | 'launcher_shoulder_brace'
  | 'launcher_shoulder_cradle';

export interface FingerChainNodes {
  proximal: THREE.Group;
  distal: THREE.Group;
}

export interface ArticulatedArmChain {
  side: 'left' | 'right';
  shoulderRoot: THREE.Group;
  upperArm: THREE.Group;
  elbowJoint: THREE.Group;
  forearm: THREE.Group;
  wristJoint: THREE.Group;
  palmGroup: THREE.Group;
  fingers: {
    thumb: FingerChainNodes;
    index: FingerChainNodes;
    middle: FingerChainNodes;
    ring: FingerChainNodes;
    little: FingerChainNodes;
  };
  upperArmLength: number;
  forearmLength: number;
}

export interface OperatorArmRigInstance {
  root: THREE.Group;
  leftArm: ArticulatedArmChain;
  rightArm: ArticulatedArmChain;
  solveWeaponHold: (
    leftTargetLocal: THREE.Vector3,
    rightTargetLocal: THREE.Vector3,
    leftPose: HandGripPoseId,
    rightPose: HandGripPoseId,
    triggerPull01?: number
  ) => void;
  resetToNeutralHold: () => void;
  dispose: () => void;
}

const FINGER_POSE_CURLS: Record<
  HandGripPoseId,
  {
    thumb: [number, number];
    index: [number, number];
    middle: [number, number];
    ring: [number, number];
    little: [number, number];
  }
> = {
  pistol_grip_trigger: {
    thumb: [0.55, 0.45],
    index: [0.42, 0.58],
    middle: [1.15, 1.05],
    ring: [1.22, 1.12],
    little: [1.28, 1.15],
  },
  rifle_grip_trigger: {
    thumb: [0.58, 0.45],
    index: [0.44, 0.6],
    middle: [1.16, 1.06],
    ring: [1.22, 1.12],
    little: [1.28, 1.15],
  },
  foregrip_cradle: {
    thumb: [0.65, 0.35],
    index: [0.78, 0.72],
    middle: [0.85, 0.78],
    ring: [0.92, 0.82],
    little: [0.96, 0.85],
  },
  foregrip_c_clamp: {
    thumb: [0.52, 0.38],
    index: [0.82, 0.74],
    middle: [0.9, 0.8],
    ring: [0.96, 0.86],
    little: [1.02, 0.9],
  },
  foregrip_vertical: {
    thumb: [0.86, 0.6],
    index: [1.1, 0.96],
    middle: [1.16, 1.02],
    ring: [1.2, 1.06],
    little: [1.24, 1.08],
  },
  vertical_grip_wrap: {
    thumb: [0.88, 0.62],
    index: [1.12, 0.98],
    middle: [1.18, 1.05],
    ring: [1.22, 1.08],
    little: [1.25, 1.1],
  },
  pistol_two_hand_cup: {
    thumb: [0.48, 0.36],
    index: [0.92, 0.88],
    middle: [1.0, 0.94],
    ring: [1.08, 0.98],
    little: [1.14, 1.02],
  },
  shotgun_pump_grip: {
    thumb: [0.72, 0.42],
    index: [0.88, 0.82],
    middle: [0.95, 0.86],
    ring: [1.02, 0.92],
    little: [1.08, 0.95],
  },
  mag_pinch_grab: {
    thumb: [0.75, 0.52],
    index: [0.68, 0.64],
    middle: [0.74, 0.7],
    ring: [0.82, 0.76],
    little: [0.88, 0.8],
  },
  charging_bolt_hook: {
    thumb: [0.35, 0.25],
    index: [1.25, 1.15],
    middle: [1.22, 1.12],
    ring: [0.45, 0.4],
    little: [0.4, 0.35],
  },
  knife_reverse_grip: {
    thumb: [0.95, 0.78],
    index: [1.25, 1.15],
    middle: [1.28, 1.18],
    ring: [1.32, 1.2],
    little: [1.35, 1.22],
  },
  launcher_shoulder_brace: {
    thumb: [0.82, 0.58],
    index: [1.05, 0.92],
    middle: [1.12, 0.98],
    ring: [1.16, 1.02],
    little: [1.2, 1.05],
  },
  launcher_shoulder_cradle: {
    thumb: [0.8, 0.55],
    index: [1.02, 0.9],
    middle: [1.1, 0.96],
    ring: [1.14, 1.0],
    little: [1.18, 1.04],
  },
};

export interface ArmMaterialPalette {
  sleeveFabric: THREE.MeshStandardMaterial;
  forearmPad: THREE.MeshStandardMaterial;
  gloveLeather: THREE.MeshStandardMaterial;
  knuckleCarbon: THREE.MeshStandardMaterial;
  watchBezel: THREE.MeshStandardMaterial;
  watchScreenEmissive: THREE.MeshStandardMaterial;
}
export type OperatorArmMaterialPalette = ArmMaterialPalette;

export function createOperatorArmMaterialPalette(): ArmMaterialPalette {
  return {
    sleeveFabric: new THREE.MeshStandardMaterial({
      color: 0x3b4436,
      roughness: 0.84,
      metalness: 0.06,
    }),
    forearmPad: new THREE.MeshStandardMaterial({
      color: 0x262b24,
      roughness: 0.58,
      metalness: 0.28,
    }),
    gloveLeather: new THREE.MeshStandardMaterial({
      color: 0x1c2026,
      roughness: 0.66,
      metalness: 0.18,
    }),
    knuckleCarbon: new THREE.MeshStandardMaterial({
      color: 0x11151c,
      roughness: 0.34,
      metalness: 0.65,
    }),
    watchBezel: new THREE.MeshStandardMaterial({
      color: 0x181c22,
      roughness: 0.28,
      metalness: 0.82,
    }),
    watchScreenEmissive: new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    }),
  };
}

export function disposeOperatorArmMaterialPalette(palette: ArmMaterialPalette): void {
  palette.sleeveFabric.dispose();
  palette.forearmPad.dispose();
  palette.gloveLeather.dispose();
  palette.knuckleCarbon.dispose();
  palette.watchBezel.dispose();
  palette.watchScreenEmissive.dispose();
}

function buildSingleArmChain(
  side: 'left' | 'right',
  mats: ArmMaterialPalette
): ArticulatedArmChain {
  const sign = side === 'right' ? 1 : -1;
  const upperArmLength = 0.25;
  const forearmLength = 0.24;

  const shoulderRoot = new THREE.Group();
  shoulderRoot.name = `${side}_shoulder_root`;
  shoulderRoot.position.set(sign * 0.21, -0.17, 0.16);

  const upperArm = new THREE.Group();
  upperArm.name = `${side}_upper_arm`;
  shoulderRoot.add(upperArm);

  // Upper sleeve cylinder along -Z
  const upperGeo = new THREE.CylinderGeometry(0.044, 0.052, upperArmLength, 10);
  upperGeo.rotateX(Math.PI / 2);
  const upperMesh = new THREE.Mesh(upperGeo, mats.sleeveFabric);
  upperMesh.position.set(0, 0, -upperArmLength * 0.5);
  upperArm.add(upperMesh);

  const elbowJoint = new THREE.Group();
  elbowJoint.name = `${side}_elbow_joint`;
  elbowJoint.position.set(0, 0, -upperArmLength);
  upperArm.add(elbowJoint);

  const forearm = new THREE.Group();
  forearm.name = `${side}_forearm`;
  elbowJoint.add(forearm);

  // Forearm sleeve & tactical cuff
  const foreGeo = new THREE.CylinderGeometry(0.036, 0.045, forearmLength, 10);
  foreGeo.rotateX(Math.PI / 2);
  const foreMesh = new THREE.Mesh(foreGeo, mats.sleeveFabric);
  foreMesh.position.set(0, 0, -forearmLength * 0.5);
  forearm.add(foreMesh);

  // Molded forearm armor guard plate
  const padGeo = new THREE.BoxGeometry(0.056, 0.022, forearmLength * 0.68);
  const padMesh = new THREE.Mesh(padGeo, mats.forearmPad);
  padMesh.position.set(sign * 0.012, 0.024, -forearmLength * 0.48);
  forearm.add(padMesh);

  // Left-arm tactical GPS / telemetry wristwatch near cuff
  if (side === 'left') {
    const strapGeo = new THREE.CylinderGeometry(0.039, 0.039, 0.024, 12);
    strapGeo.rotateX(Math.PI / 2);
    const strap = new THREE.Mesh(strapGeo, mats.watchBezel);
    strap.position.set(0, 0, -forearmLength + 0.026);
    forearm.add(strap);

    const bezelGeo = new THREE.BoxGeometry(0.036, 0.012, 0.032);
    const bezel = new THREE.Mesh(bezelGeo, mats.watchBezel);
    bezel.position.set(0.014, 0.034, -forearmLength + 0.026);
    bezel.rotation.z = -0.35;
    forearm.add(bezel);

    const screenGeo = new THREE.BoxGeometry(0.028, 0.004, 0.024);
    const screen = new THREE.Mesh(screenGeo, mats.watchScreenEmissive);
    screen.position.set(0.015, 0.039, -forearmLength + 0.026);
    screen.rotation.z = -0.35;
    forearm.add(screen);
  }

  const wristJoint = new THREE.Group();
  wristJoint.name = `${side}_wrist_joint`;
  wristJoint.position.set(0, 0, -forearmLength);
  forearm.add(wristJoint);

  const palmGroup = new THREE.Group();
  palmGroup.name = `${side}_palm_group`;
  wristJoint.add(palmGroup);

  // Gloved palm & carbon-fiber knuckle guard
  const palmGeo = new THREE.BoxGeometry(0.068, 0.026, 0.076);
  const palmMesh = new THREE.Mesh(palmGeo, mats.gloveLeather);
  palmMesh.position.set(0, 0, -0.038);
  palmGroup.add(palmMesh);

  const knuckleGeo = new THREE.BoxGeometry(0.064, 0.01, 0.024);
  const knuckleMesh = new THREE.Mesh(knuckleGeo, mats.knuckleCarbon);
  knuckleMesh.position.set(0, 0.015, -0.064);
  palmGroup.add(knuckleMesh);

  const makeFinger = (
    name: string,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    len1: number,
    len2: number,
    radius: number,
    yawOffset = 0
  ): FingerChainNodes => {
    const proximal = new THREE.Group();
    proximal.name = `${side}_finger_${name}_prox`;
    proximal.position.set(offsetX, offsetY, offsetZ);
    proximal.rotation.y = yawOffset;
    palmGroup.add(proximal);

    const pGeo = new THREE.BoxGeometry(radius * 2, radius * 1.8, len1);
    const pMesh = new THREE.Mesh(pGeo, mats.gloveLeather);
    pMesh.position.set(0, 0, -len1 * 0.5);
    proximal.add(pMesh);

    const distal = new THREE.Group();
    distal.name = `${side}_finger_${name}_dist`;
    distal.position.set(0, 0, -len1);
    proximal.add(distal);

    const dGeo = new THREE.BoxGeometry(radius * 1.85, radius * 1.65, len2);
    const dMesh = new THREE.Mesh(dGeo, mats.knuckleCarbon);
    dMesh.position.set(0, 0, -len2 * 0.5);
    distal.add(dMesh);

    return { proximal, distal };
  };

  const fingers = {
    thumb: makeFinger('thumb', -sign * 0.034, -0.004, -0.028, 0.028, 0.022, 0.0075, sign * 0.52),
    index: makeFinger('index', -sign * 0.024, 0.002, -0.074, 0.03, 0.024, 0.0068, 0),
    middle: makeFinger('middle', -sign * 0.008, 0.003, -0.076, 0.033, 0.025, 0.007, 0),
    ring: makeFinger('ring', sign * 0.009, 0.002, -0.074, 0.03, 0.023, 0.0066, 0),
    little: makeFinger('little', sign * 0.025, 0.0, -0.07, 0.025, 0.02, 0.006, 0),
  };

  return {
    side,
    shoulderRoot,
    upperArm,
    elbowJoint,
    forearm,
    wristJoint,
    palmGroup,
    fingers,
    upperArmLength,
    forearmLength,
  };
}

function applyFingerPose(
  chain: ArticulatedArmChain,
  poseId: HandGripPoseId,
  triggerPull01 = 0
): void {
  const curls = FINGER_POSE_CURLS[poseId] ?? FINGER_POSE_CURLS.foregrip_cradle;
  const f = chain.fingers;
  f.thumb.proximal.rotation.x = -curls.thumb[0];
  f.thumb.distal.rotation.x = -curls.thumb[1];

  const trigAdd =
    poseId === 'pistol_grip_trigger' || poseId === 'rifle_grip_trigger' ? triggerPull01 * 0.45 : 0;
  f.index.proximal.rotation.x = -(curls.index[0] + trigAdd);
  f.index.distal.rotation.x = -(curls.index[1] + trigAdd * 0.8);

  f.middle.proximal.rotation.x = -curls.middle[0];
  f.middle.distal.rotation.x = -curls.middle[1];

  f.ring.proximal.rotation.x = -curls.ring[0];
  f.ring.distal.rotation.x = -curls.ring[1];

  f.little.proximal.rotation.x = -curls.little[0];
  f.little.distal.rotation.x = -curls.little[1];
}

const _targetVec = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

/**
 * Analytical 2-Bone Arm IK Solver (`Shoulder → Elbow → Wrist`).
 * Computes exact law-of-cosines elbow bend and shoulder orientation so the wrist joint
 * reaches `targetInShoulderParentSpace` without hyper-extension or NaN singularity.
 */
export function solveTwoBoneArmIK(
  arm: ArticulatedArmChain,
  targetInRigSpace: THREE.Vector3
): void {
  const L1 = arm.upperArmLength;
  const L2 = arm.forearmLength;
  const maxReach = (L1 + L2) * 0.992;
  const minReach = Math.abs(L1 - L2) + 0.02;

  _toTarget.subVectors(targetInRigSpace, arm.shoulderRoot.position);
  const rawDist = _toTarget.length();
  const clampedDist = THREE.MathUtils.clamp(rawDist, minReach, maxReach);

  // Law of cosines for interior angles
  const cosShoulder = THREE.MathUtils.clamp(
    (L1 * L1 + clampedDist * clampedDist - L2 * L2) / (2 * L1 * clampedDist),
    -1,
    1
  );
  const shoulderFlexAngle = Math.acos(cosShoulder);

  const cosElbow = THREE.MathUtils.clamp(
    (L1 * L1 + L2 * L2 - clampedDist * clampedDist) / (2 * L1 * L2),
    -1,
    1
  );
  const elbowBendAngle = Math.PI - Math.acos(cosElbow);

  // Aim shoulder toward target (-Z forward convention)
  const dirX = rawDist > 1e-5 ? _toTarget.x / rawDist : 0;
  const dirY = rawDist > 1e-5 ? _toTarget.y / rawDist : 0;
  const dirZ = rawDist > 1e-5 ? _toTarget.z / rawDist : -1;

  const yaw = Math.atan2(-dirX, -dirZ);
  const pitch = Math.asin(THREE.MathUtils.clamp(dirY, -0.99, 0.99));

  const outwardCant = arm.side === 'right' ? -0.22 : 0.22;
  arm.shoulderRoot.rotation.order = 'YXZ';
  arm.shoulderRoot.rotation.y = yaw;
  arm.shoulderRoot.rotation.x = pitch - shoulderFlexAngle;
  arm.shoulderRoot.rotation.z = outwardCant;

  arm.elbowJoint.rotation.set(elbowBendAngle, 0, 0);

  // Stabilize wrist orientation so palm faces inward/upward toward weapon receiver
  arm.wristJoint.rotation.set(
    -elbowBendAngle * 0.35,
    arm.side === 'right' ? 0.18 : -0.18,
    arm.side === 'right' ? 1.15 : -1.1
  );
}

/**
 * Builds a complete two-armed articulated operator hand & forearm rig.
 */
export function buildOperatorArmRig(
  palette?: ArmMaterialPalette
): OperatorArmRigInstance {
  const ownsPalette = !palette;
  const mats = palette ?? createOperatorArmMaterialPalette();
  const root = new THREE.Group();
  root.name = 'operator_arm_rig_root';

  const leftArm = buildSingleArmChain('left', mats);
  const rightArm = buildSingleArmChain('right', mats);
  root.add(leftArm.shoulderRoot, rightArm.shoulderRoot);

  const solveWeaponHold: OperatorArmRigInstance['solveWeaponHold'] = (
    leftTargetLocal,
    rightTargetLocal,
    leftPose,
    rightPose,
    triggerPull01 = 0
  ) => {
    _targetVec.copy(rightTargetLocal);
    solveTwoBoneArmIK(rightArm, _targetVec);
    applyFingerPose(rightArm, rightPose, triggerPull01);

    _targetVec.copy(leftTargetLocal);
    solveTwoBoneArmIK(leftArm, _targetVec);
    applyFingerPose(leftArm, leftPose, 0);
  };

  const resetToNeutralHold = () => {
    _targetVec.set(0.02, -0.08, -0.14);
    solveTwoBoneArmIK(rightArm, _targetVec);
    applyFingerPose(rightArm, 'rifle_grip_trigger', 0);

    _targetVec.set(-0.02, -0.05, -0.36);
    solveTwoBoneArmIK(leftArm, _targetVec);
    applyFingerPose(leftArm, 'foregrip_cradle', 0);
  };

  const dispose = () => {
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).geometry?.dispose();
      }
    });
    if (ownsPalette) {
      disposeOperatorArmMaterialPalette(mats);
    }
  };

  resetToNeutralHold();

  return {
    root,
    leftArm,
    rightArm,
    solveWeaponHold,
    resetToNeutralHold,
    dispose,
  };
}
