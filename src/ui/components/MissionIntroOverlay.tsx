import React, { useEffect, useState } from 'react';
import { getMissionById } from '@/src/data/missions';
import { REPLAY_MODIFIER_BY_ID, ReplayModifierId } from '@/src/data/challenges';

interface MissionIntroOverlayProps {
  missionId: number;
  difficulty: string;
  activeModifiers: readonly ReplayModifierId[];
  deploymentKey: number;
}

/**
 * Non-blocking, skippable Tactical Deployment Intro overlay (TRN-33).
 * Never disables player movement or camera control: container is pointer-events-none
 * with an optional compact Skip button and automatic fade-out after 3.8 seconds.
 */
export const MissionIntroOverlay: React.FC<MissionIntroOverlayProps> = ({
  missionId,
  difficulty,
  activeModifiers,
  deploymentKey,
}) => {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  const mission = getMissionById(missionId);
  const stage1 = mission.objectives[0];

  useEffect(() => {
    setVisible(true);
    setFading(false);

    const fadeTimer = window.setTimeout(() => setFading(true), 3200);
    const hideTimer = window.setTimeout(() => setVisible(false), 3850);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Escape') {
        setVisible(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [missionId, deploymentKey]);

  if (!visible) return null;

  return (
    <div
      data-testid="mission-intro-overlay"
      className={`fixed inset-x-0 top-16 sm:top-20 z-25 flex justify-center px-4 pointer-events-none transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="w-full max-w-xl bg-[#0B0E11]/90 border-l-2 border-amber-500 border-y border-r border-zinc-800/90 px-4 py-3 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400">
              {mission.codeName} // {mission.mapName} · {difficulty.toUpperCase()}
            </div>
            <h2 className="font-display text-lg sm:text-xl font-bold uppercase tracking-wide text-white mt-0.5 truncate">
              {mission.title}
            </h2>
          </div>

          <button
            type="button"
            data-testid="skip-mission-intro"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setVisible(false);
            }}
            className="pointer-events-auto shrink-0 whitespace-nowrap border border-zinc-700 bg-zinc-900/90 hover:border-amber-500/70 hover:text-amber-300 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-300 transition-colors cursor-pointer"
          >
            Skip
          </button>
        </div>

        <div className="mt-2 pt-2 border-t border-zinc-800/90 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 font-mono text-[11px]">
          <div className="text-zinc-200 truncate">
            <span className="text-cyan-400 mr-1.5">PRIMARY:</span>
            {stage1 ? stage1.title : mission.briefing}
          </div>
          {activeModifiers.length > 0 && (
            <div className="text-amber-300 text-[10px] uppercase tracking-wider shrink-0">
              MODS: {activeModifiers.map((m) => REPLAY_MODIFIER_BY_ID[m]?.shortLabel ?? m).join(' · ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
