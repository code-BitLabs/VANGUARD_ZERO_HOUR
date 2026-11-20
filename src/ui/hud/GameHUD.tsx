import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bomb,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Gamepad2,
  Heart,
  Layers,
  Pause,
  Radio,
  Rocket,
  Shield,
  X,
} from 'lucide-react';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { InputManager } from '@/src/engine/InputManager';
import { VEHICLE_CAMERA_MODE_LABELS } from '@/src/gameplay/VehicleCameraRig';
import { useGameSessionStore } from '@/src/stores/gameSessionStore';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { uiStore, useUIStore } from '@/src/stores/uiStore';
import { WeaponSilhouette } from '@/src/ui/components/WeaponSilhouette';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { getMissionVisualProfile } from '@/src/world/VisualBible';
import { SquadCommandSource, SquadOrderType } from '@/src/gameplay/squad/SquadIntentRouter';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { computeMobileHudLayout } from './mobileHudLayoutEngine';
import { MobileTouchControls } from './MobileTouchControls';
import { SquadCommandHud } from './SquadCommandHud';
import { TacticalMiniMap } from './TacticalMiniMap';
import { DownedActionOverlay, TacticalOverviewDrawer } from './TacticalOverlays';

export function GameHUD({
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
}) {
  const hud = useGameSessionStore((s) => s.hud);
  const hitFeedback = useGameSessionStore((s) => s.hitFeedback);
  const killFeed = useGameSessionStore((s) => s.killFeed);
  const damageArcs = useGameSessionStore((s) => s.damageArcs);
  const downedState = useGameSessionStore((s) => s.downedState);
  const diagnostics = useGameSessionStore((s) => s.diagnostics);
  const combatDebug = useGameSessionStore((s) => s.combatDebug);
  const combatDebugOpen = useUIStore((s) => s.combatDebugOpen);
  const combatDebugCollapsed = useUIStore((s) => s.combatDebugCollapsed);
  const pointerLocked = useUIStore((s) => s.pointerLocked);
  const tacticalOverviewOpen = useUIStore((s) => s.tacticalOverviewOpen);
  const setTacticalOverviewOpen = useUIStore((s) => s.setTacticalOverviewOpen);
  const toggleTacticalOverview = useUIStore((s) => s.toggleTacticalOverview);
  const setCombatDebugOpen = useUIStore((s) => s.setCombatDebugOpen);
  const setCombatDebugCollapsed = useUIStore((s) => s.setCombatDebugCollapsed);
  const accessibility = useSettingsStore((s) => s.accessibility);
  const colorblind = accessibility.colorblindMode;
  const uiScale = accessibility.uiScale;
  const hudMode = accessibility.hudMode ?? 'adaptive';
  const hudOpacity = accessibility.hudOpacity ?? 0.92;
  const showRadar = accessibility.showRadar ?? true;
  const showCompass = accessibility.showCompass ?? true;
  const devModeEnabled = useSettingsStore((s) => s.developer.devModeEnabled);
  const inputSettings = useSettingsStore((s) => s.input);
  const devModeActive = isEnvDevModeAllowed() && devModeEnabled;
  const warnCount =
    combatDebug?.warnings.filter((w) => w.severity === 'WARNING' || w.severity === 'CRITICAL')
      .length ?? 0;
  const liveFps = combatDebug?.performance.fps ?? diagnostics.fps;
  const viewport = useViewportMode();
  const compactHud = touchControlsVisible || viewport.isCompactLandscape;
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);
  const missionVisualProfile = getMissionVisualProfile(selectedMissionId);
  const hasSeenVehicleHint = useMissionSelectionStore((s) => s.hasSeenVehicleControlHint);
  const markVehicleHintSeen = useMissionSelectionStore((s) => s.markVehicleControlHintSeen);
  const dismissTacticalHint = useMissionSelectionStore((s) => s.dismissTacticalHint);

  const [objectivesExpanded, setObjectivesExpanded] = useState(false);
  const [showHit, setShowHit] = useState(false);
  const isIntenseCombat = hud.isAds || hud.crosshairSpread > 0.036 || Boolean(hud.incomingThreatWarning);
  const secondaryChromeOpacity =
    hudMode === 'minimal' ? 0.78 : hudMode === 'adaptive' && isIntenseCombat ? 0.84 : 1.0;

  useEffect(() => {
    if (!hitFeedback) return;
    setShowHit(true);
    const id = window.setTimeout(() => setShowHit(false), 180);
    return () => window.clearTimeout(id);
  }, [hitFeedback?.id]);

  const threatColor =
    colorblind === 'deuteranopia'
      ? '#38bdf8'
      : colorblind === 'protanopia'
        ? '#06b6d4'
        : colorblind === 'tritanopia'
          ? '#f43f5e'
          : '#ef4444';

  const headingDeg = (((-hud.playerYaw * 180) / Math.PI) % 360 + 360) % 360;
  const cardinal =
    headingDeg < 22.5 || headingDeg >= 337.5
      ? 'N'
      : headingDeg < 67.5
        ? 'NE'
        : headingDeg < 112.5
          ? 'E'
          : headingDeg < 157.5
            ? 'SE'
            : headingDeg < 202.5
              ? 'S'
              : headingDeg < 247.5
                ? 'SW'
                : headingDeg < 292.5
                  ? 'W'
                  : 'NW';

  const spreadPx = Math.min(34, Math.max(5, Math.round(hud.crosshairSpread * 520)));
  const radarSizePx = compactHud ? 52 : 108;
  const radarCenter = radarSizePx / 2;
  const radarRadius = radarCenter - 4;
  const criticalHp = hud.health > 0 && hud.health / Math.max(1, hud.maxHealth) < 0.35;

  // Use the authoritative Mobile HUD Layout Engine to shift the top-left HUD cluster rightward
  // whenever Left-Side Fire is enabled in the upper-left quadrant.
  const mobileLayout = touchControlsVisible
    ? computeMobileHudLayout(
        inputSettings,
        { width: viewport.width, height: viewport.height },
        {
          inVehicle: hud.inVehicle,
          grenadeCount: hud.grenades,
          c4DeployedCount: hud.ordnance?.c4Deployed ?? 0,
        }
      )
    : null;

  const topLeftOffsetPx = mobileLayout ? mobileLayout.topLeftHudLeftPx : 10;

  const activeObjective =
    hud.objectives.find((o) => !o.completed && o.status === 'active') ??
    hud.objectives.find((o) => !o.completed) ??
    hud.objectives[hud.objectives.length - 1] ??
    null;
  const completedObjectivesCount = hud.objectives.filter((o) => o.completed).length;

  const formatObjectiveDistance = (o: (typeof hud.objectives)[number]) => {
    if (o.completed || !o.markerPos) return null;
    return Math.round(Math.hypot(o.markerPos.x - hud.playerX, o.markerPos.z - hud.playerZ));
  };

  return (
    <div
      className="fixed inset-0 z-10 pointer-events-none select-none overflow-hidden"
      style={{
        transform: uiScale !== 1 ? `scale(${uiScale})` : undefined,
        opacity: hudOpacity,
      }}
      onClick={() => {
        if (!touchControlsVisible && !viewport.isCoarsePointer && !downedState?.active && !tacticalOverviewOpen) {
          onRequestPointerLock();
        }
      }}
    >
      {/* Low-Health Crimson Vignette */}
      {criticalHp && (
        <div
          className="absolute inset-0 transition-opacity duration-200"
          style={{
            boxShadow: `inset 0 0 120px rgba(220, 38, 38, ${Math.min(0.65, 0.62 - (hud.health / Math.max(1, hud.maxHealth)) * 0.9)})`,
          }}
        />
      )}

      {/* 3D-to-Screen Floating Primary Objective Marker */}
      {activeObjective &&
        !activeObjective.completed &&
        activeObjective.markerPos &&
        activeObjective.screenX !== undefined &&
        activeObjective.screenY !== undefined &&
        !downedState?.active && (
          <div
            data-testid="hud-world-objective-marker"
            className="absolute z-15 -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-transform duration-75"
            style={{
              left: `${Math.round(activeObjective.screenX * 1000) / 10}%`,
              top: `${Math.round(activeObjective.screenY * 1000) / 10}%`,
            }}
          >
            <div className="flex flex-col items-center">
              <div
                className={`w-3.5 h-3.5 rotate-45 border-2 flex items-center justify-center shadow-[0_0_8px_rgba(0,0,0,0.9)] ${
                  activeObjective.onScreen
                    ? 'bg-amber-400/90 border-zinc-950'
                    : 'bg-amber-500/50 border-amber-300'
                }`}
              >
                <div className="w-1 h-1 bg-zinc-950 rounded-full" />
              </div>
              <div className="mt-1 px-1.5 py-0.5 bg-[#0B0E11]/88 border border-amber-400/70 rounded-xs font-mono text-[9px] text-amber-300 whitespace-nowrap shadow-md">
                OBJ · {formatObjectiveDistance(activeObjective) ?? 0}M
                {Math.abs(activeObjective.elevationDeltaM ?? 0) >= 2 && (
                  <span className="ml-1 text-cyan-300 font-bold">
                    {(activeObjective.elevationDeltaM ?? 0) > 0
                      ? `▲+${activeObjective.elevationDeltaM}M`
                      : `▼${activeObjective.elevationDeltaM}M`}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

      {/* 6x Optical Sniper Scope Overlay */}
      {hud.isScoped && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85">
          <div className="relative w-[min(74vh,74vw)] h-[min(74vh,74vw)] rounded-full border-4 border-zinc-800 bg-transparent shadow-[0_0_0_2000px_rgba(0,0,0,0.92)] overflow-hidden">
            <div className="absolute inset-x-0 top-1/2 h-px bg-cyan-400/70" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-cyan-400/70" />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-red-500" />
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-[11px] text-cyan-400 tracking-widest">
              6.0X OPTIC // ZEROED 150M
            </div>
          </div>
        </div>
      )}

      {/* Directional Damage Arcs */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-48 sm:w-56 h-48 sm:h-56">
        {damageArcs.map((arc) => (
          <div
            key={arc.id}
            data-testid="hud-damage-arc"
            className="absolute inset-0 flex justify-center"
            style={{ transform: `rotate(${arc.angleRad}rad)`, opacity: arc.intensity }}
          >
            <div
              className="w-16 h-2 rounded-full"
              style={{ backgroundColor: threatColor, boxShadow: `0 0 14px ${threatColor}` }}
            />
          </div>
        ))}
      </div>

      {/* High-Contrast Dynamic Center Reticle & Hit Markers */}
      {!hud.isScoped && !downedState?.active && (
        <div
          data-testid="hud-center-reticle"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <div className="relative flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white ring-1 ring-black/90 shadow-[0_0_3px_rgba(0,0,0,0.95)]" />
            <div
              className="absolute w-3 h-0.5 bg-white ring-1 ring-black/85 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
              style={{ transform: `translateX(${-spreadPx - 5}px)` }}
            />
            <div
              className="absolute w-3 h-0.5 bg-white ring-1 ring-black/85 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
              style={{ transform: `translateX(${spreadPx + 5}px)` }}
            />
            <div
              className="absolute w-0.5 h-3 bg-white ring-1 ring-black/85 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
              style={{ transform: `translateY(${-spreadPx - 5}px)` }}
            />
            <div
              className="absolute w-0.5 h-3 bg-white ring-1 ring-black/85 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
              style={{ transform: `translateY(${spreadPx + 5}px)` }}
            />

            {hitFeedback && showHit && (
              <div className="absolute flex flex-col items-center">
                <Crosshair
                  key={hitFeedback.id}
                  className="w-7 h-7 rotate-45 drop-shadow-[0_0_4px_rgba(0,0,0,0.95)]"
                  style={{
                    color: hitFeedback.isHeadshot
                      ? '#f59e0b'
                      : hitFeedback.isKill
                        ? threatColor
                        : '#ffffff',
                  }}
                />
                {(hitFeedback.isKill || hitFeedback.isHeadshot) && (
                  <span
                    className={`mt-5 px-1.5 py-0.5 bg-black/80 rounded-xs font-mono text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${
                      hitFeedback.isHeadshot ? 'text-amber-400' : 'text-red-400'
                    }`}
                  >
                    {hitFeedback.isKill && hitFeedback.isHeadshot
                      ? 'HEADSHOT ELIMINATION'
                      : hitFeedback.isKill
                        ? 'ELIMINATED'
                        : 'HEADSHOT'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Guided Missile Lock-On Ring */}
      {hud.lockOn.status !== 'none' && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div
            className={`w-28 h-28 rounded-full border-2 flex items-center justify-center transition-colors ${
              hud.lockOn.status === 'locked'
                ? 'border-red-500'
                : hud.lockOn.status === 'acquiring'
                  ? 'border-amber-400'
                  : 'border-cyan-400/50 border-dashed'
            }`}
          >
            <span className="font-mono text-[10px] tracking-widest px-1.5 py-0.5 bg-black/70 text-zinc-100 mt-32 whitespace-nowrap">
              {hud.lockOn.status === 'locked'
                ? `LOCKED: ${hud.lockOn.targetLabel}`
                : hud.lockOn.status === 'acquiring'
                  ? `LOCKING ${Math.round(hud.lockOn.progress * 100)}%`
                  : 'SEEKER SCANNING'}
            </span>
          </div>
        </div>
      )}

      {/* Top Center Compact Strip: Compass + Score + Elapsed Time + Encounter-Gated Aircraft Health */}
      <div
        data-testid="hud-top-center-strip"
        className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 transition-opacity duration-150"
        style={{
          top: 'max(6px, env(safe-area-inset-top, 0px))',
          opacity: secondaryChromeOpacity,
        }}
      >
        {showCompass && (
          <div
            data-testid="hud-compass-strip"
            className={`bg-[#0B0E11]/82 border border-white/14 py-0.5 rounded-sm flex items-center font-mono tabular-nums whitespace-nowrap shadow-sm ${
              compactHud ? 'px-2 gap-1.5 text-[9.5px]' : 'px-3.5 gap-2.5 text-xs'
            }`}
          >
            <Compass className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400 shrink-0" />
            <span className="text-zinc-300">{Math.round(headingDeg)}°</span>
            <span className="text-amber-400 font-bold w-4 text-center">{cardinal}</span>
            {activeObjective && !activeObjective.completed && activeObjective.markerPos && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-amber-300 font-bold">
                  OBJ {formatObjectiveDistance(activeObjective) ?? 0}M
                </span>
              </>
            )}
            {!compactHud && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-200">SCORE {hud.score}</span>
              </>
            )}
            <span className="text-zinc-600">·</span>
            <span className="text-cyan-400">
              {String(Math.floor(hud.elapsedSec / 60)).padStart(2, '0')}:
              {String(hud.elapsedSec % 60).padStart(2, '0')}
            </span>
          </div>
        )}

        {!pointerLocked && !combatDebugOpen && !touchControlsVisible && !viewport.isCoarsePointer && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRequestPointerLock();
            }}
            className="pointer-events-auto bg-[#0B0E11]/90 hover:bg-[#141920] border border-cyan-500/60 px-3 py-1 rounded-sm font-mono text-[10px] uppercase tracking-wider text-cyan-300 whitespace-nowrap transition-colors"
          >
            Cursor Free — Click View or [TAB] to Aim
          </button>
        )}

        {/* Compact Encounter-Relevant Aircraft Health Bar with Boss Phase & Vulnerability Cue */}
        {hud.activeBossLabel && (
          <div
            data-testid="hud-boss-bar"
            className={`w-48 sm:w-64 bg-[#0B0E11]/82 border px-2 py-1 rounded-sm shadow-sm transition-colors ${
              hud.activeBossVulnerable ? 'border-amber-400/85' : 'border-red-500/55'
            }`}
          >
            <div className="flex justify-between items-center font-mono text-[9px] sm:text-[10px] leading-none mb-0.5">
              <span
                className={`truncate max-w-[135px] sm:max-w-[190px] ${
                  hud.activeBossVulnerable ? 'text-amber-300 font-bold' : 'text-red-300'
                }`}
              >
                {hud.activeBossLabel}
              </span>
              <span className="tabular-nums font-bold text-zinc-100">
                {Math.round(hud.activeBossHealthPct * 100)}%
              </span>
            </div>
            <div className="h-1 bg-zinc-800/90 overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${
                  hud.activeBossVulnerable ? 'bg-amber-400' : 'bg-red-500'
                }`}
                style={{ width: `${Math.round(hud.activeBossHealthPct * 100)}%` }}
              />
            </div>
            {hud.activeBossPhaseLabel && (
              <div
                data-testid="hud-boss-phase"
                className={`mt-0.5 font-mono text-[8.5px] uppercase tracking-wider leading-none ${
                  hud.activeBossVulnerable ? 'text-amber-300 font-bold' : 'text-zinc-400'
                }`}
              >
                {hud.activeBossPhaseLabel}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Top-Left Compact Radar, Expandable Mission Objective Indicator & Slim Mobile Vitals */}
      <div
        data-testid="hud-top-left-cluster"
        className="absolute z-30 flex items-start gap-1.5 pointer-events-none"
        style={{
          top: 'max(6px, env(safe-area-inset-top, 0px))',
          left: `max(${topLeftOffsetPx}px, calc(env(safe-area-inset-left, 0px) + ${topLeftOffsetPx - 4}px))`,
        }}
      >
        {/* Intelligence-Graded Radar Mini-Map with Vertical Elevation Chevrons */}
        {showRadar && (
          <TacticalMiniMap
            blips={hud.blips}
            playerX={hud.playerX}
            playerZ={hud.playerZ}
            playerYaw={hud.playerYaw}
            radarSizePx={radarSizePx}
            radarCenter={radarCenter}
            radarRadius={radarRadius}
            threatColor={threatColor}
            compactHud={compactHud}
          />
        )}

        {/* Compact Mission Indicator + Integrated Mobile Vitals */}
        <div className="flex flex-col gap-1 pointer-events-none">
          {compactHud ? (
            <div
              data-testid="hud-objectives-compact"
              className="pointer-events-auto bg-[#0B0E11]/76 border border-white/12 rounded-sm px-2 py-1 min-w-[150px] max-w-[210px] shadow-sm"
            >
              <button
                type="button"
                data-testid="hud-objectives-toggle"
                aria-label="Toggle Mission Objectives"
                aria-expanded={objectivesExpanded}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setObjectivesExpanded((v) => !v);
                }}
                className="w-full text-left flex items-center justify-between gap-1.5"
              >
                {activeObjective ? (
                  <>
                    <span
                      className={`text-[10px] truncate ${
                        activeObjective.completed ? 'line-through text-emerald-400' : 'text-zinc-100 font-medium'
                      }`}
                    >
                      <span className="font-mono text-[9px] text-cyan-400 mr-1">
                        S{hud.activeStageIndex}/{hud.totalStages}
                      </span>
                      {activeObjective.title}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-amber-400 shrink-0 flex items-center gap-1">
                      {(() => {
                        const dist = formatObjectiveDistance(activeObjective);
                        return dist !== null ? <span>{dist}m</span> : null;
                      })()}
                      <span>
                        {activeObjective.current}/{activeObjective.target}
                      </span>
                      {hud.objectives.length > 1 &&
                        (objectivesExpanded ? (
                          <ChevronUp className="w-3 h-3 text-zinc-400" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-zinc-400" />
                        ))}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-[10px] uppercase text-amber-400">Objectives</span>
                )}
              </button>

              {/* Expandable Full Objective List on Demand */}
              {objectivesExpanded && hud.objectives.length > 0 && (
                <div
                  data-testid="hud-objectives-expanded-list"
                  className="mt-1 pt-1 border-t border-zinc-800/90 space-y-1"
                >
                  <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                    <span>Stage {hud.activeStageIndex}/{hud.totalStages}</span>
                    <span>
                      {completedObjectivesCount}/{hud.objectives.length}
                    </span>
                  </div>
                  {hud.objectives.map((o) => {
                    const dist = formatObjectiveDistance(o);
                    const isLocked = o.status === 'locked';
                    return (
                      <div key={o.id} className="space-y-0.5">
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span
                            className={
                              o.completed
                                ? o.bypassed
                                  ? 'line-through text-amber-400/80 truncate'
                                  : 'line-through text-emerald-400/80 truncate'
                                : isLocked
                                  ? 'text-zinc-500 truncate'
                                  : 'text-zinc-100 font-medium truncate'
                            }
                          >
                            {o.title}
                          </span>
                          <span className="font-mono text-[9px] tabular-nums text-amber-400 shrink-0">
                            {o.bypassed
                              ? 'BYPASSED'
                              : isLocked && o.current === 0
                                ? 'LOCKED'
                                : `${dist !== null ? `${dist}m · ` : ''}${o.current}/${o.target}`}
                          </span>
                        </div>
                        {isLocked && o.blockedReason && (
                          <div className="text-[8.5px] font-mono text-zinc-500 truncate">
                            {o.blockedReason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Live Platform-Aware Tactical Action Directive */}
              {hud.activeActionDirective && (
                <div
                  data-testid="hud-action-directive"
                  className="mt-1 pt-1 border-t border-amber-500/25 font-mono text-[8.5px] leading-tight text-amber-300"
                >
                  {hud.activeActionDirective}
                </div>
              )}

              {/* Ultra-Compact Single-Line Mobile Vitals Integrated Inside Top-Left Strip */}
              <div className="mt-1 pt-1 border-t border-white/10 flex items-center justify-between gap-2 font-mono text-[9px] leading-none">
                <div className="flex items-center gap-1 text-cyan-400 flex-1">
                  <Shield className="w-2.5 h-2.5 shrink-0" />
                  <span className="tabular-nums">ARM {hud.armor}</span>
                  <div className="h-1 flex-1 bg-zinc-800 overflow-hidden rounded-xs">
                    <div
                      className="h-full bg-cyan-400"
                      style={{ width: `${Math.round((hud.armor / hud.maxArmor) * 100)}%` }}
                    />
                  </div>
                </div>
                <div
                  className={`flex items-center gap-1 font-bold flex-1 ${
                    hud.health < 35 ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  <Heart className="w-2.5 h-2.5 shrink-0" />
                  <span className="tabular-nums">{hud.health}</span>
                  <div className="h-1 flex-1 bg-zinc-800 overflow-hidden rounded-xs">
                    <div
                      className={`h-full ${hud.health < 35 ? 'bg-red-500' : 'bg-emerald-400'}`}
                      style={{ width: `${Math.round((hud.health / hud.maxHealth) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              data-testid="hud-objectives-desktop"
              className="bg-[#0B0E11]/84 border border-zinc-800/90 rounded-sm px-3 py-2 space-y-1.5 min-w-[250px] max-w-[345px]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-1">
                <span
                  data-testid="hud-stage-header"
                  className="font-mono text-[10px] uppercase tracking-widest text-cyan-400 font-bold truncate"
                >
                  {hud.activeStageTitle}
                </span>
                <span className="font-mono text-[10px] text-amber-400 shrink-0">
                  STAGE {hud.activeStageIndex}/{hud.totalStages}
                </span>
              </div>
              {hud.objectives.map((o) => {
                const distMeters = formatObjectiveDistance(o);
                const isLocked = o.status === 'locked';
                const isActive = o.status === 'active' && !o.completed;
                return (
                  <div
                    key={o.id}
                    data-testid={`hud-objective-row-${o.id}`}
                    className={`space-y-0.5 rounded-xs px-1.5 py-1 ${
                      isActive
                        ? 'bg-amber-500/10 border-l-2 border-amber-400'
                        : isLocked
                          ? 'opacity-65'
                          : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={
                          o.completed
                            ? o.bypassed
                              ? 'line-through text-amber-400/85'
                              : 'line-through text-emerald-400/85'
                            : isLocked
                              ? 'text-zinc-400'
                              : 'text-zinc-100 font-semibold'
                        }
                      >
                        {o.title}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums shrink-0 flex items-center gap-1">
                        {o.completed ? (
                          <span
                            className={`px-1 py-0.2 rounded-xs text-[9px] uppercase font-bold ${
                              o.bypassed
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            }`}
                          >
                            {o.bypassed ? 'BYPASSED' : 'DONE'}
                          </span>
                        ) : isLocked ? (
                          <span className="px-1 py-0.2 rounded-xs bg-zinc-800 text-zinc-400 text-[9px] uppercase">
                            {o.current > 0 ? `LOGGED ${o.current}/${o.target}` : `STAGE ${o.stageIndex}`}
                          </span>
                        ) : (
                          <span className="text-amber-400 font-bold">
                            {distMeters !== null ? `${distMeters}m · ` : ''}
                            {o.current}/{o.target}
                          </span>
                        )}
                      </span>
                    </div>
                    {isActive && o.description && (
                      <div className="text-[10px] text-zinc-300 leading-tight">{o.description}</div>
                    )}
                    {isLocked && o.blockedReason && (
                      <div
                        data-testid={`hud-objective-blocked-${o.id}`}
                        className="text-[9.5px] font-mono text-zinc-400 leading-tight"
                      >
                        {o.blockedReason}
                      </div>
                    )}
                  </div>
                );
              })}
              {hud.waveStatusText && (
                <div
                  data-testid="hud-wave-status"
                  className="pt-1 border-t border-zinc-800/80 font-mono text-[9.5px] text-cyan-300"
                >
                  {hud.waveStatusText}
                </div>
              )}
              {hud.activeActionDirective && (
                <div
                  data-testid="hud-action-directive"
                  className="pt-1.5 border-t border-amber-500/30 font-mono text-[10px] text-amber-300 leading-snug"
                >
                  {hud.activeActionDirective}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top-Right Single-Row Bar: Compact Mobile Weapon/Ammo + Touch Toggle + Pause + Diagnostics */}
      <div
        className="absolute z-30 flex flex-col items-end gap-1.5 pointer-events-none"
        style={{
          top: 'max(6px, env(safe-area-inset-top, 0px))',
          right: 'max(8px, env(safe-area-inset-right, 0px))',
        }}
      >
        <div
          data-testid="hud-top-right-bar"
          className="flex items-center gap-1.5 pointer-events-none"
        >
          {/* Compact Inline Weapon/Vehicle Readout on Mobile (prevents vertical stacking into the right look zone) */}
          {compactHud && (
            <div
              data-testid="hud-compact-weapon-readout"
              className="bg-[#0B0E11]/76 border border-white/12 px-2 py-1 rounded-sm font-mono text-right flex items-center gap-2"
            >
              {hud.inVehicle ? (
                <div className="leading-tight">
                  <div className="text-[9px] text-emerald-400 uppercase truncate max-w-[96px]">{hud.vehicleName}</div>
                  <div className="text-[11px] font-bold text-amber-400 tabular-nums whitespace-nowrap">
                    {hud.vehicleGear === 'REVERSE' ? 'REV ' : 'FWD '}
                    {hud.vehicleSpeedKmh} KM/H · {hud.vehicleHealth}%
                  </div>
                </div>
              ) : (
                <div className="leading-tight">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-[9px] text-zinc-300 font-bold uppercase">{hud.weaponName}</span>
                    <span className="text-[8px] text-amber-400 uppercase">{hud.fireMode}</span>
                  </div>
                  <div className="tabular-nums leading-none mt-0.5">
                    <span className={`text-sm font-bold ${hud.ammoInMag === 0 ? 'text-red-400' : 'text-white'}`}>
                      {hud.ammoInMag}
                    </span>
                    <span className="text-[10px] text-zinc-400"> / {hud.reserveAmmo}</span>
                  </div>
                  {hud.isReloading && (
                    <div className="h-0.5 bg-zinc-800 mt-0.5 overflow-hidden">
                      <div
                        className="h-full bg-amber-400"
                        style={{ width: `${Math.round(hud.reloadProgress * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {devModeActive && !combatDebugOpen && !compactHud && (
            <button
              type="button"
              aria-label="Open Combat and Performance Diagnostics"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setCombatDebugCollapsed(false);
                setCombatDebugOpen(true);
              }}
              className="pointer-events-auto flex items-center gap-2 px-2.5 min-h-[40px] bg-[#0B0E11]/90 hover:bg-[#141920] border border-zinc-700/90 rounded-sm font-mono text-[11px] tabular-nums text-zinc-200 whitespace-nowrap shrink-0 transition-colors"
            >
              <BarChart3 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-zinc-400">[F4]</span>
              <span className="font-bold text-zinc-100">{liveFps} FPS</span>
              {warnCount > 0 ? (
                <span className="px-1.5 py-0.5 bg-red-950/90 border border-red-500/80 text-red-300 text-[10px] font-bold">
                  {warnCount} WARN
                </span>
              ) : (
                <span className="px-1.5 py-0.5 bg-emerald-950/70 border border-emerald-600/60 text-emerald-300 text-[10px]">
                  DIAG
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            data-testid="hud-tactical-overview-btn"
            aria-label="Toggle Tactical Overview Drawer"
            aria-expanded={tacticalOverviewOpen}
            title="Toggle Tactical Overview ([TAB])"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleTacticalOverview();
            }}
            className={`pointer-events-auto min-w-[40px] min-h-[40px] ${
              compactHud ? 'px-2' : 'px-2.5'
            } rounded-sm border flex items-center justify-center gap-1.5 font-mono text-[10px] transition-colors ${
              tacticalOverviewOpen
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                : 'bg-[#0B0E11]/85 border-zinc-700 text-zinc-300 hover:bg-[#141920]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            {!compactHud && <span className="hidden sm:inline">[TAB] INTEL</span>}
          </button>

          <button
            type="button"
            aria-label="Toggle Touch Controls"
            title={touchControlsVisible ? 'Hide Touch Controls' : 'Show Touch Controls'}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              uiStore.getState().toggleTouchHudOverride(touchControlsVisible);
            }}
            className={`pointer-events-auto min-w-[40px] min-h-[40px] px-2 rounded-sm border flex items-center justify-center gap-1 font-mono text-[10px] transition-colors ${
              touchControlsVisible
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : 'bg-[#0B0E11]/80 border-zinc-700 text-zinc-300 hover:bg-[#141920]'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
            {!compactHud && <span className="hidden sm:inline">TOUCH</span>}
          </button>

          {onPause && (
            <button
              type="button"
              aria-label="Pause Mission"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onPause();
              }}
              className="pointer-events-auto min-w-[40px] min-h-[40px] px-2 bg-[#0B0E11]/85 hover:bg-[#141920] border border-zinc-700 rounded-sm text-zinc-100 flex items-center justify-center transition-colors"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {!compactHud && (
          <div className={`flex flex-col items-end gap-1.5 ${devModeActive && combatDebugOpen && combatDebugCollapsed ? 'mt-9' : ''}`}>
            {killFeed.map((k) => (
              <div
                key={k.id}
                className="bg-[#0B0E11]/85 border-r-2 border-amber-500 px-2.5 py-1 text-[11px] font-mono flex items-center gap-2"
              >
                <span className="text-cyan-400">{k.killer}</span>
                <span className="text-zinc-500">[{k.weaponName}]</span>
                {k.isHeadshot && <span className="text-amber-400 font-bold">HS</span>}
                <span className="text-red-400">{k.victim}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mission Alert, Sniper/Rocket Telegraph & Strategic Ordnance Warnings */}
      <div className="absolute top-14 sm:top-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
        {hud.incomingThreatWarning && !downedState?.active && (
          <div
            data-testid="hud-incoming-threat-warning"
            className="bg-red-950/92 border-2 border-red-500 px-3.5 py-1 rounded-sm shadow-xl flex flex-col items-center min-w-[210px]"
          >
            <div className="font-display text-[11px] sm:text-xs font-bold uppercase tracking-widest text-red-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span>{hud.incomingThreatWarning.label} — TAKE COVER</span>
            </div>
            <div className="w-full h-1 bg-zinc-900 mt-1 overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all duration-75"
                style={{ width: `${Math.round(hud.incomingThreatWarning.progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {(hud.spawnProtectionSec ?? 0) > 0 && !downedState?.active && (
          <div
            data-testid="hud-spawn-protection"
            className="bg-cyan-950/88 border border-cyan-400/70 px-2.5 py-0.5 rounded-sm font-mono text-[10px] uppercase tracking-wider text-cyan-300 shadow-md"
          >
            SPAWN COVER SHIELD ACTIVE ({hud.spawnProtectionSec?.toFixed(1)}s)
          </div>
        )}

        {hud.missionAlert && (
          <div className="bg-[#141920]/90 border border-amber-500/70 px-3 py-1 rounded-sm font-display text-[11px] sm:text-xs uppercase tracking-widest text-amber-400 shadow-lg text-center">
            {hud.missionAlert}
          </div>
        )}

        {hud.ordnance && hud.ordnance.nukePendingConfirmSec > 0 && (
          <div className="bg-[#1b1010]/95 border-2 border-red-500 px-3.5 py-1.5 rounded-sm text-center shadow-2xl">
            <div className="font-display text-xs sm:text-sm font-bold uppercase tracking-widest text-red-400 flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              CONFIRM TRIDENT-X ({hud.ordnance.nukePendingConfirmSec.toFixed(1)}s)
            </div>
            {!compactHud && (
              <div className="font-mono text-[11px] text-zinc-200 mt-1">
                PRESS [ENTER] TO AUTHORIZE ({hud.ordnance.sandboxAuthorized ? 'SANDBOX' : `${hud.ordnance.nukeCost} REQ`}) · [BACKSPACE] CANCEL
              </div>
            )}
          </div>
        )}

        {hud.ordnance && hud.ordnance.nukeCountdownSec > 0 && (
          <div className="bg-red-950/95 border-2 border-amber-400 px-4 py-1.5 rounded-sm text-center shadow-2xl">
            <div className="font-display text-xs sm:text-sm font-bold uppercase tracking-widest text-amber-300">
              STRATEGIC IMPACT IN {hud.ordnance.nukeCountdownSec.toFixed(1)}s — SEEK COVER
            </div>
          </div>
        )}

        {hud.ordnance && hud.ordnance.inFalloutZone && (
          <div className="bg-amber-950/90 border border-amber-500 px-2.5 py-0.5 rounded-sm font-mono text-[10px] text-amber-300 tracking-wider">
            FALLOUT ZONE (-4.5 HP/S) · {hud.ordnance.falloutRemainingSec.toFixed(0)}s
          </div>
        )}

        {/* Desktop First-Time Dismissible Vehicle Control Hint */}
        {!touchControlsVisible && hud.inVehicle && !hasSeenVehicleHint && (
          <div
            data-testid="vehicle-control-hint"
            className="pointer-events-auto bg-[#0B0E11]/95 border border-amber-400/80 px-3.5 py-1.5 rounded-sm shadow-xl flex items-center gap-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-mono text-[11px] text-zinc-100">
              <strong className="text-amber-400">VEHICLE CONTROLS:</strong> [W] Gas · [S] Brake / Hold for Reverse · [A/D] Progressive Steer · [Space] Handbrake · [LMB] Turret · [E] Exit
            </span>
            <button
              type="button"
              data-testid="dismiss-vehicle-hint"
              onClick={(e) => {
                e.stopPropagation();
                markVehicleHintSeen();
              }}
              className="px-2 py-0.5 bg-amber-500 text-zinc-950 font-mono text-[10px] font-bold uppercase rounded-xs"
            >
              Got It
            </button>
          </div>
        )}
      </div>

      {/* Tier 1 Active Combat Non-Blocking Tactical Guidance Pill */}
      {hud.activeTacticalHint && !downedState?.active && (
        <div
          data-testid="hud-tier1-tactical-hint"
          className={`absolute left-1/2 -translate-x-1/2 z-20 pointer-events-auto flex items-center gap-2 px-3 py-1 rounded-sm font-mono text-[10px] sm:text-xs shadow-lg border ${
            compactHud ? 'bottom-20' : 'bottom-44'
          } ${
            hud.activeTacticalHint.priority === 'critical'
              ? 'bg-red-950/92 border-red-500/80 text-red-200'
              : hud.activeTacticalHint.priority === 'tactical'
                ? 'bg-[#0B0E11]/92 border-amber-400/80 text-amber-200'
                : 'bg-[#0B0E11]/90 border-cyan-400/75 text-cyan-200'
          }`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {hud.activeTacticalHint.actionKey && (
            <span className="px-1.5 py-0.5 bg-zinc-950 border border-white/25 text-amber-300 font-bold rounded-xs text-[9px] sm:text-[10px]">
              [{hud.activeTacticalHint.actionKey}]
            </span>
          )}
          <span className="tracking-wide">{hud.activeTacticalHint.text}</span>
          {hud.activeTacticalHint.dismissible && (
            <button
              type="button"
              data-testid="dismiss-tactical-hint"
              onClick={(e) => {
                e.stopPropagation();
                if (hud.activeTacticalHint) {
                  dismissTacticalHint(hud.activeTacticalHint.id);
                }
              }}
              className="ml-1 px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[9px] uppercase rounded-xs cursor-pointer"
            >
              OK
            </button>
          )}
        </div>
      )}

      {hud.liftStatus && !downedState?.active && (
        <div
          data-testid="hud-lift-status"
          className={`absolute left-1/2 -translate-x-1/2 bg-[#0B0E11]/92 border border-cyan-400/60 px-3 py-1 rounded-sm font-mono text-[10px] text-zinc-100 shadow-lg flex items-center gap-2 whitespace-nowrap ${
            compactHud ? 'bottom-28' : 'bottom-52'
          }`}
        >
          <span className="text-cyan-400 font-bold uppercase">{hud.liftStatus.liftName}</span>
          <span className="text-zinc-500">·</span>
          <span className="text-amber-300">
            {hud.liftStatus.state === 'traveling' || hud.liftStatus.state === 'doors_closing'
              ? `${hud.liftStatus.currentFloorLabel} → ${hud.liftStatus.targetFloorLabel}`
              : hud.liftStatus.currentFloorLabel}
          </span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-300 tabular-nums">
            {hud.liftStatus.occupantCount}/{hud.liftStatus.maxOccupants}
          </span>
        </div>
      )}

      {!compactHud && (hud.interactPrompt || (!hud.inVehicle && hud.canVault)) && (
        <div
          data-testid={hud.interactPrompt ? 'hud-interact-prompt' : 'hud-vault-prompt'}
          className={`absolute bottom-36 left-1/2 -translate-x-1/2 bg-[#0B0E11]/90 px-4 py-1.5 rounded-sm font-mono text-xs tracking-wider ${
            hud.interactPrompt
              ? 'border border-amber-500 text-amber-400'
              : 'border border-cyan-400/80 text-cyan-300'
          }`}
        >
          {hud.interactPrompt ?? '[SPACE] VAULT'}
        </div>
      )}

      {hud.activeRadioSubtitle ? (
        <div
          data-testid="hud-squad-radio-subtitle"
          className={`absolute left-1/2 -translate-x-1/2 bg-[#0B0E11]/92 border-l-2 border-y border-r px-3 py-1.5 rounded-xs flex items-center gap-2 text-[10px] sm:text-xs text-zinc-100 shadow-lg ${
            hud.activeRadioSubtitle.priority === 'CRITICAL'
              ? 'border-l-red-500 border-red-500/40'
              : hud.activeRadioSubtitle.priority === 'TACTICAL'
                ? 'border-l-amber-400 border-zinc-700'
                : 'border-l-cyan-400 border-zinc-800'
          } ${compactHud ? 'bottom-[68px] max-w-[330px]' : 'bottom-24 max-w-md sm:max-w-xl'}`}
        >
          <Radio
            className={`w-3.5 h-3.5 shrink-0 ${
              hud.activeRadioSubtitle.priority === 'CRITICAL'
                ? 'text-red-400'
                : hud.activeRadioSubtitle.priority === 'TACTICAL'
                  ? 'text-amber-400'
                  : 'text-cyan-400'
            }`}
          />
          <span className="font-mono text-[9.5px] uppercase font-bold text-amber-300 whitespace-nowrap shrink-0">
            [{hud.activeRadioSubtitle.roleBadge}] {hud.activeRadioSubtitle.callsign}:
          </span>
          <span className="text-left leading-snug">{hud.activeRadioSubtitle.text}</span>
        </div>
      ) : (
        hud.subtitleText && (
          <div
            data-testid="hud-tier2-radio-subtitle"
            className={`absolute left-1/2 -translate-x-1/2 bg-[#0B0E11]/88 border border-zinc-800 px-3 py-1 rounded-sm flex items-center gap-2 text-[10px] sm:text-xs text-zinc-200 text-center ${
              compactHud ? 'bottom-[68px] max-w-[320px]' : 'bottom-24 max-w-md sm:max-w-xl'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>{hud.subtitleText}</span>
          </div>
        )
      )}

      {/* Desktop Bottom-Left Health & Armor Telemetry */}
      {!compactHud && (
        <div className="absolute bottom-4 left-4 bg-[#0B0E11]/85 border border-zinc-800 px-4 py-3 rounded-sm min-w-[230px]">
          <div className="flex items-center justify-between text-xs font-mono mb-1.5">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <Shield className="w-3.5 h-3.5" /> ARMOR
            </span>
            <span className="tabular-nums text-zinc-200">
              {hud.armor}/{hud.maxArmor}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 mb-2.5 overflow-hidden">
            <div
              className="h-full bg-cyan-400 transition-all duration-150"
              style={{ width: `${Math.round((hud.armor / Math.max(1, hud.maxArmor)) * 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs font-mono mb-1.5">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Heart className="w-3.5 h-3.5" /> HEALTH
              {hud.isRegenerating && (
                <span
                  data-testid="hud-regen-badge"
                  className="text-[9px] px-1 py-0.2 bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 rounded-xs"
                >
                  +REGEN
                </span>
              )}
            </span>
            <span
              className={`tabular-nums font-bold ${
                criticalHp ? 'text-red-400' : 'text-zinc-100'
              }`}
            >
              {hud.health}/{hud.maxHealth}
            </span>
          </div>
          <div className="h-2 bg-zinc-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${
                criticalHp ? 'bg-red-500' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.round((hud.health / Math.max(1, hud.maxHealth)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Desktop Bottom-Right Ordnance Strip + Weapon / Vehicle Status Panel (single flex group to prevent overlap) */}
      {!compactHud && (
        <div className="absolute bottom-4 right-4 flex items-end gap-3">
          {hud.ordnance && (
            <div className="hidden md:flex items-center gap-2 bg-[#0B0E11]/85 border border-zinc-800 px-3 py-2 rounded-sm font-mono text-[10px] shrink-0">
              <div className="flex flex-col pr-2 border-r border-zinc-800">
                <span className="text-zinc-400">[C] C4 PACK</span>
                <span className={hud.ordnance.c4Deployed > 0 ? 'text-amber-400 font-bold' : 'text-zinc-200'}>
                  INV {hud.ordnance.c4Inventory} · SET {hud.ordnance.c4Deployed}/{hud.ordnance.c4MaxDeployed}
                </span>
              </div>

              <div className="flex flex-col px-2 border-r border-zinc-800">
                <span className="text-zinc-400 flex items-center gap-1">
                  <Bomb className="w-3 h-3 text-amber-400" />
                  [V]/[SH+V] {hud.ordnance.selectedBombShort}
                </span>
                <span className={hud.ordnance.bombCooldownSec > 0 ? 'text-red-400' : 'text-cyan-300'}>
                  {hud.ordnance.bombCooldownSec > 0
                    ? `CD ${hud.ordnance.bombCooldownSec.toFixed(1)}s`
                    : hud.ordnance.sandboxAuthorized
                      ? 'SANDBOX READY'
                      : `${hud.ordnance.selectedBombCost} REQ`}
                </span>
              </div>

              <div className="flex flex-col pl-1">
                <span className="text-zinc-400">[N] TRIDENT-X</span>
                <span
                  className={
                    hud.ordnance.nukeUsed
                      ? 'text-zinc-500'
                      : hud.ordnance.sandboxAuthorized || hud.ordnance.requisitionPoints >= hud.ordnance.nukeCost
                        ? 'text-amber-400 font-bold'
                        : 'text-zinc-400'
                  }
                >
                  {hud.ordnance.nukeUsed
                    ? 'EXPENDED'
                    : hud.ordnance.sandboxAuthorized
                      ? 'SANDBOX READY'
                      : `${hud.ordnance.nukeCost} REQ`}
                </span>
              </div>
            </div>
          )}

          <div className="bg-[#0B0E11]/85 border border-zinc-800 px-4 py-3 rounded-sm min-w-[260px] flex flex-col items-end shrink-0">
            {hud.inVehicle ? (
              <>
                <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
                  CAM: {VEHICLE_CAMERA_MODE_LABELS[hud.vehicleCameraMode]} [F]
                </div>
                <div className="font-display text-lg font-bold uppercase text-zinc-100 mt-0.5">
                  {hud.vehicleName}
                </div>
                <div className="flex items-baseline gap-3 mt-1 font-mono tabular-nums">
                  <span
                    className={`px-1.5 py-0.5 text-xs font-bold rounded-xs ${
                      hud.vehicleGear === 'REVERSE'
                        ? 'bg-red-600/80 text-white'
                        : hud.vehicleGear === 'BRAKING' || hud.vehicleGear === 'NEUTRAL_HOLD'
                          ? 'bg-amber-500/80 text-zinc-950'
                          : 'bg-emerald-500/25 border border-emerald-400/60 text-emerald-300'
                    }`}
                  >
                    {hud.vehicleGear === 'REVERSE'
                      ? 'REV'
                      : hud.vehicleGear === 'NEUTRAL_HOLD'
                        ? 'N'
                        : hud.vehicleGear === 'BRAKING'
                          ? 'BRK'
                          : 'FWD'}
                  </span>
                  <span className="text-2xl font-bold text-amber-400 tabular-nums">{hud.vehicleSpeedKmh} KM/H</span>
                  <span
                    className={`text-xs tabular-nums ${
                      hud.vehicleHealth <= 35 ? 'text-red-400 font-semibold' : 'text-zinc-400'
                    }`}
                  >
                    HULL {hud.vehicleHealth}%
                  </span>
                  {hud.vehicleMaxTurretAmmo > 0 && (
                    <span
                      className={`text-xs tabular-nums ${
                        hud.vehicleTurretAmmo <= 20 ? 'text-amber-300 font-semibold' : 'text-zinc-300'
                      }`}
                    >
                      TURRET {hud.vehicleTurretAmmo}/{hud.vehicleMaxTurretAmmo}
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-[10px] text-zinc-400">
                  [W/S] GAS/REV · [A/D] STEER · [SPACE] DRIFT · [E] SERVICE/EXIT
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 w-full justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 bg-zinc-800 text-amber-400">
                    {hud.fireMode.toUpperCase()} [B]
                  </span>
                  <span className="font-display text-sm font-bold uppercase tracking-wider text-zinc-200">
                    {hud.weaponName}
                  </span>
                </div>

                <div className="flex items-center justify-between w-full mt-1.5 gap-4">
                  <WeaponSilhouette
                    weaponId={hud.weaponId}
                    className="w-28 h-8 text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.4)]"
                  />
                  <div className="text-right font-mono tabular-nums">
                    <span className={`text-3xl font-bold ${hud.ammoInMag === 0 ? 'text-red-400' : 'text-white'}`}>
                      {hud.ammoInMag}
                    </span>
                    <span className="text-sm text-zinc-400 ml-1">/ {hud.reserveAmmo}</span>
                  </div>
                </div>

                {hud.isReloading && (
                  <div className="w-full mt-2">
                    <div className="h-1 bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-amber-400"
                        style={{ width: `${Math.round(hud.reloadProgress * 100)}%` }}
                      />
                    </div>
                    <div className="font-mono text-[10px] text-amber-400 text-right mt-0.5">RELOADING...</div>
                  </div>
                )}

                <div className="flex items-center justify-between w-full gap-3 mt-1.5 font-mono text-[10px] text-zinc-400">
                  <span>[1-9] WEAPONS · [G] FRAG x{hud.grenades}</span>
                  <button
                    type="button"
                    data-testid="desktop-btn-rpg"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      inputManager?.queueWeaponSlot(hud.rpgEquipped ? 1 : 7);
                    }}
                    className={`pointer-events-auto px-2 py-0.5 rounded-xs border flex items-center gap-1 font-bold transition-colors ${
                      hud.rpgEquipped
                        ? 'bg-amber-500/30 border-amber-400 text-amber-200'
                        : 'bg-[#141920] border-amber-500/50 text-amber-300 hover:border-amber-400'
                    }`}
                  >
                    <Rocket className="w-3 h-3" />
                    <span>[7] RPG {hud.rpgAmmoInMag}/{hud.rpgReserveAmmo}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Non-Pausing [TAB] Tactical Overview Drawer (Full Stage Breakdown, Retroactive Status & Theater Intel) */}
      {(tacticalOverviewOpen || hudMode === 'expanded') && !downedState?.active && (
        <TacticalOverviewDrawer
          hud={hud}
          missionVisualProfile={missionVisualProfile}
          tacticalOverviewOpen={tacticalOverviewOpen}
          completedObjectivesCount={completedObjectivesCount}
          formatObjectiveDistance={formatObjectiveDistance}
          onClose={() => setTacticalOverviewOpen(false)}
        />
      )}

      {/* Solo Operator Compact Trauma Charge Indicator (No Squad Controls) */}
      {hud.deploymentMode === 'solo' && hud.soloTraumaKit && !compactHud && !downedState?.active && (
        <div
          data-testid="hud-solo-trauma-status"
          className="absolute bottom-36 left-4 z-20 bg-[#0B0E11]/86 border border-zinc-800 rounded-sm px-3 py-1.5 font-mono text-[10px] flex items-center gap-2.5 pointer-events-none"
        >
          <span className="text-amber-400 font-bold uppercase tracking-wider">SOLO OPERATOR</span>
          <span className="text-zinc-700">|</span>
          <span
            className={
              hud.soloTraumaKit.chargesRemaining > 0 ? 'text-emerald-400 font-semibold' : 'text-zinc-500'
            }
          >
            TRAUMA REVIVE {hud.soloTraumaKit.chargesRemaining}/{hud.soloTraumaKit.maxCharges}
          </span>
        </div>
      )}

      {/* Tactical Downed / Kill-Cam Overlay (with Solo Emergency Trauma Revive when available) */}
      {downedState?.active && (
        <DownedActionOverlay
          downedState={downedState}
          onTriggerSoloSelfRecovery={onTriggerSoloSelfRecovery}
          onRestartCheckpoint={onRestartCheckpoint}
          onRestartMission={onRestartMission}
          onAbort={onAbort}
        />
      )}

      {/* Stage 7 TRN-37 Fireteam Status Strip, Hold-[Q] Radial Wheel & Supply Swap (Solo hides squad UI, keeps Field Swap) */}
      {onSwapFieldWeapon && (
        <SquadCommandHud
          hud={hud}
          compactHud={compactHud}
          downedActive={Boolean(downedState?.active)}
          onIssueCommand={hud.deploymentMode === 'solo' ? undefined : onIssueSquadCommand}
          onSwapFieldWeapon={onSwapFieldWeapon}
        />
      )}

      {/* Multi-Touch Virtual Twin-Stick & Profile-Aware Action Overlay */}
      {touchControlsVisible && !downedState?.active && (
        <MobileTouchControls
          inputManager={inputManager}
          hud={hud}
          onIssueSquadCommand={hud.deploymentMode === 'solo' ? undefined : onIssueSquadCommand}
        />
      )}
    </div>
  );
}
