import * as THREE from 'three';
import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';
import {
  OPERATOR_CAMO_CATALOG,
  OPERATOR_HELMET_CATALOG,
} from '@/src/data/attachments';
import { SQUAD_ARCHETYPE_FLYWEIGHTS } from '@/src/data/squadRoster';
import { OperatorCustomization, SquadRoleId } from '@/src/schemas/campaign.schema';

export interface FriendlyOperatorRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  head: THREE.Object3D;
  rifle: THREE.Object3D;
  statusHalo: THREE.Mesh;
  statusHaloMat: THREE.MeshBasicMaterial;
  baseHaloColorHex: number;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  muzzleFlash: THREE.Mesh;
}

export interface SquadCommandBeacon {
  root: THREE.Group;
  ring: THREE.Mesh;
  pillar: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  active: boolean;
  ttlSec: number;
}

/**
 * Flyweight PBR geometry & material cache registered strictly inside a mission ResourceScope.
 * Guarantees zero geometry/material leaks across repeated mission load/unload cycles.
 */
export class FriendlySquadVisualPalette {
  private readonly sharedGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly sharedMaterials = new Map<string, THREE.Material>();

  constructor(
    private readonly resourceManager: ResourceManager,
    private readonly scope: ResourceScope
  ) {}

  getOrCreateGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geo = this.sharedGeometries.get(key);
    if (!geo) {
      geo = factory();
      this.resourceManager.registerGeometry(geo, this.scope);
      this.sharedGeometries.set(key, geo);
    }
    return geo;
  }

  getOrCreateStandardMaterial(
    key: string,
    colorHex: number,
    roughness = 0.68,
    metalness = 0.22
  ): THREE.MeshStandardMaterial {
    let mat = this.sharedMaterials.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness,
        metalness,
      });
      this.resourceManager.registerMaterial(mat, this.scope);
      this.sharedMaterials.set(key, mat);
    }
    return mat;
  }

  createUniqueBasicMaterial(colorHex: number, opacity = 0.8): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.resourceManager.registerMaterial(mat, this.scope);
    return mat;
  }

  buildOperatorRig(role: SquadRoleId, customization: OperatorCustomization): FriendlyOperatorRig {
    const archetype = SQUAD_ARCHETYPE_FLYWEIGHTS[role];
    const camo =
      OPERATOR_CAMO_CATALOG.find((c) => c.id === customization.camoId) ?? OPERATOR_CAMO_CATALOG[0];
    const helmet =
      OPERATOR_HELMET_CATALOG.find((h) => h.id === customization.helmetId) ?? OPERATOR_HELMET_CATALOG[0];

    const torsoGeo = this.getOrCreateGeometry('sq_torso', () => new THREE.BoxGeometry(0.46, 0.56, 0.26));
    const pauldronGeo = this.getOrCreateGeometry('sq_pauldron', () => new THREE.BoxGeometry(0.18, 0.14, 0.22));
    const headGeo = this.getOrCreateGeometry('sq_head', () => new THREE.BoxGeometry(0.24, 0.24, 0.24));
    const visorGeo = this.getOrCreateGeometry('sq_visor', () => new THREE.BoxGeometry(0.25, 0.08, 0.14));
    const limbGeo = this.getOrCreateGeometry('sq_limb', () => new THREE.BoxGeometry(0.14, 0.46, 0.14));
    const legGeo = this.getOrCreateGeometry('sq_leg', () => new THREE.BoxGeometry(0.16, 0.54, 0.16));
    const rifleGeo = this.getOrCreateGeometry('sq_rifle', () => new THREE.BoxGeometry(0.08, 0.1, 0.62));
    const haloGeo = this.getOrCreateGeometry('sq_halo', () => new THREE.RingGeometry(0.42, 0.56, 20));
    const flashGeo = this.getOrCreateGeometry('sq_flash', () => new THREE.OctahedronGeometry(0.11, 0));

    const armorMat = this.getOrCreateStandardMaterial(
      `camo_${camo.id}`,
      camo.primaryColorHex,
      0.66,
      0.24
    );
    const helmetMat = this.getOrCreateStandardMaterial(
      `helmet_${helmet.id}`,
      helmet.primaryColorHex,
      0.48,
      0.38
    );
    const visorMat = this.getOrCreateStandardMaterial(
      `visor_${helmet.id}`,
      helmet.accentColorHex,
      0.2,
      0.7
    );
    const accentMat = this.getOrCreateStandardMaterial(
      `role_accent_${role}`,
      archetype.rigAccentHex,
      0.4,
      0.35
    );
    const gunMat = this.getOrCreateStandardMaterial('sq_gun_metal', 0x1e242c, 0.42, 0.65);
    const packDarkMat = this.getOrCreateStandardMaterial('sq_pack_dark', 0x262d36, 0.72, 0.2);
    const medWhiteMat = this.getOrCreateStandardMaterial('sq_med_white', 0xe2e8f0, 0.45, 0.12);
    const flashMat = this.createUniqueBasicMaterial(0xfbbf24, 0.9);
    const statusHaloMat = this.createUniqueBasicMaterial(archetype.rigAccentHex, 0.65);

    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    const torso = new THREE.Mesh(torsoGeo, armorMat);
    torso.position.set(0, 1.04, 0);
    bodyGroup.add(torso);

    // Armored shoulder pauldrons for strong military silhouette readability
    const leftPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    leftPauldron.position.set(-0.31, 1.26, 0.02);
    bodyGroup.add(leftPauldron);

    const rightPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    rightPauldron.position.set(0.31, 1.26, 0.02);
    bodyGroup.add(rightPauldron);

    const chestBand = new THREE.Mesh(
      this.getOrCreateGeometry('sq_band', () => new THREE.BoxGeometry(0.48, 0.1, 0.28)),
      accentMat
    );
    chestBand.position.set(0, 1.15, 0);
    bodyGroup.add(chestBand);

    // Role-distinct Flyweight backpack / tactical kit (zero per-instance geometry allocation)
    if (role === 'medic') {
      const medPack = new THREE.Mesh(
        this.getOrCreateGeometry('sq_medpack', () => new THREE.BoxGeometry(0.32, 0.36, 0.16)),
        medWhiteMat
      );
      medPack.position.set(0, 1.08, -0.2);
      bodyGroup.add(medPack);
      const crossH = new THREE.Mesh(
        this.getOrCreateGeometry('sq_med_cross_h', () => new THREE.BoxGeometry(0.18, 0.05, 0.03)),
        accentMat
      );
      crossH.position.set(0, 1.09, -0.285);
      bodyGroup.add(crossH);
      const crossV = new THREE.Mesh(
        this.getOrCreateGeometry('sq_med_cross_v', () => new THREE.BoxGeometry(0.05, 0.18, 0.03)),
        accentMat
      );
      crossV.position.set(0, 1.09, -0.285);
      bodyGroup.add(crossV);
    } else if (role === 'anti_armor') {
      const launcherTube = new THREE.Mesh(
        this.getOrCreateGeometry('sq_at_tube', () => new THREE.CylinderGeometry(0.065, 0.075, 0.92, 8)),
        packDarkMat
      );
      launcherTube.position.set(-0.18, 1.24, -0.22);
      launcherTube.rotation.z = 0.28;
      bodyGroup.add(launcherTube);
      const warheadTip = new THREE.Mesh(
        this.getOrCreateGeometry('sq_at_tip', () => new THREE.CylinderGeometry(0.05, 0.072, 0.14, 8)),
        accentMat
      );
      warheadTip.position.set(-0.31, 1.66, -0.22);
      warheadTip.rotation.z = 0.28;
      bodyGroup.add(warheadTip);
    } else if (role === 'recon') {
      const reconPack = new THREE.Mesh(
        this.getOrCreateGeometry('sq_recon_pack', () => new THREE.BoxGeometry(0.24, 0.3, 0.12)),
        packDarkMat
      );
      reconPack.position.set(0, 1.08, -0.18);
      bodyGroup.add(reconPack);
      const mast = new THREE.Mesh(
        this.getOrCreateGeometry('sq_recon_mast', () => new THREE.CylinderGeometry(0.014, 0.018, 0.68, 6)),
        accentMat
      );
      mast.position.set(0.08, 1.54, -0.19);
      bodyGroup.add(mast);
    } else if (role === 'support') {
      const ammoBox = new THREE.Mesh(
        this.getOrCreateGeometry('sq_support_pack', () => new THREE.BoxGeometry(0.38, 0.42, 0.2)),
        packDarkMat
      );
      ammoBox.position.set(0, 1.07, -0.22);
      bodyGroup.add(ammoBox);
      const ammoStrip = new THREE.Mesh(
        this.getOrCreateGeometry('sq_support_strip', () => new THREE.BoxGeometry(0.34, 0.08, 0.04)),
        accentMat
      );
      ammoStrip.position.set(0, 1.18, -0.325);
      bodyGroup.add(ammoStrip);
    } else {
      const breachPack = new THREE.Mesh(
        this.getOrCreateGeometry('sq_assault_pack', () => new THREE.BoxGeometry(0.28, 0.32, 0.14)),
        packDarkMat
      );
      breachPack.position.set(0, 1.07, -0.19);
      bodyGroup.add(breachPack);
    }

    const head = new THREE.Mesh(headGeo, helmetMat);
    head.position.set(0, 1.48, 0);
    bodyGroup.add(head);

    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.01, 0.09);
    head.add(visor);

    const leftArm = new THREE.Mesh(limbGeo, armorMat);
    leftArm.position.set(-0.31, 1.0, 0.08);
    bodyGroup.add(leftArm);

    const rightArm = new THREE.Mesh(limbGeo, armorMat);
    rightArm.position.set(0.31, 1.0, 0.12);
    bodyGroup.add(rightArm);

    const rifle = new THREE.Mesh(rifleGeo, gunMat);
    rifle.position.set(0.24, 0.98, 0.36);
    bodyGroup.add(rifle);

    const muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    muzzleFlash.position.set(0, 0.01, 0.36);
    muzzleFlash.visible = false;
    rifle.add(muzzleFlash);

    const leftLeg = new THREE.Mesh(legGeo, armorMat);
    leftLeg.position.set(-0.13, 0.45, 0);
    bodyGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, armorMat);
    rightLeg.position.set(0.13, 0.45, 0);
    bodyGroup.add(rightLeg);

    const statusHalo = new THREE.Mesh(haloGeo, statusHaloMat);
    statusHalo.rotation.x = -Math.PI / 2;
    statusHalo.position.set(0, 0.05, 0);
    root.add(statusHalo);

    return {
      root,
      bodyGroup,
      head,
      rifle,
      statusHalo,
      statusHaloMat,
      baseHaloColorHex: archetype.rigAccentHex,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      muzzleFlash,
    };
  }

  buildCommandBeacon(): SquadCommandBeacon {
    const ringGeo = this.getOrCreateGeometry('sq_beacon_ring', () => new THREE.RingGeometry(0.55, 0.82, 24));
    const pillarGeo = this.getOrCreateGeometry(
      'sq_beacon_pillar',
      () => new THREE.CylinderGeometry(0.06, 0.14, 2.2, 8, 1, true)
    );
    const material = this.createUniqueBasicMaterial(0x38bdf8, 0.72);

    const root = new THREE.Group();
    root.visible = false;

    const ring = new THREE.Mesh(ringGeo, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    root.add(ring);

    const pillar = new THREE.Mesh(pillarGeo, material);
    pillar.position.y = 1.15;
    root.add(pillar);

    return {
      root,
      ring,
      pillar,
      material,
      active: false,
      ttlSec: 0,
    };
  }
}
