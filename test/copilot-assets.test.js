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
    for (const label of ["Live donations", "Your Memory", "Key memories", "About us", "Developer", "Help &amp; Feedback", "Privacy &amp; Security", "Pricing", "Sign out", "DEMO COUNTER"]) {
      expect(workerSource).toContain(label);
    }
    for (const route of ["/about", "/developer", "/help", "/privacy"]) {
      expect(workerSource).toContain('"' + route + '":');
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
    expect(workerSource).toContain('"/donate":');
    expect(workerSource).toContain('"/pricing":');
    expect(workerSource).not.toContain("entry-header-donation");
    expect(workerSource).toContain("Key memories");
    expect(workerSource).toContain("entry-menu-logout");
    expect(siteChromeCss).toContain("color:#ff3b30");
    expect(siteChromeCss).toContain("border-top:0");
    expect(workerSource).toContain("Sign out");
    expect(workerSource).toContain('url.pathname === "/account" || url.pathname === "/account.html"');
  });

  it("uses a no-network illustrative donation counter and a compact Apple-style card", () => {
    expect(workerSource).toContain("entry-donation-card");
    expect(workerSource).toContain("data-donation-counter");
    expect(workerSource).toContain("Illustrative only — not a verified donation total.");
    expect(workerSource).toContain("illustrative demo counter, not a verified total of money received");
    expect(entryMenuScript).toContain("const baseAmount = 109000");
    expect(entryMenuScript).toContain("const startAt = Date.UTC(2026, 9, 13, 4, 0, 0)");
    expect(entryMenuScript).toContain("window.setTimeout(updateDonationCounter");
    expect(entryMenuScript.slice(entryMenuScript.indexOf("// A globally consistent illustrative demo counter"))).not.toContain("fetch(");
    expect(entryMenuScript.slice(entryMenuScript.indexOf("// A globally consistent illustrative demo counter"))).not.toContain("localStorage");
    expect(siteChromeCss).toContain(".entry-donation-status{");
    expect(siteChromeCss).toContain("background:#1d1d1f");
    expect(siteChromeCss).not.toContain("@keyframes live-donation-shimmer");
    expect(entryMenuScript).not.toContain('fetch("/api/auth/me"');
  });

  it("places the Live donations card below Hardware, not in the header", () => {
    expect(workerSource).not.toContain("entry-header-donation");
    expect(workerSource).toContain("entry-donation-status-dot");
    expect(workerSource).not.toContain("entry-site-header-actions");
    expect(siteChromeCss).not.toContain(".entry-site-header-actions{");
    expect(siteChromeCss).not.toContain("@keyframes live-donation-pulse");
    expect(siteChromeCss).not.toContain("@keyframes live-donation-shimmer");
    expect(workerSource.indexOf("Hardware")).toBeLessThan(workerSource.indexOf("entry-donation-card"));
  });

  it("caches reusable static CSS briefly but leaves personalized HTML uncached", () => {
    expect(workerSource).toContain('"Cache-Control": "public, max-age=300, stale-while-revalidate=3600"');
    expect(workerSource).toContain('"Cache-Control": isScript ? "private, max-age=300" : "no-store"');
    expect(workerSource).toContain('headers.set("Cache-Control", "no-store")');
  });

  it("builds the requested auth-aware menu groups and a public Pricing page", () => {
    expect(workerSource).toContain("entry-menu-memory");
    expect(workerSource).toContain("entry-menu-public");
    expect(workerSource).toContain("entry-menu-pricing");
    expect(workerSource).toContain("entry-menu-account");
    expect(workerSource).toContain("Your Memory");
    expect(workerSource).toContain("aria-hidden");
    expect(workerSource).toContain('"/pricing":');
    expect(workerSource).toContain("No purchase or payment is available on this page today.");
  });
});