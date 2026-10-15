/**
 * Gemini 3.8 Live documents LOW and MEDIUM media-resolution levels in its Live config.
 * MEDIUM is explicit model-side frame-token allocation (not JPEG dimensions) and increases
 * visual detail for Co-Pilot while audio-only sessions retain their existing token profile.
 */
export function configureCopilotMediaResolution(
  generationConfig: Record<string, unknown>,
  copilotMode: boolean,
): Record<string, unknown> {
  return copilotMode
    ? { ...generationConfig, mediaResolution: "MEDIA_RESOLUTION_MEDIUM" }
    : generationConfig;
}
