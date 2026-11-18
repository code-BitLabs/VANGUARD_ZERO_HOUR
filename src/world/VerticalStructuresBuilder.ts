import * as THREE from 'three';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { CargoLiftDefinition, CargoLiftFloorStop } from '@/src/gameplay/CargoLiftManager';
import {
  AGENT_PROFILE_ALL_INFANTRY_MASK,
  buildAllowedProfilesMask,
} from '@/src/navigation/AgentTraversalProfile';
import { CollisionWorld, createOrientedSlopeRegion } from '@/src/physics/CollisionWorld';
import { COLLISION_LAYER, SpatialAABB } from '@/src/physics/SpatialHash';
import { ElevatedNavSurfaceDescriptor } from '@/src/workers/WorkerBridge';
import { NavPortalInput } from '@/src/workers/navigationCore';
import { WorldChunkManager } from './WorldChunkManager';

export interface VerticalWorldContext {
  scene: THREE.Scene;
  assetManager: AssetManager;
  resourceManager: ResourceManager;
  collisionWorld: CollisionWorld;
  chunkManager: WorldChunkManager;
  scope: ResourceScope;
  coverNodes: THREE.Vector3[];
  elevatedSurfaces: ElevatedNavSurfaceDescriptor[];
  navPortals: NavPortalInput[];
  cargoLifts: CargoLiftDefinition[];
  nextSurfaceId: () => number;
  nextPortalId: () => number;
}

const INFANTRY_PORTAL_MASK = AGENT_PROFILE_ALL_INFANTRY_MASK;
const LIGHT_INFANTRY_MASK = buildAllowedProfilesMask(['player', 'standard_infantry']);

function addVisualBox(
  parent: THREE.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  res: ResourceManager,
  scope: ResourceScope,
  name?: string
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  res.registerGeometry(geo, scope);
  const mesh = new THREE.Mesh(geo, mat);
  if (name) mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addRampVisualFlight(
  parent: THREE.Group,
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
  width: number,
  thickness: number,
  deckMat: THREE.Material,
  railMat: THREE.Material,
  res: ResourceManager,
  scope: ResourceScope
): void {
  const dx = endX - startX;
  const dy = endY - startY;
  const dz = endZ - startZ;
  const horizLen = Math.max(0.1, Math.hypot(dx, dz));
  const fullLen = Math.hypot(horizLen, dy);
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(dy, horizLen);

  const flightGrp = new THREE.Group();
  flightGrp.position.set((startX + endX) * 0.5, (startY + endY) * 0.5, (startZ + endZ) * 0.5);
  flightGrp.rotation.order = 'YXZ';
  flightGrp.rotation.y = yaw;
  flightGrp.rotation.x = -pitch;

  const deckGeo = new THREE.BoxGeometry(width, thickness, fullLen + 0.16);
  res.registerGeometry(deckGeo, scope);
  const deckMesh = new THREE.Mesh(deckGeo, deckMat);
  deckMesh.position.y = -thickness * 0.5;
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  flightGrp.add(deckMesh);

  // Side steel stringers / safety railings along ±width/2
  const railGeo = new THREE.BoxGeometry(0.1, 0.95, fullLen);
  res.registerGeometry(railGeo, scope);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.name = 'stair_rail_trim';
    rail.userData.skipBvh = true;
    rail.position.set(side * (width * 0.5 - 0.05), 0.48, 0);
    flightGrp.add(rail);
  }

  // Non-slip visual tread cleats along the incline
  const steps = Math.max(4, Math.floor(horizLen / 0.75));
  const treadGeo = new THREE.BoxGeometry(width - 0.24, 0.05, 0.22);
  res.registerGeometry(treadGeo, scope);
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps - 0.5;
    const tread = new THREE.Mesh(treadGeo, railMat);
    tread.name = 'stair_tread_trim';
    tread.userData.skipBvh = true;
    tread.position.set(0, 0.02, t * fullLen);
    flightGrp.add(tread);
  }

  parent.add(flightGrp);
}

/**
 * Adds a switchback staircase (2 flights + mid-landing) rising from `(baseX, baseY, baseZ)`
 * along `(dirX, dirZ)` up to `(topX, topY, topZ)`, registering `OrientedSlopeRegion`s, landing collider,
 * and bidirectional `NavPortalInput`.
 */
export function buildSwitchbackStaircase(
  ctx: VerticalWorldContext,
  id: string,
  fromSurfaceId: number,
  toSurfaceId: number,
  entryX: number,
  baseY: number,
  entryZ: number,
  exitX: number,
  topY: number,
  exitZ: number,
  runDirX: number,
  runDirZ: number,
  runLength: number,
  stairWidth = 2.4
): void {
  const { assetManager, resourceManager, collisionWorld, chunkManager, scene, scope } = ctx;
  const deckMat = assetManager.getSharedMaterial('stair_tread_steel', {
    pattern: 'metal_plate',
    repeat: [2, 4],
    roughness: 0.52,
    metalness: 0.68,
    color: 0x3b4450,
  });
  const railMat = assetManager.getSharedMaterial('stair_rail_amber', {
    color: 0xd97706,
    roughness: 0.45,
    metalness: 0.4,
  });

  const grp = new THREE.Group();
  grp.name = `${id}_stairs`;

  // Lateral offset vector perpendicular to runDir
  const latX = -runDirZ;
  const latZ = runDirX;
  const sep = stairWidth + 0.35;
  const midY = baseY + (topY - baseY) * 0.5;

  // Flight 1: entry -> mid-landing along +runDir
  const f1StartX = entryX;
  const f1StartZ = entryZ;
  const f1EndX = entryX + runDirX * runLength;
  const f1EndZ = entryZ + runDirZ * runLength;

  // Compute landing footprint connecting Flight 1 end to Flight 2 start
  // Shift Flight 2 laterally toward exitX/exitZ
  const toExitDotLat = (exitX - entryX) * latX + (exitZ - entryZ) * latZ;
  const latSign = toExitDotLat >= 0 ? 1 : -1;
  const f2StartX = f1EndX + latX * latSign * sep;
  const f2StartZ = f1EndZ + latZ * latSign * sep;
  const f2EndX = entryX + latX * latSign * sep;
  const f2EndZ = entryZ + latZ * latSign * sep;

  const thickness = 0.42;

  addRampVisualFlight(
    grp,
    f1StartX,
    baseY,
    f1StartZ,
    f1EndX,
    midY,
    f1EndZ,
    stairWidth,
    thickness,
    deckMat,
    railMat,
    resourceManager,
    scope
  );
  collisionWorld.addSlope(
    createOrientedSlopeRegion({
      id: `${id}_flight1`,
      surfaceId: toSurfaceId,
      startX: f1StartX,
      startZ: f1StartZ,
      endX: f1EndX,
      endZ: f1EndZ,
      width: stairWidth,
      startY: baseY,
      endY: midY,
      thickness,
    })
  );

  // Mid-landing platform bridging Flight 1 end and Flight 2 start
  const landCenterX = (f1EndX + f2StartX) * 0.5 + runDirX * 1.15;
  const landCenterZ = (f1EndZ + f2StartZ) * 0.5 + runDirZ * 1.15;
  const landSpanAlongRun = 2.4;
  const landSpanAlongLat = sep + stairWidth;
  const landHalfX =
    Math.abs(runDirX) * (landSpanAlongRun * 0.5) + Math.abs(latX) * (landSpanAlongLat * 0.5);
  const landHalfZ =
    Math.abs(runDirZ) * (landSpanAlongRun * 0.5) + Math.abs(latZ) * (landSpanAlongLat * 0.5);

  addVisualBox(
    grp,
    landHalfX * 2,
    0.42,
    landHalfZ * 2,
    landCenterX,
    midY - 0.21,
    landCenterZ,
    deckMat,
    resourceManager,
    scope,
    `${id}_mid_landing`
  );
  collisionWorld.addStaticBox({
    id: `${id}_mid_landing`,
    minX: landCenterX - landHalfX,
    minY: midY - 0.42,
    minZ: landCenterZ - landHalfZ,
    maxX: landCenterX + landHalfX,
    maxY: midY,
    maxZ: landCenterZ + landHalfZ,
    layer: COLLISION_LAYER.WORLD,
    tag: 'stair_landing',
    entityId: id,
  });

  // Support pillars under mid-landing (outside walk path)
  const pilCenterX = landCenterX + runDirX * (landSpanAlongRun * 0.42);
  const pilCenterZ = landCenterZ + runDirZ * (landSpanAlongRun * 0.42);
  const pilH = Math.max(0.5, midY - baseY - 0.42);
  addVisualBox(
    grp,
    0.4,
    pilH,
    0.4,
    pilCenterX,
    baseY + pilH * 0.5,
    pilCenterZ,
    deckMat,
    resourceManager,
    scope,
    `${id}_pil`
  );

  // Flight 2: mid-landing -> top bridge landing
  addRampVisualFlight(
    grp,
    f2StartX,
    midY,
    f2StartZ,
    f2EndX,
    topY,
    f2EndZ,
    stairWidth,
    thickness,
    deckMat,
    railMat,
    resourceManager,
    scope
  );
  collisionWorld.addSlope(
    createOrientedSlopeRegion({
      id: `${id}_flight2`,
      surfaceId: toSurfaceId,
      startX: f2StartX,
      startZ: f2StartZ,
      endX: f2EndX,
      endZ: f2EndZ,
      width: stairWidth,
      startY: midY,
      endY: topY,
      thickness,
    })
  );

  // Top landing connecting f2End to (exitX, topY, exitZ)
  const topConnCenterX = (f2EndX + exitX) * 0.5;
  const topConnCenterZ = (f2EndZ + exitZ) * 0.5;
  const topConnW = Math.max(stairWidth, Math.abs(f2EndX - exitX) + 1.4);
  const topConnD = Math.max(stairWidth, Math.abs(f2EndZ - exitZ) + 1.4);
  addVisualBox(
    grp,
    topConnW,
    0.42,
    topConnD,
    topConnCenterX,
    topY - 0.21,
    topConnCenterZ,
    deckMat,
    resourceManager,
    scope,
    `${id}_top_bridge`
  );
  collisionWorld.addStaticBox({
    id: `${id}_top_bridge`,
    minX: topConnCenterX - topConnW * 0.5,
    minY: topY - 0.42,
    minZ: topConnCenterZ - topConnD * 0.5,
    maxX: topConnCenterX + topConnW * 0.5,
    maxY: topY,
    maxZ: topConnCenterZ + topConnD * 0.5,
    layer: COLLISION_LAYER.WORLD,
    tag: 'stair_landing',
    entityId: id,
  });

  chunkManager.registerObject(grp, (entryX + exitX) * 0.5, (entryZ + exitZ) * 0.5, scene);

  const risePerFlight = Math.abs(topY - baseY) * 0.5;
  const slopeDeg = (Math.atan2(risePerFlight, Math.max(0.5, runLength)) * 180) / Math.PI;
  const pathDist = runLength * 2 + sep + 2.5;

  ctx.navPortals.push({
    portalId: ctx.nextPortalId(),
    portalKey: `portal_${id}`,
    kind: 'stair',
    fromSurfaceId,
    toSurfaceId,
    fromX: entryX - runDirX * 1.1,
    fromY: baseY,
    fromZ: entryZ - runDirZ * 1.1,
    toX: exitX,
    toY: topY,
    toZ: exitZ,
    fromFloorIndex: 0,
    toFloorIndex: 1,
    width: stairWidth,
    clearanceHeight: 2.3,
    slopeDeg,
    baseCost: pathDist,
    dynamicWaitCost: 0,
    allowedProfilesMask:
      stairWidth >= 2.2 ? INFANTRY_PORTAL_MASK : LIGHT_INFANTRY_MASK,
    maxConcurrentOccupants: 6,
    activeOccupants: 0,
    enabled: true,
    bidirectional: true,
  });
}

/**
 * Adds a single-flight exterior ramp from ground to an accessible bunker/building roof or deck.
 */
export function buildSingleFlightRamp(
  ctx: VerticalWorldContext,
  id: string,
  fromSurfaceId: number,
  toSurfaceId: number,
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
  width = 2.6,
  kind: 'ramp' | 'stair' = 'ramp'
): void {
  const { assetManager, resourceManager, collisionWorld, chunkManager, scene, scope } = ctx;
  const deckMat = assetManager.getSharedMaterial('ramp_concrete_steel', {
    pattern: 'concrete',
    repeat: [2, 4],
    roughness: 0.78,
    metalness: 0.18,
    color: 0x7c7468,
  });
  const railMat = assetManager.getSharedMaterial('stair_rail_amber', {
    color: 0xd97706,
    roughness: 0.45,
    metalness: 0.4,
  });

  const grp = new THREE.Group();
  grp.name = `${id}_ramp`;
  const thickness = 0.45;
  addRampVisualFlight(
    grp,
    startX,
    startY,
    startZ,
    endX,
    endY,
    endZ,
    width,
    thickness,
    deckMat,
    railMat,
    resourceManager,
    scope
  );
  chunkManager.registerObject(grp, (startX + endX) * 0.5, (startZ + endZ) * 0.5, scene);

  const slope = createOrientedSlopeRegion({
    id,
    surfaceId: toSurfaceId,
    startX,
    startZ,
    endX,
    endZ,
    width,
    startY,
    endY,
    thickness,
  });
  collisionWorld.addSlope(slope);

  const dx = endX - startX;
  const dz = endZ - startZ;
  const len = Math.max(0.5, Math.hypot(dx, dz));
  const ux = dx / len;
  const uz = dz / len;

  ctx.navPortals.push({
    portalId: ctx.nextPortalId(),
    portalKey: `portal_${id}`,
    kind,
    fromSurfaceId,
    toSurfaceId,
    fromX: startX - ux * 1.0,
    fromY: startY,
    fromZ: startZ - uz * 1.0,
    toX: endX + ux * 1.0,
    toY: endY,
    toZ: endZ + uz * 1.0,
    fromFloorIndex: 0,
    toFloorIndex: 1,
    width,
    clearanceHeight: 2.6,
    slopeDeg: slope.maxSlopeDeg,
    baseCost: len + 2.0,
    dynamicWaitCost: 0,
    allowedProfilesMask: INFANTRY_PORTAL_MASK,
    maxConcurrentOccupants: 6,
    activeOccupants: 0,
    enabled: true,
    bidirectional: true,
  });
}

export interface RooftopAccessOptions {
  buildingId: string;
  x: number;
  baseY: number;
  z: number;
  width: number;
  depth: number;
  roofY: number;
  accessSide: '+x' | '-x';
  accessType: 'switchback_stair' | 'single_ramp' | 'lift_only';
  parapetHeight?: number;
  liftBridgeZ?: number;
}

/**
 * Adds a walkable rooftop deck collider (`roofY`), `1.15m` perimeter parapets with firing embrasure gaps
 * and stair/ramp/lift entry opening, rooftop cover nodes, `ElevatedNavSurfaceDescriptor`,
 * and exterior stairs/ramp connecting ground `0` -> rooftop `surfaceId` (when not `lift_only`).
 */
export function buildBuildingRooftopAccess(
  ctx: VerticalWorldContext,
  opts: RooftopAccessOptions
): number {
  const { assetManager, resourceManager, collisionWorld, chunkManager, scene, scope, coverNodes } = ctx;
  const surfaceId = ctx.nextSurfaceId();
  const halfW = opts.width * 0.5;
  const halfD = opts.depth * 0.5;
  const parapetH = opts.parapetHeight ?? 1.15;
  const parapetT = 0.42;

  const parapetMat = assetManager.getSharedMaterial('roof_parapet_concrete', {
    pattern: 'concrete',
    repeat: [2, 1],
    roughness: 0.85,
    color: 0x626973,
  });

  const grp = new THREE.Group();
  grp.name = `${opts.buildingId}_rooftop_parapets`;

  // Entry portal side & center Z for stair/ramp/lift opening
  const sideSign = opts.accessSide === '+x' ? 1 : -1;
  const gapCenterZ = opts.liftBridgeZ ?? opts.z;
  const gateGapHalfZ = 1.9;

  // +Z & -Z parapets with central firing embrasure gap (2.2m wide so players/AI can shoot or step cover cleanly)
  for (const zSign of [-1, 1]) {
    const pz = opts.z + zSign * (halfD - parapetT * 0.5);
    const segW = Math.max(1.2, (opts.width - 2.4) * 0.5);
    for (const xSign of [-1, 1]) {
      const px = opts.x + xSign * (halfW - segW * 0.5);
      addVisualBox(
        grp,
        segW,
        parapetH,
        parapetT,
        px,
        opts.roofY + parapetH * 0.5,
        pz,
        parapetMat,
        resourceManager,
        scope,
        `${opts.buildingId}_parapet_z_${zSign}_${xSign}`
      );
      collisionWorld.addStaticBox({
        id: `${opts.buildingId}_parapet_z_${zSign}_${xSign}`,
        minX: px - segW * 0.5,
        minY: opts.roofY,
        minZ: pz - parapetT * 0.5,
        maxX: px + segW * 0.5,
        maxY: opts.roofY + parapetH,
        maxZ: pz + parapetT * 0.5,
        layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
        tag: 'parapet',
        entityId: opts.buildingId,
      });
    }
  }

  // +X & -X parapets: leave stair/ramp/lift entry gap on accessSide around gapCenterZ
  for (const xSign of [-1, 1]) {
    const px = opts.x + xSign * (halfW - parapetT * 0.5);
    const gapHalf = xSign === sideSign ? gateGapHalfZ : 1.0;
    const localGapZ = xSign === sideSign ? gapCenterZ : opts.z;
    const minSideZ = opts.z - halfD + parapetT;
    const maxSideZ = opts.z + halfD - parapetT;
    const leftSegMin = minSideZ;
    const leftSegMax = localGapZ - gapHalf;
    const rightSegMin = localGapZ + gapHalf;
    const rightSegMax = maxSideZ;

    for (const [segIdx, sMin, sMax] of [
      [0, leftSegMin, leftSegMax],
      [1, rightSegMin, rightSegMax],
    ] as const) {
      const segD = sMax - sMin;
      if (segD < 0.8) continue;
      const pz = (sMin + sMax) * 0.5;
      addVisualBox(
        grp,
        parapetT,
        parapetH,
        segD,
        px,
        opts.roofY + parapetH * 0.5,
        pz,
        parapetMat,
        resourceManager,
        scope,
        `${opts.buildingId}_parapet_x_${xSign}_${segIdx}`
      );
      collisionWorld.addStaticBox({
        id: `${opts.buildingId}_parapet_x_${xSign}_${segIdx}`,
        minX: px - parapetT * 0.5,
        minY: opts.roofY,
        minZ: sMin,
        maxX: px + parapetT * 0.5,
        maxY: opts.roofY + parapetH,
        maxZ: sMax,
        layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
        tag: 'parapet',
        entityId: opts.buildingId,
      });
    }
  }

  chunkManager.registerObject(grp, opts.x, opts.z, scene);

  // Register rooftop cover nodes tucked inside each parapet
  coverNodes.push(
    new THREE.Vector3(opts.x - halfW + 2.0, opts.roofY, opts.z - halfD + 2.0),
    new THREE.Vector3(opts.x + halfW - 2.0, opts.roofY, opts.z - halfD + 2.0),
    new THREE.Vector3(opts.x - halfW + 2.0, opts.roofY, opts.z + halfD - 2.0),
    new THREE.Vector3(opts.x + halfW - 2.0, opts.roofY, opts.z + halfD - 2.0)
  );

  // Register bounded ElevatedNavSurface
  ctx.elevatedSurfaces.push({
    surfaceId,
    name: `${opts.buildingId}_rooftop`,
    minX: opts.x - halfW,
    maxX: opts.x + halfW,
    minZ: opts.z - halfD,
    maxZ: opts.z + halfD,
    elevationY: opts.roofY,
    cellSize: 1.25,
  });

  // Exterior staircase or single assault ramp
  const stairEdgeX = opts.x + sideSign * (halfW + 1.5);
  const deckEntryX = opts.x + sideSign * (halfW - 1.3);

  if (opts.accessType === 'switchback_stair') {
    const runLen = Math.min(8.2, Math.max(6.2, (opts.roofY - opts.baseY) * 1.1));
    const entryZ = opts.z - runLen * 0.5;
    buildSwitchbackStaircase(
      ctx,
      `${opts.buildingId}_stair`,
      0,
      surfaceId,
      stairEdgeX + sideSign * 2.75,
      opts.baseY,
      entryZ,
      deckEntryX,
      opts.roofY,
      entryZ,
      0,
      1,
      runLen,
      2.4
    );
  } else if (opts.accessType === 'single_ramp') {
    const runLen = Math.max(9.5, (opts.roofY - opts.baseY) * 2.0);
    const rampStartZ = opts.z + runLen * 0.5;
    const rampEndZ = opts.z - 0.5;
    // Top landing pad connecting ramp end into parapet opening
    addVisualBox(
      grp,
      3.4,
      0.42,
      3.0,
      opts.x + sideSign * (halfW + 0.5),
      opts.roofY - 0.21,
      rampEndZ,
      parapetMat,
      resourceManager,
      scope,
      `${opts.buildingId}_ramp_top_pad`
    );
    collisionWorld.addStaticBox({
      id: `${opts.buildingId}_ramp_top_pad`,
      minX: opts.x + sideSign * (halfW + 0.5) - 1.7,
      minY: opts.roofY - 0.42,
      minZ: rampEndZ - 1.5,
      maxX: opts.x + sideSign * (halfW + 0.5) + 1.7,
      maxY: opts.roofY,
      maxZ: rampEndZ + 1.5,
      layer: COLLISION_LAYER.WORLD,
      tag: 'stair_landing',
      entityId: opts.buildingId,
    });
    buildSingleFlightRamp(
      ctx,
      `${opts.buildingId}_ramp`,
      0,
      surfaceId,
      stairEdgeX,
      opts.baseY,
      rampStartZ,
      stairEdgeX,
      opts.roofY,
      rampEndZ + 1.2,
      2.6,
      'ramp'
    );
    // Shift last portal exit onto the rooftop deck
    const p = ctx.navPortals[ctx.navPortals.length - 1];
    p.toX = deckEntryX;
    p.toZ = rampEndZ;
  }

  return surfaceId;
}

/**
 * Upgrades or places a walkable 9.0m Watchtower with 2-flight 2.4m switchback ramp,
 * 5.2x5.2m upper deck, 1.15m perimeter firing parapets, roof canopy, ElevatedNavSurface,
 * and bidirectional NavPortal.
 */
export function buildWalkableWatchtower(
  ctx: VerticalWorldContext,
  id: string,
  x: number,
  z: number,
  baseY: number,
  rampSide: '+x' | '-x' = '+x'
): number {
  const { assetManager, resourceManager, collisionWorld, chunkManager, scene, scope, coverNodes } = ctx;
  const deckY = baseY + 9.0;
  const surfaceId = ctx.nextSurfaceId();
  const halfDeck = 2.6;

  const steel = assetManager.getSharedMaterial('tower_steel_v2', {
    pattern: 'metal_plate',
    roughness: 0.48,
    metalness: 0.7,
    color: 0x4b5563,
  });
  const railMat = assetManager.getSharedMaterial('stair_rail_amber', {
    color: 0xd97706,
    roughness: 0.45,
    metalness: 0.4,
  });

  const grp = new THREE.Group();
  grp.name = `${id}_walkable_watchtower`;

  // 4 Corner support legs at ±2.1m (leaves central ground space open!)
  const legGeo = new THREE.CylinderGeometry(0.22, 0.28, 9.2, 8);
  resourceManager.registerGeometry(legGeo, scope);
  for (const [lx, lz, tagIdx] of [
    [-2.0, -2.0, 'NW'],
    [2.0, -2.0, 'NE'],
    [-2.0, 2.0, 'SW'],
    [2.0, 2.0, 'SE'],
  ] as const) {
    const leg = new THREE.Mesh(legGeo, steel);
    leg.position.set(x + lx, baseY + 4.6, z + lz);
    leg.castShadow = true;
    grp.add(leg);
    collisionWorld.addStaticBox({
      id: `${id}_leg_${tagIdx}`,
      minX: x + lx - 0.3,
      minY: baseY,
      minZ: z + lz - 0.3,
      maxX: x + lx + 0.3,
      maxY: deckY,
      maxZ: z + lz + 0.3,
      layer: COLLISION_LAYER.WORLD,
      tag: 'building_pillar',
      entityId: id,
    });
  }

  // Main 5.2 x 5.2m elevated platform deck at y = deckY
  addVisualBox(
    grp,
    5.2,
    0.45,
    5.2,
    x,
    deckY - 0.225,
    z,
    steel,
    resourceManager,
    scope,
    `${id}_deck`
  );
  collisionWorld.addStaticBox({
    id: `${id}_deck`,
    minX: x - halfDeck,
    minY: deckY - 0.45,
    minZ: z - halfDeck,
    maxX: x + halfDeck,
    maxY: deckY,
    maxZ: z + halfDeck,
    layer: COLLISION_LAYER.WORLD,
    tag: 'elevated_deck',
    entityId: id,
  });

  // Elevated canopy roof supported by thin upper posts (`deckY + 2.4 .. deckY + 3.2`, ample 2.4m standing headroom!)
  addVisualBox(
    grp,
    5.6,
    0.35,
    5.6,
    x,
    deckY + 2.65,
    z,
    steel,
    resourceManager,
    scope,
    `${id}_canopy_roof`
  );
  collisionWorld.addStaticBox({
    id: `${id}_canopy_roof`,
    minX: x - 2.8,
    minY: deckY + 2.48,
    minZ: z - 2.8,
    maxX: x + 2.8,
    maxY: deckY + 2.85,
    maxZ: z + 2.8,
    layer: COLLISION_LAYER.WORLD,
    tag: 'building_roof',
    entityId: id,
  });

  // 1.15m perimeter parapets on 3 closed sides + open side facing ramp entry
  const pH = 1.15;
  const sideSign = rampSide === '+x' ? 1 : -1;
  // North (-Z) and South (+Z) full parapets
  for (const zSign of [-1, 1]) {
    const pz = z + zSign * (halfDeck - 0.16);
    addVisualBox(
      grp,
      5.0,
      pH,
      0.32,
      x,
      deckY + pH * 0.5,
      pz,
      railMat,
      resourceManager,
      scope,
      `${id}_parapet_z_${zSign}`
    );
    collisionWorld.addStaticBox({
      id: `${id}_parapet_z_${zSign}`,
      minX: x - 2.5,
      minY: deckY,
      minZ: pz - 0.16,
      maxX: x + 2.5,
      maxY: deckY + pH,
      maxZ: pz + 0.16,
      layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      tag: 'parapet',
      entityId: id,
    });
  }
  // Opposite X side parapet
  const oppPx = x - sideSign * (halfDeck - 0.16);
  addVisualBox(
    grp,
    0.32,
    pH,
    4.6,
    oppPx,
    deckY + pH * 0.5,
    z,
    railMat,
    resourceManager,
    scope,
    `${id}_parapet_opp`
  );
  collisionWorld.addStaticBox({
    id: `${id}_parapet_opp`,
    minX: oppPx - 0.16,
    minY: deckY,
    minZ: z - 2.3,
    maxX: oppPx + 0.16,
    maxY: deckY + pH,
    maxZ: z + 2.3,
    layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
    tag: 'parapet',
    entityId: id,
  });

  chunkManager.registerObject(grp, x, z, scene);

  // Elevated cover nodes on deck
  coverNodes.push(
    new THREE.Vector3(x - sideSign * 1.1, deckY, z - 1.2),
    new THREE.Vector3(x - sideSign * 1.1, deckY, z + 1.2)
  );

  // Bounded nav surface for watchtower deck
  ctx.elevatedSurfaces.push({
    surfaceId,
    name: `${id}_deck`,
    minX: x - halfDeck,
    maxX: x + halfDeck,
    minZ: z - halfDeck,
    maxZ: z + halfDeck,
    elevationY: deckY,
    cellSize: 1.0,
  });

  // Switchback 2-flight stair-ramp (0 -> +4.5m landing -> +9.0m deck, ~28° pitch)
  const f1X = x + sideSign * (halfDeck + 4.25);
  const entryZ = z - 4.2;
  buildSwitchbackStaircase(
    ctx,
    `${id}_stair`,
    0,
    surfaceId,
    f1X,
    baseY,
    entryZ,
    x + sideSign * 1.3,
    deckY,
    z - 0.8,
    0,
    1,
    8.4,
    2.4
  );

  return surfaceId;
}

export interface MultiStopLiftBuildStop {
  floorId: string;
  label: string;
  elevationY: number;
  surfaceId: number;
  roofCenterX?: number;
  roofCenterZ?: number;
  /** Optional explicit gate exit sign on `entryAxis` (1 or -1) for this floor */
  gateSign?: 1 | -1;
}

export interface MultiStopCargoLiftOptions {
  liftId: string;
  liftName: string;
  shaftCenterX: number;
  shaftCenterZ: number;
  entryAxis: 'x' | 'z';
  entrySign: 1 | -1; // Direction FROM shaft center TOWARD building rooftop/floor
  stops: MultiStopLiftBuildStop[];
  speedMetersPerSec?: number;
}

/**
 * Constructs a physical multi-stop Cargo Lift shaft (`2-stop` or `3-stop`), moving platform collider,
 * per-floor safety gate colliders, floor bridge walkways into the connected ElevatedNavSurfaces,
 * and pairwise NavPortals connecting all floor stops.
 */
export function buildMultiStopCargoLift(
  ctx: VerticalWorldContext,
  opts: MultiStopCargoLiftOptions
): CargoLiftDefinition {
  const { assetManager, resourceManager, collisionWorld, scene, scope } = ctx;
  const halfW = 1.95;
  const halfD = 1.95;
  const deckT = 0.32;
  const topY = opts.stops[opts.stops.length - 1].elevationY;
  const minStopY = opts.stops[0].elevationY;

  const frameMat = assetManager.getSharedMaterial('lift_frame_steel', {
    pattern: 'metal_plate',
    color: 0x334155,
    roughness: 0.45,
    metalness: 0.72,
  });
  const platMat = assetManager.getSharedMaterial('lift_platform_hazard', {
    pattern: 'warning_stripe',
    repeat: [2, 2],
    roughness: 0.55,
    metalness: 0.38,
    color: 0xf59e0b,
  });
  const gateMat = assetManager.getSharedMaterial('lift_gate_amber', {
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.55,
    roughness: 0.35,
  });
  const beaconMat = assetManager.getSharedMaterial('lift_beacon_cyan', {
    color: 0x06b6d4,
    emissive: 0x06b6d4,
    emissiveIntensity: 0.9,
  });

  const staticGroup = new THREE.Group();
  staticGroup.name = `${opts.liftId}_shaft`;

  // 4 Structural corner columns running up the entire shaft
  const shaftH = topY - minStopY + 3.4;
  for (const [cx, cz] of [
    [-halfW - 0.14, -halfD - 0.14],
    [halfW + 0.14, -halfD - 0.14],
    [-halfW - 0.14, halfD + 0.14],
    [halfW + 0.14, halfD + 0.14],
  ]) {
    addVisualBox(
      staticGroup,
      0.24,
      shaftH,
      0.24,
      opts.shaftCenterX + cx,
      minStopY + shaftH * 0.5,
      opts.shaftCenterZ + cz,
      frameMat,
      resourceManager,
      scope,
      `${opts.liftId}_col`
    );
  }

  // Overhead shaft crown beam (defines shaftCeilingY safety envelope)
  const shaftCeilingY = topY + 3.4;
  addVisualBox(
    staticGroup,
    halfW * 2 + 0.6,
    0.35,
    halfD * 2 + 0.6,
    opts.shaftCenterX,
    shaftCeilingY + 0.18,
    opts.shaftCenterZ,
    frameMat,
    resourceManager,
    scope,
    `${opts.liftId}_crown`
  );

  // Outer side guardrails of lift shaft on the two perpendicular sides so occupants stay inside
  const gateColliders = new Map<number, SpatialAABB>();
  const gateMeshes = new Map<number, THREE.Object3D>();
  const floorStops: CargoLiftFloorStop[] = [];
  const portalIds: string[] = [];

  for (let i = 0; i < opts.stops.length; i++) {
    const s = opts.stops[i];
    const axisSign = s.gateSign ?? (s.surfaceId === 0 ? -opts.entrySign : opts.entrySign);
    const toSurfaceDirX = opts.entryAxis === 'x' ? axisSign : 0;
    const toSurfaceDirZ = opts.entryAxis === 'z' ? axisSign : 0;

    const gateX = opts.shaftCenterX + toSurfaceDirX * (halfW + 0.12);
    const gateZ = opts.shaftCenterZ + toSurfaceDirZ * (halfD + 0.12);
    const gateW = opts.entryAxis === 'x' ? 0.18 : halfW * 1.9;
    const gateD = opts.entryAxis === 'z' ? 0.18 : halfD * 1.9;

    const gateMesh = addVisualBox(
      staticGroup,
      gateW,
      1.15,
      gateD,
      gateX,
      s.elevationY + 0.58,
      gateZ,
      gateMat,
      resourceManager,
      scope,
      `${opts.liftId}_lift_gate_${i}`
    );
    gateMesh.userData.dynamicPlatform = true;
    gateMesh.visible = i !== 0;
    gateMeshes.set(i, gateMesh);

    const gateColliderId = `${opts.liftId}_gate_${i}`;
    const gateBox: SpatialAABB = {
      id: gateColliderId,
      minX: gateX - gateW * 0.5,
      minY: s.elevationY,
      minZ: gateZ - gateD * 0.5,
      maxX: gateX + gateW * 0.5,
      maxY: s.elevationY + 1.65,
      maxZ: gateZ + gateD * 0.5,
      layer: i === 0 ? COLLISION_LAYER.TRIGGER : COLLISION_LAYER.WORLD,
      tag: 'cargo_lift_gate',
      entityId: opts.liftId,
    };
    collisionWorld.addStaticBox(gateBox);
    gateColliders.set(i, gateBox);

    // Walkway landing bridge on elevated stops so there is zero gap between lift platform and connected surface
    if (s.surfaceId !== 0) {
      const bridgeX = opts.shaftCenterX + toSurfaceDirX * (halfW + 1.15);
      const bridgeZ = opts.shaftCenterZ + toSurfaceDirZ * (halfD + 1.15);
      const bw = opts.entryAxis === 'x' ? 2.6 : halfW * 2;
      const bd = opts.entryAxis === 'z' ? 2.6 : halfD * 2;
      addVisualBox(
        staticGroup,
        bw,
        0.34,
        bd,
        bridgeX,
        s.elevationY - 0.17,
        bridgeZ,
        frameMat,
        resourceManager,
        scope,
        `${opts.liftId}_bridge_${i}`
      );
      collisionWorld.addStaticBox({
        id: `${opts.liftId}_bridge_${i}`,
        minX: bridgeX - bw * 0.5,
        minY: s.elevationY - 0.34,
        minZ: bridgeZ - bd * 0.5,
        maxX: bridgeX + bw * 0.5,
        maxY: s.elevationY,
        maxZ: bridgeZ + bd * 0.5,
        layer: COLLISION_LAYER.WORLD,
        tag: 'elevated_deck',
        entityId: opts.liftId,
      });
    }

    // Call beacon pillar beside floor gate
    const callWaitX = opts.shaftCenterX + toSurfaceDirX * (halfW + 1.55);
    const callWaitZ = opts.shaftCenterZ + toSurfaceDirZ * (halfD + 1.55);
    const beaconSideX = opts.entryAxis === 'x' ? 0 : halfW + 0.35;
    const beaconSideZ = opts.entryAxis === 'z' ? 0 : halfD + 0.35;
    const beacon = addVisualBox(
      staticGroup,
      0.26,
      1.35,
      0.26,
      callWaitX + beaconSideX * 0.65,
      s.elevationY + 0.68,
      callWaitZ + beaconSideZ * 0.65,
      beaconMat,
      resourceManager,
      scope,
      `${opts.liftId}_beacon_${i}`
    );
    beacon.userData.skipBvh = true;

    const exitX = opts.shaftCenterX + toSurfaceDirX * (halfW + 1.9);
    const exitZ = opts.shaftCenterZ + toSurfaceDirZ * (halfD + 1.9);

    floorStops.push({
      floorIndex: i,
      floorId: s.floorId,
      label: s.label,
      elevationY: s.elevationY,
      surfaceId: s.surfaceId,
      boardingWaitPos: { x: callWaitX, y: s.elevationY, z: callWaitZ },
      exitPos: { x: exitX, y: s.elevationY, z: exitZ },
      clearanceHeight: 2.5,
      gateColliderId,
      portalIds: [],
    });
  }

  scene.add(staticGroup);
  resourceManager.register('object3d', scope, () => scene.remove(staticGroup));

  // Moving Lift Platform Group (y === currentY)
  const platformGroup = new THREE.Group();
  platformGroup.name = `${opts.liftId}_lift_platform_group`;
  platformGroup.position.set(opts.shaftCenterX, minStopY, opts.shaftCenterZ);

  const platMesh = addVisualBox(
    platformGroup,
    halfW * 2,
    deckT,
    halfD * 2,
    0,
    -deckT * 0.5,
    0,
    platMat,
    resourceManager,
    scope,
    `${opts.liftId}_lift_platform`
  );
  platMesh.userData.dynamicPlatform = true;

  // Low side cage bars on platform
  for (const sSign of [-1, 1]) {
    const cx = opts.entryAxis === 'x' ? 0 : sSign * (halfW - 0.08);
    const cz = opts.entryAxis === 'z' ? 0 : sSign * (halfD - 0.08);
    const cw = opts.entryAxis === 'x' ? halfW * 1.9 : 0.14;
    const cd = opts.entryAxis === 'z' ? halfD * 1.9 : 0.14;
    const bar = addVisualBox(
      platformGroup,
      cw,
      1.05,
      cd,
      cx,
      0.525,
      cz,
      frameMat,
      resourceManager,
      scope,
      `${opts.liftId}_lift_platform_rail`
    );
    bar.userData.dynamicPlatform = true;
  }

  scene.add(platformGroup);
  resourceManager.register('object3d', scope, () => scene.remove(platformGroup));

  const platformCollider: SpatialAABB = {
    id: `${opts.liftId}_platform`,
    minX: opts.shaftCenterX - halfW,
    minY: minStopY - deckT,
    minZ: opts.shaftCenterZ - halfD,
    maxX: opts.shaftCenterX + halfW,
    maxY: minStopY,
    maxZ: opts.shaftCenterZ + halfD,
    layer: COLLISION_LAYER.WORLD,
    tag: 'cargo_lift_platform',
    entityId: opts.liftId,
  };
  collisionWorld.addStaticBox(platformCollider);

  // Register pairwise NavPortals between every floor stop i < j
  const speed = opts.speedMetersPerSec ?? 4.8;
  for (let i = 0; i < floorStops.length; i++) {
    for (let j = i + 1; j < floorStops.length; j++) {
      const a = floorStops[i];
      const b = floorStops[j];
      const portalKey = `portal_${opts.liftId}_${i}_${j}`;
      portalIds.push(portalKey);
      a.portalIds?.push(portalKey);
      b.portalIds?.push(portalKey);
      const travelTime = Math.abs(b.elevationY - a.elevationY) / speed + 1.2;
      ctx.navPortals.push({
        portalId: ctx.nextPortalId(),
        portalKey,
        kind: 'cargo_lift',
        liftId: opts.liftId,
        fromSurfaceId: a.surfaceId,
        toSurfaceId: b.surfaceId,
        fromX: a.boardingWaitPos.x,
        fromY: a.elevationY,
        fromZ: a.boardingWaitPos.z,
        toX: b.exitPos.x,
        toY: b.elevationY,
        toZ: b.exitPos.z,
        fromFloorIndex: a.floorIndex,
        toFloorIndex: b.floorIndex,
        width: 3.4,
        clearanceHeight: 2.5,
        slopeDeg: 0,
        baseCost: travelTime * 2.5,
        dynamicWaitCost: 0.8,
        allowedProfilesMask: INFANTRY_PORTAL_MASK,
        maxConcurrentOccupants: 3,
        activeOccupants: 0,
        enabled: true,
        bidirectional: true,
      });
    }
  }

  const def: CargoLiftDefinition = {
    id: opts.liftId,
    name: opts.liftName,
    centerX: opts.shaftCenterX,
    centerZ: opts.shaftCenterZ,
    halfWidth: halfW,
    halfDepth: halfD,
    deckThickness: deckT,
    speedMetersPerSec: speed,
    maxOccupants: 3,
    maxAiOccupants: 2,
    stops: floorStops,
    initialFloorIndex: 0,
    platformCollider,
    gateColliders,
    platformGroup,
    gateMeshes,
    portalIds,
    shaftCeilingY,
  };
  ctx.cargoLifts.push(def);
  return def;
}

/**
 * Builds an elevated structural steel skybridge spanning between two elevated surfaces
 * with 1.15m side parapets/guardrails, cover nodes, and bidirectional bridge NavPortals.
 */
export function buildElevatedSkybridge(
  ctx: VerticalWorldContext,
  id: string,
  fromSurfaceId: number,
  toSurfaceId: number,
  startX: number,
  endX: number,
  centerZ: number,
  elevationY: number,
  width = 3.8
): number {
  const { assetManager, resourceManager, collisionWorld, chunkManager, scene, scope, coverNodes } = ctx;
  const surfaceId = ctx.nextSurfaceId();
  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const spanW = maxX - minX;
  const cx = (minX + maxX) * 0.5;
  const halfW = width * 0.5;

  const steelMat = assetManager.getSharedMaterial('skybridge_steel', {
    pattern: 'metal_plate',
    repeat: [6, 1],
    roughness: 0.45,
    metalness: 0.72,
    color: 0x3b424d,
  });
  const railMat = assetManager.getSharedMaterial('stair_rail_amber', {
    color: 0xd97706,
    roughness: 0.45,
    metalness: 0.4,
  });

  const grp = new THREE.Group();
  grp.name = `${id}_skybridge`;

  addVisualBox(
    grp,
    spanW,
    0.45,
    width,
    cx,
    elevationY - 0.225,
    centerZ,
    steelMat,
    resourceManager,
    scope,
    `${id}_deck`
  );
  collisionWorld.addStaticBox({
    id: `${id}_deck`,
    minX,
    minY: elevationY - 0.45,
    minZ: centerZ - halfW,
    maxX,
    maxY: elevationY,
    maxZ: centerZ + halfW,
    layer: COLLISION_LAYER.WORLD,
    tag: 'catwalk',
    entityId: id,
  });

  // Side guardrails / tactical cover parapets along +Z and -Z edges of skybridge
  for (const zSign of [-1, 1]) {
    const rz = centerZ + zSign * (halfW - 0.16);
    addVisualBox(
      grp,
      spanW - 0.6,
      1.15,
      0.3,
      cx,
      elevationY + 0.575,
      rz,
      railMat,
      resourceManager,
      scope,
      `${id}_rail_${zSign}`
    );
    collisionWorld.addStaticBox({
      id: `${id}_rail_${zSign}`,
      minX: minX + 0.3,
      minY: elevationY,
      minZ: rz - 0.15,
      maxX: maxX - 0.3,
      maxY: elevationY + 1.15,
      maxZ: rz + 0.15,
      layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      tag: 'parapet',
      entityId: id,
    });
  }

  chunkManager.registerObject(grp, cx, centerZ, scene);
  coverNodes.push(
    new THREE.Vector3(cx - 5, elevationY, centerZ),
    new THREE.Vector3(cx + 5, elevationY, centerZ)
  );

  ctx.elevatedSurfaces.push({
    surfaceId,
    name: `${id}_surface`,
    minX: minX - 1.2,
    maxX: maxX + 1.2,
    minZ: centerZ - halfW,
    maxZ: centerZ + halfW,
    elevationY,
    cellSize: 1.25,
  });

  // Connect West end <-> fromSurfaceId and East end <-> toSurfaceId
  ctx.navPortals.push({
    portalId: ctx.nextPortalId(),
    portalKey: `portal_${id}_west`,
    kind: 'ramp',
    fromSurfaceId,
    toSurfaceId: surfaceId,
    fromX: minX - 0.8,
    fromY: elevationY,
    fromZ: centerZ,
    toX: minX + 0.8,
    toY: elevationY,
    toZ: centerZ,
    fromFloorIndex: 1,
    toFloorIndex: 1,
    width: width - 0.5,
    clearanceHeight: 2.6,
    slopeDeg: 0,
    baseCost: 1.6,
    dynamicWaitCost: 0,
    allowedProfilesMask: INFANTRY_PORTAL_MASK,
    maxConcurrentOccupants: 8,
    activeOccupants: 0,
    enabled: true,
    bidirectional: true,
  });

  ctx.navPortals.push({
    portalId: ctx.nextPortalId(),
    portalKey: `portal_${id}_east`,
    kind: 'ramp',
    fromSurfaceId: surfaceId,
    toSurfaceId,
    fromX: maxX - 0.8,
    fromY: elevationY,
    fromZ: centerZ,
    toX: maxX + 0.8,
    toY: elevationY,
    toZ: centerZ,
    fromFloorIndex: 1,
    toFloorIndex: 1,
    width: width - 0.5,
    clearanceHeight: 2.6,
    slopeDeg: 0,
    baseCost: 1.6,
    dynamicWaitCost: 0,
    allowedProfilesMask: INFANTRY_PORTAL_MASK,
    maxConcurrentOccupants: 8,
    activeOccupants: 0,
    enabled: true,
    bidirectional: true,
  });

  return surfaceId;
}
