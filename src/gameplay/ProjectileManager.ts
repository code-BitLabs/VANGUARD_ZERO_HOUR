import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { ObjectPool, Poolable } from '@/src/core/ObjectPool';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { formatCollisionLayer, PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import type { PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import {
  EXPLOSIVE_BY_ID,
  ExplosiveId,
  ExplosiveProfile,
} from '@/src/schemas/explosive.schema';
import {
  CombatTelemetryRecorder,
  FlightTelemetrySample,
} from './CombatTelemetryRecorder';

export type ProjectileKind =
  | 'rocket'
  | 'guided_missile'
  | 'grenade_shell'
  | 'hand_grenade'
  | 'enemy_rocket'
  | 'enemy_grenade'
  | 'standard_aerial_bomb'
  | 'heavy_explosive_bomb'
  | 'precision_guided_bomb'
  | 'cluster_munition_bomb'
  | 'cluster_submunition'
  | 'strategic_nuclear_weapon';

export interface HomingTarget {
  id: string;
  alive: boolean;
  position: THREE.Vector3;
}

export type TrackingState = 'untargeted' | 'tracking' | 'locked' | 'evaded';

interface PooledProjectile extends Poolable {
  id: string;
  mesh: THREE.Mesh;
  kind: ProjectileKind;
  profile: ExplosiveProfile;
  fromPlayer: boolean;
  sourceUnitId: string;
  sourceSquadId: string;
  sourceDomain: 'ground' | 'air' | 'vehicle';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dir: THREE.Vector3;
  damage: number;
  blastRadius: number;
  fuseSec: number;
  life: number;
  maxLife: number;
  boostRemainingSec: number;
  homingTarget: HomingTarget | null;
  targetPoint: THREE.Vector3 | null;
  trackingState: TrackingState;
  lastTurnRateDegPerSec: number;
  lastAccelMag: number;
  minTargetDist: number;
  smokeAccum: number;
  detonated: boolean;
  hasSplit: boolean;
}

export interface ExplosionEvent {
  explosiveId: ExplosiveId;
  category: string;
  x: number;
  y: number;
  z: number;
  innerRadius: number;
  radius: number;
  damage: number;
  falloffExponent: number;
  vehicleDamageMultiplier: number;
  destructionPower: number;
  fromPlayer: boolean;
  sourceUnitId: string;
  sourceSquadId: string;
  sourceDomain: 'ground' | 'air' | 'vehicle';
}

const POOL_CAPACITY = 72;

export class ProjectileManager {
  private readonly pool: ObjectPool<PooledProjectile>;
  private readonly root = new THREE.Group();
  private seq = 0;
  private readonly rayHit: RayHit = {
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
  private readonly _desired = new THREE.Vector3();
  private readonly _rotAxis = new THREE.Vector3();
  private readonly _prevDir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    resourceManager: ResourceManager,
    private readonly vfx: VFXPool,
    private readonly audio: AudioManager,
    private readonly telemetry?: CombatTelemetryRecorder
  ) {
    this.root.name = 'projectile_pool_root';
    scene.add(this.root);

    const rocketGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.72, 8);
    rocketGeo.rotateX(Math.PI / 2);
    const grenadeGeo = new THREE.SphereGeometry(0.14, 8, 8);
    const bombGeo = new THREE.CylinderGeometry(0.24, 0.34, 1.45, 10);
    bombGeo.rotateX(Math.PI / 2);
    const nukeGeo = new THREE.CylinderGeometry(0.45, 0.62, 2.6, 12);
    nukeGeo.rotateX(Math.PI / 2);

    resourceManager.registerGeometry(rocketGeo, 'shared', 'proj_rocket_geo');
    resourceManager.registerGeometry(grenadeGeo, 'shared', 'proj_grenade_geo');
    resourceManager.registerGeometry(bombGeo, 'shared', 'proj_bomb_geo');
    resourceManager.registerGeometry(nukeGeo, 'shared', 'proj_nuke_geo');

    const rocketMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.7,
      metalness: 0.5,
      roughness: 0.35,
    });
    const grenadeMat = new THREE.MeshStandardMaterial({
      color: 0x365314,
      emissive: 0xef4444,
      emissiveIntensity: 0.45,
      roughness: 0.5,
    });
    const bombMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.35,
      metalness: 0.75,
      roughness: 0.3,
    });
    const nukeMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf97316,
      emissiveIntensity: 0.95,
      metalness: 0.85,
      roughness: 0.2,
    });
    resourceManager.registerMaterial(rocketMat, 'shared', 'proj_rocket_mat');
    resourceManager.registerMaterial(grenadeMat, 'shared', 'proj_grenade_mat');
    resourceManager.registerMaterial(bombMat, 'shared', 'proj_bomb_mat');
    resourceManager.registerMaterial(nukeMat, 'shared', 'proj_nuke_mat');

    this.pool = new ObjectPool<PooledProjectile>(
      POOL_CAPACITY,
      () => {
        const mesh = new THREE.Mesh(rocketGeo, rocketMat);
        mesh.visible = false;
        this.root.add(mesh);
        return {
          active: false,
          id: '',
          mesh,
          kind: 'rocket',
          profile: EXPLOSIVE_BY_ID.rocket,
          fromPlayer: true,
          sourceUnitId: 'player',
          sourceSquadId: 'player',
          sourceDomain: 'ground',
          pos: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          dir: new THREE.Vector3(0, 0, -1),
          damage: 150,
          blastRadius: 7,
          fuseSec: 0,
          life: 0,
          maxLife: 6,
          boostRemainingSec: 0,
          homingTarget: null,
          targetPoint: null,
          trackingState: 'untargeted',
          lastTurnRateDegPerSec: 0,
          lastAccelMag: 0,
          minTargetDist: Infinity,
          smokeAccum: 0,
          detonated: false,
          hasSplit: false,
          reset() {
            this.life = 0;
            this.fuseSec = 0;
            this.smokeAccum = 0;
            this.boostRemainingSec = 0;
            this.homingTarget = null;
            this.targetPoint = null;
            this.trackingState = 'untargeted';
            this.lastTurnRateDegPerSec = 0;
            this.lastAccelMag = 0;
            this.minTargetDist = Infinity;
            this.detonated = false;
            this.hasSplit = false;
            this.mesh.visible = true;
          },
        };
      },
      (item) => {
        item.mesh.visible = false;
        item.homingTarget = null;
        item.targetPoint = null;
      }
    );
    this.root.userData = {
      rocketGeo,
      grenadeGeo,
      bombGeo,
      nukeGeo,
      rocketMat,
      grenadeMat,
      bombMat,
      nukeMat,
    };
  }

  spawn(opts: {
    kind: ProjectileKind;
    fromPlayer: boolean;
    origin: THREE.Vector3;
    direction: THREE.Vector3;
    speed?: number;
    damage?: number;
    blastRadius?: number;
    homingTarget?: HomingTarget | null;
    targetPoint?: THREE.Vector3 | null;
    sourceUnitId?: string;
    sourceSquadId?: string;
    sourceDomain?: 'ground' | 'air' | 'vehicle';
  }): string {
    const p = this.pool.acquire();
    const profile = EXPLOSIVE_BY_ID[opts.kind];
    const { rocketGeo, grenadeGeo, bombGeo, nukeGeo, rocketMat, grenadeMat, bombMat, nukeMat } =
      this.root.userData as {
        rocketGeo: THREE.BufferGeometry;
        grenadeGeo: THREE.BufferGeometry;
        bombGeo: THREE.BufferGeometry;
        nukeGeo: THREE.BufferGeometry;
        rocketMat: THREE.Material;
        grenadeMat: THREE.Material;
        bombMat: THREE.Material;
        nukeMat: THREE.Material;
      };

    p.id = `proj_${++this.seq}_${opts.kind}`;
    p.kind = opts.kind;
    p.profile = profile;
    p.fromPlayer = opts.fromPlayer;
    p.sourceUnitId = opts.sourceUnitId ?? (opts.fromPlayer ? 'player' : opts.kind);
    p.sourceSquadId = opts.sourceSquadId ?? (opts.fromPlayer ? 'player' : 'squad_alpha');
    p.sourceDomain = opts.sourceDomain ?? 'ground';
    p.pos.copy(opts.origin);
    p.dir.copy(opts.direction).normalize();

    const launchSpeed = opts.speed ?? profile.kinematics.initialSpeed;
    const clampedLaunch = Math.min(launchSpeed, profile.kinematics.maxSpeed);
    p.vel.copy(p.dir).multiplyScalar(clampedLaunch);

    p.damage = opts.damage ?? profile.blast.maxDamage;
    p.blastRadius = opts.blastRadius ?? profile.blast.outerRadius;
    p.fuseSec = profile.detonation.fuseTimeSec;
    p.maxLife = profile.detonation.maxLifetimeSec;
    p.boostRemainingSec = profile.kinematics.boostDurationSec;
    p.homingTarget = opts.homingTarget ?? null;
    p.targetPoint = opts.targetPoint ? opts.targetPoint.clone() : null;
    p.trackingState =
      opts.homingTarget && opts.homingTarget.alive
        ? 'locked'
        : opts.targetPoint && profile.kinematics.maxTurnRateDegPerSec > 0
          ? 'tracking'
          : 'untargeted';

    if (opts.kind === 'hand_grenade' || opts.kind === 'enemy_grenade') {
      p.mesh.geometry = grenadeGeo;
      p.mesh.material = grenadeMat;
    } else if (opts.kind === 'grenade_shell' || opts.kind === 'cluster_submunition') {
      p.mesh.geometry = grenadeGeo;
      p.mesh.material = rocketMat;
    } else if (opts.kind === 'strategic_nuclear_weapon') {
      p.mesh.geometry = nukeGeo;
      p.mesh.material = nukeMat;
    } else if (profile.category === 'conventional_bomb') {
      p.mesh.geometry = bombGeo;
      p.mesh.material = bombMat;
    } else {
      p.mesh.geometry = rocketGeo;
      p.mesh.material = rocketMat;
    }

    p.mesh.position.copy(p.pos);
    p.mesh.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);

    this.telemetry?.recordEvent(
      'PROJECTILE_SPAWN',
      p.id,
      p.sourceSquadId,
      p.sourceDomain,
      `${p.kind} launched at ${clampedLaunch.toFixed(1)} m/s (cap ${profile.kinematics.maxSpeed} m/s)`
    );

    return p.id;
  }

  update(
    rawDt: number,
    collision: CollisionWorld,
    onExplode: (ev: ExplosionEvent) => void,
    proximityEntities: Array<{ position: THREE.Vector3; radius: number }>
  ): void {
    // Substep clamped dt for frame-rate independent ballistics & homing across 30-144 FPS
    const clampedTotal = Math.min(rawDt, 0.05);
    const subSteps = clampedTotal > 0.022 ? 2 : 1;
    const dt = clampedTotal / subSteps;

    for (let step = 0; step < subSteps; step++) {
      this.pool.forEachActive((p) => {
        if (p.detonated) {
          this.pool.release(p);
          return;
        }

        p.life += dt;
        if (p.life >= p.maxLife) {
          if (p.profile.detonation.triggerMode === 'fuse' || p.fuseSec > 0) {
            this.detonate(p, onExplode);
          } else {
            this.pool.release(p);
          }
          return;
        }

        const kin = p.profile.kinematics;
        p.lastTurnRateDegPerSec = 0;
        p.lastAccelMag = 0;

        // 1. Bounded angular homing for guided missiles & laser-guided bombs
        const targetVec =
          p.homingTarget && p.homingTarget.alive
            ? p.homingTarget.position
            : p.targetPoint;

        if (
          targetVec &&
          kin.maxTurnRateDegPerSec > 0 &&
          p.trackingState !== 'evaded' &&
          p.life >= p.profile.detonation.armingDelaySec
        ) {
          const speed = p.vel.length();
          if (speed > 0.5) {
            const distToTarget = this._desired.subVectors(targetVec, p.pos).length();
            if (distToTarget < p.minTargetDist) {
              p.minTargetDist = distToTarget;
            }
            if (distToTarget > 0.2) {
              this._desired.divideScalar(distToTarget);
              this._prevDir.copy(p.vel).divideScalar(speed);

              const dot = THREE.MathUtils.clamp(this._prevDir.dot(this._desired), -1, 1);
              const angleRad = Math.acos(dot);

              // If inside 18m terminal zone and target broke sharply behind missile nose -> evaded!
              if (p.minTargetDist < 18 && distToTarget > p.minTargetDist + 1.5 && dot < 0.25) {
                p.trackingState = 'evaded';
              } else if (angleRad > 0.0005) {
                const maxTurnRad = THREE.MathUtils.degToRad(kin.maxTurnRateDegPerSec) * dt;
                const appliedTurn = Math.min(angleRad, maxTurnRad);
                p.lastTurnRateDegPerSec = THREE.MathUtils.radToDeg(appliedTurn / Math.max(dt, 0.0001));

                this._rotAxis.crossVectors(this._prevDir, this._desired);
                if (this._rotAxis.lengthSq() > 1e-6) {
                  this._rotAxis.normalize();
                  this._prevDir.applyAxisAngle(this._rotAxis, appliedTurn).normalize();
                  p.vel.copy(this._prevDir).multiplyScalar(speed);
                }
              }
            }
          }
        }

        // 2. Motor thrust acceleration phase + aerodynamic drag + gravity drop
        const curSpeed = p.vel.length();
        if (curSpeed > 0.001) {
          p.dir.copy(p.vel).divideScalar(curSpeed);
        }

        if (p.boostRemainingSec > 0 && kin.acceleration > 0) {
          const boostDt = Math.min(dt, p.boostRemainingSec);
          p.boostRemainingSec -= boostDt;
          p.vel.addScaledVector(p.dir, kin.acceleration * boostDt);
          p.lastAccelMag = kin.acceleration;
        }

        // Exponential drag
        if (kin.drag > 0) {
          const dragFactor = Math.exp(-kin.drag * dt);
          p.vel.multiplyScalar(dragFactor);
        }

        // Gravity
        if (kin.gravityScale > 0) {
          p.vel.y -= 9.81 * kin.gravityScale * dt;
        }

        // Speed cap enforcement
        const newSpeed = p.vel.length();
        if (newSpeed > kin.maxSpeed && kin.maxSpeed > 0) {
          p.vel.multiplyScalar(kin.maxSpeed / newSpeed);
        }

        // 3. Cluster munition altitude split
        if (
          p.profile.detonation.triggerMode === 'altitude_split' &&
          !p.hasSplit &&
          p.vel.y < -1.0
        ) {
          const groundY = collision.getGroundHeightAt(p.pos.x, p.pos.z);
          if (p.pos.y - groundY <= p.profile.detonation.splitAltitudeMeters) {
            p.hasSplit = true;
            this.spawnClusterBomblets(p);
            this.vfx.spawnExplosion(p.pos.x, p.pos.y, p.pos.z, 0.9);
            this.pool.release(p);
            return;
          }
        }

        // 4. Continuous Collision Detection (swept-sphere for fuse grenades, swept-ray for fast ordnance)
        const stepDist = p.vel.length() * dt;
        if (stepDist > 0.0001) {
          this._dir.copy(p.vel).normalize();
          const isFuseGrenade = p.profile.detonation.triggerMode === 'fuse' && p.fuseSec > 0;
          const castRadius = isFuseGrenade ? Math.min(0.14, kin.collisionRadius) : 0;
          const hitWorld =
            castRadius > 0
              ? collision.sweptSphereTest(
                  p.pos.x,
                  p.pos.y,
                  p.pos.z,
                  this._dir.x,
                  this._dir.y,
                  this._dir.z,
                  stepDist + 0.02,
                  castRadius,
                  PHYSICS_MASKS.PROJECTILE_SOLID,
                  this.rayHit
                )
              : collision.sweptSegmentTest(
                  p.pos.x,
                  p.pos.y,
                  p.pos.z,
                  this._dir.x,
                  this._dir.y,
                  this._dir.z,
                  stepDist + kin.collisionRadius,
                  PHYSICS_MASKS.PROJECTILE_SOLID,
                  this.rayHit
                );

          if (hitWorld) {
            if (stepDist > 1.1) {
              collision.physicsWorld.debugSystem.recordTunnelingPrevented(
                p.id,
                this.rayHit.pointX,
                this.rayHit.pointY,
                this.rayHit.pointZ,
                newSpeed,
                this.rayHit.collider?.id ?? 'world'
              );
            }

            if (isFuseGrenade) {
              // 3D surface-normal reflection + tangential friction for grenades against walls, floors & sills
              const pushOut = Math.max(0.08, castRadius + 0.01);
              p.pos.set(
                this.rayHit.pointX + this.rayHit.normalX * pushOut,
                this.rayHit.pointY + this.rayHit.normalY * pushOut,
                this.rayHit.pointZ + this.rayHit.normalZ * pushOut
              );
              const vn =
                p.vel.x * this.rayHit.normalX +
                p.vel.y * this.rayHit.normalY +
                p.vel.z * this.rayHit.normalZ;
              if (vn < 0) {
                const bounceFactor = 1 + kin.restitution;
                p.vel.x -= bounceFactor * vn * this.rayHit.normalX;
                p.vel.y -= bounceFactor * vn * this.rayHit.normalY;
                p.vel.z -= bounceFactor * vn * this.rayHit.normalZ;
                // Apply tangential friction along surface plane
                if (Math.abs(this.rayHit.normalY) > 0.65) {
                  p.vel.x *= kin.friction;
                  p.vel.z *= kin.friction;
                } else {
                  p.vel.y *= kin.friction;
                }
                if (Math.abs(p.vel.y) < 0.8 && this.rayHit.normalY > 0.7) {
                  p.vel.y = 0;
                }
              }
            } else {
              p.pos.set(this.rayHit.pointX, this.rayHit.pointY, this.rayHit.pointZ);
              this.detonate(p, onExplode);
              return;
            }
          } else {
            p.pos.addScaledVector(p.vel, dt);
          }

          // Enforce world floor & perimeter boundary for fuse grenades
          if (isFuseGrenade) {
            const floorY = collision.getGroundHeightAt(p.pos.x, p.pos.z) + 0.14;
            if (p.pos.y < floorY) {
              p.pos.y = floorY;
              if (p.vel.y < 0) {
                p.vel.y = -p.vel.y * kin.restitution;
                if (Math.abs(p.vel.y) < 0.8) p.vel.y = 0;
                p.vel.x *= kin.friction;
                p.vel.z *= kin.friction;
              }
            }
          }
        }

        // 5. Fuse countdown
        if (p.profile.detonation.triggerMode === 'fuse' && p.fuseSec > 0 && p.life >= p.fuseSec) {
          this.detonate(p, onExplode);
          return;
        }

        // 6. Proximity detonation for rockets/missiles/bombs near vehicles/air units/enemies
        if (
          p.profile.detonation.triggerMode !== 'fuse' &&
          p.life >= p.profile.detonation.armingDelaySec
        ) {
          for (let i = 0; i < proximityEntities.length; i++) {
            const ent = proximityEntities[i];
            const r = ent.radius + kin.collisionRadius;
            if (p.pos.distanceToSquared(ent.position) <= r * r) {
              this.detonate(p, onExplode);
              return;
            }
          }
        }

        // Sync mesh & smoke exhaust on final substep
        if (step === subSteps - 1) {
          p.mesh.position.copy(p.pos);
          if (p.vel.lengthSq() > 0.1) {
            p.mesh.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
          }

          if (
            p.kind === 'rocket' ||
            p.kind === 'guided_missile' ||
            p.kind === 'enemy_rocket' ||
            p.profile.category === 'conventional_bomb' ||
            p.kind === 'strategic_nuclear_weapon'
          ) {
            p.smokeAccum += clampedTotal;
            if (p.smokeAccum >= 0.045) {
              p.smokeAccum = 0;
              this.vfx.spawnExhaustSmoke(
                p.pos.x,
                p.pos.y,
                p.pos.z,
                p.kind === 'strategic_nuclear_weapon' ? 2.0 : 0.9
              );
            }
          }
        }
      });
    }
  }

  private spawnClusterBomblets(parent: PooledProjectile): void {
    const count = Math.min(8, Math.max(1, parent.profile.detonation.submunitionCount || 6));
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const spreadX = Math.cos(ang) * 0.42;
      const spreadZ = Math.sin(ang) * 0.42;
      const dir = new THREE.Vector3(spreadX, -1.0, spreadZ).normalize();
      this.spawn({
        kind: 'cluster_submunition',
        fromPlayer: parent.fromPlayer,
        origin: parent.pos.clone().add(new THREE.Vector3(Math.cos(ang) * 1.2, -0.5, Math.sin(ang) * 1.2)),
        direction: dir,
        speed: 18,
        sourceUnitId: parent.sourceUnitId,
        sourceSquadId: parent.sourceSquadId,
        sourceDomain: parent.sourceDomain,
      });
    }
  }

  private detonate(p: PooledProjectile, onExplode: (ev: ExplosionEvent) => void): void {
    if (p.detonated) return;
    p.detonated = true;

    const isNuke = p.kind === 'strategic_nuclear_weapon';
    if (!isNuke) {
      const scale = Math.min(2.6, Math.max(0.9, p.blastRadius / 6.5));
      this.vfx.spawnExplosion(p.pos.x, p.pos.y, p.pos.z, scale);
      this.audio.playSpatial('explosion', p.pos.x, p.pos.y, p.pos.z, 9, 0.92);
    }

    onExplode({
      explosiveId: p.kind,
      category: p.profile.category,
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z,
      innerRadius: p.profile.blast.innerRadius,
      radius: p.blastRadius,
      damage: p.damage,
      falloffExponent: p.profile.blast.falloffExponent,
      vehicleDamageMultiplier: p.profile.blast.vehicleDamageMultiplier,
      destructionPower: p.profile.blast.destructionPower,
      fromPlayer: p.fromPlayer,
      sourceUnitId: p.sourceUnitId,
      sourceSquadId: p.sourceSquadId,
      sourceDomain: p.sourceDomain,
    });

    this.pool.release(p);
  }

  getFlightTelemetrySamples(): FlightTelemetrySample[] {
    const samples: FlightTelemetrySample[] = [];
    this.pool.forEachActive((p) => {
      const speed = p.vel.length();
      const maxSpeed = p.profile.kinematics.maxSpeed;
      const dirX = speed > 0.001 ? p.vel.x / speed : p.dir.x;
      const dirY = speed > 0.001 ? p.vel.y / speed : p.dir.y;
      const dirZ = speed > 0.001 ? p.vel.z / speed : p.dir.z;

      let tti: number | null = null;
      const tgt = p.homingTarget?.alive ? p.homingTarget.position : p.targetPoint;
      if (tgt && speed > 0.5) {
        tti = Number((p.pos.distanceTo(tgt) / speed).toFixed(2));
      } else if (p.vel.y < -1 && p.pos.y > 0) {
        tti = Number((p.pos.y / Math.abs(p.vel.y)).toFixed(2));
      }

      const speedOutlier = maxSpeed > 0 && speed > maxSpeed * 1.06;
      if (speedOutlier) {
        this.telemetry?.recordSpeedOutlier();
      }

      samples.push({
        id: p.id,
        domain: 'projectile',
        category: p.kind,
        x: Number(p.pos.x.toFixed(1)),
        y: Number(p.pos.y.toFixed(1)),
        z: Number(p.pos.z.toFixed(1)),
        speed: Number(speed.toFixed(2)),
        acceleration: Number(p.lastAccelMag.toFixed(1)),
        maxSpeed,
        dirX: Number(dirX.toFixed(2)),
        dirY: Number(dirY.toFixed(2)),
        dirZ: Number(dirZ.toFixed(2)),
        turnRateDegPerSec: Number(p.lastTurnRateDegPerSec.toFixed(1)),
        maxTurnRateDegPerSec: p.profile.kinematics.maxTurnRateDegPerSec,
        flightTimeSec: Number(p.life.toFixed(2)),
        remainingLifeSec: Number(Math.max(0, p.maxLife - p.life).toFixed(2)),
        trackingState: p.trackingState,
        timeToImpactSec: tti,
        stateLabel: p.boostRemainingSec > 0 ? 'BOOSTING' : p.profile.detonation.triggerMode.toUpperCase(),
        speedOutlier,
      });
    });
    return samples;
  }

  resetAll(): void {
    this.pool.releaseAll();
  }

  getActiveCount(): number {
    return this.pool.getActiveCount();
  }

  getPoolCapacity(): number {
    return POOL_CAPACITY;
  }

  getPhysicsInspectorRows(): PhysicsBodyInspectorRow[] {
    const out: PhysicsBodyInspectorRow[] = [];
    this.pool.forEachActive((p) => {
      const spd = p.vel.length();
      const r = p.profile.kinematics.collisionRadius;
      out.push({
        id: p.id,
        entityType: 'projectile',
        classification: 'dynamic',
        shape: 'sphere',
        dimensions: `r=${r}m`,
        x: Number(p.pos.x.toFixed(2)),
        y: Number(p.pos.y.toFixed(2)),
        z: Number(p.pos.z.toFixed(2)),
        yaw: 0,
        vx: Number(p.vel.x.toFixed(2)),
        vy: Number(p.vel.y.toFixed(2)),
        vz: Number(p.vel.z.toFixed(2)),
        ax: 0,
        ay: -9.81 * p.profile.kinematics.gravityScale,
        az: 0,
        speed: Number(spd.toFixed(2)),
        massKg: 2.5,
        layer: COLLISION_LAYER.PROJECTILE,
        layerLabel: formatCollisionLayer(COLLISION_LAYER.PROJECTILE),
        mask: PHYSICS_MASKS.PROJECTILE_SOLID,
        maskLabel: formatCollisionLayer(PHYSICS_MASKS.PROJECTILE_SOLID),
        physicalState: 'BALLISTIC',
        lastCollisionId: null,
        lastNormalX: 0,
        lastNormalY: 1,
        lastNormalZ: 0,
        contactCount: 0,
      });
    });
    return out;
  }
}
