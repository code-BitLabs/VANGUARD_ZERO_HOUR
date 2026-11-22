import { beforeEach, describe, expect, it } from 'vitest';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import {
  createDefaultCoreRoster,
  resolveDeployableFireteam,
} from '@/src/data/squadRoster';
import {
  advanceRosterAfterOperation,
  CampaignEventDraft,
  commitCampaignEvents,
  foldCampaignLedger,
  previewCampaignRebaseDiff,
  resolveMissionConsequences,
} from '@/src/gameplay/campaign/CampaignEventLedger';
import {
  auditAllWeaponAttachmentCombinations,
  DEFAULT_EQUIPPED_ATTACHMENTS,
  resolveWeaponConfig,
} from '@/src/gameplay/weapons/AttachmentCompositionEngine';
import { CampaignLedger } from '@/src/schemas/campaign.schema';
import {
  migrateProgressionSave,
  ProgressionSaveSchema,
} from '@/src/schemas/save.schema';
import {
  BACKUP_KEY,
  SAVE_KEY,
  SaveManager,
  STAGING_KEY,
} from '@/src/storage/SaveManager';

function createEmptyLedger(): CampaignLedger {
  return {
    nextSequence: 1,
    events: [],
    timelineRevision: 1,
    shiftedDownstreamMissions: [],
  };
}

describe('Stage 7 Adversarial Suite A — Campaign Persistence, Roster Continuity & Attachment Balance (Scenarios 7–11)', () => {
  beforeEach(() => {
    SaveManager.resetProgression();
  });

  // Scenario 7: Exhausted 5-core roster auto-backfill + Clean Replay non-decrement
  it('Scenario 7: auto-backfills Reserve Specialists when all 5 core operators are unavailable and never decrements recovery in Clean Replay', () => {
    const roster = createDefaultCoreRoster().map((op, i) => ({
      ...op,
      status: (i < 3 ? 'recovering' : 'kia') as 'recovering' | 'kia',
      recoveryOpsRemaining: i < 3 ? 2 : 0,
    }));

    const resolved = resolveDeployableFireteam(
      roster,
      [roster[0].id, roster[1].id, roster[2].id],
      3
    );

    expect(resolved.operators).toHaveLength(3);
    expect(resolved.reserveCount).toBe(3);
    expect(resolved.operators.every((o) => o.id.startsWith('reserve_') && o.status === 'active')).toBe(
      true
    );

    // Clean Replay must NOT decrement recovery timers or mutate core roster status
    const afterCleanReplay = advanceRosterAfterOperation(roster, {
      replayMode: 'clean_replay',
      victory: true,
      difficulty: 'hard',
      ironmanActive: true,
      operatorReports: [
        {
          operatorId: roster[0].id,
          deployed: true,
          survived: false,
          becameMia: true,
          timesDowned: 2,
          severeInjury: true,
          kills: 5,
          revivesPerformed: 0,
          vehiclesDisabled: 0,
          spotsMarked: 0,
          suppressionAssists: 0,
        },
      ],
    });

    expect(afterCleanReplay[0].status).toBe('recovering');
    expect(afterCleanReplay[0].recoveryOpsRemaining).toBe(2);
    expect(afterCleanReplay[1].recoveryOpsRemaining).toBe(2);

    // Canonical mission completion DOES decrement recovery counters cleanly
    const afterCanonical = advanceRosterAfterOperation(roster, {
      replayMode: 'canonical',
      victory: true,
      difficulty: 'normal',
      ironmanActive: false,
      operatorReports: [],
    });
    expect(afterCanonical[0].recoveryOpsRemaining).toBe(1);
    expect(afterCanonical[0].status).toBe('recovering');
  });

  // Scenario 8: Duplicate & out-of-order campaign events (idempotency & deterministic folding)
  it('Scenario 8: enforces idempotency on duplicate drafts and deterministic order-invariant consequence folding', () => {
    const draftA: CampaignEventDraft = {
      missionId: 1,
      eventId: 'op1_comms_destroyed',
      outcome: 'achieved',
      summary: 'Destroyed Operation 1 hostile comms relay.',
    };
    const draftB: CampaignEventDraft = {
      missionId: 2,
      eventId: 'op2_convoy_neutralized',
      outcome: 'achieved',
      summary: 'Neutralized desert armor convoy.',
    };

    const firstCommit = commitCampaignEvents(
      createEmptyLedger(),
      1,
      [draftA, draftB],
      'canonical',
      [1, 2]
    );
    expect(firstCommit.committedCount).toBe(2);

    // Re-committing exact duplicates must be strictly idempotent (zero new events)
    const dupCommit = commitCampaignEvents(
      firstCommit.ledger,
      1,
      [draftA, draftB],
      'canonical',
      [1, 2]
    );
    expect(dupCommit.committedCount).toBe(0);
    expect(dupCommit.ledger.events).toHaveLength(2);

    // Out-of-order insertion (Mission 2 first, then Mission 1) must fold to identical achieved flags
    const rev1 = commitCampaignEvents(createEmptyLedger(), 2, [draftB], 'canonical', [2]);
    const rev2 = commitCampaignEvents(rev1.ledger, 1, [draftA], 'canonical', [1, 2]);

    const folded1 = foldCampaignLedger(firstCommit.ledger);
    const folded2 = foldCampaignLedger(rev2.ledger);
    expect(Array.from(folded1.achievedFlags).sort()).toEqual(
      Array.from(folded2.achievedFlags).sort()
    );

    // Sequence numbers must remain strictly monotonic
    for (let i = 1; i < rev2.ledger.events.length; i++) {
      expect(rev2.ledger.events[i].sequence).toBeGreaterThan(rev2.ledger.events[i - 1].sequence);
    }
  });

  // Scenario 9: Interrupted atomic save commit & tampered checksum recovery
  it('Scenario 9: recovers cleanly from interrupted primary write via STAGING_KEY and from tampered checksum via BACKUP_KEY', () => {
    const save1 = ProgressionSaveSchema.parse({});
    save1.requisitionPoints = 777;
    save1.xp = 2400;
    expect(SaveManager.saveProgression(save1)).toBe(true);

    // Save a second snapshot so BACKUP_KEY now holds save1 and SAVE_KEY holds save2
    const save2 = { ...save1, requisitionPoints: 1250, xp: 3600 };
    expect(SaveManager.saveProgression(save2)).toBe(true);

    // Case A: Tamper with SAVE_KEY payload checksum -> must recover from verified BACKUP_KEY
    const rawPrimary = localStorage.getItem(SAVE_KEY);
    expect(rawPrimary).toBeTruthy();
    const tampered = rawPrimary!.replace('1250', '9999');
    localStorage.setItem(SAVE_KEY, tampered);

    const recoveredFromBackup = SaveManager.loadProgression();
    expect(recoveredFromBackup.recoveredFromCorruption).toBe(true);
    expect(recoveredFromBackup.save.requisitionPoints).toBe(777);

    // Case B: Simulate interrupted write where valid envelope sits in STAGING_KEY while SAVE_KEY is truncated garbage
    const save3 = { ...save1, requisitionPoints: 1888, xp: 5100 };
    SaveManager.saveProgression(save3);
    const validEnvelope = localStorage.getItem(SAVE_KEY)!;
    localStorage.setItem(STAGING_KEY, validEnvelope);
    localStorage.setItem(SAVE_KEY, '{"broken_json":');

    const recoveredFromStaging = SaveManager.loadProgression();
    expect(recoveredFromStaging.recoveredFromCorruption).toBe(true);
    expect(recoveredFromStaging.save.requisitionPoints).toBe(1888);
    expect(localStorage.getItem(BACKUP_KEY)).toBeTruthy();
  });

  // Scenario 10: Retroactive replay isolation (Clean Replay vs. Campaign Replay Rebase) + lossless v1/v2 rev3 -> rev4 migration
  it('Scenario 10: isolates Clean Replay from canonical ledger, previews Campaign Replay downstream rebase, and migrates v1/v2 rev3 saves losslessly', () => {
    let ledger = createEmptyLedger();
    // Canonical Ops 1 -> 2 -> 3 (Op 1 completed WITHOUT destroying comms array)
    ledger = commitCampaignEvents(
      ledger,
      1,
      [
        {
          missionId: 1,
          eventId: 'op1_comms_destroyed',
          outcome: 'bypassed',
          summary: 'Bypassed comms array in Op 1.',
        },
      ],
      'canonical',
      [1]
    ).ledger;
    ledger = commitCampaignEvents(
      ledger,
      2,
      [
        {
          missionId: 2,
          eventId: 'op2_convoy_neutralized',
          outcome: 'achieved',
          summary: 'Neutralized Op 2 convoy.',
        },
      ],
      'canonical',
      [1, 2]
    ).ledger;

    const beforeOp2Consequences = resolveMissionConsequences(2, ledger, 'canonical');
    expect(beforeOp2Consequences.enemyCommsDelayMult).toBe(1);

    // Retroactive Campaign Replay of Op 1 where player NOW destroys the comms array
    const replayDrafts: CampaignEventDraft[] = [
      {
        missionId: 1,
        eventId: 'op1_comms_destroyed',
        outcome: 'achieved',
        summary: 'Destroyed comms array in Campaign Replay.',
      },
    ];

    // Clean Replay must not mutate ledger
    const cleanCommit = commitCampaignEvents(ledger, 1, replayDrafts, 'clean_replay', [1, 2, 3]);
    expect(cleanCommit.committedCount).toBe(0);
    expect(resolveMissionConsequences(2, cleanCommit.ledger, 'canonical').enemyCommsDelayMult).toBe(1);

    // Campaign Replay rebase preview reports downstream impact without mutating ledger
    const diff = previewCampaignRebaseDiff(ledger, 1, replayDrafts, [1, 2, 3]);
    expect(diff.hasCanonicalDifference).toBe(true);
    expect(diff.affectedDownstreamMissions).toContain(2);
    expect(resolveMissionConsequences(2, ledger, 'canonical').enemyCommsDelayMult).toBe(1);

    // Explicit Campaign Replay commit updates canonical ledger and downstream Mission 2 comms delay
    const rebased = commitCampaignEvents(ledger, 1, replayDrafts, 'campaign_replay', [1, 2, 3]).ledger;
    const afterRebaseOp2 = resolveMissionConsequences(2, rebased, 'canonical');
    expect(afterRebaseOp2.enemyCommsDelayMult).toBeGreaterThan(1.2);

    // Lossless schema revision upgrade: v2 rev2 -> v2 rev4 and v2 rev3 -> v2 rev4
    const legacyV2Rev2 = {
      version: 2,
      schemaRevision: 2,
      xp: 1200,
      requisitionPoints: 500,
      missionRecords: {
        '1': { missionId: 1, completed: true, bestScore: 4200 },
        '2': { missionId: 2, completed: true, bestScore: 5100 },
      },
      weaponUpgrades: { assault_rifle: { damage: 2, recoil: 1, capacity: 1, reload: 0 } },
    };
    const migratedRev2 = migrateProgressionSave(legacyV2Rev2);
    expect(migratedRev2.recoveredFromCorruption).toBe(false);
    expect(migratedRev2.save.version).toBe(2);
    expect(migratedRev2.save.schemaRevision).toBe(4);
    expect(migratedRev2.save.xp).toBe(1200);
    expect(migratedRev2.save.requisitionPoints).toBe(500);
    expect(migratedRev2.save.missionRecords['1']?.completed).toBe(true);
    expect(migratedRev2.save.squadRoster).toHaveLength(5);
    expect(migratedRev2.save.campaignLedger.events.length).toBeGreaterThanOrEqual(2);

    const legacyV2Rev3 = {
      ...ProgressionSaveSchema.parse({}),
      schemaRevision: 3,
      xp: 3300,
      requisitionPoints: 910,
      missionRecords: {
        '1': {
          missionId: 1,
          completed: true,
          bestScore: 6000,
          bestGrade: 'S',
          bestDifficulty: 'hard',
          fastestTimeSec: 210,
          killsBest: 35,
          completionsCount: 2,
          optionalObjectivesBest: 1,
        },
      },
    };
    const migratedV2 = migrateProgressionSave(legacyV2Rev3);
    expect(migratedV2.save.version).toBe(2);
    expect(migratedV2.save.schemaRevision).toBe(4);
    expect(migratedV2.save.xp).toBe(3300);
    expect(migratedV2.save.missionRecords['1']?.bestGrade).toBe('S');
  });

  // Scenario 11: Exhaustive 9-weapon attachment combination & Pareto dominance audit
  it('Scenario 11: validates every attachment combination across all 9 weapons with zero constraint violations and zero strictly dominant builds', () => {
    const audit = auditAllWeaponAttachmentCombinations();
    expect(audit.totalConfigurationsChecked).toBeGreaterThan(200);
    expect(audit.failures).toEqual([]);

    // Suppressor trade-off check: measurably lowers acoustic detection radius while imposing ballistic damage trade-off
    const arBase = WEAPON_BY_ID.assault_rifle;
    const factory = resolveWeaponConfig(
      arBase,
      { damage: 0, recoil: 0, capacity: 0, reload: 0 },
      DEFAULT_EQUIPPED_ATTACHMENTS
    );
    const suppressed = resolveWeaponConfig(
      arBase,
      { damage: 0, recoil: 0, capacity: 0, reload: 0 },
      { ...DEFAULT_EQUIPPED_ATTACHMENTS, muzzle: 'muzzle_tactical_suppressor' }
    );
    expect(suppressed.isSuppressed).toBe(true);
    expect(suppressed.soundRadiusMeters).toBeLessThan(factory.soundRadiusMeters * 0.65);
    expect(suppressed.rangeMeters).toBeLessThan(factory.rangeMeters);
    expect(suppressed.muzzleVelocity).toBeLessThan(factory.muzzleVelocity);
    expect(suppressed.equipTimeSec).toBeGreaterThan(factory.equipTimeSec);
  });
});
