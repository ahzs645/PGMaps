import type { Geometry } from 'geojson'
import { scaleBarFor, type ScaleBar } from '@/components/ui/map-scale'
import { wmsLegend } from '@/lib/nechakoPortal'
import { categoryLabel } from './vectorStyle'
import { workspaceRenderOrder } from './nativeLayers'
import { wmsDisplayName, type Workspace } from './workspace'

export type MapImageOptions = {
  width: number
  height: number
  title: string
  northArrow: boolean
  northArrowStyle: 'arrow' | 'compass'
  scaleBar: boolean
  scaleDistanceKm: number | null
  legend: boolean
  legendScale: number
  attribution: boolean
  attributionText: string
}
export const DEFAULT_MAP_IMAGE_OPTIONS: MapImageOptions = {
  width: 640,
  height: 480,
  title: 'Nechako Watershed',
  northArrow: true,
  northArrowStyle: 'arrow',
  scaleBar: true,
  scaleDistanceKm: null,
  legend: true,
  legendScale: 1,
  attribution: true,
  attributionText: 'Created by PGMaps',
}
export const MAP_IMAGE_SIZES = [
  { label: '640 × 480', width: 640, height: 480 },
  { label: '1280 × 960', width: 1280, height: 960 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '2400 × 1800', width: 2400, height: 1800 },
] as const

export function checkedMapImageOptions(options: MapImageOptions): MapImageOptions {
  for (const [name, value] of [
    ['Width', options.width],
    ['Height', options.height],
  ] as const)
    if (!Number.isInteger(value) || value < 240 || value > 4096)
      throw new Error(`${name} must be a whole number between 240 and 4096 pixels.`)
  if (typeof options.title !== 'string' || options.title.length > 160)
    throw new Error('The map title can contain up to 160 characters.')
  if (!['arrow', 'compass'].includes(options.northArrowStyle)) throw new Error('Choose a north arrow style.')
  if (
    options.scaleDistanceKm !== null &&
    (!Number.isFinite(options.scaleDistanceKm) || options.scaleDistanceKm <= 0 || options.scaleDistanceKm > 20000)
  )
    throw new Error('The scale distance must be greater than zero and no more than 20,000 km.')
  if (!Number.isFinite(options.legendScale) || options.legendScale < 0.5 || options.legendScale > 3)
    throw new Error('Legend scale must be between 0.5 and 3.')
  if (typeof options.attributionText !== 'string' || options.attributionText.length > 240)
    throw new Error('Additional attribution can contain up to 240 characters.')
  if (
    ['northArrow', 'scaleBar', 'legend', 'attribution'].some(
      (key) => typeof options[key as keyof MapImageOptions] !== 'boolean',
    )
  )
    throw new Error('Choose which map elements to include.')
  return { ...options, title: options.title.trim(), attributionText: options.attributionText.trim() }
}

export type ImageRect = { x: number; y: number; width: number; height: number }
/** Keep the complete current map extent; never stretch it to a different aspect ratio. */
export function fitImageRect(sourceWidth: number, sourceHeight: number, area: ImageRect): ImageRect {
  if (![sourceWidth, sourceHeight, area.width, area.height].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Map and output dimensions must be positive.')
  const ratio = Math.min(area.width / sourceWidth, area.height / sourceHeight)
  const width = sourceWidth * ratio
  const height = sourceHeight * ratio
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height }
}

export function imageScaleBar(
  metersPerCssPixel: number,
  sourceCssWidth: number,
  drawnWidth: number,
  pitch: number,
  maxPixels: number,
  requestedKm: number | null = null,
): ScaleBar | null {
  if (pitch > 60 || sourceCssWidth <= 0 || drawnWidth <= 0) return null
  const metersPerPixel = metersPerCssPixel * (sourceCssWidth / drawnWidth)
  if (requestedKm !== null) {
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null
    const pixels = (requestedKm * 1000) / metersPerPixel
    if (pixels > maxPixels)
      throw new Error('The requested scale bar is too long for this map image. Choose a shorter distance or Auto.')
    if (pixels < 12) throw new Error('The requested scale bar is too short to read. Choose a longer distance or Auto.')
    return { meters: requestedKm * 1000, pixels, label: `${requestedKm} km` }
  }
  return scaleBarFor(metersPerPixel, maxPixels)
}

export type MapImageSymbol = 'point' | 'line' | 'polygon'
export type MapImageLegend = {
  id: string
  title: string
  symbols: MapImageSymbol[]
  rows: { label: string; color: string }[]
  fillOpacity: number
  lineOpacity: number
  lineWidth: number
  imageUrl?: string
}
function geometrySymbols(geometry: Geometry | null): MapImageSymbol[] {
  if (!geometry) return []
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(geometrySymbols)
  if (geometry.type.endsWith('Point')) return ['point']
  if (geometry.type.endsWith('LineString')) return ['line']
  return ['polygon']
}

/** Legend definitions follow the same visible workspace layers, typed colors and draw order as the map. */
export function mapImageLegends(workspace: Workspace): MapImageLegend[] {
  return workspaceRenderOrder(workspace)
    .slice()
    .reverse()
    .flatMap((entry): MapImageLegend[] => {
      if (entry.kind === 'wms') {
        const layer = workspace.layers.find((item) => item.id === entry.id)
        if (!layer || layer.visible === false || layer.opacity === 0) return []
        return [
          {
            id: layer.id,
            title: wmsDisplayName(layer),
            symbols: [],
            rows: [],
            fillOpacity: 1,
            lineOpacity: 1,
            lineWidth: 1,
            imageUrl: wmsLegend(layer.source.resource, layer.layer.name, layer.style),
          },
        ]
      }
      if (entry.kind !== 'vector') return []
      const vector = workspace.vectors.find((item) => item.id === entry.id)
      if (!vector?.visible) return []
      const symbols = [...new Set(vector.data.features.flatMap((feature) => geometrySymbols(feature.geometry)))]
      if (!symbols.length) return []
      return [
        {
          id: vector.id,
          title: vector.name,
          symbols,
          rows: vector.categories?.rules.length
            ? [
                ...vector.categories.rules.map((rule) => ({
                  label: `${vector.categories!.property}: ${categoryLabel(rule.value)}`,
                  color: rule.color,
                })),
                { label: 'Other values', color: vector.categories.fallback },
              ]
            : [{ label: '', color: vector.color }],
          fillOpacity: vector.fillOpacity ?? 0.35,
          lineOpacity: vector.lineOpacity ?? 1,
          lineWidth: vector.lineWidth ?? 2,
        },
      ]
    })
}
