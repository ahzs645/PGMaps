import { describe, expect, it } from 'vitest'
import { createExpression, latest, type StylePropertySpecification, type Color } from '@maplibre/maplibre-gl-style-spec'
import type { FeatureCollection } from 'geojson'
import { importWorkspace, EMPTY_WORKSPACE } from './workspace'
import { mapImageLegends } from './mapImage'
import {
  checkedVectorStyle,
  checkedStyleComparison,
  DEFAULT_STYLE_SYMBOL,
  matchesStyleComparison,
  styleComparisonExpression,
  stylePaint,
  resolveStyleSymbol,
  interpolateStyleColor,
  numericFieldRange,
  vectorStyleFor,
  vectorStyleLegend,
  type StyleComparison,
  type VectorStyle,
} from './vectorRules'
import { exportStyleSld, xmlText } from './sldStyle'

const base = { ...DEFAULT_STYLE_SYMBOL, fillColor: '#888888', strokeColor: '#111111' }
const rules: VectorStyle = {
  schema: 'nechako-vector-style-v1',
  geometry: 'any',
  mode: 'rules',
  base,
  rules: [
    {
      id: 'zero',
      name: 'Numeric zero',
      enabled: true,
      condition: { property: 'value', operator: 'eq', value: 0 },
      symbol: { ...base, fillColor: '#ff0000' },
    },
    {
      id: 'range',
      name: 'Inclusive range',
      enabled: true,
      condition: { property: 'value', operator: 'between', value: 0, upper: 10 },
      symbol: { ...base, fillColor: '#00ff00', strokeOpacity: 0 },
    },
    {
      id: 'text',
      name: 'Text zero',
      enabled: true,
      condition: { property: 'value', operator: 'eq', value: '0' },
      symbol: { ...base, fillColor: '#0000ff' },
    },
    {
      id: 'null',
      name: 'Null',
      enabled: true,
      condition: { property: 'value', operator: 'eq', value: null },
      symbol: { ...base, fillColor: '#ffff00' },
    },
  ],
}
const gradient: VectorStyle = {
  schema: 'nechako-vector-style-v1',
  geometry: 'point',
  mode: 'gradient',
  base,
  property: 'value',
  channel: 'both',
  stops: [
    { value: -10, color: '#ff0000' },
    { value: 0, color: '#0000ff' },
    { value: 10, color: '#00ff00' },
  ],
}
const data: FeatureCollection = {
  type: 'FeatureCollection',
  features: [0, '0', false, null, -5, 10].map((value, index) => ({
    type: 'Feature',
    id: 'source-' + index,
    properties: { value },
    geometry: { type: 'Point', coordinates: [-124 + index / 100, 54] },
  })),
}
function evaluate(expression: unknown, properties: Record<string, unknown>, spec?: StylePropertySpecification) {
  const parsed = createExpression(expression, spec)
  if (parsed.result === 'error') throw new Error(parsed.value.map((item) => item.message).join('; '))
  return parsed.value.evaluateWithoutErrorHandling({ zoom: 5 }, { type: 'Point', properties })
}
describe('typed vector rules and gradients', () => {
  it('matches every comparison with MapLibre without coercing zero, numeric text, false or null', () => {
    const conditions: StyleComparison[] = [
      { property: 'value', operator: 'eq', value: 0 },
      { property: 'value', operator: 'ne', value: 0 },
      { property: 'value', operator: 'lt', value: 0 },
      { property: 'value', operator: 'lte', value: 0 },
      { property: 'value', operator: 'gt', value: 0 },
      { property: 'value', operator: 'gte', value: 0 },
      { property: 'value', operator: 'between', value: -1, upper: 1 },
      { property: 'value', operator: 'eq', value: '0' },
      { property: 'value', operator: 'eq', value: false },
      { property: 'value', operator: 'eq', value: null },
      { property: 'value', operator: 'ne', value: null },
      { property: 'value', operator: 'between', value: 'A', upper: 'Z' },
    ]
    for (const condition of conditions)
      for (const value of [-2, -1, 0, 1, 2, '0', 'A', 'Z', 'a', false, true, null, undefined]) {
        const properties = value === undefined ? {} : { value }
        expect(evaluate(styleComparisonExpression(condition), properties)).toBe(
          matchesStyleComparison(condition, properties),
        )
      }
    expect(matchesStyleComparison(conditions[0], { value: '0' })).toBe(false)
    expect(matchesStyleComparison(conditions[1], { value: false })).toBe(false)
    expect(matchesStyleComparison(conditions[6], { value: 0 })).toBe(true)
  })
  it('uses the first enabled rule and exactly the same symbols in the renderer and legend', () => {
    const style = checkedVectorStyle(rules)
    expect(resolveStyleSymbol(style, { value: 0 }).fillColor).toBe('#ff0000')
    expect(resolveStyleSymbol(style, { value: 5 }).fillColor).toBe('#00ff00')
    expect(resolveStyleSymbol(style, { value: '0' }).fillColor).toBe('#0000ff')
    expect(resolveStyleSymbol(style, { value: false }).fillColor).toBe('#888888')
    const paint = stylePaint(style)
    for (const value of [0, 5, '0', false, null]) {
      const actual = evaluate(
        paint.fillColor,
        { value },
        latest.paint_fill['fill-color'] as StylePropertySpecification,
      ) as Color
      const expected = resolveStyleSymbol(style, { value }).fillColor
      expect(
        '#' +
          actual.rgb
            .slice(0, 3)
            .map((v) =>
              Math.round(v * 255)
                .toString(16)
                .padStart(2, '0'),
            )
            .join(''),
      ).toBe(expected)
    }
    const disabled = {
      ...rules,
      rules: rules.mode === 'rules' ? rules.rules.map((rule, index) => ({ ...rule, enabled: index !== 0 })) : [],
    }
    expect(resolveStyleSymbol(disabled, { value: 0 }).fillColor).toBe('#00ff00')
    const legend = vectorStyleLegend(style)
    expect(legend.rows.map((row) => row.symbol)).toEqual(
      style.mode === 'rules' ? [...style.rules.map((rule) => rule.symbol), style.base] : [],
    )
    expect(legend.rows[0].label).toContain('1. Numeric zero')
  })
  it('interpolates numeric stops, clamps extremes and preserves nonnumeric fallback', () => {
    expect(interpolateStyleColor(gradient.mode === 'gradient' ? gradient.stops : [], -5)).toBe('#800080')
    const paint = stylePaint(gradient)
    for (const value of [-100, -10, -5, 0, 10, 100, '0', null, false]) {
      const actual = evaluate(
        paint.fillColor,
        { value },
        latest.paint_fill['fill-color'] as StylePropertySpecification,
      ) as Color
      const expected = resolveStyleSymbol(gradient, { value }).fillColor
      const colors = actual.rgb.slice(0, 3).map((component) => Math.round(component * 255))
      expect(colors).toEqual([1, 3, 5].map((offset) => parseInt(expected.slice(offset, offset + 2), 16)))
    }
    expect(numericFieldRange(data, 'value')).toEqual([-5, 10])
    expect(() =>
      numericFieldRange(
        { ...data, features: data.features.filter((f) => typeof f.properties?.value !== 'number') },
        'value',
      ),
    ).toThrow('no finite numeric')
  })
  it('validates ordering, finite values, typed ranges, zero opacity and unsupported style members', () => {
    expect(checkedStyleComparison({ property: 'v', operator: 'between', value: -1, upper: 0 })).toEqual({
      property: 'v',
      operator: 'between',
      value: -1,
      upper: 0,
    })
    expect(() => checkedStyleComparison({ property: 'v', operator: 'between', value: 0, upper: '1' })).toThrow('same')
    expect(() => checkedStyleComparison({ property: 'v', operator: 'gt', value: false })).toThrow('number or text')
    expect(() => checkedStyleComparison({ property: 'v', operator: 'eq', value: NaN })).toThrow('finite')
    expect(() =>
      checkedVectorStyle({
        ...gradient,
        stops: [
          { value: 0, color: '#000000' },
          { value: 0, color: '#ffffff' },
        ],
      }),
    ).toThrow('strictly increasing')
    expect(() => checkedVectorStyle({ ...gradient, vendor: 'ignored' })).toThrow('Unsupported style fields')
    expect(
      checkedVectorStyle({
        ...gradient,
        base: { ...base, fillOpacity: 0, strokeOpacity: 0, strokeWidth: 0, pointRadius: 0 },
      }).base.fillOpacity,
    ).toBe(0)
  })
  it('preserves the entire source layer and style in workspace JSON and image legend', () => {
    const source = {
      id: 'unchanged',
      name: 'Source',
      data,
      color: '#888888',
      visible: true,
      style: gradient,
      styleSource: { format: 'sld' as const, original: '<retained />', diagnostics: ['original retained'] },
    }
    const workspace = importWorkspace({ ...EMPTY_WORKSPACE, vectors: [source] })
    const restored = importWorkspace(JSON.parse(JSON.stringify(workspace)))
    expect(restored.vectors[0].data).toEqual(data)
    expect(restored.vectors[0].style).toEqual(gradient)
    expect(restored.vectors[0].styleSource).toEqual(source.styleSource)
    expect(restored.camera).toEqual(EMPTY_WORKSPACE.camera)
    expect(mapImageLegends(restored)[0].gradient).toEqual(vectorStyleLegend(gradient).gradient)
    expect(mapImageLegends(restored)[0].rows[0].symbol).toEqual(base)
    expect(
      vectorStyleFor({
        color: '#123456',
        categories: {
          property: 'v',
          fallback: '#123456',
          rules: [
            { value: 0, color: '#ff0000' },
            { value: '0', color: '#00ff00' },
          ],
        },
      }).mode,
    ).toBe('rules')
  })
})
describe('portable SLD serialization', () => {
  it('escapes names/field values and encodes exclusive preceding-rule filters plus fallback', () => {
    const style = checkedVectorStyle(rules)
    const xml = exportStyleSld(style, 'A < B & "quoted"', 'point')
    expect(xml).toContain('version="1.0.0"')
    expect(xml).toContain('A &lt; B &amp; &quot;quoted&quot;')
    expect(xml).toContain('<ogc:And>')
    expect(xml).toContain('<ogc:Not>')
    expect(xml).toContain('<sld:ElseFilter>')
    expect(xml).toContain('<sld:WellKnownName>circle')
    expect(xml).toContain('PGMapsStyleV1:')
    expect(xmlText('<script>&')).toBe('&lt;script&gt;&amp;')
    expect(xmlText('\r\n')).toBe('&#13;\n')
    expect(() => xmlText('\0')).toThrow('control')
  })
  it('exports a real SE numeric interpolation rather than silently flattening a gradient', () => {
    const xml = exportStyleSld(gradient, 'Temperature', 'point')
    expect(xml).toContain('version="1.1.0"')
    expect(xml).toContain('<se:Interpolate fallbackValue="#888888" mode="linear" method="color">')
    expect(xml).toContain('<se:Data>-10</se:Data>')
    expect(xml).toContain('<ogc:PropertyName>value</ogc:PropertyName>')
    expect(xml.match(/<se:InterpolationPoint>/g)).toHaveLength(6)
    const spacedField = checkedVectorStyle({ ...gradient, property: 'Water temperature' })
    expect(spacedField.mode === 'gradient' && spacedField.property).toBe('Water temperature')
    expect(() => exportStyleSld(spacedField, 'Temperature', 'point')).toThrow('direct XML property')
  })
})
