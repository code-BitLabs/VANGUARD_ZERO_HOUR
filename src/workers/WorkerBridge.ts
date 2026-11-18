import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import {
  AgentProfileId,
  getAgentProfileCode,
  PortalKind,
} from '@/src/navigation/AgentTraversalProfile';
import { SpatialAABB, SpatialHash, COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { WorkerJobRequestSchema, WorkerJobResponseSchema } from '@/src/schemas/worker.schema';
import {
  ElevatedNavSurfaceInput,
  NAV_GRID_DEFAULTS,
  NavPortalInput,
  TRAVERSAL_FLAGS,
} from './navigationCore';

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

export interface PathQuery3D {
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  tz: number;
  profileId?: AgentProfileId;
}

export interface PathWaypoint3D {
  wx: number;
  wy: number;
  wz: number;
  surfaceId: number;
  portalId: number;
  portalKey: string | null;
  portalKind: PortalKind | null;
  liftId: string | null;
  traversalFlags: number;
  targetFloorIndex: number;
}

export interface ElevatedNavSurfaceDescriptor {
  surfaceId: number;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  elevationY: number;
  cellSize?: number;
  /** Optional explicit perimeter check: cells outside walkable slab are blocked */
  walkableBounds?: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
}

const NAV_OBSTACLE_MASK =
  COLLISION_LAYER.WORLD |
  COLLISION_LAYER.COVER |
  COLLISION_LAYER.WINDOW_SILL |
  COLLISION_LAYER.DESTRUCTIBLE;

function isNavCellBlockedAtElevation(
  spatialHash: SpatialHash,
  wx: number,
  wz: number,
  elevationY: number,
  scratch: SpatialAABB[],
  groundHeightFn?: (x: number, z: number) => number,
  walkableBounds?: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>
): 0 | 1 {
  if (walkableBounds && walkableBounds.length > 0) {
    let insideAny = false;
    for (let i = 0; i < walkableBounds.length; i++) {
      const b = walkableBounds[i];
      if (wx >= b.minX - 0.15 && wx <= b.maxX + 0.15 && wz >= b.minZ - 0.15 && wz <= b.maxZ + 0.15) {
        insideAny = true;
        break;
      }
    }
    if (!insideAny) return 1;
  }

  const hits = spatialHash.queryAABB(
    wx - 0.52,
    wz - 0.52,
    wx + 0.52,
    wz + 0.52,
    NAV_OBSTACLE_MASK,
    scratch
  );

  let hasBridge = false;
  const bandMinY = elevationY + 0.42;
  const bandMaxY = elevationY + 1.85;

  for (let i = 0; i < hits.length; i++) {
    const box = hits[i];
    if (box.tag === 'bridge' || box.tag === 'catwalk' || box.tag === 'elevated_deck') {
      hasBridge = true;
    }
    // Cargo lift gates are dynamic portals, never permanently block navigation
    if (box.tag === 'cargo_lift_gate' || box.tag === 'cargo_lift_platform') {
      continue;
    }
    if (box.minY < bandMaxY && box.maxY > bandMinY) {
      return 1;
    }
  }

  if (elevationY <= 0.4 && !hasBridge && groundHeightFn && groundHeightFn(wx, wz) <= -0.5) {
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
  private portalMetaById = new Map<number, NavPortalInput>();
  private portalIdByKey = new Map<string, number>();
  private elevatedDescriptors: ElevatedNavSurfaceDescriptor[] = [];

  private pendingResolvers = new Map<
    number,
    {
      version: number;
      timerId: number;
      mode: '2d' | '3d';
      resolve2d?: (waypoints: PathWaypoint[] | null) => void;
      resolve3d?: (waypoints: PathWaypoint3D[] | null) => void;
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
    this.elevatedDescriptors = [];
    this.portalMetaById.clear();
    this.portalIdByKey.clear();
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
        if (isNavCellBlockedAtElevation(spatialHash, wx, wz, 0, this.cellQueryScratch, this.groundHeightFn) === 1) {
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
   * Uploads ground surface 0 + all bounded elevated navigation surfaces (1..M) + typed portals
   * to the navigation worker for Hierarchical Hybrid Multi-Elevation A*.
   */
  uploadNavigationSurfaces(
    spatialHash: SpatialHash,
    elevatedDescriptors: ElevatedNavSurfaceDescriptor[],
    portals: NavPortalInput[],
    getGroundHeightAt?: (x: number, z: number) => number
  ): void {
    this.groundHeightFn = getGroundHeightAt;
    this.elevatedDescriptors = elevatedDescriptors.slice();
    this.portalMetaById.clear();
    this.portalIdByKey.clear();
    for (let i = 0; i < portals.length; i++) {
      const p = portals[i];
      this.portalMetaById.set(p.portalId, p);
      this.portalIdByKey.set(p.portalKey, p.portalId);
    }

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
        if (
          isNavCellBlockedAtElevation(
            spatialHash,
            wx,
            wz,
            0,
            this.cellQueryScratch,
            this.groundHeightFn
          ) === 1
        ) {
          blocked[cz * gridWidth + cx] = 1;
        }
      }
    }

    // Ensure ground portal entry/exit cells are open
    for (let i = 0; i < portals.length; i++) {
      const p = portals[i];
      if (p.fromSurfaceId === 0) {
        const cx = Math.floor((p.fromX - originX) / cellSize);
        const cz = Math.floor((p.fromZ - originZ) / cellSize);
        if (cx >= 0 && cx < gridWidth && cz >= 0 && cz < gridHeight) {
          blocked[cz * gridWidth + cx] = 0;
        }
      }
      if (p.bidirectional && p.toSurfaceId === 0) {
        const cx = Math.floor((p.toX - originX) / cellSize);
        const cz = Math.floor((p.toZ - originZ) / cellSize);
        if (cx >= 0 && cx < gridWidth && cz >= 0 && cz < gridHeight) {
          blocked[cz * gridWidth + cx] = 0;
        }
      }
    }

    const transferables: Transferable[] = [blocked.buffer];
    const wireSurfaces: Array<Omit<ElevatedNavSurfaceInput, 'blocked'> & { blockedBuffer: ArrayBuffer }> = [];

    for (let i = 0; i < elevatedDescriptors.length; i++) {
      const d = elevatedDescriptors[i];
      const sCell = Math.max(0.75, d.cellSize ?? 1.25);
      const sWidth = Math.max(2, Math.ceil((d.maxX - d.minX) / sCell));
      const sHeight = Math.max(2, Math.ceil((d.maxZ - d.minZ) / sCell));
      const sBlocked = new Uint8Array(sWidth * sHeight);

      for (let cz = 0; cz < sHeight; cz++) {
        const wz = d.minZ + (cz + 0.5) * sCell;
        for (let cx = 0; cx < sWidth; cx++) {
          const wx = d.minX + (cx + 0.5) * sCell;
          if (
            isNavCellBlockedAtElevation(
              spatialHash,
              wx,
              wz,
              d.elevationY,
              this.cellQueryScratch,
              undefined,
              d.walkableBounds
            ) === 1
          ) {
            sBlocked[cz * sWidth + cx] = 1;
          }
        }
      }

      // Guarantee portal anchor cells on this elevated surface remain clear
      for (let pIdx = 0; pIdx < portals.length; pIdx++) {
        const p = portals[pIdx];
        if (p.fromSurfaceId === d.surfaceId) {
          const cx = Math.floor((p.fromX - d.minX) / sCell);
          const cz = Math.floor((p.fromZ - d.minZ) / sCell);
          if (cx >= 0 && cx < sWidth && cz >= 0 && cz < sHeight) {
            sBlocked[cz * sWidth + cx] = 0;
          }
        }
        if (p.toSurfaceId === d.surfaceId) {
          const cx = Math.floor((p.toX - d.minX) / sCell);
          const cz = Math.floor((p.toZ - d.minZ) / sCell);
          if (cx >= 0 && cx < sWidth && cz >= 0 && cz < sHeight) {
            sBlocked[cz * sWidth + cx] = 0;
          }
        }
      }

      transferables.push(sBlocked.buffer);
      wireSurfaces.push({
        surfaceId: d.surfaceId,
        name: d.name,
        width: sWidth,
        height: sHeight,
        cellSize: sCell,
        originX: d.minX,
        originZ: d.minZ,
        elevationY: d.elevationY,
        minY: d.elevationY - 0.6,
        maxY: d.elevationY + 2.0,
        blockedBuffer: sBlocked.buffer,
      });
    }

    const header = WorkerJobRequestSchema.parse({
      jobId: this.nextJobId++,
      jobVersion: this.currentVersion,
      type: 'init_navigation_surfaces',
      gridWidth,
      gridHeight,
      cellSize,
      originX,
      originZ,
    });

    this.worker.postMessage(
      {
        ...header,
        blockedBuffer: blocked.buffer,
        elevatedSurfaces: wireSurfaces,
        portals,
      },
      transferables
    );
  }

  updatePortalState(
    portalKeyOrId: string | number,
    enabled?: boolean,
    dynamicWaitCost?: number,
    activeOccupants?: number
  ): void {
    const portalId =
      typeof portalKeyOrId === 'number'
        ? portalKeyOrId
        : this.portalIdByKey.get(portalKeyOrId);
    if (portalId === undefined) return;

    const meta = this.portalMetaById.get(portalId);
    if (meta) {
      if (enabled !== undefined) meta.enabled = enabled;
      if (dynamicWaitCost !== undefined) meta.dynamicWaitCost = dynamicWaitCost;
      if (activeOccupants !== undefined) meta.activeOccupants = activeOccupants;
    }

    if (!this.worker || !this.healthy) return;
    const header = WorkerJobRequestSchema.parse({
      jobId: this.nextJobId++,
      jobVersion: this.currentVersion,
      type: 'update_portal_state',
      portalId,
      portalEnabled: enabled,
      dynamicWaitCost,
      activeOccupants,
    });
    this.worker.postMessage(header);
  }

  /**
   * Re-rasterizes only the grid cells overlapping a modified/destroyed collider region
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
        updates[ptr++] = isNavCellBlockedAtElevation(
          spatialHash,
          wx,
          wz,
          0,
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

      this.pendingResolvers.set(jobId, { version: jobVersion, timerId, mode: '2d', resolve2d: resolve });
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

  requestPaths3D(queries: PathQuery3D[]): Promise<PathWaypoint3D[] | null> {
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

    const coords = new Float32Array(queries.length * 6);
    const meta = new Int32Array(queries.length * 2);
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      coords[i * 6] = q.sx;
      coords[i * 6 + 1] = q.sy;
      coords[i * 6 + 2] = q.sz;
      coords[i * 6 + 3] = q.tx;
      coords[i * 6 + 4] = q.ty;
      coords[i * 6 + 5] = q.tz;
      meta[i * 2] = getAgentProfileCode(q.profileId ?? 'standard_infantry');
      meta[i * 2 + 1] = 0;
    }

    return new Promise((resolve) => {
      const timerId = window.setTimeout(() => {
        if (this.pendingResolvers.has(jobId)) {
          this.pendingResolvers.delete(jobId);
          resolve(null);
        }
      }, 250);

      this.pendingResolvers.set(jobId, { version: jobVersion, timerId, mode: '3d', resolve3d: resolve });
      this.worker?.postMessage(
        {
          ...header,
          queriesCoordsBuffer: coords.buffer,
          queriesMetaBuffer: meta.buffer,
          queryCount: queries.length,
        },
        [coords.buffer, meta.buffer]
      );
    });
  }

  getPortalById(portalId: number): NavPortalInput | null {
    return this.portalMetaById.get(portalId) ?? null;
  }

  getElevatedDescriptors(): readonly ElevatedNavSurfaceDescriptor[] {
    return this.elevatedDescriptors;
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
    this.portalMetaById.clear();
    this.portalIdByKey.clear();
    this.elevatedDescriptors = [];
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
      resultCoordsBuffer?: ArrayBuffer;
      resultMetaBuffer?: ArrayBuffer;
      resultCount?: number;
    };

    const parsed = WorkerJobResponseSchema.safeParse(raw);
    if (!parsed.success) return;

    const pending = this.pendingResolvers.get(parsed.data.jobId);
    if (!pending) return;

    window.clearTimeout(pending.timerId);
    this.pendingResolvers.delete(parsed.data.jobId);

    if (parsed.data.jobVersion < this.currentVersion || parsed.data.type === 'worker_error') {
      if (pending.mode === '3d') pending.resolve3d?.(null);
      else pending.resolve2d?.(null);
      return;
    }

    if (
      pending.mode === '3d' &&
      parsed.data.type === 'paths_result' &&
      raw.resultCoordsBuffer &&
      raw.resultMetaBuffer &&
      raw.resultCount
    ) {
      const coords = new Float32Array(raw.resultCoordsBuffer);
      const meta = new Int32Array(raw.resultMetaBuffer);
      const out: PathWaypoint3D[] = [];
      for (let i = 0; i < raw.resultCount; i++) {
        const portalId = meta[i * 4 + 1];
        const portal = portalId >= 0 ? this.portalMetaById.get(portalId) ?? null : null;
        out.push({
          wx: coords[i * 3],
          wy: coords[i * 3 + 1],
          wz: coords[i * 3 + 2],
          surfaceId: meta[i * 4],
          portalId,
          portalKey: portal?.portalKey ?? null,
          portalKind: portal?.kind ?? null,
          liftId: portal?.liftId ?? null,
          traversalFlags: meta[i * 4 + 2] ?? TRAVERSAL_FLAGS.NONE,
          targetFloorIndex: meta[i * 4 + 3] ?? -1,
        });
      }
      pending.resolve3d?.(out);
      return;
    }

    if (
      pending.mode === '2d' &&
      parsed.data.type === 'paths_result' &&
      raw.resultBuffer &&
      raw.resultCount
    ) {
      const arr = new Float32Array(raw.resultBuffer);
      const out: PathWaypoint[] = [];
      for (let i = 0; i < raw.resultCount; i++) {
        out.push({ wx: arr[i * 2], wz: arr[i * 2 + 1] });
      }
      pending.resolve2d?.(out);
      return;
    }

    if (pending.mode === '3d') pending.resolve3d?.(null);
    else pending.resolve2d?.(null);
  };

  private flushPendingWithFallback(): void {
    for (const entry of this.pendingResolvers.values()) {
      window.clearTimeout(entry.timerId);
      if (entry.mode === '3d') entry.resolve3d?.(null);
      else entry.resolve2d?.(null);
    }
    this.pendingResolvers.clear();
  }
}
