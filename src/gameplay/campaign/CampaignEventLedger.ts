import {
  CampaignEvent,
  CampaignEventId,
  CampaignLedger,
  ReplayMode,
  SquadOperatorRecord,
} from '@/src/schemas/campaign.schema';
import { Difficulty } from '@/src/schemas/common.schema';

export interface CampaignEventDraft {
  eventId: CampaignEventId;
  missionId: number;
  outcome: 'achieved' | 'failed' | 'bypassed';
  operatorId?: string;
  summary: string;
}

export interface ResolvedCampaignState {
  /** Active non-superseded canonical events keyed by `${missionId}:${eventId}:${operatorId ?? ''}` */
  activeEvents: CampaignEvent[];
  eventMap: Record<string, CampaignEvent>;
  achievedFlags: Set<CampaignEventId>;
  timelineRevision: number;
}

export interface MissionConsequenceModifiers {
  missionId: number;
  replayMode: ReplayMode;
  /** Multiplier on enemy inter-squad radio relay delay (1.0 = baseline, >1.0 = slower enemy comms) */
  enemyCommsDelayMult: number;
  /** Multiplier on enemy air-defense/drone pressure (1.0 = baseline, <1.0 = degraded radar) */
  airPressureMult: number;
  /** Multiplier on reinforcement wave cooldown (1.0 = baseline, >1.0 = slower reinforcements) */
  reinforcementIntervalMult: number;
  /** Bonus supply charges added to mission sustainment stations */
  bonusSupplyCharges: number;
  /** Bonus starting grenades / C4 from secured prior caches */
  bonusStartingC4: number;
  /** Whether verified tactical intel markers are unlocked for this mission */
  verifiedIntelUnlocked: boolean;
  /** Human-readable list of active cross-mission consequences shown in HQ Briefing & Inspector */
  activeSummaries: Array<{
    sourceMissionId: number;
    eventId: CampaignEventId;
    title: string;
    effectDescription: string;
    polarity: 'advantage' | 'pressure' | 'neutral';
  }>;
}

export interface MissionIntelItem {
  id: string;
  label: string;
  detail: string;
  verified: boolean;
  sourceLabel: string;
}

export interface CampaignRebaseDiff {
  missionId: number;
  addedEvents: CampaignEventDraft[];
  changedEvents: Array<{ previous: CampaignEvent; next: CampaignEventDraft }>;
  affectedDownstreamMissions: number[];
  hasCanonicalDifference: boolean;
}

/** Deterministic FNV-1a 32-bit hash for idempotent event payload identity */
export function computeDeterministicHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildEventPayloadHash(draft: CampaignEventDraft): string {
  return computeDeterministicHash(
    `${draft.missionId}|${draft.eventId}|${draft.outcome}|${draft.operatorId ?? ''}`
  );
}

export function getSemanticEventKey(
  missionId: number,
  eventId: CampaignEventId,
  operatorId?: string
): string {
  return `${missionId}:${eventId}:${operatorId ?? ''}`;
}

/**
 * Pure deterministic fold over a CampaignLedger.
 * - Sorts strictly by integer `sequence` (never wall-clock timestamps).
 * - Ignores non-canonical events (`staged_replay`, `score_only`).
 * - Idempotent: duplicate `(missionId, eventId, operatorId, payloadHash)` entries produce identical output.
 * - Later sequence numbers for the same semantic key supersede earlier ones cleanly.
 */
export function foldCampaignLedger(ledger: CampaignLedger): ResolvedCampaignState {
  const canonicalSorted = ledger.events
    .filter((e) => e.category === 'canonical' && e.supersededBySequence === undefined)
    .slice()
    .sort((a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId));

  const latestByKey = new Map<string, CampaignEvent>();
  for (let i = 0; i < canonicalSorted.length; i++) {
    const ev = canonicalSorted[i];
    const key = getSemanticEventKey(ev.missionId, ev.eventId, ev.operatorId);
    const prev = latestByKey.get(key);
    if (!prev || ev.sequence >= prev.sequence) {
      latestByKey.set(key, ev);
    }
  }

  const activeEvents = Array.from(latestByKey.values()).sort((a, b) => a.sequence - b.sequence);
  const eventMap: Record<string, CampaignEvent> = {};
  const achievedFlags = new Set<CampaignEventId>();

  for (const ev of activeEvents) {
    eventMap[getSemanticEventKey(ev.missionId, ev.eventId, ev.operatorId)] = ev;
    if (ev.outcome === 'achieved') {
      achievedFlags.add(ev.eventId);
    }
  }

  return {
    activeEvents,
    eventMap,
    achievedFlags,
    timelineRevision: ledger.timelineRevision,
  };
}

/**
 * Computes downstream missions affected if Mission M's canonical events are modified.
 */
export function computeAffectedDownstreamMissions(
  missionId: number,
  completedMissionIds: readonly number[]
): number[] {
  return completedMissionIds
    .filter((id) => id > missionId)
    .slice()
    .sort((a, b) => a - b);
}

/**
 * Stages a replay diff without mutating canonical state.
 * Used when `replayMode === 'campaign_replay'` so the player sees exact consequences before committing.
 */
export function previewCampaignRebaseDiff(
  ledger: CampaignLedger,
  missionId: number,
  incomingDrafts: readonly CampaignEventDraft[],
  completedMissionIds: readonly number[]
): CampaignRebaseDiff {
  const folded = foldCampaignLedger(ledger);
  const addedEvents: CampaignEventDraft[] = [];
  const changedEvents: Array<{ previous: CampaignEvent; next: CampaignEventDraft }> = [];

  for (const draft of incomingDrafts) {
    const key = getSemanticEventKey(draft.missionId, draft.eventId, draft.operatorId);
    const existing = folded.eventMap[key];
    const nextHash = buildEventPayloadHash(draft);

    if (!existing) {
      addedEvents.push(draft);
    } else if (existing.payloadHash !== nextHash) {
      changedEvents.push({ previous: existing, next: draft });
    }
  }

  const hasCanonicalDifference = addedEvents.length > 0 || changedEvents.length > 0;
  const affectedDownstreamMissions = hasCanonicalDifference
    ? computeAffectedDownstreamMissions(missionId, completedMissionIds)
    : [];

  return {
    missionId,
    addedEvents,
    changedEvents,
    affectedDownstreamMissions,
    hasCanonicalDifference,
  };
}

/**
 * Idempotently commits canonical events into a CampaignLedger.
 * - Clean Replay is strictly barred from modifying the ledger.
 * - Exact duplicate payloads are skipped without incrementing `nextSequence`.
 * - Changed events supersede prior entries deterministically and mark downstream shifted missions.
 */
export function commitCampaignEvents(
  ledger: CampaignLedger,
  missionId: number,
  drafts: readonly CampaignEventDraft[],
  replayMode: ReplayMode,
  completedMissionIds: readonly number[]
): { ledger: CampaignLedger; committedCount: number; rebasedDownstream: number[] } {
  if (replayMode === 'clean_replay' || drafts.length === 0) {
    return { ledger, committedCount: 0, rebasedDownstream: [] };
  }

  const folded = foldCampaignLedger(ledger);
  let nextSeq = Math.max(
    ledger.nextSequence,
    ledger.events.reduce((max, e) => Math.max(max, e.sequence + 1), 1)
  );

  const updatedEvents = ledger.events.map((e) => ({ ...e }));
  let committedCount = 0;
  let timelineChanged = false;

  for (const draft of drafts) {
    const key = getSemanticEventKey(draft.missionId, draft.eventId, draft.operatorId);
    const nextHash = buildEventPayloadHash(draft);
    const existing = folded.eventMap[key];

    // Strict idempotency: identical semantic event + outcome is a no-op
    if (existing && existing.payloadHash === nextHash) {
      continue;
    }

    const assignedSeq = nextSeq++;
    if (existing) {
      timelineChanged = true;
      for (let i = 0; i < updatedEvents.length; i++) {
        const candidate = updatedEvents[i];
        if (
          candidate.sequence === existing.sequence &&
          candidate.supersededBySequence === undefined
        ) {
          updatedEvents[i] = { ...candidate, supersededBySequence: assignedSeq };
        }
      }
    }

    updatedEvents.push({
      sequence: assignedSeq,
      eventId: draft.eventId,
      missionId: draft.missionId,
      category: 'canonical',
      schemaVersion: 1,
      outcome: draft.outcome,
      operatorId: draft.operatorId,
      summary: draft.summary,
      payloadHash: nextHash,
    });
    committedCount++;
  }

  if (committedCount === 0) {
    return { ledger, committedCount: 0, rebasedDownstream: [] };
  }

  const rebasedDownstream =
    replayMode === 'campaign_replay' && timelineChanged
      ? computeAffectedDownstreamMissions(missionId, completedMissionIds)
      : [];

  const mergedShifted = Array.from(
    new Set([...ledger.shiftedDownstreamMissions, ...rebasedDownstream])
  ).sort((a, b) => a - b);

  return {
    ledger: {
      nextSequence: nextSeq,
      events: updatedEvents,
      timelineRevision: ledger.timelineRevision + (timelineChanged ? 1 : 0),
      shiftedDownstreamMissions: mergedShifted,
    },
    committedCount,
    rebasedDownstream,
  };
}

/**
 * Pure downstream consequence resolver for Operations 1–5.
 * In `clean_replay`, always returns baseline modifiers regardless of canonical ledger state.
 */
export function resolveMissionConsequences(
  missionId: number,
  ledger: CampaignLedger,
  replayMode: ReplayMode
): MissionConsequenceModifiers {
  const baseline: MissionConsequenceModifiers = {
    missionId,
    replayMode,
    enemyCommsDelayMult: 1.0,
    airPressureMult: 1.0,
    reinforcementIntervalMult: 1.0,
    bonusSupplyCharges: 0,
    bonusStartingC4: 0,
    verifiedIntelUnlocked: false,
    activeSummaries: [],
  };

  if (replayMode === 'clean_replay') {
    return baseline;
  }

  const resolved = foldCampaignLedger(ledger);
  const flags = resolved.achievedFlags;

  // Op 1 consequences -> Ops 2..5
  if (missionId >= 2 && flags.has('op1_comms_destroyed')) {
    baseline.enemyCommsDelayMult *= 1.8;
    baseline.reinforcementIntervalMult *= 1.18;
    baseline.activeSummaries.push({
      sourceMissionId: 1,
      eventId: 'op1_comms_destroyed',
      title: 'Urban AA Comms Disrupted',
      effectDescription: 'Hostile inter-squad radio relays delayed +80% and reinforcement cadence slowed.',
      polarity: 'advantage',
    });
  }
  if (missionId >= 2 && flags.has('op1_intel_secured')) {
    baseline.verifiedIntelUnlocked = true;
    baseline.activeSummaries.push({
      sourceMissionId: 1,
      eventId: 'op1_intel_secured',
      title: 'Vanguard Street Intel Secured',
      effectDescription: 'Unlocks Verified Theater Intelligence in pre-deployment briefing.',
      polarity: 'advantage',
    });
  }

  // Op 2 consequences -> Ops 3..5
  if (missionId >= 3 && flags.has('op2_fuel_cache_secured')) {
    baseline.bonusSupplyCharges += 1;
    baseline.bonusStartingC4 += 1;
    baseline.activeSummaries.push({
      sourceMissionId: 2,
      eventId: 'op2_fuel_cache_secured',
      title: 'Highway 14 Fuel & Munitions Seized',
      effectDescription: '+1 reserve charge on sustainment stations and +1 starting C4 charge.',
      polarity: 'advantage',
    });
  }
  if (missionId >= 3 && flags.has('op2_bunker_intel_captured')) {
    baseline.verifiedIntelUnlocked = true;
    baseline.activeSummaries.push({
      sourceMissionId: 2,
      eventId: 'op2_bunker_intel_captured',
      title: 'Refinery Cipher Intercepted',
      effectDescription: 'Reveals verified hostile patrol vectors and radar elevation notes.',
      polarity: 'advantage',
    });
  }

  // Op 3 consequences -> Ops 4..5
  if (missionId >= 4 && flags.has('op3_radar_network_disabled')) {
    baseline.airPressureMult *= 0.72;
    baseline.activeSummaries.push({
      sourceMissionId: 3,
      eventId: 'op3_radar_network_disabled',
      title: 'Nightfall Radar Grid Blinded',
      effectDescription: 'Hostile drone & rotorcraft pressure reduced by 28% in downstream ops.',
      polarity: 'advantage',
    });
  }

  // Op 4 consequences -> Op 5
  if (missionId >= 5 && flags.has('op4_jungle_cache_secured')) {
    baseline.bonusSupplyCharges += 1;
    baseline.activeSummaries.push({
      sourceMissionId: 4,
      eventId: 'op4_jungle_cache_secured',
      title: 'Canopy Forward Cache Recovered',
      effectDescription: 'Additional forward ammo/trauma supply charge deployed inside Blackout foundry.',
      polarity: 'advantage',
    });
  }
  if (missionId >= 5 && flags.has('op4_comms_jammer_planted')) {
    baseline.enemyCommsDelayMult *= 1.35;
    baseline.reinforcementIntervalMult *= 1.15;
    baseline.activeSummaries.push({
      sourceMissionId: 4,
      eventId: 'op4_comms_jammer_planted',
      title: 'Viper Comms Jammer Active',
      effectDescription: 'Foundry quick-reaction teams suffer delayed dispatch and fragmented coordination.',
      polarity: 'advantage',
    });
  }

  return baseline;
}

/**
 * Generates Verified vs. Uncertain Tactical Intelligence rows for TRN-38 Operations Briefing.
 */
export function getMissionIntelBriefing(
  missionId: number,
  consequences: MissionConsequenceModifiers
): MissionIntelItem[] {
  const verifiedByPriorOp = consequences.verifiedIntelUnlocked;

  const catalog: Record<number, MissionIntelItem[]> = {
    1: [
      {
        id: 'm1_aa',
        label: 'AA Relay Corridor',
        detail: 'Three street-level anti-air transponders guarded by rifle & flanker squads.',
        verified: true,
        sourceLabel: 'Satellite Recon (Verified)',
      },
      {
        id: 'm1_overwatch',
        label: 'Rooftop Crossfire',
        detail: 'Estimated 2–3 elevated marksmen covering the central boulevard.',
        verified: false,
        sourceLabel: 'Unverified Field Estimate',
      },
      {
        id: 'm1_climax',
        label: 'Air Response Threat',
        detail: 'Possible hostile attack helicopter scramble once AA links drop.',
        verified: false,
        sourceLabel: 'Signal Intercept (Uncertain)',
      },
    ],
    2: [
      {
        id: 'm2_convoy',
        label: 'Highway 14 Armored Convoy',
        detail: 'Armed gun-trucks escorting fuel carriers toward the desert refinery.',
        verified: true,
        sourceLabel: 'Drone Overwatch (Verified)',
      },
      {
        id: 'm2_bunkers',
        label: 'Refinery Inner Garrison',
        detail: verifiedByPriorOp
          ? 'Confirmed heavy armor juggernauts + AT specialists on west berm; flanking lane open east.'
          : 'Unconfirmed heavy armor presence inside refinery walls; watch west elevation.',
        verified: verifiedByPriorOp,
        sourceLabel: verifiedByPriorOp ? 'Op 1 Intel (Verified)' : 'Unverified Recon Estimate',
      },
    ],
    3: [
      {
        id: 'm3_searchlights',
        label: 'Searchlight Sweep Towers',
        detail: 'Rotating spotlight towers alert nearby squads on contact; destroyable or avoidable.',
        verified: true,
        sourceLabel: 'Nightfall Recon (Verified)',
      },
      {
        id: 'm3_air_screen',
        label: 'Midnight Drone & Rotorcraft Screen',
        detail: verifiedByPriorOp
          ? 'Confirmed drone operators positioned on upper catwalk lift decks; guided missiles effective.'
          : 'Estimated mixed drone/helicopter patrol density; exact rooftop perches unconfirmed.',
        verified: verifiedByPriorOp,
        sourceLabel: verifiedByPriorOp ? 'Op 2 Cipher (Verified)' : 'Uncertain Thermal Scan',
      },
    ],
    4: [
      {
        id: 'm4_river',
        label: 'Canopy River Bridges',
        detail: 'Narrow bridge chokepoints covered by elevated watchtowers; use Column formation.',
        verified: true,
        sourceLabel: 'Aerial Mapping (Verified)',
      },
      {
        id: 'm4_air_support',
        label: 'Hostile Air-Defense Posture',
        detail:
          consequences.airPressureMult < 0.9
            ? 'Confirmed degraded enemy air screen following Op 3 radar strike (-28% pressure).'
            : 'Unverified air support response; radar grid remains operational.',
        verified: consequences.airPressureMult < 0.9,
        sourceLabel:
          consequences.airPressureMult < 0.9 ? 'Op 3 Strike Impact (Verified)' : 'Uncertain Air Intel',
      },
    ],
    5: [
      {
        id: 'm5_foundry',
        label: 'Foundry Slag & Multi-Tier Catwalks',
        detail: 'Active molten slag zones and cargo lifts linking lower smelters to command deck.',
        verified: true,
        sourceLabel: 'Blueprint Archive (Verified)',
      },
      {
        id: 'm5_qrf',
        label: 'Command Quick-Reaction Forces',
        detail:
          consequences.enemyCommsDelayMult > 1.2
            ? 'Confirmed delayed foundry QRF dispatches due to disrupted comms network.'
            : 'Full-strength coordinated garrison expected; exact wave timing unconfirmed.',
        verified: consequences.enemyCommsDelayMult > 1.2,
        sourceLabel:
          consequences.enemyCommsDelayMult > 1.2 ? 'Campaign Comms Intel (Verified)' : 'Unverified Threat Model',
      },
    ],
  };

  return catalog[missionId] ?? catalog[1];
}

/**
 * Pure recovery & injury progression step executed strictly on canonical mission completion.
 * Never decrements recovery timers on Clean Replay or mission abort.
 */
export const HQ_RECOVERY_SEC_PER_TIER = 180;

export interface OperatorRecoverySummary {
  isRecovering: boolean;
  progressPct: number;
  elapsedSec: number;
  targetSec: number;
  remainingSec: number;
  remainingOps: number;
  etaLabel: string;
}

export function computeOperatorRecoverySummary(op: SquadOperatorRecord): OperatorRecoverySummary {
  if (op.status !== 'recovering') {
    return {
      isRecovering: false,
      progressPct: 100,
      elapsedSec: 0,
      targetSec: 0,
      remainingSec: 0,
      remainingOps: 0,
      etaLabel: 'READY',
    };
  }

  const targetSec =
    op.recoveryTargetSec > 0
      ? op.recoveryTargetSec
      : Math.max(1, op.recoveryOpsRemaining) * HQ_RECOVERY_SEC_PER_TIER;
  const elapsedSec = Math.min(targetSec, Math.max(0, op.recoveryElapsedSec ?? 0));
  const remainingSec = Math.max(0, Math.round(targetSec - elapsedSec));
  const remainingOps = Math.max(
    op.recoveryOpsRemaining > 0 ? 1 : 0,
    Math.ceil(remainingSec / HQ_RECOVERY_SEC_PER_TIER)
  );
  const progressPct = Math.min(99, Math.max(0, Math.round((elapsedSec / Math.max(1, targetSec)) * 100)));
  const remMin = Math.floor(remainingSec / 60);
  const remSec = remainingSec % 60;
  const etaLabel =
    remMin > 0 ? `${remMin}m ${String(remSec).padStart(2, '0')}s op time` : `${remSec}s op time`;

  return {
    isRecovering: true,
    progressPct,
    elapsedSec,
    targetSec,
    remainingSec,
    remainingOps,
    etaLabel,
  };
}

export function advanceRosterAfterOperation(
  roster: readonly SquadOperatorRecord[],
  missionOutcome: {
    replayMode: ReplayMode;
    victory: boolean;
    difficulty: Difficulty;
    ironmanActive: boolean;
    deploymentMode?: 'solo' | 'fireteam';
    missionElapsedSec?: number;
    operationRunId?: string;
    creditedOperationRunIds?: readonly string[];
    operatorReports: ReadonlyArray<{
      operatorId: string;
      deployed: boolean;
      survived: boolean;
      becameMia: boolean;
      timesDowned: number;
      severeInjury: boolean;
      kills: number;
      revivesPerformed: number;
      vehiclesDisabled: number;
      spotsMarked: number;
      suppressionAssists: number;
    }>;
  }
): SquadOperatorRecord[] {
  // Clean Replay is strictly isolated from persistent roster state & HQ recovery
  if (missionOutcome.replayMode === 'clean_replay') {
    return roster.map((op) => ({ ...op }));
  }

  // Exploit protection: deduplicate credited operation runs across retries/checkpoint reloads
  const alreadyCredited =
    Boolean(missionOutcome.operationRunId) &&
    Boolean(missionOutcome.creditedOperationRunIds?.includes(missionOutcome.operationRunId!));

  const isSoloDeployment = missionOutcome.deploymentMode === 'solo';
  const reportById = isSoloDeployment
    ? new Map<string, (typeof missionOutcome.operatorReports)[number]>()
    : new Map(missionOutcome.operatorReports.map((r) => [r.operatorId, r]));

  // Authoritative mission elapsed time (bounded against short retry farming; victories guarantee >= 1 full tier)
  const rawElapsedSec = Math.max(0, Math.round(missionOutcome.missionElapsedSec ?? 0));
  const creditedRecoverySec = alreadyCredited
    ? 0
    : missionOutcome.victory
      ? Math.max(HQ_RECOVERY_SEC_PER_TIER, Math.min(HQ_RECOVERY_SEC_PER_TIER * 2, rawElapsedSec || HQ_RECOVERY_SEC_PER_TIER))
      : rawElapsedSec >= 45
        ? Math.min(Math.round(HQ_RECOVERY_SEC_PER_TIER * 0.5), rawElapsedSec)
        : 0;

  return roster.map((op) => {
    const report = reportById.get(op.id);

    // Operator rested safely at HQ while this Solo or Fireteam canonical operation ran
    if (!report || !report.deployed) {
      if (op.status === 'recovering' && creditedRecoverySec > 0) {
        const currentTarget =
          op.recoveryTargetSec > 0
            ? op.recoveryTargetSec
            : Math.max(1, op.recoveryOpsRemaining) * HQ_RECOVERY_SEC_PER_TIER;
        const currentElapsed = Math.max(0, op.recoveryElapsedSec ?? 0);
        const nextElapsed = Math.min(currentTarget, currentElapsed + creditedRecoverySec);
        const remainingSec = Math.max(0, currentTarget - nextElapsed);
        const remainingOps =
          remainingSec <= 0 ? 0 : Math.max(1, Math.ceil(remainingSec / HQ_RECOVERY_SEC_PER_TIER));

        return {
          ...op,
          recoveryOpsRemaining: remainingOps,
          recoveryElapsedSec: remainingOps === 0 ? 0 : nextElapsed,
          recoveryTargetSec: remainingOps === 0 ? 0 : currentTarget,
          status: remainingOps === 0 ? 'active' : 'recovering',
          injurySeverity: remainingOps === 0 ? 'none' : op.injurySeverity,
        };
      }
      return { ...op };
    }

    // Operator deployed in this Fireteam op
    const nextKills = op.kills + report.kills;
    const nextRevives = op.revivesPerformed + report.revivesPerformed;
    const nextVehicles = op.vehiclesDisabled + report.vehiclesDisabled;
    const nextSpots = op.spotsMarked + report.spotsMarked;
    const nextSuppression = op.suppressionAssists + report.suppressionAssists;
    const xpGain =
      (missionOutcome.victory ? 120 : 40) +
      report.kills * 15 +
      report.revivesPerformed * 35 +
      report.vehiclesDisabled * 40 +
      report.spotsMarked * 8;

    let nextStatus = op.status;
    let nextRecoveryOps = op.recoveryOpsRemaining;
    let nextRecoveryElapsedSec = op.recoveryElapsedSec ?? 0;
    let nextRecoveryTargetSec = op.recoveryTargetSec ?? 0;
    let nextSeverity = op.injurySeverity;
    let nextTimesMia = op.timesMia;

    if (report.becameMia) {
      nextTimesMia += 1;
      if (missionOutcome.ironmanActive) {
        nextStatus = 'kia';
        nextRecoveryOps = 0;
        nextRecoveryElapsedSec = 0;
        nextRecoveryTargetSec = 0;
        nextSeverity = 'severe';
      } else {
        nextStatus = 'recovering';
        nextSeverity = report.severeInjury || report.timesDowned >= 2 ? 'severe' : 'light';
        if (missionOutcome.difficulty === 'easy') {
          nextRecoveryOps = 1;
        } else if (missionOutcome.difficulty === 'normal') {
          nextRecoveryOps = nextSeverity === 'severe' ? 2 : 1;
        } else {
          nextRecoveryOps = 2;
        }
        nextRecoveryElapsedSec = 0;
        nextRecoveryTargetSec = nextRecoveryOps * HQ_RECOVERY_SEC_PER_TIER;
      }
    } else {
      nextStatus = 'active';
      nextRecoveryOps = 0;
      nextRecoveryElapsedSec = 0;
      nextRecoveryTargetSec = 0;
      nextSeverity = 'none';
    }

    return {
      ...op,
      status: nextStatus,
      recoveryOpsRemaining: nextRecoveryOps,
      recoveryElapsedSec: nextRecoveryElapsedSec,
      recoveryTargetSec: nextRecoveryTargetSec,
      injurySeverity: nextSeverity,
      missionsDeployed: op.missionsDeployed + 1,
      missionsSurvived: op.missionsSurvived + (report.survived && !report.becameMia ? 1 : 0),
      kills: nextKills,
      revivesPerformed: nextRevives,
      vehiclesDisabled: nextVehicles,
      spotsMarked: nextSpots,
      suppressionAssists: nextSuppression,
      timesDowned: op.timesDowned + report.timesDowned,
      timesMia: nextTimesMia,
      xp: op.xp + xpGain,
    };
  });
}

/**
 * Synthesizes canonical baseline events for legacy saves that already have completed missions
 * so returning Stage 1–6 players immediately see coherent campaign history without resets.
 */
export function synthesizeLegacyCampaignLedger(
  completedMissionIds: readonly number[]
): CampaignLedger {
  const sorted = Array.from(new Set(completedMissionIds))
    .filter((id) => id >= 1 && id <= 5)
    .sort((a, b) => a - b);

  const events: CampaignEvent[] = [];
  let seq = 1;

  const defaultsByMission: Record<number, CampaignEventDraft[]> = {
    1: [
      {
        eventId: 'op1_comms_destroyed',
        missionId: 1,
        outcome: 'achieved',
        summary: 'Urban AA relay communications neutralized during Operation Iron Dawn.',
      },
    ],
    2: [
      {
        eventId: 'op2_convoy_neutralized',
        missionId: 2,
        outcome: 'achieved',
        summary: 'Highway 14 armored convoy intercepted during Operation Red Dust.',
      },
    ],
    3: [
      {
        eventId: 'op3_radar_network_disabled',
        missionId: 3,
        outcome: 'achieved',
        summary: 'Midnight air-defense radar grid disabled during Operation Nightfall.',
      },
    ],
    4: [
      {
        eventId: 'op4_river_watchtowers_cleared',
        missionId: 4,
        outcome: 'achieved',
        summary: 'River crossing watchtowers cleared during Operation Viper Canopy.',
      },
    ],
    5: [
      {
        eventId: 'op5_command_core_neutralized',
        missionId: 5,
        outcome: 'achieved',
        summary: 'Blackout fortress command core neutralized.',
      },
    ],
  };

  for (const mId of sorted) {
    const drafts = defaultsByMission[mId] ?? [];
    for (const d of drafts) {
      events.push({
        sequence: seq++,
        eventId: d.eventId,
        missionId: d.missionId,
        category: 'canonical',
        schemaVersion: 1,
        outcome: d.outcome,
        summary: d.summary,
        payloadHash: buildEventPayloadHash(d),
        synthesizedFromLegacySave: true,
      });
    }
  }

  return {
    nextSequence: seq,
    events,
    timelineRevision: 1,
    shiftedDownstreamMissions: [],
  };
}
