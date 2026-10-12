import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPILOT_HTML, COPILOT_JS, COPILOT_CSS } from "../src/copilot-assets";

const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/copilot.css", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Milestone 34 zero-learning camera-first UX", () => {
  it("makes the first action obvious without adding a tutorial or mode selector", () => {
    expect(html).not.toContain("Point. Ask. Follow.");
    expect(html).not.toContain("Tap Start, then tell Moina what you want to do.");
    expect(html).not.toContain("presence-orb");
    expect(html).toContain("id=\"toggleCopilot\"");
    expect(html).toContain("id=\"showProblemButton\"");
    expect(html).toContain("id=\"backButton\"");
    expect(html).toContain("SHOW ME YOUR PROBLEM");
    expect(html).toContain("Slide to show your problem");
    expect(html).toContain('id="intelligenceIntro"');
    expect(html).toContain('id="visionSlideHandle"');
    expect(html).not.toContain('id="secondaryControls"');
    expect(html).not.toContain('id="toggleMoreControls"');
    expect(html).toContain('id="vaultButton" href="/vault"');
  });

  it("provides a compact natural-language invitation and optional examples", () => {
    expect(html).not.toContain("Tell Moina your goal in your own words.");
    expect(html).not.toContain("Set this up");
    expect(html).not.toContain("Compare these");
    expect(html).not.toContain("Explain this");
    expect(html).not.toContain('id="toggleCaptions"');
    expect(html).toContain('aria-label="Mute microphone"');
    expect(html).toContain('aria-label="Start call"');
    expect(css).toContain(".presence-orb");
  });

  it("keeps the post-connection cue conversational and avoids expert-only instructions", () => {
    expect(script).toContain("initial_greeting: true");
    expect(script).toContain("playConnectionChime");
    expect(script).toContain("function beginListeningAfterGreeting()");
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
