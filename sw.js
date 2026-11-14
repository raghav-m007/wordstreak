// Offline shell. Bump CACHE whenever the app's own files change.
const CACHE = 'ws-v1';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/srs.js',
  './words.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

function networkFirst(request, key) {
  return fetch(request)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key || request, copy));
      }
      return res;
    })
    .catch(() => caches.match(key || request, { ignoreSearch: true }));
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      })),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  // The word list and the page itself: always try for the latest.
  if (url.pathname.endsWith('/words.json')) { e.respondWith(networkFirst(request, './words.json')); return; }
  if (request.mode === 'navigate') { e.respondWith(networkFirst(request, './index.html')); return; }

  // Everything else: cache first, refresh in the background.
  e.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
