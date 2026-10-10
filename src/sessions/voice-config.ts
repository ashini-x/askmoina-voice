export const DEFAULT_LIVE_VOICE_NAME = "Leda";

/** Candidate A is a stored prompted voice that Gemini Live accepts by ID. */
export const CANDIDATE_A_LIVE_VOICE_ID = "voice_6f4c602c-c79d-4a54-9bb1-c1549aab9c05";

/** Build the audio-only generation settings for the Vertex AI Gemini Live session.
 * A configured prompted voice ID takes priority; prebuilt voices remain the fallback.
 */
export function buildVoiceGenerationConfig(configuredVoiceName?: string, configuredVoiceId?: string) {
  const voiceId = configuredVoiceId?.trim();
  if (voiceId) {
    return {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          voice: voiceId,
        },
      },
    };
  }

  const voiceName = configuredVoiceName?.trim() || DEFAULT_LIVE_VOICE_NAME;
  return {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName },
      },
    },
  };
}
