import * as THREE from 'three';
import { getAgentTraversalProfile } from '@/src/navigation/AgentTraversalProfile';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { SOLID_OBSTRUCTION_MASK } from '@/src/gameplay/BallisticSolver';
import { DifficultyCombatProfile } from '@/src/schemas/combat.schema';
import { EnemyArchetype } from '@/src/schemas/enemy.schema';
import type { EnemyUnit } from '@/src/gameplay/EnemyManager';

export interface CoverCandidateSlot {
  node: THREE.Vector3;
  candX: number;
  candZ: number;
  maxScore: number;
}

export function computeEnemyReactionDelay(
  archetype: EnemyArchetype,
  distMeters: number,
  diffProfile: DifficultyCombatProfile,
  alreadySuspicious: boolean,
  rngNext?: () => number
): number {
  const jitter = ((rngNext ? rngNext() : 0.5) * 2 - 1) * diffProfile.reactionDelayJitterSec;
  const distFactor = Math.min(0.32, Math.max(0, (distMeters - 15) * 0.0045));
  const roleFactor = archetype === 'elite_assault' ? -0.06 : archetype === 'heavy_armor' ? 0.08 : 0;
  const stateBonus = alreadySuspicious ? -0.1 : 0;
  return Math.max(0.16, diffProfile.reactionDelayBaseSec + jitter + distFactor + roleFactor + stateBonus);
}

/**
 * Geometry-driven 3D anatomical multi-point cover evaluation.
 * Resolves candidate support elevation across multi-level surfaces, checks standing clearance,
 * squad separation >= 2.2m, crouched chest/head protection, and parapet pop-up firing viability.
 */
export function evaluateTacticalCover(params: {
  unit: EnemyUnit;
  nodes: THREE.Vector3[];
  threatPos: THREE.Vector3;
  preferAway: boolean;
  collision: CollisionWorld;
  squadmates?: ReadonlyArray<EnemyUnit>;
  candPool: CoverCandidateSlot[];
  candScratch: THREE.Vector3;
  rayHitScratch: RayHit;
}): THREE.Vector3 | null {
  const {
    unit,
    nodes,
    threatPos,
    preferAway,
    collision,
    squadmates,
    candPool,
    candScratch,
    rayHitScratch,
  } = params;

  let bestX = 0;
  let bestY = 0;
  let bestZ = 0;
  let found = false;
  let bestScore = -1e9;
  const prof = getAgentTraversalProfile(unit.agentProfile);
  const threatEyeY =
    (threatPos.y > 0.4 ? threatPos.y : collision.getGroundHeightAt(threatPos.x, threatPos.z)) +
    1.45;

  // Stage 1: Zero-physics heuristic upper-bound scoring over nodes
  let candCount = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const dx = n.x - threatPos.x;
    const dz = n.z - threatPos.z;
    const dThreatNode = Math.hypot(dx, dz);
    if (dThreatNode < 0.5) continue;

    const inv = 1 / dThreatNode;
    const candX = n.x + dx * inv * 1.1;
    const candZ = n.z + dz * inv * 1.1;
    const dSelfXZ = Math.hypot(unit.position.x - candX, unit.position.z - candZ);
    const dThreatCand = Math.hypot(candX - threatPos.x, candZ - threatPos.z);
    const maxParapet = !preferAway ? 3.5 : 1.0;
    const maxElev = n.y > 0.4 ? 2.5 : 0;
    const maxScore =
      (preferAway ? dThreatCand : -Math.abs(dThreatCand - 22)) -
      dSelfXZ * 0.8 +
      maxParapet +
      maxElev;

    let slot = candPool[candCount];
    if (!slot) {
      slot = { node: n, candX, candZ, maxScore };
      candPool[candCount] = slot;
    } else {
      slot.node = n;
      slot.candX = candX;
      slot.candZ = candZ;
      slot.maxScore = maxScore;
    }
    candCount++;
  }

  // Stage 2: Partial selection sort ranking top-16 candidates; expand only if none succeed
  const topLimit = Math.min(candCount, 16);
  for (let k = 0; k < candCount; k++) {
    if (k < topLimit) {
      let bestIdx = k;
      let bestMax = candPool[k].maxScore;
      for (let m = k + 1; m < candCount; m++) {
        if (candPool[m].maxScore > bestMax) {
          bestMax = candPool[m].maxScore;
          bestIdx = m;
        }
      }
      if (bestIdx !== k) {
        const tmp = candPool[k];
        candPool[k] = candPool[bestIdx];
        candPool[bestIdx] = tmp;
      }
    } else if (found) {
      break;
    }

    const cand = candPool[k];
    if (found && cand.maxScore <= bestScore) {
      if (k < topLimit) break;
      continue;
    }

    const n = cand.node;
    const candX = cand.candX;
    const candZ = cand.candZ;

    const candY =
      n.y > 0.4
        ? collision.getSupportHeightAt(
            candX,
            n.y + 0.8,
            candZ,
            prof.standingHeight,
            prof.maxStepHeight,
            prof.maxSlopeDeg
          )
        : collision.getGroundHeightAt(candX, candZ);
    candScratch.set(candX, candY, candZ);

    if (!collision.canStandUp(candScratch, prof.capsuleRadius, prof.standingHeight, unit.id)) {
      continue;
    }

    let claimedBySquad = false;
    if (squadmates) {
      for (let j = 0; j < squadmates.length; j++) {
        const other = squadmates[j];
        if (!other.alive || other.id === unit.id) continue;
        if (other.coverTarget) {
          const cdx = other.coverTarget.x - candX;
          const cdz = other.coverTarget.z - candZ;
          if (cdx * cdx + cdz * cdz < 2.2 * 2.2) {
            claimedBySquad = true;
            break;
          }
        }
        const pdx = other.position.x - candX;
        const pdz = other.position.z - candZ;
        if (pdx * pdx + pdz * pdz < 2.2 * 2.2) {
          claimedBySquad = true;
          break;
        }
      }
    }
    if (claimedBySquad) continue;

    // Multi-point 3D anatomical raycasts (crouched chest +0.72m / head +1.08m, standing head +1.58m)
    const rdx = candX - threatPos.x;
    const rdz = candZ - threatPos.z;
    const rdyCrouchChest = candY + 0.72 - threatEyeY;
    const rDistCC = Math.hypot(rdx, rdyCrouchChest, rdz);
    if (rDistCC < 0.8) continue;

    const invCC = 1 / rDistCC;
    const crouchChestBlocked = collision.sweptSegmentTest(
      threatPos.x,
      threatEyeY,
      threatPos.z,
      rdx * invCC,
      rdyCrouchChest * invCC,
      rdz * invCC,
      rDistCC - 0.45,
      SOLID_OBSTRUCTION_MASK,
      rayHitScratch,
      unit.id
    );
    if (!crouchChestBlocked || !rayHitScratch.hit) continue;

    const rdyCrouchHead = candY + 1.08 - threatEyeY;
    const rDistCH = Math.hypot(rdx, rdyCrouchHead, rdz);
    const invCH = 1 / Math.max(0.8, rDistCH);
    const crouchHeadBlocked = collision.sweptSegmentTest(
      threatPos.x,
      threatEyeY,
      threatPos.z,
      rdx * invCH,
      rdyCrouchHead * invCH,
      rdz * invCH,
      Math.max(0.3, rDistCH - 0.45),
      SOLID_OBSTRUCTION_MASK,
      rayHitScratch,
      unit.id
    );
    if (!crouchHeadBlocked || !rayHitScratch.hit) continue;

    const rdyStandHead = candY + 1.58 - threatEyeY;
    const rDistSH = Math.hypot(rdx, rdyStandHead, rdz);
    const invSH = 1 / Math.max(0.8, rDistSH);
    const standHeadBlocked = collision.sweptSegmentTest(
      threatPos.x,
      threatEyeY,
      threatPos.z,
      rdx * invSH,
      rdyStandHead * invSH,
      rdz * invSH,
      Math.max(0.3, rDistSH - 0.45),
      SOLID_OBSTRUCTION_MASK,
      rayHitScratch,
      unit.id
    );

    const dSelf = Math.hypot(unit.position.x - candX, unit.position.y - candY, unit.position.z - candZ);
    const dThreatCand = Math.hypot(candX - threatPos.x, candZ - threatPos.z);
    const parapetBonus = !standHeadBlocked && !preferAway ? 3.5 : 1.0;
    const elevationBonus = candY > threatPos.y + 3.0 ? 2.5 : 0;
    const score =
      (preferAway ? dThreatCand : -Math.abs(dThreatCand - 22)) -
      dSelf * 0.8 +
      parapetBonus +
      elevationBonus;
    if (score > bestScore) {
      bestScore = score;
      bestX = candX;
      bestY = candY;
      bestZ = candZ;
      found = true;
    }
  }

  return found ? new THREE.Vector3(bestX, bestY, bestZ) : null;
}
