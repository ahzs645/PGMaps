import { expect, it } from 'vitest'
import { filterResearchRecords, summarizeResearchDecades } from './filterResearchRecords'
import type { ResearchRecord } from './researchRecordsTypes'
const records = [
  { id: 1, title: 'Salmon', author: 'Alex', tags: ['water'], decade: 2020, resourceTypeMain: 'report' },
  { id: 2, title: 'Forests', author: 'Sam', tags: ['trees'], decade: 2020, resourceTypeMain: 'article' },
  { id: 3, title: 'Salmon history', author: 'Alex', tags: [], decade: 1990, resourceTypeMain: 'article' },
] as ResearchRecord[]
it('uses configured search fields and category predicates across playback buckets', () => {
  const matching = filterResearchRecords(records, ' salmon ', new Set(['article']), ['title'])
  expect(matching.map((record) => record.id)).toEqual([3])
  expect(filterResearchRecords(records, 'water', new Set(), ['title'])).toHaveLength(0)
  expect(filterResearchRecords(records, 'water', new Set(), ['tags'])).toHaveLength(1)
  expect(summarizeResearchDecades(matching, [{ decade: 2020, total: 999, byResourceType: { report: 999 } }])).toEqual([
    { decade: 1990, total: 1, byResourceType: { article: 1 } },
    { decade: 2020, total: 0, byResourceType: {} },
  ])
})
it('keeps a zero-result timeline empty and applies the active decade to sidebar records', () => {
  const matching = filterResearchRecords(records, 'no-match', new Set(), ['title'])
  expect(summarizeResearchDecades(matching, [{ decade: 2020, total: 99, byResourceType: {} }])[0].total).toBe(0)
  expect(filterResearchRecords(records, 'salmon', new Set(), ['title'], 2020).map((record) => record.id)).toEqual([1])
})
