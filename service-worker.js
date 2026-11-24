const V="deadballs-v8",CORE=V+"-core",RUN=V+"-run";
self.addEventListener("install",e=>e.waitUntil(caches.open(CORE).then(c=>c.addAll(["./","./index.html","./service-worker.js"])).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(a=>Promise.all(a.filter(k=>k!==CORE&&k!==RUN).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;const u=new URL(e.request.url);if(u.origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok&&r.type==="basic")caches.open(RUN).then(c=>c.put(e.request,r.clone())).catch(()=>{});return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html"))))});
