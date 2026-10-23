#!/usr/bin/env node
/**
 * Production browser smoke for the current voice-first homepage's network recovery.
 * Uses a disposable authenticated synthetic session and Chromium's fake microphone.
 * It never logs cookies, audio, transcripts, or prompts.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL || "https://askmoina-voice.thenewtongs.workers.dev").replace(/\/$/, "");
const cookie = (process.env.ASKMOINA_SYNTHETIC_COOKIE || "").trim();
const match = /^moina_session=([A-Za-z0-9_-]{43})$/.exec(cookie);
if (!baseUrl.startsWith("https://")) throw new Error("Network-recovery smoke requires HTTPS.");
if (!match) throw new Error("A verified synthetic account cookie is required.");

let browser;
let context;
let page;
const sockets = [];
const closedSockets = [];
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
  page.on("websocket", (webSocket) => {
    try {
      if (new URL(webSocket.url()).pathname !== "/api/voice/socket") return;
      sockets.push(webSocket);
      webSocket.on("close", () => closedSockets.push(webSocket.url()));
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
  assert.equal(sockets.length, 1, "initial voice connection should use exactly one WebSocket");
  console.log("Voice homepage network recovery: initial Live session established.");

  await context.setOffline(true);
  await page.waitForFunction(() => {
    const label = document.querySelector("#buttonLabel")?.textContent?.trim() || "";
    const status = document.querySelector("#status")?.textContent || "";
    return label === "Try again" && /offline/i.test(status) &&
      document.querySelector("#toggleVoice")?.getAttribute("aria-pressed") === "false" &&
      navigator.onLine === false;
  }, null, { timeout: 20_000 });
  await page.waitForTimeout(350);
  assert.equal(closedSockets.length, 1, "offline event should detach the existing browser WebSocket while preserving the Live session");
  await context.setOffline(false);
  await page.waitForFunction(() =>
    navigator.onLine === true &&
    /Network restored/i.test(document.querySelector("#status")?.textContent || "") &&
    document.querySelector("#buttonLabel")?.textContent?.trim() === "Try again",
    null,
    { timeout: 5_000 }
  );
  await page.waitForTimeout(800);
  assert.equal(sockets.length, 1, "restoring the network must not silently start another session");
  assert.equal(await page.locator("#buttonLabel").textContent(), "Try again");
  console.log("Voice homepage network recovery: dropped session surfaced; online state did not reconnect silently.");

  await page.locator("#toggleVoice").click();
  await page.waitForFunction(() =>
    document.querySelector("#status")?.textContent?.trim() === "Connected. Ask me anything." &&
    document.querySelector("#toggleVoice")?.getAttribute("aria-pressed") === "true",
    null,
    { timeout: 45_000 }
  );
  assert.ok(sockets.length >= 2, "explicit retry should establish a fresh browser WebSocket");
  assert.ok(closedSockets.length >= 1, "the dropped WebSocket should be recorded");
  console.log("Voice homepage network recovery synthetic test: PASS.");

  await page.locator("#toggleVoice").click();
  await page.waitForFunction(() =>
    document.querySelector("#toggleVoice")?.getAttribute("aria-pressed") === "false",
    null,
    { timeout: 10_000 }
  );
} catch (error) {
  console.error("Browser network recovery synthetic test: FAIL (" +
    (error instanceof Error ? error.message.slice(0, 260) : "unknown error") + ")");
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
}
