import { SpatialAABB, SpatialHash } from '@/src/physics/SpatialHash';

export interface RaycastHitResult {
  hit: boolean;
  distance: number;
  pointX: number;
  pointY: number;
  pointZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  collider: SpatialAABB | null;
}

export interface CircleBoxContact2D {
  overlaps: boolean;
  penetration: number;
  normalX: number;
  normalZ: number;
  contactX: number;
  contactZ: number;
}

/**
 * Centralized collision-query and narrow-phase geometry system.
 * Separates collision detection from collision response and computes exact 3D surface normals.
 */
export class CollisionSystem {
  private readonly queryScratch: SpatialAABB[] = [];

  public raycastsThisFrame = 0;
  public shapeCastsThisFrame = 0;
  public narrowPhaseChecksThisFrame = 0;

  resetFrameCounters(): void {
    this.raycastsThisFrame = 0;
    this.shapeCastsThisFrame = 0;
    this.narrowPhaseChecksThisFrame = 0;
  }

  /**
   * Exact 3D slab ray-vs-AABB / ray-vs-OBB intersection that computes the true hit face normal.
   */
  intersectRayBox(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    b: SpatialAABB,
    radius: number,
    out: RaycastHitResult
  ): boolean {
    this.narrowPhaseChecksThisFrame++;

    // Handle oriented bounding box (OBB) in local space if yaw is non-zero
    if (b.yaw && Math.abs(b.yaw) > 1e-4 && b.centerX !== undefined && b.centerZ !== undefined && b.halfExtX !== undefined && b.halfExtZ !== undefined) {
      const cos = Math.cos(-b.yaw);
      const sin = Math.sin(-b.yaw);
      const relX = ox - b.centerX;
      const relZ = oz - b.centerZ;
      const lox = relX * cos - relZ * sin;
      const loz = relX * sin + relZ * cos;
      const ldx = dx * cos - dz * sin;
      const ldz = dx * sin + dz * cos;

      const localHit = this.intersectRayAxisAlignedSlabs(
        lox,
        oy,
        loz,
        ldx,
        dy,
        ldz,
        maxDist,
        -b.halfExtX - radius,
        b.minY - radius,
        -b.halfExtZ - radius,
        b.halfExtX + radius,
        b.maxY + radius,
        b.halfExtZ + radius,
        out
      );
      if (!localHit) return false;

      // Rotate normal and contact point back to world space
      const wCos = Math.cos(b.yaw);
      const wSin = Math.sin(b.yaw);
      const wnx = out.normalX * wCos - out.normalZ * wSin;
      const wnz = out.normalX * wSin + out.normalZ * wCos;
      out.normalX = wnx;
      out.normalZ = wnz;
      out.pointX = ox + dx * out.distance;
      out.pointY = oy + dy * out.distance;
      out.pointZ = oz + dz * out.distance;
      out.collider = b;
      return true;
    }

    const hit = this.intersectRayAxisAlignedSlabs(
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      maxDist,
      b.minX - radius,
      b.minY - radius,
      b.minZ - radius,
      b.maxX + radius,
      b.maxY + radius,
      b.maxZ + radius,
      out
    );
    if (hit) {
      out.collider = b;
    }
    return hit;
  }

  private intersectRayAxisAlignedSlabs(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    out: RaycastHitResult
  ): boolean {
    let tmin = 0;
    let tmax = maxDist;
    let nx = 0;
    let ny = 0;
    let nz = 0;

    // X slab
    if (Math.abs(dx) < 1e-8) {
      if (ox < minX || ox > maxX) return false;
    } else {
      const inv = 1 / dx;
      let t1 = (minX - ox) * inv;
      let t2 = (maxX - ox) * inv;
      let n1x = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n1x = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = n1x;
        ny = 0;
        nz = 0;
      }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }

    // Y slab
    if (Math.abs(dy) < 1e-8) {
      if (oy < minY || oy > maxY) return false;
    } else {
      const inv = 1 / dy;
      let t1 = (minY - oy) * inv;
      let t2 = (maxY - oy) * inv;
      let n1y = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n1y = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        ny = n1y;
        nz = 0;
      }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }

    // Z slab
    if (Math.abs(dz) < 1e-8) {
      if (oz < minZ || oz > maxZ) return false;
    } else {
      const inv = 1 / dz;
      let t1 = (minZ - oz) * inv;
      let t2 = (maxZ - oz) * inv;
      let n1z = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n1z = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        ny = 0;
        nz = n1z;
      }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }

    if (tmin < 0 || tmin > maxDist) return false;

    // If ray started inside the expanded slab (tmin === 0), derive normal from nearest face or opposite ray dir
    if (nx === 0 && ny === 0 && nz === 0) {
      const dMinX = Math.abs(ox - minX);
      const dMaxX = Math.abs(maxX - ox);
      const dMinY = Math.abs(oy - minY);
      const dMaxY = Math.abs(maxY - oy);
      const dMinZ = Math.abs(oz - minZ);
      const dMaxZ = Math.abs(maxZ - oz);
      const minD = Math.min(dMinX, dMaxX, dMinY, dMaxY, dMinZ, dMaxZ);
      if (minD === dMinX) nx = -1;
      else if (minD === dMaxX) nx = 1;
      else if (minD === dMinY) ny = -1;
      else if (minD === dMaxY) ny = 1;
      else if (minD === dMinZ) nz = -1;
      else nz = 1;
    }

    out.hit = true;
    out.distance = tmin;
    out.pointX = ox + dx * tmin;
    out.pointY = oy + dy * tmin;
    out.pointZ = oz + dz * tmin;
    out.normalX = nx;
    out.normalY = ny;
    out.normalZ = nz;
    return true;
  }

  /**
   * Swept ray or sphere cast against SpatialHash + ground plane y=0.
   */
  sweptCast(
    spatialHash: SpatialHash,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    radius: number,
    layerMask: number,
    outHit: RaycastHitResult,
    ignoreColliderId?: string | null
  ): boolean {
    if (radius > 0) {
      this.shapeCastsThisFrame++;
    } else {
      this.raycastsThisFrame++;
    }

    outHit.hit = false;
    outHit.distance = maxDist;
    outHit.collider = null;

    const endX = ox + dx * maxDist;
    const endZ = oz + dz * maxDist;
    const minX = Math.min(ox, endX) - radius - 0.5;
    const maxX = Math.max(ox, endX) + radius + 0.5;
    const minZ = Math.min(oz, endZ) - radius - 0.5;
    const maxZ = Math.max(oz, endZ) + radius + 0.5;

    const candidates = spatialHash.queryAABB(minX, minZ, maxX, maxZ, layerMask, this.queryScratch);
    const scratchHit: RaycastHitResult = {
      hit: false,
      distance: maxDist,
      pointX: 0,
      pointY: 0,
      pointZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      collider: null,
    };

    for (let i = 0; i < candidates.length; i++) {
      const box = candidates[i];
      if (ignoreColliderId && box.id === ignoreColliderId) continue;

      if (this.intersectRayBox(ox, oy, oz, dx, dy, dz, outHit.distance, box, radius, scratchHit)) {
        if (scratchHit.distance < outHit.distance) {
          outHit.hit = true;
          outHit.distance = scratchHit.distance;
          outHit.pointX = scratchHit.pointX;
          outHit.pointY = scratchHit.pointY;
          outHit.pointZ = scratchHit.pointZ;
          outHit.normalX = scratchHit.normalX;
          outHit.normalY = scratchHit.normalY;
          outHit.normalZ = scratchHit.normalZ;
          outHit.collider = box;
        }
      }
    }

    // Check ground plane y = radius
    if (dy < -1e-5) {
      const tGround = (radius - oy) / dy;
      if (tGround >= 0 && tGround < outHit.distance) {
        outHit.hit = true;
        outHit.distance = tGround;
        outHit.pointX = ox + dx * tGround;
        outHit.pointY = radius;
        outHit.pointZ = oz + dz * tGround;
        outHit.normalX = 0;
        outHit.normalY = 1;
        outHit.normalZ = 0;
        outHit.collider = null;
      }
    }

    return outHit.hit;
  }

  /**
   * 2D horizontal circle vs AABB / OBB overlap test.
   * Returns exact penetration depth and outward push normal in world XZ plane.
   */
  testCircleBox2D(
    cx: number,
    cz: number,
    radius: number,
    box: SpatialAABB,
    out: CircleBoxContact2D
  ): boolean {
    this.narrowPhaseChecksThisFrame++;
    out.overlaps = false;

    if (
      box.yaw &&
      Math.abs(box.yaw) > 1e-4 &&
      box.centerX !== undefined &&
      box.centerZ !== undefined &&
      box.halfExtX !== undefined &&
      box.halfExtZ !== undefined
    ) {
      const cos = Math.cos(-box.yaw);
      const sin = Math.sin(-box.yaw);
      const relX = cx - box.centerX;
      const relZ = cz - box.centerZ;
      const lx = relX * cos - relZ * sin;
      const lz = relX * sin + relZ * cos;

      const hitLocal = this.testCircleAxisAligned2D(
        lx,
        lz,
        radius,
        -box.halfExtX,
        -box.halfExtZ,
        box.halfExtX,
        box.halfExtZ,
        out
      );
      if (!hitLocal) return false;

      const wCos = Math.cos(box.yaw);
      const wSin = Math.sin(box.yaw);
      const wnx = out.normalX * wCos - out.normalZ * wSin;
      const wnz = out.normalX * wSin + out.normalZ * wCos;
      const wcx = box.centerX + out.contactX * wCos - out.contactZ * wSin;
      const wcz = box.centerZ + out.contactX * wSin + out.contactZ * wCos;
      out.normalX = wnx;
      out.normalZ = wnz;
      out.contactX = wcx;
      out.contactZ = wcz;
      return true;
    }

    return this.testCircleAxisAligned2D(cx, cz, radius, box.minX, box.minZ, box.maxX, box.maxZ, out);
  }

  private testCircleAxisAligned2D(
    cx: number,
    cz: number,
    radius: number,
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    out: CircleBoxContact2D
  ): boolean {
    const closestX = Math.max(minX, Math.min(cx, maxX));
    const closestZ = Math.max(minZ, Math.min(cz, maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq >= radius * radius) {
      return false;
    }

    out.overlaps = true;
    const dist = Math.sqrt(distSq);
    if (dist > 1e-5) {
      out.penetration = radius - dist;
      out.normalX = dx / dist;
      out.normalZ = dz / dist;
      out.contactX = closestX;
      out.contactZ = closestZ;
    } else {
      // Circle center is inside the box: push out along the shallowest face axis
      const dLeft = cx - minX;
      const dRight = maxX - cx;
      const dBack = cz - minZ;
      const dFront = maxZ - cz;
      const minEdge = Math.min(dLeft, dRight, dBack, dFront);
      if (minEdge === dLeft) {
        out.normalX = -1;
        out.normalZ = 0;
        out.penetration = dLeft + radius;
        out.contactX = minX;
        out.contactZ = cz;
      } else if (minEdge === dRight) {
        out.normalX = 1;
        out.normalZ = 0;
        out.penetration = dRight + radius;
        out.contactX = maxX;
        out.contactZ = cz;
      } else if (minEdge === dBack) {
        out.normalX = 0;
        out.normalZ = -1;
        out.penetration = dBack + radius;
        out.contactX = cx;
        out.contactZ = minZ;
      } else {
        out.normalX = 0;
        out.normalZ = 1;
        out.penetration = dFront + radius;
        out.contactX = cx;
        out.contactZ = maxZ;
      }
    }
    return true;
  }

  /**
   * Checks whether a vertical capsule volume at (x, feetY..feetY+targetHeight, z) is free of solid obstacles.
   * Used to prevent standing up from crouch/slide under low ceilings, overhangs, or door lintels,
   * and to verify step-up destination clearance.
   */
  hasVerticalCapsuleClearance(
    spatialHash: SpatialHash,
    x: number,
    feetY: number,
    z: number,
    radius: number,
    targetHeight: number,
    layerMask: number
  ): { clear: boolean; blocker: SpatialAABB | null } {
    this.shapeCastsThisFrame++;
    const checkRadius = Math.max(0.1, radius - 0.03);
    const candidates = spatialHash.queryAABB(
      x - checkRadius - 0.2,
      z - checkRadius - 0.2,
      x + checkRadius + 0.2,
      z + checkRadius + 0.2,
      layerMask,
      this.queryScratch
    );

    const headY = feetY + targetHeight;
    const minCheckY = feetY + 0.15;
    const contact2D: CircleBoxContact2D = {
      overlaps: false,
      penetration: 0,
      normalX: 0,
      normalZ: 0,
      contactX: 0,
      contactZ: 0,
    };

    for (let i = 0; i < candidates.length; i++) {
      const box = candidates[i];
      if (headY <= box.minY + 0.01 || minCheckY >= box.maxY - 0.01) continue;
      if (this.testCircleBox2D(x, z, checkRadius, box, contact2D)) {
        return { clear: false, blocker: box };
      }
    }
    return { clear: true, blocker: null };
  }
}
