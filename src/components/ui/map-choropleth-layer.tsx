import { useEffect, useId } from 'react'
import { useMap } from '@/components/ui/map'
import {
  CHOROPLETH_FALLBACK_COLOR,
  CHOROPLETH_FILL_OPACITY,
  CHOROPLETH_LINE_COLOR,
  CHOROPLETH_LINE_OPACITY,
  CHOROPLETH_LINE_WIDTH,
  SELECTION_LINE_COLOR,
  SELECTION_LINE_OPACITY,
  SELECTION_LINE_WIDTH,
} from '@/components/ui/map-constants'

/**
 * Reusable MapLibre GL choropleth layer.
 *
 * Renders a GeoJSON FeatureCollection as coloured fill polygons with
 * consistent border lines and optional selection highlighting.  Each
 * feature is expected to carry a `color` (or custom `colorProperty`)
 * string in its properties.
 *
 * This component replaces the near-identical `CensusChoroplethLayer`
 * and `ScoreChoroplethLayer` implementations so that every choropleth
 * map in PGMaps shares the same paint defaults.
 */

export interface ChoroplethLayerProps {
  /** GeoJSON FeatureCollection to render. */
  data: GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>
  /** Feature property name that holds the fill colour string. Default `"color"`. */
  colorProperty?: string
  /** Currently selected feature id (matched against `properties.id`). */
  selectedFeatureId?: string | null
  /** Called when a polygon is clicked. Receives `properties.id`. */
  onFeatureClick?: (id: string) => void
  /** Override fill opacity (default from map-constants). */
  fillOpacity?: number
  /** Override border line width (default from map-constants). */
  lineWidth?: number
}

export function ChoroplethLayer({
  data,
  colorProperty = 'color',
  selectedFeatureId = null,
  onFeatureClick,
  fillOpacity = CHOROPLETH_FILL_OPACITY,
  lineWidth = CHOROPLETH_LINE_WIDTH,
}: ChoroplethLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `choropleth-source-${uid}`
  const fillLayerId = `choropleth-fill-${uid}`
  const lineLayerId = `choropleth-line-${uid}`
  const selectedLayerId = `choropleth-selected-${uid}`

  // Add source + layers once, then clean up on unmount.
  useEffect(() => {
    if (!isLoaded || !map) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'geojson', data } as never)
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['coalesce', ['get', colorProperty], CHOROPLETH_FALLBACK_COLOR],
          'fill-opacity': fillOpacity,
        },
      } as never)
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': CHOROPLETH_LINE_COLOR,
          'line-width': lineWidth,
          'line-opacity': CHOROPLETH_LINE_OPACITY,
        },
      } as never)
    }

    if (!map.getLayer(selectedLayerId)) {
      map.addLayer({
        id: selectedLayerId,
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'line-color': SELECTION_LINE_COLOR,
          'line-width': SELECTION_LINE_WIDTH,
          'line-opacity': SELECTION_LINE_OPACITY,
        },
      } as never)
    }

    const handleClick = (event: unknown) => {
      const e = event as { features?: Array<{ properties?: { id?: string } }> }
      const id = e.features?.[0]?.properties?.id
      if (id) onFeatureClick?.(id)
    }

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('click', fillLayerId, handleClick as never)
    map.on('mouseenter', fillLayerId, handleMouseEnter)
    map.on('mouseleave', fillLayerId, handleMouseLeave)

    return () => {
      try {
        map.off('click', fillLayerId, handleClick as never)
        map.off('mouseenter', fillLayerId, handleMouseEnter)
        map.off('mouseleave', fillLayerId, handleMouseLeave)

        if (!map.getStyle()) return
        if (map.getLayer(selectedLayerId)) map.removeLayer(selectedLayerId)
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Map already destroyed during unmount.
      }
    }
  }, [data, colorProperty, fillLayerId, fillOpacity, isLoaded, lineLayerId, lineWidth, map, onFeatureClick, selectedLayerId, sourceId])

  // Push data updates to the source.
  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as { setData?: (nextData: unknown) => void } | undefined
    source?.setData?.(data)
  }, [data, isLoaded, map, sourceId])

  // Update selection filter.
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    map.setFilter(selectedLayerId, ['==', ['get', 'id'], selectedFeatureId || ''])
  }, [isLoaded, map, selectedLayerId, selectedFeatureId])

  return null
}
