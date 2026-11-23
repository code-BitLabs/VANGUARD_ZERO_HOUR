export interface GameLoopCallbacks {
  sampleInput: () => void;
  fixedStep: (fixedDt: number) => void;
  scheduleAI: (dt: number) => void;
  updateAnimationAndVfx: (dt: number, alpha: number) => void;
  updateAudio: (dt: number) => void;
  render: (dt: number, alpha: number) => void;
  publishUiSnapshot: () => void;
  onFrameMeasured: (frameMs: number, rawDt: number) => void;
}

export class GameLoop {
  private readonly fixedDt = 1 / 60;
  private readonly maxRawDt = 0.05;
  private readonly maxSubsteps = 4;

  private running = false;
  private paused = false;
  private rafId = 0;
  private paceTimeoutId = 0;
  private softwareGlPacing = false;
  private softwareGlCtx: WebGL2RenderingContext | null = null;
  private pendingSync: WebGLSync | null = null;
  private lastTimeMs = 0;
  private lastRenderTickMs = 0;
  private fpsCap: 0 | 30 | 60 | 120 = 0;
  private accumulator = 0;
  private uiAccumulator = 0;
  private readonly uiInterval = 1 / 18; // ~18 Hz throttled HUD telemetry

  constructor(private readonly callbacks: GameLoopCallbacks) {}

  setFpsCap(fpsCap: 0 | 30 | 60 | 120): void {
    this.fpsCap = fpsCap;
  }

  setSoftwareGlPacing(enabled: boolean): void {
    this.softwareGlPacing = enabled;
    if (!enabled) {
      this.clearPendingSync();
    }
  }

  /**
   * Optional WebGL2 context hook for non-blocking fenceSync GPU-completion pacing on SwiftShader/llvmpipe.
   */
  setSoftwareGlSyncContext(gl: WebGLRenderingContext | WebGL2RenderingContext | null): void {
    this.clearPendingSync();
    if (
      gl &&
      'fenceSync' in gl &&
      typeof gl.fenceSync === 'function' &&
      'clientWaitSync' in gl &&
      typeof gl.clientWaitSync === 'function'
    ) {
      this.softwareGlCtx = gl as WebGL2RenderingContext;
    } else {
      this.softwareGlCtx = null;
    }
  }

  private clearPendingSync(): void {
    if (this.pendingSync && this.softwareGlCtx) {
      try {
        this.softwareGlCtx.deleteSync(this.pendingSync);
      } catch {
        // ignore lost context
      }
    }
    this.pendingSync = null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = performance.now();
    this.lastRenderTickMs = 0;
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    this.clearPendingSync();
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.paceTimeoutId) {
      window.clearTimeout(this.paceTimeoutId);
      this.paceTimeoutId = 0;
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.lastTimeMs = performance.now();
      this.accumulator = 0;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if (!this.softwareGlPacing) {
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    const gl = this.softwareGlCtx;
    if (gl && !gl.isContextLost()) {
      this.clearPendingSync();
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (sync) {
        gl.flush();
        this.pendingSync = sync;
        const waitStart = performance.now();
        const pollSync = (): void => {
          if (!this.running || this.pendingSync !== sync) return;
          const status = gl.clientWaitSync(sync, 0, 0);
          const timedOut = performance.now() - waitStart >= 80;
          if (
            status === gl.ALREADY_SIGNALED ||
            status === gl.CONDITION_SATISFIED ||
            status === gl.WAIT_FAILED ||
            timedOut
          ) {
            this.clearPendingSync();
            this.rafId = requestAnimationFrame(this.tick);
            return;
          }
          this.paceTimeoutId = window.setTimeout(() => {
            this.paceTimeoutId = 0;
            pollSync();
          }, 8);
        };
        this.paceTimeoutId = window.setTimeout(() => {
          this.paceTimeoutId = 0;
          pollSync();
        }, 8);
        return;
      }
    }

    this.paceTimeoutId = window.setTimeout(() => {
      this.paceTimeoutId = 0;
      if (this.running) {
        this.rafId = requestAnimationFrame(this.tick);
      }
    }, 28);
  }

  /**
   * Executes one deterministic frame tick. Exposed for automated 30/60/120/144Hz parity tests.
   */
  public stepFrameForTest(rawDtSec: number, simulatedWorkMs = 0): void {
    const rawDt = Math.min(Math.max(rawDtSec, 0), this.maxRawDt);
    let alpha = 1;
    if (!this.paused) {
      this.accumulator += rawDt;
      let substeps = 0;
      if (this.accumulator >= this.fixedDt) {
        // Sample discrete edge-triggered actions ONLY on frames that consume them via fixedStep
        // (prevents double-triggering on 120/144Hz substeps===0 frames and preserves presses until fixedStep).
        this.callbacks.sampleInput();
      }
      while (this.accumulator >= this.fixedDt && substeps < this.maxSubsteps) {
        this.callbacks.fixedStep(this.fixedDt);
        this.accumulator -= this.fixedDt;
        substeps++;
      }
      if (substeps === this.maxSubsteps) {
        this.accumulator = 0;
      }

      this.callbacks.scheduleAI(rawDt);

      alpha = this.accumulator / this.fixedDt;
      this.callbacks.updateAnimationAndVfx(rawDt, alpha);
      this.callbacks.updateAudio(rawDt);

      this.uiAccumulator += rawDt;
      if (this.uiAccumulator >= this.uiInterval) {
        this.uiAccumulator = 0;
        this.callbacks.publishUiSnapshot();
      }
    }

    this.callbacks.render(rawDt, alpha);
    this.callbacks.onFrameMeasured(simulatedWorkMs, rawDt);
  }

  private tick = (nowMs: number): void => {
    if (!this.running) return;
    if (!this.softwareGlPacing) {
      this.rafId = requestAnimationFrame(this.tick);
    }

    if (this.fpsCap > 0 && this.lastRenderTickMs > 0) {
      const minIntervalMs = 1000 / this.fpsCap - 1.2;
      if (nowMs - this.lastRenderTickMs < minIntervalMs) {
        if (this.softwareGlPacing) this.scheduleNext();
        return;
      }
    }
    this.lastRenderTickMs = nowMs;

    const frameStart = performance.now();
    const rawDt = Math.min(Math.max((nowMs - this.lastTimeMs) * 0.001, 0), this.maxRawDt);
    this.lastTimeMs = nowMs;

    try {
      let alpha = 1;
      if (!this.paused) {
        this.accumulator += rawDt;
        let substeps = 0;
        if (this.accumulator >= this.fixedDt) {
          this.callbacks.sampleInput();
        }
        while (this.accumulator >= this.fixedDt && substeps < this.maxSubsteps) {
          this.callbacks.fixedStep(this.fixedDt);
          this.accumulator -= this.fixedDt;
          substeps++;
        }
        if (substeps === this.maxSubsteps) {
          this.accumulator = 0;
        }

        this.callbacks.scheduleAI(rawDt);

        alpha = this.accumulator / this.fixedDt;
        this.callbacks.updateAnimationAndVfx(rawDt, alpha);
        this.callbacks.updateAudio(rawDt);

        this.uiAccumulator += rawDt;
        if (this.uiAccumulator >= this.uiInterval) {
          this.uiAccumulator = 0;
          this.callbacks.publishUiSnapshot();
        }
      }

      this.callbacks.render(rawDt, alpha);

      const elapsedMs = performance.now() - frameStart;
      this.callbacks.onFrameMeasured(elapsedMs, rawDt);
    } finally {
      if (this.softwareGlPacing && this.running) {
        this.scheduleNext();
      }
    }
  };
}
