/*
 * Secure Vault — Credential Intake Portal
 * Service Worker
 *
 * Responsibilities:
 *   1. Pre-cache the static app shell (HTML/CSS/JS/icons/fonts) on install
 *      so the UI loads instantly and works offline.
 *   2. Serve cached shell assets cache-first, falling back to network.
 *   3. NEVER intercept or cache POST requests (the credential submission
 *      to the n8n webhook). Those always go straight to the network.
 *
 * This file is intentionally dependency-free vanilla JS.
 */

const CACHE_VERSION = 'secure-vault-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

// ---- INSTALL: pre-cache the app shell ----------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // addAll fails the whole install if any request 404s, so we add
      // resiliently one-by-one instead.
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[sw] Skipped caching (not fatal):', url, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// ---- ACTIVATE: clean up old cache versions -----------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ---- FETCH: cache-first for the shell, network-only for everything else
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // CRITICAL SECURITY RULE:
  // Never intercept, cache, or replay non-GET requests. This guarantees
  // the credential submission (POST to the n8n webhook) always hits the
  // live network and is never stored by the Service Worker cache layer.
  if (request.method !== 'GET') {
    return; // Let the browser handle it natively.
  }

  // Don't try to cache cross-origin API/webhook-style calls even if they
  // were ever issued as GET — only cache same-origin app-shell assets and
  // well-known static CDN assets used purely for styling/fonts.
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isStaticCdn =
    url.hostname === 'cdn.tailwindcss.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';

  if (!isSameOrigin && !isStaticCdn) {
    return; // Not part of the app shell — go straight to network.
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          // Only cache valid, basic/opaque responses.
          if (response && (response.status === 200 || response.type === 'opaque')) {
            const responseClone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => cached); // Offline fallback to cache if network fails.

      // Cache-first: return cached immediately if we have it, otherwise
      // wait on the network.
      return cached || networkFetch;
    })
  );
});
