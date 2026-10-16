import type { Env } from "./config/env";
import { getAuthenticatedUserId, isAuthenticatedAccountAdmin, createAdminAccountSessionCookie } from "./auth/accounts";

const ADMIN_COOKIE = "moina_admin_session";
const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

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

export async function visitorIdFromRequest(request: Request, env: Env): Promise<string | null> {
  return getAuthenticatedUserId(request, env);
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
  if (!userId) return { visitorId: "", touch: Promise.resolve() };
  return { visitorId: userId, touch: touchVisitor(env, userId).catch(() => undefined) };
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
    '<style>*{box-sizing:border-box}body{margin:0;background:#0c1222;color:#eef3ff;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{max-width:1200px;margin:auto;padding:25px 18px 60px}.top{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap}h1{font-size:2rem;margin:16px 0 4px}h2{margin-top:0}.muted{color:#98a8c2}.btn{display:inline-block;text-decoration:none;border:1px solid #3a4b68;background:#14243c;color:#fff;border-radius:9px;padding:9px 12px;font:inherit;cursor:pointer}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:22px 0}.card,.section{background:#111c31;border:1px solid #293753;border-radius:15px;padding:17px}.value{font-size:2rem;font-weight:750;letter-spacing:-.03em}.label{font-size:.85rem;color:#9aacc6}.layout{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;border-bottom:1px solid #293753;padding:10px 8px;white-space:nowrap}th{color:#a8bad4;font-weight:600}.alert{padding:12px;background:#162a3c;border-radius:10px;margin:12px 0;color:#bdd7e9}@media(max-width:800px){.layout{grid-template-columns:1fr}}button:focus{outline:2px solid #9edbe3;outline-offset:2px}</style></head><body><main class="wrap">',
    '<header class="top"><div><strong>◉ AskMoina / Operations</strong><div class="muted">Operational analytics only · no transcript or memory access</div></div><div><a class="btn" href="/voice-lab">Voice audition lab</a> <button class="btn" id="refresh">Refresh</button> <button class="btn" id="logout">Sign out</button></div></header>',
    '<h1>System overview</h1><p class="muted">Session and privacy-safe usage data. Costs are not inferred from duration; Google Cloud billing is the source for actual spend.</p><div class="cards" id="cards"><div class="card">Loading…</div></div>',
    '<div class="layout"><section class="section"><h2>Recent voice sessions</h2><div class="table-wrap"><table><thead><tr><th>Session</th><th>Visitor</th><th>Started</th><th>Duration</th><th>Outcome</th></tr></thead><tbody id="sessions"></tbody></table></div></section>',
    '<section class="section"><h2>Privacy & health</h2><div id="health" class="alert">Loading system status…</div><p class="muted">Microphone audio and transcript text are not written to the app analytics database. Admin access is audited.</p><p><a href="/">Open voice app</a></p></section></div>',
    '<p id="message" class="muted" role="status" aria-live="polite"></p><script src="/admin.js" defer></script></main></body></html>',
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
    const visitor = await ensureVisitor(request,env); ctx.waitUntil(visitor.touch);
    return json({ok:true,userId:visitor.visitorId,continuity:"authenticated-account"},200);
  }
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/") || url.pathname === "/admin.js" || url.pathname === "/admin-login.js") return handleAdmin(request,env,url);
  return null;
}
