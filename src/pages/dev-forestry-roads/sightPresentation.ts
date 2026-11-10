/**
 * What the plan and the profile band draw of sight distance: the sightlines from the selected
 * station, the turnout pairs, and the distance seen against the distance needed along the road.
 * No DOM: the plan layers, the band and the tests read the same numbers.
 */
import type { RoadSightReview, SightBlocking, SightLookView, StationSightView } from './sightDistance'
import type { TurnoutSightReview } from './turnoutSight'

export type SightFeatureRole =
  | 'sight-seen'
  | 'sight-needed'
  | 'sight-eye'
  | 'sight-hidden'
  | 'sight-block'
  | 'sight-clear-to'
  | 'turnout-sight'
  | 'turnout'

const m = (value: number, digits = 0) =>
  value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits })
const station = (chainage: number) => {
  const rounded = Math.round(Math.max(0, chainage) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}

/** One sentence on what blocks the line to the distance needed, and what clearing it would need. */
export function blockingText(blocking: SightBlocking): string {
  const where = `${m(Math.abs(blocking.offset), 1)} m ${blocking.side} of the centreline at ${station(blocking.chainage)}`
  if (blocking.kind === 'crest')
    return `The road itself rises ${m(blocking.aboveLineM, 2)} m above the sightline ${where}: a crest. Lengthen the vertical curve or lower the speed.`
  const what = blocking.kind === 'trees' ? 'Trees stand' : 'Ground stands'
  const reach =
    blocking.clearToM === null
      ? ''
      : ` The sightline swings ${m(blocking.clearToM, 1)} m ${blocking.side} of the centreline; ${blocking.kind === 'trees' ? 'clear' : 'clear and bench below the line'} to there (${blocking.clearedM === null ? 'clearing now unknown' : `now ${m(blocking.clearedM, 1)} m`}).`
  return `${what} ${m(blocking.aboveLineM, 2)} m above the sightline ${where}.${reach}`
}

const point = (coordinates: [number, number], properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.Point> => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties,
})
const line = (
  coordinates: [number, number][],
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties,
})

function lookFeatures(look: SightLookView, index: number): GeoJSON.Feature[] {
  const { eye } = look
  if (!look.eyeAt) return []
  const id = (role: SightFeatureRole) => `${role}-${eye.direction}-${index}`
  const needs = eye.requiredM === null ? 'unknown' : `${m(eye.requiredM)} m`
  const sees = eye.limitedBy === 'clear' ? `at least ${needs}` : `${m(eye.availableM)} m`
  const features: GeoJSON.Feature[] = []
  if (look.seenTo)
    features.push(
      line([look.eyeAt, look.seenTo.at], {
        id: id('sight-seen'),
        role: 'sight-seen',
        label: `Looking ${eye.direction} from ${station(eye.chainage)}: sees ${sees} of ${needs}, to ${station(look.seenTo.chainage)}`,
      }),
    )
  const blocked = look.needed && look.needed.trace.state !== 'clear'
  if (look.needed && blocked)
    features.push(
      line([look.eyeAt, look.needed.at], {
        id: id('sight-needed'),
        role: 'sight-needed',
        state: look.needed.trace.state,
        label: `Line to the distance needed (${needs}, ${station(look.needed.chainage)}): ${look.needed.trace.state === 'unknown' ? 'crosses missing terrain' : 'blocked'}`,
      }),
    )
  if (look.hiddenFrom)
    features.push(
      point(look.hiddenFrom.at, {
        id: id('sight-hidden'),
        role: 'sight-hidden',
        label: `First target hidden looking ${eye.direction}: ${station(look.hiddenFrom.chainage)}`,
      }),
    )
  const blocking = look.needed?.blocking
  if (blocking && blocked) {
    features.push(point(blocking.at, { id: id('sight-block'), role: 'sight-block', label: blockingText(blocking) }))
    if (blocking.clearLine)
      features.push(
        line(blocking.clearLine, {
          id: id('sight-clear-to'),
          role: 'sight-clear-to',
          label: `Clear ${blocking.side} to ${m(blocking.clearToM ?? 0, 1)} m from the centreline at ${station(blocking.chainage)}`,
        }),
      )
  }
  return features
}

/** The plan's sight layer: the selected station's looks, and each turnout pair's sightline. */
export function sightPlanFeatures(
  view: StationSightView | null,
  turnouts?: TurnoutSightReview | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  if (turnouts?.status === 'checked') {
    for (const pair of turnouts.pairs) {
      const state = pair.intervisible === null ? 'unknown' : pair.intervisible ? 'clear' : 'blocked'
      features.push(
        line([pair.fromAt, pair.toAt], {
          id: `turnout-sight-${pair.from.id}-${pair.to.id}`,
          role: 'turnout-sight',
          state,
          label: `${pair.from.name} to ${pair.to.name}: ${m(pair.spacingM)} m, ${state === 'clear' ? 'intervisible' : state === 'blocked' ? 'cannot see each other' : 'unknown (missing terrain)'}${pair.spacingMet ? '' : ', too far apart'}`,
        }),
      )
    }
    const placed = new Map<string, GeoJSON.Feature>()
    for (const pair of turnouts.pairs)
      for (const [place, at] of [
        [pair.from, pair.fromAt],
        [pair.to, pair.toAt],
      ] as const)
        placed.set(
          place.id,
          point(at, {
            id: `turnout-${place.id}`,
            role: 'turnout',
            label: `${place.name} at ${station(place.chainage)}`,
          }),
        )
    features.push(...placed.values())
  }
  if (view?.status === 'checked') {
    view.looks.forEach((look, index) => features.push(...lookFeatures(look, index)))
    const eyeAt = view.looks.find((look) => look.eyeAt)?.eyeAt
    if (eyeAt)
      features.push(
        point(eyeAt, { id: 'sight-eye', role: 'sight-eye', label: `Driver's eye at ${station(view.chainage)}` }),
      )
  }
  return { type: 'FeatureCollection', features }
}

/** One eye station on the band: the look that falls furthest short of what it needs. */
export interface SightBandPoint {
  chainage: number
  direction: 'ahead' | 'back'
  /** Distance seen, m; a clear look reads at least the distance needed. */
  availableM: number
  requiredM: number | null
  state: 'clear' | 'short' | 'unknown' | 'near-end'
}

/** The distance seen against the distance needed at each eye station, the worse of the two looks. */
export function sightBandSeries(review: Pick<RoadSightReview, 'eyes' | 'short' | 'unknown' | 'nearEnd'>) {
  const byStation = new Map<number, SightBandPoint>()
  const stateOf = (eye: RoadSightReview['eyes'][number]): SightBandPoint['state'] =>
    review.short.includes(eye)
      ? 'short'
      : review.unknown.includes(eye)
        ? 'unknown'
        : review.nearEnd.includes(eye)
          ? 'near-end'
          : 'clear'
  const severity = { short: 3, unknown: 2, 'near-end': 1, clear: 0 }
  for (const eye of review.eyes) {
    const next: SightBandPoint = {
      chainage: eye.chainage,
      direction: eye.direction,
      availableM: eye.availableM,
      requiredM: eye.requiredM,
      state: stateOf(eye),
    }
    const margin = (p: SightBandPoint) => p.availableM - (p.requiredM ?? p.availableM)
    const held = byStation.get(eye.chainage)
    if (
      !held ||
      severity[next.state] > severity[held.state] ||
      (severity[next.state] === severity[held.state] && margin(next) < margin(held))
    )
      byStation.set(eye.chainage, next)
  }
  return [...byStation.values()].sort((a, b) => a.chainage - b.chainage)
}

/**
 * A table row that selects its station by click, or by Enter or Space once focused with Tab, so the
 * shortfall and curve-clearing rows move the eye from the keyboard as the turnout rows do.
 */
export function stationRowProps(select: () => void) {
  return {
    tabIndex: 0,
    onClick: select,
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      select()
    },
  }
}
