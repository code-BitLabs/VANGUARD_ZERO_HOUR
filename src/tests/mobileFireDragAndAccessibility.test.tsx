import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ResourceManager } from '@/src/core/ResourceManager';
import { InputManager } from '@/src/engine/InputManager';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { PerformanceDebugTab } from '@/src/ui/debug/CombatDebugTabs';
import { MobileTouchControls } from '@/src/ui/hud/MobileTouchControls';

function ptr(pointerId: number, clientX: number, clientY: number) {
  return {
    pointerId,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  };
}

describe('Mobile Right-Fire Drag-to-Aim, Multi-Touch Safety & Performance Telemetry UI', () => {
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

  it('supports drag-to-aim while holding right Fire (> 4px), suppresses double-look when lookZone finger is active, and keeps 3-finger left Fire look-free', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);
    const baseHud = { ...gameSessionStore.getState().hud, inVehicle: false };

    const { rerender, unmount } = render(<MobileTouchControls inputManager={input} hud={baseHud} />);
    const fireRight = screen.getByTestId('touch-btn-fire');
    const lookZone = screen.getByTestId('touch-look-zone');

    // 1. Micro-tap (<= 4px) holds fire without drifting aim
    fireEvent.pointerDown(fireRight, ptr(10, 740, 300));
    fireEvent.pointerMove(window, ptr(10, 742, 299));
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.consumeLookDelta(false)).toEqual({ yawDelta: 0, pitchDelta: 0 });

    // 2. Dragging > 4px engages smooth drag-to-aim while firing
    fireEvent.pointerMove(window, ptr(10, 766, 286));
    const fireDragLook = input.consumeLookDelta(false);
    expect(fireDragLook.yawDelta).toBeGreaterThan(0);
    expect(fireDragLook.pitchDelta).toBeLessThan(0);
    expect(input.isActionHeld('fire')).toBe(true);

    // 3. Engaging dedicated lookZone finger prevents double-aiming from fireRight drag
    fireEvent.pointerDown(lookZone, ptr(11, 500, 180));
    fireEvent.pointerMove(window, ptr(10, 790, 270)); // should be ignored while lookZone owns camera
    expect(input.consumeLookDelta(false)).toEqual({ yawDelta: 0, pitchDelta: 0 });

    // Moving dedicated look finger works normally
    fireEvent.pointerMove(window, ptr(11, 520, 180));
    expect(input.consumeLookDelta(false).yawDelta).toBeGreaterThan(0);

    fireEvent.pointerUp(window, ptr(10, 790, 270));
    fireEvent.pointerUp(window, ptr(11, 520, 180));
    expect(input.isActionHeld('fire')).toBe(false);

    // 4. Switch to 3-finger claw mode (fire_left only): dragging fire_left MUST NOT hijack look
    settingsStore.getState().updateInput({ touchControlProfile: 'three_finger' });
    rerender(<MobileTouchControls inputManager={input} hud={baseHud} />);
    const fireLeft = screen.getByTestId('touch-btn-fire');
    expect(fireLeft.getAttribute('data-control-id')).toBe('fire_left');

    fireEvent.pointerDown(fireLeft, ptr(12, 90, 90));
    fireEvent.pointerMove(window, ptr(12, 140, 120));
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.consumeLookDelta(false)).toEqual({ yawDelta: 0, pitchDelta: 0 });

    unmount();
    expect(input.isActionHeld('fire')).toBe(false);
    rm.disposeAll();
  });

  it('renders p50 / p95 / p99 frame percentiles and active AA mode in PerformanceDebugTab', () => {
    render(
      <PerformanceDebugTab
        performance={{
          fps: 120,
          avgFps: 118,
          minFps: 94,
          maxFps: 144,
          fps1PercentLow: 92,
          frameMs: 8.3,
          avgFrameMs: 8.4,
          p50FrameMs: 8.1,
          p95FrameMs: 10.2,
          p99FrameMs: 11.9,
          cpuTimeMs: 4.6,
          phases: {
            ai: 1.1,
            ballistics: 0.4,
            physics: 0.9,
            projectilesFlight: 0.2,
            explosions: 0.1,
            render: 1.5,
            audio: 0.2,
            ui: 0.2,
          },
          drawCalls: 68,
          triangles: 42500,
          spikeCount: 0,
          lastSpikeMs: 0,
          lastSpikeAgeSec: 999,
          lastSpikeSubsystem: 'none',
          governorTier: 'high',
          renderScale: 1,
          renderWidth: 1920,
          renderHeight: 1080,
          pixelRatio: 1,
          aaMode: 'msaa4',
          gpuFrameMs: 3.4,
          memoryUsedMb: 128.5,
          gpuTimerNote: 'WebGL2 EXT_disjoint_timer_query GPU frame: 3.4ms',
        }}
      />
    );

    expect(screen.getByText(/p50 \/ p95 \/ p99/i)).toBeTruthy();
    expect(screen.getByText(/8.1 \/ 10.2 \/ 11.9ms/i)).toBeTruthy();
    expect(screen.getByText(/AA msaa4/i)).toBeTruthy();
    expect(screen.getByText(/GPU 3.4ms/i)).toBeTruthy();
  });
});
