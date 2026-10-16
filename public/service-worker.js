const CACHE_NAME = "askmoina-pwa-shell-v1";
const SHELL_URLS = [
  "/install.html",
  "/install.css",
  "/offline.html",
  "/manifest.webmanifest",
  "/askmoina-bird-final.png",
  "/pwa-icon-192.svg",
  "/pwa-icon-512.svg",
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

  // The installed app always revalidates HTML, JavaScript, CSS and its
  // manifest against the deployed Worker. Only the install/offline shell is
  // precached; live app code is never served from a stale service-worker cache.
  event.respondWith(
    fetch(request, { cache: "no-store" }).catch(async () => {
      if (request.mode !== "navigate") return Response.error();
      const offline = await caches.match("/offline.html");
      return offline || new Response(
        "<!doctype html><html lang=\"en\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>AskMoina offline</title><p>AskMoina needs an internet connection for its live camera and voice experience.</p><a href=\"/\">Try again</a></html>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
      );
    })
  );
});
