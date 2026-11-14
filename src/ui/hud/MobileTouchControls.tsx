import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bomb,
  Camera,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Flame,
  Hand,
  RefreshCw,
  Shield,
  Zap,
} from 'lucide-react';
import { ExtendedInputAction, InputManager } from '@/src/engine/InputManager';
import { HudSnapshot } from '@/src/schemas/events.schema';
import { useSettingsStore } from '@/src/stores/settingsStore';

interface MobileTouchControlsProps {
  inputManager: InputManager | null;
  hud: HudSnapshot;
}

const STICK_DEADZONE = 0.12;
const SPRINT_THRESHOLD = 0.85;

export function MobileTouchControls({ inputManager, hud }: MobileTouchControlsProps) {
  const touchScale = useSettingsStore((s) => s.input.touchButtonScale);
  const touchOpacity = useSettingsStore((s) => s.input.touchButtonOpacity);
  const autoSprint = useSettingsStore((s) => s.input.autoSprint);
  const touchFireBehavior = useSettingsStore((s) => s.input.touchFireBehavior);

  const stickPointerId = useRef<number | null>(null);
  const stickCenterRef = useRef<{ x: number; y: number; radius: number }>({ x: 0, y: 0, radius: 52 });
  const [stickActive, setStickActive] = useState(false);
  const [stickOffset, setStickOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [sprintLocked, setSprintLocked] = useState(false);

  const lookPointerId = useRef<number | null>(null);
  const lookLastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const heldButtonPointers = useRef<Map<number, ExtendedInputAction[]>>(new Map());
  const [heldActionsUi, setHeldActionsUi] = useState<Set<ExtendedInputAction>>(new Set());

  const releaseAllVirtual = () => {
    stickPointerId.current = null;
    lookPointerId.current = null;
    setStickActive(false);
    setStickOffset({ x: 0, y: 0 });
    setSprintLocked(false);

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
  };

  useEffect(() => {
    return () => {
      releaseAllVirtual();
    };
  }, [inputManager]);

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
    if (normMag < STICK_DEADZONE) {
      inputManager?.setVirtualMoveAxes(0, 0);
      if (!sprintLocked) {
        inputManager?.setVirtualActionState('sprint', false);
      }
      return;
    }

    const scaledMag = (normMag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    const dirX = dist > 0.001 ? dx / dist : 0;
    const dirY = dist > 0.001 ? dy / dist : 0;
    const right = dirX * scaledMag;
    const forward = -dirY * scaledMag;
    inputManager?.setVirtualMoveAxes(forward, right);

    if (autoSprint && normMag >= SPRINT_THRESHOLD && forward > 0.35) {
      inputManager?.setVirtualActionState('sprint', true);
    } else if (!sprintLocked) {
      inputManager?.setVirtualActionState('sprint', false);
    }
  };

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
    setStickOffset({ x: 0, y: 0 });
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

  const fireActions: ExtendedInputAction[] =
    touchFireBehavior === 'ads_on_fire' && !hud.inVehicle ? ['ads', 'fire'] : ['fire'];

  const padSize = Math.round(116 * touchScale);
  const knobSize = Math.round(46 * touchScale);

  return (
    <div
      data-testid="mobile-touch-controls"
      className="fixed inset-0 z-20 pointer-events-none select-none touch-none-surface"
      style={{ opacity: Math.max(0.35, Math.min(0.95, touchOpacity)) }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Right Aim / Camera Look Drag Surface (never triggers Fire on tap or drag) */}
      <div
        data-testid="touch-look-zone"
        aria-label="Touch Aim Look Zone"
        className="pointer-events-auto touch-none-surface absolute top-14 bottom-0 right-0 left-[38%]"
        onPointerDown={handleLookPointerDown}
        onPointerMove={handleLookPointerMove}
        onPointerUp={handleLookPointerEnd}
        onPointerCancel={handleLookPointerEnd}
        onLostPointerCapture={handleLookPointerEnd}
      />

      {/* Left Movement Thumbstick + Sprint Lock */}
      <div
        className="pointer-events-none absolute flex flex-col items-start gap-2"
        style={{
          left: 'max(14px, env(safe-area-inset-left, 0px))',
          bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        }}
      >
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
          className={`pointer-events-auto touch-none-surface min-w-[44px] min-h-[44px] px-3 rounded-sm border font-mono text-[10px] font-bold uppercase flex items-center gap-1 transition-colors ${
            sprintLocked || hud.isSprinting
              ? 'bg-amber-500/35 border-amber-400 text-amber-200'
              : 'bg-[#0B0E11]/80 border-zinc-700 text-zinc-300'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>{hud.inVehicle ? 'BOOST' : 'SPRINT'}</span>
        </button>

        <div
          data-testid="touch-move-stick"
          aria-label="Movement Analog Stick"
          onPointerDown={handleStickPointerDown}
          onPointerMove={handleStickPointerMove}
          onPointerUp={handleStickPointerEnd}
          onPointerCancel={handleStickPointerEnd}
          onLostPointerCapture={handleStickPointerEnd}
          style={{ width: `${padSize}px`, height: `${padSize}px` }}
          className={`pointer-events-auto touch-none-surface relative rounded-full border-2 flex items-center justify-center transition-colors ${
            stickActive
              ? 'bg-[#141920]/75 border-amber-400/90'
              : 'bg-[#0B0E11]/60 border-zinc-600/80'
          }`}
        >
          <div className="absolute inset-3 rounded-full border border-zinc-700/60 pointer-events-none" />
          <div
            style={{
              width: `${knobSize}px`,
              height: `${knobSize}px`,
              transform: `translate(${stickOffset.x}px, ${stickOffset.y}px)`,
            }}
            className={`rounded-full border pointer-events-none transition-transform duration-75 ${
              stickActive
                ? 'bg-amber-500/80 border-amber-200 shadow-lg'
                : 'bg-zinc-300/30 border-zinc-400/60'
            }`}
          />
        </div>
      </div>

      {/* Center-Bottom Contextual Interact Prompt & Nuke Confirmation */}
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
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

        {hud.interactPrompt && (
          <button
            type="button"
            data-testid="touch-btn-interact"
            aria-label={hud.interactPrompt}
            onPointerDown={(e) => fireTapAction(e, 'interact')}
            className="pointer-events-auto touch-none-surface min-w-[48px] min-h-[44px] px-4 bg-[#0B0E11]/92 border-2 border-amber-400 text-amber-300 font-mono text-xs font-bold uppercase rounded-sm flex items-center gap-1.5 shadow-lg"
          >
            <Hand className="w-4 h-4 shrink-0" />
            <span>{hud.interactPrompt.replace('[E] ', '')}</span>
          </button>
        )}
      </div>

      {/* Right Combat Action Cluster */}
      <div
        className="pointer-events-none absolute flex flex-col items-end gap-2"
        style={{
          right: 'max(14px, env(safe-area-inset-right, 0px))',
          bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Top Row: Weapon Cycling + Ordnance / Vehicle Utilities */}
        {!hud.inVehicle ? (
          <div className="pointer-events-auto flex items-center gap-1.5">
            <button
              type="button"
              data-testid="touch-btn-weapon-prev"
              aria-label="Previous Weapon"
              onPointerDown={(e) => {
                e.stopPropagation();
                inputManager?.cycleWeapon(-1);
              }}
              className="touch-none-surface min-w-[44px] min-h-[44px] bg-[#0B0E11]/82 border border-zinc-700 rounded-sm text-zinc-200 flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              data-testid="touch-btn-weapon-next"
              aria-label="Next Weapon"
              onPointerDown={(e) => {
                e.stopPropagation();
                inputManager?.cycleWeapon(1);
              }}
              className="touch-none-surface min-w-[44px] min-h-[44px] bg-[#0B0E11]/82 border border-zinc-700 rounded-sm text-zinc-200 flex items-center justify-center"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {hud.ordnance && (
              <>
                <button
                  type="button"
                  data-testid="touch-btn-c4"
                  aria-label={hud.ordnance.c4Deployed > 0 ? 'Detonate C4' : 'Place C4'}
                  onPointerDown={(e) =>
                    fireTapAction(e, hud.ordnance && hud.ordnance.c4Deployed > 0 ? 'c4Detonate' : 'c4')
                  }
                  className="touch-none-surface min-w-[44px] min-h-[44px] px-2 bg-[#0B0E11]/82 border border-zinc-700 rounded-sm font-mono text-[10px] font-bold text-amber-300 flex items-center justify-center"
                >
                  {hud.ordnance.c4Deployed > 0 ? 'DET' : `C4:${hud.ordnance.c4Inventory}`}
                </button>
                <button
                  type="button"
                  data-testid="touch-btn-strike"
                  aria-label="Call Bomb Strike"
                  onPointerDown={(e) => fireTapAction(e, 'bombStrike')}
                  className="touch-none-surface min-w-[44px] min-h-[44px] px-2 bg-[#0B0E11]/82 border border-zinc-700 rounded-sm font-mono text-[10px] font-bold text-cyan-300 flex items-center justify-center"
                >
                  <Bomb className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="pointer-events-auto flex items-center gap-1.5">
            <button
              type="button"
              data-testid="touch-btn-veh-cam"
              aria-label="Switch Vehicle Camera"
              onPointerDown={(e) => fireTapAction(e, 'vehicleCamera')}
              className="touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#0B0E11]/85 border border-zinc-700 rounded-sm font-mono text-[10px] text-emerald-300 flex items-center gap-1"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>CAM</span>
            </button>
            <button
              type="button"
              data-testid="touch-btn-veh-exit"
              aria-label="Exit Vehicle"
              onPointerDown={(e) => fireTapAction(e, 'interact')}
              className="touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#0B0E11]/85 border border-amber-500/80 rounded-sm font-mono text-[10px] text-amber-300 font-bold"
            >
              EXIT
            </button>
          </div>
        )}

        {/* Middle & Primary Combat Row */}
        <div className="pointer-events-auto flex items-end gap-2">
          {!hud.inVehicle && (
            <div className="flex flex-col gap-1.5 items-end">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="touch-btn-reload"
                  aria-label="Reload Weapon"
                  onPointerDown={(e) => fireTapAction(e, 'reload')}
                  className="touch-none-surface min-w-[44px] min-h-[44px] bg-[#0B0E11]/85 border border-zinc-700 rounded-sm text-zinc-100 flex items-center justify-center"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  data-testid="touch-btn-grenade"
                  aria-label="Throw Frag Grenade"
                  onPointerDown={(e) => fireTapAction(e, 'grenade')}
                  className="touch-none-surface min-w-[44px] min-h-[44px] px-2 bg-[#0B0E11]/85 border border-zinc-700 rounded-sm font-mono text-[10px] text-amber-300 flex items-center gap-1"
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>{hud.grenades}</span>
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
                  className={`touch-none-surface min-w-[44px] min-h-[44px] rounded-sm border flex items-center justify-center ${
                    heldActionsUi.has('crouch') || hud.isCrouching
                      ? 'bg-cyan-500/35 border-cyan-400 text-cyan-200'
                      : 'bg-[#0B0E11]/85 border-zinc-700 text-zinc-200'
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
                  className={`touch-none-surface min-w-[44px] min-h-[44px] rounded-sm border flex items-center justify-center ${
                    heldActionsUi.has('jump')
                      ? 'bg-amber-500/35 border-amber-400 text-amber-200'
                      : 'bg-[#0B0E11]/85 border-zinc-700 text-zinc-200'
                  }`}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  data-testid="touch-btn-ads"
                  aria-label="Aim Down Sights"
                  onPointerDown={(e) => startHoldActions(e, ['ads'])}
                  onPointerUp={endHoldActions}
                  onPointerCancel={endHoldActions}
                  onLostPointerCapture={endHoldActions}
                  className={`touch-none-surface min-w-[48px] min-h-[48px] rounded-sm border font-mono text-[10px] font-bold flex flex-col items-center justify-center ${
                    heldActionsUi.has('ads') || hud.isAds
                      ? 'bg-cyan-500/40 border-cyan-300 text-white'
                      : 'bg-[#0B0E11]/85 border-zinc-600 text-cyan-300'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>ADS</span>
                </button>
              </div>
            </div>
          )}

          {/* Primary FIRE / TURRET Trigger (>= 60x60px) */}
          <button
            type="button"
            data-testid="touch-btn-fire"
            aria-label={hud.inVehicle ? 'Fire Vehicle Turret' : 'Fire Weapon'}
            onPointerDown={(e) => startHoldActions(e, fireActions)}
            onPointerUp={endHoldActions}
            onPointerCancel={endHoldActions}
            onLostPointerCapture={endHoldActions}
            style={{
              width: `${Math.round(66 * touchScale)}px`,
              height: `${Math.round(66 * touchScale)}px`,
            }}
            className={`touch-none-surface min-w-[60px] min-h-[60px] rounded-full border-2 font-mono text-[11px] font-bold uppercase flex flex-col items-center justify-center shadow-xl transition-transform ${
              heldActionsUi.has('fire')
                ? 'bg-red-600/80 border-amber-300 text-white scale-95'
                : 'bg-amber-500/30 border-amber-400 text-amber-100'
            }`}
          >
            <Crosshair className="w-5 h-5" />
            <span className="mt-0.5">{hud.inVehicle ? 'GUN' : 'FIRE'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
