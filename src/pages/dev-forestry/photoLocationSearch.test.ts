import { describe, expect, it, vi } from 'vitest'
import {
  hasLocationRelief,
  headingArc,
  photoLocationTrials,
  rankPhotoLocations,
  searchByOneReader,
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
    trustworthy: trustworthy && !ambiguous,
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

describe('one skyline reader for the whole search', () => {
  it('keeps the colour reader alone when its best fit settles, trying no other reader', async () => {
    const tryAt = vi.fn(async (reader: string, place: number) =>
      reader === 'colour' && place === 1 ? fit(0.2, { agreement: 0.97 }) : reader === 'colour' ? fit(0.5) : null,
    )
    const passes: string[] = []
    const chosen = await searchByOneReader(['colour', 'bright', 'smooth'], 3, tryAt, (pass) => passes.push(pass))
    expect(chosen?.reader).toBe('colour')
    expect(chosen?.results.map((result) => result?.meanLoss)).toEqual([0.5, 0.2, 0.5])
    expect(tryAt.mock.calls.every(([reader]) => reader === 'colour')).toBe(true)
    expect(passes).toEqual(['first', 'first', 'first'])
  })

  it('compares places on one reader only, chosen by searchRank summed over the places', async () => {
    // At place 0 the bright reader fits best by far; at places 1 and 2 the smooth reader does, and it sums higher.
    // A per-place choice would rank place 0's bright fit (loss 0.40) against smooth's fits elsewhere (0.20): a loss
    // measured against another line. One reader throughout keeps place 0 at smooth's own fit there.
    const table: Record<string, Array<WideSearchResult | null>> = {
      colour: [fit(0.1, { agreeing: 10, agreement: 0.5 }), null, null],
      bright: [fit(0.4, { agreeing: 90, agreement: 0.9 }), fit(0.5, { agreeing: 10, agreement: 0.5 }), null],
      smooth: [
        fit(0.6, { agreeing: 30, agreement: 0.8 }),
        fit(0.2, { agreeing: 60, agreement: 0.9 }),
        fit(0.25, { agreeing: 60, agreement: 0.9 }),
      ],
    }
    const passes: string[] = []
    const chosen = await searchByOneReader(
      ['colour', 'bright', 'smooth'],
      3,
      async (reader, place) => table[reader][place],
      (pass, done) => passes.push(`${pass}${done}`),
    )
    expect(chosen?.reader).toBe('smooth')
    expect(chosen?.results).toEqual(table.smooth)
    expect(passes).toEqual(['first1', 'first2', 'first3', 'others1', 'others2', 'others3'])
    const ranked = rankPhotoLocations(
      chosen!.results.flatMap((result, place) =>
        result ? [{ ...photoLocationTrials(centre)[place], fit: result }] : [],
      ),
    )
    expect(ranked.candidates.map(({ fit }) => fit.meanLoss)).toEqual([0.2, 0.25, 0.6])
  })

  it('keeps the earlier reader on a tie, and answers null when no reader fits anywhere', async () => {
    const same = fit(0.2, { agreeing: 30, agreement: 0.5 })
    expect((await searchByOneReader(['colour', 'bright'], 2, async () => same))?.reader).toBe('colour')
    expect(await searchByOneReader(['colour', 'bright'], 2, async () => null)).toBeNull()
    expect(await searchByOneReader([], 2, async () => same)).toBeNull()
  })
})

describe('ambiguity never settles the first reader', () => {
  it('tries other readers after a strong but ambiguous heading', async () => {
    const tryAt = vi.fn(async (reader: string) =>
      reader === 'colour'
        ? fit(0.2, { agreement: 0.97, ambiguous: true, runnerUp: 130 })
        : fit(0.15, { agreement: 0.99 }),
    )
    await searchByOneReader(['colour', 'bright'], 1, tryAt)
    expect(tryAt).toHaveBeenCalledWith('bright', 0)
  })
  it('tries other readers after a strong but ambiguous place', async () => {
    const tryAt = vi.fn(async (reader: string, place: number) =>
      reader === 'colour' ? fit(0.2 + place * 0.02, { agreement: 0.97 }) : null,
    )
    await searchByOneReader(['colour', 'bright'], 2, tryAt)
    expect(tryAt).toHaveBeenCalledWith('bright', 0)
    expect(tryAt).toHaveBeenCalledWith('bright', 1)
  })
})
