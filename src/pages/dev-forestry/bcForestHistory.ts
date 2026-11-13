/** Bounded live context for the driving preview; full/offline data belongs in bcdatamapper. */
import { BC_VISUAL_SERVICE, clampQueryBounds } from './bcVisualInventory'
import type { Bounds } from './terrain'
import { FOREST_HISTORY_MAX_CELLS, type ForestHistoryRecord } from './regrowth'
import type { PolygonGeometry } from './visibility'

export const FOREST_HISTORY_SOURCES = {
  harvest: {
    layer: 4,
    fields: 'OBJECTID,OPENING_ID,HARVEST_MID_YEAR_CALENDAR,HARVEST_START_YEAR_CALENDAR,PERCENT_CLEARCUT',
  },
  planting: {
    layer: 20,
    fields: 'OBJECTID,ACTIVITY_TREATMENT_UNIT_ID,ATU_COMPLETION_DATE,SILV_TREE_SPECIES_CODE,NUMBER_PLANTED',
  },
  height: { layer: 27, fields: 'OBJECTID,FOREST_COVER_ID,REFERENCE_YEAR,I_SPECIES_HEIGHT_1,I_SPECIES_CODE_1' },
} as const
export type HistoryKind = keyof typeof FOREST_HISTORY_SOURCES
/** Records one request returns before DataBC stops. */
export const FOREST_HISTORY_RECORD_CAP = 1000
/** One request's limit, download and parse included. */
export const FOREST_HISTORY_TIMEOUT_MS = 20000
/** A timed-out request is tried this many more times before it is reported. */
export const FOREST_HISTORY_TIMEOUT_RETRIES = 1
/** Requests in flight at once. DataBC serves HTTP/1.1, where Chrome opens 6 connections per host. */
export const FOREST_HISTORY_CONCURRENCY = 4
const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const year = (v: unknown) => {
  const n = number(v)
  return n !== null && n >= 1900 && n <= 2200 ? n : null
}
function dateYear(v: unknown) {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  return year(new Date(v).getUTCFullYear())
}

export function parseForestHistory(payload: unknown, kind: HistoryKind): ForestHistoryRecord[] {
  const collection = payload as {
    features?: Array<{ geometry?: PolygonGeometry; properties?: Record<string, unknown> }>
  }
  if (!Array.isArray(collection?.features)) return []
  const records = new Map<string, { record: ForestHistoryRecord; planted: number }>()
  for (const [index, feature] of collection.features.entries()) {
    if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue
    const p = feature.properties ?? {}
    const id = `${kind}-${kind === 'planting' ? (p.ACTIVITY_TREATMENT_UNIT_ID ?? p.OBJECTID ?? index) : (p.OBJECTID ?? p.FOREST_COVER_ID ?? index)}`
    const planted = number(p.NUMBER_PLANTED) ?? 0
    // Planting has one row per seedlot/species. Draw a treatment polygon once,
    // using the species of its largest reported planting row; do not double its tree density.
    if (records.has(id) && records.get(id)!.planted >= planted) continue
    const species = kind === 'planting' ? p.SILV_TREE_SPECIES_CODE : p.I_SPECIES_CODE_1
    const percent = number(p.PERCENT_CLEARCUT)
    records.set(id, {
      planted,
      record: {
        id,
        kind,
        geometry: feature.geometry,
        year:
          kind === 'planting'
            ? dateYear(p.ATU_COMPLETION_DATE)
            : kind === 'height'
              ? year(p.REFERENCE_YEAR)
              : (year(p.HARVEST_MID_YEAR_CALENDAR) ?? year(p.HARVEST_START_YEAR_CALENDAR)),
        heightMeters: kind === 'height' ? number(p.I_SPECIES_HEIGHT_1) : null,
        speciesCode: typeof species === 'string' ? species.trim() : null,
        clearcutPercent: percent !== null && percent >= 0 && percent <= 100 ? percent : null,
      },
    })
  }
  return [...records.values()].map((v) => v.record)
}

export function forestHistoryQueryUrl(kind: HistoryKind, bounds: Bounds) {
  const source = FOREST_HISTORY_SOURCES[kind]
  const query = new URLSearchParams({
    geometry: bounds.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: source.fields,
    returnGeometry: 'true',
    // No orderByFields: sorting makes DataBC rank every match before returning
    // the first 1,000 (20–41 s for forest cover over a 1.5° box). Each cell is
    // small enough to sit well under the cap; a cell that reaches it says so.
    resultRecordCount: String(FOREST_HISTORY_RECORD_CAP),
    maxAllowableOffset: '0.00003',
    f: 'geojson',
  })
  return `${BC_VISUAL_SERVICE}/${source.layer}/query?${query}`
}
export type ForestHistoryData = {
  records: ForestHistoryRecord[]
  issues: string[]
  retrievedAt: string
  /** Box around every cell read. */
  bounds: Bounds
  /** Sources still loading; these are not evidence of an empty forest. */
  pendingSources?: HistoryKind[]
}
type CellResult = { records: ForestHistoryRecord[]; failure?: 'timeout' | 'error'; capped: boolean; time: number }
type LoadOptions = {
  onUpdate?: (data: ForestHistoryData) => void
  retryFailed?: boolean
  /** The caller dropped cells past its limit (`forestHistoryAreas`). */
  truncated?: boolean
}
const SOURCE_NAMES: Record<HistoryKind, string> = {
  harvest: 'Harvest records',
  planting: 'Planting records',
  height: 'Forest-cover records',
}
/** Every source for the largest lookup, so one scene never evicts its own cells. */
const CACHE_LIMIT = 3 * FOREST_HISTORY_MAX_CELLS

function sourceIssues(kind: HistoryKind, cells: CellResult[]): string[] {
  const issues: string[] = []
  const failed = cells.filter((cell) => cell.failure)
  if (failed.length) {
    const reason = failed.every((cell) => cell.failure === 'timeout')
      ? 'took too long to respond'
      : 'could not be loaded'
    const share = failed.length === cells.length ? '' : ` for ${failed.length} of ${cells.length} areas`
    issues.push(
      `${kind} ${share ? 'partly unavailable' : 'unavailable'}: ${SOURCE_NAMES[kind]} ${reason}${share}. Other available records are retained; retry this source when ready.`,
    )
  }
  const capped = cells.filter((cell) => cell.capped).length
  if (capped) {
    issues.push(
      `${kind} reached ${FOREST_HISTORY_RECORD_CAP.toLocaleString('en-CA')} records${cells.length > 1 ? ` in ${capped} of ${cells.length} areas` : ''}; coverage is partial.`,
    )
  }
  return issues
}

async function fetchCell(url: string, kind: HistoryKind, signal: AbortSignal): Promise<CellResult> {
  let failure: CellResult['failure'] = 'error'
  for (let attempt = 0; attempt <= FOREST_HISTORY_TIMEOUT_RETRIES; attempt++) {
    const abort = new AbortController()
    const cancel = () => abort.abort()
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) abort.abort()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      abort.abort()
    }, FOREST_HISTORY_TIMEOUT_MS)
    try {
      const response = await fetch(url, { signal: abort.signal })
      if (!response.ok) throw new Error(`service returned ${response.status}`)
      const payload = await response.json()
      if (payload.error || !Array.isArray(payload.features)) throw new Error('service returned an invalid response')
      return {
        records: parseForestHistory(payload, kind),
        capped: payload.exceededTransferLimit === true || payload.features.length >= FOREST_HISTORY_RECORD_CAP,
        time: Date.now(),
      }
    } catch {
      failure = timedOut ? 'timeout' : 'error'
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', cancel)
    }
    // Only a slow answer is worth a second try; a refusal or a bad payload is not.
    if (signal.aborted || failure !== 'timeout') break
  }
  return { records: [], failure, capped: false, time: Date.now() }
}

/** Independent source caches, per grid cell: an unavailable planting service must
 * not throw away downloaded harvest/height records. Errors have a short retry backoff. */
export function createForestHistoryLoader() {
  const cache = new Map<string, CellResult>()
  return async (
    requested: Bounds | Bounds[],
    signal: AbortSignal,
    options: LoadOptions = {},
  ): Promise<ForestHistoryData> => {
    const asked = (typeof requested[0] === 'number' ? [requested] : requested) as Bounds[]
    const cells = asked.map((cell) => clampQueryBounds(cell))
    const clamped = asked.some((cell, c) => cell.some((n, i) => Math.abs(n - cells[c][i]) > 1e-8))
    const bounds: Bounds = cells.length
      ? [
          Math.min(...cells.map((b) => b[0])),
          Math.min(...cells.map((b) => b[1])),
          Math.max(...cells.map((b) => b[2])),
          Math.max(...cells.map((b) => b[3])),
        ]
      : [0, 0, 0, 0]
    const kinds = Object.keys(FOREST_HISTORY_SOURCES) as HistoryKind[]
    const results = new Map<HistoryKind, CellResult[]>()
    const pending = new Set(kinds)
    const snapshot = (): ForestHistoryData => {
      const records = new Map<string, ForestHistoryRecord>()
      // A polygon on a cell edge comes back from both cells.
      for (const kind of kinds)
        for (const cell of results.get(kind) ?? [])
          for (const r of cell.records) if (!records.has(r.id)) records.set(r.id, r)
      return {
        bounds,
        retrievedAt: new Date().toISOString(),
        records: [...records.values()],
        issues: [
          ...(clamped || options.truncated ? ['The route area exceeds the lookup limit; coverage is partial.'] : []),
          ...kinds.flatMap((kind) => (results.has(kind) ? sourceIssues(kind, results.get(kind)!) : [])),
        ],
        pendingSources: [...pending],
      }
    }
    const fresh = (cached: CellResult | undefined) =>
      !!cached &&
      Date.now() - cached.time < (cached.failure ? 30000 : 300000) &&
      !(options.retryFailed && cached.failure)
    // Cells per source, filled from the cache now and from requests as they land.
    const partial = new Map<HistoryKind, CellResult[]>()
    const remaining = new Map<HistoryKind, number>()
    const jobs: Array<{ kind: HistoryKind; index: number; url: string }> = []
    for (const kind of kinds) {
      const found: CellResult[] = []
      cells.forEach((cell, index) => {
        const url = forestHistoryQueryUrl(kind, cell)
        const cached = cache.get(url)
        if (fresh(cached)) {
          found[index] = cached!
          cache.delete(url)
          cache.set(url, cached!)
        } else jobs.push({ kind, index, url })
      })
      partial.set(kind, found)
      const missing = jobs.filter((job) => job.kind === kind).length
      if (missing) remaining.set(kind, missing)
      else {
        results.set(kind, found)
        pending.delete(kind)
      }
    }
    if (!signal.aborted) options.onUpdate?.(snapshot())
    let next = 0
    const worker = async () => {
      while (next < jobs.length && !signal.aborted) {
        const job = jobs[next++]
        const result = await fetchCell(job.url, job.kind, signal)
        if (signal.aborted) return
        cache.set(job.url, result)
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
        partial.get(job.kind)![job.index] = result
        const left = remaining.get(job.kind)! - 1
        remaining.set(job.kind, left)
        // A source is published once all its cells are in, so a half-read source
        // never looks like ground with no records.
        if (left === 0) {
          results.set(job.kind, partial.get(job.kind)!)
          pending.delete(job.kind)
          options.onUpdate?.(snapshot())
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(FOREST_HISTORY_CONCURRENCY, jobs.length) }, worker))
    if (signal.aborted) throw new DOMException('Forest loading cancelled', 'AbortError')
    return snapshot()
  }
}
export const fetchForestHistory = createForestHistoryLoader()
