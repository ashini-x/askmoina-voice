import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/copilot.css", import.meta.url), "utf8");

describe("Live Co-Pilot browser assets", () => {
  it("ships the camera preview, guided conversation, and a clear approximation disclaimer", () => {
    expect(html).toContain('id="videoPreview"');
    expect(html).toContain('id="toggleCopilot"');
    expect(html).toContain("not world-locked AR");
    expect(html).toContain("Camera and microphone start only after you tap Start Co-Pilot");
  });

  it("uses the guarded live protocol for audio, video, and overlay tool responses", () => {
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("copilot_mode: true");
    expect(script).toContain("realtime_input: { video:");
    expect(script).toContain("tool_response: { function_responses:");
    expect(script).toContain("canvas.toDataURL(\"image/jpeg\"");
  });

  it("styles region-specific focus markers for narrow screens", () => {
    expect(css).toContain('.focus-marker[data-region="upper-left"]');
    expect(css).toContain('.focus-marker[data-region="lower-right"]');
    expect(css).toContain("@media(max-width:760px)");
  });
});
