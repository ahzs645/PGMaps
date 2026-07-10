import { useEffect, useMemo, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { dispatchMobileMapFeatureClick } from '@/components/ui/map-context'
import type { AirMonitor } from '@/maps/airquality'
import { getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import maplibregl from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { SmokeLayerDefinition } from '../lib/smokeLayers'
import type { WmsLayerDefinition } from '../lib/wmsLayers'
import {
  fetchGzipJson,
  PM25_NATIVE_VECTOR_URL,
} from '../lib/pm25Grid'
import type { AqMonitorGroup, AqNetworkSlug } from '../lib/monitorPresentation'
import { getAqmapNetworkSlug, getMonitorGroup, monitorKey } from '../lib/monitorPresentation'
import { formatGroupLabel } from '../lib/i18n'
import { getAqmapMarkerIcon, getAqmapMarkerSortKey } from '../lib/markerIcons'
import { AQHI_LEVELS, AQHI_NO_DATA_COLOR, getAqhiLevel, getAqhiPlusColor } from '../lib/aqhiScale'
import { getClusterCircleColor, getClusterCircleRadius, getClusterStrokeColor } from '../lib/clusterColors'
import {
  FIRE_DANGER_FILL_COLORS,
  FIRE_DANGER_VECTOR_URL,
  FIRE_PERIMETERS_VECTOR_URL,
  getActiveFiresVectorUrl,
} from '../lib/aqMapConstants'
import type {
  ActiveFireFeatureProperties,
  AqClusterColorScheme,
  AqMonitorIconMode,
  AqRingStyle,
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
  /** AQHI+ band index (0–10 levels, or the no-data band) for ring-mode clustering. */
  bandIndex: number
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

function buildForecastZonePm25ByCode(monitors: AirMonitor[]): Map<string, number | null> {
  const valuesByCode = new Map<string, number[]>()

  for (const monitor of monitors) {
    const zoneCode = String(monitor.forecastZoneCode ?? '').trim()
    if (!zoneCode) continue
    const pm25 = getMonitorAqhiPm25(monitor)
    if (pm25 === null) continue

    const values = valuesByCode.get(zoneCode)
    if (values) values.push(pm25)
    else valuesByCode.set(zoneCode, [pm25])
  }

  const meansByCode = new Map<string, number | null>()
  for (const [zoneCode, values] of valuesByCode) {
    meansByCode.set(zoneCode, mean(values))
  }
  return meansByCode
}

function styleForecastZoneData(
  collection: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>,
  monitors: AirMonitor[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties & { fillColor: string; hasPm25: boolean; pm25: number | null }> {
  const pm25ByCode = buildForecastZonePm25ByCode(monitors)

  return {
    ...collection,
    features: collection.features.map((feature) => {
      const zoneCode = String(feature.properties?.CLC ?? '').trim()
      const pm25 = zoneCode && pm25ByCode.has(zoneCode)
        ? pm25ByCode.get(zoneCode) ?? null
        : null
      return {
        ...feature,
        properties: {
          ...feature.properties,
          pm25,
          hasPm25: pm25 !== null,
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
  const zoneCode = String(zone.properties?.CLC ?? '').trim()
  const monitorsByCode = zoneCode
    ? monitors.filter((monitor) => monitor.forecastZoneCode === zoneCode)
    : []
  const zoneMonitors = monitorsByCode.length
    ? monitorsByCode
    : monitors.filter((monitor) => monitorInForecastZone(monitor, zone))
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
      <table class="mt-2 w-full border-collapse text-xs">
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

      try {
        const data = await fetchGzipJson<GeoJSON.FeatureCollection>(PM25_NATIVE_VECTOR_URL, controller.signal)
        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
        if (!aborted && source) source.setData(data)
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Modelled PM2.5 local vector snapshot failed', error)
        }
      }
    }

    updateGrid()

    return () => {
      aborted = true
      controller?.abort()
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

    fetch(getActiveFiresVectorUrl(), { signal: controller.signal })
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
  data,
  monitors,
  onZoneClick,
}: {
  visible: boolean
  data: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties> | null
  monitors: AirMonitor[]
  onZoneClick?: (
    zone: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>,
  ) => boolean | void
}) {
  const { map, isLoaded } = useMap()
  const sourceId = 'aqmap-forecast-zones-vector-source'
  const fillLayerId = 'aqmap-forecast-zones-vector-fill'
  const lineLayerId = 'aqmap-forecast-zones-vector-line'
  const styledData = useMemo(() => data ? styleForecastZoneData(data, monitors) : null, [data, monitors])

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
            ['boolean', ['get', 'hasPm25'], false],
            0.34,
            0.22,
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
          'line-color': '#64748b',
          'line-opacity': 0.9,
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
        (featureId && String(candidate.properties?.FEATURE_ID ?? '') === featureId)
        || (clc && String(candidate.properties?.CLC ?? '') === clc)
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
      event.preventDefault()
      event.originalEvent?.preventDefault()
      dispatchMobileMapFeatureClick()
      popup.remove()
      const handled = onZoneClick?.(zone)
      if (handled) {
        clickPopup.remove()
        return
      }
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

// ---------------------------------------------------------------------------
// Ring (pie-donut) monitor mode
//
// A cluster of monitors renders as an ArcGIS-style donut: one contiguous arc
// per AQHI+ colour band, sized by how many of the cluster's sensors currently
// read in that band, so the outer ring shows the colour split of 100% of the
// sensors beneath it. The arcs connect directly into a single smooth ring (no
// gaps or dividers), the hollow centre carries the total count, and individual
// (unclustered) monitors show as small solid AQHI-coloured dots, mirroring the
// legend's category symbols.
// ---------------------------------------------------------------------------

/** AQHI+ colours per band: the eleven levels, then the no-data band. */
const RING_BAND_COLORS: readonly string[] = [...AQHI_LEVELS.map((level) => level.color), AQHI_NO_DATA_COLOR]
const RING_NO_DATA_BAND = AQHI_LEVELS.length

/** Map a PM2.5 reading to its ring band index (no-data band when missing). */
function getRingBandIndex(pm25: number | null): number {
  const level = getAqhiLevel(pm25)
  if (!level) return RING_NO_DATA_BAND
  const index = AQHI_LEVELS.indexOf(level)
  return index >= 0 ? index : RING_NO_DATA_BAND
}

/** Per-band sensor tallies aggregated onto each MapLibre cluster feature. */
function buildRingClusterProperties(): Record<string, ExpressionSpecification> {
  const props: Record<string, ExpressionSpecification> = {}
  RING_BAND_COLORS.forEach((_, index) => {
    props[`band${index}`] = ['+', ['case', ['==', ['get', 'bandIndex'], index], 1, 0]]
  })
  return props
}

/**
 * SVG path for one wedge spanning [start, end] (fractions of the circle). A
 * donut wedge (r0 > 0) bridges the inner and outer arcs; a pie wedge (r0 <= 0)
 * sweeps straight from the centre point.
 */
function ringDonutSegment(start: number, end: number, r: number, r0: number, color: string): string {
  if (end - start >= 1) end -= 0.0001
  const a0 = 2 * Math.PI * (start - 0.25)
  const a1 = 2 * Math.PI * (end - 0.25)
  const x0 = Math.cos(a0)
  const y0 = Math.sin(a0)
  const x1 = Math.cos(a1)
  const y1 = Math.sin(a1)
  const largeArc = end - start > 0.5 ? 1 : 0
  // Stroke matches the fill so neighbouring band arcs seal together into one
  // continuous shape with no hairline seam showing the backing through.
  const d =
    r0 <= 0
      ? `M ${r} ${r} L ${r + r * x0} ${r + r * y0} ` +
        `A ${r} ${r} 0 ${largeArc} 1 ${r + r * x1} ${r + r * y1} Z`
      : `M ${r + r0 * x0} ${r + r0 * y0} L ${r + r * x0} ${r + r * y0} ` +
        `A ${r} ${r} 0 ${largeArc} 1 ${r + r * x1} ${r + r * y1} ` +
        `L ${r + r0 * x1} ${r + r0 * y1} A ${r0} ${r0} 0 ${largeArc} 0 ${r + r0 * x0} ${r + r0 * y0}`
  return `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="0.75" stroke-linejoin="round"/>`
}

/** Count text colours: dark slate for light backings, near-white for dark ones. */
const RING_COUNT_DARK = '#0f172a'
const RING_COUNT_LIGHT = '#f8fafc'

/** Perceived luminance test (ITU-R BT.601); true for light colours. */
function isLightHex(hex: string): boolean {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 140
}

/** Build the ring marker element for a cluster from its aggregated band counts. */
function createRingDonutElement(props: Record<string, unknown>, style: AqRingStyle, darkBasemap: boolean): HTMLDivElement {
  const counts = RING_BAND_COLORS.map((_, index) => Number(props[`band${index}`]) || 0)
  const total = Number(props.point_count) || counts.reduce((sum, count) => sum + count, 0)
  const r = total >= 250 ? 28 : total >= 100 ? 25 : total >= 50 ? 22 : total >= 25 ? 19 : total >= 10 ? 16 : 14
  const isPie = style.shape === 'pie'
  // A transparent centre only applies to a donut; a pie has no hole to see through.
  const transparentCenter = !isPie && style.center === 'transparent'
  const r0 = isPie ? 0 : Math.round(r * 0.62)
  const w = r * 2
  const fontSize = total >= 100 ? 13 : total >= 10 ? 12 : 11
  // One contiguous arc per colour band, sized by its share of the sensors, so
  // the whole ring connects into a single smooth shape.
  const n = Math.max(total, 1)
  const segments: string[] = []
  let placed = 0
  counts.forEach((count, band) => {
    if (count <= 0) return
    const start = placed / n
    const end = (placed + count) / n
    segments.push(ringDonutSegment(start, end, r, r0, RING_BAND_COLORS[band]))
    placed += count
  })
  const shadow = style.showShadow ? 'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45));' : ''
  const parts: string[] = [
    `<svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}" text-anchor="middle" ` +
      `style="display:block;font:700 ${fontSize}px system-ui,sans-serif;${shadow}">`,
  ]
  // White backing disc so the chart reads cleanly on any basemap (light/dark);
  // skipped for a transparent-centre donut so the hole truly shows the map.
  if (!transparentCenter) parts.push(`<circle cx="${r}" cy="${r}" r="${r}" fill="#ffffff"/>`)
  parts.push(segments.join(''))
  // Solid white hole only for a white-centre donut (pie has none; transparent skips it).
  if (!isPie && !transparentCenter) parts.push(`<circle cx="${r}" cy="${r}" r="${r0}" fill="#ffffff"/>`)
  if (style.showNumber) {
    // Keep the count legible against whatever sits behind it: the white hole
    // (always dark text), the basemap through a transparent hole (follow its
    // tone), or the dominant wedge colour on a pie.
    let countColor = RING_COUNT_DARK
    if (isPie) {
      let topBand = 0
      let topCount = -1
      counts.forEach((count, band) => {
        if (count > topCount) {
          topCount = count
          topBand = band
        }
      })
      countColor = isLightHex(RING_BAND_COLORS[topBand]) ? RING_COUNT_DARK : RING_COUNT_LIGHT
    } else if (transparentCenter) {
      countColor = darkBasemap ? RING_COUNT_LIGHT : RING_COUNT_DARK
    }
    parts.push(`<text x="${r}" y="${r}" dominant-baseline="central" fill="${countColor}">${total}</text>`)
  }
  parts.push('</svg>')
  const element = document.createElement('div')
  element.innerHTML = parts.join('')
  element.style.cursor = 'pointer'
  element.style.width = `${w}px`
  element.style.height = `${w}px`
  return element
}

export function AqMonitorLayer({
  monitors,
  visibleGroups,
  visibleNetworks,
  iconMode,
  ringStyle,
  darkBasemap,
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
  /** Ring-mode cluster appearance (shape / centre count / hole fill). */
  ringStyle: AqRingStyle
  /** Dark basemap in use — drives the adaptive count colour over a transparent hole. */
  darkBasemap: boolean
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
              bandIndex: getRingBandIndex(pm25),
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
    // Ring mode is rendered by its own effect (HTML donut markers + dot layer).
    if (iconMode === 'ring') return
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
    // Ring mode recreates its clustered source on data change, so skip the
    // generic setData path to avoid fighting over the same source.
    if (!isLoaded || !map || iconMode === 'ring') return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    source?.setData(features)
  }, [features, iconMode, isLoaded, map, sourceId])

  // Ring (pie-donut) mode: clusters become HTML donut markers, while individual
  // (unclustered) monitors render with the standard AQMap marker icons (value +
  // per-network shape) — the same symbol layer the 'aqmap' mode uses.
  useEffect(() => {
    if (!isLoaded || !map || iconMode !== 'ring') return
    const currentMap = map
    let cancelled = false
    const pointLayerId = 'aqmap-monitor-ring-point'
    const markers: Record<string, maplibregl.Marker> = {}
    let markersOnScreen: Record<string, maplibregl.Marker> = {}

    const handlePointClick = (event: maplibregl.MapMouseEvent) => {
      const rendered = currentMap.queryRenderedFeatures(event.point, { layers: [pointLayerId] })
      const key = String(rendered[0]?.properties?.key ?? '')
      const monitor = monitors.find((item) => monitorKey(item) === key)
      if (monitor) {
        event.preventDefault()
        event.originalEvent?.preventDefault()
        dispatchMobileMapFeatureClick()
        onMonitorClick(monitor)
      }
    }
    const handlePointMove = (event: maplibregl.MapMouseEvent) => {
      currentMap.getCanvas().style.cursor = 'pointer'
      const rendered = currentMap.queryRenderedFeatures(event.point, { layers: [pointLayerId] })
      const key = String(rendered[0]?.properties?.key ?? '')
      onMonitorHover(monitors.find((item) => monitorKey(item) === key) ?? null)
    }
    const handlePointLeave = () => {
      currentMap.getCanvas().style.cursor = ''
      onMonitorHover(null)
    }

    const updateMarkers = () => {
      const newMarkers: Record<string, maplibregl.Marker> = {}
      const sourceFeatures = currentMap.querySourceFeatures(sourceId)
      for (const feature of sourceFeatures) {
        const props = feature.properties as Record<string, unknown> | null
        if (!props || !props.cluster) continue
        const id = `cluster-${props.cluster_id}`
        let marker = markers[id]
        if (!marker) {
          const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
          const clusterId = props.cluster_id as number
          const element = createRingDonutElement(props, ringStyle, darkBasemap)
          element.addEventListener('click', (domEvent) => {
            domEvent.stopPropagation()
            const source = currentMap.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
            if (!source) return
            dispatchMobileMapFeatureClick()
            void source.getClusterExpansionZoom(clusterId).then((zoom) => {
              currentMap.easeTo({ center: coordinates, zoom, duration: 450 })
            })
          })
          marker = markers[id] = new maplibregl.Marker({ element }).setLngLat(coordinates)
        }
        newMarkers[id] = marker
        if (!markersOnScreen[id]) marker.addTo(currentMap)
      }
      for (const id of Object.keys(markersOnScreen)) {
        if (!newMarkers[id]) markersOnScreen[id].remove()
      }
      markersOnScreen = newMarkers
    }

    const handleRender = () => {
      if (cancelled || !currentMap.isSourceLoaded(sourceId)) return
      updateMarkers()
    }

    async function setup() {
      // Load the same per-monitor marker icons the AQMap mode uses for points.
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
          cluster: true,
          clusterMaxZoom,
          clusterRadius,
          clusterProperties: buildRingClusterProperties(),
        })
      }

      if (!currentMap.getLayer(pointLayerId)) {
        currentMap.addLayer({
          id: pointLayerId,
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

      currentMap.on('render', handleRender)
      currentMap.on('click', pointLayerId, handlePointClick)
      currentMap.on('mousemove', pointLayerId, handlePointMove)
      currentMap.on('mouseleave', pointLayerId, handlePointLeave)
      if (currentMap.isSourceLoaded(sourceId)) updateMarkers()
    }

    void setup()

    return () => {
      cancelled = true
      currentMap.off('render', handleRender)
      currentMap.off('click', pointLayerId, handlePointClick)
      currentMap.off('mousemove', pointLayerId, handlePointMove)
      currentMap.off('mouseleave', pointLayerId, handlePointLeave)
      Object.values(markersOnScreen).forEach((marker) => marker.remove())
      Object.values(markers).forEach((marker) => marker.remove())
      markersOnScreen = {}
      try {
        currentMap.getCanvas().style.cursor = ''
        if (currentMap.getLayer(pointLayerId)) currentMap.removeLayer(pointLayerId)
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [clusterMaxZoom, clusterRadius, darkBasemap, features, iconMode, isLoaded, map, monitors, onMonitorClick, onMonitorHover, ringStyle, sourceId])

  return null
}
