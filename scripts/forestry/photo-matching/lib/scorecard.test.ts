import assert from 'node:assert/strict'
import { test } from 'node:test'
import { photoScorecard } from './scorecard'

test('counts a photo once when both methods offer a candidate and reports missing accuracy measurements', () => {
  const score = photoScorecard([
    { id: 'a', skyline: 'passed', overlap: { medianPx: 3, p90Px: 5 } },
    { id: 'b', skyline: 'ambiguous', overlap: { medianPx: 6, p90Px: 11 } },
    { id: 'c', skyline: 'weak' },
  ])
  assert.equal(score.reviewCoverage.count, 2)
  assert.equal(score.reviewCoverage.total, 3)
  assert.equal(score.overlap.p90OfPhotoP90sPx, 11)
  assert.equal(score.independent.coverage.count, 0)
  assert.equal(score.independent.p90OfPhotoP90sPx, null)
})

test('uses independent groups and preserves an unprojectable landmark in the scorecard', () => {
  const score = photoScorecard([
    {
      id: 'a',
      skyline: 'passed',
      landmarks: [
        { group: 'road', errorPx: 2 },
        { group: 'road', errorPx: 3 },
        { group: 'shore', errorPx: 1 },
      ],
    },
    {
      id: 'b',
      skyline: 'ambiguous',
      landmarks: [
        { group: 'road', errorPx: 2 },
        { group: 'shore', errorPx: null },
        { group: 'peak', errorPx: 4 },
      ],
    },
  ])
  assert.equal(score.independent.coverage.count, 1)
  assert.equal(score.independent.photosWithMissingProjections, 1)
  assert.equal(score.independent.p90OfPhotoP90sPx, null)
})

test('reports an archive statistic with valid mapped checks across distinct photos', () => {
  const score = photoScorecard(
    [4, 12, 30].map((errorPx, i) => ({
      id: String(i),
      skyline: 'passed',
      landmarks: [
        { group: 'road', errorPx: 2 },
        { group: 'shore', errorPx },
        { group: 'peak', errorPx: 3 },
      ],
    })),
  )
  assert.equal(score.independent.medianOfPhotoP90sPx, 12)
  assert.equal(score.independent.p90OfPhotoP90sPx, 30)
})
