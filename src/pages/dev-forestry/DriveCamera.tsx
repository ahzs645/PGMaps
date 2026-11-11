import { NativeSelect } from '@/components/ui/form-field'
import type { ReactNode } from 'react'
import type { ElevationSource } from './terrain'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { useMap } from '@/components/ui/map'
import { MAP_OVERLAY_Z } from '@/components/ui/map-overlay'
import { DriveController, type DriveMap, type DriveOptions, type DrivePose, type DriveStatus } from './driveController'
import { PreviewFrameBudget } from './previewState'
import {
  DRIVE_SPEEDS_KMH,
  NO_WALK,
  WALK_SPEEDS,
  roadPath,
  walkStep,
  type DriveLookAt,
  type DriveStation,
  type WalkOffset,
} from './driveMath'
export type { DriveLookAt, DriveStation } from './driveMath'
type Props = {
  /** Terrain-only route exploration, before a cutblock assessment. */
  preliminary?: boolean
  restoredLook?: { yaw: number; tilt: number }
  onLookChange?: (look: { yaw: number; tilt: number }) => void
  onStatusChange?: (status: DriveStatus) => void
  onSlowFrames?: () => void
  forestReady?: boolean
  routeLengthMeters?: number
  onSeek?: (distance: number) => void
  speedKmh?: number
  onSpeedChange?: (speed: number) => void
  /**
   * The page's own buttons for the second row: the harvest phase, saving a
   * view, demo shortcuts. Everything else about the view lives in the sidebar.
   */
  actions?: ReactNode
  /** One status line under the controls (loading, saved, data issues); nothing when idle. */
  status?: ReactNode
  /** Standing at one spot (a viewpoint's pullout): no playback, scrubber or speed, only looking and walking. */
  spot?: boolean
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
  /** Hold the view on a field photo's bearing and pitch; see `DriveOptions.fixedLook`. */
  fixedLook?: { bearing: number; pitch: number } | null
  /** Match a photo's lens while comparing against it; MapLibre's own default otherwise. */
  verticalFovDegrees?: number | null
}
/** Look-around owns pointer gestures only while driving; the ordinary map is fully restored on exit. */
export function DriveCamera(props: Props) {
  const { map, isLoaded } = useMap()
  const controllerRef = useRef<DriveController | null>(null)
  const [status, setStatus] = useState<DriveStatus>('waiting-for-terrain')
  const [view, setView] = useState(() => props.restoredLook ?? { yaw: 0, tilt: 0 })
  // Walking off the road: an offset the render loop moves while keys are held.
  const walkRef = useRef<WalkOffset>(NO_WALK)
  const heldRef = useRef(new Set<string>())
  const [offRoadMeters, setOffRoadMeters] = useState(0)
  const [walkHeld, setWalkHeld] = useState(false)
  const [lookReset, setLookReset] = useState({
    lookAt: props.lookAt,
    seekVersion: props.seekVersion,
    active: props.active,
  })
  if (
    lookReset.lookAt !== props.lookAt ||
    lookReset.seekVersion !== props.seekVersion ||
    lookReset.active !== props.active
  ) {
    setLookReset({ lookAt: props.lookAt, seekVersion: props.seekVersion, active: props.active })
    setView(props.restoredLook ?? { yaw: 0, tilt: 0 })
    setOffRoadMeters(0)
  }
  // A seek, a new block to face or a fresh drive puts the walker back on the road.
  useEffect(() => {
    walkRef.current = NO_WALK
  }, [props.seekVersion, props.lookAt, props.active])
  // Folded to one bar on a phone, where the panel, caption and sheet together
  // otherwise cover most of the road view it is there to show.
  const [optionsExpanded, setOptionsExpanded] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  )
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
    propsRef.current.onLookChange?.(view)
  }, [view])
  useEffect(() => {
    propsRef.current.onStatusChange?.(status)
  }, [status])
  useEffect(() => {
    controllerRef.current?.seek(propsRef.current.seekMeters)
  }, [props.seekVersion]) // reports do not trigger seeks
  useEffect(() => {
    if (!map || !isLoaded || !props.active || !props.verticalFovDegrees) return
    const previous = map.getVerticalFieldOfView()
    map.setVerticalFieldOfView(props.verticalFovDegrees)
    map.triggerRepaint()
    return () => {
      map.setVerticalFieldOfView(previous)
      map.triggerRepaint()
    }
  }, [map, isLoaded, props.active, props.verticalFovDegrees])
  useEffect(() => {
    if (!props.active || !map || !isLoaded || !path.length) return
    const controller = new DriveController(map as unknown as DriveMap, path, props.stations, props.elevation)
    controllerRef.current = controller
    controller.start(propsRef.current.seekMeters)
    let frame = 0,
      disposed = false
    const budget = new PreviewFrameBudget()
    const started = performance.now()
    let previousFrame = 0,
      downgraded = false
    const render = (time: number) => {
      if (disposed) return
      const current = propsRef.current
      if (
        !downgraded &&
        current.onSlowFrames &&
        current.playing &&
        current.forestReady &&
        !document.hidden &&
        time - started > 5000 &&
        previousFrame &&
        budget.push(time - previousFrame)
      ) {
        downgraded = true
        current.onSlowFrames?.()
      }
      // Up to the controller's own stall limit, so a slow frame rate does not slow the walker down.
      const dt = previousFrame ? Math.min(0.5, (time - previousFrame) / 1000) : 0
      previousFrame = time
      const held = heldRef.current
      if (current.playing && (walkRef.current.east || walkRef.current.north)) {
        walkRef.current = NO_WALK
        setOffRoadMeters(0)
      } else if (!current.playing && dt > 0 && held.size) {
        const forward = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0)
        const right = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0)
        const bearing = controller.viewBearing()
        if ((forward || right) && bearing !== null) {
          const speed = (held.has('shift') ? WALK_SPEEDS.fast : WALK_SPEEDS.normal) * dt
          const next = walkStep(walkRef.current, bearing, forward * speed, right * speed)
          if (controller.canStand(next)) {
            walkRef.current = next
            const metres = Math.round(Math.hypot(next.east, next.north))
            setOffRoadMeters((previous) => (previous === metres ? previous : metres))
            setWalkHeld(false)
          } else setWalkHeld(true)
        }
      }
      const options: DriveOptions = { ...current, ...viewRef.current, walk: walkRef.current, onStatus: setStatus }
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
    const walkKey = (event: KeyboardEvent) => event.key.length === 1 && 'wasd'.includes(event.key.toLowerCase())
    const release = (event: KeyboardEvent) => {
      if (walkKey(event)) heldRef.current.delete(event.key.toLowerCase())
      if (event.key === 'Shift') heldRef.current.delete('shift')
    }
    const clearHeld = () => heldRef.current.clear()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Shift') heldRef.current.add('shift')
      if (walkKey(event)) {
        event.preventDefault()
        if (!propsRef.current.playing) heldRef.current.add(event.key.toLowerCase())
        return
      }
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
    canvas.addEventListener('keyup', release)
    canvas.addEventListener('blur', clearHeld)
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
      canvas.removeEventListener('keyup', release)
      canvas.removeEventListener('blur', clearHeld)
      clearHeld()
      document.removeEventListener('visibilitychange', hidden)
      canvas.style.touchAction = oldTouchAction
      controller.stop()
      controllerRef.current = null
    }
  }, [props.active, map, isLoaded, path, props.stations, props.elevation])
  if (!props.active) return null
  const km = (metres: number) => (metres / 1000).toFixed(2)
  const statusText =
    status === 'waiting-for-terrain'
      ? 'Waiting for terrain at the camera. Playback is held.'
      : status === 'invalid-camera'
        ? 'This camera pose is invalid. Reset the look or return to the map.'
        : null
  return (
    <div
      className={`absolute left-3 right-3 ${MAP_OVERLAY_Z.controls} bottom-[calc(var(--map-mobile-sheet-visible-height,0px)+var(--map-safe-bottom-offset,0px)+0.75rem)] rounded-lg border bg-background/95 px-2.5 py-2 text-xs shadow-lg md:bottom-3 md:left-1/2 md:right-auto md:w-[min(46rem,calc(100%-6rem))] md:-translate-x-1/2`}
      role="region"
      aria-label="Road view controls"
    >
      {/* Row 1: the player. Nothing to drive at a single spot. */}
      {!props.spot && (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-8 shrink-0 px-3 font-semibold touch:h-10"
            disabled={
              props.stations.length < 2 || (!props.playing && (status !== 'ready' || props.forestReady === false))
            }
            onClick={() => (props.playing ? props.onPause?.() : props.onPlay?.())}
          >
            {props.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {props.playing ? 'Pause' : 'Play'}
          </Button>
          {props.onSeek && (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Back 10 m"
                title="Back 10 m"
                className="h-8 w-8 shrink-0 p-0 max-sm:hidden touch:h-10 touch:w-10"
                disabled={props.seekMeters <= 0}
                onClick={() => {
                  props.onPause?.()
                  props.onSeek?.(Math.max(0, props.seekMeters - 10))
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <input
                aria-label="Route position"
                aria-valuetext={`${km(props.seekMeters)} of ${km(props.routeLengthMeters ?? 0)} km`}
                className="min-w-0 flex-1 accent-primary"
                type="range"
                min={0}
                max={props.routeLengthMeters ?? 1}
                step={5}
                value={props.seekMeters}
                onChange={(e) => props.onSeek?.(Number(e.target.value))}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Forward 10 m"
                title="Forward 10 m"
                className="h-8 w-8 shrink-0 p-0 max-sm:hidden touch:h-10 touch:w-10"
                disabled={props.seekMeters >= (props.routeLengthMeters ?? 0)}
                onClick={() => {
                  props.onPause?.()
                  props.onSeek?.(Math.min(props.routeLengthMeters ?? 0, props.seekMeters + 10))
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {km(props.seekMeters)}
                <span className="max-sm:hidden"> / {km(props.routeLengthMeters ?? 0)}</span> km
              </span>
            </>
          )}
        </div>
      )}

      {/* Row 2: the page's actions, then the look reset, the keys and the way out. */}
      <div className={`${props.spot ? '' : 'mt-1.5 '}flex flex-wrap items-center gap-1.5`}>
        {/* Not the `hidden` attribute: the flex class would override it. */}
        {optionsExpanded && (
          <div className="order-2 flex w-full flex-wrap items-center gap-1.5 sm:order-1 sm:w-auto sm:min-w-0 sm:flex-1">
            {props.actions}
          </div>
        )}
        <div className="order-1 ml-auto flex items-center gap-1 sm:order-2">
          {props.onSpeedChange && !props.spot && (
            <NativeSelect
              aria-label="Driving speed"
              title="Preview speed; posted limits are not loaded"
              className="h-8 shrink-0 rounded border bg-background px-1 touch:h-10"
              value={props.speedKmh}
              onChange={(e) => props.onSpeedChange?.(Number(e.target.value))}
            >
              {DRIVE_SPEEDS_KMH.map((speed) => (
                <option key={speed} value={speed}>
                  {speed} km/h
                </option>
              ))}
            </NativeSelect>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 md:hidden touch:h-10"
            aria-expanded={optionsExpanded}
            onClick={() => setOptionsExpanded((current) => !current)}
          >
            {optionsExpanded ? 'Hide options' : 'Show options'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Reset look"
            title="Reset look (R)"
            className="h-8 w-8 p-0 touch:h-10 touch:w-10"
            onClick={() => setView({ yaw: 0, tilt: 0 })}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <InfoTip label="Keys and gestures">
            Drag to look around. Arrow keys turn and tilt; R resets the look; Space plays or pauses; Escape returns to
            the map. While paused, hold W A S D to walk off the road along where you look (Shift to hurry); the eye
            stays on the same ground model, and stops where the loaded ground ends.
          </InfoTip>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Return to map"
            title="Return to map (Esc)"
            className="h-8 w-8 p-0 touch:h-10 touch:w-10"
            onClick={props.onExit}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Walking on a phone: the keyboard's job, as held buttons. */}
      {!props.playing && !props.preliminary && (
        <div className="mt-1.5 hidden touch:flex items-center gap-1" role="group" aria-label="Walk off the road">
          {(
            [
              ['a', 'Step left', <ArrowLeft key="a" className="h-4 w-4" />],
              ['w', 'Walk forward', <ArrowUp key="w" className="h-4 w-4" />],
              ['s', 'Walk back', <ArrowDown key="s" className="h-4 w-4" />],
              ['d', 'Step right', <ArrowRight key="d" className="h-4 w-4" />],
            ] as const
          ).map(([keyName, label, icon]) => (
            <Button
              key={keyName}
              variant="outline"
              size="sm"
              aria-label={label}
              className="h-10 w-10 p-0"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                heldRef.current.add(keyName)
              }}
              onPointerUp={() => heldRef.current.delete(keyName)}
              onPointerCancel={() => heldRef.current.delete(keyName)}
              onLostPointerCapture={() => heldRef.current.delete(keyName)}
            >
              {icon}
            </Button>
          ))}
          <span className="ml-1 text-2xs text-muted-foreground">Walk</span>
        </div>
      )}

      {(statusText || offRoadMeters > 0 || props.status) && (
        <div className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5 text-2xs leading-4" role="status">
          {statusText && <p>{statusText}</p>}
          {offRoadMeters > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 text-amber-800 dark:text-amber-200">
              <span>
                {offRoadMeters} m off the road{walkHeld ? ' · the loaded ground ends here' : ''} · red ground is still
                the nearest road station's view
              </span>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  walkRef.current = NO_WALK
                  setOffRoadMeters(0)
                  setWalkHeld(false)
                }}
              >
                Back to the road
              </button>
            </p>
          )}
          {props.status}
        </div>
      )}
    </div>
  )
}
