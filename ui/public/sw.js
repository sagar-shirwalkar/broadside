/**
 * Minimal offline shell for Broadside.
 *
 * - HTML shell and hashed build assets: cached on first visit, served
 *   cache-first afterwards (offline works).
 * - /api/* and /ws: network-only, never cached (metrics must be fresh).
 *
 * Bump CACHE_VERSION when the build output changes; activation deletes
 * older caches.
 */
const CACHE_VERSION = "broadside-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API traffic is always fresh — never serve it from cache.
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws") return;

  // Navigations (the SPA shell): network-first, fall back to cache.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cacheResponse(request, response);
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Static assets (hashed bundles, favicon, manifest): cache-first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          cacheResponse(request, response);
          return response;
        }),
    ),
  );
});

function cacheResponse(request, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  const copy = response.clone();
  caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
}
