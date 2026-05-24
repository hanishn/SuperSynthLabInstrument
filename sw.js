// Service Worker for Super Synth Lab Instrument (E-03)
// Cache-first strategy for offline use after first load.

// CACHE_VERSION is auto-bumped by build_exhibit.py on every build so that
// installed service workers invalidate stale caches and pick up new code.
var CACHE_VERSION = 'ssli-cache-v1.10.1136';
var CACHED_URLS = [
  './',
  './SuperSynthLabInstrument.html'
];

// Install: pre-cache the standalone HTML
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(CACHED_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(name) {
          return name !== CACHE_VERSION;
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(function(networkResponse) {
        // Cache successful GET responses for future offline use
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          var responseToCache = networkResponse.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
