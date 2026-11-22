// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PBR_MATERIAL_PROFILES,
  PbrMaterialLibrary,
  validateDropInAssetContract,
} from '@/src/assets/PbrMaterialLibrary';
import {
  ACOUSTIC_SPACE_PROFILES,
  SpatialAcousticEngine,
  computeSpatialAttenuation,
} from '@/src/audio/SpatialAcousticEngine';
import {
  BattlefieldVfxSystem,
  BattlefieldVfxType,
} from '@/src/effects/BattlefieldVfxSystem';
import { SurfaceDecalManager } from '@/src/effects/SurfaceDecalManager';
import {
  FRONTIER_TECHNOLOGY_DECISIONS,
  runFrontierBenchmarkSuite,
} from '@/src/tests/harnesses/FrontierBenchmarkSuite';
import {
  HARDWARE_PROFILE_DEFAULTS,
  RenderingQualityDirector,
} from '@/src/engine/RenderingQualityDirector';
import {
  DEFAULT_SETTINGS,
  applyBindingWithSwap,
  findKeybindConflict,
  migrateSettingsBundle,
} from '@/src/schemas/settings.schema';
import { settingsStore } from '@/src/stores/settingsStore';
import { ArmoryScreen } from '@/src/ui/screens/ArmoryScreen';
import { SettingsPanel } from '@/src/ui/components/SettingsPanel';
import {
  buildMissionEnvironmentEnhancement,
  getMissionAtmosphereDirective,
} from '@/src/world/MissionEnvironmentEnhancer';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  settingsStore.getState().resetDefaults();
});

describe('Frontier Masterplan V3 — Settings v2, Keybind Conflict & XState Shell', () => {
  it('validates canonical v2 settings losslessly and recovers cleanly from corrupted payloads', () => {
    const validV2 = {
      version: 2,
      display: { uiScale: 1.15 },
      graphics: { quality: 'ultra', fov: 96, shadowsEnabled: true },
      hud: { scale: 1.15, opacity: 0.8, showRadar: false },
      accessibility: { colorblindMode: 'deuteranopia' },
    };
    const normalized = migrateSettingsBundle(validV2);
    expect(normalized.bundle.version).toBe(2);
    expect(normalized.recoveredFromCorruption).toBe(false);
    expect(normalized.bundle.graphics.fov).toBe(96);
    expect(normalized.bundle.display.uiScale).toBe(1.15);
    expect(normalized.bundle.hud.opacity).toBe(0.8);
    expect(normalized.bundle.hud.showRadar).toBe(false);

    const corrupted = migrateSettingsBundle('not-an-object-at-all');
    expect(corrupted.bundle.version).toBe(2);
    expect(corrupted.recoveredFromCorruption).toBe(true);
  });

  it('detects keybind conflicts deterministically and performs atomic swaps', () => {
    const defaults = DEFAULT_SETTINGS.input.bindings;
    const conflict = findKeybindConflict(defaults, 'reload', 'KeyW');
    expect(conflict).not.toBeNull();
    expect(conflict?.conflictingAction).toBe('forward');

    const swapped = applyBindingWithSwap(defaults, 'reload', 'KeyW');
    expect(swapped.swappedWith).toBe('forward');
    expect(swapped.bindings.reload).toBe('KeyW');
    expect(swapped.bindings.forward).toBe(defaults.reload);
  });
});

describe('Frontier Masterplan V3 — Multi-Objective Rendering Director, PBR, VFX, Decals & Acoustics', () => {
  it('defines all 6 hardware capability profiles and degrades peripheral VFX before core readability', () => {
    expect(Object.keys(HARDWARE_PROFILE_DEFAULTS)).toHaveLength(6);

    const director = new RenderingQualityDirector('high_end_desktop');
    expect(director.getActiveDimensions().enemySilhouetteClarity).toBe('protected');

    // Feed sustained >24ms pressure for >3.2s to trigger degradation step 1
    let transitioned = false;
    for (let i = 0; i < 160; i++) {
      if (director.recordFrame({ cpuFrameMs: 26, drawCalls: 140, triangles: 220000 })) {
        transitioned = true;
      }
    }
    expect(transitioned).toBe(true);
    const snap = director.getTelemetry();
    expect(snap.degradationStep).toBeGreaterThanOrEqual(1);
    expect(snap.dimensions.enemySilhouetteClarity).toBe('protected');
    expect(snap.dimensions.weaponCharacterPbr).toBe('protected');
    expect(snap.activeReductions.length).toBeGreaterThan(0);

    // Strict manual lock must never mutate user dimensions automatically
    settingsStore.getState().applyQualityProfile('cinematic');
    director.syncFromGraphicsSettings(settingsStore.getState().graphics);
    const lockedBefore = director.getActiveDimensions();
    for (let i = 0; i < 200; i++) {
      expect(
        director.recordFrame({ cpuFrameMs: 38, drawCalls: 180, triangles: 300000 })
      ).toBe(false);
    }
    expect(director.getActiveDimensions()).toEqual(lockedBefore);
    expect(director.getTelemetry().advisoryMessage).toMatch(/frame budget|locked/i);
  });

  it('provides 16 calibrated PBR material profiles and enforces drop-in CC0/socket asset contract', () => {
    expect(Object.keys(PBR_MATERIAL_PROFILES).length).toBeGreaterThanOrEqual(16);
    const lib = new PbrMaterialLibrary();
    const dryAsphalt = lib.getMaterial('asphalt', { wetness: 0 });
    const wetAsphalt = lib.getMaterial('asphalt', { wetness: 0.9 });
    expect(wetAsphalt.roughness).toBeLessThan(dryAsphalt.roughness);
    lib.dispose();

    const rejected = validateDropInAssetContract({
      assetId: 'prop_barrel_bad',
      assetClass: 'hero',
      licenseString: 'CC-BY-NC-4.0',
      commercialUseAllowed: false,
      triangleCount: 55000,
      boundingHeightMeters: 0.85,
      expectedHeightRangeMeters: [0.6, 1.1],
      pivotGroundOffsetMeters: 0.0,
      authoredSockets: [],
      requiredSockets: ['muzzle', 'optic'],
      hasSeparatePhysicsProxy: true,
      hasSeparateBallisticHitbox: true,
      hasSeparateNavRepresentation: true,
    });
    expect(rejected.approved).toBe(false);
    expect(rejected.errors.some((e) => /commercially/i.test(e))).toBe(true);
    expect(rejected.errors.some((e) => /muzzle/i.test(e))).toBe(true);

    const accepted = validateDropInAssetContract({
      assetId: 'hero_m4a1_v2',
      assetClass: 'hero',
      licenseString: 'CC0-1.0',
      commercialUseAllowed: true,
      triangleCount: 16500,
      boundingHeightMeters: 0.86,
      expectedHeightRangeMeters: [0.6, 1.1],
      pivotGroundOffsetMeters: 0.0,
      authoredSockets: ['muzzle', 'ejection', 'optic', 'left_hand_grip'],
      requiredSockets: ['muzzle', 'ejection', 'optic', 'left_hand_grip'],
      hasSeparatePhysicsProxy: true,
      hasSeparateBallisticHitbox: true,
      hasSeparateNavRepresentation: true,
    });
    expect(accepted.approved).toBe(true);
  });

  it('spawns DecalGeometry decals with ring-buffer eviction and clean mission reset disposal', () => {
    const scene = new THREE.Scene();
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(6, 4, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x808080 })
    );
    wall.name = 'concrete_wall';
    wall.updateMatrixWorld(true);
    scene.add(wall);

    const decals = new SurfaceDecalManager(scene, 6, 80);
    for (let i = 0; i < 10; i++) {
      const ok = decals.spawnImpactDecal({
        targetMesh: wall,
        point: new THREE.Vector3(-2 + i * 0.4, 1.5, 0.25),
        normal: new THREE.Vector3(0, 0, 1),
      });
      expect(ok).toBe(true);
    }
    expect(decals.getStats().activeCount).toBe(6);

    decals.clearMissionDecals();
    expect(decals.getStats().activeCount).toBe(0);
    decals.dispose();
    wall.geometry.dispose();
    (wall.material as THREE.Material).dispose();
  });

  it('simulates all 16 GPU-instanced Battlefield VFX classes in 5 draw calls with indoor rain shelter occlusion', () => {
    const scene = new THREE.Scene();
    const vfx = new BattlefieldVfxSystem(scene, false);
    vfx.registerIndoorShelter({ minX: -5, maxX: 5, minZ: -5, maxZ: 5, ceilingY: 4 });
    expect(vfx.isPointSheltered(0, 2, 0)).toBe(true);
    expect(vfx.isPointSheltered(18, 2, 0)).toBe(false);

    const allClasses: BattlefieldVfxType[] = [
      'muzzle_flash',
      'barrel_smoke',
      'gunpowder_smoke',
      'metal_sparks',
      'bullet_dust',
      'concrete_debris',
      'wood_splinters',
      'explosion_debris',
      'fire',
      'smoke_plumes',
      'rocket_trails',
      'shell_casings',
      'vehicle_exhaust',
      'rain_splash',
      'dust_clouds',
      'breach_effect',
    ];
    for (const cls of allClasses) {
      vfx.emitEffect(cls, new THREE.Vector3(0, 1.2, 0));
    }
    vfx.update(0.05, new THREE.Vector3(0, 2, 8));
    const stats = vfx.getStats();
    expect(stats.drawCalls).toBe(5);
    expect(stats.activeParticles).toBeGreaterThan(20);
    vfx.dispose();
  });

  it('computes 3D spatial acoustic attenuation, occlusion lowpass, and supports all 7 acoustic spaces', () => {
    expect(Object.keys(ACOUSTIC_SPACE_PROFILES)).toHaveLength(7);
    const open = computeSpatialAttenuation({
      listenerPos: { x: 0, y: 1.7, z: 0 },
      listenerForward: { x: 0, z: -1 },
      sourcePos: { x: 12, y: 1.7, z: 0 },
      occluded: false,
    });
    const occluded = computeSpatialAttenuation({
      listenerPos: { x: 0, y: 1.7, z: 0 },
      listenerForward: { x: 0, z: -1 },
      sourcePos: { x: 12, y: 1.7, z: 0 },
      occluded: true,
    });
    expect(open.stereoPan).toBeGreaterThan(0.5);
    expect(occluded.gain).toBeLessThan(open.gain);
    expect(occluded.lowpassHz).toBeLessThan(open.lowpassHz);

    const engine = new SpatialAcousticEngine();
    engine.setAcousticSpace('foundry');
    expect(engine.getAcousticSpace().id).toBe('foundry');
    engine.dispose();
  });

  it('provides distinct atmospheric directives and clean disposable enhancements across all 5 missions', () => {
    const lib = new PbrMaterialLibrary();
    const weathers = new Set<string>();
    const spaces = new Set<string>();
    for (let id = 1; id <= 5; id++) {
      const dir = getMissionAtmosphereDirective(id);
      weathers.add(dir.weatherMode);
      spaces.add(dir.acousticSpace);

      const scene = new THREE.Scene();
      const handle = buildMissionEnvironmentEnhancement(scene, id, lib);
      handle.update(0.25);
      expect(handle.group.children.length).toBeGreaterThan(0);
      handle.dispose();
      expect(scene.children.length).toBe(0);
    }
    expect(weathers.size).toBeGreaterThanOrEqual(4);
    expect(spaces.size).toBeGreaterThanOrEqual(4);
    lib.dispose();
  });

  it('passes all 15 Frontier Benchmark Suite scenarios with zero residue', () => {
    expect(FRONTIER_TECHNOLOGY_DECISIONS.length).toBeGreaterThanOrEqual(6);
    const scenarios = runFrontierBenchmarkSuite();
    expect(scenarios).toHaveLength(15);
    for (const s of scenarios) {
      expect(s.disposedCleanly).toBe(true);
      expect(s.cpuFrameMsP95).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Frontier Masterplan V3 — 7-Category Settings UI & Interactive Armory Stage', () => {
  it('renders all 7 Settings categories, supports keybind conflict swap, and reverts session edits', () => {
    render(<SettingsPanel onBack={() => {}} />);

    // Verify all 7 player-facing tabs exist
    expect(screen.getByRole('tab', { name: /^Display$/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Graphics$/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Audio$/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Controls/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Gameplay$/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^HUD$/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Accessibility$/i })).toBeTruthy();

    // Switch to Controls tab and trigger a keybind conflict (bind Reload to KeyW which is Forward)
    const controlsTab = screen.getByRole('tab', { name: /Controls/i });
    fireEvent.mouseDown(controlsTab, { button: 0, ctrlKey: false });
    fireEvent.click(controlsTab);

    fireEvent.click(screen.getByTestId('rebind-reload'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    });
    expect(screen.getByTestId('keybind-conflict-banner')).toBeTruthy();

    fireEvent.click(screen.getByTestId('confirm-keybind-swap'));
    expect(settingsStore.getState().input.bindings.reload).toBe('KeyW');
    expect(settingsStore.getState().input.bindings.forward).toBe(DEFAULT_SETTINGS.input.bindings.reload);

    // Dirty banner & Revert must restore original binding
    expect(screen.getByTestId('settings-dirty-banner')).toBeTruthy();
    fireEvent.click(screen.getByTestId('settings-revert-btn'));
    expect(settingsStore.getState().input.bindings.reload).toBe(DEFAULT_SETTINGS.input.bindings.reload);
  });

  it('renders ArmoryScreen with interactive stage camera presets and clean fallback in headless mode', () => {
    render(
      <ArmoryScreen onDeployWithWeapon={() => {}} onUiClick={() => {}} isSoftwareGl={true} />
    );
    expect(screen.getByTestId('armory-weapon-stage')).toBeTruthy();
    expect(screen.getByTestId('armory-angle-profile')).toBeTruthy();
    expect(screen.getByTestId('armory-angle-optic')).toBeTruthy();
    expect(screen.getByTestId('armory-angle-muzzle')).toBeTruthy();
    expect(screen.getByTestId('armory-angle-receiver')).toBeTruthy();
    fireEvent.click(screen.getByTestId('armory-angle-optic'));
    expect(screen.getByText(/2D Tactical Blueprint View/i)).toBeTruthy();
  });
});
