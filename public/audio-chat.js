(() => {
  "use strict";

  const statusNode = document.querySelector("#status");
  const availabilityNode = document.querySelector("#availability");
  const toggleButton = document.querySelector("#toggleVoice");
  const stopVoiceButton = document.querySelector("#stopVoice");
  const buttonLabel = document.querySelector("#buttonLabel");
  const transcriptNode = document.querySelector("#transcript");
  const clearButton = document.querySelector("#clearTranscript");
  const emptyTranscript = document.querySelector("#emptyTranscript");
  const voicePicker = document.querySelector("#voicePicker");

  const liveVisitorCount = document.querySelector("#liveVisitorCount");
  const totalVisitorCount = document.querySelector("#totalVisitorCount");
  const donationTotalNode = document.querySelector("#donationTotal");
  const donationGoalNode = document.querySelector("#donationGoal");
  const fundProgressBar = document.querySelector("#fundProgressBar");
  const fundProgressFill = document.querySelector("#fundProgressFill");
  const fundContributionSummary = document.querySelector("#fundContributionSummary");
  const fundUpdateStatus = document.querySelector("#fundUpdateStatus");
  const openDonationContact = document.querySelector("#openDonationContact");
  const donationContactDialog = document.querySelector("#donationContactDialog");
  const closeDonationContact = document.querySelector("#closeDonationContact");
  const dismissDonationContact = document.querySelector("#dismissDonationContact");
  const FUND_STATUS_CACHE_KEY = "askmoina.verified-fund-status.v1";

  function readFundStatusCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(FUND_STATUS_CACHE_KEY) || "null");
      if (cached && Number.isSafeInteger(cached.totalPaise) && cached.totalPaise >= 0 &&
          Number.isSafeInteger(cached.targetPaise) && cached.targetPaise > 0) return cached;
    } catch (_) {}
    return null;
  }

  function formatINR(paise) {
    const safePaise = Math.max(0, Math.floor(Number(paise) || 0));
    const rupees = Math.floor(safePaise / 100);
    const remainder = safePaise % 100;
    return "₹" + rupees.toLocaleString("en-IN") +
      (remainder ? "." + String(remainder).padStart(2, "0") : "");
  }

  let fundRenderSequence = 0;
  function renderFundStatus(status, animateFromPaise = null) {
    const totalPaise = Math.max(0, Math.floor(Number(status.totalPaise) || 0));
    const targetPaise = Math.max(1, Math.floor(Number(status.targetPaise) || 100000000));
    const donationCount = Math.max(0, Math.floor(Number(status.donationCount) || 0));
    const progressPercent = Math.min(100, Math.max(0, (totalPaise / targetPaise) * 100));
    if (donationGoalNode) donationGoalNode.textContent = formatINR(targetPaise);
    if (fundProgressFill) fundProgressFill.style.width = progressPercent.toFixed(2) + "%";
    if (fundProgressBar) fundProgressBar.setAttribute("aria-valuenow", progressPercent.toFixed(2));
    if (fundContributionSummary) {
      fundContributionSummary.textContent = donationCount === 0
        ? "No verified contributions recorded yet"
        : donationCount.toLocaleString("en-IN") + (donationCount === 1 ? " verified contribution" : " verified contributions");
    }

    const sequence = ++fundRenderSequence;
    const canAnimate = Number.isFinite(animateFromPaise) && animateFromPaise >= 0 && animateFromPaise < totalPaise;
    if (donationTotalNode && canAnimate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const startedAt = performance.now();
      const duration = 780;
      const from = Math.floor(animateFromPaise);
      const draw = (now) => {
        if (sequence !== fundRenderSequence) return;
        const t = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const displayed = Math.round(from + (totalPaise - from) * eased);
        donationTotalNode.textContent = formatINR(displayed);
        if (t < 1) window.requestAnimationFrame(draw);
      };
      donationTotalNode.textContent = formatINR(from);
      window.requestAnimationFrame(draw);
    } else if (donationTotalNode) {
      donationTotalNode.textContent = formatINR(totalPaise);
    }
  }

  async function refreshDonationStatus() {
    try {
      const response = await fetch("/api/donation/status", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Donation status unavailable");
      const payload = await response.json();
      if (!payload || payload.ok !== true ||
          !Number.isSafeInteger(payload.totalPaise) || payload.totalPaise < 0 ||
          !Number.isSafeInteger(payload.targetPaise) || payload.targetPaise <= 0) {
        throw new Error("Donation status response was invalid");
      }
      const previous = readFundStatusCache();
      const animateFrom = previous && payload.totalPaise >= previous.totalPaise
        ? previous.totalPaise
        : null;
      renderFundStatus(payload, animateFrom);
      try {
        localStorage.setItem(FUND_STATUS_CACHE_KEY, JSON.stringify({
          totalPaise: payload.totalPaise,
          targetPaise: payload.targetPaise,
          donationCount: Math.max(0, Number(payload.donationCount) || 0),
          savedAt: Date.now()
        }));
      } catch (_) {}
      if (fundUpdateStatus) fundUpdateStatus.textContent = "Only confirmed contributions count toward the goal.";
    } catch (_) {
      const cached = readFundStatusCache();
      if (cached) {
        renderFundStatus(cached);
        if (fundUpdateStatus) fundUpdateStatus.textContent = "Showing the last verified total; live refresh is temporarily unavailable.";
      } else {
        if (donationTotalNode) donationTotalNode.textContent = "Unavailable";
        if (fundContributionSummary) fundContributionSummary.textContent = "Verified totals could not be loaded";
        if (fundUpdateStatus) fundUpdateStatus.textContent = "Please try again shortly.";
      }
    }
  }

  if (donationContactDialog && openDonationContact) {
    openDonationContact.addEventListener("click", () => {
      if (typeof donationContactDialog.showModal === "function") donationContactDialog.showModal();
    });
    const closeDialog = () => {
      if (typeof donationContactDialog.close === "function" && donationContactDialog.open) donationContactDialog.close();
    };
    if (closeDonationContact) closeDonationContact.addEventListener("click", closeDialog);
    if (dismissDonationContact) dismissDonationContact.addEventListener("click", closeDialog);
    donationContactDialog.addEventListener("click", (event) => {
      if (event.target === donationContactDialog) closeDialog();
    });
  }

  void refreshDonationStatus();
  window.setInterval(() => { void refreshDonationStatus(); }, 10_000);

  async function refreshPublicTraffic() {
    try {
      const response = await fetch("/api/public/traffic/status", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Traffic status unavailable");
      const payload = await response.json();
      const active = Number(payload.activeVisitors);
      const total = Number(payload.totalVisitors);
      if (payload.ok !== true || !Number.isSafeInteger(active) || active < 0 ||
          !Number.isSafeInteger(total) || total < 0) throw new Error("Traffic status was invalid");
      if (liveVisitorCount) liveVisitorCount.textContent = active.toLocaleString("en-IN");
      if (totalVisitorCount) totalVisitorCount.textContent = total.toLocaleString("en-IN");
    } catch (_) {
      if (liveVisitorCount) liveVisitorCount.textContent = "—";
      if (totalVisitorCount) totalVisitorCount.textContent = "—";
    }
  }


  async function ensureVisitorIdentity() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    try {
      await fetch("/api/identity", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
    } catch (_) {
      // Identity is for continuity and analytics; voice remains usable if it is unavailable.
    } finally {
      window.clearTimeout(timeout);
    }
  }

  const visitorIdentityReady = ensureVisitorIdentity().then(refreshPublicTraffic);
  window.setInterval(() => {
    ensureVisitorIdentity().then(refreshPublicTraffic).catch(() => undefined);
  }, 30_000);
  const MEMORY_CONTEXT_KEY = "askmoina.memory.context";
  const MEMORY_CONSENT_KEY = "askmoina.memory.consent.v1";

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

  let socket = null;
  let activeSessionId = null;
  let resumeExistingSession = false;
  let relayKeepaliveTimer = null;

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
  let audioContext = null;
  let microphoneStream = null;
  let microphoneSource = null;
  let processor = null;
  let silentGain = null;
  let starting = false;
  let active = false;
  let stopping = false;
  let setupReady = false;
  let assistantVoiceMuted = false;
  let nextPlaybackTime = 0;
  let playbackNodes = new Set();
  let currentTranscriptNodes = { user: null, assistant: null };
  let transcriptStarted = false;
  let setupTimer = null;

  function setStatus(message, kind) {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.dataset.kind = kind || "normal";
  }

  function setAvailability(message, kind) {
    if (!availabilityNode) return;
    availabilityNode.textContent = message;
    availabilityNode.dataset.kind = kind || "normal";
  }

  let voiceAvailability = null;
  let availabilityCheckSequence = 0;

  async function refreshVoiceAvailability() {
    const requestId = ++availabilityCheckSequence;
    try {
      const response = await fetch("/api/voice/status", { cache: "no-store", headers: { Accept: "application/json" } });
      const result = await response.json();
      if (response.status === 401) {
        location.href = "/login";
        return { available: false, reason: "authentication_required", message: "Your account session expired. Sign in again." };
      }
      if (!response.ok || !result || typeof result.available !== "boolean") {
        throw new Error("Voice availability could not be checked.");
      }
      voiceAvailability = result;
      if (requestId !== availabilityCheckSequence) return result;

      if (result.available) {
        setAvailability("Voice service ready.", "normal");
      } else {
        setAvailability("Voice unavailable right now. See the status above for the reason.", "error");
        if (result.message) setStatus(result.message, "error");
      }
      return result;
    } catch (_) {
      voiceAvailability = null;
      if (requestId === availabilityCheckSequence) {
        setAvailability("Could not check voice availability. We’ll check again when you start.", "warning");
      }
      return null;
    }
  }

  async function refreshVoiceAvailabilityAfterRelease() {
    // Application-side active-session reservations are disabled; only provider availability remains.
    return refreshVoiceAvailability();
  }

  function setButton(label, disabled) {
    if (buttonLabel) buttonLabel.textContent = label;
    if (toggleButton) toggleButton.disabled = Boolean(disabled);
    if (toggleButton) {
      toggleButton.classList.toggle("is-live", active);
      toggleButton.classList.toggle("is-starting", starting);
      toggleButton.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function clearTranscript() {
    if (!transcriptNode) return;
    transcriptNode.replaceChildren();
    currentTranscriptNodes = { user: null, assistant: null };
    transcriptStarted = false;
    if (emptyTranscript) {
      emptyTranscript.textContent = "Your conversation will appear here when you speak.";
      transcriptNode.appendChild(emptyTranscript);
    }
  }

  if (clearButton) clearButton.addEventListener("click", clearTranscript);

  function getTranscriptNode(role) {
    if (!transcriptNode) return null;
    if (!transcriptStarted) {
      if (emptyTranscript && emptyTranscript.parentNode === transcriptNode) {
        emptyTranscript.remove();
      }
      transcriptStarted = true;
    }

    if (!currentTranscriptNodes[role]) {
      const row = document.createElement("div");
      row.className = "transcript-entry " + (role === "user" ? "from-you" : "from-moina");
      const label = document.createElement("span");
      label.className = "transcript-label";
      label.textContent = role === "user" ? "You" : "Moina";
      const body = document.createElement("p");
      body.className = "transcript-text";
      row.append(label, body);
      transcriptNode.appendChild(row);
      currentTranscriptNodes[role] = { row, body, text: "" };
    }
    return currentTranscriptNodes[role];
  }

  function updateLiveTranscript(role, incomingText) {
    const text = String(incomingText || "").trim();
    if (!text) return;
    // A new user utterance re-enables speech after Stop Voice interrupted the previous answer.
    if (role === "user") assistantVoiceMuted = false;
    const entry = getTranscriptNode(role);
    if (!entry) return;

    const mergeTranscript = window.AskMoinaTranscript && window.AskMoinaTranscript.merge;
    if (typeof mergeTranscript === "function") {
      const merged = mergeTranscript(entry.text, text);
      if (merged === entry.text) return;
      entry.text = merged;
    } else if (!entry.text || text.startsWith(entry.text)) {
      entry.text = text;
    } else if (text !== entry.text && !entry.text.endsWith(text)) {
      entry.text = (entry.text + " " + text).replace(/\s+/g, " ").trim();
    } else {
      return;
    }
    entry.body.textContent = entry.text;
    transcriptNode.scrollTop = transcriptNode.scrollHeight;
  }

  function finalizeTranscriptTurn() {
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

  function sendMicrophoneChunk(input) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !setupReady) return;
    // Avoid queueing stale microphone audio during a network stall; resume when drained.
    if (socket.bufferedAmount > 96 * 1024) return;
    const downsampled = downsampleTo16k(input, audioContext.sampleRate);
    if (!downsampled.length) return;
    const pcmBytes = floatToPcm16(downsampled);
    socket.send(JSON.stringify({
      realtime_input: {
        audio: {
          data: bytesToBase64(pcmBytes),
          mime_type: "audio/pcm;rate=16000"
        }
      }
    }));
  }

  function startMicrophoneCapture() {
    if (!audioContext || !microphoneStream || processor) return;

    microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
    // ScriptProcessor is retained for broad browser compatibility in this first live prototype.
    // It is not connected audibly to the speakers.
    const audioBufferSize = audioContext.sampleRate > 48000 ? 2048 : 1024;
    processor = audioContext.createScriptProcessor(audioBufferSize, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (!active || !setupReady || stopping) return;
      sendMicrophoneChunk(event.inputBuffer.getChannelData(0));
    };

    microphoneSource.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
  }

  function stopPlayback() {
    for (const node of playbackNodes) {
      try { node.stop(); } catch (_) { /* already stopped */ }
      try { node.disconnect(); } catch (_) { /* already disconnected */ }
    }
    playbackNodes.clear();
    nextPlaybackTime = audioContext ? audioContext.currentTime : 0;
    if (stopVoiceButton) stopVoiceButton.disabled = true;
  }

  if (stopVoiceButton) {
    stopVoiceButton.addEventListener("click", () => {
      assistantVoiceMuted = true;
      stopPlayback();
      setStatus("Assistant voice stopped. Ask another question to hear it again.");
    });
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

  function playPcmAudio(base64, mimeType) {
    if (!audioContext || !base64 || assistantVoiceMuted) return;
    const match = String(mimeType || "").match(/rate=(\d+)/i);
    const sampleRate = match ? Number(match[1]) : 24000;
    const samples = decodePcm16(base64);
    if (!samples.length) return;

    const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    const scheduledStart = Math.max(audioContext.currentTime + 0.015, nextPlaybackTime);
    source.start(scheduledStart);
    nextPlaybackTime = scheduledStart + buffer.duration;
    playbackNodes.add(source);
    if (stopVoiceButton) stopVoiceButton.disabled = false;
    source.addEventListener("ended", () => {
      playbackNodes.delete(source);
      try { source.disconnect(); } catch (_) { /* already disconnected */ }
      if (playbackNodes.size === 0 && stopVoiceButton) stopVoiceButton.disabled = true;
    });
  }

  function textFromTranscription(message) {
    const candidates = [
      message.input_transcription,
      message.output_transcription,
      message.inputTranscription,
      message.outputTranscription
    ];
    for (const item of candidates) {
      if (item && typeof item.text === "string") {
        if (item === message.input_transcription || item === message.inputTranscription) {
          updateLiveTranscript("user", item.text);
        } else {
          updateLiveTranscript("assistant", item.text);
        }
      }
    }
    const content = message.server_content || message.serverContent;
    if (content) {
      if (content.input_transcription && typeof content.input_transcription.text === "string") {
        updateLiveTranscript("user", content.input_transcription.text);
      }
      if (content.output_transcription && typeof content.output_transcription.text === "string") {
        updateLiveTranscript("assistant", content.output_transcription.text);
      }
    }
  }

  async function handleServerMessage(raw) {
    let message;
    try {
      let payload;
      if (typeof raw === "string") {
        payload = raw;
      } else if (typeof Blob !== "undefined" && raw instanceof Blob) {
        payload = await raw.text();
      } else if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
        payload = new TextDecoder().decode(raw);
      } else {
        throw new TypeError("Unsupported WebSocket message type");
      }
      message = JSON.parse(payload);
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        throw new TypeError("Unexpected WebSocket message shape");
      }
    } catch (_) {
      stopConversation(true);
      setStatus("The voice service sent a response this browser could not read. Please start a new conversation.", "error");
      return;
    }

    if (message.connection_status && message.connection_status.state === "ended") {
      // A terminal server notice means this relay is no longer resumable. A later
      // user action should start a fresh relay, rather than repeatedly attaching here.
      activeSessionId = null;
      resumeExistingSession = false;
      const disconnectMessage = typeof message.connection_status.message === "string"
        ? message.connection_status.message.trim().slice(0, 300)
        : "The voice connection ended. Tap Start listening to begin another conversation.";
      stopConversation(true);
      setStatus(disconnectMessage, "error");
      setAvailability("Voice connection ended. Availability will be checked again automatically.", "warning");
      return;
    }

    if (message.setup_complete || message.setupComplete) {
      resumeExistingSession = false;
      setupReady = true;
      if (setupTimer) {
        clearTimeout(setupTimer);
        setupTimer = null;
      }
      starting = false;
      active = true;
      setButton("Stop listening", false);
      assistantVoiceMuted = false;
      setStatus("Connected. Ask me anything.");
      if (voiceAvailability && voiceAvailability.available) {
        const sessionMinutes = Math.max(1, Math.ceil((Number(voiceAvailability.maxSessionSeconds) || 540) / 60));
        setAvailability("Conversation active · up to " + sessionMinutes + " min for this session.", "normal");
      }
      startMicrophoneCapture();
      return;
    }

    textFromTranscription(message);

    const serverContent = message.server_content || message.serverContent;
    if (serverContent) {
      const wasInterrupted = serverContent.interrupted === true;
      if (wasInterrupted) {
        stopPlayback();
        setStatus("Listening — go ahead.");
      }

      const modelTurn = serverContent.model_turn || serverContent.modelTurn;
      const parts = modelTurn && Array.isArray(modelTurn.parts) ? modelTurn.parts : [];
      for (const part of parts) {
        if (part.text) updateLiveTranscript("assistant", part.text);
        const inlineData = part.inline_data || part.inlineData;
        if (inlineData && inlineData.data) {
          if (!wasInterrupted && !assistantVoiceMuted) playPcmAudio(inlineData.data, inlineData.mime_type || inlineData.mimeType);
        }
      }

      if (serverContent.turn_complete || serverContent.turnComplete) {
        finalizeTranscriptTurn();
        if (active) setStatus("Listening. Go ahead.");
      }
    }

    if (message.go_away || message.goAway) {
      stopConversation(true);
      setStatus("This voice session is ending. Please start a new conversation.", "error");
      return;
    }

    if (message.error) {
      const errorMessage = message.error && typeof message.error.message === "string"
        ? message.error.message.trim().slice(0, 180)
        : "";
      stopConversation(true);
      setStatus(
        errorMessage
          ? "Voice service error: " + errorMessage
          : "The voice service returned an error. Please start a new conversation.",
        "error"
      );
    }
  }

  function cleanupMedia() {
    setupReady = false;
    if (setupTimer) {
      clearTimeout(setupTimer);
      setupTimer = null;
    }
    stopPlayback();

    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch (_) { /* already disconnected */ }
      processor = null;
    }
    if (microphoneSource) {
      try { microphoneSource.disconnect(); } catch (_) { /* already disconnected */ }
      microphoneSource = null;
    }
    if (silentGain) {
      try { silentGain.disconnect(); } catch (_) { /* already disconnected */ }
      silentGain = null;
    }
    if (microphoneStream) {
      microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
    }
    if (audioContext) {
      const oldContext = audioContext;
      audioContext = null;
      oldContext.close().catch(() => {});
    }
  }

  function finishStoppedState(message) {
    cleanupMedia();
    starting = false;
    active = false;
    stopping = false;
    setButton("Start listening", false);
    if (message) setStatus(message);
    window.setTimeout(() => {
      if (!starting && !active && !resumeExistingSession) void refreshVoiceAvailability();
    }, 700);
  }

  function stopConversation(fromServer) {
    if (!socket && !starting && !active) return;
    if (!fromServer) {
      activeSessionId = null;
      resumeExistingSession = false;
    }
    stopping = true;
    const oldSocket = socket;
    stopRelayKeepalive(oldSocket);
    socket = null;
    if (oldSocket && oldSocket.readyState === WebSocket.OPEN) {
      try {
        if (setupReady) {
          oldSocket.send(JSON.stringify({ realtime_input: { audio_stream_end: true } }));
        }
        oldSocket.close(1000, "Conversation ended");
      } catch (_) { /* socket may already be closing */ }
    } else if (oldSocket && oldSocket.readyState === WebSocket.CONNECTING) {
      try { oldSocket.close(); } catch (_) { /* no-op */ }
    }
    finishStoppedState(fromServer ? "Voice session ended. Tap Start listening to reconnect." : "Voice session ended.");
  }

  async function startConversation() {
    if (starting || active) return;
    const reconnectingExistingSession = resumeExistingSession && Boolean(activeSessionId);
    if (!reconnectingExistingSession) {
      activeSessionId = crypto.randomUUID();
      resumeExistingSession = false;
    }
    const sessionId = activeSessionId;
    starting = true;
    stopping = false;
    assistantVoiceMuted = false;
    setButton("Checking availability…", true);
    setStatus("Checking voice availability…");
    await visitorIdentityReady;
    // A detached relay still owns its rate-limit reservation; a normal availability
    // preflight would reject its own reconnect as a second concurrent guest session.
    const preflight = reconnectingExistingSession ? null : await refreshVoiceAvailabilityAfterRelease();
    if (preflight && !preflight.available) {
      starting = false;
      setButton("Start listening", false);
      setStatus(
        preflight.message || "Voice is not available right now. Please try again later.",
        "error",
      );
      return;
    }
    setButton("Connecting…", true);
    setStatus("Requesting microphone permission…");

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("This browser does not support microphone access.");
      }
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();

      const wsUrl = new URL("/api/voice/socket", window.location.href);
      wsUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("session_id", sessionId);
      wsUrl.searchParams.set("guest", "1");
      if (reconnectingExistingSession) wsUrl.searchParams.set("resume", "1");
      if (voicePicker) {
        wsUrl.searchParams.set("voice_preview", "1");
        wsUrl.searchParams.set("voice_name", voicePicker.value);
      }
      setStatus(voicePicker
        ? `Testing prebuilt voice: ${voicePicker.value}. Connecting securely…`
        : "Connecting securely to the voice service…");
      const sessionSocket = new WebSocket(wsUrl.toString());
      socket = sessionSocket;
      sessionSocket.binaryType = "arraybuffer";

      sessionSocket.addEventListener("open", () => {
        if (stopping || socket !== sessionSocket || sessionSocket.readyState !== WebSocket.OPEN) return;
        // Guest audio-only sessions never attach saved memories. A reconnect must
        // explicitly request the same (non-Co-Pilot) relay mode.
        sessionSocket.send(JSON.stringify(reconnectingExistingSession
          ? { setup: {}, copilot_mode: false }
          : { setup: {} }));
        startRelayKeepalive(sessionSocket);
        setStatus("Connecting voice test…");
        setupTimer = window.setTimeout(() => {
          if (!setupReady && socket === sessionSocket) {
            stopConversation(true);
            setStatus("Voice setup timed out. Please try starting a new conversation.", "error");
          }
        }, 15000);
      });

      sessionSocket.addEventListener("message", (event) => {
        void handleServerMessage(event.data);
      });

      sessionSocket.addEventListener("error", () => {
        if (socket === sessionSocket) {
          void refreshVoiceAvailability().then((result) => {
            if (socket && socket !== sessionSocket) return;
            if (result && !result.available) {
              setStatus(result.message || "Voice is not available right now.", "error");
            } else {
              setStatus("Could not connect to the voice service. Please check your connection and try again.", "error");
            }
          });
        }
      });

      sessionSocket.addEventListener("close", (event) => {
        stopRelayKeepalive(sessionSocket);
        const isCurrentSocket = socket === sessionSocket;
        if (isCurrentSocket) socket = null;
        // stopConversation() already restored the UI; ignore its late close event.
        if (!isCurrentSocket && !stopping) return;
        const wasStopping = stopping;
        let closeMessage = "Conversation ended.";
        if (!wasStopping) {
          const reason = String(event.reason || "").trim();
          if (reason === "Session time limit reached") {
            const minutes = Math.max(1, Math.ceil((Number(voiceAvailability && voiceAvailability.maxSessionSeconds) || 540) / 60));
            closeMessage = "This conversation reached its time limit (about " + minutes + " minutes). Tap Start listening to begin another conversation.";
          } else if (reason === "Voice provider disconnected") {
            closeMessage = "The voice service closed its connection unexpectedly. This is not a question-count limit. Tap Start listening to reconnect.";
          } else if (reason === "Voice provider socket error") {
            closeMessage = "The voice service encountered a connection error. Tap Start listening to start a new conversation.";
          } else if (reason === "Client socket error") {
            closeMessage = "The browser connection encountered an error. Check your internet connection and try again.";
          } else if (reason === "Invalid PCM audio frame") {
            closeMessage = "AskMoina could not read an incoming microphone audio packet. Check your selected microphone or refresh the page, then try again. This is not a question-count limit.";
          } else if (reason === "Audio input rate limit exceeded") {
            closeMessage = "Audio packets arrived faster than the live relay can process them during a short burst. AskMoina now paces microphone packets more conservatively. Close older AskMoina tabs, reload once, and reconnect. This is not a question-count limit.";
          } else if (reason === "Invalid or oversized client frame") {
            closeMessage = "The browser sent an unsupported voice packet. Refresh AskMoina and start a new conversation.";
          } else if (
            reason === "First message must be a small setup object" ||
            reason === "Invalid setup message" ||
            reason === "Only realtime audio input is allowed" ||
            reason === "Invalid client message"
          ) {
            closeMessage = "The voice connection received a message in an unexpected format. Refresh AskMoina and start a new conversation.";
          } else if (reason === "Provider frame decode failed" || reason === "Invalid provider frame") {
            closeMessage = "The voice service sent a response AskMoina could not read. Please start a new conversation.";
          } else if (reason === "Client send failed") {
            closeMessage = "AskMoina could not send a response to this browser connection. Check your connection and start a new conversation.";
          } else if (event.code === 1008) {
            closeMessage = "The connection closed for a policy or audio-format check (code 1008). This is not a question-count limit. Refresh AskMoina and try again; if it repeats, the connection diagnostics can help identify why.";
          } else if (event.code === 1006) {
            // Keep the session ID: the relay preserves an abnormal browser disconnect
            // for 45 seconds and can resume it when the user retries.
            resumeExistingSession = Boolean(activeSessionId);
            closeMessage = resumeExistingSession
              ? "The connection dropped without a clean close (code 1006). Tap Try again to restore your conversation."
              : "The connection dropped without a clean close (code 1006). Tap Try again to reconnect.";
          } else if (event.code !== 1000) {
            closeMessage = "The connection closed unexpectedly (code " + event.code + "). Tap Start listening to retry.";
          } else {
            closeMessage = "The voice session ended without an explanation from the service (code 1000). Tap Start listening to reconnect.";
          }
        }
        finishStoppedState(closeMessage);
        if (!wasStopping) {
          setButton("Try again", false);
          setStatus(closeMessage, "error");
          setAvailability("Voice connection ended. Availability will be checked again automatically.", "warning");
        }
      });

      // The model will notify setup_complete before we send any microphone frames.
      setButton("Connecting…", true);
    } catch (error) {
      if (socket) {
        try { socket.close(); } catch (_) { /* no-op */ }
        socket = null;
      }
      finishStoppedState(
        error && error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in your browser to continue."
          : error && error.message
            ? error.message
            : "Could not start voice. Please try again."
      );
    }
  }

  if (toggleButton) {
    toggleButton.addEventListener("click", () => {
      if (active || starting) stopConversation(false);
      else startConversation();
    });
  }

  // Safari has historically exposed AudioContext with a vendor prefix.
  if (!window.AudioContext && window.webkitAudioContext) {
    window.AudioContext = window.webkitAudioContext;
  }

  async function checkBackend() {
    setButton("Checking voice service…", true);
    setStatus("Checking that the voice service is configured…");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const health = await response.json();
      if (
        response.ok &&
        health &&
        health.ok === true &&
        health.status === "vertex-live-proxy-configured"
      ) {
        setButton("Start listening", false);
        setStatus("Ready. Tap Start listening and talk naturally.");
        await refreshVoiceAvailability();
        return;
      }
      setButton("Voice not ready", true);
      setStatus("Voice service is not configured yet. Please try again later.", "error");
      setAvailability("Voice will become available after service setup is complete.", "error");
    } catch (_) {
      setButton("Start listening", false);
      setStatus("Could not confirm service status. You can still try connecting, or reload the page.", "error");
      await refreshVoiceAvailability();
    }
  }

  setAvailability("Checking voice availability…");
  checkBackend();


})();
