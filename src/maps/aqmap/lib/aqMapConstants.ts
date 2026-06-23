import { FileImage, FileText } from 'lucide-react'
import { MAP_STYLES } from '@/components/ui/map-styles'
import type { AqBasemap } from './monitorPresentation'
import type { ExportFormat } from './exportMap'

export const URL_UPDATE_DELAY_MS = 350

// Reveal-mode clustering. Lower radius = clusters grab fewer monitors (more shown
// individually); lower maxZoom = clusters break apart sooner as you zoom in.
export const REVEAL_CLUSTER_DEFAULTS = {
  radius: 44,
  maxZoom: 8,
}

export const REVEAL_CLUSTER_BOUNDS = {
  radius: { min: 8, max: 60, step: 2 },
  maxZoom: { min: 4, max: 14, step: 1 },
}

export function clampRevealClusterRadius(value: number): number {
  const { min, max } = REVEAL_CLUSTER_BOUNDS.radius
  if (!Number.isFinite(value)) return REVEAL_CLUSTER_DEFAULTS.radius
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampRevealClusterMaxZoom(value: number): number {
  const { min, max } = REVEAL_CLUSTER_BOUNDS.maxZoom
  if (!Number.isFinite(value)) return REVEAL_CLUSTER_DEFAULTS.maxZoom
  return Math.min(max, Math.max(min, Math.round(value)))
}

export const FIRE_DANGER_VECTOR_URL = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=public:fdr_current_shp&outputFormat=application/json&srsName=EPSG:4326'
export const FIRE_PERIMETERS_VECTOR_URL = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=public:m3_polygons_current&outputFormat=application/json&srsName=EPSG:4326'
// Forecast-zone boundaries are static admin geography (the gov endpoint carries
// no live values — per-zone PM2.5 is computed locally from our monitors), so we
// serve a slimmed same-origin snapshot built by `npm run aqmap:forecast-zones`
// instead of pulling ~4.6 MB from the slow api.weather.gc.ca on every visit. The
// remote URL stays as a runtime fallback if the snapshot is ever missing.
export const FORECAST_ZONES_LOCAL_URL = '/data/aqmap/forecast-zones.geojson'
export const FORECAST_ZONES_VECTOR_URL = 'https://api.weather.gc.ca/collections/public-standard-forecast-zones/items?f=json&limit=10000'

const ACTIVE_FIRES_WFS_BASE = 'https://geoserver.cwfif.nrcan.gc.ca/geoserver/wfs'

/**
 * Active fire hotspots reported in the last 24 h, fetched straight from the
 * CWFIF WFS. The endpoint sends `access-control-allow-origin: *`, so the browser
 * can load it directly in production — mirroring how the fire-perimeter and
 * fire-danger vector layers work (no dev-only proxy needed).
 */
export function getActiveFiresVectorUrl(): string {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.0.0',
    request: 'GetFeature',
    typeName: 'public:cwfif_national_activefires',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    CQL_FILTER: `record_start >= ${cutoff}`,
  })
  return `${ACTIVE_FIRES_WFS_BASE}?${params.toString()}`
}

export const FIRE_DANGER_FILL_COLORS: Record<number, string> = {
  0: '#0000FF',
  1: '#00E000',
  2: '#FFFF00',
  3: '#E0A000',
  4: '#FF0000',
}

// Representative AQHI+ colours per risk category (see lib/aqhiScale.ts).
export const AQHI_STOPS: Array<{ color: string; labelKey: string; rangeKey: string }> = [
  { color: '#189aca', labelKey: 'aqhi.low', rangeKey: 'aqhi.range.low' },
  { color: '#ffcc2e', labelKey: 'aqhi.moderate', rangeKey: 'aqhi.range.moderate' },
  { color: '#ff3b3b', labelKey: 'aqhi.high', rangeKey: 'aqhi.range.high' },
  { color: '#650205', labelKey: 'aqhi.veryHigh', rangeKey: 'aqhi.range.veryHigh' },
]

export const EXPORT_OPTIONS: Array<{ format: ExportFormat; labelKey: string; icon: typeof FileImage }> = [
  { format: 'png', labelKey: 'export.png', icon: FileImage },
  { format: 'pngOverlay', labelKey: 'export.pngWithOverlays', icon: FileImage },
  { format: 'jpeg', labelKey: 'export.jpeg', icon: FileImage },
  { format: 'pdf', labelKey: 'export.pdf', icon: FileText },
]

export const BASEMAP_STYLES: Record<AqBasemap, { light: string; dark: string }> = {
  light: {
    light: MAP_STYLES.light,
    dark: MAP_STYLES.light,
  },
  topographic: {
    light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    dark: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  },
  dark: {
    light: MAP_STYLES.dark,
    dark: MAP_STYLES.dark,
  },
}
