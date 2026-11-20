import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Check,
  ExternalLink,
  Lock,
  RotateCcw,
  Save,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  ATTACHMENT_BY_ID,
  getAttachmentsForWeaponCategory,
} from '@/src/data/attachments';
import { WEAPON_BY_ID } from '@/src/data/weapons';
import {
  DEFAULT_EQUIPPED_ATTACHMENTS,
  resolveWeaponConfig,
  validateWeaponBuild,
} from '@/src/gameplay/weapons/AttachmentCompositionEngine';
import { compareWeaponBuilds } from '@/src/gameplay/weapons/WeaponBalanceTelemetry';
import { AttachmentSlot, EquippedWeaponAttachments } from '@/src/schemas/campaign.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { progressionStore, useProgressionStore } from '@/src/stores/progressionStore';
import { WeaponSilhouette } from '@/src/ui/components/WeaponSilhouette';
import { Button } from '@/src/ui/primitives/Button';

const ATTACHMENT_SLOTS: ReadonlyArray<{ id: AttachmentSlot; label: string }> = [
  { id: 'optic', label: 'Optic' },
  { id: 'muzzle', label: 'Muzzle' },
  { id: 'barrel', label: 'Barrel' },
  { id: 'underbarrel', label: 'Underbarrel' },
  { id: 'magazine', label: 'Magazine' },
];

export interface AttachmentWorkbenchDrawerProps {
  open: boolean;
  weaponId: WeaponId;
  slotLabel: string;
  onClose: () => void;
  onOpenFullArmory: () => void;
  onUiClick: () => void;
}

function areAttachmentsEqual(a: EquippedWeaponAttachments, b: EquippedWeaponAttachments): boolean {
  return (
    a.optic === b.optic &&
    a.muzzle === b.muzzle &&
    a.barrel === b.barrel &&
    a.underbarrel === b.underbarrel &&
    a.magazine === b.magazine
  );
}

export function AttachmentWorkbenchDrawer({
  open,
  weaponId,
  slotLabel,
  onClose,
  onOpenFullArmory,
  onUiClick,
}: AttachmentWorkbenchDrawerProps) {
  const save = useProgressionStore((s) => s.save);
  const unlockAttachment = useProgressionStore((s) => s.unlockAttachment);
  const applyWeaponAttachmentsBulk = useProgressionStore((s) => s.applyWeaponAttachmentsBulk);
  const saveNamedWeaponBuild = useProgressionStore((s) => s.saveNamedWeaponBuild);
  const deleteNamedWeaponBuild = useProgressionStore((s) => s.deleteNamedWeaponBuild);

  const weapon = WEAPON_BY_ID[weaponId];
  const persistedEquipped = useMemo<EquippedWeaponAttachments>(
    () => ({
      ...DEFAULT_EQUIPPED_ATTACHMENTS,
      ...(save.weaponAttachments[weaponId] ?? {}),
    }),
    [save.weaponAttachments, weaponId]
  );

  const [activeSlot, setActiveSlot] = useState<AttachmentSlot>('optic');
  const [draft, setDraft] = useState<EquippedWeaponAttachments>(persistedEquipped);
  const [statusMessage, setStatusMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [buildNameInput, setBuildNameInput] = useState('');
  const [showSaveBuildBar, setShowSaveBuildBar] = useState(false);

  // Reset staged draft only when opening the drawer or switching to a different weapon
  useEffect(() => {
    if (open) {
      const current = progressionStore.getState().save.weaponAttachments[weaponId] ?? {};
      setDraft({ ...DEFAULT_EQUIPPED_ATTACHMENTS, ...current });
      setStatusMessage(null);
      setShowDiscardConfirm(false);
      setShowSaveBuildBar(false);
      setBuildNameInput('');
    }
  }, [open, weaponId]);

  const hasUnsavedChanges = !areAttachmentsEqual(draft, persistedEquipped);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (hasUnsavedChanges) {
          setShowDiscardConfirm(true);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, hasUnsavedChanges, onClose]);

  const weaponUpgrades = save.weaponUpgrades[weaponId];
  const masteryKills = save.weaponMasteryKills[weaponId] ?? 0;

  const baselineProfile = useMemo(
    () => resolveWeaponConfig(weapon, weaponUpgrades, persistedEquipped),
    [weapon, weaponUpgrades, persistedEquipped]
  );
  const draftProfile = useMemo(
    () => resolveWeaponConfig(weapon, weaponUpgrades, draft),
    [weapon, weaponUpgrades, draft]
  );
  const comparison = useMemo(
    () => compareWeaponBuilds(baselineProfile, draftProfile),
    [baselineProfile, draftProfile]
  );
  const validation = useMemo(
    () => validateWeaponBuild(weapon, draft),
    [weapon, draft]
  );

  const slotAttachments = useMemo(
    () =>
      getAttachmentsForWeaponCategory(weapon.category).filter((att) => att.slot === activeSlot),
    [weapon.category, activeSlot]
  );

  const savedBuildsForWeapon = useMemo(
    () => (save.savedWeaponBuilds ?? []).filter((b) => b.weaponId === weaponId),
    [save.savedWeaponBuilds, weaponId]
  );

  if (!open || !weapon) return null;

  const isUnlocked = (attId: string): boolean => {
    return (
      save.unlockedAttachments.includes(`${weaponId}:${attId}`) ||
      save.unlockedAttachments.includes(attId)
    );
  };

  const handleRequestClose = () => {
    onUiClick();
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const handleApplyBuild = () => {
    onUiClick();
    const ok = applyWeaponAttachmentsBulk(weaponId, draft);
    if (ok) {
      setStatusMessage({ kind: 'ok', text: `${weapon.shortName} attachments applied.` });
      setShowDiscardConfirm(false);
    } else {
      setStatusMessage({
        kind: 'err',
        text: 'Unlock all selected attachments before applying this build.',
      });
    }
  };

  const handleSaveBuild = () => {
    onUiClick();
    const name = buildNameInput.trim() || `${weapon.shortName} Custom`;
    saveNamedWeaponBuild(weaponId, name, draft);
    setBuildNameInput('');
    setShowSaveBuildBar(false);
    setStatusMessage({ kind: 'ok', text: `Saved weapon build "${name}".` });
  };

  const handleApplySavedBuild = (attachments: EquippedWeaponAttachments, name: string) => {
    onUiClick();
    // Filter to unlocked attachments only so saved builds never bypass unlock gates
    const nextDraft: EquippedWeaponAttachments = { ...DEFAULT_EQUIPPED_ATTACHMENTS };
    let skipped = 0;
    for (const s of ATTACHMENT_SLOTS) {
      const id = attachments[s.id];
      if (id && isUnlocked(id)) {
        nextDraft[s.id] = id;
      } else if (id) {
        skipped += 1;
      }
    }
    setDraft(nextDraft);
    setStatusMessage({
      kind: skipped > 0 ? 'err' : 'ok',
      text:
        skipped > 0
          ? `Loaded "${name}" (${skipped} locked attachment skipped).`
          : `Staged saved build "${name}". Apply Build to commit.`,
    });
  };

  const formatDelta = (delta: number, suffix = '', invertGood = false) => {
    if (Math.abs(delta) < 0.01) return { label: '—', color: 'text-zinc-500' };
    const positive = delta > 0;
    const isGood = invertGood ? !positive : positive;
    const sign = positive ? '+' : '';
    return {
      label: `${sign}${Number.isInteger(delta) ? delta : delta.toFixed(2)}${suffix}`,
      color: isGood ? 'text-emerald-400' : 'text-red-400',
    };
  };

  const recoilBefore = Math.round((baselineProfile.recoilPitch + baselineProfile.recoilYaw) * 100);
  const recoilAfter = Math.round((draftProfile.recoilPitch + draftProfile.recoilYaw) * 100);
  const spreadBefore = Number((baselineProfile.spreadAdsRad * 1000).toFixed(1));
  const spreadAfter = Number((draftProfile.spreadAdsRad * 1000).toFixed(1));

  const statRows = [
    {
      label: 'Damage',
      before: `${Math.round(baselineProfile.damage * baselineProfile.pelletCount)}`,
      after: `${Math.round(draftProfile.damage * draftProfile.pelletCount)}`,
      delta: formatDelta(
        Math.round(draftProfile.damage * draftProfile.pelletCount) -
          Math.round(baselineProfile.damage * baselineProfile.pelletCount)
      ),
    },
    {
      label: 'Recoil Index',
      before: `${recoilBefore}`,
      after: `${recoilAfter}`,
      delta: formatDelta(recoilAfter - recoilBefore, '', true),
    },
    {
      label: 'ADS Spread (mrad)',
      before: `${spreadBefore}`,
      after: `${spreadAfter}`,
      delta: formatDelta(Number((spreadAfter - spreadBefore).toFixed(1)), '', true),
    },
    {
      label: 'Handling Index',
      before: `${comparison.baseline.handlingIndex}`,
      after: `${comparison.configured.handlingIndex}`,
      delta: formatDelta(comparison.deltas.handlingDelta),
    },
    {
      label: 'Reload (s)',
      before: `${baselineProfile.reloadTimeSec.toFixed(2)}s`,
      after: `${draftProfile.reloadTimeSec.toFixed(2)}s`,
      delta: formatDelta(
        Number((draftProfile.reloadTimeSec - baselineProfile.reloadTimeSec).toFixed(2)),
        's',
        true
      ),
    },
    {
      label: 'Sound Radius',
      before: `${comparison.baseline.soundRadiusMeters}m`,
      after: `${comparison.configured.soundRadiusMeters}m`,
      delta: formatDelta(comparison.deltas.soundRadiusDeltaM, 'm', true),
    },
    {
      label: 'Infantry TTK',
      before: `${comparison.baseline.ttkInfantrySec.toFixed(2)}s`,
      after: `${comparison.configured.ttkInfantrySec.toFixed(2)}s`,
      delta: formatDelta(comparison.deltas.ttkInfantryMsDelta, 'ms', true),
    },
    {
      label: 'Magazine',
      before: `${baselineProfile.magazineSize}`,
      after: `${draftProfile.magazineSize}`,
      delta: formatDelta(draftProfile.magazineSize - baselineProfile.magazineSize),
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Attachment Workbench for ${weapon.name}`}
      data-testid="attachment-workbench-drawer"
      className="fixed inset-0 z-50 bg-black/75 flex justify-end items-end md:items-stretch"
      onClick={handleRequestClose}
    >
      <div
        className="w-full md:w-[min(94vw,680px)] h-[90dvh] md:h-full bg-[#0B0E11] border-t md:border-t-0 md:border-l border-zinc-700 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 bg-[#141920] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 shrink-0" />
              <span>Attachment Workbench · {slotLabel}</span>
            </div>
            <h2 className="font-display text-lg sm:text-xl font-bold uppercase text-white truncate mt-0.5">
              {weapon.name}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right font-mono text-[11px] tabular-nums hidden sm:block">
              <div className="text-amber-400 font-bold">{save.requisitionPoints} REQ</div>
              <div className="text-zinc-400">{masteryKills} Mastery Kills</div>
            </div>
            <button
              type="button"
              data-testid="workbench-close-btn"
              aria-label="Close Attachment Workbench"
              onClick={handleRequestClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-[#0B0E11] hover:bg-zinc-800 border border-zinc-700 rounded-sm text-zinc-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Unsaved Draft Confirmation Bar */}
        {showDiscardConfirm && (
          <div
            data-testid="workbench-discard-confirm"
            className="px-4 py-2.5 bg-amber-950/50 border-b border-amber-500/70 flex flex-wrap items-center justify-between gap-2 shrink-0"
          >
            <div className="flex items-center gap-2 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>You have staged attachment changes. Apply or discard before closing?</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                data-testid="workbench-confirm-apply-close"
                onClick={() => {
                  if (applyWeaponAttachmentsBulk(weaponId, draft)) {
                    onClose();
                  }
                }}
              >
                Apply &amp; Close
              </Button>
              <Button
                size="sm"
                variant="danger"
                data-testid="workbench-confirm-discard"
                onClick={() => {
                  setDraft(persistedEquipped);
                  setShowDiscardConfirm(false);
                  onClose();
                }}
              >
                Discard Draft
              </Button>
              <Button
                size="sm"
                variant="secondary"
                data-testid="workbench-confirm-keep-editing"
                onClick={() => setShowDiscardConfirm(false)}
              >
                Keep Editing
              </Button>
            </div>
          </div>
        )}

        {/* Scrollable Workbench Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Weapon Silhouette & Compact Telemetry Bar */}
          <div className="bg-[#141920] border border-zinc-800 rounded-sm p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <WeaponSilhouette weaponId={weaponId} className="w-24 h-8 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                  {weapon.category} · {draftProfile.isSuppressed ? 'Suppressed' : 'Unsuppressed'}
                </div>
                <div className="font-mono text-xs text-zinc-200 tabular-nums mt-0.5">
                  Range {comparison.configured.effectiveRangeM}m · Stealth{' '}
                  {comparison.configured.stealthRating}/100 · Heavy TTK{' '}
                  {comparison.configured.ttkHeavyArmorSec}s
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:hidden font-mono text-[11px] tabular-nums">
              <span className="text-amber-400 font-bold">{save.requisitionPoints} REQ</span>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-400">{masteryKills} Kills</span>
            </div>
          </div>

          {/* 5 Attachment Slot Selector */}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 mb-2">
              Attachment Rail Slots
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5" role="tablist">
              {ATTACHMENT_SLOTS.map((slot) => {
                const equippedId = draft[slot.id];
                const equippedAtt = equippedId ? ATTACHMENT_BY_ID[equippedId] : null;
                const isSelected = activeSlot === slot.id;
                const changed = draft[slot.id] !== persistedEquipped[slot.id];
                return (
                  <button
                    key={slot.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    data-testid={`workbench-slot-${slot.id}`}
                    onClick={() => {
                      onUiClick();
                      setActiveSlot(slot.id);
                    }}
                    className={`min-h-[48px] px-2.5 py-2 rounded-sm border text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-400 text-white'
                        : 'bg-[#141920] border-zinc-800 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 font-mono text-[9.5px] uppercase tracking-wider text-zinc-400">
                      <span>{slot.label}</span>
                      {changed && <span className="text-amber-400 font-bold">*</span>}
                    </div>
                    <div className="text-xs font-semibold truncate mt-0.5">
                      {equippedAtt ? equippedAtt.shortName : 'Stock'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Compatible Attachments for Active Slot */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                {ATTACHMENT_SLOTS.find((s) => s.id === activeSlot)?.label} Options
              </span>
              {draft[activeSlot] !== null && (
                <button
                  type="button"
                  data-testid={`workbench-clear-${activeSlot}`}
                  onClick={() => {
                    onUiClick();
                    setDraft((prev) => ({ ...prev, [activeSlot]: null }));
                  }}
                  className="font-mono text-[10px] uppercase text-zinc-400 hover:text-amber-300 cursor-pointer"
                >
                  Reset Slot to Stock
                </button>
              )}
            </div>

            {slotAttachments.length === 0 ? (
              <div className="bg-[#141920] border border-zinc-800 rounded-sm p-3 text-xs text-zinc-400">
                No modular attachments are available for this slot on {weapon.shortName}.
              </div>
            ) : (
              <div className="space-y-2">
                {slotAttachments.map((att) => {
                  const unlocked = isUnlocked(att.id);
                  const staged = draft[activeSlot] === att.id;
                  const masteryMet = masteryKills >= att.minMasteryKills;
                  const reqMet = save.requisitionPoints >= att.reqCost;
                  return (
                    <div
                      key={att.id}
                      data-testid={`workbench-att-${att.id}`}
                      className={`p-3 rounded-sm border transition-colors ${
                        staged
                          ? 'bg-amber-500/12 border-amber-400'
                          : 'bg-[#141920] border-zinc-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-sm font-bold uppercase text-white">
                              {att.name}
                            </span>
                            {staged && (
                              <span className="font-mono text-[10px] uppercase text-amber-300 font-bold">
                                STAGED
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5">{att.description}</p>
                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10.5px]">
                            <span className="text-emerald-400">+ {att.prosSummary}</span>
                            <span className="text-red-400">- {att.consSummary}</span>
                          </div>
                        </div>

                        <div className="shrink-0">
                          {unlocked ? (
                            <Button
                              size="sm"
                              variant={staged ? 'secondary' : 'primary'}
                              data-testid={`workbench-equip-${att.id}`}
                              onClick={() => {
                                onUiClick();
                                setDraft((prev) => ({
                                  ...prev,
                                  [activeSlot]: staged ? null : att.id,
                                }));
                                setStatusMessage(null);
                              }}
                              className="min-h-[40px]"
                            >
                              {staged ? 'Unequip' : 'Stage'}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!masteryMet || !reqMet}
                              data-testid={`workbench-unlock-${att.id}`}
                              onClick={() => {
                                onUiClick();
                                const res = unlockAttachment(weaponId, att.id);
                                if (res.ok) {
                                  setDraft((prev) => ({ ...prev, [activeSlot]: att.id }));
                                  setStatusMessage({
                                    kind: 'ok',
                                    text: `Unlocked & staged ${att.shortName}.`,
                                  });
                                } else {
                                  setStatusMessage({
                                    kind: 'err',
                                    text: res.reason ?? 'Cannot unlock attachment.',
                                  });
                                }
                              }}
                              className="min-h-[40px]"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              {!masteryMet
                                ? `${masteryKills}/${att.minMasteryKills} Kills`
                                : `${att.reqCost} REQ`}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Before / After Stat Comparison */}
          <div className="bg-[#141920] border border-zinc-800 rounded-sm p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-400 font-bold">
                Live Ballistic Comparison (Equipped vs. Staged)
              </span>
              <span className="font-mono text-[10px] text-zinc-400">
                {draftProfile.appliedAttachmentIds.length}/5 Slots Active
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] tabular-nums">
              {statRows.map((row) => (
                <div key={row.label} className="bg-[#0B0E11] border border-zinc-800/80 p-2 rounded-xs">
                  <div className="text-[9.5px] uppercase text-zinc-400">{row.label}</div>
                  <div className="flex items-baseline justify-between gap-1 mt-0.5">
                    <span className="text-white font-bold">{row.after}</span>
                    <span className={`text-[10px] font-bold ${row.delta.color}`}>
                      {row.delta.label}
                    </span>
                  </div>
                  <div className="text-[9px] text-zinc-500">Base: {row.before}</div>
                </div>
              ))}
            </div>

            {validation.violatedClamps.length > 0 && (
              <div className="bg-amber-950/35 border border-amber-500/50 p-2 rounded-xs font-mono text-[10px] text-amber-200">
                Clamp notice: {validation.violatedClamps.join(' · ')}
              </div>
            )}

            {draftProfile.tradeOffSummary.cons.length > 0 && (
              <div className="text-[11px] font-mono text-zinc-400">
                Active trade-offs: {draftProfile.tradeOffSummary.cons.slice(0, 3).join(' · ')}
              </div>
            )}
          </div>

          {/* Saved Named Weapon Builds */}
          <div className="bg-[#141920] border border-zinc-800 rounded-sm p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-300 font-bold flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                Saved {weapon.shortName} Builds ({savedBuildsForWeapon.length})
              </span>
              <button
                type="button"
                data-testid="workbench-toggle-save-build"
                onClick={() => {
                  onUiClick();
                  setShowSaveBuildBar((v) => !v);
                }}
                className="font-mono text-[10px] uppercase text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer min-h-[32px]"
              >
                <Save className="w-3 h-3" /> Save Current Build
              </button>
            </div>

            {showSaveBuildBar && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={buildNameInput}
                  maxLength={32}
                  placeholder={`e.g. ${weapon.shortName} Stealth CQB`}
                  data-testid="workbench-build-name-input"
                  onChange={(e) => setBuildNameInput(e.target.value)}
                  className="flex-1 min-h-[40px] bg-[#0B0E11] border border-zinc-700 px-2.5 text-xs text-white rounded-sm focus:outline-none focus:border-amber-400"
                />
                <Button
                  size="sm"
                  variant="primary"
                  data-testid="workbench-confirm-save-build"
                  onClick={handleSaveBuild}
                >
                  Save
                </Button>
              </div>
            )}

            {savedBuildsForWeapon.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No saved builds for {weapon.shortName} yet. Stage attachments and save reusable
                configs here.
              </p>
            ) : (
              <div className="space-y-1.5">
                {savedBuildsForWeapon.map((build) => {
                  const count = Object.values(build.attachments).filter(Boolean).length;
                  return (
                    <div
                      key={build.id}
                      data-testid={`saved-build-${build.id}`}
                      className="flex items-center justify-between gap-2 bg-[#0B0E11] border border-zinc-800 px-2.5 py-2 rounded-xs"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-100 truncate">
                          {build.name}
                        </div>
                        <div className="font-mono text-[10px] text-zinc-400">
                          {count} attachment{count === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleApplySavedBuild(build.attachments, build.name)}
                        >
                          Load
                        </Button>
                        <button
                          type="button"
                          aria-label={`Delete ${build.name}`}
                          onClick={() => {
                            onUiClick();
                            deleteNamedWeaponBuild(build.id);
                          }}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-zinc-500 hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {statusMessage && (
            <div
              data-testid="workbench-status-msg"
              className={`p-2.5 rounded-sm border font-mono text-xs ${
                statusMessage.kind === 'ok'
                  ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-300'
                  : 'bg-red-950/30 border-red-500/50 text-red-300'
              }`}
            >
              {statusMessage.text}
            </div>
          )}
        </div>

        {/* Sticky Footer Actions */}
        <div className="px-4 py-3 border-t border-zinc-800 bg-[#141920] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              data-testid="workbench-open-armory-btn"
              onClick={() => {
                onUiClick();
                onOpenFullArmory();
              }}
              className="min-h-[44px]"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open Full Armory
            </Button>
            {hasUnsavedChanges && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onUiClick();
                  setDraft(persistedEquipped);
                  setStatusMessage(null);
                }}
                className="min-h-[44px]"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </Button>
            )}
          </div>

          <Button
            size="md"
            variant="primary"
            disabled={!hasUnsavedChanges}
            data-testid="workbench-apply-build-btn"
            onClick={handleApplyBuild}
            className="min-h-[44px] min-w-[140px]"
          >
            <Check className="w-4 h-4" /> Apply Build
          </Button>
        </div>
      </div>
    </div>
  );
}
