import React, { useMemo, useState } from 'react';
import { Check, Lock, Palette, Wrench } from 'lucide-react';
import {
  getAttachmentsForWeaponCategory,
  OPERATOR_CAMO_CATALOG,
  OPERATOR_HELMET_CATALOG,
  OPERATOR_PATCH_CATALOG,
} from '@/src/data/attachments';
import {
  DEFAULT_EQUIPPED_ATTACHMENTS,
  resolveWeaponConfig,
  validateWeaponBuild,
} from '@/src/gameplay/weapons/AttachmentCompositionEngine';
import { compareWeaponBuilds } from '@/src/gameplay/weapons/WeaponBalanceTelemetry';
import {
  AttachmentSlot,
  OperatorCamoId,
  OperatorHelmetId,
  OperatorPatchId,
} from '@/src/schemas/campaign.schema';
import { WeaponConfig } from '@/src/schemas/weapon.schema';
import { useProgressionStore } from '@/src/stores/progressionStore';

const SLOTS: Array<{ id: AttachmentSlot; label: string }> = [
  { id: 'optic', label: 'Optic' },
  { id: 'muzzle', label: 'Muzzle' },
  { id: 'barrel', label: 'Barrel' },
  { id: 'underbarrel', label: 'Underbarrel / Stock' },
  { id: 'magazine', label: 'Magazine' },
];

function hexNumberToCss(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

export interface AttachmentBenchPanelProps {
  weapon: WeaponConfig;
  onUiClick: () => void;
}

export function AttachmentBenchPanel({ weapon, onUiClick }: AttachmentBenchPanelProps) {
  const [tab, setTab] = useState<'attachments' | 'cosmetics'>('attachments');
  const [activeSlot, setActiveSlot] = useState<AttachmentSlot>('optic');
  const [selectedCosmeticTarget, setSelectedCosmeticTarget] = useState<string>('player');

  const save = useProgressionStore((s) => s.save);
  const unlockAttachment = useProgressionStore((s) => s.unlockAttachment);
  const equipAttachment = useProgressionStore((s) => s.equipAttachment);
  const unlockCosmetic = useProgressionStore((s) => s.unlockCosmetic);
  const setPlayerCustomization = useProgressionStore((s) => s.setPlayerCustomization);
  const setOperatorCustomization = useProgressionStore((s) => s.setOperatorCustomization);

  const equipped = save.weaponAttachments[weapon.id] ?? DEFAULT_EQUIPPED_ATTACHMENTS;
  const upgrades = save.weaponUpgrades[weapon.id] ?? { damage: 0, recoil: 0, capacity: 0, reload: 0 };
  const weaponKills = save.weaponMasteryKills[weapon.id] ?? 0;

  const resolved = useMemo(
    () => resolveWeaponConfig(weapon, upgrades, equipped),
    [weapon, upgrades, equipped]
  );
  const baseWithUpgrades = useMemo(
    () => resolveWeaponConfig(weapon, upgrades, DEFAULT_EQUIPPED_ATTACHMENTS),
    [weapon, upgrades]
  );
  const buildReport = useMemo(
    () => validateWeaponBuild(weapon, equipped),
    [weapon, equipped]
  );
  const telemetryComparison = useMemo(
    () => compareWeaponBuilds(baseWithUpgrades, resolved),
    [baseWithUpgrades, resolved]
  );

  const slotOptions = useMemo(
    () => getAttachmentsForWeaponCategory(weapon.category, activeSlot),
    [weapon.category, activeSlot]
  );

  const activeCosmetics =
    selectedCosmeticTarget === 'player'
      ? save.playerCustomization
      : save.squadRoster.find((o) => o.id === selectedCosmeticTarget)?.customization ??
        save.playerCustomization;

  const applyCosmetic = (kind: 'camo' | 'helmet' | 'patch', id: string) => {
    onUiClick();
    if (selectedCosmeticTarget === 'player') {
      if (kind === 'camo') setPlayerCustomization({ camoId: id as OperatorCamoId });
      else if (kind === 'helmet') setPlayerCustomization({ helmetId: id as OperatorHelmetId });
      else setPlayerCustomization({ patchId: id as OperatorPatchId });
    } else {
      if (kind === 'camo') setOperatorCustomization(selectedCosmeticTarget, { camoId: id as OperatorCamoId });
      else if (kind === 'helmet') setOperatorCustomization(selectedCosmeticTarget, { helmetId: id as OperatorHelmetId });
      else setOperatorCustomization(selectedCosmeticTarget, { patchId: id as OperatorPatchId });
    }
  };

  return (
    <div
      data-testid="attachment-bench-panel"
      className="mt-4 pt-4 border-t border-zinc-800 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="armory-tab-attachments"
            onClick={() => {
              onUiClick();
              setTab('attachments');
            }}
            className={`min-h-[38px] px-3 py-1 rounded-xs border font-mono text-[11px] uppercase flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              tab === 'attachments'
                ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                : 'bg-[#0B0E11] border-zinc-800 text-zinc-400'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" /> Weapon Attachments
          </button>
          <button
            type="button"
            data-testid="armory-tab-cosmetics"
            onClick={() => {
              onUiClick();
              setTab('cosmetics');
            }}
            className={`min-h-[38px] px-3 py-1 rounded-xs border font-mono text-[11px] uppercase flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              tab === 'cosmetics'
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                : 'bg-[#0B0E11] border-zinc-800 text-zinc-400'
            }`}
          >
            <Palette className="w-3.5 h-3.5" /> Operator Cosmetics
          </button>
        </div>

        <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
          MASTERY: {weaponKills} KILLS · SOUND {resolved.soundRadiusMeters}M ·{' '}
          {resolved.isSuppressed ? 'SUPPRESSED' : 'UNSUPPRESSED'}
        </span>
      </div>

      {tab === 'attachments' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[10px]">
            <DeltaStat
              label="Damage"
              current={`${resolved.damage}`}
              delta={resolved.damage - baseWithUpgrades.damage}
            />
            <DeltaStat
              label="Recoil"
              current={resolved.recoilPitch.toFixed(3)}
              delta={Number((resolved.recoilPitch - baseWithUpgrades.recoilPitch).toFixed(3))}
              lowerIsBetter
            />
            <DeltaStat
              label="Reload"
              current={`${resolved.reloadTimeSec.toFixed(2)}s`}
              delta={Number((resolved.reloadTimeSec - baseWithUpgrades.reloadTimeSec).toFixed(2))}
              lowerIsBetter
            />
            <DeltaStat
              label="Mobility"
              current={`${Math.round(resolved.mobilityFactor * 100)}%`}
              delta={Math.round((resolved.mobilityFactor - baseWithUpgrades.mobilityFactor) * 100)}
              unit="%"
            />
          </div>

          <div
            data-testid="weapon-telemetry-comparison"
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[10px]"
          >
            <DeltaStat
              label="Infantry TTK"
              current={`${telemetryComparison.configured.ttkInfantrySec.toFixed(2)}s`}
              delta={telemetryComparison.deltas.ttkInfantryMsDelta}
              unit="ms"
              lowerIsBetter
            />
            <DeltaStat
              label="Heavy Armor TTK"
              current={`${telemetryComparison.configured.ttkHeavyArmorSec.toFixed(2)}s`}
              delta={Number(
                (
                  telemetryComparison.configured.ttkHeavyArmorSec -
                  telemetryComparison.baseline.ttkHeavyArmorSec
                ).toFixed(2)
              )}
              unit="s"
              lowerIsBetter
            />
            <DeltaStat
              label="Sustained DPM"
              current={`${telemetryComparison.configured.sustainedDpm}`}
              delta={telemetryComparison.deltas.sustainedDpmPct}
              unit="%"
            />
            <DeltaStat
              label="Handling / Stealth"
              current={`${telemetryComparison.configured.handlingIndex} / ${telemetryComparison.configured.stealthRating}`}
              delta={telemetryComparison.deltas.handlingDelta}
            />
          </div>

          {!buildReport.valid && (
            <div className="bg-red-950/40 border border-red-500/70 px-3 py-1.5 rounded-xs font-mono text-[10px] text-red-300">
              Build constraint warning: {buildReport.violatedClamps.join('; ')}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {SLOTS.map((slot) => {
              const hasEquipped = Boolean(equipped[slot.id]);
              return (
                <button
                  key={slot.id}
                  type="button"
                  data-testid={`attachment-slot-${slot.id}`}
                  onClick={() => {
                    onUiClick();
                    setActiveSlot(slot.id);
                  }}
                  className={`min-h-[36px] px-2.5 py-1 rounded-xs border font-mono text-[10px] uppercase cursor-pointer whitespace-nowrap ${
                    activeSlot === slot.id
                      ? 'bg-[#1B222C] border-amber-400 text-amber-200 font-bold'
                      : 'bg-[#0B0E11] border-zinc-800 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {slot.label} {hasEquipped ? '· SET' : ''}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                onUiClick();
                equipAttachment(weapon.id, activeSlot, null);
              }}
              className={`w-full px-3 py-2 rounded-xs border text-left font-mono text-[11px] flex items-center justify-between cursor-pointer ${
                !equipped[activeSlot]
                  ? 'bg-emerald-950/30 border-emerald-500/70 text-emerald-200'
                  : 'bg-[#0B0E11] border-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              <span>STANDARD FACTORY {activeSlot.toUpperCase()} (NO MODIFIER)</span>
              {!equipped[activeSlot] && <Check className="w-3.5 h-3.5 text-emerald-400" />}
            </button>

            {slotOptions.map((att) => {
              const unlocked = save.unlockedAttachments.includes(att.id);
              const isEquipped = equipped[activeSlot] === att.id;
              const meetsKills = weaponKills >= att.minMasteryKills;
              const meetsReq = save.requisitionPoints >= att.reqCost;

              return (
                <div
                  key={att.id}
                  data-testid={`attachment-item-${att.id}`}
                  className={`px-3 py-2 rounded-xs border flex flex-wrap items-center justify-between gap-2 ${
                    isEquipped
                      ? 'bg-[#1B222C] border-amber-400'
                      : 'bg-[#0B0E11] border-zinc-800'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-bold text-zinc-100">{att.name}</div>
                    <div className="font-mono text-[10px] text-emerald-400 mt-0.5">
                      PROS: {att.prosSummary}
                    </div>
                    <div className="font-mono text-[10px] text-rose-300">
                      CONS: {att.consSummary}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {unlocked ? (
                      <button
                        type="button"
                        onClick={() => {
                          onUiClick();
                          equipAttachment(weapon.id, activeSlot, isEquipped ? null : att.id);
                        }}
                        className={`min-h-[38px] px-3 py-1 rounded-xs border font-mono text-[10px] uppercase font-bold cursor-pointer whitespace-nowrap ${
                          isEquipped
                            ? 'bg-amber-500 text-zinc-950 border-white'
                            : 'bg-[#141920] border-zinc-600 text-zinc-200 hover:border-amber-400'
                        }`}
                      >
                        {isEquipped ? 'EQUIPPED' : 'EQUIP'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!meetsKills || !meetsReq}
                        onClick={() => {
                          onUiClick();
                          unlockAttachment(weapon.id, att.id);
                        }}
                        className="min-h-[38px] px-3 py-1 rounded-xs border bg-[#141920] border-amber-500/60 text-amber-300 disabled:opacity-45 font-mono text-[10px] uppercase flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <Lock className="w-3 h-3" />
                        {meetsKills
                          ? `UNLOCK ${att.reqCost} REQ`
                          : `${weaponKills}/${att.minMasteryKills} KILLS · ${att.reqCost} REQ`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => {
                onUiClick();
                setSelectedCosmeticTarget('player');
              }}
              className={`min-h-[34px] px-2.5 py-1 rounded-xs border uppercase cursor-pointer ${
                selectedCosmeticTarget === 'player'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                  : 'bg-[#0B0E11] border-zinc-800 text-zinc-400'
              }`}
            >
              Player Lead
            </button>
            {save.squadRoster.map((op) => (
              <button
                key={op.id}
                type="button"
                onClick={() => {
                  onUiClick();
                  setSelectedCosmeticTarget(op.id);
                }}
                className={`min-h-[34px] px-2.5 py-1 rounded-xs border uppercase cursor-pointer ${
                  selectedCosmeticTarget === op.id
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                    : 'bg-[#0B0E11] border-zinc-800 text-zinc-400'
                }`}
              >
                {op.callsign}
              </button>
            ))}
          </div>

          <CosmeticGroup
            title="Camo Finish"
            items={OPERATOR_CAMO_CATALOG}
            unlockedIds={save.unlockedCosmetics
              .filter((s) => s.startsWith('camo:'))
              .map((s) => s.slice('camo:'.length))}
            equippedId={activeCosmetics.camoId}
            reqBalance={save.requisitionPoints}
            onEquip={(id) => applyCosmetic('camo', id)}
            onUnlock={(id) => {
              onUiClick();
              unlockCosmetic('camo', id);
            }}
          />

          <CosmeticGroup
            title="Helmet & Visor"
            items={OPERATOR_HELMET_CATALOG}
            unlockedIds={save.unlockedCosmetics
              .filter((s) => s.startsWith('helmet:'))
              .map((s) => s.slice('helmet:'.length))}
            equippedId={activeCosmetics.helmetId}
            reqBalance={save.requisitionPoints}
            onEquip={(id) => applyCosmetic('helmet', id)}
            onUnlock={(id) => {
              onUiClick();
              unlockCosmetic('helmet', id);
            }}
          />

          <CosmeticGroup
            title="Unit Patch"
            items={OPERATOR_PATCH_CATALOG}
            unlockedIds={save.unlockedCosmetics
              .filter((s) => s.startsWith('patch:'))
              .map((s) => s.slice('patch:'.length))}
            equippedId={activeCosmetics.patchId}
            reqBalance={save.requisitionPoints}
            onEquip={(id) => applyCosmetic('patch', id)}
            onUnlock={(id) => {
              onUiClick();
              unlockCosmetic('patch', id);
            }}
          />
        </div>
      )}
    </div>
  );
}

function DeltaStat({
  label,
  current,
  delta,
  lowerIsBetter = false,
  unit = '',
}: {
  label: string;
  current: string;
  delta: number;
  lowerIsBetter?: boolean;
  unit?: string;
}) {
  const isPositive = delta > 0;
  const isGood = delta === 0 ? null : lowerIsBetter ? !isPositive : isPositive;
  return (
    <div className="bg-[#0B0E11] border border-zinc-800 px-2.5 py-1.5 rounded-xs">
      <div className="text-[9.5px] uppercase text-zinc-400">{label}</div>
      <div className="flex items-baseline justify-between gap-1 mt-0.5 tabular-nums">
        <span className="text-xs font-bold text-zinc-100">{current}</span>
        {delta !== 0 && (
          <span
            className={`text-[9.5px] font-bold ${
              isGood ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {delta > 0 ? `+${delta}${unit}` : `${delta}${unit}`}
          </span>
        )}
      </div>
    </div>
  );
}

function CosmeticGroup<T extends string>({
  title,
  items,
  unlockedIds,
  equippedId,
  reqBalance,
  onEquip,
  onUnlock,
}: {
  title: string;
  items: readonly { id: T; name: string; reqCost: number; primaryColorHex: number; description: string }[];
  unlockedIds: string[];
  equippedId: string;
  reqBalance: number;
  onEquip: (id: T) => void;
  onUnlock: (id: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {items.map((item) => {
          const unlocked = unlockedIds.includes(item.id);
          const equipped = equippedId === item.id;
          return (
            <div
              key={item.id}
              className={`px-2.5 py-2 rounded-xs border flex items-center justify-between gap-2 ${
                equipped
                  ? 'bg-[#1B222C] border-cyan-400'
                  : 'bg-[#0B0E11] border-zinc-800'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-3.5 h-3.5 rounded-xs border border-white/25 shrink-0"
                  style={{ backgroundColor: hexNumberToCss(item.primaryColorHex) }}
                />
                <div className="min-w-0">
                  <div className="font-mono text-[10.5px] font-bold text-zinc-100 truncate">
                    {item.name}
                  </div>
                  <div className="text-[9.5px] text-zinc-400 truncate">{item.description}</div>
                </div>
              </div>
              {unlocked ? (
                <button
                  type="button"
                  onClick={() => onEquip(item.id)}
                  className={`px-2 py-1 rounded-xs border font-mono text-[9.5px] uppercase cursor-pointer whitespace-nowrap ${
                    equipped
                      ? 'bg-cyan-500 text-zinc-950 border-white font-bold'
                      : 'bg-[#141920] border-zinc-700 text-zinc-200'
                  }`}
                >
                  {equipped ? 'SET' : 'USE'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={reqBalance < item.reqCost}
                  onClick={() => onUnlock(item.id)}
                  className="px-2 py-1 rounded-xs border bg-[#141920] border-amber-500/60 text-amber-300 disabled:opacity-40 font-mono text-[9.5px] uppercase cursor-pointer whitespace-nowrap"
                >
                  {item.reqCost} REQ
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
