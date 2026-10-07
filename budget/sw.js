const CACHE_NAME = 'mon-budget-v3';
const ASSETS = [
  './',
  './index.html',
  './verifier-email.html',
  './css/style.css',
  './js/app.js',
  './js/account.js',
  './js/api.js',
  './js/backup.js',
  './js/biometric.js',
  './js/charts.js',
  './js/crypto.js',
  './js/modals.js',
  './js/model.js',
  './js/password-policy.js',
  './js/storage.js',
  './js/store.js',
  './js/sync.js',
  './js/ui.js',
  './js/verify-email.js',
  './js/views.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // API responses carry session state and encrypted payloads: they must never be
  // served from cache, or a device could sync against a stale vault version.
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
