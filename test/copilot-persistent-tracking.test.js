import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const client = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/copilot.css", import.meta.url), "utf8");
const bundledAssets = readFileSync(new URL("../src/copilot-assets.ts", import.meta.url), "utf8");

describe("Milestone 16 persistent visual tracking", () => {
  it("keeps the local patch tracker and adds a separate wider reacquisition scan", () => {
    expect(client).toContain("function findTemplate(gray, center)");
    expect(client).toContain("function findTemplateAcrossFrame(gray)");
    expect(client).toContain("const stride = 5;");
    expect(client).toContain("trackingLastReacquireAt >= 350");
  });

  it("uses stricter matching during reacquisition to reduce target jumps", () => {
    expect(client).toContain("reacquireThreshold = trackingTemplate && trackingTemplate.variance < 1800 ? 0.84 : 0.68");
    expect(client).toContain('focusMarker.dataset.tracking = "reacquiring"');
    expect(client).toContain("Target found again. Tracking has resumed.");
  });

  it("fades and then hides a stale marker, with a finite recovery window", () => {
    expect(client).toContain("now - trackingLostAt >= 1_300");
    expect(client).toContain("now - trackingLostAt >= 8_000");
    expect(client).toContain("I could not reacquire that target.");
    expect(styles).toContain('.focus-marker[data-tracking="reacquiring"]{opacity:.38');
    expect(client).toContain('focusMarker.dataset.tracking = "lost"');
  });

  it("resets recovery state when tracking starts or stops", () => {
    expect(client).toContain("trackingLostAt = 0;");
    expect(client).toContain("trackingLastReacquireAt = 0;");
    expect(client).toContain("trackingReacquiring = false;");
  });

  it("renders compact, camera-first target cues with a small exact-point indicator", () => {
    expect(styles).toContain("Milestone 17 — minimal target overlays");
    expect(styles).toContain(".focus-brackets{\\n  width:48px;");
    expect(styles).toContain(".focus-brackets::after");
    expect(styles).toContain("width:min(158px,46vw)");
    expect(styles).toContain(".focus-eyebrow{display:none}");
    expect(styles).toContain("-webkit-line-clamp:1");
  });

  it("keeps the worker-embedded JavaScript and styles synchronized with public assets", () => {
    expect(bundledAssets).toContain(JSON.stringify(client));
    expect(bundledAssets).toContain(JSON.stringify(styles));
  });
});
