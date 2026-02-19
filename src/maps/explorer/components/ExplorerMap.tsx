import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapClusterLayer,
  MapControls,
  MapMarker,
  MarkerContent,
  useMap,
  type MapRef
} from '@/components/ui/map'
import {
  MAP_STYLES,
  PG_CENTER,
  PG_DEFAULT_ZOOM,
  SELECTION_LINE_COLOR,
  SELECTION_LINE_WIDTH,
  SELECTION_LINE_OPACITY,
  FIT_BOUNDS_PADDING,
  FIT_BOUNDS_DURATION,
  FIT_BOUNDS_MAX_ZOOM,
} from '@/components/ui/map-constants'
import type {
  ExplorerItem,
  ExplorerLineCollection,
  ExplorerPointCollection,
  ExplorerPolygonCollection
} from '../types'
import type maplibregl from 'maplibre-gl'

interface ExplorerMapProps {
  pointCollections: ExplorerPointCollection[]
  lineCollections: ExplorerLineCollection[]
  polygonCollections: ExplorerPolygonCollection[]
  selectedItem: ExplorerItem | null
  onItemSelect: (itemId: string) => void
}

interface ExplorerLineLayerProps {
  collection: ExplorerLineCollection
  selectedItemId: string | null
  onItemSelect: (itemId: string) => void
}

interface ExplorerPolygonLayerProps {
  collection: ExplorerPolygonCollection
  selectedItemId: string | null
  onItemSelect: (itemId: string) => void
}

function ExplorerLineLayer({ collection, selectedItemId, onItemSelect }: ExplorerLineLayerProps) {
  const { map, isLoaded } = useMap()
  const sourceId = `explorer-line-source-${collection.datasetId}`
  const layerId = `explorer-line-layer-${collection.datasetId}`
  const selectedLayerId = `explorer-line-selected-${collection.datasetId}`

  useEffect(() => {
    if (!isLoaded || !map) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: collection.data
      } as never)
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          visibility: collection.visible ? 'visible' : 'none'
        },
        paint: {
          'line-color': collection.color,
          'line-width': 2.2,
          'line-opacity': 0.75
        }
      } as never)
    }

    if (!map.getLayer(selectedLayerId)) {
      map.addLayer({
        id: selectedLayerId,
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'itemId'], ''],
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          visibility: collection.visible ? 'visible' : 'none'
        },
        paint: {
          'line-color': SELECTION_LINE_COLOR,
          'line-width': 4.2,
          'line-opacity': SELECTION_LINE_OPACITY
        }
      } as never)
    }

    const handleClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      const itemId = feature?.properties?.itemId
      if (typeof itemId === 'string' && itemId) {
        onItemSelect(itemId)
      }
    }

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('click', layerId, handleClick)
    map.on('mouseenter', layerId, handleMouseEnter)
    map.on('mouseleave', layerId, handleMouseLeave)

    return () => {
      try {
        map.off('click', layerId, handleClick)
        map.off('mouseenter', layerId, handleMouseEnter)
        map.off('mouseleave', layerId, handleMouseLeave)

        if (!map.getStyle()) return
        if (map.getLayer(selectedLayerId)) map.removeLayer(selectedLayerId)
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Ignore remove failures on map teardown.
      }
    }
  }, [collection.color, collection.data, collection.visible, isLoaded, layerId, map, onItemSelect, selectedLayerId, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    source?.setData(collection.data)
  }, [collection.data, isLoaded, map, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const visibility = collection.visible ? 'visible' : 'none'
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibility)
    if (map.getLayer(selectedLayerId)) map.setLayoutProperty(selectedLayerId, 'visibility', visibility)
  }, [collection.visible, isLoaded, layerId, map, selectedLayerId])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    map.setFilter(selectedLayerId, ['==', ['get', 'itemId'], selectedItemId || ''])
  }, [isLoaded, map, selectedItemId, selectedLayerId])

  return null
}

function ExplorerPolygonLayer({ collection, selectedItemId, onItemSelect }: ExplorerPolygonLayerProps) {
  const { map, isLoaded } = useMap()
  const sourceId = `explorer-polygon-source-${collection.datasetId}`
  const fillLayerId = `explorer-polygon-fill-${collection.datasetId}`
  const lineLayerId = `explorer-polygon-line-${collection.datasetId}`
  const selectedLayerId = `explorer-polygon-selected-${collection.datasetId}`

  useEffect(() => {
    if (!isLoaded || !map) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: collection.data
      } as never)
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        layout: {
          visibility: collection.visible ? 'visible' : 'none'
        },
        paint: {
          'fill-color': collection.color,
          'fill-opacity': 0.28
        }
      } as never)
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        layout: {
          visibility: collection.visible ? 'visible' : 'none'
        },
        paint: {
          'line-color': collection.color,
          'line-width': 1.1,
          'line-opacity': 0.8
        }
      } as never)
    }

    if (!map.getLayer(selectedLayerId)) {
      map.addLayer({
        id: selectedLayerId,
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'itemId'], ''],
        layout: {
          visibility: collection.visible ? 'visible' : 'none'
        },
        paint: {
          'line-color': SELECTION_LINE_COLOR,
          'line-width': SELECTION_LINE_WIDTH,
          'line-opacity': SELECTION_LINE_OPACITY
        }
      } as never)
    }

    const handleClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      const itemId = feature?.properties?.itemId
      if (typeof itemId === 'string' && itemId) {
        onItemSelect(itemId)
      }
    }

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('click', fillLayerId, handleClick)
    map.on('mouseenter', fillLayerId, handleMouseEnter)
    map.on('mouseleave', fillLayerId, handleMouseLeave)

    return () => {
      try {
        map.off('click', fillLayerId, handleClick)
        map.off('mouseenter', fillLayerId, handleMouseEnter)
        map.off('mouseleave', fillLayerId, handleMouseLeave)

        if (!map.getStyle()) return
        if (map.getLayer(selectedLayerId)) map.removeLayer(selectedLayerId)
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Ignore remove failures on map teardown.
      }
    }
  }, [collection.color, collection.data, collection.visible, fillLayerId, isLoaded, lineLayerId, map, onItemSelect, selectedLayerId, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    source?.setData(collection.data)
  }, [collection.data, isLoaded, map, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const visibility = collection.visible ? 'visible' : 'none'
    if (map.getLayer(fillLayerId)) map.setLayoutProperty(fillLayerId, 'visibility', visibility)
    if (map.getLayer(lineLayerId)) map.setLayoutProperty(lineLayerId, 'visibility', visibility)
    if (map.getLayer(selectedLayerId)) map.setLayoutProperty(selectedLayerId, 'visibility', visibility)
  }, [collection.visible, fillLayerId, isLoaded, lineLayerId, map, selectedLayerId])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    map.setFilter(selectedLayerId, ['==', ['get', 'itemId'], selectedItemId || ''])
  }, [isLoaded, map, selectedItemId, selectedLayerId])

  return null
}

export function ExplorerMap({
  pointCollections,
  lineCollections,
  polygonCollections,
  selectedItem,
  onItemSelect
}: ExplorerMapProps) {
  const mapRef = useRef<MapRef>(null)

  const selectedItemId = selectedItem?.id || null
  const selectedPointCoordinates = useMemo<[number, number] | null>(() => {
    if (!selectedItem || selectedItem.geometry.type !== 'Point') return null
    return selectedItem.geometry.coordinates as [number, number]
  }, [selectedItem])

  useEffect(() => {
    if (!selectedItem || !mapRef.current) return

    mapRef.current.fitBounds(
      [
        [selectedItem.bounds.minLng, selectedItem.bounds.minLat],
        [selectedItem.bounds.maxLng, selectedItem.bounds.maxLat]
      ],
      { padding: FIT_BOUNDS_PADDING, duration: FIT_BOUNDS_DURATION, maxZoom: FIT_BOUNDS_MAX_ZOOM }
    )
  }, [selectedItem])

  return (
    <div className="h-full w-full">
      <PgMap
        ref={mapRef}
        center={PG_CENTER}
        zoom={PG_DEFAULT_ZOOM}
        styles={{ light: MAP_STYLES.light, dark: MAP_STYLES.dark }}
      >
        <MapControls position="top-right" showZoom showCompass />

        {polygonCollections.map((collection) => (
          <ExplorerPolygonLayer
            key={collection.datasetId}
            collection={collection}
            selectedItemId={selectedItemId}
            onItemSelect={onItemSelect}
          />
        ))}

        {lineCollections.map((collection) => (
          <ExplorerLineLayer
            key={collection.datasetId}
            collection={collection}
            selectedItemId={selectedItemId}
            onItemSelect={onItemSelect}
          />
        ))}

        {pointCollections
          .filter((collection) => collection.visible)
          .map((collection) => (
            <MapClusterLayer
              key={collection.datasetId}
              data={collection.data}
              clusterRadius={42}
              clusterThresholds={[50, 180]}
              clusterColors={['#38bdf8', '#22c55e', '#f59e0b']}
              pointColor={collection.color}
              onPointClick={(feature) => {
                const itemId = feature.properties?.itemId
                if (typeof itemId === 'string' && itemId) {
                  onItemSelect(itemId)
                }
              }}
            />
          ))}

        {selectedPointCoordinates && (
          <MapMarker longitude={selectedPointCoordinates[0]} latitude={selectedPointCoordinates[1]}>
            <MarkerContent>
              <div className="h-5 w-5 rounded-full border-2 border-white bg-cyan-500 shadow-lg ring-4 ring-cyan-300/60" />
            </MarkerContent>
          </MapMarker>
        )}
      </PgMap>
    </div>
  )
}
