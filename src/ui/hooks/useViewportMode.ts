import { useSyncExternalStore } from 'react';
import { TouchMode } from '@/src/schemas/settings.schema';

export interface ViewportMetrics {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  isLandscape: boolean;
  isPortrait: boolean;
  isCoarsePointer: boolean;
  isCompactLandscape: boolean;
  shouldBlockPortrait: boolean;
}

const SERVER_VIEWPORT_SNAPSHOT: ViewportMetrics = {
  width: 1280,
  height: 720,
  offsetTop: 0,
  offsetLeft: 0,
  isLandscape: true,
  isPortrait: false,
  isCoarsePointer: false,
  isCompactLandscape: false,
  shouldBlockPortrait: false,
};

function readViewportMetrics(): ViewportMetrics {
  if (typeof window === 'undefined') {
    return SERVER_VIEWPORT_SNAPSHOT;
  }

  const vv = window.visualViewport;
  const innerW = Math.max(1, Math.round(window.innerWidth || 1280));
  const innerH = Math.max(1, Math.round(window.innerHeight || 720));
  const width = Math.max(1, Math.round(vv ? Math.min(innerW, vv.width) : innerW));
  const height = Math.max(1, Math.round(vv ? Math.min(innerH, vv.height) : innerH));
  const offsetTop = Math.max(0, Math.round(vv?.offsetTop ?? 0));
  const offsetLeft = Math.max(0, Math.round(vv?.offsetLeft ?? 0));
  const isPortrait = height > width;
  const isLandscape = !isPortrait;
  const isCoarsePointer = Boolean(
    window.matchMedia?.('(pointer: coarse)')?.matches ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && Math.max(width, height) <= 1366)
  );
  const isCompactLandscape = isLandscape && (height <= 540 || (isCoarsePointer && width <= 1024));
  // Trigger portrait rotation gate on mobile/phone portrait viewports without locking out desktop split-pane previews
  const shouldBlockPortrait = isPortrait && (isCoarsePointer || width <= 460);

  return {
    width,
    height,
    offsetTop,
    offsetLeft,
    isLandscape,
    isPortrait,
    isCoarsePointer,
    isCompactLandscape,
    shouldBlockPortrait,
  };
}

function shallowEqualViewport(a: ViewportMetrics, b: ViewportMetrics): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.offsetTop === b.offsetTop &&
    a.offsetLeft === b.offsetLeft &&
    a.isLandscape === b.isLandscape &&
    a.isPortrait === b.isPortrait &&
    a.isCoarsePointer === b.isCoarsePointer &&
    a.isCompactLandscape === b.isCompactLandscape &&
    a.shouldBlockPortrait === b.shouldBlockPortrait
  );
}

const listeners = new Set<() => void>();
let currentSnapshot: ViewportMetrics = readViewportMetrics();
let rafId = 0;
let settleTimer = 0;
let listenersAttached = false;

function syncViewportSnapshot(): void {
  const next = readViewportMetrics();
  if (!shallowEqualViewport(currentSnapshot, next)) {
    currentSnapshot = next;
    for (const listener of listeners) {
      listener();
    }
  }
}

function scheduleViewportUpdate(): void {
  if (typeof window === 'undefined') return;
  if (!rafId) {
    if (typeof window.requestAnimationFrame === 'function') {
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        syncViewportSnapshot();
      });
    } else {
      syncViewportSnapshot();
    }
  }
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    settleTimer = 0;
    syncViewportSnapshot();
  }, 120);
}

function attachGlobalListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  window.addEventListener('resize', scheduleViewportUpdate);
  window.addEventListener('orientationchange', scheduleViewportUpdate);
  window.visualViewport?.addEventListener('resize', scheduleViewportUpdate);
  window.visualViewport?.addEventListener('scroll', scheduleViewportUpdate);
}

function detachGlobalListeners(): void {
  if (!listenersAttached || typeof window === 'undefined') return;
  listenersAttached = false;
  if (rafId) {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (settleTimer) {
    window.clearTimeout(settleTimer);
    settleTimer = 0;
  }
  window.removeEventListener('resize', scheduleViewportUpdate);
  window.removeEventListener('orientationchange', scheduleViewportUpdate);
  window.visualViewport?.removeEventListener('resize', scheduleViewportUpdate);
  window.visualViewport?.removeEventListener('scroll', scheduleViewportUpdate);
}

function subscribeViewport(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    // Re-read synchronously on first mount (important in tests mutating window.innerWidth)
    const fresh = readViewportMetrics();
    if (!shallowEqualViewport(currentSnapshot, fresh)) {
      currentSnapshot = fresh;
    }
    attachGlobalListeners();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachGlobalListeners();
    }
  };
}

function getViewportSnapshot(): ViewportMetrics {
  return currentSnapshot;
}

function getViewportServerSnapshot(): ViewportMetrics {
  return SERVER_VIEWPORT_SNAPSHOT;
}

export function resolveTouchControlsVisible(
  touchMode: TouchMode,
  touchHudOverride: boolean | null,
  viewport: ViewportMetrics
): boolean {
  if (touchHudOverride !== null) return touchHudOverride;
  if (touchMode === 'always_on') return true;
  if (touchMode === 'always_off') return false;
  return viewport.isCoarsePointer;
}

export function useViewportMode(): ViewportMetrics {
  return useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportServerSnapshot
  );
}

