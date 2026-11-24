import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { uiStore } from '@/src/stores/uiStore';
import { MobileHudEditorModal } from '@/src/ui/components/MobileHudEditorModal';
import { SettingsPanel } from '@/src/ui/components/SettingsPanel';
import { HudTopRightCluster } from '@/src/ui/hud/HudSlices';
import { MobileSquadCommandStrip } from '@/src/ui/hud/MobileSquadCommandStrip';
import { CampaignScreen } from '@/src/ui/screens/CampaignScreen';
import { StepReviewDeploy } from '@/src/ui/screens/campaign/StepReviewDeploy';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function setMockViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
}

describe('Mobile Experience Quality Milestone Regression Suite', () => {
  beforeEach(() => {
    cleanup();
    missionSelectionStore.getState().setSelectedMission(1);
    missionSelectionStore.getState().setDifficulty('normal');
    uiStore.getState().setScreen('title');
    uiStore.getState().setTacticalOverviewOpen(false);
    uiStore.getState().setTacticalKitOpen(false);
    setMockViewport(1280, 720);
  });

  it('CampaignScreen header icon buttons expose accessible aria-labels on narrow mobile screens', () => {
    setMockViewport(375, 667);
    render(<CampaignScreen onDeploy={vi.fn()} onUiClick={vi.fn()} />);

    expect(screen.getByTestId('header-open-briefing').getAttribute('aria-label')).toBe(
      'Briefing Dossier'
    );
    expect(screen.getByTestId('header-open-armory').getAttribute('aria-label')).toBe(
      'Full Armory'
    );
  });

  it('StepReviewDeploy displays non-blocking portrait landscape note in portrait and omits it in landscape', async () => {
    setMockViewport(375, 667);
    const { rerender } = render(
      <StepReviewDeploy
        missionId={1}
        deploymentMode="fireteam"
        onJumpToStep={vi.fn()}
        onOpenSecondaryDrawer={vi.fn()}
        onDeploy={vi.fn()}
        onUiClick={vi.fn()}
      />
    );
    expect(screen.getByTestId('review-portrait-landscape-note')).toBeTruthy();

    act(() => {
      setMockViewport(844, 390);
    });
    rerender(
      <StepReviewDeploy
        missionId={1}
        deploymentMode="fireteam"
        onJumpToStep={vi.fn()}
        onOpenSecondaryDrawer={vi.fn()}
        onDeploy={vi.fn()}
        onUiClick={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.queryByTestId('review-portrait-landscape-note')).toBeNull();
    });
  });

  function activateRadixTab(tab: HTMLElement) {
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.focus(tab);
    fireEvent.click(tab);
  }

  it('SettingsPanel prioritizes Mobile & Touch Control Layout above desktop Mouse settings on mobile viewports', () => {
    setMockViewport(375, 667);
    render(<SettingsPanel onBack={vi.fn()} />);

    activateRadixTab(screen.getByRole('tab', { name: /Controls & Keys/i }));
    const mobileSection = screen.getByTestId('controls-mobile-touch-section');
    const desktopSection = screen.getByTestId('controls-desktop-mouse-section');
    expect(mobileSection.className).toContain('order-1');
    expect(desktopSection.className).toContain('order-2');
  });

  it('SettingsPanel keeps desktop Mouse controls first on wide desktop viewports', () => {
    setMockViewport(1440, 900);
    render(<SettingsPanel onBack={vi.fn()} />);

    activateRadixTab(screen.getByRole('tab', { name: /Controls & Keys/i }));
    const mobileSection = screen.getByTestId('controls-mobile-touch-section');
    const desktopSection = screen.getByTestId('controls-desktop-mouse-section');
    expect(desktopSection.className).toContain('order-1');
    expect(mobileSection.className).toContain('order-2');
  });

  it('MobileHudEditorModal renders a safe landscape-required prompt with Close button when opened in portrait', () => {
    setMockViewport(375, 667);
    const onClose = vi.fn();
    render(<MobileHudEditorModal onClose={onClose} />);

    expect(screen.getByText(/Landscape Editor Required/i)).toBeTruthy();
    const closeBtn = screen.getByTestId('close-fullscreen-hud-editor');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Compact mobile HUD top-right buttons enforce >=44px touch targets and close Kit drawer when opening Tactical Overview', () => {
    uiStore.getState().setTacticalKitOpen(true);
    render(
      <HudTopRightCluster
        compactHud={true}
        devModeActive={false}
        combatDebugOpen={false}
        combatDebugCollapsed={false}
        tacticalOverviewOpen={false}
        touchControlsVisible={true}
        showFpsCounter={false}
        showPerformanceTelemetry={false}
        showKillFeed={false}
        qualityTelemetry={null}
        onPause={vi.fn()}
      />
    );

    const overviewBtn = screen.getByTestId('hud-tactical-overview-btn');
    const pauseBtn = screen.getByTestId('hud-pause-btn');
    expect(overviewBtn.className).toContain('min-w-[44px]');
    expect(overviewBtn.className).toContain('min-h-[44px]');
    expect(pauseBtn.className).toContain('min-w-[44px]');
    expect(pauseBtn.className).toContain('min-h-[44px]');

    fireEvent.click(overviewBtn);
    expect(uiStore.getState().tacticalKitOpen).toBe(false);
    expect(uiStore.getState().tacticalOverviewOpen).toBe(true);
  });

  it('MobileSquadCommandStrip slide menu anchors downward from top-0 to prevent top-edge clipping', () => {
    const hud = gameSessionStore.getState().hud;
    const hudWithSquad = {
      ...hud,
      squad: {
        activeOrderLabel: 'FOLLOW',
        activeFormation: 'WEDGE' as const,
        squadMedCharges: 2,
        downedCount: 0,
        nearestDownedOperatorId: null,
        nearestDownedDistanceM: 0,
        playerRevivingOperatorId: null,
        playerReviveProgress: 0,
        operators: [
          {
            id: 'op_1',
            callsign: 'REAPER-1',
            role: 'assault' as const,
            roleBadge: 'ASL',
            health: 100,
            maxHealth: 100,
            armor: 50,
            maxArmor: 50,
            state: 'COMBAT',
            morale: 'STEADY' as const,
            suppressionLevel: 0,
            reasonTag: 'ENGAGING',
            bleedoutRemainingSec: 0,
            reviveProgress: 0,
            reviveChargesRemaining: 1,
            inVehicleId: null,
            isReserve: false,
            distanceToPlayerM: 8,
          },
        ],
      },
    };
    render(
      <MobileSquadCommandStrip
        hud={hudWithSquad}
        stripRect={{
          left: 610,
          top: 69,
          right: 656,
          bottom: 115,
          width: 46,
          height: 46,
          buttonSizePx: 46,
          overlapsAnyControl: false,
          stickyViewportRatio: 0.12,
        }}
        onIssueCommand={vi.fn()}
      />
    );

    fireEvent.pointerDown(screen.getByTestId('mobile-squad-ping-btn'), {
      pointerId: 1,
      clientX: 630,
      clientY: 90,
    });
    const slideMenu = screen.getByTestId('mobile-squad-slide-menu');
    expect(slideMenu.className).toContain('top-0');
    expect(slideMenu.className).not.toContain('-translate-y-1/2');
  });
});
