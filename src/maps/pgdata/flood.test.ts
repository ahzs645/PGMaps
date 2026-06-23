import { describe, expect, it } from 'vitest'
import { getReturnPeriodScore } from './flood'

describe('getReturnPeriodScore', () => {
  it('uses the lower bound for RFC return-period ranges', () => {
    expect(getReturnPeriodScore('=1-2Y')).toBe(1)
    expect(getReturnPeriodScore('=2-5Y')).toBe(2)
    expect(getReturnPeriodScore('=5 to 10y')).toBe(5)
    expect(getReturnPeriodScore('=20 to 50y')).toBe(20)
  })

  it('handles normal and missing RFC return-period values', () => {
    expect(getReturnPeriodScore('<1Y')).toBe(0)
    expect(getReturnPeriodScore('=NO DATA')).toBe(-1)
    expect(getReturnPeriodScore('=NO RTP')).toBe(-1)
    expect(getReturnPeriodScore('N/A')).toBe(-1)
  })
})
