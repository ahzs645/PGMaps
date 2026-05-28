import { useEffect, useMemo, useState } from 'react'
import { useMap } from '@/components/ui/map'
import type { AirMonitor } from '@/maps/airquality'
import { getAqhiColor, getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import type maplibregl from 'maplibre-gl'
import type { SmokeLayerDefinition } from '../lib/smokeLayers'
import type { WmsLayerDefinition } from '../lib/wmsLayers'
import type { AqMonitorGroup } from '../lib/monitorPresentation'
import { getMonitorGroup, monitorKey } from '../lib/monitorPresentation'
import { formatGroupLabel } from '../lib/i18n'
import { getAqmapMarkerIcon, getAqmapMarkerSortKey } from '../lib/markerIcons'
import {
  FIRE_DANGER_FILL_COLORS,
  FIRE_DANGER_VECTOR_URL,
} from '../lib/aqMapConstants'
import type {
  AqMonitorIconMode,
  FireDangerFeatureProperties,
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
  onMonitorClick,
  onMonitorHover,
}: {
  monitors: AirMonitor[]
  visibleGroups: Set<AqMonitorGroup>
  iconMode: AqMonitorIconMode
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
          clusterMaxZoom: 10,
          clusterRadius: 46,
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
              'circle-color': '#f8fafc',
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                18,
                40,
                27,
                150,
                38,
              ],
              'circle-opacity': 0.92,
              'circle-stroke-color': '#334155',
              'circle-stroke-width': 2.5,
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
              'text-color': '#0f172a',
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
              'icon-size': 0.9,
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
  }, [clusterCountLayerId, clusterLayerId, features, iconMode, isLoaded, map, monitors, offlineLayerId, onMonitorClick, onMonitorHover, onlineLayerId, revealedLayerId, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    source?.setData(features)
  }, [features, isLoaded, map, sourceId])

  return null
}
