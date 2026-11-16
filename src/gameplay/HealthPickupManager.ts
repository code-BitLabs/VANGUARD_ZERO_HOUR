import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { MapId } from '@/src/schemas/common.schema';
import { PlayerController } from './PlayerController';

export interface HealthPickupItem {
  id: string;
  source: 'station' | 'drop' | 'map_station';
  sourceEnemyId: string | null;
  position: THREE.Vector3;
  baseY: number;
  healAmount: number;
  collected: boolean;
  phase: number;
  meshGroup: THREE.Group;
}

export const HEALTH_PICKUP_RADIUS = 2.25;
export const HEALTH_PICKUP_HEAL_AMOUNT = 35;
export const MAX_ACTIVE_ENEMY_HEALTH_DROPS = 3;

const MAP_MED_STATION_COORDS: Record<MapId, ReadonlyArray<{ x: number; z: number }>> = {
  warzone_city: [
    { x: -14, z: 36 },
    { x: 16, z: 10 },
    { x: -12, z: -18 },
    { x: 14, z: -48 },
  ],
  desert_base: [
    { x: -12, z: 32 },
    { x: 14, z: 2 },
    { x: -16, z: -26 },
    { x: 12, z: -50 },
  ],
  jungle_zone: [
    { x: -10, z: 38 },
    { x: 15, z: 8 },
    { x: -14, z: -20 },
    { x: 8, z: -46 },
  ],
  industrial_complex: [
    { x: -16, z: 36 },
    { x: 18, z: 6 },
    { x: -14, z: -22 },
    { x: 10, z: -52 },
  ],
};

interface SharedHeartResources {
  lobeGeo: THREE.SphereGeometry;
  coneGeo: THREE.ConeGeometry;
  crossHGeo: THREE.BoxGeometry;
  crossVGeo: THREE.BoxGeometry;
  ringGeo: THREE.RingGeometry;
  heartMat: THREE.MeshStandardMaterial;
  crossMat: THREE.MeshStandardMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

export class HealthPickupManager {
  private pickups: HealthPickupItem[] = [];
  private sharedRes: SharedHeartResources | null = null;
  private evaluatedEnemyIds = new Set<string>();
  private seq = 0;
  private nearbyFullHealthPrompt: string | null = null;
  private fullHealthSubtitleCooldown = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly resourceManager: ResourceManager,
    private readonly vfx: VFXPool,
    private readonly audio: AudioManager
  ) {}

  private ensureSharedResources(scope: ResourceScope = 'mission:world'): SharedHeartResources {
    if (this.sharedRes) return this.sharedRes;

    const lobeGeo = new THREE.SphereGeometry(0.22, 12, 10);
    const coneGeo = new THREE.ConeGeometry(0.31, 0.44, 12);
    const crossHGeo = new THREE.BoxGeometry(0.24, 0.07, 0.28);
    const crossVGeo = new THREE.BoxGeometry(0.07, 0.24, 0.28);
    const ringGeo = new THREE.RingGeometry(0.42, 0.56, 20);
    ringGeo.rotateX(-Math.PI / 2);

    const heartMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.65,
      roughness: 0.28,
      metalness: 0.18,
    });
    const crossMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfef2f2,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.1,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf87171,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.68,
    });

    this.resourceManager.registerGeometry(lobeGeo, scope, 'health_pickup_lobe_geo');
    this.resourceManager.registerGeometry(coneGeo, scope, 'health_pickup_cone_geo');
    this.resourceManager.registerGeometry(crossHGeo, scope, 'health_pickup_cross_h_geo');
    this.resourceManager.registerGeometry(crossVGeo, scope, 'health_pickup_cross_v_geo');
    this.resourceManager.registerGeometry(ringGeo, scope, 'health_pickup_ring_geo');

    this.resourceManager.registerMaterial(heartMat, scope, 'health_pickup_heart_mat');
    this.resourceManager.registerMaterial(crossMat, scope, 'health_pickup_cross_mat');
    this.resourceManager.registerMaterial(ringMat, scope, 'health_pickup_ring_mat');

    this.sharedRes = {
      lobeGeo,
      coneGeo,
      crossHGeo,
      crossVGeo,
      ringGeo,
      heartMat,
      crossMat,
      ringMat,
    };
    return this.sharedRes;
  }

  private buildHeartMeshGroup(res: SharedHeartResources, scope: ResourceScope): THREE.Group {
    const group = new THREE.Group();
    const heartCore = new THREE.Group();

    const leftLobe = new THREE.Mesh(res.lobeGeo, res.heartMat);
    leftLobe.position.set(-0.14, 0.14, 0);
    const rightLobe = new THREE.Mesh(res.lobeGeo, res.heartMat);
    rightLobe.position.set(0.14, 0.14, 0);

    const lowerTip = new THREE.Mesh(res.coneGeo, res.heartMat);
    lowerTip.rotation.x = Math.PI;
    lowerTip.position.set(0, -0.11, 0);

    const crossH = new THREE.Mesh(res.crossHGeo, res.crossMat);
    crossH.position.set(0, 0.05, 0);
    const crossV = new THREE.Mesh(res.crossVGeo, res.crossMat);
    crossV.position.set(0, 0.05, 0);

    heartCore.add(leftLobe, rightLobe, lowerTip, crossH, crossV);
    heartCore.position.y = 0.85;

    const baseRing = new THREE.Mesh(res.ringGeo, res.ringMat);
    baseRing.position.y = 0.05;

    group.add(heartCore, baseRing);
    this.scene.add(group);
    this.resourceManager.register('object3d', scope, () => {
      this.scene.remove(group);
    });

    return group;
  }

  spawnMapMedStations(mapId: MapId, collision: CollisionWorld, scope: ResourceScope): void {
    const coords = MAP_MED_STATION_COORDS[mapId] ?? MAP_MED_STATION_COORDS.warzone_city;
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      const y = collision.getGroundHeightAt(c.x, c.z);
      this.spawnPickup(
        { x: c.x, y, z: c.z },
        'station',
        scope,
        null,
        HEALTH_PICKUP_HEAL_AMOUNT
      );
    }
  }

  spawnPickup(
    pos: { x: number; y: number; z: number },
    source: 'station' | 'drop' | 'map_station',
    scope: ResourceScope,
    sourceEnemyId: string | null = null,
    healAmount = HEALTH_PICKUP_HEAL_AMOUNT
  ): HealthPickupItem {
    const res = this.ensureSharedResources('mission:world');
    const group = this.buildHeartMeshGroup(res, scope);
    group.position.set(pos.x, pos.y, pos.z);

    const item: HealthPickupItem = {
      id: `heart_pickup_${++this.seq}`,
      source,
      sourceEnemyId,
      position: new THREE.Vector3(pos.x, pos.y, pos.z),
      baseY: pos.y,
      healAmount,
      collected: false,
      phase: (this.seq * 1.1) % (Math.PI * 2),
      meshGroup: group,
    };
    this.pickups.push(item);
    return item;
  }

  /**
   * Guarantees each enemy is evaluated at most once for a health drop.
   * Respects MAX_ACTIVE_ENEMY_HEALTH_DROPS to prevent farming.
   */
  tryEvaluateEnemyDrop(
    enemy: { id: string; position: { x: number; y: number; z: number }; healthDropEvaluated?: boolean },
    playerHealth: number,
    playerMaxHealth: number,
    scope: ResourceScope,
    deterministicRoll?: number
  ): boolean {
    if (enemy.healthDropEvaluated || this.evaluatedEnemyIds.has(enemy.id)) {
      return false;
    }
    enemy.healthDropEvaluated = true;
    this.evaluatedEnemyIds.add(enemy.id);

    const activeDrops = this.getActiveDropCount();
    if (activeDrops >= MAX_ACTIVE_ENEMY_HEALTH_DROPS) {
      return false;
    }

    // Balanced drop rate: higher chance when player is damaged (< 85% HP), modest baseline otherwise
    const dropChance =
      playerHealth < playerMaxHealth * 0.55
        ? 0.55
        : playerHealth < playerMaxHealth * 0.88
          ? 0.35
          : 0.2;
    const roll = deterministicRoll !== undefined ? deterministicRoll : Math.random();
    if (roll > dropChance) {
      return false;
    }

    this.spawnPickup(
      { x: enemy.position.x, y: enemy.position.y, z: enemy.position.z },
      'drop',
      scope,
      enemy.id,
      HEALTH_PICKUP_HEAL_AMOUNT
    );
    return true;
  }

  update(
    dt: number,
    player: PlayerController,
    inVehicle: boolean,
    onAlert?: (msg: string, dur: number) => void,
    onSubtitle?: (msg: string, dur: number) => void
  ): void {
    this.nearbyFullHealthPrompt = null;
    if (this.fullHealthSubtitleCooldown > 0) {
      this.fullHealthSubtitleCooldown = Math.max(0, this.fullHealthSubtitleCooldown - dt);
    }
    const radiusSq = HEALTH_PICKUP_RADIUS * HEALTH_PICKUP_RADIUS;

    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (p.collected) continue;

      p.phase += dt * 2.8;
      const heartCore = p.meshGroup.children[0];
      if (heartCore) {
        heartCore.position.y = 0.82 + Math.sin(p.phase) * 0.11;
        heartCore.rotation.y += dt * 1.65;
      }

      if (!player.alive || inVehicle) continue;

      const dx = player.position.x - p.position.x;
      const dz = player.position.z - p.position.z;
      const dy = Math.abs(player.position.y - p.position.y);
      const horizDistSq = dx * dx + dz * dz;

      if (horizDistSq <= radiusSq && dy <= 2.4) {
        if (player.health < player.maxHealth - 0.01) {
          const healed = player.heal(p.healAmount);
          const actualHealed = Math.max(1, Math.round(healed));
          p.collected = true;
          p.meshGroup.visible = false;
          this.scene.remove(p.meshGroup);
          this.vfx.spawnImpact(p.position.x, p.position.y + 0.9, p.position.z, 'metal');
          this.audio.play2D('ui_click', 6, 0.65);
          onAlert?.(
            `HEART MEDKIT COLLECTED: +${actualHealed} HP (${Math.round(player.health)}/${player.maxHealth})`,
            2.4
          );
        } else {
          this.nearbyFullHealthPrompt = 'HEART MEDKIT NEARBY — HEALTH FULL (100/100)';
          if (this.fullHealthSubtitleCooldown <= 0) {
            this.fullHealthSubtitleCooldown = 3.2;
            onSubtitle?.('MEDKIT: Health already full (100/100) — saved for combat recovery.', 2.4);
          }
        }
      }
    }
  }

  getNearbyFullHealthPrompt(): string | null {
    return this.nearbyFullHealthPrompt;
  }

  getActivePickups(): readonly HealthPickupItem[] {
    return this.pickups.filter((p) => !p.collected);
  }

  getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < this.pickups.length; i++) {
      if (!this.pickups[i].collected) count++;
    }
    return count;
  }

  getActiveDropCount(): number {
    let count = 0;
    for (let i = 0; i < this.pickups.length; i++) {
      if (!this.pickups[i].collected && this.pickups[i].source === 'drop') {
        count++;
      }
    }
    return count;
  }

  getActiveEnemyDropCount(): number {
    return this.getActiveDropCount();
  }

  clear(): void {
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      p.meshGroup.visible = false;
      this.scene.remove(p.meshGroup);
    }
    this.pickups.length = 0;
    this.evaluatedEnemyIds.clear();
    this.nearbyFullHealthPrompt = null;
    this.fullHealthSubtitleCooldown = 0;
    this.sharedRes = null;
  }
}
