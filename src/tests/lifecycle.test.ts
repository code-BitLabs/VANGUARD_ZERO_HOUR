import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ObjectPool } from '@/src/core/ObjectPool';
import { ResourceManager } from '@/src/core/ResourceManager';
import { CollisionWorld, RayHit } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER, SpatialHash } from '@/src/physics/SpatialHash';

describe('Engine Lifecycle, Pooling & Spatial Physics', () => {
  it('tracks 3-scope ref counts, aborts pending loads, and leaks zero mission resources across transitions', () => {
    const rm = new ResourceManager();
    const sharedDispose = vi.fn();
    const missionDispose = vi.fn();

    rm.register('material', 'shared', sharedDispose, 'shared_steel');
    rm.retain('shared_steel');
    rm.recordBaseline();

    // Simulate 3 consecutive mission load/unload cycles
    for (let m = 1; m <= 3; m++) {
      const scope = `mission:${m}` as const;
      const ctrl = rm.createAbortController(scope);
      rm.register('geometry', scope, missionDispose);
      expect(ctrl.signal.aborted).toBe(false);

      rm.unloadScope(scope);
      expect(ctrl.signal.aborted).toBe(true);

      const delta = rm.auditTransitionDelta();
      expect(delta.hasMissionLeak).toBe(false);
      expect(delta.missionRemaining).toBe(0);
      expect(delta.sharedDelta).toBe(0);
    }

    expect(missionDispose).toHaveBeenCalledTimes(3);
    expect(sharedDispose).not.toHaveBeenCalled();

    // Release shared resource only when refCount drops to 0
    rm.release('shared_steel');
    expect(sharedDispose).not.toHaveBeenCalled();
    rm.release('shared_steel');
    expect(sharedDispose).toHaveBeenCalledTimes(1);
  });

  it('enforces fixed-capacity ring eviction in ObjectPool without unbounded growth', () => {
    const recycled: number[] = [];
    const pool = new ObjectPool(
      3,
      (idx) => ({ id: idx, active: false, reset() {} }),
      (item) => recycled.push(item.id)
    );

    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    expect(pool.getActiveCount()).toBe(3);

    // 4th acquire evicts oldest active slot (a)
    const d = pool.acquire();
    expect(d.id).toBe(a.id);
    expect(pool.getActiveCount()).toBe(3);
    expect(recycled).toEqual([0]);

    pool.release(b);
    pool.release(c);
    pool.release(d);
    expect(pool.getActiveCount()).toBe(0);
  });

  it('performs broadphase SpatialHash queries and CollisionWorld sweptSegmentTest accurately', () => {
    const hash = new SpatialHash(8);
    const wall = {
      id: 'wall_1',
      minX: -2,
      minY: 0,
      minZ: -12,
      maxX: 2,
      maxY: 4,
      maxZ: -10,
      layer: COLLISION_LAYER.WORLD,
    };
    hash.insert(wall);

    const out: typeof wall[] = [];
    hash.queryAABB(-3, -15, 3, -8, COLLISION_LAYER.WORLD, out);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('wall_1');

    const world = new CollisionWorld();
    world.addStaticBox(wall);
    const hit: RayHit = {
      hit: false,
      distance: 0,
      pointX: 0,
      pointY: 0,
      pointZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      collider: null,
    };
    const didHit = world.sweptSegmentTest(0, 1.5, 0, 0, 0, -1, 30, COLLISION_LAYER.WORLD, hit);
    expect(didHit).toBe(true);
    expect(hit.distance).toBeCloseTo(10, 2);
    expect(hit.collider?.id).toBe('wall_1');

    // Also verify capsule pushback keeps player outside wall
    const pos = new THREE.Vector3(0, 0, -9.8);
    const vel = new THREE.Vector3(0, 0, -4);
    world.resolvePlayerCapsule(pos, vel, 0.45, 1.8, 0.48, 1 / 60);
    expect(pos.z).toBeGreaterThanOrEqual(-10 + 0.44);
  });

  it('tracks MissionDirector objectives, S-rank grading, and PlayerController armor absorption', async () => {
    const { MISSION_CATALOG } = await import('@/src/data/missions');
    const { MissionDirector } = await import('@/src/gameplay/MissionDirector');
    const { PlayerController } = await import('@/src/gameplay/PlayerController');
    const { AudioManager } = await import('@/src/audio/AudioManager');
    const { SettingsBundleSchema } = await import('@/src/schemas/settings.schema');

    const rm = new ResourceManager();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const player = new PlayerController(audio);
    player.spawn(0, 1.7, 0);

    player.applyDamage(20, 0, -10);
    // Armor absorbs 55% (11), health takes 45% (9)
    expect(player.armor).toBeCloseTo(89, 1);
    expect(player.health).toBeCloseTo(91, 1);

    const mission1 = MISSION_CATALOG[0];
    const dir = new MissionDirector(mission1, 'hard');
    for (let i = 0; i < 10; i++) dir.onEnemyKilled(i < 5, 150);
    dir.onDestructibleTargetDestroyed(300);
    dir.onDestructibleTargetDestroyed(300);
    dir.onAirUnitKilled(350);

    const tick = dir.update(15, player.health, player.armor);
    expect(tick.finished).toBe(true);
    expect(tick.victory).toBe(true);

    const summary = dir.buildSummary(true);
    expect(summary.grade).toBe('S');
    expect(summary.kills).toBe(11);
    expect(summary.headshots).toBe(5);
    expect(summary.airKills).toBe(1);
    rm.disposeAll();
  });

  it('transitions EngineLifecycle cleanly across deploy, pause, restart, debrief, retry, and unload without ignored events', async () => {
    const { createActor } = await import('xstate');
    const { engineLifecycleMachine } = await import('@/src/engine/EngineLifecycle');

    const actor = createActor(engineLifecycleMachine);
    actor.start();
    expect(actor.getSnapshot().value).toBe('boot');

    actor.send({ type: 'READY' });
    expect(actor.getSnapshot().value).toBe('menu');

    // Initial deploy
    actor.send({ type: 'SELECT_MISSION', missionId: 1 });
    expect(actor.getSnapshot().value).toBe('preloading');
    actor.send({ type: 'ASSETS_LOADED' });
    expect(actor.getSnapshot().value).toBe('initializingWorld');
    actor.send({ type: 'WORLD_READY' });
    expect(actor.getSnapshot().value).toBe('playing');

    // Pause -> Restart Mission -> Playing
    actor.send({ type: 'PAUSE' });
    expect(actor.getSnapshot().value).toBe('paused');
    actor.send({ type: 'RESTART_MISSION' });
    expect(actor.getSnapshot().value).toBe('playing');

    // Mission End -> Debrief -> Retry (SELECT_MISSION directly from debrief!)
    actor.send({ type: 'MISSION_ENDED' });
    expect(actor.getSnapshot().value).toBe('debrief');
    actor.send({ type: 'SELECT_MISSION', missionId: 1 });
    expect(actor.getSnapshot().value).toBe('preloading');
    actor.send({ type: 'ASSETS_LOADED' });
    actor.send({ type: 'WORLD_READY' });
    expect(actor.getSnapshot().value).toBe('playing');

    // Unload from playing -> menu
    actor.send({ type: 'UNLOAD' });
    expect(actor.getSnapshot().value).toBe('unloading');
    actor.send({ type: 'UNLOADED' });
    expect(actor.getSnapshot().value).toBe('menu');
    actor.stop();
  });

  it('decouples plant_charge from destroy_targets, enforces extraction prerequisites with HUD feedback, and propagates objective metadata', async () => {
    const { getMissionById } = await import('@/src/data/missions');
    const { MissionDirector } = await import('@/src/gameplay/MissionDirector');

    // Mission 4 has plant_charge ('obj_jungle_cache'); destroying a radar_relay must NOT advance plant_charge
    const m4 = getMissionById(4);
    const dir4 = new MissionDirector(m4, 'normal');
    dir4.onDestructibleTargetDestroyed(300, 'radar_relay');
    const statusesAfterRadar = dir4.getObjectiveStatuses();
    const cacheObj = statusesAfterRadar.find((o) => o.id === 'obj_jungle_cache')!;
    expect(cacheObj.current).toBe(0);
    expect(cacheObj.description).toBeTruthy();
    expect(cacheObj.markerPos).toBeDefined();

    // Destroying a weapons_cache DOES advance plant_charge
    dir4.onDestructibleTargetDestroyed(300, 'weapons_cache');
    expect(dir4.getObjectiveStatuses().find((o) => o.id === 'obj_jungle_cache')!.current).toBe(1);

    // Mission 5 has vehicle_extract ('obj_ind_extract'); reaching extraction early must return false and emit a lock alert
    const m5 = getMissionById(5);
    const dir5 = new MissionDirector(m5, 'normal');
    expect(dir5.onExtractionReached()).toBe(false);
    expect(dir5.alertText).toContain('EXTRACTION LOCKED');

    // Complete prerequisites on Mission 5 (3 vats, 12 enemies, 1 gunship), then reach extraction -> succeeds
    for (let i = 0; i < 3; i++) dir5.onDestructibleTargetDestroyed(300, 'fuel_tank');
    for (let i = 0; i < 12; i++) dir5.onEnemyKilled(false, 100);
    dir5.onAirUnitKilled(300);
    expect(dir5.onExtractionReached()).toBe(true);
    expect(dir5.getObjectiveStatuses().find((o) => o.id === 'obj_ind_extract')!.completed).toBe(true);
  });
});
