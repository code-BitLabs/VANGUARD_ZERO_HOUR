import * as THREE from 'three';
import { VFXPool } from '@/src/effects/VFXPool';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import {
  CombatDomain,
  DifficultyCombatProfile,
  ENEMY_WEAPON_PROFILES,
  EnemyWeaponClass,
  PlayerHitZone,
} from '@/src/schemas/combat.schema';
import { BlockerCategory, CombatTelemetryRecorder } from './CombatTelemetryRecorder';
import { PlayerController } from './PlayerController';

export const SOLID_OBSTRUCTION_MASK =
  COLLISION_LAYER.WORLD |
  COLLISION_LAYER.COVER |
  COLLISION_LAYER.DESTRUCTIBLE |
  COLLISION_LAYER.VEHICLE;

export interface VisibilityCheckResult {
  visible: boolean;
  exposedPoint: THREE.Vector3;
  blockerId: string | null;
  exposedZone: PlayerHitZone | null;
}

export interface EnemyShotParams {
  unitId: string;
  squadId: string;
  domain: CombatDomain;
  weaponClass: EnemyWeaponClass;
  muzzleOrigin: THREE.Vector3;
  aimTarget: THREE.Vector3;
  distanceMeters: number;
  unitAccuracy: number;
  isMoving: boolean;
  aimDurationSec: number;
  burstShotIndex: number;
  isSuppressedOrStaggered: boolean;
  isSuppressionFire: boolean;
  difficultyProfile: DifficultyCombatProfile;
}

export interface EnemyShotResult {
  hitPlayer: boolean;
  blockedByCover: boolean;
  blockerId: string | null;
  hitZone: PlayerHitZone | null;
  damageApplied: number;
  spreadRad: number;
  endPoint: THREE.Vector3;
}

/**
 * Deterministic Mulberry32 PRNG for reproducible combat spread & reaction timers.
 */
export class SeededRandom {
  private state: number;

  constructor(seed = 1337) {
    this.state = seed >>> 0;
  }

  setSeed(seed: number): void {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  gaussianApprox(): number {
    // Irvin-Hall 3-sample centered approx in [-1, 1]
    return (this.next() + this.next() + this.next()) / 1.5 - 1.0;
  }
}

export class BallisticSolver {
  public readonly rng = new SeededRandom(90210);

  private readonly _rayHit: RayHit = {
    hit: false,
    distance: 0,
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    collider: null,
  };

  private readonly _dir = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _shotDir = new THREE.Vector3();
  private readonly _endPoint = new THREE.Vector3();
  private readonly _exposedPoint = new THREE.Vector3();

  constructor(
    private readonly vfx: VFXPool | null,
    private readonly telemetry: CombatTelemetryRecorder
  ) {}

  /**
   * Performs a 5-point anatomical visibility check from `eyeOrigin` against the player's
   * stance-aware sample points (Chest, Head, Left Shoulder, Right Shoulder, Pelvis).
   * Respects all solid geometry: WORLD, COVER, DESTRUCTIBLE, and VEHICLE.
   */
  checkLineOfSight(
    eyeOriginX: number,
    eyeOriginY: number,
    eyeOriginZ: number,
    player: PlayerController,
    collision: CollisionWorld,
    maxRange: number
  ): VisibilityCheckResult {
    const samples = player.getVisibilitySamplePoints();
    const candidates: Array<{ pt: THREE.Vector3; zone: PlayerHitZone }> = [
      { pt: samples.chest, zone: 'upper_torso' },
      { pt: samples.head, zone: 'head' },
      { pt: samples.leftShoulder, zone: 'upper_torso' },
      { pt: samples.rightShoulder, zone: 'upper_torso' },
      { pt: samples.pelvis, zone: 'lower_body' },
    ];

    let firstBlockerId: string | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const target = candidates[i].pt;
      const dx = target.x - eyeOriginX;
      const dy = target.y - eyeOriginY;
      const dz = target.z - eyeOriginZ;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > maxRange || dist < 0.05) continue;

      const invDist = 1 / dist;
      const blocked = collision.sweptSegmentTest(
        eyeOriginX,
        eyeOriginY,
        eyeOriginZ,
        dx * invDist,
        dy * invDist,
        dz * invDist,
        Math.max(0.1, dist - 0.18),
        SOLID_OBSTRUCTION_MASK,
        this._rayHit
      );

      if (!blocked) {
        this._exposedPoint.copy(target);
        return {
          visible: true,
          exposedPoint: this._exposedPoint,
          blockerId: null,
          exposedZone: candidates[i].zone,
        };
      }

      if (!firstBlockerId) {
        firstBlockerId = this._rayHit.collider?.id ?? 'terrain';
      }
    }

    this._exposedPoint.copy(samples.chest);
    return {
      visible: false,
      exposedPoint: this._exposedPoint,
      blockerId: firstBlockerId,
      exposedZone: null,
    };
  }

  /**
   * Computes angular spread (radians) from weapon profile, distance, stance/movement,
   * aiming duration, burst index, suppression, and difficulty profile.
   */
  computeShotSpreadRad(params: EnemyShotParams): number {
    const weapon = ENEMY_WEAPON_PROFILES[params.weaponClass];
    const skillFactor = Math.max(0.55, 1.35 - params.unitAccuracy * 0.7);
    const movePenalty = params.isMoving ? 1.38 : 1.0;
    const aimBonus = Math.max(0.68, 1.18 - Math.min(1.5, params.aimDurationSec) * 0.32);
    const suppressPenalty = params.isSuppressedOrStaggered ? 1.65 : 1.0;
    const suppressionFireFactor = params.isSuppressionFire ? 1.45 : 1.0;
    const distancePenalty =
      params.distanceMeters > weapon.effectiveRangeMeters
        ? 1 + (params.distanceMeters - weapon.effectiveRangeMeters) * 0.014
        : 1.0;

    const base =
      (weapon.baseSpreadRad + params.burstShotIndex * weapon.recoilBloomPerShotRad) *
      skillFactor *
      movePenalty *
      aimBonus *
      suppressPenalty *
      suppressionFireFactor *
      distancePenalty *
      params.difficultyProfile.spreadMultiplier;

    return Math.min(0.28, Math.max(0.005, base));
  }

  /**
   * Resolves a conventional firearm shot or multi-pellet shotgun blast using physical
   * spread raycasts against environment cover and the player's 3-part stance hitbox.
   */
  fireWeaponRay(
    params: EnemyShotParams,
    player: PlayerController,
    collision: CollisionWorld
  ): EnemyShotResult {
    const weapon = ENEMY_WEAPON_PROFILES[params.weaponClass];
    const spreadRad = this.computeShotSpreadRad(params);

    this._dir.subVectors(params.aimTarget, params.muzzleOrigin);
    const aimDist = this._dir.length();
    if (aimDist < 0.001) {
      this._dir.set(0, 0, 1);
    } else {
      this._dir.divideScalar(aimDist);
    }

    // Build orthonormal basis around aiming vector
    if (Math.abs(this._dir.y) > 0.98) {
      this._right.set(1, 0, 0);
    } else {
      this._right.set(-this._dir.z, 0, this._dir.x).normalize();
    }
    this._up.crossVectors(this._right, this._dir).normalize();

    const pellets = Math.max(1, weapon.pelletCount);
    let anyHitPlayer = false;
    let anyBlockedByCover = false;
    let firstBlockerId: string | null = null;
    let bestHitZone: PlayerHitZone | null = null;
    let totalDamageApplied = 0;

    const hitboxes = player.getStanceHitboxes();
    const playerMovePenalty = player.currentSpeed > 6.5 ? 0.015 : player.currentSpeed > 2.5 ? 0.007 : 0;
    const totalSpread = spreadRad + playerMovePenalty;

    for (let p = 0; p < pellets; p++) {
      const shotId = this.telemetry.nextShotId();
      const offsetRight = this.rng.gaussianApprox() * totalSpread;
      const offsetUp = this.rng.gaussianApprox() * totalSpread;

      this._shotDir
        .copy(this._dir)
        .addScaledVector(this._right, offsetRight)
        .addScaledVector(this._up, offsetUp)
        .normalize();

      const tRay0 = performance.now();
      const maxRayDist = weapon.maxRangeMeters;
      const worldHit = collision.sweptSegmentTest(
        params.muzzleOrigin.x,
        params.muzzleOrigin.y,
        params.muzzleOrigin.z,
        this._shotDir.x,
        this._shotDir.y,
        this._shotDir.z,
        maxRayDist,
        SOLID_OBSTRUCTION_MASK,
        this._rayHit
      );
      const rayMs = performance.now() - tRay0;

      const envDist = worldHit ? this._rayHit.distance : maxRayDist;
      const envBlockerId = worldHit ? (this._rayHit.collider?.id ?? 'terrain') : null;
      let blockerCategory: BlockerCategory | null = null;
      if (worldHit) {
        const layer = this._rayHit.collider?.layer ?? COLLISION_LAYER.WORLD;
        if ((layer & COLLISION_LAYER.COVER) !== 0) blockerCategory = 'COVER';
        else if ((layer & COLLISION_LAYER.VEHICLE) !== 0) blockerCategory = 'VEHICLE';
        else if ((layer & COLLISION_LAYER.DESTRUCTIBLE) !== 0) blockerCategory = 'DESTRUCTIBLE';
        else blockerCategory = 'WORLD';
      }
      this.telemetry.recordRaycastTiming(rayMs, blockerCategory);

      // Test ray against player's 3-part stance-aware hitbox (only if on foot and closer than envDist!)
      let playerHitDist = envDist;
      let hitZone: PlayerHitZone | null = null;
      const hitOccupiedVehicleHull =
        worldHit &&
        player.alive &&
        !params.isSuppressionFire &&
        player.isOccupyingVehicle() &&
        envBlockerId !== null &&
        envBlockerId === player.getOccupiedVehicleColliderId();

      if (hitOccupiedVehicleHull) {
        playerHitDist = envDist;
        hitZone = 'upper_torso';
      } else if (player.alive && !player.isOccupyingVehicle() && !params.isSuppressionFire) {
        const dHead = this.intersectRaySphere(
          params.muzzleOrigin,
          this._shotDir,
          hitboxes.headCenter,
          hitboxes.headRadius,
          playerHitDist
        );
        if (dHead !== null && dHead < playerHitDist) {
          playerHitDist = dHead;
          hitZone = 'head';
        }

        const dTorso = this.intersectRayBox(
          params.muzzleOrigin,
          this._shotDir,
          hitboxes.upperTorsoMin,
          hitboxes.upperTorsoMax,
          playerHitDist
        );
        if (dTorso !== null && dTorso < playerHitDist) {
          playerHitDist = dTorso;
          hitZone = 'upper_torso';
        }

        const dLower = this.intersectRayBox(
          params.muzzleOrigin,
          this._shotDir,
          hitboxes.lowerBodyMin,
          hitboxes.lowerBodyMax,
          playerHitDist
        );
        if (dLower !== null && dLower < playerHitDist) {
          playerHitDist = dLower;
          hitZone = 'lower_body';
        }
      }

      const finalDist = hitZone ? playerHitDist : envDist;
      this._endPoint.copy(params.muzzleOrigin).addScaledVector(this._shotDir, finalDist);


      if (p === 0 || p % 2 === 0) {
        this.vfx?.spawnTracer(
          params.muzzleOrigin.x,
          params.muzzleOrigin.y,
          params.muzzleOrigin.z,
          this._endPoint.x,
          this._endPoint.y,
          this._endPoint.z
        );
      }

      if (hitZone) {
        const zoneMult =
          hitZone === 'head'
            ? weapon.headshotMultiplier
            : hitZone === 'lower_body'
              ? 0.8
              : 1.0;
        const rawDmg = weapon.baseDamage * params.difficultyProfile.damageMultiplier * zoneMult;
        const armorBefore = player.armor;
        const healthBefore = player.health;
        const applied = player.applyValidatedShotDamage(
          shotId,
          rawDmg,
          params.muzzleOrigin.x,
          params.muzzleOrigin.z,
          hitZone
        );
        if (applied <= 0) {
          this.telemetry.recordDuplicateDamageBlocked();
        }
        const armorAbsorbed = Math.max(0, armorBefore - player.armor);
        const healthLost = Math.max(0, healthBefore - player.health);

        anyHitPlayer = true;
        bestHitZone = hitZone;
        totalDamageApplied += rawDmg;

        this.vfx?.spawnImpact(this._endPoint.x, this._endPoint.y, this._endPoint.z, 'blood');

        this.telemetry.recordShot({
          shotId,
          unitId: params.unitId,
          squadId: params.squadId,
          domain: params.domain,
          weaponClass: params.weaponClass,
          isSuppression: params.isSuppressionFire,
          originX: params.muzzleOrigin.x,
          originY: params.muzzleOrigin.y,
          originZ: params.muzzleOrigin.z,
          endX: this._endPoint.x,
          endY: this._endPoint.y,
          endZ: this._endPoint.z,
          spreadRad: totalSpread,
          outcome: 'hit_player',
          blockerColliderId: null,
          blockerCategory: null,
          hitZone,
          damageDealt: rawDmg,
          raycastMs: Number(rayMs.toFixed(3)),
        });

        this.telemetry.recordPlayerDamage(
          shotId,
          params.unitId,
          params.squadId,
          params.domain,
          params.weaponClass,
          hitZone,
          rawDmg,
          armorAbsorbed,
          healthLost
        );
      } else {
        // Check if the shot was blocked by cover along the line between shooter and player
        const blockedPlayerLine =
          worldHit && envDist < params.distanceMeters + 1.5;

        if (worldHit) {
          const matKind =
            this._rayHit.collider &&
            (this._rayHit.collider.layer & COLLISION_LAYER.VEHICLE) !== 0
              ? 'metal'
              : 'concrete';
          this.vfx?.spawnImpact(this._endPoint.x, this._endPoint.y, this._endPoint.z, matKind);
        }

        // Near-miss suppression pulse if ray passes close to player head or strikes cover right in front of player
        const closestToHead = this.pointToSegmentDistance(
          hitboxes.headCenter,
          params.muzzleOrigin,
          this._endPoint
        );
        if (closestToHead < 1.65) {
          player.applySuppressionPulse(0.18);
        }

        if (blockedPlayerLine) {
          anyBlockedByCover = true;
          firstBlockerId = envBlockerId;
          this.telemetry.recordShot({
            shotId,
            unitId: params.unitId,
            squadId: params.squadId,
            domain: params.domain,
            weaponClass: params.weaponClass,
            isSuppression: params.isSuppressionFire,
            originX: params.muzzleOrigin.x,
            originY: params.muzzleOrigin.y,
            originZ: params.muzzleOrigin.z,
            endX: this._endPoint.x,
            endY: this._endPoint.y,
            endZ: this._endPoint.z,
            spreadRad: totalSpread,
            outcome: 'blocked_cover',
            blockerColliderId: envBlockerId,
            blockerCategory,
            hitZone: null,
            damageDealt: 0,
            raycastMs: Number(rayMs.toFixed(3)),
          });
        } else {
          this.telemetry.recordShot({
            shotId,
            unitId: params.unitId,
            squadId: params.squadId,
            domain: params.domain,
            weaponClass: params.weaponClass,
            isSuppression: params.isSuppressionFire,
            originX: params.muzzleOrigin.x,
            originY: params.muzzleOrigin.y,
            originZ: params.muzzleOrigin.z,
            endX: this._endPoint.x,
            endY: this._endPoint.y,
            endZ: this._endPoint.z,
            spreadRad: totalSpread,
            outcome: 'missed',
            blockerColliderId: null,
            blockerCategory: null,
            hitZone: null,
            damageDealt: 0,
            raycastMs: Number(rayMs.toFixed(3)),
          });
        }
      }
    }

    return {
      hitPlayer: anyHitPlayer,
      blockedByCover: anyBlockedByCover && !anyHitPlayer,
      blockerId: firstBlockerId,
      hitZone: bestHitZone,
      damageApplied: totalDamageApplied,
      spreadRad: totalSpread,
      endPoint: this._endPoint.clone(),
    };
  }

  private intersectRaySphere(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    center: THREE.Vector3,
    radius: number,
    maxDist: number
  ): number | null {
    const ocX = origin.x - center.x;
    const ocY = origin.y - center.y;
    const ocZ = origin.z - center.z;
    const b = ocX * dir.x + ocY * dir.y + ocZ * dir.z;
    const c = ocX * ocX + ocY * ocY + ocZ * ocZ - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t < maxDist) return t;
    return null;
  }

  private intersectRayBox(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    min: THREE.Vector3,
    max: THREE.Vector3,
    maxDist: number
  ): number | null {
    let tmin = 0;
    let tmax = maxDist;

    const invDx = dir.x !== 0 ? 1 / dir.x : 1e9;
    let t1 = (min.x - origin.x) * invDx;
    let t2 = (max.x - origin.x) * invDx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;

    const invDy = dir.y !== 0 ? 1 / dir.y : 1e9;
    t1 = (min.y - origin.y) * invDy;
    t2 = (max.y - origin.y) * invDy;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;

    const invDz = dir.z !== 0 ? 1 / dir.z : 1e9;
    t1 = (min.z - origin.z) * invDz;
    t2 = (max.z - origin.z) * invDz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;

    return tmin;
  }

  private pointToSegmentDistance(
    pt: THREE.Vector3,
    segA: THREE.Vector3,
    segB: THREE.Vector3
  ): number {
    const abX = segB.x - segA.x;
    const abY = segB.y - segA.y;
    const abZ = segB.z - segA.z;
    const lenSq = abX * abX + abY * abY + abZ * abZ;
    if (lenSq < 0.0001) return pt.distanceTo(segA);
    const t = Math.max(
      0,
      Math.min(
        1,
        ((pt.x - segA.x) * abX + (pt.y - segA.y) * abY + (pt.z - segA.z) * abZ) / lenSq
      )
    );
    const projX = segA.x + abX * t;
    const projY = segA.y + abY * t;
    const projZ = segA.z + abZ * t;
    return Math.hypot(pt.x - projX, pt.y - projY, pt.z - projZ);
  }
}
