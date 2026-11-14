import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from './SpatialHash';

// Enable three-mesh-bvh accelerated raycasting on BufferGeometry & Mesh prototypes
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface RayHit {
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

export interface PhysicsBackend {
  resolvePlayerCapsule(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number,
    stepHeight: number,
    dt: number
  ): { grounded: boolean };
  sweptSegmentTest(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    layerMask: number,
    outHit: RayHit
  ): boolean;
}

export class CollisionWorld implements PhysicsBackend {
  public readonly spatialHash = new SpatialHash(8);
  private staticBoxes: SpatialAABB[] = [];
  private bvhMeshes: THREE.Mesh[] = [];
  private queryScratch: SpatialAABB[] = [];
  private terrainHeightFn: (x: number, z: number) => number = () => 0;

  private readonly raycaster = new THREE.Raycaster();
  private readonly _origin = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();

  setTerrainHeightFn(fn: (x: number, z: number) => number): void {
    this.terrainHeightFn = fn;
  }

  getGroundHeightAt(x: number, z: number): number {
    return this.terrainHeightFn(x, z);
  }

  addStaticBox(box: SpatialAABB): void {
    this.staticBoxes.push(box);
    this.spatialHash.insert(box);
  }

  registerBvhMesh(mesh: THREE.Mesh): void {
    if (!mesh.geometry.boundsTree) {
      mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
    }
    this.bvhMeshes.push(mesh);
  }

  resolvePlayerCapsule(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number,
    stepHeight: number,
    dt: number
  ): { grounded: boolean } {
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;

    const candidates = this.spatialHash.queryAABB(
      pos.x - radius - 1,
      pos.z - radius - 1,
      pos.x + radius + 1,
      pos.z + radius + 1,
      COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER | COLLISION_LAYER.VEHICLE | COLLISION_LAYER.DESTRUCTIBLE,
      this.queryScratch
    );

    const feetY = pos.y;
    const headY = pos.y + height;

    for (let i = 0; i < candidates.length; i++) {
      const box = candidates[i];
      if (headY <= box.minY || feetY >= box.maxY) continue;

      // Step-up support for curbs, stairs, and low obstacles
      if (box.maxY - feetY <= stepHeight && vel.y <= 0.1) {
        pos.y = box.maxY;
        continue;
      }

      const closestX = Math.max(box.minX, Math.min(pos.x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(pos.z, box.maxZ));
      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        if (dist > 0.0001) {
          const push = radius - dist;
          pos.x += (dx / dist) * push;
          pos.z += (dz / dist) * push;
        } else {
          // Inside AABB fallback push along shallowest axis
          const penLeft = Math.abs(pos.x - box.minX);
          const penRight = Math.abs(box.maxX - pos.x);
          const penFront = Math.abs(pos.z - box.minZ);
          const penBack = Math.abs(box.maxZ - pos.z);
          const minPen = Math.min(penLeft, penRight, penFront, penBack);
          if (minPen === penLeft) pos.x = box.minX - radius;
          else if (minPen === penRight) pos.x = box.maxX + radius;
          else if (minPen === penFront) pos.z = box.minZ - radius;
          else pos.z = box.maxZ + radius;
        }
      }
    }

    // Clamp to arena boundary
    pos.x = Math.max(-112, Math.min(112, pos.x));
    pos.z = Math.max(-112, Math.min(112, pos.z));

    pos.y += vel.y * dt;
    let groundY = this.terrainHeightFn(pos.x, pos.z);

    // Stand on top of boxes when descending onto them
    for (let i = 0; i < candidates.length; i++) {
      const box = candidates[i];
      if (
        pos.x >= box.minX - radius * 0.7 &&
        pos.x <= box.maxX + radius * 0.7 &&
        pos.z >= box.minZ - radius * 0.7 &&
        pos.z <= box.maxZ + radius * 0.7
      ) {
        if (pos.y >= box.maxY - 0.5 && box.maxY > groundY) {
          groundY = box.maxY;
        }
      }
    }

    let grounded = false;
    if (pos.y <= groundY) {
      pos.y = groundY;
      if (vel.y < 0) vel.y = 0;
      grounded = true;
    }

    return { grounded };
  }

  sweptSegmentTest(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    layerMask: number,
    outHit: RayHit
  ): boolean {
    outHit.hit = false;
    outHit.distance = maxDist;
    outHit.collider = null;

    const endX = ox + dx * maxDist;
    const endZ = oz + dz * maxDist;
    const minX = Math.min(ox, endX) - 1;
    const maxX = Math.max(ox, endX) + 1;
    const minZ = Math.min(oz, endZ) - 1;
    const maxZ = Math.max(oz, endZ) + 1;

    const candidates = this.spatialHash.queryAABB(minX, minZ, maxX, maxZ, layerMask, this.queryScratch);

    for (let i = 0; i < candidates.length; i++) {
      const box = candidates[i];
      const t = this.intersectRayAABB(ox, oy, oz, dx, dy, dz, box, outHit.distance);
      if (t !== null && t >= 0 && t < outHit.distance) {
        outHit.hit = true;
        outHit.distance = t;
        outHit.pointX = ox + dx * t;
        outHit.pointY = oy + dy * t;
        outHit.pointZ = oz + dz * t;
        outHit.collider = box;
        outHit.normalX = 0;
        outHit.normalY = 1;
        outHit.normalZ = 0;
      }
    }

    // Check terrain ground intersection if ray points downward
    if ((layerMask & COLLISION_LAYER.WORLD) !== 0 && dy < -0.01) {
      const steps = 10;
      const stepDist = outHit.distance / steps;
      for (let s = 1; s <= steps; s++) {
        const dist = s * stepDist;
        const px = ox + dx * dist;
        const py = oy + dy * dist;
        const pz = oz + dz * dist;
        const gh = this.terrainHeightFn(px, pz);
        if (py <= gh) {
          outHit.hit = true;
          outHit.distance = dist;
          outHit.pointX = px;
          outHit.pointY = gh;
          outHit.pointZ = pz;
          outHit.normalX = 0;
          outHit.normalY = 1;
          outHit.normalZ = 0;
          outHit.collider = null;
          break;
        }
      }
    }

    // Optional BVH static mesh precision check if registered
    if ((layerMask & COLLISION_LAYER.WORLD) !== 0 && this.bvhMeshes.length > 0) {
      this._origin.set(ox, oy, oz);
      this._dir.set(dx, dy, dz);
      this.raycaster.set(this._origin, this._dir);
      this.raycaster.far = outHit.distance;
      this.raycaster.firstHitOnly = true;
      const hits = this.raycaster.intersectObjects(this.bvhMeshes, false);
      if (hits.length > 0 && hits[0].distance < outHit.distance) {
        const h = hits[0];
        outHit.hit = true;
        outHit.distance = h.distance;
        outHit.pointX = h.point.x;
        outHit.pointY = h.point.y;
        outHit.pointZ = h.point.z;
        outHit.normalX = h.face?.normal.x ?? 0;
        outHit.normalY = h.face?.normal.y ?? 1;
        outHit.normalZ = h.face?.normal.z ?? 0;
        outHit.collider = null;
      }
    }

    return outHit.hit;
  }

  private intersectRayAABB(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    box: SpatialAABB,
    maxDist: number
  ): number | null {
    let tmin = 0;
    let tmax = maxDist;

    const invDx = dx !== 0 ? 1 / dx : 1e9;
    let t1 = (box.minX - ox) * invDx;
    let t2 = (box.maxX - ox) * invDx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;

    const invDy = dy !== 0 ? 1 / dy : 1e9;
    t1 = (box.minY - oy) * invDy;
    t2 = (box.maxY - oy) * invDy;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;

    const invDz = dz !== 0 ? 1 / dz : 1e9;
    t1 = (box.minZ - oz) * invDz;
    t2 = (box.maxZ - oz) * invDz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;

    return tmin;
  }

  clear(): void {
    for (const m of this.bvhMeshes) {
      m.geometry.disposeBoundsTree?.();
    }
    this.bvhMeshes = [];
    this.staticBoxes = [];
    this.spatialHash.clear();
  }
}
