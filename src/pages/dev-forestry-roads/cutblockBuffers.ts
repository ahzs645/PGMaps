import buffer from '@turf/buffer'
import { featuresBounds, type GeometryCarrier } from '@/lib/featureBounds'
import type { ContextFeature, Coordinate } from './types'
import { referenceLayerKey, type ReferenceFeature } from './referenceFeatures'

export const MAX_CUTBLOCK_BUFFER_M = 10_000
export const CUTBLOCK_BUFFER_COLOR = '#7c3aed'
export const DEFAULT_CUTBLOCK_BUFFER_M = 400
export const CUTBLOCK_BUFFER_PATTERNS = ['solid', 'diagonal', 'crosshatch'] as const
export type CutblockBufferPattern = (typeof CUTBLOCK_BUFFER_PATTERNS)[number]
export type CutblockBuffer = {
  layer: string
  color?: string
  pattern?: CutblockBufferPattern
} & ({ metres: number } | { source: string })
export const cutblockBufferKey = (layer: string) => `buffer:${layer}`

export function keepCutblockBuffers(
  buffers: readonly CutblockBuffer[],
  context: readonly ContextFeature[],
  reference: readonly ReferenceFeature[],
): CutblockBuffer[] {
  const blocks = new Set(context.filter(({ kind }) => kind === 'harvest').map(({ layerSource }) => layerSource))
  const sources = new Map<string, boolean>()
  for (const feature of reference) {
    const key = referenceLayerKey(feature)
    sources.set(
      key,
      sources.get(key) !== false && feature.geometry.type === 'Polygon' && !feature.sheet && !feature.classGrid,
    )
  }
  const used = new Set<string>()
  return buffers.filter((setting) => {
    if (!blocks.has(setting.layer)) return false
    if ('metres' in setting) return true
    if (!sources.get(setting.source) || used.has(setting.source)) return false
    used.add(setting.source)
    return true
  })
}

/** Only the plan reads these polygons. Buffers are horizontal offsets from each cutblock. */
export function cutblockBufferFeatures(
  setting: CutblockBuffer,
  context: readonly ContextFeature[],
  reference: readonly ReferenceFeature[],
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[] {
  const source = 'source' in setting ? setting.source : null
  if (source)
    return reference.flatMap(({ source: path, geometry, id }) =>
      path === source && geometry.type === 'Polygon'
        ? [{ type: 'Feature', geometry, properties: { id: `buffer-${id}` } }]
        : [],
    )
  if (!('metres' in setting)) return []
  return context.flatMap(({ kind, layerSource, geometry, id }) => {
    if (kind !== 'harvest' || layerSource !== setting.layer || geometry.type !== 'Polygon') return []
    let cached = generated.get(geometry)
    if (cached?.metres !== setting.metres) {
      const polygon = buffer(geometry, setting.metres, { units: 'meters', steps: 8 })
      cached = { metres: setting.metres, geometry: polygon?.geometry }
      generated.set(geometry, cached)
    }
    return cached.geometry ? [{ type: 'Feature', geometry: cached.geometry, properties: { id: `buffer-${id}` } }] : []
  })
}

const generated = new WeakMap<GeoJSON.Polygon, { metres: number; geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon }>()

export function layerFitPoints(features: readonly GeometryCarrier[]): Coordinate[] {
  const bounds = featuresBounds(features)
  return bounds
    ? [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ]
    : []
}
