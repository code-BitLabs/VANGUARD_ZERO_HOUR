import React, { useRef, useState } from 'react';
import { Radio, X } from 'lucide-react';
import { HudSnapshot } from '@/src/schemas/events.schema';
import { SquadCommandSource, SquadOrderType } from '@/src/gameplay/squad/SquadIntentRouter';
import { MobileSquadStripRect } from './mobileHudLayoutEngine';

interface SlideChoice {
  order: SquadOrderType;
  label: string;
  dxMin: number;
  dxMax: number;
  dyMin: number;
  dyMax: number;
}

const SLIDE_CHOICES: SlideChoice[] = [
  { order: 'REGROUP', label: 'REGROUP', dxMin: -140, dxMax: -34, dyMin: -32, dyMax: 32 },
  { order: 'HOLD', label: 'HOLD', dxMin: -140, dxMax: -34, dyMin: 32, dyMax: 92 },
  { order: 'FLANK', label: 'FLANK', dxMin: -140, dxMax: -34, dyMin: -92, dyMax: -32 },
  { order: 'SUPPRESS', label: 'SUPPRESS', dxMin: -34, dxMax: 34, dyMin: 34, dyMax: 112 },
];

export interface MobileSquadCommandStripProps {
  hud: HudSnapshot;
  stripRect: MobileSquadStripRect;
  onIssueCommand: (
    order: SquadOrderType,
    source: SquadCommandSource,
    operatorId?: string
  ) => void;
}

export function MobileSquadCommandStrip({
  hud,
  stripRect,
  onIssueCommand,
}: MobileSquadCommandStripProps) {
  const activePointerId = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number; ts: number }>({ x: 0, y: 0, ts: 0 });
  const [expanded, setExpanded] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SquadOrderType | null>(null);
  const selectedOrderRef = useRef<SquadOrderType | null>(null);
  selectedOrderRef.current = selectedOrder;

  if (!hud.squad) return null;

  const resolveSlideChoice = (dx: number, dy: number): SquadOrderType | null => {
    if (Math.hypot(dx, dy) < 26) return null;
    for (const c of SLIDE_CHOICES) {
      if (dx >= c.dxMin && dx <= c.dxMax && dy >= c.dyMin && dy <= c.dyMax) {
        return c.order;
      }
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (activePointerId.current !== null) return;
    activePointerId.current = e.pointerId;
    startPos.current = { x: e.clientX, y: e.clientY, ts: performance.now() };
    setExpanded(true);
    setSelectedOrder(null);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events in headless tests may not support capture
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== activePointerId.current) return;
    e.stopPropagation();
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    setSelectedOrder(resolveSlideChoice(dx, dy));
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== activePointerId.current) return;
    e.stopPropagation();
    const elapsed = performance.now() - startPos.current.ts;
    const dist = Math.hypot(e.clientX - startPos.current.x, e.clientY - startPos.current.y);
    const chosen = selectedOrderRef.current;

    activePointerId.current = null;
    setExpanded(false);
    setSelectedOrder(null);
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }

    if (e.type === 'pointercancel') return;

    if (chosen) {
      onIssueCommand(chosen, 'mobile_strip');
    } else if (elapsed < 240 && dist < 18) {
      onIssueCommand('MOVE', 'mobile_context_ping');
    }
  };

  const aliveCount = hud.squad.operators.filter(
    (o) => o.state !== 'DOWNED' && o.state !== 'MIA'
  ).length;
  const downedCount = hud.squad.downedCount;

  return (
    <div
      data-testid="mobile-squad-command-strip"
      style={{
        left: `${stripRect.left}px`,
        top: `${stripRect.top}px`,
        width: `${stripRect.width}px`,
        height: `${stripRect.height}px`,
        zIndex: 29,
        touchAction: 'none',
      }}
      className="fixed pointer-events-auto select-none touch-none"
    >
      <button
        type="button"
        data-testid="mobile-squad-ping-btn"
        aria-label="Squad Command — Tap to Ping, Hold and Slide for Orders"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        className={`w-full h-full min-w-[44px] min-h-[44px] rounded-sm border-2 font-mono flex flex-col items-center justify-center shadow-lg transition-colors ${
          downedCount > 0
            ? 'bg-red-950/90 border-red-400 text-red-200'
            : expanded
              ? 'bg-amber-500 border-white text-zinc-950'
              : 'bg-[#0B0E11]/86 border-cyan-400/80 text-cyan-200'
        }`}
      >
        <Radio className="w-4 h-4 shrink-0" />
        <span className="text-[8.5px] font-bold leading-none mt-0.5 tabular-nums whitespace-nowrap">
          SQD {aliveCount}
        </span>
      </button>

      {expanded && (
        <div
          data-testid="mobile-squad-slide-menu"
          className="absolute right-[52px] top-0 flex flex-col gap-1.5 pointer-events-none"
        >
          {(['FLANK', 'REGROUP', 'HOLD', 'SUPPRESS'] as const).map((ord) => {
            const active = selectedOrder === ord;
            return (
              <div
                key={ord}
                className={`min-w-[82px] px-2.5 py-1.5 rounded-sm border font-mono text-[10px] font-bold uppercase text-center whitespace-nowrap shadow-md ${
                  active
                    ? 'bg-amber-500 border-white text-zinc-950'
                    : 'bg-[#0B0E11]/94 border-zinc-700 text-zinc-200'
                }`}
              >
                {ord}
              </div>
            );
          })}
          <div className="px-2 py-0.5 bg-[#0B0E11]/90 border border-zinc-800 rounded-sm font-mono text-[8.5px] text-zinc-400 flex items-center justify-center gap-1 whitespace-nowrap">
            <X className="w-2.5 h-2.5" /> CENTER TO CANCEL
          </div>
        </div>
      )}
    </div>
  );
}
