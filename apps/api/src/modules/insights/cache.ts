interface Entry<V> { v: V; insertedAt: number; }

export class LruCache<K, V> {
  private map = new Map<K, Entry<V>>();
  constructor(private capacity: number, private opts: { ttlMs?: number } = {}) {}

  get(k: K): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (this.opts.ttlMs && Date.now() - e.insertedAt > this.opts.ttlMs) {
      this.map.delete(k);
      return undefined;
    }
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }

  set(k: K, v: V, insertedAt = Date.now()): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { v, insertedAt });
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value as K;
      this.map.delete(oldestKey);
    }
  }
}
