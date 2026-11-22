import { describe, expect, it } from 'vitest'
import {
  hasLocationRelief,
  photoLocationTrials,
  rankPhotoLocations,
  type PhotoLocationCandidate,
} from './photoLocationSearch'
import { haversineMeters } from './visibility'
import type { WideSearchResult } from './wideOrientation'

const centre = { lng: -122, lat: 53 }

function fit(meanLoss: number, { trustworthy = true, agreeing = 50, ambiguous = false } = {}) {
  return {
    bearing: 45,
    pitch: 0,
    roll: 0,
    meanLoss,
    ambiguous,
    fit: { trustworthy, agreeing },
  } as WideSearchResult
}

describe('photo location search', () => {
  it('samples a bounded square around the map pick, with a trial at the pick itself', () => {
    const sites = photoLocationTrials(centre)
    expect(sites).toHaveLength(9)
    expect(sites[0]).toEqual(centre)
    expect(new Set(sites.map(({ lng, lat }) => `${lng},${lat}`)).size).toBe(9)
    expect(Math.max(...sites.map((site) => haversineMeters(centre, site)))).toBeLessThan(720)
  })

  it('rejects a nearly flat horizon even when its height is known perfectly', () => {
    const profile = (elevations: number[]) =>
      elevations.map((elevation, azimuth) => ({ elevation, azimuth, distanceMeters: 4000 }))
    expect(hasLocationRelief(profile([NaN, 1, 1.04, 0.94]))).toBe(false)
    expect(hasLocationRelief(profile([1, 1.4, 1.05]))).toBe(true)
    expect(hasLocationRelief([])).toBe(false)
  })

  it('keeps credible fits and flags a near tie between different positions', () => {
    const places = photoLocationTrials(centre)
    const trials: PhotoLocationCandidate[] = [
      { ...places[0], fit: fit(0.45) },
      { ...places[1], fit: fit(0.03, { trustworthy: false }) },
      { ...places[2], fit: fit(0.09, { agreeing: 2 }) },
      { ...places[3], fit: fit(0.47) },
    ]
    expect(rankPhotoLocations(trials)).toEqual({ candidates: [trials[0], trials[3]], ambiguous: true })
  })

  it('keeps a poorly distinguished direction visible as ambiguous even for a single site', () => {
    expect(rankPhotoLocations([{ ...centre, fit: fit(0.3, { ambiguous: true }) }]).ambiguous).toBe(true)
    expect(rankPhotoLocations([{ ...centre, fit: fit(0.3) }]).ambiguous).toBe(false)
  })
})
