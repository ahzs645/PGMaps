import { useEffect, useMemo, useRef, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { MAP_OVERLAY_Z } from '@/components/ui/map-overlay'
import { DriveController, type DriveMap, type DriveOptions, type DrivePose, type DriveStatus } from './driveController'
import { roadPath, type DriveLookAt, type DriveStation } from './driveMath'
export type { DriveLookAt, DriveStation } from './driveMath'
type Props = {
  active: boolean; playing: boolean; stations: DriveStation[]
  roadCoordinates?: Array<[number, number]>
  seekMeters: number; seekVersion: number; speedMetersPerSecond: number; eyeHeightMeters: number
  lookAt: DriveLookAt | null; spotBearing: number
  onPosition: (position: DrivePose) => void; onReachEnd?: () => void; onPause?: () => void; onExit?: () => void
  /** Starts playback from the map, where the sidebar's own control is behind the phone sheet. */
  onPlay?: () => void
}
/** Look-around owns pointer gestures only while driving; the ordinary map is fully restored on exit. */
export function DriveCamera(props: Props) {
  const { map, isLoaded } = useMap()
  const controllerRef = useRef<DriveController | null>(null)
  const [status, setStatus] = useState<DriveStatus>('waiting-for-terrain')
  const [view, setView] = useState({ yaw: 0, tilt: 0 })
  // The animation frame reads the latest look and props without the effect
  // below being torn down and rebuilt, which would restart playback per render.
  const viewRef = useRef(view)
  const propsRef = useRef(props)
  useEffect(() => { viewRef.current = view; propsRef.current = props })
  const coordinates = useMemo(() => props.roadCoordinates ?? props.stations.map((p): [number, number] => [p.lng, p.lat]), [props.roadCoordinates, props.stations])
  const path = useMemo(() => roadPath(coordinates), [coordinates])
  useEffect(() => { controllerRef.current?.seek(propsRef.current.seekMeters) }, [props.seekVersion]) // reports do not trigger seeks
  useEffect(() => {
    if (!props.active || !map || !isLoaded || !path.length) return
    const controller = new DriveController(map as unknown as DriveMap, path, props.stations)
    controllerRef.current = controller
    controller.start(propsRef.current.seekMeters)
    let frame = 0, disposed = false
    const render = (time: number) => {
      if (disposed) return
      const current = propsRef.current
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
      event.preventDefault(); dragging = { id: event.pointerId, x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId); canvas.focus()
    }
    const move = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== dragging.id) return
      const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y
      dragging.x = event.clientX; dragging.y = event.clientY
      setView((v) => ({ yaw: v.yaw - dx * 0.15, tilt: Math.max(-45, Math.min(20, v.tilt + dy * 0.12)) }))
    }
    const up = (event: PointerEvent) => { if (dragging?.id === event.pointerId) { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); dragging = null } }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); propsRef.current.onExit?.() }
      else if (event.key === ' ') { event.preventDefault(); propsRef.current.onPause?.() }
      else if (event.key.toLowerCase() === 'r') setView({ yaw: 0, tilt: 0 })
      else if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        setView((v) => ({ yaw: v.yaw + (event.key === 'ArrowRight' ? 3 : event.key === 'ArrowLeft' ? -3 : 0), tilt: Math.max(-45, Math.min(20, v.tilt + (event.key === 'ArrowUp' ? 2 : event.key === 'ArrowDown' ? -2 : 0))) }))
      }
    }
    const hidden = () => { if (document.hidden) propsRef.current.onPause?.() }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', hidden)
    frame = requestAnimationFrame(render)
    return () => {
      disposed = true; cancelAnimationFrame(frame)
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('keydown', key)
      document.removeEventListener('visibilitychange', hidden); canvas.style.touchAction = oldTouchAction
      controller.stop(); controllerRef.current = null
    }
  }, [props.active, map, isLoaded, path, props.stations])
  if (!props.active) return null
  return <div className={`absolute left-3 right-3 max-w-xs ${MAP_OVERLAY_Z.controls} bottom-[calc(var(--map-mobile-sheet-visible-height,0px)+var(--map-safe-bottom-offset,0px)+0.75rem)] rounded-lg border bg-background/95 p-3 shadow-lg md:bottom-3`} role="region" aria-label="Road view controls">
    <p className="text-xs font-semibold">Road-level preview · 1× terrain</p>
    <p className="mt-1 text-xs" role="status">{status === 'waiting-for-terrain' ? 'Waiting for terrain at the camera. Playback is held.' : status === 'invalid-camera' ? 'This camera pose is invalid. Reset the view or return to the map.' : 'Drag to look around. Arrow keys turn; R resets; Escape exits.'}</p>
    <p className="mt-1 text-[11px] text-muted-foreground">Visibility colours use the nearest calculated station. Views above the horizon use MapLibre’s experimental high-pitch rendering.</p>
    <div className="mt-2 flex gap-3 text-xs">
      <button className="rounded border px-2 py-1" onClick={() => setView({ yaw: 0, tilt: 0 })}>Reset look</button>
      <button className="rounded border px-2 py-1 disabled:opacity-50" disabled={props.stations.length<2} onClick={()=>props.playing?props.onPause?.():props.onPlay?.()}>{props.playing?'Pause':'Play'}</button>
      <button className="rounded border px-2 py-1" onClick={props.onExit}>Return to map</button>
    </div>
  </div>
}
