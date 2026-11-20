import { SQUAD_ARCHETYPE_FLYWEIGHTS } from '@/src/data/squadRoster';
import { SquadRoleId } from '@/src/schemas/campaign.schema';
import { SquadFormationType } from './SquadFormationSolver';
import { ValidatedSquadIntent } from './SquadIntentRouter';

export type OperatorMicroState =
  | 'EXECUTE_FORMATION'
  | 'HOLD_COVER'
  | 'SUPPRESS_SECTOR'
  | 'FLANK_APPROACH'
  | 'ENGAGE_TARGET'
  | 'RESCUE_ALLY'
  | 'STABILIZE_ALLY'
  | 'BOARD_VEHICLE'
  | 'IN_VEHICLE'
  | 'RECOVER_UNREACHABLE'
  | 'DOWNED'
  | 'MIA';

export type OperatorMoraleState = 'STEADY' | 'SUPPRESSED' | 'SHAKEN';

export interface SharedFriendlyThreatEntry {
  enemyId: string;
  x: number;
  y: number;
  z: number;
  isArmoredOrVehicle: boolean;
  isElevated: boolean;
  spottedByOperatorId: string;
  ageSec: number;
}

export interface PlannerOperatorSnapshot {
  id: string;
  role: SquadRoleId;
  x: number;
  y: number;
  z: number;
  healthRatio: number;
  suppressionLevel: number; // 0..1
  morale: OperatorMoraleState;
  state: OperatorMicroState;
  reviveChargesRemaining: number;
  inVehicleId: string | null;
  stuckTimerSec: number;
  isDowned: boolean;
  isMia: boolean;
  bleedoutRemainingSec: number;
}

export interface OperatorTacticalDirective {
  operatorId: string;
  microState: OperatorMicroState;
  targetPosX: number;
  targetPosY: number;
  targetPosZ: number;
  focusEnemyId: string | null;
  rescueAllyId: string | null;
  boardVehicleId: string | null;
  preferCover: boolean;
  suppressFire: boolean;
  flankSideSign: -1 | 0 | 1;
  formation: SquadFormationType;
  reasonTag: string;
}

/**
 * Shared Friendly Squad Awareness Board (TRN-37).
 * When any operator (especially Recon) spots a threat, all squadmates share the sighting cleanly.
 */
export class SharedFriendlyThreatBoard {
  private readonly threats = new Map<string, SharedFriendlyThreatEntry>();

  reset(): void {
    this.threats.clear();
  }

  reportThreat(entry: Omit<SharedFriendlyThreatEntry, 'ageSec'>): void {
    this.threats.set(entry.enemyId, { ...entry, ageSec: 0 });
  }

  update(dt: number, aliveEnemyIds: ReadonlySet<string>): void {
    for (const [id, entry] of this.threats.entries()) {
      if (!aliveEnemyIds.has(id)) {
        this.threats.delete(id);
        continue;
      }
      entry.ageSec += dt;
      if (entry.ageSec > 10.0) {
        this.threats.delete(id);
      }
    }
  }

  getAllThreats(): SharedFriendlyThreatEntry[] {
    return Array.from(this.threats.values());
  }

  selectBestThreatForRole(
    role: SquadRoleId,
    opX: number,
    opZ: number,
    preferredEnemyId: string | null
  ): SharedFriendlyThreatEntry | null {
    if (preferredEnemyId) {
      const direct = this.threats.get(preferredEnemyId);
      if (direct) return direct;
    }

    let best: SharedFriendlyThreatEntry | null = null;
    let bestScore = -Infinity;

    for (const t of this.threats.values()) {
      const dist = Math.hypot(t.x - opX, t.z - opZ);
      let score = Math.max(0, 80 - dist);

      // Role-based tactical target selection
      if (role === 'anti_armor' && t.isArmoredOrVehicle) score += 75;
      if (role === 'recon' && (t.isElevated || dist > 26)) score += 45;
      if (role === 'support') score += 20; // prioritizes pinning active closest clusters
      if (role === 'assault' && dist < 35) score += 30;
      if (role === 'medic' && dist < 24) score += 18;

      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }

    return best;
  }
}

/**
 * Pure role-based Hybrid Utility + FSM Tactical Directive Evaluator (TRN-37).
 * Translates player tactical intent into coordinated, role-appropriate execution without micromanagement:
 * - Medic prioritizes rescuing/stabilizing downed allies (and stays in cover when under heavy fire).
 * - If Medic is downed/MIA, the nearest healthy teammate applies Emergency Stabilization if safe.
 * - On ATTACK_TARGET / FLANK: Support pins from cover, Assault flanks laterally, Recon holds overwatch, Anti-Armor focuses armor.
 * - Suppressed/shaken operators prefer cover over exposed charges.
 */
export function evaluateOperatorDirective(params: {
  operator: PlannerOperatorSnapshot;
  allOperators: readonly PlannerOperatorSnapshot[];
  intent: ValidatedSquadIntent | null;
  formationSlot: { x: number; y: number; z: number; formation: SquadFormationType };
  playerPos: { x: number; y: number; z: number };
  threatBoard: SharedFriendlyThreatBoard;
  slotIndex: number;
  playerRevivingOperatorId?: string | null;
}): OperatorTacticalDirective {
  const {
    operator,
    allOperators,
    intent,
    formationSlot,
    playerPos,
    threatBoard,
    slotIndex,
    playerRevivingOperatorId = null,
  } = params;
  const archetype = SQUAD_ARCHETYPE_FLYWEIGHTS[operator.role];

  if (operator.isMia) {
    return {
      operatorId: operator.id,
      microState: 'MIA',
      targetPosX: operator.x,
      targetPosY: operator.y,
      targetPosZ: operator.z,
      focusEnemyId: null,
      rescueAllyId: null,
      boardVehicleId: null,
      preferCover: false,
      suppressFire: false,
      flankSideSign: 0,
      formation: formationSlot.formation,
      reasonTag: 'MIA',
    };
  }

  if (operator.isDowned) {
    return {
      operatorId: operator.id,
      microState: 'DOWNED',
      targetPosX: operator.x,
      targetPosY: operator.y,
      targetPosZ: operator.z,
      focusEnemyId: null,
      rescueAllyId: null,
      boardVehicleId: null,
      preferCover: true,
      suppressFire: false,
      flankSideSign: 0,
      formation: formationSlot.formation,
      reasonTag: 'Downed — Awaiting Triage',
    };
  }

  // 1. Casualty Triage Priority (Medic autonomous revive, avoiding redundant overlap when player is rescuing)
  const downedAllies = allOperators
    .filter((a) => a.id !== operator.id && a.isDowned && !a.isMia)
    .sort((a, b) => a.bleedoutRemainingSec - b.bleedoutRemainingSec);

  const unattendedDownedAllies = downedAllies.filter((a) => a.id !== playerRevivingOperatorId);

  const healthyMedicAvailable = allOperators.some(
    (a) => a.role === 'medic' && !a.isDowned && !a.isMia && a.reviveChargesRemaining > 0
  );

  if (unattendedDownedAllies.length > 0 && !operator.inVehicleId) {
    const urgentAlly = unattendedDownedAllies[0];
    const distToAlly = Math.hypot(urgentAlly.x - operator.x, urgentAlly.z - operator.z);

    if (
      operator.role === 'medic' &&
      operator.reviveChargesRemaining > 0 &&
      operator.morale !== 'SHAKEN' &&
      distToAlly <= 42
    ) {
      return {
        operatorId: operator.id,
        microState: 'RESCUE_ALLY',
        targetPosX: urgentAlly.x,
        targetPosY: urgentAlly.y,
        targetPosZ: urgentAlly.z,
        focusEnemyId: null,
        rescueAllyId: urgentAlly.id,
        boardVehicleId: null,
        preferCover: true,
        suppressFire: false,
        flankSideSign: 0,
        formation: 'COMPACT',
        reasonTag: 'Medic Triage Rescue',
      };
    }

    // If Medic is down/MIA or out of charges, nearest healthy companion provides emergency stabilization
    if (!healthyMedicAvailable && distToAlly <= 24 && operator.healthRatio > 0.4) {
      const closestHealthy = allOperators
        .filter((a) => !a.isDowned && !a.isMia && !a.inVehicleId)
        .sort(
          (a, b) =>
            Math.hypot(a.x - urgentAlly.x, a.z - urgentAlly.z) -
            Math.hypot(b.x - urgentAlly.x, b.z - urgentAlly.z)
        )[0];

      if (closestHealthy && closestHealthy.id === operator.id) {
        return {
          operatorId: operator.id,
          microState: 'STABILIZE_ALLY',
          targetPosX: urgentAlly.x,
          targetPosY: urgentAlly.y,
          targetPosZ: urgentAlly.z,
          focusEnemyId: null,
          rescueAllyId: urgentAlly.id,
          boardVehicleId: null,
          preferCover: true,
          suppressFire: true,
          flankSideSign: 0,
          formation: 'COMPACT',
          reasonTag: 'Emergency Stabilization',
        };
      }
    }
  } else if (
    downedAllies.length > 0 &&
    unattendedDownedAllies.length === 0 &&
    operator.role === 'medic' &&
    !operator.inVehicleId
  ) {
    // Player is actively reviving the only downed ally -> Medic provides immediate covering fire around triage site
    const coverThreat = threatBoard.selectBestThreatForRole(operator.role, operator.x, operator.z, null);
    return {
      operatorId: operator.id,
      microState: coverThreat ? 'SUPPRESS_SECTOR' : 'HOLD_COVER',
      targetPosX: formationSlot.x,
      targetPosY: formationSlot.y,
      targetPosZ: formationSlot.z,
      focusEnemyId: coverThreat?.enemyId ?? null,
      rescueAllyId: null,
      boardVehicleId: null,
      preferCover: true,
      suppressFire: Boolean(coverThreat),
      flankSideSign: 0,
      formation: 'COMPACT',
      reasonTag: 'Covering Commander Triage',
    };
  }

  // 2. Vehicle Boarding / Staying Seated / Dismounting
  if (intent?.order === 'BOARD_VEHICLE' && intent.targetVehicleId) {
    if (operator.inVehicleId === intent.targetVehicleId) {
      const target = threatBoard.selectBestThreatForRole(operator.role, operator.x, operator.z, null);
      return {
        operatorId: operator.id,
        microState: 'IN_VEHICLE',
        targetPosX: intent.anchorX,
        targetPosY: intent.anchorY,
        targetPosZ: intent.anchorZ,
        focusEnemyId: target?.enemyId ?? null,
        rescueAllyId: null,
        boardVehicleId: intent.targetVehicleId,
        preferCover: false,
        suppressFire: Boolean(target),
        flankSideSign: 0,
        formation: 'COMPACT',
        reasonTag: 'Vehicle Crew Active',
      };
    }
    return {
      operatorId: operator.id,
      microState: 'BOARD_VEHICLE',
      targetPosX: intent.anchorX,
      targetPosY: intent.anchorY,
      targetPosZ: intent.anchorZ,
      focusEnemyId: null,
      rescueAllyId: null,
      boardVehicleId: intent.targetVehicleId,
      preferCover: false,
      suppressFire: false,
      flankSideSign: 0,
      formation: 'COMPACT',
      reasonTag: 'Moving to Board Vehicle',
    };
  }

  if (operator.inVehicleId && intent?.order !== 'EXIT_VEHICLE') {
    const target = threatBoard.selectBestThreatForRole(operator.role, operator.x, operator.z, intent?.targetEnemyId ?? null);
    return {
      operatorId: operator.id,
      microState: 'IN_VEHICLE',
      targetPosX: operator.x,
      targetPosY: operator.y,
      targetPosZ: operator.z,
      focusEnemyId: target?.enemyId ?? null,
      rescueAllyId: null,
      boardVehicleId: operator.inVehicleId,
      preferCover: false,
      suppressFire: Boolean(target),
      flankSideSign: 0,
      formation: 'COMPACT',
      reasonTag: 'Mounted Vehicle Overwatch',
    };
  }

  const bestThreat = threatBoard.selectBestThreatForRole(
    operator.role,
    operator.x,
    operator.z,
    intent?.targetEnemyId ?? null
  );

  // 3. Heavy Suppression / Low Health Cover Preservation (never charge blindly into open crossfire)
  if (operator.morale === 'SHAKEN' || (operator.suppressionLevel >= 0.72 && operator.healthRatio < 0.55)) {
    return {
      operatorId: operator.id,
      microState: 'HOLD_COVER',
      targetPosX: operator.x,
      targetPosY: operator.y,
      targetPosZ: operator.z,
      focusEnemyId: bestThreat?.enemyId ?? null,
      rescueAllyId: null,
      boardVehicleId: null,
      preferCover: true,
      suppressFire: operator.role === 'support',
      flankSideSign: 0,
      formation: 'COMPACT',
      reasonTag: 'Suppressed — Holding Hard Cover',
    };
  }

  // 4. Intent-Driven Role Coordination
  const activeOrder = intent?.order ?? 'FOLLOW';

  if (activeOrder === 'HOLD' || activeOrder === 'DEFEND') {
    return {
      operatorId: operator.id,
      microState: 'HOLD_COVER',
      targetPosX: intent?.hasWorldAnchor ? intent.anchorX + (slotIndex - 1) * 2.4 : formationSlot.x,
      targetPosY: intent?.hasWorldAnchor ? intent.anchorY : formationSlot.y,
      targetPosZ: intent?.hasWorldAnchor ? intent.anchorZ + (slotIndex % 2 === 0 ? 1.2 : -1.2) : formationSlot.z,
      focusEnemyId: bestThreat?.enemyId ?? null,
      rescueAllyId: null,
      boardVehicleId: null,
      preferCover: true,
      suppressFire: activeOrder === 'DEFEND' || operator.role === 'support',
      flankSideSign: 0,
      formation: 'LINE',
      reasonTag: activeOrder === 'DEFEND' ? 'Defensive Perimeter' : 'Holding Cover',
    };
  }

  if (activeOrder === 'SUPPRESS') {
    return {
      operatorId: operator.id,
      microState: 'SUPPRESS_SECTOR',
      targetPosX: formationSlot.x,
      targetPosY: formationSlot.y,
      targetPosZ: formationSlot.z,
      focusEnemyId: bestThreat?.enemyId ?? null,
      rescueAllyId: null,
      boardVehicleId: null,
      preferCover: true,
      suppressFire: true,
      flankSideSign: 0,
      formation: 'LINE',
      reasonTag: 'Suppressing Target Sector',
    };
  }

  if (activeOrder === 'FLANK' || activeOrder === 'ATTACK_TARGET') {
    const targetX = bestThreat ? bestThreat.x : (intent?.anchorX ?? formationSlot.x);
    const targetY = bestThreat ? bestThreat.y : (intent?.anchorY ?? formationSlot.y);
    const targetZ = bestThreat ? bestThreat.z : (intent?.anchorZ ?? formationSlot.z);

    // Role coordination: Support suppresses from cover, Recon holds long-range overwatch,
    // Assault executes lateral flank, Anti-Armor seeks firing lane at preferred range.
    if (operator.role === 'support') {
      return {
        operatorId: operator.id,
        microState: 'SUPPRESS_SECTOR',
        targetPosX: formationSlot.x,
        targetPosY: formationSlot.y,
        targetPosZ: formationSlot.z,
        focusEnemyId: bestThreat?.enemyId ?? intent?.targetEnemyId ?? null,
        rescueAllyId: null,
        boardVehicleId: null,
        preferCover: true,
        suppressFire: true,
        flankSideSign: 0,
        formation: 'LINE',
        reasonTag: 'Support Pinning Fire',
      };
    }

    if (operator.role === 'recon') {
      return {
        operatorId: operator.id,
        microState: 'ENGAGE_TARGET',
        targetPosX: formationSlot.x,
        targetPosY: formationSlot.y,
        targetPosZ: formationSlot.z,
        focusEnemyId: bestThreat?.enemyId ?? intent?.targetEnemyId ?? null,
        rescueAllyId: null,
        boardVehicleId: null,
        preferCover: true,
        suppressFire: false,
        flankSideSign: 0,
        formation: 'OVERWATCH',
        reasonTag: 'Recon Bounding Overwatch',
      };
    }

    if (operator.role === 'medic') {
      return {
        operatorId: operator.id,
        microState: 'HOLD_COVER',
        targetPosX: formationSlot.x,
        targetPosY: formationSlot.y,
        targetPosZ: formationSlot.z,
        focusEnemyId: bestThreat?.enemyId ?? intent?.targetEnemyId ?? null,
        rescueAllyId: null,
        boardVehicleId: null,
        preferCover: true,
        suppressFire: false,
        flankSideSign: 0,
        formation: formationSlot.formation,
        reasonTag: 'Medic Cover Overwatch',
      };
    }

    const dx = targetX - playerPos.x;
    const dz = targetZ - playerPos.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const flankSide: -1 | 1 = slotIndex % 2 === 0 ? 1 : -1;
    const perpX = (-dz / dist) * flankSide;
    const perpZ = (dx / dist) * flankSide;
    const desiredStandOff = Math.max(archetype.preferredRangeMin, Math.min(archetype.preferredRangeMax * 0.65, dist * 0.65));
    const flankX = targetX - (dx / dist) * desiredStandOff + perpX * 8.5;
    const flankZ = targetZ - (dz / dist) * desiredStandOff + perpZ * 8.5;

    return {
      operatorId: operator.id,
      microState: activeOrder === 'FLANK' ? 'FLANK_APPROACH' : 'ENGAGE_TARGET',
      targetPosX: flankX,
      targetPosY: targetY,
      targetPosZ: flankZ,
      focusEnemyId: bestThreat?.enemyId ?? intent?.targetEnemyId ?? null,
      rescueAllyId: null,
      boardVehicleId: null,
      preferCover: true,
      suppressFire: false,
      flankSideSign: flankSide,
      formation: 'WEDGE',
      reasonTag: activeOrder === 'FLANK' ? 'Coordinated Lateral Flank' : 'Role Assault Push',
    };
  }

  if (activeOrder === 'MOVE' && intent?.hasWorldAnchor) {
    return {
      operatorId: operator.id,
      microState: 'EXECUTE_FORMATION',
      targetPosX: intent.anchorX + (slotIndex - 1) * 1.9,
      targetPosY: intent.anchorY,
      targetPosZ: intent.anchorZ - slotIndex * 1.4,
      focusEnemyId: bestThreat?.enemyId ?? null,
      rescueAllyId: null,
      boardVehicleId: null,
      preferCover: false,
      suppressFire: false,
      flankSideSign: 0,
      formation: formationSlot.formation,
      reasonTag: 'Advancing to Waypoint',
    };
  }

  // Default: FOLLOW / REGROUP / EXIT_VEHICLE -> Dynamic Formation around player
  return {
    operatorId: operator.id,
    microState: 'EXECUTE_FORMATION',
    targetPosX: formationSlot.x,
    targetPosY: formationSlot.y,
    targetPosZ: formationSlot.z,
    focusEnemyId: bestThreat?.enemyId ?? null,
    rescueAllyId: null,
    boardVehicleId: null,
    preferCover: false,
    suppressFire: false,
    flankSideSign: 0,
    formation: formationSlot.formation,
    reasonTag: activeOrder === 'REGROUP' ? 'Regrouping on Commander' : `Formation: ${formationSlot.formation}`,
  };
}

/**
 * Bounded per-frame navigation/cover request scheduler (TRN-42 performance budget).
 * Guarantees at most `maxPerTick` (default 2) expensive path/cover recalculations per frame
 * without starving any operator.
 */
export class BoundedNavRequestScheduler {
  private readonly queue: string[] = [];
  private readonly queuedSet = new Set<string>();

  reset(): void {
    this.queue.length = 0;
    this.queuedSet.clear();
  }

  enqueue(unitId: string): void {
    if (this.queuedSet.has(unitId)) return;
    this.queuedSet.add(unitId);
    this.queue.push(unitId);
  }

  drainBatch(maxPerTick = 2): string[] {
    const out: string[] = [];
    const count = Math.min(maxPerTick, this.queue.length);
    for (let i = 0; i < count; i++) {
      const id = this.queue.shift()!;
      this.queuedSet.delete(id);
      out.push(id);
    }
    return out;
  }

  pendingCount(): number {
    return this.queue.length;
  }
}
