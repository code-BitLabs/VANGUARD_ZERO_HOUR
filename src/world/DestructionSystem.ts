import * as THREE from 'three';
import type { PhysicsWorld } from '@/src/engine/physics/PhysicsWorld';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from '@/src/physics/SpatialHash';
import { VFXPool } from '@/src/effects/VFXPool';
import { AudioManager } from '@/src/audio/AudioManager';

export type DestructionColliderBackend = PhysicsWorld | SpatialHash;

function isPhysicsWorld(backend: DestructionColliderBackend): backend is PhysicsWorld {
  return 'addStaticCollider' in backend && typeof backend.addStaticCollider === 'function';
}

export type DestructibleKind =
  | 'barrel'
  | 'fuel_tank'
  | 'radar_relay'
  | 'weapons_cache'
  | 'glass_panel'
  | 'sandbag'
  | 'destructible_barrier'
  | 'searchlight_tower'
  | 'wooden_crate';
export type DestructionState = 'INTACT' | 'DAMAGED' | 'DESTROYED';

export interface DestructibleEntity {
  id: string;
  kind: DestructibleKind;
  isObjectiveTarget: boolean;
  position: THREE.Vector3;
  health: number;
  maxHealth: number;
  state: DestructionState;
  blastRadius: number;
  blastDamage: number;
  meshGroup: THREE.Group;
  collider: SpatialAABB;
}

interface DestructibleIntactSnapshot {
  readonly maxY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
  readonly rotX: number;
  readonly rotY: number;
  readonly rotZ: number;
  readonly meshMaterials: ReadonlyArray<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }>;
}

export class DestructionSystem {
  private entities = new Map<string, DestructibleEntity>();
  private intactSnapshots = new Map<string, DestructibleIntactSnapshot>();
  private cachedEntitiesList: DestructibleEntity[] = [];
  private entitiesDirty = false;
  private charredMaterial: THREE.MeshStandardMaterial | null = null;
  private prewarmProbeMesh: THREE.Mesh | null = null;
  private prewarmProbeScene: THREE.Scene | null = null;
  private onColliderRegionChanged?: (box: SpatialAABB) => void;

  constructor(
    private readonly colliderBackend: DestructionColliderBackend,
    private readonly vfx: VFXPool,
    private readonly audio: AudioManager
  ) {}

  private ensureCharredMaterial(): THREE.MeshStandardMaterial {
    if (!this.charredMaterial) {
      this.charredMaterial = new THREE.MeshStandardMaterial({
        color: 0x1f2428,
        emissive: 0x3a1204,
        emissiveIntensity: 0.4,
        roughness: 0.85,
        metalness: 0.25,
      });
    }
    return this.charredMaterial;
  }

  public prewarm(scene?: THREE.Scene): THREE.MeshStandardMaterial {
    const mat = this.ensureCharredMaterial();
    if (scene && !this.prewarmProbeMesh) {
      const geo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
      const probe = new THREE.Mesh(geo, mat);
      probe.position.set(0, -1000, 0);
      probe.frustumCulled = false;
      probe.matrixAutoUpdate = false;
      probe.updateMatrix();
      scene.add(probe);
      this.prewarmProbeMesh = probe;
      this.prewarmProbeScene = scene;
    }
    return mat;
  }

  private removePrewarmProbe(): void {
    if (this.prewarmProbeMesh) {
      this.prewarmProbeScene?.remove(this.prewarmProbeMesh);
      this.prewarmProbeMesh.geometry.dispose();
      this.prewarmProbeMesh = null;
      this.prewarmProbeScene = null;
    }
  }

  setOnColliderRegionChanged(cb?: (box: SpatialAABB) => void): void {
    this.onColliderRegionChanged = cb;
  }

  private insertCollider(box: SpatialAABB): void {
    if (isPhysicsWorld(this.colliderBackend)) {
      this.colliderBackend.addStaticCollider(box);
    } else {
      this.colliderBackend.insert(box);
    }
  }

  private syncUpdatedCollider(box: SpatialAABB): void {
    if (isPhysicsWorld(this.colliderBackend)) {
      this.colliderBackend.updateCollider(box);
    } else {
      this.colliderBackend.update(box);
    }
    this.onColliderRegionChanged?.(box);
  }

  private removeSyncedCollider(box: SpatialAABB): void {
    if (isPhysicsWorld(this.colliderBackend)) {
      this.colliderBackend.removeCollider(box);
    } else {
      this.colliderBackend.remove(box);
    }
  }

  register(entity: DestructibleEntity): void {
    entity.meshGroup.userData.noMerge = true;
    entity.meshGroup.userData.isDestructible = true;
    const meshMaterials: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }> = [];
    entity.meshGroup.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.userData.noMerge = true;
        c.userData.isDestructible = true;
        meshMaterials.push({ mesh: c, material: c.material });
      }
    });
    this.intactSnapshots.set(entity.id, {
      maxY: entity.collider.maxY,
      scaleX: entity.meshGroup.scale.x,
      scaleY: entity.meshGroup.scale.y,
      scaleZ: entity.meshGroup.scale.z,
      rotX: entity.meshGroup.rotation.x,
      rotY: entity.meshGroup.rotation.y,
      rotZ: entity.meshGroup.rotation.z,
      meshMaterials,
    });
    this.entities.set(entity.id, entity);
    this.entitiesDirty = true;
    this.insertCollider(entity.collider);
  }

  applyDamage(
    id: string,
    damage: number,
    onExplosion?: (x: number, y: number, z: number, radius: number, dmg: number) => void,
    onObjectiveDestroyed?: (entity: DestructibleEntity) => void
  ): boolean {
    const ent = this.entities.get(id);
    if (!ent || ent.state === 'DESTROYED') return false;

    ent.health -= damage;

    if (ent.health > 0 && ent.health <= ent.maxHealth * 0.5 && ent.state === 'INTACT') {
      ent.state = 'DAMAGED';
      this.vfx.spawnImpact(ent.position.x, ent.position.y + 1.1, ent.position.z, 'metal');
      ent.meshGroup.rotation.z += 0.04;
      if (ent.kind === 'destructible_barrier' || ent.kind === 'sandbag') {
        const origH = ent.collider.maxY - ent.collider.minY;
        ent.collider.maxY = ent.collider.minY + origH * 0.65;
        this.syncUpdatedCollider(ent.collider);
        ent.meshGroup.scale.y = 0.65;
      }
      return false;
    }

    if (ent.health <= 0) {
      ent.health = 0;
      ent.state = 'DESTROYED';

      if (ent.kind === 'glass_panel' || ent.kind === 'destructible_barrier') {
        this.removeSyncedCollider(ent.collider);
        this.onColliderRegionChanged?.(ent.collider);
        ent.meshGroup.visible = false;
        this.vfx.spawnImpact(ent.position.x, ent.position.y + 1, ent.position.z, 'concrete');
      } else if (ent.kind === 'wooden_crate') {
        this.removeSyncedCollider(ent.collider);
        this.onColliderRegionChanged?.(ent.collider);
        ent.meshGroup.visible = false;
        this.vfx.spawnImpact(ent.position.x, ent.position.y + 0.7, ent.position.z, 'dirt');
        this.audio.playSpatial('explosion', ent.position.x, ent.position.y, ent.position.z, 5, 0.35);
      } else if (ent.kind === 'searchlight_tower') {
        this.removeSyncedCollider(ent.collider);
        this.onColliderRegionChanged?.(ent.collider);
        const beam = ent.meshGroup.getObjectByName('searchlight_beam');
        if (beam) beam.visible = false;
        const head = ent.meshGroup.getObjectByName('searchlight_head');
        if (head) head.visible = false;
        ent.meshGroup.scale.set(1.0, 0.42, 1.0);
        this.vfx.spawnExplosion(ent.position.x, ent.position.y + 5.2, ent.position.z, 1.15);
        this.audio.playSpatial('explosion', ent.position.x, ent.position.y + 5.0, ent.position.z, 8, 0.8);
      } else if (ent.kind === 'sandbag') {
        this.removeSyncedCollider(ent.collider);
        this.onColliderRegionChanged?.(ent.collider);
        ent.meshGroup.scale.y = 0.25;
        this.vfx.spawnImpact(ent.position.x, ent.position.y + 0.6, ent.position.z, 'dirt');
      } else {
        // Explosive barrels, fuel tanks, radars, and weapons caches
        this.removeSyncedCollider(ent.collider);
        this.onColliderRegionChanged?.(ent.collider);
        ent.meshGroup.scale.set(1.05, 0.28, 1.05);
        const charredMat = this.ensureCharredMaterial();
        ent.meshGroup.traverse((c) => {
          if (c instanceof THREE.Mesh && c.material instanceof THREE.MeshStandardMaterial) {
            c.material = charredMat;
          }
        });

        const scale = ent.kind === 'fuel_tank' ? 1.8 : 1.15;
        this.vfx.spawnExplosion(ent.position.x, ent.position.y + 0.8, ent.position.z, scale);
        this.audio.playSpatial('explosion', ent.position.x, ent.position.y, ent.position.z, 9, 0.9);
        if (ent.blastRadius > 0) {
          onExplosion?.(ent.position.x, ent.position.y + 0.8, ent.position.z, ent.blastRadius, ent.blastDamage);
        }
      }

      if (ent.isObjectiveTarget) {
        onObjectiveDestroyed?.(ent);
      }
      return true;
    }
    return false;
  }

  /**
   * Transitions a destructible entity to its post-destruction visual and collider state
   * during checkpoint reconstruction without triggering VFX explosions, spatial audio,
   * objective callbacks, or bonus points.
   */
  markDestroyedSilently(id: string): boolean {
    const ent = this.entities.get(id);
    if (!ent || ent.state === 'DESTROYED') return false;

    ent.health = 0;
    ent.state = 'DESTROYED';
    this.removeSyncedCollider(ent.collider);
    this.onColliderRegionChanged?.(ent.collider);

    if (ent.kind === 'glass_panel' || ent.kind === 'destructible_barrier' || ent.kind === 'wooden_crate') {
      ent.meshGroup.visible = false;
    } else if (ent.kind === 'searchlight_tower') {
      const beam = ent.meshGroup.getObjectByName('searchlight_beam');
      if (beam) beam.visible = false;
      const head = ent.meshGroup.getObjectByName('searchlight_head');
      if (head) head.visible = false;
      ent.meshGroup.scale.set(1.0, 0.42, 1.0);
    } else if (ent.kind === 'sandbag') {
      ent.meshGroup.scale.y = 0.25;
    } else {
      ent.meshGroup.scale.set(1.05, 0.28, 1.05);
      const charredMat = this.ensureCharredMaterial();
      ent.meshGroup.traverse((c) => {
        if (c instanceof THREE.Mesh && c.material instanceof THREE.MeshStandardMaterial) {
          c.material = charredMat;
        }
      });
    }
    return true;
  }

  getById(id: string): DestructibleEntity | undefined {
    return this.entities.get(id);
  }

  getAll(): readonly DestructibleEntity[] {
    if (this.entitiesDirty) {
      this.cachedEntitiesList.length = 0;
      for (const ent of this.entities.values()) {
        this.cachedEntitiesList.push(ent);
      }
      this.entitiesDirty = false;
    }
    return this.cachedEntitiesList;
  }

  getByKind(kind: DestructibleKind): DestructibleEntity[] {
    const out: DestructibleEntity[] = [];
    const all = this.getAll();
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e.kind === kind && e.state !== 'DESTROYED') {
        out.push(e);
      }
    }
    return out;
  }

  /**
   * Restores every registered destructible to its original intact health, visual materials,
   * transforms, visibility, and full collider bounds in place (<1ms, zero geometry rebuild).
   */
  restoreAllIntact(): number {
    let restored = 0;
    for (const ent of this.entities.values()) {
      const snap = this.intactSnapshots.get(ent.id);
      const wasDestroyed = ent.state === 'DESTROYED';
      const wasDamaged = ent.state === 'DAMAGED';
      if (wasDestroyed || wasDamaged) {
        restored++;
      }

      ent.health = ent.maxHealth;
      ent.state = 'INTACT';
      ent.meshGroup.visible = true;

      if (snap) {
        ent.collider.maxY = snap.maxY;
        ent.meshGroup.scale.set(snap.scaleX, snap.scaleY, snap.scaleZ);
        ent.meshGroup.rotation.set(snap.rotX, snap.rotY, snap.rotZ);
        for (let i = 0; i < snap.meshMaterials.length; i++) {
          const rec = snap.meshMaterials[i];
          rec.mesh.material = rec.material;
          rec.mesh.visible = true;
        }
      } else {
        ent.meshGroup.scale.set(1, 1, 1);
      }

      if (ent.kind === 'searchlight_tower') {
        const beam = ent.meshGroup.getObjectByName('searchlight_beam');
        if (beam) beam.visible = true;
        const head = ent.meshGroup.getObjectByName('searchlight_head');
        if (head) head.visible = true;
      }

      if (wasDestroyed) {
        this.insertCollider(ent.collider);
        this.onColliderRegionChanged?.(ent.collider);
      } else if (wasDamaged) {
        this.syncUpdatedCollider(ent.collider);
      }
    }
    return restored;
  }

  clear(): void {
    for (const ent of this.entities.values()) {
      this.removeSyncedCollider(ent.collider);
    }
    this.entities.clear();
    this.intactSnapshots.clear();
    this.cachedEntitiesList.length = 0;
    this.entitiesDirty = false;
    this.removePrewarmProbe();
  }

  dispose(): void {
    this.clear();
    this.charredMaterial?.dispose();
    this.charredMaterial = null;
  }
}

export function createDestructibleCollider(
  id: string,
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number
): SpatialAABB {
  return {
    id,
    minX: x - hx,
    minY: y,
    minZ: z - hz,
    maxX: x + hx,
    maxY: y + hy,
    maxZ: z + hz,
    layer: COLLISION_LAYER.DESTRUCTIBLE,
    tag: 'destructible',
  };
}
