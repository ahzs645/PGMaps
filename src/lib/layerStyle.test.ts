import { describe, expect, it } from 'vitest'
import {
  CATEGORY_PALETTE,
  OTHER_COLOR,
  RAMPS,
  RAMP_OPTIONS,
  buildCategoriesStyle,
  buildRangeStyle,
  buildSizeStyle,
  classLabels,
  colorExpression,
  legendEntries,
  primaryColor,
  sizeExpression,
  styleFilter,
} from './layerStyle'

describe('categories style', () => {
  const style = buildCategoriesStyle('Status', {
    distinct: 3,
    topValues: [
      { value: 'Active', count: 5 },
      { value: 'Retired', count: 2 },
    ],
  })

  it('colours each listed value and sends the rest to Other', () => {
    expect(colorExpression(style)).toEqual([
      'match',
      ['to-string', ['get', 'Status']],
      'Active',
      CATEGORY_PALETTE[0],
      'Retired',
      CATEGORY_PALETTE[1],
      OTHER_COLOR,
    ])
    expect(legendEntries(style).map((entry) => entry.label)).toEqual(['Active', 'Retired', 'Other'])
    expect(legendEntries(style)[0].value).toBe('Active')
    expect(styleFilter(style)).toBeNull()
  })

  it('drops Other when every value has a colour', () => {
    const all = buildCategoriesStyle('Status', { distinct: 1, topValues: [{ value: 'Active', count: 5 }] })
    expect(all.type === 'categories' && all.otherColor).toBeNull()
    expect(styleFilter(all)).toEqual(['in', ['to-string', ['get', 'Status']], ['literal', ['Active']]])
  })
})

describe('range style', () => {
  it('classes values into colour steps the expression and legend agree on', () => {
    const style = buildRangeStyle('Size', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {
      classes: 2,
      classification: 'equal-interval',
    })!
    expect(style.type).toBe('range')
    if (style.type !== 'range') return
    expect(style.breaks).toEqual([5.5])
    expect(style.colors).toHaveLength(2)
    expect(colorExpression(style)).toEqual([
      'case',
      ['==', ['typeof', ['get', 'Size']], 'number'],
      ['step', ['to-number', ['get', 'Size']], style.colors[0], 5.5, style.colors[1]],
      expect.any(String),
    ])
    expect(legendEntries(style, (value) => value.toFixed(1)).map((entry) => entry.label)).toEqual(['< 5.5', '≥ 5.5'])
    expect(primaryColor(style)).toBe(style.colors[1])
  })

  it('returns null without numbers', () => {
    expect(buildRangeStyle('Size', [])).toBeNull()
  })
})

describe('size style', () => {
  it('maps classes onto growing radii and leaves colour alone', () => {
    const style = buildSizeStyle('Count', [1, 10, 100, 1000], 'point', {
      classes: 2,
      classification: 'quantile',
      color: '#123456',
    })!
    expect(colorExpression(style)).toBe('#123456')
    if (style.type !== 'size') throw new Error('expected size style')
    expect(style.sizes[0]).toBeLessThan(style.sizes[1])
    expect(sizeExpression(style, 5)).toEqual([
      'case',
      ['==', ['typeof', ['get', 'Count']], 'number'],
      ['step', ['to-number', ['get', 'Count']], style.sizes[0], style.breaks[0], style.sizes[1]],
      style.sizes[0],
    ])
    expect(sizeExpression({ type: 'simple', color: '#fff' }, 5)).toBe(5)
  })
})

describe('classLabels', () => {
  it('reads like Felt for one, two and three classes', () => {
    const format = (value: number) => String(value)
    expect(classLabels([], 2, 2, format)).toEqual(['2'])
    expect(classLabels([], 1, 9, format)).toEqual(['1 to 9'])
    expect(classLabels([10, 50], 0, 99, format)).toEqual(['< 10', '10 to 50', '≥ 50'])
  })

  it('offers the toolkit ramps beside the original five, whose saved colours do not change', () => {
    expect(RAMPS.heat.colors).toEqual(['#ffffb2', '#fd8d3c', '#bd0026'])
    expect(RAMPS.viridis.colors[0]).toBe('#fde725')
    expect(RAMP_OPTIONS.map(({ id }) => id)).toEqual(expect.arrayContaining(['plasma', 'rdbu', 'spectral', 'turbo']))
    expect(RAMP_OPTIONS.filter(({ id }) => id === 'ylorrd' || id === 'viridis')).toHaveLength(1)
    // An id from a newer build draws as the default ramp rather than failing.
    const unknown = buildRangeStyle('n', [1, 2, 3, 4], { ramp: 'not-a-ramp', classes: 2 })
    const fallback = buildRangeStyle('n', [1, 2, 3, 4], { ramp: 'heat', classes: 2 })
    expect(unknown && 'colors' in unknown && unknown.colors).toEqual(
      fallback && 'colors' in fallback && fallback.colors,
    )
  })

  it('reverses a ramp and records it only when it is reversed', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8]
    const forward = buildRangeStyle('n', values, { classes: 4, ramp: 'rdbu' })
    const reversed = buildRangeStyle('n', values, { classes: 4, ramp: 'rdbu', reverse: true })
    if (forward?.type !== 'range' || reversed?.type !== 'range') throw Error('expected range styles')
    expect(reversed.colors).toEqual([...forward.colors].reverse())
    expect(reversed.reverse).toBe(true)
    expect(forward).not.toHaveProperty('reverse')
    expect(reversed.breaks).toEqual(forward.breaks)
  })

  it('classes by natural breaks, standard deviation and a geometric ratio', () => {
    const values = [1, 2, 2, 3, 20, 21, 22, 23, 90, 91, 95]
    const natural = buildRangeStyle('n', values, { classes: 3, classification: 'natural-breaks' })
    if (natural?.type !== 'range') throw Error('expected a range style')
    expect(natural.breaks).toEqual([20, 90])
    expect(natural.colors).toHaveLength(3)
    const deviation = buildRangeStyle('n', values, { classes: 4, classification: 'standard-deviation' })
    expect(deviation?.type === 'range' && deviation.colors.length).toBe(
      deviation?.type === 'range' ? deviation.breaks.length + 1 : -1,
    )
    const geometric = buildRangeStyle('n', [1, 10, 100, 1000], { classes: 3, classification: 'geometric-interval' })
    expect(geometric?.type === 'range' && geometric.breaks.map(Math.round)).toEqual([10, 100])
    // The step expression takes whatever classes came back.
    expect(JSON.stringify(colorExpression(natural))).toContain(`,20,"${natural.colors[1]}",90,"${natural.colors[2]}"`)
  })

  it('draws a ramp of the person’s own from the colours kept with the style', () => {
    const values = [1, 2, 3, 4, 5, 6]
    const own = buildRangeStyle('n', values, { classes: 3, ramp: 'custom:Dusk', rampColors: ['#000000', '#ffffff'] })
    if (own?.type !== 'range') throw Error('expected a range style')
    expect(own.ramp).toBe('custom:Dusk')
    expect(own.rampColors).toEqual(['#000000', '#ffffff'])
    expect(own.colors[0]).toBe('#000000')
    expect(own.colors[2]).toBe('#ffffff')
    // Without its colours, an id this browser does not know falls back to the default ramp.
    const lost = buildRangeStyle('n', values, { classes: 3, ramp: 'custom:Dusk' })
    expect(lost).not.toHaveProperty('rampColors')
    expect(lost?.type === 'range' && lost.colors).toEqual(
      (buildRangeStyle('n', values, { classes: 3 }) as { colors: string[] }).colors,
    )
  })
})
