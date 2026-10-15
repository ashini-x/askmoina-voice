#!/usr/bin/env node
/**
 * Production browser synthetic for long-running audiovisual Live continuity.
 * Opens an authenticated Co-Pilot session with Chromium fake media and keeps camera
 * and microphone streaming beyond 155 seconds. Requires two separate delayed spoken
 * turns to each produce completed assistant audio. Never logs credentials, audio or transcripts.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
let mediaDirectory;
const liveSockets = [];
const closedSockets = [];
let assistantAudioFrames = 0;
let receivedWebSocketFrames = 0;
let parsedJsonFrames = 0;
let serverContentFrames = 0;
let assistantTurnCompleteFrames = 0;
let modelTurnFrames = 0;
let outputTranscriptionFrames = 0;
let inputTranscriptionFrames = 0;
let inputTranscriptCharacters = 0;
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
    // Leave a full second of silence after speech so automatic server-side VAD can
    // observe a natural end-of-speech boundary at realistic microphone cadence.
    return Buffer.concat([output, Buffer.alloc(16_000 * 2)]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeMonoPcm16Wav(path, pcm, sampleRate = 16_000) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 2 || pcm.length % 2 !== 0) {
    throw new TypeError("Synthetic microphone PCM must contain whole 16-bit samples.");
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([header, pcm]));
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
  // Chromium's default fake audio device emits a beep. Use a real WAV input instead:
  // 170 seconds of silence followed by two distinct utterances. Both exercise getUserMedia,
  // browser PCM capture and local VAD, rather than direct socket text injection.
  mediaDirectory = mkdtempSync(join(tmpdir(), "askmoina-live-mic-fixture-"));
  const firstSpeechPcm = synthesizePcm16k(
    "Moina, can you still hear me? Please answer aloud in one short sentence confirming our camera conversation is continuing."
  );
  const secondSpeechPcm = synthesizePcm16k(
    "Moina, this is my next spoken turn. Please answer aloud with one short sentence."
  );
  const silentPrelude = Buffer.alloc(16_000 * 2 * 170);
  // Each utterance has one second of trailing silence. Add thirty-five more seconds
  // before turn two so normal assistant response latency cannot overlap the two turns.
  const secondTurnGap = Buffer.alloc(16_000 * 2 * 35);
  const fakeMicrophoneWavPath = join(mediaDirectory, "delayed-speech.wav");
  writeMonoPcm16Wav(fakeMicrophoneWavPath, Buffer.concat([
    silentPrelude, firstSpeechPcm, secondTurnGap, secondSpeechPcm
  ]));

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${fakeMicrophoneWavPath}%noloop`,
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
    // Test-only observer records frame counts and local VAD edge times, never audio or transcripts.
    window.__askmoinaNativeContinuitySend = (socket, data) => nativeSend.call(socket, data);
    const observedSockets = [];
    window.__askmoinaContinuitySockets = observedSockets;
    window.__askmoinaSocketClosures = [];
    window.__askmoinaConnectionSignals = [];
    window.__askmoinaMicInputStats = { audioFramesSent: 0, activityStartFramesSent: 0, activityEndFramesSent: 0, textTurnsSent: 0 };
    window.__askmoinaMicVadTransitions = [];
    let previousListeningState = null;
    window.setInterval(() => {
      const stage = document.querySelector("#cameraStage");
      if (!stage) return;
      const listening = stage.classList.contains("is-listening");
      if (listening === previousListeningState) return;
      previousListeningState = listening;
      const transitions = window.__askmoinaMicVadTransitions;
      transitions.push({ listening, at: Date.now() });
      if (transitions.length > 30) transitions.shift();
    }, 50);
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
          if (typeof data === "string") {
            try {
              const payload = JSON.parse(data);
              const stats = window.__askmoinaMicInputStats;
              if (payload?.realtime_input?.audio) stats.audioFramesSent += 1;
              if (payload?.realtime_input?.activity_start === true) stats.activityStartFramesSent += 1;
              if (payload?.realtime_input?.activity_end === true) stats.activityEndFramesSent += 1;
              if (typeof payload?.text_input === "string") stats.textTurnsSent += 1;
            } catch { /* Count only well-formed protocol frames. */ }
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
              assistantTurnCompleteFrames += 1;
              recentFrameShapes.push({kind:"turn_complete"});
            }
            const output = serverContent.outputTranscription || serverContent.output_transcription;
            if (output && typeof output.text === "string") {
              outputTranscriptionFrames += 1;
              outputTextCharacters += output.text.length;
            }
            const input = serverContent.inputTranscription || serverContent.input_transcription ||
              serverContent.interimInputTranscription || serverContent.interim_input_transcription;
            if (input && typeof input.text === "string") {
              inputTranscriptionFrames += 1;
              inputTranscriptCharacters += input.text.length;
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

  // Force a real browser network interruption before the delayed speech window.
  // The old provider must be terminated (not merely handed off), then a genuinely fresh
  // Live session must answer two delayed real-microphone turns.
  await context.setOffline(true);
  await page.waitForFunction(() => {
    const title = document.querySelector("#connectionNoticeTitle");
    const action = document.querySelector("#connectionNoticeAction");
    return navigator.onLine === false &&
      title?.textContent?.trim() === "You're offline" &&
      action instanceof HTMLButtonElement && !action.hidden &&
      document.querySelector("#connectionPill")?.dataset.state === "error";
  }, null, { timeout: 15_000 });
  const disconnectedPreview = await page.locator("#videoPreview").evaluate((element) => ({
    filter: getComputedStyle(element).filter,
    stageClass: element.parentElement?.className || "",
  }));
  assert.equal(disconnectedPreview.filter, "none",
    "camera preview must remain sharp during forced disconnect; " + JSON.stringify(disconnectedPreview));
  assert.ok(disconnectedPreview.stageClass.includes("recovery-preview-clear"),
    "forced disconnect must keep recovery preview clear");
  await page.waitForFunction(() => (window.__askmoinaSocketClosures || []).length >= 1,
    null, { timeout: 10_000 });

  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true &&
    document.querySelector("#connectionNoticeTitle")?.textContent?.trim() === "Network restored",
    null, { timeout: 15_000 });
  await page.locator("#connectionNoticeAction").click();
  await page.waitForFunction(() => document.querySelector("#connectionPill")?.dataset.state === "live",
    null, { timeout: 45_000 });
  await page.waitForFunction(() => {
    const stage = document.querySelector("#videoPreview")?.parentElement;
    return Boolean(stage && !stage.classList.contains("recovery-preview-clear") &&
      document.querySelector("#connectionNotice")?.hidden);
  }, null, { timeout: 10_000 });
  await page.waitForTimeout(500);
  const forcedRecoveryDiagnostics = await page.evaluate(() => {
    const signals = window.__askmoinaConnectionSignals || [];
    return {
      state: document.querySelector("#connectionPill")?.dataset.state || "unknown",
      noticeVisible: Boolean(document.querySelector("#connectionNotice") && !document.querySelector("#connectionNotice").hidden),
      openSocketCount: (window.__askmoinaContinuitySockets || []).filter((candidate) => candidate.readyState === WebSocket.OPEN).length,
      resumedSignals: signals.filter((signal) => signal.state === "resumed").length,
      resumingSignals: signals.filter((signal) => signal.state === "resuming").length,
      setupCompleteSignals: signals.filter((signal) => signal.state === "setup_complete").length,
      socketClosures: (window.__askmoinaSocketClosures || []).slice(-5),
    };
  });
  assert.equal(liveSockets.length, 2,
    "one network interruption must produce exactly one recovery socket; " + JSON.stringify(forcedRecoveryDiagnostics));
  assert.equal(closedSockets.length, 1,
    "only the intentionally interrupted browser socket may close; " + JSON.stringify(forcedRecoveryDiagnostics));
  assert.equal(forcedRecoveryDiagnostics.openSocketCount, 1,
    "recovery must leave exactly one open browser socket; " + JSON.stringify(forcedRecoveryDiagnostics));
  assert.equal(forcedRecoveryDiagnostics.resumedSignals, 0,
    "a confirmed network loss must create a fresh provider rather than reattach to a potentially silent provider; " + JSON.stringify(forcedRecoveryDiagnostics));
  assert.equal(forcedRecoveryDiagnostics.resumingSignals, 0,
    "fresh-session recovery must not enter a resuming loop; " + JSON.stringify(forcedRecoveryDiagnostics));
  assert.equal(forcedRecoveryDiagnostics.state, "live", "the new session must finish setup before returning to LIVE");
  assert.equal(forcedRecoveryDiagnostics.noticeVisible, false, "successful recovery must clear the reconnect notice");
  console.log("Production forced-disconnect recovery: PASS (1 network loss, stale provider terminated, 1 fresh session/socket, no resume loop or stuck UI).");

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

  // Keep the same real camera/microphone session active beyond the two-minute cutoff.
  // Chromium's fake microphone contains real silence followed by spoken audio, so the actual
  // browser getUserMedia -> downsampling -> PCM send -> local VAD path is exercised.
  await page.waitForTimeout(125_000);
  const assistantAudioFramesBeforeTurn = assistantAudioFrames;
  const completedAssistantTurnsBeforeSpeech = assistantTurnCompleteFrames;
  const microphoneStatsBeforeTurn = await page.evaluate(() => ({
    audioFramesSent: window.__askmoinaMicInputStats?.audioFramesSent || 0,
    activityStartFramesSent: window.__askmoinaMicInputStats?.activityStartFramesSent || 0,
    activityEndFramesSent: window.__askmoinaMicInputStats?.activityEndFramesSent || 0,
  }));
  let microphoneVadObserved = false;
  try {
    await page.waitForFunction(() => {
      const transitions = window.__askmoinaMicVadTransitions || [];
      const speechStart = transitions.findIndex((item) => item.listening === true);
      return speechStart >= 0 && transitions.slice(speechStart + 1).some((item) => item.listening === false);
    }, null, { timeout: 60_000, polling: 100 });
    microphoneVadObserved = true;
  } catch {
    // Assertions below report the bounded frame and VAD evidence if no transition occurred.
  }
  const turnDispatch = await page.evaluate((baselineAudioFrames) => {
    const stats = window.__askmoinaMicInputStats || {};
    const transitions = window.__askmoinaMicVadTransitions || [];
    const speechStart = transitions.findIndex((item) => item.listening === true);
    const speechEndIndex = speechStart < 0 ? -1 : transitions.findIndex(
      (item, index) => index > speechStart && item.listening === false
    );
    return {
      sent: speechStart >= 0 && speechEndIndex > speechStart,
      reason: speechStart < 0 ? "local-microphone-VAD-never-detected-speech" :
        speechEndIndex < 0 ? "local-microphone-VAD-never-detected-end-of-speech" : "",
      chunksSent: Math.max(0, (stats.audioFramesSent || 0) - baselineAudioFrames.audioFramesSent),
      activityStartFramesSent: Math.max(0,
        (stats.activityStartFramesSent || 0) - baselineAudioFrames.activityStartFramesSent),
      activityEndFramesSent: Math.max(0,
        (stats.activityEndFramesSent || 0) - baselineAudioFrames.activityEndFramesSent),
      speechStartedAt: speechStart >= 0 ? transitions[speechStart].at : null,
      speechEndedAt: speechEndIndex > speechStart ? transitions[speechEndIndex].at : null,
      textTurnsSent: stats.textTurnsSent || 0,
    };
  }, microphoneStatsBeforeTurn);
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
    microphoneInput: window.__askmoinaMicInputStats || {},
    microphoneVadTransitions: (window.__askmoinaMicVadTransitions || []).slice(-12),
  }));
  console.log("Production audiovisual Live pre-turn diagnostics: " + JSON.stringify({
    ...beforeTurnDiagnostics,
    browserLiveSocketCount: liveSockets.length,
    closedBrowserSockets: closedSockets.length,
    continuityTurnDispatched: turnDispatch.sent,
    continuityTurnReason: turnDispatch.reason || "",
    microphoneVadObserved,
    microphoneInput: await page.evaluate(() => window.__askmoinaMicInputStats || {}),
    microphoneVadTransitions: await page.evaluate(() => (window.__askmoinaMicVadTransitions || []).slice(-12)),
    elapsedMs: Date.now() - sessionStartedAt,
    receivedWebSocketFrames,
    parsedJsonFrames,
    serverContentFrames,
    modelTurnFrames,
    outputTranscriptionFrames,
    inputTranscriptionFrames,
    inputTranscriptCharacters,
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
  assert.ok(turnDispatch.chunksSent > 0, "the real browser microphone must send PCM after the >2-minute boundary");
  assert.ok(microphoneVadObserved && turnDispatch.sent,
    "the actual microphone/VAD path must detect speech onset and end-of-speech on the delayed WAV stimulus");
  assert.ok(turnDispatch.activityStartFramesSent > 0,
    "the delayed spoken turn must send activityStart before its captured PCM");
  assert.ok(turnDispatch.activityEndFramesSent > 0,
    "the delayed spoken turn must send activityEnd to finalize its user turn");

  // Give the PCM turn its own bounded response window. If it stays silent, send a
  // deterministic text turn over the same open socket to distinguish audio/VAD failure
  // from a Live session that no longer generates any response after two minutes.
  const audioReplyDeadline = Date.now() + 15_000;
  while (Date.now() < audioReplyDeadline && assistantAudioFrames <= assistantAudioFramesBeforeTurn) {
    await page.waitForTimeout(250);
  }
  const audioTurnFramesAfterWindow = assistantAudioFrames;
  const audioTurnAudioFramesReceived = audioTurnFramesAfterWindow - assistantAudioFramesBeforeTurn;
  let textProbeSent = false;
  let textProbeAudioFramesReceived = 0;
  if (audioTurnAudioFramesReceived === 0) {
    const textProbeBaseline = assistantAudioFrames;
    const textProbeDispatch = await page.evaluate(() => {
      const sockets = window.__askmoinaContinuitySockets || [];
      const ws = [...sockets].reverse().find((candidate) => candidate.readyState === WebSocket.OPEN);
      const sendNative = window.__askmoinaNativeContinuitySend;
      if (!ws || typeof sendNative !== "function") return { sent: false, reason: !ws ? "no-open-voice-socket" : "native-test-sender-missing" };
      sendNative(ws, JSON.stringify({
        text_input: "Continuity control probe: please say one short sentence confirming you can still hear and answer me."
      }));
      return { sent: true };
    });
    textProbeSent = textProbeDispatch.sent === true;
    if (textProbeSent) {
      const textProbeDeadline = Date.now() + 15_000;
      while (Date.now() < textProbeDeadline && assistantAudioFrames <= textProbeBaseline) {
        await page.waitForTimeout(250);
      }
      textProbeAudioFramesReceived = assistantAudioFrames - textProbeBaseline;
    }
    console.log("Production audiovisual Live text-control probe: " + JSON.stringify({
      sent: textProbeSent,
      reason: textProbeDispatch.reason || "",
      audioFramesReceived: textProbeAudioFramesReceived,
      inputTranscriptionFrames,
      inputTranscriptCharacters,
      elapsedMs: Date.now() - sessionStartedAt,
    }));
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
    assistantAudioFramesAfterAudioWindow: audioTurnFramesAfterWindow,
    assistantAudioFramesReceived: audioTurnAudioFramesReceived,
    textProbeSent,
    textProbeAudioFramesReceived,
    assistantAudioFramesAfterTurn: assistantAudioFrames,
    receivedWebSocketFrames,
    parsedJsonFrames,
    serverContentFrames,
    modelTurnFrames,
    outputTranscriptionFrames,
    inputTranscriptionFrames,
    inputTranscriptCharacters,
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
  assert.ok(audioTurnAudioFramesReceived > 0,
    "the assistant must transmit a new audio response to the >2-minute real microphone speech turn; " +
    (textProbeSent
      ? (textProbeAudioFramesReceived > 0
        ? "the same live session still answered a text control probe, so the failure is isolated to the audio/VAD input path."
        : "the same live session also failed to answer a text control probe, so the upstream session stopped responding.")
      : "the text control probe could not be sent."));
 
  // Do not attribute delayed audio from turn one to turn two: require the first
  // provider turnComplete event before starting the second-turn measurement window.
  const firstReplyCompleteDeadline = Date.now() + 10_000;
  while (Date.now() < firstReplyCompleteDeadline &&
      assistantTurnCompleteFrames <= completedAssistantTurnsBeforeSpeech) {
    await page.waitForTimeout(100);
  }
  assert.ok(assistantTurnCompleteFrames > completedAssistantTurnsBeforeSpeech,
    "the first post-155-second spoken response must complete before the next user turn");

  // The fixture contains a second distinct utterance. It must traverse the real browser
  // microphone/PCM/VAD path and produce its own completed assistant audio response.
  const secondTurnAudioBaseline = assistantAudioFrames;
  const secondTurnCompleteBaseline = assistantTurnCompleteFrames;
  const secondTurnInputBaseline = await page.evaluate(() => ({
    audioFramesSent: window.__askmoinaMicInputStats?.audioFramesSent || 0,
    activityStartFramesSent: window.__askmoinaMicInputStats?.activityStartFramesSent || 0,
    activityEndFramesSent: window.__askmoinaMicInputStats?.activityEndFramesSent || 0,
  }));
  const firstSpeechEndedAt = turnDispatch.speechEndedAt;
  await page.waitForFunction((afterAt) => {
    const transitions = window.__askmoinaMicVadTransitions || [];
    const startIndex = transitions.findIndex((item) => item.at > afterAt && item.listening === true);
    return startIndex >= 0 && transitions.slice(startIndex + 1).some(
      (item) => item.at > afterAt && item.listening === false
    );
  }, firstSpeechEndedAt, { timeout: 60_000, polling: 100 });
  const secondTurnDispatch = await page.evaluate(({ afterAt, baseline }) => {
    const stats = window.__askmoinaMicInputStats || {};
    const transitions = window.__askmoinaMicVadTransitions || [];
    const startIndex = transitions.findIndex((item) => item.at > afterAt && item.listening === true);
    const endIndex = startIndex < 0 ? -1 : transitions.findIndex(
      (item, index) => index > startIndex && item.at > afterAt && item.listening === false
    );
    return {
      sent: startIndex >= 0 && endIndex > startIndex,
      chunksSent: Math.max(0, (stats.audioFramesSent || 0) - baseline.audioFramesSent),
      activityStartFramesSent: Math.max(0,
        (stats.activityStartFramesSent || 0) - baseline.activityStartFramesSent),
      activityEndFramesSent: Math.max(0,
        (stats.activityEndFramesSent || 0) - baseline.activityEndFramesSent),
      speechStartedAt: startIndex >= 0 ? transitions[startIndex].at : null,
      speechEndedAt: endIndex > startIndex ? transitions[endIndex].at : null,
    };
  }, { afterAt: firstSpeechEndedAt, baseline: secondTurnInputBaseline });
  console.log("Production audiovisual Live second spoken turn: " + JSON.stringify({
    microphoneVadObserved: secondTurnDispatch.sent,
    microphonePcmFramesSent: secondTurnDispatch.chunksSent,
    activityEndFramesSent: secondTurnDispatch.activityEndFramesSent,
    elapsedMs: Date.now() - sessionStartedAt,
  }));
  assert.equal(secondTurnDispatch.sent, true,
    "the real browser microphone/VAD path must detect a second spoken turn after the first assistant reply");
  assert.ok(secondTurnDispatch.chunksSent > 0,
    "the second spoken turn must travel through actual microphone PCM capture, not a text probe");
  assert.ok(secondTurnDispatch.activityStartFramesSent > 0,
    "the second spoken turn must send its own activityStart signal");
  assert.ok(secondTurnDispatch.activityEndFramesSent > 0,
    "the second spoken turn must send its own activityEnd signal");

  const secondReplyDeadline = Date.now() + 25_000;
  while (Date.now() < secondReplyDeadline &&
      assistantTurnCompleteFrames <= secondTurnCompleteBaseline) {
    await page.waitForTimeout(150);
  }
  const secondTurnAudioFramesReceived = assistantAudioFrames - secondTurnAudioBaseline;
  const secondTurnCompleted = assistantTurnCompleteFrames > secondTurnCompleteBaseline;
  console.log("Production audiovisual Live second spoken-turn reply: " + JSON.stringify({
    assistantAudioFramesReceived: secondTurnAudioFramesReceived,
    completed: secondTurnCompleted,
    elapsedMs: Date.now() - sessionStartedAt,
  }));
  assert.ok(secondTurnAudioFramesReceived > 0,
    "the same live session must transmit new assistant audio in response to the second spoken turn");
  assert.equal(secondTurnCompleted, true,
    "the second spoken turn must reach provider turnComplete, not merely emit a partial audio frame");

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
  assert.equal(finalState, "live", "recovered Live session should remain active through the 155-second window");
  assert.equal(buttonPressed, "true", "call controls should remain in active state");
  assert.equal(closedSockets.length, 1, "only the deliberate network interruption may close a browser socket");
  assert.equal(liveSockets.length, 2, "exactly one recovered browser-facing socket should exist");
  assert.ok(diagnostics.timeline.some((item) => item.state === "live"),
    "the browser must enter LIVE after provider setup");
  assert.ok(diagnostics.timeline.every((item) => ["live", "connecting"].includes(item.state)),
    "the recovered session must not fall back to a stuck ready/error state");
  assert.equal(diagnostics.noticeVisible, false,
    "no stale reconnect overlay should remain after a stable long-running session");
  console.log("Production audiovisual Live recovery + continuity: PASS (forced network loss, one socket recovery, two completed post-170-second spoken turns with fresh assistant audio, no stale UI/resume loop).");

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
    })).catch(() => null);
    if (diagnostic) console.error("Production audiovisual Live continuity diagnostics: " + JSON.stringify({
      ...diagnostic, browserLiveSocketCount: liveSockets.length, closedBrowserSockets: closedSockets.length,
    }));
  }
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  if (mediaDirectory) rmSync(mediaDirectory, { recursive: true, force: true });
}
