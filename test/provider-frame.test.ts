import { describe, expect, it } from "vitest";
import { inspectProviderControlFrame } from "../src/sessions/provider-frame";

describe("provider control frame inspection", () => {
  it("skips parsing of ordinary audio frames", () => {
    const audioFrame = JSON.stringify({
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "A".repeat(100_000) } }]
        }
      }
    });
    expect(inspectProviderControlFrame(audioFrame)).toBeNull();
  });

  it("recognizes setup completion in camelCase provider messages", () => {
    expect(inspectProviderControlFrame(JSON.stringify({ setupComplete: {} })))
      .toEqual({ setupComplete: true, error: undefined });
  });

  it("preserves provider error metadata for diagnostic logging", () => {
    expect(inspectProviderControlFrame(JSON.stringify({ error: { code: 1008, status: "FAILED", message: "provider message" } })))
      .toEqual({ setupComplete: false, error: { code: 1008, status: "FAILED", message: "provider message" } });
  });

  it("rejects malformed control frames", () => {
    expect(() => inspectProviderControlFrame('{"setupComplete":')).toThrow();
  });
});
