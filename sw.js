// Network-first service worker (online = fresh, offline = cache)
const CACHE = "sbpm-cache-v11";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event)=>{
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", (event)=>{
  event.respondWith(
    fetch(event.request).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request, copy)).catch(()=>{});
      return res;
    }).catch(()=>{
      return caches.match(event.request);
    })
  );
});
