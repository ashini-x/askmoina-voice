import { describe, expect, it } from "vitest";
import {
  getUserFacingDisconnectNotice,
  safeWebSocketCloseCode,
} from "../src/sessions/disconnect-message";

describe("AskMoina disconnect explanations", () => {
  it("explains the configured session time limit", () => {
    expect(getUserFacingDisconnectNotice("Session time limit reached", 540, 1000)).toEqual({
      state: "ended",
      code: "session_timeout",
      message: "This conversation reached its time limit (about 9 minutes). Tap Start talking to begin another conversation.",
    });
  });

  it("distinguishes provider disconnects from a question-count limit", () => {
    const notice = getUserFacingDisconnectNotice("Voice provider disconnected", 540, 1006);
    expect(notice?.code).toBe("provider_disconnected");
    expect(notice?.message).toContain("not a question-count limit");
    expect(notice?.message).toContain("network or voice service interrupted it");
  });

  it("provides a retry hint for provider socket errors", () => {
    const notice = getUserFacingDisconnectNotice("Voice provider socket error", 540, 1011);
    expect(notice?.code).toBe("provider_error");
    expect(notice?.message).toContain("Tap Start talking");
  });

  it("explains an invalid microphone audio frame without calling it a question limit", () => {
    const notice = getUserFacingDisconnectNotice("Invalid PCM audio frame", 540, 1008);
    expect(notice?.code).toBe("invalid_audio_frame");
    expect(notice?.message).toContain("microphone audio packet");
    expect(notice?.message).toContain("not a question limit");
  });

  it("identifies incoming audio rate-limit closures", () => {
    const notice = getUserFacingDisconnectNotice("Audio input rate limit exceeded", 540, 1008);
    expect(notice?.code).toBe("audio_rate_limit");
    expect(notice?.message).toContain("Audio packets arrived faster");
    expect(notice?.message).toContain("not a question-count limit");
  });

  it("explains upstream policy close codes separately from quota limits", () => {
    const notice = getUserFacingDisconnectNotice("Voice provider disconnected", 540, 1008);
    expect(notice?.message).toContain("policy code 1008");
    expect(notice?.message).toContain("not a question-count cap");
  });

  it("does not send a server error notice for normal user disconnects", () => {
    expect(getUserFacingDisconnectNotice("Client disconnected", 540, 1000)).toBeNull();
  });

  it("normalizes close codes browsers may not send", () => {
    expect(safeWebSocketCloseCode(1000)).toBe(1000);
    expect(safeWebSocketCloseCode(1006)).toBe(1011);
    expect(safeWebSocketCloseCode(1015)).toBe(1011);
    expect(safeWebSocketCloseCode(3001)).toBe(3001);
  });
});
