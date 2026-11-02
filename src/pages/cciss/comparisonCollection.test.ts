import { describe, expect, it } from 'vitest'
import { addComparisonSnapshot, removeComparisonSnapshot, renameComparisonSnapshot } from './comparisonCollection'
import type { ComparisonSnapshot } from './comparison'

const example = (id = 'a'): ComparisonSnapshot => ({
  schema: 'cciss-comparison-snapshot-v1',
  id,
  label: 'First assessment',
  family: 'test',
  provenance: { source: 'Artificial collection test', synthetic: true },
  context: { site: 'Test 1', weights: [1, 1] },
  periods: {},
  metrics: [{ measure: 'score', entity: 'Test species', dimensions: {}, period: null, value: 2, unit: 'score' }],
})

describe('page-local comparison collection', () => {
  it('copies and freezes all saved settings and values before the live form changes', () => {
    const source = example()
    const saved = addComparisonSnapshot([], source)
    source.metrics[0].value = 9
    source.context.weights = [0, 1]
    expect(saved[0].metrics[0].value).toBe(2)
    expect(saved[0].context.weights).toEqual([1, 1])
    expect(Object.isFrozen(saved)).toBe(true)
    expect(Object.isFrozen(saved[0].metrics[0])).toBe(true)
  })

  it('rejects duplicate imports and full collections without changing existing entries', () => {
    const saved = addComparisonSnapshot([], example())
    expect(() => addComparisonSnapshot(saved, example())).toThrow('already saved')
    expect(() => addComparisonSnapshot(saved, example('b'), 1)).toThrow('at most 1')
    expect(saved).toHaveLength(1)
    expect(addComparisonSnapshot(removeComparisonSnapshot(saved, 'a'), example('b'), 1)[0].id).toBe('b')
  })

  it('renames only the chosen snapshot and validates the edited label', () => {
    const saved = addComparisonSnapshot(addComparisonSnapshot([], example()), example('b'))
    const renamed = renameComparisonSnapshot(saved, 'b', '  Other climate weights  ')
    expect(renamed[0]).toBe(saved[0])
    expect(renamed[1].label).toBe('Other climate weights')
    expect(saved[1].label).toBe('First assessment')
    expect(() => renameComparisonSnapshot(saved, 'b', '  ')).toThrow()
    expect(() => renameComparisonSnapshot(saved, 'missing', 'label')).toThrow('removed')
  })
})
