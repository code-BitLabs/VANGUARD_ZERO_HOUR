import { z } from 'zod';
import { FireModeSchema, WeaponIdSchema } from './weapon.schema';

export const KillFeedItemSchema = z.object({
  id: z.string(),
  killer: z.string(),
  victim: z.string(),
  weaponName: z.string(),
  isHeadshot: z.boolean(),
  timestamp: z.number(),
});
export type KillFeedItem = z.infer<typeof KillFeedItemSchema>;

export const HitKindSchema = z.enum(['flesh', 'armor_deflect', 'armor_break', 'headshot', 'kill']);
export type HitKind = z.infer<typeof HitKindSchema>;

export const HitFeedbackSchema = z.object({
  id: z.number().int().nonnegative(),
  isHeadshot: z.boolean(),
  isKill: z.boolean(),
  damage: z.number().nonnegative(),
  hitKind: HitKindSchema.optional(),
});
export type HitFeedback = z.infer<typeof HitFeedbackSchema>;

export const ObjectiveStatusSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  type: z
    .enum([
      'eliminate_wave',
      'destroy_targets',
      'convoy_intercept',
      'air_defense',
      'plant_charge',
      'vehicle_extract',
    ])
    .optional(),
  current: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  completed: z.boolean(),
  bypassed: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  stageIndex: z.number().int().min(1).optional(),
  stageTitle: z.string().optional(),
  status: z
    .enum(['locked', 'available', 'active', 'completed', 'bypassed', 'failed', 'blocked'])
    .optional(),
  prerequisiteIds: z.array(z.string()).optional(),
  blockedReason: z.string().nullable().optional(),
  demolitionPolicy: z
    .enum(['any_destruction', 'charge_or_c4_only', 'any_damage'])
    .optional(),
  screenX: z.number().optional(),
  screenY: z.number().optional(),
  onScreen: z.boolean().optional(),
  markerPos: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    })
    .optional(),
  elevationDeltaM: z.number().optional(),
});
export type ObjectiveStatus = z.infer<typeof ObjectiveStatusSchema>;

export const ActiveTacticalHintSchema = z.object({
  id: z.string(),
  tier: z.number().int().optional(),
  priority: z.enum(['critical', 'tactical', 'onboarding']),
  text: z.string(),
  actionKey: z.string().optional(),
  dismissible: z.boolean().default(true),
});
export type ActiveTacticalHint = z.infer<typeof ActiveTacticalHintSchema>;

export const IncomingThreatWarningSchema = z.object({
  kind: z.enum(['sniper', 'rocket', 'grenade']),
  label: z.string(),
  progress: z.number().min(0).max(1),
  angleRad: z.number(),
});
export type IncomingThreatWarning = z.infer<typeof IncomingThreatWarningSchema>;

export const MiniMapBlipSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number().optional(),
  z: z.number(),
  kind: z.enum(['enemy', 'air', 'vehicle', 'objective', 'friendly_vehicle']),
  elevationDeltaM: z.number().optional(),
  elevationCode: z.enum(['same', 'above', 'below']).optional(),
  detectionSource: z
    .enum(['los', 'acoustic', 'recon', 'stale', 'objective', 'friendly'])
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  ageSec: z.number().nonnegative().optional(),
});
export type MiniMapBlip = z.infer<typeof MiniMapBlipSchema>;

export const DamageArcSchema = z.object({
  id: z.number().int().nonnegative(),
  angleRad: z.number(),
  intensity: z.number().min(0).max(1),
});
export type DamageArc = z.infer<typeof DamageArcSchema>;

export const LockOnStateSchema = z.object({
  status: z.enum(['none', 'scanning', 'acquiring', 'locked']),
  progress: z.number().min(0).max(1),
  targetLabel: z.string(),
});
export type LockOnState = z.infer<typeof LockOnStateSchema>;

export const TacticalOrdnanceHudSchema = z.object({
  c4Inventory: z.number().int().nonnegative(),
  c4Deployed: z.number().int().nonnegative(),
  c4MaxDeployed: z.number().int().positive(),
  c4PlacementValid: z.boolean(),
  selectedBombId: z.string(),
  selectedBombShort: z.string(),
  selectedBombCost: z.number().int().nonnegative(),
  bombCooldownSec: z.number().nonnegative(),
  bombMaxCooldownSec: z.number().nonnegative(),
  nukeCost: z.number().int().nonnegative(),
  nukeUsed: z.boolean(),
  nukePendingConfirmSec: z.number().nonnegative(),
  nukeCountdownSec: z.number().nonnegative(),
  inFalloutZone: z.boolean(),
  falloutRemainingSec: z.number().nonnegative(),
  requisitionPoints: z.number().int().nonnegative(),
  sandboxAuthorized: z.boolean(),
});
export type TacticalOrdnanceHud = z.infer<typeof TacticalOrdnanceHudSchema>;

export const VehicleCameraModeSchema = z.enum(['chase', 'driver_fpv', 'turret', 'orbit']);
export type VehicleCameraMode = z.infer<typeof VehicleCameraModeSchema>;

export const VehicleDriveGearSchema = z.enum(['FORWARD', 'BRAKING', 'NEUTRAL_HOLD', 'REVERSE']);
export type VehicleDriveGear = z.infer<typeof VehicleDriveGearSchema>;

export const CargoLiftHudSnapshotSchema = z.object({
  liftId: z.string(),
  liftName: z.string(),
  state: z.enum([
    'idle',
    'requested',
    'boarding',
    'doors_closing',
    'traveling',
    'docking',
    'doors_opening',
    'unloading',
  ]),
  travelDirection: z.enum(['up', 'down', 'none']),
  currentFloorIndex: z.number().int().nonnegative(),
  targetFloorIndex: z.number().int().nonnegative(),
  currentFloorLabel: z.string(),
  targetFloorLabel: z.string(),
  currentElevationY: z.number(),
  playerInside: z.boolean(),
  occupantCount: z.number().int().nonnegative(),
  maxOccupants: z.number().int().positive(),
});
export type CargoLiftHudSnapshotEvent = z.infer<typeof CargoLiftHudSnapshotSchema>;

export const HudSnapshotSchema = z.object({
  health: z.number().min(0).max(250),
  maxHealth: z.number().positive().max(250),
  armor: z.number().min(0).max(250),
  maxArmor: z.number().positive().max(250),
  spawnProtectionSec: z.number().nonnegative().default(0),
  isRegenerating: z.boolean().default(false),
  weaponId: WeaponIdSchema,
  weaponName: z.string(),
  fireMode: FireModeSchema,
  ammoInMag: z.number().int().nonnegative(),
  magSize: z.number().int().positive(),
  reserveAmmo: z.number().int().nonnegative(),
  grenades: z.number().int().nonnegative(),
  rpgAvailable: z.boolean().default(true),
  rpgAmmoInMag: z.number().int().nonnegative().default(1),
  rpgReserveAmmo: z.number().int().nonnegative().default(6),
  rpgEquipped: z.boolean().default(false),
  isReloading: z.boolean(),
  reloadProgress: z.number().min(0).max(1),
  isAds: z.boolean(),
  isScoped: z.boolean(),
  isSprinting: z.boolean(),
  isCrouching: z.boolean(),
  isSliding: z.boolean(),
  canVault: z.boolean().default(false),
  isVaulting: z.boolean().default(false),
  crosshairSpread: z.number().nonnegative(),
  playerX: z.number(),
  playerZ: z.number(),
  playerYaw: z.number(),
  inVehicle: z.boolean(),
  vehicleName: z.string(),
  vehicleHealth: z.number().min(0).max(100),
  vehicleMaxHealth: z.number().positive(),
  vehicleTurretAmmo: z.number().int().min(0).default(0),
  vehicleMaxTurretAmmo: z.number().int().min(0).default(0),
  vehicleSpeedKmh: z.number().nonnegative(),
  vehicleGear: VehicleDriveGearSchema.default('NEUTRAL_HOLD'),
  vehicleSteerDeg: z.number().default(0),
  vehicleHandbrake: z.boolean().default(false),
  vehicleCameraMode: VehicleCameraModeSchema.default('chase'),
  interactPrompt: z.string().nullable(),
  activeActionDirective: z.string().nullable().default(null),
  activeStageIndex: z.number().int().min(1).default(1),
  totalStages: z.number().int().min(1).default(1),
  activeStageTitle: z.string().default('STAGE 1 — PRIMARY OPERATION'),
  extractionStatus: z
    .enum(['not_applicable', 'locked', 'available', 'extracting', 'completed'])
    .default('not_applicable'),
  extractionBlockReason: z.string().nullable().default(null),
  activeTacticalHint: ActiveTacticalHintSchema.nullable().default(null),
  waveStatusText: z.string().nullable().default(null),
  subtitleText: z.string().nullable(),
  missionAlert: z.string().nullable(),
  incomingThreatWarning: IncomingThreatWarningSchema.nullable().default(null),
  elapsedSec: z.number().nonnegative(),
  score: z.number().int().nonnegative(),
  kills: z.number().int().nonnegative(),
  headshots: z.number().int().nonnegative(),
  shotsFired: z.number().int().nonnegative(),
  shotsHit: z.number().int().nonnegative(),
  lockOn: LockOnStateSchema,
  objectives: z.array(ObjectiveStatusSchema),
  blips: z.array(MiniMapBlipSchema),
  activeBossLabel: z.string().nullable(),
  activeBossHealthPct: z.number().min(0).max(1),
  activeBossPhaseLabel: z.string().nullable().optional(),
  activeBossVulnerable: z.boolean().optional(),
  encounterPhase: z.string().optional(),
  optionalObjectivesCompleted: z.number().int().nonnegative().optional(),
  activeModifiers: z.array(z.string()).optional(),
  ordnance: TacticalOrdnanceHudSchema.optional(),
  liftStatus: CargoLiftHudSnapshotSchema.nullable().optional(),
  squad: z
    .object({
      activeOrderLabel: z.string(),
      activeFormation: z.enum(['WEDGE', 'COLUMN', 'LINE', 'COMPACT', 'OVERWATCH']),
      squadMedCharges: z.number().int().nonnegative(),
      downedCount: z.number().int().nonnegative(),
      nearestDownedOperatorId: z.string().nullable(),
      nearestDownedDistanceM: z.number(),
      playerRevivingOperatorId: z.string().nullable(),
      playerReviveProgress: z.number().min(0).max(1),
      operators: z.array(
        z.object({
          id: z.string(),
          callsign: z.string(),
          role: z.enum(['assault', 'support', 'recon', 'anti_armor', 'medic']),
          roleBadge: z.string(),
          health: z.number().nonnegative(),
          maxHealth: z.number().positive(),
          armor: z.number().nonnegative(),
          maxArmor: z.number().positive(),
          state: z.string(),
          morale: z.enum(['STEADY', 'SUPPRESSED', 'SHAKEN']),
          suppressionLevel: z.number().min(0).max(1),
          reasonTag: z.string(),
          bleedoutRemainingSec: z.number().nonnegative(),
          reviveProgress: z.number().min(0).max(1),
          reviveChargesRemaining: z.number().int().nonnegative(),
          inVehicleId: z.string().nullable(),
          isReserve: z.boolean(),
          distanceToPlayerM: z.number().nonnegative(),
        })
      ),
    })
    .optional(),
  carriedWeaponIds: z.array(WeaponIdSchema).readonly().optional(),
  nearSupplySwapStation: z.boolean().optional(),
  deploymentMode: z.enum(['solo', 'fireteam']).optional(),
  soloTraumaKit: z
    .object({
      chargesRemaining: z.number().int().nonnegative(),
      maxCharges: z.number().int().nonnegative(),
      cooldownRemainingSec: z.number().nonnegative(),
      pressureState: z.enum(['CALM', 'ENGAGED', 'HIGH_PRESSURE', 'RELIEF_WINDOW']).optional(),
    })
    .optional(),
  activeRadioSubtitle: z
    .object({
      id: z.number().int().positive(),
      callsign: z.string(),
      roleBadge: z.string(),
      text: z.string(),
      priority: z.enum(['CRITICAL', 'TACTICAL', 'BANTER']),
    })
    .nullable()
    .optional(),
  suppressionLevel: z.number().min(0).max(1).optional(),
  squadOrderPing: z
    .object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
      screenX: z.number(),
      screenY: z.number(),
      onScreen: z.boolean(),
      label: z.string(),
      distanceM: z.number().nonnegative(),
    })
    .nullable()
    .optional(),
});
export type HudSnapshot = z.infer<typeof HudSnapshotSchema>;
