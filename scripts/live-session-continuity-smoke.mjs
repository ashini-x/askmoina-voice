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
  page.on("websocket", (ws) => {
    try {
      if (new URL(ws.url()).pathname !== "/api/voice/socket") return;
      liveSockets.push(ws);
      ws.on("close", () => closedSockets.push(ws.url()));
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

  await page.evaluate(() => {
    const pill = document.querySelector("#connectionPill");
    window.__askmoinaContinuityStates = [pill?.dataset.state || "unknown"];
    new MutationObserver(() => {
      window.__askmoinaContinuityStates.push(pill?.dataset.state || "unknown");
    }).observe(pill, { attributes: true, attributeFilter: ["data-state"] });
  });

  // Keep real browser microphone/camera streaming past the former ~120-second cutoff.
  await page.waitForTimeout(155_000);
  const finalState = await page.locator("#connectionPill").getAttribute("data-state");
  const buttonPressed = await page.locator("#toggleCopilot").getAttribute("aria-pressed");
  const states = await page.evaluate(() => window.__askmoinaContinuityStates || []);
  assert.equal(finalState, "live", "Live session should still be active after 155 seconds; final state="+String(finalState)+", pressed="+String(buttonPressed)+", history="+states.join("->")+", sockets="+liveSockets.length+", closed="+closedSockets.length);
  assert.equal(buttonPressed, "true", "call controls should remain in active state");
  assert.deepEqual(closedSockets, [], "browser-facing Live socket must not close during the continuity window");
  assert.ok(states.length >= 1 && states.every((state) => state === "live"),
    "connection state must remain live throughout the 155-second continuity window");
  assert.equal(await page.locator("#connectionNotice").isVisible(), false,
    "no stale reconnect overlay should remain after a stable long-running session");
  console.log("Production audiovisual Live continuity: PASS (155 seconds, browser media streaming, socket stayed open).");

  await page.locator("#toggleCopilot").click();
  await page.waitForTimeout(700);
} catch (error) {
  console.error("Production audiovisual Live continuity: FAIL (" +
    (error instanceof Error ? error.message.slice(0, 240) : "unknown error") + ")");
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
}
