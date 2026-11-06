import { PMTiles, TileType } from 'pmtiles'

export type Bounds = [number, number, number, number]
export type RasterAsset = { url?: string; tiles?: string[]; bounds: Bounds; minZoom: number; maxZoom: number }
export type SourceLink = { title: string; url: string }
export type Sheet = { image: string; label: string; sourceNote?: string; legend?: { image: string; label?: string } }
export type RasterRecord = {
  id: string
  title: string
  subtitle?: string
  description?: string
  caveat?: string
  confidence?: string
  thumbnail?: string
  assets: RasterAsset[]
  bounds: Bounds
  sources: SourceLink[]
  fullSheets: Sheet[]
  downloads: { url: string; bytes?: number; sha256?: string }[]
  alignmentReview?: { label: string; summary: string }
  dateLabel?: string
}
export type RasterCatalogue = {
  title: string
  description?: string
  items: RasterRecord[]
  featured: RasterRecord[]
  representationCount: number
  notes?: string
}
const text = (v: unknown, fallback = '') => (typeof v === 'string' ? v.slice(0, 6000) : fallback)
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('The map catalogue contains an invalid record.')
  return v as Record<string, unknown>
}
export function httpsURL(value: unknown, base?: string): string {
  if (typeof value !== 'string' || value.length > 12000) throw Error('A valid HTTPS map URL is required.')
  const url = new URL(value, base)
  const h = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.includes(':') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(h)
  )
    throw Error('Use a public HTTPS URL without embedded credentials.')
  url.hash = ''
  return url.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}')
}
function bounds(value: unknown): Bounds {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => typeof v === 'number' && Number.isFinite(v)))
    throw Error('A map needs valid geographic bounds.')
  const [w, s, e, n] = value as Bounds
  if (w < -180.001 || e > 180.001 || s < -90 || n > 90 || w >= e || s >= n)
    throw Error('The map bounds are outside the supported geographic range.')
  return [w, s, e, n]
}
function zoom(v: unknown, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(24, v)) : fallback
}
function asset(value: unknown, base: string): RasterAsset {
  const v = object(value)
  const result: RasterAsset = { bounds: bounds(v.bounds), minZoom: zoom(v.minZoom, 0), maxZoom: zoom(v.maxZoom, 18) }
  if (v.url) result.url = httpsURL(v.url, base)
  else if (Array.isArray(v.tiles) && v.tiles.length && v.tiles.length <= 8)
    result.tiles = v.tiles.map((x) => httpsURL(x, base))
  else throw Error('A map needs a raster PMTiles URL or tile URL template.')
  return result
}
function record(value: unknown, base: string): RasterRecord {
  const v = object(value)
  if (!Array.isArray(v.assets) || !v.assets.length || v.assets.length > 16)
    throw Error('A map must have between one and sixteen raster panels.')
  const assets = v.assets.map((x) => asset(x, base))
  const id = text(v.id)
  if (!id) throw Error('Each map needs an identifier.')
  const links = (Array.isArray(v.sources) ? v.sources : []).slice(0, 20).map((x) => {
    const s = object(x)
    return { title: text(s.title, 'Source document'), url: httpsURL(s.url, base) }
  })
  const sheets = (Array.isArray(v.fullSheets) ? v.fullSheets : []).slice(0, 30).map((x) => {
    const s = object(x)
    const l = s.legend ? object(s.legend) : null
    return {
      image: httpsURL(s.image, base),
      label: text(s.label, 'Full source sheet'),
      sourceNote: text(s.sourceNote),
      legend: l ? { image: httpsURL(l.image, base), label: text(l.label, 'Legend / notes') } : undefined,
    }
  })
  const downloadList = Array.isArray(v.downloads) ? v.downloads : v.download ? [v.download] : []
  const downloads = downloadList.slice(0, 16).map((x) => {
    const d = object(x)
    return {
      url: httpsURL(d.url, base),
      bytes: typeof d.bytes === 'number' ? d.bytes : undefined,
      sha256: text(d.sha256),
    }
  })
  const review = v.alignmentReview ? object(v.alignmentReview) : null
  return {
    id,
    title: text(v.title, 'Untitled map'),
    subtitle: text(v.subtitle),
    description: text(v.description),
    caveat: text(v.caveat),
    confidence: text(v.confidence),
    dateLabel: text(v.dateLabel),
    assets,
    bounds: bounds(v.bounds),
    thumbnail: v.thumbnail ? httpsURL(v.thumbnail, base) : undefined,
    sources: links,
    fullSheets: sheets,
    downloads,
    alignmentReview: review ? { label: text(review.label), summary: text(review.summary) } : undefined,
  }
}
export function parseCatalogue(raw: unknown, base: string): RasterCatalogue {
  const v = object(raw)
  if (v.schema !== 'raster-catalog-v1' || !Array.isArray(v.items) || v.items.length > 5000)
    throw Error('Open a raster-catalog-v1 catalogue, raster PMTiles file or raster TileJSON document.')
  const items = v.items.map((x) => record(x, base))
  const featured = (Array.isArray(v.featured) ? v.featured : []).slice(0, 200).map((x) => record(x, base))
  if (!items.length || new Set(items.map((i) => i.id)).size !== items.length)
    throw Error('The catalogue must contain maps with unique identifiers.')
  return {
    title: text(v.title, 'Shared map collection'),
    description: text(v.description),
    items,
    featured,
    representationCount: items.length,
    notes: text(v.notes),
  }
}
async function boundedJSON(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok)
    throw Error(`The map URL returned HTTP ${response.status}. Check that the complete share link is correct.`)
  httpsURL(response.url)
  const limit = 6_000_000
  if (Number(response.headers.get('Content-Length')) > limit) throw Error('The catalogue exceeds the 6 MB limit.')
  const reader = response.body?.getReader()
  if (!reader) throw Error('The map URL did not return a readable catalogue.')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw Error('The catalogue exceeds the 6 MB limit.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.length
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}
export async function loadCatalogue(input: string, signal: AbortSignal): Promise<RasterCatalogue> {
  const url = httpsURL(input)
  if (new URL(url).pathname.endsWith('.pmtiles')) {
    const archive = new PMTiles(url)
    const h = await archive.getHeader()
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (![TileType.Png, TileType.Jpeg, TileType.Webp, TileType.Avif].includes(h.tileType))
      throw Error('This viewer currently supports raster PMTiles. Vector PMTiles need a vector style.')
    const box: Bounds = [h.minLon, h.minLat, h.maxLon, h.maxLat]
    const metadata = (await archive.getMetadata()) as Record<string, unknown>
    return parseCatalogue(
      {
        schema: 'raster-catalog-v1',
        title: text(metadata.name, 'Shared raster map'),
        items: [
          {
            id: 'map',
            title: text(metadata.name, 'Shared raster map'),
            bounds: box,
            assets: [{ url, bounds: box, minZoom: h.minZoom, maxZoom: h.maxZoom }],
            sources: [],
          },
        ],
      },
      url,
    )
  }
  const raw = await boundedJSON(url, signal)
  const v = object(raw)
  if (v.tilejson && Array.isArray(v.tiles))
    return parseCatalogue(
      {
        schema: 'raster-catalog-v1',
        title: text(v.name, 'Shared tiled map'),
        items: [
          {
            id: 'map',
            title: text(v.name, 'Shared tiled map'),
            bounds: v.bounds,
            assets: [{ tiles: v.tiles, bounds: v.bounds, minZoom: v.minzoom, maxZoom: v.maxzoom }],
            sources: [],
          },
        ],
      },
      url,
    )
  return parseCatalogue(raw, url)
}
export function shareLink(source: string, mapId?: string) {
  const url = new URL('/dev/view', window.location.origin)
  const p = new URLSearchParams({ catalog: source })
  if (mapId) p.set('map', mapId)
  url.hash = p.toString()
  return url.href
}
