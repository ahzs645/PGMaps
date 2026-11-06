// Capability URLs provide unlisted read access. The R2 bucket itself stays private.
const COMMON = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-Match, If-None-Match, If-Modified-Since',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Range, Accept-Ranges, X-Content-SHA256',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}
const ALLOWED_FILE = /^(catalog\.json|(?:raw|tiles|previews|sheets|reviews)\/[a-zA-Z0-9._/-]+)$/
export function objectKey(path, upload = false) {
  const prefix = upload ? '/__upload/' : '/c/'
  if (!path.startsWith(prefix)) return null
  let decoded
  try {
    decoded = decodeURIComponent(path.slice(prefix.length))
  } catch {
    return null
  }
  const [id, ...segments] = decoded.split('/')
  if (!/^[A-Za-z0-9_-]{43}$/.test(id) || segments.some((s) => !s || s === '.' || s === '..')) return null
  const file = segments.join('/')
  return ALLOWED_FILE.test(file) ? `collections/${id}/${file}` : null
}
function reply(text, status, extra = {}) {
  return new Response(text, { status, headers: { ...COMMON, 'Cache-Control': 'no-store', ...extra } })
}
async function authorised(request, env) {
  if (!env.UPLOAD_TOKEN) return false
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer /, '') || ''
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all(
    [supplied, env.UPLOAD_TOKEN].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s))),
  )
  return crypto.subtle.timingSafeEqual(a, b)
}
export async function handle(request, env) {
  const url = new URL(request.url)
  if (url.pathname === '/health') return reply('Shared map delivery is running', 200)
  if (request.method === 'OPTIONS') return reply(null, 204, { 'Access-Control-Max-Age': '86400' })
  if (url.pathname.startsWith('/__upload/')) {
    if (!(await authorised(request, env))) return reply('Not found', 404)
    const key = objectKey(url.pathname, true)
    if (!key || request.method !== 'PUT') return reply('Invalid upload', 400)
    const length = Number(request.headers.get('Content-Length'))
    const checksum = request.headers.get('X-Content-SHA256') || ''
    if (!Number.isSafeInteger(length) || length < 1 || length > 95_000_000 || !/^[a-f0-9]{64}$/.test(checksum))
      return reply('A bounded length and SHA256 are required', 400)
    const object = await env.MAPS.put(key, request.body, {
      sha256: checksum,
      httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' },
      customMetadata: { sha256: checksum },
    })
    return Response.json(
      { uploaded: true, bytes: object.size, sha256: checksum, etag: object.httpEtag },
      { headers: { ...COMMON, 'Cache-Control': 'no-store' } },
    )
  }
  const key = objectKey(url.pathname)
  if (!key) return reply('Not found', 404)
  if (!['GET', 'HEAD'].includes(request.method))
    return reply('Method not allowed', 405, { Allow: 'GET, HEAD, OPTIONS' })
  const object =
    request.method === 'HEAD'
      ? await env.MAPS.head(key)
      : await env.MAPS.get(key, { range: request.headers, onlyIf: request.headers })
  if (!object) return reply('Not found', 404)
  const headers = new Headers(COMMON)
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('X-Content-SHA256', object.customMetadata?.sha256 || '')
  headers.set(
    'Cache-Control',
    key.endsWith('/catalog.json') ? 'public, max-age=300' : 'public, max-age=31536000, immutable',
  )
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(object.size))
    return new Response(null, { headers })
  }
  if (!('body' in object)) {
    return new Response(null, {
      status: request.headers.has('If-None-Match') || request.headers.has('If-Modified-Since') ? 304 : 412,
      headers,
    })
  }
  if (object.range) {
    const { offset, length } = object.range
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    headers.set('Content-Length', String(length))
  } else headers.set('Content-Length', String(object.size))
  return new Response(object.body, { status: object.range ? 206 : 200, headers })
}
export default {
  async fetch(request, env) {
    try {
      return await handle(request, env)
    } catch (error) {
      // Do not log URLs, capability paths, headers or upload tokens.
      console.error(JSON.stringify({ event: 'shared_map_request_failed', category: error?.name || 'Error' }))
      return reply('Map delivery failed; please retry', 503)
    }
  },
}
