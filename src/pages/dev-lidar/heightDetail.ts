import type { Map, ImageSource } from 'maplibre-gl'
import { HEATMAP_COLORS } from './canopyHeatmaps'
import { readSourceGrid, sourceCell, sourceValue, toMetric, type SourceGrid } from './sourceGrids'
import detailUrl from './height-detail.generated.json?url'
export const DETAIL_LAYER = 'canopy-height-native-detail'
export interface HeightDetail {
  schema_version: number
  source_sha256: string
  input_sha256: Record<string, string>
  grid: { width: number; height: number; bounds: number[]; resolution: number; crs: string }
  coordinates: [number, number][]
  eligible_cells: number
  mask_base64: string
  detail_min_zoom: number
}
export function maskEligible(mask: Uint8Array, index: number) {
  return index >= 0 && index < mask.length * 8 && !!(mask[index >> 3] & (1 << (index & 7)))
}
export function detailColour(value: number) {
  const f = Math.max(0, Math.min(1, value / 40)) * (HEATMAP_COLORS.length - 1),
    i = Math.min(HEATMAP_COLORS.length - 2, Math.floor(f)),
    t = f - i
  const rgb = (c: string) => [1, 3, 5].map((n) => parseInt(c.slice(n, n + 2), 16))
  const a = rgb(HEATMAP_COLORS[i]),
    b = rgb(HEATMAP_COLORS[i + 1])
  return a.map((v, n) => Math.round(v + (b[n] - v) * t))
}
let pending: Promise<{ metadata: HeightDetail; grid: SourceGrid; mask: Uint8Array; image: string }> | null = null
let pendingKey = ''
export function loadHeightDetail(base: string, sourceHash: string) {
  const key = base + sourceHash
  if (!pending || pendingKey !== key) {
    pendingKey = key
    pending = (async () => {
      const response = await fetch(detailUrl)
      if (!response.ok) throw Error('Native-height mask unavailable')
      const metadata: HeightDetail = await response.json()
      if (metadata.schema_version !== 1 || metadata.source_sha256 !== sourceHash)
        throw Error('Native-height source mismatch')
      const checksumsResponse = await fetch(new URL('checksums.json', base))
      if (!checksumsResponse.ok) throw Error('Source checksums unavailable')
      const checksums = await checksumsResponse.json()
      for (const [name, hash] of Object.entries(metadata.input_sha256))
        if (checksums[name]?.sha256 !== hash) throw Error('Native-height mask input mismatch')
      const grid = await readSourceGrid(base, 'height-1m.tif', metadata.input_sha256['height-1m.tif'])
      if (
        grid.width !== metadata.grid.width ||
        grid.height !== metadata.grid.height ||
        grid.bounds.some((v, i) => Math.abs(v - metadata.grid.bounds[i]) > 1e-7)
      )
        throw Error('Native-height grid mismatch')
      const mask = Uint8Array.from(atob(metadata.mask_base64), (c) => c.charCodeAt(0))
      if (mask.length !== Math.ceil((grid.width * grid.height) / 8)) throw Error('Native-height mask length mismatch')
      const canvas = document.createElement('canvas')
      canvas.width = grid.width
      canvas.height = grid.height
      const context = canvas.getContext('2d')
      if (!context) throw Error('Detailed raster canvas unavailable')
      const pixels = context.createImageData(grid.width, grid.height)
      const palette = Array.from({ length: 4001 }, (_, i) => detailColour(i / 100))
      for (let i = 0; i < grid.values.length; i++)
        if (maskEligible(mask, i) && sourceValue(grid, i) !== null) {
          const colour = palette[Math.max(0, Math.min(4000, Math.round(grid.values[i] * 100)))]
          pixels.data.set([...colour, 255], i * 4)
        }
      context.putImageData(pixels, 0, 0)
      return { metadata, grid, mask, image: canvas.toDataURL('image/png') }
    })().catch((error) => {
      pending = null
      throw error
    })
  }
  return pending
}
export function installHeightDetail(map: Map, data: Awaited<ReturnType<typeof loadHeightDetail>>) {
  const coordinates = data.metadata.coordinates as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ]
  if (!map.getSource(DETAIL_LAYER)) map.addSource(DETAIL_LAYER, { type: 'image', url: data.image, coordinates })
  else (map.getSource(DETAIL_LAYER) as ImageSource).updateImage({ url: data.image, coordinates })
  if (!map.getLayer(DETAIL_LAYER))
    map.addLayer(
      {
        id: DETAIL_LAYER,
        type: 'raster',
        source: DETAIL_LAYER,
        minzoom: data.metadata.detail_min_zoom,
        layout: { visibility: 'none' },
        paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0, 'raster-opacity': 0.8 },
      },
      'workflow-gaps',
    )
}
export function applyHeightDetail(
  map: Pick<Map, 'getLayer' | 'setLayoutProperty' | 'setPaintProperty' | 'setLayerZoomRange'>,
  enabled: boolean,
  opacity: number,
  ready: boolean,
) {
  if (map.getLayer(DETAIL_LAYER)) {
    map.setLayoutProperty(DETAIL_LAYER, 'visibility', enabled && ready ? 'visible' : 'none')
    map.setPaintProperty(DETAIL_LAYER, 'raster-opacity', opacity)
  }
  if (map.getLayer('canopy-heatmap-height'))
    map.setLayerZoomRange('canopy-heatmap-height', 0, enabled && ready ? 16 : 24)
}
export function detailedHeightAt(data: Awaited<ReturnType<typeof loadHeightDetail>>, lon: number, lat: number) {
  const [x, y] = toMetric(lon, lat),
    cell = sourceCell(data.grid, x, y)
  return maskEligible(data.mask, cell) ? sourceValue(data.grid, cell) : null
}
