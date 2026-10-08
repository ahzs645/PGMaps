import { useEffect, useId, useMemo } from 'react'
import { useMap } from '../map-context.js'
import { HEATMAP_COLOR_RAMPS, type HeatmapRampName } from '../map-styles.js'
import { type MapStyleValue } from './types.js'
import type MapLibreGL from 'maplibre-gl'

export type ZoomStops = ReadonlyArray<readonly [zoom: number, value: number]>

export type ColorStops = ReadonlyArray<readonly [density: number, color: string]>

export type MapHeatmapLayerProps = {
  /** GeoJSON FeatureCollection of points. Features can carry a numeric `weight` property. */
  data: GeoJSON.FeatureCollection<GeoJSON.Point>
  /** Whether the layer is visible (default: true). */
  visible?: boolean
  /**
   * Per-feature weight expression. Defaults to ['coalesce', ['get', 'weight'], 1]
   * so points without a weight property contribute uniformly.
   */
  weight?: MapStyleValue<number>
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

export function MapHeatmapLayer({
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
