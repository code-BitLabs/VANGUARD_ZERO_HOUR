import * as THREE from 'three';
import { ResourceManager } from '@/src/core/ResourceManager';
import { PhysicsWorldDiagnosticsSnapshot } from '@/src/engine/physics/PhysicsTypes';
import {
  EnemyDebugInspectorRow,
  ExplosionTelemetryRecord,
  FlightTelemetrySample,
  ShotTelemetryRecord,
} from '@/src/gameplay/CombatTelemetryRecorder';
import type { CameraSpringDebugRay } from '@/src/gameplay/VehicleCameraRig';

const MAX_DEBUG_UNITS = 36;
const MAX_LINE_VERTICES = 1024;
const MAX_COLLIDER_VERTICES = 32768;
const MAX_TRAVERSAL_VERTICES = 4096;

export interface PlayerPhysicsDebugState {
  radius: number;
  height: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  groundNormalX: number;
  groundNormalY: number;
  groundNormalZ: number;
  grounded: boolean;
  climbing: boolean;
}

export class CombatDebugRenderer {
  private readonly root = new THREE.Group();
  private readonly losGreenGeo: THREE.BufferGeometry;
  private readonly losRedGeo: THREE.BufferGeometry;
  private readonly fovConeGeo: THREE.BufferGeometry;
  private readonly lkpLineGeo: THREE.BufferGeometry;
  private readonly shotHitGeo: THREE.BufferGeometry;
  private readonly shotCoverGeo: THREE.BufferGeometry;
  private readonly flightVecGeo: THREE.BufferGeometry;
  private readonly blastRingGeo: THREE.BufferGeometry;
  private readonly colliderWireGeo: THREE.BufferGeometry;
  private readonly slopeWireGeo: THREE.BufferGeometry;
  private readonly ladderWireGeo: THREE.BufferGeometry;
  private readonly playerCapsuleGeo: THREE.BufferGeometry;
  private readonly integrityFlagGeo: THREE.BufferGeometry;
  private readonly contactNormalGeo: THREE.BufferGeometry;
  private readonly blockedMoveGeo: THREE.BufferGeometry;
  private readonly cameraRayGeo: THREE.BufferGeometry;

  private readonly tokenMarkers: THREE.Mesh[] = [];
  private readonly lkpMarkers: THREE.Mesh[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly resources: ResourceManager
  ) {
    this.root.name = 'combat_debug_gizmos';
    this.root.visible = false;
    this.scene.add(this.root);
    this.resources.register('object3d', 'shared', () => {
      this.scene.remove(this.root);
    });

    this.losGreenGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.losRedGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.fovConeGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES * 2);
    this.lkpLineGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.shotHitGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.shotCoverGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.flightVecGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.blastRingGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.colliderWireGeo = this.createDynamicLineGeo(MAX_COLLIDER_VERTICES);
    this.slopeWireGeo = this.createDynamicLineGeo(MAX_TRAVERSAL_VERTICES);
    this.ladderWireGeo = this.createDynamicLineGeo(MAX_TRAVERSAL_VERTICES);
    this.playerCapsuleGeo = this.createDynamicLineGeo(512);
    this.integrityFlagGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.contactNormalGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.blockedMoveGeo = this.createDynamicLineGeo(MAX_LINE_VERTICES);
    this.cameraRayGeo = this.createDynamicLineGeo(16);

    const greenMat = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.78 });
    const redMat = new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.55 });
    const fovMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.42 });
    const lkpMat = new THREE.LineBasicMaterial({ color: 0xeab308, transparent: true, opacity: 0.7 });
    const shotHitMat = new THREE.LineBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.9 });
    const shotCoverMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.8 });
    const flightVecMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.88 });
    const blastRingMat = new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.65 });
    const colliderWireMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.48 });
    const slopeWireMat = new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.92 });
    const ladderWireMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.96 });
    const playerCapsuleMat = new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.95 });
    const integrityFlagMat = new THREE.LineBasicMaterial({ color: 0xff1e42, transparent: true, opacity: 0.98 });
    const contactNormalMat = new THREE.LineBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.95 });
    const blockedMoveMat = new THREE.LineBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.95 });
    const cameraRayMat = new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.95 });

    [
      greenMat,
      redMat,
      fovMat,
      lkpMat,
      shotHitMat,
      shotCoverMat,
      flightVecMat,
      blastRingMat,
      colliderWireMat,
      slopeWireMat,
      ladderWireMat,
      playerCapsuleMat,
      integrityFlagMat,
      contactNormalMat,
      blockedMoveMat,
      cameraRayMat,
    ].forEach((m) => this.resources.registerMaterial(m, 'shared'));

    this.root.add(new THREE.LineSegments(this.losGreenGeo, greenMat));
    this.root.add(new THREE.LineSegments(this.losRedGeo, redMat));
    this.root.add(new THREE.LineSegments(this.fovConeGeo, fovMat));
    this.root.add(new THREE.LineSegments(this.lkpLineGeo, lkpMat));
    this.root.add(new THREE.LineSegments(this.shotHitGeo, shotHitMat));
    this.root.add(new THREE.LineSegments(this.shotCoverGeo, shotCoverMat));
    this.root.add(new THREE.LineSegments(this.flightVecGeo, flightVecMat));
    this.root.add(new THREE.LineSegments(this.blastRingGeo, blastRingMat));
    this.root.add(new THREE.LineSegments(this.colliderWireGeo, colliderWireMat));
    this.root.add(new THREE.LineSegments(this.slopeWireGeo, slopeWireMat));
    this.root.add(new THREE.LineSegments(this.ladderWireGeo, ladderWireMat));
    this.root.add(new THREE.LineSegments(this.playerCapsuleGeo, playerCapsuleMat));
    this.root.add(new THREE.LineSegments(this.integrityFlagGeo, integrityFlagMat));
    this.root.add(new THREE.LineSegments(this.contactNormalGeo, contactNormalMat));
    this.root.add(new THREE.LineSegments(this.blockedMoveGeo, blockedMoveMat));
    this.root.add(new THREE.LineSegments(this.cameraRayGeo, cameraRayMat));

    const crownGeo = new THREE.OctahedronGeometry(0.32, 0);
    const lkpBoxGeo = new THREE.BoxGeometry(0.55, 1.5, 0.55);
    this.resources.registerGeometry(crownGeo, 'shared');
    this.resources.registerGeometry(lkpBoxGeo, 'shared');

    const lkpWireMat = new THREE.MeshBasicMaterial({
      color: 0xeab308,
      wireframe: true,
      transparent: true,
      opacity: 0.72,
    });
    this.resources.registerMaterial(lkpWireMat, 'shared');

    for (let i = 0; i < MAX_DEBUG_UNITS; i++) {
      const crownMat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        wireframe: false,
        transparent: true,
        opacity: 0.9,
      });
      this.resources.registerMaterial(crownMat, 'shared');
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.visible = false;
      this.root.add(crown);
      this.tokenMarkers.push(crown);

      const lkpBox = new THREE.Mesh(lkpBoxGeo, lkpWireMat);
      lkpBox.visible = false;
      this.root.add(lkpBox);
      this.lkpMarkers.push(lkpBox);
    }
  }

  private createDynamicLineGeo(maxVerts: number): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxVerts * 3);
    const attr = new THREE.BufferAttribute(positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    geo.setDrawRange(0, 0);
    this.resources.registerGeometry(geo, 'shared');
    return geo;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  update(
    enabled: boolean,
    units: EnemyDebugInspectorRow[],
    recentShots: ShotTelemetryRecord[],
    playerPos: THREE.Vector3,
    showFlightPaths = false,
    flightSamples: FlightTelemetrySample[] = [],
    recentExplosions: ExplosionTelemetryRecord[] = [],
    showPhysicsColliders = false,
    physicsSnap?: PhysicsWorldDiagnosticsSnapshot,
    cameraSpringRay?: CameraSpringDebugRay,
    playerDebug?: PlayerPhysicsDebugState
  ): void {
    if (!enabled && !showFlightPaths && !showPhysicsColliders) {
      if (this.root.visible) {
        this.root.visible = false;
      }
      return;
    }
    this.root.visible = true;

    const greenVerts: number[] = [];
    const redVerts: number[] = [];
    const fovVerts: number[] = [];
    const lkpVerts: number[] = [];
    const shotHitVerts: number[] = [];
    const shotCoverVerts: number[] = [];
    const flightVerts: number[] = [];
    const blastVerts: number[] = [];
    const colliderVerts: number[] = [];
    const slopeVerts: number[] = [];
    const ladderVerts: number[] = [];
    const playerCapsuleVerts: number[] = [];
    const integrityFlagVerts: number[] = [];
    const contactNormalVerts: number[] = [];
    const blockedMoveVerts: number[] = [];
    const cameraRayVerts: number[] = [];

    const playerChestY = playerPos.y + 1.15;

    for (let i = 0; i < this.tokenMarkers.length; i++) {
      this.tokenMarkers[i].visible = false;
      this.lkpMarkers[i].visible = false;
    }

    if (enabled) {
      const count = Math.min(units.length, MAX_DEBUG_UNITS);
      for (let i = 0; i < count; i++) {
        const u = units[i];
        const eyeY = u.domain === 'air' ? u.y : u.y + 1.55;

        // 1. LOS ray to player
        if (u.hasLos) {
          greenVerts.push(u.x, eyeY, u.z, playerPos.x, playerChestY, playerPos.z);
        } else {
          redVerts.push(u.x, eyeY, u.z, playerPos.x, playerChestY, playerPos.z);
        }

        // 2. Ground unit FOV cone wedges (110 deg / 140 deg when alerted)
        if (u.domain === 'ground') {
          const halfFovRad = ((u.fovDeg * 0.5) * Math.PI) / 180;
          const coneLen = 11.0;
          const leftAng = u.yaw - halfFovRad;
          const rightAng = u.yaw + halfFovRad;
          const midAng = u.yaw;

          const lx = u.x + Math.sin(leftAng) * coneLen;
          const lz = u.z + Math.cos(leftAng) * coneLen;
          const rx = u.x + Math.sin(rightAng) * coneLen;
          const rz = u.z + Math.cos(rightAng) * coneLen;
          const mx = u.x + Math.sin(midAng) * coneLen;
          const mz = u.z + Math.cos(midAng) * coneLen;
          const wy = u.y + 0.25;

          fovVerts.push(
            u.x,
            wy,
            u.z,
            lx,
            wy,
            lz,
            u.x,
            wy,
            u.z,
            rx,
            wy,
            rz,
            lx,
            wy,
            lz,
            mx,
            wy,
            mz,
            mx,
            wy,
            mz,
            rx,
            wy,
            rz
          );
        }

        // 3. Last Known Position wireframe box + tether
        if (u.lkpX !== null && u.lkpY !== null && u.lkpZ !== null && u.lkpAgeSec < 10) {
          const marker = this.lkpMarkers[i];
          marker.position.set(u.lkpX, u.lkpY + 0.75, u.lkpZ);
          marker.visible = true;
          lkpVerts.push(u.x, eyeY, u.z, u.lkpX, u.lkpY + 0.9, u.lkpZ);
        }

        // 4. Active Coordinator Lease Token Crown
        if (u.tokenStatus === 'DIRECT' || u.tokenStatus === 'HEAVY' || u.tokenStatus === 'SUPPRESS') {
          const crown = this.tokenMarkers[i];
          crown.position.set(u.x, eyeY + 0.95, u.z);
          crown.rotation.y += 0.08;
          const mat = crown.material as THREE.MeshBasicMaterial;
          if (u.tokenStatus === 'DIRECT') {
            mat.color.setHex(0x06b6d4); // Cyan: Direct Attack Token
          } else if (u.tokenStatus === 'HEAVY') {
            mat.color.setHex(0xf97316); // Orange: Heavy Attack Token
          } else {
            mat.color.setHex(0xa855f7); // Purple: Suppression Lease
          }
          crown.visible = true;
        }
      }

      // 5. Recent ballistic shot trajectories
      const recentSlice = recentShots.slice(-28);
      for (const s of recentSlice) {
        if (s.outcome === 'hit_player') {
          shotHitVerts.push(s.originX, s.originY, s.originZ, s.endX, s.endY, s.endZ);
        } else if (s.outcome === 'blocked_cover') {
          shotCoverVerts.push(s.originX, s.originY, s.originZ, s.endX, s.endY, s.endZ);
        }
      }
    }

    // 6. Active Flight Vectors & Recent Explosion Perimeter Rings
    if (showFlightPaths) {
      for (const f of flightSamples.slice(0, 48)) {
        const vecLen = Math.max(3, Math.min(24, f.speed * 0.45));
        flightVerts.push(
          f.x,
          f.y,
          f.z,
          f.x + f.dirX * vecLen,
          f.y + f.dirY * vecLen,
          f.z + f.dirZ * vecLen
        );
      }
      for (const ex of recentExplosions.slice(0, 6)) {
        const segs = 16;
        const ry = Math.max(0.25, ex.y + 0.2);
        for (let s = 0; s < segs; s++) {
          const a0 = (s / segs) * Math.PI * 2;
          const a1 = ((s + 1) / segs) * Math.PI * 2;
          blastVerts.push(
            ex.x + Math.cos(a0) * ex.outerRadius,
            ry,
            ex.z + Math.sin(a0) * ex.outerRadius,
            ex.x + Math.cos(a1) * ex.outerRadius,
            ry,
            ex.z + Math.sin(a1) * ex.outerRadius
          );
        }
      }
    }

    // 7. 3D Physics Collider Wireframes, Oriented Slopes, Ladders, Player Capsule, Integrity Beacons, Contact Normals & Camera Ray
    if (showPhysicsColliders && physicsSnap) {
      for (const box of physicsSnap.staticColliderBoxes) {
        if (colliderVerts.length + 72 > MAX_COLLIDER_VERTICES * 3) break;
        const y0 = box.minY;
        const y1 = box.maxY;
        if (
          Math.abs(box.yaw) > 0.001 &&
          box.centerX !== undefined &&
          box.centerZ !== undefined &&
          box.halfExtX !== undefined &&
          box.halfExtZ !== undefined
        ) {
          const cos = Math.cos(box.yaw);
          const sin = Math.sin(box.yaw);
          const cx = box.centerX;
          const cz = box.centerZ;
          const hx = box.halfExtX;
          const hz = box.halfExtZ;

          const xA = cx - hx * cos - hz * sin;
          const zA = cz + hx * sin - hz * cos;
          const xB = cx + hx * cos - hz * sin;
          const zB = cz - hx * sin - hz * cos;
          const xC = cx + hx * cos + hz * sin;
          const zC = cz - hx * sin + hz * cos;
          const xD = cx - hx * cos + hz * sin;
          const zD = cz + hx * sin + hz * cos;

          colliderVerts.push(
            xA, y0, zA, xB, y0, zB,
            xB, y0, zB, xC, y0, zC,
            xC, y0, zC, xD, y0, zD,
            xD, y0, zD, xA, y0, zA,
            xA, y1, zA, xB, y1, zB,
            xB, y1, zB, xC, y1, zC,
            xC, y1, zC, xD, y1, zD,
            xD, y1, zD, xA, y1, zA,
            xA, y0, zA, xA, y1, zA,
            xB, y0, zB, xB, y1, zB,
            xC, y0, zC, xC, y1, zC,
            xD, y0, zD, xD, y1, zD
          );
        } else {
          const x0 = box.minX;
          const z0 = box.minZ;
          const x1 = box.maxX;
          const z1 = box.maxZ;
          colliderVerts.push(
            x0, y0, z0, x1, y0, z0,
            x1, y0, z0, x1, y0, z1,
            x1, y0, z1, x0, y0, z1,
            x0, y0, z1, x0, y0, z0,
            x0, y1, z0, x1, y1, z0,
            x1, y1, z0, x1, y1, z1,
            x1, y1, z1, x0, y1, z1,
            x0, y1, z1, x0, y1, z0,
            x0, y0, z0, x0, y1, z0,
            x1, y0, z0, x1, y1, z0,
            x1, y0, z1, x1, y1, z1,
            x0, y0, z1, x0, y1, z1
          );
        }
      }

      // 7b. OrientedSlopeRegion tilted deck & underside prism wireframes (Green)
      if (physicsSnap.slopeWireframes) {
        for (const s of physicsSnap.slopeWireframes) {
          const startX = s.centerX - s.dirX * s.halfLength;
          const startZ = s.centerZ - s.dirZ * s.halfLength;
          const endX = s.centerX + s.dirX * s.halfLength;
          const endZ = s.centerZ + s.dirZ * s.halfLength;
          const rx = -s.dirZ * s.halfWidth;
          const rz = s.dirX * s.halfWidth;

          // 4 top corners
          const sLx = startX - rx, sLz = startZ - rz;
          const sRx = startX + rx, sRz = startZ + rz;
          const eRx = endX + rx, eRz = endZ + rz;
          const eLx = endX - rx, eLz = endZ - rz;
          const syT = s.startY, syB = s.startY - s.thickness;
          const eyT = s.endY, eyB = s.endY - s.thickness;

          slopeVerts.push(
            // Top walkable deck
            sLx, syT, sLz, sRx, syT, sRz,
            sRx, syT, sRz, eRx, eyT, eRz,
            eRx, eyT, eRz, eLx, eyT, eLz,
            eLx, eyT, eLz, sLx, syT, sLz,
            // Underside slab plane
            sLx, syB, sLz, sRx, syB, sRz,
            sRx, syB, sRz, eRx, eyB, eRz,
            eRx, eyB, eRz, eLx, eyB, eLz,
            eLx, eyB, eLz, sLx, syB, sLz,
            // Vertical corner edges
            sLx, syB, sLz, sLx, syT, sLz,
            sRx, syB, sRz, sRx, syT, sRz,
            eRx, eyB, eRz, eRx, eyT, eRz,
            eLx, eyB, eLz, eLx, eyT, eLz
          );
        }
      }

      // 7c. ClimbableLadder volumes & top step-over exit markers (Bright Cyan)
      if (physicsSnap.ladderWireframes) {
        for (const l of physicsSnap.ladderWireframes) {
          const halfW = l.width * 0.5;
          const tx = -l.normalZ * halfW;
          const tz = l.normalX * halfW;
          const lx = l.x - tx, lz = l.z - tz;
          const rx = l.x + tx, rz = l.z + tz;
          ladderVerts.push(
            // Left and right rails
            lx, l.bottomY, lz, lx, l.topY + 0.9, lz,
            rx, l.bottomY, rz, rx, l.topY + 0.9, rz,
            // Bottom and top bars
            lx, l.bottomY, lz, rx, l.bottomY, rz,
            lx, l.topY, lz, rx, l.topY, rz,
            // Top exit vector + cross marker
            l.x, l.topY + 0.1, l.z, l.topExitX, l.topY + 0.1, l.topExitZ,
            l.topExitX - 0.35, l.topY + 0.1, l.topExitZ, l.topExitX + 0.35, l.topY + 0.1, l.topExitZ,
            l.topExitX, l.topY + 0.1, l.topExitZ - 0.35, l.topExitX, l.topY + 0.1, l.topExitZ + 0.35
          );
        }
      }

      // 7d. Player collision capsule wireframe + velocity vector + ground/slope normal
      if (playerDebug) {
        const px = playerPos.x;
        const py = playerPos.y;
        const pz = playerPos.z;
        const r = playerDebug.radius;
        const h = playerDebug.height;
        const segs = 12;
        for (let i = 0; i < segs; i++) {
          const a0 = (i / segs) * Math.PI * 2;
          const a1 = ((i + 1) / segs) * Math.PI * 2;
          const c0 = Math.cos(a0) * r, s0 = Math.sin(a0) * r;
          const c1 = Math.cos(a1) * r, s1 = Math.sin(a1) * r;
          playerCapsuleVerts.push(
            px + c0, py + 0.04, pz + s0, px + c1, py + 0.04, pz + s1,
            px + c0, py + h, pz + s0, px + c1, py + h, pz + s1
          );
          if (i % 3 === 0) {
            playerCapsuleVerts.push(px + c0, py + 0.04, pz + s0, px + c0, py + h, pz + s0);
          }
        }
        // Velocity vector from torso
        playerCapsuleVerts.push(
          px, py + h * 0.5, pz,
          px + playerDebug.velocityX * 0.35,
          py + h * 0.5 + playerDebug.velocityY * 0.35,
          pz + playerDebug.velocityZ * 0.35
        );
        // Active ground/slope normal from feet
        contactNormalVerts.push(
          px, py + 0.05, pz,
          px + playerDebug.groundNormalX * 1.4,
          py + 0.05 + playerDebug.groundNormalY * 1.4,
          pz + playerDebug.groundNormalZ * 1.4
        );
      }

      // 7e. Structure Reconciliation / Traversal Integrity Violation Beacons (Crimson Red)
      if (physicsSnap.traversalIntegrityFlags) {
        for (const f of physicsSnap.traversalIntegrityFlags) {
          const s = 0.65;
          integrityFlagVerts.push(
            f.x, f.y, f.z, f.x, f.y + 4.0, f.z,
            f.x - s, f.y + 0.8, f.z, f.x + s, f.y + 0.8, f.z,
            f.x, f.y + 0.8, f.z - s, f.x, f.y + 0.8, f.z + s,
            f.x - s, f.y + 0.8, f.z, f.x, f.y + 1.8, f.z,
            f.x + s, f.y + 0.8, f.z, f.x, f.y + 1.8, f.z,
            f.x, f.y + 0.8, f.z - s, f.x, f.y + 1.8, f.z,
            f.x, f.y + 0.8, f.z + s, f.x, f.y + 1.8, f.z
          );
        }
      }

      for (const c of physicsSnap.recentContacts.slice(0, 48)) {
        const len = 1.35;
        contactNormalVerts.push(
          c.pointX,
          c.pointY,
          c.pointZ,
          c.pointX + c.normalX * len,
          c.pointY + c.normalY * len,
          c.pointZ + c.normalZ * len
        );
      }

      for (const b of physicsSnap.blockedVectors.slice(0, 32)) {
        const scale = 14.0;
        blockedMoveVerts.push(
          b.originX,
          b.originY + 0.9,
          b.originZ,
          b.originX + b.desiredDx * scale,
          b.originY + 0.9,
          b.originZ + b.desiredDz * scale
        );
      }

      if (cameraSpringRay?.active) {
        cameraRayVerts.push(
          cameraSpringRay.originX,
          cameraSpringRay.originY,
          cameraSpringRay.originZ,
          cameraSpringRay.endX,
          cameraSpringRay.endY,
          cameraSpringRay.endZ
        );
      }
    }

    this.uploadLines(this.losGreenGeo, greenVerts);
    this.uploadLines(this.losRedGeo, redVerts);
    this.uploadLines(this.fovConeGeo, fovVerts);
    this.uploadLines(this.lkpLineGeo, lkpVerts);
    this.uploadLines(this.shotHitGeo, shotHitVerts);
    this.uploadLines(this.shotCoverGeo, shotCoverVerts);
    this.uploadLines(this.flightVecGeo, flightVerts);
    this.uploadLines(this.blastRingGeo, blastVerts);
    this.uploadLines(this.colliderWireGeo, colliderVerts);
    this.uploadLines(this.slopeWireGeo, slopeVerts);
    this.uploadLines(this.ladderWireGeo, ladderVerts);
    this.uploadLines(this.playerCapsuleGeo, playerCapsuleVerts);
    this.uploadLines(this.integrityFlagGeo, integrityFlagVerts);
    this.uploadLines(this.contactNormalGeo, contactNormalVerts);
    this.uploadLines(this.blockedMoveGeo, blockedMoveVerts);
    this.uploadLines(this.cameraRayGeo, cameraRayVerts);
  }

  private uploadLines(geo: THREE.BufferGeometry, coords: number[]): void {
    const attr = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const maxFloats = Math.min(coords.length, arr.length);
    for (let i = 0; i < maxFloats; i++) {
      arr[i] = coords[i];
    }
    attr.needsUpdate = true;
    geo.setDrawRange(0, Math.floor(maxFloats / 3));
  }
}
