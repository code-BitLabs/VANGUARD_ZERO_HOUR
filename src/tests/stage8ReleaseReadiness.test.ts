import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { createDefaultCoreRoster } from '@/src/data/squadRoster';
import { getOperatorVoiceProfile } from '@/src/data/squadDialogue';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import { EncounterDirector } from '@/src/gameplay/EncounterDirector';
import {
  auditCampaignMandatorySolvability,
  CAMPAIGN_MISSION_PROFILES,
  resolveConsequenceWaveMutation,
} from '@/src/gameplay/campaign/CampaignBalanceProfile';
import {
  commitCampaignEvents,
  resolveMissionConsequences,
} from '@/src/gameplay/campaign/CampaignEventLedger';
import { HardwareReadinessHarness } from '@/src/gameplay/diagnostics/HardwareReadinessHarness';
import {
  diagnosePlaytestFriction,
  PlaytestExperienceTracker,
} from '@/src/gameplay/diagnostics/PlaytestTelemetrySummary';
import {
  evaluateOperatorCommendations,
  SquadDialogueDirector,
} from '@/src/gameplay/narrative/SquadDialogueDirector';
import { FriendlySquadVisualPalette } from '@/src/gameplay/squad/FriendlyOperatorRigBuilder';
import { FriendlySquadManager } from '@/src/gameplay/squad/FriendlySquadManager';
import {
  assignFormationSlotIndicesByRole,
  computeCrossfireClearanceOffset,
  selectDynamicFormation,
} from '@/src/gameplay/squad/SquadFormationSolver';
import { SquadIntentValidationContext } from '@/src/gameplay/squad/SquadIntentRouter';
import {
  evaluateOperatorDirective,
  PlannerOperatorSnapshot,
  SharedFriendlyThreatBoard,
} from '@/src/gameplay/squad/SquadTacticalPlanner';
import {
  DEFAULT_EQUIPPED_ATTACHMENTS,
  resolveWeaponConfig,
} from '@/src/gameplay/weapons/AttachmentCompositionEngine';
import {
  auditCampaignEconomyAndWeapons,
  compareWeaponBuilds,
} from '@/src/gameplay/weapons/WeaponBalanceTelemetry';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { CampaignLedger, MissionLoadoutConfig } from '@/src/schemas/campaign.schema';
import { migrateProgressionSave } from '@/src/schemas/save.schema';

function addBox(
  world: CollisionWorld,
  id: string,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number
): void {
  world.addStaticBox({
    id,
    minX: cx - w * 0.5,
    maxX: cx + w * 0.5,
    minY: cy - h * 0.5,
    maxY: cy + h * 0.5,
    minZ: cz - d * 0.5,
    maxZ: cz + d * 0.5,
    layer: 1,
  });
}

function createIntentCtx(
  playerPos: THREE.Vector3,
  enemyPos?: { id: string; x: number; y: number; z: number }
): SquadIntentValidationContext {
  return {
    playerPos: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
    isEnemyAlive: (id) => Boolean(enemyPos && enemyPos.id === id),
    getEnemyPos: (id) =>
      enemyPos && enemyPos.id === id
        ? { x: enemyPos.x, y: enemyPos.y, z: enemyPos.z }
        : null,
    isVehicleBoardable: () => false,
    getVehiclePos: () => null,
  };
}

describe('Stage 8 — Operational Immersion, Squad Experience, Campaign Balance & RC Verification (TRN-43..TRN-49)', () => {
  // ─── TRN-43: Squad Experience & Field Command Evolution ──────────────────

  it('TRN-43: preempts recoveryHoldSec on new player orders with <60ms command latency while keeping navSolvesThisTick <= 2', () => {
    const world = new CollisionWorld();
    addBox(world, 'ground', 0, -0.5, 0, 120, 1, 120);

    const squad = new FriendlySquadManager();
    const roster = createDefaultCoreRoster();
    squad.initializeForMission({
      scene: null,
      resourceManager: null,
      scope: null,
      roster,
      preferredSquadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
      spawnOrigin: { x: 0, y: 0, z: 0 },
      difficulty: 'normal',
    });

    // Simulate all 3 operators stalled in recovery hold before player issues a fresh command
    for (const op of squad.getOperators()) {
      op.recoveryHoldSec = 2.4;
      op.stuckTimerSec = 1.9;
    }

    const playerPos = new THREE.Vector3(0, 0, 0);
    const playerFwd = new THREE.Vector3(0, 0, -1);
    const ctx = createIntentCtx(playerPos);

    const result = squad.issueCommand(
      {
        order: 'MOVE',
        source: 'desktop_quick_key',
        targetPos: { x: 0, y: 0, z: -18 },
        issuedAtSec: 0,
      },
      ctx
    );
    expect(result.accepted).toBe(true);

    // Preemption clears recoveryHoldSec immediately
    for (const op of squad.getOperators()) {
      expect(op.recoveryHoldSec).toBe(0);
      expect(op.pendingImmediateCommandAck).toBe(true);
      expect(op.ackPulseTimerSec).toBeGreaterThan(0);
    }

    // Advance a single 30 Hz frame (~33.3ms) and verify all 3 operators adopt directive immediately
    const out = squad.update({
      dt: 1 / 30,
      playerPos,
      playerForward: playerFwd,
      playerAlive: true,
      collision: world,
      enemies: [],
      vehicles: [],
      intentValidationCtx: ctx,
    });

    expect(out.navSolvesThisTick).toBeLessThanOrEqual(2);
    expect(out.telemetryEvents.commandLatencySamplesMs).toHaveLength(3);
    for (const latencyMs of out.telemetryEvents.commandLatencySamplesMs) {
      expect(latencyMs).toBeLessThan(60);
    }
    for (const op of squad.getOperators()) {
      expect(op.pendingImmediateCommandAck).toBe(false);
      expect(op.lastDirective?.reasonTag).toBe('Advancing to Waypoint');
    }
  });

  it('TRN-43: assigns role-based formation slots, triggers OVERWATCH for distant threats, and clears player crossfire lane', () => {
    const slots = assignFormationSlotIndicesByRole(['medic', 'assault', 'support']);
    // Assault leads (slot 0), Support mid (slot 1), Medic rear protected (slot 2)
    expect(slots[1]).toBe(0);
    expect(slots[2]).toBe(1);
    expect(slots[0]).toBe(2);

    const overwatch = selectDynamicFormation({
      corridorWidthMeters: 6.5,
      onVerticalPortalOrBridge: false,
      nearCargoLiftOrCluster: false,
      isFiringLineIntent: false,
      threatExposure: 0.35,
      hasDistantOrElevatedThreats: true,
    });
    expect(overwatch).toBe('OVERWATCH');

    const offset = { x: 0, z: 0 };
    const pushed = computeCrossfireClearanceOffset({
      playerX: 0,
      playerZ: 0,
      playerForwardX: 0,
      playerForwardZ: -1,
      operatorX: 0.25,
      operatorZ: -4.5,
      outOffset: offset,
    });
    expect(pushed).toBe(true);
    expect(Math.abs(offset.x)).toBeGreaterThan(0.9);
  });

  it('TRN-43: Medic avoids redundant double-revive when player is already reviving the downed ally, and covers triage or pivots to a second downed ally', () => {
    const threatBoard = new SharedFriendlyThreatBoard();
    threatBoard.reportThreat({
      enemyId: 'hostile_1',
      x: 15,
      y: 0,
      z: -25,
      isArmoredOrVehicle: false,
      isElevated: false,
      spottedByOperatorId: 'specter_4',
    });

    const medic: PlannerOperatorSnapshot = {
      id: 'lifeline_6',
      role: 'medic',
      x: -2,
      y: 0,
      z: 2,
      healthRatio: 1,
      suppressionLevel: 0.1,
      morale: 'STEADY',
      state: 'EXECUTE_FORMATION',
      reviveChargesRemaining: 2,
      inVehicleId: null,
      stuckTimerSec: 0,
      isDowned: false,
      isMia: false,
      bleedoutRemainingSec: 18,
    };

    const downedOne: PlannerOperatorSnapshot = {
      ...medic,
      id: 'vanguard_2',
      role: 'assault',
      x: 1,
      z: -1,
      healthRatio: 0,
      state: 'DOWNED',
      isDowned: true,
      bleedoutRemainingSec: 11,
    };

    const downedTwo: PlannerOperatorSnapshot = {
      ...medic,
      id: 'bulwark_3',
      role: 'support',
      x: 5,
      z: -3,
      healthRatio: 0,
      state: 'DOWNED',
      isDowned: true,
      bleedoutRemainingSec: 14,
    };

    // Case A: Only Vanguard-2 is downed AND player is already reviving Vanguard-2 -> Medic provides cover
    const coverDirective = evaluateOperatorDirective({
      operator: medic,
      allOperators: [medic, downedOne],
      intent: null,
      formationSlot: { x: -2, y: 0, z: 2, formation: 'WEDGE' },
      playerPos: { x: 0, y: 0, z: 0 },
      threatBoard,
      slotIndex: 2,
      playerRevivingOperatorId: 'vanguard_2',
    });
    expect(coverDirective.reasonTag).toBe('Covering Commander Triage');
    expect(coverDirective.rescueAllyId).toBeNull();
    expect(coverDirective.suppressFire).toBe(true);

    // Case B: Both Vanguard-2 and Bulwark-3 are downed while player revives Vanguard-2 -> Medic pivots to Bulwark-3
    const pivotDirective = evaluateOperatorDirective({
      operator: medic,
      allOperators: [medic, downedOne, downedTwo],
      intent: null,
      formationSlot: { x: -2, y: 0, z: 2, formation: 'WEDGE' },
      playerPos: { x: 0, y: 0, z: 0 },
      threatBoard,
      slotIndex: 2,
      playerRevivingOperatorId: 'vanguard_2',
    });
    expect(pivotDirective.microState).toBe('RESCUE_ALLY');
    expect(pivotDirective.rescueAllyId).toBe('bulwark_3');
  });

  it('TRN-43 / TRN-47: composite role-distinct operator rigs dispose cleanly across 10 mission lifecycles with zero leaks', () => {
    const rm = new ResourceManager();
    rm.recordBaseline();
    const roster = createDefaultCoreRoster();

    for (let cycle = 0; cycle < 10; cycle++) {
      const scope = `mission:stage8_cycle_${cycle}` as const;
      const palette = new FriendlySquadVisualPalette(rm, scope);
      const scene = new THREE.Scene();

      for (const op of roster) {
        const rig = palette.buildOperatorRig(op.role, op.customization);
        expect(rig.head).toBeDefined();
        expect(rig.rifle).toBeDefined();
        scene.add(rig.root);
      }

      rm.unloadScope(scope);
      scene.clear();
    }

    const leakAudit = rm.auditTransitionDelta();
    expect(leakAudit.hasMissionLeak).toBe(false);
    expect(leakAudit.missionRemaining).toBe(0);
  });

  // ─── TRN-44: Campaign Experience, Consequences & Anti-Softlock ───────────

  it('TRN-44: enforces smooth 5-mission pacing curve and visibly mutates downstream EncounterDirector waves from campaign consequences', () => {
    for (let id = 1; id <= 5; id++) {
      const profile = CAMPAIGN_MISSION_PROFILES[id];
      expect(profile).toBeDefined();
      expect(profile.stageBreatherSec).toBeGreaterThanOrEqual(5.0);
      if (id > 1) {
        expect(profile.difficultyIndex).toBeGreaterThan(
          CAMPAIGN_MISSION_PROFILES[id - 1].difficultyIndex
        );
      }
    }

    let ledger: CampaignLedger = {
      nextSequence: 1,
      events: [],
      timelineRevision: 1,
      shiftedDownstreamMissions: [],
    };
    ledger = commitCampaignEvents(
      ledger,
      1,
      [{ missionId: 1, eventId: 'op1_comms_destroyed', outcome: 'achieved', summary: 'AA comms destroyed' }],
      'canonical',
      [1]
    ).ledger;
    ledger = commitCampaignEvents(
      ledger,
      3,
      [{ missionId: 3, eventId: 'op3_radar_network_disabled', outcome: 'achieved', summary: 'Radar disabled' }],
      'canonical',
      [1, 3]
    ).ledger;
    ledger = commitCampaignEvents(
      ledger,
      4,
      [{ missionId: 4, eventId: 'op4_comms_jammer_planted', outcome: 'achieved', summary: 'Viper jammer planted' }],
      'canonical',
      [1, 3, 4]
    ).ledger;

    const op4Canonical = resolveMissionConsequences(4, ledger, 'canonical');
    const op4Clean = resolveMissionConsequences(4, ledger, 'clean_replay');

    const mutated = resolveConsequenceWaveMutation({
      missionId: 4,
      stageIndex: 2,
      baseArchetype: 'drone_operator',
      consequences: op4Canonical,
    });
    expect(mutated.archetypeOverride).toBe('infantry');
    expect(mutated.countDelta).toBe(-1);
    expect(mutated.calloutPrefix).toBe('[RADAR BLINDED]');

    const cleanMutated = resolveConsequenceWaveMutation({
      missionId: 4,
      stageIndex: 2,
      baseArchetype: 'drone_operator',
      consequences: op4Clean,
    });
    expect(cleanMutated.archetypeOverride).toBeUndefined();
    expect(cleanMutated.countDelta).toBe(0);

    // Verify EncounterDirector surfaces the consequence callout prefix on live reinforcement spawn
    const director = new EncounterDirector();
    const op5Canonical = resolveMissionConsequences(5, ledger, 'canonical');
    director.reset(5, op5Canonical);
    let spawnedCallout = '';
    for (let t = 0; t < 45; t++) {
      const tick = director.update({
        dt: 1.0,
        elapsedSec: 10 + t,
        missionId: 5,
        activeStageIndex: 3,
        totalStages: 3,
        extractionAvailable: true,
        aliveEnemies: 2,
        anyEnemyHasLos: true,
        hasActiveBoss: false,
        playerPos: new THREE.Vector3(0, 0, -20),
        playerAlive: true,
        playerInVehicle: false,
      });
      if (tick.reinforcementSpec) {
        spawnedCallout = tick.reinforcementSpec.radioCallout;
        break;
      }
    }
    expect(spawnedCallout).toContain('[VIPER JAMMER ACTIVE]');
  });

  it('TRN-44: guarantees mandatory objective anti-softlock solvability across all 5 missions even with worst-case non-launcher loadout', () => {
    const worstCaseLoadout: MissionLoadoutConfig = {
      primaryWeapon: 'smg',
      secondaryWeapon: 'pistol',
      heavyWeapon: 'shotgun',
      tacticalEquipment: 'frag_pack',
      squadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
      initialFormation: 'WEDGE',
    };

    const audit = auditCampaignMandatorySolvability(worstCaseLoadout);
    expect(audit.allSolvable).toBe(true);
    expect(audit.findings.length).toBeGreaterThanOrEqual(10);
    for (const f of audit.findings) {
      expect(f.solvable).toBe(true);
      expect(f.guaranteedPaths.length).toBeGreaterThan(0);
    }
  });

  // ─── TRN-45: Weapon Balance Telemetry & Progression Economy ──────────────

  it('TRN-45: validates all 9 weapons for distinct specialization viability, REQ economy non-grind, and suppressor telemetry delta', () => {
    const audit = auditCampaignEconomyAndWeapons();
    expect(audit.weaponTelemetry).toHaveLength(9);
    expect(audit.anomalies).toEqual([]);
    expect(audit.allWeaponsDistinctAndViable).toBe(true);
    expect(audit.economyBalancedWithoutGrind).toBe(true);

    const baseRifle = resolveWeaponConfig(
      WEAPON_BY_ID.assault_rifle,
      { damage: 0, recoil: 0, capacity: 0, reload: 0 },
      DEFAULT_EQUIPPED_ATTACHMENTS
    );
    const suppressedRifle = resolveWeaponConfig(
      WEAPON_BY_ID.assault_rifle,
      { damage: 0, recoil: 0, capacity: 0, reload: 0 },
      { ...DEFAULT_EQUIPPED_ATTACHMENTS, muzzle: 'muzzle_tactical_suppressor' }
    );
    const cmp = compareWeaponBuilds(baseRifle, suppressedRifle);
    expect(cmp.deltas.soundRadiusDeltaM).toBeLessThan(0);
    expect(cmp.configured.stealthRating).toBeGreaterThan(cmp.baseline.stealthRating);
  });

  // ─── TRN-46 & TRN-47: Operator Dialogue, Commendations & Radio Audio ─────

  it('TRN-46: enforces dialogue priority preemption, anti-spam cooldowns, consequence callouts, and debrief commendations', () => {
    const dir = new SquadDialogueDirector();

    const firstOrder = dir.trigger({
      event: 'order_ack',
      nowSec: 10.0,
      operatorId: 'vanguard_2',
      role: 'assault',
      order: 'FLANK',
    });
    expect(firstOrder).not.toBeNull();
    expect(firstOrder?.priority).toBe('TACTICAL');

    // Immediate second TACTICAL order within cooldown must be suppressed (anti-spam)
    const spamOrder = dir.trigger({
      event: 'order_ack',
      nowSec: 10.5,
      operatorId: 'vanguard_2',
      role: 'assault',
      order: 'FLANK',
    });
    expect(spamOrder).toBeNull();

    // CRITICAL operator_downed immediately preempts active TACTICAL line
    const urgent = dir.trigger({
      event: 'operator_downed',
      nowSec: 10.6,
      operatorId: 'bulwark_3',
      role: 'support',
    });
    expect(urgent).not.toBeNull();
    expect(urgent?.priority).toBe('CRITICAL');

    // Consequence acknowledgement matches authored campaign flag line
    const conseq = dir.trigger({
      event: 'campaign_consequence_ack',
      nowSec: 25.0,
      operatorId: 'specter_4',
      role: 'recon',
      consequenceEventId: 'op3_radar_network_disabled',
    });
    expect(conseq).not.toBeNull();
    expect(conseq?.text.toLowerCase()).toContain('radar');

    const awards = evaluateOperatorCommendations({
      operatorId: 'lifeline_6',
      callsign: 'LIFELINE-6',
      role: 'medic',
      deployed: true,
      survived: true,
      kills: 5,
      revivesPerformed: 2,
      vehiclesDisabled: 1,
      spotsMarked: 5,
      suppressionAssists: 6,
      timesDowned: 0,
      becameMia: false,
      severeInjury: false,
    });
    const awardIds = awards.map((a) => a.id);
    expect(awardIds).toContain('guardian_angel');
    expect(awardIds).toContain('armor_breaker');
    expect(awardIds).toContain('iron_wall');
    expect(awardIds).toContain('eagle_eye');
    expect(awardIds).toContain('pointman_distinction');
  });

  it('TRN-47: procedural operator radio voice routes through dialogue bus and preserves manual music selection without throwing in headless mode', () => {
    const audio = new AudioManager(new ResourceManager(), {});
    const voice = getOperatorVoiceProfile('vanguard_2', 'assault');
    const beforeCount = audio.getRadioVoiceCueCount();

    audio.playOperatorRadioVoice(
      {
        basePitchHz: voice.baseFreqHz,
        formantPitchHz: voice.secondFreqHz,
        cadenceMs: voice.cadenceMs,
        radioClickHz: voice.squelchToneHz,
      },
      'CRITICAL'
    );
    expect(audio.getRadioVoiceCueCount()).toBe(beforeCount + 1);
    expect(() => audio.suspend()).not.toThrow();
    expect(() => audio.resume()).not.toThrow();
  });

  // ─── TRN-48 & TRN-49: Playtest Telemetry, Friction Diagnostics & RC Matrix ─

  it('TRN-48 / TRN-49: tracks Stage 8 playtest telemetry, diagnoses friction read-only, and keeps RC physical device matrix strictly separated from headless checks', () => {
    const tracker = new PlaytestExperienceTracker();
    tracker.recordSquadCommand('FLANK', 33);
    tracker.recordSquadCommand('SUPPRESS', 145); // spikes above 120ms threshold
    tracker.recordSquadDowned(2);
    tracker.recordSquadMia(2);
    tracker.recordOperatorRescue(true);
    tracker.recordOperatorRescue(false);
    tracker.recordFormationTime('OVERWATCH', 0.2);
    tracker.recordEncounterStageTime(1, 0.2);
    tracker.observeActiveWeaponAmmo(0, 0);
    tracker.observeActiveWeaponAmmo(30, 60);
    tracker.observeActiveWeaponAmmo(0, 0);
    tracker.observeActiveWeaponAmmo(30, 60);
    tracker.observeActiveWeaponAmmo(0, 0);

    const report = tracker.buildReport({
      missionId: 3,
      difficulty: 'normal',
      activeModifiers: [],
      outcome: 'victory',
      grade: 'A',
      durationSec: 210,
      timeFirstDetectionSec: 12,
      timeFirstDamageSec: 15,
      timeFirstKillSec: 18,
      kills: 24,
      headshots: 9,
      playerAccuracyPct: 48,
      deathsCount: 1,
      resupplyStationsUsed: 0,
      healthPickupsCollected: 2,
      optionalObjectivesCompleted: 1,
      objectiveCompletedAtSec: { m3_obj1: 80, m3_obj2: 195 },
      killsByWeapon: { assault_rifle: 20, sniper_rifle: 4 },
      damageByDomain: { ground: 1400, air: 420, vehicle: 0 },
    });

    expect(report.schemaVersion).toBe('stage8_local_playtest_v2');
    expect(report.squadCommandsIssued).toBe(2);
    expect(report.operatorRescuesByMedic).toBe(1);
    expect(report.operatorRescuesByPlayer).toBe(1);
    expect(report.maxCommandLatencyMs).toBe(145);

    const findings = diagnosePlaytestFriction(report);
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('SQUAD_COMMAND_LATENCY_HIGH');
    expect(codes).toContain('SQUAD_CASUALTY_SPIKE');
    expect(codes).toContain('AMMO_STATION_DISCOVERABILITY');

    // HardwareReadinessHarness RC platform matrix defaults honestly to NOT_RUN_HEADLESS
    const harness = new HardwareReadinessHarness();
    harness.setLatestPlaytestReport(report, findings);
    const headlessSnap = harness.buildSnapshot('headless_automated_check');
    expect(headlessSnap.schemaVersion).toBe(2);
    expect(headlessSnap.containsPii).toBe(false);
    expect(headlessSnap.platformChecklist).toHaveLength(5);
    for (const p of headlessSnap.platformChecklist) {
      expect(p.status).toBe('NOT_RUN_HEADLESS');
    }

    // PII sanitization on platform note and markdown report export
    harness.setPlatformChecklistStatus(
      'desktop_dgpu',
      'PASS_ON_HARDWARE',
      'Verified by tester@example.com on RTX GPU',
      14.2
    );
    const md = harness.exportMarkdownReport('headless_automated_check');
    expect(md).not.toContain('tester@example.com');
    expect(md).toContain('[REDACTED]');
    expect(md).toContain('Latest Local Playtest Friction Diagnostics');
    expect(md).toContain('Peak squad command latency reached 145ms');
  });

  it('TRN-49: preserves save schema migration integrity and graceful corruption recovery', () => {
    const corruptRes = migrateProgressionSave('{not_valid_json');
    expect(corruptRes.recoveredFromCorruption).toBe(true);
    expect(corruptRes.save.version).toBe(2);
    expect(corruptRes.save.schemaRevision).toBe(4);
    expect(corruptRes.save.squadRoster.length).toBeGreaterThanOrEqual(5);

    const v2Rev2Res = migrateProgressionSave({
      version: 2,
      schemaRevision: 2,
      xp: 900,
      requisitionPoints: 400,
      missionRecords: {
        '1': { missionId: 1, completed: true, bestGrade: 'A', bestScore: 3200, fastestTimeSec: 180 },
      },
    });
    expect(v2Rev2Res.recoveredFromCorruption).toBe(false);
    expect(v2Rev2Res.save.version).toBe(2);
    expect(v2Rev2Res.save.schemaRevision).toBe(4);
    expect(v2Rev2Res.save.xp).toBe(900);
    expect(v2Rev2Res.save.missionRecords['1']?.completed).toBe(true);
  });
});
