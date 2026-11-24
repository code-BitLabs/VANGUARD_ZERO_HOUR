import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { InputManager } from '@/src/engine/InputManager';
import {
  VAULT_CAPSULE_HEIGHT,
  VaultMode,
  VaultProbeResult,
} from '@/src/engine/physics/CollisionSystem';
import { formatCollisionLayer, PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import type { CharacterMoveResult, PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import { AGENT_TRAVERSAL_PROFILES } from '@/src/navigation/AgentTraversalProfile';
import { CollisionWorld, LadderVolume } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import {
  DIFFICULTY_COMBAT_PROFILES,
  DifficultyCombatProfile,
  PlayerHitZone,
} from '@/src/schemas/combat.schema';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import type { WeaponRecoilSignature } from './CombatFeedbackDirector';
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
  public readonly prevPosition = new THREE.Vector3(0, 0, 58);
  public readonly velocity = new THREE.Vector3();
  public yaw = 0;
  public pitch = 0;
  public grounded = true;

  public health = 100;
  public maxHealth = 100;
  public armor = 100;
  public maxArmor = 100;
  public armorAbsorption = 0.55;
  public hpRegenDelaySec = 4.0;
  public hpRegenRatePerSec = 11;
  public hpRegenCap = 85;
  public spawnGraceDurationSec = 0;
  public spawnProtectionRemainingSec = 0;
  public isRegenerating = false;
  public touchAimFrictionScale = 1.0;
  public onHealthRegenerated: ((amount: number) => void) | null = null;
  public grenades = 3;

  public isSprinting = false;
  public isCrouching = false;
  public isSliding = false;
  public isVaulting = false;
  public canVault = false;
  public isClimbingLadder = false;
  public canClimbLadder = false;
  public activeLadder: LadderVolume | null = null;
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
  private recoilPitchVel = 0;
  private recoilYawVel = 0;
  private recoilStiffness = 175;
  private recoilDamping = 22;
  private cameraRollKick = 0;
  private cameraFovKick = 0;
  private recoilRollSign = 1;
  private burstShotIndex = 0;
  private timeSinceLastShot = 10;
  private crouchBlend = 0;
  private lastShotIdApplied = -1;
  private appliedExplosionIds = new Set<number>();
  private lastSoundEmitTime = -10;
  private lastSoundEmitRadius = 0;
  private airTimeSec = 0;
  private lastJumpImpulse = 0;
  private lastLandImpulse = 0;
  private landCompressionOffset = 0;
  private landSpringVel = 0;
  private eyeStepOffset = 0;
  private vaultPitchOffset = 0;
  private vaultRollOffset = 0;

  private vaultMode: VaultMode = 'vault_over';
  private vaultObstacleId: string | null = null;
  private vaultElapsed = 0;
  private vaultDuration = 0.36;
  private vaultStartX = 0;
  private vaultStartY = 0;
  private vaultStartZ = 0;
  private vaultHoldX = 0;
  private vaultHoldZ = 0;
  private vaultClearX = 0;
  private vaultClearZ = 0;
  private vaultApexY = 0;
  private vaultLandX = 0;
  private vaultLandY = 0;
  private vaultLandZ = 0;
  private vaultDirX = 0;
  private vaultDirZ = -1;
  private vaultLandCrouched = false;

  private accelState: PlayerMovementTelemetry['accelState'] = 'IDLE';
  private lastArmorAbsorbed = 0;
  private lastHealthLost = 0;
  private lastMoveResult: CharacterMoveResult | null = null;
  private vaultProbeCooldownSec = 0;
  private occupiedVehicleColliderId: string | null = null;
  private occupiedVehicleDamageHandler:
    | ((amount: number) => { hullDestroyed: boolean; residualPlayerDamage: number })
    | null = null;

  private ladderCooldownSec = 0;
  private ladderStepAccum = 0;

  private readonly standingHeight = AGENT_TRAVERSAL_PROFILES.player.standingHeight;
  private readonly crouchedHeight = AGENT_TRAVERSAL_PROFILES.player.crouchedHeight;
  private readonly standingEyeHeight = 1.62;
  private readonly crouchEyeHeight = 1.05;
  private readonly slideEyeHeight = 0.85;
  private readonly capsuleRadius = AGENT_TRAVERSAL_PROFILES.player.capsuleRadius;
  private readonly stepHeight = AGENT_TRAVERSAL_PROFILES.player.maxStepHeight;

  private readonly _fwd = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _wish = new THREE.Vector3();
  private readonly _interpPos = new THREE.Vector3();
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
    totalHeight: AGENT_TRAVERSAL_PROFILES.player.standingHeight,
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

  private readonly _vaultProbeScratch: VaultProbeResult = {
    canVault: false,
    mode: 'vault_over',
    obstacleId: null,
    obstacleTopY: 0,
    entryX: 0,
    entryZ: 0,
    entryDistance: 0,
    exitX: 0,
    exitZ: 0,
    landX: 0,
    landY: 0,
    landZ: 0,
    landCrouched: false,
    thickness: 0,
    obstacleHeight: 0,
  };

  constructor(private readonly audio: AudioManager) {}

  private incomingDamageScale = 1.0;
  private cameraShakeScale = 1.0;
  private reducedMotion = false;
  private activeHeadBobIntensity = 1.0;

  setIncomingDamageScale(scale: number): void {
    this.incomingDamageScale = Math.max(0.5, Math.min(2.5, scale));
  }

  setMotionSettings(cameraShakeScale: number, reducedMotion: boolean): void {
    this.cameraShakeScale = Math.max(
      0,
      Math.min(1.5, Number.isFinite(cameraShakeScale) ? cameraShakeScale : 1.0)
    );
    this.reducedMotion = Boolean(reducedMotion);
  }

  setDifficultyProfile(profile: DifficultyCombatProfile): void {
    this.maxHealth = profile.playerMaxHealth;
    this.maxArmor = profile.playerMaxArmor;
    this.armorAbsorption = profile.armorAbsorption;
    this.hpRegenDelaySec = profile.hpRegenDelaySec;
    this.hpRegenRatePerSec = profile.hpRegenRatePerSec;
    this.hpRegenCap = profile.hpRegenCap;
    this.spawnGraceDurationSec = profile.playerSpawnGraceSec;
    this.health = Math.min(this.health, this.maxHealth);
    this.armor = Math.min(this.armor, this.maxArmor);
  }

  isSpawnProtected(): boolean {
    return this.spawnProtectionRemainingSec > 0;
  }

  getSpawnProtectionRemainingSec(): number {
    return this.spawnProtectionRemainingSec;
  }

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

  spawn(x: number, y: number, z: number, yaw = 0, collision?: CollisionWorld): void {
    const rawFeetY = y - 1.65;
    const groundedY = collision
      ? collision.getSupportHeightAt(
          x,
          Math.max(rawFeetY, collision.getTerrainHeightOnly(x, z)),
          z,
          this.standingHeight,
          this.stepHeight,
          AGENT_TRAVERSAL_PROFILES.player.maxSlopeDeg
        )
      : Math.max(0, rawFeetY);
    this.position.set(x, groundedY, z);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = true;
    this.eyeStepOffset = 0;
    this.health = this.maxHealth;
    this.armor = this.maxArmor;
    this.spawnProtectionRemainingSec = this.spawnGraceDurationSec;
    this.isRegenerating = false;
    this.touchAimFrictionScale = 1.0;
    this.grenades = 3;
    this.alive = true;
    this.isSprinting = false;
    this.isCrouching = false;
    this.isSliding = false;
    this.isVaulting = false;
    this.canVault = false;
    this.isClimbingLadder = false;
    this.canClimbLadder = false;
    this.activeLadder = null;
    this.ladderCooldownSec = 0;
    this.ladderStepAccum = 0;
    this.vaultObstacleId = null;
    this.vaultElapsed = 0;
    this.suppressionLevel = 0;
    this.slideTimer = 0;
    this.trauma = 0;
    this.recoilPitchOffset = 0;
    this.recoilYawOffset = 0;
    this.recoilPitchVel = 0;
    this.recoilYawVel = 0;
    this.recoilStiffness = 175;
    this.recoilDamping = 22;
    this.cameraRollKick = 0;
    this.cameraFovKick = 0;
    this.burstShotIndex = 0;
    this.timeSinceLastShot = 10;
    this.lastShotIdApplied = -1;
    this.appliedExplosionIds.clear();
    this.airTimeSec = 0;
    this.lastJumpImpulse = 0;
    this.lastLandImpulse = 0;
    this.landCompressionOffset = 0;
    this.landSpringVel = 0;
    this.vaultPitchOffset = 0;
    this.vaultRollOffset = 0;
    this.accelState = 'IDLE';
    this.lastArmorAbsorbed = 0;
    this.lastHealthLost = 0;
    this.lastMoveResult = null;
    this.occupiedVehicleColliderId = null;
    this.occupiedVehicleDamageHandler = null;
  }

  getLastMoveResult(): CharacterMoveResult | null {
    return this.lastMoveResult;
  }

  getActiveCapsuleDimensions(): { radius: number; height: number } {
    const height = this.isVaulting
      ? VAULT_CAPSULE_HEIGHT
      : this.isSliding
        ? 0.95
        : this.isCrouching
          ? this.crouchedHeight
          : this.standingHeight;
    return { radius: this.capsuleRadius, height };
  }

  applyCheckpointVitals(health: number, armor: number): void {
    this.health = Math.min(this.maxHealth, Math.max(1, Math.round(health)));
    this.armor = Math.min(this.maxArmor, Math.max(0, Math.round(armor)));
    this.alive = true;
    this.timeSinceDamage = 10;
    this.damageFlash = 0;
    this.isRegenerating = false;
    this.spawnProtectionRemainingSec = this.spawnGraceDurationSec;
  }

  restoreHealthAndArmor(hpDelta: number, armorDelta: number): { hpAdded: number; armorAdded: number } {
    if (!this.alive) return { hpAdded: 0, armorAdded: 0 };
    const beforeHp = this.health;
    const beforeArmor = this.armor;
    if (hpDelta > 0) {
      this.health = Math.min(this.maxHealth, this.health + hpDelta);
    }
    if (armorDelta > 0) {
      this.armor = Math.min(this.maxArmor, this.armor + armorDelta);
    }
    return {
      hpAdded: Math.max(0, Math.round(this.health - beforeHp)),
      armorAdded: Math.max(0, Math.round(this.armor - beforeArmor)),
    };
  }

  resupplyGrenades(count: number, maxCap = 4): number {
    if (!this.alive || count <= 0) return 0;
    const before = this.grenades;
    this.grenades = Math.min(maxCap, this.grenades + count);
    return Math.max(0, this.grenades - before);
  }

  addRecoilKick(
    pitchKick: number,
    yawKick: number,
    signature?: WeaponRecoilSignature,
    isAds = false,
    motionScale = 1.0
  ): void {
    const stanceScale = this.isCrouching ? 0.78 : 1.0;
    const clampedMotion = Math.max(0, Math.min(1.2, motionScale));
    this.burstShotIndex = this.timeSinceLastShot < 0.34 ? this.burstShotIndex + 1 : 0;
    this.timeSinceLastShot = 0;

    const firstShotMult =
      this.burstShotIndex === 0 && signature ? signature.firstShotMultiplier : 1.0;
    const verticalBias = signature ? signature.verticalClimbBias : 1.0;

    const pitchImpulse = pitchKick * stanceScale * firstShotMult * verticalBias;
    const yawImpulse = yawKick * stanceScale;

    this.recoilStiffness =
      (signature ? signature.springStiffness : 175) +
      (isAds ? (signature ? signature.adsStiffnessBonus : 40) : 0);
    this.recoilDamping =
      (signature ? signature.springDamping : 22) * (this.isCrouching ? 1.15 : 1.0);

    // Immediate mechanical kick + upward velocity impulse solved analytically for 60Hz/144Hz parity
    this.recoilPitchOffset = Math.min(0.32, this.recoilPitchOffset + pitchImpulse * 0.52);
    this.recoilPitchVel = Math.min(3.8, this.recoilPitchVel + pitchImpulse * 8.2);
    this.recoilYawOffset = THREE.MathUtils.clamp(
      this.recoilYawOffset + yawImpulse * 0.55,
      -0.22,
      0.22
    );
    this.recoilYawVel = THREE.MathUtils.clamp(
      this.recoilYawVel + yawImpulse * 7.2,
      -3.0,
      3.0
    );

    if (clampedMotion > 0) {
      this.recoilRollSign = -this.recoilRollSign;
      const rollMag = (signature ? signature.rollKickRad : 0.008) * (isAds ? 0.55 : 1.0);
      this.cameraRollKick = THREE.MathUtils.clamp(
        this.cameraRollKick + rollMag * this.recoilRollSign * clampedMotion,
        -0.06,
        0.06
      );
      const fovMag = (signature ? signature.fovPunchDeg : 0.5) * (isAds ? 0.45 : 1.0);
      this.cameraFovKick = Math.min(3.2, this.cameraFovKick + fovMag * clampedMotion);
      this.trauma = Math.min(1, this.trauma + pitchImpulse * 2.8 * clampedMotion);
    }
  }

  getRecoilState(): {
    pitchOffset: number;
    yawOffset: number;
    pitchVel: number;
    yawVel: number;
    rollKick: number;
    fovKick: number;
    burstShotIndex: number;
  } {
    return {
      pitchOffset: this.recoilPitchOffset,
      yawOffset: this.recoilYawOffset,
      pitchVel: this.recoilPitchVel,
      yawVel: this.recoilYawVel,
      rollKick: this.cameraRollKick,
      fovKick: this.cameraFovKick,
      burstShotIndex: this.burstShotIndex,
    };
  }

  addCameraShake(amount: number): void {
    const motionMul = this.reducedMotion ? 0.35 : 1.0;
    const scaled = amount * this.cameraShakeScale * motionMul;
    if (scaled > 0) {
      this.trauma = Math.min(1, this.trauma + scaled);
    }
  }

  applySuppressionPulse(intensity: number): void {
    this.suppressionLevel = Math.min(1, this.suppressionLevel + intensity);
    // TRN-12: Reduced near-miss suppression camera shake by 50% for fair aim readability
    const motionMul = this.reducedMotion ? 0.35 : 1.0;
    const scaledTrauma = intensity * 0.06 * this.cameraShakeScale * motionMul;
    if (scaledTrauma > 0) {
      this.trauma = Math.min(0.24, this.trauma + scaledTrauma);
    }
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
   * Computes the incoming threat angle in player-local camera space:
   * 0 = directly ahead (top of screen), +PI/2 = right, +-PI = behind (bottom), -PI/2 = left.
   */
  computeRelativeThreatAngle(sourceX: number, sourceZ: number): number {
    const dx = sourceX - this.position.x;
    const dz = sourceZ - this.position.z;
    const forwardProj = dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw);
    const rightProj = dx * Math.cos(this.yaw) + dz * -Math.sin(this.yaw);
    return Math.atan2(rightProj, forwardProj);
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
    if (this.spawnProtectionRemainingSec > 0) {
      this.lastArmorAbsorbed = 0;
      this.lastHealthLost = 0;
      return 0;
    }
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
    if (this.spawnProtectionRemainingSec > 0) {
      this.lastArmorAbsorbed = 0;
      this.lastHealthLost = 0;
      return 0;
    }
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

  applyDamage(
    amount: number,
    sourceX: number,
    sourceZ: number,
    bypassSpawnProtection = false
  ): void {
    if (!this.alive || amount <= 0) return;
    if (this.spawnProtectionRemainingSec > 0 && !bypassSpawnProtection) {
      this.lastArmorAbsorbed = 0;
      this.lastHealthLost = 0;
      return;
    }
    amount = amount * this.incomingDamageScale;

    // Directional damage indicator angle in player-local forward/right basis
    const relAngle = this.computeRelativeThreatAngle(sourceX, sourceZ);

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
    this.isRegenerating = false;
    this.damageFlash = 1;
    this.addCameraShake(Math.min(0.6, amount * 0.015));

    // Armor absorbs difficulty-specific percentage of incoming damage while intact
    let remaining = amount;
    let absorbed = 0;
    if (this.armor > 0) {
      absorbed = Math.min(this.armor, amount * this.armorAbsorption);
      this.armor = Math.max(0, this.armor - absorbed);
      remaining -= absorbed;
    }
    const beforeHealth = this.health;
    this.health = Math.max(0, this.health - remaining);
    this.lastArmorAbsorbed = Number(absorbed.toFixed(2));
    this.lastHealthLost = Number((beforeHealth - this.health).toFixed(2));

    gameSessionStore.getState().pushDamageArc(relAngle, Math.min(1, amount / 25));

    if (this.health <= 0) {
      this.alive = false;
      this.isRegenerating = false;
      this.cancelVault(null);
      this.dismountLadder(false);
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
    } else if (this.isCrouching || this.isVaulting || this.crouchBlend > 0.5) {
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
      this._hitboxVolumes.totalHeight = this.standingHeight;
      this._hitboxVolumes.headCenter.set(px, py + 1.58, pz);
      this._hitboxVolumes.headRadius = 0.21;
      this._hitboxVolumes.upperTorsoMin.set(px - 0.23, py + 0.90, pz - 0.23);
      this._hitboxVolumes.upperTorsoMax.set(px + 0.23, py + 1.42, pz + 0.23);
      this._hitboxVolumes.lowerBodyMin.set(px - 0.21, py + 0.02, pz - 0.21);
      this._hitboxVolumes.lowerBodyMax.set(px + 0.21, py + 0.90, pz + 0.21);
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

  resupply(): { healthRestored: number; armorRestored: number } {
    const beforeHp = this.health;
    const beforeArmor = this.armor;
    this.health = Math.min(this.maxHealth, this.health + Math.round(this.maxHealth * 0.45));
    this.armor = Math.min(this.maxArmor, this.armor + Math.round(this.maxArmor * 0.55));
    this.grenades = Math.min(4, this.grenades + 2);
    return {
      healthRestored: Number((this.health - beforeHp).toFixed(2)),
      armorRestored: Number((this.armor - beforeArmor).toFixed(2)),
    };
  }

  snapInterpolation(): void {
    this.prevPosition.copy(this.position);
  }

  applyLookInput(input: InputManager, isAds: boolean, dt = 1 / 60): void {
    if (!this.alive) return;
    const { yawDelta, pitchDelta } = input.consumeLookDelta(isAds, this.touchAimFrictionScale, dt);
    if (!Number.isFinite(yawDelta) || !Number.isFinite(pitchDelta)) return;
    this.yaw -= yawDelta;

    // Tactical recoil pull-down compensation: pulling downward while muzzle has climbed
    // absorbs positive recoilPitchOffset first instead of over-pulling camera pitch into the floor.
    let remainingPitchDelta = pitchDelta;
    if (remainingPitchDelta > 0 && this.recoilPitchOffset > 0) {
      const absorbed = Math.min(this.recoilPitchOffset, remainingPitchDelta);
      this.recoilPitchOffset -= absorbed;
      if (this.recoilPitchVel > 0) {
        this.recoilPitchVel = Math.max(0, this.recoilPitchVel - absorbed * 18);
      }
      remainingPitchDelta -= absorbed;
    }
    this.pitch = Math.max(-1.42, Math.min(1.42, this.pitch - remainingPitchDelta));
  }

  /**
   * Exact analytical solution for a damped harmonic oscillator (x'' + c*x' + k*x = 0).
   * Guarantees frame-rate-invariant recoil recovery across 60Hz, 120Hz, and 144Hz monitors.
   */
  private stepAnalyticalSpring(
    x: number,
    v: number,
    stiffness: number,
    damping: number,
    dt: number
  ): [number, number] {
    if (Math.abs(x) < 1e-5 && Math.abs(v) < 1e-5) {
      return [0, 0];
    }
    const gamma = damping * 0.5;
    const disc = gamma * gamma - stiffness;
    let nx: number;
    let nv: number;
    if (disc < -1e-6) {
      const wd = Math.sqrt(-disc);
      const decay = Math.exp(-gamma * dt);
      const cos = Math.cos(wd * dt);
      const sin = Math.sin(wd * dt);
      nx = decay * (x * cos + ((v + gamma * x) / wd) * sin);
      nv = decay * (v * cos - ((gamma * v + stiffness * x) / wd) * sin);
    } else if (Math.abs(disc) <= 1e-6) {
      const decay = Math.exp(-gamma * dt);
      nx = decay * (x + (v + gamma * x) * dt);
      nv = decay * (v - (gamma * v + stiffness * x) * dt);
    } else {
      const s = Math.sqrt(disc);
      const r1 = -gamma + s;
      const r2 = -gamma - s;
      const c1 = (v - r2 * x) / (r1 - r2);
      const c2 = x - c1;
      const e1 = Math.exp(r1 * dt);
      const e2 = Math.exp(r2 * dt);
      nx = c1 * e1 + c2 * e2;
      nv = c1 * r1 * e1 + c2 * r2 * e2;
    }
    if (Math.abs(nx) < 1e-5 && Math.abs(nv) < 1e-5) {
      return [0, 0];
    }
    return [nx, nv];
  }

  getLandingSpringOffset(): number {
    return this.landCompressionOffset;
  }

  getLastVaultProbe(): Readonly<VaultProbeResult> {
    return this._vaultProbeScratch;
  }

  private triggerLandingSpring(impactVy: number): void {
    const motionScale = this.reducedMotion ? 0.35 : Math.max(0.2, this.cameraShakeScale);
    const mag = Math.min(0.22, Math.max(0.035, impactVy * 0.016)) * motionScale;
    this.landCompressionOffset = Math.max(-0.22, this.landCompressionOffset - mag * 0.45);
    this.landSpringVel = Math.max(-3.4, this.landSpringVel - mag * 14.5);
  }

  private tickLandingSpring(dt: number): void {
    const subSteps = dt > 0.025 ? 2 : 1;
    const subDt = dt / subSteps;
    const stiffness = 360;
    const damping = 27.3;
    for (let s = 0; s < subSteps; s++) {
      const accel = -stiffness * this.landCompressionOffset - damping * this.landSpringVel;
      this.landSpringVel += accel * subDt;
      this.landCompressionOffset += this.landSpringVel * subDt;
    }
    this.landCompressionOffset = THREE.MathUtils.clamp(this.landCompressionOffset, -0.26, 0.06);
    if (Math.abs(this.landCompressionOffset) < 1e-4 && Math.abs(this.landSpringVel) < 1e-4) {
      this.landCompressionOffset = 0;
      this.landSpringVel = 0;
    }
  }

  private cancelVault(collision: CollisionWorld | null): void {
    if (!this.isVaulting) {
      this.canVault = false;
      return;
    }
    this.isVaulting = false;
    this.canVault = false;
    this.vaultObstacleId = null;
    if (collision && !collision.canStandUp(this.position, this.capsuleRadius, this.standingHeight, 'player')) {
      this.isCrouching = true;
    } else {
      this.isCrouching = false;
    }
  }

  /**
   * Attempts to mount a nearby climbable ladder (called by [E] interact or auto-approach).
   */
  tryMountLadder(collision: CollisionWorld): boolean {
    if (!this.alive || this.isClimbingLadder || this.isVaulting || this.ladderCooldownSec > 0) {
      return false;
    }
    const lookX = -Math.sin(this.yaw);
    const lookZ = -Math.cos(this.yaw);
    const candidate = collision.findMountableLadder(
      this.position.x,
      this.position.y,
      this.position.z,
      lookX,
      lookZ,
      1.3
    );
    if (!candidate) return false;
    this.attachToLadder(candidate.ladder, candidate.entrySide);
    return true;
  }

  private attachToLadder(ladder: LadderVolume, entrySide: 'bottom' | 'top'): void {
    this.activeLadder = ladder;
    this.isClimbingLadder = true;
    this.canClimbLadder = false;
    this.isSprinting = false;
    this.isSliding = false;
    this.isCrouching = false;
    this.grounded = false;
    this.airTimeSec = 0;
    this.velocity.set(0, 0, 0);
    this.ladderStepAccum = 0;

    const climbOffset = this.capsuleRadius + 0.1;
    this.position.x = ladder.x + ladder.normalX * climbOffset;
    this.position.z = ladder.z + ladder.normalZ * climbOffset;
    if (entrySide === 'top') {
      this.position.y = Math.max(ladder.bottomY, ladder.topY - 0.65);
    } else {
      this.position.y = THREE.MathUtils.clamp(this.position.y, ladder.bottomY, ladder.topY - 0.35);
    }
    this.audio.play2D('footstep', 2, 0.3);
  }

  dismountLadder(jumpOff: boolean): void {
    if (!this.isClimbingLadder) return;
    const lad = this.activeLadder;
    this.isClimbingLadder = false;
    this.activeLadder = null;
    this.ladderCooldownSec = 0.38;
    if (jumpOff && lad) {
      this.velocity.set(lad.normalX * 3.8, 4.8, lad.normalZ * 3.8);
      this.grounded = false;
    }
  }

  private stepLadderClimb(
    dt: number,
    input: InputManager,
    collision: CollisionWorld,
    forwardAxis: number
  ): void {
    const lad = this.activeLadder;
    if (!lad) {
      this.isClimbingLadder = false;
      return;
    }

    // Jump dismount pushes cleanly outward from ladder face
    if (input.wasActionPressed('jump')) {
      this.dismountLadder(true);
      return;
    }
    // Crouch lets go cleanly
    if (input.wasActionPressed('crouch')) {
      this.dismountLadder(false);
      this.velocity.set(lad.normalX * 0.8, 0, lad.normalZ * 0.8);
      return;
    }

    // Looking steeply down inverts W to descend naturally; otherwise W=up, S=down
    const lookDirSign = this.pitch < -0.58 ? -1 : 1;
    const climbInput = Math.abs(forwardAxis) > 0.08 ? forwardAxis * lookDirSign : 0;
    const climbSpeed = 3.85;
    const vy = climbInput * climbSpeed;

    // Keep player horizontally aligned to ladder climb rail
    const climbOffset = this.capsuleRadius + 0.1;
    const targetX = lad.x + lad.normalX * climbOffset;
    const targetZ = lad.z + lad.normalZ * climbOffset;
    this.position.x = THREE.MathUtils.lerp(this.position.x, targetX, Math.min(1, dt * 16));
    this.position.z = THREE.MathUtils.lerp(this.position.z, targetZ, Math.min(1, dt * 16));
    this.position.y += vy * dt;
    this.velocity.set(0, vy, 0);
    this.currentSpeed = Math.abs(vy);
    this.grounded = false;
    this.crouchBlend = THREE.MathUtils.lerp(this.crouchBlend, 0, Math.min(1, dt * 10));
    this.accelState = Math.abs(vy) > 0.1 ? 'CRUISE' : 'IDLE';

    if (Math.abs(vy) > 0.25) {
      this.ladderStepAccum += Math.abs(vy) * dt;
      if (this.ladderStepAccum >= 0.48) {
        this.ladderStepAccum = 0;
        this.audio.play2D('footstep', 2, 0.22);
      }
    }

    // Clean Top Step-Over onto the upper platform/roof deck
    if (this.position.y >= lad.topY - 0.14 && climbInput > 0) {
      this.position.set(lad.topExitX, lad.topExitY + 0.02, lad.topExitZ);
      this.velocity.set(-lad.normalX * 2.4, 0, -lad.normalZ * 2.4);
      const res = collision.resolvePlayerCapsule(
        this.position,
        this.velocity,
        this.capsuleRadius,
        this.standingHeight,
        this.stepHeight,
        1 / 60,
        'player',
        PHYSICS_MASKS.CHARACTER_SOLID,
        this._moveResultScratch,
        AGENT_TRAVERSAL_PROFILES.player.maxSlopeDeg
      );
      this.lastMoveResult = res;
      this.grounded = true;
      this.isClimbingLadder = false;
      this.activeLadder = null;
      this.ladderCooldownSec = 0.4;
      this.audio.play2D('footstep', 2, 0.34);
      return;
    }

    // Safe Bottom Exit onto ground
    if (this.position.y <= lad.bottomY + 0.06 && climbInput < 0) {
      this.position.set(lad.bottomExitX, lad.bottomExitY, lad.bottomExitZ);
      this.velocity.set(lad.normalX * 1.4, 0, lad.normalZ * 1.4);
      const res = collision.resolvePlayerCapsule(
        this.position,
        this.velocity,
        this.capsuleRadius,
        this.standingHeight,
        this.stepHeight,
        1 / 60,
        'player',
        PHYSICS_MASKS.CHARACTER_SOLID,
        this._moveResultScratch,
        AGENT_TRAVERSAL_PROFILES.player.maxSlopeDeg
      );
      this.lastMoveResult = res;
      this.grounded = res.grounded;
      this.isClimbingLadder = false;
      this.activeLadder = null;
      this.ladderCooldownSec = 0.38;
      this.audio.play2D('footstep', 2, 0.3);
      return;
    }

    // Clamp Y safely within ladder span while holding steady
    this.position.y = THREE.MathUtils.clamp(this.position.y, lad.bottomY, lad.topY);
  }

  private startVault(probe: VaultProbeResult, dirX: number, dirZ: number): void {
    this.isVaulting = true;
    this.canVault = false;
    this.isSprinting = false;
    this.isSliding = false;
    this.isCrouching = true;
    this.grounded = false;
    this.airTimeSec = 0;
    this.vaultMode = probe.mode;
    this.vaultObstacleId = probe.obstacleId;
    this.vaultElapsed = 0;

    const dirLen = Math.hypot(dirX, dirZ) || 1;
    this.vaultDirX = dirX / dirLen;
    this.vaultDirZ = dirZ / dirLen;

    this.vaultStartX = this.position.x;
    this.vaultStartY = this.position.y;
    this.vaultStartZ = this.position.z;

    const holdAdvance = Math.max(0, probe.entryDistance - (this.capsuleRadius + 0.03));
    this.vaultHoldX = this.vaultStartX + this.vaultDirX * holdAdvance;
    this.vaultHoldZ = this.vaultStartZ + this.vaultDirZ * holdAdvance;
    this.vaultApexY = probe.obstacleTopY + 0.08;
    this.vaultLandX = probe.landX;
    this.vaultLandY = probe.landY;
    this.vaultLandZ = probe.landZ;
    this.vaultLandCrouched = probe.landCrouched;
    if (probe.mode === 'vault_over') {
      const targetClearDist =
        Math.hypot(probe.exitX - this.vaultHoldX, probe.exitZ - this.vaultHoldZ) +
        this.capsuleRadius +
        0.04;
      const totalDist = Math.hypot(this.vaultLandX - this.vaultHoldX, this.vaultLandZ - this.vaultHoldZ);
      const ratio =
        totalDist > 1e-4 ? Math.min(0.9, Math.max(0.65, targetClearDist / totalDist)) : 0.78;
      this.vaultClearX = THREE.MathUtils.lerp(this.vaultHoldX, this.vaultLandX, ratio);
      this.vaultClearZ = THREE.MathUtils.lerp(this.vaultHoldZ, this.vaultLandZ, ratio);
    } else {
      this.vaultClearX = this.vaultLandX;
      this.vaultClearZ = this.vaultLandZ;
    }

    const horizSpan = Math.hypot(this.vaultLandX - this.vaultStartX, this.vaultLandZ - this.vaultStartZ);
    this.vaultDuration = THREE.MathUtils.clamp(0.28 + horizSpan * 0.055, 0.34, 0.46);
    this.accelState = 'VAULTING';
    this.audio.play2D('footstep', 2, 0.35);
  }

  private smoothstep01(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  private stepVault(
    dt: number,
    collision: CollisionWorld,
    forwardAxis: number,
    weaponMobilityFactor: number
  ): void {
    const p1 = 0.34;
    const p2 = this.vaultMode === 'mantle_on' ? 0.88 : 0.74;

    const curProgress = this.vaultElapsed / this.vaultDuration;
    if (curProgress < p1 && forwardAxis < -0.55) {
      this.cancelVault(collision);
      this.velocity.set(-this.vaultDirX * 1.2, Math.min(0, this.velocity.y), -this.vaultDirZ * 1.2);
      return;
    }

    const nextElapsed = this.vaultElapsed + dt;
    const nextProgress = Math.min(1, nextElapsed / this.vaultDuration);

    let tx = this.vaultLandX;
    let ty = this.vaultLandY;
    let tz = this.vaultLandZ;

    if (nextProgress <= p1) {
      const u = this.smoothstep01(nextProgress / p1);
      tx = THREE.MathUtils.lerp(this.vaultStartX, this.vaultHoldX, u);
      tz = THREE.MathUtils.lerp(this.vaultStartZ, this.vaultHoldZ, u);
      ty = THREE.MathUtils.lerp(this.vaultStartY, this.vaultApexY, u);
    } else if (nextProgress <= p2) {
      const u = this.smoothstep01((nextProgress - p1) / (p2 - p1));
      tx = THREE.MathUtils.lerp(this.vaultHoldX, this.vaultClearX, u);
      tz = THREE.MathUtils.lerp(this.vaultHoldZ, this.vaultClearZ, u);
      ty = this.vaultApexY;
    } else {
      const u = this.smoothstep01((nextProgress - p2) / Math.max(1e-4, 1 - p2));
      tx = THREE.MathUtils.lerp(this.vaultClearX, this.vaultLandX, u);
      tz = THREE.MathUtils.lerp(this.vaultClearZ, this.vaultLandZ, u);
      ty = THREE.MathUtils.lerp(this.vaultApexY, this.vaultLandY, u);
    }

    const safeDt = Math.max(1e-5, dt);
    this.velocity.set(
      (tx - this.position.x) / safeDt,
      (ty - this.position.y) / safeDt,
      (tz - this.position.z) / safeDt
    );

    const res = collision.resolvePlayerCapsule(
      this.position,
      this.velocity,
      this.capsuleRadius,
      VAULT_CAPSULE_HEIGHT,
      0,
      safeDt,
      'player',
      PHYSICS_MASKS.CHARACTER_SOLID,
      this._moveResultScratch,
      AGENT_TRAVERSAL_PROFILES.player.maxSlopeDeg
    );
    this.lastMoveResult = res;
    this.grounded = res.grounded;
    this.currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.crouchBlend = THREE.MathUtils.lerp(this.crouchBlend, 1, Math.min(1, dt * 16));

    const arcSin = Math.sin(nextProgress * Math.PI);
    this.vaultPitchOffset = -0.055 * arcSin;
    this.vaultRollOffset = 0.028 * arcSin;

    // Abort safely if blocked by ceiling or an unexpected horizontal obstacle/wall
    if (res.hitCeiling) {
      this.velocity.y = Math.min(0, this.velocity.y);
      this.cancelVault(collision);
      return;
    }
    if (res.hitWall) {
      const hitOtherBlocker = res.lastBlockerId !== null && res.lastBlockerId !== this.vaultObstacleId;
      if (hitOtherBlocker || nextProgress > p1) {
        this.velocity.x *= 0.25;
        this.velocity.z *= 0.25;
        this.velocity.y = Math.min(0, this.velocity.y);
        this.cancelVault(collision);
        return;
      }
    }

    this.vaultElapsed = nextElapsed;
    this.accelState = 'VAULTING';

    if (nextProgress >= 1) {
      const mode = this.vaultMode;
      const landCrouchFlag = this.vaultLandCrouched;
      this.isVaulting = false;
      this.vaultObstacleId = null;

      const mustCrouch =
        landCrouchFlag || !collision.canStandUp(this.position, this.capsuleRadius, this.standingHeight, 'player');
      this.isCrouching = mustCrouch;

      const carrySpeed = forwardAxis > 0.15 ? 4.4 * weaponMobilityFactor : 1.5;
      this.velocity.set(
        this.vaultDirX * carrySpeed,
        this.grounded ? 0 : -0.6,
        this.vaultDirZ * carrySpeed
      );
      this.currentSpeed = carrySpeed;
      this.triggerLandingSpring(mode === 'mantle_on' ? 3.2 : 5.2);
      this.audio.play2D('footstep', 2, 0.36);
    }
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
    this.prevPosition.copy(this.position);
    this.activeHeadBobIntensity = Math.max(
      0,
      Math.min(1.5, Number.isFinite(headBobIntensity) ? headBobIntensity : 1.0)
    );

    this.timeSinceDamage += dt;
    this.spawnProtectionRemainingSec = Math.max(0, this.spawnProtectionRemainingSec - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.5);
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    this.suppressionLevel = Math.max(0, this.suppressionLevel - dt * 0.85);

    // Difficulty-scaled tactical HP regeneration up to hpRegenCap after hpRegenDelaySec out of combat
    if (this.timeSinceDamage >= this.hpRegenDelaySec && this.health < this.hpRegenCap) {
      const beforeRegen = this.health;
      this.health = Math.min(this.hpRegenCap, this.health + this.hpRegenRatePerSec * dt);
      const regenDelta = this.health - beforeRegen;
      this.isRegenerating = regenDelta > 0;
      if (regenDelta > 0) {
        this.onHealthRegenerated?.(regenDelta);
      }
    } else {
      this.isRegenerating = false;
    }

    // Look delta
    this.applyLookInput(input, isAds, dt);

    // Exact analytical damped recoil spring (frame-rate invariant across 60Hz/120Hz/144Hz)
    this.timeSinceLastShot = Math.min(10, this.timeSinceLastShot + dt);
    const [nextPitch, nextPitchVel] = this.stepAnalyticalSpring(
      this.recoilPitchOffset,
      this.recoilPitchVel,
      this.recoilStiffness,
      this.recoilDamping,
      dt
    );
    this.recoilPitchOffset = THREE.MathUtils.clamp(nextPitch, -0.06, 0.34);
    this.recoilPitchVel = nextPitchVel;

    const [nextYaw, nextYawVel] = this.stepAnalyticalSpring(
      this.recoilYawOffset,
      this.recoilYawVel,
      this.recoilStiffness * 1.12,
      this.recoilDamping * 1.15,
      dt
    );
    this.recoilYawOffset = THREE.MathUtils.clamp(nextYaw, -0.24, 0.24);
    this.recoilYawVel = nextYawVel;

    const kickDecay = Math.exp(-16 * dt);
    this.cameraRollKick *= kickDecay;
    if (Math.abs(this.cameraRollKick) < 1e-4) this.cameraRollKick = 0;
    this.cameraFovKick *= Math.exp(-18 * dt);
    if (Math.abs(this.cameraFovKick) < 1e-3) this.cameraFovKick = 0;

    this.tickLandingSpring(dt);

    if (!this.isVaulting) {
      this.vaultPitchOffset = THREE.MathUtils.lerp(this.vaultPitchOffset, 0, Math.min(1, dt * 14));
      this.vaultRollOffset = THREE.MathUtils.lerp(this.vaultRollOffset, 0, Math.min(1, dt * 14));
    }

    this.ladderCooldownSec = Math.max(0, this.ladderCooldownSec - dt);

    if (inVehicle) {
      if (this.isVaulting) {
        this.cancelVault(collision);
      }
      if (this.isClimbingLadder) {
        this.dismountLadder(false);
      }
      this.canVault = false;
      this.canClimbLadder = false;
      this.currentSpeed = 0;
      return;
    }

    const axes = input.getMoveAxes();
    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.isClimbingLadder) {
      this.canVault = false;
      this.canClimbLadder = false;
      this.stepLadderClimb(dt, input, collision, axes.forward);
      return;
    }

    if (this.isVaulting) {
      this.stepVault(dt, collision, axes.forward, weaponMobilityFactor);
      return;
    }

    // Check nearby climbable ladders (supports auto-mount on forward push into bottom face, or [E] prompt)
    const ladderCandidate =
      this.ladderCooldownSec <= 0
        ? collision.findMountableLadder(
            this.position.x,
            this.position.y,
            this.position.z,
            this._fwd.x,
            this._fwd.z,
            1.25
          )
        : null;
    this.canClimbLadder = ladderCandidate !== null;
    if (
      ladderCandidate &&
      ladderCandidate.entrySide === 'bottom' &&
      ladderCandidate.distance < 0.45 &&
      axes.forward > 0.35 &&
      !this.isSliding
    ) {
      this.attachToLadder(ladderCandidate.ladder, 'bottom');
      return;
    }

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
        if (collision.canStandUp(this.position, this.capsuleRadius, this.standingHeight, 'player')) {
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
        if (!collision.canStandUp(this.position, this.capsuleRadius, this.standingHeight, 'player')) {
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
      if (collision.canStandUp(this.position, this.capsuleRadius, this.standingHeight, 'player')) {
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

    // Authoritative low-cover vault probe (aligned with forward facing/approach)
    const wishMagHoriz = Math.hypot(this._wish.x, this._wish.z);
    const probeDirX = wishMagHoriz > 0.15 ? this._wish.x / wishMagHoriz : this._fwd.x;
    const probeDirZ = wishMagHoriz > 0.15 ? this._wish.z / wishMagHoriz : this._fwd.z;
    const facingDot = probeDirX * this._fwd.x + probeDirZ * this._fwd.z;
    const forwardVel = this.velocity.x * this._fwd.x + this.velocity.z * this._fwd.z;
    const hasForwardApproach =
      (axes.forward > 0.15 && facingDot >= 0.45) || (forwardVel > 0.8 && facingDot >= 0.45);

    const jumpPressed = input.wasActionPressed('jump');
    const onActiveSlope = Boolean(this.lastMoveResult?.activeSlopeId);
    const eligibleToVault =
      !this.isSliding &&
      !onActiveSlope &&
      (this.grounded || this.velocity.y > -5.5) &&
      facingDot >= 0.45;

    if (!eligibleToVault) {
      this.canVault = false;
      this.vaultProbeCooldownSec = 0;
    } else if (jumpPressed && hasForwardApproach) {
      this.vaultProbeCooldownSec = 0.08;
      this.canVault = collision.probeVaultObstacle(
        this.position,
        probeDirX,
        probeDirZ,
        this.capsuleRadius,
        this.standingHeight,
        this._vaultProbeScratch
      );
    } else {
      this.vaultProbeCooldownSec -= dt;
      if (this.vaultProbeCooldownSec <= 0) {
        this.vaultProbeCooldownSec = 0.1;
        this.canVault = collision.probeVaultObstacle(
          this.position,
          probeDirX,
          probeDirZ,
          this.capsuleRadius,
          this.standingHeight,
          this._vaultProbeScratch
        );
      }
    }

    // Trigger contextual low-cover vault when approaching obstacle and pressing Jump
    if (jumpPressed) {
      if (this.canVault && hasForwardApproach && this._vaultProbeScratch.canVault) {
        this.startVault(this._vaultProbeScratch, probeDirX, probeDirZ);
        return;
      }
      if (this.grounded) {
        if (collision.canStandUp(this.position, this.capsuleRadius, this.standingHeight + 0.05, 'player')) {
          this.velocity.y = 7.4;
          this.lastJumpImpulse = 7.4;
          this.grounded = false;
          this.isCrouching = false;
          this.isSliding = false;
        }
      }
    }

    const hasWish = this._wish.lengthSq() > 0.0001;
    const accel = this.grounded ? (hasWish ? 28 : 20) : 6;
    const prevHoriz = Math.hypot(this.velocity.x, this.velocity.z);
    const targetVx = this._wish.x * targetSpeed;
    const targetVz = this._wish.z * targetSpeed;
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVx, Math.min(1, dt * accel));
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVz, Math.min(1, dt * accel));

    const wasGrounded = this.grounded;
    const preStepVy = this.velocity.y;

    // Gravity
    this.velocity.y -= 21.5 * dt;

    const preStepY = this.position.y;
    const capsuleHeight = this.isSliding
      ? 0.95
      : this.isCrouching
        ? this.crouchedHeight
        : this.standingHeight;
    const res = collision.resolvePlayerCapsule(
      this.position,
      this.velocity,
      this.capsuleRadius,
      capsuleHeight,
      this.stepHeight,
      dt,
      'player',
      undefined,
      this._moveResultScratch,
      AGENT_TRAVERSAL_PROFILES.player.maxSlopeDeg
    );
    this.grounded = res.grounded;
    this.lastMoveResult = res;

    // Smooth single-frame vertical stair/curb step-up snaps visually without altering physics height
    if (res.steppedUp) {
      const stepDy = this.position.y - preStepY;
      if (stepDy > 0.015 && stepDy <= this.stepHeight + 0.08) {
        this.eyeStepOffset = THREE.MathUtils.clamp(this.eyeStepOffset - stepDy, -0.52, 0.15);
      }
    }

    if (!wasGrounded && this.grounded) {
      const impactVy = Math.abs(preStepVy);
      this.lastLandImpulse = Number(impactVy.toFixed(2));
      this.triggerLandingSpring(impactVy);
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
      this.bobTime += dt * (this.isSprinting ? 13 : 8.8);
      this.stepDistAccum += this.currentSpeed * dt;
      if (this.stepDistAccum >= (this.isSprinting ? 2.6 : 2.1)) {
        this.stepDistAccum = 0;
        this.audio.play2D('footstep', 2, 0.25);
      }
    }
  }

  syncCamera(
    camera: THREE.PerspectiveCamera,
    baseFov: number,
    adsFov: number,
    isAds: boolean,
    dt: number,
    alpha = 1
  ): void {
    const safeDt = Math.max(0.001, Math.min(dt, 0.05));
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    const targetEye = this.isSliding
      ? this.slideEyeHeight
      : THREE.MathUtils.lerp(this.standingEyeHeight, this.crouchEyeHeight, this.crouchBlend);
    const bobMotionScale = this.activeHeadBobIntensity * (this.reducedMotion ? 0.45 : 1.0);
    const bobOffset =
      this.grounded && !this.isVaulting && this.currentSpeed > 1.2 && !isAds
        ? Math.sin(this.bobTime) * 0.045 * bobMotionScale
        : 0;
    const shake = this.trauma * this.trauma * 0.035;
    let sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;

    // Prevent camera shake from pushing the near-plane into an adjacent wall
    if (this.lastMoveResult?.hitHorizontal) {
      sx = 0;
    }

    this.eyeStepOffset *= Math.exp(-18 * safeDt);
    if (Math.abs(this.eyeStepOffset) < 0.0008) {
      this.eyeStepOffset = 0;
    }

    // Smoothly interpolate translation between fixed simulation ticks for butter-smooth 120/144Hz motion;
    // snap automatically on teleports / vehicle dismounts (>3m delta).
    if (clampedAlpha >= 0.999 || this.prevPosition.distanceToSquared(this.position) > 9.0) {
      this._interpPos.copy(this.position);
    } else {
      this._interpPos.lerpVectors(this.prevPosition, this.position, clampedAlpha);
    }

    camera.position.set(
      this._interpPos.x + sx,
      this._interpPos.y + targetEye + bobOffset + sy + this.landCompressionOffset + this.eyeStepOffset,
      this._interpPos.z
    );

    const slideRoll = this.isSliding ? -0.05 * (this.reducedMotion ? 0.4 : 1.0) : 0;
    const rollOffset = slideRoll + this.vaultRollOffset + this.cameraRollKick;
    this._camEuler.set(
      Math.max(-1.45, Math.min(1.45, this.pitch + this.recoilPitchOffset + this.vaultPitchOffset)),
      this.yaw + this.recoilYawOffset,
      rollOffset,
      'YXZ'
    );
    camera.quaternion.setFromEuler(this._camEuler);

    const baseTargetFov = isAds
      ? adsFov
      : this.isVaulting
        ? Math.min(106, baseFov + 3)
        : this.isSprinting
          ? Math.min(106, baseFov + 5)
          : baseFov;
    const targetFov = Math.min(108, baseTargetFov + this.cameraFovKick);
    const fovBlend = 1 - Math.exp(-14 * safeDt);
    const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, fovBlend);
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
      stance: this.isVaulting
        ? 'vaulting'
        : this.isSliding
          ? 'sliding'
          : this.isCrouching
            ? 'crouching'
            : 'standing',
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
    const stanceH = this.isVaulting
      ? VAULT_CAPSULE_HEIGHT
      : this.isSliding
        ? 0.95
        : this.isCrouching
          ? this.crouchedHeight
          : this.standingHeight;
    const physicalState = this.isClimbingLadder
      ? 'CLIMBING'
      : this.isVaulting
        ? 'VAULTING'
        : !this.grounded
          ? 'AIRBORNE'
          : this.isSliding
            ? 'SLIDING'
            : this.isCrouching
              ? 'CROUCHED'
              : 'GROUNDED';

    const nx = this.lastMoveResult?.hitWall
      ? this.lastMoveResult.wallNormalX
      : (this.lastMoveResult?.groundNormalX ?? 0);
    const ny = this.lastMoveResult?.hitWall
      ? this.lastMoveResult.wallNormalY
      : (this.lastMoveResult?.groundNormalY ?? 1);
    const nz = this.lastMoveResult?.hitWall
      ? this.lastMoveResult.wallNormalZ
      : (this.lastMoveResult?.groundNormalZ ?? 0);

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
      ay: this.isClimbingLadder ? 0 : -21.5,
      az: 0,
      speed: Number(this.currentSpeed.toFixed(2)),
      massKg: 85,
      layer: COLLISION_LAYER.PLAYER,
      layerLabel: formatCollisionLayer(COLLISION_LAYER.PLAYER),
      mask: PHYSICS_MASKS.CHARACTER_SOLID,
      maskLabel: formatCollisionLayer(PHYSICS_MASKS.CHARACTER_SOLID),
      physicalState,
      lastCollisionId: this.lastMoveResult?.lastBlockerId ?? this.activeLadder?.id ?? null,
      lastNormalX: Number(nx.toFixed(2)),
      lastNormalY: Number(ny.toFixed(2)),
      lastNormalZ: Number(nz.toFixed(2)),
      contactCount: this.lastMoveResult?.activeContacts ?? (this.grounded ? 1 : 0),
    };
  }
}
