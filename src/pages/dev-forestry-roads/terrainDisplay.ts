/**
 * Bounded display products made from the selected analytical terrain source.
 * The image/contour grid is a preview; it never replaces the native source used
 * for stationing and quantities. Every picture retains transparent no-data.
 */
import { PointCache } from './pointCache'
import type { Coordinate, TerrainMetadata, TerrainSource } from './types'
import { terrainCoverShare } from './tinGround'

/**
 * The pictures a display can draw. `relief` is the plan's rendition of the hillshade's light: flat
 * ground near white and only slopes shaded, as the regional relief around it is drawn, so loaded
 * terrain reads as finer relief rather than a grey box; exports and sheets keep `hillshade`.
 * `aspect` is the downslope bearing clockwise from geographic north, flat terrain neutral grey.
 */
export type TerrainImageLayer = 'hillshade' | 'relief' | 'slope' | 'elevation' | 'aspect'

export interface TerrainDisplay {
  /**
   * The layer's picture as a PNG data URL, drawn and encoded on first use and kept: the plan shows
   * one layer at a time, and drawing all five for each terrain cost a fifth of the build.
   */
  image(layer: TerrainImageLayer): string
  /** MapLibre image source corners: north-west, north-east, south-east, south-west. */
  coordinates: Coordinate[]
  contours: GeoJSON.FeatureCollection<GeoJSON.MultiLineString>
  resolutionM: number
  contourInterval: number
  elevationRange: [number, number]
}

export const TERRAIN_SLOPE_STOPS = [
  { value: 0, color: '#edf4d2' },
  { value: 15, color: '#93b88d' },
  { value: 25, color: '#e2c375' },
  { value: 35, color: '#d38245' },
  { value: 45, color: '#a8483c' },
  { value: 60, color: '#69373e' },
] as const

/** Cyclic compass colors: 0° and 360° share north's color. */
export const TERRAIN_ASPECT_STOPS = [
  { value: 0, label: 'N', color: '#dc2626' },
  { value: 45, label: 'NE', color: '#f97316' },
  { value: 90, label: 'E', color: '#eab308' },
  { value: 135, label: 'SE', color: '#84cc16' },
  { value: 180, label: 'S', color: '#16a34a' },
  { value: 225, label: 'SW', color: '#06b6d4' },
  { value: 270, label: 'W', color: '#2563eb' },
  { value: 315, label: 'NW', color: '#a855f7' },
  { value: 360, label: 'N', color: '#dc2626' },
] as const
export const TERRAIN_ASPECT_FLAT_COLOR = '#cbd5e1'

export type TerrainAspect = { state: 'aspect'; degrees: number } | { state: 'flat' | 'no-data'; degrees: null }

/**
 * dz/deast and dz/dnorth use the same metric gradient convention as hillshade.
 * Aspect points downhill, opposite that gradient, clockwise from north.
 * The tiny flat threshold suppresses numerical noise, not a slope-class rule.
 */
export function terrainAspectFromGradient(eastGradient: number, northGradient: number): TerrainAspect {
  if (!Number.isFinite(eastGradient) || !Number.isFinite(northGradient)) return { state: 'no-data', degrees: null }
  const degrees = aspectDegrees(eastGradient, northGradient)
  return Number.isNaN(degrees) ? { state: 'flat', degrees: null } : { state: 'aspect', degrees }
}
/** {@link terrainAspectFromGradient}'s bearing for a finite gradient, NaN where it is flat. */
function aspectDegrees(eastGradient: number, northGradient: number): number {
  if (Math.hypot(eastGradient, northGradient) <= 1e-10) return NaN
  return ((Math.atan2(-eastGradient, -northGradient) * 180) / Math.PI + 360) % 360
}

/**
 * The height's change a metre along one axis at a pixel of height `value`, from its neighbours
 * `before` and `after` that far away (0 at the display's edge, where the pixel is its own neighbour).
 * A missing neighbour does not erase measured ground at this pixel. Prefer a central difference, then
 * a supported one-sided difference. Never bridge a gap or replace a missing centre with an
 * interpolated height: true no-data remains transparent.
 */
function gradient(value: number, before: number, after: number, beforeDistance: number, afterDistance: number) {
  if (beforeDistance && afterDistance && Number.isFinite(before) && Number.isFinite(after))
    return (after - before) / (beforeDistance + afterDistance)
  if (afterDistance && Number.isFinite(after)) return (after - value) / afterDistance
  if (beforeDistance && Number.isFinite(before)) return (value - before) / beforeDistance
  return NaN
}

/** Flat ground's tone in the plan's relief, and how far a slope facing away from the sun darkens it. */
export const RELIEF_FLAT_SHADE = 248
const RELIEF_SHADOW_DEPTH = 160
/**
 * Relief tone for a hillshade light (0–1; flat ground under the 45° sun is √½): flat ground
 * stays {@link RELIEF_FLAT_SHADE}, slopes facing away darken toward it less the shadow depth, and
 * slopes facing the sun lighten to white.
 */
export function reliefShade(light: number): number {
  const lit = light / Math.SQRT1_2
  return Math.round(
    lit <= 1
      ? RELIEF_FLAT_SHADE - (1 - lit) * RELIEF_SHADOW_DEPTH
      : RELIEF_FLAT_SHADE + ((Math.min(lit, Math.SQRT2) - 1) / (Math.SQRT2 - 1)) * (255 - RELIEF_FLAT_SHADE),
  )
}

const MAX_CONTOUR_SEGMENTS = 60_000
/** A contour cell's corners from its north-west pixel: north-west, north-east, south-east, south-west. */
const CORNER_COL = [0, 1, 1, 0] as const
const CORNER_ROW = [0, 0, 1, 1] as const
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))
export type Color = [number, number, number]
const rgb = (hex: string): Color => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]
const slopeColors = TERRAIN_SLOPE_STOPS.map((stop) => ({ value: stop.value, rgb: rgb(stop.color) }))
const aspectColors = TERRAIN_ASPECT_STOPS.map((stop) => ({ value: stop.value, rgb: rgb(stop.color) }))
const flatAspectColor = rgb(TERRAIN_ASPECT_FLAT_COLOR)
export const TERRAIN_ELEVATION_COLORS = ['#dce7c6', '#a7bea0', '#698d79', '#baa77c', '#d5cbb2', '#f0eee9'] as const
const elevationColors: Color[] = TERRAIN_ELEVATION_COLORS.map(rgb)

type ColorTarget = { [channel: number]: number }
/**
 * Writes the colour `t` of the way from `a` to `b` at `target[offset…offset + 2]`. Pixels are
 * written in place, never through an array a pixel: two a pixel a layer were half the build.
 */
function mixInto(target: ColorTarget, offset: number, a: Color, b: Color, t: number) {
  target[offset] = Math.round(a[0] + (b[0] - a[0]) * t)
  target[offset + 1] = Math.round(a[1] + (b[1] - a[1]) * t)
  target[offset + 2] = Math.round(a[2] + (b[2] - a[2]) * t)
}
function copyInto(target: ColorTarget, offset: number, color: Color) {
  target[offset] = color[0]
  target[offset + 1] = color[1]
  target[offset + 2] = color[2]
}
function slopeInto(target: ColorTarget, offset: number, degrees: number) {
  let upper = -1
  for (let i = 0; i < slopeColors.length; i++)
    if (slopeColors[i].value >= degrees) {
      upper = i
      break
    }
  if (upper <= 0) return copyInto(target, offset, slopeColors[upper === 0 ? 0 : slopeColors.length - 1].rgb)
  const a = slopeColors[upper - 1],
    b = slopeColors[upper]
  mixInto(target, offset, a.rgb, b.rgb, (degrees - a.value) / (b.value - a.value))
}
function elevationInto(target: ColorTarget, offset: number, value: number, min: number, max: number) {
  const position = clamp((value - min) / Math.max(0.01, max - min), 0, 1) * (elevationColors.length - 1)
  const index = Math.min(elevationColors.length - 2, Math.floor(position))
  mixInto(target, offset, elevationColors[index], elevationColors[index + 1], position - index)
}
function aspectInto(target: ColorTarget, offset: number, degrees: number) {
  const index = Math.min(aspectColors.length - 2, Math.floor(degrees / 45))
  const a = aspectColors[index],
    b = aspectColors[index + 1]
  mixInto(target, offset, a.rgb, b.rgb, (degrees - a.value) / (b.value - a.value))
}
/** The plan's slope ramp, for other views that colour the same ground. */
export const terrainSlopeColor = (degrees: number): Color => {
  const color: Color = [0, 0, 0]
  slopeInto(color, 0, degrees)
  return color
}
export const terrainElevationColor = (value: number, min: number, max: number): Color => {
  const color: Color = [0, 0, 0]
  elevationInto(color, 0, value, min, max)
  return color
}
function encodePng(pixels: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw Error('The browser could not create a terrain display canvas.')
  const image = context.createImageData(width, height)
  image.data.set(pixels)
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * A number two coordinates share exactly when `value.toFixed(9)` prints them alike, sign included
 * ("-0.000000000" is not "0.000000000"). Contour ends were joined by those strings, and printing two
 * a point was most of the stitch (string keys are banned from the route searches for the same
 * reason, `pointCache.ts`). For any longitude the scaled value is within 4e-5 of exact, so only a
 * value about that close to a half is decided by `toFixed` itself.
 */
export function ninthDecimalKey(value: number): number {
  const magnitude = Math.abs(value),
    scaled = magnitude * 1e9
  const n =
    Math.abs(scaled - Math.floor(scaled) - 0.5) < 1e-3
      ? Number(magnitude.toFixed(9).replace('.', ''))
      : Math.round(scaled)
  return value < 0 ? -n - 1 : n
}

/** Join shared marching-square edges so contour labels can follow real lines. */
function stitchSegments(segments: Coordinate[][]): Coordinate[][] {
  // Each end's point: ends that print alike to nine decimals are one point.
  const points = new PointCache(segments.length * 2),
    ends = new Int32Array(segments.length * 2)
  for (let i = 0; i < segments.length; i++)
    for (let end = 0; end < 2; end++) {
      const p = segments[i][end],
        x = ninthDecimalKey(p[0]),
        y = ninthDecimalKey(p[1])
      let id = points.get(x, y)
      if (id === undefined) points.set(x, y, (id = points.size))
      ends[i * 2 + end] = id
    }
  // The segments at each point in the order they were met, a segment twice when both its ends are there.
  const count = points.size,
    start = new Int32Array(count + 1)
  for (let k = 0; k < ends.length; k++) start[ends[k] + 1]++
  for (let id = 0; id < count; id++) start[id + 1] += start[id]
  const next = start.slice(0, count),
    at = new Int32Array(ends.length)
  for (let k = 0; k < ends.length; k++) at[next[ends[k]]++] = k >> 1
  const meeting = (id: number) => start[id + 1] - start[id]

  const used = new Uint8Array(segments.length),
    lines: Coordinate[][] = []
  const walk = (first: number, firstEnd: number) => {
    const line: Coordinate[] = [segments[first][firstEnd]]
    let index = first,
      incoming = ends[first * 2 + firstEnd]
    while (!used[index]) {
      used[index] = 1
      const outgoing = ends[index * 2] === incoming ? 1 : 0
      line.push(segments[index][outgoing])
      incoming = ends[index * 2 + outgoing]
      let candidate = -1,
        open = 0
      for (let k = start[incoming]; k < start[incoming + 1]; k++)
        if (!used[at[k]]) {
          candidate = at[k]
          open++
        }
      if (open !== 1) break
      index = candidate
    }
    if (line.length > 1) lines.push(line)
  }
  // Open ends first; closed loops are consumed by the second pass.
  for (let index = 0; index < segments.length; index++) {
    if (used[index]) continue
    const first = meeting(ends[index * 2]) === 1 ? 0 : meeting(ends[index * 2 + 1]) === 1 ? 1 : -1
    if (first >= 0) walk(index, first)
  }
  for (let index = 0; index < segments.length; index++) if (!used[index]) walk(index, 0)
  return lines
}

/** Longest side of a display drawn over a sparsely covered box, px (`coverShare`). */
export const MAX_COVERED_DISPLAY_SIDE = 1024
/** The smallest cover share a display grows for: below it the side stops at 8× the requested one. */
const MIN_COVER_SHARE = 1 / 64

/** The display's longest side, px, for a requested side and the share of its box the ground covers. */
export function terrainDisplaySide(resolution: number, coverShare = 1): number {
  const requested = clamp(Number.isFinite(resolution) ? resolution : 160, 32, 384)
  const share = Number.isFinite(coverShare) ? clamp(coverShare, MIN_COVER_SHARE, 1) : 1
  return Math.round(share < 1 ? Math.min(MAX_COVERED_DISPLAY_SIDE, requested / Math.sqrt(share)) : requested)
}

/** The side the plan asks of `buildTerrainDisplay`, px. */
export const PLAN_TERRAIN_DISPLAY_SIDE = 192

/**
 * About how much ground one pixel of the plan's terrain drawing covers, m: the embedded grid's longest
 * side over the display's ({@link terrainDisplaySide} with the terrain's cover share). Null without
 * an embedded grid.
 */
export function planTerrainCellM(metadata: Pick<TerrainMetadata, 'preparation' | 'raster'>): number | null {
  const r = metadata.raster
  if (!r) return null
  const longest = Math.max(r.width * Math.abs(r.pixelSize[0]), r.height * Math.abs(r.pixelSize[1]))
  return longest / terrainDisplaySide(PLAN_TERRAIN_DISPLAY_SIDE, terrainCoverShare(metadata))
}

/**
 * `coverShare` is the share of `bounds` the terrain's ground covers (`terrainCoverShare`): a RoadEng
 * TIN along a long road covers a few percent of its box. The display then grows until the covered
 * part holds about as many pixels as a fully covered `resolution`² display, up to
 * {@link MAX_COVERED_DISPLAY_SIDE}: its pixels are sized from the covered area, not the box.
 */
export function buildTerrainDisplay(
  source: TerrainSource,
  bounds: [number, number, number, number],
  resolution = 160,
  { coverShare = 1 }: { coverShare?: number } = {},
): TerrainDisplay {
  if (
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3] ||
    bounds[0] < -180 ||
    bounds[2] > 180 ||
    bounds[1] < -85 ||
    bounds[3] > 85
  )
    throw Error('Terrain display requires a finite, non-wrapping geographic extent.')
  const maxSide = terrainDisplaySide(resolution, coverShare)
  const midLat = (bounds[1] + bounds[3]) / 2
  const widthMeters = (((bounds[2] - bounds[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((midLat * Math.PI) / 180)
  const heightMeters = (((bounds[3] - bounds[1]) * Math.PI) / 180) * 6371008.8
  const aspectRatio = widthMeters / heightMeters
  const width = Math.max(8, aspectRatio >= 1 ? maxSide : Math.round(maxSide * aspectRatio))
  const height = Math.max(8, aspectRatio <= 1 ? maxSide : Math.round(maxSide / aspectRatio))
  const dx = widthMeters / width,
    dy = heightMeters / height
  const lonStep = (bounds[2] - bounds[0]) / width,
    latStep = (bounds[3] - bounds[1]) / height
  const coordinate = (col: number, row: number): Coordinate => [
    bounds[0] + (col + 0.5) * lonStep,
    bounds[3] - (row + 0.5) * latStep,
  ]
  const values = new Float64Array(width * height)
  let minimum = Infinity,
    maximum = -Infinity
  for (let row = 0; row < height; row++) {
    const latitude = bounds[3] - (row + 0.5) * latStep
    for (let col = 0; col < width; col++) {
      const value = source.elevationAt(bounds[0] + (col + 0.5) * lonStep, latitude)
      values[row * width + col] = Number.isFinite(value) ? value : NaN
      if (Number.isFinite(value)) {
        minimum = Math.min(minimum, value)
        maximum = Math.max(maximum, value)
      }
    }
  }

  /** One layer's pixels: only the layer asked for is drawn. */
  const paint = (layer: TerrainImageLayer) => {
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const index = row * width + col,
          value = values[index],
          offset = index * 4
        if (!Number.isFinite(value)) continue
        if (layer === 'elevation') {
          elevationInto(pixels, offset, value, minimum, maximum)
          pixels[offset + 3] = 255
          continue
        }
        const west = Math.max(0, col - 1),
          east = Math.min(width - 1, col + 1)
        const north = Math.max(0, row - 1),
          south = Math.min(height - 1, row + 1)
        const zx = gradient(
          value,
          values[row * width + west],
          values[row * width + east],
          (col - west) * dx,
          (east - col) * dx,
        )
        const zy = gradient(
          value,
          values[south * width + col],
          values[north * width + col],
          (south - row) * dy,
          (row - north) * dy,
        )
        if (!Number.isFinite(zx) || !Number.isFinite(zy)) continue
        if (layer === 'slope') slopeInto(pixels, offset, (Math.atan(Math.hypot(zx, zy)) * 180) / Math.PI)
        else if (layer === 'aspect') {
          const degrees = aspectDegrees(zx, zy)
          if (Number.isNaN(degrees)) copyInto(pixels, offset, flatAspectColor)
          else aspectInto(pixels, offset, degrees)
        } else {
          const normal = Math.hypot(zx, zy, 1)
          // Sun from north-west at 45 degrees; local x is east and y is north.
          const light = clamp((-zx * -0.5 - zy * 0.5 + Math.SQRT1_2) / normal, 0, 1)
          const tone = layer === 'relief' ? reliefShade(light) : Math.round(55 + light * 200)
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = tone
        }
        pixels[offset + 3] = 255
      }
    return pixels
  }
  const images = new Map<TerrainImageLayer, string>()
  const image = (layer: TerrainImageLayer) => {
    let url = images.get(layer)
    if (url === undefined) images.set(layer, (url = encodePng(paint(layer), width, height)))
    return url
  }

  // Count edge crossings before allocating line coordinates (two per segment).
  // This retains 1 m contours where the actual segment budget allows them.
  // An interval change is returned
  // explicitly; no hidden truncation can turn a partially drawn layer into "1 m".
  // The cells with ground at all four corners and some relief, by their north-west pixel; a cell's
  // corners run north-west, north-east, south-east, south-west.
  const cells: number[] = []
  for (let row = 0; row < height - 1; row++)
    for (let col = 0; col < width - 1; col++) {
      const index = row * width + col
      const h0 = values[index],
        h1 = values[index + 1],
        h2 = values[index + width + 1],
        h3 = values[index + width]
      if (!(Number.isFinite(h0) && Number.isFinite(h1) && Number.isFinite(h2) && Number.isFinite(h3))) continue
      if (Math.max(h0, h1, h2, h3) - Math.min(h0, h1, h2, h3) > 1e-9) cells.push(index)
    }
  const heights = new Float64Array(4)
  const cornersOf = (index: number) => {
    heights[0] = values[index]
    heights[1] = values[index + 1]
    heights[2] = values[index + width + 1]
    heights[3] = values[index + width]
  }
  let contourInterval = 1
  /** Edge crossings at `interval`, two a segment. */
  const crossings = (interval: number) => {
    let total = 0
    for (const index of cells) {
      cornersOf(index)
      for (let edge = 0; edge < 4; edge++)
        total += Math.abs(Math.floor(heights[edge] / interval) - Math.floor(heights[(edge + 1) % 4] / interval))
    }
    return total
  }
  while (crossings(contourInterval) / 2 > MAX_CONTOUR_SEGMENTS) contourInterval *= 2
  const contours = new Map<number, Coordinate[][]>()
  const points: Coordinate[] = []
  for (const index of cells) {
    cornersOf(index)
    const col = index % width,
      row = (index - col) / width
    const low = Math.min(heights[0], heights[1], heights[2], heights[3]),
      high = Math.max(heights[0], heights[1], heights[2], heights[3])
    for (
      let level = (Math.floor(low / contourInterval) + 1) * contourInterval;
      level <= high;
      level += contourInterval
    ) {
      points.length = 0
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4,
          a = heights[edge],
          b = heights[next]
        // Half-open classification avoids double hits on equal-valued corners.
        if (a < level === b < level) continue
        const fraction = (level - a) / (b - a)
        const x0 = col + CORNER_COL[edge],
          y0 = row + CORNER_ROW[edge]
        points.push(
          coordinate(x0 + (col + CORNER_COL[next] - x0) * fraction, y0 + (row + CORNER_ROW[next] - y0) * fraction),
        )
      }
      if (points.length !== 2 && points.length !== 4) continue
      let lines = contours.get(level)
      if (!lines) contours.set(level, (lines = []))
      if (points.length === 2) lines.push([points[0], points[1]])
      else {
        // Bilinear asymptotic decider for ambiguous saddle cells.
        const a = heights[0] - level,
          b = heights[1] - level,
          c = heights[2] - level,
          d = heights[3] - level
        if (a * c - b * d >= 0) lines.push([points[0], points[1]], [points[2], points[3]])
        else lines.push([points[0], points[3]], [points[1], points[2]])
      }
    }
  }
  return {
    image,
    coordinates: [
      [bounds[0], bounds[3]],
      [bounds[2], bounds[3]],
      [bounds[2], bounds[1]],
      [bounds[0], bounds[1]],
    ],
    contours: {
      type: 'FeatureCollection',
      features: [...contours].map(([level, lines]) => ({
        type: 'Feature',
        properties: {
          elevation: level,
          elevation_m: level,
          index: Math.abs(level % (contourInterval * 5)) < 1e-9,
          interval_m: contourInterval,
          preview_resolution_m: Math.max(dx, dy),
        },
        geometry: { type: 'MultiLineString', coordinates: stitchSegments(lines) },
      })),
    },
    resolutionM: Math.max(dx, dy),
    contourInterval,
    elevationRange: Number.isFinite(minimum) ? [minimum, maximum] : [0, 0],
  }
}
