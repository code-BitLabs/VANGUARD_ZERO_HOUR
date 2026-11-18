import { assign, setup } from 'xstate';

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

export const engineLifecycleMachine = setup({
  types: {
    context: {} as LifecycleContext,
    events: {} as LifecycleEvent,
  },
}).createMachine({
  id: 'vanguardLifecycle',
  initial: 'boot',
  context: {
    missionId: null,
    errorMessage: null,
  },
  states: {
    boot: {
      on: {
        READY: 'menu',
        SELECT_MISSION: {
          target: 'preloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
            errorMessage: null,
          }),
        },
      },
    },
    menu: {
      on: {
        SELECT_MISSION: {
          target: 'preloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
            errorMessage: null,
          }),
        },
        UNLOAD: 'unloading',
      },
    },
    preloading: {
      on: {
        ASSETS_LOADED: 'initializingWorld',
        CANCEL_LOAD: 'unloading',
        UNLOAD: 'unloading',
        SELECT_MISSION: {
          target: 'preloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
            errorMessage: null,
          }),
        },
        LOAD_FAILED: {
          target: 'error',
          actions: assign({
            errorMessage: ({ event }) => event.message,
          }),
        },
      },
    },
    initializingWorld: {
      on: {
        WORLD_READY: 'playing',
        CANCEL_LOAD: 'unloading',
        UNLOAD: 'unloading',
        SELECT_MISSION: {
          target: 'preloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
            errorMessage: null,
          }),
        },
        LOAD_FAILED: {
          target: 'error',
          actions: assign({
            errorMessage: ({ event }) => event.message,
          }),
        },
      },
    },
    playing: {
      on: {
        PAUSE: 'paused',
        RESTART_MISSION: 'playing',
        MISSION_ENDED: 'debrief',
        UNLOAD: 'unloading',
        SELECT_MISSION: {
          target: 'preloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
            errorMessage: null,
          }),
        },
      },
    },
    paused: {
      on: {
        RESUME: 'playing',
        RESTART_MISSION: 'playing',
        MISSION_ENDED: 'debrief',
        UNLOAD: 'unloading',
        SELECT_MISSION: {
          target: 'preloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
            errorMessage: null,
          }),
        },
      },
    },
    debrief: {
      on: {
        RESTART_MISSION: 'playing',
        UNLOAD: 'unloading',
        SELECT_MISSION: {
          target: 'preloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
            errorMessage: null,
          }),
        },
      },
    },
    unloading: {
      on: {
        UNLOADED: {
          target: 'menu',
          actions: assign({
            missionId: null,
            errorMessage: null,
          }),
        },
        SELECT_MISSION: {
          target: 'preloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
            errorMessage: null,
          }),
        },
      },
    },
    error: {
      on: {
        RECOVER: 'unloading',
        UNLOAD: 'unloading',
        SELECT_MISSION: {
          target: 'preloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
            errorMessage: null,
          }),
        },
      },
    },
  },
});

