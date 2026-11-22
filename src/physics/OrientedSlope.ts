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
  normalX: number;
  normalY: number;
  normalZ: number;
}

export interface OrientedSlopeHorizontalBlock {
  blocked: boolean;
  pushX: number;
  pushZ: number;
  normalX: number;
  normalZ: number;
  penetration: number;
  reason: 'low_underside' | 'exterior_side' | 'slab_end';
}

export interface OrientedSlopeRayHit {
  hit: boolean;
  distance: number;
  pointX: number;
  pointY: number;
  pointZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
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

/**
 * Computes the exact upward unit surface normal of an OrientedSlopeRegion.
 */
export function computeOrientedSlopeNormal(
  slope: OrientedSlopeRegion,
  out: { normalX: number; normalY: number; normalZ: number }
): void {
  const fullLen = Math.max(0.01, slope.halfLength * 2);
  const rise = slope.endY - slope.startY;
  // Tangent along +dir is (dirX * fullLen, rise, dirZ * fullLen)
  // Lateral is (-dirZ, 0, dirX); upward normal is cross(lateral, tangent) = (-dirX * rise, fullLen, -dirZ * rise)
  const nx = -slope.dirX * rise;
  const ny = fullLen;
  const nz = -slope.dirZ * rise;
  const invLen = 1 / Math.max(1e-5, Math.hypot(nx, ny, nz));
  out.normalX = nx * invLen;
  out.normalY = ny * invLen;
  out.normalZ = nz * invLen;
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

  const uLimit = slope.halfLength + 0.12;
  // Keep lateral tolerance tight so characters outside stair sides never get phantom mid-air support
  const vLimit = slope.halfWidth + Math.min(0.05, radius * 0.12);

  if (Math.abs(u) > uLimit || Math.abs(v) > vLimit) {
    out.withinFootprint = false;
    out.supportsFeet = false;
    out.hitsUndersideCeiling = false;
    out.normalX = 0;
    out.normalY = 1;
    out.normalZ = 0;
    return false;
  }

  const invFullLen = 1 / Math.max(0.01, slope.halfLength * 2);
  const rawT = (u + slope.halfLength) * invFullLen;
  const t = rawT < 0 ? 0 : rawT > 1 ? 1 : rawT;
  const topY = slope.startY + t * (slope.endY - slope.startY);
  const bottomY = topY - slope.thickness;
  const headY = feetY + height;
  const stepDownMargin = Math.max(0.42, stepHeight);

  out.withinFootprint = true;
  out.topY = topY;
  out.bottomY = bottomY;
  out.u = u;
  out.v = v;
  out.t = t;
  out.slopeDeg = slope.maxSlopeDeg;
  computeOrientedSlopeNormal(slope, out);
  out.hitsUndersideCeiling = feetY < bottomY - 0.05 && headY > bottomY;
  out.supportsFeet =
    !out.hitsUndersideCeiling &&
    feetY >= topY - stepDownMargin &&
    feetY <= topY + stepHeight + 0.28;

  return true;
}

/**
 * Headroom-aware underside & exterior side-rail horizontal collision check against an OrientedSlopeRegion.
 * Prevents capsules from walking underneath low sloped ramps/stairs (when headroom < capsuleHeight)
 * or clipping sideways through exterior stair stringers/side-rails, while keeping tall under-spans
 * (headroom >= capsuleHeight) and walkable top entries unobstructed.
 */
export function resolveOrientedSlopeHorizontalBlock(
  slope: OrientedSlopeRegion,
  x: number,
  feetY: number,
  z: number,
  radius: number,
  height: number,
  stepHeight: number,
  out: OrientedSlopeHorizontalBlock
): boolean {
  out.blocked = false;
  out.pushX = 0;
  out.pushZ = 0;
  out.normalX = 0;
  out.normalZ = 0;
  out.penetration = 0;
  out.reason = 'exterior_side';

  const relX = x - slope.centerX;
  const relZ = z - slope.centerZ;
  const u = relX * slope.dirX + relZ * slope.dirZ;
  const v = -relX * slope.dirZ + relZ * slope.dirX;

  // Quick broad rejection in slope-local 2D coordinates
  if (Math.abs(u) >= slope.halfLength + radius || Math.abs(v) >= slope.halfWidth + radius) {
    return false;
  }

  // Closest point on slope horizontal footprint OBB
  const cu = Math.max(-slope.halfLength, Math.min(u, slope.halfLength));
  const cv = Math.max(-slope.halfWidth, Math.min(v, slope.halfWidth));
  const du = u - cu;
  const dv = v - cv;
  const distSq = du * du + dv * dv;
  if (distSq >= radius * radius) {
    return false;
  }

  const fullLen = Math.max(0.01, slope.halfLength * 2);
  const t = Math.max(0, Math.min(1, (cu + slope.halfLength) / fullLen));
  const topY = slope.startY + t * (slope.endY - slope.startY);
  const bottomY = topY - slope.thickness;
  const headY = feetY + height;
  const railExtra = slope.hasSideRails ? 0.92 : 0.0;

  // 1. If capsule is cleanly above the slope deck + rails, no horizontal block
  if (feetY >= topY + railExtra - 0.04) {
    return false;
  }

  // 2. If capsule is clearly standing on or stepping onto the walkable top surface within entry/run, do not block
  const onWalkableTop =
    feetY >= topY - Math.max(0.42, stepHeight) &&
    feetY <= topY + stepHeight + 0.28 &&
    Math.abs(v) <= slope.halfWidth + 0.04;
  if (onWalkableTop) {
    return false;
  }

  // 3. Headroom-aware underside check: if capsule stands completely underneath with >= height + 0.05m clearance,
  // allow walking or crouching smoothly underneath!
  const undersideClearance = bottomY - feetY;
  if (feetY < bottomY && undersideClearance >= height + 0.05) {
    return false;
  }

  // 4. Open entry/exit threshold guard: if approaching the open stair entry or top exit face
  // at walkable height (within stepHeight of topY), allow stepping smoothly onto the slope.
  const approachingOpenEnd =
    Math.abs(u) >= slope.halfLength - 0.08 &&
    Math.abs(v) <= slope.halfWidth - 0.04 &&
    feetY >= topY - stepHeight - 0.04 &&
    feetY <= topY + stepHeight + 0.25;
  if (approachingOpenEnd) {
    return false;
  }

  // Otherwise the capsule is colliding with either the low underside headroom barrier,
  // the solid slab edge, or the exterior side rails. Compute minimal outward horizontal push!
  const latNx = -slope.dirZ;
  const latNz = slope.dirX;
  const dist = Math.sqrt(distSq);

  let localNx = 0;
  let localNv = 0;
  let pen = 0;

  if (dist > 1e-5) {
    // Center is outside the footprint OBB — push straight out along closest-point normal
    localNx = du / dist;
    localNv = dv / dist;
    pen = radius - dist;
    out.reason = Math.abs(dv) >= Math.abs(du) ? 'exterior_side' : feetY < bottomY ? 'low_underside' : 'slab_end';
  } else {
    // Center is inside the footprint OBB (e.g. walked underneath toward low end until headroom ran out)
    const rise = slope.endY - slope.startY;
    const uphillSign = rise >= 0 ? 1 : -1;
    // Compute how far along the uphill direction until underside clearance >= height + 0.05
    const absRise = Math.abs(rise);
    let distToTallEnough = Infinity;
    if (absRise > 0.05 && feetY < bottomY) {
      const neededTopY = feetY + height + 0.05 + slope.thickness;
      const neededT = (neededTopY - slope.startY) / rise;
      if (neededT >= 0 && neededT <= 1) {
        const neededU = neededT * fullLen - slope.halfLength;
        distToTallEnough = Math.abs(neededU - u) + 0.02;
      }
    }

    const dSideNeg = v + slope.halfWidth + radius;
    const dSidePos = slope.halfWidth - v + radius;
    const dEndNeg = u + slope.halfLength + radius;
    const dEndPos = slope.halfLength - u + radius;

    const minSide = Math.min(dSideNeg, dSidePos);
    const minEnd = Math.min(dEndNeg, dEndPos);

    if (distToTallEnough < minSide && distToTallEnough < minEnd) {
      localNx = uphillSign;
      localNv = 0;
      pen = distToTallEnough;
      out.reason = 'low_underside';
    } else if (minSide <= minEnd) {
      localNx = 0;
      localNv = dSideNeg <= dSidePos ? -1 : 1;
      pen = minSide;
      out.reason = 'exterior_side';
    } else {
      localNx = dEndNeg <= dEndPos ? -1 : 1;
      localNv = 0;
      pen = minEnd;
      out.reason = feetY < bottomY ? 'low_underside' : 'slab_end';
    }
  }

  // Transform local (u, v) normal back to world XZ
  const worldNx = localNx * slope.dirX + localNv * latNx;
  const worldNz = localNx * slope.dirZ + localNv * latNz;
  const nLen = Math.max(1e-5, Math.hypot(worldNx, worldNz));

  out.blocked = true;
  out.normalX = worldNx / nLen;
  out.normalZ = worldNz / nLen;
  out.penetration = pen;
  out.pushX = out.normalX * (pen + 0.002);
  out.pushZ = out.normalZ * (pen + 0.002);
  return true;
}

/**
 * Exact 3D ray or swept-sphere intersection against the tilted rectangular prism
 * of an OrientedSlopeRegion. Used by CollisionSystem.sweptCast so projectiles,
 * LOS checks, camera spring-arms, and vault probes collide accurately with all stairs/ramps.
 */
export function intersectRayOrientedSlope(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  slope: OrientedSlopeRegion,
  radius: number,
  out: OrientedSlopeRayHit
): boolean {
  const fullLen = Math.max(0.01, slope.halfLength * 2);
  const rise = slope.endY - slope.startY;
  const inclineLen = Math.hypot(fullLen, rise);
  const invIncline = 1 / Math.max(1e-5, inclineLen);

  // Orthonormal tilted slab basis:
  // U = unit vector along incline
  const ux = (slope.dirX * fullLen) * invIncline;
  const uy = rise * invIncline;
  const uz = (slope.dirZ * fullLen) * invIncline;

  // V = horizontal lateral unit vector (-dirZ, 0, dirX)
  const vx = -slope.dirZ;
  const vy = 0;
  const vz = slope.dirX;

  // N = upward surface normal = V x U
  const nx = -slope.dirX * rise * invIncline;
  const ny = fullLen * invIncline;
  const nz = -slope.dirZ * rise * invIncline;

  // Slab center in world space (mid-height of the tilted thickness)
  const midTopY = (slope.startY + slope.endY) * 0.5;
  const perpThickness = slope.thickness * ny; // vertical thickness projected onto normal
  const halfThick = Math.max(0.08, perpThickness * 0.5);
  const cx = slope.centerX - nx * halfThick;
  const cy = midTopY - ny * halfThick;
  const cz = slope.centerZ - nz * halfThick;

  // Transform ray origin and direction into local (U, N, V) frame
  const rx = ox - cx;
  const ry = oy - cy;
  const rz = oz - cz;

  const loU = rx * ux + ry * uy + rz * uz;
  const loN = rx * nx + ry * ny + rz * nz;
  const loV = rx * vx + ry * vy + rz * vz;

  const ldU = dx * ux + dy * uy + dz * uz;
  const ldN = dx * nx + dy * ny + dz * nz;
  const ldV = dx * vx + dy * vy + dz * vz;

  const hU = inclineLen * 0.5 + radius;
  const hN = halfThick + radius;
  const hV = slope.halfWidth + radius;

  let tmin = 0;
  let tmax = maxDist;
  let hitAxis = -1; // 0=U, 1=N, 2=V
  let hitSign = 1;

  // U slab
  if (Math.abs(ldU) < 1e-8) {
    if (loU < -hU || loU > hU) return false;
  } else {
    const inv = 1 / ldU;
    let t1 = (-hU - loU) * inv;
    let t2 = (hU - loU) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitAxis = 0;
      hitSign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  // N slab
  if (Math.abs(ldN) < 1e-8) {
    if (loN < -hN || loN > hN) return false;
  } else {
    const inv = 1 / ldN;
    let t1 = (-hN - loN) * inv;
    let t2 = (hN - loN) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitAxis = 1;
      hitSign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  // V slab
  if (Math.abs(ldV) < 1e-8) {
    if (loV < -hV || loV > hV) return false;
  } else {
    const inv = 1 / ldV;
    let t1 = (-hV - loV) * inv;
    let t2 = (hV - loV) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitAxis = 2;
      hitSign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  if (tmin < 0 || tmin > maxDist) return false;

  // Map local hit normal back to world space
  let wnx = nx;
  let wny = ny;
  let wnz = nz;
  if (hitAxis === 0) {
    wnx = ux * hitSign;
    wny = uy * hitSign;
    wnz = uz * hitSign;
  } else if (hitAxis === 1) {
    wnx = nx * hitSign;
    wny = ny * hitSign;
    wnz = nz * hitSign;
  } else if (hitAxis === 2) {
    wnx = vx * hitSign;
    wny = vy * hitSign;
    wnz = vz * hitSign;
  }

  out.hit = true;
  out.distance = tmin;
  out.pointX = ox + dx * tmin;
  out.pointY = oy + dy * tmin;
  out.pointZ = oz + dz * tmin;
  out.normalX = wnx;
  out.normalY = wny;
  out.normalZ = wnz;
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
