/**
 * What the page derives from a layer and its loaded features: the effective
 * style, each feature's title and key fields, the features left after filters,
 * and extents. Kept free of DOM access so it can be unit-tested.
 */
import {
  attributeCategory,
  columnNumbers,
  columnStats,
  formatAttribute,
  formatAttributeNumber,
  inferAttributes,
  type AttributeSchema,
} from '@/lib/featureAttributes'
import { CATEGORY_PALETTE, buildCategoriesStyle, buildRangeStyle, simpleStyle, type LayerStyle } from '@/lib/layerStyle'
import type { DataLayer } from './model'

/** Stable per-feature id, injected on load so the map, table and popup agree on identity. */
export const FEATURE_ID_KEY = '__devDataId'

export type DataFeatureProperties = Record<string, unknown> & { [FEATURE_ID_KEY]: string }
export type DataFeature = GeoJSON.Feature<GeoJSON.Geometry, DataFeatureProperties>
export type DataFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, DataFeatureProperties>

export const EMPTY_COLLECTION: DataFeatureCollection = { type: 'FeatureCollection', features: [] }

export type LayerStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface LoadedLayer {
  status: LayerStatus
  collection: DataFeatureCollection
  attributes: AttributeSchema[]
  error?: string
}

export const IDLE_LAYER: LoadedLayer = { status: 'idle', collection: EMPTY_COLLECTION, attributes: [] }
export const LOADING_LAYER: LoadedLayer = { status: 'loading', collection: EMPTY_COLLECTION, attributes: [] }

export type ViewportBounds = [number, number, number, number]

/** Gives each feature an id of `layerId:index` and infers the attribute schema. */
export function prepareLayer(
  layer: Pick<DataLayer, 'id' | 'attributes'>,
  input: GeoJSON.FeatureCollection,
): LoadedLayer {
  const features = (input.features ?? []).map((feature, index) => ({
    ...feature,
    properties: { ...(feature.properties ?? {}), [FEATURE_ID_KEY]: `${layer.id}:${index}` },
  })) as DataFeature[]
  return {
    status: 'ready',
    collection: { type: 'FeatureCollection', features },
    attributes: inferAttributes(features, layer.attributes),
  }
}

export function layerIdOfFeature(featureId: string): string {
  return featureId.slice(0, featureId.lastIndexOf(':'))
}

const styleCache = new WeakMap<DataFeatureCollection, Map<string, LayerStyle>>()

/** A colour for layers without a preset, stable per layer id. */
export function fallbackColor(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length]
}

/** The layer's own style, or the one its preset asks for, built from the loaded data. */
export function effectiveStyle(layer: DataLayer, loaded: LoadedLayer): LayerStyle {
  if (layer.style) return layer.style
  const preset = layer.stylePreset
  if (preset.type === 'simple' || loaded.status !== 'ready') {
    return simpleStyle(preset.type === 'simple' ? preset.color : fallbackColor(layer.id))
  }
  const cacheKey = JSON.stringify(preset)
  const cached = styleCache.get(loaded.collection)?.get(cacheKey)
  if (cached) return cached
  const attribute = loaded.attributes.find((candidate) => candidate.key === preset.column)
  let style: LayerStyle | null = null
  if (attribute && preset.type === 'categories') {
    style = buildCategoriesStyle(attribute.key, columnStats(loaded.collection.features, attribute))
  } else if (attribute && preset.type === 'range') {
    style = buildRangeStyle(attribute.key, columnNumbers(loaded.collection.features, attribute))
  }
  const resolved = style ?? simpleStyle(fallbackColor(layer.id))
  const perCollection = styleCache.get(loaded.collection) ?? new Map<string, LayerStyle>()
  perCollection.set(cacheKey, resolved)
  styleCache.set(loaded.collection, perCollection)
  return resolved
}

const TITLE_KEYS = /^(name|title|label|longname|location|strname|.*name)$/i
/** Identifiers and asset codes: useful in the table, noise in a popup. */
const CODE_KEYS = /(id|uid|guid|barcode|code)$/i

/** Name-like text columns, best first: the preset's, then names, titles and locations. */
function titleCandidates(layer: DataLayer, attributes: AttributeSchema[]): AttributeSchema[] {
  const named = layer.nameKey ? attributes.filter((attribute) => attribute.key === layer.nameKey) : []
  const nameLike = attributes.filter(
    (attribute) =>
      attribute.type === 'text' &&
      !attribute.system &&
      TITLE_KEYS.test(attribute.key) &&
      attribute.key !== layer.nameKey,
  )
  return [...named, ...nameLike]
}

/** The attribute used as features' title: the preset's, else the first name-like text column. */
export function titleAttribute(layer: DataLayer, attributes: AttributeSchema[]): AttributeSchema | undefined {
  return (
    titleCandidates(layer, attributes)[0] ??
    attributes.find((attribute) => attribute.type === 'text' && !attribute.system && !CODE_KEYS.test(attribute.key))
  )
}

/** A feature's title: the first name-like column it has a value in, else "<layer> <n>". */
export function featureTitle(feature: DataFeature, layer: DataLayer, attributes: AttributeSchema[]): string {
  const fallback = titleAttribute(layer, attributes)
  for (const attribute of [...titleCandidates(layer, attributes), ...(fallback ? [fallback] : [])]) {
    const text = formatAttribute(feature.properties[attribute.key], attribute)
    if (text) return text
  }
  return `${layer.label} ${Number(feature.properties[FEATURE_ID_KEY].split(':').pop()) + 1}`
}

/**
 * Fields shown in the popup, in order: the preset's key fields, else the first
 * useful columns, text before numbers and without identifiers or asset codes.
 */
export function popupAttributes(layer: DataLayer, attributes: AttributeSchema[], limit = 6): AttributeSchema[] {
  if (layer.popupKeys) {
    return layer.popupKeys
      .map((key) => attributes.find((attribute) => attribute.key === key))
      .filter((attribute): attribute is AttributeSchema => Boolean(attribute))
  }
  const title = titleAttribute(layer, attributes)
  const useful = attributes.filter(
    (attribute) => !attribute.system && attribute.key !== title?.key && !CODE_KEYS.test(attribute.key),
  )
  return [
    ...useful.filter((attribute) => attribute.type === 'text'),
    ...useful.filter((attribute) => attribute.type !== 'text'),
  ].slice(0, limit)
}

/** `[label, value]` pairs for a feature, empty values dropped. */
export function featureRows(feature: DataFeature, attributes: AttributeSchema[]): Array<[string, string]> {
  return attributes
    .map(
      (attribute) =>
        [attribute.label, formatAttribute(feature.properties[attribute.key], attribute)] as [string, string],
    )
    .filter(([, value]) => value !== '')
}

/** A feature's key fields for a popup or tooltip, without the one already used as its title. */
export function featureSummaryRows(
  feature: DataFeature,
  layer: DataLayer,
  attributes: AttributeSchema[],
  limit?: number,
): Array<[string, string]> {
  const title = featureTitle(feature, layer, attributes)
  const rows = featureRows(feature, popupAttributes(layer, attributes)).filter(([, value]) => value !== title)
  return limit === undefined ? rows : rows.slice(0, limit)
}

/** Formats class boundaries and summaries with a column's own format. */
export function numberFormatter(attribute: AttributeSchema | undefined): (value: number) => string {
  if (attribute?.type === 'datetime') return (value) => formatAttribute(value, attribute)
  return (value) => formatAttributeNumber(value, attribute?.format)
}

const distinctCache = new WeakMap<DataFeatureCollection, Map<string, string[]>>()

/**
 * Every distinct value of a column, as category keys. A category filter lists
 * the values it keeps, so toggling one value must start from all of them, not
 * just the ones a legend or chip list happens to show.
 */
export function distinctValues(collection: DataFeatureCollection, column: string): string[] {
  const cached = distinctCache.get(collection)?.get(column)
  if (cached) return cached
  const values = new Set<string>()
  for (const feature of collection.features) {
    const value = attributeCategory(feature.properties[column])
    if (value != null) values.add(value)
  }
  const result = [...values]
  const perCollection = distinctCache.get(collection) ?? new Map<string, string[]>()
  perCollection.set(column, result)
  distinctCache.set(collection, perCollection)
  return result
}

const filterCache = new WeakMap<DataFeatureCollection, Map<string, DataFeatureCollection>>()

/**
 * Features left after the layer's category filter, and after hiding values a
 * categories style draws with no colour. Returns the same object for the same
 * inputs, so the map does not re-tile on unrelated renders.
 */
export function filteredCollection(
  collection: DataFeatureCollection,
  layer: DataLayer,
  style: LayerStyle,
): DataFeatureCollection {
  const keep: Array<{ column: string; values: Set<string> }> = []
  if (layer.filter) keep.push({ column: layer.filter.column, values: new Set(layer.filter.values) })
  if (style.type === 'categories' && style.otherColor === null) {
    keep.push({ column: style.column, values: new Set(style.categories.map((category) => category.value)) })
  }
  if (keep.length === 0) return collection
  const key = JSON.stringify(keep.map((rule) => [rule.column, [...rule.values].sort()]))
  const cached = filterCache.get(collection)?.get(key)
  if (cached) return cached
  const result: DataFeatureCollection = {
    type: 'FeatureCollection',
    features: collection.features.filter((feature) =>
      keep.every((rule) => {
        const value = attributeCategory(feature.properties[rule.column])
        return value != null && rule.values.has(value)
      }),
    ),
  }
  const perCollection = filterCache.get(collection) ?? new Map<string, DataFeatureCollection>()
  perCollection.set(key, result)
  filterCache.set(collection, perCollection)
  return result
}

function walkCoordinates(coords: unknown, visit: (lng: number, lat: number) => void): void {
  if (!Array.isArray(coords)) return
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    visit(coords[0], coords[1])
    return
  }
  for (const entry of coords) walkCoordinates(entry, visit)
}

function geometryCoordinates(geometry: GeoJSON.Geometry | null): unknown {
  if (!geometry) return null
  if (geometry.type === 'GeometryCollection') return geometry.geometries.map(geometryCoordinates)
  return geometry.coordinates
}

/** [west, south, east, north] of a set of features, or null when empty. */
export function featuresBounds(features: readonly DataFeature[]): ViewportBounds | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const feature of features) {
    walkCoordinates(geometryCoordinates(feature.geometry), (lng, lat) => {
      if (lng < west) west = lng
      if (lng > east) east = lng
      if (lat < south) south = lat
      if (lat > north) north = lat
    })
  }
  return west === Infinity ? null : [west, south, east, north]
}

/** Bounding-box overlap with the viewport: good enough for "in view" filters. */
export function featureInBounds(feature: DataFeature, bounds: ViewportBounds): boolean {
  const box = featuresBounds([feature])
  if (!box) return false
  const [west, south, east, north] = bounds
  return box[2] >= west && box[0] <= east && box[3] >= south && box[1] <= north
}

/** Rough centre of a feature's coordinates, for flying to a row or anchoring its popup. */
export function featureCenter(feature: DataFeature): [number, number] | null {
  let sumLng = 0
  let sumLat = 0
  let count = 0
  walkCoordinates(geometryCoordinates(feature.geometry), (lng, lat) => {
    sumLng += lng
    sumLat += lat
    count += 1
  })
  return count === 0 ? null : [sumLng / count, sumLat / count]
}
