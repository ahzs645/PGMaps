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
  | {
      status: 'searching'
      checked: number
      total: number
      /** Set while the other skyline readers are tried, the colour reader not having settled (`searchByOneReader`). */
      otherReaders?: true
    }
  | {
      status: 'done'
      candidates: PhotoLocationCandidate[]
      ambiguous: boolean
      /** Present when `ambiguous`: what the tie leaves open. */
      spread: PhotoLocationSpread | null
      sampled: number
      /** The manually requested second reader, never used in the background. */
      textureFallback?: boolean
      noSkyline?: boolean
      centre?: PhotoLocation
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
 * One skyline reader for the whole search, so every place is scored against the same reading of the photo's skyline:
 * a mean loss is a distance between that reading and a place's terrain, and two places scored on different readers'
 * skylines are not comparable. The rule is the camera search's (`SKYLINE_READERS`), applied over the places: the first
 * reader (colour) is tried at every place and kept alone when its best fit settles (`READER_SETTLED_AGREEMENT`,
 * credible and without a direction or location tie); else every other reader is tried at every place, and the reader kept is the one whose fits sum to the
 * highest `searchRank` over the places (a place it cannot read adds nothing), the earlier reader on a tie.
 *
 * `tryAt` answers a reader's fit at a place, or null where the reader's skyline is too short or not believable there,
 * or the place gives no usable fit. `onPlace` hears each place finished, by pass. Answers that reader's result at each
 * place (null where it has none), or null when no reader fits anywhere.
 */
export async function searchByOneReader<R>(
  readers: ReadonlyArray<R>,
  places: number,
  tryAt: (reader: R, place: number) => Promise<WideSearchResult | null>,
  onPlace?: (pass: 'first' | 'others', done: number) => void,
): Promise<{ reader: R; results: Array<WideSearchResult | null> } | null> {
  const [first, ...others] = readers
  if (first === undefined) return null
  const firstResults: Array<WideSearchResult | null> = []
  for (let place = 0; place < places; place++) {
    firstResults.push(await tryAt(first, place))
    onPlace?.('first', place + 1)
  }
  const [best, second] = firstResults.filter(isPlaceFit).sort((a, b) => a.meanLoss - b.meanLoss)
  if (
    best &&
    best.trustworthy &&
    !best.ambiguous &&
    best.fit.agreement >= READER_SETTLED_AGREEMENT &&
    (!second || second.meanLoss - best.meanLoss >= AMBIGUOUS_LOSS_GAP)
  )
    return { reader: first, results: firstResults }
  const perReader: Array<Array<WideSearchResult | null>> = [firstResults, ...others.map(() => [])]
  for (let place = 0; place < places; place++) {
    const atPlace = await Promise.all(others.map((reader) => tryAt(reader, place)))
    atPlace.forEach((result, k) => perReader[k + 1].push(result))
    onPlace?.('others', place + 1)
  }
  const total = (results: ReadonlyArray<WideSearchResult | null>) =>
    results.reduce((sum, result) => sum + (result ? searchRank(result) : 0), 0)
  let chosen = -1
  perReader.forEach((results, k) => {
    if (!results.some(Boolean)) return
    if (chosen < 0 || total(results) > total(perReader[chosen])) chosen = k
  })
  return chosen < 0 ? null : { reader: readers[chosen], results: perReader[chosen] }
}

function isPlaceFit(fit: WideSearchResult | null): fit is WideSearchResult {
  return !!fit && fit.fit.trustworthy && fit.fit.agreeing >= MIN_SKYLINE_COLUMNS && Number.isFinite(fit.meanLoss)
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

/**
 * Rank positions using the same photographed ridge and fixed lens at every trial: every fit must come from one skyline
 * reader (`searchByOneReader`), so the mean losses compared here and the near tie judged on them measure the same line.
 */
export function rankPhotoLocations(trials: PhotoLocationCandidate[]): {
  candidates: PhotoLocationCandidate[]
  ambiguous: boolean
  spread: PhotoLocationSpread | null
} {
  const ranked = trials.filter(({ fit }) => isPlaceFit(fit)).sort((a, b) => a.fit.meanLoss - b.fit.meanLoss)
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
