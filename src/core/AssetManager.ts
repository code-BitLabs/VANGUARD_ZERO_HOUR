import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SubQualityLevel } from '@/src/schemas/settings.schema';
import { ResourceManager, ResourceScope } from './ResourceManager';

export type TexturePattern =
  | 'concrete'
  | 'asphalt'
  | 'sand'
  | 'jungle_ground'
  | 'metal_plate'
  | 'warning_stripe'
  | 'camouflage'
  | 'crate_wood';

interface CachedTexture {
  texture: THREE.CanvasTexture;
  resourceId: string;
  pattern: TexturePattern;
}

export class AssetManager {
  private textures = new Map<string, CachedTexture>();
  private sharedMaterials = new Map<string, { material: THREE.MeshStandardMaterial; resourceId: string }>();
  private gltfLoader: GLTFLoader | null = null;
  private dracoLoader: DRACOLoader | null = null;
  private ktx2Loader: KTX2Loader | null = null;
  private maxAnisotropy = 4;
  private textureQuality: SubQualityLevel = 'high';
  private fallbackLoads = 0;

  constructor(private readonly resourceManager: ResourceManager) {}

  configureRenderer(renderer: THREE.WebGLRenderer): void {
    this.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (!this.gltfLoader) {
      const loader = new GLTFLoader();
      this.dracoLoader = new DRACOLoader();
      loader.setDRACOLoader(this.dracoLoader);
      this.ktx2Loader = new KTX2Loader().detectSupport(renderer);
      loader.setKTX2Loader(this.ktx2Loader);
      loader.setMeshoptDecoder(MeshoptDecoder);
      this.gltfLoader = loader;
    }
  }

  private getTargetTexSize(): number {
    if (this.textureQuality === 'low') return 128;
    if (this.textureQuality === 'medium') return 192;
    return 256;
  }

  private getTargetAnisotropy(): number {
    if (this.textureQuality === 'low') return 1;
    if (this.textureQuality === 'medium') return Math.min(2, this.maxAnisotropy);
    return this.maxAnisotropy;
  }

  setTextureQuality(level: SubQualityLevel): void {
    if (this.textureQuality === level) return;
    this.textureQuality = level;
    const size = this.getTargetTexSize();
    const aniso = this.getTargetAnisotropy();
    for (const entry of this.textures.values()) {
      const canvas = entry.texture.image as HTMLCanvasElement | undefined;
      if (canvas) {
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          this.paintPatternScaled(ctx, entry.pattern, size);
        }
      }
      entry.texture.anisotropy = aniso;
      entry.texture.needsUpdate = true;
    }
  }

  getProceduralTexture(pattern: TexturePattern, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
    const key = `${pattern}_${repeatX}_${repeatY}`;
    const cached = this.textures.get(key);
    if (cached) {
      this.resourceManager.retain(cached.resourceId);
      return cached.texture;
    }

    const size = this.getTargetTexSize();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      this.paintPatternScaled(ctx, pattern, size);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = this.getTargetAnisotropy();
    tex.needsUpdate = true;

    const resourceId = this.resourceManager.registerTexture(tex, 'shared', `tex_${key}`);
    this.textures.set(key, { texture: tex, resourceId, pattern });
    return tex;
  }

  getSharedMaterial(
    key: string,
    opts: THREE.MeshStandardMaterialParameters & { pattern?: TexturePattern; repeat?: [number, number] },
    scope: ResourceScope = 'shared'
  ): THREE.MeshStandardMaterial {
    if (scope === 'shared') {
      const existing = this.sharedMaterials.get(key);
      if (existing) {
        this.resourceManager.retain(existing.resourceId);
        return existing.material;
      }
    }

    const map = opts.pattern
      ? this.getProceduralTexture(opts.pattern, opts.repeat?.[0] ?? 1, opts.repeat?.[1] ?? 1)
      : undefined;

    const defaultBumpScale =
      opts.pattern === 'concrete' || opts.pattern === 'asphalt' || opts.pattern === 'sand' || opts.pattern === 'jungle_ground'
        ? 0.024
        : opts.pattern === 'metal_plate' || opts.pattern === 'crate_wood'
          ? 0.015
          : 0.01;

    const bumpMap = opts.bumpMap ?? map;
    const matParams: THREE.MeshStandardMaterialParameters = {
      color: opts.color ?? 0x808080,
      roughness: opts.roughness ?? 0.75,
      metalness: opts.metalness ?? 0.15,
    };
    if (map) matParams.map = map;
    if (bumpMap) {
      matParams.bumpMap = bumpMap;
      matParams.bumpScale = opts.bumpScale ?? defaultBumpScale;
    }
    if (opts.emissive !== undefined) matParams.emissive = opts.emissive;
    if (opts.emissiveIntensity !== undefined) matParams.emissiveIntensity = opts.emissiveIntensity;
    if (opts.transparent !== undefined) matParams.transparent = opts.transparent;
    if (opts.opacity !== undefined) matParams.opacity = opts.opacity;

    const mat = new THREE.MeshStandardMaterial(matParams);

    const resourceId = this.resourceManager.registerMaterial(mat, scope, scope === 'shared' ? `mat_${key}` : undefined);
    if (scope === 'shared') {
      this.sharedMaterials.set(key, { material: mat, resourceId });
    }
    return mat;
  }

  async loadModelWithFallback(
    url: string | undefined,
    fallbackBuilder: () => THREE.Group,
    signal?: AbortSignal
  ): Promise<{ group: THREE.Group; usedFallback: boolean }> {
    if (signal?.aborted) {
      throw new DOMException('Asset load aborted', 'AbortError');
    }
    if (!url || !this.gltfLoader) {
      this.fallbackLoads++;
      return { group: fallbackBuilder(), usedFallback: true };
    }

    try {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        this.fallbackLoads++;
        return { group: fallbackBuilder(), usedFallback: true };
      }
      const buffer = await response.arrayBuffer();
      if (signal?.aborted) {
        throw new DOMException('Asset load aborted', 'AbortError');
      }
      const gltf = await this.gltfLoader.parseAsync(buffer, '');
      const group = new THREE.Group();
      group.add(gltf.scene);
      return { group, usedFallback: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      this.fallbackLoads++;
      return { group: fallbackBuilder(), usedFallback: true };
    }
  }

  markTexturesNeedUpdate(): void {
    for (const entry of this.textures.values()) {
      entry.texture.needsUpdate = true;
    }
  }

  getFallbackCount(): number {
    return this.fallbackLoads;
  }

  dispose(): void {
    this.dracoLoader?.dispose();
    this.ktx2Loader?.dispose();
    this.dracoLoader = null;
    this.ktx2Loader = null;
    this.gltfLoader = null;
    this.textures.clear();
    this.sharedMaterials.clear();
  }

  private paintPatternScaled(ctx: CanvasRenderingContext2D, pattern: TexturePattern, size: number): void {
    ctx.save();
    ctx.scale(size / 256, size / 256);
    this.paintPattern(ctx, pattern);
    ctx.restore();
  }

  private paintPattern(ctx: CanvasRenderingContext2D, pattern: TexturePattern): void {
    const w = 256;
    const h = 256;
    const rand = (seed: number) => {
      const x = Math.sin(seed * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    if (pattern === 'concrete') {
      ctx.fillStyle = '#5a5e63';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1600; i++) {
        const v = Math.floor(72 + rand(i) * 40);
        ctx.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
        ctx.fillRect(rand(i + 1) * w, rand(i + 2) * h, 3, 3);
      }
      ctx.strokeStyle = 'rgba(20,22,25,0.28)';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    } else if (pattern === 'asphalt') {
      ctx.fillStyle = '#25292e';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2000; i++) {
        const v = Math.floor(28 + rand(i) * 26);
        ctx.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
        ctx.fillRect(rand(i + 3) * w, rand(i + 7) * h, 2, 2);
      }
      ctx.fillStyle = 'rgba(245,158,11,0.55)';
      ctx.fillRect(122, 16, 12, 88);
      ctx.fillRect(122, 148, 12, 88);
    } else if (pattern === 'sand') {
      ctx.fillStyle = '#b99668';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1500; i++) {
        const shade = Math.floor(155 + rand(i) * 45);
        ctx.fillStyle = `rgb(${shade},${Math.floor(shade * 0.82)},${Math.floor(shade * 0.56)})`;
        ctx.fillRect(rand(i + 2) * w, rand(i + 5) * h, 4, 2);
      }
    } else if (pattern === 'jungle_ground') {
      ctx.fillStyle = '#2f3d24';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1600; i++) {
        const g = Math.floor(45 + rand(i) * 45);
        ctx.fillStyle = `rgb(${Math.floor(g * 0.65)},${g},${Math.floor(g * 0.45)})`;
        ctx.fillRect(rand(i + 1) * w, rand(i + 4) * h, 4, 4);
      }
    } else if (pattern === 'metal_plate') {
      ctx.fillStyle = '#384049';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#20262c';
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, 120, 120);
      ctx.strokeRect(132, 4, 120, 120);
      ctx.strokeRect(4, 132, 120, 120);
      ctx.strokeRect(132, 132, 120, 120);
      ctx.fillStyle = '#56616d';
      for (const rx of [14, 114, 142, 242]) {
        for (const ry of [14, 114, 142, 242]) {
          ctx.fillRect(rx - 2, ry - 2, 4, 4);
        }
      }
    } else if (pattern === 'warning_stripe') {
      ctx.fillStyle = '#1f2328';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d97706';
      for (let x = -256; x < 512; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 18, 0);
        ctx.lineTo(x + 18 - h, h);
        ctx.lineTo(x - h, h);
        ctx.closePath();
        ctx.fill();
      }
    } else if (pattern === 'camouflage') {
      ctx.fillStyle = '#474f3d';
      ctx.fillRect(0, 0, w, h);
      const colors = ['#32392b', '#5f6750', '#23271e', '#6f654c'];
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(rand(i) * w, rand(i + 9) * h, 26 + rand(i + 3) * 32, 16 + rand(i + 6) * 24);
      }
    } else {
      ctx.fillStyle = '#6b4f35';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#3f2d1c';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);
      for (let y = 32; y < h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
  }
}
