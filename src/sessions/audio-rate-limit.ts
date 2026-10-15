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


export type RealtimeMediaKind = "audio" | "video";

/**
 * Keep continuous microphone PCM and camera JPEGs within independent budgets.
 * Camera frames are replaceable visual context and must not spend the quota
 * required for non-replaceable speech input.
 */
export class RealtimeMediaRateLimiter {
  private readonly audioFrameBucket: TokenBucket;
  private readonly audioByteBucket: TokenBucket;
  private readonly videoFrameBucket: TokenBucket;
  private readonly videoByteBucket: TokenBucket;

  constructor(now: number = Date.now()) {
    const burstSeconds = 3;
    this.audioFrameBucket = new TokenBucket(60, burstSeconds, now);
    this.audioByteBucket = new TokenBucket(64 * 1024, burstSeconds, now);
    this.videoFrameBucket = new TokenBucket(2, burstSeconds, now);
    this.videoByteBucket = new TokenBucket(64 * 1024, burstSeconds, now);
  }

  consume(kind: RealtimeMediaKind, encodedChars: number, now: number = Date.now()): boolean {
    const frameBucket = kind === "video" ? this.videoFrameBucket : this.audioFrameBucket;
    const byteBucket = kind === "video" ? this.videoByteBucket : this.audioByteBucket;
    const frameAllowed = frameBucket.consume(1, now);
    const bytesAllowed = byteBucket.consume(encodedChars, now);
    return frameAllowed && bytesAllowed;
  }
}
