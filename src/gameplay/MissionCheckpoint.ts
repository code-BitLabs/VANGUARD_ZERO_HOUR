import * as THREE from 'three';
import { CollisionWorld } from '@/src/physics/CollisionWorld';
import { Difficulty } from '@/src/schemas/common.schema';
import {
  MissionConfig,
  ObjectiveActionMetadata,
  ObjectiveType,
} from '@/src/schemas/mission.schema';
import { SustainmentEconomySnapshot } from './SustainmentEconomyManager';
import { WeaponId } from '@/src/schemas/weapon.schema';

export interface MissionAttemptContext {
  missionId: number;
  difficulty: Difficulty;
  cumulativeElapsedSec: number;
  checkpointDeathsCount: number;
}

export interface WeaponAmmoRecord {
  mag: number;
  reserve: number;
}

export interface CheckpointSpawnPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  surfaceY?: number;
  normalizedFromLiftId?: string;
}

export interface MissionCheckpointSnapshot {
  missionId: number;
  difficulty: Difficulty;
  checkpointSequence: number;
  activeObjectiveIndex: number;
  activeStageIndex?: number;
  completedObjectiveIds: string[];
  bypassedObjectiveIds?: string[];
  destroyedTargetIds?: string[];
  sustainmentSnapshot?: SustainmentEconomySnapshot;
  playerSpawn: CheckpointSpawnPose;
  healthAtCheckpoint: number;
  armorAtCheckpoint: number;
  grenadesAtCheckpoint?: number;
  c4AtCheckpoint?: number;
  activeWeaponId: WeaponId;
  weaponAmmoState: Partial<Record<WeaponId, WeaponAmmoRecord>>;
  scoreAtCheckpoint: number;
  killsAtCheckpoint: number;
  headshotsAtCheckpoint: number;
  airKillsAtCheckpoint: number;
}

export interface CheckpointHazardPoint {
  x: number;
  z: number;
}

const MIN_CHECKPOINT_HEALTH = 75;
const MIN_CHECKPOINT_ARMOR = 50;
const MIN_HAZARD_SEPARATION_M = 8.0;
const RADIAL_SEARCH_RADII = [2.5, 5.0, 7.5] as const;

const _clearancePos = new THREE.Vector3();

export function clampCheckpointVitals(
  rawHealth: number,
  rawArmor: number,
  maxHealth = 100,
  maxArmor = 100
): { health: number; armor: number } {
  const safeMaxHealth = Math.max(MIN_CHECKPOINT_HEALTH, Math.round(maxHealth));
  const safeMaxArmor = Math.max(MIN_CHECKPOINT_ARMOR, Math.round(maxArmor));
  const safeHealth = Number.isFinite(rawHealth) ? rawHealth : MIN_CHECKPOINT_HEALTH;
  const safeArmor = Number.isFinite(rawArmor) ? rawArmor : MIN_CHECKPOINT_ARMOR;
  return {
    health: Math.min(safeMaxHealth, Math.max(MIN_CHECKPOINT_HEALTH, Math.round(safeHealth))),
    armor: Math.min(safeMaxArmor, Math.max(MIN_CHECKPOINT_ARMOR, Math.round(safeArmor))),
  };
}

const STAGE_ANCHORS_BY_MISSION: Record<number, Record<number, CheckpointSpawnPose>> = {
  1: {
    1: { x: 0, y: 1.7, z: 8, yaw: 0 },
    2: { x: 0, y: 1.7, z: 12, yaw: 0 },
  },
  2: {
    1: { x: 0, y: 1.7, z: -8, yaw: 0 },
    2: { x: 0, y: 1.7, z: -14, yaw: 0 },
  },
  3: {
    1: { x: 0, y: 1.7, z: 26, yaw: 0 },
    2: { x: 0, y: 1.7, z: 14, yaw: 0 },
  },
  4: {
    // North of the central river bridge so players resume safely past the crossing
    1: { x: 0, y: 1.7, z: 2, yaw: 0 },
    2: { x: 0, y: 1.7, z: -6, yaw: 0 },
  },
  5: {
    1: { x: 0, y: 1.7, z: 28, yaw: 0 },
    2: { x: 0, y: 1.7, z: 8, yaw: 0 },
    3: { x: 0, y: 1.7, z: -28, yaw: 0 },
  },
};

export function selectMissionCheckpointAnchor(
  mission: MissionConfig,
  activeObjectiveIndex: number
): CheckpointSpawnPose {
  if (activeObjectiveIndex <= 0 || activeObjectiveIndex >= mission.objectives.length) {
    return {
      x: mission.playerSpawn.x,
      y: mission.playerSpawn.y,
      z: mission.playerSpawn.z,
      yaw: mission.playerYaw,
    };
  }

  const curated = STAGE_ANCHORS_BY_MISSION[mission.id]?.[activeObjectiveIndex];
  if (curated) {
    return { ...curated };
  }

  const activeObj = mission.objectives[activeObjectiveIndex];
  const stagedZ = Math.max(-92, Math.min(92, activeObj.markerPos.z + 14));
  const stagedX = Math.max(-92, Math.min(92, activeObj.markerPos.x));
  return {
    x: stagedX,
    y: mission.playerSpawn.y,
    z: stagedZ,
    yaw: 0,
  };
}

export function isWeaponRelevantForCheckpointAmmoFloor(
  weaponId: WeaponId,
  mission: MissionConfig,
  incompleteObjectives: ReadonlyArray<{
    type: ObjectiveType;
    actionMeta?: ObjectiveActionMetadata;
  }>,
  activeWeaponId: WeaponId
): boolean {
  if (weaponId === activeWeaponId || weaponId === 'pistol') {
    return true;
  }
  if (mission.recommendedLoadout.includes(weaponId)) {
    return true;
  }
  if (weaponId === 'rocket_launcher' || weaponId === 'guided_missile') {
    return incompleteObjectives.some(
      (obj) =>
        obj.type === 'air_defense' ||
        obj.type === 'convoy_intercept' ||
        obj.type === 'destroy_targets' ||
        obj.type === 'plant_charge' ||
        obj.actionMeta?.recommendedSlot === 7 ||
        obj.actionMeta?.recommendedSlot === 8
    );
  }
  return false;
}

function isSpawnPoseSafe(
  candX: number,
  candFeetHintY: number,
  candZ: number,
  yaw: number,
  collisionWorld: CollisionWorld,
  hazards: ReadonlyArray<CheckpointHazardPoint>,
  normalizedFromLiftId?: string
): CheckpointSpawnPose | null {
  if (!Number.isFinite(candX) || !Number.isFinite(candZ)) return null;
  if (Math.abs(candX) > 100 || Math.abs(candZ) > 100) return null;

  const supportY =
    candFeetHintY > 0.4
      ? collisionWorld.getSupportHeightAt(candX, candFeetHintY + 0.6, candZ, 1.75, 0.65, 45)
      : collisionWorld.getGroundHeightAt(candX, candZ);
  _clearancePos.set(candX, supportY, candZ);
  if (!collisionWorld.canStandUp(_clearancePos, 0.45, 1.75, 'player')) {
    return null;
  }

  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    if (Math.hypot(candX - h.x, candZ - h.z) < MIN_HAZARD_SEPARATION_M) {
      return null;
    }
  }

  return {
    x: candX,
    y: supportY + 1.7,
    z: candZ,
    yaw,
    surfaceY: supportY,
    normalizedFromLiftId,
  };
}

export function validateSafeCheckpointSpawn(
  primaryAnchor: CheckpointSpawnPose,
  fallbackSpawn: CheckpointSpawnPose,
  collisionWorld: CollisionWorld,
  hazards: ReadonlyArray<CheckpointHazardPoint>
): CheckpointSpawnPose {
  const feetHintY = primaryAnchor.surfaceY ?? Math.max(0, primaryAnchor.y - 1.7);
  const direct = isSpawnPoseSafe(
    primaryAnchor.x,
    feetHintY,
    primaryAnchor.z,
    primaryAnchor.yaw,
    collisionWorld,
    hazards,
    primaryAnchor.normalizedFromLiftId
  );
  if (direct) return direct;

  for (let rIdx = 0; rIdx < RADIAL_SEARCH_RADII.length; rIdx++) {
    const r = RADIAL_SEARCH_RADII[rIdx];
    for (let step = 0; step < 8; step++) {
      const angle = (step * Math.PI) / 4;
      const candX = primaryAnchor.x + Math.cos(angle) * r;
      const candZ = primaryAnchor.z + Math.sin(angle) * r;
      const safe = isSpawnPoseSafe(
        candX,
        feetHintY,
        candZ,
        primaryAnchor.yaw,
        collisionWorld,
        hazards,
        primaryAnchor.normalizedFromLiftId
      );
      if (safe) return safe;
    }
  }

  const fbFeetHint = fallbackSpawn.surfaceY ?? Math.max(0, fallbackSpawn.y - 1.7);
  const fbGroundY =
    fbFeetHint > 0.4
      ? collisionWorld.getSupportHeightAt(fallbackSpawn.x, fbFeetHint + 0.6, fallbackSpawn.z, 1.75, 0.65, 45)
      : collisionWorld.getGroundHeightAt(fallbackSpawn.x, fallbackSpawn.z);
  return {
    x: fallbackSpawn.x,
    y: Math.max(fallbackSpawn.y, fbGroundY + 1.7),
    z: fallbackSpawn.z,
    yaw: fallbackSpawn.yaw,
    surfaceY: fbGroundY,
  };
}
