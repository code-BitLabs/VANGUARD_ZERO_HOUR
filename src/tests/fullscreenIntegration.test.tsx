/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  isFullscreenSupported,
  isFullscreenActive,
  requestAppFullscreen,
  exitAppFullscreen,
  toggleAppFullscreen,
  useFullscreen,
} from '@/src/utils/fullscreen';

describe('Fullscreen API Utility & Hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects fullscreen support when document methods are present', () => {
    const supported = isFullscreenSupported();
    expect(typeof supported).toBe('boolean');
  });

  it('detects active fullscreen correctly when fullscreenElement is set', () => {
    expect(isFullscreenActive()).toBe(false);

    const fakeDiv = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', {
      value: fakeDiv,
      configurable: true,
      writable: true,
    });

    expect(isFullscreenActive()).toBe(true);

    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true,
    });

    expect(isFullscreenActive()).toBe(false);
  });

  it('handles requestFullscreen rejection gracefully without throwing', async () => {
    const fakeElement = document.createElement('div');
    fakeElement.requestFullscreen = vi.fn().mockRejectedValue(new Error('Fullscreen denied'));

    const result = await requestAppFullscreen(fakeElement);
    expect(result).toBe(false);
  });

  it('attempts landscape orientation lock when fullscreen succeeds and API is available', async () => {
    const fakeElement = document.createElement('div');
    fakeElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);

    const mockLock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'screen', {
      value: {
        orientation: {
          lock: mockLock,
          unlock: vi.fn(),
        },
      },
      configurable: true,
      writable: true,
    });

    const result = await requestAppFullscreen(fakeElement);
    expect(result).toBe(true);
    expect(mockLock).toHaveBeenCalledWith('landscape');
  });

  it('exits fullscreen cleanly when exitAppFullscreen is called while active', async () => {
    const fakeDiv = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', {
      value: fakeDiv,
      configurable: true,
      writable: true,
    });

    const exitMock = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = exitMock;

    await exitAppFullscreen();
    expect(exitMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true,
    });
  });

  it('toggles fullscreen state from inactive to active', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true,
    });

    const fakeDiv = document.createElement('div');
    fakeDiv.requestFullscreen = vi.fn().mockResolvedValue(undefined);

    const result = await toggleAppFullscreen(fakeDiv);
    expect(result).toBe(true);
    expect(fakeDiv.requestFullscreen).toHaveBeenCalled();
  });

  it('useFullscreen hook provides reactive isFullscreen and toggle handlers', async () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(false);
    expect(typeof result.current.toggleFullscreen).toBe('function');
    expect(typeof result.current.requestFullscreen).toBe('function');
    expect(typeof result.current.exitFullscreen).toBe('function');

    // Simulate fullscreenchange event
    act(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('div'),
        configurable: true,
        writable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.isFullscreen).toBe(true);

    act(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        configurable: true,
        writable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.isFullscreen).toBe(false);
  });
});
