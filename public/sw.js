// Service worker : coquille en cache (stale-while-revalidate), données réseau d'abord avec repli hors ligne
const V = 'pilotage-v9';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icons/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/mcp') || url.pathname.startsWith('/files/')) return;
  if (url.pathname === '/api/bootstrap') {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((ca) => ca.put(req, c)); } return r; })
      .catch(() => caches.match(req)));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok && (url.origin === location.origin || r.type === 'cors')) { const c = r.clone(); caches.open(V).then((ca) => ca.put(req, c)); } return r; }).catch(() => hit || caches.match('/index.html'));
    return hit || net;
  }));
});
