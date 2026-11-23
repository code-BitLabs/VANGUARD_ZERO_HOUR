import * as THREE from 'three';
import { QualityTier } from '@/src/schemas/common.schema';
import { ResourceManager, ResourceScope } from './ResourceManager';
import {
  ALL_PROCEDURAL_PATTERNS,
  ProceduralPattern,
  SynthesizedPbrPixels,
  synthesizePbrPixels,
} from './pbrSynthesisCore';

export type { ProceduralPattern };
export { ALL_PROCEDURAL_PATTERNS };

export interface PbrTextureBundle {
  readonly pattern: ProceduralPattern;
  readonly resolution: number;
  readonly albedoMap: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
  /** Linear RM-packed texture (G = roughness, B = metalness). Shared with metalnessMap. */
  readonly roughnessMap: THREE.DataTexture;
  /** Linear RM-packed texture (G = roughness, B = metalness). Shared with roughnessMap. */
  readonly metalnessMap: THREE.DataTexture;
  readonly estimatedBytes: number;
}

export interface MaterialOptions {
  color?: number;
  roughness?: number;
  metalness?: number;
  pattern?: ProceduralPattern;
  repeat?: [number, number];
  normalScale?: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  externalAlbedoUrl?: string;
}

interface BaseGpuTextureTriple {
  readonly pattern: ProceduralPattern;
  readonly size: number;
  readonly albedoBase: THREE.DataTexture;
  readonly normalBase: THREE.DataTexture;
  readonly rmBase: THREE.DataTexture;
  readonly estimatedBytes: number;
}

interface WorkerResponse {
  requestId: number;
  pattern: ProceduralPattern;
  size: number;
  albedoData: Uint8Array;
  normalData: Uint8Array;
  rmData: Uint8Array;
  estimatedBytes: number;
}

/**
 * TRN-07 + Phase 3 RM-Packed PBR AssetManager:
 * - Packs roughness (G) and metalness (B) into a single linear DataTexture (-25% PBR VRAM).
 * - Deduplicates GPU texture sources by (pattern, size) via shared THREE.Source across all
 *   repeat variations (eliminating duplicate GPU uploads and redundant CPU pixel caches).
 * - Supports off-thread Web Worker prewarming with zero-copy ArrayBuffer transfers.
 */
export class AssetManager {
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly baseTextureSources = new Map<string, BaseGpuTextureTriple>();
  private readonly pbrBundles = new Map<string, PbrTextureBundle>();
  private readonly missionBundles = new Map<string, PbrTextureBundle>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly missionMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private synthWorker: Worker | null = null;
  private workerRequestSeq = 0;
  private readonly pendingWorkerJobs = new Map<
    number,
    { resolve: (pixels: SynthesizedPbrPixels) => void; reject: (err: Error) => void }
  >();
  private fallbackCount = 0;
  private textureQuality: QualityTier = 'high';
  private maxAnisotropy = 4;
  private onMaterialCreated?: (mat: THREE.MeshStandardMaterial) => void;

  /**
   * Maximum resident PBR profile cache entries to bound GPU memory (~33.5 MiB max at 512x512 with RM packing).
   */
  public static readonly MAX_RESIDENT_PBR_BUNDLES = 16;

  constructor(private readonly resourceManager: ResourceManager) {}

  setOnMaterialCreated(cb?: (mat: THREE.MeshStandardMaterial) => void): void {
    this.onMaterialCreated = cb;
  }

  configureRenderer(renderer: THREE.WebGLRenderer): void {
    this.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);
  }

  getTargetTexSize(tier: QualityTier = this.textureQuality): number {
    if (tier === 'low') return 128;
    if (tier === 'medium') return 256;
    return 512;
  }

  private getEffectiveAnisotropy(): number {
    return this.textureQuality === 'low'
      ? 1
      : this.textureQuality === 'medium'
        ? Math.min(2, this.maxAnisotropy)
        : this.textureQuality === 'high'
          ? Math.min(4, this.maxAnisotropy)
          : this.maxAnisotropy;
  }

  setTextureQuality(quality: QualityTier): void {
    if (this.textureQuality === quality) return;
    this.textureQuality = quality;
    const aniso = this.getEffectiveAnisotropy();

    for (const base of this.baseTextureSources.values()) {
      base.albedoBase.anisotropy = aniso;
      base.normalBase.anisotropy = aniso;
      base.rmBase.anisotropy = aniso;
      base.albedoBase.needsUpdate = true;
      base.normalBase.needsUpdate = true;
      base.rmBase.needsUpdate = true;
    }
    for (const bundle of this.pbrBundles.values()) {
      bundle.albedoMap.anisotropy = aniso;
      bundle.normalMap.anisotropy = aniso;
      bundle.roughnessMap.anisotropy = aniso;
      bundle.albedoMap.needsUpdate = true;
      bundle.normalMap.needsUpdate = true;
      bundle.roughnessMap.needsUpdate = true;
    }
  }

  markTexturesNeedUpdate(): void {
    for (const base of this.baseTextureSources.values()) {
      base.albedoBase.needsUpdate = true;
      base.normalBase.needsUpdate = true;
      base.rmBase.needsUpdate = true;
    }
    for (const bundle of this.pbrBundles.values()) {
      bundle.albedoMap.needsUpdate = true;
      bundle.normalMap.needsUpdate = true;
      bundle.roughnessMap.needsUpdate = true;
    }
    for (const mat of this.materials.values()) {
      mat.needsUpdate = true;
    }
  }

  getFallbackCount(): number {
    return this.fallbackCount;
  }

  getResidentProfileCount(): number {
    return this.pbrBundles.size;
  }

  getSynthesizedPixelProfileCount(): number {
    return this.baseTextureSources.size;
  }

  getEstimatedGpuMemoryBytes(): number {
    let total = 0;
    for (const base of this.baseTextureSources.values()) {
      total += base.estimatedBytes;
    }
    return total;
  }

  /**
   * Pre-synthesizes procedural PBR patterns off the main thread via Web Worker when available,
   * populating the shared GPU texture sources before synchronous map assembly runs.
   */
  async prewarmPatternsOffThread(
    patterns: readonly ProceduralPattern[] = ALL_PROCEDURAL_PATTERNS
  ): Promise<void> {
    const size = this.getTargetTexSize();
    const missing = patterns.filter((p) => !this.baseTextureSources.has(`${p}:${size}`));
    if (missing.length === 0) return;

    if (typeof Worker === 'undefined') {
      // Headless/Node fallback: synthesize cleanly on demand
      return;
    }

    const worker = this.ensureSynthWorker();
    if (!worker) return;

    await Promise.all(
      missing.map(async (pattern) => {
        const baseKey = `${pattern}:${size}`;
        if (this.baseTextureSources.has(baseKey)) return;
        try {
          const pixels = await this.requestWorkerSynthesis(worker, pattern, size);
          if (!this.baseTextureSources.has(baseKey)) {
            this.registerBaseGpuTriple(pattern, size, pixels);
          }
        } catch {
          // Worker fallback handled cleanly on synchronous access
        }
      })
    );
  }

  private ensureSynthWorker(): Worker | null {
    if (this.synthWorker) return this.synthWorker;
    if (typeof Worker === 'undefined') return null;
    try {
      const worker = new Worker(
        new URL('../workers/pbrTextureSynth.worker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        const job = this.pendingWorkerJobs.get(msg.requestId);
        if (!job) return;
        this.pendingWorkerJobs.delete(msg.requestId);
        job.resolve({
          albedoData: msg.albedoData,
          normalData: msg.normalData,
          rmData: msg.rmData,
          estimatedBytes: msg.estimatedBytes,
        });
      };
      worker.onerror = () => {
        this.terminateSynthWorker();
      };
      this.synthWorker = worker;
      return worker;
    } catch {
      return null;
    }
  }

  private requestWorkerSynthesis(
    worker: Worker,
    pattern: ProceduralPattern,
    size: number
  ): Promise<SynthesizedPbrPixels> {
    const requestId = ++this.workerRequestSeq;
    return new Promise((resolve, reject) => {
      this.pendingWorkerJobs.set(requestId, { resolve, reject });
      worker.postMessage({ requestId, pattern, size });
    });
  }

  private terminateSynthWorker(): void {
    if (this.synthWorker) {
      try {
        this.synthWorker.terminate();
      } catch {
        // Ignore already-terminated worker
      }
      this.synthWorker = null;
    }
    for (const job of this.pendingWorkerJobs.values()) {
      job.reject(new Error('PBR synthesis worker terminated'));
    }
    this.pendingWorkerJobs.clear();
  }

  async loadTextureWithFallback(
    url: string | null,
    fallbackPattern: ProceduralPattern,
    repeat: [number, number] = [1, 1],
    scope: ResourceScope = 'shared'
  ): Promise<THREE.Texture> {
    if (!url) {
      return this.getProceduralTexture(fallbackPattern, repeat, scope);
    }

    try {
      const tex = await new Promise<THREE.Texture>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`Timeout loading ${url}`)), 4500);
        this.textureLoader.load(
          url,
          (loaded) => {
            window.clearTimeout(timer);
            resolve(loaded);
          },
          undefined,
          (err) => {
            window.clearTimeout(timer);
            reject(err);
          }
        );
      });
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.resourceManager.registerTexture(tex, scope, url);
      return tex;
    } catch {
      this.fallbackCount++;
      return this.getProceduralTexture(fallbackPattern, repeat, scope);
    }
  }

  getProceduralTexture(
    pattern: ProceduralPattern,
    repeat: [number, number] = [1, 1],
    scope: ResourceScope = 'shared'
  ): THREE.DataTexture {
    return this.getPbrTextureBundle(pattern, repeat, scope).albedoMap;
  }

  getPbrTextureBundle(
    pattern: ProceduralPattern,
    repeat: [number, number] = [1, 1],
    scope: ResourceScope = 'shared'
  ): PbrTextureBundle {
    const size = this.getTargetTexSize();
    const key = `${pattern}:${repeat[0]}x${repeat[1]}:${size}`;
    if (scope === 'shared') {
      const existing = this.pbrBundles.get(key);
      if (existing) return existing;

      // Enforce resident cache cap by reusing same-pattern bundle if cache is full
      if (this.pbrBundles.size >= AssetManager.MAX_RESIDENT_PBR_BUNDLES) {
        for (const [k, b] of this.pbrBundles.entries()) {
          if (k.startsWith(`${pattern}:`)) {
            return b;
          }
        }
      }

      const bundle = this.createBundleFromSharedSource(pattern, size, repeat, scope, key);
      this.pbrBundles.set(key, bundle);
      return bundle;
    }

    const scopedKey = `${scope}|${key}`;
    const existingScoped = this.missionBundles.get(scopedKey);
    if (existingScoped) return existingScoped;
    const bundle = this.createBundleFromSharedSource(pattern, size, repeat, scope, scopedKey);
    this.missionBundles.set(scopedKey, bundle);
    return bundle;
  }

  private getOrCreateBaseGpuTriple(
    pattern: ProceduralPattern,
    size: number
  ): BaseGpuTextureTriple {
    const baseKey = `${pattern}:${size}`;
    const existing = this.baseTextureSources.get(baseKey);
    if (existing) return existing;

    const pixels = synthesizePbrPixels(pattern, size);
    return this.registerBaseGpuTriple(pattern, size, pixels);
  }

  private registerBaseGpuTriple(
    pattern: ProceduralPattern,
    size: number,
    pixels: SynthesizedPbrPixels
  ): BaseGpuTextureTriple {
    const baseKey = `${pattern}:${size}`;
    const existing = this.baseTextureSources.get(baseKey);
    if (existing) return existing;

    // Evict stale resolution caches for the same pattern when quality tier changes
    const prefix = `${pattern}:`;
    for (const existingKey of Array.from(this.baseTextureSources.keys())) {
      if (existingKey.startsWith(prefix) && existingKey !== baseKey) {
        this.baseTextureSources.delete(existingKey);
      }
    }

    const aniso = this.getEffectiveAnisotropy();
    const buildBaseTex = (
      data: Uint8Array,
      colorSpace: THREE.ColorSpace,
      channelLabel: string
    ): THREE.DataTexture => {
      const tex = new THREE.DataTexture(
        data,
        size,
        size,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );
      tex.colorSpace = colorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = aniso;
      tex.needsUpdate = true;
      this.resourceManager.registerTexture(tex, 'shared', `base:${baseKey}:${channelLabel}`);
      return tex;
    };

    const triple: BaseGpuTextureTriple = {
      pattern,
      size,
      albedoBase: buildBaseTex(pixels.albedoData, THREE.SRGBColorSpace, 'albedo'),
      normalBase: buildBaseTex(pixels.normalData, THREE.NoColorSpace, 'normal'),
      rmBase: buildBaseTex(pixels.rmData, THREE.NoColorSpace, 'rm'),
      estimatedBytes: pixels.estimatedBytes,
    };
    this.baseTextureSources.set(baseKey, triple);
    return triple;
  }

  private createBundleFromSharedSource(
    pattern: ProceduralPattern,
    size: number,
    repeat: [number, number],
    scope: ResourceScope,
    cacheKey: string
  ): PbrTextureBundle {
    const base = this.getOrCreateBaseGpuTriple(pattern, size);
    const isIdentityRepeat = repeat[0] === 1 && repeat[1] === 1;

    // Fast path: identity repeat on shared scope reuses the base textures directly with zero wrappers
    if (scope === 'shared' && isIdentityRepeat) {
      return {
        pattern,
        resolution: size,
        albedoMap: base.albedoBase,
        normalMap: base.normalBase,
        roughnessMap: base.rmBase,
        metalnessMap: base.rmBase,
        estimatedBytes: base.estimatedBytes,
      };
    }

    const aniso = this.getEffectiveAnisotropy();
    const createAlias = (
      sourceTex: THREE.DataTexture,
      colorSpace: THREE.ColorSpace,
      channelLabel: string
    ): THREE.DataTexture => {
      // Lightweight Texture wrapper sharing the exact same THREE.Source (single GPU texture upload)
      const alias = new THREE.DataTexture(
        null,
        size,
        size,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );
      alias.source = sourceTex.source;
      alias.colorSpace = colorSpace;
      alias.wrapS = THREE.RepeatWrapping;
      alias.wrapT = THREE.RepeatWrapping;
      alias.repeat.set(repeat[0], repeat[1]);
      alias.generateMipmaps = true;
      alias.minFilter = THREE.LinearMipmapLinearFilter;
      alias.magFilter = THREE.LinearFilter;
      alias.anisotropy = aniso;
      alias.needsUpdate = true;

      this.resourceManager.register(
        'texture',
        scope,
        () => {
          alias.dispose();
          if (scope !== 'shared') {
            this.missionBundles.delete(cacheKey);
          }
        },
        `${cacheKey}:${channelLabel}`
      );
      return alias;
    };

    const albedoMap = createAlias(base.albedoBase, THREE.SRGBColorSpace, 'albedo');
    const normalMap = createAlias(base.normalBase, THREE.NoColorSpace, 'normal');
    const rmMap = createAlias(base.rmBase, THREE.NoColorSpace, 'rm');

    return {
      pattern,
      resolution: size,
      albedoMap,
      normalMap,
      roughnessMap: rmMap,
      metalnessMap: rmMap,
      estimatedBytes: base.estimatedBytes,
    };
  }

  getSharedMaterial(
    key: string,
    opts: MaterialOptions,
    scope: ResourceScope = 'shared'
  ): THREE.MeshStandardMaterial {
    if (scope === 'shared') {
      const existing = this.materials.get(key);
      if (existing) return existing;
    } else {
      const scopedKey = `${scope}|${key}`;
      const existingScoped = this.missionMaterials.get(scopedKey);
      if (existingScoped) return existingScoped;
    }

    const bundle = opts.pattern
      ? this.getPbrTextureBundle(opts.pattern, opts.repeat ?? [1, 1], scope)
      : undefined;

    const nScale = opts.normalScale ?? 0.65;
    const matParams: THREE.MeshStandardMaterialParameters = {
      color: opts.color ?? 0xffffff,
      roughness: opts.roughness ?? 0.82,
      metalness: opts.metalness ?? (bundle ? 0.65 : 0.12),
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    };
    if (bundle) {
      matParams.map = bundle.albedoMap;
      matParams.normalMap = bundle.normalMap;
      matParams.normalScale = new THREE.Vector2(nScale, nScale);
      matParams.roughnessMap = bundle.roughnessMap;
      matParams.metalnessMap = bundle.metalnessMap;
    }
    if (opts.emissive !== undefined) {
      matParams.emissive = new THREE.Color(opts.emissive);
    }
    const mat = new THREE.MeshStandardMaterial(matParams);

    if (opts.externalAlbedoUrl && opts.pattern) {
      void this.loadTextureWithFallback(
        opts.externalAlbedoUrl,
        opts.pattern,
        opts.repeat ?? [1, 1],
        scope
      ).then((loadedTex) => {
        if (
          scope !== 'shared'
            ? this.missionMaterials.has(`${scope}|${key}`)
            : this.materials.has(key)
        ) {
          mat.map = loadedTex;
          mat.needsUpdate = true;
        }
      });
    }

    const regId = scope === 'shared' ? key : `${scope}:${key}`;
    if (scope === 'shared') {
      this.resourceManager.registerMaterial(mat, scope, regId);
      this.materials.set(key, mat);
    } else {
      const scopedKey = `${scope}|${key}`;
      this.resourceManager.register(
        'material',
        scope,
        () => {
          mat.dispose();
          this.missionMaterials.delete(scopedKey);
        },
        regId
      );
      this.missionMaterials.set(scopedKey, mat);
    }
    this.onMaterialCreated?.(mat);
    return mat;
  }

  dispose(): void {
    this.terminateSynthWorker();
    this.baseTextureSources.clear();
    this.pbrBundles.clear();
    this.missionBundles.clear();
    this.materials.clear();
    this.missionMaterials.clear();
  }
}
