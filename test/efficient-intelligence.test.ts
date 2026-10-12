import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estimateProviderCostUsd, inspectProviderUsageMetrics } from "../src/sessions/provider-frame";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const copilotSource = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const assistantSource = readFileSync(new URL("../src/sessions/assistant-instruction.ts", import.meta.url), "utf8");

describe("M35 provider usage and cost estimate telemetry", () => {
  it("reads explicit token usage and supports provider naming variants", () => {
    expect(inspectProviderUsageMetrics(JSON.stringify({
      usageMetadata: { promptTokenCount: 120, responseTokenCount: 45, totalTokenCount: 165, cachedContentTokenCount: 10 }
    }))).toMatchObject({ promptTokenCount: 120, responseTokenCount: 45, totalTokenCount: 165, cachedContentTokenCount: 10 });
    expect(inspectProviderUsageMetrics(JSON.stringify({
      server_content: { usage_metadata: { prompt_token_count: 15, candidates_token_count: 5, total_token_count: 20 } }
    }))).toMatchObject({ promptTokenCount: 15, responseTokenCount: 5, totalTokenCount: 20 });
  });

  it("leaves ordinary audio frames unparsed and ignores malformed usage envelopes", () => {
    const audioFrame = JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "A".repeat(50_000) } }] } } });
    expect(inspectProviderUsageMetrics(audioFrame)).toBeNull();
    expect(inspectProviderUsageMetrics('{"usageMetadata":')).toBeNull();
    expect(inspectProviderUsageMetrics(JSON.stringify({ usageMetadata: { note: "not token counts" } }))).toBeNull();
  });

  it("estimates dollars only when both token counts and explicit rates exist", () => {
    const usage = { promptTokenCount: 1_000_000, responseTokenCount: 500_000 };
    expect(estimateProviderCostUsd(usage, 2, 4)).toBe(4);
    expect(estimateProviderCostUsd(usage, null, 4)).toBeNull();
    expect(estimateProviderCostUsd({ promptTokenCount: 2 }, 2, 4)).toBeNull();
    expect(estimateProviderCostUsd(usage, -1, 4)).toBeNull();
  });

  it("records latency, media counts, searches, provider usage, and configured cost without payloads", () => {
    expect(workerSource).toContain("Voice session efficiency summary");
    expect(workerSource).toContain("requestToFirstAudioMs");
    expect(workerSource).toContain("groundedSearchCount");
    expect(workerSource).toContain("videoFramesForwarded");
    expect(workerSource).toContain("providerTokenUsage");
    expect(workerSource).toContain("estimatedInferenceCostUsd");
    expect(assistantSource).toContain("M35 — EFFICIENT INTELLIGENCE AND HONEST FALLBACKS:");
    expect(assistantSource).toContain("never present an unverified fallback as current or model-specific fact");
  });

  it("suppresses only stable idle frames before the freshness heartbeat", () => {
    expect(copilotSource).toContain("function shouldSuppressStableFrame(changeScore, elapsedMs, forceFresh)");
    const match = copilotSource.match(/function shouldSuppressStableFrame\(changeScore, elapsedMs, forceFresh\)\s*\{\s*return ([^;]+);\s*\}/);
    expect(match).not.toBeNull();
    const shouldSuppress = new Function("changeScore", "elapsedMs", "forceFresh", "return (" + match![1] + ");") as
      (score: number, elapsed: number, force: boolean) => boolean;
    expect(shouldSuppress(0.001, 1200, false)).toBe(true);
    expect(shouldSuppress(0.001, 2400, false)).toBe(false);
    expect(shouldSuppress(0.09, 1200, false)).toBe(false);
    expect(shouldSuppress(0.001, 1200, true)).toBe(false);
    expect(shouldSuppress(Number.NaN, 1200, false)).toBe(false);
    expect(copilotSource).toContain("measureCameraChangeScore");
    expect(copilotSource).toContain("hasHighPriorityCameraDemand");
  });
});
