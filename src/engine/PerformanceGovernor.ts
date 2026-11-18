import { QualityTier } from '@/src/schemas/common.schema';
import { DrawDistanceSetting, GraphicsSettings, SubQualityLevel } from '@/src/schemas/settings.schema';

export interface GovernorProfile {
  tier: QualityTier;
  renderScale: number;
  shadowMapSize: number;
  shadowDistance: number;
  particleBudgetRatio: number;
  bloomEnabled: boolean;
  drawDistance: number;
  aiMidIntervalSec: number;
  lodBias: number;
}

const PROFILES: Record<QualityTier, GovernorProfile> = {
  low: {
    tier: 'low',
    renderScale: 0.75,
    shadowMapSize: 512,
    shadowDistance: 45,
    particleBudgetRatio: 0.3,
    bloomEnabled: false,
    drawDistance: 150,
    aiMidIntervalSec: 0.2,
    lodBias: 0.65,
  },
  medium: {
    tier: 'medium',
    renderScale: 0.9,
    shadowMapSize: 1024,
    shadowDistance: 72,
    particleBudgetRatio: 0.6,
    bloomEnabled: false,
    drawDistance: 220,
    aiMidIntervalSec: 0.14,
    lodBias: 0.85,
  },
  high: {
    tier: 'high',
    renderScale: 1.0,
    shadowMapSize: 2048,
    shadowDistance: 105,
    particleBudgetRatio: 0.85,
    bloomEnabled: true,
    drawDistance: 300,
    aiMidIntervalSec: 0.1,
    lodBias: 1.0,
  },
  ultra: {
    tier: 'ultra',
    renderScale: 1.0,
    shadowMapSize: 2048,
    shadowDistance: 135,
    particleBudgetRatio: 1.0,
    bloomEnabled: true,
    drawDistance: 380,
    aiMidIntervalSec: 0.08,
    lodBias: 1.2,
  },
};

const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high', 'ultra'];

const EFFECTS_BUDGET_MAP: Record<SubQualityLevel, number> = {
  low: 0.35,
  medium: 0.65,
  high: 1.0,
};

const DRAW_DISTANCE_MAP: Record<Exclude<DrawDistanceSetting, 'auto'>, number> = {
  short: 150,
  medium: 220,
  long: 300,
  ultra: 380,
};

export type GovernorSettingsConstraints = Pick<
  GraphicsSettings,
  | 'quality'
  | 'qualityMode'
  | 'adaptiveGovernor'
  | 'shadowsEnabled'
  | 'bloomEnabled'
  | 'renderScale'
  | 'effectsQuality'
  | 'drawDistance'
>;

export class PerformanceGovernor {
  private currentTier: QualityTier = 'high';
  private maxAllowedTier: QualityTier = 'ultra';
  private activeProfile: GovernorProfile = { ...PROFILES.high };
  private settingsConstraints: GovernorSettingsConstraints | null = null;
  private frameWindow = new Float32Array(120);
  private cpuWindow = new Float32Array(120);
  private writeIdx = 0;
  private filled = 0;
  private degradeAccumSec = 0;
  private recoverAccumSec = 0;

  private targetFps: 60 | 90 | 120 = 60;
  private transitionCooldownSec = 0;

  constructor(
    initialTier: QualityTier = 'high',
    private adaptiveEnabled = true
  ) {
    this.setBaseTier(initialTier);
  }

  configureFromSettings(
    graphics: GovernorSettingsConstraints & { fpsCap?: 0 | 30 | 60 | 120; targetRefreshRate?: 60 | 90 | 120 }
  ): void {
    this.settingsConstraints = { ...graphics };
    this.adaptiveEnabled = graphics.adaptiveGovernor;
    this.maxAllowedTier = graphics.qualityMode === 'manual' ? graphics.quality : 'ultra';
    if (graphics.targetRefreshRate === 90 || graphics.targetRefreshRate === 120) {
      this.targetFps = graphics.targetRefreshRate;
    } else if (graphics.fpsCap === 120) {
      this.targetFps = 120;
    } else {
      this.targetFps = 60;
    }
    this.setBaseTier(graphics.quality);
  }

  setTargetRefreshRate(fps: 60 | 90 | 120): void {
    this.targetFps = fps;
  }

  getTargetRefreshRate(): 60 | 90 | 120 {
    return this.targetFps;
  }

  setBaseTier(tier: QualityTier): void {
    this.currentTier = tier;
    this.activeProfile = this.applyConstraints({ ...PROFILES[tier] });
    this.degradeAccumSec = 0;
    this.recoverAccumSec = 0;
    this.transitionCooldownSec = 0;
  }

  setAdaptiveEnabled(enabled: boolean): void {
    this.adaptiveEnabled = enabled;
  }

  private applyConstraints(base: GovernorProfile): GovernorProfile {
    const c = this.settingsConstraints;
    if (!c) return base;

    const effectiveRenderScale =
      c.qualityMode === 'manual'
        ? Math.min(base.renderScale, c.renderScale)
        : Math.min(base.renderScale, c.renderScale);

    const effectsCap = EFFECTS_BUDGET_MAP[c.effectsQuality];
    const effectiveParticles = Math.min(base.particleBudgetRatio, effectsCap);

    const drawCap =
      c.drawDistance === 'auto' ? base.drawDistance : Math.min(base.drawDistance, DRAW_DISTANCE_MAP[c.drawDistance]);

    return {
      ...base,
      renderScale: Number(Math.max(0.5, effectiveRenderScale).toFixed(2)),
      shadowMapSize: c.shadowsEnabled ? base.shadowMapSize : 0,
      bloomEnabled: c.bloomEnabled ? base.bloomEnabled : false,
      particleBudgetRatio: Number(Math.max(0.2, effectiveParticles).toFixed(2)),
      drawDistance: drawCap,
    };
  }

  recordSample(frameDeltaMs: number, cpuWorkMs: number, dtSec: number): boolean {
    this.frameWindow[this.writeIdx] = frameDeltaMs;
    this.cpuWindow[this.writeIdx] = cpuWorkMs;
    this.writeIdx = (this.writeIdx + 1) % this.frameWindow.length;
    if (this.filled < this.frameWindow.length) this.filled++;

    if (this.transitionCooldownSec > 0) {
      this.transitionCooldownSec = Math.max(0, this.transitionCooldownSec - dtSec);
    }

    if (!this.adaptiveEnabled || this.filled < 60 || this.transitionCooldownSec > 0) return false;

    let frameSum = 0;
    let cpuSum = 0;
    for (let i = 0; i < this.filled; i++) {
      frameSum += this.frameWindow[i];
      cpuSum += this.cpuWindow[i];
    }
    const avgFrameMs = frameSum / this.filled;
    const avgCpuMs = cpuSum / this.filled;

    // Target budget scales with 60 / 90 / 120 FPS profile (with wide hysteresis deadband)
    const budgetMs = 1000 / this.targetFps;
    const degradeThresholdMs = budgetMs * 1.14; // e.g., 19.0ms @ 60Hz, 12.66ms @ 90Hz, 9.5ms @ 120Hz
    const recoverThresholdMs = budgetMs * 0.81; // e.g., 13.5ms @ 60Hz, 9.0ms @ 90Hz, 6.75ms @ 120Hz

    // Step down only after sustained > degradeThresholdMs over 2.5s
    if (avgFrameMs > degradeThresholdMs) {
      this.degradeAccumSec += dtSec;
      this.recoverAccumSec = 0;
      if (this.degradeAccumSec >= 2.5) {
        this.degradeAccumSec = 0;
        const idx = TIER_ORDER.indexOf(this.currentTier);
        if (idx > 0) {
          const nextTier = TIER_ORDER[idx - 1];
          this.currentTier = nextTier;
          const nextProfile = { ...PROFILES[nextTier] };
          // If CPU bound specifically, keep render scale slightly sharper while throttling AI/particles
          if (avgCpuMs > budgetMs * 0.66 && nextTier === 'medium') {
            nextProfile.renderScale = 0.95;
            nextProfile.aiMidIntervalSec = 0.22;
          }
          this.activeProfile = this.applyConstraints(nextProfile);
          this.transitionCooldownSec = 3.5;
          return true;
        }
      }
    } else if (avgFrameMs < recoverThresholdMs) {
      // Step up only after sustained headroom < recoverThresholdMs over 6.0s, never exceeding maxAllowedTier
      this.recoverAccumSec += dtSec;
      this.degradeAccumSec = 0;
      if (this.recoverAccumSec >= 6.0) {
        this.recoverAccumSec = 0;
        const idx = TIER_ORDER.indexOf(this.currentTier);
        const maxIdx = TIER_ORDER.indexOf(this.maxAllowedTier);
        if (idx < maxIdx) {
          const nextTier = TIER_ORDER[idx + 1];
          this.currentTier = nextTier;
          this.activeProfile = this.applyConstraints({ ...PROFILES[nextTier] });
          this.transitionCooldownSec = 4.0;
          return true;
        }
      }
    } else {
      this.degradeAccumSec = Math.max(0, this.degradeAccumSec - dtSec * 0.5);
      this.recoverAccumSec = Math.max(0, this.recoverAccumSec - dtSec * 0.5);
    }

    return false;
  }

  getProfile(): GovernorProfile {
    return this.activeProfile;
  }

  getTier(): QualityTier {
    return this.currentTier;
  }
}

