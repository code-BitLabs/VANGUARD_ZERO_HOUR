import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { MISSION_CATALOG } from '@/src/data/missions';
import { VFXPool } from '@/src/effects/VFXPool';
import { ExplosiveManager } from '@/src/gameplay/ExplosiveManager';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { TacticalGuidanceSystem } from '@/src/gameplay/TacticalGuidanceSystem';
import { VehicleManager } from '@/src/gameplay/VehicleManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { AudioSettingsSchema } from '@/src/schemas/settings.schema';
import { resolveBottomCenterPromptSlot } from '@/src/ui/hud/HudSlices';
import { DestructionSystem } from '@/src/world/DestructionSystem';
import { buildWorldMap } from '@/src/world/MapBuilder';
import { WorldChunkManager } from '@/src/world/WorldChunkManager';

describe('Mission 2 & Core Gameplay Abnormalities Regression Suite', () => {
  it('hides the 3D C4 wireframe preview while holding regular firearms and shows it only when priming C4', () => {
    const scene = new THREE.Scene();
    const res = new ResourceManager();
    const audio = new AudioManager(res, AudioSettingsSchema.parse({ muted: true }));
    const vfx = new VFXPool(scene, res);
    const collision = new CollisionWorld();
    const projectiles = new ProjectileManager(scene, res, vfx, audio);
    const vehicles = new VehicleManager(scene, res, vfx, audio);
    const explosives = new ExplosiveManager(scene, res, vfx, audio, projectiles);

    collision.addStaticBox({
      id: 'test_wall',
      minX: -5,
      minY: 0,
      minZ: -3,
      maxX: 5,
      maxY: 4,
      maxZ: -2,
      layer: COLLISION_LAYER.WORLD,
    });

    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    cam.position.set(0, 1.6, 0);
    cam.lookAt(0, 1.6, -2);
    cam.updateMatrixWorld();

    // Default state (holding firearm, not priming C4): preview wireframe MUST stay hidden
    explosives.updatePreview(cam, collision, false);
    expect(explosives.isC4Priming()).toBe(false);
    expect(explosives.isPreviewVisible()).toBe(false);

    // Explicit C4 priming mode: wireframe snaps onto valid surface within 4.5m
    explosives.setC4Priming(true);
    explosives.updatePreview(cam, collision, false);
    expect(explosives.isPreviewVisible()).toBe(true);

    // Releasing priming hides wireframe immediately
    explosives.setC4Priming(false);
    expect(explosives.isPreviewVisible()).toBe(false);

    // Placing via handleC4Action still works cleanly and keeps wireframe hidden afterwards
    const actionRes = explosives.handleC4Action(cam, collision, vehicles, 'mission:2');
    expect(actionRes).toBe('placed');
    expect(explosives.getActiveC4Count()).toBe(1);
    expect(explosives.isPreviewVisible()).toBe(false);
  });

  it('builds switchback watchtower top-bridge guardrails, smoothstep desert terrain, clear fuel yard, and unobstructed convoy highway', () => {
    const scene = new THREE.Scene();
    const res = new ResourceManager();
    const assets = new AssetManager(res);
    const collision = new CollisionWorld();
    const chunks = new WorldChunkManager();
    const destruction = new DestructionSystem(collision.physicsWorld, {} as never, {} as never);

    const built = buildWorldMap(
      'desert_base',
      2,
      scene,
      assets,
      res,
      collision,
      chunks,
      destruction
    );

    // 1. Switchback watchtower guardrails exist on every desert watchtower top bridge & mid landing
    const allColliders = collision.spatialHash.queryAABB(
      -160,
      -160,
      160,
      160,
      COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      []
    );
    const stairRails = allColliders.filter((c) => c.id.includes('_top_rail_') || c.id.includes('_mid_rail_'));
    expect(stairRails.length).toBeGreaterThanOrEqual(20); // 4 towers x 5 rails (3 mid + 2 top)
    expect(allColliders.some((c) => c.id === 'tower_-24_14_stair_top_rail_back')).toBe(true);
    expect(allColliders.some((c) => c.id === 'tower_-24_14_stair_top_rail_outer')).toBe(true);

    // 2. Smoothstep desert terrain: zero cliff jumps across |x| = 11..23
    for (let x = 11; x <= 23; x += 0.5) {
      const yA = collision.getTerrainHeightOnly(x, -10);
      const yB = collision.getTerrainHeightOnly(x + 0.5, -10);
      expect(Math.abs(yB - yA)).toBeLessThan(0.18);
    }

    // 3. Fuel tanks are completely clear of bunker_1 (x in [21, 35], z in [-42, -30])
    const fuelTanks = destruction.getAll().filter((d) => d.kind === 'fuel_tank');
    expect(fuelTanks.length).toBe(3);
    for (const tank of fuelTanks) {
      const overlapsBunker1 =
        tank.collider.maxX > 21 &&
        tank.collider.minX < 35 &&
        tank.collider.maxZ > -42 &&
        tank.collider.minZ < -30;
      expect(overlapsBunker1).toBe(false);
    }

    // 4. Highway 14 centerline has no concrete cover_barrier blockers obstructing convoy lanes
    const centerHighwayBarriers = allColliders.filter(
      (c) =>
        c.tag === 'cover_barrier' &&
        c.minX < 5 &&
        c.maxX > -5 &&
        c.minZ > -32 &&
        c.maxZ < 32
    );
    expect(centerHighwayBarriers.length).toBe(0);
    expect(built.roadWaypoints.length).toBe(6);
  });

  it('dynamically tracks the nearest live convoy vehicle for the convoy_intercept objective marker', () => {
    const mission2 = MISSION_CATALOG.find((m) => m.id === 2)!;
    const director = new MissionDirector(mission2, 'normal');
    const scene = new THREE.Scene();
    const res = new ResourceManager();
    const audio = new AudioManager(res, AudioSettingsSchema.parse({ muted: true }));
    const vfx = new VFXPool(scene, res);
    const collision = new CollisionWorld();
    const vehicles = new VehicleManager(scene, res, vfx, audio);

    const v1 = vehicles.spawnVehicle('enemy_apc', { x: 4, y: 0, z: 22 }, 0, true, true, collision, 'mission:2');
    const v2 = vehicles.spawnVehicle('enemy_technical', { x: -4, y: 0, z: -20 }, Math.PI, true, true, collision, 'mission:2');

    const playerPos = new THREE.Vector3(0, 1.7, 30);
    const nearest1 = vehicles.getNearestConvoyTargetPosition(playerPos);
    expect(nearest1).not.toBeNull();
    expect(nearest1!.x).toBeCloseTo(4, 1);
    expect(nearest1!.z).toBeCloseTo(22, 1);

    director.updateObjectiveMarkerPosition('convoy_intercept', nearest1!.x, nearest1!.y, nearest1!.z);
    let convoyObj = director.getObjectiveStatuses().find((o) => o.type === 'convoy_intercept')!;
    expect(convoyObj.markerPos?.z).toBeCloseTo(22, 1);

    // Destroy nearer convoy vehicle -> marker switches to surviving technical at z = -20
    v1.alive = false;
    const nearest2 = vehicles.getNearestConvoyTargetPosition(playerPos);
    expect(nearest2).not.toBeNull();
    expect(nearest2!.x).toBeCloseTo(v2.position.x, 1);
    expect(nearest2!.z).toBeCloseTo(v2.position.z, 1);

    director.updateObjectiveMarkerPosition('convoy_intercept', nearest2!.x, nearest2!.y, nearest2!.z);
    convoyObj = director.getObjectiveStatuses().find((o) => o.type === 'convoy_intercept')!;
    expect(convoyObj.markerPos?.z).toBeCloseTo(-20, 1);
  });

  it('invalidates tactical_sabotage_near immediately out of range and arbitrates bottom-center prompts into a single slot', () => {
    const guidance = new TacticalGuidanceSystem();
    const baseCtx = {
      nowSec: 10,
      controlScheme: 'desktop_kb_mouse' as const,
      tacticalHintsEnabled: true,
      isIntenseCombat: false,
      isPlayerDowned: false,
      isNukeActive: false,
      healthPct: 0.9,
      magazineAmmo: 25,
      reserveAmmo: 90,
      isReloading: false,
      isNearDemolitionCache: false,
      isNearSabotageTarget: true,
      isNearVehicle: false,
      isInsideVehicle: false,
      hasActiveAirObjective: false,
      hasEquippedStingerOrRpg: false,
      hasC4Available: true,
      isPlantChargeStageActive: false,
      extractionStatus: 'not_applicable' as const,
      extractionBlockReason: null,
      isPlayerNearExtraction: false,
      activeObjectiveType: 'destroy_targets',
      hasPrimaryInteractPrompt: false,
    };

    const nearHint = guidance.evaluateTier1Hint(baseCtx);
    expect(nearHint?.id).toBe('tactical_sabotage_near');

    // Leaving range clears sabotage hint immediately even during intense combat
    const leftRangeHint = guidance.evaluateTier1Hint({
      ...baseCtx,
      nowSec: 10.5,
      isIntenseCombat: true,
      isNearSabotageTarget: false,
    });
    expect(leftRangeHint).toBeNull();

    // Single-slot HUD prompt arbitration: Critical > Interact (with inline swap) > Field Swap > Hint
    const criticalSlot = resolveBottomCenterPromptSlot({
      downedActive: false,
      fieldSwapOpen: false,
      compactHud: false,
      inVehicle: false,
      canVault: true,
      interactPrompt: '[E] Resupply Ammo',
      nearSupplySwapStation: true,
      canOpenFieldSwap: true,
      activeTacticalHint: {
        id: 'critical_find_cover',
        tier: 1,
        priority: 'critical',
        text: 'LOW HEALTH',
        dismissible: false,
      },
    });
    expect(criticalSlot.kind).toBe('critical_hint');

    const interactWithSwap = resolveBottomCenterPromptSlot({
      downedActive: false,
      fieldSwapOpen: false,
      compactHud: false,
      inVehicle: false,
      canVault: false,
      interactPrompt: '[E] Resupply Ammo',
      nearSupplySwapStation: true,
      canOpenFieldSwap: true,
      activeTacticalHint: {
        id: 'tactical_sabotage_near',
        tier: 1,
        priority: 'tactical',
        text: 'TARGET IN RANGE',
        dismissible: true,
      },
    });
    expect(interactWithSwap.kind).toBe('interact');
    if (interactWithSwap.kind === 'interact') {
      expect(interactWithSwap.showInlineFieldSwap).toBe(true);
    }

    // Drawer open pauses all bottom-center prompts cleanly
    const drawerOpenSlot = resolveBottomCenterPromptSlot({
      downedActive: false,
      fieldSwapOpen: true,
      compactHud: false,
      inVehicle: false,
      canVault: false,
      interactPrompt: '[E] Resupply Ammo',
      nearSupplySwapStation: true,
      canOpenFieldSwap: true,
      activeTacticalHint: null,
    });
    expect(drawerOpenSlot.kind).toBe('none');
  });
});
