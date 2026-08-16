/* War Era · News Desk — service worker */
const VERSION = "v1";
const SHELL_CACHE = `newsdesk-shell-${VERSION}`;
const RUNTIME_CACHE = `newsdesk-runtime-${VERSION}`;

// Hosts whose resources are safe to cache for offline use. API hosts are
// intentionally excluded — live data must always go to the network.
const CACHEABLE_HOSTS = new Set([
  self.location.host,
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "flagcdn.com",
]);

const isCacheable = (url) => CACHEABLE_HOSTS.has(url.hostname);
const isNavigate = (req) => req.mode === "navigate";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.add("./"))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache or intercept API calls — always hit the network.
  if (!isCacheable(url)) return;

  // Navigation: network-first, fall back to cached app shell for offline.
  if (isNavigate(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("./", clone));
          return response;
        })
        .catch(async () => (await caches.match("./")) || Response.error())
    );
    return;
  }

  // Static assets: cache-first with background revalidation (stale-while-revalidate).
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
