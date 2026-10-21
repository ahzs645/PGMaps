/**
 * Bounded display products made from the selected analytical terrain source.
 * The image/contour grid is a preview; it never replaces the native source used
 * for stationing and quantities. All three PNGs retain transparent no-data.
 */
import type { Coordinate, TerrainSource } from './types'

export interface TerrainDisplay {
  hillshade: string
  slope: string
  elevation: string
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

const MAX_CONTOUR_SEGMENTS = 60_000
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))
type Color = [number, number, number]
const rgb = (hex: string): Color => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]
const slopeColors = TERRAIN_SLOPE_STOPS.map((stop) => ({ value: stop.value, rgb: rgb(stop.color) }))
const elevationColors: Color[] = ['#dce7c6', '#a7bea0', '#698d79', '#baa77c', '#d5cbb2', '#f0eee9'].map(rgb)

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

export function buildTerrainDisplay(
  source: TerrainSource,
  bounds: [number, number, number, number],
  resolution = 160,
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
  const maxSide = Math.round(clamp(Number.isFinite(resolution) ? resolution : 160, 32, 384))
  const midLat = (bounds[1] + bounds[3]) / 2
  const widthMeters = (((bounds[2] - bounds[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((midLat * Math.PI) / 180)
  const heightMeters = (((bounds[3] - bounds[1]) * Math.PI) / 180) * 6371008.8
  const aspect = widthMeters / heightMeters
  const width = Math.max(8, aspect >= 1 ? maxSide : Math.round(maxSide * aspect))
  const height = Math.max(8, aspect <= 1 ? maxSide : Math.round(maxSide / aspect))
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
  const slope = new Uint8ClampedArray(width * height * 4)
  const elevation = new Uint8ClampedArray(width * height * 4)
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
      if (!neighbours.every(Number.isFinite)) continue
      const zx = (neighbours[1] - neighbours[0]) / ((east - west) * dx)
      const zy = (neighbours[2] - neighbours[3]) / ((south - north) * dy)
      const normal = Math.hypot(zx, zy, 1)
      // Sun from north-west at 45 degrees; local x is east and y is north.
      const light = clamp((-zx * -0.5 - zy * 0.5 + Math.SQRT1_2) / normal, 0, 1)
      const shade = Math.round(55 + light * 200)
      write(hillshade, index, [shade, shade, shade])
      write(slope, index, slopeColor((Math.atan(Math.hypot(zx, zy)) * 180) / Math.PI))
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
    slope: encodePng(slope, width, height),
    elevation: encodePng(elevation, width, height),
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
