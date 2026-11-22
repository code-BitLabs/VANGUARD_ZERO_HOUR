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
  RefreshCw,
  Rocket,
  Shield,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { InputManager } from '@/src/engine/InputManager';
import { DirectorTelemetrySnapshot } from '@/src/engine/RenderingQualityDirector';
import { VEHICLE_CAMERA_MODE_LABELS } from '@/src/gameplay/VehicleCameraRig';
import { SquadCommandSource, SquadOrderType } from '@/src/gameplay/squad/SquadIntentRouter';
import { HudSnapshot } from '@/src/schemas/events.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { useGameSessionStore } from '@/src/stores/gameSessionStore';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { uiStore, useUIStore } from '@/src/stores/uiStore';
import { WeaponSilhouette } from '@/src/ui/components/WeaponSilhouette';
import { getMissionVisualProfile } from '@/src/world/VisualBible';
type MissionVisualProfile = ReturnType<typeof getMissionVisualProfile>;
import { computeMobileHudLayout } from './mobileHudLayoutEngine';
import { MobileTouchControls } from './MobileTouchControls';
import { SquadCommandHud } from './SquadCommandHud';
import { TacticalMiniMap } from './TacticalMiniMap';
import { DownedActionOverlay, TacticalOverviewDrawer } from './TacticalOverlays';

type ObjectiveItem = HudSnapshot['objectives'][number];

function pickActiveObjective(objectives: ObjectiveItem[]): ObjectiveItem | null {
  return (
    objectives.find((o) => !o.completed && o.status === 'active') ??
    objectives.find((o) => !o.completed) ??
    objectives[objectives.length - 1] ??
    null
  );
}

function calcObjectiveDistance(o: ObjectiveItem, playerX: number, playerZ: number): number | null {
  if (o.completed || !o.markerPos) return null;
  return Math.round(Math.hypot(o.markerPos.x - playerX, o.markerPos.z - playerZ));
}

export const HudLowHealthVignette = React.memo(function HudLowHealthVignette() {
  const { health, maxHealth } = useGameSessionStore(
    useShallow((s) => ({
      health: s.hud.health,
      maxHealth: s.hud.maxHealth,
    }))
  );
  const criticalHp = health > 0 && health / Math.max(1, maxHealth) < 0.35;
  if (!criticalHp) return null;
  return (
    <div
      className="absolute inset-0 transition-opacity duration-200"
      style={{
        boxShadow: `inset 0 0 120px rgba(220, 38, 38, ${Math.min(0.65, 0.62 - (health / Math.max(1, maxHealth)) * 0.9)})`,
      }}
    />
  );
});

export const HudWorldObjectiveMarker = React.memo(function HudWorldObjectiveMarker({
  downedActive,
}: {
  downedActive: boolean;
}) {
  const { playerX, playerZ, objectives } = useGameSessionStore(
    useShallow((s) => ({
      playerX: Math.round(s.hud.playerX * 2) * 0.5,
      playerZ: Math.round(s.hud.playerZ * 2) * 0.5,
      objectives: s.hud.objectives,
    }))
  );

  if (downedActive) return null;
  const activeObjective = pickActiveObjective(objectives);
  if (
    !activeObjective ||
    activeObjective.completed ||
    !activeObjective.markerPos ||
    activeObjective.screenX === undefined ||
    activeObjective.screenY === undefined
  ) {
    return null;
  }

  return (
    <div
      data-testid="hud-world-objective-marker"
      className="absolute inset-0 z-15 pointer-events-none transition-transform duration-75 will-change-transform"
      style={{
        transform: `translate3d(${Math.round(activeObjective.screenX * 1000) / 10}%, ${Math.round(activeObjective.screenY * 1000) / 10}%, 0)`,
      }}
    >
      <div className="inline-flex flex-col items-center -translate-x-1/2 -translate-y-1/2">
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
          OBJ · {calcObjectiveDistance(activeObjective, playerX, playerZ) ?? 0}M
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
  );
});

export const HudReticleAndCombatOverlays = React.memo(function HudReticleAndCombatOverlays({
  downedActive,
  threatColor,
}: {
  downedActive: boolean;
  threatColor: string;
}) {
  const { isScoped, crosshairSpread, lockOn, damageArcs, hitFeedback } = useGameSessionStore(
    useShallow((s) => ({
      isScoped: s.hud.isScoped,
      crosshairSpread: s.hud.crosshairSpread,
      lockOn: s.hud.lockOn,
      damageArcs: s.damageArcs,
      hitFeedback: s.hitFeedback,
    }))
  );
  const hudSettings = useSettingsStore((s) => s.hud);
  const showHitmarkers = useSettingsStore((s) => s.gameplay.showHitmarkers);

  const [showHit, setShowHit] = useState(false);

  useEffect(() => {
    if (!hitFeedback) return;
    setShowHit(true);
    const id = window.setTimeout(() => setShowHit(false), 180);
    return () => window.clearTimeout(id);
  }, [hitFeedback?.id]);

  const baseGap = hudSettings.crosshairGap ?? 6;
  const spreadPx = hudSettings.crosshairDynamicSpread
    ? Math.min(34, Math.max(baseGap, Math.round(crosshairSpread * 520)))
    : baseGap;
  const reticleColor = hudSettings.crosshairColor || '#FFFFFF';
  const reticleThickness = Math.max(1, Math.min(4, hudSettings.crosshairThickness || 2));

  return (
    <>
      {isScoped && (
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

      {!isScoped && !downedActive && (
        <div
          data-testid="hud-center-reticle"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <div className="relative flex items-center justify-center">
            {hudSettings.crosshairStyle === 'dot' ? (
              <div
                className="rounded-full ring-1 ring-black/90 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
                style={{
                  width: reticleThickness + 3,
                  height: reticleThickness + 3,
                  backgroundColor: reticleColor,
                }}
              />
            ) : (
              <>
                <div
                  className="rounded-full ring-1 ring-black/90 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
                  style={{
                    width: Math.max(3, reticleThickness + 1),
                    height: Math.max(3, reticleThickness + 1),
                    backgroundColor: reticleColor,
                  }}
                />
                <div
                  className="absolute ring-1 ring-black/85 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
                  style={{
                    width: 12,
                    height: reticleThickness,
                    backgroundColor: reticleColor,
                    transform: `translateX(${-spreadPx - 5}px)`,
                  }}
                />
                <div
                  className="absolute ring-1 ring-black/85 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
                  style={{
                    width: 12,
                    height: reticleThickness,
                    backgroundColor: reticleColor,
                    transform: `translateX(${spreadPx + 5}px)`,
                  }}
                />
                <div
                  className="absolute ring-1 ring-black/85 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
                  style={{
                    width: reticleThickness,
                    height: 12,
                    backgroundColor: reticleColor,
                    transform: `translateY(${-spreadPx - 5}px)`,
                  }}
                />
                <div
                  className="absolute ring-1 ring-black/85 shadow-[0_0_3px_rgba(0,0,0,0.95)]"
                  style={{
                    width: reticleThickness,
                    height: 12,
                    backgroundColor: reticleColor,
                    transform: `translateY(${spreadPx + 5}px)`,
                  }}
                />
              </>
            )}

            {showHitmarkers && hitFeedback && showHit && (
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

      {lockOn.status !== 'none' && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div
            className={`w-28 h-28 rounded-full border-2 flex items-center justify-center transition-colors ${
              lockOn.status === 'locked'
                ? 'border-red-500'
                : lockOn.status === 'acquiring'
                  ? 'border-amber-400'
                  : 'border-cyan-400/50 border-dashed'
            }`}
          >
            <span className="font-mono text-[10px] tracking-widest px-1.5 py-0.5 bg-black/70 text-zinc-100 mt-32 whitespace-nowrap">
              {lockOn.status === 'locked'
                ? `LOCKED: ${lockOn.targetLabel}`
                : lockOn.status === 'acquiring'
                  ? `LOCKING ${Math.round(lockOn.progress * 100)}%`
                  : 'SEEKER SCANNING'}
            </span>
          </div>
        </div>
      )}
    </>
  );
});

const HudCompassStrip = React.memo(function HudCompassStrip({ compactHud }: { compactHud: boolean }) {
  const { playerYaw, playerX, playerZ, score, elapsedSec, objectives } = useGameSessionStore(
    useShallow((s) => ({
      playerYaw: s.hud.playerYaw,
      playerX: s.hud.playerX,
      playerZ: s.hud.playerZ,
      score: s.hud.score,
      elapsedSec: s.hud.elapsedSec,
      objectives: s.hud.objectives,
    }))
  );

  const headingDeg = (((-playerYaw * 180) / Math.PI) % 360 + 360) % 360;
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

  const activeObjective = pickActiveObjective(objectives);

  return (
    <div
      data-testid="hud-compass-strip"
      className={`bg-[#0B0E11]/82 border border-white/14 py-0.5 rounded-sm flex items-center font-mono tabular-nums whitespace-nowrap shadow-sm ${
        compactHud ? 'px-2 gap-1.5 text-[9.5px]' : 'px-2.5 xl:px-3.5 gap-2 xl:gap-2.5 text-[11px] xl:text-xs'
      }`}
    >
      <Compass className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400 shrink-0" />
      <span className="text-zinc-300">{Math.round(headingDeg)}°</span>
      <span className="text-amber-400 font-bold w-4 text-center">{cardinal}</span>
      {activeObjective && !activeObjective.completed && activeObjective.markerPos && (
        <>
          <span className="text-zinc-600">·</span>
          <span className="text-amber-300 font-bold">
            OBJ {calcObjectiveDistance(activeObjective, playerX, playerZ) ?? 0}M
          </span>
        </>
      )}
      {!compactHud && (
        <span className="hidden lg:inline-flex items-center gap-2">
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-200">SCORE {score}</span>
        </span>
      )}
      <span className="text-zinc-600">·</span>
      <span className="text-cyan-400">
        {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:
        {String(elapsedSec % 60).padStart(2, '0')}
      </span>
    </div>
  );
});

const HudCenterAlertsStack = React.memo(function HudCenterAlertsStack({
  compactHud,
  downedActive,
  touchControlsVisible,
}: {
  compactHud: boolean;
  downedActive: boolean;
  touchControlsVisible: boolean;
}) {
  const {
    activeBossLabel,
    activeBossHealthPct,
    activeBossVulnerable,
    activeBossPhaseLabel,
    incomingThreatWarning,
    spawnProtectionSec,
    missionAlert,
    ordnance,
    inVehicle,
  } = useGameSessionStore(
    useShallow((s) => ({
      activeBossLabel: s.hud.activeBossLabel,
      activeBossHealthPct: s.hud.activeBossHealthPct,
      activeBossVulnerable: s.hud.activeBossVulnerable,
      activeBossPhaseLabel: s.hud.activeBossPhaseLabel,
      incomingThreatWarning: s.hud.incomingThreatWarning,
      spawnProtectionSec: s.hud.spawnProtectionSec,
      missionAlert: s.hud.missionAlert,
      ordnance: s.hud.ordnance,
      inVehicle: s.hud.inVehicle,
    }))
  );
  const hasSeenVehicleHint = useMissionSelectionStore((s) => s.hasSeenVehicleControlHint);
  const markVehicleHintSeen = useMissionSelectionStore((s) => s.markVehicleControlHintSeen);

  return (
    <>
      {activeBossLabel && (
        <div
          data-testid="hud-boss-bar"
          className={`w-48 sm:w-64 bg-[#0B0E11]/82 border px-2 py-1 rounded-sm shadow-sm transition-colors ${
            activeBossVulnerable ? 'border-amber-400/85' : 'border-red-500/55'
          }`}
        >
          <div className="flex justify-between items-center font-mono text-[9px] sm:text-[10px] leading-none mb-0.5">
            <span
              className={`truncate max-w-[135px] sm:max-w-[190px] ${
                activeBossVulnerable ? 'text-amber-300 font-bold' : 'text-red-300'
              }`}
            >
              {activeBossLabel}
            </span>
            <span className="tabular-nums font-bold text-zinc-100">
              {Math.round(activeBossHealthPct * 100)}%
            </span>
          </div>
          <div className="h-1 bg-zinc-800/90 overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${
                activeBossVulnerable ? 'bg-amber-400' : 'bg-red-500'
              }`}
              style={{ width: `${Math.round(activeBossHealthPct * 100)}%` }}
            />
          </div>
          {activeBossPhaseLabel && (
            <div
              data-testid="hud-boss-phase"
              className={`mt-0.5 font-mono text-[8.5px] uppercase tracking-wider leading-none ${
                activeBossVulnerable ? 'text-amber-300 font-bold' : 'text-zinc-400'
              }`}
            >
              {activeBossPhaseLabel}
            </div>
          )}
        </div>
      )}

      {incomingThreatWarning && !downedActive && (
        <div
          data-testid="hud-incoming-threat-warning"
          className="bg-red-950/92 border-2 border-red-500 px-3 py-1 rounded-sm shadow-xl flex flex-col items-center min-w-[200px]"
        >
          <div className="font-display text-[11px] sm:text-xs font-bold uppercase tracking-widest text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span>{incomingThreatWarning.label} — TAKE COVER</span>
          </div>
          <div className="w-full h-1 bg-zinc-900 mt-1 overflow-hidden">
            <div
              className="h-full bg-red-500 transition-all duration-75"
              style={{ width: `${Math.round(incomingThreatWarning.progress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {(spawnProtectionSec ?? 0) > 0 && !downedActive && (
        <div
          data-testid="hud-spawn-protection"
          className="bg-cyan-950/88 border border-cyan-400/70 px-2.5 py-0.5 rounded-sm font-mono text-[9.5px] uppercase tracking-wider text-cyan-300 shadow-md whitespace-nowrap"
        >
          SPAWN COVER SHIELD ACTIVE ({spawnProtectionSec?.toFixed(1)}s)
        </div>
      )}

      {missionAlert && (
        <div className="bg-[#141920]/90 border border-amber-500/70 px-3 py-1 rounded-sm font-display text-[11px] sm:text-xs uppercase tracking-widest text-amber-400 shadow-lg text-center">
          {missionAlert}
        </div>
      )}

      {ordnance && ordnance.nukePendingConfirmSec > 0 && (
        <div className="bg-[#1b1010]/95 border-2 border-red-500 px-3.5 py-1.5 rounded-sm text-center shadow-2xl">
          <div className="font-display text-xs sm:text-sm font-bold uppercase tracking-widest text-red-400 flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            CONFIRM TRIDENT-X ({ordnance.nukePendingConfirmSec.toFixed(1)}s)
          </div>
          {!compactHud && (
            <div className="font-mono text-[11px] text-zinc-200 mt-1">
              PRESS [ENTER] TO AUTHORIZE ({ordnance.sandboxAuthorized ? 'SANDBOX' : `${ordnance.nukeCost} REQ`}) · [BACKSPACE] CANCEL
            </div>
          )}
        </div>
      )}

      {ordnance && ordnance.nukeCountdownSec > 0 && (
        <div className="bg-red-950/95 border-2 border-amber-400 px-4 py-1.5 rounded-sm text-center shadow-2xl">
          <div className="font-display text-xs sm:text-sm font-bold uppercase tracking-widest text-amber-300">
            STRATEGIC IMPACT IN {ordnance.nukeCountdownSec.toFixed(1)}s — SEEK COVER
          </div>
        </div>
      )}

      {ordnance && ordnance.inFalloutZone && (
        <div className="bg-amber-950/90 border border-amber-500 px-2.5 py-0.5 rounded-sm font-mono text-[10px] text-amber-300 tracking-wider">
          FALLOUT ZONE (-4.5 HP/S) · {ordnance.falloutRemainingSec.toFixed(0)}s
        </div>
      )}

      {!touchControlsVisible && inVehicle && !hasSeenVehicleHint && (
        <div
          data-testid="vehicle-control-hint"
          className="pointer-events-auto bg-[#0B0E11]/95 border border-amber-400/80 px-3 py-1.5 rounded-sm shadow-xl flex items-center gap-2.5"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-mono text-[10px] text-zinc-100">
            <strong className="text-amber-400">VEHICLE:</strong> [W/S] Gas/Rev · [A/D] Steer · [Space] Drift · [LMB] Turret · [E] Exit
          </span>
          <button
            type="button"
            data-testid="dismiss-vehicle-hint"
            onClick={(e) => {
              e.stopPropagation();
              markVehicleHintSeen();
            }}
            className="px-2 py-0.5 bg-amber-500 text-zinc-950 font-mono text-[10px] font-bold uppercase rounded-xs shrink-0 cursor-pointer"
          >
            Got It
          </button>
        </div>
      )}
    </>
  );
});

export const HudTopCenterStack = React.memo(function HudTopCenterStack({
  showCompass,
  compactHud,
  downedActive,
  pointerLocked,
  combatDebugOpen,
  touchControlsVisible,
  isCoarsePointer,
  hudMode,
  onRequestPointerLock,
}: {
  showCompass: boolean;
  compactHud: boolean;
  downedActive: boolean;
  pointerLocked: boolean;
  combatDebugOpen: boolean;
  touchControlsVisible: boolean;
  isCoarsePointer: boolean;
  hudMode: 'adaptive' | 'minimal' | 'expanded';
  onRequestPointerLock: () => void;
}) {
  const isIntenseCombat = useGameSessionStore(
    (s) =>
      hudMode === 'adaptive' &&
      (s.hud.isAds || s.hud.crosshairSpread > 0.036 || Boolean(s.hud.incomingThreatWarning))
  );
  const secondaryChromeOpacity =
    hudMode === 'minimal' ? 0.78 : hudMode === 'adaptive' && isIntenseCombat ? 0.84 : 1.0;

  return (
    <div
      data-testid="hud-top-center-strip"
      className="absolute left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 transition-opacity duration-150 max-w-[min(92vw,420px)]"
      style={{
        top: 'max(6px, env(safe-area-inset-top, 0px))',
        opacity: secondaryChromeOpacity,
      }}
    >
      {showCompass && <HudCompassStrip compactHud={compactHud} />}

      {!pointerLocked && !combatDebugOpen && !touchControlsVisible && !isCoarsePointer && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRequestPointerLock();
          }}
          className="pointer-events-auto bg-[#0B0E11]/90 hover:bg-[#141920] border border-cyan-500/60 px-2.5 py-0.5 rounded-sm font-mono text-[9.5px] xl:text-[10px] uppercase tracking-wider text-cyan-300 whitespace-nowrap transition-colors cursor-pointer"
        >
          Cursor Free — Click View to Lock · Drag to Aim
        </button>
      )}

      <HudCenterAlertsStack
        compactHud={compactHud}
        downedActive={downedActive}
        touchControlsVisible={touchControlsVisible}
      />
    </div>
  );
});

const HudRadarSlot = React.memo(function HudRadarSlot({
  radarSizePx,
  radarCenter,
  radarRadius,
  threatColor,
  compactHud,
}: {
  radarSizePx: number;
  radarCenter: number;
  radarRadius: number;
  threatColor: string;
  compactHud: boolean;
}) {
  const { blips, playerX, playerZ, playerYaw } = useGameSessionStore(
    useShallow((s) => ({
      blips: s.hud.blips,
      playerX: s.hud.playerX,
      playerZ: s.hud.playerZ,
      playerYaw: s.hud.playerYaw,
    }))
  );
  return (
    <TacticalMiniMap
      blips={blips}
      playerX={playerX}
      playerZ={playerZ}
      playerYaw={playerYaw}
      radarSizePx={radarSizePx}
      radarCenter={radarCenter}
      radarRadius={radarRadius}
      threatColor={threatColor}
      compactHud={compactHud}
    />
  );
});

const HudCompactMobileVitals = React.memo(function HudCompactMobileVitals() {
  const { armor, maxArmor, health, maxHealth } = useGameSessionStore(
    useShallow((s) => ({
      armor: s.hud.armor,
      maxArmor: s.hud.maxArmor,
      health: s.hud.health,
      maxHealth: s.hud.maxHealth,
    }))
  );

  return (
    <div className="mt-1 pt-1 border-t border-white/10 flex items-center justify-between gap-2 font-mono text-[9px] leading-none">
      <div className="flex items-center gap-1 text-cyan-400 flex-1">
        <Shield className="w-2.5 h-2.5 shrink-0" />
        <span className="tabular-nums">ARM {armor}</span>
        <div className="h-1 flex-1 bg-zinc-800 overflow-hidden rounded-xs">
          <div
            className="h-full bg-cyan-400"
            style={{ width: `${Math.round((armor / maxArmor) * 100)}%` }}
          />
        </div>
      </div>
      <div
        className={`flex items-center gap-1 font-bold flex-1 ${
          health < 35 ? 'text-red-400' : 'text-emerald-400'
        }`}
      >
        <Heart className="w-2.5 h-2.5 shrink-0" />
        <span className="tabular-nums">{health}</span>
        <div className="h-1 flex-1 bg-zinc-800 overflow-hidden rounded-xs">
          <div
            className={`h-full ${health < 35 ? 'bg-red-500' : 'bg-emerald-400'}`}
            style={{ width: `${Math.round((health / maxHealth) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
});

const HudObjectivesCard = React.memo(function HudObjectivesCard({
  compactHud,
}: {
  compactHud: boolean;
}) {
  const [objectivesExpanded, setObjectivesExpanded] = useState(false);
  const {
    objectives,
    activeStageIndex,
    totalStages,
    activeStageTitle,
    waveStatusText,
    activeActionDirective,
    playerX,
    playerZ,
  } = useGameSessionStore(
    useShallow((s) => ({
      objectives: s.hud.objectives,
      activeStageIndex: s.hud.activeStageIndex,
      totalStages: s.hud.totalStages,
      activeStageTitle: s.hud.activeStageTitle,
      waveStatusText: s.hud.waveStatusText,
      activeActionDirective: s.hud.activeActionDirective,
      playerX: s.hud.playerX,
      playerZ: s.hud.playerZ,
    }))
  );

  const activeObjective = pickActiveObjective(objectives);
  const completedObjectivesCount = objectives.filter((o) => o.completed).length;

  return (
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
                    S{activeStageIndex}/{totalStages}
                  </span>
                  {activeObjective.title}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-amber-400 shrink-0 flex items-center gap-1">
                  {(() => {
                    const dist = calcObjectiveDistance(activeObjective, playerX, playerZ);
                    return dist !== null ? <span>{dist}m</span> : null;
                  })()}
                  <span>
                    {activeObjective.current}/{activeObjective.target}
                  </span>
                  {objectives.length > 1 &&
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

          {objectivesExpanded && objectives.length > 0 && (
            <div
              data-testid="hud-objectives-expanded-list"
              className="mt-1 pt-1 border-t border-zinc-800/90 space-y-1"
            >
              <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                <span>
                  Stage {activeStageIndex}/{totalStages}
                </span>
                <span>
                  {completedObjectivesCount}/{objectives.length}
                </span>
              </div>
              {objectives.map((o) => {
                const dist = calcObjectiveDistance(o, playerX, playerZ);
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

          {objectivesExpanded && activeActionDirective && (
            <div
              data-testid="hud-action-directive"
              className="mt-1 pt-1 border-t border-amber-500/25 font-mono text-[8.5px] leading-tight text-amber-300"
            >
              {activeActionDirective}
            </div>
          )}

          <HudCompactMobileVitals />
        </div>
      ) : (
        <div
          data-testid="hud-objectives-desktop"
          className="pointer-events-auto bg-[#0B0E11]/82 border border-zinc-800/90 rounded-sm px-2.5 py-1.5 xl:px-3 xl:py-2 space-y-1 w-[212px] xl:w-[248px]"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            data-testid="hud-objectives-desktop-toggle"
            aria-expanded={objectivesExpanded}
            onClick={(e) => {
              e.stopPropagation();
              setObjectivesExpanded((v) => !v);
            }}
            className="w-full flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-1 text-left cursor-pointer"
          >
            <span
              data-testid="hud-stage-header"
              className="font-mono text-[9.5px] xl:text-[10px] uppercase tracking-wider text-cyan-400 font-bold truncate"
            >
              {activeStageTitle}
            </span>
            <span className="font-mono text-[9.5px] xl:text-[10px] text-amber-400 shrink-0 flex items-center gap-1">
              <span>
                S{activeStageIndex}/{totalStages}
              </span>
              {objectives.length > 1 &&
                (objectivesExpanded ? (
                  <ChevronUp className="w-3 h-3 text-zinc-400" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                ))}
            </span>
          </button>

          {(() => {
            const visibleObjectives = objectivesExpanded
              ? objectives
              : activeObjective
                ? [activeObjective]
                : objectives.slice(0, 1);
            return visibleObjectives.map((o) => {
              const distMeters = calcObjectiveDistance(o, playerX, playerZ);
              const isLocked = o.status === 'locked';
              const isActive = o.status === 'active' && !o.completed;
              return (
                <div
                  key={o.id}
                  data-testid={`hud-objective-row-${o.id}`}
                  className={`space-y-0.5 rounded-xs px-1.5 py-0.5 ${
                    isActive
                      ? 'bg-amber-500/10 border-l-2 border-amber-400'
                      : isLocked
                        ? 'opacity-65'
                        : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5 text-[11px] xl:text-xs">
                    <span
                      className={`truncate ${
                        o.completed
                          ? o.bypassed
                            ? 'line-through text-amber-400/85'
                            : 'line-through text-emerald-400/85'
                          : isLocked
                            ? 'text-zinc-400'
                            : 'text-zinc-100 font-semibold'
                      }`}
                    >
                      {o.title}
                    </span>
                    <span className="font-mono text-[9.5px] xl:text-[10px] tabular-nums shrink-0 flex items-center gap-1">
                      {o.completed ? (
                        <span
                          className={`px-1 py-0.2 rounded-xs text-[8.5px] uppercase font-bold ${
                            o.bypassed
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          }`}
                        >
                          {o.bypassed ? 'BYPASSED' : 'DONE'}
                        </span>
                      ) : isLocked ? (
                        <span className="px-1 py-0.2 rounded-xs bg-zinc-800 text-zinc-400 text-[8.5px] uppercase">
                          {o.current > 0 ? `${o.current}/${o.target}` : `S${o.stageIndex}`}
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
                    <div className="text-[10px] text-zinc-300 leading-tight line-clamp-1">
                      {o.description}
                    </div>
                  )}
                  {objectivesExpanded && isLocked && o.blockedReason && (
                    <div
                      data-testid={`hud-objective-blocked-${o.id}`}
                      className="text-[9.5px] font-mono text-zinc-400 leading-tight"
                    >
                      {o.blockedReason}
                    </div>
                  )}
                </div>
              );
            });
          })()}

          {waveStatusText && (
            <div
              data-testid="hud-wave-status"
              className="pt-1 border-t border-zinc-800/80 font-mono text-[9.5px] text-cyan-300 flex items-center justify-between gap-2"
            >
              <span className="truncate">{waveStatusText}</span>
              {!objectivesExpanded && objectives.length > 1 && (
                <span className="text-zinc-500 text-[8.5px] shrink-0">
                  [TAB] ALL ({objectives.length})
                </span>
              )}
            </div>
          )}

          {objectivesExpanded && activeActionDirective && (
            <div
              data-testid="hud-action-directive"
              className="pt-1 border-t border-amber-500/25 font-mono text-[9.5px] text-amber-300 leading-snug"
            >
              {activeActionDirective}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const HudTopLeftCluster = React.memo(function HudTopLeftCluster({
  showRadar,
  compactHud,
  touchControlsVisible,
  viewportWidth,
  viewportHeight,
  radarSizePx,
  radarCenter,
  radarRadius,
  threatColor,
}: {
  showRadar: boolean;
  compactHud: boolean;
  touchControlsVisible: boolean;
  viewportWidth: number;
  viewportHeight: number;
  radarSizePx: number;
  radarCenter: number;
  radarRadius: number;
  threatColor: string;
}) {
  const inputSettings = useSettingsStore((s) => s.input);
  const topLeftOffsetPx = useGameSessionStore((s) => {
    if (!touchControlsVisible) return 10;
    return computeMobileHudLayout(
      inputSettings,
      { width: viewportWidth, height: viewportHeight },
      {
        inVehicle: s.hud.inVehicle,
        grenadeCount: s.hud.grenades,
        c4DeployedCount: s.hud.ordnance?.c4Deployed ?? 0,
      }
    ).topLeftHudLeftPx;
  });

  return (
    <div
      data-testid="hud-top-left-cluster"
      className="absolute z-30 flex items-start gap-1.5 pointer-events-none"
      style={{
        top: 'max(6px, env(safe-area-inset-top, 0px))',
        left: `max(${topLeftOffsetPx}px, calc(env(safe-area-inset-left, 0px) + ${topLeftOffsetPx - 4}px))`,
      }}
    >
      {showRadar && (
        <HudRadarSlot
          radarSizePx={radarSizePx}
          radarCenter={radarCenter}
          radarRadius={radarRadius}
          threatColor={threatColor}
          compactHud={compactHud}
        />
      )}
      <HudObjectivesCard compactHud={compactHud} />
    </div>
  );
});

const HudCompactMobileWeaponReadout = React.memo(function HudCompactMobileWeaponReadout() {
  const {
    inVehicle,
    vehicleName,
    vehicleGear,
    vehicleSpeedKmh,
    vehicleHealth,
    weaponName,
    fireMode,
    ammoInMag,
    reserveAmmo,
    isReloading,
    reloadProgress,
  } = useGameSessionStore(
    useShallow((s) => ({
      inVehicle: s.hud.inVehicle,
      vehicleName: s.hud.vehicleName,
      vehicleGear: s.hud.vehicleGear,
      vehicleSpeedKmh: s.hud.vehicleSpeedKmh,
      vehicleHealth: s.hud.vehicleHealth,
      weaponName: s.hud.weaponName,
      fireMode: s.hud.fireMode,
      ammoInMag: s.hud.ammoInMag,
      reserveAmmo: s.hud.reserveAmmo,
      isReloading: s.hud.isReloading,
      reloadProgress: s.hud.reloadProgress,
    }))
  );

  return (
    <div
      data-testid="hud-compact-weapon-readout"
      className="bg-[#0B0E11]/76 border border-white/12 px-2 py-1 rounded-sm font-mono text-right flex items-center gap-2"
    >
      {inVehicle ? (
        <div className="leading-tight">
          <div className="text-[9px] text-emerald-400 uppercase truncate max-w-[96px]">{vehicleName}</div>
          <div className="text-[11px] font-bold text-amber-400 tabular-nums whitespace-nowrap">
            {vehicleGear === 'REVERSE' ? 'REV ' : 'FWD '}
            {vehicleSpeedKmh} KM/H · {vehicleHealth}%
          </div>
        </div>
      ) : (
        <div className="leading-tight">
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-[9px] text-zinc-300 font-bold uppercase">{weaponName}</span>
            <span className="text-[8px] text-amber-400 uppercase">{fireMode}</span>
          </div>
          <div className="tabular-nums leading-none mt-0.5">
            <span className={`text-sm font-bold ${ammoInMag === 0 ? 'text-red-400' : 'text-white'}`}>
              {ammoInMag}
            </span>
            <span className="text-[10px] text-zinc-400"> / {reserveAmmo}</span>
          </div>
          {isReloading && (
            <div className="h-0.5 bg-zinc-800 mt-0.5 overflow-hidden">
              <div
                className="h-full bg-amber-400"
                style={{ width: `${Math.round(reloadProgress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const HudPerfReadout = React.memo(function HudPerfReadout({
  showPerformanceTelemetry,
  qualityTelemetry,
  getQualityTelemetry,
}: {
  showPerformanceTelemetry: boolean;
  qualityTelemetry: DirectorTelemetrySnapshot | null;
  getQualityTelemetry?: () => DirectorTelemetrySnapshot | null;
}) {
  const diagnostics = useGameSessionStore((s) => s.diagnostics);
  const debugFps = useGameSessionStore((s) => s.combatDebug?.performance.fps);
  const liveFps = debugFps ?? diagnostics.fps;
  const [liveTelemetry, setLiveTelemetry] = useState<DirectorTelemetrySnapshot | null>(
    qualityTelemetry
  );

  useEffect(() => {
    setLiveTelemetry(qualityTelemetry);
  }, [qualityTelemetry]);

  useEffect(() => {
    if (!showPerformanceTelemetry || !getQualityTelemetry) return;
    const next = getQualityTelemetry();
    if (next) setLiveTelemetry(next);
  }, [showPerformanceTelemetry, getQualityTelemetry, diagnostics]);

  const activeTelemetry = liveTelemetry ?? qualityTelemetry;

  return (
    <div
      data-testid="hud-performance-readout"
      className="bg-[#080B0F]/88 border border-zinc-800 px-2.5 py-1 rounded-sm font-mono text-[10px] text-zinc-300 tabular-nums flex items-center gap-2"
    >
      <span className="text-emerald-400 font-bold">{Math.round(liveFps || 60)} FPS</span>
      {showPerformanceTelemetry && activeTelemetry && (
        <>
          <span className="text-zinc-600">|</span>
          <span>P95 {activeTelemetry.cpuFrameMsP95.toFixed(1)}ms</span>
          <span className="text-zinc-600">|</span>
          <span>DC {activeTelemetry.drawCalls}</span>
        </>
      )}
    </div>
  );
});

const HudKillFeed = React.memo(function HudKillFeed({
  extraMarginTop,
}: {
  extraMarginTop: boolean;
}) {
  const killFeed = useGameSessionStore((s) => s.killFeed);
  return (
    <div className={`flex flex-col items-end gap-1.5 ${extraMarginTop ? 'mt-9' : ''}`}>
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
  );
});

export const HudTopRightCluster = React.memo(function HudTopRightCluster({
  compactHud,
  devModeActive,
  combatDebugOpen,
  combatDebugCollapsed,
  tacticalOverviewOpen,
  touchControlsVisible,
  showFpsCounter,
  showPerformanceTelemetry,
  showKillFeed,
  qualityTelemetry,
  getQualityTelemetry,
  onPause,
}: {
  compactHud: boolean;
  devModeActive: boolean;
  combatDebugOpen: boolean;
  combatDebugCollapsed: boolean;
  tacticalOverviewOpen: boolean;
  touchControlsVisible: boolean;
  showFpsCounter: boolean;
  showPerformanceTelemetry: boolean;
  showKillFeed: boolean;
  qualityTelemetry: DirectorTelemetrySnapshot | null;
  getQualityTelemetry?: () => DirectorTelemetrySnapshot | null;
  onPause?: () => void;
}) {
  const setCombatDebugOpen = useUIStore((s) => s.setCombatDebugOpen);
  const setCombatDebugCollapsed = useUIStore((s) => s.setCombatDebugCollapsed);
  const toggleTacticalOverview = useUIStore((s) => s.toggleTacticalOverview);

  return (
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
        {compactHud && <HudCompactMobileWeaponReadout />}

        {devModeActive && !combatDebugOpen && !compactHud && (
          <button
            type="button"
            aria-label="Open Combat and Performance Diagnostics"
            title="Open Combat Diagnostics ([F4])"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setCombatDebugCollapsed(false);
              setCombatDebugOpen(true);
            }}
            className="pointer-events-auto flex items-center gap-1.5 px-2 min-w-[40px] min-h-[40px] bg-[#0B0E11]/80 hover:bg-[#141920] border border-zinc-700/85 rounded-sm font-mono text-[10px] text-zinc-400 hover:text-zinc-200 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <BarChart3 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="hidden xl:inline">[F4]</span>
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
          {!compactHud && <span className="hidden xl:inline">[TAB] INTEL</span>}
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
          {!compactHud && <span className="hidden xl:inline">TOUCH</span>}
        </button>

        {onPause && (
          <button
            type="button"
            data-testid="hud-pause-btn"
            aria-label="Pause Mission"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onPause();
            }}
            className="pointer-events-auto min-w-[40px] min-h-[40px] px-2 bg-[#0B0E11]/85 hover:bg-[#141920] border border-zinc-700 rounded-sm text-zinc-100 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {(showFpsCounter || showPerformanceTelemetry) && (
        <HudPerfReadout
          showPerformanceTelemetry={showPerformanceTelemetry}
          qualityTelemetry={qualityTelemetry}
          getQualityTelemetry={getQualityTelemetry}
        />
      )}

      {!compactHud && showKillFeed && (
        <HudKillFeed extraMarginTop={devModeActive && combatDebugOpen && combatDebugCollapsed} />
      )}
    </div>
  );
});

export type BottomCenterPromptSelection =
  | { kind: 'critical_hint'; hint: NonNullable<HudSnapshot['activeTacticalHint']> }
  | { kind: 'interact'; text: string; showInlineFieldSwap: boolean }
  | { kind: 'vault'; text: string; showInlineFieldSwap: boolean }
  | { kind: 'field_swap' }
  | { kind: 'tactical_hint'; hint: NonNullable<HudSnapshot['activeTacticalHint']> }
  | { kind: 'none' };

/**
 * Pure single-slot priority arbitrator for the bottom-center HUD prompt rail.
 * Guarantees at most ONE prompt banner renders at a time (zero vertical overlap).
 * Priority: Critical Survival > Primary [E] Interact / Vault > Field Armory Swap > Tactical/Onboarding Hint.
 */
export function resolveBottomCenterPromptSlot(input: {
  downedActive: boolean;
  fieldSwapOpen: boolean;
  compactHud: boolean;
  inVehicle: boolean;
  canVault: boolean;
  interactPrompt: string | null;
  nearSupplySwapStation: boolean;
  canOpenFieldSwap: boolean;
  activeTacticalHint: HudSnapshot['activeTacticalHint'];
}): BottomCenterPromptSelection {
  if (input.downedActive || input.fieldSwapOpen) {
    return { kind: 'none' };
  }
  if (input.activeTacticalHint?.priority === 'critical') {
    return { kind: 'critical_hint', hint: input.activeTacticalHint };
  }
  const swapEligible = input.nearSupplySwapStation && !input.inVehicle && input.canOpenFieldSwap;
  if (!input.compactHud && input.interactPrompt) {
    return { kind: 'interact', text: input.interactPrompt, showInlineFieldSwap: swapEligible };
  }
  if (!input.compactHud && !input.inVehicle && input.canVault) {
    return { kind: 'vault', text: '[SPACE] VAULT', showInlineFieldSwap: swapEligible };
  }
  if (swapEligible) {
    return { kind: 'field_swap' };
  }
  if (input.activeTacticalHint) {
    return { kind: 'tactical_hint', hint: input.activeTacticalHint };
  }
  return { kind: 'none' };
}

export const HudBottomPromptsAndRadio = React.memo(function HudBottomPromptsAndRadio({
  compactHud,
  downedActive,
  fieldSwapOpen = false,
  onOpenFieldSwap,
}: {
  compactHud: boolean;
  downedActive: boolean;
  fieldSwapOpen?: boolean;
  onOpenFieldSwap?: () => void;
}) {
  const {
    activeTacticalHint,
    liftStatus,
    interactPrompt,
    canVault,
    inVehicle,
    nearSupplySwapStation,
    activeRadioSubtitle,
    subtitleText,
  } = useGameSessionStore(
    useShallow((s) => ({
      activeTacticalHint: s.hud.activeTacticalHint,
      liftStatus: s.hud.liftStatus,
      interactPrompt: s.hud.interactPrompt,
      canVault: s.hud.canVault,
      inVehicle: s.hud.inVehicle,
      nearSupplySwapStation: Boolean(s.hud.nearSupplySwapStation),
      activeRadioSubtitle: s.hud.activeRadioSubtitle,
      subtitleText: s.hud.subtitleText,
    }))
  );
  const dismissTacticalHint = useMissionSelectionStore((s) => s.dismissTacticalHint);

  const slot = resolveBottomCenterPromptSlot({
    downedActive,
    fieldSwapOpen,
    compactHud,
    inVehicle,
    canVault,
    interactPrompt,
    nearSupplySwapStation,
    canOpenFieldSwap: Boolean(onOpenFieldSwap),
    activeTacticalHint,
  });

  const slotPositionClass = compactHud
    ? 'bottom-20'
    : 'bottom-36';

  return (
    <>
      {liftStatus && !downedActive && !fieldSwapOpen && (
        <div
          data-testid="hud-lift-status"
          className={`absolute left-1/2 -translate-x-1/2 bg-[#0B0E11]/92 border border-cyan-400/60 px-3 py-1 rounded-sm font-mono text-[10px] text-zinc-100 shadow-lg flex items-center gap-2 whitespace-nowrap ${
            compactHud ? 'bottom-32' : 'bottom-48'
          }`}
        >
          <span className="text-cyan-400 font-bold uppercase">{liftStatus.liftName}</span>
          <span className="text-zinc-500">·</span>
          <span className="text-amber-300">
            {liftStatus.state === 'traveling' || liftStatus.state === 'doors_closing'
              ? `${liftStatus.currentFloorLabel} → ${liftStatus.targetFloorLabel}`
              : liftStatus.currentFloorLabel}
          </span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-300 tabular-nums">
            {liftStatus.occupantCount}/{liftStatus.maxOccupants}
          </span>
        </div>
      )}

      {(slot.kind === 'critical_hint' || slot.kind === 'tactical_hint') && (
        <div
          data-testid="hud-tier1-tactical-hint"
          className={`absolute left-1/2 -translate-x-1/2 z-20 pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-sm font-mono text-[10px] sm:text-xs shadow-lg border whitespace-nowrap ${slotPositionClass} ${
            slot.hint.priority === 'critical'
              ? 'bg-red-950/92 border-red-500/80 text-red-200'
              : slot.hint.priority === 'tactical'
                ? 'bg-[#0B0E11]/92 border-amber-400/80 text-amber-200'
                : 'bg-[#0B0E11]/90 border-cyan-400/75 text-cyan-200'
          }`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {slot.hint.actionKey && (
            <span className="px-1.5 py-0.5 bg-zinc-950 border border-white/25 text-amber-300 font-bold rounded-xs text-[9px] sm:text-[10px]">
              [{slot.hint.actionKey}]
            </span>
          )}
          <span className="tracking-wide">{slot.hint.text}</span>
          {slot.hint.dismissible && (
            <button
              type="button"
              data-testid="dismiss-tactical-hint"
              onClick={(e) => {
                e.stopPropagation();
                dismissTacticalHint(slot.hint.id);
              }}
              className="ml-1 px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[9px] uppercase rounded-xs cursor-pointer"
            >
              OK
            </button>
          )}
        </div>
      )}

      {(slot.kind === 'interact' || slot.kind === 'vault') && (
        <div
          data-testid={slot.kind === 'interact' ? 'hud-interact-prompt' : 'hud-vault-prompt'}
          className={`absolute ${slotPositionClass} left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 bg-[#0B0E11]/92 px-4 py-1.5 rounded-sm font-mono text-xs tracking-wider shadow-lg whitespace-nowrap ${
            slot.kind === 'interact'
              ? 'border border-amber-500 text-amber-400'
              : 'border border-cyan-400/80 text-cyan-300'
          } ${slot.showInlineFieldSwap ? 'pointer-events-auto' : 'pointer-events-none'}`}
          onMouseDown={(e) => {
            if (slot.showInlineFieldSwap) e.stopPropagation();
          }}
          onPointerDown={(e) => {
            if (slot.showInlineFieldSwap) e.stopPropagation();
          }}
        >
          <span>{slot.text}</span>
          {slot.showInlineFieldSwap && onOpenFieldSwap && (
            <>
              <span className="text-zinc-600">|</span>
              <button
                type="button"
                data-testid="hud-field-swap-trigger"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFieldSwap();
                }}
                className="px-2 py-0.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/60 rounded-xs text-[10px] text-amber-200 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 shrink-0" />
                <span>[H] ARMORY SWAP</span>
              </button>
            </>
          )}
        </div>
      )}

      {slot.kind === 'field_swap' && onOpenFieldSwap && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 z-20 pointer-events-auto ${slotPositionClass}`}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            data-testid="hud-field-swap-trigger"
            onClick={onOpenFieldSwap}
            className="min-h-[38px] px-3.5 py-1.5 bg-[#0B0E11]/92 hover:bg-[#141920] border border-amber-400/75 rounded-sm font-mono text-[11px] text-amber-300 flex items-center gap-2 whitespace-nowrap shadow-lg cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>{compactHud ? 'FIELD ARMORY SWAP' : '[H] FIELD ARMORY SWAP (60 REQ OR 60% AMMO)'}</span>
          </button>
        </div>
      )}

      {activeRadioSubtitle ? (
        <div
          data-testid="hud-squad-radio-subtitle"
          className={`absolute left-1/2 -translate-x-1/2 bg-[#0B0E11]/92 border-l-2 border-y border-r rounded-xs text-zinc-100 shadow-lg ${
            activeRadioSubtitle.priority === 'CRITICAL'
              ? 'border-l-red-500 border-red-500/40'
              : activeRadioSubtitle.priority === 'TACTICAL'
                ? 'border-l-amber-400 border-zinc-700'
                : 'border-l-cyan-400 border-zinc-800'
          } ${
            compactHud
              ? 'bottom-[58px] w-[min(320px,54vw)] px-2.5 py-1 flex flex-col items-start gap-0.5 text-[10px]'
              : 'bottom-24 max-w-md sm:max-w-xl px-3 py-1.5 flex items-center gap-2 text-xs'
          }`}
        >
          <span className="inline-flex items-center gap-1.5 font-mono text-[9px] sm:text-[9.5px] uppercase font-bold text-amber-300 whitespace-nowrap shrink-0">
            <Radio
              className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${
                activeRadioSubtitle.priority === 'CRITICAL'
                  ? 'text-red-400'
                  : activeRadioSubtitle.priority === 'TACTICAL'
                    ? 'text-amber-400'
                    : 'text-cyan-400'
              }`}
            />
            [{activeRadioSubtitle.roleBadge}] {activeRadioSubtitle.callsign}
            {!compactHud && ':'}
          </span>
          <span className={`text-left leading-snug ${compactHud ? 'line-clamp-2 text-zinc-200' : ''}`}>
            {activeRadioSubtitle.text}
          </span>
        </div>
      ) : (
        subtitleText && (
          <div
            data-testid="hud-tier2-radio-subtitle"
            className={`absolute left-1/2 -translate-x-1/2 bg-[#0B0E11]/88 border border-zinc-800 px-3 py-1 rounded-sm flex items-center gap-2 text-[10px] sm:text-xs text-zinc-200 text-center ${
              compactHud ? 'bottom-[68px] max-w-[320px]' : 'bottom-24 max-w-md sm:max-w-xl'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>{subtitleText}</span>
          </div>
        )
      )}
    </>
  );
});

export const HudDesktopVitalsPanel = React.memo(function HudDesktopVitalsPanel() {
  const { armor, maxArmor, health, maxHealth, isRegenerating } = useGameSessionStore(
    useShallow((s) => ({
      armor: s.hud.armor,
      maxArmor: s.hud.maxArmor,
      health: s.hud.health,
      maxHealth: s.hud.maxHealth,
      isRegenerating: s.hud.isRegenerating,
    }))
  );
  const criticalHp = health > 0 && health / Math.max(1, maxHealth) < 0.35;

  return (
    <div className="absolute bottom-3 left-3 xl:bottom-4 xl:left-4 bg-[#0B0E11]/85 border border-zinc-800 px-3 py-2.5 xl:px-4 xl:py-3 rounded-sm min-w-[204px] xl:min-w-[230px]">
      <div className="flex items-center justify-between text-xs font-mono mb-1.5">
        <span className="flex items-center gap-1.5 text-cyan-400">
          <Shield className="w-3.5 h-3.5" /> ARMOR
        </span>
        <span className="tabular-nums text-zinc-200">
          {armor}/{maxArmor}
        </span>
      </div>
      <div className="h-1.5 bg-zinc-800 mb-2 overflow-hidden">
        <div
          className="h-full bg-cyan-400 transition-all duration-150"
          style={{ width: `${Math.round((armor / Math.max(1, maxArmor)) * 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs font-mono mb-1.5">
        <span className="flex items-center gap-1.5 text-emerald-400">
          <Heart className="w-3.5 h-3.5" /> HEALTH
          {isRegenerating && (
            <span
              data-testid="hud-regen-badge"
              className="text-[9px] px-1 py-0.2 bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 rounded-xs"
            >
              +REGEN
            </span>
          )}
        </span>
        <span className={`tabular-nums font-bold ${criticalHp ? 'text-red-400' : 'text-zinc-100'}`}>
          {health}/{maxHealth}
        </span>
      </div>
      <div className="h-2 bg-zinc-800 overflow-hidden">
        <div
          className={`h-full transition-all duration-150 ${criticalHp ? 'bg-red-500' : 'bg-emerald-400'}`}
          style={{ width: `${Math.round((health / Math.max(1, maxHealth)) * 100)}%` }}
        />
      </div>
    </div>
  );
});

export const HudDesktopWeaponAndOrdnancePanel = React.memo(function HudDesktopWeaponAndOrdnancePanel({
  inputManager,
}: {
  inputManager: InputManager | null;
}) {
  const {
    ordnance,
    inVehicle,
    vehicleCameraMode,
    vehicleName,
    vehicleGear,
    vehicleSpeedKmh,
    vehicleHealth,
    vehicleTurretAmmo,
    vehicleMaxTurretAmmo,
    fireMode,
    weaponName,
    weaponId,
    ammoInMag,
    reserveAmmo,
    isReloading,
    reloadProgress,
    grenades,
    rpgEquipped,
    rpgAmmoInMag,
    rpgReserveAmmo,
  } = useGameSessionStore(
    useShallow((s) => ({
      ordnance: s.hud.ordnance,
      inVehicle: s.hud.inVehicle,
      vehicleCameraMode: s.hud.vehicleCameraMode,
      vehicleName: s.hud.vehicleName,
      vehicleGear: s.hud.vehicleGear,
      vehicleSpeedKmh: s.hud.vehicleSpeedKmh,
      vehicleHealth: s.hud.vehicleHealth,
      vehicleTurretAmmo: s.hud.vehicleTurretAmmo,
      vehicleMaxTurretAmmo: s.hud.vehicleMaxTurretAmmo,
      fireMode: s.hud.fireMode,
      weaponName: s.hud.weaponName,
      weaponId: s.hud.weaponId,
      ammoInMag: s.hud.ammoInMag,
      reserveAmmo: s.hud.reserveAmmo,
      isReloading: s.hud.isReloading,
      reloadProgress: s.hud.reloadProgress,
      grenades: s.hud.grenades,
      rpgEquipped: s.hud.rpgEquipped,
      rpgAmmoInMag: s.hud.rpgAmmoInMag,
      rpgReserveAmmo: s.hud.rpgReserveAmmo,
    }))
  );

  return (
    <div className="absolute bottom-3 right-3 xl:bottom-4 xl:right-4 flex items-end gap-3">
      {ordnance && (
        <div className="hidden xl:flex items-center gap-2 bg-[#0B0E11]/85 border border-zinc-800 px-3 py-2 rounded-sm font-mono text-[10px] shrink-0">
          <div className="flex flex-col pr-2 border-r border-zinc-800">
            <span className="text-zinc-400">[C] C4 PACK</span>
            <span className={ordnance.c4Deployed > 0 ? 'text-amber-400 font-bold' : 'text-zinc-200'}>
              INV {ordnance.c4Inventory} · SET {ordnance.c4Deployed}/{ordnance.c4MaxDeployed}
            </span>
          </div>

          <div className="flex flex-col px-2 border-r border-zinc-800">
            <span className="text-zinc-400 flex items-center gap-1">
              <Bomb className="w-3 h-3 text-amber-400" />
              [V]/[SH+V] {ordnance.selectedBombShort}
            </span>
            <span className={ordnance.bombCooldownSec > 0 ? 'text-red-400' : 'text-cyan-300'}>
              {ordnance.bombCooldownSec > 0
                ? `CD ${ordnance.bombCooldownSec.toFixed(1)}s`
                : ordnance.sandboxAuthorized
                  ? 'SANDBOX READY'
                  : `${ordnance.selectedBombCost} REQ`}
            </span>
          </div>

          <div className="flex flex-col pl-1">
            <span className="text-zinc-400">[N] TRIDENT-X</span>
            <span
              className={
                ordnance.nukeUsed
                  ? 'text-zinc-500'
                  : ordnance.sandboxAuthorized || ordnance.requisitionPoints >= ordnance.nukeCost
                    ? 'text-amber-400 font-bold'
                    : 'text-zinc-400'
              }
            >
              {ordnance.nukeUsed
                ? 'EXPENDED'
                : ordnance.sandboxAuthorized
                  ? 'SANDBOX READY'
                  : `${ordnance.nukeCost} REQ`}
            </span>
          </div>
        </div>
      )}

      <div className="bg-[#0B0E11]/85 border border-zinc-800 px-3 py-2.5 xl:px-4 xl:py-3 rounded-sm min-w-[228px] xl:min-w-[260px] flex flex-col items-end shrink-0">
        {inVehicle ? (
          <>
            <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
              CAM: {VEHICLE_CAMERA_MODE_LABELS[vehicleCameraMode]} [F]
            </div>
            <div className="font-display text-lg font-bold uppercase text-zinc-100 mt-0.5">
              {vehicleName}
            </div>
            <div className="flex items-baseline gap-3 mt-1 font-mono tabular-nums">
              <span
                className={`px-1.5 py-0.5 text-xs font-bold rounded-xs ${
                  vehicleGear === 'REVERSE'
                    ? 'bg-red-600/80 text-white'
                    : vehicleGear === 'BRAKING' || vehicleGear === 'NEUTRAL_HOLD'
                      ? 'bg-amber-500/80 text-zinc-950'
                      : 'bg-emerald-500/25 border border-emerald-400/60 text-emerald-300'
                }`}
              >
                {vehicleGear === 'REVERSE'
                  ? 'REV'
                  : vehicleGear === 'NEUTRAL_HOLD'
                    ? 'N'
                    : vehicleGear === 'BRAKING'
                      ? 'BRK'
                      : 'FWD'}
              </span>
              <span className="text-2xl font-bold text-amber-400 tabular-nums">{vehicleSpeedKmh} KM/H</span>
              <span
                className={`text-xs tabular-nums ${
                  vehicleHealth <= 35 ? 'text-red-400 font-semibold' : 'text-zinc-400'
                }`}
              >
                HULL {vehicleHealth}%
              </span>
              {vehicleMaxTurretAmmo > 0 && (
                <span
                  className={`text-xs tabular-nums ${
                    vehicleTurretAmmo <= 20 ? 'text-amber-300 font-semibold' : 'text-zinc-300'
                  }`}
                >
                  TURRET {vehicleTurretAmmo}/{vehicleMaxTurretAmmo}
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
                {fireMode.toUpperCase()} [B]
              </span>
              <span className="font-display text-sm font-bold uppercase tracking-wider text-zinc-200">
                {weaponName}
              </span>
            </div>

            <div className="flex items-center justify-between w-full mt-1.5 gap-3 xl:gap-4">
              <WeaponSilhouette
                weaponId={weaponId}
                className="w-20 xl:w-28 h-7 xl:h-8 text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.4)]"
              />
              <div className="text-right font-mono tabular-nums">
                <span className={`text-3xl font-bold ${ammoInMag === 0 ? 'text-red-400' : 'text-white'}`}>
                  {ammoInMag}
                </span>
                <span className="text-sm text-zinc-400 ml-1">/ {reserveAmmo}</span>
              </div>
            </div>

            {isReloading && (
              <div className="w-full mt-2">
                <div className="h-1 bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-400"
                    style={{ width: `${Math.round(reloadProgress * 100)}%` }}
                  />
                </div>
                <div className="font-mono text-[10px] text-amber-400 text-right mt-0.5">RELOADING...</div>
              </div>
            )}

            <div className="flex items-center justify-between w-full gap-3 mt-1.5 font-mono text-[10px] text-zinc-400">
              <span>[1-9] WEAPONS · [G] FRAG x{grenades}</span>
              <button
                type="button"
                data-testid="desktop-btn-rpg"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  inputManager?.queueWeaponSlot(rpgEquipped ? 1 : 7);
                }}
                className={`pointer-events-auto px-2 py-0.5 rounded-xs border flex items-center gap-1 font-bold transition-colors ${
                  rpgEquipped
                    ? 'bg-amber-500/30 border-amber-400 text-amber-200'
                    : 'bg-[#141920] border-amber-500/50 text-amber-300 hover:border-amber-400'
                }`}
              >
                <Rocket className="w-3 h-3" />
                <span>[7] RPG {rpgAmmoInMag}/{rpgReserveAmmo}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

export const HudTacticalOverviewSlot = React.memo(function HudTacticalOverviewSlot({
  missionVisualProfile,
  tacticalOverviewOpen,
  onClose,
}: {
  missionVisualProfile: MissionVisualProfile;
  tacticalOverviewOpen: boolean;
  onClose: () => void;
}) {
  const hud = useGameSessionStore((s) => s.hud);
  const completedObjectivesCount = hud.objectives.filter((o) => o.completed).length;

  return (
    <TacticalOverviewDrawer
      hud={hud}
      missionVisualProfile={missionVisualProfile}
      tacticalOverviewOpen={tacticalOverviewOpen}
      completedObjectivesCount={completedObjectivesCount}
      formatObjectiveDistance={(o) => calcObjectiveDistance(o, hud.playerX, hud.playerZ)}
      onClose={onClose}
    />
  );
});

export const HudSoloTraumaSlot = React.memo(function HudSoloTraumaSlot() {
  const { deploymentMode, soloTraumaKit } = useGameSessionStore(
    useShallow((s) => ({
      deploymentMode: s.hud.deploymentMode,
      soloTraumaKit: s.hud.soloTraumaKit,
    }))
  );
  if (deploymentMode !== 'solo' || !soloTraumaKit) return null;

  return (
    <div
      data-testid="hud-solo-trauma-status"
      className="absolute bottom-[104px] left-3 xl:bottom-32 xl:left-4 z-20 bg-[#0B0E11]/86 border border-zinc-800 rounded-sm px-2.5 py-1.5 font-mono text-[10px] flex items-center gap-2 pointer-events-none"
    >
      <span className="text-amber-400 font-bold uppercase tracking-wider">SOLO OPERATOR</span>
      <span className="text-zinc-700">|</span>
      <span className={soloTraumaKit.chargesRemaining > 0 ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}>
        TRAUMA REVIVE {soloTraumaKit.chargesRemaining}/{soloTraumaKit.maxCharges}
      </span>
    </div>
  );
});

export const HudDownedOverlaySlot = React.memo(function HudDownedOverlaySlot({
  onTriggerSoloSelfRecovery,
  onRestartCheckpoint,
  onRestartMission,
  onAbort,
}: {
  onTriggerSoloSelfRecovery?: () => boolean | void;
  onRestartCheckpoint?: () => void;
  onRestartMission?: () => void;
  onAbort?: () => void;
}) {
  const downedState = useGameSessionStore((s) => s.downedState);
  if (!downedState?.active) return null;
  return (
    <DownedActionOverlay
      downedState={downedState}
      onTriggerSoloSelfRecovery={onTriggerSoloSelfRecovery}
      onRestartCheckpoint={onRestartCheckpoint}
      onRestartMission={onRestartMission}
      onAbort={onAbort}
    />
  );
});

export const HudSquadCommandSlot = React.memo(function HudSquadCommandSlot({
  compactHud,
  downedActive,
  fieldSwapOpen,
  onFieldSwapOpenChange,
  onIssueSquadCommand,
  onSwapFieldWeapon,
}: {
  compactHud: boolean;
  downedActive: boolean;
  fieldSwapOpen?: boolean;
  onFieldSwapOpenChange?: (open: boolean) => void;
  onIssueSquadCommand?: (
    order: SquadOrderType,
    source: SquadCommandSource,
    operatorId?: string
  ) => void;
  onSwapFieldWeapon: (replaceSlotIndex: number, nextWeaponId: WeaponId) => void;
}) {
  const deploymentMode = useGameSessionStore((s) => s.hud.deploymentMode);
  return (
    <SquadCommandHud
      compactHud={compactHud}
      downedActive={downedActive}
      swapOpen={fieldSwapOpen}
      onSwapOpenChange={onFieldSwapOpenChange}
      onIssueCommand={deploymentMode === 'solo' ? undefined : onIssueSquadCommand}
      onSwapFieldWeapon={onSwapFieldWeapon}
    />
  );
});

export const HudTouchControlsSlot = React.memo(function HudTouchControlsSlot({
  inputManager,
  onIssueSquadCommand,
}: {
  inputManager: InputManager | null;
  onIssueSquadCommand?: (
    order: SquadOrderType,
    source: SquadCommandSource,
    operatorId?: string
  ) => void;
}) {
  const hud = useGameSessionStore((s) => s.hud);
  return (
    <MobileTouchControls
      inputManager={inputManager}
      hud={hud}
      onIssueSquadCommand={hud.deploymentMode === 'solo' ? undefined : onIssueSquadCommand}
    />
  );
});
