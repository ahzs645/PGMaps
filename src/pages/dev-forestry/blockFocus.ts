/**
 * Which blocks the reviewer is working on, for a scene that may hold a whole district's plan: the block the pickers
 * default to, the blocks a long list shows first, and the blocks *Remove blocks outside the assessment…* takes.
 * Display and editing rules only: nothing here reads or changes the run. Free of DOM and network access.
 */
import { metersPerDegree, pointInPolygon, type PolygonGeometry } from './visibility'

/**
 * The block the reviewer is working on: the selected target when it is a block; else the block the view of interest
 * the assessment stands at faces; else the block the reviewer last selected; else the block the first view of interest
 * faces; else the first block. Null with no blocks. Adopting a landform selects the landform, so without the later
 * rules every picker fell back to the plan's first block.
 */
export function reviewerBlockId(input: {
  blockIds: readonly string[]
  selectedId: string | null
  /** The block the view of interest the assessment stands at faces, if it stands at one. */
  assessedViewBlockId?: string | null
  /** The block the reviewer selected last, kept while a landform or nothing is selected. */
  lastSelectedBlockId?: string | null
  /** The blocks the views of interest face, in the views' order. */
  viewBlockIds?: readonly string[]
}): string | null {
  const known = new Set(input.blockIds)
  const pick = (id: string | null | undefined) => (id && known.has(id) ? id : null)
  return (
    pick(input.selectedId) ??
    pick(input.assessedViewBlockId) ??
    pick(input.lastSelectedBlockId) ??
    (input.viewBlockIds ?? []).map(pick).find((id) => id !== null) ??
    input.blockIds[0] ??
    null
  )
}

/** Above this many blocks, the Cutblocks list folds the blocks nobody is working on. */
export const BLOCK_LIST_FOLD_ABOVE = 12

/**
 * The Cutblocks list split for a long plan: the selected block, the reviewer's block and the blocks the run assessed
 * (in range) shown first, in the list's own order, and the rest folded. At or under `BLOCK_LIST_FOLD_ABOVE` blocks
 * nothing is folded.
 */
export function splitBlockList<T extends { id: string }>(
  blocks: readonly T[],
  keep: { selectedId?: string | null; reviewerId?: string | null; assessedIds?: ReadonlySet<string> },
): { shown: T[]; folded: T[] } {
  if (blocks.length <= BLOCK_LIST_FOLD_ABOVE) return { shown: [...blocks], folded: [] }
  const shown: T[] = []
  const folded: T[] = []
  for (const block of blocks) {
    const kept = block.id === keep.selectedId || block.id === keep.reviewerId || !!keep.assessedIds?.has(block.id)
    ;(kept ? shown : folded).push(block)
  }
  return { shown, folded }
}

type Xy = [number, number]

const distanceToSegment = (p: Xy, a: Xy, b: Xy) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

const cross = (o: Xy, a: Xy, b: Xy) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Whether two segments cross or touch. */
const segmentsMeet = (a: Xy, b: Xy, c: Xy, d: Xy) => {
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const onSegment = (p: Xy, q: Xy, r: Xy) =>
    Math.min(p[0], q[0]) <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) &&
    Math.min(p[1], q[1]) <= r[1] &&
    r[1] <= Math.max(p[1], q[1])
  return (
    (d1 === 0 && onSegment(c, d, a)) ||
    (d2 === 0 && onSegment(c, d, b)) ||
    (d3 === 0 && onSegment(a, b, c)) ||
    (d4 === 0 && onSegment(a, b, d))
  )
}

const segmentDistance = (a: Xy, b: Xy, c: Xy, d: Xy) =>
  segmentsMeet(a, b, c, d)
    ? 0
    : Math.min(
        distanceToSegment(a, c, d),
        distanceToSegment(b, c, d),
        distanceToSegment(c, a, b),
        distanceToSegment(d, a, b),
      )

const ringsOf = (geometry: PolygonGeometry): GeoJSON.Position[][] =>
  geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()

/** A polygon's edges, each a pair of lng/lat points. */
const edgesOf = (geometry: PolygonGeometry): Array<[Xy, Xy]> =>
  ringsOf(geometry).flatMap((ring) =>
    ring.slice(1).map((point, index) => [[ring[index][0], ring[index][1]] as Xy, [point[0], point[1]] as Xy]),
  )

const boundsOf = (points: readonly Xy[]): [number, number, number, number] =>
  points.reduce<[number, number, number, number]>(
    ([w, s, e, n], [x, y]) => [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  )

const boxesMeet = (a: [number, number, number, number], b: [number, number, number, number]) =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/** Whether two polygons share any ground or touch. */
function polygonsMeet(a: PolygonGeometry, b: PolygonGeometry): boolean {
  const aEdges = edgesOf(a),
    bEdges = edgesOf(b)
  if (!aEdges.length || !bEdges.length) return false
  if (!boxesMeet(boundsOf(aEdges.flat()), boundsOf(bEdges.flat()))) return false
  if (aEdges.some(([p]) => pointInPolygon(b, p[0], p[1]))) return true
  if (bEdges.some(([p]) => pointInPolygon(a, p[0], p[1]))) return true
  return aEdges.some(([p, q]) => bEdges.some(([r, s]) => segmentsMeet(p, q, r, s)))
}

/**
 * The blocks *Remove blocks outside the assessment…* removes: those with no part within `maxViewDistanceMeters` of
 * any viewpoint (the road's line or the spot, and every view of interest), that do not touch any of `landforms` (the
 * active landform), and that no view of interest faces (`keepIds`). With no viewpoint at all it removes nothing:
 * there is no assessment to be outside of. Distances are planar over a local equirectangular projection, ample at
 * the 12 km scale. The ids come back in the blocks' order.
 */
export function blocksOutsideAssessment(input: {
  blocks: ReadonlyArray<{ id: string; geometry: PolygonGeometry }>
  /** The road's line (several points) or the spot (one point), and each view of interest as one point. */
  viewpoints: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
  maxViewDistanceMeters: number
  landforms?: readonly PolygonGeometry[]
  /** Blocks kept whatever their distance: the ones views of interest face. */
  keepIds?: ReadonlySet<string>
}): string[] {
  const lines = input.viewpoints
    .map((line) => line.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])))
    .filter((line) => line.length > 0)
  if (!lines.length || !(input.maxViewDistanceMeters >= 0)) return []
  const reach = input.maxViewDistanceMeters
  const allPoints = lines.flat()
  const latitude = allPoints.reduce((sum, point) => sum + point[1], 0) / allPoints.length
  const scale = metersPerDegree(latitude)
  const toXy = (point: readonly [number, number] | GeoJSON.Position): Xy => [point[0] * scale.lng, point[1] * scale.lat]
  // Each viewpoint as metre segments (a point is a segment of no length), with its box grown by the reach.
  const segments = lines.flatMap((line) => {
    const xy = line.map(toXy)
    return (
      xy.length === 1 ? [[xy[0], xy[0]] as [Xy, Xy]] : xy.slice(1).map((point, i) => [xy[i], point] as [Xy, Xy])
    ).map(([a, b]) => {
      const box = boundsOf([a, b])
      return {
        a,
        b,
        box: [box[0] - reach, box[1] - reach, box[2] + reach, box[3] + reach] as [number, number, number, number],
      }
    })
  })
  const landforms = input.landforms ?? []
  return input.blocks
    .filter((block) => {
      if (input.keepIds?.has(block.id)) return false
      if (landforms.some((landform) => polygonsMeet(block.geometry, landform))) return false
      const edges = edgesOf(block.geometry).map(([p, q]) => [toXy(p), toXy(q)] as [Xy, Xy])
      if (!edges.length) return false
      const blockBox = boundsOf(edges.flat())
      // A viewpoint standing inside the block is within reach of it.
      if (allPoints.some((point) => pointInPolygon(block.geometry, point[0], point[1]))) return false
      const near = segments.some(
        (segment) =>
          boxesMeet(blockBox, segment.box) &&
          edges.some(([p, q]) => segmentDistance(p, q, segment.a, segment.b) <= reach),
      )
      return !near
    })
    .map((block) => block.id)
}
