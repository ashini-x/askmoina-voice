#!/usr/bin/env node
/**
 * Production browser synthetic for the current voice-first homepage's long-running
 * Live continuity. A synthetic microphone speaks once after 170 seconds of silence,
 * then speaks again in the same session. No camera UI, user data, or transcript is logged.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const sockets = [];
const closedSockets = [];
const completedTurns = [];
let currentTurnAudioBytes = 0;
let assistantAudioBytes = 0;
let receivedFrames = 0;
let providerErrors = 0;

function synthesizePcm16k(text) {
  const directory = mkdtempSync(join(tmpdir(), "askmoina-live-speech-"));
  const wavPath = join(directory, "continuity.wav");
  try {
    execFileSync("espeak-ng", ["-v", "en-us", "-s", "135", "-w", wavPath, text], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const wav = readFileSync(wavPath);
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("Synthetic speech generator did not return a WAV file.");
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
      if (end > wav.length) throw new Error("Synthetic speech WAV contains a truncated chunk.");
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
      throw new Error("Synthetic speech WAV format is unsupported.");
    }
    const sourceCount = Math.floor(pcm.length / 2);
    const targetCount = Math.max(1, Math.floor(sourceCount * 16000 / sourceRate));
    const output = Buffer.alloc(targetCount * 2);
    for (let i = 0; i < targetCount; i += 1) {
      const position = i * sourceRate / 16000;
      const left = Math.min(Math.floor(position), sourceCount - 1);
      const right = Math.min(left + 1, sourceCount - 1);
      const fraction = position - left;
      const a = pcm.readInt16LE(left * 2);
      const b = pcm.readInt16LE(right * 2);
      output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(a * (1 - fraction) + b * fraction))), i * 2);
    }
    return Buffer.concat([output, Buffer.alloc(16_000 * 2)]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeMonoPcm16Wav(path, pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 2 || pcm.length % 2 !== 0) throw new TypeError("Bad PCM fixture.");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([header, pcm]));
}

function frameAudioBytes(frame) {
  const content = frame.serverContent || frame.server_content;
  const turn = content && (content.modelTurn || content.model_turn);
  const parts = turn && Array.isArray(turn.parts) ? turn.parts : [];
  let bytes = 0;
  for (const part of parts) {
    const inline = part && (part.inlineData || part.inline_data);
    if (!inline || typeof inline.data !== "string") continue;
    const mime = String(inline.mimeType || inline.mime_type || "").toLowerCase();
    if (!mime.startsWith("audio/")) continue;
    try { bytes += Buffer.from(inline.data, "base64").length; } catch { /* Ignore malformed fixture frames. */ }
  }
  return bytes;
}

try {
  mediaDirectory = mkdtempSync(join(tmpdir(), "askmoina-live-mic-fixture-"));
  const firstSpeech = synthesizePcm16k(
    "Can you still hear me after the long pause? Please answer aloud in one short sentence."
  );
  const secondSpeech = synthesizePcm16k(
    "This is my next spoken turn in the same conversation. Please answer aloud with one short sentence."
  );
  const silentPrelude = Buffer.alloc(16000 * 2 * 170);
  const gap = Buffer.alloc(16000 * 2 * 35);
  const fakeMicrophoneWav = join(mediaDirectory, "delayed-speech.wav");
  writeMonoPcm16Wav(fakeMicrophoneWav, Buffer.concat([silentPrelude, firstSpeech, gap, secondSpeech]));

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
  const page = await context.newPage();
  page.on("websocket", (webSocket) => {
    try {
      if (new URL(webSocket.url()).pathname !== "/api/voice/socket") return;
      sockets.push(webSocket);
      webSocket.on("close", () => closedSockets.push(webSocket.url()));
      webSocket.on("framereceived", (event) => {
        receivedFrames += 1;
        const payload = event && typeof event === "object" && "payload" in event ? event.payload : event;
        const data = typeof payload === "string" ? payload :
          Buffer.isBuffer(payload) ? payload.toString("utf8") :
          payload instanceof ArrayBuffer ? Buffer.from(payload).toString("utf8") :
          ArrayBuffer.isView(payload) ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString("utf8") : "";
        if (!data) return;
        let frame;
        try { frame = JSON.parse(data); } catch { return; }
        if (frame.error || frame.connection_status?.state === "error") providerErrors += 1;
        const bytes = frameAudioBytes(frame);
        if (bytes > 0) {
          assistantAudioBytes += bytes;
          currentTurnAudioBytes += bytes;
        }
        const content = frame.serverContent || frame.server_content;
        if (content && (content.turnComplete || content.turn_complete)) {
          completedTurns.push({ at: Date.now(), audioBytes: currentTurnAudioBytes });
          currentTurnAudioBytes = 0;
        }
      });
    } catch { /* Ignore unrelated or malformed WebSocket events. */ }
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
  assert.equal(sockets.length, 1, "one browser WebSocket must own the active Live session");
  console.log("Production Live continuity: one voice session established; waiting for delayed synthetic speech.");

  const deadline = activeAt + 290_000;
  while (Date.now() < deadline && completedTurns.length < 2) {
    await page.waitForTimeout(500);
  }
  assert.ok(receivedFrames > 0, "the Live session must receive provider frames");
  assert.equal(providerErrors, 0, "provider must not report a synthetic continuity error");
  assert.ok(completedTurns.length >= 2, "two spoken turns must complete on the same Live session");
  assert.ok(completedTurns[0].at - activeAt >= 155_000, "the first reply must happen after the 155-second continuity boundary");
  assert.ok(completedTurns[0].audioBytes > 0, "the first delayed spoken turn must receive assistant audio");
  assert.ok(completedTurns[1].audioBytes > 0, "the second spoken turn must receive fresh assistant audio");
  assert.equal(sockets.length, 1, "the delayed turns must not silently open replacement Live sockets");
  assert.equal(closedSockets.length, 0, "the browser-facing Live socket must remain open throughout the test");
  assert.equal(await page.locator("#toggleVoice").getAttribute("aria-pressed"), "true",
    "the current voice session must still be active after both turns");
  console.log("Production Live continuity synthetic test: PASS (one socket, two completed spoken turns, assistant audio after 155 seconds; prompts and transcripts not logged).");

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
