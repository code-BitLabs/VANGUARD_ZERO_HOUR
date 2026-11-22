import { get, set, del } from 'idb-keyval';
import { computeDeterministicHash } from '@/src/gameplay/campaign/CampaignEventLedger';
import {
  CombatLogEntry,
  CombatLogEntrySchema,
  DEFAULT_PROGRESSION_SAVE,
  migrateProgressionSave,
  ProgressionSave,
  ProgressionSaveSchema,
} from '@/src/schemas/save.schema';
import { safeGetItem, safeRemoveItem, safeSetItem } from './safeStorage';

export const SAVE_KEY = 'vanguard_zero_hour_progression_v2';
export const STAGING_KEY = 'vanguard_zero_hour_progression_staging';
export const BACKUP_KEY = 'vanguard_zero_hour_progression_backup';
const COMBAT_LOGS_IDB_KEY = 'vanguard_combat_logs_v1';
const BENCHMARK_LOGS_IDB_KEY = 'vanguard_benchmark_logs_v1';

interface AtomicSaveEnvelope {
  envelopeVersion: 1;
  checksum: string;
  payloadJson: string;
}

export interface SaveLoadResult {
  save: ProgressionSave;
  recoveredFromCorruption: boolean;
  recoveredFromStaging?: boolean;
}

function tryDecodeStoredSlot(rawStr: string | null): {
  parsed: unknown;
  validEnvelope: boolean;
} | null {
  if (!rawStr) return null;
  try {
    const outer = JSON.parse(rawStr) as Partial<AtomicSaveEnvelope>;
    if (
      outer &&
      typeof outer === 'object' &&
      outer.envelopeVersion === 1 &&
      typeof outer.checksum === 'string' &&
      typeof outer.payloadJson === 'string'
    ) {
      const expected = computeDeterministicHash(outer.payloadJson);
      if (expected !== outer.checksum) {
        return { parsed: null, validEnvelope: false };
      }
      return { parsed: JSON.parse(outer.payloadJson), validEnvelope: true };
    }
    return { parsed: null, validEnvelope: false };
  } catch {
    return { parsed: null, validEnvelope: false };
  }
}

function encodeEnvelope(save: ProgressionSave): string {
  const payloadJson = JSON.stringify(save);
  const envelope: AtomicSaveEnvelope = {
    envelopeVersion: 1,
    checksum: computeDeterministicHash(payloadJson),
    payloadJson,
  };
  return JSON.stringify(envelope);
}

export class SaveManager {
  static loadProgression(): SaveLoadResult {
    const primaryStr = safeGetItem(SAVE_KEY);
    const stagingStr = safeGetItem(STAGING_KEY);
    const backupStr = safeGetItem(BACKUP_KEY);

    // 1. Primary slot check
    const primaryDecoded = tryDecodeStoredSlot(primaryStr);
    if (primaryDecoded && primaryDecoded.validEnvelope && primaryDecoded.parsed) {
      const result = migrateProgressionSave(primaryDecoded.parsed);
      if (!result.recoveredFromCorruption) {
        // Clear any stale staging residue if primary is healthy
        if (stagingStr) {
          safeRemoveItem(STAGING_KEY);
        }
        return result;
      }
    }

    // 2. Fresh profile when no persisted slots exist
    if (!primaryStr && !stagingStr && !backupStr) {
      return {
        save: ProgressionSaveSchema.parse({}),
        recoveredFromCorruption: false,
      };
    }

    // 3. Interrupted-commit recovery: prefer verified STAGING_KEY if primary was corrupted/missing
    const stagingDecoded = tryDecodeStoredSlot(stagingStr);
    if (stagingDecoded && stagingDecoded.validEnvelope && stagingDecoded.parsed) {
      const stagingRes = migrateProgressionSave(stagingDecoded.parsed);
      if (!stagingRes.recoveredFromCorruption) {
        this.saveProgression(stagingRes.save);
        return {
          save: stagingRes.save,
          recoveredFromCorruption: true,
          recoveredFromStaging: true,
        };
      }
    }

    // 4. Verified BACKUP_KEY fallback
    const backupDecoded = tryDecodeStoredSlot(backupStr);
    if (backupDecoded && backupDecoded.validEnvelope && backupDecoded.parsed) {
      const backupRes = migrateProgressionSave(backupDecoded.parsed);
      if (!backupRes.recoveredFromCorruption) {
        this.saveProgression(backupRes.save);
        return {
          save: backupRes.save,
          recoveredFromCorruption: true,
        };
      }
    }

    // 5. All slots corrupted: deterministic reset to clean defaults
    const fresh = ProgressionSaveSchema.parse({});
    this.saveProgression(fresh);
    return {
      save: fresh ?? { ...DEFAULT_PROGRESSION_SAVE },
      recoveredFromCorruption: true,
    };
  }

  /**
   * Two-phase atomic commit:
   * 1. Validate with Zod & wrap in FNV-1a checksum envelope.
   * 2. Write to STAGING_KEY.
   * 3. Copy previous verified SAVE_KEY to BACKUP_KEY.
   * 4. Promote envelope to SAVE_KEY and remove STAGING_KEY.
   */
  static saveProgression(save: ProgressionSave): boolean {
    const validated = ProgressionSaveSchema.safeParse({ ...save, updatedAt: Date.now() });
    if (!validated.success) return false;
    try {
      const encoded = encodeEnvelope(validated.data);
      // Phase 1: Stage new snapshot
      const staged = safeSetItem(STAGING_KEY, encoded);
      if (!staged.ok && staged.quotaExceeded) {
        // Shed optional backup/staging slots to recover disk budget for primary save
        safeRemoveItem(BACKUP_KEY);
        safeRemoveItem(STAGING_KEY);
        const directRetry = safeSetItem(SAVE_KEY, encoded);
        return directRetry.ok;
      }

      // Phase 2: Preserve previous verified primary in backup (non-fatal if backup quota is tight)
      const prev = safeGetItem(SAVE_KEY);
      if (prev) {
        const prevCheck = tryDecodeStoredSlot(prev);
        if (prevCheck && prevCheck.validEnvelope && prevCheck.parsed) {
          const backupRes = safeSetItem(BACKUP_KEY, prev);
          if (!backupRes.ok && backupRes.quotaExceeded) {
            safeRemoveItem(BACKUP_KEY);
          }
        }
      }

      // Phase 3: Promote staged payload to primary & clean staging
      let primaryRes = safeSetItem(SAVE_KEY, encoded);
      if (!primaryRes.ok && primaryRes.quotaExceeded) {
        safeRemoveItem(BACKUP_KEY);
        safeRemoveItem(STAGING_KEY);
        primaryRes = safeSetItem(SAVE_KEY, encoded);
      } else {
        safeRemoveItem(STAGING_KEY);
      }
      return primaryRes.ok;
    } catch {
      return false;
    }
  }

  static resetProgression(): ProgressionSave {
    const fresh = ProgressionSaveSchema.parse({});
    safeRemoveItem(SAVE_KEY);
    safeRemoveItem(STAGING_KEY);
    safeRemoveItem(BACKUP_KEY);
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
