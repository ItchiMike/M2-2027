/* Service worker : garde l'application disponible hors connexion.
   Changez le numéro de version quand vous mettez à jour les fichiers. */
const V = "m2-2027-v6";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest", "logo-mask.png", "icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !fonts) return; // l'API Google n'est jamais mise en cache
  if (fonts) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(req, c)); return r; })));
    return;
  }
  // Fichiers de l'application : réseau d'abord, copie locale si hors connexion
  e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(req, c)); return r; })
    .catch(() => caches.match(req).then(hit => hit || caches.match("index.html"))));
});
