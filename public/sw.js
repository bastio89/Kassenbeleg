// Minimaler Service Worker: macht die App installierbar. Daten kommen immer live vom Server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
