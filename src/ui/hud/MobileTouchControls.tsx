import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bomb,
  Camera,
  ChevronUp,
  Crosshair,
  Flame,
  Hand,
  Layers,
  RefreshCw,
  Repeat,
  Target,
  X,
  Zap,
} from 'lucide-react';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { ExtendedInputAction, InputManager } from '@/src/engine/InputManager';
import { HudSnapshot } from '@/src/schemas/events.schema';
import { useSettingsStore } from '@/src/stores/settingsStore';

interface MobileTouchControlsProps {
  inputManager: InputManager | null;
  hud: HudSnapshot;
}

export function MobileTouchControls({ inputManager, hud }: MobileTouchControlsProps) {
  const touchJoystickScale = useSettingsStore((s) => s.input.touchJoystickScale);
  const touchDeadzone = useSettingsStore((s) => s.input.touchDeadzone);
  const touchButtonScale = useSettingsStore((s) => s.input.touchButtonScale);
  const touchOpacity = useSettingsStore((s) => s.input.touchButtonOpacity);
  const autoSprint = useSettingsStore((s) => s.input.autoSprint);
  const autoSprintThreshold = useSettingsStore((s) => s.input.touchAutoSprintThreshold);
  const touchManualSprintButton = useSettingsStore((s) => s.input.touchManualSprintButton);
  const touchAdsMode = useSettingsStore((s) => s.input.touchAdsMode);
  const touchFireBehavior = useSettingsStore((s) => s.input.touchFireBehavior);
  const touchFireOffsetX = useSettingsStore((s) => s.input.touchFireOffsetX);
  const touchFireOffsetY = useSettingsStore((s) => s.input.touchFireOffsetY);
  const touchAdsOffsetX = useSettingsStore((s) => s.input.touchAdsOffsetX);
  const touchAdsOffsetY = useSettingsStore((s) => s.input.touchAdsOffsetY);

  const stickPointerId = useRef<number | null>(null);
  const stickCenterRef = useRef<{ x: number; y: number; radius: number }>({ x: 0, y: 0, radius: 54 });
  const stickBaseRef = useRef<HTMLDivElement | null>(null);
  const [stickActive, setStickActive] = useState(false);
  const [floatingOrigin, setFloatingOrigin] = useState<{ left: number; top: number } | null>(null);
  const [stickOffset, setStickOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [sprintLocked, setSprintLocked] = useState(false);
  const [autoSprintEngaged, setAutoSprintEngaged] = useState(false);
  const [adsToggled, setAdsToggled] = useState(false);
  const [tacticalOpen, setTacticalOpen] = useState(false);

  const lookPointerId = useRef<number | null>(null);
  const lookLastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const heldButtonPointers = useRef<Map<number, ExtendedInputAction[]>>(new Map());
  const [heldActionsUi, setHeldActionsUi] = useState<Set<ExtendedInputAction>>(new Set());

  const releaseAllVirtual = useCallback(() => {
    stickPointerId.current = null;
    lookPointerId.current = null;
    setStickActive(false);
    setFloatingOrigin(null);
    setStickOffset({ x: 0, y: 0 });
    setSprintLocked(false);
    setAutoSprintEngaged(false);
    setAdsToggled(false);

    if (inputManager) {
      inputManager.setVirtualMoveAxes(0, 0);
      inputManager.setVirtualActionState('sprint', false);
      inputManager.setVirtualActionState('fire', false);
      inputManager.setVirtualActionState('ads', false);
      inputManager.setVirtualActionState('jump', false);
      inputManager.setVirtualActionState('crouch', false);
    }
    heldButtonPointers.current.clear();
    setHeldActionsUi(new Set());
  }, [inputManager]);

  useEffect(() => {
    const handleVisibilityOrBlur = () => {
      if (document.hidden || !document.hasFocus()) {
        releaseAllVirtual();
      }
    };
    window.addEventListener('blur', releaseAllVirtual);
    document.addEventListener('visibilitychange', handleVisibilityOrBlur);
    return () => {
      window.removeEventListener('blur', releaseAllVirtual);
      document.removeEventListener('visibilitychange', handleVisibilityOrBlur);
      releaseAllVirtual();
    };
  }, [releaseAllVirtual]);

  // Clear infantry toggles when entering/exiting vehicles so nothing sticks across state switches
  useEffect(() => {
    setAdsToggled(false);
    setTacticalOpen(false);
    inputManager?.setVirtualActionState('ads', false);
    inputManager?.setVirtualActionState('crouch', false);
  }, [hud.inVehicle, inputManager]);

  const syncUiHeldSet = () => {
    const next = new Set<ExtendedInputAction>();
    for (const actions of heldButtonPointers.current.values()) {
      for (const a of actions) next.add(a);
    }
    setHeldActionsUi(next);
  };

  const applyStickPosition = (clientX: number, clientY: number) => {
    const { x: cx, y: cy, radius } = stickCenterRef.current;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(radius, dist);
    const angle = Math.atan2(dy, dx);
    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;
    setStickOffset({ x: knobX, y: knobY });

    const normMag = Math.min(1, dist / Math.max(1, radius));
    const deadzone = Math.max(0.05, Math.min(0.28, touchDeadzone));
    if (normMag < deadzone) {
      inputManager?.setVirtualMoveAxes(0, 0);
      setAutoSprintEngaged(false);
      if (!sprintLocked) {
        inputManager?.setVirtualActionState('sprint', false);
      }
      return;
    }

    const linearMag = (normMag - deadzone) / Math.max(0.01, 1 - deadzone);
    // Smooth analog response curve for fine micro-walk near center and full stride at rim
    const curvedMag = Math.min(1, Math.pow(linearMag, 1.25));
    const dirX = dist > 0.001 ? dx / dist : 0;
    const dirY = dist > 0.001 ? dy / dist : 0;
    const right = dirX * curvedMag;
    const forward = -dirY * curvedMag;
    inputManager?.setVirtualMoveAxes(forward, right);

    // Auto-sprint ONLY when pushing forward beyond threshold inside a forward cone (never sideways/backward)
    const forwardSprintEngaged =
      !hud.inVehicle &&
      autoSprint &&
      normMag >= autoSprintThreshold &&
      forward >= autoSprintThreshold * 0.8 &&
      Math.abs(right) <= forward * 0.65;

    setAutoSprintEngaged(forwardSprintEngaged);
    if (forwardSprintEngaged) {
      inputManager?.setVirtualActionState('sprint', true);
    } else if (!sprintLocked) {
      inputManager?.setVirtualActionState('sprint', false);
    }
  };

  const padSize = Math.round(124 * touchJoystickScale);
  const knobSize = Math.round(48 * touchJoystickScale);

  const handleStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (stickPointerId.current !== null) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events in tests may not support pointer capture
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const radius = Math.max(44, Math.min(rect.width, rect.height) * 0.44);
    stickCenterRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      radius,
    };
    setFloatingOrigin(null);
    stickPointerId.current = e.pointerId;
    setStickActive(true);
    applyStickPosition(e.clientX, e.clientY);
  };

  const handleLeftZonePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (stickPointerId.current !== null) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer capture limitations
    }
    const halfPad = padSize / 2;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 844;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 390;
    const clampedX = Math.max(halfPad + 10, Math.min(vw * 0.42 - halfPad, e.clientX));
    const clampedY = Math.max(108 + halfPad, Math.min(vh - halfPad - 10, e.clientY));
    const radius = Math.max(44, padSize * 0.44);

    stickCenterRef.current = { x: clampedX, y: clampedY, radius };
    setFloatingOrigin({ left: clampedX - halfPad, top: clampedY - halfPad });
    stickPointerId.current = e.pointerId;
    setStickActive(true);
    applyStickPosition(e.clientX, e.clientY);
  };

  const handleStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    applyStickPosition(e.clientX, e.clientY);
  };

  const handleStickPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    stickPointerId.current = null;
    setStickActive(false);
    setFloatingOrigin(null);
    setStickOffset({ x: 0, y: 0 });
    setAutoSprintEngaged(false);
    inputManager?.setVirtualMoveAxes(0, 0);
    if (!sprintLocked) {
      inputManager?.setVirtualActionState('sprint', false);
    }
  };

  const handleLookPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (lookPointerId.current !== null) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    lookPointerId.current = e.pointerId;
    lookLastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleLookPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lookPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - lookLastPos.current.x;
    const dy = e.clientY - lookLastPos.current.y;
    lookLastPos.current = { x: e.clientX, y: e.clientY };
    inputManager?.addVirtualLookDelta(dx, dy);
  };

  const handleLookPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lookPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    lookPointerId.current = null;
  };

  const startHoldActions = (e: React.PointerEvent<HTMLButtonElement>, actions: ExtendedInputAction[]) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    heldButtonPointers.current.set(e.pointerId, actions);
    for (const a of actions) {
      inputManager?.setVirtualActionState(a, true);
    }
    syncUiHeldSet();
  };

  const endHoldActions = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const actions = heldButtonPointers.current.get(e.pointerId);
    if (!actions) return;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    heldButtonPointers.current.delete(e.pointerId);
    for (const a of actions) {
      // Preserve ADS if toggled on via dedicated ADS toggle button
      if (a === 'ads' && adsToggled) continue;
      const stillHeldByAnotherPointer = Array.from(heldButtonPointers.current.values()).some((arr) =>
        arr.includes(a)
      );
      if (!stillHeldByAnotherPointer) {
        inputManager?.setVirtualActionState(a, false);
      }
    }
    syncUiHeldSet();
  };

  const fireTapAction = (e: React.PointerEvent<HTMLButtonElement>, action: ExtendedInputAction) => {
    e.stopPropagation();
    inputManager?.triggerVirtualActionPress(action);
  };

  const handleAdsPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (touchAdsMode === 'hold') {
      startHoldActions(e, ['ads']);
      return;
    }
    const next = !adsToggled;
    setAdsToggled(next);
    inputManager?.setVirtualActionState('ads', next);
  };

  const handleAdsPointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (touchAdsMode === 'hold') {
      endHoldActions(e);
    } else {
      e.stopPropagation();
    }
  };

  const fireActions: ExtendedInputAction[] =
    touchFireBehavior === 'ads_on_fire' && !hud.inVehicle ? ['ads', 'fire'] : ['fire'];

  const fireSize = Math.round(72 * touchButtonScale);
  const primaryBtnSize = Math.round(48 * touchButtonScale);
  const compactBtnSize = Math.round(44 * touchButtonScale);

  const showAdsActive = adsToggled || heldActionsUi.has('ads') || hud.isAds;

  return (
    <div
      data-testid="mobile-touch-controls"
      className="fixed inset-0 z-20 pointer-events-none select-none touch-none-surface"
      style={{ opacity: Math.max(0.35, Math.min(0.95, touchOpacity)) }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Left Floating Movement Zone (PUBG-style: touch anywhere on lower-left half to engage 360° stick) */}
      <div
        data-testid="touch-move-zone"
        aria-label="Movement Touch Zone"
        className="pointer-events-auto touch-none-surface fixed left-0 right-[58%] top-[98px] bottom-0"
        onPointerDown={handleLeftZonePointerDown}
        onPointerMove={handleStickPointerMove}
        onPointerUp={handleStickPointerEnd}
        onPointerCancel={handleStickPointerEnd}
        onLostPointerCapture={handleStickPointerEnd}
      />

      {/* Right Independent 360-Degree Camera Look Surface (never triggers Fire) */}
      <div
        data-testid="touch-look-zone"
        aria-label="Touch Aim Look Zone"
        className="pointer-events-auto touch-none-surface fixed top-14 bottom-0 right-0 left-[42%]"
        onPointerDown={handleLookPointerDown}
        onPointerMove={handleLookPointerMove}
        onPointerUp={handleLookPointerEnd}
        onPointerCancel={handleLookPointerEnd}
        onLostPointerCapture={handleLookPointerEnd}
      />

      {/* Left Movement Thumbstick + Subtle Auto-Sprint Indicator / Optional Manual Sprint */}
      <div
        className="pointer-events-none fixed flex flex-col items-center gap-1.5"
        style={
          floatingOrigin
            ? { left: `${floatingOrigin.left}px`, top: `${floatingOrigin.top}px` }
            : {
                left: 'max(16px, env(safe-area-inset-left, 0px))',
                bottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
              }
        }
      >
        {/* Subtle auto-sprint active badge only while pushing forward into sprint */}
        {!hud.inVehicle && autoSprintEngaged && !touchManualSprintButton && (
          <div className="pointer-events-none flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/25 border border-amber-400/70 font-mono text-[9px] font-bold uppercase text-amber-200">
            <ChevronUp className="w-3 h-3" />
            <span>SPRINT</span>
          </div>
        )}

        {/* Optional Manual Sprint Override (hidden by default; configurable in Settings) */}
        {!hud.inVehicle && touchManualSprintButton && (
          <button
            type="button"
            data-testid="touch-btn-sprint"
            aria-label="Toggle Sprint"
            aria-pressed={sprintLocked || hud.isSprinting}
            onPointerDown={(e) => {
              e.stopPropagation();
              const next = !sprintLocked;
              setSprintLocked(next);
              inputManager?.setVirtualActionState('sprint', next);
            }}
            className={`pointer-events-auto touch-none-surface min-w-[44px] min-h-[44px] px-2.5 rounded-full border font-mono text-[10px] font-bold uppercase flex items-center gap-1 transition-colors ${
              sprintLocked || hud.isSprinting
                ? 'bg-amber-500/35 border-amber-400 text-amber-100'
                : 'bg-[#0B0E11]/75 border-white/15 text-zinc-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>SPRINT</span>
          </button>
        )}

        <div
          ref={stickBaseRef}
          data-testid="touch-move-stick"
          aria-label="Movement Analog Stick"
          onPointerDown={handleStickPointerDown}
          onPointerMove={handleStickPointerMove}
          onPointerUp={handleStickPointerEnd}
          onPointerCancel={handleStickPointerEnd}
          onLostPointerCapture={handleStickPointerEnd}
          style={{ width: `${padSize}px`, height: `${padSize}px` }}
          className={`pointer-events-auto touch-none-surface relative rounded-full border flex items-center justify-center transition-colors ${
            stickActive
              ? 'bg-[#141920]/70 border-amber-400/80'
              : 'bg-[#0B0E11]/55 border-white/20'
          }`}
        >
          <div className="absolute inset-4 rounded-full border border-white/10 pointer-events-none" />
          <div
            style={{
              width: `${knobSize}px`,
              height: `${knobSize}px`,
              transform: `translate3d(${stickOffset.x}px, ${stickOffset.y}px, 0)`,
            }}
            className={`rounded-full border pointer-events-none ${
              stickActive
                ? 'bg-amber-400/85 border-amber-100 shadow-lg'
                : 'bg-zinc-200/35 border-white/35'
            }`}
          />
        </div>
      </div>

      {/* Center-Bottom Contextual Prompts (Interact / Nuke Auth — appear ONLY when relevant) */}
      <div
        className="pointer-events-none fixed left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        style={{ bottom: 'max(14px, env(safe-area-inset-bottom, 0px))' }}
      >
        {hud.ordnance && hud.ordnance.nukePendingConfirmSec > 0 && (
          <div className="pointer-events-auto flex items-center gap-2 bg-[#1b1010]/95 border border-red-500 p-1.5 rounded-sm">
            <button
              type="button"
              data-testid="touch-btn-confirm-nuke"
              onPointerDown={(e) => fireTapAction(e, 'confirmNuke')}
              className="touch-none-surface min-w-[44px] min-h-[44px] px-3 bg-red-600 text-white font-mono text-[11px] font-bold uppercase rounded-sm"
            >
              Confirm Strike
            </button>
            <button
              type="button"
              data-testid="touch-btn-cancel-nuke"
              onPointerDown={(e) => fireTapAction(e, 'cancelNuke')}
              className="touch-none-surface min-w-[44px] min-h-[44px] px-3 bg-zinc-800 text-zinc-200 font-mono text-[11px] uppercase rounded-sm"
            >
              Cancel
            </button>
          </div>
        )}

        {!hud.inVehicle && hud.interactPrompt && (
          <button
            type="button"
            data-testid="touch-btn-interact"
            aria-label={hud.interactPrompt}
            onPointerDown={(e) => fireTapAction(e, 'interact')}
            className="pointer-events-auto touch-none-surface min-w-[48px] min-h-[44px] px-4 bg-[#0B0E11]/90 border-2 border-amber-400 text-amber-300 font-mono text-xs font-bold uppercase rounded-full flex items-center gap-1.5 shadow-lg"
          >
            <Hand className="w-4 h-4 shrink-0" />
            <span>{hud.interactPrompt.replace('[E] ', '')}</span>
          </button>
        )}
      </div>

      {/* Right PUBG-Style Ergonomic Combat HUD */}
      <div
        className="pointer-events-none fixed flex flex-col items-end gap-2"
        style={{
          right: 'max(14px, env(safe-area-inset-right, 0px))',
          bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {hud.inVehicle ? (
          /* Vehicle-Only Controls (replaces infantry controls cleanly) */
          <div className="pointer-events-none flex flex-col items-end gap-2.5">
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                data-testid="touch-btn-veh-cam"
                aria-label="Switch Vehicle Camera"
                onPointerDown={(e) => fireTapAction(e, 'vehicleCamera')}
                className="touch-none-surface min-w-[48px] min-h-[44px] px-3 bg-[#0B0E11]/80 border border-white/20 rounded-full font-mono text-[10px] font-bold text-emerald-300 flex items-center gap-1"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>CAM</span>
              </button>
              <button
                type="button"
                data-testid="touch-btn-veh-exit"
                aria-label="Exit Vehicle"
                onPointerDown={(e) => fireTapAction(e, 'interact')}
                className="touch-none-surface min-w-[48px] min-h-[44px] px-3 bg-[#0B0E11]/85 border border-amber-400/80 rounded-full font-mono text-[10px] text-amber-300 font-bold"
              >
                EXIT
              </button>
            </div>

            <button
              type="button"
              data-testid="touch-btn-fire"
              aria-label="Fire Vehicle Turret"
              onPointerDown={(e) => startHoldActions(e, ['fire'])}
              onPointerUp={endHoldActions}
              onPointerCancel={endHoldActions}
              onLostPointerCapture={endHoldActions}
              style={{
                width: `${Math.max(60, fireSize)}px`,
                height: `${Math.max(60, fireSize)}px`,
                transform: `translate3d(${touchFireOffsetX}px, ${touchFireOffsetY}px, 0)`,
              }}
              className={`pointer-events-auto touch-none-surface min-w-[60px] min-h-[60px] rounded-full border-2 font-mono text-[11px] font-bold uppercase flex flex-col items-center justify-center shadow-xl ${
                heldActionsUi.has('fire')
                  ? 'bg-red-600/85 border-amber-300 text-white scale-95'
                  : 'bg-amber-500/35 border-amber-400 text-amber-100'
              }`}
            >
              <Crosshair className="w-5 h-5" />
              <span className="mt-0.5">GUN</span>
            </button>
          </div>
        ) : (
          /* Simplified PUBG Mobile Infantry Cluster */
          <div className="pointer-events-none flex flex-col items-end gap-2">
            {/* Expandable Secondary Equipment / Ordnance Drawer (only mounted when toggled open) */}
            {tacticalOpen && (
              <div
                data-testid="touch-tactical-drawer"
                className="pointer-events-auto bg-[#0B0E11]/92 border border-white/15 rounded-md p-2 flex flex-col gap-2 shadow-2xl max-w-[260px]"
              >
                <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                    Kit &amp; Ordnance
                  </span>
                  <button
                    type="button"
                    aria-label="Close Tactical Kit"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setTacticalOpen(false);
                    }}
                    className="min-w-[32px] min-h-[32px] flex items-center justify-center text-zinc-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Secondary Actions: Fire Mode, C4, Bomb Strike, Cycle Bomb */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    data-testid="touch-btn-firemode"
                    aria-label="Cycle Fire Mode"
                    onPointerDown={(e) => fireTapAction(e, 'fireMode')}
                    className="touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#141920] border border-zinc-700 rounded-sm font-mono text-[10px] font-bold uppercase text-zinc-200"
                  >
                    {hud.fireMode}
                  </button>

                  {hud.ordnance && (
                    <>
                      <button
                        type="button"
                        data-testid="touch-btn-c4"
                        aria-label={hud.ordnance.c4Deployed > 0 ? 'Detonate C4' : 'Place C4'}
                        onPointerDown={(e) => {
                          fireTapAction(e, hud.ordnance && hud.ordnance.c4Deployed > 0 ? 'c4Detonate' : 'c4');
                          setTacticalOpen(false);
                        }}
                        className="touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#141920] border border-amber-500/50 rounded-sm font-mono text-[10px] font-bold text-amber-300"
                      >
                        {hud.ordnance.c4Deployed > 0 ? 'DET C4' : `C4 (${hud.ordnance.c4Inventory})`}
                      </button>
                      <button
                        type="button"
                        data-testid="touch-btn-strike"
                        aria-label="Call Bomb Strike"
                        onPointerDown={(e) => {
                          fireTapAction(e, 'bombStrike');
                          setTacticalOpen(false);
                        }}
                        className="touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#141920] border border-cyan-500/50 rounded-sm font-mono text-[10px] font-bold text-cyan-300 flex items-center gap-1"
                      >
                        <Bomb className="w-3.5 h-3.5" />
                        <span>{hud.ordnance.selectedBombShort}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="touch-btn-cycle-bomb"
                        aria-label="Cycle Bomb Type"
                        onPointerDown={(e) => fireTapAction(e, 'cycleBomb')}
                        className="touch-none-surface min-w-[44px] min-h-[44px] px-2 bg-[#141920] border border-zinc-700 rounded-sm font-mono text-[10px] text-zinc-300"
                      >
                        TYPE
                      </button>
                      {!hud.ordnance.nukeUsed &&
                        (hud.ordnance.sandboxAuthorized ||
                          hud.ordnance.requisitionPoints >= hud.ordnance.nukeCost) && (
                          <button
                            type="button"
                            data-testid="touch-btn-nuke"
                            aria-label="Request Strategic Strike"
                            onPointerDown={(e) => {
                              fireTapAction(e, 'strategicNuke');
                              setTacticalOpen(false);
                            }}
                            className="touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-red-950/90 border border-red-500 rounded-sm font-mono text-[10px] font-bold text-red-200"
                          >
                            TRIDENT
                          </button>
                        )}
                    </>
                  )}
                </div>

                {/* Direct Weapon Slot Selector */}
                <div className="grid grid-cols-3 gap-1">
                  {WEAPON_CATALOG.map((w) => {
                    const active = w.id === hud.weaponId;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        data-testid={`touch-slot-${w.slot}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          inputManager?.queueWeaponSlot(w.slot);
                          setTacticalOpen(false);
                        }}
                        className={`touch-none-surface min-h-[38px] px-1.5 rounded-sm border font-mono text-[9px] font-bold uppercase truncate ${
                          active
                            ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                            : 'bg-[#141920] border-zinc-800 text-zinc-300'
                        }`}
                      >
                        {w.slot}. {w.shortName}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Contextual Row: Grenade (ONLY when grenades > 0), Detonate C4 (ONLY when deployed), + Kit Toggle */}
            <div className="pointer-events-auto flex items-center gap-1.5">
              {hud.ordnance && hud.ordnance.c4Deployed > 0 && (
                <button
                  type="button"
                  data-testid="touch-btn-c4-detonate"
                  aria-label="Detonate Planted C4"
                  onPointerDown={(e) => fireTapAction(e, 'c4Detonate')}
                  className="touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-red-950/85 border border-red-400 rounded-full font-mono text-[10px] font-bold text-red-200 flex items-center justify-center"
                >
                  DET
                </button>
              )}

              {hud.grenades > 0 && (
                <button
                  type="button"
                  data-testid="touch-btn-grenade"
                  aria-label="Throw Frag Grenade"
                  onPointerDown={(e) => fireTapAction(e, 'grenade')}
                  style={{ height: `${compactBtnSize}px`, minWidth: `${compactBtnSize}px` }}
                  className="touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#0B0E11]/75 border border-amber-400/50 rounded-full font-mono text-[10px] font-bold text-amber-300 flex items-center justify-center gap-1"
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span className="tabular-nums">{hud.grenades}</span>
                </button>
              )}

              <button
                type="button"
                data-testid="touch-btn-weapon-switch"
                aria-label="Switch Weapon"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  inputManager?.cycleWeapon(1);
                }}
                style={{ height: `${compactBtnSize}px` }}
                className="touch-none-surface min-w-[68px] min-h-[44px] px-2.5 bg-[#0B0E11]/75 border border-white/20 rounded-full font-mono text-[10px] font-bold uppercase text-zinc-100 flex items-center justify-center gap-1.5"
              >
                <Repeat className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate max-w-[64px]">{hud.weaponName}</span>
              </button>

              <button
                type="button"
                data-testid="touch-btn-tactical-drawer"
                aria-label="Toggle Tactical Kit"
                aria-expanded={tacticalOpen}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setTacticalOpen((v) => !v);
                }}
                style={{ width: `${compactBtnSize}px`, height: `${compactBtnSize}px` }}
                className={`touch-none-surface min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center ${
                  tacticalOpen
                    ? 'bg-amber-500/30 border-amber-400 text-amber-200'
                    : 'bg-[#0B0E11]/75 border-white/20 text-zinc-300'
                }`}
              >
                <Layers className="w-4 h-4" />
              </button>
            </div>

            {/* Primary Thumb Arc: Jump, Crouch/Slide, Reload, ADS Toggle, Prominent FIRE */}
            <div className="pointer-events-none flex items-end gap-2">
              <div className="pointer-events-auto flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="touch-btn-reload"
                    aria-label="Reload Weapon"
                    onPointerDown={(e) => fireTapAction(e, 'reload')}
                    style={{ width: `${compactBtnSize}px`, height: `${compactBtnSize}px` }}
                    className="touch-none-surface min-w-[44px] min-h-[44px] bg-[#0B0E11]/75 border border-white/20 rounded-full text-zinc-100 flex items-center justify-center"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    data-testid="touch-btn-ads"
                    aria-label="Aim Down Sights"
                    aria-pressed={showAdsActive}
                    onPointerDown={handleAdsPointerDown}
                    onPointerUp={handleAdsPointerEnd}
                    onPointerCancel={handleAdsPointerEnd}
                    onLostPointerCapture={handleAdsPointerEnd}
                    style={{
                      width: `${primaryBtnSize}px`,
                      height: `${primaryBtnSize}px`,
                      transform: `translate3d(${touchAdsOffsetX}px, ${touchAdsOffsetY}px, 0)`,
                    }}
                    className={`touch-none-surface min-w-[44px] min-h-[44px] rounded-full border font-mono text-[10px] font-bold flex flex-col items-center justify-center ${
                      showAdsActive
                        ? 'bg-cyan-500/45 border-cyan-300 text-white'
                        : 'bg-[#0B0E11]/75 border-white/25 text-cyan-200'
                    }`}
                  >
                    <Target className="w-4 h-4" />
                    <span className="leading-none mt-0.5 text-[9px]">ADS</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="touch-btn-crouch"
                    aria-label="Crouch or Slide"
                    onPointerDown={(e) => startHoldActions(e, ['crouch'])}
                    onPointerUp={endHoldActions}
                    onPointerCancel={endHoldActions}
                    onLostPointerCapture={endHoldActions}
                    style={{ width: `${compactBtnSize}px`, height: `${compactBtnSize}px` }}
                    className={`touch-none-surface min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center ${
                      heldActionsUi.has('crouch') || hud.isCrouching
                        ? 'bg-cyan-500/35 border-cyan-400 text-cyan-200'
                        : 'bg-[#0B0E11]/75 border-white/20 text-zinc-200'
                    }`}
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    data-testid="touch-btn-jump"
                    aria-label="Jump"
                    onPointerDown={(e) => startHoldActions(e, ['jump'])}
                    onPointerUp={endHoldActions}
                    onPointerCancel={endHoldActions}
                    onLostPointerCapture={endHoldActions}
                    style={{ width: `${compactBtnSize}px`, height: `${compactBtnSize}px` }}
                    className={`touch-none-surface min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center ${
                      heldActionsUi.has('jump')
                        ? 'bg-amber-500/35 border-amber-400 text-amber-200'
                        : 'bg-[#0B0E11]/75 border-white/20 text-zinc-200'
                    }`}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Prominent Primary FIRE Trigger */}
              <button
                type="button"
                data-testid="touch-btn-fire"
                aria-label="Fire Weapon"
                onPointerDown={(e) => startHoldActions(e, fireActions)}
                onPointerUp={endHoldActions}
                onPointerCancel={endHoldActions}
                onLostPointerCapture={endHoldActions}
                style={{
                  width: `${Math.max(60, fireSize)}px`,
                  height: `${Math.max(60, fireSize)}px`,
                  transform: `translate3d(${touchFireOffsetX}px, ${touchFireOffsetY}px, 0)`,
                }}
                className={`pointer-events-auto touch-none-surface min-w-[60px] min-h-[60px] rounded-full border-2 font-mono text-[11px] font-bold uppercase flex flex-col items-center justify-center shadow-xl ${
                  heldActionsUi.has('fire')
                    ? 'bg-red-600/85 border-amber-300 text-white scale-95'
                    : 'bg-amber-500/35 border-amber-400 text-amber-50'
                }`}
              >
                <Crosshair className="w-5 h-5" />
                <span className="mt-0.5">FIRE</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
