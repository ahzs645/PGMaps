import { describe, expect, it } from 'vitest'
import { parseCatalogue } from './catalogue'
import { EMPTY_FILTERS, matchesLibraryItem, organizationOptions } from './libraryOrganization'
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
