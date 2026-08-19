const CACHE_NAME = "scanner-cache-v5";
const ONNX_ASSETS = [
  "/models/doc_corner_net.onnx",
  "/vendor/onnx/ort.min.js",
  "/vendor/onnx/ort-wasm-simd-threaded.wasm",
  "/vendor/onnx/ort-wasm-simd-threaded.mjs",
];

// Install event: Pre-caching für schnellen Sofort-Start ohne Download
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pre-caching ONNX Modell und WASM...");
      return cache.addAll(ONNX_ASSETS).catch((e) => {
        console.warn("[SW] Pre-caching Warnung:", e);
      });
    })
  );
});

// Activate event: Veraltete Caches bereinigen
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => clients.claim())
  );
});

// Fetch event: Cache-First für ONNX/WASM (bleibt dauerhaft lokal gespeichert)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/models/") || url.pathname.startsWith("/vendor/onnx/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const respClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, respClone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Fallback für alle anderen Requests
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return new Response("Offline (Netzwerkfehler)", {
          status: 503,
          statusText: "Service Unavailable",
        });
      });
    })
  );
});
