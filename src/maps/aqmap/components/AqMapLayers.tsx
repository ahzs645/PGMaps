import { useEffect, useMemo, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { dispatchMobileMapFeatureClick } from '@/components/ui/map-context'
import type { AirMonitor } from '@/maps/airquality'
import { getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import maplibregl from 'maplibre-gl'
import type { SmokeLayerDefinition } from '../lib/smokeLayers'
import type { WmsLayerDefinition } from '../lib/wmsLayers'
import type { AqMonitorGroup, AqNetworkSlug } from '../lib/monitorPresentation'
import { getAqmapNetworkSlug, getMonitorGroup, monitorKey } from '../lib/monitorPresentation'
import { formatGroupLabel } from '../lib/i18n'
import { getAqmapMarkerIcon, getAqmapMarkerSortKey } from '../lib/markerIcons'
import { getAqhiPlusColor } from '../lib/aqhiScale'
import { getClusterCircleColor, getClusterCircleRadius, getClusterStrokeColor } from '../lib/clusterColors'
import {
  ACTIVE_FIRES_VECTOR_URL,
  FIRE_DANGER_FILL_COLORS,
  FIRE_DANGER_VECTOR_URL,
  FIRE_PERIMETERS_VECTOR_URL,
  FORECAST_ZONES_VECTOR_URL,
} from '../lib/aqMapConstants'
import type {
  ActiveFireFeatureProperties,
  AqClusterColorScheme,
  AqMonitorIconMode,
  FireDangerFeatureProperties,
  FirePerimeterFeatureProperties,
  ForecastZoneFeatureProperties,
} from '../lib/aqMapTypes'

interface AqMapFeatureProperties {
  key: string
  id: string
  name: string
  network: string
  group: AqMonitorGroup
  groupLabel: string
  city: string
  province: string
  status: string
  pm25: number | null
  aqhi: number | null
  color: string
  markerText: string
  iconId: string
  iconSize: number
  zIndex: number
  online: boolean
}

type AsciiGrid = {
  ncols: number
  nrows: number
  xllcorner: number
  yllcorner: number
  dx: number
  dy: number
  nodata: number | null
  values: number[][]
}

const PM25_WCS_BOUNDS = {
  west: -176.842409132,
  south: 16.149189226,
  east: -18.825681315,
  north: 80.210751469,
}

const PM25_VECTOR_COLORS = [
  { value: 0, color: '#21c5f4' },
  { value: 10, color: '#1899c9' },
  { value: 20, color: '#0d6796' },
  { value: 30, color: '#fefc37' },
  { value: 40, color: '#fecb2e' },
  { value: 50, color: '#fd993f' },
  { value: 60, color: '#fc6769' },
  { value: 70, color: '#fe3b3b' },
  { value: 80, color: '#fe0101' },
  { value: 90, color: '#ca0713' },
  { value: 100, color: '#650205' },
] as const

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildPm25WcsGridUrl(bounds: maplibregl.LngLatBounds) {
  const west = Math.max(PM25_WCS_BOUNDS.west, bounds.getWest())
  const east = Math.min(PM25_WCS_BOUNDS.east, bounds.getEast())
  const south = Math.max(PM25_WCS_BOUNDS.south, bounds.getSouth())
  const north = Math.min(PM25_WCS_BOUNDS.north, bounds.getNorth())
  if (west >= east || south >= north) return null

  const params = new URLSearchParams({
    SERVICE: 'WCS',
    REQUEST: 'GetCoverage',
    VERSION: '2.0.1',
    COVERAGEID: 'RAQDPS.SFC_PM2.5',
    FORMAT: 'image/x-aaigrid',
  })
  params.append('SUBSET', `long(${west.toFixed(6)},${east.toFixed(6)})`)
  params.append('SUBSET', `lat(${south.toFixed(6)},${north.toFixed(6)})`)

  return `https://geo.weather.gc.ca/geomet?${params.toString()}`
}

function extractAsciiGridPart(payload: string) {
  const start = payload.search(/\bncols\s+/i)
  if (start === -1) throw new Error('WCS response did not include an ASCII grid part.')

  const rest = payload.slice(start)
  const nextBoundary = rest.search(/\r?\n--wcs\b/i)
  return (nextBoundary === -1 ? rest : rest.slice(0, nextBoundary)).trim()
}

function parseAsciiGrid(payload: string): AsciiGrid {
  const lines = extractAsciiGridPart(payload)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const header = new Map<string, number>()
  let dataStartIndex = 0

  for (const [index, line] of lines.entries()) {
    const [rawKey, rawValue] = line.split(/\s+/, 2)
    const key = rawKey.toLowerCase()
    const value = Number(rawValue)
    if (!Number.isFinite(value) || !['ncols', 'nrows', 'xllcorner', 'yllcorner', 'dx', 'dy', 'cellsize', 'nodata_value'].includes(key)) {
      dataStartIndex = index
      break
    }
    header.set(key, value)
  }

  const ncols = header.get('ncols')
  const nrows = header.get('nrows')
  const xllcorner = header.get('xllcorner')
  const yllcorner = header.get('yllcorner')
  const dx = header.get('dx') ?? header.get('cellsize')
  const dy = header.get('dy') ?? header.get('cellsize')
  if (ncols === undefined || nrows === undefined || xllcorner === undefined || yllcorner === undefined || dx === undefined || dy === undefined) {
    throw new Error('WCS ASCII grid header is missing required fields.')
  }

  return {
    ncols,
    nrows,
    xllcorner,
    yllcorner,
    dx,
    dy,
    nodata: header.get('nodata_value') ?? null,
    values: lines.slice(dataStartIndex, dataStartIndex + nrows).map((line) => line.split(/\s+/).slice(0, ncols).map(Number)),
  }
}

function pm25Color(value: number) {
  return [...PM25_VECTOR_COLORS].reverse().find((stop) => value >= stop.value)?.color ?? PM25_VECTOR_COLORS[0].color
}

function pm25VectorStride(grid: AsciiGrid, zoom: number) {
  if (zoom < 4) return Math.max(4, Math.ceil(Math.sqrt((grid.ncols * grid.nrows) / 12000)))
  if (zoom < 5.5) return Math.max(3, Math.ceil(Math.sqrt((grid.ncols * grid.nrows) / 16000)))
  if (zoom < 7) return Math.max(2, Math.ceil(Math.sqrt((grid.ncols * grid.nrows) / 22000)))
  if (zoom < 8.5) return 2
  return 1
}

function pm25GridToFeatures(grid: AsciiGrid, zoom: number): GeoJSON.FeatureCollection {
  const stride = pm25VectorStride(grid, zoom)
  const features: GeoJSON.Feature[] = []

  for (let row = 0; row < grid.nrows; row += stride) {
    for (let col = 0; col < grid.ncols; col += stride) {
      const rawValue = grid.values[row]?.[col]
      if (!Number.isFinite(rawValue)) continue
      if (grid.nodata !== null && rawValue === grid.nodata) continue

      const pm25 = rawValue * 1_000_000_000
      if (!Number.isFinite(pm25) || pm25 < 0.25) continue

      const west = grid.xllcorner + col * grid.dx
      const east = grid.xllcorner + Math.min(col + stride, grid.ncols) * grid.dx
      const north = grid.yllcorner + (grid.nrows - row) * grid.dy
      const south = grid.yllcorner + Math.max(grid.nrows - row - stride, 0) * grid.dy

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ]],
        },
        properties: {
          pm25: Number(pm25.toFixed(2)),
          fill: pm25Color(pm25),
        },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

function formatForecastZoneTooltip(properties: ForecastZoneFeatureProperties): string {
  const name = escapeHtml(String(properties.NAME ?? properties.NOM ?? 'Forecast zone'))

  return `
    <div class="text-xs">
      <div class="tooltip_title font-semibold text-foreground">${name}</div>
    </div>
  `
}

function pointInRing(lng: number, lat: number, ring: GeoJSON.Position[]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = Number(ring[index][0])
    const yi = Number(ring[index][1])
    const xj = Number(ring[previous][0])
    const yj = Number(ring[previous][1])
    const intersects = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function pointInPolygonCoordinates(lng: number, lat: number, rings: GeoJSON.Position[][]): boolean {
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false
  return !rings.slice(1).some((hole) => pointInRing(lng, lat, hole))
}

function monitorInForecastZone(
  monitor: AirMonitor,
  zone: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>,
): boolean {
  const { longitude, latitude } = monitor
  if (zone.geometry.type === 'Polygon') {
    return pointInPolygonCoordinates(longitude, latitude, zone.geometry.coordinates)
  }
  return zone.geometry.coordinates.some((polygon) => pointInPolygonCoordinates(longitude, latitude, polygon))
}

function getForecastZoneName(properties: ForecastZoneFeatureProperties): string {
  return String(properties.NAME ?? properties.NOM ?? 'Forecast zone').trim() || 'Forecast zone'
}

function getForecastZoneMonitorGroup(monitor: AirMonitor): 'FEM' | 'PA' | 'EGG' | null {
  if (monitor.network === 'FEM' || monitor.network === 'BC ENV') return 'FEM'
  if (monitor.network === 'PA') return 'PA'
  if (monitor.network === 'EGG') return 'EGG'
  return null
}

function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!valid.length) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function formatMean(value: number | null): string {
  return value === null ? '-' : value.toFixed(1)
}

function getForecastZonePm25(
  zone: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>,
  monitors: AirMonitor[],
): number | null {
  return mean(
    monitors
      .filter((monitor) => monitorInForecastZone(monitor, zone))
      .map((monitor) => getMonitorAqhiPm25(monitor)),
  )
}

function styleForecastZoneData(
  collection: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>,
  monitors: AirMonitor[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties & { fillColor: string; pm25: number | null }> {
  return {
    ...collection,
    features: collection.features.map((feature) => {
      const pm25 = getForecastZonePm25(feature, monitors)
      return {
        ...feature,
        properties: {
          ...feature.properties,
          pm25,
          fillColor: getAqhiPlusColor(pm25),
        },
      }
    }),
  }
}

function formatForecastZoneSummaryPopup(
  zone: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>,
  monitors: AirMonitor[],
): string {
  const zoneMonitors = monitors.filter((monitor) => monitorInForecastZone(monitor, zone))
  const columns = ['FEM', 'PA', 'EGG', 'ALL'] as const
  const grouped = {
    FEM: zoneMonitors.filter((monitor) => getForecastZoneMonitorGroup(monitor) === 'FEM'),
    PA: zoneMonitors.filter((monitor) => getForecastZoneMonitorGroup(monitor) === 'PA'),
    EGG: zoneMonitors.filter((monitor) => getForecastZoneMonitorGroup(monitor) === 'EGG'),
    ALL: zoneMonitors,
  }
  const rowClass = 'border-t border-gray-200'
  const headerCellClass = 'px-2 py-1 text-right font-semibold text-gray-900'
  const labelCellClass = 'whitespace-nowrap py-1 pr-3 text-gray-600'
  const valueCellClass = 'px-2 py-1 text-right font-medium tabular-nums text-gray-900'

  return `
    <div class="text-xs text-gray-700">
      <div class="font-semibold text-gray-900">Forecast Zone: ${escapeHtml(getForecastZoneName(zone.properties))}</div>
      <table class="mt-2 w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th class="${labelCellClass}"></th>
            ${columns.map((column) => `<th class="${headerCellClass}">${column}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          <tr class="${rowClass}">
            <td class="${labelCellClass}"># of Monitors</td>
            ${columns.map((column) => `<td class="${valueCellClass}">${grouped[column].length}</td>`).join('')}
          </tr>
          <tr class="${rowClass}">
            <td class="${labelCellClass}">1hr PM2.5 (&mu;g m<sup>-3</sup>)</td>
            ${columns.map((column) => `<td class="${valueCellClass}">${formatMean(mean(grouped[column].map((monitor) => monitor.pm25OneHour)))}</td>`).join('')}
          </tr>
          <tr class="${rowClass}">
            <td class="${labelCellClass}">24hr PM2.5 (&mu;g m<sup>-3</sup>)</td>
            ${columns.map((column) => `<td class="${valueCellClass}">${formatMean(mean(grouped[column].map((monitor) => monitor.pm25TwentyFourHour)))}</td>`).join('')}
          </tr>
        </tbody>
      </table>
    </div>
  `
}

function getFirstMonitorLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.id.startsWith('aqmap-monitor-'))?.id
}

export function WmsRasterLayer({
  definition,
  visible,
}: {
  definition: WmsLayerDefinition
  visible: boolean
}) {
  const { map, isLoaded } = useMap()
  const sourceId = `aqmap-wms-source-${definition.key}`
  const layerId = `aqmap-wms-layer-${definition.key}`

  useEffect(() => {
    if (!isLoaded || !map || !visible) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'raster',
        tiles: definition.tiles,
        tileSize: definition.tileSize ?? 256,
        minzoom: definition.minzoom ?? 0,
        // Cap source zoom so MapLibre overzooms (scales) the top tiles rather than
        // issuing 4x as many WMS GetMap requests per level for data with no finer
        // detail. Default 22 preserves prior behaviour for layers that don't set it.
        maxzoom: definition.maxzoom ?? 22,
        attribution: definition.attribution,
      })
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': definition.opacity,
          'raster-resampling': definition.resampling ?? 'linear',
        },
      })
    }

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [definition, isLoaded, layerId, map, sourceId, visible])

  return null
}

export function ModelledPm25VectorLayer({ visible }: { visible: boolean }) {
  const { map, isLoaded } = useMap()
  const sourceId = 'aqmap-modelled-pm25-vector-source'
  const fillLayerId = 'aqmap-modelled-pm25-vector-fill'

  useEffect(() => {
    if (!isLoaded || !map || !visible) return

    let aborted = false
    let controller: AbortController | null = null

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['coalesce', ['get', 'fill'], '#21c5f4'],
          'fill-opacity': 0.5,
        },
      })
    }

    async function updateGrid() {
      if (!map) return
      controller?.abort()
      controller = new AbortController()
      const url = buildPm25WcsGridUrl(map.getBounds())
      if (!url) return

      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) return
        const grid = parseAsciiGrid(await response.text())
        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
        if (!aborted && source) {
          source.setData(pm25GridToFeatures(grid, map.getZoom()))
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Modelled PM2.5 vector WCS failed', error)
        }
      }
    }

    updateGrid()
    map.on('moveend', updateGrid)
    map.on('zoomend', updateGrid)

    return () => {
      aborted = true
      controller?.abort()
      map.off('moveend', updateGrid)
      map.off('zoomend', updateGrid)
      try {
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [fillLayerId, isLoaded, map, sourceId, visible])

  return null
}

export function ActiveFiresVectorLayer({ visible }: { visible: boolean }) {
  const { map, isLoaded } = useMap()
  const sourceId = 'aqmap-active-fires-vector-source'
  const haloLayerId = 'aqmap-active-fires-vector-halo'
  const pointLayerId = 'aqmap-active-fires-vector-point'
  const [data, setData] = useState<GeoJSON.FeatureCollection<GeoJSON.Point, ActiveFireFeatureProperties> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible || data || error) return
    const controller = new AbortController()

    fetch(ACTIVE_FIRES_VECTOR_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load active fire hotspots: ${response.status}`)
        return response.json()
      })
      .then((payload) => setData(payload as GeoJSON.FeatureCollection<GeoJSON.Point, ActiveFireFeatureProperties>))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.error('Active fires vector layer failed', err)
          setError((err as Error).message)
        }
      })

    return () => controller.abort()
  }, [data, error, visible])

  useEffect(() => {
    if (!isLoaded || !map || !visible || !data) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data,
      })
    }

    if (!map.getLayer(haloLayerId)) {
      map.addLayer({
        id: haloLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': [
            'match',
            ['get', 'stage_of_control_status'],
            'OC',
            '#ef4444',
            'BH',
            '#facc15',
            'UC',
            '#0ea5e9',
            'MON',
            '#d946ef',
            'M',
            '#d946ef',
            'UM',
            '#d946ef',
            '#ef4444',
          ],
          'circle-opacity': 0.16,
          'circle-radius': [
            'step',
            ['coalesce', ['to-number', ['get', 'fire_size']], 0],
            7,
            100,
            11,
            1000,
            17,
          ],
        },
      })
    }

    if (!map.getLayer(pointLayerId)) {
      map.addLayer({
        id: pointLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-color': [
            'match',
            ['get', 'stage_of_control_status'],
            'OC',
            '#ef4444',
            'BH',
            '#facc15',
            'UC',
            '#0ea5e9',
            'MON',
            '#d946ef',
            'M',
            '#d946ef',
            'UM',
            '#d946ef',
            '#ef4444',
          ],
          'circle-radius': [
            'step',
            ['coalesce', ['to-number', ['get', 'fire_size']], 0],
            3.5,
            100,
            5.5,
            1000,
            8,
          ],
          'circle-stroke-color': '#111827',
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2,
            0.8,
            8,
            1.4,
          ],
        },
      })
    }

    return () => {
      try {
        if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId)
        if (map.getLayer(haloLayerId)) map.removeLayer(haloLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [data, haloLayerId, isLoaded, map, pointLayerId, sourceId, visible])

  return null
}

export function FireDangerVectorLayer({ visible }: { visible: boolean }) {
  const { map, isLoaded } = useMap()
  const sourceId = 'aqmap-fire-danger-vector-source'
  const fillLayerId = 'aqmap-fire-danger-vector-fill'
  const lineLayerId = 'aqmap-fire-danger-vector-line'
  const [data, setData] = useState<GeoJSON.FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon, FireDangerFeatureProperties> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible || data || error) return
    const controller = new AbortController()

    fetch(FIRE_DANGER_VECTOR_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load fire danger polygons: ${response.status}`)
        return response.json()
      })
      .then((payload) => setData(payload as GeoJSON.FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon, FireDangerFeatureProperties>))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.error('Fire danger vector layer failed', err)
          setError((err as Error).message)
        }
      })

    return () => controller.abort()
  }, [data, error, visible])

  useEffect(() => {
    if (!isLoaded || !map || !visible || !data) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data,
      })
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': [
            'match',
            ['to-number', ['get', 'GRIDCODE']],
            0,
            FIRE_DANGER_FILL_COLORS[0],
            1,
            FIRE_DANGER_FILL_COLORS[1],
            2,
            FIRE_DANGER_FILL_COLORS[2],
            3,
            FIRE_DANGER_FILL_COLORS[3],
            4,
            FIRE_DANGER_FILL_COLORS[4],
            '#94a3b8',
          ],
          'fill-opacity': 0.48,
        },
      })
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': 'rgba(17, 24, 39, 0.35)',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2,
            0.2,
            7,
            0.8,
          ],
        },
      })
    }

    return () => {
      try {
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [data, fillLayerId, isLoaded, lineLayerId, map, sourceId, visible])

  return null
}

export function FirePerimetersVectorLayer({ visible }: { visible: boolean }) {
  const { map, isLoaded } = useMap()
  const sourceId = 'aqmap-fire-perimeters-vector-source'
  const fillLayerId = 'aqmap-fire-perimeters-vector-fill'
  const lineLayerId = 'aqmap-fire-perimeters-vector-line'
  const [data, setData] = useState<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, FirePerimeterFeatureProperties> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible || data || error) return
    const controller = new AbortController()

    fetch(FIRE_PERIMETERS_VECTOR_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load fire perimeter polygons: ${response.status}`)
        return response.json()
      })
      .then((payload) => setData(payload as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, FirePerimeterFeatureProperties>))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.error('Fire perimeter vector layer failed', err)
          setError((err as Error).message)
        }
      })

    return () => controller.abort()
  }, [data, error, visible])

  useEffect(() => {
    if (!isLoaded || !map || !visible || !data) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data,
      })
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#f7b4b4',
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2,
            0.55,
            8,
            0.65,
          ],
        },
      })
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#111111',
          'line-opacity': 1,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2,
            0.6,
            7,
            1.4,
            11,
            2.4,
          ],
        },
      })
    }

    return () => {
      try {
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [data, fillLayerId, isLoaded, lineLayerId, map, sourceId, visible])

  return null
}

export function ForecastZonesVectorLayer({
  visible,
  monitors,
  onZoneClick,
}: {
  visible: boolean
  monitors: AirMonitor[]
  onZoneClick?: () => void
}) {
  const { map, isLoaded } = useMap()
  const sourceId = 'aqmap-forecast-zones-vector-source'
  const fillLayerId = 'aqmap-forecast-zones-vector-fill'
  const lineLayerId = 'aqmap-forecast-zones-vector-line'
  const [data, setData] = useState<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const styledData = useMemo(() => data ? styleForecastZoneData(data, monitors) : null, [data, monitors])

  useEffect(() => {
    if (!visible || data || error) return
    const controller = new AbortController()

    fetch(FORECAST_ZONES_VECTOR_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load forecast zones: ${response.status}`)
        return response.json()
      })
      .then((payload) => {
        const collection = payload as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>
        setData(collection)
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.error('Forecast zones vector layer failed', err)
          setError((err as Error).message)
        }
      })

    return () => controller.abort()
  }, [data, error, visible])

  useEffect(() => {
    if (!isLoaded || !map || !visible || !styledData) return
    const beforeMonitorLayerId = getFirstMonitorLayerId(map)

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: styledData,
      })
    } else {
      const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
      source?.setData(styledData)
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['coalesce', ['get', 'fillColor'], '#bfdbfe'],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.58,
            0.34,
          ],
        },
      }, beforeMonitorLayerId)
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#2563eb',
          'line-opacity': 0.82,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2,
            0.7,
            7,
            1.3,
            11,
            2.2,
          ],
        },
      }, beforeMonitorLayerId)
    }

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'aqmap-tooltip pointer-events-none',
      maxWidth: '280px',
      offset: 12,
    })
    const clickPopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      className: 'aqmap-popup',
      maxWidth: '360px',
      offset: 12,
    })
    let hoveredId: string | number | null = null

    const getZoneFromEvent = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      if (!feature) return null
      const featureId = String(feature.properties?.FEATURE_ID ?? '')
      const clc = String(feature.properties?.CLC ?? '')
      return styledData.features.find((candidate) => (
        (featureId && candidate.properties?.FEATURE_ID === featureId)
        || (clc && candidate.properties?.CLC === clc)
      )) ?? null
    }

    const handleMouseMove = (event: maplibregl.MapLayerMouseEvent) => {
      const markerFeature = map
        .queryRenderedFeatures(event.point)
        .find((feature) => feature.layer.id.startsWith('aqmap-monitor-'))
      if (markerFeature) {
        map.getCanvas().style.cursor = 'pointer'
        if (hoveredId !== null) {
          map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false })
        }
        hoveredId = null
        popup.remove()
        return
      }

      const feature = event.features?.[0]
      if (!feature) return
      map.getCanvas().style.cursor = 'pointer'

      if (hoveredId !== null) {
        map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false })
      }

      hoveredId = feature.id ?? null
      if (hoveredId !== null) {
        map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: true })
      }

      popup
        .setLngLat(event.lngLat)
        .setHTML(formatForecastZoneTooltip(feature.properties as ForecastZoneFeatureProperties))
        .addTo(map)
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      if (hoveredId !== null) {
        map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false })
      }
      hoveredId = null
      popup.remove()
    }

    const handleClick = (event: maplibregl.MapLayerMouseEvent) => {
      const markerFeature = map
        .queryRenderedFeatures(event.point)
        .find((feature) => feature.layer.id.startsWith('aqmap-monitor-'))
      if (markerFeature) return

      const zone = getZoneFromEvent(event)
      if (!zone) return
      popup.remove()
      onZoneClick?.()
      clickPopup
        .setLngLat(event.lngLat)
        .setHTML(formatForecastZoneSummaryPopup(zone, monitors))
        .addTo(map)
    }

    map.on('click', fillLayerId, handleClick)
    map.on('mousemove', fillLayerId, handleMouseMove)
    map.on('mouseleave', fillLayerId, handleMouseLeave)

    return () => {
      try {
        map.off('click', fillLayerId, handleClick)
        map.off('mousemove', fillLayerId, handleMouseMove)
        map.off('mouseleave', fillLayerId, handleMouseLeave)
        popup.remove()
        clickPopup.remove()
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [fillLayerId, isLoaded, lineLayerId, map, monitors, onZoneClick, sourceId, styledData, visible])

  return null
}

export function SmokePolygonLayer({ definition, visible }: { definition: SmokeLayerDefinition; visible: boolean }) {
  const { map, isLoaded } = useMap()
  const sourceId = `aqmap-smoke-source-${definition.key}`
  const fillLayerId = `aqmap-smoke-fill-${definition.key}`
  const lineLayerId = `aqmap-smoke-line-${definition.key}`

  useEffect(() => {
    if (!isLoaded || !map || !visible) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: definition.data,
      })
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['coalesce', ['get', 'fill'], definition.fill],
          'fill-opacity': definition.opacity,
        },
      })
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['coalesce', ['get', 'fill'], definition.fill],
          'line-opacity': 0.65,
          'line-width': 1,
        },
      })
    }

    return () => {
      try {
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [definition, fillLayerId, isLoaded, lineLayerId, map, sourceId, visible])

  return null
}

function loadMapImage(map: maplibregl.Map, id: string, src: string): Promise<void> {
  if (map.hasImage(id)) return Promise.resolve()

  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      if (!map.hasImage(id)) map.addImage(id, image)
      resolve()
    }
    image.onerror = () => resolve()
    image.src = src
  })
}

export function AqMonitorLayer({
  monitors,
  visibleGroups,
  visibleNetworks,
  iconMode,
  clusterColorScheme,
  clusterRadius,
  clusterMaxZoom,
  tightClusters,
  onMonitorClick,
  onMonitorHover,
}: {
  monitors: AirMonitor[]
  visibleGroups: Set<AqMonitorGroup>
  /**
   * When provided, monitors are filtered by individual network slug
   * (agency/purpleair/aqegg/other) instead of by `visibleGroups`. Used by the
   * simplified /dev/aqmap/main page to toggle FEM/PA/EGG independently.
   */
  visibleNetworks?: Set<AqNetworkSlug>
  iconMode: AqMonitorIconMode
  clusterColorScheme: AqClusterColorScheme
  clusterRadius: number
  clusterMaxZoom: number
  tightClusters: boolean
  onMonitorClick: (monitor: AirMonitor) => void
  onMonitorHover: (monitor: AirMonitor | null) => void
}) {
  const { map, isLoaded } = useMap()
  const sourceId = `aqmap-monitor-source-${iconMode}`
  const offlineLayerId = `aqmap-monitor-offline-icon-${iconMode}`
  const onlineLayerId = `aqmap-monitor-online-icon-${iconMode}`
  const clusterLayerId = `aqmap-monitor-clusters-${iconMode}`
  const revealedLayerId = `aqmap-monitor-revealed-icon-${iconMode}`

  const features = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, AqMapFeatureProperties>>(() => {
    return {
      type: 'FeatureCollection',
      features: monitors
        .filter((monitor) => visibleNetworks
          ? visibleNetworks.has(getAqmapNetworkSlug(monitor))
          : visibleGroups.has(getMonitorGroup(monitor.network)))
        .map((monitor) => {
          const group = getMonitorGroup(monitor.network)
          const pm25 = getMonitorAqhiPm25(monitor)
          const icon = getAqmapMarkerIcon(monitor)
          return {
            type: 'Feature',
            properties: {
              key: monitorKey(monitor),
              id: monitor.id,
              name: monitor.name,
              network: monitor.network,
              group,
              groupLabel: formatGroupLabel(group, 'en'),
              city: monitor.city ?? '',
              province: monitor.province ?? '',
              status: monitor.status ?? '',
              pm25,
              aqhi: pm25,
              color: getAqhiPlusColor(pm25),
              markerText: '',
              iconId: icon.id,
              iconSize: icon.size,
              zIndex: getAqmapMarkerSortKey(monitor),
              online: pm25 !== null,
            },
            geometry: {
              type: 'Point',
              coordinates: [monitor.longitude, monitor.latitude],
            },
          }
        }),
    }
  }, [monitors, visibleGroups, visibleNetworks])

  useEffect(() => {
    if (!isLoaded || !map) return
    const currentMap = map
    let cancelled = false
    const pointLayers = iconMode === 'revealed' ? [revealedLayerId] : [onlineLayerId, offlineLayerId]

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const rendered = currentMap.queryRenderedFeatures(event.point, { layers: pointLayers })
      const feature = rendered[0]
      if (!feature) return

      const key = String(feature.properties?.key ?? '')
      const monitor = monitors.find((item) => monitorKey(item) === key)
      if (monitor) {
        event.preventDefault()
        event.originalEvent?.preventDefault()
        dispatchMobileMapFeatureClick()
        onMonitorClick(monitor)
      }
    }

    const handleMouseMove = (event: maplibregl.MapMouseEvent) => {
      currentMap.getCanvas().style.cursor = 'pointer'
      const rendered = currentMap.queryRenderedFeatures(event.point, { layers: pointLayers })
      const key = String(rendered[0]?.properties?.key ?? '')
      const monitor = monitors.find((item) => monitorKey(item) === key)
      onMonitorHover(monitor ?? null)
    }
    const handleMouseLeave = () => {
      currentMap.getCanvas().style.cursor = ''
      onMonitorHover(null)
    }
    const handleClusterClick = async (event: maplibregl.MapMouseEvent) => {
      const rendered = currentMap.queryRenderedFeatures(event.point, { layers: [clusterLayerId] })
      const feature = rendered[0]
      if (!feature) return

      event.preventDefault()
      event.originalEvent?.preventDefault()
      dispatchMobileMapFeatureClick()
      const clusterId = feature.properties?.cluster_id as number | undefined
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
      const source = currentMap.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
      if (clusterId === undefined || !source) return

      const zoom = await source.getClusterExpansionZoom(clusterId)
      currentMap.easeTo({
        center: coordinates,
        zoom,
        duration: 450,
      })
    }

    async function addLayer() {
      const iconMap = new Map(monitors.map((monitor) => {
        const icon = getAqmapMarkerIcon(monitor)
        return [icon.id, icon]
      }))

      await Promise.all(Array.from(iconMap.values()).map((icon) => loadMapImage(currentMap, icon.id, icon.src)))
      if (cancelled) return

      if (!currentMap.getSource(sourceId)) {
        currentMap.addSource(sourceId, {
          type: 'geojson',
          data: features,
          cluster: iconMode === 'revealed',
          clusterMaxZoom,
          clusterRadius,
        })
      }

      const addSymbolLayer = (layerId: string, online: boolean) => {
        if (currentMap.getLayer(layerId)) return
        currentMap.addLayer({
          id: layerId,
          type: 'symbol',
          source: sourceId,
          filter: ['==', ['get', 'online'], online],
          layout: {
            'icon-image': ['get', 'iconId'],
            'icon-size': 1,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'symbol-sort-key': ['get', 'zIndex'],
          },
        })
      }

      if (iconMode === 'revealed') {
        if (!currentMap.getLayer(clusterLayerId)) {
          currentMap.addLayer({
            id: clusterLayerId,
            type: 'circle',
            source: sourceId,
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': getClusterCircleColor(clusterColorScheme),
              'circle-radius': getClusterCircleRadius(clusterRadius, tightClusters),
              'circle-opacity': 0.86,
              'circle-stroke-color': getClusterStrokeColor(clusterColorScheme),
              'circle-stroke-width': 2,
            },
          })
        }

        if (!currentMap.getLayer(revealedLayerId)) {
          currentMap.addLayer({
            id: revealedLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['!', ['has', 'point_count']],
            layout: {
              'icon-image': ['get', 'iconId'],
              'icon-size': 1,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'symbol-sort-key': ['get', 'zIndex'],
            },
          })
        }
        currentMap.on('click', clusterLayerId, handleClusterClick)
        currentMap.on('mouseenter', clusterLayerId, handleMouseMove)
        currentMap.on('mouseleave', clusterLayerId, handleMouseLeave)
      } else {
        addSymbolLayer(offlineLayerId, false)
        addSymbolLayer(onlineLayerId, true)
      }

      pointLayers.forEach((layerId) => {
        currentMap.on('click', layerId, handleClick)
        currentMap.on('mousemove', layerId, handleMouseMove)
        currentMap.on('mouseleave', layerId, handleMouseLeave)
      })
    }

    void addLayer()

    return () => {
      cancelled = true
      try {
        currentMap.getCanvas().style.cursor = ''
        pointLayers.forEach((layerId) => {
          currentMap.off('click', layerId, handleClick)
          currentMap.off('mousemove', layerId, handleMouseMove)
          currentMap.off('mouseleave', layerId, handleMouseLeave)
        })
        currentMap.off('click', clusterLayerId, handleClusterClick)
        currentMap.off('mouseenter', clusterLayerId, handleMouseMove)
        currentMap.off('mouseleave', clusterLayerId, handleMouseLeave)
        if (currentMap.getLayer(clusterLayerId)) currentMap.removeLayer(clusterLayerId)
        if (currentMap.getLayer(revealedLayerId)) currentMap.removeLayer(revealedLayerId)
        if (currentMap.getLayer(onlineLayerId)) currentMap.removeLayer(onlineLayerId)
        if (currentMap.getLayer(offlineLayerId)) currentMap.removeLayer(offlineLayerId)
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [clusterLayerId, clusterColorScheme, clusterMaxZoom, clusterRadius, tightClusters, features, iconMode, isLoaded, map, monitors, offlineLayerId, onMonitorClick, onMonitorHover, onlineLayerId, revealedLayerId, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    source?.setData(features)
  }, [features, isLoaded, map, sourceId])

  return null
}
