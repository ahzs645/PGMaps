// Port of transitive.js overlap/bundling logic for MapLibre GeoJSON layers.
//
// Background — see https://github.com/conveyal/transitive.js
//
// Transitive's `apply2DOffsets` (lib/graph/graph.js) groups RenderedEdges that
// share an "alignment" (same line in 2D space) into AlignmentBundles, then
// offsets each member perpendicular to the shared line so overlapping route
// patterns appear side-by-side instead of stacked. The original library
// computes alignments from full edge directions and elbow geometry; for
// MapLibre LineStrings we operate on a discretised version: each route is
// split into segment pairs, each segment is hashed by its snapped midpoint
// and quantised bearing, and segments sharing that key form a bundle.
//
// The bundle key is the GeoJSON-equivalent of transitive.js's
// `alignmentId` (lib/graph/edge.js#calculateAlignmentId). The grid snap and
// angle quantum mirror the per-zoom `gridCellSize` / `angleConstraint` from
// the `ZoomFactor` config.

export interface RouteInput {
  /** Route short name (e.g. "1", "10"). Used as a stable sort key inside a bundle. */
  routeShortName: string
  /** Stable identifier for the rendered shape (one route may have multiple shapes). */
  shapeId: string
  /** Route color, propagated to output features. */
  color: string
  /** Original LineString coordinates as [lng, lat] pairs. */
  coordinates: [number, number][]
  /** Any additional properties to copy through to output features. */
  extra?: Record<string, unknown>
}

export interface BundlingOptions {
  /**
   * Cell size for snapping midpoints, in degrees. Smaller -> stricter
   * alignment matching (fewer false positives but more visual chatter at
   * curves). transitive.js uses meters in SphericalMercator; we use degrees
   * directly because the data is already in lng/lat and the city is small.
   */
  gridCellDegrees: number
  /**
   * Bearing quantisation in degrees. Two segments are considered the same
   * alignment if their bearings round to the same multiple of this value.
   * Mirrors `angleConstraint` in transitive.js zoomFactors.
   */
  angleConstraintDegrees: number
  /**
   * Perpendicular spacing between bundled lanes, in degrees. Roughly
   * lng/lat units; small enough to remain readable at the typical zoom
   * range used for the transit map.
   */
  laneSpacingDegrees: number
}

export interface BundledFeatureProperties {
  routeShortName: string
  shapeId: string
  routeColor: string
  /** Index of this lane within its bundle, 0-based. */
  laneIndex: number
  /** Total lanes in the bundle this feature belongs to. */
  laneCount: number
  /**
   * Pre-computed perpendicular offset in degrees. Useful when MapLibre's
   * line-offset (which is in pixels) is not desired and instead we shift the
   * geometry directly during a feature pass.
   */
  offsetDegrees: number
  [key: string]: unknown
}

export type BundledFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  BundledFeatureProperties
>

interface SegmentRecord {
  routeShortName: string
  shapeId: string
  color: string
  extra: Record<string, unknown>
  /** Index of this segment within its source route. */
  index: number
  /** Snapped + quantised key — segments sharing this key form a bundle. */
  bundleKey: string
  /** Per-segment unit perpendicular vector (right-hand side of travel direction). */
  perpendicular: [number, number]
}

interface SegmentInBundle extends SegmentRecord {
  laneIndex: number
  laneCount: number
}

function snap(value: number, cell: number): number {
  return Math.round(value / cell) * cell
}

function quantiseBearing(degrees: number, quantum: number): number {
  // Bearings differing by 180° represent the same alignment line.
  let normalised = ((degrees % 180) + 180) % 180
  normalised = Math.round(normalised / quantum) * quantum
  return normalised % 180
}

function bearingDegrees(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

function buildBundleKey(
  midpoint: [number, number],
  bearing: number,
  cell: number,
  angleQuantum: number,
): string {
  const sx = snap(midpoint[0], cell)
  const sy = snap(midpoint[1], cell)
  const sb = quantiseBearing(bearing, angleQuantum)
  return `${sx.toFixed(5)}|${sy.toFixed(5)}|${sb}`
}

function perpendicularUnit(a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len === 0) return [0, 0]
  // 90° clockwise rotation -> right-hand perpendicular
  return [dy / len, -dx / len]
}

/**
 * Build per-segment records for every input route. One record per
 * consecutive coordinate pair.
 */
function explodeSegments(
  routes: RouteInput[],
  options: BundlingOptions,
): SegmentRecord[] {
  const records: SegmentRecord[] = []
  for (const route of routes) {
    const coords = route.coordinates
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i]
      const b = coords[i + 1]
      if (a[0] === b[0] && a[1] === b[1]) continue
      const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const bearing = bearingDegrees(a, b)
      const bundleKey = buildBundleKey(
        midpoint,
        bearing,
        options.gridCellDegrees,
        options.angleConstraintDegrees,
      )
      records.push({
        routeShortName: route.routeShortName,
        shapeId: route.shapeId,
        color: route.color,
        extra: route.extra ?? {},
        index: i,
        bundleKey,
        perpendicular: perpendicularUnit(a, b),
      })
    }
  }
  return records
}

/**
 * Group records by bundle key and assign lane indices. The sort order
 * within a bundle keeps colocated routes in a stable visual sequence
 * (same convention transitive.js uses via patternId comparisons).
 */
function assignLanes(records: SegmentRecord[]): Map<string, SegmentInBundle> {
  const byBundle = new Map<string, SegmentRecord[]>()
  for (const record of records) {
    const list = byBundle.get(record.bundleKey)
    if (list) list.push(record)
    else byBundle.set(record.bundleKey, [record])
  }

  const out = new Map<string, SegmentInBundle>()
  byBundle.forEach((list) => {
    // Within a bundle, dedupe by shape so a single route shape only
    // claims one lane regardless of how many segments it contributes.
    const shapesInBundle: string[] = []
    list.forEach((record) => {
      if (!shapesInBundle.includes(record.shapeId)) shapesInBundle.push(record.shapeId)
    })
    shapesInBundle.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    const laneCount = shapesInBundle.length
    const shapeLane = new Map<string, number>()
    shapesInBundle.forEach((shapeId, idx) => shapeLane.set(shapeId, idx))

    list.forEach((record) => {
      const laneIndex = shapeLane.get(record.shapeId) ?? 0
      const key = `${record.shapeId}#${record.index}`
      out.set(key, { ...record, laneIndex, laneCount })
    })
  })
  return out
}

/**
 * Walk each route in order, emit one feature per maximal run of segments
 * that share the same lane signature inside their bundle. Each emitted
 * LineString is offset perpendicular to its travel direction by
 * `(laneIndex - (laneCount - 1) / 2) * laneSpacing`. This matches the
 * spread `-bundleWidth / 2 + i * lw` used in apply2DOffsets.
 */
export function bundleRoutes(
  routes: RouteInput[],
  options: BundlingOptions,
): BundledFeatureCollection {
  const records = explodeSegments(routes, options)
  const lanes = assignLanes(records)

  const features: GeoJSON.Feature<GeoJSON.LineString, BundledFeatureProperties>[] = []

  for (const route of routes) {
    const coords = route.coordinates
    if (coords.length < 2) continue

    type RunSegment = SegmentInBundle & { from: [number, number]; to: [number, number] }

    let activeRun: RunSegment[] = []
    let runIndex = 0

    const flushRun = () => {
      if (activeRun.length === 0) return
      const first = activeRun[0]
      const offsetDegrees =
        (first.laneIndex - (first.laneCount - 1) / 2) * options.laneSpacingDegrees

      // For each vertex along the run, use the bisector of adjacent
      // segment perpendiculars so the offset polyline doesn't kink at
      // every coordinate. transitive.js has a TODO for this in
      // renderededge.js#getGeometricCoords; we just do it here.
      const offsetCoords: [number, number][] = []
      const perpAt = (idx: number, fallback: [number, number]): [number, number] => {
        const seg = activeRun[idx]
        if (!seg) return fallback
        return seg.perpendicular
      }
      for (let i = 0; i <= activeRun.length; i++) {
        const prev = perpAt(i - 1, activeRun[i]?.perpendicular ?? [0, 0])
        const next = perpAt(i, activeRun[i - 1]?.perpendicular ?? [0, 0])
        const px = (prev[0] + next[0]) / 2
        const py = (prev[1] + next[1]) / 2
        const len = Math.hypot(px, py) || 1
        const ox = (px / len) * offsetDegrees
        const oy = (py / len) * offsetDegrees
        const vertex = i === 0 ? activeRun[0].from : activeRun[i - 1].to
        offsetCoords.push([vertex[0] + ox, vertex[1] + oy])
      }

      features.push({
        type: 'Feature',
        id: `${route.shapeId}#${runIndex++}`,
        geometry: { type: 'LineString', coordinates: offsetCoords },
        properties: {
          ...route.extra,
          routeShortName: route.routeShortName,
          shapeId: route.shapeId,
          routeColor: route.color,
          laneIndex: first.laneIndex,
          laneCount: first.laneCount,
          offsetDegrees,
        },
      })
      activeRun = []
    }

    for (let i = 0; i < coords.length - 1; i++) {
      const lane = lanes.get(`${route.shapeId}#${i}`)
      if (!lane) continue
      const segment: RunSegment = {
        ...lane,
        from: coords[i],
        to: coords[i + 1],
      }
      if (activeRun.length === 0) {
        activeRun.push(segment)
        continue
      }
      const head = activeRun[0]
      // Same lane signature -> chain. Different signature -> flush and start new run.
      if (head.laneIndex === segment.laneIndex && head.laneCount === segment.laneCount) {
        activeRun.push(segment)
      } else {
        flushRun()
        activeRun.push(segment)
      }
    }
    flushRun()
  }

  return { type: 'FeatureCollection', features }
}

/**
 * Equivalent of transitive.js `ZoomFactor`. Each entry kicks in once the
 * map zoom is greater-than-or-equal to `minZoom`, taking precedence over
 * earlier (lower-zoom) entries. The lookup mirrors `updateActiveZoomFactors`
 * in lib/display/display.js — find the highest-minimum-zoom factor we are
 * still above.
 *
 * Higher zoom -> finer grid + tighter angle quantum + smaller spacing,
 * because at street-level we want to see distinct routes; lower zoom
 * groups more aggressively so the network reads as a clean schematic.
 */
export interface TransitiveZoomFactor extends BundlingOptions {
  minZoom: number
}

export const DEFAULT_TRANSITIVE_ZOOM_FACTORS: TransitiveZoomFactor[] = [
  // Schematic / regional view: aggressive bundling, wide lane spread.
  {
    minZoom: 0,
    gridCellDegrees: 0.0035,
    angleConstraintDegrees: 30,
    laneSpacingDegrees: 0.0008,
  },
  {
    minZoom: 12,
    gridCellDegrees: 0.0018,
    angleConstraintDegrees: 20,
    laneSpacingDegrees: 0.0005,
  },
  // Street level: finer bundles, smaller offsets so they feel like
  // adjacent paint stripes rather than separate routes.
  {
    minZoom: 14,
    gridCellDegrees: 0.0008,
    angleConstraintDegrees: 12,
    laneSpacingDegrees: 0.00025,
  },
  {
    minZoom: 16,
    gridCellDegrees: 0.00035,
    angleConstraintDegrees: 8,
    laneSpacingDegrees: 0.00012,
  },
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
