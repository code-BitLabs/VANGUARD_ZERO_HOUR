import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MISSION_CATALOG } from '@/src/data/missions';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { progressionStore } from '@/src/stores/progressionStore';
import { StepMissionSelect } from '@/src/ui/screens/campaign/StepMissionSelect';
import { StepPlayStyle } from '@/src/ui/screens/campaign/StepPlayStyle';
import { StepConfigureOperation } from '@/src/ui/screens/campaign/StepConfigureOperation';
import { StepReviewDeploy } from '@/src/ui/screens/campaign/StepReviewDeploy';
import { LoadingOverlay } from '@/src/ui/screens/Overlays';
import { CampaignScreen } from '@/src/ui/screens/CampaignScreen';

describe('Batch 1: Mobile Landscape Campaign Deployment Journey — StepMissionSelect', () => {
  beforeEach(() => {
    window.localStorage.clear();
    progressionStore.getState().resetAllProgress();
    missionSelectionStore.setState({
      selectedMissionId: 1,
      difficulty: 'normal',
      replayMode: 'canonical',
      deploymentMode: 'solo',
      missionDeploymentModes: {},
      hasConfirmedDeploymentMode: false,
      hasSeenCampaignBriefing: false,
      seenMissionBriefings: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all 5 missions with accessible testids and selection states in StepMissionSelect', () => {
    const onSelectMission = vi.fn();
    const onPrepareDeployment = vi.fn();
    const onOpenFullBriefing = vi.fn();
    const onUiClick = vi.fn();

    render(
      <StepMissionSelect
        selectedMissionId={1}
        onSelectMission={onSelectMission}
        onPrepareDeployment={onPrepareDeployment}
        onOpenFullBriefing={onOpenFullBriefing}
        onUiClick={onUiClick}
      />
    );

    // Verify container and overview panel exist
    expect(screen.getByTestId('campaign-step-mission')).toBeTruthy();
    expect(screen.getByTestId('mission-overview-panel')).toBeTruthy();

    // Verify all 5 mission buttons render
    for (const m of MISSION_CATALOG) {
      const btn = screen.getByTestId(`mission-list-item-${m.id}`);
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-pressed')).toBe(m.id === 1 ? 'true' : 'false');
    }

    // Verify clicking mission 3 calls onSelectMission(3) and onUiClick
    fireEvent.click(screen.getByTestId('mission-list-item-3'));
    expect(onSelectMission).toHaveBeenCalledWith(3);
    expect(onUiClick).toHaveBeenCalled();

    // Verify full briefing button works
    fireEvent.click(screen.getByTestId('step1-full-briefing-btn'));
    expect(onOpenFullBriefing).toHaveBeenCalled();
  });

  it('renders within CampaignScreen and allows advancing to Step 2 via Prepare Deployment', () => {
    const onDeploy = vi.fn();
    const onUiClick = vi.fn();

    render(<CampaignScreen onDeploy={onDeploy} onUiClick={onUiClick} />);

    // Starts on Step 1: Mission Select
    expect(screen.getByTestId('campaign-step-mission')).toBeTruthy();
    expect(screen.getByTestId('campaign-step1-continue')).toBeTruthy();

    // Select Mission 2
    fireEvent.click(screen.getByTestId('mission-list-item-2'));

    // Advance to Step 2
    fireEvent.click(screen.getByTestId('campaign-step1-continue'));
    expect(screen.getByTestId('campaign-step-playstyle')).toBeTruthy();
  });

  it('displays clearance rank and threat telemetry accurately for completed missions', () => {
    // Record a completed mission with rank A
    progressionStore.getState().recordMissionResult({
      missionId: 1,
      difficulty: 'normal',
      victory: true,
      score: 1540,
      grade: 'A',
      xpEarned: 200,
      requisitionEarned: 150,
      kills: 24,
      headshots: 6,
      airKills: 2,
      durationSec: 180,
      replayMode: 'canonical',
      deploymentMode: 'solo',
      operationRunId: 'test_run_op1',
    });

    render(
      <StepMissionSelect
        selectedMissionId={1}
        onSelectMission={vi.fn()}
        onPrepareDeployment={vi.fn()}
        onOpenFullBriefing={vi.fn()}
        onUiClick={vi.fn()}
      />
    );

    const btn1 = screen.getByTestId('mission-list-item-1');
    expect(btn1.textContent).toMatch(/RANK A|A/i);
    expect(screen.getByTestId('mission-overview-panel').textContent).toMatch(/Best:.*Rank A/i);
  });

  it('renders StepPlayStyle with Solo and Fireteam cards and supports toggling mode', () => {
    const onSelectMode = vi.fn();
    const onUiClick = vi.fn();

    render(
      <StepPlayStyle
        missionId={1}
        selectedMode="fireteam"
        hasConfirmedMode={false}
        onSelectMode={onSelectMode}
        onUiClick={onUiClick}
      />
    );

    const soloCard = screen.getByTestId('playstyle-card-solo');
    const fireteamCard = screen.getByTestId('playstyle-card-fireteam');
    expect(soloCard).toBeTruthy();
    expect(fireteamCard).toBeTruthy();

    expect(soloCard.getAttribute('aria-pressed')).toBe('false');
    expect(fireteamCard.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(soloCard);
    expect(onSelectMode).toHaveBeenCalledWith('solo');
    expect(onUiClick).toHaveBeenCalled();
  });

  it('renders StepConfigureOperation with specialists, weapons, and equipment', () => {
    const onOpenWorkbench = vi.fn();
    const onOpenSecondaryDrawer = vi.fn();
    const onUiClick = vi.fn();

    render(
      <StepConfigureOperation
        missionId={1}
        deploymentMode="fireteam"
        onOpenWorkbench={onOpenWorkbench}
        onOpenSecondaryDrawer={onOpenSecondaryDrawer}
        onUiClick={onUiClick}
      />
    );

    expect(screen.getByTestId('campaign-step-configure')).toBeTruthy();
    expect(screen.getByTestId('fireteam-roster-section')).toBeTruthy();
    expect(screen.getByTestId('commander-loadout-section')).toBeTruthy();
    expect(screen.getByTestId('loadout-slot-primary')).toBeTruthy();
    expect(screen.getByTestId('loadout-slot-secondary')).toBeTruthy();
    expect(screen.getByTestId('loadout-slot-heavy')).toBeTruthy();

    // Opening workbench from primary weapon slot edit button
    fireEvent.click(screen.getByTestId('edit-build-primary'));
    expect(onOpenWorkbench).toHaveBeenCalledWith('assault_rifle', 'Primary Weapon');
    expect(onUiClick).toHaveBeenCalled();
  });

  it('renders StepReviewDeploy with 4-card manifest and handles deploy action', () => {
    const onJumpToStep = vi.fn();
    const onOpenSecondaryDrawer = vi.fn();
    const onDeploy = vi.fn();
    const onUiClick = vi.fn();

    render(
      <StepReviewDeploy
        missionId={1}
        deploymentMode="fireteam"
        onJumpToStep={onJumpToStep}
        onOpenSecondaryDrawer={onOpenSecondaryDrawer}
        onDeploy={onDeploy}
        onUiClick={onUiClick}
      />
    );

    expect(screen.getByTestId('campaign-step-review')).toBeTruthy();
    expect(screen.getByTestId('review-deployment-mode')).toBeTruthy();
    expect(screen.getByTestId('deploy-operation-btn')).toBeTruthy();

    // Trigger deployment from StepReviewDeploy CTA button
    fireEvent.click(screen.getByTestId('deploy-operation-btn'));
    expect(onDeploy).toHaveBeenCalled();
    expect(onUiClick).toHaveBeenCalled();
  });

  it('renders LoadingOverlay with staged tactical objectives and cancel button', () => {
    const onCancel = vi.fn();

    render(<LoadingOverlay onCancel={onCancel} />);

    expect(screen.getByText(/Deploying Operation/i)).toBeTruthy();
    expect(screen.getByText(/Staged Tactical Objectives/i)).toBeTruthy();

    const cancelBtn = screen.getByRole('button', { name: /Cancel Deployment/i });
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();
  });

  it('executes complete end-to-end deployment journey through CampaignScreen (Steps 1 to 4)', () => {
    const onDeploy = vi.fn();
    const onUiClick = vi.fn();

    render(<CampaignScreen onDeploy={onDeploy} onUiClick={onUiClick} />);

    // Step 1: Select Operation
    expect(screen.getByTestId('campaign-step-mission')).toBeTruthy();
    fireEvent.click(screen.getByTestId('campaign-step1-continue'));

    // Step 2: Play Style
    expect(screen.getByTestId('campaign-step-playstyle')).toBeTruthy();
    fireEvent.click(screen.getByTestId('playstyle-card-solo'));
    fireEvent.click(screen.getByTestId('campaign-step2-continue'));

    // Step 3: Configure Operation
    expect(screen.getByTestId('campaign-step-configure')).toBeTruthy();
    fireEvent.click(screen.getByTestId('campaign-step3-continue'));

    // Step 4: Review & Deploy
    expect(screen.getByTestId('campaign-step-review')).toBeTruthy();
    const deployFooterBtn = screen.getByTestId('campaign-footer-deploy');
    expect(deployFooterBtn).toBeTruthy();

    fireEvent.click(deployFooterBtn);
    expect(onDeploy).toHaveBeenCalledWith(1, 'normal', 'solo');
  });
});
