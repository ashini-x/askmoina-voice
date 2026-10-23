#!/usr/bin/env node
/**
 * Production synthetic for long-running Live session continuity.
 * Keeps the real voice UI active beyond 155 seconds, then sends two distinct controlled
 * turns over its existing Worker-facing WebSocket. The separate latency benchmark covers
 * PCM and VAD. No credentials, audio, or transcripts are logged.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL || "https://askmoina-voice.thenewtongs.workers.dev").replace(/\/$/, "");
const cookie = (process.env.ASKMOINA_SYNTHETIC_COOKIE || "").trim();
const match = /^moina_session=([A-Za-z0-9_-]{43})$/.exec(cookie);
if (!baseUrl.startsWith("https://")) throw new Error("Continuity smoke requires HTTPS.");
if (!match) throw new Error("A verified synthetic account cookie is required.");

let browser;
let context;
let mediaDirectory;
let page;
const liveSockets = [];
const closedSockets = [];
let receivedFrames = 0;
let completedTurns = 0;
let assistantAudioBytes = 0;
let providerErrors = 0;

function writeMonoSilenceWav(path, seconds = 310, sampleRate = 16000) {
  const pcmBytes = sampleRate * 2 * seconds;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmBytes, 4);
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
  header.writeUInt32LE(pcmBytes, 40);
  writeFileSync(path, Buffer.concat([header, Buffer.alloc(pcmBytes)]));
}

function decodeFrame(frameEvent) {
  const payload = frameEvent && typeof frameEvent === "object" && "payload" in frameEvent
    ? frameEvent.payload
    : frameEvent;
  if (typeof payload === "string") return payload;
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  if (payload instanceof ArrayBuffer) return Buffer.from(payload).toString("utf8");
  if (ArrayBuffer.isView(payload)) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString("utf8");
  }
  return "";
}

function audioBytes(frame) {
  const content = frame.serverContent || frame.server_content;
  const turn = content && (content.modelTurn || content.model_turn);
  const parts = turn && Array.isArray(turn.parts) ? turn.parts : [];
  let total = 0;
  for (const part of parts) {
    const inline = part && (part.inlineData || part.inline_data);
    if (!inline || typeof inline.data !== "string") continue;
    const mime = String(inline.mimeType || inline.mime_type || "").toLowerCase();
    if (!mime.startsWith("audio/")) continue;
    try { total += Buffer.from(inline.data, "base64").length; } catch { /* Ignore malformed test frames. */ }
  }
  return total;
}

async function waitForCompletedAudioTurn(page, baseline) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (completedTurns > baseline.completedTurns && assistantAudioBytes > baseline.audioBytes) return;
    const state = await page.evaluate(() => ({
      pressed: document.querySelector("#toggleVoice")?.getAttribute("aria-pressed") || "",
      label: document.querySelector("#buttonLabel")?.textContent?.trim() || "",
    }));
    if (state.pressed !== "true") {
      throw new Error("Live UI stopped during delayed turn (label=" + state.label + ").");
    }
    await page.waitForTimeout(250);
  }
  throw new Error(
    "delayed turn did not produce completed assistant audio (completedTurns=" + completedTurns +
    ", baselineTurns=" + baseline.completedTurns + ", audioBytes=" + assistantAudioBytes +
    ", baselineAudioBytes=" + baseline.audioBytes + ", receivedFrames=" + receivedFrames +
    ", providerErrors=" + providerErrors + ")"
  );
}

try {
  mediaDirectory = mkdtempSync(join(tmpdir(), "askmoina-live-silence-"));
  const fakeMicrophoneWav = join(mediaDirectory, "silent-microphone.wav");
  writeMonoSilenceWav(fakeMicrophoneWav, 310);

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--use-file-for-fake-audio-capture=" + fakeMicrophoneWav + "%noloop",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });
  context = await browser.newContext({ permissions: ["microphone"] });
  await context.addCookies([{
    name: "moina_session",
    value: match[1],
    url: baseUrl,
    httpOnly: true,
    secure: true,
    sameSite: "Lax"
  }]);
  page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    const nativeSend = WebSocket.prototype.send;
    const voiceSockets = [];
    window.__askmoinaTestVoiceSockets = voiceSockets;
    window.__askmoinaTestSendTextTurn = (text) => {
      const ws = [...voiceSockets].reverse().find((item) =>
        item.readyState === WebSocket.OPEN && new URL(item.url).pathname === "/api/voice/socket"
      );
      if (!ws) return { sent: false };
      nativeSend.call(ws, JSON.stringify({ text_input: String(text).slice(0, 500) }));
      return { sent: true };
    };
    WebSocket.prototype.send = function (data) {
      try {
        if (new URL(this.url).pathname === "/api/voice/socket" && !voiceSockets.includes(this)) {
          voiceSockets.push(this);
        }
      } catch { /* Ignore unrelated sockets. */ }
      return nativeSend.call(this, data);
    };
  });

  page.on("websocket", (ws) => {
    try {
      if (new URL(ws.url()).pathname !== "/api/voice/socket") return;
      liveSockets.push(ws);
      ws.on("close", () => closedSockets.push(ws.url()));
      ws.on("framereceived", (event) => {
        receivedFrames += 1;
        const text = decodeFrame(event);
        if (!text) return;
        let frame;
        try { frame = JSON.parse(text); } catch { return; }
        if (frame.error || frame.connection_status?.state === "error") providerErrors += 1;
        assistantAudioBytes += audioBytes(frame);
        const content = frame.serverContent || frame.server_content;
        if (content && (content.turnComplete || content.turn_complete)) completedTurns += 1;
      });
    } catch { /* Ignore unrelated sockets. */ }
  });

  const response = await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  assert.equal(response?.status(), 200, "voice homepage should load");
  await page.waitForSelector("#tryMoinaOS1", { state: "visible", timeout: 15_000 });
  await page.locator("#tryMoinaOS1").click();
  await page.waitForFunction(() => {
    const button = document.querySelector("#toggleVoice");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 20_000 });
  await page.locator("#toggleVoice").click();
  await page.waitForFunction(() =>
    document.querySelector("#status")?.textContent?.trim() === "Connected. Ask me anything." &&
    document.querySelector("#toggleVoice")?.getAttribute("aria-pressed") === "true",
    null,
    { timeout: 45_000 }
  );

  const activeAt = Date.now();
  assert.equal(liveSockets.length, 1, "one browser-facing Live WebSocket must own the session");
  console.log("Production Live continuity: session established; waiting beyond the 155-second boundary.");

  while (Date.now() - activeAt < 170_000) {
    await page.waitForTimeout(1_000);
    const state = await page.evaluate(() => ({
      pressed: document.querySelector("#toggleVoice")?.getAttribute("aria-pressed") || "",
      status: document.querySelector("#status")?.textContent?.trim() || "",
    }));
    if (state.pressed !== "true" || !/Connected|Listening|Thinking|Searching|Speaking/i.test(state.status)) {
      throw new Error("Live UI left its active state before 170 seconds.");
    }
    if (liveSockets.length !== 1 || closedSockets.length !== 0) {
      throw new Error("browser-facing Live socket changed before the 170-second check.");
    }
  }

  const firstBaseline = { completedTurns, audioBytes: assistantAudioBytes };
  const firstSend = await page.evaluate(() => window.__askmoinaTestSendTextTurn(
    "Please say one short sentence confirming the long-running live conversation is still active."
  ));
  assert.equal(firstSend.sent, true, "could not send the first synthetic turn through the existing Live socket");
  await waitForCompletedAudioTurn(page, firstBaseline);
  assert.equal(liveSockets.length, 1, "the first post-155-second turn must reuse the same Live socket");
  console.log("Production Live continuity: first post-170-second turn produced assistant audio on the original session.");

  await page.waitForTimeout(35_000);
  const stateBeforeSecond = await page.evaluate(() => ({
    pressed: document.querySelector("#toggleVoice")?.getAttribute("aria-pressed") || "",
  }));
  assert.equal(stateBeforeSecond.pressed, "true", "Live UI must stay active between later turns");

  const secondBaseline = { completedTurns, audioBytes: assistantAudioBytes };
  const secondSend = await page.evaluate(() => window.__askmoinaTestSendTextTurn(
    "This is a second question after another pause. Please answer in one short sentence."
  ));
  assert.equal(secondSend.sent, true, "could not send the second synthetic turn through the existing Live socket");
  await waitForCompletedAudioTurn(page, secondBaseline);
  assert.equal(providerErrors, 0, "provider must not report a continuity error");
  assert.equal(liveSockets.length, 1, "both later turns must reuse one browser-facing Live socket");
  assert.equal(closedSockets.length, 0, "the original browser-facing Live socket must remain open");
  assert.equal(await page.locator("#toggleVoice").getAttribute("aria-pressed"), "true",
    "voice UI must remain active through both delayed turns");
  console.log("Production Live continuity synthetic test: PASS (same session; two completed post-170-second assistant-audio turns; no prompts or transcripts logged).");

  await page.locator("#toggleVoice").click();
  await page.waitForFunction(() =>
    document.querySelector("#toggleVoice")?.getAttribute("aria-pressed") === "false",
    null,
    { timeout: 10_000 }
  );
} catch (error) {
  console.error("Production Live continuity synthetic test: FAIL (" +
    (error instanceof Error ? error.message.slice(0, 300) : "unknown error") + ")");
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  if (mediaDirectory) rmSync(mediaDirectory, { recursive: true, force: true });
}
