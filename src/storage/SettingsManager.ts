import { DEFAULT_SETTINGS, SettingsBundle, SettingsBundleSchema } from '@/src/schemas/settings.schema';

const SETTINGS_KEY = 'vanguard_zero_hour_settings_v1';

export class SettingsManager {
  static load(): SettingsBundle {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return SettingsBundleSchema.parse({});
      const parsed = SettingsBundleSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      return SettingsBundleSchema.parse({});
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  static save(bundle: SettingsBundle): boolean {
    const validated = SettingsBundleSchema.safeParse(bundle);
    if (!validated.success) return false;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(validated.data));
      return true;
    } catch {
      return false;
    }
  }
}
