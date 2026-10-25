/**
 * Gyanshala NITS maintenance gate.
 *
 * This Pages Worker intentionally serves only a server-rendered pause screen.
 * It does not forward page requests or API calls to the application Worker.
 */
function maintenanceHtml() {
  const email = "mailto:ashinigogoiofficial@gmail.com?subject=Gyanshala%20Access%20Request&body=Hello%20Admin%2C%0A%0AI%20would%20like%20to%20request%20access%20to%20Gyanshala.%0A%0AThank%20you.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#080b12">
  <title>Gyanshala is temporarily paused</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#080b12;color:#f5f7fb}
    *{box-sizing:border-box}
    html,body{min-height:100%;margin:0}
    body{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 0%,#1b2639 0%,#0c111c 45%,#07090f 100%)}
    .shell{width:min(100%,440px);padding:38px 30px 28px;border:1px solid #293243;border-radius:28px;background:rgba(13,18,29,.96);box-shadow:0 28px 100px rgba(0,0,0,.48);text-align:center}
    .symbol{width:58px;height:58px;margin:0 auto 25px;border:1px solid #39455b;border-radius:19px;display:grid;place-items:center;background:#161d2b;color:#e7edf7}
    .symbol svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .eyebrow{margin:0 0 12px;color:#9da9bd;font-size:11px;letter-spacing:.18em;text-transform:uppercase}
    h1{margin:0 auto 14px;max-width:340px;font-size:clamp(25px,6vw,32px);line-height:1.16;letter-spacing:-.045em;font-weight:600}
    .copy{margin:0 auto 28px;max-width:335px;color:#aab4c5;font-size:14px;line-height:1.7}
    .contact{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:52px;padding:0 18px;border-radius:15px;background:#f4f6fa;color:#101522;font-size:14px;font-weight:650;text-decoration:none;transition:background .15s ease,transform .15s ease}
    .contact:hover{background:#dfe6f1;transform:translateY(-1px)}
    .contact:focus-visible{outline:3px solid #8caeff;outline-offset:3px}
    .contact svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .email{display:block;margin:17px auto 0;color:#aeb9ca;font-size:12px;overflow-wrap:anywhere}
    .foot{margin:31px 0 0;color:#647086;font-size:11px;letter-spacing:.03em}
    @media(max-width:380px){.shell{padding:30px 22px 24px;border-radius:23px}.copy{font-size:13px}}
    @media(prefers-reduced-motion:reduce){.contact{transition:none}.contact:hover{transform:none}}
  </style>
</head>
<body>
  <main class="shell" role="main" aria-labelledby="pause-title">
    <div class="symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v3"></path></svg></div>
    <p class="eyebrow">GYANSHALA · ACCESS RESTRICTED</p>
    <h1 id="pause-title">Gyanshala is temporarily paused</h1>
    <p class="copy">Access is currently restricted. Please contact the administrator to continue using Gyanshala.</p>
    <a class="contact" href="${email}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg>Contact Admin</a>
    <span class="email">ashinigogoiofficial@gmail.com</span>
    <p class="foot">Gyanshala · NIT Silchar</p>
  </main>
</body>
</html>`;
}

function isApiRequest(request) {
  return new URL(request.url).pathname === "/api" || new URL(request.url).pathname.startsWith("/api/");
}

export default {
  async fetch(request) {
    const headers = new Headers({
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY"
    });
    if (isApiRequest(request) || (request.method !== "GET" && request.method !== "HEAD")) {
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(request.method === "HEAD" ? null : JSON.stringify({
        ok: false,
        error: "GYANSHALA_PAUSED",
        message: "Gyanshala is temporarily paused. Contact the administrator to continue using it.",
        contact: "ashinigogoiofficial@gmail.com"
      }), { status: 503, headers });
    }
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    return new Response(request.method === "HEAD" ? null : maintenanceHtml(), { status: 503, headers });
  }
};