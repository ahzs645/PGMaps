import { useEffect, useMemo, useState } from 'react'
import { useMap } from '@/components/ui/map'
import type { AirMonitor } from '@/maps/airquality'
import { getAqhiColor, getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import maplibregl from 'maplibre-gl'
import type { SmokeLayerDefinition } from '../lib/smokeLayers'
import type { WmsLayerDefinition } from '../lib/wmsLayers'
import type { AqMonitorGroup } from '../lib/monitorPresentation'
import { getMonitorGroup, monitorKey } from '../lib/monitorPresentation'
import { formatGroupLabel } from '../lib/i18n'
import { getAqmapMarkerIcon, getAqmapMarkerSortKey } from '../lib/markerIcons'
import { getClusterCircleColor, getClusterCircleRadius, getClusterCountTextColor, getClusterStrokeColor } from '../lib/clusterColors'
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

const FORECAST_ZONE_COLORS = [
  '#bae6fd',
  '#bbf7d0',
  '#fde68a',
  '#fecaca',
  '#ddd6fe',
  '#fed7aa',
  '#c7d2fe',
  '#a7f3d0',
  '#fbcfe8',
  '#bfdbfe',
]

function sampleForecastZoneColor(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return FORECAST_ZONE_COLORS[hash % FORECAST_ZONE_COLORS.length]
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
        tileSize: 256,
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
          'circle-color': '#ef4444',
          'circle-opacity': 0.18,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2,
            5,
            7,
            10,
            11,
            16,
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
            'step',
            ['coalesce', ['to-number', ['get', 'age']], 24],
            '#ef4444',
            6,
            '#f97316',
            12,
            '#facc15',
          ],
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2,
            2.5,
            7,
            4.5,
            11,
            7,
          ],
          'circle-stroke-color': '#ffffff',
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

export function ForecastZonesVectorLayer({ visible }: { visible: boolean }) {
  const { map, isLoaded } = useMap()
  const sourceId = 'aqmap-forecast-zones-vector-source'
  const fillLayerId = 'aqmap-forecast-zones-vector-fill'
  const lineLayerId = 'aqmap-forecast-zones-vector-line'
  const [data, setData] = useState<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties & { fillColor?: string }> | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        setData({
          ...collection,
          features: collection.features.map((feature, index) => {
            const sampleKey = String(feature.properties?.CLC ?? feature.properties?.FEATURE_ID ?? index)
            return {
              ...feature,
              properties: {
                ...feature.properties,
                fillColor: sampleForecastZoneColor(sampleKey),
              },
            }
          }),
        })
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
          'fill-color': ['coalesce', ['get', 'fillColor'], '#bfdbfe'],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.58,
            0.34,
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
      })
    }

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'aqmap-tooltip pointer-events-none',
      maxWidth: '280px',
      offset: 12,
    })
    let hoveredId: string | number | null = null

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

    map.on('mousemove', fillLayerId, handleMouseMove)
    map.on('mouseleave', fillLayerId, handleMouseLeave)

    return () => {
      try {
        map.off('mousemove', fillLayerId, handleMouseMove)
        map.off('mouseleave', fillLayerId, handleMouseLeave)
        popup.remove()
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
  const clusterCountLayerId = `aqmap-monitor-cluster-count-${iconMode}`
  const revealedLayerId = `aqmap-monitor-revealed-icon-${iconMode}`

  const features = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, AqMapFeatureProperties>>(() => {
    return {
      type: 'FeatureCollection',
      features: monitors
        .filter((monitor) => visibleGroups.has(getMonitorGroup(monitor.network)))
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
              color: getAqhiColor(pm25),
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
  }, [monitors, visibleGroups])

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

        if (!currentMap.getLayer(clusterCountLayerId)) {
          currentMap.addLayer({
            id: clusterCountLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['has', 'point_count'],
            layout: {
              'text-field': '{point_count_abbreviated}',
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-size': 12,
              'text-allow-overlap': true,
            },
            paint: {
              'text-color': getClusterCountTextColor(clusterColorScheme),
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
              'icon-allow-overlap': false,
              'icon-ignore-placement': false,
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
        if (currentMap.getLayer(clusterCountLayerId)) currentMap.removeLayer(clusterCountLayerId)
        if (currentMap.getLayer(clusterLayerId)) currentMap.removeLayer(clusterLayerId)
        if (currentMap.getLayer(revealedLayerId)) currentMap.removeLayer(revealedLayerId)
        if (currentMap.getLayer(onlineLayerId)) currentMap.removeLayer(onlineLayerId)
        if (currentMap.getLayer(offlineLayerId)) currentMap.removeLayer(offlineLayerId)
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [clusterCountLayerId, clusterLayerId, clusterColorScheme, clusterMaxZoom, clusterRadius, tightClusters, features, iconMode, isLoaded, map, monitors, offlineLayerId, onMonitorClick, onMonitorHover, onlineLayerId, revealedLayerId, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    source?.setData(features)
  }, [features, isLoaded, map, sourceId])

  return null
}
