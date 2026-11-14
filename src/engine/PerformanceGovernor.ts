import { QualityTier } from '@/src/schemas/common.schema';

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

export class PerformanceGovernor {
  private currentTier: QualityTier = 'high';
  private activeProfile: GovernorProfile = { ...PROFILES.high };
  private frameWindow = new Float32Array(120);
  private cpuWindow = new Float32Array(120);
  private writeIdx = 0;
  private filled = 0;
  private degradeAccumSec = 0;
  private recoverAccumSec = 0;

  constructor(
    initialTier: QualityTier = 'high',
    private adaptiveEnabled = true
  ) {
    this.setBaseTier(initialTier);
  }

  setBaseTier(tier: QualityTier): void {
    this.currentTier = tier;
    this.activeProfile = { ...PROFILES[tier] };
    this.degradeAccumSec = 0;
    this.recoverAccumSec = 0;
  }

  setAdaptiveEnabled(enabled: boolean): void {
    this.adaptiveEnabled = enabled;
  }

  recordSample(frameDeltaMs: number, cpuWorkMs: number, dtSec: number): boolean {
    this.frameWindow[this.writeIdx] = frameDeltaMs;
    this.cpuWindow[this.writeIdx] = cpuWorkMs;
    this.writeIdx = (this.writeIdx + 1) % this.frameWindow.length;
    if (this.filled < this.frameWindow.length) this.filled++;

    if (!this.adaptiveEnabled || this.filled < 60) return false;

    let frameSum = 0;
    let cpuSum = 0;
    for (let i = 0; i < this.filled; i++) {
      frameSum += this.frameWindow[i];
      cpuSum += this.cpuWindow[i];
    }
    const avgFrameMs = frameSum / this.filled;
    const avgCpuMs = cpuSum / this.filled;

    // Step down only after sustained > 19ms frame time over 2.5s
    if (avgFrameMs > 19.0) {
      this.degradeAccumSec += dtSec;
      this.recoverAccumSec = 0;
      if (this.degradeAccumSec >= 2.5) {
        this.degradeAccumSec = 0;
        const idx = TIER_ORDER.indexOf(this.currentTier);
        if (idx > 0) {
          const nextTier = TIER_ORDER[idx - 1];
          this.currentTier = nextTier;
          this.activeProfile = { ...PROFILES[nextTier] };
          // If CPU bound specifically, keep render scale slightly sharper while throttling AI/particles
          if (avgCpuMs > 11.0 && nextTier === 'medium') {
            this.activeProfile.renderScale = 0.95;
            this.activeProfile.aiMidIntervalSec = 0.22;
          }
          return true;
        }
      }
    } else if (avgFrameMs < 13.5) {
      // Step up only after sustained headroom < 13.5ms over 6.0s
      this.recoverAccumSec += dtSec;
      this.degradeAccumSec = 0;
      if (this.recoverAccumSec >= 6.0) {
        this.recoverAccumSec = 0;
        const idx = TIER_ORDER.indexOf(this.currentTier);
        if (idx < TIER_ORDER.length - 1) {
          const nextTier = TIER_ORDER[idx + 1];
          this.currentTier = nextTier;
          this.activeProfile = { ...PROFILES[nextTier] };
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
