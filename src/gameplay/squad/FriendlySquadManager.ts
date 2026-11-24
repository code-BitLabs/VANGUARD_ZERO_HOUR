import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import {
  resolveDeployableFireteam,
  SQUAD_ARCHETYPE_FLYWEIGHTS,
} from '@/src/data/squadRoster';
import type { CharacterMoveResult } from '@/src/engine/physics/PhysicsTypes';
import { PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import {
  EnemyLocomotionUnit,
  stepEnemyLocomotion,
} from '@/src/gameplay/ai/EnemyLocomotionSolver';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { SquadOperatorRecord, SquadRoleId } from '@/src/schemas/campaign.schema';
import { Difficulty } from '@/src/schemas/common.schema';
import { SquadOperatorMissionReport } from '@/src/stores/progressionStore';
import {
  FriendlyOperatorRig,
  FriendlySquadVisualPalette,
  SquadCommandBeacon,
} from './FriendlyOperatorRigBuilder';
import {
  assignFormationSlotIndicesByRole,
  computeCrossfireClearanceOffset,
  FormationWorldSlot,
  projectFormationSlotsInto,
  selectDynamicFormation,
  SquadFormationType,
} from './SquadFormationSolver';
import {
  SquadCommandPayload,
  SquadIntentRouter,
  SquadIntentValidationContext,
  ValidatedSquadIntent,
} from './SquadIntentRouter';
import {
  BoundedNavRequestScheduler,
  evaluateOperatorDirective,
  OperatorMicroState,
  OperatorMoraleState,
  OperatorTacticalDirective,
  PlannerOperatorSnapshot,
  SharedFriendlyThreatBoard,
} from './SquadTacticalPlanner';

export interface SquadEnemyReadView {
  id: string;
  alive: boolean;
  position: THREE.Vector3;
  isArmoredOrVehicle: boolean;
  isElevated: boolean;
}

export interface SquadVehicleSeatView {
  id: string;
  alive: boolean;
  hostile: boolean;
  position: THREE.Vector3;
  yaw: number;
  healthRatio: number;
  maxPassengerSeats: number;
  occupantIds: string[];
  tryBoardSeat: (operatorId: string) => boolean;
  releaseSeat: (operatorId: string) => { x: number; y: number; z: number } | null;
}

export interface FriendlyOperatorHudState {
  id: string;
  callsign: string;
  role: SquadRoleId;
  roleBadge: string;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  state: OperatorMicroState;
  morale: OperatorMoraleState;
  suppressionLevel: number;
  reasonTag: string;
  bleedoutRemainingSec: number;
  reviveProgress: number;
  reviveChargesRemaining: number;
  inVehicleId: string | null;
  isReserve: boolean;
  distanceToPlayerM: number;
}

export interface SquadHudSummary {
  activeOrderLabel: string;
  activeFormation: SquadFormationType;
  squadMedCharges: number;
  operators: FriendlyOperatorHudState[];
  downedCount: number;
  nearestDownedOperatorId: string | null;
  nearestDownedDistanceM: number;
  playerRevivingOperatorId: string | null;
  playerReviveProgress: number;
}

export interface FriendlyFireRequest {
  operatorId: string;
  role: SquadRoleId;
  enemyId: string;
  originX: number;
  originY: number;
  originZ: number;
  damage: number;
  isAntiArmor: boolean;
  suppressionPower: number;
}

export interface SquadTelemetryEventBatch {
  commandLatencySamplesMs: number[];
  medicRevivesThisTick: number;
  playerRevivesThisTick: number;
  downedEventsThisTick: Array<{ operatorId: string; callsign: string; role: SquadRoleId }>;
  miaEventsThisTick: Array<{ operatorId: string; callsign: string; role: SquadRoleId }>;
  revivedEventsThisTick: Array<{
    operatorId: string;
    callsign: string;
    role: SquadRoleId;
    byMedic: boolean;
    rescuerCallsign: string;
  }>;
}

export interface SquadFrameOutput {
  fireRequests: FriendlyFireRequest[];
  radioCallout: string | null;
  friendlySuppressorActive: boolean;
  navSolvesThisTick: number;
  maxDisplacementThisTick: number;
  hudSummary: SquadHudSummary;
  telemetryEvents: SquadTelemetryEventBatch;
}

export interface FriendlyOperatorRuntime extends EnemyLocomotionUnit {
  record: SquadOperatorRecord;
  isReserve: boolean;
  role: SquadRoleId;
  roleSlotIndex: number;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  suppressionLevel: number;
  morale: OperatorMoraleState;
  state: OperatorMicroState;
  bleedoutRemainingSec: number;
  stabilizedTimerSec: number;
  timesDownedThisOp: number;
  severeInjury: boolean;
  reviveChargesRemaining: number;
  reviveChannelSec: number;
  revivingTargetId: string | null;
  inVehicleId: string | null;
  fireCooldownSec: number;
  muzzleFlashTimerSec: number;
  ackPulseTimerSec: number;
  commandIssuedAtSec: number | null;
  pendingImmediateCommandAck: boolean;
  stanceOffsetY: number;
  recoilOffsetZ: number;
  killsThisOp: number;
  revivesThisOp: number;
  vehiclesDisabledThisOp: number;
  spotsMarkedThisOp: number;
  suppressionAssistsThisOp: number;
  unreachableFallbackCount: number;
  recoveryAnchorX: number;
  recoveryAnchorY: number;
  recoveryAnchorZ: number;
  recoveryHoldSec: number;
  lastDirective: OperatorTacticalDirective | null;
  rig: FriendlyOperatorRig | null;
}

const DOWNED_WINDOW_BY_DIFFICULTY: Readonly<Record<Difficulty, number>> = Object.freeze({
  easy: 22,
  normal: 18,
  hard: 14,
  extreme: 12,
});

const UNREACHABLE_STUCK_THRESHOLD_SEC = 2.5;
const MEDIC_REVIVE_CHANNEL_SEC = 3.2;
const PLAYER_REVIVE_CHANNEL_SEC = 2.6;
const STABILIZE_DURATION_SEC = 10.0;

/**
 * TRN-37 Authoritative Player-Controlled Tactical Fireteam Manager.
 * - Coordinates 3 (configurable) friendly operators with dynamic formations, shared awareness,
 *   role utility, Stage 5A vertical/collision locomotion, vehicle seat management,
 *   and finite downed/rescue/MIA rules without arbitrary teleportation.
 */
export class FriendlySquadManager {
  readonly intentRouter = new SquadIntentRouter();
  readonly threatBoard = new SharedFriendlyThreatBoard();
  readonly navScheduler = new BoundedNavRequestScheduler();

  private operators: FriendlyOperatorRuntime[] = [];
  private beacons: SquadCommandBeacon[] = [];
  private visualPalette: FriendlySquadVisualPalette | null = null;
  private difficulty: Difficulty = 'normal';
  private squadMedCharges = 2;
  private activeFormation: SquadFormationType = 'WEDGE';
  private plannerAccumSec = 0;
  private plannerRoundRobin = 0;
  private nowSec = 0;
  private lastCalloutSec = -10;
  private pendingCallout: string | null = null;
  private playerRevivingOperatorId: string | null = null;
  private playerReviveProgressSec = 0;
  private squadGroup: THREE.Group | null = null;

  // Pre-allocated hot-path scratch objects (zero-allocation frame loop)
  private readonly formationSlotsScratch: FormationWorldSlot[] = [];
  private readonly whiskerRayHitScratch: RayHit = {
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
  private readonly moveResultScratch: CharacterMoveResult = {
    grounded: true,
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
  private readonly fireRequestsScratch: FriendlyFireRequest[] = [];
  private readonly aliveEnemyIdSet = new Set<string>();
  private readonly enemyByIdScratch = new Map<string, SquadEnemyReadView>();
  private readonly plannerSnapshotsScratch: PlannerOperatorSnapshot[] = [];
  private readonly crossfireOffsetScratch = { x: 0, z: 0 };
  private readonly pendingTelemetry: SquadTelemetryEventBatch = {
    commandLatencySamplesMs: [],
    medicRevivesThisTick: 0,
    playerRevivesThisTick: 0,
    downedEventsThisTick: [],
    miaEventsThisTick: [],
    revivedEventsThisTick: [],
  };

  initializeForMission(params: {
    scene: THREE.Scene | null;
    resourceManager: ResourceManager | null;
    scope: ResourceScope | null;
    roster: readonly SquadOperatorRecord[];
    preferredSquadIds: readonly string[];
    spawnOrigin: { x: number; y: number; z: number };
    difficulty: Difficulty;
    bonusMedCharges?: number;
    squadSize?: number;
    initialFormation?: SquadFormationType;
  }): { reserveCount: number; substitutedNames: string[] } {
    this.dispose(params.scene);

    this.difficulty = params.difficulty;
    this.squadMedCharges = Math.max(1, 2 + (params.bonusMedCharges ?? 0));
    this.activeFormation = params.initialFormation ?? 'WEDGE';
    this.plannerAccumSec = 0;
    this.plannerRoundRobin = 0;
    this.nowSec = 0;
    this.lastCalloutSec = -10;
    this.pendingCallout = null;
    this.playerRevivingOperatorId = null;
    this.playerReviveProgressSec = 0;

    const resolved = resolveDeployableFireteam(
      params.roster,
      params.preferredSquadIds,
      params.squadSize ?? 3
    );

    if (params.scene && params.resourceManager && params.scope) {
      this.visualPalette = new FriendlySquadVisualPalette(params.resourceManager, params.scope);
      this.squadGroup = new THREE.Group();
      this.squadGroup.name = 'FriendlySquadRoot';
      params.scene.add(this.squadGroup);

      // Small pool of 3 reusable command beacons
      for (let i = 0; i < 3; i++) {
        const beacon = this.visualPalette.buildCommandBeacon();
        this.squadGroup.add(beacon.root);
        this.beacons.push(beacon);
      }
    }

    projectFormationSlotsInto(
      params.spawnOrigin.x,
      params.spawnOrigin.y,
      params.spawnOrigin.z,
      0,
      -1,
      this.activeFormation,
      resolved.operators.length,
      this.formationSlotsScratch
    );

    const roleSlots = assignFormationSlotIndicesByRole(resolved.operators.map((r) => r.role));

    this.operators = resolved.operators.map((rec, idx) => {
      const archetype = SQUAD_ARCHETYPE_FLYWEIGHTS[rec.role];
      const slotIdx = roleSlots[idx] ?? idx;
      const slot = this.formationSlotsScratch[slotIdx] ?? this.formationSlotsScratch[idx] ?? {
        x: params.spawnOrigin.x + (idx - 1) * 2.2,
        y: params.spawnOrigin.y,
        z: params.spawnOrigin.z + 2.5,
      };
      const rig = this.visualPalette
        ? this.visualPalette.buildOperatorRig(rec.role, rec.customization)
        : null;
      if (rig && this.squadGroup) {
        rig.root.position.set(slot.x, slot.y, slot.z);
        this.squadGroup.add(rig.root);
      }

      const op: FriendlyOperatorRuntime = {
        id: rec.id,
        alive: true,
        agentProfile: 'standard_infantry',
        position: new THREE.Vector3(slot.x, slot.y, slot.z),
        velocity: new THREE.Vector3(),
        isMoving: false,
        isRidingLift: false,
        grounded: true,
        actualHorizSpeed: 0,
        actualVertSpeed: 0,
        stuckTimerSec: 0,
        lastProgressX: slot.x,
        lastProgressZ: slot.z,
        avoidanceDirX: 0,
        avoidanceDirZ: 0,
        avoidanceLatchTimerSec: 0,
        lastColliderHit: null,
        activeContacts: 0,
        maxPenetrationDepth: 0,
        record: rec,
        isReserve: rec.id.startsWith('reserve_'),
        role: rec.role,
        roleSlotIndex: slotIdx,
        health: archetype.maxHealth,
        maxHealth: archetype.maxHealth,
        armor: archetype.maxArmor,
        maxArmor: archetype.maxArmor,
        suppressionLevel: 0,
        morale: 'STEADY',
        state: 'EXECUTE_FORMATION',
        bleedoutRemainingSec: 0,
        stabilizedTimerSec: 0,
        timesDownedThisOp: 0,
        severeInjury: false,
        reviveChargesRemaining: archetype.autonomousReviveCharges,
        reviveChannelSec: 0,
        revivingTargetId: null,
        inVehicleId: null,
        fireCooldownSec: 0.4 + idx * 0.15,
        muzzleFlashTimerSec: 0,
        ackPulseTimerSec: 0,
        commandIssuedAtSec: null,
        pendingImmediateCommandAck: false,
        stanceOffsetY: 0,
        recoilOffsetZ: 0,
        killsThisOp: 0,
        revivesThisOp: 0,
        vehiclesDisabledThisOp: 0,
        spotsMarkedThisOp: 0,
        suppressionAssistsThisOp: 0,
        unreachableFallbackCount: 0,
        recoveryAnchorX: slot.x,
        recoveryAnchorY: slot.y,
        recoveryAnchorZ: slot.z,
        recoveryHoldSec: 0,
        lastDirective: null,
        rig,
      };
      return op;
    });

    this.resetPendingTelemetry();

    return {
      reserveCount: resolved.reserveCount,
      substitutedNames: resolved.substitutedNames,
    };
  }

  private resetPendingTelemetry(): void {
    this.pendingTelemetry.commandLatencySamplesMs.length = 0;
    this.pendingTelemetry.medicRevivesThisTick = 0;
    this.pendingTelemetry.playerRevivesThisTick = 0;
    this.pendingTelemetry.downedEventsThisTick.length = 0;
    this.pendingTelemetry.miaEventsThisTick.length = 0;
    this.pendingTelemetry.revivedEventsThisTick.length = 0;
  }

  dispose(scene: THREE.Scene | null): void {
    if (this.squadGroup && scene) {
      scene.remove(this.squadGroup);
    }
    this.squadGroup = null;
    this.visualPalette = null;
    this.operators = [];
    this.beacons = [];
    this.intentRouter.reset();
    this.threatBoard.reset();
    this.navScheduler.reset();
    this.playerRevivingOperatorId = null;
    this.playerReviveProgressSec = 0;
  }

  issueCommand(
    cmd: SquadCommandPayload,
    ctx: SquadIntentValidationContext
  ): { accepted: boolean; intent: ValidatedSquadIntent | null; reason?: string } {
    const res = this.intentRouter.issueCommand(cmd, ctx);
    if (res.accepted && res.intent) {
      if (res.intent.hasWorldAnchor) {
        this.spawnCommandBeacon(res.intent.anchorX, res.intent.anchorY, res.intent.anchorZ, res.intent.order);
      }
      this.emitCallout(`Fireteam: ${res.intent.label}.`, true);
      // TRN-43: Immediately preempt stale recoveryHoldSec and flag affected operators for
      // immediate next-tick directive adoption (near-zero latency) while navScheduler stays bounded.
      for (const op of this.operators) {
        if (!op.alive || op.state === 'DOWNED' || op.state === 'MIA') continue;
        if (!res.intent.operatorId || res.intent.operatorId === op.id) {
          op.recoveryHoldSec = 0;
          op.stuckTimerSec = 0;
          op.ackPulseTimerSec = 1.15;
          op.commandIssuedAtSec = this.nowSec;
          op.pendingImmediateCommandAck = true;
          this.navScheduler.enqueue(op.id);
        }
      }
    }
    return res;
  }

  private spawnCommandBeacon(x: number, y: number, z: number, order: string): void {
    if (this.beacons.length === 0) return;
    const beacon = this.beacons.find((b) => !b.active) ?? this.beacons[0];
    beacon.active = true;
    beacon.ttlSec = 4.2;
    beacon.root.position.set(x, y, z);
    beacon.root.visible = true;
    const color =
      order === 'ATTACK_TARGET' || order === 'SUPPRESS'
        ? 0xef4444
        : order === 'FLANK'
          ? 0xf59e0b
          : order === 'BOARD_VEHICLE'
            ? 0x34d399
            : 0x38bdf8;
    beacon.material.color.setHex(color);
    beacon.material.opacity = 0.78;
  }

  private emitCallout(text: string, urgent = false): void {
    if (!urgent && this.nowSec - this.lastCalloutSec < 2.2) return;
    this.pendingCallout = text;
    this.lastCalloutSec = this.nowSec;
  }

  /**
   * Authoritative damage & suppression handler for a friendly operator.
   * Transitions ACTIVE -> SUPPRESSED -> DOWNED cleanly, cancels active rescue channels,
   * and releases vehicle seat reservations atomically if downed mid-transition.
   */
  applyDamageToOperator(
    operatorId: string,
    damage: number,
    suppressionAdded: number,
    isExplosive: boolean,
    vehicles: readonly SquadVehicleSeatView[]
  ): { downed: boolean; becameMia: boolean } {
    const op = this.operators.find((o) => o.id === operatorId);
    if (!op || op.state === 'MIA') return { downed: false, becameMia: false };

    // Splash damage while downed accelerates bleedout safely (capped so instant skip never happens)
    if (op.state === 'DOWNED') {
      const bleedPenalty = Math.min(3.5, Math.max(0.5, damage * 0.08));
      op.bleedoutRemainingSec = Math.max(1.5, op.bleedoutRemainingSec - bleedPenalty);
      if (isExplosive) op.severeInjury = true;
      return { downed: true, becameMia: false };
    }

    op.suppressionLevel = Math.min(1, op.suppressionLevel + suppressionAdded);
    this.updateMorale(op);

    let remaining = Math.max(0, damage);
    if (op.armor > 0) {
      const absorbed = Math.min(op.armor, remaining * 0.65);
      op.armor -= absorbed;
      remaining -= absorbed;
    }
    op.health = Math.max(0, op.health - remaining);

    if (op.health <= 0) {
      op.health = 0;
      op.state = 'DOWNED';
      op.alive = false;
      op.timesDownedThisOp += 1;
      if (isExplosive || op.timesDownedThisOp >= 2) {
        op.severeInjury = true;
      }
      // Cancel any active rescue channel cleanly if the rescuer (e.g., Medic) gets downed
      op.revivingTargetId = null;
      op.reviveChannelSec = 0;

      // Atomically release vehicle seat reservation if downed while mounted/boarding
      if (op.inVehicleId) {
        const veh = vehicles.find((v) => v.id === op.inVehicleId);
        const exitPos = veh?.releaseSeat(op.id);
        if (exitPos) {
          op.position.set(exitPos.x, exitPos.y, exitPos.z);
        }
        op.inVehicleId = null;
      }

      op.bleedoutRemainingSec = DOWNED_WINDOW_BY_DIFFICULTY[this.difficulty];
      op.stabilizedTimerSec = 0;
      this.pendingTelemetry.downedEventsThisTick.push({
        operatorId: op.id,
        callsign: op.record.callsign,
        role: op.role,
      });
      this.emitCallout(`${op.record.callsign} is DOWN! Triage needed (${Math.ceil(op.bleedoutRemainingSec)}s)!`, true);
      return { downed: true, becameMia: false };
    }

    return { downed: false, becameMia: false };
  }

  /**
   * Player manual rescue / revive interaction (works even if Field Medic is downed/MIA!).
   */
  stepPlayerRescue(
    dt: number,
    playerPos: THREE.Vector3,
    interactHeld: boolean
  ): { rescuedOperatorId: string | null; activeTargetId: string | null; progress: number } {
    const downedNearby = this.operators
      .filter((o) => o.state === 'DOWNED' && o.position.distanceTo(playerPos) <= 3.4)
      .sort((a, b) => a.bleedoutRemainingSec - b.bleedoutRemainingSec);

    if (!interactHeld || downedNearby.length === 0) {
      this.playerRevivingOperatorId = null;
      this.playerReviveProgressSec = 0;
      return { rescuedOperatorId: null, activeTargetId: null, progress: 0 };
    }

    const target = downedNearby[0];
    if (this.playerRevivingOperatorId !== target.id) {
      this.playerRevivingOperatorId = target.id;
      this.playerReviveProgressSec = 0;
    }

    // Pause bleedout while commander is actively applying field trauma aid
    target.stabilizedTimerSec = Math.max(target.stabilizedTimerSec, 0.5);
    this.playerReviveProgressSec += dt;
    const progress = Math.min(1, this.playerReviveProgressSec / PLAYER_REVIVE_CHANNEL_SEC);

    if (this.playerReviveProgressSec >= PLAYER_REVIVE_CHANNEL_SEC) {
      if (this.squadMedCharges > 0) {
        this.squadMedCharges--;
      }
      this.completeOperatorRevive(target, 0.55);
      this.playerRevivingOperatorId = null;
      this.playerReviveProgressSec = 0;
      this.pendingTelemetry.playerRevivesThisTick += 1;
      this.pendingTelemetry.revivedEventsThisTick.push({
        operatorId: target.id,
        callsign: target.record.callsign,
        role: target.role,
        byMedic: false,
        rescuerCallsign: 'Commander',
      });
      this.emitCallout(`${target.record.callsign} back on their feet!`, true);
      return { rescuedOperatorId: target.id, activeTargetId: null, progress: 1 };
    }

    return { rescuedOperatorId: null, activeTargetId: target.id, progress };
  }

  private completeOperatorRevive(target: FriendlyOperatorRuntime, healthFraction: number): void {
    target.state = 'EXECUTE_FORMATION';
    target.alive = true;
    target.health = Math.round(target.maxHealth * healthFraction);
    target.armor = Math.round(target.maxArmor * 0.25);
    target.suppressionLevel = 0.2;
    target.bleedoutRemainingSec = 0;
    target.stabilizedTimerSec = 0;
    target.morale = 'STEADY';
    target.lastDirective = null;
    this.navScheduler.enqueue(target.id);

    // Clear any competing rescue channel targeting this newly revived operator so medics pivot immediately
    for (let i = 0; i < this.operators.length; i++) {
      const other = this.operators[i];
      if (other.revivingTargetId === target.id || other.lastDirective?.rescueAllyId === target.id) {
        other.revivingTargetId = null;
        other.reviveChannelSec = 0;
        other.lastDirective = null;
        this.navScheduler.enqueue(other.id);
      }
    }
  }

  private updateMorale(op: FriendlyOperatorRuntime): void {
    const hasAnchorSpec = op.record.unlockedSpecializations.includes('suppressive_anchor');
    const shakenThreshold = hasAnchorSpec ? 0.88 : 0.78;
    const suppressedThreshold = hasAnchorSpec ? 0.45 : 0.35;

    if (op.suppressionLevel >= shakenThreshold && op.health / op.maxHealth < 0.6) {
      op.morale = 'SHAKEN';
    } else if (op.suppressionLevel >= suppressedThreshold) {
      op.morale = 'SUPPRESSED';
    } else {
      op.morale = 'STEADY';
    }
  }

  /**
   * Main simulation step. Enforces:
   * - Staggered 5 Hz tactical planner + bounded nav scheduler (<= 2 solves/tick)
   * - 60 Hz continuous collision/gravity/3D-separation locomotion (zero teleportation!)
   * - Corridor width probing for automatic narrow-door/stair COLUMN collapse
   * - Explicit Unreachable-Anchor Fallback Policy
   */
  update(params: {
    dt: number;
    playerPos: THREE.Vector3;
    playerForward: THREE.Vector3;
    playerAlive: boolean;
    collision: CollisionWorld;
    enemies: readonly SquadEnemyReadView[];
    vehicles: readonly SquadVehicleSeatView[];
    intentValidationCtx: SquadIntentValidationContext;
  }): SquadFrameOutput {
    const safeDt = Math.max(1e-4, Math.min(params.dt, 0.05));
    this.nowSec += safeDt;
    this.fireRequestsScratch.length = 0;
    this.pendingCallout = null;

    // 1. Prune stale targets within 1 tick
    this.intentRouter.pruneStaleTargets(params.intentValidationCtx, this.nowSec);

    // 2. Refresh shared friendly threat awareness board + O(1) enemy lookup cache
    this.aliveEnemyIdSet.clear();
    this.enemyByIdScratch.clear();
    for (let i = 0; i < params.enemies.length; i++) {
      const e = params.enemies[i];
      this.enemyByIdScratch.set(e.id, e);
      if (e.alive) this.aliveEnemyIdSet.add(e.id);
    }
    this.threatBoard.update(safeDt, this.aliveEnemyIdSet);

    for (let i = 0; i < this.operators.length; i++) {
      const op = this.operators[i];
      if (!op.alive || op.state === 'DOWNED' || op.state === 'MIA') continue;
      const arch = SQUAD_ARCHETYPE_FLYWEIGHTS[op.role];
      const spotRangeBonus = op.record.unlockedSpecializations.includes('armor_spotter') ? 1.1 : 1.0;
      const spotRange = arch.spotRangeMeters * spotRangeBonus;

      for (let eIdx = 0; eIdx < params.enemies.length; eIdx++) {
        const enemy = params.enemies[eIdx];
        if (!enemy.alive) continue;
        const dist = op.position.distanceTo(enemy.position);
        if (dist > spotRange) continue;
        const hadPrior = this.threatBoard.hasThreat(enemy.id);
        this.threatBoard.reportThreat({
          enemyId: enemy.id,
          x: enemy.position.x,
          y: enemy.position.y,
          z: enemy.position.z,
          isArmoredOrVehicle: enemy.isArmoredOrVehicle,
          isElevated: enemy.isElevated,
          spottedByOperatorId: op.id,
        });
        if (!hadPrior) {
          op.spotsMarkedThisOp++;
          if (op.role === 'recon' && (enemy.isArmoredOrVehicle || enemy.isElevated)) {
            this.emitCallout(
              `${op.record.callsign}: Marked ${enemy.isArmoredOrVehicle ? 'armored threat' : 'elevated hostile'} for fireteam.`
            );
          }
        }
      }
    }

    // 3. Probe local corridor width at player to drive automatic dynamic formation selection
    const corridorWidth = this.measureCorridorWidth(
      params.collision,
      params.playerPos.x,
      params.playerPos.y + 1.05,
      params.playerPos.z,
      params.playerForward.x,
      params.playerForward.z
    );
    const anyOnElevationChange = this.operators.some(
      (op) => op.alive && Math.abs(op.position.y - params.playerPos.y) > 0.75
    );
    const anyLiftRiding = this.operators.some((op) => op.alive && op.isRidingLift);
    const squadIntent = this.intentRouter.getSquadWideIntent();
    const avgSuppression =
      this.operators.length > 0
        ? this.operators.reduce((s, o) => s + o.suppressionLevel, 0) / this.operators.length
        : 0;

    const activeThreats = this.threatBoard.getAllThreats();
    let hasDistantOrElevatedThreats = false;
    for (let t = 0; t < activeThreats.length; t++) {
      const th = activeThreats[t];
      if (
        th.isElevated ||
        Math.hypot(th.x - params.playerPos.x, th.z - params.playerPos.z) >= 28
      ) {
        hasDistantOrElevatedThreats = true;
        break;
      }
    }

    this.activeFormation = selectDynamicFormation({
      corridorWidthMeters: corridorWidth,
      onVerticalPortalOrBridge: anyOnElevationChange || corridorWidth < 2.2,
      nearCargoLiftOrCluster: anyLiftRiding,
      isFiringLineIntent:
        squadIntent?.order === 'HOLD' ||
        squadIntent?.order === 'DEFEND' ||
        squadIntent?.order === 'SUPPRESS',
      threatExposure: avgSuppression,
      hasDistantOrElevatedThreats,
    });

    projectFormationSlotsInto(
      params.playerPos.x,
      params.playerPos.y,
      params.playerPos.z,
      params.playerForward.x,
      params.playerForward.z,
      this.activeFormation,
      this.operators.length,
      this.formationSlotsScratch
    );

    // 4. Advance downed bleedout timers & emergency vehicle dismount checks
    for (let i = 0; i < this.operators.length; i++) {
      const op = this.operators[i];

      // Emergency vehicle egress if vehicle is destroyed or critically damaged
      if (op.inVehicleId) {
        const veh = params.vehicles.find((v) => v.id === op.inVehicleId);
        if (!veh || !veh.alive || veh.healthRatio <= 0.15) {
          const exitPos = veh?.releaseSeat(op.id);
          if (exitPos) {
            op.position.set(exitPos.x, exitPos.y, exitPos.z);
          }
          op.inVehicleId = null;
          op.state = 'EXECUTE_FORMATION';
          this.emitCallout(`${op.record.callsign}: Vehicle critical — dismounting!`, true);
        }
      }

      if (op.state === 'DOWNED') {
        if (op.stabilizedTimerSec > 0) {
          op.stabilizedTimerSec = Math.max(0, op.stabilizedTimerSec - safeDt);
        } else {
          op.bleedoutRemainingSec = Math.max(0, op.bleedoutRemainingSec - safeDt);
          if (op.bleedoutRemainingSec <= 0) {
            op.state = 'MIA';
            op.alive = false;
            this.pendingTelemetry.miaEventsThisTick.push({
              operatorId: op.id,
              callsign: op.record.callsign,
              role: op.role,
            });
            this.emitCallout(`${op.record.callsign} is MIA — Medevac beacon activated.`, true);
          }
        }
        continue;
      }

      if (op.state === 'MIA') continue;

      // Natural suppression decay & slow out-of-combat armor/morale recovery
      op.suppressionLevel = Math.max(0, op.suppressionLevel - 0.16 * safeDt);
      this.updateMorale(op);
      if (op.recoveryHoldSec > 0) {
        op.recoveryHoldSec = Math.max(0, op.recoveryHoldSec - safeDt);
      }
      if (op.muzzleFlashTimerSec > 0) {
        op.muzzleFlashTimerSec = Math.max(0, op.muzzleFlashTimerSec - safeDt);
      }
      if (op.fireCooldownSec > 0) {
        op.fireCooldownSec = Math.max(0, op.fireCooldownSec - safeDt);
      }
      if (op.ackPulseTimerSec > 0) {
        op.ackPulseTimerSec = Math.max(0, op.ackPulseTimerSec - safeDt);
      }
    }

    // 5. Staggered 5 Hz Tactical Planner + Bounded Nav Request Drain (max 2 solves/tick)
    // Plus immediate directive adoption for newly commanded operators (TRN-43 near-zero latency)
    this.plannerAccumSec += safeDt;
    const navBatch = this.navScheduler.drainBatch(2);
    const navSolvesThisTick = navBatch.length;
    const forcePlanSet = new Set(navBatch);

    for (let i = 0; i < this.operators.length; i++) {
      if (this.operators[i].pendingImmediateCommandAck) {
        forcePlanSet.add(this.operators[i].id);
      }
    }

    if (this.plannerAccumSec >= 0.066 || forcePlanSet.size > 0) {
      if (this.plannerAccumSec >= 0.066) {
        this.plannerAccumSec = 0;
        if (this.operators.length > 0) {
          const rrOp = this.operators[this.plannerRoundRobin % this.operators.length];
          forcePlanSet.add(rrOp.id);
          this.plannerRoundRobin++;
        }
      }

      this.buildPlannerSnapshots();
      for (let i = 0; i < this.operators.length; i++) {
        const op = this.operators[i];
        if (!forcePlanSet.has(op.id) && op.lastDirective) continue;
        const intent = this.intentRouter.getActiveIntentForOperator(op.id);
        const slot =
          this.formationSlotsScratch[op.roleSlotIndex] ??
          this.formationSlotsScratch[i] ?? {
            x: params.playerPos.x,
            y: params.playerPos.y,
            z: params.playerPos.z,
            formation: this.activeFormation,
          };
        op.lastDirective = evaluateOperatorDirective({
          operator: this.plannerSnapshotsScratch[i],
          allOperators: this.plannerSnapshotsScratch,
          intent,
          formationSlot: slot,
          playerPos: params.playerPos,
          threatBoard: this.threatBoard,
          slotIndex: op.roleSlotIndex,
          playerRevivingOperatorId: this.playerRevivingOperatorId,
        });

        if (op.pendingImmediateCommandAck) {
          const latencyMs =
            op.commandIssuedAtSec !== null
              ? Math.max(0.5, (this.nowSec - op.commandIssuedAtSec) * 1000)
              : safeDt * 1000;
          this.pendingTelemetry.commandLatencySamplesMs.push(Number(latencyMs.toFixed(1)));
          op.pendingImmediateCommandAck = false;
          op.commandIssuedAtSec = null;
        }
      }
    }

    // 6. Execute micro-states, authoritative locomotion (ZERO teleportation), triage, vehicle boarding & fire
    let maxDisplacementThisTick = 0;
    let friendlySuppressorActive = false;

    for (let i = 0; i < this.operators.length; i++) {
      const op = this.operators[i];
      if (op.state === 'DOWNED' || op.state === 'MIA') {
        this.syncOperatorRig(op, safeDt);
        continue;
      }

      const directive = op.lastDirective;
      if (!directive) continue;

      const arch = SQUAD_ARCHETYPE_FLYWEIGHTS[op.role];
      const prevX = op.position.x;
      const prevY = op.position.y;
      const prevZ = op.position.z;

      // Vehicle mounted sync
      if (directive.microState === 'IN_VEHICLE' && op.inVehicleId) {
        const veh = params.vehicles.find((v) => v.id === op.inVehicleId);
        if (veh && veh.alive) {
          op.state = 'IN_VEHICLE';
          op.position.set(veh.position.x, veh.position.y + 1.1, veh.position.z);
          this.tryOperatorFire(op, directive, params.enemies);
          this.syncOperatorRig(op, safeDt);
          continue;
        }
      }

      // Dismount if ordered EXIT_VEHICLE
      const opIntent = this.intentRouter.getActiveIntentForOperator(op.id);
      if (opIntent?.order === 'EXIT_VEHICLE' && op.inVehicleId) {
        const veh = params.vehicles.find((v) => v.id === op.inVehicleId);
        const exitPos = veh?.releaseSeat(op.id);
        if (exitPos) {
          op.position.set(exitPos.x, exitPos.y, exitPos.z);
        }
        op.inVehicleId = null;
        op.state = 'EXECUTE_FORMATION';
      }

      // Compute movement target (respecting active unreachable-anchor recovery hold)
      let goalX = directive.targetPosX;
      let goalY = directive.targetPosY;
      let goalZ = directive.targetPosZ;
      if (op.recoveryHoldSec > 0) {
        goalX = op.recoveryAnchorX;
        goalY = op.recoveryAnchorY;
        goalZ = op.recoveryAnchorZ;
      }

      // Keep clear of player corridor & forward muzzle cone so companions never block shots or doors (TRN-43)
      const distToPlayer = Math.hypot(
        op.position.x - params.playerPos.x,
        op.position.z - params.playerPos.z
      );
      if (distToPlayer < 1.25 && Math.abs(op.position.y - params.playerPos.y) < 1.5) {
        const pushX = op.position.x - params.playerPos.x || 0.5;
        const pushZ = op.position.z - params.playerPos.z || 0.5;
        const pushLen = Math.max(0.01, Math.hypot(pushX, pushZ));
        goalX = op.position.x + (pushX / pushLen) * 1.8;
        goalZ = op.position.z + (pushZ / pushLen) * 1.8;
      } else if (
        directive.microState !== 'RESCUE_ALLY' &&
        directive.microState !== 'STABILIZE_ALLY' &&
        Math.abs(op.position.y - params.playerPos.y) < 1.8
      ) {
        const inMuzzleLane = computeCrossfireClearanceOffset({
          playerX: params.playerPos.x,
          playerZ: params.playerPos.z,
          playerForwardX: params.playerForward.x,
          playerForwardZ: params.playerForward.z,
          operatorX: op.position.x,
          operatorZ: op.position.z,
          outOffset: this.crossfireOffsetScratch,
        });
        if (inMuzzleLane) {
          goalX += this.crossfireOffsetScratch.x;
          goalZ += this.crossfireOffsetScratch.z;
        }
      }

      const dx = goalX - op.position.x;
      const dz = goalZ - op.position.z;
      const horizDist = Math.hypot(dx, dz);

      // Handle Medic Rescue or Non-Medic Stabilization when within triage range
      if (
        (directive.microState === 'RESCUE_ALLY' || directive.microState === 'STABILIZE_ALLY') &&
        directive.rescueAllyId
      ) {
        const ally = this.operators.find((a) => a.id === directive.rescueAllyId);
        if (ally && ally.state === 'DOWNED') {
          const allyDist = op.position.distanceTo(ally.position);
          if (allyDist <= 2.6) {
            op.state = directive.microState;
            ally.stabilizedTimerSec = Math.max(ally.stabilizedTimerSec, 0.5);

            if (directive.microState === 'RESCUE_ALLY') {
              const triageBonus = op.record.unlockedSpecializations.includes('combat_triage') ? 0.88 : 1.0;
              const requiredSec = MEDIC_REVIVE_CHANNEL_SEC * triageBonus;
              op.revivingTargetId = ally.id;
              op.reviveChannelSec += safeDt;
              if (op.reviveChannelSec >= requiredSec && op.reviveChargesRemaining > 0) {
                op.reviveChargesRemaining--;
                op.revivesThisOp++;
                const hpFrac = op.record.unlockedSpecializations.includes('combat_triage') ? 0.65 : 0.55;
                this.completeOperatorRevive(ally, hpFrac);
                op.revivingTargetId = null;
                op.reviveChannelSec = 0;
                this.pendingTelemetry.medicRevivesThisTick += 1;
                this.pendingTelemetry.revivedEventsThisTick.push({
                  operatorId: ally.id,
                  callsign: ally.record.callsign,
                  role: ally.role,
                  byMedic: true,
                  rescuerCallsign: op.record.callsign,
                });
                this.emitCallout(
                  `${op.record.callsign} revived ${ally.record.callsign}! (${op.reviveChargesRemaining} med charges left)`,
                  true
                );
              }
            } else {
              // Emergency Stabilization pauses bleedout for 10s while covering
              ally.stabilizedTimerSec = Math.max(ally.stabilizedTimerSec, STABILIZE_DURATION_SEC);
              this.emitCallout(
                `${op.record.callsign} stabilized ${ally.record.callsign} — commander triage needed!`
              );
              this.tryOperatorFire(op, directive, params.enemies);
            }
            this.syncOperatorRig(op, safeDt, params.enemies);
            continue;
          }
        }
      }

      // Handle Vehicle Boarding when close enough
      if (directive.microState === 'BOARD_VEHICLE' && directive.boardVehicleId) {
        const veh = params.vehicles.find((v) => v.id === directive.boardVehicleId);
        if (veh && veh.alive && !veh.hostile && op.position.distanceTo(veh.position) <= 4.2) {
          if (veh.tryBoardSeat(op.id)) {
            op.inVehicleId = veh.id;
            op.state = 'IN_VEHICLE';
            op.position.set(veh.position.x, veh.position.y + 1.1, veh.position.z);
            this.emitCallout(`${op.record.callsign} mounted vehicle.`);
            this.syncOperatorRig(op, safeDt);
            continue;
          }
        }
      }

      const stopRadius = directive.microState === 'HOLD_COVER' ? 1.0 : 1.35;
      const shouldMove = horizDist > stopRadius;
      const moveSpeed =
        directive.microState === 'RESCUE_ALLY' ? arch.moveSpeedMps * 1.12 : arch.moveSpeedMps;

      // Authoritative Stage 5A physics-compliant locomotion (continuous gravity, 3-ray whiskers, 3D separation)
      const stepRes = stepEnemyLocomotion(
        op,
        dx,
        dz,
        moveSpeed,
        shouldMove,
        safeDt,
        params.collision,
        this.operators,
        this.whiskerRayHitScratch,
        this.moveResultScratch
      );

      if (directive.microState !== 'DOWNED' && directive.microState !== 'MIA') {
        op.state = op.recoveryHoldSec > 0 ? 'RECOVER_UNREACHABLE' : directive.microState;
      }

      // Explicit Unreachable-Anchor Fallback Policy (NEVER arbitrary teleport!)
      if (shouldMove && (op.stuckTimerSec ?? 0) >= UNREACHABLE_STUCK_THRESHOLD_SEC) {
        op.stuckTimerSec = 0;
        op.unreachableFallbackCount++;
        // Choose deterministic lateral tangent + backoff recovery anchor so corners,
        // stair rails, and rooftop edges clear cleanly without ever teleporting.
        const invDist = 1 / Math.max(0.5, horizDist);
        const fwdX = dx * invDist;
        const fwdZ = dz * invDist;
        const sideSign = op.unreachableFallbackCount % 2 === 0 ? 1 : -1;
        const tangentX = -fwdZ * sideSign;
        const tangentZ = fwdX * sideSign;
        const backScale = stepRes.hitWall ? 1.8 : 0.7;
        const sideScale = stepRes.hitWall ? 1.35 : 2.0;
        op.recoveryAnchorX = op.position.x - fwdX * backScale + tangentX * sideScale;
        op.recoveryAnchorY = op.position.y;
        op.recoveryAnchorZ = op.position.z - fwdZ * backScale + tangentZ * sideScale;
        op.recoveryHoldSec = 2.4;
        op.state = 'RECOVER_UNREACHABLE';
        this.emitCallout(
          `${op.record.callsign}: Route blocked — holding nearest overwatch cover.`
        );
      }

      const tickDisp = Math.hypot(
        op.position.x - prevX,
        op.position.y - prevY,
        op.position.z - prevZ
      );
      if (tickDisp > maxDisplacementThisTick) {
        maxDisplacementThisTick = tickDisp;
      }

      // Engage threats according to role utility & suppression discipline
      const fired = this.tryOperatorFire(op, directive, params.enemies);
      if (fired && (op.role === 'support' || directive.suppressFire)) {
        friendlySuppressorActive = true;
      }

      this.syncOperatorRig(op, safeDt, params.enemies);
    }

    // 7. Update command beacons
    for (let i = 0; i < this.beacons.length; i++) {
      const b = this.beacons[i];
      if (!b.active) continue;
      b.ttlSec -= safeDt;
      b.ring.rotation.z += safeDt * 1.8;
      if (b.ttlSec <= 0) {
        b.active = false;
        b.root.visible = false;
      } else if (b.ttlSec < 1.0) {
        b.material.opacity = Math.max(0, b.ttlSec * 0.78);
      }
    }

    const telemetrySnapshot: SquadTelemetryEventBatch = {
      commandLatencySamplesMs: [...this.pendingTelemetry.commandLatencySamplesMs],
      medicRevivesThisTick: this.pendingTelemetry.medicRevivesThisTick,
      playerRevivesThisTick: this.pendingTelemetry.playerRevivesThisTick,
      downedEventsThisTick: [...this.pendingTelemetry.downedEventsThisTick],
      miaEventsThisTick: [...this.pendingTelemetry.miaEventsThisTick],
      revivedEventsThisTick: [...this.pendingTelemetry.revivedEventsThisTick],
    };
    this.resetPendingTelemetry();

    return {
      fireRequests: this.fireRequestsScratch,
      radioCallout: this.pendingCallout,
      friendlySuppressorActive,
      navSolvesThisTick,
      maxDisplacementThisTick,
      hudSummary: this.buildHudSummary(params.playerPos),
      telemetryEvents: telemetrySnapshot,
    };
  }

  private tryOperatorFire(
    op: FriendlyOperatorRuntime,
    directive: OperatorTacticalDirective,
    enemies: readonly SquadEnemyReadView[]
  ): boolean {
    if (op.fireCooldownSec > 0 || !directive.focusEnemyId) return false;
    const mapped = this.enemyByIdScratch.get(directive.focusEnemyId);
    const target =
      mapped && mapped.alive
        ? mapped
        : enemies.find((e) => e.id === directive.focusEnemyId && e.alive);
    if (!target || !target.alive) return false;

    const arch = SQUAD_ARCHETYPE_FLYWEIGHTS[op.role];
    const dist = op.position.distanceTo(target.position);
    if (dist > arch.preferredRangeMax * 1.35) return false;

    // Modest field specialization bonus (+8%..+12%)
    const specMult =
      (op.role === 'assault' && op.record.unlockedSpecializations.includes('breach_specialist')) ||
      (op.role === 'anti_armor' && op.record.unlockedSpecializations.includes('ordnance_expert'))
        ? 1.09
        : 1.0;

    const baseDamage =
      op.role === 'anti_armor'
        ? target.isArmoredOrVehicle
          ? 42
          : 18
        : op.role === 'recon'
          ? 28
          : op.role === 'support'
            ? 14
            : 17;

    const cooldown =
      op.role === 'support'
        ? 0.45
        : op.role === 'anti_armor'
          ? 1.65
          : op.role === 'recon'
            ? 1.25
            : 0.65;

    op.fireCooldownSec = cooldown;
    op.muzzleFlashTimerSec = 0.08;
    if (directive.suppressFire || op.role === 'support') {
      op.suppressionAssistsThisOp++;
    }

    this.fireRequestsScratch.push({
      operatorId: op.id,
      role: op.role,
      enemyId: target.id,
      originX: op.position.x,
      originY: op.position.y + 1.4,
      originZ: op.position.z,
      damage: Math.round(baseDamage * specMult),
      isAntiArmor: op.role === 'anti_armor',
      suppressionPower: arch.suppressionPower,
    });

    return true;
  }

  recordOperatorKill(operatorId: string, wasArmoredOrVehicle = false): void {
    const op = this.operators.find((o) => o.id === operatorId);
    if (!op) return;
    op.killsThisOp++;
    if (wasArmoredOrVehicle) {
      op.vehiclesDisabledThisOp++;
    }
  }

  private measureCorridorWidth(
    collision: CollisionWorld,
    x: number,
    y: number,
    z: number,
    fwdX: number,
    fwdZ: number
  ): number {
    const len = Math.hypot(fwdX, fwdZ);
    const fx = len > 1e-4 ? fwdX / len : 0;
    const fz = len > 1e-4 ? fwdZ / len : -1;
    const rx = -fz;
    const rz = fx;
    const probeDist = 3.2;

    const hitR = collision.sweptSegmentTest(
      x,
      y,
      z,
      rx,
      0,
      rz,
      probeDist,
      PHYSICS_MASKS.CHARACTER_SOLID,
      this.whiskerRayHitScratch
    );
    const distR = hitR ? this.whiskerRayHitScratch.distance : probeDist;

    const hitL = collision.sweptSegmentTest(
      x,
      y,
      z,
      -rx,
      0,
      -rz,
      probeDist,
      PHYSICS_MASKS.CHARACTER_SOLID,
      this.whiskerRayHitScratch
    );
    const distL = hitL ? this.whiskerRayHitScratch.distance : probeDist;

    return distL + distR;
  }

  private buildPlannerSnapshots(): void {
    this.plannerSnapshotsScratch.length = this.operators.length;
    for (let i = 0; i < this.operators.length; i++) {
      const op = this.operators[i];
      const healthRatio = op.maxHealth > 0 ? op.health / op.maxHealth : 0;
      const isDowned = op.state === 'DOWNED';
      const isMia = op.state === 'MIA';
      let snap = this.plannerSnapshotsScratch[i];
      if (!snap) {
        snap = {
          id: op.id,
          role: op.role,
          x: op.position.x,
          y: op.position.y,
          z: op.position.z,
          healthRatio,
          suppressionLevel: op.suppressionLevel,
          morale: op.morale,
          state: op.state,
          reviveChargesRemaining: op.reviveChargesRemaining,
          inVehicleId: op.inVehicleId,
          stuckTimerSec: op.stuckTimerSec ?? 0,
          isDowned,
          isMia,
          bleedoutRemainingSec: op.bleedoutRemainingSec,
        };
        this.plannerSnapshotsScratch[i] = snap;
      } else {
        snap.id = op.id;
        snap.role = op.role;
        snap.x = op.position.x;
        snap.y = op.position.y;
        snap.z = op.position.z;
        snap.healthRatio = healthRatio;
        snap.suppressionLevel = op.suppressionLevel;
        snap.morale = op.morale;
        snap.state = op.state;
        snap.reviveChargesRemaining = op.reviveChargesRemaining;
        snap.inVehicleId = op.inVehicleId;
        snap.stuckTimerSec = op.stuckTimerSec ?? 0;
        snap.isDowned = isDowned;
        snap.isMia = isMia;
        snap.bleedoutRemainingSec = op.bleedoutRemainingSec;
      }
    }
  }

  private syncOperatorRig(
    op: FriendlyOperatorRuntime,
    dt: number,
    enemies?: readonly SquadEnemyReadView[]
  ): void {
    if (!op.rig) return;
    op.rig.root.visible = op.state !== 'MIA' && op.state !== 'IN_VEHICLE';
    if (!op.rig.root.visible) return;

    op.rig.root.position.copy(op.position);

    if (op.state === 'DOWNED') {
      op.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(
        op.rig.bodyGroup.rotation.x,
        Math.PI * 0.44,
        10,
        dt
      );
      op.rig.bodyGroup.position.y = THREE.MathUtils.damp(
        op.rig.bodyGroup.position.y,
        -0.35,
        10,
        dt
      );
      op.rig.statusHaloMat.color.setHex(0xef4444);
      const pulse = 1 + Math.sin(this.nowSec * 7.5) * 0.16;
      op.rig.statusHalo.scale.set(pulse, pulse, 1);
      op.rig.statusHaloMat.opacity = 0.82;
      op.rig.muzzleFlash.visible = false;
      return;
    }

    // Target combat stance posture (crouch in cover/suppression, kneel in triage)
    let targetBodyY = 0;
    let targetBodyPitch = 0;
    if (op.state === 'RESCUE_ALLY' || op.state === 'STABILIZE_ALLY') {
      targetBodyY = -0.32;
      targetBodyPitch = 0.24;
    } else if (op.state === 'HOLD_COVER' || op.state === 'SUPPRESS_SECTOR') {
      targetBodyY = -0.22;
      targetBodyPitch = 0.08;
    }

    op.stanceOffsetY = THREE.MathUtils.damp(op.stanceOffsetY, targetBodyY, 9, dt);
    op.rig.bodyGroup.position.y = op.stanceOffsetY;
    op.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(
      op.rig.bodyGroup.rotation.x,
      targetBodyPitch,
      9,
      dt
    );

    // Command acknowledgement pulse on tactical floor halo
    if (op.ackPulseTimerSec > 0) {
      const t = 1 - op.ackPulseTimerSec / 1.15;
      const pulseScale = 1.0 + Math.sin(t * Math.PI) * 0.48;
      op.rig.statusHalo.scale.set(pulseScale, pulseScale, 1);
      op.rig.statusHaloMat.color.setHex(0x38bdf8);
      op.rig.statusHaloMat.opacity = 0.92;
    } else {
      op.rig.statusHalo.scale.set(1, 1, 1);
      op.rig.statusHaloMat.color.setHex(
        op.morale === 'SHAKEN' ? 0xf59e0b : op.rig.baseHaloColorHex
      );
      op.rig.statusHaloMat.opacity = 0.65;
    }

    // Muzzle flash & damped rifle recoil kick
    op.rig.muzzleFlash.visible = op.muzzleFlashTimerSec > 0;
    const targetRecoil = op.muzzleFlashTimerSec > 0 ? -0.11 : 0;
    op.recoilOffsetZ = THREE.MathUtils.damp(op.recoilOffsetZ, targetRecoil, 20, dt);
    op.rig.rifle.position.z = 0.36 + op.recoilOffsetZ;

    // Stride cycle & smooth combat facing toward threat or movement heading
    const speed = op.actualHorizSpeed ?? 0;
    if (speed > 0.25) {
      const phase = this.nowSec * 9.5;
      const swing = Math.sin(phase) * 0.42;
      op.rig.leftLeg.rotation.x = swing;
      op.rig.rightLeg.rotation.x = -swing;
      op.rig.leftArm.rotation.x = -swing * 0.35;
      op.rig.root.rotation.y = Math.atan2(op.velocity.x, op.velocity.z);
    } else {
      op.rig.leftLeg.rotation.x = THREE.MathUtils.damp(op.rig.leftLeg.rotation.x, 0, 12, dt);
      op.rig.rightLeg.rotation.x = THREE.MathUtils.damp(op.rig.rightLeg.rotation.x, 0, 12, dt);
      op.rig.leftArm.rotation.x = THREE.MathUtils.damp(op.rig.leftArm.rotation.x, 0, 12, dt);
      // Aim smoothly toward active focus threat when stationary in cover or suppressing
      const focusId = op.lastDirective?.focusEnemyId;
      if (focusId && enemies) {
        const mapped = this.enemyByIdScratch.get(focusId);
        const threat = mapped && mapped.alive ? mapped : enemies.find((e) => e.id === focusId && e.alive);
        if (threat && threat.alive) {
          const aimYaw = Math.atan2(
            threat.position.x - op.position.x,
            threat.position.z - op.position.z
          );
          op.rig.root.rotation.y = aimYaw;
        }
      }
    }
  }

  private buildHudSummary(playerPos: THREE.Vector3): SquadHudSummary {
    const intent = this.intentRouter.getSquadWideIntent();
    let downedCount = 0;
    let nearestDownedId: string | null = null;
    let nearestDownedDist = Infinity;

    const ops: FriendlyOperatorHudState[] = this.operators.map((op) => {
      const arch = SQUAD_ARCHETYPE_FLYWEIGHTS[op.role];
      const dist = op.position.distanceTo(playerPos);
      if (op.state === 'DOWNED') {
        downedCount++;
        if (dist < nearestDownedDist) {
          nearestDownedDist = dist;
          nearestDownedId = op.id;
        }
      }
      return {
        id: op.id,
        callsign: op.record.callsign,
        role: op.role,
        roleBadge: arch.shortBadge,
        health: Math.ceil(op.health),
        maxHealth: op.maxHealth,
        armor: Math.ceil(op.armor),
        maxArmor: op.maxArmor,
        state: op.state,
        morale: op.morale,
        suppressionLevel: Number(op.suppressionLevel.toFixed(2)),
        reasonTag: op.lastDirective?.reasonTag ?? `Formation: ${this.activeFormation}`,
        bleedoutRemainingSec: Number(op.bleedoutRemainingSec.toFixed(1)),
        reviveProgress:
          this.playerRevivingOperatorId === op.id
            ? Math.min(1, this.playerReviveProgressSec / PLAYER_REVIVE_CHANNEL_SEC)
            : 0,
        reviveChargesRemaining: op.reviveChargesRemaining,
        inVehicleId: op.inVehicleId,
        isReserve: op.isReserve,
        distanceToPlayerM: Math.round(dist),
      };
    });

    return {
      activeOrderLabel: intent?.label ?? `Formation: ${this.activeFormation}`,
      activeFormation: this.activeFormation,
      squadMedCharges: this.squadMedCharges,
      operators: ops,
      downedCount,
      nearestDownedOperatorId: nearestDownedId,
      nearestDownedDistanceM: Number.isFinite(nearestDownedDist) ? Number(nearestDownedDist.toFixed(1)) : 999,
      playerRevivingOperatorId: this.playerRevivingOperatorId,
      playerReviveProgress:
        this.playerRevivingOperatorId !== null
          ? Math.min(1, this.playerReviveProgressSec / PLAYER_REVIVE_CHANNEL_SEC)
          : 0,
    };
  }

  getOperators(): readonly FriendlyOperatorRuntime[] {
    return this.operators;
  }

  getActiveFormation(): SquadFormationType {
    return this.activeFormation;
  }

  getActiveOrderPingTarget(): { x: number; y: number; z: number; label: string } | null {
    const intent = this.intentRouter.getSquadWideIntent();
    if (!intent || !intent.hasWorldAnchor) return null;
    if (intent.order === 'FOLLOW' || intent.order === 'REGROUP' || intent.order === 'EXIT_VEHICLE') {
      return null;
    }
    return {
      x: intent.anchorX,
      y: intent.anchorY,
      z: intent.anchorZ,
      label: intent.label,
    };
  }

  buildMissionReports(): SquadOperatorMissionReport[] {
    return this.operators.map((op) => ({
      operatorId: op.id,
      callsign: op.record.callsign,
      role: op.role,
      deployed: true,
      survived: op.state !== 'MIA',
      becameMia: op.state === 'MIA',
      timesDowned: op.timesDownedThisOp,
      severeInjury: op.severeInjury,
      kills: op.killsThisOp,
      revivesPerformed: op.revivesThisOp,
      vehiclesDisabled: op.vehiclesDisabledThisOp,
      spotsMarked: op.spotsMarkedThisOp,
      suppressionAssists: op.suppressionAssistsThisOp,
    }));
  }
}
