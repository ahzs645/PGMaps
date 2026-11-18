/** Per-photo coverage and held-out image errors, measured on a common 1,050 px frame. */
export type ScorecardPhoto = {
  id: string
  skyline: 'passed' | 'ambiguous' | 'weak' | 'unmeasured'
  /** The selected overlap candidate's error from spatial hold-out. */
  overlap?: { medianPx: number; p90Px: number }
  /** Measured on independent mapped features excluded from the fit. Null means a landmark did not project. */
  landmarks?: Array<{ group: string; errorPx: number | null }>
}

const MIN_INDEPENDENT_GROUPS = 3

function percentile(values: readonly number[], percentile: number): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  if (percentile === 50) {
    const middle = Math.floor(ordered.length / 2)
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
  }
  return ordered[Math.ceil((ordered.length * percentile) / 100) - 1]
}

export function photoScorecard(photos: readonly ScorecardPhoto[]) {
  if (new Set(photos.map((photo) => photo.id)).size !== photos.length) throw Error('Photo IDs must be unique.')
  const total = photos.length
  const coverage = (count: number) => ({ count, total, percent: total ? (100 * count) / total : null })
  const skyline = photos.filter((photo) => photo.skyline === 'passed').length
  const withOverlap = photos.filter((photo) => photo.overlap !== undefined)
  const measured: number[] = []
  let measuredWithMissing = 0
  let attempted = 0
  for (const photo of photos) {
    const groups = new Map<string, number>()
    for (const landmark of photo.landmarks ?? []) {
      const error = landmark.errorPx ?? Infinity
      groups.set(landmark.group, Math.max(groups.get(landmark.group) ?? 0, error))
    }
    if (groups.size < MIN_INDEPENDENT_GROUPS) continue
    attempted++
    // Give distinct features equal weight and preserve missed projections.
    const errors = [...groups.values()]
    if (errors.every(Number.isFinite)) measured.push(percentile(errors, 90)!)
    else measuredWithMissing++
  }
  // Each photo contributes one statistic so a dense cluster cannot dominate the archive.
  return {
    photos: total,
    skyline: {
      passed: skyline,
      ambiguous: photos.filter((photo) => photo.skyline === 'ambiguous').length,
      weak: photos.filter((photo) => photo.skyline === 'weak').length,
      unmeasured: photos.filter((photo) => photo.skyline === 'unmeasured').length,
    },
    reviewCoverage: coverage(photos.filter((photo) => photo.skyline === 'passed' || photo.overlap).length),
    overlap: {
      coverage: coverage(withOverlap.length),
      medianOfPhotoMediansPx: percentile(
        withOverlap.map((photo) => photo.overlap!.medianPx),
        50,
      ),
      p90OfPhotoP90sPx: percentile(
        withOverlap.map((photo) => photo.overlap!.p90Px),
        90,
      ),
    },
    independent: {
      coverage: coverage(attempted),
      photosWithMissingProjections: measuredWithMissing,
      // The statistic remains undefined if a measured photo has an unprojectable check.
      medianOfPhotoP90sPx: measuredWithMissing ? null : percentile(measured, 50),
      p90OfPhotoP90sPx: measuredWithMissing ? null : percentile(measured, 90),
    },
  }
}
