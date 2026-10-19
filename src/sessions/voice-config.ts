export const DEFAULT_LIVE_VOICE_NAME = "Zephyr";

/** Legacy stored TTS voice ID; the Gemini Live API does not accept this ID in its live VoiceConfig. */
export const CANDIDATE_A_LIVE_VOICE_ID = "voice_6f4c602c-c79d-4a54-9bb1-c1549aab9c05";

/** Voice names and style descriptors published for Gemini Live on Vertex AI. */
export const PREBUILT_LIVE_VOICES = [
  { name: "Leda", style: "Youthful" },
  { name: "Zephyr", style: "Bright" },
  { name: "Autonoe", style: "Bright" },
  { name: "Aoede", style: "Breezy" },
  { name: "Laomedeia", style: "Upbeat" },
  { name: "Sadachbia", style: "Lively" },
  { name: "Achernar", style: "Soft" },
  { name: "Vindemiatrix", style: "Gentle" },
  { name: "Sulafat", style: "Warm" },
  { name: "Callirrhoe", style: "Easy-going" },
  { name: "Puck", style: "Upbeat" },
  { name: "Fenrir", style: "Excitable" },
  { name: "Kore", style: "Firm" },
  { name: "Orus", style: "Firm" },
  { name: "Umbriel", style: "Easy-going" },
  { name: "Erinome", style: "Clear" },
  { name: "Schedar", style: "Even" },
  { name: "Achird", style: "Friendly" },
  { name: "Enceladus", style: "Breathy" },
  { name: "Algieba", style: "Smooth" },
  { name: "Algenib", style: "Gravelly" },
  { name: "Gacrux", style: "Mature" },
  { name: "Zubenelgenubi", style: "Casual" },
  { name: "Sadaltager", style: "Knowledgeable" },
  { name: "Charon", style: "Informative" },
  { name: "Iapetus", style: "Clear" },
  { name: "Despina", style: "Smooth" },
  { name: "Rasalgethi", style: "Informative" },
  { name: "Alnilam", style: "Firm" },
  { name: "Pulcherrima", style: "Forward" },
] as const;

export type PrebuiltLiveVoiceName = (typeof PREBUILT_LIVE_VOICES)[number]["name"];

export function isPrebuiltLiveVoiceName(value: string | undefined): value is PrebuiltLiveVoiceName {
  return typeof value === "string" && PREBUILT_LIVE_VOICES.some((voice) => voice.name === value);
}

/** Native Live voice output is AUDIO-only; only the Live API's supported prebuilt voice schema is sent. */
export function buildVoiceGenerationConfig(configuredVoiceName?: string, _legacyConfiguredVoiceId?: string) {
  // LIVE_VOICE_ID was a stored TTS/voice-design ID. Gemini Live rejects that value
  // in voiceConfig.voice; do not forward it or let it override the selected Live voice.
  const requestedVoiceName = configuredVoiceName?.trim();
  const voiceName = requestedVoiceName && isPrebuiltLiveVoiceName(requestedVoiceName)
    ? requestedVoiceName
    : DEFAULT_LIVE_VOICE_NAME;
  return {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName },
      },
    },
  };
}
