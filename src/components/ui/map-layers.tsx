import { useEffect, useId, useRef } from 'react'
import { useMap } from './map'
import { SELECTION_COLOR, SELECTION_WIDTH, BORDER_COLOR } from './map-styles'
import type MapLibreGL from 'maplibre-gl'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StyleExpression = any

// =============================================================================
// MapFillLayer
// =============================================================================
// Renders GeoJSON polygons with fill + border + optional selection highlight.
// Covers choropleth (Census, Score Builder), polygon (Parks, Explorer), and
// boundary (Air Quality) use cases with a single composable component.

type MapFillLayerProps = {
  /** GeoJSON FeatureCollection data */
  data: GeoJSON.FeatureCollection
  /** Fill color — static string or MapLibre expression (e.g. ['get', 'color']) */
  fillColor: string | StyleExpression
  /** Fill opacity (default: 0.72) */
  fillOpacity?: number
  /** Border line color — static string or MapLibre expression (default: '#0f172a') */
  lineColor?: string | StyleExpression
  /** Border line width (default: 0.7) */
  lineWidth?: number
  /** Border line opacity (default: 0.45) */
  lineOpacity?: number
  /** Feature property used for identification and selection (default: 'id') */
  idProperty?: string
  /** Currently selected feature ID — drives the selection highlight */
  selectedId?: string | number | null
  /** Selection highlight color (default: SELECTION_COLOR) */
  selectionColor?: string
  /** Selection highlight line width (default: SELECTION_WIDTH) */
  selectionWidth?: number
  /** Selection visual style — 'line' for border highlight, 'fill' for higher-opacity fill (default: 'line') */
  selectionStyle?: 'line' | 'fill'
  /** Fill opacity when selectionStyle='fill' (default: 0.5) */
  selectionFillOpacity?: number
  /** Whether the layer is visible (default: true) */
  visible?: boolean
  /** Callback when a feature is clicked — receives the feature's idProperty value as a string */
  onFeatureClick?: (id: string) => void
}

function MapFillLayer({
  data,
  fillColor,
  fillOpacity = 0.72,
  lineColor = BORDER_COLOR,
  lineWidth = 0.7,
  lineOpacity = 0.45,
  idProperty = 'id',
  selectedId = null,
  selectionColor = SELECTION_COLOR,
  selectionWidth = SELECTION_WIDTH,
  selectionStyle = 'line',
  selectionFillOpacity = 0.5,
  visible = true,
  onFeatureClick,
}: MapFillLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `fill-src-${uid}`
  const fillLayerId = `fill-layer-${uid}`
  const lineLayerId = `fill-line-${uid}`
  const selectedLayerId = `fill-sel-${uid}`

  const onClickRef = useRef(onFeatureClick)
  onClickRef.current = onFeatureClick
  const idPropRef = useRef(idProperty)
  idPropRef.current = idProperty

  // Mount: create source + layers
  useEffect(() => {
    if (!isLoaded || !map) return

    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': fillColor as never,
        'fill-opacity': fillOpacity,
      },
    })

    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': lineColor as never,
        'line-width': lineWidth,
        'line-opacity': lineOpacity,
      },
    })

    if (selectionStyle === 'line') {
      map.addLayer({
        id: selectedLayerId,
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', idPropRef.current], ''] as never,
        paint: {
          'line-color': selectionColor,
          'line-width': selectionWidth,
          'line-opacity': 1,
        },
      })
    } else {
      map.addLayer({
        id: selectedLayerId,
        type: 'fill',
        source: sourceId,
        filter: ['==', ['get', idPropRef.current], -1] as never,
        paint: {
          'fill-color': fillColor as never,
          'fill-opacity': selectionFillOpacity,
        },
      })
    }

    const handleClick = (event: unknown) => {
      const e = event as { features?: Array<{ properties?: Record<string, unknown> }> }
      const id = e.features?.[0]?.properties?.[idPropRef.current]
      if (id != null) onClickRef.current?.(String(id))
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
        // Map already destroyed during unmount
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map])

  // Update source data
  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined
    source?.setData(data)
  }, [data, isLoaded, map, sourceId])

  // Update visibility
  useEffect(() => {
    if (!isLoaded || !map) return
    const vis = visible ? 'visible' : 'none'
    for (const id of [fillLayerId, lineLayerId, selectedLayerId]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    }
  }, [visible, isLoaded, map, fillLayerId, lineLayerId, selectedLayerId])

  // Update selection filter
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    map.setFilter(selectedLayerId, ['==', ['get', idProperty], selectedId ?? ''] as never)
  }, [isLoaded, map, selectedLayerId, selectedId, idProperty])

  return null
}

// =============================================================================
// MapLineLayer
// =============================================================================
// Renders GeoJSON line features with optional selection highlight and visibility.
// Used for trails (Parks), line collections (Explorer), and similar.

type MapLineLayerProps = {
  /** GeoJSON FeatureCollection data */
  data: GeoJSON.FeatureCollection
  /** Line color — static string or MapLibre expression */
  color: string | StyleExpression
  /** Line width (default: 2.2) */
  width?: number
  /** Line offset in pixels, useful for parallel route lines (default: 0) */
  offset?: number | StyleExpression
  /** Line opacity (default: 0.75) */
  opacity?: number
  /** Dash pattern [dash, gap] */
  dashArray?: number[]
  /** Line join style (default: 'round') */
  lineJoin?: 'round' | 'bevel' | 'miter'
  /** Line cap style (default: 'round') */
  lineCap?: 'round' | 'butt' | 'square'
  /** Feature property used for identification and selection (default: 'id') */
  idProperty?: string
  /** Currently selected feature ID */
  selectedId?: string | number | null
  /** Selection highlight color (default: SELECTION_COLOR) */
  selectionColor?: string
  /** Selection highlight line width (default: computed from width) */
  selectionWidth?: number
  /** Whether the layer is visible (default: true) */
  visible?: boolean
  /** Callback when a feature is clicked */
  onFeatureClick?: (id: string) => void
}

function MapLineLayer({
  data,
  color,
  width = 2.2,
  offset = 0,
  opacity = 0.75,
  dashArray,
  lineJoin = 'round',
  lineCap = 'round',
  idProperty = 'id',
  selectedId = null,
  selectionColor = SELECTION_COLOR,
  selectionWidth,
  visible = true,
  onFeatureClick,
}: MapLineLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `line-src-${uid}`
  const layerId = `line-layer-${uid}`
  const selectedLayerId = `line-sel-${uid}`

  const onClickRef = useRef(onFeatureClick)
  onClickRef.current = onFeatureClick
  const idPropRef = useRef(idProperty)
  idPropRef.current = idProperty

  const resolvedSelectionWidth = selectionWidth ?? Math.max(width + 2, width * 1.8)

  // Mount: create source + layers
  useEffect(() => {
    if (!isLoaded || !map) return

    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-join': lineJoin,
        'line-cap': lineCap,
      },
      paint: {
        'line-color': color as never,
        'line-width': width,
        'line-offset': offset as never,
        'line-opacity': opacity,
        ...(dashArray && { 'line-dasharray': dashArray }),
      },
    })

    map.addLayer({
      id: selectedLayerId,
      type: 'line',
      source: sourceId,
      filter: ['==', ['get', idPropRef.current], ''] as never,
      layout: {
        'line-join': lineJoin,
        'line-cap': lineCap,
      },
      paint: {
        'line-color': selectionColor,
        'line-width': resolvedSelectionWidth,
        'line-offset': offset as never,
        'line-opacity': 1,
        ...(dashArray && { 'line-dasharray': dashArray }),
      },
    })

    const handleClick = (event: unknown) => {
      const e = event as { features?: Array<{ properties?: Record<string, unknown> }> }
      const id = e.features?.[0]?.properties?.[idPropRef.current]
      if (id != null) onClickRef.current?.(String(id))
    }

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('click', layerId, handleClick as never)
    map.on('mouseenter', layerId, handleMouseEnter)
    map.on('mouseleave', layerId, handleMouseLeave)

    return () => {
      try {
        map.off('click', layerId, handleClick as never)
        map.off('mouseenter', layerId, handleMouseEnter)
        map.off('mouseleave', layerId, handleMouseLeave)

        if (!map.getStyle()) return
        if (map.getLayer(selectedLayerId)) map.removeLayer(selectedLayerId)
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map])

  // Update source data
  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined
    source?.setData(data)
  }, [data, isLoaded, map, sourceId])

  // Update visibility
  useEffect(() => {
    if (!isLoaded || !map) return
    const vis = visible ? 'visible' : 'none'
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', vis)
    if (map.getLayer(selectedLayerId)) map.setLayoutProperty(selectedLayerId, 'visibility', vis)
  }, [visible, isLoaded, map, layerId, selectedLayerId])

  // Update selection filter
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    map.setFilter(selectedLayerId, ['==', ['get', idProperty], selectedId ?? ''] as never)
  }, [isLoaded, map, selectedLayerId, selectedId, idProperty])

  return null
}

// =============================================================================
// MapRasterLayer
// =============================================================================
// Renders raster tile layers (satellite imagery, terrain, WMS, etc.)

type MapRasterLayerProps = {
  /** Array of tile URL templates — use {z}/{x}/{y} placeholders */
  tiles: string[]
  /** Tile size in pixels (default: 256) */
  tileSize?: number
  /** Layer opacity from 0 to 1 (default: 1) */
  opacity?: number
  /** Whether the layer is visible (default: true) */
  visible?: boolean
  /** Minimum zoom level for tile requests (default: 0) */
  minZoom?: number
  /** Maximum zoom level for tile requests (default: 22) */
  maxZoom?: number
  /** Attribution text shown in map corner */
  attribution?: string
  /** Insert this layer before another layer ID (default: added on top) */
  beforeId?: string
}

function MapRasterLayer({
  tiles,
  tileSize = 256,
  opacity = 1,
  visible = true,
  minZoom = 0,
  maxZoom = 22,
  attribution,
  beforeId,
}: MapRasterLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `raster-src-${uid}`
  const layerId = `raster-layer-${uid}`

  // Mount: create source + layer
  useEffect(() => {
    if (!isLoaded || !map) return

    map.addSource(sourceId, {
      type: 'raster',
      tiles,
      tileSize,
      minzoom: minZoom,
      maxzoom: maxZoom,
      ...(attribution && { attribution }),
    })

    map.addLayer(
      {
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': opacity,
        },
      },
      beforeId
    )

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map])

  // Update opacity
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setPaintProperty(layerId, 'raster-opacity', opacity)
  }, [opacity, isLoaded, map, layerId])

  // Update visibility
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  }, [visible, isLoaded, map, layerId])

  return null
}

export { MapFillLayer, MapLineLayer, MapRasterLayer }
export type { MapFillLayerProps, MapLineLayerProps, MapRasterLayerProps }
