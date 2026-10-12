import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPILOT_HTML, COPILOT_JS, COPILOT_CSS } from "../src/copilot-assets";

const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/copilot.css", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

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
    expect(html).toContain("A camera preview is shown in Vision.");
    expect(html).toContain("processed by Google Cloud Vertex AI");
  });

  it("keeps Vision orb-free, adds Back, and uses a pulse-style edge without a visible Spatial AR page", () => {
    expect(html).not.toContain('class="camera-placeholder-icon presence-orb"');
    expect(html).toContain('id="backButton"');
    expect(css).toContain("@keyframes intelligence-pulse");
    expect(css).toContain("#spatialArButton{display:none!important;visibility:hidden!important;pointer-events:none!important}");
    expect(css).toContain("#spatialHud{display:none!important;visibility:hidden!important;pointer-events:none!important}");
  });

  it("uses the guarded live protocol for audio, video, and overlay tool responses", () => {
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("copilot_mode: true");
    expect(script).toContain("realtime_input: { video:");
    expect(script).toContain("tool_response: { function_responses:");
    expect(script).toContain("canvas.toDataURL(\"image/jpeg\"");
    expect(script).toContain("const wasInterrupted = serverContent.interrupted === true");
    expect(script).toContain("inlineData.data && !wasInterrupted");
    expect(script).toContain('setControls("Try again", false)');
    expect(html).toContain('<script src="/transcript-merge.js" defer></script>');
    expect(workerSource).toContain("Resolve references like 'this'");
    expect(workerSource).toContain("latest speech as the priority");
  });

  it("offers a gated WebXR surface-anchor mode without replacing the V2 fallback", () => {
    expect(html).toContain('id="spatialArButton"');
    expect(html).toContain('id="spatialHud"');
    expect(html).toContain('id="placeSpatialAnchor"');
    expect(script).toContain('navigator.xr.requestSession("immersive-ar"');
    expect(script).toContain('requiredFeatures: ["local", "hit-test", "anchors", "dom-overlay"]');
    expect(script).toContain("requestHitTestSource({ space: spatialViewerSpace, offsetRay: ray })");
    expect(script).toContain("requestHitTestSource({ space: spatialViewerSpace })");
    expect(script).toContain("hitForAnchor.createAnchor()");
    expect(script).toContain("frame.getPose(spatialAnchor.anchorSpace, spatialReferenceSpace)");
    expect(html).toContain("voice stays live in Spatial AR while camera frames pause");
    expect(css).toContain(".spatial-hud[hidden]{display:none}");
  });

  it("restores the default WebGL framebuffer and handles Spatial AR exit idempotently", () => {
    expect(script).toContain("if (!spatialSession && !spatialGl && !spatialRenderer) return;");
    expect(script).toContain("endedGl.bindFramebuffer(endedGl.FRAMEBUFFER, null);");
    expect(script).toContain("endedGl.flush();");
    expect(script).toContain("async function requestSpatialArExit()");
    expect(script).toContain("await session.end();");
    expect(script).toContain("if (spatialSession === session) finishSpatialAr();");
    expect(script).toContain("exitSpatialArButton.disabled = false;");
    expect(css).toContain("background:#080b10f5");
    expect(css).not.toContain("backdrop-filter:blur(18px);box-shadow:0 14px 44px #0006");
  });

  it("hands the latest AI visual cue into spatial placement without claiming object recognition", () => {
    expect(html).toContain('id="spatialGuidance"');
    expect(html).toContain('id="spatialTargetLabel"');
    expect(html).toContain("does not recognize object geometry");
    expect(script).toContain("let latestVisualGuidance = null;");
    expect(script).toContain("function syncSpatialGuidance()");
    expect(script).toContain("const currentGuidance = activeSpatialGuidance();");
    expect(script).toContain("spatialPlacedGuidance = currentGuidance ? { ...currentGuidance } : null;");
    expect(script).toContain('"Cue placed · " + spatialPlacedGuidance.label');
    expect(html).toContain("does not recognize object geometry");
  });

  it("renders the selected cue as a world-anchored 3D tag after surface placement", () => {
    expect(html).toContain("the 3D cue card is anchored at the selected hit-test point");
    expect(script).toContain("const tagVs = compileSpatialShader");
    expect(script).toContain("function updateSpatialTagTexture(guidance)");
    expect(script).toContain("function drawSpatialTag(gl,view,anchorMatrix)");
    expect(script).toContain("raisedAnchor[13]+=0.22;");
    expect(script).toContain("gl.drawArrays(gl.TRIANGLE_STRIP,0,4);");
    expect(script).toContain("drawSpatialTag(gl, view, currentAnchorPose.transform.matrix)");
    expect(script).toContain("updateSpatialTagTexture(spatialPlacedGuidance);");
    expect(html).toContain("it does not recognize object geometry");
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

  it("uses the AI screen region to aim an adjustable hit-test ray before explicit world-anchor confirmation", () => {
    expect(script).toContain("screenRegion: region");
    expect(script).toContain("function spatialRegionToAim(region)");
    expect(script).toContain("function createSpatialOffsetRay()");
    expect(script).toContain("new XRRay(");
    expect(script).toContain("function rebuildSpatialHitTestSource(session = spatialSession)");
    expect(script).toContain("function nudgeSpatialAim(dx, dy)");
    expect(script).toContain("spatialAimButtons.left.addEventListener");
    expect(script).toContain("spatialAimButtons.reset.addEventListener");
    expect(script).toContain("const currentGuidance = activeSpatialGuidance();");
    expect(script).toContain("spatialPlacedGuidance = currentGuidance ? { ...currentGuidance } : null;");
    expect(html).toContain('id="spatialAimLabel"');
    expect(html).toContain('id="spatialAimLeft"');
    expect(html).toContain('id="spatialAimReset"');
    expect(html).toContain('id="placeSpatialAnchor" disabled>Finding surface…</button>');
    expect(html).toContain("does not recognize object geometry");
    expect(css).toContain(".spatial-aim-panel");
  });

  it("keeps the live microphone and WebSocket connected during Spatial AR, pausing only camera frames", () => {
    expect(script).toContain("function suspendCameraForSpatialAr()");
    expect(script).toContain("microphoneStream.getVideoTracks().forEach((track) =>");
    expect(script).toContain("async function resumeCameraAfterSpatialAr(reason = \"Spatial AR ended\")");
    expect(script).toContain("microphoneStream.getAudioTracks().some((track) => track.readyState === \"live\")");
    expect(script).toContain("const canKeepVoiceDuringSpatialAr = Boolean(active && setupReady");
    expect(script).toContain("Live voice stays connected; camera frames are paused until you exit AR.");
    expect(script).toContain("startVideoFrames();");
    expect(script).toContain("Live voice and camera frames are back.");
    expect(html).toContain("voice stays live in Spatial AR while camera frames pause");
    expect(script).not.toContain("Spatial AR uses the phone's camera and will pause your current live voice session.");
  });

  it("supports local saved spatial scene templates and multiple session-local anchors without claiming physical persistence", () => {
    expect(html).toContain('id="spatialSceneName"');
    expect(html).toContain('id="spatialScenePin"');
    expect(html).toContain('id="spatialSceneSave"');
    expect(html).toContain('id="spatialSceneSelect"');
    expect(html).toContain('id="spatialSceneLoad"');
    expect(script).toContain('const SPATIAL_SCENE_STORAGE_KEY = "askmoina.spatial.scenes.v1";');
    expect(script).toContain("function loadSpatialSceneLibrary()");
    expect(script).toContain("function saveCurrentSpatialScene()");
    expect(script).toContain("function loadSavedSpatialScene()");
    expect(script).toContain("function pinCurrentSpatialCue()");
    expect(script).toContain("sequenceId: spatialGuidanceSequenceId");
    expect(script).toContain("item.sequenceId === spatialGuidanceSequenceId && item.stepIndex === spatialStepIndex");
    expect(script).toContain("for (const pinned of pinnedPoses)");
    expect(script).toContain("clearPinnedSpatialCues()");
    expect(html).toContain("Saved guides keep instructions on this device.");
    expect(script).not.toContain("requestPersistentHandle");
    expect(css).toContain(".spatial-scene-panel");
  });

  it("supports numbered spatial walkthroughs with explicit per-step confirmation and a fresh anchor for each step", () => {
    expect(workerSource).toContain("steps array of 2–5 ordered, short actions");
    expect(workerSource).toContain("steps: {");
    expect(workerSource).toContain('type: "ARRAY"');
    expect(script).toContain("const normalizedSteps = Array.isArray(args.steps)");
    expect(script).toContain("const guidanceSteps = normalizedSteps.length > 1 ? normalizedSteps : [primary]");
    expect(script).toContain("function syncSpatialSequenceControls()");
    expect(script).toContain("function confirmSpatialGuidanceStep()");
    expect(script).toContain("function moveSpatialGuidanceStep(delta)");
    expect(script).toContain("if (!spatialSession || spatialGuidanceSteps.length < 2) return;");
    expect(script).toContain("clearCurrentSpatialAnchorForStepChange()");
    expect(script).toContain("function finishSpatialGuidanceSequence()");
    expect(script).toContain("spatialStepConfirmed = false;\n      spatialSequenceFinished = false;");
    expect(html).toContain('id="spatialStepProgress"');
    expect(html).toContain('id="spatialStepConfirm"');
    expect(html).toContain('id="spatialStepNext"');
    expect(html).toContain("Follow the ring. Moina will show you one step at a time.");
    expect(html).toContain("The ring is a guide, not object recognition. Check placement before continuing.");
    expect(css).toContain(".spatial-step-panel[hidden]{display:none}");
  });

  it("supports tap-to-track local image patches without claiming world-locked AR", () => {
    expect(script).toContain("function startLocalTracking(clientX, clientY)");
    expect(script).toContain("function updateLocalTracking()");
    expect(script).toContain("function findTemplate(gray, center)");
    expect(script).toContain("Tap another point to retarget");
    expect(script).toContain("Zoom changed. Tap a target again if you want local tracking.");
    expect(script).toContain("not world-locked AR");
    expect(script).toContain('stage.addEventListener("click"');
  });

  it("does not block a signed-in session on an app-owned browser lock", () => {
    expect(script).not.toContain("options.quietActiveLock === true");
    expect(script).not.toContain('result.reason === "already_active"');
    expect(script).not.toContain("A previous connection is still clearing");
    expect(workerSource).not.toContain('closeBoth(1008, "Audio input rate limit exceeded")');
  });

  it("styles region-specific focus markers for narrow screens", () => {
    expect(css).toContain('.focus-marker[data-region="upper-left"]');
    expect(css).toContain('.focus-marker[data-region="lower-right"]');
    expect(css).toContain("@media(max-width:760px)");
  });
  
  it("keeps advanced spatial controls out of the default guided flow", () => {
    expect(html).toContain('<details class="spatial-advanced" id="spatialAdvanced">');
    expect(html).toContain("<summary>More options</summary>");
    expect(html).toContain('id="placeSpatialAnchor" disabled>Finding surface…</button>');
    expect(html).toContain('id="exitSpatialAr" class="spatial-close" aria-label="Done and return to Co-Pilot">×</button>');
    expect(script).toContain("function advanceSpatialGuidance()");
    expect(script).toContain('spatialStepButtons.next.addEventListener("click", advanceSpatialGuidance);');
    expect(css).toContain(".spatial-advanced>summary");
    expect(css).toContain(".spatial-step-actions #spatialStepConfirm");
  });

  
  it("renders a JARVIS-style visual guidance HUD with a single contextual action", () => {
    expect(html).toContain('class="spatial-hud spatial-hud-jarvis"');
    expect(html).toContain('aria-label="Spatial guide"');
    expect(html).toContain('class="control-icon spatial-ar-button"');
    expect(html).toContain('id="spatialActionHint"');
    expect(html).toContain('id="spatialProgressTrack"');
    expect(html).toContain('id="placeSpatialAnchor" disabled>Finding surface…</button>');
    expect(html).toContain('id="exitSpatialAr" class="spatial-close"');
    expect(script).toContain('function syncSpatialButtons()');
    expect(script).toContain('buttonText = isLastStep ? "Finish guide" : "Next step";');
    expect(script).toContain('spatialProgressTrack.replaceChildren();');
    expect(css).toContain(".spatial-hud.spatial-hud-jarvis .spatial-guidance");
    expect(css).toContain(".spatial-progress-segment.is-current");
  });
  
  it("keeps the default Co-Pilot camera-first and reveals secondary controls only on request", () => {
    expect(html).toContain('id="toggleMoreControls"');
    expect(html).toContain('id="secondaryControls" hidden');
    expect(html).toContain('id="toggleCaptions"');
    expect(script).toContain('stage.classList.toggle("controls-expanded", expanded)');
    expect(script).toContain('stage.classList.toggle("captions-expanded", expanded)');
    expect(css).toContain(".secondary-controls[hidden]{display:none!important}");
    expect(css).toContain(".camera-stage.captions-expanded .transcript{display:flex}");
    expect(css).toContain(".camera-stage.controls-expanded .zoom-dock{display:flex}");
  });

});
