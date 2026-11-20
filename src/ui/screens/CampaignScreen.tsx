import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Compass,
  Flag,
  Play,
  Shield,
  Target,
  X,
} from 'lucide-react';
import {
  computeCombinedModifierEffects,
  evaluateWeaponMastery,
  getChallengesForMission,
  REPLAY_MODIFIERS,
} from '@/src/data/challenges';
import { MISSION_CATALOG } from '@/src/data/missions';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { Difficulty } from '@/src/schemas/common.schema';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { uiStore } from '@/src/stores/uiStore';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { Button } from '@/src/ui/primitives/Button';
import { Card, CardContent } from '@/src/ui/primitives/Card';
import { OperationsPlanningPanel } from './OperationsPlanningPanel';

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
  const seenBriefings = useMissionSelectionStore((s) => s.seenMissionBriefings);
  const markMissionBriefingSeen = useMissionSelectionStore((s) => s.markMissionBriefingSeen);
  const records = useProgressionStore((s) => s.save.missionRecords);
  const completedChallenges = useProgressionStore((s) => s.save.completedChallenges ?? []);
  const activeModifiers = useProgressionStore((s) => s.save.activeModifiers ?? []);
  const weaponMasteryKills = useProgressionStore((s) => s.save.weaponMasteryKills ?? {});
  const toggleModifier = useProgressionStore((s) => s.toggleModifier);
  const viewport = useViewportMode();

  const [dossierModalOpen, setDossierModalOpen] = useState(false);

  const activeMission = MISSION_CATALOG.find((m) => m.id === selectedId) ?? MISSION_CATALOG[0];
  const rec = records[String(activeMission.id)];
  const missionChallenges = getChallengesForMission(activeMission.id);
  const modifierSummary = computeCombinedModifierEffects(activeModifiers);
  const topMastery = WEAPON_CATALOG.map((w) =>
    evaluateWeaponMastery(w.id, weaponMasteryKills[w.id] ?? 0)
  )
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 3);
  const hasSeenCurrentVersion =
    seenBriefings[activeMission.missionKey] === activeMission.briefingVersion;

  const handleLaunch = () => {
    onUiClick();
    markMissionBriefingSeen(activeMission.missionKey, activeMission.briefingVersion);
    setDossierModalOpen(false);
    onDeploy(activeMission.id, difficulty);
  };

  return (
    <div
      className="fixed inset-0 z-20 bg-[#0B0E11]/94 flex flex-col overflow-y-auto overflow-x-hidden"
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

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="open-mission-briefing"
              className="min-h-[44px]"
              onClick={() => {
                onUiClick();
                setDossierModalOpen(true);
              }}
            >
              <BookOpen className="w-4 h-4 text-amber-400" /> Full Briefing Dossier
            </Button>
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 flex-1">
          {/* Mission List */}
          <div className="md:col-span-5 space-y-2">
            {MISSION_CATALOG.map((m) => {
              const mRec = records[String(m.id)];
              const isSelected = m.id === activeMission.id;
              const seenVer = seenBriefings[m.missionKey] === m.briefingVersion;
              return (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`select-mission-${m.id}`}
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
                    <div className="flex items-center gap-1.5">
                      {!seenVer && (
                        <span className="px-1.5 py-0.5 bg-amber-500/20 border border-amber-400/60 font-mono text-[9px] text-amber-300 uppercase rounded-xs">
                          BRIEFING {m.briefingVersion}
                        </span>
                      )}
                      {mRec?.completed && (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] sm:text-[11px] text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" /> RANK {mRec.bestGrade ?? 'B'}
                        </span>
                      )}
                    </div>
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

          {/* Selected Mission Pre-Deployment Briefing & Launch */}
          <Card className="md:col-span-7 flex flex-col" data-testid="mission-briefing-panel">
            <CardContent className="flex flex-col justify-between gap-3.5 flex-1 p-4 sm:p-5">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-cyan-400 uppercase tracking-widest">
                        {activeMission.codeName} // {activeMission.mapName}
                      </span>
                      <span
                        data-testid="briefing-version-badge"
                        className={`font-mono text-[9px] px-1.5 py-0.5 rounded-xs border uppercase ${
                          hasSeenCurrentVersion
                            ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                            : 'bg-amber-500/20 border-amber-400 text-amber-300 font-bold'
                        }`}
                      >
                        {hasSeenCurrentVersion
                          ? `Briefing ${activeMission.briefingVersion} Reviewed`
                          : `New Briefing ${activeMission.briefingVersion} — Read Before Deploy`}
                      </span>
                    </div>
                    <h3 className="font-display text-2xl sm:text-3xl font-bold uppercase text-white mt-0.5">
                      {activeMission.title}
                    </h3>
                    {activeMission.locationDetail && (
                      <div className="font-mono text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                        <Compass className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span>{activeMission.locationDetail}</span>
                      </div>
                    )}
                  </div>
                  {rec?.bestScore ? (
                    <div className="flex items-center gap-3 text-right font-mono text-xs">
                      {rec.bestGrade && (
                        <div>
                          <div className="text-zinc-400">BEST RANK</div>
                          <div className="text-cyan-400 text-lg font-bold tabular-nums">{rec.bestGrade}</div>
                        </div>
                      )}
                      {rec.fastestTimeSec ? (
                        <div>
                          <div className="text-zinc-400">FASTEST TIME</div>
                          <div className="text-emerald-400 text-lg font-bold tabular-nums">
                            {Math.floor(rec.fastestTimeSec / 60)}:
                            {(rec.fastestTimeSec % 60).toString().padStart(2, '0')}
                          </div>
                        </div>
                      ) : null}
                      <div>
                        <div className="text-zinc-400">BEST SCORE</div>
                        <div className="text-amber-400 text-lg font-bold tabular-nums">{rec.bestScore}</div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed mt-3">{activeMission.briefing}</p>

                {/* Primary Objectives with Step-by-Step Instructions */}
                <div className="mt-3.5">
                  <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 mb-1.5 flex items-center gap-2">
                    <Target className="w-3.5 h-3.5 text-amber-400" /> Staged Combat Progression ({activeMission.objectives.length} Stages)
                  </div>
                  <div className="space-y-1.5">
                    {activeMission.objectives.map((obj, idx) => (
                      <div
                        key={obj.id}
                        className="bg-[#0B0E11] border border-zinc-800 px-3 py-2 rounded-sm flex items-start justify-between gap-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 text-cyan-400 rounded-xs">
                              {obj.stageTitle || `STAGE 0${idx + 1}`}
                            </span>
                            {obj.demolitionPolicy === 'charge_or_c4_only' && (
                              <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 bg-amber-500/15 border border-amber-400/50 text-amber-300 rounded-xs">
                                [E] / C4 DEMOLITION
                              </span>
                            )}
                          </div>
                          <div className="text-xs sm:text-sm font-medium text-zinc-100 mt-1">
                            <span className="font-mono text-amber-400 mr-1.5">0{idx + 1}.</span>
                            {obj.title}
                          </div>
                          <div className="text-[11px] text-zinc-400 mt-0.5">{obj.description}</div>
                        </div>
                        <span className="font-mono text-xs text-amber-400 shrink-0">x{obj.targetCount}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Threat Intel & Extraction Rules Summary */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="bg-[#0B0E11]/90 border border-zinc-800 p-2.5 rounded-sm">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-red-400 flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" /> Hostile Threats
                    </div>
                    <ul className="space-y-0.5 text-[11px] text-zinc-300 list-disc list-inside">
                      {activeMission.threatSummary.map((t, idx) => (
                        <li key={idx} className="leading-snug">
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-[#0B0E11]/90 border border-zinc-800 p-2.5 rounded-sm">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 mb-1">
                      <Flag className="w-3 h-3 shrink-0" /> Completion &amp; Extraction
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-snug">
                      {activeMission.extractionConditions ||
                        'Complete all primary objectives above to secure the sector.'}
                    </p>
                    <p className="font-mono text-[10px] text-rose-300 mt-1">
                      FIELD MEDS: Walk over glowing Red Hearts (+35 HP) or Resupply Crates [E].
                    </p>
                  </div>
                </div>

                {/* Difficulty Tier */}
                <div className="mt-3.5">
                  <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 mb-1.5 flex items-center gap-2">
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

                {/* Tactical Mission Challenges & Replay Modifiers (TRN-34) */}
                <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div
                    data-testid="mission-challenges-section"
                    className="bg-[#0B0E11]/90 border border-zinc-800 p-2.5 rounded-sm space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-amber-400">
                      <span>Tactical Challenges</span>
                      <span className="tabular-nums text-zinc-400">
                        {missionChallenges.filter((c) => completedChallenges.includes(c.id)).length}/
                        {missionChallenges.length}
                      </span>
                    </div>
                    {missionChallenges.map((ch) => {
                      const done = completedChallenges.includes(ch.id);
                      return (
                        <div
                          key={ch.id}
                          className="border-t border-zinc-800/80 pt-1.5 flex items-start justify-between gap-2 text-[11px]"
                        >
                          <div className="min-w-0">
                            <div className={`font-medium ${done ? 'text-emerald-400' : 'text-zinc-100'}`}>
                              {done ? '✓ ' : ''}
                              {ch.title}
                            </div>
                            <div className="text-[10px] text-zinc-400 leading-snug">{ch.description}</div>
                          </div>
                          <span className="font-mono text-[10px] tabular-nums text-amber-300 whitespace-nowrap shrink-0">
                            +{ch.requisitionBonus} REQ
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    data-testid="replay-modifiers-section"
                    className="bg-[#0B0E11]/90 border border-zinc-800 p-2.5 rounded-sm space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-cyan-400">
                      <span>Replay Modifiers</span>
                      <span className="tabular-nums text-amber-300">
                        {activeModifiers.length > 0
                          ? `x${modifierSummary.scoreMultiplier.toFixed(2)} SCORE · +${modifierSummary.requisitionBonusPct}% REQ`
                          : 'STANDARD'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {REPLAY_MODIFIERS.map((mod) => {
                        const enabled = activeModifiers.includes(mod.id);
                        return (
                          <button
                            key={mod.id}
                            type="button"
                            data-testid={`modifier-toggle-${mod.id}`}
                            aria-pressed={enabled}
                            onClick={() => {
                              onUiClick();
                              toggleModifier(mod.id);
                            }}
                            title={mod.description}
                            className={`px-2 py-1.5 rounded-xs border text-left transition-colors cursor-pointer ${
                              enabled
                                ? 'bg-amber-500/18 border-amber-400 text-amber-200'
                                : 'bg-[#141920] border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                            }`}
                          >
                            <div className="font-mono text-[10px] font-bold uppercase truncate">
                              {mod.shortLabel}
                            </div>
                            <div className="font-mono text-[9px] tabular-nums text-zinc-400">
                              +{mod.requisitionBonusPct}% REQ
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="pt-1 border-t border-zinc-800/80 flex items-center justify-between font-mono text-[9.5px] text-zinc-400">
                      <span>WEAPON MASTERY</span>
                      <span className="tabular-nums text-zinc-300 truncate max-w-[190px]">
                        {topMastery
                          .map((m) => {
                            const w = WEAPON_CATALOG.find((x) => x.id === m.weaponId);
                            return `${w?.shortName ?? m.weaponId} ${m.tier} (${m.kills})`;
                          })
                          .join(' · ')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Platform-Matched Controls Preparation Strip */}
                <div
                  data-testid="briefing-controls-guide"
                  className="mt-3 bg-[#0B0E11]/90 border border-amber-500/35 px-3 py-2 rounded-sm font-mono text-[10px] text-zinc-200 space-y-0.5"
                >
                  {viewport.isCoarsePointer ? (
                    <>
                      <div>
                        <span className="text-amber-400 font-bold">INFANTRY TOUCH:</span> Left Stick 8-Way Move · Right Drag 360° Aim · Tap <span className="text-amber-300">[RPG]</span> for Bazooka · Tap <span className="text-amber-300">[USE]</span> for Crates/Vehicles
                      </div>
                      <div>
                        <span className="text-cyan-400 font-bold">VEHICLE DRIVING:</span> Left/Right Steer Buttons · Hold <span className="text-emerald-300">GAS</span> · Hold <span className="text-red-300">BRAKE/REV</span> to Stop &amp; Reverse
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span className="text-amber-400 font-bold">INFANTRY KEYS:</span> [WASD/Arrows] Move · [Mouse] Aim · [LMB/RMB] Fire/ADS · <span className="text-amber-300">[7] RPG-7V Bazooka</span> · [8] Guided Missile · [E] Interact/Board
                      </div>
                      <div>
                        <span className="text-cyan-400 font-bold">VEHICLE DRIVING:</span> [W] Gas · [S] Brake / Hold to Reverse · [A/D] Progressive Steer · [Space] Handbrake · [LMB] Turret · [E] Exit
                      </div>
                    </>
                  )}
                </div>

                <OperationsPlanningPanel
                  missionId={activeMission.id}
                  onUiClick={onUiClick}
                />
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

      {/* Expanded Pre-Deployment Tactical Briefing Dossier Modal */}
      {dossierModalOpen && (
        <div
          data-testid="mission-briefing-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Tactical Briefing Dossier — ${activeMission.title}`}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
        >
          <div className="w-full max-w-2xl bg-[#141920] border-2 border-amber-500/70 rounded-sm shadow-2xl p-4 sm:p-6 space-y-4 my-auto">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400">
                  Pre-Deployment Tactical Dossier // {activeMission.codeName} ({activeMission.briefingVersion})
                </p>
                <h3 className="font-display text-2xl font-bold uppercase text-white mt-0.5">
                  {activeMission.title} — {activeMission.mapName}
                </h3>
                <p className="font-mono text-xs text-cyan-300 mt-0.5">{activeMission.locationDetail}</p>
              </div>
              <button
                type="button"
                data-testid="close-mission-briefing"
                aria-label="Close Briefing Dossier"
                onClick={() => setDossierModalOpen(false)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs sm:text-sm text-zinc-200">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-amber-400 mb-1">
                  1. Required Step-by-Step Execution Plan
                </div>
                <ol className="list-decimal list-inside space-y-1 text-zinc-300">
                  {activeMission.requiredActionsSummary.map((step, i) => (
                    <li key={i} className="leading-relaxed">
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-red-400 mb-1">
                  2. Confirmed Enemy Forces &amp; Armor
                </div>
                <ul className="list-disc list-inside space-y-1 text-zinc-300">
                  {activeMission.threatSummary.map((threat, i) => (
                    <li key={i}>{threat}</li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-emerald-400 mb-1">
                  3. Extraction &amp; Survival Rules
                </div>
                <p className="text-zinc-300 leading-relaxed">{activeMission.extractionConditions}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-end gap-2.5">
              <Button variant="ghost" size="md" onClick={() => setDossierModalOpen(false)}>
                Return to Mission Select
              </Button>
              <Button
                variant="primary"
                size="md"
                data-testid="confirm-briefing-deploy"
                onClick={handleLaunch}
              >
                <Play className="w-4 h-4 fill-current" /> Confirm &amp; Deploy Operation
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
