import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPILOT_HTML, COPILOT_JS, COPILOT_CSS } from "../src/copilot-assets";

const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/copilot.css", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const entryMenuScript = readFileSync(new URL("../public/entry-menu.js", import.meta.url), "utf8");
const siteChromeCss = readFileSync(new URL("../public/site-chrome.css", import.meta.url), "utf8");
const logo = readFileSync(new URL("../public/askmoina-bird-final.png", import.meta.url));
const authScript = readFileSync(new URL("../public/auth.js", import.meta.url), "utf8");

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
    expect(script).toContain("if (history.length > 1) history.back();");
    expect(authScript).toContain('error.name === "NotAllowedError"');
    expect(authScript).toContain("createAlternative.hidden = false");
    expect(css).toContain("@keyframes intelligence-pulse");
    expect(css).toContain("#spatialArButton{display:none!important;visibility:hidden!important;pointer-events:none!important}");
    expect(css).toContain("#spatialHud{display:none!important;visibility:hidden!important;pointer-events:none!important}");
  });

  it("uses a camera-lens Vision mark, obvious authentication button, and wider live edge pulses", () => {
    expect(html).not.toContain("toggleCaptions");
    expect(html).toContain('<rect x="3.2" y="6.6" width="11.5" height="10.8" rx="2.2"/>');
    expect(css).toContain("@keyframes edge-width-pulse");
    expect(css).toContain(".camera-stage.is-listening .edge-glow:after");
    expect(css).toContain(".camera-stage.is-speaking .edge-glow:after");
    expect(css).toContain(".entry-passkey-trailing");
  });

  it("renders RC4 full-screen answer sheets with ten rows and source links", () => {
    expect(html).toContain('id="responseCardTray"');
    expect(html).toContain('id="responseCardTitle"');
    expect(html).toContain('id="responseCardContent"');
    expect(html).toContain('id="responseCardCollapse"');
    expect(html).toContain('id="responseCardDismiss"');
    expect(html).toContain('id="responseCardMinimize"');
    expect(html).toContain('id="responseCardRestore"');
    expect(script).toContain("function normalizeResponseCardPayload(value)");
    expect(script).toContain("function renderResponseCard(value, force = false)");
    expect(script).toContain("function dismissResponseCard()");
    expect(script).toContain("function minimizeResponseCard()");
    expect(script).toContain("function restoreResponseCard()");
    expect(script).toContain("function createTranscriptFallbackCard(userText, assistantText)");
    expect(script).toContain("if (!prompt) return null;");
    expect(script).toContain("A preflight acknowledgement is not evidence of an active search.");
    expect(script).toContain("liveSearchWatchdogTimer = window.setTimeout");
    expect(script).toContain("valueNode.textContent = typeof value === \"string\" ? value : \"\";");
    expect(script).toContain("The complete designed response card is now visible as a full-screen answer sheet.");
    expect(script).toContain("const existingGroundedCardIsVisible = !responseCardTray.hidden");
    expect(script).toContain("function ensureTranscriptFallbackCard(final = false)");
    expect(script).toContain("complete natural response aloud");
    expect(script).toContain("responseCardManuallyMinimizedForTurn");
    expect(script).toContain("function renderGroundedDetails(card)");
    expect(script).toContain("Optional source links are best-effort");
    expect(script).toContain("if (Array.isArray(value.sources))");
    expect(script).toContain("Optional source links are best-effort");
    expect(script).toContain("if (Array.isArray(value.sources))");
    expect(script).toContain("value.details.length > 10");
    expect(script).toContain("value.slice(0, 10)");
    expect(script).toContain("new window.SpeechSynthesisUtterance");
    expect(script).toContain('link.rel = "noopener noreferrer"');
    expect(css).toContain(".response-card-tray[hidden]{display:none!important}");
    expect(css).toContain("position:fixed;inset:0;z-index:120");
    expect(css).toContain(".response-card-row-check");
    expect(css).toContain(".response-card-source-link");
    expect(css).toContain(".response-card-details[hidden]{display:none!important}");
    expect(css).toContain("@media(prefers-reduced-transparency:reduce)");
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
  
  it("keeps the four core controls in one row and exposes pinch zoom without a scale bar", () => {
    expect(html).not.toContain('id="toggleMoreControls"');
    expect(html).not.toContain('id="secondaryControls"');
    expect(html).toContain('id="vaultButton" href="/vault"');
    expect(html).toContain('id="flipCamera"');
    expect(html).toContain('id="muteMic"');
    expect(html).toContain('id="toggleCopilot"');
    expect(html).toContain('id="zoomDock" hidden aria-hidden="true"');
    expect(html).not.toContain('id="toggleCaptions"');
    expect(script).toContain('stage.addEventListener("touchmove"');
    expect(script).not.toContain('stage.classList.toggle("controls-expanded", expanded)');
    expect(css).toContain("#zoomDock,.zoom-dock[hidden]{display:none!important");
    expect(css).toContain("min-width:61px!important;max-width:61px");
  });

  it("makes Vision feel responsive and keeps error recovery in place", () => {
    expect(html).not.toContain('id="intelligenceIntro"');
    expect(html).not.toContain('class="intelligence-intro"');
    expect(html).toContain('id="visionSlideHandle"');
    expect(html).toContain('class="vision-slide-copy"');
    expect(html).toContain("Slide to show your problem");
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
    expect(css).toContain(".camera-stage.is-listening .edge-glow:after");
  });

});


describe("Apple-style entry navigation and disconnect cue", () => {
  it("uses a shared menu on the sign-in, chooser, and standard-page surfaces", () => {
    expect(workerSource).toContain("const ENTRY_SITE_MENU = ");
    expect(workerSource).toContain("ENTRY_AUTH_OVERLAY = ");
    expect(workerSource).toContain("ENTRY_PRODUCTS_OVERLAY = ");
    for (const label of ["Donations", "Illustrative demo total", "Your Memory", "Key Memories", "About askMoina", "Developer", "Feedback", "Privacy &amp; Security", "Investor Relations", "Sign out"]) {
      expect(workerSource).toContain(label);
    }
    for (const route of ["/about", "/developer", "/help", "/privacy", "/pricing", "/donate"]) {
      expect(workerSource).toContain('"' + route + '"');
    }
    expect(workerSource).toContain('url.pathname === "/entry-menu.js"');
    expect(workerSource).toContain("renderSiteInfoPage(url.pathname)");
    expect(html).not.toContain("entry-site-menu");
    expect(css).toContain(".entry-site-menu{");
    expect(entryMenuScript).toContain('document.addEventListener("pointerdown"');
    expect(entryMenuScript).toContain('document.addEventListener("keydown"');
  });


  it("inserts a real newline, never literal backslash-n text, before the menu on both entry surfaces", () => {
    expect(workerSource).toContain("renderSiteMenu(Boolean(accountId || adminAccess)) + productsOverlay");
    expect(workerSource).toContain("renderSiteMenu(false) + authOverlay");
    expect(workerSource).not.toContain("ENTRY_AUTH_OVERLAY.replace(");
    expect(workerSource).not.toContain("ENTRY_PRODUCTS_OVERLAY.replace(");
  });

  it("keeps the disconnect tone distinct and lets it finish before returning to the chooser", () => {
    expect(script).toContain("function playDisconnectSound()");
    expect(script).toContain("disconnectToneUntil = performance.now() + 560");
    expect(script).toContain("peak: 0.052");
    expect(script).toContain("peak: 0.058");
    expect(script).toContain('window.setTimeout(() => window.location.replace("/"), 570)');
  });

  it("keeps non-camera pages narrow with an empty logo slot and hamburger aligned right", () => {
    expect(workerSource).toContain("entry-site-header");
    expect(workerSource).toContain("entry-logo-slot");
    expect(css).toContain(".entry-site-header{");
    expect(css).toContain("width:min(100%,430px)");
    expect(css).toContain(".entry-overlay .entry-products{grid-template-columns:minmax(0,1fr)!important}");
    expect(css).toContain("body.site-info-body .site-info-shell{width:min(100%,430px)");
  });


  it("keeps the Apple-style header at the page root with final bird logo and hamburger only", () => {
    expect(workerSource).toContain("askmoina-bird-final.png");
    expect(workerSource).toContain("function withSiteChrome(html: string, authenticated = false)");
    expect(workerSource).toContain("withSiteChromeResponse(continuityResponse, url.pathname, authenticatedForMenu)");
    expect(workerSource).toContain("renderSiteMenu(Boolean(accountId || adminAccess)) + productsOverlay");
    expect(workerSource).toContain("renderSiteMenu(false) + authOverlay");
    expect(siteChromeCss).toContain("background:rgba(245,245,247,.88)");
    expect(siteChromeCss).toContain("justify-content:space-between");
    expect(siteChromeCss).toContain("width:min(100%,var(--site-chrome-width,430px))");
    expect(siteChromeCss).toContain("right:0!important;left:auto!important");
    expect(siteChromeCss).toContain("site-chrome-page>main:not(.camera-app)");
    expect(logo.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });


  it("emits valid script src attributes for auth and menu handlers", () => {
    const authInjection = workerSource.split("\n").find((line) => line.includes("renderSiteMenu(false) + authOverlay")) || "";
    const productInjection = workerSource.split("\n").find((line) => line.includes("renderSiteMenu(Boolean(accountId || adminAccess)) + productsOverlay")) || "";
    expect(authInjection).toContain(String.raw`src=\"/auth.js\"`);
    expect(authInjection).toContain(String.raw`src=\"/entry-menu.js\"`);
    expect(productInjection).toContain(String.raw`src=\"/entry-menu.js\"`);
    expect(authInjection).not.toContain(String.raw`src=\\\\"/auth.js`);
  });


  it("does not flash a custom confirmation sheet before the native passkey prompt", () => {
    expect(authScript).not.toContain('showSheet("Confirm your identity"');
    expect(authScript).not.toContain('showSheet("Confirm on your device"');
    expect(authScript).toContain("navigator.credentials.get({ publicKey, signal: controller.signal })");
    expect(authScript).toContain("navigator.credentials.create({ publicKey, signal: controller.signal })");
  });

  it("keeps user-specific navigation out of signed-out menu markup and retires Profile", () => {
    expect(workerSource).not.toContain('>Profile <span aria-hidden="true">›</span></a>');
    expect(workerSource).toContain("function renderSiteMenu(authenticated: boolean)");
    expect(workerSource).toContain("authenticated ? ");
    expect(workerSource).toContain("<!-- ASKMOINA_MENU_CONTENT -->");
    expect(workerSource).toContain('"/donate"');
    expect(workerSource).toContain('"/pricing"');
    expect(workerSource).not.toContain("entry-header-donation");
    expect(workerSource).toContain("Key Memories");
    expect(workerSource).toContain("entry-menu-logout");
    expect(siteChromeCss).toContain("color:#ff3b30");
    expect(siteChromeCss).toContain("border-top:0");
    expect(workerSource).toContain("Sign out");
    expect(workerSource).toContain('url.pathname === "/account" || url.pathname === "/account.html"');
  });

  it("uses a no-network illustrative donation counter and balanced Apple-style pill links", () => {
    expect(workerSource).toContain("entry-support-links");
    expect(workerSource).toContain("entry-quick-link");
    expect(workerSource).not.toContain("entry-donation-card");
    expect(workerSource).toContain("Support");
    expect(workerSource).toContain("₹1.09L");
    expect(workerSource).toContain("data-donation-counter");
    expect(workerSource).toContain("Illustrative demo total");
    expect(workerSource).not.toContain("illustrative demo counter, not a verified total of money received");
    expect(entryMenuScript).toContain("const baseAmount = 109000");
    expect(entryMenuScript).toContain("const startAt = Date.UTC(2026, 9, 13, 4, 0, 0)");
    expect(entryMenuScript).toContain("window.setTimeout(updateDonationCounter");
    expect(entryMenuScript.slice(entryMenuScript.indexOf("// A globally consistent illustrative demo counter"))).not.toContain("fetch(");
    expect(entryMenuScript.slice(entryMenuScript.indexOf("// A globally consistent illustrative demo counter"))).not.toContain("localStorage");
    expect(siteChromeCss).toContain(".entry-overlay .entry-products .entry-support-links{");
    expect(siteChromeCss).toContain(".entry-overlay .entry-products .entry-quick-link-amount{");
    expect(workerSource).toContain("entry-quick-link-icon");
    expect(workerSource).toContain("Copyright &copy; 2026 askMoina. All rights reserved.");
    expect(siteChromeCss).toContain("margin-top:14px");
    expect(siteChromeCss).toContain(".entry-overlay .entry-products .entry-quick-link-icon{");
    expect(siteChromeCss).toContain(".entry-footer{position:fixed;");
    expect(css).toContain("box-shadow:0 2px 8px #1d1d1f08,0 8px 24px #1d1d1f0a");
    expect(siteChromeCss).toContain("box-shadow:none");
    expect(workerSource).not.toContain("entry-donation-status");
    expect(siteChromeCss).not.toContain("@keyframes live-donation-shimmer");
    expect(entryMenuScript).not.toContain('fetch("/api/auth/me"');
  });

  it("places the Donations and Support pill links below Hardware, not in the header", () => {
    expect(workerSource).not.toContain("entry-header-donation");
    expect(workerSource).not.toContain("entry-donation-status-dot");
    expect(workerSource).not.toContain("entry-site-header-actions");
    expect(siteChromeCss).not.toContain(".entry-site-header-actions{");
    expect(siteChromeCss).not.toContain("@keyframes live-donation-pulse");
    expect(siteChromeCss).not.toContain("@keyframes live-donation-shimmer");
    expect(workerSource.indexOf("Hardware")).toBeLessThan(workerSource.indexOf("entry-support-links"));
  });

  it("caches reusable static CSS briefly but leaves personalized HTML uncached", () => {
    expect(workerSource).toContain('"Cache-Control": "public, max-age=300, stale-while-revalidate=3600"');
    expect(workerSource).toContain('"Cache-Control": isScript ? "private, max-age=300" : "no-store"');
    expect(workerSource).toContain('headers.set("Cache-Control", "no-store")');
  });

  it("builds the requested auth-aware menu groups and blank static page placeholders", () => {
    expect(workerSource).toContain("entry-menu-memory");
    expect(workerSource).toContain("entry-menu-public");
    expect(workerSource).toContain("entry-menu-pricing");
    expect(workerSource).toContain("entry-menu-account");
    expect(workerSource).toContain("Your Memory");
    expect(workerSource).toContain("aria-hidden");
    expect(workerSource).toContain('"/pricing"');
    expect(workerSource).toContain("const SITE_INFO_PATHS = new Set([");
    expect(workerSource).toContain("if (!SITE_INFO_PATHS.has(pathname)) return null;");
    expect(workerSource).not.toContain("No purchase or payment is available on this page today.");
    expect(workerSource).not.toContain("Financial contributions");
  });
});

describe("Apple-style live-search progress", () => {
  it("shows an immediate acknowledgement and staged loader for live search", () => {
    expect(html).toContain('id="liveSearchStatus" hidden');
    expect(html).toContain('id="liveSearchTitle"');
    expect(html).toContain('id="liveSearchPercent"');
    expect(html).toContain('class="live-search-copy" role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain('role="progressbar"');
    expect(script).toContain('call.name === "search_current_web"');
    expect(script).toContain("function startLiveSearchProgress()");
    expect(script).toContain("Finding relevant sources");
    expect(script).toContain("Checking useful source details");
    expect(script).toContain("Collecting supporting evidence");
    expect(css).toContain("@keyframes live-search-sweep");
    expect(css).toContain(".live-search-status[hidden]{display:none!important}");
    expect(workerSource).toContain("The browser displays a contextual Apple-style loader");
    expect(script).toContain('message.live_search_status && message.live_search_status.state === "started"');
    expect(script).toContain("if (liveSearchActive && !liveSearchFinishing) return;");
    const workerStart = workerSource.indexOf('workerSocket.send(JSON.stringify({ live_search_status: { state: "started" } }))');
    const searchAwait = workerSource.indexOf("result = await performGroundedWebSearch(env, query, deviceContext, copilotMode)");
    expect(workerStart).toBeGreaterThanOrEqual(0);
    expect(searchAwait).toBeGreaterThan(workerStart);
    const lookupComplete = workerSource.indexOf('workerSocket.send(JSON.stringify({ live_search_status: { state: "lookup_complete" } }))');
    expect(lookupComplete).toBeGreaterThan(searchAwait);
    expect(script).toContain('message.live_search_status && message.live_search_status.state === "lookup_complete"');
    expect(script).toContain('if (liveSearchActive && !liveSearchFinishing) completeLiveSearchProgress();');
  });

  it("holds estimated progress below completion, reaches 100%, then removes the loader before revealing cards and final text", () => {
    expect(script).toContain("const searchStages = [");
    expect(script).toContain("liveSearchMessage.textContent = searchStages[liveSearchProgressStageIndex]");
    expect(script).toContain('liveSearchProgress.removeAttribute("aria-valuenow")');
    expect(script).not.toContain("Math.min(92, liveSearchProgressValue + increment)");
    expect(script).toContain('liveSearchStatus.classList.add("is-complete")');
    expect(css).toContain(".live-search-status.is-complete .live-search-track>span");
    expect(script).toContain("updateLiveSearchProgress(100)");
    expect(script).toContain("liveSearchStatus.hidden = true");
    expect(script).toContain("const rendered = renderResponseCard(call.args);");
    expect(script).toContain("if (liveSearchActive && !liveSearchFinishing) completeLiveSearchProgress();");
    expect(script).not.toContain("pendingResponseCards.push({ id, args: call.args })");
    expect(script).toContain("const queuedCards = pendingResponseCards.splice(0)");
    expect(script).toContain('transcriptNode.classList.add("is-searching")');
    expect(script).toContain('transcriptNode.classList.remove("is-searching")');
    expect(css).toContain(".transcript.is-searching .transcript-entry.from-moina{display:none!important}");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
  });
});


describe("Immediate live-search acknowledgement", () => {
  it("acknowledges likely search requests as soon as speech is transcribed, before waiting for the search tool event", () => {
    expect(script).toContain("function isLikelyLiveSearchRequest(text)");
    expect(script).toContain("interim_input_transcription");
    expect(script).toContain("interimInputTranscription");
    expect(script).toContain("top\\s+\\d+");
    expect(script).toContain("rank(?:ed|ing|ers?)");
    expect(script).toContain("orange cap|purple cap");
    expect(script).toContain("function showLiveSearchAcknowledgement(text = \"\", isSearchIntent = false)");
    expect(script).toContain("getLiveSearchPreflightProfile(text, isSearchIntent)");
    expect(script).toContain("handleTranscriptAcknowledgement(role, entry.text)");
    expect(script.indexOf("handleTranscriptAcknowledgement(role, entry.text)")).toBeLessThan(script.indexOf("async function handleServerMessage"));
    expect(script).toContain('liveSearchTitle.textContent = liveSearchPreflightStages[0].title');
    expect(script).toContain('title: "Preparing your answer"');
    expect(script).toContain('message: "Bujhi paisu — working out the useful bits for this question."');
    expect(script).toContain('liveSearchTitle.textContent = stageItem.title');
    expect(script).toContain('liveSearchTitle.textContent = "Building your answer"');
    expect(script).toContain("liveSearchStatus.classList.add(\"is-acknowledging\")");
    expect(script).toContain("liveSearchStatus.classList.remove(\"is-acknowledging\")");
    expect(css).toContain(".live-search-status.is-acknowledging .live-search-percent{display:none!important}");
    expect(css).toContain("@keyframes live-search-sweep");
  });

  it("transitions to real progress when the Worker confirms lookup start and clears unused acknowledgements", () => {
    expect(script).toContain("function hideLiveSearchAcknowledgement()");
    expect(script).not.toContain("liveSearchAcknowledgementTimer = window.setTimeout(hideLiveSearchAcknowledgement, 12_000)");
    expect(script).not.toContain("if (reply.length >= 18) hideLiveSearchAcknowledgement()");
    expect(script).toContain("if (hasSearchCallOnThisMessage) startLiveSearchProgress()");
    expect(script).toContain("else if (liveSearchAcknowledgementActive && !hasSearchCallOnThisMessage)");
  });
});


describe("Answer sheet minimize and restore control", () => {
  it("keeps the restore control outside the camera stage so minimizing does not hide it", () => {
    expect(script).toContain('if (responseCardRestoreButton && responseCardRestoreButton.parentElement !== document.body) document.body.appendChild(responseCardRestoreButton);');
    expect(html).toContain('src="/copilot.js?v=0.4.23"');
  });
});


describe("Grounded search resilience", () => {
  it("keeps the supported fast grounding model and retries slow/transient provider failures", () => {
    expect(workerSource).toContain('const model = "gemini-3.8-flash";');
    expect(workerSource).toContain("const GROUNDED_SEARCH_TIMEOUT_MS = 18_000;");
    expect(workerSource).toContain("const GROUNDED_SEARCH_MAX_ATTEMPTS = 2;");
    expect(workerSource).toContain("GROUNDED_SEARCH_RETRYABLE_HTTP_STATUSES.has(response.status)");
    expect(workerSource).toContain('temperature: 0.0');
    expect(workerSource).toContain('reason: timedOut ? "timeout" : "network"');
  });
});


describe("Proactive ranked-list UX", () => {
  it("instructs Co-Pilot to ground and proactively display complete top-N list cards", () => {
    expect(workerSource).toContain("M41 — ALWAYS-AVAILABLE ANSWER SHEET, CONTINUOUS VOICE");
    expect(workerSource).toContain("continue the voice response and explain every recommended step");
    expect(workerSource).toContain("PROACTIVE VALUE — RANKED LISTS AND DETAILED ANSWERS");
    expect(workerSource).toContain("Include every supported requested rank");
    expect(workerSource).toContain("For 'IPL 2025 top rankers' without a metric");
    expect(workerSource).toContain("M39 — DETAIL WITHOUT EXTRA FRICTION");
  });
});

describe("RC6 grounded list visibility regressions", () => {
  it("prioritizes server-grounded list cards over shorter model cards", () => {
    expect(script).toContain("const groundedFallback = [...queuedCards].reverse().find");
    expect(script).toContain("Grounded results found · designing your list");
    expect(script).toContain("protectGroundedListForTurn && lastGroundedRankedListCard");
  });

  it("recognizes a full-list follow-up and immediately reopens cached grounded data", () => {
    expect(script).toContain("function isListDisplayFollowup(text)");
    expect(script).toContain("renderResponseCard(lastGroundedRankedListCard, true)");
    expect(script).toContain('handleTranscriptAcknowledgement("user", interimUserTranscription.text)');
    expect(script).toContain("if (!normalized || liveSearchSpokenAcknowledgementText) return");
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
    expect(workerSource).toContain("const searchBudgetMs = rankedListSearchBudget ? 75_000 : GROUNDED_SEARCH_BUDGET_MS;");
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
  it("shows early status only after sustained microphone speech, not raw energy or brief noise", () => {
    expect(script).toContain('if (!micSpeechGateActive) {');
    expect(script).toContain('showLiveSearchAcknowledgement("", false);');
    expect(script).toContain("micNoiseCalibrationUntil = now + 500");
    expect(script).toContain("zeroCrossingRate >= 0.008 && zeroCrossingRate <= 0.38");
    expect(script).toContain("now - micSpeechCandidateAt >= 120");
    expect(script).toContain("Keep the interface clean while the user talks; show processing immediately after speech ends.");
    expect(script).toContain('if (interimUserTranscription && typeof interimUserTranscription.text === "string") {');
    expect(script).toContain('handleTranscriptAcknowledgement("user", interimUserTranscription.text)');
  });

  it("adapts preflight stages by context and keeps explicit-search acknowledgements visible until the lookup or turn completes", () => {
    expect(script).toContain('key: "ranked-list"');
    expect(script).toContain('key: "current-info"');
    expect(script).toContain('key: "reference-check"');
    expect(script).toContain('key: "general"');
    expect(script).toContain('if (role === "assistant" && liveSearchAcknowledgementActive && !liveSearchActive && !liveSearchFinishing)');
    expect(script).toContain("hideLiveSearchAcknowledgement()");
  });

  it("removes a preflight status before revealing a card when a web search was not started", () => {
    expect(script).toContain("if (liveSearchAcknowledgementActive) hideLiveSearchAcknowledgement();");
    expect(script).toContain("hideLiveSearchAcknowledgement();\n          renderResponseCard(fallbackCard, true);");
  });
});


describe("Persistent live-search progress", () => {
  it("keeps the status visible through slow preflight, provider delays, and offline states", () => {
    expect(script).toContain("liveSearchAcknowledgementStartedAt = Date.now()");
    expect(script).toContain("liveSearchPreflightIntent");
    expect(script).toContain("if (liveSearchPreflightIntent || (LIVE_SEARCH_ACKNOWLEDGEMENT.test(normalized) && normalized.length < 90)) return;");
    expect(script).toContain("Putting the details together.");
    expect(script).toContain("Olop besi time lagise");
    expect(script).toContain("liveSearchStartedAt = Date.now()");
    expect(script).toContain("navigator.onLine === false");
    expect(script).toContain("Olop besi time lagise");
    expect(script).toContain("liveSearchWatchdogTimer = window.setTimeout(refreshSlowSearchStatus, 6_000)");
    expect(script).not.toContain("}, 38_000);");
  });
});


describe("Voice-turn status visibility", () => {
  it("hides the loader during user speech and restores it for quiet processing", () => {
    expect(script).toContain("No status surface while the user speaks.");
    expect(script).toContain("if (userSpeaking) {");
    expect(script).toContain("liveSearchStatus.hidden = true;");
    expect(script).toContain("if (__moinaLastUserSpeech) {");
    expect(script).toContain('showLiveSearchAcknowledgement("", false);');
    expect(script).toContain('title: "Thinking through your request"');
    expect(script).toContain("Answer card-tu ready kori asu.");
    expect(script).toContain("No status surface while the user speaks.");
    expect(script).toContain("const userSpeaking = Boolean(micSpeechGateActive && !assistantSpeaking)");
    expect(script).toContain("Olop besi time lagise");
    expect(script).toContain("navigator.onLine === false");
  });
});


describe("long-running Live session continuity", () => {
  const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const protocol = readFileSync(new URL("../src/sessions/copilot-protocol.ts", import.meta.url), "utf8");
  const providerFrames = readFileSync(new URL("../src/sessions/provider-frame.ts", import.meta.url), "utf8");

  it("enables context compression and session resumption", () => {
    expect(worker).toContain("contextWindowCompression: {");
    expect(worker).toContain("triggerTokens: 96_000");
    expect(worker).toContain("targetTokens: 64_000");
    expect(worker).toContain("sessionResumption: { transparent: true }");
    expect(worker).toContain("async function resumeLiveUpstream");
    expect(worker).toContain("lastSessionResumptionHandle");
    expect(worker).toContain("function replayUnconsumedMessages");
    expect(worker).toContain('state: "resuming"');
    expect(worker).toContain('state: "resumed"');
  });

  it("keeps resumption handles relay-side and understands provider checkpoints", () => {
    expect(providerFrames).toContain("sessionResumptionUpdate");
    expect(providerFrames).toContain("goAway");
    expect(worker).toContain("const isSessionResumptionUpdate = Boolean(providerMessage?.sessionResumptionUpdate)");
    expect(worker).toContain("(resumedSessionSetupComplete || isSessionResumptionUpdate || (resumptionInProgress && providerMessage?.error)) ? \"\" : frameText");
    expect(worker).not.toContain("clientMessageIndex: index");
  });

  it("indexes actually-sent messages separately from the wire payload and buffers reconnect input", () => {
    expect(worker).toContain("let nextClientMessageIndex = 1");
    expect(worker).toContain("const index = nextClientMessageIndex++");
    expect(worker).toContain("replayUnconsumedMessages(true)");
    expect(worker).toContain("lastConsumedClientMessageIndex = 0;");
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

  it("discloses temporary provider-side session caching", () => {
    expect(html).toContain("temporarily cache session content for up to 24 hours");
    expect(html).not.toContain('class="privacy-hint sr-only"');
  });
});


describe("Apple-style active turn contract", () => {
  it("keeps processing state contextual, continues Live progress, and requires answer cards", () => {
    expect(script).toContain("No status surface while the user speaks.");
    expect(script).toContain("const userSpeaking = Boolean(micSpeechGateActive && !assistantSpeaking)");
    expect(script).toContain("Answer card-tu ready kori asu.");
    expect(script).toContain("Names aru rankings match kori asu against sources.");
    expect(workerSource).toContain('behavior: "NON_BLOCKING"');
    expect(workerSource).toContain("function sendLiveSearchProgressCue(cueNumber: number)");
    expect(workerSource).toContain("liveSearchProgressCueCount < 4");
    expect(workerSource).toContain("A card is mandatory for every informative answer");
    expect(workerSource).toContain("M42 — CONTINUOUS VOICE DURING BACKGROUND WORK");
  });
});
