import type { Env } from "./config/env";
import { allowIpRequest } from "./rate-limit";

const VISITOR_COOKIE = "askmoina_visitor";
const VISITOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readVisitorId(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== VISITOR_COOKIE) continue;
    const value = valueParts.join("=");
    return VISITOR_ID_RE.test(value) ? value.toLowerCase() : null;
  }
  return null;
}

/** Issues a random pseudonymous visitor ID. It is analytics identity, not account authentication. */
export async function ensureVisitorIdentity(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const rateAllowed = await allowIpRequest(env, request, "identity", 20);
  if (rateAllowed === false) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  if (rateAllowed === null) return Response.json({ error: "identity_temporarily_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  let visitorId = readVisitorId(request);
  let created = false;
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    created = true;
  }
  try {
    await env.DB.prepare(
      "INSERT INTO visitor_profiles (visitor_id, first_seen_at, last_seen_at) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) " +
      "ON CONFLICT(visitor_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP",
    ).bind(visitorId).run();
  } catch (error) {
    console.error("[AskMoina] analytics identity write failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "identity_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  if (created) {
    headers.append("Set-Cookie", VISITOR_COOKIE + "=" + visitorId +
      "; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax");
  }
  return Response.json({ ok: true }, { headers });
}

export async function recordUsageEvent(
  env: Env,
  visitorId: string | null,
  eventType: "connection_rejected" | "connection_failed" | "provider_failed" | "session_started" | "session_ended",
  durationSeconds: number | null = null,
): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO usage_events (id, user_id, event_type, duration_seconds, estimated_cost_usd, created_at) " +
      "VALUES (?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)",
    ).bind(crypto.randomUUID(), visitorId, eventType, durationSeconds).run();
  } catch (error) {
    console.error("[AskMoina] analytics event write failed", error instanceof Error ? error.message : "unknown");
  }
}

export async function recordSessionStarted(
  env: Env,
  input: { sessionId: string; visitorId: string | null; startedAt: number; model: string; location: string },
): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO voice_sessions (session_id, visitor_id, started_at, outcome, model, location, setup_completed) " +
      "VALUES (?, ?, ?, 'active', ?, ?, 0) ON CONFLICT(session_id) DO NOTHING",
    ).bind(input.sessionId, input.visitorId, new Date(input.startedAt).toISOString(),
      input.model.slice(0, 100), input.location.slice(0, 80)).run();
    await recordUsageEvent(env, input.visitorId, "session_started");
  } catch (error) {
    console.error("[AskMoina] session start analytics failed", error instanceof Error ? error.message : "unknown");
  }
}

function classifyOutcome(reason: string, code: number): string {
  const value = reason.toLowerCase();
  if (value.includes("time limit")) return "timeout";
  if (value.includes("rate limit") || value.includes("invalid pcm") || value.includes("invalid client")) return "policy_closed";
  if (value.includes("provider") || value.includes("vertex")) return "provider_error";
  if (value.includes("socket error") || code >= 1011) return "error";
  if (code === 1000) return "normal";
  return "disconnected";
}

export async function recordSessionEnded(
  env: Env,
  input: {
    sessionId: string;
    visitorId: string | null;
    startedAt: number;
    endedAt: number;
    reason: string;
    code: number;
    model: string;
    location: string;
    setupCompleted: boolean;
  },
): Promise<void> {
  const duration = Math.max(0, Math.min(540, Math.round((input.endedAt - input.startedAt) / 1000)));
  const outcome = classifyOutcome(input.reason, input.code);
  try {
    await env.DB.prepare(
      "INSERT INTO voice_sessions (session_id, visitor_id, started_at, ended_at, duration_seconds, outcome, model, location, setup_completed) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET ended_at=excluded.ended_at, " +
      "duration_seconds=excluded.duration_seconds, outcome=excluded.outcome, setup_completed=excluded.setup_completed",
    ).bind(input.sessionId, input.visitorId, new Date(input.startedAt).toISOString(),
      new Date(input.endedAt).toISOString(), duration, outcome, input.model.slice(0, 100),
      input.location.slice(0, 80), input.setupCompleted ? 1 : 0).run();
    await recordUsageEvent(env, input.visitorId, "session_ended", duration);
  } catch (error) {
    console.error("[AskMoina] session end analytics failed", error instanceof Error ? error.message : "unknown");
  }
}
