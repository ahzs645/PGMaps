/** Visual regrowth assumptions only: never used by the assessment/screening model. */
import { speciesFromCode, type InventoryStand } from './forest'
import { polygonBounds, type PolygonGeometry } from './visibility'
import type { Bounds } from './terrain'

export type ForestHistoryRecord = {
  id: string
  kind: 'height' | 'planting' | 'harvest'
  geometry: PolygonGeometry
  year: number | null
  heightMeters: number | null
  speciesCode: string | null
  clearcutPercent: number | null
}
export type RegrowthOptions = {
  year: number
  growthMetersPerYear: number
  regenerationLagYears: number
  matureHeightMeters: number
  projectRecordedHeights?: boolean
}
export type RegrowthStand = InventoryStand & {
  basis: 'recorded' | 'height projection' | 'planting estimate' | 'harvest estimate'
  recordedHeightMeters?: number
  referenceYear: number | null
  recordId: string
}
export const DEFAULT_REGROWTH = { growthMetersPerYear: 0.35, regenerationLagYears: 2, projectRecordedHeights: true }

/** How far either side of the road, and around each target, records are read. */
export const FOREST_HISTORY_REACH_METERS = 3000
/** Grid cell for record lookups, about 6.6 km × 6.7 km at 54°N. */
export const FOREST_HISTORY_CELL_DEGREES = { lng: 0.1, lat: 0.06 } as const
/** Most cells one lookup reads: three layers each, so 144 small requests at most. */
export const FOREST_HISTORY_MAX_CELLS = 48
const ROAD_SAMPLE_METERS = 500

export type ForestHistoryAreas = {
  /** Fixed grid cells, west/south/east/north. Fixed so a nudged scene reuses cached cells. */
  cells: Bounds[]
  /** True when more cells were needed than `FOREST_HISTORY_MAX_CELLS`. */
  truncated: boolean
}

/**
 * The ground records are read for: grid cells within `FOREST_HISTORY_REACH_METERS`
 * of the road or of any target, never the horizon map centre. One box around the
 * road and every target swept in the empty corners of a diagonal road, and a
 * box near the lookup limit made DataBC sort 25,000 forest-cover polygons (20–41 s)
 * before returning the first 1,000, chosen by ID rather than by nearness.
 * Targets come first, then the road from its start, so a capped lookup keeps the
 * subject of the view.
 */
export function forestHistoryAreas(road: number[][], polygons: PolygonGeometry[]): ForestHistoryAreas | null {
  const finite = (p: number[]) => Number.isFinite(p[0]) && Number.isFinite(p[1])
  if (!road.length && !polygons.length) return null
  if (!road.every(finite)) return null
  const order: string[] = []
  const seen = new Set<string>()
  const { lng: cellLng, lat: cellLat } = FOREST_HISTORY_CELL_DEGREES
  const latPad = FOREST_HISTORY_REACH_METERS / 111320
  const touch = (w: number, s: number, e: number, n: number) => {
    const lngPad = latPad / Math.max(0.1, Math.cos(((s + n) * Math.PI) / 360))
    for (let i = Math.floor((w - lngPad) / cellLng); i <= Math.floor((e + lngPad) / cellLng); i++) {
      for (let j = Math.floor((s - latPad) / cellLat); j <= Math.floor((n + latPad) / cellLat); j++) {
        const key = `${i},${j}`
        if (seen.has(key)) continue
        seen.add(key)
        order.push(key)
      }
    }
  }
  for (const polygon of polygons) {
    const b = polygonBounds(polygon)
    if (!b.every(Number.isFinite)) return null
    touch(b[0], b[1], b[2], b[3])
  }
  for (let k = 0; k < road.length; k++) {
    const [lng, lat] = road[k]
    touch(lng, lat, lng, lat)
    const next = road[k + 1]
    if (!next) continue
    const dy = (next[1] - lat) * 111320
    const dx = (next[0] - lng) * 111320 * Math.cos((lat * Math.PI) / 180)
    const steps = Math.ceil(Math.hypot(dx, dy) / ROAD_SAMPLE_METERS)
    for (let t = 1; t < steps; t++) {
      const f = t / steps
      const x = lng + (next[0] - lng) * f
      const y = lat + (next[1] - lat) * f
      touch(x, y, x, y)
    }
  }
  const round = (n: number) => Number(n.toFixed(6))
  return {
    cells: order.slice(0, FOREST_HISTORY_MAX_CELLS).map((key) => {
      const [i, j] = key.split(',').map(Number)
      return [round(i * cellLng), round(j * cellLat), round((i + 1) * cellLng), round((j + 1) * cellLat)] as Bounds
    }),
    truncated: order.length > FOREST_HISTORY_MAX_CELLS,
  }
}

/** Deliberately simple, adjustable scenario assumption, not a species/site growth model.
 * Optional projections retain the original height and year; they are never called measurements.
 * Newer spatial records win, so an old survey cannot refill a later clearcut.
 * A planting date only applies inside its treatment polygon, not the whole opening ID. */
export function buildRegrowthStands(records: ForestHistoryRecord[], options: RegrowthOptions) {
  const priority = { height: 2, planting: 1, harvest: 0 }
  const sorted = [...records].sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || priority[b.kind] - priority[a.kind] || a.id.localeCompare(b.id),
  )
  const stands: RegrowthStand[] = []
  let unknown = 0
  for (const record of sorted) {
    if (record.year !== null && record.year > options.year) continue
    let height: number,
      basis: RegrowthStand['basis'],
      fraction = 1
    if (
      record.kind === 'height' &&
      record.heightMeters !== null &&
      record.heightMeters > 0 &&
      record.heightMeters <= 100
    ) {
      height = record.heightMeters
      basis = 'recorded'
      if (options.projectRecordedHeights && record.year !== null && record.year < options.year) {
        height = Math.min(
          Math.max(record.heightMeters, options.matureHeightMeters),
          record.heightMeters + (options.year - record.year) * options.growthMetersPerYear,
        )
        basis = 'height projection'
      }
    } else if (
      record.kind !== 'height' &&
      record.year !== null &&
      (record.kind === 'planting' || record.clearcutPercent !== null)
    ) {
      const age = options.year - record.year - (record.kind === 'harvest' ? options.regenerationLagYears : 0)
      height = age < 0 ? 0 : Math.min(options.matureHeightMeters, 0.3 + age * options.growthMetersPerYear)
      basis = record.kind === 'planting' ? 'planting estimate' : 'harvest estimate'
      if (record.kind === 'harvest') fraction = Math.max(0, Math.min(1, record.clearcutPercent! / 100))
    } else {
      unknown++
      continue
    }
    stands.push({
      geometry: record.geometry,
      heightMeters: height,
      species: speciesFromCode(record.speciesCode),
      regenerationFraction: fraction,
      basis,
      referenceYear: record.year,
      recordId: record.id,
      ...(record.kind === 'height' && record.heightMeters !== null
        ? { recordedHeightMeters: record.heightMeters }
        : {}),
    })
  }
  return { stands, unknown }
}
