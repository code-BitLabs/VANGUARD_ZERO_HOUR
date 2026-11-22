import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AssetManager } from '@/src/core/AssetManager';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import { CargoLiftDefinition, CargoLiftFloorStop } from '@/src/gameplay/CargoLiftManager';
import {
  AGENT_PROFILE_ALL_INFANTRY_MASK,
  buildAllowedProfilesMask,
} from '@/src/navigation/AgentTraversalProfile';
import { CollisionWorld, createOrientedSlopeRegion } from '@/src/physics/CollisionWorld';
import { createLadderVolume, LadderVolume } from '@/src/physics/LadderVolume';
import { COLLISION_LAYER, SpatialAABB } from '@/src/physics/SpatialHash';
import { ElevatedNavSurfaceDescriptor } from '@/src/workers/WorkerBridge';
import { NavPortalInput } from '@/src/workers/navigationCore';
import { WorldChunkManager } from './WorldChunkManager';
import { globalStructureReconciliation } from './StructureReconciliationRegistry';

export interface VerticalWorldContext {
  missionId?: number;
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
  colliderMeshes?: Map<string, THREE.Mesh>;
}

const INFANTRY_PORTAL_MASK = AGENT_PROFILE_ALL_INFANTRY_MASK;
const LIGHT_INFANTRY_MASK = buildAllowedProfilesMask(['player', 'standard_infantry']);

const _mergeMat4 = new THREE.Matrix4();
const _mergePos = new THREE.Vector3();
const _mergeQuat = new THREE.Quaternion();
const _mergeEuler = new THREE.Euler();
const _mergeScale = new THREE.Vector3(1, 1, 1);

interface StaticPartSpec {
  geo: THREE.BufferGeometry;
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  rotOrder?: THREE.EulerOrder;
}

function buildMergedStaticMesh(
  parts: StaticPartSpec[],
  mat: THREE.Material,
  res: ResourceManager,
  scope: ResourceScope,
  name: string,
  castShadow: boolean,
  receiveShadow: boolean,
  skipBvh: boolean
): THREE.Mesh | null {
  if (parts.length === 0) return null;
  const transformed: THREE.BufferGeometry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    _mergePos.set(p.x, p.y, p.z);
    _mergeEuler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, p.rotOrder ?? 'XYZ');
    _mergeQuat.setFromEuler(_mergeEuler);
    _mergeMat4.compose(_mergePos, _mergeQuat, _mergeScale);
    p.geo.applyMatrix4(_mergeMat4);
    transformed.push(p.geo);
  }
  const merged = mergeGeometries(transformed, false);
  for (let i = 0; i < transformed.length; i++) {
    transformed[i].dispose();
  }
  if (!merged) return null;
  res.registerGeometry(merged, scope);
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  if (skipBvh) mesh.userData.skipBvh = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

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
  name?: string,
  castShadow = true
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  res.registerGeometry(geo, scope);
  const mesh = new THREE.Mesh(geo, mat);
  if (name) mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
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
  scope: ResourceScope,
  slopeId?: string,
  colliderMeshes?: Map<string, THREE.Mesh>
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
  flightGrp.matrixAutoUpdate = false;
  flightGrp.updateMatrix();

  const deckGeo = new THREE.BoxGeometry(width, thickness, fullLen + 0.16);
  res.registerGeometry(deckGeo, scope);
  const deckMesh = new THREE.Mesh(deckGeo, deckMat);
  deckMesh.position.y = -thickness * 0.5;
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  deckMesh.matrixAutoUpdate = false;
  deckMesh.updateMatrix();
  flightGrp.add(deckMesh);
  if (slopeId && colliderMeshes) {
    colliderMeshes.set(slopeId, deckMesh);
  }

  // Merge side steel stringers + non-slip tread cleats into 1 non-shadow-casting draw call per flight
  const trimParts: StaticPartSpec[] = [];
  for (const side of [-1, 1]) {
    trimParts.push({
      geo: new THREE.BoxGeometry(0.1, 0.95, fullLen),
      x: side * (width * 0.5 - 0.05),
      y: 0.48,
      z: 0,
    });
  }
  const steps = Math.max(4, Math.floor(horizLen / 0.75));
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps - 0.5;
    trimParts.push({
      geo: new THREE.BoxGeometry(width - 0.24, 0.05, 0.22),
      x: 0,
      y: 0.02,
      z: t * fullLen,
    });
  }
  const mergedTrim = buildMergedStaticMesh(
    trimParts,
    railMat,
    res,
    scope,
    'stair_rail_and_treads',
    false,
    true,
    true
  );
  if (mergedTrim) {
    flightGrp.add(mergedTrim);
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
  // Stage 9 PHYS-05: Anchor ground entry strictly to actual terrain elevation at (entryX, entryZ)
  const f1StartX = entryX;
  const f1StartZ = entryZ;
  const f1StartY =
    fromSurfaceId === 0 ? collisionWorld.getTerrainHeightOnly(f1StartX, f1StartZ) : baseY;
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

  // Grounded concrete entry apron beneath Flight 1 nose so sloped terrain never exposes an air gap
  if (fromSurfaceId === 0) {
    const apronW = Math.abs(runDirX) > 0.5 ? 0.9 : stairWidth + 0.1;
    const apronD = Math.abs(runDirZ) > 0.5 ? 0.9 : stairWidth + 0.1;
    const apron = addVisualBox(
      grp,
      apronW,
      0.9,
      apronD,
      f1StartX,
      f1StartY - 0.45,
      f1StartZ,
      deckMat,
      resourceManager,
      scope,
      `${id}_entry_apron`,
      false
    );
    apron.userData.skipBvh = true;
    apron.matrixAutoUpdate = false;
    apron.updateMatrix();
  }

  addRampVisualFlight(
    grp,
    f1StartX,
    f1StartY,
    f1StartZ,
    f1EndX,
    midY,
    f1EndZ,
    stairWidth,
    thickness,
    deckMat,
    railMat,
    resourceManager,
    scope,
    `${id}_flight1`,
    ctx.colliderMeshes
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
      startY: f1StartY,
      endY: midY,
      thickness,
      hasSideRails: true,
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

  // Safety guardrails along exposed outer edges of mid-landing (+runDir far back edge & both lateral flanks)
  const railH = 1.15;
  const railT = 0.22;
  const addLandingRail = (
    railId: string,
    cx: number,
    baseRailY: number,
    cz: number,
    w: number,
    d: number
  ) => {
    addVisualBox(
      grp,
      w,
      railH,
      d,
      cx,
      baseRailY + railH * 0.5,
      cz,
      railMat,
      resourceManager,
      scope,
      railId,
      false
    );
    collisionWorld.addStaticBox({
      id: railId,
      minX: cx - w * 0.5,
      minY: baseRailY,
      minZ: cz - d * 0.5,
      maxX: cx + w * 0.5,
      maxY: baseRailY + railH,
      maxZ: cz + d * 0.5,
      layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      tag: 'parapet',
      entityId: id,
    });
  };

  if (Math.abs(runDirZ) > 0.5) {
    const midBackZ = runDirZ > 0 ? landCenterZ + landHalfZ - railT * 0.5 : landCenterZ - landHalfZ + railT * 0.5;
    addLandingRail(`${id}_mid_rail_back`, landCenterX, midY, midBackZ, landHalfX * 2, railT);
    addLandingRail(`${id}_mid_rail_lat_neg`, landCenterX - landHalfX + railT * 0.5, midY, landCenterZ, railT, landHalfZ * 2);
    addLandingRail(`${id}_mid_rail_lat_pos`, landCenterX + landHalfX - railT * 0.5, midY, landCenterZ, railT, landHalfZ * 2);
  } else {
    const midBackX = runDirX > 0 ? landCenterX + landHalfX - railT * 0.5 : landCenterX - landHalfX + railT * 0.5;
    addLandingRail(`${id}_mid_rail_back`, midBackX, midY, landCenterZ, railT, landHalfZ * 2);
    addLandingRail(`${id}_mid_rail_lat_neg`, landCenterX, midY, landCenterZ - landHalfZ + railT * 0.5, landHalfX * 2, railT);
    addLandingRail(`${id}_mid_rail_lat_pos`, landCenterX, midY, landCenterZ + landHalfZ - railT * 0.5, landHalfX * 2, railT);
  }

  // Support pillar under mid-landing (outside walk path) — Stage 9 PHYS-08: anchored to terrain + physical collider
  const pilCenterX = landCenterX + runDirX * (landSpanAlongRun * 0.42);
  const pilCenterZ = landCenterZ + runDirZ * (landSpanAlongRun * 0.42);
  const pilTerrainY = collisionWorld.getTerrainHeightOnly(pilCenterX, pilCenterZ);
  const pilBottomY = Math.min(baseY, pilTerrainY) - 0.8;
  const pilTopY = midY - 0.42;
  const pilH = Math.max(0.5, pilTopY - pilBottomY);
  addVisualBox(
    grp,
    0.44,
    pilH,
    0.44,
    pilCenterX,
    pilBottomY + pilH * 0.5,
    pilCenterZ,
    deckMat,
    resourceManager,
    scope,
    `${id}_pil`
  );
  collisionWorld.addStaticBox({
    id: `${id}_pil`,
    minX: pilCenterX - 0.24,
    minY: pilBottomY,
    minZ: pilCenterZ - 0.24,
    maxX: pilCenterX + 0.24,
    maxY: pilTopY,
    maxZ: pilCenterZ + 0.24,
    layer: COLLISION_LAYER.WORLD,
    tag: 'building_pillar',
    entityId: id,
  });

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
    scope,
    `${id}_flight2`,
    ctx.colliderMeshes
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
      hasSideRails: true,
    })
  );

  // Top landing connecting f2End to (exitX, topY, exitZ)
  // Stage 9 PHYS-05: Offset top_bridge past f2End along -runDir (0.05m seam) so it NEVER
  // protrudes backward into the upper half of Flight 2 and creates a chest-high blocker!
  const topRunSpan = 2.25;
  const topRunCenterX = f2EndX - runDirX * (topRunSpan * 0.5 - 0.05);
  const topRunCenterZ = f2EndZ - runDirZ * (topRunSpan * 0.5 - 0.05);
  const latF2 = f2EndX * latX + f2EndZ * latZ;
  const latExit = exitX * latX + exitZ * latZ;
  const latMin = Math.min(latF2 - stairWidth * 0.5, latExit - 0.7);
  const latMax = Math.max(latF2 + stairWidth * 0.5, latExit + 0.7);
  const latCenter = (latMin + latMax) * 0.5;
  const latSpan = latMax - latMin;
  const topConnCenterX =
    Math.abs(runDirX) > 0.5 ? topRunCenterX : latCenter * Math.sign(latX || 1);
  const topConnCenterZ =
    Math.abs(runDirZ) > 0.5 ? topRunCenterZ : latCenter * Math.sign(latZ || 1);
  const topConnW = Math.abs(runDirX) * topRunSpan + Math.abs(latX) * latSpan;
  const topConnD = Math.abs(runDirZ) * topRunSpan + Math.abs(latZ) * latSpan;
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
  const topMinX = topConnCenterX - topConnW * 0.5;
  const topMaxX = topConnCenterX + topConnW * 0.5;
  const topMinZ = topConnCenterZ - topConnD * 0.5;
  const topMaxZ = topConnCenterZ + topConnD * 0.5;
  collisionWorld.addStaticBox({
    id: `${id}_top_bridge`,
    minX: topMinX,
    minY: topY - 0.42,
    minZ: topMinZ,
    maxX: topMaxX,
    maxY: topY,
    maxZ: topMaxZ,
    layer: COLLISION_LAYER.WORLD,
    tag: 'stair_landing',
    entityId: id,
  });

  // Safety guardrails along exposed top-bridge edges (far -runDir back edge + outer flank away from deck/roof)
  // Funneling players safely onto the elevated deck without accidental 9m drops while keeping deck entry open.
  const outerLatX = -latX * latSign;
  const outerLatZ = -latZ * latSign;
  if (Math.abs(runDirZ) > 0.5) {
    const topBackZ = runDirZ > 0 ? topMinZ + railT * 0.5 : topMaxZ - railT * 0.5;
    addLandingRail(`${id}_top_rail_back`, topConnCenterX, topY, topBackZ, topConnW, railT);
    const outerFlankX = outerLatX > 0 ? topMaxX - railT * 0.5 : topMinX + railT * 0.5;
    addLandingRail(`${id}_top_rail_outer`, outerFlankX, topY, topConnCenterZ, railT, topConnD);
  } else {
    const topBackX = runDirX > 0 ? topMinX + railT * 0.5 : topMaxX - railT * 0.5;
    addLandingRail(`${id}_top_rail_back`, topBackX, topY, topConnCenterZ, railT, topConnD);
    const outerFlankZ = outerLatZ > 0 ? topMaxZ - railT * 0.5 : topMinZ + railT * 0.5;
    addLandingRail(`${id}_top_rail_outer`, topConnCenterX, topY, outerFlankZ, topConnW, railT);
  }

  chunkManager.registerObject(grp, (entryX + exitX) * 0.5, (entryZ + exitZ) * 0.5, scene);

  const risePerFlight = Math.max(Math.abs(midY - f1StartY), Math.abs(topY - midY));
  const slopeDeg = (Math.atan2(risePerFlight, Math.max(0.5, runLength)) * 180) / Math.PI;
  const pathDist = runLength * 2 + sep + 2.5;

  ctx.navPortals.push({
    portalId: ctx.nextPortalId(),
    portalKey: `portal_${id}`,
    kind: 'stair',
    fromSurfaceId,
    toSurfaceId,
    fromX: entryX - runDirX * 1.1,
    fromY: f1StartY,
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
  // Stage 9 PHYS-05: Anchor ground ramp nose directly to actual terrain elevation
  const anchoredStartY =
    fromSurfaceId === 0 ? collisionWorld.getTerrainHeightOnly(startX, startZ) : startY;
  if (fromSurfaceId === 0) {
    const apron = addVisualBox(
      grp,
      width + 0.1,
      0.9,
      1.0,
      startX,
      anchoredStartY - 0.45,
      startZ,
      deckMat,
      resourceManager,
      scope,
      `${id}_entry_apron`,
      false
    );
    apron.userData.skipBvh = true;
    apron.matrixAutoUpdate = false;
    apron.updateMatrix();
  }
  addRampVisualFlight(
    grp,
    startX,
    anchoredStartY,
    startZ,
    endX,
    endY,
    endZ,
    width,
    thickness,
    deckMat,
    railMat,
    resourceManager,
    scope,
    id,
    ctx.colliderMeshes
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
    startY: anchoredStartY,
    endY,
    thickness,
    hasSideRails: true,
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
    fromY: anchoredStartY,
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
  /** Optional secondary exterior tactical climbable ladder (auto-cuts parapet opening) */
  ladderAccess?: {
    side: '+z' | '-z' | '+x' | '-x';
    offsetAlongWall?: number;
  };
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

  // Stage 9 PHYS-05: Compute stair/ramp exit Z BEFORE building parapets so the parapet opening
  // is ALWAYS centered directly on the physical top landing with zero blockage!
  const sideSign = opts.accessSide === '+x' ? 1 : -1;
  const stairRunLen = Math.min(8.2, Math.max(6.2, (opts.roofY - opts.baseY) * 1.1));
  const clampedStairEntryZ = Math.max(
    opts.z - halfD + 2.5,
    Math.min(opts.z + halfD - 2.5, opts.z - stairRunLen * 0.5)
  );
  const rampRunLen = Math.max(9.5, (opts.roofY - opts.baseY) * 2.0);
  const rampEndZ = opts.z - 0.5;

  const gapCenterZ =
    opts.accessType === 'switchback_stair'
      ? clampedStairEntryZ
      : opts.accessType === 'single_ramp'
        ? rampEndZ
        : (opts.liftBridgeZ ?? opts.z);
  const gateGapHalfZ = 2.05;

  const parapetParts: StaticPartSpec[] = [];
  const parapetColliderIds: string[] = [];

  // +Z & -Z parapets with central firing embrasure gap (2.4m wide — also cleanly accommodates center +z/-z ladders)
  for (const zSign of [-1, 1]) {
    const pz = opts.z + zSign * (halfD - parapetT * 0.5);
    const ladderOnThisWall =
      opts.ladderAccess &&
      ((zSign === 1 && opts.ladderAccess.side === '+z') ||
        (zSign === -1 && opts.ladderAccess.side === '-z'));
    const gapCenterX = ladderOnThisWall ? opts.x + (opts.ladderAccess?.offsetAlongWall ?? 0) : opts.x;
    const gapHalfX = 1.25;
    const minSideX = opts.x - halfW;
    const maxSideX = opts.x + halfW;
    for (const [segIdx, sMin, sMax] of [
      [-1, minSideX, gapCenterX - gapHalfX],
      [1, gapCenterX + gapHalfX, maxSideX],
    ] as const) {
      const segW = sMax - sMin;
      if (segW < 0.8) continue;
      const px = (sMin + sMax) * 0.5;
      const colId = `${opts.buildingId}_parapet_z_${zSign}_${segIdx}`;
      parapetParts.push({
        geo: new THREE.BoxGeometry(segW, parapetH, parapetT),
        x: px,
        y: opts.roofY + parapetH * 0.5,
        z: pz,
      });
      parapetColliderIds.push(colId);
      collisionWorld.addStaticBox({
        id: colId,
        minX: sMin,
        minY: opts.roofY,
        minZ: pz - parapetT * 0.5,
        maxX: sMax,
        maxY: opts.roofY + parapetH,
        maxZ: pz + parapetT * 0.5,
        layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
        tag: 'parapet',
        entityId: opts.buildingId,
      });
    }
  }

  // +X & -X parapets: leave stair/ramp/lift entry gap on accessSide centered directly on gapCenterZ
  for (const xSign of [-1, 1]) {
    const px = opts.x + xSign * (halfW - parapetT * 0.5);
    const ladderOnThisWall =
      opts.ladderAccess &&
      ((xSign === 1 && opts.ladderAccess.side === '+x') ||
        (xSign === -1 && opts.ladderAccess.side === '-x'));
    const gapHalf =
      xSign === sideSign ? gateGapHalfZ : ladderOnThisWall ? 1.2 : 1.0;
    const localGapZ =
      xSign === sideSign
        ? gapCenterZ
        : ladderOnThisWall
          ? opts.z + (opts.ladderAccess?.offsetAlongWall ?? 0)
          : opts.z;
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
      const colId = `${opts.buildingId}_parapet_x_${xSign}_${segIdx}`;
      parapetParts.push({
        geo: new THREE.BoxGeometry(parapetT, parapetH, segD),
        x: px,
        y: opts.roofY + parapetH * 0.5,
        z: pz,
      });
      parapetColliderIds.push(colId);
      collisionWorld.addStaticBox({
        id: colId,
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

  const mergedParapets = buildMergedStaticMesh(
    parapetParts,
    parapetMat,
    resourceManager,
    scope,
    `${opts.buildingId}_parapets_merged`,
    true,
    true,
    false
  );
  if (mergedParapets) {
    grp.add(mergedParapets);
    if (ctx.colliderMeshes) {
      for (const colId of parapetColliderIds) {
        ctx.colliderMeshes.set(colId, mergedParapets);
      }
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
    buildSwitchbackStaircase(
      ctx,
      `${opts.buildingId}_stair`,
      0,
      surfaceId,
      stairEdgeX + sideSign * 2.75,
      opts.baseY,
      clampedStairEntryZ,
      deckEntryX,
      opts.roofY,
      clampedStairEntryZ,
      0,
      1,
      stairRunLen,
      2.4
    );
  } else if (opts.accessType === 'single_ramp') {
    const rampStartZ = opts.z + rampRunLen * 0.5;
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

  // Optional secondary vertical climbable ladder aligned with the parapet opening
  if (opts.ladderAccess) {
    const off = opts.ladderAccess.offsetAlongWall ?? 0;
    let lx = opts.x;
    let lz = opts.z;
    let nx = 0;
    let nz = 0;
    if (opts.ladderAccess.side === '+z') {
      lx = opts.x + off;
      lz = opts.z + halfD + 0.14;
      nz = 1;
    } else if (opts.ladderAccess.side === '-z') {
      lx = opts.x + off;
      lz = opts.z - halfD - 0.14;
      nz = -1;
    } else if (opts.ladderAccess.side === '+x') {
      lx = opts.x + halfW + 0.14;
      lz = opts.z + off;
      nx = 1;
    } else {
      lx = opts.x - halfW - 0.14;
      lz = opts.z + off;
      nx = -1;
    }
    buildClimbableLadder(ctx, {
      id: `${opts.buildingId}_ladder`,
      x: lx,
      z: lz,
      bottomY: opts.baseY,
      topY: opts.roofY,
      normalX: nx,
      normalZ: nz,
      fromSurfaceId: 0,
      toSurfaceId: surfaceId,
      anchorBottomToTerrain: true,
    });
  }

  globalStructureReconciliation.registerStructure({
    missionId: ctx.missionId ?? 1,
    structureId: `${opts.buildingId}_rooftop`,
    kind: 'rooftop_access',
    visualKitId: 'kit_urban_concrete_midrise',
    centerX: opts.x,
    centerZ: opts.z,
    baseY: opts.baseY,
    authoritativeWalkableSopY: opts.roofY,
    width: opts.width,
    depth: opts.depth,
    parapetHeight: parapetH,
    surfaceIds: [surfaceId],
    portalKeys: ctx.navPortals
      .filter((np) => np.toSurfaceId === surfaceId || np.fromSurfaceId === surfaceId)
      .map((np) => np.portalKey),
    colliderIds: [`${opts.buildingId}_parapet_z_-1_-1`, `${opts.buildingId}_parapet_z_1_1`],
  });

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
  rampSide: '+x' | '-x' = '+x',
  runDirZ: 1 | -1 = 1
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

  const towerSteelParts: StaticPartSpec[] = [];
  const towerColliderIds: string[] = [];

  // 4 Corner support legs at ±2.0m — Stage 9 PHYS-05: extend legs deep into sloped terrain so none float
  for (const [lx, lz, tagIdx] of [
    [-2.0, -2.0, 'NW'],
    [2.0, -2.0, 'NE'],
    [-2.0, 2.0, 'SW'],
    [2.0, 2.0, 'SE'],
  ] as const) {
    const legTerrainY = collisionWorld.getTerrainHeightOnly(x + lx, z + lz);
    const legBottomY = Math.min(baseY, legTerrainY) - 1.2;
    const legH = Math.max(9.2, deckY - legBottomY);
    towerSteelParts.push({
      geo: new THREE.CylinderGeometry(0.22, 0.28, legH, 8),
      x: x + lx,
      y: legBottomY + legH * 0.5,
      z: z + lz,
    });
    const legColId = `${id}_leg_${tagIdx}`;
    towerColliderIds.push(legColId);
    collisionWorld.addStaticBox({
      id: legColId,
      minX: x + lx - 0.3,
      minY: legBottomY,
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
  towerSteelParts.push({
    geo: new THREE.BoxGeometry(5.2, 0.45, 5.2),
    x,
    y: deckY - 0.225,
    z,
  });
  towerColliderIds.push(`${id}_deck`);
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
  towerSteelParts.push({
    geo: new THREE.BoxGeometry(5.6, 0.35, 5.6),
    x,
    y: deckY + 2.65,
    z,
  });
  towerColliderIds.push(`${id}_canopy_roof`);
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

  // Merge steel corner canopy posts & structural braces into the same tower steel mesh
  for (const [cx, cz] of [
    [-2.2, -2.2],
    [2.2, -2.2],
    [-2.2, 2.2],
    [2.2, 2.2],
  ] as const) {
    towerSteelParts.push({
      geo: new THREE.CylinderGeometry(0.08, 0.08, 2.55, 6),
      x: x + cx,
      y: deckY + 1.25,
      z: z + cz,
    });
  }
  for (const braceY of [baseY + 3.0, baseY + 6.4]) {
    for (const zSign of [-1, 1]) {
      towerSteelParts.push({
        geo: new THREE.BoxGeometry(3.9, 0.14, 0.14),
        x,
        y: braceY,
        z: z + zSign * 2.0,
        rz: zSign * 0.34,
      });
    }
  }
  const mergedTowerSteel = buildMergedStaticMesh(
    towerSteelParts,
    steel,
    resourceManager,
    scope,
    `${id}_steel_merged`,
    true,
    true,
    false
  );
  if (mergedTowerSteel) {
    grp.add(mergedTowerSteel);
    if (ctx.colliderMeshes) {
      for (const cid of towerColliderIds) ctx.colliderMeshes.set(cid, mergedTowerSteel);
    }
  }

  // 1.15m perimeter parapets on 3 closed sides + open side facing ramp entry (merged into 1 mesh)
  const pH = 1.15;
  const sideSign = rampSide === '+x' ? 1 : -1;
  const towerParapetParts: StaticPartSpec[] = [];
  const towerParapetIds: string[] = [];
  // North (-Z) and South (+Z) full parapets
  for (const zSign of [-1, 1]) {
    const pz = z + zSign * (halfDeck - 0.16);
    const colId = `${id}_parapet_z_${zSign}`;
    towerParapetParts.push({
      geo: new THREE.BoxGeometry(5.0, pH, 0.32),
      x,
      y: deckY + pH * 0.5,
      z: pz,
    });
    towerParapetIds.push(colId);
    collisionWorld.addStaticBox({
      id: colId,
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
  // Opposite X side parapet split around a clean 1.5m central opening for the tactical vertical ladder
  const oppPx = x - sideSign * (halfDeck - 0.16);
  for (const [segIdx, sMin, sMax] of [
    [0, z - 2.3, z - 0.75],
    [1, z + 0.75, z + 2.3],
  ] as const) {
    const segD = sMax - sMin;
    const pz = (sMin + sMax) * 0.5;
    const colId = `${id}_parapet_opp_${segIdx}`;
    towerParapetParts.push({
      geo: new THREE.BoxGeometry(0.32, pH, segD),
      x: oppPx,
      y: deckY + pH * 0.5,
      z: pz,
    });
    towerParapetIds.push(colId);
    collisionWorld.addStaticBox({
      id: colId,
      minX: oppPx - 0.16,
      minY: deckY,
      minZ: sMin,
      maxX: oppPx + 0.16,
      maxY: deckY + pH,
      maxZ: sMax,
      layer: COLLISION_LAYER.WORLD | COLLISION_LAYER.COVER,
      tag: 'parapet',
      entityId: id,
    });
  }
  const mergedTowerParapets = buildMergedStaticMesh(
    towerParapetParts,
    railMat,
    resourceManager,
    scope,
    `${id}_parapets_merged`,
    true,
    true,
    false
  );
  if (mergedTowerParapets) {
    grp.add(mergedTowerParapets);
    if (ctx.colliderMeshes) {
      for (const cid of towerParapetIds) ctx.colliderMeshes.set(cid, mergedTowerParapets);
    }
  }

  // Dual roof floodlight pods on canopy edge (non-shadow casting emissive trim)
  const lampMat = assetManager.getSharedMaterial('watchtower_lamp_emissive', {
    color: 0xfef08a,
    emissive: 0xfacc15,
    emissiveIntensity: 0.85,
  });
  for (const zSign of [-1, 1]) {
    const flood = addVisualBox(
      grp,
      0.48,
      0.24,
      0.32,
      x - sideSign * 2.65,
      deckY + 2.42,
      z + zSign * 1.4,
      lampMat,
      resourceManager,
      scope,
      `${id}_floodlight_${zSign}`,
      false
    );
    flood.userData.skipBvh = true;
    flood.matrixAutoUpdate = false;
    flood.updateMatrix();
  }

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
  // Stage 9 PHYS-05: Align entryZ === z so Flight 2 terminates squarely into the open deck side with zero parapet overlap!
  const f1X = x + sideSign * (halfDeck + 4.25);
  buildSwitchbackStaircase(
    ctx,
    `${id}_stair`,
    0,
    surfaceId,
    f1X,
    baseY,
    z,
    x + sideSign * 1.3,
    deckY,
    z,
    0,
    runDirZ,
    8.4,
    2.4
  );

  // Stage 9 PHYS-09: Secondary tactical vertical climbable ladder on the opposite watchtower flank
  buildClimbableLadder(ctx, {
    id: `${id}_ladder`,
    x: x - sideSign * (halfDeck + 0.14),
    z,
    bottomY: baseY,
    topY: deckY,
    normalX: -sideSign,
    normalZ: 0,
    fromSurfaceId: 0,
    toSurfaceId: surfaceId,
    anchorBottomToTerrain: true,
  });

  globalStructureReconciliation.registerStructure({
    missionId: ctx.missionId ?? 1,
    structureId: id,
    kind: 'walkable_watchtower_9m',
    visualKitId: 'kit_walkable_watchtower_9m',
    centerX: x,
    centerZ: z,
    baseY,
    authoritativeWalkableSopY: deckY,
    midLandingY: baseY + 4.5,
    width: 5.2,
    depth: 5.2,
    parapetHeight: pH,
    surfaceIds: [surfaceId],
    portalKeys: [`portal_${id}_stair`],
    colliderIds: [`${id}_deck`, `${id}_canopy_roof`, `${id}_stair_mid_landing`, `${id}_stair_top_bridge`],
  });

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
  // Stage 9 PHYS-06: Anchor ground stop (`surfaceId === 0`) to real terrain elevation at shaft center
  const shaftTerrainY = collisionWorld.getTerrainHeightOnly(opts.shaftCenterX, opts.shaftCenterZ);
  const resolvedStops = opts.stops.map((s) =>
    s.surfaceId === 0 ? { ...s, elevationY: shaftTerrainY } : s
  );
  const topY = resolvedStops[resolvedStops.length - 1].elevationY;
  const minStopY = resolvedStops[0].elevationY;

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

  // 4 Structural corner columns running up the entire shaft (extended 1.2m into terrain for sloped ground)
  const colBottomY = minStopY - 1.2;
  const shaftH = topY + 3.4 - colBottomY;
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
      colBottomY + shaftH * 0.5,
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

  for (let i = 0; i < resolvedStops.length; i++) {
    const s = resolvedStops[i];
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

  globalStructureReconciliation.registerStructure({
    missionId: ctx.missionId ?? 1,
    structureId: opts.liftId,
    kind: 'multi_stop_cargo_lift',
    visualKitId: 'kit_cargo_lift_gantry',
    centerX: opts.shaftCenterX,
    centerZ: opts.shaftCenterZ,
    baseY: minStopY,
    authoritativeWalkableSopY: topY,
    width: halfW * 2,
    depth: halfD * 2,
    parapetHeight: 1.15,
    surfaceIds: opts.stops.map((s) => s.surfaceId).filter((sid) => sid > 0),
    portalKeys: portalIds,
    colliderIds: [
      `${opts.liftId}_platform`,
      ...opts.stops.map((_, idx) => `${opts.liftId}_gate_${idx}`),
    ],
  });

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

  globalStructureReconciliation.registerStructure({
    missionId: ctx.missionId ?? 1,
    structureId: id,
    kind: 'elevated_skybridge',
    visualKitId: 'kit_foundry_warehouse_hall',
    centerX: cx,
    centerZ,
    baseY: 0,
    authoritativeWalkableSopY: elevationY,
    width: spanW,
    depth: width,
    parapetHeight: 1.15,
    surfaceIds: [surfaceId],
    portalKeys: [`portal_${id}_west`, `portal_${id}_east`],
    colliderIds: [`${id}_deck`, `${id}_rail_-1`, `${id}_rail_1`],
  });

  return surfaceId;
}

export interface ClimbableLadderOptions {
  id: string;
  x: number;
  z: number;
  bottomY?: number;
  topY: number;
  /** Outward unit normal pointing from wall into the climb lane */
  normalX: number;
  normalZ: number;
  width?: number;
  fromSurfaceId?: number;
  toSurfaceId?: number;
  anchorBottomToTerrain?: boolean;
}

/**
 * Stage 9 PHYS-09: Shared vertical climbable ladder builder used across all 5 campaign maps.
 * Generates grounded composite steel side rails, tactical amber rungs, safety grab-hoops at the roof lip,
 * wall stand-off brackets, and registers an authoritative `LadderVolume` inside `CollisionWorld`.
 */
export function buildClimbableLadder(
  ctx: VerticalWorldContext,
  opts: ClimbableLadderOptions
): LadderVolume {
  const { assetManager, resourceManager, collisionWorld, chunkManager, scene, scope } = ctx;
  const nLen = Math.hypot(opts.normalX, opts.normalZ) || 1;
  const nx = opts.normalX / nLen;
  const nz = opts.normalZ / nLen;
  const tx = -nz;
  const tz = nx;
  const width = opts.width ?? 0.92;
  const halfW = width * 0.5;

  const anchorGround = opts.anchorBottomToTerrain ?? (opts.fromSurfaceId ?? 0) === 0;
  const sampleX = opts.x + nx * 0.45;
  const sampleZ = opts.z + nz * 0.45;
  const bottomY = anchorGround
    ? collisionWorld.getTerrainHeightOnly(sampleX, sampleZ)
    : (opts.bottomY ?? 0);
  const topY = opts.topY;
  const height = Math.max(1.2, topY - bottomY);

  const railMat = assetManager.getSharedMaterial('ladder_steel_rail', {
    pattern: 'metal_plate',
    color: 0x334155,
    roughness: 0.45,
    metalness: 0.78,
  });
  const rungMat = assetManager.getSharedMaterial('stair_rail_amber', {
    color: 0xd97706,
    roughness: 0.45,
    metalness: 0.4,
  });

  const grp = new THREE.Group();
  grp.name = `${opts.id}_ladder_group`;

  // Merge vertical steel side rails & wall anchor brackets into 1 mesh, and amber rungs into 1 mesh
  // Two vertical steel side rails extending +1.05m above topY as rooftop safety grab posts
  // and -0.45m below bottomY into terrain for rock-solid grounding on slopes
  const railBottomY = bottomY - 0.45;
  const railTopY = topY + 1.05;
  const railH = railTopY - railBottomY;
  const railAndBracketParts: StaticPartSpec[] = [];
  for (const side of [-1, 1]) {
    railAndBracketParts.push({
      geo: new THREE.BoxGeometry(0.08, railH, 0.08),
      x: opts.x + tx * side * halfW,
      y: railBottomY + railH * 0.5,
      z: opts.z + tz * side * halfW,
    });
  }

  const yaw = Math.atan2(nx, nz);
  for (let by = bottomY + 1.0; by <= topY - 0.3; by += 2.2) {
    for (const side of [-1, 1]) {
      railAndBracketParts.push({
        geo: new THREE.BoxGeometry(0.08, 0.08, 0.28),
        x: opts.x + tx * side * halfW - nx * 0.14,
        y: by,
        z: opts.z + tz * side * halfW - nz * 0.14,
        ry: yaw,
      });
    }
  }
  const mergedRails = buildMergedStaticMesh(
    railAndBracketParts,
    railMat,
    resourceManager,
    scope,
    `${opts.id}_rails_merged`,
    false,
    true,
    true
  );
  if (mergedRails) grp.add(mergedRails);

  // Horizontal climb rungs spaced every 0.34m along the vertical span
  const rungSpacing = 0.34;
  const rungCount = Math.max(3, Math.floor((height - 0.2) / rungSpacing));
  const rungParts: StaticPartSpec[] = [];
  for (let i = 0; i < rungCount; i++) {
    const ry = bottomY + 0.3 + i * rungSpacing;
    if (ry > topY - 0.06) break;
    const rungGeo = new THREE.CylinderGeometry(0.028, 0.028, width, 6);
    rungGeo.rotateZ(Math.PI * 0.5);
    rungParts.push({
      geo: rungGeo,
      x: opts.x,
      y: ry,
      z: opts.z,
      ry: yaw,
    });
  }
  const mergedRungs = buildMergedStaticMesh(
    rungParts,
    rungMat,
    resourceManager,
    scope,
    `${opts.id}_rungs_merged`,
    false,
    true,
    true
  );
  if (mergedRungs) grp.add(mergedRungs);

  chunkManager.registerObject(grp, opts.x, opts.z, scene);

  const volume = createLadderVolume({
    id: opts.id,
    x: opts.x,
    z: opts.z,
    bottomY,
    topY,
    normalX: nx,
    normalZ: nz,
    width,
    topExitX: opts.x - nx * 1.15,
    topExitZ: opts.z - nz * 1.15,
    bottomExitX: opts.x + nx * 0.95,
    bottomExitZ: opts.z + nz * 0.95,
    fromSurfaceId: opts.fromSurfaceId ?? 0,
    toSurfaceId: opts.toSurfaceId ?? 0,
  });
  collisionWorld.addLadder(volume);
  return volume;
}

