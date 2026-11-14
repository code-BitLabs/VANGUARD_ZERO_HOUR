import * as THREE from 'three';
import {
  AUTHORITATIVE_COMBAT_CONFIG,
  CombatDomain,
  DIFFICULTY_COMBAT_PROFILES,
  DifficultyCombatProfile,
} from '@/src/schemas/combat.schema';
import { Difficulty } from '@/src/schemas/common.schema';
import { SquadRole } from '@/src/schemas/enemy.schema';
import {
  CombatTelemetryRecorder,
  CoordinatorTelemetrySnapshot,
  SquadStatusSnapshot,
} from './CombatTelemetryRecorder';

export type LeaseKind = 'DIRECT' | 'HEAVY' | 'SUPPRESS';

export interface ActiveLease {
  unitId: string;
  squadId: string;
  domain: CombatDomain;
  kind: LeaseKind;
  grantedAtSec: number;
  expiresAtSec: number;
  priorityScore: number;
}

export interface SquadSightingRelay {
  x: number;
  y: number;
  z: number;
  reportedAtSec: number;
  effectiveAtSec: number;
}

export class SquadCoordinator {
  public readonly squadId: string;
  private members = new Set<string>();
  private aliveMembers = new Set<string>();
  private activeDirectShooters = new Set<string>();
  private activeSuppressors = new Set<string>();
  private waitingUnits = new Set<string>();
  private pendingRelay: SquadSightingRelay | null = null;
  private confirmedLkp: THREE.Vector3 | null = null;
  private confirmedLkpTimestampSec = -999;

  constructor(squadId: string) {
    this.squadId = squadId;
  }

  registerMember(unitId: string): void {
    this.members.add(unitId);
    this.aliveMembers.add(unitId);
  }

  markDead(unitId: string): void {
    this.aliveMembers.delete(unitId);
    this.activeDirectShooters.delete(unitId);
    this.activeSuppressors.delete(unitId);
    this.waitingUnits.delete(unitId);
  }

  reportSighting(x: number, y: number, z: number, nowSec: number): void {
    // Immediate update if already confirmed recently, otherwise radio delay (0.45s)
    if (this.confirmedLkp && nowSec - this.confirmedLkpTimestampSec < 2.5) {
      this.confirmedLkp.set(x, y, z);
      this.confirmedLkpTimestampSec = nowSec;
      return;
    }
    if (!this.pendingRelay) {
      this.pendingRelay = {
        x,
        y,
        z,
        reportedAtSec: nowSec,
        effectiveAtSec: nowSec + AUTHORITATIVE_COMBAT_CONFIG.squadRadioDelaySec,
      };
    } else {
      this.pendingRelay.x = x;
      this.pendingRelay.y = y;
      this.pendingRelay.z = z;
    }
  }

  tick(nowSec: number): void {
    if (this.pendingRelay && nowSec >= this.pendingRelay.effectiveAtSec) {
      if (!this.confirmedLkp) {
        this.confirmedLkp = new THREE.Vector3();
      }
      this.confirmedLkp.set(this.pendingRelay.x, this.pendingRelay.y, this.pendingRelay.z);
      this.confirmedLkpTimestampSec = nowSec;
      this.pendingRelay = null;
    }
  }

  getSharedSighting(nowSec: number): { position: THREE.Vector3; ageSec: number } | null {
    if (!this.confirmedLkp) return null;
    const age = nowSec - this.confirmedLkpTimestampSec;
    if (age > AUTHORITATIVE_COMBAT_CONFIG.lkpDecaySec) {
      return null;
    }
    return { position: this.confirmedLkp, ageSec: age };
  }

  canGrantLocalDirect(unitId: string, profile: DifficultyCombatProfile): boolean {
    if (this.activeDirectShooters.has(unitId)) return true;
    return this.activeDirectShooters.size < profile.maxSquadAttackers;
  }

  canGrantLocalSuppress(unitId: string, profile: DifficultyCombatProfile): boolean {
    if (this.activeSuppressors.has(unitId)) return true;
    return this.activeSuppressors.size < profile.maxSquadSuppressors;
  }

  onLeaseGranted(unitId: string, kind: LeaseKind): void {
    this.waitingUnits.delete(unitId);
    if (kind === 'SUPPRESS') {
      this.activeDirectShooters.delete(unitId);
      this.activeSuppressors.add(unitId);
    } else {
      this.activeSuppressors.delete(unitId);
      this.activeDirectShooters.add(unitId);
    }
  }

  onLeaseReleased(unitId: string): void {
    this.activeDirectShooters.delete(unitId);
    this.activeSuppressors.delete(unitId);
  }

  markWaiting(unitId: string, isWaiting: boolean): void {
    if (isWaiting && !this.activeDirectShooters.has(unitId) && !this.activeSuppressors.has(unitId)) {
      this.waitingUnits.add(unitId);
    } else {
      this.waitingUnits.delete(unitId);
    }
  }

  getSnapshot(profile: DifficultyCombatProfile): SquadStatusSnapshot {
    return {
      squadId: this.squadId,
      memberCount: this.members.size,
      aliveCount: this.aliveMembers.size,
      activeShooters: this.activeDirectShooters.size,
      maxSquadAttackers: profile.maxSquadAttackers,
      activeSuppressors: this.activeSuppressors.size,
      maxSquadSuppressors: profile.maxSquadSuppressors,
      waitingCount: this.waitingUnits.size,
    };
  }
}

export interface AttackLeaseRequest {
  unitId: string;
  squadId: string;
  domain: CombatDomain;
  role: SquadRole | 'air_strike' | 'vehicle_turret';
  kind: LeaseKind;
  distanceMeters: number;
  hasLos: boolean;
  isWeaponReady: boolean;
}

export class CombatEngagementCoordinator {
  private difficulty: Difficulty = 'normal';
  private profile: DifficultyCombatProfile = DIFFICULTY_COMBAT_PROFILES.normal;
  private squads = new Map<string, SquadCoordinator>();
  private leases = new Map<string, ActiveLease>();
  private releaseCooldownUntil = new Map<string, number>();
  private waitingUnits = new Set<string>();
  private pressureThrottleUntilSec = 0;

  constructor(private readonly telemetry: CombatTelemetryRecorder) {}

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    this.profile = DIFFICULTY_COMBAT_PROFILES[difficulty];
    this.enforceCapReductions();
  }

  getProfile(): DifficultyCombatProfile {
    return this.profile;
  }

  getDifficulty(): Difficulty {
    return this.difficulty;
  }

  reset(): void {
    this.squads.clear();
    this.leases.clear();
    this.releaseCooldownUntil.clear();
    this.waitingUnits.clear();
    this.pressureThrottleUntilSec = 0;
  }

  getOrCreateSquad(squadId: string): SquadCoordinator {
    let sq = this.squads.get(squadId);
    if (!sq) {
      sq = new SquadCoordinator(squadId);
      this.squads.set(squadId, sq);
    }
    return sq;
  }

  registerUnit(unitId: string, squadId: string): SquadCoordinator {
    const sq = this.getOrCreateSquad(squadId);
    sq.registerMember(unitId);
    return sq;
  }

  notifyUnitDisabled(unitId: string, squadId: string, domain: CombatDomain, reason: string): void {
    this.releaseLease(unitId, reason);
    this.waitingUnits.delete(unitId);
    const sq = this.squads.get(squadId);
    if (sq && reason === 'death') {
      sq.markDead(unitId);
    }
  }

  tick(nowSec: number): void {
    for (const sq of this.squads.values()) {
      sq.tick(nowSec);
    }

    // Check incoming-damage pressure over rolling 2s window
    const rolling2s = this.telemetry.getRollingDamage(2.0);
    if (rolling2s >= this.profile.damageBurstThreshold2s && nowSec > this.pressureThrottleUntilSec) {
      this.pressureThrottleUntilSec = nowSec + AUTHORITATIVE_COMBAT_CONFIG.pressureThrottleDurationSec;
      this.telemetry.recordEvent(
        'PRESSURE_THROTTLE',
        'coordinator',
        'global',
        'ground',
        `Incoming 2s burst (${rolling2s.toFixed(0)} HP >= ${this.profile.damageBurstThreshold2s} HP): throttling new direct leases for 1.0s`
      );
    }

    // Expire leases that exceeded maxLeaseSec ONLY when other units are waiting (anti-starvation)
    const hasWaiting = this.waitingUnits.size > 0;
    for (const [unitId, lease] of this.leases.entries()) {
      if (nowSec >= lease.expiresAtSec && hasWaiting) {
        this.releaseLease(unitId, 'lease_rotation', true);
      }
    }
  }

  requestLease(req: AttackLeaseRequest): boolean {
    const nowSec = this.telemetry.getElapsedSec();
    const sq = this.getOrCreateSquad(req.squadId);

    if (!req.isWeaponReady) {
      this.releaseLease(req.unitId, 'weapon_not_ready');
      sq.markWaiting(req.unitId, false);
      this.waitingUnits.delete(req.unitId);
      return false;
    }

    if (req.kind !== 'SUPPRESS' && !req.hasLos) {
      this.releaseLease(req.unitId, 'lost_los');
      sq.markWaiting(req.unitId, false);
      this.waitingUnits.delete(req.unitId);
      return false;
    }

    const existing = this.leases.get(req.unitId);
    if (existing) {
      if (existing.kind === req.kind) {
        // Extend lease if nobody is waiting
        if (this.waitingUnits.size === 0 && nowSec > existing.expiresAtSec - 0.5) {
          existing.expiresAtSec = nowSec + AUTHORITATIVE_COMBAT_CONFIG.maxLeaseSec;
        }
        return true;
      }
      // Changing lease kind (e.g. DIRECT -> SUPPRESS)
      this.releaseLease(req.unitId, 'switch_lease_kind');
    }

    // Check anti-starvation rotation cooldown if other units are waiting
    const cooldownUntil = this.releaseCooldownUntil.get(req.unitId) ?? 0;
    if (nowSec < cooldownUntil && this.waitingUnits.size > 0) {
      sq.markWaiting(req.unitId, true);
      this.waitingUnits.add(req.unitId);
      return false;
    }

    // Check incoming-damage pressure throttle for new DIRECT/HEAVY leases
    if (req.kind !== 'SUPPRESS' && nowSec < this.pressureThrottleUntilSec && this.getActiveDirectCount() >= 1) {
      sq.markWaiting(req.unitId, true);
      this.waitingUnits.add(req.unitId);
      return false;
    }

    // Check Tier 1 (Squad) and Tier 2 (Global) budgets
    if (req.kind === 'SUPPRESS') {
      if (
        !sq.canGrantLocalSuppress(req.unitId, this.profile) ||
        this.getActiveSuppressCount() >= this.profile.maxGlobalSuppressors
      ) {
        sq.markWaiting(req.unitId, true);
        this.waitingUnits.add(req.unitId);
        return false;
      }
    } else if (req.kind === 'HEAVY') {
      if (
        this.getActiveHeavyCount() >= this.profile.maxGlobalHeavyAttackers ||
        this.getActiveDirectCount() >= this.profile.maxGlobalAttackers
      ) {
        sq.markWaiting(req.unitId, true);
        this.waitingUnits.add(req.unitId);
        return false;
      }
    } else {
      // DIRECT lease
      if (
        (req.domain === 'ground' && !sq.canGrantLocalDirect(req.unitId, this.profile)) ||
        this.getActiveDirectCount() >= this.profile.maxGlobalAttackers
      ) {
        sq.markWaiting(req.unitId, true);
        this.waitingUnits.add(req.unitId);
        return false;
      }
    }

    // Grant lease!
    const priorityScore = this.computePriorityScore(req);
    const lease: ActiveLease = {
      unitId: req.unitId,
      squadId: req.squadId,
      domain: req.domain,
      kind: req.kind,
      grantedAtSec: nowSec,
      expiresAtSec: nowSec + AUTHORITATIVE_COMBAT_CONFIG.maxLeaseSec,
      priorityScore,
    };

    this.leases.set(req.unitId, lease);
    this.waitingUnits.delete(req.unitId);
    sq.onLeaseGranted(req.unitId, req.kind);

    this.telemetry.recordEvent(
      'TOKEN_ACQUIRED',
      req.unitId,
      req.squadId,
      req.domain,
      `Granted ${req.kind} lease (${this.getActiveDirectCount()}/${this.profile.maxGlobalAttackers} active)`
    );

    return true;
  }

  releaseLease(unitId: string, reason = 'manual', applyRotationCooldown = false): void {
    const existing = this.leases.get(unitId);
    if (!existing) return;

    this.leases.delete(unitId);
    const sq = this.squads.get(existing.squadId);
    sq?.onLeaseReleased(unitId);

    const nowSec = this.telemetry.getElapsedSec();
    if (applyRotationCooldown) {
      this.releaseCooldownUntil.set(
        unitId,
        nowSec + AUTHORITATIVE_COMBAT_CONFIG.cooldownAfterReleaseSec
      );
    }

    this.telemetry.recordEvent(
      'TOKEN_RELEASED',
      unitId,
      existing.squadId,
      existing.domain,
      `Released ${existing.kind} lease (${reason})`
    );
  }

  getUnitLease(unitId: string): ActiveLease | null {
    return this.leases.get(unitId) ?? null;
  }

  isUnitWaiting(unitId: string): boolean {
    return this.waitingUnits.has(unitId);
  }

  getActiveDirectCount(): number {
    let count = 0;
    for (const l of this.leases.values()) {
      if (l.kind === 'DIRECT' || l.kind === 'HEAVY') count++;
    }
    return count;
  }

  getActiveHeavyCount(): number {
    let count = 0;
    for (const l of this.leases.values()) {
      if (l.kind === 'HEAVY') count++;
    }
    return count;
  }

  getActiveSuppressCount(): number {
    let count = 0;
    for (const l of this.leases.values()) {
      if (l.kind === 'SUPPRESS') count++;
    }
    return count;
  }

  private enforceCapReductions(): void {
    while (this.getActiveDirectCount() > this.profile.maxGlobalAttackers) {
      let lowestId: string | null = null;
      let lowestScore = Infinity;
      for (const [id, l] of this.leases.entries()) {
        if ((l.kind === 'DIRECT' || l.kind === 'HEAVY') && l.priorityScore < lowestScore) {
          lowestScore = l.priorityScore;
          lowestId = id;
        }
      }
      if (!lowestId) break;
      this.releaseLease(lowestId, 'difficulty_cap_reduced');
    }
  }

  private computePriorityScore(req: AttackLeaseRequest): number {
    let roleBonus = 10;
    if (req.role === 'marksman') roleBonus = 18;
    else if (req.role === 'rifleman') roleBonus = 16;
    else if (req.role === 'anti_armor') roleBonus = 15;
    else if (req.role === 'air_strike' || req.role === 'vehicle_turret') roleBonus = 14;
    else if (req.role === 'suppressor') roleBonus = req.kind === 'SUPPRESS' ? 20 : 12;
    else if (req.role === 'flanker') roleBonus = req.distanceMeters < 24 ? 19 : 9;

    const distScore = Math.max(0, 40 - req.distanceMeters * 0.35);
    return roleBonus + distScore + (req.hasLos ? 20 : 0);
  }

  getSnapshot(): CoordinatorTelemetrySnapshot {
    const nowSec = this.telemetry.getElapsedSec();
    const curDirect = this.getActiveDirectCount();
    const curHeavy = this.getActiveHeavyCount();
    const curSuppress = this.getActiveSuppressCount();

    const squadsArr: SquadStatusSnapshot[] = [];
    for (const sq of this.squads.values()) {
      squadsArr.push(sq.getSnapshot(this.profile));
    }

    return {
      difficulty: this.difficulty,
      maxGlobalAttackers: this.profile.maxGlobalAttackers,
      currentGlobalAttackers: curDirect,
      availableGlobalTokens: Math.max(0, this.profile.maxGlobalAttackers - curDirect),
      maxGlobalHeavyAttackers: this.profile.maxGlobalHeavyAttackers,
      currentGlobalHeavyAttackers: curHeavy,
      maxGlobalSuppressors: this.profile.maxGlobalSuppressors,
      currentGlobalSuppressors: curSuppress,
      waitingAttackersCount: this.waitingUnits.size,
      pressureThrottled: nowSec < this.pressureThrottleUntilSec,
      rolling2sDamage: Number(this.telemetry.getRollingDamage(2.0).toFixed(1)),
      damageBurstThreshold2s: this.profile.damageBurstThreshold2s,
      squads: squadsArr,
    };
  }
}
