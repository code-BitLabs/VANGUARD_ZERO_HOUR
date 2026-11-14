import React from 'react';
import { Play, Crosshair, Settings, ShieldAlert, Award, BookOpen } from 'lucide-react';
import { getRankForXp } from '@/src/data/ranks';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { uiStore } from '@/src/stores/uiStore';
import { Button } from '@/src/ui/primitives/Button';
import { ProgressBar } from '@/src/ui/primitives/Controls';

export function TitleScreen({
  onQuickPlay,
  onUiClick,
}: {
  onQuickPlay: () => void;
  onUiClick: () => void;
}) {
  const save = useProgressionStore((s) => s.save);
  const rank = getRankForXp(save.xp);

  const nav = (screen: 'campaign' | 'armory' | 'howToPlay') => {
    onUiClick();
    uiStore.getState().setScreen(screen);
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 sm:p-10 bg-gradient-to-r from-[#0B0E11]/92 via-[#0B0E11]/60 to-transparent">
      {/* Top Bar: Operator Rank & Achievements */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 bg-[#141920]/90 border border-zinc-800 px-4 py-2 rounded-sm">
          <Award className="w-5 h-5 text-amber-400" />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              {rank.current.insignia} // {rank.current.title}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="w-28">
                <ProgressBar value={rank.progressPct} className="h-1.5" />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-amber-400">
                {save.requisitionPoints} REQ
              </span>
            </div>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 font-mono text-xs text-zinc-400 bg-[#141920]/85 border border-zinc-800 px-3 py-1.5 rounded-sm">
          <span>KILLS: {save.totalKills}</span>
          <span className="text-zinc-700">|</span>
          <span>HEADSHOTS: {save.totalHeadshots}</span>
          <span className="text-zinc-700">|</span>
          <span>AWARDS: {save.achievements.length}/6</span>
        </div>
      </div>

      {/* Center-Left Hero Lockup & Primary Navigation */}
      <div className="max-w-xl my-auto">
        <div className="flex items-center gap-3 mb-4">
          <svg viewBox="0 0 48 48" className="w-10 h-10 text-amber-500 shrink-0" aria-hidden="true">
            <polygon points="24,2 44,14 44,34 24,46 4,34 4,14" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <polygon points="24,10 35,28 24,23 13,28" fill="currentColor" />
            <rect x="22" y="28" width="4" height="10" fill="#06B6D4" />
          </svg>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-cyan-400">
              Tactical First-Person Combat
            </p>
            <h1 className="font-display text-4xl sm:text-6xl font-bold uppercase tracking-wider text-white leading-none mt-1">
              VANGUARD
              <span className="block text-amber-500 text-2xl sm:text-3xl tracking-[0.22em] mt-1">
                ZERO HOUR
              </span>
            </h1>
          </div>
        </div>

        <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-lg mb-7">
          Five high-intensity single-player operations across warzone cities, desert convoys, tropical river valleys,
          and industrial foundries. Command ground vehicles, lock onto hostile gunships, and upgrade your arsenal.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <Button
            size="lg"
            onClick={() => {
              onUiClick();
              onQuickPlay();
            }}
            className="sm:min-w-[220px]"
          >
            <Play className="w-4 h-4 fill-current" /> Play Campaign
          </Button>
          <Button variant="secondary" size="lg" onClick={() => nav('campaign')}>
            <ShieldAlert className="w-4 h-4 text-amber-400" /> Select Operation
          </Button>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <Button variant="outline" size="md" onClick={() => nav('armory')}>
            <Crosshair className="w-4 h-4 text-cyan-400" /> Armory & Upgrades
          </Button>
          <Button
            variant="outline"
            size="md"
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
      <div className="font-mono text-[11px] text-zinc-400 tracking-wider">
        WASD MOVE • MOUSE AIM • LMB FIRE • RMB SCOPE • [1-9] WEAPONS • [G] GRENADE • [E] VEHICLE / INTERACT • [F3] DIAGNOSTICS
      </div>
    </div>
  );
}
