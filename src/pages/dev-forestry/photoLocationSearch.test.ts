import { describe, expect, it, vi } from 'vitest'
import {
  bestReaderFit,
  hasLocationRelief,
  headingArc,
  photoLocationTrials,
  rankPhotoLocations,
  type PhotoLocationCandidate,
} from './photoLocationSearch'
import { haversineMeters } from './visibility'
import type { WideSearchResult } from './wideOrientation'

const centre = { lng: -122, lat: 53 }

function fit(
  meanLoss: number,
  {
    trustworthy = true,
    agreeing = 50,
    agreement = 0.8,
    ambiguous = false,
    bearing = 45,
    runnerUp = null as number | null,
  } = {},
) {
  return {
    bearing,
    pitch: 0,
    roll: 0,
    meanLoss,
    ambiguous,
    runnerUp: runnerUp === null ? null : { bearing: runnerUp, pitch: 0, roll: 0, meanLoss: meanLoss + 0.05 },
    fit: { trustworthy, agreeing, agreement },
  } as unknown as WideSearchResult
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

  it('keeps credible fits and names how far apart a near tie leaves the positions and headings', () => {
    const places = photoLocationTrials(centre)
    const trials: PhotoLocationCandidate[] = [
      { ...places[0], fit: fit(0.45, { bearing: 40 }) },
      { ...places[1], fit: fit(0.03, { trustworthy: false }) },
      { ...places[2], fit: fit(0.09, { agreeing: 2 }) },
      { ...places[3], fit: fit(0.47, { bearing: 310 }) },
    ]
    const ranked = rankPhotoLocations(trials)
    expect(ranked.candidates).toEqual([trials[0], trials[3]])
    expect(ranked.ambiguous).toBe(true)
    expect(ranked.spread?.metres).toBeCloseTo(haversineMeters(places[0], places[3]), 6)
    // The smallest arc holding 310° and 40°, clockwise across north.
    expect(ranked.spread?.headings).toEqual({ from: 310, to: 40 })
  })

  it('keeps a poorly distinguished direction visible as ambiguous even for a single site, with its runner-up', () => {
    const single = rankPhotoLocations([{ ...centre, fit: fit(0.3, { ambiguous: true, bearing: 100, runnerUp: 200 }) }])
    expect(single.ambiguous).toBe(true)
    expect(single.spread).toEqual({ metres: 0, headings: { from: 100, to: 200 } })
    expect(rankPhotoLocations([{ ...centre, fit: fit(0.3) }])).toMatchObject({ ambiguous: false, spread: null })
  })

  it('takes the smallest clockwise arc round the headings', () => {
    expect(headingArc([10, 350, 20])).toEqual({ from: 350, to: 20 })
    expect(headingArc([90])).toEqual({ from: 90, to: 90 })
  })
})

describe('the skyline readers at one place', () => {
  it('stops at the first reader when its fit settles', async () => {
    const tryReader = vi.fn(async (reader: string) => (reader === 'colour' ? fit(0.2, { agreement: 0.97 }) : null))
    const best = await bestReaderFit(['colour', 'bright', 'smooth'], tryReader)
    expect(best?.reader).toBe('colour')
    expect(tryReader).toHaveBeenCalledTimes(1)
  })

  it('searches every reader when the first does not settle, and keeps the best by searchRank', async () => {
    const results = new Map<string, WideSearchResult | null>([
      ['colour', fit(0.2, { agreeing: 20, agreement: 0.6 })],
      ['bright', fit(0.25, { agreeing: 60, agreement: 0.9 })],
      ['smooth', fit(0.1, { agreeing: 40, agreement: 0.9, trustworthy: false })],
      ['dim', null],
    ])
    const tryReader = vi.fn(async (reader: string) => results.get(reader) ?? null)
    const best = await bestReaderFit([...results.keys()], tryReader)
    expect(tryReader.mock.calls.map(([reader]) => reader)).toEqual(['colour', 'bright', 'smooth', 'dim'])
    expect(best?.reader).toBe('bright')
  })

  it('keeps the earlier reader on a tie, and answers null when no reader reads a skyline', async () => {
    const same = fit(0.2, { agreeing: 30, agreement: 0.5 })
    expect((await bestReaderFit(['colour', 'bright'], async () => same))?.reader).toBe('colour')
    expect(await bestReaderFit(['colour', 'bright'], async () => null)).toBeNull()
    expect(await bestReaderFit([], async () => same)).toBeNull()
  })
})
