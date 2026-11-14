import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ResourceManager } from '@/src/core/ResourceManager';
import { InputManager } from '@/src/engine/InputManager';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { MobileTouchControls } from '@/src/ui/hud/MobileTouchControls';

function makePointerEventInit(pointerId: number, clientX: number, clientY: number) {
  return {
    pointerId,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  };
}

describe('Mobile Multitouch Controls & InputManager Virtual Axes', () => {
  afterEach(() => {
    cleanup();
    settingsStore.getState().resetDefaults();
  });

  it('isolates concurrent pointerIds for left move stick, right aim drag, and Fire button without look drag triggering Fire', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);
    const hud = { ...gameSessionStore.getState().hud, inVehicle: false };

    render(<MobileTouchControls inputManager={input} hud={hud} />);

    const stick = screen.getByTestId('touch-move-stick');
    stick.getBoundingClientRect = () =>
      ({ left: 20, top: 220, width: 116, height: 116, right: 136, bottom: 336, x: 20, y: 220, toJSON: () => {} }) as DOMRect;

    const lookZone = screen.getByTestId('touch-look-zone');
    const fireBtn = screen.getByTestId('touch-btn-fire');

    // Pointer 1 pushes left stick upward -> forward movement + autoSprint
    fireEvent.pointerDown(stick, makePointerEventInit(1, 78, 224));
    const axes = input.getMoveAxes();
    expect(axes.forward).toBeGreaterThan(0.8);
    expect(input.isActionHeld('sprint')).toBe(true);

    // Pointer 2 swipes look zone -> look deltas accumulate, fire MUST remain false
    fireEvent.pointerDown(lookZone, makePointerEventInit(2, 500, 180));
    fireEvent.pointerMove(lookZone, makePointerEventInit(2, 560, 165));
    expect(input.isActionHeld('fire')).toBe(false);
    expect(input.wasActionPressed('fire')).toBe(false);

    const lookDelta = input.consumeLookDelta(false);
    expect(lookDelta.yawDelta).toBeGreaterThan(0);
    expect(lookDelta.pitchDelta).toBeLessThan(0);

    // Pointer 3 presses Fire while stick & look are still active
    fireEvent.pointerDown(fireBtn, makePointerEventInit(3, 760, 310));
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.isActionHeld('ads')).toBe(false);

    // Cancel pointer 2 (look) does NOT release stick or fire
    fireEvent.pointerCancel(lookZone, makePointerEventInit(2, 560, 165));
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.8);
    expect(input.isActionHeld('fire')).toBe(true);

    // lostpointercapture on Fire releases fire cleanly while stick continues
    fireEvent(fireBtn, new MouseEvent('lostpointercapture', { bubbles: true }) as unknown as Event);
    fireEvent.pointerUp(fireBtn, makePointerEventInit(3, 760, 310));
    expect(input.isActionHeld('fire')).toBe(false);
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.8);

    // PointerUp on stick returns axes to zero
    fireEvent.pointerUp(stick, makePointerEventInit(1, 78, 224));
    expect(input.getMoveAxes().forward).toBe(0);
    expect(input.getMoveAxes().right).toBe(0);

    rm.disposeAll();
  });

  it('supports ads_on_fire mode, vehicle controls, and releases all virtual inputs on unmount or clearAllInputs', () => {
    const rm = new ResourceManager();
    settingsStore.getState().updateInput({ touchFireBehavior: 'ads_on_fire' });
    const input = new InputManager(rm, settingsStore.getState().input);

    const { rerender, unmount } = render(
      <MobileTouchControls inputManager={input} hud={{ ...gameSessionStore.getState().hud, inVehicle: false }} />
    );

    const fireBtn = screen.getByTestId('touch-btn-fire');
    fireEvent.pointerDown(fireBtn, makePointerEventInit(10, 750, 300));
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.isActionHeld('ads')).toBe(true);

    // Unmounting overlay (e.g. pause / portrait gate) immediately clears held virtual controls
    unmount();
    expect(input.isActionHeld('fire')).toBe(false);
    expect(input.isActionHeld('ads')).toBe(false);

    // Re-render in vehicle mode and verify CAM / EXIT / GUN buttons
    render(
      <MobileTouchControls inputManager={input} hud={{ ...gameSessionStore.getState().hud, inVehicle: true }} />
    );
    expect(screen.getByText('GUN')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('touch-btn-veh-cam'), makePointerEventInit(11, 700, 220));
    fireEvent.pointerDown(screen.getByTestId('touch-btn-veh-exit'), makePointerEventInit(12, 760, 220));
    expect(input.wasActionPressed('vehicleCamera')).toBe(true);
    expect(input.wasActionPressed('interact')).toBe(true);

    input.setVirtualMoveAxes(1, 0.5);
    input.setVirtualActionState('jump', true);
    input.clearAllInputs();
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });
    expect(input.isActionHeld('jump')).toBe(false);
    expect(input.wasActionPressed('interact')).toBe(false);

    rm.disposeAll();
  });
});
