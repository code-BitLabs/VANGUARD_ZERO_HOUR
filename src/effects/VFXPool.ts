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

    const sphereGeo = new THREE.IcosahedronGeometry(0.35, 1);
    resourceManager.registerGeometry(sphereGeo, 'shared', 'vfx_particle_geo');

    const tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 3.6);
    resourceManager.registerGeometry(tracerGeo, 'shared', 'vfx_tracer_geo');

    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.9,
    });
    resourceManager.registerMaterial(tracerMat, 'shared', 'vfx_tracer_mat');

    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7b29, transparent: true, opacity: 0.9 });
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0x2d3238, roughness: 0.95, transparent: true, opacity: 0.72 });
    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.9, transparent: true, opacity: 0.55 });
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a038, metalness: 0.85, roughness: 0.25 });
    const bloodMat = new THREE.MeshBasicMaterial({ color: 0x991b1b, transparent: true, opacity: 0.85 });
    resourceManager.registerMaterial(fireMat, 'shared', 'vfx_fire_mat');
    resourceManager.registerMaterial(smokeMat, 'shared', 'vfx_smoke_mat');
    resourceManager.registerMaterial(exhaustMat, 'shared', 'vfx_exhaust_mat');
    resourceManager.registerMaterial(sparkMat, 'shared', 'vfx_spark_mat');
    resourceManager.registerMaterial(brassMat, 'shared', 'vfx_brass_mat');
    resourceManager.registerMaterial(bloodMat, 'shared', 'vfx_blood_mat');

    this.particlePool = new ObjectPool<PooledParticle>(200, () => {
      const mesh = new THREE.Mesh(sphereGeo, sparkMat);
      mesh.visible = false;
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
        scaleStart: 1,
        scaleEnd: 0.1,
        reset() {
          this.life = 0;
          this.mesh.visible = true;
        },
      };
    }, (item) => {
      item.mesh.visible = false;
    });

    this.tracerPool = new ObjectPool<PooledTracer>(48, () => {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat);
      mesh.visible = false;
      this.rootGroup.add(mesh);
      return {
        active: false,
        mesh,
        life: 0,
        maxLife: 0.12,
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
      const shockMat = new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.85 });
      const stemMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.75 });
      const capMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.82 });
      const falloutMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
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
    const t = this.tracerPool.acquire();
    const mx = (sx + ex) * 0.5;
    const my = (sy + ey) * 0.5;
    const mz = (sz + ez) * 0.5;
    t.mesh.position.set(mx, my, mz);
    t.mesh.lookAt(ex, ey, ez);
    const dist = Math.hypot(ex - sx, ey - sy, ez - sz);
    t.mesh.scale.set(1, 1, Math.max(0.4, Math.min(18, dist / 3.6)));
    t.maxLife = 0.08;
  }

  spawnMuzzleLight(x: number, y: number, z: number): void {
    this.flashLight.position.set(x, y, z);
    this.flashLight.color.setHex(0xffb347);
    this.flashLight.distance = 18;
    this.flashLight.intensity = 6.5;
    this.flashTimer = 0.055;
  }

  spawnExhaustSmoke(x: number, y: number, z: number, scale = 1.0): void {
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
    p.scaleStart = 0.35 * scale;
    p.scaleEnd = 1.35 * scale;
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
      p.vx = (Math.random() - 0.5) * 7;
      p.vy = 2 + Math.random() * 5;
      p.vz = (Math.random() - 0.5) * 7;
      p.gravity = 14;
      p.maxLife = 0.25 + Math.random() * 0.2;
      p.scaleStart = kind === 'metal' ? 0.22 : 0.35;
      p.scaleEnd = 0.02;
    }
  }

  spawnShellCasing(x: number, y: number, z: number, rx: number, rz: number): void {
    const p = this.particlePool.acquire();
    const { brassMat } = this.rootGroup.userData as { brassMat: THREE.Material };
    p.mesh.material = brassMat;
    p.mesh.position.set(x, y, z);
    p.vx = rx * (2.2 + Math.random());
    p.vy = 2.4 + Math.random() * 1.2;
    p.vz = rz * (2.2 + Math.random());
    p.gravity = 16;
    p.maxLife = 0.55;
    p.scaleStart = 0.14;
    p.scaleEnd = 0.1;
  }

  spawnExplosion(x: number, y: number, z: number, scale = 1.0): void {
    this.flashLight.position.set(x, y + 1.5, z);
    this.flashLight.color.setHex(0xffb347);
    this.flashLight.distance = 24 * Math.min(2.5, scale);
    this.flashLight.intensity = 16 * Math.min(2.5, scale);
    this.flashTimer = 0.22;

    const { fireMat, smokeMat, sparkMat } = this.rootGroup.userData as {
      fireMat: THREE.Material;
      smokeMat: THREE.Material;
      sparkMat: THREE.Material;
    };

    const fireCount = Math.max(4, Math.round(12 * this.maxBudgetRatio));
    for (let i = 0; i < fireCount; i++) {
      const p = this.particlePool.acquire();
      p.mesh.material = i % 3 === 0 ? sparkMat : fireMat;
      p.mesh.position.set(
        x + (Math.random() - 0.5) * 1.4,
        y + Math.random() * 1.2,
        z + (Math.random() - 0.5) * 1.4
      );
      p.vx = (Math.random() - 0.5) * 13 * scale;
      p.vy = (3 + Math.random() * 10) * scale;
      p.vz = (Math.random() - 0.5) * 13 * scale;
      p.gravity = 8;
      p.maxLife = 0.4 + Math.random() * 0.35;
      p.scaleStart = 1.8 * scale;
      p.scaleEnd = 0.15;
    }

    const smokeCount = Math.max(4, Math.round(10 * this.maxBudgetRatio));
    for (let i = 0; i < smokeCount; i++) {
      const p = this.particlePool.acquire();
      p.mesh.material = smokeMat;
      p.mesh.position.set(
        x + (Math.random() - 0.5) * 2.2,
        y + 0.8 + Math.random() * 1.5,
        z + (Math.random() - 0.5) * 2.2
      );
      p.vx = (Math.random() - 0.5) * 4.5 * scale;
      p.vy = (2.5 + Math.random() * 4.5) * scale;
      p.vz = (Math.random() - 0.5) * 4.5 * scale;
      p.gravity = -1.2;
      p.maxLife = 1.1 + Math.random() * 0.7;
      p.scaleStart = 1.4 * scale;
      p.scaleEnd = 4.2 * scale;
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
    this.spawnExplosion(x, y + 1, z, 2.8);
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
      }
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
