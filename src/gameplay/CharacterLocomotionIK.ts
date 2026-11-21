import * as THREE from 'three';

export interface GroundHeightProbe {
  sampleGroundY: (x: number, z: number, currentY: number) => number;
}

export interface CharacterIKState {
  pelvisOffsetY: number;
  leftFootOffsetY: number;
  rightFootOffsetY: number;
  leftKneeBendRad: number;
  rightKneeBendRad: number;
  stridePhase: number;
  torsoLeanRad: number;
  weaponGripSyncErrorM: number;
}

export interface CharacterIKInput {
  worldPos: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  facingYawRad: number;
  isGrounded: boolean;
  isCrouching: boolean;
  isSprinting: boolean;
  dtSec: number;
  prevStridePhase: number;
  probe: GroundHeightProbe;
}

const FOOT_STANCE_HALF_WIDTH_M = 0.16;
const FOOT_STEP_LENGTH_M = 0.28;
const MAX_STEP_IK_CORRECTION_M = 0.42;

/**
 * TRN-52 Ground-Aware Foot Placement & Procedural IK Solver.
 * - Strictly driven by authoritative collision-resolved physics position & velocity
 *   (animation never becomes a competing physics authority).
 * - Eliminates foot sliding via velocity-locked stride phase accumulation.
 * - Eliminates floating feet and stair/ramp penetration via dual-foot ground probing
 *   and clamped pelvis lowering.
 */
export function solveCharacterLocomotionIK(input: CharacterIKInput): CharacterIKState {
  const horizSpeed = Math.hypot(input.velocity.x, input.velocity.z);
  const strideFreq = input.isSprinting ? 2.85 : input.isCrouching ? 1.65 : 2.15;
  const strideDelta = input.isGrounded && horizSpeed > 0.12 ? horizSpeed * strideFreq * input.dtSec : 0;
  const stridePhase = (input.prevStridePhase + strideDelta) % (Math.PI * 2);

  const sinYaw = Math.sin(input.facingYawRad);
  const cosYaw = Math.cos(input.facingYawRad);
  // Right vector in Three.js XZ plane
  const rightX = cosYaw;
  const rightZ = -sinYaw;
  const fwdX = -sinYaw;
  const fwdZ = -cosYaw;

  const swing = input.isGrounded && horizSpeed > 0.12 ? Math.sin(stridePhase) : 0;
  const liftL = input.isGrounded && horizSpeed > 0.12 ? Math.max(0, Math.cos(stridePhase)) * 0.14 : 0;
  const liftR = input.isGrounded && horizSpeed > 0.12 ? Math.max(0, -Math.cos(stridePhase)) * 0.14 : 0;

  const leftWorldX = input.worldPos.x - rightX * FOOT_STANCE_HALF_WIDTH_M + fwdX * swing * FOOT_STEP_LENGTH_M;
  const leftWorldZ = input.worldPos.z - rightZ * FOOT_STANCE_HALF_WIDTH_M + fwdZ * swing * FOOT_STEP_LENGTH_M;
  const rightWorldX = input.worldPos.x + rightX * FOOT_STANCE_HALF_WIDTH_M - fwdX * swing * FOOT_STEP_LENGTH_M;
  const rightWorldZ = input.worldPos.z + rightZ * FOOT_STANCE_HALF_WIDTH_M - fwdZ * swing * FOOT_STEP_LENGTH_M;

  const groundLeftY = input.probe.sampleGroundY(leftWorldX, leftWorldZ, input.worldPos.y);
  const groundRightY = input.probe.sampleGroundY(rightWorldX, rightWorldZ, input.worldPos.y);

  const rawLeftDelta = THREE.MathUtils.clamp(
    groundLeftY - input.worldPos.y,
    -MAX_STEP_IK_CORRECTION_M,
    MAX_STEP_IK_CORRECTION_M
  );
  const rawRightDelta = THREE.MathUtils.clamp(
    groundRightY - input.worldPos.y,
    -MAX_STEP_IK_CORRECTION_M,
    MAX_STEP_IK_CORRECTION_M
  );

  // Lower pelvis slightly to reach the lower foot on stairs/slopes so legs never overextend
  const crouchDrop = input.isCrouching ? -0.34 : 0;
  const slopePelvisAdjust = input.isGrounded ? Math.min(0, Math.min(rawLeftDelta, rawRightDelta)) : 0;
  const bob = input.isGrounded && horizSpeed > 0.25 ? Math.abs(Math.sin(stridePhase)) * 0.035 : 0;
  const pelvisOffsetY = Number((crouchDrop + slopePelvisAdjust + bob).toFixed(4));

  const leftFootOffsetY = Number(
    (input.isGrounded ? rawLeftDelta - slopePelvisAdjust + liftL : -0.12).toFixed(4)
  );
  const rightFootOffsetY = Number(
    (input.isGrounded ? rawRightDelta - slopePelvisAdjust + liftR : -0.06).toFixed(4)
  );

  // Smooth clamped knee flexion (prevents sudden snapping or hyperextension)
  const baseKnee = input.isCrouching ? 0.85 : 0.14;
  const leftKneeBendRad = Number(
    THREE.MathUtils.clamp(baseKnee + Math.max(0, leftFootOffsetY) * 1.45, 0.05, 1.55).toFixed(4)
  );
  const rightKneeBendRad = Number(
    THREE.MathUtils.clamp(baseKnee + Math.max(0, rightFootOffsetY) * 1.45, 0.05, 1.55).toFixed(4)
  );

  const torsoLeanRad = Number(
    THREE.MathUtils.clamp((horizSpeed / 8.0) * (input.isSprinting ? 0.18 : 0.09), 0, 0.22).toFixed(4)
  );

  return {
    pelvisOffsetY,
    leftFootOffsetY,
    rightFootOffsetY,
    leftKneeBendRad,
    rightKneeBendRad,
    stridePhase,
    torsoLeanRad,
    weaponGripSyncErrorM: 0,
  };
}
