import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { ResourceManager } from '@/src/core/ResourceManager';
import { QualityTier } from '@/src/schemas/common.schema';
import { AntiAliasingMode } from '@/src/schemas/settings.schema';
import { SceneLights } from '@/src/world/LightingRig';
import {
  resolveAntiAliasingPolicy,
  ResolvedAntiAliasingConfig,
} from './AntiAliasingPolicy';
import { GovernorProfile } from './PerformanceGovernor';
import { RenderingQualityDirector } from './RenderingQualityDirector';
import { ShadowCascadeController } from './ShadowCascadeController';
import {
  evaluateRenderingVerticalSlice,
  RendererBackendOption,
  RenderingVerticalSliceReport,
  TacticalLightBudgetManager,
} from './RenderingBenchmarkSlice';

export class EngineRenderer {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly viewModelScene: THREE.Scene;
  public readonly viewModelCamera: THREE.PerspectiveCamera;
  public readonly lightBudgetManager: TacticalLightBudgetManager;
  public readonly shadowCascades: ShadowCascadeController;
  public readonly qualityDirector: RenderingQualityDirector;
  public readonly isSoftwareGl: boolean;

  private composer: EffectComposer | null = null;
  private worldRenderPass: RenderPass | null = null;
  private viewModelRenderPass: RenderPass | null = null;
  private bloomEffect: BloomEffect | null = null;
  private smaaEffect: SMAAEffect | null = null;
  private vignetteEffect: VignetteEffect | null = null;
  private toneMappingEffect: ToneMappingEffect | null = null;
  private bloomPass: EffectPass | null = null;
  private smaaPass: EffectPass | null = null;
  private vignettePass: EffectPass | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private softwareEnvTex: THREE.DataTexture | null = null;
  private renderScale = 1.0;
  private maxDprCap = 2.0;
  private bloomEnabled = true;
  private baseVignetteDarkness = 0.42;
  private baseVignetteOffset = 0.35;
  private suppressionVignetteLevel = 0;
  private width = 1280;
  private height = 720;
  private appliedWidth = 0;
  private appliedHeight = 0;
  private appliedEffectiveDpr = 0;
  private pendingResize = false;
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private gpuTimerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private pendingGpuQueries: WebGLQuery[] = [];
  private lastGpuFrameMs: number | null = null;
  private precompileGeneration = 0;
  private backendPreference: RendererBackendOption = 'auto';
  private verticalSliceReport: RenderingVerticalSliceReport;
  private readonly maxMsaaSamples: number;
  private msaaFramebufferSupported = true;
  private requestedAaMode: AntiAliasingMode = 'auto';
  private requestedAaEnabled = true;
  private requestedAaQualityTier: QualityTier = 'high';
  private adaptiveAaDowngradeStep = 0;
  private activeAaConfig: ResolvedAntiAliasingConfig = {
    activeMode: 'off',
    multisampling: 0,
    useSmaa: false,
    reason: 'uninitialized',
  };
  private pendingAaRebuild = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly resourceManager: ResourceManager,
    private readonly onContextLostCallback?: () => void,
    private readonly onContextRestoredCallback?: () => void
  ) {
    this.width = Math.max(320, container.clientWidth || window.innerWidth);
    this.height = Math.max(240, container.clientHeight || window.innerHeight);

    // Backbuffer MSAA is unused when EffectComposer renders offscreen; AA is owned by EffectComposer MSAA / SMAAEffect.
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const gl = this.renderer.getContext();
    let rendererString = '';
    let maxSamples = 0;
    try {
      const dbgExt = gl.getExtension('WEBGL_debug_renderer_info');
      rendererString = dbgExt
        ? String(gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL) ?? '')
        : String(gl.getParameter(gl.RENDERER) ?? '');
      if (this.renderer.capabilities.isWebGL2 && 'MAX_SAMPLES' in gl) {
        maxSamples = Number(gl.getParameter((gl as WebGL2RenderingContext).MAX_SAMPLES) ?? 0) || 0;
      }
      if (this.renderer.capabilities.isWebGL2) {
        const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
          TIME_ELAPSED_EXT: number;
          GPU_DISJOINT_EXT: number;
        } | null;
        if (timerExt && typeof timerExt.TIME_ELAPSED_EXT === 'number') {
          this.gpuTimerExt = timerExt;
        }
      }
    } catch {
      rendererString = '';
      maxSamples = 0;
    }
    this.maxMsaaSamples = maxSamples;
    this.isSoftwareGl = /swiftshader|llvmpipe|software|mesa offscreen|basic render driver/i.test(
      rendererString
    );

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.isSoftwareGl ? 1.26 : 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.isSoftwareGl
      ? THREE.BasicShadowMap
      : THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    const initialDpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(initialDpr);
    this.renderer.setSize(this.width, this.height);
    this.appliedWidth = this.width;
    this.appliedHeight = this.height;
    this.appliedEffectiveDpr = Number(initialDpr.toFixed(2));

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e11);
    this.scene.fog = new THREE.FogExp2(0x1b222c, 0.0055);
    this.lightBudgetManager = new TacticalLightBudgetManager(this.scene, 'high');
    this.verticalSliceReport = evaluateRenderingVerticalSlice('auto');

    this.camera = new THREE.PerspectiveCamera(78, this.width / this.height, 0.15, 560);
    this.qualityDirector = new RenderingQualityDirector(
      this.isSoftwareGl ? 'software_webgl' : 'mid_range_desktop'
    );
    this.shadowCascades = new ShadowCascadeController(this.scene, this.camera, {
      cascades: this.isSoftwareGl ? 1 : 3,
      shadowMapSize: this.isSoftwareGl ? 512 : 1024,
      maxFar: 180,
      isSoftwareGl: this.isSoftwareGl,
    });

    // Separate viewmodel layer so first-person weapons never clip into world walls
    this.viewModelScene = new THREE.Scene();
    this.viewModelCamera = new THREE.PerspectiveCamera(58, this.width / this.height, 0.03, 12);
    this.viewModelScene.add(
      new THREE.HemisphereLight(0xeef6ff, 0x4b5563, this.isSoftwareGl ? 2.45 : 1.75)
    );
    const vmKey = new THREE.DirectionalLight(0xfff5e4, this.isSoftwareGl ? 3.2 : 2.55);
    vmKey.position.set(1.4, 2.4, 2.2);
    this.viewModelScene.add(vmKey);
    const vmFill = new THREE.DirectionalLight(0xcbd5e1, this.isSoftwareGl ? 1.35 : 0.72);
    vmFill.position.set(-1.3, 0.6, 2.3);
    this.viewModelScene.add(vmFill);
    const vmRim = new THREE.DirectionalLight(0x7dd3fc, this.isSoftwareGl ? 1.55 : 1.05);
    vmRim.position.set(-1.8, 1.4, -1.3);
    this.viewModelScene.add(vmRim);

    if (this.isSoftwareGl) {
      // Lightweight procedural studio equirectangular IBL + soft fill for metallic specular parity on software-GL
      this.buildSoftwareStudioEnvironment();
      this.scene.add(new THREE.AmbientLight(0xdfe8f5, 0.42));
    } else {
      this.buildEnvironment();
      this.buildPostProcessing();
    }
    this.bindContextEvents();
  }

  private buildSoftwareStudioEnvironment(): void {
    const w = 64;
    const h = 32;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1); // 0 = bottom, 1 = top in Three.js DataTexture
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        let r: number;
        let g: number;
        let b: number;
        if (v > 0.52) {
          // Cool tactical sky dome + subtle studio key lobe
          const skyT = Math.min(1, (v - 0.52) / 0.48);
          const keyLobe = Math.exp(-((u - 0.35) * (u - 0.35) * 18 + (v - 0.78) * (v - 0.78) * 18));
          r = 148 + skyT * 52 + keyLobe * 55;
          g = 166 + skyT * 48 + keyLobe * 48;
          b = 192 + skyT * 42 + keyLobe * 32;
        } else {
          // Warm ground bounce for metallic underside readability
          const gT = Math.min(1, v / 0.52);
          r = 56 + gT * 62;
          g = 60 + gT * 64;
          b = 68 + gT * 66;
        }
        const idx = (y * w + x) * 4;
        data[idx] = Math.min(255, Math.max(0, Math.round(r)));
        data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
        data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
        data[idx + 3] = 255;
      }
    }
    this.softwareEnvTex?.dispose();
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.softwareEnvTex = tex;
    this.scene.environment = tex;
    this.viewModelScene.environment = tex;
  }

  private buildEnvironment(): void {
    if (this.isSoftwareGl) {
      this.buildSoftwareStudioEnvironment();
      return;
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envRT?.dispose();
    this.envRT = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRT.texture;
    this.viewModelScene.environment = this.envRT.texture;
    roomEnv.dispose();
    pmrem.dispose();
  }

  private computeDesiredAaConfig(): ResolvedAntiAliasingConfig {
    const isCoarse =
      typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    const dpr = this.appliedEffectiveDpr || this.renderer.getPixelRatio() || 1;
    const pixelCount = Math.round(this.width * dpr) * Math.round(this.height * dpr);
    return resolveAntiAliasingPolicy({
      requestedMode: this.requestedAaMode,
      antialiasingEnabled: this.requestedAaEnabled,
      isSoftwareGl: this.isSoftwareGl,
      isWebGL2: Boolean(this.renderer.capabilities?.isWebGL2),
      maxSamples: this.maxMsaaSamples,
      msaaFramebufferSupported: this.msaaFramebufferSupported,
      canvasPixelCount: pixelCount,
      isMobileOrCoarse: isCoarse,
      qualityTier: this.requestedAaQualityTier,
      adaptiveDowngradeStep: this.adaptiveAaDowngradeStep,
    });
  }

  public applyAntiAliasingPreference(
    mode: AntiAliasingMode,
    antialiasingEnabled: boolean,
    qualityTier: QualityTier,
    options?: { lockSurfaceAndShadows?: boolean }
  ): ResolvedAntiAliasingConfig {
    this.requestedAaMode = mode;
    this.requestedAaEnabled = antialiasingEnabled;
    this.requestedAaQualityTier = qualityTier;
    const desired = this.computeDesiredAaConfig();
    if (this.isSoftwareGl) {
      this.activeAaConfig = desired;
      this.pendingAaRebuild = false;
      return desired;
    }

    const changed =
      desired.multisampling !== this.activeAaConfig.multisampling ||
      desired.useSmaa !== this.activeAaConfig.useSmaa;
    if (!changed) {
      this.activeAaConfig = desired;
      this.pendingAaRebuild = false;
      return this.activeAaConfig;
    }

    if (options?.lockSurfaceAndShadows) {
      // Combat lock: never reallocate EffectComposer FBOs mid-firefight
      this.pendingAaRebuild = true;
      return this.activeAaConfig;
    }

    this.buildPostProcessing(desired);
    return this.activeAaConfig;
  }

  public flagAdaptiveAaDowngrade(degradationStep: number): void {
    const clamped = Math.max(0, Math.min(6, Math.round(degradationStep)));
    if (clamped > this.adaptiveAaDowngradeStep) {
      this.adaptiveAaDowngradeStep = clamped;
      const desired = this.computeDesiredAaConfig();
      if (
        desired.multisampling !== this.activeAaConfig.multisampling ||
        desired.useSmaa !== this.activeAaConfig.useSmaa
      ) {
        this.pendingAaRebuild = true;
      }
    }
  }

  public flushPendingAntiAliasingTransition(): void {
    if (!this.pendingAaRebuild || this.isSoftwareGl) return;
    this.pendingAaRebuild = false;
    this.buildPostProcessing(this.computeDesiredAaConfig());
  }

  public getAntiAliasingState(): ResolvedAntiAliasingConfig & {
    maxSamples: number;
    pendingTransition: boolean;
  } {
    return {
      ...this.activeAaConfig,
      maxSamples: this.maxMsaaSamples,
      pendingTransition: this.pendingAaRebuild,
    };
  }

  private disposePostProcessing(): void {
    this.worldRenderPass?.dispose();
    this.viewModelRenderPass?.dispose();
    this.bloomPass?.dispose();
    this.smaaPass?.dispose();
    this.vignettePass?.dispose();
    this.bloomEffect?.dispose();
    this.smaaEffect?.dispose();
    this.vignetteEffect?.dispose();
    this.toneMappingEffect?.dispose();
    this.composer?.dispose();
    this.worldRenderPass = null;
    this.viewModelRenderPass = null;
    this.bloomPass = null;
    this.smaaPass = null;
    this.vignettePass = null;
    this.bloomEffect = null;
    this.smaaEffect = null;
    this.vignetteEffect = null;
    this.toneMappingEffect = null;
    this.composer = null;
    // Direct fallback rendering owns ACESFilmicToneMapping when EffectComposer is not active
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }

  private buildPostProcessing(explicitConfig?: ResolvedAntiAliasingConfig): void {
    this.disposePostProcessing();
    let config = explicitConfig ?? this.computeDesiredAaConfig();
    let composer: EffectComposer;
    try {
      composer = new EffectComposer(this.renderer, {
        frameBufferType: THREE.HalfFloatType,
        multisampling: config.multisampling,
      });
    } catch {
      // Safe driver fallback if HalfFloat + MSAA FBO fails on a constrained WebGL2 driver
      this.msaaFramebufferSupported = false;
      config = {
        activeMode: config.activeMode === 'off' ? 'off' : 'smaa',
        multisampling: 0,
        useSmaa: config.activeMode !== 'off',
        reason: 'msaa_fbo_init_failed_fallback_smaa',
      };
      composer = new EffectComposer(this.renderer, {
        frameBufferType: THREE.HalfFloatType,
        multisampling: 0,
      });
    }

    // World pass renders linear HDR scene into multisampled offscreen inputBuffer (no renderer tone mapping).
    const renderPass = new RenderPass(this.scene, this.camera);
    const bloom = new BloomEffect({
      intensity: 0.36,
      luminanceThreshold: 1.08,
      luminanceSmoothing: 0.28,
      mipmapBlur: true,
    });
    const vignette = new VignetteEffect({
      eskil: false,
      offset: this.baseVignetteOffset,
      darkness: this.baseVignetteDarkness,
    });
    const toneMapping = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    });

    const bloomPass = new EffectPass(this.camera, bloom);
    bloomPass.enabled = this.bloomEnabled;

    // ViewModel pass runs AFTER world Bloom (so optics/rails never bloom-wash) and BEFORE ToneMapping/SMAA.
    // Clears depth ONLY inside the composer's multisampled inputBuffer so the weapon inherits full MSAA/SMAA,
    // never clips into world walls, and receives single-pass ACES Filmic tone mapping alongside the world.
    const viewModelPass = new RenderPass(this.viewModelScene, this.viewModelCamera);
    viewModelPass.clearPass.setClearFlags(false, true, false);
    viewModelPass.clearPass.enabled = true;
    viewModelPass.ignoreBackground = true;
    viewModelPass.skipShadowMapUpdate = true;
    viewModelPass.needsSwap = false;
    viewModelPass.enabled = true;

    const vignettePass = new EffectPass(this.camera, vignette, toneMapping);
    vignettePass.enabled = true;

    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(viewModelPass);
    composer.addPass(vignettePass);

    let smaaEffect: SMAAEffect | null = null;
    let smaaPass: EffectPass | null = null;
    if (config.useSmaa) {
      try {
        smaaEffect = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
        smaaPass = new EffectPass(this.camera, smaaEffect);
        smaaPass.enabled = true;
        composer.addPass(smaaPass);
      } catch {
        smaaEffect = null;
        smaaPass = null;
      }
    }

    composer.setSize(this.width, this.height);
    // ToneMappingEffect applies ACES_FILMIC once in vignettePass; Three.js still uploads toneMappingExposure.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.composer = composer;
    this.worldRenderPass = renderPass;
    this.viewModelRenderPass = viewModelPass;
    this.bloomEffect = bloom;
    this.smaaEffect = smaaEffect;
    this.vignetteEffect = vignette;
    this.toneMappingEffect = toneMapping;
    this.bloomPass = bloomPass;
    this.smaaPass = smaaPass;
    this.vignettePass = vignettePass;
    this.activeAaConfig = config;
    this.pendingAaRebuild = false;
    this.applySuppressionVignetteUniforms();
  }

  public setSuppressionVignette(level: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    if (Math.abs(clamped - this.suppressionVignetteLevel) < 0.005) return;
    this.suppressionVignetteLevel = clamped;
    this.applySuppressionVignetteUniforms();
  }

  private applySuppressionVignetteUniforms(): void {
    if (!this.vignetteEffect) return;
    // Restrained peripheral tension only: center reticle stays completely clear
    this.vignetteEffect.darkness = this.baseVignetteDarkness + this.suppressionVignetteLevel * 0.24;
    this.vignetteEffect.offset = Math.max(0.24, this.baseVignetteOffset - this.suppressionVignetteLevel * 0.09);
  }

  private bindContextEvents(): void {
    const canvas = this.renderer.domElement;
    this.resourceManager.trackEventListener(
      canvas,
      'webglcontextlost',
      (e: Event) => {
        e.preventDefault();
        this.onContextLostCallback?.();
      },
      'shared'
    );
    this.resourceManager.trackEventListener(
      canvas,
      'webglcontextrestored',
      () => {
        this.buildEnvironment();
        if (!this.isSoftwareGl) {
          this.buildPostProcessing();
        }
        this.resize(true);
        this.onContextRestoredCallback?.();
      },
      'shared'
    );
  }

  applyGovernorProfile(
    profile: GovernorProfile,
    shadowsSetting: boolean,
    bloomSetting: boolean,
    lights?: SceneLights | null,
    options?: { deferResize?: boolean; allowShadowToggle?: boolean; lockSurfaceAndShadows?: boolean }
  ): void {
    const lockStructural = options?.lockSurfaceAndShadows === true;
    this.bloomEnabled = !this.isSoftwareGl && profile.bloomEnabled && bloomSetting;
    this.lightBudgetManager?.setQualityTier(profile.tier);

    if (this.bloomPass) {
      this.bloomPass.enabled = this.bloomEnabled;
    }
    if (this.bloomEffect) {
      this.bloomEffect.blendMode.opacity.value = this.bloomEnabled ? 1 : 0;
    }
    if (this.vignettePass) {
      this.vignettePass.enabled = true;
    }

    const nextFar = Math.max(520, profile.drawDistance + 40);
    if (Math.abs(this.camera.far - nextFar) > 0.5) {
      this.camera.far = nextFar;
      this.camera.updateProjectionMatrix();
    }

    // Live combat lock: never reallocate canvas/composer FBOs or dispose shadow depth maps mid-firefight
    if (lockStructural) {
      return;
    }

    this.renderScale = this.isSoftwareGl ? Math.min(profile.renderScale, 0.6) : profile.renderScale;
    const shadowsActive = !this.isSoftwareGl && shadowsSetting && profile.shadowMapSize >= 512;
    const csmActive = Boolean(this.shadowCascades?.isCsmActive());
    if (options?.allowShadowToggle !== false) {
      this.renderer.shadowMap.enabled = shadowsActive;
    }
    const effectiveShadowSize = this.isSoftwareGl
      ? Math.min(512, profile.shadowMapSize)
      : profile.shadowMapSize;
    if (lights?.sun) {
      lights.sun.visible = !csmActive;
      lights.sun.castShadow = !csmActive && shadowsActive;
      if (!csmActive && shadowsActive) {
        if (effectiveShadowSize >= 512 && lights.sun.shadow.mapSize.x !== effectiveShadowSize) {
          lights.sun.shadow.mapSize.set(effectiveShadowSize, effectiveShadowSize);
          lights.sun.shadow.map?.dispose();
          lights.sun.shadow.map = null;
        }
        lights.sun.shadow.camera.left = -profile.shadowDistance;
        lights.sun.shadow.camera.right = profile.shadowDistance;
        lights.sun.shadow.camera.top = profile.shadowDistance;
        lights.sun.shadow.camera.bottom = -profile.shadowDistance;
        lights.sun.shadow.camera.updateProjectionMatrix();
      }
    }

    if (options?.deferResize) {
      this.scheduleResize();
    } else {
      this.resize();
    }
  }

  setRendererBackendPreference(pref: RendererBackendOption, measuredFrameMs = 8.4): RenderingVerticalSliceReport {
    this.backendPreference = pref;
    this.verticalSliceReport = evaluateRenderingVerticalSlice(pref, measuredFrameMs);
    return this.verticalSliceReport;
  }

  getRenderingSliceReport(): RenderingVerticalSliceReport {
    return this.verticalSliceReport;
  }

  setFov(fovDeg: number): void {
    if (Math.abs(this.camera.fov - fovDeg) > 0.05) {
      this.camera.fov = fovDeg;
      this.camera.updateProjectionMatrix();
    }
  }

  setExposure(exposure: number): void {
    const lifted = this.isSoftwareGl ? exposure + 0.14 : exposure;
    const clamped = Math.max(0.65, Math.min(1.55, lifted));
    this.renderer.toneMappingExposure = clamped;
  }

  /**
   * Defers any canvas/FBO resize until the start of the next `renderFrame()` so
   * calling quality adjustments after `renderFrame()` never wipes the just-drawn
   * WebGL buffer before the browser composites it (preventing 1-frame screen blinks).
   */
  public scheduleResize(): void {
    this.pendingResize = true;
  }

  resize(force = false): void {
    const w = Math.max(320, this.container.clientWidth || window.innerWidth);
    const h = Math.max(240, this.container.clientHeight || window.innerHeight);

    const isCoarse =
      typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    const maxDpr = this.isSoftwareGl ? 1.0 : Math.min(this.maxDprCap, isCoarse ? 1.5 : 2.0);
    const baseDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const effectiveDpr = Math.max(0.5, Number((baseDpr * this.renderScale).toFixed(2)));

    // Skip redundant canvas/composer setSize calls — assigning canvas.width even to the same
    // value synchronously clears the WebGL drawing buffer (screen blink) and reallocates FBOs.
    if (
      !force &&
      w === this.appliedWidth &&
      h === this.appliedHeight &&
      Math.abs(effectiveDpr - this.appliedEffectiveDpr) < 0.005
    ) {
      return;
    }

    this.width = w;
    this.height = h;
    this.appliedWidth = w;
    this.appliedHeight = h;
    this.appliedEffectiveDpr = effectiveDpr;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModelCamera.aspect = w / h;
    this.viewModelCamera.updateProjectionMatrix();

    this.renderer.setPixelRatio(effectiveDpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.shadowCascades?.updateFrustums();
  }

  public applyDirectorDimensions(
    maxDpr?: number,
    lights?: SceneLights | null,
    shadowsEnabled = true,
    options?: { allowCsmRebuild?: boolean; deferResize?: boolean; lockSurfaceAndShadows?: boolean }
  ): void {
    const dims = this.qualityDirector.getActiveDimensions();
    this.bloomEnabled = !this.isSoftwareGl && dims.bloomEnabled;
    if (this.bloomPass) this.bloomPass.enabled = this.bloomEnabled;
    if (this.bloomEffect) this.bloomEffect.blendMode.opacity.value = this.bloomEnabled ? 1 : 0;

    // Live combat lock: keep canvas dimensions, DPR, shadow map textures, and CSM cascades
    // completely frozen during gameplay so zero buffer wipes (blinks) or GPU reallocations occur.
    if (options?.lockSurfaceAndShadows) {
      return;
    }

    this.renderScale = this.isSoftwareGl ? Math.min(dims.renderScale, 0.6) : dims.renderScale;
    this.maxDprCap = maxDpr ?? dims.maxDpr;

    // When allowCsmRebuild === false, keep active CSM cascade count stable to prevent shader recompiles.
    const lockCsmCount =
      options?.allowCsmRebuild === false && Boolean(this.shadowCascades?.isCsmActive());
    const targetCascades = lockCsmCount
      ? this.shadowCascades.getTelemetry().activeCascades
      : shadowsEnabled
        ? dims.csmCascades
        : 1;

    const sunDir = lights?.sun
      ? lights.sun.target.position.clone().sub(lights.sun.position).normalize()
      : undefined;
    const csmActive = Boolean(
      this.shadowCascades?.configure({
        cascades: targetCascades,
        shadowMapSize: dims.shadowMapSize,
        isSoftwareGl: this.isSoftwareGl || !shadowsEnabled,
        ...(sunDir && sunDir.lengthSq() > 0.001 ? { lightDirection: sunDir } : {}),
        ...(lights?.sun
          ? {
              lightColor: lights.sun.color.getHex(),
              lightIntensity: lights.sun.intensity,
            }
          : {}),
      })
    );

    // Prevent double-sun overexposure: mute base directional sun whenever CSM cascades own sun lighting
    if (lights?.sun) {
      lights.sun.visible = !csmActive;
      lights.sun.castShadow = !csmActive && shadowsEnabled && dims.shadowMapSize >= 512;
    }

    if (csmActive && options?.allowCsmRebuild !== false) {
      this.shadowCascades?.registerHierarchy(this.scene);
    }
    if (options?.deferResize) {
      this.scheduleResize();
    } else {
      this.resize();
    }
  }

  public isCsmActive(): boolean {
    return Boolean(this.shadowCascades?.isCsmActive());
  }

  public registerMaterialForShadows(mat: THREE.Material): void {
    if (this.shadowCascades?.isCsmActive()) {
      this.shadowCascades.setupMaterial(mat);
    }
  }

  public registerObjectForShadows(obj: THREE.Object3D): void {
    if (this.shadowCascades?.isCsmActive()) {
      this.shadowCascades.registerHierarchy(obj);
    }
  }

  public registerSceneShadowsAndPrecompile(): void {
    void this.registerSceneShadowsAndPrecompileAsync();
  }

  public async registerSceneShadowsAndPrecompileAsync(
    signal?: AbortSignal,
    timeoutMs = 1500
  ): Promise<void> {
    if (signal?.aborted) return;
    const gen = ++this.precompileGeneration;
    if (this.pendingAaRebuild && !this.isSoftwareGl) {
      this.flushPendingAntiAliasingTransition();
    }
    if (this.shadowCascades?.isCsmActive()) {
      this.shadowCascades.registerHierarchy(this.scene);
      this.shadowCascades.forceUpdateAllCascades();
    }
    this.scene.updateMatrixWorld();
    this.viewModelScene.updateMatrixWorld();
    if (this.isSoftwareGl) return;
    try {
      if (this.renderer.getContext().isContextLost() || signal?.aborted || gen !== this.precompileGeneration) {
        return;
      }
      const asyncCompiler = (
        this.renderer as THREE.WebGLRenderer & {
          compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<unknown>;
        }
      ).compileAsync;
      if (typeof asyncCompiler === 'function') {
        const compilePromise = Promise.all([
          asyncCompiler.call(this.renderer, this.scene, this.camera),
          asyncCompiler.call(this.renderer, this.viewModelScene, this.viewModelCamera),
        ]).then(() => undefined);
        const timeoutPromise = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          if (signal) {
            const onAbort = () => {
              clearTimeout(timer);
              resolve();
            };
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
        await Promise.race([compilePromise, timeoutPromise]);
      } else {
        this.renderer.compile(this.scene, this.camera);
        this.renderer.compile(this.viewModelScene, this.viewModelCamera);
      }
    } catch {
      // Ignore precompile errors in mocked/headless or context-lost situations
    }
  }

  private pollPendingGpuTimers(): void {
    if (!this.gpuTimerExt || this.pendingGpuQueries.length === 0) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || gl.isContextLost()) return;
    try {
      const disjoint = Boolean(gl.getParameter(this.gpuTimerExt.GPU_DISJOINT_EXT));
      while (this.pendingGpuQueries.length > 0) {
        const q = this.pendingGpuQueries[0];
        const available = Boolean(gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE));
        if (!available) break;
        this.pendingGpuQueries.shift();
        if (!disjoint) {
          const ns = Number(gl.getQueryParameter(q, gl.QUERY_RESULT));
          if (Number.isFinite(ns) && ns > 0) {
            this.lastGpuFrameMs = Number((ns / 1_000_000).toFixed(3));
          }
        }
        gl.deleteQuery(q);
      }
    } catch {
      this.pendingGpuQueries.length = 0;
    }
  }

  public getGpuFrameMs(): number | null {
    return this.lastGpuFrameMs;
  }

  renderFrame(renderViewModel: boolean): void {
    if (this.renderer.getContext().isContextLost()) return;

    if (this.pendingResize) {
      this.pendingResize = false;
      this.resize();
    }

    this.pollPendingGpuTimers();

    if (this.shadowCascades?.isCsmActive()) {
      this.shadowCascades.update();
    }

    let activeQuery: WebGLQuery | null = null;
    const gl = this.gpuTimerExt ? (this.renderer.getContext() as WebGL2RenderingContext) : null;
    if (this.gpuTimerExt && gl && this.pendingGpuQueries.length < 4) {
      try {
        activeQuery = gl.createQuery();
        if (activeQuery) {
          gl.beginQuery(this.gpuTimerExt.TIME_ELAPSED_EXT, activeQuery);
        }
      } catch {
        activeQuery = null;
      }
    }

    this.renderer.info.reset();
    if (this.composer && this.vignettePass) {
      // ViewModel renders inside EffectComposer (after Bloom, before ToneMapping/SMAA) so it inherits full AA and single-pass ACES tone mapping.
      if (this.viewModelRenderPass) {
        this.viewModelRenderPass.enabled = renderViewModel;
      }
      this.composer.render();
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      if (renderViewModel) {
        this.renderer.clearDepth();
        this.renderer.render(this.viewModelScene, this.viewModelCamera);
      }
    }

    if (activeQuery && this.gpuTimerExt && gl) {
      try {
        gl.endQuery(this.gpuTimerExt.TIME_ELAPSED_EXT);
        this.pendingGpuQueries.push(activeQuery);
      } catch {
        // Ignore query errors on driver quirks
      }
    }

    this.lastDrawCalls = this.renderer.info.render.calls;
    this.lastTriangles = this.renderer.info.render.triangles;
  }

  getRenderMetrics(): { renderWidth: number; renderHeight: number; pixelRatio: number } {
    const pixelRatio = Number(this.renderer.getPixelRatio().toFixed(2));
    return {
      renderWidth: Math.round(this.width * pixelRatio),
      renderHeight: Math.round(this.height * pixelRatio),
      pixelRatio,
    };
  }

  getDrawInfo(): { calls: number; triangles: number; geometries: number; textures: number } {
    return {
      calls: this.lastDrawCalls || this.renderer.info.render.calls,
      triangles: this.lastTriangles || this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };
  }

  getPostProcessState(): {
    composerActive: boolean;
    bloomEnabled: boolean;
    bloomPassEnabled: boolean;
    vignetteEnabled: boolean;
    toneMappingEnabled: boolean;
    smaaEnabled: boolean;
    aaMode: string;
    multisampling: number;
    viewModelInComposer: boolean;
    singlePassToneMapping: boolean;
    gpuFrameMs: number | null;
  } {
    const composerActive = Boolean(this.composer && this.vignettePass);
    return {
      composerActive,
      bloomEnabled: this.bloomEnabled,
      bloomPassEnabled: Boolean(this.bloomPass?.enabled),
      vignetteEnabled: Boolean(this.vignettePass?.enabled && this.vignetteEffect),
      toneMappingEnabled: Boolean(this.vignettePass?.enabled && this.toneMappingEffect),
      smaaEnabled: Boolean(this.smaaPass?.enabled && this.smaaEffect),
      aaMode: this.activeAaConfig?.activeMode ?? 'off',
      multisampling: this.activeAaConfig?.multisampling ?? 0,
      viewModelInComposer: composerActive && Boolean(this.viewModelRenderPass),
      singlePassToneMapping: composerActive
        ? this.renderer.toneMapping === THREE.NoToneMapping && Boolean(this.toneMappingEffect)
        : this.renderer.toneMapping === THREE.ACESFilmicToneMapping,
      gpuFrameMs: this.lastGpuFrameMs,
    };
  }

  dispose(): void {
    this.precompileGeneration++;
    if (this.pendingGpuQueries.length > 0) {
      try {
        const gl = this.renderer.getContext() as WebGL2RenderingContext;
        for (const q of this.pendingGpuQueries) gl.deleteQuery(q);
      } catch {
        // Ignore on already-lost context
      }
      this.pendingGpuQueries.length = 0;
    }
    this.shadowCascades?.dispose();
    this.lightBudgetManager?.dispose();
    this.scene.environment = null;
    this.viewModelScene.environment = null;
    this.disposePostProcessing();
    this.envRT?.dispose();
    this.envRT = null;
    this.softwareEnvTex?.dispose();
    this.softwareEnvTex = null;
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

