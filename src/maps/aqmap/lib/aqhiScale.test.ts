import { describe, expect, it } from 'vitest'
import {
  AQHI_LEVELS,
  AQHI_NO_DATA_COLOR,
  AQHI_RAMP_COLORS,
  getAqhiLevel,
  getAqhiPlusCategory,
  getAqhiPlusColor,
} from './aqhiScale'

describe('AQHI+ scale', () => {
  it('keeps the eleven published levels and their colours', () => {
    expect(AQHI_LEVELS).toHaveLength(11)
    expect(AQHI_RAMP_COLORS[0]).toBe('#21c6f5')
    expect(AQHI_RAMP_COLORS[10]).toBe('#650205')
    expect(AQHI_LEVELS.at(-1)?.id).toBe('+')
  })

  it('covers 0-100 in contiguous 10 µg/m³ steps, then opens ended', () => {
    AQHI_LEVELS.forEach((level, index) => {
      expect(level.min).toBe(index * 10)
      if (index < 10) expect(level.max).toBe((index + 1) * 10)
    })
    expect(AQHI_LEVELS.at(-1)?.max).toBe(Number.POSITIVE_INFINITY)
  })

  it('resolves readings on the published boundaries', () => {
    expect(getAqhiLevel(0)?.id).toBe(1)
    expect(getAqhiLevel(9.9)?.id).toBe(1)
    expect(getAqhiLevel(10)?.id).toBe(2)
    expect(getAqhiLevel(99.9)?.id).toBe(10)
    expect(getAqhiLevel(100)?.id).toBe('+')
    expect(getAqhiLevel(5000)?.id).toBe('+')
  })

  it('treats missing, invalid and negative readings as no data', () => {
    for (const reading of [null, undefined, Number.NaN, -1]) {
      expect(getAqhiLevel(reading)).toBeNull()
      expect(getAqhiPlusColor(reading)).toBe(AQHI_NO_DATA_COLOR)
      expect(getAqhiPlusCategory(reading)).toBe('No Data')
    }
  })

  it('rolls levels up on the 30 / 60 / 100 category boundaries', () => {
    expect(getAqhiPlusCategory(29)).toBe('Low')
    expect(getAqhiPlusCategory(30)).toBe('Moderate')
    expect(getAqhiPlusCategory(59)).toBe('Moderate')
    expect(getAqhiPlusCategory(60)).toBe('High')
    expect(getAqhiPlusCategory(99)).toBe('High')
    expect(getAqhiPlusCategory(100)).toBe('Very High')
  })
})
