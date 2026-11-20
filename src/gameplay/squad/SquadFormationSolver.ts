export type SquadFormationType = 'WEDGE' | 'COLUMN' | 'LINE' | 'COMPACT';

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
 * Pure dynamic formation selector (TRN-37).
 * Automatically adapts formation profile based on corridor bottleneck width,
 * vertical stairs/bridges, cargo lift proximity, and firing-line intent.
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
    case 'WEDGE':
    default:
      return WEDGE_OFFSETS;
  }
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
