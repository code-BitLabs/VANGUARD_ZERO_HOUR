import * as THREE from 'three';

export type ResourceScope = 'shared' | `mission:${string}` | `pool:${string}`;
export type ResourceCategory =
  | 'geometry'
  | 'material'
  | 'texture'
  | 'renderTarget'
  | 'object3d'
  | 'mixer'
  | 'audioNode'
  | 'worker'
  | 'listener'
  | 'timer'
  | 'abortController'
  | 'other';

interface ManagedEntry {
  id: string;
  category: ResourceCategory;
  scope: ResourceScope;
  refCount: number;
  disposeFn: () => void;
}

export interface ResourceSnapshot {
  totalCreated: number;
  totalDisposed: number;
  sharedCount: number;
  missionCount: number;
  pooledCount: number;
  byCategory: Record<ResourceCategory, number>;
}

export class ResourceManager {
  private entries = new Map<string, ManagedEntry>();
  private scopeIndex = new Map<ResourceScope, Set<string>>();
  private listeners: Array<{ scope: ResourceScope; cleanup: () => void }> = [];
  private timers: Array<{ scope: ResourceScope; id: number; kind: 'timeout' | 'interval' }> = [];
  private abortControllers = new Map<ResourceScope, Set<AbortController>>();

  private totalCreated = 0;
  private totalDisposed = 0;
  private seq = 0;
  private baselineSnapshot: ResourceSnapshot | null = null;
  private lastUnloadAudit: {
    hasMissionLeak: boolean;
    missionRemaining: number;
    sharedDelta: number;
    pooledDelta: number;
  } = {
    hasMissionLeak: false,
    missionRemaining: 0,
    sharedDelta: 0,
    pooledDelta: 0,
  };

  register(
    category: ResourceCategory,
    scope: ResourceScope,
    disposeFn: () => void,
    explicitId?: string
  ): string {
    const id = explicitId ?? `${category}_${++this.seq}`;
    const existing = this.entries.get(id);
    if (existing) {
      existing.refCount++;
      return id;
    }

    const entry: ManagedEntry = {
      id,
      category,
      scope,
      refCount: 1,
      disposeFn,
    };
    this.entries.set(id, entry);
    this.totalCreated++;

    let set = this.scopeIndex.get(scope);
    if (!set) {
      set = new Set();
      this.scopeIndex.set(scope, set);
    }
    set.add(id);
    return id;
  }

  registerGeometry(geo: THREE.BufferGeometry, scope: ResourceScope, id?: string): string {
    return this.register('geometry', scope, () => geo.dispose(), id);
  }

  registerMaterial(mat: THREE.Material, scope: ResourceScope, id?: string): string {
    return this.register('material', scope, () => mat.dispose(), id);
  }

  registerTexture(tex: THREE.Texture, scope: ResourceScope, id?: string): string {
    return this.register('texture', scope, () => tex.dispose(), id);
  }

  registerRenderTarget(rt: THREE.WebGLRenderTarget, scope: ResourceScope, id?: string): string {
    return this.register('renderTarget', scope, () => rt.dispose(), id);
  }

  registerWorker(worker: Worker, scope: ResourceScope, id?: string): string {
    return this.register('worker', scope, () => worker.terminate(), id);
  }

  registerAudioNode(node: AudioNode, scope: ResourceScope, stoppable?: { stop?: () => void }): string {
    return this.register('audioNode', scope, () => {
      try {
        stoppable?.stop?.();
      } catch {
        // Ignore already-stopped audio nodes
      }
      try {
        node.disconnect();
      } catch {
        // Ignore already-disconnected nodes
      }
    });
  }

  trackEventListener<K extends keyof WindowEventMap>(
    target: EventTarget,
    type: K | string,
    listener: EventListenerOrEventListenerObject,
    scope: ResourceScope,
    options?: boolean | AddEventListenerOptions
  ): () => void {
    target.addEventListener(type, listener, options);
    const cleanup = () => target.removeEventListener(type, listener, options);
    const record = { scope, cleanup };
    this.listeners.push(record);
    return () => {
      const idx = this.listeners.indexOf(record);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
        cleanup();
      }
    };
  }

  trackTimeout(fn: () => void, ms: number, scope: ResourceScope): number {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter((t) => !(t.id === id && t.kind === 'timeout'));
      fn();
    }, ms);
    this.timers.push({ scope, id, kind: 'timeout' });
    return id;
  }

  createAbortController(scope: ResourceScope): AbortController {
    const controller = new AbortController();
    let set = this.abortControllers.get(scope);
    if (!set) {
      set = new Set();
      this.abortControllers.set(scope, set);
    }
    set.add(controller);
    return controller;
  }

  retain(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.refCount++;
    return true;
  }

  release(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      this.disposeEntry(entry);
    }
  }

  unloadScope(scope: ResourceScope): number {
    // 1. Abort all pending async asset loads or worker jobs in this scope
    const controllers = this.abortControllers.get(scope);
    if (controllers) {
      for (const c of controllers) {
        c.abort();
      }
      controllers.clear();
      this.abortControllers.delete(scope);
    }

    // 2. Remove tracked DOM/window listeners in this scope
    for (let i = this.listeners.length - 1; i >= 0; i--) {
      if (this.listeners[i].scope === scope) {
        this.listeners[i].cleanup();
        this.listeners.splice(i, 1);
      }
    }

    // 3. Cancel pending timers in this scope
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (t.scope === scope) {
        if (t.kind === 'timeout') window.clearTimeout(t.id);
        else window.clearInterval(t.id);
        this.timers.splice(i, 1);
      }
    }

    // 4. Dispose scoped entries in reverse insertion order
    const ids = this.scopeIndex.get(scope);
    if (!ids) return 0;
    let disposedCount = 0;
    const orderedIds = Array.from(ids).reverse();
    for (const id of orderedIds) {
      const entry = this.entries.get(id);
      if (entry) {
        this.disposeEntry(entry);
        disposedCount++;
      }
    }
    this.scopeIndex.delete(scope);
    return disposedCount;
  }

  disposeObject3DTree(root: THREE.Object3D, disposeOwnedMaterials = false): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (disposeOwnedMaterials) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      }
    });
  }

  private disposeEntry(entry: ManagedEntry): void {
    this.entries.delete(entry.id);
    const set = this.scopeIndex.get(entry.scope);
    set?.delete(entry.id);
    try {
      entry.disposeFn();
    } catch {
      // Protect unload sequence from single-item disposal errors
    }
    this.totalDisposed++;
  }

  getSnapshot(): ResourceSnapshot {
    const byCategory: Record<ResourceCategory, number> = {
      geometry: 0,
      material: 0,
      texture: 0,
      renderTarget: 0,
      object3d: 0,
      mixer: 0,
      audioNode: 0,
      worker: 0,
      listener: this.listeners.length,
      timer: this.timers.length,
      abortController: this.abortControllers.size,
      other: 0,
    };

    let sharedCount = 0;
    let missionCount = 0;
    let pooledCount = 0;

    for (const entry of this.entries.values()) {
      byCategory[entry.category]++;
      if (entry.scope === 'shared') sharedCount++;
      else if (entry.scope.startsWith('mission:')) missionCount++;
      else if (entry.scope.startsWith('pool:')) pooledCount++;
    }

    return {
      totalCreated: this.totalCreated,
      totalDisposed: this.totalDisposed,
      sharedCount,
      missionCount,
      pooledCount,
      byCategory,
    };
  }

  recordBaseline(): ResourceSnapshot {
    this.baselineSnapshot = this.getSnapshot();
    return this.baselineSnapshot;
  }

  auditTransitionDelta(): {
    hasMissionLeak: boolean;
    missionRemaining: number;
    sharedDelta: number;
    pooledDelta: number;
  } {
    const current = this.getSnapshot();
    const base = this.baselineSnapshot;
    return {
      hasMissionLeak: current.missionCount > 0,
      missionRemaining: current.missionCount,
      sharedDelta: base ? current.sharedCount - base.sharedCount : 0,
      pooledDelta: base ? current.pooledCount - base.pooledCount : 0,
    };
  }

  recordPostUnloadAudit(): {
    hasMissionLeak: boolean;
    missionRemaining: number;
    sharedDelta: number;
    pooledDelta: number;
  } {
    this.lastUnloadAudit = this.auditTransitionDelta();
    return this.lastUnloadAudit;
  }

  getLastUnloadAudit(): {
    hasMissionLeak: boolean;
    missionRemaining: number;
    sharedDelta: number;
    pooledDelta: number;
  } {
    const current = this.getSnapshot();
    const base = this.baselineSnapshot;
    return {
      hasMissionLeak: this.lastUnloadAudit.hasMissionLeak,
      missionRemaining: this.lastUnloadAudit.missionRemaining,
      sharedDelta: base ? current.sharedCount - base.sharedCount : this.lastUnloadAudit.sharedDelta,
      pooledDelta: base ? current.pooledCount - base.pooledCount : this.lastUnloadAudit.pooledDelta,
    };
  }

  disposeAll(): void {
    const scopes = Array.from(this.scopeIndex.keys());
    for (const scope of scopes) {
      this.unloadScope(scope);
    }
    for (const controllers of this.abortControllers.values()) {
      for (const c of controllers) {
        c.abort();
      }
      controllers.clear();
    }
    this.abortControllers.clear();
    // Clean any remaining listeners/timers
    for (const l of this.listeners) l.cleanup();
    this.listeners = [];
    for (const t of this.timers) {
      if (t.kind === 'timeout') window.clearTimeout(t.id);
      else window.clearInterval(t.id);
    }
    this.timers = [];
    this.entries.clear();
    this.scopeIndex.clear();
    this.baselineSnapshot = null;
  }
}
