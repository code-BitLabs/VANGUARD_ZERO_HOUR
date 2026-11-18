import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '@/src/audio/AudioManager';
import { ResourceManager } from '@/src/core/ResourceManager';
import { getMissionById, MISSION_CATALOG } from '@/src/data/missions';
import { VFXPool } from '@/src/effects/VFXPool';
import {
  clampCheckpointVitals,
  MissionAttemptContext,
  MissionCheckpointSnapshot,
  selectMissionCheckpointAnchor,
  validateSafeCheckpointSpawn,
} from '@/src/gameplay/MissionCheckpoint';
import { MissionDirector } from '@/src/gameplay/MissionDirector';
import { ProjectileManager } from '@/src/gameplay/ProjectileManager';
import { WeaponSystem } from '@/src/gameplay/WeaponSystem';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER, SpatialHash } from '@/src/physics/SpatialHash';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { createDestructibleCollider, DestructionSystem } from '@/src/world/DestructionSystem';

describe('TRN-04: Mid-Mission Checkpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves monotonic MissionAttemptContext elapsed time and checkpointDeathsCount across repeated deaths and MissionDirector reconstructions', () => {
    const mission1 = getMissionById(1);
    const attempt: MissionAttemptContext = {
      missionId: 1,
      difficulty: 'normal',
      cumulativeElapsedSec: 0,
      checkpointDeathsCount: 0,
    };

    let captured: MissionCheckpointSnapshot | null = null;
    const capture = (dir: MissionDirector) => {
      captured = {
        missionId: 1,
        difficulty: 'normal',
        checkpointSequence: dir.getCheckpointSequence(),
        activeObjectiveIndex: dir.getActiveObjectiveIndex(),
        completedObjectiveIds: dir.getCompletedObjectiveIds(),
        playerSpawn: selectMissionCheckpointAnchor(mission1, dir.getActiveObjectiveIndex()),
        healthAtCheckpoint: 42,
        armorAtCheckpoint: 15,
        activeWeaponId: 'assault_rifle',
        weaponAmmoState: { assault_rifle: { mag: 10, reserve: 40 } },
        scoreAtCheckpoint: dir.score,
        killsAtCheckpoint: dir.kills,
        headshotsAtCheckpoint: dir.headshots,
        airKillsAtCheckpoint: dir.airKills,
      };
    };

    // Attempt 1: play 45s, complete Objective 1 (10 kills)
    let dir = new MissionDirector(mission1, 'normal', attempt, undefined, () => capture(dir));
    dir.update(45, 90, 80);
    for (let i = 0; i < 10; i++) {
      dir.onEnemyKilled(i < 2, 120);
    }
    expect(captured).not.toBeNull();
    const scoreAtCp1 = captured!.scoreAtCheckpoint;
    expect(captured!.completedObjectiveIds).toEqual(['obj_city_squads']);
    expect(captured!.checkpointSequence).toBe(1);

    // Advance 30s, get 2 extra kills before dying at t = 75s
    dir.update(30, 60, 40);
    dir.onEnemyKilled(false, 120);
    dir.onEnemyKilled(false, 120);
    expect(dir.kills).toBe(12);
    expect(attempt.cumulativeElapsedSec).toBeCloseTo(75, 5);

    // Checkpoint Death #1 -> reconstruct MissionDirector from snapshot
    attempt.checkpointDeathsCount += 1;
    dir = new MissionDirector(mission1, 'normal', attempt, captured!);
    expect(dir.elapsedSec).toBeCloseTo(75, 5); // Monotonic: never rolled back
    expect(dir.getCheckpointDeathsCount()).toBe(1);
    expect(dir.kills).toBe(10); // Rolled back post-checkpoint kills
    expect(dir.score).toBe(scoreAtCp1); // No duplicate +350 objective bonus
    expect(dir.getCompletedObjectiveIds()).toEqual(['obj_city_squads']);
    expect(dir.getObjectiveStatuses()[0].completed).toBe(true);
    expect(dir.getObjectiveStatuses()[0].current).toBe(10);

    // Checkpoint Death #2 & #3 -> elapsed time keeps accumulating across deaths
    dir.update(20, 80, 60);
    attempt.checkpointDeathsCount += 1;
    dir = new MissionDirector(mission1, 'normal', attempt, captured!);
    dir.update(15, 80, 60);
    attempt.checkpointDeathsCount += 1;
    dir = new MissionDirector(mission1, 'normal', attempt, captured!);

    expect(dir.getCheckpointDeathsCount()).toBe(3);
    expect(dir.elapsedSec).toBeCloseTo(110, 5);

    // Complete remaining objectives (2 radars + 1 helicopter) and verify final summary uses cumulative time
    dir.onDestructibleTargetDestroyed(300, 'radar_relay');
    dir.onDestructibleTargetDestroyed(300, 'radar_relay');
    dir.onAirUnitKilled(350, 'helicopter');
    const finalTick = dir.update(10, 90, 70);
    expect(finalTick.finished).toBe(true);
    expect(finalTick.victory).toBe(true);

    const summary = dir.buildSummary(true);
    expect(summary.durationSec).toBe(120);
    expect(summary.kills).toBe(11);
  });

  it('clamps restored checkpoint HP to [75..100] and Armor to [50..100]', () => {
    expect(clampCheckpointVitals(12, 0)).toEqual({ health: 75, armor: 50 });
    expect(clampCheckpointVitals(75, 50)).toEqual({ health: 75, armor: 50 });
    expect(clampCheckpointVitals(88.4, 67.6)).toEqual({ health: 88, armor: 68 });
    expect(clampCheckpointVitals(140, 200)).toEqual({ health: 100, armor: 100 });
    expect(clampCheckpointVitals(Number.NaN, Number.NaN)).toEqual({ health: 75, armor: 50 });
  });

  it('validates checkpoint spawns across all 5 missions, rejects blocked/hazard zones, and falls back radially', () => {
    for (const mission of MISSION_CATALOG) {
      const cw = new CollisionWorld();
      const anchor = selectMissionCheckpointAnchor(mission, Math.min(1, mission.objectives.length - 1));
      const safe = validateSafeCheckpointSpawn(
        anchor,
        { ...mission.playerSpawn, yaw: mission.playerYaw },
        cw,
        []
      );
      expect(Math.abs(safe.x)).toBeLessThanOrEqual(100);
      expect(Math.abs(safe.z)).toBeLessThanOrEqual(100);
      expect(safe.y).toBeGreaterThanOrEqual(1.6);
    }

    // Place a solid wall at primary anchor (0, 8) and a hazard at (2.5, 8)
    const cw = new CollisionWorld();
    cw.addStaticBox({
      id: 'spawn_blocker',
      minX: -1.5,
      minY: 0,
      minZ: 6.5,
      maxX: 1.5,
      maxY: 3.0,
      maxZ: 9.5,
      layer: COLLISION_LAYER.WORLD,
    });
    const fallback = { x: 0, y: 1.7, z: 58, yaw: 0 };
    const hazards = [{ x: 2.5, z: 8 }];
    const relocated = validateSafeCheckpointSpawn(
      { x: 0, y: 1.7, z: 8, yaw: 0 },
      fallback,
      cw,
      hazards
    );
    // Must not spawn inside wall or within 8m of hazard (2.5, 8)
    expect(Math.hypot(relocated.x - 2.5, relocated.z - 8)).toBeGreaterThanOrEqual(7.99);
    expect(cw.canStandUp(new THREE.Vector3(relocated.x, 0, relocated.z), 0.45, 1.75, 'player')).toBe(
      true
    );

    // If hazard sits right on primary AND covers all 7.5m rings, falls back to mission.playerSpawn
    const fallbackForced = validateSafeCheckpointSpawn(
      { x: 0, y: 1.7, z: 8, yaw: 0 },
      fallback,
      cw,
      [{ x: 0, z: 8 }] // 7.5m radial ring is < 8.0m from (0, 8) -> forces mission fallback
    );
    expect(fallbackForced.x).toBe(0);
    expect(fallbackForced.z).toBe(58);
  });

  it('applies ammo floors strictly to mission-relevant weapons and ignores unavailable/locked weapon IDs', () => {
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const vfx = new VFXPool(new THREE.Scene(), rm);
    const proj = new ProjectileManager(new THREE.Scene(), rm, vfx, audio);
    const ws = new WeaponSystem(new THREE.Scene(), audio, vfx, proj);

    // Mission 1 has recommendedLoadout ['assault_rifle', 'sniper_rifle', 'rocket_launcher']
    // Suppose only Objective 1 ('eliminate_wave') remains incomplete (no air/armor objectives)
    const m1 = getMissionById(1);
    const snap: MissionCheckpointSnapshot = {
      missionId: 1,
      difficulty: 'normal',
      checkpointSequence: 1,
      activeObjectiveIndex: 0,
      completedObjectiveIds: [],
      playerSpawn: { x: 0, y: 1.7, z: 58, yaw: 0 },
      healthAtCheckpoint: 80,
      armorAtCheckpoint: 60,
      activeWeaponId: 'smg',
      weaponAmmoState: {
        assault_rifle: { mag: 3, reserve: 12 }, // recommended -> boosted to full mag + 50% reserve (90)
        smg: { mag: 4, reserve: 15 }, // active weapon -> boosted to full mag + 50% reserve (108)
        shotgun: { mag: 1, reserve: 4 }, // NOT recommended, NOT active -> keeps exact 1/4!
        lmg: { mag: 5, reserve: 20 }, // NOT recommended, NOT active -> keeps exact 5/20!
        pistol: { mag: 2, reserve: 6 }, // sidearm -> boosted to full mag + 50% reserve
        guided_missile: { mag: 0, reserve: 0 }, // launcher, NOT needed for eliminate_wave & not recommended -> stays 0/0!
        sniper_rifle: { mag: 1, reserve: 2 }, // recommended, but locked in availableWeaponIds test below
      },
      scoreAtCheckpoint: 0,
      killsAtCheckpoint: 0,
      headshotsAtCheckpoint: 0,
      airKillsAtCheckpoint: 0,
    };

    // Simulate sniper_rifle being locked/unavailable
    const unlockedSet = new Set<WeaponId>([
      'assault_rifle',
      'smg',
      'shotgun',
      'lmg',
      'pistol',
      'rocket_launcher',
      'guided_missile',
    ]);

    ws.restoreCheckpointLoadout(
      snap,
      m1,
      [{ type: 'eliminate_wave', actionMeta: m1.objectives[0].actionMeta }],
      unlockedSet
    );

    expect(ws.getWeaponState('assault_rifle')!.ammoInMag).toBe(30);
    expect(ws.getWeaponState('assault_rifle')!.reserveAmmo).toBeGreaterThanOrEqual(90);
    expect(ws.getWeaponState('smg')!.ammoInMag).toBe(36);
    expect(ws.getWeaponState('smg')!.reserveAmmo).toBeGreaterThanOrEqual(108);
    expect(ws.getWeaponState('shotgun')!.ammoInMag).toBe(1);
    expect(ws.getWeaponState('shotgun')!.reserveAmmo).toBe(4);
    expect(ws.getWeaponState('lmg')!.ammoInMag).toBe(5);
    expect(ws.getWeaponState('lmg')!.reserveAmmo).toBe(20);
    expect(ws.getWeaponState('guided_missile')!.ammoInMag).toBe(0);
    expect(ws.getWeaponState('guided_missile')!.reserveAmmo).toBe(0);

    // Locked sniper_rifle kept untouched at its initial loadout state (not modified or force-equipped)
    // Now verify when air_defense IS incomplete, guided_missile receives >= 3 reserve + 1 in tube
    ws.restoreCheckpointLoadout(
      snap,
      m1,
      [{ type: 'air_defense', actionMeta: m1.objectives[2].actionMeta }],
      unlockedSet
    );
    expect(ws.getWeaponState('guided_missile')!.ammoInMag).toBe(1);
    expect(ws.getWeaponState('guided_missile')!.reserveAmmo).toBeGreaterThanOrEqual(3);

    // If activeWeaponId in snapshot is locked/unavailable, never equip it
    const lockedSnap: MissionCheckpointSnapshot = {
      ...snap,
      activeWeaponId: 'sniper_rifle',
    };
    ws.restoreCheckpointLoadout(
      lockedSnap,
      m1,
      [{ type: 'eliminate_wave', actionMeta: m1.objectives[0].actionMeta }],
      unlockedSet
    );
    expect(ws.getActiveState().config.id).toBe('assault_rifle');

    ws.dispose();
    rm.disposeAll();
  });

  it('silently reconstructs completed destructibles via DestructionSystem.markDestroyedSilently without explosions, audio, or duplicate objective callbacks', () => {
    const rm = new ResourceManager();
    const audio = new AudioManager(rm, SettingsBundleSchema.parse({}).audio);
    const audioSpy = vi.spyOn(audio, 'playSpatial');
    const vfx = new VFXPool(new THREE.Scene(), rm);
    const vfxSpy = vi.spyOn(vfx, 'spawnExplosion');
    const hash = new SpatialHash(8);
    const ds = new DestructionSystem(hash, vfx, audio);

    const meshGroup = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial({ color: 0x888888 })
    );
    meshGroup.add(body);

    const collider = createDestructibleCollider('radar_0', -18, 0, -26, 2, 4.2, 2);
    ds.register({
      id: 'radar_0',
      kind: 'radar_relay',
      isObjectiveTarget: true,
      position: new THREE.Vector3(-18, 0, -26),
      health: 160,
      maxHealth: 160,
      state: 'INTACT',
      blastRadius: 6,
      blastDamage: 120,
      meshGroup,
      collider,
    });

    const hitsBefore: typeof collider[] = [];
    hash.queryAABB(-19, -27, -17, -25, COLLISION_LAYER.DESTRUCTIBLE, hitsBefore);
    expect(hitsBefore).toHaveLength(1);

    expect(ds.markDestroyedSilently('radar_0')).toBe(true);
    // Calling again is idempotent (returns false)
    expect(ds.markDestroyedSilently('radar_0')).toBe(false);

    const hitsAfter: typeof collider[] = [];
    hash.queryAABB(-19, -27, -17, -25, COLLISION_LAYER.DESTRUCTIBLE, hitsAfter);
    expect(hitsAfter).toHaveLength(0);
    expect(ds.getByKind('radar_relay')).toHaveLength(0);
    expect(audioSpy).not.toHaveBeenCalled();
    expect(vfxSpy).not.toHaveBeenCalled();

    ds.dispose();
    rm.disposeAll();
  });
});
