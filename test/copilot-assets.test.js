import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPILOT_HTML, COPILOT_JS, COPILOT_CSS } from "../src/copilot-assets";

const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/copilot.css", import.meta.url), "utf8");

describe("Worker-embedded Co-Pilot assets", () => {
  it("serves the same browser assets as the checked-in public files", () => {
    expect(COPILOT_HTML).toBe(html);
    expect(COPILOT_JS).toBe(script);
    expect(COPILOT_CSS).toBe(css);
  });
});

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

  it("offers a gated WebXR surface-anchor mode without replacing the V2 fallback", () => {
    expect(html).toContain('id="spatialArButton"');
    expect(html).toContain('id="spatialHud"');
    expect(html).toContain('id="placeSpatialAnchor"');
    expect(script).toContain('navigator.xr.requestSession("immersive-ar"');
    expect(script).toContain('requiredFeatures: ["local", "hit-test", "anchors", "dom-overlay"]');
    expect(script).toContain("requestHitTestSource({ space: spatialViewerSpace })");
    expect(script).toContain("hitForAnchor.createAnchor()");
    expect(script).toContain("frame.getPose(spatialAnchor.anchorSpace, spatialReferenceSpace)");
    expect(html).toContain("Starting this lab pauses live voice guidance");
    expect(css).toContain(".spatial-hud[hidden]{display:none}");
  });

  it("hands the latest AI visual cue into spatial placement without claiming object recognition", () => {
    expect(html).toContain('id="spatialGuidance"');
    expect(html).toContain('id="spatialTargetLabel"');
    expect(html).toContain("Aim the ring at the target yourself");
    expect(script).toContain("let latestVisualGuidance = null;");
    expect(script).toContain("function syncSpatialGuidance()");
    expect(script).toContain("spatialPlacedGuidance = latestVisualGuidance ? { ...latestVisualGuidance } : null;");
    expect(script).toContain("Surface marker placed for");
    expect(script).toContain("The cue stays in this panel");
  });

  it("renders the selected cue as a world-anchored 3D tag after surface placement", () => {
    expect(html).toContain("a floating 3D cue card stays at a fixed world position");
    expect(script).toContain("const tagVs = compileSpatialShader");
    expect(script).toContain("function updateSpatialTagTexture(guidance)");
    expect(script).toContain("function drawSpatialTag(gl,view,anchorMatrix)");
    expect(script).toContain("raisedAnchor[13]+=0.22;");
    expect(script).toContain("gl.drawArrays(gl.TRIANGLE_STRIP,0,4);");
    expect(script).toContain("drawSpatialTag(gl, view, anchorPose.transform.matrix)");
    expect(script).toContain("updateSpatialTagTexture(spatialPlacedGuidance);");
    expect(html).toContain("the target is not automatically recognized");
  });

  it("recovers cleanly from brief surface loss and reports anchor tracking reacquisition", () => {
    expect(script).toContain("spatialPendingPlacementAt && time - spatialPendingPlacementAt > 1800");
    expect(script).toContain("Surface detection was lost before placement");
    expect(script).toContain("spatialAnchorPoseWarningShown");
    expect(script).toContain("Spatial tracking is reacquiring this anchor");
    expect(script).toContain("Tracking recovered. Move slowly");
    expect(script).toContain("oldHitSource.cancel()");
    expect(script).toContain('addEventListener("visibilitychange"');
    expect(script).toContain("The graphics context was lost");
    expect(script).toContain('spatialStatus.dataset.kind = mode || "normal"');
    expect(css).toContain('#spatialStatus[data-kind="warning"]');
  });

  it("supports tap-to-track local image patches without claiming world-locked AR", () => {
    expect(script).toContain("function startLocalTracking(clientX, clientY)");
    expect(script).toContain("function updateLocalTracking()");
    expect(script).toContain("function findTemplate(gray, center)");
    expect(script).toContain("Tap another point to retarget");
    expect(script).toContain("Zoom changed. Tap the target again to resume local tracking.");
    expect(script).toContain("not world-locked AR");
    expect(script).toContain('stage.addEventListener("click"');
  });

  it("retries a just-ended session reservation before reporting a second active voice session", () => {
    expect(script).toContain("async function refreshAvailabilityAfterRelease()");
    expect(script).toContain("options.quietActiveLock === true");
    expect(script).toContain("lastSessionEndedAt = Date.now()");
    expect(script).toContain("result.reason !== \"already_active\"");
    expect(script).toContain("const endedRecently = Date.now() - lastSessionEndedAt < 15_000;");
  });

  it("styles region-specific focus markers for narrow screens", () => {
    expect(css).toContain('.focus-marker[data-region="upper-left"]');
    expect(css).toContain('.focus-marker[data-region="lower-right"]');
    expect(css).toContain("@media(max-width:760px)");
  });
});
