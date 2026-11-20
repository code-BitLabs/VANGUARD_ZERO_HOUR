import { ATTACHMENT_CATALOG } from '@/src/data/attachments';
import { MISSION_CATALOG } from '@/src/data/missions';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import {
  DEFAULT_EQUIPPED_ATTACHMENTS,
  ResolvedWeaponProfile,
  resolveWeaponConfig,
} from '@/src/gameplay/weapons/AttachmentCompositionEngine';
import { WeaponId } from '@/src/schemas/weapon.schema';

export interface WeaponComparativeTelemetry {
  readonly weaponId: WeaponId;
  readonly shortName: string;
  readonly category: ResolvedWeaponProfile['category'];
  readonly burstDps: number;
  readonly sustainedDpm: number;
  readonly antiArmorDps: number;
  readonly ttkInfantrySec: number;
  readonly ttkInfantryHeadshotSec: number;
  readonly ttkHeavyArmorSec: number;
  readonly effectiveRangeM: number;
  readonly handlingIndex: number; // 0..100 higher = snappier
  readonly stealthRating: number; // 0..100 higher = quieter
  readonly soundRadiusMeters: number;
  readonly totalDamagePool: number;
  readonly killsPerFullLoadInfantry: number;
}

export interface WeaponBuildComparison {
  baseline: WeaponComparativeTelemetry;
  configured: WeaponComparativeTelemetry;
  deltas: {
    burstDpsPct: number;
    sustainedDpmPct: number;
    ttkInfantryMsDelta: number;
    effectiveRangeDeltaM: number;
    handlingDelta: number;
    soundRadiusDeltaM: number;
  };
}

export interface CampaignEconomyAuditResult {
  allWeaponsDistinctAndViable: boolean;
  weaponTelemetry: WeaponComparativeTelemetry[];
  totalFiveMissionBaseReq: number;
  averageFullBuildReqCost: number;
  fieldSwapReqCost: number;
  medevacReqCost: number;
  economyBalancedWithoutGrind: boolean;
  anomalies: string[];
}

const INFANTRY_HP = 100;
const HEAVY_ARMOR_EFFECTIVE_HP = 260;

/**
 * Computes deterministic, real-math comparative combat telemetry for any resolved weapon profile (TRN-45).
 */
export function computeWeaponTelemetry(profile: ResolvedWeaponProfile): WeaponComparativeTelemetry {
  const shotDamage = profile.damage * profile.pelletCount;
  const shotsPerSec = profile.fireRateRpm / 60;
  const shotIntervalSec = 1 / Math.max(0.1, shotsPerSec);

  const burstDps = shotDamage * shotsPerSec;

  // Sustained DPM incorporates full magazine firing duration + reload duration
  const magDrainSec = Math.max(shotIntervalSec, (profile.magazineSize - 1) * shotIntervalSec);
  const cycleSec = magDrainSec + profile.reloadTimeSec;
  const sustainedDps = (shotDamage * profile.magazineSize) / Math.max(0.1, cycleSec);
  const sustainedDpm = sustainedDps * 60;

  // Anti-Armor DPS weights armor penetration and explosive splash utility
  const armorEff =
    profile.projectileType !== 'hitscan'
      ? 1.35 * Math.max(0.8, profile.armorPenetration)
      : 0.45 + profile.armorPenetration * 0.75;
  const antiArmorDps = sustainedDps * armorEff;

  // TTK calculation (first shot fires at t = 0)
  const shotsToKillInfantry = Math.max(1, Math.ceil(INFANTRY_HP / Math.max(1, shotDamage)));
  const reloadsForInfantry = Math.floor((shotsToKillInfantry - 1) / Math.max(1, profile.magazineSize));
  const ttkInfantrySec =
    (shotsToKillInfantry - 1) * shotIntervalSec + reloadsForInfantry * profile.reloadTimeSec;

  const headshotShotDamage = shotDamage * profile.headshotMultiplier;
  const headshotsToKill = Math.max(1, Math.ceil(INFANTRY_HP / Math.max(1, headshotShotDamage)));
  const ttkInfantryHeadshotSec = (headshotsToKill - 1) * shotIntervalSec;

  const heavyPerShot = Math.max(1, shotDamage * armorEff);
  const shotsToKillHeavy = Math.max(1, Math.ceil(HEAVY_ARMOR_EFFECTIVE_HP / heavyPerShot));
  const reloadsForHeavy = Math.floor((shotsToKillHeavy - 1) / Math.max(1, profile.magazineSize));
  const ttkHeavyArmorSec =
    (shotsToKillHeavy - 1) * shotIntervalSec + reloadsForHeavy * profile.reloadTimeSec;

  // Handling index [0..100] combining equip time, sprint-to-fire, and mobility
  const rawHandling =
    100 -
    profile.equipTimeSec * 48 -
    profile.sprintToFireSec * 85 +
    (profile.mobilityFactor - 0.85) * 95;
  const handlingIndex = Math.max(5, Math.min(100, Math.round(rawHandling)));

  // Stealth rating [0..100] inversely proportional to acoustic detection radius
  const stealthRating = Math.max(
    5,
    Math.min(100, Math.round(100 - ((profile.soundRadiusMeters - 12) / 65) * 95))
  );

  const totalRounds = profile.magazineSize + profile.reserveAmmo;
  const totalDamagePool = Math.round(totalRounds * shotDamage);
  const killsPerFullLoadInfantry = Number((totalRounds / shotsToKillInfantry).toFixed(1));

  return {
    weaponId: profile.id,
    shortName: profile.shortName,
    category: profile.category,
    burstDps: Math.round(burstDps),
    sustainedDpm: Math.round(sustainedDpm),
    antiArmorDps: Math.round(antiArmorDps),
    ttkInfantrySec: Number(ttkInfantrySec.toFixed(3)),
    ttkInfantryHeadshotSec: Number(ttkInfantryHeadshotSec.toFixed(3)),
    ttkHeavyArmorSec: Number(ttkHeavyArmorSec.toFixed(2)),
    effectiveRangeM: Math.round(profile.rangeMeters),
    handlingIndex,
    stealthRating,
    soundRadiusMeters: Math.round(profile.soundRadiusMeters),
    totalDamagePool,
    killsPerFullLoadInfantry,
  };
}

export function compareWeaponBuilds(
  baselineProfile: ResolvedWeaponProfile,
  configuredProfile: ResolvedWeaponProfile
): WeaponBuildComparison {
  const baseline = computeWeaponTelemetry(baselineProfile);
  const configured = computeWeaponTelemetry(configuredProfile);

  const pct = (next: number, prev: number) =>
    prev > 0 ? Math.round(((next - prev) / prev) * 100) : 0;

  return {
    baseline,
    configured,
    deltas: {
      burstDpsPct: pct(configured.burstDps, baseline.burstDps),
      sustainedDpmPct: pct(configured.sustainedDpm, baseline.sustainedDpm),
      ttkInfantryMsDelta: Math.round((configured.ttkInfantrySec - baseline.ttkInfantrySec) * 1000),
      effectiveRangeDeltaM: configured.effectiveRangeM - baseline.effectiveRangeM,
      handlingDelta: configured.handlingIndex - baseline.handlingIndex,
      soundRadiusDeltaM: configured.soundRadiusMeters - baseline.soundRadiusMeters,
    },
  };
}

/**
 * Full 9-Weapon & Progression Economy Audit (TRN-45).
 * Validates weapon specialization clarity, realistic TTK envelopes, ammo sustainability,
 * and non-grindy REQ unlock pacing across the 5-mission campaign.
 */
export function auditCampaignEconomyAndWeapons(): CampaignEconomyAuditResult {
  const anomalies: string[] = [];
  const weaponTelemetry: WeaponComparativeTelemetry[] = [];

  for (const base of WEAPON_CATALOG) {
    const resolved = resolveWeaponConfig(
      base,
      { damage: 0, recoil: 0, capacity: 0, reload: 0 },
      DEFAULT_EQUIPPED_ATTACHMENTS
    );
    const tel = computeWeaponTelemetry(resolved);
    weaponTelemetry.push(tel);

    if (tel.killsPerFullLoadInfantry < 6) {
      anomalies.push(`${base.id}: full ammo load yields only ${tel.killsPerFullLoadInfantry} infantry kills.`);
    }
    if (base.category === 'launcher' && tel.antiArmorDps < 60) {
      anomalies.push(`${base.id}: launcher anti-armor DPS too weak (${tel.antiArmorDps}).`);
    }
  }

  // Specialization invariants across roles
  const byId = new Map(weaponTelemetry.map((t) => [t.weaponId, t]));
  const smg = byId.get('smg');
  const rifle = byId.get('assault_rifle');
  const lmg = byId.get('lmg');
  const sniper = byId.get('sniper_rifle');
  const pistol = byId.get('pistol');
  const shotgun = byId.get('shotgun');

  if (smg && rifle && smg.handlingIndex <= rifle.handlingIndex) {
    anomalies.push('SMG should out-handle Assault Rifle in CQB mobility/snap.');
  }
  if (lmg && rifle && lmg.sustainedDpm <= rifle.sustainedDpm) {
    anomalies.push('LMG should exceed Assault Rifle in sustained DPM.');
  }
  if (sniper && rifle && sniper.effectiveRangeM <= rifle.effectiveRangeM) {
    anomalies.push('Sniper must exceed Assault Rifle in effective range.');
  }
  if (pistol && rifle && pistol.handlingIndex <= rifle.handlingIndex) {
    anomalies.push('Sidearm must draw/handle faster than primary rifle.');
  }
  if (shotgun && rifle && shotgun.effectiveRangeM >= rifle.effectiveRangeM) {
    anomalies.push('Shotgun effective range must remain strictly below rifle.');
  }

  // Economy balance: 500 starting REQ + ~260–340 REQ per mission clear + challenges/mastery
  const estimatedFiveMissionBaseReq =
    500 + MISSION_CATALOG.reduce((sum, m) => sum + Math.round(m.baseXpReward * 0.28), 0);
  const avgAttachmentCost =
    ATTACHMENT_CATALOG.reduce((sum, a) => sum + a.reqCost, 0) /
    Math.max(1, ATTACHMENT_CATALOG.length);
  const averageFullBuildReqCost = Math.round(avgAttachmentCost * 5);

  const fieldSwapReqCost = 60;
  const medevacReqCost = 150;
  // A single campaign clear must comfortably afford 2+ full 5-slot builds plus swaps & medevacs
  const economyBalancedWithoutGrind =
    estimatedFiveMissionBaseReq >= averageFullBuildReqCost * 2 + fieldSwapReqCost * 3 + medevacReqCost;

  if (!economyBalancedWithoutGrind) {
    anomalies.push(
      `REQ economy too tight: 5-mission base REQ (${estimatedFiveMissionBaseReq}) vs 2x full build (${averageFullBuildReqCost * 2}).`
    );
  }

  return {
    allWeaponsDistinctAndViable: anomalies.length === 0,
    weaponTelemetry,
    totalFiveMissionBaseReq: estimatedFiveMissionBaseReq,
    averageFullBuildReqCost,
    fieldSwapReqCost,
    medevacReqCost,
    economyBalancedWithoutGrind,
    anomalies,
  };
}
