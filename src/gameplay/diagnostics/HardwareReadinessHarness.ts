import {
  PlaytestExperienceReport,
  PlaytestFrictionFinding,
} from '@/src/gameplay/diagnostics/PlaytestTelemetrySummary';

export type HardwareProfileCategory =
  | 'desktop_dgpu'
  | 'desktop_igpu'
  | 'android_chrome'
  | 'ios_safari'
  | 'unknown';

export type ReleaseCandidateDeviceId =
  | 'desktop_igpu'
  | 'desktop_dgpu'
  | 'desktop_high_gpu'
  | 'android_chrome'
  | 'ios_safari';

export type PlatformVerificationStatus =
  | 'NOT_RUN_HEADLESS'
  | 'PASS_ON_HARDWARE'
  | 'FAIL_ON_HARDWARE';

export interface ReleaseCandidatePlatformEntry {
  deviceId: ReleaseCandidateDeviceId;
  label: string;
  targetFps: number;
  status: PlatformVerificationStatus;
  observedP95Ms: number | null;
  note: string;
  updatedAtIso: string | null;
}

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
  schemaVersion: 2;
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
  platformChecklist: ReleaseCandidatePlatformEntry[];
  latestPlaytestSummary: {
    missionId: number;
    outcome: 'victory' | 'defeat' | 'abandoned';
    durationSec: number;
    squadCommandsIssued: number;
    avgCommandLatencyMs: number;
    squadDownedEvents: number;
    frictionFindings: PlaytestFrictionFinding[];
  } | null;
}

const MAX_FRAME_SAMPLES = 300;
const MAX_FEEDBACK_ENTRIES = 20;

function createInitialPlatformChecklist(): ReleaseCandidatePlatformEntry[] {
  return [
    {
      deviceId: 'desktop_igpu',
      label: 'Desktop Browser (Integrated GPU)',
      targetFps: 45,
      status: 'NOT_RUN_HEADLESS',
      observedP95Ms: null,
      note: 'Requires physical desktop iGPU browser validation (not proven by headless check).',
      updatedAtIso: null,
    },
    {
      deviceId: 'desktop_dgpu',
      label: 'Desktop Browser (Dedicated GPU)',
      targetFps: 60,
      status: 'NOT_RUN_HEADLESS',
      observedP95Ms: null,
      note: 'Requires physical desktop dGPU browser validation (not proven by headless check).',
      updatedAtIso: null,
    },
    {
      deviceId: 'desktop_high_gpu',
      label: 'Desktop Browser (High-Performance GPU)',
      targetFps: 60,
      status: 'NOT_RUN_HEADLESS',
      observedP95Ms: null,
      note: 'Requires physical high-refresh / 4K GPU validation (not proven by headless check).',
      updatedAtIso: null,
    },
    {
      deviceId: 'android_chrome',
      label: 'Mobile Android Chrome (Landscape Touch)',
      targetFps: 30,
      status: 'NOT_RUN_HEADLESS',
      observedP95Ms: null,
      note: 'Requires physical Android multitouch + thermal + audio resume check.',
      updatedAtIso: null,
    },
    {
      deviceId: 'ios_safari',
      label: 'Mobile iOS Safari (Landscape Touch)',
      targetFps: 30,
      status: 'NOT_RUN_HEADLESS',
      observedP95Ms: null,
      note: 'Requires physical iOS WebAudio unlock, safe-area & orientation resume check.',
      updatedAtIso: null,
    },
  ];
}

/**
 * TRN-42 + TRN-49 Bounded Local Hardware Readiness & Release Candidate Verification Harness.
 * - Zero PII: never collects emails, IP addresses, user names, or raw user-agent identifiers.
 * - Fixed-size 300-frame ring buffer guarantees zero heap growth over long sessions.
 * - Strictly separates automated headless checks from physical device hardware sign-off.
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
  private platformChecklist: ReleaseCandidatePlatformEntry[] = createInitialPlatformChecklist();
  private latestPlaytestSummary: HardwareReadinessSnapshot['latestPlaytestSummary'] = null;

  reset(): void {
    this.frameRing.fill(0);
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.squadPathStallCount = 0;
    this.touchOverlapCount = 0;
    this.feedbackEntries.length = 0;
    this.platformChecklist = createInitialPlatformChecklist();
    this.latestPlaytestSummary = null;
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

  setPlatformChecklistStatus(
    deviceId: ReleaseCandidateDeviceId,
    status: PlatformVerificationStatus,
    note?: string,
    observedP95Ms?: number | null
  ): void {
    const entry = this.platformChecklist.find((e) => e.deviceId === deviceId);
    if (!entry) return;
    entry.status = status;
    if (typeof note === 'string') {
      entry.note = note
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]')
        .trim()
        .slice(0, 200);
    }
    if (observedP95Ms !== undefined) {
      entry.observedP95Ms =
        observedP95Ms !== null && Number.isFinite(observedP95Ms)
          ? Number(observedP95Ms.toFixed(2))
          : null;
    }
    entry.updatedAtIso = new Date().toISOString();
  }

  setLatestPlaytestReport(
    report: PlaytestExperienceReport,
    frictionFindings: PlaytestFrictionFinding[]
  ): void {
    this.latestPlaytestSummary = {
      missionId: report.missionId,
      outcome: report.outcome,
      durationSec: report.durationSec,
      squadCommandsIssued: report.squadCommandsIssued,
      avgCommandLatencyMs: report.avgCommandLatencyMs,
      squadDownedEvents: report.squadDownedEvents,
      frictionFindings: frictionFindings.map((f) => ({ ...f })),
    };
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
      schemaVersion: 2,
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
      platformChecklist: this.platformChecklist.map((p) => ({ ...p })),
      latestPlaytestSummary: this.latestPlaytestSummary
        ? {
            ...this.latestPlaytestSummary,
            frictionFindings: this.latestPlaytestSummary.frictionFindings.map((f) => ({ ...f })),
          }
        : null,
    };
  }

  exportMarkdownReport(
    verificationMode: 'interactive_browser_session' | 'headless_automated_check' = 'interactive_browser_session'
  ): string {
    const snap = this.buildSnapshot(verificationMode);
    const lines = [
      '# VANGUARD: ZERO HOUR — Stage 8 Release Candidate & Hardware QA Report',
      '',
      `- **Verification Mode:** ${snap.verificationMode}`,
      `- **Contains PII:** ${snap.containsPii ? 'Yes' : 'No (zero-PII sanitized)'}`,
      `- **Viewport:** ${snap.viewport.width}x${snap.viewport.height} @ ${snap.viewport.devicePixelRatio}x (${snap.viewport.orientation}, touch=${snap.viewport.isTouchCapable})`,
      `- **Graphics:** ${snap.gpuSummary.rendererLabel} (WebGL2=${snap.gpuSummary.webgl2Supported}, WebGPU=${snap.gpuSummary.webgpuAvailable})`,
      `- **Frame Time (ms):** P50=${snap.frameTimePercentilesMs.p50} | P95=${snap.frameTimePercentilesMs.p95} | P99=${snap.frameTimePercentilesMs.p99} | Max=${snap.frameTimePercentilesMs.max} (n=${snap.frameTimePercentilesMs.sampleCount})`,
      `- **Squad Path Stalls:** ${snap.squadPathStallCount}`,
      `- **Mobile Touch Overlaps Detected:** ${snap.touchOverlapCount}`,
      '',
      '## Physical Hardware Verification Matrix (Explicit Separation from Headless Checks)',
    ];

    for (const p of snap.platformChecklist) {
      const p95Text = p.observedP95Ms !== null ? ` (P95=${p.observedP95Ms}ms)` : '';
      lines.push(`- **${p.label}**: \`${p.status}\`${p95Text} — ${p.note}`);
    }

    lines.push('', '## Latest Local Playtest Friction Diagnostics (Read-Only)');
    if (!snap.latestPlaytestSummary) {
      lines.push('- No mission playtest telemetry recorded in this session yet.');
    } else {
      const lp = snap.latestPlaytestSummary;
      lines.push(
        `- Mission ${lp.missionId} (${lp.outcome}, ${lp.durationSec}s): ${lp.squadCommandsIssued} squad commands (avg ${lp.avgCommandLatencyMs}ms), ${lp.squadDownedEvents} squad downs.`
      );
      for (const f of lp.frictionFindings) {
        lines.push(`  - [${f.severity.toUpperCase()} / ${f.area}] ${f.summary} -> ${f.recommendation}`);
      }
    }

    lines.push('', '## Human Playtest Ratings');
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
