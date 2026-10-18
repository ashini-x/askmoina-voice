const CACHE_NAME = "askmoina-pwa-shell-v9";
const SHELL_URLS = [
  "/install",
  "/install.css",
  "/askmoina-liquid-intelligence-orb-v1-smoky-core.webp?v=0.4.122",
  "/offline",
  "/manifest.webmanifest?v=20261018",
  "/favicon.svg?v=0.4.83",
  "/favicon-32.png?v=0.4.83",
  "/askmoina-app-icon-180.png?v=0.4.83",
  "/askmoina-mark.svg?v=0.4.83",
  "/askmoina-mark-dark.svg?v=0.4.83",
  "/askmoina-app-icon.svg?v=0.4.83",
  "/askmoina-app-icon-light.svg?v=0.4.83",
  "/askmoina-logo.svg?v=0.4.83",
  "/askmoina-logo-dark.svg?v=0.4.83",
  "/askmoina-social-avatar.svg?v=0.4.83",
  "/askmoina-visual-guide.svg?v=0.4.83",
  "/pwa-icon-192.svg?v=0.4.83",
  "/pwa-icon-512.svg?v=0.4.83",
  "/pwa-icon-512.png?v=0.4.83",
  "/pwa-gate.css",
  "/pwa-gate.js",
  "/pwa-runtime.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("askmoina-pwa-shell-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated APIs or anything on the live voice route.
  if (url.pathname.startsWith("/api/") || url.pathname === "/service-worker.js") return;

  const isAppCodeOrDocument =
    request.mode === "navigate" ||
    /\.(?:html|js|css|webmanifest)$/i.test(url.pathname);

  if (!isAppCodeOrDocument) return;

  // Unversioned HTML and app code always revalidate against the deployed Worker.
  // Release-versioned resources can use the browser HTTP cache: APP_VERSION is
  // part of the URL, so a deployment creates a fresh cache key automatically.
  const isImmutableVersionedAsset = /^[0-9]+\.[0-9]+\.[0-9]+$/.test(url.searchParams.get("v") || "");
  event.respondWith(
    (isImmutableVersionedAsset ? fetch(request) : fetch(request, { cache: "no-store" })).catch(async () => {
      if (request.mode !== "navigate") return Response.error();
      const offline = await caches.match("/offline");
      return offline || new Response(
        "<!doctype html><html lang=\"en\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>AskMoina offline</title><p>AskMoina needs an internet connection for its live camera and voice experience.</p><a href=\"/\">Try again</a></html>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
      );
    })
  );
});
