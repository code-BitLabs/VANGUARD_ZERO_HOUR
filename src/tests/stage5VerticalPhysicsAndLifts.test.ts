import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CargoLiftDefinition,
  CargoLiftFloorStop,
  CargoLiftManager,
  CargoLiftOccupantProxy,
  CargoLiftState,
} from '@/src/gameplay/CargoLiftManager';
import { CollisionWorld, createOrientedSlopeRegion } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER, SpatialAABB } from '@/src/physics/SpatialHash';
import { PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import { AGENT_TRAVERSAL_PROFILES } from '@/src/navigation/AgentTraversalProfile';

function createTestMultiStopLift(
  cw: CollisionWorld,
  stopsElevations: number[] = [0, 7, 14]
): { def: CargoLiftDefinition; platformGroup: THREE.Group; gateMeshes: Map<number, THREE.Object3D> } {
  const halfWidth = 2.0;
  const halfDepth = 2.0;
  const deckThickness = 0.45;
  const centerX = 0;
  const centerZ = -20;

  const platformCollider: SpatialAABB = {
    id: 'test_lift_platform',
    minX: centerX - halfWidth,
    minY: stopsElevations[0] - deckThickness,
    minZ: centerZ - halfDepth,
    maxX: centerX + halfWidth,
    maxY: stopsElevations[0],
    maxZ: centerZ + halfDepth,
    layer: COLLISION_LAYER.WORLD,
    tag: 'cargo_lift_platform',
  };
  cw.addStaticBox(platformCollider);

  const gateColliders = new Map<number, SpatialAABB>();
  const gateMeshes = new Map<number, THREE.Object3D>();
  const stops: CargoLiftFloorStop[] = [];

  for (let i = 0; i < stopsElevations.length; i++) {
    const elevY = stopsElevations[i];
    const gateBox: SpatialAABB = {
      id: `test_lift_gate_${i}`,
      minX: centerX - halfWidth,
      minY: elevY,
      minZ: centerZ + halfDepth - 0.12,
      maxX: centerX + halfWidth,
      maxY: elevY + 1.4,
      maxZ: centerZ + halfDepth + 0.12,
      layer: i === 0 ? COLLISION_LAYER.TRIGGER : COLLISION_LAYER.WORLD,
      tag: 'cargo_lift_gate',
    };
    cw.addStaticBox(gateBox);
    gateColliders.set(i, gateBox);
    gateMeshes.set(i, new THREE.Group());

    stops.push({
      floorIndex: i,
      floorId: `L${i + 1}`,
      label: `LEVEL ${i + 1} (${elevY}M)`,
      elevationY: elevY,
      surfaceId: i,
      boardingWaitPos: { x: centerX, y: elevY, z: centerZ + halfDepth + 1.3 },
      exitPos: { x: centerX, y: elevY, z: centerZ + halfDepth + 1.3 },
      clearanceHeight: 3.1,
      gateColliderId: gateBox.id,
      portalIds: [`portal_lift_test_${i}`],
    });
  }

  const platformGroup = new THREE.Group();
  const def: CargoLiftDefinition = {
    id: 'test_cargo_lift',
    name: 'FOUNDRY CARGO LIFT',
    centerX,
    centerZ,
    halfWidth,
    halfDepth,
    deckThickness,
    speedMetersPerSec: 4.5,
    maxOccupants: 3,
    maxAiOccupants: 2,
    stops,
    initialFloorIndex: 0,
    platformCollider,
    gateColliders,
    platformGroup,
    gateMeshes,
    portalIds: stops.flatMap((s) => s.portalIds ?? []),
    shaftCeilingY: stopsElevations[stopsElevations.length - 1] + 3.4,
  };

  return { def, platformGroup, gateMeshes };
}

describe('Stage 5A TRN-15: Vertical Physics, Oriented Slopes & Multi-Stop Cargo Lifts', () => {
  describe('TRN-15.1 / TRN-15.2 — Generalized OrientedSlopeRegion & Headroom Enforcement', () => {
    it('walks smoothly up and down arbitrary-heading oriented ramps (0°, 90°, 45°, 180°) with zero airborne jitter', () => {
      const headings = [
        { name: '0 deg (+Z)', dx: 0, dz: 1 },
        { name: '90 deg (+X)', dx: 1, dz: 0 },
        { name: '45 deg (+X/+Z)', dx: Math.SQRT1_2, dz: Math.SQRT1_2 },
        { name: '180 deg (-Z)', dx: 0, dz: -1 },
      ];

      for (const h of headings) {
        const cw = new CollisionWorld();
        cw.setTerrainHeightFn(() => 0);

        const len = 14;
        const slope = createOrientedSlopeRegion({
          id: `ramp_${h.name}`,
          surfaceId: 1,
          startX: 0,
          startZ: 0,
          endX: h.dx * len,
          endZ: h.dz * len,
          width: 3.2,
          startY: 0,
          endY: 4.5,
          thickness: 0.45,
        });
        expect(slope.maxSlopeDeg).toBeLessThanOrEqual(25);
        cw.addSlope(slope);

        const pos = new THREE.Vector3(h.dx * 0.4, 0.01, h.dz * 0.4);
        const vel = new THREE.Vector3(h.dx * 6.0, 0, h.dz * 6.0);
        const maxSlope = AGENT_TRAVERSAL_PROFILES.player.maxSlopeDeg;

        // Ascend ramp
        for (let step = 0; step < 110; step++) {
          vel.set(h.dx * 6.0, vel.y - 18 * (1 / 60), h.dz * 6.0);
          const res = cw.resolvePlayerCapsule(pos, vel, 0.42, 1.75, 0.48, 1 / 60, 'player', PHYSICS_MASKS.CHARACTER_SOLID, undefined, maxSlope);
          if (step > 5) {
            expect(res.grounded).toBe(true);
          }
        }
        expect(pos.y).toBeGreaterThan(3.0);

        // Descend back down smoothly without bouncing/hovering
        let groundedCount = 0;
        for (let step = 0; step < 90; step++) {
          vel.set(-h.dx * 6.0, vel.y - 18 * (1 / 60), -h.dz * 6.0);
          const res = cw.resolvePlayerCapsule(pos, vel, 0.42, 1.75, 0.48, 1 / 60, 'player', PHYSICS_MASKS.CHARACTER_SOLID, undefined, maxSlope);
          if (res.grounded) groundedCount++;
        }
        expect(groundedCount).toBeGreaterThan(75);
        expect(pos.y).toBeLessThan(1.6);
      }
    });

    it('rejects standing support beneath low overhead ceiling and triggers hitCeiling on ramp underside', () => {
      const cw = new CollisionWorld();
      cw.setTerrainHeightFn(() => 0);

      // Raised ramp reaching +3.0m
      cw.addSlope(
        createOrientedSlopeRegion({
          id: 'underpass_ramp',
          surfaceId: 1,
          startX: 0,
          startZ: 10,
          endX: 0,
          endZ: 0,
          width: 3.5,
          startY: 0,
          endY: 3.0,
          thickness: 0.45,
        })
      );

      // Support query under mid-ramp (z=3 => topY=2.1, bottomY=1.65) with feet at y=0: must stay on ground y=0!
      const underSupport = cw.getSupportHeightAt(0, 0, 3, 1.75, 0.48, 42);
      expect(underSupport).toBeCloseTo(0, 2);

      // Low deck ledge at y=0.35 with overhead beam at y=1.55 (1.20m gap < 1.75m standing height)
      cw.addStaticBox({
        id: 'low_deck_step',
        minX: 8,
        minY: 0,
        minZ: -2,
        maxX: 12,
        maxY: 0.35,
        maxZ: 2,
        layer: COLLISION_LAYER.WORLD,
      });
      cw.addStaticBox({
        id: 'low_overhead_beam',
        minX: 8,
        minY: 1.55,
        minZ: -2,
        maxX: 12,
        maxY: 2.5,
        maxZ: 2,
        layer: COLLISION_LAYER.WORLD,
      });

      // Standing capsule cannot receive support onto deck under 1.20m beam
      const blockedStepY = cw.getSupportHeightAt(10, 0, 0, 1.75, 0.48, 42);
      expect(blockedStepY).toBeCloseTo(0, 2);

      // Crouched capsule (1.15m) CAN stand under 1.20m beam!
      const crouchedStepY = cw.getSupportHeightAt(10, 0, 0, 1.15, 0.48, 42);
      expect(crouchedStepY).toBeCloseTo(0.35, 2);

      // Jumping upward under the sloped underside slab must hitCeiling and stop positive vy
      const jumpPos = new THREE.Vector3(0, 0.0, 2.0); // ramp topY=2.4, bottomY=1.95 -> head at 1.75m jumps into bottomY=1.95
      const jumpVel = new THREE.Vector3(0, 9.5, 0);
      let hitUndersideCeiling = false;
      for (let i = 0; i < 15; i++) {
        const res = cw.resolvePlayerCapsule(jumpPos, jumpVel, 0.42, 1.75, 0.48, 1 / 60, 'player');
        if (res.hitCeiling) {
          hitUndersideCeiling = true;
          break;
        }
      }
      expect(hitUndersideCeiling).toBe(true);
      expect(jumpVel.y).toBeLessThanOrEqual(0);
    });
  });

  describe('TRN-15.3 — Generalized Multi-Stop CargoLiftManager & Selective BVH', () => {
    it('executes full 8-state lift lifecycle across 3 stops (0m -> 7m -> 14m -> 7m -> 0m) with gate colliders and deltaY carrying', () => {
      const cw = new CollisionWorld();
      const { def } = createTestMultiStopLift(cw, [0, 7, 14]);
      const mgr = new CargoLiftManager(cw);
      const portalUpdates: Array<{ portalId: string; dynamicWaitCostSec: number; enabled: boolean }> = [];
      mgr.onPortalStateChange((u) => {
        portalUpdates.push({
          portalId: u.portalId,
          dynamicWaitCostSec: u.dynamicWaitCostSec,
          enabled: u.enabled,
        });
      });
      mgr.registerLift(def);

      expect(mgr.getLiftFloorCount(def.id)).toBe(3);

      const playerPos = new THREE.Vector3(0, 0, -20); // Standing centered on platform
      const playerVel = new THREE.Vector3(0, -1, 0);
      const occupants: CargoLiftOccupantProxy[] = [
        { id: 'player', isPlayer: true, pos: playerPos, vel: playerVel, height: 1.75 },
      ];

      const observedStates = new Set<CargoLiftState>();
      const tickLift = (steps: number) => {
        for (let i = 0; i < steps; i++) {
          mgr.updateFixed(1 / 60, occupants);
          const info = mgr.getLiftRuntimeInfo(def.id);
          if (info) observedStates.add(info.state);
        }
      };

      // Initially idle at floor 0 (0m), gate 0 open (TRIGGER), gates 1 & 2 locked (WORLD)
      tickLift(1);
      expect(mgr.getLiftRuntimeInfo(def.id)?.state).toBe('idle');
      expect(def.gateColliders.get(0)?.layer).toBe(COLLISION_LAYER.TRIGGER);
      expect(def.gateColliders.get(1)?.layer).toBe(COLLISION_LAYER.WORLD);
      expect(def.gateColliders.get(2)?.layer).toBe(COLLISION_LAYER.WORLD);

      // Step out to test call pad interaction -> triggers 'requested' state
      playerPos.set(def.stops[2].boardingWaitPos.x, 14, def.stops[2].boardingWaitPos.z);
      expect(mgr.tryPlayerInteract(playerPos)).toBe(true);
      expect(mgr.getLiftRuntimeInfo(def.id)?.state).toBe('requested');
      observedStates.add('requested');

      // Step into lift at floor 0 -> trigger ride L1 (0m) -> L2 (7m) -> L3 (14m)
      // Wait for travel up to floor 2 (14m)
      tickLift(360);
      expect(mgr.getLiftRuntimeInfo(def.id)?.currentFloorIndex).toBe(2);
      expect(mgr.getLiftRuntimeInfo(def.id)?.state).toBe('idle');

      // Board at floor 2 (14m), return down to floor 1 (7m), then floor 0 (0m)
      playerPos.set(0, 14, -20);
      tickLift(1);
      expect(mgr.tryPlayerInteract(playerPos)).toBe(true);
      expect(mgr.getLiftRuntimeInfo(def.id)?.targetFloorIndex).toBe(1);
      expect(mgr.getLiftRuntimeInfo(def.id)?.travelDirection).toBe('down');
      tickLift(180);
      expect(playerPos.y).toBeCloseTo(7, 2);
      expect(mgr.getLiftRuntimeInfo(def.id)?.currentFloorIndex).toBe(1);

      // Ride from floor 1 (7m) down to floor 0 (0m)
      expect(mgr.tryPlayerInteract(playerPos)).toBe(true);
      expect(mgr.getLiftRuntimeInfo(def.id)?.targetFloorIndex).toBe(0);
      tickLift(180);
      expect(playerPos.y).toBeCloseTo(0, 2);
      expect(mgr.getLiftRuntimeInfo(def.id)?.currentFloorIndex).toBe(0);

      // Also test AI 'boarding' and 'unloading' transitions cleanly
      const ai1Pos = new THREE.Vector3(def.stops[0].boardingWaitPos.x, 0, def.stops[0].boardingWaitPos.z);
      const aiOcc: CargoLiftOccupantProxy = {
        id: 'ai_unit_1',
        isPlayer: false,
        pos: ai1Pos,
        vel: new THREE.Vector3(),
        height: 1.75,
      };
      occupants.push(aiOcc);
      expect(mgr.requestLiftForAI(def.id, 'ai_unit_1', 0, 1)).toBe(true);
      observedStates.add(mgr.getLiftRuntimeInfo(def.id)!.state); // 'boarding'
      ai1Pos.set(0.5, 0, -20); // AI boards cabin
      tickLift(200);
      expect(ai1Pos.y).toBeCloseTo(7, 2);
      expect(portalUpdates.length).toBeGreaterThan(2);

      const expectedAll8: CargoLiftState[] = [
        'idle',
        'requested',
        'boarding',
        'doors_closing',
        'traveling',
        'docking',
        'doors_opening',
        'unloading',
      ];
      for (const s of expectedAll8) {
        expect(observedStates.has(s)).toBe(true);
      }
    });

    it('enforces 1 player + 2 AI capacity (maxOccupants=3), clamps shaft ceiling headroom, and normalizes checkpoints', () => {
      const cw = new CollisionWorld();
      const { def } = createTestMultiStopLift(cw, [0, 7, 14]);
      // Test tight shaft ceiling clamp
      def.shaftCeilingY = 15.1;
      const mgr = new CargoLiftManager(cw);
      mgr.registerLift(def);

      const playerPos = new THREE.Vector3(-0.7, 0, -20);
      const ai1Pos = new THREE.Vector3(0.7, 0, -20);
      const ai2Pos = new THREE.Vector3(0.0, 0, -19.3);
      const ai3Pos = new THREE.Vector3(0.0, 0, -20.7);
      const occupants: CargoLiftOccupantProxy[] = [
        { id: 'player', isPlayer: true, pos: playerPos, vel: new THREE.Vector3(), height: 1.75 },
        { id: 'ai_1', isPlayer: false, pos: ai1Pos, vel: new THREE.Vector3(), height: 1.75 },
        { id: 'ai_2', isPlayer: false, pos: ai2Pos, vel: new THREE.Vector3(), height: 1.75 },
        { id: 'ai_3', isPlayer: false, pos: ai3Pos, vel: new THREE.Vector3(), height: 1.75 },
      ];

      mgr.updateFixed(1 / 60, occupants);
      const info = mgr.getLiftRuntimeInfo(def.id)!;
      expect(info.occupantCount).toBe(3); // 1 player + 2 AI
      expect(info.playerInside).toBe(true);
      expect(mgr.canAiBoardLift(def.id, 'ai_1', 0)).toBe(true);
      expect(mgr.canAiBoardLift(def.id, 'ai_2', 0)).toBe(true);
      expect(mgr.canAiBoardLift(def.id, 'ai_3', 0)).toBe(false); // 3rd AI rejected!

      // Send player + 2 AIs to floor 2 (14m); shaft ceiling 15.1m with 1.9m safety margin clamps y <= 13.1m
      expect(mgr.tryPlayerInteract(playerPos)).toBe(true); // -> 7m
      for (let i = 0; i < 180; i++) mgr.updateFixed(1 / 60, occupants);
      expect(mgr.tryPlayerInteract(playerPos)).toBe(true); // -> 14m
      for (let i = 0; i < 90; i++) mgr.updateFixed(1 / 60, occupants);

      // Pause mid-travel or clamped near top -> normalizeForCheckpoint snaps cleanly to nearest landing floor
      expect(mgr.getLiftRuntimeInfo(def.id)?.currentElevationY).toBeLessThanOrEqual(13.101);
      mgr.normalizeForCheckpoint();
      const postNorm = mgr.getLiftRuntimeInfo(def.id)!;
      expect(postNorm.state).toBe('idle');
      expect(postNorm.travelDirection).toBe('none');
      expect([0, 7, 14]).toContain(postNorm.currentElevationY);

      mgr.reset();
      expect(mgr.getLiftRuntimeInfo(def.id)?.currentFloorIndex).toBe(0);
      mgr.clear();
      expect(mgr.getLiftCount()).toBe(0);
    });

    it('selectively builds BVH trees on structural meshes, skips dynamic/trim meshes, and disposes deduped geometries on clear', () => {
      const cw = new CollisionWorld();
      const pw = cw.physicsWorld;

      const sharedWallGeo = new THREE.BoxGeometry(8, 5, 1);
      const mesh1 = new THREE.Mesh(sharedWallGeo, new THREE.MeshBasicMaterial());
      mesh1.name = 'bldg_wall_a';
      mesh1.position.set(10, 2.5, -10);

      const mesh2 = new THREE.Mesh(sharedWallGeo, new THREE.MeshBasicMaterial());
      mesh2.name = 'bldg_wall_b';
      mesh2.position.set(-10, 2.5, -10);

      const trimMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), new THREE.MeshBasicMaterial());
      trimMesh.name = 'window_trim';

      const dynamicLiftMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 4), new THREE.MeshBasicMaterial());
      dynamicLiftMesh.name = 'lift_platform';
      dynamicLiftMesh.userData.dynamicPlatform = true;

      pw.registerBvhMesh(mesh1);
      pw.registerBvhMesh(mesh2);
      pw.registerBvhMesh(trimMesh);
      pw.registerBvhMesh(dynamicLiftMesh);

      // Same BufferGeometry shared across mesh1/mesh2 is stored once; trim and dynamic lift skipped
      expect(pw.getBvhGeometryCount()).toBe(1);
      expect((sharedWallGeo as THREE.BufferGeometry & { boundsTree?: unknown }).boundsTree).toBeDefined();
      expect((trimMesh.geometry as THREE.BufferGeometry & { boundsTree?: unknown }).boundsTree).toBeUndefined();
      expect((dynamicLiftMesh.geometry as THREE.BufferGeometry & { boundsTree?: unknown }).boundsTree).toBeUndefined();

      pw.clear();
      expect(pw.getBvhGeometryCount()).toBe(0);
      expect((sharedWallGeo as THREE.BufferGeometry & { boundsTree?: unknown }).boundsTree).toBeNull();

      sharedWallGeo.dispose();
      trimMesh.geometry.dispose();
      dynamicLiftMesh.geometry.dispose();
    });
  });
});
