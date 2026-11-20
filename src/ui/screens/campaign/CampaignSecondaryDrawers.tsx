import React, { useEffect } from 'react';
import {
  Award,
  BookOpen,
  FileText,
  Gamepad2,
  GitBranch,
  Shield,
  Sliders,
  Trophy,
  X,
} from 'lucide-react';
import {
  REPLAY_MODIFIERS,
  ReplayModifierId,
  evaluateWeaponMastery,
  getChallengesForMission,
} from '@/src/data/challenges';
import { getMissionById } from '@/src/data/missions';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import {
  getMissionIntelBriefing,
  resolveMissionConsequences,
} from '@/src/gameplay/campaign/CampaignEventLedger';
import { DeploymentMode, ReplayMode } from '@/src/schemas/campaign.schema';
import { Difficulty } from '@/src/schemas/common.schema';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { Button } from '@/src/ui/primitives/Button';

export type SecondaryDrawerTab = 'intel' | 'rules' | 'performance' | 'controls' | 'briefing';

interface CampaignSecondaryDrawersProps {
  openTab: SecondaryDrawerTab | null;
  missionId: number;
  deploymentMode: DeploymentMode;
  onSelectTab: (tab: SecondaryDrawerTab) => void;
  onClose: () => void;
  onUiClick: () => void;
}

const DIFFICULTY_OPTIONS: ReadonlyArray<{
  id: Difficulty;
  label: string;
  summary: string;
}> = [
  { id: 'easy', label: 'Recruit', summary: 'Forgiving incoming bursts and generous resupply yields.' },
  { id: 'normal', label: 'Operator', summary: 'Balanced tactical cadence across all five theaters.' },
  { id: 'hard', label: 'Veteran', summary: 'Faster hostile reactions, tighter sustainment economy.' },
  { id: 'extreme', label: 'Zero Hour', summary: 'High lethality, tightest med/ammo economy, punishing flanks.' },
];

const REPLAY_MODES: ReadonlyArray<{
  id: ReplayMode;
  label: string;
  desc: string;
}> = [
  {
    id: 'canonical',
    label: 'Canonical Campaign',
    desc: 'Commits outcomes to the persistent campaign ledger and advances HQ recovery.',
  },
  {
    id: 'campaign_replay',
    label: 'Campaign Replay',
    desc: 'Replays an earlier operation and previews timeline rebase before committing.',
  },
  {
    id: 'clean_replay',
    label: 'Clean Replay',
    desc: 'Score, rank, and weapon mastery only. Never mutates campaign ledger or HQ recovery.',
  },
];

export function CampaignSecondaryDrawers({
  openTab,
  missionId,
  deploymentMode,
  onSelectTab,
  onClose,
  onUiClick,
}: CampaignSecondaryDrawersProps) {
  const difficulty = useMissionSelectionStore((s) => s.difficulty);
  const setDifficulty = useMissionSelectionStore((s) => s.setDifficulty);
  const replayMode = useMissionSelectionStore((s) => s.replayMode);
  const setReplayMode = useMissionSelectionStore((s) => s.setReplayMode);

  const save = useProgressionStore((s) => s.save);
  const toggleModifier = useProgressionStore((s) => s.toggleModifier);
  const clearModifiers = useProgressionStore((s) => s.clearModifiers);
  const toggleIronmanSquad = useProgressionStore((s) => s.toggleIronmanSquad);

  useEffect(() => {
    if (!openTab) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openTab, onClose]);

  if (!openTab) return null;

  const mission = getMissionById(missionId);
  const record = save.missionRecords[String(mission.id)];
  const challenges = getChallengesForMission(mission.id);
  const consequences = resolveMissionConsequences(mission.id, save.campaignLedger, replayMode);
  const intelItems = getMissionIntelBriefing(mission.id, consequences);
  const verifiedIntelItems = intelItems.filter((item) => item.verified);
  const uncertainIntelItems = intelItems.filter((item) => !item.verified);
  const activeModifiers = save.activeModifiers ?? [];

  const tabs: Array<{ id: SecondaryDrawerTab; label: string; icon: React.ReactNode }> = [
    { id: 'briefing', label: 'Briefing Dossier', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'intel', label: 'Mission Intel', icon: <GitBranch className="w-3.5 h-3.5" /> },
    { id: 'rules', label: 'Operations Rules', icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: 'performance', label: 'Performance', icon: <Trophy className="w-3.5 h-3.5" /> },
    { id: 'controls', label: 'Controls', icon: <Gamepad2 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Campaign Tactical Reference Drawer"
      data-testid="campaign-secondary-drawer"
      className="fixed inset-0 z-50 bg-black/75 flex justify-end items-end md:items-stretch"
      onClick={onClose}
    >
      <div
        className="w-full md:w-[min(94vw,660px)] h-[88dvh] md:h-full bg-[#0B0E11] border-t md:border-t-0 md:border-l border-zinc-700 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 bg-[#141920] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">
              {mission.codeName} · Tactical Reference
            </div>
            <h2 className="font-display text-lg font-bold uppercase text-white truncate">
              {mission.title}
            </h2>
          </div>
          <button
            type="button"
            data-testid="secondary-drawer-close"
            aria-label="Close Tactical Reference"
            onClick={() => {
              onUiClick();
              onClose();
            }}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-[#0B0E11] hover:bg-zinc-800 border border-zinc-700 rounded-sm text-zinc-300 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="px-3 py-2 border-b border-zinc-800 bg-[#0F1319] flex items-center gap-1.5 overflow-x-auto shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid={`secondary-tab-${tab.id}`}
              aria-pressed={openTab === tab.id}
              onClick={() => {
                onUiClick();
                onSelectTab(tab.id);
              }}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-sm border font-mono text-[10.5px] uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                openTab === tab.id
                  ? 'bg-amber-500/15 border-amber-400 text-amber-300 font-bold'
                  : 'bg-[#141920] border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {openTab === 'briefing' && (
            <div className="space-y-4" data-testid="drawer-content-briefing">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
                  Full Operational Briefing
                </div>
                <p className="text-sm text-zinc-200 leading-relaxed mt-1.5">{mission.briefing}</p>
              </div>

              <div className="border-t border-zinc-800 pt-3 space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-cyan-400">
                  Staged Mission Objectives ({mission.objectives.length})
                </div>
                <div className="space-y-2">
                  {mission.objectives.map((obj, idx) => (
                    <div
                      key={obj.id}
                      className="bg-[#141920] border border-zinc-800 p-3 rounded-sm flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="font-mono text-[10px] text-amber-400 uppercase">
                          Stage {obj.stageIndex ?? idx + 1} · {!obj.isOptional ? 'Primary' : 'Optional'}
                        </div>
                        <div className="text-sm font-semibold text-white mt-0.5">{obj.title}</div>
                        <p className="text-xs text-zinc-400 mt-0.5">{obj.description}</p>
                      </div>
                      <span className="font-mono text-xs text-zinc-300 tabular-nums shrink-0">
                        Target {obj.targetCount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {openTab === 'intel' && (
            <div className="space-y-4" data-testid="drawer-content-intel">
              <div className="bg-[#141920] border border-zinc-800 p-3 rounded-sm space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-400 font-bold">
                  Verified Theater Intelligence
                </div>
                {verifiedIntelItems.length === 0 ? (
                  <p className="text-xs text-zinc-400">No verified theater intel logged yet.</p>
                ) : (
                  <ul className="space-y-2 text-xs text-zinc-200">
                    {verifiedIntelItems.map((item) => (
                      <li key={item.id} className="flex items-start gap-2">
                        <span className="text-emerald-400 font-mono">•</span>
                        <div>
                          <div className="font-semibold text-zinc-100">{item.label}</div>
                          <div className="text-zinc-300">{item.detail}</div>
                          <div className="font-mono text-[10px] text-emerald-400/80 mt-0.5">
                            {item.sourceLabel}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-[#141920] border border-zinc-800 p-3 rounded-sm space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400 font-bold">
                  Uncertain / Unconfirmed Threats
                </div>
                {uncertainIntelItems.length === 0 ? (
                  <p className="text-xs text-zinc-400">All mission intel has been verified.</p>
                ) : (
                  <ul className="space-y-2 text-xs text-zinc-300">
                    {uncertainIntelItems.map((item) => (
                      <li key={item.id} className="flex items-start gap-2">
                        <span className="text-amber-400 font-mono">?</span>
                        <div>
                          <div className="font-semibold text-zinc-100">{item.label}</div>
                          <div className="text-zinc-300">{item.detail}</div>
                          <div className="font-mono text-[10px] text-amber-400/80 mt-0.5">
                            {item.sourceLabel}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-[#141920] border border-zinc-800 p-3 rounded-sm space-y-2">
                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
                  <span className="text-cyan-400 font-bold">Active Campaign Consequences</span>
                  <span className="text-zinc-400">{consequences.activeSummaries.length} Active</span>
                </div>
                {consequences.activeSummaries.length === 0 ? (
                  <p className="text-xs text-zinc-400">
                    No downstream consequences active for this operation under{' '}
                    {replayMode.replace('_', ' ')}.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {consequences.activeSummaries.map((c) => (
                      <div
                        key={c.eventId}
                        className="bg-[#0B0E11] border border-zinc-800 px-2.5 py-2 rounded-xs text-xs"
                      >
                        <div className="font-semibold text-zinc-100">{c.title}</div>
                        <div className="text-zinc-400 mt-0.5">{c.effectDescription}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {openTab === 'rules' && (
            <div className="space-y-4" data-testid="drawer-content-rules">
              {/* Difficulty */}
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400 font-bold">
                  Combat Difficulty
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DIFFICULTY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`rules-difficulty-${opt.id}`}
                      aria-pressed={difficulty === opt.id}
                      onClick={() => {
                        onUiClick();
                        setDifficulty(opt.id);
                      }}
                      className={`min-h-[54px] p-3 rounded-sm border text-left cursor-pointer transition-colors ${
                        difficulty === opt.id
                          ? 'bg-amber-500/15 border-amber-400 text-white'
                          : 'bg-[#141920] border-zinc-800 text-zinc-300 hover:border-zinc-600'
                      }`}
                    >
                      <div className="font-display text-sm font-bold uppercase">{opt.label}</div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">{opt.summary}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Replay Mode */}
              <div className="space-y-2 border-t border-zinc-800 pt-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-cyan-400 font-bold">
                  Campaign Timeline Mode
                </div>
                <div className="space-y-1.5">
                  {REPLAY_MODES.map((rm) => (
                    <button
                      key={rm.id}
                      type="button"
                      data-testid={`rules-replay-${rm.id}`}
                      aria-pressed={replayMode === rm.id}
                      onClick={() => {
                        onUiClick();
                        setReplayMode(rm.id);
                      }}
                      className={`w-full min-h-[48px] p-3 rounded-sm border text-left cursor-pointer transition-colors ${
                        replayMode === rm.id
                          ? 'bg-cyan-500/15 border-cyan-400 text-white'
                          : 'bg-[#141920] border-zinc-800 text-zinc-300 hover:border-zinc-600'
                      }`}
                    >
                      <div className="font-mono text-xs font-bold uppercase">{rm.label}</div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">{rm.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Replay Modifiers */}
              <div className="space-y-2 border-t border-zinc-800 pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400 font-bold">
                    Tactical Replay Modifiers ({activeModifiers.length} Active)
                  </span>
                  {activeModifiers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        onUiClick();
                        clearModifiers();
                      }}
                      className="font-mono text-[10px] uppercase text-zinc-400 hover:text-white cursor-pointer"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {REPLAY_MODIFIERS.map((mod) => {
                    const active = activeModifiers.includes(mod.id as ReplayModifierId);
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        data-testid={`rules-modifier-${mod.id}`}
                        aria-pressed={active}
                        onClick={() => {
                          onUiClick();
                          toggleModifier(mod.id as ReplayModifierId);
                        }}
                        className={`min-h-[54px] p-2.5 rounded-sm border text-left cursor-pointer ${
                          active
                            ? 'bg-amber-500/15 border-amber-400 text-white'
                            : 'bg-[#141920] border-zinc-800 text-zinc-300 hover:border-zinc-600'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold uppercase">{mod.title}</span>
                          <span className="font-mono text-[10px] text-amber-300">
                            +{mod.requisitionBonusPct}% REQ
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-0.5">{mod.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Ironman Squad Policy */}
              <div className="border-t border-zinc-800 pt-3">
                <button
                  type="button"
                  data-testid="rules-ironman-toggle"
                  aria-pressed={save.ironmanSquadEnabled}
                  onClick={() => {
                    onUiClick();
                    toggleIronmanSquad();
                  }}
                  className={`w-full min-h-[52px] p-3 rounded-sm border text-left flex items-center justify-between gap-3 cursor-pointer ${
                    save.ironmanSquadEnabled
                      ? 'bg-red-950/35 border-red-500 text-red-200'
                      : 'bg-[#141920] border-zinc-800 text-zinc-300'
                  }`}
                >
                  <div>
                    <div className="font-mono text-xs font-bold uppercase flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-red-400" />
                      Ironman Fireteam Casualties
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      Operators who bleed out become permanently KIA instead of entering HQ recovery.
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold shrink-0">
                    {save.ironmanSquadEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {openTab === 'performance' && (
            <div className="space-y-4" data-testid="drawer-content-performance">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs tabular-nums">
                <div className="bg-[#141920] border border-zinc-800 p-2.5 rounded-sm">
                  <div className="text-[10px] text-zinc-400 uppercase">Best Rank</div>
                  <div className="text-lg font-bold text-amber-400 mt-0.5">
                    {record?.bestGrade ?? '—'}
                  </div>
                </div>
                <div className="bg-[#141920] border border-zinc-800 p-2.5 rounded-sm">
                  <div className="text-[10px] text-zinc-400 uppercase">Best Score</div>
                  <div className="text-lg font-bold text-white mt-0.5">
                    {record?.bestScore ?? 0}
                  </div>
                </div>
                <div className="bg-[#141920] border border-zinc-800 p-2.5 rounded-sm">
                  <div className="text-[10px] text-zinc-400 uppercase">REQ Reserve</div>
                  <div className="text-lg font-bold text-amber-300 mt-0.5">
                    {save.requisitionPoints}
                  </div>
                </div>
                <div className="bg-[#141920] border border-zinc-800 p-2.5 rounded-sm">
                  <div className="text-[10px] text-zinc-400 uppercase">Awards</div>
                  <div className="text-lg font-bold text-cyan-400 mt-0.5">
                    {save.achievements.length}/6
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-cyan-400 font-bold flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5" /> Operation Challenges ({challenges.length})
                </div>
                {challenges.map((ch) => {
                  const done = save.completedChallenges.includes(ch.id);
                  return (
                    <div
                      key={ch.id}
                      className={`p-2.5 rounded-sm border flex items-center justify-between gap-2 ${
                        done
                          ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                          : 'bg-[#141920] border-zinc-800 text-zinc-200'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-semibold">{ch.title}</div>
                        <div className="text-[11px] text-zinc-400">{ch.description}</div>
                      </div>
                      <span className="font-mono text-[10px] text-amber-300 shrink-0 tabular-nums">
                        {done ? 'DONE' : `+${ch.requisitionBonus} REQ`}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 border-t border-zinc-800 pt-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
                  Arsenal Mastery Snapshot
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
                  {WEAPON_CATALOG.slice(0, 6).map((w) => {
                    const kills = save.weaponMasteryKills[w.id] ?? 0;
                    const mastery = evaluateWeaponMastery(w.id, kills);
                    return (
                      <div
                        key={w.id}
                        className="bg-[#141920] border border-zinc-800 p-2 rounded-xs"
                      >
                        <div className="text-zinc-100 font-bold truncate">{w.shortName}</div>
                        <div className="text-[10px] text-amber-300 mt-0.5 uppercase">
                          {mastery.tier} · {kills} kills
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {openTab === 'controls' && (
            <div className="space-y-4" data-testid="drawer-content-controls">
              <div className="bg-[#141920] border border-zinc-800 p-3 rounded-sm space-y-1.5 font-mono text-xs">
                <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold mb-1">
                  Infantry Controls (Desktop &amp; Touch)
                </div>
                <div className="flex justify-between gap-2 text-zinc-300">
                  <span className="text-zinc-400">Move / Aim / Fire</span>
                  <span>WASD · Mouse · LMB / RMB ADS</span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-300">
                  <span className="text-zinc-400">Weapons / Heavy / Swap</span>
                  <span>[1–9] · [7] RPG · [H] Supply Swap</span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-300">
                  <span className="text-zinc-400">Tactical / Ordnance</span>
                  <span>[G] Frag · [C] C4 · [V] Strike</span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-300">
                  <span className="text-zinc-400">Interact / Resupply / Overview</span>
                  <span>[E] Interact · [TAB] Tactical Map</span>
                </div>
              </div>

              <div className="bg-[#141920] border border-zinc-800 p-3 rounded-sm space-y-1.5 font-mono text-xs">
                <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold mb-1">
                  Armored Vehicle Controls
                </div>
                <div className="flex justify-between gap-2 text-zinc-300">
                  <span className="text-zinc-400">Drive / Steer / Brake</span>
                  <span>[W/S] Gas/Rev · [A/D] Steer · [SPACE] Drift</span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-300">
                  <span className="text-zinc-400">Turret / Camera / Exit</span>
                  <span>LMB Fire · [F] Camera · [E] Exit</span>
                </div>
              </div>

              {deploymentMode === 'fireteam' ? (
                <div
                  data-testid="controls-fireteam-section"
                  className="bg-[#141920] border border-cyan-500/40 p-3 rounded-sm space-y-1.5 font-mono text-xs"
                >
                  <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold mb-1">
                    Fireteam Squad Commands (Active Mode)
                  </div>
                  <div className="flex justify-between gap-2 text-zinc-300">
                    <span className="text-zinc-400">Command Wheel</span>
                    <span>Hold [Q] + Mouse · [1–3] Single Operator</span>
                  </div>
                  <div className="flex justify-between gap-2 text-zinc-300">
                    <span className="text-zinc-400">Quick Orders</span>
                    <span>[F1] Regroup · [F2] Move · [F3] Attack · [F4] Flank</span>
                  </div>
                  <div className="flex justify-between gap-2 text-zinc-300">
                    <span className="text-zinc-400">Rescue Downed Teammate</span>
                    <span>Hold [E] near downed operator</span>
                  </div>
                </div>
              ) : (
                <div
                  data-testid="controls-solo-section"
                  className="bg-[#141920] border border-amber-500/40 p-3 rounded-sm space-y-1.5 font-mono text-xs"
                >
                  <div className="text-[10px] uppercase tracking-wider text-amber-300 font-bold mb-1">
                    Solo Operator Emergency Recovery
                  </div>
                  <div className="flex justify-between gap-2 text-zinc-300">
                    <span className="text-zinc-400">Trauma Self-Revive (1 Charge)</span>
                    <span>[F] or Tap Button when Downed</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 pt-1">
                    Squad command keys are disabled during Solo Operator deployments.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-zinc-800 bg-[#141920] flex items-center justify-between shrink-0">
          <span className="font-mono text-[10px] text-zinc-400 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> Press [ESC] to close
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onUiClick();
              onClose();
            }}
            className="min-h-[40px]"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
