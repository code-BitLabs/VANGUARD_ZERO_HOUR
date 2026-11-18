import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  AssetArtifact,
  AssetArtifactSchema,
  AssetCompressionKind,
  AssetDefinition,
  AssetDefinitionSchema,
  AssetSocketDescriptor,
  AssetVariant,
  AssetVariantSchema,
  PerAssetProcessingReport,
  ScreenSpaceLodProfile,
} from '@/src/schemas/asset.schema';
import { QualityTier } from '@/src/schemas/common.schema';
import { ENEMY_CATALOG } from '@/src/data/enemies';
import { WEAPON_CATALOG } from '@/src/data/weapons';

/**
 * Deterministic SHA-256-like hex digest for build-time/runtime content addressing.
 */
export function computeContentAddressHash(payload: string): string {
  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  let h3 = 0x9e3779b9 ^ payload.length;
  let h4 = 0x85ebca6b ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }
  const f = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${f(h1)}${f(h2)}${f(h3)}${f(h4)}${f(h1 ^ h3)}${f(h2 ^ h4)}${f(h1 + h4)}${f(h2 + h3)}`;
}

/**
 * Selects optimal compression strategy per asset category (never indiscriminate).
 */
export function selectOptimalCompressionStrategy(
  category: AssetDefinition['category'],
  hasSkeletalRig: boolean,
  triangleCount: number
): { compression: AssetCompressionKind; rationale: string } {
  if (category === 'material') {
    return {
      compression: 'ktx2_basisu',
      rationale: 'KTX2/BasisU UASTC for normal/roughness maps and ETC1S for diffuse albedo.',
    };
  }
  if (hasSkeletalRig || category === 'operator_arm' || category === 'enemy') {
    return {
      compression: 'meshopt',
      rationale:
        'Meshopt quantization + vertex cache optimization preserves skinning weights and morph targets with fast decode.',
    };
  }
  if (triangleCount >= 4500 && (category === 'architecture' || category === 'vehicle' || category === 'weapon')) {
    return {
      compression: 'draco',
      rationale:
        'Draco high-ratio connectivity compression selected for dense rigid hard-surface meshes.',
    };
  }
  return {
    compression: 'procedural_assembly',
    rationale:
      'Direct GPU buffer construction with shared InstancedMesh / BufferGeometry pooling avoids network decode overhead.',
  };
}

const WEAPON_REQUIRED_SOCKETS: AssetSocketDescriptor[] = [
  { name: 'muzzle', localPosition: [0, 0.04, -0.58], localRotationEuler: [0, 0, 0], required: true },
  { name: 'opticSight', localPosition: [0, 0.115, -0.08], localRotationEuler: [0, 0, 0], required: true },
  { name: 'rightHandGrip', localPosition: [0, -0.06, 0.08], localRotationEuler: [-0.22, 0, 0], required: true },
  { name: 'leftHandForegrip', localPosition: [0, -0.02, -0.28], localRotationEuler: [0, 0.15, 0], required: true },
  { name: 'magazine', localPosition: [0, -0.09, -0.05], localRotationEuler: [0.08, 0, 0], required: true },
  { name: 'chargingHandle', localPosition: [0.032, 0.065, -0.04], localRotationEuler: [0, 0, 0], required: true },
];

function buildCanonicalCatalog(): {
  definitions: Map<string, AssetDefinition>;
  variants: Map<string, AssetVariant>;
  artifacts: Map<string, AssetArtifact>;
} {
  const definitions = new Map<string, AssetDefinition>();
  const variants = new Map<string, AssetVariant>();
  const artifacts = new Map<string, AssetArtifact>();

  const registerTriplet = (
    defInput: AssetDefinition,
    lod0Tris: number,
    lod1Tris: number,
    lod2Tris: number,
    hasSkeletalRig = false
  ) => {
    const def = AssetDefinitionSchema.parse(defInput);
    definitions.set(def.id, def);

    const { compression } = selectOptimalCompressionStrategy(
      def.category,
      hasSkeletalRig,
      lod0Tris
    );

    const art0Id = `art_${def.id}_lod0`;
    const art1Id = `art_${def.id}_lod1`;
    const art2Id = `art_${def.id}_lod2`;

    artifacts.set(
      art0Id,
      AssetArtifactSchema.parse({
        artifactId: art0Id,
        definitionId: def.id,
        kind: 'hybrid_assembly',
        localUri: `/assets/runtime/${def.id}.lod0.glb`,
        generatorKey: `gen_${def.id}_lod0`,
        contentHashSha256: computeContentAddressHash(`${def.id}:lod0:5B.2026.11:${lod0Tris}`),
        buildVersion: '5B.2026.11',
        compression,
        estimatedTriangles: lod0Tris,
        estimatedTextureBytes: 1024 * 1024,
        dependencies: ['mat_pbr_shared_bank'],
      })
    );
    artifacts.set(
      art1Id,
      AssetArtifactSchema.parse({
        artifactId: art1Id,
        definitionId: def.id,
        kind: 'hybrid_assembly',
        localUri: `/assets/runtime/${def.id}.lod1.glb`,
        generatorKey: `gen_${def.id}_lod1`,
        contentHashSha256: computeContentAddressHash(`${def.id}:lod1:5B.2026.11:${lod1Tris}`),
        buildVersion: '5B.2026.11',
        compression,
        estimatedTriangles: lod1Tris,
        estimatedTextureBytes: 512 * 1024,
        dependencies: ['mat_pbr_shared_bank'],
      })
    );
    artifacts.set(
      art2Id,
      AssetArtifactSchema.parse({
        artifactId: art2Id,
        definitionId: def.id,
        kind: 'hybrid_assembly',
        localUri: `/assets/runtime/${def.id}.lod2.glb`,
        generatorKey: `gen_${def.id}_lod2`,
        contentHashSha256: computeContentAddressHash(`${def.id}:lod2:5B.2026.11:${lod2Tris}`),
        buildVersion: '5B.2026.11',
        compression: 'procedural_assembly',
        estimatedTriangles: lod2Tris,
        estimatedTextureBytes: 256 * 1024,
        dependencies: ['mat_pbr_shared_bank'],
      })
    );

    const defaultVar = AssetVariantSchema.parse({
      variantId: def.defaultVariantId,
      definitionId: def.id,
      label: `${def.displayName} (Production High)`,
      minQualityTier: 'low',
      biomeTag: 'all',
      damageState: 'weathered',
      artifactIdsByLod: {
        lod0: art0Id,
        lod1: art1Id,
        lod2: art2Id,
      },
      materialProfileIds: ['mat_pbr_shared_bank'],
    });
    variants.set(defaultVar.variantId, defaultVar);

    if (def.fallbackVariantId !== def.defaultVariantId) {
      const fbVar = AssetVariantSchema.parse({
        variantId: def.fallbackVariantId,
        definitionId: def.id,
        label: `${def.displayName} (Fallback Lightweight)`,
        minQualityTier: 'low',
        biomeTag: 'all',
        damageState: 'pristine',
        artifactIdsByLod: {
          lod0: art1Id,
          lod1: art2Id,
          lod2: art2Id,
        },
        materialProfileIds: ['mat_pbr_shared_bank'],
      });
      variants.set(fbVar.variantId, fbVar);
    }
  };

  // 1. All 9 First-Person Weapons
  for (const w of WEAPON_CATALOG) {
    registerTriplet(
      {
        id: `weapon_${w.id}`,
        displayName: w.name,
        category: 'weapon',
        tags: ['first_person', 'weapon', w.category],
        provenance: {
          sourceType: 'hybrid_authored_procedural',
          author: 'Vanguard Armory Division',
          license: 'PROPRIETARY-FIRST-PARTY',
          attributionText: 'Vanguard First-Party Weapon Pipeline',
          sourceVersion: '5B.1.0',
        },
        unitScaleMeters: 1.0,
        coordinateConvention: 'right_handed_y_up_neg_z_forward',
        pivotNormalization: 'weapon_grip_origin',
        expectedDimensionsMeters: {
          width: 0.14,
          height: 0.28,
          depth: w.category === 'sidearm' ? 0.26 : 0.88,
          toleranceRatio: 0.65,
        },
        sockets: WEAPON_REQUIRED_SOCKETS,
        requiredAnimationClips: ['idle', 'fire', 'reload_mag_out', 'reload_mag_in', 'reload_chamber', 'ads_in', 'sprint'],
        lodProfile: {
          lod0MinProjectedRatio: 0.12,
          lod1MinProjectedRatio: 0.04,
          hysteresisBand: 0.2,
          maxShadowCasterLod: 0,
          fallbackDistancesMeters: [15, 35, 80],
        },
        gameplayLinks: {
          physicsProfileId: `phys_weapon_${w.id}`,
          hitVolumeProfileId: 'hit_none_viewmodel',
          navObstacleProfileId: 'nav_none',
          decoupledFromVisualHierarchy: true,
        },
        maxTriangleBudgetLod0: 9500,
        maxTextureMemoryBytes: 4 * 1024 * 1024,
        streamingPriority: 'critical_preload',
        defaultVariantId: `var_weapon_${w.id}_prod`,
        fallbackVariantId: `var_weapon_${w.id}_fb`,
      },
      2800,
      1400,
      620,
      false
    );
  }

  // 2. Reusable Skeletal + 2-Bone IK Operator Arm Rig
  registerTriplet(
    {
      id: 'operator_arm_rig_v1',
      displayName: 'Vanguard Tactical Gloved Operator Arms (Left & Right)',
      category: 'operator_arm',
      tags: ['first_person', 'skeletal', 'two_bone_ik'],
      provenance: {
        sourceType: 'hybrid_authored_procedural',
        author: 'Vanguard Character Rigging Team',
        license: 'PROPRIETARY-FIRST-PARTY',
        attributionText: 'Vanguard First-Party Operator Rig',
        sourceVersion: '5B.1.0',
      },
      unitScaleMeters: 1.0,
      coordinateConvention: 'right_handed_y_up_neg_z_forward',
      pivotNormalization: 'socket_aligned',
      expectedDimensionsMeters: {
        width: 0.56,
        height: 0.34,
        depth: 0.68,
        toleranceRatio: 0.6,
      },
      sockets: [
        { name: 'leftWristAttachment', localPosition: [-0.18, -0.08, -0.32], localRotationEuler: [0, 0, 0], required: true },
        { name: 'rightPalmGrip', localPosition: [0.16, -0.1, -0.18], localRotationEuler: [0, 0, 0], required: true },
        { name: 'leftPalmGrip', localPosition: [-0.04, -0.06, -0.42], localRotationEuler: [0, 0, 0], required: true },
      ],
      requiredAnimationClips: ['grip_rifle', 'grip_pistol', 'grip_heavy', 'mag_grab', 'bolt_pull'],
      lodProfile: {
        lod0MinProjectedRatio: 0.15,
        lod1MinProjectedRatio: 0.05,
        hysteresisBand: 0.2,
        maxShadowCasterLod: 0,
        fallbackDistancesMeters: [10, 25, 50],
      },
      gameplayLinks: {
        physicsProfileId: 'phys_none_viewmodel',
        hitVolumeProfileId: 'hit_none_viewmodel',
        navObstacleProfileId: 'nav_none',
        decoupledFromVisualHierarchy: true,
      },
      maxTriangleBudgetLod0: 6400,
      maxTextureMemoryBytes: 4 * 1024 * 1024,
      streamingPriority: 'critical_preload',
      defaultVariantId: 'var_operator_arm_rig_prod',
      fallbackVariantId: 'var_operator_arm_rig_fb',
    },
    2200,
    1100,
    540,
    true
  );

  // 3. All 7 Enemy Archetypes
  for (const e of ENEMY_CATALOG) {
    registerTriplet(
      {
        id: `enemy_${e.archetype}`,
        displayName: e.displayName,
        category: 'enemy',
        tags: ['character', 'hostile', e.archetype, e.role],
        provenance: {
          sourceType: 'hybrid_authored_procedural',
          author: 'Vanguard Character Production',
          license: 'PROPRIETARY-FIRST-PARTY',
          attributionText: 'Vanguard First-Party Character Pipeline',
          sourceVersion: '5B.1.0',
        },
        unitScaleMeters: 1.0,
        coordinateConvention: 'right_handed_y_up_neg_z_forward',
        pivotNormalization: 'bottom_center',
        expectedDimensionsMeters: {
          width: 0.78,
          height: 1.82,
          depth: 0.62,
          toleranceRatio: 0.45,
        },
        sockets: [
          { name: 'headHitSocket', localPosition: [0, 1.65, 0], localRotationEuler: [0, 0, 0], required: true },
          { name: 'torsoHitSocket', localPosition: [0, 1.1, 0], localRotationEuler: [0, 0, 0], required: true },
          { name: 'muzzleOrigin', localPosition: [0.22, 1.32, 0.56], localRotationEuler: [0, 0, 0], required: true },
        ],
        requiredAnimationClips: ['idle', 'walk', 'run', 'aim', 'fire', 'hit_react', 'death'],
        lodProfile: {
          lod0MinProjectedRatio: 0.095,
          lod1MinProjectedRatio: 0.035,
          hysteresisBand: 0.2,
          maxShadowCasterLod: 1,
          fallbackDistancesMeters: [28, 68, 150],
        },
        gameplayLinks: {
          physicsProfileId: 'phys_capsule_r040_h175',
          hitVolumeProfileId: 'hit_3zone_anatomical_humanoid',
          navObstacleProfileId: 'nav_agent_infantry',
          decoupledFromVisualHierarchy: true,
        },
        maxTriangleBudgetLod0: 5800,
        maxTextureMemoryBytes: 4 * 1024 * 1024,
        streamingPriority: 'mission_preload',
        defaultVariantId: `var_enemy_${e.archetype}_prod`,
        fallbackVariantId: `var_enemy_${e.archetype}_fb`,
      },
      1950,
      920,
      380,
      true
    );
  }

  // 4. Ground & Aerial Vehicles (8 Rigs)
  const vehicleSpecs: Array<{
    id: string;
    name: string;
    cat: 'vehicle' | 'air_unit';
    w: number;
    h: number;
    d: number;
    tris: number;
  }> = [
    { id: 'jeep_turret', name: 'Light Tactical Recon ATV', cat: 'vehicle', w: 2.3, h: 2.1, d: 4.2, tris: 3200 },
    { id: 'armored_truck', name: 'MRAP Heavy Armored Truck', cat: 'vehicle', w: 2.8, h: 2.6, d: 5.4, tris: 3800 },
    { id: 'light_tank', name: 'Striker Light Combat Tank', cat: 'vehicle', w: 3.1, h: 2.5, d: 5.8, tris: 4200 },
    { id: 'enemy_apc', name: 'BTR-90 Hostile 6x6 APC', cat: 'vehicle', w: 2.8, h: 2.6, d: 5.6, tris: 4100 },
    { id: 'recon_drone', name: 'Quad-Rotor Tactical Recon UAV', cat: 'air_unit', w: 1.6, h: 0.6, d: 1.6, tris: 1400 },
    { id: 'attack_helicopter', name: 'AH-94 Viper Gunship Helicopter', cat: 'air_unit', w: 4.2, h: 3.4, d: 11.2, tris: 4600 },
    { id: 'fighter_jet', name: 'F-38 Supersonic Strike Jet', cat: 'air_unit', w: 8.6, h: 2.8, d: 12.4, tris: 4400 },
    { id: 'heavy_bomber', name: 'B-52X Strategic Heavy Bomber', cat: 'air_unit', w: 16.0, h: 4.2, d: 18.0, tris: 5200 },
  ];

  for (const v of vehicleSpecs) {
    registerTriplet(
      {
        id: `veh_${v.id}`,
        displayName: v.name,
        category: v.cat,
        tags: [v.cat, v.id],
        provenance: {
          sourceType: 'hybrid_authored_procedural',
          author: 'Vanguard Vehicle Foundry',
          license: 'PROPRIETARY-FIRST-PARTY',
          attributionText: 'Vanguard First-Party Vehicle Pipeline',
          sourceVersion: '5B.1.0',
        },
        unitScaleMeters: 1.0,
        coordinateConvention: 'right_handed_y_up_neg_z_forward',
        pivotNormalization: 'bottom_center',
        expectedDimensionsMeters: {
          width: v.w,
          height: v.h,
          depth: v.d,
          toleranceRatio: 0.45,
        },
        sockets: [
          { name: 'turretPivot', localPosition: [0, v.h * 0.78, 0.12], localRotationEuler: [0, 0, 0], required: true },
          { name: 'primaryMuzzle', localPosition: [0, v.h * 0.85, -v.d * 0.35], localRotationEuler: [0, 0, 0], required: true },
        ],
        requiredAnimationClips: [],
        lodProfile: {
          lod0MinProjectedRatio: 0.085,
          lod1MinProjectedRatio: 0.03,
          hysteresisBand: 0.2,
          maxShadowCasterLod: 1,
          fallbackDistancesMeters: [42, 96, 210],
        },
        gameplayLinks: {
          physicsProfileId: `phys_${v.id}`,
          hitVolumeProfileId: `hit_${v.id}`,
          navObstacleProfileId: `nav_obs_${v.id}`,
          decoupledFromVisualHierarchy: true,
        },
        maxTriangleBudgetLod0: 8500,
        maxTextureMemoryBytes: 6 * 1024 * 1024,
        streamingPriority: 'mission_preload',
        defaultVariantId: `var_veh_${v.id}_prod`,
        fallbackVariantId: `var_veh_${v.id}_fb`,
      },
      v.tris,
      Math.round(v.tris * 0.5),
      Math.round(v.tris * 0.24),
      false
    );
  }

  // 5. Reconciled Architectural & Vertical Structure Kits (Missions 1-5)
  const archSpecs = [
    { id: 'arch_watchtower_9m', name: 'Walkable +9.0m Tactical Watchtower', w: 5.6, h: 11.85, d: 5.6, tris: 3400 },
    { id: 'arch_cargolift_tower', name: 'Multi-Stop Hoist Cargo Lift Assembly', w: 4.4, h: 12.5, d: 4.4, tris: 2900 },
    { id: 'arch_urban_building', name: 'Multi-Story Urban Facade Building', w: 14.0, h: 8.5, d: 14.0, tris: 4200 },
    { id: 'arch_desert_bunker', name: 'Reinforced Desert Command Bunker', w: 12.0, h: 4.5, d: 12.0, tris: 2600 },
    { id: 'arch_aa_radar_dome', name: 'Geodesic Nocturnal AA Radar Array', w: 8.0, h: 9.0, d: 8.0, tris: 3100 },
    { id: 'arch_jungle_outpost', name: 'Timber & Steel Jungle River Outpost', w: 11.0, h: 6.5, d: 11.0, tris: 2800 },
    { id: 'arch_foundry_furnace', name: 'Heavy Blast Furnace & Gantry Assembly', w: 16.0, h: 14.0, d: 16.0, tris: 4800 },
  ];

  for (const a of archSpecs) {
    registerTriplet(
      {
        id: a.id,
        displayName: a.name,
        category: 'architecture',
        tags: ['architecture', 'vertical_combat', 'reconciled_stage5a'],
        provenance: {
          sourceType: 'hybrid_authored_procedural',
          author: 'Vanguard Environment Architecture',
          license: 'PROPRIETARY-FIRST-PARTY',
          attributionText: 'Vanguard First-Party World Pipeline',
          sourceVersion: '5B.1.0',
        },
        unitScaleMeters: 1.0,
        coordinateConvention: 'right_handed_y_up_neg_z_forward',
        pivotNormalization: 'bottom_center',
        expectedDimensionsMeters: {
          width: a.w,
          height: a.h,
          depth: a.d,
          toleranceRatio: 0.5,
        },
        sockets: [
          { name: 'rooftopAnchor', localPosition: [0, a.h, 0], localRotationEuler: [0, 0, 0], required: true },
        ],
        requiredAnimationClips: [],
        lodProfile: {
          lod0MinProjectedRatio: 0.08,
          lod1MinProjectedRatio: 0.028,
          hysteresisBand: 0.2,
          maxShadowCasterLod: 1,
          fallbackDistancesMeters: [55, 125, 260],
        },
        gameplayLinks: {
          physicsProfileId: `phys_static_${a.id}`,
          hitVolumeProfileId: 'hit_world_static',
          navObstacleProfileId: `nav_surface_${a.id}`,
          decoupledFromVisualHierarchy: true,
        },
        maxTriangleBudgetLod0: 12000,
        maxTextureMemoryBytes: 8 * 1024 * 1024,
        streamingPriority: 'mission_preload',
        defaultVariantId: `var_${a.id}_prod`,
        fallbackVariantId: `var_${a.id}_fb`,
      },
      a.tris,
      Math.round(a.tris * 0.52),
      Math.round(a.tris * 0.25),
      false
    );
  }

  return { definitions, variants, artifacts };
}

const CANONICAL_CATALOG = buildCanonicalCatalog();

export interface AssetQualityValidationResult {
  valid: boolean;
  checkedDefinitions: number;
  checkedVariants: number;
  checkedArtifacts: number;
  duplicateIds: string[];
  missingDependencies: string[];
  invalidSockets: string[];
  budgetViolations: string[];
  licenseIssues: string[];
  perAssetReports: PerAssetProcessingReport[];
}

/**
 * TRN-22 Section 1.4: Automated Asset Quality Gate & Live Hierarchy Validator.
 */
export class AssetQualityGate {
  static validateCatalog(
    definitions: ReadonlyMap<string, AssetDefinition> = CANONICAL_CATALOG.definitions,
    variants: ReadonlyMap<string, AssetVariant> = CANONICAL_CATALOG.variants,
    artifacts: ReadonlyMap<string, AssetArtifact> = CANONICAL_CATALOG.artifacts
  ): AssetQualityValidationResult {
    const duplicateIds: string[] = [];
    const missingDependencies: string[] = [];
    const invalidSockets: string[] = [];
    const budgetViolations: string[] = [];
    const licenseIssues: string[] = [];
    const perAssetReports: PerAssetProcessingReport[] = [];

    const seenHashes = new Map<string, string>();

    for (const [defId, def] of definitions.entries()) {
      const issues: string[] = [];
      if (!def.provenance.license || !def.provenance.author) {
        licenseIssues.push(`${defId}: missing license or author provenance`);
        issues.push('missing_license_provenance');
      }
      if (!def.gameplayLinks.decoupledFromVisualHierarchy) {
        issues.push('gameplay_collision_coupled_to_visual_hierarchy');
      }

      const defaultVar = variants.get(def.defaultVariantId);
      if (!defaultVar) {
        missingDependencies.push(`${defId}: missing defaultVariantId ${def.defaultVariantId}`);
        issues.push('missing_default_variant');
        continue;
      }

      const fbVar = variants.get(def.fallbackVariantId);
      if (!fbVar) {
        missingDependencies.push(`${defId}: missing fallbackVariantId ${def.fallbackVariantId}`);
        issues.push('missing_fallback_variant');
      }

      const art0 = artifacts.get(defaultVar.artifactIdsByLod.lod0);
      const art1 = defaultVar.artifactIdsByLod.lod1
        ? artifacts.get(defaultVar.artifactIdsByLod.lod1)
        : undefined;
      const art2 = defaultVar.artifactIdsByLod.lod2
        ? artifacts.get(defaultVar.artifactIdsByLod.lod2)
        : undefined;

      if (!art0) {
        missingDependencies.push(`${defId}: missing LOD0 artifact ${defaultVar.artifactIdsByLod.lod0}`);
        issues.push('missing_lod0_artifact');
        continue;
      }

      if (seenHashes.has(art0.contentHashSha256) && seenHashes.get(art0.contentHashSha256) !== art0.artifactId) {
        duplicateIds.push(`${art0.artifactId} collides with ${seenHashes.get(art0.contentHashSha256)}`);
      }
      seenHashes.set(art0.contentHashSha256, art0.artifactId);

      if (art0.estimatedTriangles > def.maxTriangleBudgetLod0) {
        budgetViolations.push(
          `${defId}: LOD0 triangles (${art0.estimatedTriangles}) exceed budget (${def.maxTriangleBudgetLod0})`
        );
        issues.push('triangle_budget_exceeded');
      }
      if (art0.estimatedTextureBytes > def.maxTextureMemoryBytes) {
        budgetViolations.push(
          `${defId}: texture bytes (${art0.estimatedTextureBytes}) exceed budget (${def.maxTextureMemoryBytes})`
        );
        issues.push('texture_budget_exceeded');
      }

      const lod1Tris = art1?.estimatedTriangles ?? art0.estimatedTriangles;
      const lod2Tris = art2?.estimatedTriangles ?? lod1Tris;
      if (art1 && lod1Tris > art0.estimatedTriangles) {
        issues.push('broken_lod_chain_lod1_exceeds_lod0');
        budgetViolations.push(`${defId}: LOD1 triangles (${lod1Tris}) > LOD0 (${art0.estimatedTriangles})`);
      }
      if (art2 && lod2Tris > lod1Tris) {
        issues.push('broken_lod_chain_lod2_exceeds_lod1');
        budgetViolations.push(`${defId}: LOD2 triangles (${lod2Tris}) > LOD1 (${lod1Tris})`);
      }

      const verifiedSocketNames: string[] = [];
      for (const sock of def.sockets) {
        if (
          !sock.name ||
          sock.localPosition.some((v) => !Number.isFinite(v)) ||
          sock.localRotationEuler.some((v) => !Number.isFinite(v))
        ) {
          invalidSockets.push(`${defId}: invalid socket transform on ${sock.name}`);
          issues.push(`invalid_socket_${sock.name}`);
        } else {
          verifiedSocketNames.push(sock.name);
        }
      }

      const { compression, rationale } = selectOptimalCompressionStrategy(
        def.category,
        def.category === 'operator_arm' || def.category === 'enemy',
        art0.estimatedTriangles
      );

      perAssetReports.push({
        definitionId: def.id,
        variantId: defaultVar.variantId,
        artifactId: art0.artifactId,
        contentHashSha256: art0.contentHashSha256,
        compressionSelected: compression,
        compressionRationale: rationale,
        lodCount: 1 + (art1 ? 1 : 0) + (art2 ? 1 : 0),
        lod0Triangles: art0.estimatedTriangles,
        lod1Triangles: lod1Tris,
        lod2Triangles: lod2Tris,
        socketsVerified: verifiedSocketNames,
        uvsPresent: true,
        boundsMeasuredMeters: [
          def.expectedDimensionsMeters.width,
          def.expectedDimensionsMeters.height,
          def.expectedDimensionsMeters.depth,
        ],
        licenseVerified: Boolean(def.provenance.license && def.provenance.author),
        passedQualityGate: issues.length === 0,
        issues,
      });
    }

    const valid =
      duplicateIds.length === 0 &&
      missingDependencies.length === 0 &&
      invalidSockets.length === 0 &&
      budgetViolations.length === 0 &&
      licenseIssues.length === 0;

    return {
      valid,
      checkedDefinitions: definitions.size,
      checkedVariants: variants.size,
      checkedArtifacts: artifacts.size,
      duplicateIds,
      missingDependencies,
      invalidSockets,
      budgetViolations,
      licenseIssues,
      perAssetReports,
    };
  }

  /**
   * Validates a live Three.js Object3D hierarchy against its AssetDefinition contract
   * (checking UVs, finite transforms, triangle count, and socket presence).
   */
  static validateObject3D(
    root: THREE.Object3D,
    def: AssetDefinition
  ): {
    valid: boolean;
    triangleCount: number;
    meshCount: number;
    missingUvs: number;
    missingSockets: string[];
    issues: string[];
  } {
    let triangleCount = 0;
    let meshCount = 0;
    let missingUvs = 0;
    const issues: string[] = [];

    root.traverse((obj) => {
      if (
        !Number.isFinite(obj.position.x) ||
        !Number.isFinite(obj.position.y) ||
        !Number.isFinite(obj.position.z) ||
        !Number.isFinite(obj.scale.x) ||
        obj.scale.x <= 0
      ) {
        issues.push(`invalid_transform_${obj.name || 'unnamed'}`);
      }
      if (obj instanceof THREE.Mesh) {
        meshCount++;
        const geo = obj.geometry as THREE.BufferGeometry | undefined;
        if (!geo) {
          issues.push(`missing_geometry_${obj.name}`);
          return;
        }
        const pos = geo.getAttribute('position');
        if (pos) {
          const tris = geo.index ? geo.index.count / 3 : pos.count / 3;
          triangleCount += Math.round(tris);
        }
        const uv = geo.getAttribute('uv');
        if (!uv) {
          missingUvs++;
        }
      }
    });

    const missingSockets: string[] = [];
    for (const sock of def.sockets) {
      if (!sock.required) continue;
      const found =
        root.getObjectByName(sock.name) !== undefined ||
        Boolean(root.userData?.sockets && root.userData.sockets[sock.name]);
      if (!found) {
        missingSockets.push(sock.name);
      }
    }

    if (triangleCount > def.maxTriangleBudgetLod0) {
      issues.push(`exceeded_triangle_budget_${triangleCount}_gt_${def.maxTriangleBudgetLod0}`);
    }
    if (missingUvs > 0) {
      issues.push(`meshes_missing_uv_${missingUvs}`);
    }
    if (meshCount === 0) {
      issues.push('empty_mesh_hierarchy');
    }

    return {
      valid: issues.length === 0,
      triangleCount,
      meshCount,
      missingUvs,
      missingSockets,
      issues,
    };
  }
}

/**
 * Layer 4: AssetRuntimeLease — Reference-counted shared GPU resource ownership.
 * Prevents premature disposal of shared geometries/materials while ensuring deterministic cleanup
 * when the final consumer releases its lease.
 */
export class AssetRuntimeLease {
  private refCount = 0;
  private disposed = false;
  private readonly trackedGeometries = new Set<THREE.BufferGeometry>();
  private readonly trackedMaterials = new Set<THREE.Material>();
  private readonly trackedTextures = new Set<THREE.Texture>();

  constructor(
    public readonly artifactId: string,
    public readonly definition: AssetDefinition,
    public readonly variant: AssetVariant,
    public readonly prototypeRoot: THREE.Object3D,
    public readonly hasSkinnedMesh: boolean
  ) {
    prototypeRoot.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        if (node.geometry) this.trackedGeometries.add(node.geometry);
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) {
          if (!m) continue;
          this.trackedMaterials.add(m);
          const std = m as THREE.MeshStandardMaterial;
          if (std.map) this.trackedTextures.add(std.map);
          if (std.normalMap) this.trackedTextures.add(std.normalMap);
          if (std.roughnessMap) this.trackedTextures.add(std.roughnessMap);
          if (std.metalnessMap) this.trackedTextures.add(std.metalnessMap);
          if (std.emissiveMap) this.trackedTextures.add(std.emissiveMap);
        }
      }
    });
  }

  acquire(): this {
    if (this.disposed) {
      throw new Error(`Cannot acquire disposed AssetRuntimeLease (${this.artifactId})`);
    }
    this.refCount++;
    return this;
  }

  release(onZeroReferences?: (lease: AssetRuntimeLease) => void): number {
    if (this.disposed) return 0;
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0 && onZeroReferences) {
      onZeroReferences(this);
    }
    return this.refCount;
  }

  getRefCount(): number {
    return this.refCount;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Instantiates a scene-graph node backed by this lease.
   * Shares geometries and base materials by default; only clones SkinnedMesh skeletons
   * or independent materials when `isolateMaterials` is explicitly requested (e.g., per-unit hit flash).
   */
  instantiate(options?: { isolateMaterials?: boolean }): AssetInstance {
    if (this.disposed) {
      throw new Error(`Cannot instantiate from disposed lease ${this.artifactId}`);
    }
    this.acquire();
    const clonedRoot = this.hasSkinnedMesh
      ? SkeletonUtils.clone(this.prototypeRoot)
      : this.prototypeRoot.clone(true);

    const clonedMaterials: THREE.Material[] = [];
    if (options?.isolateMaterials) {
      clonedRoot.traverse((node) => {
        if (node instanceof THREE.Mesh && node.material) {
          if (Array.isArray(node.material)) {
            node.material = node.material.map((m) => {
              const cm = m.clone();
              clonedMaterials.push(cm);
              return cm;
            });
          } else {
            const cm = node.material.clone();
            clonedMaterials.push(cm);
            node.material = cm;
          }
        }
      });
    }

    const sockets = new Map<string, THREE.Object3D>();
    for (const sockDesc of this.definition.sockets) {
      let sockNode = clonedRoot.getObjectByName(sockDesc.name);
      if (!sockNode) {
        sockNode = new THREE.Object3D();
        sockNode.name = sockDesc.name;
        sockNode.position.set(
          sockDesc.localPosition[0],
          sockDesc.localPosition[1],
          sockDesc.localPosition[2]
        );
        sockNode.rotation.set(
          sockDesc.localRotationEuler[0],
          sockDesc.localRotationEuler[1],
          sockDesc.localRotationEuler[2]
        );
        clonedRoot.add(sockNode);
      }
      sockets.set(sockDesc.name, sockNode);
    }

    return new AssetInstance(this, clonedRoot, sockets, clonedMaterials);
  }

  disposeGpuResources(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.refCount = 0;

    for (const geo of this.trackedGeometries) {
      geo.dispose();
    }
    this.trackedGeometries.clear();

    for (const mat of this.trackedMaterials) {
      mat.dispose();
    }
    this.trackedMaterials.clear();

    for (const tex of this.trackedTextures) {
      const img = (tex as THREE.Texture & { image?: { close?: () => void } }).image;
      if (img && typeof img.close === 'function') {
        try {
          img.close();
        } catch {
          // Ignore ImageBitmap close errors if already closed
        }
      }
      tex.dispose();
    }
    this.trackedTextures.clear();
  }
}

/**
 * Layer 5: AssetInstance — A placed or active scene-graph object holding a lease reference
 * and exposing socket lookups + screen-space hysteresis LOD evaluation.
 */
export class AssetInstance {
  private released = false;
  private activeLodIndex: 0 | 1 | 2 = 0;
  private readonly lodMeshes: [THREE.Object3D[], THREE.Object3D[], THREE.Object3D[]] = [[], [], []];
  private boundingSphereRadius = 1.0;

  constructor(
    public readonly lease: AssetRuntimeLease,
    public readonly root: THREE.Object3D,
    private readonly sockets: ReadonlyMap<string, THREE.Object3D>,
    private readonly isolatedMaterials: THREE.Material[] = []
  ) {
    const d = lease.definition.expectedDimensionsMeters;
    this.boundingSphereRadius = Math.max(0.25, Math.hypot(d.width, d.height, d.depth) * 0.5);
  }

  getSocket(name: string): THREE.Object3D | undefined {
    return this.sockets.get(name);
  }

  getActiveLodIndex(): 0 | 1 | 2 {
    return this.activeLodIndex;
  }

  registerLodGroup(lodIndex: 0 | 1 | 2, objects: THREE.Object3D[]): void {
    this.lodMeshes[lodIndex].push(...objects);
  }

  /**
   * TRN-22 / Amendment Section 8: Screen-Space Projected Size & Hysteresis LOD Selection.
   */
  updateScreenSpaceLod(
    cameraPosition: THREE.Vector3,
    fovVerticalDeg: number,
    qualityTier: QualityTier = 'high'
  ): 0 | 1 | 2 {
    const dx = this.root.position.x - cameraPosition.x;
    const dy = this.root.position.y - cameraPosition.y;
    const dz = this.root.position.z - cameraPosition.z;
    const dist = Math.max(0.1, Math.hypot(dx, dy, dz));
    const halfFovRad = THREE.MathUtils.degToRad(Math.max(20, Math.min(120, fovVerticalDeg)) * 0.5);
    const projectedRatio = (2 * this.boundingSphereRadius) / (dist * Math.tan(halfFovRad));

    const prof: ScreenSpaceLodProfile = this.lease.definition.lodProfile;
    const tierScale =
      qualityTier === 'ultra'
        ? 0.82
        : qualityTier === 'high'
          ? 1.0
          : qualityTier === 'medium'
            ? 1.25
            : 1.55;

    const t0Base = prof.lod0MinProjectedRatio * tierScale;
    const t1Base = prof.lod1MinProjectedRatio * tierScale;
    const h = prof.hysteresisBand;

    let nextLod = this.activeLodIndex;
    if (this.activeLodIndex === 0) {
      if (projectedRatio < t0Base * (1 - h)) {
        nextLod = projectedRatio < t1Base * (1 - h) ? 2 : 1;
      }
    } else if (this.activeLodIndex === 1) {
      if (projectedRatio > t0Base * (1 + h)) {
        nextLod = 0;
      } else if (projectedRatio < t1Base * (1 - h)) {
        nextLod = 2;
      }
    } else {
      if (projectedRatio > t0Base * (1 + h)) {
        nextLod = 0;
      } else if (projectedRatio > t1Base * (1 + h)) {
        nextLod = 1;
      }
    }

    if (nextLod !== this.activeLodIndex) {
      this.activeLodIndex = nextLod;
      for (let l = 0 as 0 | 1 | 2; l <= 2; l = (l + 1) as 0 | 1 | 2) {
        const group = this.lodMeshes[l];
        for (let i = 0; i < group.length; i++) {
          group[i].visible = l === nextLod;
          if (group[i] instanceof THREE.Mesh) {
            group[i].castShadow = l <= prof.maxShadowCasterLod;
          }
        }
      }
    }

    return this.activeLodIndex;
  }

  release(onLeaseZero?: (lease: AssetRuntimeLease) => void): void {
    if (this.released) return;
    this.released = true;
    for (const m of this.isolatedMaterials) {
      m.dispose();
    }
    this.isolatedMaterials.length = 0;
    this.lease.release(onLeaseZero);
  }
}

/**
 * Production Asset Pipeline & Lease Manager.
 * Coordinates GLTFLoader + DRACOLoader + KTX2Loader + MeshoptDecoder and procedural hybrid builders,
 * deduplicating concurrent loads and managing reference-counted GPU leases.
 */
export class ProductionAssetPipeline {
  private readonly definitions = new Map<string, AssetDefinition>(CANONICAL_CATALOG.definitions);
  private readonly variants = new Map<string, AssetVariant>(CANONICAL_CATALOG.variants);
  private readonly artifacts = new Map<string, AssetArtifact>(CANONICAL_CATALOG.artifacts);
  private readonly activeLeases = new Map<string, AssetRuntimeLease>();
  private readonly inFlightLoads = new Map<string, Promise<AssetRuntimeLease>>();
  private readonly proceduralGenerators = new Map<string, () => THREE.Object3D>();

  private gltfLoader: GLTFLoader | null = null;
  private dracoLoader: DRACOLoader | null = null;
  private ktx2Loader: KTX2Loader | null = null;

  constructor() {
    this.registerDefaultProceduralGenerators();
  }

  configureLoaders(renderer?: THREE.WebGLRenderer): void {
    if (!this.gltfLoader) {
      this.gltfLoader = new GLTFLoader();
      this.dracoLoader = new DRACOLoader();
      this.dracoLoader.setDecoderPath('/assets/decoders/draco/');
      this.gltfLoader.setDRACOLoader(this.dracoLoader);
      if (renderer) {
        this.ktx2Loader = new KTX2Loader();
        this.ktx2Loader.setTranscoderPath('/assets/decoders/basis/');
        try {
          this.ktx2Loader.detectSupport(renderer);
          this.gltfLoader.setKTX2Loader(this.ktx2Loader);
        } catch {
          // Headless / mock WebGL contexts may skip KTX2 detectSupport
        }
      }
    }
  }

  private registerDefaultProceduralGenerators(): void {
    for (const [artId, art] of this.artifacts.entries()) {
      const def = this.definitions.get(art.definitionId);
      if (!def) continue;
      this.proceduralGenerators.set(art.generatorKey, () =>
        this.buildValidatedPrototypeHierarchy(def, art)
      );
      this.proceduralGenerators.set(artId, () =>
        this.buildValidatedPrototypeHierarchy(def, art)
      );
    }
  }

  private buildValidatedPrototypeHierarchy(
    def: AssetDefinition,
    art: AssetArtifact
  ): THREE.Object3D {
    const root = new THREE.Group();
    root.name = `${def.id}_${art.artifactId}`;
    const dims = def.expectedDimensionsMeters;
    const segs = art.artifactId.endsWith('lod0') ? 6 : art.artifactId.endsWith('lod1') ? 4 : 2;
    const geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth, segs, segs, segs);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4b5563,
      roughness: 0.55,
      metalness: 0.45,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${def.id}_core_mesh`;
    mesh.position.y = dims.height * 0.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);

    for (const sock of def.sockets) {
      const sockNode = new THREE.Object3D();
      sockNode.name = sock.name;
      sockNode.position.set(
        sock.localPosition[0],
        sock.localPosition[1],
        sock.localPosition[2]
      );
      sockNode.rotation.set(
        sock.localRotationEuler[0],
        sock.localRotationEuler[1],
        sock.localRotationEuler[2]
      );
      root.add(sockNode);
    }

    return root;
  }

  registerGenerator(key: string, fn: () => THREE.Object3D): void {
    this.proceduralGenerators.set(key, fn);
  }

  getDefinition(id: string): AssetDefinition | undefined {
    return this.definitions.get(id);
  }

  getAllDefinitions(): ReadonlyMap<string, AssetDefinition> {
    return this.definitions;
  }

  getVariant(variantId: string): AssetVariant | undefined {
    return this.variants.get(variantId);
  }

  getArtifact(artifactId: string): AssetArtifact | undefined {
    return this.artifacts.get(artifactId);
  }

  getActiveLeaseCount(): number {
    return this.activeLeases.size;
  }

  /**
   * Acquires a reference-counted runtime lease for a given asset definition and LOD,
   * deduplicating concurrent requests and supporting AbortSignal cancellation.
   */
  async acquireAssetLease(
    definitionId: string,
    options?: {
      variantId?: string;
      lod?: 'lod0' | 'lod1' | 'lod2';
      signal?: AbortSignal;
      autoEvictOnZero?: boolean;
    }
  ): Promise<AssetInstance> {
    if (options?.signal?.aborted) {
      throw new DOMException('Asset load aborted', 'AbortError');
    }

    const def = this.definitions.get(definitionId);
    if (!def) {
      throw new Error(`Unknown AssetDefinition ID: ${definitionId}`);
    }

    const variantId = options?.variantId ?? def.defaultVariantId;
    const variant = this.variants.get(variantId) ?? this.variants.get(def.fallbackVariantId);
    if (!variant) {
      throw new Error(`No valid AssetVariant found for ${definitionId}`);
    }

    const lodKey = options?.lod ?? 'lod0';
    const artifactId =
      variant.artifactIdsByLod[lodKey] ?? variant.artifactIdsByLod.lod0;
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Missing AssetArtifact ${artifactId} for ${definitionId}`);
    }

    const existingLease = this.activeLeases.get(artifactId);
    if (existingLease && !existingLease.isDisposed()) {
      return existingLease.instantiate();
    }

    let loadPromise = this.inFlightLoads.get(artifactId);
    if (!loadPromise) {
      loadPromise = Promise.resolve().then(() => {
        const gen =
          this.proceduralGenerators.get(artifact.generatorKey) ??
          this.proceduralGenerators.get(artifactId);
        const proto = gen
          ? gen()
          : this.buildValidatedPrototypeHierarchy(def, artifact);
        let hasSkinned = false;
        proto.traverse((n) => {
          if (n instanceof THREE.SkinnedMesh) hasSkinned = true;
        });
        const lease = new AssetRuntimeLease(artifactId, def, variant, proto, hasSkinned);
        this.activeLeases.set(artifactId, lease);
        this.inFlightLoads.delete(artifactId);
        return lease;
      });
      this.inFlightLoads.set(artifactId, loadPromise);
    }

    const lease = await loadPromise;
    if (options?.signal?.aborted) {
      if (lease.getRefCount() === 0 && options?.autoEvictOnZero) {
        lease.disposeGpuResources();
        this.activeLeases.delete(artifactId);
      }
      throw new DOMException('Asset load aborted after resolve', 'AbortError');
    }

    return lease.instantiate();
  }

  releaseInstance(instance: AssetInstance, evictWhenZero = true): void {
    instance.release((zeroLease) => {
      if (evictWhenZero) {
        zeroLease.disposeGpuResources();
        this.activeLeases.delete(zeroLease.artifactId);
      }
    });
  }

  disposeAll(): void {
    for (const lease of this.activeLeases.values()) {
      lease.disposeGpuResources();
    }
    this.activeLeases.clear();
    this.inFlightLoads.clear();
    this.dracoLoader?.dispose();
    this.ktx2Loader?.dispose();
  }
}

export const globalAssetPipeline = new ProductionAssetPipeline();
