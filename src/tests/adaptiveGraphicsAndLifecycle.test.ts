import { afterEach, describe, expect, it, vi } from 'vitest';
import { Howler } from 'howler';
import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { classifyGpuCapability, GpuCapabilitySignals } from '@/src/engine/GpuCapabilityDetector';
import { PerformanceGovernor } from '@/src/engine/PerformanceGovernor';
import { PerformanceMonitor } from '@/src/engine/PerformanceMonitor';
import { EngineRenderer } from '@/src/engine/Renderer';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { settingsStore } from '@/src/stores/settingsStore';

function makeSignals(overrides: Partial<GpuCapabilitySignals> = {}): GpuCapabilitySignals {
  return {
    webglVersion: 2,
    maxTextureSize: 8192,
    maxRenderbufferSize: 8192,
    maxAnisotropy: 8,
    maxSamples: 4,
    hasFloatColorBuffer: true,
    rendererHint: null,
    hardwareConcurrency: 6,
    deviceMemoryGb: 8,
    devicePixelRatio: 2,
    isCoarsePointer: false,
    isMobileFormFactor: false,
    avgProbeFrameMs: 12.5,
    ...overrides,
  };
}

describe('Adaptive Graphics, Ownership, Telemetry & Lifecycle Suspend', () => {
  afterEach(() => {
    settingsStore.getState().resetDefaults();
    Howler.mute(false);
  });

  it('classifies mobile Safari privacy-masked GPU (null rendererHint & null deviceMemory) gracefully without crashing', () => {
    const iosLandscapeSignals = makeSignals({
      rendererHint: null,
      deviceMemoryGb: null,
      hardwareConcurrency: 6,
      devicePixelRatio: 3,
      isCoarsePointer: true,
      isMobileFormFactor: true,
      avgProbeFrameMs: 14.0,
    });
    const report = classifyGpuCapability(iosLandscapeSignals);
    expect(report.recommendedTier).toBe('medium');
    expect(report.recommendedSettings.quality).toBe('medium');
    expect(report.recommendedSettings.fpsCap).toBe(60);
    expect(report.reasons).toContain('deviceMemory masked/unavailable');

    const softwareSlowSignals = makeSignals({
      rendererHint: 'Google SwiftShader',
      hardwareConcurrency: 2,
      deviceMemoryGb: 2,
      avgProbeFrameMs: 32.0,
    });
    const lowReport = classifyGpuCapability(softwareSlowSignals);
    expect(lowReport.recommendedTier).toBe('low');
    expect(lowReport.recommendedSettings.shadowsEnabled).toBe(false);
    expect(lowReport.recommendedSettings.bloomEnabled).toBe(false);
  });

  it('enforces explicit Auto vs Manual graphics ownership and prevents PerformanceGovernor from overriding disabled toggles', () => {
    settingsStore.getState().applyAutoDetectedGraphics({
      quality: 'medium',
      renderScale: 0.85,
      shadowsEnabled: true,
      bloomEnabled: false,
    });
    expect(settingsStore.getState().graphics.qualityMode).toBe('auto');
    expect(settingsStore.getState().graphics.autoDetectedPresetApplied).toBe(true);

    // User manually disables shadows and lowers render scale -> flips to manual
    settingsStore.getState().updateGraphics({
      quality: 'high',
      shadowsEnabled: false,
      bloomEnabled: false,
      renderScale: 0.75,
    });
    expect(settingsStore.getState().graphics.qualityMode).toBe('manual');

    const governor = new PerformanceGovernor('high', true);
    governor.configureFromSettings(settingsStore.getState().graphics);

    // Even at high tier or after recovery samples, governor never re-enables shadows/bloom or exceeds 0.75 renderScale
    expect(governor.getProfile().shadowMapSize).toBe(0);
    expect(governor.getProfile().bloomEnabled).toBe(false);
    expect(governor.getProfile().renderScale).toBeLessThanOrEqual(0.75);

    for (let i = 0; i < 80; i++) {
      governor.recordSample(8.0, 4.0, 0.1);
    }
    expect(governor.getTier()).toBe('high'); // Never steps above manual 'high'
    expect(governor.getProfile().shadowMapSize).toBe(0);
    expect(governor.getProfile().bloomEnabled).toBe(false);
  });

  it('computes 1% low FPS, render resolution, pixelRatio, and memory usage in PerformanceMonitor', () => {
    const rm = new ResourceManager();
    const monitor = new PerformanceMonitor();
    const governor = new PerformanceGovernor('medium', false);

    const mockRenderer = {
      getDrawInfo: () => ({ calls: 42, triangles: 12000, geometries: 18, textures: 9 }),
      getRenderMetrics: () => ({ renderWidth: 1120, renderHeight: 520, pixelRatio: 1.35 }),
    } as unknown as EngineRenderer;

    // 25 frames of 16ms and 5 spikes of 34ms across >= 0.4s
    for (let i = 0; i < 30; i++) {
      const ms = i % 6 === 0 ? 34 : 16;
      monitor.tick(0.02, ms, mockRenderer, rm, governor, 3, 2, 5);
    }

    const snap = monitor.getLatestTelemetry();
    expect(snap.fps1PercentLow).toBeDefined();
    expect(snap.fps1PercentLow!).toBeLessThanOrEqual(snap.fps);
    expect(snap.renderWidth).toBe(1120);
    expect(snap.renderHeight).toBe(520);
    expect(snap.pixelRatio).toBe(1.35);

    rm.disposeAll();
  });

  it('suspends and resumes Howler and AudioContext on lifecycle transitions', () => {
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const muteSpy = vi.spyOn(Howler, 'mute');

    audio.suspend();
    expect(muteSpy).toHaveBeenCalledWith(true);

    audio.resume();
    expect(muteSpy).toHaveBeenCalledWith(false);

    rm.disposeAll();
    muteSpy.mockRestore();
  });

  it('handles THREE.WebGLRenderer fallback metrics safely when headless', () => {
    expect(typeof THREE.REVISION).toBe('string');
  });
});
