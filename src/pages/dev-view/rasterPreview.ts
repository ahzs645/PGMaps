import { PMTiles } from 'pmtiles'
import type { Bounds, RasterRecord } from './catalogue'

const MAX_LATITUDE = 85.05112878
function y(latitude: number) {
  const radians = (Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI) / 180
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2
}
export function projectedBounds([west, south, east, north]: Bounds) {
  return { left: (west + 180) / 360, right: (east + 180) / 360, top: y(north), bottom: y(south) }
}
export function previewTiles(bounds: Bounds, zoom: number) {
  zoom = Math.floor(zoom)
  const box = projectedBounds(bounds)
  const n = 2 ** zoom
  const left = Math.max(0, Math.floor(box.left * n))
  const right = Math.min(n - 1, Math.ceil(box.right * n) - 1)
  const top = Math.max(0, Math.floor(box.top * n))
  const bottom = Math.min(n - 1, Math.ceil(box.bottom * n) - 1)
  if ((right - left + 1) * (bottom - top + 1) > 100)
    throw Error('This image is too large to preview. Open it on the map to explore its detail.')
  const tiles = []
  for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) tiles.push({ x, y, z: zoom })
  return tiles
}

/** An image of the recorded raster placement, without a basemap or map instance. */
export async function rasterPreview(item: RasterRecord, signal: AbortSignal): Promise<Blob> {
  const box = projectedBounds(item.bounds)
  const span = Math.max(box.right - box.left, box.bottom - box.top)
  const scale = 1800 / span
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((box.right - box.left) * scale))
  canvas.height = Math.max(1, Math.round((box.bottom - box.top) * scale))
  const context = canvas.getContext('2d')
  if (!context) throw Error('Image previews are unavailable in this browser.')
  const targetZoom = Math.max(0, Math.floor(Math.log2(1800 / (256 * span))))
  const plans = item.assets.map((asset) => ({
    asset,
    tiles: previewTiles(asset.bounds, Math.min(asset.maxZoom, Math.max(asset.minZoom, targetZoom))),
  }))
  if (plans.reduce((sum, plan) => sum + plan.tiles.length, 0) > 160)
    throw Error('This multi-panel image is too large to preview. Open it on the map instead.')
  let drawn = 0
  for (const { asset, tiles } of plans) {
    signal.throwIfAborted()
    const archive = asset.url ? new PMTiles(asset.url) : null
    const clip = projectedBounds(asset.bounds)
    context.save()
    context.beginPath()
    context.rect(
      (clip.left - box.left) * scale,
      (clip.top - box.top) * scale,
      (clip.right - clip.left) * scale,
      (clip.bottom - clip.top) * scale,
    )
    context.clip()
    for (let start = 0; start < tiles.length; start += 6) {
      await Promise.all(
        tiles.slice(start, start + 6).map(async ({ x, y, z }) => {
          signal.throwIfAborted()
          let data: Blob
          if (archive) {
            const tile = await archive.getZxy(z, x, y, signal)
            if (!tile) return
            data = new Blob([tile.data])
          } else {
            const url = asset.tiles![0].replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
            const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
            if (response.status === 404 || response.status === 204) return
            if (!response.ok) throw Error('Some image tiles could not load.')
            data = await response.blob()
          }
          const image = await createImageBitmap(data)
          try {
            signal.throwIfAborted()
            const n = 2 ** z
            context.drawImage(image, (x / n - box.left) * scale, (y / n - box.top) * scale, scale / n, scale / n)
            drawn++
          } finally {
            image.close()
          }
        }),
      )
    }
    context.restore()
  }
  signal.throwIfAborted()
  if (!drawn) throw Error('No image tiles were available at this preview scale.')
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error('The image preview could not be created.'))),
      'image/png',
    ),
  )
}
