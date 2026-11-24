import { useSyncExternalStore } from 'react';

// Vendor-prefixed document extensions
interface VendorDocument extends Document {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  mozFullScreenEnabled?: boolean;
  msFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void>;
  mozCancelFullScreen?: () => Promise<void>;
  msExitFullscreen?: () => Promise<void>;
}

// Vendor-prefixed element extensions
interface VendorElement extends Element {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  mozRequestFullScreen?: (options?: FullscreenOptions) => Promise<void>;
  msRequestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
}

/**
 * Checks whether the native Fullscreen API is supported by the current browser environment.
 */
export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as VendorDocument;
  return Boolean(
    doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      doc.mozFullScreenEnabled ||
      doc.msFullscreenEnabled ||
      typeof doc.exitFullscreen === 'function' ||
      typeof doc.webkitExitFullscreen === 'function'
  );
}

/**
 * Checks whether fullscreen mode is currently active.
 */
export function isFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as VendorDocument;
  return Boolean(
    doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
  );
}

/**
 * Requests native fullscreen on the target element (defaults to document.documentElement).
 * Must be invoked from an active user gesture (e.g. click/tap event handler).
 * Gracefully catches rejections (e.g. user denied, iOS Safari, permissions policy)
 * and attempts landscape orientation lock on platforms that support it.
 *
 * @returns Promise<boolean> true if fullscreen was granted, false if declined/unsupported.
 */
export async function requestAppFullscreen(
  targetElement?: Element | null
): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const target = (targetElement || document.documentElement) as VendorElement;

  try {
    if (typeof target.requestFullscreen === 'function') {
      await target.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
    } else if (typeof target.webkitRequestFullscreen === 'function') {
      await target.webkitRequestFullscreen();
    } else if (typeof target.mozRequestFullScreen === 'function') {
      await target.mozRequestFullScreen();
    } else if (typeof target.msRequestFullscreen === 'function') {
      await target.msRequestFullscreen();
    } else {
      return false;
    }

    // Try to lock to landscape if the screen orientation API is available (supported on Android Chrome in fullscreen)
    try {
      if (
        typeof screen !== 'undefined' &&
        screen.orientation &&
        typeof screen.orientation.lock === 'function'
      ) {
        screen.orientation.lock('landscape').catch(() => {
          // Gracefully ignore rejected orientation lock
        });
      }
    } catch {
      // Ignore orientation lock failures
    }

    notifyFullscreenListeners();
    return true;
  } catch {
    // If navigationUI: 'hide' caused rejection, retry with simple request
    try {
      if (typeof target.requestFullscreen === 'function') {
        await target.requestFullscreen();
        notifyFullscreenListeners();
        return true;
      }
    } catch {
      // User declined or policy blocked fullscreen; game remains completely playable
    }
    return false;
  }
}

/**
 * Exits native fullscreen mode if active.
 */
export async function exitAppFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  if (!isFullscreenActive()) return;

  const doc = document as VendorDocument;

  try {
    if (typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen();
    } else if (typeof doc.webkitExitFullscreen === 'function') {
      await doc.webkitExitFullscreen();
    } else if (typeof doc.mozCancelFullScreen === 'function') {
      await doc.mozCancelFullScreen();
    } else if (typeof doc.msExitFullscreen === 'function') {
      await doc.msExitFullscreen();
    }

    // Unlock orientation if it was locked
    try {
      if (
        typeof screen !== 'undefined' &&
        screen.orientation &&
        typeof screen.orientation.unlock === 'function'
      ) {
        screen.orientation.unlock();
      }
    } catch {
      // Ignore
    }

    notifyFullscreenListeners();
  } catch {
    // Graceful failure
  }
}

/**
 * Toggles fullscreen mode based on current state.
 */
export async function toggleAppFullscreen(
  targetElement?: Element | null
): Promise<boolean> {
  if (isFullscreenActive()) {
    await exitAppFullscreen();
    return false;
  } else {
    return await requestAppFullscreen(targetElement);
  }
}

// Global listener store for fullscreen state synchronization
const listeners = new Set<() => void>();
let listenersAttached = false;
let cachedActiveState = false;

function readActiveState(): boolean {
  return isFullscreenActive();
}

function notifyFullscreenListeners(): void {
  const next = readActiveState();
  if (cachedActiveState !== next) {
    cachedActiveState = next;
    for (const listener of listeners) {
      listener();
    }
  }
}

function onBrowserFullscreenEvent(): void {
  notifyFullscreenListeners();
}

function attachFullscreenEvents(): void {
  if (listenersAttached || typeof document === 'undefined') return;
  listenersAttached = true;
  cachedActiveState = readActiveState();

  document.addEventListener('fullscreenchange', onBrowserFullscreenEvent);
  document.addEventListener('webkitfullscreenchange', onBrowserFullscreenEvent);
  document.addEventListener('mozfullscreenchange', onBrowserFullscreenEvent);
  document.addEventListener('MSFullscreenChange', onBrowserFullscreenEvent);
}

function detachFullscreenEvents(): void {
  if (!listenersAttached || typeof document === 'undefined') return;
  listenersAttached = false;

  document.removeEventListener('fullscreenchange', onBrowserFullscreenEvent);
  document.removeEventListener('webkitfullscreenchange', onBrowserFullscreenEvent);
  document.removeEventListener('mozfullscreenchange', onBrowserFullscreenEvent);
  document.removeEventListener('MSFullscreenChange', onBrowserFullscreenEvent);
}

/**
 * Subscribes to fullscreen change events.
 */
export function subscribeFullscreen(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    attachFullscreenEvents();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachFullscreenEvents();
    }
  };
}

export function getFullscreenSnapshot(): boolean {
  return cachedActiveState;
}

export function getFullscreenServerSnapshot(): boolean {
  return false;
}

/**
 * React hook for consuming fullscreen state and controls.
 */
export function useFullscreen(): {
  isFullscreen: boolean;
  isSupported: boolean;
  requestFullscreen: (targetElement?: Element | null) => Promise<boolean>;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: (targetElement?: Element | null) => Promise<boolean>;
} {
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    getFullscreenSnapshot,
    getFullscreenServerSnapshot
  );

  return {
    isFullscreen,
    isSupported: isFullscreenSupported(),
    requestFullscreen: requestAppFullscreen,
    exitFullscreen: exitAppFullscreen,
    toggleFullscreen: toggleAppFullscreen,
  };
}
