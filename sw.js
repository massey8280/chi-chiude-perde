// Chi chiude perde: keeps the game on the phone so it opens (and plays on one phone) without network.
// The page is fetched fresh when the network answers within 3 s, otherwise it comes from the cache.
const CACHE = 'ccp-v4';
const CORE = ['./', 'index.html', 'mqtt.min.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'fonts/overpass-latin-700-normal.woff2', 'fonts/overpass-latin-800-normal.woff2', 'fonts/overpass-latin-900-normal.woff2',
  'fonts/barlow-latin-400-normal.woff2', 'fonts/barlow-latin-500-normal.woff2', 'fonts/barlow-latin-600-normal.woff2', 'fonts/barlow-latin-700-normal.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.endsWith('/ws') || url.pathname.endsWith('/healthz')) return;
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if (isPage) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const net = fetch(req).then(r => { if (r.ok) cache.put('index.html', r.clone()); return r; });
      const timeout = new Promise(res => setTimeout(() => res(null), 3000));
      try {
        const r = await Promise.race([net, timeout]);
        if (r) return r;
      } catch (err) {}
      return (await cache.match('index.html')) || net;
    })());
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
