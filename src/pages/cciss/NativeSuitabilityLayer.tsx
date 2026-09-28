import { useEffect, useId } from 'react'
import type { GeoTIFF } from 'geotiff'
import MapLibreGL from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { suitabilityColor } from './raster'

type GeoTIFFImage = Awaited<ReturnType<GeoTIFF['getImage']>>

const TILE_SIZE = 256
const SOURCE_MAX_ZOOM = 16
const PROTOCOL = 'cciss-raster'
const images = new Map<string, GeoTIFFImage>()
let protocolRegistered = false

function latitudeAtTileY(tileY: number, zoom: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / 2 ** zoom))) * 180) / Math.PI
}

/** Draw classified pixels directly from one numeric GeoTIFF at every map zoom. */
async function drawNumericTile(image: GeoTIFFImage, z: number, x: number, y: number, signal: AbortSignal) {
  const canvas =
    typeof OffscreenCanvas === 'undefined'
      ? document.createElement('canvas')
      : new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is required to render CCISS cells')
  const output = context.createImageData(TILE_SIZE, TILE_SIZE)
  const [originX, originY] = image.getOrigin()
  const [pixelX, pixelY] = image.getResolution()
  if (image.getGeoKeys().GeographicTypeGeoKey !== 4326 || pixelX <= 0 || pixelY >= 0) {
    throw new Error('Expected a north-up CCISS GeoTIFF in EPSG:4326')
  }

  const scale = 2 ** z
  const west = (x / scale) * 360 - 180
  const east = ((x + 1) / scale) * 360 - 180
  const north = latitudeAtTileY(y, z)
  const south = latitudeAtTileY(y + 1, z)
  const left = Math.max(0, Math.floor((west - originX) / pixelX))
  const right = Math.min(image.getWidth(), Math.ceil((east - originX) / pixelX))
  const top = Math.max(0, Math.floor((originY - north) / -pixelY))
  const bottom = Math.min(image.getHeight(), Math.ceil((originY - south) / -pixelY))
  const width = right - left
  const height = bottom - top
  if (width > 0 && height > 0) {
    // At overview zooms, several native cells fall into one screen pixel.
    // Bound decoding cost there; at close zoom, retain every original cell.
    const downsample = width * height > 300_000
    const sampleWidth = downsample ? Math.min(width, 512) : width
    const sampleHeight = downsample ? Math.min(height, 1024) : height
    const rasters = await image.readRasters({
      samples: [0],
      window: [left, top, right, bottom],
      width: sampleWidth,
      height: sampleHeight,
      resampleMethod: 'nearest',
    })
    if (signal.aborted) throw new DOMException('Tile request aborted', 'AbortError')
    const cells = rasters[0] as ArrayLike<number>
    const columns = new Int32Array(TILE_SIZE)
    for (let px = 0; px < TILE_SIZE; px += 1) {
      const longitude = ((x + (px + 0.5) / TILE_SIZE) / scale) * 360 - 180
      const column = Math.floor((longitude - originX) / pixelX) - left
      columns[px] =
        column < 0 || column >= width
          ? -1
          : Math.min(sampleWidth - 1, Math.floor(((column + 0.5) * sampleWidth) / width))
    }
    for (let py = 0; py < TILE_SIZE; py += 1) {
      const latitude = latitudeAtTileY(y + (py + 0.5) / TILE_SIZE, z)
      const row = Math.floor((originY - latitude) / -pixelY) - top
      if (row < 0 || row >= height) continue
      const sampledRow = Math.min(sampleHeight - 1, Math.floor(((row + 0.5) * sampleHeight) / height))
      for (let px = 0; px < TILE_SIZE; px += 1) {
        const column = columns[px]
        if (column < 0) continue
        const code = cells[sampledRow * sampleWidth + column]
        const offset = (py * TILE_SIZE + px) * 4
        output.data.set(suitabilityColor(code), offset)
      }
    }
  }
  context.putImageData(output, 0, 0)
  return typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
    ? canvas.transferToImageBitmap()
    : createImageBitmap(canvas)
}

function ensureProtocol() {
  if (protocolRegistered) return
  MapLibreGL.addProtocol(PROTOCOL, async (request, abortController) => {
    const match = /^cciss-raster:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)(?:\?.*)?$/.exec(request.url)
    if (!match) throw new Error(`Invalid CCISS tile URL: ${request.url}`)
    const image = images.get(match[1])
    if (!image) throw new Error('The CCISS GeoTIFF is no longer available')
    const bitmap = await drawNumericTile(
      image,
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      abortController.signal,
    )
    return { data: bitmap }
  })
  protocolRegistered = true
}

/** One numeric raster source across all zooms; MapLibre overzooms its native tiles sharply. */
export function NativeSuitabilityLayer({ image }: { image: GeoTIFFImage }) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `cciss-numeric-source-${uid}`
  const layerId = `cciss-numeric-layer-${uid}`

  useEffect(() => {
    if (!map || !isLoaded) return
    ensureProtocol()
    images.set(uid, image)
    map.addSource(sourceId, {
      type: 'raster',
      tiles: [`${PROTOCOL}://${uid}/{z}/{x}/{y}`],
      tileSize: TILE_SIZE,
      minzoom: 5,
      maxzoom: SOURCE_MAX_ZOOM,
      attribution: 'CCISS GeoTIFF download · BC Ministry of Forests',
    })
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: { 'raster-opacity': 0.8, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
    })
    return () => {
      images.delete(uid)
      // The parent Map can remove its style before React unmounts this child.
      if (!map.getStyle()) return
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      if (map.getSource(sourceId)) map.removeSource(sourceId)
    }
  }, [map, isLoaded, uid, image, sourceId, layerId])

  return null
}
