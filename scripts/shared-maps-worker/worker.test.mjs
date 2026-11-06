import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto, timingSafeEqual } from 'node:crypto'
import { handle, objectKey } from './worker.mjs'

const subtle = webcrypto.subtle
subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b))
Object.defineProperty(globalThis, 'crypto', { value: { subtle }, configurable: true })
const capability = 'x'.repeat(43),
  path = `/c/${capability}/tiles/map.pmtiles`,
  base = 'https://maps.example.test'
function object(extra = {}) {
  return {
    size: 100,
    httpEtag: '"version-one"',
    customMetadata: { sha256: 'a'.repeat(64) },
    writeHttpMetadata: (h) => h.set('Content-Type', 'application/vnd.pmtiles'),
    body: new Uint8Array([1, 2, 3]),
    ...extra,
  }
}
test('No listing, traversal, incomplete capability or unscoped object access', () => {
  for (const p of [
    '/',
    '/catalog.json',
    '/c/short/catalog.json',
    `/c/${capability}/../catalog.json`,
    `/c/${capability}/%2e%2e/catalog.json`,
    `/c/${capability}/unknown/file`,
  ])
    assert.equal(objectKey(p), null)
  assert.equal(objectKey(`/c/${capability}/catalog.json`), `collections/${capability}/catalog.json`)
})
test('Range response supplies exact byte framing and browser-readable headers', async () => {
  const request = new Request(base + path, { headers: { Range: 'bytes=10-12' } })
  const response = await handle(request, {
    MAPS: {
      get: async (key, options) => {
        assert.equal(key, `collections/${capability}/tiles/map.pmtiles`)
        assert.equal(options.range.get('range'), 'bytes=10-12')
        return object({ range: { offset: 10, length: 3 } })
      },
    },
  })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('Content-Range'), 'bytes 10-12/100')
  assert.equal(response.headers.get('Content-Length'), '3')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal(response.headers.get('ETag'), '"version-one"')
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]))
})
test('Conditional request does not turn a failed precondition into a body', async () => {
  const value = object()
  delete value.body
  const env = { MAPS: { get: async () => value } }
  assert.equal(
    (await handle(new Request(base + path, { headers: { 'If-None-Match': '"version-one"' } }), env)).status,
    304,
  )
  assert.equal((await handle(new Request(base + path, { headers: { 'If-Match': '"other"' } }), env)).status, 412)
})
test('Unknown objects are not cached, and HEAD never downloads the body', async () => {
  const env = { MAPS: { get: async () => null, head: async () => object() } }
  const missing = await handle(new Request(base + path), env)
  assert.equal(missing.status, 404)
  assert.equal(missing.headers.get('Cache-Control'), 'no-store')
  const head = await handle(new Request(base + path, { method: 'HEAD' }), env)
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.equal(head.headers.get('Content-Length'), '100')
})
test('Uploading requires an owner token, bounded length and checksum; the body stays a stream', async () => {
  const upload = base + `/__upload/${capability}/raw/test.tif`
  let puts = 0
  const env = {
    UPLOAD_TOKEN: 'test-owner-token',
    MAPS: {
      put: async (_key, body, options) => {
        puts++
        assert.ok(body instanceof ReadableStream)
        assert.equal(options.sha256, 'a'.repeat(64))
        return { size: 3, httpEtag: '"uploaded"' }
      },
    },
  }
  assert.equal((await handle(new Request(upload, { method: 'PUT', body: 'abc' }), env)).status, 404)
  assert.equal(
    (
      await handle(
        new Request(upload, {
          method: 'PUT',
          body: 'abc',
          headers: {
            Authorization: 'Bearer test-owner-token',
            'Content-Length': '3',
            'X-Content-SHA256': 'a'.repeat(64),
          },
        }),
        env,
      )
    ).status,
    200,
  )
  assert.equal(puts, 1)
  assert.equal(
    (
      await handle(
        new Request(upload, {
          method: 'PUT',
          body: 'abc',
          headers: {
            Authorization: 'Bearer test-owner-token',
            'Content-Length': '999999999',
            'X-Content-SHA256': 'a'.repeat(64),
          },
        }),
        env,
      )
    ).status,
    400,
  )
})
