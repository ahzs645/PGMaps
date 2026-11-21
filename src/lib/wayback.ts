import { xyzTileTemplate } from '@pgmaps/geo-toolkit/map'

/** How long the release catalog may take before the request gives up, ms. */
export const WAYBACK_CATALOG_TIMEOUT_MS = 20_000
export const WAYBACK_CATALOG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'

/**
 * Which release each Wayback tile was taken from. Asked for release R, it answers with the release
 * whose tile R reuses (`select`), so walking it back from the newest release finds only the
 * releases that changed the picture at a place, as Esri's own Wayback app does.
 */
export const WAYBACK_TILEMAP =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap'
/** The deepest Wayback tile the plan draws; deeper views stretch it, so changes are read here. */
export const WAYBACK_MAX_TILE_ZOOM = 18
/** Esri's metadata layers run from 1.9 cm (layer 0, zoom 23) to 150 m (layer 13, zoom 10). */
const METADATA_MAX_ZOOM = 23
const METADATA_MIN_ZOOM = 10
/** Places whose local changes are kept for the session. */
export const WAYBACK_LOCAL_CACHE_SIZE = 64
/** Capture records kept for the session (release, metadata layer and place). */
export const WAYBACK_CAPTURE_CACHE_SIZE = 256

export interface WaybackRelease {
  id: string
  date: string
  tiles: string
  itemUrl?: string
  /** Esri's imagery metadata service for this release: what was captured, when, at what resolution. */
  metadataUrl?: string
}

export function waybackReleases(catalog: unknown): WaybackRelease[] {
  const releases: WaybackRelease[] = []
  if (catalog && typeof catalog === 'object' && !Array.isArray(catalog)) {
    for (const [id, item] of Object.entries(catalog)) {
      if (!/^\d+$/.test(id) || typeof item?.itemTitle !== 'string' || typeof item.itemURL !== 'string') continue
      const date = /^World Imagery \(Wayback (\d{4}-\d{2}-\d{2})\)$/.exec(item.itemTitle)?.[1]
      if (
        !date ||
        !Number.isFinite(Date.parse(date)) ||
        !item.itemURL.startsWith('https://wayback.maptiles.arcgis.com/')
      )
        continue
      try {
        const itemUrl =
          typeof item.itemID === 'string' && /^[0-9a-f]{32}$/i.test(item.itemID)
            ? `https://www.arcgis.com/home/item.html?id=${item.itemID}`
            : undefined
        const metadataUrl =
          typeof item.metadataLayerUrl === 'string' &&
          item.metadataLayerUrl.startsWith('https://metadata.maptiles.arcgis.com/')
            ? item.metadataLayerUrl.replace(/\/+$/, '')
            : undefined
        releases.push({ id, date, tiles: xyzTileTemplate(item.itemURL), itemUrl, metadataUrl })
      } catch {
        // A catalog may contain entries without a usable tile template.
      }
    }
  }
  if (!releases.length) throw new Error('Esri returned no usable Wayback releases.')
  return releases.sort((a, b) => b.date.localeCompare(a.date))
}

export async function loadWaybackReleases(signal: AbortSignal) {
  const response = await fetch(WAYBACK_CATALOG, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(WAYBACK_CATALOG_TIMEOUT_MS)]),
  })
  if (!response.ok) throw new Error(`Esri returned HTTP ${response.status}.`)
  return waybackReleases(await response.json())
}

export function waybackCredit(release: WaybackRelease) {
  return release.itemUrl
    ? `<a href="${release.itemUrl}" target="_blank" rel="noopener noreferrer">Esri Wayback · imagery credits</a>`
    : 'Esri World Imagery Wayback and contributors'
}

export interface WaybackTile {
  z: number
  x: number
  y: number
}

/** The Web Mercator tile under a point at the zoom the plan draws Wayback at (at most z18). */
export function waybackTileAt(lon: number, lat: number, zoom: number): WaybackTile {
  const z = Math.max(0, Math.min(WAYBACK_MAX_TILE_ZOOM, Math.round(zoom)))
  const n = 2 ** z
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)))
  const rad = (clampedLat * Math.PI) / 180
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n)))
  return { z, x, y }
}

export const waybackTileKey = ({ z, x, y }: WaybackTile) => `${z}/${x}/${y}`

export function waybackTilemapUrl(releaseId: string, { z, x, y }: WaybackTile) {
  return `${WAYBACK_TILEMAP}/${releaseId}/${z}/${y}/${x}`
}

/** One tilemap answer: whether release `id` has a tile here, and the release that tile came from. */
export function parseWaybackTilemap(json: unknown, id: string): { exists: boolean; from: string } {
  if (!json || typeof json !== 'object') throw new Error('Esri returned an unreadable tile map.')
  const { data, select } = json as { data?: unknown; select?: unknown }
  if (!Array.isArray(data)) throw new Error('Esri returned an unreadable tile map.')
  const exists = data[0] === 1
  const from = Array.isArray(select) && Number.isInteger(select[0]) ? String(select[0]) : id
  return { exists, from }
}

/**
 * The releases that change the picture at one tile, newest first: each one's own release, the first
 * that published that imagery. Starting from the newest release, each answer names the release the
 * tile came from; the walk then asks the release just older than that one, so it makes one request
 * per distinct image. A tile that no older release has ends the walk.
 */
export async function waybackLocalChanges(
  newestFirst: readonly WaybackRelease[],
  read: (release: WaybackRelease) => Promise<{ exists: boolean; from: string }>,
  signal?: AbortSignal,
): Promise<WaybackRelease[]> {
  const index = new Map(newestFirst.map((release, i) => [release.id, i]))
  const changes: WaybackRelease[] = []
  for (let i = 0; i < newestFirst.length; ) {
    signal?.throwIfAborted()
    const { exists, from } = await read(newestFirst[i])
    if (!exists) break
    // A `select` that is not in the catalog, or not older, counts as this release's own tile.
    const j = index.get(from)
    const at = j !== undefined && j >= i ? j : i
    changes.push(newestFirst[at])
    i = at + 1
  }
  return changes
}

/** The release in `changes` whose imagery release `date` shows here: the newest not after it. */
export function waybackShownChange<T extends { date: string }>(changes: readonly T[], date: string): T | undefined {
  let shown: T | undefined
  for (const change of changes) if (change.date <= date && (!shown || change.date > shown.date)) shown = change
  return (
    shown ?? changes.reduce<T | undefined>((oldest, c) => (!oldest || c.date < oldest.date ? c : oldest), undefined)
  )
}

export interface WaybackCapture {
  /** When the imagery was captured, YYYY-MM-DD, if Esri records it. */
  date: string | null
  /** Ground resolution, metres. */
  resolutionM: number | null
  /** Stated horizontal accuracy, metres; Esri writes 99999 when unknown. */
  accuracyM: number | null
  /** Who supplied it, e.g. "City of Prince George". */
  provider: string | null
  /** Esri's name for the source, e.g. "Prince George 2023 Ortho". */
  source: string | null
}

/** The metadata layer that describes the imagery drawn at this zoom (Esri's rule: layer = 23 − zoom). */
export function waybackMetadataLayer(zoom: number) {
  const z = Math.max(METADATA_MIN_ZOOM, Math.min(WAYBACK_MAX_TILE_ZOOM, Math.round(zoom)))
  return METADATA_MAX_ZOOM - z
}

export function waybackCaptureUrl(release: WaybackRelease, lon: number, lat: number, zoom: number) {
  if (!release.metadataUrl) return null
  const query = new URLSearchParams({
    f: 'json',
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'SRC_DATE,SRC_DATE2,SRC_RES,SRC_ACC,SRC_DESC,NICE_DESC',
    returnGeometry: 'false',
  })
  return `${release.metadataUrl}/${waybackMetadataLayer(zoom)}/query?${query}`
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const positive = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

/** The capture record at a point, or null where the release records none. */
export function parseWaybackCapture(json: unknown): WaybackCapture | null {
  if (!json || typeof json !== 'object') throw new Error('Esri returned an unreadable imagery record.')
  const { features, error } = json as { features?: unknown; error?: { message?: unknown } }
  if (error) throw new Error(text(error.message) ?? 'Esri could not read the imagery record.')
  if (!Array.isArray(features)) throw new Error('Esri returned an unreadable imagery record.')
  const attributes = (features[0] as { attributes?: Record<string, unknown> } | undefined)?.attributes
  if (!attributes) return null
  let date: string | null = null
  const yyyymmdd = attributes.SRC_DATE
  if (typeof yyyymmdd === 'number' && /^\d{8}$/.test(String(yyyymmdd))) {
    const s = String(yyyymmdd)
    date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  } else if (typeof attributes.SRC_DATE2 === 'number' && Number.isFinite(attributes.SRC_DATE2)) {
    date = new Date(attributes.SRC_DATE2).toISOString().slice(0, 10)
  }
  const accuracy = positive(attributes.SRC_ACC)
  return {
    date,
    resolutionM: positive(attributes.SRC_RES),
    accuracyM: accuracy !== null && accuracy < 99999 ? accuracy : null,
    provider: text(attributes.NICE_DESC),
    source: text(attributes.SRC_DESC),
  }
}

/** "7.5 cm", "60 cm", "1.2 m", "15 m". */
export function formatWaybackResolution(metres: number) {
  if (metres < 1) return `${Number((metres * 100).toPrecision(2))} cm`
  return `${Number(metres.toPrecision(2))} m`
}
