export type SquadOrderType =
  | 'FOLLOW'
  | 'HOLD'
  | 'MOVE'
  | 'SUPPRESS'
  | 'ATTACK_TARGET'
  | 'FLANK'
  | 'REGROUP'
  | 'DEFEND'
  | 'BOARD_VEHICLE'
  | 'EXIT_VEHICLE';

export type SquadCommandSource =
  | 'desktop_radial'
  | 'desktop_quick_key'
  | 'tactical_map'
  | 'mobile_strip'
  | 'mobile_context_ping'
  | 'system_fallback';

export interface SquadCommandPayload {
  readonly order: SquadOrderType;
  readonly source: SquadCommandSource;
  /** Optional individual operator ID; null/undefined targets the entire active fireteam */
  readonly operatorId?: string | null;
  readonly targetPos?: { x: number; y: number; z: number } | null;
  readonly targetEnemyId?: string | null;
  readonly targetVehicleId?: string | null;
  readonly issuedAtSec: number;
}

export interface ValidatedSquadIntent {
  readonly commandId: number;
  readonly order: SquadOrderType;
  readonly source: SquadCommandSource;
  readonly operatorId: string | null;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly anchorZ: number;
  readonly hasWorldAnchor: boolean;
  readonly targetEnemyId: string | null;
  readonly targetVehicleId: string | null;
  readonly issuedAtSec: number;
  readonly label: string;
}

export interface SquadIntentValidationContext {
  readonly playerPos: { x: number; y: number; z: number };
  readonly isEnemyAlive: (enemyId: string) => boolean;
  readonly getEnemyPos: (enemyId: string) => { x: number; y: number; z: number } | null;
  readonly isVehicleBoardable: (vehicleId: string) => boolean;
  readonly getVehiclePos: (vehicleId: string) => { x: number; y: number; z: number } | null;
}

const ORDER_LABELS: Readonly<Record<SquadOrderType, string>> = Object.freeze({
  FOLLOW: 'Follow Lead',
  HOLD: 'Hold Position',
  MOVE: 'Move to Waypoint',
  SUPPRESS: 'Suppress Sector',
  ATTACK_TARGET: 'Focus Fire Target',
  FLANK: 'Execute Flank',
  REGROUP: 'Regroup on Lead',
  DEFEND: 'Defend Perimeter',
  BOARD_VEHICLE: 'Board Vehicle',
  EXIT_VEHICLE: 'Dismount Vehicle',
});

/**
 * Command Pattern Router for TRN-37.
 * Centralizes validation, deduplication, contextual fallback, and automatic stale-target cleanup
 * across Desktop Hold-Q Radial, F1-F4 Quick Keys, Tactical Map, and Mobile Thumb Strip.
 */
export class SquadIntentRouter {
  private seq = 0;
  private squadIntent: ValidatedSquadIntent | null = null;
  private readonly unitOverrides = new Map<string, ValidatedSquadIntent>();

  reset(): void {
    this.seq = 0;
    this.squadIntent = null;
    this.unitOverrides.clear();
  }

  issueCommand(
    cmd: SquadCommandPayload,
    ctx: SquadIntentValidationContext
  ): { accepted: boolean; intent: ValidatedSquadIntent | null; reason?: string } {
    let resolvedOrder: SquadOrderType = cmd.order;
    let targetEnemyId: string | null = cmd.targetEnemyId ?? null;
    let targetVehicleId: string | null = cmd.targetVehicleId ?? null;
    let anchorX = cmd.targetPos?.x ?? ctx.playerPos.x;
    let anchorY = cmd.targetPos?.y ?? ctx.playerPos.y;
    let anchorZ = cmd.targetPos?.z ?? ctx.playerPos.z;
    let hasWorldAnchor = Boolean(cmd.targetPos);

    if (resolvedOrder === 'ATTACK_TARGET') {
      if (targetEnemyId && ctx.isEnemyAlive(targetEnemyId)) {
        const ep = ctx.getEnemyPos(targetEnemyId);
        if (ep) {
          anchorX = ep.x;
          anchorY = ep.y;
          anchorZ = ep.z;
          hasWorldAnchor = true;
        }
      } else {
        // Stale or missing enemy on ATTACK_TARGET degrades cleanly to sector SUPPRESS if world point exists, else reject
        targetEnemyId = null;
        if (hasWorldAnchor) {
          resolvedOrder = 'SUPPRESS';
        } else {
          return { accepted: false, intent: null, reason: 'No valid hostile target under crosshair.' };
        }
      }
    }

    if (resolvedOrder === 'BOARD_VEHICLE') {
      if (!targetVehicleId || !ctx.isVehicleBoardable(targetVehicleId)) {
        return { accepted: false, intent: null, reason: 'No boardable friendly vehicle in range.' };
      }
      const vp = ctx.getVehiclePos(targetVehicleId);
      if (vp) {
        anchorX = vp.x;
        anchorY = vp.y;
        anchorZ = vp.z;
        hasWorldAnchor = true;
      }
    }

    if (resolvedOrder === 'FOLLOW' || resolvedOrder === 'REGROUP') {
      anchorX = ctx.playerPos.x;
      anchorY = ctx.playerPos.y;
      anchorZ = ctx.playerPos.z;
      hasWorldAnchor = false;
      targetEnemyId = null;
      targetVehicleId = null;
    }

    const scopeOperatorId = cmd.operatorId ?? null;

    // Deduplicate identical spam commands issued within 0.18s
    const existing = scopeOperatorId ? this.unitOverrides.get(scopeOperatorId) : this.squadIntent;
    if (
      existing &&
      existing.order === resolvedOrder &&
      existing.targetEnemyId === targetEnemyId &&
      existing.targetVehicleId === targetVehicleId &&
      Math.abs(existing.anchorX - anchorX) < 0.75 &&
      Math.abs(existing.anchorZ - anchorZ) < 0.75 &&
      cmd.issuedAtSec - existing.issuedAtSec < 0.18
    ) {
      return { accepted: false, intent: existing, reason: 'Duplicate command debounced.' };
    }

    const intent: ValidatedSquadIntent = {
      commandId: ++this.seq,
      order: resolvedOrder,
      source: cmd.source,
      operatorId: scopeOperatorId,
      anchorX,
      anchorY,
      anchorZ,
      hasWorldAnchor,
      targetEnemyId,
      targetVehicleId,
      issuedAtSec: cmd.issuedAtSec,
      label: ORDER_LABELS[resolvedOrder],
    };

    if (scopeOperatorId) {
      this.unitOverrides.set(scopeOperatorId, intent);
    } else {
      // Squad-wide command supersedes stale per-unit overrides so the fireteam stays cohesive
      this.squadIntent = intent;
      this.unitOverrides.clear();
    }

    return { accepted: true, intent };
  }

  /**
   * Prunes dead enemy targets and destroyed vehicles within 1 simulation tick
   * so no companion ever fires at dead coordinates or attempts to board a wreck.
   */
  pruneStaleTargets(ctx: SquadIntentValidationContext, nowSec: number): boolean {
    let pruned = false;

    const sanitize = (intent: ValidatedSquadIntent | null): ValidatedSquadIntent | null => {
      if (!intent) return null;
      if (intent.targetEnemyId && !ctx.isEnemyAlive(intent.targetEnemyId)) {
        pruned = true;
        return {
          ...intent,
          commandId: ++this.seq,
          order: 'FOLLOW',
          targetEnemyId: null,
          hasWorldAnchor: false,
          anchorX: ctx.playerPos.x,
          anchorY: ctx.playerPos.y,
          anchorZ: ctx.playerPos.z,
          issuedAtSec: nowSec,
          label: 'Target Neutralized · Follow Lead',
        };
      }
      if (intent.order === 'BOARD_VEHICLE' && intent.targetVehicleId && !ctx.isVehicleBoardable(intent.targetVehicleId)) {
        pruned = true;
        return {
          ...intent,
          commandId: ++this.seq,
          order: 'REGROUP',
          targetVehicleId: null,
          hasWorldAnchor: false,
          anchorX: ctx.playerPos.x,
          anchorY: ctx.playerPos.y,
          anchorZ: ctx.playerPos.z,
          issuedAtSec: nowSec,
          label: 'Vehicle Unavailable · Regroup',
        };
      }
      return intent;
    };

    this.squadIntent = sanitize(this.squadIntent);
    for (const [opId, override] of this.unitOverrides.entries()) {
      const next = sanitize(override);
      if (next) this.unitOverrides.set(opId, next);
      else this.unitOverrides.delete(opId);
    }

    return pruned;
  }

  getActiveIntentForOperator(operatorId: string): ValidatedSquadIntent | null {
    return this.unitOverrides.get(operatorId) ?? this.squadIntent;
  }

  getSquadWideIntent(): ValidatedSquadIntent | null {
    return this.squadIntent;
  }
}
