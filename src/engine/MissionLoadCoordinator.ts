import { ResourceManager, ResourceScope } from '@/src/core/ResourceManager';

export interface ActiveMissionLoadToken {
  readonly generation: number;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly isStale: () => boolean;
}

/**
 * Coordinates monotonic mission load generations and AbortController ownership
 * across `startMission`, `restartCheckpoint`, and `abortToMenu` / `unloadToMenu`
 * so rapid transitions or mid-load cancellations never clobber newer loads or hijack the menu.
 */
export class MissionLoadCoordinator {
  private generation = 0;
  private activeController: AbortController | null = null;

  constructor(private readonly resourceManager: ResourceManager) {}

  beginLoad(scope: ResourceScope): ActiveMissionLoadToken {
    const gen = ++this.generation;
    this.activeController?.abort();
    const controller = this.resourceManager.createAbortController(scope);
    this.activeController = controller;
    const signal = controller.signal;
    return {
      generation: gen,
      controller,
      signal,
      isStale: () => signal.aborted || gen !== this.generation,
    };
  }

  /**
   * Advances generation and aborts any in-flight async mission load before
   * performing a synchronous checkpoint restart or menu teardown.
   */
  invalidateActiveLoad(): number {
    const gen = ++this.generation;
    this.activeController?.abort();
    this.activeController = null;
    return gen;
  }

  getCurrentGeneration(): number {
    return this.generation;
  }

  isCurrentGeneration(gen: number): boolean {
    return gen === this.generation;
  }

  hasActiveAbortController(): boolean {
    return this.activeController !== null;
  }
}
