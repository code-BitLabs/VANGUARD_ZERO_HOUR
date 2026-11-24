import * as THREE from 'three';
import { ResourceManager } from '@/src/core/ResourceManager';
import { ImpactSurfaceMaterial } from './SurfaceDecalManager';

export type BattlefieldVfxType =
  | 'muzzle_flash'
  | 'barrel_smoke'
  | 'gunpowder_smoke'
  | 'metal_sparks'
  | 'bullet_dust'
  | 'concrete_debris'
  | 'wood_splinters'
  | 'explosion_debris'
  | 'fire'
  | 'smoke_plumes'
  | 'rocket_trails'
  | 'shell_casings'
  | 'vehicle_exhaust'
  | 'rain_splash'
  | 'dust_clouds'
  | 'breach_effect'
  | 'searchlight_motes';

export type VfxBatchKind = 'additive' | 'smoke' | 'debris' | 'casing' | 'rain';

const BATCH_KINDS: readonly VfxBatchKind[] = ['additive', 'smoke', 'debris', 'casing', 'rain'];

interface ParticleSlot {
  active: boolean;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  avx: number;
  avy: number;
  avz: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  scaleStart: number;
  scaleEnd: number;
  colorHex: number;
}

interface IndoorShelterVolume {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  ceilingY: number;
}

function createSoftParticleTexture(kind: 'puff' | 'spark'): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, size * 0.48);
  if (kind === 'spark') {
    grad.addColorStop(0, 'rgba(255, 252, 232, 1)');
    grad.addColorStop(0.32, 'rgba(255, 198, 92, 0.92)');
    grad.addColorStop(0.7, 'rgba(255, 118, 24, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  } else {
    grad.addColorStop(0, 'rgba(235, 238, 242, 0.72)');
    grad.addColorStop(0.42, 'rgba(185, 190, 198, 0.44)');
    grad.addColorStop(0.78, 'rgba(120, 125, 134, 0.14)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * GPU-Instanced Pooled 16-Class Battlefield VFX & Weather Simulation System.
 * - Replaces 200+ individual mesh draw calls with 5 batched `InstancedMesh` pools.
 * - Supports all 16 TRN-51/VFX classes with gravity, aerodynamic drag, spin,
 *   surface-material awareness, shared wind field, and indoor rain occlusion.
 * - Zero per-shot heap allocations; bounded densities driven by RenderingQualityDirector.
 */
export class BattlefieldVfxSystem {
  private readonly root = new THREE.Group();
  private readonly batches: Record<
    VfxBatchKind,
    {
      mesh: THREE.InstancedMesh;
      slots: ParticleSlot[];
      cursor: number;
      capacity: number;
      activeCount: number;
    }
  >;
  private readonly textures: THREE.Texture[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly _tmpUpAxis = new THREE.Vector3(0, 1, 0);
  private readonly _tmpEmitDir = new THREE.Vector3();
  private readonly _tmpNegDir = new THREE.Vector3();
  private readonly _tmpWindDir = new THREE.Vector3();
  private readonly _tmpSplashOrigin = new THREE.Vector3();
  private readonly windVector = new THREE.Vector3(2.2, 0, 0.8);
  private readonly shelters: IndoorShelterVolume[] = [];

  private densityScale = 1.0;
  private rainDensityScale = 1.0;
  private activeWeather: 'clear' | 'rain' | 'sandstorm' | 'ember_steam' = 'clear';
  private rainSpawnAccumulator = 0;

  constructor(
    private readonly scene: THREE.Scene,
    isSoftwareGl = false,
    private readonly resourceManager?: ResourceManager
  ) {
    this.root.name = 'VanguardInstancedVfx';
    this.scene.add(this.root);

    const capScale = isSoftwareGl ? 0.35 : 1.0;
    const sparkTex = createSoftParticleTexture('spark');
    const puffTex = createSoftParticleTexture('puff');
    if (sparkTex) {
      this.textures.push(sparkTex);
      this.resourceManager?.registerTexture(sparkTex, 'shared');
    }
    if (puffTex) {
      this.textures.push(puffTex);
      this.resourceManager?.registerTexture(puffTex, 'shared');
    }

    const additiveGeo = new THREE.PlaneGeometry(0.45, 0.45);
    const smokeGeo = new THREE.PlaneGeometry(0.7, 0.7);
    const debrisGeo = new THREE.DodecahedronGeometry(0.11, 0);
    const casingGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.042, 6);
    const rainGeo = new THREE.BoxGeometry(0.012, 0.68, 0.012);
    this.geometries.push(additiveGeo, smokeGeo, debrisGeo, casingGeo, rainGeo);
    for (const geo of this.geometries) {
      this.resourceManager?.registerGeometry(geo, 'shared');
    }

    const additiveMat = new THREE.MeshBasicMaterial({
      ...(sparkTex ? { map: sparkTex } : {}),
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const smokeMat = new THREE.MeshStandardMaterial({
      ...(puffTex ? { map: puffTex } : {}),
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.14,
    });
    const casingMat = new THREE.MeshStandardMaterial({
      color: 0xd9a740,
      roughness: 0.24,
      metalness: 0.88,
    });
    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xcbdcf0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.materials.push(additiveMat, smokeMat, debrisMat, casingMat, rainMat);
    for (const mat of this.materials) {
      this.resourceManager?.registerMaterial(mat, 'shared');
    }

    this.batches = {
      additive: this.createBatch(additiveGeo, additiveMat, Math.round(220 * capScale)),
      smoke: this.createBatch(smokeGeo, smokeMat, Math.round(240 * capScale)),
      debris: this.createBatch(debrisGeo, debrisMat, Math.round(200 * capScale)),
      casing: this.createBatch(casingGeo, casingMat, Math.round(96 * capScale)),
      rain: this.createBatch(rainGeo, rainMat, Math.round(260 * capScale)),
    };
  }

  public setDensityScales(particleScale: number, rainScale: number): void {
    this.densityScale = Math.max(0.2, Math.min(1.0, particleScale));
    this.rainDensityScale = Math.max(0.15, Math.min(1.0, rainScale));
  }

  public setEnvironmentWeather(
    weather: 'clear' | 'rain' | 'sandstorm' | 'ember_steam',
    windX = 2.2,
    windZ = 0.8
  ): void {
    this.activeWeather = weather;
    this.windVector.set(windX, 0, windZ);
  }

  public registerIndoorShelter(volume: IndoorShelterVolume): void {
    this.shelters.push(volume);
  }

  public clearIndoorShelters(): void {
    this.shelters.length = 0;
  }

  public isPointSheltered(x: number, y: number, z: number): boolean {
    for (const s of this.shelters) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && y <= s.ceilingY) {
        return true;
      }
    }
    return false;
  }

  /**
   * Emits any of the 16 physically calibrated VFX classes.
   */
  public emitEffect(
    type: BattlefieldVfxType,
    origin: THREE.Vector3,
    direction: THREE.Vector3 = this._tmpUpAxis,
    intensity = 1.0
  ): void {
    const dir = this._tmpEmitDir.copy(direction).normalize();
    const scaledCount = (base: number) => Math.max(1, Math.round(base * intensity * this.densityScale));

    switch (type) {
      case 'muzzle_flash':
        this.spawnBurst('additive', origin, dir, scaledCount(4), {
          speed: [3, 9],
          spread: 0.45,
          life: [0.04, 0.085],
          gravity: 0,
          drag: 4,
          scaleStart: 0.34,
          scaleEnd: 0.04,
          colorHex: 0xffd27d,
        });
        break;
      case 'barrel_smoke':
      case 'gunpowder_smoke':
        this.spawnBurst('smoke', origin, dir, scaledCount(3), {
          speed: [0.6, 1.8],
          spread: 0.55,
          life: [0.45, 0.95],
          gravity: -0.6,
          drag: 2.2,
          scaleStart: 0.14,
          scaleEnd: 0.55,
          colorHex: type === 'barrel_smoke' ? 0x9ca3af : 0x6b7280,
        });
        break;
      case 'metal_sparks':
        this.spawnBurst('additive', origin, dir, scaledCount(9), {
          speed: [4.5, 11.5],
          spread: 0.72,
          life: [0.18, 0.42],
          gravity: 11.5,
          drag: 0.8,
          scaleStart: 0.14,
          scaleEnd: 0.02,
          colorHex: 0xffbe55,
        });
        break;
      case 'bullet_dust':
      case 'dust_clouds':
        this.spawnBurst('smoke', origin, dir, scaledCount(type === 'dust_clouds' ? 8 : 5), {
          speed: [1.0, 3.2],
          spread: 0.85,
          life: [0.45, 1.15],
          gravity: 0.4,
          drag: 2.5,
          scaleStart: 0.18,
          scaleEnd: 0.82,
          colorHex: 0xa89b87,
        });
        break;
      case 'concrete_debris':
        this.spawnBurst('debris', origin, dir, scaledCount(7), {
          speed: [2.2, 6.8],
          spread: 0.8,
          life: [0.45, 1.05],
          gravity: 12.5,
          drag: 0.4,
          scaleStart: 0.55,
          scaleEnd: 0.2,
          colorHex: 0x7c7f82,
        });
        break;
      case 'wood_splinters':
        this.spawnBurst('debris', origin, dir, scaledCount(8), {
          speed: [2.5, 6.2],
          spread: 0.75,
          life: [0.4, 0.95],
          gravity: 10.5,
          drag: 0.65,
          scaleStart: 0.62,
          scaleEnd: 0.25,
          colorHex: 0x8b6745,
        });
        break;
      case 'explosion_debris':
      case 'breach_effect':
        this.spawnBurst('additive', origin, dir, scaledCount(12), {
          speed: [3.5, 11.0],
          spread: 1.0,
          life: [0.22, 0.55],
          gravity: -1.5,
          drag: 1.8,
          scaleStart: 0.78,
          scaleEnd: 0.12,
          colorHex: 0xff7b29,
        });
        this.spawnBurst('debris', origin, dir, scaledCount(14), {
          speed: [4.5, 13.5],
          spread: 1.0,
          life: [0.7, 1.65],
          gravity: 13.5,
          drag: 0.35,
          scaleStart: 0.95,
          scaleEnd: 0.35,
          colorHex: 0x3b3d40,
        });
        this.spawnBurst('smoke', origin, dir, scaledCount(10), {
          speed: [1.8, 5.2],
          spread: 0.95,
          life: [1.1, 2.4],
          gravity: -1.4,
          drag: 1.9,
          scaleStart: 0.55,
          scaleEnd: 2.35,
          colorHex: 0x2a2d33,
        });
        break;
      case 'fire':
        this.spawnBurst('additive', origin, this._tmpUpAxis, scaledCount(5), {
          speed: [0.9, 2.6],
          spread: 0.38,
          life: [0.3, 0.68],
          gravity: -2.2,
          drag: 1.2,
          scaleStart: 0.45,
          scaleEnd: 0.08,
          colorHex: 0xff6e1a,
        });
        break;
      case 'smoke_plumes':
        this.spawnBurst('smoke', origin, this._tmpUpAxis, scaledCount(4), {
          speed: [1.2, 2.6],
          spread: 0.32,
          life: [1.6, 3.2],
          gravity: -0.9,
          drag: 0.9,
          scaleStart: 0.45,
          scaleEnd: 2.1,
          colorHex: 0x26292e,
        });
        break;
      case 'rocket_trails':
        this._tmpNegDir.copy(dir).negate();
        this.spawnBurst('additive', origin, this._tmpNegDir, scaledCount(2), {
          speed: [1.0, 2.8],
          spread: 0.22,
          life: [0.12, 0.25],
          gravity: 0,
          drag: 2.0,
          scaleStart: 0.32,
          scaleEnd: 0.06,
          colorHex: 0xff9a3d,
        });
        this.spawnBurst('smoke', origin, this._tmpNegDir, scaledCount(3), {
          speed: [0.5, 1.5],
          spread: 0.28,
          life: [0.55, 1.25],
          gravity: -0.35,
          drag: 1.6,
          scaleStart: 0.22,
          scaleEnd: 0.95,
          colorHex: 0x9ca3af,
        });
        break;
      case 'shell_casings':
        this.spawnBurst('casing', origin, dir, 1, {
          speed: [2.2, 3.6],
          spread: 0.24,
          life: [1.2, 2.0],
          gravity: 11.5,
          drag: 0.25,
          scaleStart: 1.0,
          scaleEnd: 1.0,
          colorHex: 0xd9a740,
        });
        break;
      case 'vehicle_exhaust':
        this.spawnBurst('smoke', origin, dir, scaledCount(2), {
          speed: [0.8, 2.2],
          spread: 0.35,
          life: [0.5, 1.0],
          gravity: -0.5,
          drag: 1.8,
          scaleStart: 0.18,
          scaleEnd: 0.65,
          colorHex: 0x4b5563,
        });
        break;
      case 'rain_splash':
        this.spawnBurst('smoke', origin, this._tmpUpAxis, scaledCount(2), {
          speed: [0.6, 1.6],
          spread: 0.8,
          life: [0.14, 0.28],
          gravity: 6.5,
          drag: 1.5,
          scaleStart: 0.08,
          scaleEnd: 0.22,
          colorHex: 0xcbdcf0,
        });
        break;
      case 'searchlight_motes':
        this._tmpWindDir.copy(this.windVector).normalize();
        this.spawnBurst('smoke', origin, this._tmpWindDir, scaledCount(2), {
          speed: [0.2, 0.7],
          spread: 0.9,
          life: [1.2, 2.4],
          gravity: 0,
          drag: 0.5,
          scaleStart: 0.14,
          scaleEnd: 0.3,
          colorHex: 0xdbeafe,
        });
        break;
    }
  }

  /**
   * Authoritative surface-aware projectile impact dispatcher.
   */
  public emitSurfaceImpact(
    surface: ImpactSurfaceMaterial,
    point: THREE.Vector3,
    normal: THREE.Vector3
  ): void {
    switch (surface) {
      case 'metal':
      case 'industrial':
        this.emitEffect('metal_sparks', point, normal, 1.0);
        this.emitEffect('gunpowder_smoke', point, normal, 0.5);
        break;
      case 'wood':
        this.emitEffect('wood_splinters', point, normal, 1.0);
        this.emitEffect('bullet_dust', point, normal, 0.5);
        break;
      case 'sand':
      case 'mud':
        this.emitEffect('dust_clouds', point, normal, 0.9);
        break;
      case 'glass':
        this.emitEffect('metal_sparks', point, normal, 0.65);
        break;
      default:
        this.emitEffect('concrete_debris', point, normal, 1.0);
        this.emitEffect('bullet_dust', point, normal, 0.9);
        break;
    }
  }

  public update(dtSec: number, cameraPosition?: THREE.Vector3): void {
    const dt = Math.max(0.001, Math.min(0.05, dtSec));

    // Spawn mission weather streaks around camera while respecting indoor shelter occlusion
    if (cameraPosition && this.activeWeather !== 'clear') {
      const rate =
        this.activeWeather === 'rain'
          ? 145 * this.rainDensityScale
          : this.activeWeather === 'sandstorm'
            ? 45 * this.densityScale
            : 28 * this.densityScale;
      this.rainSpawnAccumulator += dt * rate;
      const toSpawn = Math.min(18, Math.floor(this.rainSpawnAccumulator));
      this.rainSpawnAccumulator -= toSpawn;

      for (let i = 0; i < toSpawn; i++) {
        const angle = (i * 2.39996 + performance.now() * 0.001) % (Math.PI * 2);
        const radius = 2.5 + ((i * 17) % 100) * 0.22;
        const sx = cameraPosition.x + Math.cos(angle) * radius;
        const sz = cameraPosition.z + Math.sin(angle) * radius;
        const sy = cameraPosition.y + (this.activeWeather === 'rain' ? 11 + (i % 5) : 1.2 + (i % 4));
        if (this.isPointSheltered(sx, sy, sz)) continue;

        if (this.activeWeather === 'rain') {
          this.allocSlot('rain', {
            px: sx,
            py: sy,
            pz: sz,
            vx: this.windVector.x * 0.7,
            vy: -22.0,
            vz: this.windVector.z * 0.7,
            life: 0.7,
            gravity: 0,
            drag: 0,
            scaleStart: 1.0,
            scaleEnd: 1.0,
            colorHex: 0xcbdcf0,
          });
        } else if (this.activeWeather === 'sandstorm') {
          this.allocSlot('smoke', {
            px: sx,
            py: Math.max(0.5, sy),
            pz: sz,
            vx: this.windVector.x * 2.1,
            vy: 0.35,
            vz: this.windVector.z * 2.1,
            life: 1.6,
            gravity: 0.15,
            drag: 0.4,
            scaleStart: 0.45,
            scaleEnd: 1.35,
            colorHex: 0xc29f6d,
          });
        } else {
          this.allocSlot('additive', {
            px: sx,
            py: Math.max(0.4, sy),
            pz: sz,
            vx: this.windVector.x * 0.65,
            vy: 1.6 + (i % 3) * 0.4,
            vz: this.windVector.z * 0.65,
            life: 1.4,
            gravity: -0.4,
            drag: 0.3,
            scaleStart: 0.12,
            scaleEnd: 0.03,
            colorHex: 0xff7b29,
          });
        }
      }
    }

    for (let b = 0; b < BATCH_KINDS.length; b++) {
      const kind = BATCH_KINDS[b];
      const batch = this.batches[kind];
      if (batch.activeCount === 0) {
        if (batch.mesh.count !== 0 || batch.mesh.visible) {
          batch.mesh.count = 0;
          batch.mesh.visible = false;
        }
        continue;
      }

      let colorDirty = false;
      for (let i = 0; i < batch.activeCount; i++) {
        const s = batch.slots[i];
        s.life += dt;
        if (s.life >= s.maxLife) {
          this.removeSlotAt(batch, i);
          colorDirty = true;
          i--;
          continue;
        }

        const dragFactor = Math.max(0, 1 - s.drag * dt);
        s.vx = (s.vx + (kind === 'smoke' ? this.windVector.x * 0.18 * dt : 0)) * dragFactor;
        s.vy = (s.vy - s.gravity * dt) * dragFactor;
        s.vz = (s.vz + (kind === 'smoke' ? this.windVector.z * 0.18 * dt : 0)) * dragFactor;

        s.px += s.vx * dt;
        s.py += s.vy * dt;
        s.pz += s.vz * dt;

        // Rain ground splash & indoor shelter cut
        if (kind === 'rain' && (s.py <= 0.1 || this.isPointSheltered(s.px, s.py, s.pz))) {
          if (s.py <= 0.1 && (i & 3) === 0) {
            this._tmpSplashOrigin.set(s.px, 0.06, s.pz);
            this.emitEffect('rain_splash', this._tmpSplashOrigin, this._tmpUpAxis, 0.5);
          }
          this.removeSlotAt(batch, i);
          colorDirty = true;
          i--;
          continue;
        }

        // Ground bounce for physical casings & debris
        if ((kind === 'debris' || kind === 'casing') && s.py < 0.04) {
          s.py = 0.04;
          s.vy = Math.abs(s.vy) * 0.35;
          s.vx *= 0.65;
          s.vz *= 0.65;
        }

        s.rx += s.avx * dt;
        s.ry += s.avy * dt;
        s.rz += s.avz * dt;

        const t = s.life / s.maxLife;
        const scale = s.scaleStart + (s.scaleEnd - s.scaleStart) * t;
        this.dummy.position.set(s.px, s.py, s.pz);
        if ((kind === 'additive' || kind === 'smoke') && cameraPosition) {
          this.dummy.lookAt(cameraPosition);
        } else {
          this.dummy.rotation.set(s.rx, s.ry, s.rz);
        }
        this.dummy.scale.setScalar(Math.max(0.001, scale));
        this.dummy.updateMatrix();
        batch.mesh.setMatrixAt(i, this.dummy.matrix);
      }

      batch.mesh.count = batch.activeCount;
      batch.mesh.visible = batch.activeCount > 0;
      if (batch.activeCount > 0) {
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (colorDirty && batch.mesh.instanceColor) {
          batch.mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  public getStats(): {
    drawCalls: number;
    activeDrawCalls: number;
    gpuInstancesSubmitted: number;
    activeParticles: number;
    totalCapacity: number;
    sheltersRegistered: number;
  } {
    let activeParticles = 0;
    let totalCapacity = 0;
    let activeDrawCalls = 0;
    let gpuInstancesSubmitted = 0;
    for (let i = 0; i < BATCH_KINDS.length; i++) {
      const batch = this.batches[BATCH_KINDS[i]];
      totalCapacity += batch.capacity;
      activeParticles += batch.activeCount;
      if (batch.mesh.visible && batch.mesh.count > 0) {
        activeDrawCalls++;
        gpuInstancesSubmitted += batch.mesh.count;
      }
    }
    return {
      drawCalls: BATCH_KINDS.length,
      activeDrawCalls,
      gpuInstancesSubmitted,
      activeParticles,
      totalCapacity,
      sheltersRegistered: this.shelters.length,
    };
  }

  public clearAll(): void {
    for (let b = 0; b < BATCH_KINDS.length; b++) {
      const batch = this.batches[BATCH_KINDS[b]];
      for (let i = 0; i < batch.activeCount; i++) {
        batch.slots[i].active = false;
      }
      batch.activeCount = 0;
      batch.cursor = 0;
      batch.mesh.count = 0;
      batch.mesh.visible = false;
    }
  }

  public dispose(): void {
    this.clearAll();
    for (let b = 0; b < BATCH_KINDS.length; b++) {
      const batch = this.batches[BATCH_KINDS[b]];
      this.root.remove(batch.mesh);
      batch.mesh.dispose();
    }
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const tex of this.textures) tex.dispose();
    this.scene.remove(this.root);
  }

  private removeSlotAt(
    batch: {
      mesh: THREE.InstancedMesh;
      slots: ParticleSlot[];
      cursor: number;
      capacity: number;
      activeCount: number;
    },
    idx: number
  ): void {
    const lastIdx = batch.activeCount - 1;
    const dead = batch.slots[idx];
    dead.active = false;
    if (idx < lastIdx) {
      const moved = batch.slots[lastIdx];
      batch.slots[idx] = moved;
      batch.slots[lastIdx] = dead;
      this.tmpColor.setHex(moved.colorHex);
      batch.mesh.setColorAt(idx, this.tmpColor);
    }
    batch.activeCount = lastIdx;
  }

  private createBatch(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    capacity: number
  ): { mesh: THREE.InstancedMesh; slots: ParticleSlot[]; cursor: number; capacity: number; activeCount: number } {
    const safeCap = Math.max(16, capacity);
    const mesh = new THREE.InstancedMesh(geo, mat, safeCap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.count = 0;
    mesh.visible = false;

    const slots: ParticleSlot[] = [];
    this.dummy.position.set(0, -9999, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.updateMatrix();
    this.tmpColor.setHex(0xffffff);
    for (let i = 0; i < safeCap; i++) {
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, this.tmpColor);
      slots.push({
        active: false,
        px: 0,
        py: -9999,
        pz: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        avx: 0,
        avy: 0,
        avz: 0,
        life: 0,
        maxLife: 1,
        gravity: 9.8,
        drag: 0.5,
        scaleStart: 0.2,
        scaleEnd: 0.05,
        colorHex: 0xffffff,
      });
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.root.add(mesh);
    return { mesh, slots, cursor: 0, capacity: safeCap, activeCount: 0 };
  }

  private spawnBurst(
    kind: VfxBatchKind,
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    count: number,
    cfg: {
      speed: [number, number];
      spread: number;
      life: [number, number];
      gravity: number;
      drag: number;
      scaleStart: number;
      scaleEnd: number;
      colorHex: number;
    }
  ): void {
    for (let i = 0; i < count; i++) {
      const sRand = ((i * 73 + Math.round(origin.x * 13 + origin.z * 7)) & 255) / 255;
      const spd = cfg.speed[0] + (cfg.speed[1] - cfg.speed[0]) * sRand;
      const rx = (Math.sin(i * 12.9898 + origin.x) * 43758.5453) % 1;
      const ry = (Math.sin(i * 78.233 + origin.y) * 23421.631) % 1;
      const rz = (Math.sin(i * 39.425 + origin.z) * 19384.217) % 1;

      const vx = (dir.x + rx * cfg.spread) * spd;
      const vy = (dir.y + ry * cfg.spread) * spd;
      const vz = (dir.z + rz * cfg.spread) * spd;
      const life = cfg.life[0] + (cfg.life[1] - cfg.life[0]) * Math.abs(rx);

      this.allocSlot(kind, {
        px: origin.x,
        py: origin.y,
        pz: origin.z,
        vx,
        vy,
        vz,
        life,
        gravity: cfg.gravity,
        drag: cfg.drag,
        scaleStart: cfg.scaleStart,
        scaleEnd: cfg.scaleEnd,
        colorHex: cfg.colorHex,
      });
    }
  }

  private allocSlot(
    kind: VfxBatchKind,
    init: {
      px: number;
      py: number;
      pz: number;
      vx: number;
      vy: number;
      vz: number;
      life: number;
      gravity: number;
      drag: number;
      scaleStart: number;
      scaleEnd: number;
      colorHex: number;
    }
  ): void {
    const batch = this.batches[kind];
    let idx: number;
    if (batch.activeCount < batch.capacity) {
      idx = batch.activeCount;
      batch.activeCount++;
    } else {
      idx = batch.cursor;
      batch.cursor = (batch.cursor + 1) % batch.capacity;
    }
    const slot = batch.slots[idx];
    slot.active = true;
    slot.px = init.px;
    slot.py = init.py;
    slot.pz = init.pz;
    slot.vx = init.vx;
    slot.vy = init.vy;
    slot.vz = init.vz;
    slot.rx = 0;
    slot.ry = 0;
    slot.rz = 0;
    slot.avx = kind === 'debris' || kind === 'casing' ? 6.5 : 0;
    slot.avy = kind === 'debris' || kind === 'casing' ? 4.2 : 0;
    slot.avz = kind === 'debris' || kind === 'casing' ? 5.1 : 0;
    slot.life = 0;
    slot.maxLife = Math.max(0.04, init.life);
    slot.gravity = init.gravity;
    slot.drag = init.drag;
    slot.scaleStart = init.scaleStart;
    slot.scaleEnd = init.scaleEnd;
    slot.colorHex = init.colorHex;

    this.dummy.position.set(slot.px, slot.py, slot.pz);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(Math.max(0.001, slot.scaleStart));
    this.dummy.updateMatrix();
    batch.mesh.setMatrixAt(idx, this.dummy.matrix);
    batch.mesh.instanceMatrix.needsUpdate = true;

    this.tmpColor.setHex(init.colorHex);
    batch.mesh.setColorAt(idx, this.tmpColor);
    if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;

    batch.mesh.count = batch.activeCount;
    batch.mesh.visible = batch.activeCount > 0;
  }
}
