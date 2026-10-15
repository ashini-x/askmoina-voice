#!/usr/bin/env node
/**
 * Production browser synthetic for long-running audiovisual Live continuity.
 * Opens an authenticated Co-Pilot session with Chromium fake media and keeps camera
 * and microphone streaming for 155 seconds. Never logs credentials, audio or transcripts.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const rawBaseUrl = process.env.BASE_URL || "https://askmoina-voice.thenewtongs.workers.dev";
const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
const cookie = (process.env.ASKMOINA_SYNTHETIC_COOKIE || "").trim();
const match = /^moina_session=([A-Za-z0-9_-]{43})$/.exec(cookie);
if (!baseUrl.startsWith("https://")) throw new Error("Continuity smoke requires HTTPS.");
if (!match) throw new Error("A verified synthetic account cookie is required.");

let browser;
let context;
let page;
const liveSockets = [];
const closedSockets = [];
let assistantAudioFrames = 0;
let receivedWebSocketFrames = 0;
let parsedJsonFrames = 0;
let serverContentFrames = 0;
let modelTurnFrames = 0;
let outputTranscriptionFrames = 0;
let outputTextCharacters = 0;
let inlineDataParts = 0;
let unsupportedFramePayloads = 0;
let websocketFrameParseErrors = 0;
const framePayloadTypeCounts = {};
const audioMimeTypeCounts = {};
const recentFrameShapes = [];
const providerErrors = [];

function synthesizePcm16k(text) {
  // Ask espeak-ng to finalize the WAV header on disk. Its --stdout streaming
  // header can advertise a data chunk larger than the bytes captured by Node.
  const directory = mkdtempSync(join(tmpdir(), "askmoina-live-speech-"));
  const wavPath = join(directory, "continuity.wav");
  try {
    execFileSync("espeak-ng", ["-v", "en-us", "-s", "135", "-w", wavPath, text], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const wav = readFileSync(wavPath);
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("espeak-ng did not produce a valid WAV file.");
    }

    let format = 0;
    let channels = 0;
    let sourceRate = 0;
    let bitsPerSample = 0;
    let pcm = null;
    for (let offset = 12; offset + 8 <= wav.length;) {
      const chunkName = wav.toString("ascii", offset, offset + 4);
      const chunkSize = wav.readUInt32LE(offset + 4);
      const start = offset + 8;
      const end = start + chunkSize;
      if (end > wav.length) throw new Error("espeak-ng produced a truncated WAV chunk.");
      if (chunkName === "fmt " && chunkSize >= 16) {
        format = wav.readUInt16LE(start);
        channels = wav.readUInt16LE(start + 2);
        sourceRate = wav.readUInt32LE(start + 4);
        bitsPerSample = wav.readUInt16LE(start + 14);
      } else if (chunkName === "data") {
        pcm = wav.subarray(start, end);
      }
      offset = end + (chunkSize & 1);
    }
    if (format !== 1 || channels !== 1 || bitsPerSample !== 16 || !sourceRate || !pcm || pcm.length < 4) {
      throw new Error("espeak-ng returned an unsupported PCM WAV format.");
    }

    const sourceSampleCount = Math.floor(pcm.length / 2);
    const outputSampleCount = Math.max(1, Math.floor(sourceSampleCount * 16000 / sourceRate));
    const output = Buffer.alloc(outputSampleCount * 2);
    for (let i = 0; i < outputSampleCount; i += 1) {
      const position = i * sourceRate / 16000;
      const left = Math.min(Math.floor(position), sourceSampleCount - 1);
      const right = Math.min(left + 1, sourceSampleCount - 1);
      const fraction = position - left;
      const a = pcm.readInt16LE(left * 2);
      const b = pcm.readInt16LE(right * 2);
      const sample = Math.round(a * (1 - fraction) + b * fraction);
      output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
    }
    return output;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function splitPcmIntoBase64Chunks(pcm, chunkBytes = 3_200) {
  const chunks = [];
  for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
    chunks.push(pcm.subarray(offset, Math.min(offset + chunkBytes, pcm.length)).toString("base64"));
  }
  if (!chunks.length) throw new Error("Synthetic speech generator returned no PCM audio.");
  return chunks;
}
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });
  context = await browser.newContext({ permissions: ["camera", "microphone"] });
  await context.addCookies([{
    name: "moina_session",
    value: match[1],
    url: baseUrl,
    httpOnly: true,
    secure: true,
    sameSite: "Lax"
  }]);
  page = await context.newPage();
  // Expose only the active test socket so the synthetic can send one deliberate
  // post-start user turn without changing the production UI or logging user content.
  await page.addInitScript(() => {
    const nativeSend = WebSocket.prototype.send;
    // This handle is test-only: it lets the synthetic inject real PCM speech while
    // the fake microphone is paused, without the observer's silence filter dropping it.
    window.__askmoinaNativeContinuitySend = (socket, data) => nativeSend.call(socket, data);
    const observedSockets = [];
    window.__askmoinaContinuitySockets = observedSockets;
    window.__askmoinaSocketClosures = [];
    window.__askmoinaConnectionSignals = [];
    window.__askmoinaPauseContinuityAudio = false;
    WebSocket.prototype.send = function (data) {
      try {
        if (new URL(this.url).pathname === "/api/voice/socket") {
          if (!observedSockets.includes(this)) {
            observedSockets.push(this);
            this.addEventListener("close", (event) => window.__askmoinaSocketClosures.push({ code: event.code, reason: String(event.reason || "").slice(0, 100), wasClean: event.wasClean, at: Date.now() }));
            this.addEventListener("message", (event) => {
              if (typeof event.data !== "string") return;
              try {
                const frame = JSON.parse(event.data);
                if (frame.connection_status && typeof frame.connection_status === "object") {
                  window.__askmoinaConnectionSignals.push({ state: frame.connection_status.state || "", code: frame.connection_status.code || "", message: String(frame.connection_status.message || "").slice(0, 130), at: Date.now() });
                  if (window.__askmoinaConnectionSignals.length > 20) window.__askmoinaConnectionSignals.shift();
                }
                if (frame.error && typeof frame.error === "object") window.__askmoinaConnectionSignals.push({ state: "error", code: frame.error.code || "", message: String(frame.error.message || "").slice(0, 130), at: Date.now() });
              } catch { /* Retain only structured relay status. */ }
            });
          }
          if (window.__askmoinaPauseContinuityAudio && typeof data === "string") {
            const payload = JSON.parse(data);
            if (payload?.realtime_input?.audio) return;
          }
        }
      } catch { /* Ignore unrelated or non-JSON socket frames. */ }
      return nativeSend.call(this, data);
    };
  });
  page.on("websocket", (ws) => {
    try {
      if (new URL(ws.url()).pathname !== "/api/voice/socket") return;
      liveSockets.push(ws);
      ws.on("close", () => closedSockets.push(ws.url()));
      // Count audio-bearing replies without storing or logging audio/transcripts.
      ws.on("framereceived", (frameEvent) => {
        receivedWebSocketFrames += 1;
        let framePayloadType = "unknown";
        let frameText = "";
        try {
          // Playwright emits { payload: string | Buffer }, not the payload itself.
          // Unwrap the documented event shape before parsing JSON/audio metadata.
          const payload = frameEvent && typeof frameEvent === "object" && "payload" in frameEvent
            ? frameEvent.payload
            : frameEvent;
          framePayloadType = typeof payload === "string" ? "string" :
            Buffer.isBuffer(payload) ? "buffer" :
            payload instanceof ArrayBuffer ? "arraybuffer" :
            ArrayBuffer.isView(payload) ? "arraybuffer-view" : typeof payload;
          framePayloadTypeCounts[framePayloadType] = (framePayloadTypeCounts[framePayloadType] || 0) + 1;
          frameText = typeof payload === "string" ? payload :
            Buffer.isBuffer(payload) ? payload.toString("utf8") :
            payload instanceof ArrayBuffer ? Buffer.from(payload).toString("utf8") :
            ArrayBuffer.isView(payload)
              ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString("utf8")
              : "";
          if (!frameText) {
            unsupportedFramePayloads += 1;
            recentFrameShapes.push({ kind: "unsupported_frame_payload", payloadType: framePayloadType });
            if (recentFrameShapes.length > 20) recentFrameShapes.shift();
            return;
          }
          const frame = JSON.parse(frameText);
          parsedJsonFrames += 1;
          const serverContent = frame.serverContent || frame.server_content;
          if (serverContent && typeof serverContent === "object") {
            serverContentFrames += 1;
            if (serverContent.turnComplete || serverContent.turn_complete) {
              recentFrameShapes.push({kind:"turn_complete"});
            }
            const output = serverContent.outputTranscription || serverContent.output_transcription;
            if (output && typeof output.text === "string") {
              outputTranscriptionFrames += 1;
              outputTextCharacters += output.text.length;
            }
          }
          if (frame.error && typeof frame.error === "object") {
            providerErrors.push({
              code: String(frame.error.code || frame.error.status || "unknown").slice(0, 80),
              message: String(frame.error.message || "").slice(0, 140),
            });
            if (providerErrors.length > 8) providerErrors.shift();
          }
          const modelTurn = serverContent?.modelTurn || serverContent?.model_turn;
          const parts = modelTurn?.parts;
          if (Array.isArray(parts)) {
            modelTurnFrames += 1;
            let audioPartsInFrame = 0;
            for (const part of parts) {
              if (typeof part?.text === "string") outputTextCharacters += part.text.length;
              const inline = part?.inlineData || part?.inline_data;
              if (!inline || typeof inline !== "object") continue;
              inlineDataParts += 1;
              const mime = String(inline.mimeType || inline.mime_type || "unknown").slice(0, 80);
              if (mime.startsWith("audio/pcm") && typeof inline.data === "string" && inline.data.length) {
                assistantAudioFrames += 1;
                audioPartsInFrame += 1;
                audioMimeTypeCounts[mime] = (audioMimeTypeCounts[mime] || 0) + 1;
              }
            }
            recentFrameShapes.push({kind:"model_turn",partCount:parts.length,audioParts:audioPartsInFrame});
          } else if (serverContent) {
            recentFrameShapes.push({kind:"server_content",keys:Object.keys(serverContent).slice(0,12)});
          } else {
            recentFrameShapes.push({kind:"other",keys:Object.keys(frame).slice(0,12)});
          }
          if (recentFrameShapes.length > 20) recentFrameShapes.shift();
        } catch {
          websocketFrameParseErrors += 1;
          recentFrameShapes.push({
            kind: "frame_parse_error",
            payloadType: framePayloadType,
            payloadLength: frameText.length,
          });
          if (recentFrameShapes.length > 20) recentFrameShapes.shift();
          // Record only frame counts and payload shape; never retain media, text or transcripts.
        }
      });
    } catch { /* Ignore unrelated WebSockets. */ }
  });

  const response = await page.goto(baseUrl + "/copilot", { waitUntil: "domcontentloaded", timeout: 30_000 });
  assert.equal(response?.status(), 200, "authenticated Co-Pilot route should load");
  await page.waitForSelector("#showProblemButton", { timeout: 15_000 });
  await page.locator("#showProblemButton").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector("#connectionPill")?.dataset.state === "live",
    null,
    { timeout: 45_000 }
  );
  assert.equal(liveSockets.length, 1, "a single authenticated Live WebSocket should open");

  const sessionStartedAt = Date.now();
  await page.evaluate(() => {
    const pill = document.querySelector("#connectionPill");
    const status = document.querySelector("#status");
    const notice = document.querySelector("#connectionNotice");
    const transcript = document.querySelector("#transcript");
    window.__askmoinaContinuityStates = [pill?.dataset.state || "unknown"];
    window.__askmoinaContinuityTimeline = [];
    let lastSnapshot = "";
    const collect = () => {
      const snapshot = {
        state: pill?.dataset.state || "unknown",
        statusKind: status?.dataset.kind || "unknown",
        status: (status?.textContent || "").slice(0, 140),
        noticeVisible: Boolean(notice && !notice.hidden),
        noticeKind: notice?.dataset.kind || "none",
        noticeTitle: (document.querySelector("#connectionNoticeTitle")?.textContent || "").slice(0, 100),
        noticeMessage: (document.querySelector("#connectionNoticeMessage")?.textContent || "").slice(0, 140),
      };
      const signature = JSON.stringify(snapshot);
      if (signature !== lastSnapshot) {
        lastSnapshot = signature;
        window.__askmoinaContinuityTimeline.push({ elapsedMs: Date.now() - window.__askmoinaContinuityStartedAt, ...snapshot });
        if (window.__askmoinaContinuityTimeline.length > 120) window.__askmoinaContinuityTimeline.shift();
      }
    };
    window.__askmoinaContinuityStartedAt = Date.now();
    collect();
    new MutationObserver(() => {
      window.__askmoinaContinuityStates.push(pill?.dataset.state || "unknown");
      collect();
    }).observe(pill, { attributes: true, attributeFilter: ["data-state"] });
    const observer = new MutationObserver(collect);
    for (const node of [status, notice, transcript]) {
      if (node) observer.observe(node, { attributes: true, childList: true, characterData: true, subtree: true });
    }
  });

  // Keep real camera/microphone tracks active beyond the reported ~2-minute cutoff.
  // Then send a deterministic user turn and verify the provider actually speaks again.
  // A silent fake microphone alone cannot verify compression/continuity by itself.
  await page.waitForTimeout(125_000);
  const assistantAudioFramesBeforeTurn = assistantAudioFrames;
  const syntheticPcm = synthesizePcm16k(
    "Moina, can you still hear me? Please answer aloud in one short sentence confirming our camera conversation is continuing."
  );
  const syntheticAudioChunks = splitPcmIntoBase64Chunks(syntheticPcm);
  const turnDispatch = await page.evaluate(async (chunks) => {
    const sockets = window.__askmoinaContinuitySockets || [];
    const ws = [...sockets].reverse().find((candidate) => candidate.readyState === WebSocket.OPEN);
    if (!ws) return { sent: false, reason: "no-open-voice-socket", chunksSent: 0 };
    const sendNative = window.__askmoinaNativeContinuitySend;
    if (typeof sendNative !== "function") return { sent: false, reason: "native-test-sender-missing", chunksSent: 0 };
    // Pause the silent fake mic and inject a properly completed, speech-bearing PCM turn.
    // This tests the same real-time audio path as a user, instead of sending clientContent
    // during an intentionally unfinished silent microphone stream.
    window.__askmoinaPauseContinuityAudio = true;
    for (const chunk of chunks) {
      sendNative(ws, JSON.stringify({
        realtime_input: { audio: { data: chunk, mime_type: "audio/pcm;rate=16000" } }
      }));
      await new Promise((resolve) => setTimeout(resolve, 85));
    }
    sendNative(ws, JSON.stringify({ realtime_input: { audio_stream_end: true } }));
    return { sent: true, chunksSent: chunks.length };
  }, syntheticAudioChunks);
  const beforeTurnDiagnostics = await page.evaluate(() => ({
    state: document.querySelector("#connectionPill")?.dataset.state || "unknown",
    statusKind: document.querySelector("#status")?.dataset.kind || "unknown",
    status: (document.querySelector("#status")?.textContent || "").slice(0, 120),
    noticeVisible: Boolean(document.querySelector("#connectionNotice") && !document.querySelector("#connectionNotice").hidden),
    noticeKind: document.querySelector("#connectionNotice")?.dataset.kind || "none",
    noticeTitle: (document.querySelector("#connectionNoticeTitle")?.textContent || "").slice(0, 80),
    noticeMessage: (document.querySelector("#connectionNoticeMessage")?.textContent || "").slice(0, 120),
    sockets: (window.__askmoinaContinuitySockets || []).map((candidate) => ({ readyState: candidate.readyState })),
    socketClosures: (window.__askmoinaSocketClosures || []).slice(-8),
    connectionSignals: (window.__askmoinaConnectionSignals || []).slice(-12),
    timeline: (window.__askmoinaContinuityTimeline || []).slice(-12),
  }));
  console.log("Production audiovisual Live pre-turn diagnostics: " + JSON.stringify({
    ...beforeTurnDiagnostics,
    browserLiveSocketCount: liveSockets.length,
    closedBrowserSockets: closedSockets.length,
    continuityTurnDispatched: turnDispatch.sent,
    continuityTurnReason: turnDispatch.reason || "",
    elapsedMs: Date.now() - sessionStartedAt,
    receivedWebSocketFrames,
    parsedJsonFrames,
    serverContentFrames,
    modelTurnFrames,
    outputTranscriptionFrames,
    outputTextCharacters,
    inlineDataParts,
    unsupportedFramePayloads,
    websocketFrameParseErrors,
    framePayloadTypeCounts,
    assistantAudioFrames,
    audioMimeTypeCounts,
    recentFrameShapes,
    providerErrors,
  }));
  assert.equal(turnDispatch.sent, true, "the browser must still have an open voice socket for the post-2-minute speech turn");
  assert.ok(turnDispatch.chunksSent > 0, "the synthetic must send a real PCM speech turn");

  const replyDeadline = Date.now() + 30_000;
  while (Date.now() < replyDeadline && assistantAudioFrames <= assistantAudioFramesBeforeTurn) {
    await page.waitForTimeout(250);
  }
  const postTurnDiagnostics = await page.evaluate(() => ({
    state: document.querySelector("#connectionPill")?.dataset.state || "unknown",
    statusKind: document.querySelector("#status")?.dataset.kind || "unknown",
    status: (document.querySelector("#status")?.textContent || "").slice(0, 120),
    noticeVisible: Boolean(document.querySelector("#connectionNotice") && !document.querySelector("#connectionNotice").hidden),
    noticeKind: document.querySelector("#connectionNotice")?.dataset.kind || "none",
    sockets: (window.__askmoinaContinuitySockets || []).map((candidate) => ({ readyState: candidate.readyState })),
    socketClosures: (window.__askmoinaSocketClosures || []).slice(-8),
    connectionSignals: (window.__askmoinaConnectionSignals || []).slice(-12),
    assistantTranscriptChars: [...document.querySelectorAll("#transcript .from-moina .transcript-text")]
      .reduce((sum, node) => sum + (node.textContent || "").length, 0),
  }));
  console.log("Production audiovisual Live post-turn diagnostics: " + JSON.stringify({
    ...postTurnDiagnostics,
    browserLiveSocketCount: liveSockets.length,
    closedBrowserSockets: closedSockets.length,
    assistantAudioFramesBeforeTurn,
    assistantAudioFramesAfterTurn: assistantAudioFrames,
    assistantAudioFramesReceived: assistantAudioFrames - assistantAudioFramesBeforeTurn,
    receivedWebSocketFrames,
    parsedJsonFrames,
    serverContentFrames,
    modelTurnFrames,
    outputTranscriptionFrames,
    outputTextCharacters,
    inlineDataParts,
    unsupportedFramePayloads,
    websocketFrameParseErrors,
    framePayloadTypeCounts,
    audioMimeTypeCounts,
    recentFrameShapes,
    providerErrors,
  }));
  assert.ok(parsedJsonFrames > 0,
    "the synthetic observer must parse at least one JSON WebSocket frame; zero parsed frames means the observer is broken");
  assert.ok(assistantAudioFrames > assistantAudioFramesBeforeTurn,
    "the assistant must transmit a new audio response after the >2-minute continuity test turn");

  // Keep the same audiovisual session alive through the full 155-second window.
  const remainingMs = Math.max(0, 155_000 - (Date.now() - sessionStartedAt));
  if (remainingMs) await page.waitForTimeout(remainingMs);

  const finalState = await page.locator("#connectionPill").getAttribute("data-state");
  const buttonPressed = await page.locator("#toggleCopilot").getAttribute("aria-pressed");
  const diagnostics = await page.evaluate(() => ({
    finalState: document.querySelector("#connectionPill")?.dataset.state || "unknown",
    statusKind: document.querySelector("#status")?.dataset.kind || "unknown",
    status: (document.querySelector("#status")?.textContent || "").slice(0, 140),
    noticeVisible: Boolean(document.querySelector("#connectionNotice") && !document.querySelector("#connectionNotice").hidden),
    noticeKind: document.querySelector("#connectionNotice")?.dataset.kind || "none",
    assistantTranscriptChars: [...document.querySelectorAll("#transcript .from-moina .transcript-text")]
      .reduce((sum, node) => sum + (node.textContent || "").length, 0),
    assistantAudioFrames,
    continuityReplyAudioFrames: assistantAudioFrames - assistantAudioFramesBeforeTurn,
    timeline: (window.__askmoinaContinuityTimeline || []).slice(-24),
    socketCount: (window.__askmoinaContinuitySockets || []).length,
  }));
  console.log("Production audiovisual Live continuity diagnostics: " + JSON.stringify({
    ...diagnostics,
    browserLiveSocketCount: liveSockets.length,
    closedBrowserSockets: closedSockets.length,
    continuityTurnDispatched: turnDispatch.sent,
    assistantAudioFrames,
    continuityReplyAudioFrames: assistantAudioFrames - assistantAudioFramesBeforeTurn,
  }));
  assert.equal(finalState, "live", "Live session should still be active after 155 seconds");
  assert.equal(buttonPressed, "true", "call controls should remain in active state");
  assert.deepEqual(closedSockets, [], "browser-facing Live socket must not close during the continuity window");
  assert.ok(diagnostics.timeline.some((item) => item.state === "live"),
    "the browser must have entered the live state");
  assert.ok(diagnostics.timeline.every((item) => ["live", "connecting"].includes(item.state)),
    "the session must not fall back to ready/error during continuity");
  assert.equal(diagnostics.noticeVisible, false,
    "no stale reconnect overlay should remain after a stable long-running session");
  console.log("Production audiovisual Live continuity: PASS (155 seconds, post-start AI reply, browser socket stayed open).");

  await page.locator("#toggleCopilot").click();
  await page.waitForTimeout(700);
} catch (error) {
  console.error("Production audiovisual Live continuity: FAIL (" +
    (error instanceof Error ? error.message.slice(0, 240) : "unknown error") + ")");
  if (page) {
    const diagnostic = await page.evaluate(() => ({
      state: document.querySelector("#connectionPill")?.dataset.state || "unknown",
      statusKind: document.querySelector("#status")?.dataset.kind || "unknown",
      status: (document.querySelector("#status")?.textContent || "").slice(0, 140),
      noticeVisible: Boolean(document.querySelector("#connectionNotice") && !document.querySelector("#connectionNotice").hidden),
      noticeKind: document.querySelector("#connectionNotice")?.dataset.kind || "none",
      timeline: (window.__askmoinaContinuityTimeline || []).slice(-24),
      socketCount: (window.__askmoinaContinuitySockets || []).length,
      assistantTranscriptChars: [...document.querySelectorAll("#transcript .from-moina .transcript-text")]
        .reduce((sum, node) => sum + (node.textContent || "").length, 0),
      assistantAudioFrames,
    })).catch(() => null);
    if (diagnostic) console.error("Production audiovisual Live continuity diagnostics: " + JSON.stringify({
      ...diagnostic, browserLiveSocketCount: liveSockets.length, closedBrowserSockets: closedSockets.length,
    }));
  }
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
}
