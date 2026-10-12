import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPILOT_JS } from "../src/copilot-assets";

function extractFunction(source, functionName) {
  const marker = "function " + functionName + "(";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Missing browser geometry helper: " + functionName);
  const brace = source.indexOf("{", start + marker.length);
  if (brace < 0) throw new Error("Missing function body: " + functionName);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("Unclosed function body: " + functionName);
}

const projectionSource = extractFunction(COPILOT_JS, "visualGuideProjection");
const visualGuideProjection = new Function(projectionSource + "; return visualGuideProjection;")();

describe("M24 trustworthy camera geometry", () => {
  it("maps normalized coordinates through object-fit cover cropping in a portrait viewport", () => {
    const project = visualGuideProjection(400, 800, 640, 480, false);
    expect(project.xAt(312.5)).toBeCloseTo(0, 5);
    expect(project.xAt(687.5)).toBeCloseTo(400, 5);
    expect(project.yAt(0)).toBeCloseTo(0, 5);
    expect(project.yAt(1000)).toBeCloseTo(800, 5);
  });

  it("maps normalized coordinates through object-fit cover cropping in a landscape viewport", () => {
    const project = visualGuideProjection(800, 400, 480, 640, false);
    expect(project.xAt(0)).toBeCloseTo(0, 5);
    expect(project.xAt(1000)).toBeCloseTo(800, 5);
    expect(project.yAt(312.5)).toBeCloseTo(0, 5);
    expect(project.yAt(687.5)).toBeCloseTo(400, 5);
  });

  it("mirrors horizontal guide coordinates while leaving vertical positions and readable label sizing unchanged", () => {
    const normal = visualGuideProjection(400, 300, 640, 480, false);
    const mirrored = visualGuideProjection(400, 300, 640, 480, true);
    expect(normal.xAt(200)).toBeCloseTo(80, 5);
    expect(mirrored.xAt(200)).toBeCloseTo(320, 5);
    expect(normal.xAt(800)).toBeCloseTo(320, 5);
    expect(mirrored.xAt(800)).toBeCloseTo(80, 5);
    expect(mirrored.yAt(375)).toBeCloseTo(normal.yAt(375), 5);
    expect(mirrored.sizeAt(100)).toBeCloseTo(normal.sizeAt(100), 5);
  });

  it("recomputes the cover mapping for a changed viewport instead of reusing stale screen coordinates", () => {
    const before = visualGuideProjection(400, 800, 640, 480, false);
    const after = visualGuideProjection(800, 400, 640, 480, false);
    expect(before.xAt(500)).toBeCloseTo(200, 5);
    expect(after.xAt(500)).toBeCloseTo(400, 5);
    expect(before.yAt(500)).toBeCloseTo(400, 5);
    expect(after.yAt(500)).toBeCloseTo(200, 5);
    expect(before.offsetX).not.toBe(after.offsetX);
    expect(before.offsetY).not.toBe(after.offsetY);
  });

  it("invalidates camera-dependent guidance when zoom, camera dimensions, or tab visibility changes", () => {
    expect(COPILOT_JS).toContain("latestVisualGuideElements.length || latestVisualGuidance");
    expect(COPILOT_JS).toContain("Camera zoom changed. Moina will redraw the guide using a fresh view.");
    expect(COPILOT_JS).toContain('video.addEventListener("resize", () => invalidateSceneEvidence("video-frame-resize"))');
    expect(COPILOT_JS).toContain('if (document.hidden) {');
    expect(COPILOT_JS).toContain('recordRealityLoopEvent("visibility_hidden")');
    expect(COPILOT_JS).toContain('invalidateSceneEvidence("tab-hidden")');
    expect(COPILOT_JS).toContain("sceneModel = { viewGeneration: ++cameraViewGeneration");
  });

  it("keeps the front-camera mirror aligned for both model guide geometry and locally tracked targets", () => {
    expect(COPILOT_JS).toContain('return facingMode === "user"');
    expect(COPILOT_JS).toContain('transforms.push("scaleX(-1)")');
    expect(COPILOT_JS).toContain("const displayedX = isCameraPreviewMirrored()");
    expect(COPILOT_JS).toContain("const mirrorDirection = isCameraPreviewMirrored() ? -1 : 1");
  });

  it("rerenders normalized guides on viewport resizing and clears them on source-frame changes", () => {
    expect(COPILOT_JS).toContain("function redrawVisualGuide()");
    expect(COPILOT_JS).toContain("new ResizeObserver(redrawVisualGuide)");
    expect(COPILOT_JS).toContain("renderVisualGuide(latestVisualGuideElements.slice())");
    expect(COPILOT_JS).toContain("clearOverlay();\n      const requested =");
  });

  it("keeps embedded and public browser scripts synchronized", () => {
    const publicScript = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
    expect(publicScript).toBe(COPILOT_JS);
    expect(() => new Function(publicScript)).not.toThrow();
  });
});
