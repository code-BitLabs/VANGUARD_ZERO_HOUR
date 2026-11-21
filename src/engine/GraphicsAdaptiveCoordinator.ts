import { AssetManager } from '@/src/core/AssetManager';
import { BattlefieldVfxSystem } from '@/src/effects/BattlefieldVfxSystem';
import { SurfaceDecalManager } from '@/src/effects/SurfaceDecalManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { GraphicsSettings } from '@/src/schemas/settings.schema';
import { settingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { SceneLights } from '@/src/world/LightingRig';
import { GameLoop } from './GameLoop';
import { detectGpuCapability, GpuCapabilityReport } from './GpuCapabilityDetector';
import { PerformanceGovernor } from './PerformanceGovernor';
import { PerformanceMonitor } from './PerformanceMonitor';
import { EngineRenderer } from './Renderer';
import { DirectorTelemetrySnapshot } from './RenderingQualityDirector';

export interface GraphicsSyncDependencies {
  readonly renderer: EngineRenderer;
  readonly governor: PerformanceGovernor;
  readonly assetManager: AssetManager;
  readonly battlefieldVfx: BattlefieldVfxSystem;
  readonly surfaceDecals: SurfaceDecalManager;
  readonly vfx: VFXPool;
  readonly loop: GameLoop;
  readonly getLights: () => SceneLights | null;
}

/**
 * AUD-12: Single-authority coordinator between GPU capability probing,
 * user GraphicsSettings, RenderingQualityDirector, and PerformanceGovernor.
 */
export class GraphicsAdaptiveCoordinator {
  private gpuReport: GpuCapabilityReport | null = null;
  private initialProbeFrames: number[] = [];
  private initialProbeSettled = false;

  constructor(private readonly deps: GraphicsSyncDependencies) {}

  initializeInitialProfile(): GpuCapabilityReport {
    const { renderer, governor, assetManager, battlefieldVfx, surfaceDecals } = this.deps;
    const report = detectGpuCapability(renderer.renderer);
    this.gpuReport = report;
    renderer.qualityDirector.setHardwareProfile(report.hardwareProfile);

    const initialGraphics = settingsStore.getState().graphics;
    if (!initialGraphics.autoDetectedPresetApplied && initialGraphics.qualityMode === 'auto') {
      settingsStore.getState().applyAutoDetectedGraphics(report.recommendedSettings);
    }

    const settings = settingsStore.getState();
    renderer.qualityDirector.syncFromGraphicsSettings(settings.graphics);
    renderer.applyDirectorDimensions(
      settings.graphics.maxDpr,
      this.deps.getLights(),
      settings.graphics.shadowsEnabled
    );

    const initDims = renderer.qualityDirector.getActiveDimensions();
    battlefieldVfx.setDensityScales(initDims.particleDensityScale, initDims.rainDensityScale);
    surfaceDecals.setBudget(initDims.decalBudget);
    governor.configureFromSettings(settings.graphics);
    assetManager.setTextureQuality(settings.graphics.textureQuality);
    renderer.applyGovernorProfile(
      governor.getProfile(),
      settings.graphics.shadowsEnabled,
      settings.graphics.bloomEnabled,
      this.deps.getLights()
    );
    return report;
  }

  getGpuCapabilityReport(): GpuCapabilityReport | null {
    return this.gpuReport;
  }

  reapplyAutoGraphics(): GpuCapabilityReport {
    const probeAvg =
      this.initialProbeFrames.length > 8
        ? this.initialProbeFrames.slice(5).reduce((a, b) => a + b, 0) /
          Math.max(1, this.initialProbeFrames.length - 5)
        : null;
    const report = detectGpuCapability(this.deps.renderer.renderer, probeAvg);
    this.gpuReport = report;
    settingsStore.getState().applyAutoDetectedGraphics(report.recommendedSettings);
    return report;
  }

  getQualityTelemetry(): DirectorTelemetrySnapshot {
    return this.deps.renderer.qualityDirector.getTelemetry();
  }

  applyGraphicsSettings(graphics: GraphicsSettings, allowCsmRebuild = true): void {
    const { renderer, governor, assetManager, battlefieldVfx, surfaceDecals, vfx, loop } = this.deps;
    const isPlaying = uiStore.getState().screen === 'playing';
    const lights = this.deps.getLights();

    governor.configureFromSettings(graphics);
    governor.setTargetRefreshRate(graphics.targetRefreshRate ?? 60);
    renderer.setRendererBackendPreference(graphics.rendererBackend ?? 'auto');
    renderer.qualityDirector.syncFromGraphicsSettings(graphics);
    renderer.applyDirectorDimensions(graphics.maxDpr, lights, graphics.shadowsEnabled, {
      allowCsmRebuild,
      deferResize: isPlaying,
    });

    const activeDims = renderer.qualityDirector.getActiveDimensions();
    battlefieldVfx.setDensityScales(
      activeDims.particleDensityScale,
      activeDims.rainDensityScale
    );
    surfaceDecals.setBudget(activeDims.decalBudget);
    assetManager.setTextureQuality(graphics.textureQuality);
    loop.setFpsCap(graphics.fpsCap);

    const effProf = governor.getProfile();
    vfx.setBudgetRatio(effProf.particleBudgetRatio);
    if (graphics.qualityProfile !== 'auto_adaptive') {
      renderer.applyGovernorProfile(
        effProf,
        graphics.shadowsEnabled,
        graphics.bloomEnabled,
        lights,
        { deferResize: isPlaying }
      );
    }
  }

  recordFrameAndAdapt(frameMs: number, monitor: PerformanceMonitor, dt: number): void {
    const { renderer, governor, battlefieldVfx, surfaceDecals, vfx } = this.deps;
    const lights = this.deps.getLights();

    if (!this.initialProbeSettled) {
      this.initialProbeFrames.push(frameMs);
      if (this.initialProbeFrames.length >= 45) {
        this.initialProbeSettled = true;
        const steady = this.initialProbeFrames.slice(5);
        const avgProbeMs = steady.reduce((a, b) => a + b, 0) / Math.max(1, steady.length);
        // Record refined GPU capability report without triggering mid-combat CSM rebuild/blinks
        this.gpuReport = detectGpuCapability(renderer.renderer, avgProbeMs);
      }
    }

    const drawInfo = renderer.getDrawInfo();
    const graphicsSettings = settingsStore.getState().graphics;
    const directorChanged = renderer.qualityDirector.recordFrame({
      cpuFrameMs: frameMs,
      drawCalls: drawInfo.calls,
      triangles: drawInfo.triangles,
      geometriesCount: drawInfo.geometries,
      texturesCount: drawInfo.textures,
    });
    if (directorChanged) {
      const dims = renderer.qualityDirector.getActiveDimensions();
      renderer.applyDirectorDimensions(dims.maxDpr, lights, graphicsSettings.shadowsEnabled, {
        allowCsmRebuild: false,
        deferResize: true,
      });
      battlefieldVfx.setDensityScales(dims.particleDensityScale, dims.rainDensityScale);
      surfaceDecals.setBudget(dims.decalBudget);
    }

    const changed = governor.recordSample(frameMs, monitor.getCpuTimeMs(), dt);
    if (changed) {
      const prof = governor.getProfile();
      vfx.setBudgetRatio(prof.particleBudgetRatio);
      // In auto_adaptive mode, RenderingQualityDirector owns renderer visual scaling so
      // PerformanceGovernor does not fight it or trigger redundant resizes/blinks.
      if (graphicsSettings.qualityProfile !== 'auto_adaptive') {
        renderer.applyGovernorProfile(
          prof,
          graphicsSettings.shadowsEnabled,
          graphicsSettings.bloomEnabled,
          lights,
          { deferResize: true, allowShadowToggle: false }
        );
      }
    }
  }
}
