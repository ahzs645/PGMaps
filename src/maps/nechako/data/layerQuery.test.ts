import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import {
  checkedLayerQuery,
  displayLayerQuery,
  queryLayer,
  type LayerPredicate,
  type LayerQueryNode,
} from './layerQuery'
const data: FeatureCollection = {
  type: 'FeatureCollection',
  features: [0, 4, 8, null, '4', false].map((v, id) => ({
    type: 'Feature',
    id,
    properties: { value: v, name: id % 2 ? 'Station north' : 'Station south' },
    geometry: { type: 'Point', coordinates: [-123, 54] },
  })),
}
const run = (expression: LayerQueryNode) =>
  queryLayer(data, { schema: 'nechako-layer-query-v1', expression }).features.map((f) => f.id)
const rule = (
  operator: LayerPredicate['operator'],
  value?: LayerPredicate['value'],
  upper?: number,
): LayerPredicate => ({ kind: 'rule', field: 'value', operator, value, upper })
describe('local layer queries', () => {
  it('preserves typed numeric, string, boolean and missing values', () => {
    expect(run(rule('eq', 4))).toEqual([1])
    expect(run(rule('eq', '4'))).toEqual([4])
    expect(run(rule('eq', false))).toEqual([5])
    expect(run(rule('eq', 0))).toEqual([0])
    expect(run(rule('is-null'))).toEqual([3])
    expect(run(rule('ne', 4))).toEqual([0, 2])
  })
  it.each([
    ['lt', [0]],
    ['lte', [0, 1]],
    ['gt', [2]],
    ['gte', [1, 2]],
  ] as const)('evaluates %s without string coercion', (op, ids) => expect(run(rule(op, 4))).toEqual(ids))
  it('supports inclusive ranges and nested negation', () => {
    expect(run(rule('between', 0, 4))).toEqual([0, 1])
    expect(
      run({
        kind: 'group',
        match: 'all',
        children: [
          rule('is-not-null'),
          { kind: 'group', match: 'any', negate: true, children: [rule('eq', 0), rule('eq', 4)] },
        ],
      }),
    ).toEqual([2, 4, 5])
  })
  it('supports case-sensitive literal text safely', () => {
    expect(run({ kind: 'rule', field: 'name', operator: 'contains', value: 'north' })).toEqual([1, 3, 5])
    expect(run({ kind: 'rule', field: 'name', operator: 'starts', value: 'Station' })).toHaveLength(6)
    expect(run({ kind: 'rule', field: 'name', operator: 'contains', value: '.*' })).toEqual([])
  })
  it('retains exact feature IDs, coordinates and source properties without mutation', () => {
    const before = JSON.stringify(data)
    const result = queryLayer(data, { schema: 'nechako-layer-query-v1', expression: rule('eq', 4) })
    expect(result.features[0]).toBe(data.features[1])
    expect(JSON.stringify(data)).toBe(before)
    expect(displayLayerQuery(rule('between', 0, 4))).toContain('0 AND 4')
  })
  it('rejects invalid or empty queries and nonnumeric ranges', () => {
    expect(() => run(rule('between', 5, 2))).toThrow('range')
    expect(() => run(rule('gt', '4'))).toThrow('numeric')
    expect(() =>
      checkedLayerQuery({
        schema: 'nechako-layer-query-v1',
        expression: { kind: 'group', match: 'all', children: [] },
      }),
    ).toThrow('conditions')
    expect(() => run(rule('eq', Infinity))).toThrow('finite')
  })
})
