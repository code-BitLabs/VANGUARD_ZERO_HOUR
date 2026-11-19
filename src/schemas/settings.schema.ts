import { z } from 'zod';
import { ColorblindModeSchema, QualityTierSchema } from './common.schema';

export const ControlBindingsSchema = z.object({
  forward: z.string().min(1).default('KeyW'),
  backward: z.string().min(1).default('KeyS'),
  left: z.string().min(1).default('KeyA'),
  right: z.string().min(1).default('KeyD'),
  sprint: z.string().min(1).default('ShiftLeft'),
  jump: z.string().min(1).default('Space'),
  crouch: z.string().min(1).default('ControlLeft'),
  reload: z.string().min(1).default('KeyR'),
  interact: z.string().min(1).default('KeyE'),
  grenade: z.string().min(1).default('KeyG'),
  fireMode: z.string().min(1).default('KeyB'),
  c4: z.string().min(1).default('KeyC'),
  bombStrike: z.string().min(1).default('KeyV'),
  strategicNuke: z.string().min(1).default('KeyN'),
  vehicleCamera: z.string().min(1).default('KeyF'),
  handbrake: z.string().min(1).default('Space'),
  tacticalOverview: z.string().min(1).default('Tab'),
});
export type ControlBindings = z.infer<typeof ControlBindingsSchema>;

export const QualityModeSchema = z.enum(['auto', 'manual']);
export type QualityMode = z.infer<typeof QualityModeSchema>;

export const SubQualityLevelSchema = z.enum(['low', 'medium', 'high']);
export type SubQualityLevel = z.infer<typeof SubQualityLevelSchema>;

export const DrawDistanceSettingSchema = z.enum(['auto', 'short', 'medium', 'long', 'ultra']);
export type DrawDistanceSetting = z.infer<typeof DrawDistanceSettingSchema>;

export const FpsCapSchema = z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(120)]);
export type FpsCapSetting = z.infer<typeof FpsCapSchema>;

export const RendererBackendPreferenceSchema = z.enum(['auto', 'webgpu', 'webgl2']);
export type RendererBackendPreference = z.infer<typeof RendererBackendPreferenceSchema>;

export const TargetRefreshRateSchema = z.union([z.literal(60), z.literal(90), z.literal(120)]);
export type TargetRefreshRateSetting = z.infer<typeof TargetRefreshRateSchema>;

export const GraphicsSettingsSchema = z.object({
  qualityMode: QualityModeSchema.default('auto'),
  autoDetectedPresetApplied: z.boolean().default(false),
  quality: QualityTierSchema.default('high'),
  fov: z.number().min(65).max(110).default(78),
  adaptiveGovernor: z.boolean().default(true),
  shadowsEnabled: z.boolean().default(true),
  bloomEnabled: z.boolean().default(true),
  renderScale: z.number().min(0.5).max(1.0).default(1.0),
  textureQuality: SubQualityLevelSchema.default('high'),
  antialiasing: z.boolean().default(true),
  effectsQuality: SubQualityLevelSchema.default('high'),
  drawDistance: DrawDistanceSettingSchema.default('auto'),
  fpsCap: FpsCapSchema.default(0),
  headBobIntensity: z.number().min(0).max(1.5).default(0.8),
  rendererBackend: RendererBackendPreferenceSchema.default('auto'),
  targetRefreshRate: TargetRefreshRateSchema.default(60),
});
export type GraphicsSettings = z.infer<typeof GraphicsSettingsSchema>;

export const MusicRepeatModeSchema = z.enum(['all', 'one', 'off']);
export type MusicRepeatModeSetting = z.infer<typeof MusicRepeatModeSchema>;

export const AudioSettingsSchema = z.object({
  masterVolume: z.number().min(0).max(1).default(0.8),
  musicVolume: z.number().min(0).max(1).default(0.24),
  sfxVolume: z.number().min(0).max(1).default(0.85),
  dialogueVolume: z.number().min(0).max(1).default(0.9),
  ambienceVolume: z.number().min(0).max(1).default(0.55),
  muted: z.boolean().default(false),
  musicEnabled: z.boolean().default(true),
  musicTrackId: z.string().default('zero_hour_overture'),
  musicShuffle: z.boolean().default(false),
  musicRepeatMode: MusicRepeatModeSchema.default('all'),
});
export type AudioSettings = z.infer<typeof AudioSettingsSchema>;

export const TouchModeSchema = z.enum(['auto', 'always_on', 'always_off']);
export type TouchMode = z.infer<typeof TouchModeSchema>;

export const TouchControlProfileSchema = z.enum(['two_finger', 'three_finger', 'custom']);
export type TouchControlProfile = z.infer<typeof TouchControlProfileSchema>;

export const TouchFireBehaviorSchema = z.enum(['dedicated', 'ads_on_fire']);
export type TouchFireBehavior = z.infer<typeof TouchFireBehaviorSchema>;

export const TouchAdsModeSchema = z.enum(['toggle', 'hold']);
export type TouchAdsMode = z.infer<typeof TouchAdsModeSchema>;

export const VehicleSteeringModeSchema = z.enum(['buttons', 'wheel']);
export type VehicleSteeringMode = z.infer<typeof VehicleSteeringModeSchema>;

export const NormalizedTouchPositionSchema = z.object({
  x: z.number().min(0.04).max(0.96),
  y: z.number().min(0.08).max(0.94),
});
export type NormalizedTouchPosition = z.infer<typeof NormalizedTouchPositionSchema>;

export const TouchControlIdSchema = z.enum([
  'move_joystick',
  'fire_left',
  'fire_right',
  'ads',
  'reload',
  'crouch',
  'jump',
  'weapon_bar',
]);
export type TouchControlId = z.infer<typeof TouchControlIdSchema>;

export const VehicleTouchControlIdSchema = z.enum([
  'veh_steer_left',
  'veh_steer_right',
  'veh_gas',
  'veh_brake_reverse',
  'veh_handbrake',
  'veh_fire',
  'veh_camera',
  'veh_exit',
]);
export type VehicleTouchControlId = z.infer<typeof VehicleTouchControlIdSchema>;

export const TouchControlNodeConfigSchema = z.object({
  x: z.number().min(0.04).max(0.96),
  y: z.number().min(0.08).max(0.94),
  scale: z.number().min(0.75).max(1.45).default(1.0),
});
export type TouchControlNodeConfig = z.infer<typeof TouchControlNodeConfigSchema>;

export const DEFAULT_TWO_FINGER_FIRE_POS: NormalizedTouchPosition = { x: 0.85, y: 0.68 };
export const DEFAULT_THREE_FINGER_FIRE_POS: NormalizedTouchPosition = { x: 0.1, y: 0.24 };
export const DEFAULT_TWO_FINGER_ADS_POS: NormalizedTouchPosition = { x: 0.73, y: 0.54 };
export const DEFAULT_THREE_FINGER_ADS_POS: NormalizedTouchPosition = { x: 0.84, y: 0.64 };

export const TouchControlLayoutMapSchema = z.object({
  move_joystick: TouchControlNodeConfigSchema.default({ x: 0.13, y: 0.72, scale: 1.0 }),
  fire_left: TouchControlNodeConfigSchema.default({ x: 0.1, y: 0.24, scale: 1.0 }),
  fire_right: TouchControlNodeConfigSchema.default({ x: 0.85, y: 0.68, scale: 1.0 }),
  ads: TouchControlNodeConfigSchema.default({ x: 0.73, y: 0.54, scale: 1.0 }),
  reload: TouchControlNodeConfigSchema.default({ x: 0.73, y: 0.84, scale: 1.0 }),
  crouch: TouchControlNodeConfigSchema.default({ x: 0.86, y: 0.87, scale: 1.0 }),
  jump: TouchControlNodeConfigSchema.default({ x: 0.94, y: 0.52, scale: 1.0 }),
  weapon_bar: TouchControlNodeConfigSchema.default({ x: 0.48, y: 0.88, scale: 1.0 }),
});
export type TouchControlLayoutMap = z.infer<typeof TouchControlLayoutMapSchema>;

export const VehicleTouchControlLayoutMapSchema = z.object({
  veh_steer_left: TouchControlNodeConfigSchema.default({ x: 0.1, y: 0.74, scale: 1.0 }),
  veh_steer_right: TouchControlNodeConfigSchema.default({ x: 0.23, y: 0.74, scale: 1.0 }),
  veh_gas: TouchControlNodeConfigSchema.default({ x: 0.89, y: 0.67, scale: 1.05 }),
  veh_brake_reverse: TouchControlNodeConfigSchema.default({ x: 0.76, y: 0.76, scale: 1.0 }),
  veh_handbrake: TouchControlNodeConfigSchema.default({ x: 0.66, y: 0.83, scale: 0.95 }),
  veh_fire: TouchControlNodeConfigSchema.default({ x: 0.79, y: 0.46, scale: 1.0 }),
  veh_camera: TouchControlNodeConfigSchema.default({ x: 0.79, y: 0.22, scale: 0.95 }),
  veh_exit: TouchControlNodeConfigSchema.default({ x: 0.9, y: 0.22, scale: 1.0 }),
});
export type VehicleTouchControlLayoutMap = z.infer<typeof VehicleTouchControlLayoutMapSchema>;

export const DEFAULT_TWO_FINGER_CONTROL_MAP: TouchControlLayoutMap = TouchControlLayoutMapSchema.parse({});

export const DEFAULT_THREE_FINGER_CONTROL_MAP: TouchControlLayoutMap = {
  move_joystick: { x: 0.13, y: 0.75, scale: 1.0 },
  fire_left: { x: 0.1, y: 0.24, scale: 1.05 },
  fire_right: { x: 0.85, y: 0.68, scale: 1.0 },
  ads: { x: 0.84, y: 0.64, scale: 1.05 },
  reload: { x: 0.73, y: 0.83, scale: 1.0 },
  crouch: { x: 0.85, y: 0.86, scale: 1.0 },
  jump: { x: 0.94, y: 0.52, scale: 1.0 },
  weapon_bar: { x: 0.48, y: 0.88, scale: 1.0 },
};

export const DEFAULT_VEHICLE_CONTROL_MAP: VehicleTouchControlLayoutMap =
  VehicleTouchControlLayoutMapSchema.parse({});

export const LEFT_HANDED_VEHICLE_CONTROL_MAP: VehicleTouchControlLayoutMap = {
  veh_gas: { x: 0.11, y: 0.67, scale: 1.05 },
  veh_brake_reverse: { x: 0.24, y: 0.76, scale: 1.0 },
  veh_handbrake: { x: 0.34, y: 0.83, scale: 0.95 },
  veh_fire: { x: 0.21, y: 0.46, scale: 1.0 },
  veh_steer_left: { x: 0.77, y: 0.74, scale: 1.0 },
  veh_steer_right: { x: 0.9, y: 0.74, scale: 1.0 },
  veh_camera: { x: 0.79, y: 0.22, scale: 0.95 },
  veh_exit: { x: 0.9, y: 0.22, scale: 1.0 },
};

export function cloneControlLayoutMap(map: TouchControlLayoutMap): TouchControlLayoutMap {
  return {
    move_joystick: { ...map.move_joystick },
    fire_left: { ...map.fire_left },
    fire_right: { ...map.fire_right },
    ads: { ...map.ads },
    reload: { ...map.reload },
    crouch: { ...map.crouch },
    jump: { ...map.jump },
    weapon_bar: { ...map.weapon_bar },
  };
}

export function cloneVehicleControlLayoutMap(
  map: VehicleTouchControlLayoutMap
): VehicleTouchControlLayoutMap {
  return {
    veh_steer_left: { ...map.veh_steer_left },
    veh_steer_right: { ...map.veh_steer_right },
    veh_gas: { ...map.veh_gas },
    veh_brake_reverse: { ...map.veh_brake_reverse },
    veh_handbrake: { ...map.veh_handbrake },
    veh_fire: { ...map.veh_fire },
    veh_camera: { ...map.veh_camera },
    veh_exit: { ...map.veh_exit },
  };
}

export const InputSettingsSchema = z.object({
  mouseSensitivity: z.number().min(0.1).max(4.0).default(1.0),
  adsSensitivity: z.number().min(0.1).max(2.0).default(0.6),
  invertY: z.boolean().default(false),
  gamepadEnabled: z.boolean().default(true),
  touchMode: TouchModeSchema.default('auto'),
  touchControlProfile: TouchControlProfileSchema.default('two_finger'),
  leftFireEnabled: z.boolean().default(false),
  rightFireEnabled: z.boolean().default(true),
  touchSensitivity: z.number().min(0.3).max(3.0).default(1.15),
  touchLookSmoothing: z.number().min(0).max(0.6).default(0),
  mobileAimAssist: z.boolean().default(true),
  mobileAimAssistStrength: z.number().min(0.1).max(0.75).default(0.35),
  touchJoystickScale: z.number().min(0.75).max(1.35).default(1.0),
  touchDeadzone: z.number().min(0.05).max(0.28).default(0.1),
  touchButtonScale: z.number().min(0.75).max(1.35).default(1.0),
  touchFireButtonScale: z.number().min(0.75).max(1.45).default(1.0),
  touchButtonOpacity: z.number().min(0.35).max(0.95).default(0.72),
  touchVehicleSteeringMode: VehicleSteeringModeSchema.default('buttons'),
  touchVehicleLeftHanded: z.boolean().default(false),
  touchVehicleButtonScale: z.number().min(0.75).max(1.45).default(1.0),
  touchVehicleButtonOpacity: z.number().min(0.35).max(0.95).default(0.78),
  touchVehicleLayout: VehicleTouchControlLayoutMapSchema.default(() =>
    cloneVehicleControlLayoutMap(DEFAULT_VEHICLE_CONTROL_MAP)
  ),
  autoSprint: z.boolean().default(true),
  touchAutoSprintThreshold: z.number().min(0.65).max(0.95).default(0.82),
  touchManualSprintButton: z.boolean().default(false),
  touchAdsMode: TouchAdsModeSchema.default('toggle'),
  touchFireBehavior: TouchFireBehaviorSchema.default('dedicated'),
  touchFirePosTwoFinger: NormalizedTouchPositionSchema.default(() => ({ ...DEFAULT_TWO_FINGER_FIRE_POS })),
  touchFirePosThreeFinger: NormalizedTouchPositionSchema.default(() => ({ ...DEFAULT_THREE_FINGER_FIRE_POS })),
  touchAdsPosTwoFinger: NormalizedTouchPositionSchema.default(() => ({ ...DEFAULT_TWO_FINGER_ADS_POS })),
  touchAdsPosThreeFinger: NormalizedTouchPositionSchema.default(() => ({ ...DEFAULT_THREE_FINGER_ADS_POS })),
  touchCustomLayout: TouchControlLayoutMapSchema.default(() =>
    cloneControlLayoutMap(DEFAULT_TWO_FINGER_CONTROL_MAP)
  ),
  touchFireOffsetX: z.number().min(-60).max(60).default(0),
  touchFireOffsetY: z.number().min(-60).max(60).default(0),
  touchAdsOffsetX: z.number().min(-60).max(60).default(0),
  touchAdsOffsetY: z.number().min(-60).max(60).default(0),
  bindings: ControlBindingsSchema.default(() => ControlBindingsSchema.parse({})),
});
export type InputSettings = z.infer<typeof InputSettingsSchema>;

export const HudModeSchema = z.enum(['adaptive', 'minimal', 'expanded']);
export type HudModeSetting = z.infer<typeof HudModeSchema>;

export const AccessibilitySettingsSchema = z.object({
  colorblindMode: ColorblindModeSchema.default('standard'),
  subtitles: z.boolean().default(true),
  tacticalHints: z.boolean().default(true),
  reducedMotion: z.boolean().default(false),
  uiScale: z.number().min(0.85).max(1.25).default(1.0),
  hudMode: HudModeSchema.default('adaptive'),
  hudOpacity: z.number().min(0.5).max(1.0).default(0.92),
  showRadar: z.boolean().default(true),
  showCompass: z.boolean().default(true),
});
export type AccessibilitySettings = z.infer<typeof AccessibilitySettingsSchema>;

export const DeveloperSettingsSchema = z.object({
  devModeEnabled: z.boolean().default(true),
  combatDebugOverlay: z.boolean().default(false),
  combatDebugCollapsed: z.boolean().default(false),
  debugShow3DGizmos: z.boolean().default(true),
  debugShowFlightPaths: z.boolean().default(true),
  debugShowPhysicsColliders: z.boolean().default(false),
  debugOverlayOpacity: z.number().min(0.4).max(0.98).default(0.9),
  debugDockSide: z.enum(['left', 'right']).default('left'),
  sandboxOrdnanceAuthorized: z.boolean().default(false),
});
export type DeveloperSettings = z.infer<typeof DeveloperSettingsSchema>;

export const SettingsBundleSchema = z.object({
  version: z.literal(1).default(1),
  graphics: GraphicsSettingsSchema.default(() => GraphicsSettingsSchema.parse({})),
  audio: AudioSettingsSchema.default(() => AudioSettingsSchema.parse({})),
  input: InputSettingsSchema.default(() => InputSettingsSchema.parse({})),
  accessibility: AccessibilitySettingsSchema.default(() => AccessibilitySettingsSchema.parse({})),
  developer: DeveloperSettingsSchema.default(() => DeveloperSettingsSchema.parse({})),
});
export type SettingsBundle = z.infer<typeof SettingsBundleSchema>;

export const DEFAULT_SETTINGS: SettingsBundle = SettingsBundleSchema.parse({});
