import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPILOT_HTML, COPILOT_JS, COPILOT_CSS } from "../src/copilot-assets";

const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/copilot.css", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Milestone 34 zero-learning camera-first UX", () => {
  it("makes the first action obvious without adding a tutorial or mode selector", () => {
    expect(html).toContain("Point. Ask. Follow.");
    expect(html).toContain("Tap Start, then tell Moina what you want to do.");
    expect(html).toContain("id=\"toggleCopilot\"");
    expect(html).toContain("id=\"secondaryControls\" hidden");
    expect(html).toContain("id=\"toggleMoreControls\"");
  });

  it("provides a compact natural-language invitation and optional examples", () => {
    expect(html).toContain("Tell Moina your goal in your own words.");
    expect(html).toContain("Set this up");
    expect(html).toContain("Compare these");
    expect(html).toContain("Explain this");
    expect(script).toContain("Tell Moina your goal in your own words.");
    expect(script).toContain("Try: “Set this up” · “Compare these” · “Explain this”");
    expect(css).toContain(".empty-examples");
  });

  it("keeps the post-connection cue conversational and avoids expert-only instructions", () => {
    expect(script).toContain('setStatus("Connected. Tell Moina what you want to do in your own words.");');
    expect(workerSource).toContain("M34 — ZERO-LEARNING CAMERA-FIRST UX:");
    expect(workerSource).toContain("Do not narrate interface mechanics such as overlays, task categories, internal state, or function names unless the user asks.");
    expect(workerSource).toContain("Keep optional or expert controls out of the main path");
  });

  it("keeps client assets syntactically valid and synchronized with the Worker bundle", () => {
    expect(() => new Function(script)).not.toThrow();
    expect(COPILOT_HTML).toBe(html);
    expect(COPILOT_JS).toBe(script);
    expect(COPILOT_CSS).toBe(css);
  });
});
