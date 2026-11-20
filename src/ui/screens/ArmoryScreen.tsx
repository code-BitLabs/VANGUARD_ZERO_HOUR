import React, { useState } from 'react';
import { ArrowLeft, ArrowUpCircle, Play } from 'lucide-react';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { WeaponId, WeaponUpgradeKey } from '@/src/schemas/weapon.schema';
import { UPGRADE_COSTS, useProgressionStore } from '@/src/stores/progressionStore';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { uiStore } from '@/src/stores/uiStore';
import { WeaponSilhouette } from '@/src/ui/components/WeaponSilhouette';
import { Button } from '@/src/ui/primitives/Button';
import { Card, CardContent } from '@/src/ui/primitives/Card';
import { ProgressBar } from '@/src/ui/primitives/Controls';
import { AttachmentBenchPanel } from './AttachmentBenchPanel';

const UPGRADES: Array<{ key: WeaponUpgradeKey; label: string; effect: string }> = [
  { key: 'damage', label: 'Ballistic Damage', effect: '+9% per tier' },
  { key: 'recoil', label: 'Recoil Compensator', effect: '-8% kick per tier' },
  { key: 'capacity', label: 'Extended Magazines', effect: '+10% mag & reserve' },
  { key: 'reload', label: 'Sleight Reload Rig', effect: '-8% reload time' },
];

export function ArmoryScreen({
  onDeployWithWeapon,
  onUiClick,
}: {
  onDeployWithWeapon: (weaponId: WeaponId) => void;
  onUiClick: () => void;
}) {
  const [selectedId, setSelectedId] = useState<WeaponId>('assault_rifle');
  const save = useProgressionStore((s) => s.save);
  const upgradeWeapon = useProgressionStore((s) => s.upgradeWeapon);
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);

  const active = WEAPON_CATALOG.find((w) => w.id === selectedId) ?? WEAPON_CATALOG[0];
  const levels = save.weaponUpgrades[active.id] ?? { damage: 0, recoil: 0, capacity: 0, reload: 0 };

  const effectiveDamage = Math.round(active.damage * (1 + levels.damage * 0.09));
  const effectiveMag = Math.round(active.magazineSize * (1 + levels.capacity * 0.1));
  const effectiveReload = (active.reloadTimeSec * Math.max(0.58, 1 - levels.reload * 0.08)).toFixed(2);

  return (
    <div
      className="fixed inset-0 z-20 bg-[#0B0E11]/94 flex flex-col overflow-y-auto"
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="max-w-6xl w-full mx-auto flex flex-col gap-4 sm:gap-6 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[44px]"
              onClick={() => {
                onUiClick();
                uiStore.getState().setScreen('title');
              }}
            >
              <ArrowLeft className="w-4 h-4" /> HQ Menu
            </Button>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400">
                All 9 Arsenal Slots + M67 Grenades
              </p>
              <h2 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-wider text-white">
                Tactical Armory
              </h2>
            </div>
          </div>

          <div className="bg-[#141920] border border-amber-500/50 px-3.5 py-2 rounded-sm font-mono text-xs">
            <span className="text-zinc-400 mr-2">REQUISITION CREDITS:</span>
            <span className="text-amber-400 font-bold text-sm tabular-nums">{save.requisitionPoints} REQ</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6 flex-1">
          {/* Weapon Roster */}
          <div className="md:col-span-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-2 content-start">
            {WEAPON_CATALOG.map((w) => {
              const activeCard = w.id === active.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    onUiClick();
                    setSelectedId(w.id);
                  }}
                  className={`flex items-center justify-between min-h-[48px] px-3.5 py-2 rounded-sm border text-left transition-colors cursor-pointer ${
                    activeCard
                      ? 'bg-[#1B222C] border-amber-500'
                      : 'bg-[#141920] border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <div>
                    <div className="font-mono text-[10px] text-amber-400">SLOT [{w.slot}] // {w.category.toUpperCase()}</div>
                    <div className="font-display text-sm font-bold uppercase text-white">{w.name}</div>
                  </div>
                  <WeaponSilhouette weaponId={w.id} className="w-16 h-6 text-zinc-300 shrink-0" />
                </button>
              );
            })}
          </div>

          {/* Weapon Inspection & Upgrades */}
          <Card className="md:col-span-7 flex flex-col">
            <CardContent className="flex flex-col justify-between gap-4 sm:gap-5 flex-1">
              <div>
                <div className="bg-[#0B0E11] border border-zinc-800 p-4 sm:p-6 rounded-sm flex flex-col items-center justify-center">
                  <WeaponSilhouette weaponId={active.id} className="w-48 sm:w-56 h-16 sm:h-20 text-amber-400" />
                  <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 mt-2.5">
                    {active.fireModes.join(' / ').toUpperCase()} • {active.projectileType.replace('_', ' ').toUpperCase()}
                  </div>
                </div>

                <h3 className="font-display text-xl sm:text-2xl font-bold uppercase text-white mt-3.5">{active.name}</h3>
                <p className="text-xs sm:text-sm text-zinc-300 mt-1">{active.description}</p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 mt-3.5">
                  <StatBox label="Damage" value={`${effectiveDamage}${active.pelletCount > 1 ? `x${active.pelletCount}` : ''}`} />
                  <StatBox label="Rate (RPM)" value={String(active.fireRateRpm)} />
                  <StatBox label="Magazine" value={`${effectiveMag}`} />
                  <StatBox label="Reload" value={`${effectiveReload}s`} />
                </div>

                <div className="mt-4 space-y-2">
                  <div className="font-mono text-xs uppercase tracking-widest text-zinc-400">
                    Field Modifications
                  </div>
                  {UPGRADES.map((u) => {
                    const lv = levels[u.key] ?? 0;
                    const maxed = lv >= 5;
                    const cost = maxed ? 0 : UPGRADE_COSTS[lv];
                    const canAfford = !maxed && save.requisitionPoints >= cost;
                    return (
                      <div
                        key={u.key}
                        className="bg-[#0B0E11] border border-zinc-800 px-3.5 py-2 rounded-sm flex items-center justify-between gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-xs mb-1 gap-2">
                            <span className="font-medium text-zinc-100 truncate">{u.label}</span>
                            <span className="font-mono text-zinc-400 shrink-0">{u.effect} (Lv {lv}/5)</span>
                          </div>
                          <ProgressBar value={(lv / 5) * 100} className="h-1.5" />
                        </div>
                        <Button
                          size="sm"
                          variant={canAfford ? 'primary' : 'outline'}
                          disabled={!canAfford}
                          onClick={() => {
                            onUiClick();
                            upgradeWeapon(active.id, u.key);
                          }}
                          className="shrink-0 min-h-[44px] font-mono text-[11px]"
                        >
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                          {maxed ? 'MAXED' : `${cost} REQ`}
                        </Button>
                      </div>
                    );
                  })}
                </div>

                <AttachmentBenchPanel weapon={active} onUiClick={onUiClick} />
              </div>

              <div className="pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-zinc-400">
                  M67 Fragmentation Grenades included in every deployment
                </span>
                <Button
                  size="lg"
                  className="min-h-[44px]"
                  onClick={() => {
                    onUiClick();
                    onDeployWithWeapon(active.id);
                  }}
                >
                  <Play className="w-4 h-4 fill-current" /> Deploy Mission 0{selectedMissionId}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0B0E11] border border-zinc-800 px-3 py-2 rounded-sm">
      <div className="font-mono text-[10px] uppercase text-zinc-400">{label}</div>
      <div className="font-mono text-lg font-bold text-amber-400 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
