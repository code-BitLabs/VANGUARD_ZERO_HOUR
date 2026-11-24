import React, { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Crosshair,
  Hand,
  Monitor,
  Play,
  RotateCcw,
  Sliders,
  Undo2,
} from 'lucide-react';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { GpuCapabilityReport } from '@/src/engine/GpuCapabilityDetector';
import { DirectorTelemetrySnapshot } from '@/src/engine/RenderingQualityDirector';
import { ColorblindModeSchema, QualityTierSchema } from '@/src/schemas/common.schema';
import {
  AntiAliasingModeSchema,
  AudioDynamicRangeSchema,
  AudioSettingsSchema,
  ControlBindings,
  ControlBindingsSchema,
  CrosshairColor,
  CrosshairStyleSchema,
  DrawDistanceSettingSchema,
  FpsCapSchema,
  HudPresetSchema,
  QualityPresetProfile,
  QualityPresetProfileSchema,
  RendererBackendPreferenceSchema,
  ShadowMapResolutionSchema,
  SubQualityLevelSchema,
  TargetRefreshRateSchema,
  TouchAdsModeSchema,
  TouchControlProfileSchema,
  TouchFireBehaviorSchema,
  TouchModeSchema,
  VehicleSteeringModeSchema,
  findKeybindConflict,
} from '@/src/schemas/settings.schema';
import { useAudioSettingsStore } from '@/src/stores/audioSettingsStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import {
  MobileControlLayoutPreview,
  MobileHudEditorModal,
  resetMobileControlSettingsToDefaults,
} from '@/src/ui/components/MobileHudEditorModal';
import { MusicPlayerPanel } from '@/src/ui/components/MusicPlayerPanel';
import { Button } from '@/src/ui/primitives/Button';
import { ConfirmDialog } from '@/src/ui/primitives/ConfirmDialog';
import { Select, Slider, Switch } from '@/src/ui/primitives/Controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/src/ui/primitives/Tabs';
import { CommandHQTopBar, HQSectionId } from '@/src/ui/shell/CommandHQTopBar';

type SettingsTabId =
  | 'display'
  | 'graphics'
  | 'audio'
  | 'controls'
  | 'gameplay'
  | 'hud'
  | 'accessibility'
  | 'developer';

const BINDING_LABELS: Array<{ key: keyof ControlBindings; label: string }> = [
  { key: 'forward', label: 'Move Forward / Vehicle Gas' },
  { key: 'backward', label: 'Move Backward / Vehicle Brake & Reverse' },
  { key: 'left', label: 'Strafe Left / Steer Left' },
  { key: 'right', label: 'Strafe Right / Steer Right' },
  { key: 'sprint', label: 'Sprint' },
  { key: 'jump', label: 'Jump' },
  { key: 'handbrake', label: 'Vehicle Handbrake / Drift' },
  { key: 'crouch', label: 'Crouch / Slide' },
  { key: 'reload', label: 'Reload' },
  { key: 'interact', label: 'Interact / Enter & Exit Vehicle' },
  { key: 'vehicleCamera', label: 'Cycle Vehicle Camera' },
  { key: 'grenade', label: 'Throw Grenade' },
  { key: 'fireMode', label: 'Cycle Fire Mode' },
  { key: 'c4', label: 'Place / Detonate C4' },
  { key: 'bombStrike', label: 'Call Bomb Strike ([Shift]+Cycle)' },
  { key: 'strategicNuke', label: 'Strategic Strike Request' },
  { key: 'tacticalOverview', label: 'Tactical Overview & Cursor Toggle' },
];

const CROSSHAIR_SWATCHES: CrosshairColor[] = [
  '#F59E0B',
  '#38BDF8',
  '#FFFFFF',
  '#10B981',
  '#EF4444',
];

export function SettingsPanel({
  onBack,
  onResumeAndTest,
  gpuReport = null,
  qualityTelemetry = null,
  onReapplyAutoGraphics,
}: {
  onBack: () => void;
  onResumeAndTest?: () => void;
  gpuReport?: GpuCapabilityReport | null;
  qualityTelemetry?: DirectorTelemetrySnapshot | null;
  onReapplyAutoGraphics?: () => GpuCapabilityReport | null;
}) {
  const display = useSettingsStore((s) => s.display);
  const graphics = useSettingsStore((s) => s.graphics);
  const input = useSettingsStore((s) => s.input);
  const gameplay = useSettingsStore((s) => s.gameplay);
  const hud = useSettingsStore((s) => s.hud);
  const accessibility = useSettingsStore((s) => s.accessibility);
  const developer = useSettingsStore((s) => s.developer);

  const updateDisplay = useSettingsStore((s) => s.updateDisplay);
  const updateGraphics = useSettingsStore((s) => s.updateGraphics);
  const applyQualityProfile = useSettingsStore((s) => s.applyQualityProfile);
  const updateInput = useSettingsStore((s) => s.updateInput);
  const updateBinding = useSettingsStore((s) => s.updateBinding);
  const updateGameplay = useSettingsStore((s) => s.updateGameplay);
  const updateHud = useSettingsStore((s) => s.updateHud);
  const updateAccessibility = useSettingsStore((s) => s.updateAccessibility);
  const updateDeveloper = useSettingsStore((s) => s.updateDeveloper);
  const resetCategory = useSettingsStore((s) => s.resetCategory);
  const resetDefaults = useSettingsStore((s) => s.resetDefaults);

  const audio = useAudioSettingsStore((s) => s);
  const viewport = useViewportMode();
  const isMobileControlsFirst =
    viewport.isCoarsePointer || viewport.isCompactLandscape || viewport.isPortrait;

  const [activeTab, setActiveTab] = useState<SettingsTabId>('graphics');
  const [, startSettingsTransition] = useTransition();
  const [rebindingAction, setRebindingAction] = useState<keyof ControlBindings | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    action: keyof ControlBindings;
    code: string;
    conflictAction: keyof ControlBindings;
  } | null>(null);
  const [hudEditorOpen, setHudEditorOpen] = useState(false);
  const [confirmResetAllOpen, setConfirmResetAllOpen] = useState(false);
  const [pendingLeaveTarget, setPendingLeaveTarget] = useState<HQSectionId | 'back' | null>(null);
  const [latestGpuReport, setLatestGpuReport] = useState<GpuCapabilityReport | null>(gpuReport);

  // Capture session baseline so user can Revert unapplied edits at any time
  const baselineRef = useRef({
    display: structuredClone(display),
    graphics: structuredClone(graphics),
    input: structuredClone(input),
    gameplay: structuredClone(gameplay),
    hud: structuredClone(hud),
    accessibility: structuredClone(accessibility),
  });

  const currentFingerprint = useMemo(
    () =>
      JSON.stringify({
        display,
        graphics,
        input,
        gameplay,
        hud,
        accessibility,
      }),
    [display, graphics, input, gameplay, hud, accessibility]
  );
  const [savedFingerprint, setSavedFingerprint] = useState(currentFingerprint);
  const isDirty = currentFingerprint !== savedFingerprint;

  useEffect(() => {
    setLatestGpuReport(gpuReport);
  }, [gpuReport]);

  useEffect(() => {
    if (!rebindingAction) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setRebindingAction(null);
        return;
      }
      const validated = ControlBindingsSchema.safeParse({
        ...input.bindings,
        [rebindingAction]: e.code,
      });
      if (validated.success) {
        const conflict = findKeybindConflict(input.bindings, rebindingAction, e.code);
        if (conflict) {
          setPendingConflict({
            action: rebindingAction,
            code: e.code,
            conflictAction: conflict.conflictingAction,
          });
        } else {
          updateBinding(rebindingAction, e.code);
        }
      }
      setRebindingAction(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [rebindingAction, input.bindings, updateBinding]);

  const commitBaseline = () => {
    baselineRef.current = {
      display: structuredClone(display),
      graphics: structuredClone(graphics),
      input: structuredClone(input),
      gameplay: structuredClone(gameplay),
      hud: structuredClone(hud),
      accessibility: structuredClone(accessibility),
    };
    setSavedFingerprint(currentFingerprint);
  };

  const handleRevertChanges = () => {
    const b = baselineRef.current;
    updateDisplay(b.display);
    updateGraphics(b.graphics, { preserveAutoMode: b.graphics.qualityMode === 'auto' });
    updateInput(b.input);
    updateGameplay(b.gameplay);
    updateHud(b.hud);
    updateAccessibility(b.accessibility);
    uiStore.getState().showToast('Settings Reverted', 'Restored settings from before this session.', 'info');
  };

  const handleApplyAndSave = () => {
    commitBaseline();
    uiStore.getState().showToast('Settings Saved', 'Configuration saved to local tactical profile.', 'success');
  };

  const handleResetCurrentCategory = () => {
    if (activeTab === 'audio') {
      audio.resetAudio();
    } else if (activeTab !== 'developer') {
      resetCategory(activeTab);
    }
    uiStore
      .getState()
      .showToast('Category Reset', `${activeTab.toUpperCase()} settings restored to defaults.`, 'info');
  };

  const handleResetAllConfirmed = () => {
    resetDefaults();
    audio.resetAudio();
    setConfirmResetAllOpen(false);
    uiStore
      .getState()
      .showToast('Settings Restored', 'All display, graphics, audio, controls, and HUD settings reset.', 'info');
  };

  const handleRedetect = () => {
    const report = onReapplyAutoGraphics?.() ?? null;
    if (report) {
      setLatestGpuReport(report);
      uiStore
        .getState()
        .showToast(
          'Optimal Graphics Applied',
          `Auto mode selected ${report.recommendedTier.toUpperCase()} (${report.hardwareProfile.replace(/_/g, ' ')}, score ${report.score}/100).`,
          'info'
        );
    } else {
      applyQualityProfile('auto_adaptive');
    }
  };

  const executeNavigation = (target: HQSectionId | 'back') => {
    setPendingLeaveTarget(null);
    if (target === 'back') {
      onBack();
    } else if (target !== 'settings') {
      uiStore.getState().setScreen(target);
    }
  };

  const requestNavigation = (target: HQSectionId | 'back') => {
    if (target === 'settings') return;
    if (isDirty && target !== 'back') {
      setPendingLeaveTarget(target);
      return;
    }
    executeNavigation(target);
  };

  const hardwareProfileLabel = (
    qualityTelemetry?.hardwareProfile ??
    latestGpuReport?.hardwareProfile ??
    'mid_range_desktop'
  )
    .replace(/_/g, ' ')
    .toUpperCase();

  return (
    <div
      className="fixed inset-0 z-30 bg-[var(--vg-bg-canvas)]/96 flex items-center justify-center"
      style={{
        paddingTop: 'max(8px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(10px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(10px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="w-full max-w-5xl bg-[var(--vg-bg-panel)] border border-[var(--vg-border-subtle)] rounded-sm shadow-2xl flex flex-col max-h-[96dvh]">
        {/* Top Command Rail + Session Actions */}
        <div className="px-4 sm:px-6 [@media(max-height:520px)]:px-3 pt-3 [@media(max-height:520px)]:pt-2 pb-2 [@media(max-height:520px)]:pb-1.5 shrink-0">
          <CommandHQTopBar
            activeSection="settings"
            subtitle="7-Category Tactical Configuration"
            title="Settings"
            onNavigate={(target) => requestNavigation(target)}
          />

          <div className="flex flex-wrap [@media(max-height:520px)]:flex-nowrap items-center justify-between gap-1.5 sm:gap-2 [@media(max-height:520px)]:gap-1.5 pt-2 [@media(max-height:520px)]:pt-1 [@media(max-height:520px)]:overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1.5 text-xs font-mono shrink-0">
              {isDirty ? (
                <span
                  data-testid="settings-dirty-banner"
                  className="inline-flex items-center gap-1 text-[var(--vg-accent-amber)] whitespace-nowrap"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span className="[@media(max-height:520px)]:hidden">
                    Modified in this session (live preview active)
                  </span>
                  <span className="hidden [@media(max-height:520px)]:inline text-[11px]">
                    Modified
                  </span>
                </span>
              ) : (
                <span className="text-[var(--vg-text-muted)] [@media(max-height:520px)]:hidden">
                  Profile synced · Changes preview live
                </span>
              )}
            </div>

            <div className="flex flex-wrap [@media(max-height:520px)]:flex-nowrap items-center gap-1.5 sm:gap-2 [@media(max-height:520px)]:gap-1 ml-auto shrink-0">
              {isDirty && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="settings-revert-btn"
                    className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:px-2 [@media(max-height:520px)]:text-[11px] whitespace-nowrap shrink-0"
                    onClick={handleRevertChanges}
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Revert
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="settings-apply-btn"
                    className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:px-2 [@media(max-height:520px)]:text-[11px] whitespace-nowrap shrink-0"
                    onClick={handleApplyAndSave}
                  >
                    <Check className="w-3.5 h-3.5" /> Save Snapshot
                  </Button>
                </>
              )}
              {activeTab !== 'developer' && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="settings-reset-category-btn"
                  className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:px-2 [@media(max-height:520px)]:text-[11px] whitespace-nowrap shrink-0"
                  onClick={handleResetCurrentCategory}
                >
                  Reset Tab
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                data-testid="settings-reset-all-btn"
                className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:px-2 [@media(max-height:520px)]:text-[11px] whitespace-nowrap shrink-0"
                onClick={() => setConfirmResetAllOpen(true)}
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset All
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] px-4 [@media(max-height:520px)]:px-2.5 [@media(max-height:520px)]:text-[11px] whitespace-nowrap shrink-0"
                onClick={() => {
                  commitBaseline();
                  onBack();
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            startSettingsTransition(() => {
              setActiveTab(v as SettingsTabId);
            })
          }
          className="flex-1 flex flex-col overflow-hidden px-3 sm:px-6 [@media(max-height:520px)]:px-3 pb-4 [@media(max-height:520px)]:pb-2"
        >
          <TabsList className="mb-3 [@media(max-height:520px)]:mb-1.5 shrink-0 min-h-[48px] [@media(max-height:520px)]:min-h-[38px] py-1 [@media(max-height:520px)]:py-0.5 w-full max-w-full overflow-x-auto flex-nowrap lg:flex-wrap [@media(max-height:520px)]:flex-nowrap justify-start">
            <TabsTrigger value="display" className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:py-1 whitespace-nowrap shrink-0">Display</TabsTrigger>
            <TabsTrigger value="graphics" className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:py-1 whitespace-nowrap shrink-0">Graphics</TabsTrigger>
            <TabsTrigger value="audio" className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:py-1 whitespace-nowrap shrink-0">Audio</TabsTrigger>
            <TabsTrigger value="controls" className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:py-1 whitespace-nowrap shrink-0">Controls &amp; Keys</TabsTrigger>
            <TabsTrigger value="gameplay" className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:py-1 whitespace-nowrap shrink-0">Gameplay</TabsTrigger>
            <TabsTrigger value="hud" className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:py-1 whitespace-nowrap shrink-0">HUD</TabsTrigger>
            <TabsTrigger value="accessibility" className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:py-1 whitespace-nowrap shrink-0">Accessibility</TabsTrigger>
            {isEnvDevModeAllowed() && (
              <TabsTrigger value="developer" className="min-h-[40px] [@media(max-height:520px)]:min-h-[32px] [@media(max-height:520px)]:py-1 whitespace-nowrap shrink-0">Developer Tools</TabsTrigger>
            )}
          </TabsList>

          <div className="flex-1 overflow-y-auto pr-1 space-y-3">
            {/* 1. DISPLAY */}
            <TabsContent value="display" className="space-y-3">
              <SettingRow
                label="Resolution & Presentation"
                hint="Browser viewport scales automatically with hardware pixel ratio caps."
              >
                <div className="inline-flex items-center gap-2 font-mono text-xs text-[var(--vg-text-secondary)]">
                  <Monitor className="w-4 h-4 text-[var(--vg-accent-cyan)]" />
                  <span>
                    {typeof window !== 'undefined'
                      ? `${window.innerWidth}×${window.innerHeight} @ ${(window.devicePixelRatio || 1).toFixed(1)}x`
                      : 'Adaptive Viewport'}
                  </span>
                </div>
              </SettingRow>

              <SettingRow
                label={`Render Scale (${Math.round(graphics.renderScale * 100)}%)`}
                hint="Internal 3D resolution scale (lower improves GPU fill-rate on mobile and integrated GPUs)."
              >
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="Display Render Scale"
                    value={graphics.renderScale}
                    min={0.5}
                    max={1.0}
                    step={0.05}
                    onValueChange={(renderScale) => updateGraphics({ renderScale })}
                  />
                </div>
              </SettingRow>

              <SettingRow
                label={`Max Device Pixel Ratio (${graphics.maxDpr.toFixed(2)}x)`}
                hint="Caps high-DPI supersampling to stabilize frame pacing."
              >
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="Max DPR"
                    value={graphics.maxDpr}
                    min={1.0}
                    max={2.0}
                    step={0.25}
                    onValueChange={(maxDpr) => updateGraphics({ maxDpr })}
                  />
                </div>
              </SettingRow>

              <SettingRow
                label="Frame Rate Cap"
                hint="Limit frame rate to reduce mobile battery drain and thermal throttling."
              >
                <Select
                  aria-label="Display Frame Rate Cap"
                  value={String(graphics.fpsCap)}
                  onValueChange={(v) => updateGraphics({ fpsCap: FpsCapSchema.parse(Number(v)) })}
                  options={[
                    { value: '30', label: '30 FPS (Battery Saver)' },
                    { value: '60', label: '60 FPS (Standard)' },
                    { value: '120', label: '120 FPS (High Refresh)' },
                    { value: '0', label: 'Uncapped (Display Refresh)' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label="Target Display Refresh Rate"
                hint="Calibrates the Adaptive Rendering Director frame-budget threshold."
              >
                <Select
                  aria-label="Target Refresh Rate"
                  value={String(graphics.targetRefreshRate)}
                  onValueChange={(v) =>
                    updateGraphics({ targetRefreshRate: TargetRefreshRateSchema.parse(Number(v)) })
                  }
                  options={[
                    { value: '60', label: '60 Hz (16.7ms Budget)' },
                    { value: '90', label: '90 Hz (11.1ms Budget)' },
                    { value: '120', label: '120 Hz (8.3ms Budget)' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label={`Interface Scale (${Math.round(display.uiScale * 100)}%)`}
                hint="Adjusts menu and HUD layout scaling across monitors and tablets."
              >
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="Interface Scale"
                    value={display.uiScale}
                    min={0.85}
                    max={1.25}
                    step={0.05}
                    onValueChange={(uiScale) => {
                      updateDisplay({ uiScale });
                    }}
                  />
                </div>
              </SettingRow>

              <SettingRow
                label="Show Compact FPS Counter"
                hint="Displays a subtle, non-intrusive frame rate readout in the HUD corner."
              >
                <Switch
                  aria-label="Show FPS Counter"
                  checked={display.showFpsCounter}
                  onCheckedChange={(showFpsCounter) => updateDisplay({ showFpsCounter })}
                />
              </SettingRow>

              <SettingRow
                label="Show Live Frame-Time & Hardware Telemetry"
                hint="Displays CPU P50/P95/P99 frame times, draw calls, and active adaptive scaling reductions."
              >
                <Switch
                  aria-label="Show Performance Telemetry"
                  checked={display.showPerformanceTelemetry}
                  onCheckedChange={(showPerformanceTelemetry) =>
                    updateDisplay({ showPerformanceTelemetry })
                  }
                />
              </SettingRow>

              <SettingRow
                label="Menu Artwork Parallax"
                hint="Subtle atmospheric depth motion on Command HQ backdrop (automatically off with Reduced Motion)."
              >
                <Switch
                  aria-label="Menu Parallax"
                  checked={display.menuParallaxEnabled}
                  onCheckedChange={(menuParallaxEnabled) => updateDisplay({ menuParallaxEnabled })}
                />
              </SettingRow>
            </TabsContent>

            {/* 2. GRAPHICS */}
            <TabsContent value="graphics" className="space-y-3">
              {/* Hardware Capability & Adaptive Director Telemetry Card */}
              <div
                data-testid="graphics-telemetry-card"
                className="bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] rounded-sm p-3.5 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[var(--vg-accent-cyan)]" />
                    <span className="font-mono text-xs uppercase tracking-wider text-[var(--vg-text-primary)]">
                      Active Hardware Profile: {hardwareProfileLabel}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-[38px]"
                    onClick={handleRedetect}
                  >
                    Re-Detect Optimal Preset
                  </Button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] tabular-nums">
                  <TelemetryMetric
                    label="Director Mode"
                    value={
                      graphics.qualityProfile === 'auto_adaptive'
                        ? 'AUTO ADAPTIVE'
                        : graphics.qualityProfile.toUpperCase()
                    }
                  />
                  <TelemetryMetric
                    label="CPU P50 / P95"
                    value={
                      qualityTelemetry
                        ? `${qualityTelemetry.cpuFrameMsP50.toFixed(1)} / ${qualityTelemetry.cpuFrameMsP95.toFixed(1)}ms`
                        : 'Pending play'
                    }
                  />
                  <TelemetryMetric
                    label="Draw Calls"
                    value={qualityTelemetry ? String(qualityTelemetry.drawCalls) : '—'}
                  />
                  <TelemetryMetric
                    label="Hardware Probe"
                    value={
                      latestGpuReport
                        ? `${latestGpuReport.score}/100 · WebGL${latestGpuReport.signals.webglVersion || '?'}`
                        : 'Standard'
                    }
                  />
                </div>

                {qualityTelemetry?.activeReductions && qualityTelemetry.activeReductions.length > 0 && (
                  <div className="text-[11px] font-mono text-[var(--vg-accent-cyan)]">
                    Active Adaptive Scaling: {qualityTelemetry.activeReductions.join(' · ')}
                  </div>
                )}

                {qualityTelemetry?.advisoryMessage && (
                  <div className="flex items-start gap-2 text-xs text-[var(--vg-accent-amber)] bg-[var(--vg-accent-amber)]/10 border border-[var(--vg-accent-amber)]/40 px-3 py-2 rounded-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{qualityTelemetry.advisoryMessage}</span>
                  </div>
                )}
              </div>

              <SettingRow
                label="Graphics Quality Profile"
                hint="Auto Adaptive tunes independent dimensions cleanly; Manual/Preset modes strictly lock your selections."
              >
                <Select
                  aria-label="Graphics Quality Profile"
                  value={graphics.qualityProfile}
                  onValueChange={(v) =>
                    startSettingsTransition(() => {
                      applyQualityProfile(QualityPresetProfileSchema.parse(v) as QualityPresetProfile);
                    })
                  }
                  options={[
                    { value: 'auto_adaptive', label: 'Auto Adaptive (Recommended)' },
                    { value: 'cinematic', label: 'Cinematic (Locked)' },
                    { value: 'balanced', label: 'Balanced (Locked)' },
                    { value: 'performance', label: 'Performance (Locked)' },
                    { value: 'manual', label: 'Manual (Locked)' },
                    { value: 'custom', label: 'Custom (Locked)' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label="Legacy Quality Tier"
                hint="Sets baseline shadow distance and particle governor profile."
              >
                <Select
                  aria-label="Quality Preset"
                  value={graphics.quality}
                  onValueChange={(v) => updateGraphics({ quality: QualityTierSchema.parse(v) })}
                  options={[
                    { value: 'low', label: 'Low (Performance)' },
                    { value: 'medium', label: 'Medium (Balanced)' },
                    { value: 'high', label: 'High (Tactical)' },
                    { value: 'ultra', label: 'Ultra (Cinematic)' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label="Shadow Cascades (CSM)"
                hint="Three.js Cascaded Shadow Maps near-to-far split count."
              >
                <Select
                  aria-label="Shadow Cascades"
                  value={String(graphics.csmCascades)}
                  onValueChange={(v) => updateGraphics({ csmCascades: Number(v) })}
                  options={[
                    { value: '1', label: '1 Cascade (Low Cost)' },
                    { value: '2', label: '2 Cascades (Mobile / iGPU)' },
                    { value: '3', label: '3 Cascades (Desktop)' },
                    { value: '4', label: '4 Cascades (Cinematic)' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label="Shadow Map Resolution"
                hint="Higher resolution sharpens architectural contact shadows."
              >
                <Select
                  aria-label="Shadow Map Resolution"
                  value={String(graphics.shadowMapSize)}
                  onValueChange={(v) =>
                    updateGraphics({ shadowMapSize: ShadowMapResolutionSchema.parse(Number(v)) })
                  }
                  options={[
                    { value: '512', label: '512px (Performance)' },
                    { value: '1024', label: '1024px (Balanced)' },
                    { value: '2048', label: '2048px (High Detail)' },
                  ]}
                />
              </SettingRow>

              <SettingRow label="Dynamic Shadows" hint="Enables directional sun & cascade shadow projection.">
                <Switch
                  aria-label="Dynamic Shadows"
                  checked={graphics.shadowsEnabled}
                  onCheckedChange={(shadowsEnabled) => updateGraphics({ shadowsEnabled })}
                />
              </SettingRow>

              <SettingRow label="Ambient Occlusion" hint="Deepens crevice shading on structures and vehicles.">
                <Switch
                  aria-label="Ambient Occlusion"
                  checked={graphics.ambientOcclusion}
                  onCheckedChange={(ambientOcclusion) => updateGraphics({ ambientOcclusion })}
                />
              </SettingRow>

              <SettingRow label="Volumetric Atmosphere & Fog" hint="Layered mission haze, dawn rays, and night searchlight cones.">
                <Switch
                  aria-label="Volumetric Fog"
                  checked={graphics.volumetricFog}
                  onCheckedChange={(volumetricFog) => updateGraphics({ volumetricFog })}
                />
              </SettingRow>

              <SettingRow label="Wet Surface Reflections" hint="Localized outdoor asphalt puddle sheen in damp & monsoon operations.">
                <Switch
                  aria-label="Wet Reflections"
                  checked={graphics.wetReflections}
                  onCheckedChange={(wetReflections) => updateGraphics({ wetReflections })}
                />
              </SettingRow>

              <SettingRow label="Bloom & Emissive Glow" hint="Restrained ACES bloom on muzzle flashes, tracers, and molten hazards.">
                <Switch
                  aria-label="Bloom"
                  checked={graphics.bloomEnabled}
                  onCheckedChange={(bloomEnabled) => updateGraphics({ bloomEnabled })}
                />
              </SettingRow>

              <SettingRow label="Filmic Color Grading" hint="Mission-specific calibrated ACES Filmic look.">
                <Switch
                  aria-label="Color Grading"
                  checked={graphics.colorGrading}
                  onCheckedChange={(colorGrading) => updateGraphics({ colorGrading })}
                />
              </SettingRow>

              <SettingRow
                label="Anti-Aliasing"
                hint="Hardware-adaptive MSAA 4x/2x or SMAA post-process edge smoothing (applies between firefights)."
              >
                <Select
                  aria-label="Anti-Aliasing"
                  value={graphics.antiAliasingMode ?? 'auto'}
                  onValueChange={(v) => {
                    const antiAliasingMode = AntiAliasingModeSchema.parse(v);
                    updateGraphics({
                      antiAliasingMode,
                      antialiasing: antiAliasingMode !== 'off',
                    });
                  }}
                  options={[
                    { value: 'auto', label: 'Auto (Hardware-Adaptive)' },
                    { value: 'msaa4', label: 'MSAA 4x' },
                    { value: 'msaa2', label: 'MSAA 2x' },
                    { value: 'smaa', label: 'SMAA' },
                    { value: 'off', label: 'Off' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label={`Surface Decal Budget (${graphics.decalBudget} persistent decals)`}
                hint="Ring-buffered DecalGeometry bullet holes and explosion scorch marks."
              >
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="Surface Decal Budget"
                    value={graphics.decalBudget}
                    min={0}
                    max={256}
                    step={16}
                    onValueChange={(decalBudget) => updateGraphics({ decalBudget })}
                  />
                </div>
              </SettingRow>

              <SettingRow label="Texture Quality" hint="Procedural PBR material resolution and anisotropic filtering.">
                <Select
                  aria-label="Texture Quality"
                  value={graphics.textureQuality}
                  onValueChange={(v) =>
                    updateGraphics({ textureQuality: SubQualityLevelSchema.parse(v) })
                  }
                  options={[
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                  ]}
                />
              </SettingRow>

              <SettingRow label="Effects & Particle Density">
                <Select
                  aria-label="Effects Quality"
                  value={graphics.effectsQuality}
                  onValueChange={(v) =>
                    updateGraphics({ effectsQuality: SubQualityLevelSchema.parse(v) })
                  }
                  options={[
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                  ]}
                />
              </SettingRow>

              <SettingRow label="Foliage & Environmental Clutter">
                <Select
                  aria-label="Foliage Density"
                  value={graphics.foliageDensity}
                  onValueChange={(v) =>
                    updateGraphics({ foliageDensity: SubQualityLevelSchema.parse(v) })
                  }
                  options={[
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                  ]}
                />
              </SettingRow>

              <SettingRow label="Draw Distance">
                <Select
                  aria-label="Draw Distance"
                  value={graphics.drawDistance}
                  onValueChange={(v) =>
                    updateGraphics({ drawDistance: DrawDistanceSettingSchema.parse(v) })
                  }
                  options={[
                    { value: 'auto', label: 'Auto (Follows Preset)' },
                    { value: 'short', label: 'Short (160m)' },
                    { value: 'medium', label: 'Medium (260m)' },
                    { value: 'long', label: 'Long (380m)' },
                    { value: 'ultra', label: 'Ultra (520m)' },
                  ]}
                />
              </SettingRow>

              <SettingRow label={`Field of View (${graphics.fov}°)`}>
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="Field of View"
                    value={graphics.fov}
                    min={60}
                    max={110}
                    step={1}
                    onValueChange={(fov) => updateGraphics({ fov })}
                  />
                </div>
              </SettingRow>

              <SettingRow
                label="Renderer Backend"
                hint="WebGL2 is active; WebGPU seam activates automatically when promoted."
              >
                <Select
                  aria-label="Renderer Backend"
                  value={graphics.rendererBackend}
                  onValueChange={(v) =>
                    updateGraphics({ rendererBackend: RendererBackendPreferenceSchema.parse(v) })
                  }
                  options={[
                    { value: 'auto', label: 'Auto (WebGL2 + WebGPU Ready)' },
                    { value: 'webgl2', label: 'WebGL2 Stable' },
                    { value: 'webgpu', label: 'WebGPU Experimental Seam' },
                  ]}
                />
              </SettingRow>
            </TabsContent>

            {/* 3. AUDIO */}
            <TabsContent value="audio" className="space-y-3">
              <SettingRow label="Mute All Audio">
                <Switch
                  aria-label="Mute All Audio"
                  checked={audio.muted}
                  onCheckedChange={(muted) => audio.updateAudio({ muted })}
                />
              </SettingRow>

              {(
                [
                  ['masterVolume', 'Master Volume'],
                  ['sfxVolume', 'Combat SFX & Foley'],
                  ['musicVolume', 'Tactical Score & Music'],
                  ['dialogueVolume', 'Squad Radio & Callouts'],
                  ['ambienceVolume', 'Environmental Ambience'],
                ] as const
              ).map(([field, label]) => (
                <SettingRow
                  key={field}
                  label={`${label} (${Math.round(audio[field] * 100)}%)`}
                >
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label={label}
                      value={audio[field]}
                      min={0}
                      max={1}
                      step={0.05}
                      onValueChange={(val) => {
                        const parsed = AudioSettingsSchema.partial().safeParse({ [field]: val });
                        if (parsed.success) audio.updateAudio(parsed.data);
                      }}
                    />
                  </div>
                </SettingRow>
              ))}

              <SettingRow
                label="Spatial 3D Positioning"
                hint="Native Web Audio distance roll-off, stereo azimuth pan, and obstacle low-pass occlusion."
              >
                <Switch
                  aria-label="Spatial 3D Positioning"
                  checked={audio.spatialAudioEnabled}
                  onCheckedChange={(spatialAudioEnabled) => audio.updateAudio({ spatialAudioEnabled })}
                />
              </SettingRow>

              <SettingRow
                label="Environmental Acoustic Reverb"
                hint="Shared ConvolverNode acoustic reflections for urban canyons, bunkers, jungles, and foundries."
              >
                <Switch
                  aria-label="Environmental Reverb"
                  checked={audio.environmentalReverbEnabled}
                  onCheckedChange={(environmentalReverbEnabled) =>
                    audio.updateAudio({ environmentalReverbEnabled })
                  }
                />
              </SettingRow>

              <SettingRow
                label="Dynamic Range Mix"
                hint="Night Mode compresses loud explosions while keeping footsteps and radio cues clear."
              >
                <Select
                  aria-label="Dynamic Range Mix"
                  value={audio.dynamicRange}
                  onValueChange={(v) =>
                    audio.updateAudio({ dynamicRange: AudioDynamicRangeSchema.parse(v) })
                  }
                  options={[
                    { value: 'tactical', label: 'Balanced Tactical Mix' },
                    { value: 'night_mode', label: 'Night Mode (Compressed)' },
                    { value: 'cinema', label: 'Cinema Wide Dynamic Range' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label="Squad Radio Ducking"
                hint="Attenuates ambient noise and reverb during incoming tactical dispatches."
              >
                <Switch
                  aria-label="Squad Radio Ducking"
                  checked={audio.radioDucking}
                  onCheckedChange={(radioDucking) => audio.updateAudio({ radioDucking })}
                />
              </SettingRow>

              <div className="pt-2 border-t border-[var(--vg-border-subtle)]">
                <MusicPlayerPanel />
              </div>
            </TabsContent>

            {/* 4. CONTROLS & KEYS */}
            <TabsContent value="controls" className="flex flex-col gap-4">
              <div
                data-testid="controls-desktop-mouse-section"
                className={`space-y-3 ${isMobileControlsFirst ? 'order-2 pt-3 border-t border-[var(--vg-border-subtle)]' : 'order-1'}`}
              >
                {isMobileControlsFirst && (
                  <p className="font-mono text-xs uppercase tracking-wider text-[var(--vg-text-secondary)]">
                    Mouse &amp; Desktop Aiming
                  </p>
                )}
                <SettingRow label={`Mouse Sensitivity (${input.mouseSensitivity.toFixed(2)}x)`}>
                  <div className="w-full sm:w-52">
                    <Slider
                      aria-label="Mouse Sensitivity"
                      value={input.mouseSensitivity}
                      min={0.2}
                      max={3.0}
                      step={0.05}
                      onValueChange={(mouseSensitivity) => updateInput({ mouseSensitivity })}
                    />
                  </div>
                </SettingRow>

                <SettingRow label="Invert Vertical Look (Y-Axis)">
                  <Switch
                    aria-label="Invert Y-Axis"
                    checked={input.invertY}
                    onCheckedChange={(invertY) => updateInput({ invertY })}
                  />
                </SettingRow>

                <SettingRow label="Hold Aim Down Sights (Mouse)" hint="Hold RMB to aim, or switch off to toggle ADS with one click.">
                  <Switch
                    aria-label="Hold ADS"
                    checked={gameplay.holdToAds}
                    onCheckedChange={(holdToAds) => updateGameplay({ holdToAds })}
                  />
                </SettingRow>
              </div>

              {/* Mobile / Touch Controls & Layout Engine (Prioritized first on mobile/touch viewports) */}
              <div
                data-testid="controls-mobile-touch-section"
                className={`space-y-3 ${isMobileControlsFirst ? 'order-1' : 'order-2 pt-3 border-t border-[var(--vg-border-subtle)]'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Hand className="w-4 h-4 text-[var(--vg-accent-amber)]" />
                    <span className="font-mono text-xs uppercase tracking-wider text-[var(--vg-text-primary)]">
                      Mobile &amp; Touch Control Layout
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {onResumeAndTest && (
                      <Button variant="primary" size="sm" className="min-h-[40px]" onClick={onResumeAndTest}>
                        <Play className="w-3.5 h-3.5 fill-current" /> Resume &amp; Test
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="reset-mobile-controls"
                      className="min-h-[40px]"
                      onClick={() => resetMobileControlSettingsToDefaults()}
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reset Mobile Defaults
                    </Button>
                  </div>
                </div>

                {/* Profile Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      {
                        id: 'two_finger' as const,
                        testId: 'profile-two-finger',
                        title: 'Two-Finger Thumbs',
                        desc: 'Right-thumb fire + ADS cluster.',
                      },
                      {
                        id: 'three_finger' as const,
                        testId: 'profile-three-finger',
                        title: 'Three-Finger Claw',
                        desc: 'Upper-left index fire + right thumb aim.',
                      },
                      {
                        id: 'custom' as const,
                        testId: 'profile-custom',
                        title: 'Custom 1:1 Layout',
                        desc: 'Free-placed handles in HUD editor.',
                      },
                    ] as const
                  ).map((prof) => {
                    const active = input.touchControlProfile === prof.id;
                    return (
                      <button
                        key={prof.id}
                        type="button"
                        data-testid={prof.testId}
                        onClick={() =>
                          updateInput({
                            touchControlProfile: TouchControlProfileSchema.parse(prof.id),
                            leftFireEnabled: prof.id === 'three_finger' ? true : input.leftFireEnabled,
                          })
                        }
                        className={`text-left p-3 rounded-sm border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[var(--vg-bg-elevated)] border-[var(--vg-accent-amber)]'
                            : 'bg-[var(--vg-bg-recessed)] border-[var(--vg-border-subtle)] hover:border-[var(--vg-border-strong)]'
                        }`}
                      >
                        <div className="font-display text-sm font-bold uppercase text-[var(--vg-text-primary)]">
                          {prof.title}
                        </div>
                        <div className="text-[11px] text-[var(--vg-text-muted)] mt-0.5">{prof.desc}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="flex items-center justify-between bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] px-3.5 py-2.5 rounded-sm">
                    <span className="text-xs text-[var(--vg-text-primary)]">Left-Side Fire Button</span>
                    <Switch
                      aria-label="Left-Side Fire"
                      checked={input.leftFireEnabled}
                      onCheckedChange={(leftFireEnabled) =>
                        updateInput({ leftFireEnabled, touchControlProfile: 'custom' })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] px-3.5 py-2.5 rounded-sm">
                    <span className="text-xs text-[var(--vg-text-primary)]">Right-Side Fire Button</span>
                    <Switch
                      aria-label="Right-Side Fire"
                      checked={input.rightFireEnabled}
                      onCheckedChange={(rightFireEnabled) =>
                        updateInput({ rightFireEnabled, touchControlProfile: 'custom' })
                      }
                    />
                  </div>
                </div>

                <MobileControlLayoutPreview onOpenFullscreenEditor={() => setHudEditorOpen(true)} />

                <SettingRow label="Touch HUD Mode" hint="Auto displays twin-stick touch controls on touch devices.">
                  <Select
                    aria-label="Touch HUD Mode"
                    value={input.touchMode}
                    onValueChange={(v) => {
                      uiStore.getState().setTouchHudOverride(null);
                      updateInput({ touchMode: TouchModeSchema.parse(v) });
                    }}
                    options={[
                      { value: 'auto', label: 'Auto (Smart Detect)' },
                      { value: 'always_on', label: 'Always On' },
                      { value: 'always_off', label: 'Always Off' },
                    ]}
                  />
                </SettingRow>

                <SettingRow label={`Touch Look Sensitivity (${input.touchSensitivity.toFixed(2)}x)`}>
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Touch Look Sensitivity"
                      value={input.touchSensitivity}
                      min={0.3}
                      max={3.0}
                      step={0.05}
                      onValueChange={(touchSensitivity) => updateInput({ touchSensitivity })}
                    />
                  </div>
                </SettingRow>

                <SettingRow label="Mobile Aim Assist (Rotational Friction)">
                  <Switch
                    aria-label="Mobile Aim Assist"
                    checked={input.mobileAimAssist}
                    onCheckedChange={(mobileAimAssist) => updateInput({ mobileAimAssist })}
                  />
                </SettingRow>

                <SettingRow label={`Fire Button Size (${Math.round(input.touchFireButtonScale * 100)}%)`}>
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Fire Button Size"
                      value={input.touchFireButtonScale}
                      min={0.75}
                      max={1.45}
                      step={0.05}
                      onValueChange={(touchFireButtonScale) => updateInput({ touchFireButtonScale })}
                    />
                  </div>
                </SettingRow>

                <SettingRow label="ADS Touch Mode">
                  <Select
                    aria-label="ADS Touch Mode"
                    value={input.touchAdsMode}
                    onValueChange={(v) => updateInput({ touchAdsMode: TouchAdsModeSchema.parse(v) })}
                    options={[
                      { value: 'toggle', label: 'Toggle Aim (Recommended)' },
                      { value: 'hold', label: 'Hold to Aim' },
                    ]}
                  />
                </SettingRow>

                <SettingRow label="Touch Fire Behavior">
                  <Select
                    aria-label="Touch Fire Behavior"
                    value={input.touchFireBehavior}
                    onValueChange={(v) =>
                      updateInput({ touchFireBehavior: TouchFireBehaviorSchema.parse(v) })
                    }
                    options={[
                      { value: 'dedicated', label: 'Dedicated Fire + ADS' },
                      { value: 'ads_on_fire', label: 'ADS While Firing' },
                    ]}
                  />
                </SettingRow>

                <SettingRow label="Vehicle Touch Steering Mode">
                  <Select
                    aria-label="Vehicle Touch Steering Mode"
                    value={input.touchVehicleSteeringMode}
                    onValueChange={(v) =>
                      updateInput({ touchVehicleSteeringMode: VehicleSteeringModeSchema.parse(v) })
                    }
                    options={[
                      { value: 'buttons', label: 'Steering Buttons (Left / Right)' },
                      { value: 'wheel', label: 'Virtual Steering Wheel' },
                    ]}
                  />
                </SettingRow>
              </div>

              {/* Interactive Key Bindings with Live Conflict Resolution */}
              <div className="order-3 pt-3 border-t border-[var(--vg-border-subtle)]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <p className="font-mono text-xs uppercase tracking-wider text-[var(--vg-text-secondary)]">
                    Key Bindings (Click to capture · ESC to cancel)
                  </p>
                  {pendingConflict && (
                    <div
                      data-testid="keybind-conflict-banner"
                      className="flex flex-wrap items-center gap-2 bg-[var(--vg-accent-amber)]/15 border border-[var(--vg-accent-amber)] px-3 py-1.5 rounded-sm text-xs"
                    >
                      <span className="text-[var(--vg-accent-amber)] font-mono">
                        {pendingConflict.code} is bound to {pendingConflict.conflictAction.toUpperCase()}.
                      </span>
                      <Button
                        size="sm"
                        variant="primary"
                        data-testid="confirm-keybind-swap"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => {
                          updateBinding(pendingConflict.action, pendingConflict.code);
                          setPendingConflict(null);
                        }}
                      >
                        Swap Keys
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setPendingConflict(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {BINDING_LABELS.map((item) => {
                    const listening = rebindingAction === item.key;
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] px-3 py-2 rounded-sm"
                      >
                        <span className="text-xs text-[var(--vg-text-primary)]">{item.label}</span>
                        <Button
                          size="sm"
                          variant={listening ? 'primary' : 'outline'}
                          data-testid={`rebind-${item.key}`}
                          className="h-8 px-2.5 font-mono text-[11px]"
                          onClick={() => {
                            setPendingConflict(null);
                            setRebindingAction(item.key);
                          }}
                        >
                          {listening ? 'Press Key...' : input.bindings[item.key]}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            {/* 5. GAMEPLAY */}
            <TabsContent value="gameplay" className="space-y-3">
              <SettingRow
                label="Contextual Tactical HUD Hints"
                hint="Displays concise non-blocking prompts for reload, breach zones, and extraction status."
              >
                <Switch
                  aria-label="Gameplay Tactical Hints"
                  checked={gameplay.tacticalGuidanceHints}
                  onCheckedChange={(tacticalGuidanceHints) =>
                    updateGameplay({ tacticalGuidanceHints })
                  }
                />
              </SettingRow>

              <SettingRow
                label="Ballistic Hitmarker Confirmation"
                hint="Shows crisp tactical hit and headshot confirmation ticks at reticle center."
              >
                <Switch
                  aria-label="Hitmarker Feedback"
                  checked={gameplay.showHitmarkers}
                  onCheckedChange={(showHitmarkers) => updateGameplay({ showHitmarkers })}
                />
              </SettingRow>

              <SettingRow
                label="Floating Damage Numbers"
                hint="Optional numeric hit readouts for ballistic range verification."
              >
                <Switch
                  aria-label="Show Damage Numbers"
                  checked={gameplay.showDamageNumbers}
                  onCheckedChange={(showDamageNumbers) => updateGameplay({ showDamageNumbers })}
                />
              </SettingRow>

              <SettingRow
                label={`Camera Shake Intensity (${Math.round(gameplay.cameraShakeIntensity * 100)}%)`}
                hint="Scales explosion and weapon recoil camera impulse (0% disables shake)."
              >
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="Camera Shake Intensity"
                    value={gameplay.cameraShakeIntensity}
                    min={0}
                    max={1.2}
                    step={0.05}
                    onValueChange={(cameraShakeIntensity) =>
                      updateGameplay({ cameraShakeIntensity })
                    }
                  />
                </div>
              </SettingRow>

              <SettingRow label="Hold to Sprint" hint="Enable to hold Sprint key; disable for tap-to-toggle.">
                <Switch
                  aria-label="Hold to Sprint"
                  checked={gameplay.holdToSprint}
                  onCheckedChange={(holdToSprint) => updateGameplay({ holdToSprint })}
                />
              </SettingRow>

              <SettingRow label="Hold to Crouch" hint="Enable to hold Crouch key; disable for tap-to-toggle.">
                <Switch
                  aria-label="Hold to Crouch"
                  checked={gameplay.holdToCrouch}
                  onCheckedChange={(holdToCrouch) => updateGameplay({ holdToCrouch })}
                />
              </SettingRow>

              <SettingRow
                label="Auto-Reload on Empty Magazine"
                hint="Automatically initiates reload when firing an empty chamber."
              >
                <Switch
                  aria-label="Auto Reload on Empty"
                  checked={gameplay.autoReloadOnEmpty}
                  onCheckedChange={(autoReloadOnEmpty) => updateGameplay({ autoReloadOnEmpty })}
                />
              </SettingRow>
            </TabsContent>

            {/* 6. HUD */}
            <TabsContent value="hud" className="space-y-3">
              <SettingRow
                label="Tactical HUD Preset"
                hint="Minimal Diegetic attenuates non-critical chrome during combat while preserving threat clarity."
              >
                <Select
                  aria-label="HUD Preset"
                  value={hud.preset}
                  onValueChange={(v) => updateHud({ preset: HudPresetSchema.parse(v) })}
                  options={[
                    { value: 'minimal_diegetic', label: 'Minimal Diegetic (Recommended)' },
                    { value: 'immersive', label: 'Immersive Low-Chrome' },
                    { value: 'full_tactical', label: 'Full Tactical Telemetry' },
                  ]}
                />
              </SettingRow>

              <SettingRow label={`HUD Master Opacity (${Math.round(hud.opacity * 100)}%)`}>
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="HUD Master Opacity"
                    value={hud.opacity}
                    min={0.45}
                    max={1.0}
                    step={0.05}
                    onValueChange={(opacity) => updateHud({ opacity })}
                  />
                </div>
              </SettingRow>

              <SettingRow label={`HUD Scale (${Math.round(hud.scale * 100)}%)`}>
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="HUD Scale Slider"
                    value={hud.scale}
                    min={0.85}
                    max={1.25}
                    step={0.05}
                    onValueChange={(scale) => updateHud({ scale })}
                  />
                </div>
              </SettingRow>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <ToggleCard
                  label="Top Compass Strip"
                  checked={hud.showCompass}
                  onChange={(showCompass) => updateHud({ showCompass })}
                />
                <ToggleCard
                  label="Tactical Radar Mini-Map"
                  checked={hud.showRadar}
                  onChange={(showRadar) => updateHud({ showRadar })}
                />
                <ToggleCard
                  label="Objective Waypoint Markers"
                  checked={hud.showObjectiveMarkers}
                  onChange={(showObjectiveMarkers) => updateHud({ showObjectiveMarkers })}
                />
                <ToggleCard
                  label="Combat Kill Feed"
                  checked={hud.showKillfeed}
                  onChange={(showKillfeed) => updateHud({ showKillfeed })}
                />
                <ToggleCard
                  label="Fireteam Squad Roster"
                  checked={hud.showSquadRoster}
                  onChange={(showSquadRoster) => updateHud({ showSquadRoster })}
                />
                <ToggleCard
                  label="Dynamic Recoil Crosshair Expansion"
                  checked={hud.crosshairDynamicSpread}
                  onChange={(crosshairDynamicSpread) => updateHud({ crosshairDynamicSpread })}
                />
              </div>

              {/* Crosshair Customization Builder + Live Preview */}
              <div className="bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] rounded-sm p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Crosshair className="w-4 h-4 text-[var(--vg-accent-amber)]" />
                    <span className="font-mono text-xs uppercase tracking-wider text-[var(--vg-text-primary)]">
                      Crosshair Optics Calibration
                    </span>
                  </div>
                  <div
                    data-testid="crosshair-live-preview"
                    className="w-20 h-14 bg-[#080B0F] border border-[var(--vg-border-subtle)] rounded-sm flex items-center justify-center relative"
                  >
                    <CrosshairPreview
                      style={hud.crosshairStyle}
                      color={hud.crosshairColor}
                      thickness={hud.crosshairThickness}
                      gap={hud.crosshairGap}
                    />
                  </div>
                </div>

                <SettingRow label="Reticle Geometry">
                  <Select
                    aria-label="Crosshair Style"
                    value={hud.crosshairStyle}
                    onValueChange={(v) =>
                      updateHud({ crosshairStyle: CrosshairStyleSchema.parse(v) })
                    }
                    options={[
                      { value: 'tactical', label: 'Tactical Mil-Dot' },
                      { value: 'classic', label: 'Classic Cross' },
                      { value: 'dot', label: 'Center Precision Dot' },
                      { value: 'dynamic', label: 'Dynamic Spread Arms' },
                    ]}
                  />
                </SettingRow>

                <SettingRow label="Reticle Color">
                  <div className="flex items-center gap-2">
                    {CROSSHAIR_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`Set crosshair color ${hex}`}
                        onClick={() => updateHud({ crosshairColor: hex })}
                        className={`w-7 h-7 rounded-sm border-2 cursor-pointer ${
                          hud.crosshairColor === hex
                            ? 'border-white scale-110'
                            : 'border-[var(--vg-border-subtle)]'
                        }`}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </SettingRow>

                <SettingRow label={`Reticle Thickness (${hud.crosshairThickness.toFixed(1)}px)`}>
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Crosshair Thickness"
                      value={hud.crosshairThickness}
                      min={1}
                      max={4}
                      step={0.5}
                      onValueChange={(crosshairThickness) => updateHud({ crosshairThickness })}
                    />
                  </div>
                </SettingRow>

                <SettingRow label={`Center Gap (${hud.crosshairGap}px)`}>
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Crosshair Gap"
                      value={hud.crosshairGap}
                      min={2}
                      max={12}
                      step={1}
                      onValueChange={(crosshairGap) => updateHud({ crosshairGap })}
                    />
                  </div>
                </SettingRow>
              </div>
            </TabsContent>

            {/* 7. ACCESSIBILITY */}
            <TabsContent value="accessibility" className="space-y-3">
              <SettingRow
                label="Colorblind Tactical Palette"
                hint="Adapts threat markers, objectives, and reticle highlights across UI and HUD."
              >
                <Select
                  aria-label="Colorblind Mode"
                  value={accessibility.colorblindMode}
                  onValueChange={(v) =>
                    updateAccessibility({ colorblindMode: ColorblindModeSchema.parse(v) })
                  }
                  options={[
                    { value: 'standard', label: 'Standard (Amber / Crimson)' },
                    { value: 'deuteranopia', label: 'Deuteranopia (Blue / Gold)' },
                    { value: 'protanopia', label: 'Protanopia (Cyan / Amber)' },
                    { value: 'tritanopia', label: 'Tritanopia (Emerald / Rose)' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label="High Contrast Structural Borders"
                hint="Boosts panel edge contrast and brightens secondary text for low-vision clarity."
              >
                <Switch
                  aria-label="High Contrast Borders"
                  checked={accessibility.highContrastBorders}
                  onCheckedChange={(highContrastBorders) =>
                    updateAccessibility({ highContrastBorders })
                  }
                />
              </SettingRow>

              <SettingRow
                label="Reduced Motion"
                hint="Disables non-essential UI animations, menu parallax, and rapid flashes."
              >
                <Switch
                  aria-label="Reduced Motion"
                  checked={accessibility.reducedMotion}
                  onCheckedChange={(reducedMotion) => updateAccessibility({ reducedMotion })}
                />
              </SettingRow>

              <SettingRow
                label="Tactical Radio Subtitles"
                hint="Displays concise radio dispatches for mission stages, reinforcements, and extraction."
              >
                <Switch
                  aria-label="Tactical Radio Subtitles"
                  checked={accessibility.subtitles}
                  onCheckedChange={(subtitles) => updateAccessibility({ subtitles })}
                />
              </SettingRow>

              <SettingRow label="Subtitle Text Size">
                <Select
                  aria-label="Subtitle Size"
                  value={accessibility.subtitleSize}
                  onValueChange={(v) =>
                    updateAccessibility({
                      subtitleSize: v === 'sm' || v === 'lg' ? v : 'md',
                    })
                  }
                  options={[
                    { value: 'sm', label: 'Compact (12px)' },
                    { value: 'md', label: 'Standard (14px)' },
                    { value: 'lg', label: 'Large (18px)' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label="High-Contrast Subtitle Backdrop"
                hint="Places a darkened plate behind radio dialogue for readability over bright explosions."
              >
                <Switch
                  aria-label="Subtitle Backdrop"
                  checked={accessibility.subtitleBackdrop}
                  onCheckedChange={(subtitleBackdrop) =>
                    updateAccessibility({ subtitleBackdrop })
                  }
                />
              </SettingRow>

              <SettingRow label="Large Interface Typography">
                <Switch
                  aria-label="Large Text"
                  checked={accessibility.largeTextMode}
                  onCheckedChange={(largeTextMode) => updateAccessibility({ largeTextMode })}
                />
              </SettingRow>
            </TabsContent>

            {/* 8. DEVELOPER TOOLS (Strictly gated by isEnvDevModeAllowed) */}
            {isEnvDevModeAllowed() && (
              <TabsContent value="developer" className="space-y-3">
                <SettingRow
                  label="Enable Developer Mode Tools (Dev Env Only)"
                  hint="Allows [F4] Combat Diagnostics, [F3] Engine Metrics, and 3D gizmos."
                >
                  <Switch
                    checked={developer.devModeEnabled}
                    onCheckedChange={(devModeEnabled) => updateDeveloper({ devModeEnabled })}
                  />
                </SettingRow>

                <div
                  className={
                    !developer.devModeEnabled
                      ? 'opacity-50 pointer-events-none space-y-3'
                      : 'space-y-3'
                  }
                >
                  <SettingRow
                    label="Combat AI Debug Overlay ([F4])"
                    hint="Inspect Squad Coordinator tokens, enemy awareness states, and cover raycasts."
                  >
                    <Switch
                      checked={developer.devModeEnabled && developer.combatDebugOverlay}
                      onCheckedChange={(combatDebugOverlay) =>
                        uiStore.getState().setCombatDebugOpen(combatDebugOverlay)
                      }
                    />
                  </SettingRow>

                  <SettingRow label="3D World-Space AI & Ballistic Gizmos">
                    <Switch
                      checked={developer.debugShow3DGizmos}
                      onCheckedChange={(debugShow3DGizmos) =>
                        updateDeveloper({ debugShow3DGizmos })
                      }
                    />
                  </SettingRow>

                  <SettingRow label="Sandbox Ordnance Authorization">
                    <Switch
                      checked={developer.sandboxOrdnanceAuthorized}
                      onCheckedChange={(sandboxOrdnanceAuthorized) =>
                        updateDeveloper({ sandboxOrdnanceAuthorized })
                      }
                    />
                  </SettingRow>
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>

      {hudEditorOpen && <MobileHudEditorModal onClose={() => setHudEditorOpen(false)} />}

      <ConfirmDialog
        open={confirmResetAllOpen}
        onOpenChange={setConfirmResetAllOpen}
        title="Reset All Settings?"
        description="This restores Display, Graphics, Audio, Controls, Gameplay, HUD, and Accessibility settings to factory tactical defaults. Campaign progress and Armory unlocks are not affected."
        confirmLabel="Reset All Settings"
        variant="danger"
        onConfirm={handleResetAllConfirmed}
      />

      <ConfirmDialog
        open={pendingLeaveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLeaveTarget(null);
        }}
        title="Save Settings Before Leaving?"
        description="You changed configuration values during this session. Save and continue, or cancel to keep adjusting."
        confirmLabel="Save & Leave"
        cancelLabel="Stay in Settings"
        onConfirm={() => {
          commitBaseline();
          if (pendingLeaveTarget) executeNavigation(pendingLeaveTarget);
        }}
      />
    </div>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 bg-[var(--vg-bg-recessed)]/85 border border-[var(--vg-border-subtle)] px-3 sm:px-4 py-2.5 sm:py-3 rounded-sm">
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--vg-text-primary)]">{label}</div>
        {hint && <div className="text-xs text-[var(--vg-text-muted)] mt-0.5">{hint}</div>}
      </div>
      <div className="w-full sm:w-auto sm:shrink-0 max-w-full">{children}</div>
    </div>
  );
}

function ToggleCard({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] px-3.5 py-2.5 rounded-sm">
      <span className="text-xs font-medium text-[var(--vg-text-primary)]">{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function TelemetryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--vg-bg-panel)] border border-[var(--vg-border-subtle)] px-2.5 py-1.5 rounded-sm">
      <div className="text-[9px] uppercase text-[var(--vg-text-muted)]">{label}</div>
      <div className="text-xs font-bold text-[var(--vg-text-primary)] truncate mt-0.5">
        {value}
      </div>
    </div>
  );
}

function CrosshairPreview({
  style,
  color,
  thickness,
  gap,
}: {
  style: string;
  color: string;
  thickness: number;
  gap: number;
}) {
  const g = Math.max(2, Math.min(10, Math.round(gap * 0.6)));
  const t = Math.max(1, Math.min(4, thickness));
  if (style === 'dot') {
    return (
      <span
        className="rounded-full"
        style={{ width: t + 3, height: t + 3, backgroundColor: color }}
      />
    );
  }
  if (style === 'chevron') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <polyline
          points="7,15 12,10 17,15"
          fill="none"
          stroke={color}
          strokeWidth={t}
          strokeLinecap="square"
        />
      </svg>
    );
  }
  return (
    <div className="relative w-12 h-12 flex items-center justify-center">
      <span
        className="absolute"
        style={{ width: t, height: 8, backgroundColor: color, transform: `translateY(-${g + 5}px)` }}
      />
      <span
        className="absolute"
        style={{ width: t, height: 8, backgroundColor: color, transform: `translateY(${g + 5}px)` }}
      />
      <span
        className="absolute"
        style={{ width: 8, height: t, backgroundColor: color, transform: `translateX(-${g + 5}px)` }}
      />
      <span
        className="absolute"
        style={{ width: 8, height: t, backgroundColor: color, transform: `translateX(${g + 5}px)` }}
      />
      {style === 'tactical' && (
        <span
          className="rounded-full"
          style={{ width: Math.max(2, t), height: Math.max(2, t), backgroundColor: color }}
        />
      )}
    </div>
  );
}
