import { describe, expect, it } from 'vitest'
import {
  attributeSortValue,
  columnStats,
  formatAttribute,
  humanizeKey,
  inferAttributes,
  isCategoryCandidate,
  isMeasureCandidate,
} from './featureAttributes'

const features = [
  {
    properties: {
      OBJECTID: 1,
      Name: 'Airport',
      InstallDate: Date.UTC(2004, 5, 3),
      Shape__Area: 25_000,
      Status: 'Active',
      __id: 'x',
    },
  },
  { properties: { OBJECTID: 2, Name: 'Assman', InstallDate: null, Shape__Area: 560.5, Status: 'Active' } },
  { properties: { OBJECTID: 3, Name: '', InstallDate: Date.UTC(1990, 0, 1), Shape__Area: 12, Status: 'Retired' } },
]

describe('humanizeKey', () => {
  it('splits camel case and underscores and drops ArcGIS suffixes', () => {
    expect(humanizeKey('InstallDate')).toBe('Install date')
    expect(humanizeKey('SubType_TEXT')).toBe('Sub type')
    expect(humanizeKey('Height_m')).toBe('Height m')
    expect(humanizeKey('Shape__Area')).toBe('Area (source)')
    expect(humanizeKey('GIS_ID')).toBe('GIS ID')
  })
})

describe('inferAttributes', () => {
  it('types columns from their values and hides internal keys', () => {
    const attributes = inferAttributes(features)
    const byKey = Object.fromEntries(attributes.map((attribute) => [attribute.key, attribute]))
    expect(byKey.__id).toBeUndefined()
    expect(byKey.Name.type).toBe('text')
    expect(byKey.InstallDate).toMatchObject({ type: 'datetime', format: { kind: 'date' } })
    expect(byKey.Shape__Area).toMatchObject({ type: 'numeric', format: { kind: 'area' }, system: true })
    expect(byKey.OBJECTID).toMatchObject({ type: 'numeric', system: true, format: { grouping: false } })
  })

  it('puts curated columns first, in their order, and bookkeeping columns last', () => {
    const keys = inferAttributes(features, [{ key: 'Status', label: 'State' }, { key: 'Name' }]).map(
      (attribute) => attribute.key,
    )
    expect(keys.slice(0, 2)).toEqual(['Status', 'Name'])
    expect(keys.at(-1)).toBe('Shape__Area')
    expect(keys.indexOf('OBJECTID')).toBeGreaterThan(keys.indexOf('InstallDate'))
  })

  it('does not call a numeric column a date just because its numbers are large', () => {
    const counts = inferAttributes([{ properties: { Population: 12_000_000_000 } }])
    expect(counts[0].type).toBe('numeric')
  })
})

describe('formatAttribute', () => {
  it('formats with the attribute format and leaves empty cells blank', () => {
    expect(formatAttribute(Date.UTC(2004, 5, 3), { type: 'datetime' })).toBe('2004-06-03')
    expect(formatAttribute(-2208988800000 * 2, { type: 'datetime' })).toBe('')
    expect(formatAttribute(25_000, { type: 'numeric', format: { kind: 'area' } })).toBe('2.5 ha')
    expect(formatAttribute(1234.5, { type: 'numeric', format: { kind: 'number', prefix: '$', digits: 0 } })).toBe(
      '$1,235',
    )
    expect(formatAttribute(604059, { type: 'numeric', format: { kind: 'number', digits: 0, grouping: false } })).toBe(
      '604059',
    )
    expect(formatAttribute('  ', { type: 'text' })).toBe('')
  })
})

describe('columnStats', () => {
  it('summarises numbers and counts values', () => {
    const stats = columnStats(features, { key: 'Shape__Area', type: 'numeric' })
    expect(stats).toMatchObject({ count: 3, missing: 0, distinct: 3, min: 12, max: 25_000, median: 560.5 })
    const status = columnStats(features, { key: 'Status', type: 'text' })
    expect(status.topValues).toEqual([
      { value: 'Active', count: 2 },
      { value: 'Retired', count: 1 },
    ])
    expect(columnStats(features, { key: 'Name', type: 'text' }).missing).toBe(1)
  })
})

describe('candidates and sorting', () => {
  it('offers low-cardinality text for categories and measures for ranges', () => {
    const attributes = inferAttributes(features)
    const status = attributes.find((attribute) => attribute.key === 'Status')!
    expect(isCategoryCandidate(status, columnStats(features, status))).toBe(true)
    expect(isMeasureCandidate(attributes.find((attribute) => attribute.key === 'OBJECTID')!)).toBe(false)
    expect(isMeasureCandidate(attributes.find((attribute) => attribute.key === 'Shape__Area')!)).toBe(true)
  })

  it('sorts text case-insensitively and empty cells as null', () => {
    expect(attributeSortValue(' Bee', { type: 'text' })).toBe('bee')
    expect(attributeSortValue('', { type: 'text' })).toBeNull()
    expect(attributeSortValue('12', { type: 'numeric' })).toBe(12)
  })
})
