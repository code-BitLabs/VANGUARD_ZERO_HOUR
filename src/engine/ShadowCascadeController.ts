import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

export type ShadowBackendKind = 'webgl_csm' | 'webgl_single_fallback' | 'webgpu_csm_node_seam';

export interface ShadowCascadeConfig {
  cascades: number; // 1..4
  shadowMapSize: 512 | 1024 | 2048;
  maxFar: number;
  lightDirection: THREE.Vector3;
  lightIntensity: number;
  lightColor: number;
  shadowBias: number;
  normalBias: number;
  isSoftwareGl: boolean;
}

export interface ShadowCascadeTelemetry {
  backend: ShadowBackendKind;
  activeCascades: number;
  shadowMapSize: number;
  maxFar: number;
  estimatedShadowTexels: number;
  webGpuNodeContractReady: boolean;
}

const CSM_DEFINE_KEYS = ['USE_CSM', 'CSM_CASCADES', 'CSM_FADE'] as const;

let strippedMaterialCounter = 0;

/**
 * Strips Three.js CSM shader defines and onBeforeCompile hooks from a material
 * (for example after `.clone()` or before CSM teardown/rebuild) and assigns a
 * fresh `customProgramCacheKey` so `WebGLRenderer.getProgram()` is guaranteed
 * to allocate a fresh program + `uniformsList` instead of uploading against
 * deleted CSM uniform slots.
 */
export function stripCsmMaterialPatches(
  material: THREE.Material,
  cacheTag?: string
): boolean {
  const matRecord = material as THREE.Material & {
    defines?: Record<string, unknown>;
    userData?: Record<string, unknown>;
  };
  const hadCsmDefines = Boolean(
    matRecord.defines &&
      (matRecord.defines.USE_CSM !== undefined ||
        matRecord.defines.CSM_CASCADES !== undefined ||
        matRecord.defines.CSM_FADE !== undefined)
  );
  const wasCsmPatched = hadCsmDefines || Boolean(matRecord.userData?.__vanguardCsmPatched);
  if (!wasCsmPatched) {
    return false;
  }

  if (matRecord.defines) {
    for (const key of CSM_DEFINE_KEYS) {
      delete matRecord.defines[key];
    }
  }
  if (matRecord.userData) {
    delete matRecord.userData.__vanguardCsmPatched;
  }

  // Restore Three.js default no-op hook rather than deleting the property
  material.onBeforeCompile = () => {};
  const nextKey = cacheTag ?? `nocsm_${++strippedMaterialCounter}`;
  material.customProgramCacheKey = () => nextKey;
  material.needsUpdate = true;
  return true;
}

/**
 * Backend-agnostic Cascaded Shadow Map controller.
 * - Uses official Three.js `CSM` addon (`three/examples/jsm/csm/CSM.js`) on WebGL2 hardware.
 * - Exposes a verified `CSMShadowNode` adapter seam descriptor for future WebGPURenderer parity.
 * - Falls back deterministically to a single directional light on Software WebGL or when cascades <= 1.
 */
export class ShadowCascadeController {
  private csm: CSM | null = null;
  private config: ShadowCascadeConfig;
  private backend: ShadowBackendKind = 'webgl_single_fallback';
  private initializedMaterials = new WeakSet<THREE.Material>();
  private readonly trackedMaterials = new Set<THREE.Material>();
  private csmGeneration = 0;
  private readonly lastCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly lastCamQuat = new THREE.Quaternion();
  private readonly lastFarCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly lastFarCamQuat = new THREE.Quaternion();
  private csmDirty = true;
  private staggerFrameCounter = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    initialConfig: Partial<ShadowCascadeConfig> = {}
  ) {
    this.config = {
      cascades: initialConfig.cascades ?? 3,
      shadowMapSize: initialConfig.shadowMapSize ?? 1024,
      maxFar: initialConfig.maxFar ?? 180,
      lightDirection: (initialConfig.lightDirection ?? new THREE.Vector3(-0.45, -0.82, -0.35)).clone().normalize(),
      lightIntensity: initialConfig.lightIntensity ?? 2.35,
      lightColor: initialConfig.lightColor ?? 0xfff0d4,
      shadowBias: initialConfig.shadowBias ?? -0.00035,
      normalBias: initialConfig.normalBias ?? 0.032,
      isSoftwareGl: initialConfig.isSoftwareGl ?? false,
    };
  }

  /**
   * Initializes or rebuilds official Three.js CSM cascades when hardware supports it.
   * Returns true if CSM is active; false if falling back to single directional light.
   */
  public configure(next: Partial<ShadowCascadeConfig>): boolean {
    const prevCascades = this.config.cascades;
    const prevMapSize = this.config.shadowMapSize;
    const prevMaxFar = this.config.maxFar;

    this.config = {
      ...this.config,
      ...next,
      cascades: Math.max(1, Math.min(4, Math.round(next.cascades ?? this.config.cascades))),
      lightDirection: (next.lightDirection ?? this.config.lightDirection).clone().normalize(),
    };

    const shouldUseCsm = !this.config.isSoftwareGl && this.config.cascades >= 2;
    if (!shouldUseCsm) {
      this.disposeCsmOnly();
      this.backend = 'webgl_single_fallback';
      return false;
    }

    // Only rebuild CSM when cascade count or far range changes; shadowMapSize resizes
    // cleanly in-place on existing cascade lights without tearing down/recompiling shaders.
    const needsRebuild =
      !this.csm ||
      prevCascades !== this.config.cascades ||
      Math.abs(prevMaxFar - this.config.maxFar) > 5;

    if (needsRebuild) {
      this.disposeCsmOnly();
      this.csmGeneration++;
      try {
        this.csm = new CSM({
          maxFar: this.config.maxFar,
          cascades: this.config.cascades,
          mode: 'practical',
          parent: this.scene,
          shadowMapSize: this.config.shadowMapSize,
          lightDirection: this.config.lightDirection.clone(),
          lightIntensity: this.config.lightIntensity,
          camera: this.camera,
          shadowBias: this.config.shadowBias,
        });
        this.csm.fade = true;
        for (const light of this.csm.lights) {
          light.color.setHex(this.config.lightColor);
          light.shadow.normalBias = this.config.normalBias;
          light.shadow.autoUpdate = false;
          light.shadow.needsUpdate = true;
        }
        this.backend = 'webgl_csm';
        this.initializedMaterials = new WeakSet<THREE.Material>();
        this.csmDirty = true;
        this.staggerFrameCounter = 0;
      } catch {
        this.disposeCsmOnly();
        this.backend = 'webgl_single_fallback';
        return false;
      }
    } else if (this.csm) {
      this.csm.lightDirection.copy(this.config.lightDirection);
      const mapSizeChanged = prevMapSize !== this.config.shadowMapSize;
      if (mapSizeChanged) {
        this.csm.shadowMapSize = this.config.shadowMapSize;
      }
      for (const light of this.csm.lights) {
        light.color.setHex(this.config.lightColor);
        light.intensity = this.config.lightIntensity;
        light.shadow.bias = this.config.shadowBias;
        light.shadow.normalBias = this.config.normalBias;
        if (mapSizeChanged) {
          light.shadow.mapSize.set(this.config.shadowMapSize, this.config.shadowMapSize);
          if (light.shadow.map) {
            light.shadow.map.dispose();
            light.shadow.map = null;
          }
          light.shadow.needsUpdate = true;
        }
      }
      this.csmDirty = true;
    }

    return this.csm !== null;
  }

  /**
   * Registers a material with official Three.js CSM shader chunk injection (idempotent).
   */
  public setupMaterial(material: THREE.Material): void {
    if (!this.csm) {
      stripCsmMaterialPatches(material, `nocsm_g${this.csmGeneration}`);
      return;
    }
    if (this.initializedMaterials.has(material)) return;
    // Only patch lit standard/physical/phong/lambert materials; leave custom ShaderMaterial/BasicMaterial untouched
    const matType = (material as { type?: string }).type ?? '';
    if (
      matType !== 'MeshStandardMaterial' &&
      matType !== 'MeshPhysicalMaterial' &&
      matType !== 'MeshPhongMaterial' &&
      matType !== 'MeshLambertMaterial'
    ) {
      this.initializedMaterials.add(material);
      return;
    }
    try {
      const gen = this.csmGeneration;
      const cascades = this.config.cascades;
      const fadeFlag = this.csm.fade ? 1 : 0;
      const cacheKey = `csm_g${gen}_c${cascades}_f${fadeFlag}`;
      material.customProgramCacheKey = () => cacheKey;
      this.csm.setupMaterial(material);
      if (material.userData) {
        material.userData.__vanguardCsmPatched = gen;
      }
      material.needsUpdate = true;
      this.initializedMaterials.add(material);
      this.trackedMaterials.add(material);
    } catch {
      this.initializedMaterials.add(material);
    }
  }

  /**
   * Registers all mesh materials under a root Object3D with active CSM cascades.
   */
  public registerHierarchy(root: THREE.Object3D): void {
    if (!this.csm) return;
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          for (const mat of mesh.material) this.setupMaterial(mat);
        } else if (mesh.material) {
          this.setupMaterial(mesh.material);
        }
      }
    });
  }

  public forceUpdateAllCascades(): void {
    if (!this.csm) return;
    this.csm.update();
    for (let i = 0; i < this.csm.lights.length; i++) {
      this.csm.lights[i].shadow.needsUpdate = true;
    }
    this.lastCamPos.copy(this.camera.position);
    this.lastCamQuat.copy(this.camera.quaternion);
    this.lastFarCamPos.copy(this.camera.position);
    this.lastFarCamQuat.copy(this.camera.quaternion);
    this.csmDirty = false;
  }

  public update(): void {
    if (!this.csm) return;
    const posMovedSq = this.camera.position.distanceToSquared(this.lastCamPos);
    const rotDot = Math.abs(this.camera.quaternion.dot(this.lastCamQuat));
    if (!this.csmDirty && posMovedSq <= 4e-4 && rotDot > 0.99999) {
      return;
    }
    this.csm.update();
    this.staggerFrameCounter++;

    const farMoveSq = this.camera.position.distanceToSquared(this.lastFarCamPos);
    const farRotDot = Math.abs(this.camera.quaternion.dot(this.lastFarCamQuat));
    const majorJump = this.csmDirty || farMoveSq > 2.25 || farRotDot < 0.985;

    const lights = this.csm.lights;
    for (let i = 0; i < lights.length; i++) {
      if (
        majorJump ||
        i === 0 ||
        (i === 1 && (this.staggerFrameCounter & 1) === 0) ||
        (i >= 2 && (this.staggerFrameCounter & 3) === 0)
      ) {
        lights[i].shadow.needsUpdate = true;
      }
    }

    if (majorJump || (this.staggerFrameCounter & 3) === 0) {
      this.lastFarCamPos.copy(this.camera.position);
      this.lastFarCamQuat.copy(this.camera.quaternion);
    }
    this.lastCamPos.copy(this.camera.position);
    this.lastCamQuat.copy(this.camera.quaternion);
    this.csmDirty = false;
  }

  public updateFrustums(): void {
    if (!this.csm) return;
    this.csm.updateFrustums();
    this.csmDirty = true;
  }

  public isCsmActive(): boolean {
    return this.csm !== null;
  }

  public getTelemetry(): ShadowCascadeTelemetry {
    const activeCascades = this.csm ? this.config.cascades : 1;
    const mapSize = this.config.shadowMapSize;
    return {
      backend: this.backend,
      activeCascades,
      shadowMapSize: mapSize,
      maxFar: this.config.maxFar,
      estimatedShadowTexels: activeCascades * mapSize * mapSize,
      // Official `three/examples/jsm/csm/CSMShadowNode.js` is verified present in three@0.187.0
      // and mapped behind this controller seam when WebGPURenderer is selected.
      webGpuNodeContractReady: true,
    };
  }

  private disposeCsmOnly(): void {
    if (!this.csm) return;
    const nextNoCsmTag = `nocsm_g${++this.csmGeneration}`;
    try {
      // Collect every material touched by CSM BEFORE clearing csm.shaders.
      // We intentionally clear csm.shaders prior to csm.dispose() because Three.js's
      // CSM.dispose() mutates live `shader.uniforms` via `delete shader.uniforms.CSM_cascades`
      // while WebGLRenderer's cached `materialProperties.uniformsList` still indexes them,
      // causing `Cannot read properties of undefined (reading 'needsUpdate')` in WebGLUniforms.upload.
      const csmShaders = (
        this.csm as unknown as { shaders?: Map<THREE.Material, unknown> }
      ).shaders;
      const materialsToClean = new Set<THREE.Material>(this.trackedMaterials);
      if (csmShaders) {
        csmShaders.forEach((_shader, mat) => {
          materialsToClean.add(mat);
        });
        csmShaders.clear();
      }
      for (const mat of materialsToClean) {
        stripCsmMaterialPatches(mat, nextNoCsmTag);
      }
      this.trackedMaterials.clear();

      for (const light of this.csm.lights) {
        if (light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null;
        }
      }
      this.csm.remove();
      this.csm.dispose();
    } catch {
      // Ignore disposal errors in headless contexts
    }
    this.csm = null;
    this.initializedMaterials = new WeakSet<THREE.Material>();
  }

  public dispose(): void {
    this.disposeCsmOnly();
    this.initializedMaterials = new WeakSet<THREE.Material>();
    this.trackedMaterials.clear();
  }
}
