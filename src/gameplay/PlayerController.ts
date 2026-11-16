import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { InputManager } from '@/src/engine/InputManager';
import { formatCollisionLayer, PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import type { CharacterMoveResult, PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { PlayerHitZone } from '@/src/schemas/combat.schema';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import type { PlayerMovementTelemetry } from './CombatTelemetryRecorder';

export interface PlayerHitboxVolumes {
  stance: 'standing' | 'crouching' | 'sliding';
  totalHeight: number;
  headCenter: THREE.Vector3;
  headRadius: number;
  upperTorsoMin: THREE.Vector3;
  upperTorsoMax: THREE.Vector3;
  lowerBodyMin: THREE.Vector3;
  lowerBodyMax: THREE.Vector3;
}

export interface PlayerVisibilitySamplePoints {
  head: THREE.Vector3;
  chest: THREE.Vector3;
  pelvis: THREE.Vector3;
  leftShoulder: THREE.Vector3;
  rightShoulder: THREE.Vector3;
}

export class PlayerController {
  public readonly position = new THREE.Vector3(0, 0, 58);
  public readonly velocity = new THREE.Vector3();
  public yaw = 0;
  public pitch = 0;
  public grounded = true;

  public health = 100;
  public maxHealth = 100;
  public armor = 100;
  public maxArmor = 100;
  public grenades = 3;

  public isSprinting = false;
  public isCrouching = false;
  public isSliding = false;
  public currentSpeed = 0;
  public alive = true;
  public suppressionLevel = 0;

  private slideTimer = 0;
  private slideDir = new THREE.Vector3();
  private bobTime = 0;
  private stepDistAccum = 0;
  private timeSinceDamage = 10;
  private trauma = 0;
  private damageFlash = 0;
  private recoilPitchOffset = 0;
  private recoilYawOffset = 0;
  private crouchBlend = 0;
  private lastShotIdApplied = -1;
  private appliedExplosionIds = new Set<number>();
  private lastSoundEmitTime = -10;
  private lastSoundEmitRadius = 0;
  private airTimeSec = 0;
  private lastJumpImpulse = 0;
  private lastLandImpulse = 0;
  private landCompressionOffset = 0;
  private accelState: PlayerMovementTelemetry['accelState'] = 'IDLE';
  private lastArmorAbsorbed = 0;
  private lastHealthLost = 0;
  private lastMoveResult: CharacterMoveResult | null = null;
  private occupiedVehicleColliderId: string | null = null;
  private occupiedVehicleDamageHandler:
    | ((amount: number) => { hullDestroyed: boolean; residualPlayerDamage: number })
    | null = null;

  private readonly standingEyeHeight = 1.66;
  private readonly crouchEyeHeight = 1.05;
  private readonly slideEyeHeight = 0.85;
  private readonly capsuleRadius = 0.45;
  private readonly stepHeight = 0.48;

  private readonly _fwd = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _wish = new THREE.Vector3();
  private readonly _camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly _moveResultScratch: CharacterMoveResult = {
    grounded: false,
    hitCeiling: false,
    hitWall: false,
    hitHorizontal: false,
    steppedUp: false,
    clampedWorldBounds: false,
    lastBlockerId: null,
    wallNormalX: 0,
    wallNormalY: 0,
    wallNormalZ: 0,
    penetrationCorrected: 0,
    activeContacts: 0,
    maxPenetrationDepth: 0,
  };

  private readonly _hitboxVolumes: PlayerHitboxVolumes = {
    stance: 'standing',
    totalHeight: 1.8,
    headCenter: new THREE.Vector3(),
    headRadius: 0.21,
    upperTorsoMin: new THREE.Vector3(),
    upperTorsoMax: new THREE.Vector3(),
    lowerBodyMin: new THREE.Vector3(),
    lowerBodyMax: new THREE.Vector3(),
  };

  private readonly _samplePoints: PlayerVisibilitySamplePoints = {
    head: new THREE.Vector3(),
    chest: new THREE.Vector3(),
    pelvis: new THREE.Vector3(),
    leftShoulder: new THREE.Vector3(),
    rightShoulder: new THREE.Vector3(),
  };

  constructor(private readonly audio: AudioManager) {}

  setOccupiedVehicleShield(
    colliderId: string | null,
    handler: ((amount: number) => { hullDestroyed: boolean; residualPlayerDamage: number }) | null
  ): void {
    this.occupiedVehicleColliderId = colliderId;
    this.occupiedVehicleDamageHandler = handler;
  }

  isOccupyingVehicle(): boolean {
    return this.occupiedVehicleColliderId !== null && this.occupiedVehicleDamageHandler !== null;
  }

  getOccupiedVehicleColliderId(): string | null {
    return this.occupiedVehicleColliderId;
  }

  spawn(x: number, y: number, z: number, yaw = 0): void {
    this.position.set(x, Math.max(0, y - 1.65), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = true;
    this.health = this.maxHealth;
    this.armor = this.maxArmor;
    this.grenades = 3;
    this.alive = true;
    this.isSprinting = false;
    this.isCrouching = false;
    this.isSliding = false;
    this.suppressionLevel = 0;
    this.slideTimer = 0;
    this.trauma = 0;
    this.recoilPitchOffset = 0;
    this.recoilYawOffset = 0;
    this.lastShotIdApplied = -1;
    this.appliedExplosionIds.clear();
    this.airTimeSec = 0;
    this.lastJumpImpulse = 0;
    this.lastLandImpulse = 0;
    this.landCompressionOffset = 0;
    this.accelState = 'IDLE';
    this.lastArmorAbsorbed = 0;
    this.lastHealthLost = 0;
    this.lastMoveResult = null;
    this.occupiedVehicleColliderId = null;
    this.occupiedVehicleDamageHandler = null;
  }

  addRecoilKick(pitchKick: number, yawKick: number): void {
    const stanceScale = this.isCrouching ? 0.78 : 1.0;
    this.recoilPitchOffset = Math.min(0.28, this.recoilPitchOffset + pitchKick * stanceScale);
    this.recoilYawOffset += yawKick * stanceScale;
    this.trauma = Math.min(1, this.trauma + pitchKick * stanceScale * 3.5);
  }

  addCameraShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  applySuppressionPulse(intensity: number): void {
    this.suppressionLevel = Math.min(1, this.suppressionLevel + intensity);
    this.trauma = Math.min(0.45, this.trauma + intensity * 0.12);
  }

  emitAcousticEvent(radiusMeters: number, nowSec: number): void {
    this.lastSoundEmitTime = nowSec;
    this.lastSoundEmitRadius = Math.max(this.lastSoundEmitRadius, radiusMeters);
  }

  getActiveAcousticRadius(nowSec: number): number {
    if (nowSec - this.lastSoundEmitTime <= 0.35) {
      return this.lastSoundEmitRadius;
    }
    this.lastSoundEmitRadius = 0;
    if (this.isSprinting || this.isSliding) return 18;
    if (this.currentSpeed > 1.5 && !this.isCrouching) return 7.5;
    return 0;
  }

  /**
   * Single-hit guarded damage handler ensuring a shotId can never apply duplicate damage.
   */
  applyValidatedShotDamage(
    shotId: number,
    amount: number,
    sourceX: number,
    sourceZ: number,
    _hitZone: PlayerHitZone = 'upper_torso'
  ): number {
    if (!this.alive || amount <= 0) return 0;
    if (shotId > 0 && shotId === this.lastShotIdApplied) {
      return 0;
    }
    if (shotId > 0) {
      this.lastShotIdApplied = shotId;
    }
    const beforeHp = this.health + this.armor;
    this.applyDamage(amount, sourceX, sourceZ);
    const afterHp = this.health + this.armor;
    return Math.max(0, beforeHp - afterHp);
  }

  applyValidatedExplosionDamage(
    explosionId: number,
    amount: number,
    sourceX: number,
    sourceZ: number
  ): number {
    if (!this.alive || amount <= 0) return 0;
    if (this.appliedExplosionIds.has(explosionId)) {
      return 0;
    }
    this.appliedExplosionIds.add(explosionId);
    if (this.appliedExplosionIds.size > 64) {
      const first = this.appliedExplosionIds.values().next().value;
      if (first !== undefined) this.appliedExplosionIds.delete(first);
    }
    const beforeHp = this.health + this.armor;
    this.applyDamage(amount, sourceX, sourceZ);
    const afterHp = this.health + this.armor;
    return Math.max(0, beforeHp - afterHp);
  }

  getLastDamageBreakdown(): { armorAbsorbed: number; healthLost: number } {
    return { armorAbsorbed: this.lastArmorAbsorbed, healthLost: this.lastHealthLost };
  }

  applyDamage(amount: number, sourceX: number, sourceZ: number): void {
    if (!this.alive || amount <= 0) return;

    // Directional damage indicator angle relative to player facing yaw
    const dx = sourceX - this.position.x;
    const dz = sourceZ - this.position.z;
    const worldAngle = Math.atan2(dx, -dz);
    const relAngle = worldAngle + this.yaw;

    // If occupying an intact vehicle, route damage to vehicle hull first
    if (this.occupiedVehicleDamageHandler) {
      const shieldHandler = this.occupiedVehicleDamageHandler;
      const hullOutcome = shieldHandler(amount);
      if (!hullOutcome.hullDestroyed) {
        this.lastArmorAbsorbed = 0;
        this.lastHealthLost = 0;
        this.addCameraShake(Math.min(0.28, amount * 0.008));
        gameSessionStore.getState().pushDamageArc(relAngle, Math.min(0.65, amount / 40));
        return;
      }
      amount = hullOutcome.residualPlayerDamage;
      if (amount <= 0) {
        this.lastArmorAbsorbed = 0;
        this.lastHealthLost = 0;
        return;
      }
    }

    this.timeSinceDamage = 0;
    this.damageFlash = 1;
    this.addCameraShake(Math.min(0.6, amount * 0.015));

    // Armor absorbs 55% of incoming damage while intact
    let remaining = amount;
    let absorbed = 0;
    if (this.armor > 0) {
      absorbed = Math.min(this.armor, amount * 0.55);
      this.armor -= absorbed;
      remaining -= absorbed;
    }
    const beforeHealth = this.health;
    this.health = Math.max(0, this.health - remaining);
    this.lastArmorAbsorbed = Number(absorbed.toFixed(2));
    this.lastHealthLost = Number((beforeHealth - this.health).toFixed(2));

    gameSessionStore.getState().pushDamageArc(relAngle, Math.min(1, amount / 25));

    if (this.health <= 0) {
      this.alive = false;
    }
  }


  /**
   * Returns stance-aware 3D hitbox volumes (Head sphere, Upper Torso box, Lower Body box).
   * Standing: 1.80m total height (crouching behind 1.45m barrier exposes head/upper chest).
   * Crouching: 1.15m total height (completely below 1.45m barrier).
   * Sliding: 0.95m total height (low profile).
   */
  getStanceHitboxes(): PlayerHitboxVolumes {
    const px = this.position.x;
    const py = this.position.y;
    const pz = this.position.z;

    if (this.isSliding) {
      this._hitboxVolumes.stance = 'sliding';
      this._hitboxVolumes.totalHeight = 0.95;
      this._hitboxVolumes.headCenter.set(px, py + 0.78, pz);
      this._hitboxVolumes.headRadius = 0.19;
      this._hitboxVolumes.upperTorsoMin.set(px - 0.23, py + 0.42, pz - 0.23);
      this._hitboxVolumes.upperTorsoMax.set(px + 0.23, py + 0.68, pz + 0.23);
      this._hitboxVolumes.lowerBodyMin.set(px - 0.24, py + 0.02, pz - 0.24);
      this._hitboxVolumes.lowerBodyMax.set(px + 0.24, py + 0.42, pz + 0.24);
    } else if (this.isCrouching || this.crouchBlend > 0.5) {
      this._hitboxVolumes.stance = 'crouching';
      this._hitboxVolumes.totalHeight = 1.15;
      this._hitboxVolumes.headCenter.set(px, py + 0.98, pz);
      this._hitboxVolumes.headRadius = 0.2;
      this._hitboxVolumes.upperTorsoMin.set(px - 0.23, py + 0.54, pz - 0.23);
      this._hitboxVolumes.upperTorsoMax.set(px + 0.23, py + 0.86, pz + 0.23);
      this._hitboxVolumes.lowerBodyMin.set(px - 0.22, py + 0.02, pz - 0.22);
      this._hitboxVolumes.lowerBodyMax.set(px + 0.22, py + 0.54, pz + 0.22);
    } else {
      this._hitboxVolumes.stance = 'standing';
      this._hitboxVolumes.totalHeight = 1.8;
      this._hitboxVolumes.headCenter.set(px, py + 1.62, pz);
      this._hitboxVolumes.headRadius = 0.21;
      this._hitboxVolumes.upperTorsoMin.set(px - 0.23, py + 0.92, pz - 0.23);
      this._hitboxVolumes.upperTorsoMax.set(px + 0.23, py + 1.44, pz + 0.23);
      this._hitboxVolumes.lowerBodyMin.set(px - 0.21, py + 0.02, pz - 0.21);
      this._hitboxVolumes.lowerBodyMax.set(px + 0.21, py + 0.92, pz + 0.21);
    }

    return this._hitboxVolumes;
  }

  /**
   * Returns 5 anatomical 3D sample points for partial-exposure LOS checks around corners,
   * windows, doorways, and variable-height barriers.
   */
  getVisibilitySamplePoints(): PlayerVisibilitySamplePoints {
    const hb = this.getStanceHitboxes();
    const px = this.position.x;
    const pz = this.position.z;
    const chestY = (hb.upperTorsoMin.y + hb.upperTorsoMax.y) * 0.5;
    const pelvisY = (hb.lowerBodyMin.y + hb.lowerBodyMax.y) * 0.5;

    const rightX = Math.cos(this.yaw) * 0.24;
    const rightZ = -Math.sin(this.yaw) * 0.24;

    this._samplePoints.head.copy(hb.headCenter);
    this._samplePoints.chest.set(px, chestY, pz);
    this._samplePoints.pelvis.set(px, pelvisY, pz);
    this._samplePoints.leftShoulder.set(px - rightX, chestY + 0.08, pz - rightZ);
    this._samplePoints.rightShoulder.set(px + rightX, chestY + 0.08, pz + rightZ);

    return this._samplePoints;
  }

  heal(amount: number): number {
    if (!this.alive || amount <= 0) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return Number((this.health - before).toFixed(2));
  }

  resupply(): void {
    this.health = Math.min(this.maxHealth, this.health + 55);
    this.armor = Math.min(this.maxArmor, this.armor + 65);
    this.grenades = Math.min(4, this.grenades + 2);
  }

  applyLookInput(input: InputManager, isAds: boolean): void {
    if (!this.alive) return;
    const { yawDelta, pitchDelta } = input.consumeLookDelta(isAds);
    if (!Number.isFinite(yawDelta) || !Number.isFinite(pitchDelta)) return;
    this.yaw -= yawDelta;
    this.pitch = Math.max(-1.42, Math.min(1.42, this.pitch - pitchDelta));
  }

  update(
    dt: number,
    input: InputManager,
    collision: CollisionWorld,
    isAds: boolean,
    weaponMobilityFactor: number,
    headBobIntensity: number,
    inVehicle: boolean
  ): void {
    if (!this.alive) return;

    this.timeSinceDamage += dt;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.5);
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    this.suppressionLevel = Math.max(0, this.suppressionLevel - dt * 0.85);

    // Tactical health auto-regeneration up to 65 HP after 5.5s out of combat
    if (this.timeSinceDamage > 5.5 && this.health < 65) {
      this.health = Math.min(65, this.health + 8 * dt);
    }

    // Look delta
    this.applyLookInput(input, isAds);

    // Smooth recoil recovery (crouching settles faster)
    const recoilRecoveryRate = this.isCrouching ? 11.2 : 9.0;
    this.recoilPitchOffset = THREE.MathUtils.lerp(
      this.recoilPitchOffset,
      0,
      Math.min(1, dt * recoilRecoveryRate)
    );
    this.recoilYawOffset = THREE.MathUtils.lerp(
      this.recoilYawOffset,
      0,
      Math.min(1, dt * recoilRecoveryRate)
    );
    this.landCompressionOffset = THREE.MathUtils.lerp(
      this.landCompressionOffset,
      0,
      Math.min(1, dt * 12)
    );

    if (inVehicle) {
      this.currentSpeed = 0;
      return;
    }

    const axes = input.getMoveAxes();
    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Crouch & Slide triggers with overhead ceiling clearance verification
    if (input.wasActionPressed('crouch')) {
      if (this.isSprinting && this.grounded && !this.isSliding) {
        this.isSliding = true;
        this.slideTimer = 0.62;
        this.slideDir
          .set(0, 0, 0)
          .addScaledVector(this._fwd, axes.forward > 0.1 ? axes.forward : 1)
          .addScaledVector(this._right, axes.right * 0.65);
        if (this.slideDir.lengthSq() > 0.001) {
          this.slideDir.normalize();
        } else {
          this.slideDir.copy(this._fwd);
        }
        this.isCrouching = true;
      } else if (this.isCrouching) {
        if (collision.canStandUp(this.position, this.capsuleRadius, 1.8, 'player')) {
          this.isCrouching = false;
        }
      } else {
        this.isCrouching = true;
      }
    }

    if (this.isSliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) {
        this.isSliding = false;
        if (!collision.canStandUp(this.position, this.capsuleRadius, 1.8, 'player')) {
          this.isCrouching = true;
        }
      }
    }

    const isFiringOrAiming =
      isAds ||
      input.isActionHeld('ads') ||
      input.isActionHeld('fire') ||
      input.wasActionPressed('fire');
    let wantsSprint =
      input.isActionHeld('sprint') &&
      axes.forward > 0.38 &&
      Math.abs(axes.right) <= axes.forward * 1.08 &&
      !isFiringOrAiming &&
      !this.isSliding;
    if (wantsSprint && this.isCrouching) {
      if (collision.canStandUp(this.position, this.capsuleRadius, 1.8, 'player')) {
        this.isCrouching = false;
      } else {
        wantsSprint = false;
      }
    }
    this.isSprinting = wantsSprint;

    this.crouchBlend = THREE.MathUtils.lerp(
      this.crouchBlend,
      this.isCrouching || this.isSliding ? 1 : 0,
      Math.min(1, dt * 12)
    );

    const baseWalk = 6.2 * weaponMobilityFactor;
    const targetSpeed = this.isSliding
      ? 12.2
      : this.isSprinting
        ? 9.6 * weaponMobilityFactor
        : this.isCrouching
          ? 3.7 * weaponMobilityFactor
          : isAds
            ? baseWalk * 0.65
            : baseWalk;

    if (this.isSliding) {
      this._wish
        .copy(this.slideDir)
        .addScaledVector(this._right, axes.right * 0.42)
        .normalize();
    } else {
      this._wish
        .set(0, 0, 0)
        .addScaledVector(this._fwd, axes.forward)
        .addScaledVector(this._right, axes.right);
      const wishMag = this._wish.length();
      if (wishMag > 1) {
        this._wish.divideScalar(wishMag);
      }
    }

    const hasWish = this._wish.lengthSq() > 0.0001;
    const accel = this.grounded ? (hasWish ? 28 : 20) : 6;
    const prevHoriz = Math.hypot(this.velocity.x, this.velocity.z);
    const targetVx = this._wish.x * targetSpeed;
    const targetVz = this._wish.z * targetSpeed;
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVx, Math.min(1, dt * accel));
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVz, Math.min(1, dt * accel));

    // Jump (only if overhead clearance allows standing/jumping)
    if (input.wasActionPressed('jump') && this.grounded) {
      if (collision.canStandUp(this.position, this.capsuleRadius, 1.85, 'player')) {
        this.velocity.y = 7.4;
        this.lastJumpImpulse = 7.4;
        this.grounded = false;
        this.isCrouching = false;
        this.isSliding = false;
      }
    }

    const wasGrounded = this.grounded;
    const preStepVy = this.velocity.y;

    // Gravity
    this.velocity.y -= 21.5 * dt;

    const capsuleHeight = this.isSliding ? 0.95 : this.isCrouching ? 1.15 : 1.8;
    const res = collision.resolvePlayerCapsule(
      this.position,
      this.velocity,
      this.capsuleRadius,
      capsuleHeight,
      this.stepHeight,
      dt,
      'player',
      undefined,
      this._moveResultScratch
    );
    this.grounded = res.grounded;
    this.lastMoveResult = res;

    if (!wasGrounded && this.grounded) {
      const impactVy = Math.abs(preStepVy);
      this.lastLandImpulse = Number(impactVy.toFixed(2));
      this.landCompressionOffset = -Math.min(0.24, Math.max(0.03, impactVy * 0.016));
      if (impactVy > 6) {
        this.audio.play2D('footstep', 2, 0.4);
      }
      this.airTimeSec = 0;
    } else if (!this.grounded) {
      this.airTimeSec += dt;
    }

    this.currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (!this.grounded) {
      this.accelState = 'AIRBORNE';
    } else if (this.isSliding) {
      this.accelState = 'SLIDING';
    } else if (!hasWish && this.currentSpeed < 0.25) {
      this.accelState = 'IDLE';
    } else if (!hasWish) {
      this.accelState = 'DECELERATING';
    } else if (this.currentSpeed < targetSpeed * 0.88 && this.currentSpeed >= prevHoriz) {
      this.accelState = 'ACCELERATING';
    } else {
      this.accelState = 'CRUISE';
    }

    if (this.grounded && this.currentSpeed > 1.2 && !this.isSliding) {
      this.bobTime += dt * (this.isSprinting ? 13 : 8.8) * headBobIntensity;
      this.stepDistAccum += this.currentSpeed * dt;
      if (this.stepDistAccum >= (this.isSprinting ? 2.6 : 2.1)) {
        this.stepDistAccum = 0;
        this.audio.play2D('footstep', 2, 0.25);
      }
    }
  }

  syncCamera(camera: THREE.PerspectiveCamera, baseFov: number, adsFov: number, isAds: boolean, dt: number): void {
    const targetEye = this.isSliding
      ? this.slideEyeHeight
      : THREE.MathUtils.lerp(this.standingEyeHeight, this.crouchEyeHeight, this.crouchBlend);
    const bobOffset = this.grounded && this.currentSpeed > 1.2 && !isAds ? Math.sin(this.bobTime) * 0.045 : 0;
    const shake = this.trauma * this.trauma * 0.035;
    let sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;

    // Prevent camera shake from pushing the near-plane into an adjacent wall
    if (this.lastMoveResult?.hitHorizontal) {
      sx = 0;
    }

    camera.position.set(
      this.position.x + sx,
      this.position.y + targetEye + bobOffset + sy + this.landCompressionOffset,
      this.position.z
    );

    this._camEuler.set(
      Math.max(-1.45, Math.min(1.45, this.pitch + this.recoilPitchOffset)),
      this.yaw + this.recoilYawOffset,
      this.isSliding ? -0.05 : 0,
      'YXZ'
    );
    camera.quaternion.setFromEuler(this._camEuler);

    const targetFov = isAds ? adsFov : this.isSprinting ? Math.min(106, baseFov + 5) : baseFov;
    const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, dt * 14));
    if (Math.abs(nextFov - camera.fov) > 0.04) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  }

  getEyePosition(out: THREE.Vector3): THREE.Vector3 {
    const eyeH = this.isSliding
      ? this.slideEyeHeight
      : THREE.MathUtils.lerp(this.standingEyeHeight, this.crouchEyeHeight, this.crouchBlend);
    return out.set(this.position.x, this.position.y + eyeH, this.position.z);
  }

  getDamageFlash(): number {
    return this.damageFlash;
  }

  getMovementTelemetry(
    weaponName: string,
    equipTimerSec: number,
    reloadStage: PlayerMovementTelemetry['reloadStage'],
    reloadProgress: number
  ): PlayerMovementTelemetry {
    const speed3d = this.velocity.length();
    return {
      speed: Number(speed3d.toFixed(2)),
      horizontalSpeed: Number(this.currentSpeed.toFixed(2)),
      velX: Number(this.velocity.x.toFixed(2)),
      velY: Number(this.velocity.y.toFixed(2)),
      velZ: Number(this.velocity.z.toFixed(2)),
      stance: this.isSliding ? 'sliding' : this.isCrouching ? 'crouching' : 'standing',
      grounded: this.grounded,
      airTimeSec: Number(this.airTimeSec.toFixed(2)),
      lastJumpImpulse: this.lastJumpImpulse,
      lastLandImpulse: this.lastLandImpulse,
      accelState: this.accelState,
      recoilPitchDeg: Number(((this.recoilPitchOffset * 180) / Math.PI).toFixed(2)),
      recoilYawDeg: Number(((this.recoilYawOffset * 180) / Math.PI).toFixed(2)),
      suppressionLevel: Number(this.suppressionLevel.toFixed(2)),
      trauma: Number(this.trauma.toFixed(2)),
      weaponName,
      equipTimerSec: Number(equipTimerSec.toFixed(2)),
      reloadStage,
      reloadProgress: Number(reloadProgress.toFixed(2)),
    };
  }

  getPhysicsInspectorRow(): PhysicsBodyInspectorRow {
    const stanceH = this.isSliding ? 0.95 : this.isCrouching ? 1.15 : 1.8;
    const physicalState = !this.grounded
      ? 'AIRBORNE'
      : this.isSliding
        ? 'SLIDING'
        : this.isCrouching
          ? 'CROUCHED'
          : 'GROUNDED';

    return {
      id: 'player',
      entityType: 'player',
      classification: 'character',
      shape: 'capsule',
      dimensions: `r=${this.capsuleRadius}m h=${stanceH}m`,
      x: Number(this.position.x.toFixed(2)),
      y: Number(this.position.y.toFixed(2)),
      z: Number(this.position.z.toFixed(2)),
      yaw: Number(this.yaw.toFixed(2)),
      vx: Number(this.velocity.x.toFixed(2)),
      vy: Number(this.velocity.y.toFixed(2)),
      vz: Number(this.velocity.z.toFixed(2)),
      ax: 0,
      ay: -21.5,
      az: 0,
      speed: Number(this.currentSpeed.toFixed(2)),
      massKg: 85,
      layer: COLLISION_LAYER.PLAYER,
      layerLabel: formatCollisionLayer(COLLISION_LAYER.PLAYER),
      mask: PHYSICS_MASKS.CHARACTER_SOLID,
      maskLabel: formatCollisionLayer(PHYSICS_MASKS.CHARACTER_SOLID),
      physicalState,
      lastCollisionId: this.lastMoveResult?.lastBlockerId ?? null,
      lastNormalX: Number((this.lastMoveResult?.wallNormalX ?? 0).toFixed(2)),
      lastNormalY: Number((this.lastMoveResult?.wallNormalY ?? 1).toFixed(2)),
      lastNormalZ: Number((this.lastMoveResult?.wallNormalZ ?? 0).toFixed(2)),
      contactCount: this.lastMoveResult?.activeContacts ?? (this.grounded ? 1 : 0),
    };
  }
}
