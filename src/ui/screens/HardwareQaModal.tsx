import React, { useEffect, useState } from 'react';
import { Check, ClipboardCopy, Download, MonitorCheck, Plus, X } from 'lucide-react';
import {
  HardwareProfileCategory,
  hardwareReadinessHarness,
} from '@/src/gameplay/diagnostics/HardwareReadinessHarness';
import { Button } from '@/src/ui/primitives/Button';

export interface HardwareQaModalProps {
  open: boolean;
  onClose: () => void;
  gpuRenderer?: string;
}

const DEVICE_CATEGORIES: Array<{ id: HardwareProfileCategory; label: string }> = [
  { id: 'desktop_dgpu', label: 'Desktop dGPU' },
  { id: 'desktop_igpu', label: 'Desktop iGPU' },
  { id: 'android_chrome', label: 'Android Chrome' },
  { id: 'ios_safari', label: 'iOS Safari' },
];

export function HardwareQaModal({ open, onClose, gpuRenderer }: HardwareQaModalProps) {
  const [deviceCategory, setDeviceCategory] = useState<HardwareProfileCategory>('desktop_dgpu');
  const [controlsRating, setControlsRating] = useState(4);
  const [squadResponsivenessRating, setSquadResponsivenessRating] = useState(4);
  const [readabilityRating, setReadabilityRating] = useState(4);
  const [performanceRating, setPerformanceRating] = useState(4);
  const [loadoutClarityRating, setLoadoutClarityRating] = useState(4);
  const [notes, setNotes] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  const [copied, setCopied] = useState<'json' | 'md' | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (open && gpuRenderer) {
      hardwareReadinessHarness.setGpuSummary(gpuRenderer, true, 'gpu' in navigator);
      setRevision((r) => r + 1);
    }
  }, [open, gpuRenderer]);

  if (!open) return null;

  const snapshot = hardwareReadinessHarness.buildSnapshot('interactive_browser_session');
  // Touch revision so React updates when feedback entries are logged
  void revision;

  const handleLogFeedback = () => {
    hardwareReadinessHarness.addPlaytestFeedback({
      deviceCategory,
      controlsRating,
      squadResponsivenessRating,
      loadoutClarityRating,
      readabilityRating,
      performanceRating,
      notes,
    });
    setNotes('');
    setSavedNotice(true);
    setRevision((r) => r + 1);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  const buildPayload = (kind: 'json' | 'md') => {
    if (kind === 'json') {
      return JSON.stringify(
        hardwareReadinessHarness.buildSnapshot('interactive_browser_session'),
        null,
        2
      );
    }
    return hardwareReadinessHarness.exportMarkdownReport('interactive_browser_session');
  };

  const copyExport = async (kind: 'json' | 'md') => {
    try {
      await navigator.clipboard.writeText(buildPayload(kind));
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard API may be unavailable in restricted sandboxes
    }
  };

  const downloadExport = (kind: 'json' | 'md') => {
    const content = buildPayload(kind);
    const blob = new Blob([content], {
      type: kind === 'json' ? 'application/json' : 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vanguard-hardware-qa.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-testid="hardware-qa-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Hardware Readiness and Playtest QA Harness"
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-[#141920] border border-zinc-700 rounded-sm p-5 space-y-4 my-auto shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400">
              Local-Only Diagnostics · Zero PII · Opt-In Export
            </p>
            <h3 className="font-display text-xl font-bold uppercase text-white mt-0.5 flex items-center gap-2">
              <MonitorCheck className="w-5 h-5 text-amber-400" />
              Hardware Readiness &amp; Playtest QA
            </h3>
          </div>
          <button
            type="button"
            aria-label="Close Hardware QA Modal"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
          <MetricTile
            label="Samples"
            value={`${snapshot.frameTimePercentilesMs.sampleCount}/300`}
          />
          <MetricTile label="P50 Frame" value={`${snapshot.frameTimePercentilesMs.p50}ms`} />
          <MetricTile label="P95 Frame" value={`${snapshot.frameTimePercentilesMs.p95}ms`} />
          <MetricTile label="P99 Frame" value={`${snapshot.frameTimePercentilesMs.p99}ms`} />
        </div>

        <div className="bg-[#0B0E11] border border-zinc-800 px-3 py-2 rounded-sm font-mono text-[11px] text-zinc-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            VIEWPORT {snapshot.viewport.width}x{snapshot.viewport.height} · DPR{' '}
            {snapshot.viewport.devicePixelRatio} · {snapshot.viewport.orientation.toUpperCase()}
          </span>
          <span className="text-zinc-400 truncate max-w-[260px]">
            {snapshot.gpuSummary.rendererLabel}
          </span>
        </div>

        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
              Physical Hardware Sign-Off Rating (1-5)
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {DEVICE_CATEGORIES.map((dc) => (
                <button
                  key={dc.id}
                  type="button"
                  onClick={() => setDeviceCategory(dc.id)}
                  className={`px-2 py-1 rounded-xs border font-mono text-[10px] uppercase whitespace-nowrap cursor-pointer ${
                    deviceCategory === dc.id
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                      : 'bg-[#0B0E11] border-zinc-800 text-zinc-400'
                  }`}
                >
                  {dc.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
            <RatingRow label="Control Precision" value={controlsRating} onChange={setControlsRating} />
            <RatingRow
              label="Squad Responsiveness"
              value={squadResponsivenessRating}
              onChange={setSquadResponsivenessRating}
            />
            <RatingRow label="HUD Readability" value={readabilityRating} onChange={setReadabilityRating} />
            <RatingRow label="Frame Stability" value={performanceRating} onChange={setPerformanceRating} />
            <RatingRow label="Loadout Clarity" value={loadoutClarityRating} onChange={setLoadoutClarityRating} />
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={400}
              placeholder="Optional physical-device playtest notes (auto-sanitized, zero PII)..."
              className="flex-1 bg-[#0B0E11] border border-zinc-800 rounded-sm px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
            />
            <Button variant="secondary" size="sm" className="min-h-[38px]" onClick={handleLogFeedback}>
              {savedNotice ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Plus className="w-3.5 h-3.5" />}
              Log Entry ({snapshot.feedbackEntries.length})
            </Button>
          </div>
        </div>

        <div className="pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-zinc-400">
            Data stays strictly local until you export it manually.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => copyExport('json')}>
              {copied === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
              Copy JSON
            </Button>
            <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => copyExport('md')}>
              {copied === 'md' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
              Copy Markdown
            </Button>
            <Button variant="primary" size="sm" className="min-h-[40px]" onClick={() => downloadExport('md')}>
              <Download className="w-3.5 h-3.5" /> Save Report
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0B0E11] border border-zinc-800 px-3 py-2 rounded-sm">
      <div className="text-[10px] uppercase text-zinc-400">{label}</div>
      <div className="text-sm font-bold text-amber-400 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="bg-[#0B0E11] border border-zinc-800 px-2.5 py-1.5 rounded-sm flex items-center justify-between gap-2">
      <span className="text-zinc-300 truncate">{label}</span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`w-6 h-6 rounded-xs font-mono text-[10px] font-bold cursor-pointer ${
              n <= value
                ? 'bg-amber-500 text-zinc-950'
                : 'bg-zinc-900 text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
