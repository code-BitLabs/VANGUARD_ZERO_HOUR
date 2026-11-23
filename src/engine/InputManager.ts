import { ResourceManager } from '@/src/core/ResourceManager';
import { ControlBindings, InputSettings } from '@/src/schemas/settings.schema';

export type InputAction = keyof ControlBindings;
export type ExtendedInputAction =
  | InputAction
  | 'fire'
  | 'ads'
  | 'c4Detonate'
  | 'cycleBomb'
  | 'confirmNuke'
  | 'cancelNuke';

export interface VehicleControlInput {
  /** Normalized throttle [0..1] (W / ArrowUp / GAS button) */
  gas: number;
  /** Normalized brake & reverse [0..1] (S / ArrowDown / BRAKE-REV button) */
  brakeReverse: number;
  /** Normalized steering [-1..1] (-1 = Full Left, +1 = Full Right) */
  steer: number;
  /** Handbrake engaged (Space / HANDBRAKE button) */
  handbrake: boolean;
}

const SECONDARY_ACTION_KEYS: Partial<Record<InputAction, readonly string[]>> = {
  forward: ['ArrowUp'],
  backward: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  sprint: ['ShiftRight'],
  crouch: ['ControlRight'],
  handbrake: ['Space'],
};

function normalizeKeyCode(e: KeyboardEvent): string {
  if (e.code && e.code.length > 0) return e.code;
  const k = e.key?.toLowerCase();
  switch (k) {
    case 'w':
      return 'KeyW';
    case 's':
      return 'KeyS';
    case 'a':
      return 'KeyA';
    case 'd':
      return 'KeyD';
    case 'e':
      return 'KeyE';
    case 'r':
      return 'KeyR';
    case 'g':
      return 'KeyG';
    case 'f':
      return 'KeyF';
    case 'b':
      return 'KeyB';
    case 'c':
      return 'KeyC';
    case 'v':
      return 'KeyV';
    case 'n':
      return 'KeyN';
    case ' ':
      return 'Space';
    case 'arrowup':
      return 'ArrowUp';
    case 'arrowdown':
      return 'ArrowDown';
    case 'arrowleft':
      return 'ArrowLeft';
    case 'arrowright':
      return 'ArrowRight';
    case 'shift':
      return 'ShiftLeft';
    case 'control':
      return 'ControlLeft';
    case 'escape':
      return 'Escape';
    default:
      return e.code || '';
  }
}

export class InputManager {
  private heldKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  private mouseButtons = new Set<number>();
  private justPressedMouse = new Set<number>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private wheelDelta = 0;
  private pointerLocked = false;
  private pointerLockFailed = false;
  private canvasEl: HTMLElement | null = null;
  private canvasDragActive = false;
  private lastDragClientX = 0;
  private lastDragClientY = 0;
  private ignoreNextLargeLockedWarp = false;
  private attached = false;
  private prevGamepadButtons = new Set<number>();
  private lastInputDevice: 'keyboard' | 'touch' = 'keyboard';

  private virtualMoveForward = 0;
  private virtualMoveRight = 0;
  private virtualLookDeltaX = 0;
  private virtualLookDeltaY = 0;
  private smoothedTouchLookX = 0;
  private smoothedTouchLookY = 0;
  private virtualHeldActions = new Set<string>();
  private virtualJustPressedActions = new Set<string>();
  private queuedWeaponDelta = 0;
  private queuedWeaponSlot: number | null = null;

  // Dedicated Normalized Vehicle Touch State (FND-15)
  private virtualVehicleGas = 0;
  private virtualVehicleBrakeReverse = 0;
  private virtualVehicleSteerLeft = false;
  private virtualVehicleSteerRight = false;
  private virtualVehicleSteerWheel = 0;
  private virtualVehicleHandbrake = false;

  private virtualResetListeners = new Set<() => void>();

  constructor(
    private readonly resourceManager: ResourceManager,
    private settings: InputSettings,
    private readonly onPointerLockChange?: (locked: boolean) => void,
    private readonly onEscapeRequested?: () => void,
    private readonly isGameplayActive?: () => boolean
  ) {}

  attach(canvas: HTMLElement): void {
    if (this.attached) return;
    this.attached = true;
    this.canvasEl = canvas;

    this.resourceManager.trackEventListener(
      window,
      'keydown',
      this.handleKeyDown as EventListener,
      'shared'
    );
    this.resourceManager.trackEventListener(
      window,
      'keyup',
      this.handleKeyUp as EventListener,
      'shared'
    );
    this.resourceManager.trackEventListener(
      window,
      'mousemove',
      this.handleMouseMove as EventListener,
      'shared'
    );
    this.resourceManager.trackEventListener(
      window,
      'mousedown',
      this.handleMouseDown as EventListener,
      'shared'
    );
    this.resourceManager.trackEventListener(
      window,
      'mouseup',
      this.handleMouseUp as EventListener,
      'shared'
    );
    this.resourceManager.trackEventListener(
      window,
      'wheel',
      this.handleWheel as EventListener,
      'shared',
      { passive: true }
    );
    this.resourceManager.trackEventListener(
      window,
      'blur',
      this.clearAllInputs as EventListener,
      'shared'
    );
    this.resourceManager.trackEventListener(
      document,
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.clearAllInputs();
        }
      },
      'shared'
    );
    this.resourceManager.trackEventListener(
      document,
      'pointerlockchange',
      () => {
        const wasLocked = this.pointerLocked;
        this.pointerLocked = document.pointerLockElement === canvas;
        if (!wasLocked && this.pointerLocked) {
          this.pointerLockFailed = false;
          this.canvasDragActive = false;
          this.mouseDeltaX = 0;
          this.mouseDeltaY = 0;
          this.ignoreNextLargeLockedWarp = true;
        }
        if (wasLocked && !this.pointerLocked) {
          this.ignoreNextLargeLockedWarp = false;
          this.clearAllInputs();
        }
        this.onPointerLockChange?.(this.pointerLocked);
      },
      'shared'
    );
    this.resourceManager.trackEventListener(
      document,
      'pointerlockerror',
      () => {
        this.pointerLockFailed = true;
      },
      'shared'
    );
    this.resourceManager.trackEventListener(
      canvas,
      'contextmenu',
      (e: Event) => {
        if (this.pointerLocked || this.isGameplayActive?.()) {
          e.preventDefault();
        }
      },
      'shared'
    );
  }

  onVirtualInputsCleared(listener: () => void): () => void {
    this.virtualResetListeners.add(listener);
    return () => {
      this.virtualResetListeners.delete(listener);
    };
  }

  getLastInputDevice(): 'keyboard' | 'touch' {
    return this.lastInputDevice;
  }

  updateSettings(settings: InputSettings): void {
    this.settings = settings;
  }

  requestPointerLock(canvas: HTMLElement): void {
    try {
      const result = canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          this.pointerLockFailed = true;
        });
      }
    } catch {
      this.pointerLockFailed = true;
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  isPointerLockBlocked(): boolean {
    return this.pointerLockFailed;
  }

  setVirtualMoveAxes(forward: number, right: number): void {
    const f = Number.isFinite(forward) ? Math.max(-1, Math.min(1, forward)) : 0;
    const r = Number.isFinite(right) ? Math.max(-1, Math.min(1, right)) : 0;
    if (f !== 0 || r !== 0) {
      this.lastInputDevice = 'touch';
    }
    const len = Math.hypot(f, r);
    if (len > 1) {
      this.virtualMoveForward = f / len;
      this.virtualMoveRight = r / len;
    } else {
      this.virtualMoveForward = f;
      this.virtualMoveRight = r;
    }
  }

  setVirtualVehiclePedal(pedal: 'gas' | 'brakeReverse', value: number): void {
    const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    if (clamped > 0) this.lastInputDevice = 'touch';
    if (pedal === 'gas') {
      this.virtualVehicleGas = clamped;
    } else {
      this.virtualVehicleBrakeReverse = clamped;
    }
  }

  setVirtualVehicleSteerButton(side: 'left' | 'right', held: boolean): void {
    if (held) this.lastInputDevice = 'touch';
    if (side === 'left') {
      this.virtualVehicleSteerLeft = held;
    } else {
      this.virtualVehicleSteerRight = held;
    }
  }

  setVirtualVehicleSteerAxis(steer: number): void {
    const clamped = Number.isFinite(steer) ? Math.max(-1, Math.min(1, steer)) : 0;
    if (Math.abs(clamped) > 0.01) this.lastInputDevice = 'touch';
    this.virtualVehicleSteerWheel = clamped;
  }

  setVirtualVehicleHandbrake(held: boolean): void {
    if (held) this.lastInputDevice = 'touch';
    this.virtualVehicleHandbrake = held;
  }

  clearVirtualVehicleInputs(): void {
    this.virtualVehicleGas = 0;
    this.virtualVehicleBrakeReverse = 0;
    this.virtualVehicleSteerLeft = false;
    this.virtualVehicleSteerRight = false;
    this.virtualVehicleSteerWheel = 0;
    this.virtualVehicleHandbrake = false;
  }

  addVirtualLookDelta(dxPx: number, dyPx: number): void {
    if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx)) return;
    if (dxPx !== 0 || dyPx !== 0) {
      this.lastInputDevice = 'touch';
    }
    this.virtualLookDeltaX += dxPx;
    this.virtualLookDeltaY += dyPx;
  }

  setVirtualActionState(action: ExtendedInputAction, held: boolean): void {
    if (held) {
      this.lastInputDevice = 'touch';
      if (!this.virtualHeldActions.has(action)) {
        this.virtualJustPressedActions.add(action);
      }
      this.virtualHeldActions.add(action);
    } else {
      this.virtualHeldActions.delete(action);
    }
  }

  triggerVirtualActionPress(action: ExtendedInputAction): void {
    this.lastInputDevice = 'touch';
    this.virtualJustPressedActions.add(action);
  }

  queueWeaponSlot(slot: number): void {
    if (slot >= 1 && slot <= 9) {
      this.queuedWeaponSlot = Math.floor(slot);
    }
  }

  consumeQueuedWeaponSlot(): number | null {
    const slot = this.queuedWeaponSlot;
    this.queuedWeaponSlot = null;
    return slot;
  }

  cycleWeapon(delta: 1 | -1): void {
    this.queuedWeaponDelta += delta;
  }

  isActionHeld(action: ExtendedInputAction): boolean {
    if (this.virtualHeldActions.has(action)) return true;

    if (action === 'fire') {
      return this.isMouseHeld(0);
    }
    if (action === 'ads') {
      return this.isMouseHeld(2);
    }

    if (action in this.settings.bindings) {
      const code = this.settings.bindings[action as InputAction];
      if (this.heldKeys.has(code)) return true;
      const alts = SECONDARY_ACTION_KEYS[action as InputAction];
      if (alts) {
        for (let i = 0; i < alts.length; i++) {
          if (this.heldKeys.has(alts[i])) return true;
        }
      }
    }

    if (this.settings.gamepadEnabled) {
      const gp = this.getGamepad();
      if (gp) {
        if (action === 'sprint' && gp.buttons[10]?.pressed) return true;
        if (action === 'crouch' && gp.buttons[1]?.pressed) return true;
        if (action === 'jump' && gp.buttons[0]?.pressed) return true;
        if (action === 'handbrake' && gp.buttons[0]?.pressed) return true;
      }
    }
    return false;
  }

  wasActionPressed(action: ExtendedInputAction): boolean {
    if (this.virtualJustPressedActions.has(action)) return true;

    if (action === 'fire') {
      return this.wasMousePressed(0);
    }
    if (action === 'ads') {
      return this.wasMousePressed(2);
    }

    if (action in this.settings.bindings) {
      const code = this.settings.bindings[action as InputAction];
      if (this.justPressedKeys.has(code)) return true;
      const alts = SECONDARY_ACTION_KEYS[action as InputAction];
      if (alts) {
        for (let i = 0; i < alts.length; i++) {
          if (this.justPressedKeys.has(alts[i])) return true;
        }
      }
    }

    if (this.settings.gamepadEnabled) {
      const gp = this.getGamepad();
      if (gp) {
        const map: Partial<Record<InputAction, number>> = {
          jump: 0,
          crouch: 1,
          reload: 2,
          interact: 3,
          grenade: 5,
        };
        const btnIdx = map[action as InputAction];
        if (btnIdx !== undefined && gp.buttons[btnIdx]?.pressed && !this.prevGamepadButtons.has(btnIdx)) {
          return true;
        }
      }
    }
    return false;
  }

  isKeyHeld(code: string): boolean {
    return this.heldKeys.has(code);
  }

  wasKeyPressed(code: string): boolean {
    return this.justPressedKeys.has(code);
  }

  isMouseHeld(button: number): boolean {
    if (button === 0 && this.virtualHeldActions.has('fire')) return true;
    if (button === 2 && this.virtualHeldActions.has('ads')) return true;
    if (this.mouseButtons.has(button)) return true;
    if (this.settings.gamepadEnabled) {
      const gp = this.getGamepad();
      if (gp) {
        if (button === 0 && (gp.buttons[7]?.value ?? 0) > 0.35) return true;
        if (button === 2 && (gp.buttons[6]?.value ?? 0) > 0.35) return true;
      }
    }
    return false;
  }

  wasMousePressed(button: number): boolean {
    if (button === 0 && this.virtualJustPressedActions.has('fire')) return true;
    if (button === 2 && this.virtualJustPressedActions.has('ads')) return true;
    return this.justPressedMouse.has(button);
  }

  hasPendingLookDelta(): boolean {
    return (
      this.virtualLookDeltaX !== 0 ||
      this.virtualLookDeltaY !== 0 ||
      this.mouseDeltaX !== 0 ||
      this.mouseDeltaY !== 0 ||
      this.smoothedTouchLookX !== 0 ||
      this.smoothedTouchLookY !== 0
    );
  }

  consumeLookDelta(
    isAds: boolean,
    touchAimFrictionScale = 1.0,
    dt = 1 / 60
  ): { yawDelta: number; pitchDelta: number } {
    const safeDt = Number.isFinite(dt) ? Math.max(0.001, Math.min(0.05, dt)) : 1 / 60;
    const adsScale = isAds ? this.settings.adsSensitivity : 1.0;
    const baseSens = 0.0022 * this.settings.mouseSensitivity * adsScale;
    const friction = Number.isFinite(touchAimFrictionScale)
      ? Math.max(0.45, Math.min(1.0, touchAimFrictionScale))
      : 1.0;
    const touchYawSens = 0.0135 * (this.settings.touchSensitivity ?? 1.15) * adsScale * friction;
    const touchPitchSens = 0.0095 * (this.settings.touchSensitivity ?? 1.15) * adsScale * friction;

    const rawTouchDx = this.virtualLookDeltaX * touchYawSens;
    const rawTouchDy = this.virtualLookDeltaY * touchPitchSens;
    this.virtualLookDeltaX = 0;
    this.virtualLookDeltaY = 0;

    const smoothAlpha = Math.max(0, Math.min(0.6, this.settings.touchLookSmoothing ?? 0));
    let touchDx = rawTouchDx;
    let touchDy = rawTouchDy;
    if (smoothAlpha > 0.001) {
      // Frame-rate-independent exponential smoothing anchored to 60Hz reference alpha
      const frameAlpha = Math.pow(smoothAlpha, safeDt * 60);
      this.smoothedTouchLookX = rawTouchDx * (1 - frameAlpha) + this.smoothedTouchLookX * frameAlpha;
      this.smoothedTouchLookY = rawTouchDy * (1 - frameAlpha) + this.smoothedTouchLookY * frameAlpha;
      if (rawTouchDx === 0 && Math.abs(this.smoothedTouchLookX) < 1e-5) {
        this.smoothedTouchLookX = 0;
      }
      if (rawTouchDy === 0 && Math.abs(this.smoothedTouchLookY) < 1e-5) {
        this.smoothedTouchLookY = 0;
      }
      touchDx = this.smoothedTouchLookX;
      touchDy = this.smoothedTouchLookY;
    } else {
      this.smoothedTouchLookX = 0;
      this.smoothedTouchLookY = 0;
    }

    let dx = this.mouseDeltaX * baseSens + touchDx;
    let dy = this.mouseDeltaY * baseSens + touchDy;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    if (this.settings.gamepadEnabled) {
      const gp = this.getGamepad();
      if (gp && gp.axes.length >= 4) {
        const rx = Math.abs(gp.axes[2]) > 0.14 ? gp.axes[2] : 0;
        const ry = Math.abs(gp.axes[3]) > 0.14 ? gp.axes[3] : 0;
        // 2.7 rad/s at full deflection == 0.045 rad per 60Hz tick
        const stickScale = 2.7 * safeDt * this.settings.mouseSensitivity * adsScale;
        dx += rx * stickScale;
        dy += ry * stickScale;
      }
    }

    if (this.settings.invertY) dy = -dy;
    return { yawDelta: dx, pitchDelta: dy };
  }

  getMoveAxes(): { forward: number; right: number } {
    let forward =
      (this.isActionHeld('forward') ? 1 : 0) -
      (this.isActionHeld('backward') ? 1 : 0) +
      this.virtualMoveForward;
    let right =
      (this.isActionHeld('right') ? 1 : 0) -
      (this.isActionHeld('left') ? 1 : 0) +
      this.virtualMoveRight;

    if (this.settings.gamepadEnabled) {
      const gp = this.getGamepad();
      if (gp && gp.axes.length >= 2) {
        if (Math.abs(gp.axes[1]) > 0.16) forward -= gp.axes[1];
        if (Math.abs(gp.axes[0]) > 0.16) right += gp.axes[0];
      }
    }

    const len = Math.hypot(forward, right);
    if (len > 1) {
      forward /= len;
      right /= len;
    }
    return { forward, right };
  }

  /**
   * Authoritative normalized vehicle controls shared by Desktop (W/S/A/D/Space) and
   * Mobile PUBG-inspired driving HUD (Gas, Brake/Rev, Steer Left/Right or Wheel, Handbrake).
   * Completely independent of camera look deltas.
   */
  getVehicleControls(): VehicleControlInput {
    const keyGas = this.isActionHeld('forward') ? 1 : 0;
    const keyBrakeRev = this.isActionHeld('backward') ? 1 : 0;
    const keySteer =
      (this.isActionHeld('right') ? 1 : 0) - (this.isActionHeld('left') ? 1 : 0);
    const keyHandbrake = this.isActionHeld('handbrake') || this.heldKeys.has('Space');

    const buttonSteer =
      (this.virtualVehicleSteerRight ? 1 : 0) - (this.virtualVehicleSteerLeft ? 1 : 0);

    // Support both dedicated vehicle pedals/buttons and fallback virtualMoveAxes
    const fallbackGas = Math.max(0, this.virtualMoveForward);
    const fallbackBrake = Math.max(0, -this.virtualMoveForward);

    let gas = Math.max(keyGas, this.virtualVehicleGas, fallbackGas);
    let brakeReverse = Math.max(keyBrakeRev, this.virtualVehicleBrakeReverse, fallbackBrake);
    let steer =
      keySteer !== 0
        ? keySteer
        : buttonSteer !== 0
          ? buttonSteer
          : Math.abs(this.virtualVehicleSteerWheel) > 0.01
            ? this.virtualVehicleSteerWheel
            : this.virtualMoveRight;

    if (this.settings.gamepadEnabled) {
      const gp = this.getGamepad();
      if (gp && gp.axes.length >= 2) {
        if (gp.axes[1] < -0.16) gas = Math.max(gas, -gp.axes[1]);
        if (gp.axes[1] > 0.16) brakeReverse = Math.max(brakeReverse, gp.axes[1]);
        if (Math.abs(gp.axes[0]) > 0.16) steer = gp.axes[0];
      }
    }

    return {
      gas: Math.max(0, Math.min(1, gas)),
      brakeReverse: Math.max(0, Math.min(1, brakeReverse)),
      steer: Math.max(-1, Math.min(1, steer)),
      handbrake: Boolean(keyHandbrake || this.virtualVehicleHandbrake),
    };
  }

  consumeWheelDelta(): number {
    const d = this.wheelDelta + this.queuedWeaponDelta;
    this.wheelDelta = 0;
    this.queuedWeaponDelta = 0;
    return d;
  }

  endFrame(): void {
    this.justPressedKeys.clear();
    this.justPressedMouse.clear();
    this.virtualJustPressedActions.clear();
    if (this.settings.gamepadEnabled) {
      const gp = this.getGamepad();
      this.prevGamepadButtons.clear();
      if (gp) {
        gp.buttons.forEach((b, idx) => {
          if (b.pressed) this.prevGamepadButtons.add(idx);
        });
      }
    }
  }

  clearAllInputs = (): void => {
    this.heldKeys.clear();
    this.justPressedKeys.clear();
    this.mouseButtons.clear();
    this.justPressedMouse.clear();
    this.canvasDragActive = false;
    this.virtualHeldActions.clear();
    this.virtualJustPressedActions.clear();
    this.virtualMoveForward = 0;
    this.virtualMoveRight = 0;
    this.virtualLookDeltaX = 0;
    this.virtualLookDeltaY = 0;
    this.smoothedTouchLookX = 0;
    this.smoothedTouchLookY = 0;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;
    this.queuedWeaponDelta = 0;
    this.queuedWeaponSlot = null;
    this.clearVirtualVehicleInputs();
    this.virtualResetListeners.forEach((cb) => {
      try {
        cb();
      } catch {
        // Ignore listener errors
      }
    });
  };

  private getGamepad(): Gamepad | null {
    try {
      const pads = navigator.getGamepads?.();
      if (!pads) return null;
      for (const pad of pads) {
        if (pad && pad.connected) return pad;
      }
      return null;
    } catch {
      return null;
    }
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    const code = normalizeKeyCode(e);
    if (!code) return;
    if (code === 'Escape') {
      this.onEscapeRequested?.();
      return;
    }
    this.lastInputDevice = 'keyboard';
    if (!this.heldKeys.has(code)) {
      this.justPressedKeys.add(code);
    }
    this.heldKeys.add(code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    const code = normalizeKeyCode(e);
    if (!code) return;
    this.heldKeys.delete(code);
  };

  private isCanvasGameplayTarget(target: EventTarget | null): boolean {
    if (!this.canvasEl || !target) return false;
    if (this.isGameplayActive && !this.isGameplayActive()) return false;
    return target === this.canvasEl || (target instanceof Node && this.canvasEl.contains(target));
  }

  private handleMouseMove = (e: MouseEvent): void => {
    if (this.pointerLocked) {
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
      if (mx === 0 && my === 0) return;

      // Discard OS/compositor pointer-lock warp jumps (e.g. cursor resetting from button coords to origin)
      if (this.ignoreNextLargeLockedWarp) {
        this.ignoreNextLargeLockedWarp = false;
        if (Math.hypot(mx, my) > 36) {
          return;
        }
      }
      if (Math.abs(mx) > 450 || Math.abs(my) > 450) {
        return;
      }

      this.lastInputDevice = 'keyboard';
      this.mouseDeltaX += mx;
      this.mouseDeltaY += my;
      return;
    }

    // Sandboxed iframe / unlocked-cursor fallback: smooth drag-to-aim while holding mouse on the 3D canvas
    if (!this.canvasDragActive) return;
    if (this.isGameplayActive && !this.isGameplayActive()) {
      this.canvasDragActive = false;
      return;
    }
    const rawDx =
      typeof e.clientX === 'number' && Number.isFinite(e.clientX)
        ? e.clientX - this.lastDragClientX
        : e.movementX || 0;
    const rawDy =
      typeof e.clientY === 'number' && Number.isFinite(e.clientY)
        ? e.clientY - this.lastDragClientY
        : e.movementY || 0;
    if (typeof e.clientX === 'number' && Number.isFinite(e.clientX)) {
      this.lastDragClientX = e.clientX;
    }
    if (typeof e.clientY === 'number' && Number.isFinite(e.clientY)) {
      this.lastDragClientY = e.clientY;
    }
    if (!Number.isFinite(rawDx) || !Number.isFinite(rawDy)) return;
    if (rawDx === 0 && rawDy === 0) return;
    if (Math.abs(rawDx) > 220 || Math.abs(rawDy) > 220) return;

    this.lastInputDevice = 'keyboard';
    this.mouseDeltaX += rawDx * 1.45;
    this.mouseDeltaY += rawDy * 1.45;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (this.pointerLocked) {
      this.lastInputDevice = 'keyboard';
      if (!this.mouseButtons.has(e.button)) {
        this.justPressedMouse.add(e.button);
      }
      this.mouseButtons.add(e.button);
      return;
    }

    // Free-cursor canvas interaction fallback (critical inside sandboxed preview iframes)
    if (!this.isCanvasGameplayTarget(e.target)) return;
    this.lastInputDevice = 'keyboard';
    this.canvasDragActive = true;
    this.lastDragClientX = e.clientX;
    this.lastDragClientY = e.clientY;
    if (e.button === 0 || e.button === 2) {
      if (!this.mouseButtons.has(e.button)) {
        this.justPressedMouse.add(e.button);
      }
      this.mouseButtons.add(e.button);
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    this.mouseButtons.delete(e.button);
    if (this.mouseButtons.size === 0) {
      this.canvasDragActive = false;
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.pointerLocked && !this.isCanvasGameplayTarget(e.target)) return;
    this.lastInputDevice = 'keyboard';
    this.wheelDelta += Math.sign(e.deltaY);
  };
}
