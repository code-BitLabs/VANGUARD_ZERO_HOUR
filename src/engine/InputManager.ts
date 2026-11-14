import { ResourceManager } from '@/src/core/ResourceManager';
import { ControlBindings, InputSettings } from '@/src/schemas/settings.schema';

export type InputAction = keyof ControlBindings;

export class InputManager {
  private heldKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  private mouseButtons = new Set<number>();
  private justPressedMouse = new Set<number>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private wheelDelta = 0;
  private pointerLocked = false;
  private attached = false;
  private prevGamepadButtons = new Set<number>();

  constructor(
    private readonly resourceManager: ResourceManager,
    private settings: InputSettings,
    private readonly onPointerLockChange?: (locked: boolean) => void,
    private readonly onEscapeRequested?: () => void
  ) {}

  attach(canvas: HTMLElement): void {
    if (this.attached) return;
    this.attached = true;

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
      'pointerlockchange',
      () => {
        this.pointerLocked = document.pointerLockElement === canvas;
        if (!this.pointerLocked) {
          this.clearAllInputs();
        }
        this.onPointerLockChange?.(this.pointerLocked);
      },
      'shared'
    );
  }

  updateSettings(settings: InputSettings): void {
    this.settings = settings;
  }

  requestPointerLock(canvas: HTMLElement): void {
    try {
      canvas.requestPointerLock?.();
    } catch {
      // Ignore sandboxed pointer lock rejections
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

  isActionHeld(action: InputAction): boolean {
    const code = this.settings.bindings[action];
    if (this.heldKeys.has(code)) return true;
    if (this.settings.gamepadEnabled) {
      const gp = this.getGamepad();
      if (gp) {
        if (action === 'sprint' && gp.buttons[10]?.pressed) return true;
        if (action === 'crouch' && gp.buttons[1]?.pressed) return true;
        if (action === 'jump' && gp.buttons[0]?.pressed) return true;
      }
    }
    return false;
  }

  wasActionPressed(action: InputAction): boolean {
    const code = this.settings.bindings[action];
    if (this.justPressedKeys.has(code)) return true;
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
        const btnIdx = map[action];
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
    return this.justPressedMouse.has(button);
  }

  consumeLookDelta(isAds: boolean): { yawDelta: number; pitchDelta: number } {
    const baseSens = 0.0022 * this.settings.mouseSensitivity * (isAds ? this.settings.adsSensitivity : 1.0);
    let dx = this.mouseDeltaX * baseSens;
    let dy = this.mouseDeltaY * baseSens;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    if (this.settings.gamepadEnabled) {
      const gp = this.getGamepad();
      if (gp && gp.axes.length >= 4) {
        const rx = Math.abs(gp.axes[2]) > 0.14 ? gp.axes[2] : 0;
        const ry = Math.abs(gp.axes[3]) > 0.14 ? gp.axes[3] : 0;
        dx += rx * 0.045 * this.settings.mouseSensitivity;
        dy += ry * 0.045 * this.settings.mouseSensitivity;
      }
    }

    if (this.settings.invertY) dy = -dy;
    return { yawDelta: dx, pitchDelta: dy };
  }

  getMoveAxes(): { forward: number; right: number } {
    let forward = (this.isActionHeld('forward') ? 1 : 0) - (this.isActionHeld('backward') ? 1 : 0);
    let right = (this.isActionHeld('right') ? 1 : 0) - (this.isActionHeld('left') ? 1 : 0);

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

  consumeWheelDelta(): number {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }

  endFrame(): void {
    this.justPressedKeys.clear();
    this.justPressedMouse.clear();
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
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;
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
    if (e.code === 'Escape') {
      this.onEscapeRequested?.();
      return;
    }
    if (!this.heldKeys.has(e.code)) {
      this.justPressedKeys.add(e.code);
    }
    this.heldKeys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDeltaX += e.movementX || 0;
    this.mouseDeltaY += e.movementY || 0;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    if (!this.mouseButtons.has(e.button)) {
      this.justPressedMouse.add(e.button);
    }
    this.mouseButtons.add(e.button);
  };

  private handleMouseUp = (e: MouseEvent): void => {
    this.mouseButtons.delete(e.button);
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.pointerLocked) return;
    this.wheelDelta += Math.sign(e.deltaY);
  };
}
