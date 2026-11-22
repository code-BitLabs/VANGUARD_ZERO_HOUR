import {
  DEFAULT_SETTINGS,
  migrateSettingsBundle,
  SettingsBundle,
  SettingsBundleSchema,
} from '@/src/schemas/settings.schema';
import { safeGetItem, safeSetItem } from './safeStorage';

const SETTINGS_KEY = 'vanguard_zero_hour_settings_v2';

export class SettingsManager {
  static lastRecoveredFromCorruption = false;
  private static cachedBundle: SettingsBundle | null = null;

  static load(): SettingsBundle {
    try {
      const raw = safeGetItem(SETTINGS_KEY);
      if (raw) {
        const result = migrateSettingsBundle(JSON.parse(raw));
        this.lastRecoveredFromCorruption = result.recoveredFromCorruption;
        this.cachedBundle = result.bundle;
        return result.bundle;
      }

      this.lastRecoveredFromCorruption = false;
      const def = SettingsBundleSchema.parse({});
      this.cachedBundle = def;
      return def;
    } catch {
      this.lastRecoveredFromCorruption = true;
      const fallback = { ...DEFAULT_SETTINGS };
      this.cachedBundle = fallback;
      return fallback;
    }
  }

  static save(bundle: SettingsBundle): boolean {
    const validated = SettingsBundleSchema.safeParse({ ...bundle, version: 2 });
    if (!validated.success) return false;
    this.cachedBundle = validated.data;
    try {
      const serialized = JSON.stringify(validated.data);
      const primary = safeSetItem(SETTINGS_KEY, serialized);
      return primary.ok;
    } catch {
      return false;
    }
  }

  static patchAndSave(patch: Partial<Omit<SettingsBundle, 'version'>>): boolean {
    const base = this.cachedBundle ?? this.load();
    return this.save({
      ...base,
      ...patch,
      version: 2,
    });
  }
}
