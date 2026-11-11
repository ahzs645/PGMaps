/**
 * A landform as a planner reads one off the view: each layer of ridge seen
 * from the road is one landform.
 *
 * Standing on the highway, the hills stack up in bands — the near slope, the
 * ridge behind it, the range behind that — and each band's lower edge is where
 * a nearer ridge hides the ground in front of it. This reading finds those
 * bands from the elevation model. From a station it sweeps rays across the
 * ground around the block, keeps the running horizon along each ray, and marks
 * every range bin visible or hidden. Visible bins join into one layer when they
 * touch, along a ray or across to the next; a ridge that hides the ground
 * behind it breaks the run, so the ground reappearing beyond it starts a new
 * layer unless it joins round the side. The landform is the layer most of the
 * block's visible ground falls in.
 *
 * Along a drive the same ridge is seen from many places. The reading repeats
 * for up to `MAX_RIDGE_STATIONS` stations and keeps the union of the block's
 * layer from each that sees the block — "as you're driving by", not from one
 * pull-out.
 *
 * It differs from `landformFromTerrain.ts`, which grows the slope the block
 * faces the viewer on: that one stops where the ground turns away, this one
 * where the view breaks. Both return a candidate the reviewer adopts or not.
 * Hidden pockets inside the layer are filled, as in the other reading, so the
 * run's own sightlines decide what of the landform is in view.
 *
 * Pure: no DOM, no network.
 */
import type { LandformBoundary, TerrainLandform } from './landformFromTerrain'
import { morph, signedArea, simplifyRing, traceRings } from './landformFromTerrain'
import type { ElevationSource } from './terrain'
import {
  earthCurvatureDropMeters,
  metersPerDegree,
  pointInPolygon,
  polygonAreaMeters,
  polygonBounds,
  type PolygonGeometry,
} from './visibility'

export type RidgeLayerOptions = {
  /** Output grid cell, metres. */
  cellMeters?: number
  /** How far from the block the landform may reach, metres. */
  radiusMeters?: number
  eyeHeightMeters?: number
  /** Angle between rays, degrees. */
  rayStepDegrees?: number
  /** Range bin along a ray, metres. */
  binMeters?: number
  maxDistanceMeters?: number
  /**
   * Ground gentler than this and lower than the block is valley floor, not
   * hillside, percent. Seen from a road across a broad valley nothing hides the
   * foreground, so without this the layer runs down onto the flats to the road.
   */
  minSlopePercent?: number
}

export const RIDGE_LAYER_DEFAULTS = {
  cellMeters: 50,
  radiusMeters: 5000,
  eyeHeightMeters: 1.6,
  rayStepDegrees: 0.25,
  binMeters: 25,
  maxDistanceMeters: 12000,
  /** As `landformFromTerrain.ts` reads the valley floor. */
  minSlopePercent: 8,
} as const

/** Stations read along a drive; more adds time, not much ground. */
export const MAX_RIDGE_STATIONS = 8
const MAX_RAYS = 1440
const MAX_BINS = 800
/** The largest other layers returned for the map, by area. */
const MAX_LAYERS_SHOWN = 6

export type RidgeLayer = {
  geometry: GeoJSON.Polygon
  areaHectares: number
  /** Mean distance from the station, metres: layer 1 is the nearest. */
  meanDistanceMeters: number
  containsBlock: boolean
}

export type RidgeLayerLandform = TerrainLandform & {
  method: 'ridge-layer'
  stationCount: number
  /** Stations from which some of the block is in view. */
  stationsSeeing: number
  /** The layers seen from the first station that sees the block, nearest first. */
  layers: RidgeLayer[]
}

type Station = { lng: number; lat: number }

/** Labels of one station's view, rasterised onto the output grid. */
type StationView = {
  /** ≥0: layer id; -1 hidden; -2 unknown terrain; -3 outside the swept window. */
  labels: Int32Array
  /** Distance of each grid cell from the station, metres. */
  range: Float64Array
}

function stationView(
  source: ElevationSource,
  station: Station,
  grid: { width: number; height: number; cellCentre: (x: number, y: number) => [number, number] },
  options: Required<RidgeLayerOptions>,
): StationView {
  const { width, height, cellCentre } = grid
  const scale = metersPerDegree(station.lat)
  const toLocal = (lng: number, lat: number): [number, number] => [
    (lng - station.lng) * scale.lng,
    (lat - station.lat) * scale.lat,
  ]
  // The window of bearings and ranges that covers the grid.
  const corners = [
    cellCentre(0, 0),
    cellCentre(width - 1, 0),
    cellCentre(0, height - 1),
    cellCentre(width - 1, height - 1),
  ]
  const [gx0, gy0] = toLocal(...corners[0])
  const [gx1, gy1] = toLocal(...corners[3])
  const inside = gx0 <= 0 && gx1 >= 0 && gy0 <= 0 && gy1 >= 0
  const bearings = corners.map(([lng, lat]) => {
    const [x, y] = toLocal(lng, lat)
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  })
  let start = 0,
    span = 360
  if (!inside) {
    // The smallest arc holding every corner: start after the widest gap.
    const sorted = [...bearings].sort((a, b) => a - b)
    let gap = -1
    for (let i = 0; i < sorted.length; i += 1) {
      const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360
      if (next - sorted[i] > gap) {
        gap = next - sorted[i]
        start = next % 360
      }
    }
    span = 360 - gap
  }
  const rays = Math.min(MAX_RAYS, Math.max(2, Math.ceil(span / options.rayStepDegrees) + 1))
  const rayStep = inside ? 360 / rays : span / (rays - 1)
  const farthest = Math.max(...corners.map(([lng, lat]) => Math.hypot(...toLocal(lng, lat))))
  const reach = Math.min(options.maxDistanceMeters, farthest + options.binMeters)
  const bin = Math.max(options.binMeters, reach / MAX_BINS)
  const bins = Math.max(2, Math.ceil(reach / bin))
  const groundAt = source.elevationAt(station.lng, station.lat)
  const eye = groundAt + options.eyeHeightMeters

  // 1 visible, 0 hidden, 2 unknown.
  const vis = new Uint8Array(rays * bins)
  if (Number.isFinite(eye))
    for (let k = 0; k < rays; k += 1) {
      const theta = ((start + k * rayStep) * Math.PI) / 180
      const sin = Math.sin(theta),
        cos = Math.cos(theta)
      let horizon = -Infinity
      for (let j = 1; j < bins; j += 1) {
        const d = j * bin
        const z = source.elevationAt(station.lng + (d * sin) / scale.lng, station.lat + (d * cos) / scale.lat)
        if (!Number.isFinite(z)) {
          vis[k * bins + j] = 2
          continue
        }
        const tangent = (z - eye - earthCurvatureDropMeters(d)) / d
        if (tangent >= horizon - 1e-9) vis[k * bins + j] = 1
        if (tangent > horizon) horizon = tangent
      }
      // A one-bin dip out of sight is a hollow in the slope, not a ridge line.
      for (let j = 2; j < bins - 1; j += 1) {
        const i = k * bins + j
        if (vis[i] === 0 && vis[i - 1] === 1 && vis[i + 1] === 1) vis[i] = 1
      }
    }
  else vis.fill(2)

  // Union–find over visible bins, along rays and across neighbouring rays.
  const parent = new Int32Array(rays * bins).map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const join = (a: number, b: number) => {
    const ra = find(a),
      rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let k = 0; k < rays; k += 1)
    for (let j = 1; j < bins; j += 1) {
      const i = k * bins + j
      if (vis[i] !== 1) continue
      if (j + 1 < bins && vis[i + 1] === 1) join(i, i + 1)
      const nk = k + 1 < rays ? k + 1 : inside ? 0 : -1
      if (nk >= 0 && vis[nk * bins + j] === 1) join(i, nk * bins + j)
    }

  const labels = new Int32Array(width * height)
  const range = new Float64Array(width * height)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const [lng, lat] = cellCentre(x, y)
      const [lx, ly] = toLocal(lng, lat)
      const distance = Math.hypot(lx, ly)
      const index = y * width + x
      range[index] = distance
      const bearing = ((Math.atan2(lx, ly) * 180) / Math.PI + 360) % 360
      let offset = (bearing - start + 360) % 360
      if (inside && offset > 360 - rayStep / 2) offset -= 360
      const k = Math.round(offset / rayStep),
        j = Math.round(distance / bin)
      if (k < 0 || j < 1 || j >= bins || (inside ? false : k >= rays)) {
        labels[index] = -3
        continue
      }
      const i = ((k + rays) % rays) * bins + j
      labels[index] = vis[i] === 1 ? find(i) : vis[i] === 2 ? -2 : -1
    }
  return { labels, range }
}

function outline(
  mask: Uint8Array,
  width: number,
  height: number,
  corner: (x: number, y: number) => [number, number],
): GeoJSON.Polygon | null {
  const rings = traceRings(mask, width, height)
  if (!rings.length) return null
  const outer = rings.reduce((best, ring) => (signedArea(ring) > signedArea(best) ? ring : best))
  const coordinates = simplifyRing(outer, 0.75).map(([x, y]) => corner(x, y))
  coordinates.push(coordinates[0])
  return { type: 'Polygon', coordinates: [coordinates] }
}

/** Fill the holes of a mask: anything not reachable from the border without crossing it. */
function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(mask.length)
  const queue: number[] = []
  const seed = (x: number, y: number) => {
    const i = y * width + x
    if (!mask[i] && !outside[i]) {
      outside[i] = 1
      queue.push(i)
    }
  }
  for (let x = 0; x < width; x += 1) {
    seed(x, 0)
    seed(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    seed(0, y)
    seed(width - 1, y)
  }
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head]
    const x = i % width,
      y = (i - x) / width
    if (x > 0) seed(x - 1, y)
    if (x + 1 < width) seed(x + 1, y)
    if (y > 0) seed(x, y - 1)
    if (y + 1 < height) seed(x, y + 1)
  }
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i += 1) out[i] = outside[i] ? 0 : 1
  return out
}

/** The 4-connected part of `mask` holding any of `seeds`. */
function connectedTo(mask: Uint8Array, width: number, height: number, seeds: number[]): Uint8Array {
  const out = new Uint8Array(mask.length)
  const queue = seeds.filter((i) => mask[i])
  for (const i of queue) out[i] = 1
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head]
    const x = i % width,
      y = (i - x) / width
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (mask[j] && !out[j]) {
        out[j] = 1
        queue.push(j)
      }
    }
  }
  return out
}

/**
 * The ridge layer the block sits in, seen from `stations` (up to
 * `MAX_RIDGE_STATIONS` are read, evenly spread). Null when no station sees any
 * of the block, or no terrain loaded under it.
 */
export function ridgeLayerLandform(
  source: ElevationSource,
  block: PolygonGeometry,
  stations: ReadonlyArray<Station>,
  options: RidgeLayerOptions = {},
): RidgeLayerLandform | null {
  const o: Required<RidgeLayerOptions> = { ...RIDGE_LAYER_DEFAULTS, ...options }
  if (!stations.length) return null
  const picked =
    stations.length <= MAX_RIDGE_STATIONS
      ? [...stations]
      : Array.from(
          { length: MAX_RIDGE_STATIONS },
          (_, i) => stations[Math.round((i * (stations.length - 1)) / (MAX_RIDGE_STATIONS - 1))],
        )
  const [west, south, east, north] = polygonBounds(block)
  const centre = { lng: (west + east) / 2, lat: (south + north) / 2 }
  const scale = metersPerDegree(centre.lat)
  const half = Math.ceil(o.radiusMeters / o.cellMeters)
  const width = 2 * half + 1,
    height = width
  const toLngLat = (mx: number, my: number): [number, number] => [
    centre.lng + mx / scale.lng,
    centre.lat + my / scale.lat,
  ]
  const cellCentre = (x: number, y: number) => toLngLat((x - half) * o.cellMeters, (y - half) * o.cellMeters)
  const corner = (x: number, y: number) => toLngLat((x - half - 0.5) * o.cellMeters, (y - half - 0.5) * o.cellMeters)

  const blockCells: number[] = []
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const [lng, lat] = cellCentre(x, y)
      if (pointInPolygon(block, lng, lat)) blockCells.push(y * width + x)
    }
  // A block smaller than a cell still has a cell: the one under its centre.
  if (!blockCells.length) blockCells.push(half * width + half)

  const union = new Uint8Array(width * height)
  let seeing = 0
  let first: StationView | null = null
  let firstLabel = -1
  for (const station of picked) {
    const view = stationView(source, station, { width, height, cellCentre }, o)
    const votes = new Map<number, number>()
    for (const i of blockCells) if (view.labels[i] >= 0) votes.set(view.labels[i], (votes.get(view.labels[i]) ?? 0) + 1)
    if (!votes.size) continue
    const label = [...votes].sort((a, b) => b[1] - a[1])[0][0]
    seeing += 1
    if (!first) {
      first = view
      firstLabel = label
    }
    for (let i = 0; i < union.length; i += 1) if (view.labels[i] === label) union[i] = 1
  }
  if (!first) return null

  // Valley floor: flat ground below the block, read over about 150 m.
  const raw = new Float64Array(width * height)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) raw[y * width + x] = source.elevationAt(...cellCentre(x, y))
  const smooth = new Float64Array(raw.length)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let sum = 0,
        count = 0
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx,
            ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const z = raw[ny * width + nx]
          if (Number.isFinite(z)) {
            sum += z
            count += 1
          }
        }
      smooth[y * width + x] = count ? sum / count : NaN
    }
  let blockFloor = Infinity
  for (const i of blockCells) if (Number.isFinite(smooth[i])) blockFloor = Math.min(blockFloor, smooth[i])
  const valley = new Uint8Array(raw.length)
  const minSlope = o.minSlopePercent / 100
  for (let y = 1; y < height - 1; y += 1)
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      const gx = (smooth[i + 1] - smooth[i - 1]) / (2 * o.cellMeters),
        gy = (smooth[i + width] - smooth[i - width]) / (2 * o.cellMeters)
      if (Number.isFinite(gx) && Number.isFinite(gy) && Math.hypot(gx, gy) < minSlope && smooth[i] < blockFloor)
        valley[i] = 1
    }
  for (const i of blockCells) valley[i] = 0

  // Close one-cell notches, fill the hidden pockets, drop the valley floor, keep the piece on the block.
  const closed = morph(morph(union, width, height, 1, true), width, height, 1, false)
  for (const i of blockCells) closed[i] = 1
  const filled = fillHoles(closed, width, height)
  for (let i = 0; i < filled.length; i += 1) if (valley[i]) filled[i] = 0
  const region = connectedTo(filled, width, height, blockCells)
  const geometry = outline(region, width, height, corner)
  if (!geometry) return null

  // Why the outline stops, read from the first station that saw the block.
  const tally = new Map<LandformBoundary, number>()
  let edges = 0,
    reachedLimit = false
  for (let i = 0; i < region.length; i += 1) {
    if (!region[i]) continue
    const x = i % width,
      y = (i - x) / width
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      let why: LandformBoundary
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        why = 'search-limit'
        reachedLimit = true
      } else {
        const j = ny * width + nx
        if (region[j]) continue
        const label = first.labels[j]
        why = valley[j]
          ? 'flat'
          : label === -3
            ? 'search-limit'
            : label === -2
              ? 'no-data'
              : first.range[j] >= first.range[i]
                ? 'skyline'
                : 'nearer-ridge'
      }
      edges += 1
      tally.set(why, (tally.get(why) ?? 0) + 1)
    }
  }
  let cells = 0
  for (const value of region) cells += value

  // The other layers from that station, for the map: the bands as seen.
  const areas = new Map<number, { cells: number; distance: number }>()
  for (let i = 0; i < first.labels.length; i += 1) {
    const label = first.labels[i]
    if (label < 0) continue
    const entry = areas.get(label) ?? { cells: 0, distance: 0 }
    entry.cells += 1
    entry.distance += first.range[i]
    areas.set(label, entry)
  }
  // The largest bands, and always the block's own.
  const ranked = [...areas].filter(([, entry]) => entry.cells >= 20).sort((a, b) => b[1].cells - a[1].cells)
  const own = areas.get(firstLabel)
  const kept = [
    ...(own ? [[firstLabel, own] as const] : []),
    ...ranked.filter(([label]) => label !== firstLabel).slice(0, MAX_LAYERS_SHOWN - 1),
  ]
  const layers: RidgeLayer[] = kept
    .flatMap(([label, entry]): RidgeLayer[] => {
      const mask = new Uint8Array(first!.labels.length)
      for (let i = 0; i < mask.length; i += 1) if (first!.labels[i] === label) mask[i] = 1
      const shape = outline(mask, width, height, corner)
      return shape
        ? [
            {
              geometry: shape,
              areaHectares: (entry.cells * o.cellMeters * o.cellMeters) / 10_000,
              meanDistanceMeters: entry.distance / entry.cells,
              containsBlock: label === firstLabel,
            },
          ]
        : []
    })
    .sort((a, b) => a.meanDistanceMeters - b.meanDistanceMeters)

  return {
    method: 'ridge-layer',
    geometry,
    areaHectares: polygonAreaMeters(geometry) / 10_000,
    boundedBy: Object.fromEntries([...tally].map(([key, count]) => [key, count / Math.max(1, edges)])),
    reachedLimit,
    blockOnly: cells <= blockCells.length * 2.5 + 4,
    viewerClose: false,
    stationCount: picked.length,
    stationsSeeing: seeing,
    layers,
  }
}
