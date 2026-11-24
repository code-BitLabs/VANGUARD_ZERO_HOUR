/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ResourceManager } from '@/src/core/ResourceManager';
import { InputManager } from '@/src/engine/InputManager';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { GameHUD } from '@/src/ui/hud/GameHUD';
import { computeMobileHudLayout } from '@/src/ui/hud/mobileHudLayoutEngine';
import { MobileTouchControls } from '@/src/ui/hud/MobileTouchControls';
import { DownedActionOverlay, TacticalOverviewDrawer } from '@/src/ui/hud/TacticalOverlays';
import { getMissionVisualProfile } from '@/src/world/VisualBible';

function makePointerEventInit(pointerId: number, clientX: number, clientY: number) {
  return {
    pointerId,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  };
}

describe('Mobile Landscape Combat Ergonomics & Overlay Containment', () => {
  beforeAll(() => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  afterEach(() => {
    cleanup();
    settingsStore.getState().resetDefaults();
  });

  it('stops pointerdown propagation on TacticalOverviewDrawer and DownedActionOverlay to protect the background look zone', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);
    const lookSpy = vi.spyOn(input, 'addVirtualLookDelta');

    const hud = gameSessionStore.getState().hud;
    const profile = getMissionVisualProfile(1);

    // Test TacticalOverviewDrawer containment
    const onDrawerClose = vi.fn();
    const { unmount } = render(
      <div
        data-testid="look-zone-parent"
        onPointerDown={() => input.addVirtualLookDelta(10, 10)}
      >
        <TacticalOverviewDrawer
          hud={hud}
          missionVisualProfile={profile}
          tacticalOverviewOpen={true}
          completedObjectivesCount={1}
          formatObjectiveDistance={() => 120}
          onClose={onDrawerClose}
        />
      </div>
    );

    const drawer = screen.getByTestId('hud-tactical-overview-drawer');
    expect(drawer).toBeTruthy();

    // Dispatch pointerdown on the drawer
    fireEvent.pointerDown(drawer, makePointerEventInit(1, 400, 200));

    // Must NOT have propagated to parent look-zone
    expect(lookSpy).not.toHaveBeenCalled();

    unmount();

    // Test DownedActionOverlay containment
    const { unmount: unmountDowned } = render(
      <div
        data-testid="look-zone-parent"
        onPointerDown={() => input.addVirtualLookDelta(10, 10)}
      >
        <DownedActionOverlay
          downedState={{
            active: true,
            remainingSec: 15,
            fatalSource: null,
            lastHits: [],
            canUseSoloTraumaRevive: true,
            canRestartCheckpoint: true,
          }}
        />
      </div>
    );

    const downedOverlay = screen.getByTestId('hud-downed-overlay');
    expect(downedOverlay).toBeTruthy();

    fireEvent.pointerDown(downedOverlay, makePointerEventInit(1, 400, 200));
    expect(lookSpy).not.toHaveBeenCalled();

    unmountDowned();
  });

  it('enforces safe-area clearance for bottom weapon bar and controls against Android gesture bar', () => {
    const inputSettings = settingsStore.getState().input;
    const viewport = {
      width: 850,
      height: 340,
      safeBottom: 18,
      safeLeft: 14,
      safeRight: 14,
      safeTop: 10,
    };

    const layout = computeMobileHudLayout(inputSettings, viewport, {
      grenadeCount: 1,
      c4DeployedCount: 0,
    });

    expect(layout.overlappingPairs).toEqual([]);

    // Weapon bar bottom must stay above viewport - safeBottom
    const weaponBar = layout.controls.weapon_bar;
    expect(weaponBar.bottom).toBeLessThanOrEqual(viewport.height - viewport.safeBottom);

    // Crouch button bottom must also stay above safe bounds
    const crouch = layout.controls.crouch;
    expect(crouch.bottom).toBeLessThanOrEqual(viewport.height - viewport.safeBottom);
  });

  it('provides safe backdrop dismissal for Tactical Kit pop-out drawer without firing actions', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);
    const fireSpy = vi.spyOn(input, 'setVirtualActionState');

    const hud = { ...gameSessionStore.getState().hud, inVehicle: false };
    render(<MobileTouchControls inputManager={input} hud={hud} />);

    // Open tactical drawer by clicking tactical kit button
    const tacticalBtn = screen.getByTestId('touch-btn-tactical-drawer');
    fireEvent.pointerDown(tacticalBtn, makePointerEventInit(1, 400, 300));

    // Verify drawer and backdrop are rendered
    const drawer = screen.getByTestId('touch-tactical-drawer');
    const backdrop = screen.getByTestId('touch-tactical-drawer-backdrop');
    expect(drawer).toBeTruthy();
    expect(backdrop).toBeTruthy();

    // Click backdrop to dismiss
    fireEvent.pointerDown(backdrop, makePointerEventInit(2, 100, 100));

    // Drawer should now be closed
    expect(screen.queryByTestId('touch-tactical-drawer')).toBeNull();

    // Ensure no weapon fire was triggered
    expect(fireSpy).not.toHaveBeenCalledWith('fire', true);
  });

  it('maintains zero collision and valid hitboxes across ultra-short landscape viewports (850x320 and 800x300)', () => {
    const shortViewports = [
      { width: 850, height: 320 },
      { width: 800, height: 300 },
      { width: 750, height: 320 },
    ];

    for (const vp of shortViewports) {
      const layout = computeMobileHudLayout(settingsStore.getState().input, vp);
      expect(layout.overlappingPairs).toEqual([]);

      for (const ctrl of Object.values(layout.controls)) {
        if (!ctrl.visible) continue;
        expect(ctrl.width).toBeGreaterThanOrEqual(44);
        expect(ctrl.height).toBeGreaterThanOrEqual(44);
        expect(ctrl.left).toBeGreaterThanOrEqual(0);
        expect(ctrl.top).toBeGreaterThanOrEqual(0);
        expect(ctrl.right).toBeLessThanOrEqual(vp.width + 0.5);
        expect(ctrl.bottom).toBeLessThanOrEqual(vp.height + 0.5);
      }
    }
  });
});
