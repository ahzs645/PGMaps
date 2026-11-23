const SHELL_CACHE = 'pgmaps-shell-v3'
const DATA_CACHE = 'pgmaps-data-v1'
const TILE_CACHE = 'pgmaps-tiles-v1'
const STATE_CACHE = 'pgmaps-offline-state-v1'
const CACHE_NAMES = new Set([SHELL_CACHE, DATA_CACHE, TILE_CACHE, STATE_CACHE])
// The caches this worker writes, by the part of their name before the version. Other code keeps
// caches under `pgmaps-` too (terrain tiles, the photo depth models): deleting by that prefix alone
// threw them away each time this file changed.
const OWNED_FAMILIES = ['pgmaps-shell-', 'pgmaps-data-', 'pgmaps-tiles-', 'pgmaps-offline-state-']
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '')
// Origins serving data folders moved off this site (src/config/data-hosts.json).
// main.tsx passes them in the registration URL, so their files get the same
// cache rules as /data on this site.
const DATA_ORIGINS = new Set(
  (new URLSearchParams(self.location.search || '').get('dataOrigins') || '').split(',').filter(Boolean),
)

const DAY_MS = 24 * 60 * 60 * 1000
/**
 * Third-party map tiles kept after they are viewed, so a map already looked at draws offline.
 * A copy younger than `maxAgeMs` is served without asking; an older one is refreshed when the
 * network answers and served as it is when it does not. Add a host only when its terms allow
 * keeping tiles: Esri World Imagery does not (`exportTilesAllowed: false`), so it is not here.
 */
const TILE_HOSTS = [
  // AWS Terrain Tiles (open data): the ground the forestry tools compute from, and MapLibre's
  // 3D terrain, hillshade and contours. S3 sends no Cache-Control for them.
  {
    maxAgeMs: 90 * DAY_MS,
    matches: (url) => url.hostname === 's3.amazonaws.com' && url.pathname.startsWith('/elevation-tiles-prod/'),
  },
  // The CARTO basemap: style, sprite, glyphs and vector tiles.
  { maxAgeMs: 7 * DAY_MS, matches: (url) => /(^|\.)cartocdn\.com$/.test(url.hostname) },
]
const CACHED_AT_HEADER = 'x-pgmaps-cached-at'
// Entry counts, oldest out first. Tiles run 20-100 KB, so 4,000 is a few hundred megabytes at most.
const MAX_TILE_ENTRIES = 4000
const MAX_DATA_ENTRIES = 1500
const TRIM_EVERY_WRITES = 40
// A built file no current list names is kept this long for a tab still running an older build.
const STALE_ASSET_MS = 30 * DAY_MS
const PRECACHE_LANES = 4
// Past this share of the browser's allowance, tiles and data files give way: they can be fetched
// again, and the projects and photos kept in IndexedDB beside them cannot.
const STORAGE_PRESSURE_SHARE = 0.8
const PRESSURE_KEEP_SHARE = 0.25

function withScope(pathname) {
  return `${SCOPE_PATH}${pathname}` || '/'
}

const PRECACHE_URLS = [withScope('/'), withScope('/index.html')]
const MANIFEST_URL = withScope('/offline-precache.json')
const STATE_MANIFEST_KEY = withScope('/__offline/manifest')
const STATE_GROUPS_KEY = withScope('/__offline/groups')
const STATE_BUILD_KEY = withScope('/__offline/build')

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
          keys
            .filter((key) => !CACHE_NAMES.has(key) && OWNED_FAMILIES.some((family) => key.startsWith(family)))
            .map((key) => caches.delete(key)),
        ),
      )
      // The first visit loaded the shell before this worker could see it: fetch it again (the HTTP
      // cache answers) so one visit is enough to open the site offline. Tools asked for earlier
      // are topped up for the build now deployed.
      .then(() => keepOffline([], false))
      .then(() => Promise.all([trimCache(TILE_CACHE, MAX_TILE_ENTRIES), trimCache(DATA_CACHE, MAX_DATA_ENTRIES)]))
      .then(() => relieveStorage(false))
      .catch(() => undefined),
  )
  self.clients.claim()
})

// A page asks for a tool to be kept offline (`src/lib/offline/offlineTools.ts`), or for what is held.
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'pgmaps-offline') return
  const reply = (message) => {
    const port = event.ports && event.ports[0]
    if (port) port.postMessage(message)
  }
  const list = (value) => (Array.isArray(value) ? value : [])
  event.waitUntil(
    keepOffline(list(data.groups), data.statusOnly === true, list(data.forget))
      .then(async (status) => {
        // Every page load passes through here: the one place storage is checked without a write.
        if (data.statusOnly !== true) await relieveStorage(false)
        return status
      })
      .then(reply, (error) => reply({ error: String(error) })),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only cache GET requests to this site, a configured data host or a listed tile host
  if (request.method !== 'GET') return
  // A partial response cannot be stored, and a stored whole one must not answer a range request.
  if (request.headers && request.headers.has && request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin && !DATA_ORIGINS.has(url.origin)) {
    const host = TILE_HOSTS.find((entry) => entry.matches(url))
    if (host) event.respondWith(keptTile(event, request, host.maxAgeMs))
    return
  }

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
    event.respondWith(cacheFirst(event, request, DATA_CACHE))
    return
  }

  // Manifests and catalogs are mutable pointers to data snapshots. A tool's workspace layouts
  // (the road designer's, visual quality's) are a deploy-time configuration file: a changed file
  // must take effect on the next load, so it never renders from cache while the network answers.
  if (
    /\/(manifest|index|catalog|metadata)\.json$/.test(pathname) ||
    pathname === '/workspace-layouts.json' ||
    pathname === '/block-planning-layouts.json' ||
    pathname === '/visuals-layouts.json'
  ) {
    event.respondWith(networkFirst(request, DATA_CACHE, request, 'no-cache'))
    return
  }

  // Everything Vite emits under /assets/ has a content hash in its filename: scripts and styles,
  // and also the MapLibre worker (.mjs), WebAssembly, fonts and bundled data. Matching only .js and
  // .css left the map worker out, so no map could start offline.
  if (pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event, request, SHELL_CACHE))
    return
  }

  // Other same-origin assets and data can render from cache immediately, then
  // refresh in the background for the next view.
  // GeoTIFFs too: a road project on the published LiDAR terrain reads that file again each time
  // it is opened. One read in ranges (a COG) is left to the browser by the range rule above.
  if (/\.(js|css|png|jpe?g|svg|webp|woff2?|json|geojson|csv|tiff?)$/.test(pathname)) {
    event.respondWith(staleWhileRevalidate(event, request, DATA_CACHE))
  }
})

async function putResponse(cacheName, request, response) {
  if (!response.ok) return
  // Navigation returns the original response while this write runs in the
  // background. Clone before yielding so the browser cannot consume it first.
  const cachedResponse = response.clone()
  try {
    const cache = await caches.open(cacheName)
    await cache.put(request, cachedResponse)
  } catch (error) {
    // Keeping a copy is optional. A write that fails (no room, storage shut) must never fail the
    // request it was copying: before this, a full disk turned a good response into an error.
    if (refusedForRoom(error)) await relieveStorage(true)
    return
  }
  if (cacheName === DATA_CACHE) await countWrite(DATA_CACHE, MAX_DATA_ENTRIES)
}

const writes = new Map()

/** Trim a cache every few writes: listing its keys on each one would cost more than the write. */
async function countWrite(cacheName, limit) {
  const count = (writes.get(cacheName) || 0) + 1
  writes.set(cacheName, count)
  if (count % TRIM_EVERY_WRITES === 0) await trimCache(cacheName, limit)
}

/**
 * Give up most of the tiles and data files when the site is near the browser's allowance, or at
 * once (`force`) when a write has just been refused for lack of room.
 */
async function relieveStorage(force) {
  try {
    if (!force) {
      if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) return false
      const { usage, quota } = await navigator.storage.estimate()
      if (!quota || !(usage / quota >= STORAGE_PRESSURE_SHARE)) return false
    }
    await trimCache(TILE_CACHE, Math.floor(MAX_TILE_ENTRIES * PRESSURE_KEEP_SHARE))
    await trimCache(DATA_CACHE, Math.floor(MAX_DATA_ENTRIES * PRESSURE_KEEP_SHARE))
    return true
  } catch {
    return false
  }
}

const refusedForRoom = (error) => !!error && error.name === 'QuotaExceededError'

/** Keep the newest `limit` entries. Cache Storage lists keys in the order they were written. */
async function trimCache(cacheName, limit) {
  try {
    const cache = await caches.open(cacheName)
    const keys = await cache.keys()
    for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key)
  } catch {
    // Trimming is housekeeping: a failure must not fail the request that triggered it.
  }
}

/**
 * A third-party tile: the kept copy while it is fresh, else the network, else the kept copy
 * however old. Only a readable 200 is kept: an opaque response is charged megabytes of quota
 * each, and a partial one is not the tile.
 */
async function keptTile(event, request, maxAgeMs) {
  const cache = await caches.open(TILE_CACHE)
  const kept = await cache.match(request)
  if (kept && Date.now() - Number(kept.headers.get(CACHED_AT_HEADER) || 0) <= maxAgeMs) return kept
  try {
    const response = await fetch(request)
    if (response.status !== 200 || response.type === 'opaque') return kept || response
    const copy = response.clone()
    const headers = new Headers(copy.headers)
    headers.set(CACHED_AT_HEADER, String(Date.now()))
    event.waitUntil(
      cache
        .put(request, new Response(copy.body, { status: 200, statusText: copy.statusText, headers }))
        .then(() => countWrite(TILE_CACHE, MAX_TILE_ENTRIES))
        .catch((error) => (refusedForRoom(error) ? relieveStorage(true) : undefined)),
    )
    return response
  } catch (error) {
    // Offline. The terrain loader keeps its own validated tiles in another cache: use one of those
    // before failing.
    const fallback = kept || (await caches.match(request))
    if (fallback) return fallback
    throw error
  }
}

function absolute(file) {
  return new URL(withScope(`/${file}`), self.location.origin).href
}

async function readJson(cacheName, key) {
  try {
    const stored = await (await caches.open(cacheName)).match(key)
    return stored ? await stored.json() : null
  } catch {
    return null
  }
}

async function writeJson(cacheName, key, value) {
  const cache = await caches.open(cacheName)
  await cache.put(key, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }))
}

/** The build's file lists: the deployed one when the network answers, else the last one read. */
async function precacheManifest() {
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'no-cache' })
    if (response.ok) {
      const manifest = await response.json()
      if (manifest && manifest.version === 1 && Array.isArray(manifest.shell) && manifest.groups) {
        await writeJson(STATE_CACHE, STATE_MANIFEST_KEY, manifest)
        return { manifest, deployed: true }
      }
    }
  } catch {
    // Offline, or a build without the file (the dev server): fall back to what was read before.
  }
  return { manifest: await readJson(STATE_CACHE, STATE_MANIFEST_KEY), deployed: false }
}

/**
 * Hold the shell and every tool asked for, now or on an earlier visit, in Cache Storage, and
 * report what is held. With `statusOnly` nothing is fetched. A tool stays asked for until it is
 * named in `forget` or the site's storage is cleared, so a new build is fetched for it without the
 * tool being opened. Forgetting a tool removes the files only it needed.
 */
async function keepOffline(requested, statusOnly, forget = []) {
  const { manifest, deployed } = await precacheManifest()
  if (!manifest) return { build: null, deployed: false, shell: null, groups: {} }

  const stored = await readJson(STATE_CACHE, STATE_GROUPS_KEY)
  const kept = new Set((Array.isArray(stored) ? stored : []).filter((id) => manifest.groups[id]))
  const before = [...kept].sort().join()
  if (!statusOnly) for (const id of requested) if (manifest.groups[id]) kept.add(id)
  const forgotten = forget.filter((id) => kept.delete(id))
  if ([...kept].sort().join() !== before) await writeJson(STATE_CACHE, STATE_GROUPS_KEY, [...kept])

  const everyFile = (group) => [...group.files, ...(group.extras || [])]
  const lists = { shell: manifest.shell }
  for (const id of kept) lists[id] = manifest.groups[id].files
  for (const id of requested) if (manifest.groups[id] && !lists[id]) lists[id] = manifest.groups[id].files

  const wanted = new Set()
  for (const id of ['shell', ...kept]) for (const file of lists[id]) wanted.add(file)
  // Files from public/ have no hash in their name: the copy held may be an earlier build's, so
  // each is fetched again when the build's id changes. They go where their own fetch rule keeps
  // them, so a page reading one later overwrites the same entry.
  const extras = new Set(manifest.shellExtras || [])
  for (const id of kept) for (const file of manifest.groups[id].extras || []) extras.add(file)
  const lastBuild = await readJson(STATE_CACHE, STATE_BUILD_KEY)
  const refreshExtras = !statusOnly && deployed && lastBuild !== manifest.build

  const held = new Set()
  let missed = false
  const cache = await caches.open(SHELL_CACHE)
  const data = await caches.open(DATA_CACHE)
  for (const id of forgotten) {
    const group = manifest.groups[id]
    // A file the shell or a tool still kept also needs stays.
    for (const file of group.files) if (!wanted.has(file)) await cache.delete(absolute(file)).catch(() => false)
    for (const file of group.extras || []) if (!extras.has(file)) await data.delete(absolute(file)).catch(() => false)
  }
  const pending = [...wanted, ...extras]
  const lane = async () => {
    while (pending.length) {
      const file = pending.pop()
      const url = absolute(file)
      const extra = extras.has(file)
      try {
        const stored = await caches.match(url, ANY_VARIANT)
        if (stored && !(extra && refreshExtras)) held.add(file)
        else if (!statusOnly) {
          const response = await fetch(url, extra ? { cache: 'no-cache' } : undefined)
          if (response.status === 200) {
            await (extra ? data : cache).put(url, response)
            held.add(file)
          } else {
            missed = true
            if (stored) held.add(file)
          }
        }
      } catch {
        // An earlier copy still counts as held, but the build is not done: the next visit asks again.
        missed = true
        if (extra && (await caches.match(url, ANY_VARIANT).catch(() => undefined))) held.add(file)
      }
    }
  }
  await Promise.all(Array.from({ length: PRECACHE_LANES }, lane))
  if (!statusOnly && deployed) {
    if (!missed) await writeJson(STATE_CACHE, STATE_BUILD_KEY, manifest.build)
    // The page that names these files, read with them: the offline fallback must not be the page
    // from the day this worker was installed, naming a build whose files are gone.
    await refreshShellPage(cache)
    // A list fetched from the network names the deployed build, so older files can be told apart.
    await dropStaleAssets(cache, wanted)
  }

  const report = (files) => ({ files: files.length, held: files.filter((file) => held.has(file)).length })
  const groups = {}
  for (const id of Object.keys(lists)) {
    if (id === 'shell') continue
    const all = everyFile(manifest.groups[id])
    let heldCount = 0
    if (kept.has(id)) heldCount = report(all).held
    else for (const file of all) if (await caches.match(absolute(file), ANY_VARIANT)) heldCount++
    groups[id] = {
      kept: kept.has(id),
      files: all.length,
      held: heldCount,
      bytes: manifest.groups[id].bytes,
      deferred: manifest.groups[id].deferred || [],
    }
  }
  return {
    build: manifest.build,
    deployed,
    shell: report([...manifest.shell, ...(manifest.shellExtras || [])]),
    groups,
  }
}

async function refreshShellPage(cache) {
  try {
    const response = await fetch(withScope('/index.html'), { cache: 'no-cache' })
    if (response.status !== 200) return
    await cache.put(withScope('/'), response.clone())
    await cache.put(withScope('/index.html'), response)
  } catch {
    // Offline: the page already held stays.
  }
}

/** Remove built files no current list names once they are old enough that no open tab needs them. */
async function dropStaleAssets(cache, wanted) {
  try {
    const keep = new Set([...wanted].map(absolute))
    const assets = new URL(withScope('/assets/'), self.location.origin).href
    for (const request of await cache.keys()) {
      if (!request.url.startsWith(assets) || keep.has(request.url)) continue
      const stored = await cache.match(request)
      const fetchedAt = Date.parse((stored && stored.headers.get('date')) || '')
      // Without a date the age cannot be told: keep the file.
      if (Number.isFinite(fetchedAt) && Date.now() - fetchedAt > STALE_ASSET_MS) await cache.delete(request)
    }
  } catch {
    // Housekeeping only.
  }
}

// A static file is the same bytes whoever asks. A server that answers `Vary: Origin` (Vite's
// preview does; a host in front of Pages may) would otherwise hide a stored file from a
// `crossorigin` script or stylesheet, whose request carries an Origin header the stored one lacks.
const ANY_VARIANT = { ignoreVary: true }

async function cacheFirst(event, request, cacheName) {
  const cached = await caches.match(request, ANY_VARIANT)
  if (cached) return cached
  const response = await fetch(request)
  // Stored while the page already reads it: waiting for the write held a large WebAssembly file
  // back until every byte of it had arrived.
  event.waitUntil(putResponse(cacheName, request, response).catch(() => undefined))
  return response
}

async function networkFirst(request, cacheName, cacheKey = request, cacheMode = 'no-cache') {
  try {
    const response = await fetch(request, { cache: cacheMode })
    await putResponse(cacheName, cacheKey, response)
    return response
  } catch (error) {
    const cached = await caches.match(cacheKey, ANY_VARIANT)
    if (cached) return cached
    throw error
  }
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cached = await caches.match(request, ANY_VARIANT)
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
