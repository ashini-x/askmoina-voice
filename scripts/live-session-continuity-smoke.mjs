#!/usr/bin/env node
/**
 * Production browser synthetic for long-running audiovisual Live continuity.
 * Opens an authenticated Co-Pilot session with Chromium fake media and keeps camera
 * and microphone streaming for 155 seconds. Never logs credentials, audio or transcripts.
 */
import assert from "node:assert/strict";
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
  const turnDispatch = await page.evaluate(() => {
    const sockets = window.__askmoinaContinuitySockets || [];
    const ws = [...sockets].reverse().find((candidate) => candidate.readyState === WebSocket.OPEN);
    const before = [...document.querySelectorAll("#transcript .from-moina .transcript-text")]
      .map((node) => node.textContent || "").join(" ").trim();
    if (!ws) return { sent: false, reason: "no-open-voice-socket" };
    window.__askmoinaPauseContinuityAudio = true;
    // The fake microphone is intentionally silent and may not have opened an audio stream.
    // Sending audio_stream_end in that state can disrupt the subsequent deterministic text turn.
    ws.send(JSON.stringify({
      text_input: "Continuity verification: please respond aloud in one short sentence confirming our live camera conversation is still active. Do not call tools."
    }));
    window.__askmoinaContinuityAssistantBaseline = before;
    return { sent: true, baselineChars: before.length };
  });
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
  assert.equal(turnDispatch.sent, true, "the browser must still have an open voice socket for the continuity turn");

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
