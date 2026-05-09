// Port of transitive.js (https://github.com/conveyal/transitive.js) overlap
// handling for MapLibre GeoJSON layers.
//
// Transitive's `apply2DOffsets` (lib/graph/graph.js) groups RenderedEdges
// that share an alignment into AlignmentBundles, sorts them, and offsets
// each member perpendicular to the shared line by `(i - bundleWidth/2) * lw`.
// The offsets land on the underlying graph edges, NOT on per-coordinate
// segments — i.e. one offset per rendered edge, applied uniformly along it.
//
// MapLibre's `line-offset` paint property does the equivalent at draw time:
// shift the entire feature perpendicular to its direction by N pixels. So
// instead of mutating coordinates, we annotate each route feature with a
// stable `offsetIndex` (its position in a sorted-route list, centered on
// zero) and let MapLibre apply `offsetIndex * spacing` as the offset.
//
// Trade-off: the offset is per-route, not context-aware (a route keeps the
// same offset whether it's running solo or beside three others). This loses
// transitive's per-edge re-bundling at intersections, but the result is
// continuous geometry that renders cleanly at every zoom level — no
// fragmentation, no jumps where bundles change composition.

export interface RouteInput {
  /** Route short name (e.g. "1", "10"). Drives the lane assignment. */
  routeShortName: string
  /** Stable identifier for the rendered shape. */
  shapeId: string
  /** Route color, propagated to output features. */
  color: string
  /** Original LineString coordinates as [lng, lat] pairs. */
  coordinates: [number, number][]
  /** Any additional properties to copy through to output features. */
  extra?: Record<string, unknown>
}

export interface BundledFeatureProperties {
  routeShortName: string
  shapeId: string
  routeColor: string
  /** Lane offset relative to the bundle center, in lane-units. */
  offsetIndex: number
  /** Total lanes assigned across all visible routes. */
  laneCount: number
  [key: string]: unknown
}

export type BundledFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  BundledFeatureProperties
>

function routeOrderValue(name: string): number {
  const numeric = Number(name)
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER
}

/** Cell size (degrees) used to detect when two routes share a road. */
const OVERLAP_CELL_DEGREES = 0.0008

function overlapCellsForRoute(coords: [number, number][]): Set<string> {
  const cells = new Set<string>()
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]
    const b = coords[i + 1]
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    const sx = Math.round(mx / OVERLAP_CELL_DEGREES)
    const sy = Math.round(my / OVERLAP_CELL_DEGREES)
    cells.add(`${sx}|${sy}`)
  }
  return cells
}

/**
 * Build the route-overlap graph: an edge between two routes whenever they
 * share at least one road cell. This is the GeoJSON analogue of the
 * AlignmentBundle membership in transitive.js — we don't care about the
 * exact alignment, only "do these two routes co-occupy any road?"
 */
function buildOverlapAdjacency(
  routes: RouteInput[],
): Map<string, Set<string>> {
  const cellsByRoute = new Map<string, Set<string>>()
  for (const route of routes) {
    const existing = cellsByRoute.get(route.routeShortName)
    const cells = overlapCellsForRoute(route.coordinates)
    if (existing) {
      cells.forEach((c) => existing.add(c))
    } else {
      cellsByRoute.set(route.routeShortName, cells)
    }
  }

  const adjacency = new Map<string, Set<string>>()
  const names = Array.from(cellsByRoute.keys())
  for (const name of names) adjacency.set(name, new Set())

  for (let i = 0; i < names.length; i++) {
    const a = names[i]
    const aCells = cellsByRoute.get(a)!
    for (let j = i + 1; j < names.length; j++) {
      const b = names[j]
      const bCells = cellsByRoute.get(b)!
      let shared = false
      for (const cell of aCells) {
        if (bCells.has(cell)) {
          shared = true
          break
        }
      }
      if (shared) {
        adjacency.get(a)!.add(b)
        adjacency.get(b)!.add(a)
      }
    }
  }
  return adjacency
}

/**
 * Greedy graph-coloring: process routes in ascending number order, assign
 * each the smallest lane index not used by any of its overlap neighbours.
 * Routes that never overlap any other route keep lane 0 (centerline) —
 * they're not displaced from their actual road. This is the per-route
 * approximation of transitive.js's per-edge re-bundling: lane assignment
 * is global rather than context-dependent, but the maximum offset is the
 * graph's chromatic number rather than the total route count.
 */
function assignLanesByGreedyColoring(
  routes: RouteInput[],
): { laneByRoute: Map<string, number>; laneCount: number } {
  const adjacency = buildOverlapAdjacency(routes)
  const orderedNames = Array.from(adjacency.keys()).sort((a, b) => {
    const av = routeOrderValue(a)
    const bv = routeOrderValue(b)
    return av === bv ? (a < b ? -1 : a > b ? 1 : 0) : av - bv
  })

  const laneByRoute = new Map<string, number>()
  let maxLane = 0
  for (const name of orderedNames) {
    const used = new Set<number>()
    for (const neighbour of adjacency.get(name) ?? []) {
      const lane = laneByRoute.get(neighbour)
      if (lane !== undefined) used.add(lane)
    }
    let lane = 0
    while (used.has(lane)) lane++
    laneByRoute.set(name, lane)
    if (lane > maxLane) maxLane = lane
  }

  return { laneByRoute, laneCount: maxLane + 1 }
}

/**
 * Assign each visible route a lane index (smallest possible, given the
 * overlap graph) and emit one feature per input shape with the centered
 * offset stamped on. Renders correctly with
 * `line-offset = ['*', ['get', 'offsetIndex'], spacingPx]` because
 * MapLibre handles the perpendicular projection per pixel.
 */
export function bundleRoutes(routes: RouteInput[]): BundledFeatureCollection {
  const { laneByRoute, laneCount } = assignLanesByGreedyColoring(routes)
  const center = (laneCount - 1) / 2

  const features: GeoJSON.Feature<GeoJSON.LineString, BundledFeatureProperties>[] =
    routes.map((route) => {
      const lane = laneByRoute.get(route.routeShortName) ?? 0
      return {
        type: 'Feature',
        id: route.shapeId,
        geometry: { type: 'LineString', coordinates: route.coordinates },
        properties: {
          ...(route.extra ?? {}),
          routeShortName: route.routeShortName,
          shapeId: route.shapeId,
          routeColor: route.color,
          offsetIndex: lane - center,
          laneCount,
        },
      }
    })

  return { type: 'FeatureCollection', features }
}

/**
 * Equivalent of transitive.js `ZoomFactor`. The active factor changes the
 * lane spacing applied to `line-offset`, mirroring the way transitive.js
 * varies `lw` (lane width) inside `apply2DOffsets` based on scale. Smaller
 * spacing at low zoom keeps the bundle compact (schematic-feel); larger
 * spacing at high zoom spreads lanes out so individual routes are clear.
 */
export interface TransitiveZoomFactor {
  minZoom: number
  /** Pixel spacing between adjacent lanes at this zoom tier. */
  laneSpacingPx: number
  /** Base line width in pixels at this zoom tier. */
  lineWidthPx: number
  /** Halo width in pixels at this zoom tier. */
  haloWidthPx: number
}

export const DEFAULT_TRANSITIVE_ZOOM_FACTORS: TransitiveZoomFactor[] = [
  { minZoom: 0, laneSpacingPx: 1.4, lineWidthPx: 1.6, haloWidthPx: 3 },
  { minZoom: 12, laneSpacingPx: 1.8, lineWidthPx: 2.4, haloWidthPx: 4.5 },
  { minZoom: 14, laneSpacingPx: 2.4, lineWidthPx: 3.2, haloWidthPx: 6 },
  { minZoom: 16, laneSpacingPx: 3.2, lineWidthPx: 4.5, haloWidthPx: 8.5 },
]

export function selectZoomFactor(
  zoom: number,
  factors: TransitiveZoomFactor[] = DEFAULT_TRANSITIVE_ZOOM_FACTORS,
): TransitiveZoomFactor {
  let active = factors[0]
  for (const factor of factors) {
    if (zoom >= factor.minZoom) active = factor
  }
  return active
}
