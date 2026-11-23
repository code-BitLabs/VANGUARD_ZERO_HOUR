// Pure tactical A* navigation core with persistent typed buffers, 1-indexed binary min-heap,
// explicit out-of-bounds sentinel handling, generation-counter search state, Bresenham LOS string-pulling,
// and Hierarchical Hybrid Multi-Elevation Surface + Portal Graph A* search.
// Zero Three.js, DOM, or Web Worker globals so both navigation.worker.ts and Vitest unit/benchmark suites share one implementation.

import {
  canAgentUsePortal,
  getAgentProfileByCode,
  PortalKind,
} from '@/src/navigation/AgentTraversalProfile';

export const NAV_GRID_DEFAULTS = {
  width: 160,
  height: 160,
  cellSize: 2,
  originX: -160,
  originZ: -160,
  maxIter: 4096,
} as const;

export const TRAVERSAL_FLAGS = {
  NONE: 0,
  PORTAL_APPROACH: 1 << 0,
  PORTAL_TRAVERSE: 1 << 1,
  LIFT_WAIT_BOARD: 1 << 2,
  LIFT_RIDE: 1 << 3,
  PARTIAL_PATH: 1 << 4,
} as const;

export interface NavGridState {
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
  blocked: Uint8Array;
}

export interface ElevatedNavSurfaceInput {
  surfaceId: number;
  name: string;
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
  elevationY: number;
  minY: number;
  maxY: number;
  blocked: Uint8Array;
}

export interface NavPortalInput {
  portalId: number;
  portalKey: string;
  kind: PortalKind;
  liftId?: string;
  fromSurfaceId: number;
  toSurfaceId: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  fromFloorIndex: number;
  toFloorIndex: number;
  width: number;
  clearanceHeight: number;
  slopeDeg: number;
  baseCost: number;
  dynamicWaitCost: number;
  allowedProfilesMask: number;
  maxConcurrentOccupants: number;
  activeOccupants: number;
  enabled: boolean;
  bidirectional: boolean;
}

export interface NavSurfaceState extends NavGridState {
  surfaceId: number;
  name: string;
  elevationY: number;
  minY: number;
  maxY: number;
}

interface DirectedPortalEdge {
  edgeIdx: number;
  portalId: number;
  portalKey: string;
  kind: PortalKind;
  liftId?: string;
  entrySurfaceId: number;
  exitSurfaceId: number;
  entryX: number;
  entryY: number;
  entryZ: number;
  exitX: number;
  exitY: number;
  exitZ: number;
  fromFloorIndex: number;
  toFloorIndex: number;
  width: number;
  clearanceHeight: number;
  slopeDeg: number;
  baseCost: number;
  dynamicWaitCost: number;
  allowedProfilesMask: number;
  maxConcurrentOccupants: number;
  activeOccupants: number;
  enabled: boolean;
}

export interface NavigationMemoryStats {
  groundGridBytes: number;
  elevatedSurfacesBytes: number;
  elevatedSurfaceCount: number;
  portalGraphBytes: number;
  portalCount: number;
  directedEdgeCount: number;
  scratchBytes: number;
  totalBytes: number;
}

const DIRS_DX = new Int8Array([1, -1, 0, 0, 1, -1, 1, -1]);
const DIRS_DZ = new Int8Array([0, 0, 1, -1, 1, 1, -1, -1]);
const DIRS_COST = new Float32Array([
  1,
  1,
  1,
  1,
  Math.SQRT2,
  Math.SQRT2,
  Math.SQRT2,
  Math.SQRT2,
]);

/**
 * Maps world (wx, wz) onto a linear grid index on the half-open domain
 * [originX, originX + width * cellSize) x [originZ, originZ + height * cellSize).
 * Returns -1 when coordinates are non-finite or outside bounds (never clamps silently).
 */
export function worldToCellIndex(wx: number, wz: number, g: NavGridState): number {
  if (!Number.isFinite(wx) || !Number.isFinite(wz)) return -1;
  const cx = Math.floor((wx - g.originX) / g.cellSize);
  const cz = Math.floor((wz - g.originZ) / g.cellSize);
  if (cx < 0 || cx >= g.width || cz < 0 || cz >= g.height) {
    return -1;
  }
  return cz * g.width + cx;
}

export function cellIndexToWorld(
  cellIdx: number,
  g: NavGridState,
  out: Float32Array
): void {
  const cx = cellIdx % g.width;
  const cz = (cellIdx / g.width) | 0;
  out[0] = g.originX + (cx + 0.5) * g.cellSize;
  out[1] = g.originZ + (cz + 0.5) * g.cellSize;
}

/**
 * Checks grid-cell line-of-sight between (x0, z0) and (x1, z1) using integer Bresenham
 * stepping, rejecting any step that passes through a blocked cell or cuts diagonally
 * across a blocked orthogonal neighbor.
 */
export function hasGridLineOfSight(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  g: NavGridState
): boolean {
  const w = g.width;
  const blocked = g.blocked;
  let cx = x0;
  let cz = z0;

  if (cx < 0 || cx >= w || cz < 0 || cz >= g.height) return false;
  if (x1 < 0 || x1 >= w || z1 < 0 || z1 >= g.height) return false;
  if (blocked[cz * w + cx] === 1 || blocked[z1 * w + x1] === 1) return false;

  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;

  while (cx !== x1 || cz !== z1) {
    const e2 = err * 2;
    const stepX = e2 > -dz;
    const stepZ = e2 < dx;

    if (stepX && stepZ) {
      const n1 = cz * w + (cx + sx);
      const n2 = (cz + sz) * w + cx;
      if (blocked[n1] === 1 || blocked[n2] === 1) return false;
      err -= dz;
      err += dx;
      cx += sx;
      cz += sz;
    } else if (stepX) {
      err -= dz;
      cx += sx;
    } else if (stepZ) {
      err += dx;
      cz += sz;
    }

    if (blocked[cz * w + cx] === 1) return false;
  }

  return true;
}

/**
 * Applies compact [cellIndex, blockedFlag] pair updates in place after dynamic destruction.
 */
export function applyCellUpdates(updates: Uint16Array, g: NavGridState): number {
  let applied = 0;
  const maxIdx = g.blocked.length;
  for (let i = 0; i + 1 < updates.length; i += 2) {
    const cellIdx = updates[i];
    if (cellIdx < maxIdx) {
      g.blocked[cellIdx] = updates[i + 1] !== 0 ? 1 : 0;
      applied++;
    }
  }
  return applied;
}

/**
 * Zero-allocation A* solver over single NavGridState + Hierarchical Hybrid Multi-Elevation
 * surface graph with precomputed intra-surface portal distance table and capability profiles.
 */
export class NavigationSolver {
  private grid: NavGridState | null = null;
  private surfaces = new Map<number, NavSurfaceState>();
  private elevatedSurfaceList: NavSurfaceState[] = [];
  private portalInputs: NavPortalInput[] = [];
  private directedEdges: DirectedPortalEdge[] = [];
  private edgesByPortalId = new Map<number, DirectedPortalEdge[]>();
  private edgePairDist = new Float32Array(0);
  private totalCells = 0;

  // Persistent per-cell scratch buffers (sized to largest surface)
  private gScore = new Float32Array(0);
  private fScore = new Float32Array(0);
  private parent = new Int32Array(0);
  private visitedGen = new Uint32Array(0);
  private closedGen = new Uint32Array(0);

  // 1-indexed binary min-heap: valid positions [1 .. totalCells]
  private heapNodes = new Int32Array(1);
  private heapPos = new Int32Array(0);
  private heapGen = new Uint32Array(0);
  private heapSize = 0;
  private pathChainScratch = new Int32Array(0);

  // Persistent abstract portal-graph Dijkstra buffers (sized to directedEdges.length)
  private edgeCompatible = new Uint8Array(0);
  private edgeStartDist = new Float32Array(0);
  private edgeGoalDist = new Float32Array(0);
  private edgeBestCost = new Float32Array(0);
  private edgePrev = new Int32Array(0);
  private edgeClosed = new Uint8Array(0);
  private edgeStartCandIdx = new Int32Array(0);
  private edgeStartCandDistSq = new Float32Array(0);
  private edgeGoalCandIdx = new Int32Array(0);
  private edgeGoalCandDistSq = new Float32Array(0);
  private edgeStartEvaluated = new Uint8Array(0);
  private edgeGoalEvaluated = new Uint8Array(0);
  private readonly dirtySurfaces = new Set<number>();

  public readonly outWaypoint = new Float32Array(2);
  public readonly outWaypoint3D = new Float32Array(3);
  public readonly outMeta3D = new Int32Array(4);

  private currentSearchId = 0;
  public oobQueryCount = 0;
  public lastIterations = 0;
  public lastExhaustedBudget = false;
  public lastGoalReached = false;
  public lastChainLength = 0;
  public lastPathDistanceMeters = 0;
  public lastPortalAStarCalls = 0;

  initGrid(
    width: number,
    height: number,
    cellSize: number,
    originX: number,
    originZ: number,
    blocked: Uint8Array
  ): void {
    const ground: NavSurfaceState = {
      surfaceId: 0,
      name: 'ground',
      width,
      height,
      cellSize,
      originX,
      originZ,
      elevationY: 0,
      minY: -4,
      maxY: 2.5,
      blocked,
    };
    this.grid = ground;
    this.surfaces.clear();
    this.surfaces.set(0, ground);
    this.elevatedSurfaceList = [];
    this.portalInputs = [];
    this.directedEdges = [];
    this.edgesByPortalId.clear();
    this.dirtySurfaces.clear();
    this.edgePairDist = new Float32Array(0);
    this.ensureCellScratchCapacity(width * height);
  }

  initMultiSurfaceNavigation(
    groundGrid: {
      width: number;
      height: number;
      cellSize: number;
      originX: number;
      originZ: number;
      blocked: Uint8Array;
    },
    elevatedSurfaces: ElevatedNavSurfaceInput[],
    portals: NavPortalInput[]
  ): void {
    const ground: NavSurfaceState = {
      surfaceId: 0,
      name: 'ground',
      width: groundGrid.width,
      height: groundGrid.height,
      cellSize: groundGrid.cellSize,
      originX: groundGrid.originX,
      originZ: groundGrid.originZ,
      elevationY: 0,
      minY: -4,
      maxY: 2.5,
      blocked: groundGrid.blocked,
    };
    this.grid = ground;
    this.surfaces.clear();
    this.surfaces.set(0, ground);
    this.elevatedSurfaceList = [];

    let maxCells = groundGrid.width * groundGrid.height;
    for (let i = 0; i < elevatedSurfaces.length; i++) {
      const s = elevatedSurfaces[i];
      if (s.surfaceId <= 0) continue;
      const surfaceState: NavSurfaceState = {
        surfaceId: s.surfaceId,
        name: s.name,
        width: s.width,
        height: s.height,
        cellSize: s.cellSize,
        originX: s.originX,
        originZ: s.originZ,
        elevationY: s.elevationY,
        minY: s.minY,
        maxY: s.maxY,
        blocked: s.blocked,
      };
      this.surfaces.set(s.surfaceId, surfaceState);
      this.elevatedSurfaceList.push(surfaceState);
      const c = s.width * s.height;
      if (c > maxCells) maxCells = c;
    }

    this.ensureCellScratchCapacity(maxCells);
    this.rebuildPortalGraph(portals);
  }

  private ensureCellScratchCapacity(total: number): void {
    if (total > this.totalCells) {
      this.totalCells = total;
      this.gScore = new Float32Array(total);
      this.fScore = new Float32Array(total);
      this.parent = new Int32Array(total);
      this.visitedGen = new Uint32Array(total);
      this.closedGen = new Uint32Array(total);
      this.heapNodes = new Int32Array(total + 1);
      this.heapPos = new Int32Array(total);
      this.heapGen = new Uint32Array(total);
      this.pathChainScratch = new Int32Array(total);
    } else {
      this.visitedGen.fill(0);
      this.closedGen.fill(0);
      this.heapGen.fill(0);
    }
    this.currentSearchId = 0;
    this.heapSize = 0;
  }

  private rebuildPortalGraph(portals: NavPortalInput[]): void {
    this.portalInputs = portals.slice();
    this.directedEdges = [];
    this.edgesByPortalId.clear();

    for (let i = 0; i < portals.length; i++) {
      const p = portals[i];
      const forward: DirectedPortalEdge = {
        edgeIdx: this.directedEdges.length,
        portalId: p.portalId,
        portalKey: p.portalKey,
        kind: p.kind,
        liftId: p.liftId,
        entrySurfaceId: p.fromSurfaceId,
        exitSurfaceId: p.toSurfaceId,
        entryX: p.fromX,
        entryY: p.fromY,
        entryZ: p.fromZ,
        exitX: p.toX,
        exitY: p.toY,
        exitZ: p.toZ,
        fromFloorIndex: p.fromFloorIndex,
        toFloorIndex: p.toFloorIndex,
        width: p.width,
        clearanceHeight: p.clearanceHeight,
        slopeDeg: p.slopeDeg,
        baseCost: p.baseCost,
        dynamicWaitCost: p.dynamicWaitCost,
        allowedProfilesMask: p.allowedProfilesMask,
        maxConcurrentOccupants: p.maxConcurrentOccupants,
        activeOccupants: p.activeOccupants,
        enabled: p.enabled,
      };
      this.directedEdges.push(forward);
      const list = [forward];

      if (p.bidirectional) {
        const reverse: DirectedPortalEdge = {
          edgeIdx: this.directedEdges.length,
          portalId: p.portalId,
          portalKey: p.portalKey,
          kind: p.kind,
          liftId: p.liftId,
          entrySurfaceId: p.toSurfaceId,
          exitSurfaceId: p.fromSurfaceId,
          entryX: p.toX,
          entryY: p.toY,
          entryZ: p.toZ,
          exitX: p.fromX,
          exitY: p.fromY,
          exitZ: p.fromZ,
          fromFloorIndex: p.toFloorIndex,
          toFloorIndex: p.fromFloorIndex,
          width: p.width,
          clearanceHeight: p.clearanceHeight,
          slopeDeg: p.slopeDeg,
          baseCost: p.baseCost,
          dynamicWaitCost: p.dynamicWaitCost,
          allowedProfilesMask: p.allowedProfilesMask,
          maxConcurrentOccupants: p.maxConcurrentOccupants,
          activeOccupants: p.activeOccupants,
          enabled: p.enabled,
        };
        this.directedEdges.push(reverse);
        list.push(reverse);
      }

      this.edgesByPortalId.set(p.portalId, list);
    }

    const E = this.directedEdges.length;
    this.edgePairDist = new Float32Array(E * E);
    this.edgePairDist.fill(Infinity);
    this.edgeCompatible = new Uint8Array(E);
    this.edgeStartDist = new Float32Array(E);
    this.edgeGoalDist = new Float32Array(E);
    this.edgeBestCost = new Float32Array(E);
    this.edgePrev = new Int32Array(E);
    this.edgeClosed = new Uint8Array(E);
    this.edgeStartCandIdx = new Int32Array(E);
    this.edgeStartCandDistSq = new Float32Array(E);
    this.edgeGoalCandIdx = new Int32Array(E);
    this.edgeGoalCandDistSq = new Float32Array(E);
    this.edgeStartEvaluated = new Uint8Array(E);
    this.edgeGoalEvaluated = new Uint8Array(E);

    this.dirtySurfaces.clear();
    this.recomputeIntraSurfacePortalDistances(null);
  }

  private flushDirtySurfaceDistances(): void {
    if (this.dirtySurfaces.size === 0 || this.directedEdges.length === 0) {
      this.dirtySurfaces.clear();
      return;
    }
    for (const surfaceId of this.dirtySurfaces) {
      this.recomputeIntraSurfacePortalDistances(surfaceId);
    }
    this.dirtySurfaces.clear();
  }

  private recomputeIntraSurfacePortalDistances(onlySurfaceId: number | null): void {
    const E = this.directedEdges.length;
    for (let i = 0; i < E; i++) {
      const a = this.directedEdges[i];
      if (onlySurfaceId !== null && a.exitSurfaceId !== onlySurfaceId) continue;
      const surf = this.surfaces.get(a.exitSurfaceId);
      if (!surf) continue;
      for (let j = 0; j < E; j++) {
        const b = this.directedEdges[j];
        if (b.entrySurfaceId !== a.exitSurfaceId) {
          this.edgePairDist[i * E + j] = Infinity;
          continue;
        }
        if (i === j || (a.portalId === b.portalId && a.exitSurfaceId === b.entrySurfaceId)) {
          const dEuclid = Math.hypot(b.entryX - a.exitX, b.entryZ - a.exitZ);
          if (dEuclid < 0.5) {
            this.edgePairDist[i * E + j] = 0;
            continue;
          }
        }
        const ok = this.runLocalAStar(surf, a.exitX, a.exitZ, b.entryX, b.entryZ, 2400, true);
        this.edgePairDist[i * E + j] =
          ok && this.lastGoalReached ? this.lastPathDistanceMeters : Infinity;
      }
    }
  }

  getGrid(): NavGridState | null {
    return this.grid;
  }

  getSurface(surfaceId: number): NavSurfaceState | null {
    return this.surfaces.get(surfaceId) ?? null;
  }

  getSurfaceCount(): number {
    return this.surfaces.size;
  }

  getPortalPairDistanceForTest(fromEdgeIdx: number, toEdgeIdx: number): number {
    this.flushDirtySurfaceDistances();
    const E = this.directedEdges.length;
    if (fromEdgeIdx < 0 || fromEdgeIdx >= E || toEdgeIdx < 0 || toEdgeIdx >= E) {
      return Infinity;
    }
    return this.edgePairDist[fromEdgeIdx * E + toEdgeIdx];
  }

  applyCellUpdates(updates: Uint16Array, surfaceId = 0): number {
    const surf = this.surfaces.get(surfaceId) ?? this.grid;
    if (!surf) return 0;
    const applied = applyCellUpdates(updates, surf);
    if (applied > 0 && this.directedEdges.length > 0) {
      this.dirtySurfaces.add(surfaceId);
    }
    return applied;
  }

  updatePortalState(
    portalId: number,
    enabled?: boolean,
    dynamicWaitCost?: number,
    activeOccupants?: number
  ): void {
    const edges = this.edgesByPortalId.get(portalId);
    if (!edges) return;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (enabled !== undefined) e.enabled = enabled;
      if (dynamicWaitCost !== undefined) e.dynamicWaitCost = Math.max(0, dynamicWaitCost);
      if (activeOccupants !== undefined) e.activeOccupants = Math.max(0, activeOccupants);
    }
  }

  getNavigationMemoryStats(): NavigationMemoryStats {
    const groundGridBytes = this.grid ? this.grid.blocked.byteLength : 0;
    let elevatedSurfacesBytes = 0;
    for (let i = 0; i < this.elevatedSurfaceList.length; i++) {
      elevatedSurfacesBytes += this.elevatedSurfaceList[i].blocked.byteLength + 64;
    }
    const E = this.directedEdges.length;
    const portalGraphBytes =
      this.edgePairDist.byteLength +
      this.edgeCompatible.byteLength +
      this.edgeStartDist.byteLength +
      this.edgeGoalDist.byteLength +
      this.edgeBestCost.byteLength +
      this.edgePrev.byteLength +
      this.edgeClosed.byteLength +
      E * 128;
    const scratchBytes =
      this.gScore.byteLength +
      this.fScore.byteLength +
      this.parent.byteLength +
      this.visitedGen.byteLength +
      this.closedGen.byteLength +
      this.heapNodes.byteLength +
      this.heapPos.byteLength +
      this.heapGen.byteLength +
      this.pathChainScratch.byteLength;
    return {
      groundGridBytes,
      elevatedSurfacesBytes,
      elevatedSurfaceCount: this.elevatedSurfaceList.length,
      portalGraphBytes,
      portalCount: this.portalInputs.length,
      directedEdgeCount: E,
      scratchBytes,
      totalBytes: groundGridBytes + elevatedSurfacesBytes + portalGraphBytes + scratchBytes,
    };
  }

  /**
   * Resolves which surface contains `(wx, wy, wz)`, matching elevated surfaces by exact
   * horizontal footprint and vertical elevation proximity before falling back to ground (`0`).
   */
  resolveSurfaceId(wx: number, wy: number, wz: number): number {
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) return 0;
    let bestId = 0;
    let bestDiff = Infinity;

    for (let i = 0; i < this.elevatedSurfaceList.length; i++) {
      const s = this.elevatedSurfaceList[i];
      if (wy < s.minY - 0.65 || wy > s.maxY + 2.4) continue;
      if (
        wx < s.originX ||
        wx >= s.originX + s.width * s.cellSize ||
        wz < s.originZ ||
        wz >= s.originZ + s.height * s.cellSize
      ) {
        continue;
      }
      const idx = worldToCellIndex(wx, wz, s);
      if (idx === -1) continue;
      // Only lock onto elevated surface if cell or immediate neighbor is walkable on this elevated deck
      if (s.blocked[idx] === 1 && !this.hasUnblockedNeighborCell(idx, s)) {
        continue;
      }
      const diff = Math.abs(wy - s.elevationY);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestId = s.surfaceId;
      }
    }

    return bestId;
  }

  private hasUnblockedNeighborCell(cellIdx: number, g: NavGridState): boolean {
    const cx = cellIdx % g.width;
    const cz = (cellIdx / g.width) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DIRS_DX[d];
      const nz = cz + DIRS_DZ[d];
      if (nx < 0 || nx >= g.width || nz < 0 || nz >= g.height) continue;
      if (g.blocked[nz * g.width + nx] === 0) return true;
    }
    return false;
  }

  /**
   * Finds the closest unblocked cell index when a start/portal endpoint happens to sit on a border wall cell.
   */
  private findNearestWalkableCell(cellIdx: number, g: NavGridState): number {
    if (cellIdx !== -1 && g.blocked[cellIdx] === 0) return cellIdx;
    if (cellIdx === -1) return -1;
    const cx = cellIdx % g.width;
    const cz = (cellIdx / g.width) | 0;
    let bestIdx = -1;
    let bestDistSq = Infinity;
    for (let rz = -2; rz <= 2; rz++) {
      for (let rx = -2; rx <= 2; rx++) {
        const nx = cx + rx;
        const nz = cz + rz;
        if (nx < 0 || nx >= g.width || nz < 0 || nz >= g.height) continue;
        const idx = nz * g.width + nx;
        if (g.blocked[idx] === 0) {
          const dSq = rx * rx + rz * rz;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestIdx = idx;
          }
        }
      }
    }
    return bestIdx;
  }

  private beginSearchGeneration(): number {
    this.currentSearchId = (this.currentSearchId + 1) >>> 0;
    if (this.currentSearchId === 0) {
      this.visitedGen.fill(0);
      this.closedGen.fill(0);
      this.heapGen.fill(0);
      this.currentSearchId = 1;
    }
    this.heapSize = 0;
    return this.currentSearchId;
  }

  setSearchGenerationForTest(gen: number): void {
    this.currentSearchId = gen >>> 0;
  }

  getSearchGeneration(): number {
    return this.currentSearchId;
  }

  private isInOpenHeap(nodeIdx: number): boolean {
    return this.heapGen[nodeIdx] === this.currentSearchId && this.heapPos[nodeIdx] > 0;
  }

  private isHigherPriority(nodeA: number, nodeB: number): boolean {
    const diffF = this.fScore[nodeA] - this.fScore[nodeB];
    if (Math.abs(diffF) > 1e-5) return diffF < 0;
    const diffG = this.gScore[nodeA] - this.gScore[nodeB];
    if (Math.abs(diffG) > 1e-5) return diffG > 0;
    return nodeA < nodeB;
  }

  private swapHeap(i: number, j: number): void {
    const nodeI = this.heapNodes[i];
    const nodeJ = this.heapNodes[j];
    this.heapNodes[i] = nodeJ;
    this.heapNodes[j] = nodeI;
    this.heapPos[nodeJ] = i;
    this.heapPos[nodeI] = j;
  }

  private siftUp(pos: number): void {
    let idx = pos;
    while (idx > 1) {
      const parentPos = idx >>> 1;
      if (this.isHigherPriority(this.heapNodes[idx], this.heapNodes[parentPos])) {
        this.swapHeap(idx, parentPos);
        idx = parentPos;
      } else {
        break;
      }
    }
  }

  private siftDown(pos: number): void {
    let idx = pos;
    const size = this.heapSize;
    while (true) {
      const left = idx << 1;
      if (left > size) break;
      const right = left + 1;
      let bestChild = left;
      if (right <= size && this.isHigherPriority(this.heapNodes[right], this.heapNodes[left])) {
        bestChild = right;
      }
      if (this.isHigherPriority(this.heapNodes[bestChild], this.heapNodes[idx])) {
        this.swapHeap(idx, bestChild);
        idx = bestChild;
      } else {
        break;
      }
    }
  }

  private heapPush(nodeIdx: number): void {
    if (this.heapSize >= this.totalCells) return;
    const pos = ++this.heapSize;
    this.heapNodes[pos] = nodeIdx;
    this.heapGen[nodeIdx] = this.currentSearchId;
    this.heapPos[nodeIdx] = pos;
    this.siftUp(pos);
  }

  private heapPop(): number {
    const top = this.heapNodes[1];
    this.heapPos[top] = 0;
    this.heapGen[top] = 0;
    const last = this.heapNodes[this.heapSize--];
    if (this.heapSize > 0) {
      this.heapNodes[1] = last;
      this.heapPos[last] = 1;
      this.siftDown(1);
    }
    return top;
  }

  inspectHeapForTest(): {
    size: number;
    nodes: number[];
    heapPosMatches: boolean;
    hasDuplicates: boolean;
  } {
    const nodes: number[] = [];
    const seen = new Set<number>();
    let heapPosMatches = true;
    let hasDuplicates = false;
    for (let i = 1; i <= this.heapSize; i++) {
      const n = this.heapNodes[i];
      nodes.push(n);
      if (seen.has(n)) hasDuplicates = true;
      seen.add(n);
      if (this.heapPos[n] !== i || this.heapGen[n] !== this.currentSearchId) {
        heapPosMatches = false;
      }
    }
    return { size: this.heapSize, nodes, heapPosMatches, hasDuplicates };
  }

  isNodeOpenForTest(nodeIdx: number): boolean {
    return this.isInOpenHeap(nodeIdx);
  }

  /**
   * Computes the next smooth waypoint from (sx, sz) toward (tx, tz) on surface 0 into `this.outWaypoint`.
   * Preserves exact Stage 1–4B 2D contract for all existing callers and tests.
   */
  computeNextWaypoint(
    sx: number,
    sz: number,
    tx: number,
    tz: number,
    maxIter: number = NAV_GRID_DEFAULTS.maxIter
  ): boolean {
    const g = this.grid;
    if (!g) {
      this.outWaypoint[0] = tx;
      this.outWaypoint[1] = tz;
      this.lastIterations = 0;
      this.lastExhaustedBudget = false;
      this.lastGoalReached = false;
      this.lastChainLength = 0;
      this.lastPathDistanceMeters = 0;
      return false;
    }
    return this.runLocalAStar(g, sx, sz, tx, tz, maxIter, false);
  }

  /**
   * Hierarchical Hybrid Multi-Elevation A*:
   * Routes across ground surface `0` and any number of bounded elevated surfaces `1..M`
   * through capability-validated portals with precomputed intra-surface portal distances,
   * dynamic cargo lift wait costs, and admissible 3D Euclidean heuristic.
   * Writes lossless results into `outCoords` ([wx, wy, wz]) and `outMeta` ([surfaceId, portalId, traversalFlags, targetFloorIndex]).
   */
  computeNextWaypoint3D(
    sx: number,
    sy: number,
    sz: number,
    tx: number,
    ty: number,
    tz: number,
    profileCode = 1,
    outCoords: Float32Array = this.outWaypoint3D,
    outMeta: Int32Array = this.outMeta3D,
    maxIter: number = NAV_GRID_DEFAULTS.maxIter
  ): boolean {
    const startSurfId = this.resolveSurfaceId(sx, sy, sz);
    const goalSurfId = this.resolveSurfaceId(tx, ty, tz);
    const startSurf = this.surfaces.get(startSurfId) ?? this.grid;
    const goalSurf = this.surfaces.get(goalSurfId) ?? this.grid;

    if (!startSurf || !goalSurf) {
      outCoords[0] = tx;
      outCoords[1] = ty;
      outCoords[2] = tz;
      outMeta[0] = 0;
      outMeta[1] = -1;
      outMeta[2] = TRAVERSAL_FLAGS.PARTIAL_PATH;
      outMeta[3] = -1;
      return false;
    }

    const startSurfY =
      'elevationY' in startSurf && typeof startSurf.elevationY === 'number'
        ? startSurf.elevationY
        : 0;

    // 1. Same-surface fast path
    let savedSameSurfaceWx = tx;
    let savedSameSurfaceWz = tz;
    let savedSameSurfacePartial = false;

    if (startSurfId === goalSurfId) {
      const ok = this.runLocalAStar(startSurf, sx, sz, tx, tz, maxIter, true);
      if (ok && this.lastGoalReached) {
        outCoords[0] = this.outWaypoint[0];
        outCoords[1] = startSurfY;
        outCoords[2] = this.outWaypoint[1];
        outMeta[0] = startSurfId;
        outMeta[1] = -1;
        outMeta[2] = TRAVERSAL_FLAGS.NONE;
        outMeta[3] = -1;
        return true;
      }
      if (ok) {
        savedSameSurfaceWx = this.outWaypoint[0];
        savedSameSurfaceWz = this.outWaypoint[1];
        savedSameSurfacePartial = true;
      }
    }

    // 2. Hierarchical Portal Graph Search (handles cross-elevation AND disconnected same-surface detours)
    this.lastPortalAStarCalls = 0;
    const E = this.directedEdges.length;
    if (E > 0) {
      this.flushDirtySurfaceDistances();
      const profile = getAgentProfileByCode(profileCode);
      let startCandCount = 0;
      let goalCandCount = 0;
      for (let i = 0; i < E; i++) {
        const edge = this.directedEdges[i];
        const compat = canAgentUsePortal(profile, edge) ? 1 : 0;
        this.edgeCompatible[i] = compat;
        this.edgeStartDist[i] = Infinity;
        this.edgeGoalDist[i] = Infinity;
        this.edgeStartEvaluated[i] = 0;
        this.edgeGoalEvaluated[i] = 0;
        if (compat === 0) continue;
        if (edge.entrySurfaceId === startSurfId) {
          const dxs = edge.entryX - sx;
          const dzs = edge.entryZ - sz;
          this.edgeStartCandIdx[startCandCount] = i;
          this.edgeStartCandDistSq[startCandCount] = dxs * dxs + dzs * dzs;
          startCandCount++;
        }
        if (edge.exitSurfaceId === goalSurfId) {
          const dxg = edge.exitX - tx;
          const dzg = edge.exitZ - tz;
          this.edgeGoalCandIdx[goalCandCount] = i;
          this.edgeGoalCandDistSq[goalCandCount] = dxg * dxg + dzg * dzg;
          goalCandCount++;
        }
      }

      const K_NEAREST_PORTALS = 4;
      const selectKNearest = (
        indices: Int32Array,
        distSq: Float32Array,
        count: number,
        k: number
      ): number => {
        const limit = Math.min(count, k);
        for (let a = 0; a < limit; a++) {
          let best = a;
          let bestD = distSq[a];
          for (let b = a + 1; b < count; b++) {
            if (distSq[b] < bestD) {
              bestD = distSq[b];
              best = b;
            }
          }
          if (best !== a) {
            const tmpIdx = indices[a];
            indices[a] = indices[best];
            indices[best] = tmpIdx;
            const tmpD = distSq[a];
            distSq[a] = distSq[best];
            distSq[best] = tmpD;
          }
        }
        return limit;
      };

      const localBudget = Math.min(maxIter, 1600);
      const evalStartRange = (fromIdx: number, toIdx: number): void => {
        for (let c = fromIdx; c < toIdx; c++) {
          const i = this.edgeStartCandIdx[c];
          if (this.edgeStartEvaluated[i] === 1) continue;
          this.edgeStartEvaluated[i] = 1;
          const edge = this.directedEdges[i];
          this.lastPortalAStarCalls++;
          const ok = this.runLocalAStar(
            startSurf,
            sx,
            sz,
            edge.entryX,
            edge.entryZ,
            localBudget,
            true
          );
          if (ok && this.lastGoalReached) {
            this.edgeStartDist[i] = this.lastPathDistanceMeters;
          }
        }
      };

      const evalGoalRange = (fromIdx: number, toIdx: number): void => {
        for (let c = fromIdx; c < toIdx; c++) {
          const i = this.edgeGoalCandIdx[c];
          if (this.edgeGoalEvaluated[i] === 1) continue;
          this.edgeGoalEvaluated[i] = 1;
          const edge = this.directedEdges[i];
          this.lastPortalAStarCalls++;
          const ok = this.runLocalAStar(
            goalSurf,
            edge.exitX,
            edge.exitZ,
            tx,
            tz,
            localBudget,
            true
          );
          if (ok && this.lastGoalReached) {
            this.edgeGoalDist[i] = this.lastPathDistanceMeters;
          }
        }
      };

      const startInitialK = selectKNearest(
        this.edgeStartCandIdx,
        this.edgeStartCandDistSq,
        startCandCount,
        K_NEAREST_PORTALS
      );
      const goalInitialK = selectKNearest(
        this.edgeGoalCandIdx,
        this.edgeGoalCandDistSq,
        goalCandCount,
        K_NEAREST_PORTALS
      );

      evalStartRange(0, startInitialK);
      evalGoalRange(0, goalInitialK);

      let bestFinalCost = Infinity;
      let bestFinalEdge = -1;
      let bestClosestHeuristic = Infinity;
      let bestClosestEdge = -1;

      const relaxPortalGraph = (): void => {
        bestFinalCost = Infinity;
        bestFinalEdge = -1;
        bestClosestHeuristic = Infinity;
        bestClosestEdge = -1;

        for (let i = 0; i < E; i++) {
          this.edgeBestCost[i] = Infinity;
          this.edgePrev[i] = -1;
          this.edgeClosed[i] = 0;
          if (this.edgeCompatible[i] === 0 || this.edgeStartDist[i] === Infinity) continue;
          const edge = this.directedEdges[i];
          const occPenalty =
            edge.maxConcurrentOccupants > 0 && edge.activeOccupants >= edge.maxConcurrentOccupants
              ? 14
              : 0;
          this.edgeBestCost[i] =
            this.edgeStartDist[i] + edge.baseCost + edge.dynamicWaitCost + occPenalty;
        }

        // Exact A*/Dijkstra over E directed portal edges
        for (let step = 0; step < E; step++) {
          let pick = -1;
          let pickF = Infinity;
          for (let i = 0; i < E; i++) {
            if (this.edgeClosed[i] === 1 || this.edgeBestCost[i] === Infinity) continue;
            const edge = this.directedEdges[i];
            const h = Math.hypot(tx - edge.exitX, ty - edge.exitY, tz - edge.exitZ);
            const f = this.edgeBestCost[i] + h;
            if (f < pickF) {
              pickF = f;
              pick = i;
            }
          }
          if (pick === -1) break;
          if (pickF >= bestFinalCost) break;

          this.edgeClosed[pick] = 1;
          const pickedEdge = this.directedEdges[pick];
          const exitH = Math.hypot(
            tx - pickedEdge.exitX,
            ty - pickedEdge.exitY,
            tz - pickedEdge.exitZ
          );
          if (exitH < bestClosestHeuristic) {
            bestClosestHeuristic = exitH;
            bestClosestEdge = pick;
          }

          if (this.edgeGoalDist[pick] < Infinity) {
            const candidateTotal = this.edgeBestCost[pick] + this.edgeGoalDist[pick];
            if (candidateTotal < bestFinalCost) {
              bestFinalCost = candidateTotal;
              bestFinalEdge = pick;
            }
          }

          for (let nxt = 0; nxt < E; nxt++) {
            if (this.edgeCompatible[nxt] === 0 || this.edgeClosed[nxt] === 1) continue;
            const pairDist = this.edgePairDist[pick * E + nxt];
            if (!Number.isFinite(pairDist)) continue;
            const nxtEdge = this.directedEdges[nxt];
            const occPenalty =
              nxtEdge.maxConcurrentOccupants > 0 &&
              nxtEdge.activeOccupants >= nxtEdge.maxConcurrentOccupants
                ? 14
                : 0;
            const cand =
              this.edgeBestCost[pick] +
              pairDist +
              nxtEdge.baseCost +
              nxtEdge.dynamicWaitCost +
              occPenalty;
            if (cand < this.edgeBestCost[nxt]) {
              this.edgeBestCost[nxt] = cand;
              this.edgePrev[nxt] = pick;
            }
          }
        }
      };

      relaxPortalGraph();

      // Automatic fallback expansion when K-nearest portals are blocked or yield a severe detour (>2.5x direct 3D distance)
      const direct3D = Math.hypot(tx - sx, ty - sy, tz - sz);
      const hasRemainingPortals = startCandCount > startInitialK || goalCandCount > goalInitialK;
      if (
        hasRemainingPortals &&
        (bestFinalEdge === -1 || bestFinalCost > Math.max(12, direct3D * 2.5))
      ) {
        evalStartRange(startInitialK, startCandCount);
        evalGoalRange(goalInitialK, goalCandCount);
        relaxPortalGraph();
      }

      const chosenTerminalEdge = bestFinalEdge !== -1 ? bestFinalEdge : bestClosestEdge;
      const isComplete = bestFinalEdge !== -1;

      if (chosenTerminalEdge !== -1) {
        let firstEdgeIdx = chosenTerminalEdge;
        while (this.edgePrev[firstEdgeIdx] !== -1) {
          firstEdgeIdx = this.edgePrev[firstEdgeIdx];
        }
        const firstEdge = this.directedEdges[firstEdgeIdx];
        const distToEntryXZ = Math.hypot(firstEdge.entryX - sx, firstEdge.entryZ - sz);
        const distToEntryY = Math.abs(firstEdge.entryY - sy);
        const partialMask = isComplete ? 0 : TRAVERSAL_FLAGS.PARTIAL_PATH;

        // If at portal entry (within 1.5m), emit portal traversal or lift boarding instruction
        if (distToEntryXZ <= 1.55 && distToEntryY <= 1.3) {
          outCoords[0] = firstEdge.exitX;
          outCoords[1] = firstEdge.exitY;
          outCoords[2] = firstEdge.exitZ;
          outMeta[0] = firstEdge.exitSurfaceId;
          outMeta[1] = firstEdge.portalId;
          outMeta[2] =
            (firstEdge.kind === 'cargo_lift'
              ? TRAVERSAL_FLAGS.LIFT_WAIT_BOARD | TRAVERSAL_FLAGS.PORTAL_TRAVERSE
              : TRAVERSAL_FLAGS.PORTAL_TRAVERSE) | partialMask;
          outMeta[3] = firstEdge.toFloorIndex;
          return true;
        }

        // Route along current surface toward first portal entry
        this.runLocalAStar(startSurf, sx, sz, firstEdge.entryX, firstEdge.entryZ, maxIter, true);
        outCoords[0] = this.outWaypoint[0];
        outCoords[1] = startSurfY;
        outCoords[2] = this.outWaypoint[1];
        outMeta[0] = startSurfId;
        outMeta[1] = firstEdge.portalId;
        outMeta[2] = TRAVERSAL_FLAGS.PORTAL_APPROACH | partialMask;
        outMeta[3] = firstEdge.fromFloorIndex;
        return true;
      }
    }

    // 3. Partial fallback on start surface
    if (savedSameSurfacePartial) {
      outCoords[0] = savedSameSurfaceWx;
      outCoords[1] = startSurfY;
      outCoords[2] = savedSameSurfaceWz;
      outMeta[0] = startSurfId;
      outMeta[1] = -1;
      outMeta[2] = TRAVERSAL_FLAGS.PARTIAL_PATH;
      outMeta[3] = -1;
      return true;
    }

    this.runLocalAStar(startSurf, sx, sz, tx, tz, maxIter, true);
    outCoords[0] = this.outWaypoint[0];
    outCoords[1] = startSurfY;
    outCoords[2] = this.outWaypoint[1];
    outMeta[0] = startSurfId;
    outMeta[1] = -1;
    outMeta[2] = this.lastGoalReached ? TRAVERSAL_FLAGS.NONE : TRAVERSAL_FLAGS.PARTIAL_PATH;
    outMeta[3] = -1;
    return this.lastGoalReached;
  }

  private runLocalAStar(
    g: NavGridState,
    sx: number,
    sz: number,
    tx: number,
    tz: number,
    maxIter: number,
    allowNearestStartSnap: boolean
  ): boolean {
    let startIdx = worldToCellIndex(sx, sz, g);
    let goalIdx = worldToCellIndex(tx, tz, g);
    if (startIdx === -1 || goalIdx === -1) {
      this.oobQueryCount++;
      this.outWaypoint[0] = tx;
      this.outWaypoint[1] = tz;
      this.lastIterations = 0;
      this.lastExhaustedBudget = false;
      this.lastGoalReached = false;
      this.lastChainLength = 0;
      this.lastPathDistanceMeters = Infinity;
      return false;
    }

    if (allowNearestStartSnap) {
      if (g.blocked[startIdx] === 1) {
        const snapped = this.findNearestWalkableCell(startIdx, g);
        if (snapped !== -1) startIdx = snapped;
      }
      if (g.blocked[goalIdx] === 1) {
        const snappedGoal = this.findNearestWalkableCell(goalIdx, g);
        if (snappedGoal !== -1) goalIdx = snappedGoal;
      }
    }

    if (startIdx === goalIdx) {
      this.outWaypoint[0] = tx;
      this.outWaypoint[1] = tz;
      this.lastIterations = 0;
      this.lastExhaustedBudget = false;
      this.lastGoalReached = g.blocked[goalIdx] === 0;
      this.lastChainLength = 1;
      this.lastPathDistanceMeters = Math.hypot(tx - sx, tz - sz);
      return true;
    }

    const w = g.width;
    const h = g.height;
    const blocked = g.blocked;

    const scx = startIdx % w;
    const scz = (startIdx / w) | 0;
    const tcx = goalIdx % w;
    const tcz = (goalIdx / w) | 0;

    const searchId = this.beginSearchGeneration();
    const startH = Math.hypot(tcx - scx, tcz - scz);

    this.visitedGen[startIdx] = searchId;
    this.gScore[startIdx] = 0;
    this.fScore[startIdx] = startH;
    this.parent[startIdx] = -1;
    this.heapPush(startIdx);

    let bestHeuristicNode = startIdx;
    let bestH = startH;
    let bestGAtH = 0;
    let goalReached = false;
    let iterations = 0;

    while (this.heapSize > 0 && iterations < maxIter) {
      iterations++;
      const curr = this.heapPop();
      if (curr === goalIdx) {
        bestHeuristicNode = curr;
        goalReached = true;
        break;
      }

      this.closedGen[curr] = searchId;

      const cx = curr % w;
      const cz = (curr / w) | 0;
      const dGoal = Math.hypot(tcx - cx, tcz - cz);
      const currG = this.gScore[curr];
      if (dGoal < bestH - 1e-4 || (Math.abs(dGoal - bestH) <= 1e-4 && currG < bestGAtH)) {
        bestH = dGoal;
        bestGAtH = currG;
        bestHeuristicNode = curr;
      }

      for (let d = 0; d < 8; d++) {
        const dx = DIRS_DX[d];
        const dz = DIRS_DZ[d];
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;

        const nIdx = nz * w + nx;
        if (this.closedGen[nIdx] === searchId) continue;
        if (blocked[nIdx] === 1) continue;

        if (dx !== 0 && dz !== 0) {
          const adj1 = cz * w + (cx + dx);
          const adj2 = (cz + dz) * w + cx;
          if (blocked[adj1] === 1 || blocked[adj2] === 1) continue;
        }

        const tentativeG = currG + DIRS_COST[d];
        if (this.visitedGen[nIdx] !== searchId) {
          this.visitedGen[nIdx] = searchId;
          this.parent[nIdx] = curr;
          this.gScore[nIdx] = tentativeG;
          this.fScore[nIdx] = tentativeG + Math.hypot(tcx - nx, tcz - nz);
          this.heapPush(nIdx);
        } else if (tentativeG < this.gScore[nIdx]) {
          this.parent[nIdx] = curr;
          this.gScore[nIdx] = tentativeG;
          this.fScore[nIdx] = tentativeG + Math.hypot(tcx - nx, tcz - nz);
          if (this.isInOpenHeap(nIdx)) {
            this.siftUp(this.heapPos[nIdx]);
          } else {
            this.heapPush(nIdx);
          }
        }
      }
    }

    this.lastIterations = iterations;
    this.lastExhaustedBudget = !goalReached && iterations >= maxIter;
    this.lastGoalReached = goalReached;

    const targetNode = goalReached ? goalIdx : bestHeuristicNode;
    this.lastPathDistanceMeters = this.gScore[targetNode] * g.cellSize;

    if (targetNode === startIdx) {
      cellIndexToWorld(startIdx, g, this.outWaypoint);
      this.lastChainLength = 1;
      return true;
    }

    let len = 0;
    let trace = targetNode;
    const maxLen = w * h;
    while (trace !== -1 && len < maxLen) {
      this.pathChainScratch[len++] = trace;
      if (trace === startIdx) break;
      trace = this.parent[trace];
    }

    if (len <= 1) {
      cellIndexToWorld(startIdx, g, this.outWaypoint);
      this.lastChainLength = len;
      return true;
    }

    for (let lo = 0, hi = len - 1; lo < hi; lo++, hi--) {
      const tmp = this.pathChainScratch[lo];
      this.pathChainScratch[lo] = this.pathChainScratch[hi];
      this.pathChainScratch[hi] = tmp;
    }
    this.lastChainLength = len;

    let chosenIdx = this.pathChainScratch[1];
    for (let i = len - 1; i >= 2; i--) {
      const cand = this.pathChainScratch[i];
      const ccx = cand % w;
      const ccz = (cand / w) | 0;
      if (hasGridLineOfSight(scx, scz, ccx, ccz, g)) {
        chosenIdx = cand;
        break;
      }
    }

    if (goalReached && chosenIdx === goalIdx) {
      this.outWaypoint[0] = tx;
      this.outWaypoint[1] = tz;
    } else {
      cellIndexToWorld(chosenIdx, g, this.outWaypoint);
    }
    return true;
  }
}
