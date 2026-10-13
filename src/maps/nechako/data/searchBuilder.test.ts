import { describe, it, expect } from 'vitest'
import { compileSearchClause, checkedSavedSearches, filterLocalSearch, type SavedSearch } from './searchBuilder'
import { parsePortalSearch } from '@/lib/nechakoPortal'
describe('visual and saved portal searches', () => {
  it('compiles nested rules through the original parser without changing precedence', () => {
    const expr = compileSearchClause({
      kind: 'group',
      operator: 'AND',
      clauses: [
        { kind: 'field', field: 'Submission ID', operator: '>=', value: '100', valueType: 'number' },
        {
          kind: 'group',
          operator: 'OR',
          clauses: [
            { kind: 'term', text: 'salmon' },
            { kind: 'term', text: 'water' },
          ],
        },
      ],
    })
    expect(parsePortalSearch(expr)).toMatchObject({
      token: 'AND',
      left: { token: 'comparator', value: '>=' },
      right: { token: 'OR' },
    })
  })
  it('rejects ambiguous quotes, invalid fields and numeric values before sending', () => {
    expect(() => compileSearchClause({ kind: 'term', text: 'a" OR b' })).toThrow()
    expect(() =>
      compileSearchClause({ kind: 'field', field: 'x}', operator: '=', value: '1', valueType: 'number' }),
    ).toThrow()
    expect(() =>
      compileSearchClause({ kind: 'field', field: 'x', operator: '=', value: 'NaN', valueType: 'number' }),
    ).toThrow()
  })
  it('preserves saved geographic selection and rejects malformed/bounded collections', () => {
    const query: SavedSearch = {
      id: 'q1',
      name: 'Water polygon',
      expression: 'water',
      contexts: ['Title'],
      area: { mode: 'polygon', bounds: [-126, 52, -122, 56], vectorId: 'watershed' },
    }
    expect(checkedSavedSearches([query])).toEqual([query])
    expect(() => checkedSavedSearches([query, query])).toThrow()
    expect(() => checkedSavedSearches([{ ...query, area: { ...query.area, bounds: [190, 0, 200, 90] } }])).toThrow()
    expect(() => checkedSavedSearches([{ ...query, expression: '{bad}' }])).toThrow()
  })
  it('matches all ordinary words across the public source title and metadata', () => {
    const rows = [
      { title: 'Climate and Health', searchText: 'project 14' },
      { title: 'Climate workshop', searchText: '2023' },
    ]
    expect(filterLocalSearch(rows, 'health climate')).toEqual([rows[0]])
    expect(filterLocalSearch(rows, '')).toEqual(rows)
  })
})
