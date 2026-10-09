/**
 * A token bucket allows short bursts while enforcing a sustained event rate.
 * Units are generic: frames for one bucket and encoded characters for another.
 */
export class TokenBucket {
  private readonly capacity: number;
  private tokens: number;
  private lastUpdatedAt: number;

  constructor(
    private readonly unitsPerSecond: number,
    burstSeconds: number,
    now: number = Date.now(),
  ) {
    if (!Number.isFinite(unitsPerSecond) || unitsPerSecond <= 0) {
      throw new RangeError("unitsPerSecond must be a positive number");
    }
    if (!Number.isFinite(burstSeconds) || burstSeconds < 1) {
      throw new RangeError("burstSeconds must be at least one second");
    }
    this.capacity = unitsPerSecond * burstSeconds;
    this.tokens = this.capacity;
    this.lastUpdatedAt = now;
  }

  get remaining(): number {
    return this.tokens;
  }

  consume(amount: number, now: number = Date.now()): boolean {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError("amount must be a non-negative number");
    }
    const elapsedMs = Math.max(0, now - this.lastUpdatedAt);
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (elapsedMs / 1_000) * this.unitsPerSecond,
    );
    this.lastUpdatedAt = Math.max(this.lastUpdatedAt, now);
    this.tokens -= amount;
    return this.tokens >= 0;
  }
}
