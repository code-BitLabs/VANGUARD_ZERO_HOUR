import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { isDeveloperModeActiveForSetting } from '@/src/config/devMode';
import { settingsStore } from './settingsStore';

export type ScreenState =
  | 'title'
  | 'campaign'
  | 'armory'
  | 'settings'
  | 'howToPlay'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'debrief';

export interface ToastNotice {
  id: number;
  title: string;
  description?: string;
  variant: 'info' | 'warning' | 'error' | 'success';
}

export interface UIStoreState {
  screen: ScreenState;
  previousMenuScreen: 'title' | 'campaign' | 'paused';
  pointerLocked: boolean;
  diagnosticsOpen: boolean;
  combatDebugOpen: boolean;
  combatDebugCollapsed: boolean;
  debugSimPaused: boolean;
  contextLost: boolean;
  isPortraitBlocked: boolean;
  touchHudOverride: boolean | null;
  tacticalOverviewOpen: boolean;
  tacticalKitOpen: boolean;
  toast: ToastNotice | null;
  setScreen: (screen: ScreenState) => void;
  openSettingsFrom: (from: 'title' | 'campaign' | 'paused') => void;
  openHowToPlayFrom: (from: 'title' | 'campaign' | 'paused') => void;
  setPointerLocked: (locked: boolean) => void;
  setPortraitBlocked: (blocked: boolean) => void;
  setTouchHudOverride: (override: boolean | null) => void;
  toggleTouchHudOverride: (currentlyVisible: boolean) => void;
  setTacticalOverviewOpen: (open: boolean) => void;
  toggleTacticalOverview: () => void;
  setTacticalKitOpen: (open: boolean) => void;
  toggleDiagnostics: () => void;
  setCombatDebugOpen: (open: boolean) => void;
  toggleCombatDebug: () => void;
  setCombatDebugCollapsed: (collapsed: boolean) => void;
  toggleCombatDebugCollapsed: () => void;
  setDebugSimPaused: (paused: boolean) => void;
  toggleDebugSimPaused: () => void;
  syncDevModePolicy: () => void;
  setContextLost: (lost: boolean) => void;
  showToast: (title: string, description?: string, variant?: ToastNotice['variant']) => void;
  clearToast: () => void;
}

let toastSeq = 0;

function isDeveloperModeActive(): boolean {
  return isDeveloperModeActiveForSetting(settingsStore.getState().developer.devModeEnabled);
}

export const uiStore = createStore<UIStoreState>()(
  subscribeWithSelector((set, get) => ({
    screen: 'title',
    previousMenuScreen: 'title',
    pointerLocked: false,
    diagnosticsOpen: false,
    combatDebugOpen: isDeveloperModeActive()
      ? settingsStore.getState().developer.combatDebugOverlay
      : false,
    combatDebugCollapsed: settingsStore.getState().developer.combatDebugCollapsed,
    debugSimPaused: false,
    contextLost: false,
    isPortraitBlocked: false,
    touchHudOverride: null,
    tacticalOverviewOpen: false,
    tacticalKitOpen: false,
    toast: null,
    setScreen: (screen) =>
      set((s) => ({
        screen,
        tacticalOverviewOpen: screen === 'playing' ? s.tacticalOverviewOpen : false,
        tacticalKitOpen: screen === 'playing' ? s.tacticalKitOpen : false,
      })),
    openSettingsFrom: (from) =>
      set({
        previousMenuScreen: from,
        screen: 'settings',
        tacticalOverviewOpen: false,
        tacticalKitOpen: false,
      }),
    openHowToPlayFrom: (from) =>
      set({
        previousMenuScreen: from,
        screen: 'howToPlay',
        tacticalOverviewOpen: false,
        tacticalKitOpen: false,
      }),
    setPointerLocked: (pointerLocked) => set({ pointerLocked }),
    setPortraitBlocked: (isPortraitBlocked) => set({ isPortraitBlocked }),
    setTouchHudOverride: (touchHudOverride) => set({ touchHudOverride }),
    toggleTouchHudOverride: (currentlyVisible) => set({ touchHudOverride: !currentlyVisible }),
    setTacticalOverviewOpen: (tacticalOverviewOpen) =>
      set((s) => ({
        tacticalOverviewOpen,
        tacticalKitOpen: tacticalOverviewOpen ? false : s.tacticalKitOpen,
      })),
    toggleTacticalOverview: () =>
      set((s) => {
        const next = !s.tacticalOverviewOpen;
        return {
          tacticalOverviewOpen: next,
          tacticalKitOpen: next ? false : s.tacticalKitOpen,
        };
      }),
    setTacticalKitOpen: (tacticalKitOpen) =>
      set((s) => ({
        tacticalKitOpen,
        tacticalOverviewOpen: tacticalKitOpen ? false : s.tacticalOverviewOpen,
      })),
    toggleDiagnostics: () => {
      if (!isDeveloperModeActive()) {
        set({ diagnosticsOpen: false });
        return;
      }
      set((s) => ({ diagnosticsOpen: !s.diagnosticsOpen }));
    },
    setCombatDebugOpen: (open) => {
      if (!isDeveloperModeActive()) {
        set({ combatDebugOpen: false, diagnosticsOpen: false, debugSimPaused: false });
        return;
      }
      set(open ? { combatDebugOpen: true } : { combatDebugOpen: false, debugSimPaused: false });
      if (settingsStore.getState().developer.combatDebugOverlay !== open) {
        settingsStore.getState().updateDeveloper({ combatDebugOverlay: open });
      }
    },
    toggleCombatDebug: () => {
      if (!isDeveloperModeActive()) {
        set({ combatDebugOpen: false, diagnosticsOpen: false, debugSimPaused: false });
        return;
      }
      const next = !get().combatDebugOpen;
      set(next ? { combatDebugOpen: true } : { combatDebugOpen: false, debugSimPaused: false });
      if (settingsStore.getState().developer.combatDebugOverlay !== next) {
        settingsStore.getState().updateDeveloper({ combatDebugOverlay: next });
      }
    },
    setCombatDebugCollapsed: (collapsed) => {
      if (!isDeveloperModeActive()) return;
      set({ combatDebugCollapsed: collapsed });
      if (settingsStore.getState().developer.combatDebugCollapsed !== collapsed) {
        settingsStore.getState().updateDeveloper({ combatDebugCollapsed: collapsed });
      }
    },
    toggleCombatDebugCollapsed: () => {
      if (!isDeveloperModeActive()) return;
      const next = !get().combatDebugCollapsed;
      set({ combatDebugCollapsed: next });
      if (settingsStore.getState().developer.combatDebugCollapsed !== next) {
        settingsStore.getState().updateDeveloper({ combatDebugCollapsed: next });
      }
    },
    setDebugSimPaused: (debugSimPaused) => {
      if (!isDeveloperModeActive()) {
        set({ debugSimPaused: false });
        return;
      }
      set({ debugSimPaused });
    },
    toggleDebugSimPaused: () => {
      if (!isDeveloperModeActive()) {
        set({ debugSimPaused: false });
        return;
      }
      set((s) => ({ debugSimPaused: !s.debugSimPaused }));
    },
    syncDevModePolicy: () => {
      if (!isDeveloperModeActive()) {
        set({ combatDebugOpen: false, diagnosticsOpen: false, debugSimPaused: false });
      }
    },
    setContextLost: (contextLost) => set({ contextLost }),
    showToast: (title, description, variant = 'info') =>
      set({ toast: { id: ++toastSeq, title, description, variant } }),
    clearToast: () => set({ toast: null }),
  }))
);

// Keep uiStore synchronized if settingsStore.developer debug flags change directly
settingsStore.subscribe(
  (s) => s.developer.combatDebugOverlay,
  (combatDebugOverlay) => {
    const allowed = isDeveloperModeActive();
    const targetOpen = allowed ? combatDebugOverlay : false;
    if (uiStore.getState().combatDebugOpen !== targetOpen) {
      uiStore.setState(
        targetOpen
          ? { combatDebugOpen: true }
          : { combatDebugOpen: false, debugSimPaused: false }
      );
    }
  }
);
settingsStore.subscribe(
  (s) => s.developer.combatDebugCollapsed,
  (combatDebugCollapsed) => {
    if (uiStore.getState().combatDebugCollapsed !== combatDebugCollapsed) {
      uiStore.setState({ combatDebugCollapsed });
    }
  }
);
settingsStore.subscribe(
  (s) => s.developer.devModeEnabled,
  (devModeEnabled) => {
    if (!isDeveloperModeActiveForSetting(devModeEnabled)) {
      uiStore.setState({
        combatDebugOpen: false,
        diagnosticsOpen: false,
        debugSimPaused: false,
      });
    } else {
      const wantOpen = settingsStore.getState().developer.combatDebugOverlay;
      uiStore.setState({ combatDebugOpen: wantOpen });
    }
  }
);

export function useUIStore<T>(selector: (state: UIStoreState) => T): T {
  return useStore(uiStore, selector);
}

