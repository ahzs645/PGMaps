/**
 * Per-station figures a builder reads off a station table and a slope-stake book: centreline cut or
 * fill, the design grade behind and ahead, grid coordinates, the catch points and their cut or fill
 * from the hinge, ditch depth and grade, clearing limits and crossfall. Read from the analysis's own
 * sections (`sectionCodePoints`), never recomputed, so the table, the stake book and the stakeout CSV
 * agree. No DOM or network access.
 */
import { curveDesignAt } from './engine'
import { sectionCodePoints, type SectionCodePoint } from './sectionGeometry'
import { roadSidehill } from './sectionSideSlope'
import { sectionCrossfall, templateAt } from './templates'
import type { Alignment, Coordinate, RoadAnalysis, RoadStation } from './types'

export type ToGrid = (coordinate: Coordinate) => [number, number]
type Side = 'left' | 'right'

export interface CatchPoint {
  /** Horizontal distance from the centreline, positive on both sides. */
  offsetM: number
  /** Ground at the catch point. */
  groundM: number | null
  /** The point the batter is measured from: the ditch bottom in cut where there is one, else the formation edge. */
  hinge: 'ditch' | 'edge'
  hingeOffsetM: number
  hingeElevationM: number | null
  /** Catch ground minus hinge: positive is cut, negative fill. */
  cutFillM: number | null
}

export interface StationExtra {
  /** Ground minus design at the centreline: positive is cut, negative fill. */
  centreDepthM: number | null
  /** Design grade over the interval from the previous calculated station, and to the next one. */
  gradeLastPercent: number | null
  gradeNextPercent: number | null
  easting: number | null
  northing: number | null
  catch: Record<Side, CatchPoint | null>
  /** Formation edge minus ditch bottom; null where the side has no constructed ditch. */
  ditchDepthM: Record<Side, number | null>
  ditchElevationM: Record<Side, number | null>
  /** Ditch-bottom grade over the interval from the previous station, where both have a ditch. */
  ditchGradePercent: Record<Side, number | null>
  /** Clearing limit from the centreline on each side, and the width between them. */
  clearingM: Record<Side, number | null>
  clearingWidthM: number | null
  /** Running-surface crossfall, positive falling away from the centreline; superelevation included. */
  crossfallPercent: Record<Side, number | null>
  superelevated: boolean
  /** The ground's slope across the road, and its uphill side (`roadSidehill`). */
  sidehillPercent: number | null
  uphill: Side | null
  /** Bank cut of each ground material since the previous station (`materialCutVolumesM3`). */
  materialCutM3: Record<string, number> | null
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v)
const SIDES: Side[] = ['left', 'right']

function catchPoint(points: SectionCodePoint[], side: Side): CatchPoint | null {
  const daylight = points.find((p) => p.code === `${side}-daylight`)
  if (!daylight) return null
  const ditch = points.find((p) => p.code === `${side}-ditch-bottom`)
  const edge = points.find((p) => p.code === `${side}-formation-edge`)
  const hinge = ditch && finite(ditch.design) ? ditch : edge
  if (!hinge) return null
  const ground = finite(daylight.ground) ? daylight.ground : null
  const hingeElevation = finite(hinge.design) ? hinge.design : null
  return {
    offsetM: Math.abs(daylight.offset),
    groundM: ground,
    hinge: hinge === ditch ? 'ditch' : 'edge',
    hingeOffsetM: Math.abs(hinge.offset),
    hingeElevationM: hingeElevation,
    cutFillM: ground !== null && hingeElevation !== null ? ground - hingeElevation : null,
  }
}

function grade(a: RoadStation | undefined, b: RoadStation | undefined) {
  if (!a || !b || !finite(a.designElevation) || !finite(b.designElevation)) return null
  const run = b.chainage - a.chainage
  return run > 1e-6 ? (100 * (b.designElevation - a.designElevation)) / run : null
}

/** One entry per analysis station, by index. `toGrid` is the project's grid; without it E/N are blank. */
export function stationExtras(alignment: Alignment, analysis: RoadAnalysis, toGrid?: ToGrid | null): StationExtra[] {
  const stations = analysis.stations
  const extras: StationExtra[] = []
  const sidehill = roadSidehill(stations)
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i]
    const engineering = analysis.engineering?.stations[i]
    let points: SectionCodePoint[] = []
    try {
      points = sectionCodePoints(s, engineering?.template ?? templateAt(alignment, s.chainage))
    } catch {
      /* A section the template cannot name has no stakes. */
    }
    const edge = (side: Side) => points.find((p) => p.code === `${side}-formation-edge`)
    const ditch = (side: Side) => points.find((p) => p.code === `${side}-ditch-bottom`)
    const ditchDepth = (side: Side) => {
      const e = edge(side)?.design,
        d = ditch(side)?.design
      return finite(e) && finite(d) ? e - d : null
    }
    let crossfall: Record<Side, number | null> = { left: null, right: null }
    let superelevated = false
    try {
      const curve = curveDesignAt(alignment, s.chainage)
      const template = (engineering?.template ?? templateAt(alignment, s.chainage)).template
      crossfall = {
        left: sectionCrossfall(template, 'left', curve),
        right: sectionCrossfall(template, 'right', curve),
      }
      superelevated = !!curve && curve.superPercent > 0
    } catch {
      /* Left blank where the template or curve cannot be read. */
    }
    let easting: number | null = null,
      northing: number | null = null
    if (toGrid) {
      const [x, y] = toGrid(s.coordinate)
      if (Number.isFinite(x) && Number.isFinite(y)) [easting, northing] = [x, y]
    }
    // A section without preparation margins clears to its catch points, as the engine measures it.
    const clearing = (side: Side) => {
      const value = side === 'left' ? s.leftClearingM : s.rightClearingM
      const daylight = side === 'left' ? s.leftDaylightM : s.rightDaylightM
      return finite(value) ? Math.abs(value) : finite(daylight) ? Math.abs(daylight) : null
    }
    extras.push({
      centreDepthM:
        finite(s.groundElevation) && finite(s.designElevation) ? s.groundElevation - s.designElevation : null,
      gradeLastPercent: grade(stations[i - 1], s),
      gradeNextPercent: grade(s, stations[i + 1]),
      easting,
      northing,
      catch: { left: catchPoint(points, 'left'), right: catchPoint(points, 'right') },
      ditchDepthM: { left: ditchDepth('left'), right: ditchDepth('right') },
      ditchElevationM: {
        left: finite(ditch('left')?.design) ? ditch('left')!.design : null,
        right: finite(ditch('right')?.design) ? ditch('right')!.design : null,
      },
      ditchGradePercent: { left: null, right: null },
      clearingM: { left: clearing('left'), right: clearing('right') },
      clearingWidthM: finite(s.clearingWidthM)
        ? s.clearingWidthM
        : finite(clearing('left')) && finite(clearing('right'))
          ? clearing('left')! + clearing('right')!
          : null,
      crossfallPercent: crossfall,
      superelevated,
      sidehillPercent: sidehill[i]?.percent ?? null,
      uphill: sidehill[i]?.uphill ?? null,
      materialCutM3: engineering?.materialCutVolumesM3 ?? null,
    })
  }
  for (let i = 1; i < extras.length; i++)
    for (const side of SIDES) {
      const a = extras[i - 1].ditchElevationM[side],
        b = extras[i].ditchElevationM[side]
      const run = stations[i].chainage - stations[i - 1].chainage
      if (finite(a) && finite(b) && run > 1e-6) extras[i].ditchGradePercent[side] = (100 * (b - a)) / run
    }
  return extras
}

/** Engineering Manual §5.6.5 / Table 5-10: why a station is staked. */
export type StakeReason = 'interval' | 'BC' | 'EC' | 'BVC' | 'EVC' | 'culvert' | 'deep' | 'start' | 'end'

export interface StakeStation {
  station: RoadStation
  extra: StationExtra
  reasons: StakeReason[]
}

/** Cuts or fills deeper than this at the centreline or a catch are staked (Table 5-10). */
export const STAKE_DEEP_M = 3

/**
 * Stations to stake: the calculated station nearest each multiple of `intervalM` (20 m by
 * default, as the Engineering Manual gives for a total station or RTK), the road's ends, every
 * calculated station within half a metre of a horizontal or vertical curve point or a culvert, and
 * every station whose centreline or catch is cut or filled deeper than `STAKE_DEEP_M`.
 */
export function stakeStations(
  analysis: RoadAnalysis,
  extras: StationExtra[],
  points: { chainage: number; reason: StakeReason }[],
  intervalM = 20,
): StakeStation[] {
  const stations = analysis.stations
  if (!stations.length) return []
  const reasons = new Map<number, Set<StakeReason>>()
  const add = (index: number, reason: StakeReason) => {
    const set = reasons.get(index) ?? new Set<StakeReason>()
    set.add(reason)
    reasons.set(index, set)
  }
  const nearest = (chainage: number) => {
    let best = 0
    for (let i = 1; i < stations.length; i++)
      if (Math.abs(stations[i].chainage - chainage) < Math.abs(stations[best].chainage - chainage)) best = i
    return best
  }
  add(0, 'start')
  add(stations.length - 1, 'end')
  if (intervalM > 0) {
    const last = stations[stations.length - 1].chainage
    for (let c = Math.ceil(stations[0].chainage / intervalM) * intervalM; c <= last + 1e-6; c += intervalM)
      add(nearest(c), 'interval')
  }
  for (const p of points) {
    const i = nearest(p.chainage)
    if (Math.abs(stations[i].chainage - p.chainage) <= 0.5) add(i, p.reason)
  }
  extras.forEach((e, i) => {
    const deep = [e.centreDepthM, e.catch.left?.cutFillM, e.catch.right?.cutFillM].some(
      (v) => finite(v) && Math.abs(v) > STAKE_DEEP_M,
    )
    if (deep) add(i, 'deep')
  })
  return [...reasons.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, set]) => ({ station: stations[index], extra: extras[index], reasons: [...set] }))
}

export const STAKE_REASON_TEXT: Record<StakeReason, string> = {
  interval: 'Interval',
  BC: 'BC',
  EC: 'EC',
  BVC: 'BVC',
  EVC: 'EVC',
  culvert: 'Culvert',
  deep: `Over ${STAKE_DEEP_M} m`,
  start: 'Start',
  end: 'End',
}
