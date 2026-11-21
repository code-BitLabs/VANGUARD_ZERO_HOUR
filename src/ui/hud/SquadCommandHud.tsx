import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, HeartPulse, RefreshCw, Shield, Users, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { HudSnapshot } from '@/src/schemas/events.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { SquadCommandSource, SquadOrderType } from '@/src/gameplay/squad/SquadIntentRouter';
import { useGameSessionStore } from '@/src/stores/gameSessionStore';

interface RadialOption {
  order: SquadOrderType;
  label: string;
  short: string;
  angleDeg: number;
}

const RADIAL_OPTIONS: RadialOption[] = [
  { order: 'ATTACK_TARGET', label: 'Attack Target', short: 'ATTACK', angleDeg: -90 },
  { order: 'FLANK', label: 'Flank Sector', short: 'FLANK', angleDeg: -45 },
  { order: 'SUPPRESS', label: 'Suppress', short: 'SUPPRESS', angleDeg: 0 },
  { order: 'MOVE', label: 'Move To Point', short: 'MOVE', angleDeg: 45 },
  { order: 'REGROUP', label: 'Regroup', short: 'REGROUP', angleDeg: 90 },
  { order: 'HOLD', label: 'Hold Position', short: 'HOLD', angleDeg: 135 },
  { order: 'DEFEND', label: 'Defend Area', short: 'DEFEND', angleDeg: 180 },
  { order: 'BOARD_VEHICLE', label: 'Board / Exit', short: 'VEHICLE', angleDeg: -135 },
];

export interface SquadCommandHudProps {
  hud?: Pick<
    HudSnapshot,
    'squad' | 'nearSupplySwapStation' | 'deploymentMode' | 'carriedWeaponIds' | 'inVehicle'
  >;
  compactHud: boolean;
  downedActive: boolean;
  onIssueCommand?: (
    order: SquadOrderType,
    source: SquadCommandSource,
    operatorId?: string
  ) => void;
  onSwapFieldWeapon: (replaceSlotIndex: number, nextWeaponId: WeaponId) => void;
}

export const SquadCommandHud = React.memo(function SquadCommandHud({
  hud: hudProp,
  compactHud,
  downedActive,
  onIssueCommand,
  onSwapFieldWeapon,
}: SquadCommandHudProps) {
  const storeSlice = useGameSessionStore(
    useShallow((s) => ({
      squad: s.hud.squad,
      nearSupplySwapStation: s.hud.nearSupplySwapStation,
      deploymentMode: s.hud.deploymentMode,
      carriedWeaponIds: s.hud.carriedWeaponIds,
      inVehicle: s.hud.inVehicle,
    }))
  );
  const hud = hudProp ?? storeSlice;

  const [radialOpen, setRadialOpen] = useState(false);
  const [hoveredOrder, setHoveredOrder] = useState<SquadOrderType | null>(null);
  const [targetOperatorId, setTargetOperatorId] = useState<string | undefined>(undefined);
  const [swapOpen, setSwapOpen] = useState(false);
  const [selectedSwapSlot, setSelectedSwapSlot] = useState(0);

  const radialOpenRef = useRef(false);
  const hoveredOrderRef = useRef<SquadOrderType | null>(null);
  const targetOpRef = useRef<string | undefined>(undefined);
  const operatorsRef = useRef(hud.squad?.operators);
  const nearSupplySwapRef = useRef(hud.nearSupplySwapStation);
  const onIssueCommandRef = useRef(onIssueCommand);

  useEffect(() => {
    radialOpenRef.current = radialOpen;
    hoveredOrderRef.current = hoveredOrder;
    targetOpRef.current = targetOperatorId;
  }, [radialOpen, hoveredOrder, targetOperatorId]);

  useEffect(() => {
    operatorsRef.current = hud.squad?.operators;
    nearSupplySwapRef.current = hud.nearSupplySwapStation;
    onIssueCommandRef.current = onIssueCommand;
  }, [hud.squad?.operators, hud.nearSupplySwapStation, onIssueCommand]);

  useEffect(() => {
    if (!hud.nearSupplySwapStation && swapOpen) {
      setSwapOpen(false);
    }
  }, [hud.nearSupplySwapStation, swapOpen]);

  const isSoloMode = hud.deploymentMode === 'solo' || !hud.squad || !onIssueCommand;

  useEffect(() => {
    if (compactHud || downedActive) {
      setRadialOpen(false);
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!isSoloMode && e.code === 'KeyQ' && !swapOpen) {
        setRadialOpen(true);
        setHoveredOrder(null);
      } else if (e.code === 'Escape' && radialOpenRef.current) {
        setRadialOpen(false);
        setHoveredOrder(null);
      } else if (!isSoloMode && radialOpenRef.current && (e.key === '1' || e.key === '2' || e.key === '3')) {
        const idx = Number(e.key) - 1;
        const op = operatorsRef.current?.[idx];
        setTargetOperatorId((prev) => (op && prev !== op.id ? op.id : undefined));
      } else if (e.code === 'KeyH' && nearSupplySwapRef.current) {
        setSwapOpen((v) => !v);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isSoloMode && e.code === 'KeyQ' && radialOpenRef.current) {
        const chosen = hoveredOrderRef.current;
        setRadialOpen(false);
        setHoveredOrder(null);
        if (chosen && onIssueCommandRef.current) {
          onIssueCommandRef.current(chosen, 'desktop_radial', targetOpRef.current);
        }
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!radialOpenRef.current) return;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      if (Math.hypot(dx, dy) < 28) {
        setHoveredOrder(null);
        return;
      }
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      let best = RADIAL_OPTIONS[0];
      let bestDiff = 360;
      for (const opt of RADIAL_OPTIONS) {
        let diff = Math.abs(deg - opt.angleDeg);
        if (diff > 180) diff = 360 - diff;
        if (diff < bestDiff) {
          bestDiff = diff;
          best = opt;
        }
      }
      setHoveredOrder(best.order);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [compactHud, downedActive, isSoloMode, swapOpen]);

  const squad = isSoloMode ? undefined : hud.squad;
  if (downedActive) return null;
  if (!squad && !hud.nearSupplySwapStation) return null;

  const carriedIds = hud.carriedWeaponIds ?? ['assault_rifle', 'pistol', 'rocket_launcher'];
  const nearestDownedOp =
    squad && squad.nearestDownedOperatorId
      ? squad.operators.find((o) => o.id === squad.nearestDownedOperatorId) ?? null
      : null;

  return (
    <>
      {!compactHud && squad && (
        <div
          data-testid="hud-fireteam-strip"
          className="absolute bottom-[104px] left-3 xl:bottom-32 xl:left-4 z-20 bg-[#0B0E11]/86 border border-zinc-800 rounded-sm px-2.5 py-1.5 xl:px-3 xl:py-2 w-[204px] xl:w-[254px] space-y-1 xl:space-y-1.5 pointer-events-none"
        >
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider border-b border-zinc-800/90 pb-1">
            <span className="text-cyan-400 font-bold flex items-center gap-1.5 shrink-0">
              <Users className="w-3 h-3 shrink-0" />
              FIRETEAM
            </span>
            <span className="text-amber-300 tabular-nums whitespace-nowrap truncate">
              {squad.activeOrderLabel && !squad.activeOrderLabel.toUpperCase().startsWith('FORMATION:')
                ? squad.activeOrderLabel
                : squad.activeFormation}
            </span>
          </div>

          <div className="space-y-1">
            {squad.operators.map((op, idx) => {
              const hpPct = Math.round((op.health / Math.max(1, op.maxHealth)) * 100);
              const isDowned = op.state === 'DOWNED';
              const isMia = op.state === 'MIA';
              return (
                <div
                  key={op.id}
                  data-testid={`hud-squad-op-${op.id}`}
                  className="flex flex-col gap-0.5 text-[10px] font-mono"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-100 font-bold truncate">
                      {idx + 1}. {op.callsign}
                      <span className="text-zinc-400 font-normal ml-1">/ {op.roleBadge}</span>
                    </span>
                    <span
                      className={`tabular-nums whitespace-nowrap font-bold ${
                        isMia
                          ? 'text-zinc-500'
                          : isDowned
                            ? 'text-red-400'
                            : op.suppressionLevel > 0.55
                              ? 'text-amber-300'
                              : 'text-emerald-400'
                      }`}
                    >
                      {isMia
                        ? 'MIA'
                        : isDowned
                          ? `DOWN ${Math.ceil(op.bleedoutRemainingSec)}s`
                          : op.inVehicleId
                            ? 'BOARDED'
                            : `${hpPct}%`}
                    </span>
                  </div>
                  <div className="h-1 bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-150 ${
                        isMia
                          ? 'bg-zinc-600'
                          : isDowned
                            ? 'bg-red-500'
                            : hpPct < 40
                              ? 'bg-amber-400'
                              : 'bg-cyan-400'
                      }`}
                      style={{ width: `${isMia ? 0 : hpPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {nearestDownedOp && squad.nearestDownedDistanceM <= 4.0 && (
            <div
              data-testid="hud-squad-rescue-prompt"
              className="pt-1 border-t border-red-500/40 font-mono text-[10px] text-red-300 flex items-center gap-1.5"
            >
              <HeartPulse className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span>
                HOLD [E] TO RESCUE {nearestDownedOp.callsign}
                {squad.playerReviveProgress > 0
                  ? ` (${Math.round(squad.playerReviveProgress * 100)}%)`
                  : ''}
              </span>
            </div>
          )}

          <div className="hidden xl:flex pt-1 border-t border-zinc-800/80 font-mono text-[8.5px] text-zinc-400 items-center justify-between gap-2 whitespace-nowrap">
            <span>[Q] WHEEL</span>
            <span>[F1] REG · [F2] MOV · [F3] ATK</span>
          </div>
        </div>
      )}

      {hud.nearSupplySwapStation && !hud.inVehicle && (
        <div
          className={`absolute z-30 pointer-events-auto ${
            compactHud ? 'top-16 left-1/2 -translate-x-1/2' : 'bottom-48 left-1/2 -translate-x-1/2'
          }`}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {!swapOpen ? (
            <button
              type="button"
              data-testid="hud-field-swap-trigger"
              onClick={() => setSwapOpen(true)}
              className="min-h-[40px] px-3 py-1.5 bg-[#0B0E11]/92 hover:bg-[#141920] border border-amber-400/75 rounded-sm font-mono text-[11px] text-amber-300 flex items-center gap-2 whitespace-nowrap shadow-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>{compactHud ? 'FIELD ARMORY SWAP' : '[H] FIELD ARMORY SWAP (60 REQ OR 60% AMMO)'}</span>
            </button>
          ) : (
            <div
              data-testid="hud-field-swap-panel"
              className="w-[min(92vw,420px)] bg-[#141920] border border-amber-500/80 rounded-sm p-3.5 shadow-2xl space-y-2.5"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
                    Supply Station Field Swap
                  </div>
                  <div className="font-display text-sm font-bold uppercase text-white">
                    Swap Carried Weapon Slot (60 REQ or Reserve Ammo Trade)
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close Field Swap"
                  onClick={() => setSwapOpen(false)}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
                {carriedIds.slice(0, 3).map((wId, idx) => {
                  const wep = WEAPON_CATALOG.find((w) => w.id === wId);
                  return (
                    <button
                      key={`${wId}-${idx}`}
                      type="button"
                      onClick={() => setSelectedSwapSlot(idx)}
                      className={`min-h-[40px] px-2 py-1 rounded-xs border text-left cursor-pointer ${
                        selectedSwapSlot === idx
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                          : 'bg-[#0B0E11] border-zinc-800 text-zinc-300'
                      }`}
                    >
                      <div className="text-[9px] text-zinc-400">SLOT {idx + 1}</div>
                      <div className="font-bold truncate">{wep?.shortName ?? wId}</div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-1.5 max-h-[168px] overflow-y-auto">
                {WEAPON_CATALOG.map((w) => {
                  const alreadyCarried = carriedIds.includes(w.id);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      disabled={alreadyCarried}
                      onClick={() => {
                        onSwapFieldWeapon(selectedSwapSlot, w.id);
                        setSwapOpen(false);
                      }}
                      className={`min-h-[44px] px-2 py-1.5 rounded-xs border text-left font-mono text-[10px] transition-colors ${
                        alreadyCarried
                          ? 'bg-zinc-900/60 border-zinc-800 text-zinc-500 cursor-not-allowed'
                          : 'bg-[#0B0E11] border-zinc-700 hover:border-amber-400 text-zinc-100 cursor-pointer'
                      }`}
                    >
                      <div className="font-bold truncate">{w.shortName}</div>
                      <div className="text-[9px] text-zinc-400 uppercase truncate">{w.category}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!compactHud && radialOpen && (
        <div
          data-testid="hud-squad-radial-wheel"
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-auto bg-black/35"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="relative w-[300px] h-[300px] flex items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-[#0B0E11]/95 border border-zinc-700 flex flex-col items-center justify-center text-center px-2 shadow-2xl">
              <Crosshair className="w-4 h-4 text-amber-400 mb-0.5" />
              <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-200 font-bold">
                {hoveredOrder ? hoveredOrder.replace('_', ' ') : 'CANCEL'}
              </span>
              <span className="font-mono text-[8.5px] text-cyan-300 mt-0.5 truncate max-w-[82px]">
                {targetOperatorId
                  ? squad?.operators.find((o) => o.id === targetOperatorId)?.callsign ?? 'UNIT'
                  : 'ALL SQUAD'}
              </span>
            </div>

            {RADIAL_OPTIONS.map((opt) => {
              const rad = (opt.angleDeg * Math.PI) / 180;
              const radius = 112;
              const x = Math.cos(rad) * radius;
              const y = Math.sin(rad) * radius;
              const isActive = hoveredOrder === opt.order;
              return (
                <button
                  key={opt.order}
                  type="button"
                  data-testid={`radial-order-${opt.order}`}
                  onMouseEnter={() => setHoveredOrder(opt.order)}
                  onClick={() => {
                    setRadialOpen(false);
                    setHoveredOrder(null);
                    onIssueCommand?.(opt.order, 'desktop_radial', targetOperatorId);
                  }}
                  style={{
                    transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)`,
                  }}
                  className={`absolute min-w-[78px] min-h-[38px] px-2 py-1.5 rounded-sm border font-mono text-[10px] font-bold uppercase whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-amber-500 text-zinc-950 border-white shadow-lg'
                      : 'bg-[#0B0E11]/92 text-zinc-200 border-zinc-700 hover:border-amber-400'
                  }`}
                >
                  {opt.short}
                </button>
              );
            })}

            <div className="absolute -bottom-9 left-1/2 -translate-x-1/2 bg-[#0B0E11]/92 border border-zinc-800 px-3 py-1 rounded-sm font-mono text-[9.5px] text-zinc-300 whitespace-nowrap flex items-center gap-2">
              <Shield className="w-3 h-3 text-cyan-400" />
              <span>RELEASE [Q] TO ISSUE · [1-3] FILTER OPERATOR · [ESC] CANCEL</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
