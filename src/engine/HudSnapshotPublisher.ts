import * as THREE from 'three';
import { isDeveloperModeActiveForSetting } from '@/src/config/devMode';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { CargoLiftManager } from '@/src/gameplay/CargoLiftManager';
import { EnemyManager } from '@/src/gameplay/EnemyManager';
import { ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { TacticalGuidanceSystem } from '@/src/gameplay/TacticalGuidanceSystem';
import { VehicleEntity, VehicleManager } from '@/src/gameplay/VehicleManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { HudSnapshot, MiniMapBlip, ObjectiveStatus } from '@/src/schemas/events.schema';
import { MissionConfig } from '@/src/schemas/mission.schema';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { progressionStore } from '@/src/stores/progressionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { BuiltWorldData } from '@/src/world/MapBuilder';
import { InputManager } from './InputManager';

export interface HudPublishContext {
  readonly player: PlayerController;
  readonly weapons: WeaponSystem;
  readonly enemies: EnemyManager;
  readonly vehicles: VehicleManager;
  readonly airCombat: AirCombatManager;
  readonly explosives: ExplosiveManager;
  readonly destruction: DestructionSystem;
  readonly input: InputManager;
  readonly missionDirector: MissionDirector | null;
  readonly activeMission: MissionConfig | null;
  readonly worldData: BuiltWorldData | null;
  readonly cargoLiftManager?: CargoLiftManager | null;
  readonly sustainmentPrompt?: string | null;
  readonly encounterPhase?: string;
  readonly optionalObjectivesCompleted?: number;
  readonly activeModifiers?: string[];
  readonly camera?: THREE.PerspectiveCamera;
  readonly squadSummary?: HudSnapshot['squad'];
  readonly carriedWeaponIds?: HudSnapshot['carriedWeaponIds'];
  readonly nearSupplySwapStation?: boolean;
  readonly deploymentMode?: 'solo' | 'fireteam';
  readonly soloTraumaKit?: HudSnapshot['soloTraumaKit'];
  readonly activeRadioSubtitle?: HudSnapshot['activeRadioSubtitle'];
  readonly squadOrderTarget?: { x: number; y: number; z: number; label: string } | null;
}

function blipsMatch(prev: readonly MiniMapBlip[], next: readonly MiniMapBlip[]): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id ||
      a.kind !== b.kind ||
      Math.abs(a.x - b.x) > 0.05 ||
      Math.abs(a.z - b.z) > 0.05
    ) {
      return false;
    }
  }
  return true;
}

function objectivesMatch(prev: readonly ObjectiveStatus[], next: readonly ObjectiveStatus[]): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id ||
      a.current !== b.current ||
      a.target !== b.target ||
      a.completed !== b.completed ||
      a.bypassed !== b.bypassed ||
      a.isPrimary !== b.isPrimary ||
      a.status !== b.status ||
      a.blockedReason !== b.blockedReason ||
      a.screenX !== b.screenX ||
      a.screenY !== b.screenY ||
      a.onScreen !== b.onScreen ||
      a.elevationDeltaM !== b.elevationDeltaM
    ) {
      return false;
    }
  }
  return true;
}

/**
 * TRN-02B & Stage 4B: Dedicated zero-allocation HUD snapshot assembler and publisher.
 * Owns contextual interaction prompt resolution, minimap blip aggregation,
 * effective input device resolution for action directives, Three-Tier tactical guidance,
 * and HUD damage-arc decay timing.
 */
export class HudSnapshotPublisher {
  private readonly _blipsScratch: MiniMapBlip[] = [];
  private readonly _blipsPoolA: MiniMapBlip[] = [];
  private readonly _blipsPoolB: MiniMapBlip[] = [];
  private _usePoolA = true;
  private _cachedBlips: MiniMapBlip[] = [];
  private _cachedObjectives: ObjectiveStatus[] = [];
  private readonly _projScratch = new THREE.Vector3();
  private readonly _camFwdScratch = new THREE.Vector3();
  private readonly _toMarkerScratch = new THREE.Vector3();
  private readonly guidance = new TacticalGuidanceSystem();
  private hudDecayAccum = 0;

  reset(): void {
    this._blipsScratch.length = 0;
    this._blipsPoolA.length = 0;
    this._blipsPoolB.length = 0;
    this._usePoolA = true;
    this._cachedBlips = [];
    this._cachedObjectives = [];
    this.hudDecayAccum = 0;
    this.guidance.reset();
  }

  tickDamageArcDecay(dt: number): void {
    this.hudDecayAccum += dt;
    if (this.hudDecayAccum >= 0.08) {
      this.hudDecayAccum = 0;
      gameSessionStore.getState().decayDamageArcs();
    }
  }

  resolveEffectiveDevice(input: InputManager): 'touch' | 'keyboard' {
    const touchOverride = uiStore.getState().touchHudOverride;
    const touchMode = settingsStore.getState().input.touchMode;
    return touchOverride === true || touchMode === 'always_on'
      ? 'touch'
      : touchOverride === false || touchMode === 'always_off'
        ? 'keyboard'
        : input.getLastInputDevice();
  }

  resolveInteractPrompt(
    player: PlayerController,
    activeVehicle: VehicleEntity | null,
    nearestVehicle: VehicleEntity | null,
    worldData: BuiltWorldData | null,
    destruction: DestructionSystem,
    liftPrompt: string | null = null,
    sustainmentPrompt?: string | null
  ): string | null {
    if (activeVehicle) {
      if (sustainmentPrompt) {
        return sustainmentPrompt;
      }
      return `[E] Exit ${activeVehicle.displayName}`;
    }
    if (sustainmentPrompt) {
      return sustainmentPrompt;
    }
    if (nearestVehicle) {
      return `[E] Drive ${nearestVehicle.displayName}`;
    }
    if (worldData) {
      if (sustainmentPrompt === undefined) {
        for (let i = 0; i < worldData.supplyCrates.length; i++) {
          const c = worldData.supplyCrates[i];
          if (!c.used && c.position.distanceTo(player.position) < 3.4) {
            return '[E] Resupply Ammo & Armor';
          }
        }
      }
      const destructibles = destruction.getAll();
      for (let i = 0; i < destructibles.length; i++) {
        const d = destructibles[i];
        if (
          d.state !== 'DESTROYED' &&
          d.isObjectiveTarget &&
          d.position.distanceTo(player.position) < 4.2
        ) {
          return d.kind === 'weapons_cache'
            ? '[E] Plant Demolition Charge'
            : '[E] Sabotage Target';
        }
      }
    }
    if (liftPrompt) {
      return liftPrompt;
    }
    if (player.isClimbingLadder) {
      return '[E] Dismount Ladder';
    }
    if (player.canClimbLadder) {
      return '[E] Climb Ladder';
    }
    return null;
  }

  private projectObjectiveStatuses(
    objStatuses: ReturnType<MissionDirector['getObjectiveStatuses']>,
    playerPos: THREE.Vector3,
    camera?: THREE.PerspectiveCamera
  ): void {
    if (!camera) return;
    camera.getWorldDirection(this._camFwdScratch);

    for (let i = 0; i < objStatuses.length; i++) {
      const o = objStatuses[i];
      if (!o.markerPos || o.completed) continue;
      o.elevationDeltaM = Math.round(o.markerPos.y - playerPos.y);

      this._projScratch.set(o.markerPos.x, o.markerPos.y + 1.2, o.markerPos.z);
      this._toMarkerScratch.subVectors(this._projScratch, camera.position);
      const inFront = this._toMarkerScratch.dot(this._camFwdScratch) > 0.05;

      this._projScratch.project(camera);
      let nx = (this._projScratch.x + 1) * 0.5;
      let ny = (1 - this._projScratch.y) * 0.5;

      if (!inFront) {
        nx = 1 - nx;
        ny = 1 - ny;
      }

      const onScreen =
        inFront && nx >= 0.06 && nx <= 0.94 && ny >= 0.08 && ny <= 0.88;
      o.screenX = Math.round(THREE.MathUtils.clamp(nx, 0.05, 0.95) * 1000) / 1000;
      o.screenY = Math.round(THREE.MathUtils.clamp(ny, 0.08, 0.88) * 1000) / 1000;
      o.onScreen = onScreen;
    }
  }

  private projectSquadOrderPing(
    target: { x: number; y: number; z: number; label: string } | null | undefined,
    playerPos: THREE.Vector3,
    camera?: THREE.PerspectiveCamera
  ): HudSnapshot['squadOrderPing'] {
    if (!target || !camera) return null;
    camera.getWorldDirection(this._camFwdScratch);
    this._projScratch.set(target.x, target.y + 1.1, target.z);
    this._toMarkerScratch.subVectors(this._projScratch, camera.position);
    const inFront = this._toMarkerScratch.dot(this._camFwdScratch) > 0.05;
    this._projScratch.project(camera);
    let nx = (this._projScratch.x + 1) * 0.5;
    let ny = (1 - this._projScratch.y) * 0.5;
    if (!inFront) {
      nx = 1 - nx;
      ny = 1 - ny;
    }
    const onScreen = inFront && nx >= 0.06 && nx <= 0.94 && ny >= 0.08 && ny <= 0.88;
    const distanceM = Math.round(Math.hypot(target.x - playerPos.x, target.z - playerPos.z));
    return {
      x: target.x,
      y: target.y,
      z: target.z,
      screenX: Math.round(THREE.MathUtils.clamp(nx, 0.05, 0.95) * 1000) / 1000,
      screenY: Math.round(THREE.MathUtils.clamp(ny, 0.08, 0.88) * 1000) / 1000,
      onScreen,
      label: target.label,
      distanceM,
    };
  }

  buildSnapshot(ctx: HudPublishContext): HudSnapshot | null {
    const { missionDirector, activeMission } = ctx;
    if (!missionDirector || !activeMission) return null;

    const wState = ctx.weapons.getActiveState();
    const veh = ctx.vehicles.getPlayerVehicle();
    const nearVeh = !veh ? ctx.vehicles.getNearestInteractableVehicle(ctx.player.position) : null;
    const objStatuses = missionDirector.getObjectiveStatuses();
    this.projectObjectiveStatuses(objStatuses, ctx.player.position, ctx.camera);

    let firstActiveObj: (typeof objStatuses)[number] | null = null;
    for (let i = 0; i < objStatuses.length; i++) {
      if (!objStatuses[i].completed && objStatuses[i].status === 'active') {
        firstActiveObj = objStatuses[i];
        break;
      }
    }
    if (!firstActiveObj) {
      firstActiveObj = objStatuses.find((o) => !o.completed) ?? null;
    }
    const firstActiveObjType = firstActiveObj?.type ?? null;

    const lockState = ctx.weapons.getLockOnState();
    const boss = ctx.airCombat.getActiveBossInfo({
      playerPosition: ctx.player.position,
      isPrimaryObjective: firstActiveObjType === 'air_defense',
      lockStatus: lockState.status,
    });

    const liftCtx =
      !veh && ctx.cargoLiftManager
        ? ctx.cargoLiftManager.getPlayerInteractionContext(ctx.player.position)
        : { prompt: null, activeSnapshot: null };

    const interactPrompt = this.resolveInteractPrompt(
      ctx.player,
      veh,
      nearVeh,
      ctx.worldData,
      ctx.destruction,
      liftCtx.prompt,
      ctx.sustainmentPrompt ?? null
    );

    let nearDemolitionCache = false;
    let nearSabotageTarget = false;
    if (ctx.worldData) {
      const destructibles = ctx.destruction.getAll();
      for (let i = 0; i < destructibles.length; i++) {
        const d = destructibles[i];
        if (
          d.state !== 'DESTROYED' &&
          d.isObjectiveTarget &&
          d.position.distanceTo(ctx.player.position) <= 4.8
        ) {
          if (d.kind === 'weapons_cache') {
            nearDemolitionCache = true;
          } else {
            nearSabotageTarget = true;
          }
          break;
        }
      }
    }

    this._blipsScratch.length = 0;
    ctx.enemies.fillMiniMapBlips(this._blipsScratch, ctx.player.position);
    ctx.airCombat.fillMiniMapBlips(this._blipsScratch);
    ctx.vehicles.fillMiniMapBlips(this._blipsScratch);
    missionDirector.fillObjectiveBlips(this._blipsScratch);
    if (!blipsMatch(this._cachedBlips, this._blipsScratch)) {
      const targetPool = this._usePoolA ? this._blipsPoolA : this._blipsPoolB;
      this._usePoolA = !this._usePoolA;
      const count = this._blipsScratch.length;
      for (let i = 0; i < count; i++) {
        const src = this._blipsScratch[i];
        const dst = targetPool[i];
        if (dst) {
          dst.id = src.id;
          dst.kind = src.kind;
          dst.x = src.x;
          dst.y = src.y;
          dst.z = src.z;
          dst.elevationDeltaM = src.elevationDeltaM;
          dst.elevationCode = src.elevationCode;
          dst.detectionSource = src.detectionSource;
          dst.confidence = src.confidence;
          dst.ageSec = src.ageSec;
        } else {
          targetPool[i] = {
            id: src.id,
            kind: src.kind,
            x: src.x,
            y: src.y,
            z: src.z,
            elevationDeltaM: src.elevationDeltaM,
            elevationCode: src.elevationCode,
            detectionSource: src.detectionSource,
            confidence: src.confidence,
            ageSec: src.ageSec,
          };
        }
      }
      targetPool.length = count;
      this._cachedBlips = targetPool;
    }
    const blips = this._cachedBlips;

    if (!objectivesMatch(this._cachedObjectives, objStatuses)) {
      this._cachedObjectives = objStatuses;
    }
    const stableObjectives = this._cachedObjectives;

    const rpgState = ctx.weapons.getWeaponState('rocket_launcher');
    const rpgAmmoInMag = rpgState?.ammoInMag ?? 0;
    const rpgReserveAmmo = rpgState?.reserveAmmo ?? 0;
    const rpgEquipped = wState.config.id === 'rocket_launcher';
    const guidedEquipped = wState.config.id === 'guided_missile';

    const effectiveDevice = this.resolveEffectiveDevice(ctx.input);
    const activeActionDirective = missionDirector.getActiveActionDirective(
      effectiveDevice,
      Boolean(veh),
      rpgEquipped
    );

    const settings = settingsStore.getState();
    const sandboxAuthorized =
      isDeveloperModeActiveForSetting(settings.developer.devModeEnabled) &&
      settings.developer.sandboxOrdnanceAuthorized;

    const ordnanceHud = ctx.explosives.getOrdnanceHud(
      ctx.player.position,
      progressionStore.getState().save.requisitionPoints,
      sandboxAuthorized
    );

    const extractionStatus = missionDirector.getExtractionStatus();
    const extractionBlockReason = missionDirector.getExtractionBlockReason();
    const nearExtractionZone = Boolean(
      activeMission.extractionPoint &&
        Math.hypot(
          ctx.player.position.x - activeMission.extractionPoint.x,
          ctx.player.position.z - activeMission.extractionPoint.z
        ) < 11.5
    );

    const incomingThreat =
      ctx.enemies.getActiveThreatWarning(ctx.player) ??
      ctx.airCombat.getActiveBossThreatWarning(ctx.player);
    const downedActive = Boolean(gameSessionStore.getState().downedState?.active);

    const activeTacticalHint = this.guidance.evaluateTier1Hint({
      nowSec: missionDirector.elapsedSec,
      controlScheme: effectiveDevice === 'touch' ? 'touch' : 'desktop_kb_mouse',
      tacticalHintsEnabled: settings.gameplay.tacticalGuidanceHints ?? true,
      isIntenseCombat: incomingThreat !== null,
      isPlayerDowned: downedActive,
      isNukeActive: ordnanceHud.nukeCountdownSec > 0,
      healthPct: ctx.player.maxHealth > 0 ? ctx.player.health / ctx.player.maxHealth : 1,
      magazineAmmo: wState.ammoInMag,
      reserveAmmo: wState.reserveAmmo,
      isReloading: ctx.weapons.isReloading,
      isNearDemolitionCache: nearDemolitionCache,
      isNearSabotageTarget: nearSabotageTarget,
      isNearVehicle: Boolean(nearVeh),
      isInsideVehicle: Boolean(veh),
      hasActiveAirObjective: firstActiveObjType === 'air_defense',
      hasEquippedStingerOrRpg: rpgEquipped || guidedEquipped,
      hasC4Available: ordnanceHud.c4Inventory > 0 || ordnanceHud.c4Deployed > 0,
      isPlantChargeStageActive:
        firstActiveObjType === 'plant_charge' ||
        firstActiveObj?.demolitionPolicy === 'charge_or_c4_only',
      extractionStatus,
      extractionBlockReason,
      isPlayerNearExtraction: nearExtractionZone,
      activeObjectiveType: firstActiveObjType,
      hasPrimaryInteractPrompt: Boolean(interactPrompt),
    });

    const waveStatus = missionDirector.evaluateWaveProgression(
      ctx.enemies.getActiveCount()
    );

    return {
      health: Math.round(ctx.player.health),
      maxHealth: ctx.player.maxHealth,
      armor: Math.round(ctx.player.armor),
      maxArmor: ctx.player.maxArmor,
      spawnProtectionSec: Math.round(ctx.player.getSpawnProtectionRemainingSec() * 100) / 100,
      isRegenerating: ctx.player.isRegenerating,
      incomingThreatWarning: incomingThreat,
      weaponId: wState.config.id,
      weaponName: wState.config.shortName,
      fireMode: ctx.weapons.getActiveFireMode(),
      ammoInMag: wState.ammoInMag,
      magSize: wState.magSize,
      reserveAmmo: wState.reserveAmmo,
      grenades: ctx.player.grenades,
      isReloading: ctx.weapons.isReloading,
      reloadProgress: ctx.weapons.getReloadProgress(),
      isAds: ctx.weapons.isAds,
      isScoped: ctx.weapons.isScoped,
      isSprinting: ctx.player.isSprinting,
      isCrouching: ctx.player.isCrouching,
      isSliding: ctx.player.isSliding,
      canVault: ctx.player.canVault,
      isVaulting: ctx.player.isVaulting,
      crosshairSpread:
        (ctx.weapons.isAds ? wState.config.spreadAdsRad : wState.config.spreadHipRad) +
        ctx.player.currentSpeed * 0.002,
      rpgAvailable: rpgAmmoInMag + rpgReserveAmmo > 0,
      rpgAmmoInMag,
      rpgReserveAmmo,
      rpgEquipped,
      playerX: ctx.player.position.x,
      playerZ: ctx.player.position.z,
      playerYaw: ctx.player.yaw,
      inVehicle: Boolean(veh),
      vehicleName: veh?.displayName ?? '',
      vehicleHealth: veh ? Math.round((veh.health / veh.maxHealth) * 100) : 100,
      vehicleMaxHealth: 100,
      vehicleTurretAmmo: veh?.turretAmmo ?? 0,
      vehicleMaxTurretAmmo: veh?.maxTurretAmmo ?? 0,
      vehicleSpeedKmh: veh ? Math.round(Math.abs(veh.speed) * 3.6) : 0,
      vehicleGear: veh?.driveGear ?? 'FORWARD',
      vehicleSteerDeg: veh ? Math.round(THREE.MathUtils.radToDeg(veh.steerAngle)) : 0,
      vehicleHandbrake: veh?.handbrakeActive ?? false,
      vehicleCameraMode: ctx.vehicles.getCameraMode(),
      interactPrompt,
      activeActionDirective,
      activeStageIndex: missionDirector.getActiveStageIndex(),
      totalStages: missionDirector.getTotalStages(),
      activeStageTitle: missionDirector.getActiveStageTitle(),
      extractionStatus,
      extractionBlockReason,
      activeTacticalHint,
      waveStatusText: waveStatus.statusText,
      subtitleText: settings.accessibility.subtitles ? missionDirector.subtitleText : null,
      missionAlert: missionDirector.alertText,
      elapsedSec: Math.floor(missionDirector.elapsedSec),
      score: missionDirector.score,
      kills: missionDirector.kills,
      headshots: missionDirector.headshots,
      shotsFired: ctx.weapons.shotsFired,
      shotsHit: ctx.weapons.shotsHit,
      lockOn: lockState,
      objectives: stableObjectives,
      blips,
      activeBossLabel: boss?.label ?? null,
      activeBossHealthPct: boss?.healthPct ?? 0,
      activeBossPhaseLabel: boss?.phaseLabel ?? null,
      activeBossVulnerable: boss?.isVulnerable ?? false,
      encounterPhase: ctx.encounterPhase,
      optionalObjectivesCompleted: ctx.optionalObjectivesCompleted,
      activeModifiers: ctx.activeModifiers,
      ordnance: ordnanceHud,
      liftStatus: liftCtx.activeSnapshot,
      squad: ctx.deploymentMode === 'solo' ? undefined : ctx.squadSummary,
      carriedWeaponIds: ctx.carriedWeaponIds,
      nearSupplySwapStation: ctx.nearSupplySwapStation,
      deploymentMode: ctx.deploymentMode ?? 'fireteam',
      soloTraumaKit: ctx.deploymentMode === 'solo' ? ctx.soloTraumaKit : undefined,
      activeRadioSubtitle: settings.accessibility.subtitles
        ? (ctx.activeRadioSubtitle ?? null)
        : null,
      suppressionLevel: Number(Math.max(0, Math.min(1, ctx.player.suppressionLevel)).toFixed(2)),
      squadOrderPing:
        ctx.deploymentMode === 'solo'
          ? null
          : this.projectSquadOrderPing(ctx.squadOrderTarget, ctx.player.position, ctx.camera),
    };
  }

  publish(ctx: HudPublishContext): void {
    const snap = this.buildSnapshot(ctx);
    if (!snap) return;
    gameSessionStore.getState().updateHudSnapshot(snap);
  }
}
