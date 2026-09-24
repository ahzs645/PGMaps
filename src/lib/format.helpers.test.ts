import { describe, expect, it } from 'vitest'
import { formatBytes, formatMonthYear, formatSquareKm, MONTH_NAMES, MONTH_SHORT_NAMES } from './format'
import { colorForKey, readableTextColor } from './color'

describe('shared formatters', () => {
  it('scales bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024, { digits: 2 })).toBe('5.00 MB')
    expect(formatBytes(null)).toBe('Unknown size')
  })

  it('formats square kilometres and months in the pinned locale', () => {
    expect(formatSquareKm(12.34)).toBe('12.3 km²')
    expect(formatSquareKm(0)).toBe('')
    expect(MONTH_NAMES[0]).toBe('January')
    expect(MONTH_SHORT_NAMES[8]).toBe('Sep')
    expect(formatMonthYear(new Date(2026, 8, 1))).toBe('Sep 2026')
  })
})

describe('shared colour helpers', () => {
  it('picks legible text', () => {
    expect(readableTextColor('#ffe629')).toBe('#111827')
    expect(readableTextColor('#1e3a8a')).toBe('#ffffff')
    expect(readableTextColor('#ffffff', { dark: '#000000', weights: '709', threshold: 0.55 })).toBe('#000000')
  })

  it('keeps category colours stable', () => {
    expect(colorForKey('Plastic', { plastic: '#2563eb' }, ['#111111'])).toBe('#2563eb')
    const palette = ['#aaaaaa', '#bbbbbb', '#cccccc']
    expect(colorForKey('unlisted', {}, palette)).toBe(colorForKey('Unlisted', {}, palette))
  })
})
