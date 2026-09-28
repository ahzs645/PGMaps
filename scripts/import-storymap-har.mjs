#!/usr/bin/env node
/** Import a user-supplied StoryMaps HAR as content, never as executable app code.
 * node scripts/import-storymap-har.mjs <capture.har> <item-id> <public-output-dir>
 * Optional --fetch-missing retrieves only public referenced story media.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import console from 'node:console'
import { basename, resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'

const [harPath, itemId, outputArg, ...flags] = process.argv.slice(2)
if (!harPath || !/^[a-f0-9]{32}$/i.test(itemId ?? '') || !outputArg) {
  throw new Error('Usage: import-storymap-har.mjs <capture.har> <item-id> <public-output-dir> [--fetch-missing]')
}
const output = resolve(outputArg)
const publicRoot = resolve('public')
const rel = relative(publicRoot, output)
if (!rel || rel.startsWith('..') || rel.startsWith(sep)) throw new Error('Output must be inside public/')
const publicUrl = `/${rel.split(sep).join('/')}`
const har = JSON.parse(await readFile(harPath, 'utf8'))
const entries = har.log.entries
const resourceBase = (id) => `https://www.arcgis.com/sharing/rest/content/items/${id}/resources/`
const decode = (entry) => {
  const c = entry.response.content
  return Buffer.from(c.text ?? '', c.encoding === 'base64' ? 'base64' : 'utf8')
}
const pathOf = (entry) => new URL(entry.request.url).pathname
const captures = (path) =>
  entries.filter(
    (entry) =>
      pathOf(entry) === path &&
      entry.response.status >= 200 &&
      entry.response.status < 300 &&
      entry.response.content.text,
  )
const largest = (list) => list.sort((a, b) => decode(b).length - decode(a).length)[0]
const capturedJson = (id) => {
  const entry = largest(captures(`/sharing/rest/content/items/${id}/data`))
  return entry ? JSON.parse(decode(entry).toString('utf8')) : undefined
}
// Drop analytics, authentication, cookie and identifying transport fields recursively.
// Request/response envelopes never enter output. Clean URL query credentials too.
const blocked =
  /^(gaid|gaconsentmessage|analytics|googleanalytics|telemetry|tracking|token|access_token|refresh_token|api[_-]?key|client[_-]?secret|authorization|cookie|cookies|headers|sessionid|useridentity|useremail|shouldPushMetaToAGOItemDetails)$/i
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !blocked.test(key))
        .map(([key, val]) => [key, sanitize(val)]),
    )
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()])
      if (/token|key|secret|session|auth|^utm_|^fbclid$|^gclid$/i.test(key)) url.searchParams.delete(key)
    return url.toString()
  }
  return value
}
const source = capturedJson(itemId)
if (!source?.root || !source.nodes || !source.resources)
  throw new Error('Capture does not contain a StoryMaps content graph for the selected item')
const story = sanitize({
  root: source.root,
  nodes: source.nodes,
  resources: source.resources,
  actions: source.actions ?? [],
})
await mkdir(`${output}/assets`, { recursive: true })
await mkdir(`${output}/maps`, { recursive: true })
const manifest = {
  sourceItemId: itemId,
  sourceUrl: `https://storymaps.arcgis.com/stories/${itemId}`,
  captureStarted: har.log.pages?.[0]?.startedDateTime ?? null,
  media: [],
  fonts: [],
  webmaps: [],
  omissions: [],
  sourceAvailability: { unavailableServices: [] },
}
const activeActions = story.actions.filter(
  (action) => story.nodes[action.target] && story.nodes[action.origin]?.data?.text?.includes(action.data?.actionId),
)
manifest.actionInventory = {
  retainedCount: story.actions.length,
  activeCount: activeActions.length,
  staleCount: story.actions.length - activeActions.length,
  activeActionIds: activeActions.map((action) => action.data.actionId),
  staleActionIds: story.actions
    .filter((action) => !activeActions.includes(action))
    .map((action) => action.data?.actionId),
}
const referencedServices = new Set()
const referencedServiceItems = new Map()
function collectServices(value, mapItemId) {
  if (Array.isArray(value)) return value.forEach((child) => collectServices(child, mapItemId))
  if (value && typeof value === 'object')
    return Object.values(value).forEach((child) => collectServices(child, mapItemId))
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return
  const url = new URL(value)
  const servicePath = url.pathname.match(/^(.*\/(?:MapServer|ImageServer|FeatureServer))(?:\/.*)?$/i)?.[1]
  if (servicePath) {
    const service = url.origin + servicePath
    referencedServices.add(service)
    if (mapItemId) {
      const ids = referencedServiceItems.get(service) ?? new Set()
      ids.add(mapItemId)
      referencedServiceItems.set(service, ids)
    }
  }
}
collectServices(story)
const dimensions = (buffer) => {
  if (buffer.subarray(1, 4).toString() === 'PNG')
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  if (buffer[0] !== 255 || buffer[1] !== 216) return undefined
  let pos = 2
  while (pos + 9 < buffer.length) {
    if (buffer[pos] !== 255) break
    const marker = buffer[pos + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = buffer.readUInt16BE(pos + 2)
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
      return { width: buffer.readUInt16BE(pos + 7), height: buffer.readUInt16BE(pos + 5) }
    pos += 2 + length
  }
  return undefined
}
async function importMedia(resourceKey, resource, ownerItemId) {
  const data = resource.data
  const filename = basename(data.resourceId ?? '')
  if (!filename || filename !== data.resourceId || !/\.(png|jpe?g|webp|gif|mp4|webm|svg)$/i.test(filename)) return
  const url = resourceBase(ownerItemId) + encodeURIComponent(filename)
  const entry = largest(captures(new URL(url).pathname))
  let bytes = entry && decode(entry)
  let origin = 'capture'
  if (resource.type === 'video' && entry) {
    const range = entry.response.headers.find((header) => header.name.toLowerCase() === 'content-range')?.value
    const match = range?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
    if (entry.response.status === 206 && (!match || Number(match[1]) !== 0 || Number(match[3]) !== bytes.length))
      bytes = undefined
  }
  if (!bytes && flags.includes('--fetch-missing')) {
    const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(30_000) })
    if (response.ok && /^(image|video)\//.test(response.headers.get('content-type') ?? '')) {
      bytes = Buffer.from(await response.arrayBuffer())
      origin = 'public-resource'
    }
  }
  const record = {
    resource: resourceKey,
    type: resource.type,
    filename,
    sourceUrl: url,
    originalDimensions: data.width ? { width: data.width, height: data.height } : undefined,
  }
  if (bytes?.length) {
    await writeFile(`${output}/assets/${filename}`, bytes)
    data.url = `${publicUrl}/assets/${filename}`
    manifest.media.push({
      ...record,
      url: data.url,
      origin,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      capturedDimensions: dimensions(bytes),
    })
  } else {
    data.url = url
    manifest.media.push({ ...record, url, origin: 'remote-only', bytes: 0 })
    manifest.omissions.push(`Media ${filename} has no complete captured body; uses public source URL.`)
  }
}
for (const [key, resource] of Object.entries(story.resources)) {
  if (['image', 'video'].includes(resource.type)) await importMedia(key, resource, itemId)
  if (resource.type === 'webmap') {
    const map = capturedJson(resource.data.itemId)
    if (map) {
      collectServices(map, resource.data.itemId)
      const filename = `${resource.data.itemId}.json`
      await writeFile(`${output}/maps/${filename}`, JSON.stringify(sanitize(map), null, 2) + '\n')
      resource.data.webmapUrl = `${publicUrl}/maps/${filename}`
      manifest.webmaps.push({
        resource: key,
        itemId: resource.data.itemId,
        url: resource.data.webmapUrl,
        layerCount: map.operationalLayers?.length ?? 0,
      })
    } else manifest.omissions.push(`Webmap ${resource.data.itemId} was not captured; uses public item.`)
  }
  if (resource.type === 'story-theme' && resource.data.themeItemId) {
    const theme = sanitize(capturedJson(resource.data.themeItemId))
    if (theme) {
      for (const [themeKey, themeResource] of Object.entries(theme.resources ?? {})) {
        if (themeResource.type === 'image') await importMedia(themeKey, themeResource, resource.data.themeItemId)
      }
      resource.data.theme = theme
    }
  }
}
// Preserve failures already present in the supplied capture without caching error
// responses as map data or claiming the original unavailable imagery was recovered.
for (const entry of entries) {
  const url = new URL(entry.request.url)
  const service = url.origin + url.pathname.replace(/\/$/, '')
  if (!referencedServices.has(service)) continue
  let error
  try {
    error = JSON.parse(decode(entry).toString('utf8')).error
  } catch {
    /* Empty/non-JSON response. */
  }
  if (!error && entry.response.status < 400) continue
  if (manifest.sourceAvailability.unavailableServices.some((failure) => failure.url === service)) continue
  manifest.sourceAvailability.unavailableServices.push({
    url: service,
    httpStatus: entry.response.status,
    affectedItemIds: [...(referencedServiceItems.get(service) ?? [])],
    serviceCode: error?.code ?? null,
    message: error?.message ?? 'No successful response body captured',
    capturedAt: entry.startedDateTime ?? null,
  })
}
// Only copy font families explicitly authored in a captured theme.
const themes = Object.values(story.resources).filter(
  (resource) => resource.type === 'story-theme' && resource.data.theme,
)
const authoredFontNames = new Set(
  themes.flatMap(({ data }) =>
    Object.values(data.theme.resources ?? {})
      .filter((resource) => resource.type === 'font')
      .map((resource) => resource.data.displayName?.replaceAll(' ', '_'))
      .filter(Boolean),
  ),
)
for (const entry of entries) {
  const path = pathOf(entry)
  if (
    ![...authoredFontNames].some((name) => path.includes(`/fonts/${name}/`)) ||
    !path.endsWith('.woff2') ||
    !entry.response.content.text
  )
    continue
  const filename = basename(path)
  if (manifest.fonts.some((font) => font.filename === filename)) continue
  const bytes = decode(entry)
  await writeFile(`${output}/assets/${filename}`, bytes)
  manifest.fonts.push({
    filename,
    url: `${publicUrl}/assets/${filename}`,
    bytes: bytes.length,
    sourceUrl: new URL(entry.request.url).origin + path,
  })
}
for (const { data } of themes) {
  const font = data.theme.resources?.[data.theme.bodyFont?.resource]?.data
  if (!font?.displayName) continue
  data.theme.fontFamily = font.displayName
  data.theme.localFonts = manifest.fonts
    .filter((entry) => entry.sourceUrl.includes(`/fonts/${font.displayName.replaceAll(' ', '_')}/`))
    .map((entry) => ({
      url: entry.url,
      weight: /-(\d{3})(?:italic)?\.woff2$/.exec(entry.filename)?.[1] ?? '400',
      style: /italic\.woff2$/.test(entry.filename) ? 'italic' : 'normal',
      unicodeRange: entry.filename.includes('-latin-ext-')
        ? 'U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF'
        : 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    }))
}
const cover = Object.values(story.nodes).find((node) => node.type === 'storycover')
story.source = {
  itemId,
  url: manifest.sourceUrl,
  title: cover?.data?.title ?? '',
  publisher: cover?.data?.byline ?? '',
  importFormat: 'storymaps-har-v1',
  captureStarted: manifest.captureStarted,
  manifestUrl: `${publicUrl}/manifest.json`,
  note: 'Content and credited media imported from the user-supplied capture for reference recreation. Original publisher retains rights. Mapping services remain live dependencies.',
}
await writeFile(`${output}/story.json`, JSON.stringify(story, null, 2) + '\n')
await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
console.log(
  JSON.stringify(
    {
      nodes: Object.keys(story.nodes).length,
      resources: Object.keys(story.resources).length,
      actions: story.actions.length,
      media: manifest.media.length,
      localMedia: manifest.media.filter((m) => m.bytes).length,
      mediaBytes: manifest.media.reduce((sum, m) => sum + m.bytes, 0),
      fonts: manifest.fonts.length,
      webmaps: manifest.webmaps.length,
      omissions: manifest.omissions,
      capturedServiceFailures: manifest.sourceAvailability.unavailableServices.length,
    },
    null,
    2,
  ),
)
