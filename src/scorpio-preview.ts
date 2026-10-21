const PAGE_PATHS = new Set(["/scorpio-preview", "/scorpio-preview.html"]);
const ISOLATED_PREVIEW_HOST = "feature-scorpio-n-button-preview-askmoina-voice.thenewtongs.workers.dev";

export function isScorpioPreviewRootRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === "/" && url.hostname === ISOLATED_PREVIEW_HOST;
}
export function isScorpioPreviewRoute(pathname: string): boolean {
  return PAGE_PATHS.has(pathname) ||
    pathname === "/scorpio-preview.js" ||
    pathname === "/scorpio-preview.css" ||
    pathname === "/api/scorpio-preview" ||
    pathname.startsWith("/api/scorpio-preview/");
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#090a0d">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Scorpio-N Preview · askmoina</title>
<link rel="stylesheet" href="/scorpio-preview.css">
<script src="/scorpio-preview.js" defer></script>
</head>
<body>
<main class="shell">
  <header class="topbar">
    <a class="back" href="/scorpio-preview" aria-label="Open the standalone Scorpio preview route">‹</a>
    <span class="wordmark">askmoina</span>
    <span class="top-tag">PREVIEW</span>
  </header>

  <section class="intro">
    <p class="eyebrow">PERSONAL VEHICLE LAB</p>
    <h1>Scorpio-N<br><span>command preview.</span></h1>
    <p class="subhead">Test the button flow first. Vehicle integration stays locked until a verified Adrenox connector is available.</p>
  </section>

  <section class="connection-card" aria-labelledby="connectionTitle">
    <div class="connection-head">
      <div class="status-icon" aria-hidden="true"><span></span></div>
      <div class="connection-copy">
        <p class="eyebrow">VEHICLE CONNECTION</p>
        <h2 id="connectionTitle">Not configured</h2>
        <p id="connectionMessage">No live vehicle request has been sent.</p>
      </div>
      <span id="modeBadge" class="mode-badge">SIMULATION</span>
    </div>
    <button id="checkConnection" class="secondary-button" type="button">Check Adrenox connection <span aria-hidden="true">↗</span></button>
    <p class="fineprint" id="connectionFootnote">The architecture document contains example URLs, not verified Adrenox API documentation. This check will not submit credentials or contact an unverified endpoint.</p>
  </section>

  <section class="phase-one" aria-labelledby="phaseOneTitle">
    <div class="phase-one-heading">
      <div>
        <p class="eyebrow">PHASE 01 · INTEGRATION READINESS</p>
        <h2 id="phaseOneTitle">Official connection route</h2>
      </div>
      <span class="phase-status">VENDOR CONFIRMATION NEEDED</span>
    </div>
    <p class="phase-one-summary">Public-source review is complete. We have not located a published third-party AdrenoX API contract in the official sources reviewed. That does not rule out a private or partner API; Mahindra must confirm an authorized route before live connection work can continue.</p>

    <div class="finding-list">
      <article class="finding">
        <div class="finding-top"><span class="finding-label">REMOTE WINDOWS</span><span class="finding-state finding-documented">APP FEATURE DOCUMENTED</span></div>
        <p>The Scorpio-N owner’s manual lists Remote Window Up/Down in AdrenoX Connect for equipped configurations. The corresponding third-party API contract and exact 2024 vehicle-variant support remain unverified.</p>
      </article>
      <article class="finding">
        <div class="finding-top"><span class="finding-label">REMOTE ENGINE START</span><span class="finding-state finding-blocked">BLOCKED FOR MANUAL</span></div>
        <p>The owner’s manual says remote engine start/stop is available in automatic-transmission vehicles. Keep this control simulation-only for your petrol manual unless Mahindra explicitly confirms otherwise.</p>
      </article>
      <article class="finding">
        <div class="finding-top"><span class="finding-label">AUTHENTICATION</span><span class="finding-state">API FLOW UNKNOWN</span></div>
        <p>The manual describes AdrenoX app registration through KYC and OTP to the registered mobile number. It does not document an authorized third-party API login or token flow.</p>
      </article>
    </div>

    <div class="phase-next">
      <p class="eyebrow">NEXT GATE</p>
      <h3>Get written integration confirmation from Mahindra</h3>
      <p>Ask whether an owner-developed app may use an official or partner API, and request documentation for authentication, supported commands, feedback/status responses, limits and terms. Do not send your AdrenoX password, OTP or VIN to an unofficial endpoint.</p>
      <div class="source-links">
        <a href="https://mvault-cloudfront.mahindra.com/2025/08/26/Owners-Manuals/Scorpio-N/Scorpio-N-Owners-Manual.html" target="_blank" rel="noopener noreferrer">Official Scorpio-N manual <span aria-hidden="true">↗</span></a>
        <a href="https://play.google.com/store/apps/details?id=com.mahindra.adrenox" target="_blank" rel="noopener noreferrer">Official AdrenoX Connect listing <span aria-hidden="true">↗</span></a>
        <a href="https://auto.mahindra.com/contact-us.html?sc_lang=en" target="_blank" rel="noopener noreferrer">Mahindra contact page <span aria-hidden="true">↗</span></a>
      </div>
      <div class="contact-row">
        <a class="support-button" href="mailto:customercare@mahindra.com?subject=Request%20for%20authorized%20AdrenoX%20API%20or%20partner%20integration">Email Mahindra support</a>
        <a class="support-phone" href="tel:18002096006">Call 1800 209 6006</a>
      </div>
      <p class="fineprint">No inquiry has been submitted by AskMoina. Live connection and vehicle commands remain disabled until an authorized route and exact-variant capabilities are confirmed.</p>
    </div>
  </section>

  <section class="commands" aria-labelledby="commandsTitle">
    <div class="section-title">
      <div><p class="eyebrow">COMMAND DECK</p><h2 id="commandsTitle">Try a control</h2></div>
      <span class="section-count">03 ACTIONS</span>
    </div>
    <article class="command-card">
      <div class="command-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6.5h16M5.5 6.5v11m13-11v11M8 17.5h8M9 10v4m6-4v4"/></svg></div>
      <div class="command-copy"><h3>Open windows</h3><p>Simulate opening supported windows.</p></div>
      <button class="command-button" data-command="windows_open" type="button">Run test <span aria-hidden="true">→</span></button>
    </article>
    <article class="command-card">
      <div class="command-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6.5h16M5.5 6.5v11m13-11v11M8 17.5h8M9 10v4m6-4v4"/></svg></div>
      <div class="command-copy"><h3>Close windows</h3><p>Simulate closing supported windows.</p></div>
      <button class="command-button" data-command="windows_close" type="button">Run test <span aria-hidden="true">→</span></button>
    </article>
    <article class="command-card command-card-engine">
      <div class="command-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 7h10l2 3h2v7h-3l-2 2H8l-2-2H3v-7h2zM9 7V4h6v3M10 12l-1 2h3l-1 2"/></svg></div>
      <div class="command-copy"><h3>Remote engine start</h3><p>Simulation only · 2024 petrol manual</p><span class="inline-note">Likely unsupported for manual transmission</span></div>
      <button class="command-button" data-command="engine_start" type="button">Run test <span aria-hidden="true">→</span></button>
    </article>
    <p class="mode-note"><span aria-hidden="true">ⓘ</span> Every command here is simulated. A green result means the preview endpoint responded, not that your vehicle acted.</p>
  </section>

  <section class="activity" aria-labelledby="activityTitle">
    <div class="section-title"><div><p class="eyebrow">LOCAL SESSION</p><h2 id="activityTitle">Activity</h2></div><button id="clearActivity" class="clear-button" type="button">Clear</button></div>
    <p id="emptyActivity" class="empty-activity">No test commands run yet.</p>
    <ol id="activityList" class="activity-list" aria-live="polite"></ol>
  </section>

  <footer class="footer">
    <span>ASKMOINA · SCORPIO-N</span>
    <span>NO VEHICLE COMMANDS SENT</span>
  </footer>
</main>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
</body>
</html>`;

const CSS = `*{box-sizing:border-box}html{min-height:100%;background:#090a0d;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Arial,sans-serif;letter-spacing:-.018em}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% -20%,rgba(82,94,122,.2),transparent 48%),#090a0d;color:#f5f5f7}.shell{width:min(100%,620px);margin:0 auto;padding:env(safe-area-inset-top) 22px calc(32px + env(safe-area-inset-bottom))}.topbar{height:62px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08)}.back{display:grid;place-items:center;width:32px;height:32px;border:1px solid rgba(255,255,255,.12);border-radius:50%;color:#f5f5f7;text-decoration:none;font-size:26px;line-height:1;font-weight:300}.wordmark{font-size:16px;font-weight:300;letter-spacing:.06em}.top-tag,.section-count{font-size:10px;letter-spacing:.12em;color:#9ca3af}.top-tag{padding:6px 8px;border:1px solid rgba(255,255,255,.14);border-radius:999px}.intro{padding:40px 0 24px}.eyebrow{margin:0 0 8px;color:#8d96a8;font-size:10px;font-weight:650;letter-spacing:.16em}.intro h1{margin:0;font-size:clamp(36px,9vw,52px);line-height:.98;font-weight:540;letter-spacing:-.06em}.intro h1 span{color:#858b98;font-weight:400}.subhead{max-width:440px;margin:16px 0 0;color:#a6a8b1;font-size:14px;line-height:1.6}.connection-card{padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:20px;background:linear-gradient(140deg,rgba(255,255,255,.065),rgba(255,255,255,.022));box-shadow:0 18px 50px rgba(0,0,0,.18)}.connection-head{display:flex;align-items:flex-start;gap:13px}.status-icon{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:12px;background:rgba(255,178,74,.11)}.status-icon span{width:8px;height:8px;border-radius:50%;background:#f3b65f;box-shadow:0 0 16px rgba(243,182,95,.4)}.connection-copy{min-width:0;flex:1}.connection-copy h2{margin:0;font-size:18px;line-height:1.2;font-weight:560}.connection-copy>p:last-child{margin:6px 0 0;color:#9a9da7;font-size:12px;line-height:1.5}.mode-badge{flex:0 0 auto;padding:6px 8px;border-radius:999px;background:rgba(148,163,184,.12);color:#bdc4d1;font-size:9px;letter-spacing:.1em;font-weight:650}.secondary-button{display:flex;justify-content:space-between;align-items:center;width:100%;min-height:44px;margin-top:20px;padding:0 14px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:rgba(255,255,255,.06);color:#f5f5f7;font:550 13px -apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;cursor:pointer}.secondary-button:disabled{opacity:.65;cursor:wait}.fineprint{margin:12px 2px 0;color:#777d89;font-size:11px;line-height:1.55}.phase-one{margin-top:22px;padding:18px;border:1px solid rgba(255,255,255,.1);border-radius:20px;background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.018))}.phase-one-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.phase-one-heading h2{margin:0;font-size:22px;font-weight:560;letter-spacing:-.04em}.phase-status{max-width:135px;padding:7px 9px;border:1px solid rgba(231,177,99,.24);border-radius:999px;background:rgba(231,177,99,.08);color:#e4bb7f;text-align:center;font-size:9px;line-height:1.35;letter-spacing:.08em;font-weight:650}.phase-one-summary{margin:14px 0 0;color:#a6a8b1;font-size:12px;line-height:1.65}.finding-list{display:flex;flex-direction:column;gap:8px;margin-top:16px}.finding{padding:13px;border:1px solid rgba(255,255,255,.08);border-radius:13px;background:rgba(0,0,0,.13)}.finding-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.finding-label{font-size:10px;letter-spacing:.1em;font-weight:700;color:#e1e4ec}.finding-state{color:#aeb5c3;font-size:9px;letter-spacing:.05em}.finding-documented{color:#9fc6b3}.finding-blocked{color:#e4bb7f}.finding p{margin:8px 0 0;color:#979ca7;font-size:11px;line-height:1.6}.phase-next{margin-top:18px;padding-top:17px;border-top:1px solid rgba(255,255,255,.09)}.phase-next h3{margin:0;font-size:16px;line-height:1.3;font-weight:560;letter-spacing:-.025em}.phase-next>p:not(.eyebrow){margin:9px 0 0;color:#a6a8b1;font-size:12px;line-height:1.65}.source-links{display:flex;flex-direction:column;gap:10px;margin-top:16px}.source-links a{display:flex;justify-content:space-between;gap:12px;color:#dce3f2;font-size:12px;text-decoration:none}.source-links a:hover{color:#fff}.contact-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:18px}.support-button{display:inline-flex;min-height:39px;align-items:center;justify-content:center;padding:0 13px;border-radius:999px;background:#f1f2f5;color:#15161a;text-decoration:none;font-size:11px;font-weight:650}.support-phone{color:#c8cfdb;text-decoration:none;font-size:11px}.commands,.activity{padding-top:34px}.section-title{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px}.section-title h2{margin:0;font-size:22px;font-weight:560;letter-spacing:-.04em}.command-card{display:flex;align-items:center;gap:12px;padding:16px 12px;margin-bottom:9px;border:1px solid rgba(255,255,255,.095);border-radius:16px;background:rgba(255,255,255,.035)}.command-icon{display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:13px;background:rgba(160,174,200,.09);color:#c4cbd8}.command-icon svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.command-copy{flex:1;min-width:0}.command-copy h3{margin:0 0 5px;font-size:14px;font-weight:560}.command-copy p{margin:0;color:#9a9da7;font-size:11px;line-height:1.4}.inline-note{display:block;margin-top:5px;color:#d5ad72;font-size:10px;line-height:1.35}.command-button{display:flex;align-items:center;justify-content:center;gap:8px;flex:0 0 auto;min-height:36px;padding:0 12px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:#f1f2f5;color:#15161a;font:600 11px -apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;cursor:pointer;transition:transform .15s ease,opacity .15s ease}.command-button:hover{transform:translateY(-1px)}.command-button:active{transform:scale(.97)}.command-button:disabled{opacity:.55;cursor:wait}.mode-note{display:flex;gap:8px;margin:14px 2px 0;color:#8c929e;font-size:11px;line-height:1.5}.activity-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}.empty-activity{margin:0;padding:20px;border:1px dashed rgba(255,255,255,.12);border-radius:14px;text-align:center;color:#747b87;font-size:12px}.activity-row{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.025)}.activity-dot{width:7px;height:7px;flex:0 0 7px;margin-top:5px;border-radius:50%;background:#9ca3af}.activity-row[data-result="blocked"] .activity-dot{background:#e5ad66}.activity-text{flex:1;min-width:0}.activity-title{margin:0;color:#e7e8eb;font-size:12px;font-weight:550}.activity-detail{margin:4px 0 0;color:#838995;font-size:11px;line-height:1.45;overflow-wrap:anywhere}.activity-time{flex:0 0 auto;color:#727987;font-size:10px}.clear-button{padding:5px 0 3px;border:0;background:transparent;color:#8e96a4;font:500 12px -apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;cursor:pointer}.footer{display:flex;justify-content:space-between;gap:12px;margin-top:42px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08);color:#5e6572;font-size:9px;letter-spacing:.1em}.toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));z-index:5;transform:translateX(-50%);width:min(420px,calc(100vw - 28px));padding:13px 15px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(28,30,36,.96);box-shadow:0 12px 40px rgba(0,0,0,.35);color:#f5f5f7;font-size:12px;line-height:1.5}.toast[hidden]{display:none}@media(min-width:560px){.shell{padding-left:30px;padding-right:30px}.intro{padding-top:50px}.connection-card{padding:24px}.command-card{padding:17px}.phase-one{padding:22px}.phase-one-heading h2{font-size:24px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;scroll-behavior:auto!important}}`;

const JS = `(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const connectionTitle = $("#connectionTitle");
  const connectionMessage = $("#connectionMessage");
  const connectionFootnote = $("#connectionFootnote");
  const checkConnectionButton = $("#checkConnection");
  const modeBadge = $("#modeBadge");
  const activityList = $("#activityList");
  const emptyActivity = $("#emptyActivity");
  const toast = $("#toast");
  const labels = { windows_open: "Open windows", windows_close: "Close windows", engine_start: "Remote engine start" };
  let toastTimer = null;

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function setConnectionState(state, message) {
    connectionTitle.textContent = state;
    connectionMessage.textContent = message;
  }

  function addActivity({title, detail, result = "ok"}) {
    emptyActivity.hidden = true;
    const row = document.createElement("li");
    row.className = "activity-row";
    row.dataset.result = result;
    const dot = document.createElement("span");
    dot.className = "activity-dot";
    dot.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    copy.className = "activity-text";
    const heading = document.createElement("p");
    heading.className = "activity-title";
    heading.textContent = title;
    const text = document.createElement("p");
    text.className = "activity-detail";
    text.textContent = detail;
    const time = document.createElement("time");
    time.className = "activity-time";
    time.dateTime = new Date().toISOString();
    time.textContent = new Intl.DateTimeFormat(undefined, {hour:"2-digit", minute:"2-digit"}).format(new Date());
    copy.append(heading, text);
    row.append(dot, copy, time);
    activityList.prepend(row);
  }

  async function readStatus() {
    try {
      const response = await fetch("/api/scorpio-preview/status", {
        credentials: "same-origin", cache: "no-store", headers: {Accept:"application/json"}
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Could not read preview status.");
      modeBadge.textContent = payload.mode === "simulation" ? "SIMULATION" : "LIVE";
      setConnectionState("Not configured", "Adrenox live connector is not configured.");
      connectionFootnote.textContent = payload.message;
    } catch (error) {
      setConnectionState("Status unavailable", error.message || "Could not read preview status.");
      connectionFootnote.textContent = "Refresh after checking your connection and sign-in status.";
    }
  }

  async function checkConnection() {
    checkConnectionButton.disabled = true;
    checkConnectionButton.textContent = "Checking connector readiness…";
    try {
      const response = await fetch("/api/scorpio-preview/connection-test", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: {"Content-Type":"application/json", "Accept":"application/json"},
        body: JSON.stringify({mode:"live"})
      });
      const payload = await response.json();
      setConnectionState("Not connected", payload.message || "A verified connector is not configured.");
      addActivity({
        title: "Adrenox connection check",
        detail: payload.message || "No live request was sent.",
        result: "blocked"
      });
      showToast(payload.commandSent === false ? "No request was sent to Adrenox or the vehicle." : "Connection check finished.");
    } catch (error) {
      setConnectionState("Check failed", error.message || "Could not reach the preview service.");
      addActivity({title:"Adrenox connection check", detail:error.message || "Preview service unavailable.", result:"blocked"});
    } finally {
      checkConnectionButton.disabled = false;
      checkConnectionButton.innerHTML = 'Check Adrenox connection <span aria-hidden="true">↗</span>';
    }
  }

  async function runSimulation(button) {
    const command = button.dataset.command;
    if (!labels[command]) return;
    button.disabled = true;
    button.textContent = "Testing…";
    try {
      const response = await fetch("/api/scorpio-preview/command", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: {"Content-Type":"application/json", "Accept":"application/json"},
        body: JSON.stringify({command, mode:"simulation"})
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "The command test failed.");
      addActivity({title:labels[command], detail:payload.message, result:"ok"});
      showToast("Simulation completed. The car was not contacted.");
    } catch (error) {
      addActivity({title:labels[command], detail:error.message || "Test failed.", result:"blocked"});
      showToast(error.message || "Test failed.");
    } finally {
      button.disabled = false;
      button.innerHTML = 'Run test <span aria-hidden="true">→</span>';
    }
  }

  checkConnectionButton.addEventListener("click", checkConnection);
  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => runSimulation(button));
  });
  $("#clearActivity").addEventListener("click", () => {
    activityList.replaceChildren();
    emptyActivity.hidden = false;
  });
  readStatus();
})();`;

function json(body: Record<string, unknown>, status = 200, method = "GET", extra: Record<string, string> = {}): Response {
  return new Response(method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: secureHeaders("application/json; charset=utf-8", extra),
  });
}

function secureHeaders(contentType: string, extra: Record<string, string> = {}): Headers {
  return new Headers({
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self';",
    "Permissions-Policy": "microphone=(), camera=(), geolocation=(), payment=()",
    ...extra,
  });
}

function pageResponse(request: Request): Response {
  return new Response(request.method === "HEAD" ? null : HTML, {
    status: 200,
    headers: secureHeaders("text/html; charset=utf-8"),
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

function methodNotAllowed(request: Request, allow: string): Response {
  return json({ ok: false, error: "method_not_allowed", message: "Method not allowed." }, 405, request.method, { Allow: allow });
}

export async function handleScorpioPreviewRequest(
  request: Request,
  authorized: boolean,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const rootAlias = path === "/" && url.hostname === ISOLATED_PREVIEW_HOST;
  const isolatedPreviewHost = url.hostname === ISOLATED_PREVIEW_HOST;
  if (!isScorpioPreviewRoute(path) && !rootAlias) return null;

  const pageOrAsset = PAGE_PATHS.has(path) || rootAlias || path === "/scorpio-preview.js" || path === "/scorpio-preview.css";
  // This exact, isolated Workers Preview host is public only for the simulation UI.
  // Its connector is hard-disabled, and no live vehicle call can be made here.
  if (!authorized && !isolatedPreviewHost) {
    if (pageOrAsset && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(null, { status: 302, headers: secureHeaders("text/plain; charset=utf-8", { Location: new URL("/", request.url).toString() }) });
    }
    return json({ ok: false, error: "authentication_required", message: "Sign in to AskMoina first." }, 401, request.method);
  }

  if (PAGE_PATHS.has(path) || rootAlias) {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(request, "GET, HEAD");
    return pageResponse(request);
  }
  if (path === "/scorpio-preview.js" || path === "/scorpio-preview.css") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(request, "GET, HEAD");
    const body = path.endsWith(".js") ? JS : CSS;
    const type = path.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8";
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: secureHeaders(type) });
  }

  if (path === "/api/scorpio-preview/status") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(request, "GET, HEAD");
    return json({
      ok: true,
      feature: "scorpio-n-preview",
      mode: "simulation",
      vehicle: { model: "Mahindra Scorpio-N", modelYear: 2024, fuel: "petrol", transmission: "manual" },
      liveConnector: "not_configured",
      liveCommandsEnabled: false,
      message: "Live Adrenox control is locked: no verified connector or supported API contract is configured. The PDF endpoint examples are unverified; this preview will not contact them.",
    }, 200, request.method);
  }

  if (path === "/api/scorpio-preview/readiness") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(request, "GET, HEAD");
    return json({
      ok: true,
      phase: 1,
      feature: "scorpio-n-integration-readiness",
      status: "vendor_confirmation_required",
      reviewedAt: "2026-10-21",
      vehicle: { model: "Mahindra Scorpio-N", modelYear: 2024, fuel: "petrol", transmission: "manual" },
      publicApiDocsFoundInReviewedSources: false,
      publicApiDocsNote: "No published third-party API contract was located in the official public sources reviewed. This does not establish that a private or partner API does not exist.",
      findings: {
        remoteWindows: "The official owner manual lists Remote Window Up/Down in AdrenoX Connect for equipped configurations; exact vehicle support and third-party API access require confirmation.",
        remoteEngineStart: "The owner manual states remote engine start/stop is available in automatic-transmission vehicles. Do not enable it for this manual vehicle without explicit manufacturer confirmation.",
        authentication: "Official app onboarding describes KYC and OTP; no third-party API authentication flow was documented in the reviewed manual."
      },
      sources: {
        ownerManual: "https://mvault-cloudfront.mahindra.com/2025/08/26/Owners-Manuals/Scorpio-N/Scorpio-N-Owners-Manual.html",
        adrenoxConnect: "https://play.google.com/store/apps/details?id=com.mahindra.adrenox",
        mahindraContact: "https://auto.mahindra.com/contact-us.html?sc_lang=en"
      },
      support: { email: "customercare@mahindra.com", phone: "18002096006" },
      liveCommandsEnabled: false,
      commandSent: false,
      nextStep: "Obtain written confirmation of an authorized API or partner integration path and supported capabilities for this exact vehicle variant. No inquiry has been submitted by AskMoina."
    }, 200, request.method);
  }

  if (path === "/api/scorpio-preview/connection-test") {
    if (request.method !== "POST") return methodNotAllowed(request, "POST");
    if (!sameOrigin(request)) return json({ ok: false, error: "same_origin_required", commandSent: false, message: "Connection test rejected: request must come from this AskMoina origin." }, 403, request.method);
    return json({
      ok: false,
      liveChecked: false,
      commandSent: false,
      code: "connector_not_configured",
      message: "No verified Adrenox connector is configured. I did not submit your Adrenox credentials or contact the unverified API URLs from the architecture document.",
    }, 424, request.method);
  }

  if (path === "/api/scorpio-preview/command") {
    if (request.method !== "POST") return methodNotAllowed(request, "POST");
    if (!sameOrigin(request)) return json({ ok: false, error: "same_origin_required", commandSent: false, message: "Command rejected: request must come from this AskMoina origin." }, 403, request.method);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json", message: "Send a valid JSON command." }, 400, request.method); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid_payload", message: "A command object is required." }, 400, request.method);
    const input = body as Record<string, unknown>;
    const command = input.command;
    const mode = input.mode;
    if (!["windows_open", "windows_close", "engine_start"].includes(String(command))) {
      return json({ ok: false, error: "unsupported_command", commandSent: false, message: "Only the three preview controls are supported." }, 400, request.method);
    }
    if (mode === "live") {
      return json({ ok: false, error: "live_connector_unavailable", commandSent: false, message: "Live vehicle commands are disabled because an authorized, verified connector is not configured. No command was sent." }, 409, request.method);
    }
    if (mode !== "simulation") {
      return json({ ok: false, error: "invalid_mode", commandSent: false, message: "Use simulation mode for this preview." }, 400, request.method);
    }
    const messages: Record<string, string> = {
      windows_open: "Simulation complete: the Open windows request passed validation. No request was sent to Adrenox or the car.",
      windows_close: "Simulation complete: the Close windows request passed validation. No request was sent to Adrenox or the car.",
      engine_start: "Simulation complete: the Engine start request passed validation. No request was sent to Adrenox or the car. Remote start is documented for automatic transmission; this 2024 manual remains simulation-only until exact-variant confirmation.",
    };
    return json({
      ok: true,
      mode: "simulation",
      simulated: true,
      commandSent: false,
      command,
      eventId: crypto.randomUUID(),
      completedAt: new Date().toISOString(),
      message: messages[command as string],
    }, 200, request.method);
  }

  if (path === "/api/scorpio-preview" || path.startsWith("/api/scorpio-preview/")) {
    return json({ ok: false, error: "not_found", message: "Unknown Scorpio preview endpoint." }, 404, request.method);
  }
  return new Response("Not found", { status: 404, headers: secureHeaders("text/plain; charset=utf-8") });
}
