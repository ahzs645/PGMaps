import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkedPortalAttributes,
  loadPortalSources,
  parsePortalSearch,
  portalRead,
  wmsTiles,
  wmsUrl,
} from './nechakoPortal'

afterEach(() => vi.unstubAllGlobals())

describe('portal transport', () => {
  it('rejects the real HTTP-200 success:true registration failure envelope', () => {
    expect(() =>
      checkedPortalAttributes({
        success: true,
        status: 'failure',
        error: 'Website is not registered',
        loggedIn: false,
      }),
    ).toThrow('Website is not registered')
    expect(checkedPortalAttributes({ success: true, status: 'success', attributes: [] })).toEqual([])
    expect(() => checkedPortalAttributes({ success: true })).toThrow('no attributes')
  })

  it('uses anonymous safelisted form transport without AJAX or JSON headers', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: 'success', attributes: [{ context: 'Submission Title' }] })),
      )
    vi.stubGlobal('fetch', fetch)
    await portalRead('rest/portal/getSearchContext.php', { types: '["metadata","content"]' })
    const [url, options] = fetch.mock.calls[0]
    expect(String(url)).toBe('https://nechakowatershed-portal.ca/rest/portal/getSearchContext.php')
    expect(options.credentials).toBe('omit')
    expect(options.method).toBe('POST')
    expect(options.headers).toBeUndefined()
    expect(options.body).toBeInstanceOf(URLSearchParams)
    expect(options.body.get('types')).toBe('["metadata","content"]')
  })

  it('deduplicates live services and excludes mixed-content basemaps', async () => {
    const source = { name: 'Watershed', type: 'capabilities', resource: 'https://nechakowatershed-portal.ca/wms?map=a' }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status: 'success', attributes: [] })))
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                status: 'success',
                attributes: [
                  source,
                  { ...source, name: 'Duplicate' },
                  { name: 'Old OSM', type: 'xyz', resource: 'http://tile.example.com' },
                ],
              }),
            ),
        ),
    )
    expect(await loadPortalSources()).toEqual([source])
  })

  it('preserves native QGIS map paths while replacing case variants of WMS parameters', () => {
    const resource =
      'https://nechakowatershed-portal.ca/cgi-bin/qgis_mapserv.fcgi/?map=/var/www/a.qgs&service=WMS&request=GetCapabilities&VERSION=1.3.0'
    const url = new URL(wmsUrl(resource, { REQUEST: 'GetFeatureInfo', LAYERS: 'Named group & layer' }))
    expect(url.searchParams.get('map')).toBe('/var/www/a.qgs')
    expect(url.searchParams.getAll('REQUEST')).toEqual(['GetFeatureInfo'])
    expect(url.searchParams.has('request')).toBe(false)
    expect(url.searchParams.get('VERSION')).toBe('1.1.1')
    expect(url.searchParams.get('LAYERS')).toBe('Named group & layer')
    expect(wmsTiles(resource, 'Layer')).toContain('BBOX={bbox-epsg-3857}')
  })
})

describe('portal expression contract', () => {
  it('retains explicit AND precedence, parentheses and implicit OR', () => {
    expect(parsePortalSearch('salmon trout AND river')).toEqual({
      token: 'OR',
      left: { token: 'keyword', value: 'salmon' },
      right: { token: 'AND', left: { token: 'keyword', value: 'trout' }, right: { token: 'keyword', value: 'river' } },
    })
    expect(parsePortalSearch('(salmon OR trout) AND river').token).toBe('AND')
  })
  it('encodes native column comparisons and quoted literals', () => {
    expect(parsePortalSearch('{Submission ID} >= 100')).toEqual({
      token: 'comparator',
      value: '>=',
      left: { token: 'column', value: 'Submission ID' },
      right: { token: 'number', value: '100' },
    })
    expect(parsePortalSearch('{Submission Status} != "Draft"').value).toBe('!=')
    expect(parsePortalSearch('"O\'Brien Creek"').value).toBe("O''Brien Creek")
    expect(parsePortalSearch('{time} >= "2020-01-01"').right?.value).toBe('2020-01-01 00:00:00.000')
  })
  it.each([
    '',
    'salmon AND',
    '(salmon OR trout',
    'salmon)',
    '{Submission ID}',
    '1 >= 2',
    '{A} = {B}',
    '!salmon',
    '"unclosed',
  ])('rejects incomplete or unsupported expression %s', (input) => {
    expect(() => parsePortalSearch(input)).toThrow()
  })
})
