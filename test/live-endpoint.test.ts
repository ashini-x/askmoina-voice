import { describe, expect, it } from "vitest";
import { buildLiveWebSocketUrl } from "../src/sessions/live-endpoint";

describe("Vertex Live WebSocket endpoint selection", () => {
  it("uses the GA v1 service for Gemini 3.8 Live", () => {
    expect(buildLiveWebSocketUrl("us-central1-aiplatform.googleapis.com", "gemini-3.8-live"))
      .toBe("https://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent");
  });

  it("keeps older Live preview models on v1beta1", () => {
    expect(buildLiveWebSocketUrl("us-central1-aiplatform.googleapis.com", "gemini-2.5-flash-native-audio-preview-12-2025"))
      .toBe("https://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent");
  });

  it("accepts a Gemini 3.8 Live suffix without changing the API version", () => {
    expect(buildLiveWebSocketUrl("aiplatform.googleapis.com", "gemini-3.8-live-preview"))
      .toContain(".v1.LlmBidiService/");
  });

  it("rejects invalid host/model values before constructing the URL", () => {
    expect(() => buildLiveWebSocketUrl("bad/host", "gemini-3.8-live")).toThrow();
    expect(() => buildLiveWebSocketUrl("aiplatform.googleapis.com", "")).toThrow();
  });
});
