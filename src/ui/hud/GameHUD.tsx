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
  Pause,
  Radio,
  Shield,
} from 'lucide-react';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { InputManager } from '@/src/engine/InputManager';
import { VEHICLE_CAMERA_MODE_LABELS } from '@/src/gameplay/VehicleCameraRig';
import { useGameSessionStore } from '@/src/stores/gameSessionStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { uiStore, useUIStore } from '@/src/stores/uiStore';
import { WeaponSilhouette } from '@/src/ui/components/WeaponSilhouette';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { MobileTouchControls } from './MobileTouchControls';

export function GameHUD({
  onRequestPointerLock,
  onPause,
  inputManager = null,
  touchControlsVisible = false,
}: {
  onRequestPointerLock: () => void;
  onPause?: () => void;
  inputManager?: InputManager | null;
  touchControlsVisible?: boolean;
}) {
  const hud = useGameSessionStore((s) => s.hud);
  const hitFeedback = useGameSessionStore((s) => s.hitFeedback);
  const killFeed = useGameSessionStore((s) => s.killFeed);
  const damageArcs = useGameSessionStore((s) => s.damageArcs);
  const diagnostics = useGameSessionStore((s) => s.diagnostics);
  const combatDebug = useGameSessionStore((s) => s.combatDebug);
  const combatDebugOpen = useUIStore((s) => s.combatDebugOpen);
  const combatDebugCollapsed = useUIStore((s) => s.combatDebugCollapsed);
  const pointerLocked = useUIStore((s) => s.pointerLocked);
  const setCombatDebugOpen = useUIStore((s) => s.setCombatDebugOpen);
  const setCombatDebugCollapsed = useUIStore((s) => s.setCombatDebugCollapsed);
  const colorblind = useSettingsStore((s) => s.accessibility.colorblindMode);
  const uiScale = useSettingsStore((s) => s.accessibility.uiScale);
  const devModeEnabled = useSettingsStore((s) => s.developer.devModeEnabled);
  const touchControlProfile = useSettingsStore((s) => s.input.touchControlProfile);
  const touchFirePosThreeFinger = useSettingsStore((s) => s.input.touchFirePosThreeFinger);
  const devModeActive = isEnvDevModeAllowed() && devModeEnabled;
  const warnCount = combatDebug?.warnings.length ?? 0;
  const liveFps = combatDebug?.performance.fps ?? diagnostics.fps;
  const viewport = useViewportMode();
  const compactHud = touchControlsVisible || viewport.isCompactLandscape;

  const [objectivesExpanded, setObjectivesExpanded] = useState(false);
  const [showHit, setShowHit] = useState(false);

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

  // In Three-Finger Claw mode, if the upper-left Fire button is placed in the top-left quadrant,
  // shift the compact Radar & Mission Objective cluster rightward so it never collides with the left index finger Fire button.
  const clawTopLeftConflict =
    touchControlsVisible &&
    touchControlProfile === 'three_finger' &&
    touchFirePosThreeFinger.x < 0.32 &&
    touchFirePosThreeFinger.y < 0.48;

  const topLeftOffsetPx = clawTopLeftConflict
    ? Math.max(132, Math.round(viewport.width * touchFirePosThreeFinger.x + 56))
    : 10;

  const activeObjective =
    hud.objectives.find((o) => !o.completed) ?? hud.objectives[hud.objectives.length - 1] ?? null;
  const completedObjectivesCount = hud.objectives.filter((o) => o.completed).length;

  const formatObjectiveDistance = (o: (typeof hud.objectives)[number]) => {
    if (o.completed || !o.markerPos) return null;
    return Math.round(Math.hypot(o.markerPos.x - hud.playerX, o.markerPos.z - hud.playerZ));
  };

  return (
    <div
      className="fixed inset-0 z-10 pointer-events-none select-none overflow-hidden"
      style={{ transform: uiScale !== 1 ? `scale(${uiScale})` : undefined }}
      onClick={() => {
        if (!touchControlsVisible && !viewport.isCoarsePointer) {
          onRequestPointerLock();
        }
      }}
    >
      {/* Low-Health Crimson Vignette */}
      {hud.health < 35 && (
        <div
          className="absolute inset-0 transition-opacity duration-200"
          style={{
            boxShadow: `inset 0 0 120px rgba(220, 38, 38, ${0.55 - hud.health / 80})`,
          }}
        />
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

      {/* Dynamic Center Reticle & Hit Markers */}
      {!hud.isScoped && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative flex items-center justify-center">
            <div className="w-1 h-1 rounded-full bg-white/95" />
            <div
              className="absolute w-2.5 h-0.5 bg-white/85"
              style={{ transform: `translateX(${-spreadPx - 5}px)` }}
            />
            <div
              className="absolute w-2.5 h-0.5 bg-white/85"
              style={{ transform: `translateX(${spreadPx + 5}px)` }}
            />
            <div
              className="absolute w-0.5 h-2.5 bg-white/85"
              style={{ transform: `translateY(${-spreadPx - 5}px)` }}
            />
            <div
              className="absolute w-0.5 h-2.5 bg-white/85"
              style={{ transform: `translateY(${spreadPx + 5}px)` }}
            />

            {hitFeedback && showHit && (
              <Crosshair
                key={hitFeedback.id}
                className="w-7 h-7 rotate-45"
                style={{
                  color: hitFeedback.isHeadshot ? '#f59e0b' : hitFeedback.isKill ? threatColor : '#ffffff',
                }}
              />
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
        className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
        style={{ top: 'max(6px, env(safe-area-inset-top, 0px))' }}
      >
        <div
          data-testid="hud-compass-strip"
          className="bg-[#0B0E11]/72 border border-white/12 px-2.5 sm:px-3.5 py-0.5 rounded-sm flex items-center gap-2 sm:gap-2.5 font-mono text-[10px] sm:text-xs tabular-nums whitespace-nowrap shadow-sm"
        >
          <Compass className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400 shrink-0" />
          <span className="text-zinc-300">{Math.round(headingDeg)}°</span>
          <span className="text-amber-400 font-bold w-4 text-center">{cardinal}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-200">SCORE {hud.score}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-cyan-400">
            {String(Math.floor(hud.elapsedSec / 60)).padStart(2, '0')}:
            {String(hud.elapsedSec % 60).padStart(2, '0')}
          </span>
        </div>

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

        {/* Compact Encounter-Relevant Aircraft Health Bar */}
        {hud.activeBossLabel && (
          <div
            data-testid="hud-boss-bar"
            className="w-40 sm:w-56 bg-[#0B0E11]/78 border border-red-500/55 px-2 py-0.5 rounded-sm shadow-sm"
          >
            <div className="flex justify-between items-center font-mono text-[9px] sm:text-[10px] text-red-300 leading-none mb-0.5">
              <span className="truncate max-w-[115px] sm:max-w-[165px]">{hud.activeBossLabel}</span>
              <span className="tabular-nums font-bold">{Math.round(hud.activeBossHealthPct * 100)}%</span>
            </div>
            <div className="h-1 bg-zinc-800/90 overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all duration-150"
                style={{ width: `${Math.round(hud.activeBossHealthPct * 100)}%` }}
              />
            </div>
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
        {/* Radar Mini-Map */}
        <div
          style={{ width: `${radarSizePx}px`, height: `${radarSizePx}px` }}
          className="relative rounded-full bg-[#0B0E11]/78 border border-zinc-700/90 overflow-hidden shrink-0"
        >
          <div className="absolute inset-0 border border-zinc-800/70 rounded-full scale-50" />
          <div
            className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-0.75 -mt-0.75 bg-cyan-400 rounded-full"
            title="Player"
          />
          {hud.blips.slice(0, 28).map((b) => {
            const dx = b.x - hud.playerX;
            const dz = b.z - hud.playerZ;
            const cos = Math.cos(hud.playerYaw);
            const sin = Math.sin(hud.playerYaw);
            const rx = dx * cos - dz * sin;
            const rz = dx * sin + dz * cos;
            const px = Math.max(3, Math.min(radarSizePx - 3, radarCenter + (rx / 95) * radarRadius));
            const py = Math.max(3, Math.min(radarSizePx - 3, radarCenter + (rz / 95) * radarRadius));
            const color =
              b.kind === 'objective'
                ? '#f59e0b'
                : b.kind === 'friendly_vehicle'
                  ? '#10b981'
                  : b.kind === 'air'
                    ? '#38bdf8'
                    : threatColor;
            return (
              <div
                key={b.id}
                className="absolute w-1.5 h-1.5 -ml-0.75 -mt-0.75 rounded-full"
                style={{ left: `${px}px`, top: `${py}px`, backgroundColor: color }}
              />
            );
          })}
        </div>

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
                    <span>Mission Objectives</span>
                    <span>
                      {completedObjectivesCount}/{hud.objectives.length}
                    </span>
                  </div>
                  {hud.objectives.map((o) => {
                    const dist = formatObjectiveDistance(o);
                    return (
                      <div key={o.id} className="flex items-center justify-between gap-2 text-[10px]">
                        <span className={o.completed ? 'line-through text-emerald-400/80 truncate' : 'text-zinc-200 truncate'}>
                          {o.title}
                        </span>
                        <span className="font-mono text-[9px] tabular-nums text-amber-400 shrink-0">
                          {dist !== null ? `${dist}m · ` : ''}
                          {o.current}/{o.target}
                        </span>
                      </div>
                    );
                  })}
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
            /* Desktop Objectives Panel */
            <div className="bg-[#0B0E11]/82 border border-zinc-800/90 rounded-sm px-3 py-2 space-y-1.5 min-w-[215px]">
              <div className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
                Mission Objectives
              </div>
              {hud.objectives.map((o) => {
                const distMeters = formatObjectiveDistance(o);
                return (
                  <div key={o.id} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={o.completed ? 'line-through text-emerald-400/80' : 'text-zinc-100 font-medium'}>
                        {o.title}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-amber-400 shrink-0">
                        {distMeters !== null ? `${distMeters}m · ` : ''}
                        {o.current}/{o.target}
                      </span>
                    </div>
                    {!o.completed && o.description && (
                      <div className="text-[10px] text-zinc-400 leading-tight">{o.description}</div>
                    )}
                  </div>
                );
              })}
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
        <div className="flex items-center gap-1.5 pointer-events-none">
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
            <span className="hidden sm:inline">TOUCH</span>
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

      {/* Mission Alert & Strategic Ordnance Warnings */}
      <div className="absolute top-14 sm:top-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
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
      </div>

      {!compactHud && hud.interactPrompt && (
        <div className="absolute bottom-36 left-1/2 -translate-x-1/2 bg-[#0B0E11]/90 border border-amber-500 px-4 py-1.5 rounded-sm font-mono text-xs text-amber-400 tracking-wider">
          {hud.interactPrompt}
        </div>
      )}

      {hud.subtitleText && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 bg-[#0B0E11]/82 border border-zinc-800 px-3 py-1 rounded-sm flex items-center gap-2 text-[10px] sm:text-xs text-zinc-200 max-w-md sm:max-w-xl text-center ${
            compactHud ? 'bottom-12' : 'bottom-24'
          }`}
        >
          <Radio className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>{hud.subtitleText}</span>
        </div>
      )}

      {/* Desktop Bottom-Left Health & Armor Telemetry */}
      {!compactHud && (
        <div className="absolute bottom-4 left-4 bg-[#0B0E11]/85 border border-zinc-800 px-4 py-3 rounded-sm min-w-[230px]">
          <div className="flex items-center justify-between text-xs font-mono mb-1.5">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <Shield className="w-3.5 h-3.5" /> ARMOR
            </span>
            <span className="tabular-nums text-zinc-200">{hud.armor}</span>
          </div>
          <div className="h-1.5 bg-zinc-800 mb-2.5 overflow-hidden">
            <div
              className="h-full bg-cyan-400 transition-all duration-150"
              style={{ width: `${Math.round((hud.armor / hud.maxArmor) * 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs font-mono mb-1.5">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Heart className="w-3.5 h-3.5" /> HEALTH
            </span>
            <span
              className={`tabular-nums font-bold ${
                hud.health < 35 ? 'text-red-400' : 'text-zinc-100'
              }`}
            >
              {hud.health}
            </span>
          </div>
          <div className="h-2 bg-zinc-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${
                hud.health < 35 ? 'bg-red-500' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.round((hud.health / hud.maxHealth) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Desktop Bottom-Right Weapon / Vehicle Status Panel */}
      {!compactHud && (
        <div className="absolute bottom-4 right-4 bg-[#0B0E11]/85 border border-zinc-800 px-4 py-3 rounded-sm min-w-[250px] flex flex-col items-end">
          {hud.inVehicle ? (
            <>
              <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
                CAM: {VEHICLE_CAMERA_MODE_LABELS[hud.vehicleCameraMode]} [F]
              </div>
              <div className="font-display text-lg font-bold uppercase text-zinc-100 mt-0.5">
                {hud.vehicleName}
              </div>
              <div className="flex items-baseline gap-4 mt-1 font-mono tabular-nums">
                <span className="text-2xl font-bold text-amber-400">{hud.vehicleSpeedKmh} KM/H</span>
                <span className="text-xs text-zinc-400">HULL {hud.vehicleHealth}%</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-zinc-400">
                LMB TURRET · [E] EXIT VEHICLE
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
                <WeaponSilhouette weaponId={hud.weaponId} className="w-24 h-7 text-zinc-300" />
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

              <div className="flex items-center gap-3 mt-1.5 font-mono text-[10px] text-zinc-400">
                <span>[1-9] WEAPONS</span>
                <span>•</span>
                <span>[G] FRAG x{hud.grenades}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Desktop Tactical Ordnance Strip */}
      {!compactHud && hud.ordnance && (
        <div className="absolute bottom-4 right-[276px] hidden md:flex items-center gap-2 bg-[#0B0E11]/85 border border-zinc-800 px-3 py-2 rounded-sm font-mono text-[10px]">
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

      {/* Multi-Touch Virtual Twin-Stick & Profile-Aware Action Overlay */}
      {touchControlsVisible && <MobileTouchControls inputManager={inputManager} hud={hud} />}
    </div>
  );
}
