export type CollisionTag =
  | 'building_wall'
  | 'building_door_lintel'
  | 'building_window_sill'
  | 'building_window_lintel'
  | 'building_floor'
  | 'building_ceiling'
  | 'building_roof'
  | 'building_pillar'
  | 'building_interior_wall'
  | 'stair_ramp'
  | 'stair_landing'
  | 'catwalk'
  | 'elevated_deck'
  | 'parapet'
  | 'cargo_lift_platform'
  | 'cargo_lift_gate'
  | 'terrain_slope'
  | 'bridge'
  | 'perimeter_wall'
  | 'cover_barrier'
  | 'supply_crate'
  | 'prop'
  | 'destructible'
  | 'vehicle'
  | 'enemy'
  | 'player'
  | 'ladder';

export interface SpatialAABB {
  id: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  layer: number;
  userData?: unknown;
  /** Optional Y-axis rotation in radians for oriented box (OBB) narrow-phase */
  yaw?: number;
  /** Center and half-extents for OBB narrow-phase when yaw is non-zero */
  centerX?: number;
  centerZ?: number;
  halfExtX?: number;
  halfExtZ?: number;
  /** Semantic tag for diagnostics, material response, and 3D collider visualization */
  tag?: CollisionTag;
  /** Parent structure or entity ID */
  entityId?: string;
}

export const COLLISION_LAYER = {
  WORLD: 1 << 0,
  COVER: 1 << 1,
  ENEMY: 1 << 2,
  VEHICLE: 1 << 3,
  DESTRUCTIBLE: 1 << 4,
  PLAYER: 1 << 5,
  PROJECTILE: 1 << 6,
  WINDOW_SILL: 1 << 7,
  TRIGGER: 1 << 8,
} as const;

interface SpatialEntry {
  box: SpatialAABB;
  keys: number[];
  visitStamp: number;
}

export class SpatialHash {
  private cells = new Map<number, SpatialEntry[]>();
  private entries = new Map<string, SpatialEntry>();
  private stamp = 0;

  constructor(public readonly cellSize = 8) {}

  private hashCell(cx: number, cz: number): number {
    // 2D prime spatial hash supporting coordinates within +/- 16000 cells
    return ((cx + 16384) * 73856093) ^ ((cz + 16384) * 19349663);
  }

  insert(box: SpatialAABB): void {
    if (this.entries.has(box.id)) {
      this.removeById(box.id);
    }

    const minCx = Math.floor(box.minX / this.cellSize);
    const maxCx = Math.floor(box.maxX / this.cellSize);
    const minCz = Math.floor(box.minZ / this.cellSize);
    const maxCz = Math.floor(box.maxZ / this.cellSize);

    const occupiedKeys: number[] = [];
    const entry: SpatialEntry = {
      box,
      keys: occupiedKeys,
      visitStamp: 0,
    };
    this.entries.set(box.id, entry);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = this.hashCell(cx, cz);
        occupiedKeys.push(key);
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(entry);
      }
    }
  }

  private removeById(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    const keys = entry.keys;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const list = this.cells.get(key);
      if (!list) continue;
      const idx = list.indexOf(entry);
      if (idx !== -1) {
        // Swap-remove in O(1) since broadphase cell order is irrelevant
        const last = list.length - 1;
        if (idx !== last) {
          list[idx] = list[last];
        }
        list.pop();
      }
      if (list.length === 0) {
        this.cells.delete(key);
      }
    }
    this.entries.delete(id);
  }

  remove(box: SpatialAABB): void {
    this.removeById(box.id);
  }

  update(box: SpatialAABB): void {
    // O(k) local-cell update using tracked reverse index (never sweeps all map cells)
    const minCx = Math.floor(box.minX / this.cellSize);
    const maxCx = Math.floor(box.maxX / this.cellSize);
    const minCz = Math.floor(box.minZ / this.cellSize);
    const maxCz = Math.floor(box.maxZ / this.cellSize);

    const entry = this.entries.get(box.id);
    if (entry && entry.box === box) {
      const expectedCount = (maxCx - minCx + 1) * (maxCz - minCz + 1);
      if (expectedCount === entry.keys.length) {
        let same = true;
        let idx = 0;
        for (let cx = minCx; cx <= maxCx && same; cx++) {
          for (let cz = minCz; cz <= maxCz; cz++) {
            if (entry.keys[idx++] !== this.hashCell(cx, cz)) {
              same = false;
              break;
            }
          }
        }
        if (same) return;
      }
    }

    this.removeById(box.id);
    this.insert(box);
  }

  queryAABB(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    layerMask: number,
    out: SpatialAABB[]
  ): SpatialAABB[] {
    out.length = 0;
    let stamp = ++this.stamp;
    if (stamp >= 1_000_000_000) {
      for (const entry of this.entries.values()) {
        entry.visitStamp = 0;
      }
      this.stamp = 1;
      stamp = 1;
    }

    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCz = Math.floor(minZ / this.cellSize);
    const maxCz = Math.floor(maxZ / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const list = this.cells.get(this.hashCell(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const entry = list[i];
          if ((entry.box.layer & layerMask) === 0) continue;
          if (entry.visitStamp === stamp) continue;
          entry.visitStamp = stamp;
          out.push(entry.box);
        }
      }
    }
    return out;
  }

  queryRadius(
    cxWorld: number,
    czWorld: number,
    radius: number,
    layerMask: number,
    out: SpatialAABB[]
  ): SpatialAABB[] {
    return this.queryAABB(cxWorld - radius, czWorld - radius, cxWorld + radius, czWorld + radius, layerMask, out);
  }

  getAllBoxes(): SpatialAABB[] {
    const res: SpatialAABB[] = [];
    for (const entry of this.entries.values()) {
      res.push(entry.box);
    }
    return res;
  }

  getBoxCount(): number {
    return this.entries.size;
  }

  clear(): void {
    this.cells.clear();
    this.entries.clear();
    this.stamp = 0;
  }
}
