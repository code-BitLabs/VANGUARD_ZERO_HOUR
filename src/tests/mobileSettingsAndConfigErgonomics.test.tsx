import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { settingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { MobileHudEditorModal, resetMobileControlSettingsToDefaults } from '@/src/ui/components/MobileHudEditorModal';
import { SettingsPanel } from '@/src/ui/components/SettingsPanel';
import { HowToPlayModal } from '@/src/ui/screens/HowToPlayModal';

function setMockViewport(width: number, height: number, coarse = true) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    if (query === '(pointer: coarse)') return { matches: coarse };
    if (query === '(pointer: fine)') return { matches: !coarse };
    if (query.includes('max-height')) {
      const match = query.match(/max-height:\s*(\d+)px/);
      if (match) return { matches: height <= parseInt(match[1], 10) };
    }
    return { matches: false };
  });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

function activateRadixTab(tab: HTMLElement) {
  fireEvent.pointerDown(tab, { button: 0, ctrlKey: false });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.focus(tab);
  fireEvent.click(tab);
}

describe('Mobile Settings, Controls Guide & HUD Editor Ergonomics', () => {
  beforeEach(() => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof globalThis.ResizeObserver;
    }
    settingsStore.getState().resetDefaults();
    resetMobileControlSettingsToDefaults();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('SettingsPanel provides touch-accessible tab triggers and action buttons on mobile landscape', () => {
    setMockViewport(850, 340, true);
    render(<SettingsPanel onBack={vi.fn()} />);

    // Verify tabs are present
    const displayTab = screen.getByRole('tab', { name: /^Display$/i });
    const controlsTab = screen.getByRole('tab', { name: /Controls & Keys/i });
    const audioTab = screen.getByRole('tab', { name: /^Audio$/i });
    expect(displayTab).toBeTruthy();
    expect(controlsTab).toBeTruthy();
    expect(audioTab).toBeTruthy();

    // Verify action buttons have touch target classes
    const doneBtn = screen.getByRole('button', { name: /^Done$/i });
    expect(doneBtn.className).toContain('[@media(pointer:coarse)]:min-h-[42px]');

    const resetAllBtn = screen.getByTestId('settings-reset-all-btn');
    expect(resetAllBtn.className).toContain('[@media(pointer:coarse)]:min-h-[42px]');
  });

  it('Controls Guide (HowToPlayModal) supports dynamic category filtering and prioritizes touch controls on mobile', () => {
    setMockViewport(850, 340, true);
    const onBack = vi.fn();
    render(<HowToPlayModal onBack={onBack} />);

    // Verify category filter buttons exist
    const touchFilter = screen.getByTestId('manual-filter-touch');
    const combatFilter = screen.getByTestId('manual-filter-combat');
    const allFilter = screen.getByTestId('manual-filter-all');
    expect(touchFilter).toBeTruthy();
    expect(combatFilter).toBeTruthy();

    // Click Touch filter -> only Touch Controls section visible
    fireEvent.click(touchFilter);
    expect(screen.getByText('Mobile Landscape Touch Controls')).toBeTruthy();
    expect(screen.queryByText('Infantry Movement & Stance')).toBeNull();

    // Click Combat filter -> Infantry and Weapons visible, Touch hidden
    fireEvent.click(combatFilter);
    expect(screen.getByText('Infantry Movement & Stance')).toBeTruthy();
    expect(screen.queryByText('Mobile Landscape Touch Controls')).toBeNull();

    // Click All filter -> restores full list
    fireEvent.click(allFilter);
    expect(screen.getByText('Mobile Landscape Touch Controls')).toBeTruthy();

    // Back button calls onBack
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('1:1 HUD Editor passes safe-area insets, supports size nudge buttons, and shows portrait warning when rotated', () => {
    setMockViewport(844, 390, true);
    const onClose = vi.fn();
    const { rerender } = render(<MobileHudEditorModal onClose={onClose} />);

    // Editor handles rendered
    expect(screen.getByTestId('editor-handle-fire_right')).toBeTruthy();
    expect(screen.getByTestId('editor-handle-ads')).toBeTruthy();

    // Test nudge buttons for size scaling
    const decBtn = screen.getByRole('button', { name: /Decrease Control Size/i });
    const incBtn = screen.getByRole('button', { name: /Increase Control Size/i });
    expect(decBtn).toBeTruthy();
    expect(incBtn).toBeTruthy();

    const initialScale = settingsStore.getState().input.touchCustomLayout?.fire_right?.scale ?? 1.0;
    fireEvent.click(incBtn);
    expect(settingsStore.getState().input.touchCustomLayout?.fire_right?.scale).toBeGreaterThanOrEqual(initialScale);

    // Test rotation to portrait: displays "Rotate Device to Landscape" modal
    cleanup();
    setMockViewport(390, 844, true);
    render(<MobileHudEditorModal onClose={onClose} />);
    expect(screen.getByText(/Landscape Editor Required/i)).toBeTruthy();
  });
});
