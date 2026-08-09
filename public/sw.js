const SHELL_CACHE = 'pgmaps-shell-v3'
const DATA_CACHE = 'pgmaps-data-v1'
const CACHE_NAMES = new Set([SHELL_CACHE, DATA_CACHE])
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '')

function withScope(pathname) {
  return `${SCOPE_PATH}${pathname}` || '/'
}

const PRECACHE_URLS = [withScope('/'), withScope('/index.html')]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('pgmaps-') && !CACHE_NAMES.has(key)).map((key) => caches.delete(key)),
        ),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only cache same-origin GET requests
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return

  const url = new URL(request.url)
  const pathname =
    SCOPE_PATH && url.pathname.startsWith(SCOPE_PATH) ? url.pathname.slice(SCOPE_PATH.length) || '/' : url.pathname

  // The update plugin already adds a timestamp, but this explicit network-only
  // rule prevents a future cache-policy change from breaking version checks.
  if (pathname === '/pluginWebUpdateNotice/web_version_by_plugin.json') {
    event.respondWith(fetch(request, { cache: 'no-store' }))
    return
  }

  // Network-first for HTML (SPA navigation)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok) event.waitUntil(putResponse(SHELL_CACHE, request, response))
          return response
        })
        .catch(() => caches.match(withScope('/index.html'))),
    )
    return
  }

  // The project index must see additions and removals immediately. Cache its
  // successful response under the canonical URL only as an offline fallback.
  if (pathname === '/data/projects/index.json') {
    const canonicalRequest = new Request(`${url.origin}${url.pathname}`)
    event.respondWith(networkFirst(request, DATA_CACHE, canonicalRequest, 'no-store'))
    return
  }

  // Project definitions are content-revisioned by the generated index.
  if (pathname.startsWith('/data/projects/') && url.searchParams.has('v')) {
    event.respondWith(cacheFirst(request, DATA_CACHE))
    return
  }

  // Manifests and catalogs are mutable pointers to data snapshots.
  if (/\/(manifest|index|catalog|metadata)\.json$/.test(pathname)) {
    event.respondWith(networkFirst(request, DATA_CACHE, request, 'no-cache'))
    return
  }

  // Vite build assets have content hashes in their filenames.
  if (pathname.startsWith('/assets/') && /\.(js|css)$/.test(pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE))
    return
  }

  // Other same-origin assets and data can render from cache immediately, then
  // refresh in the background for the next view.
  if (/\.(js|css|png|jpe?g|svg|webp|woff2?|json|geojson|csv)$/.test(pathname)) {
    event.respondWith(staleWhileRevalidate(event, request, DATA_CACHE))
  }
})

async function putResponse(cacheName, request, response) {
  if (!response.ok) return
  const cache = await caches.open(cacheName)
  await cache.put(request, response.clone())
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  await putResponse(cacheName, request, response)
  return response
}

async function networkFirst(request, cacheName, cacheKey = request, cacheMode = 'no-cache') {
  try {
    const response = await fetch(request, { cache: cacheMode })
    await putResponse(cacheName, cacheKey, response)
    return response
  } catch (error) {
    const cached = await caches.match(cacheKey)
    if (cached) return cached
    throw error
  }
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cached = await caches.match(request)
  const network = fetch(request).then(async (response) => {
    await putResponse(cacheName, request, response)
    return response
  })

  if (cached) {
    event.waitUntil(network.catch(() => undefined))
    return cached
  }
  return network
}
