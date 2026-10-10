export interface ProviderControlFrame {
  setupComplete: boolean;
  error?: { code?: unknown; status?: unknown; message?: unknown };
}

/**
 * Inspect only control frames in the upstream stream. Ordinary audio frames can
 * carry large base64 strings; parsing all of them creates avoidable Worker CPU work.
 * Audio frames are passed through unchanged after this lightweight key check.
 */
export function inspectProviderControlFrame(frameText: string): ProviderControlFrame | null {
  const mayContainControl =
    frameText.includes('"setup_complete"') ||
    frameText.includes('"setupComplete"') ||
    frameText.includes('"error"');

  if (!mayContainControl) return null;

  const parsed = JSON.parse(frameText) as {
    setup_complete?: unknown;
    setupComplete?: unknown;
    error?: { code?: unknown; status?: unknown; message?: unknown };
  };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Provider control frame is not a JSON object");
  }

  return {
    setupComplete: Boolean(parsed.setup_complete || parsed.setupComplete),
    error: parsed.error,
  };
}


/**
 * Identify audio-bearing model frames without parsing or copying their base64 payload.
 * Keep this cheap: it runs on each upstream frame in the live voice path.
 */
export function isProviderAudioFrame(frameText: string): boolean {
  return frameText.includes('"inlineData"') || frameText.includes('"inline_data"');
}
