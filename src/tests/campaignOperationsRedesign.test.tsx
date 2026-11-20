import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder } from '@/src/gameplay/CombatTelemetryRecorder';
import { EncounterDirector } from '@/src/gameplay/EncounterDirector';
import { SoloEncounterDirector } from '@/src/gameplay/SoloEncounterDirector';
import {
  HQ_RECOVERY_SEC_PER_TIER,
  advanceRosterAfterOperation,
  computeOperatorRecoverySummary,
} from '@/src/gameplay/campaign/CampaignEventLedger';
import {
  resolveSquadPresetIds,
  validateDeploymentConfig,
} from '@/src/gameplay/campaign/DeploymentConfigValidator';
import { FriendlySquadManager } from '@/src/gameplay/squad/FriendlySquadManager';
import { createDefaultCoreRoster } from '@/src/data/squadRoster';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { progressionStore } from '@/src/stores/progressionStore';
import { GameHUD } from '@/src/ui/hud/GameHUD';
import { CampaignScreen } from '@/src/ui/screens/CampaignScreen';

describe('Campaign Operations Redesign — Mode Persistence, Solo Director, HQ Recovery & Workbench', () => {
  beforeEach(() => {
    window.localStorage.clear();
    progressionStore.getState().resetAllProgress();
    missionSelectionStore.setState({
      selectedMissionId: 1,
      difficulty: 'normal',
      replayMode: 'canonical',
      deploymentMode: 'fireteam',
      missionDeploymentModes: {},
      hasConfirmedDeploymentMode: false,
      hasSeenCampaignBriefing: false,
      seenMissionBriefings: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('persists deployment mode default and independent per-mission overrides across reloads without mutating loadout or roster', () => {
    progressionStore.getState().updateMissionLoadout({
      primaryWeapon: 'sniper_rifle',
      squadIds: ['vanguard_2', 'specter_4', 'lifeline_6'],
      initialFormation: 'COLUMN',
    });

    // Op 1 set to Solo, Op 2 set to Fireteam
    missionSelectionStore.getState().setDeploymentMode('solo', 1);
    missionSelectionStore.getState().setDeploymentMode('fireteam', 2);
    missionSelectionStore.getState().confirmDeploymentMode('solo', 1);

    expect(missionSelectionStore.getState().getDeploymentModeForMission(1)).toBe('solo');
    expect(missionSelectionStore.getState().getDeploymentModeForMission(2)).toBe('fireteam');

    // Simulate page reload from localStorage
    missionSelectionStore.setState({
      deploymentMode: 'fireteam',
      missionDeploymentModes: {},
      hasConfirmedDeploymentMode: false,
    });
    missionSelectionStore.getState().reloadPersistedPrefs();

    expect(missionSelectionStore.getState().hasConfirmedDeploymentMode).toBe(true);
    expect(missionSelectionStore.getState().getDeploymentModeForMission(1)).toBe('solo');
    expect(missionSelectionStore.getState().getDeploymentModeForMission(2)).toBe('fireteam');

    // Commander loadout and Fireteam roster are completely preserved across mode switches
    const loadout = progressionStore.getState().save.activeMissionLoadout;
    expect(loadout.primaryWeapon).toBe('sniper_rifle');
    expect(loadout.squadIds).toEqual(['vanguard_2', 'specter_4', 'lifeline_6']);
    expect(loadout.initialFormation).toBe('COLUMN');
  });

  it('enforces Dedicated Adaptive Solo Encounter Director without enemy HP/damage nerfs, caps multi-squad focus, staggers waves, and limits self-recovery', () => {
    const soloDirector = new SoloEncounterDirector();
    soloDirector.reset(true, 1, 'normal');

    // Must provide finite cover caches for all 5 missions
    for (let m = 1; m <= 5; m++) {
      soloDirector.reset(true, m, 'normal');
      const caches = soloDirector.getSoloBonusSupplyStations(m);
      expect(caches.length).toBeGreaterThanOrEqual(2);
      for (const c of caches) {
        expect(c.maxCharges).toBeGreaterThan(0);
        expect(c.maxCharges).toBeLessThanOrEqual(3);
      }
    }

    // Dynamic pressure under heavy damage enters RELIEF_WINDOW and caps attackers & focusing squads (never nerfs enemy HP/damage)
    soloDirector.reset(true, 1, 'normal');
    const tick = soloDirector.update({
      dt: 0.1,
      elapsedSec: 12,
      playerHealthRatio: 0.25,
      playerArmorRatio: 0.0,
      reserveAmmoRatio: 0.2,
      rolling2sDamage: 45,
      aliveEnemies: 8,
      activeAttackers: 2,
    });
    expect(soloDirector.getPressureState()).toBe('RELIEF_WINDOW');
    expect(tick.constraints).not.toBeNull();
    expect(tick.constraints!.maxSimultaneousFocusSquads).toBe(1);
    expect(tick.constraints!.maxGlobalAttackers).toBe(1);
    expect(soloDirector.getStageBreatherBonusSec()).toBeGreaterThanOrEqual(4.0);

    // CombatEngagementCoordinator enforces maxSimultaneousFocusSquads = 1
    const telemetry = new CombatTelemetryRecorder();
    const coordinator = new CombatEngagementCoordinator(telemetry);
    coordinator.setSoloConstraints({
      maxGlobalAttackers: 2,
      maxClimaxGlobalAttackers: 2,
      maxSquadAttackers: 2,
      maxSquadSuppressors: 1,
      maxSimultaneousFocusSquads: 1,
    });
    const sq1First = coordinator.requestLease({
      unitId: 'e1',
      squadId: 'squad_alpha',
      domain: 'ground',
      role: 'rifleman',
      kind: 'DIRECT',
      distanceMeters: 15,
      hasLos: true,
      isWeaponReady: true,
    });
    const sq2Blocked = coordinator.requestLease({
      unitId: 'e2',
      squadId: 'squad_bravo',
      domain: 'ground',
      role: 'rifleman',
      kind: 'DIRECT',
      distanceMeters: 15,
      hasLos: true,
      isWeaponReady: true,
    });
    expect(sq1First).toBe(true);
    expect(sq2Blocked).toBe(false);

    // EncounterDirector in Solo applies staggered waves and longer tactical breathers
    const encounterSolo = new EncounterDirector();
    encounterSolo.reset(1, null, 'solo');
    expect(encounterSolo.getPhase()).toBe('OPENING_PUSH');
    const waveAdj = soloDirector.adjustReinforcementWave(3, 'infantry');
    expect(waveAdj.count).toBeLessThan(3);
    expect(waveAdj.calloutPrefix).toContain('TELEGRAPH');

    // Emergency trauma self-recovery is strictly 1 finite charge per Solo operation
    expect(soloDirector.canUseTraumaSelfRecovery()).toBe(true);
    const firstUse = soloDirector.useTraumaSelfRecovery();
    expect(firstUse.ok).toBe(true);
    expect(firstUse.restoredHealth).toBeGreaterThan(0);
    expect(soloDirector.canUseTraumaSelfRecovery()).toBe(false);
    const secondUse = soloDirector.useTraumaSelfRecovery();
    expect(secondUse.ok).toBe(false);
  });

  it('advances Safe Mission-Time HQ Recovery during canonical Solo ops with zero injury risk, clean_replay isolation, and operationRunId anti-exploit deduplication', () => {
    const roster = createDefaultCoreRoster();
    roster[0] = {
      ...roster[0],
      status: 'recovering',
      injurySeverity: 'severe',
      recoveryOpsRemaining: 2,
      recoveryElapsedSec: 0,
      recoveryTargetSec: HQ_RECOVERY_SEC_PER_TIER * 2,
    };

    // 1. Clean Replay NEVER advances recovery
    const cleanRes = advanceRosterAfterOperation(roster, {
      replayMode: 'clean_replay',
      victory: true,
      difficulty: 'normal',
      ironmanActive: false,
      deploymentMode: 'solo',
      missionElapsedSec: 400,
      operatorReports: [],
    });
    expect(cleanRes[0].status).toBe('recovering');
    expect(cleanRes[0].recoveryOpsRemaining).toBe(2);

    // 2. Canonical Solo victory advances recovery safely with zero injury risk
    const firstSolo = advanceRosterAfterOperation(roster, {
      replayMode: 'canonical',
      victory: true,
      difficulty: 'normal',
      ironmanActive: false,
      deploymentMode: 'solo',
      missionElapsedSec: 210,
      operatorReports: [],
    });
    expect(firstSolo[0].status).toBe('recovering');
    expect(firstSolo[0].recoveryOpsRemaining).toBe(1);
    expect(computeOperatorRecoverySummary(firstSolo[0]).progressPct).toBeGreaterThanOrEqual(50);
    // All other operators remain completely uninjured
    expect(firstSolo.slice(1).every((op) => op.status === 'active')).toBe(true);

    // 3. Second canonical Solo op finishes recovery and returns operator to active
    const secondSolo = advanceRosterAfterOperation(firstSolo, {
      replayMode: 'canonical',
      victory: true,
      difficulty: 'normal',
      ironmanActive: false,
      deploymentMode: 'solo',
      missionElapsedSec: 190,
      operatorReports: [],
    });
    expect(secondSolo[0].status).toBe('active');
    expect(secondSolo[0].recoveryOpsRemaining).toBe(0);

    // 4. ProgressionStore deduplicates identical operationRunId (prevents retry/reload exploit)
    progressionStore.setState((s) => ({
      ...s,
      save: {
        ...s.save,
        squadRoster: roster,
        creditedOperationRunIds: [],
      },
    }));
    const run1 = progressionStore.getState().recordMissionResult({
      missionId: 1,
      difficulty: 'normal',
      victory: true,
      score: 1200,
      grade: 'A',
      xpEarned: 150,
      requisitionEarned: 120,
      kills: 20,
      headshots: 4,
      airKills: 0,
      durationSec: 220,
      replayMode: 'canonical',
      deploymentMode: 'solo',
      operationRunId: 'op_run_dedupe_test_01',
    });
    expect(run1.hqRecoveryProgressedCount).toBe(1);
    expect(progressionStore.getState().save.squadRoster[0].recoveryOpsRemaining).toBe(1);

    // Re-submitting same operationRunId must NOT double-credit HQ recovery
    const runDuplicate = progressionStore.getState().recordMissionResult({
      missionId: 1,
      difficulty: 'normal',
      victory: true,
      score: 1200,
      grade: 'A',
      xpEarned: 150,
      requisitionEarned: 120,
      kills: 20,
      headshots: 4,
      airKills: 0,
      durationSec: 220,
      replayMode: 'canonical',
      deploymentMode: 'solo',
      operationRunId: 'op_run_dedupe_test_01',
    });
    expect(runDuplicate.hqRecoveryProgressedCount).toBe(0);
    expect(progressionStore.getState().save.squadRoster[0].recoveryOpsRemaining).toBe(1);
  });

  it('validates Fireteam squad presets, reserve backfill, and applies persisted initialFormation in FriendlySquadManager', () => {
    const roster = createDefaultCoreRoster();
    roster[0] = { ...roster[0], status: 'recovering', recoveryOpsRemaining: 1 };

    const preset = resolveSquadPresetIds('assault_spearhead', roster);
    expect(preset.missingRoles).toContain('assault');
    expect(preset.squadIds).not.toContain('vanguard_2');

    const validation = validateDeploymentConfig({
      missionId: 1,
      deploymentMode: 'fireteam',
      difficulty: 'normal',
      replayMode: 'canonical',
      hasConfirmedDeploymentMode: true,
      loadout: {
        primaryWeapon: 'assault_rifle',
        secondaryWeapon: 'pistol',
        heavyWeapon: 'rocket_launcher',
        tacticalEquipment: 'frag_pack',
        squadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
        initialFormation: 'LINE',
      },
      roster,
    });
    expect(validation.canDeploy).toBe(true);
    expect(
      validation.issues.some((w) => w.code === 'INELIGIBLE_OPERATORS_SUBSTITUTED')
    ).toBe(true);

    // FriendlySquadManager honors initialFormation on initializeForMission
    const scene = new THREE.Scene();
    const mgr = new FriendlySquadManager();
    mgr.initializeForMission({
      scene,
      resourceManager: null,
      scope: null,
      roster,
      preferredSquadIds: ['bulwark_3', 'specter_4', 'lifeline_6'],
      spawnOrigin: { x: 0, y: 0, z: 0 },
      difficulty: 'normal',
      initialFormation: 'LINE',
    });
    expect(mgr.getActiveFormation()).toBe('LINE');
    expect(mgr.getOperators().length).toBe(3);
    mgr.dispose(scene);
  });

  it('renders progressive 4-step CampaignScreen, hides Fireteam controls in Solo, enforces zero multiplayer copy, and supports Slide-Over Attachment Workbench with unsaved-draft guard and named builds', () => {
    // Give REQ so workbench can unlock/equip attachments cleanly
    progressionStore.setState((s) => ({
      ...s,
      save: {
        ...s.save,
        requisitionPoints: 1200,
      },
    }));

    const onDeploy = vi.fn();
    const onUiClick = vi.fn();
    render(<CampaignScreen onDeploy={onDeploy} onUiClick={onUiClick} />);

    // Step 1: Mission Select active with aria-current="step"
    expect(screen.getByTestId('campaign-step-tab-1').getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('campaign-step-mission')).toBeTruthy();

    // Advance to Step 2: Play Style
    fireEvent.click(screen.getByTestId('campaign-step1-continue'));
    const playStyleEl = screen.getByTestId('campaign-step-playstyle');
    expect(playStyleEl).toBeTruthy();
    // Explicit single-player clarity — never imply multiplayer/co-op/matchmaking
    expect(playStyleEl.textContent).not.toMatch(/multiplayer|matchmaking|online co-op|lobby/i);
    expect(playStyleEl.textContent).toMatch(/Single-Player/i);

    // Select Solo Operator and advance to Step 3
    fireEvent.click(screen.getByTestId('playstyle-card-solo'));
    expect(screen.getByTestId('playstyle-card-solo').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('campaign-step2-continue'));

    // Step 3 in Solo Mode: ZERO Fireteam roster controls, Solo Preparation visible
    expect(screen.getByTestId('solo-preparation-section')).toBeTruthy();
    expect(screen.queryByTestId('fireteam-roster-section')).toBeNull();

    // Open Controls drawer in Solo Mode: Squad Command controls hidden, Solo self-recovery shown
    fireEvent.click(screen.getByTestId('open-drawer-controls'));
    expect(screen.getByTestId('campaign-secondary-drawer')).toBeTruthy();
    expect(screen.queryByTestId('controls-fireteam-section')).toBeNull();
    expect(screen.getByTestId('controls-solo-section')).toBeTruthy();
    fireEvent.click(screen.getByTestId('secondary-drawer-close'));

    // Open Slide-Over Attachment Workbench from Primary slot
    fireEvent.click(screen.getByTestId('edit-build-primary'));
    const workbench = screen.getByTestId('attachment-workbench-drawer');
    expect(workbench).toBeTruthy();

    // Stage an attachment modification (unlock or equip first available attachment)
    const buttons = within(workbench).getAllByRole('button');
    const unlockBtn = buttons.find((b) => b.getAttribute('data-testid')?.startsWith('workbench-unlock-'));
    if (unlockBtn) {
      fireEvent.click(unlockBtn);
    } else {
      const equipBtn = buttons.find((b) => b.getAttribute('data-testid')?.startsWith('workbench-equip-'));
      expect(equipBtn).toBeTruthy();
      fireEvent.click(equipBtn!);
    }

    // Attempt to close with unsaved draft -> discard confirmation guard appears
    fireEvent.click(screen.getByTestId('workbench-close-btn'));
    expect(screen.getByTestId('workbench-discard-confirm')).toBeTruthy();

    // Keep editing, save a named build, then apply build
    fireEvent.click(screen.getByRole('button', { name: /Keep Editing/i }));
    fireEvent.click(screen.getByTestId('workbench-toggle-save-build'));
    const nameInput = screen.getByTestId('workbench-build-name-input');
    fireEvent.change(nameInput, { target: { value: 'Urban Recon M4' } });
    fireEvent.click(screen.getByTestId('workbench-confirm-save-build'));
    expect(
      progressionStore.getState().save.savedWeaponBuilds.some((b) => b.name === 'Urban Recon M4')
    ).toBe(true);

    fireEvent.click(screen.getByTestId('workbench-apply-build-btn'));
    expect(screen.getByTestId('workbench-status-msg').textContent).toMatch(/applied/i);
    // Closing after applying closes cleanly without showing unsaved discard guard
    fireEvent.click(screen.getByTestId('workbench-close-btn'));
    expect(screen.queryByTestId('workbench-discard-confirm')).toBeNull();
    expect(screen.queryByTestId('attachment-workbench-drawer')).toBeNull();

    // Switch back to Step 2 -> Fireteam -> Step 3 -> verify Fireteam Roster & Formations visible
    fireEvent.click(screen.getByTestId('campaign-step-tab-2'));
    fireEvent.click(screen.getByTestId('playstyle-card-fireteam'));
    fireEvent.click(screen.getByTestId('campaign-step2-continue'));
    expect(screen.getByTestId('fireteam-roster-section')).toBeTruthy();
    expect(screen.queryByTestId('solo-preparation-section')).toBeNull();

    // Select LINE starting formation
    fireEvent.click(screen.getByTestId('formation-option-LINE'));
    expect(progressionStore.getState().save.activeMissionLoadout.initialFormation).toBe('LINE');

    // Open Controls drawer in Fireteam Mode: Squad Command controls visible
    fireEvent.click(screen.getByTestId('open-drawer-controls'));
    expect(screen.getByTestId('controls-fireteam-section')).toBeTruthy();
    fireEvent.click(screen.getByTestId('secondary-drawer-close'));

    // Advance to Step 4 Review & Deploy and launch
    fireEvent.click(screen.getByTestId('campaign-step3-continue'));
    expect(screen.getByTestId('review-deployment-mode').textContent).toMatch(/Fireteam/i);
    fireEvent.click(screen.getByTestId('deploy-operation-btn'));
    expect(onDeploy).toHaveBeenCalledWith(1, 'normal', 'fireteam');
  });

  it('hides Fireteam HUD & squad commands in Solo mode while displaying Trauma Self-Revive status', () => {
    gameSessionStore.getState().updateHudSnapshot({
      ...gameSessionStore.getState().hud,
      deploymentMode: 'solo',
      soloTraumaKit: {
        chargesRemaining: 1,
        maxCharges: 1,
        cooldownRemainingSec: 0,
      },
      squad: undefined,
    });

    const onTriggerSoloSelfRecovery = vi.fn();
    render(
      <GameHUD
        onRequestPointerLock={() => {}}
        onIssueSquadCommand={vi.fn()}
        onTriggerSoloSelfRecovery={onTriggerSoloSelfRecovery}
      />
    );

    expect(screen.getByTestId('hud-solo-trauma-status')).toBeTruthy();
    expect(screen.queryByTestId('hud-fireteam-strip')).toBeNull();
  });
});
