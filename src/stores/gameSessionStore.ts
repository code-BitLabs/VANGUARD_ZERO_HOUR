import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { CombatDebugSnapshot } from '@/src/gameplay/CombatTelemetryRecorder';
import { AssetLoadProgress } from '@/src/schemas/asset.schema';
import { DamageArc, HitFeedback, HudSnapshot, KillFeedItem } from '@/src/schemas/events.schema';
import { MissionResultPayload } from './progressionStore';

export interface DebriefSummary extends MissionResultPayload {
  accuracyPct: number;
  newAchievements: string[];
}

export interface EngineDiagnosticsSnapshot {
  fps: number;
  frameMs: number;
  physicsMs: number;
  aiMs: number;
  gameplayMs: number;
  renderSubmitMs: number;
  drawCalls: number;
  triangles: number;
  activeGeometries: number;
  activeTextures: number;
  activeSharedRes: number;
  activeMissionRes: number;
  activePooledVfx: number;
  activeAudioVoices: number;
  activeEnemies: number;
  renderScale: number;
  governorTier: string;
}

export interface GameSessionState {
  hud: HudSnapshot;
  killFeed: KillFeedItem[];
  hitFeedback: HitFeedback | null;
  damageArcs: DamageArc[];
  loadProgress: AssetLoadProgress;
  debrief: DebriefSummary | null;
  diagnostics: EngineDiagnosticsSnapshot;
  combatDebug: CombatDebugSnapshot | null;
  updateHudSnapshot: (snapshot: HudSnapshot) => void;
  pushKillFeed: (item: KillFeedItem) => void;
  triggerHit: (isHeadshot: boolean, isKill: boolean, damage: number) => void;
  pushDamageArc: (angleRad: number, intensity: number) => void;
  decayDamageArcs: () => void;
  setLoadProgress: (progress: AssetLoadProgress) => void;
  setDebrief: (debrief: DebriefSummary | null) => void;
  updateDiagnostics: (diag: EngineDiagnosticsSnapshot) => void;
  updateCombatDebug: (snapshot: CombatDebugSnapshot | null) => void;
  resetSession: () => void;
}

const DEFAULT_HUD: HudSnapshot = {
  health: 100,
  maxHealth: 100,
  armor: 100,
  maxArmor: 100,
  weaponId: 'assault_rifle',
  weaponName: 'M416-V Tactical Carbine',
  fireMode: 'auto',
  ammoInMag: 30,
  magSize: 30,
  reserveAmmo: 180,
  grenades: 3,
  isReloading: false,
  reloadProgress: 0,
  isAds: false,
  isScoped: false,
  isSprinting: false,
  isCrouching: false,
  isSliding: false,
  crosshairSpread: 0.02,
  playerX: 0,
  playerZ: 0,
  playerYaw: 0,
  inVehicle: false,
  vehicleName: '',
  vehicleHealth: 100,
  vehicleMaxHealth: 100,
  vehicleSpeedKmh: 0,
  interactPrompt: null,
  subtitleText: null,
  missionAlert: null,
  elapsedSec: 0,
  score: 0,
  kills: 0,
  headshots: 0,
  shotsFired: 0,
  shotsHit: 0,
  lockOn: { status: 'none', progress: 0, targetLabel: '' },
  objectives: [],
  blips: [],
  activeBossLabel: null,
  activeBossHealthPct: 0,
};

const DEFAULT_DIAG: EngineDiagnosticsSnapshot = {
  fps: 60,
  frameMs: 16.6,
  physicsMs: 0,
  aiMs: 0,
  gameplayMs: 0,
  renderSubmitMs: 0,
  drawCalls: 0,
  triangles: 0,
  activeGeometries: 0,
  activeTextures: 0,
  activeSharedRes: 0,
  activeMissionRes: 0,
  activePooledVfx: 0,
  activeAudioVoices: 0,
  activeEnemies: 0,
  renderScale: 1,
  governorTier: 'high',
};

let hitSeq = 0;
let arcSeq = 0;

export const gameSessionStore = createStore<GameSessionState>()(
  subscribeWithSelector((set) => ({
    hud: DEFAULT_HUD,
    killFeed: [],
    hitFeedback: null,
    damageArcs: [],
    loadProgress: { loaded: 0, total: 1, currentAsset: 'Initializing', percent: 0, usedFallbackCount: 0 },
    debrief: null,
    diagnostics: DEFAULT_DIAG,
    combatDebug: null,
    updateHudSnapshot: (hud) => set({ hud }),
    pushKillFeed: (item) =>
      set((s) => ({
        killFeed: [item, ...s.killFeed].slice(0, 5),
      })),
    triggerHit: (isHeadshot, isKill, damage) =>
      set({ hitFeedback: { id: ++hitSeq, isHeadshot, isKill, damage } }),
    pushDamageArc: (angleRad, intensity) =>
      set((s) => ({
        damageArcs: [...s.damageArcs.slice(-3), { id: ++arcSeq, angleRad, intensity }],
      })),
    decayDamageArcs: () =>
      set((s) => {
        if (s.damageArcs.length === 0) return s;
        const next = s.damageArcs
          .map((a) => ({ ...a, intensity: a.intensity - 0.08 }))
          .filter((a) => a.intensity > 0.05);
        return { damageArcs: next };
      }),
    setLoadProgress: (loadProgress) => set({ loadProgress }),
    setDebrief: (debrief) => set({ debrief }),
    updateDiagnostics: (diagnostics) => set({ diagnostics }),
    updateCombatDebug: (combatDebug) => set({ combatDebug }),
    resetSession: () =>
      set({
        hud: DEFAULT_HUD,
        killFeed: [],
        hitFeedback: null,
        damageArcs: [],
        debrief: null,
        combatDebug: null,
      }),
  }))
);

export function useGameSessionStore<T>(selector: (state: GameSessionState) => T): T {
  return useStore(gameSessionStore, selector);
}

