import { TraversalIntegrityFlag } from '@/src/engine/physics/PhysicsTypes';
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
  traversalIntegrityFlags: TraversalIntegrityFlag[];
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
    const traversalIntegrityFlags: TraversalIntegrityFlag[] = [];
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

    const staticBoxes = collisionWorld.getStaticBoxes();
    const staticBoxIds = new Set<string>(staticBoxes.map((b) => b.id));
    const parapetBoxes = staticBoxes.filter((b) => b.tag === 'parapet');

    // 2. Verify every NavPortal connects valid surfaces, has matching elevations, and has unobstructed parapet exits
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
      // PHYS-10: Check stair/ramp top exit corridor against roof parapets (must not pass through a parapet wall)
      if ((p.kind === 'stair' || p.kind === 'ramp') && toSurf) {
        const surfCenterX = (toSurf.minX + toSurf.maxX) * 0.5;
        const exitEdgeX = p.toX > surfCenterX ? toSurf.maxX - 0.21 : toSurf.minX + 0.21;
        const exitMinX = Math.min(p.toX, exitEdgeX) - 0.2;
        const exitMaxX = Math.max(p.toX, exitEdgeX) + 0.2;
        const exitMinZ = p.toZ - 0.42;
        const exitMaxZ = p.toZ + 0.42;
        for (const par of parapetBoxes) {
          if (par.maxY <= p.toY + 0.1 || par.minY >= p.toY + 1.5) continue;
          if (
            par.maxX > exitMinX &&
            par.minX < exitMaxX &&
            par.maxZ > exitMinZ &&
            par.minZ < exitMaxZ
          ) {
            const msg = `Portal ${p.portalKey} top exit (${p.toX.toFixed(1)}, ${p.toY.toFixed(1)}, ${p.toZ.toFixed(1)}) blocked by parapet ${par.id}`;
            discrepancies.push(msg);
            traversalIntegrityFlags.push({
              id: `blocked_${p.portalKey}`,
              severity: 'ERROR',
              code: 'BLOCKED_PARAPET_EXIT',
              x: exitEdgeX,
              y: p.toY + 0.6,
              z: p.toZ,
              message: msg,
            });
            break;
          }
        }
      }
    }

    // 3. Verify CargoLifts have valid floor stops, landing elevations, and terrain-anchored ground stops
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
        } else {
          const groundY = collisionWorld.getTerrainHeightOnly(lift.centerX, lift.centerZ);
          const delta = Math.abs(stop.elevationY - groundY);
          if (delta > 0.2) {
            const msg = `CargoLift ${lift.id} ground stop ${stop.elevationY.toFixed(2)}m floats ${delta.toFixed(2)}m off terrain (${groundY.toFixed(2)}m)`;
            discrepancies.push(msg);
            traversalIntegrityFlags.push({
              id: `lift_ground_${lift.id}`,
              severity: 'ERROR',
              code: 'FLOATING_LIFT_BASE',
              x: lift.centerX,
              y: stop.elevationY,
              z: lift.centerZ,
              message: msg,
            });
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

    // 5. PHYS-10: Verify every ground-entry OrientedSlopeRegion is anchored within 0.18m of actual terrain
    for (const slope of collisionWorld.getSlopes()) {
      if (slope.id.endsWith('_flight2')) continue;
      const startX = slope.centerX - slope.dirX * slope.halfLength;
      const startZ = slope.centerZ - slope.dirZ * slope.halfLength;
      const terrainY = collisionWorld.getTerrainHeightOnly(startX, startZ);
      const gap = Math.abs(slope.startY - terrainY);
      if (gap > 0.18) {
        const msg = `Slope ${slope.id} entryY=${slope.startY.toFixed(2)}m differs from terrain ${terrainY.toFixed(2)}m by ${gap.toFixed(2)}m`;
        discrepancies.push(msg);
        traversalIntegrityFlags.push({
          id: `floating_slope_${slope.id}`,
          severity: 'ERROR',
          code: 'FLOATING_ENTRY',
          x: startX,
          y: slope.startY,
          z: startZ,
          message: msg,
        });
      }
    }

    // 6. PHYS-10: Verify every switchback mid-landing has a registered physical support pillar collider
    for (const box of staticBoxes) {
      if (box.tag === 'stair_landing' && box.id.endsWith('_mid_landing')) {
        const expectedPilId = box.id.replace(/_mid_landing$/, '_pil');
        if (!staticBoxIds.has(expectedPilId)) {
          const cx = (box.minX + box.maxX) * 0.5;
          const cz = (box.minZ + box.maxZ) * 0.5;
          const msg = `Mid-landing ${box.id} is missing solid support pillar collider ${expectedPilId}`;
          discrepancies.push(msg);
          traversalIntegrityFlags.push({
            id: `missing_pil_${box.id}`,
            severity: 'WARN',
            code: 'MISSING_PILLAR_COLLIDER',
            x: cx,
            y: box.minY,
            z: cz,
            message: msg,
          });
        }
      }
    }

    // 7. PHYS-10: Verify every registered ClimbableLadder is terrain-anchored and has a clear top exit
    for (const ladder of collisionWorld.getLadders()) {
      if (ladder.fromSurfaceId === 0) {
        const terrainY = collisionWorld.getTerrainHeightOnly(
          ladder.x + ladder.normalX * 0.45,
          ladder.z + ladder.normalZ * 0.45
        );
        const gap = Math.abs(ladder.bottomY - terrainY);
        if (gap > 0.25) {
          const msg = `Ladder ${ladder.id} bottomY=${ladder.bottomY.toFixed(2)}m floats ${gap.toFixed(2)}m off terrain (${terrainY.toFixed(2)}m)`;
          discrepancies.push(msg);
          traversalIntegrityFlags.push({
            id: `floating_ladder_${ladder.id}`,
            severity: 'ERROR',
            code: 'FLOATING_ENTRY',
            x: ladder.x,
            y: ladder.bottomY,
            z: ladder.z,
            message: msg,
          });
        }
      }
      const stepMinX = Math.min(ladder.x, ladder.topExitX) - 0.3;
      const stepMaxX = Math.max(ladder.x, ladder.topExitX) + 0.3;
      const stepMinZ = Math.min(ladder.z, ladder.topExitZ) - 0.3;
      const stepMaxZ = Math.max(ladder.z, ladder.topExitZ) + 0.3;
      for (const par of parapetBoxes) {
        if (par.maxY <= ladder.topY + 0.1 || par.minY >= ladder.topY + 1.5) continue;
        if (
          par.maxX > stepMinX &&
          par.minX < stepMaxX &&
          par.maxZ > stepMinZ &&
          par.minZ < stepMaxZ
        ) {
          const msg = `Ladder ${ladder.id} top exit (${ladder.topExitX.toFixed(1)}, ${ladder.topY.toFixed(1)}, ${ladder.topExitZ.toFixed(1)}) blocked by parapet ${par.id}`;
          discrepancies.push(msg);
          traversalIntegrityFlags.push({
            id: `blocked_ladder_${ladder.id}`,
            severity: 'ERROR',
            code: 'BLOCKED_PARAPET_EXIT',
            x: ladder.topExitX,
            y: ladder.topY + 0.6,
            z: ladder.topExitZ,
            message: msg,
          });
          break;
        }
      }
    }

    collisionWorld.physicsWorld.setTraversalIntegrityFlags(traversalIntegrityFlags);

    return {
      missionId,
      valid: discrepancies.length === 0,
      totalStructures: records.length,
      totalElevatedSurfaces: elevatedSurfaces.length,
      totalPortals: navPortals.length,
      totalCargoLifts: cargoLifts.length,
      watchtowerDeckElevationsVerifiedM,
      discrepancies,
      traversalIntegrityFlags,
      records,
    };
  }
}

export const globalStructureReconciliation = new StructureReconciliationRegistry();
