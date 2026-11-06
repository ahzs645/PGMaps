import { describe, expect, it, vi, afterEach } from 'vitest'
import { httpsURL, loadCatalogue, parseCatalogue } from './catalogue'

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
