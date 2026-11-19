import type { TerrainSlopeRegion } from '@/src/engine/physics/PhysicsWorld';

export interface OrientedSlopeRegion {
  id: string;
  surfaceId: number;
  centerX: number;
  centerZ: number;
  /** Normalized horizontal ascent unit vector X */
  dirX: number;
  /** Normalized horizontal ascent unit vector Z */
  dirZ: number;
  /** Half-length along (dirX, dirZ) */
  halfLength: number;
  /** Half-width along lateral normal (-dirZ, dirX) */
  halfWidth: number;
  /** Surface Y at u = -halfLength */
  startY: number;
  /** Surface Y at u = +halfLength */
  endY: number;
  /** Physical slab thickness beneath the walkable slope plane (meters) */
  thickness: number;
  /** Slope pitch in degrees computed from run and rise */
  maxSlopeDeg: number;
  /** When true, enforces slanted lateral side-rail containment while walking along the flight */
  hasSideRails?: boolean;
}

export interface OrientedSlopeEvaluation {
  withinFootprint: boolean;
  topY: number;
  bottomY: number;
  u: number;
  v: number;
  t: number;
  slopeDeg: number;
  supportsFeet: boolean;
  hitsUndersideCeiling: boolean;
}

export interface CreateOrientedSlopeParams {
  id: string;
  surfaceId?: number;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  width: number;
  startY: number;
  endY: number;
  thickness?: number;
  hasSideRails?: boolean;
}

export function createOrientedSlopeRegion(params: CreateOrientedSlopeParams): OrientedSlopeRegion {
  const dx = params.endX - params.startX;
  const dz = params.endZ - params.startZ;
  const len = Math.max(0.01, Math.hypot(dx, dz));
  const dirX = dx / len;
  const dirZ = dz / len;
  const halfLength = len * 0.5;
  const halfWidth = Math.max(0.25, params.width * 0.5);
  const rise = Math.abs(params.endY - params.startY);
  const maxSlopeDeg = (Math.atan2(rise, len) * 180) / Math.PI;
  return {
    id: params.id,
    surfaceId: params.surfaceId ?? 0,
    centerX: (params.startX + params.endX) * 0.5,
    centerZ: (params.startZ + params.endZ) * 0.5,
    dirX,
    dirZ,
    halfLength,
    halfWidth,
    startY: params.startY,
    endY: params.endY,
    thickness: Math.max(0.18, params.thickness ?? 0.45),
    maxSlopeDeg,
    hasSideRails: params.hasSideRails ?? false,
  };
}

export function isOrientedSlopeRegion(
  slope: TerrainSlopeRegion | OrientedSlopeRegion
): slope is OrientedSlopeRegion {
  return 'dirX' in slope && 'halfLength' in slope && 'centerX' in slope;
}

export function legacySlopeToOriented(
  slope: TerrainSlopeRegion,
  index = 0
): OrientedSlopeRegion {
  const centerX = (slope.minX + slope.maxX) * 0.5;
  const startZ = slope.startZ;
  const endZ = slope.endZ;
  const dz = endZ - startZ;
  const halfLength = Math.max(0.05, Math.abs(dz) * 0.5);
  const dirZ = dz >= 0 ? 1 : -1;
  const halfWidth = Math.max(0.25, (slope.maxX - slope.minX) * 0.5);
  const rise = Math.abs(slope.endY - slope.startY);
  const maxSlopeDeg = (Math.atan2(rise, halfLength * 2) * 180) / Math.PI;
  return {
    id: `legacy_slope_${index}`,
    surfaceId: 0,
    centerX,
    centerZ: (startZ + endZ) * 0.5,
    dirX: 0,
    dirZ,
    halfLength,
    halfWidth,
    startY: slope.startY,
    endY: slope.endY,
    thickness: 0.45,
    maxSlopeDeg,
    hasSideRails: false,
  };
}

/**
 * Zero-allocation evaluation of an OrientedSlopeRegion against a character capsule
 * `(x, feetY, z, radius, height, stepHeight)`.
 */
export function evaluateOrientedSlopeAt(
  slope: OrientedSlopeRegion,
  x: number,
  feetY: number,
  z: number,
  radius: number,
  height: number,
  stepHeight: number,
  out: OrientedSlopeEvaluation
): boolean {
  const relX = x - slope.centerX;
  const relZ = z - slope.centerZ;
  // Lateral normal is (-dirZ, dirX)
  const u = relX * slope.dirX + relZ * slope.dirZ;
  const v = -relX * slope.dirZ + relZ * slope.dirX;

  const uLimit = slope.halfLength + 0.08;
  // Keep lateral tolerance tight so characters outside stair sides never get phantom mid-air support
  const vLimit = slope.halfWidth + Math.min(0.04, radius * 0.1);

  if (Math.abs(u) > uLimit || Math.abs(v) > vLimit) {
    out.withinFootprint = false;
    out.supportsFeet = false;
    out.hitsUndersideCeiling = false;
    return false;
  }

  const invFullLen = 1 / Math.max(0.01, slope.halfLength * 2);
  const rawT = (u + slope.halfLength) * invFullLen;
  const t = rawT < 0 ? 0 : rawT > 1 ? 1 : rawT;
  const topY = slope.startY + t * (slope.endY - slope.startY);
  const bottomY = topY - slope.thickness;
  const headY = feetY + height;
  const stepDownMargin = Math.max(0.38, stepHeight);

  out.withinFootprint = true;
  out.topY = topY;
  out.bottomY = bottomY;
  out.u = u;
  out.v = v;
  out.t = t;
  out.slopeDeg = slope.maxSlopeDeg;
  out.hitsUndersideCeiling = feetY < bottomY - 0.05 && headY > bottomY;
  out.supportsFeet =
    !out.hitsUndersideCeiling &&
    feetY >= topY - stepDownMargin &&
    feetY <= topY + stepHeight + 0.25;

  return true;
}

/**
 * Simple vertical elevation query at `(x, z)` when `referenceFeetY` is optionally supplied.
 * Picks the highest valid slope top not above `referenceFeetY + stepHeight + 0.35`.
 */
export function sampleSlopeTopAt(
  slope: OrientedSlopeRegion,
  x: number,
  z: number,
  referenceFeetY?: number,
  stepHeight = 0.55
): number | null {
  const relX = x - slope.centerX;
  const relZ = z - slope.centerZ;
  const u = relX * slope.dirX + relZ * slope.dirZ;
  const v = -relX * slope.dirZ + relZ * slope.dirX;
  if (Math.abs(u) > slope.halfLength + 0.08 || Math.abs(v) > slope.halfWidth + 0.06) {
    return null;
  }
  const t = Math.max(0, Math.min(1, (u + slope.halfLength) / Math.max(0.01, slope.halfLength * 2)));
  const topY = slope.startY + t * (slope.endY - slope.startY);
  if (referenceFeetY !== undefined) {
    const bottomY = topY - slope.thickness;
    if (referenceFeetY < bottomY - 0.05) {
      return null;
    }
    if (topY > referenceFeetY + stepHeight + 0.4) {
      return null;
    }
  }
  return topY;
}
