import { describe, expect, it } from 'vitest'
import { culvertInletSide, culvertInletSign, parseCulvertInletSide, withInletSide } from './culvertInlet'
import { parseEngineering } from '../engineeringProject'
import { createEngineeringDesign } from '../engineeringTypes'

describe('culvert inlet side', () => {
  it('reads absent as left and never stores left', () => {
    expect(culvertInletSide({})).toBe('left')
    expect(culvertInletSign({})).toBe(-1)
    expect(culvertInletSign({ inletSide: 'right' })).toBe(1)
    expect(parseCulvertInletSide(undefined)).toEqual({})
    expect(parseCulvertInletSide('left')).toEqual({})
    expect(parseCulvertInletSide('right')).toEqual({ inletSide: 'right' })
    expect(() => parseCulvertInletSide('up')).toThrow(/left or right/)
    const right = withInletSide({ id: 'a' } as { id: string; inletSide?: 'left' | 'right' }, 'right')
    expect(right).toEqual({ id: 'a', inletSide: 'right' })
    expect(withInletSide(right, 'left')).toEqual({ id: 'a' })
  })

  it('round-trips a project file: right kept, left and absent read the same', () => {
    const base = {
      id: 'c',
      name: 'CD',
      chainage: 10,
      skewDegrees: 0,
      lengthM: 10,
      diameterM: 0.6,
      inletInvertM: null,
      outletInvertM: null,
      minCoverM: 0.6,
      unitCost: 0,
      fixedCost: 0,
    }
    const read = (side?: string) =>
      parseEngineering({ ...createEngineeringDesign(), culverts: [{ ...base, inletSide: side }] }, (t) => t as never)
        .culverts[0]
    expect(read('right').inletSide).toBe('right')
    expect('inletSide' in read('left')).toBe(false)
    expect(read(undefined)).toEqual(read('left'))
  })
})
