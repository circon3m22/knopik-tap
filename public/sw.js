const CACHE_NAME = "knopik-tap-v48";
const BASE_PATH = new URL("./", self.location.href).pathname.replace(/\/$/, "");
const asset = (path) => `${BASE_PATH}${path}`;
const APP_SHELL = [
  asset("/"),
  asset("/manifest.webmanifest"),
  asset("/apple-touch-icon-v2.png"),
  asset("/icon-192-v2.png"),
  asset("/icon-512-v2.png"),
  asset("/knopik-joy-sprite-earless.png"),
  asset("/knopik-rage-sprite-earless.png"),
  asset("/knopik-ear-left.png"),
  asset("/knopik-ear-right.png"),
  asset("/knopik-warning-earless.png"),
  asset("/knopik-mohawk-v2.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(asset("/"), copy));
          return response;
        })
        .catch(() => caches.match(asset("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
