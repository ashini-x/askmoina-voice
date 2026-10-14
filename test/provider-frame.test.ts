import { describe, expect, it } from "vitest";
import { inspectProviderControlFrame, isProviderAudioFrame } from "../src/sessions/provider-frame";

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

describe("provider audio-frame detection", () => {
  it("recognizes camelCase and snake_case inline audio payloads without parsing them", () => {
    expect(isProviderAudioFrame('{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AAAA"}}]}}')).toBe(true);
    expect(isProviderAudioFrame('{"server_content":{"model_turn":{"parts":[{"inline_data":{"mime_type":"audio/pcm;rate=24000","data":"AAAA"}}]}}')).toBe(true);
  });

  it("does not classify text-only frames as audio", () => {
    expect(isProviderAudioFrame('{"serverContent":{"outputTranscription":{"text":"Hello"}}}')).toBe(false);
  });
});


describe("session continuity control frames", () => {
  it("parses camelCase resumption checkpoints without changing ordinary control shapes", () => {
    expect(inspectProviderControlFrame(JSON.stringify({
      sessionResumptionUpdate: {
        newHandle: "opaque-handle",
        resumable: true,
        lastConsumedClientMessageIndex: "42",
      },
    }))).toEqual({
      setupComplete: false,
      error: undefined,
      sessionResumptionUpdate: {
        newHandle: "opaque-handle",
        resumable: true,
        lastConsumedClientMessageIndex: "42",
      },
    });
  });

  it("recognizes GoAway and snake_case provider resumption fields", () => {
    expect(inspectProviderControlFrame(JSON.stringify({
      go_away: { time_left: "10s" },
      session_resumption_update: {
        new_handle: "opaque",
        resumable: true,
        last_consumed_client_message_index: "3",
      },
    }))).toMatchObject({
      goAway: true,
      sessionResumptionUpdate: {
        newHandle: "opaque",
        resumable: true,
        lastConsumedClientMessageIndex: "3",
      },
    });
  });
});
