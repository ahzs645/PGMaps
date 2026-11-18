/** Read an archive's per-photo check results and print its scorecard as JSON. */
import { readFileSync } from 'node:fs'
import { photoScorecard, type ScorecardPhoto } from './lib/scorecard'

const path = process.argv[2]
if (!path) throw Error('Usage: node --import tsx scripts/forestry/photo-matching/scorecard.ts results.json')
const photos: unknown = JSON.parse(readFileSync(path, 'utf8'))
const pixelError = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
if (
  !Array.isArray(photos) ||
  !photos.every(
    (photo) =>
      photo &&
      typeof photo.id === 'string' &&
      photo.id.trim() &&
      ['passed', 'ambiguous', 'weak', 'unmeasured'].includes(photo.skyline) &&
      (photo.overlap === undefined ||
        (photo.overlap &&
          pixelError(photo.overlap.medianPx) &&
          pixelError(photo.overlap.p90Px) &&
          photo.overlap.medianPx <= photo.overlap.p90Px)) &&
      (photo.landmarks === undefined ||
        (Array.isArray(photo.landmarks) &&
          photo.landmarks.every(
            (landmark: NonNullable<ScorecardPhoto['landmarks']>[number]) =>
              landmark &&
              typeof landmark.group === 'string' &&
              landmark.group.trim() &&
              (landmark.errorPx === null || pixelError(landmark.errorPx)),
          ))),
  )
)
  throw Error('Expected an array of per-photo results with normalized pixel errors.')
console.log(JSON.stringify(photoScorecard(photos), null, 2))
