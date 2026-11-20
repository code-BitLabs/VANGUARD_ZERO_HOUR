import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  HeartPulse,
  Plus,
  Shield,
  Sliders,
  Trash2,
  Users,
} from 'lucide-react';
import {
  DEFAULT_ROLE_LOADOUT_PRESETS,
  MISSION_LOADOUT_RECOMMENDATIONS,
  TACTICAL_EQUIPMENT_CATALOG,
} from '@/src/data/attachments';
import {
  OPERATOR_SPECIALIZATIONS,
  resolveDeployableFireteam,
  SQUAD_ARCHETYPE_FLYWEIGHTS,
} from '@/src/data/squadRoster';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import {
  foldCampaignLedger,
  getMissionIntelBriefing,
  resolveMissionConsequences,
} from '@/src/gameplay/campaign/CampaignEventLedger';
import {
  ReplayMode,
  TacticalEquipmentId,
} from '@/src/schemas/campaign.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import {
  EXPEDITE_RECOVERY_REQ_COST,
  useProgressionStore,
} from '@/src/stores/progressionStore';

const PRIMARY_WEAPONS = WEAPON_CATALOG.filter((w) =>
  ['assault_rifle', 'smg', 'shotgun', 'lmg', 'sniper_rifle'].includes(w.id)
);
const SECONDARY_WEAPONS = WEAPON_CATALOG.filter((w) =>
  ['pistol', 'smg', 'shotgun'].includes(w.id)
);
const HEAVY_WEAPONS = WEAPON_CATALOG.filter((w) =>
  ['rocket_launcher', 'guided_missile', 'grenade_launcher', 'sniper_rifle', 'lmg'].includes(w.id)
);

export interface OperationsPlanningPanelProps {
  missionId: number;
  onUiClick: () => void;
}

export function OperationsPlanningPanel({
  missionId,
  onUiClick,
}: OperationsPlanningPanelProps) {
  const save = useProgressionStore((s) => s.save);
  const updateMissionLoadout = useProgressionStore((s) => s.updateMissionLoadout);
  const applyLoadoutPreset = useProgressionStore((s) => s.applyLoadoutPreset);
  const saveCustomLoadoutPreset = useProgressionStore((s) => s.saveCustomLoadoutPreset);
  const deleteCustomLoadoutPreset = useProgressionStore((s) => s.deleteCustomLoadoutPreset);
  const expediteOperatorRecovery = useProgressionStore((s) => s.expediteOperatorRecovery);
  const toggleIronmanSquad = useProgressionStore((s) => s.toggleIronmanSquad);

  const replayMode = useMissionSelectionStore((s) => s.replayMode);
  const setReplayMode = useMissionSelectionStore((s) => s.setReplayMode);

  const [newPresetName, setNewPresetName] = useState('');
  const [ledgerExpanded, setLedgerExpanded] = useState(false);

  const activeLoadout = save.activeMissionLoadout;
  const missionRec = save.missionRecords[String(missionId)];
  const isMissionCompleted = Boolean(missionRec?.completed);

  const foldedLedger = useMemo(
    () => foldCampaignLedger(save.campaignLedger),
    [save.campaignLedger]
  );
  const consequences = useMemo(
    () => resolveMissionConsequences(missionId, save.campaignLedger, replayMode),
    [missionId, save.campaignLedger, replayMode]
  );
  const intelItems = useMemo(
    () => getMissionIntelBriefing(missionId, consequences),
    [missionId, consequences]
  );
  const recommendation = MISSION_LOADOUT_RECOMMENDATIONS[missionId];

  const resolvedTeam = useMemo(
    () => resolveDeployableFireteam(save.squadRoster, activeLoadout.squadIds, 3),
    [save.squadRoster, activeLoadout.squadIds]
  );

  const customPresets = useMemo(
    () => save.loadoutPresets.filter((p) => !p.isBuiltIn),
    [save.loadoutPresets]
  );

  const toggleOperatorInSquad = (operatorId: string) => {
    onUiClick();
    const current = [...activeLoadout.squadIds];
    if (current.includes(operatorId)) {
      if (current.length <= 1) return;
      updateMissionLoadout({
        squadIds: current.filter((id) => id !== operatorId),
      });
    } else {
      const next = current.length >= 3 ? [...current.slice(1), operatorId] : [...current, operatorId];
      updateMissionLoadout({ squadIds: next });
    }
  };

  const handleSavePreset = () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) return;
    onUiClick();
    saveCustomLoadoutPreset(trimmed, activeLoadout);
    setNewPresetName('');
  };

  const replayOptions: Array<{ id: ReplayMode; label: string; note: string }> = [
    {
      id: 'canonical',
      label: 'Canonical',
      note: 'Standard campaign timeline; commits consequences on clear.',
    },
    {
      id: 'campaign_replay',
      label: 'Campaign Replay',
      note: 'Previews downstream rebase diff before replacing canonical outcome.',
    },
    {
      id: 'clean_replay',
      label: 'Clean Replay',
      note: 'Score/XP/Mastery only; canonical ledger & squad recovery untouched.',
    },
  ];

  return (
    <div
      data-testid="operations-planning-panel"
      className="mt-3.5 pt-3.5 border-t border-zinc-800 space-y-3.5"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Tactical Intel & Campaign Ledger */}
        <div className="bg-[#0B0E11] border border-zinc-800 p-3 rounded-sm space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-400 font-bold">
              Theater Intelligence &amp; Consequences
            </span>
            <button
              type="button"
              onClick={() => {
                onUiClick();
                setLedgerExpanded((v) => !v);
              }}
              className="font-mono text-[10px] text-amber-300 hover:text-amber-200 underline cursor-pointer whitespace-nowrap"
            >
              {ledgerExpanded
                ? 'Hide Ledger'
                : `Ledger (${save.campaignLedger.events.length} Events)`}
            </button>
          </div>

          <div className="space-y-1.5">
            {intelItems.map((item) => (
              <div
                key={item.id}
                className="border-t border-zinc-800/80 pt-1.5 text-[11px] flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <span
                    className={`font-mono text-[9.5px] uppercase font-bold mr-1.5 ${
                      item.verified ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {item.verified ? 'VERIFIED' : 'UNCERTAIN'}
                  </span>
                  <span className="text-zinc-200">{item.label}</span>
                  <div className="text-[10px] text-zinc-400 leading-snug">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>

          {consequences.activeSummaries.length > 0 && (
            <div className="border-t border-zinc-800 pt-2 space-y-1">
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-amber-400">
                Active Cross-Mission Modifiers ({replayMode.replace('_', ' ').toUpperCase()})
              </div>
              {consequences.activeSummaries.map((item, i) => (
                <div key={`${item.eventId}-${i}`} className="text-[11px] text-zinc-300 leading-snug">
                  · <span className="text-zinc-100 font-semibold">{item.title}:</span>{' '}
                  {item.effectDescription}
                </div>
              ))}
            </div>
          )}

          {ledgerExpanded && (
            <div
              data-testid="campaign-ledger-inspector"
              className="border-t border-zinc-800 pt-2 space-y-1 max-h-[140px] overflow-y-auto font-mono text-[10px]"
            >
              {save.campaignLedger.events.length === 0 ? (
                <div className="text-zinc-500">
                  No canonical campaign decisions committed yet. Complete Mission 01 to initialize the timeline.
                </div>
              ) : (
                save.campaignLedger.events.map((ev) => (
                  <div
                    key={`${ev.sequence}-${ev.eventId}`}
                    className="flex items-center justify-between gap-2 text-zinc-300 border-b border-zinc-900 pb-1"
                  >
                    <span className="truncate">
                      #{ev.sequence} · OP0{ev.missionId} · {ev.eventId.replace(/_/g, ' ')}
                    </span>
                    <span className="text-zinc-500 shrink-0 uppercase">{ev.outcome}</span>
                  </div>
                ))
              )}
              <div className="text-[9.5px] text-zinc-500 pt-1">
                Active Flags: {foldedLedger.achievedFlags.size} · Timeline Rev{' '}
                {save.campaignLedger.timelineRevision}
              </div>
            </div>
          )}
        </div>

        {/* Replay Mode Selector + Active Fireteam Roster */}
        <div className="bg-[#0B0E11] border border-zinc-800 p-3 rounded-sm space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 shrink-0" /> Timeline &amp; Replay Mode
            </span>
            {isMissionCompleted && (
              <span className="font-mono text-[9.5px] text-emerald-400">COMPLETED</span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {replayOptions.map((opt) => {
              const selected = replayMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`replay-mode-${opt.id}`}
                  aria-pressed={selected}
                  onClick={() => {
                    onUiClick();
                    setReplayMode(opt.id);
                  }}
                  className={`min-h-[40px] px-2 py-1.5 rounded-xs border text-left font-mono text-[10px] transition-colors cursor-pointer ${
                    selected
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                      : 'bg-[#141920] border-zinc-800 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <div className="truncate">{opt.label}</div>
                </button>
              );
            })}
          </div>
          <p className="text-[10.5px] text-zinc-400 leading-snug">
            {replayOptions.find((o) => o.id === replayMode)?.note}
          </p>

          <div className="border-t border-zinc-800 pt-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-400 font-bold flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 shrink-0" /> Fireteam ({resolvedTeam.operators.length}/3 Active)
              </span>
              <button
                type="button"
                data-testid="toggle-ironman-squad"
                aria-pressed={save.ironmanSquadEnabled}
                onClick={() => {
                  onUiClick();
                  toggleIronmanSquad();
                }}
                className={`px-2 py-0.5 rounded-xs border font-mono text-[9.5px] uppercase cursor-pointer whitespace-nowrap ${
                  save.ironmanSquadEnabled
                    ? 'bg-red-950/60 border-red-500 text-red-300 font-bold'
                    : 'bg-[#141920] border-zinc-700 text-zinc-400'
                }`}
              >
                Ironman: {save.ironmanSquadEnabled ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="space-y-1">
              {save.squadRoster.map((op) => {
                const archetype = SQUAD_ARCHETYPE_FLYWEIGHTS[op.role];
                const selected = activeLoadout.squadIds.includes(op.id);
                const recovering = op.status === 'recovering';
                const kia = op.status === 'kia';
                const specs = op.unlockedSpecializations
                  .map((s) => OPERATOR_SPECIALIZATIONS[s]?.name)
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <div
                    key={op.id}
                    className={`px-2 py-1.5 rounded-xs border flex items-center justify-between gap-2 text-[11px] ${
                      selected
                        ? 'bg-[#1B222C] border-cyan-500/80'
                        : 'bg-[#141920] border-zinc-800'
                    }`}
                  >
                    <button
                      type="button"
                      data-testid={`roster-select-${op.id}`}
                      disabled={recovering || kia}
                      onClick={() => toggleOperatorInSquad(op.id)}
                      className="flex-1 text-left min-w-0 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
                        <span className="font-bold text-zinc-100">{op.callsign}</span>
                        <span className="text-zinc-500">/</span>
                        <span className="text-cyan-300 uppercase">{archetype.roleLabel}</span>
                        <span className="text-zinc-500">·</span>
                        <span className="text-zinc-400 tabular-nums">{op.kills} K</span>
                      </div>
                      {specs && (
                        <div className="font-mono text-[9px] text-amber-300 truncate mt-0.5">
                          {specs}
                        </div>
                      )}
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0 font-mono text-[9.5px]">
                      {recovering ? (
                        <>
                          <span className="text-amber-400">
                            MED {op.recoveryOpsRemaining} OP
                          </span>
                          <button
                            type="button"
                            disabled={save.requisitionPoints < EXPEDITE_RECOVERY_REQ_COST}
                            onClick={() => {
                              onUiClick();
                              expediteOperatorRecovery(op.id);
                            }}
                            className="px-1.5 py-0.5 bg-amber-500/20 border border-amber-400/70 text-amber-200 rounded-xs disabled:opacity-40 cursor-pointer whitespace-nowrap"
                          >
                            <HeartPulse className="w-3 h-3 inline mr-0.5" />
                            {EXPEDITE_RECOVERY_REQ_COST} REQ
                          </button>
                        </>
                      ) : kia ? (
                        <span className="text-red-400 font-bold">KIA</span>
                      ) : selected ? (
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> DEPLOY
                        </span>
                      ) : (
                        <span className="text-zinc-500">STANDBY</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {resolvedTeam.reserveCount > 0 && (
              <div className="font-mono text-[9.5px] text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>
                  {resolvedTeam.reserveCount} Reserve Specialist(s) auto-assigned to preserve a full 3-operator squad.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Role Loadout Presets & 4-Slot Mission Kit */}
      <div className="bg-[#0B0E11] border border-zinc-800 p-3 rounded-sm space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 shrink-0" /> Mission Loadout &amp; Role Presets (All 9 Arsenal Weapons Available)
          </span>
          {recommendation && (
            <span className="font-mono text-[10px] text-cyan-300">
              RECOMMENDED: {recommendation.suggestedPresetId.replace('preset_', '').toUpperCase()} —{' '}
              {recommendation.summary}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {DEFAULT_ROLE_LOADOUT_PRESETS.map((preset) => {
            const active =
              preset.config.primaryWeapon === activeLoadout.primaryWeapon &&
              preset.config.heavyWeapon === activeLoadout.heavyWeapon &&
              preset.config.tacticalEquipment === activeLoadout.tacticalEquipment;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`loadout-preset-${preset.id}`}
                onClick={() => {
                  onUiClick();
                  applyLoadoutPreset(preset.id);
                }}
                className={`min-h-[36px] px-2.5 py-1 rounded-xs border font-mono text-[10px] uppercase whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                    : 'bg-[#141920] border-zinc-800 text-zinc-300 hover:border-zinc-600'
                }`}
              >
                {preset.name}
              </button>
            );
          })}
          {customPresets.map((preset) => (
            <div
              key={preset.id}
              className="inline-flex items-center rounded-xs border font-mono text-[10px] bg-[#141920] border-zinc-800 text-zinc-300"
            >
              <button
                type="button"
                onClick={() => {
                  onUiClick();
                  applyLoadoutPreset(preset.id);
                }}
                className="min-h-[36px] px-2.5 py-1 uppercase whitespace-nowrap cursor-pointer hover:text-cyan-200"
              >
                {preset.name}
              </button>
              <button
                type="button"
                aria-label={`Delete preset ${preset.name}`}
                onClick={() => {
                  onUiClick();
                  deleteCustomLoadoutPreset(preset.id);
                }}
                className="px-1.5 text-zinc-500 hover:text-red-400 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-[11px]">
          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase text-zinc-400">Primary Weapon</span>
            <select
              data-testid="loadout-select-primary"
              value={activeLoadout.primaryWeapon}
              onChange={(e) => {
                onUiClick();
                updateMissionLoadout({ primaryWeapon: e.target.value as WeaponId });
              }}
              className="min-h-[40px] bg-[#141920] border border-zinc-700 rounded-xs px-2 py-1 text-zinc-100 focus:outline-none focus:border-amber-400"
            >
              {PRIMARY_WEAPONS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase text-zinc-400">Secondary Weapon</span>
            <select
              data-testid="loadout-select-secondary"
              value={activeLoadout.secondaryWeapon}
              onChange={(e) => {
                onUiClick();
                updateMissionLoadout({ secondaryWeapon: e.target.value as WeaponId });
              }}
              className="min-h-[40px] bg-[#141920] border border-zinc-700 rounded-xs px-2 py-1 text-zinc-100 focus:outline-none focus:border-amber-400"
            >
              {SECONDARY_WEAPONS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase text-zinc-400">Heavy / Specialist</span>
            <select
              data-testid="loadout-select-heavy"
              value={activeLoadout.heavyWeapon}
              onChange={(e) => {
                onUiClick();
                updateMissionLoadout({ heavyWeapon: e.target.value as WeaponId });
              }}
              className="min-h-[40px] bg-[#141920] border border-zinc-700 rounded-xs px-2 py-1 text-zinc-100 focus:outline-none focus:border-amber-400"
            >
              {HEAVY_WEAPONS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[9.5px] uppercase text-zinc-400">Tactical Equipment</span>
            <select
              data-testid="loadout-select-tactical"
              value={activeLoadout.tacticalEquipment}
              onChange={(e) => {
                onUiClick();
                updateMissionLoadout({
                  tacticalEquipment: e.target.value as TacticalEquipmentId,
                });
              }}
              className="min-h-[40px] bg-[#141920] border border-zinc-700 rounded-xs px-2 py-1 text-zinc-100 focus:outline-none focus:border-amber-400"
            >
              {(Object.keys(TACTICAL_EQUIPMENT_CATALOG) as TacticalEquipmentId[]).map((eqId) => {
                const eq = TACTICAL_EQUIPMENT_CATALOG[eqId];
                return (
                  <option key={eqId} value={eqId}>
                    {eq.name}
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-zinc-800/80">
          <span className="font-mono text-[10px] text-zinc-400 flex items-center gap-1.5">
            <Shield className="w-3 h-3 text-cyan-400 shrink-0" />
            {TACTICAL_EQUIPMENT_CATALOG[activeLoadout.tacticalEquipment as TacticalEquipmentId]?.description}
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              maxLength={24}
              placeholder="Save custom preset..."
              className="min-h-[36px] bg-[#141920] border border-zinc-700 rounded-xs px-2 py-1 font-mono text-[10px] text-zinc-100 placeholder:text-zinc-500 w-40 focus:outline-none focus:border-amber-400"
            />
            <button
              type="button"
              onClick={handleSavePreset}
              disabled={!newPresetName.trim()}
              className="min-h-[36px] px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 rounded-xs font-mono text-[10px] uppercase text-zinc-100 flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3 h-3" /> Save Kit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
