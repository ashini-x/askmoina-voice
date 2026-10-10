import { describe, expect, it } from "vitest";
import { parseLiveClientInput } from "../src/sessions/copilot-protocol";

const audio = (data = "AAAA") => ({
  realtime_input: { audio: { data, mime_type: "audio/pcm;rate=16000" } },
});
const video = (data = "AAAA") => ({
  realtime_input: { video: { data, mime_type: "image/jpeg" } },
});

describe("Live Co-Pilot input protocol", () => {
  it("keeps normal voice sessions audio-only", () => {
    expect(parseLiveClientInput(audio(), false)).toEqual({ kind: "audio", data: "AAAA" });
    expect(parseLiveClientInput(video(), false)).toBeNull();
    expect(parseLiveClientInput({ tool_response: { function_responses: [{ id: "f1", name: "display_screen_overlay" }] } }, false)).toBeNull();
  });

  it("accepts one JPEG frame only in explicit co-pilot mode", () => {
    expect(parseLiveClientInput(video(), true)).toEqual({ kind: "video", data: "AAAA" });
    expect(parseLiveClientInput({ realtime_input: { video: { data: "AAAA", mime_type: "image/png" } } }, true)).toBeNull();
    expect(parseLiveClientInput({ realtime_input: { video: { data: "AAAA", mime_type: "image/jpeg", extra: true } } }, true)).toBeNull();
  });

  it("rejects invalid, malformed, or oversized media payloads", () => {
    expect(parseLiveClientInput(audio("not base64!"), false)).toBeNull();
    expect(parseLiveClientInput(video("A".repeat(12_004)), true)).toBeNull();
    expect(parseLiveClientInput({ realtime_input: { audio: { data: "AAAA", mime_type: "audio/wav" } } }, false)).toBeNull();
    expect(parseLiveClientInput({ realtime_input: { audio: { data: "AAAA", mime_type: "audio/pcm;rate=16000", url: "https://example.com" } } }, false)).toBeNull();
    expect(parseLiveClientInput({ realtime_input: { audio: { data: "AAAA", mime_type: "audio/pcm;rate=16000" }, video: { data: "AAAA", mime_type: "image/jpeg" } } }, true)).toBeNull();
  });

  it("accepts only response IDs for the declared display-only tool", () => {
    const response = { tool_response: { function_responses: [{ id: "tool_call_1", name: "display_screen_overlay" }] } };
    expect(parseLiveClientInput(response, true)).toEqual({ kind: "tool_response", ids: ["tool_call_1"] });
    expect(parseLiveClientInput({ tool_response: { function_responses: [{ id: "tool_call_1", name: "display_screen_overlay", response: { arbitrary: "data" } }] } }, true)).toBeNull();
    expect(parseLiveClientInput({ tool_response: { function_responses: [{ id: "tool_call_1", name: "external_purchase" }] } }, true)).toBeNull();
  });

  it("recognizes the explicit audio-stream end signal and rejects unknown message shapes", () => {
    expect(parseLiveClientInput({ realtime_input: { audio_stream_end: true } }, false)).toEqual({ kind: "audio_stream_end" });
    expect(parseLiveClientInput({ realtime_input: { audio_stream_end: false } }, true)).toBeNull();
    expect(parseLiveClientInput({ realtime_input: { audio: { data: "AAAA", mime_type: "audio/pcm;rate=16000" } }, extra: true }, true)).toBeNull();
    expect(parseLiveClientInput(null, true)).toBeNull();
  });
});
