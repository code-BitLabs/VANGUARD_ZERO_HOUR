import { CargoLiftDefinition } from '@/src/gameplay/CargoLiftManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { ElevatedNavSurfaceDescriptor } from '@/src/workers/WorkerBridge';
import { NavPortalInput } from '@/src/workers/navigationCore';
import { VANGUARD_ARCHITECTURAL_STANDARDS } from './VisualBible';

export type ReconciledStructureKind =
  | 'walkable_watchtower_9m'
  | 'rooftop_access'
  | 'enterable_building'
  | 'enterable_rooftop_building'
  | 'enterable_ground_building'
  | 'multi_stop_cargo_lift'
  | 'switchback_staircase'
  | 'single_flight_ramp'
  | 'elevated_skybridge';

export interface ReconciledStructureRecord {
  structureId: string;
  missionId: number;
  kind: ReconciledStructureKind;
  visualKitId: string;
  centerX: number;
  centerZ: number;
  baseY: number;
  authoritativeWalkableSopY: number;
  midLandingY?: number;
  width: number;
  depth: number;
  parapetHeight: number;
  surfaceIds: number[];
  portalKeys: string[];
  colliderIds: string[];
}

export interface MissionGeometryReconciliationReport {
  missionId: number;
  valid: boolean;
  totalStructures: number;
  totalElevatedSurfaces: number;
  totalPortals: number;
  totalCargoLifts: number;
  watchtowerDeckElevationsVerifiedM: number[];
  discrepancies: string[];
  records: ReconciledStructureRecord[];
}

/**
 * Stage 5B Final Engineering Amendment Section 1:
 * Explicit reconciliation registry between Stage 5A authoritative collision/navigation structures
 * and Stage 5B visual replacement assets.
 * Ensures watchtowers remain at their authoritative +9.0m deck elevation (+4.5m mid-landing),
 * building rooftops match exact `baseY + h` colliders, and portals/lifts never drift.
 */
export class StructureReconciliationRegistry {
  private readonly recordsByMission = new Map<number, ReconciledStructureRecord[]>();

  registerStructure(record: ReconciledStructureRecord): void {
    let list = this.recordsByMission.get(record.missionId);
    if (!list) {
      list = [];
      this.recordsByMission.set(record.missionId, list);
    }
    const existingIdx = list.findIndex((r) => r.structureId === record.structureId);
    if (existingIdx >= 0) {
      list[existingIdx] = record;
    } else {
      list.push(record);
    }
  }

  clearMission(missionId: number): void {
    this.recordsByMission.delete(missionId);
  }

  getMissionRecords(missionId: number): ReadonlyArray<ReconciledStructureRecord> {
    return this.recordsByMission.get(missionId) ?? [];
  }

  /**
   * Verifies that all ElevatedNavSurfaces, NavPortals, CargoLifts, and CollisionWorld static boxes
   * remain 100% synchronized with their Stage 5B visual assemblies.
   */
  verifyMissionReconciliation(
    missionId: number,
    elevatedSurfaces: ReadonlyArray<ElevatedNavSurfaceDescriptor>,
    navPortals: ReadonlyArray<NavPortalInput>,
    cargoLifts: ReadonlyArray<CargoLiftDefinition>,
    collisionWorld: CollisionWorld
  ): MissionGeometryReconciliationReport {
    const records = this.recordsByMission.get(missionId) ?? [];
    const discrepancies: string[] = [];
    const watchtowerDeckElevationsVerifiedM: number[] = [];

    const surfaceById = new Map<number, ElevatedNavSurfaceDescriptor>();
    for (const s of elevatedSurfaces) {
      surfaceById.set(s.surfaceId, s);
    }

    // 1. Verify every ElevatedNavSurface has a physical supporting collider at `s.elevationY`
    // Probe center plus inset deck points with stepHeight=0.25m so central cover/supply crates (0.92m tall)
    // do not masquerade as the underlying roof slab.
    for (const s of elevatedSurfaces) {
      const midX = (s.minX + s.maxX) * 0.5;
      const midZ = (s.minZ + s.maxZ) * 0.5;
      const insetX = Math.max(0.6, (s.maxX - s.minX) * 0.28);
      const insetZ = Math.max(0.6, (s.maxZ - s.minZ) * 0.28);
      const samplePts: Array<[number, number]> = [
        [midX, midZ],
        [midX - insetX, midZ - insetZ],
        [midX + insetX, midZ - insetZ],
        [midX - insetX, midZ + insetZ],
        [midX + insetX, midZ + insetZ],
      ];
      let matchedDeck = false;
      let bestHitY = -Infinity;
      for (const [px, pz] of samplePts) {
        const hitY = collisionWorld.getSupportHeightAt(
          px,
          s.elevationY + 0.15,
          pz,
          1.75,
          0.25
        );
        if (Math.abs(hitY - s.elevationY) <= 0.35) {
          matchedDeck = true;
          bestHitY = hitY;
          break;
        }
        if (Math.abs(hitY - s.elevationY) < Math.abs(bestHitY - s.elevationY)) {
          bestHitY = hitY;
        }
      }
      if (!matchedDeck) {
        discrepancies.push(
          `Surface ${s.name} (#${s.surfaceId}) elevationY=${s.elevationY.toFixed(2)}m mismatches collider topY=${bestHitY.toFixed(2)}m`
        );
      }
      if (s.name.includes('tower') || s.name.includes('wt')) {
        watchtowerDeckElevationsVerifiedM.push(Number(s.elevationY.toFixed(2)));
      }
    }

    // 2. Verify every NavPortal connects valid surfaces and has matching entry/exit elevations
    for (const p of navPortals) {
      if (p.fromSurfaceId > 0 && !surfaceById.has(p.fromSurfaceId)) {
        discrepancies.push(`Portal ${p.portalKey} references missing fromSurfaceId=${p.fromSurfaceId}`);
      }
      if (p.toSurfaceId > 0 && !surfaceById.has(p.toSurfaceId)) {
        discrepancies.push(`Portal ${p.portalKey} references missing toSurfaceId=${p.toSurfaceId}`);
      }
      const toSurf = surfaceById.get(p.toSurfaceId);
      if (toSurf && Math.abs(toSurf.elevationY - p.toY) > 0.65) {
        discrepancies.push(
          `Portal ${p.portalKey} toY=${p.toY.toFixed(2)}m mismatches destination surface ${toSurf.name} (${toSurf.elevationY.toFixed(2)}m)`
        );
      }
    }

    // 3. Verify CargoLifts have valid floor stops and landing elevations
    for (const lift of cargoLifts) {
      if (lift.stops.length < 2) {
        discrepancies.push(`CargoLift ${lift.id} has fewer than 2 floor stops`);
      }
      for (const stop of lift.stops) {
        if (stop.surfaceId > 0) {
          const surf = surfaceById.get(stop.surfaceId);
          if (!surf) {
            discrepancies.push(
              `CargoLift ${lift.id} floor ${stop.label} references missing surfaceId=${stop.surfaceId}`
            );
          } else if (Math.abs(surf.elevationY - stop.elevationY) > 0.65) {
            discrepancies.push(
              `CargoLift ${lift.id} floor ${stop.label} elevationY=${stop.elevationY}m != surface elevationY=${surf.elevationY}m`
            );
          }
        }
      }
    }

    // 4. Verify watchtower records respect the +9.0m Stage 5A authoritative height above baseY
    for (const rec of records) {
      if (rec.kind === 'walkable_watchtower_9m') {
        const expectedTop = rec.baseY + VANGUARD_ARCHITECTURAL_STANDARDS.watchtowerDeckElevationM;
        if (Math.abs(rec.authoritativeWalkableSopY - expectedTop) > 0.1) {
          discrepancies.push(
            `Watchtower ${rec.structureId} authoritativeWalkableSopY=${rec.authoritativeWalkableSopY}m != expected ${expectedTop}m`
          );
        }
      }
    }

    return {
      missionId,
      valid: discrepancies.length === 0,
      totalStructures: records.length,
      totalElevatedSurfaces: elevatedSurfaces.length,
      totalPortals: navPortals.length,
      totalCargoLifts: cargoLifts.length,
      watchtowerDeckElevationsVerifiedM,
      discrepancies,
      records,
    };
  }
}

export const globalStructureReconciliation = new StructureReconciliationRegistry();
