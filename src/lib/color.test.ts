import { describe, expect, it } from 'vitest'
import { hexToRgb, hexToRgba, hexToRgbaArray, parseHex, rgbToHex } from './color'

describe('parseHex', () => {
  it('expands 3-digit hex', () => {
    // The copies in openLitterMap and MonitorPopup sliced blindly and produced
    // NaN channels here.
    expect(parseHex('#0f8')).toEqual([0, 255, 136])
  })

  it('parses 6-digit hex with or without the hash', () => {
    expect(parseHex('#2563eb')).toEqual([37, 99, 235])
    expect(parseHex('2563eb')).toEqual([37, 99, 235])
  })

  it('returns null rather than NaN channels for junk', () => {
    expect(parseHex('')).toBeNull()
    expect(parseHex('#12')).toBeNull()
    expect(parseHex('#zzzzzz')).toBeNull()
    expect(parseHex('rgb(1,2,3)')).toBeNull()
  })
})

describe('hexToRgba', () => {
  it('builds a CSS rgba string', () => {
    expect(hexToRgba('#2563eb', 0.5)).toBe('rgba(37, 99, 235, 0.5)')
  })

  it('handles 3-digit hex', () => {
    expect(hexToRgba('#0f8', 1)).toBe('rgba(0, 255, 136, 1)')
  })
})

describe('hexToRgbaArray', () => {
  it('appends deck.gl 0-255 alpha', () => {
    expect(hexToRgbaArray('#2563eb', 217)).toEqual([37, 99, 235, 217])
  })

  it('is fully transparent for unparseable input, not black', () => {
    expect(hexToRgbaArray('nope', 217)).toEqual([0, 0, 0, 0])
  })
})

describe('hexToRgb / rgbToHex', () => {
  it('round-trips', () => {
    expect(rgbToHex(hexToRgb('#2563eb'))).toBe('#2563eb')
  })

  it('clamps and rounds out-of-range channels', () => {
    expect(rgbToHex([-5, 128.6, 300])).toBe('#0081ff')
  })
})
