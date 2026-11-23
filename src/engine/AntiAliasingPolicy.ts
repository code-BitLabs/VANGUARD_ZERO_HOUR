import { QualityTier } from '@/src/schemas/common.schema';
import { AntiAliasingMode } from '@/src/schemas/settings.schema';

export interface AntiAliasingPolicyInput {
  readonly requestedMode: AntiAliasingMode;
  readonly antialiasingEnabled: boolean;
  readonly isSoftwareGl: boolean;
  readonly isWebGL2: boolean;
  readonly maxSamples: number;
  readonly msaaFramebufferSupported: boolean;
  readonly canvasPixelCount: number;
  readonly isMobileOrCoarse: boolean;
  readonly qualityTier: QualityTier;
  readonly adaptiveDowngradeStep?: number;
}

export interface ResolvedAntiAliasingConfig {
  readonly activeMode: Exclude<AntiAliasingMode, 'auto'>;
  readonly multisampling: 0 | 2 | 4;
  readonly useSmaa: boolean;
  readonly reason: string;
}

/**
 * Pixel-count threshold above which 4x HalfFloat MSAA render-target bandwidth becomes
 * prohibitive (~150 MB+ at 4K), preferring 2x MSAA or SMAA in Auto mode.
 */
export const HIGH_RES_MSAA4_PIXEL_THRESHOLD = 2_600_000;

/**
 * Deterministic hybrid hardware-adaptive anti-aliasing policy.
 * Evaluates actual WebGL2 capability (MAX_SAMPLES, HalfFloat MSAA support),
 * software-GL detection, viewport pixel budget, device class, quality tier,
 * adaptive degradation step, and explicit user overrides.
 */
export function resolveAntiAliasingPolicy(
  input: AntiAliasingPolicyInput
): ResolvedAntiAliasingConfig {
  const {
    requestedMode,
    antialiasingEnabled,
    isSoftwareGl,
    isWebGL2,
    maxSamples,
    msaaFramebufferSupported,
    canvasPixelCount,
    isMobileOrCoarse,
    qualityTier,
    adaptiveDowngradeStep = 0,
  } = input;

  if (isSoftwareGl) {
    return {
      activeMode: 'off',
      multisampling: 0,
      useSmaa: false,
      reason: 'software_webgl_disabled',
    };
  }

  if (requestedMode === 'off' || (!antialiasingEnabled && requestedMode === 'auto')) {
    return {
      activeMode: 'off',
      multisampling: 0,
      useSmaa: false,
      reason: 'user_disabled',
    };
  }

  const canMsaa4 = isWebGL2 && msaaFramebufferSupported && maxSamples >= 4;
  const canMsaa2 = isWebGL2 && msaaFramebufferSupported && maxSamples >= 2;

  if (requestedMode === 'smaa') {
    return {
      activeMode: 'smaa',
      multisampling: 0,
      useSmaa: true,
      reason: 'user_override_smaa',
    };
  }

  if (requestedMode === 'msaa4') {
    if (canMsaa4) {
      return {
        activeMode: 'msaa4',
        multisampling: 4,
        useSmaa: false,
        reason: 'user_override_msaa4',
      };
    }
    if (canMsaa2) {
      return {
        activeMode: 'msaa2',
        multisampling: 2,
        useSmaa: false,
        reason: 'msaa4_unsupported_fallback_msaa2',
      };
    }
    return {
      activeMode: 'smaa',
      multisampling: 0,
      useSmaa: true,
      reason: 'msaa_unsupported_fallback_smaa',
    };
  }

  if (requestedMode === 'msaa2') {
    if (canMsaa2) {
      return {
        activeMode: 'msaa2',
        multisampling: 2,
        useSmaa: false,
        reason: 'user_override_msaa2',
      };
    }
    return {
      activeMode: 'smaa',
      multisampling: 0,
      useSmaa: true,
      reason: 'msaa2_unsupported_fallback_smaa',
    };
  }

  // Auto hardware-adaptive selection
  if (isMobileOrCoarse || qualityTier === 'low' || adaptiveDowngradeStep >= 3) {
    return {
      activeMode: 'smaa',
      multisampling: 0,
      useSmaa: true,
      reason: isMobileOrCoarse
        ? 'auto_mobile_bandwidth_smaa'
        : qualityTier === 'low'
          ? 'auto_low_tier_smaa'
          : 'auto_adaptive_stepdown_smaa',
    };
  }

  if (!canMsaa2) {
    return {
      activeMode: 'smaa',
      multisampling: 0,
      useSmaa: true,
      reason: 'auto_webgl_msaa_unavailable_smaa',
    };
  }

  const highResViewport = canvasPixelCount > HIGH_RES_MSAA4_PIXEL_THRESHOLD;
  if (
    highResViewport ||
    qualityTier === 'medium' ||
    adaptiveDowngradeStep >= 2 ||
    !canMsaa4
  ) {
    return {
      activeMode: 'msaa2',
      multisampling: 2,
      useSmaa: false,
      reason: highResViewport
        ? 'auto_high_res_pixel_budget_msaa2'
        : qualityTier === 'medium'
          ? 'auto_medium_tier_msaa2'
          : adaptiveDowngradeStep >= 2
            ? 'auto_adaptive_stepdown_msaa2'
            : 'auto_max_samples_2_msaa2',
    };
  }

  return {
    activeMode: 'msaa4',
    multisampling: 4,
    useSmaa: false,
    reason: 'auto_desktop_high_msaa4',
  };
}
