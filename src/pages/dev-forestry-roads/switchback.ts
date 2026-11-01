/**
 * An editable two-curve switchback sketch, appended to a separate road alternative.
 * Geometry uses the engine's spherical azimuthal-equidistant frame. These are
 * geometric construction limits, not vehicle, terrain or road-class standards.
 */
import { alignmentLength, distance, horizontalCurveSummary, offsetCoordinate } from './engine'
import { pegBearing } from './pegging'
import type { Alignment, Coordinate, VerticalPoint } from './types'

export const SWITCHBACK_LIMITS = {
  minRadiusM: 5,
  maxRadiusM: 1000,
  minApproachM: 5,
  maxApproachM: 2000,
  minTangentM: 1,
  maxTangentM: 2000,
  maxAbsGradePercent: 30,
} as const

export interface SwitchbackOptions {
  /** New alternative ID, also used to make stable control IDs. */
  id: string
  direction: 'left' | 'right'
  radiusM: number
  /** Straight distance from the old road end to the first circular curve. */
  approachM: number
  /** Straight distance between the two 90-degree circular curves. */
  tangentM: number
  /** Straight distance after the second curve. */
  departureM: number
  /** Initial formation grade on the entire extension; positive rises up-station. */
  gradePercent: number
  /** Fitted formation level at the existing road end, supplied by its analysis. */
  startElevationM: number
}

export interface SwitchbackSketch {
  alignment: Alignment
  startChainage: number
  endChainage: number
  addedLengthM: number
  legSeparationM: number
  endElevationM: number
  curveStart: number
  curveEnd: number
  /** Plan of the extension, metres forward and left from the old road end. */
  sketch: [number, number][]
}

const RAD = Math.PI / 180
const bounded = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi

export function createSwitchbackAlternative(road: Alignment, options: SwitchbackOptions): SwitchbackSketch {
  const { id, direction, radiusM: radius, approachM, tangentM, departureM, gradePercent, startElevationM } = options
  const limits = SWITCHBACK_LIMITS
  if (!/^[a-zA-Z0-9_.:-]{1,70}$/.test(id) || id === road.id) throw Error('The switchback needs a new alternative ID.')
  if (direction !== 'left' && direction !== 'right') throw Error('Choose a left or right switchback.')
  if (!bounded(radius, limits.minRadiusM, limits.maxRadiusM))
    throw Error(`Switchback radius must be ${limits.minRadiusM}–${limits.maxRadiusM} m.`)
  if (![approachM, departureM].every((n) => bounded(n, limits.minApproachM, limits.maxApproachM)))
    throw Error(`Entry and exit straights must be ${limits.minApproachM}–${limits.maxApproachM} m.`)
  if (!bounded(tangentM, limits.minTangentM, limits.maxTangentM))
    throw Error(`The connecting straight must be ${limits.minTangentM}–${limits.maxTangentM} m.`)
  if (!bounded(gradePercent, -limits.maxAbsGradePercent, limits.maxAbsGradePercent))
    throw Error(
      `Initial switchback grade must be between −${limits.maxAbsGradePercent}% and ${limits.maxAbsGradePercent}%.`,
    )
  if (!bounded(startElevationM, -12000, 12000)) throw Error('The existing road end needs a finite formation level.')
  if (road.points.length < 2 || road.vertical.length < 2)
    throw Error('Design a road with at least two horizontal points and two vertical controls before extending it.')

  const startChainage = alignmentLength(road)
  const vertical = [...road.vertical].sort((a, b) => a.chainage - b.chainage)
  const lastVertical = vertical.at(-1)!
  if (lastVertical.chainage > startChainage + 0.001)
    throw Error('Move vertical controls beyond the road end onto the road before adding a switchback.')
  // The last PVI is a tangent endpoint in the original design. Its curveLength
  // was ignored there, so it must not start rounding the old profile when extended.
  const previousVertical = vertical.at(-2)!
  const expectedLevel =
    lastVertical.elevation +
    ((lastVertical.elevation - previousVertical.elevation) / (lastVertical.chainage - previousVertical.chainage)) *
      (startChainage - lastVertical.chainage)
  if (!Number.isFinite(expectedLevel) || Math.abs(expectedLevel - startElevationM) > 0.001)
    throw Error('The road-end formation changed. Recalculate before adding the switchback.')

  const origin = road.points[0].coordinate
  const toXY = (coordinate: Coordinate): [number, number] => {
    const d = distance(origin, coordinate),
      bearing = pegBearing(origin, coordinate) * RAD
    return [d * Math.sin(bearing), d * Math.cos(bearing)]
  }
  const fromXY = (x: number, y: number): Coordinate =>
    offsetCoordinate(origin, Math.atan2(x, y) / RAD, Math.hypot(x, y))
  const last = road.points.at(-1)!
  const previous = [...road.points.slice(0, -1)].reverse().find((p) => distance(last.coordinate, p.coordinate) >= 0.001)
  if (!previous || startChainage < 0.001) throw Error('The road needs a nonzero final tangent.')
  const [x, y] = toXY(last.coordinate),
    [px, py] = toXY(previous.coordinate)
  const leg = Math.hypot(x - px, y - py),
    ux = (x - px) / leg,
    uy = (y - py) / leg
  const sign = direction === 'left' ? 1 : -1
  const at = (forward: number, left: number) => fromXY(x + ux * forward - uy * left, y + uy * forward + ux * left)
  const legSeparationM = 2 * radius + tangentM
  const candidate: Alignment = structuredClone(road)
  candidate.id = id
  candidate.name = `${road.name} · ${direction} switchback R${radius}`.slice(0, 200)
  // End connection evidence belongs to the original endpoint, not its extension.
  delete candidate.fsrConnection
  delete candidate.networkEntryRoadId
  delete candidate.fullCostRecord
  // Keep the active profile only on the new alternative; the original retains all siblings.
  delete candidate.verticalAlternatives
  delete candidate.activeVerticalAlternativeId
  delete candidate.verticalAlternativeCostMode
  candidate.points = [
    ...candidate.points.slice(0, -1),
    { ...last, coordinate: [...last.coordinate] as Coordinate, radiusM: 0, spiralM: 0 },
    { id: `${id}:turn-1`, coordinate: at(approachM + radius, 0), radiusM: radius },
    { id: `${id}:turn-2`, coordinate: at(approachM + radius, sign * legSeparationM), radiusM: radius },
    { id: `${id}:end`, coordinate: at(approachM - departureM, sign * legSeparationM), radiusM: 0 },
  ]
  const endChainage = alignmentLength(candidate)
  const addedLengthM = endChainage - startChainage
  const endElevationM = startElevationM + (addedLengthM * gradePercent) / 100
  if (!bounded(endElevationM, -12000, 12000)) throw Error('The extension ends outside the supported elevation range.')
  const expectedLength = approachM + Math.PI * radius + tangentM + departureM
  const curves = horizontalCurveSummary(candidate).filter((c) => c.start >= startChainage - 0.001)
  if (
    curves.length !== 2 ||
    Math.abs(addedLengthM - expectedLength) > 0.001 ||
    curves.some((c) => Math.abs(c.radius - radius) > 0.001 || Math.abs(c.length - (Math.PI * radius) / 2) > 0.001)
  )
    throw Error('Both switchback curves must fit at the requested radius. No alternative was created.')

  const existingVertical: VerticalPoint[] = vertical.map((p, i) =>
    i === vertical.length - 1 ? { ...p, curveLength: 0 } : { ...p },
  )
  if (Math.abs(lastVertical.chainage - startChainage) < 0.001) {
    existingVertical[existingVertical.length - 1] = {
      ...existingVertical.at(-1)!,
      chainage: startChainage,
      elevation: startElevationM,
    }
  } else
    existingVertical.push({ id: `${id}:join`, chainage: startChainage, elevation: startElevationM, curveLength: 0 })
  candidate.vertical = [
    ...existingVertical,
    { id: `${id}:profile-end`, chainage: endChainage, elevation: endElevationM, curveLength: 0 },
  ]
  if (candidate.vertical.length > 500) throw Error('The extended profile exceeds the 500-control limit.')

  const sketch: [number, number][] = [
    [0, 0],
    [approachM, 0],
  ]
  for (let i = 1; i <= 24; i++) {
    const angle = (Math.PI * i) / 48
    sketch.push([approachM + radius * Math.sin(angle), sign * radius * (1 - Math.cos(angle))])
  }
  sketch.push([approachM + radius, sign * (radius + tangentM)])
  for (let i = 1; i <= 24; i++) {
    const angle = (Math.PI * i) / 48
    sketch.push([approachM + radius * Math.cos(angle), sign * (radius + tangentM + radius * Math.sin(angle))])
  }
  sketch.push([approachM - departureM, sign * legSeparationM])
  return {
    alignment: candidate,
    startChainage,
    endChainage,
    addedLengthM,
    legSeparationM,
    endElevationM,
    curveStart: curves[0].start,
    curveEnd: curves[1].end,
    sketch,
  }
}
