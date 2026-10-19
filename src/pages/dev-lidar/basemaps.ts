import type { LayerSpecification, Map, SourceSpecification, StyleSpecification } from 'maplibre-gl'

export type Basemap = 'vector' | 'satellite' | 'none'
export const VECTOR_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
export const SATELLITE_SERVICE = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
export const SATELLITE_TILES = `${SATELLITE_SERVICE}/tile/{z}/{y}/{x}`
export const LABEL_ANCHOR = 'basemap-label-anchor'
export const SATELLITE_LAYER = 'basemap-satellite'

export function initialLidarStyle(basemap: Basemap): StyleSpecification {
  return {
    version: 8,
    sources: {
      [SATELLITE_LAYER]: {
        type: 'raster',
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Tiles © Esri — Esri, Vantor, Earthstar Geographics, and the GIS User Community',
      },
    },
    layers: [
      { id: 'context-background', type: 'background', paint: { 'background-color': '#e8eeeb' } },
      {
        id: SATELLITE_LAYER,
        type: 'raster',
        source: SATELLITE_LAYER,
        layout: { visibility: basemap === 'satellite' ? 'visible' : 'none' },
        paint: { 'raster-fade-duration': 0 },
      },
      { id: LABEL_ANCHOR, type: 'background', paint: { 'background-opacity': 0 } },
    ],
  }
}

/** Retain only real vector sources; namespace provider IDs away from analysis layers. */
export function prepareVectorContext(style: StyleSpecification) {
  if (style.version !== 8 || !Array.isArray(style.layers) || !style.sources) throw Error('Invalid vector basemap style')
  const sources: Record<string, SourceSpecification> = {}
  for (const [id, source] of Object.entries(style.sources))
    if (source.type === 'vector') sources[`basemap-vector-${id}`] = source
  if (!Object.keys(sources).length) throw Error('The basemap has no vector tile source')
  const layers: LayerSpecification[] = []
  for (const layer of style.layers) {
    if ('source' in layer && (typeof layer.source !== 'string' || !sources[`basemap-vector-${layer.source}`])) continue
    if (layer.type === 'raster') continue
    layers.push({
      ...layer,
      id: `basemap-vector-${layer.id}`,
      ...('source' in layer ? { source: `basemap-vector-${layer.source}` } : {}),
    } as LayerSpecification)
  }
  return { sources, layers, glyphs: style.glyphs, sprite: typeof style.sprite === 'string' ? style.sprite : undefined }
}

export function installVectorContext(
  map: Pick<Map, 'setGlyphs' | 'setSprite' | 'getSource' | 'getLayer' | 'addSource' | 'addLayer'>,
  context: ReturnType<typeof prepareVectorContext>,
) {
  if (context.glyphs) map.setGlyphs(context.glyphs)
  if (context.sprite) map.setSprite(context.sprite)
  for (const [id, source] of Object.entries(context.sources)) if (!map.getSource(id)) map.addSource(id, source)
  for (const layer of context.layers)
    if (!map.getLayer(layer.id)) map.addLayer(layer, layer.type === 'symbol' ? LABEL_ANCHOR : 'analysis-height')
}

/** Change context visibility in place: never replace the style or unload LiDAR layers. */
export function applyBasemap(
  map: Pick<Map, 'setLayoutProperty' | 'setPaintProperty'>,
  layers: LayerSpecification[],
  basemap: Basemap,
  labels = true,
) {
  map.setLayoutProperty(SATELLITE_LAYER, 'visibility', basemap === 'satellite' ? 'visible' : 'none')
  for (const layer of layers) {
    const visible = layer.type === 'symbol' ? labels && basemap !== 'none' : basemap === 'vector'
    map.setLayoutProperty(layer.id, 'visibility', visible ? (layer.layout?.visibility ?? 'visible') : 'none')
    if (layer.type === 'symbol') {
      map.setPaintProperty(layer.id, 'text-color', basemap === 'satellite' ? '#f8fafc' : layer.paint?.['text-color'])
      map.setPaintProperty(
        layer.id,
        'text-halo-color',
        basemap === 'satellite' ? '#17202b' : layer.paint?.['text-halo-color'],
      )
      map.setPaintProperty(
        layer.id,
        'text-halo-width',
        basemap === 'satellite' ? 1.4 : layer.paint?.['text-halo-width'],
      )
    }
  }
}

export interface ImageryCitation {
  source: string
  date: string | null
  resolution: number | null
  minLevel: number
  maxLevel: number
}

export function imageryCitationUrl(longitude: number, latitude: number) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: `${longitude},${latitude}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'SRC_DATE,SRC_RES,NICE_DESC,NICE_NAME,MinMapLevel,MaxMapLevel',
    returnGeometry: 'false',
  })
  return `${SATELLITE_SERVICE}/4/query?${params}`
}

export function parseImageryCitations(data: unknown): ImageryCitation[] {
  const value = data as { error?: unknown; features?: { attributes: Record<string, unknown> }[] }
  if (value?.error || !Array.isArray(value?.features)) throw Error('Imagery metadata unavailable')
  return value.features.map(({ attributes: a }) => {
    const raw = String(a.SRC_DATE ?? '')
    const candidate = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : null
    const date =
      candidate &&
      Number.isFinite(Date.parse(candidate)) &&
      new Date(candidate).toISOString().slice(0, 10) === candidate
        ? candidate
        : null
    return {
      source: String(a.NICE_DESC || a.NICE_NAME || 'Unknown source'),
      date,
      resolution: typeof a.SRC_RES === 'number' && a.SRC_RES > 0 ? a.SRC_RES : null,
      minLevel: typeof a.MinMapLevel === 'number' ? a.MinMapLevel : 0,
      maxLevel: typeof a.MaxMapLevel === 'number' ? a.MaxMapLevel : 24,
    }
  })
}
