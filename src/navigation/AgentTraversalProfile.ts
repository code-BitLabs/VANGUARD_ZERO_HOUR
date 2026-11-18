export type AgentProfileId =
  | 'player'
  | 'standard_infantry'
  | 'heavy_infantry'
  | 'ground_vehicle';

export type PortalKind = 'ramp' | 'stair' | 'cargo_lift';

export const AGENT_PROFILE_MASK = {
  PLAYER: 1 << 0,
  STANDARD_INFANTRY: 1 << 1,
  HEAVY_INFANTRY: 1 << 2,
  GROUND_VEHICLE: 1 << 3,
} as const;

export const AGENT_PROFILE_ALL_INFANTRY_MASK =
  AGENT_PROFILE_MASK.PLAYER |
  AGENT_PROFILE_MASK.STANDARD_INFANTRY |
  AGENT_PROFILE_MASK.HEAVY_INFANTRY;

export const AGENT_PROFILE_ALL_MASK =
  AGENT_PROFILE_ALL_INFANTRY_MASK | AGENT_PROFILE_MASK.GROUND_VEHICLE;

export interface AgentTraversalProfile {
  id: AgentProfileId;
  code: number;
  maskBit: number;
  capsuleRadius: number;
  standingHeight: number;
  crouchedHeight: number;
  maxStepHeight: number;
  maxSlopeDeg: number;
  minPortalWidth: number;
  minClearanceHeight: number;
  allowedPortalKinds: readonly PortalKind[];
  canOperateCargoLifts: boolean;
}

export const AGENT_TRAVERSAL_PROFILES: Record<AgentProfileId, AgentTraversalProfile> = {
  player: {
    id: 'player',
    code: 0,
    maskBit: AGENT_PROFILE_MASK.PLAYER,
    capsuleRadius: 0.42,
    standingHeight: 1.75,
    crouchedHeight: 1.15,
    maxStepHeight: 0.48,
    maxSlopeDeg: 42,
    minPortalWidth: 1.0,
    minClearanceHeight: 1.8,
    allowedPortalKinds: ['ramp', 'stair', 'cargo_lift'],
    canOperateCargoLifts: true,
  },
  standard_infantry: {
    id: 'standard_infantry',
    code: 1,
    maskBit: AGENT_PROFILE_MASK.STANDARD_INFANTRY,
    capsuleRadius: 0.42,
    standingHeight: 1.75,
    crouchedHeight: 1.18,
    maxStepHeight: 0.46,
    maxSlopeDeg: 40,
    minPortalWidth: 1.1,
    minClearanceHeight: 1.8,
    allowedPortalKinds: ['ramp', 'stair', 'cargo_lift'],
    canOperateCargoLifts: true,
  },
  heavy_infantry: {
    id: 'heavy_infantry',
    code: 2,
    maskBit: AGENT_PROFILE_MASK.HEAVY_INFANTRY,
    capsuleRadius: 0.54,
    standingHeight: 1.92,
    crouchedHeight: 1.45,
    maxStepHeight: 0.42,
    maxSlopeDeg: 35,
    minPortalWidth: 1.6,
    minClearanceHeight: 2.0,
    allowedPortalKinds: ['ramp', 'cargo_lift'],
    canOperateCargoLifts: true,
  },
  ground_vehicle: {
    id: 'ground_vehicle',
    code: 3,
    maskBit: AGENT_PROFILE_MASK.GROUND_VEHICLE,
    capsuleRadius: 1.8,
    standingHeight: 2.4,
    crouchedHeight: 2.4,
    maxStepHeight: 0.35,
    maxSlopeDeg: 28,
    minPortalWidth: 3.6,
    minClearanceHeight: 3.0,
    allowedPortalKinds: ['ramp'],
    canOperateCargoLifts: false,
  },
};

const PROFILE_BY_CODE: readonly AgentTraversalProfile[] = [
  AGENT_TRAVERSAL_PROFILES.player,
  AGENT_TRAVERSAL_PROFILES.standard_infantry,
  AGENT_TRAVERSAL_PROFILES.heavy_infantry,
  AGENT_TRAVERSAL_PROFILES.ground_vehicle,
];

export function getAgentTraversalProfile(id: AgentProfileId): AgentTraversalProfile {
  return AGENT_TRAVERSAL_PROFILES[id];
}

export function getAgentProfileByCode(code: number): AgentTraversalProfile {
  return PROFILE_BY_CODE[code] ?? AGENT_TRAVERSAL_PROFILES.standard_infantry;
}

export function getAgentProfileCode(id: AgentProfileId): number {
  return AGENT_TRAVERSAL_PROFILES[id].code;
}

export interface PortalCapabilityCheckInput {
  kind: PortalKind;
  width: number;
  clearanceHeight: number;
  slopeDeg?: number;
  allowedProfilesMask: number;
  enabled: boolean;
}

export function canAgentUsePortal(
  profile: AgentTraversalProfile,
  portal: PortalCapabilityCheckInput
): boolean {
  if (!portal.enabled) return false;
  if ((portal.allowedProfilesMask & profile.maskBit) === 0) return false;
  if (!profile.allowedPortalKinds.includes(portal.kind)) {
    // Allow heavy infantry onto wide low-slope stairs only if width >= minPortalWidth and kind !== cargo_lift check passes
    if (
      !(
        profile.id === 'heavy_infantry' &&
        portal.kind === 'stair' &&
        portal.width >= 2.2 &&
        (portal.slopeDeg ?? 28) <= profile.maxSlopeDeg
      )
    ) {
      return false;
    }
  }
  if (portal.kind === 'cargo_lift' && !profile.canOperateCargoLifts) return false;
  if (portal.width < profile.minPortalWidth) return false;
  if (portal.clearanceHeight < profile.minClearanceHeight) return false;
  if (portal.slopeDeg !== undefined && portal.slopeDeg > profile.maxSlopeDeg) return false;
  return true;
}

export function buildAllowedProfilesMask(ids: readonly AgentProfileId[]): number {
  let mask = 0;
  for (let i = 0; i < ids.length; i++) {
    mask |= AGENT_TRAVERSAL_PROFILES[ids[i]].maskBit;
  }
  return mask;
}
