import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { progressionStore } from '@/src/stores/progressionStore';
import { uiStore } from '@/src/stores/uiStore';
import { GameHUD } from '@/src/ui/hud/GameHUD';
import { CampaignScreen } from '@/src/ui/screens/CampaignScreen';
import { TitleScreen } from '@/src/ui/screens/TitleScreen';

describe('Tactical UI Screens & HUD', () => {
  afterEach(() => {
    cleanup();
    uiStore.getState().setTouchHudOverride(null);
  });

  it('routes Play Campaign to CampaignScreen first, marks briefing seen on deploy, and shows Quick Deploy for returning players', () => {
    progressionStore.getState().resetAllProgress();
    missionSelectionStore.setState({ selectedMissionId: 1, difficulty: 'normal', hasSeenCampaignBriefing: false });
    uiStore.getState().setScreen('title');

    const onQuickDeploy = vi.fn();
    const onUiClick = vi.fn();

    render(<TitleScreen onQuickDeploy={onQuickDeploy} onUiClick={onUiClick} />);
    expect(screen.getByText(/VANGUARD/i)).toBeTruthy();

    // First-time Play Campaign goes to CampaignScreen instead of deploying immediately
    fireEvent.click(screen.getByRole('button', { name: /Play Campaign/i }));
    expect(onQuickDeploy).not.toHaveBeenCalled();
    expect(uiStore.getState().screen).toBe('campaign');

    // Select Operation button also routes to CampaignScreen
    fireEvent.click(screen.getByRole('button', { name: /Select Operation/i }));
    expect(uiStore.getState().screen).toBe('campaign');

    cleanup();
    const onDeploy = vi.fn();
    render(<CampaignScreen onDeploy={onDeploy} onUiClick={onUiClick} />);
    expect(screen.getAllByText(/Urban Assault/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Convoy Interception/i)).toBeTruthy();
    expect(screen.getByText(/Air Superiority/i)).toBeTruthy();
    expect(screen.getByText(/Jungle Strike/i)).toBeTruthy();
    expect(screen.getByText(/Final Extraction/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Deploy Operation/i }));
    expect(onDeploy).toHaveBeenCalledTimes(1);
    expect(missionSelectionStore.getState().hasSeenCampaignBriefing).toBe(true);

    // Returning player now sees Quick Deploy on TitleScreen
    cleanup();
    render(<TitleScreen onQuickDeploy={onQuickDeploy} onUiClick={onUiClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Quick Deploy/i }));
    expect(onQuickDeploy).toHaveBeenCalledTimes(1);
  });

  it('renders GameHUD live telemetry, Pause button, Touch HUD toggle, and MobileTouchControls when enabled', () => {
    gameSessionStore.getState().updateHudSnapshot({
      ...gameSessionStore.getState().hud,
      health: 84,
      armor: 62,
      weaponId: 'sniper_rifle',
      weaponName: 'AX-50',
      ammoInMag: 4,
      magSize: 5,
      reserveAmmo: 25,
      objectives: [
        { id: 'obj1', title: 'Destroy AA Radar Relays', current: 1, target: 2, completed: false },
      ],
    });

    const onPause = vi.fn();
    render(
      <GameHUD
        onRequestPointerLock={() => {}}
        onPause={onPause}
        touchControlsVisible={true}
      />
    );
    expect(screen.getByText('84')).toBeTruthy();
    expect(screen.getByText(/ARM 62/i)).toBeTruthy();
    expect(screen.getAllByText('AX-50').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Destroy AA Radar Relays')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByTestId('mobile-touch-controls')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Pause Mission/i }));
    expect(onPause).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Toggle Touch Controls/i }));
    expect(uiStore.getState().touchHudOverride).toBe(false);
  });

  it('renders visible [F4] HUD launcher and toggles CombatDebugOverlay between corner bubble and full workbench', async () => {
    const { CombatDebugOverlay } = await import('@/src/ui/debug/CombatDebugOverlay');
    const { settingsStore } = await import('@/src/stores/settingsStore');

    uiStore.getState().setCombatDebugOpen(false);
    uiStore.getState().setCombatDebugCollapsed(false);
    const onLock = vi.fn();

    render(
      <>
        <GameHUD onRequestPointerLock={onLock} />
        <CombatDebugOverlay />
      </>
    );

    // Visible HUD launcher appears when F4 overlay is closed and stops propagation so pointer lock isn't fired
    const launcher = screen.getByRole('button', { name: /Open Combat and Performance Diagnostics/i });
    expect(launcher).toBeTruthy();
    fireEvent.click(launcher);
    expect(onLock).not.toHaveBeenCalled();
    expect(uiStore.getState().combatDebugOpen).toBe(true);
    expect(screen.getByText(/Combat & Engine Diagnostics/i)).toBeTruthy();

    // Collapse to compact corner bubble
    const collapseBtn = screen.getByRole('button', { name: /Collapse Diagnostics to Bubble/i });
    fireEvent.click(collapseBtn);
    expect(uiStore.getState().combatDebugCollapsed).toBe(true);
    expect(settingsStore.getState().developer.combatDebugCollapsed).toBe(true);
    expect(screen.getByRole('region', { name: /Collapsed Combat Diagnostics Bubble/i })).toBeTruthy();
    expect(screen.getByText(/NOMINAL|WARN/i)).toBeTruthy();

    // Expand back from corner bubble
    const expandBtn = screen.getByRole('button', { name: /Expand Diagnostics Console/i });
    fireEvent.click(expandBtn);
    expect(uiStore.getState().combatDebugCollapsed).toBe(false);
    expect(screen.getByText(/Combat & Engine Diagnostics/i)).toBeTruthy();
  });

  it('provides Pause Sim, Aim [TAB], and cursor-free controls when diagnostics are open during active play', async () => {
    const { CombatDebugOverlay } = await import('@/src/ui/debug/CombatDebugOverlay');

    uiStore.getState().setScreen('playing');
    uiStore.getState().setPointerLocked(false);
    uiStore.getState().setCombatDebugOpen(true);
    uiStore.getState().setCombatDebugCollapsed(false);
    uiStore.getState().setDebugSimPaused(false);

    const onLock = vi.fn();
    const onParentClick = vi.fn();

    render(
      <div onClick={onParentClick}>
        <GameHUD onRequestPointerLock={onLock} />
        <CombatDebugOverlay onRequestPointerLock={onLock} />
      </div>
    );

    // Pause Sim / Resume Sim toggles debugSimPaused without bubbling to parent
    const pauseBtn = screen.getByRole('button', { name: /Pause Simulation/i });
    fireEvent.click(pauseBtn);
    expect(uiStore.getState().debugSimPaused).toBe(true);
    expect(onParentClick).not.toHaveBeenCalled();

    const resumeBtn = screen.getByRole('button', { name: /Resume Simulation/i });
    fireEvent.click(resumeBtn);
    expect(uiStore.getState().debugSimPaused).toBe(false);

    // Pause again, then verify closing F4 automatically clears debugSimPaused
    fireEvent.click(screen.getByRole('button', { name: /Pause Simulation/i }));
    expect(uiStore.getState().debugSimPaused).toBe(true);

    // Aim [TAB] in expanded header invokes pointer lock callback cleanly
    const aimBtn = screen.getByRole('button', { name: /Return to FPS Aim/i });
    fireEvent.click(aimBtn);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();

    // Collapsed bubble also exposes Aim [TAB] when unlocked
    fireEvent.click(screen.getByRole('button', { name: /Collapse Diagnostics to Bubble/i }));
    const bubbleAimBtn = screen.getByRole('button', { name: /Lock Aim to Game/i });
    fireEvent.click(bubbleAimBtn);
    expect(onLock).toHaveBeenCalledTimes(2);

    // Closing F4 resets debugSimPaused and reveals GameHUD cursor-free hint
    fireEvent.click(screen.getByRole('button', { name: /Close Diagnostics/i }));
    expect(uiStore.getState().combatDebugOpen).toBe(false);
    expect(uiStore.getState().debugSimPaused).toBe(false);

    const cursorFreeHint = screen.getByRole('button', { name: /Cursor Free/i });
    fireEvent.click(cursorFreeHint);
    expect(onLock).toHaveBeenCalledTimes(3);
  });
});
