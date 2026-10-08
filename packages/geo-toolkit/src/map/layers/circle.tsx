import { useEffect, useId, useRef } from 'react'
import { useMap, dispatchMobileMapFeatureClick } from '../map-context.js'
import { registerMapLayerOrder } from '../map-layer-order.js'
import { retainGeoJsonSource, updateGeoJsonSource, releaseGeoJsonSource } from '../map-shared-source.js'
import { attachPointerDismiss } from '../map-pointer.js'
import { SELECTION_COLOR } from '../map-styles.js'
import { type MapStyleExpression, type MapStyleValue, type MapFeatureModifiers } from './types.js'
import type MapLibreGL from 'maplibre-gl'
import MapLibreGLRuntime from 'maplibre-gl'

export type MapCircleLayerProps = {
  data: GeoJSON.FeatureCollection | string
  /** Opt-in sharing for layers with identical data and feature identity. */
  sourceKey?: string
  layerOrder?: number
  color: MapStyleValue<string>
  radius?: MapStyleValue<number>
  opacity?: MapStyleValue<number>
  strokeColor?: MapStyleValue<string>
  strokeWidth?: MapStyleValue<number>
  idProperty?: string
  selectedId?: string | number | null
  selectionColor?: string
  visible?: boolean
  onFeatureClick?: (id: string, event: MapFeatureModifiers, properties: Record<string, unknown>) => void
  hoverHtml?: (properties: Record<string, unknown>) => string | null
  /** Disable and dismiss hover cards while an external interaction is active. */
  hoverEnabled?: boolean
  filter?: MapStyleExpression | null
}

export function MapCircleLayer({
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
  hoverEnabled = true,
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
  const hoverEnabledRef = useRef(hoverEnabled)

  useEffect(() => {
    hoverEnabledRef.current = hoverEnabled
    if (!hoverEnabled) tooltipRef.current?.remove()
  }, [hoverEnabled])

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
    const handleMouseEnter = () => {
      if (!hoverEnabledRef.current || map.isMoving()) return
      map.getCanvas().style.cursor = 'pointer'
    }
    const handleMouseMove = (event: unknown) => {
      const e = event as {
        features?: Array<{ properties?: Record<string, unknown> }>
        lngLat?: MapLibreGL.LngLatLike
        originalEvent?: MouseEvent
      }
      if (!hoverEnabledRef.current || e.originalEvent?.buttons || map.isMoving()) {
        removeTooltip()
        return
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
    map.on('movestart', removeTooltip)
    const detachPointerDismiss = attachPointerDismiss(map, removeTooltip)

    const releaseOrder = registerMapLayerOrder(map, [layerId, selectedLayerId], layerOrder)

    return () => {
      releaseOrder()
      try {
        map.off('click', layerId, handleClick as never)
        map.off('mouseenter', layerId, handleMouseEnter)
        map.off('mousemove', layerId, handleMouseMove as never)
        map.off('mouseleave', layerId, handleMouseLeave)
        map.off('movestart', removeTooltip)
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
