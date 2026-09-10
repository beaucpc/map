const CACHE_NAME="propertygps-v15";
const APP_ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon.svg"];
const MAP_CACHE="propertygps-map-tiles-v4";
self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME&&k!==MAP_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",e=>{
  const url=new URL(e.request.url);
  if(url.origin==="https://api.maptiler.com"){
    e.respondWith(caches.open(MAP_CACHE).then(cache=>cache.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{if(r.ok)cache.put(e.request,r.clone());return r}).catch(()=>cached))));
    return;
  }
  if(url.origin===self.location.origin){
    e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE_NAME).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html"))));
  }
});
