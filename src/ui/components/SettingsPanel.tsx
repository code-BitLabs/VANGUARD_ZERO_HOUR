import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Hand, Play, RotateCcw, Target } from 'lucide-react';
import { GpuCapabilityReport } from '@/src/engine/GpuCapabilityDetector';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { ColorblindModeSchema, QualityTierSchema } from '@/src/schemas/common.schema';
import {
  AudioSettingsSchema,
  ControlBindings,
  ControlBindingsSchema,
  DEFAULT_THREE_FINGER_ADS_POS,
  DEFAULT_THREE_FINGER_FIRE_POS,
  DEFAULT_TWO_FINGER_ADS_POS,
  DEFAULT_TWO_FINGER_FIRE_POS,
  DrawDistanceSettingSchema,
  FpsCapSchema,
  SubQualityLevelSchema,
  TouchAdsModeSchema,
  TouchControlProfileSchema,
  TouchFireBehaviorSchema,
  TouchModeSchema,
} from '@/src/schemas/settings.schema';
import { useAudioSettingsStore } from '@/src/stores/audioSettingsStore';
import { useSettingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { Button } from '@/src/ui/primitives/Button';
import { Select, Slider, Switch } from '@/src/ui/primitives/Controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/src/ui/primitives/Tabs';

const BINDING_LABELS: Array<{ key: keyof ControlBindings; label: string }> = [
  { key: 'forward', label: 'Move Forward' },
  { key: 'backward', label: 'Move Backward' },
  { key: 'left', label: 'Strafe Left' },
  { key: 'right', label: 'Strafe Right' },
  { key: 'sprint', label: 'Sprint' },
  { key: 'jump', label: 'Jump' },
  { key: 'crouch', label: 'Crouch / Slide' },
  { key: 'reload', label: 'Reload' },
  { key: 'interact', label: 'Interact / Vehicle' },
  { key: 'vehicleCamera', label: 'Cycle Vehicle Camera' },
  { key: 'grenade', label: 'Throw Grenade' },
  { key: 'fireMode', label: 'Cycle Fire Mode' },
  { key: 'c4', label: 'Place / Detonate C4' },
  { key: 'bombStrike', label: 'Call Bomb Strike ([Shift]+Cycle)' },
  { key: 'strategicNuke', label: 'Strategic Strike Request' },
];

export function SettingsPanel({
  onBack,
  onResumeAndTest,
  gpuReport = null,
  onReapplyAutoGraphics,
}: {
  onBack: () => void;
  onResumeAndTest?: () => void;
  gpuReport?: GpuCapabilityReport | null;
  onReapplyAutoGraphics?: () => GpuCapabilityReport | null;
}) {
  const graphics = useSettingsStore((s) => s.graphics);
  const input = useSettingsStore((s) => s.input);
  const accessibility = useSettingsStore((s) => s.accessibility);
  const developer = useSettingsStore((s) => s.developer);
  const updateGraphics = useSettingsStore((s) => s.updateGraphics);
  const updateInput = useSettingsStore((s) => s.updateInput);
  const updateBinding = useSettingsStore((s) => s.updateBinding);
  const updateAccessibility = useSettingsStore((s) => s.updateAccessibility);
  const updateDeveloper = useSettingsStore((s) => s.updateDeveloper);
  const resetDefaults = useSettingsStore((s) => s.resetDefaults);

  const audio = useAudioSettingsStore((s) => s);
  const [rebindingAction, setRebindingAction] = useState<keyof ControlBindings | null>(null);
  const [latestGpuReport, setLatestGpuReport] = useState<GpuCapabilityReport | null>(gpuReport);

  useEffect(() => {
    setLatestGpuReport(gpuReport);
  }, [gpuReport]);

  useEffect(() => {
    if (!rebindingAction) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        const validated = ControlBindingsSchema.safeParse({
          ...input.bindings,
          [rebindingAction]: e.code,
        });
        if (validated.success) {
          updateBinding(rebindingAction, e.code);
        }
      }
      setRebindingAction(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [rebindingAction, input.bindings, updateBinding]);

  const handleResetAll = () => {
    resetDefaults();
    audio.resetAudio();
    uiStore.getState().showToast('Settings Restored', 'All graphics, audio, and keybindings reset.', 'info');
  };

  const handleRedetect = () => {
    const report = onReapplyAutoGraphics?.() ?? null;
    if (report) {
      setLatestGpuReport(report);
      uiStore
        .getState()
        .showToast(
          'Optimal Graphics Applied',
          `Auto mode selected ${report.recommendedTier.toUpperCase()} preset (score ${report.score}/100).`,
          'info'
        );
    } else {
      updateGraphics({ qualityMode: 'auto' }, { preserveAutoMode: true });
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 bg-[#0B0E11]/95 flex items-center justify-center"
      style={{
        paddingTop: 'max(8px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(10px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(10px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="w-full max-w-4xl bg-[#141920] border border-zinc-800 rounded-sm shadow-2xl flex flex-col max-h-[96dvh]">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-zinc-800 shrink-0">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-500">System Configuration</p>
            <h2 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-wider text-zinc-100">
              Settings
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={handleResetAll}>
              <RotateCcw className="w-3.5 h-3.5" /> Reset Defaults
            </Button>
            <Button variant="secondary" size="sm" className="min-h-[44px] px-4" onClick={onBack}>
              Done
            </Button>
          </div>
        </div>

        <Tabs defaultValue="graphics" className="flex-1 flex flex-col overflow-hidden p-3 sm:p-5">
          <TabsList className="mb-3 sm:mb-4 self-start flex-wrap">
            <TabsTrigger value="graphics" className="min-h-[40px]">Graphics</TabsTrigger>
            <TabsTrigger value="audio" className="min-h-[40px]">Audio</TabsTrigger>
            <TabsTrigger value="controls" className="min-h-[40px]">Controls &amp; Keys</TabsTrigger>
            <TabsTrigger value="accessibility" className="min-h-[40px]">Accessibility</TabsTrigger>
            {isEnvDevModeAllowed() && (
              <TabsTrigger value="developer" className="min-h-[40px]">Developer Tools</TabsTrigger>
            )}
          </TabsList>

          <div className="flex-1 overflow-y-auto pr-1 space-y-3 sm:space-y-4">
            <TabsContent value="graphics" className="space-y-3">
              <SettingRow
                label={`Graphics Mode: ${graphics.qualityMode === 'auto' ? 'Auto (Device Tuned)' : 'Manual Override'}`}
                hint={
                  latestGpuReport
                    ? `Hardware probe score ${latestGpuReport.score}/100 · WebGL${latestGpuReport.signals.webglVersion || '?'} · Recommended ${latestGpuReport.recommendedTier.toUpperCase()}${
                        latestGpuReport.signals.rendererHint ? ` · ${latestGpuReport.signals.rendererHint}` : ''
                      }`
                    : 'Auto mode detects hardware tier once. Editing any visual setting switches to Manual.'
                }
              >
                <Button variant="outline" size="sm" className="min-h-[44px]" onClick={handleRedetect}>
                  Re-Detect Optimal Preset
                </Button>
              </SettingRow>

              <SettingRow label="Quality Preset" hint="Sets baseline shadow, draw distance, and particle profile.">
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
                label={`Render Scale (${Math.round(graphics.renderScale * 100)}%)`}
                hint="Internal 3D resolution scale (lower improves mobile frame rate)."
              >
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="Render Scale"
                    value={graphics.renderScale}
                    min={0.5}
                    max={1.0}
                    step={0.05}
                    onValueChange={(renderScale) => updateGraphics({ renderScale })}
                  />
                </div>
              </SettingRow>

              <SettingRow label="Texture Quality" hint="Procedural material resolution and anisotropic filtering.">
                <Select
                  aria-label="Texture Quality"
                  value={graphics.textureQuality}
                  onValueChange={(v) => updateGraphics({ textureQuality: SubQualityLevelSchema.parse(v) })}
                  options={[
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                  ]}
                />
              </SettingRow>

              <SettingRow label="Effects & Particle Budget">
                <Select
                  aria-label="Effects Quality"
                  value={graphics.effectsQuality}
                  onValueChange={(v) => updateGraphics({ effectsQuality: SubQualityLevelSchema.parse(v) })}
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
                  onValueChange={(v) => updateGraphics({ drawDistance: DrawDistanceSettingSchema.parse(v) })}
                  options={[
                    { value: 'auto', label: 'Auto (Follows Preset)' },
                    { value: 'short', label: 'Short (160m)' },
                    { value: 'medium', label: 'Medium (260m)' },
                    { value: 'long', label: 'Long (380m)' },
                    { value: 'ultra', label: 'Ultra (520m)' },
                  ]}
                />
              </SettingRow>

              <SettingRow label="Frame Rate Cap" hint="Limit frame rate to reduce mobile battery drain and heat.">
                <Select
                  aria-label="Frame Rate Cap"
                  value={String(graphics.fpsCap)}
                  onValueChange={(v) => updateGraphics({ fpsCap: FpsCapSchema.parse(Number(v)) })}
                  options={[
                    { value: '0', label: 'Uncapped (Display Sync)' },
                    { value: '30', label: '30 FPS (Battery Saver)' },
                    { value: '60', label: '60 FPS' },
                    { value: '120', label: '120 FPS' },
                  ]}
                />
              </SettingRow>

              <SettingRow label="Antialiasing" hint="Hardware MSAA on direct render path or post-process edge smoothing.">
                <Switch
                  checked={graphics.antialiasing}
                  onCheckedChange={(antialiasing) => updateGraphics({ antialiasing })}
                />
              </SettingRow>

              <SettingRow label={`Field of View (${graphics.fov}°)`} hint="Horizontal camera angle while on foot.">
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="Field of View"
                    value={graphics.fov}
                    min={65}
                    max={110}
                    step={1}
                    onValueChange={(fov) => updateGraphics({ fov })}
                  />
                </div>
              </SettingRow>

              <SettingRow label={`Head Bob Intensity (${Math.round(graphics.headBobIntensity * 100)}%)`}>
                <div className="w-48 sm:w-52">
                  <Slider
                    aria-label="Head Bob Intensity"
                    value={graphics.headBobIntensity}
                    min={0}
                    max={1.5}
                    step={0.1}
                    onValueChange={(headBobIntensity) => updateGraphics({ headBobIntensity })}
                  />
                </div>
              </SettingRow>

              <SettingRow
                label="Adaptive Performance Governor"
                hint="Dynamically trims render scale if frame times sustain above 19ms without exceeding your caps."
              >
                <Switch
                  checked={graphics.adaptiveGovernor}
                  onCheckedChange={(adaptiveGovernor) =>
                    updateGraphics({ adaptiveGovernor }, { preserveAutoMode: true })
                  }
                />
              </SettingRow>

              <SettingRow label="Dynamic Shadows">
                <Switch
                  checked={graphics.shadowsEnabled}
                  onCheckedChange={(shadowsEnabled) => updateGraphics({ shadowsEnabled })}
                />
              </SettingRow>

              <SettingRow label="Post-Processing Bloom & Vignette">
                <Switch
                  checked={graphics.bloomEnabled}
                  onCheckedChange={(bloomEnabled) => updateGraphics({ bloomEnabled })}
                />
              </SettingRow>
            </TabsContent>

            <TabsContent value="audio" className="space-y-4">
              <SettingRow label="Mute All Audio">
                <Switch
                  checked={audio.muted}
                  onCheckedChange={(muted) => audio.updateAudio({ muted })}
                />
              </SettingRow>

              <SettingRow label={`Master Volume (${Math.round(audio.masterVolume * 100)}%)`}>
                <div className="w-52">
                  <Slider
                    aria-label="Master Volume"
                    value={audio.masterVolume}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={(v) => audio.updateAudio(AudioSettingsSchema.partial().parse({ masterVolume: v }))}
                  />
                </div>
              </SettingRow>

              <SettingRow label={`Combat SFX (${Math.round(audio.sfxVolume * 100)}%)`}>
                <div className="w-52">
                  <Slider
                    aria-label="Combat SFX"
                    value={audio.sfxVolume}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={(sfxVolume) => audio.updateAudio({ sfxVolume })}
                  />
                </div>
              </SettingRow>

              <SettingRow label={`Tactical Score Music (${Math.round(audio.musicVolume * 100)}%)`}>
                <div className="w-52">
                  <Slider
                    aria-label="Music Volume"
                    value={audio.musicVolume}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={(musicVolume) => audio.updateAudio({ musicVolume })}
                  />
                </div>
              </SettingRow>

              <SettingRow label={`Battlefield Ambience (${Math.round(audio.ambienceVolume * 100)}%)`}>
                <div className="w-52">
                  <Slider
                    aria-label="Ambience Volume"
                    value={audio.ambienceVolume}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={(ambienceVolume) => audio.updateAudio({ ambienceVolume })}
                  />
                </div>
              </SettingRow>
            </TabsContent>

            <TabsContent value="controls" className="space-y-4">
              <SettingRow label={`Mouse Sensitivity (${input.mouseSensitivity.toFixed(2)}x)`}>
                <div className="w-52">
                  <Slider
                    aria-label="Mouse Sensitivity"
                    value={input.mouseSensitivity}
                    min={0.2}
                    max={3.5}
                    step={0.05}
                    onValueChange={(mouseSensitivity) => updateInput({ mouseSensitivity })}
                  />
                </div>
              </SettingRow>

              <SettingRow label={`ADS Aim Sensitivity (${input.adsSensitivity.toFixed(2)}x)`}>
                <div className="w-52">
                  <Slider
                    aria-label="ADS Sensitivity"
                    value={input.adsSensitivity}
                    min={0.2}
                    max={1.5}
                    step={0.05}
                    onValueChange={(adsSensitivity) => updateInput({ adsSensitivity })}
                  />
                </div>
              </SettingRow>

              <SettingRow label="Invert Look Y-Axis">
                <Switch checked={input.invertY} onCheckedChange={(invertY) => updateInput({ invertY })} />
              </SettingRow>

              <SettingRow label="Gamepad Support">
                <Switch
                  checked={input.gamepadEnabled}
                  onCheckedChange={(gamepadEnabled) => updateInput({ gamepadEnabled })}
                />
              </SettingRow>

              <div className="pt-2 border-t border-zinc-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wider text-amber-400">
                      Mobile &amp; Touch Controls
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Choose Two-Finger (Thumb) or Three-Finger (Claw), preview the HUD, and customize button positions.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {uiStore.getState().previousMenuScreen === 'paused' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        data-testid="test-controls-in-mission"
                        className="min-h-[36px] text-[11px]"
                        onClick={onResumeAndTest ?? onBack}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" /> Resume &amp; Test Controls
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="reset-mobile-controls"
                      className="min-h-[36px] text-[11px]"
                      onClick={() => {
                        updateInput({
                          touchSensitivity: 1.15,
                          touchLookSmoothing: 0,
                          touchJoystickScale: 1.0,
                          touchDeadzone: 0.1,
                          touchButtonScale: 1.0,
                          touchFireButtonScale: 1.0,
                          touchButtonOpacity: 0.72,
                          touchFirePosTwoFinger: { ...DEFAULT_TWO_FINGER_FIRE_POS },
                          touchFirePosThreeFinger: { ...DEFAULT_THREE_FINGER_FIRE_POS },
                          touchAdsPosTwoFinger: { ...DEFAULT_TWO_FINGER_ADS_POS },
                          touchAdsPosThreeFinger: { ...DEFAULT_THREE_FINGER_ADS_POS },
                          touchFireOffsetX: 0,
                          touchFireOffsetY: 0,
                          touchAdsOffsetX: 0,
                          touchAdsOffsetY: 0,
                        });
                        uiStore
                          .getState()
                          .showToast('Mobile Controls Reset', 'Positions, sizes, and sensitivity restored.', 'info');
                      }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reset Mobile Controls
                    </Button>
                  </div>
                </div>

                {/* 1. Select Two-Finger or Three-Finger Control Profile */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    data-testid="profile-two-finger"
                    aria-pressed={input.touchControlProfile === 'two_finger'}
                    onClick={() => updateInput({ touchControlProfile: TouchControlProfileSchema.parse('two_finger') })}
                    className={`text-left p-3 rounded-sm border transition-colors ${
                      input.touchControlProfile === 'two_finger'
                        ? 'bg-amber-500/15 border-amber-400 text-zinc-100'
                        : 'bg-[#0B0E11]/75 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                        <Hand className="w-4 h-4 text-amber-400" /> Two-Finger / Thumb Mode
                      </span>
                      {input.touchControlProfile === 'two_finger' && (
                        <span className="font-mono text-[10px] uppercase text-amber-400 font-bold">Active</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      Left Thumb: 360° Joystick · Right Thumb: Free 360° Camera Look + Ergonomic Right-Side Fire &amp; ADS.
                    </p>
                  </button>

                  <button
                    type="button"
                    data-testid="profile-three-finger"
                    aria-pressed={input.touchControlProfile === 'three_finger'}
                    onClick={() => updateInput({ touchControlProfile: TouchControlProfileSchema.parse('three_finger') })}
                    className={`text-left p-3 rounded-sm border transition-colors ${
                      input.touchControlProfile === 'three_finger'
                        ? 'bg-amber-500/15 border-amber-400 text-zinc-100'
                        : 'bg-[#0B0E11]/75 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                        <Hand className="w-4 h-4 text-cyan-400" /> Three-Finger / Claw Mode
                      </span>
                      {input.touchControlProfile === 'three_finger' && (
                        <span className="font-mono text-[10px] uppercase text-amber-400 font-bold">Active</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      Left Thumb: 360° Joystick · Left Index Finger: Upper-Left Fire · Right Thumb: Unobstructed 360° Aim + ADS.
                    </p>
                  </button>
                </div>

                {/* 2. Interactive Control Layout Preview (Drag FIRE or ADS directly to customize) */}
                <MobileControlLayoutPreview />

                <SettingRow
                  label="Touch HUD Mode"
                  hint="Auto displays twin-stick touch controls on touch/coarse devices; HUD toggle overrides per session."
                >
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

                <SettingRow
                  label={`Touch Look Smoothing (${Math.round(input.touchLookSmoothing * 100)}%)`}
                  hint="Low-latency aim smoothing (0% = raw 1:1 pointer delta)."
                >
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Touch Look Smoothing"
                      value={input.touchLookSmoothing}
                      min={0}
                      max={0.6}
                      step={0.05}
                      onValueChange={(touchLookSmoothing) => updateInput({ touchLookSmoothing })}
                    />
                  </div>
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

                <SettingRow label={`Joystick Size (${Math.round(input.touchJoystickScale * 100)}%)`}>
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Joystick Size"
                      value={input.touchJoystickScale}
                      min={0.75}
                      max={1.35}
                      step={0.05}
                      onValueChange={(touchJoystickScale) => updateInput({ touchJoystickScale })}
                    />
                  </div>
                </SettingRow>

                <SettingRow label={`Joystick Deadzone (${Math.round(input.touchDeadzone * 100)}%)`}>
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Joystick Deadzone"
                      value={input.touchDeadzone}
                      min={0.05}
                      max={0.28}
                      step={0.01}
                      onValueChange={(touchDeadzone) => updateInput({ touchDeadzone })}
                    />
                  </div>
                </SettingRow>

                <SettingRow label={`Touch Button Scale (${Math.round(input.touchButtonScale * 100)}%)`}>
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Touch Button Scale"
                      value={input.touchButtonScale}
                      min={0.75}
                      max={1.35}
                      step={0.05}
                      onValueChange={(touchButtonScale) => updateInput({ touchButtonScale })}
                    />
                  </div>
                </SettingRow>

                <SettingRow label={`Touch Overlay Opacity (${Math.round(input.touchButtonOpacity * 100)}%)`}>
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Touch Overlay Opacity"
                      value={input.touchButtonOpacity}
                      min={0.35}
                      max={0.95}
                      step={0.05}
                      onValueChange={(touchButtonOpacity) => updateInput({ touchButtonOpacity })}
                    />
                  </div>
                </SettingRow>

                <SettingRow
                  label="Auto-Sprint on Forward Stick"
                  hint="Engages sprint only when pushing forward past threshold (never while strafing or backing up)."
                >
                  <Switch
                    checked={input.autoSprint}
                    onCheckedChange={(autoSprint) => updateInput({ autoSprint })}
                  />
                </SettingRow>

                <SettingRow label={`Auto-Sprint Threshold (${Math.round(input.touchAutoSprintThreshold * 100)}%)`}>
                  <div className="w-48 sm:w-52">
                    <Slider
                      aria-label="Auto-Sprint Threshold"
                      value={input.touchAutoSprintThreshold}
                      min={0.65}
                      max={0.95}
                      step={0.05}
                      onValueChange={(touchAutoSprintThreshold) => updateInput({ touchAutoSprintThreshold })}
                    />
                  </div>
                </SettingRow>

                <SettingRow
                  label="Show Manual Sprint Override Button"
                  hint="Displays an optional Sprint toggle above the left joystick."
                >
                  <Switch
                    checked={input.touchManualSprintButton}
                    onCheckedChange={(touchManualSprintButton) => updateInput({ touchManualSprintButton })}
                  />
                </SettingRow>

                <SettingRow
                  label="ADS Touch Mode"
                  hint="Toggle Aim lets you tap ADS once to aim; Hold requires holding ADS."
                >
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

                <SettingRow
                  label="Touch Fire Behavior"
                  hint="Choose dedicated Fire + separate ADS, or automatic ADS while holding Fire."
                >
                  <Select
                    aria-label="Touch Fire Behavior"
                    value={input.touchFireBehavior}
                    onValueChange={(v) => updateInput({ touchFireBehavior: TouchFireBehaviorSchema.parse(v) })}
                    options={[
                      { value: 'dedicated', label: 'Dedicated Fire + ADS' },
                      { value: 'ads_on_fire', label: 'ADS While Firing' },
                    ]}
                  />
                </SettingRow>

                {(() => {
                  const isClaw = input.touchControlProfile === 'three_finger';
                  const firePos = isClaw ? input.touchFirePosThreeFinger : input.touchFirePosTwoFinger;
                  const adsPos = isClaw ? input.touchAdsPosThreeFinger : input.touchAdsPosTwoFinger;
                  return (
                    <>
                      <SettingRow
                        label={`Fire Button Position — ${isClaw ? 'Claw Mode' : 'Thumb Mode'} (X ${Math.round(
                          firePos.x * 100
                        )}% · Y ${Math.round(firePos.y * 100)}%)`}
                        hint="Normalized viewport-relative position (adapts automatically to all mobile screen sizes)."
                      >
                        <div className="flex flex-col gap-2 w-48 sm:w-52">
                          <Slider
                            aria-label="Fire Button Horizontal Position"
                            value={firePos.x}
                            min={0.05}
                            max={0.94}
                            step={0.01}
                            onValueChange={(x) =>
                              updateInput(
                                isClaw
                                  ? { touchFirePosThreeFinger: { ...firePos, x } }
                                  : { touchFirePosTwoFinger: { ...firePos, x } }
                              )
                            }
                          />
                          <Slider
                            aria-label="Fire Button Vertical Position"
                            value={firePos.y}
                            min={0.1}
                            max={0.9}
                            step={0.01}
                            onValueChange={(y) =>
                              updateInput(
                                isClaw
                                  ? { touchFirePosThreeFinger: { ...firePos, y } }
                                  : { touchFirePosTwoFinger: { ...firePos, y } }
                              )
                            }
                          />
                        </div>
                      </SettingRow>

                      <SettingRow
                        label={`ADS Button Position — ${isClaw ? 'Claw Mode' : 'Thumb Mode'} (X ${Math.round(
                          adsPos.x * 100
                        )}% · Y ${Math.round(adsPos.y * 100)}%)`}
                        hint="Normalized viewport-relative ADS position."
                      >
                        <div className="flex flex-col gap-2 w-48 sm:w-52">
                          <Slider
                            aria-label="ADS Button Horizontal Position"
                            value={adsPos.x}
                            min={0.05}
                            max={0.94}
                            step={0.01}
                            onValueChange={(x) =>
                              updateInput(
                                isClaw
                                  ? { touchAdsPosThreeFinger: { ...adsPos, x } }
                                  : { touchAdsPosTwoFinger: { ...adsPos, x } }
                              )
                            }
                          />
                          <Slider
                            aria-label="ADS Button Vertical Position"
                            value={adsPos.y}
                            min={0.1}
                            max={0.9}
                            step={0.01}
                            onValueChange={(y) =>
                              updateInput(
                                isClaw
                                  ? { touchAdsPosThreeFinger: { ...adsPos, y } }
                                  : { touchAdsPosTwoFinger: { ...adsPos, y } }
                              )
                            }
                          />
                        </div>
                      </SettingRow>
                    </>
                  );
                })()}
              </div>

              <div className="pt-2 border-t border-zinc-800">
                <p className="font-mono text-xs uppercase tracking-wider text-zinc-400 mb-3">
                  Key Bindings (Click any key to rebind)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {BINDING_LABELS.map((item) => {
                    const listening = rebindingAction === item.key;
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between bg-[#0B0E11] border border-zinc-800 px-3 py-2 rounded-sm"
                      >
                        <span className="text-xs text-zinc-300">{item.label}</span>
                        <Button
                          size="sm"
                          variant={listening ? 'primary' : 'outline'}
                          className="h-7 px-2.5 font-mono text-[11px]"
                          onClick={() => setRebindingAction(item.key)}
                        >
                          {listening ? 'Press Key...' : input.bindings[item.key]}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="accessibility" className="space-y-4">
              <SettingRow label="Colorblind Tactical Palette" hint="Adapts threat markers, objectives, and reticle highlights.">
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

              <SettingRow label="Tactical Radio Subtitles">
                <Switch
                  checked={accessibility.subtitles}
                  onCheckedChange={(subtitles) => updateAccessibility({ subtitles })}
                />
              </SettingRow>

              <SettingRow label="Reduced Motion">
                <Switch
                  checked={accessibility.reducedMotion}
                  onCheckedChange={(reducedMotion) => updateAccessibility({ reducedMotion })}
                />
              </SettingRow>

              <SettingRow label={`HUD Scale (${Math.round(accessibility.uiScale * 100)}%)`}>
                <div className="w-52">
                  <Slider
                    aria-label="HUD Scale"
                    value={accessibility.uiScale}
                    min={0.85}
                    max={1.25}
                    step={0.05}
                    onValueChange={(uiScale) => updateAccessibility({ uiScale })}
                  />
                </div>
              </SettingRow>
            </TabsContent>

            {isEnvDevModeAllowed() && (
              <TabsContent value="developer" className="space-y-4">
                <SettingRow
                  label="Enable Developer Mode Tools (Dev Env Only)"
                  hint="Allows [F4] Combat Diagnostics, [F3] Engine Metrics, 3D gizmos, and QA Sandbox options. Automatically disabled in release builds (VITE_DEV_MODE=false)."
                >
                  <Switch
                    checked={developer.devModeEnabled}
                    onCheckedChange={(devModeEnabled) => updateDeveloper({ devModeEnabled })}
                  />
                </SettingRow>

                <div className={!developer.devModeEnabled ? 'opacity-50 pointer-events-none space-y-4' : 'space-y-4'}>
                  <SettingRow
                    label="Combat AI Debug Overlay ([F4])"
                    hint="Inspect Squad Coordinator tokens, enemy awareness states, cover raycasts, and damage attribution."
                  >
                    <Switch
                      checked={developer.devModeEnabled && developer.combatDebugOverlay}
                      onCheckedChange={(combatDebugOverlay) =>
                        uiStore.getState().setCombatDebugOpen(combatDebugOverlay)
                      }
                    />
                  </SettingRow>

                  <SettingRow
                    label="3D World-Space AI & Ballistic Gizmos"
                    hint="Renders enemy FOV cones, LOS rays (green/red), Last Known Position wireframes, and active token crowns."
                  >
                    <Switch
                      checked={developer.debugShow3DGizmos}
                      onCheckedChange={(debugShow3DGizmos) => updateDeveloper({ debugShow3DGizmos })}
                    />
                  </SettingRow>

                  <SettingRow
                    label={`Debug Panel Opacity (${Math.round(developer.debugOverlayOpacity * 100)}%)`}
                    hint="Controls background transparency of the [F4] telemetry panel."
                  >
                    <div className="w-52">
                      <Slider
                        aria-label="Debug Panel Opacity"
                        value={developer.debugOverlayOpacity}
                        min={0.4}
                        max={0.98}
                        step={0.02}
                        onValueChange={(debugOverlayOpacity) => updateDeveloper({ debugOverlayOpacity })}
                      />
                    </div>
                  </SettingRow>

                  <SettingRow
                    label="Telemetry Panel Dock Position"
                    hint="Anchors the [F4] inspector panel to the left or right edge of the viewport."
                  >
                    <Select
                      aria-label="Telemetry Panel Dock Position"
                      value={developer.debugDockSide}
                      onValueChange={(v) =>
                        updateDeveloper({ debugDockSide: v === 'left' ? 'left' : 'right' })
                      }
                      options={[
                        { value: 'right', label: 'Right Viewport Edge' },
                        { value: 'left', label: 'Left Viewport Edge' },
                      ]}
                    />
                  </SettingRow>

                  <SettingRow
                    label="Sandbox Ordnance Authorization"
                    hint="Bypasses Requisition point cost for Bomb Strikes ([V]) and TRIDENT-X Strategic Strike ([N]) during QA testing."
                  >
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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0B0E11]/75 border border-zinc-800/80 px-4 py-3 rounded-sm">
      <div>
        <div className="text-sm font-medium text-zinc-100">{label}</div>
        {hint && <div className="text-xs text-zinc-400 mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function MobileControlLayoutPreview() {
  const input = useSettingsStore((s) => s.input);
  const updateInput = useSettingsStore((s) => s.updateInput);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draggingTarget, setDraggingTarget] = useState<'fire' | 'ads' | null>(null);

  const isClaw = input.touchControlProfile === 'three_finger';
  const firePos = isClaw ? input.touchFirePosThreeFinger : input.touchFirePosTwoFinger;
  const adsPos = isClaw ? input.touchAdsPosThreeFinger : input.touchAdsPosTwoFinger;

  const applyPreviewDrag = (clientX: number, clientY: number, target: 'fire' | 'ads') => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Number(Math.max(0.05, Math.min(0.94, (clientX - rect.left) / rect.width)).toFixed(2));
    const y = Number(Math.max(0.1, Math.min(0.9, (clientY - rect.top) / rect.height)).toFixed(2));

    if (target === 'fire') {
      updateInput(
        isClaw
          ? { touchFirePosThreeFinger: { x, y } }
          : { touchFirePosTwoFinger: { x, y } }
      );
    } else {
      updateInput(
        isClaw
          ? { touchAdsPosThreeFinger: { x, y } }
          : { touchAdsPosTwoFinger: { x, y } }
      );
    }
  };

  const clawShiftsTopLeft =
    isClaw && input.touchFirePosThreeFinger.x < 0.32 && input.touchFirePosThreeFinger.y < 0.48;

  const previewStickSize = Math.round(54 * input.touchJoystickScale);
  const previewFireSize = Math.round(42 * input.touchButtonScale * input.touchFireButtonScale);
  const previewAdsSize = Math.round(30 * input.touchButtonScale);

  return (
    <div
      data-testid="control-layout-preview"
      data-profile={input.touchControlProfile}
      className="bg-[#0B0E11] border border-zinc-800 rounded-sm p-3 space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-200">
          Live Control Layout Preview —{' '}
          <span className="text-amber-400 font-bold">
            {isClaw ? 'Three-Finger Claw Mode' : 'Two-Finger Thumb Mode'}
          </span>
        </span>
        <span className="font-mono text-[10px] text-zinc-400">
          Drag <span className="text-amber-300">FIRE</span> or <span className="text-cyan-300">ADS</span> directly to reposition
        </span>
      </div>

      <div
        ref={containerRef}
        style={{ opacity: input.touchButtonOpacity, touchAction: 'none' }}
        onPointerMove={(e) => {
          if (!draggingTarget) return;
          e.stopPropagation();
          applyPreviewDrag(e.clientX, e.clientY, draggingTarget);
        }}
        onPointerUp={() => setDraggingTarget(null)}
        onPointerCancel={() => setDraggingTarget(null)}
        className="relative w-full aspect-[16/8.2] max-h-[230px] bg-gradient-to-b from-[#131922] via-[#10151c] to-[#0b0e12] border border-zinc-700/80 rounded-sm overflow-hidden select-none"
      >
        {/* Zone Split Guides */}
        <div
          className={`absolute left-0 w-[40%] bottom-0 border-r border-dashed border-amber-400/20 bg-amber-500/[0.03] flex items-end justify-start p-2 ${
            isClaw ? 'top-[44%] border-t' : 'top-0'
          }`}
        >
          <span className="font-mono text-[8px] uppercase text-amber-300/60">
            Left Thumb: 360° Move Zone
          </span>
        </div>
        {isClaw && (
          <div className="absolute left-0 top-0 w-[40%] h-[44%] border-r border-dashed border-red-400/20 bg-red-500/[0.03] p-1.5 flex items-start justify-start">
            <span className="font-mono text-[8px] uppercase text-red-300/70">
              Left Index: Claw Fire Zone
            </span>
          </div>
        )}
        <div className="absolute left-[40%] right-0 top-0 bottom-0 bg-cyan-500/[0.02] flex items-center justify-center">
          <span className="font-mono text-[9px] uppercase tracking-widest text-cyan-300/45">
            Right Thumb: Unrestricted 360° Camera Look Surface
          </span>
        </div>

        {/* Simulated Compact Top HUD */}
        <div
          data-testid="preview-top-left-hud"
          style={{ left: clawShiftsTopLeft ? '18%' : '2%' }}
          className="absolute top-1.5 flex items-center gap-1.5 bg-[#0B0E11]/85 border border-white/15 px-1.5 py-0.5 rounded-xs transition-all"
        >
          <div className="w-4 h-4 rounded-full border border-cyan-400/60 flex items-center justify-center">
            <div className="w-1 h-1 rounded-full bg-cyan-400" />
          </div>
          <div className="font-mono text-[8px] text-zinc-200 leading-tight">
            <div>OBJ: Radar Relays 1/2</div>
            <div className="text-[7px] text-emerald-400">ARM 100 · HP 100</div>
          </div>
        </div>

        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 bg-[#0B0E11]/80 border border-white/15 px-2 py-0.5 rounded-xs font-mono text-[8px] text-amber-400">
          360° N · SCORE 420 · 01:15
        </div>

        <div className="absolute top-1.5 right-2 bg-[#0B0E11]/80 border border-white/15 px-1.5 py-0.5 rounded-xs font-mono text-[8px] text-zinc-200">
          M4A1 30/120
        </div>

        {/* Simulated Left Thumbstick */}
        <div
          style={{ width: `${previewStickSize}px`, height: `${previewStickSize}px` }}
          className="absolute left-4 bottom-3 rounded-full bg-[#0B0E11]/65 border border-amber-400/60 flex items-center justify-center"
        >
          <div className="w-4 h-4 rounded-full bg-amber-400/80" />
        </div>

        {/* Draggable FIRE Handle */}
        <button
          type="button"
          data-testid="preview-fire-handle"
          aria-label="Preview Fire Button Position"
          onPointerDown={(e) => {
            e.stopPropagation();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Ignore
            }
            setDraggingTarget('fire');
          }}
          style={{
            left: `calc(${firePos.x * 100}% - ${previewFireSize / 2}px)`,
            top: `calc(${firePos.y * 100}% - ${previewFireSize / 2}px)`,
            width: `${previewFireSize}px`,
            height: `${previewFireSize}px`,
          }}
          className="absolute rounded-full bg-amber-500/45 border-2 border-amber-300 text-white font-mono text-[8px] font-bold flex flex-col items-center justify-center shadow-lg cursor-grab active:cursor-grabbing"
        >
          <Crosshair className="w-3 h-3" />
          <span>FIRE</span>
        </button>

        {/* Draggable ADS Handle */}
        <button
          type="button"
          data-testid="preview-ads-handle"
          aria-label="Preview ADS Button Position"
          onPointerDown={(e) => {
            e.stopPropagation();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Ignore
            }
            setDraggingTarget('ads');
          }}
          style={{
            left: `calc(${adsPos.x * 100}% - ${previewAdsSize / 2}px)`,
            top: `calc(${adsPos.y * 100}% - ${previewAdsSize / 2}px)`,
            width: `${previewAdsSize}px`,
            height: `${previewAdsSize}px`,
          }}
          className="absolute rounded-full bg-cyan-500/40 border border-cyan-300 text-cyan-100 font-mono text-[8px] font-bold flex flex-col items-center justify-center shadow-md cursor-grab active:cursor-grabbing"
        >
          <Target className="w-2.5 h-2.5" />
          <span>ADS</span>
        </button>

        {/* Simulated Secondary Right Cluster */}
        <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1 font-mono text-[7px] text-zinc-300">
          <div className="w-5 h-5 rounded-full bg-[#0B0E11]/75 border border-white/20 flex items-center justify-center">
            R
          </div>
          <div className="w-5 h-5 rounded-full bg-[#0B0E11]/75 border border-white/20 flex items-center justify-center">
            C
          </div>
          <div className="w-5 h-5 rounded-full bg-[#0B0E11]/75 border border-white/20 flex items-center justify-center">
            J
          </div>
        </div>
      </div>
    </div>
  );
}

