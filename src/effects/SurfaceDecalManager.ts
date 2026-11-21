import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

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

interface ActiveDecalRecord {
  mesh: THREE.Mesh;
  kind: DecalKind;
  position: THREE.Vector3;
  createdAtSec: number;
  lifetimeSec: number;
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

    // Radial blast streaks
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
    // Burnished steel crater + bright scratched rim
    const outer = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.4);
    outer.addColorStop(0, 'rgba(10, 12, 16, 0.95)');
    outer.addColorStop(0.35, 'rgba(30, 34, 40, 0.85)');
    outer.addColorStop(0.55, 'rgba(180, 192, 204, 0.55)');
    outer.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = outer;
    ctx.fillRect(0, 0, size, size);
  } else if (kind === 'bullet_wood') {
    // Splintered dark cavity with directional grain cracks
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
    // Radial spiderweb fracture
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
    // Concrete / asphalt impact crater with dust halo & fractures
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

/**
 * Bounded surface-aware Decal manager powered by official Three.js `DecalGeometry`.
 * - Shared Flyweight materials/textures per DecalKind (zero per-impact texture allocations).
 * - Ring-buffer budget enforcement driven by RenderingQualityDirector (default 128, max 256).
 * - Corner anti-distortion thickness guard + polygonOffset depth handling.
 * - Distance-based culling and deterministic mission-reset cleanup.
 */
export class SurfaceDecalManager {
  private readonly group = new THREE.Group();
  private readonly active: ActiveDecalRecord[] = [];
  private readonly prewarmMeshes: THREE.Mesh[] = [];
  private readonly materials = new Map<DecalKind, THREE.MeshStandardMaterial>();
  private readonly textures = new Map<DecalKind, THREE.CanvasTexture>();
  private prewarmed = false;
  private maxBudget: number;
  private cullDistanceSq: number;
  private elapsedSec = 0;

  private readonly tmpOrientation = new THREE.Euler();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpUp = new THREE.Vector3(0, 1, 0);
  private readonly tmpAltUp = new THREE.Vector3(1, 0, 0);
  private readonly tmpTarget = new THREE.Vector3();
  private readonly tmpNormal = new THREE.Vector3();
  private readonly tmpSize = new THREE.Vector3();
  private readonly sharedQuadGeo = new THREE.PlaneGeometry(1, 1);

  constructor(
    private readonly scene: THREE.Scene,
    maxBudget = 128,
    cullDistanceM = 85
  ) {
    this.group.name = 'VanguardSurfaceDecals';
    this.maxBudget = Math.max(0, Math.min(256, maxBudget));
    this.cullDistanceSq = cullDistanceM * cullDistanceM;
    this.scene.add(this.group);
  }

  public setBudget(maxBudget: number, cullDistanceM = 85): void {
    this.maxBudget = Math.max(0, Math.min(256, Math.round(maxBudget)));
    this.cullDistanceSq = cullDistanceM * cullDistanceM;
    while (this.active.length > this.maxBudget) {
      this.evictOldest();
    }
  }

  /**
   * Pre-creates all procedural decal textures & materials and attaches invisible
   * shared-quad probe meshes to `this.group` so `WebGLRenderer.compile(scene, camera)`
   * compiles every decal shader during the loading screen instead of mid-firefight.
   */
  public prewarm(): void {
    if (this.prewarmed) return;
    this.prewarmed = true;
    const kinds: DecalKind[] = [
      'bullet_concrete',
      'bullet_metal',
      'bullet_wood',
      'bullet_glass',
      'scorch_explosion',
    ];
    for (const kind of kinds) {
      const mat = this.getOrCreateMaterial(kind);
      const probe = new THREE.Mesh(this.sharedQuadGeo, mat);
      probe.visible = false;
      probe.frustumCulled = false;
      probe.receiveShadow = false;
      probe.castShadow = false;
      probe.userData.isDecal = true;
      probe.userData.usesSharedDecalGeo = true;
      this.group.add(probe);
      this.prewarmMeshes.push(probe);
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

    const baseSize = isExplosion ? 1.85 * radiusScale : 0.24 * radiusScale;
    // Clamp projection depth tightly to prevent wrap-around distortion across sharp building corners
    const projectionDepth = isExplosion ? Math.min(0.45, baseSize * 0.24) : 0.09;
    this.tmpSize.set(baseSize, baseSize, projectionDepth);

    const n = this.tmpNormal.copy(normal).normalize();
    const up = Math.abs(n.y) > 0.92 ? this.tmpAltUp : this.tmpUp;
    this.tmpTarget.copy(point).add(n);
    this.tmpMatrix.lookAt(this.tmpTarget, point, up);
    this.tmpOrientation.setFromRotationMatrix(this.tmpMatrix);
    this.tmpOrientation.z += (this.active.length * 1.6180339887) % (Math.PI * 2);

    const targetGeom = targetMesh.geometry;
    const triCount = targetGeom.index
      ? targetGeom.index.count / 3
      : targetGeom.attributes.position.count / 3;
    const useSharedQuad = triCount > 256;

    let mesh: THREE.Mesh;
    const material = this.getOrCreateMaterial(kind);
    if (useSharedQuad) {
      // Fast O(1) oriented quad for dense terrain/complex meshes (avoids clipping 10k+ triangles per bullet)
      mesh = new THREE.Mesh(this.sharedQuadGeo, material);
      mesh.position.copy(point).addScaledVector(n, isExplosion ? 0.025 : 0.014);
      mesh.rotation.copy(this.tmpOrientation);
      mesh.scale.set(baseSize, baseSize, 1);
      mesh.userData.usesSharedDecalGeo = true;
    } else {
      let geom: THREE.BufferGeometry;
      try {
        geom = new DecalGeometry(targetMesh, point, this.tmpOrientation, this.tmpSize);
        const posAttr = geom.getAttribute('position');
        if (!posAttr || posAttr.count === 0) {
          geom.dispose();
          return false;
        }
      } catch {
        return false;
      }
      mesh = new THREE.Mesh(geom, material);
    }

    mesh.renderOrder = 2;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    mesh.userData.isDecal = true;

    while (this.active.length >= this.maxBudget) {
      this.evictOldest();
    }

    this.group.add(mesh);
    this.active.push({
      mesh,
      kind,
      position: point.clone(),
      createdAtSec: this.elapsedSec,
      lifetimeSec: DEFAULT_LIFETIME_BY_KIND[kind],
    });
    return true;
  }

  public update(dtSec: number, cameraPosition?: THREE.Vector3): void {
    this.elapsedSec += Math.max(0, dtSec);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const rec = this.active[i];
      if (this.elapsedSec - rec.createdAtSec >= rec.lifetimeSec) {
        this.removeAt(i);
        continue;
      }
      if (cameraPosition) {
        rec.mesh.visible = rec.position.distanceToSquared(cameraPosition) <= this.cullDistanceSq;
      }
    }
  }

  public getStats(): { activeCount: number; maxBudget: number; materialCount: number } {
    return {
      activeCount: this.active.length,
      maxBudget: this.maxBudget,
      materialCount: this.materials.size,
    };
  }

  public clearMissionDecals(): void {
    while (this.active.length > 0) {
      this.evictOldest();
    }
    this.elapsedSec = 0;
  }

  public dispose(): void {
    this.clearMissionDecals();
    for (const probe of this.prewarmMeshes) {
      this.group.remove(probe);
    }
    this.prewarmMeshes.length = 0;
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
    if (tex) this.textures.set(kind, tex);

    const mat = new THREE.MeshStandardMaterial({
      map: tex ?? null,
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
    return mat;
  }

  private evictOldest(): void {
    if (this.active.length === 0) return;
    this.removeAt(0);
  }

  private removeAt(index: number): void {
    const [rec] = this.active.splice(index, 1);
    if (!rec) return;
    this.group.remove(rec.mesh);
    if (!rec.mesh.userData?.usesSharedDecalGeo) {
      rec.mesh.geometry.dispose();
    }
  }
}
