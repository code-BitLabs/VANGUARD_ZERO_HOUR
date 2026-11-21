import * as THREE from 'three';
import { QualityTier } from '@/src/schemas/common.schema';
import { GraphicsSettings, HardwareCapabilityProfile } from '@/src/schemas/settings.schema';

export interface GpuCapabilitySignals {
  webglVersion: 1 | 2 | 0;
  maxTextureSize: number;
  maxRenderbufferSize: number;
  maxAnisotropy: number;
  maxSamples: number;
  hasFloatColorBuffer: boolean;
  rendererHint: string | null; // Strictly optional; may be masked by browser privacy
  hardwareConcurrency: number;
  deviceMemoryGb: number | null; // Undefined/null on iOS Safari & privacy browsers
  devicePixelRatio: number;
  isCoarsePointer: boolean;
  isMobileFormFactor: boolean;
  avgProbeFrameMs: number | null;
}

export interface GpuCapabilityReport {
  score: number;
  hardwareProfile: HardwareCapabilityProfile;
  recommendedTier: QualityTier;
  recommendedSettings: Partial<GraphicsSettings>;
  signals: GpuCapabilitySignals;
  reasons: string[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function readRendererHint(gl: WebGLRenderingContext | WebGL2RenderingContext | null): string | null {
  if (!gl) return null;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const unmasked = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (typeof unmasked === 'string' && unmasked.trim().length > 0) {
        return unmasked.trim();
      }
    }
    const baseRenderer = gl.getParameter(gl.RENDERER);
    return typeof baseRenderer === 'string' && baseRenderer.trim().length > 0 ? baseRenderer.trim() : null;
  } catch {
    return null;
  }
}

export function gatherGpuSignals(
  threeRenderer?: THREE.WebGLRenderer | null,
  probeAvgFrameMs: number | null = null
): GpuCapabilitySignals {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;

  const hardwareConcurrency =
    nav && typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
      ? nav.hardwareConcurrency
      : 4;

  const rawMem = nav ? (nav as unknown as { deviceMemory?: number }).deviceMemory : undefined;
  const deviceMemoryGb = typeof rawMem === 'number' && rawMem > 0 ? rawMem : null;

  const devicePixelRatio =
    win && typeof win.devicePixelRatio === 'number' && win.devicePixelRatio > 0
      ? win.devicePixelRatio
      : 1;

  const isCoarsePointer = Boolean(
    win?.matchMedia?.('(pointer: coarse)')?.matches ||
      (nav && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0 && (win?.innerWidth ?? 1280) <= 1024)
  );

  const vw = win?.innerWidth ?? 1280;
  const vh = win?.innerHeight ?? 720;
  const minDim = Math.min(vw, vh);
  const maxDim = Math.max(vw, vh);
  const isMobileFormFactor = isCoarsePointer && maxDim <= 1180 && minDim <= 640;

  let webglVersion: 1 | 2 | 0 = 0;
  let maxTextureSize = 4096;
  let maxRenderbufferSize = 4096;
  let maxAnisotropy = 4;
  let maxSamples = 0;
  let hasFloatColorBuffer = false;
  let rendererHint: string | null = null;

  if (threeRenderer) {
    try {
      const gl = threeRenderer.getContext();
      const caps = threeRenderer.capabilities;
      webglVersion = caps.isWebGL2 ? 2 : 1;
      maxTextureSize = caps.maxTextureSize || 4096;
      maxAnisotropy = caps.getMaxAnisotropy?.() ?? 4;
      maxSamples = caps.maxSamples ?? 0;
      if (gl) {
        maxRenderbufferSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || maxTextureSize;
        hasFloatColorBuffer = Boolean(
          gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')
        );
        rendererHint = readRendererHint(gl);
      }
    } catch {
      // Keep safe defaults
    }
  }

  return {
    webglVersion,
    maxTextureSize,
    maxRenderbufferSize,
    maxAnisotropy,
    maxSamples,
    hasFloatColorBuffer,
    rendererHint,
    hardwareConcurrency,
    deviceMemoryGb,
    devicePixelRatio,
    isCoarsePointer,
    isMobileFormFactor,
    avgProbeFrameMs: probeAvgFrameMs,
  };
}

/**
 * Classifies GPU & device capability using multiple orthogonal signals
 * (WebGL2 capability, texture/renderbuffer limits, core count, memory hint,
 * DPR/form factor, and optional non-blocking frame-time samples).
 * Never blocks boot and never relies solely on GPU model strings.
 */
export function classifyGpuCapability(signals: GpuCapabilitySignals): GpuCapabilityReport {
  let score = 50;
  const reasons: string[] = [];

  if (signals.webglVersion === 2) {
    score += 14;
    reasons.push('WebGL2 available');
  } else if (signals.webglVersion === 1) {
    score -= 18;
    reasons.push('WebGL1 fallback');
  }

  if (signals.maxTextureSize >= 16384) {
    score += 10;
  } else if (signals.maxTextureSize >= 8192) {
    score += 4;
  } else if (signals.maxTextureSize <= 4096) {
    score -= 12;
    reasons.push(`Limited MAX_TEXTURE_SIZE (${signals.maxTextureSize})`);
  }

  if (signals.hasFloatColorBuffer) {
    score += 5;
  } else {
    score -= 6;
    reasons.push('No float color buffer extension');
  }

  if (signals.hardwareConcurrency >= 8) {
    score += 10;
  } else if (signals.hardwareConcurrency >= 6) {
    score += 5;
  } else if (signals.hardwareConcurrency <= 2) {
    score -= 16;
    reasons.push(`Low CPU thread count (${signals.hardwareConcurrency})`);
  } else if (signals.hardwareConcurrency <= 4) {
    score -= 6;
  }

  if (signals.deviceMemoryGb !== null) {
    if (signals.deviceMemoryGb >= 8) {
      score += 8;
    } else if (signals.deviceMemoryGb <= 2) {
      score -= 18;
      reasons.push(`Constrained deviceMemory (${signals.deviceMemoryGb} GB)`);
    } else if (signals.deviceMemoryGb <= 4) {
      score -= 8;
      reasons.push(`Moderate deviceMemory (${signals.deviceMemoryGb} GB)`);
    }
  } else {
    reasons.push('deviceMemory masked/unavailable');
  }

  if (signals.isMobileFormFactor) {
    score -= 14;
    reasons.push('Mobile landscape thermal/bandwidth budget');
  } else if (signals.isCoarsePointer) {
    score -= 6;
    reasons.push('Tablet/touch form factor');
  }

  if (signals.devicePixelRatio >= 2.5 && signals.isMobileFormFactor) {
    score -= 4;
    reasons.push(`High mobile DPR (${signals.devicePixelRatio.toFixed(1)}x)`);
  }

  // Optional soft software-rasterizer check without trusting model strings alone
  if (signals.rendererHint) {
    const hintLower = signals.rendererHint.toLowerCase();
    if (hintLower.includes('swiftshader') || hintLower.includes('llvmpipe') || hintLower.includes('software')) {
      score -= 30;
      reasons.push('Software rasterizer detected');
    }
  }

  // Runtime / initial frame-time probe correction
  if (signals.avgProbeFrameMs !== null) {
    if (signals.avgProbeFrameMs > 28) {
      score -= 22;
      reasons.push(`Slow initial frames (${signals.avgProbeFrameMs.toFixed(1)}ms)`);
    } else if (signals.avgProbeFrameMs > 19.5) {
      score -= 12;
      reasons.push(`Elevated initial frames (${signals.avgProbeFrameMs.toFixed(1)}ms)`);
    } else if (signals.avgProbeFrameMs < 11.0) {
      score += 6;
    }
  }

  score = clamp(Math.round(score), 0, 100);

  let recommendedTier: QualityTier;
  if (score < 38) {
    recommendedTier = 'low';
  } else if (score < 62) {
    recommendedTier = 'medium';
  } else if (score < 84) {
    recommendedTier = 'high';
  } else {
    recommendedTier = 'ultra';
  }

  // Never default mobile devices directly into heavy desktop ultra settings on first launch
  if (signals.isMobileFormFactor && recommendedTier === 'ultra') {
    recommendedTier = 'high';
  }

  const hintLower = (signals.rendererHint ?? '').toLowerCase();
  const isSoftwareGl =
    hintLower.includes('swiftshader') ||
    hintLower.includes('llvmpipe') ||
    hintLower.includes('software') ||
    hintLower.includes('basic render driver') ||
    signals.webglVersion <= 1;
  const isIntegratedHint = /intel|uhd|iris|vega|apple m1|adreno 6|mali-g5/.test(hintLower);

  let hardwareProfile: HardwareCapabilityProfile;
  if (isSoftwareGl) {
    hardwareProfile = 'software_webgl';
  } else if (signals.isMobileFormFactor) {
    hardwareProfile = score >= 52 ? 'mid_range_mobile' : 'low_end_mobile';
  } else if (score >= 84 && !isIntegratedHint) {
    hardwareProfile = 'high_end_desktop';
  } else if (score >= 64 && !isIntegratedHint) {
    hardwareProfile = 'mid_range_desktop';
  } else if (signals.isCoarsePointer && score < 55) {
    hardwareProfile = 'mid_range_mobile';
  } else {
    hardwareProfile = 'integrated_gpu';
  }

  const recommendedSettings = buildSettingsPatchForTier(recommendedTier, signals.isMobileFormFactor);

  return {
    score,
    hardwareProfile,
    recommendedTier,
    recommendedSettings,
    signals,
    reasons,
  };
}

export function buildSettingsPatchForTier(
  tier: QualityTier,
  isMobile = false
): Partial<GraphicsSettings> {
  switch (tier) {
    case 'low':
      return {
        quality: 'low',
        renderScale: isMobile ? 0.7 : 0.75,
        shadowsEnabled: false,
        csmCascades: 1,
        shadowMapSize: 512,
        ambientOcclusion: false,
        volumetricFog: false,
        wetReflections: false,
        decalBudget: 32,
        foliageDensity: 'low',
        maxDpr: 1.0,
        bloomEnabled: false,
        textureQuality: 'low',
        antialiasing: false,
        effectsQuality: 'low',
        drawDistance: 'short',
        fpsCap: isMobile ? 60 : 0,
      };
    case 'medium':
      return {
        quality: 'medium',
        renderScale: isMobile ? 0.85 : 0.9,
        shadowsEnabled: true,
        csmCascades: 2,
        shadowMapSize: 1024,
        ambientOcclusion: false,
        volumetricFog: !isMobile,
        wetReflections: false,
        decalBudget: 80,
        foliageDensity: 'medium',
        maxDpr: isMobile ? 1.35 : 1.5,
        bloomEnabled: false,
        textureQuality: 'medium',
        antialiasing: !isMobile,
        effectsQuality: 'medium',
        drawDistance: 'medium',
        fpsCap: isMobile ? 60 : 0,
      };
    case 'high':
      return {
        quality: 'high',
        renderScale: isMobile ? 0.95 : 1.0,
        shadowsEnabled: true,
        csmCascades: isMobile ? 2 : 3,
        shadowMapSize: 1024,
        ambientOcclusion: !isMobile,
        volumetricFog: true,
        wetReflections: !isMobile,
        decalBudget: isMobile ? 96 : 128,
        foliageDensity: 'high',
        maxDpr: isMobile ? 1.5 : 1.75,
        bloomEnabled: !isMobile,
        textureQuality: 'high',
        antialiasing: true,
        effectsQuality: 'high',
        drawDistance: 'long',
        fpsCap: 0,
      };
    case 'ultra':
      return {
        quality: 'ultra',
        renderScale: 1.0,
        shadowsEnabled: true,
        csmCascades: 4,
        shadowMapSize: 2048,
        ambientOcclusion: true,
        volumetricFog: true,
        wetReflections: true,
        decalBudget: 224,
        foliageDensity: 'high',
        maxDpr: 2.0,
        bloomEnabled: true,
        textureQuality: 'high',
        antialiasing: true,
        effectsQuality: 'high',
        drawDistance: 'ultra',
        fpsCap: 0,
      };
  }
}

export function detectGpuCapability(
  threeRenderer?: THREE.WebGLRenderer | null,
  probeAvgFrameMs: number | null = null
): GpuCapabilityReport {
  return classifyGpuCapability(gatherGpuSignals(threeRenderer, probeAvgFrameMs));
}
