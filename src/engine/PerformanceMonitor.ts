import { ResourceManager } from '@/src/core/ResourceManager';
import { PerformanceTelemetrySnapshot } from '@/src/gameplay/CombatTelemetryRecorder';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { EngineRenderer } from './Renderer';
import { PerformanceGovernor } from './PerformanceGovernor';

export type SubsystemPhase =
  | 'physics'
  | 'ai'
  | 'gameplay'
  | 'projectilesFlight'
  | 'explosions'
  | 'ballistics'
  | 'render'
  | 'audio'
  | 'ui';

export class PerformanceMonitor {
  private phases: Record<SubsystemPhase, number> = {
    physics: 0,
    ai: 0,
    gameplay: 0,
    projectilesFlight: 0,
    explosions: 0,
    ballistics: 0,
    render: 0,
    audio: 0,
    ui: 0,
  };

  private accumSec = 0;
  private frameCount = 0;
  private smoothedFrameMs = 16.6;
  private frameHistory: number[] = [];
  private fpsHistory: number[] = [];
  private minFps = 60;
  private maxFps = 60;
  private spikeCount = 0;
  private lastSpikeMs = 0;
  private lastSpikeSubsystem = 'none';
  private missionElapsedSec = 0;
  private lastSpikeAtSec = -999;
  private latestSnapshot: PerformanceTelemetrySnapshot = {
    fps: 60,
    avgFps: 60,
    minFps: 60,
    maxFps: 60,
    frameMs: 16.6,
    avgFrameMs: 16.6,
    p95FrameMs: 16.6,
    p99FrameMs: 16.6,
    cpuTimeMs: 0,
    phases: {
      ai: 0,
      ballistics: 0,
      physics: 0,
      projectilesFlight: 0,
      explosions: 0,
      render: 0,
      audio: 0,
      ui: 0,
    },
    drawCalls: 0,
    triangles: 0,
    spikeCount: 0,
    lastSpikeMs: 0,
    lastSpikeAgeSec: 999,
    lastSpikeSubsystem: 'none',
    governorTier: 'high',
    renderScale: 1,
    fps1PercentLow: 60,
    renderWidth: 1280,
    renderHeight: 720,
    pixelRatio: 1,
    memoryUsedMb: null,
    gpuTimerNote: 'WebGL2 CPU draw/triangle counters (hardware GPU timer query unavailable in browser)',
  };

  reset(): void {
    this.accumSec = 0;
    this.frameCount = 0;
    this.smoothedFrameMs = 16.6;
    this.frameHistory = [];
    this.fpsHistory = [];
    this.minFps = 60;
    this.maxFps = 60;
    this.spikeCount = 0;
    this.lastSpikeMs = 0;
    this.lastSpikeSubsystem = 'none';
    this.missionElapsedSec = 0;
    this.lastSpikeAtSec = -999;
  }

  recordPhase(phase: SubsystemPhase, ms: number): void {
    this.phases[phase] = ms;
  }

  getCpuTimeMs(): number {
    return (
      this.phases.physics +
      this.phases.ai +
      this.phases.gameplay +
      this.phases.projectilesFlight +
      this.phases.explosions +
      this.phases.render +
      this.phases.audio +
      this.phases.ui
    );
  }

  getLatestTelemetry(): PerformanceTelemetrySnapshot {
    return this.latestSnapshot;
  }

  tick(
    dtSec: number,
    frameMs: number,
    renderer: EngineRenderer,
    resourceManager: ResourceManager,
    governor: PerformanceGovernor,
    activePooledVfx: number,
    activeAudioVoices: number,
    activeEnemies: number
  ): void {
    this.missionElapsedSec += dtSec;
    this.smoothedFrameMs = this.smoothedFrameMs * 0.9 + frameMs * 0.1;
    this.frameHistory.push(frameMs);
    if (this.frameHistory.length > 180) {
      this.frameHistory.shift();
    }

    // Ignore initial 1.5s mission-load / WebGL shader warmup frames
    if (this.missionElapsedSec >= 1.5 && frameMs > 28.0) {
      this.spikeCount++;
      this.lastSpikeMs = Number(frameMs.toFixed(2));
      this.lastSpikeAtSec = this.missionElapsedSec;
      let worstPhase = 'render';
      let worstMs = -1;
      for (const [k, v] of Object.entries(this.phases)) {
        if (v > worstMs) {
          worstMs = v;
          worstPhase = k;
        }
      }
      this.lastSpikeSubsystem = worstPhase;
    }

    this.accumSec += dtSec;
    this.frameCount++;

    if (this.accumSec >= 0.4) {
      const fps = Math.max(1, Math.round(this.frameCount / this.accumSec));
      this.accumSec = 0;
      this.frameCount = 0;

      this.fpsHistory.push(fps);
      if (this.fpsHistory.length > 60) {
        this.fpsHistory.shift();
      }
      if (fps < this.minFps) this.minFps = fps;
      if (fps > this.maxFps) this.maxFps = fps;
      const avgFps = Math.round(
        this.fpsHistory.reduce((acc, v) => acc + v, 0) / Math.max(1, this.fpsHistory.length)
      );

      const sorted = [...this.frameHistory].sort((a, b) => a - b);
      const n = sorted.length;
      const avgFrameMs = n > 0 ? sorted.reduce((a, b) => a + b, 0) / n : this.smoothedFrameMs;
      const p95FrameMs = n > 0 ? sorted[Math.min(n - 1, Math.floor(n * 0.95))] : this.smoothedFrameMs;
      const p99FrameMs = n > 0 ? sorted[Math.min(n - 1, Math.floor(n * 0.99))] : this.smoothedFrameMs;
      const fps1PercentLow = Math.max(1, Math.round(1000 / Math.max(1, p99FrameMs)));

      const drawInfo = renderer.getDrawInfo();
      const renderMetrics = renderer.getRenderMetrics();
      const resSnap = resourceManager.getSnapshot();
      const profile = governor.getProfile();
      const lastSpikeAgeSec =
        this.lastSpikeAtSec >= 0 ? Number((this.missionElapsedSec - this.lastSpikeAtSec).toFixed(1)) : 999;

      const perfMem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
      const memoryUsedMb =
        perfMem && typeof perfMem.usedJSHeapSize === 'number'
          ? Number((perfMem.usedJSHeapSize / (1024 * 1024)).toFixed(1))
          : null;

      this.latestSnapshot = {
        fps,
        avgFps,
        minFps: this.minFps,
        maxFps: this.maxFps,
        fps1PercentLow,
        frameMs: Number(this.smoothedFrameMs.toFixed(2)),
        avgFrameMs: Number(avgFrameMs.toFixed(2)),
        p95FrameMs: Number(p95FrameMs.toFixed(2)),
        p99FrameMs: Number(p99FrameMs.toFixed(2)),
        cpuTimeMs: Number(this.getCpuTimeMs().toFixed(2)),
        phases: {
          ai: Number(this.phases.ai.toFixed(2)),
          ballistics: Number(this.phases.ballistics.toFixed(2)),
          physics: Number(this.phases.physics.toFixed(2)),
          projectilesFlight: Number(this.phases.projectilesFlight.toFixed(2)),
          explosions: Number(this.phases.explosions.toFixed(2)),
          render: Number(this.phases.render.toFixed(2)),
          audio: Number(this.phases.audio.toFixed(2)),
          ui: Number(this.phases.ui.toFixed(2)),
        },
        drawCalls: drawInfo.calls,
        triangles: drawInfo.triangles,
        spikeCount: this.spikeCount,
        lastSpikeMs: this.lastSpikeMs,
        lastSpikeAgeSec,
        lastSpikeSubsystem: this.lastSpikeSubsystem,
        governorTier: governor.getTier(),
        renderScale: profile.renderScale,
        renderWidth: renderMetrics.renderWidth,
        renderHeight: renderMetrics.renderHeight,
        pixelRatio: renderMetrics.pixelRatio,
        memoryUsedMb,
        gpuTimerNote: 'WebGL2 CPU draw/triangle counters (hardware GPU timer query unavailable in browser)',
      };

      gameSessionStore.getState().updateDiagnostics({
        fps,
        fps1PercentLow,
        frameMs: Number(this.smoothedFrameMs.toFixed(2)),
        physicsMs: Number(this.phases.physics.toFixed(2)),
        aiMs: Number(this.phases.ai.toFixed(2)),
        gameplayMs: Number(this.phases.gameplay.toFixed(2)),
        renderSubmitMs: Number(this.phases.render.toFixed(2)),
        drawCalls: drawInfo.calls,
        triangles: drawInfo.triangles,
        activeGeometries: drawInfo.geometries,
        activeTextures: drawInfo.textures,
        activeSharedRes: resSnap.sharedCount,
        activeMissionRes: resSnap.missionCount,
        activePooledVfx,
        activeAudioVoices,
        activeEnemies,
        renderScale: profile.renderScale,
        governorTier: governor.getTier(),
        renderWidth: renderMetrics.renderWidth,
        renderHeight: renderMetrics.renderHeight,
        pixelRatio: renderMetrics.pixelRatio,
        memoryUsedMb,
      });
    }
  }
}
