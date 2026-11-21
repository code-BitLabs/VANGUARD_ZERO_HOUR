const memoryStorageFallback = new Map<string, string>();

function resolveBrowserLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Restricted iframe / sandboxed privacy mode throws SecurityError accessing window.localStorage
  }
  return null;
}

export function isStorageQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  );
}

export function safeGetItem(key: string): string | null {
  const storage = resolveBrowserLocalStorage();
  if (storage) {
    try {
      return storage.getItem(key);
    } catch {
      return memoryStorageFallback.get(key) ?? null;
    }
  }
  return memoryStorageFallback.get(key) ?? null;
}

export function safeSetItem(
  key: string,
  value: string
): { ok: boolean; quotaExceeded: boolean; usedMemoryFallback: boolean } {
  const storage = resolveBrowserLocalStorage();
  if (!storage) {
    memoryStorageFallback.set(key, value);
    return { ok: true, quotaExceeded: false, usedMemoryFallback: true };
  }
  try {
    storage.setItem(key, value);
    memoryStorageFallback.delete(key);
    return { ok: true, quotaExceeded: false, usedMemoryFallback: false };
  } catch (err) {
    memoryStorageFallback.set(key, value);
    if (isStorageQuotaError(err)) {
      return {
        ok: false,
        quotaExceeded: true,
        usedMemoryFallback: true,
      };
    }
    // SecurityError / private browsing restriction: keep session alive via in-memory store
    return {
      ok: true,
      quotaExceeded: false,
      usedMemoryFallback: true,
    };
  }
}

export function safeRemoveItem(key: string): void {
  memoryStorageFallback.delete(key);
  const storage = resolveBrowserLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage removal errors in restricted environments
  }
}

export function clearMemoryStorageFallbackForTests(): void {
  memoryStorageFallback.clear();
}
