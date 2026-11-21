import { EnemyArchetype } from '@/src/schemas/enemy.schema';
import { MapId } from '@/src/schemas/common.schema';

export interface MissionVisualIdentityProfile {
  missionId: number;
  operationCode: string;
  operationTitle: string;
  mapId: MapId;
  timeOfDayLabel: string;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  sunLightColorHex: number;
  sunLightIntensity: number;
  skyZenithColorHex: number;
  skyHorizonColorHex: number;
  skyGroundBounceHex: number;
  fogColorHex: number;
  fogBaseDensity: number;
  fogHeightFalloff: number;
  exposureToneMapping: number;
  weatherKind: 'urban_ash_dawn' | 'desert_sand_wind' | 'nocturnal_searchlights' | 'jungle_monsoon_mist' | 'foundry_ember_storm';
  macroLandmarks: readonly string[];
  mesoArchitectureKit: readonly string[];
  microDetailKit: readonly string[];
  terrainSplatLayers: {
    baseLayer: string;
    slopeLayer: string;
    curvatureRidgeLayer: string;
    moistureLowlandLayer: string;
    baseLayerColor: number;
    slopeRockColor: number;
    moisturePathColor: number;
    debrisHighlightColor: number;
    roadStripColorHex: number;
    moistureReflectivity: number;
  };
  standardizedCameras: ReadonlyArray<{
    id: string;
    label: string;
    position: readonly [number, number, number];
    lookAt: readonly [number, number, number];
  }>;
}

export interface FactionVisualPalette {
  archetype: EnemyArchetype;
  factionLabel: string;
  silhouetteDistinction: string;
  primaryArmorColorHex: number;
  secondaryFabricColorHex: number;
  webbingRigColorHex: number;
  helmetColorHex: number;
  accentIdentificationColorHex: number;
  opticGlowColorHex: number;
  armorRoughness: number;
  armorMetalness: number;
}

export const VANGUARD_ARCHITECTURAL_STANDARDS = {
  /** Standard interior ground-floor clearance (meters) */
  groundStoryClearanceM: 4.0,
  /** Authoritative Stage 5A walkable watchtower upper deck elevation (+9.0m above baseY) */
  watchtowerDeckElevationM: 9.0,
  /** Authoritative Stage 5A watchtower switchback mid-landing elevation (+4.5m above baseY) */
  watchtowerMidLandingElevationM: 4.5,
  /** Standard crouch-cover rooftop and watchtower parapet wall height (meters) */
  tacticalParapetHeightM: 1.15,
  /** Structural floor slab fascia band thickness (meters) */
  floorSlabFasciaThicknessM: 0.36,
  /** Structural exterior pilaster column width/depth (meters) */
  pilasterColumnWidthM: 0.55,
  /** Foundation ground-contact apron height (meters) preventing floating geometry */
  groundFoundationApronHeightM: 0.32,
} as const;

export const HOSTILE_FACTION_PALETTES: Record<EnemyArchetype, FactionVisualPalette> = {
  infantry: {
    archetype: 'infantry',
    factionLabel: 'Garrison Rifleman',
    silhouetteDistinction: 'Ballistic PASGT helmet, modular plate carrier, triple mag pouches, standard carbine',
    primaryArmorColorHex: 0x3f4c3b,
    secondaryFabricColorHex: 0x4b5563,
    webbingRigColorHex: 0x2d372c,
    helmetColorHex: 0x364234,
    accentIdentificationColorHex: 0x9ca3af,
    opticGlowColorHex: 0xf59e0b,
    armorRoughness: 0.65,
    armorMetalness: 0.22,
  },
  elite_assault: {
    archetype: 'elite_assault',
    factionLabel: 'Shock Assault Breacher',
    silhouetteDistinction: 'Angled ballistic visor helmet, heavy pauldrons, crimson unit stripe, CQB breacher rig',
    primaryArmorColorHex: 0x272b33,
    secondaryFabricColorHex: 0x1e2229,
    webbingRigColorHex: 0x3b1d1d,
    helmetColorHex: 0x1f242d,
    accentIdentificationColorHex: 0xdc2626,
    opticGlowColorHex: 0xef4444,
    armorRoughness: 0.42,
    armorMetalness: 0.58,
  },
  heavy_armor: {
    archetype: 'heavy_armor',
    factionLabel: 'Juggernaut EOD Heavy',
    silhouetteDistinction: 'Oversized EOD blast collar, layered chest shield plate, thigh armor, belt-fed LMG',
    primaryArmorColorHex: 0x2d333b,
    secondaryFabricColorHex: 0x374151,
    webbingRigColorHex: 0x1f2937,
    helmetColorHex: 0x22272e,
    accentIdentificationColorHex: 0xf59e0b,
    opticGlowColorHex: 0xf97316,
    armorRoughness: 0.38,
    armorMetalness: 0.72,
  },
  sniper: {
    archetype: 'sniper',
    factionLabel: 'Overwatch Marksman',
    silhouetteDistinction: 'Asymmetric draped ghillie hood & shoulder cape, dual-tube NVG/rangefinder, long-barrel rifle',
    primaryArmorColorHex: 0x4a5535,
    secondaryFabricColorHex: 0x5c5338,
    webbingRigColorHex: 0x3d442b,
    helmetColorHex: 0x434d30,
    accentIdentificationColorHex: 0x84cc16,
    opticGlowColorHex: 0xef4444,
    armorRoughness: 0.88,
    armorMetalness: 0.08,
  },
  rocket_trooper: {
    archetype: 'rocket_trooper',
    factionLabel: 'Anti-Armor Specialist',
    silhouetteDistinction: 'High-profile dorsal tandem-warhead ammo pack, blast goggles, shoulder AT launcher',
    primaryArmorColorHex: 0x6b4c35,
    secondaryFabricColorHex: 0x523a28,
    webbingRigColorHex: 0x3e2c1e,
    helmetColorHex: 0x593e2b,
    accentIdentificationColorHex: 0xea580c,
    opticGlowColorHex: 0xfbbf24,
    armorRoughness: 0.62,
    armorMetalness: 0.3,
  },
  drone_operator: {
    archetype: 'drone_operator',
    factionLabel: 'Tactical Telemetry & UAV Controller',
    silhouetteDistinction: 'High-gain dorsal comms transceiver rack, dual whip antennas, illuminated wrist deck',
    primaryArmorColorHex: 0x1e3a4c,
    secondaryFabricColorHex: 0x283542,
    webbingRigColorHex: 0x162a38,
    helmetColorHex: 0x1b3242,
    accentIdentificationColorHex: 0x06b6d4,
    opticGlowColorHex: 0x22d3ee,
    armorRoughness: 0.48,
    armorMetalness: 0.45,
  },
  vehicle_crew: {
    archetype: 'vehicle_crew',
    factionLabel: 'Armored Cav Crewman',
    silhouetteDistinction: 'Ribbed tanker bump-helmet with acoustic comms cups, compact flak vest, PDW',
    primaryArmorColorHex: 0x3b4238,
    secondaryFabricColorHex: 0x2f362d,
    webbingRigColorHex: 0x252b23,
    helmetColorHex: 0x2b3029,
    accentIdentificationColorHex: 0x10b981,
    opticGlowColorHex: 0x34d399,
    armorRoughness: 0.56,
    armorMetalness: 0.35,
  },
};

export const MISSION_VISUAL_PROFILES: Record<number, MissionVisualIdentityProfile> = {
  1: {
    missionId: 1,
    operationCode: 'OP. IRON DAWN',
    operationTitle: 'Operation Iron Dawn — Shattered Boulevard',
    mapId: 'warzone_city',
    timeOfDayLabel: '06:15 LOCAL // DAWN BREACH',
    sunElevationDeg: 18,
    sunAzimuthDeg: 62,
    sunLightColorHex: 0xffd6a6,
    sunLightIntensity: 2.85,
    skyZenithColorHex: 0x2b425c,
    skyHorizonColorHex: 0xe8a87c,
    skyGroundBounceHex: 0x5b616b,
    fogColorHex: 0xa4b0c0,
    fogBaseDensity: 0.0025,
    fogHeightFalloff: 0.045,
    exposureToneMapping: 1.22,
    weatherKind: 'urban_ash_dawn',
    macroLandmarks: [
      'Collapsed Northern Highway Overpass Viaduct',
      'Twin Shattered Commercial High-Rise Shells',
      'Central Fortified Convoy Avenue & Skybridge',
    ],
    mesoArchitectureKit: [
      'Multi-story concrete & steel-mullion commercial facades',
      'Walkable +9.0m perimeter steel watchtowers with switchback stairs',
      'Multi-stop exterior hoist cargo lifts to +8.0m/+9.0m rooftops',
      'HESCO bastion barricades & sandbagged firing positions',
    ],
    microDetailKit: [
      'Cracked wet asphalt with pulverized concrete rubble shoulders',
      'Rooftop HVAC chillers, satellite dishes & parapet embrasures',
      'Foundation concrete aprons & drifting dawn ash particulates',
    ],
    terrainSplatLayers: {
      baseLayer: 'cracked_urban_asphalt',
      slopeLayer: 'shattered_concrete_rubble',
      curvatureRidgeLayer: 'weathered_curb_granite',
      moistureLowlandLayer: 'oil_stained_wet_tarmac',
      baseLayerColor: 0x4c525a,
      slopeRockColor: 0x676b70,
      moisturePathColor: 0x353b42,
      debrisHighlightColor: 0x7b7870,
      roadStripColorHex: 0x4b5158,
      moistureReflectivity: 0.35,
    },
    standardizedCameras: [
      { id: 'm1_spawn_vista', label: 'M1 Spawn Urban Vista', position: [0, 2.2, 68], lookAt: [0, 4.5, 0] },
      { id: 'm1_rooftop_overwatch', label: 'M1 Elevated Rooftop Overwatch', position: [-22, 10.5, 18], lookAt: [8, 2.0, -16] },
    ],
  },
  2: {
    missionId: 2,
    operationCode: 'OP. RED DUST',
    operationTitle: 'Operation Red Dust — Canyon Fuel & Radar Depot',
    mapId: 'desert_base',
    timeOfDayLabel: '13:30 LOCAL // HIGH DESERT SUN',
    sunElevationDeg: 54,
    sunAzimuthDeg: -38,
    sunLightColorHex: 0xfff0d4,
    sunLightIntensity: 2.65,
    skyZenithColorHex: 0x3b76ad,
    skyHorizonColorHex: 0xe6c294,
    skyGroundBounceHex: 0x9c7a54,
    fogColorHex: 0xd8b88c,
    fogBaseDensity: 0.0024,
    fogHeightFalloff: 0.038,
    exposureToneMapping: 1.18,
    weatherKind: 'desert_sand_wind',
    macroLandmarks: [
      'Terraced Red-Sandstone Canyon Mesa Ridges',
      'Pressurized Dual Spherical Fuel Tank Farm',
      'Elevated Refinery Pipeline Gantry & Watchtowers',
    ],
    mesoArchitectureKit: [
      'Corrugated desert-tan supply warehouses & hangars',
      'Reinforced concrete command bunkers with single-flight assault ramps',
      'Elevated overhead fuel pipelines & valve manifolds',
      'Walkable +9.0m desert observation watchtowers',
    ],
    microDetailKit: [
      'Stratified red sandstone, wind-rippled dune sand & tire-rutted hardpack',
      'Sun-bleached hazard stencils, fuel drums & camo-netting frames',
      'Windblown horizontal sand & heat-haze particulates',
    ],
    terrainSplatLayers: {
      baseLayer: 'wind_rippled_ochre_sand',
      slopeLayer: 'stratified_red_sandstone',
      curvatureRidgeLayer: 'sun_baked_caliche_crust',
      moistureLowlandLayer: 'compacted_depot_hardpack',
      baseLayerColor: 0xb68d5e,
      slopeRockColor: 0x8f593b,
      moisturePathColor: 0x7c654b,
      debrisHighlightColor: 0xc9a87c,
      roadStripColorHex: 0x8c7355,
      moistureReflectivity: 0.12,
    },
    standardizedCameras: [
      { id: 'm2_spawn_vista', label: 'M2 Canyon Depot Vista', position: [0, 2.5, 68], lookAt: [0, 4.0, -10] },
      { id: 'm2_watchtower_overwatch', label: 'M2 +9m Watchtower Overwatch', position: [-28, 10.6, 8], lookAt: [12, 2.0, -24] },
    ],
  },
  3: {
    missionId: 3,
    operationCode: 'OP. NIGHTFALL',
    operationTitle: 'Operation Nightfall — High-Altitude Nocturnal AA Complex',
    mapId: 'warzone_city',
    timeOfDayLabel: '01:40 LOCAL // NOCTURNAL RAID',
    sunElevationDeg: 28,
    sunAzimuthDeg: -120,
    sunLightColorHex: 0x9ec5ff,
    sunLightIntensity: 1.45,
    skyZenithColorHex: 0x091326,
    skyHorizonColorHex: 0x1e3554,
    skyGroundBounceHex: 0x1a2636,
    fogColorHex: 0x132238,
    fogBaseDensity: 0.0032,
    fogHeightFalloff: 0.052,
    exposureToneMapping: 1.08,
    weatherKind: 'nocturnal_searchlights',
    macroLandmarks: [
      'Sweeping Volumetric Anti-Aircraft Searchlight Cones',
      'Illuminated Geodesic Early-Warning Radar Domes',
      'Nocturnal Flak Citadel & Helipad Apron',
    ],
    mesoArchitectureKit: [
      'Hardened dark-slate flak towers & radar control buildings',
      'Sodium-amber floodlight gantries & perimeter security posts',
      'High-speed cargo lifts with illuminated cyan/amber guide strips',
    ],
    microDetailKit: [
      'Wet nocturnal tarmac with high-contrast specular reflections',
      'Emissive red obstacle strobes & runway guide beacons',
      'Cold lunar rim lighting against warm sodium-vapor pools',
    ],
    terrainSplatLayers: {
      baseLayer: 'wet_nocturnal_tarmac',
      slopeLayer: 'cold_slate_basalt',
      curvatureRidgeLayer: 'frost_rimmed_concrete',
      moistureLowlandLayer: 'specular_rain_puddle_asphalt',
      baseLayerColor: 0x2f3844,
      slopeRockColor: 0x454f5e,
      moisturePathColor: 0x1d2633,
      debrisHighlightColor: 0x5d6a7a,
      roadStripColorHex: 0x2c3540,
      moistureReflectivity: 0.72,
    },
    standardizedCameras: [
      { id: 'm3_spawn_vista', label: 'M3 Nocturnal AA Complex Vista', position: [0, 2.2, 68], lookAt: [0, 8.0, -15] },
      { id: 'm3_searchlight_roof', label: 'M3 AA Searchlight Rooftop', position: [20, 9.8, -12], lookAt: [-15, 3.0, -38] },
    ],
  },
  4: {
    missionId: 4,
    operationCode: 'OP. VIPER CANOPY',
    operationTitle: 'Operation Viper Canopy — Jungle River Gorge',
    mapId: 'jungle_zone',
    timeOfDayLabel: '17:45 LOCAL // MONSOON DUSK',
    sunElevationDeg: 24,
    sunAzimuthDeg: 48,
    sunLightColorHex: 0xffe4b5,
    sunLightIntensity: 2.15,
    skyZenithColorHex: 0x264e4a,
    skyHorizonColorHex: 0x7fa68e,
    skyGroundBounceHex: 0x2d4228,
    fogColorHex: 0x5c7d6b,
    fogBaseDensity: 0.0034,
    fogHeightFalloff: 0.06,
    exposureToneMapping: 1.14,
    weatherKind: 'jungle_monsoon_mist',
    macroLandmarks: [
      'Mist-Shrouded Karst Limestone River Cliffs',
      'Three Tactical Steel Truss River Bridges',
      'Multi-Tiered Jungle Canopy & Watchtower Outposts',
    ],
    mesoArchitectureKit: [
      'Moss-weathered concrete river pillboxes & supply sheds',
      'Timber-and-steel +9.0m observation towers overlooking river crossings',
      'Suspended steel truss bridges with reinforced guardrails',
    ],
    microDetailKit: [
      'Multi-species wind-driven instanced palms, ferns & broadleaf clusters',
      'Wet river mud with specular micro-relief & mossy rock outcrops',
      'Low-altitude drifting emerald river mist particulates',
    ],
    terrainSplatLayers: {
      baseLayer: 'humid_jungle_humus_moss',
      slopeLayer: 'karst_limestone_outcrop',
      curvatureRidgeLayer: 'exposed_laterite_root_bank',
      moistureLowlandLayer: 'wet_riverine_alluvial_mud',
      baseLayerColor: 0x3f5434,
      slopeRockColor: 0x616658,
      moisturePathColor: 0x2c3624,
      debrisHighlightColor: 0x6b7048,
      roadStripColorHex: 0x42382c,
      moistureReflectivity: 0.68,
    },
    standardizedCameras: [
      { id: 'm4_spawn_vista', label: 'M4 Jungle River Gorge Vista', position: [0, 2.2, 68], lookAt: [0, 3.0, 12] },
      { id: 'm4_bridge_overwatch', label: 'M4 River Bridge & Canopy Overwatch', position: [-26, 10.5, 24], lookAt: [0, 1.5, 16] },
    ],
  },
  5: {
    missionId: 5,
    operationCode: 'OP. ZERO HOUR',
    operationTitle: 'Operation Zero Hour — Heavy Smelting Foundry & Citadel',
    mapId: 'industrial_complex',
    timeOfDayLabel: '19:20 LOCAL // STORM DUSK FOUNDRY',
    sunElevationDeg: 14,
    sunAzimuthDeg: -75,
    sunLightColorHex: 0xff9e66,
    sunLightIntensity: 2.05,
    skyZenithColorHex: 0x1c1924,
    skyHorizonColorHex: 0x7c3a2b,
    skyGroundBounceHex: 0x4a2518,
    fogColorHex: 0x3b2824,
    fogBaseDensity: 0.003,
    fogHeightFalloff: 0.048,
    exposureToneMapping: 1.15,
    weatherKind: 'foundry_ember_storm',
    macroLandmarks: [
      'Twin Monolithic Blast Furnaces & Smokestacks',
      'Overhead Heavy Industrial Gantry Cranes',
      'Central Armored Command Citadel & Elevated Skybridges',
    ],
    mesoArchitectureKit: [
      'Heavy riveted steel foundry halls with molten under-lighting',
      'Hazard-striped multi-tier steel catwalks & skybridges',
      'Dual high-speed industrial hoist cargo lifts & +9.0m watchtowers',
    ],
    microDetailKit: [
      'Scorched diamond-plate steel, coal slag gravel & glowing ember seams',
      'Venting pressurized steam plumes & rising furnace ember sparks',
      'Rotating amber industrial hazard beacons & pipe manifolds',
    ],
    terrainSplatLayers: {
      baseLayer: 'scorched_foundry_concrete',
      slopeLayer: 'crushed_iron_slag_gravel',
      curvatureRidgeLayer: 'oxidized_steel_deck_plate',
      moistureLowlandLayer: 'molten_ash_soot_basin',
      baseLayerColor: 0x3c3b40,
      slopeRockColor: 0x57453e,
      moisturePathColor: 0x262428,
      debrisHighlightColor: 0x7a4a36,
      roadStripColorHex: 0x383a40,
      moistureReflectivity: 0.44,
    },
    standardizedCameras: [
      { id: 'm5_spawn_vista', label: 'M5 Foundry Siege Vista', position: [0, 2.2, 68], lookAt: [0, 6.0, -20] },
      { id: 'm5_citadel_overwatch', label: 'M5 Elevated Catwalk & Furnace Overwatch', position: [22, 10.6, -8], lookAt: [-12, 4.0, -42] },
    ],
  },
};

export function getMissionVisualProfile(missionId: number): MissionVisualIdentityProfile {
  return MISSION_VISUAL_PROFILES[missionId] ?? MISSION_VISUAL_PROFILES[1];
}
