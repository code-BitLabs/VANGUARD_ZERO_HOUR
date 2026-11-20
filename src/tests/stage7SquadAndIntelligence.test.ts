import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ResourceManager } from '@/src/core/ResourceManager';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { createDefaultCoreRoster } from '@/src/data/squadRoster';
import { BattlefieldIntelligenceBoard } from '@/src/gameplay/ai/BattlefieldIntelligenceBoard';
import { HardwareReadinessHarness } from '@/src/gameplay/diagnostics/HardwareReadinessHarness';
import {
  FriendlySquadManager,
  SquadVehicleSeatView,
} from '@/src/gameplay/squad/FriendlySquadManager';
import {
  FormationWorldSlot,
  projectFormationSlotsInto,
  selectDynamicFormation,
} from '@/src/gameplay/squad/SquadFormationSolver';
import {
  SquadIntentRouter,
  SquadIntentValidationContext,
} from '@/src/gameplay/squad/SquadIntentRouter';
import { BoundedNavRequestScheduler } from '@/src/gameplay/squad/SquadTacticalPlanner';
import { DEFAULT_SETTINGS } from '@/src/schemas/settings.schema';
import {
  computeMobileHudLayout,
  computeMobileSquadStripRect,
} from '@/src/ui/hud/mobileHudLayoutEngine';

function addBox(
  world: CollisionWorld,
  id: string,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number
): void {
  world.addStaticBox({
    id,
    minX: cx - w * 0.5,
    maxX: cx + w * 0.5,
    minY: cy - h * 0.5,
    maxY: cy + h * 0.5,
    minZ: cz - d * 0.5,
    maxZ: cz + d * 0.5,
    layer: 1,
  });
}

function createEmptyIntentCtx(playerPos: THREE.Vector3): SquadIntentValidationContext {
  return {
    playerPos: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
    isEnemyAlive: () => false,
    getEnemyPos: () => null,
    isVehicleBoardable: () => false,
    getVehiclePos: () => null,
  };
}

describe('Stage 7 Adversarial Suite B — Squad AI, Navigation, Intelligence, Resource Leaks & Mobile Layout (Scenarios 1–6, 12–15)', () => {
  // Scenario 1: Multi-elevation separation trap with strict zero-teleport displacement invariant
  it('Scenario 1: enforces strict zero-teleport displacement invariant when player is isolated on an unreachable elevated platform', () => {
    const world = new CollisionWorld();
    addBox(world, 'ground', 0, -0.5, 0, 100, 1, 100);
    // Unreachable isolated rooftop slab at y = 6.0 (no stairs or ramps)
    addBox(world, 'isolated_roof', 0, 5.75, 12, 8, 0.5, 8);

    const squad = new FriendlySquadManager();
    const roster = createDefaultCoreRoster();
    squad.initializeForMission({
      scene: null,
      resourceManager: null,
      scope: null,
      roster,
      preferredSquadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
      spawnOrigin: { x: 0, y: 0, z: 0 },
      difficulty: 'normal',
    });

    const dt = 1 / 30;
    const playerOnRoof = new THREE.Vector3(0, 6.0, 12);
    const playerFwd = new THREE.Vector3(0, 0, -1);

    let maxStepDisplacement = 0;
    const prevPositions = new Map<string, THREE.Vector3>();
    for (const op of squad.getOperators()) {
      prevPositions.set(op.id, op.position.clone());
    }

    // Simulate 10 full seconds (300 ticks)
    for (let step = 0; step < 300; step++) {
      squad.update({
        dt,
        playerPos: playerOnRoof,
        playerForward: playerFwd,
        playerAlive: true,
        collision: world,
        enemies: [],
        vehicles: [],
        intentValidationCtx: createEmptyIntentCtx(playerOnRoof),
      });

      for (const op of squad.getOperators()) {
        const prev = prevPositions.get(op.id)!;
        const dist = prev.distanceTo(op.position);
        if (dist > maxStepDisplacement) maxStepDisplacement = dist;
        expect(Number.isFinite(op.position.x)).toBe(true);
        expect(Number.isFinite(op.position.y)).toBe(true);
        expect(Number.isFinite(op.position.z)).toBe(true);
        // Zero arbitrary teleportation: max displacement per tick must never jump instantaneously
        expect(dist).toBeLessThanOrEqual(9.5 * dt + 0.15);
        // Operator must never magically warp onto the unreachable 6m rooftop
        expect(op.position.y).toBeLessThan(3.0);
        prev.copy(op.position);
      }
    }

    expect(maxStepDisplacement).toBeLessThanOrEqual(9.5 * dt + 0.15);
  });

  // Scenario 2: Narrow doorway / staircase bottleneck COLUMN collapse
  it('Scenario 2: collapses WEDGE formation into COLUMN inside narrow corridors and projects non-overlapping slots', () => {
    const narrowFormation = selectDynamicFormation({
      corridorWidthMeters: 1.9,
      onVerticalPortalOrBridge: false,
      nearCargoLiftOrCluster: false,
      isFiringLineIntent: false,
      threatExposure: 0.2,
    });
    expect(narrowFormation).toBe('COLUMN');

    const stairFormation = selectDynamicFormation({
      corridorWidthMeters: 6.0,
      onVerticalPortalOrBridge: true,
      nearCargoLiftOrCluster: false,
      isFiringLineIntent: false,
      threatExposure: 0.1,
    });
    expect(stairFormation).toBe('COLUMN');

    const slots: FormationWorldSlot[] = [];
    const count = projectFormationSlotsInto(0, 0, 11, 0, 1, 'COLUMN', 3, slots);
    expect(count).toBe(3);
    expect(slots).toHaveLength(3);

    // Every pair of slots must maintain healthy minimum separation without overlapping
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const sep = Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z);
        expect(sep).toBeGreaterThanOrEqual(0.75);
      }
    }
  });

  // Scenario 3: Conflicting rapid orders & 1-tick stale enemy target cleanup
  it('Scenario 3: deduplicates rapid conflicting orders with monotonic command IDs and prunes dead targets within 1 tick', () => {
    const router = new SquadIntentRouter();
    const aliveIds = new Set<string>(['enemy_alpha']);
    const ctx: SquadIntentValidationContext = {
      playerPos: { x: 0, y: 0, z: 0 },
      isEnemyAlive: (id) => aliveIds.has(id),
      getEnemyPos: (id) => (aliveIds.has(id) ? { x: 10, y: 0, z: 12 } : null),
      isVehicleBoardable: () => false,
      getVehiclePos: () => null,
    };

    const orders = ['FLANK', 'HOLD', 'SUPPRESS', 'ATTACK_TARGET', 'REGROUP'] as const;
    let lastCmdId = 0;

    for (let i = 0; i < 20; i++) {
      const ord = orders[i % orders.length];
      const res = router.issueCommand(
        {
          order: ord,
          source: 'desktop_quick_key',
          targetEnemyId: ord === 'ATTACK_TARGET' ? 'enemy_alpha' : undefined,
          targetPos: { x: i * 1.5, y: 0, z: 10 },
          issuedAtSec: i * 0.05,
        },
        ctx
      );
      expect(res.accepted).toBe(true);
      expect(res.intent).not.toBeNull();
      expect(res.intent!.commandId).toBeGreaterThan(lastCmdId);
      lastCmdId = res.intent!.commandId;
    }

    // Issue targeted attack order then kill enemy_alpha -> pruneStaleTargets cleans it in 1 tick
    router.issueCommand(
      {
        order: 'ATTACK_TARGET',
        source: 'desktop_radial',
        targetEnemyId: 'enemy_alpha',
        issuedAtSec: 2.0,
      },
      ctx
    );
    expect(router.getSquadWideIntent()?.targetEnemyId).toBe('enemy_alpha');

    aliveIds.delete('enemy_alpha');
    const pruned = router.pruneStaleTargets(ctx, 2.05);
    expect(pruned).toBe(true);
    expect(router.getSquadWideIntent()?.targetEnemyId).toBeNull();
    expect(router.getSquadWideIntent()?.order).toBe('FOLLOW');
  });

  // Scenario 4: Downed mid-vehicle-transition atomic seat release
  it('Scenario 4: atomically releases vehicle passenger seat if an operator is downed while mounted', () => {
    const world = new CollisionWorld();
    addBox(world, 'ground', 0, -0.5, 0, 100, 1, 100);

    const squad = new FriendlySquadManager();
    squad.initializeForMission({
      scene: null,
      resourceManager: null,
      scope: null,
      roster: createDefaultCoreRoster(),
      preferredSquadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
      spawnOrigin: { x: 0, y: 0, z: 0 },
      difficulty: 'normal',
    });

    const occupied = new Set<string>(['vanguard_2']);
    let releasedCount = 0;
    const mockVehicle: SquadVehicleSeatView = {
      id: 'humvee_1',
      alive: true,
      hostile: false,
      position: new THREE.Vector3(4, 0, 4),
      yaw: 0,
      healthRatio: 1,
      maxPassengerSeats: 3,
      occupantIds: ['vanguard_2'],
      tryBoardSeat: (opId: string) => {
        if (occupied.size >= 3) return false;
        occupied.add(opId);
        if (!mockVehicle.occupantIds.includes(opId)) mockVehicle.occupantIds.push(opId);
        return true;
      },
      releaseSeat: (opId: string) => {
        if (occupied.delete(opId)) {
          releasedCount++;
          mockVehicle.occupantIds = mockVehicle.occupantIds.filter((id) => id !== opId);
        }
        return { x: 6, y: 0, z: 4 };
      },
    };

    const op1 = squad.getOperators().find((o) => o.id === 'vanguard_2')!;
    op1.inVehicleId = 'humvee_1';

    const dmg = squad.applyDamageToOperator('vanguard_2', 500, 1.0, true, [mockVehicle]);
    expect(dmg.downed).toBe(true);
    expect(op1.state).toBe('DOWNED');
    expect(op1.inVehicleId).toBeNull();
    expect(occupied.has('vanguard_2')).toBe(false);
    expect(releasedCount).toBe(1);
  });

  // Scenario 5: Medic incapacitation mid-rescue + stabilization + player manual rescue fallback
  it('Scenario 5: cancels medic rescue safely when medic is downed mid-revive and allows player manual rescue fallback', () => {
    const world = new CollisionWorld();
    addBox(world, 'ground', 0, -0.5, 0, 100, 1, 100);

    const squad = new FriendlySquadManager();
    squad.initializeForMission({
      scene: null,
      resourceManager: null,
      scope: null,
      roster: createDefaultCoreRoster(),
      preferredSquadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
      spawnOrigin: { x: 0, y: 0, z: 0 },
      difficulty: 'normal',
    });

    const assault = squad.getOperators().find((o) => o.id === 'vanguard_2')!;
    const medic = squad.getOperators().find((o) => o.id === 'lifeline_6')!;

    medic.position.copy(assault.position).add(new THREE.Vector3(0.8, 0, 0));
    squad.applyDamageToOperator(assault.id, 400, 0.8, false, []);
    expect(assault.state).toBe('DOWNED');

    const playerFar = new THREE.Vector3(15, 0, 15);
    const fwd = new THREE.Vector3(0, 0, -1);
    for (let i = 0; i < 15; i++) {
      squad.update({
        dt: 0.05,
        playerPos: playerFar,
        playerForward: fwd,
        playerAlive: true,
        collision: world,
        enemies: [],
        vehicles: [],
        intentValidationCtx: createEmptyIntentCtx(playerFar),
      });
    }

    // Incapacitate the Field Medic mid-rescue
    squad.applyDamageToOperator(medic.id, 400, 1.0, false, []);
    expect(medic.state).toBe('DOWNED');
    expect(medic.revivingTargetId).toBeNull();

    // Player walks up and holds [E] to manually rescue Assault even with Medic incapacitated
    const playerAtAssault = assault.position.clone().add(new THREE.Vector3(0.6, 0, 0));
    let revived = false;
    for (let i = 0; i < 60; i++) {
      const res = squad.stepPlayerRescue(0.1, playerAtAssault, true);
      if (res.rescuedOperatorId === assault.id) {
        revived = true;
        break;
      }
    }
    expect(revived).toBe(true);
    expect(assault.state).not.toBe('DOWNED');
    expect(assault.state).not.toBe('MIA');
    expect(assault.alive).toBe(true);
    expect(assault.health).toBeGreaterThan(0);
  });

  // Scenario 6: Multiple simultaneous downed operators
  it('Scenario 6: handles multiple simultaneous downed operators cleanly without double-revive race or state corruption', () => {
    const world = new CollisionWorld();
    addBox(world, 'ground', 0, -0.5, 0, 100, 1, 100);

    const squad = new FriendlySquadManager();
    squad.initializeForMission({
      scene: null,
      resourceManager: null,
      scope: null,
      roster: createDefaultCoreRoster(),
      preferredSquadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
      spawnOrigin: { x: 0, y: 0, z: 0 },
      difficulty: 'normal',
    });

    const op1 = squad.getOperators().find((o) => o.id === 'vanguard_2')!;
    const op2 = squad.getOperators().find((o) => o.id === 'bulwark_3')!;
    const medic = squad.getOperators().find((o) => o.id === 'lifeline_6')!;

    op1.position.set(0, 0, 0);
    op2.position.set(1.2, 0, 0);
    medic.position.set(0.6, 0, 0.8);

    squad.applyDamageToOperator(op1.id, 400, 0.5, false, []);
    squad.applyDamageToOperator(op2.id, 400, 0.5, false, []);
    op1.bleedoutRemainingSec = 9;
    op2.bleedoutRemainingSec = 18;

    const playerPos = new THREE.Vector3(1.4, 0, 0.3);
    const fwd = new THREE.Vector3(0, 0, -1);

    for (let i = 0; i < 130; i++) {
      squad.stepPlayerRescue(0.05, playerPos, true);
      squad.update({
        dt: 0.05,
        playerPos,
        playerForward: fwd,
        playerAlive: true,
        collision: world,
        enemies: [],
        vehicles: [],
        intentValidationCtx: createEmptyIntentCtx(playerPos),
      });
    }

    expect(op1.state).not.toBe('DOWNED');
    expect(op1.state).not.toBe('MIA');
    expect(op2.state).not.toBe('DOWNED');
    expect(op2.state).not.toBe('MIA');
    expect(op1.alive).toBe(true);
    expect(op2.alive).toBe(true);
    expect(op1.health).toBeGreaterThan(0);
    expect(op2.health).toBeGreaterThan(0);
  });

  // Scenario 12: Hostile intelligence LKP expiration (ENGAGED -> SEARCHING -> LOST) & comms-destroyed radio relay delay
  it('Scenario 12: decays hostile squad intelligence ENGAGED -> SEARCHING -> LOST and honors comms-disrupted radio relay delay', () => {
    const board = new BattlefieldIntelligenceBoard();
    board.registerSquad('alpha');
    board.registerSquad('bravo');
    board.setCommsDelayMultiplier(1.65);

    board.reportDetection({
      squadId: 'alpha',
      spotterUnitId: 'enemy_spotter_1',
      source: 'sight',
      x: 10,
      y: 0,
      z: 20,
      strength: 0.95,
    });

    expect(board.getSquadMemory('alpha')?.state).toBe('ENGAGED');
    expect(board.getSquadMemory('bravo')?.state).toBe('UNDETECTED');

    // After 1.5s, radio relay is still in flight due to comms disruption
    for (let i = 0; i < 15; i++) board.update(0.1);
    expect(board.getSquadMemory('bravo')?.state).toBe('UNDETECTED');

    // After 4.5s total (past 2.5s * 1.65 = 4.125s comms-disrupted relay delay), relay arrives at Bravo
    for (let i = 0; i < 30; i++) board.update(0.1);
    const bravoMem = board.getSquadMemory('bravo');
    expect(bravoMem?.state).not.toBe('UNDETECTED');

    // Advance without further sightings until Alpha transitions through SEARCHING -> LOST
    let sawSearching = false;
    for (let i = 0; i < 260; i++) {
      board.update(0.1);
      if (board.getSquadMemory('alpha')?.state === 'SEARCHING') {
        sawSearching = true;
      }
    }
    expect(sawSearching).toBe(true);
    expect(board.getSquadMemory('alpha')?.state).toBe('LOST');
    expect(board.getSquadMemory('alpha')?.confidence).toBeLessThanOrEqual(0.15);
  });

  // Scenario 13: Bounded nav queue congestion (<= 2 solves/tick)
  it('Scenario 13: bounds navigation request scheduling strictly to <= 2 solves per tick and drains without starvation', () => {
    const scheduler = new BoundedNavRequestScheduler();
    for (let i = 0; i < 25; i++) {
      scheduler.enqueue(`unit_${i}`);
    }
    expect(scheduler.pendingCount()).toBe(25);

    const processed = new Set<string>();
    let ticks = 0;
    while (scheduler.pendingCount() > 0 && ticks < 50) {
      const batch = scheduler.drainBatch(2);
      expect(batch.length).toBeLessThanOrEqual(2);
      for (const id of batch) processed.add(id);
      ticks++;
    }

    expect(processed.size).toBe(25);
    expect(scheduler.pendingCount()).toBe(0);
    expect(ticks).toBe(13);
  });

  // Scenario 14: 10-cycle mission load/unload ResourceManager zero-leak audit
  it('Scenario 14: leaks zero Three.js geometries or materials across 10 consecutive squad spawn/dispose cycles', () => {
    const rm = new ResourceManager();
    const scene = new THREE.Scene();
    const squad = new FriendlySquadManager();
    const roster = createDefaultCoreRoster();

    for (let cycle = 0; cycle < 10; cycle++) {
      const scope = `mission:cycle_${cycle}` as const;
      squad.initializeForMission({
        scene,
        resourceManager: rm,
        scope,
        roster,
        preferredSquadIds: ['vanguard_2', 'bulwark_3', 'lifeline_6'],
        spawnOrigin: { x: 0, y: 0, z: 0 },
        difficulty: 'normal',
      });
      expect(scene.children.length).toBeGreaterThan(0);

      squad.dispose(scene);
      rm.unloadScope(scope);

      expect(scene.children.length).toBe(0);
      const snap = rm.getSnapshot();
      expect(snap.missionCount).toBe(0);
      expect(snap.byCategory.geometry).toBe(0);
      expect(snap.byCategory.material).toBe(0);
    }
  });

  // Scenario 15: Mobile multitouch non-overlap across 667x375, 844x390, 932x430 & zero-PII HardwareReadinessHarness
  it('Scenario 15: guarantees zero touch overlaps for mobile squad strip across 667x375, 844x390, 932x430 and enforces bounded zero-PII QA harness', () => {
    const viewports = [
      { width: 667, height: 375 },
      { width: 844, height: 390 },
      { width: 932, height: 430 },
    ];
    const profiles = ['two_finger', 'three_finger'] as const;

    for (const vp of viewports) {
      for (const profile of profiles) {
        const input = {
          ...DEFAULT_SETTINGS.input,
          touchControlProfile: profile,
          leftFireEnabled: profile === 'three_finger',
          rightFireEnabled: true,
        };
        const layout = computeMobileHudLayout(input, vp, { inVehicle: false, grenadeCount: 2 });
        expect(layout.overlappingPairs).toEqual([]);

        const strip = computeMobileSquadStripRect(layout);
        expect(strip.overlapsAnyControl).toBe(false);
        expect(strip.buttonSizePx).toBeGreaterThanOrEqual(44);
        expect(strip.stickyViewportRatio).toBeLessThanOrEqual(0.15);
      }
    }

    const harness = new HardwareReadinessHarness();
    for (let i = 0; i < 650; i++) {
      harness.recordFrameTimeMs(14 + (i % 10));
    }
    const snap = harness.buildSnapshot('headless_automated_check');
    expect(snap.containsPii).toBe(false);
    expect(snap.verificationMode).toBe('headless_automated_check');
    expect(snap.frameTimePercentilesMs.sampleCount).toBe(300);

    const feedback = harness.addPlaytestFeedback({
      deviceCategory: 'android_chrome',
      controlsRating: 5,
      squadResponsivenessRating: 4,
      loadoutClarityRating: 5,
      readabilityRating: 4,
      performanceRating: 4,
      notes: 'Contact tester@example.com for follow-up',
    });
    expect(feedback.notes).not.toContain('tester@example.com');
    expect(feedback.notes).toContain('[REDACTED]');

    const md = harness.exportMarkdownReport('headless_automated_check');
    expect(md).toContain('Contains PII:** No');
    expect(md).not.toContain('tester@example.com');
  });
});
