import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { EnemyArchetype } from '@/src/schemas/enemy.schema';
import { HOSTILE_FACTION_PALETTES } from '@/src/world/VisualBible';
import type { SoldierRigBuild } from './EnemyRigBuilder';

export interface EnemyArchetypeMaterials {
  readonly armorMat: THREE.MeshStandardMaterial;
  readonly uniformMat: THREE.MeshStandardMaterial;
  readonly trimMat: THREE.MeshStandardMaterial;
  readonly skinMat: THREE.MeshStandardMaterial;
  readonly gunMat: THREE.MeshStandardMaterial;
  readonly visorMat: THREE.MeshStandardMaterial;
  readonly flashMat: THREE.MeshBasicMaterial;
  readonly shadowMat: THREE.MeshBasicMaterial;
}

/**
 * Flyweight PBR geometry & material palette scoped to a (ResourceManager, ResourceScope).
 * Eliminates N-fold per-enemy BufferGeometry & Material duplication across waves while
 * guaranteeing zero leaks when ResourceManager.unloadScope(scope) runs.
 */
export class EnemyArchetypeVisualPalette {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.Material>();

  constructor(
    private readonly resourceManager: ResourceManager,
    private readonly scope: ResourceScope
  ) {}

  getOrCreateGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geo = this.geometries.get(key);
    if (!geo) {
      geo = factory();
      this.resourceManager.registerGeometry(geo, this.scope, `enemy_geo:${this.scope}:${key}`);
      this.geometries.set(key, geo);
    }
    return geo;
  }

  private getOrCreateMaterial<T extends THREE.Material>(key: string, factory: () => T): T {
    let mat = this.materials.get(key) as T | undefined;
    if (!mat) {
      mat = factory();
      this.resourceManager.registerMaterial(mat, this.scope, `enemy_mat:${this.scope}:${key}`);
      this.materials.set(key, mat);
    }
    return mat;
  }

  getMaterialsFor(archetype: EnemyArchetype, accentHex: string): EnemyArchetypeMaterials {
    const palette = HOSTILE_FACTION_PALETTES[archetype];
    const resolvedAccent = accentHex || `#${palette.primaryArmorColorHex.toString(16).padStart(6, '0')}`;
    const armorKey = `armor:${archetype}:${resolvedAccent}`;

    const armorMat = this.getOrCreateMaterial(armorKey, () => {
      const baseColor = new THREE.Color(accentHex || palette.primaryArmorColorHex);
      return new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: baseColor.clone().multiplyScalar(0.18),
        emissiveIntensity: 0.55,
        roughness: palette.armorRoughness,
        metalness: palette.armorMetalness,
      });
    });

    const uniformMat = this.getOrCreateMaterial(`uniform:${archetype}`, () => {
      return new THREE.MeshStandardMaterial({
        color: palette.secondaryFabricColorHex,
        roughness: 0.74,
        metalness: 0.14,
      });
    });

    const trimMat = this.getOrCreateMaterial(`trim:${archetype}`, () => {
      return new THREE.MeshStandardMaterial({
        color: palette.accentIdentificationColorHex,
        roughness: 0.52,
        metalness: 0.38,
      });
    });

    const skinMat = this.getOrCreateMaterial('shared:skin', () => {
      return new THREE.MeshStandardMaterial({ color: 0x3a3029, roughness: 0.82 });
    });

    const gunMat = this.getOrCreateMaterial('shared:gun', () => {
      return new THREE.MeshStandardMaterial({ color: 0x181c22, metalness: 0.84, roughness: 0.28 });
    });

    const visorMat = this.getOrCreateMaterial(`visor:${archetype}`, () => {
      return new THREE.MeshStandardMaterial({
        color: palette.opticGlowColorHex,
        emissive: palette.opticGlowColorHex,
        emissiveIntensity: 1.4,
      });
    });

    const flashMat = this.getOrCreateMaterial('shared:flash', () => {
      return new THREE.MeshBasicMaterial({
        color: 0xfde047,
        transparent: true,
        opacity: 0.92,
      });
    });

    const shadowMat = this.getOrCreateMaterial('shared:shadow', () => {
      return new THREE.MeshBasicMaterial({
        color: 0x05070a,
        transparent: true,
        opacity: 0.44,
        depthWrite: false,
      });
    });

    return {
      armorMat,
      uniformMat,
      trimMat,
      skinMat,
      gunMat,
      visorMat,
      flashMat,
      shadowMat,
    };
  }

  getGeometryCount(): number {
    return this.geometries.size;
  }

  getMaterialCount(): number {
    return this.materials.size;
  }

  clear(): void {
    this.geometries.clear();
    this.materials.clear();
  }
}

const paletteCacheByManager = new WeakMap<
  ResourceManager,
  Map<ResourceScope, EnemyArchetypeVisualPalette>
>();

/**
 * Returns the Flyweight palette bound to (resourceManager, scope), registering an automatic
 * eviction hook on scope unload so disposed geometries/materials are never reused.
 */
export function getOrCreateEnemyPalette(
  resourceManager: ResourceManager,
  scope: ResourceScope
): EnemyArchetypeVisualPalette {
  let byScope = paletteCacheByManager.get(resourceManager);
  if (!byScope) {
    byScope = new Map();
    paletteCacheByManager.set(resourceManager, byScope);
  }
  let palette = byScope.get(scope);
  if (!palette) {
    palette = new EnemyArchetypeVisualPalette(resourceManager, scope);
    byScope.set(scope, palette);
    const scopeMapRef = byScope;
    const paletteRef = palette;
    resourceManager.register(
      'other',
      scope,
      () => {
        paletteRef.clear();
        if (scopeMapRef.get(scope) === paletteRef) {
          scopeMapRef.delete(scope);
        }
      },
      `enemy_palette_cache:${scope}`
    );
  }
  return palette;
}

export interface PooledSoldierEntry {
  readonly rig: SoldierRigBuild;
  readonly isRecycled: boolean;
}

/**
 * Object pool for articulated enemy soldier rigs keyed by (scope, archetype, accentHex).
 * Resets all joint transforms to neutral rest pose on acquire/release so recycled corpse rigs
 * can re-enter combat instantaneously with zero Mesh/Group allocations.
 */
export class EnemyRigPool {
  public static readonly MAX_ACTIVE_CORPSES = 8;

  private readonly freeByKey = new Map<string, SoldierRigBuild[]>();
  private activeScope: ResourceScope | null = null;

  acquire(
    archetype: EnemyArchetype,
    accentHex: string,
    scope: ResourceScope,
    buildFn: () => SoldierRigBuild
  ): PooledSoldierEntry {
    if (this.activeScope !== null && this.activeScope !== scope) {
      this.freeByKey.clear();
    }
    this.activeScope = scope;

    const key = `${archetype}|${accentHex}`;
    const bucket = this.freeByKey.get(key);
    if (bucket && bucket.length > 0) {
      const rig = bucket.pop()!;
      this.resetRigPose(rig);
      rig.root.visible = true;
      return { rig, isRecycled: true };
    }

    return { rig: buildFn(), isRecycled: false };
  }

  release(archetype: EnemyArchetype, accentHex: string, rig: SoldierRigBuild): void {
    rig.muzzleFlash.visible = false;
    rig.root.visible = false;
    this.resetRigPose(rig);
    const key = `${archetype}|${accentHex}`;
    let bucket = this.freeByKey.get(key);
    if (!bucket) {
      bucket = [];
      this.freeByKey.set(key, bucket);
    }
    if (bucket.length < 24) {
      bucket.push(rig);
    }
  }

  resetRigPose(rig: SoldierRigBuild): void {
    const hipY = rig.hipRestY;
    rig.root.rotation.set(0, 0, 0);
    rig.pelvisGroup.position.set(0, hipY, 0);
    rig.pelvisGroup.rotation.set(0, 0, 0);
    rig.torsoGroup.position.set(0, hipY, 0);
    rig.torsoGroup.rotation.set(0, 0, 0);
    rig.leftLeg.position.y = hipY;
    rig.leftLeg.rotation.set(0, 0, 0);
    rig.rightLeg.position.y = hipY;
    rig.rightLeg.rotation.set(0, 0, 0);
    rig.leftKnee.rotation.set(0, 0, 0);
    rig.rightKnee.rotation.set(0, 0, 0);
    rig.weaponArm.rotation.set(0, 0, 0);
    rig.rightForearm.rotation.set(0, 0, 0);
    rig.leftArm.rotation.set(0, 0, 0);
    rig.leftForearm.rotation.set(0, 0, 0);
    rig.headMesh.rotation.set(0, 0, 0);
    rig.muzzleFlash.visible = false;
  }

  getPooledCount(): number {
    let total = 0;
    for (const bucket of this.freeByKey.values()) {
      total += bucket.length;
    }
    return total;
  }

  clear(scene?: THREE.Scene): void {
    if (scene) {
      for (const bucket of this.freeByKey.values()) {
        for (const rig of bucket) {
          scene.remove(rig.root);
        }
      }
    }
    this.freeByKey.clear();
    this.activeScope = null;
  }
}
