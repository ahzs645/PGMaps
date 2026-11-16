/**
 * Bounded display products made from the selected analytical terrain source.
 * The image/contour grid is a preview; it never replaces the native source used
 * for stationing and quantities. All four PNGs retain transparent no-data.
 */
import type { Coordinate, TerrainMetadata, TerrainSource } from './types'
import { terrainCoverShare } from './tinGround'

export interface TerrainDisplay {
  hillshade: string
  /**
   * The plan's rendition of the same light: flat ground near white and only slopes shaded, as the
   * regional relief around it is drawn, so loaded terrain reads as finer relief rather than a grey
   * box. Exports and sheets keep `hillshade`.
   */
  relief: string
  slope: string
  elevation: string
  /** Downslope bearing clockwise from geographic north; flat terrain is neutral grey. */
  aspect: string
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
  if (Math.hypot(eastGradient, northGradient) <= 1e-10) return { state: 'flat', degrees: null }
  return {
    state: 'aspect',
    degrees: ((Math.atan2(-eastGradient, -northGradient) * 180) / Math.PI + 360) % 360,
  }
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

function mix(a: Color, b: Color, t: number): Color {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t)) as Color
}
function slopeColor(degrees: number): Color {
  const upper = slopeColors.findIndex((stop) => stop.value >= degrees)
  if (upper <= 0) return slopeColors[upper === 0 ? 0 : slopeColors.length - 1].rgb
  const a = slopeColors[upper - 1],
    b = slopeColors[upper]
  return mix(a.rgb, b.rgb, (degrees - a.value) / (b.value - a.value))
}
function elevationColor(value: number, min: number, max: number): Color {
  const position = clamp((value - min) / Math.max(0.01, max - min), 0, 1) * (elevationColors.length - 1)
  const index = Math.min(elevationColors.length - 2, Math.floor(position))
  return mix(elevationColors[index], elevationColors[index + 1], position - index)
}
/** The plan's slope ramp, for other views that colour the same ground. */
export const terrainSlopeColor = (degrees: number): Color => slopeColor(degrees)
export const terrainElevationColor = (value: number, min: number, max: number): Color => elevationColor(value, min, max)
function aspectColor(degrees: number): Color {
  const index = Math.min(aspectColors.length - 2, Math.floor(degrees / 45))
  const a = aspectColors[index],
    b = aspectColors[index + 1]
  return mix(a.rgb, b.rgb, (degrees - a.value) / (b.value - a.value))
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

/** Join shared marching-square edges so contour labels can follow real lines. */
function stitchSegments(segments: Coordinate[][]): Coordinate[][] {
  const key = (p: Coordinate) => `${p[0].toFixed(9)},${p[1].toFixed(9)}`
  const at = new Map<string, number[]>()
  const keys = segments.map((segment, i) =>
    segment.map((p) => {
      const value = key(p),
        entries = at.get(value) ?? []
      entries.push(i)
      at.set(value, entries)
      return value
    }),
  )
  const used = new Uint8Array(segments.length),
    lines: Coordinate[][] = []
  const walk = (start: number, first: number) => {
    const line: Coordinate[] = [segments[start][first]]
    let index = start,
      incoming = keys[start][first]
    while (!used[index]) {
      used[index] = 1
      const outgoing = keys[index][0] === incoming ? 1 : 0
      line.push(segments[index][outgoing])
      incoming = keys[index][outgoing]
      const candidates = (at.get(incoming) ?? []).filter((candidate) => !used[candidate])
      if (candidates.length !== 1) break
      index = candidates[0]
    }
    if (line.length > 1) lines.push(line)
  }
  // Open ends first; closed loops are consumed by the second pass.
  segments.forEach((_, index) => {
    if (used[index]) return
    const first = keys[index].findIndex((value) => at.get(value)?.length === 1)
    if (first >= 0) walk(index, first)
  })
  segments.forEach((_, index) => {
    if (!used[index]) walk(index, 0)
  })
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
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const value = source.elevationAt(...coordinate(col, row))
      values[row * width + col] = Number.isFinite(value) ? value : NaN
      if (Number.isFinite(value)) {
        minimum = Math.min(minimum, value)
        maximum = Math.max(maximum, value)
      }
    }
  const hillshade = new Uint8ClampedArray(width * height * 4)
  const relief = new Uint8ClampedArray(width * height * 4)
  const slope = new Uint8ClampedArray(width * height * 4)
  const elevation = new Uint8ClampedArray(width * height * 4)
  const aspect = new Uint8ClampedArray(width * height * 4)
  const write = (buffer: Uint8ClampedArray, index: number, color: Color) => {
    buffer.set([...color, 255], index * 4)
  }
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const index = row * width + col,
        value = values[index]
      if (!Number.isFinite(value)) continue
      write(elevation, index, elevationColor(value, minimum, maximum))
      const west = Math.max(0, col - 1),
        east = Math.min(width - 1, col + 1)
      const north = Math.max(0, row - 1),
        south = Math.min(height - 1, row + 1)
      const neighbours = [
        values[row * width + west],
        values[row * width + east],
        values[north * width + col],
        values[south * width + col],
      ]
      // A missing neighbour does not erase measured ground at this pixel. Prefer a central
      // difference, then a supported one-sided difference. Never bridge a gap or replace a
      // missing centre with an interpolated height: true no-data remains transparent.
      const gradient = (before: number, after: number, beforeDistance: number, afterDistance: number) => {
        if (beforeDistance && afterDistance && Number.isFinite(before) && Number.isFinite(after))
          return (after - before) / (beforeDistance + afterDistance)
        if (afterDistance && Number.isFinite(after)) return (after - value) / afterDistance
        if (beforeDistance && Number.isFinite(before)) return (value - before) / beforeDistance
        return NaN
      }
      const zx = gradient(neighbours[0], neighbours[1], (col - west) * dx, (east - col) * dx)
      const zy = gradient(neighbours[3], neighbours[2], (south - row) * dy, (row - north) * dy)
      if (!Number.isFinite(zx) || !Number.isFinite(zy)) continue
      const normal = Math.hypot(zx, zy, 1)
      // Sun from north-west at 45 degrees; local x is east and y is north.
      const light = clamp((-zx * -0.5 - zy * 0.5 + Math.SQRT1_2) / normal, 0, 1)
      const shade = Math.round(55 + light * 200)
      write(hillshade, index, [shade, shade, shade])
      const tone = reliefShade(light)
      write(relief, index, [tone, tone, tone])
      write(slope, index, slopeColor((Math.atan(Math.hypot(zx, zy)) * 180) / Math.PI))
      const direction = terrainAspectFromGradient(zx, zy)
      if (direction.state === 'aspect') write(aspect, index, aspectColor(direction.degrees))
      else if (direction.state === 'flat') write(aspect, index, flatAspectColor)
    }

  // Count edge crossings before allocating line coordinates (two per segment).
  // This retains 1 m contours where the actual segment budget allows them.
  // An interval change is returned
  // explicitly; no hidden truncation can turn a partially drawn layer into "1 m".
  const cells: { col: number; row: number; heights: [number, number, number, number]; low: number; high: number }[] = []
  for (let row = 0; row < height - 1; row++)
    for (let col = 0; col < width - 1; col++) {
      const heights: [number, number, number, number] = [
        values[row * width + col],
        values[row * width + col + 1],
        values[(row + 1) * width + col + 1],
        values[(row + 1) * width + col],
      ]
      if (!heights.every(Number.isFinite)) continue
      const low = Math.min(...heights),
        high = Math.max(...heights)
      if (high - low > 1e-9) cells.push({ col, row, heights, low, high })
    }
  let contourInterval = 1
  const estimate = (interval: number) =>
    cells.reduce(
      (sum, cell) =>
        sum +
        cell.heights.reduce(
          (crossings, value, edge) =>
            crossings + Math.abs(Math.floor(value / interval) - Math.floor(cell.heights[(edge + 1) % 4] / interval)),
          0,
        ) /
          2,
      0,
    )
  while (estimate(contourInterval) > MAX_CONTOUR_SEGMENTS) contourInterval *= 2
  const contours = new Map<number, Coordinate[][]>()
  for (const cell of cells) {
    const { col, row, heights } = cell
    const corners: Array<[number, number]> = [
      [col, row],
      [col + 1, row],
      [col + 1, row + 1],
      [col, row + 1],
    ]
    for (
      let level = (Math.floor(cell.low / contourInterval) + 1) * contourInterval;
      level <= cell.high;
      level += contourInterval
    ) {
      const intersections: Array<{ edge: number; point: Coordinate }> = []
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4,
          a = heights[edge],
          b = heights[next]
        // Half-open classification avoids double hits on equal-valued corners.
        if (a < level === b < level) continue
        const fraction = (level - a) / (b - a)
        intersections.push({
          edge,
          point: coordinate(
            corners[edge][0] + (corners[next][0] - corners[edge][0]) * fraction,
            corners[edge][1] + (corners[next][1] - corners[edge][1]) * fraction,
          ),
        })
      }
      const lines = contours.get(level) ?? []
      if (intersections.length === 2) lines.push([intersections[0].point, intersections[1].point])
      else if (intersections.length === 4) {
        // Bilinear asymptotic decider for ambiguous saddle cells.
        const a = heights[0] - level,
          b = heights[1] - level,
          c = heights[2] - level,
          d = heights[3] - level
        const pairAdjacent = a * c - b * d >= 0
        const pairs = pairAdjacent
          ? [
              [0, 1],
              [2, 3],
            ]
          : [
              [0, 3],
              [1, 2],
            ]
        for (const [first, second] of pairs) lines.push([intersections[first].point, intersections[second].point])
      }
      if (lines.length) contours.set(level, lines)
    }
  }
  return {
    hillshade: encodePng(hillshade, width, height),
    relief: encodePng(relief, width, height),
    slope: encodePng(slope, width, height),
    elevation: encodePng(elevation, width, height),
    aspect: encodePng(aspect, width, height),
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
