import { registerMapLayerOrder } from './map-layer-order'
import { retainGeoJsonSource, updateGeoJsonSource, releaseGeoJsonSource } from './map-shared-source'
import { useEffect, useId, useMemo, useRef } from 'react'
import { useMap } from './map'
import { SELECTION_COLOR, SELECTION_WIDTH, BORDER_COLOR, HEATMAP_COLOR_RAMPS, type HeatmapRampName } from './map-styles'
import type MapLibreGL from 'maplibre-gl'
import MapLibreGLRuntime from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { dispatchMobileMapFeatureClick } from './map-context'
import { attachPointerDismiss } from './map-pointer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StyleExpression = any

const EMPTY_SELECTED_IDS: Array<string | number> = []

let pmtilesProtocolRegistered = false

type SharedPmtilesTooltipState = {
  ownerLayerId: string | null
  popup: MapLibreGLRuntime.Popup
}

const pmtilesHoverLayersByMap = new WeakMap<MapLibreGL.Map, Set<string>>()
const pmtilesTooltipByMap = new WeakMap<MapLibreGL.Map, SharedPmtilesTooltipState>()

function ensurePmtilesProtocol() {
  if (pmtilesProtocolRegistered) return
  const protocol = new Protocol()
  MapLibreGLRuntime.addProtocol('pmtiles', protocol.tile)
  pmtilesProtocolRegistered = true
}

function registerPmtilesHoverLayer(map: MapLibreGL.Map, layerId: string) {
  const layerIds = pmtilesHoverLayersByMap.get(map) ?? new Set<string>()
  layerIds.add(layerId)
  pmtilesHoverLayersByMap.set(map, layerIds)

  return () => {
    layerIds.delete(layerId)
    if (layerIds.size === 0) pmtilesHoverLayersByMap.delete(map)
  }
}

function isTopPmtilesHoverLayer(map: MapLibreGL.Map, point: MapLibreGL.PointLike, layerId: string) {
  const registeredLayerIds = pmtilesHoverLayersByMap.get(map)
  if (!registeredLayerIds) return true
  const existingLayerIds = [...registeredLayerIds].filter((registeredLayerId) => map.getLayer(registeredLayerId))
  if (existingLayerIds.length === 0) return true

  return map.queryRenderedFeatures(point, { layers: existingLayerIds })[0]?.layer?.id === layerId
}

function showPmtilesTooltip(map: MapLibreGL.Map, ownerLayerId: string, lngLat: MapLibreGL.LngLatLike, html: string) {
  let state = pmtilesTooltipByMap.get(map)
  if (!state) {
    state = {
      ownerLayerId: null,
      popup: new MapLibreGLRuntime.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'mapcn-tooltip pointer-events-none',
        offset: 12,
      }),
    }
    pmtilesTooltipByMap.set(map, state)
  }

  state.ownerLayerId = ownerLayerId
  state.popup.setLngLat(lngLat).setHTML(html).addTo(map)
}

function removePmtilesTooltip(map: MapLibreGL.Map, ownerLayerId: string) {
  const state = pmtilesTooltipByMap.get(map)
  if (!state || state.ownerLayerId !== ownerLayerId) return
  state.popup.remove()
  state.ownerLayerId = null
}

// =============================================================================
// MapFillLayer
// =============================================================================
// Renders GeoJSON polygons with fill + border + optional selection highlight.
// Covers choropleth (Census, Score Builder), polygon (Parks, Explorer), and
// boundary (Air Quality) use cases with a single composable component.

type MapFillLayerProps = {
  /** GeoJSON FeatureCollection data or a URL MapLibre can fetch */
  data: GeoJSON.FeatureCollection | string
  /** Opt-in sharing for layers with identical data and feature identity. */
  sourceKey?: string
  /** Fill color — static string or MapLibre expression (e.g. ['get', 'color']) */
  layerOrder?: number
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
  /**
   * Crossfade duration in ms for visibility changes. When set, hiding fades
   * fill/line opacity to 0 and only then flips layout visibility, and showing
   * fades back in — instead of the instant on/off pop.
   */
  fadeMs?: number
  /** Callback when a feature is clicked — receives its ID, modifier keys, and properties */
  onFeatureClick?: (
    id: string,
    event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
    properties: Record<string, unknown>,
  ) => void
  /** Optional HTML tooltip for hoverable feature properties. Return null to hide. */
  hoverHtml?: (properties: Record<string, unknown>) => string | null
  /**
   * Fill opacity applied to the feature under the pointer. Off by default;
   * setting it enables MapLibre feature-state hover highlighting, which needs
   * `idProperty` to identify features uniquely.
   */
  hoverFillOpacity?: number
  /** Optional MapLibre filter applied to the base fill and border layers. */
  filter?: StyleExpression
}

function MapFillLayer({
  layerOrder,
  data,
  sourceKey,
  fillColor,
  fillOpacity = 0.72,
  lineColor = BORDER_COLOR,
  lineWidth = 0.7,
  lineOpacity = 0.45,
  idProperty = 'id',
  selectedId = null,
  selectedIds = EMPTY_SELECTED_IDS,
  selectionColor = SELECTION_COLOR,
  selectionWidth = SELECTION_WIDTH,
  selectionStyle = 'line',
  selectionFillOpacity = 0.5,
  visible = true,
  fadeMs,
  onFeatureClick,
  hoverHtml,
  hoverFillOpacity,
  filter,
}: MapFillLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = sourceKey ? `fill-shared-${sourceKey}` : `fill-src-${uid}`
  const fillLayerId = `fill-layer-${uid}`
  const lineLayerId = `fill-line-${uid}`
  const selectedLayerId = `fill-sel-${uid}`

  const onClickRef = useRef(onFeatureClick)
  onClickRef.current = onFeatureClick
  const hoverHtmlRef = useRef(hoverHtml)
  hoverHtmlRef.current = hoverHtml
  const idPropRef = useRef(idProperty)
  idPropRef.current = idProperty
  const filterRef = useRef(filter)
  filterRef.current = filter
  const tooltipRef = useRef<MapLibreGLRuntime.Popup | null>(null)
  const boxZoomWasEnabledRef = useRef(false)
  const doubleClickZoomWasEnabledRef = useRef(false)
  const hoveredIdRef = useRef<string | number | null>(null)

  const hoverEnabled = hoverFillOpacity !== undefined
  // Wrapping the caller's opacity in a feature-state case leaves their
  // expression intact for every feature that is not hovered.
  const resolvedFillOpacity: StyleExpression = hoverEnabled
    ? ['case', ['boolean', ['feature-state', 'hover'], false], hoverFillOpacity, fillOpacity]
    : fillOpacity
  const fadeEnabled = typeof fadeMs === 'number' && fadeMs > 0
  // With fade enabled, a hidden layer's target opacity is 0; layout visibility
  // only flips after the opacity transition has finished.
  const effectiveFillOpacity: StyleExpression = fadeEnabled && !visible ? 0 : resolvedFillOpacity
  const effectiveLineOpacity = fadeEnabled && !visible ? 0 : lineOpacity

  // Mount: create source + layers
  useEffect(() => {
    if (!isLoaded || !map) return

    retainGeoJsonSource(map, sourceId, hoverEnabled ? idPropRef.current : undefined)

    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      ...(filterRef.current && { filter: filterRef.current as never }),
      paint: {
        'fill-color': fillColor as never,
        'fill-opacity': effectiveFillOpacity as never,
        ...(fadeEnabled && { 'fill-opacity-transition': { duration: fadeMs } }),
      },
    })

    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      ...(filterRef.current && { filter: filterRef.current as never }),
      paint: {
        'line-color': lineColor as never,
        'line-width': lineWidth as never,
        'line-opacity': effectiveLineOpacity as never,
        ...(fadeEnabled && { 'line-opacity-transition': { duration: fadeMs } }),
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
      const properties = e.features?.[0]?.properties
      const id = properties?.[idPropRef.current]
      if (id != null) {
        e.preventDefault?.()
        e.originalEvent?.preventDefault()
        dispatchMobileMapFeatureClick()
        const originalEvent = e.originalEvent
        onClickRef.current?.(
          String(id),
          {
            shiftKey: originalEvent?.shiftKey === true,
            altKey: originalEvent?.altKey === true,
            ctrlKey: originalEvent?.ctrlKey === true,
            metaKey: originalEvent?.metaKey === true,
          },
          properties ?? {},
        )
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

    const clearHoverState = () => {
      if (hoveredIdRef.current === null) return
      map.setFeatureState({ source: sourceId, id: hoveredIdRef.current }, { hover: false })
      hoveredIdRef.current = null
    }

    const handleMouseMove = (event: unknown) => {
      const e = event as {
        features?: Array<{ id?: string | number; properties?: Record<string, unknown> }>
        lngLat?: MapLibreGL.LngLatLike
      }

      if (hoverEnabled) {
        const nextId = e.features?.[0]?.id ?? null
        if (nextId !== hoveredIdRef.current) {
          clearHoverState()
          if (nextId !== null) {
            map.setFeatureState({ source: sourceId, id: nextId }, { hover: true })
            hoveredIdRef.current = nextId
          }
        }
      }

      const formatter = hoverHtmlRef.current
      if (!formatter) return
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
      clearHoverState()
      removeTooltip()
    }

    map.on('click', fillLayerId, handleClick as never)
    map.on('mouseenter', fillLayerId, handleMouseEnter)
    map.on('mousemove', fillLayerId, handleMouseMove as never)
    map.on('mouseleave', fillLayerId, handleMouseLeave)
    const detachPointerDismiss = attachPointerDismiss(map, removeTooltip)

    const releaseOrder = registerMapLayerOrder(map, [fillLayerId, lineLayerId, selectedLayerId], layerOrder)

    return () => {
      releaseOrder()
      try {
        map.off('click', fillLayerId, handleClick as never)
        map.off('mouseenter', fillLayerId, handleMouseEnter)
        map.off('mousemove', fillLayerId, handleMouseMove as never)
        map.off('mouseleave', fillLayerId, handleMouseLeave)
        detachPointerDismiss()
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
        releaseGeoJsonSource(map, sourceId)
      } catch {
        // Map already destroyed during unmount
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, sourceId, layerOrder])

  // Update source data
  useEffect(() => {
    if (!isLoaded || !map) return
    updateGeoJsonSource(map, sourceId, data)
  }, [data, isLoaded, map, sourceId])

  // Update the optional base-layer filter without rebuilding the source.
  useEffect(() => {
    if (!isLoaded || !map) return
    if (map.getLayer(fillLayerId)) map.setFilter(fillLayerId, filter as never)
    if (map.getLayer(lineLayerId)) map.setFilter(lineLayerId, filter as never)
  }, [filter, fillLayerId, isLoaded, lineLayerId, map])

  // Update visibility
  useEffect(() => {
    if (!isLoaded || !map) return
    const setVis = (ids: string[], vis: 'visible' | 'none') => {
      for (const id of ids) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
      }
    }
    if (visible || !fadeEnabled) {
      setVis([fillLayerId, lineLayerId, selectedLayerId], visible ? 'visible' : 'none')
      return
    }
    // Fading out: the selection highlight hides at once, but the base layers
    // stay rendered until the opacity transition has finished.
    setVis([selectedLayerId], 'none')
    const timer = setTimeout(() => setVis([fillLayerId, lineLayerId], 'none'), fadeMs)
    return () => clearTimeout(timer)
  }, [visible, fadeEnabled, fadeMs, isLoaded, map, fillLayerId, lineLayerId, selectedLayerId])

  // Update paint when caller changes choropleth styling without remounting the layer.
  useEffect(() => {
    if (!isLoaded || !map) return
    if (map.getLayer(fillLayerId)) {
      map.setPaintProperty(fillLayerId, 'fill-color', fillColor as never)
      map.setPaintProperty(fillLayerId, 'fill-opacity', effectiveFillOpacity as never)
    }
    if (map.getLayer(lineLayerId)) {
      map.setPaintProperty(lineLayerId, 'line-color', lineColor as never)
      map.setPaintProperty(lineLayerId, 'line-width', lineWidth as never)
      map.setPaintProperty(lineLayerId, 'line-opacity', effectiveLineOpacity as never)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effectiveFillOpacity/effectiveLineOpacity are derived from fillOpacity + hoverFillOpacity + lineOpacity + visible + fadeMs
  }, [
    fillColor,
    fillOpacity,
    hoverFillOpacity,
    fillLayerId,
    isLoaded,
    lineColor,
    lineLayerId,
    lineOpacity,
    lineWidth,
    map,
    visible,
    fadeEnabled,
  ])

  // Update selection filter
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    const selectedValues = Array.from(new Set([selectedId, ...selectedIds].filter((id) => id != null)))
    map.setFilter(
      selectedLayerId,
      selectedValues.length > 0
        ? (['in', ['get', idProperty], ['literal', selectedValues]] as never)
        : (['==', ['get', idProperty], ''] as never),
    )
  }, [isLoaded, map, selectedLayerId, selectedId, selectedIds, idProperty])

  return null
}

// =============================================================================
// MapCircleLayer
// =============================================================================
// Renders clickable GeoJSON points as MapLibre circles. This is the point
// counterpart to MapFillLayer for categorical station and site layers.

type MapCircleLayerProps = {
  data: GeoJSON.FeatureCollection | string
  /** Opt-in sharing for layers with identical data and feature identity. */
  sourceKey?: string
  layerOrder?: number
  color: string | StyleExpression
  radius?: number | StyleExpression
  opacity?: number | StyleExpression
  strokeColor?: string | StyleExpression
  strokeWidth?: number | StyleExpression
  idProperty?: string
  selectedId?: string | number | null
  selectionColor?: string
  visible?: boolean
  onFeatureClick?: (
    id: string,
    event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
    properties: Record<string, unknown>,
  ) => void
  hoverHtml?: (properties: Record<string, unknown>) => string | null
  filter?: StyleExpression
}

function MapCircleLayer({
  layerOrder,
  data,
  sourceKey,
  color,
  radius = 5.5,
  opacity = 0.92,
  strokeColor = '#ffffff',
  strokeWidth = 1.25,
  idProperty = 'id',
  selectedId = null,
  selectionColor = SELECTION_COLOR,
  visible = true,
  onFeatureClick,
  hoverHtml,
  filter,
}: MapCircleLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = sourceKey ? `circle-shared-${sourceKey}` : `circle-src-${uid}`
  const layerId = `circle-layer-${uid}`
  const selectedLayerId = `circle-sel-${uid}`
  const onClickRef = useRef(onFeatureClick)
  const hoverHtmlRef = useRef(hoverHtml)
  const idPropRef = useRef(idProperty)
  const filterRef = useRef(filter)
  const tooltipRef = useRef<MapLibreGLRuntime.Popup | null>(null)

  onClickRef.current = onFeatureClick
  hoverHtmlRef.current = hoverHtml
  idPropRef.current = idProperty
  filterRef.current = filter

  useEffect(() => {
    if (!isLoaded || !map) return
    retainGeoJsonSource(map, sourceId)
    map.addLayer({
      id: layerId,
      type: 'circle',
      source: sourceId,
      ...(filterRef.current && { filter: filterRef.current as never }),
      paint: {
        'circle-color': color as never,
        'circle-radius': radius as never,
        'circle-opacity': opacity as never,
        'circle-stroke-color': strokeColor as never,
        'circle-stroke-width': strokeWidth as never,
      },
    })
    map.addLayer({
      id: selectedLayerId,
      type: 'circle',
      source: sourceId,
      filter: ['==', ['get', idPropRef.current], ''] as never,
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': typeof radius === 'number' ? radius + 4 : 10,
        'circle-stroke-color': selectionColor,
        'circle-stroke-width': 3,
      },
    })

    const removeTooltip = () => tooltipRef.current?.remove()
    const handleClick = (event: unknown) => {
      const e = event as {
        features?: Array<{ properties?: Record<string, unknown> }>
        originalEvent?: Event & { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
        preventDefault?: () => void
      }
      const properties = e.features?.[0]?.properties
      const id = properties?.[idPropRef.current]
      if (id == null) return
      e.preventDefault?.()
      e.originalEvent?.preventDefault()
      dispatchMobileMapFeatureClick()
      const originalEvent = e.originalEvent
      onClickRef.current?.(
        String(id),
        {
          shiftKey: originalEvent?.shiftKey === true,
          altKey: originalEvent?.altKey === true,
          ctrlKey: originalEvent?.ctrlKey === true,
          metaKey: originalEvent?.metaKey === true,
        },
        properties ?? {},
      )
    }
    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const handleMouseMove = (event: unknown) => {
      const e = event as {
        features?: Array<{ properties?: Record<string, unknown> }>
        lngLat?: MapLibreGL.LngLatLike
      }
      const properties = e.features?.[0]?.properties
      const html = properties ? hoverHtmlRef.current?.(properties) : null
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
      removeTooltip()
    }

    map.on('click', layerId, handleClick as never)
    map.on('mouseenter', layerId, handleMouseEnter)
    map.on('mousemove', layerId, handleMouseMove as never)
    map.on('mouseleave', layerId, handleMouseLeave)
    const detachPointerDismiss = attachPointerDismiss(map, removeTooltip)

    const releaseOrder = registerMapLayerOrder(map, [layerId, selectedLayerId], layerOrder)

    return () => {
      releaseOrder()
      try {
        map.off('click', layerId, handleClick as never)
        map.off('mouseenter', layerId, handleMouseEnter)
        map.off('mousemove', layerId, handleMouseMove as never)
        map.off('mouseleave', layerId, handleMouseLeave)
        detachPointerDismiss()
        removeTooltip()
        tooltipRef.current = null
        if (!map.getStyle()) return
        if (map.getLayer(selectedLayerId)) map.removeLayer(selectedLayerId)
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        releaseGeoJsonSource(map, sourceId)
      } catch {
        // Map already destroyed during unmount.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, sourceId, layerOrder])

  useEffect(() => {
    if (!isLoaded || !map) return
    updateGeoJsonSource(map, sourceId, data)
  }, [data, isLoaded, map, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    if (map.getLayer(layerId)) map.setFilter(layerId, filter as never)
  }, [filter, isLoaded, layerId, map])

  useEffect(() => {
    if (!isLoaded || !map) return
    const visibility = visible ? 'visible' : 'none'
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibility)
    if (map.getLayer(selectedLayerId)) map.setLayoutProperty(selectedLayerId, 'visibility', visibility)
  }, [isLoaded, layerId, map, selectedLayerId, visible])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return
    map.setPaintProperty(layerId, 'circle-color', color as never)
    map.setPaintProperty(layerId, 'circle-radius', radius as never)
    map.setPaintProperty(layerId, 'circle-opacity', opacity as never)
    map.setPaintProperty(layerId, 'circle-stroke-color', strokeColor as never)
    map.setPaintProperty(layerId, 'circle-stroke-width', strokeWidth as never)
  }, [color, isLoaded, layerId, map, opacity, radius, strokeColor, strokeWidth])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    map.setFilter(
      selectedLayerId,
      selectedId != null
        ? (['==', ['get', idProperty], selectedId] as never)
        : (['==', ['get', idProperty], ''] as never),
    )
  }, [idProperty, isLoaded, map, selectedId, selectedLayerId])

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
    selectionWidth ?? (typeof width === 'number' ? Math.max(width + 2, width * 1.8) : width)

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
      beforeId,
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
    const weightExpr = weight !== undefined ? weight : (['coalesce', ['get', 'weight'], 1] as unknown)
    const opacityValue = typeof opacity === 'number' ? opacity : stopsToInterpolate(opacity)
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

/** Values that require an existing donut marker's SVG to be repainted. */
function getDonutRenderKey(props: Record<string, unknown>, bandColors: readonly string[]): string {
  return [
    Number(props.aggregate_count) || Number(props.count) || 0,
    Number(props.point_count) || 0,
    ...bandColors.map((_, index) => Number(props[`band${index}`]) || 0),
  ].join(':')
}

/**
 * Paint a donut marker from its aggregated band counts, with the total in the
 * hollow centre when showCount is set. Updating the existing root keeps the
 * MapLibre marker mounted while its SVG changes.
 */
function updateDonutElement(
  element: HTMLDivElement,
  props: Record<string, unknown>,
  bandColors: readonly string[],
  showCount: boolean,
  centerStyle: 'white' | 'transparent',
): void {
  const counts = bandColors.map((_, index) => Number(props[`band${index}`]) || 0)
  const total =
    Number(props.aggregate_count) ||
    Number(props.count) ||
    Number(props.point_count) ||
    counts.reduce((sum, count) => sum + count, 0)
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
}

function createDonutElement(
  props: Record<string, unknown>,
  bandColors: readonly string[],
  showCount: boolean,
  centerStyle: 'white' | 'transparent',
): HTMLDivElement {
  const element = document.createElement('div')
  updateDonutElement(element, props, bandColors, showCount, centerStyle)
  return element
}

function pieMarkerDonutProperties(
  properties: Record<string, unknown>,
  bandColors: readonly string[],
): Record<string, unknown> {
  let rawCounts: unknown[] = []
  if (Array.isArray(properties.bandCounts)) {
    rawCounts = properties.bandCounts
  } else if (typeof properties.bandCounts === 'string') {
    try {
      const parsed = JSON.parse(properties.bandCounts) as unknown
      if (Array.isArray(parsed)) rawCounts = parsed
    } catch {
      // MapLibre normally JSON-encodes array properties; malformed input falls
      // back to an empty set of wedges while retaining the location count.
    }
  }
  const counts = bandColors.map((_, index) => Number(rawCounts[index]) || 0)
  const countedTotal = counts.reduce((sum, count) => sum + count, 0)
  const total = Number(properties.count) || countedTotal
  return Object.fromEntries([['point_count', total], ...counts.map((count, index) => [`band${index}`, count] as const)])
}

const SPIDERFY_LIMIT = 16
const CLUSTER_LIST_PAGE_SIZE = 50

function getClusterLeafProperties(feature: GeoJSON.Feature): Record<string, unknown> {
  return (feature.properties ?? {}) as Record<string, unknown>
}

function getClusterLeafTitle(properties: Record<string, unknown>, fallbackIndex: number): string {
  const label = String(properties.spiderTitle ?? properties.name ?? '').trim()
  return label || `Record ${fallbackIndex + 1}`
}

function createSpiderElement(
  leaves: GeoJSON.Feature[],
  onSelect: (properties: Record<string, unknown>) => void,
  pieStyle?: {
    bandColors: readonly string[]
    showCount: boolean
    centerStyle: 'white' | 'transparent'
  },
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
  const radius = pieStyle ? (count <= 8 ? 64 : 82) : count <= 8 ? 42 : 58
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const motionEasing = 'cubic-bezier(0.22, 1, 0.36, 1)'
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
    const countLabel = pieStyle ? `${Number(properties.count) || 0} publications` : ''
    button.setAttribute(
      'aria-label',
      subtitle ? `${title}, ${subtitle}` : countLabel ? `${title}, ${countLabel}` : title,
    )
    button.title = subtitle ? `${title}\n${subtitle}` : title
    button.style.position = 'absolute'
    button.style.left = `${x}px`
    button.style.top = `${y}px`
    button.style.padding = '0'
    if (pieStyle) {
      const donut = createDonutElement(
        pieMarkerDonutProperties(properties, pieStyle.bandColors),
        pieStyle.bandColors,
        pieStyle.showCount,
        pieStyle.centerStyle,
      )
      button.style.width = donut.style.width
      button.style.height = donut.style.height
      button.style.border = '0'
      button.style.borderRadius = '9999px'
      button.style.background = 'transparent'
      button.appendChild(donut)
    } else {
      button.style.width = '18px'
      button.style.height = '18px'
      button.style.border = '2px solid #ffffff'
      button.style.borderRadius = '9999px'
      button.style.background = color
      button.style.boxShadow = '0 1px 4px rgba(15,23,42,0.5)'
    }
    button.style.cursor = 'pointer'
    button.style.pointerEvents = 'auto'
    button.style.transform = 'translate(-50%, -50%)'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      onSelect(properties)
    })
    root.appendChild(button)

    if (!reduceMotion) {
      const distance = Math.hypot(x, y)
      const delay = index * 40

      for (const connector of [halo, line]) {
        connector.style.strokeDasharray = String(distance)
        connector.style.strokeDashoffset = '0'
      }

      requestAnimationFrame(() => {
        for (const connector of [halo, line]) {
          connector.animate(
            [
              { opacity: 0, strokeDashoffset: String(distance) },
              { opacity: 1, strokeDashoffset: '0' },
            ],
            {
              duration: 300,
              delay,
              easing: motionEasing,
              fill: 'both',
            },
          )
        }

        button.animate(
          [
            {
              opacity: 0,
              transform: `translate(-50%, -50%) translate(${-x}px, ${-y}px) scale(0.7)`,
            },
            {
              opacity: 1,
              transform: 'translate(-50%, -50%) translate(0, 0) scale(1)',
            },
          ],
          {
            duration: 360,
            delay,
            easing: motionEasing,
            fill: 'both',
          },
        )
      })
    }
  })

  return root
}

type MapPieClusterLayerProps = {
  /** GeoJSON points carrying `bandIndex`/`color`, or pre-aggregated `count`/`bandCounts`, properties. */
  data: GeoJSON.FeatureCollection<GeoJSON.Point>
  /** Wedge color per band, indexed by each feature's `bandIndex`. */
  bandColors: readonly string[]
  /** Maximum clustering zoom, or the record-expansion threshold when expandOverlappingPoints is enabled (default: 14). */
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
   * Treat each input feature as an already-aggregated location. Clusters sum
   * `count` and `bandCounts`, while isolated features remain full pie markers.
   */
  preAggregated?: boolean
  /** Property used to label isolated pre-aggregated points. */
  pointLabelProperty?: string
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
  preAggregated = false,
  pointLabelProperty,
  expandOverlappingPoints = false,
  onPointClick,
}: MapPieClusterLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `pie-cluster-src-${uid}`
  const pointLayerId = `pie-cluster-points-${uid}`
  const labelLayerId = `pie-cluster-labels-${uid}`
  const onPointClickRef = useRef(onPointClick)

  useEffect(() => {
    onPointClickRef.current = onPointClick
  }, [onPointClick])

  useEffect(() => {
    if (!isLoaded || !map) return
    const currentMap = map
    // Retain clusters through every reachable camera zoom. Otherwise wheel,
    // pinch, or URL zoom can bypass terminal-cluster clicks and hide coincident
    // records behind a single dot. Keep clusterMaxZoom as the click threshold.
    const sourceClusterMaxZoom = expandOverlappingPoints
      ? Math.max(clusterMaxZoom, Math.ceil(currentMap.getMaxZoom()))
      : clusterMaxZoom
    let cancelled = false
    type DonutMarkerState = {
      marker: MapLibreGL.Marker
      element: HTMLDivElement
      renderKey: string
      clickState: {
        coordinates: [number, number]
        clusterId: number | null
        pointCount: number
        isCluster: boolean
        properties: Record<string, unknown>
      }
    }
    const markers: Record<string, DonutMarkerState> = {}
    let markersOnScreen: Record<string, DonutMarkerState> = {}
    let spiderMarker: MapLibreGL.Marker | null = null
    let clusterListPopup: MapLibreGL.Popup | null = null
    let expandedClusterElement: HTMLElement | null = null

    const clusterProperties: Record<string, MapLibreGL.ExpressionSpecification> = {}
    bandColors.forEach((_, index) => {
      clusterProperties[`band${index}`] = preAggregated
        ? ['+', ['coalesce', ['at', index, ['get', 'bandCounts']], 0]]
        : ['+', ['case', ['==', ['get', 'bandIndex'], index], 1, 0]]
    })
    if (preAggregated) {
      clusterProperties.aggregate_count = ['+', ['coalesce', ['get', 'count'], 0]]
    }

    const clearExpandedCluster = () => {
      spiderMarker?.remove()
      clusterListPopup?.remove()
      expandedClusterElement?.style.removeProperty('visibility')
      spiderMarker = null
      clusterListPopup = null
      expandedClusterElement = null
    }

    const selectClusterLeaf = (properties: Record<string, unknown>) => {
      clearExpandedCluster()
      dispatchMobileMapFeatureClick()
      onPointClickRef.current?.(properties)
    }

    const showSpider = (coordinates: [number, number], leaves: GeoJSON.Feature[], clusterElement: HTMLElement) => {
      clearExpandedCluster()
      expandedClusterElement = clusterElement
      clusterElement.style.visibility = 'hidden'
      const element = createSpiderElement(
        leaves,
        selectClusterLeaf,
        preAggregated ? { bandColors, showCount, centerStyle } : undefined,
      )
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
      panel.className =
        'w-[min(19rem,calc(100vw-3rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl'

      const header = document.createElement('div')
      header.className = 'flex items-center justify-between gap-3 border-b border-border px-3 py-2.5'
      const heading = document.createElement('div')
      heading.className = 'text-sm font-semibold'
      heading.textContent = `${pointCount.toLocaleString()} overlapping records`
      const closeButton = document.createElement('button')
      closeButton.type = 'button'
      closeButton.className =
        'rounded px-1.5 py-0.5 text-lg leading-none text-muted-foreground hover:bg-accent hover:text-foreground'
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
      loadMoreButton.className =
        'w-full rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:opacity-80'
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
      clusterElement: HTMLElement,
    ) => {
      if (pointCount > SPIDERFY_LIMIT) {
        showClusterList(source, clusterId, coordinates, pointCount)
        return
      }
      const leaves = await source.getClusterLeaves(clusterId, pointCount, 0)
      if (!cancelled) showSpider(coordinates, leaves, clusterElement)
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
    const handlePointEnter = () => {
      currentMap.getCanvas().style.cursor = 'pointer'
    }
    const handlePointLeave = () => {
      currentMap.getCanvas().style.cursor = ''
    }

    const updateMarkers = () => {
      const newMarkers: Record<string, DonutMarkerState> = {}
      for (const feature of currentMap.querySourceFeatures(sourceId)) {
        const props = feature.properties as Record<string, unknown> | null
        if (!props) continue
        const isCluster = Boolean(props.cluster)
        if (!isCluster && !preAggregated) continue
        const id = isCluster
          ? `cluster-${props.cluster_id}`
          : `point-${String(props.id ?? feature.id ?? (feature.geometry as GeoJSON.Point).coordinates.join(','))}`
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
        const clusterId = isCluster ? Number(props.cluster_id) : null
        const pointCount = isCluster ? Number(props.point_count) || 0 : 1
        const donutProps = isCluster ? props : pieMarkerDonutProperties(props, bandColors)
        const renderKey = getDonutRenderKey(donutProps, bandColors)
        let markerState = markers[id]
        if (!markerState) {
          const element = createDonutElement(donutProps, bandColors, showCount, centerStyle)
          const clickState = { coordinates, clusterId, pointCount, isCluster, properties: props }
          element.addEventListener('click', (domEvent) => {
            domEvent.stopPropagation()
            dispatchMobileMapFeatureClick()
            const current = clickState
            if (!current.isCluster || current.clusterId === null) {
              onPointClickRef.current?.(current.properties)
              return
            }
            const currentClusterId = current.clusterId
            const source = currentMap.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined
            if (!source) return
            void source.getClusterExpansionZoom(currentClusterId).then((zoom) => {
              if (expandOverlappingPoints && zoom > clusterMaxZoom) {
                void expandTerminalCluster(source, currentClusterId, current.coordinates, current.pointCount, element)
                return
              }
              clearExpandedCluster()
              currentMap.easeTo({ center: current.coordinates, zoom, duration: 450 })
            })
          })
          markerState = markers[id] = {
            marker: new MapLibreGLRuntime.Marker({ element }).setLngLat(coordinates),
            element,
            renderKey,
            clickState,
          }
        } else {
          // MapLibre may reuse a cluster id after setData(). Reconcile the DOM
          // marker as well as its click metadata so a data/filter change is
          // visible immediately, without waiting for a zoom to mint new ids.
          markerState.clickState.coordinates = coordinates
          markerState.clickState.clusterId = clusterId
          markerState.clickState.pointCount = pointCount
          markerState.clickState.isCluster = isCluster
          markerState.clickState.properties = props
          markerState.marker.setLngLat(coordinates)
          if (markerState.renderKey !== renderKey) {
            updateDonutElement(markerState.element, donutProps, bandColors, showCount, centerStyle)
            markerState.renderKey = renderKey
          }
        }
        newMarkers[id] = markerState
        if (!markersOnScreen[id]) markerState.marker.addTo(currentMap)
      }
      for (const id of Object.keys(markersOnScreen)) {
        if (newMarkers[id]) continue
        markersOnScreen[id].marker.remove()
        // Re-clustering mints fresh cluster ids, so the cache would otherwise
        // accumulate a full set of orphaned donut elements per data update.
        delete markers[id]
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
        // Start empty and let the data effect below submit the real collection.
        // Keeping `data` out of this effect's dependencies is the point: it used
        // to tear down the source, the layer, and every donut on screen on each
        // new collection, which read as the whole layer blinking out whenever a
        // timeline scrub produced a new set.
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: sourceClusterMaxZoom,
        maxzoom: Math.max(18, sourceClusterMaxZoom + 1),
        clusterRadius,
        clusterProperties,
      })
    }
    if (!currentMap.getLayer(pointLayerId)) {
      currentMap.addLayer({
        id: pointLayerId,
        type: 'circle',
        source: sourceId,
        filter: preAggregated ? ['has', '__pgmaps_hidden_point__'] : ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'] as MapLibreGL.ExpressionSpecification,
          'circle-radius': 6,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': pointStrokeColor,
        },
      })
    }
    if (pointLabelProperty && !currentMap.getLayer(labelLayerId)) {
      currentMap.addLayer({
        id: labelLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['get', pointLabelProperty],
          'text-size': 11,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-max-width': 8,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#334155',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
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
      Object.values(markersOnScreen).forEach(({ marker }) => marker.remove())
      Object.values(markers).forEach(({ marker }) => marker.remove())
      markersOnScreen = {}
      try {
        currentMap.getCanvas().style.cursor = ''
        if (currentMap.getLayer(labelLayerId)) currentMap.removeLayer(labelLayerId)
        if (currentMap.getLayer(pointLayerId)) currentMap.removeLayer(pointLayerId)
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [
    isLoaded,
    map,
    bandColors,
    clusterMaxZoom,
    clusterRadius,
    showCount,
    centerStyle,
    pointStrokeColor,
    preAggregated,
    pointLabelProperty,
    expandOverlappingPoints,
    sourceId,
    pointLayerId,
    labelLayerId,
  ])

  // Update source data in place. MapLibre re-clusters in a worker, and the render
  // handler above leaves the existing donuts alone until the source reports loaded
  // again — so the previous clustering stays painted until the new one is ready.
  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined
    source?.setData(data)
  }, [data, isLoaded, map, sourceId])

  return null
}

type MapPmtilesFillLayerProps = {
  url: string
  sourceLayer: string
  layerOrder?: number
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
  /** Optional MapLibre filter applied to the vector fill and border layers. */
  filter?: StyleExpression
}

function MapPmtilesFillLayer({
  layerOrder,
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
  filter,
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
  const filterRef = useRef(filter)
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

  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  // Creation reads the latest style through a ref so recreating the source
  // (url change) keeps current paint without depending on per-render
  // expression identities; live updates flow through the effects below.
  const styleRef = useRef({
    fillColor,
    fillOpacity,
    lineColor,
    lineWidth,
    lineOpacity,
    selectionColor,
    selectionWidth,
    visible,
  })
  useEffect(() => {
    styleRef.current = {
      fillColor,
      fillOpacity,
      lineColor,
      lineWidth,
      lineOpacity,
      selectionColor,
      selectionWidth,
      visible,
    }
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
      ...(filterRef.current && { filter: filterRef.current as never }),
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
      ...(filterRef.current && { filter: filterRef.current as never }),
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

    const unregisterHoverLayer = registerPmtilesHoverLayer(map, fillLayerId)

    const removeTooltip = () => {
      removePmtilesTooltip(map, fillLayerId)
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
        onClickRef.current?.(
          String(id),
          {
            shiftKey: originalEvent?.shiftKey === true,
            altKey: originalEvent?.altKey === true,
            ctrlKey: originalEvent?.ctrlKey === true,
            metaKey: originalEvent?.metaKey === true,
          },
          properties,
          e.lngLat ?? null,
        )
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
        point?: MapLibreGL.PointLike
      }
      if (e.point && !isTopPmtilesHoverLayer(map, e.point, fillLayerId)) {
        removeTooltip()
        return
      }
      const properties = e.features?.[0]?.properties
      const html = properties ? formatter(properties) : null
      if (!html || !e.lngLat) {
        removeTooltip()
        return
      }
      showPmtilesTooltip(map, fillLayerId, e.lngLat, html)
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

    const releaseOrder = registerMapLayerOrder(map, [fillLayerId, lineLayerId, selectedLayerId], layerOrder)

    return () => {
      releaseOrder()
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
        unregisterHoverLayer()
        if (map.getLayer(selectedLayerId)) map.removeLayer(selectedLayerId)
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Map already destroyed during unmount
      }
    }
  }, [fillLayerId, isLoaded, layerOrder, lineLayerId, map, selectedLayerId, sourceId, sourceLayer, url])

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
  }, [
    fillColor,
    fillLayerId,
    fillOpacity,
    isLoaded,
    lineColor,
    lineLayerId,
    lineOpacity,
    lineWidth,
    map,
    selectedLayerId,
    selectionColor,
    selectionWidth,
  ])

  useEffect(() => {
    if (!isLoaded || !map) return
    const nextFilter = filter ? (filter as never) : null
    if (map.getLayer(fillLayerId)) map.setFilter(fillLayerId, nextFilter)
    if (map.getLayer(lineLayerId)) map.setFilter(lineLayerId, nextFilter)
  }, [fillLayerId, filter, isLoaded, lineLayerId, map])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    const selectedValues = Array.from(new Set([selectedId, ...selectedIds].filter((id) => id != null)))
    map.setFilter(
      selectedLayerId,
      selectedValues.length > 0
        ? (['in', ['get', idProperty], ['literal', selectedValues]] as never)
        : (['==', ['get', idProperty], ''] as never),
    )
  }, [idProperty, isLoaded, map, selectedId, selectedIds, selectedLayerId])

  return null
}

export {
  MapFillLayer,
  MapCircleLayer,
  MapLineLayer,
  MapRasterLayer,
  MapHeatmapLayer,
  MapPieClusterLayer,
  MapPmtilesFillLayer,
}
export type {
  MapFillLayerProps,
  MapCircleLayerProps,
  MapLineLayerProps,
  MapRasterLayerProps,
  MapHeatmapLayerProps,
  MapPieClusterLayerProps,
  MapPmtilesFillLayerProps,
}
