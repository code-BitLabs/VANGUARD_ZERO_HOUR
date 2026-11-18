import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceScope } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { PerformanceMonitor } from '@/src/engine/PerformanceMonitor';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { AirCombatManager, AirUnit } from './AirCombatManager';
import { SOLID_OBSTRUCTION_MASK } from './BallisticSolver';
import { CombatTelemetryRecorder } from './CombatTelemetryRecorder';
import { EnemyManager, EnemyUnit } from './EnemyManager';
import { ExplosiveCallbacks, ExplosiveManager } from './ExplosiveManager';
import { HealthPickupManager } from './HealthPickupManager';
import { MissionDirector } from './MissionDirector';
import { PlayerController } from './PlayerController';
import { ExplosionEvent } from './ProjectileManager';
import { VehicleEntity, VehicleManager } from './VehicleManager';
import { HitscanTarget, WeaponSystem } from './WeaponSystem';

export interface CombatDamageDependencies {
  readonly audio: AudioManager;
  readonly vfx: VFXPool;
  readonly collisionWorld: CollisionWorld;
  readonly player: PlayerController;
  readonly weapons: WeaponSystem;
  readonly enemies: EnemyManager;
  readonly vehicles: VehicleManager;
  readonly airCombat: AirCombatManager;
  readonly explosives: ExplosiveManager;
  readonly destruction: DestructionSystem;
  readonly healthPickups: HealthPickupManager;
  readonly monitor: PerformanceMonitor;
  readonly telemetry?: CombatTelemetryRecorder;
  readonly getMissionDirector: () => MissionDirector | null;
  readonly getActiveScope: () => ResourceScope | null;
}

/**
 * TRN-02B: Extracted combat damage and target-resolution coordinator.
 * Centralizes hitscan target callbacks, vehicle turret raycast checks,
 * destructible world damage routing, and explosion event dispatch without
 * creating a second collision or combat authority.
 */
export class CombatDamageResolver {
  private readonly _hitscanTargetsScratch: HitscanTarget[] = [];
  private readonly _lockCandidatesScratch: Array<{
    id: string;
    alive: boolean;
    position: THREE.Vector3;
    label: string;
  }> = [];
  private readonly _proxScratch: Array<{ position: THREE.Vector3; radius: number }> = [];
  private readonly _turretRayHit: RayHit = {
    hit: false,
    distance: 110,
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    collider: null,
  };

  private readonly cachedExplosiveCallbacks: ExplosiveCallbacks;

  constructor(private readonly deps: CombatDamageDependencies) {
    this.cachedExplosiveCallbacks = {
      onEnemyKilled: (unit, weaponLabel) => {
        gameSessionStore.getState().triggerHit(false, true, 120);
        this.deps.telemetry?.recordPlayerKill(weaponLabel);
        this.deps.getMissionDirector()?.onEnemyKilled(false, 120);
        const scope = this.deps.getActiveScope();
        if (scope) {
          this.deps.healthPickups.tryEvaluateEnemyDrop(
            unit,
            this.deps.player.health,
            this.deps.player.maxHealth,
            scope
          );
        }
        gameSessionStore.getState().pushKillFeed({
          id: `${unit.id}_${Date.now()}`,
          killer: 'VANGUARD-1',
          victim: unit.displayName,
          weaponName: weaponLabel,
          isHeadshot: false,
          timestamp: Date.now(),
        });
      },
      onAirKilled: (unit, weaponLabel) => {
        gameSessionStore.getState().triggerHit(false, true, 180);
        this.deps.telemetry?.recordPlayerKill(weaponLabel);
        this.deps.getMissionDirector()?.onAirUnitKilled(350, unit.type);
        gameSessionStore.getState().pushKillFeed({
          id: `${unit.id}_${Date.now()}`,
          killer: 'VANGUARD-1',
          victim: unit.displayName,
          weaponName: weaponLabel,
          isHeadshot: false,
          timestamp: Date.now(),
        });
      },
      onConvoyDestroyed: () => {
        this.deps.telemetry?.recordPlayerKill('Ordnance');
        this.deps.getMissionDirector()?.onConvoyVehicleDestroyed(400);
      },
      onDestructibleDestroyed: (id, kind, explosiveId, distanceMeters) => {
        const isAuthorizedC4 =
          explosiveId === 'c4_charge' && (distanceMeters ?? 0) <= 6.5;
        this.deps
          .getMissionDirector()
          ?.onDestructibleTargetDestroyed(
            300,
            kind,
            id,
            isAuthorizedC4 ? 'c4' : 'explosion'
          );
      },
      onAlert: (msg, dur) => {
        this.deps.getMissionDirector()?.showAlert(msg, dur);
      },
    };
  }

  getExplosiveCallbacks(): ExplosiveCallbacks {
    return this.cachedExplosiveCallbacks;
  }

  collectFrameTargets(): {
    hitscanTargets: HitscanTarget[];
    lockCandidates: Array<{ id: string; alive: boolean; position: THREE.Vector3; label: string }>;
  } {
    this._hitscanTargetsScratch.length = 0;
    this.deps.enemies.fillHitscanTargets(this._hitscanTargetsScratch, this.onEnemyHitscanHit);
    this.deps.airCombat.fillHitscanTargets(this._hitscanTargetsScratch, this.onAirHitscanHit);
    this.deps.vehicles.fillHitscanTargets(this._hitscanTargetsScratch, this.onVehicleHitscanHit);

    this._lockCandidatesScratch.length = 0;
    this.deps.airCombat.fillLockCandidates(this._lockCandidatesScratch);
    this.deps.vehicles.fillLockCandidates(this._lockCandidatesScratch);

    return {
      hitscanTargets: this._hitscanTargetsScratch,
      lockCandidates: this._lockCandidatesScratch,
    };
  }

  collectProximityPositions(): Array<{ position: THREE.Vector3; radius: number }> {
    this._proxScratch.length = 0;
    this.deps.enemies.fillPositionsForProximity(this._proxScratch);
    this.deps.airCombat.fillPositionsForProximity(this._proxScratch);
    return this._proxScratch;
  }

  getHitscanTargetsScratch(): HitscanTarget[] {
    return this.deps.enemies ? this._hitscanTargetsScratch : this._hitscanTargetsScratch;
  }

  readonly handleExplosionEvent = (ev: ExplosionEvent): void => {
    const t0 = performance.now();
    const settings = settingsStore.getState();
    this.deps.explosives.resolveExplosion(
      ev,
      this.deps.player,
      this.deps.collisionWorld,
      this.deps.enemies,
      this.deps.vehicles,
      this.deps.airCombat,
      this.deps.destruction,
      settings.accessibility.reducedMotion,
      this.cachedExplosiveCallbacks
    );
    this.deps.monitor.recordPhase('explosions', performance.now() - t0);
  };

  readonly handleExplosion = (
    x: number,
    y: number,
    z: number,
    radius: number,
    damage: number
  ): void => {
    this.handleExplosionEvent({
      explosiveId: 'grenade_shell',
      category: 'launcher',
      x,
      y,
      z,
      innerRadius: Math.max(1.2, radius * 0.25),
      radius,
      damage,
      falloffExponent: 1.3,
      vehicleDamageMultiplier: 1.25,
      destructionPower: 1.35,
      fromPlayer: true,
      sourceUnitId: 'ordnance',
      sourceSquadId: 'ordnance',
      sourceDomain: 'ground',
    });
  };

  readonly onEnemyHitscanHit = (
    unit: EnemyUnit,
    dmg: number,
    isHead: boolean,
    killed: boolean
  ): void => {
    gameSessionStore.getState().triggerHit(isHead, killed, dmg);
    this.deps.audio.play2D(isHead ? 'headshot' : 'hit_marker', 8, 0.55);
    if (killed) {
      const wepLabel = this.deps.weapons.getActiveState().config.shortName;
      this.deps.telemetry?.recordPlayerKill(wepLabel);
      this.deps.getMissionDirector()?.onEnemyKilled(isHead, 120);
      const scope = this.deps.getActiveScope();
      if (scope) {
        this.deps.healthPickups.tryEvaluateEnemyDrop(
          unit,
          this.deps.player.health,
          this.deps.player.maxHealth,
          scope
        );
      }
      gameSessionStore.getState().pushKillFeed({
        id: `${unit.id}_${Date.now()}`,
        killer: 'VANGUARD-1',
        victim: unit.displayName,
        weaponName: wepLabel,
        isHeadshot: isHead,
        timestamp: Date.now(),
      });
    }
  };

  readonly onAirHitscanHit = (unit: AirUnit, killed: boolean): void => {
    gameSessionStore.getState().triggerHit(false, killed, 25);
    this.deps.audio.play2D('hit_marker', 8, 0.5);
    if (killed) {
      const wepLabel = this.deps.weapons.getActiveState().config.shortName;
      this.deps.telemetry?.recordPlayerKill(wepLabel);
      this.deps.getMissionDirector()?.onAirUnitKilled(350, unit.type);
      gameSessionStore.getState().pushKillFeed({
        id: `${unit.id}_${Date.now()}`,
        killer: 'VANGUARD-1',
        victim: unit.displayName,
        weaponName: wepLabel,
        isHeadshot: false,
        timestamp: Date.now(),
      });
    }
  };

  readonly onVehicleHitscanHit = (veh: VehicleEntity, killed: boolean): void => {
    gameSessionStore.getState().triggerHit(false, killed, 20);
    this.deps.audio.play2D('hit_marker', 7, 0.45);
    if (killed) {
      const wepLabel = this.deps.weapons.getActiveState().config.shortName;
      this.deps.telemetry?.recordPlayerKill(wepLabel);
      if (veh.isConvoyTarget) {
        this.deps.getMissionDirector()?.onConvoyVehicleDestroyed(400);
      } else {
        this.deps.getMissionDirector()?.onEnemyKilled(false, 280);
      }
      gameSessionStore.getState().pushKillFeed({
        id: `${veh.id}_${Date.now()}`,
        killer: 'VANGUARD-1',
        victim: veh.displayName,
        weaponName: wepLabel,
        isHeadshot: false,
        timestamp: Date.now(),
      });
    }
  };

  readonly onDestructibleTargetDestroyed = (ent: { id: string; kind: string }): void => {
    this.deps.getMissionDirector()?.onDestructibleTargetDestroyed(300, ent.kind, ent.id, 'weapon');
  };

  readonly onWeaponApplyDestructionDamage = (colliderId: string, dmg: number): void => {
    this.deps.destruction.applyDamage(
      colliderId,
      dmg,
      this.handleExplosion,
      this.onDestructibleTargetDestroyed
    );
  };

  readonly onVehicleConvoyDestroyed = (): void => {
    this.deps.getMissionDirector()?.onConvoyVehicleDestroyed(400);
  };

  readonly onTurretShotCheck = (origin: THREE.Vector3, dir: THREE.Vector3): void => {
    const playerVehicleId = this.deps.vehicles.getPlayerVehicle()?.collider.id;
    this._turretRayHit.hit = false;
    this._turretRayHit.distance = 110;
    this._turretRayHit.collider = null;

    const hitWall = this.deps.collisionWorld.sweptSegmentTest(
      origin.x,
      origin.y,
      origin.z,
      dir.x,
      dir.y,
      dir.z,
      110,
      SOLID_OBSTRUCTION_MASK,
      this._turretRayHit,
      playerVehicleId
    );

    let bestDist = hitWall ? this._turretRayHit.distance : 110;
    let hitTarget: HitscanTarget | null = null;
    let hitZone: 'head' | 'upper_torso' | 'lower_body' = 'upper_torso';

    for (let i = 0; i < this._hitscanTargetsScratch.length; i++) {
      const t = this._hitscanTargetsScratch[i];
      if (!t.alive) continue;

      const cMain = t.position;
      let toX = cMain.x - origin.x;
      let toY = cMain.y - origin.y;
      let toZ = cMain.z - origin.z;
      let proj = toX * dir.x + toY * dir.y + toZ * dir.z;
      if (proj >= 0 && proj <= bestDist) {
        const r = t.hitRadius + 0.45;
        if (toX * toX + toY * toY + toZ * toZ - proj * proj <= r * r) {
          bestDist = proj;
          hitTarget = t;
          hitZone = 'upper_torso';
        }
      }

      if (t.lowerBodyPosition && t.lowerBodyRadius) {
        const cLow = t.lowerBodyPosition;
        toX = cLow.x - origin.x;
        toY = cLow.y - origin.y;
        toZ = cLow.z - origin.z;
        proj = toX * dir.x + toY * dir.y + toZ * dir.z;
        if (proj >= 0 && proj <= bestDist) {
          const r = t.lowerBodyRadius + 0.45;
          if (toX * toX + toY * toY + toZ * toZ - proj * proj <= r * r) {
            bestDist = proj;
            hitTarget = t;
            hitZone = 'lower_body';
          }
        }
      }

      if (t.headPosition && t.headRadius) {
        const cHead = t.headPosition;
        toX = cHead.x - origin.x;
        toY = cHead.y - origin.y;
        toZ = cHead.z - origin.z;
        proj = toX * dir.x + toY * dir.y + toZ * dir.z;
        if (proj >= 0 && proj <= bestDist) {
          const r = t.headRadius + 0.45;
          if (toX * toX + toY * toY + toZ * toZ - proj * proj <= r * r) {
            bestDist = proj;
            hitTarget = t;
            hitZone = 'head';
          }
        }
      }
    }

    if (hitTarget) {
      const isHead = hitZone === 'head';
      const zoneMult = hitZone === 'head' ? 1.5 : hitZone === 'lower_body' ? 0.85 : 1.0;
      hitTarget.onHit(Math.round(26 * zoneMult), isHead, hitTarget.position, hitZone);
    } else if (hitWall) {
      const wallHit = this._turretRayHit as RayHit;
      if (wallHit.collider && wallHit.collider.layer & COLLISION_LAYER.DESTRUCTIBLE) {
        this.deps.destruction.applyDamage(
          wallHit.collider.id,
          26,
          this.handleExplosion,
          this.onDestructibleTargetDestroyed
        );
        this.deps.vfx.spawnImpact(wallHit.pointX, wallHit.pointY, wallHit.pointZ, 'metal');
      } else {
        this.deps.vfx.spawnImpact(wallHit.pointX, wallHit.pointY, wallHit.pointZ, 'concrete');
      }
    }
  };
}
