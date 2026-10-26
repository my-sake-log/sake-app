/* The release exporter replaces this marker with a digest of the static app. */
const RELEASE = 'a6209737e548eec233d1';
const BASE = new URL('./', self.location.href);
const PREFIX = `my-sake-log-shell:${encodeURIComponent(BASE.href)}:`;
const CACHE = PREFIX + RELEASE;
const FILES = [
  './', './index.html', './src/app.js', './src/data.js', './src/db.js',
  './src/style.css', './src/pwa.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const ALLOWED = new Set(FILES.map(file => new URL(file, BASE).href));
const staticRequest = url => new Request(url, {
  method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
});
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll([...ALLOWED].map(staticRequest)); }
    catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // No arbitrary requests, query strings, POSTs, or user data reach the network.
  if (event.request.method !== 'GET' || !ALLOWED.has(url.href)) {
    event.respondWith(Promise.resolve(new Response('Request blocked', { status: 403 })));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(url.href);
    if (cached) return cached;
    try {
      const response = await fetch(staticRequest(url.href));
      if (response.ok) await cache.put(url.href, response.clone());
      return response;
    } catch { return new Response('オフライン用のファイルがありません。オンラインで開き直してください。', { status: 503 }); }
  })());
});
