import React from 'react';
import {
  Play,
  Crosshair,
  Settings,
  ShieldAlert,
  Award,
  BookOpen,
  Zap,
  Volume2,
  VolumeX,
} from 'lucide-react';
import theaterDesertImg from '@/src/assets/images/theater_desert_convoy_1795162698073.webp';
import theaterNightImg from '@/src/assets/images/theater_night_foundry_1795162697888.webp';
import theaterUrbanImg from '@/src/assets/images/theater_urban_dawn_1795162698497.webp';
import { getMissionById } from '@/src/data/missions';
import { getRankForXp } from '@/src/data/ranks';
import { useAudioSettingsStore } from '@/src/stores/audioSettingsStore';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { uiStore } from '@/src/stores/uiStore';
import { Button } from '@/src/ui/primitives/Button';
import { ProgressBar } from '@/src/ui/primitives/Controls';

function getBackdropForMission(missionId: number): string {
  if (missionId === 2) return theaterDesertImg;
  if (missionId === 3 || missionId === 5) return theaterNightImg;
  return theaterUrbanImg;
}

export function TitleScreen({
  onQuickDeploy,
  onUiClick,
  hardwareBadge = null,
}: {
  onQuickDeploy?: () => void;
  onUiClick: () => void;
  hardwareBadge?: string | null;
}) {
  const save = useProgressionStore((s) => s.save);
  const rank = getRankForXp(save.xp);
  const muted = useAudioSettingsStore((s) => s.muted);
  const updateAudio = useAudioSettingsStore((s) => s.updateAudio);
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);
  const difficulty = useMissionSelectionStore((s) => s.difficulty);
  const deploymentMode = useMissionSelectionStore((s) =>
    s.getDeploymentModeForMission(s.selectedMissionId)
  );
  const seenBriefings = useMissionSelectionStore((s) => s.seenMissionBriefings);
  const selectedMission = getMissionById(selectedMissionId);
  const hasSeenVersionedBriefing =
    seenBriefings[selectedMission.missionKey] === selectedMission.briefingVersion;
  const backdropUrl = getBackdropForMission(selectedMission.id);

  const nav = (screen: 'campaign' | 'armory' | 'howToPlay') => {
    onUiClick();
    uiStore.getState().setScreen(screen);
  };

  return (
    <div
      className="fixed inset-0 z-20 isolate flex flex-col justify-between gap-3 [@media(max-height:460px)]:gap-1.5 overflow-y-auto bg-[var(--vg-bg-canvas)]"
      style={{
        paddingTop: 'max(14px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(18px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(18px, env(safe-area-inset-right, 0px))',
      }}
    >
      {/* Full-bleed Theater Artwork Backdrop + Directional Readability Scrim */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <img
          src={backdropUrl}
          alt=""
          className="w-full h-full object-cover object-center opacity-72 scale-[1.02]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#080B0F]/95 via-[#080B0F]/72 to-[#080B0F]/18" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#080B0F]/92 via-transparent to-[#080B0F]/52" />
      </div>

      {/* Top Bar: Operator Rank, Career Summary & Quick Audio */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 bg-[var(--vg-bg-panel)]/92 border border-[var(--vg-border-subtle)] px-3.5 py-2 rounded-sm">
          <Award className="w-5 h-5 text-[var(--vg-accent-amber)] shrink-0" />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--vg-text-secondary)]">
              {rank.current.insignia} · {rank.current.title}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="w-24 sm:w-28">
                <ProgressBar value={rank.progressPct} className="h-1.5" />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-[var(--vg-accent-amber)]">
                {save.requisitionPoints} REQ
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2.5 font-mono text-xs text-[var(--vg-text-secondary)] bg-[var(--vg-bg-panel)]/90 border border-[var(--vg-border-subtle)] px-3 py-2 rounded-sm tabular-nums">
            <span>KILLS {save.totalKills}</span>
            <span className="text-[var(--vg-border-strong)]">|</span>
            <span>HEADSHOTS {save.totalHeadshots}</span>
            <span className="text-[var(--vg-border-strong)]">|</span>
            <span>AWARDS {save.achievements.length}/6</span>
          </div>

          {hardwareBadge && (
            <div className="hidden xl:flex items-center font-mono text-[10px] uppercase tracking-wider text-[var(--vg-text-muted)] bg-[var(--vg-bg-recessed)]/90 border border-[var(--vg-border-subtle)] px-2.5 py-2 rounded-sm">
              {hardwareBadge}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
            className="min-h-[40px] min-w-[40px] px-2.5"
            onClick={() => {
              onUiClick();
              updateAudio({ muted: !muted });
            }}
          >
            {muted ? (
              <VolumeX className="w-4 h-4 text-[var(--vg-accent-crimson)]" />
            ) : (
              <Volume2 className="w-4 h-4 text-[var(--vg-text-secondary)]" />
            )}
          </Button>
        </div>
      </div>

      {/* Center-Left Hero Lockup & Primary Navigation */}
      <div className="relative z-10 max-w-xl my-auto py-2 [@media(max-height:460px)]:py-0.5">
        <div className="flex items-center gap-3.5 mb-3 sm:mb-4 [@media(max-height:460px)]:mb-2">
          <svg
            viewBox="0 0 48 48"
            className="w-9 h-9 sm:w-11 sm:h-11 text-[var(--vg-accent-amber)] shrink-0"
            aria-hidden="true"
          >
            <polygon
              points="24,2 44,14 44,34 24,46 4,34 4,14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <polygon points="24,10 35,28 24,23 13,28" fill="currentColor" />
            <rect x="22" y="28" width="4" height="10" fill="#22D3EE" />
          </svg>
          <div>
            <p className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.24em] text-[var(--vg-accent-cyan)]">
              Special Operations Command · Op 0{selectedMission.id} Ready
            </p>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl [@media(max-height:460px)]:text-3xl font-bold uppercase tracking-wider text-[var(--vg-text-primary)] leading-none mt-1">
              VANGUARD
              <span className="block text-[var(--vg-accent-amber)] text-lg sm:text-2xl lg:text-3xl [@media(max-height:460px)]:text-base tracking-[0.22em] mt-1">
                ZERO HOUR
              </span>
            </h1>
          </div>
        </div>

        <p className="text-xs sm:text-sm lg:text-base text-[var(--vg-text-secondary)] leading-relaxed max-w-lg mb-5 sm:mb-6 [@media(max-height:460px)]:mb-2.5 [@media(max-height:460px)]:text-xs">
          Five tactical single-player operations across warzone cities, desert convoys, river valleys,
          and industrial foundries. Deploy Solo or lead a Fireteam, command armored vehicles, and
          customize your arsenal.
        </p>

        <div className="flex flex-wrap gap-2.5 mb-3">
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
              <Zap className="w-4 h-4 text-[var(--vg-accent-amber)]" /> Quick Deploy (Op 0
              {selectedMission.id} · {difficulty} ·{' '}
              {deploymentMode === 'solo' ? 'Solo' : 'Fireteam'})
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => nav('campaign')}
              className="min-h-[44px]"
            >
              <ShieldAlert className="w-4 h-4 text-[var(--vg-accent-amber)]" /> Select Operation
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="md"
            className="min-h-[44px]"
            onClick={() => nav('armory')}
          >
            <Crosshair className="w-4 h-4 text-[var(--vg-accent-cyan)]" /> Armory &amp; Upgrades
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

      {/* Bottom Operational Control Reference */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] sm:text-[11px] text-[var(--vg-text-muted)] tracking-wider shrink-0 border-t border-[var(--vg-border-subtle)]/60 pt-2.5">
        <span>
          DESKTOP: WASD · MOUSE · [7] RPG · [E] VEHICLE · [TAB] TACTICAL OVERVIEW
        </span>
        <span>TOUCH: LEFT STICK MOVE · RIGHT DRAG AIM · 1-TAP ORDNANCE</span>
      </div>
    </div>
  );
}
