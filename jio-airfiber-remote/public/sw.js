"use strict";

const CACHE_NAME = "airfiber-remote-shell-v1";
const APP_SHELL = ["./", "./index.html", "./manifest.json", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const base = self.registration.scope;
    await cache.addAll(APP_SHELL.map(path => new URL(path, base).href));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("airfiber-remote-") && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cache-first for the app shell: the remote UI can open without internet.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      } catch (_) {
        if (request.mode === "navigate") {
          return (await cache.match(new URL("./index.html", self.registration.scope).href)) ||
            new Response("AirFiber Remote is offline. Reconnect once to cache the app shell.", {
              status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
            });
        }
        return new Response("", { status: 504, statusText: "Offline" });
      }
    })());
    return;
  }

  // Tailwind is a presentation enhancement. Cache it opportunistically; embedded
  // fallback styles in index.html keep the controls legible when the CDN is offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (_) {
      return cached || new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});