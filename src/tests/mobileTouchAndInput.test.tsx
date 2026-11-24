import React from 'react';
import * as THREE from 'three';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { AirCombatManager } from '@/src/gameplay/AirCombatManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { AudioSettingsSchema } from '@/src/schemas/settings.schema';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { SettingsPanel } from '@/src/ui/components/SettingsPanel';
import { GameHUD } from '@/src/ui/hud/GameHUD';
import { computeMobileHudLayout } from '@/src/ui/hud/mobileHudLayoutEngine';
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
      left: 36,
      top: 230,
      width: 124,
      height: 124,
      right: 160,
      bottom: 354,
      x: 36,
      y: 230,
      toJSON: () => {},
    }) as DOMRect;
}

describe('PUBG-Style Mobile Multitouch Controls, 360° Movement & Camera Look', () => {
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

  it('supports unrestricted 360-degree analog movement, normalized diagonals, deadzone, un-clamped floating left zone, and forward-only auto-sprint', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);
    const hud = { ...gameSessionStore.getState().hud, inVehicle: false };

    render(<MobileTouchControls inputManager={input} hud={hud} />);
    const stick = screen.getByTestId('touch-move-stick');
    mockStickRect(stick);

    // Center is (98, 292), radius = 124 * 0.44 = 54.56
    const cx = 98;
    const cy = 292;
    const r = 54.56;

    // 1. Inside deadzone -> zero movement
    fireEvent.pointerDown(stick, makePointerEventInit(1, cx + 2, cy - 2));
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });
    expect(input.isActionHeld('sprint')).toBe(false);

    // 2. Full 360-degree sweep across 12 angles (every 30 deg), including cardinals & diagonals
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
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

    // 5. Floating left movement zone anchors at exact touch point for all 4 directions
    const moveZone = screen.getByTestId('touch-move-zone');
    fireEvent.pointerDown(moveZone, makePointerEventInit(2, 140, 120));
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });
    fireEvent.pointerMove(window, makePointerEventInit(2, 140, 168));
    expect(input.getMoveAxes().forward).toBeLessThan(-0.5);
    expect(input.isActionHeld('sprint')).toBe(false);
    fireEvent.pointerMove(window, makePointerEventInit(2, 140, 72));
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.5);
    fireEvent.pointerMove(window, makePointerEventInit(2, 92, 120));
    expect(input.getMoveAxes().right).toBeLessThan(-0.5);
    fireEvent.pointerMove(window, makePointerEventInit(2, 188, 120));
    expect(input.getMoveAxes().right).toBeGreaterThan(0.5);

    fireEvent.pointerUp(window, makePointerEventInit(2, 188, 120));
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });

    rm.disposeAll();
  });

  it('passes the complete mobile acceptance scenario: move forward, continuous 360° camera rotation while moving, move in opposite direction, backward/left/right strafe, 3rd-finger fire, and desktop mouse-look', () => {
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, AudioSettingsSchema.parse({ muted: true }));
    const input = new InputManager(rm, settingsStore.getState().input);
    const collision = new CollisionWorld();
    const player = new PlayerController(audio);
    const hud = { ...gameSessionStore.getState().hud, inVehicle: false };

    render(<MobileTouchControls inputManager={input} hud={hud} />);
    const moveZone = screen.getByTestId('touch-move-zone');
    const lookZone = screen.getByTestId('touch-look-zone');
    const fireBtn = screen.getByTestId('touch-btn-fire');
    const adsBtn = screen.getByTestId('touch-btn-ads');

    // Start player at origin facing North (yaw = 0 -> -Z is forward)
    player.spawn(0, 1.65, 0, 0);

    // Step 1: Hold left joystick forward (pointerId = 1)
    fireEvent.pointerDown(moveZone, makePointerEventInit(1, 120, 260));
    fireEvent.pointerMove(window, makePointerEventInit(1, 120, 200));
    for (let i = 0; i < 10; i++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(player.position.z).toBeLessThan(-0.5);

    // Step 2 & 3: While holding left joystick forward, drag right side continuously to turn a complete 360 degrees
    fireEvent.pointerDown(lookZone, makePointerEventInit(2, 420, 200));
    for (let s = 1; s <= 20; s++) {
      fireEvent.pointerMove(window, makePointerEventInit(2, 420 + s * 20.5, 200));
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(Math.abs(player.yaw)).toBeGreaterThan(Math.PI * 2);
    expect(input.isActionHeld('fire')).toBe(false);

    // Lift look finger — camera must NOT snap back to 0!
    const yawAfter360 = player.yaw;
    fireEvent.pointerUp(window, makePointerEventInit(2, 830, 200));
    player.update(1 / 60, input, collision, false, 1.0, 0, false);
    expect(player.yaw).toBeCloseTo(yawAfter360, 5);

    // Step 4: Turn 180 degrees to face South (yaw = -PI) while still holding joystick forward -> player moves South (+Z)
    player.spawn(0, 1.65, 0, 0);
    fireEvent.pointerDown(lookZone, makePointerEventInit(3, 500, 200));
    fireEvent.pointerMove(window, makePointerEventInit(3, 500 + Math.PI / (0.0135 * 1.15), 200));
    fireEvent.pointerUp(window, makePointerEventInit(3, 702, 200));
    player.update(1 / 60, input, collision, false, 1.0, 0, false);
    expect(player.yaw).toBeCloseTo(-Math.PI, 1);

    for (let i = 0; i < 15; i++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(player.position.z).toBeGreaterThan(0.6);

    // Step 5: Move backward, left, and right using the joystick
    player.spawn(0, 1.65, 0, 0);
    fireEvent.pointerMove(window, makePointerEventInit(1, 120, 320));
    for (let i = 0; i < 12; i++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(player.position.z).toBeGreaterThan(0.4);

    player.spawn(0, 1.65, 0, 0);
    fireEvent.pointerMove(window, makePointerEventInit(1, 60, 260));
    for (let i = 0; i < 12; i++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(player.position.x).toBeLessThan(-0.4);

    player.spawn(0, 1.65, 0, 0);
    fireEvent.pointerMove(window, makePointerEventInit(1, 180, 260));
    for (let i = 0; i < 12; i++) {
      player.update(1 / 60, input, collision, false, 1.0, 0, false);
    }
    expect(player.position.x).toBeGreaterThan(0.4);

    // Step 6: Fire using a 3rd finger and toggle ADS with a 4th finger while simultaneously moving and aiming
    fireEvent.pointerMove(window, makePointerEventInit(1, 120, 200));
    fireEvent.pointerDown(lookZone, makePointerEventInit(4, 520, 180));
    fireEvent.pointerDown(fireBtn, makePointerEventInit(5, 760, 310));
    fireEvent.pointerDown(adsBtn, makePointerEventInit(6, 680, 260));
    fireEvent.pointerUp(adsBtn, makePointerEventInit(6, 680, 260));

    fireEvent.pointerMove(window, makePointerEventInit(4, 565, 165));
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.8);
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.isActionHeld('ads')).toBe(true);
    const lookDelta = input.consumeLookDelta(false);
    expect(lookDelta.yawDelta).toBeGreaterThan(0);
    expect(lookDelta.pitchDelta).toBeLessThan(0);

    // Release all fingers cleanly -> zero stuck inputs
    fireEvent.pointerUp(window, makePointerEventInit(1, 120, 200));
    fireEvent.pointerUp(window, makePointerEventInit(4, 565, 165));
    fireEvent.pointerUp(window, makePointerEventInit(5, 760, 310));
    expect(input.getMoveAxes()).toEqual({ forward: 0, right: 0 });
    expect(input.isActionHeld('fire')).toBe(false);

    rm.disposeAll();
  });

  it('isolates 4 simultaneous multitouch pointerIds, prevents Fire button wiggles from jumping the camera, survives lostpointercapture, and clears cleanly on interruption', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);
    const hud = { ...gameSessionStore.getState().hud, inVehicle: false, grenades: 2 };

    const { unmount } = render(<MobileTouchControls inputManager={input} hud={hud} />);

    const stick = screen.getByTestId('touch-move-stick');
    mockStickRect(stick);
    const lookZone = screen.getByTestId('touch-look-zone');
    const fireBtn = screen.getByTestId('touch-btn-fire');
    const adsBtn = screen.getByTestId('touch-btn-ads');

    // Pressing and micro-wiggling (<= 4px deadzone) on the Fire button MUST NOT cause an unintended camera jump
    fireEvent.pointerDown(fireBtn, makePointerEventInit(3, 760, 310));
    fireEvent.pointerMove(window, makePointerEventInit(3, 762, 308));
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.consumeLookDelta(false)).toEqual({ yawDelta: 0, pitchDelta: 0 });

    // Finger 1: left stick forward
    fireEvent.pointerDown(stick, makePointerEventInit(1, 98, 234));
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.8);

    // Finger 2: camera drag right & up
    fireEvent.pointerDown(lookZone, makePointerEventInit(2, 500, 180));
    fireEvent.pointerMove(lookZone, makePointerEventInit(2, 560, 165));
    const lookDelta = input.consumeLookDelta(false);
    expect(lookDelta.yawDelta).toBeGreaterThan(0);
    expect(lookDelta.pitchDelta).toBeLessThan(0);

    // Finger 4: ADS toggle tapped ON while moving, looking, and firing
    fireEvent.pointerDown(adsBtn, makePointerEventInit(4, 680, 260));
    fireEvent.pointerUp(adsBtn, makePointerEventInit(4, 680, 260));
    expect(input.isActionHeld('ads')).toBe(true);
    expect(input.isActionHeld('fire')).toBe(true);
    expect(input.getMoveAxes().forward).toBeGreaterThan(0.8);

    // Browser implicit lostpointercapture while finger 3 is still holding Fire must NOT drop Fire!
    fireEvent(fireBtn, new MouseEvent('lostpointercapture', { bubbles: true }) as unknown as Event);
    expect(input.isActionHeld('fire')).toBe(true);

    // Actual pointerup on finger 3 releases Fire cleanly while stick continues
    fireEvent.pointerUp(window, makePointerEventInit(3, 760, 310));
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

  it('guarantees zero overlapping interactive hitboxes across all landscape viewports (including Instagram in-app browser 844x310) and profiles via computeMobileHudLayout', () => {
    const viewports = [
      { width: 844, height: 390 },
      { width: 844, height: 310 }, // Instagram / mobile browser reduced height
      { width: 915, height: 412 },
      { width: 667, height: 375 },
      { width: 1024, height: 768 },
    ];

    const profiles: Array<'two_finger' | 'three_finger' | 'custom'> = [
      'two_finger',
      'three_finger',
      'custom',
    ];

    for (const vp of viewports) {
      for (const profile of profiles) {
        settingsStore.getState().updateInput({
          touchControlProfile: profile,
          leftFireEnabled: profile !== 'two_finger',
          rightFireEnabled: profile !== 'three_finger',
          touchFireButtonScale: 1.35, // test worst-case max Fire button size
        });

        const layout = computeMobileHudLayout(settingsStore.getState().input, vp, {
          grenadeCount: 2,
          c4DeployedCount: 1,
        });

        expect(layout.overlappingPairs).toEqual([]);

        // Verify every visible control has >= 44px hitbox and stays inside viewport bounds
        for (const rect of Object.values(layout.controls)) {
          if (!rect.visible) continue;
          expect(rect.width).toBeGreaterThanOrEqual(44);
          expect(rect.height).toBeGreaterThanOrEqual(44);
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.top).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(vp.width + 0.5);
          expect(rect.bottom).toBeLessThanOrEqual(vp.height + 0.5);
        }
      }
    }
  });

  it('supports Two-Finger (Thumb), Three-Finger (Claw), and independent Left/Right Fire settings, prevents top-left HUD obstruction, and eliminates ADS-vs-Sprint deadlock', async () => {
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, AudioSettingsSchema.parse({ muted: true }));
    const scene = new THREE.Scene();
    const vfx = new VFXPool(scene, rm);
    const proj = new ProjectileManager(scene, rm, vfx, audio);
    const weapons = new WeaponSystem(scene, audio, vfx, proj);
    const collision = new CollisionWorld();
    const player = new PlayerController(audio);
    const camera = new THREE.PerspectiveCamera(78, 844 / 390, 0.1, 500);
    const input = new InputManager(rm, settingsStore.getState().input);

    // Switch to Three-Finger Claw Mode -> defaults to Left Fire ON, Right Fire OFF
    settingsStore.getState().updateInput({ touchControlProfile: 'three_finger' });
    expect(settingsStore.getState().input.leftFireEnabled).toBe(true);
    expect(settingsStore.getState().input.rightFireEnabled).toBe(false);

    // Safety invariant: attempting to disable both Left and Right Fire keeps at least one active
    settingsStore.getState().updateInput({ leftFireEnabled: false, rightFireEnabled: false });
    expect(
      settingsStore.getState().input.leftFireEnabled || settingsStore.getState().input.rightFireEnabled
    ).toBe(true);

    // Re-enable 3-Finger Claw (Left Fire ON, Right Fire OFF)
    settingsStore.getState().updateInput({ touchControlProfile: 'three_finger' });
    input.updateSettings(settingsStore.getState().input);

    gameSessionStore.getState().updateHudSnapshot({
      ...gameSessionStore.getState().hud,
      health: 100,
      armor: 100,
      inVehicle: false,
      objectives: [
        { id: 'obj1', title: 'Eliminate Hostile Garrison', current: 3, target: 10, completed: false },
        { id: 'obj2', title: 'Destroy AA Radar Relays', current: 0, target: 2, completed: false },
      ],
    });

    render(<GameHUD onRequestPointerLock={() => {}} inputManager={input} touchControlsVisible={true} />);

    // Verify Left Fire button is in Three-Finger upper-left claw position & top-left HUD shifts rightward to avoid collision
    const fireBtn = await screen.findByTestId('touch-btn-fire');
    expect(fireBtn.getAttribute('data-profile')).toBe('three_finger');
    expect(fireBtn.getAttribute('data-control-id')).toBe('fire_left');
    expect(screen.queryByTestId('touch-btn-fire-right')).toBeNull();

    const fireLeft = parseInt(fireBtn.style.left, 10);
    const fireTop = parseInt(fireBtn.style.top, 10);
    expect(fireLeft).toBeLessThan(200);
    expect(fireTop).toBeLessThan(180);

    const topLeftCluster = screen.getByTestId('hud-top-left-cluster');
    const offsetMatch = topLeftCluster.style.left.match(/(\d+)px/);
    expect(offsetMatch).not.toBeNull();
    expect(Number(offsetMatch![1])).toBeGreaterThan(fireLeft + 60);

    // Verify compact objective indicator expands and collapses on demand
    expect(screen.queryByTestId('hud-objectives-expanded-list')).toBeNull();
    fireEvent.click(screen.getByTestId('hud-objectives-toggle'));
    expect(screen.getByTestId('hud-objectives-expanded-list')).toBeTruthy();
    expect(screen.getByText('Destroy AA Radar Relays')).toBeTruthy();
    fireEvent.click(screen.getByTestId('hud-objectives-toggle'));
    expect(screen.queryByTestId('hud-objectives-expanded-list')).toBeNull();

    // Test simultaneous 3-Finger Claw: Left thumb move (lower-left) + Left index Fire (upper-left) + Right thumb Look + ADS
    const moveZone = screen.getByTestId('touch-move-zone');
    const lookZone = screen.getByTestId('touch-look-zone');
    const adsBtn = screen.getByTestId('touch-btn-ads');

    // 1. Left thumb pushes forward into auto-sprint
    fireEvent.pointerDown(moveZone, makePointerEventInit(1, 110, 280));
    fireEvent.pointerMove(window, makePointerEventInit(1, 110, 210));
    player.update(1 / 60, input, collision, weapons.isAds, 1.0, 0, false);
    expect(player.isSprinting).toBe(true);

    // 2. Tap ADS while auto-sprinting forward -> MUST immediately cancel sprint and enter ADS (no deadlock!)
    fireEvent.pointerDown(adsBtn, makePointerEventInit(2, 720, 260));
    fireEvent.pointerUp(adsBtn, makePointerEventInit(2, 720, 260));
    player.update(1 / 60, input, collision, weapons.isAds, 1.0, 0, false);
    weapons.update(1 / 60, input, player, camera, collision, [], [], () => {}, false);
    expect(weapons.isAds).toBe(true);
    expect(player.isSprinting).toBe(false);

    // 3. Left index finger presses upper-left Claw Fire while Right thumb rotates camera -> fires weapon immediately!
    const shotsBefore = weapons.shotsFired;
    fireEvent.pointerDown(fireBtn, makePointerEventInit(3, 84, 90));
    fireEvent.pointerDown(lookZone, makePointerEventInit(4, 520, 190));
    fireEvent.pointerMove(window, makePointerEventInit(4, 580, 180));

    player.update(1 / 60, input, collision, weapons.isAds, 1.0, 0, false);
    weapons.update(1 / 60, input, player, camera, collision, [], [], () => {}, false);
    input.endFrame();

    expect(weapons.shotsFired).toBeGreaterThan(shotsBefore);
    expect(player.yaw).not.toBe(0);

    fireEvent.pointerUp(window, makePointerEventInit(1, 110, 210));
    fireEvent.pointerUp(window, makePointerEventInit(3, 84, 90));
    fireEvent.pointerUp(window, makePointerEventInit(4, 580, 180));

    weapons.dispose();
    rm.disposeAll();
  });

  it('gates enemy aircraft boss health bar by encounter relevance and supports SettingsPanel inline preview + 1:1 Full-Screen HUD Editor', () => {
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, AudioSettingsSchema.parse({ muted: true }));
    const scene = new THREE.Scene();
    const vfx = new VFXPool(scene, rm);
    const air = new AirCombatManager(scene, rm, vfx, audio);
    const playerPos = new THREE.Vector3(0, 1.7, 58);

    air.spawnUnit('helicopter', 27, 48, 0, 'mission:1');
    // At t=0 (unaware, full health, not primary objective, not dealing damage), boss bar is hidden
    expect(
      air.getActiveBossInfo({
        playerPosition: playerPos,
        isPrimaryObjective: false,
        lockStatus: 'none',
      })
    ).toBeNull();

    // Once damaged or when air_defense becomes primary objective, boss bar is shown
    expect(
      air.getActiveBossInfo({
        playerPosition: playerPos,
        isPrimaryObjective: true,
        lockStatus: 'none',
      })
    ).not.toBeNull();

    // Verify SettingsPanel Controls tab allows selecting Two-Finger / Three-Finger / Custom and launching the 1:1 HUD Editor
    render(<SettingsPanel onBack={() => {}} />);
    const controlsTab = screen.getByRole('tab', { name: /Controls/i });
    fireEvent.mouseDown(controlsTab, { button: 0, ctrlKey: false });
    fireEvent.click(controlsTab);

    const preview = screen.getByTestId('control-layout-preview');
    expect(preview.getAttribute('data-profile')).toBe('two_finger');

    fireEvent.click(screen.getByTestId('profile-three-finger'));
    expect(settingsStore.getState().input.touchControlProfile).toBe('three_finger');
    expect(preview.getAttribute('data-profile')).toBe('three_finger');

    // Open 1:1 Full-Screen HUD Editor
    fireEvent.click(screen.getByTestId('open-fullscreen-hud-editor'));
    expect(screen.getByTestId('fullscreen-hud-editor')).toBeTruthy();
    expect(screen.getByTestId('editor-handle-fire_left')).toBeTruthy();

    // Close 1:1 Full-Screen HUD Editor
    fireEvent.click(screen.getByTestId('close-fullscreen-hud-editor'));
    expect(screen.queryByTestId('fullscreen-hud-editor')).toBeNull();

    // Customize Fire button size and position, then reset
    settingsStore.getState().updateInput({
      touchFireButtonScale: 1.3,
      touchFirePosThreeFinger: { x: 0.22, y: 0.35 },
    });
    expect(settingsStore.getState().input.touchFireButtonScale).toBe(1.3);

    fireEvent.click(screen.getByTestId('reset-mobile-controls'));
    expect(settingsStore.getState().input.touchFireButtonScale).toBe(1.0);
    expect(settingsStore.getState().input.touchFirePosThreeFinger).toEqual({ x: 0.1, y: 0.24 });

    rm.disposeAll();
  });

  it('enforces simplified PUBG HUD visibility rules: bottom-center weapon bar, hides 0-grenade & kit items behind drawer, and swaps to vehicle controls', () => {
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

    // Primary controls + bottom-center weapon bar + kit toggle are present
    expect(screen.getByTestId('touch-btn-fire')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-ads')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-reload')).toBeTruthy();
    expect(screen.getByTestId('touch-weapon-bar')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-weapon-switch')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-jump')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-crouch')).toBeTruthy();
    expect(screen.getByTestId('touch-btn-tactical-drawer')).toBeTruthy();

    // Expandable Tactical Kit reveals secondary controls on demand
    fireEvent.pointerDown(screen.getByTestId('touch-btn-tactical-drawer'), makePointerEventInit(5, 420, 350));
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
