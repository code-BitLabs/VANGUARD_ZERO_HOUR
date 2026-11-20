import { SquadRoleId } from '@/src/schemas/campaign.schema';

export type SquadFormationType = 'WEDGE' | 'COLUMN' | 'LINE' | 'COMPACT' | 'OVERWATCH';

export interface FormationSlotOffset {
  /** Local right (+X) offset relative to anchor forward */
  rightMeters: number;
  /** Local forward (+Z) offset relative to anchor forward */
  forwardMeters: number;
  /** Desired role affinity index (0 = lead/flank, 1 = support/center, 2 = rear/medic) */
  slotIndex: number;
}

export interface FormationWorldSlot {
  x: number;
  y: number;
  z: number;
  slotIndex: number;
  formation: SquadFormationType;
}

export interface DynamicFormationContext {
  /** Measured lateral clearance width at anchor (meters) */
  corridorWidthMeters: number;
  /** Whether anchor or companion is traversing stairs, bridge, or ramp */
  onVerticalPortalOrBridge: boolean;
  /** Whether squad is near or boarding a cargo lift / tight interior cover */
  nearCargoLiftOrCluster: boolean;
  /** Whether active tactical intent is defensive line / suppression hold */
  isFiringLineIntent: boolean;
  /** Active hostile exposure level [0..1] */
  threatExposure: number;
  /** Optional: elevated or long-range threats active (> 28m) encouraging staggered Overwatch */
  hasDistantOrElevatedThreats?: boolean;
  /** Optional: player actively advancing in open corridor while engaging threats */
  isBoundingAdvance?: boolean;
}

const WEDGE_OFFSETS: readonly FormationSlotOffset[] = Object.freeze([
  Object.freeze({ slotIndex: 0, rightMeters: -2.6, forwardMeters: -2.0 }),
  Object.freeze({ slotIndex: 1, rightMeters: 2.6, forwardMeters: -2.0 }),
  Object.freeze({ slotIndex: 2, rightMeters: 0.0, forwardMeters: -4.2 }),
]);

const COLUMN_OFFSETS: readonly FormationSlotOffset[] = Object.freeze([
  Object.freeze({ slotIndex: 0, rightMeters: 0.0, forwardMeters: -1.8 }),
  Object.freeze({ slotIndex: 1, rightMeters: 0.15, forwardMeters: -3.5 }),
  Object.freeze({ slotIndex: 2, rightMeters: -0.15, forwardMeters: -5.2 }),
]);

const LINE_OFFSETS: readonly FormationSlotOffset[] = Object.freeze([
  Object.freeze({ slotIndex: 0, rightMeters: -3.4, forwardMeters: -0.4 }),
  Object.freeze({ slotIndex: 1, rightMeters: 3.4, forwardMeters: -0.4 }),
  Object.freeze({ slotIndex: 2, rightMeters: -0.2, forwardMeters: -2.2 }),
]);

const COMPACT_OFFSETS: readonly FormationSlotOffset[] = Object.freeze([
  Object.freeze({ slotIndex: 0, rightMeters: -1.35, forwardMeters: -1.25 }),
  Object.freeze({ slotIndex: 1, rightMeters: 1.35, forwardMeters: -1.25 }),
  Object.freeze({ slotIndex: 2, rightMeters: 0.0, forwardMeters: -2.35 }),
]);

/**
 * Staggered Overwatch formation (TRN-43):
 * Wide mutual-support firing arc keeping lead flanker forward-left, heavy support mid-right,
 * and recon/medic anchored back-center with clean crossfire lanes.
 */
const OVERWATCH_OFFSETS: readonly FormationSlotOffset[] = Object.freeze([
  Object.freeze({ slotIndex: 0, rightMeters: -3.8, forwardMeters: -1.2 }),
  Object.freeze({ slotIndex: 1, rightMeters: 3.6, forwardMeters: -2.6 }),
  Object.freeze({ slotIndex: 2, rightMeters: -0.6, forwardMeters: -4.8 }),
]);

/**
 * Role priority score for slot affinity:
 * Lower score gets closer/front-flank slot (0); higher score gets protected/rear overwatch slot (2).
 */
const ROLE_SLOT_PRIORITY: Readonly<Record<SquadRoleId, number>> = Object.freeze({
  assault: 0,
  anti_armor: 1,
  support: 2,
  recon: 3,
  medic: 4,
});

/**
 * Deterministically assigns formation slot indices by operator tactical role
 * so Assault/Anti-Armor take lead flanks while Support/Recon/Medic hold anchored overwatch/rear slots.
 */
export function assignFormationSlotIndicesByRole(roles: readonly SquadRoleId[]): number[] {
  const indexed = roles.map((role, idx) => ({
    idx,
    priority: ROLE_SLOT_PRIORITY[role] ?? 2,
  }));
  indexed.sort((a, b) => a.priority - b.priority || a.idx - b.idx);
  const assigned = new Array<number>(roles.length);
  for (let slot = 0; slot < indexed.length; slot++) {
    assigned[indexed[slot].idx] = slot;
  }
  return assigned;
}

/**
 * Pure dynamic formation selector (TRN-37 + TRN-43).
 * Automatically adapts formation profile based on corridor bottleneck width,
 * vertical stairs/bridges, cargo lift proximity, long-range overwatch threats, and firing-line intent.
 */
export function selectDynamicFormation(ctx: DynamicFormationContext): SquadFormationType {
  if (ctx.nearCargoLiftOrCluster) {
    return 'COMPACT';
  }
  // Bottleneck protection: collapse to single-file COLUMN in doors, narrow halls, stairs, or bridges
  if (ctx.onVerticalPortalOrBridge || ctx.corridorWidthMeters < 2.2) {
    return 'COLUMN';
  }
  if (ctx.isFiringLineIntent && ctx.corridorWidthMeters >= 4.2) {
    return 'LINE';
  }
  if (
    ctx.hasDistantOrElevatedThreats &&
    ctx.corridorWidthMeters >= 4.0 &&
    ctx.threatExposure < 0.72
  ) {
    return 'OVERWATCH';
  }
  if (ctx.threatExposure >= 0.7 && ctx.corridorWidthMeters < 3.6) {
    return 'COMPACT';
  }
  return 'WEDGE';
}

export function getFormationOffsets(formation: SquadFormationType): readonly FormationSlotOffset[] {
  switch (formation) {
    case 'COLUMN':
      return COLUMN_OFFSETS;
    case 'LINE':
      return LINE_OFFSETS;
    case 'COMPACT':
      return COMPACT_OFFSETS;
    case 'OVERWATCH':
      return OVERWATCH_OFFSETS;
    case 'WEDGE':
    default:
      return WEDGE_OFFSETS;
  }
}

/**
 * Computes a gentle lateral step-aside vector when a companion stands directly inside the player's
 * forward line-of-fire cone (within 12m and ±14° of player aim), eliminating friendly body-blocking
 * without breaking formation cohesion.
 */
export function computeCrossfireClearanceOffset(params: {
  playerX: number;
  playerZ: number;
  playerForwardX: number;
  playerForwardZ: number;
  operatorX: number;
  operatorZ: number;
  outOffset: { x: number; z: number };
}): boolean {
  const fLen = Math.hypot(params.playerForwardX, params.playerForwardZ);
  if (fLen < 1e-4) {
    params.outOffset.x = 0;
    params.outOffset.z = 0;
    return false;
  }
  const fx = params.playerForwardX / fLen;
  const fz = params.playerForwardZ / fLen;
  const rx = -fz;
  const rz = fx;

  const relX = params.operatorX - params.playerX;
  const relZ = params.operatorZ - params.playerZ;
  const forwardProj = relX * fx + relZ * fz;
  const rightProj = relX * rx + relZ * rz;

  // Inside active forward muzzle corridor (1.0m to 12.5m ahead, within ~1.4m lateral cone)
  if (forwardProj > 1.0 && forwardProj < 12.5) {
    const halfConeWidth = Math.max(1.15, forwardProj * 0.24);
    if (Math.abs(rightProj) < halfConeWidth) {
      const pushSide = rightProj >= 0 ? 1 : -1;
      const pushMag = (halfConeWidth - Math.abs(rightProj)) + 0.85;
      params.outOffset.x = rx * pushSide * pushMag;
      params.outOffset.z = rz * pushSide * pushMag;
      return true;
    }
  }

  params.outOffset.x = 0;
  params.outOffset.z = 0;
  return false;
}

/**
 * Zero-allocation world-space formation slot projector.
 * Writes directly into the caller's `outSlots` scratch buffer.
 */
export function projectFormationSlotsInto(
  anchorX: number,
  anchorY: number,
  anchorZ: number,
  forwardX: number,
  forwardZ: number,
  formation: SquadFormationType,
  slotCount: number,
  outSlots: FormationWorldSlot[]
): number {
  const len = Math.hypot(forwardX, forwardZ);
  const fx = len > 1e-4 ? forwardX / len : 0;
  const fz = len > 1e-4 ? forwardZ / len : -1;
  // Right-hand perpendicular on XZ plane
  const rx = -fz;
  const rz = fx;

  const offsets = getFormationOffsets(formation);
  const count = Math.min(slotCount, offsets.length);

  for (let i = 0; i < count; i++) {
    const off = offsets[i];
    const wx = anchorX + rx * off.rightMeters + fx * off.forwardMeters;
    const wz = anchorZ + rz * off.rightMeters + fz * off.forwardMeters;
    if (!outSlots[i]) {
      outSlots[i] = { x: wx, y: anchorY, z: wz, slotIndex: i, formation };
    } else {
      outSlots[i].x = wx;
      outSlots[i].y = anchorY;
      outSlots[i].z = wz;
      outSlots[i].slotIndex = i;
      outSlots[i].formation = formation;
    }
  }

  return count;
}
