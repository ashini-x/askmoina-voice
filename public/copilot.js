(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const backButton = $("#backButton");
  if (backButton) backButton.addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.assign("/");
  });
  const video = $("#videoPreview");
  const stage = $("#cameraStage");
  const connectionNotice = $("#connectionNotice");
  const connectionNoticeTitle = $("#connectionNoticeTitle");
  const connectionNoticeMessage = $("#connectionNoticeMessage");
  const connectionNoticeProgress = $("#connectionNoticeProgress");
  const connectionNoticeAction = $("#connectionNoticeAction");
  let automaticReconnectAttempts = 0;
  let persistentConnectionIssue = null;
  let reconnectTimer = null;
  let isAutomaticRetry = false;
  // Reuse the same session owner only while retrying this call; never across manual starts.
  let liveSessionId = null;
  let lastMicVoiceAt = 0;
  let micNoiseFloor = 0.003;
  let micNoiseCalibrationUntil = 0;
  let micSpeechCandidateAt = 0;
  let micSpeechGateActive = false;
  let disconnectToneUntil = 0;
  let visualGuideSvg = null;
  let latestVisualGuideElements = [];
  const placeholder = $("#cameraPlaceholder");
  const toggleButton = $("#toggleCopilot");
  const showProblemButton = $("#showProblemButton");
  const buttonLabel = $("#buttonLabel");
  const flipButton = $("#flipCamera");
  const clearMarkerButton = $("#clearMarker");
  const cameraState = $("#cameraState");
  const frameBadge = $("#frameBadge");
  const statusNode = $("#status");
  const availabilityNode = $("#availability");
  const connectionPill = $("#connectionPill");
  const transcriptNode = $("#transcript");
  const responseCardTray = $("#responseCardTray");
  const responseCardType = $("#responseCardType");
  const responseCardTitle = $("#responseCardTitle");
  const responseCardSummary = $("#responseCardSummary");
  const responseCardDetails = $("#responseCardDetails");
  const responseCardContent = $("#responseCardContent");
  const responseCardStatus = $("#responseCardStatus");
  const responseCardCollapseButton = $("#responseCardCollapse");
  const responseCardDismissButton = $("#responseCardDismiss");
  const responseCardMinimizeButton = $("#responseCardMinimize");
  const responseCardRestoreButton = $("#responseCardRestore");
  // Keep the answer sheet viewport-sized rather than bounded by the camera-stage layout.
  if (responseCardTray && responseCardTray.parentElement !== document.body) document.body.appendChild(responseCardTray);
  if (responseCardRestoreButton && responseCardRestoreButton.parentElement !== document.body) document.body.appendChild(responseCardRestoreButton);
  const liveSearchStatus = $("#liveSearchStatus");
  const liveSearchTitle = $("#liveSearchTitle");
  const liveSearchMessage = $("#liveSearchMessage");
  const liveSearchPercent = $("#liveSearchPercent");
  const liveSearchProgress = $("#liveSearchProgress");
  const liveSearchProgressBar = $("#liveSearchProgressBar");
  const emptyTranscript = $("#emptyTranscript");
  const focusMarker = $("#focusMarker");
  const focusLabel = $("#focusLabel");
  const focusHint = $("#focusHint");
  const focusInstruction = $("#focusInstruction");
  const approxTag = $("#approxTag");
  const clearTranscriptButton = $("#clearTranscript");
  const MEMORY_CONTEXT_KEY = "askmoina.memory.context";
  const MEMORY_CONSENT_KEY = "askmoina.memory.consent.v1";

  let responseCardExpanded = true;
  let responseCardRenderedForTurn = false;
  let responseCardWasTranscriptFallback = false;
  let transcriptFallbackSourceLength = 0;
  let responseCardManuallyMinimizedForTurn = false;
  if (responseCardCollapseButton) responseCardCollapseButton.addEventListener("click", () => setResponseCardExpanded(!responseCardExpanded));
  if (responseCardDismissButton) responseCardDismissButton.addEventListener("click", dismissResponseCard);
  if (responseCardMinimizeButton) responseCardMinimizeButton.addEventListener("click", minimizeResponseCard);
  if (responseCardRestoreButton) responseCardRestoreButton.addEventListener("click", restoreResponseCard);

  let liveSearchActive = false;
  let liveSearchFinishing = false;
  let liveSearchLookupCompleted = false;
  let liveSearchProgressValue = 0;
  let liveSearchProgressInterval = null;
  let liveSearchCompletionTimer = null;
  let liveSearchWatchdogTimer = null;
  let pendingResponseCards = [];
  let lastGroundedRankedListCard = null;
  let protectGroundedListForTurn = false;
  let liveSearchProgressStageIndex = 0;
  let liveSearchStartedAt = 0;
  let relayKeepaliveTimer = null;

  function updateLiveSearchProgress(value) {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    liveSearchProgressValue = next;
    if (liveSearchPercent) liveSearchPercent.textContent = String(next) + "%";
    if (liveSearchProgress) {
      if (next >= 100) liveSearchProgress.setAttribute("aria-valuenow", "100");
      else liveSearchProgress.removeAttribute("aria-valuenow");
    }
    if (liveSearchProgressBar) liveSearchProgressBar.style.width = String(next) + "%";
  }

  const QUIET_THINKING_STAGES = [
    { title: "Thinking", message: "Putting the answer together" },
    { title: "Working through the details", message: "Organizing the clearest useful answer" },
    { title: "Preparing your answer", message: "Checking what matters and what can be left out" },
    { title: "Finishing the details", message: "Getting the answer sheet ready" },
  ];

  function syncLiveSearchStatusVisibility() {
    if (!liveSearchStatus) return;
    const workActive = liveSearchActive || liveSearchFinishing;
    liveSearchStatus.hidden = !workActive || Boolean(micSpeechGateActive);
  }

  function startRelayKeepalive(sessionSocket) {
    if (relayKeepaliveTimer) window.clearInterval(relayKeepaliveTimer);
    relayKeepaliveTimer = window.setInterval(() => {
      if (socket !== sessionSocket || sessionSocket.readyState !== WebSocket.OPEN || stopping) {
        if (relayKeepaliveTimer) window.clearInterval(relayKeepaliveTimer);
        relayKeepaliveTimer = null;
        return;
      }
      if (sessionSocket.bufferedAmount > 48 * 1024) return;
      try { sessionSocket.send(JSON.stringify({ keepalive: true })); } catch (_) {}
    }, 10_000);
  }

  function stopRelayKeepalive(sessionSocket = null) {
    if (sessionSocket && socket && socket !== sessionSocket) return;
    if (relayKeepaliveTimer) window.clearInterval(relayKeepaliveTimer);
    relayKeepaliveTimer = null;
  }

  function startLiveSearchProgress() {
    if (!liveSearchStatus) return;
    if (liveSearchActive && !liveSearchFinishing) return;
    liveSearchStatus.classList.remove("is-acknowledging", "is-complete");
    if (liveSearchCompletionTimer) window.clearTimeout(liveSearchCompletionTimer);
    if (liveSearchProgressInterval) window.clearInterval(liveSearchProgressInterval);
    liveSearchCompletionTimer = null;
    liveSearchProgressInterval = null;
    liveSearchActive = true;
    liveSearchFinishing = false;
    liveSearchLookupCompleted = false;
    liveSearchStartedAt = Date.now();
    liveSearchProgressStageIndex = 0;
    if (liveSearchWatchdogTimer) window.clearTimeout(liveSearchWatchdogTimer);
    const refreshSlowSearchStatus = () => {
      liveSearchWatchdogTimer = null;
      if (!liveSearchActive || liveSearchFinishing) return;
      const elapsed = Date.now() - liveSearchStartedAt;
      if (navigator.onLine === false) {
        if (liveSearchTitle) liveSearchTitle.textContent = "Connection appears offline";
        if (liveSearchMessage) liveSearchMessage.textContent = "Check your internet connection. The search status will stay visible while we wait.";
      } else if (micSpeechGateActive) {
        if (liveSearchTitle) liveSearchTitle.textContent = "Listening to your question";
        if (liveSearchMessage) liveSearchMessage.textContent = "Take your time. I'll show live-source checks if needed.";
      } else if (elapsed >= 45_000) {
        if (liveSearchTitle) liveSearchTitle.textContent = "Still waiting for live results";
        if (liveSearchMessage) liveSearchMessage.textContent = "This is taking longer than usual. Your connection or the search service may be slow; you do not need to repeat your question.";
      } else if (elapsed >= 25_000) {
        if (liveSearchTitle) liveSearchTitle.textContent = "Still waiting for source results";
        if (liveSearchMessage) liveSearchMessage.textContent = "I have not received the verified search results yet. This may be a network or service delay.";
      } else if (elapsed >= 12_000) {
        if (liveSearchTitle) liveSearchTitle.textContent = "Taking longer than expected";
        if (liveSearchMessage) liveSearchMessage.textContent = "I am still waiting for live-search results. Your connection or the search service may be slow.";
      }
      liveSearchWatchdogTimer = window.setTimeout(refreshSlowSearchStatus, 6_000);
    };
    liveSearchWatchdogTimer = window.setTimeout(refreshSlowSearchStatus, 6_000);
    syncLiveSearchStatusVisibility();
    if (liveSearchTitle) liveSearchTitle.textContent = "Searching the web";
    if (liveSearchMessage) liveSearchMessage.textContent = "Finding relevant sources";
    if (transcriptNode) transcriptNode.classList.add("is-searching");
    if (responseCardTray && !responseCardTray.hidden) dismissResponseCard();
    updateLiveSearchProgress(0);

    const searchStages = [
      "Finding relevant sources",
      "Checking useful source details",
      "Collecting supporting evidence"
    ];
    let stageTick = 0;
    // The progress rail is deliberately indeterminate: it does not pretend to measure provider completion.
    liveSearchProgressInterval = window.setInterval(() => {
      if (!liveSearchActive || liveSearchFinishing || liveSearchLookupCompleted) return;
      // Long-wait and offline copy is owned by the watchdog and must not be overwritten by the short-stage cycle.
      if (navigator.onLine === false || Date.now() - liveSearchStartedAt >= 12_000) return;
      stageTick += 1;
      if (stageTick % 5 === 0 && liveSearchMessage) {
        liveSearchProgressStageIndex = (liveSearchProgressStageIndex + 1) % searchStages.length;
        liveSearchMessage.textContent = searchStages[liveSearchProgressStageIndex];
      }
    }, 420);
  }

  function sendDeferredResponseCardResult(id, rendered) {
    if (!id || !socket || socket.readyState !== WebSocket.OPEN) return;
    const result = rendered
      ? "The complete designed response card is now visible as a full-screen answer sheet. Continue speaking the complete natural response aloud: explain the answer, every useful step, what to look for, and relevant safety limits. A card never replaces the spoken explanation or proves that an action was completed."
      : "The response-card payload could not be rendered by the client. Continue speaking the full natural response and do not claim a card is visible.";
    try {
      socket.send(JSON.stringify({
        tool_response: {
          function_responses: [{
            id,
            name: "display_response_card",
            response: { result }
          }]
        }
      }));
    } catch (_) {}
  }

  function completeLiveSearchProgress() {
    if (!liveSearchActive || liveSearchFinishing) return;
    liveSearchFinishing = true;
    if (liveSearchWatchdogTimer) window.clearTimeout(liveSearchWatchdogTimer);
    liveSearchWatchdogTimer = null;
    if (liveSearchProgressInterval) window.clearInterval(liveSearchProgressInterval);
    liveSearchProgressInterval = null;
    if (liveSearchTitle) liveSearchTitle.textContent = "Preparing your answer";
    if (liveSearchMessage) liveSearchMessage.textContent = "Getting the answer card ready";
    if (liveSearchStatus) liveSearchStatus.classList.remove("is-complete");

    // A timer must never dismiss the loader on its own. Give a just-arriving card
    // a brief chance to land; renderResponseCard() ends loading once the sheet is visible.
    liveSearchCompletionTimer = window.setTimeout(() => {
      liveSearchCompletionTimer = null;
      const queuedCards = pendingResponseCards.splice(0);
      const groundedFallback = [...queuedCards].reverse().find((queued) => !queued.id && isGroundedRankedListCard(queued.args));
      const selectedCard = groundedFallback ||
        [...queuedCards].reverse().find((queued) => Boolean(queued.id)) ||
        queuedCards[queuedCards.length - 1];
      if (selectedCard) {
        const rendered = renderResponseCard(selectedCard.args, !selectedCard.id || isGroundedRankedListCard(selectedCard.args));
        for (const queued of queuedCards) {
          if (queued.id) sendDeferredResponseCardResult(queued.id, rendered);
        }
      }
      if (responseCardTray && !responseCardTray.hidden) {
        finishLiveSearchAfterCardShown();
        return;
      }

      // No answer sheet is visible yet. Keep the loader active until the normal
      // response-card or transcript-fallback path actually renders one.
      liveSearchFinishing = false;
      if (liveSearchStatus) liveSearchStatus.classList.remove("is-complete");
      if (liveSearchTitle) liveSearchTitle.textContent = "Preparing your answer";
      if (liveSearchMessage) liveSearchMessage.textContent = "Waiting for the answer card";
      syncLiveSearchStatusVisibility();
    }, 420);
  }

  function cancelLiveSearchProgress() {
    if (liveSearchWatchdogTimer) window.clearTimeout(liveSearchWatchdogTimer);
    liveSearchWatchdogTimer = null;
    if (liveSearchProgressInterval) window.clearInterval(liveSearchProgressInterval);
    if (liveSearchCompletionTimer) window.clearTimeout(liveSearchCompletionTimer);
    liveSearchProgressInterval = null;
    liveSearchCompletionTimer = null;
    liveSearchActive = false;
    liveSearchFinishing = false;
    liveSearchLookupCompleted = false;
    pendingResponseCards = [];
    if (liveSearchStatus) {
      liveSearchStatus.hidden = true;
      liveSearchStatus.classList.remove("is-complete");
    }
    if (transcriptNode) transcriptNode.classList.remove("is-searching");
  }

  const LIVE_SEARCH_PROGRESS_SPEECH = /^(?:(?:okay|ok|alright|all right|sure|got it|one moment|just a moment)[,.\s-]*)?(?:(?:i(?:['’]m| am) .{0,40}\b(?:searching|looking up|researching|checking|verifying|gathering|finding|pulling together)\b)|(?:i(?:['’]ll| will) .{0,30}\b(?:search|look up|research|check|verify|gather|find|compare)\b)|(?:let me .{0,25}\b(?:search|look up|research|check|verify|gather|find|compare)\b)|\b(?:searching|looking up|checking|verifying|researching|gathering|finding|comparing)\s+(?:the|for|current|latest|official|relevant|recent|source|web|information|details|rankings|results)\b)/i;

  function requestedListCountFromTranscript(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
    const countPattern = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)";
    const words = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
    const patterns = [
      new RegExp("\\btop[\\s-]*" + countPattern + "\\b", "i"),
      new RegExp("\\b(?:all|every|first)\\s+(?:the\\s+)?" + countPattern + "\\b", "i"),
      new RegExp("\\b(?:full|complete|entire|whole)\\s+(?:ranked\\s+)?list(?:\\s+of)?\\s+(?:all\\s+)?" + countPattern + "\\b", "i")
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (!match) continue;
      for (let index = 1; index < match.length; index += 1) {
        const token = String(match[index] || "").trim().toLowerCase();
        const count = /^\d+$/.test(token) ? Number(token) : words[token];
        if (Number.isInteger(count) && count >= 2 && count <= 10) return count;
      }
    }
    return null;
  }

  function isListDisplayFollowup(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    const count = requestedListCountFromTranscript(value);
    return Boolean(count && /\b(?:show|display|give|list|print|put)\b/i.test(value) &&
      /\b(?:all|every|full|complete|entire|whole|remaining|rest)\b/i.test(value)) ||
      /\b(?:show|display|give|list)\s+me\s+(?:the\s+)?(?:full|whole|complete|entire)\s+list\b/i.test(value) ||
      /\b(?:show|display|give|list)\s+me\s+all\s+the\s+entries\b/i.test(value);
  }

  function isGroundedRankedListCard(value) {
    const card = normalizeResponseCardPayload(value);
    return Boolean(card && card.type === "key_details" &&
      /^top\s+\d+\s+results$/i.test(card.title) &&
      Array.isArray(card.details) && card.details.length >= 2 &&
      Array.isArray(card.sources) && card.sources.length > 0);
  }

  function handleTranscriptAcknowledgement(role, text) {
    if (role === "user") {
      const normalized = String(text || "").replace(/\s+/g, " ").trim();
      if (!normalized) return;
      const expansion = isListDisplayFollowup(normalized);
      const count = requestedListCountFromTranscript(normalized);
      if (expansion && lastGroundedRankedListCard) {
        protectGroundedListForTurn = true;
        renderResponseCard(lastGroundedRankedListCard, true);
        const complete = /^complete ranked list/i.test(String(lastGroundedRankedListCard.summary || "")) &&
          Array.isArray(lastGroundedRankedListCard.details) &&
          lastGroundedRankedListCard.details.length >= (count || lastGroundedRankedListCard.details.length) &&
          lastGroundedRankedListCard.details.every((item) => !String(item.label || "").endsWith("Not verified"));
        if (complete) return;
      } else {
        protectGroundedListForTurn = false;
        lastGroundedRankedListCard = null;
      }
      // A user transcript alone is not progress; keep the loader hidden until a backend
      // search begins or Moina's own generated speech acknowledges an actual lookup.
      return;
    }

    if (role !== "assistant") return;
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return;

    // Inspect Moina's generated voice transcript; no spoken wording is hardcoded or injected.
    // If voice progress arrives first, it starts the same loader as the backend search event.
    if (!responseCardRenderedForTurn && !liveSearchActive && !liveSearchFinishing &&
        LIVE_SEARCH_PROGRESS_SPEECH.test(normalized)) {
      startLiveSearchProgress();
    }

    if (liveSearchActive && liveSearchLookupCompleted && normalized.length >= 18) {
      completeLiveSearchProgress();
    }
  }

  function readOptedInMemoryContext() {
    try {
      const consent = localStorage.getItem(MEMORY_CONSENT_KEY);
      if (consent === "disabled") return "";
      const value = String(localStorage.getItem(MEMORY_CONTEXT_KEY) || sessionStorage.getItem(MEMORY_CONTEXT_KEY) || "").trim().slice(0, 3000);
      if (value && consent !== "enabled") {
        try { localStorage.setItem(MEMORY_CONSENT_KEY, "enabled"); } catch (_) {}
      }
      return value;
    } catch (_) { return ""; }
  }

  window.addEventListener("storage", (event) => {
    if ((event.key === MEMORY_CONSENT_KEY && event.newValue !== "enabled") ||
        (event.key === MEMORY_CONTEXT_KEY && event.newValue === null)) {
      try { sessionStorage.removeItem(MEMORY_CONTEXT_KEY); } catch (_) {}
    }
  });
  const muteButton = $("#muteMic");
  const zoomSlider = $("#zoomSlider");
  const zoomLabel = $("#zoomLabel");
  const zoomInButton = $("#zoomIn");
  const zoomOutButton = $("#zoomOut");
  const trackingCanvas = document.createElement("canvas");
  const trackingContext = trackingCanvas.getContext("2d", { willReadFrequently: true });
  const frameSampleCanvas = document.createElement("canvas");
  frameSampleCanvas.width = 24;
  frameSampleCanvas.height = 18;
  const frameSampleContext = frameSampleCanvas.getContext("2d", { willReadFrequently: true });
  let trackingPixels = null;
  let trackingTimer = null;
  let localTrackingActive = false;
  let trackedPoint = null;
  let trackingTemplate = null;
  let trackingLostFrames = 0;
  let trackingLostAt = 0;
  let trackingLastReacquireAt = 0;
  let trackingReacquiring = false;
  let trackingReacquireCandidate = null;
  let trackingReacquireCandidateFrames = 0;
  let trackedTargetKey = "";
  let pendingTrackingTargetKey = "";
  let trackingLastTick = 0;
  let trackingCanvasWidth = 0;
  let trackingCanvasHeight = 0;
  let trackingCrop = null;
  let localFrameSequence = 0;
  let lastSentCameraFrameSequence = 0;
  let lastSentCameraViewGeneration = -1;
  let cameraViewGeneration = 0;
  let spatialTrackSequence = 0;
  let persistentSpatialTrack = null;
  let sceneModel = { viewGeneration: 0, updatedAt: 0, frameSequence: 0, observations: [], relations: [], staleInputRejected: false };
  let taskWorldModel = createTaskWorldModel();
  let realityLoopState = createRealityLoopState();
  let safetyPauseNode = null;
  let microphoneMuted = false;
  let zoomLevel = 1;
  let zoomMin = 1;
  let zoomMax = 3;
  let nativeZoomSupported = false;
  let pinchStartDistance = 0;
  let pinchStartZoom = 1;
  let lastZoomApplyAt = 0;

  let socket = null;
  let microphoneStream = null;
  let previewStream = null;
  let previewPromise = null;
  let greetingTurnPending = false;
  let greetingTimer = null;
  let audioContext = null;
  let microphoneSource = null;
  let processor = null;
  let silentGain = null;
  let starting = false;
  let active = false;
  let stopping = false;
  let setupReady = false;
  let recoveryPreviewClear = false;
  let setupTimer = null;
  let videoTimer = null;
  let firstVideoTimer = null;
  let nextPlaybackTime = 0;
  const playbackNodes = new Set();
  let playbackAnalyser = null;
  let playbackAnalyserData = null;
  let playbackPulseFrame = 0;
  let microphoneVoiceEnergy = 0;
  let assistantVoiceEnergy = 0;
  let currentTranscriptNodes = { user: null, assistant: null };
  let transcriptStarted = false;
  let voiceAvailability = null;
  let availabilitySequence = 0;
  let facingMode = "environment";
  let lastVideoSentAt = 0;
  let previousFrameSample = null;
  let lastFrameEfficiencyReportAt = 0;
  const frameEfficiencyStats = { sent: 0, suppressed: 0, encodedChars: 0, lastMotionScore: 1 };
  let sendingVideo = false;
  let cameraSuspendedForSpatialAr = false;
  let cameraResumeInProgress = false;
  let lastSessionEndedAt = 0;
  let latestVisualGuidance = null;
  let awaitingTargetSelection = false;


  // M31: local safety gate for consequential or hard-to-reverse physical actions.
  // A model estimate can raise risk, but cannot lower deterministic hazard matches.
  function assessSafetyAndUncertainty(input) {
    const data = input && typeof input === "object" ? input : {};
    const clean = (value, max = 240) => typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max)
      : "";
    const fields = [
      data.taskGoal, data.goal, data.currentState, data.instruction,
      data.label, data.targetHint, data.uncertainty
    ].map((value) => clean(value)).filter(Boolean);
    const corpus = fields.join(" | ");
    const rules = [
      { level: "critical", code: "immediate_danger",
        pattern: /\b(smoke|flames?|sparking|sparks|electric shock|gas leak|leaking gas|smell(?:ing)? gas|burning smell|fire hazard)\b/i,
        reversibility: "unknown",
        notice: "Safety pause: move away from the hazard. Do not touch or continue the task; contact local emergency help or a qualified professional as appropriate." },
      { level: "critical", code: "damaged_battery",
        pattern: /\b(swollen|puffed|punctured|leaking|smoking|overheating)\b.{0,45}\b(lithium|battery|cell)\b|\b(lithium|battery|cell)\b.{0,45}\b(swollen|puffed|punctured|leaking|smoking|overheating)\b/i,
        reversibility: "hard_to_reverse",
        notice: "Safety pause: do not charge, press, puncture, or disassemble that battery. Keep clear, especially if it is hot or smoking, and get qualified battery service." },
      { level: "high", code: "mains_electrical",
        pattern: /\b(live wire|exposed wire|mains voltage|mains wiring|household wiring|house wiring|breaker panel|electrical panel|wall outlet wiring|power outlet wiring|rewire|replace (?:a )?fuse while live)\b/i,
        reversibility: "hard_to_reverse",
        notice: "Safety pause: this may involve dangerous mains electricity. Do not touch exposed parts; stop and use a qualified electrician. I will not draw a procedural guide for this step." },
      { level: "high", code: "gas_or_pressure",
        pattern: /\b(gas line|gas pipe|gas valve|gas cylinder valve|pressure vessel|high[- ]pressure cylinder|refrigerant line)\b/i,
        reversibility: "hard_to_reverse",
        notice: "Safety pause: stop before adjusting gas or pressurised equipment. Keep clear of leaks and use qualified service; do not follow a visual repair cue here." },
      { level: "high", code: "vehicle_critical_system",
        pattern: /\b(brake (?:line|system|caliper|hose)|airbag|steering rack|high[- ]voltage (?:battery|pack|system)|ev battery pack)\b/i,
        reversibility: "hard_to_reverse",
        notice: "Safety pause: this is a safety-critical vehicle system. Do not act on a camera overlay; confirm the exact system and use the manufacturer procedure or a qualified technician." },
      { level: "high", code: "internal_battery_handling",
        pattern: /\b(laptop|phone|tablet|smartphone|power bank)\b.{0,55}\b(open|disassemble|pry|remove|replace|disconnect)\b.{0,40}\b(battery|cell)\b|\b(battery|cell)\b.{0,40}\b(puncture|pry|remove|replace)\b.{0,35}\b(laptop|phone|tablet|smartphone|power bank)\b/i,
        reversibility: "hard_to_reverse",
        notice: "Safety pause: internal battery handling can cause fire or injury. Do not pry or puncture anything; verify the exact model and official safety procedure before proceeding." },
      { level: "high", code: "hazardous_chemical_mixing",
        pattern: /\b(mix|mixing|combine)\b.{0,35}\b(bleach|ammonia|acid|drain cleaner)\b|\b(bleach|ammonia|acid|drain cleaner)\b.{0,35}\b(with|and)\b.{0,20}\b(bleach|ammonia|acid|drain cleaner)\b/i,
        reversibility: "hard_to_reverse",
        notice: "Safety pause: do not mix cleaning chemicals. Move away from fumes, ventilate only if safe, and follow product emergency guidance or contact local poison/emergency services." },
      { level: "high", code: "medical_dose_change",
        pattern: /\b(change|adjust|increase|decrease|double|skip)\b.{0,30}\b(dose|dosage)\b.{0,30}\b(insulin|medicine|medication|prescription)\b|\b(insulin|prescription medication)\b.{0,30}\b(dose|dosage)\b/i,
        reversibility: "hard_to_reverse",
        notice: "Safety pause: do not change a medicine dose based on camera guidance. Confirm with the prescribing clinician or pharmacist." },
      { level: "caution", code: "tools_heat_or_cutting",
        pattern: /\b(solder|soldering|drill|drilling|cutting|utility knife|sharp blade|hot surface|open flame|solvent|ladder|roof edge)\b/i,
        reversibility: "reversible",
        notice: "Use suitable protection and keep hands clear. Continue only with a stable setup and the correct tool." }
    ];
    const rank = { low: 0, caution: 1, moderate: 1, high: 2, critical: 3 };
    let level = "low";
    let reversibility = "reversible";
    let notice = "";
    const codes = [];
    for (const rule of rules) {
      if (!rule.pattern.test(corpus)) continue;
      codes.push(rule.code);
      if ((rank[rule.level] || 0) > (rank[level] || 0)) {
        level = rule.level;
        reversibility = rule.reversibility;
        notice = rule.notice;
      }
    }
    const supplied = data.safetyAssessment && typeof data.safetyAssessment === "object"
      ? data.safetyAssessment
      : (data.safety_assessment && typeof data.safety_assessment === "object" ? data.safety_assessment : {});
    const statedLevel = clean(supplied.consequence, 24).toLowerCase();
    if (["critical", "high", "moderate", "caution"].includes(statedLevel) &&
        (rank[statedLevel] || 0) > (rank[level] || 0)) {
      level = statedLevel === "moderate" ? "caution" : statedLevel;
      codes.push("model_consequence_assessment");
      notice = clean(supplied.uncertainty, 190) || "Safety pause: the consequence of this step may be high. Let's confirm the important facts before acting.";
    }
    const statedReversibility = clean(supplied.reversibility, 32).toLowerCase();
    if (statedReversibility === "irreversible") {
      codes.push("hard_to_reverse_action");
      if ((rank[level] || 0) < rank.high) {
        level = "high";
        notice = clean(supplied.uncertainty, 190) || "Safety pause: this action may be difficult to reverse. Confirm the exact situation before proceeding.";
      }
      reversibility = "irreversible";
    } else if (statedReversibility === "hard_to_reverse") {
      reversibility = "hard_to_reverse";
      if (level === "low") level = "caution";
    } else if (statedReversibility === "unknown" && level === "low") {
      reversibility = "unknown";
    }
    const requiresPause = supplied.requires_pause === true;
    if (requiresPause && (rank[level] || 0) < rank.high) {
      level = "high";
      codes.push("explicit_pause_required");
      notice = clean(supplied.uncertainty, 190) || "Safety pause: an important safety fact is unresolved. Do not act yet; let's verify it first.";
    }
    if (!notice && level === "caution") notice = rules.find((rule) => codes.includes(rule.code))?.notice || "Use suitable protection and keep the work area stable.";
    const blocksVisuals = level === "high" || level === "critical" || requiresPause;
    if (blocksVisuals && !notice) notice = "Safety pause: do not act on a visual cue until the safety-critical facts are confirmed.";
    const uncertainty = clean(supplied.uncertainty, 190);
    return {
      level, codes: Array.from(new Set(codes)).slice(0, 6),
      reversibility, requiresPause: blocksVisuals, blocksVisuals,
      notice: clean(notice, 240), uncertainty
    };
  }

  function formatSafetyAssessmentSummary(assessment) {
    const value = assessment && typeof assessment === "object" ? assessment : { level: "unknown", codes: [], blocksVisuals: true };
    const codes = Array.isArray(value.codes) ? value.codes.slice(0, 6).join(", ") : "";
    return [
      "M31 safety gate: consequence=" + String(value.level || "unknown") +
        "; reversibility=" + String(value.reversibility || "unknown") +
        "; visual guidance " + (value.blocksVisuals ? "BLOCKED" : "permitted with ordinary caution") + ".",
      codes ? "Safety flags: " + codes + "." : "",
      value.uncertainty ? "Unresolved safety uncertainty: " + value.uncertainty : "",
      value.blocksVisuals ? ("Required next response: stop procedural guidance, explain the safety pause plainly, and ask only the most important clarifying question or recommend qualified help. " + (value.notice || "")) : ""
    ].filter(Boolean).join("\n");
  }

  // M32: explicit state machine for the currently valid source of reality evidence.
  function createRealityLoopState() {
    return {
      mode: "idle", camera: "idle", voice: "idle", spatialAr: "inactive",
      observationSource: "none", tracking: "inactive", awaitingFreshFrame: false,
      frameSequence: 0, viewGeneration: 0, lastFreshFrameAt: 0,
      lastTransitionAt: 0, lastReason: "initial", revision: 0
    };
  }

  function transitionRealityLoopState(previous, event, now) {
    const prior = previous && typeof previous === "object" ? previous : createRealityLoopState();
    const next = { ...createRealityLoopState(), ...prior };
    const action = event && typeof event.type === "string" ? event.type : "";
    const at = Number.isFinite(now) ? now : Date.now();
    const reason = event && typeof event.reason === "string" ? event.reason.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100) : action;
    switch (action) {
      case "session_starting":
        next.mode = "starting"; next.camera = "requesting"; next.voice = "connecting";
        next.spatialAr = "inactive"; next.observationSource = "none"; next.tracking = "inactive";
        next.awaitingFreshFrame = true; next.frameSequence = 0; next.lastFreshFrameAt = 0; next.viewGeneration += 1;
        break;
      case "camera_ready":
        next.camera = "live"; next.observationSource = "none"; next.tracking = "reacquiring";
        next.awaitingFreshFrame = true; next.mode = "awaiting_frame";
        break;
      case "voice_ready":
        next.voice = "live"; next.mode = next.camera === "live" ? "awaiting_frame" : "voice_only";
        next.observationSource = "none"; next.awaitingFreshFrame = next.camera === "live";
        break;
      case "frame_sent":
        if (prior.camera !== "live" || prior.spatialAr === "active" || prior.mode === "background_paused") return prior;
        next.frameSequence = (Number.isFinite(prior.frameSequence) ? prior.frameSequence : 0) + 1;
        next.lastFreshFrameAt = at; next.observationSource = "camera"; next.awaitingFreshFrame = false;
        next.mode = next.voice === "live" ? "camera_live" : "camera_ready";
        next.tracking = event && event.trackingActive === true ? "active" : "available";
        break;
      case "spatial_ar_start":
        next.mode = "spatial_ar"; next.camera = "suspended"; next.spatialAr = "active";
        next.observationSource = "xr_pose"; next.tracking = "paused"; next.awaitingFreshFrame = true; next.viewGeneration += 1;
        break;
      case "spatial_ar_ended":
        next.mode = "resuming_camera"; next.camera = "resuming"; next.spatialAr = "inactive";
        next.observationSource = "none"; next.tracking = "reacquiring"; next.awaitingFreshFrame = true;
        break;
      case "camera_resumed":
        next.mode = "awaiting_frame"; next.camera = "live"; next.spatialAr = "inactive";
        next.observationSource = "none"; next.tracking = "reacquiring"; next.awaitingFreshFrame = true; next.viewGeneration += 1;
        break;
      case "camera_error":
        next.camera = "unavailable"; next.observationSource = "none"; next.tracking = "paused"; next.awaitingFreshFrame = true;
        next.mode = next.voice === "live" ? "voice_only" : "degraded";
        break;
      case "visibility_hidden":
        next.mode = "background_paused"; next.observationSource = "none"; next.tracking = "paused";
        next.awaitingFreshFrame = true; next.viewGeneration += 1;
        break;
      case "visibility_visible":
        next.observationSource = next.spatialAr === "active" ? "xr_pose" : "none";
        next.tracking = "reacquiring"; next.awaitingFreshFrame = true;
        next.mode = next.spatialAr === "active" ? "spatial_ar" : (next.camera === "live" ? "awaiting_frame" : (next.voice === "live" ? "voice_only" : "degraded"));
        next.viewGeneration += 1;
        break;
      case "session_stopped":
        return { ...createRealityLoopState(), lastTransitionAt: at, lastReason: reason || "session_stopped", revision: (prior.revision || 0) + 1 };
      default:
        return prior;
    }
    next.lastTransitionAt = at; next.lastReason = reason || action;
    next.revision = (Number.isFinite(prior.revision) ? prior.revision : 0) + 1;
    return next;
  }

  function realityLoopBlocksVisualUpdate(state) {
    const value = state && typeof state === "object" ? state : createRealityLoopState();
    return value.spatialAr === "active" || value.camera !== "live" ||
      value.awaitingFreshFrame === true ||
      ["starting", "awaiting_frame", "resuming_camera", "background_paused", "voice_only", "degraded", "idle"].includes(value.mode);
  }

  function formatRealityLoopSummary(state) {
    const value = state && typeof state === "object" ? state : createRealityLoopState();
    const lines = [
      "M32 reality loop: mode=" + String(value.mode || "unknown") +
        "; voice=" + String(value.voice || "unknown") +
        "; camera=" + String(value.camera || "unknown") +
        "; spatialAR=" + String(value.spatialAr || "unknown") +
        "; observation=" + String(value.observationSource || "none") +
        "; localTracking=" + String(value.tracking || "unknown") +
        "; freshFrameRequired=" + String(value.awaitingFreshFrame === true) +
        "; frameSequence=" + String(Number.isFinite(value.frameSequence) ? value.frameSequence : 0) + "."
    ];
    if (value.spatialAr === "active") {
      lines.push("During immersive Spatial AR, Moina receives no new camera images; XR pose/hit-test state is local only. Do not claim fresh camera observation or visual verification until the Co-Pilot camera resumes and a new frame is sent.");
    } else if (value.awaitingFreshFrame === true) {
      lines.push("The previous camera evidence is stale for new instructions. Hold camera-dependent overlays and verification until a fresh frame reaches the live model.");
    }
    return lines.join("\n");
  }

  function recordRealityLoopEvent(type, details) {
    realityLoopState = transitionRealityLoopState(realityLoopState, { ...(details || {}), type }, Date.now());
    return realityLoopState;
  }

  function hideStaleCameraOverlays() {
    clearVisualGuide();
    if (typeof stopLocalTracking === "function") stopLocalTracking(false);
    focusMarker.hidden = true; approxTag.hidden = true; clearMarkerButton.disabled = true;
    focusMarker.style.left = ""; focusMarker.style.top = "";
    delete focusMarker.dataset.tracking;
  }

  function showSafetyPauseNotice(assessment) {
    if (!stage) return;
    if (!safetyPauseNode) {
      safetyPauseNode = document.createElement("section");
      safetyPauseNode.className = "safety-pause-notice";
      safetyPauseNode.setAttribute("role", "status");
      safetyPauseNode.setAttribute("aria-live", "polite");
      const heading = document.createElement("strong");
      heading.className = "safety-pause-title"; heading.textContent = "PAUSE FOR SAFETY";
      const body = document.createElement("p");
      body.className = "safety-pause-copy";
      safetyPauseNode.append(heading, body); stage.appendChild(safetyPauseNode);
    }
    const body = safetyPauseNode.querySelector(".safety-pause-copy");
    const heading = safetyPauseNode.querySelector(".safety-pause-title");
    const value = assessment && typeof assessment === "object" ? assessment : {};
    heading.textContent = value.level === "critical" ? "SAFETY ALERT" : "PAUSE FOR SAFETY";
    body.textContent = String(value.notice || "Do not act on a visual cue until the safety-critical facts are confirmed.").slice(0, 240);
    safetyPauseNode.dataset.level = value.level === "critical" ? "critical" : "high";
    safetyPauseNode.hidden = false;
  }

  function hideSafetyPauseNotice() {
    if (safetyPauseNode) safetyPauseNode.hidden = true;
  }

  function setStatus(message, kind) {
    statusNode.textContent = message;
    statusNode.dataset.kind = kind || "normal";
    if (kind === "error" && message) showConnectionNotice("Something went wrong", message, "error");
  }

  function showConnectionNotice(title, message, kind) {
    if (!connectionNotice) return;
    const safeTitle = String(title || "Connection notice");
    const safeMessage = String(message || "Please try again.");
    const isError = kind === "error";
    if (isError) persistentConnectionIssue = { title: safeTitle, message: safeMessage };
    const stillRecovering = !isError && Boolean(persistentConnectionIssue);
    connectionNoticeTitle.textContent = stillRecovering ? "Reconnecting…" : safeTitle;
    connectionNoticeMessage.textContent = stillRecovering
      ? persistentConnectionIssue.message + " Recovery in progress: " + safeMessage
      : safeMessage;
    connectionNotice.dataset.kind = isError ? "error" : stillRecovering ? "connecting-after-error" : (kind || "connecting");
    connectionNotice.setAttribute("role", (isError || stillRecovering) ? "alertdialog" : "status");
    connectionNotice.setAttribute("aria-live", (isError || stillRecovering) ? "assertive" : "polite");
    connectionNoticeProgress.hidden = isError;
    const canRetryNow = isError || kind === "slow" || stillRecovering;
    connectionNoticeAction.hidden = !canRetryNow;
    connectionNoticeAction.textContent = isError ? "Try again" : "Reconnect now";
    if (isError || kind === "slow") connectionNoticeAction.disabled = false;
    connectionNotice.hidden = false;
    stage.classList.add("has-notice");
    syncDisconnectedPreviewAppearance();
  }

  function hideConnectionNotice(resolved = false) {
    if (persistentConnectionIssue && !resolved) return;
    if (resolved) { persistentConnectionIssue = null; if (connectionNoticeAction) connectionNoticeAction.disabled = false; }
    if (connectionNotice) connectionNotice.hidden = true;
    stage.classList.remove("has-notice");
    syncDisconnectedPreviewAppearance();
  }

  function retryConnection(message) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (active || starting) stopCopilot(false, null, null, true);
      automaticReconnectAttempts = 0;
      setConnectionState("OFFLINE", "error");
      setStatus("You're offline. Reconnect when your internet is back; AskMoina will not auto-open your camera or microphone.", "warning");
      showConnectionNotice("You're offline", "Waiting for your network. Tap Reconnect now when you're back online.", "slow");
      return;
    }
    if (automaticReconnectAttempts >= 3) {
      automaticReconnectAttempts = 0;
      stopCopilot(false, message || "The connection could not be restored. Check your network and try again.", "error", true);
      setConnectionState("READY", "error");
      return;
    }
    automaticReconnectAttempts += 1;
    const wasConnected = active && setupReady;
    if (wasConnected) playDisconnectSound();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    stopCopilot(false, null, null, true);
    stage.classList.add("is-connecting");
    setConnectionState("RECONNECTING", "connecting");
    setStatus(message || "The network is taking longer than usual. Reconnecting…", "warning");
    showConnectionNotice("Network is slow", "The connection was interrupted. Checking the network and reconnecting…", "slow");
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (active || starting) return;
      isAutomaticRetry = true;
      void startCopilot();
    }, automaticReconnectAttempts === 1 ? 700 : automaticReconnectAttempts === 2 ? 1400 : 2500);
  }

  function setAvailability(message, kind) {
    availabilityNode.textContent = message;
    availabilityNode.dataset.kind = kind || "normal";
  }

  function syncDisconnectedPreviewAppearance() {
    if (!video) return;
    if (recoveryPreviewClear && !(active && setupReady)) {
      video.style.setProperty("filter", "none", "important");
      // The placeholder is blurred by .has-notice too; keep the fallback scene legible
      // while the local camera preview is being reacquired.
      stage.classList.add("recovery-preview-clear");
      video.style.setProperty("-webkit-filter", "none", "important");
      video.style.setProperty("transition", "none", "important");
      return;
    }
    stage.classList.remove("recovery-preview-clear");
    video.style.removeProperty("filter");
    video.style.removeProperty("-webkit-filter");
    video.style.removeProperty("transition");
    if (active && setupReady) recoveryPreviewClear = false;
  }

  function setConnectionState(label, state) {
    connectionPill.textContent = label;
    connectionPill.dataset.state = state || "ready";
  }

  function setCameraState(label, state) {
    cameraState.innerHTML = '<span class="state-dot"></span> ' + label;
    cameraState.dataset.state = state || "idle";
    frameBadge.innerHTML = state === "live"
      ? '<span class="live-dot"></span> CAMERA FRAMES STREAMING'
      : '<span class="live-dot"></span> WAITING FOR CAMERA';
  }

  function setControls(label, disabled) {
    buttonLabel.textContent = label;
    toggleButton.disabled = Boolean(disabled);
    toggleButton.classList.toggle("is-live", active);
    stage.classList.toggle("voice-active", active);
    stage.classList.toggle("is-connecting", starting && !active);
    syncDisconnectedPreviewAppearance();
    toggleButton.setAttribute("aria-label", active ? "End call" : "Start call");
    toggleButton.title = active ? "End call" : "Start call";
    toggleButton.setAttribute("aria-pressed", active ? "true" : "false");
    const cameraAvailable = Boolean(microphoneStream && !cameraSuspendedForSpatialAr &&
      microphoneStream.getVideoTracks().some((track) => track.readyState === "live"));
    const microphoneAvailable = Boolean(microphoneStream &&
      microphoneStream.getAudioTracks().some((track) => track.readyState === "live"));
    flipButton.disabled = !active || !cameraAvailable;
    muteButton.disabled = !active || !microphoneAvailable;
    zoomSlider.disabled = !cameraAvailable;
    zoomInButton.disabled = !cameraAvailable || zoomLevel >= zoomMax;
    zoomOutButton.disabled = !cameraAvailable || zoomLevel <= zoomMin;
    muteButton.innerHTML = microphoneMuted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8M3 3l18 18"/></svg><span class="sr-only">Unmute microphone</span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg><span class="sr-only">Mute microphone</span>';
    muteButton.setAttribute("aria-pressed", microphoneMuted ? "true" : "false");
    muteButton.setAttribute("aria-label", microphoneMuted ? "Unmute microphone" : "Mute microphone");
    clearMarkerButton.disabled = focusMarker.hidden;
  }

  const visualGuideSvgNS = "http://www.w3.org/2000/svg";

  function clearVisualGuide() {
    latestVisualGuideElements = [];
    if (visualGuideSvg) {
      visualGuideSvg.replaceChildren();
      visualGuideSvg.hidden = true;
    }
  }

  function getVisualGuideLayer() {
    if (visualGuideSvg && visualGuideSvg.isConnected) return visualGuideSvg;
    visualGuideSvg = document.createElementNS(visualGuideSvgNS, "svg");
    visualGuideSvg.classList.add("ai-visual-guide");
    visualGuideSvg.setAttribute("aria-hidden", "true");
    visualGuideSvg.setAttribute("preserveAspectRatio", "none");
    visualGuideSvg.hidden = true;
    stage.appendChild(visualGuideSvg);
    return visualGuideSvg;
  }

  function visualCoord(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000
      ? value : null;
  }

  // Model coordinates belong to the latest source frame sent to Gemini. Keep this
  // projection in one pure function so fit/crop and mirroring rules can be regression-tested.
  function visualGuideProjection(stageWidth, stageHeight, frameWidth, frameHeight, mirrored) {
    const width = Math.max(1, Number(stageWidth) || 1);
    const height = Math.max(1, Number(stageHeight) || 1);
    const sourceWidth = Math.max(1, Number(frameWidth) || 1);
    const sourceHeight = Math.max(1, Number(frameHeight) || 1);
    const coverScale = Math.max(width / sourceWidth, height / sourceHeight);
    const coverWidth = sourceWidth * coverScale;
    const coverHeight = sourceHeight * coverScale;
    const offsetX = (width - coverWidth) / 2;
    const offsetY = (height - coverHeight) / 2;
    const xAt = (x) => {
      const projected = (Number(x) / 1000) * coverWidth + offsetX;
      return mirrored ? width - projected : projected;
    };
    const yAt = (y) => (Number(y) / 1000) * coverHeight + offsetY;
    const sizeAt = (value) => (Number(value) * Math.min(sourceWidth, sourceHeight) / 1000) * coverScale;
    return { width, height, coverScale, coverWidth, coverHeight, offsetX, offsetY, xAt, yAt, sizeAt };
  }

  function isCameraPreviewMirrored() {
    return facingMode === "user";
  }

  function updatePreviewTransform() {
    const transforms = [];
    if (isCameraPreviewMirrored()) transforms.push("scaleX(-1)");
    if (!nativeZoomSupported && zoomLevel > 1) transforms.push("scale(" + zoomLevel + ")");
    video.style.transform = transforms.join(" ");
  }

  function redrawVisualGuide() {
    if (!visualGuideSvg || !latestVisualGuideElements.length) return;
    renderVisualGuide(latestVisualGuideElements.slice());
  }

  // M28: translate task-level spatial language into a small, validated set of screen-space primitives.
  function normalizeSpatialCues(rawCues) {
    if (!Array.isArray(rawCues)) return [];
    const kinds = new Set(["alignment", "motion_path", "placement_region", "target_point", "orientation", "label"]);
    const tones = new Set(["mint", "white", "amber"]);
    const output = [];
    for (const raw of rawCues.slice(0, 5)) {
      if (!raw || typeof raw !== "object" || !kinds.has(raw.kind) ||
          !Array.isArray(raw.points) || raw.points.length > 8) continue;
      const points = raw.points.map((point) => ({
        x: visualCoord(point && point.x),
        y: visualCoord(point && point.y)
      }));
      if (points.some((point) => point.x === null || point.y === null)) continue;
      const color = tones.has(raw.color) ? raw.color : "mint";
      const label = typeof raw.label === "string"
        ? raw.label.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 48)
        : "";
      const first = points[0];
      const last = points[points.length - 1];
      if (raw.kind === "alignment" && points.length >= 2) {
        output.push({ type: "line", x1: first.x, y1: first.y, x2: last.x, y2: last.y, color });
      } else if (raw.kind === "motion_path" && points.length >= 2) {
        output.push({ type: "polyline", points, directional: true, color });
      } else if (raw.kind === "placement_region" && points.length >= 3) {
        output.push({ type: "polygon", points, color });
      } else if (raw.kind === "target_point" && points.length === 1) {
        output.push({ type: "circle", x: first.x, y: first.y, radius: 20, color });
      } else if (raw.kind === "orientation" && points.length >= 2) {
        output.push({ type: "arrow", x1: first.x, y1: first.y, x2: last.x, y2: last.y, color });
      } else if (raw.kind === "label" && points.length >= 1 && label) {
        output.push({ type: "label", x: first.x, y: first.y, text: label, color });
      }
    }
    return output.slice(0, 5);
  }

  function renderVisualGuide(elements) {
    clearVisualGuide();
    if (!Array.isArray(elements) || !elements.length) return false;

    const allowedTypes = new Set(["line", "arrow", "circle", "rect", "tick", "label", "polyline", "polygon"]);
    const allowedTones = new Set(["mint", "white", "amber"]);
    const accepted = elements.slice(0, 8).filter((element) => {
      if (!element || typeof element !== "object" || !allowedTypes.has(element.type)) return false;
      const n = visualCoord;
      if (element.type === "polyline" || element.type === "polygon") {
        const points = Array.isArray(element.points) ? element.points : [];
        const minimum = element.type === "polygon" ? 3 : 2;
        return points.length >= minimum && points.length <= 8 &&
          points.every((point) => point && n(point.x) !== null && n(point.y) !== null);
      }
      if (element.type === "line" || element.type === "arrow") {
        return n(element.x1) !== null && n(element.y1) !== null && n(element.x2) !== null &&
          n(element.y2) !== null && (element.x1 !== element.x2 || element.y1 !== element.y2);
      }
      if (element.type === "circle") {
        return n(element.x) !== null && n(element.y) !== null &&
          typeof element.radius === "number" && Number.isFinite(element.radius) &&
          element.radius >= 4 && element.radius <= 250;
      }
      if (element.type === "rect") {
        return n(element.x) !== null && n(element.y) !== null &&
          typeof element.width === "number" && Number.isFinite(element.width) &&
          typeof element.height === "number" && Number.isFinite(element.height) &&
          element.width >= 1 && element.width <= 1000 && element.height >= 1 && element.height <= 1000;
      }
      if (element.type === "tick") return n(element.x) !== null && n(element.y) !== null;
      return n(element.x) !== null && n(element.y) !== null &&
        typeof element.text === "string" && element.text.trim().length > 0;
    });
    if (!accepted.length) return false;

    const svg = getVisualGuideLayer();
    svg.replaceChildren();
    const bounds = stage.getBoundingClientRect();
    const frameWidth = Math.max(1, video.videoWidth || bounds.width);
    const frameHeight = Math.max(1, video.videoHeight || bounds.height);
    const projection = visualGuideProjection(
      bounds.width, bounds.height, frameWidth, frameHeight, isCameraPreviewMirrored()
    );
    const { width, height, xAt, yAt, sizeAt } = projection;

    const defs = document.createElementNS(visualGuideSvgNS, "defs");
    for (const tone of ["mint", "white", "amber"]) {
      const marker = document.createElementNS(visualGuideSvgNS, "marker");
      marker.setAttribute("id", "moina-guide-arrow-" + tone);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "7");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("orient", "auto-start-reverse");
      marker.setAttribute("markerUnits", "strokeWidth");
      marker.classList.add("ai-guide-shape", "tone-" + tone);
      const head = document.createElementNS(visualGuideSvgNS, "path");
      head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      head.classList.add("ai-guide-arrowhead");
      marker.appendChild(head);
      defs.appendChild(marker);
    }
    svg.appendChild(defs);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);

    for (const element of accepted) {
      const tone = allowedTones.has(element.color) ? element.color : "mint";
      let shape = null;
      if (element.type === "line" || element.type === "arrow") {
        shape = document.createElementNS(visualGuideSvgNS, "line");
        shape.setAttribute("x1", String(xAt(element.x1)));
        shape.setAttribute("y1", String(yAt(element.y1)));
        shape.setAttribute("x2", String(xAt(element.x2)));
        shape.setAttribute("y2", String(yAt(element.y2)));
        if (element.type === "arrow") shape.setAttribute("marker-end", "url(#moina-guide-arrow-" + tone + ")");
      } else if (element.type === "circle") {
        shape = document.createElementNS(visualGuideSvgNS, "circle");
        shape.setAttribute("cx", String(xAt(element.x)));
        shape.setAttribute("cy", String(yAt(element.y)));
        shape.setAttribute("r", String(Math.max(3, sizeAt(element.radius))));
      } else if (element.type === "rect") {
        shape = document.createElementNS(visualGuideSvgNS, "rect");
        const projectedX = xAt(element.x);
        const rectWidth = Math.max(1, sizeAt(element.width));
        shape.setAttribute("x", String(isCameraPreviewMirrored() ? projectedX - rectWidth : projectedX));
        shape.setAttribute("y", String(yAt(element.y)));
        shape.setAttribute("width", String(rectWidth));
        shape.setAttribute("height", String(Math.max(1, sizeAt(element.height))));
        shape.setAttribute("rx", "8");
      } else if (element.type === "polyline" || element.type === "polygon") {
        shape = document.createElementNS(visualGuideSvgNS, element.type);
        shape.setAttribute("points", element.points.map((point) =>
          String(xAt(point.x)) + "," + String(yAt(point.y))
        ).join(" "));
        if (element.type === "polygon") shape.classList.add("ai-guide-region");
        if (element.type === "polyline" && element.directional === true) {
          shape.setAttribute("marker-end", "url(#moina-guide-arrow-" + tone + ")");
        }
      } else if (element.type === "tick") {
        const x = xAt(element.x);
        const y = yAt(element.y);
        const size = Math.max(8, Math.min(18, Math.min(width, height) * 0.024));
        shape = document.createElementNS(visualGuideSvgNS, "path");
        shape.setAttribute("d", "M " + (x - size) + " " + y + " L " + (x - size * 0.2) + " " + (y + size * 0.75) + " L " + (x + size) + " " + (y - size));
      } else if (element.type === "label") {
        shape = document.createElementNS(visualGuideSvgNS, "text");
        shape.setAttribute("x", String(xAt(element.x)));
        shape.setAttribute("y", String(yAt(element.y)));
        shape.setAttribute("font-size", String(Math.max(12, Math.min(20, Math.min(width, height) * 0.032))));
        shape.textContent = element.text.trim().slice(0, 48);
        shape.classList.add("ai-guide-label");
      }
      if (!shape) continue;
      if (element.type !== "label") shape.classList.add("ai-guide-shape");
      shape.classList.add("tone-" + tone);
      svg.appendChild(shape);
    }

    latestVisualGuideElements = accepted;
    svg.hidden = false;
    return true;
  }

  function clearOverlay() {
    hideSafetyPauseNotice();
    clearVisualGuide();
    awaitingTargetSelection = false;
    pendingTrackingTargetKey = "";
    latestVisualGuidance = null;
    stopLocalTracking(false);
    focusMarker.hidden = true;
    approxTag.hidden = true;
    clearMarkerButton.disabled = true;
    focusMarker.style.left = "";
    focusMarker.style.top = "";
    delete focusMarker.dataset.tracking;
  }

  // Recompute normalized guides for viewport changes; camera-frame changes invalidate them.
  if (typeof ResizeObserver !== "undefined") {
    const visualGuideResizeObserver = new ResizeObserver(redrawVisualGuide);
    visualGuideResizeObserver.observe(stage);
  } else {
    window.addEventListener("resize", redrawVisualGuide);
  }
  video.addEventListener("resize", () => invalidateSceneEvidence("video-frame-resize"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      recordRealityLoopEvent("visibility_hidden");
      invalidateSceneEvidence("tab-hidden");
      hideStaleCameraOverlays();
    } else if (active) {
      recordRealityLoopEvent("visibility_visible");
      invalidateSceneEvidence("tab-visible");
      if (!cameraSuspendedForSpatialAr && microphoneStream && microphoneStream.getVideoTracks().some((track) => track.readyState === "live")) {
        startVideoFrames();
        setStatus("Camera returned. Re-checking the scene with a fresh frame before drawing guidance.");
      }
    }
  });


  // M25: rolling, evidence-tagged scene records. Screen regions are descriptive hints,
  // not object detections or measurements. Stable IDs are kept only while labels agree.
  function mergeSceneModel(previous, rawObservations, rawRelations, context, now) {
    const ttlMs = 7_000;
    const maxObservations = 8;
    const maxRelations = 12;
    const viewGeneration = Number.isFinite(context && context.viewGeneration) ? context.viewGeneration : 0;
    const frameSequence = Number.isFinite(context && context.frameSequence) ? context.frameSequence : 0;
    const sourceFrameAt = Number.isFinite(context && context.sourceFrameAt) ? context.sourceFrameAt : 0;
    const frameViewGeneration = Number.isFinite(context && context.frameViewGeneration) ? context.frameViewGeneration : -1;
    const sameView = Boolean(previous && previous.viewGeneration === viewGeneration);
    const observations = sameView && Array.isArray(previous.observations)
      ? previous.observations.filter((item) => item && now >= item.observedAt && now - item.observedAt <= ttlMs).slice(0, maxObservations)
      : [];
    const relations = sameView && Array.isArray(previous.relations)
      ? previous.relations.filter((item) => item && now >= item.observedAt && now - item.observedAt <= ttlMs).slice(0, maxRelations)
      : [];
    const model = {
      viewGeneration,
      updatedAt: sameView && Number.isFinite(previous.updatedAt) ? previous.updatedAt : 0,
      frameSequence: sameView && Number.isFinite(previous.frameSequence) ? previous.frameSequence : 0,
      observations,
      relations,
      staleInputRejected: false
    };
    const incomingCount = (Array.isArray(rawObservations) ? rawObservations.length : 0) +
      (Array.isArray(rawRelations) ? rawRelations.length : 0);
    if (!incomingCount) return model;

    // Late model tool calls must not refresh observations from a frame sent before
    // a camera switch/zoom, or from a frame that is no longer recent.
    const sourceIsFresh = frameSequence > 0 &&
      sourceFrameAt > 0 &&
      now >= sourceFrameAt &&
      now - sourceFrameAt <= 5_000 &&
      frameViewGeneration === viewGeneration;
    if (!sourceIsFresh) {
      model.staleInputRejected = true;
      return model;
    }

    const regions = new Set(["center", "upper-left", "upper-right", "lower-left", "lower-right"]);
    const evidenceKinds = new Set(["direct", "inferred"]);
    const relationKinds = new Set(["left_of", "right_of", "above", "below", "beside", "on", "under", "inside", "attached_to", "connected_to", "overlapping", "near"]);
    const incomingIdMap = new Map();
    const incoming = [];
    for (const raw of (Array.isArray(rawObservations) ? rawObservations.slice(0, maxObservations) : [])) {
      if (!raw || typeof raw !== "object") continue;
      const sourceId = typeof raw.id === "string" ? raw.id.trim().slice(0, 28) : "";
      const label = typeof raw.label === "string" ? raw.label.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64) : "";
      if (!/^[A-Za-z0-9._-]{1,28}$/.test(sourceId) || !label) continue;
      const evidence = evidenceKinds.has(raw.evidence) ? raw.evidence : "inferred";
      const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence)) : 0.35;
      const region = regions.has(raw.screen_region) ? raw.screen_region : "center";
      const visible = typeof raw.visible === "boolean" ? raw.visible : true;
      const old = observations.find((item) => item.id === sourceId);
      const normalizedLabel = (value) => String(value || "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const labelConflict = Boolean(old && normalizedLabel(old.label) !== normalizedLabel(label));
      const id = labelConflict ? (sourceId + "@" + frameSequence).slice(0, 40) : sourceId;
      incomingIdMap.set(sourceId, id);
      const record = {
        id, label,
        evidence: labelConflict ? "inferred" : evidence,
        confidence: labelConflict ? Math.min(confidence, 0.35) : confidence,
        screenRegion: region, visible, observedAt: now, sourceFrameAt, frameSequence, viewGeneration,
        identityConflict: labelConflict,
        identityNote: labelConflict ? "Identifier reused with a different label; identity is uncertain." : ""
      };
      incoming.push(record);
      const existingIndex = observations.findIndex((item) => item.id === id);
      if (existingIndex >= 0) observations[existingIndex] = record;
      else observations.unshift(record);
    }
    model.observations = observations.slice(0, maxObservations);

    const knownIds = new Set(model.observations.map((item) => item.id));
    const freshRelations = [];
    for (const raw of (Array.isArray(rawRelations) ? rawRelations.slice(0, maxRelations) : [])) {
      if (!raw || typeof raw !== "object") continue;
      const sourceFrom = typeof raw.from_id === "string" ? raw.from_id.trim().slice(0, 28) : "";
      const sourceTo = typeof raw.to_id === "string" ? raw.to_id.trim().slice(0, 28) : "";
      const fromId = incomingIdMap.get(sourceFrom) || sourceFrom;
      const toId = incomingIdMap.get(sourceTo) || sourceTo;
      if (!knownIds.has(fromId) || !knownIds.has(toId) || fromId === toId || !relationKinds.has(raw.relation)) continue;
      const evidence = evidenceKinds.has(raw.evidence) ? raw.evidence : "inferred";
      const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence)) : 0.35;
      freshRelations.push({ fromId, toId, relation: raw.relation, evidence, confidence, observedAt: now, frameSequence, viewGeneration });
    }
    for (const fresh of freshRelations) {
      const index = relations.findIndex((item) => item.fromId === fresh.fromId && item.toId === fresh.toId && item.relation === fresh.relation);
      if (index >= 0) relations[index] = fresh;
      else relations.unshift(fresh);
    }
    model.relations = relations.filter((item) => knownIds.has(item.fromId) && knownIds.has(item.toId)).slice(0, maxRelations);
    if (incoming.length || freshRelations.length) {
      model.updatedAt = now;
      model.frameSequence = frameSequence;
      model.staleInputRejected = false;
    }
    return model;
  }

  function formatSceneModelSummary(model, now) {
    const ttlMs = 7_000;
    const current = model && Array.isArray(model.observations)
      ? model.observations.filter((item) => item && now >= item.observedAt && now - item.observedAt <= ttlMs).slice(0, 8)
      : [];
    const currentIds = new Set(current.map((item) => item.id));
    const relationList = model && Array.isArray(model.relations)
      ? model.relations.filter((item) => item && currentIds.has(item.fromId) && currentIds.has(item.toId) && now >= item.observedAt && now - item.observedAt <= ttlMs).slice(0, 8)
      : [];
    if (!current.length) return "Scene model: no fresh structured observations are available. Use the newest camera frame; do not infer object identity or geometry from stale scene notes.";
    const lines = current.map((item) => {
      const age = Math.max(0, (now - item.observedAt) / 1000).toFixed(1);
      return "- " + item.id + ": " + item.label + "; evidence=" + item.evidence +
        "; model-reported confidence=" + item.confidence.toFixed(2) +
        "; last reported " + (item.visible ? "visible" : "not visible") +
        "; approximate region=" + item.screenRegion +
        "; age=" + age + "s" + (item.identityConflict ? "; ID/label conflict: treat identity as uncertain" : "");
    });
    if (relationList.length) {
      lines.push("Recent visible relations (model-reported, not measured): " + relationList.map((item) =>
        item.fromId + " " + item.relation + " " + item.toId + " (confidence " + item.confidence.toFixed(2) + ", " + item.evidence + ")"
      ).join("; "));
    }
    return [
      "Recent scene model evidence — short-lived, frame-tagged and approximate; not object detection, exact geometry, or world tracking:",
      ...lines,
      "Use only if it still matches the newest view. Confidence is the model's estimate, not calibrated probability. If target identity or relation is ambiguous, ask or request a tap."
    ].join("\n").slice(0, 2_600);
  }

  // M29: compact, session-local task state. Model notes are not themselves proof of task completion.
  function createTaskWorldModel() {
    return {
      goal: "",
      currentState: "",
      intendedAction: "",
      expectedEvidence: "",
      constraints: [],
      uncertainties: [],
      lastOutcome: { kind: "unknown", detail: "No result has been confirmed.", source: "none", at: 0 },
      events: [],
      updatedAt: 0,
      revision: 0
    };
  }

  function mergeTaskWorldModel(previous, rawState, verification, sceneEvidence, now) {
    const prior = previous && typeof previous === "object" ? previous : createTaskWorldModel();
    const raw = rawState && typeof rawState === "object" && !Array.isArray(rawState) ? rawState : {};
    const clean = (value, max = 180) => typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max)
      : "";
    const cleanList = (value, maxItems = 5) => Array.isArray(value)
      ? value.slice(0, maxItems).map((item) => clean(item, 140)).filter(Boolean)
      : [];
    const normalize = (value) => clean(value, 220).toLocaleLowerCase().replace(/\s+/g, " ");
    const next = {
      goal: clean(prior.goal, 220),
      currentState: clean(prior.currentState),
      intendedAction: clean(prior.intendedAction),
      expectedEvidence: clean(prior.expectedEvidence),
      constraints: Array.isArray(prior.constraints) ? prior.constraints.slice(0, 5).map((v) => clean(v, 140)).filter(Boolean) : [],
      uncertainties: Array.isArray(prior.uncertainties) ? prior.uncertainties.slice(0, 5).map((v) => clean(v, 140)).filter(Boolean) : [],
      lastOutcome: prior.lastOutcome && typeof prior.lastOutcome === "object" ? { ...prior.lastOutcome } : { kind: "unknown", detail: "No result has been confirmed.", source: "none", at: 0 },
      events: Array.isArray(prior.events) ? prior.events.slice(-5) : [],
      updatedAt: Number.isFinite(prior.updatedAt) ? prior.updatedAt : 0,
      revision: Number.isFinite(prior.revision) ? prior.revision : 0
    };
    const newGoal = clean(raw.task_goal, 220);
    const goalChanged = Boolean(newGoal && next.goal && normalize(newGoal) !== normalize(next.goal));
    const events = next.events.slice();
    const eventAt = Number.isFinite(now) ? now : Date.now();
    if (newGoal && (!next.goal || goalChanged)) {
      events.push({
        kind: goalChanged ? "goal_changed" : "goal_started",
        detail: newGoal,
        at: eventAt
      });
      next.goal = newGoal;
      next.currentState = clean(raw.current_state) || (goalChanged ? "New goal; prior task-specific assumptions were reset." : next.currentState);
      next.intendedAction = clean(raw.intended_action);
      next.expectedEvidence = clean(raw.expected_evidence);
      next.constraints = cleanList(raw.constraints);
      next.uncertainties = cleanList(raw.uncertainties);
      if (goalChanged) next.lastOutcome = { kind: "reset_for_new_goal", detail: "Earlier task outcome does not establish progress on the new goal.", source: "client", at: eventAt };
    } else {
      if (clean(raw.current_state)) next.currentState = clean(raw.current_state);
      if (clean(raw.intended_action)) next.intendedAction = clean(raw.intended_action);
      if (clean(raw.expected_evidence)) next.expectedEvidence = clean(raw.expected_evidence);
      if (Array.isArray(raw.constraints)) next.constraints = cleanList(raw.constraints);
      if (Array.isArray(raw.uncertainties)) next.uncertainties = cleanList(raw.uncertainties);
    }
    const reason = clean(raw.update_reason, 160);
    if (reason) events.push({ kind: "plan_revision", detail: reason, at: eventAt });

    // Only the guarded M27 result can create a visual-support status.
    if (verification && typeof verification === "object" && typeof verification.status === "string") {
      const outcomeMap = {
        supported_success: { kind: "visually_supported_success", detail: clean(verification.reason, 180), source: "m27_visual_gate" },
        supported_failure_or_no_change: { kind: "visually_supported_failure_or_no_change", detail: clean(verification.reason, 180), source: "m27_visual_gate" },
        ambiguous: { kind: "ambiguous_visual_evidence", detail: clean(verification.reason, 180), source: "m27_visual_gate" }
      };
      if (outcomeMap[verification.status]) {
        next.lastOutcome = { ...outcomeMap[verification.status], at: eventAt };
        events.push({ kind: outcomeMap[verification.status].kind, detail: outcomeMap[verification.status].detail, at: eventAt });
      }
    } else {
      const userReport = ["says_done", "says_failed", "unsure"].includes(raw.user_report) ? raw.user_report : "";
      if (userReport && !goalChanged) {
        const reportMap = {
          says_done: { kind: "user_reports_done", detail: "The user reports completion; camera verification is separate.", source: "user_report" },
          says_failed: { kind: "user_reports_failure", detail: "The user reports that the action did not work.", source: "user_report" },
          unsure: { kind: "user_reports_uncertainty", detail: "The user is unsure about the result.", source: "user_report" }
        };
        next.lastOutcome = { ...reportMap[userReport], at: eventAt };
        events.push({ kind: reportMap[userReport].kind, detail: reportMap[userReport].detail, at: eventAt });
      }
    }
    const visibleScene = sceneEvidence && Array.isArray(sceneEvidence.observations)
      ? sceneEvidence.observations.filter((item) => item && item.visible === true && !item.identityConflict).slice(0, 4)
      : [];
    if (visibleScene.length) {
      events.push({
        kind: "scene_evidence",
        detail: visibleScene.map((item) => clean(item.label, 60) + " [" + clean(item.id, 28) + "]").join("; ").slice(0, 180),
        at: eventAt
      });
    }
    next.events = events.filter((event) => event && typeof event.kind === "string" && typeof event.detail === "string").slice(-6);
    next.updatedAt = eventAt;
    next.revision += 1;
    return next;
  }

  function formatTaskWorldModelSummary(model, sceneEvidence, now) {
    const state = model && typeof model === "object" ? model : createTaskWorldModel();
    const clean = (value, max = 180) => typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max)
      : "";
    const lines = [
      "Task world model (session-local planning continuity; model notes are not proof):",
      "Goal: " + (clean(state.goal, 220) || "not established"),
      "Current state: " + (clean(state.currentState) || "unknown"),
      "Next intended action: " + (clean(state.intendedAction) || "not selected"),
      "Expected evidence: " + (clean(state.expectedEvidence) || "not specified"),
      "Constraints: " + ((Array.isArray(state.constraints) ? state.constraints : []).slice(0, 5).map((v) => clean(v, 140)).filter(Boolean).join("; ") || "none recorded"),
      "Uncertainties: " + ((Array.isArray(state.uncertainties) ? state.uncertainties : []).slice(0, 5).map((v) => clean(v, 140)).filter(Boolean).join("; ") || "none recorded"),
      "Last outcome: " + clean(state.lastOutcome && state.lastOutcome.kind, 64) + " — " + clean(state.lastOutcome && state.lastOutcome.detail, 200) +
        (state.lastOutcome && state.lastOutcome.source === "user_report" ? " (user report, not visual verification)" : "")
    ];
    const events = Array.isArray(state.events) ? state.events.slice(-4) : [];
    if (events.length) lines.push("Recent events: " + events.map((event) => clean(event.kind, 48) + ": " + clean(event.detail, 140)).join(" | "));
    if (sceneEvidence && Array.isArray(sceneEvidence.observations)) {
      const live = sceneEvidence.observations.filter((item) => item && item.visible === true && !item.identityConflict &&
        Number.isFinite(item.observedAt) && Number.isFinite(now) && now >= item.observedAt && now - item.observedAt <= 5_000).slice(0, 4);
      if (live.length) lines.push("Fresh scene candidates (model-reported, approximate): " + live.map((item) =>
        clean(item.id, 28) + "=" + clean(item.label, 64) + " (" + clean(item.evidence, 16) + ")"
      ).join("; "));
    }
    lines.push("Keep the goal and constraints stable unless evidence or the user's words change. Never silently promote a planned action to completion. Distinguish user report, observed change, guarded visual support, and unknown.");
    return lines.join("\n").slice(0, 3_400);
  }

  // M27: compare one matching scene candidate across two fresh frames before accepting a visible result.
  function classifyVisualVerification(rawReport, beforeModel, afterModel, now) {
    if (!rawReport || typeof rawReport !== "object") return null;
    const ambiguous = (reason, extra = {}) => ({
      status: "ambiguous",
      reason,
      targetId: typeof rawReport.target_id === "string" ? rawReport.target_id.slice(0, 28) : "",
      criterion: typeof rawReport.criterion === "string" ? rawReport.criterion.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 140) : "",
      ...extra
    });
    const targetId = typeof rawReport.target_id === "string" ? rawReport.target_id.trim() : "";
    const criterion = typeof rawReport.criterion === "string"
      ? rawReport.criterion.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 140)
      : "";
    const consequence = ["low", "moderate", "high"].includes(rawReport.consequence) ? rawReport.consequence : "";
    const evidence = rawReport.evidence === "direct" || rawReport.evidence === "inferred" ? rawReport.evidence : "unknown";
    const confidence = typeof rawReport.confidence === "number" && Number.isFinite(rawReport.confidence)
      ? rawReport.confidence : -1;
    if (!/^[A-Za-z0-9._-]{1,28}$/.test(targetId) || criterion.length < 4 || !consequence) {
      return ambiguous("The verification report is incomplete or malformed.");
    }
    if (rawReport.criterion_status === "unclear" || rawReport.change_observed === "unclear") {
      return ambiguous("The latest view does not clearly establish the requested condition.");
    }
    if (!beforeModel || !afterModel ||
        beforeModel.viewGeneration !== afterModel.viewGeneration ||
        !Number.isFinite(beforeModel.frameSequence) ||
        !Number.isFinite(afterModel.frameSequence) ||
        afterModel.frameSequence <= beforeModel.frameSequence) {
      return ambiguous("There is no fresh before/after frame pair from the same camera view.");
    }
    const priorList = Array.isArray(beforeModel.observations) ? beforeModel.observations : [];
    const currentList = Array.isArray(afterModel.observations) ? afterModel.observations : [];
    const prior = priorList.find((item) => item && item.id === targetId);
    const current = currentList.find((item) => item && item.id === targetId);
    const isFresh = (item, limit) => Boolean(item && Number.isFinite(item.observedAt) &&
      now >= item.observedAt && now - item.observedAt <= limit &&
      item.viewGeneration === afterModel.viewGeneration && item.visible === true && !item.identityConflict);
    if (!isFresh(prior, 7_000) || !isFresh(current, 5_000) ||
        !Number.isFinite(prior.frameSequence) || !Number.isFinite(current.frameSequence) ||
        current.frameSequence <= prior.frameSequence || current.frameSequence !== afterModel.frameSequence) {
      return ambiguous("The same target was not observed clearly in both a recent baseline and the latest frame.");
    }
    const normalizeLabel = (value) => String(value || "").normalize("NFKC")
      .toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!prior.label || normalizeLabel(prior.label) !== normalizeLabel(current.label)) {
      return ambiguous("The target label changed between frames, so identity continuity is uncertain.");
    }
    if (evidence !== "direct" || confidence < 0 || confidence > 1) {
      return ambiguous("Only direct, bounded visual evidence can support an automatic result.");
    }
    if (consequence === "high") {
      return ambiguous("A consequential outcome needs stronger independent confirmation than this camera comparison provides.", {
        confidence, evidence, consequence, beforeFrameSequence: prior.frameSequence, afterFrameSequence: current.frameSequence
      });
    }
    const threshold = consequence === "moderate" ? 0.93 : 0.82;
    if (confidence < threshold) {
      return ambiguous("The reported visual confidence is below the threshold for this consequence level.", {
        confidence, evidence, consequence, beforeFrameSequence: prior.frameSequence, afterFrameSequence: current.frameSequence
      });
    }
    if (rawReport.change_observed === "changed" && rawReport.criterion_status === "met") {
      return {
        status: "supported_success",
        reason: "Fresh matching frames support that the stated visible criterion was met after an observed change.",
        targetId, criterion, confidence, evidence, consequence,
        beforeFrameSequence: prior.frameSequence, afterFrameSequence: current.frameSequence
      };
    }
    if (rawReport.change_observed === "no_change" && rawReport.criterion_status === "not_met") {
      return {
        status: "supported_failure_or_no_change",
        reason: "Fresh matching frames support that the stated visible criterion remains unmet and no relevant change was observed.",
        targetId, criterion, confidence, evidence, consequence,
        beforeFrameSequence: prior.frameSequence, afterFrameSequence: current.frameSequence
      };
    }
    return ambiguous("The reported criterion and before/after change do not form a consistent, decisive result.", {
      confidence, evidence, consequence, beforeFrameSequence: prior.frameSequence, afterFrameSequence: current.frameSequence
    });
  }

  function formatVisualVerificationSummary(result) {
    if (!result || typeof result !== "object") return "";
    const summary = "Visual verification: " + result.status + ". " + result.reason +
      (result.criterion ? " Criterion: " + result.criterion + "." : "");
    return (summary + " This is a guarded model-reported camera comparison, not independent sensor proof or verification of hidden conditions.")
      .slice(0, 900);
  }

  // M26: explicit identity record for a user-tapped local image patch. This follows
  // the same patch in camera pixels only; it is not semantic identity or 3D tracking.
  function createPersistentSpatialTrack(trackId, targetKey, point, context, now) {
    return {
      trackId: String(trackId || "local-track").slice(0, 64),
      targetKey: String(targetKey || "").slice(0, 120),
      status: "anchored-by-user-tap",
      anchorType: "local-image-patch",
      identitySource: "user-tap",
      semanticIdentityVerified: false,
      worldLocked: false,
      confidence: null,
      evidenceFrames: 0,
      missedFrames: 0,
      reacquisitions: 0,
      createdAt: now,
      lastObservedAt: now,
      lastPoint: { x: Number(point && point.x) || 0, y: Number(point && point.y) || 0 },
      lastFrameSequence: Number.isFinite(context && context.frameSequence) ? context.frameSequence : 0,
      viewGeneration: Number.isFinite(context && context.viewGeneration) ? context.viewGeneration : 0,
      lostAt: 0
    };
  }

  function updatePersistentSpatialTrack(track, evidence) {
    if (!track || !evidence || typeof evidence !== "object") return track || null;
    const now = Number.isFinite(evidence.now) ? evidence.now : Date.now();
    const viewGeneration = Number.isFinite(evidence.viewGeneration) ? evidence.viewGeneration : track.viewGeneration;
    if (viewGeneration !== track.viewGeneration) {
      return { ...track, status: "invalidated", confidence: 0, lastObservedAt: now };
    }
    if (evidence.type === "match") {
      const score = typeof evidence.score === "number" && Number.isFinite(evidence.score)
        ? Math.max(0, Math.min(1, evidence.score)) : 0;
      return {
        ...track,
        status: evidence.reacquired === true ? "reacquired" : "visible",
        confidence: score,
        evidenceFrames: track.evidenceFrames + 1,
        missedFrames: 0,
        reacquisitions: track.reacquisitions + (evidence.reacquired === true ? 1 : 0),
        lastObservedAt: now,
        lastPoint: { x: Number(evidence.point && evidence.point.x) || 0, y: Number(evidence.point && evidence.point.y) || 0 },
        lastFrameSequence: Number.isFinite(evidence.frameSequence) ? evidence.frameSequence : track.lastFrameSequence,
        lostAt: 0
      };
    }
    if (evidence.type === "miss") {
      return {
        ...track,
        status: "reacquiring",
        confidence: typeof track.confidence === "number" ? Math.max(0, track.confidence * 0.7) : null,
        missedFrames: track.missedFrames + 1,
        lostAt: track.lostAt || now,
        lastObservedAt: now
      };
    }
    if (evidence.type === "lost") return { ...track, status: "lost", confidence: 0, lastObservedAt: now };
    return track;
  }

  function invalidateSceneEvidence(reason) {
    cameraViewGeneration += 1;
    sceneModel = { viewGeneration: cameraViewGeneration, updatedAt: 0, frameSequence: 0, observations: [], relations: [], staleInputRejected: false };
    persistentSpatialTrack = null;
    clearOverlay();
    return reason || "camera-view-changed";
  }

  function updateSceneModel(rawObservations, rawRelations) {
    sceneModel = mergeSceneModel(sceneModel, rawObservations, rawRelations, {
      frameSequence: lastSentCameraFrameSequence,
      sourceFrameAt: lastVideoSentAt,
      frameViewGeneration: lastSentCameraViewGeneration,
      viewGeneration: cameraViewGeneration
    }, Date.now());
    return formatSceneModelSummary(sceneModel, Date.now());
  }

  function visualTargetKey(guidance) {
    const value = guidance && typeof guidance.hint === "string" && guidance.hint.trim()
      ? guidance.hint
      : guidance && typeof guidance.label === "string" ? guidance.label : "";
    return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  function requestTargetSelection(guidance, message) {
    if (localTrackingActive) stopLocalTracking(false);
    const target = String((guidance && (guidance.hint || guidance.label)) || "the visible target").trim().slice(0, 38);
    pendingTrackingTargetKey = visualTargetKey(guidance);
    awaitingTargetSelection = true;
    focusMarker.hidden = true;
    focusMarker.style.left = "";
    focusMarker.style.top = "";
    delete focusMarker.dataset.tracking;
    clearMarkerButton.disabled = true;
    approxTag.hidden = false;
    approxTag.textContent = ("Tap " + target + " to track").slice(0, 72);
    setStatus(message || ("Tap the visible " + target + " in the camera so I can anchor the highlight to that spot. I will not guess its position."), "normal");
  }

  function showOverlay(args) {
    hideSafetyPauseNotice();
    const spatialElements = normalizeSpatialCues(args && args.spatial_cues);
    const explicitElements = args && Array.isArray(args.visual_elements) ? args.visual_elements : [];
    const visualElements = spatialElements.concat(explicitElements).slice(0, 8);
    updateSceneModel(args && args.scene_observations, args && args.scene_relations);
    const hasVisualGuide = renderVisualGuide(visualElements);
    if (args && args.await_user_selection === true) {
      clearOverlay();
      const requested = {
        label: typeof args.text_to_display === "string" ? args.text_to_display.trim().slice(0, 72) : "Target",
        hint: typeof args.target_hint === "string" ? args.target_hint.trim().slice(0, 120) : "",
        instruction: typeof args.instruction === "string" ? args.instruction.trim().slice(0, 220) : "",
        screenRegion: ["center", "upper-left", "upper-right", "lower-left", "lower-right"].includes(args.screen_region)
          ? args.screen_region : "center"
      };
      latestVisualGuidance = { ...requested, steps: [requested] };
      requestTargetSelection(requested, requested.instruction || ("Tap the exact " + (requested.hint || requested.label) + " in the camera view."));
      return;
    }

    const regions = ["center", "upper-left", "upper-right", "lower-left", "lower-right"];
    const region = regions.includes(args.screen_region) ? args.screen_region : "center";
    const label = typeof args.text_to_display === "string" ? args.text_to_display.trim().slice(0, 72) : "";
    const hint = typeof args.target_hint === "string" ? args.target_hint.trim().slice(0, 120) : "";
    const instruction = typeof args.instruction === "string" ? args.instruction.trim().slice(0, 220) : "";
    if (args.visual_only === true && hasVisualGuide) {
      if (localTrackingActive) stopLocalTracking(false);
      awaitingTargetSelection = false;
      pendingTrackingTargetKey = "";
      latestVisualGuidance = null;
      focusMarker.hidden = true;
      focusMarker.style.left = "";
      focusMarker.style.top = "";
      delete focusMarker.dataset.tracking;
      approxTag.hidden = true;
      clearMarkerButton.disabled = true;
      setStatus(instruction || label || "Follow the on-screen guide.", "normal");
      return;
    }
    if (!label && !instruction) return;

    const primary = { label: label || "Moina's focus", hint, instruction, screenRegion: region };
    const normalizedSteps = Array.isArray(args.steps) ? args.steps.slice(0, 5).map((step) => {
      if (!step || typeof step !== "object") return null;
      const stepLabel = typeof step.text_to_display === "string" ? step.text_to_display.trim().slice(0, 72) : "";
      const stepHint = typeof step.target_hint === "string" ? step.target_hint.trim().slice(0, 120) : "";
      const stepInstruction = typeof step.instruction === "string" ? step.instruction.trim().slice(0, 220) : "";
      const stepRegion = regions.includes(step.screen_region) ? step.screen_region : "center";
      if (!stepLabel && !stepInstruction) return null;
      return { label: stepLabel || "Guided step", hint: stepHint, instruction: stepInstruction, screenRegion: stepRegion };
    }).filter(Boolean) : [];
    const guidanceSteps = normalizedSteps.length > 1 ? normalizedSteps : [primary];
    const firstStep = guidanceSteps[0];
    latestVisualGuidance = { ...firstStep, steps: guidanceSteps };
    syncSpatialGuidance();

    const nextTargetKey = visualTargetKey(firstStep);
    const targetChanged = localTrackingActive && (!trackedTargetKey || !nextTargetKey || trackedTargetKey !== nextTargetKey);
    if (!localTrackingActive || targetChanged) {
      requestTargetSelection(firstStep,
        "Tap the visible " + (firstStep.hint || firstStep.label || "target") + " in the camera view. I will place the highlight only after I can track the tapped area.");
      return;
    }

    focusMarker.dataset.region = firstStep.screenRegion;
    focusLabel.textContent = firstStep.label;
    focusHint.textContent = firstStep.hint;
    focusInstruction.textContent = firstStep.instruction;
    focusMarker.hidden = false;
    approxTag.hidden = false;
    clearMarkerButton.disabled = false;
    approxTag.textContent = "Local visual tracking · not world-locked AR";
  }

  async function refreshAvailability(options = {}) {
    const sequence = ++availabilitySequence;
    try {
      const response = await fetch("/api/voice/status", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const result = await response.json();
      if (response.status === 401) {
        location.href = "/login";
        return { available: false, reason: "authentication_required", message: "Your account session expired. Sign in again." };
      }
      if (!response.ok || !result || typeof result.available !== "boolean") {
        throw new Error("Voice availability could not be checked.");
      }
      voiceAvailability = result;
      if (sequence !== availabilitySequence) return result;
      if (result.available) {
        setAvailability("Available · no AskMoina usage quota; provider limits may apply. Camera frames are reduced and sent about once per second.", "normal");
      } else {
        setAvailability("Voice unavailable right now. See the status above for the reason.", "error");
        if (result.message) setStatus(result.message, "error");
      }
      return result;
    } catch (_) {
      voiceAvailability = null;
      if (sequence === availabilitySequence) {
        setAvailability("Couldn't check capacity. Try again when your connection is stable.", "warning");
      }
      return null;
    }
  }

  async function refreshAvailabilityAfterRelease() {
    // No application-side concurrent-session reservation remains; do not retry a stale browser lock.
    return refreshAvailability();
  }

  function resetTranscript() {
    transcriptNode.replaceChildren();
    currentTranscriptNodes = { user: null, assistant: null };
    transcriptStarted = false;
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.id = "emptyTranscript";
    const p = document.createElement("p");
    p.textContent = "Tell Moina your goal in your own words.";
    const examples = document.createElement("small");
    examples.className = "empty-examples";
    examples.textContent = "Try: “Set this up” · “Compare these” · “Explain this”";
    empty.append(p, examples);
    transcriptNode.appendChild(empty);
  }

  function getTranscriptEntry(role) {
    if (!transcriptStarted) {
      const empty = transcriptNode.querySelector(".empty-state");
      if (empty) empty.remove();
      transcriptStarted = true;
    }
    if (!currentTranscriptNodes[role]) {
      const row = document.createElement("div");
      row.className = "transcript-entry " + (role === "user" ? "from-you" : "from-moina");
      const label = document.createElement("span");
      label.className = "transcript-label";
      label.textContent = role === "user" ? "YOU" : "MOINA";
      const body = document.createElement("p");
      body.className = "transcript-text";
      row.append(label, body);
      transcriptNode.appendChild(row);
      currentTranscriptNodes[role] = { row, body, text: "" };
    }
    return currentTranscriptNodes[role];
  }

  function updateTranscript(role, incomingText) {
    const text = String(incomingText || "").trim();
    if (!text) return;
    const entry = getTranscriptEntry(role);
    if (role === "user" && !entry.text) {
        responseCardRenderedForTurn = false;
      responseCardWasTranscriptFallback = false;
      transcriptFallbackSourceLength = 0;
      responseCardManuallyMinimizedForTurn = false;
    }
    const mergeTranscript = window.AskMoinaTranscript && window.AskMoinaTranscript.merge;
    const merged = typeof mergeTranscript === "function"
      ? mergeTranscript(entry.text, text)
      : (!entry.text || text.startsWith(entry.text) ? text : (text === entry.text || entry.text.endsWith(text) ? entry.text : entry.text + " " + text));
    if (merged === entry.text) return;
    entry.text = merged;
    entry.body.textContent = entry.text;
    transcriptNode.scrollTop = transcriptNode.scrollHeight;
    handleTranscriptAcknowledgement(role, entry.text);
    if (role === "assistant") ensureTranscriptFallbackCard(false);
  }

  function finalizeTurn() {
    currentTranscriptNodes = { user: null, assistant: null };
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function downsampleTo16k(input, sourceRate) {
    if (sourceRate === 16000) return input;
    const ratio = sourceRate / 16000;
    const length = Math.floor(input.length / ratio);
    const output = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const sourceIndex = i * ratio;
      const left = Math.floor(sourceIndex);
      const right = Math.min(left + 1, input.length - 1);
      const fraction = sourceIndex - left;
      output[i] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return output;
  }

  function floatToPcm16(input) {
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    return new Uint8Array(pcm.buffer);
  }

  function sendAudioChunk(input) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !setupReady || !audioContext) return;
    // Shed stale microphone callbacks while the socket is congested; never queue seconds of old audio.
    if (socket.bufferedAmount > 96 * 1024) return;
    const downsampled = downsampleTo16k(input, audioContext.sampleRate);
    if (!downsampled.length) return;
    const pcmBytes = floatToPcm16(downsampled);
    socket.send(JSON.stringify({
      realtime_input: {
        audio: { data: bytesToBase64(pcmBytes), mime_type: "audio/pcm;rate=16000" }
      }
    }));
  }

  function startAudioCapture() {
    if (!audioContext || !microphoneStream || processor) return;
    const audioTrack = microphoneStream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("No microphone track is available.");
    const audioOnly = new MediaStream([audioTrack]);
    microphoneSource = audioContext.createMediaStreamSource(audioOnly);
    const audioBufferSize = audioContext.sampleRate > 48000 ? 2048 : 1024;
    processor = audioContext.createScriptProcessor(audioBufferSize, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (!active || !setupReady || stopping) return;
      const samples = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;
      let crossings = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i];
        sumSquares += sample * sample;
        if (i > 0 && ((sample >= 0) !== (samples[i - 1] >= 0))) crossings += 1;
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, samples.length));
      const zeroCrossingRate = crossings / Math.max(1, samples.length - 1);
      const now = performance.now();
      // Calibrate the ambient noise floor on the first active frames after Live is ready.
      if (!micNoiseCalibrationUntil) {
        micNoiseFloor = Math.max(0.001, Math.min(0.04, rms));
        micNoiseCalibrationUntil = now + 500;
        micSpeechCandidateAt = 0;
        micSpeechGateActive = false;
      }
      if (now < micNoiseCalibrationUntil) {
        micNoiseFloor = Math.max(0.001, Math.min(0.04, micNoiseFloor * 0.92 + rms * 0.08));
        applyVoiceEdgeEnergy(0, "microphone");
        sendAudioChunk(samples);
        return;
      }
      // Require signal above the learned room-noise floor, speech-like crossings, and a sustained onset.
      const speechThreshold = Math.max(0.013, micNoiseFloor * 1.55);
      const speechLikeFrame = rms >= speechThreshold && zeroCrossingRate >= 0.008 && zeroCrossingRate <= 0.38;
      const speechGateBeforeFrame = micSpeechGateActive;
      if (speechLikeFrame) {
        if (!micSpeechCandidateAt) micSpeechCandidateAt = now;
        if (now - micSpeechCandidateAt >= 120) {
          if (!micSpeechGateActive) {
            micSpeechGateActive = true;
            // Keep the interface clean while the user talks; show processing immediately after speech ends.
          }
          lastMicVoiceAt = now;
        }
      } else {
        micSpeechCandidateAt = 0;
        if (!micSpeechGateActive) {
          micNoiseFloor = Math.max(0.001, Math.min(0.04, micNoiseFloor * 0.985 + rms * 0.015));
        }
      }
      if (micSpeechGateActive && speechLikeFrame) lastMicVoiceAt = now;
      if (micSpeechGateActive && now - lastMicVoiceAt > 240) {
        micSpeechGateActive = false;
        micSpeechCandidateAt = 0;
      }
      if (micSpeechGateActive && !speechGateBeforeFrame) {
            syncLiveSearchStatusVisibility();
      } else if (!micSpeechGateActive && speechGateBeforeFrame) {
        syncLiveSearchStatusVisibility();
      }
      if (micSpeechGateActive) {
        const rawVoiceLevel = Math.min(1, Math.max(0, (rms - speechThreshold * 0.85) / 0.075));
        const decayedVoiceLevel = microphoneVoiceEnergy * (speechLikeFrame ? 0.5 : 0.62);
        applyVoiceEdgeEnergy(Math.max(rawVoiceLevel, decayedVoiceLevel), "microphone");
        stage.classList.add("is-listening");
      } else {
        applyVoiceEdgeEnergy(0, "microphone");
        if (now - lastMicVoiceAt > 240) stage.classList.remove("is-listening");
      }
      // Audio always streams to Gemini. The local gate only controls visual feedback.
      // Sustained local speech may start a neutral acknowledgement; transcripts and tool events determine search-specific status.
      sendAudioChunk(samples);
    };
    microphoneSource.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
  }

  function decodePcm16(base64) {
    const binary = atob(base64);
    const samples = new Float32Array(Math.floor(binary.length / 2));
    for (let i = 0; i < samples.length; i += 1) {
      let value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
      if (value >= 0x8000) value -= 0x10000;
      samples[i] = value / (value < 0 ? 32768 : 32767);
    }
    return samples;
  }

  function stopPlayback() {
    for (const node of playbackNodes) {
      try { node.stop(); } catch (_) {}
      try { node.disconnect(); } catch (_) {}
    }
    playbackNodes.clear();
    if (playbackPulseFrame) window.cancelAnimationFrame(playbackPulseFrame);
    playbackPulseFrame = 0;
    assistantVoiceEnergy = 0;
    applyVoiceEdgeEnergy(0, "assistant");
    nextPlaybackTime = audioContext ? audioContext.currentTime : 0;
    stage.classList.remove("is-speaking");
  }

  function applyVoiceEdgeEnergy(level, source) {
    const normalized = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
    if (source === "microphone") microphoneVoiceEnergy = normalized;
    else assistantVoiceEnergy = normalized;
    const energy = Math.max(microphoneVoiceEnergy, assistantVoiceEnergy);
    stage.style.setProperty("--voice-energy", energy.toFixed(3));
    stage.style.setProperty("--voice-edge-width", (1.8 + energy * 4.8).toFixed(2) + "px");
    stage.style.setProperty("--voice-halo-width", (3.2 + energy * 8.2).toFixed(2) + "px");
    stage.style.setProperty("--voice-halo-opacity", (0.22 + energy * 0.62).toFixed(3));
    stage.style.setProperty("--voice-brightness", (0.96 + energy * 0.5).toFixed(3));
  }

  function getPlaybackAnalyser() {
    if (!audioContext) return null;
    if (playbackAnalyser && playbackAnalyser.context !== audioContext) {
      try { playbackAnalyser.disconnect(); } catch (_) {}
      playbackAnalyser = null;
      playbackAnalyserData = null;
    }
    if (!playbackAnalyser) {
      playbackAnalyser = audioContext.createAnalyser();
      playbackAnalyser.fftSize = 256;
      playbackAnalyser.smoothingTimeConstant = 0.16;
      playbackAnalyserData = new Uint8Array(playbackAnalyser.fftSize);
      playbackAnalyser.connect(audioContext.destination);
    }
    return playbackAnalyser;
  }

  function updatePlaybackPulse() {
    playbackPulseFrame = 0;
    if (!playbackAnalyser || !playbackAnalyserData || !audioContext || playbackNodes.size === 0) {
      assistantVoiceEnergy = 0;
      applyVoiceEdgeEnergy(0, "assistant");
      return;
    }
    playbackAnalyser.getByteTimeDomainData(playbackAnalyserData);
    let sumSquares = 0;
    for (let i = 0; i < playbackAnalyserData.length; i += 1) {
      const sample = (playbackAnalyserData[i] - 128) / 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, playbackAnalyserData.length));
    const rawVoiceLevel = Math.min(1, Math.max(0, (rms - 0.012) / 0.12));
    const decayedVoiceLevel = assistantVoiceEnergy * 0.48;
    applyVoiceEdgeEnergy(Math.max(rawVoiceLevel, decayedVoiceLevel), "assistant");
    playbackPulseFrame = window.requestAnimationFrame(updatePlaybackPulse);
  }

  function startPlaybackPulse() {
    if (!playbackPulseFrame) playbackPulseFrame = window.requestAnimationFrame(updatePlaybackPulse);
  }

  function playPcmAudio(base64, mimeType) {
    if (!audioContext || !base64) return;
    const match = String(mimeType || "").match(/rate=(\d+)/i);
    const sampleRate = match ? Number(match[1]) : 24000;
    const samples = decodePcm16(base64);
    if (!samples.length) return;
    const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(getPlaybackAnalyser());
    const startAt = Math.max(audioContext.currentTime + 0.015, nextPlaybackTime);
    source.start(startAt);
    nextPlaybackTime = startAt + buffer.duration;
    playbackNodes.add(source);
    stage.classList.add("is-speaking");
    startPlaybackPulse();
    source.addEventListener("ended", () => {
      playbackNodes.delete(source);
      try { source.disconnect(); } catch (_) {}
      if (audioContext && audioContext.currentTime >= nextPlaybackTime - 0.035) {
        stage.classList.remove("is-speaking");
      }
      if (playbackNodes.size === 0) {
        if (playbackPulseFrame) window.cancelAnimationFrame(playbackPulseFrame);
        playbackPulseFrame = 0;
        assistantVoiceEnergy = 0;
        applyVoiceEdgeEnergy(0, "assistant");
      }
    });
  }

  function measureCameraChangeScore() {
    if (!frameSampleContext || !video.videoWidth || !video.videoHeight) return 1;
    try {
      frameSampleContext.drawImage(video, 0, 0, frameSampleCanvas.width, frameSampleCanvas.height);
      const rgba = frameSampleContext.getImageData(0, 0, frameSampleCanvas.width, frameSampleCanvas.height).data;
      const sample = new Uint8Array(frameSampleCanvas.width * frameSampleCanvas.height);
      for (let i = 0, p = 0; i < sample.length; i += 1, p += 4) {
        const luminance = rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114;
        sample[i] = Math.min(15, Math.floor(luminance / 16));
      }
      if (!previousFrameSample || previousFrameSample.length !== sample.length) {
        previousFrameSample = sample;
        return 1;
      }
      let difference = 0;
      for (let i = 0; i < sample.length; i += 1) difference += Math.abs(sample[i] - previousFrameSample[i]);
      previousFrameSample = sample;
      return difference / (sample.length * 15);
    } catch (_) {
      previousFrameSample = null;
      return 1; // Sampling failure must preserve evidence by sending the frame.
    }
  }

  function shouldSuppressStableFrame(changeScore, elapsedMs, forceFresh) {
    return !forceFresh && Number.isFinite(changeScore) && Number.isFinite(elapsedMs) &&
      changeScore < 0.028 && elapsedMs < 2400;
  }

  function hasHighPriorityCameraDemand() {
    return Boolean(
      localTrackingActive || awaitingTargetSelection || latestVisualGuidance ||
      (Array.isArray(latestVisualGuideElements) && latestVisualGuideElements.length > 0) ||
      (taskWorldModel && taskWorldModel.goal) ||
      (realityLoopState && (realityLoopState.freshFrameRequired === true ||
        realityLoopState.mode === "awaiting_frame" || realityLoopState.camera === "resuming")) ||
      zoomLevel !== 1
    );
  }

  function reportFrameEfficiency(now) {
    if (!lastFrameEfficiencyReportAt) lastFrameEfficiencyReportAt = now;
    if (now - lastFrameEfficiencyReportAt < 30000) return;
    if (frameEfficiencyStats.sent || frameEfficiencyStats.suppressed) {
      console.info("[AskMoina] Adaptive camera sampling", JSON.stringify({
        sampleWindowMs: now - lastFrameEfficiencyReportAt,
        framesSent: frameEfficiencyStats.sent,
        stableFramesSuppressed: frameEfficiencyStats.suppressed,
        sentImageBase64Chars: frameEfficiencyStats.encodedChars,
        lastMotionScore: Number(frameEfficiencyStats.lastMotionScore.toFixed(3))
      }));
    }
    frameEfficiencyStats.sent = 0;
    frameEfficiencyStats.suppressed = 0;
    frameEfficiencyStats.encodedChars = 0;
    lastFrameEfficiencyReportAt = now;
  }

  function sendVideoFrame() {
    if (sendingVideo || !active || !setupReady || !socket || socket.readyState !== WebSocket.OPEN || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;
    const now = Date.now();
    if (now - lastVideoSentAt < 900) return;
    const changeScore = measureCameraChangeScore();
    frameEfficiencyStats.lastMotionScore = changeScore;
    const forceFresh = hasHighPriorityCameraDemand();
    const elapsedSinceSent = lastVideoSentAt ? now - lastVideoSentAt : Number.POSITIVE_INFINITY;
    if (lastVideoSentAt && shouldSuppressStableFrame(changeScore, elapsedSinceSent, forceFresh)) {
      frameEfficiencyStats.suppressed += 1;
      reportFrameEfficiency(now);
      return;
    }
    sendingVideo = true;
    try {
      const maxDimension = 768;
      const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
      let width = Math.max(1, Math.round(video.videoWidth * scale));
      let height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      let data = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        canvas.width = width;
        canvas.height = height;
        if (!nativeZoomSupported && zoomLevel > 1) {
        const sourceWidth = video.videoWidth / zoomLevel;
        const sourceHeight = video.videoHeight / zoomLevel;
        context.drawImage(video, (video.videoWidth - sourceWidth) / 2, (video.videoHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height);
      } else {
        context.drawImage(video, 0, 0, width, height);
      }
        const quality = [0.56, 0.46, 0.38, 0.30, 0.22][attempt];
        data = canvas.toDataURL("image/jpeg", quality).split(",")[1] || "";
        if (data.length <= 48_000) break;
        width = Math.max(1, Math.round(width * 0.88));
        height = Math.max(1, Math.round(height * 0.88));
      }
      if (!data || data.length > 48_000) {
        setStatus("This camera frame is too large to send safely. Move slightly farther back or steady the camera while AskMoina adjusts detail.");
        return;
      }
      // A stale camera frame is replaceable evidence. Skip it under backpressure rather than queueing old scenery.
      if (socket.bufferedAmount > 96 * 1024) return;
      socket.send(JSON.stringify({
        realtime_input: { video: { data, mime_type: "image/jpeg" } }
      }));
      lastVideoSentAt = Date.now();
      frameEfficiencyStats.sent += 1;
      frameEfficiencyStats.encodedChars += data.length;
      reportFrameEfficiency(lastVideoSentAt);
      recordRealityLoopEvent("frame_sent", { trackingActive: localTrackingActive });
      lastSentCameraFrameSequence += 1;
      lastSentCameraViewGeneration = cameraViewGeneration;
      setCameraState("Live · adaptive camera sampling", "live");
    } catch (_) {
      setStatus("Couldn't process a camera frame. Keep the camera view steady and try again.", "warning");
    } finally {
      sendingVideo = false;
    }
  }

  function startVideoFrames() {
    clearInterval(videoTimer);
    clearTimeout(firstVideoTimer);
    lastVideoSentAt = 0;
    previousFrameSample = null;
    lastFrameEfficiencyReportAt = Date.now();
    frameEfficiencyStats.sent = 0;
    frameEfficiencyStats.suppressed = 0;
    frameEfficiencyStats.encodedChars = 0;
    frameEfficiencyStats.lastMotionScore = 1;
    firstVideoTimer = window.setTimeout(sendVideoFrame, 250);
    videoTimer = window.setInterval(sendVideoFrame, 1000);
  }

  // WebXR takes ownership of the camera during immersive AR. Stop only the
  // video track so the existing microphone, WebSocket, and audio graph survive.
  function suspendCameraForSpatialAr() {
    if (!microphoneStream || !microphoneStream.getVideoTracks().some((track) => track.readyState === "live")) return false;
    if (videoTimer) window.clearInterval(videoTimer);
    if (firstVideoTimer) window.clearTimeout(firstVideoTimer);
    videoTimer = null;
    firstVideoTimer = null;
    invalidateSceneEvidence("spatial-ar-camera-handoff");
    microphoneStream.getVideoTracks().forEach((track) => {
      try { track.stop(); } catch (_) {}
    });
    video.pause();
    video.srcObject = null;
    stage.classList.remove("has-camera");
    cameraSuspendedForSpatialAr = true;
    hideStaleCameraOverlays();
    recordRealityLoopEvent("spatial_ar_start");
    setCameraState("Camera released to Spatial AR", "xr");
    setControls(active ? "End Co-Pilot" : "Start Co-Pilot", false);
    return true;
  }

  async function resumeCameraAfterSpatialAr(reason = "Spatial AR ended") {
    if (!cameraSuspendedForSpatialAr || cameraResumeInProgress) return;
    if (!active || !setupReady || stopping || !microphoneStream) {
      cameraSuspendedForSpatialAr = false;
      return;
    }

    recordRealityLoopEvent("spatial_ar_ended");
    cameraResumeInProgress = true;
    setStatus(reason + ". Restoring camera frames while live voice stays connected…");
    let cameraOnlyStream = null;
    let lastError = null;
    try {
      for (let attempt = 0; attempt < 3 && !cameraOnlyStream; attempt += 1) {
        if (!active || stopping || !microphoneStream) {
          cameraSuspendedForSpatialAr = false;
          return;
        }
        try {
          cameraOnlyStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
        }
      }

      const cameraTrack = cameraOnlyStream && cameraOnlyStream.getVideoTracks()[0];
      if (!cameraTrack) throw lastError || new Error("No camera track was returned.");
      if (!active || stopping || !microphoneStream) {
        cameraTrack.stop();
        return;
      }

      microphoneStream.getVideoTracks().forEach((track) => {
        try { microphoneStream.removeTrack(track); } catch (_) {}
        try { track.stop(); } catch (_) {}
      });
      microphoneStream.addTrack(cameraTrack);
      video.srcObject = microphoneStream;
      await video.play();
      cameraSuspendedForSpatialAr = false;
      recordRealityLoopEvent("camera_resumed");
      invalidateSceneEvidence("spatial-ar-camera-resume");
      initializeZoom();
      stage.classList.add("has-camera");
      setCameraState("Live · frames ~1/sec", "live");
      startVideoFrames();
      setControls("End Co-Pilot", false);
      setStatus(reason + ". Live voice and camera frames are back.");
    } catch (error) {
      if (cameraOnlyStream) cameraOnlyStream.getTracks().forEach((track) => track.stop());
      recordRealityLoopEvent("camera_error");
      hideStaleCameraOverlays();
      setCameraState("Camera paused", "idle");
      setStatus(reason + ". Voice is still connected, but the camera could not resume. End Co-Pilot and restart to restore live vision.", "warning");
    } finally {
      cameraResumeInProgress = false;
    }
  }

  function clearTimers() {
    if (setupTimer) window.clearTimeout(setupTimer);
    if (videoTimer) window.clearInterval(videoTimer);
    if (firstVideoTimer) window.clearTimeout(firstVideoTimer);
    setupTimer = null;
    videoTimer = null;
    firstVideoTimer = null;
  }

  function cleanupMedia() {
    cancelLiveSearchProgress();
    recordRealityLoopEvent("session_stopped");
    hideSafetyPauseNotice();
    setupReady = false;
    clearTimers();
    stage.classList.remove("is-listening", "is-speaking");
    lastMicVoiceAt = 0;
    stopPlayback();
    microphoneVoiceEnergy = 0;
    assistantVoiceEnergy = 0;
    applyVoiceEdgeEnergy(0, "microphone");
    if (playbackAnalyser) {
      try { playbackAnalyser.disconnect(); } catch (_) {}
      playbackAnalyser = null;
      playbackAnalyserData = null;
    }
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch (_) {}
      processor = null;
    }
    if (microphoneSource) {
      try { microphoneSource.disconnect(); } catch (_) {}
      microphoneSource = null;
    }
    if (silentGain) {
      try { silentGain.disconnect(); } catch (_) {}
      silentGain = null;
    }
    stopLocalTracking(false);
    sceneModel = { viewGeneration: ++cameraViewGeneration, updatedAt: 0, frameSequence: 0, observations: [], relations: [], staleInputRejected: false };
    persistentSpatialTrack = null;
    if (greetingTimer) window.clearTimeout(greetingTimer);
    greetingTimer = null;
    greetingTurnPending = false;
    if (microphoneStream) {
      microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
    }
    microphoneMuted = false;
    cameraSuspendedForSpatialAr = false;
    cameraResumeInProgress = false;
    zoomLevel = 1;
    nativeZoomSupported = false;
    video.style.transform = "";
    zoomLabel.textContent = "1×";
    zoomSlider.value = "1";
    if (audioContext) {
      const previous = audioContext;
      audioContext = null;
      const waitForDisconnectTone = Math.max(0, disconnectToneUntil - performance.now());
      if (waitForDisconnectTone > 0) {
        window.setTimeout(() => { previous.close().catch(() => {}); }, waitForDisconnectTone);
        disconnectToneUntil = 0;
      } else {
        previous.close().catch(() => {});
      }
    }
    const livePreviewTrack = previewStream && previewStream.getVideoTracks().find((track) => track.readyState === "live");
    if (livePreviewTrack) {
      video.srcObject = previewStream;
      stage.classList.add("has-camera", "pre-start");
      void video.play().catch(() => {});
    } else {
      video.srcObject = null;
      stage.classList.remove("has-camera");
    }
    setCameraState(livePreviewTrack ? "Camera preview" : "Camera paused", livePreviewTrack ? "live" : "idle");
  }

  function stopCopilot(userInitiated, statusMessage, statusKind, silentDisconnect = false) {
    lastSessionEndedAt = Date.now();
    const wasConnected = active && setupReady;
    if (wasConnected) recoveryPreviewClear = true;
    if (wasConnected && !silentDisconnect) playDisconnectSound();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (userInitiated) {
      automaticReconnectAttempts = 0;
      isAutomaticRetry = false;
    }
    stopping = true;
    const oldSocket = socket;
    stopRelayKeepalive(oldSocket);
    socket = null;
    if (oldSocket && oldSocket.readyState === WebSocket.OPEN) {
      try { oldSocket.close(1000, "Client disconnected"); } catch (_) {}
    } else if (oldSocket && oldSocket.readyState === WebSocket.CONNECTING) {
      try { oldSocket.close(); } catch (_) {}
    }
    cleanupMedia();
    starting = false;
    active = false;
    stopping = false;
    stage.classList.add("pre-start");
    stage.classList.remove("is-listening", "is-speaking", "is-connecting");
    lastMicVoiceAt = 0;
    setControls(statusMessage && (statusKind === "error" || statusKind === "warning") ? "Try again" : "Start Co-Pilot", false);
    setConnectionState("READY", "ready");
    clearOverlay();
    if (statusKind !== "error") hideConnectionNotice();
    if (statusMessage) setStatus(statusMessage, statusKind);
    else if (userInitiated) setStatus("Co-Pilot paused. Start again whenever you're ready.");
    void refreshAvailabilityAfterRelease();
    void prepareCameraPreview();
  }

  function getToolCalls(message) {
    const call = message.tool_call || message.toolCall;
    if (!call || typeof call !== "object") return [];
    const calls = call.function_calls || call.functionCalls;
    return Array.isArray(calls) ? calls : [];
  }

  const RESPONSE_CARD_CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

  function responseCardCleanText(value, maxLength) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text || text.length > maxLength || RESPONSE_CARD_CONTROL_CHARACTERS.test(text)) return null;
    return text;
  }

  function responseCardOptionalText(value, maxLength) {
    if (value === undefined) return { ok: true };
    const text = responseCardCleanText(value, maxLength);
    return text === null ? { ok: false } : { ok: true, value: text };
  }

  function responseCardExactKeys(value, allowed) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).every((key) => allowed.includes(key)));
  }

  // Re-check the bounded server contract before building DOM nodes. Model content is always text, never markup.
  function normalizeResponseCardPayload(value) {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 8000) return null;
      const title = responseCardCleanText(value.title, 80);
      const summary = responseCardOptionalText(value.summary, 180);
      if (!title || !summary.ok) return null;
      const base = { title, ...(summary.value ? { summary: summary.value } : {}) };

      if (value.type === "steps") {
        if (!responseCardExactKeys(value, ["type", "title", "summary", "steps"]) ||
            !Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 5) return null;
        const steps = [];
        for (const item of value.steps) {
          if (!responseCardExactKeys(item, ["label", "instruction"])) return null;
          const label = responseCardCleanText(item.label, 60);
          const instruction = responseCardCleanText(item.instruction, 180);
          if (!label || !instruction) return null;
          steps.push({ label, instruction });
        }
        return { type: "steps", ...base, steps };
      }

      if (value.type === "key_details") {
        if (!responseCardExactKeys(value, ["type", "title", "summary", "details", "sources"]) ||
            !Array.isArray(value.details) || value.details.length < 1 || value.details.length > 10) return null;
        const details = [];
        for (const item of value.details) {
          if (!responseCardExactKeys(item, ["label", "value", "unit"])) return null;
          const label = responseCardCleanText(item.label, 60);
          const detailValue = responseCardCleanText(item.value, 180);
          const unit = responseCardOptionalText(item.unit, 32);
          if (!label || !detailValue || !unit.ok) return null;
          details.push({ label, value: detailValue, ...(unit.value ? { unit: unit.value } : {}) });
        }
        const sources = [];
        // Optional source links are best-effort; safely omit invalid links, not the answer rows.
        if (Array.isArray(value.sources)) {
          for (const item of value.sources.slice(0, 4)) {
            if (!responseCardExactKeys(item, ["title", "url"])) continue;
            const sourceTitle = responseCardCleanText(item.title, 100);
            const sourceUrl = responseCardCleanText(item.url, 500);
            if (!sourceTitle || !sourceUrl) continue;
            let parsedUrl;
            try { parsedUrl = new URL(sourceUrl); } catch (_) { continue; }
            if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) continue;
            sources.push({ title: sourceTitle, url: parsedUrl.href });
          }
        }
        return { type: "key_details", ...base, details, ...(sources.length ? { sources } : {}) };
      }

      if (value.type === "comparison") {
        if (!responseCardExactKeys(value, ["type", "title", "summary", "options", "takeaway"]) ||
            !Array.isArray(value.options) || value.options.length < 2 || value.options.length > 4) return null;
        const takeaway = responseCardOptionalText(value.takeaway, 180);
        if (!takeaway.ok) return null;
        const options = [];
        for (const option of value.options) {
          if (!responseCardExactKeys(option, ["name", "attributes"]) ||
              !Array.isArray(option.attributes) || option.attributes.length < 1 || option.attributes.length > 8) return null;
          const name = responseCardCleanText(option.name, 70);
          if (!name) return null;
          const attributes = [];
          for (const attribute of option.attributes) {
            if (!responseCardExactKeys(attribute, ["label", "value"])) return null;
            const label = responseCardCleanText(attribute.label, 50);
            const attributeValue = responseCardCleanText(attribute.value, 120);
            if (!label || !attributeValue) return null;
            attributes.push({ label, value: attributeValue });
          }
          options.push({ name, attributes });
        }
        return { type: "comparison", ...base, options, ...(takeaway.value ? { takeaway: takeaway.value } : {}) };
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function responseCardPrettyLabel(key) {
    const known = {
      steps: "Steps", details: "Details", options: "Options", attributes: "Attributes",
      label: "Label", instruction: "Instruction", value: "Value", unit: "Unit",
      name: "Option", takeaway: "Takeaway", summary: "Summary"
    };
    if (known[key]) return known[key];
    return String(key).replace(/_/g, " ").replace(/(^| )\w/g, (match) => match.toUpperCase());
  }

  function appendResponseCardValue(parent, label, value, depth = 0) {
    if (depth > 4) return;
    const wrapper = document.createElement("div");
    wrapper.className = "response-card-field";
    const labelNode = document.createElement("span");
    labelNode.className = "response-card-field-label";
    labelNode.textContent = responseCardPrettyLabel(label);
    wrapper.appendChild(labelNode);

    if (Array.isArray(value)) {
      const group = document.createElement("div");
      group.className = "response-card-group";
      value.slice(0, 10).forEach((item, index) => {
        const itemNode = document.createElement("div");
        itemNode.className = "response-card-item";
        if (item && typeof item === "object" && !Array.isArray(item)) {
          for (const [key, child] of Object.entries(item)) appendResponseCardValue(itemNode, key, child, depth + 1);
        } else if (typeof item === "string") {
          itemNode.textContent = item;
        } else {
          itemNode.textContent = "Item " + String(index + 1);
        }
        group.appendChild(itemNode);
      });
      wrapper.appendChild(group);
    } else if (value && typeof value === "object") {
      const group = document.createElement("div");
      group.className = "response-card-group";
      for (const [key, child] of Object.entries(value)) appendResponseCardValue(group, key, child, depth + 1);
      wrapper.appendChild(group);
    } else {
      const valueNode = document.createElement("span");
      valueNode.className = "response-card-field-value";
      valueNode.textContent = typeof value === "string" ? value : "";
      wrapper.appendChild(valueNode);
    }
    parent.appendChild(wrapper);
  }

  function createCardNode(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function renderGroundedDetails(card) {
    const list = createCardNode("ol", "response-card-ranking-list");
    list.setAttribute("aria-label", "Answer details");
    card.details.forEach((item, index) => {
      const row = createCardNode("li", "response-card-ranking-row");
      const check = createCardNode("span", "response-card-row-check", "✓");
      check.setAttribute("aria-hidden", "true");
      const match = item.label.match(/^\s*(\d{1,2})[.)\s:—-]+/);
      const rank = match ? match[1] : String(index + 1);
      const rankNode = createCardNode("span", "response-card-row-index", rank.padStart(2, "0"));
      rankNode.setAttribute("aria-label", "Rank " + rank);
      const main = createCardNode("div", "response-card-row-main");
      const label = match ? item.label.replace(/^\s*\d{1,2}[.)\s:—-]+/, "").trim() : item.label;
      main.appendChild(createCardNode("h3", "response-card-row-label", label));
      const statText = [item.value, item.unit].filter(Boolean).join(" ");
      main.appendChild(createCardNode("p", "response-card-row-value", statText));
      row.append(check, rankNode, main);
      list.appendChild(row);
    });
    responseCardContent.appendChild(list);
    if (card.sources && card.sources.length) {
      const sources = createCardNode("section", "response-card-sources");
      sources.appendChild(createCardNode("h3", "response-card-sources-title", "Sources"));
      const sourceList = createCardNode("ul", "response-card-source-list");
      for (const source of card.sources) {
        const item = createCardNode("li", "response-card-source-item");
        const link = createCardNode("a", "response-card-source-link", source.title);
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.appendChild(createCardNode("span", "response-card-source-arrow", "↗"));
        item.appendChild(link);
        sourceList.appendChild(item);
      }
      sources.appendChild(sourceList);
      responseCardContent.appendChild(sources);
    }
  }

  function renderStepsCard(card) {
    const list = createCardNode("ol", "response-card-steps-list");
    card.steps.forEach((step, index) => {
      const row = createCardNode("li", "response-card-step-row");
      row.appendChild(createCardNode("span", "response-card-step-index", String(index + 1).padStart(2, "0")));
      const main = createCardNode("div", "response-card-step-main");
      main.appendChild(createCardNode("h3", "response-card-step-label", step.label));
      main.appendChild(createCardNode("p", "response-card-step-instruction", step.instruction));
      row.appendChild(main);
      list.appendChild(row);
    });
    responseCardContent.appendChild(list);
  }

  function renderComparisonCard(card) {
    const grid = createCardNode("div", "response-card-comparison-grid");
    for (const option of card.options) {
      const panel = createCardNode("section", "response-card-option");
      panel.appendChild(createCardNode("h3", "response-card-option-title", option.name));
      for (const attribute of option.attributes) {
        const row = createCardNode("div", "response-card-option-attribute");
        row.appendChild(createCardNode("span", "response-card-option-label", attribute.label));
        row.appendChild(createCardNode("span", "response-card-option-value", attribute.value));
        panel.appendChild(row);
      }
      grid.appendChild(panel);
    }
    responseCardContent.appendChild(grid);
    if (card.takeaway) responseCardContent.appendChild(createCardNode("p", "response-card-takeaway", card.takeaway));
  }

  function setResponseCardExpanded(expanded) {
    responseCardExpanded = Boolean(expanded);
    if (responseCardDetails) responseCardDetails.hidden = !responseCardExpanded;
    if (responseCardCollapseButton) {
      responseCardCollapseButton.setAttribute("aria-expanded", String(responseCardExpanded));
      responseCardCollapseButton.setAttribute("aria-label", responseCardExpanded ? "Collapse card details" : "Expand card details");
      responseCardCollapseButton.title = responseCardExpanded ? "Collapse card" : "Expand card";
      responseCardCollapseButton.textContent = responseCardExpanded ? "−" : "+";
    }
  }

  function minimizeResponseCard() {
    if (!responseCardTray || responseCardTray.hidden) return;
    // Minimize only the visual sheet. Do not pause, clear, or restart live audio.
    responseCardManuallyMinimizedForTurn = true;
    responseCardTray.hidden = true;
    if (stage) stage.classList.remove("has-response-card");
    if (responseCardRestoreButton) responseCardRestoreButton.hidden = false;
  }

  function restoreResponseCard() {
    if (!responseCardTray) return;
    responseCardManuallyMinimizedForTurn = false;
    responseCardTray.hidden = false;
    if (stage) stage.classList.add("has-response-card");
    if (responseCardRestoreButton) responseCardRestoreButton.hidden = true;
  }

  function dismissResponseCard() {
    if (!responseCardTray) return;
    responseCardManuallyMinimizedForTurn = false;
    responseCardWasTranscriptFallback = false;
    transcriptFallbackSourceLength = 0;
    responseCardTray.hidden = true;
    if (responseCardRestoreButton) responseCardRestoreButton.hidden = true;
    if (responseCardContent) responseCardContent.replaceChildren();
    if (responseCardSummary) {
      responseCardSummary.textContent = "";
      responseCardSummary.hidden = true;
    }
    if (stage) stage.classList.remove("has-response-card");
    setResponseCardExpanded(true);
  }

  function createTranscriptFallbackCard(userText, assistantText) {
    const answer = String(assistantText || "").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    if (!answer) return null;
    const prompt = String(userText || "").replace(/\s+/g, " ").trim();
    // The opening greeting has no user request to answer; keep the camera clean until the first question.
    if (!prompt) return null;
    if (/^(?:hi|hello|hey|yo|thanks|thank you|ok|okay|sure|got it|good morning|good evening|good night|bye)[.!?\s]*$/i.test(prompt) && answer.length < 180) return null;
    const title = ("Answer · " + prompt).slice(0, 80);
    const sentenceMatch = answer.match(/^.{1,180}?(?:[.!?](?=\s|$)|$)/);
    const firstSentence = (sentenceMatch ? sentenceMatch[0] : answer.slice(0, 180)).trim().slice(0, 180);
    const sentences = answer.split(/(?<=[.!?])\s+|\s+[•·]\s+/).map((item) => item.trim()).filter(Boolean);
    const chunks = [];
    for (const sentence of (sentences.length ? sentences : [answer])) {
      let rest = sentence;
      while (rest.length > 180) {
        let cut = rest.lastIndexOf(" ", 180);
        if (cut < 90) cut = 180;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) chunks.push(rest);
    }
    const details = chunks.slice(0, 10).map((value, index) => ({ label: index === 0 ? "Answer" : "Key point " + (index + 1), value: value.slice(0, 180) }));
    return normalizeResponseCardPayload({ type: "key_details", title: title || "Moina's answer", summary: firstSentence || answer.slice(0, 180), details: details.length ? details : [{ label: "Answer", value: answer.slice(0, 180) }] });
  }

  function ensureTranscriptFallbackCard(final = false) {
    const userText = currentTranscriptNodes.user && currentTranscriptNodes.user.text || "";
    const assistantText = currentTranscriptNodes.assistant && currentTranscriptNodes.assistant.text || "";
    if (!userText.trim() || !assistantText.trim()) return false;
    if (LIVE_SEARCH_PROGRESS_SPEECH.test(assistantText.trim()) && assistantText.trim().length < 180) return false;
    if (assistantText.trim().length < 180 &&
        /\b(?:checking|searching|looking up|finding sources|pulling together|lining up|wrapping up|preparing your answer|getting the details ready|making the answer card|organizing the answer)\b/i.test(assistantText) &&
        !/\b(?:the answer is|in short|it means|you can|you should|the result|the main point)\b/i.test(assistantText)) return false;
    if (liveSearchActive && !liveSearchLookupCompleted && !liveSearchFinishing) return false;
    if (protectGroundedListForTurn && lastGroundedRankedListCard && responseCardRenderedForTurn) return true;
    if (pendingResponseCards.some((item) => item && isGroundedRankedListCard(item.args))) return false;
    if (responseCardManuallyMinimizedForTurn) return true;
    if (responseCardRenderedForTurn && !responseCardWasTranscriptFallback) return true;
    const answer = assistantText.replace(/[\\t\\r\\n]+/g, " ").replace(/\\s+/g, " ").trim();
    if (!final && answer.length < 55) return false;
    if (responseCardWasTranscriptFallback && !final && answer.length - transcriptFallbackSourceLength < 45) return true;
    const fallbackCard = createTranscriptFallbackCard(userText, answer);
    if (!fallbackCard) return false;
    const rendered = renderResponseCard(fallbackCard, true);
    if (rendered) {
      responseCardWasTranscriptFallback = true;
      transcriptFallbackSourceLength = answer.length;
    }
    return rendered;
  }

  function finishLiveSearchAfterCardShown() {
    if (!responseCardTray || responseCardTray.hidden) return false;
    if (!liveSearchActive && !liveSearchFinishing) return true;
    if (liveSearchWatchdogTimer) window.clearTimeout(liveSearchWatchdogTimer);
    if (liveSearchProgressInterval) window.clearInterval(liveSearchProgressInterval);
    if (liveSearchCompletionTimer) window.clearTimeout(liveSearchCompletionTimer);
    liveSearchWatchdogTimer = null;
    liveSearchProgressInterval = null;
    liveSearchCompletionTimer = null;
    liveSearchActive = false;
    liveSearchFinishing = false;
    liveSearchLookupCompleted = false;
    if (liveSearchStatus) {
      liveSearchStatus.hidden = true;
      liveSearchStatus.classList.remove("is-complete");
    }
    if (transcriptNode) transcriptNode.classList.remove("is-searching");
    return true;
  }

  function renderResponseCard(value, force = false) {
    let card = normalizeResponseCardPayload(value);
    if (!card || !responseCardTray || !responseCardContent || !responseCardTitle || !responseCardType) return false;
    if (!force && protectGroundedListForTurn && lastGroundedRankedListCard && card.type === "key_details") {
      const existingGroundedCardIsVisible = !responseCardTray.hidden &&
        responseCardTitle.textContent === lastGroundedRankedListCard.title && !responseCardWasTranscriptFallback;
      if (existingGroundedCardIsVisible) {
        responseCardRenderedForTurn = true;
        finishLiveSearchAfterCardShown();
        return true;
      }
      // A protection flag must never suppress the first real render. Prefer the authoritative grounded list.
      card = normalizeResponseCardPayload(lastGroundedRankedListCard) || card;
    }
    responseCardRenderedForTurn = true;
    responseCardWasTranscriptFallback = false;

    responseCardType.textContent = card.type === "key_details" ? "A GROUNDED ANSWER" :
      card.type === "steps" ? "YOUR GUIDE" : "SIDE-BY-SIDE";
    responseCardTitle.textContent = card.title;
    if (responseCardSummary) {
      responseCardSummary.textContent = card.summary || "";
      responseCardSummary.hidden = !card.summary;
    }
    responseCardContent.replaceChildren();
    if (card.type === "key_details") renderGroundedDetails(card);
    else if (card.type === "steps") renderStepsCard(card);
    else renderComparisonCard(card);
    if (responseCardStatus) {
      responseCardStatus.textContent = card.type === "key_details"
        ? (card.sources && card.sources.length ? "SOURCE LINKS INCLUDED · Structured answer, not a task checklist." : "STRUCTURED ANSWER · Review important details.")
        : "REFERENCE ONLY · No actions marked complete.";
    }
    responseCardTray.hidden = responseCardManuallyMinimizedForTurn;
    if (stage) stage.classList.toggle("has-response-card", !responseCardManuallyMinimizedForTurn);
    if (responseCardRestoreButton) responseCardRestoreButton.hidden = !responseCardManuallyMinimizedForTurn;
    setResponseCardExpanded(true);
    if (!responseCardTray.hidden) finishLiveSearchAfterCardShown();
    return true;
  }

  function handleToolCalls(message, hasSearchCallOnThisMessage = false) {
    const responses = [];
    for (const call of getToolCalls(message)) {
      if (!call || typeof call !== "object") continue;
      if (call.name === "search_current_web") continue;
      if (call.name === "display_response_card") {
        const id = typeof call.id === "string" ? call.id : "";
        // Make the answer sheet visible before dismissing the loader.
        const rendered = renderResponseCard(call.args);
            if (liveSearchActive && !liveSearchFinishing) completeLiveSearchProgress();
        if (id) {
          responses.push({
            id,
            name: "display_response_card",
            response: {
              result: rendered
                ? "The complete designed response card is now visible as a full-screen answer sheet. Continue speaking the complete natural response aloud: explain the answer, every useful step, what to look for, and relevant safety limits. A card never replaces the spoken explanation or proves that an action was completed."
                : "The response-card payload could not be rendered by the client. Continue speaking the full natural response and do not claim a card is visible."
            }
          });
        }
        continue;
      }
      if (call.name !== "display_screen_overlay") continue;
      const args = call.args && typeof call.args === "object" ? call.args : {};
      const rawTaskState = args.task_world_state && typeof args.task_world_state === "object" ? args.task_world_state : {};
      const safety = assessSafetyAndUncertainty({
        taskGoal: rawTaskState.task_goal || taskWorldModel.goal,
        currentState: rawTaskState.current_state,
        instruction: args.instruction,
        label: args.text_to_display,
        targetHint: args.target_hint,
        uncertainty: Array.isArray(rawTaskState.uncertainties) ? rawTaskState.uncertainties.join("; ") : "",
        safetyAssessment: args.safety_assessment
      });
      const loopBlocksVisuals = realityLoopBlocksVisualUpdate(realityLoopState);
      const beforeSceneModel = sceneModel;
      if (safety.blocksVisuals) {
        clearOverlay();
        invalidateSceneEvidence("m31-safety-pause");
        showSafetyPauseNotice(safety);
        setStatus(safety.notice || "Safety pause: confirm the important facts before acting.", "warning");
      } else if (loopBlocksVisuals) {
        hideStaleCameraOverlays();
        hideSafetyPauseNotice();
        setStatus(realityLoopState.spatialAr === "active"
          ? "Camera analysis is paused in Spatial AR. Exit AR before asking Moina to inspect the live scene."
          : "Waiting for a fresh camera frame before drawing guidance.", "warning");
      } else {
        showOverlay(args);
      }
      const verification = safety.blocksVisuals || loopBlocksVisuals
        ? null
        : classifyVisualVerification(args.visual_verification, beforeSceneModel, sceneModel, Date.now());
      taskWorldModel = mergeTaskWorldModel(taskWorldModel, args.task_world_state, verification, sceneModel, Date.now());
      const id = typeof call.id === "string" ? call.id : "";
      if (id) {
        const sceneSummary = formatSceneModelSummary(sceneModel, Date.now());
        const verificationSummary = formatVisualVerificationSummary(verification);
        const taskSummary = formatTaskWorldModelSummary(taskWorldModel, sceneModel, Date.now());
        const safetySummary = formatSafetyAssessmentSummary(safety);
        const realitySummary = formatRealityLoopSummary(realityLoopState);
        responses.push({
          id,
          name: "display_screen_overlay",
          response: {
            result: (safety.blocksVisuals
              ? "M31 safety gate blocked the on-screen drawing and cleared stale overlays. No hazardous physical action was executed.\n\n"
              : (loopBlocksVisuals
                ? "M32 reality-loop gate withheld camera-dependent overlays because the current view is stale or unavailable.\n\n"
                : "The on-screen target prompt or approximate overlay was handled by the client.\n\n")) + sceneSummary +
              (verificationSummary ? "\n\n" + verificationSummary : "") +
              "\n\n" + taskSummary + "\n\n" + safetySummary + "\n\n" + realitySummary
          }
        });
      }
    }
    if (responses.length && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ tool_response: { function_responses: responses } }));
    }
  }

  async function handleServerMessage(raw, sessionSocket) {
    let message;
    try {
      let payload;
      if (typeof raw === "string") payload = raw;
      else if (typeof Blob !== "undefined" && raw instanceof Blob) payload = await raw.text();
      else if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) payload = new TextDecoder().decode(raw);
      else throw new TypeError("Unsupported WebSocket message");
      message = JSON.parse(payload);
      if (!message || typeof message !== "object" || Array.isArray(message)) throw new TypeError("Unexpected message shape");
    } catch (_) {
      if (socket === sessionSocket) stopCopilot(false, "The voice service sent a response this browser could not read. Please restart the Co-Pilot.", "error");
      return;
    }
    if (socket !== sessionSocket) return;

    if (message.grounded_response_card && typeof message.grounded_response_card === "object") {
      const fallbackCard = normalizeResponseCardPayload(message.grounded_response_card);
      if (fallbackCard && fallbackCard.type === "key_details") {
        if (isGroundedRankedListCard(fallbackCard)) {
          lastGroundedRankedListCard = fallbackCard;
          protectGroundedListForTurn = true;
        }
        if (liveSearchActive) {
          if (liveSearchTitle) liveSearchTitle.textContent = "Building your answer";
          if (liveSearchMessage) liveSearchMessage.textContent = "Grounded results found · designing your list";
          // The grounded card is complete server-side. Put it on screen immediately.
          renderResponseCard(fallbackCard, true);
          if (!liveSearchFinishing) completeLiveSearchProgress();
        } else {
          renderResponseCard(fallbackCard, true);
        }
      }
      return;
    }

    if (message.live_search_status && message.live_search_status.state === "started") {
      startLiveSearchProgress();
      return;
    }
    if (message.live_search_status && message.live_search_status.state === "lookup_complete") {
      liveSearchLookupCompleted = true;
      if (liveSearchActive && !liveSearchFinishing) {
        if (liveSearchTitle) liveSearchTitle.textContent = "Building your answer";
        if (liveSearchMessage) liveSearchMessage.textContent = "Organizing the response and source links";
      }
      return;
    }

    if (message.connection_status && message.connection_status.state === "recovering") {
      setStatus(message.connection_status.message || "The last reply was not audible. Retrying it once.", "normal");
      return;
    }
    if (message.connection_status && message.connection_status.state === "recovered") {
      setStatus(message.connection_status.message || "Voice audio is flowing again.", "normal");
      return;
    }
    if (message.connection_status && message.connection_status.state === "resuming") {
      setConnectionState("RECONNECTING", "connecting");
      setStatus(message.connection_status.message || "Refreshing the live connection while keeping your conversation…", "normal");
      return;
    }
    if (message.connection_status && message.connection_status.state === "resumed") {
      hideConnectionNotice(true);
      setConnectionState("LIVE", "live");
      setStatus(message.connection_status.message || "Back live. Your conversation is continuing.", "normal");
      return;
    }
    if (message.connection_status && message.connection_status.state === "ended") {
      if (liveSearchActive) cancelLiveSearchProgress();
      stopCopilot(false, message.connection_status.message || "The live session ended. Start again to continue.", "warning");
      return;
    }

    if (message.setup_complete || message.setupComplete) {
      setupReady = true;
      active = true;
      recordRealityLoopEvent("voice_ready");
      starting = false;
      if (setupTimer) window.clearTimeout(setupTimer);
      setupTimer = null;
      setControls("End Co-Pilot", false);
      setConnectionState("LIVE", "live");
      setStatus("Connected. Tell Moina what you want to do in your own words.");
      setAvailability("Camera frames stream at up to 768 px around once per second; audio is live.", "normal");
      setCameraState("Live · frames ~1/sec", "live");
      hideConnectionNotice(true);
      automaticReconnectAttempts = 0;
      playConnectionChime();
      greetingTurnPending = true;
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ initial_greeting: true }));
      if (greetingTimer) window.clearTimeout(greetingTimer);
      greetingTimer = window.setTimeout(() => beginListeningAfterGreeting(), 10_000);
      startVideoFrames();
      return;
    }

    const messageToolCalls = getToolCalls(message);
    const hasSearchCallOnThisMessage = messageToolCalls.some((call) => call && call.name === "search_current_web");
    if (hasSearchCallOnThisMessage) startLiveSearchProgress();

    const transcriptionCandidates = [
      ["user", message.input_transcription],
      ["assistant", message.output_transcription],
      ["user", message.inputTranscription],
      ["assistant", message.outputTranscription]
    ];
    for (const [role, item] of transcriptionCandidates) {
      if (item && typeof item.text === "string") updateTranscript(role, item.text);
    }
    const serverContent = message.server_content || message.serverContent;
    if (serverContent) {
      const interimUserTranscription = serverContent.interim_input_transcription || serverContent.interimInputTranscription;
      if (interimUserTranscription && typeof interimUserTranscription.text === "string") {
        handleTranscriptAcknowledgement("user", interimUserTranscription.text);
      }
      if (serverContent.input_transcription && typeof serverContent.input_transcription.text === "string") updateTranscript("user", serverContent.input_transcription.text);
      if (serverContent.output_transcription && typeof serverContent.output_transcription.text === "string") updateTranscript("assistant", serverContent.output_transcription.text);
      const wasInterrupted = serverContent.interrupted === true;
      if (wasInterrupted) {
        if (liveSearchActive) cancelLiveSearchProgress();
        stopPlayback();
        setStatus("Listening — go ahead.");
      }
      const modelTurn = serverContent.model_turn || serverContent.modelTurn;
      const parts = modelTurn && Array.isArray(modelTurn.parts) ? modelTurn.parts : [];
      for (const part of parts) {
        if (part.text) updateTranscript("assistant", part.text);
        const inlineData = part.inline_data || part.inlineData;
        // An interruption invalidates audio queued in the interrupted turn.
        if (inlineData && inlineData.data && !wasInterrupted) {
          playPcmAudio(inlineData.data, inlineData.mime_type || inlineData.mimeType);
        }
      }
      if (serverContent.turn_complete || serverContent.turnComplete) {

        if (liveSearchActive && liveSearchLookupCompleted && !hasSearchCallOnThisMessage && responseCardRenderedForTurn) completeLiveSearchProgress();
        if (pendingResponseCards.length) {
          const queuedCards = pendingResponseCards.splice(0);
          const groundedFallback = [...queuedCards].reverse().find((queued) => !queued.id && isGroundedRankedListCard(queued.args));
          const selectedCard = groundedFallback || [...queuedCards].reverse().find((queued) => Boolean(queued.id)) || queuedCards[queuedCards.length - 1];
          if (selectedCard) {
            const rendered = renderResponseCard(selectedCard.args, !selectedCard.id || isGroundedRankedListCard(selectedCard.args));
            for (const queued of queuedCards) if (queued.id) sendDeferredResponseCardResult(queued.id, rendered);
          }
        }
        if (!responseCardRenderedForTurn) ensureTranscriptFallbackCard(true);
        if (liveSearchActive && liveSearchLookupCompleted && responseCardRenderedForTurn && !liveSearchFinishing) completeLiveSearchProgress();
        // Keep transcript context alive across a spoken progress turn or pending tool call.
        // A turn is complete for presentation only once its answer card has actually rendered.
        if (responseCardRenderedForTurn || (!liveSearchActive && !liveSearchFinishing)) {
          finalizeTurn();
        }
        if (greetingTurnPending) beginListeningAfterGreeting();
        else if (active && processor) setStatus("Listening — show me the next thing you want help with.");
      }
    }

    handleToolCalls(message, hasSearchCallOnThisMessage);

    if (message.go_away || message.goAway) {
      setConnectionState("RECONNECTING", "connecting");
      setStatus("Refreshing the live connection while keeping your conversation…", "normal");
      return;
    }

    if (message.error) {
      if (liveSearchActive) cancelLiveSearchProgress();
      const messageText = message.error && typeof message.error.message === "string"
        ? message.error.message.trim().slice(0, 180)
        : "The voice service returned an error.";
      stopCopilot(false, "Voice service error: " + messageText, "error");
    }
  }


  async function prepareCameraPreview() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || active || stopping) return;
    const liveTrack = previewStream && previewStream.getVideoTracks().find((track) => track.readyState === "live");
    if (liveTrack) {
      if (video.srcObject !== previewStream) video.srcObject = previewStream;
      stage.classList.add("has-camera", "pre-start");
      try { await video.play(); } catch (_) {}
      return;
    }
    if (previewPromise) return previewPromise;
    previewPromise = (async () => {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        if (active || stopping) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        previewStream = stream;
        video.srcObject = previewStream;
        await video.play();
        stage.classList.add("has-camera", "pre-start");
        setCameraState("Camera preview", "live");
      } catch (_) {
        if (stream) stream.getTracks().forEach((track) => track.stop());
      } finally {
        previewPromise = null;
      }
    })();
    return previewPromise;
  }

  function playConnectionChime() {
    if (!audioContext || audioContext.state !== "running") return;
    const baseTime = audioContext.currentTime + 0.018;
    // Original airy, glass-like "bloom" cue: fast rising notes with a soft high shimmer.
    // It evokes a polished spatial assistant without copying Apple's proprietary sound.
    const notes = [
      { frequency: 493.88, offset: 0, duration: 0.25, peak: 0.054, type: "sine" },
      { frequency: 659.25, offset: 0.045, duration: 0.31, peak: 0.049, type: "sine" },
      { frequency: 987.77, offset: 0.105, duration: 0.37, peak: 0.039, type: "sine" },
      { frequency: 1481.0, offset: 0.145, duration: 0.24, peak: 0.012, type: "triangle" }
    ];
    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const at = baseTime + note.offset;
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, at);
      oscillator.detune.setValueAtTime(-2, at);
      oscillator.detune.linearRampToValueAtTime(2, at + note.duration * 0.72);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(note.peak, at + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(at);
      oscillator.stop(at + note.duration + 0.025);
    }
  }

  function playDisconnectSound() {
    if (!audioContext || audioContext.state !== "running") return;
    const baseTime = audioContext.currentTime + 0.012;
    disconnectToneUntil = performance.now() + 560;
    // Different, warmer descending two-step release tone for leaving a live session.
    const notes = [
      { frequency: 587.33, offset: 0, duration: 0.17, peak: 0.052, type: "sine" },
      { frequency: 440.0, offset: 0.075, duration: 0.23, peak: 0.058, type: "sine" },
      { frequency: 349.23, offset: 0.17, duration: 0.28, peak: 0.044, type: "triangle" }
    ];
    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const at = baseTime + note.offset;
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(note.peak, at + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(at);
      oscillator.stop(at + note.duration + 0.025);
    }
  }

  function beginListeningAfterGreeting() {
    if (!greetingTurnPending) return;
    greetingTurnPending = false;
    if (greetingTimer) window.clearTimeout(greetingTimer);
    greetingTimer = null;
    const drainMs = audioContext
      ? Math.max(450, Math.min(2600, Math.round((nextPlaybackTime - audioContext.currentTime) * 1000 + 200)))
      : 700;
    greetingTimer = window.setTimeout(() => {
      greetingTimer = null;
      if (!active || !setupReady || stopping || processor) return;
      try {
        startAudioCapture();
        setStatus("I'm here. Show me what you're working on.");
      } catch (error) {
        stopCopilot(false, error && error.message ? error.message : "The microphone could not start.", "error");
      }
    }, drainMs);
  }

  async function startCopilot() {
    if (starting || active) {
      if (active || starting) stopCopilot(true);
      return;
    }
    const automaticRetry = isAutomaticRetry;
    isAutomaticRetry = false;
    if (!automaticRetry || !liveSessionId) liveSessionId = crypto.randomUUID();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (!automaticRetry) automaticReconnectAttempts = 0;
    starting = true;
    stopping = false;
    greetingTurnPending = false;
    stage.classList.remove("pre-start", "initial-intro");
    stage.classList.add("is-connecting");
    syncDisconnectedPreviewAppearance();
    if (previewPromise) { try { await previewPromise; } catch (_) {} }
    recordRealityLoopEvent("session_starting");
    clearOverlay();
    setControls("Starting…", true);
    setConnectionState("CONNECTING", "ready");
    if (connectionNoticeAction) connectionNoticeAction.disabled = true;
    setStatus("Just a moment");
    showConnectionNotice("Connecting securely", "Just a moment", "connecting");
    let sessionSocket = null;
    try {
      // Keep preflight inside the guarded start path so a rejected fetch cannot
      // strand the camera stage in a stale connecting/recovery state.
      const preflight = await refreshAvailabilityAfterRelease();
      if (preflight && !preflight.available) {
        starting = false;
        recoveryPreviewClear = true;
        stage.classList.remove("is-listening", "is-speaking", "is-connecting");
        stage.classList.add("pre-start");
        setControls("Try again", false);
        setConnectionState("BUSY", "error");
        setStatus(
          preflight.message || "Voice isn't available right now.",
          "error",
        );
        syncDisconnectedPreviewAppearance();
        void prepareCameraPreview();
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("This browser does not support camera and microphone access.");
      }
      const previewTrack = previewStream && previewStream.getVideoTracks().find((track) => track.readyState === "live");
      const captured = await navigator.mediaDevices.getUserMedia({
        video: previewTrack ? false : {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      if (previewTrack && captured.getAudioTracks()[0]) {
        microphoneStream = new MediaStream([previewTrack, ...captured.getAudioTracks()]);
        previewStream = null;
      } else {
        microphoneStream = captured;
        if (previewStream) {
          previewStream.getTracks().forEach((track) => { try { track.stop(); } catch (_) {} });
          previewStream = null;
        }
      }
      video.srcObject = microphoneStream;
      await video.play();
      recordRealityLoopEvent("camera_ready");
      initializeZoom();
      stage.classList.add("has-camera");
      setCameraState("Camera ready", "live");

      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("This browser does not support live audio.");
      audioContext = new AudioContextConstructor();
      await audioContext.resume();

      const wsUrl = new URL("/api/voice/socket", window.location.href);
      wsUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("session_id", liveSessionId);
      sessionSocket = new WebSocket(wsUrl.toString());
      socket = sessionSocket;
      sessionSocket.binaryType = "arraybuffer";

      sessionSocket.addEventListener("open", () => {
        if (stopping || socket !== sessionSocket || sessionSocket.readyState !== WebSocket.OPEN) return;
        const setupPayload = { setup: {}, copilot_mode: true };
        try {
          const memory = readOptedInMemoryContext();
          if (memory) setupPayload.memory_context = memory;
        } catch (_) {}
        sessionSocket.send(JSON.stringify(setupPayload));
        startRelayKeepalive(sessionSocket);
        setStatus("Camera ready. Connecting securely to Moina…");
        setupTimer = window.setTimeout(() => {
          if (!setupReady && socket === sessionSocket) {
            retryConnection("The connection is taking longer than usual. Checking the network and trying again…");
          }
        }, 15000);
      });

      sessionSocket.addEventListener("message", (event) => { void handleServerMessage(event.data, sessionSocket); });
      sessionSocket.addEventListener("error", () => {
        if (socket === sessionSocket) {
          retryConnection("The live connection dropped. Checking the network and reconnecting…");
        }
      });
      sessionSocket.addEventListener("close", (event) => {
        stopRelayKeepalive(sessionSocket);
        if (socket !== sessionSocket) return;
        socket = null;
        lastSessionEndedAt = Date.now();
        if (stopping) return;
        const reason = String(event.reason || "").trim();
        if (event.code === 1006 || event.code === 1011 || (!event.wasClean && !reason)) {
          retryConnection("The network connection ended unexpectedly. Checking the network and reconnecting…");
          return;
        }
        let message = "The live session ended unexpectedly. Start the Co-Pilot again to continue.";
        if (reason === "Session time limit reached") message = "This conversation reached its time limit. Start again when you're ready.";
        else if (reason === "Invalid copilot video frame") message = "The camera frame format was rejected. Refresh and try again.";
        else if (reason === "Audio input rate limit exceeded") message = "The live relay received media packets in a short burst. Microphone pacing has been adjusted; close older AskMoina tabs, reload once, and reconnect. This is not a question-count limit.";
        stopCopilot(false, message, "error");
        setConnectionState("ENDED", "error");
        setAvailability("The connection ended. Checking that the session has been released…", "warning");
        void refreshAvailabilityAfterRelease();
      });
    } catch (error) {
      if (sessionSocket && sessionSocket.readyState < WebSocket.CLOSING) {
        try { sessionSocket.close(); } catch (_) {}
      }
      cleanupMedia();
      starting = false;
      active = false;
      socket = null;
      recoveryPreviewClear = true;
      stage.classList.remove("is-listening", "is-speaking", "is-connecting");
      stage.classList.add("pre-start");
      setControls("Try again", false);
      setConnectionState("READY", "error");
      setStatus(error && error.name === "NotAllowedError"
        ? "Camera or microphone permission was denied. Allow both permissions and try again."
        : (error && error.message ? error.message : "Couldn't start the Co-Pilot. Please try again."), "error");
      syncDisconnectedPreviewAppearance();
      void prepareCameraPreview();
    }
  }


  // Local-only template tracking follows a user-selected image patch between cloud frames.
  // It is screen-space tracking, not world-locked AR or a persistent 3D anchor.
  function configureTrackingCanvas() {
    if (!trackingContext || !video.videoWidth || !video.videoHeight) return false;
    const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(64, Math.round(video.videoWidth * scale));
    const height = Math.max(64, Math.round(video.videoHeight * scale));
    if (width !== trackingCanvasWidth || height !== trackingCanvasHeight) {
      trackingCanvas.width = width;
      trackingCanvas.height = height;
      trackingCanvasWidth = width;
      trackingCanvasHeight = height;
      trackingPixels = null;
    }
    if (!nativeZoomSupported && zoomLevel > 1) {
      const sourceWidth = video.videoWidth / zoomLevel;
      const sourceHeight = video.videoHeight / zoomLevel;
      const sourceX = (video.videoWidth - sourceWidth) / 2;
      const sourceY = (video.videoHeight - sourceHeight) / 2;
      trackingCrop = { x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight };
      trackingContext.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    } else {
      trackingCrop = { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
      trackingContext.drawImage(video, 0, 0, width, height);
    }
    trackingPixels = trackingContext.getImageData(0, 0, width, height).data;
    localFrameSequence += 1;
    return true;
  }

  function pixelsToGray(rgba) {
    const gray = new Uint8Array(trackingCanvasWidth * trackingCanvasHeight);
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      gray[i] = (rgba[p] * 3 + rgba[p + 1] * 6 + rgba[p + 2]) / 10;
    }
    return gray;
  }

  function framePointFromClient(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const coverScale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const coverWidth = video.videoWidth * coverScale;
    const coverHeight = video.videoHeight * coverScale;
    const digitalZoom = !nativeZoomSupported ? zoomLevel : 1;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const displayedX = isCameraPreviewMirrored() ? rect.left + rect.width - (clientX - rect.left) : clientX;
    const baseX = centerX + (displayedX - centerX) / digitalZoom;
    const baseY = centerY + (clientY - centerY) / digitalZoom;
    const sourceX = (baseX - (rect.left + (rect.width - coverWidth) / 2)) / coverScale;
    const sourceY = (baseY - (rect.top + (rect.height - coverHeight) / 2)) / coverScale;
    const crop = trackingCrop || { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
    const x = ((sourceX - crop.x) / crop.width) * trackingCanvasWidth;
    const y = ((sourceY - crop.y) / crop.height) * trackingCanvasHeight;
    if (x < 0 || y < 0 || x >= trackingCanvasWidth || y >= trackingCanvasHeight) return null;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function markerAtTrackingPoint(point) {
    if (!point || !trackingCanvasWidth || !trackingCanvasHeight || !video.videoWidth || !video.videoHeight) return;
    const rect = stage.getBoundingClientRect();
    const coverScale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const coverWidth = video.videoWidth * coverScale;
    const coverHeight = video.videoHeight * coverScale;
    const crop = trackingCrop || { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
    const sourceX = crop.x + (point.x / trackingCanvasWidth) * crop.width;
    const sourceY = crop.y + (point.y / trackingCanvasHeight) * crop.height;
    const digitalZoom = !nativeZoomSupported ? zoomLevel : 1;
    const baseX = rect.left + (rect.width - coverWidth) / 2 + sourceX * coverScale;
    const baseY = rect.top + (rect.height - coverHeight) / 2 + sourceY * coverScale;
    const mirrorDirection = isCameraPreviewMirrored() ? -1 : 1;
    const screenX = rect.left + rect.width / 2 + (baseX - (rect.left + rect.width / 2)) * digitalZoom * mirrorDirection;
    const screenY = rect.top + rect.height / 2 + (baseY - (rect.top + rect.height / 2)) * digitalZoom;
    focusMarker.style.left = ((screenX - rect.left) / rect.width * 100) + "%";
    focusMarker.style.top = ((screenY - rect.top) / rect.height * 100) + "%";
    trackedPoint = point;
  }

  function extractTemplate(gray, x, y) {
    // Include nearby edges/context so a tiny uniform patch does not masquerade as an object.
    const radius = 8;
    if (x < radius + 2 || y < radius + 2 || x >= trackingCanvasWidth - radius - 2 || y >= trackingCanvasHeight - radius - 2) return null;
    const size = radius * 2 + 1;
    const values = new Float32Array(size * size);
    let sum = 0;
    let i = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const value = gray[(y + dy) * trackingCanvasWidth + x + dx];
        values[i++] = value;
        sum += value;
      }
    }
    const mean = sum / values.length;
    let variance = 0;
    for (const value of values) variance += (value - mean) * (value - mean);
    if (variance < 500) return null;
    return { values, mean, variance, radius, size };
  }

  function compareTemplate(gray, x, y) {
    const template = trackingTemplate;
    const radius = template.radius;
    const width = trackingCanvasWidth;
    let sum = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      const row = (y + dy) * width;
      for (let dx = -radius; dx <= radius; dx += 1) sum += gray[row + x + dx];
    }
    const mean = sum / template.values.length;
    let covariance = 0;
    let candidateVariance = 0;
    let absoluteDifference = 0;
    let i = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      const row = (y + dy) * width;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const candidate = gray[row + x + dx];
        const centered = candidate - mean;
        covariance += (template.values[i] - template.mean) * centered;
        candidateVariance += centered * centered;
        absoluteDifference += Math.abs(candidate - template.values[i]);
        i += 1;
      }
    }
    if (candidateVariance < 500) return -1;
    if (template.variance < 1800 || candidateVariance < 1800) {
      return 1 - absoluteDifference / template.values.length / 32;
    }
    const denominator = Math.sqrt(template.variance * candidateVariance);
    return denominator > 0 ? covariance / denominator : -1;
  }

  function findTemplate(gray, center) {
    if (!trackingTemplate || !center) return null;
    const radius = trackingTemplate.radius;
    const margin = radius + 1;
    const minX = margin;
    const maxX = trackingCanvasWidth - margin - 1;
    const minY = margin;
    const maxY = trackingCanvasHeight - margin - 1;
    if (center.x < minX || center.x > maxX || center.y < minY || center.y > maxY) return null;
    const searchRadius = 18;
    let best = { x: center.x, y: center.y, score: -2 };
    const startX = Math.max(minX, center.x - searchRadius);
    const endX = Math.min(maxX, center.x + searchRadius);
    const startY = Math.max(minY, center.y - searchRadius);
    const endY = Math.min(maxY, center.y + searchRadius);
    for (let y = startY; y <= endY; y += 2) {
      for (let x = startX; x <= endX; x += 2) {
        const score = compareTemplate(gray, x, y);
        if (score > best.score) best = { x, y, score };
      }
    }
    const coarse = { ...best };
    for (let y = Math.max(minY, coarse.y - 2); y <= Math.min(maxY, coarse.y + 2); y += 1) {
      for (let x = Math.max(minX, coarse.x - 2); x <= Math.min(maxX, coarse.x + 2); x += 1) {
        const score = compareTemplate(gray, x, y);
        if (score > best.score) best = { x, y, score };
      }
    }
    return best;
  }

  // Wider, infrequent scan used only after the local tracker loses confidence.
  // The stricter threshold in updateLocalTracking helps prevent jumps to similar-looking objects.
  function findTemplateAcrossFrame(gray) {
    if (!trackingTemplate || !trackingCanvasWidth || !trackingCanvasHeight) return null;
    const margin = trackingTemplate.radius + 1;
    const minX = margin;
    const maxX = trackingCanvasWidth - margin - 1;
    const minY = margin;
    const maxY = trackingCanvasHeight - margin - 1;
    if (maxX <= minX || maxY <= minY) return null;
    let best = { x: 0, y: 0, score: -2 };
    const stride = 5;
    for (let y = minY; y <= maxY; y += stride) {
      for (let x = minX; x <= maxX; x += stride) {
        const score = compareTemplate(gray, x, y);
        if (score > best.score) best = { x, y, score };
      }
    }
    const coarse = { ...best };
    for (let y = Math.max(minY, coarse.y - stride); y <= Math.min(maxY, coarse.y + stride); y += 1) {
      for (let x = Math.max(minX, coarse.x - stride); x <= Math.min(maxX, coarse.x + stride); x += 1) {
        const score = compareTemplate(gray, x, y);
        if (score > best.score) best = { x, y, score };
      }
    }
    return best;
  }

  function stopLocalTracking(showStatus = true) {
    localTrackingActive = false;
    if (trackingTimer) window.clearInterval(trackingTimer);
    trackingTimer = null;
    trackingTemplate = null;
    trackingLostFrames = 0;
    trackingLostAt = 0;
    trackingLastReacquireAt = 0;
    trackingReacquiring = false;
    trackingReacquireCandidate = null;
    trackingReacquireCandidateFrames = 0;
    trackedTargetKey = "";
    trackedPoint = null;
    trackingCrop = null;
    if (focusMarker) {
      delete focusMarker.dataset.tracking;
      delete focusMarker.dataset.trackId;
      delete focusMarker.dataset.trackState;
    }
    persistentSpatialTrack = null;
    if (showStatus && microphoneStream) setStatus("Local tracking stopped. Tap a visible object to track it again.");
  }

  function startLocalTracking(clientX, clientY) {
    if (!active || !setupReady || !microphoneStream || !trackingContext) {
      setStatus("Start the Co-Pilot first, then tap a visible object to track it.", "warning");
      return null;
    }
    if (localTrackingActive) {
      stopLocalTracking(false);
      focusMarker.hidden = true;
      delete focusMarker.dataset.tracking;
      clearMarkerButton.disabled = true;
    }
    if (!configureTrackingCanvas()) {
      setStatus("The camera frame isn't ready yet. Hold the view steady and try again.", "warning");
      return null;
    }
    const point = framePointFromClient(clientX, clientY);
    if (!point) {
      setStatus("Tap on the visible camera image, not the cropped edge.", "warning");
      return null;
    }
    const selectedPoint = {
      x: Math.max(0, Math.min(0.9999, point.x / trackingCanvasWidth)),
      y: Math.max(0, Math.min(0.9999, point.y / trackingCanvasHeight))
    };
    const gray = pixelsToGray(trackingPixels);
    const template = extractTemplate(gray, point.x, point.y);
    if (!template) {
      if (!awaitingTargetSelection) {
        setStatus("Move a little closer to the target and tap its center again.", "warning");
        return null;
      }
      // A point is useful to the model, but without a stable image patch it is not a track.
      // Never turn an untrackable selection into a marker that stays fixed on screen.
      focusMarker.hidden = true;
      delete focusMarker.dataset.tracking;
      clearMarkerButton.disabled = true;
      approxTag.hidden = false;
      approxTag.textContent = "Too little detail · tap an edge";
      setStatus("I got your tap, but that spot has too little visual detail to track. Tap a textured edge, logo, or button outline; I will not leave a fixed marker.", "warning");
      return selectedPoint;
    }
    if (trackingTimer) window.clearInterval(trackingTimer);
    trackingTemplate = template;
    trackedPoint = point;
    trackingLostFrames = 0;
    trackingLostAt = 0;
    trackingLastReacquireAt = 0;
    trackingReacquiring = false;
    trackingReacquireCandidate = null;
    trackingReacquireCandidateFrames = 0;
    trackedTargetKey = pendingTrackingTargetKey || visualTargetKey(latestVisualGuidance);
    persistentSpatialTrack = createPersistentSpatialTrack(
      "local-patch-" + (++spatialTrackSequence),
      trackedTargetKey,
      point,
      { frameSequence: localFrameSequence, viewGeneration: cameraViewGeneration },
      Date.now()
    );
    localTrackingActive = true;
    focusMarker.hidden = false;
    focusMarker.dataset.tracking = "true";
    focusMarker.dataset.trackId = persistentSpatialTrack.trackId;
    focusMarker.dataset.trackState = persistentSpatialTrack.status;
    focusMarker.dataset.region = "center";
    focusLabel.textContent = "Tracking selected target";
    focusHint.textContent = "Running locally on this device";
    focusInstruction.textContent = "Tap another point to retarget";
    approxTag.hidden = false;
    approxTag.textContent = "Local visual tracking · not world-locked AR";
    clearMarkerButton.disabled = false;
    markerAtTrackingPoint(point);
    setStatus("Tracking this image area locally. Keep it visible and move the phone slowly; tap another point to retarget.");
    trackingLastTick = 0;
    trackingTimer = window.setInterval(updateLocalTracking, 90);
    return selectedPoint;
  }

  function updateLocalTracking() {
    if (!localTrackingActive || !active || !setupReady || !microphoneStream || !video.videoWidth || !trackingContext) return;
    const now = Date.now();
    if (now - trackingLastTick < 75) return;
    trackingLastTick = now;
    try {
      if (!configureTrackingCanvas() || !trackingPixels) return;
      const gray = pixelsToGray(trackingPixels);
      const ordinaryThreshold = trackingTemplate && trackingTemplate.variance < 1800 ? 0.72 : 0.52;
      let result = null;

      if (!trackingReacquiring) {
        result = findTemplate(gray, trackedPoint);
        if (result && result.score < ordinaryThreshold) result = null;
      }

      if (!result) {
        if (!trackingLostAt) trackingLostAt = now;
        if (persistentSpatialTrack) {
          persistentSpatialTrack = updatePersistentSpatialTrack(persistentSpatialTrack, {
            type: "miss", now, viewGeneration: cameraViewGeneration
          });
          focusMarker.dataset.trackState = persistentSpatialTrack.status;
        }
        trackingLostFrames += 1;

        if (trackingLostFrames >= 3) {
          if (!trackingReacquiring) {
            trackingReacquiring = true;
            focusMarker.dataset.tracking = "reacquiring";
            approxTag.hidden = false;
            approxTag.textContent = "Target unclear · reacquiring";
            setStatus("Target not clear. Hold the camera steady while I try to find it again.", "warning");
          }

          // Keep the last cue only briefly; a stale marker must not imply confident location.
          if (now - trackingLostAt >= 1_300) {
            focusMarker.hidden = true;
            clearMarkerButton.disabled = true;
            approxTag.textContent = "Target not visible · move slowly";
          }

          // Wider matching is expensive enough to run only periodically during loss.
          if (now - trackingLastReacquireAt >= 350) {
            trackingLastReacquireAt = now;
            const candidate = findTemplateAcrossFrame(gray);
            const reacquireThreshold = trackingTemplate && trackingTemplate.variance < 1800 ? 0.90 : 0.76;
            if (candidate && candidate.score >= reacquireThreshold) {
              const prior = trackingReacquireCandidate;
              const nearPrior = prior && Math.hypot(candidate.x - prior.x, candidate.y - prior.y) <= 22;
              trackingReacquireCandidateFrames = nearPrior ? trackingReacquireCandidateFrames + 1 : 1;
              trackingReacquireCandidate = { x: candidate.x, y: candidate.y, score: candidate.score };
              // Require the wider scan to see the same patch in two scans before restoring the marker.
              if (trackingReacquireCandidateFrames >= 2) result = candidate;
            } else {
              trackingReacquireCandidate = null;
              trackingReacquireCandidateFrames = 0;
            }
          }
        }

        if (!result) {
          if (now - trackingLostAt >= 8_000) {
            const lostTargetKey = trackedTargetKey;
            stopLocalTracking(false);
            pendingTrackingTargetKey = lostTargetKey;
            awaitingTargetSelection = true;
            focusMarker.hidden = true;
            approxTag.hidden = false;
            approxTag.textContent = "Target lost · tap to track";
            clearMarkerButton.disabled = true;
            focusMarker.dataset.tracking = "lost";
            setStatus("I could not reacquire that target. The old highlight is removed. Bring it back into view and tap it again.", "warning");
          }
          return;
        }
      }

      const recovered = trackingReacquiring;
      if (persistentSpatialTrack) {
        persistentSpatialTrack = updatePersistentSpatialTrack(persistentSpatialTrack, {
          type: "match", score: result.score, point: { x: result.x, y: result.y },
          frameSequence: localFrameSequence, viewGeneration: cameraViewGeneration,
          now, reacquired: recovered
        });
        focusMarker.dataset.trackState = persistentSpatialTrack.status;
      }
      trackingLostFrames = 0;
      trackingLostAt = 0;
      trackingLastReacquireAt = 0;
      trackingReacquiring = false;
      trackingReacquireCandidate = null;
      trackingReacquireCandidateFrames = 0;
      focusMarker.hidden = false;
      focusMarker.dataset.tracking = "true";
      approxTag.hidden = false;
      approxTag.textContent = "Local visual tracking · not world-locked AR";
      clearMarkerButton.disabled = false;
      markerAtTrackingPoint(result);
      if (recovered) setStatus("Target found again. Tracking has resumed.", "normal");
    } catch (_) {
      if (!trackingLostAt) trackingLostAt = now;
      trackingReacquiring = true;
      trackingLostFrames += 1;
      if (persistentSpatialTrack) {
        persistentSpatialTrack = updatePersistentSpatialTrack(persistentSpatialTrack, {
          type: "miss", now, viewGeneration: cameraViewGeneration
        });
        focusMarker.dataset.trackState = persistentSpatialTrack.status;
      }
      focusMarker.dataset.tracking = "reacquiring";
      if (now - trackingLostAt >= 1_300) {
        focusMarker.hidden = true;
        clearMarkerButton.disabled = true;
        approxTag.hidden = false;
        approxTag.textContent = "Target unclear · move slowly";
      }
      if (now - trackingLostAt >= 8_000) {
        const lostTargetKey = trackedTargetKey;
        stopLocalTracking(false);
        pendingTrackingTargetKey = lostTargetKey;
        awaitingTargetSelection = true;
        focusMarker.hidden = true;
        approxTag.hidden = false;
        approxTag.textContent = "Target lost · tap to track";
        clearMarkerButton.disabled = true;
        focusMarker.dataset.tracking = "lost";
        setStatus("I could not reacquire that target. The old highlight is removed. Bring it back into view and tap it again.", "warning");
      }
    }
  }
  stage.addEventListener("click", (event) => {
    if (event.target.closest(".floating-top,.camera-controls,.caption-dock,.zoom-dock,.camera-top-badge,.camera-state,.approx-tag,.focus-card,.clear-marker,.vision-pill,.vault-link")) return;
    if (!microphoneStream || !active || !setupReady) return;
    const isTargetSelection = awaitingTargetSelection;
    const selectedPoint = startLocalTracking(event.clientX, event.clientY, isTargetSelection);
    if (!isTargetSelection || !selectedPoint || !socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      // Include a recent camera frame when the per-second frame budget permits.
      sendVideoFrame();
      socket.send(JSON.stringify({ target_selection: selectedPoint }));
      if (localTrackingActive) {
        awaitingTargetSelection = false;
        pendingTrackingTargetKey = "";
        setStatus("Checking the selected area with Moina…");
      } else {
        awaitingTargetSelection = true;
        approxTag.hidden = false;
        approxTag.textContent = "Too little detail · tap an edge";
        setStatus("I sent the point to Moina, but could not lock the highlight locally. Tap a more textured edge or detail to start tracking.", "warning");
      }
    } catch (_) {
      setStatus("Unable to send that selection. Tap the object again.", "warning");
    }
  });

  function initializeZoom() {
    const track = microphoneStream && microphoneStream.getVideoTracks()[0];
    if (!track) return;
    let capabilities = {};
    let settings = {};
    try { capabilities = track.getCapabilities ? track.getCapabilities() : {}; } catch (_) {}
    try { settings = track.getSettings ? track.getSettings() : {}; } catch (_) {}
    const range = capabilities.zoom;
    nativeZoomSupported = Boolean(range && Number(range.max) > Number(range.min));
    zoomMin = nativeZoomSupported ? Number(range.min) : 1;
    zoomMax = nativeZoomSupported ? Math.min(Number(range.max), 6) : 3;
    zoomLevel = nativeZoomSupported && Number.isFinite(Number(settings.zoom)) ? Number(settings.zoom) : 1;
    zoomLevel = Math.max(zoomMin, Math.min(zoomMax, zoomLevel));
    zoomSlider.min = String(zoomMin);
    zoomSlider.max = String(zoomMax);
    zoomSlider.step = nativeZoomSupported ? String(Number(range.step) > 0 ? range.step : 0.1) : "0.1";
    void applyZoom(zoomLevel, false);
  }

  async function applyZoom(value, announce) {
    const track = microphoneStream && microphoneStream.getVideoTracks()[0];
    const requested = Number(value);
    if (!Number.isFinite(requested)) return;
    const nextZoom = Math.max(zoomMin, Math.min(zoomMax, requested));
    const zoomChanged = Math.abs(nextZoom - zoomLevel) > 0.05;
    const hadVisualGuidance = Boolean(latestVisualGuideElements.length || latestVisualGuidance || localTrackingActive);
    if (zoomChanged) {
      invalidateSceneEvidence("zoom-change");
      if (hadVisualGuidance) {
        setStatus("Camera zoom changed. Moina will redraw the guide using a fresh view.", "warning");
      } else if (announce) {
        setStatus("Zoom changed. Tap a target again if you want local tracking.", "warning");
      }
    }
    zoomLevel = nextZoom;
    zoomSlider.value = String(zoomLevel);
    zoomLabel.textContent = (Math.abs(zoomLevel - Math.round(zoomLevel)) < 0.001 ? String(Math.round(zoomLevel)) : zoomLevel.toFixed(1)) + "×";
    if (nativeZoomSupported && track) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: zoomLevel }] });
      } catch (_) {
        nativeZoomSupported = false;
        zoomMin = 1;
        zoomMax = 3;
        zoomLevel = Math.max(1, Math.min(3, zoomLevel));
        zoomSlider.min = "1";
        zoomSlider.max = "3";
        zoomSlider.step = "0.1";
      }
    }
    // Native zoom changes the camera frame itself; digital zoom transforms the preview.
    // The model receives the same center crop, so normalized guide coordinates stay frame-relative.
    updatePreviewTransform();
    zoomInButton.disabled = !microphoneStream || zoomLevel >= zoomMax;
    zoomOutButton.disabled = !microphoneStream || zoomLevel <= zoomMin;
    if (announce) setStatus("Camera zoom " + zoomLabel.textContent + ".");
  }

  function toggleMicrophoneMute() {
    if (!microphoneStream) return;
    microphoneMuted = !microphoneMuted;
    microphoneStream.getAudioTracks().forEach((track) => { track.enabled = !microphoneMuted; });
    muteButton.innerHTML = microphoneMuted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8M3 3l18 18"/></svg><span class="sr-only">Unmute microphone</span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg><span class="sr-only">Mute microphone</span>';
    muteButton.setAttribute("aria-pressed", microphoneMuted ? "true" : "false");
    setStatus(microphoneMuted ? "Microphone muted. Tap Unmute when you're ready to speak." : "Microphone is on.");
  }

  function touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  stage.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2) {
      pinchStartDistance = touchDistance(event.touches);
      pinchStartZoom = zoomLevel;
    }
  }, { passive: true });
  stage.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 2 || !pinchStartDistance || !microphoneStream) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastZoomApplyAt < 55) return;
    lastZoomApplyAt = now;
    void applyZoom(pinchStartZoom * touchDistance(event.touches) / pinchStartDistance, false);
  }, { passive: false });
  stage.addEventListener("touchend", (event) => { if (event.touches.length < 2) pinchStartDistance = 0; }, { passive: true });
  stage.addEventListener("touchcancel", () => { pinchStartDistance = 0; }, { passive: true });
  zoomSlider.addEventListener("input", () => { void applyZoom(zoomSlider.value, false); });
  zoomInButton.addEventListener("click", () => { void applyZoom(zoomLevel + 0.25, true); });
  zoomOutButton.addEventListener("click", () => { void applyZoom(zoomLevel - 0.25, true); });
  async function flipCamera() {
    if (!active || !microphoneStream) return;
    const nextFacingMode = facingMode === "environment" ? "user" : "environment";
    invalidateSceneEvidence("camera-switch");
    flipButton.disabled = true;
    try {
      const cameraOnly = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      const newTrack = cameraOnly.getVideoTracks()[0];
      if (!newTrack) throw new Error("No camera was available.");
      const oldTrack = microphoneStream.getVideoTracks()[0];
      if (oldTrack) {
        microphoneStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      microphoneStream.addTrack(newTrack);
      video.srcObject = microphoneStream;
      await video.play();
      initializeZoom();
      facingMode = nextFacingMode;
      updatePreviewTransform();
      setStatus(facingMode === "environment" ? "Switched to the rear camera." : "Switched to the front camera.");
      setCameraState("Live · frames ~1/sec", "live");
    } catch (error) {
      setStatus(error && error.message ? error.message : "Couldn't switch cameras.", "warning");
    } finally {
      flipButton.disabled = !active;
    }
  }

  if (showProblemButton) {
    let slidePointerId = null;
    let slideStartX = 0;
    let slideStartProgress = 0;
    const slideHandle = showProblemButton.querySelector(".vision-slide-handle");
    const slideLabel = showProblemButton.querySelector("#visionSlideLabel");
    const slideProgress = () => Math.max(0, Math.min(1, Number(showProblemButton.dataset.progress || 0)));
    const resetSlide = () => {
      showProblemButton.dataset.progress = "0";
      showProblemButton.style.setProperty("--slide-distance", "0px");
      showProblemButton.classList.remove("is-sliding", "is-complete");
      if (slideLabel) slideLabel.textContent = "Slide to show your problem";
    };
    showProblemButton.addEventListener("pointerdown", (event) => {
      if (active || starting || (event.pointerType === "mouse" && event.button !== 0)) return;
      slidePointerId = event.pointerId;
      slideStartX = event.clientX;
      slideStartProgress = slideProgress();
      showProblemButton.classList.add("is-sliding");
      try { showProblemButton.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
    });
    showProblemButton.addEventListener("pointermove", (event) => {
      if (slidePointerId !== event.pointerId || !slideHandle) return;
      const maxDistance = Math.max(1, showProblemButton.clientWidth - slideHandle.offsetWidth - 10);
      const progress = Math.max(0, Math.min(1, slideStartProgress + (event.clientX - slideStartX) / maxDistance));
      showProblemButton.dataset.progress = String(progress);
      showProblemButton.style.setProperty("--slide-distance", (maxDistance * progress) + "px");
      if (slideLabel) slideLabel.textContent = progress >= 0.82 ? "Release to begin" : "Slide to show your problem";
    });
    showProblemButton.addEventListener("pointerup", (event) => {
      if (slidePointerId !== event.pointerId) return;
      slidePointerId = null;
      try { showProblemButton.releasePointerCapture(event.pointerId); } catch (_) {}
      showProblemButton.classList.remove("is-sliding");
      if (slideProgress() >= 0.82) {
        showProblemButton.dataset.progress = "1";
        showProblemButton.classList.add("is-complete");
        if (slideLabel) slideLabel.textContent = "Opening Vision…";
        if (!active && !starting) void startCopilot();
      } else {
        resetSlide();
      }
    });
    showProblemButton.addEventListener("pointercancel", (event) => {
      if (slidePointerId !== event.pointerId) return;
      slidePointerId = null;
      try { showProblemButton.releasePointerCapture(event.pointerId); } catch (_) {}
      resetSlide();
    });
    showProblemButton.addEventListener("click", (event) => {
      // Pointer users must complete the slide; keyboard activation remains an accessible alternative.
      if (event.detail > 0) return;
      if (!active && !starting) void startCopilot();
    });
  }
  if (connectionNoticeAction) {
    connectionNoticeAction.addEventListener("click", () => {
      if (connectionNoticeAction.disabled) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setStatus("Still offline. Reconnect to the internet, then tap Reconnect now.", "warning");
        showConnectionNotice("You're still offline", "AskMoina will wait until you choose to reconnect.", "slow");
        return;
      }
      connectionNoticeAction.disabled = true;
      automaticReconnectAttempts = 0;
      isAutomaticRetry = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (active || starting) stopCopilot(false, null, null, true);
      // Re-open the camera preview in parallel with the AJAX/WebSocket retry.
      // startCopilot shares and awaits the pending preview request, so the camera appears first.
      void prepareCameraPreview();
      showConnectionNotice("Reconnecting…", "Reopening the camera and restoring your live connection…", "connecting");
      void startCopilot();
    });
  }
  window.addEventListener("offline", () => {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (active || starting) stopCopilot(false, null, null, true);
    automaticReconnectAttempts = 0;
    setConnectionState("OFFLINE", "error");
    setStatus("You're offline. Your camera preview stays local. Tap Reconnect now after your connection returns.", "warning");
    showConnectionNotice("You're offline", "Waiting for your network. AskMoina will not reopen the live session automatically.", "slow");
  });
  window.addEventListener("online", () => {
    if (active || starting) return;
    setConnectionState("READY", "ready");
    setStatus("Network restored. Tap Reconnect now when you're ready to resume.", "normal");
    showConnectionNotice("Network restored", "Your connection is back. Tap Reconnect now to resume the live session.", "slow");
  });
  toggleButton.addEventListener("click", () => {
    if (active || starting) {
      stopCopilot(true);
      stage.classList.add("is-returning");
      // Let the distinct end tone finish before returning to the Vision card chooser.
      window.setTimeout(() => window.location.replace("/"), 570);
    } else {
      void startCopilot();
    }
  });
  flipButton.addEventListener("click", () => { void flipCamera(); });
  muteButton.addEventListener("click", toggleMicrophoneMute);
  clearMarkerButton.addEventListener("click", clearOverlay);
  clearTranscriptButton.addEventListener("click", resetTranscript);

  window.addEventListener("pagehide", () => {
    if (active || starting || socket) stopCopilot(false);
    if (previewStream) {
      previewStream.getTracks().forEach((track) => { try { track.stop(); } catch (_) {} });
      previewStream = null;
    }
  });


  const spatialArButton = $("#spatialArButton");
  const spatialHud = $("#spatialHud");
  const spatialAdvanced = $("#spatialAdvanced");
  const spatialStatus = $("#spatialStatus");
  const spatialProgressTrack = $("#spatialProgressTrack");
  const spatialActionEyebrow = $("#spatialActionEyebrow");
  const spatialActionHint = $("#spatialActionHint");
  const spatialTargetLabel = $("#spatialTargetLabel");
  const spatialTargetInstruction = $("#spatialTargetInstruction");
  const spatialTargetHint = $("#spatialTargetHint");
  const spatialStepPanel = $("#spatialStepPanel");
  const spatialStepProgress = $("#spatialStepProgress");
  const spatialStepMessage = $("#spatialStepMessage");
  const spatialStepButtons = {
    previous: $("#spatialStepPrevious"),
    confirm: $("#spatialStepConfirm"),
    next: $("#spatialStepNext"),
    finish: $("#spatialStepFinish")
  };
  const spatialAimLabel = $("#spatialAimLabel");
  const spatialAimButtons = {
    left: $("#spatialAimLeft"),
    up: $("#spatialAimUp"),
    reset: $("#spatialAimReset"),
    down: $("#spatialAimDown"),
    right: $("#spatialAimRight")
  };
  const placeSpatialAnchorButton = $("#placeSpatialAnchor");
  const clearSpatialAnchorButton = $("#clearSpatialAnchor");
  const exitSpatialArButton = $("#exitSpatialAr");
  const spatialSceneName = $("#spatialSceneName");
  const spatialSceneCount = $("#spatialSceneCount");
  const spatialScenePinButton = $("#spatialScenePin");
  const spatialSceneSaveButton = $("#spatialSceneSave");
  const spatialSceneSelect = $("#spatialSceneSelect");
  const spatialSceneLoadButton = $("#spatialSceneLoad");
  const spatialSceneClearButton = $("#spatialSceneClear");

  const SPATIAL_SCENE_STORAGE_KEY = "askmoina.spatial.scenes.v1";
  const MAX_SPATIAL_SCENES = 12;
  const MAX_SPATIAL_CUES = 5;

  let spatialSavedScenes = loadSpatialSceneLibrary();
  let spatialSceneAnchors = [];
  let spatialGuidanceSequenceId = "live-initial";

  let spatialFeatureSupported = false;
  let spatialSession = null;
  let spatialGl = null;
  let spatialRenderer = null;
  let spatialHitSource = null;
  let spatialViewerSpace = null;
  let spatialReferenceSpace = null;
  let spatialAnchor = null;
  let spatialPlacedGuidance = null;
  let spatialLatestHit = null;
  let spatialPendingPlacement = false;
  let spatialPlacing = false;
  let spatialStatusMode = "";
  let spatialLastStatusAt = 0;
  let spatialPendingPlacementAt = 0;
  let spatialAnchorPoseLostAt = 0;
  let spatialAnchorPoseWarningShown = false;
  let spatialAimOffsetX = 0;
  let spatialAimOffsetY = 0;
  let spatialSuggestedAimX = 0;
  let spatialSuggestedAimY = 0;
  let spatialHitSourceGeneration = 0;
  let spatialHitSourcePending = false;
  let spatialOffsetRaySupported = false;
  let spatialGuidanceSteps = [];
  let spatialStepIndex = 0;
  let spatialStepConfirmed = false;
  let spatialSequenceFinished = false;
  let spatialLastHudHitState = null;

  function normalizeSavedSpatialCue(value) {
    if (!value || typeof value !== "object") return null;
    const label = typeof value.label === "string" ? value.label.trim().slice(0, 72) : "";
    const instruction = typeof value.instruction === "string" ? value.instruction.trim().slice(0, 220) : "";
    const hint = typeof value.hint === "string" ? value.hint.trim().slice(0, 120) : "";
    const regions = ["center", "upper-left", "upper-right", "lower-left", "lower-right"];
    const screenRegion = regions.includes(value.screenRegion) ? value.screenRegion : "center";
    if (!label && !instruction) return null;
    return { label: label || "Saved cue", instruction, hint, screenRegion };
  }

  function loadSpatialSceneLibrary() {
    try {
      const raw = window.localStorage.getItem(SPATIAL_SCENE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, MAX_SPATIAL_SCENES).map((scene) => {
        const cues = Array.isArray(scene && scene.cues)
          ? scene.cues.slice(0, MAX_SPATIAL_CUES).map(normalizeSavedSpatialCue).filter(Boolean)
          : [];
        return {
          id: typeof scene?.id === "string" ? scene.id.slice(0, 80) : "",
          name: typeof scene?.name === "string" ? scene.name.trim().slice(0, 60) : "",
          savedAt: typeof scene?.savedAt === "string" ? scene.savedAt : "",
          cues
        };
      }).filter((scene) => scene.id && scene.name && scene.cues.length);
    } catch (_) {
      return [];
    }
  }

  function persistSpatialSceneLibrary() {
    try {
      window.localStorage.setItem(SPATIAL_SCENE_STORAGE_KEY, JSON.stringify(spatialSavedScenes.slice(0, MAX_SPATIAL_SCENES)));
      return true;
    } catch (_) {
      setSpatialStatus("The scene could not be saved on this browser. Check local storage availability.", "warning");
      return false;
    }
  }

  function refreshSpatialSceneSelect() {
    if (!spatialSceneSelect) return;
    const previousValue = spatialSceneSelect.value;
    spatialSceneSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = spatialSavedScenes.length ? "Choose a saved scene…" : "No saved scenes yet";
    spatialSceneSelect.appendChild(placeholder);
    for (const scene of spatialSavedScenes) {
      const option = document.createElement("option");
      option.value = scene.id;
      option.textContent = scene.name + " · " + scene.cues.length + " cues";
      spatialSceneSelect.appendChild(option);
    }
    if (spatialSavedScenes.some((scene) => scene.id === previousValue)) spatialSceneSelect.value = previousValue;
    syncSpatialSceneControls();
  }

  function hasSpatialCueForCurrentStep() {
    if (spatialAnchor) return true;
    if (spatialGuidanceSteps.length < 2) return false;
    return spatialSceneAnchors.some((item) =>
      item.sequenceId === spatialGuidanceSequenceId && item.stepIndex === spatialStepIndex
    );
  }

  function syncSpatialSceneControls() {
    if (!spatialSceneCount) return;
    const busy = spatialPlacing || spatialPendingPlacement || spatialHitSourcePending;
    spatialSceneCount.textContent = spatialSceneAnchors.length + " pinned cue" + (spatialSceneAnchors.length === 1 ? "" : "s");
    spatialScenePinButton.disabled = !spatialSession || !spatialAnchor || busy ||
      spatialSceneAnchors.length >= MAX_SPATIAL_CUES ||
      (spatialGuidanceSteps.length > 1 && !spatialStepConfirmed);
    spatialSceneSaveButton.disabled = spatialSceneAnchors.length < 1 || !spatialSceneName.value.trim();
    spatialSceneLoadButton.disabled = !spatialSceneSelect.value ||
      !spatialSavedScenes.some((scene) => scene.id === spatialSceneSelect.value);
    spatialSceneClearButton.disabled = spatialSceneAnchors.length < 1 || busy;
  }

  function pinCurrentSpatialCue() {
    if (!spatialSession || !spatialAnchor || spatialPlacing || spatialPendingPlacement || spatialHitSourcePending) return;
    if (spatialSceneAnchors.length >= MAX_SPATIAL_CUES) {
      setSpatialStatus("A scene can hold up to " + MAX_SPATIAL_CUES + " pinned cues. Save this scene or clear pins before adding another.", "warning");
      return;
    }
    if (spatialGuidanceSteps.length > 1 && !spatialStepConfirmed) {
      setSpatialStatus("Confirm this walkthrough step before pinning it into the scene.", "warning");
      return;
    }
    const guidance = normalizeSavedSpatialCue(spatialPlacedGuidance || activeSpatialGuidance());
    if (!guidance) {
      setSpatialStatus("This cue has no label or instruction to save.", "warning");
      return;
    }
    spatialSceneAnchors.push({
      anchor: spatialAnchor,
      guidance,
      sequenceId: spatialGuidanceSequenceId,
      stepIndex: spatialGuidanceSteps.length > 1 ? spatialStepIndex : -1
    });
    updateSpatialTagTexture(guidance);
    spatialAnchor = null;
    spatialPlacedGuidance = null;
    spatialLatestHit = null;
    spatialAnchorPoseLostAt = 0;
    spatialAnchorPoseWarningShown = false;
    setSpatialStatus("Pinned “" + guidance.label + "” in this AR scene. The marker stays visible while you align another cue.", "anchored");
    syncSpatialButtons();
    syncSpatialSequenceControls();
    syncSpatialSceneControls();
  }

  function saveCurrentSpatialScene() {
    const name = spatialSceneName.value.trim().slice(0, 60);
    if (!name) {
      setSpatialStatus("Give this scene a short name before saving it.", "warning");
      spatialSceneName.focus();
      return;
    }
    const cues = spatialSceneAnchors.map((item) => normalizeSavedSpatialCue(item.guidance)).filter(Boolean).slice(0, MAX_SPATIAL_CUES);
    if (!cues.length) {
      setSpatialStatus("Pin at least one cue before saving a scene.", "warning");
      return;
    }
    const existing = spatialSavedScenes.find((scene) => scene.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const scene = {
      id: existing ? existing.id : (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "scene-" + Date.now()),
      name,
      savedAt: new Date().toISOString(),
      cues
    };
    spatialSavedScenes = [scene, ...spatialSavedScenes.filter((item) => item.id !== scene.id)].slice(0, MAX_SPATIAL_SCENES);
    if (!persistSpatialSceneLibrary()) return;
    refreshSpatialSceneSelect();
    spatialSceneSelect.value = scene.id;
    syncSpatialSceneControls();
    setSpatialStatus("Saved scene “" + name + "” on this device with " + cues.length + " cue" + (cues.length === 1 ? "" : "s") + ". Cue descriptions are saved; physical anchor positions are not.", "anchored");
  }

  function loadSavedSpatialScene() {
    const scene = spatialSavedScenes.find((item) => item.id === spatialSceneSelect.value);
    if (!scene || !scene.cues.length) return;
    if (spatialAnchor && !spatialSceneAnchors.some((item) => item.anchor === spatialAnchor)) {
      try { spatialAnchor.delete(); } catch (_) {}
    }
    spatialAnchor = null;
    spatialPlacedGuidance = null;
    spatialLatestHit = null;
    spatialGuidanceSteps = scene.cues.map((cue) => ({ ...cue }));
    spatialGuidanceSequenceId = "saved-" + scene.id + "-" + Date.now();
    spatialStepIndex = 0;
    spatialStepConfirmed = false;
    spatialSequenceFinished = false;
    setSuggestedSpatialAim();
    syncSpatialGuidance();
    syncSpatialButtons();
    syncSpatialSceneControls();
    void rebuildSpatialHitTestSource();
    setSpatialStatus("Loaded “" + scene.name + "”. Align and place each saved cue again; this browser cannot restore physical anchor positions across sessions.", "aiming");
  }

  function clearPinnedSpatialCues() {
    if (!spatialSceneAnchors.length) return;
    for (const item of spatialSceneAnchors) {
      try { item.anchor.delete(); } catch (_) {}
    }
    spatialSceneAnchors = [];
    if (!spatialAnchor) spatialPlacedGuidance = null;
    syncSpatialButtons();
    syncSpatialSequenceControls();
    syncSpatialSceneControls();
    setSpatialStatus("Pinned markers cleared from this session. Saved scene templates remain on this device.", "normal");
  }

  refreshSpatialSceneSelect();

  async function checkSpatialArSupport() {
    if (!navigator.xr || typeof navigator.xr.isSessionSupported !== "function") {
      spatialArButton.hidden = true;
      return;
    }
    try {
      spatialFeatureSupported = await navigator.xr.isSessionSupported("immersive-ar");
      spatialArButton.hidden = !spatialFeatureSupported;
      spatialArButton.disabled = !spatialFeatureSupported;
      if (spatialFeatureSupported) {
        spatialArButton.title = "Experimental WebXR surface anchors; opening this pauses live voice";
      }
    } catch (_) {
      spatialFeatureSupported = false;
      spatialArButton.hidden = true;
    }
  }

  function compileSpatialShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Could not create the WebGL shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader compilation failed.";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createSpatialRenderer(gl) {
    const vertexShader = compileSpatialShader(gl, gl.VERTEX_SHADER,
      "attribute vec3 aPosition; uniform mat4 uModelView; uniform mat4 uProjection; void main(){ gl_Position = uProjection * uModelView * vec4(aPosition,1.0); }");
    const fragmentShader = compileSpatialShader(gl, gl.FRAGMENT_SHADER,
      "precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = uColor; }");
    const program = gl.createProgram();
    if (!program) throw new Error("Could not create the WebGL program.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "WebGL program linking failed.";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    const position = gl.getAttribLocation(program, "aPosition");
    const modelView = gl.getUniformLocation(program, "uModelView");
    const projection = gl.getUniformLocation(program, "uProjection");
    const color = gl.getUniformLocation(program, "uColor");
    if (position < 0 || !modelView || !projection || !color) {
      gl.deleteProgram(program);
      throw new Error("WebGL spatial marker bindings are unavailable.");
    }

    function makeRing(radius) {
      const vertices = [];
      const segments = 48;
      const lift = 0.006;
      for (let i = 0; i < segments; i += 1) {
        const a = Math.PI * 2 * i / segments;
        const b = Math.PI * 2 * (i + 1) / segments;
        vertices.push(Math.cos(a) * radius, lift, Math.sin(a) * radius);
        vertices.push(Math.cos(b) * radius, lift, Math.sin(b) * radius);
      }
      const cross = radius * 0.45;
      vertices.push(-cross, lift, 0, cross, lift, 0, 0, lift, -cross, 0, lift, cross);
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error("Could not create the spatial marker buffer.");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      return { buffer, count: vertices.length / 3 };
    }

    const tagVs = compileSpatialShader(gl, gl.VERTEX_SHADER,
      "attribute vec3 aPosition; attribute vec2 aUv; uniform mat4 uModelView; uniform mat4 uProjection; varying vec2 vUv; void main(){ vUv=aUv; gl_Position=uProjection*uModelView*vec4(aPosition,1.0); }");
    const tagFs = compileSpatialShader(gl, gl.FRAGMENT_SHADER,
      "precision mediump float; uniform sampler2D uTexture; varying vec2 vUv; void main(){ gl_FragColor=texture2D(uTexture,vUv); }");
    const tagProgram = gl.createProgram();
    if (!tagProgram) throw new Error("Could not create the spatial cue-card program.");
    gl.attachShader(tagProgram, tagVs); gl.attachShader(tagProgram, tagFs); gl.linkProgram(tagProgram);
    gl.deleteShader(tagVs); gl.deleteShader(tagFs);
    if (!gl.getProgramParameter(tagProgram, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(tagProgram) || "Spatial cue-card shader linking failed.";
      gl.deleteProgram(tagProgram); throw new Error(message);
    }
    const tagPosition = gl.getAttribLocation(tagProgram, "aPosition");
    const tagUv = gl.getAttribLocation(tagProgram, "aUv");
    const tagModelView = gl.getUniformLocation(tagProgram, "uModelView");
    const tagProjection = gl.getUniformLocation(tagProgram, "uProjection");
    const tagSampler = gl.getUniformLocation(tagProgram, "uTexture");
    if (tagPosition < 0 || tagUv < 0 || !tagModelView || !tagProjection || !tagSampler) {
      gl.deleteProgram(tagProgram); throw new Error("Spatial cue-card shader bindings are unavailable.");
    }
    const tagBuffer = gl.createBuffer();
    if (!tagBuffer) throw new Error("Could not create the spatial cue-card geometry.");
    gl.bindBuffer(gl.ARRAY_BUFFER, tagBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.28,-0.14,0,0,0, 0.28,-0.14,0,1,0,
      -0.28, 0.14,0,0,1, 0.28, 0.14,0,1,1
    ]), gl.STATIC_DRAW);
    const tagCanvas = document.createElement("canvas");
    tagCanvas.width = 512; tagCanvas.height = 256;
    const tagContext = tagCanvas.getContext("2d");
    if (!tagContext) { gl.deleteBuffer(tagBuffer); gl.deleteProgram(tagProgram); throw new Error("Could not create the spatial cue-card canvas."); }
    const tagTexture = gl.createTexture();
    if (!tagTexture) { gl.deleteBuffer(tagBuffer); gl.deleteProgram(tagProgram); throw new Error("Could not create the spatial cue-card texture."); }
    gl.bindTexture(gl.TEXTURE_2D, tagTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tagCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return {
      program, position, modelView, projection, color,
      anchorRing: makeRing(0.075), previewRing: makeRing(0.045),
      tagProgram, tagPosition, tagUv, tagModelView, tagProjection, tagSampler,
      tagBuffer, tagTexture, tagCanvas, tagContext
    };
  }

  function multiplySpatialMatrices(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function drawSpatialRing(gl, view, transformMatrix, ring, color) {
    if (!spatialRenderer || !transformMatrix) return;
    const modelView = multiplySpatialMatrices(view.transform.inverse.matrix, transformMatrix);
    gl.useProgram(spatialRenderer.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, ring.buffer);
    gl.enableVertexAttribArray(spatialRenderer.position);
    gl.vertexAttribPointer(spatialRenderer.position, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(spatialRenderer.modelView, false, modelView);
    gl.uniformMatrix4fv(spatialRenderer.projection, false, view.projectionMatrix);
    gl.uniform4fv(spatialRenderer.color, color);
    gl.drawArrays(gl.LINES, 0, ring.count);
  }


  function updateSpatialTagTexture(guidance) {
    if (!spatialGl || !spatialRenderer) return;
    const canvas = spatialRenderer.tagCanvas, ctx = spatialRenderer.tagContext, gl = spatialGl;
    const width = canvas.width, height = canvas.height;
    function roundedRect(x,y,w,h,r) {
      ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
      ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
      ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
    }
    function wrapText(value,maxWidth,maxLines) {
      const words=String(value||"").trim().split(/\s+/).filter(Boolean), lines=[];
      while(words.length && lines.length<maxLines) {
        let line=words.shift();
        while(words.length && ctx.measureText(line+" "+words[0]).width<=maxWidth) line+=" "+words.shift();
        if(words.length && lines.length===maxLines-1) {
          while(line.length>1 && ctx.measureText(line+"…").width>maxWidth) line=line.slice(0,-1);
          line+="…"; words.length=0;
        }
        lines.push(line);
      }
      return lines;
    }
    ctx.clearRect(0,0,width,height); ctx.fillStyle="rgba(7,11,17,0.96)";
    roundedRect(3,3,width-6,height-6,24); ctx.fill();
    ctx.lineWidth=3; ctx.strokeStyle="rgba(143,245,216,0.94)"; ctx.stroke();
    ctx.fillStyle="#9cf5da"; ctx.font="700 17px system-ui, sans-serif"; ctx.fillText("MOINA  /  SPATIAL CUE",24,36);
    const label=String(guidance && guidance.label || "Spatial marker").trim().slice(0,72);
    ctx.font="700 31px system-ui, sans-serif";
    if(ctx.measureText(label).width>width-48) ctx.font="700 25px system-ui, sans-serif";
    if(ctx.measureText(label).width>width-48) ctx.font="700 20px system-ui, sans-serif";
    ctx.fillStyle="#ffffff"; ctx.fillText(label||"Spatial marker",24,88);
    ctx.font="500 22px system-ui, sans-serif"; ctx.fillStyle="#f0f3f6";
    wrapText(guidance && guidance.instruction || "Aim the ring at the target and place the cue yourself.",width-48,2)
      .forEach((line,i)=>ctx.fillText(line,24,130+i*29));
    ctx.font="500 16px system-ui, sans-serif"; ctx.fillStyle="#aebdc8";
    const hints=wrapText(guidance && guidance.hint || "User-aligned surface anchor",width-48,1);
    if(hints.length)ctx.fillText(hints[0],24,218);
    gl.bindTexture(gl.TEXTURE_2D,spatialRenderer.tagTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  }

  function drawSpatialTag(gl,view,anchorMatrix) {
    if(!spatialRenderer || !anchorMatrix)return;
    // Keep the card's position attached to the surface anchor while making its face readable.
    const raisedAnchor=new Float32Array(anchorMatrix); raisedAnchor[13]+=0.22;
    const anchorInView=multiplySpatialMatrices(view.transform.inverse.matrix,raisedAnchor);
    const modelView=new Float32Array([
      1,0,0,0, 0,1,0,0, 0,0,1,0,
      anchorInView[12],anchorInView[13],anchorInView[14],1
    ]);
    gl.useProgram(spatialRenderer.tagProgram); gl.bindBuffer(gl.ARRAY_BUFFER,spatialRenderer.tagBuffer);
    const stride=5*Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(spatialRenderer.tagPosition);
    gl.vertexAttribPointer(spatialRenderer.tagPosition,3,gl.FLOAT,false,stride,0);
    gl.enableVertexAttribArray(spatialRenderer.tagUv);
    gl.vertexAttribPointer(spatialRenderer.tagUv,2,gl.FLOAT,false,stride,3*Float32Array.BYTES_PER_ELEMENT);
    gl.uniformMatrix4fv(spatialRenderer.tagModelView,false,modelView);
    gl.uniformMatrix4fv(spatialRenderer.tagProjection,false,view.projectionMatrix);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,spatialRenderer.tagTexture);
    gl.uniform1i(spatialRenderer.tagSampler,0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }

  function setSpatialStatus(message, mode) {
    spatialStatus.textContent = message;
    spatialStatus.dataset.kind = mode || "normal";
    spatialStatusMode = mode || "";
  }

  function spatialRegionToAim(region) {
    const offsets = {
      "center": { x: 0, y: 0 },
      "upper-left": { x: -0.38, y: 0.28 },
      "upper-right": { x: 0.38, y: 0.28 },
      "lower-left": { x: -0.38, y: -0.28 },
      "lower-right": { x: 0.38, y: -0.28 }
    };
    return offsets[region] || offsets.center;
  }

  function activeSpatialGuidance() {
    if (spatialGuidanceSteps.length && spatialStepIndex < spatialGuidanceSteps.length) {
      return spatialGuidanceSteps[spatialStepIndex];
    }
    return latestVisualGuidance;
  }

  function suggestedSpatialRegion() {
    const guidance = activeSpatialGuidance();
    return guidance && guidance.screenRegion ? guidance.screenRegion : "center";
  }

  function setSuggestedSpatialAim() {
    const suggested = spatialRegionToAim(suggestedSpatialRegion());
    spatialSuggestedAimX = suggested.x;
    spatialSuggestedAimY = suggested.y;
    spatialAimOffsetX = suggested.x;
    spatialAimOffsetY = suggested.y;
    syncSpatialAimLabel();
  }

  function spatialAimDescription(x, y) {
    const horizontal = x < -0.07 ? "left" : (x > 0.07 ? "right" : "");
    const vertical = y > 0.07 ? "up" : (y < -0.07 ? "down" : "");
    return [vertical, horizontal].filter(Boolean).join("-") || "center";
  }

  function syncSpatialAimLabel() {
    if (!spatialAimLabel) return;
    const region = suggestedSpatialRegion().replace("-", " ");
    const dx = Math.round((spatialAimOffsetX - spatialSuggestedAimX) / 0.12);
    const dy = Math.round((spatialAimOffsetY - spatialSuggestedAimY) / 0.12);
    const adjustments = [];
    if (dx !== 0) adjustments.push(Math.abs(dx) + " step" + (Math.abs(dx) === 1 ? "" : "s") + (dx < 0 ? " left" : " right"));
    if (dy !== 0) adjustments.push(Math.abs(dy) + " step" + (Math.abs(dy) === 1 ? "" : "s") + (dy < 0 ? " down" : " up"));
    const current = spatialAimDescription(spatialAimOffsetX, spatialAimOffsetY);
    if (!spatialOffsetRaySupported) {
      spatialAimLabel.textContent = latestVisualGuidance
        ? "Moina suggested " + region + ", but this browser uses a center ray. Move the phone until the ring is over the intended object."
        : "No recent AI region; this browser uses a center ray. Move the phone until the ring is over the intended object.";
    } else if (latestVisualGuidance) {
      spatialAimLabel.textContent = "Moina suggested " + region + "; ray aims " + current +
        (adjustments.length ? " · nudged " + adjustments.join(", ") : "") + ".";
    } else {
      spatialAimLabel.textContent = "No recent AI region; ray aims " + current + ". Adjust and confirm the ring before placing.";
    }
  }

  function syncSpatialSequenceControls() {
    const hasSession = Boolean(spatialSession);
    spatialStepPanel.hidden = !hasSession;
    if (!hasSession) return;

    const hasSequence = spatialGuidanceSteps.length > 1;
    const total = Math.max(1, spatialGuidanceSteps.length);
    const current = Math.min(total, spatialStepIndex + 1);
    const isLastStep = spatialStepIndex >= total - 1;
    const hasCue = hasSpatialCueForCurrentStep();
    spatialStepProgress.textContent = spatialSequenceFinished
      ? "GUIDE COMPLETE"
      : hasSequence
        ? "STEP " + current + " / " + total
        : hasCue ? "CUE PLACED" : spatialLatestHit ? "SURFACE FOUND" : "READY";
    spatialStepMessage.textContent = spatialSequenceFinished
      ? "You're all set. Your cues will stay visible until you finish the guide."
      : hasCue
        ? (hasSequence
          ? (isLastStep ? "Last target is placed. Tap Finish guide when it looks right." : "Target placed. Tap Next step when you're ready.")
          : "Cue placed. You're all set — tap Done when you're ready to return.")
        : spatialPlacing || spatialPendingPlacement
          ? "Placing your cue. Hold the phone steady for a moment."
          : spatialLatestHit
            ? "Surface found. Tap Place cue."
            : "Move the phone slowly until the ring rests on a surface.";

    if (spatialProgressTrack) {
      spatialProgressTrack.hidden = !hasSequence;
      spatialProgressTrack.replaceChildren();
      spatialProgressTrack.setAttribute("aria-valuemax", String(total));
      spatialProgressTrack.setAttribute("aria-valuenow", String(spatialSequenceFinished ? total : current));
      if (hasSequence) {
        for (let index = 0; index < total; index += 1) {
          const segment = document.createElement("span");
          segment.className = "spatial-progress-segment" +
            (spatialSequenceFinished || index < spatialStepIndex ? " is-complete" : index === spatialStepIndex ? " is-current" : "");
          segment.setAttribute("aria-hidden", "true");
          spatialProgressTrack.appendChild(segment);
        }
      }
    }

    const busy = spatialPlacing || spatialPendingPlacement || spatialHitSourcePending;
    spatialStepButtons.previous.disabled = spatialStepIndex <= 0 || busy;
    spatialStepButtons.confirm.disabled = true;
    spatialStepButtons.next.textContent = isLastStep ? "Finish" : "Next";
    spatialStepButtons.next.disabled = !hasCue || spatialSequenceFinished || busy;
    spatialStepButtons.finish.disabled = true;
  }

  function syncSpatialGuidance() {
    const guidance = activeSpatialGuidance();
    if (!guidance) {
      spatialTargetLabel.textContent = "Ready when you are";
      spatialTargetInstruction.textContent = "Ask Moina what you want help with. I'll guide you one step at a time.";
      spatialTargetHint.textContent = "Move slowly until the ring rests on the surface you want.";
    } else {
      spatialTargetLabel.textContent = guidance.label;
      spatialTargetInstruction.textContent = guidance.instruction || "No next-step instruction was provided.";
      spatialTargetHint.textContent = guidance.hint || "Moina supplied no extra target description.";
    }
    syncSpatialAimLabel();
    syncSpatialSequenceControls();
  }

  function clearCurrentSpatialAnchorForStepChange() {
    if (spatialAnchor && !spatialSceneAnchors.some((item) => item.anchor === spatialAnchor)) {
      try { spatialAnchor.delete(); } catch (_) {}
    }
    spatialAnchor = null;
    spatialPlacedGuidance = null;
    spatialLatestHit = null;
    spatialLastHudHitState = null;
    spatialPendingPlacement = false;
    spatialPlacing = false;
    spatialPendingPlacementAt = 0;
    spatialAnchorPoseLostAt = 0;
    spatialAnchorPoseWarningShown = false;
  }

  function moveSpatialGuidanceStep(delta) {
    if (!spatialSession || spatialGuidanceSteps.length < 2) return;
    if (spatialPlacing || spatialPendingPlacement || spatialHitSourcePending) return;
    if (delta > 0 && (!spatialStepConfirmed || !hasSpatialCueForCurrentStep())) return;
    const nextIndex = Math.max(0, Math.min(spatialGuidanceSteps.length - 1, spatialStepIndex + delta));
    if (nextIndex === spatialStepIndex) return;
    clearCurrentSpatialAnchorForStepChange();
    spatialStepIndex = nextIndex;
    spatialStepConfirmed = false;
    spatialSequenceFinished = false;
    setSuggestedSpatialAim();
    syncSpatialGuidance();
    syncSpatialButtons();
    void rebuildSpatialHitTestSource();
    setSpatialStatus("Step " + (spatialStepIndex + 1) + " of " + spatialGuidanceSteps.length + ": align the ring with this step's target and place a new cue anchor.", "aiming");
  }

  function confirmSpatialGuidanceStep() {
    if (!spatialSession || !hasSpatialCueForCurrentStep() || spatialSequenceFinished || spatialStepConfirmed) return;
    spatialStepConfirmed = true;
    syncSpatialSequenceControls();
    setSpatialStatus("Step " + (spatialStepIndex + 1) + " confirmed by you. Check the visible result before advancing.", "anchored");
  }

  function finishSpatialGuidanceSequence() {
    if (!spatialSession || !spatialStepConfirmed || spatialStepIndex !== spatialGuidanceSteps.length - 1) return;
    spatialSequenceFinished = true;
    syncSpatialButtons();
    syncSpatialSequenceControls();
    setSpatialStatus("Guide complete. All cues are placed.", "anchored");
  }

  function advanceSpatialGuidance() {
    if (!spatialSession || spatialGuidanceSteps.length < 2) return;
    if (spatialPlacing || spatialPendingPlacement || spatialHitSourcePending) return;
    if (!hasSpatialCueForCurrentStep()) return;

    // Tapping Next/Finish confirms the visible cue and removes a separate confirmation step.
    spatialStepConfirmed = true;
    if (spatialAnchor) {
      pinCurrentSpatialCue();
      // Keep the active cue and ask the user to resolve any pinning limit.
      if (spatialAnchor) {
        spatialStepConfirmed = false;
        syncSpatialSequenceControls();
        return;
      }
    }
    if (spatialStepIndex >= spatialGuidanceSteps.length - 1) {
      finishSpatialGuidanceSequence();
      return;
    }
    moveSpatialGuidanceStep(1);
  }

  function syncSpatialButtons() {
    const busy = spatialPlacing || spatialPendingPlacement || spatialHitSourcePending;
    const hasSequence = spatialGuidanceSteps.length > 1;
    const isLastStep = spatialStepIndex >= spatialGuidanceSteps.length - 1;
    const completed = spatialSequenceFinished;
    let phase = "searching";
    let buttonText = "Finding surface…";
    let actionTitle = "SCANNING FOR A SURFACE";
    let hint = "Move your phone slowly until the ring rests over a surface.";
    let disabled = true;

    if (completed) {
      phase = "complete";
      buttonText = "Guide complete";
      actionTitle = "ALL STEPS COMPLETE";
      hint = "You're all set. Tap Done in the top-right corner to return.";
    } else if (busy) {
      phase = "placing";
      buttonText = "Placing cue…";
      actionTitle = "ONE MOMENT";
      hint = "Hold your phone steady while Moina places the cue.";
    } else if (spatialAnchor && hasSequence) {
      phase = "anchored";
      buttonText = isLastStep ? "Finish guide" : "Next step";
      actionTitle = isLastStep ? "FINAL TARGET READY" : "TARGET PLACED";
      hint = isLastStep
        ? "Does it look right? Finish the guide when you're ready."
        : "Does it look right? Tap Next step to continue.";
      disabled = false;
    } else if (spatialAnchor) {
      phase = "anchored";
      buttonText = "Cue placed ✓";
      actionTitle = "TARGET PLACED";
      hint = "You're all set. Tap Done in the top-right corner to return.";
      disabled = true;
    } else if (spatialLatestHit) {
      phase = "surface";
      buttonText = "Place cue";
      actionTitle = "SURFACE FOUND";
      hint = "The ring is on a surface. Tap Place cue to continue.";
      disabled = false;
    }

    placeSpatialAnchorButton.textContent = buttonText;
    placeSpatialAnchorButton.disabled = disabled;
    spatialHud.dataset.phase = phase;
    if (spatialActionEyebrow) spatialActionEyebrow.textContent = actionTitle;
    if (spatialActionHint) spatialActionHint.textContent = hint;
    clearSpatialAnchorButton.disabled = !spatialAnchor;
    const aimDisabled = !spatialSession || !spatialOffsetRaySupported || Boolean(spatialAnchor) || busy;
    Object.values(spatialAimButtons).forEach((button) => { button.disabled = aimDisabled; });
    syncSpatialSceneControls();
  }

  function createSpatialOffsetRay() {
    if (typeof XRRay !== "function") return null;
    try {
      return new XRRay(
        { x: 0, y: 0, z: 0, w: 1 },
        { x: spatialAimOffsetX, y: spatialAimOffsetY, z: -1, w: 0 }
      );
    } catch (_) {
      return null;
    }
  }

  async function rebuildSpatialHitTestSource(session = spatialSession) {
    if (!session || session !== spatialSession || !spatialViewerSpace) return;
    const generation = ++spatialHitSourceGeneration;
    const oldSource = spatialHitSource;
    spatialHitSource = null;
    spatialLatestHit = null;
    spatialHitSourcePending = true;
    if (oldSource) {
      try { oldSource.cancel(); } catch (_) {}
    }
    syncSpatialButtons();
    let source = null;
    let offsetRayUsed = false;
    const ray = createSpatialOffsetRay();
    if (ray) {
      try {
        source = await session.requestHitTestSource({ space: spatialViewerSpace, offsetRay: ray });
        offsetRayUsed = true;
      } catch (_) {
        // Older implementations may provide hit testing but reject the offset-ray option.
      }
    }
    if (!source && session === spatialSession && generation === spatialHitSourceGeneration) {
      try {
        source = await session.requestHitTestSource({ space: spatialViewerSpace });
      } catch (_) {
        if (session === spatialSession && generation === spatialHitSourceGeneration) {
          spatialHitSourcePending = false;
          spatialOffsetRaySupported = false;
          syncSpatialAimLabel();
          syncSpatialButtons();
          setSpatialStatus("The browser could not create a hit-test ray. Exit and restart Spatial AR, or use the normal Co-Pilot fallback.", "warning");
        }
        return;
      }
    }
    if (session !== spatialSession || generation !== spatialHitSourceGeneration) {
      if (source) { try { source.cancel(); } catch (_) {} }
      return;
    }
    spatialHitSource = source;
    spatialHitSourcePending = false;
    spatialOffsetRaySupported = offsetRayUsed;
    syncSpatialAimLabel();
    syncSpatialButtons();
    if (!offsetRayUsed && (Math.abs(spatialAimOffsetX) > 0.01 || Math.abs(spatialAimOffsetY) > 0.01)) {
      setSpatialStatus("This browser fell back to a center ray. Move the phone until the target is centered in the ring, then place the cue.", "warning");
    } else {
      setSpatialStatus("Aim ray ready. Check the ring against the intended object, nudge the ray if needed, and confirm placement.", "aiming");
    }
  }

  function nudgeSpatialAim(dx, dy) {
    if (!spatialSession || !spatialOffsetRaySupported || spatialAnchor || spatialPlacing || spatialPendingPlacement || spatialHitSourcePending) return;
    spatialAimOffsetX = Math.max(-0.62, Math.min(0.62, spatialAimOffsetX + dx));
    spatialAimOffsetY = Math.max(-0.5, Math.min(0.5, spatialAimOffsetY + dy));
    syncSpatialAimLabel();
    setSpatialStatus("Adjusting the target ray. Wait for the ring to reappear and verify it points at the intended object.", "aiming");
    void rebuildSpatialHitTestSource();
  }

  async function startSpatialAr() {
    if (!spatialFeatureSupported || !navigator.xr) {
      setStatus("Spatial AR is not supported in this browser. V2 camera tracking remains available.", "warning");
      return;
    }
    if (spatialSession) return;
    const canKeepVoiceDuringSpatialAr = Boolean(active && setupReady && !stopping &&
      socket && socket.readyState === WebSocket.OPEN && audioContext && microphoneStream &&
      microphoneStream.getAudioTracks().some((track) => track.readyState === "live"));
    const hasCopilotSession = Boolean(active || starting || microphoneStream || socket);
    if (hasCopilotSession) {
      const prompt = canKeepVoiceDuringSpatialAr
        ? "Open AR Guide? Moina will keep listening and speaking, but will not receive new camera images until you exit AR."
        : "Open AR Guide? Your current voice session will end before AR starts. Continue?";
      if (!window.confirm(prompt)) return;
      if (canKeepVoiceDuringSpatialAr) {
        if (!suspendCameraForSpatialAr()) {
          setStatus("Couldn't release the camera for Spatial AR. Live voice was left untouched.", "warning");
          return;
        }
        setStatus("Spatial AR is starting. Live voice stays connected; camera frames are paused until you exit AR.");
      } else {
        stopCopilot(true);
      }
    }

    spatialGuidanceSteps = latestVisualGuidance && Array.isArray(latestVisualGuidance.steps)
      ? latestVisualGuidance.steps.slice(0, 5)
      : latestVisualGuidance ? [latestVisualGuidance] : [];
    spatialGuidanceSequenceId = "live-" + Date.now();
    spatialStepIndex = 0;
    spatialStepConfirmed = false;
    spatialSequenceFinished = false;
    syncSpatialGuidance();
    if (spatialAdvanced) spatialAdvanced.open = false;
    spatialHud.dataset.phase = "searching";
    spatialHud.hidden = false;
    spatialHud.classList.add("is-preparing");
    setSpatialStatus("Opening the device's spatial tracking session…", "starting");
    spatialArButton.disabled = true;

    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true });
    if (!gl) {
      spatialHud.hidden = true;
      spatialHud.classList.remove("is-preparing");
      spatialArButton.disabled = false;
      setStatus("This browser could not create a WebGL context for spatial AR.", "error");
      return;
    }

    // Call requestSession during the user's click gesture. Unsupported required
    // features fail closed rather than silently degrading to screen-space markers.
    let sessionPromise;
    try {
      sessionPromise = navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["local", "hit-test", "anchors", "dom-overlay"],
        domOverlay: { root: spatialHud }
      });
    } catch (error) {
      spatialHud.hidden = true;
      spatialHud.classList.remove("is-preparing");
      spatialArButton.disabled = false;
      setStatus(error && error.message ? error.message : "Could not start spatial AR.", "error");
      void resumeCameraAfterSpatialAr("Spatial AR could not start");
      return;
    }

    try {
      const session = await sessionPromise;
      spatialSession = session;
      spatialGl = gl;
      await gl.makeXRCompatible();
      const layer = new XRWebGLLayer(session, gl, { alpha: true, depth: true, antialias: true });
      session.updateRenderState({ baseLayer: layer });
      spatialReferenceSpace = await session.requestReferenceSpace("local");
      spatialViewerSpace = await session.requestReferenceSpace("viewer");
      setSuggestedSpatialAim();
      await rebuildSpatialHitTestSource(session);
      spatialRenderer = createSpatialRenderer(gl);
      spatialAnchor = null;
      spatialSceneAnchors = [];
      spatialPlacedGuidance = null;
      spatialLatestHit = null;
      spatialLastHudHitState = null;
      spatialPendingPlacement = false;
      spatialStepConfirmed = false;
      spatialSequenceFinished = false;
      spatialPlacing = false;
      spatialStatusMode = "";
      spatialLastStatusAt = 0;
      spatialPendingPlacementAt = 0;
      spatialAnchorPoseLostAt = 0;
      spatialAnchorPoseWarningShown = false;
      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        setSpatialStatus("The graphics context was lost. Exiting Spatial AR safely; start Co-Pilot again to resume voice.", "warning");
        if (spatialSession) void spatialSession.end();
      }, { once: true });
      session.addEventListener("visibilitychange", () => {
        if (spatialSession !== session) return;
        if (session.visibilityState === "hidden") {
          setSpatialStatus("The AR view is temporarily backgrounded. Return to it and check the marker after tracking resumes.", "warning");
        } else if (spatialAnchor) {
          setSpatialStatus("AR view resumed. Check the ring against the surface for any drift.", "anchored");
        } else {
          setSpatialStatus("AR view resumed. Move slowly to reacquire a surface.", "searching");
        }
      });
      spatialHud.classList.remove("is-preparing");
      syncSpatialGuidance();
      setSpatialStatus("Guide ready · move until the ring appears", spatialOffsetRaySupported ? "aiming" : "normal");
      syncSpatialAimLabel();
      syncSpatialButtons();
      session.addEventListener("end", finishSpatialAr, { once: true });
      session.requestAnimationFrame(drawSpatialFrame);
    } catch (error) {
      const failedSession = spatialSession;
      spatialSession = null;
      if (failedSession) {
        try { await failedSession.end(); } catch (_) {}
      }
      if (spatialHitSource) { try { spatialHitSource.cancel(); } catch (_) {} }
      spatialHitSource = null;
      spatialViewerSpace = null;
      spatialReferenceSpace = null;
      spatialAnchor = null;
      spatialSceneAnchors = [];
      spatialLatestHit = null;
      spatialPendingPlacement = false;
      spatialPlacing = false;
      spatialPendingPlacementAt = 0;
      spatialAnchorPoseLostAt = 0;
      spatialAnchorPoseWarningShown = false;
      releaseSpatialRenderer();
      spatialHud.hidden = true;
      spatialHud.classList.remove("is-preparing");
      spatialArButton.disabled = false;
      const explanation = error && error.name === "NotSupportedError"
        ? "This device/browser does not support every feature required for world-anchored AR (hit-test, anchors, and DOM overlay). Use a supported Android browser; V2 remains available."
        : (error && error.message ? error.message : "Spatial AR could not be started. Check browser support and camera permissions.");
      setStatus(explanation, "warning");
      void resumeCameraAfterSpatialAr("Spatial AR could not start");
    }
  }

  function drawSpatialFrame(time, frame) {
    const session = frame.session;
    if (!spatialSession || session !== spatialSession || !spatialGl || !spatialReferenceSpace) return;
    session.requestAnimationFrame(drawSpatialFrame);
    const gl = spatialGl;
    const layer = session.renderState.baseLayer;
    const viewerPose = frame.getViewerPose(spatialReferenceSpace);
    if (!viewerPose) return;

    spatialLatestHit = null;
    if (spatialHitSource) {
      try {
        const hits = frame.getHitTestResults(spatialHitSource);
        if (hits.length) spatialLatestHit = hits[0];
      } catch (_) {}
    }
    if (!spatialAnchor && !spatialPendingPlacement && !spatialPlacing) {
      const hasHit = Boolean(spatialLatestHit);
      if (spatialLastHudHitState !== hasHit) {
        spatialLastHudHitState = hasHit;
        syncSpatialSequenceControls();
      }
    }
    if (spatialPendingPlacement && !spatialLatestHit && spatialPendingPlacementAt && time - spatialPendingPlacementAt > 1800) {
      spatialPendingPlacement = false;
      spatialPendingPlacementAt = 0;
      setSpatialStatus("Surface detection was lost before placement. Hold the ring over a visible surface and tap Place cue anchor again.", "warning");
    }
    syncSpatialButtons();

    if (spatialPendingPlacement && spatialLatestHit && !spatialPlacing && !spatialAnchor) {
      spatialPendingPlacement = false;
      spatialPendingPlacementAt = 0;
      spatialPlacing = true;
      syncSpatialButtons();
      const hitForAnchor = spatialLatestHit;
      setSpatialStatus(spatialPlacedGuidance
        ? "Anchoring “" + spatialPlacedGuidance.label + "” cue to the next detected surface point…"
        : "Creating a world anchor on the detected surface…", "placing");
      hitForAnchor.createAnchor().then((anchor) => {
        if (spatialSession !== session) {
          anchor.delete();
          return;
        }
        spatialAnchor = anchor;
        spatialPlacing = false;
        updateSpatialTagTexture(spatialPlacedGuidance);
        setSpatialStatus(spatialPlacedGuidance
          ? "Cue placed · " + spatialPlacedGuidance.label
          : "Cue placed", "anchored");
        syncSpatialButtons();
        syncSpatialSequenceControls();
      }).catch(() => {
        spatialPlacing = false;
        setSpatialStatus("The device could not create a persistent anchor. Scan a well-lit, textured surface and try again.", "warning");
        syncSpatialButtons();
        syncSpatialSequenceControls();
      });
    }

    if (time - spatialLastStatusAt > 650) {
      spatialLastStatusAt = time;
      if (!spatialAnchor && !spatialPendingPlacement && !spatialPlacing) {
        setSpatialStatus(spatialLatestHit
          ? "Surface found"
          : "Scanning for a surface", spatialLatestHit ? "surface" : "searching");
      }
    }

    let currentAnchorPose = null;
    if (spatialAnchor) {
      try { currentAnchorPose = frame.getPose(spatialAnchor.anchorSpace, spatialReferenceSpace); } catch (_) {}
      if (!currentAnchorPose) {
        if (!spatialAnchorPoseLostAt) spatialAnchorPoseLostAt = time;
        if (!spatialAnchorPoseWarningShown && time - spatialAnchorPoseLostAt > 900) {
          spatialAnchorPoseWarningShown = true;
          setSpatialStatus("Spatial tracking is reacquiring this anchor. Hold the phone steady, then slowly scan the surrounding surface.", "warning");
        }
      } else {
        spatialAnchorPoseLostAt = 0;
        if (spatialAnchorPoseWarningShown) {
          spatialAnchorPoseWarningShown = false;
          setSpatialStatus("Tracking recovered. Move slowly and check that the ring still lines up with the intended target.", "anchored");
        }
      }
    } else if (!spatialSceneAnchors.length) {
      spatialAnchorPoseLostAt = 0;
      spatialAnchorPoseWarningShown = false;
    }

    const pinnedPoses = [];
    for (const item of spatialSceneAnchors) {
      let pose = null;
      try { pose = frame.getPose(item.anchor.anchorSpace, spatialReferenceSpace); } catch (_) {}
      if (pose) pinnedPoses.push({ item, pose });
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const view of viewerPose.views) {
      const viewport = layer.getViewport(view);
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(viewport.x, viewport.y, viewport.width, viewport.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);

      for (const pinned of pinnedPoses) {
        drawSpatialRing(gl, view, pinned.pose.transform.matrix, spatialRenderer.anchorRing, [0.32, 1.0, 0.77, 0.98]);
      }
      if (spatialAnchor) {
        if (currentAnchorPose) {
          drawSpatialRing(gl, view, currentAnchorPose.transform.matrix, spatialRenderer.anchorRing, [0.32, 1.0, 0.77, 0.98]);
          drawSpatialTag(gl, view, currentAnchorPose.transform.matrix);
        }
      } else if (pinnedPoses.length) {
        const latestPinned = pinnedPoses[pinnedPoses.length - 1];
        drawSpatialTag(gl, view, latestPinned.pose.transform.matrix);
      } else if (spatialLatestHit) {
        const hitPose = spatialLatestHit.getPose(spatialReferenceSpace);
        if (hitPose) drawSpatialRing(gl, view, hitPose.transform.matrix, spatialRenderer.previewRing, [1.0, 1.0, 1.0, 0.95]);
      }
    }
  }

  function releaseSpatialRenderer() {
    if (spatialGl && spatialRenderer) {
      try {
        spatialGl.deleteBuffer(spatialRenderer.anchorRing.buffer);
        spatialGl.deleteBuffer(spatialRenderer.previewRing.buffer);
        spatialGl.deleteProgram(spatialRenderer.program);
        spatialGl.deleteBuffer(spatialRenderer.tagBuffer);
        spatialGl.deleteTexture(spatialRenderer.tagTexture);
        spatialGl.deleteProgram(spatialRenderer.tagProgram);
      } catch (_) {}
    }
    spatialRenderer = null;
    spatialGl = null;
  }

  function finishSpatialAr() {
    // The exit button and XRSession's "end" event can both reach cleanup.
    // Ignore duplicate calls once the session and GL resources are released.
    if (!spatialSession && !spatialGl && !spatialRenderer) return;
    const oldAnchor = spatialAnchor;
    const oldSceneAnchors = spatialSceneAnchors.slice();
    const oldHitSource = spatialHitSource;
    spatialSession = null;
    spatialHitSource = null;
    if (oldHitSource) { try { oldHitSource.cancel(); } catch (_) {} }
    spatialViewerSpace = null;
    spatialReferenceSpace = null;
    spatialAnchor = null;
    spatialSceneAnchors = [];
    spatialLatestHit = null;
    spatialPendingPlacement = false;
    spatialPlacing = false;
    spatialPendingPlacementAt = 0;
    spatialAnchorPoseLostAt = 0;
    spatialAnchorPoseWarningShown = false;
    spatialHitSourcePending = false;
    spatialHitSourceGeneration += 1;
    spatialOffsetRaySupported = false;
    spatialAimOffsetX = 0;
    spatialAimOffsetY = 0;
    spatialSuggestedAimX = 0;
    spatialSuggestedAimY = 0;
    spatialPlacedGuidance = null;
    spatialGuidanceSteps = [];
    spatialStepIndex = 0;
    spatialStepConfirmed = false;
    spatialSequenceFinished = false;
    if (oldAnchor && !oldSceneAnchors.some((item) => item.anchor === oldAnchor)) {
      try { oldAnchor.delete(); } catch (_) {}
    }
    for (const item of oldSceneAnchors) {
      try { item.anchor.delete(); } catch (_) {}
    }
    spatialSceneAnchors = [];

    // WebXR leaves the XR layer framebuffer bound to the context after the
    // immersive session. Restore the ordinary/default framebuffer before
    // releasing GL objects; this is especially important on mobile browsers.
    const endedGl = spatialGl;
    if (endedGl) {
      try {
        if (!endedGl.isContextLost()) {
          endedGl.bindFramebuffer(endedGl.FRAMEBUFFER, null);
          endedGl.flush();
        }
      } catch (_) {}
    }
    releaseSpatialRenderer();
    exitSpatialArButton.disabled = false;
    spatialHud.hidden = true;
    spatialHud.classList.remove("is-preparing");
    spatialArButton.disabled = !spatialFeatureSupported;
    syncSpatialSceneControls();
    if (active && setupReady && socket && socket.readyState === WebSocket.OPEN && cameraSuspendedForSpatialAr) {
      void resumeCameraAfterSpatialAr("Spatial AR ended");
    } else {
      setStatus("Spatial AR ended. Start Co-Pilot to resume live voice guidance.");
    }
  }

  spatialAimButtons.left.addEventListener("click", () => nudgeSpatialAim(-0.12, 0));
  spatialAimButtons.right.addEventListener("click", () => nudgeSpatialAim(0.12, 0));
  spatialAimButtons.up.addEventListener("click", () => nudgeSpatialAim(0, 0.12));
  spatialAimButtons.down.addEventListener("click", () => nudgeSpatialAim(0, -0.12));
  spatialAimButtons.reset.addEventListener("click", () => {
    if (!spatialSession || !spatialOffsetRaySupported || spatialAnchor || spatialPlacing || spatialPendingPlacement || spatialHitSourcePending) return;
    spatialAimOffsetX = spatialSuggestedAimX;
    spatialAimOffsetY = spatialSuggestedAimY;
    syncSpatialAimLabel();
    setSpatialStatus("Restored Moina's suggested screen region. Check the ring before placing.", "aiming");
    void rebuildSpatialHitTestSource();
  });

  spatialStepButtons.previous.addEventListener("click", () => moveSpatialGuidanceStep(-1));
  spatialStepButtons.confirm.addEventListener("click", confirmSpatialGuidanceStep);
  spatialStepButtons.next.addEventListener("click", advanceSpatialGuidance);
  spatialStepButtons.finish.addEventListener("click", finishSpatialGuidanceSequence);

  placeSpatialAnchorButton.addEventListener("click", () => {
    if (!spatialSession || spatialPlacing || spatialPendingPlacement || spatialHitSourcePending) return;
    if (spatialSequenceFinished) return;

    if (spatialAnchor && spatialGuidanceSteps.length > 1) {
      advanceSpatialGuidance();
      return;
    }
    if (spatialAnchor) {
      setSpatialStatus("Cue placed. You're all set.", "anchored");
      return;
    }
    if (!spatialLatestHit) {
      setSpatialStatus("Move your phone slowly until the ring rests on a surface.", "searching");
      return;
    }

    const currentGuidance = activeSpatialGuidance();
    spatialPlacedGuidance = currentGuidance ? { ...currentGuidance } : null;
    spatialStepConfirmed = false;
    spatialPendingPlacement = true;
    spatialPendingPlacementAt = performance.now();
    syncSpatialButtons();
    setSpatialStatus("Placing cue…", "placing");
  });

  clearSpatialAnchorButton.addEventListener("click", () => {
    if (spatialAnchor) {
      try { spatialAnchor.delete(); } catch (_) {}
      spatialAnchor = null;
      spatialPlacedGuidance = null;
      spatialStepConfirmed = false;
      spatialSequenceFinished = false;
      syncSpatialSequenceControls();
      spatialAnchorPoseLostAt = 0;
      spatialAnchorPoseWarningShown = false;
      setSpatialStatus("Anchor cleared. Aim at a surface and place a new marker.", "searching");
      syncSpatialButtons();
      syncSpatialSequenceControls();
      syncSpatialSceneControls();
    }
  });

  spatialScenePinButton.addEventListener("click", pinCurrentSpatialCue);
  spatialSceneSaveButton.addEventListener("click", saveCurrentSpatialScene);
  spatialSceneLoadButton.addEventListener("click", loadSavedSpatialScene);
  spatialSceneClearButton.addEventListener("click", clearPinnedSpatialCues);
  spatialSceneName.addEventListener("input", syncSpatialSceneControls);
  spatialSceneSelect.addEventListener("change", syncSpatialSceneControls);

  async function requestSpatialArExit() {
    const session = spatialSession;
    if (!session) return;
    exitSpatialArButton.disabled = true;
    setSpatialStatus("Closing Spatial AR and restoring the page…", "normal");
    try {
      await session.end();
      // Usually the "end" event has already run cleanup. This fallback keeps
      // teardown complete if a browser resolves end() before dispatching it.
      if (spatialSession === session) finishSpatialAr();
    } catch (_) {
      exitSpatialArButton.disabled = false;
      setSpatialStatus("Spatial AR could not close cleanly. Use the device or browser Back control to exit, then try again.", "warning");
    }
  }

  exitSpatialArButton.addEventListener("click", () => { void requestSpatialArExit(); });
  spatialArButton.addEventListener("click", () => { void startSpatialAr(); });

  if (!window.AudioContext && window.webkitAudioContext) window.AudioContext = window.webkitAudioContext;

  async function checkBackend() {
    toggleButton.disabled = true;
    try {
      const response = await fetch("/api/health", { cache: "no-store", credentials: "same-origin" });
      const health = await response.json();
      if (!response.ok || !health || health.ok !== true || health.status !== "vertex-live-proxy-configured") {
        throw new Error("The live voice backend isn't ready yet.");
      }
      setStatus("Ready. Tap Start Co-Pilot when you want to share your camera and microphone.");
      setControls("Start Co-Pilot", false);
      setConnectionState("READY", "ready");
      await refreshAvailability();
      if (voiceAvailability && !voiceAvailability.available) setConnectionState("BUSY", "error");
    } catch (error) {
      setControls("Retry service check", false);
      setStatus(error && error.message ? error.message : "Couldn't confirm the live voice service.", "error");
      setAvailability("You can retry this check or reload the page.", "warning");
    }
  }

  setCameraState("Camera paused", "idle");
  setControls("Checking voice…", true);
  void prepareCameraPreview();
  void checkSpatialArSupport();
  void checkBackend();


})();