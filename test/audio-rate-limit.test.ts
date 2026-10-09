import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/sessions/audio-rate-limit";

describe("audio input rate limiting", () => {
  it("allows a brief network burst just above the one-second threshold", () => {
    const budget = new TokenBucket(65_536, 2, 1_000);
    expect(budget.consume(65_888, 2_000)).toBe(true);
    expect(budget.remaining).toBeGreaterThan(0);
  });

  it("allows buffered frames to arrive together within the burst budget", () => {
    const budget = new TokenBucket(60, 2, 1_000);
    for (let i = 0; i < 32; i += 1) {
      expect(budget.consume(1, 2_000)).toBe(true);
    }
    expect(budget.remaining).toBe(88);
  });

  it("blocks sustained excess traffic after the burst allowance is exhausted", () => {
    const budget = new TokenBucket(10, 2, 0);
    expect(budget.consume(20, 0)).toBe(true);
    expect(budget.consume(11, 1_000)).toBe(false);
    expect(budget.consume(10, 2_000)).toBe(false);
  });

  it("refills when traffic returns to the allowed rate", () => {
    const budget = new TokenBucket(10, 2, 0);
    expect(budget.consume(20, 0)).toBe(true);
    expect(budget.consume(11, 1_000)).toBe(false);
    expect(budget.consume(10, 2_500)).toBe(true);
  });
});
