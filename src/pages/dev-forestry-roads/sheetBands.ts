/**
 * An imported map sheet's slope or canopy classes along a road, for the profile's value bands: at
 * each calculated station, the commonest class the sheet prints over the ground around it. The
 * company's LiDAR products read beside the estimate's own ground (the Sidehill row), never into it:
 * no quantity, search or check reads these rows.
 *
 * Area shares only. A patch of the sheet about 30 m across the road and up to 20 m along it is
 * read at every station, a few hundred of the sheet's pixels, because a single JPEG-tile pixel is
 * right about half the time while shares over an area this size hold to about a tenth
 * (`docs/forestry-road-design/source-pdf-import.md`). The stored cells are read, as the area
 * summaries read them, not the 10 m display cells. No DOM or network access.
 */
import { decodeCells, gridProjection, invertMatrix } from '@/lib/geoPdf/classGrid'
import type { PdfClassGrid } from '@/lib/geoPdf/types'
import { INTERIOR_SIDESLOPE_LIMIT_PERCENT } from './bcInteriorCost'
import type { ReferenceFeature } from './referenceFeatures'
import { FULL_BENCH_SIDESLOPE_PERCENT } from './sectionFixes'
import { SIDE_SLOPE_REACH_M } from './sectionSideSlope'
import type { RoadStation } from './types'

export const SHEET_BAND = {
  /** Read this far either side of the centreline: the Sidehill row's reach, so the two rows compare. */
  halfWidthM: SIDE_SLOPE_REACH_M,
  /** Read this far along the road each way, or half-way to the neighbouring station if that is nearer. */
  alongM: 10,
  /** Spacing of the points read in the patch, metres. */
  stepM: 2,
  /** Share of the patch's points the sheet must give a class for, or the station is unknown. */
  minCoverage: 0.5,
  /** Below this share of exact points among the commonest class's, the station's class is marked an estimate. */
  exactShare: 0.5,
} as const

export type SheetBandKind = 'slope' | 'canopy'

/** An imported class raster that can be read along a road. */
export interface RoadSheet {
  kind: SheetBandKind
  /** The sheet's file name as imported. */
  name: string
  grid: PdfClassGrid
}

/** One station's reading of a sheet. */
export interface StationSheetClass {
  chainage: number
  /**
   * The commonest class around the station: an index into the grid's legend, -1 for the not-drawn
   * class below the lowest printed range, or null where the sheet does not cover enough of the patch.
   */
  classIndex: number | null
  /** True when fewer than half the commonest class's points were exact (the rest JPEG estimates). */
  estimated: boolean
  /** Points the sheet gave a class for, and how many the patch holds. */
  samples: number
  points: number
}

/** A run of road in one class (null where unknown), for the band's colour. */
export interface SheetSpan {
  start: number
  end: number
  classIndex: number | null
  estimated: boolean
}

/** The first slope and the first canopy class raster among the project's reference layers. */
export function roadSheets(
  reference: readonly Pick<ReferenceFeature, 'name' | 'classGrid' | 'pdfSource'>[] = [],
): RoadSheet[] {
  const sheets: RoadSheet[] = []
  for (const feature of reference) {
    const grid = feature.classGrid
    if (!grid || sheets.some((sheet) => sheet.kind === grid.kind)) continue
    sheets.push({ kind: grid.kind, name: feature.pdfSource?.file.split('/').at(-1) ?? feature.name, grid })
  }
  // Slope first: it sits under the Sidehill row it is compared with.
  return sheets.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'slope' ? -1 : 1))
}

type Station = Pick<RoadStation, 'chainage' | 'coordinate'>

/** Each station's commonest sheet class, in station order. */
export function roadSheetClasses(stations: readonly Station[], sheet: RoadSheet): StationSheetClass[] {
  const { grid } = sheet
  const inverse = invertMatrix(grid.transform),
    projection = gridProjection(grid),
    cells = decodeCells(grid)
  const classes = grid.legend.length
  // Slot 0 is the not-drawn class; slots 1.. are the legend's. `exact` counts each slot's exact points.
  const counts = new Uint32Array(classes + 1),
    exact = new Uint32Array(classes + 1)
  return stations.map((station, i) => {
    const prev = stations[Math.max(0, i - 1)],
      next = stations[Math.min(stations.length - 1, i + 1)]
    const [lon, lat] = station.coordinate
    const mx = 111_320 * Math.cos((lat * Math.PI) / 180),
      my = 110_574
    const ex = (next.coordinate[0] - prev.coordinate[0]) * mx,
      ey = (next.coordinate[1] - prev.coordinate[1]) * my,
      length = Math.hypot(ex, ey)
    const none = { chainage: station.chainage, classIndex: null, estimated: false, samples: 0, points: 0 }
    if (!length) return none
    const ax = ex / length,
      ay = ey / length
    // Half-way to each neighbour, so neighbouring stations' patches meet without overlapping.
    const back = Math.min(SHEET_BAND.alongM, i > 0 ? (station.chainage - prev.chainage) / 2 : 0),
      ahead = Math.min(SHEET_BAND.alongM, i < stations.length - 1 ? (next.chainage - station.chainage) / 2 : 0)
    counts.fill(0)
    exact.fill(0)
    let points = 0,
      samples = 0
    for (let along = -back; along <= ahead + 1e-9; along += SHEET_BAND.stepM)
      for (let across = -SHEET_BAND.halfWidthM; across <= SHEET_BAND.halfWidthM + 1e-9; across += SHEET_BAND.stepM) {
        points++
        // Across is to the road's right: (ay, -ax) of the up-station direction.
        const east = along * ax + across * ay,
          north = along * ay - across * ax
        const [x, y] = projection.forward([lon + east / mx, lat + north / my])
        const col = Math.floor(inverse[0] * x + inverse[2] * y + inverse[4]),
          row = Math.floor(inverse[1] * x + inverse[3] * y + inverse[5])
        if (!(col >= 0 && row >= 0 && col < grid.width && row < grid.height)) continue
        const code = cells[row * grid.width + col]
        if (code > 0 && code <= classes) {
          counts[code]++
          exact[code]++
        } else if (code > 64 && code <= 64 + classes) counts[code - 64]++
        // Not drawn: below the lowest printed class, which the transparency mask states exactly.
        else if (code === 0 && grid.undrawn) {
          counts[0]++
          exact[0]++
        } else continue
        samples++
      }
    if (!samples || samples < points * SHEET_BAND.minCoverage) return { ...none, samples, points }
    let best = 0
    for (let k = 1; k <= classes; k++) if (counts[k] > counts[best]) best = k
    return {
      chainage: station.chainage,
      classIndex: best - 1,
      // The winning class's own points: not drawn is always exact, whatever the tile around it is.
      estimated: exact[best] < counts[best] * SHEET_BAND.exactShare,
      samples,
      points,
    }
  })
}

/** Readings kept a grid: the profile re-reads its bands on every analysis, and a grade edit moves no station. */
const KEPT_READINGS = 8
const kept = new WeakMap<PdfClassGrid, Map<string, StationSheetClass[]>>()
/**
 * `roadSheetClasses`, remembered by where the stations are. A profile edit recalculates the road
 * without moving a station on the ground, and reading two sheets at every station of a long road
 * takes tens of milliseconds, too long for every frame of a drag.
 */
export function roadSheetClassesKept(stations: readonly Station[], sheet: RoadSheet): StationSheetClass[] {
  let signature = ''
  for (const s of stations)
    signature += `${s.chainage.toFixed(2)},${s.coordinate[0].toFixed(7)},${s.coordinate[1].toFixed(7)};`
  let readings = kept.get(sheet.grid)
  if (!readings) kept.set(sheet.grid, (readings = new Map()))
  const old = readings.get(signature)
  if (old) return old
  const rows = roadSheetClasses(stations, sheet)
  if (readings.size >= KEPT_READINGS) readings.delete(readings.keys().next().value!)
  readings.set(signature, rows)
  return rows
}

/** The printed range in a band's width: "40–50", "85+", "<20". */
export function sheetClassText(grid: Pick<PdfClassGrid, 'legend' | 'undrawn'>, classIndex: number): string {
  if (classIndex < 0) return `<${grid.undrawn?.maximum ?? Math.min(...grid.legend.map((c) => c.minimum))}`
  const range = grid.legend[classIndex]
  return range.maximum === null ? `${range.minimum}+` : `${range.minimum}–${range.maximum}`
}

/** The lowest value of a class, or the not-drawn class's ceiling less a hair so it sorts below every printed class. */
export const sheetClassMinimum = (grid: Pick<PdfClassGrid, 'legend'>, classIndex: number) =>
  classIndex < 0 ? -Infinity : grid.legend[classIndex].minimum

/** How a slope class sits against the screens the Sidehill row marks; null for gentler ground and canopy. */
export function sheetSlopeTone(sheet: RoadSheet, classIndex: number): 'appraisal' | 'bench' | null {
  if (sheet.kind !== 'slope') return null
  const minimum = sheetClassMinimum(sheet.grid, classIndex)
  return minimum >= FULL_BENCH_SIDESLOPE_PERCENT
    ? 'bench'
    : minimum >= INTERIOR_SIDESLOPE_LIMIT_PERCENT
      ? 'appraisal'
      : null
}

/**
 * The band's colour runs over `start`–`end`: each station stands for the road half-way to its
 * neighbours, and consecutive stations of one class join, as the Sidehill row's do.
 */
export function sheetSpans(rows: readonly StationSheetClass[], start: number, end: number): SheetSpan[] {
  const spans: SheetSpan[] = []
  rows.forEach((row, i) => {
    const a = Math.max(start, i > 0 ? (rows[i - 1].chainage + row.chainage) / 2 : row.chainage)
    const b = Math.min(end, i < rows.length - 1 ? (row.chainage + rows[i + 1].chainage) / 2 : row.chainage)
    if (!(b > a + 1e-9)) return
    const last = spans[spans.length - 1]
    if (last && last.classIndex === row.classIndex && last.estimated === row.estimated && Math.abs(last.end - a) < 1e-6)
      last.end = b
    else spans.push({ start: a, end: b, classIndex: row.classIndex, estimated: row.estimated })
  })
  return spans
}
