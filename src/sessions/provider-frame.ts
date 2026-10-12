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


export interface ProviderUsageMetrics {
  promptTokenCount?: number;
  responseTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

export function inspectProviderUsageMetrics(frameText: string): ProviderUsageMetrics | null {
  if (!frameText.includes('"usageMetadata"') && !frameText.includes('"usage_metadata"')) return null;
  let parsed: any;
  try { parsed = JSON.parse(frameText); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const containers = [
    parsed.usageMetadata, parsed.usage_metadata,
    parsed.serverContent?.usageMetadata, parsed.serverContent?.usage_metadata,
    parsed.server_content?.usageMetadata, parsed.server_content?.usage_metadata,
  ];
  const usage = containers.find((v) => v && typeof v === "object" && !Array.isArray(v));
  if (!usage) return null;
  const count = (...values: unknown[]): number | undefined => {
    const value = values.find((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
    return typeof value === "number" ? value : undefined;
  };
  const metrics: ProviderUsageMetrics = {
    promptTokenCount: count(usage.promptTokenCount, usage.prompt_token_count),
    responseTokenCount: count(usage.responseTokenCount, usage.response_token_count, usage.candidatesTokenCount, usage.candidates_token_count),
    totalTokenCount: count(usage.totalTokenCount, usage.total_token_count),
    cachedContentTokenCount: count(usage.cachedContentTokenCount, usage.cached_content_token_count),
  };
  return Object.values(metrics).some((v) => typeof v === "number") ? metrics : null;
}

export function estimateProviderCostUsd(
  usage: ProviderUsageMetrics | null,
  inputUsdPerMillionTokens: number | null,
  outputUsdPerMillionTokens: number | null,
): number | null {
  if (!usage || usage.promptTokenCount === undefined || usage.responseTokenCount === undefined) return null;
  if (inputUsdPerMillionTokens === null || outputUsdPerMillionTokens === null) return null;
  if (![inputUsdPerMillionTokens, outputUsdPerMillionTokens].every((v) => Number.isFinite(v) && v >= 0)) return null;
  const estimate = (usage.promptTokenCount * inputUsdPerMillionTokens +
    usage.responseTokenCount * outputUsdPerMillionTokens) / 1_000_000;
  return Number.isFinite(estimate) ? Math.round(estimate * 1e9) / 1e9 : null;
}
