import { describe, expect, it } from "vitest";
import { RealtimeMediaRateLimiter, TokenBucket } from "../src/sessions/audio-rate-limit";

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


describe("independent audiovisual input budgets", () => {
  it("preserves speech capacity during 160 seconds of maximum-sized camera frames", () => {
    const limiter = new RealtimeMediaRateLimiter(0);
    for (let second = 0; second < 160; second += 1) {
      const secondStart = second * 1_000;
      // A maximum-sized camera frame near once per second plus realistic
      // continuous PCM microphone callbacks for the same 160-second window.
      expect(limiter.consume("video", 48_080, secondStart)).toBe(true);
      for (let frame = 0; frame < 47; frame += 1) {
        expect(limiter.consume("audio", 1_000, secondStart + frame * 21)).toBe(true);
      }
    }
  });

  it("keeps speech capacity intact after sustained excessive camera traffic is rejected", () => {
    const limiter = new RealtimeMediaRateLimiter(0);
    let firstRejectedSecond = -1;
    for (let second = 0; second < 60; second += 1) {
      if (!limiter.consume("video", 70_000, second * 1_000)) {
        firstRejectedSecond = second;
        break;
      }
    }
    expect(firstRejectedSecond).toBeGreaterThan(0);
    expect(limiter.consume("audio", 1_000, firstRejectedSecond * 1_000)).toBe(true);
  });
});
