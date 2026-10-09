(() => {
  "use strict";

  const statusNode = document.querySelector("#status");
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

  function handleServerMessage(raw) {
    let message;
    try {
      message = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw));
    } catch (_) {
      setStatus("Received an unreadable response. Please end this session and try again.", "error");
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
      setStatus("This voice session is ending. Please start a new conversation.");
      stopConversation(true);
    }

    if (message.error) {
      setStatus("The voice service returned an error. Please end the session and try again.", "error");
      stopConversation(true);
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

  async function startConversation() {
    if (starting || active) return;
    starting = true;
    stopping = false;
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
      setStatus("Connecting securely to the voice service…");
      socket = new WebSocket(wsUrl.toString());
      socket.binaryType = "arraybuffer";

      socket.addEventListener("open", () => {
        if (stopping || !socket || socket.readyState !== WebSocket.OPEN) return;
        // The Worker replaces this placeholder with server-controlled model/system settings.
        socket.send(JSON.stringify({ setup: {} }));
        setStatus("Connected to the relay. Setting up your conversation…");
        setupTimer = window.setTimeout(() => {
          if (!setupReady && socket) {
            setStatus("Voice setup timed out. Please try starting a new conversation.", "error");
            stopConversation(true);
          }
        }, 15000);
      });

      socket.addEventListener("message", (event) => handleServerMessage(event.data));

      socket.addEventListener("error", () => {
        setStatus("Could not connect to the voice service. Please try again.", "error");
      });

      socket.addEventListener("close", (event) => {
        if (socket && socket.readyState === WebSocket.CLOSED) socket = null;
        const wasStopping = stopping;
        finishStoppedState(
          wasStopping
            ? "Conversation ended."
            : event.code === 1000
              ? "The voice session ended. Tap Start talking to reconnect."
              : "Connection lost. Check your connection and tap Start talking to retry."
        );
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

  setButton("Start talking", false);
  setStatus("Ready when you are.");
})();
