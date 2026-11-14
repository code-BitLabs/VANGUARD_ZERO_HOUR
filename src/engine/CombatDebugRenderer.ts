import * as THREE from 'three';
import { ResourceManager } from '@/src/core/ResourceManager';
import {
  EnemyDebugInspectorRow,
  ExplosionTelemetryRecord,
  FlightTelemetrySample,
  ShotTelemetryRecord,
} from '@/src/gameplay/CombatTelemetryRecorder';

const MAX_DEBUG_UNITS = 36;
const MAX_LINE_VERTICES = 1024;

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

    const greenMat = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.78 });
    const redMat = new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.55 });
    const fovMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.42 });
    const lkpMat = new THREE.LineBasicMaterial({ color: 0xeab308, transparent: true, opacity: 0.7 });
    const shotHitMat = new THREE.LineBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.9 });
    const shotCoverMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.8 });
    const flightVecMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.88 });
    const blastRingMat = new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.65 });

    [greenMat, redMat, fovMat, lkpMat, shotHitMat, shotCoverMat, flightVecMat, blastRingMat].forEach((m) =>
      this.resources.registerMaterial(m, 'shared')
    );

    this.root.add(new THREE.LineSegments(this.losGreenGeo, greenMat));
    this.root.add(new THREE.LineSegments(this.losRedGeo, redMat));
    this.root.add(new THREE.LineSegments(this.fovConeGeo, fovMat));
    this.root.add(new THREE.LineSegments(this.lkpLineGeo, lkpMat));
    this.root.add(new THREE.LineSegments(this.shotHitGeo, shotHitMat));
    this.root.add(new THREE.LineSegments(this.shotCoverGeo, shotCoverMat));
    this.root.add(new THREE.LineSegments(this.flightVecGeo, flightVecMat));
    this.root.add(new THREE.LineSegments(this.blastRingGeo, blastRingMat));

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
    recentExplosions: ExplosionTelemetryRecord[] = []
  ): void {
    if (!enabled && !showFlightPaths) {
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

    this.uploadLines(this.losGreenGeo, greenVerts);
    this.uploadLines(this.losRedGeo, redVerts);
    this.uploadLines(this.fovConeGeo, fovVerts);
    this.uploadLines(this.lkpLineGeo, lkpVerts);
    this.uploadLines(this.shotHitGeo, shotHitVerts);
    this.uploadLines(this.shotCoverGeo, shotCoverVerts);
    this.uploadLines(this.flightVecGeo, flightVerts);
    this.uploadLines(this.blastRingGeo, blastVerts);
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
