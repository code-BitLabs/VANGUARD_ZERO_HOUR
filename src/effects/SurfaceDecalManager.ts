import * as THREE from 'three';
import { ResourceManager } from '@/src/core/ResourceManager';

export type ImpactSurfaceMaterial =
  | 'concrete'
  | 'metal'
  | 'wood'
  | 'asphalt'
  | 'sand'
  | 'mud'
  | 'glass'
  | 'industrial';

export type DecalKind =
  | 'bullet_concrete'
  | 'bullet_metal'
  | 'bullet_wood'
  | 'bullet_glass'
  | 'scorch_explosion'
  | 'wear_skid';

const PREWARM_DECAL_KINDS: readonly DecalKind[] = [
  'bullet_concrete',
  'bullet_metal',
  'bullet_wood',
  'bullet_glass',
  'scorch_explosion',
];

interface DecalSlotRecord {
  globalSlot: number;
  kind: DecalKind;
  kindInstanceIdx: number;
  px: number;
  py: number;
  pz: number;
  matrixElements: Float32Array;
  createdAtSec: number;
  lifetimeSec: number;
  culled: boolean;
}

interface DecalKindPool {
  kind: DecalKind;
  mesh: THREE.InstancedMesh;
  activeSlotIndices: number[];
  activeCount: number;
  dirty: boolean;
}

const DEFAULT_LIFETIME_BY_KIND: Record<DecalKind, number> = {
  bullet_concrete: 45,
  bullet_metal: 45,
  bullet_wood: 40,
  bullet_glass: 35,
  scorch_explosion: 90,
  wear_skid: 60,
};

function createProceduralDecalTexture(kind: DecalKind): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = kind === 'scorch_explosion' ? 256 : 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const cx = size / 2;
  const cy = size / 2;
  ctx.clearRect(0, 0, size, size);

  if (kind === 'scorch_explosion') {
    const grad = ctx.createRadialGradient(cx, cy, size * 0.05, cx, cy, size * 0.48);
    grad.addColorStop(0, 'rgba(8, 8, 10, 0.94)');
    grad.addColorStop(0.45, 'rgba(20, 17, 14, 0.78)');
    grad.addColorStop(0.78, 'rgba(42, 34, 28, 0.34)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(12, 10, 8, 0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + (i % 3) * 0.08;
      const r0 = size * 0.14;
      const r1 = size * (0.34 + ((i * 19) % 10) * 0.014);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
  } else if (kind === 'bullet_metal') {
    const outer = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.4);
    outer.addColorStop(0, 'rgba(10, 12, 16, 0.95)');
    outer.addColorStop(0.35, 'rgba(30, 34, 40, 0.85)');
    outer.addColorStop(0.55, 'rgba(180, 192, 204, 0.55)');
    outer.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = outer;
    ctx.fillRect(0, 0, size, size);
  } else if (kind === 'bullet_wood') {
    const crater = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.32);
    crater.addColorStop(0, 'rgba(24, 15, 8, 0.96)');
    crater.addColorStop(0.5, 'rgba(68, 46, 26, 0.72)');
    crater.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = crater;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(42, 26, 12, 0.78)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const dy = (i - 2.5) * 6;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.34, cy + dy);
      ctx.lineTo(cx + size * 0.34, cy + dy * 0.7);
      ctx.stroke();
    }
  } else if (kind === 'bullet_glass') {
    ctx.strokeStyle = 'rgba(220, 238, 250, 0.85)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * size * 0.42, cy + Math.sin(a) * size * 0.42);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const halo = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.44);
    halo.addColorStop(0, 'rgba(14, 14, 16, 0.96)');
    halo.addColorStop(0.28, 'rgba(54, 52, 48, 0.82)');
    halo.addColorStop(0.62, 'rgba(130, 125, 118, 0.42)');
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(22, 20, 18, 0.65)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * size * 0.34, cy + Math.sin(a) * size * 0.34);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function classifyImpactMaterialFromObject(obj: THREE.Object3D | null): ImpactSurfaceMaterial {
  if (!obj) return 'concrete';
  const explicit = obj.userData?.surfaceMaterial as ImpactSurfaceMaterial | undefined;
  if (explicit) return explicit;
  const name = (obj.name || '').toLowerCase();
  if (/metal|steel|tank|apc|truck|heli|catwalk|pipe|radar|crate|barrel|beam/.test(name)) {
    return 'metal';
  }
  if (/wood|plank|pallet|bridge|tree|trunk/.test(name)) return 'wood';
  if (/glass|window|visor/.test(name)) return 'glass';
  if (/road|asphalt|street|highway/.test(name)) return 'asphalt';
  if (/sand|desert|dune/.test(name)) return 'sand';
  if (/mud|jungle|river|marsh/.test(name)) return 'mud';
  if (/foundry|factory|machinery/.test(name)) return 'industrial';
  return 'concrete';
}

export function decalKindForSurface(
  surface: ImpactSurfaceMaterial,
  isExplosion: boolean
): DecalKind {
  if (isExplosion) return 'scorch_explosion';
  switch (surface) {
    case 'metal':
    case 'industrial':
      return 'bullet_metal';
    case 'wood':
      return 'bullet_wood';
    case 'glass':
      return 'bullet_glass';
    default:
      return 'bullet_concrete';
  }
}

const MAX_DECAL_CAPACITY = 256;

/**
 * GPU-Instanced Ring-Buffered Planar Surface Decal Manager.
 * - Replaces up to 256 individual decal meshes & per-shot DecalGeometry clipping with
 *   5 pre-allocated `InstancedMesh` pools (<= 5 draw calls total, 0 idle draw calls).
 * - Zero per-shot `BufferGeometry` or `Mesh` allocations; polygonOffset eliminates z-fighting.
 * - Enforces global FIFO ring-buffer budget and deterministic mission-reset cleanup.
 */
export class SurfaceDecalManager {
  private readonly group = new THREE.Group();
  private readonly slots: Array<DecalSlotRecord | null> = new Array(MAX_DECAL_CAPACITY).fill(null);
  private readonly nextSlot = new Int16Array(MAX_DECAL_CAPACITY).fill(-1);
  private readonly prevSlot = new Int16Array(MAX_DECAL_CAPACITY).fill(-1);
  private readonly freeSlots: number[] = [];
  private readonly freeRecords: DecalSlotRecord[] = [];
  private headSlot = -1;
  private tailSlot = -1;
  private activeCount = 0;

  private readonly pools = new Map<DecalKind, DecalKindPool>();
  private readonly materials = new Map<DecalKind, THREE.MeshStandardMaterial>();
  private readonly textures = new Map<DecalKind, THREE.CanvasTexture>();
  private prewarmed = false;
  private maxBudget: number;
  private cullDistanceSq: number;
  private elapsedSec = 0;
  private spawnCounter = 0;

  private readonly tmpUp = new THREE.Vector3(0, 1, 0);
  private readonly tmpAltUp = new THREE.Vector3(1, 0, 0);
  private readonly tmpTarget = new THREE.Vector3();
  private readonly tmpNormal = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly sharedQuadGeo = new THREE.PlaneGeometry(1, 1);

  constructor(
    private readonly scene: THREE.Scene,
    maxBudget = 128,
    cullDistanceM = 85,
    private readonly resourceManager?: ResourceManager
  ) {
    this.group.name = 'VanguardSurfaceDecals';
    this.maxBudget = Math.max(0, Math.min(MAX_DECAL_CAPACITY, maxBudget));
    this.cullDistanceSq = cullDistanceM * cullDistanceM;
    this.resourceManager?.registerGeometry(this.sharedQuadGeo, 'shared');
    for (let i = MAX_DECAL_CAPACITY - 1; i >= 0; i--) {
      this.freeSlots.push(i);
    }
    this.scene.add(this.group);
  }

  public setBudget(maxBudget: number, cullDistanceM = 85): void {
    this.maxBudget = Math.max(0, Math.min(MAX_DECAL_CAPACITY, Math.round(maxBudget)));
    this.cullDistanceSq = cullDistanceM * cullDistanceM;
    while (this.activeCount > this.maxBudget) {
      this.evictOldest();
    }
    this.flushDirtyPools();
  }

  /**
   * Pre-creates all 5 instanced decal pools & procedural materials so WebGL shader compilation
   * happens during mission load rather than on the first combat shot.
   */
  public prewarm(): void {
    if (this.prewarmed) return;
    this.prewarmed = true;
    for (let i = 0; i < PREWARM_DECAL_KINDS.length; i++) {
      this.getOrCreatePool(PREWARM_DECAL_KINDS[i]);
    }
  }

  public spawnImpactDecal(params: {
    targetMesh: THREE.Mesh;
    point: THREE.Vector3;
    normal: THREE.Vector3;
    surface?: ImpactSurfaceMaterial;
    isExplosion?: boolean;
    radiusScale?: number;
  }): boolean {
    if (this.maxBudget <= 0) return false;
    const { targetMesh, point, normal, isExplosion = false, radiusScale = 1.0 } = params;
    if (!targetMesh.geometry || !targetMesh.geometry.attributes.position) return false;

    const surface = params.surface ?? classifyImpactMaterialFromObject(targetMesh);
    const kind = decalKindForSurface(surface, isExplosion);
    const pool = this.getOrCreatePool(kind);

    while (this.activeCount >= this.maxBudget) {
      this.evictOldest();
    }

    const slotIdx = this.freeSlots.pop();
    if (slotIdx === undefined) {
      return false;
    }

    const baseSize = isExplosion ? 1.85 * radiusScale : 0.24 * radiusScale;
    const n = this.tmpNormal.copy(normal).normalize();
    const up = Math.abs(n.y) > 0.92 ? this.tmpAltUp : this.tmpUp;
    this.tmpTarget.copy(point).add(n);
    this.tmpMatrix.lookAt(this.tmpTarget, point, up);
    this.tmpEuler.setFromRotationMatrix(this.tmpMatrix);
    this.tmpEuler.z += (++this.spawnCounter * 1.6180339887) % (Math.PI * 2);
    this.tmpQuat.setFromEuler(this.tmpEuler);
    this.tmpPos.copy(point).addScaledVector(n, isExplosion ? 0.025 : 0.014);
    this.tmpScale.set(baseSize, baseSize, 1);
    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);

    const kindIdx = pool.activeCount;
    if (kindIdx >= MAX_DECAL_CAPACITY) {
      this.freeSlots.push(slotIdx);
      return false;
    }

    let rec = this.freeRecords.pop();
    if (!rec) {
      rec = {
        globalSlot: slotIdx,
        kind,
        kindInstanceIdx: kindIdx,
        px: point.x,
        py: point.y,
        pz: point.z,
        matrixElements: new Float32Array(16),
        createdAtSec: this.elapsedSec,
        lifetimeSec: DEFAULT_LIFETIME_BY_KIND[kind],
        culled: false,
      };
    } else {
      rec.globalSlot = slotIdx;
      rec.kind = kind;
      rec.kindInstanceIdx = kindIdx;
      rec.px = point.x;
      rec.py = point.y;
      rec.pz = point.z;
      rec.createdAtSec = this.elapsedSec;
      rec.lifetimeSec = DEFAULT_LIFETIME_BY_KIND[kind];
      rec.culled = false;
    }
    rec.matrixElements.set(this.tmpMatrix.elements);

    pool.activeSlotIndices[kindIdx] = slotIdx;
    pool.activeCount = kindIdx + 1;
    pool.mesh.setMatrixAt(kindIdx, this.tmpMatrix);
    pool.mesh.count = pool.activeCount;
    pool.mesh.visible = true;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.dirty = false;

    this.slots[slotIdx] = rec;
    this.prevSlot[slotIdx] = this.tailSlot;
    this.nextSlot[slotIdx] = -1;
    if (this.tailSlot !== -1) {
      this.nextSlot[this.tailSlot] = slotIdx;
    } else {
      this.headSlot = slotIdx;
    }
    this.tailSlot = slotIdx;
    this.activeCount++;
    return true;
  }

  public update(dtSec: number, cameraPosition?: THREE.Vector3): void {
    this.elapsedSec += Math.max(0, dtSec);
    let idx = this.headSlot;
    const cx = cameraPosition?.x ?? 0;
    const cy = cameraPosition?.y ?? 0;
    const cz = cameraPosition?.z ?? 0;

    while (idx !== -1) {
      const next = this.nextSlot[idx];
      const rec = this.slots[idx];
      if (rec) {
        if (this.elapsedSec - rec.createdAtSec >= rec.lifetimeSec) {
          this.removeSlot(idx);
        } else if (cameraPosition) {
          const dx = rec.px - cx;
          const dy = rec.py - cy;
          const dz = rec.pz - cz;
          const shouldCull = dx * dx + dy * dy + dz * dz > this.cullDistanceSq;
          if (shouldCull !== rec.culled) {
            rec.culled = shouldCull;
            const pool = this.pools.get(rec.kind);
            if (pool) {
              if (shouldCull) {
                pool.mesh.setMatrixAt(rec.kindInstanceIdx, this.hiddenMatrix);
              } else {
                this.tmpMatrix.fromArray(rec.matrixElements);
                pool.mesh.setMatrixAt(rec.kindInstanceIdx, this.tmpMatrix);
              }
              pool.dirty = true;
            }
          }
        }
      }
      idx = next;
    }
    this.flushDirtyPools();
  }

  public getStats(): {
    activeCount: number;
    maxBudget: number;
    materialCount: number;
    activeDrawCalls: number;
  } {
    let activeDrawCalls = 0;
    for (const pool of this.pools.values()) {
      if (pool.mesh.visible && pool.mesh.count > 0) {
        activeDrawCalls++;
      }
    }
    return {
      activeCount: this.activeCount,
      maxBudget: this.maxBudget,
      materialCount: this.materials.size,
      activeDrawCalls,
    };
  }

  public clearMissionDecals(): void {
    while (this.headSlot !== -1) {
      this.removeSlot(this.headSlot);
    }
    for (const pool of this.pools.values()) {
      pool.activeCount = 0;
      pool.mesh.count = 0;
      pool.mesh.visible = false;
      pool.dirty = false;
    }
    this.elapsedSec = 0;
  }

  public dispose(): void {
    this.clearMissionDecals();
    for (const pool of this.pools.values()) {
      this.group.remove(pool.mesh);
      pool.mesh.dispose();
    }
    this.pools.clear();
    this.prewarmed = false;
    this.sharedQuadGeo.dispose();
    for (const mat of this.materials.values()) mat.dispose();
    for (const tex of this.textures.values()) tex.dispose();
    this.materials.clear();
    this.textures.clear();
    this.scene.remove(this.group);
  }

  private getOrCreateMaterial(kind: DecalKind): THREE.MeshStandardMaterial {
    const existing = this.materials.get(kind);
    if (existing) return existing;

    const tex = createProceduralDecalTexture(kind);
    if (tex) {
      this.textures.set(kind, tex);
      this.resourceManager?.registerTexture(tex, 'shared');
    }

    const mat = new THREE.MeshStandardMaterial({
      ...(tex ? { map: tex } : {}),
      color: kind === 'bullet_metal' ? 0xd4dde6 : kind === 'bullet_glass' ? 0xe0f2fe : 0xffffff,
      roughness: kind === 'bullet_metal' ? 0.38 : kind === 'scorch_explosion' ? 0.94 : 0.86,
      metalness: kind === 'bullet_metal' ? 0.72 : 0.04,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.materials.set(kind, mat);
    this.resourceManager?.registerMaterial(mat, 'shared');
    return mat;
  }

  private getOrCreatePool(kind: DecalKind): DecalKindPool {
    const existing = this.pools.get(kind);
    if (existing) return existing;

    const mat = this.getOrCreateMaterial(kind);
    const mesh = new THREE.InstancedMesh(this.sharedQuadGeo, mat, MAX_DECAL_CAPACITY);
    mesh.name = `decal_pool_${kind}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.userData.isDecal = true;
    mesh.userData.noMerge = true;
    this.group.add(mesh);

    const pool: DecalKindPool = {
      kind,
      mesh,
      activeSlotIndices: new Array<number>(MAX_DECAL_CAPACITY),
      activeCount: 0,
      dirty: false,
    };
    this.pools.set(kind, pool);
    return pool;
  }

  private flushDirtyPools(): void {
    for (const pool of this.pools.values()) {
      if (!pool.dirty) continue;
      pool.mesh.count = pool.activeCount;
      pool.mesh.visible = pool.activeCount > 0;
      if (pool.activeCount > 0) {
        pool.mesh.instanceMatrix.needsUpdate = true;
      }
      pool.dirty = false;
    }
  }

  private evictOldest(): void {
    if (this.headSlot === -1) return;
    this.removeSlot(this.headSlot);
  }

  private removeSlot(slotIdx: number): void {
    const rec = this.slots[slotIdx];
    if (!rec) return;
    this.slots[slotIdx] = null;

    const p = this.prevSlot[slotIdx];
    const n = this.nextSlot[slotIdx];
    if (p !== -1) this.nextSlot[p] = n;
    else this.headSlot = n;
    if (n !== -1) this.prevSlot[n] = p;
    else this.tailSlot = p;
    this.prevSlot[slotIdx] = -1;
    this.nextSlot[slotIdx] = -1;
    this.activeCount--;
    this.freeSlots.push(slotIdx);

    const pool = this.pools.get(rec.kind);
    if (pool && pool.activeCount > 0) {
      const removeIdx = rec.kindInstanceIdx;
      const lastIdx = pool.activeCount - 1;
      if (removeIdx < lastIdx) {
        const movedSlotIdx = pool.activeSlotIndices[lastIdx];
        const movedRec = this.slots[movedSlotIdx];
        pool.activeSlotIndices[removeIdx] = movedSlotIdx;
        if (movedRec) {
          movedRec.kindInstanceIdx = removeIdx;
          if (movedRec.culled) {
            pool.mesh.setMatrixAt(removeIdx, this.hiddenMatrix);
          } else {
            this.tmpMatrix.fromArray(movedRec.matrixElements);
            pool.mesh.setMatrixAt(removeIdx, this.tmpMatrix);
          }
        }
      }
      pool.activeCount = lastIdx;
      pool.dirty = true;
    }

    this.freeRecords.push(rec);
  }
}
