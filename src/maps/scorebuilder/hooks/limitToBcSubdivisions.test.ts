import { describe, expect, it } from 'vitest'
import { limitToBcSubdivisions } from './useScoreBuilderDatasets'

const region = (level: string, code: string, source = 'census') => ({ source, level, code })

describe('limitToBcSubdivisions', () => {
  it.each(['csd', 'northSouthCsd'])('keeps only BC at the national %s level', (level) => {
    const regions = [region(level, '5953023'), region(level, '4806016')]
    expect(limitToBcSubdivisions(regions)).toEqual([regions[0]])
  })

  it('leaves every other study area alone', () => {
    const regions = [region('ct', '9700001'), region('watershedGroup', '100', 'watershed')]
    expect(limitToBcSubdivisions(regions)).toBe(regions)
  })
})
