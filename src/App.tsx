import React, { Suspense, useEffect, useRef, useState } from 'react';
import { GameEngine } from '@/src/engine/GameEngine';
import { Difficulty } from '@/src/schemas/common.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { progressionStore } from '@/src/stores/progressionStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { uiStore, useUIStore } from '@/src/stores/uiStore';
import { GameHUD } from '@/src/ui/hud/GameHUD';
import { CombatDebugOverlay } from '@/src/ui/debug/CombatDebugOverlay';
import { ErrorBoundary } from '@/src/ui/primitives/ErrorBoundary';
import { TooltipProvider } from '@/src/ui/primitives/Controls';
import {
  DebriefScreen,
  LoadingOverlay,
  PauseOverlay,
  ToastAndRecoveryLayer,
} from '@/src/ui/screens/Overlays';
import { TitleScreen } from '@/src/ui/screens/TitleScreen';
import '@/src/ui/widgets/VanguardPerfPanel';

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
  const [engineError, setEngineError] = useState<string | null>(null);

  const screen = useUIStore((s) => s.screen);
  const previousMenuScreen = useUIStore((s) => s.previousMenuScreen);
  const diagnosticsOpen = useUIStore((s) => s.diagnosticsOpen);
  const devModeEnabled = useSettingsStore((s) => s.developer.devModeEnabled);
  const devModeActive = isEnvDevModeAllowed() && devModeEnabled;
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);
  const difficulty = useMissionSelectionStore((s) => s.difficulty);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    try {
      const engine = new GameEngine(container);
      engineRef.current = engine;

      const onResize = () => {
        engine.resize();
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

      return () => {
        window.removeEventListener('resize', onResize);
        engine.dispose();
        engineRef.current = null;
      };
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'WebGL initialization failed.');
    }
  }, []);

  const handleDeploy = (missionId: number, diff: Difficulty, weaponId?: WeaponId) => {
    void engineRef.current?.startMission(missionId, diff, weaponId);
  };

  const handleUiClick = () => {
    engineRef.current?.playUiSound();
  };

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <div className="relative w-full h-full overflow-hidden bg-[#0B0E11] select-none">
          {/* Isolated WebGL Three.js Canvas Sibling */}
          <div
            ref={canvasContainerRef}
            className="fixed inset-0 z-0"
            onClick={() => {
              if (screen === 'playing') {
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
              onQuickPlay={() => handleDeploy(selectedMissionId, difficulty)}
              onUiClick={handleUiClick}
            />
          )}

          <Suspense fallback={<MenuSuspenseFallback />}>
            {screen === 'campaign' && (
              <CampaignScreen
                onDeploy={(mId, diff) => handleDeploy(mId, diff)}
                onUiClick={handleUiClick}
              />
            )}

            {screen === 'armory' && (
              <ArmoryScreen
                onDeployWithWeapon={(wId) => handleDeploy(selectedMissionId, difficulty, wId)}
                onUiClick={handleUiClick}
              />
            )}

            {screen === 'settings' && (
              <SettingsPanel
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
                  uiStore.getState().setScreen('title');
                }}
              />
            )}
          </Suspense>

          {screen === 'loading' && (
            <LoadingOverlay onCancel={() => engineRef.current?.cancelLoad()} />
          )}

          {screen === 'playing' && (
            <GameHUD onRequestPointerLock={() => engineRef.current?.requestPointerLock()} />
          )}

          {screen === 'paused' && (
            <PauseOverlay
              onResume={() => engineRef.current?.resumeMission()}
              onRestartCheckpoint={() => engineRef.current?.restartCheckpoint()}
              onAbort={() => engineRef.current?.abortToMenu('campaign')}
            />
          )}

          {screen === 'debrief' && (
            <DebriefScreen
              onRetry={() => handleDeploy(selectedMissionId, difficulty)}
              onNextMission={(nextId) => handleDeploy(nextId, difficulty)}
              onReturnMenu={() => engineRef.current?.abortToMenu('campaign')}
            />
          )}

          {/* Optional isolated Web Component diagnostics panel, mounted only in Dev Mode on [F3] */}
          {devModeActive && diagnosticsOpen && React.createElement('vanguard-perf-panel')}

          {/* Developer Combat AI & Ballistics Debug Overlay, mounted only in Dev Mode */}
          {devModeActive && (
            <CombatDebugOverlay onRequestPointerLock={() => engineRef.current?.requestPointerLock()} />
          )}

          <ToastAndRecoveryLayer />
        </div>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

