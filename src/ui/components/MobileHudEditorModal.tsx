import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Crosshair,
  Maximize2,
  RefreshCw,
  Repeat,
  RotateCcw,
  Target,
} from 'lucide-react';
import {
  cloneControlLayoutMap,
  DEFAULT_THREE_FINGER_ADS_POS,
  DEFAULT_THREE_FINGER_CONTROL_MAP,
  DEFAULT_THREE_FINGER_FIRE_POS,
  DEFAULT_TWO_FINGER_ADS_POS,
  DEFAULT_TWO_FINGER_CONTROL_MAP,
  DEFAULT_TWO_FINGER_FIRE_POS,
  TouchControlId,
  TouchControlProfileSchema,
} from '@/src/schemas/settings.schema';
import { settingsStore, useSettingsStore } from '@/src/stores/settingsStore';
import { uiStore } from '@/src/stores/uiStore';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import {
  computeMobileHudLayout,
  resolveActiveControlMap,
} from '@/src/ui/hud/mobileHudLayoutEngine';
import { Button } from '@/src/ui/primitives/Button';
import { Slider } from '@/src/ui/primitives/Controls';

function applyControlMoveToStore(
  controlId: TouchControlId,
  normX: number,
  normY: number
) {
  const state = settingsStore.getState();
  const input = state.input;
  const activeMap = cloneControlLayoutMap(resolveActiveControlMap(input));

  const x = Number(Math.max(0.05, Math.min(0.95, normX)).toFixed(2));
  const y = Number(Math.max(0.1, Math.min(0.92, normY)).toFixed(2));

  activeMap[controlId] = {
    ...activeMap[controlId],
    x,
    y,
  };

  const patch: Parameters<typeof state.updateInput>[0] = {
    touchControlProfile: 'custom',
    touchCustomLayout: activeMap,
  };

  if (controlId === 'fire_left') {
    patch.touchFirePosThreeFinger = { x, y };
  } else if (controlId === 'fire_right') {
    patch.touchFirePosTwoFinger = { x, y };
  } else if (controlId === 'ads') {
    patch.touchAdsPosTwoFinger = { x, y };
    patch.touchAdsPosThreeFinger = { x, y };
  }

  state.updateInput(patch);
}

export function resetMobileControlSettingsToDefaults() {
  const state = settingsStore.getState();
  const profile = state.input.touchControlProfile;
  const isThree = profile === 'three_finger';
  state.updateInput({
    touchControlProfile: isThree ? 'three_finger' : 'two_finger',
    leftFireEnabled: isThree,
    rightFireEnabled: !isThree,
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
    touchCustomLayout: cloneControlLayoutMap(
      isThree ? DEFAULT_THREE_FINGER_CONTROL_MAP : DEFAULT_TWO_FINGER_CONTROL_MAP
    ),
    touchFireOffsetX: 0,
    touchFireOffsetY: 0,
    touchAdsOffsetX: 0,
    touchAdsOffsetY: 0,
  });
  uiStore
    .getState()
    .showToast('Mobile Controls Reset', 'Positions, sizes, and sensitivity restored.', 'info');
}

export function MobileControlLayoutPreview({
  onOpenFullscreenEditor,
}: {
  onOpenFullscreenEditor: () => void;
}) {
  const input = useSettingsStore((s) => s.input);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draggingId, setDraggingId] = useState<TouchControlId | null>(null);

  const refWidth = 844;
  const refHeight = 390;
  const layout = computeMobileHudLayout(
    input,
    { width: refWidth, height: refHeight },
    { inVehicle: false, grenadeCount: 2, c4DeployedCount: 0 }
  );

  const handleDragMove = (clientX: number, clientY: number) => {
    if (!draggingId) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const normX = (clientX - rect.left) / rect.width;
    const normY = (clientY - rect.top) / rect.height;
    applyControlMoveToStore(draggingId, normX, normY);
  };

  const profileLabel =
    input.touchControlProfile === 'three_finger'
      ? 'Three-Finger Claw Mode'
      : input.touchControlProfile === 'custom'
        ? 'Custom Layout Mode'
        : 'Two-Finger Thumb Mode';

  const leftMoveTopPct = Math.round((layout.leftMoveZoneTopPx / refHeight) * 100);
  const topLeftHudLeftPct = Math.round((layout.topLeftHudLeftPx / refWidth) * 100);

  return (
    <div
      data-testid="control-layout-preview"
      data-profile={input.touchControlProfile}
      className="bg-[#0B0E11] border border-zinc-800 rounded-sm p-3 space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-200">
            Live Layout Engine Preview —{' '}
            <span className="text-amber-400 font-bold">{profileLabel}</span>
          </span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
            {layout.overlappingPairs.length === 0 ? '0 Overlaps' : `${layout.overlappingPairs.length} Overlap`}
          </span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          data-testid="open-fullscreen-hud-editor"
          className="min-h-[34px] text-[11px]"
          onClick={onOpenFullscreenEditor}
        >
          <Maximize2 className="w-3.5 h-3.5" /> Customize HUD Layout (1:1 Editor)
        </Button>
      </div>

      <div
        ref={containerRef}
        style={{ opacity: input.touchButtonOpacity, touchAction: 'none' }}
        onPointerMove={(e) => {
          if (!draggingId) return;
          e.stopPropagation();
          handleDragMove(e.clientX, e.clientY);
        }}
        onPointerUp={() => setDraggingId(null)}
        onPointerCancel={() => setDraggingId(null)}
        className="relative w-full aspect-[844/390] max-h-[250px] bg-gradient-to-b from-[#131922] via-[#10151c] to-[#0b0e12] border border-zinc-700/80 rounded-sm overflow-hidden select-none"
      >
        {/* Zone Split Guides */}
        <div
          style={{ top: `${leftMoveTopPct}%` }}
          className="absolute left-0 w-[40%] bottom-0 border-r border-t border-dashed border-amber-400/20 bg-amber-500/[0.03] flex items-end justify-start p-2"
        >
          <span className="font-mono text-[8px] uppercase text-amber-300/60">
            Left Thumb: 360° Move Zone
          </span>
        </div>
        {leftMoveTopPct > 0 && (
          <div
            style={{ height: `${leftMoveTopPct}%` }}
            className="absolute left-0 top-0 w-[40%] border-r border-dashed border-red-400/20 bg-red-500/[0.03] p-1.5 flex items-start justify-start"
          >
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
          style={{ left: `${topLeftHudLeftPct}%` }}
          className="absolute top-1.5 flex items-center gap-1.5 bg-[#0B0E11]/85 border border-white/15 px-1.5 py-0.5 rounded-xs transition-all"
        >
          <div className="w-4 h-4 rounded-full border border-cyan-400/60 flex items-center justify-center">
            <div className="w-1 h-1 rounded-full bg-cyan-400" />
          </div>
          <div className="font-mono text-[8px] text-zinc-200 leading-tight">
            <div>OBJ: Garrison 0/10</div>
            <div className="text-[7px] text-emerald-400">ARM 100 · HP 100</div>
          </div>
        </div>

        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 bg-[#0B0E11]/80 border border-white/15 px-2 py-0.5 rounded-xs font-mono text-[8px] text-amber-400">
          360° N · SCORE 420 · 01:15
        </div>

        <div className="absolute top-1.5 right-2 bg-[#0B0E11]/80 border border-white/15 px-1.5 py-0.5 rounded-xs font-mono text-[8px] text-zinc-200">
          M416-V 30/180
        </div>

        {/* Render every visible control from the authoritative layout engine */}
        {layout.visibleControls.map((ctrl) => {
          const leftPct = (ctrl.left / refWidth) * 100;
          const topPct = (ctrl.top / refHeight) * 100;
          const widthPct = (ctrl.width / refWidth) * 100;
          const heightPct = (ctrl.height / refHeight) * 100;

          const isFire = ctrl.id === 'fire_left' || ctrl.id === 'fire_right';
          const isPrimaryFireHandle =
            ctrl.id === 'fire_right' ||
            (ctrl.id === 'fire_left' && !layout.controls.fire_right.visible);

          const testId = isPrimaryFireHandle
            ? 'preview-fire-handle'
            : ctrl.id === 'ads'
              ? 'preview-ads-handle'
              : `preview-handle-${ctrl.id}`;

          return (
            <button
              key={ctrl.id}
              type="button"
              data-testid={testId}
              data-control-id={ctrl.id}
              aria-label={`Preview ${ctrl.label}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // Ignore
                }
                setDraggingId(ctrl.id);
              }}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
              }}
              className={`absolute flex flex-col items-center justify-center font-mono text-[7px] font-bold uppercase cursor-grab active:cursor-grabbing shadow-md ${
                ctrl.id === 'weapon_bar' ? 'rounded-full' : 'rounded-full'
              } ${
                isFire
                  ? 'bg-amber-500/45 border-2 border-amber-300 text-white'
                  : ctrl.id === 'ads'
                    ? 'bg-cyan-500/40 border border-cyan-300 text-cyan-100'
                    : ctrl.id === 'move_joystick'
                      ? 'bg-[#0B0E11]/70 border border-amber-400/60 text-amber-200'
                      : 'bg-[#0B0E11]/80 border border-white/25 text-zinc-200'
              }`}
            >
              <span>{ctrl.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MobileHudEditorModal({ onClose }: { onClose: () => void }) {
  const input = useSettingsStore((s) => s.input);
  const updateInput = useSettingsStore((s) => s.updateInput);
  const viewport = useViewportMode();

  const [selectedId, setSelectedId] = useState<TouchControlId>('fire_right');
  const [draggingId, setDraggingId] = useState<TouchControlId | null>(null);

  const layout = computeMobileHudLayout(
    input,
    { width: viewport.width, height: viewport.height },
    { inVehicle: false, grenadeCount: 2, c4DeployedCount: 0 }
  );

  const activeMap = resolveActiveControlMap(input);
  const selectedNode = activeMap[selectedId] ?? activeMap.fire_right;
  const selectedRect = layout.controls[selectedId] ?? layout.controls.fire_right;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingId) return;
    e.stopPropagation();
    const normX = e.clientX / Math.max(1, layout.viewportWidth);
    const normY = e.clientY / Math.max(1, layout.viewportHeight);
    applyControlMoveToStore(draggingId, normX, normY);
  };

  const updateSelectedScale = (scale: number) => {
    const nextMap = cloneControlLayoutMap(activeMap);
    nextMap[selectedId] = {
      ...nextMap[selectedId],
      scale: Number(scale.toFixed(2)),
    };
    updateInput({
      touchControlProfile: 'custom',
      touchCustomLayout: nextMap,
    });
  };

  return (
    <div
      data-testid="fullscreen-hud-editor"
      role="dialog"
      aria-modal="true"
      aria-label="1:1 Mobile HUD Layout Editor"
      style={{ touchAction: 'none' }}
      onPointerMove={handlePointerMove}
      onPointerUp={() => setDraggingId(null)}
      onPointerCancel={() => setDraggingId(null)}
      className="fixed inset-0 z-[80] bg-[#090d12]/96 select-none overflow-hidden"
    >
      {/* Safe-Area Boundary Box */}
      <div
        style={{
          left: `${layout.safeBounds.left}px`,
          top: `${layout.safeBounds.top}px`,
          width: `${layout.safeBounds.right - layout.safeBounds.left}px`,
          height: `${layout.safeBounds.bottom - layout.safeBounds.top}px`,
        }}
        className="pointer-events-none fixed border border-dashed border-emerald-400/35 rounded-xs"
      />

      {/* Interaction Zone Guides */}
      <div
        style={{ top: `${layout.leftMoveZoneTopPx}px` }}
        className="pointer-events-none fixed left-0 w-[40%] bottom-0 border-r border-t border-dashed border-amber-400/25 bg-amber-500/[0.03] flex items-end justify-start p-3"
      >
        <span className="font-mono text-[10px] uppercase text-amber-300/70">
          Left Thumb: 360° Move Zone
        </span>
      </div>

      {layout.leftMoveZoneTopPx > 0 && (
        <div
          style={{ height: `${layout.leftMoveZoneTopPx}px` }}
          className="pointer-events-none fixed left-0 top-0 w-[40%] border-r border-dashed border-red-400/25 bg-red-500/[0.03] p-3 flex items-end justify-start"
        >
          <span className="font-mono text-[10px] uppercase text-red-300/75">
            Left Index: Upper-Left Claw Zone
          </span>
        </div>
      )}

      <div className="pointer-events-none fixed left-[40%] right-0 top-0 bottom-0 bg-cyan-500/[0.02] flex items-center justify-center">
        <span className="font-mono text-xs uppercase tracking-widest text-cyan-300/35">
          Right Thumb: 360° Camera Look Surface
        </span>
      </div>

      {/* Center Crosshair Keep-Out Reference */}
      <div className="pointer-events-none fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 border border-dashed border-white/25 rounded-full flex items-center justify-center">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      </div>

      {/* Simulated Top Tactical HUD (1:1 Position Match) */}
      <div
        style={{
          left: `${layout.topLeftHudLeftPx}px`,
          top: `${layout.safeBounds.top}px`,
        }}
        className="pointer-events-none fixed flex items-center gap-2 bg-[#0B0E11]/85 border border-white/15 px-2.5 py-1 rounded-xs transition-all"
      >
        <div className="w-8 h-8 rounded-full border border-cyan-400/60 flex items-center justify-center font-mono text-[8px] text-cyan-300">
          RADAR
        </div>
        <div className="font-mono text-[10px] text-zinc-200 leading-tight">
          <div>Eliminate Hostile Garrison · 50m · 0/10</div>
          <div className="text-[9px] text-emerald-400">ARM 100 · HP 100</div>
        </div>
      </div>

      {/* Floating Inspector & Profile Toolbar (Top-Center) */}
      <div
        data-testid="hud-editor-toolbar"
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed left-1/2 -translate-x-1/2 top-2 z-[90] bg-[#0B0E11]/95 border border-amber-500/50 rounded-sm px-3 py-2 shadow-2xl flex flex-wrap items-center gap-2 max-w-[94vw]"
      >
        {/* Profile Switcher */}
        <div className="flex items-center gap-1 bg-[#141920] p-0.5 rounded-xs border border-zinc-800">
          <button
            type="button"
            data-testid="editor-profile-two-finger"
            onClick={() => updateInput({ touchControlProfile: TouchControlProfileSchema.parse('two_finger') })}
            className={`px-2 py-1 rounded-xs font-mono text-[10px] font-bold uppercase ${
              input.touchControlProfile === 'two_finger'
                ? 'bg-amber-500 text-zinc-950'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            2 Fingers
          </button>
          <button
            type="button"
            data-testid="editor-profile-three-finger"
            onClick={() => updateInput({ touchControlProfile: TouchControlProfileSchema.parse('three_finger') })}
            className={`px-2 py-1 rounded-xs font-mono text-[10px] font-bold uppercase ${
              input.touchControlProfile === 'three_finger'
                ? 'bg-amber-500 text-zinc-950'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            3 Fingers
          </button>
          <button
            type="button"
            data-testid="editor-profile-custom"
            onClick={() => updateInput({ touchControlProfile: TouchControlProfileSchema.parse('custom') })}
            className={`px-2 py-1 rounded-xs font-mono text-[10px] font-bold uppercase ${
              input.touchControlProfile === 'custom'
                ? 'bg-amber-500 text-zinc-950'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            Custom
          </button>
        </div>

        {/* Independent Left & Right Fire Toggles */}
        <button
          type="button"
          data-testid="editor-toggle-left-fire"
          aria-pressed={input.leftFireEnabled}
          onClick={() =>
            updateInput({
              touchControlProfile: 'custom',
              leftFireEnabled: !input.leftFireEnabled,
            })
          }
          className={`px-2 py-1 rounded-xs border font-mono text-[10px] font-bold uppercase ${
            input.leftFireEnabled
              ? 'bg-amber-500/20 border-amber-400 text-amber-200'
              : 'bg-[#141920] border-zinc-700 text-zinc-400'
          }`}
        >
          Left Fire: {input.leftFireEnabled ? 'ON' : 'OFF'}
        </button>

        <button
          type="button"
          data-testid="editor-toggle-right-fire"
          aria-pressed={input.rightFireEnabled}
          onClick={() =>
            updateInput({
              touchControlProfile: 'custom',
              rightFireEnabled: !input.rightFireEnabled,
            })
          }
          className={`px-2 py-1 rounded-xs border font-mono text-[10px] font-bold uppercase ${
            input.rightFireEnabled
              ? 'bg-amber-500/20 border-amber-400 text-amber-200'
              : 'bg-[#141920] border-zinc-700 text-zinc-400'
          }`}
        >
          Right Fire: {input.rightFireEnabled ? 'ON' : 'OFF'}
        </button>

        {/* Selected Control Scale Slider */}
        <div className="flex items-center gap-2 bg-[#141920] border border-zinc-800 px-2 py-1 rounded-xs">
          <span className="font-mono text-[10px] text-amber-300 uppercase">
            {selectedRect.shortLabel} Size ({Math.round(selectedNode.scale * 100)}%)
          </span>
          <div className="w-24">
            <Slider
              aria-label="Selected Control Size"
              value={selectedNode.scale}
              min={0.75}
              max={1.45}
              step={0.05}
              onValueChange={updateSelectedScale}
            />
          </div>
        </div>

        {/* Collision Validation Badge */}
        <span
          data-testid="editor-overlap-status"
          className="font-mono text-[10px] px-2 py-1 rounded-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-300"
        >
          {layout.overlappingPairs.length === 0 ? '0 Overlaps' : `${layout.overlappingPairs.length} Overlap`}
        </span>

        {/* Reset & Save */}
        <Button
          variant="ghost"
          size="sm"
          data-testid="editor-reset-defaults"
          className="min-h-[30px] px-2 text-[10px]"
          onClick={resetMobileControlSettingsToDefaults}
        >
          <RotateCcw className="w-3 h-3" /> Reset
        </Button>

        <Button
          variant="primary"
          size="sm"
          data-testid="close-fullscreen-hud-editor"
          className="min-h-[30px] px-2.5 text-[10px]"
          onClick={onClose}
        >
          <Check className="w-3.5 h-3.5" /> Save &amp; Exit
        </Button>
      </div>

      {/* Render 1:1 Interactive Draggable Control Nodes */}
      {layout.visibleControls.map((ctrl) => {
        const isSelected = ctrl.id === selectedId;
        const isFire = ctrl.id === 'fire_left' || ctrl.id === 'fire_right';

        return (
          <button
            key={ctrl.id}
            type="button"
            data-testid={`editor-handle-${ctrl.id}`}
            data-control-id={ctrl.id}
            aria-label={`Drag ${ctrl.label}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Ignore
              }
              setSelectedId(ctrl.id);
              setDraggingId(ctrl.id);
            }}
            style={{
              left: `${ctrl.left}px`,
              top: `${ctrl.top}px`,
              width: `${ctrl.width}px`,
              height: `${ctrl.height}px`,
              zIndex: isSelected ? 85 : ctrl.zIndex + 40,
              opacity: input.touchButtonOpacity,
              touchAction: 'none',
            }}
            className={`fixed rounded-full flex flex-col items-center justify-center font-mono text-[10px] font-bold uppercase cursor-grab active:cursor-grabbing transition-shadow ${
              isSelected ? 'ring-2 ring-white shadow-[0_0_18px_rgba(245,158,11,0.75)]' : ''
            } ${
              isFire
                ? 'bg-amber-500/45 border-2 border-amber-300 text-white'
                : ctrl.id === 'ads'
                  ? 'bg-cyan-500/45 border-2 border-cyan-300 text-cyan-50'
                  : ctrl.id === 'move_joystick'
                    ? 'bg-[#141920]/80 border-2 border-amber-400/75 text-amber-200'
                    : 'bg-[#0B0E11]/85 border border-white/30 text-zinc-100'
            }`}
          >
            {isFire && <Crosshair className="w-4 h-4 mb-0.5" />}
            {ctrl.id === 'ads' && <Target className="w-4 h-4 mb-0.5" />}
            {ctrl.id === 'reload' && <RefreshCw className="w-3.5 h-3.5 mb-0.5" />}
            {ctrl.id === 'crouch' && <ArrowDown className="w-3.5 h-3.5 mb-0.5" />}
            {ctrl.id === 'jump' && <ArrowUp className="w-3.5 h-3.5 mb-0.5" />}
            {ctrl.id === 'weapon_bar' && <Repeat className="w-3.5 h-3.5 mb-0.5 text-amber-400" />}
            <span className="leading-none">{ctrl.shortLabel}</span>
            <span className="text-[8px] text-zinc-300/80 mt-0.5">
              {ctrl.width}×{ctrl.height}
            </span>
          </button>
        );
      })}
    </div>
  );
}
