/**
 * Freehand road sketching and extension. A stroke is thinned to the corners a pencil meant, then
 * its corners get the project's minimum radius (reduced where tangents are short), so the sketch is
 * a road the engine can station rather than a wiggle. Pure: no DOM or network access.
 */
import { distance } from './engine'
import { fitHorizontalRadii } from './horizontalTools'
import { simplifyPath } from './mapNotes'
import type { Alignment, Coordinate, RoadPoint } from './types'

/** Hand tremor and pointer jitter below this many screen pixels are not corners. */
export const SKETCH_TOLERANCE_PX = 4
/** Nor are deviations under this many metres, however far the map is zoomed in. */
export const SKETCH_MIN_TOLERANCE_M = 2
/** A stroke or peg that starts within this many pixels of a road end continues that road. */
export const EXTEND_SNAP_PX = 14

/** The corners of a freehand stroke: Ramer–Douglas–Peucker at the larger of the two tolerances. */
export function sketchPoints(stroke: Coordinate[], metresPerPixel: number): Coordinate[] {
  const tolerance = Math.max(SKETCH_MIN_TOLERANCE_M, metresPerPixel * SKETCH_TOLERANCE_PX)
  return dedupe(simplifyPath(dedupe(stroke), tolerance))
}

function dedupe(points: Coordinate[]) {
  return points.filter((p, i) => i === 0 || distance(points[i - 1], p) >= 0.5)
}

export type RoadEnd = 'start' | 'end'

/**
 * Which end of `alignment` a stroke continues, if any, and the stroke turned to run away from it.
 * A stroke may start at the road or finish at it.
 */
export function strokeContinuation(
  alignment: Pick<Alignment, 'points'>,
  stroke: Coordinate[],
  metresPerPixel: number,
): { end: RoadEnd; added: Coordinate[] } | null {
  if (alignment.points.length < 2 || stroke.length < 2) return null
  const snap = EXTEND_SNAP_PX * metresPerPixel
  const start = alignment.points[0].coordinate,
    end = alignment.points.at(-1)!.coordinate
  const first = stroke[0],
    last = stroke.at(-1)!
  const options: { gap: number; end: RoadEnd; added: Coordinate[] }[] = [
    { gap: distance(first, end), end: 'end', added: stroke },
    { gap: distance(last, end), end: 'end', added: [...stroke].reverse() },
    { gap: distance(first, start), end: 'start', added: stroke },
    { gap: distance(last, start), end: 'start', added: [...stroke].reverse() },
  ]
  const best = options.filter((o) => o.gap <= snap).sort((a, b) => a.gap - b.gap)[0]
  return best ? { end: best.end, added: best.added } : null
}

/** The road end nearer `at`. */
export function nearerEnd(alignment: Pick<Alignment, 'points'>, at: Coordinate): RoadEnd {
  return distance(at, alignment.points[0].coordinate) < distance(at, alignment.points.at(-1)!.coordinate)
    ? 'start'
    : 'end'
}

/**
 * Inputs measured along the road. Adding at the start would move every one of them, so only the
 * end can be extended while any are present.
 */
export function hasStationedInputs(alignment: Alignment): boolean {
  return !!(
    alignment.vertical.length ||
    alignment.overrides.length ||
    alignment.engineering ||
    alignment.crossingRecords?.length ||
    alignment.verticalControls?.length ||
    alignment.verticalAlternatives?.length
  )
}

/**
 * Continues `alignment` from `end` through `added`, which runs away from the road. The new corners
 * and the old end, now a corner, take `minRadiusM` where their tangents allow; existing corners keep
 * their radii.
 */
export function extendAlignment(
  alignment: Alignment,
  added: Coordinate[],
  end: RoadEnd,
  newId: () => string,
  minRadiusM: number,
): Alignment {
  if (alignment.mappedRoad) throw Error('A mapped road is held as recorded. Copy it as a design to extend it.')
  if (end === 'start' && hasStationedInputs(alignment))
    throw Error(
      'This road has profile, width or engineering inputs measured from its start. Extend it from its end instead.',
    )
  const joint = end === 'end' ? alignment.points.at(-1)! : alignment.points[0]
  const fresh = dedupe([joint.coordinate, ...added])
    .slice(1)
    .map((coordinate): RoadPoint => ({ id: newId(), coordinate, radiusM: 0 }))
  if (!fresh.length) throw Error('Draw past the end of the road to extend it.')
  const combined = end === 'end' ? [...alignment.points, ...fresh] : [...[...fresh].reverse(), ...alignment.points]
  const keep = new Map(alignment.points.filter((p) => p.id !== joint.id).map((p) => [p.id, p]))
  // Existing curves stay put and the fit works around them; old sharp corners are restored after.
  const fitted =
    minRadiusM > 0
      ? fitHorizontalRadii(combined, { kind: 'radius', radiusM: minRadiusM }, { onlySharp: true }).points
      : combined
  return { ...alignment, points: fitted.map((p) => keep.get(p.id) ?? p) }
}
