// Pure Web Worker for Hierarchical Hybrid Multi-Elevation tactical A* pathfinding and incremental updates.
// Zero Three.js imports — communicates exclusively via typed headers and lossless Transferable TypedArrays.

import {
  ElevatedNavSurfaceInput,
  NAV_GRID_DEFAULTS,
  NavigationSolver,
  NavPortalInput,
} from './navigationCore';

const solver = new NavigationSolver();
let minValidVersion = 0;

interface WireElevatedSurface {
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
  blockedBuffer: ArrayBuffer;
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
    surfaceId?: number;
    portalId?: number;
    portalEnabled?: boolean;
    dynamicWaitCost?: number;
    activeOccupants?: number;
    blockedBuffer?: ArrayBuffer;
    elevatedSurfaces?: WireElevatedSurface[];
    portals?: NavPortalInput[];
    cellUpdatesBuffer?: ArrayBuffer;
    queriesBuffer?: ArrayBuffer;
    queriesCoordsBuffer?: ArrayBuffer;
    queriesMetaBuffer?: ArrayBuffer;
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

    if (
      data.type === 'init_navigation_surfaces' &&
      data.blockedBuffer &&
      data.gridWidth &&
      data.gridHeight
    ) {
      const elevated: ElevatedNavSurfaceInput[] = (data.elevatedSurfaces ?? []).map((s) => ({
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
        blocked: new Uint8Array(s.blockedBuffer),
      }));
      solver.initMultiSurfaceNavigation(
        {
          width: data.gridWidth,
          height: data.gridHeight,
          cellSize: data.cellSize ?? NAV_GRID_DEFAULTS.cellSize,
          originX: data.originX ?? NAV_GRID_DEFAULTS.originX,
          originZ: data.originZ ?? NAV_GRID_DEFAULTS.originZ,
          blocked: new Uint8Array(data.blockedBuffer),
        },
        elevated,
        data.portals ?? []
      );
      self.postMessage({
        jobId: data.jobId,
        jobVersion: data.jobVersion,
        type: 'surfaces_ready',
        computeMs: performance.now() - startMs,
      });
      return;
    }

    if (
      (data.type === 'update_cells' || data.type === 'update_surface_cells') &&
      data.cellUpdatesBuffer
    ) {
      solver.applyCellUpdates(new Uint16Array(data.cellUpdatesBuffer), data.surfaceId ?? 0);
      self.postMessage({
        jobId: data.jobId,
        jobVersion: data.jobVersion,
        type: data.type === 'update_surface_cells' ? 'surface_updated' : 'cells_updated',
        computeMs: performance.now() - startMs,
      });
      return;
    }

    if (data.type === 'update_portal_state' && data.portalId !== undefined) {
      solver.updatePortalState(
        data.portalId,
        data.portalEnabled,
        data.dynamicWaitCost,
        data.activeOccupants
      );
      self.postMessage({
        jobId: data.jobId,
        jobVersion: data.jobVersion,
        type: 'portal_updated',
        computeMs: performance.now() - startMs,
      });
      return;
    }

    // Lossless dual-buffer 3D multi-elevation queries
    if (
      data.type === 'compute_paths' &&
      data.queriesCoordsBuffer &&
      data.queriesMetaBuffer &&
      data.queryCount !== undefined
    ) {
      const coords = new Float32Array(data.queriesCoordsBuffer);
      const meta = new Int32Array(data.queriesMetaBuffer);
      const count = data.queryCount;
      const resultCoords = new Float32Array(count * 3);
      const resultMeta = new Int32Array(count * 4);

      for (let i = 0; i < count; i++) {
        const sx = coords[i * 6];
        const sy = coords[i * 6 + 1];
        const sz = coords[i * 6 + 2];
        const tx = coords[i * 6 + 3];
        const ty = coords[i * 6 + 4];
        const tz = coords[i * 6 + 5];
        const profileCode = meta[i * 2];
        solver.computeNextWaypoint3D(sx, sy, sz, tx, ty, tz, profileCode);
        resultCoords[i * 3] = solver.outWaypoint3D[0];
        resultCoords[i * 3 + 1] = solver.outWaypoint3D[1];
        resultCoords[i * 3 + 2] = solver.outWaypoint3D[2];
        resultMeta[i * 4] = solver.outMeta3D[0];
        resultMeta[i * 4 + 1] = solver.outMeta3D[1];
        resultMeta[i * 4 + 2] = solver.outMeta3D[2];
        resultMeta[i * 4 + 3] = solver.outMeta3D[3];
      }

      (self as unknown as { postMessage: (m: unknown, transfer: Transferable[]) => void }).postMessage(
        {
          jobId: data.jobId,
          jobVersion: data.jobVersion,
          type: 'paths_result',
          computeMs: performance.now() - startMs,
          resultCoordsBuffer: resultCoords.buffer,
          resultMetaBuffer: resultMeta.buffer,
          resultCount: count,
        },
        [resultCoords.buffer, resultMeta.buffer]
      );
      return;
    }

    // Legacy 2D query format compatibility
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
