import type { Env } from "../config/env";

export const VEDA_APP_ROOT = "/veda";
export const VEDA_API_ROOT = "/api/veda";
export const VEDA_PHASE = "phase-3-private-install-portal";
type VedaEnvironment = Pick<Env, "VEDA_ENABLED" | "VEDA_PORTAL_ENABLED">;

export function isVedaRoutePath(pathname: string): boolean {
  return pathname === VEDA_APP_ROOT || pathname.startsWith(VEDA_APP_ROOT + "/") ||
    pathname === VEDA_API_ROOT || pathname.startsWith(VEDA_API_ROOT + "/");
}
export function isVedaApiPath(pathname: string): boolean {
  return pathname === VEDA_API_ROOT || pathname.startsWith(VEDA_API_ROOT + "/");
}
export function isVedaEnabled(env: VedaEnvironment): boolean {
  return env.VEDA_ENABLED?.trim().toLowerCase() === "true";
}
export function isVedaPortalEnabled(env: VedaEnvironment): boolean {
  return env.VEDA_PORTAL_ENABLED?.trim().toLowerCase() === "true";
}

const PAGE_PATHS = new Set(["/veda", "/veda/", "/veda/install"]);
const ASSET_PATHS = new Set(["/veda/manifest.webmanifest", "/veda/icon.svg", "/veda/app.css", "/veda/app.js", "/veda/service-worker.js"]);

export function handleVedaBoundaryRequest(request: Request, env: VedaEnvironment, adminAuthorized: boolean): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!isVedaRoutePath(path)) return null;
  const portalEnabled = isVedaPortalEnabled(env);
  const runtimeEnabled = isVedaEnabled(env);
  const page = PAGE_PATHS.has(path);
  const asset = ASSET_PATHS.has(path);
  const status = path === VEDA_API_ROOT + "/status";
  if (!portalEnabled && !runtimeEnabled) return notFound(path);

  if (portalEnabled && (page || asset || status)) {
    if (!adminAuthorized) return deny(request, isVedaApiPath(path) || asset);
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405, { Allow: "GET, HEAD" });
    if (page) return raw(PORTAL_HTML, "text/html; charset=utf-8", request.method === "HEAD");
    if (path === "/veda/manifest.webmanifest") return json({
      id: "/veda/", name: "Project Veda", short_name: "Veda",
      description: "Private, admin-controlled social-intelligence co-pilot",
      start_url: "/veda/?source=pwa", scope: "/veda/", display: "standalone",
      background_color: "#08090b", theme_color: "#08090b",
      icons: [{ src: "/veda/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    }, 200, { "Content-Type": "application/manifest+json; charset=utf-8" }, request.method === "HEAD");
    if (path === "/veda/icon.svg") return raw(ICON, "image/svg+xml; charset=utf-8", request.method === "HEAD");
    if (path === "/veda/app.css") return raw(CSS, "text/css; charset=utf-8", request.method === "HEAD");
    if (path === "/veda/app.js") return raw(JS, "text/javascript; charset=utf-8", request.method === "HEAD");
    if (path === "/veda/service-worker.js") return raw(SERVICE_WORKER, "text/javascript; charset=utf-8", request.method === "HEAD", { "Service-Worker-Allowed": "/veda/" });
    if (status) return json({
      ok: true, feature: "veda", phase: VEDA_PHASE, portalEnabled: true,
      enabled: runtimeEnabled, runtimeReady: false,
      state: runtimeEnabled ? "runtime_not_ready" : "runtime_disabled",
      message: "Private portal is ready. Listening, device pairing and Live processing remain disabled until their later phases are completed.",
    }, 200, {}, request.method === "HEAD");
  }
  if (!adminAuthorized) return deny(request, isVedaApiPath(path));
  if (!runtimeEnabled) return notFound(path);
  if (status) {
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405, { Allow: "GET, HEAD" });
    return json({ ok: true, feature: "veda", phase: VEDA_PHASE, enabled: true, runtimeReady: false,
      message: "Veda is isolated, but its installation UI, device pairing, and Live runtime are not implemented in Phase 1." }, 200, {}, request.method === "HEAD");
  }
  return notFound(path);
}
function deny(request: Request, isApiOrAsset: boolean): Response {
  if (!isApiOrAsset && (request.method === "GET" || request.method === "HEAD")) return Response.redirect(new URL("/admin/login", request.url).toString(), 302);
  return json({ error: "admin_required" }, 401);
}
function headers(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; font-src 'self'",
    "Permissions-Policy": "microphone=(), camera=(), geolocation=(), payment=()", ...extra,
  });
}
function json(body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}, headOnly = false): Response {
  return new Response(headOnly ? null : JSON.stringify(body), { status, headers: headers({ "Content-Type": "application/json; charset=utf-8", ...extra }) });
}
function raw(body: string, type: string, headOnly = false, extra: Record<string, string> = {}): Response {
  return new Response(headOnly ? null : body, { status: 200, headers: headers({ "Content-Type": type, ...extra }) });
}
function notFound(path: string): Response {
  if (isVedaApiPath(path)) return json({ error: "not_found" }, 404);
  return new Response("Not found", { status: 404, headers: headers({ "Content-Type": "text/plain; charset=utf-8" }) });
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#08090b"/><path d="M130 145h52l74 207 74-207h52L278 382h-44z" fill="#f4f4f5"/><circle cx="386" cy="126" r="16" fill="#96979b"/></svg>`;
const PORTAL_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08090b"><meta name="color-scheme" content="dark"><meta name="robots" content="noindex,nofollow,noarchive"><link rel="manifest" href="/veda/manifest.webmanifest"><link rel="icon" href="/veda/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/veda/app.css"><title>Project Veda</title></head><body><main class="shell"><header class="topbar"><a class="brand" href="/veda/" aria-label="Project Veda home"><img src="/veda/icon.svg" alt="" width="32" height="32"><span><strong>veda</strong><small>PRIVATE SYSTEM</small></span></a><span class="private-label"><i></i> Admin only</span></header><section class="intro"><p class="eyebrow">YOUR PRIVATE CO-PILOT</p><h1>Ready when<br>you are.</h1><p class="lede">A discreet intelligence companion for conversations, research and useful moments. You stay in control.</p></section><section class="status-card"><div class="status-top"><div><p class="eyebrow">SYSTEM STATUS</p><h2>Private portal</h2></div><span class="state-badge" id="portal-state">Checking</span></div><div class="status-row"><span>Installation portal</span><strong id="portal-health">Checking…</strong></div><div class="status-row"><span>Listening runtime</span><strong class="muted" id="runtime-health">Disabled</strong></div><div class="status-row"><span>Device pairing</span><strong class="muted">Phase 4</strong></div><p class="status-note" id="status-note" role="status" aria-live="polite">Checking private system status…</p></section><section class="install-card"><div class="install-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v11m-4-4 4 4 4-4M5 16v3h14v-3"/></svg></div><div class="install-copy"><h2>Install Veda</h2><p>Add the private control panel to your home screen. Device listening is not enabled in this phase.</p></div><button id="install-button" type="button">Install app ↗</button><p id="install-note" class="microcopy" role="status" aria-live="polite">Use your browser’s install option if no install prompt appears.</p></section><section class="privacy-card"><span class="privacy-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><div><h2>Private by design</h2><p>Every Veda page, app asset, manifest and status request is checked by the server. No public registration. No microphone capture in this phase.</p></div></section><footer><span>PROJECT VEDA · PHASE 3</span><button class="signout" id="signout-button" type="button">Sign out</button></footer></main><script src="/veda/app.js" defer></script></body></html>`;
const CSS = `:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#08090b;color:#f5f5f7;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% 0%,#1a1b20 0%,#08090b 54%);color:#f5f5f7}.shell{width:min(100% - 36px,720px);margin:0 auto;padding:env(safe-area-inset-top) 0 calc(28px + env(safe-area-inset-bottom));min-height:100dvh}.topbar{height:88px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #25262a}.brand{display:flex;gap:11px;align-items:center;color:inherit;text-decoration:none}.brand img{border-radius:10px}.brand span{display:flex;flex-direction:column;gap:2px}.brand strong{font-size:20px;font-weight:500;letter-spacing:.05em}.brand small,.eyebrow,footer{font-size:10px;letter-spacing:.16em;color:#999ba1}.private-label{display:flex;gap:8px;align-items:center;border:1px solid #34353a;border-radius:99px;padding:8px 11px;font-size:11px;color:#c9cacf}.private-label i{width:6px;height:6px;border-radius:50%;background:#bfc0c5}.intro{padding:48px 0 28px}.eyebrow{margin:0 0 14px}.intro h1{font-size:clamp(48px,10vw,74px);line-height:.98;letter-spacing:-.065em;font-weight:500;margin:0}.lede{font-size:16px;line-height:1.65;color:#a5a6ac;max-width:460px;margin:20px 0 0}.status-card,.install-card,.privacy-card{border:1px solid #292a2f;background:linear-gradient(145deg,rgba(27,28,33,.94),rgba(14,15,18,.96));border-radius:24px;padding:22px;margin-top:16px}.status-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.status-top h2,.install-copy h2,.privacy-card h2{font-size:17px;font-weight:500;letter-spacing:-.025em;margin:0}.status-top .eyebrow{margin:0 0 8px}.state-badge{font-size:11px;color:#d4d4d8;border:1px solid #45464c;padding:7px 10px;border-radius:99px}.status-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:13px 0;border-top:1px solid #292a2e;font-size:13px;color:#b5b6bc}.status-row strong{font-weight:500;color:#e8e8eb}.status-row strong.muted{color:#888a91}.status-note{font-size:12px;line-height:1.55;color:#9b9da4;margin:15px 0 0}.install-card{display:grid;grid-template-columns:44px 1fr;gap:16px;align-items:center}.install-icon{width:44px;height:44px;border:1px solid #42434a;border-radius:14px;display:grid;place-items:center}.install-icon svg,.privacy-symbol svg{width:22px;height:22px;fill:none;stroke:#e1e1e5;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.install-copy p,.privacy-card p{font-size:13px;line-height:1.55;color:#999ba2;margin:8px 0 0}.install-card button{grid-column:1/-1;width:100%;height:48px;background:#f1f1f3;color:#111214;border:0;border-radius:14px;font-size:14px;font-weight:600;cursor:pointer}.microcopy{grid-column:1/-1;color:#85878e;font-size:11px;line-height:1.5;margin:0}.privacy-card{display:flex;align-items:flex-start;gap:14px}.privacy-symbol{flex:none;width:36px;height:36px;display:grid;place-items:center;background:#292a30;border-radius:12px}.privacy-card h2{margin-top:2px}.privacy-card p{margin-bottom:0}footer{display:flex;align-items:center;justify-content:space-between;padding:28px 4px 0}.signout{border:0;background:transparent;color:#aaaab0;font:inherit;letter-spacing:0;cursor:pointer;padding:8px}button:hover{filter:brightness(.93)}button:focus-visible{outline:2px solid #fff;outline-offset:3px}@media(min-width:600px){.intro{padding-top:68px}.status-card,.install-card,.privacy-card{padding:26px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}`;
const JS = `(() => {
  const $ = selector => document.querySelector(selector);
  let installPrompt = null;
  const button = $("#install-button");
  const note = $("#install-note");
  const installed = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (installed) { button.textContent = "App installed"; button.disabled = true; note.textContent = "Veda is running in its installed app window."; }
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; });
  button.addEventListener("click", async () => {
    if (installed) return;
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      note.textContent = choice.outcome === "accepted" ? "Installation accepted. Follow your browser’s prompts to finish." : "Installation was cancelled. You can install later from the browser menu.";
      installPrompt = null; return;
    }
    note.textContent = "Open your browser menu and choose Install app or Add to Home Screen. If that option is not shown, this browser may not support PWA installation.";
  });
  fetch("/api/veda/status", { credentials:"same-origin", cache:"no-store" }).then(response => {
    if (response.status === 401) { location.replace("/admin/login"); throw new Error("Not authorized"); }
    if (!response.ok) throw new Error("Status unavailable");
    return response.json();
  }).then(status => {
    $("#portal-state").textContent = "Private"; $("#portal-health").textContent = "Ready";
    $("#runtime-health").textContent = status.enabled ? "Not ready" : "Disabled";
    $("#status-note").textContent = status.message;
  }).catch(() => { $("#portal-state").textContent = "Unavailable"; $("#portal-health").textContent = "Unverified"; $("#status-note").textContent = "The status check failed. Reload the portal before relying on it."; });
  $("#signout-button").addEventListener("click", async () => {
    const signout = $("#signout-button"); signout.disabled = true; signout.textContent = "Signing out…";
    try { await fetch("/api/auth/logout", { method:"POST", credentials:"same-origin", headers:{"Content-Type":"application/json"}, body:"{}", cache:"no-store" }); }
    finally { location.replace("/admin/login"); }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/veda/service-worker.js", { scope:"/veda/" }).catch(() => {});
})();`;
const SERVICE_WORKER = `self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(fetch(event.request, { cache:"no-store" }));
});`;
