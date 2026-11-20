import { EnemyArchetype, SquadRole } from '@/src/schemas/enemy.schema';

export type SquadPosture =
  | 'SUPPRESS_AND_FLANK'
  | 'BOUNDING_ADVANCE'
  | 'DEFENSIVE_HOLD'
  | 'FALLBACK_REGROUP';

export type UnitTacticalOrderKind =
  | 'PIN_SUPPRESS'
  | 'FLANK_LEFT'
  | 'FLANK_RIGHT'
  | 'OVERWATCH_HOLD'
  | 'ANTI_ARMOR_FLUSH'
  | 'BACKLINE_DRONE_SUPPORT'
  | 'COVER_ADVANCE'
  | 'REGROUP_FALLBACK';

export interface SquadTacticalUnitInput {
  id: string;
  squadId: string;
  archetype: EnemyArchetype;
  role: SquadRole;
  alive: boolean;
  healthRatio: number;
  hasLos: boolean;
  isSuppressedOrHit: boolean;
  distanceToPlayer: number;
  elevationDelta: number;
  shotsFiredSinceRelocate: number;
}

export interface SquadTacticalOrder {
  unitId: string;
  squadId: string;
  squadPosture: SquadPosture;
  order: UnitTacticalOrderKind;
  preferredRangeMin: number;
  preferredRangeMax: number;
  flankAngleOffsetRad: number;
  preferCoverSeek: boolean;
  priorityTargetPlayerVehicle: boolean;
  shouldRelocateOverwatch: boolean;
  burstLengthBonus: number;
}

export interface SquadTacticalPlan {
  squadId: string;
  posture: SquadPosture;
  aliveCount: number;
  initialCount: number;
  casualtyRatio: number;
  hasSuppressorPinned: boolean;
  ordersByUnitId: Map<string, SquadTacticalOrder>;
}

/**
 * Deterministic squad-level tactical planner (TRN-31).
 * Evaluates all alive squadmates together and assigns complementary archetype orders:
 * - Heavy Armor / Convoy Gunners pin LKP with sustained suppression while Spec-Ops Raiders flank laterally.
 * - Recon Snipers maintain elevated overwatch and displace after 2+ shots or heavy suppression.
 * - AT-Specialists prioritize player vehicles or flush entrenched cover targets.
 * - Drone Operators stay behind cover in backline support while relaying sightings.
 * - Squads suffering >= 50% casualties shift to defensive cover-to-cover fallback rather than rushing blindly.
 */
export class SquadTacticsCoordinator {
  private readonly squadPeakCounts = new Map<string, number>();
  private readonly latestPlans = new Map<string, SquadTacticalPlan>();

  reset(): void {
    this.squadPeakCounts.clear();
    this.latestPlans.clear();
  }

  evaluateSquads(
    units: readonly SquadTacticalUnitInput[],
    playerInVehicle: boolean,
    playerBehindCover: boolean
  ): Map<string, SquadTacticalOrder> {
    const grouped = new Map<string, SquadTacticalUnitInput[]>();
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      let arr = grouped.get(u.squadId);
      if (!arr) {
        arr = [];
        grouped.set(u.squadId, arr);
      }
      arr.push(u);
    }

    const allOrders = new Map<string, SquadTacticalOrder>();
    this.latestPlans.clear();

    for (const [squadId, members] of grouped.entries()) {
      const prevPeak = this.squadPeakCounts.get(squadId) ?? 0;
      const peak = Math.max(prevPeak, members.length);
      this.squadPeakCounts.set(squadId, peak);

      const alive = members.filter((m) => m.alive);
      const aliveCount = alive.length;
      const casualtyRatio = peak > 0 ? Math.max(0, 1 - aliveCount / peak) : 0;

      const hasSuppressor = alive.some(
        (m) => m.role === 'suppressor' || m.archetype === 'heavy_armor' || m.archetype === 'vehicle_crew'
      );
      const hasFlanker = alive.some(
        (m) => m.role === 'flanker' || m.archetype === 'elite_assault'
      );
      const anyLos = alive.some((m) => m.hasLos);

      let posture: SquadPosture = 'BOUNDING_ADVANCE';
      if (peak >= 2 && casualtyRatio >= 0.5 && aliveCount <= 2) {
        posture = 'FALLBACK_REGROUP';
      } else if (hasSuppressor && (hasFlanker || aliveCount >= 3) && (anyLos || playerBehindCover)) {
        posture = 'SUPPRESS_AND_FLANK';
      } else if (alive.every((m) => m.role === 'marksman' || m.role === 'operator' || m.role === 'anti_armor')) {
        posture = 'DEFENSIVE_HOLD';
      }

      const ordersByUnitId = new Map<string, SquadTacticalOrder>();
      let flankToggle = 0;
      let hasSuppressorPinned = false;

      for (let i = 0; i < alive.length; i++) {
        const u = alive[i];
        const order = this.computeUnitOrder(
          u,
          posture,
          flankToggle,
          playerInVehicle,
          playerBehindCover
        );
        if (order.order === 'FLANK_LEFT' || order.order === 'FLANK_RIGHT') {
          flankToggle++;
        }
        if (order.order === 'PIN_SUPPRESS') {
          hasSuppressorPinned = true;
        }
        ordersByUnitId.set(u.id, order);
        allOrders.set(u.id, order);
      }

      this.latestPlans.set(squadId, {
        squadId,
        posture,
        aliveCount,
        initialCount: peak,
        casualtyRatio: Number(casualtyRatio.toFixed(2)),
        hasSuppressorPinned,
        ordersByUnitId,
      });
    }

    return allOrders;
  }

  private computeUnitOrder(
    u: SquadTacticalUnitInput,
    posture: SquadPosture,
    flankToggle: number,
    playerInVehicle: boolean,
    playerBehindCover: boolean
  ): SquadTacticalOrder {
    const flankSide = flankToggle % 2 === 0 ? 1 : -1;

    // Low-health or high-casualty squad regrouping takes priority for non-heavy infantry
    if (
      (posture === 'FALLBACK_REGROUP' && u.archetype !== 'heavy_armor') ||
      u.healthRatio < 0.3
    ) {
      return {
        unitId: u.id,
        squadId: u.squadId,
        squadPosture: posture,
        order: 'REGROUP_FALLBACK',
        preferredRangeMin: 26,
        preferredRangeMax: 48,
        flankAngleOffsetRad: flankSide * 0.45,
        preferCoverSeek: true,
        priorityTargetPlayerVehicle: playerInVehicle && u.archetype === 'rocket_trooper',
        shouldRelocateOverwatch: true,
        burstLengthBonus: 0,
      };
    }

    switch (u.archetype) {
      case 'heavy_armor':
      case 'vehicle_crew':
        return {
          unitId: u.id,
          squadId: u.squadId,
          squadPosture: posture,
          order: 'PIN_SUPPRESS',
          preferredRangeMin: 18,
          preferredRangeMax: 38,
          flankAngleOffsetRad: 0,
          preferCoverSeek: u.archetype === 'vehicle_crew',
          priorityTargetPlayerVehicle: playerInVehicle,
          shouldRelocateOverwatch: false,
          burstLengthBonus: u.archetype === 'heavy_armor' ? 2 : 1,
        };

      case 'elite_assault':
        return {
          unitId: u.id,
          squadId: u.squadId,
          squadPosture: posture,
          order: flankSide > 0 ? 'FLANK_RIGHT' : 'FLANK_LEFT',
          preferredRangeMin: 10,
          preferredRangeMax: 24,
          flankAngleOffsetRad: flankSide * (posture === 'SUPPRESS_AND_FLANK' ? 1.05 : 0.72),
          preferCoverSeek: true,
          priorityTargetPlayerVehicle: false,
          shouldRelocateOverwatch: false,
          burstLengthBonus: 1,
        };

      case 'sniper': {
        const relocate = u.shotsFiredSinceRelocate >= 2 || u.isSuppressedOrHit || u.distanceToPlayer < 22;
        return {
          unitId: u.id,
          squadId: u.squadId,
          squadPosture: posture,
          order: 'OVERWATCH_HOLD',
          preferredRangeMin: 40,
          preferredRangeMax: 95,
          flankAngleOffsetRad: relocate ? flankSide * 0.65 : 0,
          preferCoverSeek: true,
          priorityTargetPlayerVehicle: false,
          shouldRelocateOverwatch: relocate,
          burstLengthBonus: 0,
        };
      }

      case 'rocket_trooper':
        return {
          unitId: u.id,
          squadId: u.squadId,
          squadPosture: posture,
          order: 'ANTI_ARMOR_FLUSH',
          preferredRangeMin: 24,
          preferredRangeMax: 65,
          flankAngleOffsetRad: playerBehindCover ? flankSide * 0.4 : 0,
          preferCoverSeek: true,
          priorityTargetPlayerVehicle: true,
          shouldRelocateOverwatch: u.isSuppressedOrHit,
          burstLengthBonus: 0,
        };

      case 'drone_operator':
        return {
          unitId: u.id,
          squadId: u.squadId,
          squadPosture: posture,
          order: 'BACKLINE_DRONE_SUPPORT',
          preferredRangeMin: 30,
          preferredRangeMax: 60,
          flankAngleOffsetRad: flankSide * 0.35,
          preferCoverSeek: true,
          priorityTargetPlayerVehicle: false,
          shouldRelocateOverwatch: u.distanceToPlayer < 24,
          burstLengthBonus: 0,
        };

      case 'infantry':
      default: {
        const shouldFlank = posture === 'SUPPRESS_AND_FLANK' && flankToggle % 2 === 1;
        return {
          unitId: u.id,
          squadId: u.squadId,
          squadPosture: posture,
          order: shouldFlank ? 'FLANK_LEFT' : 'COVER_ADVANCE',
          preferredRangeMin: 16,
          preferredRangeMax: 36,
          flankAngleOffsetRad: shouldFlank ? -0.68 : flankSide * 0.25,
          preferCoverSeek: true,
          priorityTargetPlayerVehicle: false,
          shouldRelocateOverwatch: false,
          burstLengthBonus: 0,
        };
      }
    }
  }

  getSquadPlan(squadId: string): SquadTacticalPlan | undefined {
    return this.latestPlans.get(squadId);
  }

  getAllSquadPlans(): SquadTacticalPlan[] {
    return Array.from(this.latestPlans.values());
  }
}
