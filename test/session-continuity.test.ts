import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const protocol = readFileSync(new URL("../src/sessions/copilot-protocol.ts", import.meta.url), "utf8");
const providerFrames = readFileSync(new URL("../src/sessions/provider-frame.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");

describe("long-running Live session continuity", () => {
  it("enables bounded context compression and provider session resumption", () => {
    expect(worker).toContain("contextWindowCompression: {");
    expect(worker).toContain("triggerTokens: 96_000");
    expect(worker).toContain("targetTokens: 64_000");
    expect(worker).toContain("sessionResumption: { transparent: true }");
    expect(worker).toContain("async function resumeLiveUpstream");
    expect(worker).toContain("lastSessionResumptionHandle");
    expect(worker).toContain("clientMessageIndex: index");
    expect(worker).toContain("lastConsumedClientMessageIndex");
    expect(worker).toContain("function replayUnconsumedMessages");
    expect(worker).toContain('state: "resuming"');
    expect(worker).toContain('state: "resumed"');
  });

  it("keeps session handles relay-side and handles provider control frames", () => {
    expect(providerFrames).toContain("sessionResumptionUpdate");
    expect(providerFrames).toContain("goAway");
    expect(worker).toContain("const isSessionResumptionUpdate = Boolean(providerMessage?.sessionResumptionUpdate)");
    expect(worker).toContain('(resumedSessionSetupComplete || isSessionResumptionUpdate) ? "" : frameText');
  });

  it("supports higher-detail, payload-bounded camera frames without disabling audio pacing", () => {
    expect(protocol).toContain("const MAX_MEDIA_BASE64_CHARS = 48_000");
    expect(worker).toContain("const MAX_CLIENT_FRAME_CHARS = 65_536");
    expect(script).toContain("const maxDimension = 768");
    expect(script).toContain("data.length <= 48_000");
    expect(script).toContain("window.setInterval(sendVideoFrame, 1000)");
  });

  it("discloses provider-side temporary session caching for resumption", () => {
    expect(html).toContain("temporarily cache session content for up to 24 hours");
    expect(html).not.toContain('class="privacy-hint sr-only"');
  });
});
