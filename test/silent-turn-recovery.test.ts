import { describe, expect, it } from "vitest";
import { decideSilentTurnRecovery } from "../src/sessions/silent-turn-recovery";
import { trimPendingMessagesToLimit } from "../src/sessions/session-resumption";

const eligibleTurn = {
  turnComplete: true,
  responseHasAudio: false,
  retryPending: false,
  retryAlreadyUsed: false,
  hasRecentUserInput: true,
  safeToRetry: true,
};

describe("silent assistant-turn recovery", () => {
  it("does nothing to a normally audible completed response", () => {
    expect(decideSilentTurnRecovery({ ...eligibleTurn, responseHasAudio: true })).toBe("normal");
  });

  it("allows one retry after a completed turn with no audio and a known user request", () => {
    expect(decideSilentTurnRecovery(eligibleTurn)).toBe("retry");
  });

  it("marks the retry recovered once audio arrives", () => {
    expect(decideSilentTurnRecovery({
      ...eligibleTurn,
      responseHasAudio: true,
      retryPending: true,
      retryAlreadyUsed: true,
    })).toBe("recovered");
  });

  it("fails clearly at the next turn boundary if the retry is also silent", () => {
    expect(decideSilentTurnRecovery({
      ...eligibleTurn,
      retryPending: true,
      retryAlreadyUsed: true,
    })).toBe("failed");
  });

  it("never retries without a recent request or while a conflicting flow is active", () => {
    expect(decideSilentTurnRecovery({ ...eligibleTurn, hasRecentUserInput: false })).toBe("normal");
    expect(decideSilentTurnRecovery({ ...eligibleTurn, safeToRetry: false })).toBe("normal");
    expect(decideSilentTurnRecovery({ ...eligibleTurn, retryAlreadyUsed: true })).toBe("failed");
    expect(decideSilentTurnRecovery({ ...eligibleTurn, turnComplete: false })).toBe("wait");
  });

  it("leaves unacknowledged user input intact when a recovery cue is queued", () => {
    const pending = [
      { payload: { realtimeInput: { audio: { data: "unacknowledged-user-audio" } } }, chars: 48 },
      { payload: { clientContent: { turns: [{ role: "user", parts: [{ text: "repeat aloud once" }] }] } }, chars: 42 },
    ];
    const before = pending.map((item) => JSON.stringify(item.payload));

    expect(decideSilentTurnRecovery(eligibleTurn)).toBe("retry");
    const bounded = trimPendingMessagesToLimit(pending, 128, 90);

    expect(bounded.droppedNonReplaceable).toBe(false);
    expect(pending.map((item) => JSON.stringify(item.payload))).toEqual(before);
    expect(pending[0].payload).toHaveProperty("realtimeInput.audio");
    expect(pending[1].payload).toHaveProperty("clientContent");
  });
});
