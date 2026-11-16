import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { WEAPON_BY_ID, WEAPON_CATALOG } from '@/src/data/weapons';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { LockOnState } from '@/src/schemas/events.schema';
import { FireMode, WeaponConfig, WeaponId } from '@/src/schemas/weapon.schema';
import { progressionStore } from '@/src/stores/progressionStore';
import { PlayerController } from './PlayerController';
import { HomingTarget, ProjectileManager } from './ProjectileManager';
import {
  buildWeaponViewModel,
  createViewModelMaterialBank,
  disposeViewModelMaterialBank,
  ViewModelMaterialBank,
  ViewModelRig,
} from './WeaponViewModels';

export interface WeaponRuntimeState {
  config: WeaponConfig;
  ammoInMag: number;
  magSize: number;
  reserveAmmo: number;
  fireModeIndex: number;
}

export type EnemyHitboxZone = 'head' | 'upper_torso' | 'lower_body';

export interface HitscanTarget {
  id: string;
  kind: 'enemy' | 'air' | 'vehicle';
  name: string;
  alive: boolean;
  position: THREE.Vector3;
  hitRadius: number;
  headPosition?: THREE.Vector3;
  headRadius?: number;
  lowerBodyPosition?: THREE.Vector3;
  lowerBodyRadius?: number;
  torsoBoxMin?: THREE.Vector3;
  torsoBoxMax?: THREE.Vector3;
  lowerBodyBoxMin?: THREE.Vector3;
  lowerBodyBoxMax?: THREE.Vector3;
  onHit: (
    damage: number,
    isHeadshot: boolean,
    hitPoint: THREE.Vector3,
    hitZone?: EnemyHitboxZone
  ) => void;
}

export class WeaponSystem {
  private weapons = new Map<WeaponId, WeaponRuntimeState>();
  private rigs = new Map<WeaponId, ViewModelRig>();
  private activeWeaponId: WeaponId = 'assault_rifle';
  private previousPrimaryWeaponId: WeaponId = 'assault_rifle';
  private viewModelContainer = new THREE.Group();
  private viewModelMaterialBank: ViewModelMaterialBank;
  private viewModelSceneRef: THREE.Scene;

  private fireCooldown = 0;
  private burstRemaining = 0;
  private reloadTimer = 0;
  public isReloading = false;
  private equipTimer = 0;
  private sprintToFireTimer = 0;
  private wasSprinting = false;
  private muzzleFlashTimer = 0;
  private recoilKickZ = 0;
  private swayX = 0;
  private swayY = 0;

  public isAds = false;
  public isScoped = false;
  public shotsFired = 0;
  public shotsHit = 0;
  public readonly enemyZoneHits: Record<EnemyHitboxZone, number> = {
    head: 0,
    upper_torso: 0,
    lower_body: 0,
  };


  private lockTarget: (HomingTarget & { label: string }) | null = null;
  private lockProgress = 0;
  private lockStatus: LockOnState['status'] = 'none';
  private lockBeepTimer = 0;

  private readonly _rayOrigin = new THREE.Vector3();
  private readonly _rayDir = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _hitPoint = new THREE.Vector3();
  private readonly _muzzleWorld = new THREE.Vector3();
  private readonly _shotDir = new THREE.Vector3();
  private readonly _endPoint = new THREE.Vector3();
  private readonly _worldHit: RayHit = {
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

  constructor(
    viewModelScene: THREE.Scene,
    private readonly audio: AudioManager,
    private readonly vfx: VFXPool,
    private readonly projectiles: ProjectileManager
  ) {
    this.viewModelSceneRef = viewModelScene;
    this.viewModelMaterialBank = createViewModelMaterialBank();
    viewModelScene.add(this.viewModelContainer);
    for (const cfg of WEAPON_CATALOG) {
      const rig = buildWeaponViewModel(cfg.id, this.viewModelMaterialBank);
      rig.root.visible = false;
      this.viewModelContainer.add(rig.root);
      this.rigs.set(cfg.id, rig);
    }
    this.resetLoadout();
  }

  resetLoadout(preferredId: WeaponId = 'assault_rifle'): void {
    this.weapons.clear();
    for (const cfg of WEAPON_CATALOG) {
      const capLv = progressionStore.getState().getUpgradeLevel(cfg.id, 'capacity');
      const magSize = Math.round(cfg.magazineSize * (1 + capLv * 0.1));
      const reserveAmmo = Math.round(cfg.reserveAmmo * (1 + capLv * 0.12));
      this.weapons.set(cfg.id, {
        config: cfg,
        ammoInMag: magSize,
        magSize,
        reserveAmmo,
        fireModeIndex: 0,
      });
    }
    this.isReloading = false;
    this.reloadTimer = 0;
    this.burstRemaining = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.enemyZoneHits.head = 0;
    this.enemyZoneHits.upper_torso = 0;
    this.enemyZoneHits.lower_body = 0;
    this.selectWeapon(preferredId, true);
  }


  resupplyAll(): void {
    for (const state of this.weapons.values()) {
      const capLv = progressionStore.getState().getUpgradeLevel(state.config.id, 'capacity');
      const baseReserve = Math.round(state.config.reserveAmmo * (1 + capLv * 0.12));
      state.reserveAmmo = Math.max(state.reserveAmmo, baseReserve);
    }
  }

  selectWeapon(id: WeaponId, instant = false): void {
    if (!this.weapons.has(id)) return;
    if (this.activeWeaponId !== 'rocket_launcher' && this.activeWeaponId !== 'guided_missile') {
      this.previousPrimaryWeaponId = this.activeWeaponId;
    }
    const prevRig = this.rigs.get(this.activeWeaponId);
    if (prevRig) prevRig.root.visible = false;

    this.activeWeaponId = id;
    const nextRig = this.rigs.get(id);
    if (nextRig) nextRig.root.visible = true;

    this.isReloading = false;
    this.reloadTimer = 0;
    this.burstRemaining = 0;
    this.equipTimer = instant ? 0 : WEAPON_BY_ID[id].equipTimeSec;
    this.lockProgress = 0;
    this.lockStatus = 'none';
    this.lockTarget = null;
  }

  getActiveState(): WeaponRuntimeState {
    return this.weapons.get(this.activeWeaponId)!;
  }

  getWeaponState(id: WeaponId): WeaponRuntimeState | undefined {
    return this.weapons.get(id);
  }

  getPreviousPrimaryWeaponId(): WeaponId {
    return this.previousPrimaryWeaponId;
  }

  getActiveFireMode(): FireMode {
    const st = this.getActiveState();
    return st.config.fireModes[st.fireModeIndex % st.config.fireModes.length];
  }

  getLockOnState(): LockOnState {
    return {
      status: this.lockStatus,
      progress: this.lockProgress,
      targetLabel: this.lockTarget?.label ?? '',
    };
  }

  getReloadProgress(): number {
    if (!this.isReloading) return 0;
    const st = this.getActiveState();
    const reloadLv = progressionStore.getState().getUpgradeLevel(st.config.id, 'reload');
    const total = st.config.reloadTimeSec * Math.max(0.58, 1 - reloadLv * 0.08);
    return Math.min(1, Math.max(0, 1 - this.reloadTimer / total));
  }

  getReloadStage(): 'READY' | 'MAG_OUT' | 'MAG_IN' | 'CHAMBER' {
    if (!this.isReloading) return 'READY';
    const prog = this.getReloadProgress();
    if (prog < 0.35) return 'MAG_OUT';
    if (prog < 0.78) return 'MAG_IN';
    return 'CHAMBER';
  }

  getEquipTimerSec(): number {
    return this.equipTimer;
  }

  update(
    dt: number,
    input: InputManager,
    player: PlayerController,
    camera: THREE.PerspectiveCamera,
    collision: CollisionWorld,
    hitscanTargets: HitscanTarget[],
    lockCandidates: Array<HomingTarget & { label: string }>,
    onDestructibleHit: (colliderId: string, damage: number) => void,
    inVehicle: boolean
  ): void {
    const state = this.getActiveState();
    const cfg = state.config;

    // Weapon slot hotkeys 1..9 or queued virtual slot
    const queuedSlot = input.consumeQueuedWeaponSlot();
    if (queuedSlot !== null && !inVehicle) {
      const w = WEAPON_CATALOG.find((x) => x.slot === queuedSlot);
      if (w && w.id !== this.activeWeaponId) {
        this.selectWeapon(w.id);
        return;
      }
    }
    for (let i = 1; i <= 9; i++) {
      if (input.wasKeyPressed(`Digit${i}`)) {
        const w = WEAPON_CATALOG.find((x) => x.slot === i);
        if (w && w.id !== this.activeWeaponId) {
          this.selectWeapon(w.id);
          return;
        }
      }
    }

    // Mouse wheel or virtual touch weapon cycle
    const wheel = input.consumeWheelDelta();
    if (wheel !== 0 && !inVehicle) {
      const idx = WEAPON_CATALOG.findIndex((w) => w.id === this.activeWeaponId);
      const step = wheel > 0 ? 1 : -1;
      const nextIdx = (idx + step + WEAPON_CATALOG.length) % WEAPON_CATALOG.length;
      this.selectWeapon(WEAPON_CATALOG[nextIdx].id);
      return;
    }

    // Hide viewmodel while driving a vehicle
    this.viewModelContainer.visible = !inVehicle && !this.isScoped;
    if (inVehicle) {
      this.isAds = false;
      this.isScoped = false;
      return;
    }

    // Fire mode cycle [B]
    if (input.wasActionPressed('fireMode') && cfg.fireModes.length > 1) {
      state.fireModeIndex = (state.fireModeIndex + 1) % cfg.fireModes.length;
      this.audio.play2D('ui_click', 3, 0.35);
    }

    // Grenade throw [G]
    if (input.wasActionPressed('grenade') && player.grenades > 0) {
      player.grenades--;
      this._rayOrigin.copy(camera.position);
      camera.getWorldDirection(this._rayDir);
      this._rayDir.y += 0.22;
      this._rayDir.normalize();
      this._muzzleWorld.copy(this._rayOrigin).addScaledVector(this._rayDir, 0.7);
      this.projectiles.spawn({
        kind: 'hand_grenade',
        fromPlayer: true,
        origin: this._muzzleWorld,
        direction: this._rayDir,
        speed: 22,
        damage: 175,
        blastRadius: 7.5,
      });
      this.audio.play2D('reload', 5, 0.45);
    }

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.equipTimer = Math.max(0, this.equipTimer - dt);
    if (player.isSprinting) {
      this.sprintToFireTimer = cfg.sprintToFireSec;
    } else if (this.wasSprinting && !player.isSprinting) {
      this.sprintToFireTimer = Math.max(0, cfg.sprintToFireSec - dt);
    } else {
      this.sprintToFireTimer = Math.max(0, this.sprintToFireTimer - dt);
    }
    this.wasSprinting = player.isSprinting;
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    this.recoilKickZ = THREE.MathUtils.lerp(this.recoilKickZ, 0, Math.min(1, dt * 16));

    // Reload trigger & timer
    if (
      !this.isReloading &&
      this.equipTimer <= 0 &&
      state.ammoInMag < state.magSize &&
      state.reserveAmmo > 0 &&
      (input.wasActionPressed('reload') ||
        (state.ammoInMag === 0 && (input.isActionHeld('fire') || input.wasActionPressed('fire'))))
    ) {
      this.isReloading = true;
      const reloadLv = progressionStore.getState().getUpgradeLevel(cfg.id, 'reload');
      this.reloadTimer = cfg.reloadTimeSec * Math.max(0.58, 1 - reloadLv * 0.08);
      this.burstRemaining = 0;
      this.audio.play2D('reload', 5, 0.55);
    }

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const needed = state.magSize - state.ammoInMag;
        const transfer = Math.min(needed, state.reserveAmmo);
        state.ammoInMag += transfer;
        state.reserveAmmo -= transfer;
        this.isReloading = false;
      }
    }

    // ADS & Sniper Scope (entering ADS immediately cancels sprint in PlayerController)
    this.isAds = input.isActionHeld('ads') && !this.isReloading;
    this.isScoped = this.isAds && cfg.hasOpticalScope;

    // Guided Missile Lock-On State Machine
    this.updateLockOn(dt, cfg, camera, lockCandidates);

    // Firing logic: auto supports continuous hold + immediate sub-frame tap; semi/burst enforce tap trigger
    const mode = this.getActiveFireMode();
    const wantsFire =
      mode === 'auto'
        ? input.isActionHeld('fire') || input.wasActionPressed('fire')
        : mode === 'burst'
          ? input.wasActionPressed('fire') || this.burstRemaining > 0
          : input.wasActionPressed('fire');

    if (
      wantsFire &&
      this.fireCooldown <= 0 &&
      !this.isReloading &&
      this.equipTimer <= 0 &&
      this.sprintToFireTimer <= 0 &&
      state.ammoInMag > 0
    ) {
      if (mode === 'burst' && this.burstRemaining === 0) {
        this.burstRemaining = Math.min(3, state.ammoInMag);
      }
      this.fireShot(state, player, camera, collision, hitscanTargets, onDestructibleHit);
      if (this.burstRemaining > 0) {
        this.burstRemaining--;
      }
    }

    this.updateViewModelTransform(dt, player);
  }

  private updateLockOn(
    dt: number,
    cfg: WeaponConfig,
    camera: THREE.PerspectiveCamera,
    candidates: Array<HomingTarget & { label: string }>
  ): void {
    if (cfg.projectileType !== 'guided_missile') {
      this.lockStatus = 'none';
      this.lockProgress = 0;
      this.lockTarget = null;
      return;
    }

    camera.getWorldDirection(this._rayDir);
    let bestTarget: (HomingTarget & { label: string }) | null = null;
    let bestDot = 0.88; // ~28 deg seeker cone

    for (const c of candidates) {
      if (!c.alive) continue;
      const to = this._hitPoint.subVectors(c.position, camera.position);
      const dist = to.length();
      if (dist > cfg.rangeMeters) continue;
      to.divideScalar(dist);
      const dot = to.dot(this._rayDir);
      if (dot > bestDot) {
        bestDot = dot;
        bestTarget = c;
      }
    }

    if (!bestTarget) {
      this.lockTarget = null;
      this.lockProgress = Math.max(0, this.lockProgress - dt * 2);
      this.lockStatus = 'scanning';
      return;
    }

    if (this.lockTarget && this.lockTarget.id !== bestTarget.id) {
      this.lockProgress = 0;
    }
    this.lockTarget = bestTarget;
    this.lockProgress = Math.min(1, this.lockProgress + dt * 0.95);
    this.lockStatus = this.lockProgress >= 1 ? 'locked' : 'acquiring';

    this.lockBeepTimer -= dt;
    if (this.lockBeepTimer <= 0) {
      this.lockBeepTimer = this.lockStatus === 'locked' ? 0.16 : 0.34;
      this.audio.play2D(this.lockStatus === 'locked' ? 'lock_ready' : 'lock_beep', 4, 0.4);
    }
  }

  private fireShot(
    state: WeaponRuntimeState,
    player: PlayerController,
    camera: THREE.PerspectiveCamera,
    collision: CollisionWorld,
    hitscanTargets: HitscanTarget[],
    onDestructibleHit: (colliderId: string, damage: number) => void
  ): void {
    const cfg = state.config;
    state.ammoInMag--;
    this.fireCooldown = 60 / cfg.fireRateRpm;
    this.muzzleFlashTimer = 0.045;
    this.recoilKickZ = 0.065;
    this.shotsFired++;

    // Armory Upgrade multipliers
    const dmgLv = progressionStore.getState().getUpgradeLevel(cfg.id, 'damage');
    const recoilLv = progressionStore.getState().getUpgradeLevel(cfg.id, 'recoil');
    const effectiveDamage = cfg.damage * (1 + dmgLv * 0.09);
    const recoilScale = Math.max(0.55, 1 - recoilLv * 0.08) * (this.isAds ? 0.65 : 1.0);

    player.addRecoilKick(
      cfg.recoilPitch * recoilScale,
      (Math.random() - 0.5) * 2 * cfg.recoilYaw * recoilScale
    );
    player.emitAcousticEvent(
      cfg.category === 'sniper' || cfg.category === 'launcher' ? 75 : 58,
      performance.now() * 0.001
    );

    this.audio.playWeaponSound(cfg.id);

    camera.getWorldDirection(this._rayDir);
    this._right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this._rayOrigin.copy(camera.position);

    // Muzzle world position for tracers/shells (zero heap allocation)
    const muzzleWorld = this._muzzleWorld
      .copy(this._rayOrigin)
      .addScaledVector(this._rayDir, 0.85)
      .addScaledVector(this._right, this.isAds ? 0 : 0.18)
      .addScaledVector(this._up, -0.14);

    this.vfx.spawnMuzzleLight(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z);
    if (cfg.category !== 'launcher') {
      this.vfx.spawnShellCasing(
        muzzleWorld.x,
        muzzleWorld.y,
        muzzleWorld.z,
        this._right.x,
        this._right.z
      );
    }

    if (cfg.projectileType !== 'hitscan') {
      const homing =
        cfg.projectileType === 'guided_missile' && this.lockStatus === 'locked' && this.lockTarget
          ? this.lockTarget
          : null;
      this.projectiles.spawn({
        kind: cfg.projectileType,
        fromPlayer: true,
        origin: muzzleWorld,
        direction: this._rayDir,
        speed: cfg.muzzleVelocity,
        damage: effectiveDamage,
        blastRadius: cfg.blastRadius,
        homingTarget: homing,
      });
      return;
    }

    // Hitscan pellets (crouching tightens dispersion; running loosens dispersion)
    const stanceSpreadFactor = player.isCrouching ? 0.8 : 1.0;
    const spread =
      (this.isAds ? cfg.spreadAdsRad : cfg.spreadHipRad) *
      (player.currentSpeed > 4 ? 1.35 : 1.0) *
      stanceSpreadFactor;

    for (let p = 0; p < cfg.pelletCount; p++) {
      const sx = (Math.random() - 0.5) * 2 * spread;
      const sy = (Math.random() - 0.5) * 2 * spread;
      const dir = this._shotDir
        .copy(this._rayDir)
        .addScaledVector(this._right, sx)
        .addScaledVector(this._up, sy)
        .normalize();

      const worldHit = collision.sweptSegmentTest(
        this._rayOrigin.x,
        this._rayOrigin.y,
        this._rayOrigin.z,
        dir.x,
        dir.y,
        dir.z,
        cfg.rangeMeters,
        COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER | COLLISION_LAYER.DESTRUCTIBLE,
        this._worldHit
      );

      let bestDist = worldHit ? this._worldHit.distance : cfg.rangeMeters;
      let hitTarget: HitscanTarget | null = null;
      let hitHead = false;
      let hitZone: EnemyHitboxZone = 'upper_torso';

      // Test ray against enemy 3-zone anatomical volumes (head -> upper_torso -> lower_body) & air/vehicle spheres
      for (let i = 0; i < hitscanTargets.length; i++) {
        const t = hitscanTargets[i];
        if (!t.alive) continue;

        if (t.headPosition && t.headRadius) {
          const dHead = this.intersectRaySphere(this._rayOrigin, dir, t.headPosition, t.headRadius, bestDist);
          if (dHead !== null && dHead < bestDist) {
            bestDist = dHead;
            hitTarget = t;
            hitHead = true;
            hitZone = 'head';
            continue;
          }
        }

        let dTorso: number | null = null;
        if (t.torsoBoxMin && t.torsoBoxMax) {
          dTorso = this.intersectRayBox(this._rayOrigin, dir, t.torsoBoxMin, t.torsoBoxMax, bestDist);
        }
        const dBodySphere = this.intersectRaySphere(this._rayOrigin, dir, t.position, t.hitRadius, bestDist);
        if (dBodySphere !== null && (dTorso === null || dBodySphere < dTorso)) {
          dTorso = dBodySphere;
        }
        if (dTorso !== null && dTorso < bestDist) {
          bestDist = dTorso;
          hitTarget = t;
          hitHead = false;
          hitZone = 'upper_torso';
          continue;
        }

        let dLower: number | null = null;
        if (t.lowerBodyBoxMin && t.lowerBodyBoxMax) {
          dLower = this.intersectRayBox(this._rayOrigin, dir, t.lowerBodyBoxMin, t.lowerBodyBoxMax, bestDist);
        }
        if (t.lowerBodyPosition && t.lowerBodyRadius) {
          const dLowerSphere = this.intersectRaySphere(
            this._rayOrigin,
            dir,
            t.lowerBodyPosition,
            t.lowerBodyRadius,
            bestDist
          );
          if (dLowerSphere !== null && (dLower === null || dLowerSphere < dLower)) {
            dLower = dLowerSphere;
          }
        }
        if (dLower !== null && dLower < bestDist) {
          bestDist = dLower;
          hitTarget = t;
          hitHead = false;
          hitZone = 'lower_body';
        }
      }

      const endPoint = this._endPoint.copy(this._rayOrigin).addScaledVector(dir, bestDist);
      if (p === 0 || p % 3 === 0) {
        this.vfx.spawnTracer(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, endPoint.x, endPoint.y, endPoint.z);
      }

      if (hitTarget) {
        this.shotsHit++;
        if (hitTarget.kind === 'enemy') {
          this.enemyZoneHits[hitZone]++;
        }
        const zoneMult = hitHead
          ? cfg.headshotMultiplier
          : hitZone === 'lower_body'
            ? 0.85
            : 1.0;
        const finalDmg = effectiveDamage * zoneMult;
        hitTarget.onHit(finalDmg, hitHead, endPoint, hitZone);
        this.vfx.spawnImpact(endPoint.x, endPoint.y, endPoint.z, hitTarget.kind === 'enemy' ? 'blood' : 'metal');
      } else if (worldHit) {
        if (this._worldHit.collider && (this._worldHit.collider.layer & COLLISION_LAYER.DESTRUCTIBLE) !== 0) {
          this.shotsHit++;
          onDestructibleHit(this._worldHit.collider.id, effectiveDamage);
        }
        this.vfx.spawnImpact(endPoint.x, endPoint.y, endPoint.z, 'concrete');
      }
    }
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
    boxMin: THREE.Vector3,
    boxMax: THREE.Vector3,
    maxDist: number
  ): number | null {
    let tmin = 0;
    let tmax = maxDist;

    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;

    if (Math.abs(dx) < 1e-7) {
      if (ox < boxMin.x || ox > boxMax.x) return null;
    } else {
      const inv = 1 / dx;
      let t1 = (boxMin.x - ox) * inv;
      let t2 = (boxMax.x - ox) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    if (Math.abs(dy) < 1e-7) {
      if (oy < boxMin.y || oy > boxMax.y) return null;
    } else {
      const inv = 1 / dy;
      let t1 = (boxMin.y - oy) * inv;
      let t2 = (boxMax.y - oy) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    if (Math.abs(dz) < 1e-7) {
      if (oz < boxMin.z || oz > boxMax.z) return null;
    } else {
      const inv = 1 / dz;
      let t1 = (boxMin.z - oz) * inv;
      let t2 = (boxMax.z - oz) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    return tmin >= 0 && tmin < maxDist ? tmin : null;
  }


  private updateViewModelTransform(dt: number, player: PlayerController): void {
    const rig = this.rigs.get(this.activeWeaponId);
    if (!rig) return;

    rig.muzzleFlash.visible = this.muzzleFlashTimer > 0;
    if (this.muzzleFlashTimer > 0) {
      rig.muzzleFlash.rotation.z += dt * 40;
    }
    if (rig.slideOrBolt) {
      if (this.activeWeaponId === 'rocket_launcher') {
        const st = this.weapons.get('rocket_launcher');
        rig.slideOrBolt.visible = Boolean(st && st.ammoInMag > 0 && !this.isReloading);
      }
      const targetSlideZ = rig.slideRestZ + this.recoilKickZ * 0.55;
      rig.slideOrBolt.position.z = THREE.MathUtils.lerp(
        rig.slideOrBolt.position.z,
        targetSlideZ,
        Math.min(1, dt * 28)
      );
    }

    const targetX = this.isAds ? 0.0 : 0.24;
    const targetY = this.isReloading ? -0.34 : this.equipTimer > 0 ? -0.28 : this.isAds ? -0.14 : -0.2;
    const targetZ = this.isAds ? -0.32 + this.recoilKickZ : -0.44 + this.recoilKickZ;

    const moveSway = player.currentSpeed > 1 && !this.isAds ? Math.sin(performance.now() * 0.01) * 0.012 : 0;
    this.swayX = THREE.MathUtils.lerp(this.swayX, targetX + moveSway, Math.min(1, dt * 15));
    this.swayY = THREE.MathUtils.lerp(this.swayY, targetY + Math.abs(moveSway) * 0.5, Math.min(1, dt * 15));
    const curZ = THREE.MathUtils.lerp(rig.root.position.z || targetZ, targetZ, Math.min(1, dt * 18));

    rig.root.position.set(this.swayX, this.swayY, curZ);
    rig.root.rotation.x = this.isReloading ? -0.38 : this.recoilKickZ * 1.4;
    rig.root.rotation.y = this.isAds ? 0 : -0.03;
  }

  dispose(): void {
    this.viewModelContainer.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
      }
    });
    disposeViewModelMaterialBank(this.viewModelMaterialBank);
    this.viewModelSceneRef.remove(this.viewModelContainer);
    this.rigs.clear();
    this.weapons.clear();
    this.lockTarget = null;
  }
}
