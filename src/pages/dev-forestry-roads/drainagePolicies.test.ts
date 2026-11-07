import { describe, expect, it } from 'vitest'
import { parseDepressionPolicy, parseSnapPolicy } from './drainagePolicies'

describe('serialized drainage assumptions', () => {
  it('keeps omitted policies compatible with legacy runs', () => {
    expect(parseDepressionPolicy()).toEqual({ mode: 'fill-all' })
    expect(parseSnapPolicy()).toBe('max-accumulation')
  })

  it('accepts preservation, full filling, and bounded fill caps including zero', () => {
    expect(parseDepressionPolicy({ mode: 'preserve' })).toEqual({ mode: 'preserve' })
    expect(parseDepressionPolicy({ mode: 'fill-all' })).toEqual({ mode: 'fill-all' })
    expect(parseDepressionPolicy({ mode: 'depth-limited', maxDepthM: 0 })).toEqual({
      mode: 'depth-limited',
      maxDepthM: 0,
    })
    expect(parseDepressionPolicy({ mode: 'depth-limited', maxDepthM: 1000 })).toEqual({
      mode: 'depth-limited',
      maxDepthM: 1000,
    })
    expect(parseSnapPolicy('lowest-elevation')).toBe('lowest-elevation')
  })

  it('rejects malformed policies instead of silently changing the saved assumption', () => {
    for (const value of [null, [], 'preserve', {}, { mode: 'other' }])
      expect(() => parseDepressionPolicy(value)).toThrow()
    for (const value of [undefined, null, '1', -1, 1001, Infinity, NaN])
      expect(() => parseDepressionPolicy({ mode: 'depth-limited', maxDepthM: value })).toThrow(/depth/)
    for (const value of [null, '', 'nearest', 1]) expect(() => parseSnapPolicy(value)).toThrow(/policy/)
  })
})
