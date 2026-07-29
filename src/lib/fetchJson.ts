type DecompressionStreamConstructor = new (
  format: 'gzip',
) => TransformStream<Uint8Array, Uint8Array>

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const bytes = new Uint8Array(await response.arrayBuffer())
  let text: string

  if (isGzip(bytes)) {
    const DecompressionStreamCtor = (
      globalThis as typeof globalThis & {
        DecompressionStream?: DecompressionStreamConstructor
      }
    ).DecompressionStream
    if (!DecompressionStreamCtor) {
      throw new Error('This browser cannot decompress gzip map data')
    }
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStreamCtor('gzip'))
    text = await new Response(stream).text()
  } else {
    text = new TextDecoder().decode(bytes)
  }

  if (text.trimStart().startsWith('<')) {
    throw new Error(
      `Failed to fetch ${url}: file missing (got ${contentType || 'HTML'})`,
    )
  }

  try {
    return JSON.parse(text) as T
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(`Failed to parse JSON from ${url}${detail}`)
  }
}
