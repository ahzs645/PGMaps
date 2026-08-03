import { describe, expect, it } from 'vitest'
import { nullableStringArrayCodec, stringArrayCodec } from './useUrlState'

const RATINGS = ['Low', 'Moderate', 'Unknown'] as const

describe('stringArrayCodec', () => {
  it('omits the param when the value matches the defaults', () => {
    const codec = stringArrayCodec(RATINGS, RATINGS)
    expect(codec.encode(['Low', 'Moderate', 'Unknown'])).toBeNull()
    expect(codec.decode(null)).toEqual([...RATINGS])
  })

  it('round-trips a partial selection regardless of order', () => {
    const codec = stringArrayCodec(RATINGS, RATINGS)
    expect(codec.encode(['Unknown', 'Low'])).toBe('Low,Unknown')
    expect(codec.decode('Low,Unknown')).toEqual(['Low', 'Unknown'])
  })

  it('round-trips an empty selection instead of falling back to the defaults', () => {
    const codec = stringArrayCodec(RATINGS, RATINGS)
    const encoded = codec.encode([])
    expect(encoded).not.toBeNull()
    expect(codec.decode(encoded)).toEqual([])
  })

  it('still omits the param when empty *is* the default', () => {
    const codec = stringArrayCodec(RATINGS, [])
    expect(codec.encode([])).toBeNull()
    expect(codec.decode(null)).toEqual([])
  })

  it('does not shadow a selectable value literally named "none"', () => {
    const allowed = ['none', 'some'] as const
    const codec = stringArrayCodec(allowed, allowed)
    expect(codec.decode('none')).toEqual(['none'])
    expect(codec.decode(codec.encode([]))).toEqual([])
  })

  it('drops values outside the allowed set', () => {
    const codec = stringArrayCodec(RATINGS, RATINGS)
    expect(codec.decode('Low,Bogus')).toEqual(['Low'])
  })
})

describe('nullableStringArrayCodec', () => {
  it('treats an absent param as unset, distinct from an empty selection', () => {
    const codec = nullableStringArrayCodec()
    expect(codec.decode(null)).toBeNull()
    expect(codec.encode(null)).toBeNull()
    expect(codec.decode(codec.encode([]))).toEqual([])
  })

  it('accepts any token when no allowed list is given', () => {
    const codec = nullableStringArrayCodec()
    expect(codec.decode('purpleair,aqegg')).toEqual(['purpleair', 'aqegg'])
  })

  it('filters against the allowed list when one is given', () => {
    const codec = nullableStringArrayCodec(RATINGS)
    expect(codec.decode('Low,Bogus')).toEqual(['Low'])
  })
})
