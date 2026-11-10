/**
 * Turnout intervisibility on a single-lane road: a driver at one turnout must see a vehicle at the
 * next one, and consecutive turnouts must lie within the spacing limit.
 *
 * The rule is the BC Ministry of Forests *Engineering Manual* (25 May 2026), §3.5.2.6 Turnouts:
 * "Turnouts should be intervisible to function as intended and should be spaced no more than
 * 300 m apart." §3.5.2.2 reads roads less than 8 m wide as single lane and roads 8 m or more as
 * double lane, which "do not require turnouts".
 *
 * The sightline is the one `sightDistance.ts` tests: a straight 3D line over the surface the road
 * leaves (formation, batters, ground beyond, and trees beyond the clearing when a height is entered),
 * sampled every metre in plan. A sample with no elevation makes the look unknown, never clear.
 *
 * Pure: no DOM, terrain or network access.
 */
import {
  designProfileSampler,
  sightSettingsOf,
  stationSurface,
  traceSightline,
  type SightlineTrace,
} from './sightDistance'
import type { Alignment, RoadAnalysis } from './types'
import { fullWidthRange } from './wideningEntry'

/** Engineering Manual §3.5.2.6: consecutive turnouts no more than this apart. */
export const TURNOUT_MAX_SPACING_M = 300
/** Engineering Manual §3.5.2.2: a road narrower than this is single lane and needs turnouts. */
export const TURNOUT_SINGLE_LANE_MAX_WIDTH_M = 8

export interface TurnoutPlace {
  id: string
  name: string
  start: number
  end: number
  /** The middle of the full-width part, where a waiting vehicle stands. */
  chainage: number
}

export type TurnoutLook = SightlineTrace['state'] | 'no-surface'

export interface TurnoutPair {
  from: TurnoutPlace
  to: TurnoutPlace
  /** Centre to centre, along the road, m. */
  spacingM: number
  spacingMet: boolean
  /** From `from` toward `to`, and back. */
  ahead: TurnoutLook
  back: TurnoutLook
  /** True when both looks are clear, false when either is blocked, null when unknown. */
  intervisible: boolean | null
  /** Where the surface stands highest above the line, on the worse look. */
  blocking: { chainage: number; offset: number; aboveLineM: number; vegetation: boolean } | null
  /** Plan positions of the two vehicles, for drawing. */
  fromAt: [number, number]
  toAt: [number, number]
}

export interface TurnoutSightReview {
  /** `two-lane`: no turnouts are needed; `too-few`: fewer than two turnouts, so no pair to check. */
  status: 'checked' | 'two-lane' | 'no-stations' | 'too-few'
  singleLane: boolean
  turnouts: TurnoutPlace[]
  pairs: TurnoutPair[]
  eyeHeightM: number
  targetHeightM: number
}

type TurnoutRoad = Pick<Alignment, 'template' | 'sightDistance' | 'overrides'> & Partial<Pick<Alignment, 'vertical'>>

/** Whether the turnout rule applies: as entered under Sight distance, else from the 8 m width. */
export const needsTurnouts = (alignment: Pick<Alignment, 'template' | 'sightDistance'>) =>
  sightSettingsOf(alignment).singleLane ??
  alignment.template.leftWidth + alignment.template.rightWidth < TURNOUT_SINGLE_LANE_MAX_WIDTH_M

/** The road's turnouts that lie on it, in station order. Landings are not counted. */
export function turnoutPlaces(overrides: Alignment['overrides'], lengthM: number): TurnoutPlace[] {
  return overrides
    .filter((v) => v.kind === 'turnout' && v.end > v.start && v.start <= lengthM + 1e-6 && v.end >= -1e-6)
    .map((v) => {
      const full = fullWidthRange(v) ?? { from: v.start, to: v.end }
      const centre = Math.max(0, Math.min(lengthM, (full.from + full.to) / 2))
      return { id: v.id, name: v.name, start: v.start, end: v.end, chainage: centre }
    })
    .sort((a, b) => a.chainage - b.chainage)
}

const cache = new WeakMap<RoadAnalysis, { key: string; review: TurnoutSightReview }>()

const rank: Record<TurnoutLook, number> = { clear: 0, unknown: 1, 'no-surface': 1, vegetation: 2, surface: 2 }

/** Every consecutive pair of turnouts, looked at both ways. Cached per analysis and inputs. */
export function reviewTurnoutSight(input: {
  analysis: RoadAnalysis
  alignment: TurnoutRoad
  profileAt?: (chainage: number) => number | null
}): TurnoutSightReview {
  const { analysis, alignment } = input
  const settings = sightSettingsOf(alignment)
  const key = JSON.stringify([
    settings,
    alignment.template.leftWidth,
    alignment.template.rightWidth,
    alignment.overrides,
    input.profileAt ? 'given' : (alignment.vertical ?? []),
  ])
  const cached = cache.get(analysis)
  if (cached?.key === key) return cached.review
  const singleLane = needsTurnouts(alignment)
  const stations = analysis.stations
  const length = stations.at(-1)?.chainage ?? 0
  const turnouts = turnoutPlaces(alignment.overrides, length)
  const review: TurnoutSightReview = {
    status: 'checked',
    singleLane,
    turnouts,
    pairs: [],
    eyeHeightM: settings.eyeHeightM,
    targetHeightM: settings.oncomingHeightM,
  }
  if (!singleLane) review.status = 'two-lane'
  else if (stations.length < 2) review.status = 'no-stations'
  else if (turnouts.length < 2) review.status = 'too-few'
  else {
    const profileAt =
      input.profileAt ??
      (alignment.vertical ? designProfileSampler({ vertical: alignment.vertical }, analysis.length) : undefined)
    const surface = stationSurface(stations, { vegetationHeightM: settings.vegetationHeightM, profileAt })
    const point = (chainage: number, height: number) => {
      const ground = surface.elevation(chainage, 0, false)
      if (!ground) return null
      const [x, y] = surface.position(chainage, 0)
      return { x, y, z: ground.z + height, chainage }
    }
    const look = (from: number, to: number) => {
      const eye = point(from, settings.eyeHeightM),
        target = point(to, settings.oncomingHeightM)
      return eye && target ? traceSightline(surface, eye, target) : null
    }
    for (let i = 1; i < turnouts.length; i++) {
      const from = turnouts[i - 1],
        to = turnouts[i]
      const ahead = look(from.chainage, to.chainage),
        back = look(to.chainage, from.chainage)
      const state = (trace: SightlineTrace | null): TurnoutLook => trace?.state ?? 'no-surface'
      const states = [state(ahead), state(back)]
      const worse = [ahead, back]
        .filter((trace): trace is SightlineTrace => !!trace?.worst)
        .sort((a, b) => b.worst!.aboveLineM - a.worst!.aboveLineM)[0]
      const spacingM = to.chainage - from.chainage
      const at = (chainage: number) => surface.toLngLat(...surface.position(chainage, 0))
      review.pairs.push({
        from,
        to,
        spacingM,
        spacingMet: spacingM <= TURNOUT_MAX_SPACING_M + 1e-6,
        ahead: states[0],
        back: states[1],
        intervisible: states.some((s) => rank[s] === 2) ? false : states.some((s) => rank[s] === 1) ? null : true,
        blocking: worse?.worst
          ? {
              chainage: worse.worst.chainage,
              offset: worse.worst.offset,
              aboveLineM: worse.worst.aboveLineM,
              vegetation: worse.worst.vegetation,
            }
          : null,
        fromAt: at(from.chainage),
        toAt: at(to.chainage),
      })
    }
  }
  cache.set(analysis, { key, review })
  return review
}
