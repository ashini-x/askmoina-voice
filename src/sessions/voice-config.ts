export const DEFAULT_LIVE_VOICE_NAME = "Leda";

/** Build the audio-only generation settings for the Vertex AI Gemini Live session. */
export function buildVoiceGenerationConfig(configuredVoiceName?: string) {
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
