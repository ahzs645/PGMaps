import { describe, expect, it } from 'vitest'
import {
  CATEGORY_PALETTE,
  OTHER_COLOR,
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
})
