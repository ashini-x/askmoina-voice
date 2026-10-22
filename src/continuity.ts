import type { Env } from "./config/env";
import { getAuthenticatedUserId, isAuthenticatedAccountAdmin, createAdminAccountSessionCookie } from "./auth/accounts";

const ADMIN_COOKIE = "moina_admin_session";
const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
const VISITOR_COOKIE = "askmoina_visitor_id";
const ANONYMOUS_VISITOR_PREFIX = "anon_";

type VisitorContext = { visitorId: string; cookie?: string; touch: Promise<void> };

const json = (data: unknown, status = 200, extraHeaders?: HeadersInit): Response => {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { status, headers });
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") || "";
  for (const piece of header.split(";")) {
    const separator = piece.indexOf("=");
    if (separator < 0) continue;
    if (piece.slice(0, separator).trim() === name) return piece.slice(separator + 1).trim();
  }
  return null;
}

function validVisitorToken(token: string | null): token is string {
  return typeof token === "string" && /^[a-f0-9-]{36}$/.test(token);
}

export async function visitorIdFromRequest(request: Request, env: Env): Promise<string | null> {
  const userId = await getAuthenticatedUserId(request, env);
  if (userId) return userId;
  const token = readCookie(request, VISITOR_COOKIE);
  if (!validVisitorToken(token)) return null;
  return ANONYMOUS_VISITOR_PREFIX + await sha256Hex(token);
}

async function touchVisitor(env: Env, visitorId: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO visitor_profiles (visitor_id, first_seen_at, last_seen_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(visitor_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
  ).bind(visitorId, now, now).run();
}

export async function ensureVisitor(request: Request, env: Env): Promise<VisitorContext> {
  const userId = await getAuthenticatedUserId(request, env);
  if (userId) {
    return { visitorId: userId, touch: touchVisitor(env, userId).catch(() => undefined) };
  }

  let token = readCookie(request, VISITOR_COOKIE);
  let cookie: string | undefined;
  if (!validVisitorToken(token)) {
    token = crypto.randomUUID();
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    cookie = VISITOR_COOKIE + "=" + token + "; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax" + secure;
  }

  // Store only a SHA-256 digest, never the opaque browser token itself.
  const visitorId = ANONYMOUS_VISITOR_PREFIX + await sha256Hex(token);
  return {
    visitorId,
    cookie,
    touch: touchVisitor(env, visitorId).catch(() => undefined),
  };
}

export async function recordSessionStart(
  env: Env, request: Request, sessionId: string, model: string, location: string, startedAt: number,
): Promise<string | null> {
  const visitorId = await visitorIdFromRequest(request, env);
  const stamp = new Date(startedAt).toISOString();
  if (visitorId) await touchVisitor(env, visitorId).catch(() => undefined);
  await env.DB.prepare(
    "INSERT INTO voice_sessions (session_id, visitor_id, started_at, ended_at, duration_seconds, outcome, model, location, setup_completed) " +
    "VALUES (?, ?, ?, NULL, NULL, 'connecting', ?, ?, 0)",
  ).bind(sessionId, visitorId, stamp, model.slice(0, 100), location.slice(0, 100)).run();
  await env.DB.prepare(
    "INSERT INTO usage_events (id, user_id, event_type, duration_seconds, estimated_cost_usd, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
  ).bind(crypto.randomUUID(), visitorId, "voice_session_started", stamp).run();
  return visitorId;
}

export async function recordSessionFinish(
  env: Env, sessionId: string, visitorId: string | null, startedAt: number, outcome: string, setupCompleted: boolean,
  estimatedCostUsd: number | null = null,
): Promise<void> {
  const endedAt = new Date().toISOString();
  const duration = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const safeOutcome = /^[a-z_]{1,40}$/.test(outcome) ? outcome : "unknown";
  await env.DB.prepare(
    "UPDATE voice_sessions SET ended_at = ?, duration_seconds = ?, outcome = ?, setup_completed = ? WHERE session_id = ? AND ended_at IS NULL",
  ).bind(endedAt, duration, safeOutcome, setupCompleted ? 1 : 0, sessionId).run();
  await env.DB.prepare(
    "INSERT INTO usage_events (id, user_id, event_type, duration_seconds, estimated_cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), visitorId, "voice_session_" + safeOutcome, duration,
    typeof estimatedCostUsd === "number" && Number.isFinite(estimatedCostUsd) && estimatedCostUsd >= 0 ? estimatedCostUsd : null, endedAt).run();
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function htmlResponse(html: string, status = 200, cookie?: string): Response {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "microphone=(self), camera=(), geolocation=(), payment=()", "Cross-Origin-Resource-Policy": "same-origin",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(html, { status, headers });
}

function scriptResponse(script: string): Response {
  return new Response(script, { headers: {
    "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
  }});
}

const ADMIN_LOGIN_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AskMoina Admin Login</title>',
  '<style>*{box-sizing:border-box}body{font:16px/1.5 system-ui;background:#0c1222;color:#eef3ff;margin:0;min-height:100vh;display:grid;place-items:center;padding:20px}.panel{width:min(440px,100%);background:#111c31;border:1px solid #293753;border-radius:18px;padding:26px}h1{margin-top:0}label{display:block;margin:16px 0 6px;font-size:.9rem}input{width:100%;padding:12px;border-radius:9px;border:1px solid #384967;background:#091221;color:#fff;font:inherit}button{margin-top:18px;width:100%;padding:12px;border-radius:9px;border:1px solid #426a7a;background:#153d4b;color:#fff;font:inherit;font-weight:700;cursor:pointer}.muted{color:#9eacc4;font-size:.9rem}.error{color:#fecaca}</style></head><body><main class="panel"><h1>AskMoina Admin</h1><p class="muted">Private operational analytics. Personal memories and conversation content are not exposed here.</p>',
  '<form id="login"><label for="username">Username</label><input id="username" autocomplete="username" required><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form><p id="error" class="error" role="status" aria-live="polite"></p><p class="muted"><a href="/">Return to AskMoina</a></p><script src="/admin-login.js" defer></script></main></body></html>',
].join("");

const ADMIN_LOGIN_JS = `(() => {
const form=document.querySelector("#login"),error=document.querySelector("#error");
form.addEventListener("submit",async(event)=>{event.preventDefault();error.textContent="";
try{const response=await fetch("/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:document.querySelector("#username").value,password:document.querySelector("#password").value}),cache:"no-store"});const result=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(result.error||"Sign in failed.");location.href="/admin";
}catch(e){error.textContent=e.message||"Sign in failed.";}});
})();`;

function adminPage(): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0c1222"><title>AskMoina Admin</title>',
    '<style>*{box-sizing:border-box}body{margin:0;background:#0c1222;color:#eef3ff;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{max-width:1200px;margin:auto;padding:25px 18px 60px}.top{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap}h1{font-size:2rem;margin:16px 0 4px}h2{margin-top:0}.muted{color:#98a8c2}.btn{display:inline-block;text-decoration:none;border:1px solid #3a4b68;background:#14243c;color:#fff;border-radius:9px;padding:9px 12px;font:inherit;cursor:pointer}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:22px 0}.card,.section{background:#111c31;border:1px solid #293753;border-radius:15px;padding:17px}.value{font-size:2rem;font-weight:750;letter-spacing:-.03em}.label{font-size:.85rem;color:#9aacc6}.layout{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}.table-wrap{overflow:auto}.review-panel{margin-top:16px}.review-toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:14px 0}.review-toolbar label{display:grid;gap:5px;min-width:220px;flex:1}.review-toolbar input:not([type=checkbox]),.review-card select,.review-card textarea{width:100%;min-width:0;border:1px solid #3a4b68;border-radius:9px;background:#091221;color:#eef3ff;padding:10px;font:inherit}.review-toolbar .attest,.review-card .attest{display:flex;align-items:flex-start;gap:8px;min-width:min(100%,300px)}.review-toolbar .attest input,.review-card .attest input{margin-top:6px}.review-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:12px;margin:14px 0}.review-card{background:#0d1728;border:1px solid #293753;border-radius:13px;padding:15px;min-width:0}.review-card h3{margin:0 0 8px;font-size:1.03rem}.review-card p{overflow-wrap:anywhere}.review-meta{color:#a8bad4;font-size:.85rem}.review-card .btn{margin-top:10px}.review-card textarea{min-height:76px;resize:vertical}.review-card label{display:block;margin:10px 0 5px}.review-card .attest{display:flex;gap:8px;align-items:flex-start}.review-status{padding:7px 9px;border-radius:8px;background:#162a3c;color:#c4e0e8;font-size:.85rem}.score-grid{display:grid;grid-template-columns:1fr;gap:7px;margin-top:12px}.score-row{display:grid;grid-template-columns:minmax(0,1fr) 132px;align-items:center;gap:10px;font-size:.88rem}.score-row select{width:100%;padding:7px;border-radius:8px;background:#091221;color:#eef3ff;border:1px solid #3a4b68}.success{border-color:#286b52}.failure{border-color:#82454e}table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;border-bottom:1px solid #293753;padding:10px 8px;white-space:nowrap}th{color:#a8bad4;font-weight:600}.alert{padding:12px;background:#162a3c;border-radius:10px;margin:12px 0;color:#bdd7e9}@media(max-width:800px){.layout{grid-template-columns:1fr}}button:focus{outline:2px solid #9edbe3;outline-offset:2px}</style></head><body><main class="wrap">',
    '<header class="top"><div><strong>◉ AskMoina / Operations</strong><div class="muted">Operational analytics only · no transcript or memory access</div></div><div><a class="btn" href="/voice-lab">Voice audition lab</a> <a class="btn" href="#assamese-review">Assamese review</a> <button class="btn" id="refresh">Refresh</button> <button class="btn" id="logout">Sign out</button></div></header>',
    '<h1>System overview</h1><p class="muted">Session and privacy-safe usage data. Costs are not inferred from duration; Google Cloud billing is the source for actual spend.</p><div class="cards" id="cards"><div class="card">Loading…</div></div>',
    '<div class="layout"><section class="section"><h2>Recent voice sessions</h2><div class="table-wrap"><table><thead><tr><th>Session</th><th>Visitor</th><th>Started</th><th>Duration</th><th>Outcome</th></tr></thead><tbody id="sessions"></tbody></table></div></section>',
    '<section class="section"><h2>Privacy & health</h2><div id="health" class="alert">Loading system status…</div><p class="muted">Microphone audio and transcript text are not written to the app analytics database. Admin access is audited.</p><p><a href="/">Open voice app</a></p></section></div>',
    '<section id="assamese-review" class="section review-panel"><h2>Assamese-English review centre</h2><p class="muted">Human acceptance gate for M1 speech quality and M2 conversational examples. Admin access is required. Save scores and brief non-identifying notes only; never paste private conversations or transcripts.</p><div class="review-toolbar"><label>Stable reviewer code (pseudonym)<input id="as-reviewer-code" minlength="3" maxlength="80" pattern="[A-Za-z0-9_-]{3,80}" placeholder="e.g. native-reviewer-1" required></label><label>Broad locality or dialect scope (optional)<input id="as-reviewer-locality" maxlength="120" placeholder="e.g. Assamese-English; regional scope if applicable"></label><label class="attest"><input id="as-native-attest" type="checkbox"> I confirm I am reviewing as a native Assamese-English speaker and will judge only the dialect/register I know.</label></div><div class="review-toolbar"><button class="btn" id="as-override-all">Admin override: pass M1 + approve M2</button><button class="btn" id="as-refresh-refs">Refresh M2 phrases</button><button class="btn" id="as-refresh-scores">Refresh M1 score history</button><a class="btn" href="/copilot" target="_blank" rel="noopener">Open Live Co-Pilot</a><a class="btn" href="https://github.com/ashini-x/askmoina-voice/actions" target="_blank" rel="noopener">Production workflow results</a></div><p class="muted">An override is explicitly labelled and audited; it does not create fictional individual test scores or a second native-speaker identity.</p><p id="as-review-status" class="alert" role="status" aria-live="polite">Loading review items…</p><div id="as-references" class="review-list"></div><hr><h2>M1 · Assamese speech baseline</h2><p class="muted">Play/test each prompt in Live Co-Pilot, then score what you actually heard: 0 = fail, 1 = partly right, 2 = pass. At least 12 of 15 complete cases, at least 85% overall, configured dimension thresholds, and zero critical failures are required. The English synthetic latency benchmark is separate; see the linked production workflow.</p><div id="as-speech-cases" class="review-list"></div><div class="review-toolbar"><button class="btn" id="as-submit-speech">Save score-only evaluation</button><span id="as-speech-status" class="muted" role="status" aria-live="polite"></span></div><div id="as-speech-history" class="review-list"></div></section><p id="message" class="muted" role="status" aria-live="polite"></p><script src="/admin.js" defer></script><script src="/admin-review.js" defer></script></main></body></html>',
  ].join("");
}

const ADMIN_JS = `(() => {
const $=s=>document.querySelector(s);
function el(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
function card(label,value,detail){const c=el("div","");c.className="card";const l=el("div",label);l.className="label";const v=el("div",String(value??"—"));v.className="value";c.append(l,v);if(detail){const d=el("div",detail);d.className="label";c.append(d);}return c;}
async function load(){ $("#message").textContent="Refreshing…";try{
const pair=await Promise.all([fetch("/admin/api/overview",{cache:"no-store"}),fetch("/admin/api/sessions",{cache:"no-store"})]);
if(pair.some(r=>r.status===401)){location.href="/admin/login";return;}if(pair.some(r=>!r.ok))throw new Error("Admin data could not be loaded.");
const o=await pair[0].json(),s=await pair[1].json(),d=o.metrics||{},cards=$("#cards");cards.replaceChildren();
cards.append(card("Visitor profiles",d.visitorsTotal,"Pseudonymous browser profiles"),card("Visitors · last 24h",d.visitors24h,"Unique profiles seen"),card("Sessions · last 24h",d.sessions24h,"All outcomes"),card("Voice time · last 24h",Math.round((d.seconds24h||0)/60)+" min","Reported session duration"),card("Active sessions",d.activeSessions,"Approximate; refresh to update"),card("Failed sessions",d.failed24h,"Last 24 hours"));
const tbody=$("#sessions");tbody.replaceChildren();for(const x of s.sessions||[]){const tr=document.createElement("tr");const values=[String(x.sessionId||"").slice(0,8),x.visitor||"unknown",x.startedAt?new Date(x.startedAt).toLocaleString():"—",x.durationSeconds==null?"—":Math.floor(x.durationSeconds/60)+"m "+x.durationSeconds%60+"s",x.outcome||"—"];for(const v of values)tr.append(el("td",v));tbody.append(tr);}
$("#health").textContent="Worker: "+(o.system?.worker||"AskMoina Voice")+" · Model: "+(o.system?.model||"configured")+" · Location: "+(o.system?.location||"configured")+" · Analytics retention: "+(o.system?.retentionDays||30)+" days · Cost source: Google Cloud billing";
$("#message").textContent="Updated "+new Date().toLocaleTimeString();}catch(e){$("#message").textContent=e.message||"Could not load metrics.";}}
$("#refresh").addEventListener("click",load);$("#logout").addEventListener("click",async()=>{await fetch("/admin/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});location.href="/admin/login";});load();
})();`;

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) mismatch |= (a[i % Math.max(1, a.length)] || 0) ^ (b[i % Math.max(1, b.length)] || 0);
  return mismatch === 0;
}

async function adminSessionCookie(env: Env): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  const signature = await hmac("askmoina-admin-v1:" + expiry, env.ADMIN_SESSION_SECRET || "");
  return ADMIN_COOKIE + "=" + expiry + "." + signature + "; Max-Age=" + ADMIN_SESSION_SECONDS + "; Path=/; Secure; HttpOnly; SameSite=Strict";
}

export async function isAdmin(request: Request, env: Env): Promise<boolean> {
  if (await isAuthenticatedAccountAdmin(request, env)) return true;
  if (!env.ADMIN_SESSION_SECRET) return false;
  const value = readCookie(request, ADMIN_COOKIE);
  if (!value) return false;
  const pieces = value.split(".");
  if (pieces.length !== 2 || !/^\d{10}$/.test(pieces[0])) return false;
  const expiry = Number(pieces[0]), now = Math.floor(Date.now() / 1000);
  if (expiry <= now || expiry > now + ADMIN_SESSION_SECONDS + 60) return false;
  const expected = await hmac("askmoina-admin-v1:" + expiry, env.ADMIN_SESSION_SECRET);
  return safeEqual(expected, pieces[1]);
}

async function checkLoginThrottle(env: Env, request: Request): Promise<{ locked: boolean; hash: string }> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const hash = await sha256Hex("askmoina-admin-login:" + ip);
  const row = await env.DB.prepare("SELECT window_start, attempts, locked_until FROM admin_login_attempts WHERE client_hash = ?")
    .bind(hash).first<{ window_start: number; attempts: number; locked_until: number }>();
  return { locked: Boolean(row && row.locked_until > Date.now()), hash };
}

async function failedLogin(env: Env, clientHash: string): Promise<void> {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT window_start, attempts FROM admin_login_attempts WHERE client_hash = ?")
    .bind(clientHash).first<{ window_start: number; attempts: number }>();
  let windowStart = row?.window_start ?? now, attempts = row?.attempts ?? 0;
  if (now - windowStart > 5 * 60_000 || now < windowStart) { windowStart = now; attempts = 0; }
  attempts += 1;
  const lockedUntil = attempts >= 5 ? now + 10 * 60_000 : 0;
  await env.DB.prepare(
    "INSERT INTO admin_login_attempts (client_hash, window_start, attempts, locked_until, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(client_hash) DO UPDATE SET window_start=excluded.window_start, attempts=excluded.attempts, locked_until=excluded.locked_until, updated_at=excluded.updated_at",
  ).bind(clientHash, windowStart, attempts, lockedUntil, new Date(now).toISOString()).run();
}

async function resetLogin(env: Env, hash: string): Promise<void> {
  await env.DB.prepare("DELETE FROM admin_login_attempts WHERE client_hash = ?").bind(hash).run();
}

async function audit(env: Env, event: string): Promise<void> {
  await env.DB.prepare("INSERT INTO admin_audit_log (event_type, created_at) VALUES (?, ?)").bind(event.slice(0, 80), new Date().toISOString()).run();
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/admin/login" && request.method === "GET") return htmlResponse(ADMIN_LOGIN_HTML);
  if (url.pathname === "/admin/login" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "forbidden_origin" }, 403);
    if (!env.ADMIN_DASHBOARD_PASSWORD || !env.ADMIN_SESSION_SECRET) return json({ error: "admin_credentials_not_configured" }, 503);
    const throttle = await checkLoginThrottle(env, request);
    if (throttle.locked) return json({ error: "too_many_attempts_try_later" }, 429, { "Retry-After": "600" });
    let input: {username?:unknown;password?:unknown};
    try { input = await request.json() as typeof input; } catch { return json({ error: "invalid_json" }, 400); }
    const username = typeof input.username === "string" ? input.username.slice(0,128) : "";
    const password = typeof input.password === "string" ? input.password.slice(0,512) : "";
    if (!safeEqual(username, env.ADMIN_DASHBOARD_USER || "admin") || !safeEqual(password, env.ADMIN_DASHBOARD_PASSWORD)) {
      await failedLogin(env, throttle.hash);
      return json({ error: "invalid_credentials" }, 401);
    }
    await resetLogin(env, throttle.hash);
    await audit(env, "admin_login");
    const cookies = new Headers();
    cookies.append("Set-Cookie", await adminSessionCookie(env));
    cookies.append("Set-Cookie", await createAdminAccountSessionCookie(env));
    return json({ ok:true }, 200, cookies);
  }
  if (url.pathname === "/admin/logout" && request.method === "POST") {
    if (!sameOrigin(request) || !await isAdmin(request,env)) return json({ error:"unauthorized" },401);
    await audit(env,"admin_logout").catch(()=>undefined);
    const logoutHeaders = new Headers();
    logoutHeaders.append("Set-Cookie", ADMIN_COOKIE + "=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict");
    logoutHeaders.append("Set-Cookie", ADMIN_COOKIE + "=; Max-Age=0; Path=/admin; Secure; HttpOnly; SameSite=Strict");
    return json({ok:true},200,logoutHeaders);
  }
  if (url.pathname === "/admin.js" && request.method === "GET") return scriptResponse(ADMIN_JS);
  if (url.pathname === "/admin-login.js" && request.method === "GET") return scriptResponse(ADMIN_LOGIN_JS);
  if (url.pathname === "/admin" && request.method === "GET") {
    if (!await isAdmin(request,env)) return Response.redirect(new URL("/admin/login",request.url).toString(),302);
    return htmlResponse(adminPage());
  }
  if (url.pathname.startsWith("/admin/api/")) {
    if (!await isAdmin(request,env)) return json({error:"unauthorized"},401);

    if (url.pathname === "/admin/api/assamese/references" && request.method === "GET") {
      try {
        const result = await env.DB.prepare(
          "SELECT e.entry_id AS entryId, e.entry_kind AS entryKind, e.interaction_intent AS interactionIntent, " +
          "e.language_mode AS languageMode, e.dialect_scope AS dialectScope, e.register AS register, " +
          "e.context_summary AS contextSummary, e.user_example AS userExample, e.response_example AS responseExample, " +
          "e.usage_notes AS usageNotes, e.avoid_when AS avoidWhen, e.source_kind AS sourceKind, " +
          "e.source_title AS sourceTitle, e.source_url AS sourceUrl, e.source_license AS sourceLicense, " +
          "e.permission_basis AS permissionBasis, e.attribution_required AS attributionRequired, " +
          "e.rights_confirmed AS rightsConfirmed, e.native_verified AS nativeVerified, " +
          "e.review_status AS reviewStatus, e.enabled AS enabled, e.priority AS priority, e.version AS version, " +
          "e.admin_override AS adminOverride, e.admin_override_by AS adminOverrideBy, e.admin_override_at AS adminOverrideAt, e.admin_override_reason AS adminOverrideReason, " +
          "(SELECT COUNT(DISTINCT r.reviewer_code) FROM assamese_conversation_reference_reviews r " +
          "WHERE r.entry_id=e.entry_id AND r.reviewer_type='native_speaker' AND r.decision='approved') AS approvedNativeReviewCount " +
          "FROM assamese_conversation_reference e WHERE e.review_status <> 'retired' ORDER BY e.priority ASC, e.entry_id ASC",
        ).all<Record<string, unknown>>();
        const entries = Array.isArray(result.results) ? result.results : [];
        const reviews = await env.DB.prepare(
          "SELECT entry_id AS entryId, reviewer_code AS reviewerCode, reviewer_type AS reviewerType, " +
          "locality_scope AS localityScope, decision, notes, reviewed_at AS reviewedAt " +
          "FROM assamese_conversation_reference_reviews ORDER BY reviewed_at DESC LIMIT 150",
        ).all<Record<string, unknown>>();
        const byEntry = new Map<string, Record<string, unknown>[]>();
        for (const review of reviews.results || []) {
          const id = String(review.entryId || "");
          const list = byEntry.get(id) || [];
          list.push(review);
          byEntry.set(id, list);
        }
        return json({ entries: entries.map((entry) => ({ ...entry, reviews: byEntry.get(String(entry.entryId)) || [] })) });
      } catch {
        return json({ error: "assamese_review_storage_not_ready", message: "The M2 reference tables are not available in this environment. Apply the existing M2 migration before reviewing entries." }, 503);
      }
    }
    if (url.pathname === "/admin/api/assamese/reference-review" && request.method === "POST") {
      if (!sameOrigin(request)) return json({ error: "forbidden_origin" }, 403);
      let input: { entryId?: unknown; reviewerCode?: unknown; localityScope?: unknown; decision?: unknown; notes?: unknown; rightsConfirmed?: unknown; nativeSpeakerAttestation?: unknown };
      try { input = await request.json() as typeof input; } catch { return json({ error: "invalid_json" }, 400); }
      const entryId = typeof input.entryId === "string" ? input.entryId.trim().slice(0, 80) : "";
      const reviewerCode = typeof input.reviewerCode === "string" ? input.reviewerCode.trim() : "";
      const localityScope = typeof input.localityScope === "string" ? input.localityScope.trim().slice(0, 120) : "not_recorded";
      const decision = typeof input.decision === "string" ? input.decision : "";
      const notes = typeof input.notes === "string" ? input.notes.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim().slice(0, 280) : "";
      if (!/^[a-zA-Z0-9_-]{3,80}$/.test(reviewerCode)) return json({ error: "invalid_reviewer_code", message: "Use a stable pseudonymous reviewer code (3–80 letters, numbers, underscores or hyphens), not a personal name." }, 400);
      if (!/^[a-zA-Z0-9_-]{3,80}$/.test(entryId) || !["approved", "needs_revision", "rejected"].includes(decision)) return json({ error: "invalid_review" }, 400);
      if (input.nativeSpeakerAttestation !== true) return json({ error: "native_speaker_attestation_required" }, 400);
      if (typeof input.rightsConfirmed !== "boolean") return json({ error: "rights_decision_required" }, 400);
      const entry = await env.DB.prepare(
        "SELECT entry_id, source_title, source_license, permission_basis FROM assamese_conversation_reference WHERE entry_id = ?",
      ).bind(entryId).first<{ entry_id: string; source_title: string; source_license: string; permission_basis: string }>();
      if (!entry) return json({ error: "reference_not_found" }, 404);
      if (input.rightsConfirmed && ![entry.source_title, entry.source_license, entry.permission_basis].every((value) => typeof value === "string" && value.trim().length > 1)) {
        return json({ error: "rights_metadata_incomplete", message: "Source title, permission/license basis and source details must be complete before confirming rights." }, 400);
      }
      const now = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO assamese_conversation_reference_reviews (review_id, entry_id, reviewer_code, reviewer_type, locality_scope, decision, notes, reviewed_at) " +
        "VALUES (?, ?, ?, 'native_speaker', ?, ?, ?, ?) " +
        "ON CONFLICT(entry_id, reviewer_code) DO UPDATE SET reviewer_type='native_speaker', locality_scope=excluded.locality_scope, " +
        "decision=excluded.decision, notes=excluded.notes, reviewed_at=excluded.reviewed_at",
      ).bind(crypto.randomUUID(), entryId, reviewerCode, localityScope || "not_recorded", decision, notes, now).run();
      const rightsConfirmed = input.rightsConfirmed ? 1 : 0;
      if (decision !== "approved") {
        await env.DB.prepare(
          "UPDATE assamese_conversation_reference SET rights_confirmed=?, native_verified=0, enabled=0, review_status=?, updated_at=?, version=version+1 WHERE entry_id=?",
        ).bind(rightsConfirmed, decision, now, entryId).run();
      } else {
        const count = await env.DB.prepare(
          "SELECT COUNT(DISTINCT reviewer_code) AS total FROM assamese_conversation_reference_reviews WHERE entry_id=? AND reviewer_type='native_speaker' AND decision='approved'",
        ).bind(entryId).first<{ total: number }>();
        const approvedByTwo = Number(count?.total || 0) >= 2;
        const reviewStatus = !rightsConfirmed ? "rights_pending" : (approvedByTwo ? "approved" : "native_review_pending");
        await env.DB.prepare(
          "UPDATE assamese_conversation_reference SET rights_confirmed=?, native_verified=?, enabled=?, review_status=?, updated_at=?, version=version+1 WHERE entry_id=?",
        ).bind(rightsConfirmed, approvedByTwo && rightsConfirmed ? 1 : 0, approvedByTwo && rightsConfirmed ? 1 : 0, reviewStatus, now, entryId).run();
      }
      await audit(env, "assamese_reference_" + String(decision)).catch(() => undefined);
      const updated = await env.DB.prepare(
        "SELECT review_status AS reviewStatus, enabled, rights_confirmed AS rightsConfirmed, " +
        "(SELECT COUNT(DISTINCT r.reviewer_code) FROM assamese_conversation_reference_reviews r WHERE r.entry_id=assamese_conversation_reference.entry_id AND r.reviewer_type='native_speaker' AND r.decision='approved') AS approvedNativeReviewCount " +
        "FROM assamese_conversation_reference WHERE entry_id=?",
      ).bind(entryId).first<Record<string, unknown>>();
      const active = Number(updated?.approvedNativeReviewCount || 0) >= 2 && Number(updated?.rightsConfirmed) === 1 && Number(updated?.enabled) === 1;
      return json({ ok: true, entryId, result: updated, message: active ? "Second distinct native-speaker approval and rights gate passed. Entry is now eligible for retrieval." : "Review saved. This entry stays disabled until rights are confirmed and two distinct native speakers approve it." });
    }
    if (url.pathname === "/admin/api/assamese/admin-override" && request.method === "POST") {
      if (!sameOrigin(request)) return json({ error: "forbidden_origin" }, 403);
      let input: { confirmation?: unknown };
      try { input = await request.json() as typeof input; } catch { return json({ error: "invalid_json" }, 400); }
      if (input.confirmation !== "ADMIN_OVERRIDE_M1_M2") return json({ error: "explicit_admin_override_confirmation_required" }, 400);
      const now = new Date().toISOString();
      const adminCode = (env.ADMIN_DASHBOARD_USER || "admin").slice(0, 80);
      const reason = "Admin override requested by project owner, who reports that manual testing was completed and asks to pass the M1/M2 dashboard gates. Detailed per-case ratings and a second native-speaker identity were not supplied; this is recorded as an override, not as those reviews.";
      const missing = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM assamese_conversation_reference WHERE review_status <> 'retired' AND (" +
        "length(trim(source_title))=0 OR length(trim(source_license))=0 OR length(trim(permission_basis))=0 OR length(trim(response_example))=0)",
      ).first<{ total: number }>();
      if (Number(missing?.total || 0) > 0) {
        return json({ error: "reference_metadata_incomplete", message: "Some reference entries have incomplete source/permission metadata. They were not enabled." }, 409);
      }
      await env.DB.prepare(
        "UPDATE assamese_conversation_reference SET rights_confirmed=1, native_verified=1, review_status='approved', enabled=1, " +
        "admin_override=1, admin_override_by=?, admin_override_at=?, admin_override_reason=?, updated_at=?, version=version+1 " +
        "WHERE review_status <> 'retired'",
      ).bind(adminCode, now, reason, now).run();
      const dimensions = {
        language_match: { percent: null, rated: 0 },
        conversational_naturalness: { percent: null, rated: 0 },
        pronunciation_clarity: { percent: null, rated: 0 },
        code_switching: { percent: null, rated: 0 },
        turn_taking: { percent: null, rated: 0 },
        uncertainty_honesty: { percent: null, rated: 0 }
      };
      const caseIds = Array.from({length: 15}, (_, i) => "AS" + String(i + 1).padStart(2, "0"));
      const results = caseIds.map((case_id) => ({
        case_id,
        ratings: Object.fromEntries(Object.keys(dimensions).map((key) => [key, null])),
        critical_failures: [],
        notes: "No individual rating entered; covered by explicit admin override."
      }));
      const runId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO assamese_speech_review_runs (review_id, evaluation_date, evaluator_code, suite_version, completed_cases, total_cases, overall_percent, dimensions_json, critical_failure_count, passed, results_json, created_at, admin_override, override_reason) " +
        "VALUES (?, ?, ?, '1.0.0', 0, 15, NULL, ?, 0, 1, ?, ?, 1, ?)",
      ).bind(runId, now.slice(0, 10), adminCode, JSON.stringify(dimensions), JSON.stringify(results), now, reason).run();
      await audit(env, "admin_override_assamese_m1_m2").catch(() => undefined);
      const count = await env.DB.prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN enabled=1 AND review_status='approved' AND admin_override=1 THEN 1 ELSE 0 END) AS enabledOverride " +
        "FROM assamese_conversation_reference WHERE review_status <> 'retired'",
      ).first<{ total: number; enabledOverride: number }>();
      return json({
        ok: true, outcome: "admin_override_applied", speechRunId: runId,
        m1: { status: "passed_by_admin_override", detailedRatings: false, note: "The dashboard gate is overridden. Individual test ratings are intentionally left unscored." },
        m2: { status: "approved_by_admin_override", entries: Number(count?.total || 0), enabled: Number(count?.enabledOverride || 0), distinctNativeApprovals: "not represented or fabricated" },
        auditEvent: "admin_override_assamese_m1_m2"
      }, 200);
    }
    if (url.pathname === "/admin/api/assamese/speech-runs" && request.method === "GET") {
      try {
        const result = await env.DB.prepare(
          "SELECT review_id AS reviewId, evaluation_date AS evaluationDate, evaluator_code AS evaluatorCode, " +
          "completed_cases AS completedCases, total_cases AS totalCases, overall_percent AS overallPercent, " +
          "dimensions_json AS dimensionsJson, critical_failure_count AS criticalFailureCount, passed, admin_override AS adminOverride, override_reason AS overrideReason, created_at AS createdAt " +
          "FROM assamese_speech_review_runs ORDER BY created_at DESC LIMIT 20",
        ).all<Record<string, unknown>>();
        return json({ runs: result.results || [] });
      } catch {
        return json({ error: "speech_review_storage_not_ready", message: "Apply the M1 score-only review migration before saving speech scores." }, 503);
      }
    }
    if (url.pathname === "/admin/api/assamese/speech-runs" && request.method === "POST") {
      if (!sameOrigin(request)) return json({ error: "forbidden_origin" }, 403);
      let input: { evaluatorCode?: unknown; nativeSpeakerAttestation?: unknown; suiteVersion?: unknown; results?: unknown };
      try { input = await request.json() as typeof input; } catch { return json({ error: "invalid_json" }, 400); }
      const evaluatorCode = typeof input.evaluatorCode === "string" ? input.evaluatorCode.trim() : "";
      if (!/^[a-zA-Z0-9_-]{3,80}$/.test(evaluatorCode)) return json({ error: "invalid_reviewer_code" }, 400);
      if (input.nativeSpeakerAttestation !== true) return json({ error: "native_speaker_attestation_required" }, 400);
      if (input.suiteVersion !== "1.0.0" || !Array.isArray(input.results) || input.results.length !== 15) return json({ error: "invalid_speech_run" }, 400);
      const dimensions = ["language_match", "conversational_naturalness", "pronunciation_clarity", "code_switching", "turn_taking", "uncertainty_honesty"];
      const caseIds = Array.from({length:15}, (_, i) => "AS" + String(i + 1).padStart(2, "0"));
      const results = input.results as Array<{case_id?: unknown; ratings?: unknown; critical_failures?: unknown; notes?: unknown}>;
      const seen = new Set<string>();
      const safeResults: Array<{case_id:string;ratings:Record<string,number|null>;critical_failures:string[];notes:string}> = [];
      for (const row of results) {
        const id = typeof row?.case_id === "string" ? row.case_id : "";
        if (!caseIds.includes(id) || seen.has(id) || !row.ratings || typeof row.ratings !== "object" || Array.isArray(row.ratings)) return json({ error: "invalid_speech_result_row" }, 400);
        seen.add(id);
        const ratings = row.ratings as Record<string, unknown>;
        const safeRatings: Record<string, number | null> = {};
        for (const dim of dimensions) {
          const value = ratings[dim];
          if (value !== null && value !== 0 && value !== 1 && value !== 2) return json({ error: "invalid_speech_rating" }, 400);
          safeRatings[dim] = value as number | null;
        }
        if (Object.keys(ratings).some((key) => !dimensions.includes(key))) return json({ error: "unknown_speech_dimension" }, 400);
        if (!Array.isArray(row.critical_failures) || row.critical_failures.some((value) => typeof value !== "string" || value.length > 80)) return json({ error: "invalid_critical_failure" }, 400);
        if (typeof row.notes !== "string" || row.notes.length > 280) return json({ error: "invalid_speech_note" }, 400);
        safeResults.push({ case_id: id, ratings: safeRatings, critical_failures: [...new Set(row.critical_failures as string[])].slice(0, 5), notes: row.notes.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim() });
      }
      if (seen.size !== caseIds.length) return json({ error: "missing_speech_cases" }, 400);
      const ordered = caseIds.map((id) => safeResults.find((row) => row.case_id === id)!);
      const complete = ordered.filter((row) => dimensions.every((dim) => row.ratings[dim] !== null)).length;
      const dimScores = Object.fromEntries(dimensions.map((dim) => {
        const scores = ordered.map((row) => row.ratings[dim]).filter((value): value is number => value !== null);
        return [dim, { percent: scores.length ? Math.round(scores.reduce((sum, value) => sum + value * 50, 0) / scores.length) : null, rated: scores.length }];
      })) as Record<string, { percent: number | null; rated: number }>;
      const allScores = ordered.flatMap((row) => dimensions.map((dim) => row.ratings[dim]).filter((value): value is number => value !== null));
      const overall = allScores.length ? Math.round(allScores.reduce((sum, value) => sum + value * 50, 0) / allScores.length) : null;
      const criticalFailures = ordered.reduce((sum, row) => sum + row.critical_failures.length, 0);
      const thresholds: Record<string, number> = { language_match: 85, conversational_naturalness: 85, pronunciation_clarity: 80, code_switching: 85 };
      const dimensionsPassed = Object.entries(thresholds).every(([dim, threshold]) => dimScores[dim].percent !== null && Number(dimScores[dim].percent) >= threshold);
      const passed = complete >= 12 && overall !== null && overall >= 85 && criticalFailures === 0 && dimensionsPassed;
      const summary = { suiteVersion: "1.0.0", completedCases: complete, totalCases: 15, overallPercent: overall, dimensions: dimScores, criticalFailureCount: criticalFailures, passed };
      const now = new Date().toISOString(), reviewId = crypto.randomUUID();
      try {
        await env.DB.prepare(
          "INSERT INTO assamese_speech_review_runs (review_id, evaluation_date, evaluator_code, suite_version, completed_cases, total_cases, overall_percent, dimensions_json, critical_failure_count, passed, results_json, created_at) " +
          "VALUES (?, ?, ?, '1.0.0', ?, 15, ?, ?, ?, ?, ?, ?)",
        ).bind(reviewId, now.slice(0, 10), evaluatorCode, complete, overall, JSON.stringify(dimScores), criticalFailures, passed ? 1 : 0, JSON.stringify(ordered), now).run();
      } catch {
        return json({ error: "speech_review_storage_not_ready", message: "The M1 score-only review table is not available. Apply the M1 review migration before submitting." }, 503);
      }
      await audit(env, passed ? "assamese_speech_review_passed" : "assamese_speech_review_submitted").catch(() => undefined);
      return json({ ok: true, reviewId, ...summary }, 201);
    }

    if (request.method !== "GET") return json({error:"method_not_allowed"},405);
    if (url.pathname === "/admin/api/overview") {
      const metrics = await env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM visitor_profiles) AS visitorsTotal, " +
        "(SELECT COUNT(*) FROM visitor_profiles WHERE last_seen_at >= datetime('now','-1 day')) AS visitors24h, " +
        "(SELECT COUNT(*) FROM voice_sessions WHERE started_at >= datetime('now','-1 day')) AS sessions24h, " +
        "(SELECT COALESCE(SUM(duration_seconds),0) FROM voice_sessions WHERE started_at >= datetime('now','-1 day')) AS seconds24h, " +
        "(SELECT COUNT(*) FROM voice_sessions WHERE ended_at IS NULL AND started_at >= datetime('now','-1 hour')) AS activeSessions, " +
        "(SELECT COUNT(*) FROM voice_sessions WHERE started_at >= datetime('now','-1 day') AND outcome NOT IN ('completed','connecting','client_disconnected')) AS failed24h",
      ).first<Record<string,number>>();
      const parsedRetentionDays = Number.parseInt(env.ANALYTICS_RAW_RETENTION_DAYS || "", 10);
      const retentionDays = Number.isSafeInteger(parsedRetentionDays) && parsedRetentionDays > 0 ? Math.min(parsedRetentionDays, 3_650) : 30;
      return json({metrics:metrics||{},system:{worker:"AskMoina Voice",model:env.GEMINI_MODEL||"configured",location:env.GEMINI_LOCATION||"configured",retentionDays,auditLogRetentionDays:90,cleanupIntervalHours:1}});
    }
    if (url.pathname === "/admin/api/sessions") {
      const result = await env.DB.prepare(
        "SELECT session_id AS sessionId, substr(visitor_id,-8) AS visitor, started_at AS startedAt, duration_seconds AS durationSeconds, outcome, setup_completed AS setupCompleted FROM voice_sessions ORDER BY started_at DESC LIMIT 50",
      ).all();
      return json({sessions:result.results||[]});
    }
    return json({error:"not_found"},404);
  }
  if (url.pathname.startsWith("/admin")) return json({error:"not_found"},404);
  return json({error:"not_found"},404);
}

export async function handleContinuityRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/identity" && request.method === "GET") {
    const visitor = await ensureVisitor(request, env);
    await visitor.touch;
    const continuity = visitor.visitorId.startsWith(ANONYMOUS_VISITOR_PREFIX)
      ? "pseudonymous-browser"
      : "authenticated-account";
    const headers = visitor.cookie ? { "Set-Cookie": visitor.cookie } : undefined;
    return json({ ok: true, continuity }, 200, headers);
  }
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/") || url.pathname === "/admin.js" || url.pathname === "/admin-login.js") return handleAdmin(request,env,url);
  return null;
}
