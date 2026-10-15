/**
 * Gemini/Vertex Live media resolution is model-side token allocation, not JPEG dimensions.
 * Use high detail only for camera Co-Pilot; audio-only voice sessions retain their existing
 * latency and token profile.
 */
export function configureCopilotMediaResolution(
  generationConfig: Record<string, unknown>,
  copilotMode: boolean,
): Record<string, unknown> {
  return copilotMode
    ? { ...generationConfig, mediaResolution: "MEDIA_RESOLUTION_HIGH" }
    : generationConfig;
}
