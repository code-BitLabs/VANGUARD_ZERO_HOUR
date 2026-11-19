import * as THREE from 'three';
import { AudioManager } from '@/src/audio/AudioManager';
import { WEAPON_BY_ID, WEAPON_CATALOG } from '@/src/data/weapons';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { LockOnState } from '@/src/schemas/events.schema';
import { MissionConfig, ObjectiveActionMetadata, ObjectiveType } from '@/src/schemas/mission.schema';
import { FireMode, WeaponConfig, WeaponId } from '@/src/schemas/weapon.schema';
import { progressionStore } from '@/src/stores/progressionStore';
import {
  isWeaponRelevantForCheckpointAmmoFloor,
  MissionCheckpointSnapshot,
  WeaponAmmoRecord,
} from './MissionCheckpoint';
import { PlayerController } from './PlayerController';
import { HomingTarget, ProjectileManager } from './ProjectileManager';
import {
  buildWeaponViewModel,
  createViewModelMaterialBank,
  disposeViewModelMaterialBank,
  ViewModelMaterialBank,
  ViewModelRig,
} from './WeaponViewModels';
import { FirstPersonAnimationGraph } from './FirstPersonAnimationGraph';

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
  private readonly animGraph = new FirstPersonAnimationGraph();

  private fireCooldown = 0;
  private burstRemaining = 0;
  private reloadTimer = 0;
  public isReloading = false;
  private equipTimer = 0;
  private sprintToFireTimer = 0;
  private wasSprinting = false;
  private muzzleFlashTimer = 0;
  private recoilKickZ = 0;
  private recoilKickPitch = 0;
  private recoilKickRoll = 0;
  private recoilRollSign = 1;
  private shotAnimAge = 99;
  private swayX = 0;
  private swayY = 0;
  private curPosZ = -0.44;
  private adsBlend = 0;
  private sprintBlend = 0;
  private slideBlend = 0;
  private vaultBlend = 0;
  private reloadBlend = 0;
  private equipDropOffset = 0;
  private strafeRoll = 0;
  private animTime = 0;
  private stridePhase = 0;
  private drumAngle = 0;
  private drumTargetAngle = 0;
  private lastReloadStage: 'READY' | 'MAG_OUT' | 'MAG_IN' | 'CHAMBER' = 'READY';
  private postShotCycleSoundPlayed = true;
  private viewModelMuzzleLight: THREE.PointLight;

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
    this.viewModelMuzzleLight = new THREE.PointLight(0xffb347, 0, 2.8, 2);
    this.viewModelContainer.add(this.viewModelMuzzleLight);
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
    this.lastReloadStage = 'READY';
    this.postShotCycleSoundPlayed = true;
    this.audio.cancelReloadFoley();
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

  /**
   * Authoritative weapon-specific resupply with separate ballistic vs explosive ordnance caps.
   * Never exceeds each weapon's upgraded maxReserve; supports dry-run capacity check.
   */
  resupplyWeapons(opts: {
    ballisticReserveFraction: number;
    explosiveRoundsPerLauncher: number;
    onlyCheckCapacity?: boolean;
  }): {
    ballisticRoundsAdded: number;
    explosiveRoundsAdded: number;
    weaponsReplenished: number;
    alreadyFull: boolean;
  } {
    let ballisticRoundsAdded = 0;
    let explosiveRoundsAdded = 0;
    let weaponsReplenished = 0;
    const isExplosiveWeapon = (id: WeaponId): boolean =>
      id === 'grenade_launcher' || id === 'rocket_launcher' || id === 'guided_missile';

    for (const state of this.weapons.values()) {
      const capLv = progressionStore.getState().getUpgradeLevel(state.config.id, 'capacity');
      const maxReserve = Math.round(state.config.reserveAmmo * (1 + capLv * 0.12));
      const deficit = Math.max(0, maxReserve - state.reserveAmmo);
      if (deficit <= 0) continue;

      if (isExplosiveWeapon(state.config.id)) {
        const grantPerType =
          state.config.id === 'grenade_launcher'
            ? Math.max(1, opts.explosiveRoundsPerLauncher * 2)
            : Math.max(1, opts.explosiveRoundsPerLauncher);
        const added = Math.min(deficit, grantPerType);
        if (added > 0) {
          if (!opts.onlyCheckCapacity) {
            state.reserveAmmo += added;
          }
          explosiveRoundsAdded += added;
          weaponsReplenished++;
        }
      } else {
        const fractionGrant = Math.ceil(maxReserve * Math.max(0.1, opts.ballisticReserveFraction));
        const minGrant = Math.max(state.magSize, fractionGrant);
        const added = Math.min(deficit, minGrant);
        if (added > 0) {
          if (!opts.onlyCheckCapacity) {
            state.reserveAmmo += added;
          }
          ballisticRoundsAdded += added;
          weaponsReplenished++;
        }
      }
    }

    return {
      ballisticRoundsAdded,
      explosiveRoundsAdded,
      weaponsReplenished,
      alreadyFull: ballisticRoundsAdded === 0 && explosiveRoundsAdded === 0,
    };
  }

  getActiveWeaponId(): WeaponId {
    return this.activeWeaponId;
  }

  hasAnyHeavyOrdnanceAmmo(): boolean {
    const heavyIds: WeaponId[] = ['rocket_launcher', 'guided_missile', 'grenade_launcher'];
    for (const id of heavyIds) {
      const st = this.weapons.get(id);
      if (st && st.ammoInMag + st.reserveAmmo > 0) {
        return true;
      }
    }
    return false;
  }

  captureAmmoSnapshot(): {
    activeWeaponId: WeaponId;
    weaponAmmoState: Partial<Record<WeaponId, WeaponAmmoRecord>>;
  } {
    const weaponAmmoState: Partial<Record<WeaponId, WeaponAmmoRecord>> = {};
    for (const [id, st] of this.weapons.entries()) {
      weaponAmmoState[id] = {
        mag: st.ammoInMag,
        reserve: st.reserveAmmo,
      };
    }
    return {
      activeWeaponId: this.activeWeaponId,
      weaponAmmoState,
    };
  }

  restoreCheckpointLoadout(
    snapshot: MissionCheckpointSnapshot,
    mission: MissionConfig,
    incompleteObjectives: ReadonlyArray<{ type: ObjectiveType; actionMeta?: ObjectiveActionMetadata }>,
    availableWeaponIds?: ReadonlySet<WeaponId>
  ): void {
    this.isReloading = false;
    this.reloadTimer = 0;
    this.lastReloadStage = 'READY';
    this.postShotCycleSoundPlayed = true;
    this.audio.cancelReloadFoley();
    this.burstRemaining = 0;
    this.fireCooldown = 0;
    this.equipTimer = 0;
    this.sprintToFireTimer = 0;
    this.lockProgress = 0;
    this.lockStatus = 'none';
    this.lockTarget = null;

    for (const [id, st] of this.weapons.entries()) {
      if (availableWeaponIds && !availableWeaponIds.has(id)) {
        // Locked/unavailable weapons are never granted or modified
        continue;
      }
      const capLv = progressionStore.getState().getUpgradeLevel(id, 'capacity');
      const maxReserve = Math.round(st.config.reserveAmmo * (1 + capLv * 0.12));
      const saved = snapshot.weaponAmmoState[id];

      let mag = saved ? Math.min(st.magSize, Math.max(0, Math.round(saved.mag))) : st.magSize;
      let reserve = saved ? Math.min(maxReserve, Math.max(0, Math.round(saved.reserve))) : maxReserve;

      if (
        isWeaponRelevantForCheckpointAmmoFloor(
          id,
          mission,
          incompleteObjectives,
          snapshot.activeWeaponId
        )
      ) {
        mag = st.magSize;
        const minReserve =
          id === 'rocket_launcher' || id === 'guided_missile'
            ? Math.min(maxReserve, 3)
            : Math.min(maxReserve, Math.ceil(maxReserve * 0.5));
        reserve = Math.max(reserve, minReserve);
      }

      st.ammoInMag = mag;
      st.reserveAmmo = reserve;
    }

    const canSelectSaved =
      this.weapons.has(snapshot.activeWeaponId) &&
      (!availableWeaponIds || availableWeaponIds.has(snapshot.activeWeaponId));
    if (canSelectSaved) {
      this.selectWeapon(snapshot.activeWeaponId, true);
    } else if (!availableWeaponIds || availableWeaponIds.has('assault_rifle')) {
      this.selectWeapon('assault_rifle', true);
    } else if (!availableWeaponIds || availableWeaponIds.has('pistol')) {
      this.selectWeapon('pistol', true);
    }
  }

  private resetRigSubparts(rig: ViewModelRig): void {
    rig.muzzleFlash.visible = false;
    if (rig.slideOrBolt) {
      rig.slideOrBolt.position.z = rig.slideRestZ;
      rig.slideOrBolt.position.x = 0;
      rig.slideOrBolt.rotation.z = 0;
    }
    if (rig.magazine) {
      rig.magazine.position.copy(rig.magazineRestPos);
      rig.magazine.rotation.set(0, 0, 0);
      rig.magazine.visible = true;
    }
    if (rig.secondaryPart) {
      rig.secondaryPart.position.copy(rig.secondaryRestPos);
      rig.secondaryPart.rotation.set(0, 0, 0);
    }
  }

  selectWeapon(id: WeaponId, instant = false): void {
    if (!this.weapons.has(id)) return;
    if (this.activeWeaponId !== 'rocket_launcher' && this.activeWeaponId !== 'guided_missile') {
      this.previousPrimaryWeaponId = this.activeWeaponId;
    }
    const prevRig = this.rigs.get(this.activeWeaponId);
    if (prevRig) {
      prevRig.root.visible = false;
      this.resetRigSubparts(prevRig);
    }

    this.activeWeaponId = id;
    const nextRig = this.rigs.get(id);
    if (nextRig) {
      this.resetRigSubparts(nextRig);
      nextRig.root.visible = true;
      const hip = nextRig.animProfile.hipPos;
      if (instant) {
        this.swayX = hip[0];
        this.swayY = hip[1];
        this.curPosZ = hip[2];
        this.equipDropOffset = 0;
        nextRig.root.position.set(hip[0], hip[1], hip[2]);
        nextRig.root.rotation.set(0, nextRig.animProfile.hipRotY, 0);
      } else {
        this.equipDropOffset = 1;
        this.swayX = hip[0];
        this.swayY = hip[1] - 0.28;
        this.curPosZ = hip[2];
        nextRig.root.position.set(this.swayX, this.swayY, this.curPosZ);
        nextRig.root.rotation.set(-0.42, nextRig.animProfile.hipRotY - 0.14, 0.16);
      }
    }

    if (this.isReloading || this.lastReloadStage !== 'READY') {
      this.audio.cancelReloadFoley();
      this.animGraph.handleInterruption('weapon_switch_cancels_reload', this.lastReloadStage);
    }
    this.isReloading = false;
    this.reloadTimer = 0;
    this.lastReloadStage = 'READY';
    this.postShotCycleSoundPlayed = true;
    this.reloadBlend = 0;
    this.burstRemaining = 0;
    this.recoilKickZ = 0;
    this.recoilKickPitch = 0;
    this.recoilKickRoll = 0;
    this.muzzleFlashTimer = 0;
    this.shotAnimAge = 99;
    this.viewModelMuzzleLight.intensity = 0;
    this.equipTimer = instant ? 0 : WEAPON_BY_ID[id].equipTimeSec;
    if (instant) {
      this.fireCooldown = 0;
    }
    this.adsBlend = 0;
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

  getAnimationGraph(): FirstPersonAnimationGraph {
    return this.animGraph;
  }

  getViewModelRig(id: WeaponId): ViewModelRig | undefined {
    return this.rigs.get(id);
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
        this.updateViewModelTransform(dt, player);
        return;
      }
    }
    for (let i = 1; i <= 9; i++) {
      if (input.wasKeyPressed(`Digit${i}`)) {
        const w = WEAPON_CATALOG.find((x) => x.slot === i);
        if (w && w.id !== this.activeWeaponId) {
          this.selectWeapon(w.id);
          this.updateViewModelTransform(dt, player);
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
      this.updateViewModelTransform(dt, player);
      return;
    }

    if (!player.alive) {
      if (this.isReloading || this.lastReloadStage !== 'READY') {
        this.isReloading = false;
        this.reloadTimer = 0;
        this.lastReloadStage = 'READY';
        this.audio.cancelReloadFoley();
      }
      this.viewModelMuzzleLight.intensity = 0;
      return;
    }

    // Hide viewmodel while driving a vehicle
    this.viewModelContainer.visible = !inVehicle && !this.isScoped;
    if (inVehicle) {
      if (this.isReloading || this.lastReloadStage !== 'READY') {
        this.isReloading = false;
        this.reloadTimer = 0;
        this.lastReloadStage = 'READY';
        this.audio.cancelReloadFoley();
      }
      this.isAds = false;
      this.isScoped = false;
      this.viewModelMuzzleLight.intensity = 0;
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
    this.shotAnimAge = Math.min(10, this.shotAnimAge + dt);
    if (player.isSprinting) {
      this.sprintToFireTimer = cfg.sprintToFireSec;
    } else if (this.wasSprinting && !player.isSprinting) {
      this.sprintToFireTimer = Math.max(0, cfg.sprintToFireSec - dt);
    } else {
      this.sprintToFireTimer = Math.max(0, this.sprintToFireTimer - dt);
    }
    this.wasSprinting = player.isSprinting;
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    const recoilDecayAlpha = 1 - Math.exp(-18 * dt);
    this.recoilKickZ = THREE.MathUtils.lerp(this.recoilKickZ, 0, recoilDecayAlpha);
    this.recoilKickPitch = THREE.MathUtils.lerp(this.recoilKickPitch, 0, 1 - Math.exp(-15 * dt));
    this.recoilKickRoll = THREE.MathUtils.lerp(this.recoilKickRoll, 0, 1 - Math.exp(-15 * dt));

    // Post-shot mechanical bolt / pump cycle Foley synchronized with viewmodel action timing
    if (!this.postShotCycleSoundPlayed && !this.isReloading) {
      if (this.activeWeaponId === 'sniper_rifle' && this.shotAnimAge >= 0.14) {
        this.postShotCycleSoundPlayed = true;
        this.audio.play2D('bolt_cycle', 6, 0.54);
      } else if (this.activeWeaponId === 'shotgun' && this.shotAnimAge >= 0.08) {
        this.postShotCycleSoundPlayed = true;
        this.audio.play2D('pump_cycle', 6, 0.54);
      }
    }

    // Reload trigger & stage-synchronized Foley state machine
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
      this.lastReloadStage = 'MAG_OUT';
      this.audio.playReloadStageFoley(cfg.id, 'MAG_OUT');
    }

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const needed = state.magSize - state.ammoInMag;
        const transfer = Math.min(needed, state.reserveAmmo);
        state.ammoInMag += transfer;
        state.reserveAmmo -= transfer;
        this.isReloading = false;
        this.lastReloadStage = 'READY';
      } else {
        const curStage = this.getReloadStage();
        if (curStage !== this.lastReloadStage && curStage !== 'READY') {
          this.lastReloadStage = curStage;
          this.audio.playReloadStageFoley(cfg.id, curStage);
        }
      }
    }

    // ADS & Sniper Scope (entering ADS immediately cancels sprint in PlayerController; paused while vaulting)
    this.isAds = input.isActionHeld('ads') && !this.isReloading && !player.isVaulting;
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
      !player.isVaulting &&
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
    const rig = this.rigs.get(cfg.id);
    const animProf = rig?.animProfile;
    state.ammoInMag--;
    this.fireCooldown = 60 / cfg.fireRateRpm;
    this.muzzleFlashTimer = 0.055;
    this.shotAnimAge = 0;
    this.postShotCycleSoundPlayed =
      cfg.id !== 'sniper_rifle' && cfg.id !== 'shotgun';
    const adsRecoilMul = this.isAds ? 0.55 : 1.0;
    this.recoilKickZ = Math.min(0.18, this.recoilKickZ + (animProf?.recoilKickZ ?? 0.062) * adsRecoilMul);
    this.recoilKickPitch = Math.min(0.28, this.recoilKickPitch + (animProf?.recoilPitch ?? 0.085) * adsRecoilMul);
    this.recoilRollSign = -this.recoilRollSign;
    this.recoilKickRoll = (animProf?.recoilRoll ?? 0.025) * adsRecoilMul * this.recoilRollSign;
    if (cfg.id === 'grenade_launcher') {
      this.drumTargetAngle += Math.PI / 3;
      this.audio.play2D('drum_index', 5, 0.38);
    }
    this.animGraph.notifyShotFired(adsRecoilMul);
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
        this._rayOrigin.x + this._rayDir.x * 0.42 + this._right.x * (this.isAds ? 0.09 : 0.24),
        this._rayOrigin.y + this._rayDir.y * 0.42 - 0.15,
        this._rayOrigin.z + this._rayDir.z * 0.42 + this._right.z * (this.isAds ? 0.09 : 0.24),
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


  private smooth01(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  private updateViewModelTransform(dt: number, player: PlayerController): void {
    const rig = this.rigs.get(this.activeWeaponId);
    if (!rig) return;

    const prof = rig.animProfile;
    const cfg = this.getActiveState().config;
    this.animTime += dt;
    if (player.grounded && player.currentSpeed > 0.6 && !player.isSliding && !player.isVaulting) {
      this.stridePhase += dt * (player.isSprinting ? 12.8 : 8.4) * Math.min(1.3, Math.max(0.45, player.currentSpeed / 6.2));
    }

    // Muzzle flash mesh & dynamic viewmodel PointLight
    const flashActive = this.muzzleFlashTimer > 0 && !this.isScoped;
    rig.muzzleFlash.visible = flashActive;
    if (flashActive) {
      rig.muzzleFlash.rotation.z += dt * 44;
      const flicker = 0.78 + 0.45 * Math.abs(Math.sin(this.animTime * 95));
      rig.muzzleFlash.scale.set(flicker, flicker * 1.15, flicker);
      const flashAlpha = Math.min(1, this.muzzleFlashTimer / 0.055);
      this.viewModelMuzzleLight.intensity = 6.2 * flashAlpha;
    } else {
      this.viewModelMuzzleLight.intensity = 0;
    }

    // Frame-rate independent damped state blends
    const dampAds = 1 - Math.exp(-prof.adsSpeed * dt);
    const dampPose = 1 - Math.exp(-14 * dt);
    this.adsBlend = THREE.MathUtils.lerp(
      this.adsBlend,
      this.isAds && !this.isReloading && !player.isVaulting ? 1 : 0,
      dampAds
    );
    this.sprintBlend = THREE.MathUtils.lerp(
      this.sprintBlend,
      player.isSprinting && !this.isReloading && !player.isVaulting ? 1 : 0,
      dampPose
    );
    this.slideBlend = THREE.MathUtils.lerp(this.slideBlend, player.isSliding && !player.isVaulting ? 1 : 0, dampPose);
    this.vaultBlend = THREE.MathUtils.lerp(this.vaultBlend, player.isVaulting ? 1 : 0, dampPose);
    this.reloadBlend = THREE.MathUtils.lerp(this.reloadBlend, this.isReloading ? 1 : 0, dampPose);

    const equipTarget = cfg.equipTimeSec > 0 ? Math.min(1, this.equipTimer / cfg.equipTimeSec) : 0;
    this.equipDropOffset = THREE.MathUtils.lerp(this.equipDropOffset, equipTarget, 1 - Math.exp(-20 * dt));

    // Lateral strafe roll (zero allocation: derive right vector from player.yaw)
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    const latSpeed = player.velocity.x * rightX + player.velocity.z * rightZ;
    const targetStrafeRoll = THREE.MathUtils.clamp(-latSpeed * 0.0085 * (1 - this.adsBlend * 0.75), -0.08, 0.08);
    this.strafeRoll = THREE.MathUtils.lerp(this.strafeRoll, targetStrafeRoll, 1 - Math.exp(-12 * dt));

    // Multi-stage reload choreography synced purely to authoritative WeaponSystem reload state
    const reloadStage = this.getReloadStage();
    const reloadProg = this.getReloadProgress();
    let rPosX = 0;
    let rPosY = 0;
    let rPosZ = 0;
    let rRotX = 0;
    let rRotY = 0;
    let rRotZ = 0;
    let boltChamberTravel = 0;

    if (this.isReloading) {
      if (reloadStage === 'MAG_OUT') {
        const u = this.smooth01(reloadProg / 0.35);
        rPosX = -0.045 * u;
        rPosY = -0.035 * u;
        rPosZ = -0.02 * u;
        rRotX = -0.18 * u;
        rRotY = 0.36 * u;
        rRotZ = 0.42 * u;
        if (rig.magazine) {
          rig.magazine.position.set(
            rig.magazineRestPos.x - 0.025 * u,
            rig.magazineRestPos.y - 0.16 * u,
            rig.magazineRestPos.z + 0.015 * u
          );
          rig.magazine.rotation.x = 0.26 * u;
        }
        if (prof.reloadStyle === 'belt_box' && rig.secondaryPart) {
          rig.secondaryPart.rotation.x = -0.68 * u;
        }
        if (prof.reloadStyle === 'rotary_drum' && rig.slideOrBolt) {
          rig.slideOrBolt.position.x = -0.095 * u;
        }
      } else if (reloadStage === 'MAG_IN') {
        const u = this.smooth01((reloadProg - 0.35) / 0.43);
        const invU = 1 - u;
        const lockPulse = u > 0.82 ? Math.sin(((u - 0.82) / 0.18) * Math.PI) : 0;
        rPosX = -0.045 * (0.4 + 0.6 * invU);
        rPosY = -0.035 * (0.35 + 0.65 * invU) + lockPulse * 0.024;
        rPosZ = -0.02 * invU;
        rRotX = -0.18 * (0.3 + 0.7 * invU) + lockPulse * 0.04;
        rRotY = 0.36 * (0.3 + 0.7 * invU);
        rRotZ = 0.42 * (0.4 + 0.6 * invU);
        if (rig.magazine) {
          rig.magazine.position.set(
            rig.magazineRestPos.x - 0.025 * invU,
            rig.magazineRestPos.y - 0.16 * invU,
            rig.magazineRestPos.z + 0.015 * invU
          );
          rig.magazine.rotation.x = 0.26 * invU;
        }
        if (prof.reloadStyle === 'belt_box' && rig.secondaryPart) {
          rig.secondaryPart.rotation.x = -0.68;
        }
        if (prof.reloadStyle === 'rotary_drum' && rig.slideOrBolt) {
          rig.slideOrBolt.position.x = -0.095 * invU;
          this.drumAngle += dt * 7.5;
          this.drumTargetAngle = this.drumAngle;
        }
      } else {
        // CHAMBER stage (0.78..1.0)
        const u = this.smooth01((reloadProg - 0.78) / 0.22);
        const invU = 1 - u;
        const pullBell = Math.sin(u * Math.PI);
        rPosX = -0.02 * invU;
        rPosY = -0.015 * invU + pullBell * 0.014;
        rRotX = -0.06 * invU + pullBell * 0.06;
        rRotY = 0.12 * invU;
        rRotZ = 0.16 * invU + pullBell * 0.08;
        boltChamberTravel = pullBell * 0.068;
        if (rig.magazine) {
          rig.magazine.position.copy(rig.magazineRestPos);
          rig.magazine.rotation.set(0, 0, 0);
        }
        if (prof.reloadStyle === 'belt_box' && rig.secondaryPart) {
          rig.secondaryPart.rotation.x = -0.68 * invU;
        }
        if (prof.reloadStyle === 'rotary_drum' && rig.slideOrBolt) {
          rig.slideOrBolt.position.x = 0;
        }
      }
    } else {
      if (rig.magazine) {
        rig.magazine.position.copy(rig.magazineRestPos);
        rig.magazine.rotation.set(0, 0, 0);
      }
      if (prof.reloadStyle === 'belt_box' && rig.secondaryPart) {
        rig.secondaryPart.rotation.x = THREE.MathUtils.lerp(rig.secondaryPart.rotation.x, 0, dampPose);
      }
      if (prof.reloadStyle === 'rotary_drum' && rig.slideOrBolt) {
        rig.slideOrBolt.position.x = THREE.MathUtils.lerp(rig.slideOrBolt.position.x, 0, dampPose);
      }
    }

    // Bolt / Slide / Pump / Warhead / Rotary Drum actuation
    if (rig.slideOrBolt) {
      if (this.activeWeaponId === 'rocket_launcher') {
        const st = this.weapons.get('rocket_launcher');
        const warheadLoaded = Boolean(
          st && (st.ammoInMag > 0 || (this.isReloading && reloadStage !== 'MAG_OUT'))
        );
        rig.slideOrBolt.visible = warheadLoaded;
        let warheadOffsetZ = this.recoilKickZ * 0.55;
        if (this.isReloading && reloadStage === 'MAG_IN') {
          const insertU = this.smooth01((reloadProg - 0.35) / 0.43);
          warheadOffsetZ = -0.26 * (1 - insertU);
        }
        rig.slideOrBolt.position.z = THREE.MathUtils.lerp(
          rig.slideOrBolt.position.z,
          rig.slideRestZ + warheadOffsetZ,
          1 - Math.exp(-26 * dt)
        );
      } else if (this.activeWeaponId === 'grenade_launcher') {
        this.drumAngle = THREE.MathUtils.lerp(this.drumAngle, this.drumTargetAngle, 1 - Math.exp(-20 * dt));
        rig.slideOrBolt.rotation.z = this.drumAngle;
        rig.slideOrBolt.position.z = THREE.MathUtils.lerp(
          rig.slideOrBolt.position.z,
          rig.slideRestZ + this.recoilKickZ * 0.35,
          1 - Math.exp(-28 * dt)
        );
      } else {
        // Post-shot pump / bolt-action cycling
        let actionCycleZ = 0;
        let actionBoltRoll = 0;
        if (this.activeWeaponId === 'sniper_rifle') {
          if (this.shotAnimAge > 0.14 && this.shotAnimAge < 0.72) {
            const p = (this.shotAnimAge - 0.14) / 0.58;
            const bell = Math.sin(p * Math.PI);
            actionCycleZ = bell * 0.065;
            actionBoltRoll = -0.78 * bell;
          } else if (this.isReloading && reloadStage === 'CHAMBER') {
            actionBoltRoll = -0.78 * Math.sin(((reloadProg - 0.78) / 0.22) * Math.PI);
          }
          rig.slideOrBolt.rotation.z = actionBoltRoll;
        } else if (this.activeWeaponId === 'shotgun') {
          if (this.shotAnimAge > 0.08 && this.shotAnimAge < 0.32) {
            actionCycleZ = Math.sin(((this.shotAnimAge - 0.08) / 0.24) * Math.PI) * 0.075;
          }
        }
        const targetSlideZ = rig.slideRestZ + this.recoilKickZ * 0.55 + boltChamberTravel + actionCycleZ;
        rig.slideOrBolt.position.z = THREE.MathUtils.lerp(
          rig.slideOrBolt.position.z,
          targetSlideZ,
          1 - Math.exp(-28 * dt)
        );
      }
    }

    // Idle breathing + movement figure-8 sway (reduced smoothly during ADS)
    const swayAtten = (1 - this.adsBlend * 0.84) * (1 - this.vaultBlend * 0.65) * prof.swayScale;
    const breathX = Math.cos(this.animTime * 1.45) * 0.0022 * swayAtten;
    const breathY = Math.sin(this.animTime * 2.15) * 0.0028 * swayAtten;
    const isMoving = player.grounded && player.currentSpeed > 0.7 && !player.isSliding && !player.isVaulting;
    const speedNorm = isMoving ? Math.min(1.25, player.currentSpeed / 6.2) : 0;
    const bobX = Math.sin(this.stridePhase) * 0.011 * speedNorm * swayAtten;
    const bobY = Math.abs(Math.cos(this.stridePhase)) * 0.009 * speedNorm * swayAtten;

    // Vault tuck & landing spring suspension weight dip
    const landSpring = player.getLandingSpringOffset();
    const vaultOffX = -0.1 * this.vaultBlend;
    const vaultOffY = -0.14 * this.vaultBlend;
    const vaultOffZ = 0.08 * this.vaultBlend;

    // Sprint low-ready offset & slide tilt
    const sprintOffX = -0.05 * this.sprintBlend;
    const sprintOffY = -0.055 * this.sprintBlend;
    const sprintOffZ = 0.04 * this.sprintBlend;
    const slideOffY = -0.03 * this.slideBlend;

    // Equip raise drop
    const equipDropY = -0.26 * this.equipDropOffset;
    const equipPitch = -0.44 * this.equipDropOffset;
    const equipYaw = -0.16 * this.equipDropOffset;

    const baseX = THREE.MathUtils.lerp(prof.hipPos[0], prof.adsPos[0], this.adsBlend);
    const baseY = THREE.MathUtils.lerp(prof.hipPos[1], prof.adsPos[1], this.adsBlend);
    const baseZ = THREE.MathUtils.lerp(prof.hipPos[2], prof.adsPos[2], this.adsBlend);

    const targetX = baseX + breathX + bobX + rPosX * this.reloadBlend + sprintOffX + vaultOffX;
    const targetY =
      baseY +
      breathY +
      bobY +
      landSpring * 0.16 +
      rPosY * this.reloadBlend +
      sprintOffY +
      slideOffY +
      vaultOffY +
      equipDropY;
    const targetZ =
      baseZ +
      this.recoilKickZ +
      rPosZ * this.reloadBlend +
      sprintOffZ +
      vaultOffZ;

    const posAlpha = 1 - Math.exp(-18 * dt);
    this.swayX = THREE.MathUtils.lerp(this.swayX, targetX, posAlpha);
    this.swayY = THREE.MathUtils.lerp(this.swayY, targetY, posAlpha);
    this.curPosZ = THREE.MathUtils.lerp(this.curPosZ, targetZ, posAlpha);

    rig.root.position.set(this.swayX, this.swayY, this.curPosZ);

    // Rotational hierarchy: recoil pitch + reload cant + sprint ready cant + vault tuck + strafe/slide roll
    const rotX =
      this.recoilKickPitch +
      landSpring * 0.22 +
      rRotX * this.reloadBlend +
      prof.sprintCantX * this.sprintBlend +
      -0.32 * this.vaultBlend +
      equipPitch;
    const rotY =
      THREE.MathUtils.lerp(prof.hipRotY, 0, this.adsBlend) +
      rRotY * this.reloadBlend +
      prof.sprintCantY * this.sprintBlend +
      0.34 * this.vaultBlend +
      equipYaw;
    const rotZ =
      this.recoilKickRoll +
      this.strafeRoll +
      0.16 * this.slideBlend +
      rRotZ * this.reloadBlend +
      prof.sprintCantZ * this.sprintBlend +
      0.22 * this.vaultBlend;

    rig.root.rotation.set(rotX, rotY, rotZ);

    // Evaluate Stage 5B TRN-19 First-Person Animation Graph & 2-Bone Operator Arm IK
    const equipProg =
      cfg.equipTimeSec > 0 ? Math.min(1, Math.max(0, 1 - this.equipTimer / cfg.equipTimeSec)) : 1;
    const graphPose = this.animGraph.evaluate({
      dt,
      weaponId: this.activeWeaponId,
      alive: player.alive,
      inVehicle: false,
      grounded: player.grounded,
      currentSpeed: player.currentSpeed,
      isSprinting: player.isSprinting,
      isCrouching: player.isCrouching,
      isSliding: player.isSliding,
      isVaulting: player.isVaulting,
      isAds: this.isAds,
      isReloading: this.isReloading,
      reloadStage,
      reloadProgress: reloadProg,
      equipProgress01: equipProg,
      landingSpringOffset: 0,
      rightGripLocal: rig.rightGripLocal,
      leftForegripLocal: rig.leftForegripLocal,
      magazineSocketLocal: rig.magazineSocketLocal,
      chargingHandleSocketLocal: rig.chargingHandleSocketLocal,
    });
    const rightPose =
      this.activeWeaponId === 'rocket_launcher' || this.activeWeaponId === 'guided_missile'
        ? 'launcher_shoulder_cradle'
        : 'rifle_grip_trigger';
    rig.operatorArms.solveWeaponHold(
      graphPose.leftHandTargetLocal,
      rig.rightGripLocal,
      graphPose.leftHandPose,
      rightPose,
      graphPose.triggerPull01
    );

    if (flashActive) {
      this.viewModelMuzzleLight.position.set(
        this.swayX + rig.muzzleBasePos.x,
        this.swayY + rig.muzzleBasePos.y,
        this.curPosZ + rig.muzzleBasePos.z
      );
    }
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
