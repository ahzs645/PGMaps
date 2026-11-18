import { describe, expect, it } from 'vitest'
import { profileSearchBand, searchBandSamples, shownSearchBand } from './profileSearchBand'
import type { VerticalOptimizationReport } from './verticalOptimizer'
import type { VerticalPoint } from './types'

const band = (patch: Partial<VerticalOptimizationReport['band']> = {}): VerticalOptimizationReport['band'] => ({
  centre: 'ground',
  belowM: 2,
  aboveM: 5,
  levelStepM: 0.5,
  levelsPerPvi: 15,
  range: { from: 100, to: 300, asked: { from: 100, to: 300 } },
  line: [
    { chainage: 100, elevation: 800 },
    { chainage: 110, elevation: 801.5 },
    { chainage: 120, elevation: NaN },
    { chainage: 130, elevation: 803 },
  ],
  ...patch,
})
const vertical: VerticalPoint[] = [
  { id: 'a', chainage: 0, elevation: 790, curveLength: 0 },
  { id: 'b', chainage: 200, elevation: 805, curveLength: 30 },
  { id: 'c', chainage: 400, elevation: 812, curveLength: 0 },
]
const road = { id: 'road', activeVerticalAlternativeId: 'p1', vertical }
const report = { band: band() } as VerticalOptimizationReport

describe('profile search band', () => {
  it('runs from the centre less “below” to the centre plus “above”, at the stations the run priced', () => {
    expect(searchBandSamples(band())).toEqual([
      { chainage: 100, centre: 800, low: 798, high: 805 },
      { chainage: 110, centre: 801.5, low: 799.5, high: 806.5 },
      { chainage: 130, centre: 803, low: 801, high: 808 },
    ])
  })

  it('is drawn only on the road, profile and terrain it was searched on', () => {
    const terrain = {}
    const kept = profileSearchBand(report, road, terrain)
    expect(shownSearchBand(kept, road, terrain)).toHaveLength(3)
    expect(shownSearchBand(null, road, terrain)).toBeNull()
    expect(shownSearchBand(kept, { ...road, id: 'other' }, terrain)).toBeNull()
    expect(shownSearchBand(kept, { ...road, activeVerticalAlternativeId: 'p2' }, terrain)).toBeNull()
    expect(shownSearchBand(kept, road, {})).toBeNull()
    // A profile edited since the run puts the band away; the same profile re-read keeps it.
    const moved = vertical.map((p) => (p.id === 'b' ? { ...p, elevation: 806 } : p))
    expect(shownSearchBand(kept, { ...road, vertical: moved }, terrain)).toBeNull()
    expect(shownSearchBand(kept, { ...road, vertical: vertical.map((p) => ({ ...p })) }, terrain)).toHaveLength(3)
  })
})
