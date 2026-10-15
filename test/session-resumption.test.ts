import { describe, expect, it } from "vitest";
import {
  canAdvanceSessionResumptionCheckpoint,
  isCheckpointWithinSentMessageWindow,
  isReplayWindowComplete,
  parseSessionResumptionCheckpoint,
  trimPendingMessagesToLimit,
  trimReplayBufferToLimit,
  type ReplayMessage,
  type SessionResumptionCheckpoint,
} from "../src/sessions/session-resumption";
import { configureCopilotMediaResolution } from "../src/sessions/media-resolution";

describe("Live session resumption checkpoints", () => {
  it("does not advance the replay cursor when the provider reports an empty non-resumable handle", () => {
    const lastGoodCheckpoint: SessionResumptionCheckpoint = {
      handle: "previous-valid-handle",
      lastConsumedClientMessageIndex: 4,
    };
    const update = {
      resumable: false,
      newHandle: "",
      lastConsumedClientMessageIndex: "12",
    };

    const candidate = parseSessionResumptionCheckpoint(update);

    expect(candidate).toBeNull();
    expect(canAdvanceSessionResumptionCheckpoint(lastGoodCheckpoint, candidate)).toBe(false);
    expect(lastGoodCheckpoint).toEqual({
      handle: "previous-valid-handle",
      lastConsumedClientMessageIndex: 4,
    });
  });

  it("requires both a valid handle and a valid consumed-message index", () => {
    expect(parseSessionResumptionCheckpoint({
      resumable: true,
      newHandle: "",
      lastConsumedClientMessageIndex: 3,
    })).toBeNull();
    expect(parseSessionResumptionCheckpoint({
      resumable: true,
      newHandle: "valid-handle",
      lastConsumedClientMessageIndex: "not-an-index",
    })).toBeNull();
  });

  it("accepts valid checkpoints and rejects older indexes", () => {
    const current = { handle: "old", lastConsumedClientMessageIndex: 5 };
    const candidate = parseSessionResumptionCheckpoint({
      resumable: true,
      newHandle: "new",
      lastConsumedClientMessageIndex: "8",
    });
    const stale = parseSessionResumptionCheckpoint({
      resumable: true,
      newHandle: "stale",
      lastConsumedClientMessageIndex: 4,
    });

    expect(candidate).toEqual({ handle: "new", lastConsumedClientMessageIndex: 8 });
    expect(canAdvanceSessionResumptionCheckpoint(current, candidate)).toBe(true);
    expect(canAdvanceSessionResumptionCheckpoint(current, stale)).toBe(false);
  });
});

describe("checkpoint index space", () => {
  it("rejects non-zero checkpoint cursors before a resumed socket has sent any replayed input", () => {
    const nonZero = parseSessionResumptionCheckpoint({
      resumable: true,
      newHandle: "resumed-handle",
      lastConsumedClientMessageIndex: "3",
    });
    const zero = parseSessionResumptionCheckpoint({
      resumable: true,
      newHandle: "resumed-handle",
      lastConsumedClientMessageIndex: "0",
    });

    expect(isCheckpointWithinSentMessageWindow(nonZero, 0)).toBe(false);
    expect(isCheckpointWithinSentMessageWindow(zero, 0)).toBe(true);
    expect(isCheckpointWithinSentMessageWindow(nonZero, 3)).toBe(true);
  });
});

describe("bounded Live replay buffer", () => {
  it("marks sustained unacknowledged input overflow as unsafe to replay", () => {
    const buffer: ReplayMessage[] = [];
    const maxChars = 160;
    let chars = 0;
    let highestEvicted = -1;
    const checkpointConsumedIndex = 1;

    // Simulates continuous microphone/video packets while provider acknowledgements stall.
    for (let index = 1; index <= 80; index += 1) {
      const encoded = `frame-${index}-${"x".repeat(24)}`;
      buffer.push({ index, encoded });
      chars += encoded.length;
      const trimmed = trimReplayBufferToLimit(buffer, maxChars, chars, checkpointConsumedIndex, highestEvicted);
      chars = trimmed.bufferChars;
      highestEvicted = trimmed.highestEvictedClientMessageIndex;
    }

    expect(chars).toBeLessThanOrEqual(maxChars);
    expect(buffer.length).toBeGreaterThan(0);
    expect(highestEvicted).toBeGreaterThan(checkpointConsumedIndex);
    expect(isReplayWindowComplete(highestEvicted, checkpointConsumedIndex)).toBe(false);
  });

  it("does not flag evictions already covered by the current checkpoint", () => {
    const buffer: ReplayMessage[] = [
      { index: 1, encoded: "x".repeat(20) },
      { index: 2, encoded: "y".repeat(20) },
    ];
    const trimmed = trimReplayBufferToLimit(buffer, 0, 40, 2, -1);

    expect(trimmed.highestEvictedClientMessageIndex).toBe(-1);
    expect(isReplayWindowComplete(trimmed.highestEvictedClientMessageIndex, 2)).toBe(true);
  });
});

describe("pending Live input queue overflow", () => {
  it("marks dropped microphone input as a continuity failure", () => {
    const pending = [
      { payload: { realtimeInput: { audio: { data: "first" } } }, chars: 40 },
      { payload: { realtimeInput: { audio: { data: "second" } } }, chars: 40 },
    ];
    const trimmed = trimPendingMessagesToLimit(pending, 40, 80);

    expect(trimmed.bufferChars).toBeLessThanOrEqual(40);
    expect(trimmed.droppedCount).toBe(1);
    expect(trimmed.droppedNonReplaceable).toBe(true);
  });

  it("allows old camera frames to be replaced without marking audio continuity lost", () => {
    const pending = [
      { payload: { realtimeInput: { video: { data: "old-frame" } } }, chars: 40 },
      { payload: { realtimeInput: { audio: { data: "microphone" } } }, chars: 40 },
    ];
    const trimmed = trimPendingMessagesToLimit(pending, 40, 80);

    expect(trimmed.bufferChars).toBe(40);
    expect(trimmed.droppedCount).toBe(1);
    expect(trimmed.droppedNonReplaceable).toBe(false);
    expect(pending[0].payload).toHaveProperty("realtimeInput.audio");
  });
});

describe("camera model-side media resolution", () => {
  it("uses high media resolution for text-heavy Gemini 3.8 Live Co-Pilot while keeping audio-only config unchanged", () => {
    const base = { responseModalities: ["AUDIO"], speechConfig: { voice: "Leda" } };
    const voice = configureCopilotMediaResolution(base, false);
    const copilot = configureCopilotMediaResolution(base, true);

    expect(voice).toBe(base);
    expect(voice).not.toHaveProperty("mediaResolution");
    expect(copilot).toEqual({ ...base, mediaResolution: "MEDIA_RESOLUTION_HIGH" });
  });
});
