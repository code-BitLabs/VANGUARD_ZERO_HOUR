import React, { useMemo } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Edit3,
  MapPin,
  Play,
  Sliders,
  Smartphone,
  User,
  Users,
} from 'lucide-react';
import { TACTICAL_EQUIPMENT_CATALOG } from '@/src/data/attachments';
import { getMissionById } from '@/src/data/missions';
import { SQUAD_ARCHETYPE_FLYWEIGHTS, resolveDeployableFireteam } from '@/src/data/squadRoster';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import {
  FORMATION_TACTICAL_PROFILES,
  validateDeploymentConfig,
} from '@/src/gameplay/campaign/DeploymentConfigValidator';
import { DeploymentMode } from '@/src/schemas/campaign.schema';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { useViewportMode } from '@/src/ui/hooks/useViewportMode';
import { SecondaryDrawerTab } from '@/src/ui/screens/campaign/CampaignSecondaryDrawers';
import { Button } from '@/src/ui/primitives/Button';

interface StepReviewDeployProps {
  missionId: number;
  deploymentMode: DeploymentMode;
  onJumpToStep: (step: 1 | 2 | 3) => void;
  onOpenSecondaryDrawer: (tab: SecondaryDrawerTab) => void;
  onDeploy: () => void;
  onUiClick: () => void;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'Recruit',
  normal: 'Operator',
  hard: 'Veteran',
  extreme: 'Zero Hour',
};

const REPLAY_LABELS: Record<string, string> = {
  canonical: 'Canonical Campaign',
  campaign_replay: 'Campaign Replay (Rebase)',
  clean_replay: 'Clean Replay (Isolated)',
};

export function StepReviewDeploy({
  missionId,
  deploymentMode,
  onJumpToStep,
  onOpenSecondaryDrawer,
  onDeploy,
  onUiClick,
}: StepReviewDeployProps) {
  const save = useProgressionStore((s) => s.save);
  const difficulty = useMissionSelectionStore((s) => s.difficulty);
  const replayMode = useMissionSelectionStore((s) => s.replayMode);
  const hasConfirmedDeploymentMode = useMissionSelectionStore(
    (s) => s.hasConfirmedDeploymentMode
  );
  const viewport = useViewportMode();
  const isCompactLandscape = viewport.isCompactLandscape;

  const mission = getMissionById(missionId);
  const loadout = save.activeMissionLoadout;

  const validation = useMemo(
    () =>
      validateDeploymentConfig({
        missionId,
        deploymentMode,
        difficulty,
        replayMode,
        loadout,
        roster: save.squadRoster,
        hasConfirmedDeploymentMode,
      }),
    [
      missionId,
      deploymentMode,
      difficulty,
      replayMode,
      loadout,
      save.squadRoster,
      hasConfirmedDeploymentMode,
    ]
  );

  const validationErrors = useMemo(
    () => validation.issues.filter((i) => i.severity === 'error'),
    [validation.issues]
  );
  const validationWarnings = useMemo(
    () => validation.issues.filter((i) => i.severity === 'warning'),
    [validation.issues]
  );

  const fireteam = useMemo(
    () => resolveDeployableFireteam(save.squadRoster, loadout.squadIds, 3),
    [save.squadRoster, loadout.squadIds]
  );

  const activeFormation = FORMATION_TACTICAL_PROFILES.find(
    (f) => f.id === (loadout.initialFormation ?? 'WEDGE')
  );

  const countMods = (weaponId: string) =>
    Object.values(save.weaponAttachments?.[weaponId] ?? {}).filter(Boolean).length;

  return (
    <div
      data-testid="campaign-step-review"
      className={isCompactLandscape ? 'space-y-1.5' : 'space-y-4'}
    >
      <div
        className={
          isCompactLandscape
            ? 'flex items-center justify-between gap-1.5 border-b border-zinc-800 pb-0.5'
            : 'flex flex-wrap items-end justify-between gap-2 border-b border-zinc-800 pb-3'
        }
      >
        <div className={isCompactLandscape ? 'flex items-center gap-1.5 min-w-0' : ''}>
          <div className="font-mono text-[8px] sm:text-[10px] uppercase tracking-[0.15em] text-amber-400 shrink-0">
            {isCompactLandscape ? 'Step 4' : 'Step 4 of 4 · Pre-Deployment Verification'}
          </div>
          {isCompactLandscape && <span className="text-zinc-600 text-xs">/</span>}
          <h2
            className={
              isCompactLandscape
                ? 'font-display text-xs sm:text-sm font-bold uppercase text-white truncate'
                : 'font-display text-xl sm:text-2xl font-bold uppercase text-white mt-0.5'
            }
          >
            Review & Deploy Operation
          </h2>
        </div>

        <div className="font-mono text-[8.5px] sm:text-[11px] uppercase text-zinc-400 shrink-0">
          {validation.canDeploy ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="w-3 h-3" /> Cleared
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-red-400">
              <AlertOctagon className="w-3 h-3" /> Issue Detected
            </span>
          )}
        </div>
      </div>

      {/* Validation Findings (Errors block deploy; Warnings offer quick jumps) */}
      {(validationErrors.length > 0 || validationWarnings.length > 0) && (
        <div className="space-y-1.5">
          {validationErrors.map((err) => (
            <div
              key={err.code}
              role="alert"
              className="bg-red-500/10 border border-red-500/40 rounded-xs px-2.5 py-1.5 flex items-center justify-between gap-2"
            >
              <div className="flex items-start gap-1.5 text-xs text-red-200">
                <AlertOctagon className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <span>{err.message}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onUiClick();
                  onJumpToStep(err.fixStep);
                }}
                className="min-h-[28px] sm:min-h-[30px] px-2 py-0.5 rounded-xs bg-red-500/20 border border-red-400/50 font-mono text-[9px] uppercase text-red-100 shrink-0 cursor-pointer"
              >
                Fix (Step {err.fixStep})
              </button>
            </div>
          ))}

          {validationWarnings.map((warn) => (
            <div
              key={warn.code}
              className="bg-amber-500/10 border border-amber-500/35 rounded-xs px-2.5 py-1.5 flex items-center justify-between gap-2"
            >
              <div className="flex items-start gap-1.5 text-xs text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>{warn.message}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onUiClick();
                  onJumpToStep(warn.fixStep);
                }}
                className="min-h-[28px] sm:min-h-[30px] px-2 py-0.5 rounded-xs bg-amber-500/15 border border-amber-400/40 font-mono text-[9px] uppercase text-amber-100 shrink-0 cursor-pointer"
              >
                Adjust
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Structured Pre-Deployment Manifest */}
      <div
        className={
          isCompactLandscape
            ? 'grid grid-cols-4 gap-1.5'
            : 'grid grid-cols-1 sm:grid-cols-2 gap-3'
        }
      >
        {/* 1. Mission */}
        <div
          className={
            isCompactLandscape
              ? 'bg-[#141920] border border-zinc-800 rounded-sm p-2 space-y-1'
              : 'bg-[#141920] border border-zinc-800 rounded-sm p-3.5 sm:p-4 space-y-1.5 sm:space-y-2'
          }
        >
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-zinc-400">
              <MapPin className="w-3 h-3 text-amber-400 shrink-0" /> Operation
            </div>
            <button
              type="button"
              onClick={() => {
                onUiClick();
                onJumpToStep(1);
              }}
              className="min-h-[26px] px-1 rounded-xs font-mono text-[9px] sm:text-[10px] uppercase text-zinc-400 hover:text-white inline-flex items-center gap-0.5 cursor-pointer"
            >
              <Edit3 className="w-2.5 h-2.5" /> Edit
            </button>
          </div>
          <div
            className={
              isCompactLandscape
                ? 'font-display text-xs font-bold uppercase text-white truncate'
                : 'font-display text-lg font-bold uppercase text-white'
            }
          >
            OP 0{mission.id} · {mission.title}
          </div>
          <div className="font-mono text-[9px] sm:text-[11px] text-zinc-400 truncate">
            {mission.mapName} · {mission.locationDetail ?? mission.subtitle}
          </div>
        </div>

        {/* 2. Play Style */}
        <div
          className={
            isCompactLandscape
              ? 'bg-[#141920] border border-zinc-800 rounded-sm p-2 space-y-1'
              : 'bg-[#141920] border border-zinc-800 rounded-sm p-4 space-y-2'
          }
        >
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-zinc-400">
              {deploymentMode === 'solo' ? (
                <User className="w-3 h-3 text-amber-400 shrink-0" />
              ) : (
                <Users className="w-3 h-3 text-cyan-400 shrink-0" />
              )}
              Play Style
            </div>
            <button
              type="button"
              onClick={() => {
                onUiClick();
                onJumpToStep(2);
              }}
              className="min-h-[26px] px-1 rounded-xs font-mono text-[9px] sm:text-[10px] uppercase text-zinc-400 hover:text-white inline-flex items-center gap-0.5 cursor-pointer"
            >
              <Edit3 className="w-2.5 h-2.5" /> Edit
            </button>
          </div>
          <div
            data-testid="review-deployment-mode"
            className={
              isCompactLandscape
                ? 'font-display text-xs font-bold uppercase text-white truncate'
                : 'font-display text-lg font-bold uppercase text-white'
            }
          >
            {deploymentMode === 'solo'
              ? 'Solo Operator · 1P'
              : 'Fireteam · 1P'}
          </div>
          {deploymentMode === 'solo' ? (
            <div className="font-mono text-[9px] sm:text-[11px] text-zinc-400 truncate">
              Solo Director · 1 Revive
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="font-mono text-[9px] sm:text-[11px] text-cyan-300 truncate">
                Form: {activeFormation?.label ?? 'Wedge'}
              </div>
              <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 font-mono text-[8.5px] sm:text-[10px] text-zinc-300 truncate">
                {fireteam.operators.slice(0, 3).map((op) => {
                  const shortName = op.callsign.includes('"')
                    ? op.callsign.replace(/.*"([^"]+)".*/, '$1')
                    : op.callsign;
                  return (
                    <span key={op.id} className="truncate">
                      {isCompactLandscape ? shortName : op.callsign}{' '}
                      <span className="text-zinc-500">
                        ({SQUAD_ARCHETYPE_FLYWEIGHTS[op.role].shortBadge})
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 3. Commander Loadout */}
        <div
          className={
            isCompactLandscape
              ? 'bg-[#141920] border border-zinc-800 rounded-sm p-2 space-y-1'
              : 'bg-[#141920] border border-zinc-800 rounded-sm p-4 space-y-2'
          }
        >
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-zinc-400">
              <Crosshair className="w-3 h-3 text-amber-400 shrink-0" /> Loadout
            </div>
            <button
              type="button"
              onClick={() => {
                onUiClick();
                onJumpToStep(3);
              }}
              className="min-h-[26px] px-1 rounded-xs font-mono text-[9px] sm:text-[10px] uppercase text-zinc-400 hover:text-white inline-flex items-center gap-0.5 cursor-pointer"
            >
              <Edit3 className="w-2.5 h-2.5" /> Edit
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-x-1.5 gap-y-0.5 font-mono text-[8.5px] sm:text-[10.5px] tabular-nums">
            <div className="truncate">
              <dt className="text-zinc-500 text-[7.5px] sm:text-[8.5px] uppercase">PRI</dt>
              <dd className="text-zinc-100 truncate">
                {WEAPON_BY_ID[loadout.primaryWeapon]?.name ?? 'M4A1'}
              </dd>
            </div>
            <div className="truncate">
              <dt className="text-zinc-500 text-[7.5px] sm:text-[8.5px] uppercase">SEC</dt>
              <dd className="text-zinc-100 truncate">
                {WEAPON_BY_ID[loadout.secondaryWeapon]?.name ?? 'G18'}
              </dd>
            </div>
            <div className="truncate">
              <dt className="text-zinc-500 text-[7.5px] sm:text-[8.5px] uppercase">HVY</dt>
              <dd className="text-zinc-100 truncate">
                {WEAPON_BY_ID[loadout.heavyWeapon]?.name ?? 'M249'}
              </dd>
            </div>
            <div className="truncate">
              <dt className="text-zinc-500 text-[7.5px] sm:text-[8.5px] uppercase">TAC</dt>
              <dd className="text-zinc-100 truncate">
                {TACTICAL_EQUIPMENT_CATALOG[loadout.tacticalEquipment]?.shortName ?? 'Smoke'}
              </dd>
            </div>
          </dl>
        </div>

        {/* 4. Operations Rules */}
        <div
          className={
            isCompactLandscape
              ? 'bg-[#141920] border border-zinc-800 rounded-sm p-2 space-y-1'
              : 'bg-[#141920] border border-zinc-800 rounded-sm p-4 space-y-2'
          }
        >
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-zinc-400">
              <Sliders className="w-3 h-3 text-amber-400 shrink-0" /> Rules
            </div>
            <button
              type="button"
              onClick={() => {
                onUiClick();
                onOpenSecondaryDrawer('rules');
              }}
              className="min-h-[26px] px-1 rounded-xs font-mono text-[9px] sm:text-[10px] uppercase text-zinc-400 hover:text-white inline-flex items-center gap-0.5 cursor-pointer"
            >
              <Edit3 className="w-2.5 h-2.5" /> Edit
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-x-1.5 gap-y-0.5 font-mono text-[8.5px] sm:text-[10.5px]">
            <div className="truncate">
              <dt className="text-zinc-500 text-[7.5px] sm:text-[8.5px] uppercase">DIFF</dt>
              <dd className="text-zinc-100 truncate">{DIFFICULTY_LABELS[difficulty] ?? difficulty}</dd>
            </div>
            <div className="truncate">
              <dt className="text-zinc-500 text-[7.5px] sm:text-[8.5px] uppercase">TIME</dt>
              <dd className="text-zinc-100 truncate">{REPLAY_LABELS[replayMode]?.split(' ')[0] ?? replayMode}</dd>
            </div>
            <div className="truncate">
              <dt className="text-zinc-500 text-[7.5px] sm:text-[8.5px] uppercase">MODS</dt>
              <dd className="text-zinc-100 truncate">
                {save.activeModifiers.length > 0 ? `${save.activeModifiers.length} active` : 'Standard'}
              </dd>
            </div>
            <div className="truncate">
              <dt className="text-zinc-500 text-[7.5px] sm:text-[8.5px] uppercase">ROSTER</dt>
              <dd className="text-zinc-100 truncate">
                {save.ironmanSquadEnabled ? 'Ironman' : 'Standard'}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Primary Launch Call-To-Action Card */}
      <div
        className={
          isCompactLandscape
            ? 'bg-[#141920] border border-amber-500/30 rounded-sm px-2 py-1 flex items-center justify-between gap-2'
            : 'bg-[#141920] border border-amber-500/40 rounded-sm p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3'
        }
      >
        <div className="space-y-0 min-w-0">
          <div className="font-mono text-[8px] sm:text-[9px] uppercase tracking-wider text-amber-400">
            Ready for Insertion
          </div>
          <div className="text-[10.5px] sm:text-sm text-zinc-200 truncate">
            Deploy into <span className="font-semibold text-white">{mission.title}</span> as{' '}
            <span className="font-semibold text-white">
              {deploymentMode === 'solo' ? 'Solo' : 'Fireteam'}
            </span>
          </div>
          {viewport.isPortrait && (
            <div
              data-testid="review-portrait-landscape-note"
              className="inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase text-cyan-300"
            >
              <Smartphone className="w-3 h-3 rotate-90 shrink-0" />
              <span>Combat deploys in landscape mode — rotate sideways after launch.</span>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="primary"
          size={isCompactLandscape ? 'sm' : 'lg'}
          disabled={!validation.canDeploy}
          data-testid="deploy-operation-btn"
          onClick={() => {
            onUiClick();
            onDeploy();
          }}
          className={
            isCompactLandscape
              ? 'min-h-[28px] py-1 px-3 text-[10px] shrink-0'
              : 'w-full sm:w-auto min-h-[48px] px-6 shrink-0'
          }
        >
          <Play className="w-3 h-3 mr-1 fill-current" />
          Deploy
        </Button>
      </div>
    </div>
  );
}
