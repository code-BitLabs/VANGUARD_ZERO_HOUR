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

  const rootRef = useRef<HTMLDivElement | null>(null);
  const stickBaseRef = useRef<HTMLDivElement | null>(null);

  // Refs for latest reactive values so window-level multi-touch listeners never go stale or detach mid-gesture
  const inputManagerRef = useRef<InputManager | null>(inputManager);
  inputManagerRef.current = inputManager;
  const inVehicleRef = useRef<boolean>(hud.inVehicle);
  inVehicleRef.current = hud.inVehicle;
  const touchDeadzoneRef = useRef<number>(touchDeadzone);
  touchDeadzoneRef.current = touchDeadzone;
  const autoSprintRef = useRef<boolean>(autoSprint);
  autoSprintRef.current = autoSprint;
  const autoSprintThresholdRef = useRef<number>(autoSprintThreshold);
  autoSprintThresholdRef.current = autoSprintThreshold;

  const stickPointerId = useRef<number | null>(null);
  const stickCenterRef = useRef<{ x: number; y: number; radius: number }>({ x: 0, y: 0, radius: 52 });
  const [stickActive, setStickActive] = useState(false);
  const [floatingOrigin, setFloatingOrigin] = useState<{ left: number; top: number } | null>(null);
  const [stickOffset, setStickOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [sprintLocked, setSprintLocked] = useState(false);
  const sprintLockedRef = useRef(false);
  sprintLockedRef.current = sprintLocked;
  const [autoSprintEngaged, setAutoSprintEngaged] = useState(false);
  const [adsToggled, setAdsToggled] = useState(false);
  const adsToggledRef = useRef(false);
  adsToggledRef.current = adsToggled;
  const [tacticalOpen, setTacticalOpen] = useState(false);

  const lookPointerId = useRef<number | null>(null);
  const lookLastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const heldButtonPointers = useRef<Map<number, ExtendedInputAction[]>>(new Map());
  const heldButtonDragPos = useRef<Map<number, { x: number; y: number }>>(new Map());
  const [heldActionsUi, setHeldActionsUi] = useState<Set<ExtendedInputAction>>(new Set());

  const padSize = Math.round(124 * touchJoystickScale);
  const knobSize = Math.round(48 * touchJoystickScale);

  const syncUiHeldSet = useCallback(() => {
    const next = new Set<ExtendedInputAction>();
    for (const actions of heldButtonPointers.current.values()) {
      for (const a of actions) next.add(a);
    }
    setHeldActionsUi(next);
  }, []);

  const releaseAllVirtual = useCallback(() => {
    stickPointerId.current = null;
    lookPointerId.current = null;
    setStickActive(false);
    setFloatingOrigin(null);
    setStickOffset({ x: 0, y: 0 });
    setSprintLocked(false);
    sprintLockedRef.current = false;
    setAutoSprintEngaged(false);
    setAdsToggled(false);
    adsToggledRef.current = false;

    const im = inputManagerRef.current;
    if (im) {
      im.setVirtualMoveAxes(0, 0);
      im.setVirtualActionState('sprint', false);
      im.setVirtualActionState('fire', false);
      im.setVirtualActionState('ads', false);
      im.setVirtualActionState('jump', false);
      im.setVirtualActionState('crouch', false);
    }
    heldButtonPointers.current.clear();
    heldButtonDragPos.current.clear();
    setHeldActionsUi(new Set());
  }, []);

  const applyStickPosition = useCallback((clientX: number, clientY: number) => {
    const im = inputManagerRef.current;
    const { x: cx, y: cy, radius } = stickCenterRef.current;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(radius, dist);
    const angle = Math.atan2(dy, dx);
    const knobX = dist > 0.001 ? Math.cos(angle) * clampedDist : 0;
    const knobY = dist > 0.001 ? Math.sin(angle) * clampedDist : 0;
    setStickOffset({ x: knobX, y: knobY });

    const normMag = Math.min(1, dist / Math.max(1, radius));
    const deadzone = Math.max(0.05, Math.min(0.28, touchDeadzoneRef.current));
    if (normMag < deadzone) {
      im?.setVirtualMoveAxes(0, 0);
      setAutoSprintEngaged(false);
      if (!sprintLockedRef.current) {
        im?.setVirtualActionState('sprint', false);
      }
      return;
    }

    const linearMag = (normMag - deadzone) / Math.max(0.01, 1 - deadzone);
    // Smooth analog response curve for fine micro-walk near center and full stride at rim
    const curvedMag = Math.min(1, Math.pow(linearMag, 1.2));
    const dirX = dist > 0.001 ? dx / dist : 0;
    const dirY = dist > 0.001 ? dy / dist : 0;
    const right = dirX * curvedMag;
    const forward = -dirY * curvedMag;
    im?.setVirtualMoveAxes(forward, right);

    // Auto-sprint ONLY when pushing forward beyond threshold inside a forward cone (never sideways/backward)
    const threshold = autoSprintThresholdRef.current;
    const forwardSprintEngaged =
      !inVehicleRef.current &&
      autoSprintRef.current &&
      normMag >= threshold &&
      forward >= threshold * 0.8 &&
      Math.abs(right) <= forward * 0.65;

    setAutoSprintEngaged(forwardSprintEngaged);
    if (forwardSprintEngaged) {
      im?.setVirtualActionState('sprint', true);
    } else if (!sprintLockedRef.current) {
      im?.setVirtualActionState('sprint', false);
    }
  }, []);

  const endStickByPointerId = useCallback((pointerId: number) => {
    if (stickPointerId.current !== pointerId) return;
    stickPointerId.current = null;
    setStickActive(false);
    setFloatingOrigin(null);
    setStickOffset({ x: 0, y: 0 });
    setAutoSprintEngaged(false);
    const im = inputManagerRef.current;
    im?.setVirtualMoveAxes(0, 0);
    if (!sprintLockedRef.current) {
      im?.setVirtualActionState('sprint', false);
    }
  }, []);

  const startLookGesture = useCallback((pointerId: number, clientX: number, clientY: number) => {
    lookPointerId.current = pointerId;
    lookLastPos.current = { x: clientX, y: clientY };
  }, []);

  const moveLookByPointerId = useCallback((pointerId: number, clientX: number, clientY: number) => {
    if (lookPointerId.current !== pointerId) return;
    const dx = clientX - lookLastPos.current.x;
    const dy = clientY - lookLastPos.current.y;
    lookLastPos.current = { x: clientX, y: clientY };
    if (dx !== 0 || dy !== 0) {
      inputManagerRef.current?.addVirtualLookDelta(dx, dy);
    }
  }, []);

  const endLookByPointerId = useCallback((pointerId: number) => {
    if (lookPointerId.current !== pointerId) return;
    lookPointerId.current = null;
  }, []);

  const endHoldByPointerId = useCallback(
    (pointerId: number) => {
      const actions = heldButtonPointers.current.get(pointerId);
      if (!actions) return;
      heldButtonPointers.current.delete(pointerId);
      heldButtonDragPos.current.delete(pointerId);
      const im = inputManagerRef.current;
      for (const a of actions) {
        if (a === 'ads' && adsToggledRef.current) continue;
        const stillHeldByAnotherPointer = Array.from(heldButtonPointers.current.values()).some((arr) =>
          arr.includes(a)
        );
        if (!stillHeldByAnotherPointer) {
          im?.setVirtualActionState(a, false);
        }
      }
      syncUiHeldSet();
    },
    [syncUiHeldSet]
  );

  // Global window pointer tracking so dragging across zone boundaries, buttons, or losing pointer capture never drops movement or 360° camera rotation
  useEffect(() => {
    const onWindowPointerMove = (e: PointerEvent) => {
      if (e.pointerId === stickPointerId.current) {
        applyStickPosition(e.clientX, e.clientY);
      } else if (e.pointerId === lookPointerId.current) {
        moveLookByPointerId(e.pointerId, e.clientX, e.clientY);
      } else if (heldButtonDragPos.current.has(e.pointerId) && lookPointerId.current === null) {
        // PUBG-style right-thumb aim-while-firing when no separate look finger is active
        const last = heldButtonDragPos.current.get(e.pointerId)!;
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        heldButtonDragPos.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (dx !== 0 || dy !== 0) {
          inputManagerRef.current?.addVirtualLookDelta(dx, dy);
        }
      }
    };

    const onWindowPointerEnd = (e: PointerEvent) => {
      if (e.pointerId === stickPointerId.current) {
        endStickByPointerId(e.pointerId);
      }
      if (e.pointerId === lookPointerId.current) {
        endLookByPointerId(e.pointerId);
      }
      if (heldButtonPointers.current.has(e.pointerId)) {
        endHoldByPointerId(e.pointerId);
      }
    };

    const handleVisibilityOrBlur = () => {
      if (document.hidden) {
        releaseAllVirtual();
      }
    };

    window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
    window.addEventListener('pointerup', onWindowPointerEnd, { passive: true });
    window.addEventListener('pointercancel', onWindowPointerEnd, { passive: true });
    window.addEventListener('blur', releaseAllVirtual);
    document.addEventListener('visibilitychange', handleVisibilityOrBlur);

    const rootEl = rootRef.current;
    const preventNativeTouchGesture = (e: TouchEvent) => {
      if (e.cancelable) {
        e.preventDefault();
      }
    };
    rootEl?.addEventListener('touchstart', preventNativeTouchGesture, { passive: false });
    rootEl?.addEventListener('touchmove', preventNativeTouchGesture, { passive: false });

    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      window.removeEventListener('blur', releaseAllVirtual);
      document.removeEventListener('visibilitychange', handleVisibilityOrBlur);
      rootEl?.removeEventListener('touchstart', preventNativeTouchGesture);
      rootEl?.removeEventListener('touchmove', preventNativeTouchGesture);
      releaseAllVirtual();
    };
  }, [
    applyStickPosition,
    endHoldByPointerId,
    endLookByPointerId,
    endStickByPointerId,
    moveLookByPointerId,
    releaseAllVirtual,
  ]);

  // Clear infantry toggles when entering/exiting vehicles so nothing sticks across state switches
  useEffect(() => {
    setAdsToggled(false);
    adsToggledRef.current = false;
    setTacticalOpen(false);
    inputManager?.setVirtualActionState('ads', false);
    inputManager?.setVirtualActionState('crouch', false);
  }, [hud.inVehicle, inputManager]);

  const handleStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.pointerId === lookPointerId.current || heldButtonPointers.current.has(e.pointerId)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events in tests may not support pointer capture
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const radius = Math.max(44, Math.min(rect.width || padSize, rect.height || padSize) * 0.44);
    const cx = rect.width > 0 ? rect.left + rect.width / 2 : e.clientX;
    const cy = rect.height > 0 ? rect.top + rect.height / 2 : e.clientY;
    stickCenterRef.current = { x: cx, y: cy, radius };
    setFloatingOrigin(null);
    stickPointerId.current = e.pointerId;
    setStickActive(true);
    applyStickPosition(e.clientX, e.clientY);
  };

  const handleLeftZonePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (heldButtonPointers.current.has(e.pointerId)) return;

    // If left joystick is already held by another finger, treat a second finger touching near the center as camera look
    if (
      stickPointerId.current !== null &&
      stickPointerId.current !== e.pointerId &&
      lookPointerId.current === null
    ) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      startLookGesture(e.pointerId, e.clientX, e.clientY);
      return;
    }

    if (e.pointerId === lookPointerId.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer capture limitations
    }
    const halfPad = padSize / 2;
    const radius = Math.max(44, padSize * 0.44);

    // Anchor joystick center at the exact touch-down point so Up/Down/Left/Right are 100% symmetric in all 360° directions
    stickCenterRef.current = { x: e.clientX, y: e.clientY, radius };
    setFloatingOrigin({ left: e.clientX - halfPad, top: e.clientY - halfPad });
    stickPointerId.current = e.pointerId;
    setStickActive(true);
    applyStickPosition(e.clientX, e.clientY);
  };

  const handleStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId === stickPointerId.current) {
      e.stopPropagation();
      applyStickPosition(e.clientX, e.clientY);
    } else if (e.pointerId === lookPointerId.current) {
      e.stopPropagation();
      moveLookByPointerId(e.pointerId, e.clientX, e.clientY);
    }
  };

  const handleStickPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId === stickPointerId.current) {
      e.stopPropagation();
      try {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
      endStickByPointerId(e.pointerId);
    } else if (e.pointerId === lookPointerId.current) {
      e.stopPropagation();
      endLookByPointerId(e.pointerId);
    }
  };

  const handleLookPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.pointerId === stickPointerId.current || heldButtonPointers.current.has(e.pointerId)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    startLookGesture(e.pointerId, e.clientX, e.clientY);
  };

  const handleLookPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (lookPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    moveLookByPointerId(e.pointerId, e.clientX, e.clientY);
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
    endLookByPointerId(e.pointerId);
  };

  const startHoldActions = (
    e: React.PointerEvent<HTMLButtonElement>,
    actions: ExtendedInputAction[],
    allowAimDrag = false
  ) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    heldButtonPointers.current.set(e.pointerId, actions);
    if (allowAimDrag) {
      heldButtonDragPos.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    for (const a of actions) {
      inputManager?.setVirtualActionState(a, true);
    }
    syncUiHeldSet();
  };

  const moveHoldActions = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!heldButtonDragPos.current.has(e.pointerId)) return;
    e.stopPropagation();
    if (lookPointerId.current !== null) return;
    const last = heldButtonDragPos.current.get(e.pointerId)!;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    heldButtonDragPos.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dx !== 0 || dy !== 0) {
      inputManager?.addVirtualLookDelta(dx, dy);
    }
  };

  const endHoldActions = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // If lostpointercapture fired without a specific pointerId (e.g. synthetic MouseEvent in unit test), clear all held button pointers
    if (e.type === 'lostpointercapture' && !heldButtonPointers.current.has(e.pointerId)) {
      for (const pid of Array.from(heldButtonPointers.current.keys())) {
        endHoldByPointerId(pid);
      }
      return;
    }
    if (!heldButtonPointers.current.has(e.pointerId)) return;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    endHoldByPointerId(e.pointerId);
  };

  const fireTapAction = (e: React.PointerEvent<HTMLButtonElement>, action: ExtendedInputAction) => {
    e.stopPropagation();
    inputManager?.triggerVirtualActionPress(action);
  };

  const handleAdsPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (touchAdsMode === 'hold') {
      startHoldActions(e, ['ads'], true);
      return;
    }
    const next = !adsToggled;
    setAdsToggled(next);
    adsToggledRef.current = next;
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
      ref={rootRef}
      data-testid="mobile-touch-controls"
      className="fixed inset-0 z-20 pointer-events-none select-none touch-none touch-none-surface"
      style={{
        opacity: Math.max(0.35, Math.min(0.95, touchOpacity)),
        touchAction: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Left Floating Movement Zone (PUBG-style: touch anywhere on left 40% to engage 360° analog stick) */}
      <div
        data-testid="touch-move-zone"
        aria-label="Movement Touch Zone"
        style={{ touchAction: 'none' }}
        className="pointer-events-auto touch-none touch-none-surface fixed left-0 right-[60%] top-0 bottom-0"
        onPointerDown={handleLeftZonePointerDown}
        onPointerMove={handleStickPointerMove}
        onPointerUp={handleStickPointerEnd}
        onPointerCancel={handleStickPointerEnd}
      />

      {/* Right Independent 360-Degree Camera Look Surface (covers entire right 60% of screen; never triggers Fire) */}
      <div
        data-testid="touch-look-zone"
        aria-label="Touch Aim Look Zone"
        style={{ touchAction: 'none' }}
        className="pointer-events-auto touch-none touch-none-surface fixed top-0 bottom-0 right-0 left-[40%]"
        onPointerDown={handleLookPointerDown}
        onPointerMove={handleLookPointerMove}
        onPointerUp={handleLookPointerEnd}
        onPointerCancel={handleLookPointerEnd}
      />

      {/* Left Movement Thumbstick + Subtle Auto-Sprint Indicator / Optional Manual Sprint */}
      <div
        className="pointer-events-none fixed flex flex-col items-center gap-1.5"
        style={
          floatingOrigin
            ? { left: `${floatingOrigin.left}px`, top: `${floatingOrigin.top}px` }
            : {
                left: 'max(36px, calc(env(safe-area-inset-left, 0px) + 24px))',
                bottom: 'max(34px, calc(env(safe-area-inset-bottom, 0px) + 22px))',
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
            style={{ touchAction: 'none' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const next = !sprintLocked;
              setSprintLocked(next);
              sprintLockedRef.current = next;
              inputManager?.setVirtualActionState('sprint', next);
            }}
            className={`pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2.5 rounded-full border font-mono text-[10px] font-bold uppercase flex items-center gap-1 transition-colors ${
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
          style={{ width: `${padSize}px`, height: `${padSize}px`, touchAction: 'none' }}
          className={`pointer-events-auto touch-none touch-none-surface relative rounded-full border flex items-center justify-center transition-colors ${
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
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => fireTapAction(e, 'confirmNuke')}
              className="touch-none touch-none-surface min-w-[44px] min-h-[44px] px-3 bg-red-600 text-white font-mono text-[11px] font-bold uppercase rounded-sm"
            >
              Confirm Strike
            </button>
            <button
              type="button"
              data-testid="touch-btn-cancel-nuke"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => fireTapAction(e, 'cancelNuke')}
              className="touch-none touch-none-surface min-w-[44px] min-h-[44px] px-3 bg-zinc-800 text-zinc-200 font-mono text-[11px] uppercase rounded-sm"
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
            style={{ touchAction: 'none' }}
            onPointerDown={(e) => fireTapAction(e, 'interact')}
            className="pointer-events-auto touch-none touch-none-surface min-w-[48px] min-h-[44px] px-4 bg-[#0B0E11]/90 border-2 border-amber-400 text-amber-300 font-mono text-xs font-bold uppercase rounded-full flex items-center gap-1.5 shadow-lg"
          >
            <Hand className="w-4 h-4 shrink-0" />
            <span>{hud.interactPrompt.replace('[E] ', '')}</span>
          </button>
        )}
      </div>

      {/* Right PUBG-Style Ergonomic Combat HUD (wrappers are pointer-events-none so empty gaps drag camera!) */}
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
            <div className="pointer-events-none flex items-center gap-2">
              <button
                type="button"
                data-testid="touch-btn-veh-cam"
                aria-label="Switch Vehicle Camera"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => fireTapAction(e, 'vehicleCamera')}
                className="pointer-events-auto touch-none touch-none-surface min-w-[48px] min-h-[44px] px-3 bg-[#0B0E11]/80 border border-white/20 rounded-full font-mono text-[10px] font-bold text-emerald-300 flex items-center gap-1"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>CAM</span>
              </button>
              <button
                type="button"
                data-testid="touch-btn-veh-exit"
                aria-label="Exit Vehicle"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => fireTapAction(e, 'interact')}
                className="pointer-events-auto touch-none touch-none-surface min-w-[48px] min-h-[44px] px-3 bg-[#0B0E11]/85 border border-amber-400/80 rounded-full font-mono text-[10px] text-amber-300 font-bold"
              >
                EXIT
              </button>
            </div>

            <button
              type="button"
              data-testid="touch-btn-fire"
              aria-label="Fire Vehicle Turret"
              onPointerDown={(e) => startHoldActions(e, ['fire'], true)}
              onPointerMove={moveHoldActions}
              onPointerUp={endHoldActions}
              onPointerCancel={endHoldActions}
              onLostPointerCapture={endHoldActions}
              style={{
                width: `${Math.max(60, fireSize)}px`,
                height: `${Math.max(60, fireSize)}px`,
                transform: `translate3d(${touchFireOffsetX}px, ${touchFireOffsetY}px, 0)`,
                touchAction: 'none',
              }}
              className={`pointer-events-auto touch-none touch-none-surface min-w-[60px] min-h-[60px] rounded-full border-2 font-mono text-[11px] font-bold uppercase flex flex-col items-center justify-center shadow-xl ${
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
                style={{ touchAction: 'none' }}
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
                    className="touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#141920] border border-zinc-700 rounded-sm font-mono text-[10px] font-bold uppercase text-zinc-200"
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
                        className="touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#141920] border border-amber-500/50 rounded-sm font-mono text-[10px] font-bold text-amber-300"
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
                        className="touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#141920] border border-cyan-500/50 rounded-sm font-mono text-[10px] font-bold text-cyan-300 flex items-center gap-1"
                      >
                        <Bomb className="w-3.5 h-3.5" />
                        <span>{hud.ordnance.selectedBombShort}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="touch-btn-cycle-bomb"
                        aria-label="Cycle Bomb Type"
                        onPointerDown={(e) => fireTapAction(e, 'cycleBomb')}
                        className="touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2 bg-[#141920] border border-zinc-700 rounded-sm font-mono text-[10px] text-zinc-300"
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
                            className="touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-red-950/90 border border-red-500 rounded-sm font-mono text-[10px] font-bold text-red-200"
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
                        className={`touch-none touch-none-surface min-h-[38px] px-1.5 rounded-sm border font-mono text-[9px] font-bold uppercase truncate ${
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
            <div className="pointer-events-none flex items-center gap-1.5">
              {hud.ordnance && hud.ordnance.c4Deployed > 0 && (
                <button
                  type="button"
                  data-testid="touch-btn-c4-detonate"
                  aria-label="Detonate Planted C4"
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => fireTapAction(e, 'c4Detonate')}
                  className="pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-red-950/85 border border-red-400 rounded-full font-mono text-[10px] font-bold text-red-200 flex items-center justify-center"
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
                  style={{ height: `${compactBtnSize}px`, minWidth: `${compactBtnSize}px`, touchAction: 'none' }}
                  className="pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#0B0E11]/75 border border-amber-400/50 rounded-full font-mono text-[10px] font-bold text-amber-300 flex items-center justify-center gap-1"
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
                style={{ height: `${compactBtnSize}px`, touchAction: 'none' }}
                className="pointer-events-auto touch-none touch-none-surface min-w-[68px] min-h-[44px] px-2.5 bg-[#0B0E11]/75 border border-white/20 rounded-full font-mono text-[10px] font-bold uppercase text-zinc-100 flex items-center justify-center gap-1.5"
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
                style={{ width: `${compactBtnSize}px`, height: `${compactBtnSize}px`, touchAction: 'none' }}
                className={`pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center ${
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
              <div className="pointer-events-none flex flex-col items-end gap-1.5">
                <div className="pointer-events-none flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="touch-btn-reload"
                    aria-label="Reload Weapon"
                    onPointerDown={(e) => fireTapAction(e, 'reload')}
                    style={{ width: `${compactBtnSize}px`, height: `${compactBtnSize}px`, touchAction: 'none' }}
                    className="pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] bg-[#0B0E11]/75 border border-white/20 rounded-full text-zinc-100 flex items-center justify-center"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    data-testid="touch-btn-ads"
                    aria-label="Aim Down Sights"
                    aria-pressed={showAdsActive}
                    onPointerDown={handleAdsPointerDown}
                    onPointerMove={moveHoldActions}
                    onPointerUp={handleAdsPointerEnd}
                    onPointerCancel={handleAdsPointerEnd}
                    onLostPointerCapture={handleAdsPointerEnd}
                    style={{
                      width: `${primaryBtnSize}px`,
                      height: `${primaryBtnSize}px`,
                      transform: `translate3d(${touchAdsOffsetX}px, ${touchAdsOffsetY}px, 0)`,
                      touchAction: 'none',
                    }}
                    className={`pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] rounded-full border font-mono text-[10px] font-bold flex flex-col items-center justify-center ${
                      showAdsActive
                        ? 'bg-cyan-500/45 border-cyan-300 text-white'
                        : 'bg-[#0B0E11]/75 border-white/25 text-cyan-200'
                    }`}
                  >
                    <Target className="w-4 h-4" />
                    <span className="leading-none mt-0.5 text-[9px]">ADS</span>
                  </button>
                </div>

                <div className="pointer-events-none flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="touch-btn-crouch"
                    aria-label="Crouch or Slide"
                    onPointerDown={(e) => startHoldActions(e, ['crouch'])}
                    onPointerUp={endHoldActions}
                    onPointerCancel={endHoldActions}
                    onLostPointerCapture={endHoldActions}
                    style={{ width: `${compactBtnSize}px`, height: `${compactBtnSize}px`, touchAction: 'none' }}
                    className={`pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center ${
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
                    style={{ width: `${compactBtnSize}px`, height: `${compactBtnSize}px`, touchAction: 'none' }}
                    className={`pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center ${
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
                onPointerDown={(e) => startHoldActions(e, fireActions, true)}
                onPointerMove={moveHoldActions}
                onPointerUp={endHoldActions}
                onPointerCancel={endHoldActions}
                onLostPointerCapture={endHoldActions}
                style={{
                  width: `${Math.max(60, fireSize)}px`,
                  height: `${Math.max(60, fireSize)}px`,
                  transform: `translate3d(${touchFireOffsetX}px, ${touchFireOffsetY}px, 0)`,
                  touchAction: 'none',
                }}
                className={`pointer-events-auto touch-none touch-none-surface min-w-[60px] min-h-[60px] rounded-full border-2 font-mono text-[11px] font-bold uppercase flex flex-col items-center justify-center shadow-xl ${
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
