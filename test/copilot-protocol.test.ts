import { describe, expect, it } from "vitest";
import { parseLiveClientInput } from "../src/sessions/copilot-protocol";

const audio = (data = "AAAA") => ({
  realtime_input: { audio: { data, mime_type: "audio/pcm;rate=16000" } },
});
const video = (data = "AAAA") => ({
  realtime_input: { video: { data, mime_type: "image/jpeg" } },
});

describe("Live Co-Pilot input protocol", () => {
  it("keeps normal voice sessions from accessing video and overlay tools", () => {
    expect(parseLiveClientInput(audio(), false)).toEqual({ kind: "audio", data: "AAAA" });
    expect(parseLiveClientInput(video(), false)).toBeNull();
    expect(parseLiveClientInput({ tool_response: { function_responses: [{ id: "f1", name: "display_screen_overlay" }] } }, false)).toBeNull();
  });

  it("accepts the one-shot initial greeting signal only in Co-Pilot mode", () => {
    expect(parseLiveClientInput({ initial_greeting: true }, true)).toEqual({ kind: "initial_greeting" });
    expect(parseLiveClientInput({ initial_greeting: true }, false)).toBeNull();
    expect(parseLiveClientInput({ initial_greeting: false }, true)).toBeNull();
    expect(parseLiveClientInput({ initial_greeting: true, extra: true }, true)).toBeNull();
  });

  it("accepts normalized target-selection points only in Co-Pilot mode", () => {
    expect(parseLiveClientInput({ target_selection: { x: 0.34, y: 0.72 } }, true)).toEqual({
      kind: "target_selection",
      x: 0.34,
      y: 0.72,
    });
    expect(parseLiveClientInput({ target_selection: { x: 0, y: 0.999 } }, true)).toEqual({
      kind: "target_selection",
      x: 0,
      y: 0.999,
    });
    expect(parseLiveClientInput({ target_selection: { x: 0.34, y: 0.72 } }, false)).toBeNull();
    expect(parseLiveClientInput({ target_selection: { x: -0.1, y: 0.5 } }, true)).toBeNull();
    expect(parseLiveClientInput({ target_selection: { x: 1, y: 0.5 } }, true)).toBeNull();
    expect(parseLiveClientInput({ target_selection: { x: 0.5, y: Number.NaN } }, true)).toBeNull();
    expect(parseLiveClientInput({ target_selection: { x: 0.5, y: 0.5, command: "run" } }, true)).toBeNull();
    expect(parseLiveClientInput({ target_selection: { x: "0.5", y: 0.5 } }, true)).toBeNull();
  });

  it("accepts bounded text turns only in normal voice mode for grounded smoke/fallback turns", () => {
    expect(parseLiveClientInput({ text_input: "Search the web for the latest Android release." }, false)).toEqual({
      kind: "text_input",
      text: "Search the web for the latest Android release.",
    });
    expect(parseLiveClientInput({ text_input: "  " }, false)).toBeNull();
    expect(parseLiveClientInput({ text_input: "x".repeat(1_501) }, false)).toBeNull();
    expect(parseLiveClientInput({ text_input: "find" + String.fromCharCode(0) + "something" }, false)).toBeNull();
    expect(parseLiveClientInput({ text_input: "test" }, true)).toBeNull();
    expect(parseLiveClientInput({ text_input: "test", extra: true }, false)).toBeNull();
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

  it("accepts only bounded result strings for the declared display-only tool", () => {
    const response = { tool_response: { function_responses: [{ id: "tool_call_1", name: "display_screen_overlay" }] } };
    expect(parseLiveClientInput(response, true)).toEqual({
      kind: "tool_response",
      responses: [{ id: "tool_call_1", name: "display_screen_overlay", result: "The on-screen target prompt or approximate overlay was handled by the client." }]
    });
    expect(parseLiveClientInput({
      tool_response: { function_responses: [{
        id: "tool_call_1",
        name: "display_screen_overlay",
        response: { result: "Scene evidence: blue cup; confidence 0.92.\\nUse only if fresh." }
      }] }
    }, true)).toEqual({
      kind: "tool_response",
      responses: [{ id: "tool_call_1", result: "Scene evidence: blue cup; confidence 0.92.\\nUse only if fresh." }]
    });
    expect(parseLiveClientInput({ tool_response: { function_responses: [{ id: "tool_call_1", name: "display_screen_overlay", response: { arbitrary: "data" } }] } }, true)).toBeNull();
    expect(parseLiveClientInput({ tool_response: { function_responses: [{ id: "tool_call_1", name: "display_screen_overlay", response: { result: "x".repeat(3_001) } }] } }, true)).toBeNull();
    expect(parseLiveClientInput({ tool_response: { function_responses: [{ id: "tool_call_1", name: "external_purchase" }] } }, true)).toBeNull();
    expect(parseLiveClientInput({
      tool_response: { function_responses: [{ id: "card_call_1", name: "display_response_card", response: { result: "The card payload passed validation; rendering is not enabled yet." } }] }
    }, true)).toEqual({
      kind: "tool_response",
      responses: [{ id: "card_call_1", name: "display_response_card", result: "The card payload passed validation; rendering is not enabled yet." }]
    });
    expect(parseLiveClientInput({
      tool_response: { function_responses: [{ id: "card_call_1", name: "display_response_card", response: { result: "ok" } }] }
    }, false)).toBeNull();
  });

  it("recognizes the explicit audio-stream end signal and rejects unknown message shapes", () => {
    expect(parseLiveClientInput({ realtime_input: { audio_stream_end: true } }, false)).toEqual({ kind: "audio_stream_end" });
    expect(parseLiveClientInput({ realtime_input: { audio_stream_end: false } }, true)).toBeNull();
    expect(parseLiveClientInput({ realtime_input: { audio: { data: "AAAA", mime_type: "audio/pcm;rate=16000" } }, extra: true }, true)).toBeNull();
    expect(parseLiveClientInput(null, true)).toBeNull();
  });
});
