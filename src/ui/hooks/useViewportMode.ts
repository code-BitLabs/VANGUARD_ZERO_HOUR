import { useEffect, useState } from 'react';
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

function readViewportMetrics(): ViewportMetrics {
  if (typeof window === 'undefined') {
    return {
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
  // Trigger portrait rotation gate on mobile/narrow portrait viewports (e.g., 390x844 phones or coarse portrait tablets)
  const shouldBlockPortrait = isPortrait && (isCoarsePointer || width <= 640);

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
  const [metrics, setMetrics] = useState<ViewportMetrics>(() => readViewportMetrics());

  useEffect(() => {
    let rafId = 0;
    let settleTimer = 0;

    const update = () => {
      setMetrics(readViewportMetrics());
    };

    const scheduleUpdate = () => {
      update();
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(update);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(update, 120);
    };

    update();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('orientationchange', scheduleUpdate);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('scroll', scheduleUpdate);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', scheduleUpdate);
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('scroll', scheduleUpdate);
    };
  }, []);

  return metrics;
}
