export interface LadderVolume {
  id: string;
  entityId?: string;
  /** World X/Z of the ladder rung center plane */
  x: number;
  z: number;
  /** Bottom rung / ground contact elevation */
  bottomY: number;
  /** Top deck elevation where the climber steps off */
  topY: number;
  /** Climbable width across ladder rails (meters) */
  width: number;
  /** Outward horizontal unit normal pointing away from the supporting wall toward the climber */
  normalX: number;
  normalZ: number;
  /** World coordinates where climber stands when dismounting at the top */
  topExitX: number;
  topExitY: number;
  topExitZ: number;
  /** World coordinates where climber stands at the base */
  bottomExitX: number;
  bottomExitY: number;
  bottomExitZ: number;
  /** Navigation surface IDs connected by this ladder (0 = ground) */
  fromSurfaceId: number;
  toSurfaceId: number;
}

export interface CreateLadderVolumeParams {
  id: string;
  entityId?: string;
  x: number;
  z: number;
  bottomY: number;
  topY: number;
  width?: number;
  /** Outward normal pointing toward climber */
  normalX: number;
  normalZ: number;
  /** Optional explicit top dismount offset into the upper deck (meters, default 0.82) */
  topDismountDepth?: number;
  topExitX?: number;
  topExitZ?: number;
  bottomExitX?: number;
  bottomExitZ?: number;
  fromSurfaceId?: number;
  toSurfaceId?: number;
}

export function createLadderVolume(params: CreateLadderVolumeParams): LadderVolume {
  const nLen = Math.max(1e-5, Math.hypot(params.normalX, params.normalZ));
  const nx = params.normalX / nLen;
  const nz = params.normalZ / nLen;
  const width = Math.max(0.55, params.width ?? 0.78);
  const topDepth = params.topDismountDepth ?? 0.82;
  const standOff = 0.52;

  return {
    id: params.id,
    entityId: params.entityId,
    x: params.x,
    z: params.z,
    bottomY: params.bottomY,
    topY: params.topY,
    width,
    normalX: nx,
    normalZ: nz,
    topExitX: params.topExitX ?? params.x - nx * topDepth,
    topExitY: params.topY,
    topExitZ: params.topExitZ ?? params.z - nz * topDepth,
    bottomExitX: params.bottomExitX ?? params.x + nx * standOff,
    bottomExitY: params.bottomY,
    bottomExitZ: params.bottomExitZ ?? params.z + nz * standOff,
    fromSurfaceId: params.fromSurfaceId ?? 0,
    toSurfaceId: params.toSurfaceId ?? 0,
  };
}

export interface LadderMountCandidate {
  ladder: LadderVolume;
  /** 'bottom' when mounting from ground/mid-height, 'top' when descending from upper deck */
  entrySide: 'bottom' | 'top';
  distance: number;
}

/**
 * Finds the nearest climbable ladder within mount range for a character at `(x, feetY, z)`
 * facing `(lookX, lookZ)`.
 */
export function findMountableLadder(
  ladders: readonly LadderVolume[],
  x: number,
  feetY: number,
  z: number,
  lookX: number,
  lookZ: number,
  maxDist = 1.25
): LadderMountCandidate | null {
  const lookLen = Math.hypot(lookX, lookZ);
  const lx = lookLen > 1e-4 ? lookX / lookLen : 0;
  const lz = lookLen > 1e-4 ? lookZ / lookLen : -1;

  let best: LadderMountCandidate | null = null;

  for (let i = 0; i < ladders.length; i++) {
    const lad = ladders[i];
    const relX = x - lad.x;
    const relZ = z - lad.z;
    // Signed distance along outward normal (positive = in front of ladder rungs)
    const frontDist = relX * lad.normalX + relZ * lad.normalZ;
    // Lateral distance along ladder width
    const latDist = Math.abs(-relX * lad.normalZ + relZ * lad.normalX);

    if (latDist > lad.width * 0.5 + 0.52) continue;

    // Case 1: Mounting from the front (bottom or mid-climb catch)
    const nearFront = frontDist >= -0.25 && frontDist <= maxDist;
    const withinVerticalSpan = feetY >= lad.bottomY - 0.65 && feetY <= lad.topY - 0.35;
    if (nearFront && withinVerticalSpan) {
      // Looking roughly toward the ladder (opposite outward normal)
      const facingLadder = -(lx * lad.normalX + lz * lad.normalZ);
      if (facingLadder >= 0.25) {
        const dist = Math.hypot(frontDist - 0.45, latDist);
        if (!best || dist < best.distance) {
          best = { ladder: lad, entrySide: 'bottom', distance: dist };
        }
      }
      continue;
    }

    // Case 2: Mounting from the top deck edge to climb down
    const nearTopHeight = Math.abs(feetY - lad.topY) <= 0.55;
    const nearTopEdge = frontDist >= -1.25 && frontDist <= 0.45;
    if (nearTopHeight && nearTopEdge) {
      // Looking roughly outward toward the ladder drop-off
      const facingEdge = lx * lad.normalX + lz * lad.normalZ;
      if (facingEdge >= 0.15) {
        const dist = Math.hypot(frontDist + 0.45, latDist);
        if (!best || dist < best.distance) {
          best = { ladder: lad, entrySide: 'top', distance: dist };
        }
      }
    }
  }

  return best;
}
