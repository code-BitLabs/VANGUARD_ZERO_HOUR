import React from 'react';
import {
  Crosshair,
  Shield,
  Heart,
  Radio,
  Compass,
  Bomb,
  AlertTriangle,
  BarChart3,
  Pause,
  Gamepad2,
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
  const devModeActive = isEnvDevModeAllowed() && devModeEnabled;
  const warnCount = combatDebug?.warnings.length ?? 0;
  const liveFps = combatDebug?.performance.fps ?? diagnostics.fps;
  const viewport = useViewportMode();
  const compactHud = touchControlsVisible || viewport.isCompactLandscape;

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
  const [showHit, setShowHit] = React.useState(false);

  React.useEffect(() => {
    if (!hitFeedback) return;
    setShowHit(true);
    const id = window.setTimeout(() => setShowHit(false), 180);
    return () => window.clearTimeout(id);
  }, [hitFeedback?.id]);

  const radarSizePx = compactHud ? 68 : 112;
  const radarCenter = radarSizePx / 2;
  const radarRadius = radarCenter - 5;

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

      {/* Top Center Compass & Boss Gunship Bar */}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5"
        style={{ top: 'max(10px, env(safe-area-inset-top, 0px))' }}
      >
        <div className="bg-[#0B0E11]/85 border border-zinc-800 px-3 sm:px-4 py-1 rounded-sm flex items-center gap-2 sm:gap-3 font-mono text-[11px] sm:text-xs tabular-nums whitespace-nowrap">
          <Compass className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-zinc-400">{Math.round(headingDeg)}°</span>
          <span className="text-amber-400 font-bold w-5 text-center">{cardinal}</span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-300">SCORE {hud.score}</span>
          <span className="text-zinc-600 hidden sm:inline">|</span>
          <span className="text-cyan-400 hidden sm:inline">
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

        {hud.activeBossLabel && (
          <div className="w-60 sm:w-72 bg-[#0B0E11]/90 border border-red-500/60 px-3 py-1 rounded-sm">
            <div className="flex justify-between font-mono text-[10px] text-red-400 mb-1">
              <span>{hud.activeBossLabel}</span>
              <span>{Math.round(hud.activeBossHealthPct * 100)}%</span>
            </div>
            <div className="h-1.5 bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all duration-150"
                style={{ width: `${Math.round(hud.activeBossHealthPct * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Top-Left Radar Mini-Map & Active Objectives */}
      <div
        className="absolute flex flex-col gap-1.5 max-w-[38vw] sm:max-w-xs"
        style={{
          top: 'max(10px, env(safe-area-inset-top, 0px))',
          left: 'max(10px, env(safe-area-inset-left, 0px))',
        }}
      >
        <div className="flex items-start gap-2">
          <div
            style={{ width: `${radarSizePx}px`, height: `${radarSizePx}px` }}
            className="relative rounded-full bg-[#0B0E11]/85 border-2 border-zinc-700 overflow-hidden shrink-0"
          >
            <div className="absolute inset-0 border border-zinc-800/70 rounded-full scale-50" />
            <div
              className="absolute left-1/2 top-1/2 w-2 h-2 -ml-1 -mt-1 bg-cyan-400 rounded-full"
              title="Player"
            />
            {hud.blips.slice(0, 28).map((b) => {
              const dx = b.x - hud.playerX;
              const dz = b.z - hud.playerZ;
              const cos = Math.cos(hud.playerYaw);
              const sin = Math.sin(hud.playerYaw);
              const rx = dx * cos - dz * sin;
              const rz = dx * sin + dz * cos;
              const px = Math.max(4, Math.min(radarSizePx - 4, radarCenter + (rx / 95) * radarRadius));
              const py = Math.max(4, Math.min(radarSizePx - 4, radarCenter + (rz / 95) * radarRadius));
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

          <div
            className={`bg-[#0B0E11]/82 border border-zinc-800/90 rounded-sm ${
              compactHud ? 'px-2 py-1.5 space-y-1 min-w-[155px]' : 'px-3 py-2 space-y-2 min-w-[215px]'
            }`}
          >
            <div className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-amber-400">
              Mission Objectives
            </div>
            {hud.objectives.map((o) => {
              const distMeters =
                !o.completed && o.markerPos
                  ? Math.round(Math.hypot(o.markerPos.x - hud.playerX, o.markerPos.z - hud.playerZ))
                  : null;
              return (
                <div key={o.id} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs">
                    <span className={o.completed ? 'line-through text-emerald-400/80' : 'text-zinc-100 font-medium'}>
                      {o.title}
                    </span>
                    <span className="font-mono text-[10px] sm:text-[11px] tabular-nums text-amber-400 shrink-0">
                      {distMeters !== null ? `${distMeters}m · ` : ''}
                      {o.current}/{o.target}
                    </span>
                  </div>
                  {!compactHud && !o.completed && o.description && (
                    <div className="text-[10px] text-zinc-400 leading-tight">{o.description}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Compact Mobile Vitals directly below Radar/Objectives so bottom-left stays free for left thumbstick */}
        {compactHud && (
          <div className="bg-[#0B0E11]/85 border border-zinc-800 px-2.5 py-1.5 rounded-sm w-[180px] space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-cyan-400 flex items-center gap-1">
                <Shield className="w-3 h-3" /> ARM {hud.armor}
              </span>
              <span className={`font-bold flex items-center gap-1 ${hud.health < 35 ? 'text-red-400' : 'text-emerald-400'}`}>
                <Heart className="w-3 h-3" /> {hud.health}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="h-1 bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-cyan-400"
                  style={{ width: `${Math.round((hud.armor / hud.maxArmor) * 100)}%` }}
                />
              </div>
              <div className="h-1 bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full ${hud.health < 35 ? 'bg-red-500' : 'bg-emerald-400'}`}
                  style={{ width: `${Math.round((hud.health / hud.maxHealth) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Top-Right Pause, Touch Toggle, Diagnostics Launcher & Compact Mobile Weapon Status */}
      <div
        className="absolute z-30 flex flex-col items-end gap-1.5 pointer-events-none"
        style={{
          top: 'max(10px, env(safe-area-inset-top, 0px))',
          right: 'max(10px, env(safe-area-inset-right, 0px))',
        }}
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
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
              className="pointer-events-auto flex items-center gap-2 px-2.5 min-h-[44px] bg-[#0B0E11]/90 hover:bg-[#141920] border border-zinc-700/90 rounded-sm font-mono text-[11px] tabular-nums text-zinc-200 whitespace-nowrap shrink-0 transition-colors"
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
            className={`pointer-events-auto min-w-[44px] min-h-[44px] px-2.5 rounded-sm border flex items-center justify-center gap-1 font-mono text-[10px] transition-colors ${
              touchControlsVisible
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : 'bg-[#0B0E11]/85 border-zinc-700 text-zinc-300 hover:bg-[#141920]'
            }`}
          >
            <Gamepad2 className="w-4 h-4 shrink-0" />
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
              className="pointer-events-auto min-w-[44px] min-h-[44px] px-2.5 bg-[#0B0E11]/90 hover:bg-[#141920] border border-zinc-700 rounded-sm text-zinc-100 flex items-center justify-center transition-colors"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Compact Top-Right Weapon/Vehicle Pill-Free Readout when Touch HUD is active */}
        {compactHud && (
          <div className="bg-[#0B0E11]/85 border border-zinc-800 px-2.5 py-1.5 rounded-sm font-mono text-right min-w-[140px]">
            {hud.inVehicle ? (
              <div>
                <div className="text-[10px] text-emerald-400 uppercase">{hud.vehicleName}</div>
                <div className="text-sm font-bold text-amber-400 tabular-nums">
                  {hud.vehicleSpeedKmh} KM/H · HULL {hud.vehicleHealth}%
                </div>
              </div>
            ) : (
              <div>
                <div className="text-[10px] text-zinc-300 font-bold uppercase">{hud.weaponName}</div>
                <div className="tabular-nums leading-tight">
                  <span className={`text-lg font-bold ${hud.ammoInMag === 0 ? 'text-red-400' : 'text-white'}`}>
                    {hud.ammoInMag}
                  </span>
                  <span className="text-[11px] text-zinc-400"> / {hud.reserveAmmo}</span>
                </div>
                {hud.isReloading && (
                  <div className="h-1 bg-zinc-800 mt-1 overflow-hidden">
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
      <div className="absolute top-20 sm:top-28 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 pointer-events-none">
        {hud.missionAlert && (
          <div className="bg-[#141920]/95 border border-amber-500/70 px-4 py-1.5 rounded-sm font-display text-xs sm:text-sm uppercase tracking-widest text-amber-400 shadow-lg text-center">
            {hud.missionAlert}
          </div>
        )}

        {hud.ordnance && hud.ordnance.nukePendingConfirmSec > 0 && (
          <div className="bg-[#1b1010]/95 border-2 border-red-500 px-4 py-2 rounded-sm text-center shadow-2xl">
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
          <div className="bg-red-950/95 border-2 border-amber-400 px-5 py-2 rounded-sm text-center shadow-2xl">
            <div className="font-display text-sm sm:text-base font-bold uppercase tracking-widest text-amber-300">
              STRATEGIC IMPACT IN {hud.ordnance.nukeCountdownSec.toFixed(1)}s — SEEK COVER
            </div>
          </div>
        )}

        {hud.ordnance && hud.ordnance.inFalloutZone && (
          <div className="bg-amber-950/90 border border-amber-500 px-3 py-1 rounded-sm font-mono text-[11px] text-amber-300 tracking-wider">
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
          className={`absolute left-1/2 -translate-x-1/2 bg-[#0B0E11]/85 border border-zinc-800 px-3.5 py-1.5 rounded-sm flex items-center gap-2 text-[11px] sm:text-xs text-zinc-200 max-w-md sm:max-w-xl text-center ${
            compactHud ? 'bottom-16' : 'bottom-24'
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

      {/* Multi-Touch Virtual Twin-Stick & Action Overlay */}
      {touchControlsVisible && <MobileTouchControls inputManager={inputManager} hud={hud} />}
    </div>
  );
}
