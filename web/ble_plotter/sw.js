const CACHE = "rowpod-1.5.6";
const ASSETS = [
  "./index.html",
  "./rowpod.html",
  "./rowpod.js",
  "./rowpod.css",
  "./protocol.js",
  "./ble_client.js",
  "./pod_registry.js",
  "./outlier_filter.js",
  "./timebase.js",
  "./rowing_angle.js",
  "./rowing_crew.js",
  "./rowing_fan.js",
  "./rowing_length.js",
  "./boat_rig.js",
  "./version.js",
  "./overtec-mark.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
