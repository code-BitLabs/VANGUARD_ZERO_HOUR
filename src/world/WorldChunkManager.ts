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

export class WorldChunkManager {
  public readonly chunkSize = 48;
  private chunks = new Map<string, WorldChunk>();
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

  getChunkAt(worldX: number, worldZ: number): WorldChunk | undefined {
    const cx = Math.floor(worldX / this.chunkSize);
    const cz = Math.floor(worldZ / this.chunkSize);
    return this.chunks.get(`${cx}_${cz}`);
  }

  getChunksAround(
    worldX: number,
    worldZ: number,
    radius: number,
    out: THREE.Object3D[] = []
  ): THREE.Object3D[] {
    const minCx = Math.floor((worldX - radius) / this.chunkSize);
    const maxCx = Math.floor((worldX + radius) / this.chunkSize);
    const minCz = Math.floor((worldZ - radius) / this.chunkSize);
    const maxCz = Math.floor((worldZ + radius) / this.chunkSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const chunk = this.chunks.get(`${cx}_${cz}`);
        if (chunk && chunk.group.visible) {
          out.push(chunk.group);
        }
      }
    }
    return out;
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

  clear(scene: THREE.Scene): void {
    for (const chunk of this.chunks.values()) {
      scene.remove(chunk.group);
    }
    this.chunks.clear();
  }
}
