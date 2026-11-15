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
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { computeMobileHudLayout } from './mobileHudLayoutEngine';

interface MobileTouchControlsProps {
  inputManager: InputManager | null;
  hud: HudSnapshot;
}

export function MobileTouchControls({ inputManager, hud }: MobileTouchControlsProps) {
  const inputSettings = useSettingsStore((s) => s.input);
  const {
    touchControlProfile,
    touchDeadzone,
    touchButtonOpacity: touchOpacity,
    autoSprint,
    touchAutoSprintThreshold: autoSprintThreshold,
    touchManualSprintButton,
    touchAdsMode,
    touchFireBehavior,
  } = inputSettings;

  const viewport = useViewportMode();
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
  const heldFireSides = useRef<Map<number, 'left' | 'right'>>(new Map());
  const [heldActionsUi, setHeldActionsUi] = useState<Set<ExtendedInputAction>>(new Set());
  const [firingSidesUi, setFiringSidesUi] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  // Compute unified collision-free layout for the active viewport and HUD state
  const layout = computeMobileHudLayout(
    inputSettings,
    { width: viewport.width, height: viewport.height },
    {
      inVehicle: hud.inVehicle,
      grenadeCount: hud.grenades,
      c4DeployedCount: hud.ordnance?.c4Deployed ?? 0,
    }
  );

  const stickRect = layout.controls.move_joystick;
  const fireLeftRect = layout.controls.fire_left;
  const fireRightRect = layout.controls.fire_right;
  const adsRect = layout.controls.ads;
  const reloadRect = layout.controls.reload;
  const crouchRect = layout.controls.crouch;
  const jumpRect = layout.controls.jump;
  const weaponBarRect = layout.controls.weapon_bar;

  const padSize = stickRect.width;
  const knobSize = Math.round(padSize * 0.4);

  const syncUiHeldSet = useCallback(() => {
    const next = new Set<ExtendedInputAction>();
    for (const actions of heldButtonPointers.current.values()) {
      for (const a of actions) next.add(a);
    }
    setHeldActionsUi(next);

    let left = false;
    let right = false;
    for (const side of heldFireSides.current.values()) {
      if (side === 'left') left = true;
      if (side === 'right') right = true;
    }
    setFiringSidesUi({ left, right });
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
    heldFireSides.current.clear();
    setHeldActionsUi(new Set());
    setFiringSidesUi({ left: false, right: false });
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
    const curvedMag = Math.min(1, Math.pow(linearMag, 1.2));
    const dirX = dist > 0.001 ? dx / dist : 0;
    const dirY = dist > 0.001 ? dy / dist : 0;
    const right = dirX * curvedMag;
    const forward = -dirY * curvedMag;
    im?.setVirtualMoveAxes(forward, right);

    // Auto-sprint ONLY when pushing forward beyond threshold inside a forward cone
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
      heldFireSides.current.delete(pointerId);
      if (!actions) {
        syncUiHeldSet();
        return;
      }
      heldButtonPointers.current.delete(pointerId);
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

  // Global window pointer tracking so dragging across zone boundaries or multi-finger touch-downs never drops movement, camera look, or held Fire
  useEffect(() => {
    const onWindowPointerMove = (e: PointerEvent) => {
      if (e.pointerId === stickPointerId.current) {
        applyStickPosition(e.clientX, e.clientY);
      } else if (e.pointerId === lookPointerId.current) {
        moveLookByPointerId(e.pointerId, e.clientX, e.clientY);
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

  // Clear all active inputs if player dies or switches vehicle state
  useEffect(() => {
    if (hud.health <= 0) {
      releaseAllVirtual();
    }
  }, [hud.health, releaseAllVirtual]);

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

    // If left joystick is already held by another finger, route a second finger to camera look
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

    // Anchor joystick center at exact touch-down coordinate so all 360° directions are 100% symmetric
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
    fireSide?: 'left' | 'right'
  ) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    heldButtonPointers.current.set(e.pointerId, actions);
    if (fireSide) {
      heldFireSides.current.set(e.pointerId, fireSide);
    }
    for (const a of actions) {
      inputManager?.setVirtualActionState(a, true);
    }
    syncUiHeldSet();
  };

  const endHoldActions = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
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
      startHoldActions(e, ['ads']);
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

  const isFiring = heldActionsUi.has('fire');
  const isLeftFiring = firingSidesUi.left || (isFiring && !fireRightRect.visible);
  const isRightFiring = firingSidesUi.right || (isFiring && !fireLeftRect.visible);
  const showAdsActive = adsToggled || heldActionsUi.has('ads') || hud.isAds;

  // Assign primary `touch-btn-fire` testid to the active Fire button, and `touch-btn-fire-left` when both are visible
  const leftFireTestId = fireRightRect.visible ? 'touch-btn-fire-left' : 'touch-btn-fire';
  const rightFireTestId = 'touch-btn-fire';

  return (
    <div
      ref={rootRef}
      data-testid="mobile-touch-controls"
      data-viewport={`${layout.viewportWidth}x${layout.viewportHeight}`}
      data-control-profile={touchControlProfile}
      data-left-fire-enabled={fireLeftRect.visible ? 'true' : 'false'}
      data-right-fire-enabled={fireRightRect.visible ? 'true' : 'false'}
      className="fixed inset-0 z-20 pointer-events-none select-none touch-none touch-none-surface"
      style={{
        opacity: Math.max(0.35, Math.min(0.95, touchOpacity)),
        touchAction: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Left Floating Movement Zone:
          Top boundary automatically shifts below the Left-Index Claw Fire button when active */}
      <div
        data-testid="touch-move-zone"
        aria-label="Movement Touch Zone"
        style={{
          top: `${layout.leftMoveZoneTopPx}px`,
          touchAction: 'none',
        }}
        className="pointer-events-auto touch-none touch-none-surface fixed left-0 right-[60%] bottom-0"
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
            ? {
                left: `${floatingOrigin.left}px`,
                top: `${floatingOrigin.top}px`,
                zIndex: stickRect.zIndex,
              }
            : {
                left: `${stickRect.left}px`,
                top: `${stickRect.top}px`,
                zIndex: stickRect.zIndex,
              }
        }
      >
        {!hud.inVehicle && autoSprintEngaged && !touchManualSprintButton && (
          <div className="pointer-events-none flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/25 border border-amber-400/70 font-mono text-[9px] font-bold uppercase text-amber-200">
            <ChevronUp className="w-3 h-3" />
            <span>SPRINT</span>
          </div>
        )}

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
          data-control-id="move_joystick"
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

      {/* CenterContextual Prompts (Interact / Nuke Auth — appear ONLY when relevant above bottom-center weapon bar) */}
      <div
        className="pointer-events-none fixed left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-30"
        style={{ bottom: `${Math.max(66, layout.viewportHeight - weaponBarRect.top + 8)}px` }}
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

      {/* Dedicated Left-Side Claw FIRE Button (when leftFireEnabled is true) */}
      {fireLeftRect.visible && (
        <button
          type="button"
          data-testid={leftFireTestId}
          data-control-id="fire_left"
          data-fire-side="left"
          data-profile={touchControlProfile}
          data-pressed={isLeftFiring ? 'true' : 'false'}
          aria-label={hud.inVehicle ? 'Left Fire Vehicle Turret' : 'Left Fire Weapon'}
          aria-pressed={isLeftFiring}
          onPointerDown={(e) => startHoldActions(e, hud.inVehicle ? ['fire'] : fireActions, 'left')}
          onPointerUp={endHoldActions}
          onPointerCancel={endHoldActions}
          style={{
            left: `${fireLeftRect.left}px`,
            top: `${fireLeftRect.top}px`,
            width: `${fireLeftRect.width}px`,
            height: `${fireLeftRect.height}px`,
            zIndex: fireLeftRect.zIndex,
            touchAction: 'none',
          }}
          className={`pointer-events-auto touch-none touch-none-surface fixed rounded-full border-2 font-mono text-[10px] font-bold uppercase flex flex-col items-center justify-center transition-transform duration-75 ${
            isLeftFiring
              ? 'bg-red-600/90 border-amber-200 text-white scale-94 ring-4 ring-amber-400/35 shadow-[0_0_22px_rgba(239,68,68,0.65)]'
              : hud.ammoInMag === 0 && !hud.inVehicle
                ? 'bg-red-950/75 border-red-400/85 text-red-100 shadow-lg'
                : 'bg-amber-500/42 border-amber-300 text-amber-50 shadow-xl'
          }`}
        >
          <div
            className={`pointer-events-none absolute inset-1.5 rounded-full border ${
              isLeftFiring ? 'border-white/50' : 'border-amber-200/25'
            }`}
          />
          <Crosshair className={`w-5 h-5 ${isLeftFiring ? 'scale-110' : ''} transition-transform`} />
          <span className="mt-0.5 leading-none">{hud.inVehicle ? 'GUN' : 'FIRE'}</span>
        </button>
      )}

      {/* Dedicated Right-Side Thumb FIRE Button (when rightFireEnabled is true) */}
      {fireRightRect.visible && (
        <button
          type="button"
          data-testid={rightFireTestId}
          data-control-id="fire_right"
          data-fire-side="right"
          data-profile={touchControlProfile}
          data-pressed={isRightFiring ? 'true' : 'false'}
          aria-label={hud.inVehicle ? 'Fire Vehicle Turret' : 'Fire Weapon'}
          aria-pressed={isRightFiring}
          onPointerDown={(e) => startHoldActions(e, hud.inVehicle ? ['fire'] : fireActions, 'right')}
          onPointerUp={endHoldActions}
          onPointerCancel={endHoldActions}
          style={{
            left: `${fireRightRect.left}px`,
            top: `${fireRightRect.top}px`,
            width: `${fireRightRect.width}px`,
            height: `${fireRightRect.height}px`,
            zIndex: fireRightRect.zIndex,
            touchAction: 'none',
          }}
          className={`pointer-events-auto touch-none touch-none-surface fixed rounded-full border-2 font-mono text-[11px] font-bold uppercase flex flex-col items-center justify-center transition-transform duration-75 ${
            isRightFiring
              ? 'bg-red-600/90 border-amber-200 text-white scale-94 ring-4 ring-amber-400/35 shadow-[0_0_22px_rgba(239,68,68,0.65)]'
              : hud.ammoInMag === 0 && !hud.inVehicle
                ? 'bg-red-950/75 border-red-400/85 text-red-100 shadow-lg'
                : 'bg-amber-500/38 border-amber-400 text-amber-50 shadow-xl'
          }`}
        >
          <div
            className={`pointer-events-none absolute inset-1.5 rounded-full border ${
              isRightFiring ? 'border-white/50' : 'border-amber-200/25'
            }`}
          />
          <Crosshair className={`w-5 h-5 ${isRightFiring ? 'scale-110' : ''} transition-transform`} />
          <span className="mt-0.5 leading-none">{hud.inVehicle ? 'GUN' : 'FIRE'}</span>
        </button>
      )}

      {/* Primary ADS Button (when on foot) */}
      {adsRect.visible && (
        <button
          type="button"
          data-testid="touch-btn-ads"
          data-control-id="ads"
          aria-label="Aim Down Sights"
          aria-pressed={showAdsActive}
          onPointerDown={handleAdsPointerDown}
          onPointerUp={handleAdsPointerEnd}
          onPointerCancel={handleAdsPointerEnd}
          style={{
            left: `${adsRect.left}px`,
            top: `${adsRect.top}px`,
            width: `${adsRect.width}px`,
            height: `${adsRect.height}px`,
            zIndex: adsRect.zIndex,
            touchAction: 'none',
          }}
          className={`pointer-events-auto touch-none touch-none-surface fixed rounded-full border font-mono text-[10px] font-bold flex flex-col items-center justify-center transition-transform duration-75 ${
            showAdsActive
              ? 'bg-cyan-500/55 border-cyan-200 text-white scale-95 ring-2 ring-cyan-300/40 shadow-lg'
              : 'bg-[#0B0E11]/78 border-white/25 text-cyan-200 shadow-md'
          }`}
        >
          <Target className="w-4 h-4" />
          <span className="leading-none mt-0.5 text-[9px]">ADS</span>
        </button>
      )}

      {/* Secondary Right-Thumb Ergonomic Arc Controls: Reload, Crouch/Slide, Jump (each individually positioned & collision-checked) */}
      {reloadRect.visible && (
        <button
          type="button"
          data-testid="touch-btn-reload"
          data-control-id="reload"
          aria-label="Reload Weapon"
          onPointerDown={(e) => fireTapAction(e, 'reload')}
          style={{
            left: `${reloadRect.left}px`,
            top: `${reloadRect.top}px`,
            width: `${reloadRect.width}px`,
            height: `${reloadRect.height}px`,
            zIndex: reloadRect.zIndex,
            touchAction: 'none',
          }}
          className={`pointer-events-auto touch-none touch-none-surface fixed rounded-full border flex flex-col items-center justify-center ${
            hud.isReloading
              ? 'bg-amber-500/35 border-amber-400 text-amber-200'
              : 'bg-[#0B0E11]/78 border-white/20 text-zinc-100'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${hud.isReloading ? 'animate-spin' : ''}`} />
        </button>
      )}

      {crouchRect.visible && (
        <button
          type="button"
          data-testid="touch-btn-crouch"
          data-control-id="crouch"
          aria-label="Crouch or Slide"
          onPointerDown={(e) => startHoldActions(e, ['crouch'])}
          onPointerUp={endHoldActions}
          onPointerCancel={endHoldActions}
          style={{
            left: `${crouchRect.left}px`,
            top: `${crouchRect.top}px`,
            width: `${crouchRect.width}px`,
            height: `${crouchRect.height}px`,
            zIndex: crouchRect.zIndex,
            touchAction: 'none',
          }}
          className={`pointer-events-auto touch-none touch-none-surface fixed rounded-full border flex flex-col items-center justify-center ${
            heldActionsUi.has('crouch') || hud.isCrouching
              ? 'bg-cyan-500/35 border-cyan-400 text-cyan-200'
              : 'bg-[#0B0E11]/78 border-white/20 text-zinc-200'
          }`}
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {jumpRect.visible && (
        <button
          type="button"
          data-testid="touch-btn-jump"
          data-control-id="jump"
          aria-label="Jump"
          onPointerDown={(e) => startHoldActions(e, ['jump'])}
          onPointerUp={endHoldActions}
          onPointerCancel={endHoldActions}
          style={{
            left: `${jumpRect.left}px`,
            top: `${jumpRect.top}px`,
            width: `${jumpRect.width}px`,
            height: `${jumpRect.height}px`,
            zIndex: jumpRect.zIndex,
            touchAction: 'none',
          }}
          className={`pointer-events-auto touch-none touch-none-surface fixed rounded-full border flex flex-col items-center justify-center ${
            heldActionsUi.has('jump')
              ? 'bg-amber-500/35 border-amber-400 text-amber-200'
              : 'bg-[#0B0E11]/78 border-white/20 text-zinc-200'
          }`}
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}

      {/* Bottom-Center Tactical Weapon & Ordnance Bar (keeps Weapon Switch, Grenade, and Kit completely clear of Right Fire & ADS) */}
      <div
        data-testid="touch-weapon-bar"
        data-control-id="weapon_bar"
        className="pointer-events-none fixed flex flex-col items-center"
        style={{
          left: `${weaponBarRect.left}px`,
          top: `${weaponBarRect.top}px`,
          width: `${weaponBarRect.width}px`,
          height: `${weaponBarRect.height}px`,
          zIndex: weaponBarRect.zIndex,
        }}
      >
        {/* Expandable Secondary Equipment / Ordnance Drawer (opens upward above the bottom-center bar) */}
        {!hud.inVehicle && tacticalOpen && (
          <div
            data-testid="touch-tactical-drawer"
            style={{
              bottom: `${weaponBarRect.height + 8}px`,
              touchAction: 'none',
            }}
            className="pointer-events-auto absolute left-1/2 -translate-x-1/2 bg-[#0B0E11]/95 border border-white/15 rounded-md p-2 flex flex-col gap-2 shadow-2xl w-[256px]"
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

        {hud.inVehicle ? (
          <div className="pointer-events-none flex items-center justify-center gap-2 w-full h-full">
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
        ) : (
          <div className="pointer-events-none flex items-center justify-center gap-1.5 w-full h-full">
            {hud.ordnance && hud.ordnance.c4Deployed > 0 && (
              <button
                type="button"
                data-testid="touch-btn-c4-detonate"
                aria-label="Detonate Planted C4"
                style={{ height: `${weaponBarRect.height}px`, touchAction: 'none' }}
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
                style={{
                  height: `${weaponBarRect.height}px`,
                  minWidth: `${weaponBarRect.height}px`,
                  touchAction: 'none',
                }}
                className="pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2.5 bg-[#0B0E11]/80 border border-amber-400/50 rounded-full font-mono text-[10px] font-bold text-amber-300 flex items-center justify-center gap-1"
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
              style={{ height: `${weaponBarRect.height}px`, touchAction: 'none' }}
              className="pointer-events-auto touch-none touch-none-surface min-w-[74px] min-h-[44px] px-3 bg-[#0B0E11]/80 border border-white/20 rounded-full font-mono text-[10px] font-bold uppercase text-zinc-100 flex items-center justify-center gap-1.5"
            >
              <Repeat className="w-3 h-3 text-amber-400 shrink-0" />
              <span className="truncate max-w-[68px]">{hud.weaponName}</span>
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
              style={{
                width: `${weaponBarRect.height}px`,
                height: `${weaponBarRect.height}px`,
                touchAction: 'none',
              }}
              className={`pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center ${
                tacticalOpen
                  ? 'bg-amber-500/30 border-amber-400 text-amber-200'
                  : 'bg-[#0B0E11]/80 border-white/20 text-zinc-300'
              }`}
            >
              <Layers className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
