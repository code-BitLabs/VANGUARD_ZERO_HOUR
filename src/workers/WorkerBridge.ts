import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { SpatialAABB, SpatialHash, COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { WorkerJobRequestSchema, WorkerJobResponseSchema } from '@/src/schemas/worker.schema';
import { NAV_GRID_DEFAULTS } from './navigationCore';

export interface PathQuery {
  sx: number;
  sz: number;
  tx: number;
  tz: number;
}

export interface PathWaypoint {
  wx: number;
  wz: number;
}

const NAV_OBSTACLE_MASK =
  COLLISION_LAYER.WORLD |
  COLLISION_LAYER.COVER |
  COLLISION_LAYER.WINDOW_SILL |
  COLLISION_LAYER.DESTRUCTIBLE;

function isNavCellBlocked(
  spatialHash: SpatialHash,
  wx: number,
  wz: number,
  scratch: SpatialAABB[],
  groundHeightFn?: (x: number, z: number) => number
): 0 | 1 {
  const hits = spatialHash.queryAABB(
    wx - 0.55,
    wz - 0.55,
    wx + 0.55,
    wz + 0.55,
    NAV_OBSTACLE_MASK,
    scratch
  );

  let hasBridge = false;
  for (let i = 0; i < hits.length; i++) {
    const box = hits[i];
    if (box.tag === 'bridge') {
      hasBridge = true;
    }
    // Block navigation only if the obstacle occupies pedestrian height [0.48m .. 1.85m].
    // Doorway lintels (minY >= 2.4m), bridge decks (maxY <= 0.28m), and ground slabs remain walkable.
    if (box.minY < 1.85 && box.maxY > 0.48) {
      return 1;
    }
  }

  // Deep river channels (e.g. jungle_zone z in (10, 22) outside bridge spans) are impassable on foot
  if (!hasBridge && groundHeightFn && groundHeightFn(wx, wz) <= -0.5) {
    return 1;
  }

  return 0;
}

export class WorkerBridge {
  private worker: Worker | null = null;
  private currentVersion = 1;
  private nextJobId = 1;
  private groundHeightFn?: (x: number, z: number) => number;
  private readonly cellQueryScratch: SpatialAABB[] = [];
  private pendingResolvers = new Map<
    number,
    {
      version: number;
      timerId: number;
      resolve: (waypoints: PathWaypoint[] | null) => void;
    }
  >();
  private healthy = true;

  constructor(
    private readonly resourceManager: ResourceManager,
    private readonly scope: ResourceScope
  ) {
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof Worker === 'undefined') {
      this.healthy = false;
      return;
    }
    try {
      const worker = new Worker(new URL('./navigation.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = this.handleMessage;
      worker.onerror = () => {
        this.healthy = false;
        this.flushPendingWithFallback();
      };
      this.worker = worker;
      this.resourceManager.registerWorker(worker, this.scope, `nav_worker_${this.scope}`);
    } catch {
      this.healthy = false;
    }
  }

  uploadCollisionGrid(
    spatialHash: SpatialHash,
    getGroundHeightAt?: (x: number, z: number) => number
  ): void {
    this.groundHeightFn = getGroundHeightAt;
    if (!this.worker || !this.healthy) return;

    const gridWidth = NAV_GRID_DEFAULTS.width;
    const gridHeight = NAV_GRID_DEFAULTS.height;
    const cellSize = NAV_GRID_DEFAULTS.cellSize;
    const originX = NAV_GRID_DEFAULTS.originX;
    const originZ = NAV_GRID_DEFAULTS.originZ;
    const blocked = new Uint8Array(gridWidth * gridHeight);

    for (let cz = 0; cz < gridHeight; cz++) {
      const wz = originZ + (cz + 0.5) * cellSize;
      for (let cx = 0; cx < gridWidth; cx++) {
        const wx = originX + (cx + 0.5) * cellSize;
        if (isNavCellBlocked(spatialHash, wx, wz, this.cellQueryScratch, this.groundHeightFn) === 1) {
          blocked[cz * gridWidth + cx] = 1;
        }
      }
    }

    const header = WorkerJobRequestSchema.parse({
      jobId: this.nextJobId++,
      jobVersion: this.currentVersion,
      type: 'init_grid',
      gridWidth,
      gridHeight,
      cellSize,
      originX,
      originZ,
    });

    this.worker.postMessage({ ...header, blockedBuffer: blocked.buffer }, [blocked.buffer]);
  }

  /**
   * TRN-01C: Re-rasterizes only the grid cells overlapping a modified/destroyed collider region
   * and pushes compact [cellIndex, blockedFlag] pairs to the worker.
   */
  updateCollisionRegion(
    spatialHash: SpatialHash,
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number
  ): void {
    if (!this.worker || !this.healthy) return;

    const gridWidth = NAV_GRID_DEFAULTS.width;
    const gridHeight = NAV_GRID_DEFAULTS.height;
    const cellSize = NAV_GRID_DEFAULTS.cellSize;
    const originX = NAV_GRID_DEFAULTS.originX;
    const originZ = NAV_GRID_DEFAULTS.originZ;
    const maxWorldX = originX + gridWidth * cellSize;
    const maxWorldZ = originZ + gridHeight * cellSize;

    if (maxX < originX || minX >= maxWorldX || maxZ < originZ || minZ >= maxWorldZ) {
      return;
    }

    const cxMin = Math.max(0, Math.min(gridWidth - 1, Math.floor((minX - originX) / cellSize)));
    const cxMax = Math.max(0, Math.min(gridWidth - 1, Math.floor((maxX - originX) / cellSize)));
    const czMin = Math.max(0, Math.min(gridHeight - 1, Math.floor((minZ - originZ) / cellSize)));
    const czMax = Math.max(0, Math.min(gridHeight - 1, Math.floor((maxZ - originZ) / cellSize)));

    const cellCount = (cxMax - cxMin + 1) * (czMax - czMin + 1);
    if (cellCount <= 0) return;

    const updates = new Uint16Array(cellCount * 2);
    let ptr = 0;
    for (let cz = czMin; cz <= czMax; cz++) {
      const wz = originZ + (cz + 0.5) * cellSize;
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const wx = originX + (cx + 0.5) * cellSize;
        updates[ptr++] = cz * gridWidth + cx;
        updates[ptr++] = isNavCellBlocked(
          spatialHash,
          wx,
          wz,
          this.cellQueryScratch,
          this.groundHeightFn
        );
      }
    }

    const header = WorkerJobRequestSchema.parse({
      jobId: this.nextJobId++,
      jobVersion: this.currentVersion,
      type: 'update_cells',
    });

    this.worker.postMessage({ ...header, cellUpdatesBuffer: updates.buffer }, [updates.buffer]);
  }

  requestPaths(queries: PathQuery[]): Promise<PathWaypoint[] | null> {
    if (!this.worker || !this.healthy || queries.length === 0) {
      return Promise.resolve(null);
    }

    const jobId = this.nextJobId++;
    const jobVersion = this.currentVersion;
    const header = WorkerJobRequestSchema.parse({
      jobId,
      jobVersion,
      type: 'compute_paths',
    });

    const buf = new Float32Array(queries.length * 4);
    for (let i = 0; i < queries.length; i++) {
      buf[i * 4] = queries[i].sx;
      buf[i * 4 + 1] = queries[i].sz;
      buf[i * 4 + 2] = queries[i].tx;
      buf[i * 4 + 3] = queries[i].tz;
    }

    return new Promise((resolve) => {
      const timerId = window.setTimeout(() => {
        if (this.pendingResolvers.has(jobId)) {
          this.pendingResolvers.delete(jobId);
          resolve(null);
        }
      }, 250);

      this.pendingResolvers.set(jobId, { version: jobVersion, timerId, resolve });
      this.worker?.postMessage(
        {
          ...header,
          queriesBuffer: buf.buffer,
          queryCount: queries.length,
        },
        [buf.buffer]
      );
    });
  }

  invalidatePending(): void {
    this.currentVersion++;
    if (this.worker && this.healthy) {
      const header = WorkerJobRequestSchema.parse({
        jobId: this.nextJobId++,
        jobVersion: this.currentVersion,
        type: 'cancel_before',
      });
      this.worker.postMessage(header);
    }
    this.flushPendingWithFallback();
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  dispose(): void {
    this.flushPendingWithFallback();
    this.groundHeightFn = undefined;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private handleMessage = (ev: MessageEvent): void => {
    const raw = ev.data as {
      jobId?: number;
      jobVersion?: number;
      type?: string;
      computeMs?: number;
      errorMessage?: string;
      resultBuffer?: ArrayBuffer;
      resultCount?: number;
    };

    const parsed = WorkerJobResponseSchema.safeParse(raw);
    if (!parsed.success) return;

    const pending = this.pendingResolvers.get(parsed.data.jobId);
    if (!pending) return;

    window.clearTimeout(pending.timerId);
    this.pendingResolvers.delete(parsed.data.jobId);

    // Drop stale results from earlier mission or invalidated version
    if (parsed.data.jobVersion < this.currentVersion || parsed.data.type === 'worker_error') {
      pending.resolve(null);
      return;
    }

    if (parsed.data.type === 'paths_result' && raw.resultBuffer && raw.resultCount) {
      const arr = new Float32Array(raw.resultBuffer);
      const out: PathWaypoint[] = [];
      for (let i = 0; i < raw.resultCount; i++) {
        out.push({ wx: arr[i * 2], wz: arr[i * 2 + 1] });
      }
      pending.resolve(out);
    } else {
      pending.resolve(null);
    }
  };

  private flushPendingWithFallback(): void {
    for (const entry of this.pendingResolvers.values()) {
      window.clearTimeout(entry.timerId);
      entry.resolve(null);
    }
    this.pendingResolvers.clear();
  }
}
