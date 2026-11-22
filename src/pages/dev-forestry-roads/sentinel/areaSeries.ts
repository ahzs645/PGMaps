/**
 * An index through time over one area (a cutblock, a drawn polygon): for each listed scene, the
 * mean over the area's clear pixels, the clear share, a histogram, and the largest fall between
 * consecutive clear scenes, dated as an interval. DOM-free and network-free: the reader is passed in.
 *
 * Evidence only: never a constraint, a route-search input or proof of a road.
 */
import { histogram, type Histogram } from '@/lib/histogram'
import { indexValues, SENTINEL_INDICES, type SentinelIndex } from './indices'
import {
  SENTINEL_AREA_MAX_KM,
  SENTINEL_HISTOGRAM_BINS,
  SENTINEL_READ_CONCURRENCY,
  SENTINEL_SERIES_MAX_SCENES,
  SENTINEL_SERIES_MIN_CLEAR_SHARE,
  SENTINEL_SERIES_MIN_COVERAGE,
} from '@/lib/sentinel2/limits'
import { firstSeenLabel } from './render'
import { readIndexBands } from './resample'
import { SentinelError, type LonLatBounds, type SentinelScene } from '@/lib/sentinel2/stac'
import { SCL_CLEAR, SENTINEL_NATIVE_PIXEL_M, utm, type RasterReader, type SceneWindow } from '@/lib/sentinel2/window'

export type AreaGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon

/** Rings of every polygon part, outer and holes alike (the fill is even-odd). */
const ringsOf = (geometry: AreaGeometry): GeoJSON.Position[][] =>
  geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()

/** West, south, east, north of the area in degrees. */
export function areaBounds(geometry: AreaGeometry): LonLatBounds {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  for (const ring of ringsOf(geometry))
    for (const [lon, lat] of ring) {
      west = Math.min(west, lon)
      east = Math.max(east, lon)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  return [west, south, east, north]
}

/**
 * Pixels whose centre lies inside the rings (even-odd, so holes stay out), on the window's grid.
 * A scanline fill: each row's crossings are found once, so the cost is rows × edges plus pixels.
 */
export function rasterizeRings(rings: readonly (readonly (readonly number[])[])[], window: SceneWindow): Uint8Array {
  const { width, height } = window
  const [minX, , , maxY] = window.bbox
  const px = (window.bbox[2] - minX) / width,
    py = (maxY - window.bbox[1]) / height
  const mask = new Uint8Array(width * height)
  const crossings: number[] = []
  for (let row = 0; row < height; row++) {
    const y = maxY - (row + 0.5) * py
    crossings.length = 0
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j],
          [x2, y2] = ring[i]
        // Half-open in y, so a vertex on the scanline is counted once.
        if (y1 > y !== y2 > y) crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1))
      }
    crossings.sort((a, b) => a - b)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      // Pixel centres from the left crossing to the right one.
      const first = Math.max(0, Math.ceil((crossings[k] - minX) / px - 0.5))
      const last = Math.min(width - 1, Math.floor((crossings[k + 1] - minX) / px - 0.5))
      for (let column = first; column <= last; column++) mask[row * width + column] = 1
    }
  }
  return mask
}

export type AreaGrid = {
  window: SceneWindow
  /** 1 for pixels whose centre is inside the area. */
  mask: Uint8Array
  inside: number
}

/** The area's read window in a scene's UTM zone, on the 10 m grid, and its pixel mask. */
export function areaGrid(geometry: AreaGeometry, epsg: number, maxKm = SENTINEL_AREA_MAX_KM): AreaGrid {
  const projection = utm(epsg)
  const rings = ringsOf(geometry).map((ring) => ring.map(([lon, lat]) => projection.forward([lon, lat])))
  const xs = rings.flat().map((p) => p[0]),
    ys = rings.flat().map((p) => p[1])
  if (!xs.length || !xs.every(Number.isFinite) || !ys.every(Number.isFinite))
    throw new SentinelError('outside-bc', 'The area could not be placed in a UTM zone.')
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 1000
  if (span > maxKm)
    throw new SentinelError(
      'too-large',
      `The area spans ${span.toFixed(1)} km; a Sentinel-2 series reads at most ${maxKm} km.`,
    )
  const pixelM = SENTINEL_NATIVE_PIXEL_M
  const bbox: [number, number, number, number] = [
    Math.floor(Math.min(...xs) / pixelM) * pixelM,
    Math.floor(Math.min(...ys) / pixelM) * pixelM,
    Math.ceil(Math.max(...xs) / pixelM) * pixelM,
    Math.ceil(Math.max(...ys) / pixelM) * pixelM,
  ]
  const window: SceneWindow = {
    epsg,
    pixelM,
    bbox,
    width: Math.max(1, Math.round((bbox[2] - bbox[0]) / pixelM)),
    height: Math.max(1, Math.round((bbox[3] - bbox[1]) / pixelM)),
  }
  const mask = rasterizeRings(rings, window)
  let inside = 0
  for (let i = 0; i < mask.length; i++) inside += mask[i]
  if (!inside) throw new SentinelError('no-scene', 'The area is narrower than one 10 m pixel.')
  return { window, mask, inside }
}

export type AreaStats = {
  /** Pixels inside the area. */
  inside: number
  /** Inside pixels the tile covers (scene classification present). */
  covered: number
  /** Inside pixels with a clear index value. */
  clear: number
  /** Mean index over the clear pixels; NaN when none are. */
  mean: number
  /** The clear values, for the histogram. */
  values: Float32Array
}

/** The index inside the area: what the tile covers, what is clear, and the clear pixels' mean. */
export function areaStats(values: Float32Array, scl: ArrayLike<number>, mask: Uint8Array): AreaStats {
  let inside = 0,
    covered = 0,
    clear = 0,
    sum = 0
  const kept = new Float32Array(values.length)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    inside++
    if (scl[i]) covered++
    const value = values[i]
    if (Number.isNaN(value) || !SCL_CLEAR.has(scl[i])) continue
    kept[clear++] = value
    sum += value
  }
  return { inside, covered, clear, mean: clear ? sum / clear : NaN, values: kept.slice(0, clear) }
}

export type GapReason = 'cover' | 'cloud' | 'bands' | 'read'

export type SeriesPoint = {
  sceneId: string
  date: string
  datetime: string
  /** Mean over clear pixels; null for a gap, never zero. */
  mean: number | null
  /** Clear pixels over covered pixels (0–1). */
  clearShare: number
  /** Covered pixels over the area's pixels (0–1). */
  coverage: number
  gap: { reason: GapReason; text: string } | null
  /** The clear pixels' distribution over the index's fixed range; null for a gap that read nothing. */
  histogram: Histogram | null
}

const percent = (share: number) => `${Math.round(share * 100)}%`

/** One scene's point: a value when enough of the area is covered and clear, else a gap with its reason. */
export function seriesPoint(
  scene: Pick<SentinelScene, 'id' | 'date' | 'datetime'>,
  index: SentinelIndex,
  stats: AreaStats,
  {
    minClear = SENTINEL_SERIES_MIN_CLEAR_SHARE,
    minCoverage = SENTINEL_SERIES_MIN_COVERAGE,
    bins = SENTINEL_HISTOGRAM_BINS,
  } = {},
): SeriesPoint {
  const coverage = stats.inside ? stats.covered / stats.inside : 0
  const clearShare = stats.covered ? stats.clear / stats.covered : 0
  const base = { sceneId: scene.id, date: scene.date, datetime: scene.datetime, clearShare, coverage }
  const shape = stats.clear ? histogram(stats.values, { domain: SENTINEL_INDICES[index].domain, bins }) : null
  if (coverage < minCoverage)
    return {
      ...base,
      mean: null,
      histogram: shape,
      gap: { reason: 'cover', text: `tile covers ${percent(coverage)}` },
    }
  if (clearShare < minClear)
    return {
      ...base,
      mean: null,
      histogram: shape,
      gap: { reason: 'cloud', text: `${percent(clearShare)} clear` },
    }
  return { ...base, mean: stats.mean, histogram: shape, gap: null }
}

/** A scene that could not be read, or lacks a band, as a gap. */
export function failedPoint(
  scene: Pick<SentinelScene, 'id' | 'date' | 'datetime'>,
  reason: 'bands' | 'read',
  text: string,
): SeriesPoint {
  return {
    sceneId: scene.id,
    date: scene.date,
    datetime: scene.datetime,
    mean: null,
    clearShare: 0,
    coverage: 0,
    gap: { reason, text },
    histogram: null,
  }
}

/**
 * At most `max` scenes, oldest first, spread evenly over the list's order so both ends stay: the
 * first and last are always kept. A scene named in `keep` (the one the card shows) takes the place
 * of the nearest spread scene that is neither an end nor kept itself, so its histogram can be read.
 */
export function thinScenes<S extends Pick<SentinelScene, 'datetime' | 'id'>>(
  scenes: readonly S[],
  max = SENTINEL_SERIES_MAX_SCENES,
  keep: readonly (string | null | undefined)[] = [],
): S[] {
  const sorted = [...scenes].sort((a, b) => a.datetime.localeCompare(b.datetime))
  if (sorted.length <= max) return sorted
  if (max <= 1) return sorted.slice(-1)
  const kept = new Set<number>()
  for (let i = 0; i < max; i++) kept.add(Math.round((i * (sorted.length - 1)) / (max - 1)))
  const required = new Set<number>()
  for (const id of keep) {
    const wanted = sorted.findIndex((scene) => scene.id === id)
    if (wanted < 0 || kept.has(wanted)) {
      if (wanted >= 0) required.add(wanted)
      continue
    }
    let swap = -1
    for (const i of kept)
      if (
        i !== 0 &&
        i !== sorted.length - 1 &&
        !required.has(i) &&
        (swap < 0 || Math.abs(i - wanted) < Math.abs(swap - wanted))
      )
        swap = i
    if (swap < 0) continue
    kept.delete(swap)
    kept.add(wanted)
    required.add(wanted)
  }
  return [...kept].sort((a, b) => a - b).map((i) => sorted[i])
}

export type SeriesDrop = {
  earlier: SeriesPoint
  later: SeriesPoint
  /** The level before minus the level after: medians of every clear scene on each side (positive). */
  fall: number
  /** The two bracketing scenes' own fall. */
  step: number
  /** "first seen between … and …", with the snow-gap note. */
  label: string
  /** Clear scenes the level before and the level after are taken from. */
  scenesBefore: number
  scenesAfter: number
}

const clearByDate = (points: readonly SeriesPoint[]) =>
  points.filter((point) => point.mean !== null && !point.gap).sort((a, b) => a.datetime.localeCompare(b.datetime))

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** The level fall at each split between consecutive clear scenes, and the pair's own fall. */
function splits(clear: readonly SeriesPoint[]) {
  const values = clear.map((point) => point.mean!)
  return values.slice(1).map((value, k) => {
    const i = k + 1
    return { i, step: values[i - 1] - value, fall: median(values.slice(0, i)) - median(values.slice(i)) }
  })
}

/**
 * Where the index fell and stayed down, or null. Each pair of consecutive clear scenes is a
 * candidate bracket. Its fall is the median of every clear scene before it minus the median of
 * every clear scene after it, so a scene or a short run read through haze, smoke or thin cloud the
 * scene classification missed does not count unless the level stays down; it must reach `drop`.
 * Among the pairs that pass, the bracket is the one where the two scenes themselves fall most
 * (the smaller of the pair's own fall and the level fall), since every split near a step shows
 * much the same level fall. Gaps are stepped over, never read as values: the bracket runs from the
 * last clear scene before the fall to the first clear one after it.
 */
export function findDrop(points: readonly SeriesPoint[], drop: number): SeriesDrop | null {
  const clear = clearByDate(points)
  let best: { i: number; step: number; fall: number } | null = null
  const score = (split: { step: number; fall: number }) => Math.min(split.step, split.fall)
  for (const split of splits(clear))
    if (split.step > 0 && split.fall >= drop && (!best || score(split) > score(best))) best = split
  if (!best) return null
  const earlier = clear[best.i - 1],
    later = clear[best.i]
  return {
    earlier,
    later,
    fall: best.fall,
    step: best.step,
    label: firstSeenLabel(earlier.date, later.date),
    scenesBefore: best.i,
    scenesAfter: clear.length - best.i,
  }
}

/** Falls between consecutive clear scenes that reach `drop` but after which the level came back. */
export function shortDips(points: readonly SeriesPoint[], drop: number): number {
  return splits(clearByDate(points)).filter((split) => split.step >= drop && split.fall < drop).length
}

const isAbort = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')

/**
 * Read the series: each scene's area window, a few at a time (`concurrency`), each reported as it
 * lands. `scenes` are read as given (thin them first with `thinScenes`); a scene in `known` (read
 * earlier for the same area and index) is not read again. A cancelled signal stops the loop and
 * rejects; a scene that fails becomes a gap.
 */
export async function readAreaSeries({
  scenes,
  geometry,
  index,
  reader,
  signal,
  concurrency = SENTINEL_READ_CONCURRENCY,
  known,
  onPoint,
}: {
  scenes: readonly SentinelScene[]
  geometry: AreaGeometry
  index: SentinelIndex
  reader: RasterReader
  signal?: AbortSignal
  concurrency?: number
  known?: ReadonlyMap<string, SeriesPoint>
  onPoint?: (point: SeriesPoint) => void
}): Promise<SeriesPoint[]> {
  // Refuse a bad area once, before any read.
  if (scenes.length) areaGrid(geometry, scenes[0].epsg)
  const grids = new Map<number, AreaGrid>()
  const points: SeriesPoint[] = scenes.flatMap((scene) => known?.get(scene.id) ?? [])
  const chosen = scenes.filter((scene) => !known?.has(scene.id))
  let next = 0
  const worker = async () => {
    while (next < chosen.length) {
      signal?.throwIfAborted()
      const scene = chosen[next++]
      let point: SeriesPoint
      try {
        let grid = grids.get(scene.epsg)
        if (!grid) grids.set(scene.epsg, (grid = areaGrid(geometry, scene.epsg)))
        const bands = await readIndexBands(scene, index, grid.window, reader, signal)
        const values = indexValues(index, bands, scene.scaling)
        point = seriesPoint(scene, index, areaStats(values, bands.scl, grid.mask))
      } catch (error) {
        if (isAbort(error, signal)) throw error
        point =
          error instanceof SentinelError && error.kind === 'no-scene'
            ? failedPoint(scene, 'bands', `no ${SENTINEL_INDICES[index].label} bands listed`)
            : failedPoint(scene, 'read', 'read failed')
      }
      points.push(point)
      onPoint?.(point)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, chosen.length)) }, worker))
  signal?.throwIfAborted()
  return points.sort((a, b) => a.datetime.localeCompare(b.datetime))
}
