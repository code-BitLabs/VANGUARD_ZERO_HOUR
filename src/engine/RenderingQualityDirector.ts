import {
  GraphicsSettings,
  HardwareCapabilityProfile,
  QualityPresetProfile,
  ShadowMapResolution,
} from '@/src/schemas/settings.schema';

export interface ActiveVisualDimensions {
  // Priority 1 — Protected Core (always preserved for combat readability)
  enemySilhouetteClarity: 'protected';
  weaponCharacterPbr: 'protected';
  // Priority 2 — Dynamic Resolution Floor
  renderScale: number;
  maxDpr: number;
  // Priority 3 — Shadows & AO
  csmCascades: number;
  shadowMapSize: ShadowMapResolution;
  ambientOcclusion: boolean;
  // Priority 4 — Atmosphere & Reflections
  volumetricFog: boolean;
  wetReflections: boolean;
  decalBudget: number;
  // Priority 5 — Peripheral VFX (degraded first)
  bloomEnabled: boolean;
  colorGrading: boolean;
  particleDensityScale: number;
  rainDensityScale: number;
}

export interface DirectorTelemetrySnapshot {
  hardwareProfile: HardwareCapabilityProfile;
  activeQualityProfile: QualityPresetProfile;
  autoAdaptiveActive: boolean;
  degradationStep: number; // 0 = full profile, 1..6 = independent dimension steps down
  cpuFrameMsP50: number;
  cpuFrameMsP95: number;
  cpuFrameMsP99: number;
  fpsEstimate: number;
  drawCalls: number;
  triangles: number;
  estimatedGeometryMemoryMb: number;
  estimatedTextureMemoryMb: number;
  gpuTimerQueryAvailable: boolean;
  activeReductions: string[];
  advisoryMessage: string | null;
  dimensions: ActiveVisualDimensions;
}

export const HARDWARE_PROFILE_DEFAULTS: Record<HardwareCapabilityProfile, ActiveVisualDimensions> = {
  high_end_desktop: {
    enemySilhouetteClarity: 'protected',
    weaponCharacterPbr: 'protected',
    renderScale: 1.0,
    maxDpr: 2.0,
    csmCascades: 4,
    shadowMapSize: 2048,
    ambientOcclusion: true,
    volumetricFog: true,
    wetReflections: true,
    decalBudget: 224,
    bloomEnabled: true,
    colorGrading: true,
    particleDensityScale: 1.0,
    rainDensityScale: 1.0,
  },
  mid_range_desktop: {
    enemySilhouetteClarity: 'protected',
    weaponCharacterPbr: 'protected',
    renderScale: 1.0,
    maxDpr: 1.75,
    csmCascades: 3,
    shadowMapSize: 1024,
    ambientOcclusion: true,
    volumetricFog: true,
    wetReflections: true,
    decalBudget: 128,
    bloomEnabled: true,
    colorGrading: true,
    particleDensityScale: 0.9,
    rainDensityScale: 0.85,
  },
  integrated_gpu: {
    enemySilhouetteClarity: 'protected',
    weaponCharacterPbr: 'protected',
    renderScale: 0.9,
    maxDpr: 1.25,
    csmCascades: 2,
    shadowMapSize: 1024,
    ambientOcclusion: false,
    volumetricFog: true,
    wetReflections: false,
    decalBudget: 80,
    bloomEnabled: true,
    colorGrading: true,
    particleDensityScale: 0.72,
    rainDensityScale: 0.65,
  },
  mid_range_mobile: {
    enemySilhouetteClarity: 'protected',
    weaponCharacterPbr: 'protected',
    renderScale: 0.88,
    maxDpr: 1.35,
    csmCascades: 2,
    shadowMapSize: 1024,
    ambientOcclusion: false,
    volumetricFog: false,
    wetReflections: false,
    decalBudget: 64,
    bloomEnabled: false,
    colorGrading: true,
    particleDensityScale: 0.65,
    rainDensityScale: 0.55,
  },
  low_end_mobile: {
    enemySilhouetteClarity: 'protected',
    weaponCharacterPbr: 'protected',
    renderScale: 0.75,
    maxDpr: 1.0,
    csmCascades: 1,
    shadowMapSize: 512,
    ambientOcclusion: false,
    volumetricFog: false,
    wetReflections: false,
    decalBudget: 32,
    bloomEnabled: false,
    colorGrading: true,
    particleDensityScale: 0.45,
    rainDensityScale: 0.35,
  },
  software_webgl: {
    enemySilhouetteClarity: 'protected',
    weaponCharacterPbr: 'protected',
    renderScale: 0.7,
    maxDpr: 1.0,
    csmCascades: 1,
    shadowMapSize: 512,
    ambientOcclusion: false,
    volumetricFog: false,
    wetReflections: false,
    decalBudget: 24,
    bloomEnabled: false,
    colorGrading: false,
    particleDensityScale: 0.35,
    rainDensityScale: 0.25,
  },
};

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 16.67;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

/**
 * Multi-Objective Adaptive Cinematic Rendering Director.
 * - Tracks CPU frame-time percentiles (P50 / P95 / P99), draw calls, triangles, and memory estimates.
 * - Uses stabilization windows (3s), step cooldowns (5s), and hysteresis deadbands to prevent oscillation.
 * - Degrades independent visual dimensions in priority order (Peripheral VFX -> Atmosphere -> Shadows -> Scale),
 *   strictly protecting combat readability (enemy silhouettes & weapon/character PBR).
 * - Never silently overrides Manual / Preset user graphics selections.
 */
export class RenderingQualityDirector {
  private readonly frameSamplesMs: number[] = [];
  private readonly maxSamples = 180;
  private hardwareProfile: HardwareCapabilityProfile;
  private qualityProfile: QualityPresetProfile = 'auto_adaptive';
  private baseDimensions: ActiveVisualDimensions;
  private activeDimensions: ActiveVisualDimensions;
  private degradationStep = 0; // 0..6
  private elapsedSec = 0;
  private sustainedPressureSec = 0;
  private sustainedHeadroomSec = 0;
  private lastTransitionSec = -999;
  private targetFrameBudgetMs = 16.67;
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private estimatedGeometryMb = 12;
  private estimatedTextureMb = 28;
  private gpuTimerQueryAvailable = false;

  private readonly stabilizationWindowSec = 3.0;
  private readonly stepCooldownSec = 5.0;

  constructor(hardwareProfile: HardwareCapabilityProfile = 'mid_range_desktop') {
    this.hardwareProfile = hardwareProfile;
    this.baseDimensions = { ...HARDWARE_PROFILE_DEFAULTS[hardwareProfile] };
    this.activeDimensions = { ...this.baseDimensions };
  }

  public setHardwareProfile(profile: HardwareCapabilityProfile, gpuTimerQueryAvailable = false): void {
    this.hardwareProfile = profile;
    this.gpuTimerQueryAvailable = gpuTimerQueryAvailable;
    if (this.qualityProfile === 'auto_adaptive') {
      this.baseDimensions = { ...HARDWARE_PROFILE_DEFAULTS[profile] };
      this.recomputeDimensions();
    }
  }

  public syncFromGraphicsSettings(gfx: GraphicsSettings): void {
    this.qualityProfile = gfx.qualityProfile;
    this.targetFrameBudgetMs = 1000 / Math.max(30, gfx.targetRefreshRate || 60);

    if (gfx.qualityProfile === 'auto_adaptive') {
      this.baseDimensions = { ...HARDWARE_PROFILE_DEFAULTS[this.hardwareProfile] };
    } else {
      // Manual / Cinematic / Balanced / Performance / Custom: lock player choices strictly
      this.degradationStep = 0;
      this.sustainedPressureSec = 0;
      this.sustainedHeadroomSec = 0;
      this.baseDimensions = {
        enemySilhouetteClarity: 'protected',
        weaponCharacterPbr: 'protected',
        renderScale: gfx.renderScale,
        maxDpr: gfx.maxDpr,
        csmCascades: gfx.shadowsEnabled ? gfx.csmCascades : 1,
        shadowMapSize: gfx.shadowMapSize,
        ambientOcclusion: gfx.ambientOcclusion,
        volumetricFog: gfx.volumetricFog,
        wetReflections: gfx.wetReflections,
        decalBudget: gfx.decalBudget,
        bloomEnabled: gfx.bloomEnabled,
        colorGrading: gfx.colorGrading,
        particleDensityScale:
          gfx.effectsQuality === 'high' ? 1.0 : gfx.effectsQuality === 'medium' ? 0.72 : 0.45,
        rainDensityScale:
          gfx.effectsQuality === 'high' ? 1.0 : gfx.effectsQuality === 'medium' ? 0.68 : 0.38,
      };
    }
    this.recomputeDimensions();
  }

  public recordFrame(metrics: {
    cpuFrameMs: number;
    drawCalls: number;
    triangles: number;
    geometriesCount?: number;
    texturesCount?: number;
  }): boolean {
    const dtSec = Math.max(0.004, Math.min(0.15, metrics.cpuFrameMs / 1000));
    this.elapsedSec += dtSec;
    this.lastDrawCalls = metrics.drawCalls;
    this.lastTriangles = metrics.triangles;
    if (metrics.geometriesCount !== undefined) {
      this.estimatedGeometryMb = Number((metrics.geometriesCount * 0.085).toFixed(1));
    }
    if (metrics.texturesCount !== undefined) {
      this.estimatedTextureMb = Number((metrics.texturesCount * 0.62).toFixed(1));
    }

    this.frameSamplesMs.push(Math.max(2, Math.min(120, metrics.cpuFrameMs)));
    if (this.frameSamplesMs.length > this.maxSamples) {
      this.frameSamplesMs.shift();
    }

    // Strict Lock: only automatically mutate dimensions when qualityProfile === 'auto_adaptive'
    if (this.qualityProfile !== 'auto_adaptive') {
      return false;
    }

    const sorted = [...this.frameSamplesMs].sort((a, b) => a - b);
    const p95 = computePercentile(sorted, 0.95);
    const degradeThreshold = this.targetFrameBudgetMs * 1.24; // Hysteresis upper bound
    const recoverThreshold = this.targetFrameBudgetMs * 0.82; // Hysteresis lower bound

    if (p95 > degradeThreshold) {
      this.sustainedPressureSec += dtSec;
      this.sustainedHeadroomSec = 0;
    } else if (p95 < recoverThreshold) {
      this.sustainedHeadroomSec += dtSec;
      this.sustainedPressureSec = 0;
    } else {
      // Inside hysteresis deadband: decay timers slowly
      this.sustainedPressureSec = Math.max(0, this.sustainedPressureSec - dtSec * 0.5);
      this.sustainedHeadroomSec = Math.max(0, this.sustainedHeadroomSec - dtSec * 0.5);
    }

    const cooldownSatisfied = this.elapsedSec - this.lastTransitionSec >= this.stepCooldownSec;
    if (!cooldownSatisfied) return false;

    if (this.sustainedPressureSec >= this.stabilizationWindowSec && this.degradationStep < 6) {
      this.degradationStep += 1;
      this.sustainedPressureSec = 0;
      this.lastTransitionSec = this.elapsedSec;
      this.recomputeDimensions();
      return true;
    }

    if (this.sustainedHeadroomSec >= this.stabilizationWindowSec * 1.5 && this.degradationStep > 0) {
      this.degradationStep -= 1;
      this.sustainedHeadroomSec = 0;
      this.lastTransitionSec = this.elapsedSec;
      this.recomputeDimensions();
      return true;
    }

    return false;
  }

  public getActiveDimensions(): ActiveVisualDimensions {
    return { ...this.activeDimensions };
  }

  public getTelemetry(): DirectorTelemetrySnapshot {
    const sorted = [...this.frameSamplesMs].sort((a, b) => a - b);
    const p50 = Number(computePercentile(sorted, 0.5).toFixed(2));
    const p95 = Number(computePercentile(sorted, 0.95).toFixed(2));
    const p99 = Number(computePercentile(sorted, 0.99).toFixed(2));
    const fpsEstimate = Math.round(1000 / Math.max(4, p50));

    const reductions = this.describeActiveReductions();
    const advisoryMessage =
      this.qualityProfile !== 'auto_adaptive' && p95 > this.targetFrameBudgetMs * 1.35
        ? `Manual "${this.qualityProfile}" profile locked (P95 ${p95}ms > ${this.targetFrameBudgetMs.toFixed(1)}ms target). Switch to Auto Adaptive or reduce shadows/volumetrics if needed.`
        : null;

    return {
      hardwareProfile: this.hardwareProfile,
      activeQualityProfile: this.qualityProfile,
      autoAdaptiveActive: this.qualityProfile === 'auto_adaptive',
      degradationStep: this.degradationStep,
      cpuFrameMsP50: p50,
      cpuFrameMsP95: p95,
      cpuFrameMsP99: p99,
      fpsEstimate,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      estimatedGeometryMemoryMb: this.estimatedGeometryMb,
      estimatedTextureMemoryMb: this.estimatedTextureMb,
      gpuTimerQueryAvailable: this.gpuTimerQueryAvailable,
      activeReductions: reductions,
      advisoryMessage,
      dimensions: { ...this.activeDimensions },
    };
  }

  private recomputeDimensions(): void {
    const d: ActiveVisualDimensions = { ...this.baseDimensions };
    const step = this.qualityProfile === 'auto_adaptive' ? this.degradationStep : 0;

    // Step 1: Peripheral VFX (bloom & debris density) — Priority 5
    if (step >= 1) {
      d.bloomEnabled = false;
      d.particleDensityScale = Math.min(d.particleDensityScale, 0.72);
      d.rainDensityScale = Math.min(d.rainDensityScale, 0.65);
    }
    // Step 2: Atmospheric extras & distant decal budget — Priority 4
    if (step >= 2) {
      d.volumetricFog = false;
      d.wetReflections = false;
      d.decalBudget = Math.min(d.decalBudget, 64);
    }
    // Step 3: Ambient occlusion & cascade trim — Priority 3a
    if (step >= 3) {
      d.ambientOcclusion = false;
      d.csmCascades = Math.min(d.csmCascades, 2);
    }
    // Step 4: Shadow map resolution reduction — Priority 3b
    if (step >= 4) {
      d.shadowMapSize = d.shadowMapSize > 1024 ? 1024 : 512;
      d.particleDensityScale = Math.min(d.particleDensityScale, 0.5);
    }
    // Step 5: Bounded dynamic resolution scale — Priority 2
    if (step >= 5) {
      d.renderScale = Math.max(0.72, Number((d.renderScale * 0.86).toFixed(2)));
      d.maxDpr = Math.min(d.maxDpr, 1.25);
    }
    // Step 6: Minimum safe shadow cascade & render scale floor (Protected Core NEVER touched)
    if (step >= 6) {
      d.csmCascades = 1;
      d.shadowMapSize = 512;
      d.renderScale = Math.max(0.68, Math.min(d.renderScale, 0.75));
      d.decalBudget = Math.min(d.decalBudget, 32);
    }

    this.activeDimensions = d;
  }

  private describeActiveReductions(): string[] {
    if (this.qualityProfile !== 'auto_adaptive' || this.degradationStep === 0) return [];
    const list: string[] = [];
    if (this.degradationStep >= 1) list.push('Peripheral VFX & Bloom trimmed');
    if (this.degradationStep >= 2) list.push('Volumetric fog & wet reflections paused');
    if (this.degradationStep >= 3) list.push('Ambient occlusion off, CSM capped to 2');
    if (this.degradationStep >= 4) list.push('Shadow map resolution stepped down');
    if (this.degradationStep >= 5) list.push(`Dynamic render scale (${Math.round(this.activeDimensions.renderScale * 100)}%)`);
    if (this.degradationStep >= 6) list.push('Single shadow cascade floor (silhouettes & weapon PBR protected)');
    return list;
  }
}
