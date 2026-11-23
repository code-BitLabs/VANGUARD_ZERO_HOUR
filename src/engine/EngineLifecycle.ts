export type LifecyclePhase =
  | 'boot'
  | 'menu'
  | 'preloading'
  | 'initializingWorld'
  | 'playing'
  | 'paused'
  | 'debrief'
  | 'unloading'
  | 'error';

export interface LifecycleContext {
  missionId: number | null;
  errorMessage: string | null;
}

export type LifecycleEvent =
  | { type: 'READY' }
  | { type: 'SELECT_MISSION'; missionId: number }
  | { type: 'ASSETS_LOADED' }
  | { type: 'WORLD_READY' }
  | { type: 'CANCEL_LOAD' }
  | { type: 'LOAD_FAILED'; message: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'RESTART_MISSION' }
  | { type: 'MISSION_ENDED' }
  | { type: 'UNLOAD' }
  | { type: 'UNLOADED' }
  | { type: 'RECOVER' };

export interface LifecycleSnapshot {
  readonly value: LifecyclePhase;
  readonly context: Readonly<LifecycleContext>;
}

export interface LifecycleMachineDefinition {
  readonly id: string;
  readonly initial: LifecyclePhase;
  readonly initialContext: Readonly<LifecycleContext>;
  readonly transition: (
    phase: LifecyclePhase,
    context: Readonly<LifecycleContext>,
    event: LifecycleEvent
  ) => LifecycleSnapshot | null;
}

export interface LifecycleSubscription {
  unsubscribe(): void;
}

export interface LifecycleActor {
  start(): this;
  stop(): this;
  send(event: LifecycleEvent): void;
  getSnapshot(): LifecycleSnapshot;
  subscribe(listener: (snapshot: LifecycleSnapshot) => void): LifecycleSubscription;
}

type TransitionTable = {
  readonly [P in LifecyclePhase]: {
    readonly [E in LifecycleEvent['type']]?: (
      ctx: Readonly<LifecycleContext>,
      event: Extract<LifecycleEvent, { type: E }>
    ) => LifecycleSnapshot;
  };
};

const selectMission = (
  _ctx: Readonly<LifecycleContext>,
  event: Extract<LifecycleEvent, { type: 'SELECT_MISSION' }>
): LifecycleSnapshot => ({
  value: 'preloading',
  context: {
    missionId: event.missionId,
    errorMessage: null,
  },
});

const loadFailed = (
  ctx: Readonly<LifecycleContext>,
  event: Extract<LifecycleEvent, { type: 'LOAD_FAILED' }>
): LifecycleSnapshot => ({
  value: 'error',
  context: {
    missionId: ctx.missionId,
    errorMessage: event.message,
  },
});

const keepContext =
  (target: LifecyclePhase) =>
  (ctx: Readonly<LifecycleContext>): LifecycleSnapshot => ({
    value: target,
    context: ctx,
  });

const TRANSITIONS: TransitionTable = {
  boot: {
    READY: keepContext('menu'),
    SELECT_MISSION: selectMission,
  },
  menu: {
    SELECT_MISSION: selectMission,
    UNLOAD: keepContext('unloading'),
  },
  preloading: {
    ASSETS_LOADED: keepContext('initializingWorld'),
    CANCEL_LOAD: keepContext('unloading'),
    UNLOAD: keepContext('unloading'),
    SELECT_MISSION: selectMission,
    LOAD_FAILED: loadFailed,
  },
  initializingWorld: {
    WORLD_READY: keepContext('playing'),
    CANCEL_LOAD: keepContext('unloading'),
    UNLOAD: keepContext('unloading'),
    SELECT_MISSION: selectMission,
    LOAD_FAILED: loadFailed,
  },
  playing: {
    PAUSE: keepContext('paused'),
    RESTART_MISSION: keepContext('playing'),
    MISSION_ENDED: keepContext('debrief'),
    UNLOAD: keepContext('unloading'),
    SELECT_MISSION: selectMission,
  },
  paused: {
    RESUME: keepContext('playing'),
    RESTART_MISSION: keepContext('playing'),
    MISSION_ENDED: keepContext('debrief'),
    UNLOAD: keepContext('unloading'),
    SELECT_MISSION: selectMission,
  },
  debrief: {
    RESTART_MISSION: keepContext('playing'),
    UNLOAD: keepContext('unloading'),
    SELECT_MISSION: selectMission,
  },
  unloading: {
    UNLOADED: () => ({
      value: 'menu',
      context: {
        missionId: null,
        errorMessage: null,
      },
    }),
    SELECT_MISSION: selectMission,
  },
  error: {
    RECOVER: keepContext('unloading'),
    UNLOAD: keepContext('unloading'),
    SELECT_MISSION: selectMission,
  },
};

export const engineLifecycleMachine: LifecycleMachineDefinition = {
  id: 'vanguardLifecycle',
  initial: 'boot',
  initialContext: {
    missionId: null,
    errorMessage: null,
  },
  transition(phase, context, event) {
    const stateHandlers = TRANSITIONS[phase];
    const handler = stateHandlers[event.type] as
      | ((ctx: Readonly<LifecycleContext>, ev: LifecycleEvent) => LifecycleSnapshot)
      | undefined;
    if (!handler) return null;
    return handler(context, event);
  },
};

/**
 * Lightweight zero-dependency finite-state actor replacing xstate v5 for EngineLifecycle.
 */
export function createLifecycleActor(
  machine: LifecycleMachineDefinition = engineLifecycleMachine
): LifecycleActor {
  let started = false;
  let stopped = false;
  let snapshot: LifecycleSnapshot = {
    value: machine.initial,
    context: { ...machine.initialContext },
  };
  const listeners = new Set<(snap: LifecycleSnapshot) => void>();

  const actor: LifecycleActor = {
    start() {
      started = true;
      stopped = false;
      return actor;
    },
    stop() {
      stopped = true;
      listeners.clear();
      return actor;
    },
    send(event: LifecycleEvent) {
      if (!started || stopped) return;
      const next = machine.transition(snapshot.value, snapshot.context, event);
      if (!next) return;
      snapshot = next;
      for (const listener of listeners) {
        listener(snapshot);
      }
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return {
        unsubscribe() {
          listeners.delete(listener);
        },
      };
    },
  };

  return actor;
}

export const createActor = createLifecycleActor;
