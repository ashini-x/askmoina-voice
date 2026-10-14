#!/usr/bin/env node
/**
 * Browser-level production smoke for the Co-Pilot's offline -> online recovery path.
 * Uses a short-lived synthetic passkey account. Never logs session cookies, audio,
 * transcript text, or search content.
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
const liveSocketEvents = [];
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
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax"
  }]);
  page = await context.newPage();
  page.on("websocket", (webSocket) => {
    try {
      if (new URL(webSocket.url()).pathname === "/api/voice/socket") liveSocketEvents.push(webSocket);
    } catch { /* Ignore unrelated/non-URL WebSocket events. */ }
  });

  const response = await page.goto(baseUrl + "/copilot", { waitUntil: "domcontentloaded", timeout: 30_000 });
  assert.equal(response?.status(), 200, "authenticated Co-Pilot route should load");
  await page.waitForSelector("#showProblemButton", { timeout: 15_000 });
  await page.waitForSelector("#connectionPill", { timeout: 15_000 });

  // Enter through the real keyboard-accessible start action with fake media devices.
  await page.locator("#showProblemButton").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector("#connectionPill")?.dataset.state === "live",
    null,
    { timeout: 45_000 }
  );
  assert.equal(liveSocketEvents.length, 1, "initial live WebSocket should be established");
  console.log("Browser network recovery: initial authenticated Live session established.");

  // Use Chromium's network emulation, not a synthetic DOM event, to exercise the real
  // navigator.onLine and browser offline/online events while a Live session is active.
  await context.setOffline(true);
  await page.waitForFunction(() => {
    const title = document.querySelector("#connectionNoticeTitle");
    const action = document.querySelector("#connectionNoticeAction");
    const callButton = document.querySelector("#toggleCopilot");
    return title?.textContent?.trim() === "You're offline" &&
      action instanceof HTMLButtonElement && !action.hidden &&
      callButton?.getAttribute("aria-pressed") === "false" &&
      navigator.onLine === false;
  }, null, { timeout: 15_000 });
  assert.equal(await page.locator("#connectionNoticeAction").textContent(), "Reconnect now");
  console.log("Browser network recovery: active session stopped and offline notice shown.");

  await context.setOffline(false);
  await page.waitForFunction(() => {
    const title = document.querySelector("#connectionNoticeTitle");
    return title?.textContent?.trim() === "Network restored" && navigator.onLine === true;
  }, null, { timeout: 15_000 });
  await page.waitForTimeout(900);
  assert.equal(liveSocketEvents.length, 1, "restoring the network must not silently start a new Live session");
  assert.equal(await page.locator("#toggleCopilot").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#connectionNoticeAction").textContent(), "Reconnect now");
  console.log("Browser network recovery: online state restored; no silent reconnection occurred.");

  // Recovery must work when the user explicitly chooses Reconnect now.
  await page.locator("#connectionNoticeAction").click();
  await page.waitForFunction(
    () => document.querySelector("#connectionPill")?.dataset.state === "live",
    null,
    { timeout: 45_000 }
  );
  assert.ok(liveSocketEvents.length >= 2, "explicit reconnect should establish a new Live WebSocket");
  console.log("Browser network recovery: explicit Reconnect now restored a fresh Live session.");

  await page.locator("#toggleCopilot").click();
  await page.waitForTimeout(700);
  console.log("Browser network recovery synthetic test: PASS.");
} catch (error) {
  console.error("Browser network recovery synthetic test: FAIL (" +
    (error instanceof Error ? error.message.slice(0, 220) : "unknown error") + ")");
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
}
