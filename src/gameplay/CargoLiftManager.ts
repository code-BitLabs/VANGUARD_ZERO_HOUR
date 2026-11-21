import * as THREE from 'three';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER, SpatialAABB } from '@/src/physics/SpatialHash';

export type CargoLiftState =
  | 'idle'
  | 'requested'
  | 'boarding'
  | 'doors_closing'
  | 'traveling'
  | 'docking'
  | 'doors_opening'
  | 'unloading';

export type LiftTravelDirection = 'up' | 'down' | 'none';

export interface CargoLiftFloorStop {
  floorIndex: number;
  floorId: string;
  label: string;
  elevationY: number;
  surfaceId: number;
  boardingWaitPos: { x: number; y: number; z: number };
  exitPos: { x: number; y: number; z: number };
  clearanceHeight: number;
  gateColliderId: string;
  portalIds?: string[];
}

export interface CargoLiftRequest {
  requesterId: string;
  isPlayer: boolean;
  fromFloorIndex: number;
  toFloorIndex: number;
  requestedAtSec: number;
}

export interface CargoLiftDefinition {
  id: string;
  name: string;
  centerX: number;
  centerZ: number;
  halfWidth: number;
  halfDepth: number;
  deckThickness: number;
  speedMetersPerSec: number;
  maxOccupants?: number;
  maxAiOccupants?: number;
  stops: CargoLiftFloorStop[];
  initialFloorIndex?: number;
  platformCollider: SpatialAABB;
  gateColliders: Map<number, SpatialAABB>;
  platformGroup?: THREE.Object3D;
  gateMeshes?: Map<number, THREE.Object3D>;
  portalIds?: string[];
  shaftCeilingY?: number;
}

export interface CargoLiftOccupantProxy {
  id: string;
  isPlayer: boolean;
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  height: number;
}

export interface CargoLiftPortalCostUpdate {
  liftId: string;
  portalId: string;
  enabled: boolean;
  dynamicWaitCostSec: number;
  activeOccupants: number;
}

export interface CargoLiftHudSnapshot {
  liftId: string;
  liftName: string;
  state: CargoLiftState;
  travelDirection: LiftTravelDirection;
  currentFloorIndex: number;
  targetFloorIndex: number;
  currentFloorLabel: string;
  targetFloorLabel: string;
  currentElevationY: number;
  playerInside: boolean;
  occupantCount: number;
  maxOccupants: number;
}

interface LiftRuntime {
  def: CargoLiftDefinition;
  state: CargoLiftState;
  travelDirection: LiftTravelDirection;
  lastTravelDirection: 'up' | 'down';
  currentFloorIndex: number;
  targetFloorIndex: number;
  currentY: number;
  phaseTimerSec: number;
  maxOccupants: number;
  maxAiOccupants: number;
  occupantIds: Set<string>;
  aiOccupantIds: Set<string>;
  playerOnBoard: boolean;
  queue: CargoLiftRequest[];
  physicallyOperational: boolean;
  gatesOpenFloorIndex: number | null;
  lastReportedWaitCost: number;
}

const DOORS_CLOSING_SEC = 0.35;
const DOCKING_SEC = 0.25;
const DOORS_OPENING_SEC = 0.35;
const BOARDING_GRACE_SEC = 1.65;
const UNLOADING_GRACE_SEC = 1.25;

export class CargoLiftManager {
  private readonly lifts = new Map<string, LiftRuntime>();
  private readonly portalCallbacks: Array<(u: CargoLiftPortalCostUpdate) => void> = [];
  private simTimeSec = 0;

  constructor(private readonly collisionWorld: CollisionWorld) {}

  registerLift(def: CargoLiftDefinition): void {
    const initialIdx = Math.max(
      0,
      Math.min(def.stops.length - 1, def.initialFloorIndex ?? 0)
    );
    const initialY = def.stops[initialIdx]?.elevationY ?? 0;

    const runtime: LiftRuntime = {
      def,
      state: 'idle',
      travelDirection: 'none',
      lastTravelDirection: initialIdx >= def.stops.length - 1 ? 'down' : 'up',
      currentFloorIndex: initialIdx,
      targetFloorIndex: initialIdx,
      currentY: initialY,
      phaseTimerSec: 0,
      maxOccupants: Math.max(1, def.maxOccupants ?? 3),
      maxAiOccupants: Math.max(0, def.maxAiOccupants ?? 2),
      occupantIds: new Set(),
      aiOccupantIds: new Set(),
      playerOnBoard: false,
      queue: [],
      physicallyOperational: true,
      gatesOpenFloorIndex: initialIdx,
      lastReportedWaitCost: -1,
    };

    this.syncPlatformAndGates(runtime, true);
    this.lifts.set(def.id, runtime);
    this.emitPortalUpdates(runtime);
  }

  onPortalStateChange(cb: (update: CargoLiftPortalCostUpdate) => void): void {
    this.portalCallbacks.push(cb);
  }

  getLiftCount(): number {
    return this.lifts.size;
  }

  getLiftIds(): string[] {
    return Array.from(this.lifts.keys());
  }

  getLiftRuntimeInfo(liftId: string): CargoLiftHudSnapshot | null {
    const r = this.lifts.get(liftId);
    if (!r) return null;
    const curStop = r.def.stops[r.currentFloorIndex];
    const tgtStop = r.def.stops[r.targetFloorIndex];
    return {
      liftId: r.def.id,
      liftName: r.def.name,
      state: r.state,
      travelDirection: r.travelDirection,
      currentFloorIndex: r.currentFloorIndex,
      targetFloorIndex: r.targetFloorIndex,
      currentFloorLabel: curStop?.label ?? `FL ${r.currentFloorIndex + 1}`,
      targetFloorLabel: tgtStop?.label ?? `FL ${r.targetFloorIndex + 1}`,
      currentElevationY: r.currentY,
      playerInside: r.playerOnBoard,
      occupantCount: r.occupantIds.size,
      maxOccupants: r.maxOccupants,
    };
  }

  getLiftFloorCount(liftId: string): number {
    return this.lifts.get(liftId)?.def.stops.length ?? 0;
  }

  isPlatformIdleAtFloor(liftId: string, floorIndex: number): boolean {
    const r = this.lifts.get(liftId);
    if (!r) return false;
    return (
      r.currentFloorIndex === floorIndex &&
      (r.state === 'idle' || r.state === 'boarding' || r.state === 'doors_opening' || r.state === 'unloading') &&
      Math.abs(r.currentY - (r.def.stops[floorIndex]?.elevationY ?? r.currentY)) < 0.08
    );
  }

  canAiBoardLift(liftId: string, unitId: string, floorIndex: number): boolean {
    const r = this.lifts.get(liftId);
    if (!r || !r.physicallyOperational) return false;
    if (r.aiOccupantIds.has(unitId)) return true;
    if (r.aiOccupantIds.size >= r.maxAiOccupants) return false;
    if (r.occupantIds.size >= r.maxOccupants) return false;
    return (
      r.currentFloorIndex === floorIndex &&
      (r.state === 'idle' || r.state === 'boarding' || r.state === 'doors_opening')
    );
  }

  requestLiftForAI(
    liftId: string,
    unitId: string,
    fromFloorIndex: number,
    toFloorIndex: number
  ): boolean {
    const r = this.lifts.get(liftId);
    if (!r || !r.physicallyOperational) return false;
    if (
      fromFloorIndex < 0 ||
      fromFloorIndex >= r.def.stops.length ||
      toFloorIndex < 0 ||
      toFloorIndex >= r.def.stops.length
    ) {
      return false;
    }

    // Deduplicate existing pending request for this AI
    const existing = r.queue.find((q) => q.requesterId === unitId);
    if (existing) {
      existing.fromFloorIndex = fromFloorIndex;
      existing.toFloorIndex = toFloorIndex;
      return true;
    }

    r.queue.push({
      requesterId: unitId,
      isPlayer: false,
      fromFloorIndex,
      toFloorIndex,
      requestedAtSec: this.simTimeSec,
    });

    if (r.state === 'idle') {
      if (r.currentFloorIndex !== fromFloorIndex) {
        this.beginTravelToFloor(r, fromFloorIndex, 'requested');
      } else {
        r.state = 'boarding';
        r.targetFloorIndex = toFloorIndex;
        r.phaseTimerSec = BOARDING_GRACE_SEC;
        this.syncPlatformAndGates(r, false);
      }
      this.emitPortalUpdates(r);
    }
    return true;
  }

  cancelRequestsForEntity(requesterId: string): void {
    for (const r of this.lifts.values()) {
      const before = r.queue.length;
      r.queue = r.queue.filter((q) => q.requesterId !== requesterId);
      r.occupantIds.delete(requesterId);
      r.aiOccupantIds.delete(requesterId);
      if (r.queue.length !== before) {
        this.emitPortalUpdates(r);
      }
    }
  }

  setLiftOperational(liftId: string, operational: boolean): void {
    const r = this.lifts.get(liftId);
    if (!r) return;
    r.physicallyOperational = operational;
    if (!operational) {
      r.queue.length = 0;
    }
    this.emitPortalUpdates(r);
  }

  /**
   * Returns contextual HUD interact prompt and nearest/active lift snapshot for the player.
   */
  getPlayerInteractionContext(playerPos: THREE.Vector3): {
    prompt: string | null;
    activeSnapshot: CargoLiftHudSnapshot | null;
  } {
    let bestPrompt: string | null = null;
    let bestSnapshot: CargoLiftHudSnapshot | null = null;
    let bestDistSq = Infinity;

    for (const r of this.lifts.values()) {
      if (!r.physicallyOperational) continue;
      const onDeck = this.isPositionOnPlatform(r, playerPos.x, playerPos.y, playerPos.z);
      if (onDeck) {
        const nextIdx = this.pickNextPlayerFloorIndex(r);
        const nextStop = r.def.stops[nextIdx];
        const curStop = r.def.stops[r.currentFloorIndex];
        const snap = this.getLiftRuntimeInfo(r.def.id);
        if (r.state === 'traveling' || r.state === 'doors_closing' || r.state === 'docking') {
          return {
            prompt: `${r.def.name} · ${r.travelDirection === 'up' ? 'ASCENDING' : 'DESCENDING'} TO ${r.def.stops[r.targetFloorIndex]?.label ?? 'TARGET'}`,
            activeSnapshot: snap,
          };
        }
        const verb =
          nextStop.elevationY > (curStop?.elevationY ?? 0) + 0.1
            ? 'ASCEND'
            : nextStop.elevationY < (curStop?.elevationY ?? 0) - 0.1
              ? 'DESCEND'
              : 'CYCLE';
        return {
          prompt: `[E] ${verb} TO ${nextStop.label}`,
          activeSnapshot: snap,
        };
      }

      // Check proximity to any floor stop call pad
      for (let i = 0; i < r.def.stops.length; i++) {
        const stop = r.def.stops[i];
        const dx = playerPos.x - stop.boardingWaitPos.x;
        const dz = playerPos.z - stop.boardingWaitPos.z;
        const dy = Math.abs(playerPos.y - stop.elevationY);
        const dSq = dx * dx + dz * dz;
        if (dy < 2.2 && dSq <= 11.0 && dSq < bestDistSq) {
          bestDistSq = dSq;
          bestSnapshot = this.getLiftRuntimeInfo(r.def.id);
          if (r.currentFloorIndex === i && (r.state === 'idle' || r.state === 'boarding' || r.state === 'doors_opening')) {
            bestPrompt = `[E] ENTER ${r.def.name} · ${stop.label}`;
          } else {
            bestPrompt = `[E] CALL ${r.def.name} TO ${stop.label}`;
          }
        }
      }
    }

    return { prompt: bestPrompt, activeSnapshot: bestSnapshot };
  }

  /**
   * Player [E] / Touch Interact handler: calls lift to nearby floor or initiates travel inside cabin.
   */
  tryPlayerInteract(playerPos: THREE.Vector3): boolean {
    for (const r of this.lifts.values()) {
      if (!r.physicallyOperational) continue;
      if (this.isPositionOnPlatform(r, playerPos.x, playerPos.y, playerPos.z)) {
        if (r.state === 'idle' || r.state === 'boarding' || r.state === 'doors_opening' || r.state === 'unloading') {
          const nextIdx = this.pickNextPlayerFloorIndex(r);
          this.beginTravelToFloor(r, nextIdx, 'doors_closing');
          this.emitPortalUpdates(r);
          return true;
        }
        return false;
      }

      for (let i = 0; i < r.def.stops.length; i++) {
        const stop = r.def.stops[i];
        const dx = playerPos.x - stop.boardingWaitPos.x;
        const dz = playerPos.z - stop.boardingWaitPos.z;
        const dy = Math.abs(playerPos.y - stop.elevationY);
        if (dy < 2.2 && dx * dx + dz * dz <= 11.0) {
          if (r.currentFloorIndex === i && (r.state === 'idle' || r.state === 'boarding')) {
            // Ensure gates are open for boarding
            r.state = 'boarding';
            r.phaseTimerSec = BOARDING_GRACE_SEC;
            this.syncPlatformAndGates(r, false);
            return true;
          }
          // Call lift to this floor stop with priority ahead of AI background requests
          r.queue.unshift({
            requesterId: 'player',
            isPlayer: true,
            fromFloorIndex: i,
            toFloorIndex: this.pickNextPlayerFloorIndexFrom(r, i),
            requestedAtSec: this.simTimeSec,
          });
          if (r.state === 'idle' || r.state === 'unloading') {
            this.beginTravelToFloor(r, i, 'requested');
          }
          this.emitPortalUpdates(r);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Authoritative fixed-timestep lift simulation.
   * Translates standing occupants' positions by exact platform displacement `deltaY`
   * and updates platform & safety gate colliders in SpatialHash.
   */
  updateFixed(dt: number, occupants: readonly CargoLiftOccupantProxy[]): void {
    this.simTimeSec += dt;

    for (const r of this.lifts.values()) {
      // 1. Re-evaluate current physical occupants standing on platform deck
      r.occupantIds.clear();
      r.aiOccupantIds.clear();
      r.playerOnBoard = false;

      for (let i = 0; i < occupants.length; i++) {
        const occ = occupants[i];
        const inShaftHoriz =
          Math.abs(occ.pos.x - r.def.centerX) <= r.def.halfWidth + 0.16 &&
          Math.abs(occ.pos.z - r.def.centerZ) <= r.def.halfDepth + 0.16;
        // Include jumping occupants inside the shaft above the deck (up to +1.8m) when traveling or doors_closing
        const verticalMarginUp =
          r.state === 'traveling' || r.state === 'doors_closing' || r.state === 'docking' ? 1.85 : 0.65;
        const onDeck =
          inShaftHoriz &&
          occ.pos.y >= r.currentY - 0.42 &&
          occ.pos.y <= r.currentY + verticalMarginUp;
        if (!onDeck) continue;
        if (r.occupantIds.size >= r.maxOccupants && !occ.isPlayer) continue;
        if (!occ.isPlayer && r.aiOccupantIds.size >= r.maxAiOccupants) continue;
        r.occupantIds.add(occ.id);
        if (occ.isPlayer) {
          r.playerOnBoard = true;
        } else {
          r.aiOccupantIds.add(occ.id);
        }
      }

      // 2. Step state machine
      let stateChanged = false;
      switch (r.state) {
        case 'idle': {
          if (r.queue.length > 0 && r.physicallyOperational) {
            const nextReq = r.queue[0];
            if (r.currentFloorIndex !== nextReq.fromFloorIndex) {
              this.beginTravelToFloor(r, nextReq.fromFloorIndex, 'requested');
              stateChanged = true;
            } else {
              r.state = 'boarding';
              r.targetFloorIndex = nextReq.toFloorIndex;
              r.phaseTimerSec = BOARDING_GRACE_SEC;
              stateChanged = true;
            }
          }
          break;
        }

        case 'requested': {
          // Wait briefly if doors need to close before leaving current floor
          r.state = 'doors_closing';
          r.phaseTimerSec = DOORS_CLOSING_SEC;
          stateChanged = true;
          break;
        }

        case 'boarding': {
          r.phaseTimerSec -= dt;
          // Auto-depart once an AI requester has boarded or boarding window finishes
          const topReq = r.queue[0];
          const requesterAboard =
            topReq &&
            ((topReq.isPlayer && r.playerOnBoard) ||
              (!topReq.isPlayer && r.aiOccupantIds.has(topReq.requesterId)));
          if (r.phaseTimerSec <= 0 || requesterAboard) {
            const destFloor = topReq
              ? topReq.toFloorIndex
              : this.pickNextPlayerFloorIndex(r);
            if (destFloor !== r.currentFloorIndex) {
              this.beginTravelToFloor(r, destFloor, 'doors_closing');
            } else {
              r.state = 'idle';
              r.queue.shift();
            }
            stateChanged = true;
          }
          break;
        }

        case 'doors_closing': {
          r.phaseTimerSec -= dt;
          if (r.phaseTimerSec <= 0) {
            r.state = 'traveling';
            stateChanged = true;
          }
          break;
        }

        case 'traveling': {
          const targetStop = r.def.stops[r.targetFloorIndex];
          if (!targetStop) {
            r.state = 'idle';
            r.travelDirection = 'none';
            stateChanged = true;
            break;
          }

          const diff = targetStop.elevationY - r.currentY;
          const step = r.def.speedMetersPerSec * dt;
          let nextY =
            Math.abs(diff) <= step
              ? targetStop.elevationY
              : r.currentY + Math.sign(diff) * step;

          // Swept headroom verification against shaft ceiling
          if (nextY > r.currentY && r.def.shaftCeilingY !== undefined) {
            let maxOccHead = 1.9;
            for (let i = 0; i < occupants.length; i++) {
              const occ = occupants[i];
              if (r.occupantIds.has(occ.id)) {
                maxOccHead = Math.max(maxOccHead, occ.height);
              }
            }
            const maxSafeY = r.def.shaftCeilingY - maxOccHead - 0.1;
            if (nextY > maxSafeY) {
              nextY = Math.max(r.currentY, maxSafeY);
            }
          }

          const prevY = r.currentY;
          const deltaY = nextY - prevY;
          r.currentY = nextY;

          // Swept carry for all physical occupants inside shaft XZ:
          // handles standing, crouching, mid-doors_closing entry, AND jumping on an ascending/descending deck!
          if (Math.abs(deltaY) > 1e-6) {
            for (let i = 0; i < occupants.length; i++) {
              const occ = occupants[i];
              if (!r.occupantIds.has(occ.id)) continue;
              const isStandingOnDeck = Math.abs(occ.pos.y - prevY) <= 0.45;
              if (deltaY > 0) {
                if (isStandingOnDeck) {
                  occ.pos.y += deltaY;
                  if (occ.vel && occ.vel.y < 0) occ.vel.y = 0;
                } else if (occ.pos.y >= prevY - 0.45 && occ.pos.y <= nextY + 0.08) {
                  // Swept catch: rising deck met jumping/descending occupant feet
                  occ.pos.y = nextY;
                  if (occ.vel && occ.vel.y < 0) occ.vel.y = 0;
                }
              } else {
                // Descending: carry standing occupants cleanly downward so they never float/bounce
                if (isStandingOnDeck && (!occ.vel || occ.vel.y <= 0.1)) {
                  occ.pos.y += deltaY;
                  if (occ.vel && occ.vel.y < 0) occ.vel.y = 0;
                }
              }
            }
          }

          if (Math.abs(targetStop.elevationY - r.currentY) < 1e-3) {
            r.currentY = targetStop.elevationY;
            r.currentFloorIndex = r.targetFloorIndex;
            r.travelDirection = 'none';
            r.state = 'docking';
            r.phaseTimerSec = DOCKING_SEC;
            stateChanged = true;
          }
          break;
        }

        case 'docking': {
          r.phaseTimerSec -= dt;
          if (r.phaseTimerSec <= 0) {
            r.state = 'doors_opening';
            r.phaseTimerSec = DOORS_OPENING_SEC;
            stateChanged = true;
          }
          break;
        }

        case 'doors_opening': {
          r.phaseTimerSec -= dt;
          if (r.phaseTimerSec <= 0) {
            // Remove completed requests that wanted this floor
            r.queue = r.queue.filter(
              (q) =>
                q.toFloorIndex !== r.currentFloorIndex &&
                q.fromFloorIndex !== r.currentFloorIndex
            );
            r.state = r.aiOccupantIds.size > 0 ? 'unloading' : 'idle';
            r.phaseTimerSec = UNLOADING_GRACE_SEC;
            stateChanged = true;
          }
          break;
        }

        case 'unloading': {
          r.phaseTimerSec -= dt;
          if (r.phaseTimerSec <= 0 || r.aiOccupantIds.size === 0) {
            r.state = 'idle';
            stateChanged = true;
          }
          break;
        }
      }

      this.syncPlatformAndGates(r, false);
      if (stateChanged) {
        this.emitPortalUpdates(r);
      }
    }
  }

  /**
   * Normalizes mid-travel lift state to the nearest floor landing upon checkpoint restore
   * so the player/checkpoint system never inherits transient door-closing or mid-shaft states.
   */
  normalizeForCheckpoint(): void {
    for (const r of this.lifts.values()) {
      let nearestIdx = r.currentFloorIndex;
      let nearestDist = Infinity;
      for (let i = 0; i < r.def.stops.length; i++) {
        const d = Math.abs(r.def.stops[i].elevationY - r.currentY);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      r.currentFloorIndex = nearestIdx;
      r.targetFloorIndex = nearestIdx;
      r.currentY = r.def.stops[nearestIdx]?.elevationY ?? 0;
      r.state = 'idle';
      r.travelDirection = 'none';
      r.phaseTimerSec = 0;
      r.queue.length = 0;
      this.syncPlatformAndGates(r, true);
      this.emitPortalUpdates(r);
    }
  }

  reset(): void {
    for (const r of this.lifts.values()) {
      const initialIdx = Math.max(
        0,
        Math.min(r.def.stops.length - 1, r.def.initialFloorIndex ?? 0)
      );
      r.currentFloorIndex = initialIdx;
      r.targetFloorIndex = initialIdx;
      r.currentY = r.def.stops[initialIdx]?.elevationY ?? 0;
      r.state = 'idle';
      r.travelDirection = 'none';
      r.lastTravelDirection = initialIdx >= r.def.stops.length - 1 ? 'down' : 'up';
      r.phaseTimerSec = 0;
      r.occupantIds.clear();
      r.aiOccupantIds.clear();
      r.playerOnBoard = false;
      r.queue.length = 0;
      r.physicallyOperational = true;
      r.lastReportedWaitCost = -1;
      this.syncPlatformAndGates(r, true);
      this.emitPortalUpdates(r);
    }
  }

  clear(): void {
    this.lifts.clear();
  }

  dispose(): void {
    this.lifts.clear();
    this.portalCallbacks.length = 0;
  }

  private beginTravelToFloor(
    r: LiftRuntime,
    destFloorIndex: number,
    initialPhase: 'requested' | 'doors_closing'
  ): void {
    const destStop = r.def.stops[destFloorIndex];
    if (!destStop) return;
    r.targetFloorIndex = destFloorIndex;
    r.travelDirection =
      destStop.elevationY > r.currentY + 0.05
        ? 'up'
        : destStop.elevationY < r.currentY - 0.05
          ? 'down'
          : 'none';
    if (r.travelDirection === 'none') {
      r.state = 'idle';
      return;
    }
    r.lastTravelDirection = r.travelDirection;
    r.state = initialPhase;
    r.phaseTimerSec = DOORS_CLOSING_SEC;
  }

  private pickNextPlayerFloorIndex(r: LiftRuntime): number {
    return this.pickNextPlayerFloorIndexFrom(r, r.currentFloorIndex);
  }

  private pickNextPlayerFloorIndexFrom(r: LiftRuntime, fromIdx: number): number {
    if (r.def.stops.length <= 1) return fromIdx;
    // Multi-stop directional cycling: continue along last travel direction until hitting terminal floor
    if (fromIdx <= 0) return 1;
    if (fromIdx >= r.def.stops.length - 1) return r.def.stops.length - 2;
    return r.lastTravelDirection === 'down' ? fromIdx - 1 : fromIdx + 1;
  }

  private isPositionOnPlatform(r: LiftRuntime, x: number, feetY: number, z: number): boolean {
    const dx = Math.abs(x - r.def.centerX);
    const dz = Math.abs(z - r.def.centerZ);
    return (
      dx <= r.def.halfWidth + 0.12 &&
      dz <= r.def.halfDepth + 0.12 &&
      Math.abs(feetY - r.currentY) <= 0.55
    );
  }

  private syncPlatformAndGates(r: LiftRuntime, force: boolean): void {
    const plat = r.def.platformCollider;
    const targetMaxY = r.currentY;
    const targetMinY = r.currentY - r.def.deckThickness;
    if (force || Math.abs(plat.maxY - targetMaxY) > 1e-4) {
      plat.maxY = targetMaxY;
      plat.minY = targetMinY;
      this.collisionWorld.physicsWorld.updateCollider(plat);
      if (r.def.platformGroup) {
        r.def.platformGroup.position.y = r.currentY;
      }
    }

    const gatesShouldOpen =
      r.state === 'idle' ||
      r.state === 'boarding' ||
      r.state === 'doors_opening' ||
      r.state === 'unloading';
    const openFloor = gatesShouldOpen ? r.currentFloorIndex : null;

    if (force || r.gatesOpenFloorIndex !== openFloor) {
      r.gatesOpenFloorIndex = openFloor;
      for (const [floorIdx, gateBox] of r.def.gateColliders.entries()) {
        const isOpen = openFloor === floorIdx;
        gateBox.layer = isOpen ? COLLISION_LAYER.TRIGGER : COLLISION_LAYER.WORLD;
        this.collisionWorld.physicsWorld.updateCollider(gateBox);
        const gateMesh = r.def.gateMeshes?.get(floorIdx);
        if (gateMesh) {
          gateMesh.visible = !isOpen;
        }
      }
    }
  }

  private emitPortalUpdates(r: LiftRuntime): void {
    if (this.portalCallbacks.length === 0) return;
    const targetStop = r.def.stops[r.targetFloorIndex];
    const busy = r.state !== 'idle';
    const waitSec =
      (busy
        ? Math.abs((targetStop?.elevationY ?? r.currentY) - r.currentY) /
            Math.max(0.5, r.def.speedMetersPerSec) +
          1.2
        : 0.8) +
      r.queue.length * 3.5;

    const roundedWait = Math.round(waitSec * 10) / 10;
    if (roundedWait === r.lastReportedWaitCost && !busy) return;
    r.lastReportedWaitCost = roundedWait;

    const seenPortals = new Set<string>();
    if (r.def.portalIds) {
      for (const pid of r.def.portalIds) seenPortals.add(pid);
    }
    for (const stop of r.def.stops) {
      if (stop.portalIds) {
        for (const pid of stop.portalIds) seenPortals.add(pid);
      }
    }

    for (const portalId of seenPortals) {
      const update: CargoLiftPortalCostUpdate = {
        liftId: r.def.id,
        portalId,
        enabled: r.physicallyOperational,
        dynamicWaitCostSec: roundedWait,
        activeOccupants: r.occupantIds.size,
      };
      for (let i = 0; i < this.portalCallbacks.length; i++) {
        this.portalCallbacks[i](update);
      }
    }
  }
}
