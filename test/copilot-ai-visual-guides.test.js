import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const assetSource = readFileSync(new URL("../src/copilot-assets.ts", import.meta.url), "utf8");

function readStringConstant(source, name) {
  const marker = `export const ${name} = `;
  const assignment = source.indexOf(marker);
  if (assignment < 0) throw new Error("Missing " + name);
  const quote = source.indexOf('"', assignment + marker.length);
  let end = quote + 1;
  let escaped = false;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (!escaped && char === '"') break;
    if (!escaped && char.charCodeAt(0) === 92) escaped = true;
    else escaped = false;
  }
  return JSON.parse(source.slice(quote, end + 1));
}

const clientScript = readStringConstant(assetSource, "COPILOT_JS");

describe("M22 AI-directed visual guide contract", () => {
  it("gives the model a bounded visual primitive vocabulary and coordinates", () => {
    expect(workerSource).toContain("AI-DIRECTED VISUAL GUIDANCE — SHOW, DO NOT JUST TELL:");
    expect(workerSource).toContain("visual_elements");
    expect(workerSource).toContain('["line", "arrow", "circle", "rect", "tick", "label"]');
    expect(workerSource).toContain("normalized 0–1000");
  });

  it("allows geometric guides to render without a target tap", () => {
    expect(workerSource).toContain("visual_only");
    expect(clientScript).toContain("if (args.visual_only === true && hasVisualGuide)");
    expect(clientScript).toContain('setStatus(instruction || label || "Follow the on-screen guide.", "normal")');
  });

  it("bounds primitive count, coordinate ranges, geometry, and label text", () => {
    expect(clientScript).toContain("elements.slice(0, 8)");
    expect(clientScript).toContain("function visualCoord(value)");
    expect(clientScript).toContain("value >= 0 && value <= 1000");
    expect(clientScript).toContain("element.radius <= 250");
    expect(clientScript).toContain("element.text.trim().slice(0, 48)");
  });

  it("draws only SVG nodes and keeps the guide layer from stealing camera touches", () => {
    expect(clientScript).toContain('document.createElementNS(visualGuideSvgNS, "svg")');
    expect(clientScript).toContain("shape.textContent = element.text.trim().slice(0, 48)");
    expect(clientScript).not.toContain("innerHTML = element.text");
    expect(clientScript).toContain("function clearVisualGuide()");
    expect(assetSource).toContain(".ai-visual-guide{position:absolute;inset:0;width:100%;height:100%;z-index:7;pointer-events:none");
  });

  it("keeps screen drawings explicitly distinct from AR anchoring and object recognition", () => {
    expect(workerSource).toContain("These are screen-space drawings, not world-anchored AR.");
    expect(workerSource).toContain("tick on screen is a model-provided visual judgement");
    expect(readFileSync(new URL("../docs/ROADMAP.md", import.meta.url), "utf8")).toContain("dependable automatic progress verification remains future work");
  });

describe("M23 proactive visual-guide brain", () => {
  it("instructs the model to draw useful low-risk spatial guides without waiting for an explicit drawing request", () => {
    expect(workerSource).toContain("VISUAL-GUIDE BRAIN — DECIDE PROACTIVELY:");
    expect(workerSource).toContain("Do not wait for the user to explicitly ask for a drawing");
    expect(workerSource).toContain("alignment, direction, placement, matching, or relative position");
    expect(workerSource).toContain("three cups are visible and the user wants them in a straight line");
  });

  it("prefers the minimum helpful primitives instead of decorative or overcomplicated graphics", () => {
    expect(workerSource).toContain("Prefer one to three primitives");
    expect(workerSource).toContain("Never decorate the scene or draw redundant graphics");
    expect(workerSource).toContain("tool accepts at most eight primitives, which is a safety bound rather than a target");
  });

  it("permits tap-free geometric references while refusing to guess an ambiguous object identity", () => {
    expect(workerSource).toContain("Set visual_only=true with visual_elements for geometric references");
    expect(workerSource).toContain("A guide line or direction arrow alone is not a reason to request a user tap");
    expect(workerSource).toContain("ask one brief question or request a tap to resolve identity");
  });

  it("requires fresh evidence, clears misleading guides, and refuses guessed success marks", () => {
    expect(workerSource).toContain("call display_screen_overlay without visual_elements to clear it");
    expect(workerSource).toContain("A persuasive but guessed overlay is worse than a clear question");
    expect(workerSource).toContain("do not transform a guide into a false completion claim");
  });

  it("advertises proactive visual drawing through the actual model tool description", () => {
    expect(workerSource).toContain("Proactively use this tool when a compact visual cue would clarify a low-risk physical action");
    expect(workerSource).toContain("Set visual_only=true for geometric guides");
  });
});

});
