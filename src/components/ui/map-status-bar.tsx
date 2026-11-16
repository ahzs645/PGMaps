import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type * as MapLibreGL from 'maplibre-gl'

import { useMap } from '@/components/ui/map'
import { setMapCoordinateFormat, useMapCoordinateFormat } from '@/components/ui/map-coordinate-format'
import {
  COORDINATE_FORMAT_LABELS,
  formatCoordinate,
  nextCoordinateFormat,
  type CoordinateFormat,
} from '@/lib/geo/coordinateFormat'
import { cn } from '@/lib/utils'

/**
 * Ground elevation under a point from the map's own 3D terrain, in metres, or null without
 * terrain. MapLibre reports it multiplied by the exaggeration, so that is divided out. It follows
 * the terrain tiles at the detail currently drawn, so it is a readout, not a survey value.
 */
export function terrainElevationAt(map: MapLibreGL.Map, lngLat: MapLibreGL.LngLatLike): number | null {
  const terrain = map.getTerrain?.()
  if (!terrain) return null
  const raw = map.queryTerrainElevation(lngLat)
  if (raw === null || !Number.isFinite(raw)) return null
  const exaggeration = terrain.exaggeration && terrain.exaggeration > 0 ? terrain.exaggeration : 1
  return raw / exaggeration
}

const metres = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })

const formatAngle = (degrees: number) => `${Math.round(((degrees % 360) + 360) % 360)}°`

/**
 * A one-line readout in the map's bottom-left corner: the pointer's coordinate (click it for the
 * next format), the ground elevation when the map has 3D terrain, and the zoom, plus the bearing
 * and pitch once the camera is turned or tilted. It sits in MapLibre's own corner box, so chrome
 * that already stacks above that corner (`--map-bottom-left-controls-height`) stacks above it too.
 * Phones leave it out: there is no pointer to follow.
 *
 * Pointer moves update the text directly once a frame rather than through React state, so the
 * readout never re-renders anything while the pointer moves.
 */
export function MapStatusBar() {
  const { map } = useMap()
  const format = useMapCoordinateFormat()
  const [container] = useState(() => {
    const element = document.createElement('div')
    element.className = 'maplibregl-ctrl pgmaps-map-status-ctrl'
    return element
  })
  const coordinateRef = useRef<HTMLButtonElement>(null)
  const elevationRef = useRef<HTMLSpanElement>(null)
  const cameraRef = useRef<HTMLSpanElement>(null)
  const formatRef = useRef<CoordinateFormat>(format)
  const pointerRef = useRef<{ lng: number; lat: number } | null>(null)
  const redrawRef = useRef<() => void>(() => {})
  const refitRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!map) return
    const control: MapLibreGL.IControl = {
      onAdd: () => container,
      onRemove: () => container.remove(),
    }
    map.addControl(control, 'bottom-left')
    const mapContainer = map.getContainer()
    const bottomRight = mapContainer.querySelector<HTMLElement>(
      ':scope > .maplibregl-control-container > .maplibregl-ctrl-bottom-right',
    )

    // On a narrow map, or beside a long attribution, the bottom-right corner reaches the readout:
    // it steps aside rather than run under the attribution.
    let fitFrame = 0
    const fit = () => {
      fitFrame = 0
      container.style.display = ''
      const bar = container.getBoundingClientRect()
      if (bar.width === 0) return
      let right = mapContainer.getBoundingClientRect().right
      for (const child of Array.from(bottomRight?.children ?? [])) {
        const rect = child.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0 && rect.top < bar.bottom && rect.bottom > bar.top) {
          right = Math.min(right, rect.left)
        }
      }
      container.style.display = bar.right + 8 > right ? 'none' : ''
    }
    const refit = () => {
      if (!fitFrame) fitFrame = requestAnimationFrame(fit)
    }
    refitRef.current = refit
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit)
    observer?.observe(mapContainer)
    if (bottomRight) observer?.observe(bottomRight)

    let frame = 0
    let fitted = false
    const draw = () => {
      frame = 0
      const pointer = pointerRef.current
      const at = pointer ?? map.getCenter()
      const coordinate = coordinateRef.current
      if (coordinate) {
        coordinate.textContent = formatCoordinate(at.lng, at.lat, formatRef.current)
        coordinate.dataset.source = pointer ? 'pointer' : 'centre'
      }
      const elevationElement = elevationRef.current
      if (elevationElement) {
        const elevation = terrainElevationAt(map, [at.lng, at.lat])
        elevationElement.textContent = elevation === null ? '' : `${metres.format(elevation)} m`
        elevationElement.hidden = elevation === null
      }
      const camera = cameraRef.current
      if (camera) {
        const bearing = map.getBearing()
        const pitch = map.getPitch()
        const parts = [`z ${map.getZoom().toFixed(1)}`]
        if (Math.abs(bearing) >= 0.5) parts.push(`↻ ${formatAngle(bearing)}`)
        if (pitch >= 0.5) parts.push(`∠ ${Math.round(pitch)}°`)
        camera.textContent = parts.join('  ')
      }
      if (!fitted) {
        fitted = true
        refit()
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    redrawRef.current = schedule
    const onMove = (event: MapLibreGL.MapMouseEvent) => {
      pointerRef.current = { lng: event.lngLat.lng, lat: event.lngLat.lat }
      schedule()
    }
    const onLeave = () => {
      pointerRef.current = null
      schedule()
    }
    map.on('mousemove', onMove)
    map.on('mouseout', onLeave)
    map.on('move', schedule)
    map.on('terrain', schedule)
    map.on('idle', schedule)
    schedule()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      if (fitFrame) cancelAnimationFrame(fitFrame)
      observer?.disconnect()
      redrawRef.current = () => {}
      refitRef.current = () => {}
      map.off('mousemove', onMove)
      map.off('mouseout', onLeave)
      map.off('move', schedule)
      map.off('terrain', schedule)
      map.off('idle', schedule)
      if (map.hasControl(control)) map.removeControl(control)
    }
  }, [map, container])

  useEffect(() => {
    formatRef.current = format
    redrawRef.current()
    refitRef.current()
  }, [format])

  return createPortal(
    <div
      data-testid="map-status-bar"
      data-map-chrome=""
      className={cn(
        'pointer-events-auto flex max-w-[min(34rem,calc(100vw-1rem))] items-center gap-2 rounded-md border border-border bg-background/85 px-1.5 py-0.5',
        'font-mono text-2xs leading-4 tabular-nums text-muted-foreground shadow-sm backdrop-blur',
      )}
    >
      <button
        ref={coordinateRef}
        type="button"
        data-testid="map-status-coordinate"
        className="truncate rounded-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={`${COORDINATE_FORMAT_LABELS[format]} — click for ${COORDINATE_FORMAT_LABELS[nextCoordinateFormat(format)].toLowerCase()}`}
        aria-label={`Pointer coordinate in ${COORDINATE_FORMAT_LABELS[format].toLowerCase()}. Show ${COORDINATE_FORMAT_LABELS[nextCoordinateFormat(format)].toLowerCase()} instead`}
        onClick={() => setMapCoordinateFormat(nextCoordinateFormat(format))}
      />
      <span
        ref={elevationRef}
        hidden
        data-testid="map-status-elevation"
        title="Ground elevation from the map’s 3D terrain at the detail drawn now"
      />
      <span ref={cameraRef} data-testid="map-status-camera" className="whitespace-pre" />
    </div>,
    container,
  )
}
