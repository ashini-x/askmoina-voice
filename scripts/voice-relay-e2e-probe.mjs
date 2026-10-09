import WebSocket from "ws";

const startedAt = Date.now();
const endpoint = "wss://askmoina-voice.thenewtongs.workers.dev/api/voice/socket";
const sampleUrl = "https://storage.googleapis.com/generativeai-downloads/data/hello_are_you_there.pcm";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const sampleResponse = await fetch(sampleUrl);
  if (!sampleResponse.ok) throw new Error(`sample_audio_http_${sampleResponse.status}`);
  const sampleBuffer = Buffer.from(await sampleResponse.arrayBuffer());
  if (sampleBuffer.length < 4) throw new Error("sample_audio_empty");

  const socket = new WebSocket(endpoint, {
    origin: "https://askmoina-voice.thenewtongs.workers.dev",
    handshakeTimeout: 10_000,
  });

  let setupComplete = false;
  let audioSent = false;
  let inputAudioFrames = 0;
  let outputAudioChunks = 0;
  let outputAudioBase64Chars = 0;
  let turnComplete = false;
  let settled = false;
  let setupTimer;
  let responseTimer;
  let totalTimer;

  const closeSocket = () => {
    try {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Automated relay test complete");
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    } catch { /* already closed */ }
  };

  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(setupTimer);
    clearTimeout(responseTimer);
    clearTimeout(totalTimer);
    closeSocket();
    if (error) {
      console.error("VOICE_RELAY_E2E_RESULT", JSON.stringify({
        ok: false,
        stage: setupComplete ? "audio-response" : "setup",
        setupComplete,
        inputAudioFrames,
        outputAudioChunks,
        outputAudioBase64Chars,
        turnComplete,
        elapsedMs: Date.now() - startedAt,
        error: String(error.message || error).slice(0, 220),
      }));
      process.exitCode = 1;
      return;
    }
    console.log("VOICE_RELAY_E2E_RESULT", JSON.stringify({
      ok: true,
      setupComplete,
      inputAudioFrames,
      outputAudioChunks,
      outputAudioBase64Chars,
      turnComplete,
      elapsedMs: Date.now() - startedAt,
    }));
  };

  totalTimer = setTimeout(() => finish(new Error("overall_timeout")), 35_000);
  setupTimer = setTimeout(() => {
    if (!setupComplete) finish(new Error("setup_timeout"));
  }, 10_000);

  socket.on("open", () => {
    socket.send(JSON.stringify({ setup: {} }));
  });

  socket.on("message", async (data) => {
    try {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
      const message = JSON.parse(text);

      if (message.error) {
        const error = message.error;
        finish(new Error(`voice_error_${String(error.code || error.status || "unknown")}: ${String(error.message || "").slice(0, 120)}`));
        return;
      }

      if (message.setupComplete || message.setup_complete) {
        setupComplete = true;
        clearTimeout(setupTimer);
        if (!audioSent) {
          audioSent = true;
          responseTimer = setTimeout(() => finish(new Error("no_audio_response_timeout")), 22_000);
          // Send mono PCM16 at 16 kHz in <=100ms frames, matching the browser client.
          const frameBytes = 3200;
          for (let offset = 0; offset < sampleBuffer.length; offset += frameBytes) {
            if (settled || socket.readyState !== WebSocket.OPEN) return;
            const chunk = sampleBuffer.subarray(offset, offset + frameBytes);
            socket.send(JSON.stringify({
              realtime_input: {
                audio: {
                  data: chunk.toString("base64"),
                  mime_type: "audio/pcm;rate=16000",
                },
              },
            }));
            inputAudioFrames += 1;
            await delay(100);
          }
          if (!settled && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ realtime_input: { audio_stream_end: true } }));
          }
        }
      }

      const serverContent = message.serverContent || message.server_content;
      const modelTurn = serverContent?.modelTurn || serverContent?.model_turn;
      const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts : [];
      for (const part of parts) {
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData && typeof inlineData.data === "string") {
          outputAudioChunks += 1;
          outputAudioBase64Chars += inlineData.data.length;
        }
      }

      if (serverContent?.turnComplete || serverContent?.turn_complete) {
        turnComplete = true;
        if (outputAudioChunks > 0) finish();
      }
    } catch (error) {
      finish(new Error(`message_parse_or_processing_error: ${String(error.message || error).slice(0, 120)}`));
    }
  });

  socket.on("error", (error) => finish(new Error(`websocket_error: ${String(error.message || error).slice(0, 160)}`)));
  socket.on("close", (code, reason) => {
    if (!settled) finish(new Error(`closed_before_success: ${code}: ${String(reason || "").slice(0, 120)}`));
  });
}

main().catch((error) => {
  console.error("VOICE_RELAY_E2E_FATAL", String(error.message || error).slice(0, 220));
  process.exitCode = 1;
});
