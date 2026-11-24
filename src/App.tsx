import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import type { GameEngine } from '@/src/engine/GameEngine';
import type { InputManager } from '@/src/engine/InputManager';
import { DeploymentMode } from '@/src/schemas/campaign.schema';
import { Difficulty } from '@/src/schemas/common.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { SquadCommandSource, SquadOrderType } from '@/src/gameplay/squad/SquadIntentRouter';
import { missionSelectionStore, useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { progressionStore, useProgressionStore } from '@/src/stores/progressionStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { uiStore, useUIStore } from '@/src/stores/uiStore';
import { resolveTouchControlsVisible, useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { ErrorBoundary } from '@/src/ui/primitives/ErrorBoundary';
import { ToastAndRecoveryLayer } from '@/src/ui/screens/ToastAndRecoveryLayer';
import { TitleScreen } from '@/src/ui/screens/TitleScreen';

const GameHUD = React.lazy(() =>
  import('@/src/ui/hud/GameHUD').then((m) => ({ default: m.GameHUD }))
);
const MissionIntroOverlay = React.lazy(() =>
  import('@/src/ui/components/MissionIntroOverlay').then((m) => ({ default: m.MissionIntroOverlay }))
);

const LoadingOverlay = React.lazy(() =>
  import('@/src/ui/screens/Overlays').then((m) => ({ default: m.LoadingOverlay }))
);
const PauseOverlay = React.lazy(() =>
  import('@/src/ui/screens/Overlays').then((m) => ({ default: m.PauseOverlay }))
);
const DebriefScreen = React.lazy(() =>
  import('@/src/ui/screens/Overlays').then((m) => ({ default: m.DebriefScreen }))
);
const CombatDebugOverlay = React.lazy(() =>
  import('@/src/ui/debug/CombatDebugOverlay').then((m) => ({ default: m.CombatDebugOverlay }))
);
const CampaignScreen = React.lazy(() =>
  import('@/src/ui/screens/CampaignScreen').then((m) => ({ default: m.CampaignScreen }))
);
const ArmoryScreen = React.lazy(() =>
  import('@/src/ui/screens/ArmoryScreen').then((m) => ({ default: m.ArmoryScreen }))
);
const SettingsPanel = React.lazy(() =>
  import('@/src/ui/components/SettingsPanel').then((m) => ({ default: m.SettingsPanel }))
);
const HowToPlayModal = React.lazy(() =>
  import('@/src/ui/screens/HowToPlayModal').then((m) => ({ default: m.HowToPlayModal }))
);

function MenuSuspenseFallback() {
  return (
    <div className="fixed inset-0 z-20 bg-[#0B0E11]/90 flex items-center justify-center font-mono text-xs uppercase tracking-widest text-amber-400">
      Loading Tactical Module...
    </div>
  );
}

export default function App() {
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [inputManager, setInputManager] = useState<InputManager | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  const screen = useUIStore((s) => s.screen);
  const previousMenuScreen = useUIStore((s) => s.previousMenuScreen);
  const diagnosticsOpen = useUIStore((s) => s.diagnosticsOpen);
  const combatDebugOpen = useUIStore((s) => s.combatDebugOpen);
  const touchHudOverride = useUIStore((s) => s.touchHudOverride);
  const devModeEnabled = useSettingsStore((s) => s.developer.devModeEnabled);
  const touchMode = useSettingsStore((s) => s.input.touchMode);
  const colorblindMode = useSettingsStore((s) => s.accessibility.colorblindMode);
  const highContrastBorders = useSettingsStore((s) => s.accessibility.highContrastBorders);
  const reducedMotion = useSettingsStore((s) => s.accessibility.reducedMotion);
  const largeTextMode = useSettingsStore((s) => s.accessibility.largeTextMode);
  const uiScale = useSettingsStore((s) => s.display.uiScale);
  const devModeActive = isEnvDevModeAllowed() && devModeEnabled;
  const [deploymentKey, setDeploymentKey] = useState(0);
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);
  const difficulty = useMissionSelectionStore((s) => s.difficulty);
  const activeModifiers = useProgressionStore((s) => s.save.activeModifiers ?? []);

  // Sync accessibility modes and typography scale globally onto documentElement
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.colorblind = colorblindMode;
    root.dataset.highContrast = highContrastBorders ? 'true' : 'false';
    root.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
    root.style.setProperty('--vg-ui-scale', String(largeTextMode ? 1.12 : uiScale));
  }, [colorblindMode, highContrastBorders, reducedMotion, largeTextMode, uiScale]);

  const viewport = useViewportMode();
  const [portraitGateDismissed, setPortraitGateDismissed] = useState(false);
  const touchControlsVisible = resolveTouchControlsVisible(touchMode, touchHudOverride, viewport);
  const screenRequiresLandscape =
    screen === 'loading' || screen === 'playing' || screen === 'paused';
  const effectivePortraitBlocked =
    screenRequiresLandscape && viewport.shouldBlockPortrait && !portraitGateDismissed;

  useEffect(() => {
    if (!viewport.shouldBlockPortrait && portraitGateDismissed) {
      setPortraitGateDismissed(false);
    }
  }, [viewport.shouldBlockPortrait, portraitGateDismissed]);

  // Auto-pause active combat if the player rotates into portrait mid-firefight
  useEffect(() => {
    if (screen === 'playing' && viewport.shouldBlockPortrait && !portraitGateDismissed) {
      engineRef.current?.pauseMission();
    }
  }, [screen, viewport.shouldBlockPortrait, portraitGateDismissed]);

  const enginePromiseRef = useRef<Promise<GameEngine | null> | null>(null);
  const ensureEngineRef = useRef<(() => Promise<GameEngine | null>) | null>(null);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    let cancelled = false;
    let mountedEngine: GameEngine | null = null;
    let idleTimerId: number | null = null;
    let idleCallbackId: number | null = null;
    const onResize = () => {
      mountedEngine?.resize();
    };
    window.addEventListener('resize', onResize);

    if (progressionStore.getState().recoveredFromCorruption) {
      uiStore
        .getState()
        .showToast(
          'Save Recovery Active',
          'Corrupted profile slot was restored from backup.',
          'warning'
        );
    }

    const ensureEngine = (): Promise<GameEngine | null> => {
      if (engineRef.current) return Promise.resolve(engineRef.current);
      if (enginePromiseRef.current) return enginePromiseRef.current;

      const promise = (async (): Promise<GameEngine | null> => {
        try {
          const { GameEngine: EngineCtor } = await import('@/src/engine/GameEngine');
          if (cancelled || !canvasContainerRef.current) return null;
          const engine = new EngineCtor(canvasContainerRef.current);
          mountedEngine = engine;
          engineRef.current = engine;
          setInputManager(engine.getInputManager());
          return engine;
        } catch (err) {
          if (!cancelled) {
            setEngineError(err instanceof Error ? err.message : 'WebGL initialization failed.');
          }
          return null;
        }
      })();
      enginePromiseRef.current = promise;
      return promise;
    };

    ensureEngineRef.current = ensureEngine;

    // Defer heavy 3D engine initialization until after TitleScreen first paint
    const winWithIdle = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof winWithIdle.requestIdleCallback === 'function') {
      idleCallbackId = winWithIdle.requestIdleCallback(
        () => {
          if (!cancelled) void ensureEngine();
        },
        { timeout: 600 }
      );
    } else {
      idleTimerId = window.setTimeout(() => {
        if (!cancelled) void ensureEngine();
      }, 150);
    }

    return () => {
      cancelled = true;
      if (idleCallbackId !== null && typeof winWithIdle.cancelIdleCallback === 'function') {
        winWithIdle.cancelIdleCallback(idleCallbackId);
      }
      if (idleTimerId !== null) {
        window.clearTimeout(idleTimerId);
      }
      window.removeEventListener('resize', onResize);
      setInputManager(null);
      mountedEngine?.dispose();
      engineRef.current = null;
      enginePromiseRef.current = null;
      ensureEngineRef.current = null;
    };
  }, []);

  // Ensure engine is initialized immediately when navigating beyond TitleScreen (e.g. Campaign, Settings, Armory)
  useEffect(() => {
    if (screen !== 'title' && !engineRef.current && ensureEngineRef.current) {
      void ensureEngineRef.current();
    }
  }, [screen]);

  useEffect(() => {
    if (devModeActive && diagnosticsOpen) {
      void import('@/src/ui/widgets/VanguardPerfPanel');
    }
  }, [devModeActive, diagnosticsOpen]);

  // Re-sync renderer canvas whenever settled viewport / visualViewport dimensions change
  useEffect(() => {
    engineRef.current?.resize();
  }, [viewport.width, viewport.height]);

  // Portrait orientation gate: auto-pause active combat & release held inputs
  useEffect(() => {
    uiStore.getState().setPortraitBlocked(effectivePortraitBlocked);
    if (effectivePortraitBlocked) {
      engineRef.current?.getInputManager().clearAllInputs();
      if (uiStore.getState().screen === 'playing') {
        engineRef.current?.pauseMission();
      }
    }
  }, [effectivePortraitBlocked]);

  const handleDeploy = useCallback(
    (missionId: number, diff: Difficulty, weaponId?: WeaponId, mode?: DeploymentMode) => {
      const selection = missionSelectionStore.getState();
      if (selection.selectedMissionId !== missionId) {
        selection.setSelectedMission(missionId);
      }
      if (selection.difficulty !== diff) {
        selection.setDifficulty(diff);
      }
      const resolvedMode =
        mode ?? missionSelectionStore.getState().getDeploymentModeForMission(missionId);
      setDeploymentKey((k) => k + 1);
      if (engineRef.current) {
        void engineRef.current.startMission(missionId, diff, weaponId, resolvedMode);
      } else {
        const loader = ensureEngineRef.current
          ? ensureEngineRef.current()
          : enginePromiseRef.current;
        if (loader) {
          void loader.then((eng) => {
            if (eng) void eng.startMission(missionId, diff, weaponId, resolvedMode);
          });
        }
      }
    },
    []
  );

  const handleUiClick = useCallback(() => {
    engineRef.current?.playUiSound();
  }, []);

  const handleRequestPointerLock = useCallback(() => {
    engineRef.current?.requestPointerLock();
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.pauseMission();
  }, []);

  const handleRestartCheckpoint = useCallback(() => {
    engineRef.current?.restartCheckpoint();
  }, []);

  const handleRestartMission = useCallback(() => {
    const sel = missionSelectionStore.getState();
    handleDeploy(sel.selectedMissionId, sel.difficulty);
  }, [handleDeploy]);

  const handleAbort = useCallback(() => {
    engineRef.current?.abortToMenu('campaign');
  }, []);

  const handleIssueSquadCommand = useCallback(
    (order: SquadOrderType, source: SquadCommandSource, opId?: string) => {
      engineRef.current?.issueSquadCommand(order, source, opId);
    },
    []
  );

  const handleSwapFieldWeapon = useCallback((slotIdx: number, weaponId: WeaponId) => {
    engineRef.current?.swapFieldWeapon(slotIdx, weaponId);
  }, []);

  const handleTriggerSoloSelfRecovery = useCallback(() => {
    return engineRef.current?.triggerSoloSelfRecovery();
  }, []);

  const getQualityTelemetry = useCallback(() => {
    return engineRef.current?.getQualityTelemetry() ?? null;
  }, []);

  return (
    <ErrorBoundary>
      <div className="relative w-full h-[100dvh] overflow-hidden bg-[#0B0E11] select-none">
          {/* Isolated WebGL Three.js Canvas Sibling */}
          <div
            ref={canvasContainerRef}
            className="fixed inset-0 z-0"
            onClick={() => {
              if (
                screen === 'playing' &&
                !touchControlsVisible &&
                !viewport.isCoarsePointer &&
                !engineRef.current?.getInputManager().isPointerLockBlocked()
              ) {
                engineRef.current?.requestPointerLock();
              }
            }}
          />

          {engineError && (
            <div className="fixed inset-0 z-50 bg-[#0B0E11] flex items-center justify-center p-6">
              <div className="max-w-md bg-[#141920] border border-red-500 p-6 rounded-sm text-zinc-100">
                <h2 className="font-display text-xl font-bold uppercase text-red-400">
                  3D Graphics Unavailable
                </h2>
                <p className="text-sm text-zinc-300 mt-2">{engineError}</p>
              </div>
            </div>
          )}

          {screen === 'title' && (
            <TitleScreen
              onQuickDeploy={() => handleDeploy(selectedMissionId, difficulty)}
              onUiClick={handleUiClick}
              hardwareBadge={null}
            />
          )}

          <Suspense fallback={<MenuSuspenseFallback />}>
            {screen === 'campaign' && (
              <CampaignScreen
                onDeploy={(mId, diff, mode) => handleDeploy(mId, diff, undefined, mode)}
                onUiClick={handleUiClick}
              />
            )}

            {screen === 'armory' && (
              <ArmoryScreen
                onDeployWithWeapon={(wId) => handleDeploy(selectedMissionId, difficulty, wId)}
                onUiClick={handleUiClick}
                isSoftwareGl={
                  engineRef.current?.getGpuCapabilityReport()?.hardwareProfile === 'software_webgl'
                }
                hardwareBadge={null}
              />
            )}

            {screen === 'settings' && (
              <SettingsPanel
                gpuReport={engineRef.current?.getGpuCapabilityReport() ?? null}
                qualityTelemetry={getQualityTelemetry()}
                onReapplyAutoGraphics={() => engineRef.current?.reapplyAutoGraphics() ?? null}
                onResumeAndTest={() => {
                  handleUiClick();
                  uiStore.getState().setScreen('paused');
                  engineRef.current?.resumeMission();
                }}
                onBack={() => {
                  handleUiClick();
                  uiStore.getState().setScreen(previousMenuScreen);
                }}
              />
            )}

            {screen === 'howToPlay' && (
              <HowToPlayModal
                onBack={() => {
                  handleUiClick();
                  uiStore.getState().setScreen(previousMenuScreen);
                }}
              />
            )}
          </Suspense>

          <Suspense fallback={null}>
            {screen === 'loading' && (
              <LoadingOverlay onCancel={() => engineRef.current?.cancelLoad()} />
            )}
          </Suspense>

          {screen === 'playing' && (
            <Suspense fallback={null}>
              <GameHUD
                onRequestPointerLock={handleRequestPointerLock}
                onPause={handlePause}
                onRestartCheckpoint={handleRestartCheckpoint}
                onRestartMission={handleRestartMission}
                onAbort={handleAbort}
                onIssueSquadCommand={handleIssueSquadCommand}
                onSwapFieldWeapon={handleSwapFieldWeapon}
                onTriggerSoloSelfRecovery={handleTriggerSoloSelfRecovery}
                inputManager={inputManager}
                touchControlsVisible={touchControlsVisible}
                qualityTelemetry={getQualityTelemetry()}
                getQualityTelemetry={getQualityTelemetry}
              />
              <MissionIntroOverlay
                missionId={selectedMissionId}
                difficulty={difficulty}
                activeModifiers={activeModifiers}
                deploymentKey={deploymentKey}
              />
            </Suspense>
          )}

          <Suspense fallback={null}>
            {screen === 'paused' && (
              <PauseOverlay
                onResume={() => engineRef.current?.resumeMission()}
                onRestartCheckpoint={handleRestartCheckpoint}
                onRestartMission={handleRestartMission}
                onAbort={handleAbort}
                gpuRenderer={engineRef.current?.getGpuCapabilityReport()?.signals.rendererHint ?? undefined}
              />
            )}

            {screen === 'debrief' && (
              <DebriefScreen
                onRestartCheckpoint={handleRestartCheckpoint}
                onRetry={() =>
                  handleDeploy(
                    missionSelectionStore.getState().selectedMissionId,
                    missionSelectionStore.getState().difficulty
                  )
                }
                onChangeDifficulty={(newDiff) => {
                  missionSelectionStore.getState().setDifficulty(newDiff);
                }}
                onNextMission={(nextId) =>
                  handleDeploy(nextId, missionSelectionStore.getState().difficulty)
                }
                onReturnMenu={handleAbort}
                gpuRenderer={engineRef.current?.getGpuCapabilityReport()?.signals.rendererHint ?? undefined}
              />
            )}
          </Suspense>

          {/* Optional isolated Web Component diagnostics panel, mounted only in Dev Mode on [F3] */}
          {devModeActive && diagnosticsOpen && React.createElement('vanguard-perf-panel')}

          {/* Developer Combat AI & Ballistics Debug Overlay, lazy-mounted only when [F4] is opened */}
          {devModeActive && combatDebugOpen && (
            <Suspense fallback={null}>
              <CombatDebugOverlay onRequestPointerLock={handleRequestPointerLock} />
            </Suspense>
          )}

          <ToastAndRecoveryLayer />

          {/* Portrait Orientation Enforcement Gate for Landscape Combat Modes Only */}
          {effectivePortraitBlocked && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Rotate Device to Landscape"
              data-testid="portrait-orientation-gate"
              className="fixed inset-0 z-[70] h-[100dvh] bg-[#0B0E11] flex flex-col items-center justify-center p-6 text-center"
              style={{
                paddingTop: 'max(24px, env(safe-area-inset-top, 0px))',
                paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
                paddingLeft: 'max(24px, env(safe-area-inset-left, 0px))',
                paddingRight: 'max(24px, env(safe-area-inset-right, 0px))',
              }}
            >
              <div className="max-w-sm w-full bg-[#141920] border border-amber-500/70 p-5 sm:p-6 rounded-sm space-y-3 shadow-2xl">
                <Smartphone className="w-10 h-10 text-amber-400 mx-auto rotate-90" />
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-amber-500">
                  Landscape Combat Required
                </p>
                <h2 className="font-display text-2xl font-bold uppercase text-white">
                  Rotate Device to Landscape
                </h2>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {screen === 'loading'
                    ? 'Operation deployment uses twin-stick landscape tactical controls. Rotate your phone sideways to enter combat.'
                    : 'Combat is paused while in portrait orientation. Rotate your phone sideways to resume twin-stick tactical controls.'}
                </p>
                <div className="pt-1 flex flex-col gap-2">
                  {!viewport.isCoarsePointer && (
                    <button
                      type="button"
                      data-testid="portrait-preview-continue"
                      onClick={() => setPortraitGateDismissed(true)}
                      className="w-full min-h-[44px] px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-display text-xs font-bold uppercase tracking-wider rounded-sm transition-colors cursor-pointer"
                    >
                      Continue in Narrow Preview
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="portrait-gate-escape-btn"
                    onClick={() => {
                      if (screen === 'loading') {
                        engineRef.current?.cancelLoad();
                      } else {
                        handleAbort();
                      }
                    }}
                    className="w-full min-h-[44px] px-4 py-2 bg-[#0B0E11] hover:bg-zinc-900 border border-zinc-700 text-zinc-200 font-mono text-xs uppercase tracking-wider rounded-sm transition-colors cursor-pointer"
                  >
                    {screen === 'loading' ? 'Cancel Deployment' : 'Return to HQ (Portrait Safe)'}
                  </button>
                </div>
              </div>
            </div>
          )}
      </div>
    </ErrorBoundary>
  );
}


