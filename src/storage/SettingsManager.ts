import {
  DEFAULT_SETTINGS,
  migrateSettingsBundle,
  SettingsBundle,
  SettingsBundleSchema,
} from '@/src/schemas/settings.schema';
import { safeGetItem, safeRemoveItem, safeSetItem } from './safeStorage';

const SETTINGS_KEY_V2 = 'vanguard_zero_hour_settings_v2';
const SETTINGS_KEY_V1 = 'vanguard_zero_hour_settings_v1';

export class SettingsManager {
  static lastRecoveredFromCorruption = false;
  static lastMigratedFromV1 = false;

  static load(): SettingsBundle {
    try {
      const rawV2 = safeGetItem(SETTINGS_KEY_V2);
      if (rawV2) {
        const result = migrateSettingsBundle(JSON.parse(rawV2));
        this.lastRecoveredFromCorruption = result.recoveredFromCorruption;
        this.lastMigratedFromV1 = false;
        return result.bundle;
      }

      const rawV1 = safeGetItem(SETTINGS_KEY_V1);
      if (rawV1) {
        const result = migrateSettingsBundle(JSON.parse(rawV1));
        this.lastRecoveredFromCorruption = result.recoveredFromCorruption;
        this.lastMigratedFromV1 = result.migratedFromV1;
        if (!result.recoveredFromCorruption) {
          this.save(result.bundle);
        }
        return result.bundle;
      }

      this.lastRecoveredFromCorruption = false;
      this.lastMigratedFromV1 = false;
      return SettingsBundleSchema.parse({});
    } catch {
      this.lastRecoveredFromCorruption = true;
      this.lastMigratedFromV1 = false;
      return { ...DEFAULT_SETTINGS };
    }
  }

  static save(bundle: SettingsBundle): boolean {
    const validated = SettingsBundleSchema.safeParse({ ...bundle, version: 2 });
    if (!validated.success) return false;
    try {
      const serialized = JSON.stringify(validated.data);
      let primary = safeSetItem(SETTINGS_KEY_V2, serialized);
      if (!primary.ok && primary.quotaExceeded) {
        safeRemoveItem(SETTINGS_KEY_V1);
        primary = safeSetItem(SETTINGS_KEY_V2, serialized);
      }
      if (!primary.ok) return false;
      // Mirror v1 key only if quota permits without compromising v2
      const mirror = safeSetItem(SETTINGS_KEY_V1, serialized);
      if (!mirror.ok && mirror.quotaExceeded) {
        safeRemoveItem(SETTINGS_KEY_V1);
      }
      return true;
    } catch {
      return false;
    }
  }
}
