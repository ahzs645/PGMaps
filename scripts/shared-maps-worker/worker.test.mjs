import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, webcrypto, timingSafeEqual } from 'node:crypto'
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
    etag: 'version-one',
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
        assert.deepEqual(options.range, { offset: 10, length: 3 })
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
        assert.equal(options.onlyIf, undefined)
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

function catalogUpload(body, etag, extraHeaders = {}) {
  return new Request(base + `/__upload/${capability}/catalog.json`, {
    method: 'PUT',
    body,
    headers: {
      Authorization: 'Bearer test-owner-token',
      'Content-Length': String(Buffer.byteLength(body)),
      'Content-Type': 'application/json',
      'X-Content-SHA256': createHash('sha256').update(body).digest('hex'),
      ...(etag !== undefined ? { 'If-Match': etag } : {}),
      ...extraHeaders,
    },
  })
}

// R2 evaluates the precondition atomically at commit, and returns null on failure.
function catalogBucket() {
  let current = { etag: 'version-one', body: '{"maps":[]}' }
  let writes = 0
  const conditions = []
  return {
    conditions,
    get current() {
      return current
    },
    head: async () => assert.fail('Catalog updates must not HEAD then write unconditionally'),
    get: async () =>
      object({
        etag: current.etag,
        httpEtag: `"${current.etag}"`,
        body: current.body,
        size: Buffer.byteLength(current.body),
      }),
    put: async (key, body, options) => {
      assert.equal(key, `collections/${capability}/catalog.json`)
      const text = await new Response(body).text()
      assert.equal(options.sha256, createHash('sha256').update(text).digest('hex'))
      conditions.push(options.onlyIf)
      if (options.onlyIf && options.onlyIf.etagMatches !== current.etag) return null
      // No await between checking the current value and committing its replacement.
      writes++
      current = { etag: `version-${writes + 1}`, body: text }
      return object({ etag: current.etag, httpEtag: `"${current.etag}"`, size: Buffer.byteLength(text) })
    },
  }
}

test('Catalog CAS uses the live quoted ETag and rejects stale updates without changing the object', async () => {
  const bucket = catalogBucket()
  const env = { UPLOAD_TOKEN: 'test-owner-token', MAPS: bucket }
  const read = () => handle(new Request(base + `/c/${capability}/catalog.json`), env)
  const original = await read()
  const originalEtag = original.headers.get('ETag')
  assert.equal(originalEtag, '"version-one"')

  const first = await handle(catalogUpload('{"maps":["first"]}', originalEtag), env)
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('ETag'), '"version-2"')
  assert.equal((await first.json()).etag, '"version-2"')
  assert.deepEqual(bucket.conditions[0], { etagMatches: 'version-one' })

  const stale = await handle(catalogUpload('{"maps":["stale"]}', originalEtag), env)
  assert.equal(stale.status, 412)
  assert.equal(stale.headers.get('Cache-Control'), 'no-store')
  assert.equal(stale.headers.get('ETag'), null)
  assert.equal(stale.headers.get('X-Content-SHA256'), null)
  assert.equal(bucket.current.body, '{"maps":["first"]}')

  const latest = await read()
  assert.equal(latest.headers.get('ETag'), '"version-2"')
  assert.equal(await latest.text(), '{"maps":["first"]}')
  const rebased = await handle(catalogUpload('{"maps":["first","rebased"]}', latest.headers.get('ETag')), env)
  assert.equal(rebased.status, 200)
  assert.equal(rebased.headers.get('ETag'), '"version-3"')
  assert.deepEqual(bucket.conditions[2], { etagMatches: 'version-2' })
})

test('Two simultaneous catalog edits based on the same revision cannot both overwrite it', async () => {
  const bucket = catalogBucket()
  const env = { UPLOAD_TOKEN: 'test-owner-token', MAPS: bucket }
  const bodies = ['{"maps":["a"]}', '{"maps":["b"]}']
  const responses = await Promise.all(bodies.map((body) => handle(catalogUpload(body, '"version-one"'), env)))
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 412])
  assert.equal(bucket.current.body, bodies[responses.findIndex((response) => response.status === 200)])
  assert.deepEqual(bucket.conditions, [{ etagMatches: 'version-one' }, { etagMatches: 'version-one' }])
})

test('Unsupported catalog validators cannot silently fall back to an unconditional upload', async () => {
  let puts = 0
  const env = { UPLOAD_TOKEN: 'test-owner-token', MAPS: { put: async () => puts++ } }
  for (const etag of ['version-one', 'W/"version-one"', '*', '"one", "two"', '']) {
    const response = await handle(catalogUpload('{"maps":[]}', etag), env)
    assert.equal(response.status, 400)
  }
  assert.equal(puts, 0)
})

test('Conditional catalog uploads retain owner authentication and bounded checksummed streaming', async () => {
  let puts = 0
  const env = { UPLOAD_TOKEN: 'test-owner-token', MAPS: { put: async () => puts++ } }
  for (const [headers, status] of [
    [{ Authorization: 'Bearer wrong-owner' }, 404],
    [{ 'Content-Length': '95000001' }, 400],
    [{ 'Content-Length': '0' }, 400],
    [{ 'X-Content-SHA256': 'invalid' }, 400],
  ]) {
    assert.equal((await handle(catalogUpload('{"maps":[]}', '"version-one"', headers), env)).status, status)
  }
  assert.equal(puts, 0)
  const preflight = await handle(new Request(base + `/__upload/${capability}/catalog.json`, { method: 'OPTIONS' }), env)
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS')
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers').includes('Authorization'), false)
})
