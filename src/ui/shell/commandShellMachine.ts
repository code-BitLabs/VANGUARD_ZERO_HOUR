import { assign, createMachine } from 'xstate';

export type HQSectionId =
  | 'operations'
  | 'armory'
  | 'fireteam'
  | 'progression'
  | 'settings';

export interface CommandShellContext {
  activeSection: HQSectionId;
  pendingSection: HQSectionId | null;
  hasUnsavedSettings: boolean;
}

export type CommandShellEvent =
  | { type: 'NAVIGATE'; section: HQSectionId }
  | { type: 'SET_UNSAVED_SETTINGS'; dirty: boolean }
  | { type: 'CONFIRM_DISCARD' }
  | { type: 'CONFIRM_APPLY_AND_LEAVE' }
  | { type: 'CANCEL_NAVIGATION' };

/**
 * Authoritative XState workflow machine for the Unified Command HQ Shell.
 * Prevents impossible navigation states and guarantees unsaved Settings changes
 * cannot be silently lost when switching HQ sections.
 */
export const commandShellMachine = createMachine({
  id: 'vanguardCommandShell',
  types: {} as {
    context: CommandShellContext;
    events: CommandShellEvent;
  },
  context: {
    activeSection: 'operations',
    pendingSection: null,
    hasUnsavedSettings: false,
  },
  initial: 'browsing',
  states: {
    browsing: {
      on: {
        SET_UNSAVED_SETTINGS: {
          actions: assign({
            hasUnsavedSettings: ({ event }) => event.dirty,
          }),
        },
        NAVIGATE: [
          {
            guard: ({ context, event }) =>
              context.activeSection === 'settings' &&
              context.hasUnsavedSettings &&
              event.section !== 'settings',
            target: 'confirmingLeaveSettings',
            actions: assign({
              pendingSection: ({ event }) => event.section,
            }),
          },
          {
            actions: assign({
              activeSection: ({ event }) => event.section,
              pendingSection: null,
            }),
          },
        ],
      },
    },
    confirmingLeaveSettings: {
      on: {
        CONFIRM_DISCARD: {
          target: 'browsing',
          actions: assign({
            activeSection: ({ context }) => context.pendingSection ?? context.activeSection,
            pendingSection: null,
            hasUnsavedSettings: false,
          }),
        },
        CONFIRM_APPLY_AND_LEAVE: {
          target: 'browsing',
          actions: assign({
            activeSection: ({ context }) => context.pendingSection ?? context.activeSection,
            pendingSection: null,
            hasUnsavedSettings: false,
          }),
        },
        CANCEL_NAVIGATION: {
          target: 'browsing',
          actions: assign({
            pendingSection: null,
          }),
        },
      },
    },
  },
});
