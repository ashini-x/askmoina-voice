import type { Env } from "./config/env";

const SESSION_COOKIE = "askmoina_admin";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const encoder = new TextEncoder();
const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

function secureHtml(body: string, status = 200): Response {
  return new Response(body, { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
  } });
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] || character));
}
function loginPage(message = ""): string {
  const warning = message ? '<p class="alert">' + escapeHtml(message) + "</p>" : "";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AskMoina Admin</title><link rel="stylesheet" href="/admin.css"></head><body><main class="login"><p class="eyebrow">PRIVATE OPERATIONS</p><h1>AskMoina</h1><p class="muted">Sign in to view service analytics. Personal memory contents are not available here.</p>' +
    warning + '<form method="post" action="/admin/login"><label>Admin username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form><p class="foot">Access is monitored. Never share this login.</p></main></body></html>';
}
function dashboardPage(): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AskMoina · Admin</title><link rel="stylesheet" href="/admin.css"><script src="/admin.js" defer></script></head><body><main class="app"><header><div><p class="eyebrow">PRIVATE OPERATIONS</p><h1>AskMoina <span>Admin</span></h1></div><form method="post" action="/admin/logout"><button class="quiet" type="submit">Sign out</button></form></header><section class="notice"><strong>Privacy boundary.</strong> This dashboard contains operational metadata only. It never displays decrypted personal memories, microphone audio or conversation transcripts.</section><section class="metrics" id="metrics"><article><span>Sessions · 30 days</span><strong id="totalSessions">—</strong></article><article><span>Sessions · 24 hours</span><strong id="recentSessions">—</strong></article><article><span>Returning profiles · 24 hours</span><strong id="uniqueVisitors">—</strong></article><article><span>Voice minutes · 30 days</span><strong id="voiceMinutes">—</strong></article><article><span>Failures · 24 hours</span><strong id="failures">—</strong></article><article><span>Active sessions (observed)</span><strong id="activeSessions">—</strong></article></section><section class="panel"><div class="panel-head"><div><h2>Recent voice sessions</h2><p class="muted">Pseudonymous visitor IDs · no transcript or raw audio</p></div><button type="button" id="refresh">Refresh</button></div><p id="status" class="muted" role="status">Loading analytics…</p><div class="table-wrap"><table><thead><tr><th>Started</th><th>Visitor ID</th><th>Duration</th><th>Outcome</th><th>Setup</th><th>Model</th></tr></thead><tbody id="sessions"></tbody></table></div></section><section class="panel"><div class="panel-head"><div><h2>Recent operational events</h2><p class="muted">Event types and timing only; cost is not inferred from duration.</p></div></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Visitor ID</th><th>Event</th><th>Duration</th></tr></thead><tbody id="events"></tbody></table></div></section><footer>AskMoina admin · All timestamps shown in your browser's local timezone</footer></main></body></html>';
}
function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const segment of header.split(";")) {
    const [key, ...rest] = segment.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
async function hmac(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}
function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
}
async function sha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function createSession(env: Env): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify({ sub: "admin", exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, nonce: crypto.randomUUID() })));
  return payload + "." + await hmac(payload, env.ADMIN_SESSION_SECRET || "");
}
async function hasAdminSession(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) return false;
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(parts[1], await hmac(parts[0], env.ADMIN_SESSION_SECRET))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0]))) as { sub?: unknown; exp?: unknown };
    return payload.sub === "admin" && typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
async function loginAttemptKey(request: Request): Promise<string> {
  return sha256(request.headers.get("CF-Connecting-IP") || "unknown");
}
async function noteLoginFailure(env: Env, key: string): Promise<{ locked: boolean }> {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT window_start, attempts, locked_until FROM admin_login_attempts WHERE client_hash=?")
    .bind(key).first<{ window_start: number; attempts: number; locked_until: number }>();
  if (row && row.locked_until > now) return { locked: true };
  const inWindow = Boolean(row && now - Number(row.window_start) < LOGIN_WINDOW_MS);
  const attempts = inWindow ? Number(row?.attempts || 0) + 1 : 1;
  const lockedUntil = attempts >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_WINDOW_MS : 0;
  await env.DB.prepare(
    "INSERT INTO admin_login_attempts (client_hash, window_start, attempts, locked_until, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) " +
    "ON CONFLICT(client_hash) DO UPDATE SET window_start=excluded.window_start, attempts=excluded.attempts, locked_until=excluded.locked_until, updated_at=CURRENT_TIMESTAMP",
  ).bind(key, inWindow ? Number(row?.window_start) : now, attempts, lockedUntil).run();
  return { locked: lockedUntil > 0 };
}
async function verifySecret(candidate: string, expected: string): Promise<boolean> {
  return safeEqual(await sha256(candidate), await sha256(expected));
}
async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return secureHtml(loginPage(), 405);
  if (!sameOrigin(request)) return secureHtml(loginPage("Request origin was rejected."), 403);
  if (!env.ADMIN_DASHBOARD_PASSWORD || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) {
    return secureHtml(loginPage("Admin login is not configured. Ask the operator to set the dashboard secrets."), 503);
  }
  let form: FormData;
  try { form = await request.formData(); } catch { return secureHtml(loginPage("Invalid login request."), 400); }
  const username = String(form.get("username") || "").slice(0, 100);
  const password = String(form.get("password") || "").slice(0, 1000);
  const expectedUser = env.ADMIN_DASHBOARD_USER || "admin";
  const key = await loginAttemptKey(request);
  try {
    const row = await env.DB.prepare("SELECT locked_until FROM admin_login_attempts WHERE client_hash=?")
      .bind(key).first<{ locked_until: number }>();
    if (row && Number(row.locked_until) > Date.now()) {
      return secureHtml(loginPage("Too many failed attempts. Try again in about " + Math.ceil((Number(row.locked_until) - Date.now()) / 1000) + " seconds."), 429);
    }
    const userOk = await verifySecret(username, expectedUser);
    const passwordOk = await verifySecret(password, env.ADMIN_DASHBOARD_PASSWORD);
    if (!userOk || !passwordOk) {
      const failure = await noteLoginFailure(env, key);
      return secureHtml(loginPage(failure.locked ? "Too many failed attempts. Try again in 15 minutes." : "Invalid username or password."), failure.locked ? 429 : 401);
    }
    await env.DB.prepare("DELETE FROM admin_login_attempts WHERE client_hash=?").bind(key).run();
    await env.DB.prepare("INSERT INTO admin_audit_log (event_type, created_at) VALUES ('admin_login', CURRENT_TIMESTAMP)").run();
    const token = await createSession(env);
    return new Response(null, { status: 303, headers: {
      Location: "/admin", "Cache-Control": "no-store",
      "Set-Cookie": SESSION_COOKIE + "=" + token + "; Path=/admin; Max-Age=" + SESSION_TTL_SECONDS + "; Secure; HttpOnly; SameSite=Strict",
    } });
  } catch (error) {
    console.error("[AskMoina] admin login service unavailable", error instanceof Error ? error.message : "unknown");
    return secureHtml(loginPage("Admin service is temporarily unavailable."), 503);
  }
}
async function dashboardOverview(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total_sessions, " +
    "SUM(CASE WHEN started_at >= datetime('now','-24 hours') THEN 1 ELSE 0 END) AS sessions_24h, " +
    "COUNT(DISTINCT CASE WHEN started_at >= datetime('now','-24 hours') THEN visitor_id END) AS visitors_24h, " +
    "COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN duration_seconds ELSE 0 END),0) AS duration_seconds_30d, " +
    "SUM(CASE WHEN started_at >= datetime('now','-24 hours') AND outcome IN ('provider_error','error','timeout','policy_closed') THEN 1 ELSE 0 END) AS failures_24h, " +
    "SUM(CASE WHEN ended_at IS NULL AND started_at >= datetime('now','-15 minutes') THEN 1 ELSE 0 END) AS active_observed " +
    "FROM voice_sessions WHERE started_at >= datetime('now','-30 days')",
  ).first<Record<string, number | null>>();
  return json({
    ok: true, totalSessions: Number(row?.total_sessions || 0), sessions24h: Number(row?.sessions_24h || 0),
    visitors24h: Number(row?.visitors_24h || 0), durationSeconds30d: Number(row?.duration_seconds_30d || 0),
    failures24h: Number(row?.failures_24h || 0), activeObserved: Number(row?.active_observed || 0),
    model: env.GEMINI_MODEL || "unknown", location: env.GEMINI_LOCATION || "unknown", version: env.APP_VERSION || "unknown",
    note: "Session time is not a Google Cloud invoice. Consult Cloud Billing for actual charges.",
  });
}
async function dashboardSessions(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    "SELECT session_id, visitor_id, started_at, ended_at, duration_seconds, outcome, model, location, setup_completed FROM voice_sessions ORDER BY started_at DESC LIMIT 100",
  ).all<Record<string, unknown>>();
  return json({ ok: true, sessions: result.results || [] });
}
async function dashboardEvents(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    "SELECT id, user_id, event_type, duration_seconds, created_at FROM usage_events ORDER BY created_at DESC LIMIT 100",
  ).all<Record<string, unknown>>();
  return json({ ok: true, events: result.results || [] });
}
export async function handleAdminRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/admin/login") return handleLogin(request, env);
  if (url.pathname === "/admin/logout") {
    if (request.method !== "POST" || !sameOrigin(request)) return json({ error: "forbidden" }, 403);
    if (await hasAdminSession(request, env)) {
      try { await env.DB.prepare("INSERT INTO admin_audit_log (event_type, created_at) VALUES ('admin_logout', CURRENT_TIMESTAMP)").run(); } catch { /* clear cookie even if audit unavailable */ }
    }
    return new Response(null, { status: 303, headers: {
      Location: "/admin", "Cache-Control": "no-store",
      "Set-Cookie": SESSION_COOKIE + "=; Path=/admin; Max-Age=0; Secure; HttpOnly; SameSite=Strict",
    } });
  }
  if (url.pathname.startsWith("/admin/api/")) {
    if (!await hasAdminSession(request, env)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    try {
      if (url.pathname === "/admin/api/overview") return await dashboardOverview(env);
      if (url.pathname === "/admin/api/sessions") return await dashboardSessions(env);
      if (url.pathname === "/admin/api/events") return await dashboardEvents(env);
      return json({ error: "not_found" }, 404);
    } catch (error) {
      console.error("[AskMoina] admin API failed", error instanceof Error ? error.message : "unknown");
      return json({ error: "admin_data_unavailable" }, 503);
    }
  }
  if (url.pathname !== "/admin" && url.pathname !== "/admin/") return json({ error: "not_found" }, 404);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  return secureHtml(await hasAdminSession(request, env) ? dashboardPage() : loginPage());
}
