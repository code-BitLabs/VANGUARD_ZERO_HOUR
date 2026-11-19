import * as THREE from 'three';
import { ENEMY_BY_ARCHETYPE } from '@/src/data/enemies';
import { formatCollisionLayer, PHYSICS_MASKS } from '@/src/engine/physics/PhysicsLayers';
import type { PhysicsBodyInspectorRow } from '@/src/engine/physics/PhysicsTypes';
import { COLLISION_LAYER } from '@/src/physics/SpatialHash';
import { AUTHORITATIVE_COMBAT_CONFIG, EnemyAwarenessState } from '@/src/schemas/combat.schema';
import { EnemyArchetype, SquadRole } from '@/src/schemas/enemy.schema';
import { MiniMapBlip } from '@/src/schemas/events.schema';
import { CombatEngagementCoordinator } from '@/src/gameplay/CombatEngagementCoordinator';
import { CombatTelemetryRecorder, EnemyDebugInspectorRow } from '@/src/gameplay/CombatTelemetryRecorder';

export interface EnemyTelemetrySource {
  id: string;
  squadId: string;
  archetype: EnemyArchetype;
  displayName: string;
  role: SquadRole;
  alive: boolean;
  state: EnemyAwarenessState;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  grounded: boolean;
  hasLos: boolean;
  losBlockerId: string | null;
  losLostDurationSec: number;
  obstructionStartSec: number | null;
  blockedShotAttempts: number;
  lastLosRecoverySec: number | null;
  detectedPlayer: boolean;
  lastKnownPosition: THREE.Vector3 | null;
  lkpTimestampSec: number;
  reactionTimerSec: number;
  fireTimer: number;
  ammoInMag: number;
  magSize: number;
  isReloading: boolean;
  hitReactTimer: number;
  lastSpreadRad: number;
  lastDamageDealt: number;
  lastDamageTimeSec: number | null;
  lastColliderHit: string | null;
  activeContacts: number;
  animFireRecoilTimer: number;
}

export function buildEnemyDebugInspectorRows(
  enemies: readonly EnemyTelemetrySource[],
  playerPos: THREE.Vector3,
  telemetry: CombatTelemetryRecorder | null,
  coordinator: CombatEngagementCoordinator | null
): EnemyDebugInspectorRow[] {
  const nowSec = telemetry?.getElapsedSec() ?? 0;
  const rows: EnemyDebugInspectorRow[] = [];

  for (let i = 0; i < enemies.length; i++) {
    const u = enemies[i];
    if (!u.alive) continue;
    const cfg = ENEMY_BY_ARCHETYPE[u.archetype];
    const dist = u.position.distanceTo(playerPos);
    const lease = coordinator?.getUnitLease(u.id) ?? null;
    const waiting = coordinator?.isUnitWaiting(u.id) ?? false;
    const stats = telemetry?.getEnemyStats(u.id) ?? { damage: 0, hits: 0, shots: 0 };

    const fovDeg =
      u.state === 'UNAWARE' || u.state === 'SUSPICIOUS' || u.state === 'INVESTIGATING'
        ? AUTHORITATIVE_COMBAT_CONFIG.primaryFovDeg
        : AUTHORITATIVE_COMBAT_CONFIG.alertedFovDeg;

    const tokenStatus = lease ? lease.kind : waiting ? 'WAITING' : 'NONE';

    rows.push({
      id: u.id,
      displayName: u.displayName,
      squadId: u.squadId,
      domain: 'ground',
      role: u.role,
      state: u.state,
      detectedPlayer: u.detectedPlayer,
      hasLos: u.hasLos,
      losBlockerId: u.losBlockerId,
      distanceMeters: Number(dist.toFixed(1)),
      x: Number(u.position.x.toFixed(1)),
      y: Number(u.position.y.toFixed(1)),
      z: Number(u.position.z.toFixed(1)),
      yaw: u.yaw,
      fovDeg,
      detectionRange: cfg.detectionRange,
      hearingRange: AUTHORITATIVE_COMBAT_CONFIG.hearingSprintMeters,
      lkpX: u.lastKnownPosition ? Number(u.lastKnownPosition.x.toFixed(1)) : null,
      lkpY: u.lastKnownPosition ? Number(u.lastKnownPosition.y.toFixed(1)) : null,
      lkpZ: u.lastKnownPosition ? Number(u.lastKnownPosition.z.toFixed(1)) : null,
      lkpAgeSec: u.lastKnownPosition
        ? Number(Math.max(0, nowSec - u.lkpTimestampSec).toFixed(1))
        : 0,
      reactionTimerSec: Number(u.reactionTimerSec.toFixed(2)),
      fireCooldownSec: Number(u.fireTimer.toFixed(2)),
      ammoInMag: u.ammoInMag,
      magSize: u.magSize,
      isReloading: u.isReloading,
      currentSpreadDeg: Number(((u.lastSpreadRad * 180) / Math.PI).toFixed(2)),
      accuracyPct:
        stats.shots > 0
          ? Number(((stats.hits / stats.shots) * 100).toFixed(0))
          : Math.round(cfg.accuracy * 100),
      tokenStatus,
      allowedToFire:
        Boolean(lease) &&
        (lease?.kind === 'SUPPRESS' ? !u.hasLos : u.hasLos) &&
        !u.isReloading &&
        u.hitReactTimer <= 0,
      blockedByCover: !u.hasLos && u.losBlockerId !== null,
      shotsFired: stats.shots,
      shotsHit: stats.hits,
      totalDamageDealt: Number(stats.damage.toFixed(1)),
      lastDamageAmount: Number(u.lastDamageDealt.toFixed(1)),
      lastDamageTimeSec:
        u.lastDamageTimeSec !== null ? Number(u.lastDamageTimeSec.toFixed(1)) : null,
      obstructionDurationSec:
        u.obstructionStartSec !== null
          ? Number(Math.max(0, nowSec - u.obstructionStartSec).toFixed(2))
          : 0,
      blockedShotAttempts: u.blockedShotAttempts,
      lastLosRecoverySec: u.lastLosRecoverySec,
    });
  }

  return rows;
}

export function fillEnemyMiniMapBlips(
  enemies: readonly EnemyTelemetrySource[],
  blipPool: MiniMapBlip[],
  out: MiniMapBlip[],
  playerPos?: THREE.Vector3
): void {
  let slotIdx = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;

    const dist = playerPos
      ? Math.hypot(e.position.x - playerPos.x, e.position.z - playerPos.z)
      : 0;

    let detectionSource: NonNullable<MiniMapBlip['detectionSource']> = 'recon';
    let confidence = 0.9;
    let ageSec = 0;

    if (e.hasLos || e.state === 'ENGAGING') {
      detectionSource = 'los';
      confidence = 1.0;
      ageSec = 0;
    } else if (e.animFireRecoilTimer > 0 || e.state === 'SUPPRESSING') {
      detectionSource = 'acoustic';
      confidence = 0.85;
      ageSec = 0.2;
    } else if (
      e.detectedPlayer ||
      e.state === 'ALERTED' ||
      e.state === 'REPOSITIONING' ||
      (playerPos ? dist <= 26 : e.losBlockerId === null)
    ) {
      detectionSource = 'recon';
      confidence = 0.9;
      ageSec = 0;
    } else if (e.lastKnownPosition !== null && e.losLostDurationSec < 5.5) {
      detectionSource = 'stale';
      confidence = Number(Math.max(0.25, 0.75 * (1 - e.losLostDurationSec / 5.5)).toFixed(2));
      ageSec = Number(e.losLostDurationSec.toFixed(1));
    } else {
      continue;
    }

    const elevDelta = playerPos ? Number((e.position.y - playerPos.y).toFixed(1)) : 0;
    const elevCode: NonNullable<MiniMapBlip['elevationCode']> =
      elevDelta > 2.2 ? 'above' : elevDelta < -2.2 ? 'below' : 'same';

    let slot = blipPool[slotIdx];
    if (!slot) {
      slot = {
        id: e.id,
        x: e.position.x,
        y: e.position.y,
        z: e.position.z,
        kind: 'enemy',
        elevationDeltaM: elevDelta,
        elevationCode: elevCode,
        detectionSource,
        confidence,
        ageSec,
      };
      blipPool.push(slot);
    } else {
      slot.id = e.id;
      slot.x = e.position.x;
      slot.y = e.position.y;
      slot.z = e.position.z;
      slot.kind = 'enemy';
      slot.elevationDeltaM = elevDelta;
      slot.elevationCode = elevCode;
      slot.detectionSource = detectionSource;
      slot.confidence = confidence;
      slot.ageSec = ageSec;
    }
    out.push(slot);
    slotIdx++;
  }
}

export function buildEnemyPhysicsInspectorRows(
  enemies: readonly EnemyTelemetrySource[]
): PhysicsBodyInspectorRow[] {
  const out: PhysicsBodyInspectorRow[] = [];
  for (let i = 0; i < enemies.length; i++) {
    const u = enemies[i];
    if (!u.alive) continue;
    const spd = Math.hypot(u.velocity.x, u.velocity.z);
    out.push({
      id: u.id,
      entityType: 'enemy',
      classification: 'character',
      shape: 'capsule',
      dimensions: 'r=0.40m h=1.75m',
      x: Number(u.position.x.toFixed(2)),
      y: Number(u.position.y.toFixed(2)),
      z: Number(u.position.z.toFixed(2)),
      yaw: Number(u.yaw.toFixed(2)),
      vx: Number(u.velocity.x.toFixed(2)),
      vy: Number(u.velocity.y.toFixed(2)),
      vz: Number(u.velocity.z.toFixed(2)),
      ax: 0,
      ay: 0,
      az: 0,
      speed: Number(spd.toFixed(2)),
      massKg: 80,
      layer: COLLISION_LAYER.ENEMY,
      layerLabel: formatCollisionLayer(COLLISION_LAYER.ENEMY),
      mask: PHYSICS_MASKS.ENEMY_SOLID,
      maskLabel: formatCollisionLayer(PHYSICS_MASKS.ENEMY_SOLID),
      physicalState: u.grounded ? 'GROUNDED' : 'AIRBORNE',
      lastCollisionId: u.lastColliderHit,
      lastNormalX: 0,
      lastNormalY: 1,
      lastNormalZ: 0,
      contactCount: u.activeContacts,
    });
  }
  return out;
}
