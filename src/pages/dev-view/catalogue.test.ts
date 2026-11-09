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
    expect(result.items[0].georeferenceProject).toBeUndefined()
  })
  it.each([
    '',
    '   ',
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

describe('Published alignment project references', () => {
  const reference = {
    url: 'reviews/original-project.json',
    sha256: 'A'.repeat(64),
    sourceSha256: 'B'.repeat(64),
    nativeSha256: 'C'.repeat(64),
    label: 'Recovered controls',
    summary: 'Original pixel controls and reserved checks.',
  }
  function parse(value: unknown) {
    return parseCatalogue({ schema: 'raster-catalog-v1', items: [{ ...item, georeferenceProject: value }] }, origin)
  }
  it('preserves the immutable project and original/current identities, resolving relative URLs', () => {
    expect(parse(reference).items[0].georeferenceProject).toEqual({
      ...reference,
      url: 'https://maps.example.test/collection/reviews/original-project.json',
      sha256: 'a'.repeat(64),
      sourceSha256: 'b'.repeat(64),
      nativeSha256: 'c'.repeat(64),
    })
  })
  it.each([
    null,
    false,
    [],
    'reviews/project.json',
    {},
    { ...reference, sha256: '' },
    { ...reference, sourceSha256: null },
    { ...reference, nativeSha256: 'c'.repeat(63) },
  ])('rejects malformed published metadata instead of silently starting an empty project: %j', (value) =>
    expect(() => parse(value)).toThrow(/saved alignment project/),
  )
  it.each([
    '',
    'http://maps.example.test/project.json',
    'https://localhost/project.json',
    'https://user:secret@maps.example.test/project.json',
  ])('rejects an unsafe project URL: %s', (url) => {
    expect(() => parse({ ...reference, url })).toThrow(/public HTTPS/)
  })
  it.each([{ label: 12 }, { summary: false }, { label: 'x'.repeat(1001) }, { summary: 'x'.repeat(6001) }])(
    'rejects invalid optional project descriptions',
    (update) => expect(() => parse({ ...reference, ...update })).toThrow(/saved alignment project/),
  )
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

describe('Linked original images and rectified downloads', () => {
  const variant = {
    id: 'original-page-1',
    label: 'Original page 1',
    role: 'original-scan',
    image: { url: 'sheets/page1.jpg', width: 8192, height: 4096, sha256: 'A'.repeat(64), bytes: 1200000 },
    preview: { url: 'sheets/page1-preview.webp', width: 2048, height: 1024 },
    thumbnail: { url: 'previews/page1.webp', width: 512, height: 256 },
    pyramid: {
      format: 'pmtiles-image-v1',
      url: 'sheets/page1.pmtiles',
      width: 8192,
      height: 4096,
      tileSize: 512,
      maxZoom: 4,
      sha256: 'B'.repeat(64),
    },
    source: { title: 'Original document', url: 'https://example.test/archive.pdf', page: 1 },
  }
  function parse(update: Record<string, unknown> = {}) {
    return parseCatalogue(
      { schema: 'raster-catalog-v1', items: [{ ...item, imageVariants: [variant], ...update }] },
      origin,
    ).items[0]
  }
  it('keeps original pixel identity separate from rectified dimensions and sampling', () => {
    const parsed = parse({
      download: {
        url: 'raw/one.tif',
        role: 'rectified',
        label: 'Rectified map',
        width: 600,
        height: 700,
        crs: 'EPSG:3005',
        pixelSize: [2, 2],
        sourceVariantId: 'original-page-1',
        mimeType: 'image/tiff',
        sha256: 'C'.repeat(64),
      },
    })
    expect(parsed.imageVariants?.[0].image).toMatchObject({ width: 8192, height: 4096, sha256: 'a'.repeat(64) })
    expect(parsed.imageVariants?.[0].preview?.url).toBe(
      'https://maps.example.test/collection/sheets/page1-preview.webp',
    )
    expect(parsed.imageVariants?.[0].pyramid?.url).toBe('https://maps.example.test/collection/sheets/page1.pmtiles')
    expect(parsed.downloads[0]).toMatchObject({
      width: 600,
      height: 700,
      pixelSize: [2, 2],
      sourceVariantId: 'original-page-1',
      sha256: 'c'.repeat(64),
    })
    expect(parsed.bounds).toEqual(item.bounds)
  })
  it('preserves distinct source pages and explicit download references in a multi-panel selection', () => {
    const other = {
      ...variant,
      id: 'original-page-2',
      image: { ...variant.image, url: 'sheets/page2.jpg', sha256: 'D'.repeat(64) },
      source: { ...variant.source, page: 2 },
    }
    const parsed = parse({
      imageVariants: [variant, other],
      downloads: [
        { url: 'raw/one.tif', sourceVariantId: variant.id },
        { url: 'raw/two.tif', sourceVariantId: other.id },
      ],
    })
    expect(parsed.imageVariants?.map((v) => v.source?.page)).toEqual([1, 2])
    expect(parsed.downloads.map((d) => d.sourceVariantId)).toEqual(['original-page-1', 'original-page-2'])
    expect(() => parse({ download: { url: 'raw/one.tif', sourceVariantId: 'missing-source' } })).toThrow(/missing/)
  })
  it.each([
    { pyramid: { ...variant.pyramid, width: 4096 } },
    { pyramid: { ...variant.pyramid, maxZoom: 3 } },
    { pyramid: { ...variant.pyramid, tileSize: 0 } },
    { pyramid: { ...variant.pyramid, tileSize: 511 } },
    { pyramid: { ...variant.pyramid, format: 'geographic-tiles' } },
  ])('rejects a different or ambiguous source-image pyramid frame: %j', (update) => {
    expect(() => parse({ imageVariants: [{ ...variant, ...update }] })).toThrow(/pyramid/)
  })
  it.each([
    { image: { ...variant.image, url: 'javascript:alert(1)' } },
    { preview: { ...variant.preview, url: 'https://localhost/preview.png' } },
    { thumbnail: { ...variant.thumbnail, url: 'http://example.test/thumbnail.jpg' } },
    { pyramid: { ...variant.pyramid, url: 'https://user:secret@example.test/image.pmtiles' } },
    { source: { ...variant.source, url: 'https://127.0.0.1/original.pdf' } },
  ])('checks every nested image URL: %j', (update) => {
    expect(() => parse({ imageVariants: [{ ...variant, ...update }] })).toThrow()
  })
  it.each([
    { role: 'thumbnail' },
    { role: ['original-scan'] },
    { role: undefined },
    { image: { ...variant.image, width: 0 } },
    { image: { ...variant.image, height: 1.5 } },
    { image: { ...variant.image, width: 200001 } },
    { image: { ...variant.image, sha256: 'not-a-checksum' } },
    { image: { ...variant.image, bytes: -1 } },
    { thumbnail: { ...variant.thumbnail, width: 10000 } },
    { source: { ...variant.source, page: 0 } },
  ])('rejects invalid source metadata instead of claiming an original: %j', (update) => {
    expect(() => parse({ imageVariants: [{ ...variant, ...update }] })).toThrow()
  })
  it('requires distinct variant identities and bounds the list without silently dropping pages', () => {
    expect(() => parse({ imageVariants: [variant, variant] })).toThrow(/unique/)
    expect(() =>
      parse({ imageVariants: Array.from({ length: 65 }, (_, i) => ({ ...variant, id: String(i) })) }),
    ).toThrow(/64/)
  })
  it.each([
    { width: 0, height: 700 },
    { width: 600 },
    { pixelSize: [2, 0] },
    { pixelSize: [2, Infinity] },
    { pixelSize: [2] },
    { role: 'original-scan' },
    { sha256: 'thumbnail' },
  ])('rejects contradictory rectified download metadata: %j', (update) => {
    expect(() => parse({ download: { url: 'raw/one.tif', ...update } })).toThrow()
  })
  it('keeps legacy sheets usable without claiming their full original resolution', () => {
    const legacy = parseCatalogue(
      {
        schema: 'raster-catalog-v1',
        items: [{ ...item, fullSheets: [{ image: 'sheets/legacy.jpg', label: 'Sheet' }] }],
      },
      origin,
    ).items[0]
    expect(legacy.imageVariants).toEqual([])
    expect(legacy.fullSheets[0].width).toBeUndefined()
    const measured = parse({
      fullSheets: [{ image: 'sheets/legacy.jpg', width: 1800, height: 1000, sha256: 'D'.repeat(64) }],
    })
    expect(measured.fullSheets[0]).toMatchObject({ width: 1800, height: 1000, sha256: 'd'.repeat(64) })
  })
})
