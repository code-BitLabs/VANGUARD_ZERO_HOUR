import React, { useCallback, useState } from 'react';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { InputManager } from '@/src/engine/InputManager';
import { DirectorTelemetrySnapshot } from '@/src/engine/RenderingQualityDirector';
import { SquadCommandSource, SquadOrderType } from '@/src/gameplay/squad/SquadIntentRouter';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { useGameSessionStore } from '@/src/stores/gameSessionStore';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { useUIStore } from '@/src/stores/uiStore';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { getMissionVisualProfile } from '@/src/world/VisualBible';
import {
  HudBottomPromptsAndRadio,
  HudDesktopVitalsPanel,
  HudDesktopWeaponAndOrdnancePanel,
  HudDownedOverlaySlot,
  HudLowHealthVignette,
  HudReticleAndCombatOverlays,
  HudSoloTraumaSlot,
  HudSquadCommandSlot,
  HudTacticalOverviewSlot,
  HudTopCenterStack,
  HudTopLeftCluster,
  HudTopRightCluster,
  HudTouchControlsSlot,
  HudWorldObjectiveMarker,
} from './HudSlices';

export const GameHUD = React.memo(function GameHUD({
  onRequestPointerLock,
  onPause,
  onRestartCheckpoint,
  onRestartMission,
  onAbort,
  onIssueSquadCommand,
  onSwapFieldWeapon,
  onTriggerSoloSelfRecovery,
  inputManager = null,
  touchControlsVisible = false,
  qualityTelemetry = null,
  getQualityTelemetry,
}: {
  onRequestPointerLock: () => void;
  onPause?: () => void;
  onRestartCheckpoint?: () => void;
  onRestartMission?: () => void;
  onAbort?: () => void;
  onIssueSquadCommand?: (
    order: SquadOrderType,
    source: SquadCommandSource,
    operatorId?: string
  ) => void;
  onSwapFieldWeapon?: (replaceSlotIndex: number, nextWeaponId: WeaponId) => void;
  onTriggerSoloSelfRecovery?: () => boolean | void;
  inputManager?: InputManager | null;
  touchControlsVisible?: boolean;
  qualityTelemetry?: DirectorTelemetrySnapshot | null;
  getQualityTelemetry?: () => DirectorTelemetrySnapshot | null;
}) {
  const downedActive = useGameSessionStore((s) => Boolean(s.downedState?.active));
  const combatDebugOpen = useUIStore((s) => s.combatDebugOpen);
  const combatDebugCollapsed = useUIStore((s) => s.combatDebugCollapsed);
  const pointerLocked = useUIStore((s) => s.pointerLocked);
  const tacticalOverviewOpen = useUIStore((s) => s.tacticalOverviewOpen);
  const setTacticalOverviewOpen = useUIStore((s) => s.setTacticalOverviewOpen);

  const colorblind = useSettingsStore((s) => s.accessibility.colorblindMode);
  const displayUiScale = useSettingsStore((s) => s.display.uiScale);

  const hudScale = useSettingsStore((s) => s.hud.scale);
  const hudPreset = useSettingsStore((s) => s.hud.preset);
  const hudSettingsOpacity = useSettingsStore((s) => s.hud.opacity);
  const hudShowRadar = useSettingsStore((s) => s.hud.showRadar);
  const hudShowCompass = useSettingsStore((s) => s.hud.showCompass);
  const hudShowKillfeed = useSettingsStore((s) => s.hud.showKillfeed);

  const showFpsCounter = useSettingsStore((s) => s.display.showFpsCounter);
  const showPerformanceTelemetry = useSettingsStore((s) => s.display.showPerformanceTelemetry);
  const devModeEnabled = useSettingsStore((s) => s.developer.devModeEnabled);

  const uiScale = hudScale ?? displayUiScale;
  const hudMode: 'adaptive' | 'minimal' | 'expanded' =
    hudPreset === 'immersive'
      ? 'minimal'
      : hudPreset === 'full_tactical'
        ? 'expanded'
        : 'adaptive';
  const hudOpacity = hudSettingsOpacity ?? 0.92;
  const showRadar = hudShowRadar ?? true;
  const showCompass = hudShowCompass ?? true;
  const showKillFeed = hudShowKillfeed ?? true;
  const devModeActive = isEnvDevModeAllowed() && devModeEnabled;

  const viewport = useViewportMode();
  const compactHud = touchControlsVisible || viewport.isCompactLandscape;
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);
  const missionVisualProfile = getMissionVisualProfile(selectedMissionId);

  const threatColor =
    colorblind === 'deuteranopia'
      ? '#38bdf8'
      : colorblind === 'protanopia'
        ? '#06b6d4'
        : colorblind === 'tritanopia'
          ? '#f43f5e'
          : '#ef4444';

  const radarSizePx = compactHud
    ? viewport.width < 760
      ? 40
      : 48
    : viewport.width < 1200
      ? 74
      : 98;
  const radarCenter = radarSizePx / 2;
  const radarRadius = radarCenter - 4;

  const [fieldSwapOpen, setFieldSwapOpen] = useState(false);

  const handleOpenFieldSwap = useCallback(() => {
    setFieldSwapOpen(true);
  }, []);

  const handleCloseOverview = useCallback(() => {
    setTacticalOverviewOpen(false);
  }, [setTacticalOverviewOpen]);

  return (
    <div
      className="fixed inset-0 z-10 pointer-events-none select-none overflow-hidden"
      style={{
        fontSize: uiScale !== 1 ? `${Math.round(uiScale * 100)}%` : undefined,
        opacity: hudOpacity,
      }}
      onClick={() => {
        if (
          !touchControlsVisible &&
          !viewport.isCoarsePointer &&
          !downedActive &&
          !tacticalOverviewOpen &&
          !inputManager?.isPointerLockBlocked()
        ) {
          onRequestPointerLock();
        }
      }}
    >
      <HudLowHealthVignette />

      <HudWorldObjectiveMarker downedActive={downedActive} />

      <HudReticleAndCombatOverlays downedActive={downedActive} threatColor={threatColor} />

      <HudTopCenterStack
        showCompass={showCompass}
        compactHud={compactHud}
        viewportWidth={viewport.width}
        downedActive={downedActive}
        pointerLocked={pointerLocked}
        combatDebugOpen={combatDebugOpen}
        touchControlsVisible={touchControlsVisible}
        isCoarsePointer={viewport.isCoarsePointer}
        hudMode={hudMode}
        onRequestPointerLock={onRequestPointerLock}
      />

      <HudTopLeftCluster
        showRadar={showRadar}
        compactHud={compactHud}
        touchControlsVisible={touchControlsVisible}
        viewportWidth={viewport.width}
        viewportHeight={viewport.height}
        radarSizePx={radarSizePx}
        radarCenter={radarCenter}
        radarRadius={radarRadius}
        threatColor={threatColor}
      />

      <HudTopRightCluster
        compactHud={compactHud}
        devModeActive={devModeActive}
        combatDebugOpen={combatDebugOpen}
        combatDebugCollapsed={combatDebugCollapsed}
        tacticalOverviewOpen={tacticalOverviewOpen}
        touchControlsVisible={touchControlsVisible}
        showFpsCounter={showFpsCounter}
        showPerformanceTelemetry={showPerformanceTelemetry}
        showKillFeed={showKillFeed}
        qualityTelemetry={qualityTelemetry}
        getQualityTelemetry={getQualityTelemetry}
        onPause={onPause}
      />

      <HudBottomPromptsAndRadio
        compactHud={compactHud}
        downedActive={downedActive}
        fieldSwapOpen={fieldSwapOpen}
        onOpenFieldSwap={onSwapFieldWeapon ? handleOpenFieldSwap : undefined}
      />

      {!compactHud && <HudDesktopVitalsPanel />}

      {!compactHud && <HudDesktopWeaponAndOrdnancePanel inputManager={inputManager} />}

      {(tacticalOverviewOpen || hudMode === 'expanded') && !downedActive && (
        <HudTacticalOverviewSlot
          missionVisualProfile={missionVisualProfile}
          tacticalOverviewOpen={tacticalOverviewOpen}
          onClose={handleCloseOverview}
        />
      )}

      {!compactHud && !downedActive && <HudSoloTraumaSlot />}

      <HudDownedOverlaySlot
        onTriggerSoloSelfRecovery={onTriggerSoloSelfRecovery}
        onRestartCheckpoint={onRestartCheckpoint}
        onRestartMission={onRestartMission}
        onAbort={onAbort}
      />

      {onSwapFieldWeapon && (
        <HudSquadCommandSlot
          compactHud={compactHud}
          downedActive={downedActive}
          fieldSwapOpen={fieldSwapOpen}
          onFieldSwapOpenChange={setFieldSwapOpen}
          onIssueSquadCommand={onIssueSquadCommand}
          onSwapFieldWeapon={onSwapFieldWeapon}
        />
      )}

      {touchControlsVisible && !downedActive && (
        <HudTouchControlsSlot
          inputManager={inputManager}
          onIssueSquadCommand={onIssueSquadCommand}
        />
      )}
    </div>
  );
});
