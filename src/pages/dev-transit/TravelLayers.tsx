import { useEffect, useMemo, useRef } from 'react'
import { contours as makeContours } from 'd3'
import type { CanvasSource, MapMouseEvent } from 'maplibre-gl'
import { MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { MapCircleLayer, MapLineLayer } from '@/components/ui/map-layers'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import type { HeatGridSpec, HeatTheme, Point, TransitData, TravelResult } from './types'
import { blendHeatPixels, makeHeatRaster } from './heat-raster'
import { viewportGrid } from './live-grid'
export { PALETTE } from './heat-raster'

function HeatLayer({
  data,
  result,
  max,
  theme,
}: {
  data: TransitData
  result: TravelResult
  max: number
  theme: HeatTheme
}) {
  const { map, isLoaded } = useMap()
  const surface = useRef<{ canvas: HTMLCanvasElement; painted: boolean; bbox: HeatGridSpec['bbox'] } | null>(null)
  useEffect(() => {
    if (!map || !isLoaded) return
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    surface.current = { canvas, painted: false, bbox: data.meta.bbox }
    const [west, south, east, north] = data.meta.bbox
    const coordinates: [Point, Point, Point, Point] = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ]
    map.addSource('pg-transit-heat', { type: 'canvas', canvas, coordinates, animate: false })
    const firstSymbol = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
    map.addLayer(
      {
        id: 'pg-transit-heat',
        source: 'pg-transit-heat',
        type: 'raster',
        paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      },
      firstSymbol,
    )
    return () => {
      surface.current = null
      if (map.getLayer('pg-transit-heat')) map.removeLayer('pg-transit-heat')
      if (map.getSource('pg-transit-heat')) map.removeSource('pg-transit-heat')
    }
  }, [map, isLoaded, data])

  useEffect(() => {
    const current = surface.current
    const source = map?.getSource('pg-transit-heat') as CanvasSource | undefined
    if (!current || !source || !isLoaded) return
    const { canvas } = current
    const ctx = canvas.getContext('2d')!
    const previous = document.createElement('canvas')
    const spec = result.heatGrid ?? { ...data.grid, bbox: data.meta.bbox }
    const raster = result.raster ?? makeHeatRaster(result.grid, spec.cols, spec.rows, max, theme)
    previous.width = raster.width
    previous.height = raster.height
    const [west, south, east, north] = spec.bbox
    const [oldWest, oldSouth, oldEast, oldNorth] = current.bbox
    // Carry the currently visible frame into the new viewport before updating
    // the source. Never clear the display while a worker frame is pending.
    previous
      .getContext('2d')!
      .drawImage(
        canvas,
        ((oldWest - west) / (east - west)) * raster.width,
        ((north - oldNorth) / (north - south)) * raster.height,
        ((oldEast - oldWest) / (east - west)) * raster.width,
        ((oldNorth - oldSouth) / (north - south)) * raster.height,
      )
    const before = previous.getContext('2d')!.getImageData(0, 0, raster.width, raster.height).data
    if (canvas.width !== raster.width || canvas.height !== raster.height) {
      canvas.width = raster.width
      canvas.height = raster.height
    }
    if (JSON.stringify(current.bbox) !== JSON.stringify(spec.bbox)) {
      source.setCoordinates([
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ])
      current.bbox = spec.bbox
    }
    const pixels = ctx.createImageData(raster.width, raster.height)
    const duration = current.painted && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 240 : 0
    current.painted = true
    let frame = 0
    const start = performance.now()
    const paint = (now: number) => {
      const progress = duration ? Math.min(1, (now - start) / duration) : 1
      const eased = progress * (2 - progress)
      if (progress === 1) pixels.data.set(raster.pixels)
      else blendHeatPixels(before, raster.pixels, eased, pixels.data)
      ctx.putImageData(pixels, 0, 0)
      map!.triggerRepaint()
      if (progress < 1) frame = requestAnimationFrame(paint)
      else source.pause()
    }
    source.play()
    paint(start)
    return () => {
      cancelAnimationFrame(frame)
      source.pause()
    }
  }, [map, isLoaded, data, result, max, theme])
  return null
}

export function TravelLayers({
  data,
  result,
  max,
  thresholds,
  showHeat,
  showRoutes,
  showStops,
  dragging,
  theme,
}: {
  data: TransitData
  result: TravelResult | null
  max: number
  thresholds: number[]
  showHeat: boolean
  showRoutes: boolean
  showStops: boolean
  dragging: boolean
  theme: HeatTheme
}) {
  const routeData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: data.patterns
        .map((p, i): GeoJSON.Feature<GeoJSON.LineString> => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: p.points },
          properties: { id: String(i), color: data.routes[p.route].color },
        }))
        .filter((f) => f.geometry.coordinates.length >= 2),
    }),
    [data],
  )
  const stopData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: data.stops.map((s, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: s.point },
        properties: { id: s.id, name: s.name, minutes: result?.stopMinutes[i] ?? -1 },
      })),
    }),
    [data, result],
  )
  const contourData = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!result || !thresholds.length) return { type: 'FeatureCollection', features: [] }
    const grid = result.heatGrid ?? { ...data.grid, bbox: data.meta.bbox }
    const [west, south, east, north] = grid.bbox
    const contours = makeContours()
      .size([grid.cols, grid.rows])
      .thresholds(thresholds.map((n) => -n))(result.grid.map((v) => (v < 0 ? -1e6 : -v)))
    return {
      type: 'FeatureCollection',
      features: contours.flatMap((c) =>
        c.coordinates.flatMap((polygon, i) =>
          polygon.map((ring, j): GeoJSON.Feature<GeoJSON.LineString> => ({
            type: 'Feature',
            properties: { id: `${c.value}:${i}:${j}`, minutes: -c.value },
            geometry: {
              type: 'LineString',
              coordinates: ring.map(([x, y]) => [
                west + (x * (east - west)) / grid.cols,
                north - (y * (north - south)) / grid.rows,
              ]),
            },
          })),
        ),
      ),
    }
  }, [data, result, thresholds])
  const journeyData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (result?.journey?.legs ?? []).map((leg, i) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: leg.points },
        properties: { id: String(i), color: leg.color ?? '#334155', kind: leg.kind },
      })),
    }),
    [result],
  )
  const contourLabels = useMemo(
    () =>
      thresholds.flatMap((minutes) => {
        const rings = contourData.features.filter(
          (f) => f.properties?.minutes === minutes && f.geometry.type === 'LineString',
        )
        const largest = rings.reduce<GeoJSON.Feature<GeoJSON.LineString> | null>((best, feature) => {
          const ring = feature as GeoJSON.Feature<GeoJSON.LineString>
          return ring.geometry.coordinates.length > (best?.geometry.coordinates.length ?? 0) ? ring : best
        }, null)
        if (!largest || largest.geometry.coordinates.length < 8) return []
        const point = largest.geometry.coordinates[Math.floor(largest.geometry.coordinates.length / 4)] as Point
        return [{ minutes, point }]
      }),
    [contourData, thresholds],
  )
  return (
    <>
      {showHeat && result && <HeatLayer data={data} result={result} max={max} theme={theme} />}
      <MapLineLayer
        data={contourData}
        color={theme === 'dark' ? '#b3becb' : '#475569'}
        width={1.2}
        opacity={0.7}
        dashArray={[3, 2]}
      />
      {contourLabels.map(({ minutes, point }) => (
        <MapMarker key={minutes} longitude={point[0]} latitude={point[1]} anchor="center">
          <MarkerContent>
            <span className="pointer-events-none rounded border border-border bg-background/90 px-1 py-0.5 text-[10px] font-semibold text-foreground shadow-sm">
              {minutes} min
            </span>
          </MarkerContent>
        </MapMarker>
      ))}
      {showRoutes && <MapLineLayer data={routeData} color={['get', 'color']} width={2.4} opacity={0.65} />}
      {showStops && (
        <MapCircleLayer
          hoverEnabled={!dragging}
          data={stopData}
          color={['case', ['<', ['get', 'minutes'], 0], '#94a3b8', '#ffffff']}
          radius={['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5]}
          strokeColor="#475569"
          strokeWidth={1}
          hoverHtml={(p) =>
            mapTooltipHtml({
              title: String(p.name),
              lines: [
                Number(p.minutes) < 0
                  ? 'No connected access in this snapshot'
                  : `${Math.ceil(Number(p.minutes))} min from the map starting point`,
              ],
            })
          }
        />
      )}
      <MapLineLayer data={journeyData} color="#ffffff" width={7} opacity={0.95} />
      <MapLineLayer data={journeyData} color={['get', 'color']} width={4} opacity={1} />
    </>
  )
}

export function MapHeatViewport({
  study,
  onChange,
}: {
  study: HeatGridSpec['bbox']
  onChange: (spec: HeatGridSpec) => void
}) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const refresh = () => {
      const bounds = map.getBounds()
      onChange(
        viewportGrid(study, [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], map.getZoom()),
      )
    }
    refresh()
    map.on('moveend', refresh)
    return () => {
      map.off('moveend', refresh)
    }
  }, [map, isLoaded, study, onChange])
  return null
}

export function MapPicking({
  onPick,
  originMode,
}: {
  onPick: (point: Point, origin: boolean) => void
  originMode: boolean
}) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    const click = (event: MapMouseEvent) => {
      // Marker releases and map-control clicks bubble through the container;
      // only an actual click on the map canvas should place another point.
      if (event.originalEvent.target !== map.getCanvas()) return
      onPick([event.lngLat.lng, event.lngLat.lat], originMode || event.originalEvent.shiftKey)
    }
    const rightClick = (event: MapMouseEvent) => {
      if (event.originalEvent.target !== map.getCanvas()) return
      event.preventDefault()
      onPick([event.lngLat.lng, event.lngLat.lat], true)
    }
    map.on('click', click)
    map.on('contextmenu', rightClick)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', click)
      map.off('contextmenu', rightClick)
      map.getCanvas().style.cursor = ''
    }
  }, [map, isLoaded, onPick, originMode])
  return null
}
