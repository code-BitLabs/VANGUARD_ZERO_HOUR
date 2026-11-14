import React, { useEffect } from 'react';
import { Award, Play, RotateCcw, Settings, ShieldAlert, XCircle } from 'lucide-react';
import { ACHIEVEMENT_DEFINITIONS, getRankForXp } from '@/src/data/ranks';
import { getMissionById } from '@/src/data/missions';
import { useGameSessionStore } from '@/src/stores/gameSessionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { uiStore, useUIStore } from '@/src/stores/uiStore';
import { Button } from '@/src/ui/primitives/Button';
import { Card, CardContent } from '@/src/ui/primitives/Card';
import { ProgressBar } from '@/src/ui/primitives/Controls';

export function LoadingOverlay({ onCancel }: { onCancel: () => void }) {
  const progress = useGameSessionStore((s) => s.loadProgress);
  return (
    <div className="fixed inset-0 z-30 bg-[#0B0E11] flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-[#141920] border border-zinc-800 p-7 rounded-sm shadow-2xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-amber-500">
          Deploying Operation
        </p>
        <h2 className="font-display text-2xl font-bold uppercase text-white mt-1">
          Initializing Combat Sector
        </h2>
        <div className="mt-5">
          <div className="flex justify-between font-mono text-xs text-zinc-300 mb-2">
            <span>{progress.currentAsset}</span>
            <span className="tabular-nums text-amber-400">{progress.percent}%</span>
          </div>
          <ProgressBar value={progress.percent} className="h-2" />
        </div>
        <div className="mt-6 flex justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            <XCircle className="w-4 h-4" /> Cancel Deployment
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PauseOverlay({
  onResume,
  onRestartCheckpoint,
  onAbort,
}: {
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onAbort: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 bg-black/78 flex items-center justify-center p-6">
      <Card className="max-w-sm w-full">
        <CardContent className="space-y-3">
          <div className="border-b border-zinc-800 pb-3 mb-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-500">
              Operation Suspended
            </p>
            <h2 className="font-display text-2xl font-bold uppercase text-white">Mission Paused</h2>
          </div>

          <Button className="w-full" size="lg" onClick={onResume}>
            <Play className="w-4 h-4 fill-current" /> Resume Combat
          </Button>
          <Button className="w-full" variant="secondary" onClick={onRestartCheckpoint}>
            <RotateCcw className="w-4 h-4" /> Restart Checkpoint
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => uiStore.getState().openSettingsFrom('paused')}
          >
            <Settings className="w-4 h-4" /> Settings
          </Button>
          <Button className="w-full" variant="danger" onClick={onAbort}>
            Abort to Campaign HQ
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function DebriefScreen({
  onRetry,
  onNextMission,
  onReturnMenu,
}: {
  onRetry: () => void;
  onNextMission: (nextId: number) => void;
  onReturnMenu: () => void;
}) {
  const debrief = useGameSessionStore((s) => s.debrief);
  const save = useProgressionStore((s) => s.save);
  if (!debrief) return null;

  const mission = getMissionById(debrief.missionId);
  const rank = getRankForXp(save.xp);
  const hasNext = debrief.missionId < 5;

  return (
    <div className="fixed inset-0 z-30 bg-[#0B0E11]/95 flex items-center justify-center p-5 overflow-y-auto">
      <Card className="max-w-2xl w-full border-zinc-700">
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
            <div>
              <p
                className={`font-mono text-xs uppercase tracking-[0.24em] ${
                  debrief.victory ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {debrief.victory ? 'Operation Accomplished' : 'Operator KIA // Mission Failed'}
              </p>
              <h2 className="font-display text-3xl font-bold uppercase text-white mt-1">
                {mission.codeName}: {mission.title}
              </h2>
            </div>

            <div className="text-center bg-[#0B0E11] border border-amber-500/60 px-4 py-2 rounded-sm">
              <div className="font-mono text-[10px] text-zinc-400">RATING</div>
              <div className="font-display text-3xl font-bold text-amber-400">
                {debrief.victory ? debrief.grade : 'F'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
            <MetricBox label="Score" value={String(debrief.score)} />
            <MetricBox label="Eliminations" value={String(debrief.kills)} />
            <MetricBox label="Headshots" value={String(debrief.headshots)} />
            <MetricBox label="Accuracy" value={`${debrief.accuracyPct}%`} />
          </div>

          <div className="bg-[#0B0E11] border border-zinc-800 p-4 rounded-sm space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-300 flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                {rank.current.insignia} {rank.current.title}
              </span>
              <span className="text-amber-400">
                +{debrief.xpEarned} XP • +{debrief.requisitionEarned} REQ
              </span>
            </div>
            <ProgressBar value={rank.progressPct} className="h-2" />
          </div>

          {debrief.newAchievements.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/40 p-3 rounded-sm">
              <div className="font-mono text-[11px] uppercase text-amber-400 mb-1">
                Commendations Unlocked
              </div>
              <div className="flex flex-wrap gap-2">
                {debrief.newAchievements.map((id) => {
                  const def = ACHIEVEMENT_DEFINITIONS.find((a) => a.id === id);
                  return (
                    <span
                      key={id}
                      className="text-xs bg-[#0B0E11] border border-amber-500/50 px-2.5 py-1 rounded-sm text-zinc-100"
                    >
                      {def?.title ?? id}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-zinc-800">
            <Button variant="outline" onClick={onReturnMenu}>
              Campaign HQ
            </Button>
            <Button variant="secondary" onClick={onRetry}>
              <RotateCcw className="w-4 h-4" /> Replay Mission
            </Button>
            {debrief.victory && hasNext && (
              <Button onClick={() => onNextMission(debrief.missionId + 1)}>
                <Play className="w-4 h-4 fill-current" /> Next Operation
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0B0E11] border border-zinc-800 px-3 py-2.5 rounded-sm">
      <div className="text-[10px] uppercase text-zinc-400">{label}</div>
      <div className="text-lg font-bold text-white tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

export function ToastAndRecoveryLayer() {
  const toast = useUIStore((s) => s.toast);
  const contextLost = useUIStore((s) => s.contextLost);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => uiStore.getState().clearToast(), 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  return (
    <>
      {contextLost && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6">
          <div className="max-w-md bg-[#141920] border border-amber-500 p-6 rounded-sm text-center">
            <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto mb-2" />
            <h3 className="font-display text-xl font-bold uppercase text-white">
              Restoring Graphics Context
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              WebGL context interruption detected. Rebuilding shaders and render targets...
            </p>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-[#141920] border border-amber-500/70 px-4 py-2.5 rounded-sm shadow-xl max-w-md">
          <div className="font-display text-xs font-bold uppercase text-amber-400">{toast.title}</div>
          {toast.description && <div className="text-xs text-zinc-300 mt-0.5">{toast.description}</div>}
        </div>
      )}
    </>
  );
}
