/**
 * BC Wildfire Service fire perimeters, live, for a scene package's burnt ground (`terrain.cover` 7, `coverOnGrid`).
 *
 * Two DataBC WFS layers: the historical perimeters (`PROT_HISTORICAL_FIRE_POLYS_SP`, every season to last year) and
 * the current season's (`PROT_CURRENT_FIRE_POLYS_SP`). Both carry `FIRE_YEAR` and `FIRE_SIZE_HECTARES` and keep their
 * geometry in `SHAPE`. A perimeter is the fire's outer edge: unburnt islands inside it are not mapped, so the burnt
 * ground it gives is an upper bound. Display only. DOM-free; `fetch` is passed in.
 */
import { inventoryFetch } from '@/lib/offline/inventoryCopies'
import type { SceneFire } from './sceneCover'
import type { PolygonGeometry } from './visibility'

export const BC_HISTORICAL_FIRE_WFS =
  'https://openmaps.gov.bc.ca/geo/pub/WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP/ows'
export const BC_CURRENT_FIRE_WFS =
  'https://openmaps.gov.bc.ca/geo/pub/WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP/ows'

const LAYERS = {
  historical: {
    url: BC_HISTORICAL_FIRE_WFS,
    typeName: 'pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP',
  },
  current: { url: BC_CURRENT_FIRE_WFS, typeName: 'pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP' },
} as const

/** Cap on perimeters in one answer; a tile in BC's interior holds tens since 2000. */
export const MAX_FIRE_FEATURES = 500

/** Read fires this many years before the read year (the burnt window, 20 years, plus room for an older assessment). */
export const FIRE_READ_YEARS = 30

/**
 * One layer's perimeters in a box ([w, s, e, n], degrees) from `sinceYear` on. The box goes in the CQL filter,
 * longitude first, never the WFS `bbox` parameter (latitude-first under WFS 2.0 with `EPSG:4326`), and only the four
 * fields the cover reads are asked for.
 */
export function fireQueryUrl(
  layer: keyof typeof LAYERS,
  bounds: [number, number, number, number],
  sinceYear: number,
  maxFeatures = MAX_FIRE_FEATURES,
): string {
  const [w, s, e, n] = bounds.map((value) => Number(value.toFixed(6)))
  const parameters = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: LAYERS[layer].typeName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maxFeatures),
    propertyName: 'FIRE_NUMBER,FIRE_YEAR,FIRE_SIZE_HECTARES,SHAPE',
    CQL_FILTER: `BBOX(SHAPE,${w},${s},${e},${n},'EPSG:4326') AND FIRE_YEAR >= ${Math.floor(sinceYear)}`,
  })
  return `${LAYERS[layer].url}?${parameters.toString()}`
}

/** A WFS answer as fires with a year; anything without a polygon or a year is left out. */
export function parseFirePerimeters(
  payload: unknown,
  maxFeatures = MAX_FIRE_FEATURES,
): { fires: SceneFire[]; truncated: boolean } {
  const collection = payload as { features?: unknown; numberMatched?: unknown }
  if (!Array.isArray(collection?.features)) return { fires: [], truncated: false }
  const fires = collection.features.flatMap((entry): SceneFire[] => {
    const feature = entry as { geometry?: PolygonGeometry; properties?: Record<string, unknown> }
    const geometry = feature.geometry
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return []
    const properties = feature.properties ?? {}
    const year = typeof properties.FIRE_YEAR === 'number' ? properties.FIRE_YEAR : Number.NaN
    if (!Number.isFinite(year)) return []
    const size = properties.FIRE_SIZE_HECTARES
    const fireNumber = properties.FIRE_NUMBER
    return [
      {
        geometry,
        year,
        fireNumber: typeof fireNumber === 'string' && fireNumber.trim() ? fireNumber.trim() : null,
        sizeHectares: typeof size === 'number' && Number.isFinite(size) ? size : null,
      },
    ]
  })
  const matched = typeof collection.numberMatched === 'number' ? collection.numberMatched : null
  return { fires, truncated: fires.length >= maxFeatures || (matched !== null && matched > fires.length) }
}

/**
 * Fire perimeters from `sinceYear` on over each tile, historical and current, four requests at a time. Never rejects:
 * a tile whose read failed or hit the cap is left out of `complete`, and the note says how many. The same fire met in
 * two tiles is kept once (by number and year).
 */
export async function fetchFirePerimeters(
  tiles: ReadonlyArray<[number, number, number, number]>,
  sinceYear: number,
  {
    signal,
    fetchImpl = inventoryFetch,
    timeoutMs = 30_000,
  }: { signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ fires: SceneFire[]; complete: Array<[number, number, number, number]>; note: string }> {
  const jobs = tiles.flatMap((tile, index) =>
    (['historical', 'current'] as const).map((layer) => ({ tile, index, layer })),
  )
  const fires: SceneFire[] = []
  const seen = new Set<string>()
  const bad = new Set<number>()
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const { tile, index, layer } = jobs[next++]
      const abort = new AbortController()
      const stop = () => abort.abort()
      signal?.addEventListener('abort', stop)
      const timer = setTimeout(stop, timeoutMs)
      try {
        const response = await fetchImpl(fireQueryUrl(layer, tile, sinceYear), { signal: abort.signal })
        if (!response.ok) throw new Error(String(response.status))
        const payload: unknown = await response.json()
        if ((payload as { exceptions?: unknown })?.exceptions) throw new Error('refused')
        const result = parseFirePerimeters(payload)
        if (result.truncated) bad.add(index)
        for (const fire of result.fires) {
          const key = fire.fireNumber ? `${fire.fireNumber}:${fire.year}` : null
          if (key) {
            if (seen.has(key)) continue
            seen.add(key)
          }
          fires.push(fire)
        }
      } catch {
        bad.add(index)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker))
  const complete = tiles.filter((_, index) => !bad.has(index))
  const years = [...new Set(fires.map((fire) => fire.year))].sort((a, b) => a - b)
  const note = `Burnt ground: BC Wildfire Service perimeters from ${Math.floor(sinceYear)} read in ${complete.length} of ${tiles.length} tiles${
    years.length
      ? ` (${fires.length} fire${fires.length === 1 ? '' : 's'}, ${years[0]}–${years[years.length - 1]})`
      : ', none found'
  }${complete.length < tiles.length ? '; the rest shows no burn' : ''}.`
  return { fires, complete, note }
}
