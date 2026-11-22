export type IntelSensorySource =
  | 'sight'
  | 'gunshot'
  | 'explosion'
  | 'searchlight'
  | 'vehicle_engine'
  | 'radio_relay';

export type HostileIntelState =
  | 'UNDETECTED'
  | 'INVESTIGATING'
  | 'ENGAGED'
  | 'SEARCHING'
  | 'LOST';

export interface SensoryDetectionEvent {
  readonly squadId: string;
  readonly spotterUnitId: string;
  readonly source: IntelSensorySource;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Acoustic or visual confidence boost in [0..1] */
  readonly strength: number;
  /** Optional observable tactical cues (never omniscient) */
  readonly observedPlayerInVehicle?: boolean;
  readonly observedFriendlySuppressor?: boolean;
  readonly observedElevatedThreat?: boolean;
}

export interface PendingRadioRelay {
  fromSquadId: string;
  spotterUnitId: string;
  targetSquadId: string;
  x: number;
  y: number;
  z: number;
  confidence: number;
  remainingDelaySec: number;
  observedPlayerInVehicle: boolean;
  observedFriendlySuppressor: boolean;
}

export interface HostileSquadIntelMemory {
  squadId: string;
  state: HostileIntelState;
  lastKnownX: number;
  lastKnownY: number;
  lastKnownZ: number;
  hasLastKnownPosition: boolean;
  confidence: number;
  ageSec: number;
  lastSource: IntelSensorySource | null;
  observedPlayerInVehicle: boolean;
  observedFriendlySuppressor: boolean;
  observedElevatedThreat: boolean;
  vehicleObservationAgeSec: number;
  suppressorObservationAgeSec: number;
}

export interface TelegraphedCounterDirective {
  counterId: string;
  callout: string;
  preferAntiArmor: boolean;
  preferFlankCover: boolean;
  preferHighGroundCounter: boolean;
  basedOnSquadId: string;
}

const BASE_RADIO_RELAY_DELAY_SEC = 2.5;
const SEARCH_TRANSITION_AGE_SEC = 4.0;
const LOST_TRANSITION_AGE_SEC = 18.0;
const CONFIDENCE_DECAY_PER_SEC = 0.055;
const LOST_CONFIDENCE_THRESHOLD = 0.15;

/**
 * TRN-41: Bounded, non-omniscient Battlefield Intelligence Memory Board.
 * Enemies act strictly on sensory detections, decaying confidence, last-known positions,
 * and finite inter-squad radio relays modulated by TRN-39 campaign comms consequences.
 */
export class BattlefieldIntelligenceBoard {
  private readonly squadMemories = new Map<string, HostileSquadIntelMemory>();
  private readonly pendingRelays = new Map<string, PendingRadioRelay>();
  private readonly deadSpotters = new Set<string>();
  private commsDelayMult = 1.0;
  private lastCounterCalloutSec = -99;
  private elapsedSec = 0;

  reset(commsDelayMult = 1.0): void {
    this.squadMemories.clear();
    this.pendingRelays.clear();
    this.deadSpotters.clear();
    this.commsDelayMult = Math.max(0.5, Math.min(3.0, commsDelayMult));
    this.lastCounterCalloutSec = -99;
    this.elapsedSec = 0;
  }

  setCommsDelayMultiplier(mult: number): void {
    this.commsDelayMult = Math.max(0.5, Math.min(3.0, mult));
  }

  getCommsDelayMultiplier(): number {
    return this.commsDelayMult;
  }

  registerSquad(squadId: string): HostileSquadIntelMemory {
    let mem = this.squadMemories.get(squadId);
    if (!mem) {
      mem = {
        squadId,
        state: 'UNDETECTED',
        lastKnownX: 0,
        lastKnownY: 0,
        lastKnownZ: 0,
        hasLastKnownPosition: false,
        confidence: 0,
        ageSec: 999,
        lastSource: null,
        observedPlayerInVehicle: false,
        observedFriendlySuppressor: false,
        observedElevatedThreat: false,
        vehicleObservationAgeSec: 999,
        suppressorObservationAgeSec: 999,
      };
      this.squadMemories.set(squadId, mem);
    }
    return mem;
  }

  /**
   * Cancels any in-flight radio relays from an eliminated spotter/operator before they complete.
   */
  notifyUnitEliminated(unitId: string): void {
    this.deadSpotters.add(unitId);
    for (const [key, relay] of this.pendingRelays.entries()) {
      if (relay.spotterUnitId === unitId) {
        this.pendingRelays.delete(key);
      }
    }
  }

  /**
   * Records a sensory observation for a specific hostile squad.
   * Suppressed weapons naturally emit smaller `strength` / narrower gunshot radii at the call site.
   */
  reportDetection(event: SensoryDetectionEvent): void {
    if (this.deadSpotters.has(event.spotterUnitId)) return;
    const mem = this.registerSquad(event.squadId);

    const clampedStrength = Math.max(0.05, Math.min(1.0, event.strength));
    // Acoustic events carry bearing uncertainty unless corroborated by sight/searchlight
    const nextConfidence = Math.min(1.0, Math.max(mem.confidence * 0.7 + clampedStrength * 0.6, clampedStrength));

    mem.lastKnownX = event.x;
    mem.lastKnownY = event.y;
    mem.lastKnownZ = event.z;
    mem.hasLastKnownPosition = true;
    mem.confidence = nextConfidence;
    mem.ageSec = 0;
    mem.lastSource = event.source;

    if (event.observedPlayerInVehicle) {
      mem.observedPlayerInVehicle = true;
      mem.vehicleObservationAgeSec = 0;
    }
    if (event.observedFriendlySuppressor) {
      mem.observedFriendlySuppressor = true;
      mem.suppressorObservationAgeSec = 0;
    }
    if (event.observedElevatedThreat) {
      mem.observedElevatedThreat = true;
    }

    // Explicit State transitions based on source & confidence
    if (event.source === 'sight' || event.source === 'searchlight' || nextConfidence >= 0.72) {
      mem.state = 'ENGAGED';
    } else if (mem.state === 'UNDETECTED' || mem.state === 'LOST') {
      mem.state = 'INVESTIGATING';
    } else if (mem.state === 'SEARCHING' && nextConfidence >= 0.55) {
      mem.state = 'ENGAGED';
    }

    // Schedule finite delayed radio relay to other squads (modulated by TRN-39 comms disruption!)
    if (event.source !== 'radio_relay' && nextConfidence >= 0.6) {
      const relayDelay = BASE_RADIO_RELAY_DELAY_SEC * this.commsDelayMult;
      const relayConfidence = Math.min(0.75, nextConfidence * 0.8);
      const obsVehicle = Boolean(event.observedPlayerInVehicle);
      const obsSuppressor = Boolean(event.observedFriendlySuppressor);
      for (const [otherSquadId] of this.squadMemories.entries()) {
        if (otherSquadId === event.squadId) continue;
        const relayKey = `${event.squadId}->${otherSquadId}`;
        const existing = this.pendingRelays.get(relayKey);
        if (existing) {
          existing.spotterUnitId = event.spotterUnitId;
          existing.x = event.x;
          existing.y = event.y;
          existing.z = event.z;
          existing.confidence = relayConfidence;
          existing.remainingDelaySec = relayDelay;
          existing.observedPlayerInVehicle = obsVehicle;
          existing.observedFriendlySuppressor = obsSuppressor;
        } else if (this.pendingRelays.size < 32) {
          this.pendingRelays.set(relayKey, {
            fromSquadId: event.squadId,
            spotterUnitId: event.spotterUnitId,
            targetSquadId: otherSquadId,
            x: event.x,
            y: event.y,
            z: event.z,
            confidence: relayConfidence,
            remainingDelaySec: relayDelay,
            observedPlayerInVehicle: obsVehicle,
            observedFriendlySuppressor: obsSuppressor,
          });
        }
      }
    }
  }

  /**
   * Broadcasts an acoustic gunshot/explosion event strictly to squads within `soundRadiusMeters`.
   */
  emitAcousticEvent(params: {
    source: 'gunshot' | 'explosion' | 'vehicle_engine';
    x: number;
    y: number;
    z: number;
    soundRadiusMeters: number;
    squadCentroids: ReadonlyArray<{ squadId: string; spotterUnitId: string; x: number; y: number; z: number }>;
    observedPlayerInVehicle?: boolean;
    observedFriendlySuppressor?: boolean;
  }): number {
    const rSq = params.soundRadiusMeters * params.soundRadiusMeters;
    let notified = 0;

    for (let i = 0; i < params.squadCentroids.length; i++) {
      const sq = params.squadCentroids[i];
      const dx = params.x - sq.x;
      const dy = params.y - sq.y;
      const dz = params.z - sq.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > rSq) continue;

      const distRatio = Math.sqrt(dSq) / Math.max(1, params.soundRadiusMeters);
      const strength = Math.max(0.2, (1 - distRatio * 0.65) * (params.source === 'explosion' ? 0.92 : 0.64));
      this.reportDetection({
        squadId: sq.squadId,
        spotterUnitId: sq.spotterUnitId,
        source: params.source,
        x: params.x,
        y: params.y,
        z: params.z,
        strength,
        observedPlayerInVehicle: params.observedPlayerInVehicle,
        observedFriendlySuppressor: params.observedFriendlySuppressor,
      });
      notified++;
    }

    return notified;
  }

  /**
   * Advances confidence decay, LKP aging, state transitions (ENGAGED -> SEARCHING -> LOST),
   * and pending inter-squad radio relays.
   */
  update(dt: number): void {
    const safeDt = Math.max(0, Math.min(dt, 0.1));
    this.elapsedSec += safeDt;

    // 1. Process inter-squad radio relay queue
    for (const [key, relay] of this.pendingRelays.entries()) {
      if (this.deadSpotters.has(relay.spotterUnitId)) {
        this.pendingRelays.delete(key);
        continue;
      }
      relay.remainingDelaySec -= safeDt;
      if (relay.remainingDelaySec <= 0) {
        this.pendingRelays.delete(key);
        this.reportDetection({
          squadId: relay.targetSquadId,
          spotterUnitId: relay.spotterUnitId,
          source: 'radio_relay',
          x: relay.x,
          y: relay.y,
          z: relay.z,
          strength: relay.confidence,
          observedPlayerInVehicle: relay.observedPlayerInVehicle,
          observedFriendlySuppressor: relay.observedFriendlySuppressor,
        });
      }
    }

    // 2. Decay confidence and transition states deterministically
    for (const mem of this.squadMemories.values()) {
      if (!mem.hasLastKnownPosition) continue;

      mem.ageSec += safeDt;
      mem.vehicleObservationAgeSec += safeDt;
      mem.suppressorObservationAgeSec += safeDt;

      if (mem.vehicleObservationAgeSec > 16) {
        mem.observedPlayerInVehicle = false;
      }
      if (mem.suppressorObservationAgeSec > 12) {
        mem.observedFriendlySuppressor = false;
      }

      if (mem.ageSec > 1.2) {
        mem.confidence = Math.max(0, mem.confidence - CONFIDENCE_DECAY_PER_SEC * safeDt);
      }

      if (mem.state === 'ENGAGED' && mem.ageSec >= SEARCH_TRANSITION_AGE_SEC) {
        mem.state = 'SEARCHING';
      }

      if (
        (mem.state === 'SEARCHING' || mem.state === 'INVESTIGATING' || mem.state === 'ENGAGED') &&
        (mem.ageSec >= LOST_TRANSITION_AGE_SEC || mem.confidence < LOST_CONFIDENCE_THRESHOLD)
      ) {
        mem.state = 'LOST';
        mem.confidence = 0;
      }
    }
  }

  getSquadMemory(squadId: string): Readonly<HostileSquadIntelMemory> | null {
    return this.squadMemories.get(squadId) ?? null;
  }

  getPendingRelayCount(): number {
    return this.pendingRelays.size;
  }

  /**
   * Produces a fair, observable, telegraphed tactical counter-directive strictly from
   * currently observed squad intelligence (never raw player state).
   */
  evaluateObservableCounterDirective(): TelegraphedCounterDirective | null {
    if (this.elapsedSec - this.lastCounterCalloutSec < 14) return null;

    for (const mem of this.squadMemories.values()) {
      if (mem.state !== 'ENGAGED' || mem.confidence < 0.65) continue;

      if (mem.observedPlayerInVehicle) {
        this.lastCounterCalloutSec = this.elapsedSec;
        return {
          counterId: 'counter_armor',
          callout: 'Hostile spotters confirmed armored vehicle — enemy AT-specialists shifting to intercept!',
          preferAntiArmor: true,
          preferFlankCover: false,
          preferHighGroundCounter: false,
          basedOnSquadId: mem.squadId,
        };
      }

      if (mem.observedFriendlySuppressor) {
        this.lastCounterCalloutSec = this.elapsedSec;
        return {
          counterId: 'counter_suppression',
          callout: 'Enemy squad pinned by friendly SAW fire — hostile raiders swinging wide to flank!',
          preferAntiArmor: false,
          preferFlankCover: true,
          preferHighGroundCounter: false,
          basedOnSquadId: mem.squadId,
        };
      }

      if (mem.observedElevatedThreat) {
        this.lastCounterCalloutSec = this.elapsedSec;
        return {
          counterId: 'counter_overwatch',
          callout: 'Hostile marksmen spotted elevated fireteam — seeking hard cover and counter-overwatch!',
          preferAntiArmor: false,
          preferFlankCover: false,
          preferHighGroundCounter: true,
          basedOnSquadId: mem.squadId,
        };
      }
    }

    return null;
  }
}
