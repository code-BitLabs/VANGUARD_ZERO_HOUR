import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, VignetteEffect } from 'postprocessing';
import { ResourceManager } from '@/src/core/ResourceManager';
import { SceneLights } from '@/src/world/LightingRig';
import { GovernorProfile } from './PerformanceGovernor';

export class EngineRenderer {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly viewModelScene: THREE.Scene;
  public readonly viewModelCamera: THREE.PerspectiveCamera;

  private composer: EffectComposer | null = null;
  private bloomEffect: BloomEffect | null = null;
  private vignetteEffect: VignetteEffect | null = null;
  private bloomPass: EffectPass | null = null;
  private vignettePass: EffectPass | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private renderScale = 1.0;
  private bloomEnabled = true;
  private width = 1280;
  private height = 720;
  private lastDrawCalls = 0;
  private lastTriangles = 0;

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
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height);

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e11);
    this.scene.fog = new THREE.FogExp2(0x1b222c, 0.0055);

    this.camera = new THREE.PerspectiveCamera(78, this.width / this.height, 0.15, 420);

    // Separate viewmodel layer so first-person weapons never clip into world walls
    this.viewModelScene = new THREE.Scene();
    this.viewModelCamera = new THREE.PerspectiveCamera(58, this.width / this.height, 0.03, 12);
    this.viewModelScene.add(new THREE.HemisphereLight(0xdbeafe, 0x374151, 1.35));
    const vmKey = new THREE.DirectionalLight(0xfff1d6, 2.0);
    vmKey.position.set(1.5, 2.5, 2.0);
    this.viewModelScene.add(vmKey);

    this.buildEnvironment();
    this.buildPostProcessing();
    this.bindContextEvents();
  }

  private buildEnvironment(): void {
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
    this.composer?.dispose();
    const composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
    });
    const renderPass = new RenderPass(this.scene, this.camera);
    const bloom = new BloomEffect({
      intensity: 0.55,
      luminanceThreshold: 0.85,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
    });
    const vignette = new VignetteEffect({
      eskil: false,
      offset: 0.35,
      darkness: 0.45,
    });
    // Separate passes so disabling Bloom completely skips mipmap blur GPU work while keeping Vignette active on all tiers
    const bloomPass = new EffectPass(this.camera, bloom);
    bloomPass.enabled = this.bloomEnabled;
    const vignettePass = new EffectPass(this.camera, vignette);
    vignettePass.enabled = true;
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(vignettePass);

    this.composer = composer;
    this.bloomEffect = bloom;
    this.vignetteEffect = vignette;
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
        this.buildPostProcessing();
        this.resize();
        this.onContextRestoredCallback?.();
      },
      'shared'
    );
  }

  applyGovernorProfile(
    profile: GovernorProfile,
    shadowsSetting: boolean,
    bloomSetting: boolean,
    lights?: SceneLights | null
  ): void {
    this.renderScale = profile.renderScale;
    this.bloomEnabled = profile.bloomEnabled && bloomSetting;
    const shadowsActive = shadowsSetting && profile.shadowMapSize >= 512;
    this.renderer.shadowMap.enabled = shadowsActive;
    if (lights?.sun) {
      lights.sun.castShadow = shadowsActive;
      if (shadowsActive && profile.shadowMapSize >= 512 && lights.sun.shadow.mapSize.x !== profile.shadowMapSize) {
        lights.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
        lights.sun.shadow.map?.dispose();
        lights.sun.shadow.map = null;
      }
      lights.sun.shadow.camera.left = -profile.shadowDistance;
      lights.sun.shadow.camera.right = profile.shadowDistance;
      lights.sun.shadow.camera.top = profile.shadowDistance;
      lights.sun.shadow.camera.bottom = -profile.shadowDistance;
      lights.sun.shadow.camera.updateProjectionMatrix();
    }

    this.camera.far = Math.max(150, profile.drawDistance + 40);
    this.camera.updateProjectionMatrix();

    if (this.bloomPass) {
      this.bloomPass.enabled = this.bloomEnabled;
    }
    if (this.bloomEffect) {
      this.bloomEffect.blendMode.opacity.value = this.bloomEnabled ? 1 : 0;
    }
    if (this.vignettePass) {
      this.vignettePass.enabled = true;
    }
    this.resize();
  }

  setFov(fovDeg: number): void {
    if (Math.abs(this.camera.fov - fovDeg) > 0.05) {
      this.camera.fov = fovDeg;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(): void {
    const w = Math.max(320, this.container.clientWidth || window.innerWidth);
    const h = Math.max(240, this.container.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModelCamera.aspect = w / h;
    this.viewModelCamera.updateProjectionMatrix();

    const isCoarse =
      typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    const maxDpr = isCoarse ? 1.5 : 2.0;
    const baseDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const effectiveDpr = Math.max(0.5, Number((baseDpr * this.renderScale).toFixed(2)));
    this.renderer.setPixelRatio(effectiveDpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  renderFrame(renderViewModel: boolean): void {
    if (this.renderer.getContext().isContextLost()) return;

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
  } {
    return {
      composerActive: Boolean(this.composer && this.vignettePass),
      bloomEnabled: this.bloomEnabled,
      bloomPassEnabled: Boolean(this.bloomPass?.enabled),
      vignetteEnabled: Boolean(this.vignettePass?.enabled && this.vignetteEffect),
    };
  }

  dispose(): void {
    this.scene.environment = null;
    this.viewModelScene.environment = null;
    this.bloomPass?.dispose();
    this.vignettePass?.dispose();
    this.bloomEffect?.dispose();
    this.vignetteEffect?.dispose();
    this.composer?.dispose();
    this.envRT?.dispose();
    this.bloomPass = null;
    this.vignettePass = null;
    this.bloomEffect = null;
    this.vignetteEffect = null;
    this.composer = null;
    this.envRT = null;
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
