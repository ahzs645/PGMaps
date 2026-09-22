import type { ReactNode } from 'react'
import type { ElevationSource } from './terrain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { MAP_OVERLAY_Z } from '@/components/ui/map-overlay'
import { DriveController, type DriveMap, type DriveOptions, type DrivePose, type DriveStatus } from './driveController'
import { PreviewFrameBudget } from './previewState'
import { DRIVE_SPEEDS_KMH, roadPath, type DriveLookAt, type DriveStation } from './driveMath'
export type { DriveLookAt, DriveStation } from './driveMath'
type Props = {
  restoredLook?: { yaw: number; tilt: number }
  onLookChange?: (look: { yaw: number; tilt: number }) => void
  onStatusChange?: (status: DriveStatus) => void
  onSlowFrames?: () => void
  forestReady?: boolean
  routeLengthMeters?: number
  onSeek?: (distance: number) => void
  speedKmh?: number
  onSpeedChange?: (speed: number) => void
  comparison?: ReactNode
  elevation: ElevationSource | null
  active: boolean
  playing: boolean
  stations: DriveStation[]
  roadCoordinates?: Array<[number, number]>
  seekMeters: number
  seekVersion: number
  speedMetersPerSecond: number
  eyeHeightMeters: number
  lookAt: DriveLookAt | null
  spotBearing: number
  onPosition: (position: DrivePose) => void
  onReachEnd?: () => void
  onPause?: () => void
  onExit?: () => void
  /** Starts playback from the map, where the sidebar's own control is behind the phone sheet. */
  onPlay?: () => void
}
/** Look-around owns pointer gestures only while driving; the ordinary map is fully restored on exit. */
export function DriveCamera(props: Props) {
  const { map, isLoaded } = useMap()
  const controllerRef = useRef<DriveController | null>(null)
  const [status, setStatus] = useState<DriveStatus>('waiting-for-terrain')
  const [view, setView] = useState({ yaw: 0, tilt: 0 })
  const [optionsExpanded, setOptionsExpanded] = useState(true)
  // The animation frame reads the latest look and props without the effect
  // below being torn down and rebuilt, which would restart playback per render.
  const viewRef = useRef(view)
  const propsRef = useRef(props)
  useEffect(() => {
    viewRef.current = view
    propsRef.current = props
  })
  const coordinates = useMemo(
    () => props.roadCoordinates ?? props.stations.map((p): [number, number] => [p.lng, p.lat]),
    [props.roadCoordinates, props.stations],
  )
  const path = useMemo(() => roadPath(coordinates), [coordinates])
  useEffect(() => {
    setView(propsRef.current.restoredLook ?? { yaw: 0, tilt: 0 })
  }, [props.lookAt, props.seekVersion, props.active])
  useEffect(() => { propsRef.current.onLookChange?.(view) }, [view])
  useEffect(() => { propsRef.current.onStatusChange?.(status) }, [status])
  useEffect(() => {
    controllerRef.current?.seek(propsRef.current.seekMeters)
  }, [props.seekVersion]) // reports do not trigger seeks
  useEffect(() => {
    if (!props.active || !map || !isLoaded || !path.length) return
    const controller = new DriveController(map as unknown as DriveMap, path, props.stations, props.elevation)
    controllerRef.current = controller
    controller.start(propsRef.current.seekMeters)
    let frame = 0,
      disposed = false
    const budget = new PreviewFrameBudget()
    const started = performance.now()
    let previousFrame = 0, downgraded = false
    const render = (time: number) => {
      if (disposed) return
      const current = propsRef.current
      if (!downgraded && current.onSlowFrames && current.playing && current.forestReady && !document.hidden && time - started > 5000 && previousFrame && budget.push(time - previousFrame)) {
        downgraded = true
        current.onSlowFrames?.()
      }
      previousFrame = time
      const options: DriveOptions = { ...current, ...viewRef.current, onStatus: setStatus }
      controller.tick(time, options)
      frame = requestAnimationFrame(render)
    }
    const canvas = map.getCanvas()
    const oldTouchAction = canvas.style.touchAction
    canvas.style.touchAction = 'none'
    let dragging: { id: number; x: number; y: number } | null = null
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      dragging = { id: event.pointerId, x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId)
      canvas.focus()
    }
    const move = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== dragging.id) return
      const dx = event.clientX - dragging.x,
        dy = event.clientY - dragging.y
      dragging.x = event.clientX
      dragging.y = event.clientY
      setView((v) => ({ yaw: v.yaw - dx * 0.15, tilt: Math.max(-45, Math.min(20, v.tilt + dy * 0.12)) }))
    }
    const up = (event: PointerEvent) => {
      if (dragging?.id === event.pointerId) {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        dragging = null
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        propsRef.current.onExit?.()
      } else if (event.key === ' ') {
        event.preventDefault()
        if (propsRef.current.playing) propsRef.current.onPause?.()
        else if (propsRef.current.forestReady) propsRef.current.onPlay?.()
      } else if (event.key.toLowerCase() === 'r') setView({ yaw: 0, tilt: 0 })
      else if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        setView((v) => ({
          yaw: v.yaw + (event.key === 'ArrowRight' ? 3 : event.key === 'ArrowLeft' ? -3 : 0),
          tilt: Math.max(
            -45,
            Math.min(20, v.tilt + (event.key === 'ArrowUp' ? 2 : event.key === 'ArrowDown' ? -2 : 0)),
          ),
        }))
      }
    }
    const hidden = () => {
      if (document.hidden) propsRef.current.onPause?.()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', hidden)
    frame = requestAnimationFrame(render)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('keydown', key)
      document.removeEventListener('visibilitychange', hidden)
      canvas.style.touchAction = oldTouchAction
      controller.stop()
      controllerRef.current = null
    }
  }, [props.active, map, isLoaded, path, props.stations, props.elevation])
  if (!props.active) return null
  return (
    <div
      className={`absolute left-3 md:left-10 right-3 max-w-xs max-h-[55%] overflow-y-auto ${MAP_OVERLAY_Z.controls} bottom-[calc(var(--map-mobile-sheet-visible-height,0px)+var(--map-safe-bottom-offset,0px)+0.75rem)] rounded-lg border bg-background/95 p-3 shadow-lg md:bottom-3`}
      role="region"
      aria-label="Road view controls"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Road-level preview · 1× terrain</p>
        <button className="shrink-0 rounded border px-2 py-1 text-xs" aria-expanded={optionsExpanded} onClick={() => setOptionsExpanded(current => !current)}>{optionsExpanded ? 'Hide options' : 'Show options'}</button>
      </div>
      <p className="mt-1 text-xs" role="status">
        {status === 'waiting-for-terrain'
          ? 'Waiting for terrain at the camera. Playback is held.'
          : status === 'invalid-camera'
            ? 'This camera pose is invalid. Reset the view or return to the map.'
            : 'Drag to look around. Arrow keys turn; R resets; Escape exits.'}
      </p>
      {props.onSeek && <label className="mt-2 block text-xs">Route position · {(props.seekMeters / 1000).toFixed(2)} / {((props.routeLengthMeters ?? 0) / 1000).toFixed(2)} km
        <input aria-label="Route position" className="mt-1 block w-full accent-primary" type="range" min={0} max={props.routeLengthMeters ?? 1} step={5} value={props.seekMeters} onChange={e => props.onSeek?.(Number(e.target.value))} />
      </label>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button className="rounded border px-2 py-1" onClick={() => setView({ yaw: 0, tilt: 0 })}>
          Reset look
        </button>
        <button
          className="rounded bg-primary text-primary-foreground px-3 py-2 font-semibold disabled:opacity-50"
          disabled={props.stations.length < 2 || (!props.playing && (status !== 'ready' || props.forestReady === false))}
          onClick={() => (props.playing ? props.onPause?.() : props.onPlay?.())}
        >
          {props.playing ? 'Pause' : 'Play'}
        </button>
        {props.onSpeedChange && <select aria-label="Driving speed" className="rounded border bg-background py-1" value={props.speedKmh} onChange={e => props.onSpeedChange?.(Number(e.target.value))}>{DRIVE_SPEEDS_KMH.map(speed => <option key={speed} value={speed}>{speed} km/h</option>)}</select>}
        <button className="rounded border px-2 py-1" onClick={props.onExit}>
          Return to map
        </button>
      </div>
      {props.onSeek && <div className="mt-2 flex items-center gap-2 text-xs">
        <button className="rounded border px-2 py-1" disabled={props.seekMeters <= 0} onClick={() => { props.onPause?.(); props.onSeek?.(Math.max(0, props.seekMeters - 10)) }}>Back 10 m</button>
        <button className="rounded border px-2 py-1" disabled={props.seekMeters >= (props.routeLengthMeters ?? 0)} onClick={() => { props.onPause?.(); props.onSeek?.(Math.min(props.routeLengthMeters ?? 0, props.seekMeters + 10)) }}>Forward 10 m</button>
      </div>}
      <p className="mt-1 text-[10px] text-muted-foreground">Preview speed; posted limits are not loaded. {props.speedKmh && props.routeLengthMeters ? `${Math.ceil(Math.max(0, props.routeLengthMeters - props.seekMeters) / (props.speedKmh / 3.6))} s remaining at this speed.` : ''}</p>
      <div className="mt-2" hidden={!optionsExpanded}>{props.comparison}</div>
    </div>
  )
}
