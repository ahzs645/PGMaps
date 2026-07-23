import { useEffect, useId, useMemo, useRef } from 'react'
import { useMap } from './map'
import {
  SELECTION_COLOR,
  SELECTION_WIDTH,
  BORDER_COLOR,
  HEATMAP_COLOR_RAMPS,
  type HeatmapRampName,
} from './map-styles'
import type MapLibreGL from 'maplibre-gl'
import MapLibreGLRuntime from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { MOBILE_MAP_FEATURE_CLICK_EVENT } from './mobile-feature-card'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StyleExpression = any

let pmtilesProtocolRegistered = false

function ensurePmtilesProtocol() {
  if (pmtilesProtocolRegistered) return
  const protocol = new Protocol()
  MapLibreGLRuntime.addProtocol('pmtiles', protocol.tile)
  pmtilesProtocolRegistered = true
}

function dispatchMobileMapFeatureClick() {
  window.dispatchEvent(new CustomEvent(MOBILE_MAP_FEATURE_CLICK_EVENT))
}

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
  /** Fill opacity (default: 0.72) — number or MapLibre expression */
  fillOpacity?: number | StyleExpression
  /** Border line color — static string or MapLibre expression (default: '#0f172a') */
  lineColor?: string | StyleExpression
  /** Border line width (default: 0.7) — number or MapLibre expression */
  lineWidth?: number | StyleExpression
  /** Border line opacity (default: 0.45) */
  lineOpacity?: number
  /** Feature property used for identification and selection (default: 'id') */
  idProperty?: string
  /** Currently selected feature ID — drives the selection highlight */
  selectedId?: string | number | null
  /** Multiple selected feature IDs — combined with selectedId for the selection highlight */
  selectedIds?: Array<string | number>
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
  onFeatureClick?: (id: string, event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void
  /** Optional HTML tooltip for hoverable feature properties. Return null to hide. */
  hoverHtml?: (properties: Record<string, unknown>) => string | null
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
  selectedIds = [],
  selectionColor = SELECTION_COLOR,
  selectionWidth = SELECTION_WIDTH,
  selectionStyle = 'line',
  selectionFillOpacity = 0.5,
  visible = true,
  onFeatureClick,
  hoverHtml,
}: MapFillLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `fill-src-${uid}`
  const fillLayerId = `fill-layer-${uid}`
  const lineLayerId = `fill-line-${uid}`
  const selectedLayerId = `fill-sel-${uid}`

  const onClickRef = useRef(onFeatureClick)
  onClickRef.current = onFeatureClick
  const hoverHtmlRef = useRef(hoverHtml)
  hoverHtmlRef.current = hoverHtml
  const idPropRef = useRef(idProperty)
  idPropRef.current = idProperty
  const tooltipRef = useRef<MapLibreGLRuntime.Popup | null>(null)
  const boxZoomWasEnabledRef = useRef(false)
  const doubleClickZoomWasEnabledRef = useRef(false)

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
        'fill-opacity': fillOpacity as never,
      },
    })

    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': lineColor as never,
        'line-width': lineWidth as never,
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
      const e = event as {
        features?: Array<{ properties?: Record<string, unknown> }>
        originalEvent?: Event & {
          shiftKey?: boolean
          altKey?: boolean
          ctrlKey?: boolean
          metaKey?: boolean
        }
        preventDefault?: () => void
      }
      const id = e.features?.[0]?.properties?.[idPropRef.current]
      if (id != null) {
        e.preventDefault?.()
        e.originalEvent?.preventDefault()
        dispatchMobileMapFeatureClick()
        const originalEvent = e.originalEvent
        onClickRef.current?.(String(id), {
          shiftKey: originalEvent?.shiftKey === true,
          altKey: originalEvent?.altKey === true,
          ctrlKey: originalEvent?.ctrlKey === true,
          metaKey: originalEvent?.metaKey === true,
        })
      }
    }

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
      boxZoomWasEnabledRef.current = map.boxZoom.isEnabled()
      if (boxZoomWasEnabledRef.current) map.boxZoom.disable()
      doubleClickZoomWasEnabledRef.current = map.doubleClickZoom.isEnabled()
      if (doubleClickZoomWasEnabledRef.current) map.doubleClickZoom.disable()
    }

    const removeTooltip = () => {
      tooltipRef.current?.remove()
    }

    const handleMouseMove = (event: unknown) => {
      const formatter = hoverHtmlRef.current
      if (!formatter) return
      const e = event as {
        features?: Array<{ properties?: Record<string, unknown> }>
        lngLat?: MapLibreGL.LngLatLike
      }
      const properties = e.features?.[0]?.properties
      const html = properties ? formatter(properties) : null
      if (!html || !e.lngLat) {
        removeTooltip()
        return
      }
      if (!tooltipRef.current) {
        tooltipRef.current = new MapLibreGLRuntime.Popup({
          closeButton: false,
          closeOnClick: false,
          className: 'mapcn-tooltip pointer-events-none',
          offset: 12,
        })
      }
      tooltipRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map)
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      if (boxZoomWasEnabledRef.current) {
        map.boxZoom.enable()
        boxZoomWasEnabledRef.current = false
      }
      if (doubleClickZoomWasEnabledRef.current) {
        map.doubleClickZoom.enable()
        doubleClickZoomWasEnabledRef.current = false
      }
      removeTooltip()
    }

    const canvas = map.getCanvas()
    const handleDocumentPointerMove = (event: PointerEvent) => {
      if (event.target instanceof Node && canvas.contains(event.target)) return
      removeTooltip()
    }
    const handleVisibilityChange = () => {
      if (document.hidden) removeTooltip()
    }

    map.on('click', fillLayerId, handleClick as never)
    map.on('mouseenter', fillLayerId, handleMouseEnter)
    map.on('mousemove', fillLayerId, handleMouseMove as never)
    map.on('mouseleave', fillLayerId, handleMouseLeave)
    canvas.addEventListener('mouseleave', removeTooltip)
    document.addEventListener('pointermove', handleDocumentPointerMove, true)
    window.addEventListener('blur', removeTooltip)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      try {
        map.off('click', fillLayerId, handleClick as never)
        map.off('mouseenter', fillLayerId, handleMouseEnter)
        map.off('mousemove', fillLayerId, handleMouseMove as never)
        map.off('mouseleave', fillLayerId, handleMouseLeave)
        canvas.removeEventListener('mouseleave', removeTooltip)
        document.removeEventListener('pointermove', handleDocumentPointerMove, true)
        window.removeEventListener('blur', removeTooltip)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        if (boxZoomWasEnabledRef.current) {
          map.boxZoom.enable()
          boxZoomWasEnabledRef.current = false
        }
        if (doubleClickZoomWasEnabledRef.current) {
          map.doubleClickZoom.enable()
          doubleClickZoomWasEnabledRef.current = false
        }
        removeTooltip()
        tooltipRef.current = null

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

  // Update paint when caller changes choropleth styling without remounting the layer.
  useEffect(() => {
    if (!isLoaded || !map) return
    if (map.getLayer(fillLayerId)) {
      map.setPaintProperty(fillLayerId, 'fill-color', fillColor as never)
      map.setPaintProperty(fillLayerId, 'fill-opacity', fillOpacity as never)
    }
    if (map.getLayer(lineLayerId)) {
      map.setPaintProperty(lineLayerId, 'line-color', lineColor as never)
      map.setPaintProperty(lineLayerId, 'line-width', lineWidth as never)
      map.setPaintProperty(lineLayerId, 'line-opacity', lineOpacity)
    }
  }, [fillColor, fillOpacity, fillLayerId, isLoaded, lineColor, lineLayerId, lineOpacity, lineWidth, map])

  // Update selection filter
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    const selectedValues = Array.from(new Set([selectedId, ...selectedIds].filter((id) => id != null)))
    map.setFilter(
      selectedLayerId,
      selectedValues.length > 0
        ? ['in', ['get', idProperty], ['literal', selectedValues]] as never
        : ['==', ['get', idProperty], ''] as never,
    )
  }, [isLoaded, map, selectedLayerId, selectedId, selectedIds, idProperty])

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
  /** Line width (default: 2.2) — number or MapLibre expression (e.g. zoom interpolation) */
  width?: number | StyleExpression
  /** Line offset in pixels, useful for parallel route lines (default: 0) */
  offset?: number | StyleExpression
  /** Line opacity (default: 0.75) — number or MapLibre expression */
  opacity?: number | StyleExpression
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

  const resolvedSelectionWidth =
    selectionWidth ??
    (typeof width === 'number' ? Math.max(width + 2, width * 1.8) : width)

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
        'line-width': width as never,
        'line-offset': offset as never,
        'line-opacity': opacity as never,
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
        'line-width': resolvedSelectionWidth as never,
        'line-offset': offset as never,
        'line-opacity': 1,
        ...(dashArray && { 'line-dasharray': dashArray }),
      },
    })

    const handleClick = (event: unknown) => {
      const e = event as {
        features?: Array<{ properties?: Record<string, unknown> }>
        originalEvent?: Event
        preventDefault?: () => void
      }
      const id = e.features?.[0]?.properties?.[idPropRef.current]
      if (id != null) {
        e.preventDefault?.()
        e.originalEvent?.preventDefault()
        dispatchMobileMapFeatureClick()
        onClickRef.current?.(String(id))
      }
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

// =============================================================================
// MapHeatmapLayer
// =============================================================================
// Renders a MapLibre `heatmap` layer over a GeoJSON point source. Used by
// Crime, Air Quality, and Explorer mashups. Defaults match a generic sparse
// point-cloud style; callers tune intensity/radius/opacity stops for their
// data density and viewing zoom.

type ZoomStops = ReadonlyArray<readonly [zoom: number, value: number]>

type ColorStops = ReadonlyArray<readonly [density: number, color: string]>

type MapHeatmapLayerProps = {
  /** GeoJSON FeatureCollection of points. Features can carry a numeric `weight` property. */
  data: GeoJSON.FeatureCollection<GeoJSON.Point>
  /** Whether the layer is visible (default: true). */
  visible?: boolean
  /**
   * Per-feature weight expression. Defaults to ['coalesce', ['get', 'weight'], 1]
   * so points without a weight property contribute uniformly.
   */
  weight?: StyleExpression | number
  /** [zoom, intensity] stops. Default: [[0, 0.4], [9, 1.2]]. */
  intensityStops?: ZoomStops
  /** [zoom, radius-px] stops. Default: [[0, 8], [9, 26]]. */
  radiusStops?: ZoomStops
  /** Either constant opacity or [zoom, opacity] stops. Default: 0.7. */
  opacity?: number | ZoomStops
  /** Color ramp as [density, color] stops, or a named ramp from HEATMAP_COLOR_RAMPS. */
  colorRamp?: ColorStops | HeatmapRampName
  /** Insert this layer before the given existing layer id (z-order). */
  beforeLayerId?: string
}

function stopsToInterpolate(stops: ZoomStops): unknown {
  return ['interpolate', ['linear'], ['zoom'], ...stops.flatMap(([z, v]) => [z, v])]
}

function rampToInterpolate(stops: ColorStops): unknown {
  return ['interpolate', ['linear'], ['heatmap-density'], ...stops.flatMap(([d, c]) => [d, c])]
}

function MapHeatmapLayer({
  data,
  visible = true,
  weight,
  intensityStops = [
    [0, 0.4],
    [9, 1.2],
  ],
  radiusStops = [
    [0, 8],
    [9, 26],
  ],
  opacity = 0.7,
  colorRamp = 'air',
  beforeLayerId,
}: MapHeatmapLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `heatmap-src-${uid}`
  const layerId = `heatmap-layer-${uid}`

  const resolvedRamp = useMemo<ColorStops>(
    () => (typeof colorRamp === 'string' ? HEATMAP_COLOR_RAMPS[colorRamp] : colorRamp),
    [colorRamp],
  )

  const paint = useMemo(() => {
    const weightExpr =
      weight !== undefined ? weight : (['coalesce', ['get', 'weight'], 1] as unknown)
    const opacityValue =
      typeof opacity === 'number' ? opacity : stopsToInterpolate(opacity)
    return {
      'heatmap-weight': weightExpr,
      'heatmap-intensity': stopsToInterpolate(intensityStops),
      'heatmap-radius': stopsToInterpolate(radiusStops),
      'heatmap-opacity': opacityValue,
      'heatmap-color': rampToInterpolate(resolvedRamp),
    }
  }, [weight, intensityStops, radiusStops, opacity, resolvedRamp])

  // Mount: create source + layer
  useEffect(() => {
    if (!isLoaded || !map) return

    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })

    map.addLayer(
      {
        id: layerId,
        type: 'heatmap',
        source: sourceId,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: paint as never,
      },
      beforeLayerId,
    )

    return () => {
      try {
        if (!map.getStyle()) return
        if (map.getLayer(layerId)) map.removeLayer(layerId)
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
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  }, [visible, isLoaded, map, layerId])

  // Update paint properties
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    for (const [key, value] of Object.entries(paint)) {
      map.setPaintProperty(layerId, key, value as never)
    }
  }, [paint, isLoaded, map, layerId])

  return null
}

// =============================================================================
// MapPieClusterLayer
// =============================================================================
// Clusters render as donut charts whose arcs show the split of their points
// across the caller's color bands; unclustered points show as dots in their
// feature's marker color. Each feature must carry a numeric `bandIndex` into
// `bandColors` plus a `color` string for its unclustered dot. Clicking a donut
// zooms to the cluster's expansion zoom. Extracted from the food map's
// pie-donut cluster mode (itself adapted from the dev aqmap ring mode).

/**
 * SVG path for one donut wedge spanning [start, end] (fractions of the circle).
 * Stroke matches the fill so neighbouring arcs seal into one continuous ring.
 */
function donutSegment(start: number, end: number, r: number, r0: number, color: string): string {
  if (end - start >= 1) end -= 0.0001
  const a0 = 2 * Math.PI * (start - 0.25)
  const a1 = 2 * Math.PI * (end - 0.25)
  const x0 = Math.cos(a0)
  const y0 = Math.sin(a0)
  const x1 = Math.cos(a1)
  const y1 = Math.sin(a1)
  const largeArc = end - start > 0.5 ? 1 : 0
  const d =
    `M ${r + r0 * x0} ${r + r0 * y0} L ${r + r * x0} ${r + r * y0} ` +
    `A ${r} ${r} 0 ${largeArc} 1 ${r + r * x1} ${r + r * y1} ` +
    `L ${r + r0 * x1} ${r + r0 * y1} A ${r0} ${r0} 0 ${largeArc} 0 ${r + r0 * x0} ${r + r0 * y0}`
  return `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="0.75" stroke-linejoin="round"/>`
}

/** Abbreviate cluster totals in the thousands, e.g. 4,200 → "4k". */
function formatClusterCount(total: number): string {
  if (total < 1000) return String(total)
  return `${Math.round(total / 1000)}k`
}

/**
 * Build the donut marker element for a cluster from its aggregated band
 * counts, with the total in the hollow centre when showCount is set. With a
 * transparent centerStyle the hole shows the map through it and the count
 * gets a white halo to stay legible.
 */
function createDonutElement(
  props: Record<string, unknown>,
  bandColors: readonly string[],
  showCount: boolean,
  centerStyle: 'white' | 'transparent',
): HTMLDivElement {
  const counts = bandColors.map((_, index) => Number(props[`band${index}`]) || 0)
  const total = Number(props.point_count) || counts.reduce((sum, count) => sum + count, 0)
  const r = total >= 50 ? 24 : total >= 25 ? 21 : total >= 10 ? 18 : 15
  const r0 = Math.round(r * 0.62)
  const w = r * 2
  const fontSize = total >= 50 ? 13 : total >= 10 ? 12 : 11
  const n = Math.max(total, 1)
  const segments: string[] = []
  let placed = 0
  counts.forEach((count, band) => {
    if (count <= 0) return
    segments.push(donutSegment(placed / n, (placed + count) / n, r, r0, bandColors[band]))
    placed += count
  })
  const isWhiteCenter = centerStyle === 'white'
  const element = document.createElement('div')
  element.innerHTML =
    `<svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}" text-anchor="middle" ` +
    `style="display:block;font:700 ${fontSize}px system-ui,sans-serif;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45));">` +
    (isWhiteCenter ? `<circle cx="${r}" cy="${r}" r="${r}" fill="#ffffff"/>` : '') +
    segments.join('') +
    (isWhiteCenter ? `<circle cx="${r}" cy="${r}" r="${r0}" fill="#ffffff"/>` : '') +
    (showCount
      ? `<text x="${r}" y="${r}" dominant-baseline="central" fill="#0f172a"` +
        (isWhiteCenter ? '' : ' stroke="#ffffff" stroke-width="3" paint-order="stroke" stroke-linejoin="round"') +
        `>${formatClusterCount(total)}</text>`
      : '') +
    '</svg>'
  element.style.cursor = 'pointer'
  element.style.width = `${w}px`
  element.style.height = `${w}px`
  return element
}

const SPIDERFY_LIMIT = 16
const CLUSTER_LIST_PAGE_SIZE = 50

function getClusterLeafProperties(feature: GeoJSON.Feature): Record<string, unknown> {
  return (feature.properties ?? {}) as Record<string, unknown>
}

function getClusterLeafTitle(properties: Record<string, unknown>, fallbackIndex: number): string {
  const label = String(properties.spiderTitle ?? '').trim()
  return label || `Record ${fallbackIndex + 1}`
}

function createSpiderElement(
  leaves: GeoJSON.Feature[],
  onSelect: (properties: Record<string, unknown>) => void,
): HTMLDivElement {
  const root = document.createElement('div')
  root.style.width = '1px'
  root.style.height = '1px'
  root.style.pointerEvents = 'none'

  const svgNamespace = 'http://www.w3.org/2000/svg'
  const lines = document.createElementNS(svgNamespace, 'svg')
  lines.setAttribute('width', '1')
  lines.setAttribute('height', '1')
  lines.style.position = 'absolute'
  lines.style.overflow = 'visible'
  lines.style.pointerEvents = 'none'
  root.appendChild(lines)

  const count = leaves.length
  const radius = count <= 8 ? 42 : 58
  leaves.forEach((leaf, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    const properties = getClusterLeafProperties(leaf)
    const color = String(properties.color ?? '#92400e')
    const title = getClusterLeafTitle(properties, index)
    const subtitle = String(properties.spiderSubtitle ?? '').trim()

    const halo = document.createElementNS(svgNamespace, 'line')
    halo.setAttribute('x1', '0')
    halo.setAttribute('y1', '0')
    halo.setAttribute('x2', String(x))
    halo.setAttribute('y2', String(y))
    halo.setAttribute('stroke', '#ffffff')
    halo.setAttribute('stroke-width', '4')
    halo.setAttribute('stroke-linecap', 'round')
    lines.appendChild(halo)

    const line = document.createElementNS(svgNamespace, 'line')
    line.setAttribute('x1', '0')
    line.setAttribute('y1', '0')
    line.setAttribute('x2', String(x))
    line.setAttribute('y2', String(y))
    line.setAttribute('stroke', '#64748b')
    line.setAttribute('stroke-width', '1.5')
    line.setAttribute('stroke-linecap', 'round')
    lines.appendChild(line)

    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', subtitle ? `${title}, ${subtitle}` : title)
    button.title = subtitle ? `${title}\n${subtitle}` : title
    button.style.position = 'absolute'
    button.style.left = `${x}px`
    button.style.top = `${y}px`
    button.style.width = '18px'
    button.style.height = '18px'
    button.style.padding = '0'
    button.style.border = '2px solid #ffffff'
    button.style.borderRadius = '9999px'
    button.style.background = color
    button.style.boxShadow = '0 1px 4px rgba(15,23,42,0.5)'
    button.style.cursor = 'pointer'
    button.style.pointerEvents = 'auto'
    button.style.transform = 'translate(-50%, -50%)'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      onSelect(properties)
    })
    root.appendChild(button)
  })

  return root
}

type MapPieClusterLayerProps = {
  /** GeoJSON points carrying `bandIndex` (wedge tally) and `color` (unclustered dot) properties. */
  data: GeoJSON.FeatureCollection<GeoJSON.Point>
  /** Wedge color per band, indexed by each feature's `bandIndex`. */
  bandColors: readonly string[]
  /** Maximum zoom level to cluster points on (default: 14). */
  clusterMaxZoom?: number
  /** Cluster radius in pixels (default: 46). */
  clusterRadius?: number
  /** Show the total point count in the hollow donut centre (default: true). */
  showCount?: boolean
  /** Donut hole fill: solid 'white' disc or 'transparent' so the map shows through (default: 'white'). */
  centerStyle?: 'white' | 'transparent'
  /** Stroke color around unclustered dots (default: '#ffffff'). */
  pointStrokeColor?: string
  /**
   * Keep terminal clusters interactive: small stacks spiderfy and large stacks
   * open a paged record list instead of drawing coincident points on top of
   * each other (default: false).
   */
  expandOverlappingPoints?: boolean
  /** Callback when an unclustered point is clicked — receives the feature's properties. */
  onPointClick?: (properties: Record<string, unknown>) => void
}

function MapPieClusterLayer({
  data,
  bandColors,
  clusterMaxZoom = 14,
  clusterRadius = 46,
  showCount = true,
  centerStyle = 'white',
  pointStrokeColor = '#ffffff',
  expandOverlappingPoints = false,
  onPointClick,
}: MapPieClusterLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `pie-cluster-src-${uid}`
  const pointLayerId = `pie-cluster-points-${uid}`
  const onPointClickRef = useRef(onPointClick)

  useEffect(() => {
    onPointClickRef.current = onPointClick
  }, [onPointClick])

  useEffect(() => {
    if (!isLoaded || !map) return
    const currentMap = map
    let cancelled = false
    const markers: Record<string, MapLibreGL.Marker> = {}
    let markersOnScreen: Record<string, MapLibreGL.Marker> = {}
    let spiderMarker: MapLibreGL.Marker | null = null
    let clusterListPopup: MapLibreGL.Popup | null = null

    const clusterProperties: Record<string, MapLibreGL.ExpressionSpecification> = {}
    bandColors.forEach((_, index) => {
      clusterProperties[`band${index}`] = ['+', ['case', ['==', ['get', 'bandIndex'], index], 1, 0]]
    })

    const clearExpandedCluster = () => {
      spiderMarker?.remove()
      clusterListPopup?.remove()
      spiderMarker = null
      clusterListPopup = null
    }

    const selectClusterLeaf = (properties: Record<string, unknown>) => {
      clearExpandedCluster()
      dispatchMobileMapFeatureClick()
      onPointClickRef.current?.(properties)
    }

    const showSpider = (coordinates: [number, number], leaves: GeoJSON.Feature[]) => {
      clearExpandedCluster()
      const element = createSpiderElement(leaves, selectClusterLeaf)
      spiderMarker = new MapLibreGLRuntime.Marker({ element, anchor: 'center' })
        .setLngLat(coordinates)
        .addTo(currentMap)
    }

    const showClusterList = (
      source: MapLibreGL.GeoJSONSource,
      clusterId: number,
      coordinates: [number, number],
      pointCount: number,
    ) => {
      clearExpandedCluster()
      const panel = document.createElement('div')
      panel.className = 'w-[min(19rem,calc(100vw-3rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl'

      const header = document.createElement('div')
      header.className = 'flex items-center justify-between gap-3 border-b border-border px-3 py-2.5'
      const heading = document.createElement('div')
      heading.className = 'text-sm font-semibold'
      heading.textContent = `${pointCount.toLocaleString()} overlapping records`
      const closeButton = document.createElement('button')
      closeButton.type = 'button'
      closeButton.className = 'rounded px-1.5 py-0.5 text-lg leading-none text-muted-foreground hover:bg-accent hover:text-foreground'
      closeButton.setAttribute('aria-label', 'Close overlapping records')
      closeButton.textContent = '×'
      closeButton.addEventListener('click', clearExpandedCluster)
      header.append(heading, closeButton)

      const list = document.createElement('div')
      list.className = 'max-h-44 overflow-y-auto p-1.5'
      const footer = document.createElement('div')
      footer.className = 'border-t border-border p-2'
      const loadMoreButton = document.createElement('button')
      loadMoreButton.type = 'button'
      loadMoreButton.className = 'w-full rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:opacity-80'
      footer.appendChild(loadMoreButton)
      panel.append(header, list, footer)

      let loaded = 0
      let loading = false
      const loadNextPage = async () => {
        if (loading || loaded >= pointCount) return
        loading = true
        loadMoreButton.disabled = true
        loadMoreButton.textContent = 'Loading…'
        try {
          const leaves = await source.getClusterLeaves(
            clusterId,
            Math.min(CLUSTER_LIST_PAGE_SIZE, pointCount - loaded),
            loaded,
          )
          if (cancelled) return
          leaves.forEach((leaf, pageIndex) => {
            const properties = getClusterLeafProperties(leaf)
            const title = getClusterLeafTitle(properties, loaded + pageIndex)
            const subtitle = String(properties.spiderSubtitle ?? '').trim()
            const color = String(properties.color ?? '#92400e')
            const row = document.createElement('button')
            row.type = 'button'
            row.className = 'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent'
            const dot = document.createElement('span')
            dot.className = 'mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-white shadow-sm'
            dot.style.background = color
            const copy = document.createElement('span')
            copy.className = 'min-w-0'
            const titleElement = document.createElement('span')
            titleElement.className = 'block truncate text-xs font-medium text-foreground'
            titleElement.textContent = title
            copy.appendChild(titleElement)
            if (subtitle) {
              const subtitleElement = document.createElement('span')
              subtitleElement.className = 'block truncate text-[11px] text-muted-foreground'
              subtitleElement.textContent = subtitle
              copy.appendChild(subtitleElement)
            }
            row.append(dot, copy)
            row.addEventListener('click', (event) => {
              event.stopPropagation()
              selectClusterLeaf(properties)
            })
            list.appendChild(row)
          })
          loaded += leaves.length
          if (loaded >= pointCount || leaves.length === 0) {
            footer.remove()
          } else {
            loadMoreButton.disabled = false
            loadMoreButton.textContent = `Show more (${(pointCount - loaded).toLocaleString()} remaining)`
          }
        } catch {
          loadMoreButton.disabled = true
          loadMoreButton.textContent = 'Could not load more records'
        } finally {
          loading = false
        }
      }
      loadMoreButton.addEventListener('click', (event) => {
        event.stopPropagation()
        void loadNextPage()
      })

      clusterListPopup = new MapLibreGLRuntime.Popup({
        className: 'mapcn-popup',
        anchor: currentMap.project(coordinates).y < currentMap.getCanvas().clientHeight * 0.6 ? 'top' : 'bottom',
        closeButton: false,
        closeOnClick: false,
        maxWidth: 'none',
        offset: 18,
      })
        .setLngLat(coordinates)
        .setDOMContent(panel)
        .addTo(currentMap)
      void loadNextPage()
    }

    const expandTerminalCluster = async (
      source: MapLibreGL.GeoJSONSource,
      clusterId: number,
      coordinates: [number, number],
      pointCount: number,
    ) => {
      if (pointCount > SPIDERFY_LIMIT) {
        showClusterList(source, clusterId, coordinates, pointCount)
        return
      }
      const leaves = await source.getClusterLeaves(clusterId, pointCount, 0)
      if (!cancelled) showSpider(coordinates, leaves)
    }

    const handlePointClick = (event: MapLibreGL.MapMouseEvent) => {
      const rendered = currentMap.queryRenderedFeatures(event.point, { layers: [pointLayerId] })
      const properties = rendered[0]?.properties
      if (!properties) return
      clearExpandedCluster()
      event.preventDefault()
      event.originalEvent?.preventDefault()
      dispatchMobileMapFeatureClick()
      onPointClickRef.current?.(properties)
    }
    const handlePointEnter = () => { currentMap.getCanvas().style.cursor = 'pointer' }
    const handlePointLeave = () => { currentMap.getCanvas().style.cursor = '' }

    const updateMarkers = () => {
      const newMarkers: Record<string, MapLibreGL.Marker> = {}
      for (const feature of currentMap.querySourceFeatures(sourceId)) {
        const props = feature.properties as Record<string, unknown> | null
        if (!props || !props.cluster) continue
        const id = `cluster-${props.cluster_id}`
        let marker = markers[id]
        if (!marker) {
          const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
          const clusterId = props.cluster_id as number
          const element = createDonutElement(props, bandColors, showCount, centerStyle)
          element.addEventListener('click', (domEvent) => {
            domEvent.stopPropagation()
            const source = currentMap.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined
            if (!source) return
            dispatchMobileMapFeatureClick()
            void source.getClusterExpansionZoom(clusterId).then((zoom) => {
              if (expandOverlappingPoints && zoom > clusterMaxZoom) {
                void expandTerminalCluster(source, clusterId, coordinates, Number(props.point_count) || 0)
                return
              }
              clearExpandedCluster()
              currentMap.easeTo({ center: coordinates, zoom, duration: 450 })
            })
          })
          marker = markers[id] = new MapLibreGLRuntime.Marker({ element }).setLngLat(coordinates)
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

    if (!currentMap.getSource(sourceId)) {
      currentMap.addSource(sourceId, {
        type: 'geojson',
        data,
        cluster: true,
        clusterMaxZoom,
        clusterRadius,
        clusterProperties,
      })
    }
    if (!currentMap.getLayer(pointLayerId)) {
      currentMap.addLayer({
        id: pointLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'] as MapLibreGL.ExpressionSpecification,
          'circle-radius': 6,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': pointStrokeColor,
        },
      })
    }
    currentMap.on('render', handleRender)
    currentMap.on('click', pointLayerId, handlePointClick)
    currentMap.on('mouseenter', pointLayerId, handlePointEnter)
    currentMap.on('mouseleave', pointLayerId, handlePointLeave)
    currentMap.on('movestart', clearExpandedCluster)
    if (currentMap.isSourceLoaded(sourceId)) updateMarkers()

    return () => {
      cancelled = true
      currentMap.off('render', handleRender)
      currentMap.off('click', pointLayerId, handlePointClick)
      currentMap.off('mouseenter', pointLayerId, handlePointEnter)
      currentMap.off('mouseleave', pointLayerId, handlePointLeave)
      currentMap.off('movestart', clearExpandedCluster)
      clearExpandedCluster()
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
  }, [isLoaded, map, data, bandColors, clusterMaxZoom, clusterRadius, showCount, centerStyle, pointStrokeColor, expandOverlappingPoints, sourceId, pointLayerId])

  return null
}

type MapPmtilesFillLayerProps = {
  url: string
  sourceLayer: string
  fillColor: string | StyleExpression
  fillOpacity?: number | StyleExpression
  lineColor?: string | StyleExpression
  lineWidth?: number | StyleExpression
  lineOpacity?: number
  idProperty?: string
  selectedId?: string | number | null
  selectedIds?: Array<string | number>
  selectionColor?: string
  selectionWidth?: number
  visible?: boolean
  onFeatureClick?: (
    id: string,
    event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
    properties: Record<string, unknown>,
    lngLat: { lng: number; lat: number } | null,
  ) => void
  hoverHtml?: (properties: Record<string, unknown>) => string | null
}

function MapPmtilesFillLayer({
  url,
  sourceLayer,
  fillColor,
  fillOpacity = 0.72,
  lineColor = BORDER_COLOR,
  lineWidth = 0.4,
  lineOpacity = 0.35,
  idProperty = 'id',
  selectedId = null,
  selectedIds = [],
  selectionColor = SELECTION_COLOR,
  selectionWidth = SELECTION_WIDTH,
  visible = true,
  onFeatureClick,
  hoverHtml,
}: MapPmtilesFillLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `pmtiles-src-${uid}`
  const fillLayerId = `pmtiles-fill-${uid}`
  const lineLayerId = `pmtiles-line-${uid}`
  const selectedLayerId = `pmtiles-sel-${uid}`
  const onClickRef = useRef(onFeatureClick)
  const hoverHtmlRef = useRef(hoverHtml)
  const idPropRef = useRef(idProperty)
  const tooltipRef = useRef<MapLibreGLRuntime.Popup | null>(null)
  const boxZoomWasEnabledRef = useRef(false)
  const doubleClickZoomWasEnabledRef = useRef(false)

  useEffect(() => {
    onClickRef.current = onFeatureClick
  }, [onFeatureClick])

  useEffect(() => {
    hoverHtmlRef.current = hoverHtml
  }, [hoverHtml])

  useEffect(() => {
    idPropRef.current = idProperty
  }, [idProperty])

  // Creation reads the latest style through a ref so recreating the source
  // (url change) keeps current paint without depending on per-render
  // expression identities; live updates flow through the effects below.
  const styleRef = useRef({ fillColor, fillOpacity, lineColor, lineWidth, lineOpacity, selectionColor, selectionWidth, visible })
  useEffect(() => {
    styleRef.current = { fillColor, fillOpacity, lineColor, lineWidth, lineOpacity, selectionColor, selectionWidth, visible }
  })

  useEffect(() => {
    if (!isLoaded || !map || !url) return
    ensurePmtilesProtocol()
    const style = styleRef.current

    map.addSource(sourceId, {
      type: 'vector',
      url: `pmtiles://${url}`,
    })

    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      'source-layer': sourceLayer,
      paint: {
        'fill-color': style.fillColor as never,
        'fill-opacity': style.fillOpacity,
      },
      layout: {
        visibility: style.visible ? 'visible' : 'none',
      },
    })

    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      'source-layer': sourceLayer,
      paint: {
        'line-color': style.lineColor as never,
        'line-width': style.lineWidth,
        'line-opacity': style.lineOpacity,
      },
      layout: {
        visibility: style.visible ? 'visible' : 'none',
      },
    })

    map.addLayer({
      id: selectedLayerId,
      type: 'line',
      source: sourceId,
      'source-layer': sourceLayer,
      filter: ['==', ['get', idPropRef.current], ''] as never,
      paint: {
        'line-color': style.selectionColor,
        'line-width': style.selectionWidth,
        'line-opacity': 1,
      },
      layout: {
        visibility: style.visible ? 'visible' : 'none',
      },
    })

    const removeTooltip = () => {
      tooltipRef.current?.remove()
    }

    const handleClick = (event: unknown) => {
      const e = event as {
        features?: Array<{ properties?: Record<string, unknown> }>
        lngLat?: { lng: number; lat: number }
        originalEvent?: Event & {
          shiftKey?: boolean
          altKey?: boolean
          ctrlKey?: boolean
          metaKey?: boolean
        }
        preventDefault?: () => void
      }
      const properties = e.features?.[0]?.properties
      const id = properties?.[idPropRef.current]
      if (id != null && properties) {
        e.preventDefault?.()
        e.originalEvent?.preventDefault()
        dispatchMobileMapFeatureClick()
        const originalEvent = e.originalEvent
        onClickRef.current?.(String(id), {
          shiftKey: originalEvent?.shiftKey === true,
          altKey: originalEvent?.altKey === true,
          ctrlKey: originalEvent?.ctrlKey === true,
          metaKey: originalEvent?.metaKey === true,
        }, properties, e.lngLat ?? null)
      }
    }

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
      boxZoomWasEnabledRef.current = map.boxZoom.isEnabled()
      if (boxZoomWasEnabledRef.current) map.boxZoom.disable()
      doubleClickZoomWasEnabledRef.current = map.doubleClickZoom.isEnabled()
      if (doubleClickZoomWasEnabledRef.current) map.doubleClickZoom.disable()
    }

    const handleMouseMove = (event: unknown) => {
      const formatter = hoverHtmlRef.current
      if (!formatter) return
      const e = event as {
        features?: Array<{ properties?: Record<string, unknown> }>
        lngLat?: MapLibreGL.LngLatLike
      }
      const properties = e.features?.[0]?.properties
      const html = properties ? formatter(properties) : null
      if (!html || !e.lngLat) {
        removeTooltip()
        return
      }
      if (!tooltipRef.current) {
        tooltipRef.current = new MapLibreGLRuntime.Popup({
          closeButton: false,
          closeOnClick: false,
          className: 'mapcn-tooltip pointer-events-none',
          offset: 12,
        })
      }
      tooltipRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map)
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      if (boxZoomWasEnabledRef.current) {
        map.boxZoom.enable()
        boxZoomWasEnabledRef.current = false
      }
      if (doubleClickZoomWasEnabledRef.current) {
        map.doubleClickZoom.enable()
        doubleClickZoomWasEnabledRef.current = false
      }
      removeTooltip()
    }

    map.on('click', fillLayerId, handleClick as never)
    map.on('mouseenter', fillLayerId, handleMouseEnter)
    map.on('mousemove', fillLayerId, handleMouseMove as never)
    map.on('mouseleave', fillLayerId, handleMouseLeave)

    return () => {
      try {
        map.off('click', fillLayerId, handleClick as never)
        map.off('mouseenter', fillLayerId, handleMouseEnter)
        map.off('mousemove', fillLayerId, handleMouseMove as never)
        map.off('mouseleave', fillLayerId, handleMouseLeave)
        if (boxZoomWasEnabledRef.current) {
          map.boxZoom.enable()
          boxZoomWasEnabledRef.current = false
        }
        if (doubleClickZoomWasEnabledRef.current) {
          map.doubleClickZoom.enable()
          doubleClickZoomWasEnabledRef.current = false
        }
        removeTooltip()
        tooltipRef.current = null
        if (map.getLayer(selectedLayerId)) map.removeLayer(selectedLayerId)
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Map already destroyed during unmount
      }
    }
  }, [fillLayerId, isLoaded, lineLayerId, map, selectedLayerId, sourceId, sourceLayer, url])

  useEffect(() => {
    if (!isLoaded || !map) return
    const visibility = visible ? 'visible' : 'none'
    if (map.getLayer(fillLayerId)) map.setLayoutProperty(fillLayerId, 'visibility', visibility)
    if (map.getLayer(lineLayerId)) map.setLayoutProperty(lineLayerId, 'visibility', visibility)
    if (map.getLayer(selectedLayerId)) map.setLayoutProperty(selectedLayerId, 'visibility', visibility)
  }, [fillLayerId, isLoaded, lineLayerId, map, selectedLayerId, visible])

  useEffect(() => {
    if (!isLoaded || !map) return
    if (map.getLayer(fillLayerId)) {
      map.setPaintProperty(fillLayerId, 'fill-color', fillColor as never)
      map.setPaintProperty(fillLayerId, 'fill-opacity', fillOpacity)
    }
    if (map.getLayer(lineLayerId)) {
      map.setPaintProperty(lineLayerId, 'line-color', lineColor as never)
      map.setPaintProperty(lineLayerId, 'line-width', lineWidth)
      map.setPaintProperty(lineLayerId, 'line-opacity', lineOpacity)
    }
    if (map.getLayer(selectedLayerId)) {
      map.setPaintProperty(selectedLayerId, 'line-color', selectionColor)
      map.setPaintProperty(selectedLayerId, 'line-width', selectionWidth)
    }
  }, [fillColor, fillLayerId, fillOpacity, isLoaded, lineColor, lineLayerId, lineOpacity, lineWidth, map, selectedLayerId, selectionColor, selectionWidth])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    const selectedValues = Array.from(new Set([selectedId, ...selectedIds].filter((id) => id != null)))
    map.setFilter(
      selectedLayerId,
      selectedValues.length > 0
        ? ['in', ['get', idProperty], ['literal', selectedValues]] as never
        : ['==', ['get', idProperty], ''] as never,
    )
  }, [idProperty, isLoaded, map, selectedId, selectedIds, selectedLayerId])

  return null
}

export { MapFillLayer, MapLineLayer, MapRasterLayer, MapHeatmapLayer, MapPieClusterLayer, MapPmtilesFillLayer }
export type {
  MapFillLayerProps,
  MapLineLayerProps,
  MapRasterLayerProps,
  MapHeatmapLayerProps,
  MapPieClusterLayerProps,
  MapPmtilesFillLayerProps,
}
