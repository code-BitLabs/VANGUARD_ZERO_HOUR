export interface Poolable {
  active: boolean;
  reset(): void;
}

export class ObjectPool<T extends Poolable> {
  private readonly items: T[] = [];
  private cursor = 0;

  constructor(
    public readonly capacity: number,
    factory: (index: number) => T,
    private readonly onRecycle?: (item: T) => void
  ) {
    for (let i = 0; i < capacity; i++) {
      const item = factory(i);
      item.active = false;
      this.items.push(item);
    }
  }

  acquire(): T {
    const len = this.items.length;
    for (let i = 0; i < len; i++) {
      const idx = (this.cursor + i) % len;
      const candidate = this.items[idx];
      if (!candidate.active) {
        this.cursor = (idx + 1) % len;
        candidate.reset();
        candidate.active = true;
        return candidate;
      }
    }
    // Graceful fixed-capacity overflow: evict oldest slot in ring order
    const evicted = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % len;
    this.onRecycle?.(evicted);
    evicted.reset();
    evicted.active = true;
    return evicted;
  }

  release(item: T): void {
    if (!item.active) return;
    item.active = false;
    this.onRecycle?.(item);
  }

  releaseAll(): void {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.active) {
        item.active = false;
        this.onRecycle?.(item);
      }
    }
    this.cursor = 0;
  }

  forEachActive(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.active) {
        fn(item, i);
      }
    }
  }

  getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].active) count++;
    }
    return count;
  }

  getAll(): readonly T[] {
    return this.items;
  }
}
