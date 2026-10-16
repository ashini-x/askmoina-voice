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
    expect(html).toContain("slide to start");
    expect(html).not.toContain("Tap to open camera");
    expect(css).toContain(".camera-stage.pre-start .camera-controls");
    expect(html).not.toContain('id="intelligenceIntro"');
    expect(html).not.toContain('class="intelligence-intro"');
    expect(html).toContain('id="visionSlideHandle"');
    expect(html).not.toContain('id="secondaryControls"');
    expect(html).not.toContain('id="toggleMoreControls"');
    expect(html).not.toContain('id="vaultButton" href="/vault"');
    expect(html).toContain('id="openLibrary"');
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

  it("keeps the camera controls simple without a Vault lock and uses a native camera-flip icon", () => {
    expect(html).not.toContain('id="vaultButton"');
    expect(html).toContain('id="openLibrary"');
    expect(html).toContain('<circle cx="12" cy="12" r="2.1"/>');
    expect(html).not.toContain("vision-slide-chevron");
    expect(css).not.toContain("vision-slide-chevron");
    expect(css).not.toContain("vision-slide-hint");
  });

  it("matches edge pulse intensity to live microphone and assistant playback audio", () => {
    expect(html).toContain('<p id="connectionNoticeMessage">Just a moment</p>');
    expect(script).toContain('showConnectionNotice("Connecting securely", "Just a moment", "connecting")');
    expect(script).not.toContain('showConnectionNotice("Connecting securely", "Checking camera access and your network…", "connecting")');
    expect(script).toContain("function applyVoiceEdgeEnergy(level, source)");
    expect(script).toContain("function getPlaybackAnalyser()");
    expect(script).toContain("playbackAnalyser.getByteTimeDomainData(playbackAnalyserData)");
    expect(script).toContain('applyVoiceEdgeEnergy(Math.max(rawVoiceLevel, decayedVoiceLevel), "microphone")');
    expect(css).toContain("padding:var(--voice-edge-width,2.5px)");
    expect(css).toContain("padding:var(--voice-halo-width,4px)");
    expect(css).toContain("filter:blur(15px) brightness(var(--voice-brightness,1))");
    expect(css).toContain("#81caff 0deg");
    expect(css).toContain("#ac9eff 72deg");
    expect(css).toContain("#efb7db 144deg");
    expect(css).toContain("#90e8dc 216deg");
    expect(css).toContain("#a4b8ff 288deg");
    expect(css).toContain("opacity:var(--voice-halo-opacity,.45)");
    expect(css).toContain('font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text"');
  });

  it("keeps the post-connection cue conversational and avoids expert-only instructions", () => {
    expect(script).toContain("initial_greeting: true");
    expect(script).toContain("playConnectionChime");
    expect(script).toContain("function beginListeningAfterGreeting()");
    expect(workerSource).toContain("M34 — ZERO-LEARNING CAMERA-FIRST UX:");
    expect(workerSource).toContain("Do not narrate interface mechanics such as overlays, task categories, internal state, or function names unless the user asks.");
    expect(workerSource).toContain("Keep optional or expert controls out of the main path");
    expect(workerSource).toContain("Hardware");
    expect(workerSource).toContain("Under development");
  });

  it("keeps client assets syntactically valid and synchronized with the Worker bundle", () => {
    expect(() => new Function(script)).not.toThrow();
    expect(COPILOT_HTML).toBe(html);
    expect(COPILOT_JS).toBe(script);
    expect(COPILOT_CSS).toBe(css);
  });
});
