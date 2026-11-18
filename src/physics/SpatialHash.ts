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
  | 'player';

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

export class SpatialHash {
  private cells = new Map<number, SpatialAABB[]>();
  private allBoxes = new Map<string, SpatialAABB>();
  private visitedStamp = new Map<string, number>();
  private stamp = 0;

  constructor(public readonly cellSize = 8) {}

  private hashCell(cx: number, cz: number): number {
    // 2D prime spatial hash supporting coordinates within +/- 16000 cells
    return ((cx + 16384) * 73856093) ^ ((cz + 16384) * 19349663);
  }

  insert(box: SpatialAABB): void {
    if (this.allBoxes.has(box.id)) {
      const existing = this.allBoxes.get(box.id)!;
      if (existing !== box) {
        this.remove(existing);
      } else {
        this.removeFromCells(box);
      }
    }
    this.allBoxes.set(box.id, box);

    const minCx = Math.floor(box.minX / this.cellSize);
    const maxCx = Math.floor(box.maxX / this.cellSize);
    const minCz = Math.floor(box.minZ / this.cellSize);
    const maxCz = Math.floor(box.maxZ / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = this.hashCell(cx, cz);
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(box);
      }
    }
  }

  private removeFromCells(box: SpatialAABB): void {
    const minCx = Math.floor(box.minX / this.cellSize);
    const maxCx = Math.floor(box.maxX / this.cellSize);
    const minCz = Math.floor(box.minZ / this.cellSize);
    const maxCz = Math.floor(box.maxZ / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = this.hashCell(cx, cz);
        const list = this.cells.get(key);
        if (!list) continue;
        const idx = list.indexOf(box);
        if (idx !== -1) list.splice(idx, 1);
      }
    }
  }

  remove(box: SpatialAABB): void {
    this.removeFromCells(box);
    this.allBoxes.delete(box.id);
  }

  update(box: SpatialAABB): void {
    // Since minX/maxX may have changed since insertion, sweep any cell containing box if bounds shifted
    for (const list of this.cells.values()) {
      const idx = list.indexOf(box);
      if (idx !== -1) list.splice(idx, 1);
    }
    this.allBoxes.delete(box.id);
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
    const stamp = ++this.stamp;

    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCz = Math.floor(minZ / this.cellSize);
    const maxCz = Math.floor(maxZ / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const list = this.cells.get(this.hashCell(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          if ((item.layer & layerMask) === 0) continue;
          if (this.visitedStamp.get(item.id) === stamp) continue;
          this.visitedStamp.set(item.id, stamp);
          out.push(item);
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
    return Array.from(this.allBoxes.values());
  }

  getBoxCount(): number {
    return this.allBoxes.size;
  }

  clear(): void {
    this.cells.clear();
    this.allBoxes.clear();
    this.visitedStamp.clear();
    this.stamp = 0;
  }
}
