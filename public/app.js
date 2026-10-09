(() => {
  "use strict";

  const statusNode = document.querySelector("#status");
  const availabilityNode = document.querySelector("#availability");
  const toggleButton = document.querySelector("#toggleVoice");
  const buttonLabel = document.querySelector("#buttonLabel");
  const transcriptNode = document.querySelector("#transcript");
  const clearButton = document.querySelector("#clearTranscript");
  const emptyTranscript = document.querySelector("#emptyTranscript");

  let socket = null;
  let audioContext = null;
  let microphoneStream = null;
  let microphoneSource = null;
  let processor = null;
  let silentGain = null;
  let starting = false;
  let active = false;
  let stopping = false;
  let setupReady = false;
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
      if (!response.ok || !result || typeof result.available !== "boolean") {
        throw new Error("Voice availability could not be checked.");
      }
      voiceAvailability = result;
      if (requestId !== availabilityCheckSequence) return result;

      if (result.available) {
        const sessionMinutes = Math.max(1, Math.ceil((Number(result.maxSessionSeconds) || 540) / 60));
        if (result.testingMode) {
          const expires = result.testingModeExpiresAt ? new Date(result.testingModeExpiresAt) : null;
          const expiresLabel = expires && Number.isFinite(expires.getTime())
            ? expires.toLocaleString()
            : "the end of the test window";
          setAvailability(
            "TEST MODE · Unlimited daily voice time until " + expiresLabel +
              " · up to " + sessionMinutes + " min per conversation; reconnect to continue.",
            "normal",
          );
          return result;
        }
        const remainingSeconds = Number(result.dailyRemainingSeconds);
        let allowance = "";
        if (Number.isFinite(remainingSeconds)) {
          const remainingMinutes = Math.floor((remainingSeconds + 30) / 60);
          allowance = remainingMinutes > 0
            ? " · about " + remainingMinutes + " min of voice time may remain today on this network"
            : " · less than a minute of daily voice time may remain";
        }
        setAvailability(
          "Limits allow voice · up to " + sessionMinutes + " min per conversation" + allowance + " · no fixed question-count cap.",
          "normal",
        );
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
    const entry = getTranscriptNode(role);
    if (!entry) return;

    // Some servers send cumulative partial transcripts; others send small fragments.
    if (!entry.text) {
      entry.text = text;
    } else if (text === entry.text || entry.text.endsWith(text)) {
      // Duplicate/cumulative event: keep what is already displayed.
    } else if (text.startsWith(entry.text)) {
      entry.text = text;
    } else {
      entry.text = (entry.text + " " + text).replace(/\s+/g, " ").trim();
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
    processor = audioContext.createScriptProcessor(2048, 1, 1);
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

    const scheduledStart = Math.max(audioContext.currentTime + 0.015, nextPlaybackTime);
    source.start(scheduledStart);
    nextPlaybackTime = scheduledStart + buffer.duration;
    playbackNodes.add(source);
    source.addEventListener("ended", () => {
      playbackNodes.delete(source);
      try { source.disconnect(); } catch (_) { /* already disconnected */ }
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
      const disconnectMessage = typeof message.connection_status.message === "string"
        ? message.connection_status.message.trim().slice(0, 300)
        : "The voice connection ended. Tap Start talking to begin another conversation.";
      stopConversation(true);
      setStatus(disconnectMessage, "error");
      setAvailability("Voice connection ended. Availability will be checked again automatically.", "warning");
      return;
    }

    if (message.setup_complete || message.setupComplete) {
      setupReady = true;
      if (setupTimer) {
        clearTimeout(setupTimer);
        setupTimer = null;
      }
      starting = false;
      active = true;
      setButton("End conversation", false);
      setStatus("Connected. You can speak naturally; you may interrupt Moina at any time.");
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
      if (serverContent.interrupted) {
        stopPlayback();
        setStatus("Listening — go ahead.");
      }

      const modelTurn = serverContent.model_turn || serverContent.modelTurn;
      const parts = modelTurn && Array.isArray(modelTurn.parts) ? modelTurn.parts : [];
      for (const part of parts) {
        if (part.text) updateLiveTranscript("assistant", part.text);
        const inlineData = part.inline_data || part.inlineData;
        if (inlineData && inlineData.data) {
          playPcmAudio(inlineData.data, inlineData.mime_type || inlineData.mimeType);
        }
      }

      if (serverContent.turn_complete || serverContent.turnComplete) {
        finalizeTranscriptTurn();
        if (active) setStatus("Listening — you can speak again.");
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
    setButton("Start talking", false);
    if (message) setStatus(message);
    window.setTimeout(() => {
      if (!starting && !active) void refreshVoiceAvailability();
    }, 700);
  }

  function stopConversation(fromServer) {
    if (!socket && !starting && !active) return;
    stopping = true;
    const oldSocket = socket;
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
    finishStoppedState(fromServer ? "Voice session ended. Tap Start talking to reconnect." : "Conversation ended.");
  }

  async function ensureVisitorIdentity() {
    const response = await fetch("/api/identity", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Could not establish your private visitor profile. Please retry.");
  }

  async function startConversation() {
    if (starting || active) return;
    starting = true;
    stopping = false;
    setButton("Checking availability…", true);
    setStatus("Checking voice availability…");
    const preflight = await refreshVoiceAvailability();
    if (preflight && !preflight.available) {
      starting = false;
      setButton("Start talking", false);
      setStatus(preflight.message || "Voice is not available right now. Please try again later.", "error");
      return;
    }
    setButton("Connecting…", true);
    setStatus("Requesting microphone permission…");

    try {
      await ensureVisitorIdentity();
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
      setStatus("Connecting securely to the voice service…");
      const sessionSocket = new WebSocket(wsUrl.toString());
      socket = sessionSocket;
      sessionSocket.binaryType = "arraybuffer";

      sessionSocket.addEventListener("open", async () => {
        if (stopping || socket !== sessionSocket || sessionSocket.readyState !== WebSocket.OPEN) return;
        let memoryContext = "";
        try {
          if (typeof window.askMoinaGetMemoryContext === "function") {
            memoryContext = await window.askMoinaGetMemoryContext();
          }
        } catch (_) {
          memoryContext = "";
        }
        if (stopping || socket !== sessionSocket || sessionSocket.readyState !== WebSocket.OPEN) return;
        // The Worker keeps the model/system instruction fixed and accepts only a short, user-approved memory context.
        sessionSocket.send(JSON.stringify({ setup: {}, memory_context: String(memoryContext || "").slice(0, 1400) }));
        setStatus(memoryContext ? "Sending your selected memory context securely to Gemini and setting up your conversation…" : "Connected to the relay. Setting up your conversation…");
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
            closeMessage = "This conversation reached its time limit (about " + minutes + " minutes). Tap Start talking to begin another conversation.";
          } else if (reason === "Voice provider disconnected") {
            closeMessage = "The voice service closed its connection unexpectedly. This is not a question-count limit. Tap Start talking to reconnect.";
          } else if (reason === "Voice provider socket error") {
            closeMessage = "The voice service encountered a connection error. Tap Start talking to start a new conversation.";
          } else if (reason === "Client socket error") {
            closeMessage = "The browser connection encountered an error. Check your internet connection and try again.";
          } else if (reason === "Invalid PCM audio frame") {
            closeMessage = "AskMoina could not read an incoming microphone audio packet. Check your selected microphone or refresh the page, then try again. This is not a question-count limit.";
          } else if (reason === "Audio input rate limit exceeded") {
            closeMessage = "Audio packets arrived faster than AskMoina can accept them. This is not a question-count limit. Refresh and start a new conversation.";
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
            closeMessage = "The connection dropped without a clean close (code 1006), usually because the network or voice service interrupted it. Tap Start talking to retry.";
          } else if (event.code !== 1000) {
            closeMessage = "The connection closed unexpectedly (code " + event.code + "). Tap Start talking to retry.";
          } else {
            closeMessage = "The voice session ended without an explanation from the service (code 1000). Tap Start talking to reconnect.";
          }
        }
        finishStoppedState(closeMessage);
        if (!wasStopping) {
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
        setButton("Start talking", false);
        setStatus("Ready when you are. Your microphone starts only after you tap Start talking.");
        await refreshVoiceAvailability();
        return;
      }
      setButton("Voice not ready", true);
      setStatus("The voice backend is not configured yet. Refresh this page after the Worker deployment finishes.", "error");
      setAvailability("Voice will become available after service setup is complete.", "error");
    } catch (_) {
      setButton("Try voice service", false);
      setStatus("Could not confirm service status. You can still try connecting, or reload the page.", "error");
      await refreshVoiceAvailability();
    }
  }

  setAvailability("Checking voice availability…");
  checkBackend();
})();
