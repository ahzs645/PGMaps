import { describe, expect, it, vi, afterEach } from 'vitest'
import { httpsURL, loadCatalogue, parseCatalogue, shareLink } from './catalogue'

const origin = 'https://maps.example.test/collection/catalog.json'
const item = {
  id: 'one',
  title: 'A map',
  bounds: [-126, 53, -124, 55],
  assets: [{ url: 'tiles/one.pmtiles', bounds: [-126, 53, -124, 55], minZoom: 3, maxZoom: 14 }],
  sources: [{ title: 'Source', url: 'https://drive.google.com/file/d/example/view' }],
  download: { url: 'raw/one.tif' },
}
afterEach(() => vi.unstubAllGlobals())
describe('Shared map catalogue boundary', () => {
  it('resolves relative data URLs and keeps featured stories out of representation counts', () => {
    const result = parseCatalogue(
      {
        schema: 'raster-catalog-v1',
        title: 'Collection',
        items: [item, { ...item, id: 'two' }],
        featured: [{ ...item, id: 'story' }],
      },
      origin,
    )
    expect(result.representationCount).toBe(2)
    expect(result.featured).toHaveLength(1)
    expect(result.items[0].assets[0].url).toBe('https://maps.example.test/collection/tiles/one.pmtiles')
    expect(result.items[0].downloads[0].url).toContain('/collection/raw/one.tif')
  })
  it.each([
    'javascript:alert(1)',
    'http://example.test/map.pmtiles',
    'https://user:password@example.test/a',
    'https://localhost/a',
    'https://127.0.0.1/a',
    'https://[::1]/a',
  ])('rejects unsafe or local URLs: %s', (url) => expect(() => httpsURL(url)).toThrow())
  it('checks nested source and preview URLs, not just the catalogue URL', () => {
    expect(() =>
      parseCatalogue({ schema: 'raster-catalog-v1', items: [{ ...item, thumbnail: 'javascript:alert(1)' }] }, origin),
    ).toThrow()
    expect(() =>
      parseCatalogue(
        { schema: 'raster-catalog-v1', items: [{ ...item, sources: [{ url: 'http://localhost/a' }] }] },
        origin,
      ),
    ).toThrow()
  })
  it('rejects duplicate ids and invalid geography', () => {
    expect(() => parseCatalogue({ schema: 'raster-catalog-v1', items: [item, item] }, origin)).toThrow(/unique/)
    expect(() =>
      parseCatalogue({ schema: 'raster-catalog-v1', items: [{ ...item, bounds: [-125, 55, -124, 53] }] }, origin),
    ).toThrow(/bounds/)
  })
  it('refuses oversized responses before parsing or buffering their body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, url: origin, headers: new Headers({ 'Content-Length': '7000000' }) }),
    )
    await expect(loadCatalogue(origin, new AbortController().signal)).rejects.toThrow(/6 MB/)
  })
  it('preserves XYZ template placeholders', () =>
    expect(httpsURL('https://tiles.example.test/{z}/{x}/{y}.webp')).toContain('/{z}/{x}/{y}.webp'))
})

describe('Library and map share links', () => {
  it('opens in the library by default and only requests a map explicitly', () => {
    vi.stubGlobal('window', { location: { origin: 'https://maps.example.test' } })
    const library = new URL(shareLink(origin))
    expect(new URLSearchParams(library.hash.slice(1)).has('view')).toBe(false)
    const map = new URLSearchParams(new URL(shareLink(origin, 'one', 'map')).hash.slice(1))
    expect(map.get('map')).toBe('one')
    expect(map.get('view')).toBe('map')
    expect(map.get('catalog')).toBe(origin)
  })
})

describe('Optional organization and source-image records', () => {
  it('keeps categories separate from placement confidence and preserves source-record counts', () => {
    const result = parseCatalogue(
      {
        schema: 'raster-catalog-v1',
        items: [
          {
            ...item,
            confidence: 'experimental',
            organization: {
              subjects: ['survey', 'survey'],
              region: 'north',
              era: 'unknown',
              sourceGroupId: 'source-a',
              sourceGroupSize: 2,
              classificationConfidence: 'high',
              regionConfidence: 'low',
              regionEvidence: 'Inferred only from extent',
              dateKind: 'report-date',
              dateEvidence: 'Dated report cover',
            },
          },
        ],
        facets: {
          subjects: [{ id: 'survey', label: 'Survey plans' }],
          regions: [{ id: 'north', label: 'Northern region' }],
          eras: [{ id: 'unknown', label: 'Map date unknown' }],
        },
        coverage: { sourceDocuments: 1, sourceRecords: 3, unplacedSources: 2 },
        unplacedSources: [
          {
            id: 'source-b',
            title: 'Unplaced page',
            image: 'sheets/page.png',
            thumbnail: 'previews/page.webp',
            imageScope: 'One reviewed page, not a complete report',
            sources: [{ title: 'Source report', url: 'https://example.test/report.pdf' }],
            organization: { subjects: ['survey'] },
          },
          { id: 'archive-c', title: 'Archive lead', statusNote: 'No direct image recovered', sources: [] },
        ],
      },
      origin,
    )
    expect(result.representationCount).toBe(1)
    expect(result.unplacedSources).toHaveLength(2)
    expect(result.unplacedSources[0].image).toBe('https://maps.example.test/collection/sheets/page.png')
    expect(result.unplacedSources[1].image).toBeUndefined()
    expect(result.items[0].confidence).toBe('experimental')
    expect(result.items[0].organization?.classificationConfidence).toBe('high')
    expect(result.items[0].organization?.subjects).toEqual(['survey'])
    expect(result.items[0].organization?.regionConfidence).toBe('low')
    expect(result.facets.subjects[0].label).toBe('Survey plans')
    expect(result.coverage?.sourceDocuments).toBe(1)
  })
  it('rejects unsafe source image URLs and duplicate source records', () => {
    const source = { id: 'source', title: 'Source', image: 'javascript:alert(1)', sources: [] }
    expect(() =>
      parseCatalogue({ schema: 'raster-catalog-v1', items: [item], unplacedSources: [source] }, origin),
    ).toThrow()
    expect(() =>
      parseCatalogue(
        {
          schema: 'raster-catalog-v1',
          items: [item],
          unplacedSources: [
            { ...source, image: undefined },
            { ...source, image: undefined },
          ],
        },
        origin,
      ),
    ).toThrow(/unique/)
  })
})
