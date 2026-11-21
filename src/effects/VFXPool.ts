import * as THREE from 'three';
import { ObjectPool, Poolable } from '@/src/core/ObjectPool';
import { ResourceManager } from '@/src/core/ResourceManager';

interface PooledParticle extends Poolable {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
  scaleStart: number;
  scaleEnd: number;
}

interface PooledTracer extends Poolable {
  mesh: THREE.Mesh;
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

export class VFXPool {
  private readonly particlePool: ObjectPool<PooledParticle>;
  private readonly tracerPool: ObjectPool<PooledTracer>;
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

    const allParticleMats: THREE.Material[] = [
      sparkMat,
      fireMat,
      smokeMat,
      exhaustMat,
      brassMat,
      bloodMat,
    ];
    let poolCreateIndex = 0;
    this.particlePool = new ObjectPool<PooledParticle>(200, () => {
      const initialMat = allParticleMats[poolCreateIndex % allParticleMats.length];
      poolCreateIndex++;
      const mesh = new THREE.Mesh(sphereGeo, initialMat);
      mesh.visible = false;
      mesh.scale.setScalar(0.01);
      this.rootGroup.add(mesh);
      return {
        active: false,
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.5,
        gravity: 9.8,
        scaleStart: 0.15,
        scaleEnd: 0.02,
        reset() {
          this.life = 0;
          this.mesh.scale.setScalar(0.01);
          this.mesh.rotation.set(0, 0, 0);
          this.mesh.visible = true;
        },
      };
    }, (item) => {
      item.mesh.visible = false;
      item.mesh.scale.setScalar(0.01);
    });

    this.tracerPool = new ObjectPool<PooledTracer>(48, () => {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat);
      mesh.visible = false;
      this.rootGroup.add(mesh);
      return {
        active: false,
        mesh,
        startX: 0,
        startY: 0,
        startZ: 0,
        endX: 0,
        endY: 0,
        endZ: 0,
        streakLen: 1.5,
        life: 0,
        maxLife: 0.06,
        reset() {
          this.life = 0;
          this.mesh.visible = true;
        },
      };
    }, (item) => {
      item.mesh.visible = false;
    });

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

    this.rootGroup.userData = { fireMat, smokeMat, exhaustMat, sparkMat, brassMat, bloodMat };
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

    const t = this.tracerPool.acquire();
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
    t.maxLife = Math.min(0.095, Math.max(0.032, travelDist / 260));

    t.mesh.position.set(
      startX + dx * inv * (streakLen * 0.5),
      startY + dy * inv * (streakLen * 0.5),
      startZ + dz * inv * (streakLen * 0.5)
    );
    t.mesh.lookAt(ex, ey, ez);
    t.mesh.scale.set(1, 1, streakLen);
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
    const { exhaustMat } = this.rootGroup.userData as { exhaustMat: THREE.Material };
    const p = this.particlePool.acquire();
    p.mesh.material = exhaustMat;
    p.mesh.position.set(
      x + (Math.random() - 0.5) * 0.2,
      y + (Math.random() - 0.5) * 0.2,
      z + (Math.random() - 0.5) * 0.2
    );
    p.vx = (Math.random() - 0.5) * 1.1;
    p.vy = 0.6 + Math.random() * 0.9;
    p.vz = (Math.random() - 0.5) * 1.1;
    p.gravity = -0.6;
    p.maxLife = 0.55 + Math.random() * 0.25;
    p.scaleStart = 0.28 * clampedScale;
    p.scaleEnd = 0.95 * clampedScale;
    p.mesh.scale.setScalar(p.scaleStart);
  }

  spawnImpact(x: number, y: number, z: number, kind: 'concrete' | 'metal' | 'blood' | 'dirt'): void {
    const count = Math.max(2, Math.round(5 * this.maxBudgetRatio));
    const { sparkMat, smokeMat, bloodMat } = this.rootGroup.userData as {
      sparkMat: THREE.Material;
      smokeMat: THREE.Material;
      bloodMat: THREE.Material;
    };

    for (let i = 0; i < count; i++) {
      const p = this.particlePool.acquire();
      p.mesh.material =
        kind === 'blood'
          ? bloodMat
          : kind === 'metal' || kind === 'concrete'
            ? sparkMat
            : smokeMat;
      p.mesh.position.set(x, y, z);
      p.vx = (Math.random() - 0.5) * (kind === 'blood' ? 3.2 : 6.5);
      p.vy = (kind === 'blood' ? 0.8 : 1.8) + Math.random() * (kind === 'blood' ? 2.2 : 4.5);
      p.vz = (Math.random() - 0.5) * (kind === 'blood' ? 3.2 : 6.5);
      p.gravity = kind === 'blood' ? 18 : 14;
      p.maxLife = kind === 'blood' ? 0.16 + Math.random() * 0.12 : 0.22 + Math.random() * 0.18;
      p.scaleStart = kind === 'blood' ? 0.14 : kind === 'metal' ? 0.16 : 0.24;
      p.scaleEnd = 0.02;
      p.mesh.scale.setScalar(p.scaleStart);
    }
  }

  spawnShellCasing(x: number, y: number, z: number, rx: number, rz: number): void {
    const p = this.particlePool.acquire();
    const { brassMat } = this.rootGroup.userData as { brassMat: THREE.Material };
    p.mesh.material = brassMat;
    p.mesh.position.set(x, y, z);
    p.vx = rx * (2.6 + Math.random() * 0.9);
    p.vy = 2.0 + Math.random() * 0.8;
    p.vz = rz * (2.6 + Math.random() * 0.9);
    p.gravity = 16;
    p.maxLife = 0.45;
    p.scaleStart = 0.032;
    p.scaleEnd = 0.022;
    p.mesh.scale.setScalar(p.scaleStart);
  }

  spawnExplosion(x: number, y: number, z: number, scale = 1.0): void {
    const clampedScale = Math.min(2.2, Math.max(0.4, scale));
    this.flashLight.position.set(x, y + 1.5, z);
    this.flashLight.color.setHex(0xffb347);
    this.flashLight.distance = 24 * Math.min(2.5, clampedScale);
    this.flashLight.intensity = 16 * Math.min(2.5, clampedScale);
    this.flashTimer = 0.22;

    const { fireMat, smokeMat, sparkMat } = this.rootGroup.userData as {
      fireMat: THREE.Material;
      smokeMat: THREE.Material;
      sparkMat: THREE.Material;
    };

    const fireCount = Math.max(4, Math.round(11 * this.maxBudgetRatio));
    for (let i = 0; i < fireCount; i++) {
      const p = this.particlePool.acquire();
      p.mesh.material = i % 3 === 0 ? sparkMat : fireMat;
      p.mesh.position.set(
        x + (Math.random() - 0.5) * 1.1 * clampedScale,
        y + 0.2 + Math.random() * 0.9 * clampedScale,
        z + (Math.random() - 0.5) * 1.1 * clampedScale
      );
      p.vx = (Math.random() - 0.5) * 11 * clampedScale;
      p.vy = (2.8 + Math.random() * 8.5) * clampedScale;
      p.vz = (Math.random() - 0.5) * 11 * clampedScale;
      p.gravity = 9.5;
      p.maxLife = 0.26 + Math.random() * 0.24;
      p.scaleStart = (i % 3 === 0 ? 0.34 : 0.85) * clampedScale;
      p.scaleEnd = 0.08;
      p.mesh.scale.setScalar(p.scaleStart);
    }

    const smokeCount = Math.max(4, Math.round(9 * this.maxBudgetRatio));
    for (let i = 0; i < smokeCount; i++) {
      const p = this.particlePool.acquire();
      p.mesh.material = smokeMat;
      p.mesh.position.set(
        x + (Math.random() - 0.5) * 1.6 * clampedScale,
        y + 0.6 + Math.random() * 1.1 * clampedScale,
        z + (Math.random() - 0.5) * 1.6 * clampedScale
      );
      p.vx = (Math.random() - 0.5) * 3.6 * clampedScale;
      p.vy = (2.2 + Math.random() * 3.8) * clampedScale;
      p.vz = (Math.random() - 0.5) * 3.6 * clampedScale;
      p.gravity = -1.0;
      p.maxLife = 0.95 + Math.random() * 0.65;
      p.scaleStart = 0.72 * clampedScale;
      p.scaleEnd = 2.05 * clampedScale;
      p.mesh.scale.setScalar(p.scaleStart);
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

    this.particlePool.forEachActive((p) => {
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particlePool.release(p);
        return;
      }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const t = p.life / p.maxLife;
      const s = p.scaleStart + (p.scaleEnd - p.scaleStart) * t;
      p.mesh.scale.setScalar(s);
    });

    this.tracerPool.forEachActive((t) => {
      t.life += dt;
      if (t.life >= t.maxLife) {
        this.tracerPool.release(t);
        return;
      }
      const frac = Math.min(1, t.life / Math.max(1e-4, t.maxLife));
      const cx = t.startX + (t.endX - t.startX) * frac;
      const cy = t.startY + (t.endY - t.startY) * frac;
      const cz = t.startZ + (t.endZ - t.startZ) * frac;
      t.mesh.position.set(cx, cy, cz);
      t.mesh.scale.set(1, 1, t.streakLen * (1 - frac * 0.35));
    });

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
    this.particlePool.releaseAll();
    this.tracerPool.releaseAll();
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
    return this.particlePool.getActiveCount() + this.tracerPool.getActiveCount();
  }

  getPoolCapacity(): number {
    return 200 + 48;
  }
}
