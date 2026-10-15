/**
 * Gemini Live media resolution is model-side token allocation, not JPEG dimensions.
 * HIGH is appropriate for text-heavy video and small details (labels and serial numbers);
 * apply it only to camera Co-Pilot so audio-only sessions keep their existing profile.
 */
export function configureCopilotMediaResolution(
  generationConfig: Record<string, unknown>,
  copilotMode: boolean,
): Record<string, unknown> {
  return copilotMode
    ? { ...generationConfig, mediaResolution: "MEDIA_RESOLUTION_HIGH" }
    : generationConfig;
}
