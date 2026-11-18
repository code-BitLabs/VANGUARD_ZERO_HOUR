import { afterEach, describe, expect, it, vi } from 'vitest';
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
    vi.unstubAllGlobals();
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

  it('suspends and resumes AudioContext and enforces lifecycle mute even when settings update while hidden', () => {
    const gains: Array<{
      gain: {
        value: number;
        setTargetAtTime: ReturnType<typeof vi.fn>;
        setValueAtTime: ReturnType<typeof vi.fn>;
      };
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    const suspendSpy = vi.fn().mockResolvedValue(undefined);
    const resumeSpy = vi.fn().mockResolvedValue(undefined);
    const closeSpy = vi.fn().mockResolvedValue(undefined);

    const mockCtx = {
      state: 'running' as AudioContextState,
      sampleRate: 44100,
      currentTime: 1.0,
      destination: {},
      listener: {},
      suspend: () => {
        mockCtx.state = 'suspended';
        return suspendSpy();
      },
      resume: () => {
        mockCtx.state = 'running';
        return resumeSpy();
      },
      close: closeSpy,
      createGain: () => {
        const node = {
          gain: {
            value: 1,
            setTargetAtTime: vi.fn((val: number) => {
              node.gain.value = val;
            }),
            setValueAtTime: vi.fn((val: number) => {
              node.gain.value = val;
            }),
          },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        gains.push(node);
        return node;
      },
      createBuffer: (_ch: number, len: number) => ({
        getChannelData: () => new Float32Array(len),
      }),
    };

    const FakeAudioContext = vi.fn(function FakeAudioContextImpl() {
      return mockCtx;
    });
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const rm = new ResourceManager();
    const initial = SettingsBundleSchema.parse({}).audio;
    const audio = new AudioManager(rm, { ...initial, muted: false, masterVolume: 0.7 });
    audio.unlock();

    const masterGain = gains[0];
    expect(masterGain).toBeDefined();
    expect(masterGain.gain.value).toBeCloseTo(0.7, 5);

    audio.suspend();
    expect(audio.isSuspendedByLifecycle()).toBe(true);
    expect(suspendSpy).toHaveBeenCalledTimes(1);
    expect(masterGain.gain.value).toBe(0);

    // Updating settings while tab is suspended must NOT unmute masterGain (FND-11)
    audio.applySettings({ ...initial, muted: false, masterVolume: 0.9 });
    expect(masterGain.gain.value).toBe(0);

    audio.resume();
    expect(audio.isSuspendedByLifecycle()).toBe(false);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(masterGain.gain.value).toBeCloseTo(0.9, 5);

    rm.disposeAll();
  });

  it('handles THREE.WebGLRenderer fallback metrics safely when headless', () => {
    expect(typeof THREE.REVISION).toBe('string');
  });

  it('TRN-03: keeps VignetteEffect and EffectComposer active across all quality tiers even when Bloom is disabled', () => {
    const composerRender = vi.fn();
    const rendererRender = vi.fn();
    const bloomPass = { enabled: true, dispose: vi.fn() };
    const vignettePass = { enabled: true, dispose: vi.fn() };
    const bloomEffect = { blendMode: { opacity: { value: 1 } }, dispose: vi.fn() };
    const vignetteEffect = { dispose: vi.fn() };

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1280 });
    Object.defineProperty(container, 'clientHeight', { value: 720 });

    const fakeInstance = Object.create(EngineRenderer.prototype) as EngineRenderer;

    Object.assign(fakeInstance as unknown as Record<string, unknown>, {
      container,
      width: 1280,
      height: 720,
      renderScale: 1,
      bloomEnabled: true,
      camera: new THREE.PerspectiveCamera(78, 16 / 9, 0.15, 420),
      viewModelCamera: new THREE.PerspectiveCamera(58, 16 / 9, 0.03, 12),
      scene: new THREE.Scene(),
      viewModelScene: new THREE.Scene(),
      composer: { render: composerRender, setSize: vi.fn() },
      bloomEffect,
      vignetteEffect,
      bloomPass,
      vignettePass,
      renderer: {
        shadowMap: { enabled: true },
        info: { reset: vi.fn(), render: { calls: 10, triangles: 500 }, memory: { geometries: 1, textures: 1 } },
        getContext: () => ({ isContextLost: () => false }),
        setRenderTarget: vi.fn(),
        clear: vi.fn(),
        clearDepth: vi.fn(),
        render: rendererRender,
        setPixelRatio: vi.fn(),
        setSize: vi.fn(),
      },
    });

    const tiers = ['low', 'medium', 'high', 'ultra'] as const;
    for (const tier of tiers) {
      for (const userBloomSetting of [true, false]) {
        composerRender.mockClear();
        rendererRender.mockClear();

        const governor = new PerformanceGovernor(tier, false);
        const profile = governor.getProfile();
        fakeInstance.applyGovernorProfile(profile, true, userBloomSetting, null);
        fakeInstance.renderFrame(false);

        const state = fakeInstance.getPostProcessState();
        const expectedBloom = profile.bloomEnabled && userBloomSetting;
        expect(state.composerActive).toBe(true);
        expect(state.vignetteEnabled).toBe(true);
        expect(vignettePass.enabled).toBe(true);
        expect(state.bloomEnabled).toBe(expectedBloom);
        expect(state.bloomPassEnabled).toBe(expectedBloom);
        expect(bloomEffect.blendMode.opacity.value).toBe(expectedBloom ? 1 : 0);
        // Composer always renders main scene so Vignette never vanishes on low/medium/bloom-off
        expect(composerRender).toHaveBeenCalledTimes(1);
        expect(rendererRender).not.toHaveBeenCalled();
      }
    }
  });
});
