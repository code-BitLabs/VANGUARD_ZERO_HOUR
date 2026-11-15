import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  AccessibilitySettings,
  ControlBindings,
  DeveloperSettings,
  GraphicsSettings,
  InputSettings,
  SettingsBundle,
  SettingsBundleSchema,
} from '@/src/schemas/settings.schema';
import { SettingsManager } from '@/src/storage/SettingsManager';

export interface SettingsStoreState {
  graphics: GraphicsSettings;
  input: InputSettings;
  accessibility: AccessibilitySettings;
  developer: DeveloperSettings;
  updateGraphics: (patch: Partial<GraphicsSettings>, options?: { preserveAutoMode?: boolean }) => void;
  applyAutoDetectedGraphics: (patch: Partial<GraphicsSettings>) => void;
  updateInput: (patch: Partial<InputSettings>) => void;
  updateBinding: (action: keyof ControlBindings, keyCode: string) => void;
  updateAccessibility: (patch: Partial<AccessibilitySettings>) => void;
  updateDeveloper: (patch: Partial<DeveloperSettings>) => void;
  applyFullSettings: (
    bundle: Pick<SettingsBundle, 'graphics' | 'input' | 'accessibility'> & {
      developer?: DeveloperSettings;
    }
  ) => void;
  resetDefaults: () => void;
}

const initial = SettingsManager.load();

function persistCurrent(
  state: Pick<SettingsStoreState, 'graphics' | 'input' | 'accessibility' | 'developer'>
) {
  const current = SettingsManager.load();
  SettingsManager.save({
    version: 1,
    audio: current.audio,
    graphics: state.graphics,
    input: state.input,
    accessibility: state.accessibility,
    developer: state.developer,
  });
}

const MANUAL_GRAPHICS_OVERRIDE_KEYS: Array<keyof GraphicsSettings> = [
  'quality',
  'shadowsEnabled',
  'bloomEnabled',
  'renderScale',
  'textureQuality',
  'antialiasing',
  'effectsQuality',
  'drawDistance',
  'fpsCap',
];

export const settingsStore = createStore<SettingsStoreState>()(
  subscribeWithSelector((set, get) => ({
    graphics: initial.graphics,
    input: initial.input,
    accessibility: initial.accessibility,
    developer: initial.developer,
    updateGraphics: (patch, options) => {
      const current = get().graphics;
      const setsManualOverride =
        !options?.preserveAutoMode &&
        patch.qualityMode === undefined &&
        MANUAL_GRAPHICS_OVERRIDE_KEYS.some((k) => patch[k] !== undefined);
      const next: GraphicsSettings = {
        ...current,
        ...patch,
        qualityMode:
          patch.qualityMode !== undefined
            ? patch.qualityMode
            : setsManualOverride
              ? 'manual'
              : current.qualityMode,
      };
      set({ graphics: next });
      persistCurrent({
        graphics: next,
        input: get().input,
        accessibility: get().accessibility,
        developer: get().developer,
      });
    },
    applyAutoDetectedGraphics: (patch) => {
      const next: GraphicsSettings = {
        ...get().graphics,
        ...patch,
        qualityMode: 'auto',
        autoDetectedPresetApplied: true,
      };
      set({ graphics: next });
      persistCurrent({
        graphics: next,
        input: get().input,
        accessibility: get().accessibility,
        developer: get().developer,
      });
    },
    updateInput: (patch) => {
      const prev = get().input;
      const next: InputSettings = { ...prev, ...patch };

      // When switching to Two-Finger or Three-Finger profile, apply recommended Left/Right Fire defaults unless explicitly specified
      if (patch.touchControlProfile === 'two_finger') {
        if (patch.leftFireEnabled === undefined) next.leftFireEnabled = false;
        if (patch.rightFireEnabled === undefined) next.rightFireEnabled = true;
      } else if (patch.touchControlProfile === 'three_finger') {
        if (patch.leftFireEnabled === undefined) next.leftFireEnabled = true;
        if (patch.rightFireEnabled === undefined) next.rightFireEnabled = false;
      }

      // Synchronize legacy per-profile fire/ads positions into touchCustomLayout so all custom edits and presets stay coherent
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

      // Safety invariant: always keep at least one Fire button active for normal gameplay
      if (!next.leftFireEnabled && !next.rightFireEnabled) {
        if (patch.rightFireEnabled === false && prev.rightFireEnabled) {
          next.leftFireEnabled = true;
        } else {
          next.rightFireEnabled = true;
        }
      }

      set({ input: next });
      persistCurrent({
        graphics: get().graphics,
        input: next,
        accessibility: get().accessibility,
        developer: get().developer,
      });
    },
    updateBinding: (action, keyCode) => {
      const nextBindings = { ...get().input.bindings, [action]: keyCode };
      const nextInput = { ...get().input, bindings: nextBindings };
      set({ input: nextInput });
      persistCurrent({
        graphics: get().graphics,
        input: nextInput,
        accessibility: get().accessibility,
        developer: get().developer,
      });
    },
    updateAccessibility: (patch) => {
      const next = { ...get().accessibility, ...patch };
      set({ accessibility: next });
      persistCurrent({
        graphics: get().graphics,
        input: get().input,
        accessibility: next,
        developer: get().developer,
      });
    },
    updateDeveloper: (patch) => {
      const next = { ...get().developer, ...patch };
      set({ developer: next });
      persistCurrent({
        graphics: get().graphics,
        input: get().input,
        accessibility: get().accessibility,
        developer: next,
      });
    },
    applyFullSettings: (bundle) => {
      const nextDev = bundle.developer ?? get().developer;
      set({
        graphics: bundle.graphics,
        input: bundle.input,
        accessibility: bundle.accessibility,
        developer: nextDev,
      });
      persistCurrent({
        graphics: bundle.graphics,
        input: bundle.input,
        accessibility: bundle.accessibility,
        developer: nextDev,
      });
    },
    resetDefaults: () => {
      const def = SettingsBundleSchema.parse({});
      set({
        graphics: def.graphics,
        input: def.input,
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
