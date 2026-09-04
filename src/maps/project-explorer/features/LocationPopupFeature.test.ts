import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LocationPopupFeature } from './LocationPopupFeature'

const feature = { type: 'location-popup' as const, maxCategories: 5 }
const resourceTypeColors = { journalArticle: '#3b82f6', thesis: '#ec4899', other: '#94a3b8' }
const resourceTypeLabels = { journalArticle: 'Journal Articles', thesis: 'Theses' }

function renderPopup(resourceTypes: Record<string, number>) {
  return renderToStaticMarkup(
    createElement(LocationPopupFeature, {
      feature,
      name: 'School District 91',
      count: Object.values(resourceTypes).reduce((sum, count) => sum + count, 0),
      resourceTypes,
      resourceTypeColors,
      resourceTypeLabels,
      recordPlural: 'publications',
    }),
  )
}

describe('LocationPopupFeature', () => {
  it('uses compact labelled swatches when category counts are tied', () => {
    const markup = renderPopup({ thesis: 1, journalArticle: 1 })

    expect(markup).toContain('Journal Articles')
    expect(markup).toContain('Theses')
    expect(markup).toContain('rounded-sm')
    expect(markup).not.toContain('bg-muted')
  })

  it('uses comparison bars when category counts differ', () => {
    const markup = renderPopup({ thesis: 1, journalArticle: 4 })

    expect(markup).toContain('bg-muted')
    expect(markup).toContain('width:25%')
  })
})
