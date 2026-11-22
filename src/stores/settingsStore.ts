import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  AccessibilitySettings,
  AccessibilitySettingsSchema,
  applyBindingWithSwap,
  cloneVehicleControlLayoutMap,
  ControlBindings,
  DEFAULT_VEHICLE_CONTROL_MAP,
  DeveloperSettings,
  DisplaySettings,
  DisplaySettingsSchema,
  GameplaySettings,
  GameplaySettingsSchema,
  GraphicsSettings,
  GraphicsSettingsSchema,
  HudSettings,
  HudSettingsSchema,
  InputSettings,
  InputSettingsSchema,
  LEFT_HANDED_VEHICLE_CONTROL_MAP,
  QualityPresetProfile,
  SettingsBundle,
  SettingsBundleSchema,
  SettingsCategoryId,
} from '@/src/schemas/settings.schema';
import { SettingsManager } from '@/src/storage/SettingsManager';

export interface SettingsStoreState {
  display: DisplaySettings;
  graphics: GraphicsSettings;
  input: InputSettings;
  gameplay: GameplaySettings;
  hud: HudSettings;
  accessibility: AccessibilitySettings;
  developer: DeveloperSettings;
  updateDisplay: (patch: Partial<DisplaySettings>) => void;
  updateGraphics: (patch: Partial<GraphicsSettings>, options?: { preserveAutoMode?: boolean }) => void;
  applyQualityProfile: (profile: QualityPresetProfile) => void;
  applyAutoDetectedGraphics: (patch: Partial<GraphicsSettings>) => void;
  updateInput: (patch: Partial<InputSettings>) => void;
  updateBinding: (
    action: keyof ControlBindings,
    keyCode: string,
    options?: { swapOnConflict?: boolean }
  ) => { swappedWith: keyof ControlBindings | null };
  updateGameplay: (patch: Partial<GameplaySettings>) => void;
  updateHud: (patch: Partial<HudSettings>) => void;
  updateAccessibility: (patch: Partial<AccessibilitySettings>) => void;
  updateDeveloper: (patch: Partial<DeveloperSettings>) => void;
  applyFullSettings: (
    bundle: Pick<SettingsBundle, 'graphics' | 'input' | 'accessibility'> & {
      display?: DisplaySettings;
      gameplay?: GameplaySettings;
      hud?: HudSettings;
      developer?: DeveloperSettings;
    }
  ) => void;
  resetCategory: (category: SettingsCategoryId) => void;
  resetDefaults: () => void;
}

const initial = SettingsManager.load();

function persistCurrent(
  state: Pick<
    SettingsStoreState,
    'display' | 'graphics' | 'input' | 'gameplay' | 'hud' | 'accessibility' | 'developer'
  >
) {
  SettingsManager.patchAndSave({
    display: state.display,
    graphics: state.graphics,
    input: state.input,
    gameplay: state.gameplay,
    hud: state.hud,
    accessibility: state.accessibility,
    developer: state.developer,
  });
}

const MANUAL_GRAPHICS_OVERRIDE_KEYS: Array<keyof GraphicsSettings> = [
  'quality',
  'shadowsEnabled',
  'csmCascades',
  'shadowMapSize',
  'ambientOcclusion',
  'volumetricFog',
  'wetReflections',
  'decalBudget',
  'foliageDensity',
  'colorGrading',
  'maxDpr',
  'bloomEnabled',
  'renderScale',
  'textureQuality',
  'antialiasing',
  'effectsQuality',
  'drawDistance',
  'fpsCap',
];

export const QUALITY_PROFILE_PRESETS: Record<
  Exclude<QualityPresetProfile, 'manual' | 'custom'>,
  Partial<GraphicsSettings>
> = {
  auto_adaptive: {
    qualityMode: 'auto',
    qualityProfile: 'auto_adaptive',
    adaptiveGovernor: true,
    quality: 'high',
    shadowsEnabled: true,
    csmCascades: 3,
    shadowMapSize: 1024,
    ambientOcclusion: true,
    volumetricFog: true,
    wetReflections: true,
    decalBudget: 128,
    foliageDensity: 'high',
    colorGrading: true,
    bloomEnabled: true,
    renderScale: 1.0,
    maxDpr: 1.75,
    textureQuality: 'high',
    effectsQuality: 'high',
    antialiasing: true,
    drawDistance: 'auto',
  },
  cinematic: {
    qualityMode: 'manual',
    qualityProfile: 'cinematic',
    adaptiveGovernor: false,
    quality: 'ultra',
    shadowsEnabled: true,
    csmCascades: 4,
    shadowMapSize: 2048,
    ambientOcclusion: true,
    volumetricFog: true,
    wetReflections: true,
    decalBudget: 224,
    foliageDensity: 'high',
    colorGrading: true,
    bloomEnabled: true,
    renderScale: 1.0,
    maxDpr: 2.0,
    textureQuality: 'high',
    effectsQuality: 'high',
    antialiasing: true,
    drawDistance: 'ultra',
  },
  balanced: {
    qualityMode: 'manual',
    qualityProfile: 'balanced',
    adaptiveGovernor: false,
    quality: 'high',
    shadowsEnabled: true,
    csmCascades: 3,
    shadowMapSize: 1024,
    ambientOcclusion: true,
    volumetricFog: true,
    wetReflections: true,
    decalBudget: 128,
    foliageDensity: 'medium',
    colorGrading: true,
    bloomEnabled: true,
    renderScale: 0.95,
    maxDpr: 1.5,
    textureQuality: 'high',
    effectsQuality: 'medium',
    antialiasing: true,
    drawDistance: 'long',
  },
  performance: {
    qualityMode: 'manual',
    qualityProfile: 'performance',
    adaptiveGovernor: false,
    quality: 'low',
    shadowsEnabled: true,
    csmCascades: 1,
    shadowMapSize: 512,
    ambientOcclusion: false,
    volumetricFog: false,
    wetReflections: false,
    decalBudget: 48,
    foliageDensity: 'low',
    colorGrading: true,
    bloomEnabled: false,
    renderScale: 0.8,
    maxDpr: 1.0,
    textureQuality: 'low',
    effectsQuality: 'low',
    antialiasing: false,
    drawDistance: 'short',
  },
};

export const settingsStore = createStore<SettingsStoreState>()(
  subscribeWithSelector((set, get) => ({
    display: initial.display,
    graphics: initial.graphics,
    input: initial.input,
    gameplay: initial.gameplay,
    hud: initial.hud,
    accessibility: initial.accessibility,
    developer: initial.developer,

    updateDisplay: (patch) => {
      const nextDisplay = { ...get().display, ...patch };
      set({ display: nextDisplay });
      persistCurrent({ ...get(), display: nextDisplay });
    },

    updateGraphics: (patch, options) => {
      const current = get().graphics;
      const setsManualOverride =
        !options?.preserveAutoMode &&
        patch.qualityMode === undefined &&
        patch.qualityProfile === undefined &&
        MANUAL_GRAPHICS_OVERRIDE_KEYS.some((k) => patch[k] !== undefined);
      const nextQualityMode =
        patch.qualityMode !== undefined
          ? patch.qualityMode
          : setsManualOverride
            ? 'manual'
            : current.qualityMode;
      const nextQualityProfile =
        patch.qualityProfile !== undefined
          ? patch.qualityProfile
          : setsManualOverride
            ? 'custom'
            : current.qualityProfile;
      const next: GraphicsSettings = {
        ...current,
        ...patch,
        qualityMode: nextQualityMode,
        qualityProfile: nextQualityProfile,
      };
      set({ graphics: next });
      persistCurrent({ ...get(), graphics: next });
    },

    applyQualityProfile: (profile) => {
      const current = get().graphics;
      if (profile === 'manual' || profile === 'custom') {
        const next: GraphicsSettings = {
          ...current,
          qualityMode: 'manual',
          qualityProfile: profile,
          adaptiveGovernor: false,
        };
        set({ graphics: next });
        persistCurrent({ ...get(), graphics: next });
        return;
      }
      const preset = QUALITY_PROFILE_PRESETS[profile];
      const next: GraphicsSettings = {
        ...current,
        ...preset,
      };
      set({ graphics: next });
      persistCurrent({ ...get(), graphics: next });
    },

    applyAutoDetectedGraphics: (patch) => {
      const next: GraphicsSettings = {
        ...get().graphics,
        ...patch,
        qualityMode: 'auto',
        qualityProfile: 'auto_adaptive',
        autoDetectedPresetApplied: true,
      };
      set({ graphics: next });
      persistCurrent({ ...get(), graphics: next });
    },

    updateInput: (patch) => {
      const prev = get().input;
      const next: InputSettings = { ...prev, ...patch };

      if (patch.touchControlProfile === 'two_finger') {
        if (patch.leftFireEnabled === undefined) next.leftFireEnabled = false;
        if (patch.rightFireEnabled === undefined) next.rightFireEnabled = true;
      } else if (patch.touchControlProfile === 'three_finger') {
        if (patch.leftFireEnabled === undefined) next.leftFireEnabled = true;
        if (patch.rightFireEnabled === undefined) next.rightFireEnabled = false;
      }

      if (patch.touchVehicleLeftHanded !== undefined && !patch.touchVehicleLayout) {
        next.touchVehicleLayout = cloneVehicleControlLayoutMap(
          patch.touchVehicleLeftHanded
            ? LEFT_HANDED_VEHICLE_CONTROL_MAP
            : DEFAULT_VEHICLE_CONTROL_MAP
        );
      }

      const baseCustom = { ...(prev.touchCustomLayout ?? {}) };
      if (patch.touchFirePosTwoFinger) {
        baseCustom.fire_right = {
          ...(baseCustom.fire_right ?? { scale: 1.0 }),
          x: patch.touchFirePosTwoFinger.x,
          y: patch.touchFirePosTwoFinger.y,
        };
      }
      if (patch.touchFirePosThreeFinger) {
        baseCustom.fire_left = {
          ...(baseCustom.fire_left ?? { scale: 1.05 }),
          x: patch.touchFirePosThreeFinger.x,
          y: patch.touchFirePosThreeFinger.y,
        };
      }
      if (patch.touchAdsPosTwoFinger && next.touchControlProfile === 'two_finger') {
        baseCustom.ads = {
          ...(baseCustom.ads ?? { scale: 1.0 }),
          x: patch.touchAdsPosTwoFinger.x,
          y: patch.touchAdsPosTwoFinger.y,
        };
      }
      if (patch.touchAdsPosThreeFinger && next.touchControlProfile === 'three_finger') {
        baseCustom.ads = {
          ...(baseCustom.ads ?? { scale: 1.05 }),
          x: patch.touchAdsPosThreeFinger.x,
          y: patch.touchAdsPosThreeFinger.y,
        };
      }
      if (!patch.touchCustomLayout) {
        next.touchCustomLayout = baseCustom as InputSettings['touchCustomLayout'];
      }

      if (!next.leftFireEnabled && !next.rightFireEnabled) {
        if (patch.rightFireEnabled === false && prev.rightFireEnabled) {
          next.leftFireEnabled = true;
        } else {
          next.rightFireEnabled = true;
        }
      }

      set({ input: next });
      persistCurrent({ ...get(), input: next });
    },

    updateBinding: (action, keyCode, options) => {
      const swapOnConflict = options?.swapOnConflict ?? true;
      const result = applyBindingWithSwap(get().input.bindings, action, keyCode, swapOnConflict);
      const nextInput = { ...get().input, bindings: result.bindings };
      set({ input: nextInput });
      persistCurrent({ ...get(), input: nextInput });
      return { swappedWith: result.swappedWith };
    },

    updateGameplay: (patch) => {
      const nextGameplay = { ...get().gameplay, ...patch };
      set({ gameplay: nextGameplay });
      persistCurrent({ ...get(), gameplay: nextGameplay });
    },

    updateHud: (patch) => {
      const nextHud = { ...get().hud, ...patch };
      set({ hud: nextHud });
      persistCurrent({ ...get(), hud: nextHud });
    },

    updateAccessibility: (patch) => {
      const next = { ...get().accessibility, ...patch };
      set({ accessibility: next });
      persistCurrent({ ...get(), accessibility: next });
    },

    updateDeveloper: (patch) => {
      const next = { ...get().developer, ...patch };
      set({ developer: next });
      persistCurrent({ ...get(), developer: next });
    },

    applyFullSettings: (bundle) => {
      const nextDisplay = bundle.display ?? get().display;
      const nextGameplay = bundle.gameplay ?? get().gameplay;
      const nextHud = bundle.hud ?? get().hud;
      const nextDev = bundle.developer ?? get().developer;
      set({
        display: nextDisplay,
        graphics: bundle.graphics,
        input: bundle.input,
        gameplay: nextGameplay,
        hud: nextHud,
        accessibility: bundle.accessibility,
        developer: nextDev,
      });
      persistCurrent({
        display: nextDisplay,
        graphics: bundle.graphics,
        input: bundle.input,
        gameplay: nextGameplay,
        hud: nextHud,
        accessibility: bundle.accessibility,
        developer: nextDev,
      });
    },

    resetCategory: (category) => {
      if (category === 'display') {
        set({ display: DisplaySettingsSchema.parse({}) });
      } else if (category === 'graphics') {
        set({ graphics: GraphicsSettingsSchema.parse({}) });
      } else if (category === 'controls') {
        set({ input: InputSettingsSchema.parse({}) });
      } else if (category === 'gameplay') {
        set({ gameplay: GameplaySettingsSchema.parse({}) });
      } else if (category === 'hud') {
        set({ hud: HudSettingsSchema.parse({}) });
      } else if (category === 'accessibility') {
        set({ accessibility: AccessibilitySettingsSchema.parse({}) });
      }
      persistCurrent(get());
    },

    resetDefaults: () => {
      const def = SettingsBundleSchema.parse({});
      set({
        display: def.display,
        graphics: def.graphics,
        input: def.input,
        gameplay: def.gameplay,
        hud: def.hud,
        accessibility: def.accessibility,
        developer: def.developer,
      });
      SettingsManager.save(def);
    },
  }))
);

export function useSettingsStore<T>(selector: (state: SettingsStoreState) => T): T {
  return useStore(settingsStore, selector);
}
