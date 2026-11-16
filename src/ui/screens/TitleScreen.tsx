import React from 'react';
import { Play, Crosshair, Settings, ShieldAlert, Award, BookOpen, Zap } from 'lucide-react';
import { getMissionById } from '@/src/data/missions';
import { getRankForXp } from '@/src/data/ranks';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { uiStore } from '@/src/stores/uiStore';
import { Button } from '@/src/ui/primitives/Button';
import { ProgressBar } from '@/src/ui/primitives/Controls';

export function TitleScreen({
  onQuickDeploy,
  onUiClick,
}: {
  onQuickDeploy?: () => void;
  onUiClick: () => void;
}) {
  const save = useProgressionStore((s) => s.save);
  const rank = getRankForXp(save.xp);
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);
  const difficulty = useMissionSelectionStore((s) => s.difficulty);
  const seenBriefings = useMissionSelectionStore((s) => s.seenMissionBriefings);
  const selectedMission = getMissionById(selectedMissionId);
  const hasSeenVersionedBriefing =
    seenBriefings[selectedMission.missionKey] === selectedMission.briefingVersion;

  const nav = (screen: 'campaign' | 'armory' | 'howToPlay') => {
    onUiClick();
    uiStore.getState().setScreen(screen);
  };

  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-between gap-3 overflow-y-auto bg-gradient-to-r from-[#0B0E11]/94 via-[#0B0E11]/68 to-transparent"
      style={{
        paddingTop: 'max(14px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(18px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(18px, env(safe-area-inset-right, 0px))',
      }}
    >
      {/* Top Bar: Operator Rank & Career Stats */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 bg-[#141920]/90 border border-zinc-800 px-3.5 py-2 rounded-sm">
          <Award className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              {rank.current.insignia} // {rank.current.title}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="w-24 sm:w-28">
                <ProgressBar value={rank.progressPct} className="h-1.5" />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-amber-400">
                {save.requisitionPoints} REQ
              </span>
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2 font-mono text-xs text-zinc-400 bg-[#141920]/85 border border-zinc-800 px-3 py-1.5 rounded-sm">
          <span>KILLS: {save.totalKills}</span>
          <span className="text-zinc-700">|</span>
          <span>HEADSHOTS: {save.totalHeadshots}</span>
          <span className="text-zinc-700">|</span>
          <span>AWARDS: {save.achievements.length}/6</span>
        </div>
      </div>

      {/* Center-Left Hero Lockup & Primary Navigation */}
      <div className="max-w-xl my-auto py-1">
        <div className="flex items-center gap-3 mb-2.5 sm:mb-4">
          <svg viewBox="0 0 48 48" className="w-8 h-8 sm:w-10 sm:h-10 text-amber-500 shrink-0" aria-hidden="true">
            <polygon points="24,2 44,14 44,34 24,46 4,34 4,14" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <polygon points="24,10 35,28 24,23 13,28" fill="currentColor" />
            <rect x="22" y="28" width="4" height="10" fill="#06B6D4" />
          </svg>
          <div>
            <p className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.24em] text-cyan-400">
              Tactical First-Person Combat
            </p>
            <h1 className="font-display text-3xl sm:text-5xl lg:text-6xl font-bold uppercase tracking-wider text-white leading-none mt-0.5">
              VANGUARD
              <span className="block text-amber-500 text-lg sm:text-2xl lg:text-3xl tracking-[0.22em] mt-0.5">
                ZERO HOUR
              </span>
            </h1>
          </div>
        </div>

        <p className="text-xs sm:text-sm lg:text-base text-zinc-300 leading-relaxed max-w-lg mb-4 sm:mb-6">
          Five single-player operations across warzone cities, desert convoys, river valleys,
          and foundries. Command ground vehicles, engage hostile gunships, and upgrade your arsenal.
        </p>

        <div className="flex flex-wrap gap-2.5 mb-2.5 sm:mb-3.5">
          <Button
            size="lg"
            onClick={() => nav('campaign')}
            className="min-h-[44px] sm:min-w-[210px]"
          >
            <Play className="w-4 h-4 fill-current" /> Play Campaign
          </Button>

          {hasSeenVersionedBriefing && onQuickDeploy ? (
            <Button
              variant="secondary"
              size="lg"
              data-testid="quick-deploy-btn"
              onClick={() => {
                onUiClick();
                onQuickDeploy();
              }}
              className="min-h-[44px]"
            >
              <Zap className="w-4 h-4 text-amber-400" /> Quick Deploy (Op 0{selectedMission.id} · {difficulty})
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => nav('campaign')}
              className="min-h-[44px]"
            >
              <ShieldAlert className="w-4 h-4 text-amber-400" /> Select Operation
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="md" className="min-h-[44px]" onClick={() => nav('armory')}>
            <Crosshair className="w-4 h-4 text-cyan-400" /> Armory &amp; Upgrades
          </Button>
          <Button
            variant="outline"
            size="md"
            className="min-h-[44px]"
            onClick={() => {
              onUiClick();
              uiStore.getState().openSettingsFrom('title');
            }}
          >
            <Settings className="w-4 h-4" /> Settings
          </Button>
          <Button
            variant="outline"
            size="md"
            className="min-h-[44px]"
            onClick={() => {
              onUiClick();
              uiStore.getState().openHowToPlayFrom('title');
            }}
          >
            <BookOpen className="w-4 h-4" /> Controls Guide
          </Button>
        </div>
      </div>

      {/* Subtle Bottom Control Hint */}
      <div className="font-mono text-[10px] sm:text-[11px] text-zinc-400 tracking-wider shrink-0">
        TOUCH: LEFT STICK MOVE · RIGHT DRAG AIM · [RPG] 1-TAP BAZOOKA | DESKTOP: WASD · MOUSE · [7] RPG · [E] VEHICLE
      </div>
    </div>
  );
}
