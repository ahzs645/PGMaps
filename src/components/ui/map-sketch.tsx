/**
 * Drawing a polygon, line or circle on a map by clicking its vertices: the interaction
 * `/dev/interact` measures with, for any page that measures or asks for a drawn shape. The rules
 * are `src/lib/geo/mapSketch.ts`; this is the map side.
 *
 * - `useMapSketch` keeps a sketch's state for a page that owns none (a measure tool).
 * - `MapSketchLayers` draws a sketch and turns map clicks into its vertices. It is controlled, so a
 *   page that already keeps its own draft (a road's avoidance area, a traced block) passes its points
 *   in and takes `onAdd` / `onFinish` back; `MapSketchDraft` adds the pointer's rubber band.
 *
 * Render `MapSketchLayers` inside `<Map>`. While it captures clicks, the page's own click handlers
 * stand aside: a plan layer that acts on click must not also act on a vertex.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type * as MapLibreGL from 'maplibre-gl'
import { MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import {
  IDLE_SKETCH,
  canFinishSketch,
  nearFirstVertex,
  sketchFeatures,
  sketchReducer,
  sketchStats,
  type LngLat,
  type SketchMode,
  type SketchShape,
  type SketchState,
  type SketchStats,
} from '@/lib/geo/mapSketch'
import { cn } from '@/lib/utils'

/** The measure tool's orange, as on `/dev/interact`. */
export const SKETCH_COLOR = '#ea580c'

export interface MapSketchController {
  state: SketchState
  cursor: LngLat | null
  stats: SketchStats | null
  canFinish: boolean
  canUndo: boolean
  canRedo: boolean
  setCursor: (point: LngLat | null) => void
  start: (shape: SketchShape) => void
  add: (point: LngLat) => void
  finish: () => void
  undo: () => void
  redo: () => void
  clear: () => void
  /** Moves a circle's edge and finishes it (a phone's drag handle). */
  setRadius: (point: LngLat) => void
}

/**
 * A sketch's state and actions, for a page that keeps no draft of its own. Pass `initialShape` for a
 * tool that opens already drawing.
 */
export function useMapSketch(initialShape?: SketchShape): MapSketchController {
  const [state, dispatch] = useReducer(sketchReducer, initialShape, (shape) =>
    shape ? sketchReducer(IDLE_SKETCH, { type: 'start', shape }) : IDLE_SKETCH,
  )
  const [cursor, setCursor] = useState<LngLat | null>(null)
  const stats = useMemo(
    () => sketchStats(state.shape, state.points, state.mode === 'complete', state.mode === 'drawing' ? cursor : null),
    [cursor, state],
  )
  const start = useCallback((shape: SketchShape) => {
    setCursor(null)
    dispatch({ type: 'start', shape })
  }, [])
  const add = useCallback((point: LngLat) => dispatch({ type: 'add', point }), [])
  const finish = useCallback(() => {
    setCursor(null)
    dispatch({ type: 'finish' })
  }, [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  const clear = useCallback(() => {
    setCursor(null)
    dispatch({ type: 'clear' })
  }, [])
  const setRadius = useCallback((point: LngLat) => {
    setCursor(null)
    dispatch({ type: 'radius', point })
  }, [])
  return {
    state,
    cursor,
    stats,
    canFinish: state.mode === 'drawing' && canFinishSketch(state.shape, state.points),
    canUndo: state.points.length > 0,
    canRedo: state.redo.length > 0 && state.mode === 'drawing',
    setCursor,
    start,
    add,
    finish,
    undo,
    redo,
    clear,
    setRadius,
  }
}

export interface MapSketchLayersProps {
  shape: SketchShape
  /** `idle` draws nothing; clicks are captured only while `drawing`. */
  mode: SketchMode
  points: readonly LngLat[]
  /** The pointer, for the rubber band to it; pass the page's own when it tracks one. */
  cursor?: LngLat | null
  onAdd: (point: LngLat) => void
  /** A click on the first vertex or a double-click, once the shape has enough points. */
  onFinish: () => void
  onCursor?: (point: LngLat | null) => void
  /**
   * Off when the page's own click handler places the vertices (it can still close the polygon with
   * `nearFirstVertex`); the sketch is then drawn only.
   */
  capture?: boolean
  color?: string
  /** A circle's outline; `/dev/interact` draws its own on phones. */
  circleOutline?: boolean
  /** Prefix of the vertex markers' test ids. */
  testId?: string
}

export function MapSketchLayers({
  shape,
  mode,
  points,
  cursor = null,
  onAdd,
  onFinish,
  onCursor,
  capture = true,
  color = SKETCH_COLOR,
  circleOutline = true,
  testId = 'map-sketch',
}: MapSketchLayersProps) {
  const features = useMemo(() => sketchFeatures(shape, mode, points, cursor), [cursor, mode, points, shape])
  const drawing = mode === 'drawing'
  const canFinish = drawing && canFinishSketch(shape, points)
  if (mode === 'idle') return null
  return (
    <>
      {capture && drawing && (
        <SketchClickCapture shape={shape} points={points} onAdd={onAdd} onFinish={onFinish} onCursor={onCursor} />
      )}
      <MapFillLayer
        data={features.fill}
        fillColor={color}
        fillOpacity={0.18}
        lineColor={color}
        lineWidth={0}
        interactive={false}
        visible={shape === 'polygon' && points.length >= 3}
      />
      <MapLineLayer
        data={features.outline}
        color={color}
        width={2.5}
        opacity={1}
        dashArray={drawing ? [2, 1.3] : undefined}
        interactive={false}
        visible={shape !== 'circle' && points.length > 1}
      />
      <MapLineLayer
        data={features.preview}
        color={color}
        width={2}
        opacity={0.72}
        dashArray={[1.2, 1.2]}
        interactive={false}
        visible={shape !== 'circle' && drawing && points.length > 0}
      />
      <MapFillLayer
        data={features.circle}
        fillColor={circleOutline ? color : '#ffffff'}
        fillOpacity={circleOutline ? 0.12 : 0.04}
        lineColor={color}
        lineWidth={circleOutline ? 2 : 0}
        interactive={false}
        visible={shape === 'circle' && features.circle.features.length > 0}
      />
      {(shape === 'circle' ? points.slice(0, 1) : points).map((point, index) => {
        const closes = shape === 'polygon' && index === 0 && canFinish
        return (
          // Vertices are drawn only: a click on one reaches the map, which closes on the first.
          <MapMarker
            key={`${point[0]}:${point[1]}:${index}`}
            longitude={point[0]}
            latitude={point[1]}
            className="pointer-events-none"
          >
            <MarkerContent>
              <span
                data-testid={`${testId}-vertex`}
                title={closes ? 'Click to close the polygon' : undefined}
                className={cn(
                  'pointer-events-none flex size-5 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow-lg',
                  closes && 'size-6',
                )}
                style={{
                  backgroundColor: color,
                  // The ring that says the first point closes the polygon.
                  ...(closes ? { boxShadow: `0 0 0 4px ${color}33, 0 4px 10px rgb(0 0 0 / 0.25)` } : {}),
                }}
              >
                {shape === 'circle' ? '' : index + 1}
              </span>
            </MarkerContent>
          </MapMarker>
        )
      })}
    </>
  )
}

/** A sketch with its own state (`useMapSketch`), as a measure tool draws it. */
export function MapSketch({
  sketch,
  ...props
}: { sketch: MapSketchController } & Pick<MapSketchLayersProps, 'color' | 'circleOutline' | 'testId'>) {
  return (
    <MapSketchLayers
      {...props}
      shape={sketch.state.shape}
      mode={sketch.state.mode}
      points={sketch.state.points}
      cursor={sketch.cursor}
      onAdd={sketch.add}
      onFinish={sketch.finish}
      onCursor={sketch.setCursor}
    />
  )
}

/**
 * A draft the page keeps itself (its points, its Finish), drawn and captured as a sketch. The
 * pointer stays in this component's state, so a page's other layers do not re-render as it moves.
 */
export function MapSketchDraft({
  shape,
  points,
  onAdd,
  onFinish,
  color,
  testId,
}: Pick<MapSketchLayersProps, 'shape' | 'points' | 'onAdd' | 'onFinish' | 'color' | 'testId'>) {
  const [cursor, setCursor] = useState<LngLat | null>(null)
  return (
    <MapSketchLayers
      shape={shape}
      mode="drawing"
      points={points}
      cursor={cursor}
      onCursor={setCursor}
      onAdd={onAdd}
      onFinish={onFinish}
      color={color}
      testId={testId}
    />
  )
}

/**
 * Map clicks as vertices. The callbacks sit in refs and the listeners bind once per drawing, so a
 * re-render between clicks cannot detach them mid-draw. Double-click zoom is off meanwhile, so
 * finishing does not also jump the camera; the second click of a double-click adds nothing.
 */
function SketchClickCapture({
  shape,
  points,
  onAdd,
  onFinish,
  onCursor,
}: {
  shape: SketchShape
  points: readonly LngLat[]
  onAdd: (point: LngLat) => void
  onFinish: () => void
  onCursor?: (point: LngLat | null) => void
}) {
  const { map, isLoaded } = useMap()
  const latest = useRef({ shape, points, onAdd, onFinish, onCursor })
  useEffect(() => {
    latest.current = { shape, points, onAdd, onFinish, onCursor }
  })

  useEffect(() => {
    if (!map || !isLoaded) return
    const canvas = map.getCanvas()
    const previousCursor = canvas.style.cursor
    canvas.style.cursor = 'crosshair'
    const onFirstVertex = (event: MapLibreGL.MapMouseEvent) => {
      const { shape, points } = latest.current
      return (
        shape === 'polygon' && canFinishSketch(shape, points) && nearFirstVertex(map.project(points[0]), event.point)
      )
    }
    const click = (event: MapLibreGL.MapMouseEvent) => {
      event.originalEvent.preventDefault()
      if (event.originalEvent.detail > 1) return
      if (onFirstVertex(event)) {
        latest.current.onFinish()
        return
      }
      latest.current.onAdd([event.lngLat.lng, event.lngLat.lat])
    }
    const doubleClick = (event: MapLibreGL.MapMouseEvent) => {
      const { shape, points } = latest.current
      if (shape === 'circle' || !canFinishSketch(shape, points)) return
      event.preventDefault()
      latest.current.onFinish()
    }
    const move = (event: MapLibreGL.MapMouseEvent) => {
      latest.current.onCursor?.([event.lngLat.lng, event.lngLat.lat])
      canvas.style.cursor = onFirstVertex(event) ? 'pointer' : 'crosshair'
    }
    const leave = () => latest.current.onCursor?.(null)
    map.on('click', click)
    map.on('dblclick', doubleClick)
    map.on('mousemove', move)
    map.on('mouseout', leave)
    // Restored as found: a page may keep double-click zoom off for its own reasons.
    const zoomedOnDoubleClick = map.doubleClickZoom.isEnabled()
    map.doubleClickZoom.disable()
    return () => {
      map.off('click', click)
      map.off('dblclick', doubleClick)
      map.off('mousemove', move)
      map.off('mouseout', leave)
      if (zoomedOnDoubleClick) map.doubleClickZoom.enable()
      canvas.style.cursor = previousCursor
      latest.current.onCursor?.(null)
    }
  }, [isLoaded, map])

  return null
}
