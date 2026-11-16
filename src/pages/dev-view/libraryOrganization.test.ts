import { describe, expect, it } from 'vitest'
import { parseCatalogue } from './catalogue'
import {
  EMPTY_FILTERS,
  activeFilters,
  filterChoices,
  knownDate,
  libraryColumns,
  matchesLibraryItem,
  organizationOptions,
  resultCount,
} from './libraryOrganization'
const base = 'https://example.test/catalog.json'
function catalogue() {
  return parseCatalogue(
    {
      schema: 'raster-catalog-v1',
      items: [
        {
          id: 'one',
          title: 'Repeated title',
          bounds: [-126, 53, -124, 55],
          assets: [{ url: 'a.pmtiles', bounds: [-126, 53, -124, 55] }],
          confidence: 'supported_provisional',
          organization: {
            subjects: ['survey'],
            region: 'north',
            era: '1900s',
            sourceGroupId: 'doc-a',
            sourceGroupTitle: 'Repeated source',
            pageLabel: 'Page 2',
          },
        },
        {
          id: 'two',
          title: 'Repeated title',
          bounds: [-126, 53, -124, 55],
          assets: [{ url: 'b.pmtiles', bounds: [-126, 53, -124, 55] }],
          confidence: 'experimental',
          organization: {
            subjects: ['water'],
            region: 'south',
            era: 'unknown',
            sourceGroupId: 'doc-b',
            sourceGroupTitle: 'Repeated source',
            variantLabel: 'Inset',
          },
        },
      ],
      unplacedSources: [
        {
          id: 'source',
          title: 'Source photograph',
          sources: [],
          organization: { subjects: ['survey'], region: 'north', era: 'unknown' },
        },
      ],
      facets: { subjects: [{ id: 'survey', label: 'Survey plans' }] },
    },
    base,
  )
}
describe('Library organization filters', () => {
  it('combines filters without collapsing repeated titles or inventing a map date', () => {
    const c = catalogue()
    expect(c.items.filter((i) => matchesLibraryItem(i, '', EMPTY_FILTERS))).toHaveLength(2)
    expect(
      c.items
        .filter((i) =>
          matchesLibraryItem(i, 'page 2', {
            ...EMPTY_FILTERS,
            subject: 'survey',
            region: 'north',
            era: '1900s',
            sourceGroup: 'doc-a',
            confidence: 'provisional',
          }),
        )
        .map((i) => i.id),
    ).toEqual(['one'])
    expect(matchesLibraryItem(c.items[1], '', { ...EMPTY_FILTERS, era: '1900s' })).toBe(false)
  })
  it('ignores a retained placement filter for image-only source records', () => {
    expect(
      matchesLibraryItem(catalogue().unplacedSources[0], 'photograph', {
        ...EMPTY_FILTERS,
        subject: 'survey',
        confidence: 'experimental',
      }),
    ).toBe(true)
  })
  it('uses supplied category names and keeps distinct source IDs with the same title', () => {
    const c = catalogue(),
      options = organizationOptions([...c.items, ...c.unplacedSources], c.facets)
    expect(options.subjects.find((f) => f.id === 'survey')?.label).toBe('Survey plans')
    expect(options.sources.map((s) => s.id)).toEqual(['doc-a', 'doc-b'])
    expect(options.sources[0].label).not.toBe(options.sources[1].label)
  })
})

describe('library presentation helpers', () => {
  const options = {
    subjects: [{ id: 'survey', label: 'Surveys & cadastral plans' }],
    regions: [{ id: 'north', label: 'Northern BC' }],
    eras: [],
    sources: [{ id: 'doc-1', label: 'Old Survey Maps.pdf' }],
  }
  it('names each active filter by the label of its value', () => {
    const values = { ...EMPTY_FILTERS, subject: 'survey', sourceGroup: 'doc-1', confidence: 'experimental' }
    expect(activeFilters(values, options, false)).toEqual([
      { key: 'subject', title: 'Subject', label: 'Surveys & cadastral plans' },
      { key: 'sourceGroup', title: 'Source document', label: 'Old Survey Maps.pdf' },
      { key: 'confidence', title: 'Placement', label: 'Experimental' },
    ])
  })
  it('leaves placement out for source images and falls back to a readable id', () => {
    const values = { ...EMPTY_FILTERS, era: 'before-1900', confidence: 'experimental' }
    expect(activeFilters(values, options, true)).toEqual([{ key: 'era', title: 'Map date', label: 'before 1900' }])
    expect(filterChoices('confidence', options, true)).toEqual([])
  })
  it('fits two cards across a phone and more as the page widens', () => {
    expect(libraryColumns(0)).toBe(1)
    expect(libraryColumns(288)).toBe(2)
    expect(libraryColumns(358)).toBe(2)
    expect(libraryColumns(599)).toBe(2)
    expect(libraryColumns(720)).toBe(2)
    expect(libraryColumns(976)).toBe(3)
    expect(libraryColumns(1232)).toBe(4)
    expect(libraryColumns(1872)).toBe(6)
  })
  it('keeps a real date and drops a placeholder', () => {
    expect(knownDate('March 1908')).toBe('March 1908')
    expect(knownDate('Date unknown')).toBe('')
    expect(knownDate(undefined)).toBe('')
  })
  it('counts what the scope lists', () => {
    expect(resultCount(902, 902, 'all')).toBe('902 maps')
    expect(resultCount(126, 902, 'all')).toBe('126 of 902 maps')
    expect(resultCount(1, 1, 'featured')).toBe('1 selection')
    expect(resultCount(1250, 1250, 'sources')).toBe('1,250 source images')
  })
})
