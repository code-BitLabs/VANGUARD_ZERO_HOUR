import React from 'react';
import { X } from 'lucide-react';
import type { HudSnapshot } from '@/src/schemas/events.schema';
import type { gameSessionStore } from '@/src/stores/gameSessionStore';
import type { getMissionVisualProfile } from '@/src/world/VisualBible';

type ObjectiveItem = HudSnapshot['objectives'][number];
type MissionVisualProfile = ReturnType<typeof getMissionVisualProfile>;
type DownedState = NonNullable<ReturnType<typeof gameSessionStore.getState>['downedState']>;

interface TacticalOverviewDrawerProps {
  hud: HudSnapshot;
  missionVisualProfile: MissionVisualProfile;
  tacticalOverviewOpen: boolean;
  completedObjectivesCount: number;
  formatObjectiveDistance: (o: ObjectiveItem) => number | null;
  onClose: () => void;
}

export function TacticalOverviewDrawer({
  hud,
  missionVisualProfile,
  tacticalOverviewOpen,
  completedObjectivesCount,
  formatObjectiveDistance,
  onClose,
}: TacticalOverviewDrawerProps) {
  return (
    <div
      data-testid="hud-tactical-overview-drawer"
      className="fixed top-14 right-4 z-35 w-[min(420px,calc(100vw-24px))] max-h-[calc(100dvh-140px)] overflow-y-auto bg-[#0B0E11]/95 border border-cyan-500/60 rounded-sm shadow-2xl p-3.5 space-y-3 pointer-events-auto"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-2">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-cyan-400">
            Tactical Command Overview // {missionVisualProfile.operationCode}
          </div>
          <div className="font-display text-sm sm:text-base font-bold uppercase text-white mt-0.5">
            {hud.activeStageTitle} (Stage {hud.activeStageIndex}/{hud.totalStages})
          </div>
          <div className="font-mono text-[10px] text-zinc-400">
            {missionVisualProfile.operationTitle} · {missionVisualProfile.timeOfDayLabel}
          </div>
        </div>
        {tacticalOverviewOpen && (
          <button
            type="button"
            data-testid="close-tactical-overview"
            onClick={onClose}
            className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-xs font-mono text-[10px] text-zinc-300 flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3 h-3" /> [TAB]
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-amber-400">
          <span>Operation Objectives &amp; Stage Chain</span>
          <span>
            {completedObjectivesCount}/{hud.objectives.length} COMPLETE
          </span>
        </div>
        <div className="space-y-1.5">
          {hud.objectives.map((o) => {
            const distMeters = formatObjectiveDistance(o);
            const isLocked = o.status === 'locked';
            const isActive = o.status === 'active' && !o.completed;
            return (
              <div
                key={o.id}
                className={`p-2 rounded-xs border text-xs space-y-0.5 ${
                  o.completed
                    ? 'bg-emerald-950/20 border-emerald-500/35 text-emerald-200'
                    : isActive
                      ? 'bg-amber-500/12 border-amber-400/70 text-zinc-100'
                      : 'bg-[#141920]/90 border-zinc-800 text-zinc-400'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    <span className="font-mono text-[10px] text-cyan-400 mr-1.5">[S{o.stageIndex}]</span>
                    {o.title}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums shrink-0 text-amber-300">
                    {o.completed
                      ? o.bypassed
                        ? 'RETROACTIVE / BYPASSED'
                        : 'COMPLETED'
                      : `${distMeters !== null ? `${distMeters}m · ` : ''}${o.current}/${o.target}`}
                  </span>
                </div>
                {o.description && <div className="text-[11px] text-zinc-300">{o.description}</div>}
                {isLocked && o.blockedReason && (
                  <div className="font-mono text-[10px] text-amber-300/90">{o.blockedReason}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="pt-2 border-t border-zinc-800 flex items-center justify-between font-mono text-[10px] text-zinc-400">
        <span>RADAR: LOS / ACOUSTIC / RECON / STALE</span>
        <span className="text-cyan-300">[TAB] Toggle Overview &amp; Cursor</span>
      </div>
    </div>
  );
}

interface DownedActionOverlayProps {
  downedState: DownedState;
  onTriggerSoloSelfRecovery?: () => boolean | void;
  onRestartCheckpoint?: () => void;
  onRestartMission?: () => void;
  onAbort?: () => void;
}

export function DownedActionOverlay({
  downedState,
  onTriggerSoloSelfRecovery,
  onRestartCheckpoint,
  onRestartMission,
  onAbort,
}: DownedActionOverlayProps) {
  return (
    <div
      data-testid="hud-downed-overlay"
      className="fixed inset-0 z-40 bg-red-950/75 flex items-center justify-center p-4 pointer-events-auto"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="max-w-lg w-full bg-[#0B0E11]/95 border-2 border-red-500 p-4 sm:p-5 rounded-sm shadow-2xl space-y-3">
        <div className="flex items-start justify-between border-b border-zinc-800 pb-2.5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-red-400">
              Operator Down // Kill-Cam Telemetry
            </p>
            <h2 className="font-display text-xl sm:text-2xl font-bold uppercase text-white mt-0.5">
              Lethal Impact Detected
            </h2>
          </div>
          <span className="font-mono text-xs text-amber-400 bg-zinc-900 border border-zinc-700 px-2 py-0.5 rounded-xs">
            {downedState.remainingSec.toFixed(1)}s
          </span>
        </div>

        {downedState.canUseSoloTraumaRevive && onTriggerSoloSelfRecovery && (
          <div className="bg-emerald-950/35 border border-emerald-500/70 p-3 rounded-sm flex flex-wrap items-center justify-between gap-2.5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-300 font-bold">
                Solo Emergency Trauma Charge Available
              </div>
              <div className="text-xs text-zinc-200 mt-0.5">
                Inject emergency stabilizer (+55 HP / +25 Armor · 1 per operation).
              </div>
            </div>
            <button
              type="button"
              data-testid="downed-solo-trauma-revive"
              onClick={onTriggerSoloSelfRecovery}
              className="min-h-[44px] px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-display text-xs font-bold uppercase tracking-wider rounded-sm cursor-pointer shrink-0"
            >
              [F] Deploy Trauma Self-Revive
            </button>
          </div>
        )}

        {downedState.fatalSource ? (
          <div className="bg-[#141920] border border-red-500/40 p-3 rounded-sm font-mono text-xs space-y-1">
            <div className="flex justify-between text-zinc-200">
              <span className="text-zinc-400">FATAL ATTACKER:</span>
              <span className="text-red-400 font-bold">
                {downedState.fatalSource.attackerName} ({downedState.fatalSource.attackerArchetype.toUpperCase()})
              </span>
            </div>
            <div className="flex justify-between text-zinc-200">
              <span className="text-zinc-400">WEAPON / SOURCE:</span>
              <span className="text-amber-300">{downedState.fatalSource.weaponLabel}</span>
            </div>
            <div className="flex justify-between text-zinc-200">
              <span className="text-zinc-400">ENGAGEMENT RANGE / ZONE:</span>
              <span className="text-cyan-300">
                {downedState.fatalSource.distanceMeters}m · {downedState.fatalSource.hitZone.toUpperCase()} (-
                {Math.round(downedState.fatalSource.healthLost + downedState.fatalSource.armorAbsorbed)} HP)
              </span>
            </div>
          </div>
        ) : (
          <div className="bg-[#141920] border border-zinc-800 p-3 rounded-sm font-mono text-xs text-zinc-300">
            Fatal damage sustained in combat sector.
          </div>
        )}

        {downedState.lastHits.length > 0 && (
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              Final Incoming Hits ({downedState.lastHits.length})
            </div>
            <div className="bg-[#141920] border border-zinc-800 divide-y divide-zinc-800/80 rounded-sm max-h-28 overflow-y-auto font-mono text-[10px]">
              {downedState.lastHits.map((h, i) => (
                <div key={`${h.shotId}_${i}`} className="px-2.5 py-1 flex items-center justify-between gap-2">
                  <span className="text-zinc-200 truncate">
                    {h.attackerName} · <span className="text-zinc-400">{h.weaponLabel}</span>
                  </span>
                  <span className="text-red-400 shrink-0 tabular-nums">
                    {h.distanceMeters}m · -{h.damage} ({h.hitZone})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-zinc-800">
          {downedState.canRestartCheckpoint && onRestartCheckpoint && (
            <button
              type="button"
              data-testid="downed-retry-checkpoint"
              onClick={onRestartCheckpoint}
              className="min-h-[44px] px-3 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-display text-xs font-bold uppercase tracking-wider rounded-sm cursor-pointer"
            >
              Retry Last Checkpoint
            </button>
          )}
          {onRestartMission && (
            <button
              type="button"
              data-testid="downed-restart-mission"
              onClick={onRestartMission}
              className="min-h-[44px] px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-100 font-display text-xs font-bold uppercase tracking-wider rounded-sm cursor-pointer"
            >
              Restart Mission
            </button>
          )}
          {onAbort && (
            <button
              type="button"
              data-testid="downed-return-base"
              onClick={onAbort}
              className="min-h-[44px] px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-display text-xs font-bold uppercase tracking-wider rounded-sm cursor-pointer"
            >
              Return to Base
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
