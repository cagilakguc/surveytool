/* Generated after build. Cache only versioned public application assets. */
const CACHE_PREFIX = "surveytool-shell-"
const CACHE_NAME = CACHE_PREFIX + "__CACHE_VERSION__"
const PRECACHE_URLS = __PRECACHE_URLS__
const PRECACHE_PATHS = new Set(PRECACHE_URLS.map((value) => new URL(value, self.location.origin).pathname))
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)))
})
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  )
})
self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response=>{if(!response.ok)throw new Error("Navigation unavailable");return response}).catch(async () => {
      const cache=await caches.open(CACHE_NAME)
      return (await cache.match("/index.html")) || (await cache.match("/offline.html")) || Response.error()
    }))
    return
  }
  if (PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(caches.open(CACHE_NAME).then(cache=>cache.match(request,{ignoreSearch:true})).then((cached) => cached || fetch(request)))
  }
})
self.addEventListener("message",event=>{
  if(event.data?.type!=="SURVEYTOOL_OFFLINE_STATUS"||!event.ports?.[0])return
  event.waitUntil(caches.open(CACHE_NAME).then(async cache=>{
    const responses=await Promise.all(PRECACHE_URLS.map(url=>cache.match(url)))
    event.ports[0].postMessage({ready:responses.every(Boolean)})
  }).catch(()=>event.ports[0].postMessage({ready:false})))
})
