/**
 * Where a failed route search stopped, for drawing on the plan beside the failure row: the line that
 * got nearest the end, the straight gap from there to the end, and the place the failure's reason
 * names when it names one. Drawn from the same failure record the reason is written from, so the
 * plan and the row cannot disagree.
 *
 * Free of DOM and network access.
 */
import type { CorridorFailure } from './corridorOptimizer'
import {
  switchbackFailureFocus,
  type SwitchbackFailure,
  type SwitchbackFailureLimits,
  type SwitchbackStop,
} from './switchbackSearch'
import type { Coordinate } from './types'

export interface RouteSearchStop {
  /** The search whose failure the row's reason describes. */
  search: 'corridor' | 'switchback'
  /** The line that got nearest the end, from the start to `stoppedAt`. One point when no line left the start. */
  reached: Coordinate[]
  /** The point nearest the end that the search reached. */
  stoppedAt: Coordinate
  end: Coordinate
  /** Straight-line distance from `stoppedAt` to the end, m. */
  remainingM: number
  /** The place the reason names (the switchback search names one per rule), or null. */
  named: { coordinate: Coordinate; label: string } | null
}

/** What each switchback rule's place is called on the plan: the short form of its sentence in the reason. */
export const SWITCHBACK_STOP_LABELS: Record<SwitchbackStop, string> = {
  grade: 'Ground over the grade limit',
  minGrade: 'Under the minimum grade',
  terrain: 'Gap in the terrain',
  exclusion: 'Blocked area',
  corridor: 'Edge of the corridor',
  chord: 'Ground off a straight grade',
  sideHill: 'Side-hill allowance used',
  crossing: 'Road would cross itself',
  curveFit: 'No room for the curves',
  heading: 'End heading',
  hairpinOff: 'Would need a switchback',
  sharp: 'Switchback too sharp',
  platform: 'Platform too steep',
  spacing: 'Switchbacks too close',
  turnRoom: 'No room for the turn',
  turnGrade: 'Turn too steep',
  turnGround: 'No ground for the turn',
  turnCutFill: 'Turn cut or fill too deep',
}

const sameCoordinate = (a: Coordinate, b: Coordinate) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9

/** The reached line, never empty, ending at the stop point. */
function reachedLine(reached: Coordinate[] | undefined, start: Coordinate, stoppedAt: Coordinate): Coordinate[] {
  const line = reached?.length ? reached.map((p) => [p[0], p[1]] as Coordinate) : [start]
  if (!sameCoordinate(line[line.length - 1], stoppedAt)) line.push([stoppedAt[0], stoppedAt[1]])
  return line
}

/** The corridor search names no place but the one it stopped at; its reason says how near the end that is. */
export function corridorStop(failure: CorridorFailure, start: Coordinate, end: Coordinate): RouteSearchStop {
  return {
    search: 'corridor',
    reached: reachedLine(failure.reached, start, failure.closest),
    stoppedAt: failure.closest,
    end,
    remainingM: failure.closestRemainingM,
    named: null,
  }
}

/** The switchback search names a rule and the refused try nearest the end; that try is marked too. */
export function switchbackStop(
  failure: SwitchbackFailure,
  limits: SwitchbackFailureLimits,
  start: Coordinate,
  end: Coordinate,
): RouteSearchStop {
  const focus = switchbackFailureFocus(failure, limits)
  return {
    search: 'switchback',
    reached: reachedLine(failure.reached, start, failure.closest),
    stoppedAt: failure.closest,
    end,
    remainingM: failure.closestRemainingM,
    named: focus ? { coordinate: focus.place.at, label: SWITCHBACK_STOP_LABELS[focus.stop] } : null,
  }
}

/** One drawn part of a failed search; `id` ties it to the row that explains it. */
export interface RouteStopPart {
  id: string
  role: 'reached' | 'gap' | 'stopped' | 'named'
  label: string
  color: string
  coordinates: Coordinate[]
}

/** Gap and stop marks are red whatever the goal: they mark trouble, not a road. */
export const ROUTE_STOP_COLOR = '#dc2626'
/** Gaps shorter than this are not drawn: the stop point already sits on the end. */
const MIN_GAP_M = 1

/**
 * The plan's parts for one failed goal (or one group of goals sharing a reason): the reached line in
 * the goal's colour, a red gap line to the end, a "Search stopped" mark, and the named place.
 */
export function routeStopParts(id: string, label: string, color: string, stop: RouteSearchStop): RouteStopPart[] {
  const parts: RouteStopPart[] = []
  if (stop.reached.length >= 2)
    parts.push({ id, role: 'reached', label: `${label}: line the search reached`, color, coordinates: stop.reached })
  if (stop.remainingM >= MIN_GAP_M)
    parts.push({
      id,
      role: 'gap',
      label: `${label}: ${Math.round(stop.remainingM).toLocaleString('en-CA')} m short of the end`,
      color: ROUTE_STOP_COLOR,
      coordinates: [stop.stoppedAt, stop.end],
    })
  parts.push({
    id,
    role: 'stopped',
    label: `Search stopped · ${label}`,
    color: ROUTE_STOP_COLOR,
    coordinates: [stop.stoppedAt],
  })
  if (stop.named && !sameCoordinate(stop.named.coordinate, stop.stoppedAt))
    parts.push({
      id,
      role: 'named',
      label: stop.named.label,
      color: ROUTE_STOP_COLOR,
      coordinates: [stop.named.coordinate],
    })
  return parts
}
