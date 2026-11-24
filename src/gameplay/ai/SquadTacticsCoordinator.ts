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
  private readonly groupedScratch = new Map<string, SquadTacticalUnitInput[]>();
  private readonly aliveScratch: SquadTacticalUnitInput[] = [];
  private readonly allOrdersScratch = new Map<string, SquadTacticalOrder>();
  private readonly orderPoolByUnitId = new Map<string, SquadTacticalOrder>();

  reset(): void {
    this.squadPeakCounts.clear();
    this.latestPlans.clear();
    this.groupedScratch.clear();
    this.aliveScratch.length = 0;
    this.allOrdersScratch.clear();
    this.orderPoolByUnitId.clear();
  }

  evaluateSquads(
    units: readonly SquadTacticalUnitInput[],
    playerInVehicle: boolean,
    playerBehindCover: boolean
  ): Map<string, SquadTacticalOrder> {
    // Clear reusable member buckets without reallocating arrays or maps
    for (const arr of this.groupedScratch.values()) {
      arr.length = 0;
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      let arr = this.groupedScratch.get(u.squadId);
      if (!arr) {
        arr = [];
        this.groupedScratch.set(u.squadId, arr);
      }
      arr.push(u);
    }

    this.allOrdersScratch.clear();

    for (const [squadId, members] of this.groupedScratch.entries()) {
      if (members.length === 0) continue;
      const prevPeak = this.squadPeakCounts.get(squadId) ?? 0;
      const peak = Math.max(prevPeak, members.length);
      this.squadPeakCounts.set(squadId, peak);

      this.aliveScratch.length = 0;
      let hasSuppressor = false;
      let hasFlanker = false;
      let anyLos = false;
      let allDefensiveRoles = true;

      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m.alive) continue;
        this.aliveScratch.push(m);
        if (m.role === 'suppressor' || m.archetype === 'heavy_armor' || m.archetype === 'vehicle_crew') {
          hasSuppressor = true;
        }
        if (m.role === 'flanker' || m.archetype === 'elite_assault') {
          hasFlanker = true;
        }
        if (m.hasLos) {
          anyLos = true;
        }
        if (m.role !== 'marksman' && m.role !== 'operator' && m.role !== 'anti_armor') {
          allDefensiveRoles = false;
        }
      }

      const aliveCount = this.aliveScratch.length;
      const casualtyRatio = peak > 0 ? Math.max(0, 1 - aliveCount / peak) : 0;

      let posture: SquadPosture = 'BOUNDING_ADVANCE';
      if (peak >= 2 && casualtyRatio >= 0.5 && aliveCount <= 2) {
        posture = 'FALLBACK_REGROUP';
      } else if (hasSuppressor && (hasFlanker || aliveCount >= 3) && (anyLos || playerBehindCover)) {
        posture = 'SUPPRESS_AND_FLANK';
      } else if (aliveCount > 0 && allDefensiveRoles) {
        posture = 'DEFENSIVE_HOLD';
      }

      let plan = this.latestPlans.get(squadId);
      if (!plan) {
        plan = {
          squadId,
          posture,
          aliveCount,
          initialCount: peak,
          casualtyRatio: 0,
          hasSuppressorPinned: false,
          ordersByUnitId: new Map<string, SquadTacticalOrder>(),
        };
        this.latestPlans.set(squadId, plan);
      } else {
        plan.ordersByUnitId.clear();
      }

      let flankToggle = 0;
      let hasSuppressorPinned = false;

      for (let i = 0; i < aliveCount; i++) {
        const u = this.aliveScratch[i];
        const order = this.computeUnitOrderIntoPool(
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
        plan.ordersByUnitId.set(u.id, order);
        this.allOrdersScratch.set(u.id, order);
      }

      plan.posture = posture;
      plan.aliveCount = aliveCount;
      plan.initialCount = peak;
      plan.casualtyRatio = Number(casualtyRatio.toFixed(2));
      plan.hasSuppressorPinned = hasSuppressorPinned;
    }

    return this.allOrdersScratch;
  }

  private writeOrder(
    unitId: string,
    squadId: string,
    squadPosture: SquadPosture,
    orderKind: UnitTacticalOrderKind,
    preferredRangeMin: number,
    preferredRangeMax: number,
    flankAngleOffsetRad: number,
    preferCoverSeek: boolean,
    priorityTargetPlayerVehicle: boolean,
    shouldRelocateOverwatch: boolean,
    burstLengthBonus: number
  ): SquadTacticalOrder {
    let rec = this.orderPoolByUnitId.get(unitId);
    if (!rec) {
      rec = {
        unitId,
        squadId,
        squadPosture,
        order: orderKind,
        preferredRangeMin,
        preferredRangeMax,
        flankAngleOffsetRad,
        preferCoverSeek,
        priorityTargetPlayerVehicle,
        shouldRelocateOverwatch,
        burstLengthBonus,
      };
      this.orderPoolByUnitId.set(unitId, rec);
    } else {
      rec.unitId = unitId;
      rec.squadId = squadId;
      rec.squadPosture = squadPosture;
      rec.order = orderKind;
      rec.preferredRangeMin = preferredRangeMin;
      rec.preferredRangeMax = preferredRangeMax;
      rec.flankAngleOffsetRad = flankAngleOffsetRad;
      rec.preferCoverSeek = preferCoverSeek;
      rec.priorityTargetPlayerVehicle = priorityTargetPlayerVehicle;
      rec.shouldRelocateOverwatch = shouldRelocateOverwatch;
      rec.burstLengthBonus = burstLengthBonus;
    }
    return rec;
  }

  private computeUnitOrderIntoPool(
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
      return this.writeOrder(
        u.id,
        u.squadId,
        posture,
        'REGROUP_FALLBACK',
        26,
        48,
        flankSide * 0.45,
        true,
        playerInVehicle && u.archetype === 'rocket_trooper',
        true,
        0
      );
    }

    switch (u.archetype) {
      case 'heavy_armor':
      case 'vehicle_crew':
        return this.writeOrder(
          u.id,
          u.squadId,
          posture,
          'PIN_SUPPRESS',
          18,
          38,
          0,
          u.archetype === 'vehicle_crew',
          playerInVehicle,
          false,
          u.archetype === 'heavy_armor' ? 2 : 1
        );

      case 'elite_assault':
        return this.writeOrder(
          u.id,
          u.squadId,
          posture,
          flankSide > 0 ? 'FLANK_RIGHT' : 'FLANK_LEFT',
          10,
          24,
          flankSide * (posture === 'SUPPRESS_AND_FLANK' ? 1.05 : 0.72),
          true,
          false,
          false,
          1
        );

      case 'sniper': {
        const relocate = u.shotsFiredSinceRelocate >= 2 || u.isSuppressedOrHit || u.distanceToPlayer < 22;
        return this.writeOrder(
          u.id,
          u.squadId,
          posture,
          'OVERWATCH_HOLD',
          40,
          95,
          relocate ? flankSide * 0.65 : 0,
          true,
          false,
          relocate,
          0
        );
      }

      case 'rocket_trooper':
        return this.writeOrder(
          u.id,
          u.squadId,
          posture,
          'ANTI_ARMOR_FLUSH',
          24,
          65,
          playerBehindCover ? flankSide * 0.4 : 0,
          true,
          true,
          u.isSuppressedOrHit,
          0
        );

      case 'drone_operator':
        return this.writeOrder(
          u.id,
          u.squadId,
          posture,
          'BACKLINE_DRONE_SUPPORT',
          30,
          60,
          flankSide * 0.35,
          true,
          false,
          u.distanceToPlayer < 24,
          0
        );

      case 'infantry':
      default: {
        const shouldFlank = posture === 'SUPPRESS_AND_FLANK' && flankToggle % 2 === 1;
        return this.writeOrder(
          u.id,
          u.squadId,
          posture,
          shouldFlank ? 'FLANK_LEFT' : 'COVER_ADVANCE',
          16,
          36,
          shouldFlank ? -0.68 : flankSide * 0.25,
          true,
          false,
          false,
          0
        );
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
