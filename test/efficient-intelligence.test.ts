import { describe, expect, it } from "vitest";
import { estimateProviderCostUsd, inspectProviderUsageMetrics } from "../src/sessions/provider-frame";
import { COPILOT_JS } from "../src/copilot-assets";
import { SYSTEM_INSTRUCTION } from "../src/sessions/assistant-instruction";

describe("M35 provider usage and cost estimate telemetry", () => {
  it("reads explicit token usage and supports provider naming variants", () => {
    expect(inspectProviderUsageMetrics(JSON.stringify({
      usageMetadata: { promptTokenCount: 120, responseTokenCount: 45, totalTokenCount: 165, cachedContentTokenCount: 10 }
    }))).toMatchObject({ promptTokenCount: 120, responseTokenCount: 45, totalTokenCount: 165, cachedContentTokenCount: 10 });
    expect(inspectProviderUsageMetrics(JSON.stringify({
      server_content: { usage_metadata: { prompt_token_count: 15, candidates_token_count: 5, total_token_count: 20 } }
    }))).toMatchObject({ promptTokenCount: 15, responseTokenCount: 5, totalTokenCount: 20 });
  });

  it("ignores ordinary audio frames and malformed usage envelopes", () => {
    const audioFrame = JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "A".repeat(50000) } }] } } });
    expect(inspectProviderUsageMetrics(audioFrame)).toBeNull();
    expect(inspectProviderUsageMetrics('{"usageMetadata":')).toBeNull();
    expect(inspectProviderUsageMetrics(JSON.stringify({ usageMetadata: { note: "not token counts" } }))).toBeNull();
  });

  it("estimates dollars only when both token counts and explicit rates exist", () => {
    const usage = { promptTokenCount: 1000000, responseTokenCount: 500000 };
    expect(estimateProviderCostUsd(usage, 2, 4)).toBe(4);
    expect(estimateProviderCostUsd(usage, null, 4)).toBeNull();
    expect(estimateProviderCostUsd({ promptTokenCount: 2 }, 2, 4)).toBeNull();
    expect(estimateProviderCostUsd(usage, -1, 4)).toBeNull();
  });

  it("keeps fallback behaviour honest and stable-view sampling bounded", () => {
    expect(SYSTEM_INSTRUCTION).toContain("M35 — EFFICIENT INTELLIGENCE AND HONEST FALLBACKS:");
    expect(SYSTEM_INSTRUCTION).toContain("never present an unverified fallback as current or model-specific fact");
    expect(COPILOT_JS).toContain("function measureCameraChangeScore()");
    expect(COPILOT_JS).toContain("function hasHighPriorityCameraDemand()");
    expect(COPILOT_JS).toContain("function shouldSuppressStableFrame(changeScore, elapsedMs, forceFresh)");
    expect(COPILOT_JS).toContain("changeScore < 0.028 && elapsedMs < 2400");
    expect(COPILOT_JS).toContain("return !forceFresh");
    expect(COPILOT_JS).toContain("if (lastVideoSentAt && shouldSuppressStableFrame(changeScore, elapsedSinceSent, forceFresh))");
    expect(COPILOT_JS).toContain("stableFramesSuppressed");
  });
});
