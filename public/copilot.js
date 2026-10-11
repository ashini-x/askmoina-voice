(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const video = $("#videoPreview");
  const stage = $("#cameraStage");
  const placeholder = $("#cameraPlaceholder");
  const toggleButton = $("#toggleCopilot");
  const buttonLabel = $("#buttonLabel");
  const flipButton = $("#flipCamera");
  const clearMarkerButton = $("#clearMarker");
  const cameraState = $("#cameraState");
  const frameBadge = $("#frameBadge");
  const statusNode = $("#status");
  const availabilityNode = $("#availability");
  const connectionPill = $("#connectionPill");
  const transcriptNode = $("#transcript");
  const emptyTranscript = $("#emptyTranscript");
  const focusMarker = $("#focusMarker");
  const focusLabel = $("#focusLabel");
  const focusHint = $("#focusHint");
  const focusInstruction = $("#focusInstruction");
  const approxTag = $("#approxTag");
  const clearTranscriptButton = $("#clearTranscript");
  const muteButton = $("#muteMic");
  const zoomSlider = $("#zoomSlider");
  const zoomLabel = $("#zoomLabel");
  const zoomInButton = $("#zoomIn");
  const zoomOutButton = $("#zoomOut");
  const trackingCanvas = document.createElement("canvas");
  const trackingContext = trackingCanvas.getContext("2d", { willReadFrequently: true });
  let trackingPixels = null;
  let trackingTimer = null;
  let localTrackingActive = false;
  let trackedPoint = null;
  let trackingTemplate = null;
  let trackingLostFrames = 0;
  let trackingLastTick = 0;
  let trackingCanvasWidth = 0;
  let trackingCanvasHeight = 0;
  let trackingCrop = null;
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
  let audioContext = null;
  let microphoneSource = null;
  let processor = null;
  let silentGain = null;
  let starting = false;
  let active = false;
  let stopping = false;
  let setupReady = false;
  let setupTimer = null;
  let videoTimer = null;
  let firstVideoTimer = null;
  let nextPlaybackTime = 0;
  const playbackNodes = new Set();
  let currentTranscriptNodes = { user: null, assistant: null };
  let transcriptStarted = false;
  let voiceAvailability = null;
  let availabilitySequence = 0;
  let facingMode = "environment";
  let lastVideoSentAt = 0;
  let sendingVideo = false;
  let lastSessionEndedAt = 0;
  let latestVisualGuidance = null;

  function setStatus(message, kind) {
    statusNode.textContent = message;
    statusNode.dataset.kind = kind || "normal";
  }

  function setAvailability(message, kind) {
    availabilityNode.textContent = message;
    availabilityNode.dataset.kind = kind || "normal";
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
    toggleButton.setAttribute("aria-pressed", active ? "true" : "false");
    flipButton.disabled = !active || !microphoneStream;
    muteButton.disabled = !active || !microphoneStream;
    zoomSlider.disabled = !microphoneStream;
    zoomInButton.disabled = !microphoneStream || zoomLevel >= zoomMax;
    zoomOutButton.disabled = !microphoneStream || zoomLevel <= zoomMin;
    muteButton.innerHTML = microphoneMuted ? '<span aria-hidden="true">♩</span> Unmute' : '<span aria-hidden="true">♩</span> Mute';
    muteButton.setAttribute("aria-pressed", microphoneMuted ? "true" : "false");
    clearMarkerButton.disabled = focusMarker.hidden;
  }

  function clearOverlay() {
    stopLocalTracking(false);
    focusMarker.hidden = true;
    approxTag.hidden = true;
    clearMarkerButton.disabled = true;
    focusMarker.style.left = "";
    focusMarker.style.top = "";
    delete focusMarker.dataset.tracking;
  }

  function showOverlay(args) {
    const regions = ["center", "upper-left", "upper-right", "lower-left", "lower-right"];
    const region = regions.includes(args.screen_region) ? args.screen_region : "center";
    const label = typeof args.text_to_display === "string" ? args.text_to_display.trim().slice(0, 72) : "";
    const hint = typeof args.target_hint === "string" ? args.target_hint.trim().slice(0, 120) : "";
    const instruction = typeof args.instruction === "string" ? args.instruction.trim().slice(0, 220) : "";
    if (!label && !instruction) return;

    const primary = { label: label || "Moina's focus", hint, instruction, screenRegion: region };
    const normalizedSteps = Array.isArray(args.steps) ? args.steps.slice(0, 5).map((step) => {
      if (!step || typeof step !== "object") return null;
      const stepLabel = typeof step.text_to_display === "string" ? step.text_to_display.trim().slice(0, 72) : "";
      const stepHint = typeof step.target_hint === "string" ? step.target_hint.trim().slice(0, 120) : "";
      const stepInstruction = typeof step.instruction === "string" ? step.instruction.trim().slice(0, 220) : "";
      const validRegions = ["center", "upper-left", "upper-right", "lower-left", "lower-right"];
      const stepRegion = validRegions.includes(step.screen_region) ? step.screen_region : "center";
      if (!stepLabel && !stepInstruction) return null;
      return { label: stepLabel || "Guided step", hint: stepHint, instruction: stepInstruction, screenRegion: stepRegion };
    }).filter(Boolean) : [];
    const guidanceSteps = normalizedSteps.length > 1 ? normalizedSteps : [primary];
    const firstStep = guidanceSteps[0];
    latestVisualGuidance = { ...firstStep, steps: guidanceSteps };
    syncSpatialGuidance();

    if (!localTrackingActive) {
      focusMarker.dataset.region = firstStep.screenRegion;
      focusMarker.style.left = "";
      focusMarker.style.top = "";
      focusMarker.dataset.tracking = "approximate";
    }
    focusLabel.textContent = firstStep.label;
    focusHint.textContent = firstStep.hint;
    focusInstruction.textContent = firstStep.instruction;
    focusMarker.hidden = false;
    approxTag.hidden = false;
    clearMarkerButton.disabled = false;
    approxTag.textContent = localTrackingActive
      ? "Local visual tracking · not world-locked AR"
      : "Approximate focus · not world-locked AR";
    if (!localTrackingActive) {
      setStatus("Moina highlighted a possible target. Tap the object in the camera to track it locally.");
    }
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
      if (!response.ok || !result || typeof result.available !== "boolean") {
        throw new Error("Voice availability could not be checked.");
      }
      voiceAvailability = result;
      if (sequence !== availabilitySequence) return result;
      if (result.available) {
        const minutes = Math.max(1, Math.ceil((Number(result.maxSessionSeconds) || 540) / 60));
        setAvailability("Available · up to " + minutes + " minutes this conversation. Camera frames are reduced and sent about once per second.", "normal");
      } else {
        const pendingRelease = options.quietActiveLock === true && result.reason === "already_active";
        setAvailability("Voice unavailable right now. See the status above for the reason.", pendingRelease ? "warning" : "error");
        if (!pendingRelease) setStatus(result.message || "Voice is not available right now.", "error");
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
    let result = null;
    // Closing a WebSocket and releasing its Durable Object reservation are asynchronous.
    // Retry briefly to avoid presenting that tiny handoff window as a second live session.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      result = await refreshAvailability({ quietActiveLock: true });
      if (!result || result.available || result.reason !== "already_active") break;
      if (attempt < 8) await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    if (result && !result.available && result.reason === "already_active") {
      setAvailability("Voice unavailable right now. See the status above for the reason.", "error");
      setStatus(result.message || "A voice conversation is still active for this browser.", "error");
    }
    return result;
  }

  function resetTranscript() {
    transcriptNode.replaceChildren();
    currentTranscriptNodes = { user: null, assistant: null };
    transcriptStarted = false;
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.id = "emptyTranscript";
    const orb = document.createElement("span");
    orb.className = "empty-orb";
    orb.setAttribute("aria-hidden", "true");
    const p = document.createElement("p");
    p.textContent = "Your conversation will appear here. Start the Co-Pilot, point the camera, and ask Moina what you want to understand.";
    empty.append(orb, p);
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
    if (text === entry.text || entry.text.endsWith(text)) return;
    if (!entry.text || text.startsWith(entry.text)) entry.text = text;
    else entry.text = (entry.text + " " + text).replace(/\s+/g, " ").trim();
    entry.body.textContent = entry.text;
    transcriptNode.scrollTop = transcriptNode.scrollHeight;
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
    processor = audioContext.createScriptProcessor(2048, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (!active || !setupReady || stopping) return;
      sendAudioChunk(event.inputBuffer.getChannelData(0));
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
    nextPlaybackTime = audioContext ? audioContext.currentTime : 0;
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
    source.connect(audioContext.destination);
    const startAt = Math.max(audioContext.currentTime + 0.015, nextPlaybackTime);
    source.start(startAt);
    nextPlaybackTime = startAt + buffer.duration;
    playbackNodes.add(source);
    source.addEventListener("ended", () => {
      playbackNodes.delete(source);
      try { source.disconnect(); } catch (_) {}
    });
  }

  function sendVideoFrame() {
    if (sendingVideo || !active || !setupReady || !socket || socket.readyState !== WebSocket.OPEN || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;
    const now = Date.now();
    if (now - lastVideoSentAt < 900) return;
    sendingVideo = true;
    try {
      const maxDimension = 320;
      const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
      let width = Math.max(1, Math.round(video.videoWidth * scale));
      let height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      let data = "";
      for (let attempt = 0; attempt < 4; attempt += 1) {
        canvas.width = width;
        canvas.height = height;
        if (!nativeZoomSupported && zoomLevel > 1) {
        const sourceWidth = video.videoWidth / zoomLevel;
        const sourceHeight = video.videoHeight / zoomLevel;
        context.drawImage(video, (video.videoWidth - sourceWidth) / 2, (video.videoHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height);
      } else {
        context.drawImage(video, 0, 0, width, height);
      }
        const quality = [0.42, 0.32, 0.25, 0.19][attempt];
        data = canvas.toDataURL("image/jpeg", quality).split(",")[1] || "";
        if (data.length <= 12_000) break;
        width = Math.max(1, Math.round(width * 0.82));
        height = Math.max(1, Math.round(height * 0.82));
      }
      if (!data || data.length > 12_000) {
        setStatus("This camera frame is too large to send safely. Move back from detail or try another camera.");
        return;
      }
      socket.send(JSON.stringify({
        realtime_input: { video: { data, mime_type: "image/jpeg" } }
      }));
      lastVideoSentAt = Date.now();
      setCameraState("Live · frames ~1/sec", "live");
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
    firstVideoTimer = window.setTimeout(sendVideoFrame, 250);
    videoTimer = window.setInterval(sendVideoFrame, 1200);
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
    setupReady = false;
    clearTimers();
    stopPlayback();
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
    if (microphoneStream) {
      microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
    }
    microphoneMuted = false;
    zoomLevel = 1;
    nativeZoomSupported = false;
    video.style.transform = "";
    zoomLabel.textContent = "1×";
    zoomSlider.value = "1";
    if (audioContext) {
      const previous = audioContext;
      audioContext = null;
      previous.close().catch(() => {});
    }
    video.srcObject = null;
    stage.classList.remove("has-camera");
    setCameraState("Camera paused", "idle");
  }

  function stopCopilot(userInitiated, statusMessage, statusKind) {
    lastSessionEndedAt = Date.now();
    stopping = true;
    const oldSocket = socket;
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
    setControls("Start Co-Pilot", false);
    setConnectionState("READY", "ready");
    clearOverlay();
    if (statusMessage) setStatus(statusMessage, statusKind);
    else if (userInitiated) setStatus("Co-Pilot paused. Start again whenever you're ready.");
    void refreshAvailabilityAfterRelease();
  }

  function getToolCalls(message) {
    const call = message.tool_call || message.toolCall;
    if (!call || typeof call !== "object") return [];
    const calls = call.function_calls || call.functionCalls;
    return Array.isArray(calls) ? calls : [];
  }

  function handleToolCalls(message) {
    const responses = [];
    for (const call of getToolCalls(message)) {
      if (!call || typeof call !== "object" || call.name !== "display_screen_overlay") continue;
      const args = call.args && typeof call.args === "object" ? call.args : {};
      showOverlay(args);
      const id = typeof call.id === "string" ? call.id : "";
      if (id) responses.push({ id, name: "display_screen_overlay" });
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

    if (message.connection_status && message.connection_status.state === "ended") {
      stopCopilot(false, message.connection_status.message || "The live session ended. Start again to continue.", "warning");
      return;
    }

    if (message.setup_complete || message.setupComplete) {
      setupReady = true;
      active = true;
      starting = false;
      if (setupTimer) window.clearTimeout(setupTimer);
      setupTimer = null;
      setControls("End Co-Pilot", false);
      setConnectionState("LIVE", "live");
      setStatus("Connected. Ask Moina naturally in Assamese; tap a visible object to track it locally.");
      setAvailability("Camera frames are sent at a reduced size about once per second; audio is streamed live.", "normal");
      setCameraState("Live · frames ~1/sec", "live");
      startAudioCapture();
      startVideoFrames();
      return;
    }

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
      if (serverContent.input_transcription && typeof serverContent.input_transcription.text === "string") updateTranscript("user", serverContent.input_transcription.text);
      if (serverContent.output_transcription && typeof serverContent.output_transcription.text === "string") updateTranscript("assistant", serverContent.output_transcription.text);
      if (serverContent.interrupted) {
        stopPlayback();
        setStatus("Listening — go ahead.");
      }
      const modelTurn = serverContent.model_turn || serverContent.modelTurn;
      const parts = modelTurn && Array.isArray(modelTurn.parts) ? modelTurn.parts : [];
      for (const part of parts) {
        if (part.text) updateTranscript("assistant", part.text);
        const inlineData = part.inline_data || part.inlineData;
        if (inlineData && inlineData.data) playPcmAudio(inlineData.data, inlineData.mime_type || inlineData.mimeType);
      }
      if (serverContent.turn_complete || serverContent.turnComplete) {
        finalizeTurn();
        if (active) setStatus("Listening — ask another question or follow the highlighted step.");
      }
    }

    handleToolCalls(message);

    if (message.go_away || message.goAway) {
      stopCopilot(false, "The voice session is ending. Start the Co-Pilot again to continue.", "warning");
      return;
    }

    if (message.error) {
      const messageText = message.error && typeof message.error.message === "string"
        ? message.error.message.trim().slice(0, 180)
        : "The voice service returned an error.";
      stopCopilot(false, "Voice service error: " + messageText, "error");
    }
  }

  async function startCopilot() {
    if (starting || active) {
      if (active || starting) stopCopilot(true);
      return;
    }
    starting = true;
    stopping = false;
    clearOverlay();
    setControls("Starting…", true);
    setConnectionState("CONNECTING", "ready");
    setStatus("Checking availability and requesting camera + microphone access…");
    const endedRecently = Date.now() - lastSessionEndedAt < 15_000;
    const preflight = endedRecently
      ? await refreshAvailabilityAfterRelease()
      : await refreshAvailability();
    if (preflight && !preflight.available) {
      starting = false;
      setControls("Start Co-Pilot", false);
      setConnectionState("BUSY", "error");
      setStatus(preflight.message || "Voice isn't available right now.", "error");
      return;
    }

    let sessionSocket = null;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("This browser does not support camera and microphone access.");
      }
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      video.srcObject = microphoneStream;
      await video.play();
      initializeZoom();
      stage.classList.add("has-camera");
      setCameraState("Camera ready", "live");

      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("This browser does not support live audio.");
      audioContext = new AudioContextConstructor();
      await audioContext.resume();

      const wsUrl = new URL("/api/voice/socket", window.location.href);
      wsUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      sessionSocket = new WebSocket(wsUrl.toString());
      socket = sessionSocket;
      sessionSocket.binaryType = "arraybuffer";

      sessionSocket.addEventListener("open", () => {
        if (stopping || socket !== sessionSocket || sessionSocket.readyState !== WebSocket.OPEN) return;
        const setupPayload = { setup: {}, copilot_mode: true };
        try {
          const memory = String(localStorage.getItem("askmoina.memory.context") || sessionStorage.getItem("askmoina.memory.context") || "").trim().slice(0, 3000);
          if (memory) setupPayload.memory_context = memory;
        } catch (_) {}
        sessionSocket.send(JSON.stringify(setupPayload));
        setStatus("Camera ready. Connecting securely to Moina…");
        setupTimer = window.setTimeout(() => {
          if (!setupReady && socket === sessionSocket) {
            stopCopilot(false, "Voice setup took too long. Check your connection and try again.", "error");
          }
        }, 15000);
      });

      sessionSocket.addEventListener("message", (event) => { void handleServerMessage(event.data, sessionSocket); });
      sessionSocket.addEventListener("error", () => {
        if (socket === sessionSocket) {
          stopCopilot(false, "The live connection failed. Check the network and try again.", "error");
        }
      });
      sessionSocket.addEventListener("close", (event) => {
        if (socket !== sessionSocket) return;
        socket = null;
        lastSessionEndedAt = Date.now();
        if (stopping) return;
        const reason = String(event.reason || "").trim();
        let message = "The live session ended unexpectedly. Start the Co-Pilot again to continue.";
        if (reason === "Session time limit reached") message = "This conversation reached its time limit. Start again when you're ready.";
        else if (reason === "Invalid copilot video frame") message = "The camera frame format was rejected. Refresh and try again.";
        else if (reason === "Audio input rate limit exceeded") message = "Audio and camera data exceeded the live input limit. Restart with a steadier connection.";
        cleanupMedia();
        active = false;
        starting = false;
        setControls("Start Co-Pilot", false);
        setConnectionState("ENDED", "error");
        setStatus(message, "error");
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
      setControls("Start Co-Pilot", false);
      setConnectionState("READY", "ready");
      setStatus(error && error.name === "NotAllowedError"
        ? "Camera or microphone permission was denied. Allow both permissions and try again."
        : (error && error.message ? error.message : "Couldn't start the Co-Pilot. Please try again."), "error");
    }
  }


  // Local-only template tracking follows a user-selected image patch between cloud frames.
  // It is screen-space tracking, not world-locked AR or a persistent 3D anchor.
  function configureTrackingCanvas() {
    if (!trackingContext || !video.videoWidth || !video.videoHeight) return false;
    const scale = Math.min(1, 256 / Math.max(video.videoWidth, video.videoHeight));
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
    const baseX = centerX + (clientX - centerX) / digitalZoom;
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
    const screenX = rect.left + rect.width / 2 + (baseX - (rect.left + rect.width / 2)) * digitalZoom;
    const screenY = rect.top + rect.height / 2 + (baseY - (rect.top + rect.height / 2)) * digitalZoom;
    focusMarker.style.left = ((screenX - rect.left) / rect.width * 100) + "%";
    focusMarker.style.top = ((screenY - rect.top) / rect.height * 100) + "%";
    trackedPoint = point;
  }

  function extractTemplate(gray, x, y) {
    const radius = 6;
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
    if (template.variance < 1800 || candidateVariance < 1800) {
      return 1 - absoluteDifference / template.values.length / 48;
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

  function stopLocalTracking(showStatus = true) {
    localTrackingActive = false;
    if (trackingTimer) window.clearInterval(trackingTimer);
    trackingTimer = null;
    trackingTemplate = null;
    trackingLostFrames = 0;
    trackedPoint = null;
    trackingCrop = null;
    if (focusMarker) delete focusMarker.dataset.tracking;
    if (showStatus && microphoneStream) setStatus("Local tracking stopped. Tap a visible object to track it again.");
  }

  function startLocalTracking(clientX, clientY) {
    if (!active || !setupReady || !microphoneStream || !trackingContext) {
      setStatus("Start the Co-Pilot first, then tap a visible object to track it.", "warning");
      return;
    }
    if (!configureTrackingCanvas()) {
      setStatus("The camera frame isn't ready yet. Hold the view steady and try again.", "warning");
      return;
    }
    const point = framePointFromClient(clientX, clientY);
    if (!point) {
      setStatus("Tap on the visible camera image, not the cropped edge.", "warning");
      return;
    }
    const gray = pixelsToGray(trackingPixels);
    const template = extractTemplate(gray, point.x, point.y);
    if (!template) {
      setStatus("Move a little closer to the target and tap its center again.", "warning");
      return;
    }
    if (trackingTimer) window.clearInterval(trackingTimer);
    trackingTemplate = template;
    trackedPoint = point;
    trackingLostFrames = 0;
    localTrackingActive = true;
    focusMarker.hidden = false;
    focusMarker.dataset.tracking = "true";
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
  }

  function updateLocalTracking() {
    if (!localTrackingActive || !active || !setupReady || !microphoneStream || !video.videoWidth || !trackingContext) return;
    const now = Date.now();
    if (now - trackingLastTick < 75) return;
    trackingLastTick = now;
    try {
      if (!configureTrackingCanvas() || !trackingPixels) return;
      const gray = pixelsToGray(trackingPixels);
      const result = findTemplate(gray, trackedPoint);
      const confidenceThreshold = trackingTemplate && trackingTemplate.variance < 1800 ? 0.62 : 0.42;
      if (!result || result.score < confidenceThreshold) {
        trackingLostFrames += 1;
        if (trackingLostFrames >= 5) {
          stopLocalTracking(false);
          focusMarker.dataset.tracking = "lost";
          setStatus("I lost the local target. Keep it clearly visible and tap it again to resume tracking.", "warning");
        }
        return;
      }
      trackingLostFrames = 0;
      markerAtTrackingPoint(result);
    } catch (_) {
      stopLocalTracking(false);
      focusMarker.dataset.tracking = "lost";
      setStatus("Local tracking paused because the camera frame could not be processed. Tap the target to retry.", "warning");
    }
  }

  stage.addEventListener("click", (event) => {
    if (event.target.closest(".floating-top,.camera-controls,.caption-dock,.zoom-dock,.camera-top-badge,.camera-state,.approx-tag,.focus-card,.clear-marker,.vision-pill,.vault-link")) return;
    if (!microphoneStream || !active || !setupReady) return;
    startLocalTracking(event.clientX, event.clientY);
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
    if (localTrackingActive && Math.abs(nextZoom - zoomLevel) > 0.05) {
      stopLocalTracking(false);
      focusMarker.dataset.tracking = "lost";
      setStatus("Zoom changed. Tap the target again to resume local tracking.", "warning");
    }
    zoomLevel = nextZoom;
    zoomSlider.value = String(zoomLevel);
    zoomLabel.textContent = (Math.abs(zoomLevel - Math.round(zoomLevel)) < 0.001 ? String(Math.round(zoomLevel)) : zoomLevel.toFixed(1)) + "×";
    if (nativeZoomSupported && track) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: zoomLevel }] });
        video.style.transform = "";
      } catch (_) {
        nativeZoomSupported = false;
        zoomMin = 1;
        zoomMax = 3;
        zoomLevel = Math.max(1, Math.min(3, zoomLevel));
        zoomSlider.min = "1";
        zoomSlider.max = "3";
        zoomSlider.step = "0.1";
        video.style.transform = "scale(" + zoomLevel + ")";
      }
    } else {
      // Digital crop fallback is applied to preview and model-bound camera frames.
      video.style.transform = "scale(" + zoomLevel + ")";
    }
    zoomInButton.disabled = !microphoneStream || zoomLevel >= zoomMax;
    zoomOutButton.disabled = !microphoneStream || zoomLevel <= zoomMin;
    if (announce) setStatus("Camera zoom " + zoomLabel.textContent + ".");
  }

  function toggleMicrophoneMute() {
    if (!microphoneStream) return;
    microphoneMuted = !microphoneMuted;
    microphoneStream.getAudioTracks().forEach((track) => { track.enabled = !microphoneMuted; });
    muteButton.innerHTML = microphoneMuted ? '<span aria-hidden="true">♩</span> Unmute' : '<span aria-hidden="true">♩</span> Mute';
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
    flipButton.disabled = true;
    try {
      const cameraOnly = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacingMode }, width: { ideal: 640 }, height: { ideal: 480 } },
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
      setStatus(facingMode === "environment" ? "Switched to the rear camera." : "Switched to the front camera.");
      setCameraState("Live · frames ~1/sec", "live");
    } catch (error) {
      setStatus(error && error.message ? error.message : "Couldn't switch cameras.", "warning");
    } finally {
      flipButton.disabled = !active;
    }
  }

  toggleButton.addEventListener("click", () => {
    if (active || starting) stopCopilot(true);
    else void startCopilot();
  });
  flipButton.addEventListener("click", () => { void flipCamera(); });
  muteButton.addEventListener("click", toggleMicrophoneMute);
  clearMarkerButton.addEventListener("click", clearOverlay);
  clearTranscriptButton.addEventListener("click", resetTranscript);
  window.addEventListener("pagehide", () => {
    if (active || starting || socket) stopCopilot(false);
  });


  const spatialArButton = $("#spatialArButton");
  const spatialHud = $("#spatialHud");
  const spatialStatus = $("#spatialStatus");
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
    const hasSequence = Boolean(spatialSession) && spatialGuidanceSteps.length > 1;
    spatialStepPanel.hidden = !hasSequence;
    if (!hasSequence) return;
    const total = spatialGuidanceSteps.length;
    spatialStepProgress.textContent = spatialSequenceFinished
      ? "Walkthrough complete · " + total + " steps"
      : "Step " + (spatialStepIndex + 1) + " of " + total + (spatialStepConfirmed ? " · confirmed" : " · awaiting confirmation");
    spatialStepMessage.textContent = spatialSequenceFinished
      ? "All steps were marked complete. The final anchor remains visible until you clear it or exit AR."
      : spatialStepConfirmed
        ? "Confirmed by you. Advance only after the visible result matches this instruction; the next step requires a new anchor."
        : "Place the cue at this step's target, inspect the result, then confirm before advancing.";
    const busy = spatialPlacing || spatialPendingPlacement || spatialHitSourcePending;
    spatialStepButtons.previous.disabled = spatialStepIndex <= 0 || busy;
    spatialStepButtons.confirm.disabled = !spatialAnchor || spatialStepConfirmed || spatialSequenceFinished || busy;
    spatialStepButtons.next.disabled = !spatialStepConfirmed || spatialStepIndex >= total - 1 || spatialSequenceFinished || busy;
    spatialStepButtons.finish.disabled = !spatialStepConfirmed || spatialStepIndex !== total - 1 || spatialSequenceFinished || busy;
  }

  function syncSpatialGuidance() {
    const guidance = activeSpatialGuidance();
    if (!guidance) {
      spatialTargetLabel.textContent = "No recent visual target";
      spatialTargetInstruction.textContent = "Start Co-Pilot and ask Moina to highlight a target before opening Spatial AR.";
      spatialTargetHint.textContent = "The surface marker can still be placed without a recent cue.";
    } else {
      spatialTargetLabel.textContent = guidance.label;
      spatialTargetInstruction.textContent = guidance.instruction || "No next-step instruction was provided.";
      spatialTargetHint.textContent = guidance.hint || "Moina supplied no extra target description.";
    }
    syncSpatialAimLabel();
    syncSpatialSequenceControls();
  }

  function clearCurrentSpatialAnchorForStepChange() {
    if (spatialAnchor) {
      try { spatialAnchor.delete(); } catch (_) {}
    }
    spatialAnchor = null;
    spatialPlacedGuidance = null;
    spatialLatestHit = null;
    spatialPendingPlacement = false;
    spatialPlacing = false;
    spatialPendingPlacementAt = 0;
    spatialAnchorPoseLostAt = 0;
    spatialAnchorPoseWarningShown = false;
  }

  function moveSpatialGuidanceStep(delta) {
    if (!spatialSession || spatialGuidanceSteps.length < 2 || spatialSequenceFinished) return;
    if (spatialPlacing || spatialPendingPlacement || spatialHitSourcePending) return;
    if (delta > 0 && (!spatialStepConfirmed || !spatialAnchor)) return;
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
    if (!spatialSession || !spatialAnchor || spatialSequenceFinished || spatialStepConfirmed) return;
    spatialStepConfirmed = true;
    syncSpatialSequenceControls();
    setSpatialStatus("Step " + (spatialStepIndex + 1) + " confirmed by you. Check the visible result before advancing.", "anchored");
  }

  function finishSpatialGuidanceSequence() {
    if (!spatialSession || !spatialStepConfirmed || spatialStepIndex !== spatialGuidanceSteps.length - 1) return;
    spatialSequenceFinished = true;
    syncSpatialSequenceControls();
    setSpatialStatus("Guided walkthrough complete. The final cue remains anchored until you clear it or exit AR.", "anchored");
  }

  function syncSpatialButtons() {
    placeSpatialAnchorButton.disabled = !spatialLatestHit || Boolean(spatialAnchor) || spatialPlacing || spatialPendingPlacement || spatialHitSourcePending;
    clearSpatialAnchorButton.disabled = !spatialAnchor;
    const aimDisabled = !spatialSession || !spatialOffsetRaySupported || Boolean(spatialAnchor) || spatialPlacing || spatialPendingPlacement || spatialHitSourcePending;
    Object.values(spatialAimButtons).forEach((button) => { button.disabled = aimDisabled; });
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
    if (active || starting || microphoneStream || socket) {
      const proceed = window.confirm("Spatial AR uses the phone's camera and will pause your current live voice session. Continue?");
      if (!proceed) return;
      stopCopilot(true);
    }

    spatialGuidanceSteps = latestVisualGuidance && Array.isArray(latestVisualGuidance.steps)
      ? latestVisualGuidance.steps.slice(0, 5)
      : latestVisualGuidance ? [latestVisualGuidance] : [];
    spatialStepIndex = 0;
    spatialStepConfirmed = false;
    spatialSequenceFinished = false;
    syncSpatialGuidance();
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
      spatialPlacedGuidance = null;
      spatialLatestHit = null;
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
      setSpatialStatus(spatialOffsetRaySupported
        ? "Moina's approximate target region sets the initial aim ray. Check the ring, nudge it if needed, then confirm the surface before placing."
        : "This browser uses a center hit-test ray. Move the phone until the ring overlays the intended object, then confirm placement.", spatialOffsetRaySupported ? "aiming" : "warning");
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
          ? "Cue anchored at the confirmed hit-test point for “" + spatialPlacedGuidance.label + "”. Verify it lines up with the intended object; the AI screen region is only an estimate."
          : "Marker anchored to the confirmed hit-test point. No recent AI target cue was available.", "anchored");
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
          ? "Surface detected. Tap Place cue anchor, then move the phone slowly in a small arc and return to check for drift."
          : "Searching for a surface. Aim at a table, floor, or wall and move the phone slowly.", spatialLatestHit ? "surface" : "searching");
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
    } else {
      spatialAnchorPoseLostAt = 0;
      spatialAnchorPoseWarningShown = false;
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

      if (spatialAnchor) {
        if (currentAnchorPose) {
          drawSpatialRing(gl, view, currentAnchorPose.transform.matrix, spatialRenderer.anchorRing, [0.32, 1.0, 0.77, 0.98]);
          drawSpatialTag(gl, view, currentAnchorPose.transform.matrix);
        }
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
    const oldAnchor = spatialAnchor;
    const oldHitSource = spatialHitSource;
    spatialSession = null;
    spatialHitSource = null;
    if (oldHitSource) { try { oldHitSource.cancel(); } catch (_) {} }
    spatialViewerSpace = null;
    spatialReferenceSpace = null;
    spatialAnchor = null;
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
    if (oldAnchor) {
      try { oldAnchor.delete(); } catch (_) {}
    }
    releaseSpatialRenderer();
    spatialHud.hidden = true;
    spatialHud.classList.remove("is-preparing");
    spatialArButton.disabled = !spatialFeatureSupported;
    setStatus("Spatial AR ended. Start Co-Pilot to resume live voice guidance.");
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
  spatialStepButtons.next.addEventListener("click", () => moveSpatialGuidanceStep(1));
  spatialStepButtons.finish.addEventListener("click", finishSpatialGuidanceSequence);

  placeSpatialAnchorButton.addEventListener("click", () => {
    if (!spatialSession || spatialAnchor || spatialPlacing) return;
    if (!spatialLatestHit) {
      setSpatialStatus("No surface detected on the current aim ray. Move slowly or adjust the ray and try again.", "searching");
      return;
    }
    const currentGuidance = activeSpatialGuidance();
    spatialPlacedGuidance = currentGuidance ? { ...currentGuidance } : null;
    spatialStepConfirmed = false;
    spatialPendingPlacement = true;
    spatialPendingPlacementAt = performance.now();
    setSpatialStatus(spatialPlacedGuidance
      ? "Placing “" + spatialPlacedGuidance.label + "” cue on the next detected surface point…"
      : "Placing a marker on the next confirmed surface hit…", "placing");
    syncSpatialButtons();
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
    }
  });

  exitSpatialArButton.addEventListener("click", () => {
    if (spatialSession) void spatialSession.end();
  });
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
  void checkSpatialArSupport();
  void checkBackend();
})();