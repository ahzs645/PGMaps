import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FetchError, fetchGzipText, fetchJson } from './fetchJson'

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses gzip-compressed JSON by inspecting the response bytes', async () => {
    const payload = { type: 'FeatureCollection', features: [{ id: 8886 }] }
    const compressed = new Uint8Array(gzipSync(JSON.stringify(payload)))
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(compressed, {
        headers: { 'content-type': 'application/gzip' },
      })
    )))

    await expect(fetchJson<typeof payload>('/named.geojson.gz')).resolves.toEqual(payload)
  })

  it('rejects an HTML SPA fallback returned with a successful status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response('<!doctype html><title>PGMaps</title>', {
        headers: { 'content-type': 'text/html' },
      })
    )))

    await expect(fetchJson('/missing.json')).rejects.toThrow(
      'file missing',
    )
  })

  it('parses a top-level JSON array served gzipped', async () => {
    // Guards the heuristic openLitterMap used to use, which only inflated when
    // the decoded text failed to start with '{'.
    const payload = [{ id: 1 }, { id: 2 }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(gzipSync(JSON.stringify(payload))))))

    await expect(fetchJson('/points.json.gz')).resolves.toEqual(payload)
  })

  it('reports the status on a failed response so callers can tolerate a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))

    await expect(fetchJson('/gone.json')).rejects.toMatchObject({
      name: 'FetchError',
      status: 404,
      url: '/gone.json',
    })
    await expect(fetchJson('/gone.json')).rejects.toBeInstanceOf(FetchError)
  })
})

describe('fetchGzipText', () => {
  it('inflates gzipped text without parsing it as JSON', async () => {
    const csv = 'postalcode,no2\nV2L1A1,12.5\n'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(gzipSync(csv)))))

    await expect(fetchGzipText('/canue.csv.gz')).resolves.toBe(csv)
  })

  it('passes through plain text when the host already decompressed it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('a,b\n1,2\n')))

    await expect(fetchGzipText('/plain.csv.gz')).resolves.toBe('a,b\n1,2\n')
  })
})

describe('MissingFileError', () => {
  it('reports the HTML SPA fallback as a 404 so optional callers see one shape of missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
    )))

    await expect(fetchJson('/absent.json')).rejects.toMatchObject({
      name: 'MissingFileError',
      status: 404,
    })
    await expect(fetchJson('/absent.json')).rejects.toBeInstanceOf(FetchError)
  })
})
