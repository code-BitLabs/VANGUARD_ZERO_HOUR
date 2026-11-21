import React, { useState } from 'react';
import {
  CheckCircle2,
  CloudSun,
  FileText,
  GitBranch,
  MapPin,
  ShieldAlert,
} from 'lucide-react';
import { MISSION_CATALOG, getMissionById } from '@/src/data/missions';
import { resolveMissionConsequences } from '@/src/gameplay/campaign/CampaignEventLedger';
import { resolveMissionPreviewArtwork } from '@/src/gameplay/campaign/DeploymentConfigValidator';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { Button } from '@/src/ui/primitives/Button';

interface StepMissionSelectProps {
  selectedMissionId: number;
  onSelectMission: (missionId: number) => void;
  onPrepareDeployment: () => void;
  onOpenFullBriefing: () => void;
  onUiClick: () => void;
}

export function StepMissionSelect({
  selectedMissionId,
  onSelectMission,
  onPrepareDeployment,
  onOpenFullBriefing,
  onUiClick,
}: StepMissionSelectProps) {
  const save = useProgressionStore((s) => s.save);
  const replayMode = useMissionSelectionStore((s) => s.replayMode);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

  const mission = getMissionById(selectedMissionId);
  const artwork = resolveMissionPreviewArtwork(mission.id);
  const record = save.missionRecords[String(mission.id)];
  const consequences = resolveMissionConsequences(mission.id, save.campaignLedger, replayMode);

  const primaryObjectives = mission.objectives.filter((o) => !o.isOptional);
  const airThreatCount = mission.airUnits.reduce((sum, u) => sum + u.count, 0);
  const imgFailed = Boolean(failedImages[mission.id]);

  return (
    <div
      data-testid="campaign-step-mission"
      className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start"
    >
      {/* Scannable 5-Mission List */}
      <section aria-label="Campaign Operations List" className="lg:col-span-5 space-y-2">
        <div className="flex items-center justify-between px-0.5 pb-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
            Select Operation (5 Missions)
          </span>
          <span className="font-mono text-[11px] text-amber-400 tabular-nums">
            {Object.values(save.missionRecords).filter((r) => r.completed).length}/5 Cleared
          </span>
        </div>

        <div className="space-y-2">
          {MISSION_CATALOG.map((m) => {
            const mRec = save.missionRecords[String(m.id)];
            const mArt = resolveMissionPreviewArtwork(m.id);
            const isSelected = m.id === mission.id;
            return (
              <button
                key={m.id}
                type="button"
                data-testid={`mission-list-item-${m.id}`}
                aria-pressed={isSelected}
                onClick={() => {
                  onUiClick();
                  onSelectMission(m.id);
                }}
                className={`w-full min-h-[68px] p-3.5 rounded-sm border text-left transition-colors motion-reduce:transition-none cursor-pointer flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-[#141920] border-amber-400 shadow-[inset_3px_0_0_0_#F59E0B]'
                    : 'bg-[#11161D]/90 border-zinc-800 hover:border-zinc-600'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                    <span className={isSelected ? 'text-amber-400 font-bold' : 'text-zinc-400'}>
                      OP 0{m.id}
                    </span>
                    <span className="text-zinc-700">|</span>
                    <span className="truncate">{mArt.theaterLabel}</span>
                    <span className="text-zinc-700 hidden sm:inline">|</span>
                    <span className="hidden sm:inline text-zinc-500">{mArt.lightingLabel}</span>
                  </div>
                  <div className="font-display text-base sm:text-lg font-bold uppercase text-white truncate mt-0.5">
                    {m.title}
                  </div>
                </div>

                <div className="shrink-0 text-right font-mono text-[11px] tabular-nums">
                  {mRec?.completed ? (
                    <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>RANK {mRec.bestGrade ?? 'C'}</span>
                    </div>
                  ) : (
                    <span className="text-zinc-500 uppercase text-[10px]">Ready</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Selected Mission Overview Panel */}
      <section
        aria-label="Selected Operation Overview"
        data-testid="mission-overview-panel"
        className="lg:col-span-7 bg-[#141920] border border-zinc-800 rounded-sm overflow-hidden"
      >
        {/* Theater Artwork Header */}
        <div
          className="relative h-44 sm:h-52 w-full overflow-hidden border-b border-zinc-800"
          style={{ background: artwork.fallbackGradient }}
        >
          {!imgFailed && (
            <img
              src={artwork.imageSrc}
              alt={artwork.alt}
              referrerPolicy="no-referrer"
              onError={() => setFailedImages((prev) => ({ ...prev, [mission.id]: true }))}
              className="w-full h-full object-cover object-center opacity-85"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#141920] via-[#141920]/45 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400">
                {mission.codeName} · Single-Player Operation
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold uppercase text-white leading-tight mt-0.5">
                {mission.title}
              </h2>
            </div>
            <div className="font-mono text-[10.5px] text-zinc-200 bg-[#0B0E11]/85 border border-zinc-700/80 px-2.5 py-1 rounded-xs flex items-center gap-2">
              <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
              <span>{artwork.theaterLabel}</span>
              <span className="text-zinc-600">|</span>
              <CloudSun className="w-3 h-3 text-amber-400 shrink-0" />
              <span>{artwork.weatherLabel}</span>
            </div>
          </div>
        </div>

        {/* Structured Mission Summary Body */}
        <div className="p-4 sm:p-5 space-y-4">
          <p className="text-sm text-zinc-200 leading-relaxed">{mission.subtitle}</p>

          {/* Compact Staged Objectives & Threats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="border-t border-zinc-800 pt-2.5 space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-cyan-400 font-bold">
                Staged Objectives ({primaryObjectives.length})
              </div>
              <ul className="space-y-1 text-xs text-zinc-300">
                {primaryObjectives.slice(0, 3).map((obj, idx) => (
                  <li key={obj.id} className="flex items-start gap-2">
                    <span className="font-mono text-[10px] text-amber-400 shrink-0 mt-0.5">
                      0{idx + 1}
                    </span>
                    <span className="leading-snug">{obj.title}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-zinc-800 pt-2.5 space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Theater Threats &amp; Record</span>
              </div>
              <div className="text-xs text-zinc-300 leading-snug">
                {airThreatCount > 0
                  ? `${airThreatCount} hostile air asset${airThreatCount > 1 ? 's' : ''}, entrenched infantry, and fortified targets.`
                  : 'Armored ground patrols, snipers, and fortified tactical objectives.'}
              </div>
              <div className="font-mono text-[11px] text-zinc-400 tabular-nums pt-1">
                {record?.completed ? (
                  <>
                    Best: <span className="text-amber-300 font-bold">Rank {record.bestGrade}</span> ·{' '}
                    {record.bestScore} pts
                  </>
                ) : (
                  'Not yet cleared in campaign'
                )}
              </div>
            </div>
          </div>

          {/* Active Campaign Consequences Preview */}
          {consequences.activeSummaries.length > 0 && (
            <div className="border-t border-zinc-800 pt-3 flex items-start gap-2.5 text-xs">
              <GitBranch className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div className="text-zinc-300">
                <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-400 font-bold mr-2">
                  Campaign Impact:
                </span>
                {consequences.activeSummaries
                  .slice(0, 2)
                  .map((c) => c.title)
                  .join(' · ')}
              </div>
            </div>
          )}

          {/* Secondary Briefing Link (Primary CTA lives unambiguously in sticky footer) */}
          <div className="pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-zinc-400">
              Step 2–3: Select Solo / Fireteam, Loadout &amp; Difficulty
            </span>
            <Button
              variant="ghost"
              size="sm"
              data-testid="step1-full-briefing-btn"
              onClick={() => {
                onUiClick();
                onOpenFullBriefing();
              }}
              className="min-h-[38px] text-cyan-300 hover:text-cyan-200"
            >
              <FileText className="w-3.5 h-3.5 text-cyan-400" /> Full Briefing Dossier
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
