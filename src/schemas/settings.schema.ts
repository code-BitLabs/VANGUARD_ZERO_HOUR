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
});
export type GraphicsSettings = z.infer<typeof GraphicsSettingsSchema>;

export const AudioSettingsSchema = z.object({
  masterVolume: z.number().min(0).max(1).default(0.8),
  musicVolume: z.number().min(0).max(1).default(0.5),
  sfxVolume: z.number().min(0).max(1).default(0.85),
  ambienceVolume: z.number().min(0).max(1).default(0.6),
  muted: z.boolean().default(false),
});
export type AudioSettings = z.infer<typeof AudioSettingsSchema>;

export const TouchModeSchema = z.enum(['auto', 'always_on', 'always_off']);
export type TouchMode = z.infer<typeof TouchModeSchema>;

export const TouchFireBehaviorSchema = z.enum(['dedicated', 'ads_on_fire']);
export type TouchFireBehavior = z.infer<typeof TouchFireBehaviorSchema>;

export const InputSettingsSchema = z.object({
  mouseSensitivity: z.number().min(0.1).max(4.0).default(1.0),
  adsSensitivity: z.number().min(0.1).max(2.0).default(0.6),
  invertY: z.boolean().default(false),
  gamepadEnabled: z.boolean().default(true),
  touchMode: TouchModeSchema.default('auto'),
  touchSensitivity: z.number().min(0.3).max(3.0).default(1.15),
  touchButtonScale: z.number().min(0.75).max(1.35).default(1.0),
  touchButtonOpacity: z.number().min(0.35).max(0.95).default(0.72),
  autoSprint: z.boolean().default(true),
  touchFireBehavior: TouchFireBehaviorSchema.default('dedicated'),
  bindings: ControlBindingsSchema.default(() => ControlBindingsSchema.parse({})),
});
export type InputSettings = z.infer<typeof InputSettingsSchema>;

export const AccessibilitySettingsSchema = z.object({
  colorblindMode: ColorblindModeSchema.default('standard'),
  subtitles: z.boolean().default(true),
  reducedMotion: z.boolean().default(false),
  uiScale: z.number().min(0.85).max(1.25).default(1.0),
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
