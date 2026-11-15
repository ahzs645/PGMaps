import { describe, expect, it } from 'vitest'
import {
  AREA_PATTERNS,
  LINE_DASH_PRESETS,
  dashForWidth,
  parseDashPattern,
  parseSymbolStyle,
  styledPointSymbol,
  styledAreaSymbol,
  styledLineSymbol,
  symbolStyleIsEmpty,
  withSymbolStyle,
  type SymbolStyleDefaults,
} from './symbolStyle'
import { areaPatternId } from './mapSymbols'
import { symbolSwatchSvg } from './symbolSvg'

const DEFAULTS: SymbolStyleDefaults = {
  label: 'Property boundary',
  color: '#2563eb',
  pattern: 'solid',
  dash: 'dashed',
  width: 1.25,
  opacity: 0.13,
  casing: { color: '#ffffff', width: 1.75, opacity: 0.75 },
}

describe('symbol style', () => {
  it('draws the defaults until the person sets something', () => {
    const line = styledLineSymbol(DEFAULTS)
    expect(line.layers).toEqual([
      { color: '#ffffff', width: 3, opacity: 0.75 },
      { color: '#2563eb', width: 1.25, dash: [5, 3.125], join: 'round' },
    ])
    const area = styledAreaSymbol(DEFAULTS, {})
    expect(area).toMatchObject({ fill: '#2563eb', fillOpacity: 0.13, outline: [{ color: '#2563eb', width: 1.25 }] })
    expect(area.hatches).toBeUndefined()
    expect(areaPatternId(area)).toBeNull()
  })

  it('lays each set value over the default and leaves the rest', () => {
    const line = styledLineSymbol(DEFAULTS, { color: '#be185d', dash: 'solid', width: 3 })
    expect(line.layers.at(-1)).toEqual({ color: '#be185d', width: 3, join: 'round' })
    expect(line.layers[0].width).toBe(4.75)
    const area = styledAreaSymbol(DEFAULTS, { pattern: 'crosshatch', opacity: 0.4 })
    expect(area.fillOpacity).toBe(0.4)
    expect(area.hatches?.map(({ angleDeg }) => angleDeg)).toEqual([45, 135])
    expect(area.hatches?.[0].stroke.color).toBe('#2563eb')
  })

  it('gives every pattern its own tile and every line style its own swatch', () => {
    const tiles = AREA_PATTERNS.map((pattern) => areaPatternId(styledAreaSymbol(DEFAULTS, { pattern })))
    expect(tiles[0]).toBeNull()
    expect(new Set(tiles).size).toBe(AREA_PATTERNS.length)
    const swatches = LINE_DASH_PRESETS.map((dash) => symbolSwatchSvg(styledLineSymbol(DEFAULTS, { dash }), 28, 10))
    expect(new Set(swatches).size).toBe(LINE_DASH_PRESETS.length)
    expect(styledAreaSymbol(DEFAULTS, { pattern: 'dots' }).markerFill).toMatchObject({ icon: 'dot', stagger: true })
  })

  it('keeps a dash in step with the width', () => {
    expect(dashForWidth('solid', 2)).toBeUndefined()
    expect(dashForWidth('dotted', 2)).toEqual([2, 3])
    expect(dashForWidth('dash-dot', 1)).toEqual([5, 2, 1, 2])
  })

  it('changes one value at a time and forgets a value returned to the default', () => {
    const style = withSymbolStyle(withSymbolStyle(undefined, 'color', '#111827'), 'pattern', 'grid')
    expect(style).toEqual({ color: '#111827', pattern: 'grid' })
    const cleared = withSymbolStyle(withSymbolStyle(style, 'color', undefined), 'pattern', undefined)
    expect(cleared).toEqual({})
    expect(symbolStyleIsEmpty(cleared)).toBe(true)
    expect(symbolStyleIsEmpty(undefined)).toBe(true)
    expect(symbolStyleIsEmpty(style)).toBe(false)
  })

  it('reads a saved style and refuses what it does not know', () => {
    expect(parseSymbolStyle({ color: '#BE185D', pattern: 'dots', dash: 'long-dash', width: 2, opacity: 0.5 })).toEqual({
      color: '#be185d',
      pattern: 'dots',
      dash: 'long-dash',
      width: 2,
      opacity: 0.5,
    })
    expect(parseSymbolStyle({})).toEqual({})
    expect(() => parseSymbolStyle({ color: 'red' })).toThrow('#RRGGBB')
    expect(() => parseSymbolStyle({ pattern: 'zigzag' })).toThrow('unknown pattern')
    expect(() => parseSymbolStyle({ dash: 'wavy' })).toThrow('unknown line style')
    expect(() => parseSymbolStyle({ width: 40 })).toThrow('0.5 to 6')
    expect(() => parseSymbolStyle({ opacity: 2 })).toThrow('0 to 1')
    expect(() => parseSymbolStyle([])).toThrow('must be an object')
  })

  it('reads a typed dash and refuses one a line cannot draw', () => {
    expect(parseDashPattern('6 2 1 2')).toEqual([6, 2, 1, 2])
    expect(parseDashPattern(' 4, 2.5 ')).toEqual([4, 2.5])
    expect(parseDashPattern('4')).toBeNull()
    expect(parseDashPattern('4 0')).toBeNull()
    expect(parseDashPattern('4 two')).toBeNull()
    expect(parseDashPattern('')).toBeNull()
    const line = styledLineSymbol(DEFAULTS, { dash: 'custom', dashPattern: [6, 2, 1, 2], width: 2 })
    expect(line.layers.at(-1)?.dash).toEqual([12, 4, 2, 4])
    expect(dashForWidth('custom', 2)).toBeUndefined()
  })

  it('adds marks along a line, a pattern in its own colour, and an outline-only area', () => {
    const line = styledLineSymbol(DEFAULTS, { marker: 'arrow', color: '#be185d' })
    expect(line.markers).toEqual([{ icon: 'arrow', spacing: 30, size: 8, color: '#be185d' }])
    expect(styledLineSymbol(DEFAULTS).markers).toBeUndefined()
    const area = styledAreaSymbol(DEFAULTS, { noFill: true, pattern: 'grid', patternColor: '#111827', opacity: 0.6 })
    expect(area.fillOpacity).toBe(0)
    expect(area.hatches?.every(({ stroke }) => stroke.color === '#111827')).toBe(true)
    expect(area.outline[0].color).toBe('#2563eb')
  })

  it('draws a point as the chosen shape and size, or the ringed dot', () => {
    expect(styledPointSymbol(DEFAULTS)).toMatchObject({ icon: 'dot', size: 9, color: '#2563eb' })
    expect(styledPointSymbol(DEFAULTS, { icon: 'tree', size: 14, color: '#047857' })).toMatchObject({
      icon: 'tree',
      size: 14,
      color: '#047857',
    })
  })

  it('reads the newer values from a saved style and refuses what is out of range', () => {
    expect(
      parseSymbolStyle({
        dash: 'custom',
        dashPattern: [6, 2],
        widthM: 12,
        marker: 'tick',
        noFill: true,
        patternColor: '#ABCDEF',
        icon: 'gate',
        size: 12,
      }),
    ).toEqual({
      dash: 'custom',
      dashPattern: [6, 2],
      widthM: 12,
      marker: 'tick',
      noFill: true,
      patternColor: '#abcdef',
      icon: 'gate',
      size: 12,
    })
    expect(() => parseSymbolStyle({ dash: 'custom' })).toThrow('no dash')
    expect(() => parseSymbolStyle({ dashPattern: [1] })).toThrow('cannot draw')
    expect(() => parseSymbolStyle({ widthM: 0 })).toThrow('0.5 to 200')
    expect(() => parseSymbolStyle({ marker: 'star' })).toThrow('unknown line mark')
    expect(() => parseSymbolStyle({ noFill: false })).toThrow('true or absent')
    expect(() => parseSymbolStyle({ icon: 'spaceship' })).toThrow('unknown point shape')
    expect(() => parseSymbolStyle({ size: 99 })).toThrow('4 to 24')
  })
})
