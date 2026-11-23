import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { ResourceManager } from '@/src/core/ResourceManager';
import { SceneLights } from '@/src/world/LightingRig';
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
  private bloomEffect: BloomEffect | null = null;
  private vignetteEffect: VignetteEffect | null = null;
  private toneMappingEffect: ToneMappingEffect | null = null;
  private bloomPass: EffectPass | null = null;
  private vignettePass: EffectPass | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private renderScale = 1.0;
  private maxDprCap = 2.0;
  private bloomEnabled = true;
  private width = 1280;
  private height = 720;
  private appliedWidth = 0;
  private appliedHeight = 0;
  private appliedEffectiveDpr = 0;
  private pendingResize = false;
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private backendPreference: RendererBackendOption = 'auto';
  private verticalSliceReport: RenderingVerticalSliceReport;

  constructor(
    private readonly container: HTMLElement,
    private readonly resourceManager: ResourceManager,
    private readonly onContextLostCallback?: () => void,
    private readonly onContextRestoredCallback?: () => void
  ) {
    this.width = Math.max(320, container.clientWidth || window.innerWidth);
    this.height = Math.max(240, container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const gl = this.renderer.getContext();
    let rendererString = '';
    try {
      const dbgExt = gl.getExtension('WEBGL_debug_renderer_info');
      rendererString = dbgExt
        ? String(gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL) ?? '')
        : String(gl.getParameter(gl.RENDERER) ?? '');
    } catch {
      rendererString = '';
    }
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
      // Compensate for skipped PMREM environment IBL on CPU software rasterizers
      this.scene.add(new THREE.AmbientLight(0xdfe8f5, 0.56));
    } else {
      this.buildEnvironment();
      this.buildPostProcessing();
    }
    this.bindContextEvents();
  }


  private buildEnvironment(): void {
    if (this.isSoftwareGl) return;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envRT?.dispose();
    this.envRT = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRT.texture;
    this.viewModelScene.environment = this.envRT.texture;
    roomEnv.dispose();
    pmrem.dispose();
  }

  private buildPostProcessing(): void {
    this.bloomPass?.dispose();
    this.vignettePass?.dispose();
    this.bloomEffect?.dispose();
    this.vignetteEffect?.dispose();
    this.toneMappingEffect?.dispose();
    this.composer?.dispose();
    const composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
    });
    const renderPass = new RenderPass(this.scene, this.camera);
    const bloom = new BloomEffect({
      intensity: 0.36,
      luminanceThreshold: 1.08,
      luminanceSmoothing: 0.28,
      mipmapBlur: true,
    });
    const vignette = new VignetteEffect({
      eskil: false,
      offset: 0.35,
      darkness: 0.42,
    });
    const toneMapping = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    });
    // Separate passes so disabling Bloom completely skips mipmap blur GPU work while keeping ACES Filmic ToneMapping + Vignette active on all hardware tiers
    const bloomPass = new EffectPass(this.camera, bloom);
    bloomPass.enabled = this.bloomEnabled;
    const vignettePass = new EffectPass(this.camera, vignette, toneMapping);
    vignettePass.enabled = true;
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(vignettePass);

    this.composer = composer;
    this.bloomEffect = bloom;
    this.vignetteEffect = vignette;
    this.toneMappingEffect = toneMapping;
    this.bloomPass = bloomPass;
    this.vignettePass = vignettePass;
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
    if (this.shadowCascades?.isCsmActive()) {
      this.shadowCascades.registerHierarchy(this.scene);
      this.shadowCascades.update();
    }
    this.scene.updateMatrixWorld();
    this.viewModelScene.updateMatrixWorld();
    try {
      if (!this.renderer.getContext().isContextLost()) {
        this.renderer.compile(this.scene, this.camera);
        this.renderer.compile(this.viewModelScene, this.viewModelCamera);
      }
    } catch {
      // Ignore precompile errors in mocked/headless test contexts
    }
  }

  renderFrame(renderViewModel: boolean): void {
    if (this.renderer.getContext().isContextLost()) return;

    if (this.pendingResize) {
      this.pendingResize = false;
      this.resize();
    }

    if (this.shadowCascades?.isCsmActive()) {
      this.shadowCascades.update();
    }
    this.renderer.info.reset();
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    if (this.composer && this.vignettePass) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (renderViewModel) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewModelScene, this.viewModelCamera);
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
  } {
    return {
      composerActive: Boolean(this.composer && this.vignettePass),
      bloomEnabled: this.bloomEnabled,
      bloomPassEnabled: Boolean(this.bloomPass?.enabled),
      vignetteEnabled: Boolean(this.vignettePass?.enabled && this.vignetteEffect),
      toneMappingEnabled: Boolean(this.vignettePass?.enabled && this.toneMappingEffect),
    };
  }

  dispose(): void {
    this.shadowCascades?.dispose();
    this.lightBudgetManager?.dispose();
    this.scene.environment = null;
    this.viewModelScene.environment = null;
    this.bloomPass?.dispose();
    this.vignettePass?.dispose();
    this.bloomEffect?.dispose();
    this.vignetteEffect?.dispose();
    this.toneMappingEffect?.dispose();
    this.composer?.dispose();
    this.envRT?.dispose();
    this.bloomPass = null;
    this.vignettePass = null;
    this.bloomEffect = null;
    this.vignetteEffect = null;
    this.toneMappingEffect = null;
    this.composer = null;
    this.envRT = null;
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

