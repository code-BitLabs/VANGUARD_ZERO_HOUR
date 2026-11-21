import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as THREE from 'three';
import { ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { PbrMaterialLibrary } from '@/src/assets/PbrMaterialLibrary';
import { ResourceManager } from '@/src/core/ResourceManager';
import { BattlefieldVfxSystem } from '@/src/effects/BattlefieldVfxSystem';
import { InputManager } from '@/src/engine/InputManager';
import { DEFAULT_SETTINGS } from '@/src/schemas/settings.schema';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { missionSelectionStore } from '@/src/stores/missionSelectionStore';
import { uiStore } from '@/src/stores/uiStore';
import { DebriefScreen, PauseOverlay } from '@/src/ui/screens/Overlays';
import { TitleScreen } from '@/src/ui/screens/TitleScreen';
import { ArmoryScreen } from '@/src/ui/screens/ArmoryScreen';
import { buildMissionEnvironmentEnhancement } from '@/src/world/MissionEnvironmentEnhancer';

describe('Stage 8 Live UX, Gameplay & Visual Defect Elimination (VIS-005 through VIS-015)', () => {
  beforeEach(() => {
    missionSelectionStore.getState().setSelectedMission(1);
    missionSelectionStore.getState().setDifficulty('normal');
    uiStore.getState().setScreen('title');
  });

  it('VIS-008: postprocessing ToneMappingEffect supports ACES_FILMIC mode', () => {
    const tm = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    expect(tm.mode).toBe(ToneMappingMode.ACES_FILMIC);
    tm.dispose();
  });

  it('VIS-009: BattlefieldVfxSystem registers indoor shelters and occludes sheltered points', () => {
    const scene = new THREE.Scene();
    const vfx = new BattlefieldVfxSystem(scene, true);
    vfx.registerIndoorShelter({
      minX: -10,
      maxX: 10,
      minZ: -20,
      maxZ: 0,
      ceilingY: 4.5,
    });
    expect(vfx.isPointSheltered(0, 2.0, -10)).toBe(true);
    expect(vfx.isPointSheltered(0, 6.0, -10)).toBe(false);
    expect(vfx.isPointSheltered(25, 2.0, -10)).toBe(false);
    vfx.clearIndoorShelters();
    expect(vfx.isPointSheltered(0, 2.0, -10)).toBe(false);
    vfx.dispose();
  });

  it('VIS-010: buildMissionEnvironmentEnhancement grounds props to sloped terrain and skips underwater river puddles', () => {
    const lib = new PbrMaterialLibrary();

    // Mission 2 sloped desert terrain: gantry posts & pipes must sit above elevated ground, never floating/buried at y=0
    const scene2 = new THREE.Scene();
    const slopedDesert = (x: number, z: number) => 5.0 + x * 0.05 + z * 0.02;
    const m2 = buildMissionEnvironmentEnhancement(scene2, 2, lib, slopedDesert);
    let foundPipe = false;
    m2.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.surfaceMaterial === 'metal') {
        foundPipe = true;
        expect(obj.position.y).toBeGreaterThan(10.0);
      }
    });
    expect(foundPipe).toBe(true);
    m2.dispose();

    // Mission 4 jungle river: puddles over river channel (y < 0.15) are skipped, dry banks grounded
    const scene4 = new THREE.Scene();
    const riverTerrain = (x: number, _z: number) => (x < 0 ? -0.4 : 2.2);
    const m4 = buildMissionEnvironmentEnhancement(scene4, 4, lib, riverTerrain);
    expect(m4.group.children.length).toBe(1);
    expect(m4.group.children[0].position.x).toBe(5);
    expect(m4.group.children[0].position.y).toBeCloseTo(2.23, 2);
    m4.dispose();

    // Mission 5 foundry slag channels grounded + polygonOffset enabled against z-fighting
    const scene5 = new THREE.Scene();
    const foundryGround = () => 3.5;
    const m5 = buildMissionEnvironmentEnhancement(scene5, 5, lib, foundryGround);
    expect(m5.group.children.length).toBe(2);
    const channel = m5.group.children[0] as THREE.Mesh;
    expect(channel.position.y).toBeCloseTo(3.54, 2);
    expect((channel.material as THREE.MeshStandardMaterial).polygonOffset).toBe(true);
    m5.dispose();

    lib.dispose();
  });

  it('VIS-005: InputManager supports free-cursor canvas click-to-fire and drag-to-aim fallback when pointer lock is unavailable', () => {
    const rm = new ResourceManager();
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    let gameplayActive = true;

    const input = new InputManager(
      rm,
      DEFAULT_SETTINGS.input,
      () => {},
      () => {},
      () => gameplayActive
    );
    input.attach(canvas);

    // Click directly on canvas while !pointerLocked triggers fire & drag-aim
    fireEvent.mouseDown(canvas, { button: 0, clientX: 200, clientY: 150 });
    expect(input.isActionHeld('fire')).toBe(true);

    fireEvent.mouseMove(window, { clientX: 224, clientY: 162, movementX: 0, movementY: 0 });
    const look = input.consumeLookDelta(false);
    expect(Math.abs(look.yawDelta)).toBeGreaterThan(0);
    expect(Math.abs(look.pitchDelta)).toBeGreaterThan(0);

    fireEvent.mouseUp(window, { button: 0 });
    expect(input.isActionHeld('fire')).toBe(false);

    // Clicks when gameplay is NOT active (e.g. menu overlay) must NOT fire
    gameplayActive = false;
    fireEvent.mouseDown(canvas, { button: 0, clientX: 200, clientY: 150 });
    expect(input.isActionHeld('fire')).toBe(false);

    rm.unloadScope('shared');
    canvas.remove();
  });

  it('VIS-012 & VIS-013: Debrief difficulty buttons update difficulty without premature auto-redeploy and remove internal QA jargon', () => {
    gameSessionStore.getState().setDebrief({
      victory: false,
      missionId: 1,
      score: 1200,
      kills: 8,
      airKills: 0,
      headshots: 3,
      accuracyPct: 44,
      durationSec: 135,
      grade: 'C',
      xpEarned: 150,
      requisitionEarned: 60,
      newAchievements: [],
      difficulty: 'normal',
      canRestartCheckpoint: true,
      deploymentMode: 'fireteam',
    });

    const onRetry = vi.fn();
    const onNextMission = vi.fn();
    const onChangeDifficulty = vi.fn((d: 'easy' | 'normal' | 'hard' | 'extreme') => {
      missionSelectionStore.getState().setDifficulty(d);
    });

    render(
      <DebriefScreen
        onRetry={onRetry}
        onChangeDifficulty={onChangeDifficulty}
        onNextMission={onNextMission}
        onReturnMenu={vi.fn()}
      />
    );

    // Selecting Easy must NOT call onRetry (no premature mission wipe)
    fireEvent.click(screen.getByTestId('debrief-difficulty-easy'));
    expect(onChangeDifficulty).toHaveBeenCalledWith('easy');
    expect(missionSelectionStore.getState().difficulty).toBe('easy');
    expect(onRetry).not.toHaveBeenCalled();

    // No internal "Hardware QA" label visible to players
    expect(screen.queryByText(/Hardware QA/i)).toBeNull();
    expect(screen.getByRole('button', { name: /System Info/i })).toBeTruthy();

    // Clicking Replay Mission triggers onRetry
    fireEvent.click(screen.getByRole('button', { name: /Replay Mission/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('VIS-013: PauseOverlay uses player-facing Field Manual and System Info labels', () => {
    render(
      <PauseOverlay
        onResume={vi.fn()}
        onRestartCheckpoint={vi.fn()}
        onRestartMission={vi.fn()}
        onAbort={vi.fn()}
      />
    );
    expect(screen.queryByText(/Tier 3/i)).toBeNull();
    expect(screen.queryByText(/Hardware QA/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Field Manual & Controls/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /System Info/i })).toBeTruthy();
  });

  it('VIS-014 & VIS-015: TitleScreen isolates stacking context and ArmoryScreen displays active operation & mode context', () => {
    missionSelectionStore.getState().setSelectedMission(3);
    missionSelectionStore.getState().setDifficulty('hard');
    missionSelectionStore.getState().setDeploymentMode('solo');

    const { unmount } = render(<TitleScreen onUiClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Play Campaign/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Select Operation/i })).toBeTruthy();
    unmount();

    render(
      <ArmoryScreen
        onDeployWithWeapon={vi.fn()}
        onUiClick={vi.fn()}
        isSoftwareGl={true}
      />
    );
    expect(screen.getByText(/Op 03 · HARD · SOLO OPERATOR/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Deploy Mission 03/i })).toBeTruthy();
  });
});
