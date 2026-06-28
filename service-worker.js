// App-shell service worker. Precaches the static shell so the app loads with the
// network disabled after the first visit. User data is never cached here — it
// lives in IndexedDB.

const CACHE = 'repasito-shell-v2';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'src/app.js',
  'src/scheduler.js',
  'src/deck.js',
  'src/storage.js',
  'src/serialize.js',
  'src/prefs.js',
  'src/audio.js',
  'decks/default-deck.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for everything same-origin: always serve fresh code when online
// (so updates are never masked by a stale cache), and fall back to the precached
// shell when offline. The cache is refreshed on every successful fetch.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // For navigations with no cached match, fall back to the app shell.
          if (request.mode === 'navigate') {
            return caches.match('index.html').then((r) => r || caches.match('./'));
          }
          return Response.error();
        })
      )
  );
});
