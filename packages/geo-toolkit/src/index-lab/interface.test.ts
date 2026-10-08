import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IndexLab, IndexLabResults } from './IndexLab.js'
import { MetricLibraryRows, groupMetrics } from './MetricLibrary.js'
import type { IndexLabMetric } from './types.js'

const metrics: IndexLabMetric[] = [
  {
    key: 'trees',
    label: 'Tree coverage',
    shortLabel: 'Trees',
    description: 'Local shade coverage',
    category: 'nature',
    format: 'ratio',
    defaultWeight: 40,
  },
  {
    key: 'heat',
    label: 'Heat pressure',
    shortLabel: 'Heat',
    description: 'Local temperature',
    category: 'climate',
    format: 'index',
    defaultWeight: -30,
  },
]

describe('configurable Index Lab interface', () => {
  it('provides a complete renderable interface using an unrelated catalog and dataset', () => {
    const markup = renderToStaticMarkup(
      createElement(IndexLab, {
        metrics,
        records: [{ id: 'district', label: 'Fictional district', values: { trees: 0.7, heat: 2 } }],
        initialWeights: { trees: 40 },
      }),
    )
    expect(markup).toContain('aria-label="Index Lab"')
    expect(markup).toContain('Tree coverage')
    expect(markup).toContain('aria-label="Flip direction for Trees"')
    expect(markup).toContain('Normalization')
    expect(markup).toContain('Missing data')
    expect(markup).toContain('Fictional district')
    expect(markup).toContain('Coverage 100%')
  })

  it('shows locked metric reasons and retains consumer-defined category ordering/search', () => {
    const markup = renderToStaticMarkup(
      createElement(MetricLibraryRows, {
        metrics,
        weights: {},
        query: '',
        onAddMetric: () => {},
        categoryLabels: { climate: 'Climate' },
        categoryOrder: ['climate', 'nature'],
        getUnavailableReason: (metric) => (metric.key === 'heat' ? 'Choose a measured boundary.' : null),
      }),
    )
    expect(markup.indexOf('Climate')).toBeLessThan(markup.indexOf('Tree coverage'))
    expect(markup).toMatch(/data-score-builder-metric="heat"[^>]*disabled=""/)
    expect(markup).toContain('Choose a measured boundary.')
    expect(groupMetrics(metrics, ' SHADE ').map((group) => group.metrics.map((metric) => metric.key))).toEqual([
      ['trees'],
    ])
  })

  it('filters presentation without rewriting original ranks and exposes selected-state semantics', () => {
    const markup = renderToStaticMarkup(
      createElement(IndexLabResults, {
        results: [
          { id: 'first', label: 'First', score: 80, rank: 1, dataCoverageScore: 1 },
          { id: 'second', label: 'Second', score: 60, rank: 2, dataCoverageScore: 0.5 },
        ],
        query: 'Second',
        selectedId: 'second',
        onSelect: () => {},
      }),
    )
    expect(markup).toContain('#2 Second')
    expect(markup).not.toContain('#1 First')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('Coverage 50%')
  })
})
