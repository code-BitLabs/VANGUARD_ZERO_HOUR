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
  private lastTimeMs = 0;
  private accumulator = 0;
  private uiAccumulator = 0;
  private readonly uiInterval = 1 / 18; // ~18 Hz throttled HUD telemetry

  constructor(private readonly callbacks: GameLoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.lastTimeMs = performance.now();
      this.accumulator = 0;
    }
  }

  private tick = (nowMs: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const frameStart = performance.now();
    const rawDt = Math.min(Math.max((nowMs - this.lastTimeMs) * 0.001, 0), this.maxRawDt);
    this.lastTimeMs = nowMs;

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
  };
}
