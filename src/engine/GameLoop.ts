export interface GameLoopCallbacks {
  sampleInput: () => void;
  fixedStep: (fixedDt: number) => void;
  scheduleAI: (dt: number) => void;
  updateAnimationAndVfx: (dt: number, alpha: number) => void;
  updateAudio: (dt: number) => void;
  render: (dt: number) => void;
  publishUiSnapshot: () => void;
  onFrameMeasured: (frameMs: number) => void;
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
    if (this.softwareGlPacing) {
      this.paceTimeoutId = window.setTimeout(() => {
        this.paceTimeoutId = 0;
        if (this.running) {
          this.rafId = requestAnimationFrame(this.tick);
        }
      }, 28);
    } else {
      this.rafId = requestAnimationFrame(this.tick);
    }
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
      if (!this.paused) {
        this.callbacks.sampleInput();

        this.accumulator += rawDt;
        let substeps = 0;
        while (this.accumulator >= this.fixedDt && substeps < this.maxSubsteps) {
          this.callbacks.fixedStep(this.fixedDt);
          this.accumulator -= this.fixedDt;
          substeps++;
        }
        if (substeps === this.maxSubsteps) {
          this.accumulator = 0;
        }

        this.callbacks.scheduleAI(rawDt);

        const alpha = this.accumulator / this.fixedDt;
        this.callbacks.updateAnimationAndVfx(rawDt, alpha);
        this.callbacks.updateAudio(rawDt);

        this.uiAccumulator += rawDt;
        if (this.uiAccumulator >= this.uiInterval) {
          this.uiAccumulator = 0;
          this.callbacks.publishUiSnapshot();
        }
      }

      this.callbacks.render(rawDt);

      const elapsedMs = performance.now() - frameStart;
      this.callbacks.onFrameMeasured(elapsedMs);
    } finally {
      if (this.softwareGlPacing && this.running) {
        this.scheduleNext();
      }
    }
  };
}
