import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const copilot = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
describe("voice media backpressure without app usage caps", () => {
  it("drops excess media instead of terminating a call with the old rate-limit close", () => {
    expect(worker).not.toContain('closeBoth(1008, "Audio input rate limit exceeded")');
    expect(worker).toContain("audioFramesThrottled");
  });
  it("does not show a browser-wide active conversation lock after app reservations were removed", () => {
    expect(client).not.toContain("A previous connection is still clearing");
    expect(copilot).not.toContain("A voice conversation is still active for this browser");
    expect(copilot).not.toContain('result.reason === "already_active"');
  });
  it("uses roughly 20-23 ms microphone packets at common sample rates and keeps high-rate devices below the relay packet ceiling", () => {
    expect(client).toContain("const audioBufferSize = audioContext.sampleRate > 48000 ? 2048 : 1024;");
    expect(copilot).toContain("const audioBufferSize = audioContext.sampleRate > 48000 ? 2048 : 1024;");
    expect(client).toContain("socket.bufferedAmount > 96 * 1024");
    expect(copilot).toContain("socket.bufferedAmount > 96 * 1024");
  });
  it("starts context compression well before the Live audiovisual session ceiling", () => {
    expect(worker).toContain("triggerTokens: 24_000");
    expect(worker).toContain("targetTokens: 8_000");
    expect(worker).toContain("update.resumable === true");
  });
  it("does not impose the former app-owned session timeout", () => {
    expect(worker).not.toContain("Voice session duration limit reached");
  });
  it("does not keep the old per-session search and target-selection caps", () => {
    expect(worker).not.toContain("groundedSearchCount >= 2");
    expect(worker).not.toContain("targetSelectionCount >= 12");
  });
});
