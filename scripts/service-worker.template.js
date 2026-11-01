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
    event.respondWith(fetch(request).catch(async () => (await caches.match("/index.html")) || (await caches.match("/offline.html")) || Response.error()))
    return
  }
  if (PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)))
  }
})
