import * as THREE from 'three';
import { Difficulty } from '@/src/schemas/common.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';

export type SustainmentStationKind = 'ammo_crate' | 'med_armor_station' | 'vehicle_service_bay';

export interface SustainmentStation {
  id: string;
  kind: SustainmentStationKind;
  label: string;
  position: THREE.Vector3;
  chargesRemaining: number;
  maxCharges: number;
  cooldownRemainingSec: number;
  cooldownDurationSec: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  mesh: THREE.Object3D | null;
  statusLightMesh?: THREE.Mesh | null;
}

export interface SustainmentStationSnapshot {
  id: string;
  chargesRemaining: number;
  cooldownRemainingSec: number;
  hp: number;
  destroyed: boolean;
}

export interface SustainmentEconomySnapshot {
  stations: SustainmentStationSnapshot[];
  emergencyDropUsed: boolean;
}

export interface ActiveResupplyChannel {
  stationId: string;
  kind: SustainmentStationKind;
  elapsedSec: number;
  durationSec: number;
  startedWeaponId: WeaponId;
  vehicleId: string | null;
}

export interface SustainmentWeaponTarget {
  getActiveWeaponId(): WeaponId;
  resupplyWeapons(opts: {
    ballisticReserveFraction: number;
    explosiveRoundsPerLauncher: number;
    onlyCheckCapacity?: boolean;
  }): {
    ballisticRoundsAdded: number;
    explosiveRoundsAdded: number;
    weaponsReplenished: number;
    alreadyFull: boolean;
  };
  hasAnyHeavyOrdnanceAmmo(): boolean;
}

export interface SustainmentPlayerTarget {
  alive: boolean;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  grenades: number;
  maxGrenades?: number;
  position: THREE.Vector3;
  restoreHealthAndArmor(hpDelta: number, armorDelta: number): { hpAdded: number; armorAdded: number };
  resupplyGrenades(count: number, maxCap?: number): number;
}

export interface SustainmentExplosiveTarget {
  getC4Inventory(): number;
  resupplyC4(count: number, maxCap?: number): number;
}

export interface SustainmentVehicleTarget {
  id: string;
  alive: boolean;
  hostile: boolean;
  displayName: string;
  health: number;
  maxHealth: number;
  speed: number;
  position: THREE.Vector3;
  turretAmmo: number;
  maxTurretAmmo: number;
  lastDamagedAtSec: number;
  repairAndRearm(
    hullFraction: number,
    turretAmmoFraction: number
  ): { hullAdded: number; turretAmmoAdded: number; alreadyFull: boolean };
}

export interface SustainmentContext {
  player: SustainmentPlayerTarget;
  weapons: SustainmentWeaponTarget;
  explosives: SustainmentExplosiveTarget;
  playerVehicle: SustainmentVehicleTarget | null;
  nearbyFriendlyVehicle: SustainmentVehicleTarget | null;
  difficulty: Difficulty;
  nowSec: number;
  ammoGrantScale?: number;
}

export type SustainmentOutcomeCode =
  | 'channel_started'
  | 'completed'
  | 'already_full'
  | 'depleted'
  | 'destroyed'
  | 'cooldown'
  | 'anti_spam_guard'
  | 'out_of_range'
  | 'player_dead'
  | 'no_vehicle'
  | 'vehicle_moving'
  | 'vehicle_under_fire'
  | 'interrupted_death'
  | 'interrupted_weapon_switch'
  | 'interrupted_moved_away'
  | 'interrupted_destroyed'
  | 'interrupted_unsafe'
  | 'no_station';

export interface SustainmentActionResult {
  ok: boolean;
  code: SustainmentOutcomeCode;
  stationId?: string;
  kind?: SustainmentStationKind;
  message: string;
  ballisticRoundsAdded?: number;
  explosiveRoundsAdded?: number;
  grenadesAdded?: number;
  c4Added?: number;
  hpAdded?: number;
  armorAdded?: number;
  hullAdded?: number;
  turretAmmoAdded?: number;
}

export interface DifficultyRecoveryProfile {
  medStationHp: number;
  medStationArmor: number;
  pickupHp: number;
  pickupArmor: number;
  ammoBallisticFraction: number;
  ammoExplosiveRounds: number;
  grenadesPerResupply: number;
  c4PerResupply: number;
  vehicleHullRepairFraction: number;
  vehicleTurretRearmFraction: number;
}

export const DIFFICULTY_RECOVERY_PROFILES: Record<Difficulty, DifficultyRecoveryProfile> = {
  easy: {
    medStationHp: 65,
    medStationArmor: 65,
    pickupHp: 45,
    pickupArmor: 20,
    ammoBallisticFraction: 0.65,
    ammoExplosiveRounds: 2,
    grenadesPerResupply: 2,
    c4PerResupply: 1,
    vehicleHullRepairFraction: 0.55,
    vehicleTurretRearmFraction: 0.7,
  },
  normal: {
    medStationHp: 50,
    medStationArmor: 50,
    pickupHp: 35,
    pickupArmor: 15,
    ammoBallisticFraction: 0.55,
    ammoExplosiveRounds: 1,
    grenadesPerResupply: 1,
    c4PerResupply: 1,
    vehicleHullRepairFraction: 0.45,
    vehicleTurretRearmFraction: 0.6,
  },
  hard: {
    medStationHp: 40,
    medStationArmor: 35,
    pickupHp: 28,
    pickupArmor: 10,
    ammoBallisticFraction: 0.45,
    ammoExplosiveRounds: 1,
    grenadesPerResupply: 1,
    c4PerResupply: 1,
    vehicleHullRepairFraction: 0.38,
    vehicleTurretRearmFraction: 0.5,
  },
  extreme: {
    medStationHp: 30,
    medStationArmor: 25,
    pickupHp: 22,
    pickupArmor: 8,
    ammoBallisticFraction: 0.4,
    ammoExplosiveRounds: 1,
    grenadesPerResupply: 1,
    c4PerResupply: 1,
    vehicleHullRepairFraction: 0.32,
    vehicleTurretRearmFraction: 0.45,
  },
};

export const SUSTAINMENT_CONSTANTS = {
  FOOT_INTERACT_RADIUS: 3.85,
  VEHICLE_INTERACT_RADIUS: 6.5,
  FOOT_CHANNEL_SEC: 0.55,
  VEHICLE_CHANNEL_SEC: 0.85,
  GLOBAL_REPEAT_GUARD_SEC: 1.5,
  VEHICLE_MAX_SAFE_SPEED_MPS: 2.5,
  VEHICLE_SAFE_COMBAT_DELAY_SEC: 2.0,
  MAX_GRENADES: 4,
  MAX_C4: 3,
  DEFAULT_AMMO_COOLDOWN_SEC: 8.0,
  DEFAULT_MED_COOLDOWN_SEC: 14.0,
  DEFAULT_VEHICLE_COOLDOWN_SEC: 16.0,
} as const;

export function getDifficultyRecoveryProfile(difficulty: Difficulty): DifficultyRecoveryProfile {
  return DIFFICULTY_RECOVERY_PROFILES[difficulty] ?? DIFFICULTY_RECOVERY_PROFILES.normal;
}

export class SustainmentEconomyManager {
  private stations: SustainmentStation[] = [];
  private activeChannel: ActiveResupplyChannel | null = null;
  private globalRepeatGuardSec = 0;
  private emergencyDropUsed = false;
  private emergencySeq = 0;

  registerStation(opts: {
    id: string;
    kind: SustainmentStationKind;
    position: THREE.Vector3;
    maxCharges?: number;
    cooldownDurationSec?: number;
    maxHp?: number;
    label?: string;
    mesh?: THREE.Object3D | null;
    statusLightMesh?: THREE.Mesh | null;
  }): SustainmentStation {
    const defaultCharges = opts.kind === 'ammo_crate' ? 2 : 2;
    const defaultCooldown =
      opts.kind === 'ammo_crate'
        ? SUSTAINMENT_CONSTANTS.DEFAULT_AMMO_COOLDOWN_SEC
        : opts.kind === 'med_armor_station'
          ? SUSTAINMENT_CONSTANTS.DEFAULT_MED_COOLDOWN_SEC
          : SUSTAINMENT_CONSTANTS.DEFAULT_VEHICLE_COOLDOWN_SEC;
    const defaultLabel =
      opts.kind === 'ammo_crate'
        ? 'AMMO RESUPPLY CRATE'
        : opts.kind === 'med_armor_station'
          ? 'MED & ARMOR STATION'
          : 'VEHICLE REPAIR BAY';
    const maxHp = opts.maxHp ?? (opts.kind === 'vehicle_service_bay' ? 420 : 180);
    const maxCharges = Math.max(1, opts.maxCharges ?? defaultCharges);

    const station: SustainmentStation = {
      id: opts.id,
      kind: opts.kind,
      label: opts.label ?? defaultLabel,
      position: opts.position.clone(),
      chargesRemaining: maxCharges,
      maxCharges,
      cooldownRemainingSec: 0,
      cooldownDurationSec: opts.cooldownDurationSec ?? defaultCooldown,
      hp: maxHp,
      maxHp,
      destroyed: false,
      mesh: opts.mesh ?? null,
      statusLightMesh: opts.statusLightMesh ?? null,
    };
    this.stations.push(station);
    this.syncStationVisual(station);
    return station;
  }

  getStations(): readonly SustainmentStation[] {
    return this.stations;
  }

  getStationById(id: string): SustainmentStation | null {
    return this.stations.find((s) => s.id === id) ?? null;
  }

  getActiveChannel(): ActiveResupplyChannel | null {
    return this.activeChannel ? { ...this.activeChannel } : null;
  }

  getChannelProgress(): number {
    if (!this.activeChannel || this.activeChannel.durationSec <= 0) return 0;
    return Math.min(1, Math.max(0, this.activeChannel.elapsedSec / this.activeChannel.durationSec));
  }

  hasAvailableAmmoStation(): boolean {
    return this.stations.some(
      (s) => s.kind === 'ammo_crate' && !s.destroyed && s.chargesRemaining > 0
    );
  }

  damageStation(stationId: string, amount: number): boolean {
    const station = this.getStationById(stationId);
    if (!station || station.destroyed || amount <= 0) return false;
    station.hp = Math.max(0, station.hp - amount);
    if (station.hp <= 0) {
      station.destroyed = true;
      station.chargesRemaining = 0;
      if (this.activeChannel && this.activeChannel.stationId === station.id) {
        this.activeChannel = null;
      }
      this.syncStationVisual(station);
      return true;
    }
    return false;
  }

  damageStationsInRadius(center: THREE.Vector3, radius: number, maxDamage: number): string[] {
    const destroyedIds: string[] = [];
    if (radius <= 0 || maxDamage <= 0) return destroyedIds;
    for (const s of this.stations) {
      if (s.destroyed) continue;
      const dist = s.position.distanceTo(center);
      if (dist <= radius) {
        const falloff = 1 - (dist / radius) * 0.65;
        if (this.damageStation(s.id, maxDamage * falloff)) {
          destroyedIds.push(s.id);
        }
      }
    }
    return destroyedIds;
  }

  findNearestStation(
    pos: THREE.Vector3,
    inVehicle: boolean
  ): { station: SustainmentStation; distance: number } | null {
    let best: SustainmentStation | null = null;
    let bestDist = Infinity;
    for (const s of this.stations) {
      const maxRange =
        s.kind === 'vehicle_service_bay'
          ? SUSTAINMENT_CONSTANTS.VEHICLE_INTERACT_RADIUS
          : SUSTAINMENT_CONSTANTS.FOOT_INTERACT_RADIUS;
      if (inVehicle && s.kind !== 'vehicle_service_bay') continue;
      const d = pos.distanceTo(s.position);
      if (d <= maxRange && d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best ? { station: best, distance: bestDist } : null;
  }

  getPromptForContext(ctx: SustainmentContext): string | null {
    if (!ctx.player.alive) return null;

    if (this.activeChannel) {
      const st = this.getStationById(this.activeChannel.stationId);
      const pct = Math.round(this.getChannelProgress() * 100);
      if (st) {
        const verb =
          st.kind === 'ammo_crate'
            ? 'RESUPPLYING AMMO'
            : st.kind === 'med_armor_station'
              ? 'APPLYING MEDKIT & ARMOR'
              : 'REPAIRING & REARMING VEHICLE';
        return `${verb}... ${pct}%`;
      }
    }

    const pos = ctx.playerVehicle ? ctx.playerVehicle.position : ctx.player.position;
    const hit = this.findNearestStation(pos, Boolean(ctx.playerVehicle));
    if (!hit) return null;
    const { station } = hit;

    if (station.destroyed) {
      return `${station.label} — DESTROYED`;
    }
    if (station.chargesRemaining <= 0) {
      return `${station.label} — DEPLETED (0/${station.maxCharges})`;
    }
    if (station.cooldownRemainingSec > 0.05) {
      return `${station.label} — RECHARGING (${Math.ceil(station.cooldownRemainingSec)}s)`;
    }

    const readiness = this.evaluateStationReadiness(station, ctx);
    if (!readiness.ok) {
      return `${station.label} — ${readiness.message}`;
    }

    const actionLabel =
      station.kind === 'ammo_crate'
        ? '[E] RESUPPLY AMMO & ORDNANCE'
        : station.kind === 'med_armor_station'
          ? '[E] RESTORE HEALTH & ARMOR'
          : '[E] REPAIR & REARM VEHICLE';
    return `${actionLabel} (${station.chargesRemaining}/${station.maxCharges})`;
  }

  beginInteraction(ctx: SustainmentContext, explicitStationId?: string): SustainmentActionResult {
    if (!ctx.player.alive) {
      return { ok: false, code: 'player_dead', message: 'CANNOT RESUPPLY WHILE DOWN' };
    }
    if (this.activeChannel) {
      return {
        ok: false,
        code: 'anti_spam_guard',
        stationId: this.activeChannel.stationId,
        kind: this.activeChannel.kind,
        message: 'RESUPPLY ALREADY IN PROGRESS',
      };
    }
    if (this.globalRepeatGuardSec > 0) {
      return {
        ok: false,
        code: 'anti_spam_guard',
        message: 'RESUPPLY COOLDOWN ACTIVE',
      };
    }

    const origin = ctx.playerVehicle ? ctx.playerVehicle.position : ctx.player.position;
    let station: SustainmentStation | null = null;
    if (explicitStationId) {
      station = this.getStationById(explicitStationId);
      if (!station) {
        return { ok: false, code: 'no_station', message: 'SUPPLY STATION NOT FOUND' };
      }
      const maxRange =
        station.kind === 'vehicle_service_bay'
          ? SUSTAINMENT_CONSTANTS.VEHICLE_INTERACT_RADIUS
          : SUSTAINMENT_CONSTANTS.FOOT_INTERACT_RADIUS;
      if (origin.distanceTo(station.position) > maxRange) {
        return {
          ok: false,
          code: 'out_of_range',
          stationId: station.id,
          kind: station.kind,
          message: 'MOVE CLOSER TO SUPPLY STATION',
        };
      }
    } else {
      station = this.findNearestStation(origin, Boolean(ctx.playerVehicle))?.station ?? null;
    }

    if (!station) {
      return { ok: false, code: 'no_station', message: 'NO SUPPLY STATION IN RANGE' };
    }

    const check = this.evaluateStationReadiness(station, ctx);
    if (!check.ok) {
      return check;
    }

    const targetVehicle =
      station.kind === 'vehicle_service_bay'
        ? this.resolveServiceableVehicle(station, ctx)
        : null;

    this.activeChannel = {
      stationId: station.id,
      kind: station.kind,
      elapsedSec: 0,
      durationSec:
        station.kind === 'vehicle_service_bay'
          ? SUSTAINMENT_CONSTANTS.VEHICLE_CHANNEL_SEC
          : SUSTAINMENT_CONSTANTS.FOOT_CHANNEL_SEC,
      startedWeaponId: ctx.weapons.getActiveWeaponId(),
      vehicleId: targetVehicle?.id ?? null,
    };

    return {
      ok: true,
      code: 'channel_started',
      stationId: station.id,
      kind: station.kind,
      message: `INTERACTING WITH ${station.label}`,
    };
  }

  update(dt: number, ctx: SustainmentContext): SustainmentActionResult | null {
    const safeDt = Math.max(0, Math.min(0.25, dt));
    if (this.globalRepeatGuardSec > 0) {
      this.globalRepeatGuardSec = Math.max(0, this.globalRepeatGuardSec - safeDt);
    }
    for (const s of this.stations) {
      if (s.cooldownRemainingSec > 0) {
        s.cooldownRemainingSec = Math.max(0, s.cooldownRemainingSec - safeDt);
      }
    }

    if (!this.activeChannel) return null;

    const channel = this.activeChannel;
    const station = this.getStationById(channel.stationId);
    if (!station || station.destroyed) {
      this.activeChannel = null;
      return {
        ok: false,
        code: 'interrupted_destroyed',
        stationId: channel.stationId,
        kind: channel.kind,
        message: 'RESUPPLY INTERRUPTED: STATION DESTROYED',
      };
    }

    if (!ctx.player.alive) {
      this.activeChannel = null;
      return {
        ok: false,
        code: 'interrupted_death',
        stationId: station.id,
        kind: station.kind,
        message: 'RESUPPLY INTERRUPTED: OPERATOR DOWN',
      };
    }

    if (
      channel.kind === 'ammo_crate' &&
      ctx.weapons.getActiveWeaponId() !== channel.startedWeaponId
    ) {
      this.activeChannel = null;
      return {
        ok: false,
        code: 'interrupted_weapon_switch',
        stationId: station.id,
        kind: station.kind,
        message: 'RESUPPLY CANCELLED: WEAPON SWITCHED',
      };
    }

    const origin = ctx.playerVehicle ? ctx.playerVehicle.position : ctx.player.position;
    const maxRange =
      station.kind === 'vehicle_service_bay'
        ? SUSTAINMENT_CONSTANTS.VEHICLE_INTERACT_RADIUS + 0.9
        : SUSTAINMENT_CONSTANTS.FOOT_INTERACT_RADIUS + 0.9;
    if (origin.distanceTo(station.position) > maxRange) {
      this.activeChannel = null;
      return {
        ok: false,
        code: 'interrupted_moved_away',
        stationId: station.id,
        kind: station.kind,
        message: 'RESUPPLY CANCELLED: MOVED OUT OF RANGE',
      };
    }

    if (station.kind === 'vehicle_service_bay') {
      const veh = this.resolveServiceableVehicle(station, ctx);
      if (
        !veh ||
        Math.abs(veh.speed) > SUSTAINMENT_CONSTANTS.VEHICLE_MAX_SAFE_SPEED_MPS + 0.7 ||
        ctx.nowSec - veh.lastDamagedAtSec < SUSTAINMENT_CONSTANTS.VEHICLE_SAFE_COMBAT_DELAY_SEC
      ) {
        this.activeChannel = null;
        return {
          ok: false,
          code: 'interrupted_unsafe',
          stationId: station.id,
          kind: station.kind,
          message: 'VEHICLE REPAIR INTERRUPTED: HOLD POSITION OUT OF FIRE',
        };
      }
    }

    channel.elapsedSec += safeDt;
    if (channel.elapsedSec < channel.durationSec) {
      return null;
    }

    // Complete atomically
    this.activeChannel = null;
    return this.executeStationResupply(station, ctx);
  }

  /**
   * Anti-softlock safeguard: if the player has zero heavy ordnance left during a mandatory
   * anti-armor/air/demolition stage and all map ammo crates are depleted or destroyed,
   * deploy a single emergency tactical ordnance pod near the player (never unlimited).
   */
  tryDeployEmergencyOrdnancePod(opts: {
    requiresHeavyOrdnance: boolean;
    weapons: SustainmentWeaponTarget;
    explosives: SustainmentExplosiveTarget;
    playerPos: THREE.Vector3;
    groundY: number;
    mesh?: THREE.Object3D | null;
  }): SustainmentStation | null {
    if (this.emergencyDropUsed || !opts.requiresHeavyOrdnance) return null;
    if (this.hasAvailableAmmoStation()) return null;
    if (opts.weapons.hasAnyHeavyOrdnanceAmmo() || opts.explosives.getC4Inventory() > 0) {
      return null;
    }

    this.emergencyDropUsed = true;
    const dropPos = new THREE.Vector3(opts.playerPos.x + 2.4, opts.groundY, opts.playerPos.z + 2.4);
    const id = `emergency_ordnance_pod_${++this.emergencySeq}`;
    return this.registerStation({
      id,
      kind: 'ammo_crate',
      label: 'EMERGENCY ORDNANCE POD',
      position: dropPos,
      maxCharges: 1,
      cooldownDurationSec: 4,
      maxHp: 220,
      mesh: opts.mesh ?? null,
    });
  }

  captureSnapshot(): SustainmentEconomySnapshot {
    return {
      emergencyDropUsed: this.emergencyDropUsed,
      stations: this.stations.map((s) => ({
        id: s.id,
        chargesRemaining: s.chargesRemaining,
        cooldownRemainingSec: s.cooldownRemainingSec,
        hp: s.hp,
        destroyed: s.destroyed,
      })),
    };
  }

  restoreSnapshot(snapshot: SustainmentEconomySnapshot | undefined): void {
    this.activeChannel = null;
    this.globalRepeatGuardSec = 0;
    if (!snapshot) return;
    this.emergencyDropUsed = Boolean(snapshot.emergencyDropUsed);
    const byId = new Map(snapshot.stations.map((s) => [s.id, s]));
    for (const st of this.stations) {
      const saved = byId.get(st.id);
      if (!saved) continue;
      st.chargesRemaining = Math.max(0, Math.min(st.maxCharges, saved.chargesRemaining));
      st.cooldownRemainingSec = Math.max(0, saved.cooldownRemainingSec);
      st.hp = Math.max(0, Math.min(st.maxHp, saved.hp));
      st.destroyed = Boolean(saved.destroyed);
      this.syncStationVisual(st);
    }
  }

  clear(): void {
    this.stations.length = 0;
    this.activeChannel = null;
    this.globalRepeatGuardSec = 0;
    this.emergencyDropUsed = false;
  }

  private resolveServiceableVehicle(
    station: SustainmentStation,
    ctx: SustainmentContext
  ): SustainmentVehicleTarget | null {
    if (ctx.playerVehicle && ctx.playerVehicle.alive && !ctx.playerVehicle.hostile) {
      if (ctx.playerVehicle.position.distanceTo(station.position) <= SUSTAINMENT_CONSTANTS.VEHICLE_INTERACT_RADIUS + 1.0) {
        return ctx.playerVehicle;
      }
    }
    if (
      ctx.nearbyFriendlyVehicle &&
      ctx.nearbyFriendlyVehicle.alive &&
      !ctx.nearbyFriendlyVehicle.hostile &&
      ctx.nearbyFriendlyVehicle.position.distanceTo(station.position) <=
        SUSTAINMENT_CONSTANTS.VEHICLE_INTERACT_RADIUS + 1.0
    ) {
      return ctx.nearbyFriendlyVehicle;
    }
    return null;
  }

  private evaluateStationReadiness(
    station: SustainmentStation,
    ctx: SustainmentContext
  ): SustainmentActionResult {
    if (station.destroyed) {
      return {
        ok: false,
        code: 'destroyed',
        stationId: station.id,
        kind: station.kind,
        message: 'STATION DESTROYED',
      };
    }
    if (station.chargesRemaining <= 0) {
      return {
        ok: false,
        code: 'depleted',
        stationId: station.id,
        kind: station.kind,
        message: 'DEPLETED',
      };
    }
    if (station.cooldownRemainingSec > 0.05) {
      return {
        ok: false,
        code: 'cooldown',
        stationId: station.id,
        kind: station.kind,
        message: `RECHARGING (${Math.ceil(station.cooldownRemainingSec)}s)`,
      };
    }

    const prof = getDifficultyRecoveryProfile(ctx.difficulty);

    if (station.kind === 'ammo_crate') {
      const check = ctx.weapons.resupplyWeapons({
        ballisticReserveFraction: prof.ammoBallisticFraction,
        explosiveRoundsPerLauncher: prof.ammoExplosiveRounds,
        onlyCheckCapacity: true,
      });
      const maxGrenades = ctx.player.maxGrenades ?? SUSTAINMENT_CONSTANTS.MAX_GRENADES;
      const needsGrenade = ctx.player.grenades < maxGrenades;
      const needsC4 = ctx.explosives.getC4Inventory() < SUSTAINMENT_CONSTANTS.MAX_C4;
      if (check.alreadyFull && !needsGrenade && !needsC4) {
        return {
          ok: false,
          code: 'already_full',
          stationId: station.id,
          kind: station.kind,
          message: 'AMMO & ORDNANCE ALREADY AT MAX CAPACITY',
        };
      }
      return { ok: true, code: 'channel_started', stationId: station.id, kind: station.kind, message: 'READY' };
    }

    if (station.kind === 'med_armor_station') {
      const needsHp = ctx.player.health < ctx.player.maxHealth - 0.5;
      const needsArmor = ctx.player.armor < ctx.player.maxArmor - 0.5;
      if (!needsHp && !needsArmor) {
        return {
          ok: false,
          code: 'already_full',
          stationId: station.id,
          kind: station.kind,
          message: 'HEALTH & ARMOR ALREADY FULL',
        };
      }
      return { ok: true, code: 'channel_started', stationId: station.id, kind: station.kind, message: 'READY' };
    }

    // vehicle_service_bay
    const veh = this.resolveServiceableVehicle(station, ctx);
    if (!veh) {
      return {
        ok: false,
        code: 'no_vehicle',
        stationId: station.id,
        kind: station.kind,
        message: 'PARK FRIENDLY VEHICLE IN BAY',
      };
    }
    if (Math.abs(veh.speed) > SUSTAINMENT_CONSTANTS.VEHICLE_MAX_SAFE_SPEED_MPS) {
      return {
        ok: false,
        code: 'vehicle_moving',
        stationId: station.id,
        kind: station.kind,
        message: 'HALT VEHICLE TO SERVICE',
      };
    }
    if (ctx.nowSec - veh.lastDamagedAtSec < SUSTAINMENT_CONSTANTS.VEHICLE_SAFE_COMBAT_DELAY_SEC) {
      return {
        ok: false,
        code: 'vehicle_under_fire',
        stationId: station.id,
        kind: station.kind,
        message: 'UNDER FIRE — WAIT TO REPAIR',
      };
    }
    const hullFull = veh.health >= veh.maxHealth - 0.5;
    const turretFull = veh.turretAmmo >= veh.maxTurretAmmo;
    if (hullFull && turretFull) {
      return {
        ok: false,
        code: 'already_full',
        stationId: station.id,
        kind: station.kind,
        message: 'VEHICLE HULL & TURRET AMMO FULL',
      };
    }
    return { ok: true, code: 'channel_started', stationId: station.id, kind: station.kind, message: 'READY' };
  }

  private executeStationResupply(
    station: SustainmentStation,
    ctx: SustainmentContext
  ): SustainmentActionResult {
    const check = this.evaluateStationReadiness(station, ctx);
    if (!check.ok) {
      return check;
    }

    const prof = getDifficultyRecoveryProfile(ctx.difficulty);

    if (station.kind === 'ammo_crate') {
      const grantScale = Math.max(0.35, Math.min(1.5, ctx.ammoGrantScale ?? 1.0));
      const wepRes = ctx.weapons.resupplyWeapons({
        ballisticReserveFraction: prof.ammoBallisticFraction * grantScale,
        explosiveRoundsPerLauncher: Math.max(1, Math.round(prof.ammoExplosiveRounds * grantScale)),
        onlyCheckCapacity: false,
      });
      const grenadesAdded = ctx.player.resupplyGrenades(
        prof.grenadesPerResupply,
        ctx.player.maxGrenades ?? SUSTAINMENT_CONSTANTS.MAX_GRENADES
      );
      const c4Added = ctx.explosives.resupplyC4(prof.c4PerResupply, SUSTAINMENT_CONSTANTS.MAX_C4);

      if (
        wepRes.ballisticRoundsAdded === 0 &&
        wepRes.explosiveRoundsAdded === 0 &&
        grenadesAdded === 0 &&
        c4Added === 0
      ) {
        return {
          ok: false,
          code: 'already_full',
          stationId: station.id,
          kind: station.kind,
          message: 'AMMO & ORDNANCE ALREADY AT MAX CAPACITY',
        };
      }

      station.chargesRemaining = Math.max(0, station.chargesRemaining - 1);
      station.cooldownRemainingSec = station.chargesRemaining > 0 ? station.cooldownDurationSec : 0;
      this.globalRepeatGuardSec = SUSTAINMENT_CONSTANTS.GLOBAL_REPEAT_GUARD_SEC;
      this.syncStationVisual(station);

      const parts: string[] = [];
      if (wepRes.ballisticRoundsAdded > 0) parts.push(`+${wepRes.ballisticRoundsAdded} RDS`);
      if (wepRes.explosiveRoundsAdded > 0) parts.push(`+${wepRes.explosiveRoundsAdded} ORD`);
      if (grenadesAdded > 0) parts.push(`+${grenadesAdded} FRAG`);
      if (c4Added > 0) parts.push(`+${c4Added} C4`);

      return {
        ok: true,
        code: 'completed',
        stationId: station.id,
        kind: station.kind,
        message: `AMMO RESUPPLIED: ${parts.join(' · ')} (${station.chargesRemaining}/${station.maxCharges} LEFT)`,
        ballisticRoundsAdded: wepRes.ballisticRoundsAdded,
        explosiveRoundsAdded: wepRes.explosiveRoundsAdded,
        grenadesAdded,
        c4Added,
      };
    }

    if (station.kind === 'med_armor_station') {
      const rec = ctx.player.restoreHealthAndArmor(prof.medStationHp, prof.medStationArmor);
      if (rec.hpAdded === 0 && rec.armorAdded === 0) {
        return {
          ok: false,
          code: 'already_full',
          stationId: station.id,
          kind: station.kind,
          message: 'HEALTH & ARMOR ALREADY FULL',
        };
      }

      station.chargesRemaining = Math.max(0, station.chargesRemaining - 1);
      station.cooldownRemainingSec = station.chargesRemaining > 0 ? station.cooldownDurationSec : 0;
      this.globalRepeatGuardSec = SUSTAINMENT_CONSTANTS.GLOBAL_REPEAT_GUARD_SEC;
      this.syncStationVisual(station);

      const parts: string[] = [];
      if (rec.hpAdded > 0) parts.push(`+${rec.hpAdded} HP`);
      if (rec.armorAdded > 0) parts.push(`+${rec.armorAdded} ARM`);
      return {
        ok: true,
        code: 'completed',
        stationId: station.id,
        kind: station.kind,
        message: `FIELD TREATMENT: ${parts.join(' · ')} (${station.chargesRemaining}/${station.maxCharges} LEFT)`,
        hpAdded: rec.hpAdded,
        armorAdded: rec.armorAdded,
      };
    }

    // vehicle_service_bay
    const veh = this.resolveServiceableVehicle(station, ctx);
    if (!veh) {
      return {
        ok: false,
        code: 'no_vehicle',
        stationId: station.id,
        kind: station.kind,
        message: 'PARK FRIENDLY VEHICLE IN BAY',
      };
    }
    const res = veh.repairAndRearm(prof.vehicleHullRepairFraction, prof.vehicleTurretRearmFraction);
    if (res.alreadyFull) {
      return {
        ok: false,
        code: 'already_full',
        stationId: station.id,
        kind: station.kind,
        message: 'VEHICLE HULL & TURRET AMMO FULL',
      };
    }

    station.chargesRemaining = Math.max(0, station.chargesRemaining - 1);
    station.cooldownRemainingSec = station.chargesRemaining > 0 ? station.cooldownDurationSec : 0;
    this.globalRepeatGuardSec = SUSTAINMENT_CONSTANTS.GLOBAL_REPEAT_GUARD_SEC;
    this.syncStationVisual(station);

    const parts: string[] = [];
    if (res.hullAdded > 0) parts.push(`+${res.hullAdded} HULL`);
    if (res.turretAmmoAdded > 0) parts.push(`+${res.turretAmmoAdded} TURRET RDS`);

    return {
      ok: true,
      code: 'completed',
      stationId: station.id,
      kind: station.kind,
      message: `${veh.displayName.toUpperCase()} SERVICED: ${parts.join(' · ')} (${station.chargesRemaining}/${station.maxCharges} LEFT)`,
      hullAdded: res.hullAdded,
      turretAmmoAdded: res.turretAmmoAdded,
    };
  }

  private syncStationVisual(station: SustainmentStation): void {
    if (!station.mesh) return;
    if (station.destroyed) {
      station.mesh.visible = false;
      return;
    }
    station.mesh.visible = true;
    const depleted = station.chargesRemaining <= 0;
    station.mesh.scale.setScalar(depleted ? 0.94 : 1.0);
    if (station.statusLightMesh) {
      const mat = station.statusLightMesh.material;
      if (mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshStandardMaterial) {
        mat.color.setHex(
          depleted
            ? 0x475569
            : station.kind === 'ammo_crate'
              ? 0x22c55e
              : station.kind === 'med_armor_station'
                ? 0x38bdf8
                : 0xf59e0b
        );
      }
    }
  }
}
