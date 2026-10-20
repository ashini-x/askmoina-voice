const CACHE = "gyanshala-shell-v6";
const SHELL = [
  "/gyanshala-demo/",
  "/gyanshala-demo/styles.css",
  "/gyanshala-demo/app.js",
  "/gyanshala-demo/manifest.webmanifest",
  "/gyanshala-demo/icon.svg"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("gyanshala-shell-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (!url.pathname.startsWith("/gyanshala-demo/")) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && request.destination !== "document") {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request).then(response => response || (request.mode === "navigate" ? caches.match("/gyanshala-demo/") : Response.error()))));
});
