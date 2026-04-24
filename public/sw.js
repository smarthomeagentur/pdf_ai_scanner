const CACHE_NAME = "scanner-pwa-v1";

// Install event: skip waiting so the new SW activates immediately
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Activate event: claim clients so the SW controls the current page immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// Fetch event: Simple network-first strategy, falling back to cache if offline (optional, just needed to satisfy PWA install requirements in many browsers)
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch((err) => {
      // Can be expanded to cache offline files
      console.log("Resource fetch failed (offline mode)", err);
    })
  );
});
