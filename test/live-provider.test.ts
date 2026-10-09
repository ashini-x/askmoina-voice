import { describe, expect, it } from "vitest";
import {
  getLiveModelResource,
  getLiveVoiceName,
  hasVoiceCredentials,
  isUsingGeminiDeveloperApi,
} from "../src/sessions/live-provider";

describe("Gemini Live provider selection", () => {
  const vertexEnv = {
    GCP_PROJECT_ID: "test-project",
    GCP_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}',
    GEMINI_LOCATION: "us-central1",
    GEMINI_MODEL: "gemini-3.8-live",
  };

  it("uses the Gemini API only when its server-side key is configured", () => {
    expect(isUsingGeminiDeveloperApi({ GEMINI_API_KEY: "  test-key  " })).toBe(true);
    expect(isUsingGeminiDeveloperApi({ GEMINI_API_KEY: " " })).toBe(false);
    expect(hasVoiceCredentials({ GCP_PROJECT_ID: "", GEMINI_API_KEY: "test-key" })).toBe(true);
    expect(hasVoiceCredentials(vertexEnv)).toBe(true);
    expect(hasVoiceCredentials({ GCP_PROJECT_ID: "test-project" })).toBe(false);
  });

  it("uses the Gemini API model resource when selecting its endpoint", () => {
    expect(getLiveModelResource(vertexEnv, "gemini-api")).toBe("models/gemini-3.8-live");
  });

  it("preserves the Vertex AI resource format for the fallback provider", () => {
    expect(getLiveModelResource(vertexEnv, "vertex-ai")).toBe(
      "projects/test-project/locations/us-central1/publishers/google/models/gemini-3.8-live",
    );
  });

  it("defaults to the built-in Aoede voice and supports a configured override", () => {
    expect(getLiveVoiceName({})).toBe("Aoede");
    expect(getLiveVoiceName({ GEMINI_LIVE_VOICE: "  Kore " })).toBe("Kore");
  });
});
