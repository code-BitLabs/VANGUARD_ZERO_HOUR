import * as THREE from 'three';
import { EnemyArchetype } from '@/src/schemas/enemy.schema';
import { MusicMood } from '@/src/audio/MusicCatalog';
import {
  BattlefieldIntelligenceBoard,
  TelegraphedCounterDirective,
} from '@/src/gameplay/ai/BattlefieldIntelligenceBoard';
import { MissionConsequenceModifiers } from '@/src/gameplay/campaign/CampaignEventLedger';
import {
  getMissionBalanceProfile,
  resolveConsequenceWaveMutation,
} from '@/src/gameplay/campaign/CampaignBalanceProfile';

export type EncounterPhase =
  | 'OPENING_PUSH'
  | 'RESUPPLY_BREATHER'
  | 'SET_PIECE_ESCALATION'
  | 'CLIMAX_BOSS'
  | 'EXTRACTION_PURSUIT';

export type AdaptiveMusicState =
  | 'deployment'
  | 'recon'
  | 'combat'
  | 'climax'
  | 'extraction'
  | 'debrief';

export interface ReinforcementWaveSpec {
  archetype: EnemyArchetype;
  count: number;
  spawnPos: { x: number; y: number; z: number };
  radius: number;
  radioCallout: string;
}

export interface SearchlightTowerState {
  id: string;
  origin: THREE.Vector3;
  baseYaw: number;
  sweepAmpRad: number;
  sweepSpeedRadPerSec: number;
  rangeMeters: number;
  halfConeRad: number;
  currentYaw: number;
  destroyed: boolean;
  spotPos: THREE.Vector3;
}

export interface SlagHazardZone {
  id: string;
  center: THREE.Vector3;
  radius: number;
  dps: number;
  active: boolean;
}

export interface EncounterTickInput {
  dt: number;
  elapsedSec: number;
  missionId: number;
  activeStageIndex: number;
  totalStages: number;
  extractionAvailable: boolean;
  aliveEnemies: number;
  anyEnemyHasLos: boolean;
  hasActiveBoss: boolean;
  playerPos: THREE.Vector3;
  playerAlive: boolean;
  playerInVehicle: boolean;
  friendlySuppressorActive?: boolean;
}

export interface EncounterTickOutput {
  phase: EncounterPhase;
  adaptiveMusicState: AdaptiveMusicState;
  recommendedMood: MusicMood;
  alertText: string | null;
  subtitleText: string | null;
  triggeredSetPieceId: string | null;
  searchlightDetectedPlayer: boolean;
  environmentalHazardDamage: number;
  environmentalHazardLabel: string | null;
  reinforcementSpec: ReinforcementWaveSpec | null;
  telegraphedCounter?: TelegraphedCounterDirective | null;
}

interface MissionReinforcementProfile {
  stage1: Array<{ archetype: EnemyArchetype; x: number; y: number; z: number; callout: string }>;
  stage2: Array<{ archetype: EnemyArchetype; x: number; y: number; z: number; callout: string }>;
  stage3: Array<{ archetype: EnemyArchetype; x: number; y: number; z: number; callout: string }>;
}

const MISSION_REINFORCEMENT_PROFILES: Record<number, MissionReinforcementProfile> = {
  1: {
    stage1: [
      { archetype: 'infantry', x: -16, y: 0, z: -8, callout: 'Hostile boulevard rifle squad advancing through smoke.' },
      { archetype: 'elite_assault', x: 18, y: 0, z: -14, callout: 'Spec-Ops raiders flanking the east financial colonnade.' },
    ],
    stage2: [
      { archetype: 'rocket_trooper', x: 22, y: 0, z: -26, callout: 'Enemy AT-specialists deploying to defend the AA radar relays.' },
      { archetype: 'elite_assault', x: -20, y: 0, z: -20, callout: 'Urban counter-assault team breaching from north avenue.' },
    ],
    stage3: [
      { archetype: 'infantry', x: 0, y: 0, z: -32, callout: 'Ground support moving beneath the gunship corridor.' },
    ],
  },
  2: {
    stage1: [
      { archetype: 'vehicle_crew', x: 12, y: 0, z: -12, callout: 'Convoy escort gunners dismounting along Highway 14.' },
      { archetype: 'rocket_trooper', x: -16, y: 0, z: -18, callout: 'Desert anti-armor team taking positions on the west berm.' },
    ],
    stage2: [
      { archetype: 'heavy_armor', x: 18, y: 0, z: -40, callout: 'Heavy juggernauts reinforcing the refinery fuel depot.' },
      { archetype: 'infantry', x: -20, y: 0, z: -38, callout: 'Compound garrison counter-attacking from west bunkers.' },
    ],
    stage3: [
      { archetype: 'elite_assault', x: 0, y: 0, z: -48, callout: 'Desert quick-reaction raiders sweeping the inner yard.' },
    ],
  },
  3: {
    stage1: [
      { archetype: 'drone_operator', x: -18, y: 0, z: -16, callout: 'Night-ops drone operators setting up relays in the plaza.' },
      { archetype: 'sniper', x: 22, y: 0, z: -24, callout: 'Thermal spotters taking night overwatch positions.' },
    ],
    stage2: [
      { archetype: 'elite_assault', x: -14, y: 0, z: -28, callout: 'Night raiders converging beneath rotorcraft cover.' },
      { archetype: 'drone_operator', x: 18, y: 0, z: -20, callout: 'Hostile telemetry team reinforcing midnight air screen.' },
    ],
    stage3: [
      { archetype: 'elite_assault', x: 0, y: 0, z: -22, callout: 'Final ground relay defenders collapsing on the plaza.' },
    ],
  },
  4: {
    stage1: [
      { archetype: 'infantry', x: -16, y: 0, z: 4, callout: 'Camouflaged river patrols moving to contest the bridges.' },
      { archetype: 'sniper', x: 20, y: 0, z: -8, callout: 'Canopy marksmen shifting along the northern ridge.' },
    ],
    stage2: [
      { archetype: 'heavy_armor', x: -16, y: 0, z: -30, callout: 'Heavy jungle enforcers moving to shield the munitions caches.' },
      { archetype: 'drone_operator', x: 16, y: 0, z: -26, callout: 'Outpost recon team launching canopy sweeps.' },
    ],
    stage3: [
      { archetype: 'elite_assault', x: 0, y: 0, z: -34, callout: 'Jungle counterattack squad pushing under helicopter cover.' },
    ],
  },
  5: {
    stage1: [
      { archetype: 'elite_assault', x: -18, y: 0, z: 4, callout: 'Foundry shock troopers moving along the slag floor.' },
      { archetype: 'heavy_armor', x: 18, y: 0, z: -8, callout: 'Armored siege juggernauts entering the steel bay.' },
    ],
    stage2: [
      { archetype: 'rocket_trooper', x: -20, y: 0, z: -22, callout: 'AT teams locking down the foundry catwalk approaches.' },
      { archetype: 'heavy_armor', x: 14, y: 0, z: -26, callout: 'Heavy foundry guard advancing through the central aisle.' },
    ],
    stage3: [
      { archetype: 'elite_assault', x: 0, y: 0, z: -44, callout: 'Pursuit squads moving to seal the north extraction tunnel!' },
    ],
  },
};

export function mapAdaptiveMusicStateToMood(state: AdaptiveMusicState): MusicMood {
  switch (state) {
    case 'deployment':
      return 'calm_deployment';
    case 'recon':
      return 'atmospheric_exploration';
    case 'combat':
      return 'combat_intensity';
    case 'climax':
    case 'extraction':
      return 'mission_climax';
    case 'debrief':
      return 'tactical_atmosphere';
  }
}

/**
 * Orchestrates distinct mission identities, encounter pacing curves, live gameplay set pieces
 * (M3 sweeping searchlights, M4 bridgehead ambush, M5 molten slag hazards & extraction pursuit),
 * and mission-tailored reinforcement compositions (TRN-30).
 */
export class EncounterDirector {
  readonly intelBoard = new BattlefieldIntelligenceBoard();
  private missionId = 1;
  private phase: EncounterPhase = 'OPENING_PUSH';
  private triggeredSetPieces = new Set<string>();
  private waveCycleIndex = 0;
  private lastStageIndex = 1;
  private breatherRemainingSec = 0;
  private combatCalmTimerSec = 0;
  private searchlightAlertCooldownSec = 0;
  private hazardTickAccum = 0;
  private optionalObjectivesCompleted = new Set<string>();
  private searchlights: SearchlightTowerState[] = [];
  private slagHazards: SlagHazardZone[] = [];
  private campaignModifiers: MissionConsequenceModifiers | null = null;
  private deploymentMode: 'solo' | 'fireteam' = 'fireteam';

  reset(
    missionId: number,
    campaignModifiers?: MissionConsequenceModifiers | null,
    deploymentMode: 'solo' | 'fireteam' = 'fireteam'
  ): void {
    this.missionId = missionId;
    this.phase = 'OPENING_PUSH';
    this.triggeredSetPieces.clear();
    this.waveCycleIndex = 0;
    this.lastStageIndex = 1;
    this.breatherRemainingSec = 0;
    this.combatCalmTimerSec = 0;
    this.searchlightAlertCooldownSec = 0;
    this.hazardTickAccum = 0;
    this.optionalObjectivesCompleted.clear();
    this.searchlights = [];
    this.slagHazards = [];
    this.campaignModifiers = campaignModifiers ?? null;
    this.deploymentMode = deploymentMode;
    this.intelBoard.reset(campaignModifiers?.enemyCommsDelayMult ?? 1.0);

    if (missionId === 3) {
      this.searchlights = [
        {
          id: 'm3_searchlight_west',
          origin: new THREE.Vector3(-18, 9.5, -14),
          baseYaw: 0.45,
          sweepAmpRad: 0.72,
          sweepSpeedRadPerSec: 0.65,
          rangeMeters: 34,
          halfConeRad: 0.24,
          currentYaw: 0.45,
          destroyed: false,
          spotPos: new THREE.Vector3(-8, 0.1, 4),
        },
        {
          id: 'm3_searchlight_east',
          origin: new THREE.Vector3(18, 9.5, -16),
          baseYaw: -0.45,
          sweepAmpRad: 0.72,
          sweepSpeedRadPerSec: 0.58,
          rangeMeters: 34,
          halfConeRad: 0.24,
          currentYaw: -0.45,
          destroyed: false,
          spotPos: new THREE.Vector3(8, 0.1, 2),
        },
      ];
    } else if (missionId === 5) {
      this.slagHazards = [
        { id: 'm5_slag_west', center: new THREE.Vector3(-22, 0, -2), radius: 4.3, dps: 16, active: true },
        { id: 'm5_slag_east', center: new THREE.Vector3(22, 0, -2), radius: 4.3, dps: 16, active: true },
      ];
    }
  }

  getPhase(): EncounterPhase {
    return this.phase;
  }

  getSearchlights(): readonly SearchlightTowerState[] {
    return this.searchlights;
  }

  getSlagHazards(): readonly SlagHazardZone[] {
    return this.slagHazards;
  }

  markSearchlightDestroyed(towerId: string): boolean {
    const target = this.searchlights.find((s) => s.id === towerId);
    if (!target || target.destroyed) return false;
    target.destroyed = true;
    return true;
  }

  areAllSearchlightsDisabled(): boolean {
    return this.searchlights.length > 0 && this.searchlights.every((s) => s.destroyed);
  }

  recordOptionalObjectiveCompleted(objectiveId: string): boolean {
    if (this.optionalObjectivesCompleted.has(objectiveId)) return false;
    this.optionalObjectivesCompleted.add(objectiveId);
    return true;
  }

  getOptionalObjectivesCompletedCount(): number {
    return this.optionalObjectivesCompleted.size;
  }

  getCompletedOptionalObjectiveIds(): string[] {
    return Array.from(this.optionalObjectivesCompleted);
  }

  hasTriggeredSetPiece(id: string): boolean {
    return this.triggeredSetPieces.has(id);
  }

  selectReinforcementWave(
    missionId: number,
    activeStageIndex: number,
    requestedCount: number
  ): ReinforcementWaveSpec {
    const prof = MISSION_REINFORCEMENT_PROFILES[missionId] ?? MISSION_REINFORCEMENT_PROFILES[1];
    const pool =
      activeStageIndex <= 1 ? prof.stage1 : activeStageIndex === 2 ? prof.stage2 : prof.stage3;
    const entry = pool[this.waveCycleIndex % pool.length];
    this.waveCycleIndex++;

    const mutation = resolveConsequenceWaveMutation({
      missionId,
      stageIndex: activeStageIndex,
      baseArchetype: entry.archetype,
      consequences: this.campaignModifiers,
    });

    const finalArchetype = mutation.archetypeOverride ?? entry.archetype;
    const rawCount = Math.max(1, Math.min(4, requestedCount + mutation.countDelta));
    const soloStaggerDelta = this.deploymentMode === 'solo' && rawCount >= 3 ? -1 : 0;
    const finalCount = Math.max(1, rawCount + soloStaggerDelta);
    const calloutPrefix = mutation.calloutPrefix
      ? mutation.calloutPrefix
      : this.deploymentMode === 'solo'
        ? '[TELEGRAPH]'
        : '';
    const finalCallout = calloutPrefix
      ? `${calloutPrefix} ${entry.callout}`
      : entry.callout;

    return {
      archetype: finalArchetype,
      count: finalCount,
      spawnPos: {
        x: entry.x + mutation.spawnOffsetX,
        y: entry.y,
        z: entry.z + mutation.spawnOffsetZ,
      },
      radius: 10,
      radioCallout: finalCallout,
    };
  }

  update(input: EncounterTickInput): EncounterTickOutput {
    const safeDt = Math.max(0, Math.min(0.25, input.dt));
    let alertText: string | null = null;
    let subtitleText: string | null = null;
    let triggeredSetPieceId: string | null = null;
    let searchlightDetectedPlayer = false;
    let environmentalHazardDamage = 0;
    let environmentalHazardLabel: string | null = null;
    let reinforcementSpec: ReinforcementWaveSpec | null = null;

    if (this.searchlightAlertCooldownSec > 0) {
      this.searchlightAlertCooldownSec = Math.max(0, this.searchlightAlertCooldownSec - safeDt);
    }

    // 1. Pacing state transitions (mission-calibrated breather window prevents exhausting nonstop attrition)
    if (input.activeStageIndex > this.lastStageIndex) {
      this.lastStageIndex = input.activeStageIndex;
      const soloBreatherBonus = this.deploymentMode === 'solo' ? 4.0 : 0;
      this.breatherRemainingSec =
        getMissionBalanceProfile(this.missionId).stageBreatherSec + soloBreatherBonus;
    } else if (this.breatherRemainingSec > 0) {
      this.breatherRemainingSec = Math.max(0, this.breatherRemainingSec - safeDt);
    }

    if (input.extractionAvailable) {
      this.phase = 'EXTRACTION_PURSUIT';
    } else if (input.hasActiveBoss || input.activeStageIndex >= input.totalStages) {
      this.phase = 'CLIMAX_BOSS';
    } else if (this.breatherRemainingSec > 0 && !input.anyEnemyHasLos) {
      this.phase = 'RESUPPLY_BREATHER';
    } else if (input.activeStageIndex >= 2) {
      this.phase = 'SET_PIECE_ESCALATION';
    } else {
      this.phase = 'OPENING_PUSH';
    }

    // 2. Mission-specific live set pieces
    if (input.playerAlive) {
      if (this.missionId === 1) {
        if (input.activeStageIndex === 2 && !this.triggeredSetPieces.has('m1_aa_counterflank')) {
          this.triggeredSetPieces.add('m1_aa_counterflank');
          triggeredSetPieceId = 'm1_aa_counterflank';
          alertText = 'URBAN COUNTER-FLANK — PROTECT YOUR FLANKS NEAR AA RELAYS';
          subtitleText = 'OVERWATCH: Hostile anti-armor fireteam moving up the boulevard to defend the AA dishes.';
          reinforcementSpec = this.selectReinforcementWave(1, 2, 3);
        }
      } else if (this.missionId === 2) {
        if (input.playerPos.z < -20 && !this.triggeredSetPieces.has('m2_depot_perimeter_alarm')) {
          this.triggeredSetPieces.add('m2_depot_perimeter_alarm');
          triggeredSetPieceId = 'm2_depot_perimeter_alarm';
          alertText = 'REFINERY PERIMETER BREACHED — HEAVY ARMOR INBOUND';
          subtitleText = 'COMMAND: Depot klaxons active! Watch for heavy juggernauts guarding the fuel tanks.';
          reinforcementSpec = this.selectReinforcementWave(2, 2, 2);
        }
      } else if (this.missionId === 3) {
        // Update sweeping night searchlight cones & evaluate player visibility inside lit beam
        for (const sl of this.searchlights) {
          if (sl.destroyed) continue;
          sl.currentYaw = sl.baseYaw + Math.sin(input.elapsedSec * sl.sweepSpeedRadPerSec) * sl.sweepAmpRad;
          const beamDist = sl.rangeMeters * 0.62;
          sl.spotPos.set(
            sl.origin.x + Math.sin(sl.currentYaw) * beamDist,
            0.12,
            sl.origin.z + Math.cos(sl.currentYaw) * beamDist
          );

          const dx = input.playerPos.x - sl.origin.x;
          const dz = input.playerPos.z - sl.origin.z;
          const horizDist = Math.hypot(dx, dz);
          if (horizDist <= sl.rangeMeters && horizDist > 2.0) {
            const angleToPlayer = Math.atan2(dx, dz);
            let diff = angleToPlayer - sl.currentYaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) <= sl.halfConeRad) {
              searchlightDetectedPlayer = true;
            }
          }
        }

        if (searchlightDetectedPlayer && this.searchlightAlertCooldownSec <= 0) {
          this.searchlightAlertCooldownSec = 8.0;
          triggeredSetPieceId = 'm3_searchlight_spot';
          alertText = 'SPOTTED BY SEARCHLIGHT — EVADE BEAM OR DESTROY TOWER';
          subtitleText = 'OVERWATCH: Midnight searchlight has locked your position! Break into shadow or shoot the tower.';
        }
      } else if (this.missionId === 4) {
        if (input.playerPos.z < 12 && !this.triggeredSetPieces.has('m4_bridgehead_ambush')) {
          this.triggeredSetPieces.add('m4_bridgehead_ambush');
          triggeredSetPieceId = 'm4_bridgehead_ambush';
          alertText = 'BRIDGEHEAD AMBUSH — HOLD THE NORTH BANK';
          subtitleText = 'COMMAND: Jungle patrols emerging from the northern treeline! Use bridge cover and flank high.';
          reinforcementSpec = this.selectReinforcementWave(4, 1, 3);
        }
      } else if (this.missionId === 5) {
        // Molten slag heat hazards around foundry vats (pulses every 0.5s)
        this.hazardTickAccum += safeDt;
        if (this.hazardTickAccum >= 0.5) {
          const tickDt = this.hazardTickAccum;
          this.hazardTickAccum = 0;
          if (!input.playerInVehicle) {
            for (const hz of this.slagHazards) {
              if (!hz.active) continue;
              const d = Math.hypot(input.playerPos.x - hz.center.x, input.playerPos.z - hz.center.z);
              if (d <= hz.radius && input.playerPos.y < 3.0) {
                environmentalHazardDamage = Math.round(hz.dps * tickDt);
                environmentalHazardLabel = 'MOLTEN SLAG HEAT HAZARD — MOVE CLEAR OF FOUNDRY VAT';
                break;
              }
            }
          }
        }

        if (input.extractionAvailable && !this.triggeredSetPieces.has('m5_extraction_pursuit')) {
          this.triggeredSetPieces.add('m5_extraction_pursuit');
          triggeredSetPieceId = 'm5_extraction_pursuit';
          alertText = 'EXTRACTION BEACON LIVE — BREAK THROUGH TO NORTH TUNNEL';
          subtitleText = 'COMMAND: Hostile pursuit teams converging on the north exit! Board the Armored Truck or sprint for extraction.';
          reinforcementSpec = this.selectReinforcementWave(5, 3, 3);
        }
      }
    }

    // 3. Advance bounded hostile intelligence memory & evaluate observable telegraphed counters (TRN-41)
    if (searchlightDetectedPlayer) {
      this.intelBoard.reportDetection({
        squadId: 'nightfall_garrison',
        spotterUnitId: 'searchlight_tower',
        source: 'searchlight',
        x: input.playerPos.x,
        y: input.playerPos.y,
        z: input.playerPos.z,
        strength: 0.95,
        observedPlayerInVehicle: input.playerInVehicle,
        observedFriendlySuppressor: input.friendlySuppressorActive,
      });
    }
    this.intelBoard.update(safeDt);
    const telegraphedCounter = this.intelBoard.evaluateObservableCounterDirective();
    if (telegraphedCounter && !subtitleText) {
      subtitleText = `INTERCEPT: ${telegraphedCounter.callout}`;
    }

    // 4. Derive adaptive music intensity state cleanly
    if (input.anyEnemyHasLos) {
      this.combatCalmTimerSec = 0;
    } else {
      this.combatCalmTimerSec += safeDt;
    }

    let adaptiveMusicState: AdaptiveMusicState;
    if (input.elapsedSec < 8 && !input.anyEnemyHasLos) {
      adaptiveMusicState = 'deployment';
    } else if (input.extractionAvailable) {
      adaptiveMusicState = 'extraction';
    } else if (input.hasActiveBoss || this.phase === 'CLIMAX_BOSS') {
      adaptiveMusicState = 'climax';
    } else if (input.anyEnemyHasLos || this.combatCalmTimerSec < 6.0) {
      adaptiveMusicState = 'combat';
    } else {
      adaptiveMusicState = 'recon';
    }

    return {
      phase: this.phase,
      adaptiveMusicState,
      recommendedMood: mapAdaptiveMusicStateToMood(adaptiveMusicState),
      alertText,
      subtitleText,
      triggeredSetPieceId,
      searchlightDetectedPlayer,
      environmentalHazardDamage,
      environmentalHazardLabel,
      reinforcementSpec,
      telegraphedCounter,
    };
  }

  getCampaignModifiers(): MissionConsequenceModifiers | null {
    return this.campaignModifiers;
  }
}
