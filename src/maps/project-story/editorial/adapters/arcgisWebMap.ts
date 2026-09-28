import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'

export type ArcgisRecord = Record<string, unknown>
export const record = (value: unknown): ArcgisRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as ArcgisRecord) : {}
const rows = (value: unknown): ArcgisRecord[] => (Array.isArray(value) ? value.map(record) : [])
const EARTH = 20037508.342789244
/** ArcGIS uses 256px scale levels; MapLibre's world is 512px at zoom zero. */
export const scaleToZoom = (scale: number) => Math.log2(295828763.7957775 / scale)
export function geographicPoint(value: unknown): [number, number] | undefined {
  const p = record(value)
  if (Array.isArray(value) && value.length >= 2) return [Number(value[0]), Number(value[1])]
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return undefined
  const sr = record(p.spatialReference)
  const wkid = sr.latestWkid ?? sr.wkid ?? 4326
  if (wkid === 4326) return [p.x, p.y]
  if (![3857, 102100, 102113].includes(Number(wkid))) throw new Error(`Unsupported source spatial reference: ${wkid}`)
  return [(p.x / EARTH) * 180, ((2 * Math.atan(Math.exp((p.y / EARTH) * Math.PI)) - Math.PI / 2) * 180) / Math.PI]
}
export function geographicExtent(value: unknown): [[number, number], [number, number]] | undefined {
  const e = record(value)
  if (![e.xmin, e.ymin, e.xmax, e.ymax].every((x) => typeof x === 'number')) return undefined
  return [
    geographicPoint({ x: e.xmin, y: e.ymin, spatialReference: e.spatialReference })!,
    geographicPoint({ x: e.xmax, y: e.ymax, spatialReference: e.spatialReference })!,
  ]
}
export function authoredCamera(settings: ArcgisRecord) {
  const viewpoint = record(settings.viewpoint)
  const target = viewpoint.targetGeometry
  const center = geographicPoint(target) ?? geographicPoint(settings.center)
  const bounds = geographicExtent(target) ?? geographicExtent(settings.extent)
  const zoom =
    typeof viewpoint.scale === 'number'
      ? scaleToZoom(viewpoint.scale)
      : typeof settings.zoom === 'number'
        ? settings.zoom - 1
        : undefined
  return { center, bounds, zoom, bearing: typeof viewpoint.rotation === 'number' ? -viewpoint.rotation : 0 }
}
function color(symbol: unknown) {
  const s = record(symbol)
  if (s.type !== 'esriSFS' || !['esriSFSSolid', 'esriSFSNull'].includes(String(s.style)))
    throw new Error(`Unsupported original symbol: ${s.type}/${s.style}`)
  const outline = record(s.outline)
  if (Number(outline.width) > 0 && outline.style !== 'esriSLSNull')
    throw new Error('This source uses polygon outlines that are not supported by the imported map adapter.')
  if (s.style === 'esriSFSNull') return 'rgba(0,0,0,0)'
  const c = s.color
  if (!Array.isArray(c) || c.length < 3) throw new Error('The original symbol has no supported RGBA color.')
  return `rgba(${c[0]},${c[1]},${c[2]},${Number(c[3] ?? 255) / 255})`
}
export function rendererColor(value: unknown): string | ExpressionSpecification {
  const renderer = record(value)
  if (Array.isArray(renderer.visualVariables) && renderer.visualVariables.length)
    throw new Error('Original renderer visual variables are not supported.')
  const fallback = renderer.defaultSymbol ? color(renderer.defaultSymbol) : 'rgba(0,0,0,0)'
  if (renderer.type === 'simple') return color(renderer.symbol)
  if (renderer.type === 'uniqueValue') {
    if (renderer.field2 || renderer.valueExpression)
      throw new Error('Original multi-field/expression renderer is not supported.')
    return [
      'match',
      ['to-string', ['get', String(renderer.field1)]],
      ...rows(renderer.uniqueValueInfos).flatMap((info) => [String(info.value), color(info.symbol)]),
      fallback,
    ] as ExpressionSpecification
  }
  if (renderer.type === 'classBreaks') {
    if (renderer.normalizationType || renderer.valueExpression)
      throw new Error('Original normalized/expression renderer is not supported.')
    const value: ExpressionSpecification = ['to-number', ['get', String(renderer.field)], -1e30]
    const cases = rows(renderer.classBreakInfos).flatMap((info) => [
      ['<=', value, Number(info.classMaxValue)],
      color(info.symbol),
    ])
    return [
      'case',
      ['all', ['has', String(renderer.field)], ['>=', value, Number(renderer.minValue ?? -1e20)]],
      ['case', ...cases, fallback],
      fallback,
    ] as unknown as ExpressionSpecification
  }
  throw new Error(`Unsupported original renderer: ${renderer.type}`)
}
export function exportTileUrl(layer: ArcgisRecord): string {
  const image = String(layer.url).includes('/ImageServer')
  const params = new URLSearchParams({
    f: 'image',
    bboxSR: '3857',
    imageSR: '3857',
    size: '256,256',
    format: 'png32',
    transparent: 'true',
  })
  if (Array.isArray(layer.visibleLayers)) params.set('layers', `show:${layer.visibleLayers.join(',')}`)
  const definitions = rows(layer.layers)
    .filter((x) => record(x.layerDefinition).definitionExpression)
    .map((x) => [x.id, record(x.layerDefinition).definitionExpression])
  if (definitions.length) params.set('layerDefs', JSON.stringify(Object.fromEntries(definitions)))
  if (layer.renderingRule) params.set('renderingRule', JSON.stringify(layer.renderingRule))
  return `${layer.url}/${image ? 'exportImage' : 'export'}?${params}&bbox={bbox-epsg-3857}`
}
export interface FeatureLayerPlan {
  id: string
  url: string
  where: string
  fields: string[]
  title: string
}
export interface NativeWebMap {
  style: StyleSpecification
  features: FeatureLayerPlan[]
  layers: ArcgisRecord[]
  initial: ArcgisRecord
  warnings: string[]
}
export type FetchJson = (url: string) => Promise<ArcgisRecord>
export const sourceLayerId = (id: unknown) => `editorial-source-${id}`
/** Normalize source definitions, never load the proprietary map runtime. */
export async function normalizeWebMap(
  document: ArcgisRecord,
  fetchJson: FetchJson,
  basemap?: StyleSpecification,
): Promise<NativeWebMap> {
  const style: StyleSpecification = basemap
    ? structuredClone(basemap)
    : {
        version: 8,
        sources: {},
        layers: [{ id: 'editorial-background', type: 'background', paint: { 'background-color': '#1d2224' } }],
      }
  const features: FeatureLayerPlan[] = [],
    warnings: string[] = []
  // Keep labels above thematic data, while retaining stable shared source IDs.
  const labels = basemap ? style.layers.filter((layer) => layer.type === 'symbol') : []
  if (basemap) style.layers = style.layers.filter((layer) => layer.type !== 'symbol')
  const base = basemap ? [] : rows(record(document.baseMap).baseMapLayers)
  const authored = [
    ...base.filter((x) => !x.isReference),
    ...rows(document.operationalLayers),
    ...base.filter((x) => x.isReference),
  ]
  for (const layer of authored) {
    const id = sourceLayerId(layer.id)
    try {
      const visibility = layer.visibility === false ? 'none' : 'visible'
      const opacity = typeof layer.opacity === 'number' ? layer.opacity : 1
      if (layer.layerType === 'VectorTileLayer') {
        const styleUrl = String(layer.styleUrl)
        const original = await fetchJson(styleUrl)
        if (typeof original.glyphs === 'string')
          style.glyphs = new URL(original.glyphs, styleUrl).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}')
        // These standard Esri basemaps have separate sprite sheets per authored layer.
        if (typeof original.sprite === 'string') {
          const sprites = Array.isArray(style.sprite) ? style.sprite : []
          style.sprite = [...sprites, { id, url: new URL(original.sprite, styleUrl).href }]
        }
        for (const [key, value] of Object.entries(record(original.sources))) {
          const source = record(value)
          const url = typeof source.url === 'string' ? new URL(source.url, styleUrl).href.replace(/\/$/, '') : undefined
          const metadata = url ? await fetchJson(`${url}?f=json`) : {}
          const lods = rows(record(metadata.tileInfo).lods).map((lod) => Number(lod.level))
          style.sources[`${id}-${key}`] = {
            type: 'vector',
            tiles: url ? [`${url}/tile/{z}/{y}/{x}.pbf`] : (source.tiles as string[]),
            minzoom: lods.length ? Math.min(...lods) : Number(source.minzoom ?? 0),
            maxzoom: lods.length ? Math.max(...lods) : Number(source.maxzoom ?? 14),
            attribution: String(metadata.copyrightText || 'Esri, HERE, Garmin, © OpenStreetMap contributors'),
          }
        }
        for (const raw of rows(original.layers)) {
          const item = structuredClone(raw)
          item.id = `${id}-${item.id}`
          if (typeof item.source === 'string') item.source = `${id}-${item.source}`
          const layout = record(item.layout)
          if (typeof layout['icon-image'] === 'string') layout['icon-image'] = `${id}:${layout['icon-image']}`
          const paint = record(item.paint)
          for (const property of ['fill-pattern', 'line-pattern'])
            if (typeof paint[property] === 'string') paint[property] = `${id}:${paint[property]}`
          item.paint = paint
          item.layout = { ...layout, visibility: visibility === 'none' ? 'none' : (layout.visibility ?? 'visible') }
          // A reference style's background must not cover the operational layers.
          if (layer.isReference && item.type === 'background') continue
          style.layers.push(item as unknown as LayerSpecification)
        }
        continue
      }
      if (typeof layer.url !== 'string') throw new Error('Missing original service URL')
      const metadata = await fetchJson(`${layer.url}?f=json`)
      const minzoom = Number(layer.minScale) > 0 ? scaleToZoom(Number(layer.minScale)) : 0
      const maxzoom = Number(layer.maxScale) > 0 ? scaleToZoom(Number(layer.maxScale)) : 24
      if (layer.layerType === 'ArcGISFeatureLayer') {
        if (metadata.geometryType !== 'esriGeometryPolygon')
          throw new Error(`Unsupported original feature geometry: ${metadata.geometryType}`)
        const definition = record(layer.layerDefinition)
        const renderer = record(record(definition.drawingInfo).renderer ?? record(metadata.drawingInfo).renderer)
        const paint = rendererColor(renderer)
        features.push({
          id,
          url: layer.url,
          where: String(definition.definitionExpression || '1=1'),
          fields: [
            String(metadata.objectIdField || 'OBJECTID'),
            String(renderer.field1 ?? renderer.field ?? ''),
          ].filter(Boolean),
          title: String(layer.title ?? 'Original features'),
        })
        style.sources[id] = {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          attribution: String(metadata.copyrightText || layer.title || 'Original map data provider'),
        }
        style.layers.push({
          id,
          source: id,
          type: 'fill',
          minzoom,
          maxzoom,
          layout: { visibility },
          paint: { 'fill-color': paint, 'fill-opacity': opacity },
        })
      } else if (
        [
          'ArcGISTiledMapServiceLayer',
          'ArcGISMapServiceLayer',
          'ArcGISTiledImageServiceLayer',
          'ArcGISImageServiceLayer',
        ].includes(String(layer.layerType))
      ) {
        const tileInfo = record(metadata.tileInfo)
        const sr = record(tileInfo.spatialReference)
        const tiled =
          layer.layerType === 'ArcGISTiledMapServiceLayer' &&
          [3857, 102100, 102113].includes(Number(sr.latestWkid ?? sr.wkid))
        const extent = geographicExtent(metadata.fullExtent)
        const bounds = extent
          ? ([
              Math.max(-180, extent[0][0]),
              Math.max(-85.051129, extent[0][1]),
              Math.min(180, extent[1][0]),
              Math.min(85.051129, extent[1][1]),
            ] as [number, number, number, number])
          : undefined
        const lods = rows(tileInfo.lods).map((lod) => Number(lod.level))
        style.sources[id] = {
          type: 'raster',
          tiles: [tiled ? `${layer.url}/tile/{z}/{y}/{x}?blankTile=true` : exportTileUrl(layer)],
          tileSize: tiled ? Number(tileInfo.cols || 256) : 256,
          ...(tiled && lods.length ? { minzoom: Math.min(...lods), maxzoom: Math.max(...lods) } : {}),
          ...(bounds ? { bounds } : {}),
          attribution: String(metadata.copyrightText || layer.title || 'Original map data provider'),
        }
        style.layers.push({
          id,
          type: 'raster',
          source: id,
          minzoom,
          maxzoom,
          layout: { visibility },
          paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 },
        })
      } else throw new Error(`Unsupported original layer type: ${layer.layerType}`)
    } catch (error) {
      warnings.push(
        `“${layer.title ?? layer.id}”: ${error instanceof Error ? error.message : 'Original source unavailable'}`,
      )
    }
  }
  style.layers.push(...labels)
  return { style, features, layers: authored, initial: record(document.initialState), warnings }
}

export function featureQueryUrl(
  plan: FeatureLayerPlan,
  bounds: [number, number, number, number],
  offset: number,
  resolution: number,
) {
  const query = new URLSearchParams({
    f: 'geojson',
    where: plan.where,
    geometry: bounds.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outSR: '4326',
    outFields: plan.fields.join(','),
    returnGeometry: 'true',
    geometryPrecision: '6',
    maxAllowableOffset: String(resolution),
    resultOffset: String(offset),
    resultRecordCount: '2000',
    orderByFields: plan.fields[0],
  })
  return `${plan.url}/query?${query}`
}
