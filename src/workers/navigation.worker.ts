// Pure Web Worker for tactical A* pathfinding and cover evaluation.
// Zero Three.js imports — communicates exclusively via typed headers and Transferable TypedArrays.

interface GridState {
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
  blocked: Uint8Array;
}

let grid: GridState | null = null;
let minValidVersion = 0;

function worldToCell(wx: number, wz: number, g: GridState): [number, number] {
  const cx = Math.max(0, Math.min(g.width - 1, Math.floor((wx - g.originX) / g.cellSize)));
  const cz = Math.max(0, Math.min(g.height - 1, Math.floor((wz - g.originZ) / g.cellSize)));
  return [cx, cz];
}

function cellToWorld(cx: number, cz: number, g: GridState): [number, number] {
  return [g.originX + (cx + 0.5) * g.cellSize, g.originZ + (cz + 0.5) * g.cellSize];
}

function computeNextWaypoint(
  sx: number,
  sz: number,
  tx: number,
  tz: number,
  g: GridState
): [number, number] {
  const [scx, scz] = worldToCell(sx, sz, g);
  const [tcx, tcz] = worldToCell(tx, tz, g);
  if (scx === tcx && scz === tcz) return [tx, tz];

  const total = g.width * g.height;
  const gScore = new Float32Array(total);
  gScore.fill(1e9);
  const parent = new Int32Array(total);
  parent.fill(-1);
  const closed = new Uint8Array(total);

  const startIdx = scz * g.width + scx;
  const goalIdx = tcz * g.width + tcx;
  gScore[startIdx] = 0;

  const open: number[] = [startIdx];
  const fScore = new Float32Array(total);
  fScore[startIdx] = Math.hypot(tcx - scx, tcz - scz);

  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [-1, 1, 1.414],
    [1, -1, 1.414],
    [-1, -1, 1.414],
  ];

  let bestNode = startIdx;
  let bestDist = Math.hypot(tcx - scx, tcz - scz);
  let iterations = 0;
  const maxIter = 180;

  while (open.length > 0 && iterations < maxIter) {
    iterations++;
    let bestPos = 0;
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestPos]]) bestPos = i;
    }
    const curr = open.splice(bestPos, 1)[0];
    if (curr === goalIdx) {
      bestNode = curr;
      break;
    }
    closed[curr] = 1;

    const cx = curr % g.width;
    const cz = Math.floor(curr / g.width);
    const dGoal = Math.hypot(tcx - cx, tcz - cz);
    if (dGoal < bestDist) {
      bestDist = dGoal;
      bestNode = curr;
    }

    for (let d = 0; d < dirs.length; d++) {
      const nx = cx + dirs[d][0];
      const nz = cz + dirs[d][1];
      if (nx < 0 || nx >= g.width || nz < 0 || nz >= g.height) continue;
      const nIdx = nz * g.width + nx;
      if (closed[nIdx]) continue;
      if (g.blocked[nIdx] === 1 && nIdx !== goalIdx) continue;

      const tentativeG = gScore[curr] + dirs[d][2];
      if (tentativeG < gScore[nIdx]) {
        parent[nIdx] = curr;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + Math.hypot(tcx - nx, tcz - nz);
        if (!open.includes(nIdx)) open.push(nIdx);
      }
    }
  }

  // Walk back to first step after start
  let trace = bestNode;
  let prev = parent[trace];
  while (prev !== -1 && prev !== startIdx) {
    trace = prev;
    prev = parent[trace];
  }
  if (trace === startIdx) return [tx, tz];

  const wx = trace % g.width;
  const wz = Math.floor(trace / g.width);
  return cellToWorld(wx, wz, g);
}

self.onmessage = (ev: MessageEvent) => {
  const startMs = performance.now();
  const data = ev.data as {
    jobId: number;
    jobVersion: number;
    type: string;
    gridWidth?: number;
    gridHeight?: number;
    cellSize?: number;
    originX?: number;
    originZ?: number;
    blockedBuffer?: ArrayBuffer;
    queriesBuffer?: ArrayBuffer;
    queryCount?: number;
  };

  if (data.type === 'cancel_before') {
    minValidVersion = Math.max(minValidVersion, data.jobVersion);
    return;
  }

  if (data.jobVersion < minValidVersion) return;

  try {
    if (data.type === 'init_grid' && data.blockedBuffer && data.gridWidth && data.gridHeight) {
      grid = {
        width: data.gridWidth,
        height: data.gridHeight,
        cellSize: data.cellSize ?? 4,
        originX: data.originX ?? -120,
        originZ: data.originZ ?? -120,
        blocked: new Uint8Array(data.blockedBuffer),
      };
      self.postMessage({
        jobId: data.jobId,
        jobVersion: data.jobVersion,
        type: 'grid_ready',
        computeMs: performance.now() - startMs,
      });
      return;
    }

    if (data.type === 'compute_paths' && data.queriesBuffer && data.queryCount !== undefined) {
      const queries = new Float32Array(data.queriesBuffer);
      const count = data.queryCount;
      const results = new Float32Array(count * 2);

      for (let i = 0; i < count; i++) {
        const sx = queries[i * 4];
        const sz = queries[i * 4 + 1];
        const tx = queries[i * 4 + 2];
        const tz = queries[i * 4 + 3];
        if (!grid) {
          results[i * 2] = tx;
          results[i * 2 + 1] = tz;
        } else {
          const [wx, wz] = computeNextWaypoint(sx, sz, tx, tz, grid);
          results[i * 2] = wx;
          results[i * 2 + 1] = wz;
        }
      }

      (self as unknown as { postMessage: (m: unknown, transfer: Transferable[]) => void }).postMessage(
        {
          jobId: data.jobId,
          jobVersion: data.jobVersion,
          type: 'paths_result',
          computeMs: performance.now() - startMs,
          resultBuffer: results.buffer,
          resultCount: count,
        },
        [results.buffer]
      );
    }
  } catch (err) {
    self.postMessage({
      jobId: data.jobId,
      jobVersion: data.jobVersion,
      type: 'worker_error',
      computeMs: performance.now() - startMs,
      errorMessage: err instanceof Error ? err.message : 'Worker failure',
    });
  }
};
