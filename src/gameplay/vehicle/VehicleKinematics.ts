import * as THREE from 'three';
import { CollisionWorld } from '@/src/physics/CollisionWorld';

export interface VehicleSuspensionTarget {
  position: THREE.Vector3;
  yaw: number;
  speed: number;
  prevSpeed: number;
  prevTerrainY: number;
  steerAngle: number;
  driveGear: string;
  halfWidth: number;
  halfLength: number;
  chassisPitch: number;
  chassisPitchVel: number;
  chassisRoll: number;
  chassisRollVel: number;
  chassisHeave: number;
  chassisHeaveVel: number;
  wheelRestY: number;
  wheelLocalPositions: readonly (readonly [number, number, number])[];
  wheelCompression: [number, number, number, number];
  wheelVelocity: [number, number, number, number];
  meshRoot: THREE.Group;
  chassisGroup: THREE.Group;
  wheels: THREE.Object3D[];
  suspensionStruts: THREE.Object3D[];
}

export function resetSuspensionState(veh: VehicleSuspensionTarget): void {
  veh.chassisPitch = 0;
  veh.chassisPitchVel = 0;
  veh.chassisRoll = 0;
  veh.chassisRollVel = 0;
  veh.chassisHeave = 0;
  veh.chassisHeaveVel = 0;
  veh.prevSpeed = veh.speed;
  veh.prevTerrainY = veh.position.y;
  for (let i = 0; i < 4; i++) {
    veh.wheelCompression[i] = 0;
    veh.wheelVelocity[i] = 0;
  }
  for (let i = 0; i < veh.wheels.length; i++) {
    veh.wheels[i].position.y = veh.wheelRestY;
    if (veh.suspensionStruts[i]) {
      veh.suspensionStruts[i].scale.y = 1;
    }
  }
  veh.chassisGroup.position.set(0, 0, 0);
  veh.chassisGroup.rotation.set(0, 0, 0, 'YXZ');
  veh.meshRoot.position.copy(veh.position);
  veh.meshRoot.rotation.set(0, veh.yaw, 0, 'YXZ');
}

/**
 * Pure sub-stepped semi-implicit spring-damper suspension & chassis articulation solver (TRN-26).
 * Samples wheel support elevation across both terrain and elevated bridges/ramps via getSupportHeightAt.
 */
export function stepVehicleSuspension(
  veh: VehicleSuspensionTarget,
  dt: number,
  collision: CollisionWorld,
  netLongitudinalInput: number,
  impactImpulse = 0
): void {
  const safeDt = THREE.MathUtils.clamp(dt, 0.001, 0.1);
  const rawAccel = THREE.MathUtils.clamp((veh.speed - veh.prevSpeed) / safeDt, -36, 36);
  veh.prevSpeed = veh.speed;

  const deltaTerrainY = THREE.MathUtils.clamp(veh.position.y - veh.prevTerrainY, -0.6, 0.6);
  veh.prevTerrainY = veh.position.y;

  const cosY = Math.cos(veh.yaw);
  const sinY = Math.sin(veh.yaw);
  let frontGroundSum = 0;
  let rearGroundSum = 0;
  let leftGroundSum = 0;
  let rightGroundSum = 0;
  const wheelGroundDelta: [number, number, number, number] = [0, 0, 0, 0];

  for (let i = 0; i < 4; i++) {
    const [lx, , lz] = veh.wheelLocalPositions[i];
    const wx = veh.position.x + lx * cosY + lz * sinY;
    const wz = veh.position.z - lx * sinY + lz * cosY;
    const gY =
      veh.position.y > 0.35
        ? collision.getSupportHeightAt(wx, veh.position.y + 1.0, wz, 2.2, 0.55)
        : collision.getGroundHeightAt(wx, wz);
    const relG = THREE.MathUtils.clamp(gY - veh.position.y, -0.25, 0.25);
    wheelGroundDelta[i] = relG;
    if (i < 2) frontGroundSum += gY;
    else rearGroundSum += gY;
    if (i % 2 === 0) leftGroundSum += gY;
    else rightGroundSum += gY;
  }

  const wheelBase = Math.max(2.0, veh.halfLength * 1.36);
  const trackWidth = Math.max(1.6, veh.halfWidth * 1.6);
  const terrainPitch = THREE.MathUtils.clamp(
    (frontGroundSum * 0.5 - rearGroundSum * 0.5) / wheelBase,
    -0.08,
    0.08
  );
  const terrainRoll = THREE.MathUtils.clamp(
    (leftGroundSum * 0.5 - rightGroundSum * 0.5) / trackWidth,
    -0.08,
    0.08
  );

  const brakingDiveBoost = veh.driveGear === 'BRAKING' ? -0.028 : 0;
  const accelPitchTarget = THREE.MathUtils.clamp(
    rawAccel * 0.0022 + netLongitudinalInput * 0.032 + brakingDiveBoost + terrainPitch * 0.65,
    -0.13,
    0.13
  );

  const speedNorm = Math.min(1.2, Math.abs(veh.speed) / 14);
  const cornerRollTarget = THREE.MathUtils.clamp(
    veh.steerAngle * 0.085 * speedNorm + terrainRoll * 0.65,
    -0.15,
    0.15
  );

  if (Math.abs(deltaTerrainY) > 0.002) {
    veh.chassisHeaveVel -= deltaTerrainY * 3.8;
  }
  if (impactImpulse > 0) {
    veh.chassisHeaveVel -= Math.min(1.4, impactImpulse * 0.09);
    veh.chassisPitchVel -= Math.min(0.85, impactImpulse * 0.045);
  }

  const substeps = Math.max(1, Math.min(4, Math.ceil(safeDt / (1 / 120))));
  const h = safeDt / substeps;
  const pitchStiffness = 115;
  const pitchDamping = 18.5;
  const rollStiffness = 125;
  const rollDamping = 19.5;
  const heaveStiffness = 140;
  const heaveDamping = 21.0;
  const wheelStiffness = 165;
  const wheelDamping = 22.5;

  for (let s = 0; s < substeps; s++) {
    const pitchForce =
      (accelPitchTarget - veh.chassisPitch) * pitchStiffness - veh.chassisPitchVel * pitchDamping;
    veh.chassisPitchVel += pitchForce * h;
    veh.chassisPitch = THREE.MathUtils.clamp(veh.chassisPitch + veh.chassisPitchVel * h, -0.14, 0.14);

    const rollForce =
      (cornerRollTarget - veh.chassisRoll) * rollStiffness - veh.chassisRollVel * rollDamping;
    veh.chassisRollVel += rollForce * h;
    veh.chassisRoll = THREE.MathUtils.clamp(veh.chassisRoll + veh.chassisRollVel * h, -0.16, 0.16);

    const heaveForce = -veh.chassisHeave * heaveStiffness - veh.chassisHeaveVel * heaveDamping;
    veh.chassisHeaveVel += heaveForce * h;
    veh.chassisHeave = THREE.MathUtils.clamp(veh.chassisHeave + veh.chassisHeaveVel * h, -0.18, 0.16);

    for (let wi = 0; wi < 4; wi++) {
      const isFront = wi < 2;
      const isLeft = wi % 2 === 0;
      const loadTransfer =
        (isFront ? -veh.chassisPitch : veh.chassisPitch) * 0.42 +
        (isLeft ? -veh.chassisRoll : veh.chassisRoll) * 0.38;
      const wheelTarget = THREE.MathUtils.clamp(
        wheelGroundDelta[wi] + loadTransfer - veh.chassisHeave * 0.45,
        -0.18,
        0.22
      );
      const wForce =
        (wheelTarget - veh.wheelCompression[wi]) * wheelStiffness -
        veh.wheelVelocity[wi] * wheelDamping;
      veh.wheelVelocity[wi] += wForce * h;
      veh.wheelCompression[wi] = THREE.MathUtils.clamp(
        veh.wheelCompression[wi] + veh.wheelVelocity[wi] * h,
        -0.18,
        0.22
      );
    }
  }

  if (
    Math.abs(veh.speed) < 0.02 &&
    Math.abs(netLongitudinalInput) < 0.01 &&
    Math.abs(veh.chassisPitch) < 1e-4 &&
    Math.abs(veh.chassisPitchVel) < 1e-3
  ) {
    veh.chassisPitch = 0;
    veh.chassisPitchVel = 0;
  }
  if (
    Math.abs(veh.speed) < 0.02 &&
    Math.abs(veh.steerAngle) < 0.005 &&
    Math.abs(veh.chassisRoll) < 1e-4 &&
    Math.abs(veh.chassisRollVel) < 1e-3
  ) {
    veh.chassisRoll = 0;
    veh.chassisRollVel = 0;
  }

  veh.meshRoot.position.copy(veh.position);
  veh.meshRoot.rotation.set(0, veh.yaw, 0, 'YXZ');
  veh.chassisGroup.position.set(0, veh.chassisHeave, 0);
  veh.chassisGroup.rotation.set(veh.chassisPitch, 0, veh.chassisRoll, 'YXZ');

  for (let wi = 0; wi < veh.wheels.length; wi++) {
    const comp =
      wi < 4
        ? (veh.wheelCompression[wi] ?? 0)
        : wi % 2 === 0
          ? 0.5 * (veh.wheelCompression[0] + veh.wheelCompression[2])
          : 0.5 * (veh.wheelCompression[1] + veh.wheelCompression[3]);
    veh.wheels[wi].position.y = veh.wheelRestY + comp;
    if (veh.suspensionStruts[wi]) {
      veh.suspensionStruts[wi].scale.y = THREE.MathUtils.clamp(1 - comp * 1.4, 0.65, 1.35);
    }
  }
}
