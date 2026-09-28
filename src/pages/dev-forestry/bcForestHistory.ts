/** Bounded live context for the driving preview; full/offline data belongs in bcdatamapper. */
import { BC_VISUAL_SERVICE, clampQueryBounds } from './bcVisualInventory'
import type { Bounds } from './terrain'
import type { ForestHistoryRecord } from './regrowth'
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
    resultRecordCount: '1000',
    orderByFields: 'OBJECTID ASC',
    maxAllowableOffset: '0.00003',
    f: 'geojson',
  })
  return `${BC_VISUAL_SERVICE}/${source.layer}/query?${query}`
}
export type ForestHistoryData = {
  records: ForestHistoryRecord[]
  issues: string[]
  retrievedAt: string
  bounds: Bounds
  /** Sources still loading; these are not evidence of an empty forest. */
  pendingSources?: HistoryKind[]
}
type SourceResult = { records: ForestHistoryRecord[]; issue?: string; time: number }
type LoadOptions = { onUpdate?: (data: ForestHistoryData) => void; retryFailed?: boolean }
const SOURCE_NAMES: Record<HistoryKind, string> = { harvest: 'Harvest records', planting: 'Planting records', height: 'Forest-cover records' }

/** Independent source caches: an unavailable planting service must not throw
 * away downloaded harvest/height records. Errors have a short retry backoff. */
export function createForestHistoryLoader() {
  const cache = new Map<string, SourceResult>()
  return async (requested: Bounds, signal: AbortSignal, options: LoadOptions = {}): Promise<ForestHistoryData> => {
    const bounds = clampQueryBounds(requested)
    const kinds = Object.keys(FOREST_HISTORY_SOURCES) as HistoryKind[]
    const results = new Map<HistoryKind, SourceResult>()
    const pending = new Set(kinds)
    const snapshot = (): ForestHistoryData => ({
      bounds,
      retrievedAt: new Date().toISOString(),
      records: kinds.flatMap(kind => results.get(kind)?.records ?? []),
      issues: [
        ...(requested.some((n, i) => Math.abs(n - bounds[i]) > 1e-8) ? ['The route area exceeds the lookup limit; coverage is partial.'] : []),
        ...kinds.flatMap(kind => results.get(kind)?.issue ? [results.get(kind)!.issue!] : []),
      ],
      pendingSources: [...pending],
    })
    for (const kind of kinds) {
      const url = forestHistoryQueryUrl(kind, bounds)
      const cached = cache.get(url)
      if (cached && Date.now() - cached.time < (cached.issue ? 30000 : 300000) && !(options.retryFailed && cached.issue)) {
        results.set(kind, cached)
        pending.delete(kind)
        cache.delete(url)
        cache.set(url, cached)
      }
    }
    if (!signal.aborted) options.onUpdate?.(snapshot())
    await Promise.all([...pending].map(async kind => {
      const url = forestHistoryQueryUrl(kind, bounds)
      const abort = new AbortController()
      const cancel = () => abort.abort()
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) abort.abort()
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; abort.abort() }, 20000)
      let result: SourceResult
      try {
        const response = await fetch(url, { signal: abort.signal })
        if (!response.ok) throw new Error(`service returned ${response.status}`)
        const payload = await response.json()
        if (payload.error || !Array.isArray(payload.features)) throw new Error('service returned an invalid response')
        result = {
          records: parseForestHistory(payload, kind), time: Date.now(),
          issue: payload.exceededTransferLimit === true || payload.features.length >= 1000
            ? `${kind} reached 1,000 records; coverage is partial.` : undefined,
        }
      } catch {
        result = { records: [], time: Date.now(), issue: `${kind} unavailable: ${SOURCE_NAMES[kind]} ${timedOut ? 'took too long to respond' : 'could not be loaded'}. Other available records are retained; retry this source when ready.` }
      } finally {
        clearTimeout(timeout)
        signal.removeEventListener('abort', cancel)
      }
      if (signal.aborted) return
      cache.set(url, result)
      while (cache.size > 12) cache.delete(cache.keys().next().value!)
      results.set(kind, result)
      pending.delete(kind)
      options.onUpdate?.(snapshot())
    }))
    if (signal.aborted) throw new DOMException('Forest loading cancelled', 'AbortError')
    return snapshot()
  }
}
export const fetchForestHistory = createForestHistoryLoader()
