import * as THREE from 'three';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { SOLID_OBSTRUCTION_MASK } from '@/src/gameplay/BallisticSolver';
import { EnemyAwarenessState } from '@/src/schemas/combat.schema';

export interface EnemyAnimTarget {
  id: string;
  alive: boolean;
  state: EnemyAwarenessState;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  hasLos: boolean;
  lastKnownPosition: THREE.Vector3 | null;
  coverTarget: THREE.Vector3 | null;
  isMoving: boolean;
  isReloading: boolean;
  hitReactTimer: number;
  deathTimer: number;
  walkPhase: number;
  actualHorizSpeed?: number;
  actualVertSpeed?: number;
  meshRoot: THREE.Group;
  pelvisGroup: THREE.Group;
  torsoGroup: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  weaponArm: THREE.Object3D;
  rightForearm: THREE.Group;
  leftArm: THREE.Group;
  leftForearm: THREE.Group;
  headMesh: THREE.Object3D;
  muzzleFlash: THREE.Mesh;
  hipRestY: number;
  animCrouchBlend: number;
  animAimBlend: number;
  animFireRecoilTimer: number;
  animMuzzleFlashTimer: number;
  animHitDirYaw: number;
  animHitHeadshot: boolean;
  animPrevYaw: number;
  animTurnLean: number;
  animTime: number;
  telegraphKind: 'sniper' | 'rocket' | null;
  telegraphTimerSec: number;
}

const THIGH_LEN = 0.42;
const SHIN_PLUS_BOOT_LEN = 0.42;

export function normalizeAngleRad(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Computes exact hip height required so the lower boot sole stays flush with y = 0.00m
 * across standing, walking, stair-climbing, and tactical crouch poses (eliminates -9.3cm crouch sink).
 */
export function computeGroundedHipY(
  hipRestY: number,
  leftHipX: number,
  leftKneeX: number,
  rightHipX: number,
  rightKneeX: number,
  walkBobY: number
): number {
  const leftDrop =
    THIGH_LEN * Math.cos(leftHipX) + SHIN_PLUS_BOOT_LEN * Math.cos(leftHipX + leftKneeX);
  const rightDrop =
    THIGH_LEN * Math.cos(rightHipX) + SHIN_PLUS_BOOT_LEN * Math.cos(rightHipX + rightKneeX);
  const supportDrop = Math.max(leftDrop, rightDrop, 0.46);
  return Math.min(hipRestY + 0.04, supportDrop + walkBobY);
}

/**
 * Smooth articulated death collapse animation synced cleanly to ground elevation.
 */
export function stepEnemyDeathAnimation(u: EnemyAnimTarget): void {
  u.muzzleFlash.visible = false;
  u.animMuzzleFlashTimer = 0;

  const rawT = Math.min(1, u.deathTimer / 0.52);
  const t = rawT * rawT * (3 - 2 * rawT);
  const idNum = parseInt(u.id.split('_')[1] ?? '1', 10) || 1;
  const fallForwardSign = idNum % 2 === 0 ? 1 : -1;

  const hipY = THREE.MathUtils.lerp(u.hipRestY, 0.16, t);
  u.meshRoot.position.copy(u.position);
  u.meshRoot.rotation.set(0, u.yaw, 0);

  u.pelvisGroup.position.y = hipY;
  u.torsoGroup.position.y = hipY;
  u.leftLeg.position.y = hipY;
  u.rightLeg.position.y = hipY;

  u.leftLeg.rotation.set(-0.92 * t, 0, -0.1 * t);
  u.rightLeg.rotation.set(-0.48 * t, 0, 0.1 * t);
  u.leftKnee.rotation.x = 1.48 * t;
  u.rightKnee.rotation.x = 1.12 * t;

  u.torsoGroup.rotation.set(fallForwardSign * 1.32 * t, 0, 0.24 * fallForwardSign * t);
  u.headMesh.rotation.set(0.38 * fallForwardSign * t, 0.18 * t, 0);
  u.weaponArm.rotation.set(0.45 * t, -0.2 * t, 0.42 * t);
  u.rightForearm.rotation.set(0.25 * t, 0, 0);
  u.leftArm.rotation.set(0.38 * t, 0.2 * t, -0.35 * t);
  u.leftForearm.rotation.set(0.2 * t, 0, 0);
}

/**
 * Steps articulated soldier locomotion, stance, stair-climbing gait, aim pitch, recoil,
 * and foot-grounded pelvis height using actual measured horizontal/vertical displacement.
 */
export function stepEnemyLocomotionAnimation(
  u: EnemyAnimTarget,
  dt: number,
  playerPos: THREE.Vector3,
  playerCrouching: boolean,
  dist: number
): void {
  u.animTime += dt;
  u.hitReactTimer = Math.max(0, u.hitReactTimer - dt);
  u.animFireRecoilTimer = Math.max(0, u.animFireRecoilTimer - dt);
  u.animMuzzleFlashTimer = Math.max(0, u.animMuzzleFlashTimer - dt);

  const flashActive = u.animMuzzleFlashTimer > 0;
  u.muzzleFlash.visible = flashActive;
  if (flashActive) {
    u.muzzleFlash.rotation.z += dt * 48;
    const flicker = 0.8 + 0.45 * Math.abs(Math.sin(u.animTime * 90));
    u.muzzleFlash.scale.setScalar(flicker);
  }

  u.meshRoot.position.copy(u.position);
  u.meshRoot.rotation.y = u.yaw;

  const safeDt = Math.max(dt, 1e-4);
  const yawDelta = normalizeAngleRad(u.yaw - u.animPrevYaw);
  u.animPrevYaw = u.yaw;
  const targetTurnLean = THREE.MathUtils.clamp(-(yawDelta / safeDt) * 0.024, -0.13, 0.13);
  u.animTurnLean = THREE.MathUtils.lerp(u.animTurnLean, targetTurnLean, 1 - Math.exp(-12 * dt));

  // Use real measured displacement speed (prevents running-in-place against walls or foot sliding)
  const measuredSpeed =
    u.actualHorizSpeed !== undefined
      ? u.actualHorizSpeed
      : u.isMoving
        ? Math.hypot(u.velocity.x, u.velocity.z)
        : 0;
  const groundSpeed = measuredSpeed > 0.12 ? measuredSpeed : 0;
  const vertSpeed = u.actualVertSpeed ?? 0;
  const isClimbing = vertSpeed > 0.35 && groundSpeed > 0.25;
  const isDescending = vertSpeed < -0.35 && groundSpeed > 0.25;

  const wantsCrouch =
    u.isReloading ||
    (groundSpeed < 0.2 &&
      (u.coverTarget !== null || u.state === 'SUPPRESSING' || u.state === 'RETREATING'));
  u.animCrouchBlend = THREE.MathUtils.lerp(
    u.animCrouchBlend,
    wantsCrouch ? 1 : 0,
    1 - Math.exp(-9.5 * dt)
  );

  const targetAim =
    u.state === 'ENGAGING' || u.state === 'ALERTED' || u.state === 'SUPPRESSING'
      ? 1
      : u.state === 'SUSPICIOUS' ||
          u.state === 'INVESTIGATING' ||
          u.state === 'SEARCHING' ||
          u.state === 'REPOSITIONING'
        ? 0.55
        : 0;
  u.animAimBlend = THREE.MathUtils.lerp(u.animAimBlend, targetAim, 1 - Math.exp(-11 * dt));

  const moveFactor = Math.min(1, groundSpeed / 1.15);
  if (groundSpeed > 0.12) {
    // Slightly shorter cadence when ascending stairs so feet match riser steps
    const stairCadenceBoost = isClimbing ? 1.18 : 1.0;
    u.walkPhase += dt * groundSpeed * 2.55 * stairCadenceBoost;
  }

  const strideAmp =
    Math.min(0.66, groundSpeed * 0.15) * (1 - 0.25 * u.animCrouchBlend) * moveFactor;
  const sinP = Math.sin(u.walkPhase);

  const climbHipLift = isClimbing ? -0.18 : isDescending ? 0.06 : 0;
  const idleLeftHip = -0.78 * u.animCrouchBlend - 0.07 * u.animAimBlend;
  const idleRightHip = -0.64 * u.animCrouchBlend + 0.09 * u.animAimBlend;
  const moveLeftHip = sinP * strideAmp - 0.56 * u.animCrouchBlend + climbHipLift * Math.max(0, sinP);
  const moveRightHip =
    -sinP * strideAmp - 0.48 * u.animCrouchBlend + climbHipLift * Math.max(0, -sinP);

  const legDamp = 1 - Math.exp(-14 * dt);
  u.leftLeg.rotation.x = THREE.MathUtils.lerp(
    u.leftLeg.rotation.x,
    THREE.MathUtils.lerp(idleLeftHip, moveLeftHip, moveFactor),
    legDamp
  );
  u.rightLeg.rotation.x = THREE.MathUtils.lerp(
    u.rightLeg.rotation.x,
    THREE.MathUtils.lerp(idleRightHip, moveRightHip, moveFactor),
    legDamp
  );

  // Anatomical knee flexion (never hyperextends negative; higher knee lift on stairs)
  const climbKneeBoost = isClimbing ? 0.34 : 0;
  const idleLeftKnee = 0.08 + 1.40 * u.animCrouchBlend;
  const idleRightKnee = 0.08 + 1.30 * u.animCrouchBlend;
  const moveLeftKnee =
    Math.max(0.06, -sinP * (0.62 + climbKneeBoost) * moveFactor) + 0.1 + 1.12 * u.animCrouchBlend;
  const moveRightKnee =
    Math.max(0.06, sinP * (0.62 + climbKneeBoost) * moveFactor) + 0.1 + 1.02 * u.animCrouchBlend;

  u.leftKnee.rotation.x = THREE.MathUtils.lerp(
    u.leftKnee.rotation.x,
    THREE.MathUtils.lerp(idleLeftKnee, moveLeftKnee, moveFactor),
    legDamp
  );
  u.rightKnee.rotation.x = THREE.MathUtils.lerp(
    u.rightKnee.rotation.x,
    THREE.MathUtils.lerp(idleRightKnee, moveRightKnee, moveFactor),
    legDamp
  );

  // Kinematic foot-grounded pelvis height (keeps boot soles flush with y = 0.00 in all stances)
  const walkBobY =
    groundSpeed > 0.15 ? Math.abs(sinP) * 0.028 * Math.min(1, groundSpeed / 4.2) : 0;
  const hipY = computeGroundedHipY(
    u.hipRestY,
    u.leftLeg.rotation.x,
    u.leftKnee.rotation.x,
    u.rightLeg.rotation.x,
    u.rightKnee.rotation.x,
    walkBobY
  );
  u.pelvisGroup.position.y = hipY;
  u.torsoGroup.position.y = hipY;
  u.leftLeg.position.y = hipY;
  u.rightLeg.position.y = hipY;

  const hitEnv = u.hitReactTimer > 0 ? Math.sin((u.hitReactTimer / 0.22) * Math.PI) : 0;
  const hitPitch = -hitEnv * (u.animHitHeadshot ? 0.36 : 0.24);
  const hitTwist = hitEnv * Math.sin(u.animHitDirYaw) * 0.32;

  const slopeLean = isClimbing ? 0.14 : isDescending ? -0.06 : 0;
  const forwardLean = 0.12 * moveFactor + 0.15 * u.animCrouchBlend + slopeLean;
  const walkTwist = -sinP * 0.08 * moveFactor;
  u.torsoGroup.rotation.set(
    forwardLean + hitPitch,
    walkTwist + hitTwist + (u.isReloading ? 0.18 : 0),
    u.animTurnLean + hitEnv * Math.cos(u.animHitDirYaw) * 0.08
  );

  let targetPitch = 0;
  if (u.state === 'ENGAGING' || u.state === 'ALERTED' || u.state === 'SUPPRESSING') {
    const targetY = u.hasLos
      ? playerPos.y + (playerCrouching ? 0.95 : 1.35)
      : (u.lastKnownPosition?.y ?? u.position.y + 1.3);
    targetPitch = THREE.MathUtils.clamp(
      Math.atan2(targetY - (u.position.y + 1.38), Math.max(2.5, dist)),
      -0.55,
      0.55
    );
  }

  const headScanYaw = u.state === 'UNAWARE' ? Math.sin(u.animTime * 1.15) * 0.24 : 0;
  u.headMesh.rotation.x = THREE.MathUtils.lerp(
    u.headMesh.rotation.x,
    -targetPitch * 0.72 - hitEnv * (u.animHitHeadshot ? 0.52 : 0.22) + (u.isReloading ? 0.22 : 0),
    1 - Math.exp(-12 * dt)
  );
  u.headMesh.rotation.y = THREE.MathUtils.lerp(
    u.headMesh.rotation.y,
    headScanYaw - walkTwist * 0.6,
    1 - Math.exp(-8 * dt)
  );

  const recoilAlpha = u.animFireRecoilTimer > 0 ? u.animFireRecoilTimer / 0.095 : 0;
  const armDamp = 1 - Math.exp(-16 * dt);

  if (u.isReloading) {
    const reloadPulse = Math.sin(u.animTime * 9.5);
    u.weaponArm.rotation.x = THREE.MathUtils.lerp(
      u.weaponArm.rotation.x,
      -0.36 + reloadPulse * 0.08,
      armDamp
    );
    u.weaponArm.rotation.y = THREE.MathUtils.lerp(u.weaponArm.rotation.y, -0.26, armDamp);
    u.rightForearm.rotation.x = THREE.MathUtils.lerp(u.rightForearm.rotation.x, -0.15, armDamp);

    u.leftArm.rotation.x = THREE.MathUtils.lerp(
      u.leftArm.rotation.x,
      -0.24 + reloadPulse * 0.22,
      armDamp
    );
    u.leftArm.rotation.y = THREE.MathUtils.lerp(u.leftArm.rotation.y, 0.34, armDamp);
    u.leftForearm.rotation.x = THREE.MathUtils.lerp(
      u.leftForearm.rotation.x,
      -0.35 - reloadPulse * 0.15,
      armDamp
    );
  } else {
    const carryPitch = 0.34;
    const alertPitch = -0.12;
    const aimPitch = -0.28 - targetPitch;

    const baseArmPitch =
      u.animAimBlend <= 0.55
        ? THREE.MathUtils.lerp(carryPitch, alertPitch, u.animAimBlend / 0.55)
        : THREE.MathUtils.lerp(alertPitch, aimPitch, (u.animAimBlend - 0.55) / 0.45);

    const armSwing = -sinP * 0.16 * moveFactor * (1 - 0.75 * u.animAimBlend);
    const targetRightArmX = baseArmPitch - hitEnv * 0.32 - recoilAlpha * 0.18 + armSwing;
    const targetRightArmY = THREE.MathUtils.lerp(-0.18, 0.04, u.animAimBlend);

    u.weaponArm.rotation.x = THREE.MathUtils.lerp(u.weaponArm.rotation.x, targetRightArmX, armDamp);
    u.weaponArm.rotation.y = THREE.MathUtils.lerp(u.weaponArm.rotation.y, targetRightArmY, armDamp);
    u.rightForearm.rotation.x = THREE.MathUtils.lerp(
      u.rightForearm.rotation.x,
      -recoilAlpha * 0.24,
      1 - Math.exp(-24 * dt)
    );

    const targetLeftArmX = THREE.MathUtils.lerp(
      0.22 + sinP * 0.25 * moveFactor,
      -0.34 - targetPitch * 0.85,
      u.animAimBlend
    );
    const targetLeftArmY = THREE.MathUtils.lerp(0.08, 0.44, u.animAimBlend);
    const targetLeftForeX = THREE.MathUtils.lerp(0.05, -0.22 - recoilAlpha * 0.12, u.animAimBlend);

    u.leftArm.rotation.x = THREE.MathUtils.lerp(u.leftArm.rotation.x, targetLeftArmX, armDamp);
    u.leftArm.rotation.y = THREE.MathUtils.lerp(u.leftArm.rotation.y, targetLeftArmY, armDamp);
    u.leftForearm.rotation.x = THREE.MathUtils.lerp(
      u.leftForearm.rotation.x,
      targetLeftForeX,
      armDamp
    );
  }
}

/**
 * Updates the 3D sniper telegraph laser with authoritative solid-geometry occlusion so the beam
 * stops cleanly on walls/cover instead of cutting through buildings.
 */
export function updateOccludedSniperLaser(
  laserLine: THREE.Line | null,
  laserPositions: Float32Array | null,
  enemies: readonly EnemyAnimTarget[],
  playerAlive: boolean,
  playerPos: THREE.Vector3,
  playerCrouching: boolean,
  collision: CollisionWorld,
  rayScratch: RayHit
): void {
  if (!laserLine || !laserPositions) return;

  let laserUnit: EnemyAnimTarget | null = null;
  for (let i = 0; i < enemies.length; i++) {
    const u = enemies[i];
    if (u.alive && u.telegraphKind === 'sniper' && u.telegraphTimerSec > 0 && u.hasLos) {
      laserUnit = u;
      break;
    }
  }

  if (!laserUnit || !playerAlive) {
    laserLine.visible = false;
    return;
  }

  const crouchYOffset = laserUnit.animCrouchBlend * 0.24;
  const ox = laserUnit.position.x + Math.sin(laserUnit.yaw) * 0.5;
  const oy = laserUnit.position.y + 1.48 - crouchYOffset;
  const oz = laserUnit.position.z + Math.cos(laserUnit.yaw) * 0.5;

  let tx = playerPos.x;
  let ty = playerPos.y + (playerCrouching ? 0.9 : 1.35);
  let tz = playerPos.z;

  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > 0.25) {
    const inv = 1 / dist;
    const hit = collision.sweptSegmentTest(
      ox,
      oy,
      oz,
      dx * inv,
      dy * inv,
      dz * inv,
      dist,
      SOLID_OBSTRUCTION_MASK,
      rayScratch,
      laserUnit.id
    );
    if (hit && rayScratch.distance < dist - 0.15) {
      tx = rayScratch.pointX;
      ty = rayScratch.pointY;
      tz = rayScratch.pointZ;
    }
  }

  laserPositions[0] = ox;
  laserPositions[1] = oy;
  laserPositions[2] = oz;
  laserPositions[3] = tx;
  laserPositions[4] = ty;
  laserPositions[5] = tz;
  const posAttr = laserLine.geometry.getAttribute('position');
  posAttr.needsUpdate = true;
  laserLine.visible = true;
}
