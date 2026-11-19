/**
 * Meta CHM v2 as a plan layer: the colours it is drawn in (the tiles are `chmTiles.ts`), the imagery
 * dates under a view, and what a road's corridor reads off it. Evidence beside the design, never an input to it.
 *
 * The picture uses the block sheet's canopy height classes (`CANOPY_HEIGHT_CLASSES`), so it reads like a
 * company canopy sheet laid beside it. Heights are a model's, read low and by a site-dependent amount
 * against LiDAR (−7.9 m at 093G086, −0.5 m on a licensee sheet), so the panel says so and no figure here
 * is corrected. DOM and network free.
 */
import { CANOPY_HEIGHT_CLASSES, type RasterClass } from '@/lib/forestry/blockSheet/styles'
import { corridorCanopy, gapRuns, CORRIDOR_DEFAULTS, type CorridorStation } from './corridor'
import { canopyAt, metaChmTiles, type CanopyGrid, type LonLatBounds } from './metaChm'

/** The plan draws the canopy only from this zoom in (the layer's minimum zoom). */
export const CHM_MIN_ZOOM = 12
/** A corridor read is refused past this many cells (full resolution, about 0.7 m). */
export const CHM_CORRIDOR_MAX_PIXELS = 60_000_000
/** Margin round a road's stations when its corridor is read, metres. */
export const CHM_CORRIDOR_MARGIN_M = 60
/** Gaps in the canopy along the centreline shorter than this are not listed, metres. */
export const CHM_GAP_MIN_LENGTH_M = 25

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** The class a height falls in (`min < value <= max`), as the block sheet classes it. */
export function canopyClassOf(value: number, classes: readonly RasterClass[] = CANOPY_HEIGHT_CLASSES) {
  return classes.find((c) => (c.min === undefined || value > c.min) && (c.max === undefined || value <= c.max))
}

const colourTables = new WeakMap<readonly RasterClass[], Uint8Array>()

/**
 * RGBA for each height 0–255 in its sheet class, four bytes a height: clear under 5 m and at 0,
 * which is both no canopy and no data in the source. Built once per class list.
 */
export function canopyColours(classes: readonly RasterClass[] = CANOPY_HEIGHT_CLASSES): Uint8Array {
  let lut = colourTables.get(classes)
  if (lut) return lut
  lut = new Uint8Array(256 * 4)
  for (let v = 1; v < 256; v++) {
    const color = canopyClassOf(v, classes)?.color
    if (!color) continue
    const [r, g, b] = hexRgb(color)
    lut.set([r, g, b, 255], v * 4)
  }
  colourTables.set(classes, lut)
  return lut
}

export interface ChmTileDates {
  fields: string[]
  tiles: Record<string, [from: string, to: string, images: number]>
}

/** The span of imagery dates under a box, from the per-tile table; null where no tile is listed. */
export function chmImageryDates(bounds: LonLatBounds, dates: ChmTileDates) {
  let from: string | null = null,
    to: string | null = null,
    listed = 0
  const tiles = metaChmTiles(bounds)
  for (const { key } of tiles) {
    const row = dates.tiles[key]
    if (!row) continue
    listed++
    if (!from || row[0] < from) from = row[0]
    if (!to || row[1] > to) to = row[1]
  }
  return from && to ? { from, to, tiles: tiles.length, listed } : null
}

/** Lon/lat box round a road's stations with a margin. */
export function stationBounds(coordinates: readonly [number, number][], marginM = CHM_CORRIDOR_MARGIN_M): LonLatBounds {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity
  for (const [lon, lat] of coordinates) {
    w = Math.min(w, lon)
    e = Math.max(e, lon)
    s = Math.min(s, lat)
    n = Math.max(n, lat)
  }
  const dLat = marginM / 111_320
  const dLon = marginM / (111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180))
  return [w - dLon, s - dLat, e + dLon, n + dLat]
}

export interface CorridorCanopySummary {
  stations: number
  sampledStations: number
  /** Length-weighted share of the clearing at or above `timberM`. */
  clearingTimberShare: number | null
  /** Clearing area, m², summed over station intervals (the clearing widths the stations carry). */
  clearingAreaM2: number
  /** Stations where a tree outside the clearing is tall enough to reach the running surface. */
  reachingStations: number
  tallestReaching: { chainage: number; heightM: number; offsetM: number } | null
  gaps: { fromM: number; toM: number }[]
  timberM: number
}

/**
 * The corridor read off a CHM grid. Clearing widths come from the stations (the design's slope stakes
 * plus clearing), else the corridor default; the figures are the model's, uncorrected.
 */
export function corridorSummary(stations: readonly CorridorStation[], grid: CanopyGrid): CorridorCanopySummary {
  const options = CORRIDOR_DEFAULTS
  const canopy = corridorCanopy(stations, (lon, lat) => canopyAt(grid, lon, lat), options)
  let weighted = 0,
    weight = 0,
    area = 0,
    reaching = 0
  let tallest: CorridorCanopySummary['tallestReaching'] = null
  for (let i = 0; i < canopy.length; i++) {
    const st = stations[i]
    const prev = i > 0 ? stations[i - 1].chainage : st.chainage
    const next = i < stations.length - 1 ? stations[i + 1].chainage : st.chainage
    const length = (next - prev) / 2
    const width =
      (st.leftClearingM ?? options.defaultClearingHalfWidthM) + (st.rightClearingM ?? options.defaultClearingHalfWidthM)
    area += length * width
    const c = canopy[i]
    if (c.clearingTimberShare !== null && length > 0) {
      weighted += c.clearingTimberShare * length
      weight += length
    }
    if (c.reachingTrees > 0) reaching++
    if (c.tallestReaching && (!tallest || c.tallestReaching.heightM > tallest.heightM))
      tallest = { chainage: c.chainage, ...c.tallestReaching }
  }
  return {
    stations: stations.length,
    sampledStations: canopy.filter((c) => c.sampled > 0).length,
    clearingTimberShare: weight ? weighted / weight : null,
    clearingAreaM2: area,
    reachingStations: reaching,
    tallestReaching: tallest,
    gaps: gapRuns(canopy, CHM_GAP_MIN_LENGTH_M),
    timberM: options.timberM,
  }
}
