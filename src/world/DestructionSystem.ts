import * as THREE from 'three';
import { COLLISION_LAYER, SpatialAABB, SpatialHash } from '@/src/physics/SpatialHash';
import { VFXPool } from '@/src/effects/VFXPool';
import { AudioManager } from '@/src/audio/AudioManager';

export type DestructibleKind =
  | 'barrel'
  | 'fuel_tank'
  | 'radar_relay'
  | 'weapons_cache'
  | 'glass_panel'
  | 'sandbag'
  | 'destructible_barrier';
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

export class DestructionSystem {
  private entities = new Map<string, DestructibleEntity>();
  private charredMaterial: THREE.MeshStandardMaterial | null = null;

  constructor(
    private readonly spatialHash: SpatialHash,
    private readonly vfx: VFXPool,
    private readonly audio: AudioManager
  ) {}

  register(entity: DestructibleEntity): void {
    this.entities.set(entity.id, entity);
    this.spatialHash.insert(entity.collider);
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
        this.spatialHash.update(ent.collider);
        ent.meshGroup.scale.y = 0.65;
      }
      return false;
    }

    if (ent.health <= 0) {
      ent.health = 0;
      ent.state = 'DESTROYED';

      if (ent.kind === 'glass_panel' || ent.kind === 'destructible_barrier') {
        this.spatialHash.remove(ent.collider);
        ent.meshGroup.visible = false;
        this.vfx.spawnImpact(ent.position.x, ent.position.y + 1, ent.position.z, 'concrete');
      } else if (ent.kind === 'sandbag') {
        this.spatialHash.remove(ent.collider);
        ent.meshGroup.scale.y = 0.25;
        this.vfx.spawnImpact(ent.position.x, ent.position.y + 0.6, ent.position.z, 'dirt');
      } else {
        // Explosive barrels, fuel tanks, radars, and weapons caches
        this.spatialHash.remove(ent.collider);
        ent.meshGroup.scale.set(1.05, 0.28, 1.05);
        if (!this.charredMaterial) {
          this.charredMaterial = new THREE.MeshStandardMaterial({
            color: 0x1f2428,
            emissive: 0x3a1204,
            emissiveIntensity: 0.4,
            roughness: 0.85,
            metalness: 0.25,
          });
        }
        const charredMat = this.charredMaterial;
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

  getAll(): DestructibleEntity[] {
    return Array.from(this.entities.values());
  }

  getByKind(kind: DestructibleKind): DestructibleEntity[] {
    return Array.from(this.entities.values()).filter((e) => e.kind === kind && e.state !== 'DESTROYED');
  }

  clear(): void {
    for (const ent of this.entities.values()) {
      this.spatialHash.remove(ent.collider);
    }
    this.entities.clear();
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
  };
}
