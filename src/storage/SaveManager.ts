import { get, set, del } from 'idb-keyval';
import {
  CombatLogEntry,
  CombatLogEntrySchema,
  DEFAULT_PROGRESSION_SAVE,
  migrateProgressionSave,
  ProgressionSave,
  ProgressionSaveSchema,
} from '@/src/schemas/save.schema';

const SAVE_KEY = 'vanguard_zero_hour_progression_v2';
const BACKUP_KEY = 'vanguard_zero_hour_progression_backup';
const COMBAT_LOGS_IDB_KEY = 'vanguard_combat_logs_v1';
const BENCHMARK_LOGS_IDB_KEY = 'vanguard_benchmark_logs_v1';

export interface SaveLoadResult {
  save: ProgressionSave;
  recoveredFromCorruption: boolean;
  migratedFromV1: boolean;
}

export class SaveManager {
  static loadProgression(): SaveLoadResult {
    try {
      const rawStr = localStorage.getItem(SAVE_KEY);
      if (!rawStr) {
        const legacyStr = localStorage.getItem('vanguard_zero_hour_progression_v1');
        if (legacyStr) {
          const parsedLegacy = JSON.parse(legacyStr);
          const result = migrateProgressionSave(parsedLegacy);
          this.saveProgression(result.save);
          return result;
        }
        return { save: ProgressionSaveSchema.parse({}), recoveredFromCorruption: false, migratedFromV1: false };
      }

      const parsed = JSON.parse(rawStr);
      const result = migrateProgressionSave(parsed);

      if (result.recoveredFromCorruption) {
        const backupStr = localStorage.getItem(BACKUP_KEY);
        if (backupStr) {
          const backupResult = migrateProgressionSave(JSON.parse(backupStr));
          if (!backupResult.recoveredFromCorruption) {
            this.saveProgression(backupResult.save);
            return { save: backupResult.save, recoveredFromCorruption: true, migratedFromV1: false };
          }
        }
        this.saveProgression(result.save);
      }

      return result;
    } catch {
      try {
        const backupStr = localStorage.getItem(BACKUP_KEY);
        if (backupStr) {
          const backupResult = migrateProgressionSave(JSON.parse(backupStr));
          if (!backupResult.recoveredFromCorruption) {
            return { save: backupResult.save, recoveredFromCorruption: true, migratedFromV1: false };
          }
        }
      } catch {
        // Backup also unreadable; return clean defaults
      }
      return {
        save: { ...DEFAULT_PROGRESSION_SAVE },
        recoveredFromCorruption: true,
        migratedFromV1: false,
      };
    }
  }

  static saveProgression(save: ProgressionSave): boolean {
    const validated = ProgressionSaveSchema.safeParse({ ...save, updatedAt: Date.now() });
    if (!validated.success) return false;
    try {
      const prev = localStorage.getItem(SAVE_KEY);
      if (prev) {
        localStorage.setItem(BACKUP_KEY, prev);
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify(validated.data));
      return true;
    } catch {
      return false;
    }
  }

  static resetProgression(): ProgressionSave {
    const fresh = ProgressionSaveSchema.parse({});
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(BACKUP_KEY);
    } catch {
      // Ignore storage failures
    }
    return fresh;
  }

  static async appendCombatLog(entry: CombatLogEntry): Promise<void> {
    const valid = CombatLogEntrySchema.safeParse(entry);
    if (!valid.success) return;
    try {
      const existing = (await get<CombatLogEntry[]>(COMBAT_LOGS_IDB_KEY)) ?? [];
      const next = [valid.data, ...existing].slice(0, 50);
      await set(COMBAT_LOGS_IDB_KEY, next);
    } catch {
      // IndexedDB unavailable (e.g. private browsing); fail gracefully
    }
  }

  static async getCombatLogs(): Promise<CombatLogEntry[]> {
    try {
      const raw = (await get<unknown[]>(COMBAT_LOGS_IDB_KEY)) ?? [];
      const valid: CombatLogEntry[] = [];
      for (const item of raw) {
        const parsed = CombatLogEntrySchema.safeParse(item);
        if (parsed.success) valid.push(parsed.data);
      }
      return valid;
    } catch {
      return [];
    }
  }

  static async saveBenchmarkSnapshot(snapshot: Record<string, unknown>): Promise<void> {
    try {
      const existing = (await get<Record<string, unknown>[]>(BENCHMARK_LOGS_IDB_KEY)) ?? [];
      await set(BENCHMARK_LOGS_IDB_KEY, [snapshot, ...existing].slice(0, 20));
    } catch {
      // Non-critical telemetry
    }
  }

  static async clearIndexedDbLogs(): Promise<void> {
    try {
      await del(COMBAT_LOGS_IDB_KEY);
      await del(BENCHMARK_LOGS_IDB_KEY);
    } catch {
      // Non-critical
    }
  }
}
