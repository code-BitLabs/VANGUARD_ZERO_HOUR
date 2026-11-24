import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bomb,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Disc,
  Flame,
  Hand,
  Layers,
  RefreshCw,
  Repeat,
  Rocket,
  Target,
  X,
  Zap,
} from 'lucide-react';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { ExtendedInputAction, InputManager } from '@/src/engine/InputManager';
import { HudSnapshot } from '@/src/schemas/events.schema';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { uiStore, useUIStore } from '@/src/stores/uiStore';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { SquadCommandSource, SquadOrderType } from '@/src/gameplay/squad/SquadIntentRouter';
import {
  computeMobileHudLayout,
  computeMobileSquadStripRect,
  computeMobileVehicleHudLayout,
} from './mobileHudLayoutEngine';
import { MobileSquadCommandStrip } from './MobileSquadCommandStrip';

interface MobileTouchControlsProps {
  inputManager: InputManager | null;
  hud: HudSnapshot;
  onIssueSquadCommand?: (
    order: SquadOrderType,
    source: SquadCommandSource,
    operatorId?: string
  ) => void;
}

export const MobileTouchControls = React.memo(function MobileTouchControls({
  inputManager,
  hud,
  onIssueSquadCommand,
}: MobileTouchControlsProps) {
  const inputSettings = useSettingsStore((s) => s.input);
  const {
    touchControlProfile,
    touchDeadzone,
    touchButtonOpacity: touchOpacity,
    touchVehicleButtonOpacity: vehicleOpacity,
    autoSprint,
    touchAutoSprintThreshold: autoSprintThreshold,
    touchManualSprintButton,
    touchAdsMode,
    touchFireBehavior,
  } = inputSettings;

  const hasSeenVehicleHint = useMissionSelectionStore((s) => s.hasSeenVehicleControlHint);
  const markVehicleHintSeen = useMissionSelectionStore((s) => s.markVehicleControlHintSeen);

  const viewport = useViewportMode();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stickBaseRef = useRef<HTMLDivElement | null>(null);

  // Refs for latest reactive values so window-level multi-touch listeners never go stale or detach mid-gesture
  const inputManagerRef = useRef<InputManager | null>(inputManager);
  const inVehicleRef = useRef<boolean>(hud.inVehicle);
  const touchDeadzoneRef = useRef<number>(touchDeadzone);
  const autoSprintRef = useRef<boolean>(autoSprint);
  const autoSprintThresholdRef = useRef<number>(autoSprintThreshold);

  const stickPointerId = useRef<number | null>(null);
  const stickTouchFallbackId = useRef<number | null>(null);
  const stickCenterRef = useRef<{ x: number; y: number; radius: number }>({ x: 0, y: 0, radius: 52 });
  const [stickActive, setStickActive] = useState(false);
  const [floatingOrigin, setFloatingOrigin] = useState<{ left: number; top: number } | null>(null);
  const [stickOffset, setStickOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [sprintLocked, setSprintLocked] = useState(false);
  const sprintLockedRef = useRef(false);
  const [autoSprintEngaged, setAutoSprintEngaged] = useState(false);
  const [adsToggled, setAdsToggled] = useState(false);
  const adsToggledRef = useRef(false);
  const [tacticalOpen, setTacticalOpenState] = useState(false);
  const tacticalOverviewOpen = useUIStore((s) => s.tacticalOverviewOpen);

  const setTacticalOpen = useCallback((nextOrUpdater: boolean | ((prev: boolean) => boolean)) => {
    setTacticalOpenState((prev) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
      uiStore.getState().setTacticalKitOpen(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (tacticalOverviewOpen) {
      setTacticalOpenState(false);
    }
  }, [tacticalOverviewOpen]);

  useEffect(() => {
    return () => {
      uiStore.getState().setTacticalKitOpen(false);
    };
  }, []);

  useEffect(() => {
    inputManagerRef.current = inputManager;
    inVehicleRef.current = hud.inVehicle;
    touchDeadzoneRef.current = touchDeadzone;
    autoSprintRef.current = autoSprint;
    autoSprintThresholdRef.current = autoSprintThreshold;
  }, [inputManager, hud.inVehicle, touchDeadzone, autoSprint, autoSprintThreshold]);

  useEffect(() => {
    sprintLockedRef.current = sprintLocked;
  }, [sprintLocked]);

  useEffect(() => {
    adsToggledRef.current = adsToggled;
  }, [adsToggled]);

  const lookPointerId = useRef<number | null>(null);
  const lookLastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const fireLookPointerId = useRef<number | null>(null);
  const fireLookStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const fireLookLastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const fireLookDragEngaged = useRef<boolean>(false);

  const heldButtonPointers = useRef<Map<number, ExtendedInputAction[]>>(new Map());
  const heldFireSides = useRef<Map<number, 'left' | 'right'>>(new Map());
  const [heldActionsUi, setHeldActionsUi] = useState<Set<ExtendedInputAction>>(new Set());
  const [firingSidesUi, setFiringSidesUi] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  // Vehicle multi-touch pointer ownership maps (independent of lookPointerId)
  const vehSteerPointers = useRef<Map<number, 'left' | 'right'>>(new Map());
  const vehPedalPointers = useRef<Map<number, 'gas' | 'brakeReverse' | 'handbrake'>>(new Map());
  const wheelPointerId = useRef<number | null>(null);
  const wheelCenterRef = useRef<{ x: number; y: number; radius: number }>({ x: 0, y: 0, radius: 56 });
  const [wheelSteerNorm, setWheelSteerNorm] = useState(0);
  const [vehUiState, setVehUiState] = useState<{
    steerLeft: boolean;
    steerRight: boolean;
    gas: boolean;
    brakeReverse: boolean;
    handbrake: boolean;
  }>({
    steerLeft: false,
    steerRight: false,
    gas: false,
    brakeReverse: false,
    handbrake: false,
  });

  const c4DeployedCount = hud.ordnance?.c4Deployed ?? 0;

  // Compute unified collision-free layout only when viewport, touch settings, or HUD slots actually change
  const layout = useMemo(
    () =>
      computeMobileHudLayout(
        inputSettings,
        { width: viewport.width, height: viewport.height },
        {
          inVehicle: hud.inVehicle,
          grenadeCount: hud.grenades,
          c4DeployedCount,
        }
      ),
    [inputSettings, viewport.width, viewport.height, hud.inVehicle, hud.grenades, c4DeployedCount]
  );

  const vehicleLayout = useMemo(
    () =>
      computeMobileVehicleHudLayout(inputSettings, {
        width: viewport.width,
        height: viewport.height,
      }),
    [inputSettings, viewport.width, viewport.height]
  );

  const squadStripRect = useMemo(() => computeMobileSquadStripRect(layout), [layout]);

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

  const syncVehicleControlsToEngine = useCallback(() => {
    const im = inputManagerRef.current;
    let steerLeft = false;
    let steerRight = false;
    for (const dir of vehSteerPointers.current.values()) {
      if (dir === 'left') steerLeft = true;
      if (dir === 'right') steerRight = true;
    }
    let gas = false;
    let brakeReverse = false;
    let handbrake = false;
    for (const pedal of vehPedalPointers.current.values()) {
      if (pedal === 'gas') gas = true;
      if (pedal === 'brakeReverse') brakeReverse = true;
      if (pedal === 'handbrake') handbrake = true;
    }
    if (im) {
      im.setVirtualVehicleSteerButton('left', steerLeft);
      im.setVirtualVehicleSteerButton('right', steerRight);
      im.setVirtualVehiclePedal('gas', gas ? 1 : 0);
      im.setVirtualVehiclePedal('brakeReverse', brakeReverse ? 1 : 0);
      im.setVirtualVehicleHandbrake(handbrake);
    }
    setVehUiState({ steerLeft, steerRight, gas, brakeReverse, handbrake });
  }, []);

  const releaseAllVirtual = useCallback(() => {
    stickPointerId.current = null;
    stickTouchFallbackId.current = null;
    lookPointerId.current = null;
    fireLookPointerId.current = null;
    fireLookDragEngaged.current = false;
    wheelPointerId.current = null;
    vehSteerPointers.current.clear();
    vehPedalPointers.current.clear();
    setWheelSteerNorm(0);
    setVehUiState({
      steerLeft: false,
      steerRight: false,
      gas: false,
      brakeReverse: false,
      handbrake: false,
    });
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
      im.clearVirtualVehicleInputs();
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
    const curvedMag = Math.min(1, Math.pow(linearMag, 1.15));
    const dirX = dist > 0.001 ? dx / dist : 0;
    const dirY = dist > 0.001 ? dy / dist : 0;
    const right = dirX * curvedMag;
    const forward = -dirY * curvedMag;
    im?.setVirtualMoveAxes(forward, right);

    // Auto-sprint when pushing into the forward/diagonal-forward sector beyond threshold
    const threshold = autoSprintThresholdRef.current;
    const forwardSprintEngaged =
      !inVehicleRef.current &&
      autoSprintRef.current &&
      normMag >= threshold &&
      forward >= threshold * 0.72 &&
      Math.abs(right) <= forward * 0.95;

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

  const applyWheelPosition = useCallback((clientX: number) => {
    const { x: cx, radius } = wheelCenterRef.current;
    const dx = clientX - cx;
    const norm = Math.max(-1, Math.min(1, dx / Math.max(24, radius * 0.82)));
    const deadzone = 0.06;
    const effective =
      Math.abs(norm) < deadzone
        ? 0
        : ((Math.abs(norm) - deadzone) / (1 - deadzone)) * Math.sign(norm);
    setWheelSteerNorm(effective);
    inputManagerRef.current?.setVirtualVehicleSteerAxis(effective);
  }, []);

  const endWheelByPointerId = useCallback((pointerId: number) => {
    if (wheelPointerId.current !== pointerId) return;
    wheelPointerId.current = null;
    setWheelSteerNorm(0);
    inputManagerRef.current?.setVirtualVehicleSteerAxis(0);
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

  const moveFireLookByPointerId = useCallback((pointerId: number, clientX: number, clientY: number) => {
    if (fireLookPointerId.current !== pointerId) return;
    const dx = clientX - fireLookLastPos.current.x;
    const dy = clientY - fireLookLastPos.current.y;
    fireLookLastPos.current = { x: clientX, y: clientY };
    if (lookPointerId.current !== null) return;
    if (!fireLookDragEngaged.current) {
      const dist = Math.hypot(
        clientX - fireLookStartPos.current.x,
        clientY - fireLookStartPos.current.y
      );
      if (dist <= 4) return;
      fireLookDragEngaged.current = true;
    }
    if (dx !== 0 || dy !== 0) {
      inputManagerRef.current?.addVirtualLookDelta(dx, dy);
    }
  }, []);

  const endHoldByPointerId = useCallback(
    (pointerId: number) => {
      if (fireLookPointerId.current === pointerId) {
        fireLookPointerId.current = null;
        fireLookDragEngaged.current = false;
      }
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

  const endVehiclePointerId = useCallback(
    (pointerId: number) => {
      let changed = false;
      if (vehSteerPointers.current.delete(pointerId)) changed = true;
      if (vehPedalPointers.current.delete(pointerId)) changed = true;
      if (changed) {
        syncVehicleControlsToEngine();
      }
      if (wheelPointerId.current === pointerId) {
        endWheelByPointerId(pointerId);
      }
    },
    [endWheelByPointerId, syncVehicleControlsToEngine]
  );

  // Subscribe to InputManager virtual input resets (pause, death, restart, blur)
  useEffect(() => {
    if (!inputManager) return;
    return inputManager.onVirtualInputsCleared(() => {
      stickPointerId.current = null;
      stickTouchFallbackId.current = null;
      lookPointerId.current = null;
      fireLookPointerId.current = null;
      fireLookDragEngaged.current = false;
      wheelPointerId.current = null;
      vehSteerPointers.current.clear();
      vehPedalPointers.current.clear();
      heldButtonPointers.current.clear();
      heldFireSides.current.clear();
      setWheelSteerNorm(0);
      setVehUiState({
        steerLeft: false,
        steerRight: false,
        gas: false,
        brakeReverse: false,
        handbrake: false,
      });
      setStickActive(false);
      setFloatingOrigin(null);
      setStickOffset({ x: 0, y: 0 });
      setSprintLocked(false);
      sprintLockedRef.current = false;
      setAutoSprintEngaged(false);
      setAdsToggled(false);
      adsToggledRef.current = false;
      setHeldActionsUi(new Set());
      setFiringSidesUi({ left: false, right: false });
    });
  }, [inputManager]);

  // Global window pointer tracking + deduplicated TouchEvent fallback for mobile screen-edge gestures
  useEffect(() => {
    const onWindowPointerMove = (e: PointerEvent) => {
      if (e.pointerId === stickPointerId.current) {
        applyStickPosition(e.clientX, e.clientY);
      } else if (e.pointerId === wheelPointerId.current) {
        applyWheelPosition(e.clientX);
      } else if (e.pointerId === lookPointerId.current) {
        moveLookByPointerId(e.pointerId, e.clientX, e.clientY);
      } else if (e.pointerId === fireLookPointerId.current) {
        moveFireLookByPointerId(e.pointerId, e.clientX, e.clientY);
      }
    };

    const onWindowPointerEnd = (e: PointerEvent) => {
      if (e.pointerId === stickPointerId.current) {
        // If pointerup (normal lift), also clear touch fallback ID.
        // If pointercancel (e.g., mobile browser edge swipe interception), allow touchmove fallback to finish if finger is still down.
        if (e.type === 'pointerup') {
          stickTouchFallbackId.current = null;
        }
        endStickByPointerId(e.pointerId);
      }
      if (e.pointerId === lookPointerId.current) {
        endLookByPointerId(e.pointerId);
      }
      if (heldButtonPointers.current.has(e.pointerId)) {
        endHoldByPointerId(e.pointerId);
      }
      endVehiclePointerId(e.pointerId);
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
    const onRootTouchStart = (e: TouchEvent) => {
      if (e.cancelable) {
        e.preventDefault();
      }
      // Record touch identifier for left-zone movement fallback in case browser fires premature pointercancel
      if (!inVehicleRef.current && stickTouchFallbackId.current === null) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.clientX <= window.innerWidth * 0.42) {
            stickTouchFallbackId.current = t.identifier;
            break;
          }
        }
      }
    };

    const onRootTouchMove = (e: TouchEvent) => {
      if (e.cancelable) {
        e.preventDefault();
      }
      // Compatibility fallback: only process TouchMove when PointerEvents dropped (stickPointerId === null)
      // while the physical finger (stickTouchFallbackId) is still active on the screen.
      if (
        !inVehicleRef.current &&
        stickPointerId.current === null &&
        stickTouchFallbackId.current !== null
      ) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === stickTouchFallbackId.current) {
            setStickActive(true);
            applyStickPosition(t.clientX, t.clientY);
            break;
          }
        }
      }
    };

    const onRootTouchEnd = (e: TouchEvent) => {
      if (stickTouchFallbackId.current !== null) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === stickTouchFallbackId.current) {
            stickTouchFallbackId.current = null;
            if (stickPointerId.current === null) {
              setStickActive(false);
              setFloatingOrigin(null);
              setStickOffset({ x: 0, y: 0 });
              setAutoSprintEngaged(false);
              inputManagerRef.current?.setVirtualMoveAxes(0, 0);
              if (!sprintLockedRef.current) {
                inputManagerRef.current?.setVirtualActionState('sprint', false);
              }
            }
            break;
          }
        }
      }
    };

    rootEl?.addEventListener('touchstart', onRootTouchStart, { passive: false });
    rootEl?.addEventListener('touchmove', onRootTouchMove, { passive: false });
    rootEl?.addEventListener('touchend', onRootTouchEnd, { passive: true });
    rootEl?.addEventListener('touchcancel', onRootTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      window.removeEventListener('blur', releaseAllVirtual);
      document.removeEventListener('visibilitychange', handleVisibilityOrBlur);
      rootEl?.removeEventListener('touchstart', onRootTouchStart);
      rootEl?.removeEventListener('touchmove', onRootTouchMove);
      rootEl?.removeEventListener('touchend', onRootTouchEnd);
      rootEl?.removeEventListener('touchcancel', onRootTouchEnd);
      releaseAllVirtual();
    };
  }, [
    applyStickPosition,
    applyWheelPosition,
    endHoldByPointerId,
    endLookByPointerId,
    endStickByPointerId,
    endVehiclePointerId,
    moveFireLookByPointerId,
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
    releaseAllVirtual();
    setTacticalOpen(false);
  }, [hud.inVehicle, releaseAllVirtual]);

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
    const cx = rect.width > 0 ? rect.left + rect.width / 2 : stickRect.centerX;
    const cy = rect.height > 0 ? rect.top + rect.height / 2 : stickRect.centerY;
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

    // FND-14 Fix: If the player touches inside or near the visible joystick ring (within 1.45x radius),
    // keep the joystick base anchored at its default center so tapping Left/Right/Up/Down on the stick
    // immediately produces directional movement without requiring a second drag!
    const distFromDefaultBase = Math.hypot(
      e.clientX - stickRect.centerX,
      e.clientY - stickRect.centerY
    );
    if (distFromDefaultBase <= radius * 1.45) {
      stickCenterRef.current = { x: stickRect.centerX, y: stickRect.centerY, radius };
      setFloatingOrigin(null);
    } else {
      stickCenterRef.current = { x: e.clientX, y: e.clientY, radius };
      setFloatingOrigin({ left: e.clientX - halfPad, top: e.clientY - halfPad });
    }

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
    if (
      e.pointerId === stickPointerId.current ||
      e.pointerId === wheelPointerId.current ||
      heldButtonPointers.current.has(e.pointerId) ||
      vehSteerPointers.current.has(e.pointerId) ||
      vehPedalPointers.current.has(e.pointerId)
    ) {
      return;
    }
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
      if (fireSide === 'right' && !inVehicleRef.current) {
        fireLookPointerId.current = e.pointerId;
        fireLookStartPos.current = { x: e.clientX, y: e.clientY };
        fireLookLastPos.current = { x: e.clientX, y: e.clientY };
        fireLookDragEngaged.current = false;
      }
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

  // Vehicle Steering & Pedal Multitouch Handlers
  const handleVehSteerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    dir: 'left' | 'right'
  ) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    vehSteerPointers.current.set(e.pointerId, dir);
    syncVehicleControlsToEngine();
  };

  const handleVehSteerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!vehSteerPointers.current.has(e.pointerId)) return;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    vehSteerPointers.current.delete(e.pointerId);
    syncVehicleControlsToEngine();
  };

  const handleVehPedalDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    pedal: 'gas' | 'brakeReverse' | 'handbrake'
  ) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    vehPedalPointers.current.set(e.pointerId, pedal);
    syncVehicleControlsToEngine();
  };

  const handleVehPedalUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!vehPedalPointers.current.has(e.pointerId)) return;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    vehPedalPointers.current.delete(e.pointerId);
    syncVehicleControlsToEngine();
  };

  const handleWheelDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.width > 0 ? rect.left + rect.width / 2 : vehicleLayout.controls.veh_steer_left.centerX;
    const cy = rect.height > 0 ? rect.top + rect.height / 2 : vehicleLayout.controls.veh_steer_left.centerY;
    const radius = Math.max(48, (rect.width || 120) / 2);
    wheelCenterRef.current = { x: cx, y: cy, radius };
    wheelPointerId.current = e.pointerId;
    applyWheelPosition(e.clientX);
  };

  const handleWheelMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (wheelPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    applyWheelPosition(e.clientX);
  };

  const handleWheelUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (wheelPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    endWheelByPointerId(e.pointerId);
  };

  const fireTapAction = (e: React.PointerEvent<HTMLButtonElement>, action: ExtendedInputAction) => {
    e.stopPropagation();
    inputManager?.triggerVirtualActionPress(action);
  };

  const handleRpgQuickEquip = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!inputManager) return;
    if (hud.rpgEquipped) {
      if (hud.rpgAmmoInMag === 0 && hud.rpgReserveAmmo > 0) {
        inputManager.triggerVirtualActionPress('reload');
      } else {
        inputManager.queueWeaponSlot(1);
      }
    } else {
      inputManager.queueWeaponSlot(7);
    }
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

  const leftFireTestId = fireRightRect.visible ? 'touch-btn-fire-left' : 'touch-btn-fire';
  const rightFireTestId = 'touch-btn-fire';

  const effectiveOpacity = hud.inVehicle
    ? Math.max(0.35, Math.min(0.95, vehicleOpacity ?? touchOpacity))
    : Math.max(0.35, Math.min(0.95, touchOpacity));

  const vControls = vehicleLayout.controls;

  return (
    <div
      ref={rootRef}
      data-testid="mobile-touch-controls"
      data-viewport={`${layout.viewportWidth}x${layout.viewportHeight}`}
      data-control-profile={touchControlProfile}
      data-vehicle-mode={hud.inVehicle ? 'true' : 'false'}
      data-left-fire-enabled={fireLeftRect.visible ? 'true' : 'false'}
      data-right-fire-enabled={fireRightRect.visible ? 'true' : 'false'}
      className="fixed inset-0 z-20 pointer-events-none select-none touch-none touch-none-surface"
      style={{
        opacity: effectiveOpacity,
        touchAction: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* VEHICLE MODE: PUBG Mobile-Inspired Dedicated Driving HUD */}
      {hud.inVehicle ? (
        <div data-testid="mobile-vehicle-hud" className="fixed inset-0 pointer-events-none">
          {/* Full-Screen Independent 360° Vehicle Camera Look Surface (never activates pedals or steering) */}
          <div
            data-testid="touch-look-zone"
            aria-label="Vehicle Camera Look Surface"
            style={{ touchAction: 'none' }}
            className="pointer-events-auto touch-none touch-none-surface fixed inset-0 z-10"
            onPointerDown={handleLookPointerDown}
            onPointerMove={handleLookPointerMove}
            onPointerUp={handleLookPointerEnd}
            onPointerCancel={handleLookPointerEnd}
            onLostPointerCapture={handleLookPointerEnd}
          />

          {/* First-Time Dismissible Vehicle Control Hint */}
          {!hasSeenVehicleHint && (
            <div
              data-testid="vehicle-control-hint"
              className="pointer-events-auto fixed left-1/2 -translate-x-1/2 top-14 z-40 bg-[#0B0E11]/95 border border-amber-400/80 px-3 py-1.5 rounded-sm shadow-xl flex items-center gap-2.5 max-w-[92vw]"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="font-mono text-[10px] text-zinc-100 leading-tight">
                <strong className="text-amber-400">DRIVING CONTROLS:</strong> Left/Right Steer · Hold{' '}
                <span className="text-emerald-300 font-bold">GAS</span> to Accelerate · Hold{' '}
                <span className="text-red-300 font-bold">BRAKE/REV</span> to Stop &amp; Reverse · Drag Screen to Look
              </span>
              <button
                type="button"
                data-testid="dismiss-vehicle-hint"
                onClick={(e) => {
                  e.stopPropagation();
                  markVehicleHintSeen();
                }}
                className="px-2 py-0.5 bg-amber-500 text-zinc-950 font-mono text-[10px] font-bold uppercase rounded-xs shrink-0"
              >
                Got It
              </button>
            </div>
          )}

          {/* Steering Controls: Dedicated Left/Right Buttons OR Virtual Steering Wheel */}
          {vehicleLayout.steeringMode === 'wheel' ? (
            <div
              data-testid="touch-veh-wheel"
              data-control-id="veh_steer_left"
              aria-label="Virtual Steering Wheel"
              onPointerDown={handleWheelDown}
              onPointerMove={handleWheelMove}
              onPointerUp={handleWheelUp}
              onPointerCancel={handleWheelUp}
              onLostPointerCapture={handleWheelUp}
              style={{
                left: `${vControls.veh_steer_left.left}px`,
                top: `${vControls.veh_steer_left.top}px`,
                width: `${vControls.veh_steer_left.width}px`,
                height: `${vControls.veh_steer_left.height}px`,
                zIndex: vControls.veh_steer_left.zIndex,
                touchAction: 'none',
              }}
              className="pointer-events-auto touch-none touch-none-surface fixed rounded-full bg-[#0B0E11]/75 border-2 border-amber-400/80 flex items-center justify-center shadow-2xl"
            >
              <div
                style={{
                  transform: `rotate(${Math.round(wheelSteerNorm * 65)}deg)`,
                }}
                className="w-[82%] h-[82%] rounded-full border-4 border-zinc-200/75 flex items-center justify-center transition-transform duration-75"
              >
                <Disc className="w-7 h-7 text-amber-400" />
              </div>
              <span className="absolute -top-5 font-mono text-[9px] text-amber-300 font-bold uppercase">
                STEER {hud.vehicleSteerDeg}°
              </span>
            </div>
          ) : (
            <>
              <button
                type="button"
                data-testid="touch-veh-steer-left"
                data-control-id="veh_steer_left"
                aria-label="Steer Left"
                aria-pressed={vehUiState.steerLeft}
                onPointerDown={(e) => handleVehSteerDown(e, 'left')}
                onPointerUp={handleVehSteerUp}
                onPointerCancel={handleVehSteerUp}
                onLostPointerCapture={handleVehSteerUp}
                style={{
                  left: `${vControls.veh_steer_left.left}px`,
                  top: `${vControls.veh_steer_left.top}px`,
                  width: `${vControls.veh_steer_left.width}px`,
                  height: `${vControls.veh_steer_left.height}px`,
                  zIndex: vControls.veh_steer_left.zIndex,
                  touchAction: 'none',
                }}
                className={`pointer-events-auto touch-none touch-none-surface fixed rounded-xl border-2 font-mono text-[10px] font-bold uppercase flex flex-col items-center justify-center transition-transform duration-75 ${
                  vehUiState.steerLeft
                    ? 'bg-amber-500/75 border-white text-zinc-950 scale-95 shadow-lg'
                    : 'bg-[#0B0E11]/82 border-amber-400/75 text-amber-100 shadow-md'
                }`}
              >
                <ArrowLeft className="w-6 h-6" />
                <span className="text-[9px] leading-none mt-0.5">LEFT</span>
              </button>

              <button
                type="button"
                data-testid="touch-veh-steer-right"
                data-control-id="veh_steer_right"
                aria-label="Steer Right"
                aria-pressed={vehUiState.steerRight}
                onPointerDown={(e) => handleVehSteerDown(e, 'right')}
                onPointerUp={handleVehSteerUp}
                onPointerCancel={handleVehSteerUp}
                onLostPointerCapture={handleVehSteerUp}
                style={{
                  left: `${vControls.veh_steer_right.left}px`,
                  top: `${vControls.veh_steer_right.top}px`,
                  width: `${vControls.veh_steer_right.width}px`,
                  height: `${vControls.veh_steer_right.height}px`,
                  zIndex: vControls.veh_steer_right.zIndex,
                  touchAction: 'none',
                }}
                className={`pointer-events-auto touch-none touch-none-surface fixed rounded-xl border-2 font-mono text-[10px] font-bold uppercase flex flex-col items-center justify-center transition-transform duration-75 ${
                  vehUiState.steerRight
                    ? 'bg-amber-500/75 border-white text-zinc-950 scale-95 shadow-lg'
                    : 'bg-[#0B0E11]/82 border-amber-400/75 text-amber-100 shadow-md'
                }`}
              >
                <ArrowRight className="w-6 h-6" />
                <span className="text-[9px] leading-none mt-0.5">RIGHT</span>
              </button>
            </>
          )}

          {/* Hold-to-Accelerate GAS Pedal */}
          <button
            type="button"
            data-testid="touch-veh-gas"
            data-control-id="veh_gas"
            aria-label="Accelerate Gas Pedal"
            aria-pressed={vehUiState.gas}
            onPointerDown={(e) => handleVehPedalDown(e, 'gas')}
            onPointerUp={handleVehPedalUp}
            onPointerCancel={handleVehPedalUp}
            onLostPointerCapture={handleVehPedalUp}
            style={{
              left: `${vControls.veh_gas.left}px`,
              top: `${vControls.veh_gas.top}px`,
              width: `${vControls.veh_gas.width}px`,
              height: `${vControls.veh_gas.height}px`,
              zIndex: vControls.veh_gas.zIndex,
              touchAction: 'none',
            }}
            className={`pointer-events-auto touch-none touch-none-surface fixed rounded-xl border-2 font-mono text-xs font-bold uppercase flex flex-col items-center justify-center transition-transform duration-75 ${
              vehUiState.gas
                ? 'bg-emerald-500/85 border-white text-zinc-950 scale-95 shadow-[0_0_20px_rgba(16,185,129,0.65)]'
                : 'bg-emerald-950/80 border-emerald-400/85 text-emerald-100 shadow-xl'
            }`}
          >
            <ChevronUp className="w-6 h-6 -mb-1" />
            <span>GAS</span>
            <span className="text-[8px] opacity-80 mt-0.5">{hud.vehicleSpeedKmh} KM/H</span>
          </button>

          {/* Separate Hold Brake / Reverse Pedal with Hysteresis Gear State Badge */}
          <button
            type="button"
            data-testid="touch-veh-brake-reverse"
            data-control-id="veh_brake_reverse"
            aria-label="Brake and Reverse Pedal"
            aria-pressed={vehUiState.brakeReverse}
            onPointerDown={(e) => handleVehPedalDown(e, 'brakeReverse')}
            onPointerUp={handleVehPedalUp}
            onPointerCancel={handleVehPedalUp}
            onLostPointerCapture={handleVehPedalUp}
            style={{
              left: `${vControls.veh_brake_reverse.left}px`,
              top: `${vControls.veh_brake_reverse.top}px`,
              width: `${vControls.veh_brake_reverse.width}px`,
              height: `${vControls.veh_brake_reverse.height}px`,
              zIndex: vControls.veh_brake_reverse.zIndex,
              touchAction: 'none',
            }}
            className={`pointer-events-auto touch-none touch-none-surface fixed rounded-xl border-2 font-mono text-[10px] font-bold uppercase flex flex-col items-center justify-center transition-transform duration-75 ${
              vehUiState.brakeReverse
                ? hud.vehicleGear === 'REVERSE'
                  ? 'bg-red-600/90 border-amber-200 text-white scale-95 shadow-[0_0_18px_rgba(239,68,68,0.65)]'
                  : 'bg-amber-500/85 border-white text-zinc-950 scale-95'
                : 'bg-[#1b1212]/85 border-red-400/80 text-red-100 shadow-lg'
            }`}
          >
            <ChevronDown className="w-5 h-5 -mb-0.5" />
            <span>{hud.vehicleGear === 'REVERSE' ? 'REV' : 'BRAKE'}</span>
            <span className="text-[8px] opacity-80">
              {hud.vehicleGear === 'REVERSE'
                ? 'REVERSING'
                : hud.vehicleGear === 'NEUTRAL_HOLD'
                  ? 'SHIFTING...'
                  : 'HOLD REV'}
            </span>
          </button>

          {/* Handbrake Button */}
          <button
            type="button"
            data-testid="touch-veh-handbrake"
            data-control-id="veh_handbrake"
            aria-label="Vehicle Handbrake"
            aria-pressed={vehUiState.handbrake}
            onPointerDown={(e) => handleVehPedalDown(e, 'handbrake')}
            onPointerUp={handleVehPedalUp}
            onPointerCancel={handleVehPedalUp}
            onLostPointerCapture={handleVehPedalUp}
            style={{
              left: `${vControls.veh_handbrake.left}px`,
              top: `${vControls.veh_handbrake.top}px`,
              width: `${vControls.veh_handbrake.width}px`,
              height: `${vControls.veh_handbrake.height}px`,
              zIndex: vControls.veh_handbrake.zIndex,
              touchAction: 'none',
            }}
            className={`pointer-events-auto touch-none touch-none-surface fixed rounded-full border font-mono text-[9px] font-bold uppercase flex flex-col items-center justify-center ${
              vehUiState.handbrake || hud.vehicleHandbrake
                ? 'bg-amber-500/80 border-white text-zinc-950 scale-95'
                : 'bg-[#0B0E11]/82 border-white/25 text-zinc-200'
            }`}
          >
            <span>DRIFT</span>
            <span className="text-[8px] text-amber-300">BRAKE</span>
          </button>

          {/* Roof Turret Fire Button */}
          <button
            type="button"
            data-testid="touch-btn-fire"
            data-control-id="veh_fire"
            aria-label="Fire Vehicle Turret"
            aria-pressed={isFiring}
            onPointerDown={(e) => startHoldActions(e, ['fire'], 'right')}
            onPointerUp={endHoldActions}
            onPointerCancel={endHoldActions}
            onLostPointerCapture={endHoldActions}
            style={{
              left: `${vControls.veh_fire.left}px`,
              top: `${vControls.veh_fire.top}px`,
              width: `${vControls.veh_fire.width}px`,
              height: `${vControls.veh_fire.height}px`,
              zIndex: vControls.veh_fire.zIndex,
              touchAction: 'none',
            }}
            className={`pointer-events-auto touch-none touch-none-surface fixed rounded-full border-2 font-mono text-[10px] font-bold uppercase flex flex-col items-center justify-center ${
              isFiring
                ? 'bg-red-600/90 border-amber-200 text-white scale-95'
                : 'bg-amber-500/42 border-amber-300 text-amber-50'
            }`}
          >
            <Crosshair className="w-5 h-5" />
            <span className="text-[9px] mt-0.5">GUN</span>
          </button>

          {/* Upper-Right Vehicle Camera & Exit Buttons */}
          <button
            type="button"
            data-testid="touch-btn-veh-cam"
            data-control-id="veh_camera"
            aria-label="Switch Vehicle Camera"
            onPointerDown={(e) => fireTapAction(e, 'vehicleCamera')}
            style={{
              left: `${vControls.veh_camera.left}px`,
              top: `${vControls.veh_camera.top}px`,
              width: `${vControls.veh_camera.width}px`,
              height: `${vControls.veh_camera.height}px`,
              zIndex: vControls.veh_camera.zIndex,
              touchAction: 'none',
            }}
            className="pointer-events-auto touch-none touch-none-surface fixed bg-[#0B0E11]/85 border border-white/25 rounded-full font-mono text-[10px] font-bold text-emerald-300 flex items-center justify-center gap-1"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>CAM</span>
          </button>

          <button
            type="button"
            data-testid="touch-btn-veh-exit"
            data-control-id="veh_exit"
            aria-label="Exit Vehicle"
            onPointerDown={(e) => fireTapAction(e, 'interact')}
            style={{
              left: `${vControls.veh_exit.left}px`,
              top: `${vControls.veh_exit.top}px`,
              width: `${vControls.veh_exit.width}px`,
              height: `${vControls.veh_exit.height}px`,
              zIndex: vControls.veh_exit.zIndex,
              touchAction: 'none',
            }}
            className="pointer-events-auto touch-none touch-none-surface fixed bg-[#0B0E11]/90 border-2 border-amber-400 rounded-full font-mono text-[10px] text-amber-300 font-bold flex items-center justify-center"
          >
            EXIT
          </button>
        </div>
      ) : (
        /* INFANTRY MODE: 8-Way Immediate Analog Stick + 360° Look + Claw/Thumb Fire + 1-Tap RPG Bar */
        <>
          {/* Left Floating Movement Zone */}
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
            onLostPointerCapture={handleStickPointerEnd}
          />

          {/* Right Independent 360-Degree Camera Look Surface */}
          <div
            data-testid="touch-look-zone"
            aria-label="Touch Aim Look Zone"
            style={{ touchAction: 'none' }}
            className="pointer-events-auto touch-none touch-none-surface fixed top-0 bottom-0 right-0 left-[40%]"
            onPointerDown={handleLookPointerDown}
            onPointerMove={handleLookPointerMove}
            onPointerUp={handleLookPointerEnd}
            onPointerCancel={handleLookPointerEnd}
            onLostPointerCapture={handleLookPointerEnd}
          />

          {/* Left Movement Thumbstick with N/S/E/W Directional Guides */}
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
            {autoSprintEngaged && !touchManualSprintButton && (
              <div className="pointer-events-none flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/25 border border-amber-400/70 font-mono text-[9px] font-bold uppercase text-amber-200">
                <ChevronUp className="w-3 h-3" />
                <span>SPRINT</span>
              </div>
            )}

            {touchManualSprintButton && (
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
              onLostPointerCapture={handleStickPointerEnd}
              style={{ width: `${padSize}px`, height: `${padSize}px`, touchAction: 'none' }}
              className={`pointer-events-auto touch-none touch-none-surface relative rounded-full border flex items-center justify-center transition-colors ${
                stickActive
                  ? 'bg-[#141920]/75 border-amber-400/85'
                  : 'bg-[#0B0E11]/55 border-white/25'
              }`}
            >
              {/* Directional N/S/E/W Chevrons for Immediate Left/Right Strafe Clarity */}
              <ChevronUp className="absolute top-1.5 w-3.5 h-3.5 text-white/35 pointer-events-none" />
              <ChevronDown className="absolute bottom-1.5 w-3.5 h-3.5 text-white/35 pointer-events-none" />
              <ChevronLeft className="absolute left-1.5 w-3.5 h-3.5 text-amber-300/55 pointer-events-none" />
              <ChevronRight className="absolute right-1.5 w-3.5 h-3.5 text-amber-300/55 pointer-events-none" />
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

          {/* Center Contextual Prompts (Interact / Nuke Auth) */}
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

            {hud.interactPrompt && (
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

          {/* Dedicated Left-Side Claw FIRE Button */}
          {fireLeftRect.visible && (
            <button
              type="button"
              data-testid={leftFireTestId}
              data-control-id="fire_left"
              data-fire-side="left"
              data-profile={touchControlProfile}
              data-pressed={isLeftFiring ? 'true' : 'false'}
              aria-label="Left Fire Weapon"
              aria-pressed={isLeftFiring}
              onPointerDown={(e) => startHoldActions(e, fireActions, 'left')}
              onPointerUp={endHoldActions}
              onPointerCancel={endHoldActions}
              onLostPointerCapture={endHoldActions}
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
                  : hud.ammoInMag === 0
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
              <span className="mt-0.5 leading-none">FIRE</span>
            </button>
          )}

          {/* Dedicated Right-Side Thumb FIRE Button */}
          {fireRightRect.visible && (
            <button
              type="button"
              data-testid={rightFireTestId}
              data-control-id="fire_right"
              data-fire-side="right"
              data-profile={touchControlProfile}
              data-pressed={isRightFiring ? 'true' : 'false'}
              aria-label="Fire Weapon"
              aria-pressed={isRightFiring}
              onPointerDown={(e) => startHoldActions(e, fireActions, 'right')}
              onPointerMove={(e) => {
                if (fireLookPointerId.current === e.pointerId) {
                  e.stopPropagation();
                  moveFireLookByPointerId(e.pointerId, e.clientX, e.clientY);
                }
              }}
              onPointerUp={endHoldActions}
              onPointerCancel={endHoldActions}
              onLostPointerCapture={endHoldActions}
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
                  : hud.ammoInMag === 0
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
              <span className="mt-0.5 leading-none">FIRE</span>
            </button>
          )}

          {/* Primary ADS Button */}
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
              onLostPointerCapture={handleAdsPointerEnd}
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

          {/* Secondary Right-Thumb Ergonomic Arc Controls: Reload, Crouch/Slide, Jump */}
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
              onLostPointerCapture={endHoldActions}
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
              aria-label={hud.canVault ? 'Vault Obstacle' : 'Jump'}
              onPointerDown={(e) => startHoldActions(e, ['jump'])}
              onPointerUp={endHoldActions}
              onPointerCancel={endHoldActions}
              onLostPointerCapture={endHoldActions}
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
                  : hud.canVault
                    ? 'bg-cyan-500/35 border-cyan-300 text-cyan-100 ring-2 ring-cyan-400/40'
                    : 'bg-[#0B0E11]/78 border-white/20 text-zinc-200'
              }`}
            >
              <ArrowUp className={hud.canVault ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
              {hud.canVault && (
                <span className="font-mono text-[8px] font-bold leading-none mt-0.5 tracking-tight">
                  VAULT
                </span>
              )}
            </button>
          )}

          {/* Bottom-Center Tactical Weapon, 1-Tap RPG & Ordnance Bar */}
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
            {tacticalOpen && (
              <div
                data-testid="touch-tactical-drawer"
                style={{
                  bottom: `${weaponBarRect.height + 8}px`,
                  touchAction: 'none',
                }}
                className="pointer-events-auto absolute left-[46%] md:left-1/2 -translate-x-1/2 bg-[#0B0E11]/95 border border-white/15 rounded-md p-2 flex flex-col gap-1.5 shadow-2xl w-[min(284px,calc(100vw-24px))] md:w-[344px] max-h-[calc(100dvh-134px)] overflow-y-auto"
              >
                <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-1 shrink-0">
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
                    className="min-w-[32px] min-h-[28px] flex items-center justify-center text-zinc-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-nowrap overflow-x-auto gap-1 shrink-0 pb-0.5">
                  <button
                    type="button"
                    data-testid="touch-btn-firemode"
                    aria-label="Cycle Fire Mode"
                    onPointerDown={(e) => fireTapAction(e, 'fireMode')}
                    className="touch-none touch-none-surface min-w-[44px] min-h-[38px] px-2.5 bg-[#141920] border border-zinc-700 rounded-sm font-mono text-[10px] font-bold uppercase text-zinc-200 shrink-0"
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
                        className="touch-none touch-none-surface min-w-[44px] min-h-[38px] px-2.5 bg-[#141920] border border-amber-500/50 rounded-sm font-mono text-[10px] font-bold text-amber-300 whitespace-nowrap shrink-0"
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
                        className="touch-none touch-none-surface min-w-[44px] min-h-[38px] px-2.5 bg-[#141920] border border-cyan-500/50 rounded-sm font-mono text-[10px] font-bold text-cyan-300 flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <Bomb className="w-3.5 h-3.5" />
                        <span>{hud.ordnance.selectedBombShort}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="touch-btn-cycle-bomb"
                        aria-label="Cycle Bomb Type"
                        onPointerDown={(e) => fireTapAction(e, 'cycleBomb')}
                        className="touch-none touch-none-surface min-w-[44px] min-h-[38px] px-2 bg-[#141920] border border-zinc-700 rounded-sm font-mono text-[10px] text-zinc-300 whitespace-nowrap shrink-0"
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
                            className="touch-none touch-none-surface min-w-[44px] min-h-[38px] px-2.5 bg-red-950/90 border border-red-500 rounded-sm font-mono text-[10px] font-bold text-red-200 whitespace-nowrap shrink-0"
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
                        className={`touch-none touch-none-surface min-h-[34px] px-1.5 rounded-sm border font-mono text-[9px] font-bold uppercase truncate ${
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

            <div className="pointer-events-none flex items-center justify-center gap-1 w-full h-full">
              {hud.ordnance && hud.ordnance.c4Deployed > 0 && (
                <button
                  type="button"
                  data-testid="touch-btn-c4-detonate"
                  aria-label="Detonate Planted C4"
                  style={{ height: `${weaponBarRect.height}px`, touchAction: 'none' }}
                  onPointerDown={(e) => fireTapAction(e, 'c4Detonate')}
                  className="pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2 bg-red-950/85 border border-red-400 rounded-full font-mono text-[10px] font-bold text-red-200 flex items-center justify-center"
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
                  className="pointer-events-auto touch-none touch-none-surface min-w-[44px] min-h-[44px] px-2 bg-[#0B0E11]/80 border border-amber-400/50 rounded-full font-mono text-[10px] font-bold text-amber-300 flex items-center justify-center gap-1"
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span className="tabular-nums">{hud.grenades}</span>
                </button>
              )}

              {/* Dedicated 1-Tap RPG / Bazooka Quick-Equip Button (FND-19) */}
              <button
                type="button"
                data-testid="touch-btn-rpg"
                aria-label="Quick Equip RPG-7V Bazooka"
                aria-pressed={hud.rpgEquipped}
                onPointerDown={handleRpgQuickEquip}
                style={{
                  height: `${weaponBarRect.height}px`,
                  touchAction: 'none',
                }}
                className={`pointer-events-auto touch-none touch-none-surface min-w-[54px] min-h-[44px] px-2.5 rounded-full border font-mono text-[10px] font-bold uppercase flex items-center justify-center gap-1 transition-colors ${
                  hud.rpgEquipped
                    ? 'bg-amber-500/40 border-amber-300 text-amber-100 ring-2 ring-amber-400/40'
                    : hud.rpgAvailable
                      ? 'bg-[#0B0E11]/85 border-amber-500/70 text-amber-300'
                      : 'bg-[#0B0E11]/65 border-zinc-700 text-zinc-500'
                }`}
              >
                <Rocket className="w-3.5 h-3.5 shrink-0" />
                <span className="tabular-nums">
                  {hud.rpgAvailable ? `${hud.rpgAmmoInMag}/${hud.rpgReserveAmmo}` : '0/0'}
                </span>
              </button>

              <button
                type="button"
                data-testid="touch-btn-weapon-switch"
                aria-label="Switch Weapon"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  inputManager?.cycleWeapon(1);
                }}
                style={{ height: `${weaponBarRect.height}px`, touchAction: 'none' }}
                className="pointer-events-auto touch-none touch-none-surface min-w-[74px] min-h-[44px] px-2 bg-[#0B0E11]/80 border border-white/20 rounded-full font-mono text-[9.5px] font-bold uppercase text-zinc-100 flex items-center justify-center gap-1"
              >
                <Repeat className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="truncate max-w-[72px]">{hud.weaponName}</span>
              </button>

              <button
                type="button"
                data-testid="touch-btn-tactical-drawer"
                aria-label="Toggle Tactical Kit"
                aria-expanded={tacticalOpen}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setTacticalOpen((v) => {
                    const next = !v;
                    if (next) {
                      uiStore.getState().setTacticalOverviewOpen(false);
                    }
                    return next;
                  });
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
          </div>

          {onIssueSquadCommand && (
            <MobileSquadCommandStrip
              hud={hud}
              stripRect={squadStripRect}
              onIssueCommand={(order, source, opId) => onIssueSquadCommand(order, source, opId)}
            />
          )}
        </>
      )}
    </div>
  );
});
