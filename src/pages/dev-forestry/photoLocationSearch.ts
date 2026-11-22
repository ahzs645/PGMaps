/**
 * *Find the photo location* (the own photo's Camera tab): a photo with no GPS is searched for at nine places round a
 * spot the reviewer picks, every heading at each, against the terrain's skyline. The places are hypotheses, never a
 * position: a result is offered as a start only when one fit stands clearly ahead, and a near tie is named by how far
 * apart its positions and headings are, with nothing offered (as `undecidedHeadings` names the headings it leaves open).
 *
 * Free of DOM and network access: the hook (`useFieldPhoto.ts`) reads the photo and the terrain and runs the searches.
 */
import type { ProfilePoint } from './skylineFit'
import { haversineMeters, metersPerDegree } from './visibility'
import {
  AMBIGUOUS_LOSS_GAP,
  MIN_SKYLINE_COLUMNS,
  READER_SETTLED_AGREEMENT,
  searchRank,
  type WideSearchResult,
} from './wideOrientation'

export type PhotoLocation = { lng: number; lat: number }

export type PhotoLocationCandidate = PhotoLocation & { fit: WideSearchResult }

export type PhotoLocationBasis = { hfov: number; eyeHeightMeters: number; altitudeMeters: number | null }

/**
 * How far apart the fits of a near tie are: the widest distance between two of their positions, and the smallest arc
 * (clockwise, `from` to `to`, degrees) holding every heading that fits about as well, the runner-up headings included.
 */
export type PhotoLocationSpread = { metres: number; headings: { from: number; to: number } }

export type PhotoLocationSearch =
  | { status: 'searching'; checked: number; total: number }
  | {
      status: 'done'
      candidates: PhotoLocationCandidate[]
      ambiguous: boolean
      /** Present when `ambiguous`: what the tie leaves open. */
      spread: PhotoLocationSpread | null
      sampled: number
      basis: PhotoLocationBasis
    }
  | { status: 'error'; message: string }

export const PHOTO_LOCATION_SPACING_METERS = 500

/** A nearly level horizon can agree everywhere while providing no positional evidence. */
export function hasLocationRelief(profile: readonly ProfilePoint[]): boolean {
  let low = Infinity
  let high = -Infinity
  for (const { elevation } of profile) {
    if (!Number.isFinite(elevation)) continue
    low = Math.min(low, elevation)
    high = Math.max(high, elevation)
  }
  return high - low >= 0.25
}

/** A bounded scout, centred on a place the reviewer points to. These are hypotheses, not a position accuracy claim. */
export function photoLocationTrials(centre: PhotoLocation): PhotoLocation[] {
  const scale = metersPerDegree(centre.lat)
  return [0, -1, 1].flatMap((north) =>
    [0, -1, 1].map((east) => ({
      lng: centre.lng + (east * PHOTO_LOCATION_SPACING_METERS) / scale.lng,
      lat: centre.lat + (north * PHOTO_LOCATION_SPACING_METERS) / scale.lat,
    })),
  )
}

/**
 * The best fit at one place over the skyline readers (`SKYLINE_READERS`), by the rule the camera search uses: the
 * first reader (colour) alone when its fit settles (`READER_SETTLED_AGREEMENT`, trusted), else every reader, keeping
 * the best by `searchRank` and, on a tie, the earlier reader. `tryReader` answers null for a reader whose skyline is
 * too short or not believable there.
 */
export async function bestReaderFit<R>(
  readers: ReadonlyArray<R>,
  tryReader: (reader: R) => Promise<WideSearchResult | null>,
): Promise<{ reader: R; result: WideSearchResult } | null> {
  const [first, ...others] = readers
  if (first === undefined) return null
  const firstResult = await tryReader(first)
  let chosen: { reader: R; result: WideSearchResult } | null = firstResult
    ? { reader: first, result: firstResult }
    : null
  if (chosen && chosen.result.fit.trustworthy && chosen.result.fit.agreement >= READER_SETTLED_AGREEMENT) return chosen
  const more = await Promise.all(others.map((reader) => tryReader(reader)))
  more.forEach((result, k) => {
    if (result && (!chosen || searchRank(result) > searchRank(chosen.result))) chosen = { reader: others[k], result }
  })
  return chosen
}

const wrap = (degrees: number) => ((degrees % 360) + 360) % 360

/** The smallest clockwise arc holding every heading: everything but the widest gap between neighbours. */
export function headingArc(bearings: ReadonlyArray<number>): { from: number; to: number } {
  const sorted = [...new Set(bearings.map(wrap))].sort((a, b) => a - b)
  if (sorted.length < 2) return { from: sorted[0] ?? 0, to: sorted[0] ?? 0 }
  let widest = -1
  let after = 0
  for (let i = 0; i < sorted.length; i++) {
    const gap = (sorted[(i + 1) % sorted.length] - sorted[i] + 360) % 360
    if (gap > widest) {
      widest = gap
      after = (i + 1) % sorted.length
    }
  }
  return { from: sorted[after], to: sorted[(after + sorted.length - 1) % sorted.length] }
}

/** Rank positions using the same photographed ridge and fixed lens at every trial. */
export function rankPhotoLocations(trials: PhotoLocationCandidate[]): {
  candidates: PhotoLocationCandidate[]
  ambiguous: boolean
  spread: PhotoLocationSpread | null
} {
  const ranked = trials
    .filter(
      ({ fit }) => fit.fit.trustworthy && fit.fit.agreeing >= MIN_SKYLINE_COLUMNS && Number.isFinite(fit.meanLoss),
    )
    .sort((a, b) => a.fit.meanLoss - b.fit.meanLoss)
  const [first, second] = ranked
  const ambiguous =
    !!first?.fit.ambiguous || (!!second && second.fit.meanLoss - first.fit.meanLoss < AMBIGUOUS_LOSS_GAP)
  if (!ambiguous) return { candidates: ranked.slice(0, 3), ambiguous, spread: null }
  // Every fit about as good as the best, and each one's runner-up heading where it has one as close.
  const tied = ranked.filter(({ fit }) => fit.meanLoss - first.fit.meanLoss < AMBIGUOUS_LOSS_GAP)
  const headings = tied.flatMap(({ fit }) =>
    fit.ambiguous && fit.runnerUp ? [fit.bearing, fit.runnerUp.bearing] : [fit.bearing],
  )
  let metres = 0
  for (const a of tied) for (const b of tied) metres = Math.max(metres, haversineMeters(a, b))
  return { candidates: ranked.slice(0, 3), ambiguous, spread: { metres, headings: headingArc(headings) } }
}
