import React from 'react';
import { ArrowLeft, CheckCircle2, Play, Shield, Target } from 'lucide-react';
import { MISSION_CATALOG } from '@/src/data/missions';
import { Difficulty } from '@/src/schemas/common.schema';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { uiStore } from '@/src/stores/uiStore';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { Button } from '@/src/ui/primitives/Button';
import { Card, CardContent } from '@/src/ui/primitives/Card';

const DIFFICULTIES: Array<{ id: Difficulty; label: string; desc: string }> = [
  { id: 'easy', label: 'Recruit', desc: 'Reduced incoming damage' },
  { id: 'normal', label: 'Operator', desc: 'Standard tactical balance' },
  { id: 'hard', label: 'Veteran', desc: 'Lethal squads & armor' },
  { id: 'extreme', label: 'Zero Hour', desc: 'Maximum enemy aggression' },
];

export function CampaignScreen({
  onDeploy,
  onUiClick,
}: {
  onDeploy: (missionId: number, difficulty: Difficulty) => void;
  onUiClick: () => void;
}) {
  const selectedId = useMissionSelectionStore((s) => s.selectedMissionId);
  const difficulty = useMissionSelectionStore((s) => s.difficulty);
  const setSelected = useMissionSelectionStore((s) => s.setSelectedMission);
  const setDifficulty = useMissionSelectionStore((s) => s.setDifficulty);
  const markCampaignBriefingSeen = useMissionSelectionStore((s) => s.markCampaignBriefingSeen);
  const records = useProgressionStore((s) => s.save.missionRecords);
  const viewport = useViewportMode();

  const activeMission = MISSION_CATALOG.find((m) => m.id === selectedId) ?? MISSION_CATALOG[0];
  const rec = records[String(activeMission.id)];

  const handleLaunch = () => {
    onUiClick();
    markCampaignBriefingSeen();
    onDeploy(activeMission.id, difficulty);
  };

  return (
    <div
      className="fixed inset-0 z-20 bg-[#0B0E11]/94 flex flex-col overflow-y-auto"
      style={{
        paddingTop: 'max(14px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="max-w-6xl w-full mx-auto flex flex-col gap-4 flex-1">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[44px]"
              onClick={() => {
                onUiClick();
                uiStore.getState().setScreen('title');
              }}
            >
              <ArrowLeft className="w-4 h-4" /> HQ Menu
            </Button>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-500">
                Mission Briefing &amp; Difficulty
              </p>
              <h2 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-wider text-white">
                Campaign Operations
              </h2>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            onClick={() => {
              onUiClick();
              uiStore.getState().setScreen('armory');
            }}
          >
            Configure Armory
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 flex-1">
          {/* Mission List */}
          <div className="md:col-span-5 space-y-2">
            {MISSION_CATALOG.map((m) => {
              const mRec = records[String(m.id)];
              const isSelected = m.id === activeMission.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onUiClick();
                    setSelected(m.id);
                  }}
                  className={`w-full min-h-[44px] text-left p-3 sm:p-3.5 rounded-sm border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#1B222C] border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.12)]'
                      : 'bg-[#141920] border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-widest text-amber-400">
                      0{m.id} // {m.codeName}
                    </span>
                    {mRec?.completed && (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] sm:text-[11px] text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> RANK {mRec.bestGrade ?? 'B'}
                      </span>
                    )}
                  </div>
                  <div className="font-display text-base sm:text-lg font-bold uppercase text-white mt-0.5">
                    {m.title}
                  </div>
                  <div className="text-[11px] sm:text-xs text-zinc-400 mt-0.5">
                    {m.mapName} • {m.lighting.replace('_', ' ').toUpperCase()}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Mission Briefing & Launch */}
          <Card className="md:col-span-7 flex flex-col">
            <CardContent className="flex flex-col justify-between gap-4 flex-1 p-4 sm:p-5">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                  <div>
                    <span className="font-mono text-[11px] text-cyan-400 uppercase tracking-widest">
                      {activeMission.codeName} // {activeMission.mapName}
                    </span>
                    <h3 className="font-display text-2xl sm:text-3xl font-bold uppercase text-white mt-0.5">
                      {activeMission.title}
                    </h3>
                  </div>
                  {rec?.bestScore ? (
                    <div className="text-right font-mono text-xs">
                      <div className="text-zinc-400">BEST SCORE</div>
                      <div className="text-amber-400 text-lg font-bold tabular-nums">{rec.bestScore}</div>
                    </div>
                  ) : null}
                </div>

                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed mt-3">{activeMission.briefing}</p>

                <div className="mt-4">
                  <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 mb-2 flex items-center gap-2">
                    <Target className="w-3.5 h-3.5 text-amber-400" /> Tactical Objectives
                  </div>
                  <div className="space-y-1.5">
                    {activeMission.objectives.map((obj) => (
                      <div
                        key={obj.id}
                        className="bg-[#0B0E11] border border-zinc-800 px-3 py-2 rounded-sm flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="text-xs sm:text-sm font-medium text-zinc-100">{obj.title}</div>
                          <div className="text-[11px] text-zinc-400">{obj.description}</div>
                        </div>
                        <span className="font-mono text-xs text-amber-400 shrink-0">x{obj.targetCount}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 mb-2 flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-cyan-400" /> Difficulty Tier
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {DIFFICULTIES.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          onUiClick();
                          setDifficulty(d.id);
                        }}
                        className={`min-h-[44px] p-2 rounded-sm border text-left transition-colors cursor-pointer ${
                          difficulty === d.id
                            ? 'bg-amber-500/15 border-amber-500 text-white'
                            : 'bg-[#0B0E11] border-zinc-800 text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        <div className="font-display text-xs font-bold uppercase">{d.label}</div>
                        <div className="text-[10px] sm:text-[11px] text-zinc-400 mt-0.5">{d.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Concise Controls Preparation Strip */}
                <div className="mt-4 bg-[#0B0E11]/90 border border-zinc-800 px-3 py-2 rounded-sm font-mono text-[10px] text-zinc-300">
                  {viewport.isCoarsePointer ? (
                    <span>
                      CONTROLS: LEFT STICK MOVE · RIGHT DRAG LOOK · FIRE / ADS BUTTONS · RELOAD / GRENADE / INTERACT
                    </span>
                  ) : (
                    <span>
                      CONTROLS: WASD MOVE · MOUSE AIM · LMB FIRE · RMB ADS · [R] RELOAD · [E] VEHICLE/INTERACT
                    </span>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                <div className="font-mono text-[11px] text-zinc-400">
                  PAR TIME: {Math.floor(activeMission.parTimeSec / 60)}m {activeMission.parTimeSec % 60}s • BASE XP: +
                  {activeMission.baseXpReward}
                </div>
                <Button size="lg" className="min-h-[44px]" onClick={handleLaunch}>
                  <Play className="w-4 h-4 fill-current" /> Deploy Operation
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
