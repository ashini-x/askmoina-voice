import { describe, expect, it } from "vitest";
import {
  beginTurnLatencyMeasurement,
  measureFirstAudioAfterBoundary,
  measureTurnInterruptedBeforeFirstAudio,
} from "../src/sessions/turn-latency";

describe("turn boundary to first-audio measurement", () => {
  it("measures milliseconds from an activity boundary to the first audio frame", () => {
    const pending = beginTurnLatencyMeasurement(10_000);
    expect(measureFirstAudioAfterBoundary(pending, 11_234, true)).toEqual({
      latencyMs: 1_234,
    });
  });

  it("does not record a measurement for a non-audio provider frame", () => {
    const pending = beginTurnLatencyMeasurement(10_000);
    expect(measureFirstAudioAfterBoundary(pending, 11_234, false)).toBeNull();
  });

  it("rejects absent or invalid boundary timestamps", () => {
    expect(beginTurnLatencyMeasurement(Number.NaN)).toBeNull();
    expect(beginTurnLatencyMeasurement(Number.POSITIVE_INFINITY)).toBeNull();
    expect(beginTurnLatencyMeasurement(-1)).toBeNull();
    expect(measureFirstAudioAfterBoundary(null, 11_234, true)).toBeNull();
  });

  it("rejects invalid or earlier first-audio timestamps", () => {
    const pending = beginTurnLatencyMeasurement(10_000);
    expect(measureFirstAudioAfterBoundary(pending, Number.NaN, true)).toBeNull();
    expect(measureFirstAudioAfterBoundary(pending, 9_999, true)).toBeNull();
  });

  it("rounds fractional millisecond readings consistently", () => {
    const pending = beginTurnLatencyMeasurement(10_000.2);
    expect(measureFirstAudioAfterBoundary(pending, 10_123.6, true)).toEqual({
      latencyMs: 123,
    });
  });
});


describe("interruption-aware turn measurement", () => {
  it("classifies user speech before assistant audio separately from response latency", () => {
    const pending = beginTurnLatencyMeasurement(10_000);
    expect(measureTurnInterruptedBeforeFirstAudio(pending, 10_450)).toEqual({
      outcome: "interrupted_before_first_audio",
      elapsedMs: 450,
    });
    expect(measureFirstAudioAfterBoundary(pending, 10_450, true)).toEqual({ latencyMs: 450 });
  });

  it("does not count absent, invalid, or out-of-order samples as interruptions", () => {
    const pending = beginTurnLatencyMeasurement(10_000);
    expect(measureTurnInterruptedBeforeFirstAudio(null, 10_450)).toBeNull();
    expect(measureTurnInterruptedBeforeFirstAudio(pending, Number.NaN)).toBeNull();
    expect(measureTurnInterruptedBeforeFirstAudio(pending, 9_999)).toBeNull();
    expect(measureTurnInterruptedBeforeFirstAudio(beginTurnLatencyMeasurement(-1), 10_450)).toBeNull();
  });

  it("does not mutate the pending boundary while classifying an interruption", () => {
    const pending = beginTurnLatencyMeasurement(10_000);
    measureTurnInterruptedBeforeFirstAudio(pending, 10_450);
    expect(pending).toEqual({ boundaryAtMs: 10_000 });
    expect(measureFirstAudioAfterBoundary(pending, 10_600, true)).toEqual({ latencyMs: 600 });
  });
});
