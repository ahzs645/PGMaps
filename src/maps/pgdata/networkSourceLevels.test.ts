import { describe, expect, it } from 'vitest'
import { networkSourceLevels } from './networkSourceLevels'
import { networkGridPalette } from './networkGridPalette'

describe('saved network source levels', () => {
  it('offers every saved raster level without claiming live-only zooms', () => {
    expect(networkSourceLevels('bell', 'lte')).toEqual({ min: 4, max: 10 })
    expect(networkSourceLevels('rogers', '4g')).toEqual({ min: 3, max: 10 })
    for (let z = 0; z <= 12; z++) {
      expect(networkSourceLevels('bell', 'lte', String(z))).toEqual(z >= 4 && z <= 10 ? { min: z, max: z } : null)
      expect(networkSourceLevels('rogers', '4g', String(z))).toEqual(z >= 3 && z <= 10 ? { min: z, max: z } : null)
    }
  })
  it('keeps the partial TELUS LTE level separate from other TELUS bands', () => {
    expect(networkSourceLevels('telus', 'telus-lte', '6')).toEqual({ min: 6, max: 6 })
    expect(networkSourceLevels('telus', 'telus-5g', '6')).toBeNull()
    expect(networkSourceLevels('rogers', '4g', 'invalid')).toBeNull()
  })
  it('classifies all saved raw and derived carrier bands', () => {
    for (const layer of ['lte', 'lte-advanced', '5g', '5g-plus', '5g-plus-advanced', 'hspa', 'lte-m']) expect(networkGridPalette('bell', layer).length).toBeGreaterThan(0)
    for (const layer of ['4g5g', '4g5g-only', '5g-only', '5g-plus-only', '4g', '3g', 'ltem', 'nbiot', 'comp_sat']) expect(networkGridPalette('rogers', layer).length).toBeGreaterThan(0)
    expect(networkGridPalette('rogers', '4g5g').map(p => p.value)).toEqual([1, 2, 3])
    expect(networkGridPalette('rogers', '5g-plus-only')[0].value).toBe(2)
    expect(() => networkGridPalette('rogers', 'not-saved')).toThrow('Unknown')
  })
})
