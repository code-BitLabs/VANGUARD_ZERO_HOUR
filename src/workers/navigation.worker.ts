// Pure Web Worker for tactical A* pathfinding and incremental navgrid updates.
// Zero Three.js imports — communicates exclusively via typed headers and Transferable TypedArrays.

import { NAV_GRID_DEFAULTS, NavigationSolver } from './navigationCore';

const solver = new NavigationSolver();
let minValidVersion = 0;

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
    cellUpdatesBuffer?: ArrayBuffer;
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
      solver.initGrid(
        data.gridWidth,
        data.gridHeight,
        data.cellSize ?? NAV_GRID_DEFAULTS.cellSize,
        data.originX ?? NAV_GRID_DEFAULTS.originX,
        data.originZ ?? NAV_GRID_DEFAULTS.originZ,
        new Uint8Array(data.blockedBuffer)
      );
      self.postMessage({
        jobId: data.jobId,
        jobVersion: data.jobVersion,
        type: 'grid_ready',
        computeMs: performance.now() - startMs,
      });
      return;
    }

    if (data.type === 'update_cells' && data.cellUpdatesBuffer) {
      solver.applyCellUpdates(new Uint16Array(data.cellUpdatesBuffer));
      self.postMessage({
        jobId: data.jobId,
        jobVersion: data.jobVersion,
        type: 'cells_updated',
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
        solver.computeNextWaypoint(sx, sz, tx, tz);
        results[i * 2] = solver.outWaypoint[0];
        results[i * 2 + 1] = solver.outWaypoint[1];
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
