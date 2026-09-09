const CACHE_NAME = "propertygps-v4";
const APP_ASSETS = ["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(APP_ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if(new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)); return r; }).catch(()=>caches.match(e.request).then(r=>r || caches.match("./index.html"))));
});
