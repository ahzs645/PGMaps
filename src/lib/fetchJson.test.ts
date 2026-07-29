import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from './fetchJson'

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
})
