import { withBase } from './dataUrl'

type DecompressionStreamConstructor = new (
  format: 'gzip',
) => TransformStream<Uint8Array, Uint8Array>

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/**
 * Inflate gzip bytes to text. Detection is by magic bytes rather than filename
 * or `content-encoding`, because hosts differ on whether they decompress `.gz`
 * for us — Vite's dev server does, most static hosts do not.
 */
async function inflateGzip(bytes: Uint8Array): Promise<string> {
  const DecompressionStreamCtor = (
    globalThis as typeof globalThis & {
      DecompressionStream?: DecompressionStreamConstructor
    }
  ).DecompressionStream
  if (!DecompressionStreamCtor) {
    throw new Error('This browser cannot decompress gzip map data')
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStreamCtor('gzip'))
  return new Response(stream).text()
}

/**
 * Thrown when the response itself failed. Carries the status so callers that
 * tolerate a missing file can check `status === 404` instead of matching on the
 * message text.
 */
export class FetchError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`Failed to fetch ${url}: ${status}`)
    this.name = 'FetchError'
  }
}

/**
 * A static host answering for a file it does not have: 200 OK with the SPA's
 * HTML. Reported as a 404 so "tolerate a missing dataset" call sites need only
 * one check to cover both shapes of missing.
 */
export class MissingFileError extends FetchError {
  constructor(url: string, contentType: string) {
    super(url, 404)
    this.name = 'MissingFileError'
    this.message = `Failed to fetch ${url}: file missing (got ${contentType || 'HTML'})`
  }
}

/**
 * Fetch raw bytes, with the response's content-type for downstream diagnostics.
 * Root-relative paths are resolved against the deploy base, so the bare
 * '/data/...' literals used throughout the app survive a sub-path deploy.
 */
export async function fetchBytes(
  url: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(withBase(url), signal ? { signal } : undefined)
  if (!response.ok) {
    throw new FetchError(url, response.status)
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
  }
}

/**
 * Fetch text, transparently inflating gzip and rejecting the HTML SPA fallback
 * that static hosts serve for missing files (which would otherwise surface as a
 * confusing parse error further downstream).
 */
export async function fetchGzipText(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const { bytes, contentType } = await fetchBytes(url, signal)
  const text = isGzip(bytes)
    ? await inflateGzip(bytes)
    : new TextDecoder().decode(bytes)

  if (text.trimStart().startsWith('<')) {
    throw new MissingFileError(url, contentType)
  }

  return text
}

export async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const text = await fetchGzipText(url, signal)

  try {
    return JSON.parse(text) as T
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(`Failed to parse JSON from ${url}${detail}`)
  }
}
