import * as THREE from 'three';

export interface WorldChunk {
  key: string;
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  group: THREE.Group;
  bounds: THREE.Box3;
}

export interface OccluderVolume {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export class WorldChunkManager {
  public readonly chunkSize = 48;
  private chunks = new Map<string, WorldChunk>();
  private occluders: OccluderVolume[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly projScreenMatrix = new THREE.Matrix4();

  registerObject(obj: THREE.Object3D, worldX: number, worldZ: number, parentScene: THREE.Scene): void {
    const cx = Math.floor(worldX / this.chunkSize);
    const cz = Math.floor(worldZ / this.chunkSize);
    const key = `${cx}_${cz}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const group = new THREE.Group();
      group.name = `chunk_${key}`;
      parentScene.add(group);
      const minX = cx * this.chunkSize;
      const minZ = cz * this.chunkSize;
      chunk = {
        key,
        cx,
        cz,
        centerX: minX + this.chunkSize * 0.5,
        centerZ: minZ + this.chunkSize * 0.5,
        group,
        bounds: new THREE.Box3(
          new THREE.Vector3(minX - 6, -10, minZ - 6),
          new THREE.Vector3(minX + this.chunkSize + 6, 80, minZ + this.chunkSize + 6)
        ),
      };
      this.chunks.set(key, chunk);
    }
    chunk.group.add(obj);
  }

  registerOccluder(box: OccluderVolume): void {
    this.occluders.push(box);
  }

  updateVisibility(camera: THREE.Camera, drawDistance: number): void {
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const camX = camera.position.x;
    const camZ = camera.position.z;
    const maxDistSq = (drawDistance + this.chunkSize) * (drawDistance + this.chunkSize);

    for (const chunk of this.chunks.values()) {
      const dx = chunk.centerX - camX;
      const dz = chunk.centerZ - camZ;
      const distSq = dx * dx + dz * dz;
      if (distSq > maxDistSq) {
        chunk.group.visible = false;
        continue;
      }
      chunk.group.visible = this.frustum.intersectsBox(chunk.bounds);
    }
  }

  isPointOccluded(camPos: THREE.Vector3, targetX: number, targetY: number, targetZ: number): boolean {
    const dx = targetX - camPos.x;
    const dy = targetY - camPos.y;
    const dz = targetZ - camPos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 18) return false;
    const invD = 1 / dist;
    const ndx = dx * invD;
    const ndy = dy * invD;
    const ndz = dz * invD;

    for (let i = 0; i < this.occluders.length; i++) {
      const b = this.occluders[i];
      let tmin = 0;
      let tmax = dist - 1.5;

      const idx = ndx !== 0 ? 1 / ndx : 1e9;
      let t1 = (b.minX - camPos.x) * idx;
      let t2 = (b.maxX - camPos.x) * idx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;

      const idy = ndy !== 0 ? 1 / ndy : 1e9;
      t1 = (b.minY - camPos.y) * idy;
      t2 = (b.maxY - camPos.y) * idy;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;

      const idz = ndz !== 0 ? 1 / ndz : 1e9;
      t1 = (b.minZ - camPos.z) * idz;
      t2 = (b.maxZ - camPos.z) * idz;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin <= tmax && tmin > 0.5) return true;
    }
    return false;
  }

  clear(scene: THREE.Scene): void {
    for (const chunk of this.chunks.values()) {
      scene.remove(chunk.group);
    }
    this.chunks.clear();
    this.occluders = [];
  }
}
