import { describe, expect, it } from 'vitest'
import { COLOR_RAMPS } from '@pgmaps/geo-toolkit/scales/colorRamps'
import {
  costRampColors,
  DEFAULT_COST_COLOURING,
  DEFAULT_ROAD_COLOURING,
  isDefaultCostColouring,
  isDefaultGradeColouring,
  parseRoadColouring,
  ratioText,
} from './roadColouring'

describe('road colouring settings', () => {
  it('reads nothing, or something that is not settings, as the defaults', () => {
    for (const value of [undefined, null, 3, 'cost', [], {}])
      expect(parseRoadColouring(value)).toEqual(DEFAULT_ROAD_COLOURING)
    expect(isDefaultCostColouring(DEFAULT_ROAD_COLOURING.cost)).toBe(true)
    expect(isDefaultGradeColouring(DEFAULT_ROAD_COLOURING.grade)).toBe(true)
  })

  it('keeps what it holds and replaces only a value out of range with its default', () => {
    const read = parseRoadColouring({
      mode: 'cost',
      cost: { reference: 'target', targetPerMetre: 650, minRatio: 0.5, maxRatio: 250, ramp: 'rdylgn', reverse: false },
      grade: { breaks: [0.6, 0.4], colors: { gentle: '#ABCDEF', moderate: 'red', steep: '#112233' } },
    })
    expect(read.mode).toBe('cost')
    expect(read.cost).toEqual({
      reference: 'target',
      targetPerMetre: 650,
      minRatio: 0.5,
      maxRatio: DEFAULT_COST_COLOURING.maxRatio,
      ramp: 'rdylgn',
      reverse: false,
    })
    // Breaks that do not rise are the default pair; a colour that is not a hex is the default.
    expect(read.grade).toEqual({
      breaks: [0.5, 0.75],
      colors: { gentle: '#abcdef', moderate: '#ca8a04', steep: '#112233' },
    })
  })

  it('draws a person’s own ramp from the colours kept with it, and an unknown ramp as the default', () => {
    const own = parseRoadColouring({ cost: { ramp: 'custom:Mine', rampColors: ['#000000', '#FFFFFF'] } }).cost
    expect(own.ramp).toBe('custom:Mine')
    expect(costRampColors(own)).toEqual(['#000000', '#ffffff'])
    const lost = parseRoadColouring({ cost: { ramp: 'custom:Gone' } }).cost
    expect(lost.ramp).toBe(DEFAULT_COST_COLOURING.ramp)
    const blues = COLOR_RAMPS.find((ramp) => ramp.id === 'blues')!.colors
    expect(costRampColors({ ...DEFAULT_COST_COLOURING, ramp: 'blues', reverse: false })).toEqual(blues)
    expect(costRampColors({ ...DEFAULT_COST_COLOURING, ramp: 'blues', reverse: true })).toEqual([...blues].reverse())
  })

  it('writes multiples as people do', () => {
    expect([0.25, 0.5, 0.75, 2, 1.5, 0.333333].map(ratioText)).toEqual(['¼', '½', '¾', '2', '1.5', '0.333'])
  })
})
