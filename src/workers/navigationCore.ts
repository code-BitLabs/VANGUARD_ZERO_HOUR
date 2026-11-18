// Pure tactical A* navigation core with persistent typed buffers, 1-indexed binary min-heap,
// explicit out-of-bounds sentinel handling, generation-counter search state, and Bresenham LOS string-pulling.
// Zero Three.js, DOM, or Web Worker globals so both navigation.worker.ts and Vitest unit/benchmark suites share one implementation.

export const NAV_GRID_DEFAULTS = {
  width: 160,
  height: 160,
  cellSize: 2,
  originX: -160,
  originZ: -160,
  maxIter: 4096,
} as const;

export interface NavGridState {
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
  blocked: Uint8Array;
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
      // Check both orthogonal neighbors before taking a diagonal step so corners are never clipped
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
 * Zero-allocation A* solver over a NavGridState using a 1-indexed binary min-heap
 * and generation counters. All buffers are allocated once per grid dimensions.
 */
export class NavigationSolver {
  private grid: NavGridState | null = null;
  private totalCells = 0;

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
  public readonly outWaypoint = new Float32Array(2);

  private currentSearchId = 0;
  public oobQueryCount = 0;
  public lastIterations = 0;
  public lastExhaustedBudget = false;
  public lastGoalReached = false;
  public lastChainLength = 0;

  initGrid(
    width: number,
    height: number,
    cellSize: number,
    originX: number,
    originZ: number,
    blocked: Uint8Array
  ): void {
    const total = width * height;
    this.grid = {
      width,
      height,
      cellSize,
      originX,
      originZ,
      blocked,
    };

    if (total !== this.totalCells) {
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
      this.currentSearchId = 0;
    } else {
      this.visitedGen.fill(0);
      this.closedGen.fill(0);
      this.heapGen.fill(0);
      this.currentSearchId = 0;
    }
    this.heapSize = 0;
  }

  getGrid(): NavGridState | null {
    return this.grid;
  }

  applyCellUpdates(updates: Uint16Array): number {
    if (!this.grid) return 0;
    return applyCellUpdates(updates, this.grid);
  }

  /**
   * Advances generation counter safely and resets all generation state on uint32 wraparound.
   */
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

  /** Test/diagnostic hook to verify wraparound behavior at 0xffffffff -> 0 -> 1 without running 4B searches. */
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

  /** Exposes current open-heap debug snapshot for invariant verification in unit tests. */
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
   * Computes the next smooth waypoint from (sx, sz) toward (tx, tz) into `this.outWaypoint`.
   * Returns `true` when both endpoints are in-bounds and a waypoint was resolved,
   * or `false` if either endpoint is out-of-bounds or no grid is initialized.
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
      return false;
    }

    const startIdx = worldToCellIndex(sx, sz, g);
    const goalIdx = worldToCellIndex(tx, tz, g);
    if (startIdx === -1 || goalIdx === -1) {
      this.oobQueryCount++;
      this.outWaypoint[0] = tx;
      this.outWaypoint[1] = tz;
      this.lastIterations = 0;
      this.lastExhaustedBudget = false;
      this.lastGoalReached = false;
      this.lastChainLength = 0;
      return false;
    }

    if (startIdx === goalIdx) {
      this.outWaypoint[0] = tx;
      this.outWaypoint[1] = tz;
      this.lastIterations = 0;
      this.lastExhaustedBudget = false;
      this.lastGoalReached = g.blocked[goalIdx] === 0;
      this.lastChainLength = 1;
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

        // Prevent diagonal corner-cutting across orthogonal blocked cells
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
    if (targetNode === startIdx) {
      // Completely boxed-in or already at closest reachable cell outside blocked goal: stay at cell center
      cellIndexToWorld(startIdx, g, this.outWaypoint);
      this.lastChainLength = 1;
      return true;
    }

    // Reconstruct path chain in reverse [targetNode .. startIdx], then reverse in place
    let len = 0;
    let trace = targetNode;
    while (trace !== -1 && len < this.totalCells) {
      this.pathChainScratch[len++] = trace;
      if (trace === startIdx) break;
      trace = this.parent[trace];
    }

    if (len <= 1) {
      cellIndexToWorld(startIdx, g, this.outWaypoint);
      this.lastChainLength = len;
      return true;
    }

    // Reverse scratch slice [0 .. len - 1] so index 0 is startIdx and len - 1 is targetNode
    for (let lo = 0, hi = len - 1; lo < hi; lo++, hi--) {
      const tmp = this.pathChainScratch[lo];
      this.pathChainScratch[lo] = this.pathChainScratch[hi];
      this.pathChainScratch[hi] = tmp;
    }
    this.lastChainLength = len;

    // Zero-alloc Bresenham LOS string-pulling: pick furthest directly visible cell along chain
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
      // Direct unobstructed LOS all the way to goal cell: aim cleanly at exact world target
      this.outWaypoint[0] = tx;
      this.outWaypoint[1] = tz;
    } else {
      cellIndexToWorld(chosenIdx, g, this.outWaypoint);
    }
    return true;
  }
}
