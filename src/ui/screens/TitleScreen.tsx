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
  Maximize2,
  Minimize2,
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
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { useFullscreen } from '@/src/utils/fullscreen';
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
  const viewport = useViewportMode();
  const { isFullscreen, isSupported, toggleFullscreen, requestFullscreen } = useFullscreen();
  const isTouchOrCompact =
    viewport.isCoarsePointer || viewport.isCompactLandscape || viewport.isPortrait;
  const selectedMission = getMissionById(selectedMissionId);
  const hasSeenVersionedBriefing =
    seenBriefings[selectedMission.missionKey] === selectedMission.briefingVersion;
  const backdropUrl = getBackdropForMission(selectedMission.id);

  const nav = (screen: 'campaign' | 'armory' | 'howToPlay') => {
    onUiClick();
    if (screen === 'campaign' && viewport.isCoarsePointer && isSupported && !isFullscreen) {
      void requestFullscreen();
    }
    uiStore.getState().setScreen(screen);
  };

  return (
    <div
      className="fixed inset-0 z-20 isolate flex flex-col justify-between gap-3 [@media(max-height:460px)]:gap-1 overflow-y-auto bg-[var(--vg-bg-canvas)] [@media(max-height:460px)]:!py-2 [@media(max-height:460px)]:!px-3.5"
      style={{
        paddingTop: 'max(14px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
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
      <div className="relative z-10 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3 bg-[var(--vg-bg-panel)]/92 border border-[var(--vg-border-subtle)] px-2.5 sm:px-3.5 py-1.5 sm:py-2 [@media(max-height:460px)]:px-2.5 [@media(max-height:460px)]:py-1 rounded-sm min-w-0">
          <Award className="w-4 h-4 sm:w-5 sm:h-5 [@media(max-height:460px)]:w-4 [@media(max-height:460px)]:h-4 text-[var(--vg-accent-amber)] shrink-0" />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider sm:tracking-widest text-[var(--vg-text-secondary)] truncate">
              {rank.current.insignia} · {rank.current.title}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 mt-1 [@media(max-height:460px)]:mt-0.5">
              <div className="w-16 min-[360px]:w-24 sm:w-28 shrink-0">
                <ProgressBar value={rank.progressPct} className="h-1.5" />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-[var(--vg-accent-amber)] whitespace-nowrap">
                {save.requisitionPoints} REQ
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
            className="min-h-[44px] min-w-[44px] [@media(max-height:460px)]:min-h-[40px] [@media(max-height:460px)]:min-w-[40px] px-2.5"
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

          {isSupported && (
            <Button
              variant="outline"
              size="sm"
              data-testid="title-toggle-fullscreen"
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              className="min-h-[44px] min-w-[44px] [@media(max-height:460px)]:min-h-[40px] [@media(max-height:460px)]:min-w-[40px] px-2.5"
              onClick={() => {
                onUiClick();
                void toggleFullscreen();
              }}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 text-amber-400" />
              ) : (
                <Maximize2 className="w-4 h-4 text-[var(--vg-text-secondary)] hover:text-amber-400" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Center-Left Hero Lockup & Primary Navigation */}
      <div className="relative z-10 max-w-xl my-auto py-2 [@media(max-height:460px)]:py-0.5">
        <div className="flex items-center gap-3 sm:gap-3.5 mb-3 sm:mb-4 [@media(max-height:460px)]:mb-2">
          <svg
            viewBox="0 0 48 48"
            className="w-8 h-8 sm:w-11 sm:h-11 text-[var(--vg-accent-amber)] shrink-0"
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
          <div className="min-w-0">
            <p className="font-mono text-[9.5px] sm:text-xs uppercase tracking-[0.16em] sm:tracking-[0.24em] text-[var(--vg-accent-cyan)]">
              Special Operations Command · Op 0{selectedMission.id} Ready
            </p>
            <h1 className="font-display text-3xl min-[360px]:text-4xl sm:text-5xl lg:text-6xl [@media(max-height:460px)]:text-3xl font-bold uppercase tracking-wider text-[var(--vg-text-primary)] leading-none mt-1">
              VANGUARD
              <span className="block text-[var(--vg-accent-amber)] text-base min-[360px]:text-lg sm:text-2xl lg:text-3xl [@media(max-height:460px)]:text-base tracking-[0.18em] sm:tracking-[0.22em] mt-1">
                ZERO HOUR
              </span>
            </h1>
          </div>
        </div>

        <p className="text-xs sm:text-sm lg:text-base text-[var(--vg-text-secondary)] leading-relaxed max-w-lg mb-4 sm:mb-6 [@media(max-height:460px)]:mb-1.5 [@media(max-height:460px)]:text-xs [@media(max-height:460px)]:leading-snug">
          Five single-player operations across warzone cities, desert bases, and industrial foundries.
          Deploy Solo or lead a tactical Fireteam with customizable weapons and vehicles.
        </p>

        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-2.5 [@media(max-height:460px)]:flex-row [@media(max-height:460px)]:gap-2 mb-2.5 sm:mb-3 [@media(max-height:460px)]:mb-1.5">
          <Button
            size="lg"
            onClick={() => nav('campaign')}
            className="w-full sm:w-auto [@media(max-height:460px)]:w-auto min-h-[46px] [@media(max-height:460px)]:min-h-[44px] sm:min-w-[210px]"
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
                if (viewport.isCoarsePointer && isSupported && !isFullscreen) {
                  void requestFullscreen();
                }
                onQuickDeploy();
              }}
              className="w-full sm:w-auto [@media(max-height:460px)]:w-auto min-h-[46px] [@media(max-height:460px)]:min-h-[44px]"
            >
              <Zap className="w-4 h-4 text-[var(--vg-accent-amber)] shrink-0" />
              <span className="truncate">
                Quick Deploy (Op 0{selectedMission.id} · {difficulty} ·{' '}
                {deploymentMode === 'solo' ? 'Solo' : 'Fireteam'})
              </span>
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => nav('campaign')}
              className="w-full sm:w-auto [@media(max-height:460px)]:w-auto min-h-[46px] [@media(max-height:460px)]:min-h-[44px]"
            >
              <ShieldAlert className="w-4 h-4 text-[var(--vg-accent-amber)]" /> Select Operation
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap [@media(max-height:460px)]:flex gap-2">
          <Button
            variant="outline"
            size="md"
            className="col-span-2 sm:col-span-1 min-h-[44px]"
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
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] sm:text-[11px] text-[var(--vg-text-muted)] tracking-wider shrink-0 border-t border-[var(--vg-border-subtle)]/60 pt-2.5 [@media(max-height:460px)]:pt-1.5">
        {!isTouchOrCompact && (
          <span className="[@media(pointer:coarse)]:hidden [@media(max-height:520px)]:hidden">
            DESKTOP: WASD · MOUSE · [7] RPG · [E] VEHICLE · [TAB] TACTICAL OVERVIEW
          </span>
        )}
        <span className={isTouchOrCompact ? 'text-[var(--vg-text-secondary)]' : ''}>
          {isTouchOrCompact || viewport.isCoarsePointer
            ? 'TOUCH: LEFT STICK MOVE · RIGHT DRAG AIM · 1-TAP ORDNANCE'
            : 'TACTICAL COMBAT READY · 60-120 HZ LOW-LATENCY INPUT PIPELINE'}
        </span>
      </div>
    </div>
  );
}
