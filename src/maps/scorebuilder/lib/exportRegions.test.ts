import { describe, expect, it } from 'vitest'
import { scoredRegionsCsv } from './exportRegions'
import type { ScoredBoundaryRegion, ScoreMetricDefinition } from '../types'

const region = {
  rank: 1,
  rankConfidence: 'Stable priority',
  rankInterval: [1, 2],
  score: 86.7,
  scoreInterval: [80, 90],
  comparisonUniverseLabel: 'Community polygons',
  missingDataFlags: [],
  region: { name: 'Millar, Addition', code: '21', areaKm2: 1.26 },
  metrics: { parkDensity: 6.8661, 'bcEnviroScreen.copd': Number.NaN },
} as unknown as ScoredBoundaryRegion

const metrics = [
  { key: 'parkDensity', label: 'Park Density' },
  { key: 'bcEnviroScreen.copd', label: 'COPD' },
] as unknown as ScoreMetricDefinition[]

const base = { metrics, aggregation: 'additive', filenameStem: 'x' } as const

describe('scoredRegionsCsv', () => {
  it('escapes a double quote and a comma in a region name', () => {
    const named = { ...region, region: { ...region.region, name: 'Fort "North" Side, BC' } } as ScoredBoundaryRegion
    expect(scoredRegionsCsv([named], { ...base, includeScores: true })).toContain('"Fort ""North"" Side, BC"')
  })

  it('writes only the metrics it is given, and leaves a missing value blank', () => {
    const csv = scoredRegionsCsv([region], { ...base, includeScores: true })
    expect(csv).toContain('"Park Density","COPD"')
    expect(csv).toContain('"6.8661",""')
    expect(csv).not.toContain('NaN')
  })

  it('leaves out HealthyPlan and module columns no region has', () => {
    const csv = scoredRegionsCsv([region], { ...base, includeScores: true })
    expect(csv).not.toContain('HealthyPlan')
    expect(csv).not.toContain('Module scores')
  })

  it('keeps a comma in a name inside its own cell', () => {
    expect(scoredRegionsCsv([region], { ...base, includeScores: false })).toContain('"Millar, Addition","21","1.3"')
  })

  it('has no score columns for a lens lab', () => {
    expect(scoredRegionsCsv([region], { ...base, includeScores: false })).not.toContain('Rank')
  })
})
