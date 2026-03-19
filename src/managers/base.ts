/**
 * Subscriber callback for registry change notifications.
 */
export type RegistrySubscriber<K, V> = (
  operation: "upsert" | "remove" | "bulk_load",
  key: K | undefined,
  oldValue: V | undefined,
  newValue: V | undefined,
  version: number,
) => void;

/**
 * Generic, versioned component registry.
 * Simplified from Python's AsyncRegistry — TS is single-threaded so no RW lock needed.
 */
export class ComponentRegistry<K, V> {
  private items = new Map<K, V>();
  private _version = 0;
  private subscribers: RegistrySubscriber<K, V>[] = [];

  get version(): number {
    return this._version;
  }

  get size(): number {
    return this.items.size;
  }

  subscribe(fn: RegistrySubscriber<K, V>): void {
    this.subscribers.push(fn);
  }

  get(key: K): V | undefined {
    return this.items.get(key);
  }

  has(key: K): boolean {
    return this.items.has(key);
  }

  keys(): K[] {
    return Array.from(this.items.keys()).sort();
  }

  values(): V[] {
    const sorted = Array.from(this.items.keys()).sort();
    return sorted.map((k) => this.items.get(k)!);
  }

  upsert(key: K, value: V): void {
    const oldValue = this.items.get(key);
    this.items.set(key, value);
    this._version++;
    this.notify("upsert", key, oldValue, value);
  }

  remove(key: K): V {
    const value = this.items.get(key);
    if (value === undefined) {
      throw new Error(`Key not found in registry`);
    }
    this.items.delete(key);
    this._version++;
    this.notify("remove", key, value, undefined);
    return value;
  }

  bulkLoad(items: Iterable<[K, V]>): void {
    for (const [key, value] of items) {
      this.items.set(key, value);
    }
    this._version++;
    this.notify("bulk_load", undefined, undefined, undefined);
  }

  private notify(
    operation: "upsert" | "remove" | "bulk_load",
    key: K | undefined,
    oldValue: V | undefined,
    newValue: V | undefined,
  ): void {
    for (const fn of this.subscribers) {
      fn(operation, key, oldValue, newValue, this._version);
    }
  }
}
