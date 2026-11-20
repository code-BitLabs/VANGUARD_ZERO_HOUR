import React, { useEffect, useState } from 'react';
import { Award, BookOpen, GitBranch, MonitorCheck, Play, RotateCcw, Settings, ShieldAlert, Users, XCircle } from 'lucide-react';
import { TACTICAL_CHALLENGES } from '@/src/data/challenges';
import { ACHIEVEMENT_DEFINITIONS, getRankForXp } from '@/src/data/ranks';
import { getMissionById } from '@/src/data/missions';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import { useGameSessionStore } from '@/src/stores/gameSessionStore';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { uiStore, useUIStore } from '@/src/stores/uiStore';
import { Button } from '@/src/ui/primitives/Button';
import { Card, CardContent } from '@/src/ui/primitives/Card';
import { ProgressBar } from '@/src/ui/primitives/Controls';
import { HardwareQaModal } from './HardwareQaModal';

export function LoadingOverlay({ onCancel }: { onCancel: () => void }) {
  const progress = useGameSessionStore((s) => s.loadProgress);
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);
  const mission = getMissionById(selectedMissionId);

  return (
    <div
      className="fixed inset-0 z-30 bg-[#0B0E11] flex items-center justify-center overflow-y-auto"
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="max-w-xl w-full bg-[#141920] border border-zinc-800 p-4 sm:p-6 rounded-sm shadow-2xl my-auto">
        <p className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.24em] text-amber-500">
          Deploying Operation // {mission.codeName}
        </p>
        <h2 className="font-display text-xl sm:text-2xl font-bold uppercase text-white mt-0.5">
          {mission.title}
        </h2>
        <p className="text-xs text-zinc-300 mt-1.5 leading-relaxed">{mission.briefing}</p>

        <div className="mt-3 bg-[#0B0E11] border border-zinc-800/90 p-2.5 sm:p-3 rounded-sm space-y-1.5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
            Staged Tactical Objectives ({mission.objectives.length} Stages)
          </div>
          {mission.objectives.map((obj, idx) => (
            <div key={obj.id} className="text-xs text-zinc-200 flex items-start justify-between gap-3">
              <div>
                <span className="font-mono text-[10px] text-cyan-400 block">
                  {obj.stageTitle || `STAGE ${idx + 1}`}
                </span>
                <span className="font-medium text-white">{obj.title}</span>
                <span className="block text-[11px] text-zinc-400">{obj.description}</span>
              </div>
              <span className="font-mono text-[10px] text-amber-400 shrink-0">0/{obj.targetCount}</span>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div className="flex justify-between font-mono text-xs text-zinc-300 mb-1.5">
            <span>{progress.currentAsset}</span>
            <span className="tabular-nums text-amber-400">{progress.percent}%</span>
          </div>
          <ProgressBar value={progress.percent} className="h-2" />
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" className="min-h-[44px]" onClick={onCancel}>
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
  onRestartMission,
  onAbort,
  gpuRenderer,
}: {
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onRestartMission?: () => void;
  onAbort: () => void;
  gpuRenderer?: string;
}) {
  const hud = useGameSessionStore((s) => s.hud);
  const [qaOpen, setQaOpen] = useState(false);
  const activeObj = hud.objectives.find((o) => !o.completed && o.status === 'active') ?? hud.objectives[0];

  return (
    <div
      className="fixed inset-0 z-30 bg-black/82 flex items-center justify-center overflow-y-auto"
      style={{
        paddingTop: 'max(10px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
      }}
    >
      <Card className="max-w-md w-full my-auto">
        <CardContent className="space-y-2.5 p-4 sm:p-5">
          <div className="border-b border-zinc-800 pb-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-500">
              Operation Suspended // Stage {hud.activeStageIndex}/{hud.totalStages}
            </p>
            <h2 className="font-display text-xl sm:text-2xl font-bold uppercase text-white">
              Mission Paused
            </h2>
            {activeObj && (
              <div className="mt-1.5 bg-[#0B0E11] border border-zinc-800 px-2.5 py-1.5 rounded-sm">
                <div className="font-mono text-[10px] text-cyan-400 uppercase">{activeObj.stageTitle}</div>
                <div className="text-xs font-bold text-zinc-100 mt-0.5">
                  {activeObj.title} ({activeObj.current}/{activeObj.target})
                </div>
                {activeObj.description && (
                  <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{activeObj.description}</div>
                )}
              </div>
            )}
          </div>

          <Button className="w-full min-h-[44px]" size="lg" onClick={onResume}>
            <Play className="w-4 h-4 fill-current" /> Resume Combat
          </Button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button className="w-full min-h-[44px]" variant="secondary" onClick={onRestartCheckpoint}>
              <RotateCcw className="w-4 h-4" /> Restart Checkpoint
            </Button>
            {onRestartMission && (
              <Button className="w-full min-h-[44px]" variant="outline" onClick={onRestartMission}>
                <RotateCcw className="w-4 h-4" /> Restart Mission
              </Button>
            )}
            <Button
              className="w-full min-h-[44px]"
              variant="outline"
              onClick={() => uiStore.getState().openHowToPlayFrom('paused')}
            >
              <BookOpen className="w-4 h-4" /> Field Manual (Tier 3)
            </Button>
            <Button
              className="w-full min-h-[44px]"
              variant="outline"
              onClick={() => uiStore.getState().openSettingsFrom('paused')}
            >
              <Settings className="w-4 h-4" /> Settings
            </Button>
            <Button
              className="w-full min-h-[44px]"
              variant="outline"
              onClick={() => setQaOpen(true)}
            >
              <MonitorCheck className="w-4 h-4" /> Hardware QA
            </Button>
            <Button className="w-full min-h-[44px]" variant="danger" onClick={onAbort}>
              Abort to HQ
            </Button>
          </div>
        </CardContent>
      </Card>
      <HardwareQaModal open={qaOpen} onClose={() => setQaOpen(false)} gpuRenderer={gpuRenderer} />
    </div>
  );
}

export function DebriefScreen({
  onRestartCheckpoint,
  onRetry,
  onChangeDifficulty,
  onNextMission,
  onReturnMenu,
  gpuRenderer,
}: {
  onRestartCheckpoint?: () => void;
  onRetry: () => void;
  onChangeDifficulty?: (difficulty: 'easy' | 'normal' | 'hard' | 'extreme') => void;
  onNextMission: (nextId: number) => void;
  onReturnMenu: () => void;
  gpuRenderer?: string;
}) {
  const debrief = useGameSessionStore((s) => s.debrief);
  const save = useProgressionStore((s) => s.save);
  const commitStagedCampaignRebase = useProgressionStore((s) => s.commitStagedCampaignRebase);
  const selectedDifficulty = useMissionSelectionStore((s) => s.difficulty);
  const setDifficulty = useMissionSelectionStore((s) => s.setDifficulty);
  const [rebaseHandled, setRebaseHandled] = useState<'committed' | 'kept' | null>(null);
  const [qaOpen, setQaOpen] = useState(false);
  if (!debrief) return null;

  const mission = getMissionById(debrief.missionId);
  const rank = getRankForXp(save.xp);
  const hasNext = debrief.missionId < 5;
  const durationMin = Math.floor(debrief.durationSec / 60);
  const durationRemSec = debrief.durationSec % 60;
  const durationLabel = `${durationMin}m ${String(durationRemSec).padStart(2, '0')}s`;
  const shotsLabel =
    debrief.shotsFired !== undefined && debrief.shotsHit !== undefined
      ? `${debrief.accuracyPct}% (${debrief.shotsHit}/${debrief.shotsFired})`
      : `${debrief.accuracyPct}%`;
  const headshotPctLabel =
    debrief.headshotPct !== undefined
      ? `${debrief.headshots} (${debrief.headshotPct}%)`
      : String(debrief.headshots);

  return (
    <div
      className="fixed inset-0 z-30 bg-[#0B0E11]/95 flex items-start sm:items-center justify-center overflow-y-auto"
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
      }}
    >
      <Card className="max-w-2xl w-full border-zinc-700 my-auto">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
            <div>
              <p
                className={`font-mono text-xs uppercase tracking-[0.24em] ${
                  debrief.victory ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {debrief.victory ? 'Operation Accomplished' : 'Operator KIA // Mission Failed'}
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold uppercase text-white mt-0.5">
                {mission.codeName}: {mission.title}
              </h2>
            </div>

            <div className="text-center bg-[#0B0E11] border border-amber-500/60 px-3.5 py-1.5 rounded-sm shrink-0">
              <div className="font-mono text-[10px] text-zinc-400">RATING</div>
              <div
                data-testid="debrief-grade-badge"
                className="font-display text-2xl sm:text-3xl font-bold text-amber-400"
              >
                {debrief.victory ? debrief.grade : 'F'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
            <MetricBox label="Score" value={String(debrief.score)} />
            <MetricBox label="Eliminations" value={String(debrief.kills)} />
            <MetricBox label="Headshots" value={headshotPctLabel} />
            <MetricBox label="Accuracy" value={shotsLabel} />
            <MetricBox label="Mission Time" value={durationLabel} />
            <MetricBox label="Deaths" value={String(debrief.deathsCount ?? debrief.checkpointDeathsCount ?? 0)} />
            <MetricBox label="Damage Taken" value={`${debrief.damageReceived ?? 0} HP`} />
            <MetricBox label="Difficulty" value={debrief.difficulty.toUpperCase()} />
          </div>

          {!debrief.victory && debrief.fatalSource && (
            <div
              data-testid="debrief-fatal-breakdown"
              className="bg-red-950/35 border border-red-500/60 p-3 rounded-sm font-mono text-xs space-y-1.5"
            >
              <div className="text-[10px] uppercase tracking-wider text-red-400 font-bold">
                Fatal Engagement Telemetry
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-zinc-200">
                <div>
                  <span className="text-zinc-400 block text-[10px]">ATTACKER</span>
                  <span className="font-bold text-red-300">
                    {debrief.fatalSource.attackerName} ({debrief.fatalSource.attackerArchetype})
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px]">WEAPON</span>
                  <span className="text-amber-300">{debrief.fatalSource.weaponLabel}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px]">RANGE / HIT ZONE</span>
                  <span className="text-cyan-300">
                    {debrief.fatalSource.distanceMeters}m · {debrief.fatalSource.hitZone.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {!debrief.victory && (
            <div className="bg-[#0B0E11] border border-zinc-800 p-3 rounded-sm space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                <span>Adjust Difficulty Before Redeploying</span>
                <span className="text-amber-400">Active: {selectedDifficulty.toUpperCase()}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(['easy', 'normal', 'hard', 'extreme'] as const).map((diff) => (
                  <button
                    key={diff}
                    type="button"
                    data-testid={`debrief-difficulty-${diff}`}
                    onClick={() => {
                      setDifficulty(diff);
                      onChangeDifficulty?.(diff);
                    }}
                    className={`py-1.5 px-2 rounded-xs border font-mono text-[10px] uppercase font-bold transition-colors cursor-pointer ${
                      selectedDifficulty === diff
                        ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                        : 'bg-[#141920] border-zinc-800 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {diff}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#0B0E11] border border-zinc-800 p-3 rounded-sm space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <span className="text-zinc-300 flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                {rank.current.insignia} {rank.current.title}
              </span>
              <span className="text-amber-400 tabular-nums">
                +{debrief.xpEarned + (debrief.challengeXpBonus ?? 0)} XP • +
                {debrief.requisitionEarned +
                  (debrief.challengeReqBonus ?? 0) +
                  (debrief.modifierReqBonus ?? 0)}{' '}
                REQ
              </span>
            </div>
            {(debrief.modifierReqBonus || debrief.optionalObjectivesCompleted) ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-400 tabular-nums">
                {debrief.optionalObjectivesCompleted ? (
                  <span className="text-cyan-300">
                    OPTIONAL OBJECTIVES: {debrief.optionalObjectivesCompleted} COMPLETED
                  </span>
                ) : null}
                {debrief.modifierReqBonus ? (
                  <span className="text-amber-300">
                    MODIFIER BONUS: +{debrief.modifierReqBonus} REQ
                  </span>
                ) : null}
              </div>
            ) : null}
            <ProgressBar value={rank.progressPct} className="h-2" />
          </div>

          {((debrief.newChallenges && debrief.newChallenges.length > 0) ||
            (debrief.masteryTierUps && debrief.masteryTierUps.length > 0)) && (
            <div
              data-testid="debrief-stage6-rewards"
              className="bg-cyan-950/25 border border-cyan-500/40 p-2.5 rounded-sm space-y-1.5"
            >
              {debrief.newChallenges && debrief.newChallenges.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-cyan-300 mb-1">
                    Tactical Challenges Completed (+{debrief.challengeXpBonus ?? 0} XP / +
                    {debrief.challengeReqBonus ?? 0} REQ)
                  </div>
                  <div className="space-y-1">
                    {debrief.newChallenges.map((cid) => {
                      const ch = TACTICAL_CHALLENGES.find((c) => c.id === cid);
                      return (
                        <div key={cid} className="text-xs font-mono text-zinc-100">
                          ✓ {ch?.title ?? cid}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {debrief.masteryTierUps && debrief.masteryTierUps.length > 0 && (
                <div className="pt-1 border-t border-cyan-500/25">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300 mb-1">
                    Weapon Mastery Promotions
                  </div>
                  <div className="space-y-0.5 text-xs font-mono text-zinc-100">
                    {debrief.masteryTierUps.map((m, i) => {
                      const w = WEAPON_BY_ID[m.weaponId as keyof typeof WEAPON_BY_ID];
                      return (
                        <div key={`${m.weaponId}-${i}`}>
                          {w?.shortName ?? m.weaponId} → {m.tier}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {debrief.newAchievements.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/40 p-2.5 rounded-sm">
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

          {/* Stage 7 TRN-37 Fireteam After-Action Report */}
          {debrief.squadReports && debrief.squadReports.length > 0 && (
            <div
              data-testid="debrief-squad-report"
              className="bg-[#0B0E11] border border-zinc-800 p-3 rounded-sm space-y-2"
            >
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-cyan-400">
                <span className="flex items-center gap-1.5 font-bold">
                  <Users className="w-3.5 h-3.5" /> Fireteam Performance
                </span>
                <span className="text-zinc-400">
                  MODE: {(debrief.replayMode ?? 'canonical').replace('_', ' ').toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[10.5px]">
                {debrief.squadReports.map((rep) => (
                  <div
                    key={rep.operatorId}
                    className="bg-[#141920] border border-zinc-800 px-2.5 py-1.5 rounded-xs space-y-0.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-100">{rep.callsign}</span>
                      <span
                        className={
                          rep.becameMia
                            ? 'text-red-400 font-bold'
                            : rep.severeInjury
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }
                      >
                        {rep.becameMia ? 'MIA' : rep.severeInjury ? 'INJURED' : 'READY'}
                      </span>
                    </div>
                    <div className="text-[9.5px] text-zinc-400 tabular-nums">
                      {rep.kills} KILLS · {rep.revivesPerformed} REV · {rep.timesDowned} DOWNED
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stage 7 TRN-39 Staged Campaign Replay Rebase Preview & Confirmation */}
          {debrief.victory &&
            debrief.replayMode === 'campaign_replay' &&
            debrief.stagedRebaseDiff?.hasCanonicalDifference &&
            debrief.pendingRebaseDrafts &&
            debrief.pendingRebaseDrafts.length > 0 && (
              <div
                data-testid="debrief-campaign-rebase-panel"
                className="bg-amber-950/25 border border-amber-500/70 p-3 rounded-sm space-y-2"
              >
                <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300 font-bold flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5" /> Campaign Timeline Divergence Detected
                </div>
                <p className="text-xs text-zinc-200 leading-snug">
                  This Campaign Replay produced new strategic outcomes affecting{' '}
                  {debrief.stagedRebaseDiff.affectedDownstreamMissions.length > 0
                    ? `Operations ${debrief.stagedRebaseDiff.affectedDownstreamMissions.map((m) => `0${m}`).join(', ')}`
                    : 'the campaign ledger'}
                  .
                </p>
                {rebaseHandled === null ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      data-testid="confirm-campaign-rebase-btn"
                      onClick={() => {
                        commitStagedCampaignRebase(debrief.missionId, debrief.pendingRebaseDrafts ?? []);
                        setRebaseHandled('committed');
                      }}
                    >
                      Commit &amp; Rebase Timeline
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRebaseHandled('kept')}
                    >
                      Keep Original Canonical Timeline
                    </Button>
                  </div>
                ) : (
                  <div className="font-mono text-[10px] text-emerald-400">
                    {rebaseHandled === 'committed'
                      ? 'Canonical campaign ledger rebased with new operation outcomes.'
                      : 'Original canonical campaign timeline preserved.'}
                  </div>
                )}
              </div>
            )}

          <div className="flex flex-wrap justify-between items-center gap-2.5 pt-2 border-t border-zinc-800">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[40px]"
              onClick={() => setQaOpen(true)}
            >
              <MonitorCheck className="w-4 h-4 text-cyan-400" /> Hardware QA Report
            </Button>
            <div className="flex flex-wrap justify-end gap-2.5">
              <Button variant="outline" className="min-h-[44px]" onClick={onReturnMenu}>
                Campaign HQ
              </Button>
              {!debrief.victory && debrief.canRestartCheckpoint && onRestartCheckpoint && (
                <Button className="min-h-[44px]" onClick={onRestartCheckpoint}>
                  <RotateCcw className="w-4 h-4" /> Restart Checkpoint
                </Button>
              )}
              <Button variant="secondary" className="min-h-[44px]" onClick={onRetry}>
                <RotateCcw className="w-4 h-4" /> Replay Mission
              </Button>
              {debrief.victory && hasNext && (
                <Button className="min-h-[44px]" onClick={() => onNextMission(debrief.missionId + 1)}>
                  <Play className="w-4 h-4 fill-current" /> Next Operation
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <HardwareQaModal open={qaOpen} onClose={() => setQaOpen(false)} gpuRenderer={gpuRenderer} />
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
