import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { InputManager } from '@/src/engine/InputManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { AudioSettingsSchema } from '@/src/schemas/settings.schema';
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

function mockStickRect(stick: HTMLElement) {
  stick.getBoundingClientRect = () =>
    ({
      left: 16,
      top: 250,
      width: 124,
      height: 124,
      right: 140,
      bottom: 374,
      x: 16,
      y: 250,
      toJSON: () => {},
    }) as DOMRect;
}

describe('PUBG-Style Mobile Multitouch Controls, 360° Movement & Camera Look', () => {
  afterEach(() => {
    cleanup();
    settingsStore.getState().resetDefaults();
  });

  it('supports unrestricted 360-degree analog movement, normalized diagonals, deadzone, and forward-only auto-sprint', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);
    const hud = { ...gameSessionStore.getState().hud, inVehicle: false };

    render(<MobileTouchControls inputManager={input} hud={hud} />);
    const stick = screen.getByTestId('touch-move-stick');
    mockStickRect(stick);

    // Center is (78, 312), radius = 124 * 0.44 = 54.56
    const cx = 78;
    const cy = 312;
    const r = 54.56;

    // 1. Inside deadzone -> zero movement
    fireEvent.pointerDown(stick, makePointerEventInit(1, cx + 2, cy - 2));
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });
    expect(input.isActionHeld('sprint')).toBe(false);

    // 2. Full 360-degree sweep across 12 angles (every 30 deg), including cardinals & diagonals
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      // Screen coords: +x is right, -y is forward (up)
      const px = cx + Math.sin(rad) * r;
      const py = cy - Math.cos(rad) * r;
      fireEvent.pointerMove(stick, makePointerEventInit(1, px, py));

      const axes = input.getMoveAxes();
      const mag = Math.hypot(axes.forward, axes.right);
      expect(mag).toBeGreaterThan(0.95);
      expect(mag).toBeLessThanOrEqual(1.0001);

      const expectedForward = Math.cos(rad);
      const expectedRight = Math.sin(rad);
      expect(axes.forward).toBeCloseTo(expectedForward, 1);
      expect(axes.right).toBeCloseTo(expectedRight, 1);

      // Sideways (90, 270) and backward (150..210) MUST NEVER trigger auto-sprint
      if (expectedForward < 0.5) {
        expect(input.isActionHeld('sprint')).toBe(false);
      }
    }

    // 3. Explicit 4 diagonal checks (NE, NW, SE, SW) normalized <= 1.0
    const diagonals = [
      { dx: 1, dy: -1, sf: 1, sr: 1 },
      { dx: -1, dy: -1, sf: 1, sr: -1 },
      { dx: 1, dy: 1, sf: -1, sr: 1 },
      { dx: -1, dy: 1, sf: -1, sr: -1 },
    ];
    for (const d of diagonals) {
      fireEvent.pointerMove(stick, makePointerEventInit(1, cx + d.dx * 60, cy + d.dy * 60));
      const axes = input.getMoveAxes();
      expect(Math.sign(axes.forward)).toBe(d.sf);
      expect(Math.sign(axes.right)).toBe(d.sr);
      expect(Math.hypot(axes.forward, axes.right)).toBeLessThanOrEqual(1.0001);
    }

    // 4. Straight forward beyond auto-sprint threshold activates sprint; release resets everything
    fireEvent.pointerMove(stick, makePointerEventInit(1, cx, cy - r));
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.95);
    expect(input.isActionHeld('sprint')).toBe(true);

    fireEvent.pointerUp(stick, makePointerEventInit(1, cx, cy - r));
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });
    expect(input.isActionHeld('sprint')).toBe(false);

    // 5. Floating left movement zone works outside resting stick bounds
    const moveZone = screen.getByTestId('touch-move-zone');
    fireEvent.pointerDown(moveZone, makePointerEventInit(2, 220, 240));
    fireEvent.pointerMove(moveZone, makePointerEventInit(2, 265, 240)); // Drag right
    expect(input.getMoveAxes().right).toBeGreaterThan(0.4);
    expect(input.isActionHeld('sprint')).toBe(false); // Sideways never sprints
    fireEvent.pointerUp(moveZone, makePointerEventInit(2, 265, 240));
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });

    rm.disposeAll();
  });

  it('maps 360-degree analog movement relative to camera yaw, preserves analog partial speed, and rotates camera continuously 360° with pitch clamping', () => {
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, AudioSettingsSchema.parse({ muted: true }));
    const input = new InputManager(rm, settingsStore.getState().input);
    const collision = new CollisionWorld();
    const player = new PlayerController(audio);

    // Analog speed check: 35% deflection produces slower steady speed than 100% deflection
    player.spawn(0, 1.65, 0, 0);
    input.setVirtualMoveAxes(0.35, 0);
    for (let i = 0; i < 30; i++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    const slowSpeed = player.currentSpeed;

    player.spawn(0, 1.65, 0, 0);
    input.setVirtualMoveAxes(1.0, 0);
    for (let i = 0; i < 30; i++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    const fullSpeed = player.currentSpeed;
    expect(slowSpeed).toBeGreaterThan(1.0);
    expect(slowSpeed).toBeLessThan(fullSpeed * 0.65);

    // Camera-relative movement: rotate yaw to -PI/2 (facing +X), forward input moves +X, right moves +Z
    player.spawn(0, 1.65, 0, -Math.PI / 2);
    input.setVirtualMoveAxes(1.0, 0);
    for (let i = 0; i < 12; i++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(player.position.x).toBeGreaterThan(0.3);
    expect(Math.abs(player.position.z)).toBeLessThan(0.05);

    player.spawn(0, 1.65, 0, -Math.PI / 2);
    input.setVirtualMoveAxes(0, 1.0); // Strafe right when facing +X -> +Z
    for (let i = 0; i < 12; i++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(player.position.z).toBeGreaterThan(0.3);

    // Continuous 360-degree camera rotation (both directions) + pitch clamping + smoothing settle
    player.spawn(0, 1.65, 0, 0);
    input.setVirtualMoveAxes(0, 0);
    for (let step = 0; step < 30; step++) {
      input.addVirtualLookDelta(45, 0); // Drag right continuously
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    // Settle EMA smoothing tail
    for (let s = 0; s < 10; s++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(Math.abs(player.yaw)).toBeGreaterThan(Math.PI * 2); // Exceeded full 360°

    // Drag left rotates in opposite direction
    const yawAfterRight = player.yaw;
    input.addVirtualLookDelta(-120, 0);
    player.update(1 / 60, input, collision, false, 1.0, 0, false);
    expect(player.yaw).toBeGreaterThan(yawAfterRight);

    // Pitch drag upward / downward clamps within [-1.42, 1.42]
    for (let i = 0; i < 20; i++) {
      input.addVirtualLookDelta(0, -100);
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(player.pitch).toBeCloseTo(1.42, 2);
    for (let i = 0; i < 40; i++) {
      input.addVirtualLookDelta(0, 100);
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(player.pitch).toBeCloseTo(-1.42, 2);

    // Simultaneous movement + camera rotation
    player.spawn(0, 1.65, 0, 0);
    input.setVirtualMoveAxes(1, 0.5);
    input.addVirtualLookDelta(35, -10);
    player.update(1 / 60, input, collision, false, 1.0, 0, false);
    expect(player.yaw).toBeLessThan(0);
    expect(player.currentSpeed).toBeGreaterThan(0);

    rm.disposeAll();
  });

  it('isolates 4 simultaneous multitouch pointerIds (Move + Look + Fire + ADS toggle), prevents look-to-fire, and clears cleanly on interruption', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);
    const hud = { ...gameSessionStore.getState().hud, inVehicle: false, grenades: 2 };

    const { unmount } = render(<MobileTouchControls inputManager={input} hud={hud} />);

    const stick = screen.getByTestId('touch-move-stick');
    mockStickRect(stick);
    const lookZone = screen.getByTestId('touch-look-zone');
    const fireBtn = screen.getByTestId('touch-btn-fire');
    const adsBtn = screen.getByTestId('touch-btn-ads');

    // Finger 1: left stick forward
    fireEvent.pointerDown(stick, makePointerEventInit(1, 78, 254));
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.8);

    // Finger 2: camera drag right & up -> NEVER fires weapon
    fireEvent.pointerDown(lookZone, makePointerEventInit(2, 500, 180));
    fireEvent.pointerMove(lookZone, makePointerEventInit(2, 560, 165));
    expect(input.isActionHeld('fire')).toBe(false);
    expect(input.wasActionPressed('fire')).toBe(false);
    const lookDelta = input.consumeLookDelta(false);
    expect(lookDelta.yawDelta).toBeGreaterThan(0);
    expect(lookDelta.pitchDelta).toBeLessThan(0);

    // Finger 3: Fire held
    fireEvent.pointerDown(fireBtn, makePointerEventInit(3, 760, 310));
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.isActionHeld('ads')).toBe(false);

    // Finger 4: ADS toggle tapped ON while moving, looking, and firing
    fireEvent.pointerDown(adsBtn, makePointerEventInit(4, 680, 260));
    fireEvent.pointerUp(adsBtn, makePointerEventInit(4, 680, 260));
    expect(input.isActionHeld('ads')).toBe(true);
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.8);

    // Cancel finger 2 (look) -> stick, fire, ADS stay intact
    fireEvent.pointerCancel(lookZone, makePointerEventInit(2, 560, 165));
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.8);
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.isActionHeld('ads')).toBe(true);

    // Tap ADS again -> toggles OFF cleanly
    fireEvent.pointerDown(adsBtn, makePointerEventInit(4, 680, 260));
    fireEvent.pointerUp(adsBtn, makePointerEventInit(4, 680, 260));
    expect(input.isActionHeld('ads')).toBe(false);

    // lostpointercapture on Fire releases fire cleanly while stick continues
    fireEvent(fireBtn, new MouseEvent('lostpointercapture', { bubbles: true }) as unknown as Event);
    fireEvent.pointerUp(fireBtn, makePointerEventInit(3, 760, 310));
    expect(input.isActionHeld('fire')).toBe(false);
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.8);

    // Unmount (pause / portrait block / mission unload) clears all virtual inputs
    unmount();
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });
    expect(input.isActionHeld('fire')).toBe(false);
    expect(input.isActionHeld('ads')).toBe(false);
    expect(input.isActionHeld('sprint')).toBe(false);

    rm.disposeAll();
  });

  it('enforces simplified PUBG HUD visibility rules: removes redundant arrows/sprint, hides 0-grenade & kit items behind drawer, and swaps to vehicle controls', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);

    const baseHud = {
      ...gameSessionStore.getState().hud,
      inVehicle: false,
      grenades: 0,
      interactPrompt: null,
    };

    const { rerender } = render(<MobileTouchControls inputManager={input} hud={baseHud} />);

    // Removed/consolidated clutter MUST NOT appear by default
    expect(screen.queryByTestId('touch-btn-weapon-prev')).toBeNull();
    expect(screen.queryByTestId('touch-btn-weapon-next')).toBeNull();
    expect(screen.queryByTestId('touch-btn-sprint')).toBeNull();
    expect(screen.queryByTestId('touch-btn-grenade')).toBeNull();
    expect(screen.queryByTestId('touch-btn-interact')).toBeNull();
    expect(screen.queryByTestId('touch-tactical-drawer')).toBeNull();

    // Primary 6 controls + kit toggle are present
    expect(screen.getByTestId('touch-btn-fire')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-ads')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-reload')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-weapon-switch')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-jump')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-crouch')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-tactical-drawer')).toBeTruthy();

    // Expandable Tactical Kit reveals secondary controls on demand
    fireEvent.pointerDown(screen.getByTestId('touch-btn-tactical-drawer'), makePointerEventInit(5, 780, 220));
    expect(screen.getByTestId('touch-tactical-drawer')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-firemode')).toBeTruthy();

    // Contextual Grenade & Interact appear ONLY when available
    rerender(
      <MobileTouchControls
        inputManager={input}
        hud={{ ...baseHud, grenades: 2, interactPrompt: '[E] Resupply Ammo & Armor' }}
      />
    );
    expect(screen.getByTestId('touch-btn-grenade')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-interact')).toBeTruthy();

    // Vehicle mode replaces infantry buttons cleanly with GUN / CAM / EXIT
    rerender(<MobileTouchControls inputManager={input} hud={{ ...baseHud, inVehicle: true }} />);
    expect(screen.queryByTestId('touch-btn-ads')).toBeNull();
    expect(screen.queryByTestId('touch-btn-reload')).toBeNull();
    expect(screen.queryByTestId('touch-btn-jump')).toBeNull();
    expect(screen.queryByTestId('touch-btn-crouch')).toBeNull();
    expect(screen.getByText('GUN')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('touch-btn-veh-cam'), makePointerEventInit(6, 700, 220));
    fireEvent.pointerDown(screen.getByTestId('touch-btn-veh-exit'), makePointerEventInit(7, 760, 220));
    expect(input.wasActionPressed('vehicleCamera')).toBe(true);
    expect(input.wasActionPressed('interact')).toBe(true);

    input.clearAllInputs();
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });
    expect(input.wasActionPressed('interact')).toBe(false);

    rm.disposeAll();
  });
});
