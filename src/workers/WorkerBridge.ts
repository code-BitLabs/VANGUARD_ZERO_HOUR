import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { SpatialHash, COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { WorkerJobRequestSchema, WorkerJobResponseSchema } from '@/src/schemas/worker.schema';

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

export class WorkerBridge {
  private worker: Worker | null = null;
  private currentVersion = 1;
  private nextJobId = 1;
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

  uploadCollisionGrid(spatialHash: SpatialHash): void {
    if (!this.worker || !this.healthy) return;

    const gridWidth = 120;
    const gridHeight = 120;
    const cellSize = 2;
    const originX = -120;
    const originZ = -120;
    const blocked = new Uint8Array(gridWidth * gridHeight);
    const scratch: ReturnType<SpatialHash['queryAABB']> = [];
    const navMask =
      COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER | COLLISION_LAYER.WINDOW_SILL;

    for (let cz = 0; cz < gridHeight; cz++) {
      for (let cx = 0; cx < gridWidth; cx++) {
        const wx = originX + (cx + 0.5) * cellSize;
        const wz = originZ + (cz + 0.5) * cellSize;
        const hits = spatialHash.queryAABB(
          wx - 0.55,
          wz - 0.55,
          wx + 0.55,
          wz + 0.55,
          navMask,
          scratch
        );
        for (let i = 0; i < hits.length; i++) {
          const box = hits[i];
          // Block navigation only if the obstacle occupies pedestrian height [0.48m .. 1.85m].
          // Doorway lintels (minY >= 2.4m) and ground floor slabs (maxY <= 0.45m) remain walkable!
          if (box.minY < 1.85 && box.maxY > 0.48) {
            blocked[cz * gridWidth + cx] = 1;
            break;
          }
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
