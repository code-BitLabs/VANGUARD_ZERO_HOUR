import * as THREE from 'three';
import { QualityTier } from '@/src/schemas/common.schema';
import { ResourceManager, ResourceScope } from './ResourceManager';

export type ProceduralPattern =
  | 'concrete'
  | 'asphalt'
  | 'sand'
  | 'jungle_ground'
  | 'metal_plate'
  | 'warning_stripe'
  | 'crate_wood'
  | 'weathered_structural';

export const ALL_PROCEDURAL_PATTERNS: readonly ProceduralPattern[] = [
  'concrete',
  'asphalt',
  'sand',
  'jungle_ground',
  'metal_plate',
  'warning_stripe',
  'crate_wood',
  'weathered_structural',
];

export interface PbrTextureBundle {
  readonly pattern: ProceduralPattern;
  readonly resolution: number;
  readonly albedoMap: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
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

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash2D(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoiseTileable(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const ix0 = ((x0 % period) + period) % period;
  const iy0 = ((y0 % period) + period) % period;
  const ix1 = (ix0 + 1) % period;
  const iy1 = (iy0 + 1) % period;

  const n00 = hash2D(ix0, iy0, seed);
  const n10 = hash2D(ix1, iy0, seed);
  const n01 = hash2D(ix0, iy1, seed);
  const n11 = hash2D(ix1, iy1, seed);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function fbmTileable(u: number, v: number, basePeriod: number, seed: number): number {
  return (
    valueNoiseTileable(u, v, basePeriod, seed) * 0.55 +
    valueNoiseTileable(u, v, basePeriod * 2, seed + 101) * 0.3 +
    valueNoiseTileable(u, v, basePeriod * 4, seed + 307) * 0.15
  );
}

function clampByte(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
}

/**
 * TRN-07: Multi-Channel PBR AssetManager.
 * Generates deterministic, seeded Albedo (sRGB), Tangent-Space Normal (Linear),
 * Roughness (Linear), and Metalness (Linear) textures scaled by active QualityTier
 * with explicit GPU memory accounting and asynchronous external loader fallback.
 */
export class AssetManager {
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly pbrBundles = new Map<string, PbrTextureBundle>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private fallbackCount = 0;
  private textureQuality: QualityTier = 'high';
  private maxAnisotropy = 4;

  /**
   * Maximum resident PBR profile cache entries to bound GPU memory (~42.6 MiB max at 512x512 with mipmaps).
   */
  public static readonly MAX_RESIDENT_PBR_BUNDLES = 16;

  constructor(private readonly resourceManager: ResourceManager) {}

  configureRenderer(renderer: THREE.WebGLRenderer): void {
    this.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);
  }

  getTargetTexSize(tier: QualityTier = this.textureQuality): number {
    if (tier === 'low') return 128;
    if (tier === 'medium') return 256;
    return 512;
  }

  setTextureQuality(quality: QualityTier): void {
    if (this.textureQuality === quality) return;
    this.textureQuality = quality;
    const aniso =
      quality === 'low'
        ? 1
        : quality === 'medium'
          ? Math.min(2, this.maxAnisotropy)
          : quality === 'high'
            ? Math.min(4, this.maxAnisotropy)
            : this.maxAnisotropy;

    for (const bundle of this.pbrBundles.values()) {
      for (const tex of [
        bundle.albedoMap,
        bundle.normalMap,
        bundle.roughnessMap,
        bundle.metalnessMap,
      ]) {
        tex.anisotropy = aniso;
        tex.needsUpdate = true;
      }
    }
  }

  markTexturesNeedUpdate(): void {
    for (const bundle of this.pbrBundles.values()) {
      bundle.albedoMap.needsUpdate = true;
      bundle.normalMap.needsUpdate = true;
      bundle.roughnessMap.needsUpdate = true;
      bundle.metalnessMap.needsUpdate = true;
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

  getEstimatedGpuMemoryBytes(): number {
    let total = 0;
    for (const b of this.pbrBundles.values()) {
      total += b.estimatedBytes;
    }
    return total;
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
    const existing = this.pbrBundles.get(key);
    if (existing) return existing;

    // Enforce resident cache cap by reusing same-pattern base bundle if cache is full
    if (this.pbrBundles.size >= AssetManager.MAX_RESIDENT_PBR_BUNDLES) {
      for (const [k, b] of this.pbrBundles.entries()) {
        if (k.startsWith(`${pattern}:`)) {
          return b;
        }
      }
    }

    const bundle = this.synthesizePbrBundle(pattern, size, repeat, scope, key);
    if (scope === 'shared') {
      this.pbrBundles.set(key, bundle);
    }
    return bundle;
  }

  private synthesizePbrBundle(
    pattern: ProceduralPattern,
    size: number,
    repeat: [number, number],
    scope: ResourceScope,
    cacheKey: string
  ): PbrTextureBundle {
    const pixelCount = size * size;
    const heightField = new Float32Array(pixelCount);
    const albedoData = new Uint8Array(pixelCount * 4);
    const normalData = new Uint8Array(pixelCount * 4);
    const roughnessData = new Uint8Array(pixelCount * 4);
    const metalnessData = new Uint8Array(pixelCount * 4);

    const seed = hashSeed(pattern);
    const invSize = 1 / size;

    for (let y = 0; y < size; y++) {
      const v = y * invSize;
      for (let x = 0; x < size; x++) {
        const u = x * invSize;
        const idx = y * size + x;
        const off = idx * 4;

        const nCoarse = fbmTileable(u, v, 8, seed);
        const nFine = valueNoiseTileable(u, v, 32, seed + 509);
        const micro = hash2D(x, y, seed + 997);

        let r = 128;
        let g = 128;
        let b = 128;
        let h = nCoarse * 0.6 + nFine * 0.4;
        let rough = 0.8;
        let metal = 0.05;

        switch (pattern) {
          case 'concrete': {
            const seamX = Math.min(u * 4 - Math.floor(u * 4), 1 - (u * 4 - Math.floor(u * 4)));
            const seamY = Math.min(v * 4 - Math.floor(v * 4), 1 - (v * 4 - Math.floor(v * 4)));
            const seamGroove = seamX < 0.018 || seamY < 0.018 ? -0.28 : 0;
            const pitting = micro < 0.08 ? -0.18 : 0;
            h = nCoarse * 0.55 + nFine * 0.35 + seamGroove + pitting;
            const shade = 104 + (nCoarse - 0.5) * 34 + (nFine - 0.5) * 18 + seamGroove * 42;
            r = shade;
            g = shade + 2;
            b = shade + 5;
            rough = 0.82 + (1 - h) * 0.14;
            metal = 0.04;
            break;
          }
          case 'asphalt': {
            const pebble = micro > 0.78 ? 0.22 : micro < 0.12 ? -0.16 : 0;
            h = nCoarse * 0.4 + nFine * 0.45 + pebble;
            const shade = 52 + (nCoarse - 0.5) * 20 + pebble * 36;
            r = shade;
            g = shade + 2;
            b = shade + 6;
            rough = 0.78 + (1 - pebble) * 0.14;
            metal = 0.06;
            break;
          }
          case 'sand': {
            const ripple = Math.sin((u * 6 + v * 18 + nCoarse * 0.8) * Math.PI * 2) * 0.5 + 0.5;
            h = ripple * 0.55 + nCoarse * 0.35 + nFine * 0.1;
            const delta = (h - 0.5) * 36 + (micro - 0.5) * 12;
            r = 198 + delta;
            g = 166 + delta * 0.9;
            b = 118 + delta * 0.75;
            rough = 0.86 + (1 - ripple) * 0.08;
            metal = 0.02;
            break;
          }
          case 'jungle_ground': {
            const mossPatch = nCoarse > 0.52 ? (nCoarse - 0.52) * 2.0 : 0;
            h = nCoarse * 0.6 + nFine * 0.3 + (micro - 0.5) * 0.1;
            r = 56 + (1 - mossPatch) * 26 + (nFine - 0.5) * 18;
            g = 78 + mossPatch * 34 + (nFine - 0.5) * 22;
            b = 46 + (nFine - 0.5) * 14;
            rough = 0.76 + (1 - mossPatch) * 0.16;
            metal = 0.03;
            break;
          }
          case 'metal_plate': {
            const cellU = (u * 4) % 1;
            const cellV = (v * 4) % 1;
            const border =
              cellU < 0.04 || cellU > 0.96 || cellV < 0.04 || cellV > 0.96 ? -0.32 : 0;
            const ddx = (cellU - 0.5) * 2;
            const ddy = (cellV - 0.5) * 2;
            const tread =
              Math.abs(ddx) + Math.abs(ddy) < 0.36 && border === 0 ? 0.28 : 0;
            const scratch = Math.abs(((u * 24 + v * 6) % 1) - 0.5) < 0.03 ? 0.12 : 0;
            h = 0.5 + border + tread + (nFine - 0.5) * 0.12;
            const base = 90 + tread * 38 + border * 45 + (nCoarse - 0.5) * 16 + scratch * 24;
            r = base;
            g = base + 5;
            b = base + 12;
            rough = 0.34 + (1 - tread) * 0.18 - scratch * 0.1 + (1 - nCoarse) * 0.12;
            metal = border < 0 ? 0.55 : 0.82;
            break;
          }
          case 'warning_stripe': {
            const diag = (u * 8 + v * 8) % 1;
            const isYellow = diag < 0.5;
            const wear = nFine > 0.76 ? (nFine - 0.76) * 2.5 : 0;
            h = 0.5 + (isYellow ? 0.06 : -0.04) - wear * 0.18;
            if (isYellow) {
              r = 228 - wear * 70;
              g = 166 - wear * 50;
              b = 22 + wear * 30;
            } else {
              r = 32 + wear * 40;
              g = 36 + wear * 40;
              b = 42 + wear * 40;
            }
            rough = 0.52 + wear * 0.32;
            metal = 0.22 + wear * 0.38;
            break;
          }
          case 'crate_wood': {
            const plankV = (v * 6) % 1;
            const plankGap = plankV < 0.05 || plankV > 0.95 ? -0.35 : 0;
            const grain = Math.sin((v * 48 + nCoarse * 2.2) * Math.PI * 2) * 0.5 + 0.5;
            h = 0.55 + plankGap + grain * 0.18 + (nFine - 0.5) * 0.08;
            const woodTone = 118 + grain * 26 + plankGap * 65 + (nCoarse - 0.5) * 18;
            r = woodTone + 18;
            g = woodTone - 6;
            b = woodTone - 34;
            rough = 0.78 + (1 - grain) * 0.14;
            metal = 0.04;
            break;
          }
          case 'weathered_structural': {
            const panelU = (u * 2) % 1;
            const panelV = (v * 4) % 1;
            const joint =
              panelU < 0.03 || panelU > 0.97 || panelV < 0.04 || panelV > 0.96 ? -0.34 : 0;
            const rustStreak =
              nCoarse > 0.58 && v < 0.45 ? (nCoarse - 0.58) * (1 - v * 2) * 1.8 : 0;
            h = 0.52 + joint + (nFine - 0.5) * 0.22 - rustStreak * 0.15;
            const base = 86 + (nCoarse - 0.5) * 24 + joint * 48;
            r = base + rustStreak * 52;
            g = base + 3 - rustStreak * 12;
            b = base + 7 - rustStreak * 28;
            rough = 0.58 + rustStreak * 0.32 + (joint < 0 ? 0.2 : 0);
            metal = Math.max(0.12, 0.52 - rustStreak * 0.35);
            break;
          }
        }

        heightField[idx] = h;

        albedoData[off] = clampByte(r);
        albedoData[off + 1] = clampByte(g);
        albedoData[off + 2] = clampByte(b);
        albedoData[off + 3] = 255;

        const rByte = clampByte(rough * 255);
        roughnessData[off] = rByte;
        roughnessData[off + 1] = rByte;
        roughnessData[off + 2] = rByte;
        roughnessData[off + 3] = 255;

        const mByte = clampByte(metal * 255);
        metalnessData[off] = mByte;
        metalnessData[off + 1] = mByte;
        metalnessData[off + 2] = mByte;
        metalnessData[off + 3] = 255;
      }
    }

    // Second pass: compute tangent-space normal map via wrap-around Sobel filter on heightField
    const normalStrength =
      pattern === 'metal_plate' || pattern === 'weathered_structural' ? 3.2 : 2.6;
    for (let y = 0; y < size; y++) {
      const ym1 = (y - 1 + size) % size;
      const yp1 = (y + 1) % size;
      for (let x = 0; x < size; x++) {
        const xm1 = (x - 1 + size) % size;
        const xp1 = (x + 1) % size;

        const tl = heightField[ym1 * size + xm1];
        const tc = heightField[ym1 * size + x];
        const tr = heightField[ym1 * size + xp1];
        const ml = heightField[y * size + xm1];
        const mr = heightField[y * size + xp1];
        const bl = heightField[yp1 * size + xm1];
        const bc = heightField[yp1 * size + x];
        const br = heightField[yp1 * size + xp1];

        const dX = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * normalStrength;
        const dY = (bl + 2 * bc + br - (tl + 2 * tc + tr)) * normalStrength;
        const dZ = 1.0;
        const invLen = 1 / Math.hypot(dX, dY, dZ);

        const nx = -dX * invLen;
        const ny = -dY * invLen;
        const nz = dZ * invLen;

        const off = (y * size + x) * 4;
        normalData[off] = clampByte((nx * 0.5 + 0.5) * 255);
        normalData[off + 1] = clampByte((ny * 0.5 + 0.5) * 255);
        normalData[off + 2] = clampByte((nz * 0.5 + 0.5) * 255);
        normalData[off + 3] = 255;
      }
    }

    const aniso =
      this.textureQuality === 'low'
        ? 1
        : this.textureQuality === 'medium'
          ? Math.min(2, this.maxAnisotropy)
          : this.textureQuality === 'high'
            ? Math.min(4, this.maxAnisotropy)
            : this.maxAnisotropy;

    const configureDataTex = (
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
      tex.repeat.set(repeat[0], repeat[1]);
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = aniso;
      tex.needsUpdate = true;
      this.resourceManager.registerTexture(tex, scope, `${cacheKey}:${channelLabel}`);
      return tex;
    };

    const albedoMap = configureDataTex(albedoData, THREE.SRGBColorSpace, 'albedo');
    const normalMap = configureDataTex(normalData, THREE.NoColorSpace, 'normal');
    const roughnessMap = configureDataTex(roughnessData, THREE.NoColorSpace, 'roughness');
    const metalnessMap = configureDataTex(metalnessData, THREE.NoColorSpace, 'metalness');

    // 4 RGBA8 textures * (base + 1/3 mipmap pyramid)
    const estimatedBytes = Math.round(pixelCount * 4 * 4 * (4 / 3));

    return {
      pattern,
      resolution: size,
      albedoMap,
      normalMap,
      roughnessMap,
      metalnessMap,
      estimatedBytes,
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
        if (scope !== 'shared' || this.materials.has(key)) {
          mat.map = loadedTex;
          mat.needsUpdate = true;
        }
      });
    }

    this.resourceManager.registerMaterial(mat, scope, key);
    if (scope === 'shared') {
      this.materials.set(key, mat);
    }
    return mat;
  }

  dispose(): void {
    this.pbrBundles.clear();
    this.materials.clear();
  }
}
