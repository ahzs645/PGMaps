import type { ProfilePoint } from './skylineFit'
import { metersPerDegree } from './visibility'
import { AMBIGUOUS_LOSS_GAP, MIN_SKYLINE_COLUMNS, type WideSearchResult } from './wideOrientation'

export type PhotoLocation = { lng: number; lat: number }

export type PhotoLocationCandidate = PhotoLocation & { fit: WideSearchResult }

export type PhotoLocationBasis = { hfov: number; eyeHeightMeters: number; altitudeMeters: number | null }

export type PhotoLocationSearch =
  | { status: 'searching'; checked: number; total: number }
  | {
      status: 'done'
      candidates: PhotoLocationCandidate[]
      ambiguous: boolean
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

/** Rank positions using the same photographed ridge and fixed lens at every trial. */
export function rankPhotoLocations(trials: PhotoLocationCandidate[]) {
  const ranked = trials
    .filter(
      ({ fit }) => fit.fit.trustworthy && fit.fit.agreeing >= MIN_SKYLINE_COLUMNS && Number.isFinite(fit.meanLoss),
    )
    .sort((a, b) => a.fit.meanLoss - b.fit.meanLoss)
  const [first, second] = ranked
  return {
    candidates: ranked.slice(0, 3),
    ambiguous: !!first?.fit.ambiguous || (!!second && second.fit.meanLoss - first.fit.meanLoss < AMBIGUOUS_LOSS_GAP),
  }
}
