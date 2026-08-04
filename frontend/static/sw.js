/*
 * Digital Signage – Service Worker (PWA)
 *
 * - Vorgeladen (precache): Anzeige, Admin-Design, Skripte, Manifest, Icons
 * - Statische Assets: aus dem Cache, werden im Hintergrund aktualisiert
 * - Öffentliche APIs (/api/display, /api/weather): Netzwerk zuerst,
 *   Cache als Offline-Fallback
 * - Medien: Netzwerk zuerst, Cache-Fallback (offline Wiedergabe)
 * - Admin-Bereich (/admin, /dashboard, geschützte APIs): wird NIE
 *   gecacht (Authentifizierung)
 */

"use strict";

const VERSION = "v12";
const CACHE = "anzeige-" + VERSION;

const PRECACHE = [
  "/",
  "/static/manifest.json",
  "/static/css/display.css",
  "/static/css/style.css",
  "/static/css/widgets.css",
  "/static/js/display.js",
  "/static/js/admin.js",
  "/static/js/widgets.js",
  "/static/js/announcement_editor.js",
  "/static/css/announcement_editor.css",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/icons/icon-512-maskable.png",
  "/static/icons/icon-180.png",
];

const PUBLIC_API = ["/api/display", "/api/weather"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("anzeige-") && key !== CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // SSE-Stream niemals anfassen (kein Caching, keine Wiederverbindung durch SW)
  if (path === "/api/events") return;

  // Geschützte Bereiche niemals cachen
  if (
    path.startsWith("/admin") ||
    path === "/dashboard" ||
    (path.startsWith("/api/") && !PUBLIC_API.includes(path))
  ) {
    return;
  }

  // Navigation: Netzwerk zuerst, offline die Startseite
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/"))
    );
    return;
  }

  // Öffentliche APIs: Netzwerk zuerst, Cache-Fallback
  if (PUBLIC_API.includes(path)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Statische Assets: Cache zuerst, im Hintergrund aktualisieren
  if (path.startsWith("/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Medien (Bilder/Videos/Audio): Netzwerk zuerst, Cache-Fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
