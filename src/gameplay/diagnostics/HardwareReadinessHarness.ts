export type HardwareProfileCategory =
  | 'desktop_dgpu'
  | 'desktop_igpu'
  | 'android_chrome'
  | 'ios_safari'
  | 'unknown';

export interface PlaytestFeedbackSubmission {
  deviceCategory: HardwareProfileCategory;
  controlsRating: number; // 1..5
  squadResponsivenessRating: number; // 1..5
  loadoutClarityRating: number; // 1..5
  readabilityRating: number; // 1..5
  performanceRating: number; // 1..5
  notes: string;
  recordedAtIso: string;
}

export interface HardwareReadinessSnapshot {
  schemaVersion: 1;
  /** Strictly truthful verification provenance: never claims physical device sign-off from emulation */
  verificationMode: 'interactive_browser_session' | 'headless_automated_check';
  containsPii: false;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
    isTouchCapable: boolean;
    orientation: 'landscape' | 'portrait';
  };
  gpuSummary: {
    rendererLabel: string;
    webgl2Supported: boolean;
    webgpuAvailable: boolean;
  };
  frameTimePercentilesMs: {
    sampleCount: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  squadPathStallCount: number;
  touchOverlapCount: number;
  feedbackEntries: PlaytestFeedbackSubmission[];
}

const MAX_FRAME_SAMPLES = 300;
const MAX_FEEDBACK_ENTRIES = 20;

/**
 * TRN-42 Bounded Local Hardware Readiness & Playtest Feedback Harness.
 * - Zero PII: never collects emails, IP addresses, user names, or raw user-agent identifiers.
 * - Fixed-size 300-frame ring buffer guarantees zero heap growth over long sessions.
 * - Produces structured JSON and Markdown QA reports for human physical-device runs.
 */
export class HardwareReadinessHarness {
  private readonly frameRing = new Float32Array(MAX_FRAME_SAMPLES);
  private writeIndex = 0;
  private sampleCount = 0;
  private squadPathStallCount = 0;
  private touchOverlapCount = 0;
  private rendererLabel = 'Unspecified WebGL Renderer';
  private webgl2Supported = false;
  private webgpuAvailable = false;
  private readonly feedbackEntries: PlaytestFeedbackSubmission[] = [];

  reset(): void {
    this.frameRing.fill(0);
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.squadPathStallCount = 0;
    this.touchOverlapCount = 0;
    this.feedbackEntries.length = 0;
  }

  recordFrameTimeMs(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs < 0) return;
    this.frameRing[this.writeIndex] = Math.min(frameMs, 250);
    this.writeIndex = (this.writeIndex + 1) % MAX_FRAME_SAMPLES;
    if (this.sampleCount < MAX_FRAME_SAMPLES) {
      this.sampleCount++;
    }
  }

  setGpuSummary(rendererLabel: string, webgl2Supported: boolean, webgpuAvailable: boolean): void {
    // Strip any accidental long strings; keep bounded generic hardware string only
    this.rendererLabel = rendererLabel.slice(0, 80);
    this.webgl2Supported = webgl2Supported;
    this.webgpuAvailable = webgpuAvailable;
  }

  recordSquadPathStall(): void {
    this.squadPathStallCount++;
  }

  setTouchOverlapCount(count: number): void {
    this.touchOverlapCount = Math.max(0, Math.floor(count));
  }

  addPlaytestFeedback(entry: Omit<PlaytestFeedbackSubmission, 'recordedAtIso'>): PlaytestFeedbackSubmission {
    const clampRating = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
    // Strip potential email-like patterns from free-text notes to enforce strict zero-PII export
    const sanitizedNotes = entry.notes
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]')
      .trim()
      .slice(0, 400);

    const record: PlaytestFeedbackSubmission = {
      deviceCategory: entry.deviceCategory,
      controlsRating: clampRating(entry.controlsRating),
      squadResponsivenessRating: clampRating(entry.squadResponsivenessRating),
      loadoutClarityRating: clampRating(entry.loadoutClarityRating),
      readabilityRating: clampRating(entry.readabilityRating),
      performanceRating: clampRating(entry.performanceRating),
      notes: sanitizedNotes,
      recordedAtIso: new Date().toISOString(),
    };

    this.feedbackEntries.unshift(record);
    if (this.feedbackEntries.length > MAX_FEEDBACK_ENTRIES) {
      this.feedbackEntries.length = MAX_FEEDBACK_ENTRIES;
    }
    return record;
  }

  getPercentiles(): { sampleCount: number; p50: number; p95: number; p99: number; max: number } {
    if (this.sampleCount === 0) {
      return { sampleCount: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    }
    const sorted = Array.from(this.frameRing.subarray(0, this.sampleCount)).sort((a, b) => a - b);
    const pick = (q: number) => {
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
      return Number(sorted[idx].toFixed(2));
    };
    return {
      sampleCount: this.sampleCount,
      p50: pick(0.5),
      p95: pick(0.95),
      p99: pick(0.99),
      max: Number(sorted[sorted.length - 1].toFixed(2)),
    };
  }

  buildSnapshot(
    verificationMode: 'interactive_browser_session' | 'headless_automated_check' = 'interactive_browser_session'
  ): HardwareReadinessSnapshot {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const h = typeof window !== 'undefined' ? window.innerHeight : 720;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const isTouch =
      typeof navigator !== 'undefined' ? (navigator.maxTouchPoints ?? 0) > 0 : false;

    return {
      schemaVersion: 1,
      verificationMode,
      containsPii: false,
      viewport: {
        width: w,
        height: h,
        devicePixelRatio: Number(dpr.toFixed(2)),
        isTouchCapable: isTouch,
        orientation: w >= h ? 'landscape' : 'portrait',
      },
      gpuSummary: {
        rendererLabel: this.rendererLabel,
        webgl2Supported: this.webgl2Supported,
        webgpuAvailable: this.webgpuAvailable,
      },
      frameTimePercentilesMs: this.getPercentiles(),
      squadPathStallCount: this.squadPathStallCount,
      touchOverlapCount: this.touchOverlapCount,
      feedbackEntries: this.feedbackEntries.map((f) => ({ ...f })),
    };
  }

  exportMarkdownReport(
    verificationMode: 'interactive_browser_session' | 'headless_automated_check' = 'interactive_browser_session'
  ): string {
    const snap = this.buildSnapshot(verificationMode);
    const lines = [
      '# VANGUARD: ZERO HOUR — Hardware & Playtest QA Report (TRN-42)',
      '',
      `- **Verification Mode:** ${snap.verificationMode}`,
      `- **Contains PII:** ${snap.containsPii ? 'Yes' : 'No (zero-PII sanitized)'}`,
      `- **Viewport:** ${snap.viewport.width}x${snap.viewport.height} @ ${snap.viewport.devicePixelRatio}x (${snap.viewport.orientation}, touch=${snap.viewport.isTouchCapable})`,
      `- **Graphics:** ${snap.gpuSummary.rendererLabel} (WebGL2=${snap.gpuSummary.webgl2Supported}, WebGPU=${snap.gpuSummary.webgpuAvailable})`,
      `- **Frame Time (ms):** P50=${snap.frameTimePercentilesMs.p50} | P95=${snap.frameTimePercentilesMs.p95} | P99=${snap.frameTimePercentilesMs.p99} | Max=${snap.frameTimePercentilesMs.max} (n=${snap.frameTimePercentilesMs.sampleCount})`,
      `- **Squad Path Stalls:** ${snap.squadPathStallCount}`,
      `- **Mobile Touch Overlaps Detected:** ${snap.touchOverlapCount}`,
      '',
      '## Human Playtest Ratings',
    ];
    if (snap.feedbackEntries.length === 0) {
      lines.push('- No human playtest ratings logged in this session yet.');
    } else {
      for (const f of snap.feedbackEntries) {
        lines.push(
          `- [${f.deviceCategory}] Controls ${f.controlsRating}/5 · Squad ${f.squadResponsivenessRating}/5 · Loadout ${f.loadoutClarityRating}/5 · Readability ${f.readabilityRating}/5 · Perf ${f.performanceRating}/5 — ${f.notes || 'No notes'}`
        );
      }
    }
    return lines.join('\n');
  }
}

export const hardwareReadinessHarness = new HardwareReadinessHarness();
