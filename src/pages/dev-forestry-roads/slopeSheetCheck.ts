/**
 * The company slope sheet as a check beside a road's estimate, never an input to it. Along a strip
 * either side of the road, the share of ground the sheet prints at the full-bench slope or steeper
 * is set beside the share the estimate's own ground shows there, per interval, and the stretches
 * where the sheet shows clearly more steep ground are named: there the estimate's terrain reads
 * the hillside flatter than the licensee's LiDAR did, and full bench and end haul are likely
 * understated.
 *
 * Area shares only. A single JPEG-tile pixel of the sheet is right about half the time
 * (`docs/forestry-road-design/source-pdf-import.md`), while shares over an area hold to about
 * 9–12%, so nothing here reads one pixel as a station's slope. The estimate's ground is the
 * stations' own cross-section samples (what the quantities were calculated from), its slope the
 * cross-section fall combined with the road's ground grade. DOM and network free.
 */
import {
  applyMatrix,
  decodeCells,
  estimatedClass,
  gridProjection,
  invertMatrix,
  knownClass,
} from '@/lib/geoPdf/classGrid'
import type { PdfClassGrid } from '@/lib/geoPdf/types'
import { FULL_BENCH_SIDESLOPE_PERCENT } from './sectionFixes'
import { sectionSampleAt } from './sectionGeometry'
import type { ReferenceFeature } from './referenceFeatures'
import type { RoadStation } from './types'

export const SLOPE_SHEET_CHECK = {
  /** The strip read either side of the centreline: the formation and its batters. */
  stripHalfWidthM: 20,
  /** Spacing of the points read across the strip. */
  stepM: 2,
  /** Length of road each share is taken over. */
  intervalM: 200,
  /** Points an interval needs before its shares are compared. */
  minSamples: 40,
  /** How many points more steep ground the sheet must show for a stretch to be named. */
  flagPoints: 15,
  /** "Steep": the full-bench screen of the incomplete-section fixes. */
  steepPercent: FULL_BENCH_SIDESLOPE_PERCENT,
} as const

export interface SlopeSheetInterval {
  from: number
  to: number
  samples: number
  /** Share of the points the sheet prints at `steepPercent` or more, 0–100. */
  sheetSteepPercent: number
  /** The same share on the estimate's ground. */
  terrainSteepPercent: number
}

export interface SlopeSheetCheck {
  /** The sheet's name as imported. */
  sheet: string
  /** Road length whose strip the sheet covers, metres. */
  coveredLengthM: number
  roadLengthM: number
  samples: number
  /** Share of the points whose class the sheet gives exactly (not a JPEG estimate), 0–100. */
  exactPercent: number
  sheetSteepPercent: number
  terrainSteepPercent: number
  intervals: SlopeSheetInterval[]
  /** Neighbouring intervals where the sheet shows `flagPoints` more steep ground, joined. */
  stretches: SlopeSheetInterval[]
}

type Station = Pick<RoadStation, 'chainage' | 'coordinate' | 'groundGradePercent' | 'section'>

/** The slope class grids the project's reference layers hold, the sheet's own name with each. */
export function slopeSheets(reference: readonly Pick<ReferenceFeature, 'name' | 'classGrid' | 'pdfSource'>[] = []) {
  return reference.flatMap((feature) =>
    feature.classGrid?.kind === 'slope'
      ? [{ name: feature.pdfSource?.file.split('/').at(-1) ?? feature.name, grid: feature.classGrid }]
      : [],
  )
}

/** A sampler for one grid: the class's minimum slope at a point, -1 below the printed classes, null unknown. */
function sheetSampler(grid: PdfClassGrid) {
  const inverse = invertMatrix(grid.transform),
    projection = gridProjection(grid),
    cells = decodeCells(grid)
  const lowest = Math.min(...grid.legend.map((c) => c.minimum))
  return (lon: number, lat: number): { minimum: number; exact: boolean } | null => {
    const [x, y] = applyMatrix(inverse, projection.forward([lon, lat]) as [number, number])
    const col = Math.floor(x),
      row = Math.floor(y)
    if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return null
    const code = cells[row * grid.width + col]
    if (knownClass(code, grid)) return { minimum: grid.legend[code - 1].minimum, exact: true }
    if (estimatedClass(code, grid)) return { minimum: grid.legend[code - 65].minimum, exact: false }
    // Not drawn: below the lowest printed class, which the transparency mask states exactly.
    if (code === 0 && grid.undrawn) return { minimum: lowest - 1, exact: true }
    return null
  }
}

const share = (count: number, of: number) => (of ? Math.round((1000 * count) / of) / 10 : 0)

/** The check for one road, or null where the sheet does not reach its strip. */
export function slopeSheetCheck(
  stations: readonly Station[],
  sheet: { name: string; grid: PdfClassGrid },
  options: Partial<Record<keyof typeof SLOPE_SHEET_CHECK, number>> = {},
): SlopeSheetCheck | null {
  const o = { ...SLOPE_SHEET_CHECK, ...options }
  if (stations.length < 2 || sheet.grid.kind !== 'slope') return null
  const sample = sheetSampler(sheet.grid)
  const buckets = new Map<number, { samples: number; sheet: number; terrain: number; from: number; to: number }>()
  let samples = 0,
    exact = 0,
    sheetSteep = 0,
    terrainSteep = 0,
    covered = 0
  stations.forEach((station, i) => {
    const prev = stations[Math.max(0, i - 1)],
      next = stations[Math.min(stations.length - 1, i + 1)]
    const [lon, lat] = station.coordinate
    const mx = 111_320 * Math.cos((lat * Math.PI) / 180),
      my = 110_574
    const ex = (next.coordinate[0] - prev.coordinate[0]) * mx,
      ey = (next.coordinate[1] - prev.coordinate[1]) * my,
      length = Math.hypot(ex, ey)
    if (!length) return
    // Negative offsets are left looking up-station, as everywhere in the designer.
    const leftX = -ey / length,
      leftY = ex / length
    const along = station.groundGradePercent ?? 0
    let read = 0
    for (let offset = -o.stripHalfWidthM; offset < o.stripHalfWidthM; offset += o.stepM) {
      const a = sectionSampleAt(station as RoadStation, offset).ground,
        b = sectionSampleAt(station as RoadStation, offset + o.stepM).ground
      if (a === null || b === null) continue
      const mid = offset + o.stepM / 2
      const point = sample(lon + (leftX * -mid) / mx, lat + (leftY * -mid) / my)
      if (!point) continue
      const terrain = Math.hypot(((b - a) / o.stepM) * 100, along)
      const steepOnSheet = point.minimum >= o.steepPercent,
        steepOnTerrain = terrain >= o.steepPercent
      samples++
      read++
      if (point.exact) exact++
      if (steepOnSheet) sheetSteep++
      if (steepOnTerrain) terrainSteep++
      const key = Math.floor(station.chainage / o.intervalM)
      const bucket = buckets.get(key) ?? {
        samples: 0,
        sheet: 0,
        terrain: 0,
        from: key * o.intervalM,
        to: key * o.intervalM,
      }
      bucket.samples++
      if (steepOnSheet) bucket.sheet++
      if (steepOnTerrain) bucket.terrain++
      bucket.to = Math.max(bucket.to, station.chainage)
      buckets.set(key, bucket)
    }
    if (read && i) covered += station.chainage - prev.chainage
  })
  if (!samples) return null
  const intervals = [...buckets.values()]
    .sort((a, b) => a.from - b.from)
    .filter((b) => b.samples >= o.minSamples)
    .map((b) => ({
      from: b.from,
      to: b.to,
      samples: b.samples,
      sheetSteepPercent: share(b.sheet, b.samples),
      terrainSteepPercent: share(b.terrain, b.samples),
    }))
  const stretches: SlopeSheetInterval[] = []
  for (const interval of intervals) {
    if (interval.sheetSteepPercent - interval.terrainSteepPercent < o.flagPoints) continue
    const last = stretches.at(-1)
    if (last && interval.from - last.to <= o.intervalM / 2) {
      // Joined: the shares are recounted over both.
      const total = last.samples + interval.samples
      last.sheetSteepPercent =
        Math.round(
          ((last.sheetSteepPercent * last.samples + interval.sheetSteepPercent * interval.samples) / total) * 10,
        ) / 10
      last.terrainSteepPercent =
        Math.round(
          ((last.terrainSteepPercent * last.samples + interval.terrainSteepPercent * interval.samples) / total) * 10,
        ) / 10
      last.samples = total
      last.to = interval.to
    } else stretches.push({ ...interval })
  }
  return {
    sheet: sheet.name,
    coveredLengthM: covered,
    roadLengthM: stations.at(-1)!.chainage - stations[0].chainage,
    samples,
    exactPercent: share(exact, samples),
    sheetSteepPercent: share(sheetSteep, samples),
    terrainSteepPercent: share(terrainSteep, samples),
    intervals,
    stretches,
  }
}

/** The check against whichever slope sheet covers most of the road's strip. */
export function bestSlopeSheetCheck(
  stations: readonly Station[],
  sheets: readonly { name: string; grid: PdfClassGrid }[],
): SlopeSheetCheck | null {
  let best: SlopeSheetCheck | null = null
  for (const sheet of sheets) {
    const check = slopeSheetCheck(stations, sheet)
    if (check && (!best || check.samples > best.samples)) best = check
  }
  return best
}
