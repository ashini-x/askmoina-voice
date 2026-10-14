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
  // Expose only the active test socket so the synthetic can send one deliberate
  // post-start user turn without changing the production UI or logging user content.
  await page.addInitScript(() => {
    const nativeSend = WebSocket.prototype.send;
    const observedSockets = [];
    window.__askmoinaContinuitySockets = observedSockets;
    WebSocket.prototype.send = function (data) {
      try {
        if (new URL(this.url).pathname === "/api/voice/socket" && !observedSockets.includes(this)) {
          observedSockets.push(this);
        }
      } catch { /* Ignore non-voice sockets. */ }
      return nativeSend.call(this, data);
    };
  });
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

  // Keep media active, then send a real user turn before the old cutoff. Compression
  // is triggered before turns; a silent fake microphone alone cannot verify that path.
  await page.waitForTimeout(95_000);
  const turnDispatch = await page.evaluate(() => {
    const sockets = window.__askmoinaContinuitySockets || [];
    const ws = [...sockets].reverse().find((candidate) => candidate.readyState === WebSocket.OPEN);
    const before = [...document.querySelectorAll("#transcript .from-moina .transcript-text")]
      .map((node) => node.textContent || "").join(" ").trim();
    if (!ws) return { sent: false, reason: "no-open-voice-socket" };
    ws.send(JSON.stringify({
      text_input: "Continuity verification: please respond aloud in one short sentence confirming our live camera conversation is still active. Do not call tools."
    }));
    window.__askmoinaContinuityAssistantBaseline = before;
    return { sent: true, baselineChars: before.length };
  });
  assert.equal(turnDispatch.sent, true, "the browser must still have an open voice socket for the continuity turn");

  await page.waitForFunction(() => {
    const pill = document.querySelector("#connectionPill");
    const before = window.__askmoinaContinuityAssistantBaseline || "";
    const after = [...document.querySelectorAll("#transcript .from-moina .transcript-text")]
      .map((node) => node.textContent || "").join(" ").trim();
    return pill?.dataset.state === "live" && after.length > before.length;
  }, null, { timeout: 30_000 });

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
  }));
  assert.equal(finalState, "live", "Live session should still be active after 155 seconds");
  assert.equal(buttonPressed, "true", "call controls should remain in active state");
  assert.deepEqual(closedSockets, [], "browser-facing Live socket must not close during the continuity window");
  assert.ok(diagnostics.timeline.some((item) => item.state === "live"),
    "the browser must have entered the live state");
  assert.ok(diagnostics.timeline.every((item) => item.state === "live" || item.state === "connecting"),
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
