(() => {
  "use strict";

  const statusNode = document.querySelector("#prototypeStatus");
  const metricsNode = document.querySelector("#prototypeMetrics");
  const tokenNode = document.querySelector("#prototypeToken");
  const toggleButton = document.querySelector("#prototypeToggle");
  const buttonLabel = document.querySelector("#prototypeButtonLabel");
  const interruptButton = document.querySelector("#prototypeInterrupt");
  const transcriptNode = document.querySelector("#prototypeTranscript");
  const emptyNode = document.querySelector("#prototypeEmpty");
  const clearButton = document.querySelector("#prototypeClear");

  let active = false;
  let starting = false;
  let audioContext = null;
  let stream = null;
  let sourceNode = null;
  let processorNode = null;
  let silentGain = null;
  let speaking = false;
  let speechStartedAt = 0;
  let silentFrames = 0;
  let turnChunks = [];
  let preRoll = [];
  let requestSequence = 0;
  let requestController = null;
  let playbackSource = null;
  let playbackBuffer = null;
  let history = [];
  let turnCount = 0;
  let hasTranscript = false;
  const SILENCE_FRAMES_TO_END = 16;
  const MAX_TURN_MS = 14_000;
  const START_RMS = 0.021;
  const PLAYBACK_INTERRUPT_RMS = 0.042;
  const SILENCE_RMS = 0.011;

  function setStatus(message, kind) {
    statusNode.textContent = message;
    statusNode.dataset.kind = kind || "normal";
  }

  function setButton(label, disabled) {
    buttonLabel.textContent = label;
    toggleButton.disabled = Boolean(disabled);
    toggleButton.classList.toggle("is-live", active);
    toggleButton.classList.toggle("is-starting", starting);
    toggleButton.setAttribute("aria-pressed", active ? "true" : "false");
    interruptButton.disabled = !active;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  function downsampleTo16k(input, sourceRate) {
    if (sourceRate === 16000) return new Float32Array(input);
    const ratio = sourceRate / 16000;
    const length = Math.floor(input.length / ratio);
    const output = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const position = i * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, input.length - 1);
      const fraction = position - left;
      output[i] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return output;
  }

  function rms(samples) {
    let energy = 0;
    for (let i = 0; i < samples.length; i += 1) energy += samples[i] * samples[i];
    return Math.sqrt(energy / Math.max(1, samples.length));
  }

  function makeWavBase64(chunks) {
    const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const pcm = new Int16Array(sampleCount);
    let cursor = 0;
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, chunk[i]));
        pcm[cursor++] = sample < 0 ? sample * 32768 : sample * 32767;
      }
    }
    const wav = new ArrayBuffer(44 + pcm.byteLength);
    const view = new DataView(wav);
    const write = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + pcm.byteLength, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, pcm.byteLength, true);
    new Int16Array(wav, 44).set(pcm);
    return bytesToBase64(new Uint8Array(wav));
  }

  function addEntry(label, text, meta) {
    if (!hasTranscript) {
      if (emptyNode && emptyNode.parentNode === transcriptNode) emptyNode.remove();
      hasTranscript = true;
    }
    const article = document.createElement("article");
    article.className = "prototype-entry";
    const heading = document.createElement("span");
    heading.className = "prototype-entry-label";
    heading.textContent = label;
    const body = document.createElement("p");
    body.textContent = text;
    article.append(heading, body);
    if (meta) {
      const footer = document.createElement("p");
      footer.className = "prototype-meta";
      footer.textContent = meta;
      article.appendChild(footer);
    }
    transcriptNode.appendChild(article);
    transcriptNode.scrollTop = transcriptNode.scrollHeight;
  }

  function stripTtsTags(text) {
    return String(text || "").replace(/<(?:laugh|laughter|sigh|breathing|short_pause|pause)>/gi, "").replace(/\s+/g, " ").trim();
  }

  function stopPlayback() {
    if (playbackSource) {
      try { playbackSource.stop(); } catch (_) {}
      try { playbackSource.disconnect(); } catch (_) {}
    }
    playbackSource = null;
    playbackBuffer = null;
    if (audioContext) audioContext.resume().catch(() => {});
  }

  function interruptPendingTurn() {
    requestSequence += 1;
    if (requestController) {
      requestController.abort();
      requestController = null;
    }
    stopPlayback();
    setStatus("Interrupted. Speak now; pause briefly when your turn is finished.");
    metricsNode.textContent = "Audio playback stopped · listening for your next turn";
  }

  async function playWavBase64(data) {
    if (!audioContext || !data) return;
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const decoded = await audioContext.decodeAudioData(bytes.buffer.slice(0));
    if (!active) return;
    playbackBuffer = decoded;
    const source = audioContext.createBufferSource();
    source.buffer = decoded;
    source.connect(audioContext.destination);
    playbackSource = source;
    source.addEventListener("ended", () => {
      if (playbackSource === source) {
        playbackSource = null;
        playbackBuffer = null;
        if (active) setStatus("Listening. Speak naturally; pause briefly after your turn.");
      }
      try { source.disconnect(); } catch (_) {}
    });
    source.start();
  }

  async function submitTurn(chunks) {
    const token = tokenNode.value.trim();
    if (!token) {
      setStatus("Enter the separate staging access token first.", "error");
      return;
    }
    const audioWavBase64 = makeWavBase64(chunks);
    const id = ++requestSequence;
    const controller = new AbortController();
    requestController = controller;
    const startedAt = performance.now();
    setStatus("Understanding your turn…");
    metricsNode.textContent = "Transcribing and preparing a response…";
    try {
      const memoryContext = (() => {
        try {
          return String(localStorage.getItem("askmoina.memory.context") || sessionStorage.getItem("askmoina.memory.context") || "").trim().slice(0, 3000);
        } catch (_) { return ""; }
      })();
      const response = await fetch("/api/tts-prototype/turn", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
          audio_wav_base64: audioWavBase64,
          history: history.slice(-12),
          memory_context: memoryContext
        }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (id !== requestSequence) return;
        const reasons = {
          prototype_disabled: "This Worker has not enabled the separate TTS prototype.",
          prototype_unauthorized: "The prototype token was not accepted.",
          conversation_model_failed: "The conversation model request failed.",
          speech_model_failed: "The designed-voice speech request failed.",
          request_cancelled: "That response was cancelled because you interrupted.",
          voice_capacity_or_daily_limit_reached: "The shared voice usage limits do not allow another turn right now."
        };
        throw new Error(reasons[payload.error] || "The prototype request failed (" + response.status + ").");
      }
      if (id !== requestSequence || !active) return;
      history.push({ role: "user", text: payload.userTranscript });
      history.push({ role: "model", text: stripTtsTags(payload.reply) });
      history = history.slice(-12);
      turnCount += 1;
      addEntry("You", payload.userTranscript);
      addEntry("Moina · Candidate A", stripTtsTags(payload.reply),
        "Conversation model: " + payload.timings.conversationMs + " ms · Voice generation: " +
        payload.timings.speechSynthesisMs + " ms · Total: " + payload.timings.totalMs + " ms");
      metricsNode.textContent = "Turn " + turnCount + " · full TTS response ready in " +
        payload.timings.totalMs + " ms · voice " + payload.voiceId;
      setStatus("Playing Moina's designed voice…");
      requestController = null;
      await playWavBase64(payload.audio_wav_base64);
      if (id === requestSequence && active) setStatus("Listening. Speak naturally; pause briefly after your turn.");
    } catch (error) {
      if (error && error.name === "AbortError") return;
      if (id !== requestSequence || !active) return;
      setStatus(error && error.message ? error.message : "The prototype request failed.", "error");
      metricsNode.textContent = "No production settings were changed.";
    } finally {
      if (requestController === controller) requestController = null;
      if (id === requestSequence && active && !playbackSource && !speaking) {
        metricsNode.textContent += " · ready for another turn";
      }
    }
  }

  function finishUtterance() {
    if (!speaking) return;
    speaking = false;
    silentFrames = 0;
    const chunks = turnChunks;
    turnChunks = [];
    const durationMs = Date.now() - speechStartedAt;
    preRoll = [];
    const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (durationMs < 180 || totalSamples < 4_000) {
      setStatus("I didn't catch enough audio. Please try again.", "warning");
      return;
    }
    void submitTurn(chunks);
  }

  function beginUtterance(samples) {
    if (requestController || playbackSource) interruptPendingTurn();
    speaking = true;
    speechStartedAt = Date.now();
    silentFrames = 0;
    turnChunks = [...preRoll, samples];
    preRoll = [];
    setStatus("Listening to your turn…");
    metricsNode.textContent = "Pause briefly when you have finished speaking.";
  }

  function onAudioProcess(event) {
    if (!active || !audioContext) return;
    const samples = downsampleTo16k(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
    if (!samples.length) return;
    const level = rms(samples);
    if (!speaking) {
      const threshold = playbackSource || requestController ? PLAYBACK_INTERRUPT_RMS : START_RMS;
      if (level >= threshold) {
        beginUtterance(samples);
      } else {
        preRoll.push(samples);
        if (preRoll.length > 5) preRoll.shift();
      }
      return;
    }

    turnChunks.push(samples);
    if (level < SILENCE_RMS) silentFrames += 1;
    else silentFrames = 0;

    if (silentFrames >= SILENCE_FRAMES_TO_END || Date.now() - speechStartedAt >= MAX_TURN_MS) {
      finishUtterance();
    }
  }

  async function startPrototype() {
    if (starting || active) return;
    if (!tokenNode.value.trim()) {
      setStatus("Enter the access token for the separate staging Worker first.", "error");
      tokenNode.focus();
      return;
    }
    starting = true;
    setButton("Requesting microphone…", true);
    setStatus("Requesting microphone permission…");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser does not support microphone access.");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();
      sourceNode = audioContext.createMediaStreamSource(stream);
      processorNode = audioContext.createScriptProcessor(2048, 1, 1);
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processorNode.onaudioprocess = onAudioProcess;
      sourceNode.connect(processorNode);
      processorNode.connect(silentGain);
      silentGain.connect(audioContext.destination);
      active = true;
      starting = false;
      setButton("End prototype", false);
      setStatus("Listening. Speak naturally; pause briefly after your turn.");
      metricsNode.textContent = "Voice: Candidate A · automatic turn detection enabled";
    } catch (error) {
      await stopPrototype();
      setStatus(error && error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access to continue."
        : (error && error.message) || "Could not start the prototype.", "error");
    } finally {
      starting = false;
      if (!active) setButton("Start prototype", false);
    }
  }

  async function stopPrototype() {
    active = false;
    starting = false;
    requestSequence += 1;
    if (requestController) requestController.abort();
    requestController = null;
    speaking = false;
    turnChunks = [];
    preRoll = [];
    stopPlayback();
    if (processorNode) {
      processorNode.onaudioprocess = null;
      try { processorNode.disconnect(); } catch (_) {}
      processorNode = null;
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch (_) {}
      sourceNode = null;
    }
    if (silentGain) {
      try { silentGain.disconnect(); } catch (_) {}
      silentGain = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (audioContext) {
      const oldContext = audioContext;
      audioContext = null;
      await oldContext.close().catch(() => {});
    }
    setButton("Start prototype", false);
    setStatus("Prototype stopped. The production voice path was not changed.");
  }

  toggleButton.addEventListener("click", () => {
    if (active || starting) void stopPrototype();
    else void startPrototype();
  });
  interruptButton.addEventListener("click", () => {
    if (!active) return;
    interruptPendingTurn();
  });
  clearButton.addEventListener("click", () => {
    stopPlayback();
    history = [];
    turnCount = 0;
    transcriptNode.replaceChildren();
    if (emptyNode) {
      emptyNode.textContent = "Conversation history cleared for this prototype page.";
      transcriptNode.appendChild(emptyNode);
    }
    hasTranscript = false;
    metricsNode.textContent = "Conversation context cleared.";
    setStatus(active ? "Listening. Speak naturally." : "History cleared.");
  });
  window.addEventListener("pagehide", () => { void stopPrototype(); });

  setButton("Start prototype", false);
})();