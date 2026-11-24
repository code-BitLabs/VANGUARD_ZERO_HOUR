import * as THREE from 'three';
import { ResourceManager } from '@/src/core/ResourceManager';

interface ParticleState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
  scaleStart: number;
  scaleEnd: number;
  rotX: number;
  rotY: number;
  spinX: number;
  spinY: number;
}

interface TracerState {
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  streakLen: number;
  life: number;
  maxLife: number;
}

interface InstancedBatch<T> {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  readonly items: T[];
  activeCount: number;
  stealCursor: number;
}

interface PooledNukeSequence {
  active: boolean;
  elapsed: number;
  maxDuration: number;
  origin: THREE.Vector3;
  shockwaveRing: THREE.Mesh;
  stemMesh: THREE.Mesh;
  capMesh: THREE.Mesh;
  falloutRing: THREE.Mesh;
}

const _vfxPos = new THREE.Vector3();
const _vfxScale = new THREE.Vector3();
const _vfxQuatIdentity = new THREE.Quaternion();
const _vfxQuatSpin = new THREE.Quaternion();
const _vfxEulerSpin = new THREE.Euler();
const _vfxMat4 = new THREE.Matrix4();
const _vfxLookHelper = new THREE.Object3D();

function createParticleBatch(
  name: string,
  capacity: number,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  rootGroup: THREE.Group,
  resourceManager: ResourceManager
): InstancedBatch<ParticleState> {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rootGroup.add(mesh);
  resourceManager.register('object3d', 'shared', () => mesh.dispose(), name);

  const items: ParticleState[] = new Array(capacity);
  for (let i = 0; i < capacity; i++) {
    items[i] = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 0.5,
      gravity: 9.8,
      scaleStart: 0.15,
      scaleEnd: 0.02,
      rotX: 0,
      rotY: 0,
      spinX: 0,
      spinY: 0,
    };
  }
  return {
    mesh,
    capacity,
    items,
    activeCount: 0,
    stealCursor: 0,
  };
}

function allocSlot<T>(batch: InstancedBatch<T>): number {
  if (batch.activeCount < batch.capacity) {
    return batch.activeCount++;
  }
  const idx = batch.stealCursor;
  batch.stealCursor = (batch.stealCursor + 1) % batch.capacity;
  return idx;
}

export class VFXPool {
  private readonly fireBatch: InstancedBatch<ParticleState>;
  private readonly sparkBatch: InstancedBatch<ParticleState>;
  private readonly smokeBatch: InstancedBatch<ParticleState>;
  private readonly exhaustBatch: InstancedBatch<ParticleState>;
  private readonly brassBatch: InstancedBatch<ParticleState>;
  private readonly bloodBatch: InstancedBatch<ParticleState>;
  private readonly particleBatches: ReadonlyArray<InstancedBatch<ParticleState>>;
  private readonly tracerBatch: InstancedBatch<TracerState>;
  private readonly nukePool: PooledNukeSequence[] = [];
  private readonly rootGroup = new THREE.Group();
  private readonly flashLight: THREE.PointLight;
  private flashTimer = 0;
  private maxBudgetRatio = 1.0;

  constructor(
    scene: THREE.Scene,
    resourceManager: ResourceManager
  ) {
    this.rootGroup.name = 'vfx_pool_root';
    scene.add(this.rootGroup);

    this.flashLight = new THREE.PointLight(0xffb347, 0, 24, 2);
    this.rootGroup.add(this.flashLight);

    const sphereGeo = new THREE.IcosahedronGeometry(0.28, 1);
    resourceManager.registerGeometry(sphereGeo, 'shared', 'vfx_particle_geo');

    // Realistic brass cartridge cylinder (replaces spherical brass orbs)
    const brassGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.92, 6);
    brassGeo.rotateZ(Math.PI * 0.5);
    resourceManager.registerGeometry(brassGeo, 'shared', 'vfx_brass_geo');

    // Slim 1.8cm ballistic tracer bolt scaled per-shot to 1.2m-4.2m streak length (never viewport-spanning)
    const tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1.0);
    resourceManager.registerGeometry(tracerGeo, 'shared', 'vfx_tracer_geo');

    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    resourceManager.registerMaterial(tracerMat, 'shared', 'vfx_tracer_mat');

    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff8c38,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0x2d3238,
      roughness: 0.96,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    const exhaustMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.92,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a038, metalness: 0.85, roughness: 0.25 });
    const bloodMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      roughness: 0.82,
      metalness: 0.05,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    resourceManager.registerMaterial(fireMat, 'shared', 'vfx_fire_mat');
    resourceManager.registerMaterial(smokeMat, 'shared', 'vfx_smoke_mat');
    resourceManager.registerMaterial(exhaustMat, 'shared', 'vfx_exhaust_mat');
    resourceManager.registerMaterial(sparkMat, 'shared', 'vfx_spark_mat');
    resourceManager.registerMaterial(brassMat, 'shared', 'vfx_brass_mat');
    resourceManager.registerMaterial(bloodMat, 'shared', 'vfx_blood_mat');

    // GPU-instanced batches replacing 200+ individual particle Mesh scene nodes
    this.fireBatch = createParticleBatch('vfx_fire_instanced', 50, sphereGeo, fireMat, this.rootGroup, resourceManager);
    this.sparkBatch = createParticleBatch('vfx_spark_instanced', 30, sphereGeo, sparkMat, this.rootGroup, resourceManager);
    this.smokeBatch = createParticleBatch('vfx_smoke_instanced', 60, sphereGeo, smokeMat, this.rootGroup, resourceManager);
    this.exhaustBatch = createParticleBatch('vfx_exhaust_instanced', 20, sphereGeo, exhaustMat, this.rootGroup, resourceManager);
    this.brassBatch = createParticleBatch('vfx_brass_instanced', 20, brassGeo, brassMat, this.rootGroup, resourceManager);
    this.bloodBatch = createParticleBatch('vfx_blood_instanced', 20, sphereGeo, bloodMat, this.rootGroup, resourceManager);
    this.particleBatches = [
      this.fireBatch,
      this.sparkBatch,
      this.smokeBatch,
      this.exhaustBatch,
      this.brassBatch,
      this.bloodBatch,
    ];

    const tracerMesh = new THREE.InstancedMesh(tracerGeo, tracerMat, 48);
    tracerMesh.name = 'vfx_tracer_instanced';
    tracerMesh.count = 0;
    tracerMesh.visible = false;
    tracerMesh.frustumCulled = false;
    tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rootGroup.add(tracerMesh);
    resourceManager.register('object3d', 'shared', () => tracerMesh.dispose(), 'vfx_tracer_instanced');

    const tracerItems: TracerState[] = new Array(48);
    for (let i = 0; i < 48; i++) {
      tracerItems[i] = {
        startX: 0,
        startY: 0,
        startZ: 0,
        endX: 0,
        endY: 0,
        endZ: 0,
        streakLen: 1.5,
        life: 0,
        maxLife: 0.06,
      };
    }
    this.tracerBatch = {
      mesh: tracerMesh,
      capacity: 48,
      items: tracerItems,
      activeCount: 0,
      stealCursor: 0,
    };

    // Pre-allocate pooled multi-stage Strategic Nuclear VFX rig (max 2 concurrent)
    const shockGeo = new THREE.TorusGeometry(1.0, 0.08, 8, 48);
    shockGeo.rotateX(Math.PI / 2);
    const stemGeo = new THREE.CylinderGeometry(1.0, 1.4, 1.0, 16);
    const capGeo = new THREE.SphereGeometry(1.0, 16, 12);
    const falloutGeo = new THREE.RingGeometry(0.95, 1.0, 48);
    falloutGeo.rotateX(-Math.PI / 2);
    [shockGeo, stemGeo, capGeo, falloutGeo].forEach((g, idx) =>
      resourceManager.registerGeometry(g, 'shared', `vfx_nuke_geo_${idx}`)
    );

    for (let i = 0; i < 2; i++) {
      const shockMat = new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.85, depthWrite: false });
      const stemMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.72, depthWrite: false });
      const capMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.78, depthWrite: false });
      const falloutMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      [shockMat, stemMat, capMat, falloutMat].forEach((m) => resourceManager.registerMaterial(m, 'shared'));

      const shockwaveRing = new THREE.Mesh(shockGeo, shockMat);
      const stemMesh = new THREE.Mesh(stemGeo, stemMat);
      const capMesh = new THREE.Mesh(capGeo, capMat);
      const falloutRing = new THREE.Mesh(falloutGeo, falloutMat);
      [shockwaveRing, stemMesh, capMesh, falloutRing].forEach((mesh) => {
        mesh.visible = false;
        this.rootGroup.add(mesh);
      });

      this.nukePool.push({
        active: false,
        elapsed: 0,
        maxDuration: 60.0,
        origin: new THREE.Vector3(),
        shockwaveRing,
        stemMesh,
        capMesh,
        falloutRing,
      });
    }

    this.rootGroup.userData = { fireMat, smokeMat, exhaustMat, sparkMat, brassMat, bloodMat, tracerMat };
  }

  private pushParticle(
    batch: InstancedBatch<ParticleState>,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    gravity: number,
    maxLife: number,
    scaleStart: number,
    scaleEnd: number,
    spinX = 0,
    spinY = 0
  ): void {
    const slotIdx = allocSlot(batch);
    const p = batch.items[slotIdx];
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = 0;
    p.maxLife = maxLife;
    p.gravity = gravity;
    p.scaleStart = scaleStart;
    p.scaleEnd = scaleEnd;
    p.rotX = 0;
    p.rotY = 0;
    p.spinX = spinX;
    p.spinY = spinY;

    _vfxPos.set(x, y, z);
    _vfxScale.set(scaleStart, scaleStart, scaleStart);
    _vfxMat4.compose(_vfxPos, _vfxQuatIdentity, _vfxScale);
    batch.mesh.setMatrixAt(slotIdx, _vfxMat4);
    batch.mesh.count = batch.activeCount;
    batch.mesh.visible = true;
    batch.mesh.instanceMatrix.needsUpdate = true;
  }

  setBudgetRatio(ratio: number): void {
    this.maxBudgetRatio = Math.max(0.25, Math.min(1.0, ratio));
  }

  spawnTracer(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number): void {
    const dx = ex - sx;
    const dy = ey - sy;
    const dz = ez - sz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1.2) return;

    const slotIdx = allocSlot(this.tracerBatch);
    const t = this.tracerBatch.items[slotIdx];
    const inv = 1 / dist;
    // Offset initial spawn slightly forward from muzzle so near-camera tracers never project as screen-filling bars
    const leadOffset = Math.min(dist * 0.28, 2.4);
    const startX = sx + dx * inv * leadOffset;
    const startY = sy + dy * inv * leadOffset;
    const startZ = sz + dz * inv * leadOffset;
    const travelDist = Math.max(0.5, dist - leadOffset);
    const streakLen = Math.min(3.8, Math.max(0.95, travelDist * 0.16));

    t.startX = startX;
    t.startY = startY;
    t.startZ = startZ;
    t.endX = ex;
    t.endY = ey;
    t.endZ = ez;
    t.streakLen = streakLen;
    t.life = 0;
    t.maxLife = Math.min(0.095, Math.max(0.032, travelDist / 260));

    _vfxLookHelper.position.set(
      startX + dx * inv * (streakLen * 0.5),
      startY + dy * inv * (streakLen * 0.5),
      startZ + dz * inv * (streakLen * 0.5)
    );
    _vfxLookHelper.lookAt(ex, ey, ez);
    _vfxLookHelper.scale.set(1, 1, streakLen);
    _vfxLookHelper.updateMatrix();
    this.tracerBatch.mesh.setMatrixAt(slotIdx, _vfxLookHelper.matrix);
    this.tracerBatch.mesh.count = this.tracerBatch.activeCount;
    this.tracerBatch.mesh.visible = true;
    this.tracerBatch.mesh.instanceMatrix.needsUpdate = true;
  }

  spawnMuzzleLight(x: number, y: number, z: number): void {
    this.flashLight.position.set(x, y, z);
    this.flashLight.color.setHex(0xffb347);
    this.flashLight.distance = 18;
    this.flashLight.intensity = 6.5;
    this.flashTimer = 0.055;
  }

  spawnExhaustSmoke(x: number, y: number, z: number, scale = 1.0): void {
    const clampedScale = Math.min(1.5, Math.max(0.25, scale));
    this.pushParticle(
      this.exhaustBatch,
      x + (Math.random() - 0.5) * 0.2,
      y + (Math.random() - 0.5) * 0.2,
      z + (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 1.1,
      0.6 + Math.random() * 0.9,
      (Math.random() - 0.5) * 1.1,
      -0.6,
      0.55 + Math.random() * 0.25,
      0.28 * clampedScale,
      0.95 * clampedScale
    );
  }

  spawnImpact(x: number, y: number, z: number, kind: 'concrete' | 'metal' | 'blood' | 'dirt'): void {
    const count = Math.max(2, Math.round(5 * this.maxBudgetRatio));
    const batch =
      kind === 'blood'
        ? this.bloodBatch
        : kind === 'metal' || kind === 'concrete'
          ? this.sparkBatch
          : this.smokeBatch;

    for (let i = 0; i < count; i++) {
      this.pushParticle(
        batch,
        x,
        y,
        z,
        (Math.random() - 0.5) * (kind === 'blood' ? 3.2 : 6.5),
        (kind === 'blood' ? 0.8 : 1.8) + Math.random() * (kind === 'blood' ? 2.2 : 4.5),
        (Math.random() - 0.5) * (kind === 'blood' ? 3.2 : 6.5),
        kind === 'blood' ? 18 : 14,
        kind === 'blood' ? 0.16 + Math.random() * 0.12 : 0.22 + Math.random() * 0.18,
        kind === 'blood' ? 0.14 : kind === 'metal' ? 0.16 : 0.24,
        0.02
      );
    }
  }

  spawnShellCasing(x: number, y: number, z: number, rx: number, rz: number): void {
    this.pushParticle(
      this.brassBatch,
      x,
      y,
      z,
      rx * (2.6 + Math.random() * 0.9),
      2.0 + Math.random() * 0.8,
      rz * (2.6 + Math.random() * 0.9),
      16,
      0.48,
      0.036,
      0.034,
      14 + Math.random() * 10,
      9 + Math.random() * 8
    );
  }

  spawnExplosion(x: number, y: number, z: number, scale = 1.0): void {
    const clampedScale = Math.min(2.2, Math.max(0.4, scale));
    this.flashLight.position.set(x, y + 1.5, z);
    this.flashLight.color.setHex(0xffb347);
    this.flashLight.distance = 24 * Math.min(2.5, clampedScale);
    this.flashLight.intensity = 16 * Math.min(2.5, clampedScale);
    this.flashTimer = 0.22;

    const fireCount = Math.max(4, Math.round(11 * this.maxBudgetRatio));
    for (let i = 0; i < fireCount; i++) {
      const batch = i % 3 === 0 ? this.sparkBatch : this.fireBatch;
      this.pushParticle(
        batch,
        x + (Math.random() - 0.5) * 1.1 * clampedScale,
        y + 0.2 + Math.random() * 0.9 * clampedScale,
        z + (Math.random() - 0.5) * 1.1 * clampedScale,
        (Math.random() - 0.5) * 11 * clampedScale,
        (2.8 + Math.random() * 8.5) * clampedScale,
        (Math.random() - 0.5) * 11 * clampedScale,
        9.5,
        0.26 + Math.random() * 0.24,
        (i % 3 === 0 ? 0.34 : 0.85) * clampedScale,
        0.08
      );
    }

    const smokeCount = Math.max(4, Math.round(9 * this.maxBudgetRatio));
    for (let i = 0; i < smokeCount; i++) {
      this.pushParticle(
        this.smokeBatch,
        x + (Math.random() - 0.5) * 1.6 * clampedScale,
        y + 0.6 + Math.random() * 1.1 * clampedScale,
        z + (Math.random() - 0.5) * 1.6 * clampedScale,
        (Math.random() - 0.5) * 3.6 * clampedScale,
        (2.2 + Math.random() * 3.8) * clampedScale,
        (Math.random() - 0.5) * 3.6 * clampedScale,
        -1.0,
        0.95 + Math.random() * 0.65,
        0.72 * clampedScale,
        2.05 * clampedScale
      );
    }
  }

  spawnStrategicNukeVfx(x: number, y: number, z: number, reducedMotion = false): void {
    this.flashLight.position.set(x, y + 14, z);
    this.flashLight.color.setHex(0xfef3c7);
    this.flashLight.distance = 180;
    this.flashLight.intensity = reducedMotion ? 18 : 48;
    this.flashTimer = 0.85;

    const seq = this.nukePool.find((n) => !n.active) ?? this.nukePool[0];
    seq.active = true;
    seq.elapsed = 0;
    seq.maxDuration = 60.0;
    seq.origin.set(x, y, z);

    seq.shockwaveRing.position.set(x, y + 1.2, z);
    seq.shockwaveRing.scale.setScalar(1);
    seq.shockwaveRing.visible = true;

    seq.stemMesh.position.set(x, y + 2, z);
    seq.stemMesh.scale.set(3, 4, 3);
    seq.stemMesh.visible = true;

    seq.capMesh.position.set(x, y + 5, z);
    seq.capMesh.scale.set(6, 4, 6);
    seq.capMesh.visible = true;

    seq.falloutRing.position.set(x, y + 0.25, z);
    seq.falloutRing.scale.set(75, 75, 1);
    seq.falloutRing.visible = true;

    // Seed bounded pooled fire/smoke particles around epicenter
    this.spawnExplosion(x, y + 1, z, 2.2);
  }

  update(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flashLight.intensity = 0;
    }

    for (let bIdx = 0; bIdx < this.particleBatches.length; bIdx++) {
      const batch = this.particleBatches[bIdx];
      if (batch.activeCount === 0) continue;

      for (let i = batch.activeCount - 1; i >= 0; i--) {
        const p = batch.items[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
          const lastIdx = batch.activeCount - 1;
          if (i !== lastIdx) {
            batch.items[i] = batch.items[lastIdx];
            batch.items[lastIdx] = p;
          }
          batch.activeCount--;
          continue;
        }
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.spinX !== 0 || p.spinY !== 0) {
          p.rotX += p.spinX * dt;
          p.rotY += p.spinY * dt;
        }
      }

      if (batch.activeCount === 0) {
        batch.mesh.count = 0;
        batch.mesh.visible = false;
        continue;
      }

      for (let i = 0; i < batch.activeCount; i++) {
        const p = batch.items[i];
        const t = p.life / p.maxLife;
        const s = p.scaleStart + (p.scaleEnd - p.scaleStart) * t;
        _vfxPos.set(p.x, p.y, p.z);
        _vfxScale.set(s, s, s);
        if (p.spinX !== 0 || p.spinY !== 0) {
          _vfxEulerSpin.set(p.rotX, p.rotY, 0);
          _vfxQuatSpin.setFromEuler(_vfxEulerSpin);
          _vfxMat4.compose(_vfxPos, _vfxQuatSpin, _vfxScale);
        } else {
          _vfxMat4.compose(_vfxPos, _vfxQuatIdentity, _vfxScale);
        }
        batch.mesh.setMatrixAt(i, _vfxMat4);
      }
      batch.mesh.count = batch.activeCount;
      batch.mesh.visible = true;
      batch.mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.tracerBatch.activeCount > 0) {
      for (let i = this.tracerBatch.activeCount - 1; i >= 0; i--) {
        const t = this.tracerBatch.items[i];
        t.life += dt;
        if (t.life >= t.maxLife) {
          const lastIdx = this.tracerBatch.activeCount - 1;
          if (i !== lastIdx) {
            this.tracerBatch.items[i] = this.tracerBatch.items[lastIdx];
            this.tracerBatch.items[lastIdx] = t;
          }
          this.tracerBatch.activeCount--;
        }
      }

      if (this.tracerBatch.activeCount === 0) {
        this.tracerBatch.mesh.count = 0;
        this.tracerBatch.mesh.visible = false;
      } else {
        for (let i = 0; i < this.tracerBatch.activeCount; i++) {
          const t = this.tracerBatch.items[i];
          const frac = Math.min(1, t.life / Math.max(1e-4, t.maxLife));
          const cx = t.startX + (t.endX - t.startX) * frac;
          const cy = t.startY + (t.endY - t.startY) * frac;
          const cz = t.startZ + (t.endZ - t.startZ) * frac;
          _vfxLookHelper.position.set(cx, cy, cz);
          _vfxLookHelper.lookAt(t.endX, t.endY, t.endZ);
          _vfxLookHelper.scale.set(1, 1, t.streakLen * (1 - frac * 0.35));
          _vfxLookHelper.updateMatrix();
          this.tracerBatch.mesh.setMatrixAt(i, _vfxLookHelper.matrix);
        }
        this.tracerBatch.mesh.count = this.tracerBatch.activeCount;
        this.tracerBatch.mesh.visible = true;
        this.tracerBatch.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    for (const seq of this.nukePool) {
      if (!seq.active) continue;
      seq.elapsed += dt;
      if (seq.elapsed >= seq.maxDuration) {
        seq.active = false;
        seq.shockwaveRing.visible = false;
        seq.stemMesh.visible = false;
        seq.capMesh.visible = false;
        seq.falloutRing.visible = false;
        continue;
      }

      // Stage 1-2: Expanding shockwave ring (0 -> 115m in 3.2s)
      if (seq.elapsed <= 3.5) {
        const waveT = Math.min(1, seq.elapsed / 3.2);
        const radius = 2 + waveT * 113;
        seq.shockwaveRing.scale.set(radius, 1 + waveT * 2.5, radius);
        const shockMat = seq.shockwaveRing.material as THREE.MeshBasicMaterial;
        shockMat.opacity = Math.max(0, 0.9 * (1 - waveT));
      } else {
        seq.shockwaveRing.visible = false;
      }

      // Stage 3: Rising thermal column & cap (0 -> 10s fade)
      if (seq.elapsed <= 10.5) {
        const cloudT = Math.min(1, seq.elapsed / 9.0);
        const height = 6 + cloudT * 46;
        seq.stemMesh.position.y = seq.origin.y + height * 0.5;
        seq.stemMesh.scale.set(3.2 + cloudT * 4.5, height, 3.2 + cloudT * 4.5);
        seq.capMesh.position.y = seq.origin.y + height;
        seq.capMesh.scale.set(8 + cloudT * 18, 4.5 + cloudT * 8, 8 + cloudT * 18);

        const fade = seq.elapsed > 6.5 ? Math.max(0, 1 - (seq.elapsed - 6.5) / 4.0) : 1;
        (seq.stemMesh.material as THREE.MeshBasicMaterial).opacity = 0.72 * fade;
        (seq.capMesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * fade;
      } else {
        seq.stemMesh.visible = false;
        seq.capMesh.visible = false;
      }

      // Fallout perimeter ring gentle pulse
      const falloutMat = seq.falloutRing.material as THREE.MeshBasicMaterial;
      falloutMat.opacity = 0.28 + Math.sin(seq.elapsed * 3.0) * 0.12;
    }
  }

  resetAll(): void {
    for (let i = 0; i < this.particleBatches.length; i++) {
      const b = this.particleBatches[i];
      b.activeCount = 0;
      b.stealCursor = 0;
      b.mesh.count = 0;
      b.mesh.visible = false;
    }
    this.tracerBatch.activeCount = 0;
    this.tracerBatch.stealCursor = 0;
    this.tracerBatch.mesh.count = 0;
    this.tracerBatch.mesh.visible = false;
    for (const seq of this.nukePool) {
      seq.active = false;
      seq.shockwaveRing.visible = false;
      seq.stemMesh.visible = false;
      seq.capMesh.visible = false;
      seq.falloutRing.visible = false;
    }
    this.flashLight.intensity = 0;
  }

  getActiveCount(): number {
    let total = this.tracerBatch.activeCount;
    for (let i = 0; i < this.particleBatches.length; i++) {
      total += this.particleBatches[i].activeCount;
    }
    return total;
  }

  getPoolCapacity(): number {
    let total = this.tracerBatch.capacity;
    for (let i = 0; i < this.particleBatches.length; i++) {
      total += this.particleBatches[i].capacity;
    }
    return total;
  }
}
