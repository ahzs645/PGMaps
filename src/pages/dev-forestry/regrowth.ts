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

/** Fixed route footprint, including the hillside: never use the horizon map centre. */
export function forestHistoryBounds(road: number[][], polygons: PolygonGeometry[]): Bounds | null {
  const positions = [
    ...road,
    ...polygons.flatMap((p) => {
      const b = polygonBounds(p)
      return [
        [b[0], b[1]],
        [b[2], b[3]],
      ]
    }),
  ]
  if (!positions.length || positions.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null
  const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of positions) {
    b[0] = Math.min(b[0], p[0])
    b[1] = Math.min(b[1], p[1])
    b[2] = Math.max(b[2], p[0])
    b[3] = Math.max(b[3], p[1])
  }
  const latPad = 3000 / 111320,
    lngPad = latPad / Math.max(0.1, Math.cos(((b[1] + b[3]) * Math.PI) / 360))
  return [b[0] - lngPad, b[1] - latPad, b[2] + lngPad, b[3] + latPad]
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
