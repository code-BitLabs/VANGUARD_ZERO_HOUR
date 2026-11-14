import * as THREE from 'three';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import {
  isDeveloperModeActiveForSetting,
  resolveEnvDevModeAllowed,
  setDevModeEnvOverrideForTests,
} from '@/src/config/devMode';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { settingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { SettingsPanel } from '@/src/ui/components/SettingsPanel';
import { CombatDebugOverlay } from '@/src/ui/debug/CombatDebugOverlay';
import { GameHUD } from '@/src/ui/hud/GameHUD';
import { createDestructibleCollider, DestructionSystem } from '@/src/world/DestructionSystem';

describe('Environment-Gated Dev Mode & Memory Leak Prevention', () => {
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
    setDevModeEnvOverrideForTests(null);
    settingsStore.getState().updateDeveloper({
      devModeEnabled: true,
      combatDebugOverlay: false,
      combatDebugCollapsed: false,
      sandboxOrdnanceAuthorized: false,
    });
    uiStore.setState({
      combatDebugOpen: false,
      diagnosticsOpen: false,
      debugSimPaused: false,
    });
    cleanup();
  });

  it('enforces VITE_DEV_MODE and production build gating in env resolver', () => {
    expect(resolveEnvDevModeAllowed({ VITE_DEV_MODE: 'false', DEV: true, PROD: false })).toBe(false);
    expect(resolveEnvDevModeAllowed({ VITE_DEV_MODE: '0', DEV: true, PROD: false })).toBe(false);
    expect(resolveEnvDevModeAllowed({ DEV: false, PROD: true })).toBe(false);
    expect(resolveEnvDevModeAllowed({ DEV: true, PROD: false })).toBe(true);
    expect(resolveEnvDevModeAllowed({ VITE_DEV_MODE: 'true', DEV: false, PROD: true })).toBe(true);

    expect(
      isDeveloperModeActiveForSetting(true, { VITE_DEV_MODE: 'false', DEV: true, PROD: false })
    ).toBe(false);
    expect(
      isDeveloperModeActiveForSetting(false, { VITE_DEV_MODE: 'true', DEV: true, PROD: false })
    ).toBe(false);
    expect(
      isDeveloperModeActiveForSetting(true, { VITE_DEV_MODE: 'true', DEV: true, PROD: false })
    ).toBe(true);
  });

  it('blocks F4/F3 stores, HUD launcher, CombatDebugOverlay, and Settings Developer tab when VITE_DEV_MODE=false', () => {
    setDevModeEnvOverrideForTests({ VITE_DEV_MODE: 'false', DEV: false, PROD: true });

    // Even if user/storage tries to turn overlays on, uiStore refuses
    uiStore.getState().setCombatDebugOpen(true);
    uiStore.getState().toggleCombatDebug();
    uiStore.getState().toggleDiagnostics();
    uiStore.getState().setDebugSimPaused(true);

    expect(uiStore.getState().combatDebugOpen).toBe(false);
    expect(uiStore.getState().diagnosticsOpen).toBe(false);
    expect(uiStore.getState().debugSimPaused).toBe(false);

    render(
      <>
        <GameHUD onRequestPointerLock={() => {}} />
        <CombatDebugOverlay />
        <SettingsPanel onBack={() => {}} />
      </>
    );

    expect(screen.queryByRole('button', { name: /Open Combat and Performance Diagnostics/i })).toBeNull();
    expect(screen.queryByText(/Combat & Engine Diagnostics/i)).toBeNull();
    expect(screen.queryByRole('tab', { name: /Developer Tools/i })).toBeNull();
  });

  it('immediately closes open F4/F3 overlays and hides HUD launcher when Settings devModeEnabled is switched off', () => {
    setDevModeEnvOverrideForTests({ VITE_DEV_MODE: 'true', DEV: true, PROD: false });
    uiStore.getState().setCombatDebugOpen(true);
    uiStore.getState().toggleDiagnostics();
    uiStore.getState().setDebugSimPaused(true);

    expect(uiStore.getState().combatDebugOpen).toBe(true);
    expect(uiStore.getState().diagnosticsOpen).toBe(true);

    render(
      <>
        <GameHUD onRequestPointerLock={() => {}} />
        <CombatDebugOverlay />
      </>
    );
    expect(screen.getByText(/Combat & Engine Diagnostics/i)).toBeTruthy();

    // Turn off master setting in Settings -> Developer Tools
    act(() => {
      settingsStore.getState().updateDeveloper({ devModeEnabled: false });
    });

    expect(uiStore.getState().combatDebugOpen).toBe(false);
    expect(uiStore.getState().diagnosticsOpen).toBe(false);
    expect(uiStore.getState().debugSimPaused).toBe(false);

    expect(screen.queryByText(/Combat & Engine Diagnostics/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Open Combat and Performance Diagnostics/i })).toBeNull();
  });

  it('prevents material cloning leaks in DestructionSystem and disposes cleanly', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const vfx = new VFXPool(scene, rm);
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const cw = new CollisionWorld();
    const destruction = new DestructionSystem(cw.spatialHash, vfx, audio);

    const originalMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const assignedMats = new Set<THREE.Material>();

    for (let i = 0; i < 5; i++) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(geo, originalMat);
      group.add(mesh);
      const id = `barrel_${i}`;
      destruction.register({
        id,
        kind: 'barrel',
        isObjectiveTarget: false,
        position: new THREE.Vector3(i * 4, 0, 0),
        health: 20,
        maxHealth: 20,
        state: 'INTACT',
        blastRadius: 0,
        blastDamage: 0,
        meshGroup: group,
        collider: createDestructibleCollider(id, i * 4, 0, 0, 0.5, 1, 0.5),
      });
      destruction.applyDamage(id, 50);
      assignedMats.add(mesh.material as THREE.Material);
    }

    // All 5 destroyed barrels share ONE charred material rather than cloning 5 materials
    expect(assignedMats.size).toBe(1);
    expect(assignedMats.has(originalMat)).toBe(false);

    const sharedCharred = Array.from(assignedMats)[0];
    const disposeSpy = vi.spyOn(sharedCharred, 'dispose');
    destruction.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    geo.dispose();
    originalMat.dispose();
    rm.disposeAll();
  });

  it('releases ResourceManager entries immediately when strike markers expire and disposes WeaponSystem & AssetManager scopes cleanly', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const vmScene = new THREE.Scene();
    const vfx = new VFXPool(scene, rm);
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const proj = new ProjectileManager(scene, rm, vfx, audio);
    const explosives = new ExplosiveManager(scene, rm, vfx, audio, proj);
    const weapons = new WeaponSystem(vmScene, audio, vfx, proj);
    const assets = new AssetManager(rm);

    rm.recordBaseline();

    // Scoped material in AssetManager must NOT pollute shared cache across mission unloads
    const matM1 = assets.getSharedMaterial('wall', { color: 0x222222 }, 'mission:1');
    expect(rm.getSnapshot().missionCount).toBe(1);
    rm.unloadScope('mission:1');
    expect(rm.getSnapshot().missionCount).toBe(0);
    const matM2 = assets.getSharedMaterial('wall', { color: 0x222222 }, 'mission:2');
    expect(matM2).not.toBe(matM1);
    rm.unloadScope('mission:2');

    // Strike marker registered in mission:3 must release its ResourceManager entry as soon as timer expires
    const cw = new CollisionWorld();
    cw.addStaticBox({
      id: 'ground',
      minX: -50,
      minY: -1,
      minZ: -50,
      maxX: 50,
      maxY: 0,
      maxZ: 50,
      layer: COLLISION_LAYER.WORLD,
    });
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    cam.position.set(0, 2, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    explosives.callBombStrike(cam, cw, () => true, true, 'mission:3');
    expect(rm.getSnapshot().missionCount).toBeGreaterThan(0);

    // Advance explosive manager past marker duration (3.5s) while mission:3 is still active
    const mockPlayer = {
      position: new THREE.Vector3(0, 0, 50),
      alive: true,
      applyDamage: vi.fn(),
      applyValidatedExplosionDamage: vi.fn(() => 0),
      getLastDamageBreakdown: () => ({ armorAbsorbed: 0, healthLost: 0 }),
    } as never;
    const mockEnemies = { getUnits: () => [] } as never;
    const mockVehicles = { getVehicles: () => [] } as never;
    const mockAir = { getUnits: () => [] } as never;
    const mockDest = { getAll: () => [] } as never;
    const callbacks = {
      onEnemyKilled: () => {},
      onAirKilled: () => {},
      onConvoyDestroyed: () => {},
      onDestructibleDestroyed: () => {},
      onAlert: () => {},
    };

    for (let i = 0; i < 45; i++) {
      explosives.update(0.1, mockPlayer, cam, cw, mockEnemies, mockVehicles, mockAir, mockDest, false, false, callbacks);
    }

    // Strike marker entry released immediately without waiting for mission unload!
    expect(rm.getSnapshot().missionCount).toBe(0);

    // WeaponSystem.dispose() detaches container from viewModelScene
    expect(vmScene.children.length).toBe(1);
    weapons.dispose();
    expect(vmScene.children.length).toBe(0);

    explosives.dispose();
    assets.dispose();
    audio.dispose();
    rm.disposeAll();
  });
});
