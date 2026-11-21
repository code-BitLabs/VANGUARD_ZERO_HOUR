import React from 'react';
import type { MiniMapBlip } from '@/src/schemas/events.schema';

interface TacticalMiniMapProps {
  blips: MiniMapBlip[];
  playerX: number;
  playerZ: number;
  playerYaw: number;
  radarSizePx: number;
  radarCenter: number;
  radarRadius: number;
  threatColor: string;
  compactHud: boolean;
}

export const TacticalMiniMap = React.memo(function TacticalMiniMap({
  blips,
  playerX,
  playerZ,
  playerYaw,
  radarSizePx,
  radarCenter,
  radarRadius,
  threatColor,
  compactHud,
}: TacticalMiniMapProps) {
  const cos = Math.cos(playerYaw);
  const sin = Math.sin(playerYaw);
  return (
    <div
      data-testid="hud-radar-minimap"
      style={{ width: `${radarSizePx}px`, height: `${radarSizePx}px` }}
      className="relative rounded-full bg-[#0B0E11]/85 border border-cyan-500/35 overflow-hidden shrink-0 shadow-[inset_0_0_14px_rgba(6,182,212,0.12)]"
    >
      <div className="absolute inset-0 border border-cyan-500/15 rounded-full scale-50" />
      <div className="absolute inset-x-0 top-1/2 h-px bg-cyan-500/12" />
      <div className="absolute inset-y-0 left-1/2 w-px bg-cyan-500/12" />
      <div
        className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-0.75 -mt-0.75 bg-cyan-400 rounded-full ring-2 ring-cyan-400/30"
        title="Player"
      />
      {blips.slice(0, 28).map((b) => {
        const dx = b.x - playerX;
        const dz = b.z - playerZ;
        const rx = dx * cos - dz * sin;
        const rz = dx * sin + dz * cos;
        const px = Math.max(4, Math.min(radarSizePx - 4, radarCenter + (rx / 95) * radarRadius));
        const py = Math.max(4, Math.min(radarSizePx - 4, radarCenter + (rz / 95) * radarRadius));
        const color =
          b.kind === 'objective'
            ? '#f59e0b'
            : b.kind === 'friendly_vehicle'
              ? '#10b981'
              : b.kind === 'air'
                ? '#38bdf8'
                : threatColor;
        const isStale = b.detectionSource === 'stale';
        const isAcoustic = b.detectionSource === 'acoustic';
        const elevCode = b.elevationCode ?? 'same';
        return (
          <div
            key={b.id}
            data-testid={`hud-radar-blip-${b.kind}`}
            data-detection-source={b.detectionSource ?? 'los'}
            data-elevation-code={elevCode}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none"
            style={{
              left: `${px}px`,
              top: `${py}px`,
              opacity: isStale ? 0.48 : b.confidence ?? 1,
            }}
          >
            {elevCode === 'above' && !compactHud && (
              <span className="text-[6px] leading-none font-mono font-bold -mb-0.5" style={{ color }}>
                ▲
              </span>
            )}
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                isStale
                  ? 'border border-dashed bg-transparent'
                  : isAcoustic
                    ? 'ring-1 ring-amber-400/70'
                    : ''
              }`}
              style={{
                backgroundColor: isStale ? 'transparent' : color,
                borderColor: color,
              }}
            />
            {elevCode === 'below' && !compactHud && (
              <span className="text-[6px] leading-none font-mono font-bold -mt-0.5" style={{ color }}>
                ▼
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});
