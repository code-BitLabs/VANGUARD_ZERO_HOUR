import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Crosshair,
  Gamepad2,
  HeartPulse,
  Package,
  Shield,
  Sliders,
  Trophy,
  User,
  Users,
  Wrench,
} from 'lucide-react';
import {
  ATTACHMENT_BY_ID,
  DEFAULT_ROLE_LOADOUT_PRESETS,
  MISSION_LOADOUT_RECOMMENDATIONS,
  TACTICAL_EQUIPMENT_CATALOG,
} from '@/src/data/attachments';
import { getMissionById } from '@/src/data/missions';
import {
  SQUAD_ARCHETYPE_FLYWEIGHTS,
  resolveDeployableFireteam,
} from '@/src/data/squadRoster';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import { computeOperatorRecoverySummary } from '@/src/gameplay/campaign/CampaignEventLedger';
import {
  FORMATION_TACTICAL_PROFILES,
  SQUAD_COMPOSITION_PRESETS,
  getSoloMissionPreparationSummary,
  resolveSquadPresetIds,
} from '@/src/gameplay/campaign/DeploymentConfigValidator';
import {
  DeploymentMode,
  InitialFormation,
  TacticalEquipmentId,
} from '@/src/schemas/campaign.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import {
  EXPEDITE_RECOVERY_REQ_COST,
  useProgressionStore,
} from '@/src/stores/progressionStore';
import { SecondaryDrawerTab } from '@/src/ui/screens/campaign/CampaignSecondaryDrawers';
import { WeaponSilhouette } from '@/src/ui/components/WeaponSilhouette';
import { Button } from '@/src/ui/primitives/Button';

interface StepConfigureOperationProps {
  missionId: number;
  deploymentMode: DeploymentMode;
  onOpenWorkbench: (weaponId: WeaponId, slotLabel: string) => void;
  onOpenSecondaryDrawer: (tab: SecondaryDrawerTab) => void;
  onUiClick: () => void;
}

const PRIMARY_CANDIDATES: readonly WeaponId[] = [
  'assault_rifle',
  'smg',
  'sniper_rifle',
  'shotgun',
  'lmg',
];
const SECONDARY_CANDIDATES: readonly WeaponId[] = ['pistol', 'smg', 'shotgun'];
const HEAVY_CANDIDATES: readonly WeaponId[] = [
  'rocket_launcher',
  'guided_missile',
  'grenade_launcher',
];
const TACTICAL_EQUIP_IDS: readonly TacticalEquipmentId[] = [
  'frag_pack',
  'c4_breach_kit',
  'field_trauma_kit',
  'smoke_conceal_kit',
];

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: 'Recruit',
  normal: 'Operator',
  hard: 'Veteran',
  extreme: 'Zero Hour',
};

export function StepConfigureOperation({
  missionId,
  deploymentMode,
  onOpenWorkbench,
  onOpenSecondaryDrawer,
  onUiClick,
}: StepConfigureOperationProps) {
  const save = useProgressionStore((s) => s.save);
  const updateMissionLoadout = useProgressionStore((s) => s.updateMissionLoadout);
  const applyLoadoutPreset = useProgressionStore((s) => s.applyLoadoutPreset);
  const expediteOperatorRecovery = useProgressionStore((s) => s.expediteOperatorRecovery);
  const difficulty = useMissionSelectionStore((s) => s.difficulty);
  const replayMode = useMissionSelectionStore((s) => s.replayMode);

  const [presetFeedback, setPresetFeedback] = useState<string | null>(null);

  const mission = getMissionById(missionId);
  const loadout = save.activeMissionLoadout;
  const missionRec = MISSION_LOADOUT_RECOMMENDATIONS[missionId];
  const soloPrep = useMemo(() => getSoloMissionPreparationSummary(missionId), [missionId]);

  const activeModifiersCount = save.activeModifiers?.length ?? 0;

  // Fireteam derived resolution (only used when deploymentMode === 'fireteam')
  const selectedSquadSet = useMemo(() => new Set(loadout.squadIds), [loadout.squadIds]);
  const resolvedFireteam = useMemo(
    () => resolveDeployableFireteam(save.squadRoster, loadout.squadIds, 3),
    [save.squadRoster, loadout.squadIds]
  );

  const handleToggleOperator = (operatorId: string) => {
    const op = save.squadRoster.find((r) => r.id === operatorId);
    if (!op || op.status !== 'active') return;
    onUiClick();
    setPresetFeedback(null);

    if (selectedSquadSet.has(operatorId)) {
      // Allow deselecting down to 0 so player can pick a replacement; validator catches < 3 or backfill explains reserve
      const next = loadout.squadIds.filter((id) => id !== operatorId);
      updateMissionLoadout({ squadIds: next });
      return;
    }

    if (loadout.squadIds.length >= 3) {
      // Replace the oldest selected operator when already at 3 for smooth single-tap swap
      const next = [...loadout.squadIds.slice(1), operatorId];
      updateMissionLoadout({ squadIds: next });
    } else {
      updateMissionLoadout({ squadIds: [...loadout.squadIds, operatorId] });
    }
  };

  const handleApplySquadPreset = (
    presetId: (typeof SQUAD_COMPOSITION_PRESETS)[number]['id']
  ) => {
    onUiClick();
    const presetMeta = SQUAD_COMPOSITION_PRESETS.find((p) => p.id === presetId);
    const res = resolveSquadPresetIds(presetId, save.squadRoster);
    updateMissionLoadout({
      squadIds: res.squadIds,
      initialFormation: res.formation,
    });
    const presetName = presetMeta?.name ?? presetId;
    if (res.missingRoles.length > 0) {
      setPresetFeedback(
        `Applied ${presetName}. Unavailable role${res.missingRoles.length > 1 ? 's' : ''} (${res.missingRoles.join(', ')}) will use healthy substitutes or Tactical Reserve.`
      );
    } else {
      setPresetFeedback(`Applied ${presetName} (${res.formation} formation).`);
    }
  };

  const handleApplyRoleLoadoutPreset = (presetId: string) => {
    onUiClick();
    const preset = DEFAULT_ROLE_LOADOUT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    if (deploymentMode === 'solo') {
      // In Solo mode, update weapons & tactical equipment without overwriting the saved Fireteam roster
      updateMissionLoadout({
        primaryWeapon: preset.config.primaryWeapon,
        secondaryWeapon: preset.config.secondaryWeapon,
        heavyWeapon: preset.config.heavyWeapon,
        tacticalEquipment: preset.config.tacticalEquipment,
      });
    } else {
      applyLoadoutPreset(presetId);
    }
    setPresetFeedback(`Equipped ${preset.name} kit.`);
  };

  const getWeaponAttachmentSummary = (weaponId: WeaponId) => {
    const equipped = save.weaponAttachments?.[weaponId] ?? {};
    const names = Object.values(equipped)
      .filter((id): id is string => Boolean(id))
      .map((id) => ATTACHMENT_BY_ID[id]?.name ?? id);
    return names;
  };

  const renderWeaponSlotCard = (
    slotKey: 'primary' | 'secondary' | 'heavy',
    slotLabel: string,
    selectedWeaponId: WeaponId,
    candidates: readonly WeaponId[],
    onSelectWeapon: (weaponId: WeaponId) => void
  ) => {
    const weapon = WEAPON_BY_ID[selectedWeaponId];
    const attachmentNames = getWeaponAttachmentSummary(selectedWeaponId);

    return (
      <div
        key={slotKey}
        data-testid={`loadout-slot-${slotKey}`}
        className="bg-[#141920] border border-zinc-800 rounded-sm p-3.5 flex flex-col justify-between gap-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              {slotLabel}
            </div>
            <div className="font-display text-base font-bold uppercase text-white mt-0.5">
              {weapon.name}
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid={`edit-build-${slotKey}`}
            onClick={() => {
              onUiClick();
              onOpenWorkbench(selectedWeaponId, slotLabel);
            }}
            className="min-h-[44px] sm:min-h-[36px] shrink-0"
          >
            <Wrench className="w-3.5 h-3.5 mr-1.5" />
            Edit Build
          </Button>
        </div>

        <div className="bg-[#0B0E11] border border-zinc-800/80 rounded-xs px-3 py-2 flex items-center justify-between gap-3">
          <div className="w-24 h-10 flex items-center justify-center shrink-0">
            <WeaponSilhouette weaponId={selectedWeaponId} className="w-full h-full" />
          </div>
          <div className="flex-1 min-w-0 font-mono text-[10.5px] text-zinc-400 tabular-nums space-y-0.5 text-right">
            <div>
              DMG <span className="text-zinc-200">{weapon.damage}</span> · MAG{' '}
              <span className="text-zinc-200">{weapon.magazineSize}</span>
            </div>
            <div className="truncate text-zinc-400">
              {attachmentNames.length > 0
                ? `${attachmentNames.length} mod${attachmentNames.length > 1 ? 's' : ''}: ${attachmentNames.slice(0, 2).join(', ')}${attachmentNames.length > 2 ? '…' : ''}`
                : 'Factory iron build'}
            </div>
          </div>
        </div>

        {/* Weapon Choice Selector */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Select ${slotLabel} weapon`}>
          {candidates.map((candId) => {
            const cand = WEAPON_BY_ID[candId];
            const isSelected = candId === selectedWeaponId;
            return (
              <button
                key={candId}
                type="button"
                aria-pressed={isSelected}
                data-testid={`select-${slotKey}-${candId}`}
                onClick={() => {
                  onUiClick();
                  onSelectWeapon(candId);
                }}
                className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-1.5 rounded-xs border font-mono text-[10.5px] uppercase transition-colors motion-reduce:transition-none cursor-pointer ${
                  isSelected
                    ? 'bg-amber-500/15 border-amber-400 text-amber-200 font-bold'
                    : 'bg-[#0B0E11] border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {cand.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div data-testid="campaign-step-configure" className="space-y-5">
      {/* Step Header + Quick Secondary Drawers Strip */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 border-b border-zinc-800 pb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">
            Step 3 of 4 · {mission.codeName} ·{' '}
            {deploymentMode === 'solo' ? 'Solo Operator' : 'Fireteam Squad'}
          </div>
          <h2 className="font-display text-xl sm:text-2xl font-bold uppercase text-white mt-0.5">
            {deploymentMode === 'solo'
              ? 'Configure Solo Loadout & Preparation'
              : 'Configure Fireteam & Commander Loadout'}
          </h2>
        </div>

        {/* Progressive-Disclosure Secondary Reference Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="open-drawer-rules"
            onClick={() => {
              onUiClick();
              onOpenSecondaryDrawer('rules');
            }}
            className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 rounded-xs bg-[#141920] border border-zinc-800 hover:border-zinc-600 font-mono text-[10.5px] uppercase text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            Rules: {DIFFICULTY_LABEL[difficulty] ?? difficulty}
            {replayMode !== 'canonical' ? ` · ${replayMode === 'clean_replay' ? 'Clean' : 'Replay'}` : ''}
            {activeModifiersCount > 0 ? ` · +${activeModifiersCount}` : ''}
          </button>

          <button
            type="button"
            data-testid="open-drawer-intel"
            onClick={() => {
              onUiClick();
              onOpenSecondaryDrawer('intel');
            }}
            className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 rounded-xs bg-[#141920] border border-zinc-800 hover:border-zinc-600 font-mono text-[10.5px] uppercase text-zinc-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
            Intel
          </button>

          <button
            type="button"
            data-testid="open-drawer-performance"
            onClick={() => {
              onUiClick();
              onOpenSecondaryDrawer('performance');
            }}
            className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 rounded-xs bg-[#141920] border border-zinc-800 hover:border-zinc-600 font-mono text-[10.5px] uppercase text-zinc-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            Performance
          </button>

          <button
            type="button"
            data-testid="open-drawer-controls"
            onClick={() => {
              onUiClick();
              onOpenSecondaryDrawer('controls');
            }}
            className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 rounded-xs bg-[#141920] border border-zinc-800 hover:border-zinc-600 font-mono text-[10.5px] uppercase text-zinc-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Gamepad2 className="w-3.5 h-3.5 text-zinc-400" />
            Controls
          </button>
        </div>
      </div>

      {/* SECTION A (MODE-ADAPTIVE): FIRETEAM ROSTER & TACTICS OR SOLO PREPARATION */}
      {deploymentMode === 'fireteam' ? (
        <section
          data-testid="fireteam-roster-section"
          aria-label="Fireteam Roster and Tactics"
          className="bg-[#11161D] border border-zinc-800 rounded-sm p-4 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <h3 className="font-display text-base font-bold uppercase text-white leading-tight">
                  Fireteam Roster & Tactics
                </h3>
                <p className="font-mono text-[10.5px] text-zinc-400">
                  Select up to 3 active specialists ({loadout.squadIds.length}/3 assigned) and starting formation.
                </p>
              </div>
            </div>

            {/* Editable Squad Composition Presets */}
            <div className="flex flex-wrap gap-1.5">
              {SQUAD_COMPOSITION_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`squad-preset-${preset.id}`}
                  onClick={() => handleApplySquadPreset(preset.id)}
                  className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-xs bg-[#0B0E11] border border-zinc-800 hover:border-cyan-400/70 font-mono text-[10px] uppercase text-zinc-300 hover:text-white cursor-pointer"
                  title={preset.tagline}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {presetFeedback && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xs px-3 py-2 font-mono text-[11px] text-cyan-200">
              {presetFeedback}
            </div>
          )}

          {/* 5 Specialist Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {save.squadRoster.map((op) => {
              const flyweight = SQUAD_ARCHETYPE_FLYWEIGHTS[op.role];
              const isSelected = selectedSquadSet.has(op.id);
              const isActive = op.status === 'active';
              const isRecovering = op.status === 'recovering';
              const isKia = op.status === 'kia';
              const recovery = isRecovering ? computeOperatorRecoverySummary(op) : null;

              return (
                <div
                  key={op.id}
                  data-testid={`roster-operator-${op.id}`}
                  className={`rounded-sm border p-3 flex flex-col justify-between gap-2.5 transition-colors motion-reduce:transition-none ${
                    isSelected && isActive
                      ? 'bg-[#141E28] border-cyan-400'
                      : isActive
                        ? 'bg-[#141920] border-zinc-800 hover:border-zinc-600'
                        : 'bg-[#0E1217] border-zinc-800/70 opacity-85'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-300">
                        {flyweight.shortBadge}
                      </span>
                      <span
                        className={`font-mono text-[9.5px] uppercase px-1.5 py-0.5 rounded-xs ${
                          isActive
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : isRecovering
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {isActive ? 'Active' : isRecovering ? 'HQ Recovery' : 'KIA'}
                      </span>
                    </div>

                    <div className="font-display text-sm font-bold uppercase text-white leading-tight">
                      {op.callsign}
                    </div>
                    <div className="font-mono text-[10px] text-zinc-400">
                      {flyweight.roleLabel}
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-snug line-clamp-2">
                      {flyweight.summary}
                    </p>
                  </div>

                  {/* Recovery Progress Bar OR Toggle Button */}
                  {isRecovering && recovery ? (
                    <div className="space-y-1.5 pt-2 border-t border-zinc-800">
                      <div className="flex items-center justify-between font-mono text-[10px] text-amber-300 tabular-nums">
                        <span>{recovery.progressPct}% Ready</span>
                        <span>{recovery.remainingOps} op / {Math.ceil(recovery.remainingSec / 60)}m</span>
                      </div>
                      <div className="h-1.5 w-full bg-zinc-900 rounded-xs overflow-hidden">
                        <div
                          className="h-full bg-amber-400"
                          style={{ width: `${Math.max(6, recovery.progressPct)}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        data-testid={`expedite-operator-${op.id}`}
                        disabled={save.requisitionPoints < EXPEDITE_RECOVERY_REQ_COST}
                        onClick={() => {
                          onUiClick();
                          expediteOperatorRecovery(op.id);
                        }}
                        className="w-full min-h-[44px] sm:min-h-[32px] px-2 py-1 rounded-xs bg-amber-500/15 border border-amber-500/40 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-[10px] uppercase text-amber-200 cursor-pointer"
                      >
                        Expedite ({EXPEDITE_RECOVERY_REQ_COST} REQ)
                      </button>
                    </div>
                  ) : isKia ? (
                    <div className="pt-2 border-t border-zinc-800 font-mono text-[10px] text-red-300">
                      Lost in Ironman · Reserve replaces slot
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`toggle-operator-${op.id}`}
                      aria-pressed={isSelected}
                      onClick={() => handleToggleOperator(op.id)}
                      className={`w-full min-h-[44px] sm:min-h-[34px] px-2.5 py-1.5 rounded-xs border font-mono text-[10.5px] uppercase font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors motion-reduce:transition-none ${
                        isSelected
                          ? 'bg-cyan-400 text-zinc-950 border-cyan-300'
                          : 'bg-[#0B0E11] text-zinc-300 border-zinc-700 hover:border-zinc-500'
                      }`}
                    >
                      {isSelected ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Assigned
                        </>
                      ) : (
                        'Assign'
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Transparent Tactical Reserve Substitution Notice */}
          {resolvedFireteam.reserveCount > 0 && (
            <div
              data-testid="fireteam-reserve-notice"
              className="bg-amber-500/10 border border-amber-500/35 rounded-xs px-3 py-2 flex items-start gap-2 text-xs text-amber-200"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-mono font-bold uppercase text-[10.5px]">
                  Tactical Reserve Active:
                </span>{' '}
                {resolvedFireteam.reserveCount} reserve specialist
                {resolvedFireteam.reserveCount > 1 ? 's' : ''} will backfill unavailable/unassigned slots so your 3-operator fireteam deploys at full strength.
              </div>
            </div>
          )}

          {/* Initial Starting Formation Selector */}
          <div className="pt-2 border-t border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono text-[10.5px] uppercase tracking-wider text-zinc-300">
                Initial Starting Formation
              </div>
              <div className="font-mono text-[10px] text-zinc-500">
                Change anytime in-mission via [Q] or F-keys
              </div>
            </div>

            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2"
              role="group"
              aria-label="Initial squad formation"
            >
              {FORMATION_TACTICAL_PROFILES.map((fmt) => {
                const isSelected = (loadout.initialFormation ?? 'WEDGE') === fmt.id;
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    data-testid={`formation-option-${fmt.id}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      onUiClick();
                      updateMissionLoadout({ initialFormation: fmt.id as InitialFormation });
                    }}
                    className={`min-h-[44px] text-left p-2.5 rounded-xs border transition-colors motion-reduce:transition-none cursor-pointer ${
                      isSelected
                        ? 'bg-[#141E28] border-cyan-400 text-white'
                        : 'bg-[#0B0E11] border-zinc-800 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-display text-xs font-bold uppercase">{fmt.label}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-1 leading-snug">
                      {fmt.implication}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <section
          data-testid="solo-preparation-section"
          aria-label="Solo Tactical Preparation"
          className="bg-[#11161D] border border-amber-500/35 rounded-sm p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <h3 className="font-display text-base font-bold uppercase text-white leading-tight">
                  Solo Tactical Preparation
                </h3>
                <p className="font-mono text-[10.5px] text-zinc-400">
                  Adaptive Solo Encounter Director active · Full enemy lethality preserved.
                </p>
              </div>
            </div>
            <span className="font-mono text-[10px] uppercase text-amber-300">
              Single-Player · Zero AI Companions
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-[#0B0E11] border border-zinc-800 rounded-xs p-3 space-y-1">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-amber-400">
                <HeartPulse className="w-3.5 h-3.5" />
                Emergency Self-Recovery
              </div>
              <div className="text-xs text-zinc-200 leading-snug">
                {soloPrep.traumaCharges} Trauma Self-Revive charge per operation ([F] while downed, 45s cooldown).
              </div>
            </div>

            <div className="bg-[#0B0E11] border border-zinc-800 rounded-xs p-3 space-y-1">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-amber-400">
                <Package className="w-3.5 h-3.5" />
                Finite Cover Caches
              </div>
              <div className="text-xs text-zinc-200 leading-snug">
                {soloPrep.soloBonusCaches} finite Solo resupply caches staged along flanking lanes for {mission.title}.
              </div>
            </div>

            <div className="bg-[#0B0E11] border border-zinc-800 rounded-xs p-3 space-y-1">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-amber-400">
                <Shield className="w-3.5 h-3.5" />
                Encounter Pacing
              </div>
              <div className="text-xs text-zinc-200 leading-snug">
                {soloPrep.pacingSummary}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SECTION B: COMMANDER LOADOUT (4 SLOTS + ROLE PRESETS + SLIDE-OVER WORKBENCH) */}
      <section
        data-testid="commander-loadout-section"
        aria-label="Commander Loadout"
        className="space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <h3 className="font-display text-base font-bold uppercase text-white leading-tight">
                Commander Loadout
              </h3>
              <p className="font-mono text-[10.5px] text-zinc-400">
                {deploymentMode === 'solo'
                  ? `Recommended Solo kit: ${soloPrep.recommendedPrimaryRole} — ${soloPrep.tacticalBrief}`
                  : missionRec?.summary ?? 'Configure Primary, Secondary, Heavy, and Tactical Equipment.'}
              </p>
            </div>
          </div>

          {/* Non-blocking Role Kit Presets */}
          <div className="flex flex-wrap gap-1.5">
            {DEFAULT_ROLE_LOADOUT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-testid={`loadout-preset-${preset.id}`}
                onClick={() => handleApplyRoleLoadoutPreset(preset.id)}
                className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-xs bg-[#141920] border border-zinc-800 hover:border-amber-400/70 font-mono text-[10px] uppercase text-zinc-300 hover:text-white cursor-pointer"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* 3 Weapon Slots */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {renderWeaponSlotCard(
            'primary',
            'Primary Weapon',
            loadout.primaryWeapon,
            PRIMARY_CANDIDATES,
            (weaponId) => updateMissionLoadout({ primaryWeapon: weaponId })
          )}
          {renderWeaponSlotCard(
            'secondary',
            'Secondary Weapon',
            loadout.secondaryWeapon,
            SECONDARY_CANDIDATES,
            (weaponId) => updateMissionLoadout({ secondaryWeapon: weaponId })
          )}
          {renderWeaponSlotCard(
            'heavy',
            'Heavy / Ordnance',
            loadout.heavyWeapon,
            HEAVY_CANDIDATES,
            (weaponId) => updateMissionLoadout({ heavyWeapon: weaponId })
          )}
        </div>

        {/* 4th Slot: Tactical Equipment */}
        <div className="bg-[#141920] border border-zinc-800 rounded-sm p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              Tactical Equipment
            </div>
            <div className="font-mono text-[10.5px] text-amber-300">
              {TACTICAL_EQUIPMENT_CATALOG[loadout.tacticalEquipment]?.name}
            </div>
          </div>

          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2"
            role="group"
            aria-label="Select tactical equipment"
          >
            {TACTICAL_EQUIP_IDS.map((eqId) => {
              const eq = TACTICAL_EQUIPMENT_CATALOG[eqId];
              const isSelected = loadout.tacticalEquipment === eqId;
              return (
                <button
                  key={eqId}
                  type="button"
                  data-testid={`tactical-equip-${eqId}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    onUiClick();
                    updateMissionLoadout({ tacticalEquipment: eqId });
                  }}
                  className={`min-h-[44px] text-left p-2.5 rounded-xs border transition-colors motion-reduce:transition-none cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500/15 border-amber-400 text-white'
                      : 'bg-[#0B0E11] border-zinc-800 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-display text-xs font-bold uppercase">{eq.shortName}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-amber-400" />}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-snug">{eq.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
