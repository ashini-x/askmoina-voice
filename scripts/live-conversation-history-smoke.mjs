#!/usr/bin/env node
/**
 * Production API contract smoke for Phase 3. Uses disposable synthetic accounts,
 * never prints conversation text or session cookies, and deletes every test topic.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.BASE_URL || "https://askmoina-voice.thenewtongs.workers.dev").replace(/\/$/, "");
const cookieA = process.env.ASKMOINA_SYNTHETIC_COOKIE || "";
if (!baseUrl.startsWith("https://") || !/^moina_session=[A-Za-z0-9_-]{43}$/.test(cookieA)) {
  console.error("Conversation history synthetic: required HTTPS URL or authenticated session missing.");
  process.exit(1);
}
let cookieB = "";
const nonce = randomUUID();
let conversationId = "";
let failure = null;

async function request(path, method, cookie, body, expectedStatus) {
  const headers = { Cookie: cookie, Accept: "application/json" };
  if (method !== "GET") {
    headers.Origin = baseUrl;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    cache: "no-store",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(method + " " + path + " expected HTTP " + expectedStatus + ", got " + response.status);
  }
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const anonymous = await fetch(baseUrl + "/api/conversations", { cache: "no-store" });
  assert(anonymous.status === 401, "anonymous list must be denied");

  const created = await request("/api/conversations", "POST", cookieA, {
    title: "Phase 3 temporary verification " + nonce.slice(0, 8),
  }, 201);
  conversationId = created.data.conversation?.conversationId;
  assert(typeof conversationId === "string" && conversationId.startsWith("conv_"), "create response missing conversation ID");

  const userTurn = {
    role: "user",
    text: "Synthetic only: restore the context for request " + nonce.slice(0, 8) + ".",
    idempotencyKey: "phase3-" + nonce + "-user",
  };
  const appended = await request("/api/conversations/" + conversationId + "/turns", "POST", cookieA, userTurn, 201);
  const replay = await request("/api/conversations/" + conversationId + "/turns", "POST", cookieA, userTurn, 200);
  assert(replay.data.replayed === true && replay.data.turn?.turnId === appended.data.turn?.turnId, "retry created a duplicate turn");

  const progress = {
    goal: "Verify saved synthetic context",
    currentState: "A synthetic topic and user turn were saved",
    nextAction: "Restore the summary and recent turn",
    expectedEvidence: "The stored turn and summary are returned to its owner",
    uncertainty: "None in this disposable test",
    constraints: ["Synthetic-only data"],
    recentEvents: [{ kind: "test", text: "Context persistence check" }],
  };
  const assistantTurn = await request("/api/conversations/" + conversationId + "/turns", "POST", cookieA, {
    role: "assistant",
    text: "Synthetic reply for a disposable persistence test.",
    idempotencyKey: "phase3-" + nonce + "-assistant",
    summary: "Synthetic topic: verify saved context and retrieve the next action.",
    taskProgress: progress,
  }, 201);

  const restored = await request("/api/conversations/" + conversationId + "?limit=20", "GET", cookieA, undefined, 200);
  assert(restored.data.turns?.length === 2, "restored conversation did not include two finalized turns");
  assert(restored.data.turns[0].sequence < restored.data.turns[1].sequence, "turn order is incorrect");
  assert(restored.data.conversation?.summary?.includes("retrieve the next action"), "saved summary not restored");
  assert(restored.data.conversation?.taskProgress?.nextAction === progress.nextAction, "saved task progress not restored");

  const listA = await request("/api/conversations?status=all", "GET", cookieA, undefined, 200);
  assert(listA.data.conversations?.some((item) => item.conversationId === conversationId), "owner list omitted its conversation");

  cookieB = execFileSync(process.execPath, ["scripts/synthetic-passkey-session.mjs"], {
    encoding: "utf8",
    env: { ...process.env, BASE_URL: baseUrl },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  assert(/^moina_session=[A-Za-z0-9_-]{43}$/.test(cookieB), "second synthetic account was not authenticated");
  process.stdout.write("::add-mask::" + cookieB + "\n");

  const listB = await request("/api/conversations?status=all", "GET", cookieB, undefined, 200);
  assert(!listB.data.conversations?.some((item) => item.conversationId === conversationId), "foreign conversation leaked into another user's list");
  await request("/api/conversations/" + conversationId, "GET", cookieB, undefined, 404);
  await request("/api/conversations/" + conversationId, "PATCH", cookieB, { title: "Unauthorized" }, 404);
  await request("/api/conversations/" + conversationId, "DELETE", cookieB, undefined, 404);

  await request("/api/conversations/" + conversationId, "PATCH", cookieA, {
    title: "Archived temporary test",
    status: "archived",
  }, 200);
  const active = await request("/api/conversations", "GET", cookieA, undefined, 200);
  const archived = await request("/api/conversations?status=archived", "GET", cookieA, undefined, 200);
  assert(!active.data.conversations?.some((item) => item.conversationId === conversationId), "archived topic still appears in active list");
  assert(archived.data.conversations?.some((item) => item.conversationId === conversationId), "archived topic missing from archived list");

  await request("/api/conversations/" + conversationId, "DELETE", cookieA, undefined, 200);
  conversationId = "";
  console.log("Synthetic conversation history: PASS (owner-scoped create/read/append, ordered turns, idempotent retry, summary/task restore, cross-user denial, archive and delete).");
} catch (error) {
  failure = error instanceof Error ? error.message : "unknown failure";
} finally {
  if (conversationId) {
    try { await request("/api/conversations/" + conversationId, "DELETE", cookieA, undefined, 200); } catch { /* best-effort test-data cleanup */ }
  }
  for (const cookie of [cookieB, cookieA]) {
    if (!cookie) continue;
    try {
      await fetch(baseUrl + "/api/auth/logout", {
        method: "POST",
        headers: { Origin: baseUrl, Cookie: cookie, "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
    } catch { /* best-effort synthetic account logout */ }
  }
}
if (failure) {
  console.error("Synthetic conversation history: FAIL (" + failure + ")");
  process.exit(1);
}
