import { PMTiles, TileType, type Source } from 'pmtiles'
import type { ImagePyramid } from './catalogue'

export type ImageViewport = { width: number; height: number }
export type ImageView = { x: number; y: number; scale: number }
export type ImageTile = {
  key: string
  z: number
  x: number
  y: number
  left: number
  top: number
  width: number
  height: number
}
export const MAX_VISIBLE_IMAGE_TILES = 64
const MAX_CACHED_IMAGE_TILES = 96

export function fitImageScale(width: number, height: number, viewport: ImageViewport): number {
  return Math.min(viewport.width / width, viewport.height / height)
}

export function clampImageView(view: ImageView, width: number, height: number, viewport: ImageViewport): ImageView {
  const fit = fitImageScale(width, height, viewport)
  const scale = Math.max(Math.min(1, fit / 2), Math.min(Math.max(4, fit), view.scale || fit))
  const halfX = viewport.width / (2 * scale)
  const halfY = viewport.height / (2 * scale)
  return {
    scale,
    x: halfX >= width / 2 ? width / 2 : Math.max(halfX, Math.min(width - halfX, view.x)),
    y: halfY >= height / 2 ? height / 2 : Math.max(halfY, Math.min(height - halfY, view.y)),
  }
}

/** Keep the same source pixel underneath the gesture's centre as it moves and scales. */
export function moveImageView(
  view: ImageView,
  viewport: ImageViewport,
  width: number,
  height: number,
  from: [number, number],
  to: [number, number],
  factor = 1,
): ImageView {
  const current = clampImageView(view, width, height, viewport)
  const scale = clampImageView({ ...current, scale: current.scale * factor }, width, height, viewport).scale
  return clampImageView(
    {
      x: current.x + (from[0] - viewport.width / 2) / current.scale - (to[0] - viewport.width / 2) / scale,
      y: current.y + (from[1] - viewport.height / 2) / current.scale - (to[1] - viewport.height / 2) / scale,
      scale,
    },
    width,
    height,
    viewport,
  )
}

/** Flat image pixels, never longitude/latitude. Lower levels preserve power-of-two source spacing. */
export function visibleImageTiles(
  pyramid: ImagePyramid,
  view: ImageView,
  viewport: ImageViewport,
  density = 1,
): ImageTile[] {
  if (
    ![view.x, view.y, view.scale, viewport.width, viewport.height].every(Number.isFinite) ||
    view.scale <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return []
  const left = Math.max(0, view.x - viewport.width / (2 * view.scale))
  const right = Math.min(pyramid.width, view.x + viewport.width / (2 * view.scale))
  const top = Math.max(0, view.y - viewport.height / (2 * view.scale))
  const bottom = Math.min(pyramid.height, view.y + viewport.height / (2 * view.scale))
  if (right <= left || bottom <= top) return []
  let z = Math.max(
    0,
    Math.min(pyramid.maxZoom, Math.ceil(pyramid.maxZoom + Math.log2(view.scale * Math.max(1, Math.min(2, density))))),
  )
  while (true) {
    const factor = 2 ** (pyramid.maxZoom - z)
    const span = pyramid.tileSize * factor
    const x0 = Math.floor(left / span),
      x1 = Math.ceil(right / span) - 1
    const y0 = Math.floor(top / span),
      y1 = Math.ceil(bottom / span) - 1
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_VISIBLE_IMAGE_TILES && z > 0) {
      z--
      continue
    }
    const tiles: ImageTile[] = []
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        tiles.push({
          key: `${z}/${x}/${y}`,
          z,
          x,
          y,
          left: x * span,
          top: y * span,
          width: Math.min(pyramid.tileSize, Math.ceil(pyramid.width / factor) - x * pyramid.tileSize) * factor,
          height: Math.min(pyramid.tileSize, Math.ceil(pyramid.height / factor) - y * pyramid.tileSize) * factor,
        })
    return tiles
  }
}

export function validateImagePyramidMetadata(metadata: unknown, pyramid: ImagePyramid, sourceSha256?: string): void {
  if (!metadata || typeof metadata !== 'object') throw Error('The source detail archive has no image identity.')
  const value = metadata as Record<string, unknown>
  if (
    value.kind !== 'pgmaps-image-pyramid-v1' ||
    ['width', 'height', 'tileSize', 'maxZoom'].some((key) => value[key] !== pyramid[key as keyof ImagePyramid]) ||
    (sourceSha256 && value.sourceSha256 !== sourceSha256)
  )
    throw Error('The detail archive does not match this source image. Open its original file instead.')
}

/** Every request omits credentials/referrers and is bounded, including the archive's metadata reads. */
function imageArchiveSource(pyramid: ImagePyramid, lifetime: AbortSignal): Source {
  return {
    getKey: () => pyramid.url,
    async getBytes(offset, length, signal, etag) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length < 1 ||
        length > 8 * 1024 * 1024
      )
        throw Error('The source detail archive requested an unsupported range.')
      const abort = new AbortController()
      const stop = () => abort.abort()
      lifetime.addEventListener('abort', stop, { once: true })
      signal?.addEventListener('abort', stop, { once: true })
      if (lifetime.aborted || signal?.aborted) abort.abort()
      try {
        const response = await fetch(pyramid.url, {
          headers: { Range: `bytes=${offset}-${offset + length - 1}` },
          signal: abort.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        })
        const declared = Number(response.headers.get('Content-Length'))
        if (
          !response.ok ||
          (response.status !== 206 && (response.status !== 200 || offset !== 0 || !declared || declared > length)) ||
          declared > length
        )
          throw Error('Source detail needs a server that supports bounded range requests.')
        const reportedHash = response.headers.get('X-Content-SHA256')
        if (pyramid.sha256 && reportedHash && reportedHash !== pyramid.sha256)
          throw Error('The source detail file has changed. Reload the collection.')
        const currentEtag = response.headers.get('ETag') || undefined
        if (etag && currentEtag && etag !== currentEtag) throw Error('The source detail file changed while loading.')
        const reader = response.body?.getReader()
        if (!reader) throw Error('Source detail bytes were unavailable.')
        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.length
          if (size > length) {
            abort.abort()
            throw Error('The source detail response exceeded its requested range.')
          }
          chunks.push(next.value)
        }
        const bytes = new Uint8Array(size)
        let position = 0
        for (const chunk of chunks) {
          bytes.set(chunk, position)
          position += chunk.length
        }
        return {
          data: bytes.buffer,
          etag: currentEtag,
          cacheControl: response.headers.get('Cache-Control') || undefined,
        }
      } finally {
        lifetime.removeEventListener('abort', stop)
        signal?.removeEventListener('abort', stop)
      }
    },
  }
}

export type ImageTileReader = {
  read: (tile: ImageTile, signal: AbortSignal) => Promise<string>
  retain: (keys: Set<string>) => void
  dispose: () => void
}

export function createImageTileReader(pyramid: ImagePyramid, sourceSha256?: string): ImageTileReader {
  const lifetime = new AbortController()
  const archive = new PMTiles(imageArchiveSource(pyramid, lifetime.signal))
  const urls = new Map<string, string>()
  let retained = new Set<string>()
  let ready: Promise<void> | undefined
  return {
    retain(keys) {
      retained = keys
    },
    async read(tile, signal) {
      signal.throwIfAborted()
      lifetime.signal.throwIfAborted()
      ready ??= Promise.all([archive.getHeader(), archive.getMetadata()]).then(([header, metadata]) => {
        if (
          ![TileType.Png, TileType.Jpeg, TileType.Webp, TileType.Avif].includes(header.tileType) ||
          header.minZoom !== 0 ||
          header.maxZoom !== pyramid.maxZoom
        )
          throw Error('This archive is not the expected source-image pyramid.')
        validateImagePyramidMetadata(metadata, pyramid, sourceSha256)
      })
      await ready
      signal.throwIfAborted()
      lifetime.signal.throwIfAborted()
      const cached = urls.get(tile.key)
      if (cached) {
        urls.delete(tile.key)
        urls.set(tile.key, cached)
        return cached
      }
      const response = await archive.getZxy(tile.z, tile.x, tile.y, signal)
      signal.throwIfAborted()
      lifetime.signal.throwIfAborted()
      if (!response) throw Error('Some source-image detail tiles are missing.')
      const concurrent = urls.get(tile.key)
      if (concurrent) return concurrent
      const url = URL.createObjectURL(new Blob([response.data]))
      urls.set(tile.key, url)
      for (const [key, value] of urls) {
        if (urls.size <= MAX_CACHED_IMAGE_TILES) break
        if (!retained.has(key)) {
          URL.revokeObjectURL(value)
          urls.delete(key)
        }
      }
      return url
    },
    dispose() {
      lifetime.abort()
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    },
  }
}
