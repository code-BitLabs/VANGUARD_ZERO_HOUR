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
    <div data-testid="campaign-step-review" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-zinc-800 pb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">
            Step 4 of 4 · Pre-Deployment Verification
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold uppercase text-white mt-0.5">
            Review & Deploy Operation
          </h2>
        </div>

        <div className="font-mono text-[11px] uppercase text-zinc-400">
          {validation.canDeploy ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" /> All Systems Cleared for Launch
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-red-400">
              <AlertOctagon className="w-4 h-4" /> Blocking Issue Detected
            </span>
          )}
        </div>
      </div>

      {/* Validation Findings (Errors block deploy; Warnings offer quick jumps) */}
      {(validationErrors.length > 0 || validationWarnings.length > 0) && (
        <div className="space-y-2">
          {validationErrors.map((err) => (
            <div
              key={err.code}
              role="alert"
              className="bg-red-500/10 border border-red-500/40 rounded-xs px-3.5 py-2.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2 text-xs text-red-200">
                <AlertOctagon className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{err.message}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onUiClick();
                  onJumpToStep(err.fixStep);
                }}
                className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-xs bg-red-500/20 border border-red-400/50 font-mono text-[10px] uppercase text-red-100 shrink-0 cursor-pointer"
              >
                Fix (Step {err.fixStep})
              </button>
            </div>
          ))}

          {validationWarnings.map((warn) => (
            <div
              key={warn.code}
              className="bg-amber-500/10 border border-amber-500/35 rounded-xs px-3.5 py-2.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2 text-xs text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{warn.message}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onUiClick();
                  onJumpToStep(warn.fixStep);
                }}
                className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-xs bg-amber-500/15 border border-amber-400/40 font-mono text-[10px] uppercase text-amber-100 shrink-0 cursor-pointer"
              >
                Adjust
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Structured Pre-Deployment Manifest */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* 1. Mission */}
        <div className="bg-[#141920] border border-zinc-800 rounded-sm p-3.5 sm:p-4 space-y-1.5 sm:space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              <MapPin className="w-3.5 h-3.5 text-amber-400" /> Operation
            </div>
            <button
              type="button"
              onClick={() => {
                onUiClick();
                onJumpToStep(1);
              }}
              className="min-h-[36px] px-2 rounded-xs font-mono text-[10px] uppercase text-zinc-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          </div>
          <div className="font-display text-lg font-bold uppercase text-white">
            OP 0{mission.id} · {mission.title}
          </div>
          <div className="font-mono text-[11px] text-zinc-400">
            {mission.mapName} · {mission.locationDetail ?? mission.subtitle}
          </div>
        </div>

        {/* 2. Play Style */}
        <div className="bg-[#141920] border border-zinc-800 rounded-sm p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              {deploymentMode === 'solo' ? (
                <User className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Users className="w-3.5 h-3.5 text-cyan-400" />
              )}
              Play Style
            </div>
            <button
              type="button"
              onClick={() => {
                onUiClick();
                onJumpToStep(2);
              }}
              className="min-h-[36px] px-2 rounded-xs font-mono text-[10px] uppercase text-zinc-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          </div>
          <div
            data-testid="review-deployment-mode"
            className="font-display text-lg font-bold uppercase text-white"
          >
            {deploymentMode === 'solo'
              ? 'Solo Operator · Single-Player'
              : 'Fireteam · Single-Player'}
          </div>
          {deploymentMode === 'solo' ? (
            <div className="font-mono text-[11px] text-zinc-400">
              Adaptive Solo Encounter Director · 1 Emergency Trauma Self-Revive · Zero AI Companions
            </div>
          ) : (
            <div className="space-y-1">
              <div className="font-mono text-[11px] text-cyan-300">
                Starting Formation: {activeFormation?.label ?? 'Wedge'}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-300">
                {fireteam.operators.map((op) => (
                  <span key={op.id}>
                    {op.callsign}{' '}
                    <span className="text-zinc-500">
                      ({SQUAD_ARCHETYPE_FLYWEIGHTS[op.role].shortBadge})
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 3. Commander Loadout */}
        <div className="bg-[#141920] border border-zinc-800 rounded-sm p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              <Crosshair className="w-3.5 h-3.5 text-amber-400" /> Commander Loadout
            </div>
            <button
              type="button"
              onClick={() => {
                onUiClick();
                onJumpToStep(3);
              }}
              className="min-h-[36px] px-2 rounded-xs font-mono text-[10px] uppercase text-zinc-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] tabular-nums">
            <div>
              <dt className="text-zinc-500 text-[9.5px] uppercase">Primary</dt>
              <dd className="text-zinc-100">
                {WEAPON_BY_ID[loadout.primaryWeapon].name}
                {countMods(loadout.primaryWeapon) > 0 && (
                  <span className="text-amber-400"> ({countMods(loadout.primaryWeapon)} mods)</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 text-[9.5px] uppercase">Secondary</dt>
              <dd className="text-zinc-100">
                {WEAPON_BY_ID[loadout.secondaryWeapon].name}
                {countMods(loadout.secondaryWeapon) > 0 && (
                  <span className="text-amber-400"> ({countMods(loadout.secondaryWeapon)} mods)</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 text-[9.5px] uppercase">Heavy</dt>
              <dd className="text-zinc-100">
                {WEAPON_BY_ID[loadout.heavyWeapon].name}
                {countMods(loadout.heavyWeapon) > 0 && (
                  <span className="text-amber-400"> ({countMods(loadout.heavyWeapon)} mods)</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 text-[9.5px] uppercase">Tactical Gear</dt>
              <dd className="text-zinc-100">
                {TACTICAL_EQUIPMENT_CATALOG[loadout.tacticalEquipment]?.shortName}
              </dd>
            </div>
          </dl>
        </div>

        {/* 4. Operations Rules */}
        <div className="bg-[#141920] border border-zinc-800 rounded-sm p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              <Sliders className="w-3.5 h-3.5 text-amber-400" /> Operations Rules
            </div>
            <button
              type="button"
              onClick={() => {
                onUiClick();
                onOpenSecondaryDrawer('rules');
              }}
              className="min-h-[36px] px-2 rounded-xs font-mono text-[10px] uppercase text-zinc-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px]">
            <div>
              <dt className="text-zinc-500 text-[9.5px] uppercase">Difficulty</dt>
              <dd className="text-zinc-100">{DIFFICULTY_LABELS[difficulty] ?? difficulty}</dd>
            </div>
            <div>
              <dt className="text-zinc-500 text-[9.5px] uppercase">Timeline</dt>
              <dd className="text-zinc-100">{REPLAY_LABELS[replayMode] ?? replayMode}</dd>
            </div>
            <div>
              <dt className="text-zinc-500 text-[9.5px] uppercase">Modifiers</dt>
              <dd className="text-zinc-100">
                {save.activeModifiers.length > 0
                  ? `${save.activeModifiers.length} active`
                  : 'Standard'}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 text-[9.5px] uppercase">Roster Policy</dt>
              <dd className="text-zinc-100">
                {save.ironmanSquadEnabled ? 'Ironman Active' : 'Standard Recovery'}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Primary Launch Call-To-Action Card */}
      <div className="bg-[#141920] border border-amber-500/40 rounded-sm p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
            Ready for Insertion
          </div>
          <div className="text-sm text-zinc-200">
            Deploying into <span className="font-semibold text-white">{mission.title}</span> as{' '}
            <span className="font-semibold text-white">
              {deploymentMode === 'solo' ? 'Solo Operator' : 'Fireteam Commander'}
            </span>
            .
          </div>
          {viewport.isPortrait && (
            <div
              data-testid="review-portrait-landscape-note"
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-cyan-300"
            >
              <Smartphone className="w-3.5 h-3.5 rotate-90 shrink-0" />
              <span>Combat deploys in landscape mode — rotate sideways after launch.</span>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={!validation.canDeploy}
          data-testid="deploy-operation-btn"
          onClick={() => {
            onUiClick();
            onDeploy();
          }}
          className="w-full sm:w-auto min-h-[48px] px-6 shrink-0"
        >
          <Play className="w-4 h-4 mr-2 fill-current" />
          Deploy Operation
        </Button>
      </div>
    </div>
  );
}
