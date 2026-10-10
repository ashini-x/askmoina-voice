import { describe, expect, it } from "vitest";
import {
  buildVoiceGenerationConfig,
  CANDIDATE_A_LIVE_VOICE_ID,
  DEFAULT_LIVE_VOICE_NAME,
  PREBUILT_LIVE_VOICES,
  isPrebuiltLiveVoiceName,
} from "../src/sessions/voice-config";

describe("Vertex Live voice configuration", () => {
  it("exposes the 30 documented prebuilt voice names for audition", () => {
    expect(PREBUILT_LIVE_VOICES).toHaveLength(30);
    for (const voice of PREBUILT_LIVE_VOICES) {
      expect(isPrebuiltLiveVoiceName(voice.name)).toBe(true);
      expect(buildVoiceGenerationConfig(voice.name)).toEqual({
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.name } },
        },
      });
    }
  });

  it("rejects unlisted, misspelled, or differently cased voice names", () => {
    expect(isPrebuiltLiveVoiceName("Zephyr")).toBe(true);
    expect(isPrebuiltLiveVoiceName("zephyr")).toBe(false);
    expect(isPrebuiltLiveVoiceName("voice_custom_test")).toBe(false);
    expect(isPrebuiltLiveVoiceName(undefined)).toBe(false);
  });

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

  it("trims a configured prebuilt voice name while preserving audio-only output", () => {
    expect(buildVoiceGenerationConfig("  Aoede  ")).toEqual({
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Aoede" },
        },
      },
    });
  });

  it("uses Candidate A's tested prompted voice ID directly in Live", () => {
    expect(CANDIDATE_A_LIVE_VOICE_ID).toBe("voice_6f4c602c-c79d-4a54-9bb1-c1549aab9c05");
    expect(buildVoiceGenerationConfig("Leda", CANDIDATE_A_LIVE_VOICE_ID)).toEqual({
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          voice: "voice_6f4c602c-c79d-4a54-9bb1-c1549aab9c05",
        },
      },
    });
  });

  it("gives a nonblank prompted voice ID precedence over a prebuilt voice name", () => {
    expect(buildVoiceGenerationConfig("Aoede", " voice_custom_test ")).toEqual({
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          voice: "voice_custom_test",
        },
      },
    });
  });

  it("falls back to Leda when the prebuilt voice setting is blank", () => {
    expect(buildVoiceGenerationConfig("  ")).toEqual({
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Leda" },
        },
      },
    });
  });

  it("falls back to the configured prebuilt voice when the custom ID is blank", () => {
    expect(buildVoiceGenerationConfig(" Aoede ", "  ")).toEqual({
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Aoede" },
        },
      },
    });
  });
});
