import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { isEnvDevModeAllowed } from '@/src/config/devMode';
import { ColorblindModeSchema, QualityTierSchema } from '@/src/schemas/common.schema';
import { AudioSettingsSchema, ControlBindings, ControlBindingsSchema } from '@/src/schemas/settings.schema';
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

export function SettingsPanel({ onBack }: { onBack: () => void }) {
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

  return (
    <div className="fixed inset-0 z-30 bg-[#0B0E11]/95 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-4xl bg-[#141920] border border-zinc-800 rounded-sm shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500">System Configuration</p>
            <h2 className="font-display text-2xl font-bold uppercase tracking-wider text-zinc-100">Settings</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleResetAll}>
              <RotateCcw className="w-3.5 h-3.5" /> Reset Defaults
            </Button>
            <Button variant="secondary" size="sm" onClick={onBack}>
              Done
            </Button>
          </div>
        </div>

        <Tabs defaultValue="graphics" className="flex-1 flex flex-col overflow-hidden p-6">
          <TabsList className="mb-5 self-start flex-wrap">
            <TabsTrigger value="graphics">Graphics</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
            <TabsTrigger value="controls">Controls &amp; Keys</TabsTrigger>
            <TabsTrigger value="accessibility">Accessibility</TabsTrigger>
            {isEnvDevModeAllowed() && <TabsTrigger value="developer">Developer Tools</TabsTrigger>}
          </TabsList>

          <div className="flex-1 overflow-y-auto pr-1 space-y-5">
            <TabsContent value="graphics" className="space-y-4">
              <SettingRow label="Quality Preset" hint="Adjusts shadow resolution, draw distance, and particle budget.">
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

              <SettingRow label={`Field of View (${graphics.fov}°)`} hint="Horizontal camera angle while on foot.">
                <div className="w-52">
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
                <div className="w-52">
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

              <SettingRow label="Adaptive Performance Governor" hint="Auto-scales quality if frame times sustain above 19ms.">
                <Switch
                  checked={graphics.adaptiveGovernor}
                  onCheckedChange={(adaptiveGovernor) => updateGraphics({ adaptiveGovernor })}
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
