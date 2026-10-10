import { describe, expect, it } from "vitest";
import { buildVoiceGenerationConfig, DEFAULT_LIVE_VOICE_NAME } from "../src/sessions/voice-config";

describe("Vertex Live voice configuration", () => {
  it("selects the documented youthful Leda voice by default", () => {
    expect(DEFAULT_LIVE_VOICE_NAME).toBe("Leda");
    expect(buildVoiceGenerationConfig()).toEqual({
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Leda" },
        },
      },
    });
  });

  it("trims a configured voice name while preserving audio-only output", () => {
    expect(buildVoiceGenerationConfig("  Aoede  ")).toEqual({
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Aoede" },
        },
      },
    });
  });

  it("falls back to Leda when the voice setting is blank", () => {
    expect(buildVoiceGenerationConfig("  ").speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName)
      .toBe("Leda");
  });
});
