import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from '@/lib/forestry/terrain/terrain'

/**
 * Context contours over the whole plan, traced in a worker from the same regional DEM tiles as
 * the context relief (`RegionalDemLayer`). They are drawn only: a loaded terrain sits on top with
 * its own contours, and nothing reads ground from these.
 */
export const REGIONAL_CONTOUR_SOURCE = 'road-regional-contours'
export const REGIONAL_CONTOUR_LAYERS = ['road-regional-contours-minor', 'road-regional-contours-major'] as const
/** The source is no finer than z12 (about 22 m cells here), so no line closer than 10 m. */
export const REGIONAL_CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
  9: [100, 500],
  11: [50, 250],
  12: [20, 100],
  13: [10, 50],
}
const REGIONAL_DEM_MAX_ZOOM = 12
const REGIONAL_CONTOUR_MIN_ZOOM = 9
const REGIONAL_CONTOUR_MAX_ZOOM = 15

/** Lighter than a loaded terrain's contours (`CONTOUR_PAINT`), so the detailed area still reads as such. */
const PAINT = {
  light: { color: '#57534e', minor: 0.22, major: 0.38 },
  dark: { color: '#d6d3d1', minor: 0.16, major: 0.28 },
  imagery: { color: '#f5f5f4', minor: 0.22, major: 0.38 },
} as const

let contourTiles: Promise<string> | null = null
/** One DEM source and protocol for the app: MapLibre's protocols are global. */
function regionalContourTiles(): Promise<string> {
  contourTiles ??= import('maplibre-contour').then(({ default: mlcontour }) => {
    const source = new mlcontour.DemSource({
      url: TERRARIUM_TILE_URL,
      encoding: 'terrarium',
      maxzoom: REGIONAL_DEM_MAX_ZOOM,
      worker: true,
      id: 'pgmaps-regional-dem',
    })
    source.setupMaplibre(maplibregl)
    return source.contourProtocolUrl({ thresholds: REGIONAL_CONTOUR_THRESHOLDS, contourLayer: 'contours' })
  })
  return contourTiles
}

export function RegionalContourLayer({
  visible,
  dark,
  imagery,
}: {
  visible: boolean
  dark: boolean
  imagery: boolean
}) {
  const { map, isLoaded } = useMap()
  const paint = PAINT[imagery ? 'imagery' : dark ? 'dark' : 'light']
  // The layers arrive after the protocol's import, so they take the paint current then.
  const latestPaint = useRef(paint)
  useEffect(() => {
    latestPaint.current = paint
  }, [paint])

  useEffect(() => {
    if (!map || !isLoaded || !visible) return
    let cancelled = false
    void regionalContourTiles().then((tiles) => {
      if (cancelled || !map.getStyle()) return
      if (!map.getSource(REGIONAL_CONTOUR_SOURCE))
        map.addSource(REGIONAL_CONTOUR_SOURCE, {
          type: 'vector',
          tiles: [tiles],
          minzoom: REGIONAL_CONTOUR_MIN_ZOOM,
          maxzoom: REGIONAL_CONTOUR_MAX_ZOOM,
          attribution: TERRAIN_ATTRIBUTION,
        })
      // Under any loaded terrain image, so detail always covers the context.
      const beforeId = map.getLayer('road-terrain')
        ? 'road-terrain'
        : map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
      REGIONAL_CONTOUR_LAYERS.forEach((id, major) => {
        if (map.getLayer(id)) return
        map.addLayer(
          {
            id,
            type: 'line',
            source: REGIONAL_CONTOUR_SOURCE,
            'source-layer': 'contours',
            minzoom: REGIONAL_CONTOUR_MIN_ZOOM,
            filter: major ? ['>', ['get', 'level'], 0] : ['==', ['get', 'level'], 0],
            layout: { 'line-join': 'round' },
            paint: {
              'line-width': major ? 0.9 : 0.5,
              'line-color': latestPaint.current.color,
              'line-opacity': major ? latestPaint.current.major : latestPaint.current.minor,
            },
          },
          beforeId,
        )
      })
    })
    return () => {
      cancelled = true
      if (!map.getStyle()) return
      for (const id of REGIONAL_CONTOUR_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(REGIONAL_CONTOUR_SOURCE)) map.removeSource(REGIONAL_CONTOUR_SOURCE)
    }
  }, [map, isLoaded, visible])

  useEffect(() => {
    if (!map || !isLoaded || !visible) return
    REGIONAL_CONTOUR_LAYERS.forEach((id, major) => {
      if (!map.getLayer(id)) return
      map.setPaintProperty(id, 'line-color', paint.color)
      map.setPaintProperty(id, 'line-opacity', major ? paint.major : paint.minor)
    })
  }, [map, isLoaded, visible, paint])

  return null
}
