export class SingleFlight<T> {
  private readonly pending = new Map<string, Promise<T>>();

  /**
   * Coalesce concurrent work for the same key without caching completed results.
   * The map retains only in-flight promises, so fresh/current lookups are not served
   * from a stale result cache after the first request finishes.
   */
  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const pending = Promise.resolve().then(work);
    this.pending.set(key, pending);
    void pending.finally(() => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }).catch(() => undefined);
    return pending;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
