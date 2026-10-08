import { useEffect, useId, useRef } from 'react'
import { useMap, dispatchMobileMapFeatureClick } from '../map-context.js'
import { registerMapLayerOrder } from '../map-layer-order.js'
import { retainGeoJsonSource, updateGeoJsonSource, releaseGeoJsonSource } from '../map-shared-source.js'
import { attachPointerDismiss } from '../map-pointer.js'
import { SELECTION_COLOR, SELECTION_WIDTH, BORDER_COLOR } from '../map-styles.js'
import {
  EMPTY_SELECTED_IDS,
  type MapStyleExpression,
  type MapStyleValue,
  type MapFeatureId,
  type MapFeatureModifiers,
} from './types.js'
import type MapLibreGL from 'maplibre-gl'
import MapLibreGLRuntime from 'maplibre-gl'

export type MapFillLayerProps = {
  /** GeoJSON FeatureCollection data or a URL MapLibre can fetch */
  data: GeoJSON.FeatureCollection | string
  /** Opt-in sharing for layers with identical data and feature identity. */
  sourceKey?: string
  /** Fill color — static string or MapLibre expression (e.g. ['get', 'color']) */
  layerOrder?: number
  fillColor: MapStyleValue<string>
  /** Fill opacity (default: 0.72) — number or MapLibre expression */
  fillOpacity?: MapStyleValue<number>
  /** Border line color — static string or MapLibre expression (default: '#0f172a') */
  lineColor?: MapStyleValue<string>
  /** Border line width (default: 0.7) — number or MapLibre expression */
  lineWidth?: MapStyleValue<number>
  /** Border line opacity (default: 0.45) */
  lineOpacity?: number
  /** Feature property used for identification and selection (default: 'id') */
  idProperty?: string
  /** Currently selected feature ID — drives the selection highlight */
  selectedId?: string | number | null
  /** Multiple selected feature IDs — combined with selectedId for the selection highlight */
  selectedIds?: readonly MapFeatureId[]
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
  onFeatureClick?: (id: string, event: MapFeatureModifiers, properties: Record<string, unknown>) => void
  /** Optional HTML tooltip for hoverable feature properties. Return null to hide. */
  hoverHtml?: (properties: Record<string, unknown>) => string | null
  /**
   * Fill opacity applied to the feature under the pointer. Off by default;
   * setting it enables MapLibre feature-state hover highlighting, which needs
   * `idProperty` to identify features uniquely.
   */
  hoverFillOpacity?: number
  /** Optional MapLibre filter applied to the base fill and border layers. */
  filter?: MapStyleExpression | null
}

export function MapFillLayer({
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
  const resolvedFillOpacity: MapStyleValue<number> = hoverEnabled
    ? ['case', ['boolean', ['feature-state', 'hover'], false], hoverFillOpacity, fillOpacity]
    : fillOpacity
  const fadeEnabled = typeof fadeMs === 'number' && fadeMs > 0
  // With fade enabled, a hidden layer's target opacity is 0; layout visibility
  // only flips after the opacity transition has finished.
  const effectiveFillOpacity: MapStyleValue<number> = fadeEnabled && !visible ? 0 : resolvedFillOpacity
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
        dispatchMobileMapFeatureClick(map)
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
