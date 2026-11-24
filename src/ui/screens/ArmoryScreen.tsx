import React, { useState, useTransition } from 'react';
import { ArrowUpCircle, Play } from 'lucide-react';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { WeaponId, WeaponUpgradeKey } from '@/src/schemas/weapon.schema';
import { UPGRADE_COSTS, useProgressionStore } from '@/src/stores/progressionStore';
import { useMissionSelectionStore } from '@/src/stores/missionSelectionStore';
import { ArmoryWeaponStage3D } from '@/src/ui/components/ArmoryWeaponStage3D';
import { WeaponSilhouette } from '@/src/ui/components/WeaponSilhouette';
import { Button } from '@/src/ui/primitives/Button';
import { Card, CardContent } from '@/src/ui/primitives/Card';
import { ProgressBar } from '@/src/ui/primitives/Controls';
import { CommandHQTopBar } from '@/src/ui/shell/CommandHQTopBar';
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
  isSoftwareGl = false,
  hardwareBadge = null,
}: {
  onDeployWithWeapon: (weaponId: WeaponId) => void;
  onUiClick: () => void;
  isSoftwareGl?: boolean;
  hardwareBadge?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<WeaponId>('assault_rifle');
  const [, startWeaponTransition] = useTransition();
  const save = useProgressionStore((s) => s.save);
  const upgradeWeapon = useProgressionStore((s) => s.upgradeWeapon);
  const selectedMissionId = useMissionSelectionStore((s) => s.selectedMissionId);
  const difficulty = useMissionSelectionStore((s) => s.difficulty);
  const deploymentMode = useMissionSelectionStore((s) =>
    s.getDeploymentModeForMission(s.selectedMissionId)
  );

  const active = WEAPON_CATALOG.find((w) => w.id === selectedId) ?? WEAPON_CATALOG[0];
  const levels = save.weaponUpgrades[active.id] ?? { damage: 0, recoil: 0, capacity: 0, reload: 0 };
  const equippedAttachments = save.weaponAttachments?.[active.id] ?? {};

  const effectiveDamage = Math.round(active.damage * (1 + levels.damage * 0.09));
  const effectiveMag = Math.round(active.magazineSize * (1 + levels.capacity * 0.1));
  const effectiveReload = (
    active.reloadTimeSec * Math.max(0.58, 1 - levels.reload * 0.08)
  ).toFixed(2);

  return (
    <div
      className="fixed inset-0 z-20 bg-[var(--vg-bg-canvas)]/96 flex flex-col overflow-y-auto"
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="max-w-6xl w-full mx-auto flex flex-col gap-3 sm:gap-4 [@media(max-height:520px)]:gap-2.5 flex-1">
        <CommandHQTopBar
          activeSection="armory"
          subtitle="All 9 Arsenal Slots & M67 Ordnance"
          title="Tactical Armory"
          hardwareBadge={hardwareBadge}
          onUiClick={onUiClick}
        />

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 [@media(max-height:520px)]:gap-2.5 flex-1">
          {/* Weapon Roster: compact horizontal rail on portrait phones, sticky left sidebar from 640px+ */}
          <div
            data-testid="armory-weapon-roster"
            className="sm:col-span-4 md:col-span-5 flex sm:grid sm:grid-cols-1 gap-1.5 sm:gap-2 overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0 content-start sm:sticky sm:top-0 sm:self-start sm:max-h-[calc(100dvh-108px)] [@media(max-height:520px)]:sm:max-h-[calc(100dvh-76px)] sm:overflow-y-auto sm:pr-1 no-scrollbar"
          >
            {WEAPON_CATALOG.map((w) => {
              const activeCard = w.id === active.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={activeCard}
                  onClick={() => {
                    onUiClick();
                    startWeaponTransition(() => {
                      setSelectedId(w.id);
                    });
                  }}
                  className={`flex items-center justify-between gap-2 shrink-0 sm:shrink min-w-[144px] sm:min-w-0 min-h-[48px] [@media(max-height:520px)]:min-h-[42px] px-2.5 sm:px-3 [@media(max-height:520px)]:px-2.5 py-1.5 sm:py-2 rounded-sm border text-left transition-colors cursor-pointer ${
                    activeCard
                      ? 'bg-[var(--vg-bg-elevated)] border-[var(--vg-accent-amber)]'
                      : 'bg-[var(--vg-bg-panel)] border-[var(--vg-border-subtle)] hover:border-[var(--vg-border-strong)]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[9.5px] sm:text-[10px] text-[var(--vg-accent-amber)] uppercase tracking-wider truncate">
                      S{w.slot} · {w.category}
                    </div>
                    <div className="font-display text-xs sm:text-sm font-bold uppercase text-[var(--vg-text-primary)] truncate">
                      {w.name}
                    </div>
                  </div>
                  <WeaponSilhouette
                    weaponId={w.id}
                    className="w-11 sm:w-14 md:w-16 h-5 sm:h-6 text-[var(--vg-text-secondary)] shrink-0"
                  />
                </button>
              );
            })}
          </div>

          {/* Interactive 3D Weapon Inspection Stage, Telemetry & Modifications */}
          <Card className="sm:col-span-8 md:col-span-7 flex flex-col min-w-0">
            <CardContent className="flex flex-col justify-between gap-3.5 sm:gap-5 [@media(max-height:520px)]:p-3 flex-1">
              <div>
                <ArmoryWeaponStage3D
                  weaponId={active.id}
                  weaponName={active.name}
                  subtitle={`${active.fireModes.join(' / ').toUpperCase()} · ${active.projectileType.replace('_', ' ').toUpperCase()}`}
                  equippedAttachments={equippedAttachments}
                  isSoftwareGl={isSoftwareGl}
                />

                <h3 className="font-display text-lg sm:text-2xl font-bold uppercase text-[var(--vg-text-primary)] mt-3">
                  {active.name}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--vg-text-secondary)] mt-1">
                  {active.description}
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 mt-3.5">
                  <StatBox
                    label="Damage"
                    value={`${effectiveDamage}${active.pelletCount > 1 ? `x${active.pelletCount}` : ''}`}
                  />
                  <StatBox label="Rate (RPM)" value={String(active.fireRateRpm)} />
                  <StatBox label="Magazine" value={`${effectiveMag}`} />
                  <StatBox label="Reload" value={`${effectiveReload}s`} />
                </div>

                <div className="mt-4 space-y-2">
                  <div className="font-mono text-xs uppercase tracking-widest text-[var(--vg-text-muted)]">
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
                        className="bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] px-3.5 py-2 rounded-sm flex items-center justify-between gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-xs mb-1 gap-2">
                            <span className="font-medium text-[var(--vg-text-primary)] truncate">
                              {u.label}
                            </span>
                            <span className="font-mono text-[var(--vg-text-muted)] shrink-0 tabular-nums">
                              {u.effect} (Lv {lv}/5)
                            </span>
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

              <div className="pt-3 border-t border-[var(--vg-border-subtle)] flex flex-wrap items-center justify-between gap-3">
                <div className="font-mono text-[11px] text-[var(--vg-text-muted)] space-y-0.5">
                  <div className="text-[var(--vg-accent-cyan)] uppercase tracking-wider">
                    Op 0{selectedMissionId} · {difficulty.toUpperCase()} ·{' '}
                    {deploymentMode === 'solo' ? 'SOLO OPERATOR' : 'FIRETEAM SQUAD'}
                  </div>
                  <div>M67 Fragmentation Grenades included in every deployment</div>
                </div>
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
    <div className="bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] px-3 py-2 rounded-sm">
      <div className="font-mono text-[10px] uppercase text-[var(--vg-text-muted)]">{label}</div>
      <div className="font-mono text-lg font-bold text-[var(--vg-accent-amber)] tabular-nums mt-0.5">
        {value}
      </div>
    </div>
  );
}
