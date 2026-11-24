import { useSyncExternalStore } from 'react';
import { TouchMode } from '@/src/schemas/settings.schema';

export interface ViewportMetrics {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
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
  safeTop: 0,
  safeRight: 0,
  safeBottom: 0,
  safeLeft: 0,
  isLandscape: true,
  isPortrait: false,
  isCoarsePointer: false,
  isCompactLandscape: false,
  shouldBlockPortrait: false,
};

let probeEl: HTMLDivElement | null = null;

function readSafeAreaInsets(): { top: number; right: number; bottom: number; left: number } {
  if (typeof document === 'undefined' || !document.body) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  try {
    if (!probeEl) {
      probeEl = document.createElement('div');
      probeEl.setAttribute('data-testid', 'safe-area-probe');
      probeEl.style.position = 'fixed';
      probeEl.style.top = '0';
      probeEl.style.left = '0';
      probeEl.style.width = '0';
      probeEl.style.height = '0';
      probeEl.style.visibility = 'hidden';
      probeEl.style.pointerEvents = 'none';
      probeEl.style.paddingTop = 'env(safe-area-inset-top, 0px)';
      probeEl.style.paddingRight = 'env(safe-area-inset-right, 0px)';
      probeEl.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
      probeEl.style.paddingLeft = 'env(safe-area-inset-left, 0px)';
      document.body.appendChild(probeEl);
    }
    const cs = window.getComputedStyle(probeEl);
    const parsePx = (v: string | null | undefined) => {
      if (!v) return 0;
      const n = parseFloat(v);
      return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    };
    return {
      top: parsePx(cs.paddingTop),
      right: parsePx(cs.paddingRight),
      bottom: parsePx(cs.paddingBottom),
      left: parsePx(cs.paddingLeft),
    };
  } catch {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
}

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

  const insets = readSafeAreaInsets();
  // On mobile landscape devices, ensure minimum ergonomic margins from bezels & system gesture bars
  const safeBottom = Math.max(insets.bottom, isCoarsePointer && isLandscape ? 14 : 0);
  const safeLeft = Math.max(insets.left, isCoarsePointer && isLandscape ? 12 : 0);
  const safeRight = Math.max(insets.right, isCoarsePointer && isLandscape ? 12 : 0);
  const safeTop = insets.top;

  return {
    width,
    height,
    offsetTop,
    offsetLeft,
    safeTop,
    safeRight,
    safeBottom,
    safeLeft,
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
    a.safeTop === b.safeTop &&
    a.safeRight === b.safeRight &&
    a.safeBottom === b.safeBottom &&
    a.safeLeft === b.safeLeft &&
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

