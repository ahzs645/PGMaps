import { useEffect, useId, useRef } from 'react'
import { useMap, dispatchMobileMapFeatureClick } from '../map-context.js'
import { registerMapLayerOrder } from '../map-layer-order.js'
import { SELECTION_COLOR, SELECTION_WIDTH, BORDER_COLOR } from '../map-styles.js'
import {
  EMPTY_SELECTED_IDS,
  type MapStyleExpression,
  type MapStyleValue,
  type MapFeatureId,
  type MapFeatureModifiers,
} from './types.js'
import {
  ensurePmtilesProtocol,
  registerPmtilesHoverLayer,
  isTopPmtilesHoverLayer,
  showPmtilesTooltip,
  removePmtilesTooltip,
} from './pmtiles-runtime.js'
import type MapLibreGL from 'maplibre-gl'

export type MapPmtilesFillLayerProps = {
  url: string
  sourceLayer: string
  layerOrder?: number
  fillColor: MapStyleValue<string>
  fillOpacity?: MapStyleValue<number>
  lineColor?: MapStyleValue<string>
  lineWidth?: MapStyleValue<number>
  lineOpacity?: number
  idProperty?: string
  /** Read the vector tile feature ID instead of an attribute for selection. */
  idSource?: 'property' | 'feature'
  selectedId?: string | number | null
  selectedIds?: readonly MapFeatureId[]
  selectionColor?: string
  selectionWidth?: number
  visible?: boolean
  onFeatureClick?: (
    id: string,
    event: MapFeatureModifiers,
    properties: Record<string, unknown>,
    lngLat: { lng: number; lat: number } | null,
  ) => void
  hoverHtml?: (properties: Record<string, unknown>) => string | null
  /** Optional MapLibre filter applied to the vector fill and border layers. */
  filter?: MapStyleExpression | null
}

export function MapPmtilesFillLayer({
  layerOrder,
  url,
  sourceLayer,
  fillColor,
  fillOpacity = 0.72,
  lineColor = BORDER_COLOR,
  lineWidth = 0.4,
  lineOpacity = 0.35,
  idProperty = 'id',
  idSource = 'property',
  selectedId = null,
  selectedIds = EMPTY_SELECTED_IDS,
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
  const idSourceRef = useRef(idSource)
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
    idSourceRef.current = idSource
  }, [idSource])

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
        'fill-opacity': style.fillOpacity as never,
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
        'line-width': style.lineWidth as never,
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
        features?: Array<{ id?: string | number; properties?: Record<string, unknown> }>
        lngLat?: { lng: number; lat: number }
        originalEvent?: Event & {
          shiftKey?: boolean
          altKey?: boolean
          ctrlKey?: boolean
          metaKey?: boolean
        }
        preventDefault?: () => void
      }
      const feature = e.features?.[0]
      const properties = feature?.properties
      const id = idSourceRef.current === 'feature' ? feature?.id : properties?.[idPropRef.current]
      if (id != null && properties) {
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
        ? (['in', idSource === 'feature' ? ['id'] : ['get', idProperty], ['literal', selectedValues]] as never)
        : (['==', idSource === 'feature' ? ['id'] : ['get', idProperty], ''] as never),
    )
  }, [idProperty, idSource, isLoaded, map, selectedId, selectedIds, selectedLayerId])

  return null
}
