import React from 'react';
import * as THREE from 'three';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { VFXPool } from '@/src/effects/VFXPool';
import { InputManager } from '@/src/engine/InputManager';
import { PlayerController } from '@/src/gameplay/PlayerController';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { AudioSettingsSchema } from '@/src/schemas/settings.schema';
import { gameSessionStore } from '@/src/stores/gameSessionStore';
import { settingsStore } from '@/src/stores/settingsStore';
import { GameHUD } from '@/src/ui/hud/GameHUD';
import { MobileTouchControls } from '@/src/ui/hud/MobileTouchControls';

function createPlayerHarness(spawnZ = 2.0, spawnYaw = 0) {
  const rm = new ResourceManager();
  const audio = new AudioManager(rm, AudioSettingsSchema.parse({}));
  const input = new InputManager(rm, settingsStore.getState().input);
  const world = new CollisionWorld();
  const player = new PlayerController(audio);
  player.spawn(0, 1.65, spawnZ, spawnYaw);
  return { rm, audio, input, world, player };
}

function stepSimulation(
  player: PlayerController,
  input: InputManager,
  world: CollisionWorld,
  steps: number,
  dt: number
): void {
  for (let i = 0; i < steps; i++) {
    player.update(dt, input, world, false, 1.0, 1.0, false);
    input.endFrame();
  }
}

describe('TRN-05: Player Vaulting, Low-Cover Mantle & Damped Landing Spring', () => {
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

  it('vaults cleanly over a 0.92m supply crate without tunneling or getting stuck', () => {
    const { input, world, player } = createPlayerHarness(1.5, 0);
    world.addStaticBox({
      id: 'crate_1',
      minX: -1.0,
      minY: 0,
      minZ: -0.54,
      maxX: 1.0,
      maxY: 0.92,
      maxZ: 0.54,
      layer: COLLISION_LAYER.COVER,
      tag: 'supply_crate',
    });

    // Approach forward (-Z) and trigger jump
    input.setVirtualMoveAxes(1.0, 0);
    input.setVirtualActionState('jump', true);
    player.update(1 / 60, input, world, false, 1.0, 1.0, false);
    input.endFrame();

    expect(player.isVaulting).toBe(true);
    expect(player.getLastVaultProbe().mode).toBe('vault_over');
    expect(player.getMovementTelemetry('M416-V', 0, 'READY', 0).stance).toBe('vaulting');
    expect(player.getPhysicsInspectorRow().physicalState).toBe('VAULTING');

    input.setVirtualActionState('jump', false);
    stepSimulation(player, input, world, 32, 1 / 60);

    expect(player.isVaulting).toBe(false);
    expect(player.position.z).toBeLessThan(-0.95);
    expect(player.position.y).toBeCloseTo(0, 2);
    expect(player.isCrouching).toBe(false);
    expect(player.grounded).toBe(true);

    // WeaponSystem suppresses ADS and firing during vaulting and resumes after completion
    const harness2 = createPlayerHarness(1.5, 0);
    harness2.world.addStaticBox({
      id: 'crate_ws',
      minX: -1.0,
      minY: 0,
      minZ: -0.54,
      maxX: 1.0,
      maxY: 0.92,
      maxZ: 0.54,
      layer: COLLISION_LAYER.COVER,
      tag: 'supply_crate',
    });
    const scene = new THREE.Scene();
    const vmScene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    const vfx = new VFXPool(scene, harness2.rm);
    const proj = new ProjectileManager(scene, harness2.rm, vfx, harness2.audio);
    const weapons = new WeaponSystem(vmScene, harness2.audio, vfx, proj);
    weapons.resetLoadout('assault_rifle');
    harness2.input.setVirtualMoveAxes(1.0, 0);
    harness2.input.setVirtualActionState('jump', true);
    harness2.input.setVirtualActionState('ads', true);
    harness2.input.setVirtualActionState('fire', true);
    harness2.player.update(1 / 60, harness2.input, harness2.world, false, 1.0, 1.0, false);
    expect(harness2.player.isVaulting).toBe(true);
    weapons.update(1 / 60, harness2.input, harness2.player, cam, harness2.world, [], [], () => {}, false);
    harness2.input.endFrame();
    expect(weapons.isAds).toBe(false);
    expect(weapons.shotsFired).toBe(0);

    harness2.input.setVirtualActionState('jump', false);
    for (let i = 0; i < 32; i++) {
      harness2.player.update(1 / 60, harness2.input, harness2.world, weapons.isAds, 1.0, 1.0, false);
      weapons.update(1 / 60, harness2.input, harness2.player, cam, harness2.world, [], [], () => {}, false);
      harness2.input.endFrame();
    }
    expect(harness2.player.isVaulting).toBe(false);
    expect(weapons.shotsFired).toBeGreaterThan(0);
    weapons.dispose();
    harness2.rm.disposeAll();
  });

  it('vaults through a 1.12m building window sill under a 2.45m lintel and rejects a tight 2.00m lintel', () => {
    // 1. Valid 1.33m window opening (1.12m sill .. 2.45m lintel)
    {
      const { input, world, player } = createPlayerHarness(1.1, 0);
      world.addStaticBox({
        id: 'bldg_wall_L',
        minX: -4.0,
        minY: 0,
        minZ: -0.25,
        maxX: -1.5,
        maxY: 4.0,
        maxZ: 0.25,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_wall',
      });
      world.addStaticBox({
        id: 'bldg_wall_R',
        minX: 1.5,
        minY: 0,
        minZ: -0.25,
        maxX: 4.0,
        maxY: 4.0,
        maxZ: 0.25,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_wall',
      });
      world.addStaticBox({
        id: 'bldg_window_sill',
        minX: -1.5,
        minY: 0,
        minZ: -0.25,
        maxX: 1.5,
        maxY: 1.12,
        maxZ: 0.25,
        layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.WINDOW_SILL,
        tag: 'building_window_sill',
      });
      world.addStaticBox({
        id: 'bldg_window_lintel',
        minX: -1.5,
        minY: 2.45,
        minZ: -0.25,
        maxX: 1.5,
        maxY: 4.0,
        maxZ: 0.25,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_window_lintel',
      });

      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      input.endFrame();

      expect(player.isVaulting).toBe(true);
      input.setVirtualActionState('jump', false);
      stepSimulation(player, input, world, 36, 1 / 60);

      expect(player.isVaulting).toBe(false);
      expect(player.position.z).toBeLessThan(-0.7);
      expect(player.position.y).toBeCloseTo(0, 2);
      expect(player.isCrouching).toBe(false);
    }

    // 2. Too-tight 0.88m window opening (1.12m sill .. 2.00m lintel < 1.15m tucked capsule) -> MUST reject
    {
      const { input, world, player } = createPlayerHarness(1.1, 0);
      world.addStaticBox({
        id: 'tight_sill',
        minX: -1.5,
        minY: 0,
        minZ: -0.25,
        maxX: 1.5,
        maxY: 1.12,
        maxZ: 0.25,
        layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.WINDOW_SILL,
        tag: 'building_window_sill',
      });
      world.addStaticBox({
        id: 'tight_lintel',
        minX: -1.5,
        minY: 2.0,
        minZ: -0.25,
        maxX: 1.5,
        maxY: 4.0,
        maxZ: 0.25,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_window_lintel',
      });

      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      input.endFrame();

      expect(player.canVault).toBe(false);
      expect(player.isVaulting).toBe(false);
    }
  });

  it('mantles onto top of wide (>1.85m) low platforms and supports rotated OBB cover barriers', () => {
    // 1. Wide 3.0m x 0.85m platform -> mantle_on
    {
      const { input, world, player } = createPlayerHarness(2.3, 0);
      world.addStaticBox({
        id: 'wide_deck',
        minX: -2.0,
        minY: 0,
        minZ: -1.5,
        maxX: 2.0,
        maxY: 0.85,
        maxZ: 1.5,
        layer: COLLISION_LAYER.WORLD,
        tag: 'bridge',
      });

      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      input.endFrame();

      expect(player.isVaulting).toBe(true);
      expect(player.getLastVaultProbe().mode).toBe('mantle_on');

      input.setVirtualActionState('jump', false);
      stepSimulation(player, input, world, 36, 1 / 60);

      expect(player.isVaulting).toBe(false);
      expect(player.position.y).toBeCloseTo(0.85, 2);
      expect(player.position.z).toBeLessThan(1.4);
      expect(player.grounded).toBe(true);
    }

    // 2. Rotated OBB barrier (yaw = -PI/4 so local broad face faces +X/+Z toward player at (+1, +1))
    {
      const { input, world, player } = createPlayerHarness(0, Math.PI / 4);
      // Place player at (+0.95, 0, +0.95) facing (-0.707, 0, -0.707) perpendicular to OBB face
      player.spawn(0.95, 1.65, 0.95, Math.PI / 4);
      world.addStaticBox({
        id: 'obb_barrier',
        minX: -1.8,
        minY: 0,
        minZ: -1.8,
        maxX: 1.8,
        maxY: 0.95,
        maxZ: 1.8,
        yaw: -Math.PI / 4,
        centerX: 0,
        centerZ: 0,
        halfExtX: 1.5,
        halfExtZ: 0.35,
        layer: COLLISION_LAYER.COVER,
        tag: 'cover_barrier',
      });

      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      input.endFrame();

      expect(player.isVaulting).toBe(true);
      input.setVirtualActionState('jump', false);
      stepSimulation(player, input, world, 36, 1 / 60);

      expect(player.isVaulting).toBe(false);
      expect(player.position.x).toBeLessThan(-0.4);
      expect(player.position.z).toBeLessThan(-0.4);
      expect(player.position.y).toBeCloseTo(0, 2);
    }
  });

  it('rejects obstacles outside [0.46m, 1.15m], vehicles, sideways/stationary jumps, deep drops, and blocked landings', () => {
    // Below min height (0.40m)
    {
      const { input, world, player } = createPlayerHarness(1.3, 0);
      world.addStaticBox({
        id: 'low_curb',
        minX: -1,
        minY: 0,
        minZ: -0.4,
        maxX: 1,
        maxY: 0.4,
        maxZ: 0.4,
        layer: COLLISION_LAYER.WORLD,
        tag: 'prop',
      });
      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      expect(player.isVaulting).toBe(false);
    }

    // Intact 1.45m barrier -> rejected; damaged to 0.9425m -> accepted
    {
      const { input, world, player } = createPlayerHarness(1.3, 0);
      const barrier = {
        id: 'destructible_barrier',
        minX: -1.5,
        minY: 0,
        minZ: -0.35,
        maxX: 1.5,
        maxY: 1.45,
        maxZ: 0.35,
        layer: COLLISION_LAYER.COVER | COLLISION_LAYER.DESTRUCTIBLE,
        tag: 'destructible' as const,
      };
      world.addStaticBox(barrier);
      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      input.endFrame();
      expect(player.isVaulting).toBe(false);
      input.setVirtualActionState('jump', false);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      input.endFrame();

      // Damage barrier to 65% height (0.9425m)
      player.spawn(0, 1.65, 1.3, 0);
      barrier.maxY = 1.45 * 0.65;
      world.physicsWorld.updateCollider(barrier);

      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      expect(player.isVaulting).toBe(true);
    }

    // Blocked landing behind 0.9m crate
    {
      const { input, world, player } = createPlayerHarness(1.3, 0);
      world.addStaticBox({
        id: 'crate_front',
        minX: -1.2,
        minY: 0,
        minZ: -0.4,
        maxX: 1.2,
        maxY: 0.9,
        maxZ: 0.4,
        layer: COLLISION_LAYER.COVER,
        tag: 'supply_crate',
      });
      world.addStaticBox({
        id: 'wall_behind',
        minX: -2.0,
        minY: 0,
        minZ: -1.6,
        maxX: 2.0,
        maxY: 4.0,
        maxZ: -0.7,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_wall',
      });
      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      expect(player.canVault).toBe(false);
      expect(player.isVaulting).toBe(false);
    }

    // Stationary jump behind cover (axes.forward === 0) must jump vertically, NOT vault into enemy fire
    {
      const { input, world, player } = createPlayerHarness(1.3, 0);
      world.addStaticBox({
        id: 'cover_1',
        minX: -1.2,
        minY: 0,
        minZ: -0.4,
        maxX: 1.2,
        maxY: 0.92,
        maxZ: 0.4,
        layer: COLLISION_LAYER.COVER,
        tag: 'cover_barrier',
      });
      input.setVirtualMoveAxes(0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      expect(player.canVault).toBe(true);
      expect(player.isVaulting).toBe(false);
      expect(player.velocity.y).toBeGreaterThan(5);
    }

    // Sideways strafe along face must NOT vault
    {
      const { input, world, player } = createPlayerHarness(1.3, 0);
      world.addStaticBox({
        id: 'cover_side',
        minX: -2.0,
        minY: 0,
        minZ: -0.4,
        maxX: 2.0,
        maxY: 0.92,
        maxZ: 0.4,
        layer: COLLISION_LAYER.COVER,
        tag: 'cover_barrier',
      });
      input.setVirtualMoveAxes(0, 1.0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      expect(player.isVaulting).toBe(false);
    }

    // Deep drop (> 2.2m) & vehicle collider exclusion
    {
      const { input, world, player } = createPlayerHarness(1.3, 0);
      world.setTerrainHeightFn((_x, z) => (z < 0 ? -3.0 : 0));
      world.addStaticBox({
        id: 'cliff_rail',
        minX: -1.5,
        minY: 0,
        minZ: -0.3,
        maxX: 1.5,
        maxY: 0.95,
        maxZ: 0.3,
        layer: COLLISION_LAYER.COVER,
        tag: 'cover_barrier',
      });
      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      expect(player.isVaulting).toBe(false);

      // Vehicle layer excluded
      const vWorld = new CollisionWorld();
      player.spawn(0, 1.65, 1.3, 0);
      vWorld.addStaticBox({
        id: 'veh_1',
        minX: -1.0,
        minY: 0,
        minZ: -0.5,
        maxX: 1.0,
        maxY: 1.0,
        maxZ: 0.5,
        layer: COLLISION_LAYER.VEHICLE,
        tag: 'vehicle',
      });
      player.update(1 / 60, input, vWorld, false, 1.0, 1.0, false);
      expect(player.isVaulting).toBe(false);
    }
  });

  it('aborts safely on unexpected mid-vault obstruction, death, backward pull, and lands crouched under a 1.45m ceiling', () => {
    // 1. Mid-vault dynamic wall prevents tunneling and cleanly aborts
    {
      const { input, world, player } = createPlayerHarness(1.4, 0);
      world.addStaticBox({
        id: 'crate_v',
        minX: -1.2,
        minY: 0,
        minZ: -0.4,
        maxX: 1.2,
        maxY: 0.9,
        maxZ: 0.4,
        layer: COLLISION_LAYER.COVER,
        tag: 'supply_crate',
      });
      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      input.endFrame();
      expect(player.isVaulting).toBe(true);

      input.setVirtualActionState('jump', false);
      stepSimulation(player, input, world, 10, 1 / 60);

      // Spawn a solid barrier directly at exit edge mid-vault
      world.addStaticBox({
        id: 'surprise_wall',
        minX: -2.0,
        minY: 0,
        minZ: -0.85,
        maxX: 2.0,
        maxY: 4.0,
        maxZ: -0.45,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_wall',
      });

      stepSimulation(player, input, world, 15, 1 / 60);
      expect(player.isVaulting).toBe(false);
      // Player must NOT tunnel past z = -0.85 + radius
      expect(player.position.z).toBeGreaterThan(-0.85);
    }

    // 2. Death mid-vault cancels vault cleanly
    {
      const { input, world, player } = createPlayerHarness(1.4, 0);
      world.addStaticBox({
        id: 'crate_death',
        minX: -1.2,
        minY: 0,
        minZ: -0.4,
        maxX: 1.2,
        maxY: 0.9,
        maxZ: 0.4,
        layer: COLLISION_LAYER.COVER,
        tag: 'supply_crate',
      });
      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      expect(player.isVaulting).toBe(true);

      player.applyDamage(500, 0, -10);
      expect(player.alive).toBe(false);
      expect(player.isVaulting).toBe(false);
    }

    // 3. Backward pull during early Phase 1 aborts vault
    {
      const { input, world, player } = createPlayerHarness(1.4, 0);
      world.addStaticBox({
        id: 'crate_cancel',
        minX: -1.2,
        minY: 0,
        minZ: -0.4,
        maxX: 1.2,
        maxY: 0.9,
        maxZ: 0.4,
        layer: COLLISION_LAYER.COVER,
        tag: 'supply_crate',
      });
      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      input.endFrame();
      expect(player.isVaulting).toBe(true);

      input.setVirtualActionState('jump', false);
      input.setVirtualMoveAxes(-1.0, 0);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      expect(player.isVaulting).toBe(false);
    }

    // 4. Low ceiling (1.45m) over landing side -> lands crouched and cannot stand until clear
    {
      const { input, world, player } = createPlayerHarness(1.4, 0);
      world.addStaticBox({
        id: 'crate_low_ceil',
        minX: -1.2,
        minY: 0,
        minZ: -0.4,
        maxX: 1.2,
        maxY: 0.52,
        maxZ: 0.4,
        layer: COLLISION_LAYER.COVER,
        tag: 'supply_crate',
      });
      world.addStaticBox({
        id: 'low_overhang',
        minX: -2.0,
        minY: 1.45,
        minZ: -3.5,
        maxX: 2.0,
        maxY: 3.0,
        maxZ: -1.45,
        layer: COLLISION_LAYER.WORLD,
        tag: 'building_ceiling',
      });

      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      input.endFrame();
      expect(player.isVaulting).toBe(true);

      input.setVirtualActionState('jump', false);
      stepSimulation(player, input, world, 36, 1 / 60);

      expect(player.isVaulting).toBe(false);
      expect(player.isCrouching).toBe(true);
      expect(player.position.z).toBeLessThan(-0.8);
      expect(player.position.y).toBeCloseTo(0, 2);
    }
  });

  it('executes deterministically across 30Hz, 60Hz, and 120Hz framerates and drives damped landing camera spring', () => {
    const landingPositions: number[] = [];
    for (const hz of [30, 60, 120]) {
      const { input, world, player } = createPlayerHarness(1.45, 0);
      world.addStaticBox({
        id: 'det_crate',
        minX: -1.0,
        minY: 0,
        minZ: -0.45,
        maxX: 1.0,
        maxY: 0.92,
        maxZ: 0.45,
        layer: COLLISION_LAYER.COVER,
        tag: 'supply_crate',
      });

      const dt = 1 / hz;
      input.setVirtualMoveAxes(1.0, 0);
      input.setVirtualActionState('jump', true);
      player.update(dt, input, world, false, 1.0, 1.0, false);
      input.endFrame();
      expect(player.isVaulting).toBe(true);

      input.setVirtualActionState('jump', false);
      const maxSteps = Math.ceil(0.8 * hz);
      let completed = false;
      for (let s = 0; s < maxSteps; s++) {
        player.update(dt, input, world, false, 1.0, 1.0, false);
        input.endFrame();
        if (!player.isVaulting) {
          completed = true;
          landingPositions.push(player.position.z);
          break;
        }
      }
      expect(completed).toBe(true);
    }

    // Final Z across 30/60/120Hz agrees within 5cm
    expect(Math.abs(landingPositions[0] - landingPositions[1])).toBeLessThan(0.05);
    expect(Math.abs(landingPositions[1] - landingPositions[2])).toBeLessThan(0.05);

    // Verify second-order damped landing spring compression + rebound on fall landing
    const { input, world, player } = createPlayerHarness(0, 0);
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    player.position.set(0, 2.2, 0);
    player.grounded = false;
    let minSpring = 0;
    for (let i = 0; i < 40; i++) {
      player.update(1 / 60, input, world, false, 1.0, 1.0, false);
      player.syncCamera(cam, 75, 55, false, 1 / 60);
      input.endFrame();
      minSpring = Math.min(minSpring, player.getLandingSpringOffset());
    }

    expect(player.grounded).toBe(true);
    expect(minSpring).toBeLessThan(-0.02);

    // Rebounds back near zero within ~0.6s
    stepSimulation(player, input, world, 40, 1 / 60);
    expect(Math.abs(player.getLandingSpringOffset())).toBeLessThan(0.005);
  });

  it('surfaces contextual VAULT prompts in both Desktop HUD and Mobile jump button without altering touch layout', () => {
    const rm = new ResourceManager();
    const input = new InputManager(rm, settingsStore.getState().input);
    const hud = {
      ...gameSessionStore.getState().hud,
      inVehicle: false,
      canVault: true,
      interactPrompt: null,
    };

    // Desktop HUD prompt & Mobile VAULT button cue
    render(
      React.createElement(GameHUD, {
        inputManager: input,
        touchControlsVisible: false,
        onRequestPointerLock: () => {},
      })
    );
    act(() => {
      gameSessionStore.getState().updateHudSnapshot(hud);
    });
    expect(screen.getByTestId('hud-vault-prompt').textContent).toContain('VAULT');

    render(React.createElement(MobileTouchControls, { inputManager: input, hud }));

    const jumpBtn = screen.getByTestId('touch-btn-jump');
    expect(jumpBtn.getAttribute('aria-label')).toBe('Vault Obstacle');
    expect(jumpBtn.textContent).toContain('VAULT');
  });
});
