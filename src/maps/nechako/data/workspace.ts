import proj4 from 'proj4'
import { nativeWmsResource, type NativeWmsReference } from './nativeLayers'
import { checkedCategoryStyle, checkedSldUrl, type CategoryStyle } from './vectorStyle'
import type { FeatureCollection, Geometry, Position } from 'geojson'
import type { PortalSource, WmsLayer } from '@/lib/nechakoPortal'

proj4.defs(
  'EPSG:3005',
  '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs',
)

export type ActiveWms = {
  id: string
  /** Optional local presentation name; keep the service layer name/title intact. */
  displayName?: string
  source: PortalSource
  layer: WmsLayer
  style: string
  opacity: number
  formats: string[]
  visible?: boolean
  native?: NativeWmsReference
}
export function checkedLayerDisplayName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200)
    throw new Error('A layer name must contain 1–200 characters.')
  return value.trim()
}
export const wmsDisplayName = (layer: ActiveWms) => layer.displayName ?? layer.layer.title
export type VectorData = {
  id: string
  name: string
  data: FeatureCollection
  color: string
  visible: boolean
  fillOpacity?: number
  lineOpacity?: number
  lineWidth?: number
  pointRadius?: number
  categories?: CategoryStyle
  original?: unknown
}
export type TileData = { id: string; name: string; urls: string[]; attribution: string; visible: boolean }
export type Workspace = {
  schema: 'nechako-workspace-v1'
  camera: { center: [number, number]; zoom: number; bearing: number; pitch: number }
  layers: ActiveWms[]
  vectors: VectorData[]
  tiles: TileData[]
  originalProject?: unknown
  /** Live source content loaded under an authenticated connection; clear its display on logout. */
  sessionBound?: boolean
  /** Native bottom-to-top source IDs, including unsupported originals, preserved across exports. */
  sourceOrder?: string[]
  warnings: string[]
}

export const EMPTY_WORKSPACE: Workspace = {
  schema: 'nechako-workspace-v1',
  camera: { center: [-124.5, 54], zoom: 6, bearing: 0, pitch: 0 },
  layers: [],
  vectors: [],
  tiles: [],
  warnings: [],
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
  return value as Record<string, unknown>
}
export function httpsUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A source URL is missing.')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Map sources must use HTTPS without credentials in the URL.')
  return value
}

/** Preserve source properties and IDs; normalize only geometry and CRS. */
export function normalizeGeojson(input: unknown, explicitCrs?: string): FeatureCollection {
  const object = record(typeof input === 'string' ? JSON.parse(input) : input)
  const crs = object.crs as { properties?: { name?: string } } | undefined
  const name = explicitCrs || crs?.properties?.name || 'EPSG:4326'
  const match = name.match(/(?:EPSG(?::|::|\/0\/))(\d+)$/i)
  const sourceCrs = match ? `EPSG:${match[1]}` : name.includes('CRS84') ? 'EPSG:4326' : name
  if (!proj4.defs(sourceCrs))
    throw new Error(`Unsupported CRS ${name}. Convert this file with the GDAL service or choose its known CRS.`)
  const features =
    object.type === 'FeatureCollection'
      ? object.features
      : object.type === 'Feature'
        ? [object]
        : [{ type: 'Feature', properties: {}, geometry: object }]
  if (!Array.isArray(features) || features.length > 100000) throw new Error('Expected up to 100,000 GeoJSON features.')
  const transformPosition = (value: unknown): Position => {
    if (
      !Array.isArray(value) ||
      value.length < 2 ||
      !value.every((item) => typeof item === 'number' && Number.isFinite(item))
    )
      throw new Error('Geometry contains an invalid coordinate.')
    const position =
      sourceCrs === 'EPSG:4326' ? [...value] : [...proj4(sourceCrs, 'EPSG:4326', value.slice(0, 2)), ...value.slice(2)]
    if (Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90)
      throw new Error('Coordinates are outside longitude/latitude bounds. Supply the source CRS.')
    return position
  }
  const nested = (value: unknown, depth: number): unknown => {
    if (depth === 0) return transformPosition(value)
    if (!Array.isArray(value)) throw new Error('Invalid coordinate nesting.')
    return value.map((item) => nested(item, depth - 1))
  }
  const geometry = (value: unknown): Geometry | null => {
    if (value === null) return null
    const geo = record(value)
    if (geo.type === 'GeometryCollection') {
      if (!Array.isArray(geo.geometries)) throw new Error('Invalid GeometryCollection.')
      return {
        type: 'GeometryCollection',
        geometries: geo.geometries.map(geometry).filter((item): item is Geometry => !!item),
      }
    }
    const depths: Record<string, number> = {
      Point: 0,
      MultiPoint: 1,
      LineString: 1,
      MultiLineString: 2,
      Polygon: 2,
      MultiPolygon: 3,
    }
    if (typeof geo.type !== 'string' || !(geo.type in depths)) throw new Error('Unsupported GeoJSON geometry type.')
    const coordinates = nested(geo.coordinates, depths[geo.type])
    if (geo.type === 'LineString' && (coordinates as unknown[]).length < 2)
      throw new Error('A line needs at least two positions.')
    const polygons = geo.type === 'Polygon' ? [coordinates] : geo.type === 'MultiPolygon' ? coordinates : []
    for (const polygon of polygons as Position[][][])
      for (const ring of polygon) {
        if (ring.length < 4 || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
          throw new Error('Polygon rings must contain at least four positions and be closed.')
      }
    return { type: geo.type, coordinates } as Geometry
  }
  return {
    type: 'FeatureCollection',
    features: features.map((value) => {
      const feature = record(value)
      if (feature.type !== 'Feature') throw new Error('Expected a GeoJSON Feature.')
      if (feature.properties !== null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties)))
        throw new Error('Feature properties must be an object or null.')
      return {
        type: 'Feature',
        ...(typeof feature.id === 'number' || typeof feature.id === 'string' ? { id: feature.id } : {}),
        properties: feature.properties as Record<string, unknown> | null,
        geometry: geometry(feature.geometry),
      }
    }),
  } as FeatureCollection
}

export function importWorkspace(input: unknown): Workspace {
  let object = record(input)
  if (object.attributes && typeof object.attributes === 'object') object = record(object.attributes)
  if (object.schema === 'nechako-workspace-v1') {
    const camera = record(object.camera)
    if (
      !Array.isArray(camera.center) ||
      camera.center.length !== 2 ||
      !camera.center.every((item) => typeof item === 'number' && Number.isFinite(item)) ||
      Math.abs(Number(camera.center[0])) > 180 ||
      Math.abs(Number(camera.center[1])) > 90
    )
      throw new Error('Invalid workspace camera.')
    for (const [key, min, max] of [
      ['zoom', 0, 22],
      ['bearing', -360, 360],
      ['pitch', 0, 85],
    ] as const)
      if (typeof camera[key] !== 'number' || !Number.isFinite(camera[key]) || camera[key] < min || camera[key] > max)
        throw new Error(`Invalid camera ${key}.`)
    if (
      !Array.isArray(object.layers) ||
      !Array.isArray(object.vectors) ||
      !Array.isArray(object.tiles) ||
      object.layers.length + object.vectors.length + object.tiles.length > 200
    )
      throw new Error('Invalid workspace layers (maximum 200).')
    const layers = object.layers.map((value) => {
      const layer = record(value),
        source = record(layer.source),
        named = record(layer.layer)
      httpsUrl(source.resource)
      const sourceUrl = new URL(String(source.resource))
      for (const [key, value] of sourceUrl.searchParams) {
        if (key.toUpperCase() === 'SLD_BODY')
          throw new Error(
            'Inline SLD rendering is unsupported. Preserve it as original metadata and use an HTTPS SLD reference or an advertised style.',
          )
        if (key.toUpperCase() === 'SLD') checkedSldUrl(value)
      }
      if (
        typeof layer.id !== 'string' ||
        typeof source.name !== 'string' ||
        typeof named.name !== 'string' ||
        typeof named.title !== 'string' ||
        typeof layer.style !== 'string' ||
        typeof layer.opacity !== 'number' ||
        !Number.isFinite(layer.opacity) ||
        layer.opacity < 0 ||
        layer.opacity > 1 ||
        !Array.isArray(layer.formats)
      )
        throw new Error('Invalid WMS workspace layer.')
      const displayName = layer.displayName === undefined ? undefined : checkedLayerDisplayName(layer.displayName)
      return {
        ...layer,
        ...(displayName === undefined ? {} : { displayName }),
        visible: layer.visible !== false,
      } as ActiveWms
    })
    const vectors = object.vectors.map((value) => {
      const vector = record(value)
      if (
        typeof vector.id !== 'string' ||
        typeof vector.name !== 'string' ||
        typeof vector.color !== 'string' ||
        !/^#[a-f0-9]{6}$/i.test(vector.color)
      )
        throw new Error('Invalid vector workspace layer.')
      for (const [key, max] of [
        ['fillOpacity', 1],
        ['lineOpacity', 1],
        ['lineWidth', 20],
        ['pointRadius', 30],
      ] as const) {
        const value = vector[key]
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max))
          throw new Error('Invalid vector workspace style.')
      }
      if (vector.categories !== undefined) checkedCategoryStyle(vector.categories)
      return { ...vector, data: normalizeGeojson(vector.data), visible: vector.visible !== false } as VectorData
    })
    const tiles = object.tiles.map((value) => {
      const tile = record(value)
      if (
        typeof tile.id !== 'string' ||
        typeof tile.name !== 'string' ||
        !Array.isArray(tile.urls) ||
        !tile.urls.length ||
        typeof tile.attribution !== 'string'
      )
        throw new Error('Invalid tile workspace layer.')
      return { ...tile, urls: tile.urls.map(httpsUrl), visible: tile.visible !== false } as TileData
    })
    if (
      object.sourceOrder !== undefined &&
      (!Array.isArray(object.sourceOrder) ||
        object.sourceOrder.length > 200 ||
        object.sourceOrder.some((id) => typeof id !== 'string') ||
        new Set(object.sourceOrder).size !== object.sourceOrder.length)
    )
      throw new Error('Invalid source layer order.')
    const ids = [...layers, ...vectors, ...tiles].map((item) => item.id)
    if (new Set(ids).size !== ids.length) throw new Error('Workspace layer IDs must be unique.')
    return {
      schema: 'nechako-workspace-v1',
      camera: camera as Workspace['camera'],
      layers,
      vectors,
      tiles,
      originalProject: object.originalProject,
      sessionBound: object.sessionBound === true,
      sourceOrder: object.sourceOrder as string[] | undefined,
      warnings: Array.isArray(object.warnings)
        ? object.warnings.filter((item): item is string => typeof item === 'string')
        : [],
    }
  }
  if (
    !Array.isArray(object.coordinates) ||
    object.coordinates.length !== 2 ||
    !object.coordinates.every((item) => typeof item === 'number' && Number.isFinite(item)) ||
    Math.abs(Number(object.coordinates[0])) > 180 ||
    Math.abs(Number(object.coordinates[1])) > 90 ||
    !Array.isArray(object.layers) ||
    object.layers.length > 200
  )
    throw new Error('Expected native portal coordinates/layers or a Nechako workspace export.')
  const output: Workspace = {
    ...EMPTY_WORKSPACE,
    camera: { ...EMPTY_WORKSPACE.camera, center: object.coordinates as [number, number] },
    layers: [],
    vectors: [],
    tiles: [],
    originalProject: input,
    sourceOrder: object.layers.map((_, index) => `native-${index}`),
    warnings: [],
  }
  // The portal measures a CSS inch (#dpiScale = 96 CSS px) and uses 39.37 inches/metre. MapLibre uses 512 px world tiles.
  if (typeof object.scale === 'number' && object.scale > 0 && Number.isFinite(object.scale))
    output.camera.zoom = Math.max(0, Math.min(22, Math.log2(40075016.68557849 / ((512 * object.scale) / (96 * 39.37)))))
  output.warnings.push(
    'Native scale was converted using the portal’s CSS inch convention (96 px × 39.37 inches/metre). Rendering uses PGMaps basemaps and default vector styling. Source styles, IDs and SLD references are retained in the original project.',
  )
  object.layers.forEach((value, index) => {
    const layer = record(value),
      name = String(layer.legendName || layer.title || layer.name || `Layer ${index + 1}`),
      id = `native-${index}`
    try {
      if (layer.sourceType === 'Vector') {
        const converted = nativeVector(layer.layerData)
        output.warnings.push(...converted.warnings.map((warning) => `${name}: ${warning}`))
        output.vectors.push({
          id,
          name,
          data: converted.data,
          color: '#0f766e',
          visible: layer.checked !== false,
          original: value,
        })
      } else if (layer.sourceType === 'WMS') {
        const resolved = !Array.isArray(layer.urls) || !layer.urls.length ? nativeWmsResource(layer) : undefined
        const resource = httpsUrl(resolved?.resource ?? (layer.urls as unknown[])[0]),
          params = layer.params ? record(layer.params) : {}
        const nativeName = resolved?.name ?? String(params.LAYERS || params.layers || '')
        if (!nativeName) throw new Error('No WMS layer name.')
        const endpoint = new URL(resource)
        for (const [key, value] of Object.entries(params)) {
          if (key.toUpperCase() === 'SLD_BODY') {
            output.warnings.push(
              `${name}: inline SLD retained in original metadata; rendering its expressions is unsupported.`,
            )
          } else if (key.toUpperCase() === 'SLD') {
            try {
              endpoint.searchParams.set(key, checkedSldUrl(String(value)))
            } catch {
              output.warnings.push(`${name}: unsafe SLD URL retained in original metadata and excluded from rendering.`)
            }
          } else if (['MAP', 'FILTER', 'CQL_FILTER'].includes(key.toUpperCase()))
            endpoint.searchParams.set(key, String(value))
        }
        if (typeof layer.portalSld === 'string') {
          try {
            endpoint.searchParams.set('SLD', checkedSldUrl(layer.portalSld))
          } catch {
            output.warnings.push(
              `${name}: unsafe native SLD retained in original metadata and excluded from rendering.`,
            )
          }
        }
        if (resolved)
          output.warnings.push(
            `${name}: native mapfile and SLD references can expire; verify the service or refresh the authorized shared-layer reference.`,
          )
        output.layers.push({
          id,
          native: resolved?.reference,
          source: {
            name,
            type: 'wms',
            resource: endpoint.toString(),
            attributions: Array.isArray(layer.attributions)
              ? layer.attributions.join(' ')
              : String(layer.attributions || name),
          },
          layer: { name: nativeName, title: name, queryable: false, crs: ['EPSG:3857'], styles: [] },
          style: String(params.STYLES || ''),
          opacity: 0.75,
          formats: [],
          visible: layer.checked !== false,
        })
        output.warnings.push(`${name}: capabilities/identify support and native styling need service verification.`)
      } else if (['XYZ', 'OSM'].includes(String(layer.sourceType))) {
        if (!Array.isArray(layer.urls) || !layer.urls.length) throw new Error('No tile URL was saved.')
        output.tiles.push({
          id,
          name,
          urls: layer.urls.map(httpsUrl),
          attribution: Array.isArray(layer.attributions)
            ? layer.attributions.join(' ')
            : String(layer.attributions || name),
          visible: layer.checked !== false,
        })
      } else throw new Error(`Unsupported source ${String(layer.sourceType)}; original retained.`)
    } catch (error) {
      output.warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  if (new Set(object.layers.map((value) => record(value).sourceType)).size > 1)
    output.warnings.push(
      'Native source order is preserved across layer types. Unsupported sources remain in the original metadata and are omitted from rendering.',
    )
  return output
}

/** Project.js saves toGeojson(layer, true): a wrapper plus a separate attribute matrix. */
export function nativeVector(input: unknown) {
  const object = record(typeof input === 'string' ? JSON.parse(input) : input)
  const warnings: string[] = []
  if (!object.geojson) return { data: normalizeGeojson(object), warnings }
  const data = normalizeGeojson(object.geojson),
    attributes = record(object.Attributes)
  if (
    !Array.isArray(attributes.attributes) ||
    !attributes.attributes.every((value) => typeof value === 'string') ||
    !Array.isArray(attributes.rows) ||
    attributes.rows.length !== data.features.length ||
    new Set(attributes.attributes).size !== attributes.attributes.length
  )
    throw new Error('Native attribute matrix does not match its features/unique columns; original retained.')
  const rows = attributes.rows
  const names = attributes.attributes as string[],
    types = Array.isArray(attributes.type) ? attributes.type : []
  data.features = data.features.map((feature, index) => {
    const row = rows[index]
    if (!Array.isArray(row) || row.length !== names.length)
      throw new Error('Native attribute row width does not match its columns; original retained.')
    const properties = Object.fromEntries(
      names.map((name, column) => {
        const raw = row[column]
        if (raw === '' || raw === null || raw === undefined) return [name, null]
        if (['integer', 'bigint', 'double precision', 'real'].includes(String(types[column]))) {
          const value = Number(raw)
          if (
            Number.isFinite(value) &&
            (!['integer', 'bigint'].includes(String(types[column])) || Number.isSafeInteger(value))
          )
            return [name, value]
          warnings.push(
            `Feature ${index}, ${name}: numeric value retained as supplied to avoid invalid conversion or integer precision loss.`,
          )
        }
        return [name, raw]
      }),
    )
    return { ...feature, properties: { ...feature.properties, ...properties } }
  })
  return { data, warnings }
}

export function geographicArea(bounds: [number, number, number, number]) {
  const [west, south, east, north] = bounds
  if (
    !bounds.every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  )
    throw new Error(
      'Enter west < east and south < north within longitude/latitude bounds. Split areas crossing the date line.',
    )
  return {
    geojson: JSON.stringify({
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
              ],
            ],
          },
        },
      ],
    }),
  }
}
