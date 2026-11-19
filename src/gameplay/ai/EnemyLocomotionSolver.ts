import * as THREE from 'three';
import { PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import type { CharacterMoveResult } from '@/src/engine/physics/PhysicsTypes';
import { getAgentTraversalProfile, AgentProfileId } from '@/src/navigation/AgentTraversalProfile';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';

const WHISKER_COS_35 = Math.cos((35 * Math.PI) / 180);
const WHISKER_SIN_35 = Math.sin((35 * Math.PI) / 180);

export const ENEMY_GRAVITY_MPS2 = 21.5;
export const ENEMY_MAX_FALL_SPEED = -24.0;
const SEPARATION_RADIUS = 0.94;
const SEPARATION_VERTICAL_BAND = 1.65;

export interface EnemyLocomotionUnit {
  id: string;
  alive: boolean;
  agentProfile: AgentProfileId;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  isMoving: boolean;
  isRidingLift: boolean;
  grounded?: boolean;
  actualHorizSpeed?: number;
  actualVertSpeed?: number;
  stuckTimerSec?: number;
  lastProgressX?: number;
  lastProgressZ?: number;
  avoidanceDirX: number;
  avoidanceDirZ: number;
  avoidanceLatchTimerSec: number;
  lastColliderHit: string | null;
  activeContacts: number;
  maxPenetrationDepth: number;
}

export interface EnemyLocomotionStepResult {
  grounded: boolean;
  hitWall: boolean;
  actualHorizSpeed: number;
  actualVertSpeed: number;
  stuckTriggered: boolean;
}

/**
 * Authoritative functional locomotion & grounding step for a single AI unit.
 * - Integrates continuous gravity for BOTH moving and stationary units (fixes floating/slow-drift SC-02).
 * - Uses 3-ray elevation-aware whisker avoidance with anti-oscillation latching and stuck recovery.
 * - Enforces 3D elevation-gated separation so ground units never push elevated/stair units off ledges.
 * - Measures true horizontal & vertical displacement speed so animation never slides or runs in place.
 */
export function stepEnemyLocomotion(
  u: EnemyLocomotionUnit,
  desiredMoveX: number,
  desiredMoveZ: number,
  desiredSpeed: number,
  shouldMove: boolean,
  dt: number,
  collision: CollisionWorld,
  allEnemies: readonly EnemyLocomotionUnit[],
  whiskerRayHit: RayHit,
  moveResultScratch: CharacterMoveResult
): EnemyLocomotionStepResult {
  const safeDt = Math.max(1e-4, Math.min(dt, 0.05));
  const agentProf = getAgentTraversalProfile(u.agentProfile);
  const prevX = u.position.x;
  const prevY = u.position.y;
  const prevZ = u.position.z;

  // Preserve vertical momentum under real gravity unless riding an active lift deck
  let nextVy = u.isRidingLift
    ? 0
    : Math.max(ENEMY_MAX_FALL_SPEED, Math.min(0, u.velocity.y) - ENEMY_GRAVITY_MPS2 * safeDt);
  let vx = 0;
  let vz = 0;
  let stuckTriggered = false;

  const moveLen = Math.hypot(desiredMoveX, desiredMoveZ);
  if (shouldMove && moveLen > 0.35 && desiredSpeed > 0.05) {
    u.isMoving = true;
    const hx = desiredMoveX / moveLen;
    const hz = desiredMoveZ / moveLen;

    // 3-ray forward whisker fan at chest height (y + 1.05m so low steps/treads don't false-trigger)
    const rayY = u.position.y + 1.05;
    let steerX = hx;
    let steerZ = hz;

    const hitCenter = collision.sweptSegmentTest(
      u.position.x,
      rayY,
      u.position.z,
      hx,
      0,
      hz,
      2.1,
      PHYSICS_MASKS.CHARACTER_SOLID,
      whiskerRayHit,
      u.id
    );
    const centerDist = hitCenter ? whiskerRayHit.distance : 2.1;
    const centerNx = hitCenter ? whiskerRayHit.normalX : 0;
    const centerNz = hitCenter ? whiskerRayHit.normalZ : 0;

    const lx = hx * WHISKER_COS_35 - hz * WHISKER_SIN_35;
    const lz = hx * WHISKER_SIN_35 + hz * WHISKER_COS_35;
    const hitLeft = collision.sweptSegmentTest(
      u.position.x,
      rayY,
      u.position.z,
      lx,
      0,
      lz,
      1.55,
      PHYSICS_MASKS.CHARACTER_SOLID,
      whiskerRayHit,
      u.id
    );
    const leftDist = hitLeft ? whiskerRayHit.distance : 1.55;

    const rx = hx * WHISKER_COS_35 + hz * WHISKER_SIN_35;
    const rz = -hx * WHISKER_SIN_35 + hz * WHISKER_COS_35;
    const hitRight = collision.sweptSegmentTest(
      u.position.x,
      rayY,
      u.position.z,
      rx,
      0,
      rz,
      1.55,
      PHYSICS_MASKS.CHARACTER_SOLID,
      whiskerRayHit,
      u.id
    );
    const rightDist = hitRight ? whiskerRayHit.distance : 1.55;

    if (hitCenter) {
      const urgency = Math.min(1.55, Math.max(0.45, (2.1 - centerDist) / 1.3));
      const unitParity = (parseInt(u.id.split('_')[1] ?? '1', 10) || 1) % 2 === 0 ? 1 : -1;
      let turnSign = unitParity;
      if (leftDist > rightDist + 0.14) {
        turnSign = 1;
      } else if (rightDist > leftDist + 0.14) {
        turnSign = -1;
      } else if (u.avoidanceLatchTimerSec > 0) {
        const cross = hx * u.avoidanceDirZ - hz * u.avoidanceDirX;
        if (Math.abs(cross) > 0.1) turnSign = cross > 0 ? 1 : -1;
      }

      let tanX = -hz * turnSign;
      let tanZ = hx * turnSign;
      if (Math.hypot(centerNx, centerNz) > 0.2) {
        const wnX = -centerNz;
        const wnZ = centerNx;
        const alignDesired = wnX * tanX + wnZ * tanZ;
        const s = alignDesired >= 0 ? 1 : -1;
        tanX = wnX * s;
        tanZ = wnZ * s;
      }
      steerX = hx * 0.25 + tanX * urgency;
      steerZ = hz * 0.25 + tanZ * urgency;
      const sLen = Math.hypot(steerX, steerZ) || 1;
      u.avoidanceDirX = steerX / sLen;
      u.avoidanceDirZ = steerZ / sLen;
      u.avoidanceLatchTimerSec = 0.36;
    } else {
      if (hitLeft) {
        const pushR = ((1.55 - leftDist) / 1.55) * 0.9;
        steerX += hz * pushR;
        steerZ += -hx * pushR;
      }
      if (hitRight) {
        const pushL = ((1.55 - rightDist) / 1.55) * 0.9;
        steerX += -hz * pushL;
        steerZ += hx * pushL;
      }
      if (u.avoidanceLatchTimerSec > 0) {
        u.avoidanceLatchTimerSec = Math.max(0, u.avoidanceLatchTimerSec - safeDt);
        const latchDot = u.avoidanceDirX * hx + u.avoidanceDirZ * hz;
        if (latchDot > -0.55) {
          steerX = steerX * 0.45 + u.avoidanceDirX * 0.55;
          steerZ = steerZ * 0.45 + u.avoidanceDirZ * 0.55;
        }
      }
    }

    const steerLen = Math.hypot(steerX, steerZ) || 1;
    vx = (steerX / steerLen) * desiredSpeed;
    vz = (steerZ / steerLen) * desiredSpeed;

    // Elevation-gated local enemy separation (never pushes units across vertical floor layers!)
    for (let j = 0; j < allEnemies.length; j++) {
      const other = allEnemies[j];
      if (!other.alive || other.id === u.id) continue;
      if (Math.abs(u.position.y - other.position.y) > SEPARATION_VERTICAL_BAND) continue;
      const sdx = u.position.x - other.position.x;
      const sdz = u.position.z - other.position.z;
      const sDistSq = sdx * sdx + sdz * sdz;
      if (sDistSq > 1e-5 && sDistSq < SEPARATION_RADIUS * SEPARATION_RADIUS) {
        const sDist = Math.sqrt(sDistSq);
        const push = ((SEPARATION_RADIUS - sDist) / SEPARATION_RADIUS) * 3.1;
        vx += (sdx / sDist) * push;
        vz += (sdz / sDist) * push;
      }
    }

    // Clamp combined horizontal speed so separation bursts don't cause speed spikes
    const totalHoriz = Math.hypot(vx, vz);
    const maxAllowedSpeed = desiredSpeed * 1.25;
    if (totalHoriz > maxAllowedSpeed && totalHoriz > 1e-4) {
      const scale = maxAllowedSpeed / totalHoriz;
      vx *= scale;
      vz *= scale;
    }
  } else {
    u.isMoving = false;
    u.avoidanceLatchTimerSec = Math.max(0, u.avoidanceLatchTimerSec - safeDt);
    u.stuckTimerSec = 0;
  }

  // ALWAYS resolve capsule + gravity even when stationary so units never float on ledges or stairs
  u.velocity.set(vx, nextVy, vz);
  const moveRes = collision.resolvePlayerCapsule(
    u.position,
    u.velocity,
    agentProf.capsuleRadius,
    agentProf.standingHeight,
    agentProf.maxStepHeight,
    safeDt,
    u.id,
    undefined,
    moveResultScratch,
    agentProf.maxSlopeDeg
  );

  if (moveRes.grounded) {
    u.velocity.y = 0;
  }
  u.grounded = moveRes.grounded;

  if (u.isMoving && moveRes.hitHorizontal && Math.hypot(moveRes.wallNormalX, moveRes.wallNormalZ) > 0.2) {
    const tx = -moveRes.wallNormalZ;
    const tz = moveRes.wallNormalX;
    const tangentProj = vx * tx + vz * tz;
    const parity = (parseInt(u.id.split('_')[1] ?? '1', 10) || 1) % 2 === 0 ? 1 : -1;
    const slideSign = Math.abs(tangentProj) > 0.2 * desiredSpeed ? (tangentProj >= 0 ? 1 : -1) : parity;
    u.avoidanceDirX = tx * slideSign;
    u.avoidanceDirZ = tz * slideSign;
    u.avoidanceLatchTimerSec = Math.max(u.avoidanceLatchTimerSec, 0.38);
  }

  u.lastColliderHit = moveRes.lastBlockerId;
  u.activeContacts = moveRes.activeContacts ?? 0;
  u.maxPenetrationDepth = moveRes.maxPenetrationDepth ?? 0;

  // Measure actual world-space displacement speed (smoothed for jitter-free gait sync)
  const rawHorizSpeed = Math.hypot(u.position.x - prevX, u.position.z - prevZ) / safeDt;
  const rawVertSpeed = (u.position.y - prevY) / safeDt;
  const smoothAlpha = 1 - Math.exp(-16 * safeDt);
  u.actualHorizSpeed =
    u.actualHorizSpeed !== undefined
      ? THREE.MathUtils.lerp(u.actualHorizSpeed, rawHorizSpeed, smoothAlpha)
      : rawHorizSpeed;
  u.actualVertSpeed =
    u.actualVertSpeed !== undefined
      ? THREE.MathUtils.lerp(u.actualVertSpeed, rawVertSpeed, smoothAlpha)
      : rawVertSpeed;

  // Stuck detector & deterministic anti-oscillation escape impulse
  if (u.isMoving) {
    if (u.lastProgressX === undefined || u.lastProgressZ === undefined) {
      u.lastProgressX = u.position.x;
      u.lastProgressZ = u.position.z;
      u.stuckTimerSec = 0;
    } else {
      const progressDist = Math.hypot(
        u.position.x - u.lastProgressX,
        u.position.z - u.lastProgressZ
      );
      if (progressDist >= 0.35) {
        u.lastProgressX = u.position.x;
        u.lastProgressZ = u.position.z;
        u.stuckTimerSec = 0;
      } else {
        u.stuckTimerSec = (u.stuckTimerSec ?? 0) + safeDt;
        if (u.stuckTimerSec >= 0.85) {
          stuckTriggered = true;
          u.stuckTimerSec = 0;
          u.lastProgressX = u.position.x;
          u.lastProgressZ = u.position.z;
          // Flip tangential latch deterministically to break symmetric doorway/corner deadlocks
          const oldX = u.avoidanceDirX;
          const oldZ = u.avoidanceDirZ;
          if (Math.hypot(oldX, oldZ) > 0.2) {
            u.avoidanceDirX = -oldX;
            u.avoidanceDirZ = -oldZ;
          } else {
            const parity = (parseInt(u.id.split('_')[1] ?? '1', 10) || 1) % 2 === 0 ? 1 : -1;
            const norm = Math.max(0.01, moveLen);
            u.avoidanceDirX = (-desiredMoveZ / norm) * parity;
            u.avoidanceDirZ = (desiredMoveX / norm) * parity;
          }
          u.avoidanceLatchTimerSec = 0.55;
        }
      }
    }
  } else {
    u.lastProgressX = u.position.x;
    u.lastProgressZ = u.position.z;
  }

  return {
    grounded: moveRes.grounded,
    hitWall: moveRes.hitWall,
    actualHorizSpeed: u.actualHorizSpeed,
    actualVertSpeed: u.actualVertSpeed,
    stuckTriggered,
  };
}
