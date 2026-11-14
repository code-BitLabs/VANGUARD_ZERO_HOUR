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
      },
    },
    preloading: {
      on: {
        ASSETS_LOADED: 'initializingWorld',
        CANCEL_LOAD: 'unloading',
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
        MISSION_ENDED: 'debrief',
        UNLOAD: 'unloading',
      },
    },
    paused: {
      on: {
        RESUME: 'playing',
        UNLOAD: 'unloading',
      },
    },
    debrief: {
      on: {
        UNLOAD: 'unloading',
        SELECT_MISSION: {
          target: 'unloading',
          actions: assign({
            missionId: ({ event }) => event.missionId,
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
      },
    },
    error: {
      on: {
        RECOVER: 'unloading',
      },
    },
  },
});
