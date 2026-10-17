import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COPILOT_HTML, COPILOT_JS, COPILOT_CSS } from "../src/copilot-assets";

const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/copilot.css", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const protocolSource = readFileSync(new URL("../src/sessions/copilot-protocol.ts", import.meta.url), "utf8");
const entryMenuScript = readFileSync(new URL("../public/entry-menu.js", import.meta.url), "utf8");
const siteChromeCss = readFileSync(new URL("../public/site-chrome.css", import.meta.url), "utf8");
const nativeAppCss = readFileSync(new URL("../public/native-app.css", import.meta.url), "utf8");
const nativeAppScript = readFileSync(new URL("../public/native-app.js", import.meta.url), "utf8");
const logo = readFileSync(new URL("../public/askmoina-bird-final.png", import.meta.url));
const signatureMark = readFileSync(new URL("../public/askmoina-mark.svg", import.meta.url), "utf8");
const favicon = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
const signatureGeometryPath = signatureMark.match(/<path[^>]* d="([^"]+)"/)?.[1] ?? "";
const authScript = readFileSync(new URL("../public/auth.js", import.meta.url), "utf8");
const serviceWorkerScript = readFileSync(new URL("../public/service-worker.js", import.meta.url), "utf8");

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

  it("keeps Vision orb-free, adds Back, and disables full-screen edge pulses", () => {
    expect(html).not.toContain('class="camera-placeholder-icon presence-orb"');
    expect(html).toContain('id="backButton"');
    expect(script).toContain("if (history.length > 1) history.back();");
    expect(authScript).toContain('error.name === "NotAllowedError"');
    expect(authScript).toContain("createAlternative.hidden = false");
    expect(css).toContain(".edge-glow{display:none!important}");
    expect(css).toContain("#spatialArButton{display:none!important;visibility:hidden!important;pointer-events:none!important}");
    expect(css).toContain("#spatialHud{display:none!important;visibility:hidden!important;pointer-events:none!important}");
  });

  it("keeps the Android splash dark and serves the complete AskMoina brand asset family", () => {
    expect(workerSource).toContain('url.pathname === "/manifest.webmanifest"');
    expect(workerSource).toContain('const legacyIcons = new Set(["/askmoina-bird-final.png", "/askmoina-app-icon-180.png"])');
    expect(workerSource).toContain('legacyIcons.has((icon.src || "").split("?")[0])');
    expect(workerSource).toContain('manifest.icons.push({');
    expect(workerSource).toContain('const manifestText = await assetResponse.text()');
    expect(workerSource).not.toContain('assetResponse.clone().json()');
    expect(workerSource).toContain('"/askmoina-app-icon-180.png"');
    expect(workerSource).toContain('"/askmoina-mark.svg"');
    expect(workerSource).toContain('"/askmoina-logo.svg"');
    expect(workerSource).toContain('"/askmoina-social-avatar.svg"');
    expect(workerSource).toContain('"/askmoina-visual-guide.svg"');
    expect(serviceWorkerScript).toContain('const CACHE_NAME = "askmoina-pwa-shell-v6"');
    for (const filename of ["askmoina-mark.svg", "askmoina-mark-dark.svg", "askmoina-app-icon.svg", "askmoina-logo.svg", "askmoina-social-avatar.svg", "pwa-icon-192.svg", "pwa-icon-512.svg", "pwa-icon-512.png"]) {
      expect(serviceWorkerScript).toContain("/" + filename + "?v=0.4.83");
    }
  });

  it("locks the approved AskMoina signature geometry at v1.0", () => {
    const geometryDigest = createHash("sha256").update(signatureGeometryPath).digest("hex");
    expect(geometryDigest).toBe("d62b384a92a4b488841095aa86af28dc1b675cd7b248ffb65df12507da25f206");
    expect(signatureMark).toContain('viewBox="0 0 163 115"');
  });

  it("uses the exact approved signature path in every vector brand variant", () => {
    const vectorFiles = [
      "askmoina-mark.svg",
      "favicon.svg",
      "askmoina-mark-dark.svg",
      "askmoina-app-icon.svg",
      "askmoina-app-icon-light.svg",
      "askmoina-logo.svg",
      "askmoina-logo-dark.svg",
      "askmoina-social-avatar.svg",
      "askmoina-visual-guide.svg",
      "pwa-icon-192.svg",
      "pwa-icon-512.svg",
    ];
    for (const filename of vectorFiles) {
      const svg = readFileSync(new URL("../public/" + filename, import.meta.url), "utf8");
      expect(svg, filename).toContain(signatureGeometryPath);
      expect(svg, filename).not.toContain('M27 91C48 87 66 75 79 56');
    }
  });

  it("keeps all raster logo variants as valid PNGs at the expected sizes", () => {
    const rasterFiles = [
      ["favicon-32.png", 32],
      ["askmoina-app-icon-180.png", 180],
      ["askmoina-bird-final.png", 128],
      ["askmoina-bird-mark.png", 64],
      ["askmoina-bird-64.png", 64],
    ];
    for (const [filename, dimension] of rasterFiles) {
      const png = readFileSync(new URL("../public/" + filename, import.meta.url));
      expect(png.subarray(0, 8), filename).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16), filename + " width").toBe(dimension);
      expect(png.readUInt32BE(20), filename + " height").toBe(dimension);
    }
  });

  it("keeps the approved signature mark separate from the live call control", () => {
    expect(signatureMark).toContain('viewBox="0 0 163 115"');
    expect(signatureMark).toContain('M162 5 L152 5');
    expect(signatureMark).not.toContain('M27 91C48 87 66 75 79 56');
    expect(html).not.toContain("askmoina-orb-control");
    expect(html).toContain('class="control-icon call-action-button"');
    expect(html).not.toContain('class="askmoina-orb-interior"');
  });

  it("uses roomier Apple-like camera controls and a recognizable camera-switch icon", () => {
    expect(html).toContain('id="muteMic"');
    expect(html).toContain('id="toggleCopilot"');
    expect(html).toContain('id="flipCamera" class="control-icon" disabled aria-label="Switch camera"');
    expect(html).toContain('<circle cx="12" cy="12" r="2"/>');
    expect(css).toContain("gap:clamp(14px,3.8vw,19px)!important;");
    expect(css).toContain("flex:0 0 56px!important;");
    expect(css).toContain("width:28px!important;height:28px!important;stroke-width:1.65!important;");
    expect(css).toContain("@media(max-width:380px)");
    expect(css).toContain("flex:0 0 52px!important;width:52px!important;height:52px!important;");
    expect(html).toContain('/copilot.css?v=0.4.92');
    expect(html).toContain('/copilot.js?v=0.4.92');
  });

  it("uses state-aware premium corner lighting instead of a live orb", () => {
    expect(html).toContain('<div class="corner-light" aria-hidden="true"><span></span><span></span><span></span><span></span></div>');
    expect(html).not.toContain("askmoina-orb-control");
    expect(html).not.toContain("askmoina-orb-interior");
    expect(css).toContain(".corner-light span");
    expect(css).toContain("@keyframes corner-light-drift");
    expect(css).toContain(".camera-stage.is-processing .corner-light");
    expect(css).toContain(".camera-stage.voice-active .voice-glow{display:none!important}");
    expect(css).toContain(".edge-glow{display:none!important}");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(script).toContain('setProperty("--corner-intensity"');
    expect(script).not.toContain("function syncLiquidOrbEnergy(energy)");
    expect(script).not.toContain("function startLiquidOrbAnimation()");
  });

  it("keeps a clear center call action to end an active conversation", () => {
    expect(html).toContain('id="toggleCopilot" class="control-icon call-action-button"');
    expect(html).toContain('class="icon-end"');
    expect(script).toContain('toggleButton.classList.toggle("is-live", active)');
    expect(script).toContain('toggleButton.setAttribute("aria-label", active ? "End call with askmoina" : "Start askmoina call")');
    expect(script).toContain('if (active || starting) {');
    expect(script).toContain("stopCopilot(true);");
    expect(script).toContain("function setProcessingState(processing)");
  });

  it("keeps the live Co-Pilot spoken-first with information cards but no Vault or live transcript cards", () => {
    expect(html).not.toContain('id="vaultButton"');
    expect(html).not.toContain('href="/vault"');
    expect(html).toContain('id="openLibrary"');
    expect(html).toContain('<section class="caption-dock" hidden');
    expect(html).toContain('id="responseCardTray"');
    expect(html).toContain('id="responseCardRestore"');
    expect(html).toContain('id="liveSearchStatus"');
    expect(script).toContain("function queueFinalizedConversationTurn(userText, assistantText)");
    expect(script).toContain("function completeLiveSearchProgress()");
    expect(workerSource).toContain("SPEECH-FIRST INTERACTION WITH INFORMATION CARDS");
    expect(workerSource).toContain('name: "search_past_conversations"');
    expect(workerSource).toContain("DISPLAY_RESPONSE_CARD_FUNCTION");
    expect(workerSource).not.toContain("Response cards are disabled in this Co-Pilot");
    expect(workerSource).not.toContain("Do not display spoken text or answers as live captions or response cards");
  });

  it("uses the guarded live protocol for audio, video, and overlay tool responses", () => {
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("copilot_mode: true");
    expect(script).toContain("let copilotStartGeneration = 0;");
    expect(script).toContain("if (reconnectTimer !== null) return;");
    expect(script).toContain("forceFreshSessionOnReconnect");
    expect(script).toContain("const LIVE_CLIENT_REPLACEMENT_CLOSE_CODE = 4002;");
    expect(script).toContain("Fresh session required after network loss");
    expect(script).toContain("forceFreshSessionOnReconnect = true;");
    expect(script).toContain("if (!isCurrentStart()) return;");
    expect(script).toContain("const preRollFrames = [];");
    expect(script).toContain('sendAudioActivityBoundary("start")');
    expect(script).toContain('sendAudioActivityBoundary("end")');
    expect(script).toContain("Manual activity mode sends PCM only inside a client-detected utterance");
    expect(script).not.toContain("sendAudioStreamEnd()");
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

  it("parses nested Gemini Live camelCase user and assistant transcription frames", () => {
    expect(script).toContain("const serverContent = message.server_content || message.serverContent;");
    expect(script).toContain("const inputTranscription = serverContent.input_transcription || serverContent.inputTranscription;");
    expect(script).toContain("const outputTranscription = serverContent.output_transcription || serverContent.outputTranscription;");
    expect(script).toContain('updateTranscript("user", inputTranscription.text)');
    expect(script).toContain('updateTranscript("assistant", outputTranscription.text)');
  });

  it("persists finalized live transcripts and task context to the authenticated history API", () => {
    expect(script).toContain("function queueFinalizedConversationTurn(userText, assistantText)");
    expect(script).toContain("function ensureConversationForScope(scope, firstUserText)");
    expect(script).toContain('fetch("/api/conversations"');
    expect(script).toContain('"/turns"');
    expect(script).toContain("conversationUserTurnPending");
    expect(script).toContain("summary: summaryLines");
    expect(script).toContain("taskProgress: progress");
    expect(script).toContain("credentials: \"same-origin\"");
    expect(script).toContain("if (!user && !assistant) return;");
    expect(script).toContain("Do not let persistence faults turn into a Live session fault");
    expect(script).not.toContain("audioBase64");
    expect(script).not.toContain("videoBase64");
  });

  it("offers account-scoped conversation history, full transcript restore, and persistent Key Memories controls", () => {
    expect(html).toContain('id="openLibrary"');
    expect(html).toContain('id="librarySheet"');
    expect(html).toContain('id="conversationList"');
    expect(html).toContain('id="conversationDetailView"');
    expect(html).toContain('id="continueConversation"');
    expect(html).toContain('id="memoryEnabledSwitch"');
    expect(html).toContain('id="clearAllMemories"');
    expect(script).toContain('apiJson("/api/conversations?status=all&limit=500")');
    expect(script).toContain('fetchEntireConversation(conversationId)');
    expect(script).toContain('resumeConversationForNextStart.conversation.conversationId');
    expect(script).toContain('RESUMED CONVERSATION');
    expect(script).toContain('PERSISTENT USER PREFERENCES');
    expect(script).toContain('PATCH", body: JSON.stringify({ enabled })');
    expect(script).toContain('DELETE');
    expect(css).toContain(".library-panel");
    expect(css).toContain(".apple-switch input:checked+span");
  });

  it("keeps rolling summary notes available for older saved conversation context", () => {
    expect(script).toContain("function mergeConversationSummary(previousSummary, latestSummary, progress)");
    expect(script).toContain("CONVERSATION_SUMMARY_RECENT_MARKER");
    expect(script).toContain("conversationSummariesByScope.set(scope, summaryLines)");
    expect(script).toContain("Saved cumulative summary and prior interaction notes:");
    expect(script).toContain("Accumulated history notes:");
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
  
  it("keeps the four core controls in one row and exposes pinch zoom without a scale bar", () => {
    expect(html).not.toContain('id="toggleMoreControls"');
    expect(html).not.toContain('id="secondaryControls"');
    expect(html).not.toContain('id="vaultButton" href="/vault"');
    expect(html).toContain('id="openLibrary"');
    expect(html).toContain('id="flipCamera"');
    expect(html).toContain('id="muteMic"');
    expect(html).toContain('id="toggleCopilot"');
    expect(html).toContain('id="zoomDock" hidden aria-hidden="true"');
    expect(html).not.toContain('id="toggleCaptions"');
    expect(script).toContain('stage.addEventListener("touchmove"');
    expect(script).not.toContain('stage.classList.toggle("controls-expanded", expanded)');
    expect(css).toContain("#zoomDock,.zoom-dock[hidden]{display:none!important");
    expect(css).toContain("min-width:61px!important;max-width:61px");
    expect(css).toContain(".camera-stage.pre-start .camera-controls");
    expect(script).toContain("const cameraStream = active ? microphoneStream : previewStream");
    expect(script).toContain("track.enabled = !microphoneMuted");
    expect(script).toContain("Microphone will stay muted when the call starts.");
  });

  it("makes Vision feel responsive and keeps error recovery in place", () => {
    expect(html).not.toContain('id="intelligenceIntro"');
    expect(html).not.toContain('class="intelligence-intro"');
    expect(html).toContain('id="visionSlideHandle"');
    expect(html).toContain('class="vision-slide-copy"');
    expect(html).toContain("Slide to start");
    expect(html).not.toContain("Tap to open camera");
    expect(script).toContain('showProblemButton.addEventListener("pointermove"');
    expect(script).toContain('persistentConnectionIssue = { title: safeTitle, message: safeMessage }');
    expect(script).toContain("function hideConnectionNotice(resolved = false)");
    expect(script).toContain("hideConnectionNotice(true)");
    expect(script).toContain('connectionNoticeAction.textContent = isError ? "Try again" : "Reconnect now"');
    expect(script).toContain('showConnectionNotice("Network is slow"');
    expect(script).toContain('"slow");');
    expect(script).toContain("void prepareCameraPreview();");
    expect(script).toContain('window.location.replace("/")');
    expect(script).toContain("function playConnectionChime()");
    expect(script).toContain("function playDisconnectSound()");
    expect(script).toContain("airy, glass-like");
    expect(css).toContain("@keyframes intelligence-intro-arrive");
    expect(css).toContain("@keyframes vision-text-shimmer");
    expect(css).toContain(".vision-slide-copy{");
    expect(css).toContain("brightness(1.32)");
    expect(css).toContain(".camera-stage.has-notice #videoPreview");
    expect(css).toContain(".edge-glow{display:none!important}");
  });

});


describe("Native mobile-first AskMoina shell", () => {
  it("lands signed-in users on the camera instead of a website product chooser", () => {
    expect(workerSource).toContain("withNativeAppShell(html, appVersion, authenticated)");
    expect(workerSource).toContain("body = withNativeAppShell(body, env.APP_VERSION || \"0.4.80\", true)");
    expect(workerSource).not.toContain("ENTRY_PRODUCTS_OVERLAY");
    expect(workerSource).toContain('url.pathname === "/login" || url.pathname === "/login.html"');
    expect(workerSource).toContain('authenticated ? "camera" : "login"');
    expect(workerSource).toContain("const NATIVE_APP_HEADER_AUTH");
    expect(workerSource).toContain("const NATIVE_APP_HEADER_GUEST");
    expect(workerSource).toContain('else html = html.replace("</main>", "</main>" + NATIVE_APP_HEADER_GUEST)');
  });

  it("uses app-specific floating controls and an accessible native menu instead of the generic app header", () => {
    expect(workerSource).toContain("askmoina-bird-final.png");
    expect(workerSource).toContain("openAppMenu");
    expect(workerSource).toContain("openLibrary");
    expect(workerSource).toContain("const NATIVE_APP_MENU_SHEET");
    expect(workerSource).toContain("native-menu-signout");
    expect(workerSource).toContain("data-logout");
    expect(nativeAppCss).toContain(".native-app-chrome");
    expect(nativeAppCss).toContain(".native-menu-sheet");
    expect(nativeAppCss).toContain("min-width:44px");
    expect(nativeAppScript).toContain('document.addEventListener("keydown"');
    expect(nativeAppScript).toContain("event.key === \"Escape\"");
    expect(nativeAppScript).toContain("returnFocus.focus");
  });

  it("keeps camera and microphone startup behind account authentication", () => {
    expect(workerSource).toContain("removeCopilotClientScript(html)");
    expect(workerSource).toContain('.replace(\'<script src="/session-ui.js" defer></script>\', "")');
    expect(workerSource).toContain('ENTRY_AUTH_OVERLAY + \'<script src="/auth.js?v=\' + appVersion + \'" defer></script></body>\'');
    expect(workerSource).toContain('Permissions-Policy": "microphone=(self), camera=(self)');
    expect(workerSource).toContain("There is no guest access.");
    expect(workerSource).toContain("native-account-page");
    expect(workerSource).toContain('url.pathname === "/login"');
    expect(workerSource).toContain('url.pathname === "/account"');
  });

  it("keeps History and Key Memories in the existing camera app and uses a mobile sheet", () => {
    expect(html).toContain('id="librarySheet"');
    expect(html).toContain('id="libraryTitle">History &amp; Key Memories');
    expect(nativeAppCss).toContain(".library-panel");
    expect(nativeAppCss).toContain("env(safe-area-inset-bottom,0px)");
    expect(nativeAppCss).toContain("native-sheet-in");
    expect(workerSource).toContain("NATIVE_APP_MENU_SHEET + \"</main>\"");
  });

  it("serves secondary information as mobile screens, not blank placeholders with a generic header", () => {
    expect(workerSource).toContain("const NATIVE_SITE_INFO");
    expect(workerSource).toContain("renderSiteInfoPage(infoPath, env.APP_VERSION || \"0.4.80\")");
    expect(workerSource).toContain("url.searchParams.has(\"view\")");
    expect(workerSource).not.toContain("const pageHtml = withSiteChrome(infoPage");
    for (const phrase of ["A camera-first co-pilot for the real world.", "Developer resources are being prepared.", "Your camera. Your control.", "Partnership and investor information is being prepared.", "Donation processing is not enabled on this page yet"]) {
      expect(workerSource).toContain(phrase);
    }
    expect(nativeAppCss).toContain(".native-info-main");
    expect(workerSource).toContain('"/account.html"');
  });

  it("keeps legacy menu routes reachable without a fake donation total on the home screen", () => {
    expect(workerSource).toContain("/account");
    for (const view of ["about", "developer", "help", "privacy", "pricing", "donate"]) {
      expect(workerSource).toContain("?view=" + view);
    }
    expect(workerSource).toContain("Hardware");
    expect(workerSource).toContain("Under development");
    expect(workerSource).not.toContain("Illustrative demo total");
    expect(workerSource).not.toContain("data-donation-counter");
  });

  it("keeps the disconnect tone distinct and returns to the camera slider", () => {
    expect(script).toContain("function playDisconnectSound()");
    expect(script).toContain("disconnectToneUntil = performance.now() + 560");
    expect(script).toContain("peak: 0.052");
    expect(script).toContain("peak: 0.058");
    expect(script).toContain('window.setTimeout(() => stage.classList.remove("is-returning"), 570)');
    expect(script).not.toContain('window.setTimeout(() => window.location.replace("/"), 570)');
  });

  it("keeps the existing Live Co-Pilot browser assets synchronized", () => {
    expect(COPILOT_HTML).toBe(html);
    expect(COPILOT_JS).toBe(script);
    expect(COPILOT_CSS).toBe(css);
  });
});

describe("Apple-style live-search progress", () => {
  it("starts on real search work and stays hidden during user speech", () => {
    expect(html).toContain('id="liveSearchStatus" hidden');
    expect(html).toContain('id="liveSearchTitle"');
    expect(html).toContain('role="progressbar"');
    expect(script).toContain("function startLiveSearchProgress()");
    expect(script).toContain("function completeLiveSearchProgress()");
    expect(script).toContain("liveSearchStatus.hidden = !workActive || Boolean(micSpeechGateActive)");
    expect(script).toContain('call.name === "search_current_web"');
    expect(css).toContain("@keyframes live-search-sweep");
    expect(workerSource).toContain("The browser displays a contextual Apple-style loader");
  });

  it("finishes search progress without requiring a rendered answer card", () => {
    expect(script).toContain("function completeLiveSearchProgress()");
    expect(script).toContain("liveSearchLookupCompleted = false;");
    expect(script).toContain("pendingResponseCards = [];");
    expect(script).not.toContain("if (!responseCardRenderedForTurn) ensureTranscriptFallbackCard(true);");
    expect(html).toContain('id="responseCardTray"');
    expect(html).toContain('<section class="caption-dock" hidden');
  });
});

describe("Assistant-voiced search progress", () => {
  it("waits for generated search-progress speech or the backend event, not just the user's transcript", () => {
    expect(script).toContain("LIVE_SEARCH_PROGRESS_SPEECH.test(normalized)");
    expect(script).toContain('if (role !== "assistant") return;');
    expect(script).toContain("startLiveSearchProgress();");
    expect(script).toContain("handleTranscriptAcknowledgement(role, entry.text)");
    const handlerStart = script.indexOf("function handleTranscriptAcknowledgement(role, text)");
    const assistantGate = script.indexOf('if (role !== "assistant") return;', handlerStart);
    const userBranch = script.slice(handlerStart, assistantGate);
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(userBranch).not.toContain("startLiveSearchProgress()");
    expect(userBranch).not.toContain("LIVE_SEARCH_PROGRESS_SPEECH");
    expect(script).not.toContain("function showLiveSearchAcknowledgement");
  });
});

describe("Information-card controls", () => {
  it("exposes answer-sheet minimize/restore controls without restoring the Vault", () => {
    expect(html).toContain('id="responseCardTray"');
    expect(html).toContain('id="responseCardMinimize"');
    expect(html).toContain('id="responseCardRestore"');
    expect(html).not.toContain('id="vaultButton"');
    expect(html).not.toContain('href="/vault"');
  });
});

describe("Grounded search resilience", () => {
  it("keeps the supported fast grounding model and retries slow/transient provider failures", () => {
    expect(workerSource).toContain('const model = "gemini-3.8-flash";');
    expect(workerSource).toContain("const GROUNDED_SEARCH_TIMEOUT_MS = 32_000;");
    expect(workerSource).toContain("const GROUNDED_SEARCH_MAX_ATTEMPTS = 3;");
    expect(workerSource).toContain("const GROUNDED_SEARCH_BUDGET_MS = 100_000;");
    expect(workerSource).toContain("GROUNDED_SEARCH_RETRYABLE_HTTP_STATUSES.has(response.status)");
    expect(workerSource).toContain('temperature: 0.0');
    expect(workerSource).toContain('reason: timedOut ? "timeout" : "network"');
  });
});


describe("Spoken ranked-list UX", () => {
  it("grounds ranked answers and reads verified results through voice rather than answer cards", () => {
    expect(workerSource).toContain("function startForcedRankedListLookup(userRequest: string)");
    expect(workerSource).toContain("Mandatory ranked-list grounding started");
    expect(workerSource).toContain("const answerInstruction = fullTableVerified");
    expect(workerSource).toContain("grounded_response_card: builtCard");
    expect(workerSource).toContain("let groundedAnswerText = result");
    expect(workerSource).toContain("DISPLAY_RESPONSE_CARD_FUNCTION");
  });
});

describe("History-based recall and spoken ranked-list follow-ups", () => {
  it("retrieves older user details from the same account's saved turns", () => {
    expect(workerSource).toContain('name: "search_past_conversations"');
    expect(workerSource).toContain("searchPriorConversationHistory(env, ownerId, query)");
    expect(workerSource).toContain("CROSS-SESSION RECALL");
    expect(script).toContain("refreshCrossSessionRecallContext(true)");
  });
});

describe("RC11 network recovery", () => {
  it("waits for the browser's offline/online transitions and requires an explicit user reconnect", () => {
    expect(script).toContain('window.addEventListener("offline"');
    expect(script).toContain('window.addEventListener("online"');
    expect(script).toContain('navigator.onLine === false');
    expect(script).toContain("will not auto-open your camera or microphone");
    expect(script).toContain("Tap Reconnect now to resume the live session.");
    expect(script).toContain("still offline");
  });

  it("does not add any guest/demo path to the signed-in Co-Pilot or auth screen", () => {
    expect(script).not.toMatch(/guestDemo|isGuestDemo|guest-demo/i);
    expect(workerSource).not.toContain("/api/auth/guest/start");
    expect(workerSource).not.toContain("reserveGuestVoiceSession");
    expect(authScript).not.toContain("guestDemoStart");
    expect(siteChromeCss).not.toContain("entry-demo-action");
  });
});

describe("RC11 bounded search latency", () => {
  it("starts the wall-clock budget before Google authentication and bounds each retrieval attempt by the remaining budget", () => {
    const searchStart = workerSource.indexOf("const searchStartedAt = Date.now();", workerSource.indexOf("performGroundedWebSearchOnce"));
    const budgetStart = workerSource.indexOf("const groundingBudgetStartedAt = searchStartedAt;", searchStart);
    const authentication = workerSource.indexOf("const accessToken = await getGoogleAccessToken(env);", searchStart);
    const remainingBudget = workerSource.indexOf("const remainingBudget = searchBudgetMs - elapsedGroundingMs;", searchStart);
    expect(searchStart).toBeGreaterThan(-1);
    expect(budgetStart).toBeGreaterThan(searchStart);
    expect(authentication).toBeGreaterThan(budgetStart);
    expect(remainingBudget).toBeGreaterThan(authentication);
    expect(workerSource).toContain("const remainingAfterAuthentication = searchBudgetMs - (Date.now() - groundingBudgetStartedAt);");
    expect(workerSource).toContain("const attemptTimeoutMs = Math.min(searchTimeoutMs, remainingBudget);");
    expect(workerSource).toContain("Grounded search exceeded its");
    expect(workerSource).toContain("const searchBudgetMs = rankedListSearchBudget ? 100_000 : GROUNDED_SEARCH_BUDGET_MS;");
    expect(workerSource).toContain("waitForGroundedRetry(delayMs: number, budgetStartedAt: number, budgetMs: number)");
    expect(workerSource).toContain("budgetMs - (Date.now() - budgetStartedAt) <= delayMs + 500");
  });

  it("coalesces simultaneous duplicate grounded lookups but does not cache completed results", () => {
    expect(workerSource).toContain("const groundedSearchFlights = new SingleFlight<string>();");
    expect(workerSource).toContain("groundedSearchFlights.run(flightKey");
    expect(workerSource).toContain("do not cache completed/current results");
  });
});

describe("RC7 zero-gap search-status feedback", () => {
  it("keeps processing hidden during speech and contextual while search runs", () => {
    expect(script).toContain('if (!micSpeechGateActive) {');
    expect(script).toContain("micNoiseCalibrationUntil = now + 500");
    expect(script).toContain("zeroCrossingRate >= 0.008 && zeroCrossingRate <= 0.38");
    expect(script).toContain("now - micSpeechCandidateAt >= 120");
    expect(script).toContain('handleTranscriptAcknowledgement("user", interimUserTranscription.text)');
    expect(script).not.toContain("startQuietThinkingLoader");
    expect(script).not.toContain("Thinking through your request");
    expect(script).toContain("function completeLiveSearchProgress()");
    expect(html).toContain('id="responseCardTray"');
  });
});

describe("Persistent live-search progress", () => {
  it("keeps genuine search progress visible through slow provider and offline states", () => {
    expect(script).toContain("liveSearchStartedAt = Date.now()");
    expect(script).toContain("navigator.onLine === false");
    expect(script).toContain("liveSearchWatchdogTimer = window.setTimeout(refreshSlowSearchStatus, 6_000)");
    expect(script).toContain("function completeLiveSearchProgress()");
    expect(script).toContain("liveSearchStatus.hidden = true;");
    expect(script).not.toContain("updateLiveSearchProgress(100)");
  });
});

describe("Voice-turn status visibility", () => {
  it("hides search progress during user speech without showing generic quiet-thinking status", () => {
    expect(script).toContain("liveSearchStatus.hidden = !workActive || Boolean(micSpeechGateActive)");
    expect(script).toContain("liveSearchStatus.hidden = true;");
    expect(script).toContain("function startLiveSearchProgress()");
    expect(script).toContain("LIVE_SEARCH_PROGRESS_SPEECH.test(normalized)");
    expect(script).not.toContain("No status surface while the user speaks.");
    expect(script).not.toContain("const userSpeaking = Boolean(micSpeechGateActive && !assistantSpeaking)");
    expect(script).not.toContain("startQuietThinkingLoader");
    expect(script).not.toContain("Thinking through your request");
    expect(script).toContain("navigator.onLine === false");
  });
});

describe("long-running Live session continuity", () => {
  const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const protocol = readFileSync(new URL("../src/sessions/copilot-protocol.ts", import.meta.url), "utf8");
  const providerFrames = readFileSync(new URL("../src/sessions/provider-frame.ts", import.meta.url), "utf8");

  it("enables context compression and session resumption", () => {
    expect(worker).toContain("contextWindowCompression: {");
    expect(worker).toContain("triggerTokens: 48_000");
    expect(worker).toContain("targetTokens: 32_000");
    expect(worker).toContain("sessionResumption: { transparent: true }");
    expect(worker).toContain("async function resumeLiveUpstream");
    expect(worker).toContain("lastSessionResumptionCheckpoint");
    expect(worker).toContain("function replayUnconsumedMessages");
    expect(worker).toContain("await replayUnconsumedMessages(true)");
    expect(worker).toContain("compactReplayMessagesForResumption");
    expect(worker).toContain("replayInProgress");
    expect(worker).toContain('state: "resuming"');
    expect(worker).toContain('state: "resumed"');
  });

  it("keeps resumption handles relay-side and understands provider checkpoints", () => {
    expect(providerFrames).toContain("sessionResumptionUpdate");
    expect(providerFrames).toContain("goAway");
    expect(worker).toContain("const isSessionResumptionUpdate = Boolean(providerMessage?.sessionResumptionUpdate)");
    expect(worker).toContain("update.resumable === true");
    expect(worker).toContain("(resumedSessionSetupComplete || isSessionResumptionUpdate || (resumptionInProgress && providerMessage?.error)) ? \"\" : frameText");
    expect(worker).not.toContain("clientMessageIndex: index");
  });

  it("indexes actually-sent messages separately from the wire payload and buffers reconnect input", () => {
    expect(worker).toContain("let nextClientMessageIndex = 1");
    expect(worker).toContain("const index = nextClientMessageIndex++");
    expect(worker).toContain("replayUnconsumedMessages(true)");
    expect(worker).toContain("lastSessionResumptionCheckpoint = { handle: resumedHandle, lastConsumedClientMessageIndex: 0 }");
    expect(worker).toContain("function queuePendingUpstreamMessage");
    expect(worker).toContain("function drainPendingUpstreamMessages");
    expect(worker).toContain("function rememberAndSendUpstreamMessage");
    expect(worker).toContain("lastConsumedClientMessageIndex");
  });

  it("supports higher-detail, bounded camera frames", () => {
    expect(protocol).toContain("const MAX_MEDIA_BASE64_CHARS = 48_000");
    expect(worker).toContain("const MAX_CLIENT_FRAME_CHARS = 65_536");
    expect(script).toContain("const maxDimension = 768");
    expect(script).toContain("data.length <= 48_000");
    expect(script).toContain("window.setInterval(sendVideoFrame, 1000)");
  });

  it("keeps the local camera clear after a live session drops while bounded reconnect attempts run", () => {
    expect(script).toContain("automaticReconnectAttempts >= 3");
    expect(script).toContain("hideConnectionNotice(true);");
    expect(script).toContain("function syncDisconnectedPreviewAppearance()");
    expect(script).toContain('video.style.setProperty("filter", "none", "important")');
    expect(script).toContain("if (wasConnected) recoveryPreviewClear = true;");
    expect(script).toContain('video.style.setProperty("transition", "none", "important")');
    expect(css).toContain(".camera-stage.recovery-preview-clear #videoPreview{filter:none!important;-webkit-filter:none!important;transform:none!important;transition:none!important}");
    expect(css).toContain(".camera-stage.pre-start.has-notice:not(.is-connecting) #videoPreview{filter:none!important}");
    expect(css).toContain(".camera-stage.has-notice:not(.voice-active):not(.is-connecting) #videoPreview{filter:none!important}");
  });

  it("discloses temporary provider-side session caching", () => {
    expect(html).toContain("temporarily cache session content for up to 24 hours");
    expect(html).not.toContain('class="privacy-hint sr-only"');
  });
});


describe("Apple-style active turn contract", () => {
  it("keeps processing state contextual, continues Live progress, and stays spoken-first", () => {
    expect(script).toContain("LIVE_SEARCH_PROGRESS_SPEECH.test(normalized)");
    expect(script).toContain("liveSearchStatus.hidden = !workActive || Boolean(micSpeechGateActive)");
    expect(script).not.toContain("Thinking through your request");
    expect(script).not.toContain("startQuietThinkingLoader");
    expect(workerSource).toContain('behavior: "NON_BLOCKING"');
    expect(workerSource).toContain('function sendLiveSearchProgressCue(cueNumber: number, requestContext = "")');
    expect(workerSource).toContain("liveSearchProgressCueCount < 8");
    expect(workerSource).toContain("SPEECH-FIRST");
    expect(workerSource).toContain("M42 — CONTINUOUS VOICE DURING BACKGROUND WORK");
  });
});


describe("Live microphone explicit activity detection", () => {
  it("buffers bounded pre-roll while idle, then brackets streamed PCM with activityStart and activityEnd", () => {
    const captureStart = script.indexOf("function startAudioCapture()");
    const captureEnd = script.indexOf("function decodePcm16(", captureStart);
    expect(captureStart).toBeGreaterThanOrEqual(0);
    expect(captureEnd).toBeGreaterThan(captureStart);
    const capture = script.slice(captureStart, captureEnd);
    const processorStart = capture.indexOf("processor.onaudioprocess = (event) => {");
    expect(processorStart).toBeGreaterThanOrEqual(0);
    const activityCapture = capture.slice(processorStart);
    const speechGateEnded = activityCapture.indexOf("const speechGateEnded = speechGateBeforeFrame && !micSpeechGateActive;");
    const idleBranch = activityCapture.indexOf("bufferPreRollFrame(samples);", speechGateEnded);
    expect(speechGateEnded).toBeGreaterThanOrEqual(0);
    expect(capture).toContain("const preRollFrames = [];");
    expect(capture).toContain("const preRollChunkLimit = Math.max(4");
    expect(activityCapture).toContain('sendAudioActivityBoundary("start")');
    expect(activityCapture).toContain('sendAudioActivityBoundary("end")');
    expect(activityCapture).toContain("flushPreRollFrames();");
    expect(activityCapture).toContain("if (micSpeechGateActive) {");
    expect(activityCapture).toContain("} else if (speechGateEnded) {");
    expect(idleBranch).toBeGreaterThan(speechGateEnded);
    expect(script).toContain("const LOCAL_VAD_END_SILENCE_MS = 700;");
    expect(script).toContain("function sendAudioActivityBoundary(kind)");
    expect(script).toContain('kind === "start" ? { activity_start: true } : { activity_end: true }');
    expect(script).not.toContain("function sendAudioStreamEnd()");
    expect(script).not.toContain("realtime_input: { audio_stream_end: true }");
    expect(workerSource).toContain('parsed.kind === "activity_start" || parsed.kind === "activity_end"');
    expect(workerSource).toContain("automaticActivityDetection: { disabled: true }");
    expect(protocolSource).toContain('case "activity_start":');
    expect(protocolSource).toContain('case "activity_end":');
  });
});


describe("Native-first app experience v2", () => {
  it("uses the success and blurred-slider onboarding instead of separate camera welcome and splash pages", () => {
    expect(workerSource).not.toContain("const NATIVE_CAMERA_WELCOME = ");
    expect(workerSource).not.toContain("nativeCameraWelcomeTitle");
    expect(workerSource).toContain("const POST_AUTH_ONBOARDING = ");
    expect(workerSource).not.toContain("Show Moina your world.");
    expect(workerSource).toContain("openAppMenu");
    expect(workerSource).toContain("openLibrary");
    expect(workerSource).toContain('const NATIVE_APP_HEADER_GUEST = "";');
    expect(workerSource).not.toContain("html.replace(welcomeMarker, NATIVE_CAMERA_WELCOME + welcomeMarker)");
    expect(nativeAppCss).toContain(".post-auth-onboarding-slider-slot .show-problem-button");
    expect(nativeAppCss).toContain(".native-app-chrome .native-app-menu-trigger");
    expect(nativeAppCss).toContain("prefers-reduced-motion:reduce");
  });

  it("keeps answer and sign-in surfaces readable on a phone and respects safe areas", () => {
    expect(nativeAppCss).toContain("#responseCardContent{font-size:16px;line-height:1.62}");
    expect(nativeAppCss).toContain("env(safe-area-inset-top,0px)");
    expect(nativeAppCss).toContain('body[data-page="login"] .entry-page-heading.auth-page-heading:before');
  });
});


describe("Primary camera entry", () => {
  it("requires a completed iOS-style slide gesture and never starts from a tap", () => {
    expect(html).toContain('aria-label="Slide to start askmoina camera guidance"');
    expect(html).toContain('id="visionSlideLabel">Slide to start</span>');
    expect(html).toContain('class="vision-slide-arrows"');
    expect(script).toContain('showProblemButton.addEventListener("pointerup"');
    expect(script).toContain('showProblemButton.addEventListener("click", (event) => { event.preventDefault(); });');
    expect(script).toContain("keyboardSlideActive");
    expect(script).not.toContain("a tap should start the camera too");
    expect(script).not.toContain("The primary camera entry action works with a simple tap");
    expect(css).toContain(".camera-stage.pre-start #showProblemButton");
    expect(css).toContain(".camera-stage.pre-start .camera-controls");
    expect(css).toContain(".camera-stage.pre-start .camera-controls{\n  display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;");
    expect(css).toContain(".camera-stage.pre-start #toggleCopilot");
    expect(css).toContain("background:#171719;color:#fff");
    expect(css).not.toContain("background:#34c759;color:#fff");
    expect(css).not.toContain("rgba(52,199,89");
    expect(html).toContain("call-action-button");
    expect(css).not.toContain('body[data-entry-state] .camera-controls');
    expect(css).toContain("z-index:95!important");
  });
});



describe("Dark-first app shell and launch branding", () => {
  it("uses a circular favicon while retaining the platform-masked Home Screen icon", () => {
    expect(html).toContain('href="/favicon.svg?v=0.4.80"');
    expect(html).toContain('href="/favicon-32.png?v=0.4.80"');
    expect(favicon).toContain('<circle cx="32" cy="32" r="29.5" fill="#ffffff"');
    expect(favicon).toContain(signatureGeometryPath);
    expect(workerSource).toContain('href="/favicon.svg?v=0.4.83"');
    expect(workerSource).toContain('href="/askmoina-app-icon-180.png?v=0.4.83"');
  });

  it("keeps Co-Pilot, sign-in, install, and app shell surfaces dark by default", () => {
    expect(html).toContain('<meta name="color-scheme" content="dark">');
    expect(css).toContain(".entry-overlay{background:#090b0f!important");
    expect(nativeAppCss).toContain(":root{color-scheme:dark");
    expect(readFileSync(new URL("../public/install.css", import.meta.url), "utf8")).toContain("color-scheme: dark");
    expect(workerSource).toContain('const themeColor = "#030406"');
    expect(workerSource).toContain('<meta name="color-scheme" content="dark">');
  });


  it("routes successful signup/sign-in through account-created confirmation and then the camera slider", () => {
    expect(authScript).toContain('"/?onboarding=1"');
    expect(workerSource).toContain("const POST_AUTH_ONBOARDING = ");
    expect(workerSource).toContain('if (authenticated) {\n        html = html.replace("</body>", entryLaunchOverlay + POST_AUTH_ONBOARDING + "</body>");\n      }');
    expect(nativeAppScript).toContain('get("onboarding") === "1"');
    expect(nativeAppScript).toContain('document.addEventListener("askmoina:user-disconnected"');
    expect(nativeAppScript).toContain('overlay.classList.add("is-slide-mode")');
    expect(script).toContain('new Event("askmoina:user-disconnected")');
    expect(workerSource).toContain('POST_AUTH_ONBOARDING + "</body>"');
    expect(workerSource).toContain('id="postAuthSuccessTitle"');
    expect(workerSource).toContain("You're all set!");
    expect(workerSource).toContain('id="onboardingGetStarted">Get Started');
    expect(workerSource).toContain('id="postAuthSlideTitle">Slide to show<br>your problem');
    expect(nativeAppScript).toContain('document.querySelector("#postAuthOnboarding")');
    expect(nativeAppScript).toContain('sliderSlot.appendChild(slider)');
    expect(nativeAppScript).toContain('completionObserver.observe(slider, { attributes: true, attributeFilter: ["class"] })');
    expect(nativeAppCss).toContain(".post-auth-account-created");
    expect(nativeAppCss).toContain(".post-auth-slide-stage");
    expect(nativeAppCss).toContain(".post-auth-onboarding-slider-slot .show-problem-button");
    expect(script).toContain("if (slideProgress() >= 0.82) completeSlide()");
  });

  it("renders Interface 1 before Interface 2 or the authenticated camera flow", () => {
    expect(workerSource).toContain("const ENTRY_LAUNCH_OVERLAY = ");
    expect(workerSource).toContain('class="app-launch-transition"');
    expect(workerSource).toContain('class="launch-signature-orb"');
    expect(workerSource).toContain('src="/askmoina-mark.svg"');
    expect(workerSource).toContain('class="launch-signature-title">askmoina</span>');
    expect(workerSource).toContain('class="launch-signature-tagline">SEE · UNDERSTAND · HELP</span>');
    expect(workerSource).toContain("entryLaunchOverlay + ENTRY_AUTH_OVERLAY");
    expect(workerSource).toContain("entryLaunchOverlay + POST_AUTH_ONBOARDING");
    expect(nativeAppCss).toContain("@media(prefers-reduced-motion:reduce)");
    expect(nativeAppCss).toContain(".launch-signature-orb:after");
    expect(nativeAppCss).toContain("@keyframes launch-smoke-turn");
    expect(nativeAppCss).toContain(".post-auth-success-orb.presence-orb");
    expect(nativeAppCss).toContain(".post-auth-success-orb .liquid-current-cyan");
    expect(nativeAppCss).toContain(".post-auth-success-orb .liquid-specular");
  });
});
