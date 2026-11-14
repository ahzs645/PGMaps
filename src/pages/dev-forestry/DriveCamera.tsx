import { StyledSelect } from '@/components/ui/form-field'
import type { ReactNode } from 'react'
import type { ElevationSource } from './terrain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { useMap } from '@/components/ui/map'
import { MapOverlay } from '@/components/ui/map-panels'
import { PlaybackControls } from '@/components/ui/playback-controls'
import { cn } from '@/lib/utils'
import { DriveController, type DriveMap, type DriveOptions, type DrivePose, type DriveStatus } from './driveController'
import { offsetFrom } from './exifPose'
import { PreviewFrameBudget } from './previewState'
import {
  DRIVE_SPEEDS_KMH,
  NO_WALK,
  WALK_SPEEDS,
  roadPath,
  roadPlacement,
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
  /** A stood-at viewpoint's surveyed eye elevation; see `DriveOptions.surveyedEye`. */
  surveyedEye?: import('./types').SurveyedEye | null
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
  /**
   * Stand the eye here while paused, off the road if need be: where the
   * reviewer's own field photo was taken. It holds the walker there, so walking
   * and Reset do not move it; playback ignores it, as it does a walk.
   */
  standAt?: { lng: number; lat: number } | null
}
/** Below this map width the controls open folded to the player row, as on a phone. */
const NARROW_VIEW_PX = 640
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
  // A road view in a narrow pane beside the plan folds the same way: it is judged by its own map's
  // width, so a pane dragged narrow folds too. Show or Hide options then holds until the view closes.
  const [narrowView, setNarrowView] = useState(
    () => typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches,
  )
  const [optionsChoice, setOptionsChoice] = useState<boolean | null>(null)
  const optionsExpanded = optionsChoice ?? !narrowView
  useEffect(() => {
    if (!map) return
    const container = map.getContainer()
    const observer = new ResizeObserver(() => setNarrowView(container.clientWidth < NARROW_VIEW_PX))
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])
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
      const standRoad = current.standAt && !current.playing ? roadPlacement(path, current.seekMeters) : null
      const walk = standRoad && current.standAt ? offsetFrom(standRoad, current.standAt) : walkRef.current
      const options: DriveOptions = { ...current, ...viewRef.current, walk, onStatus: setStatus }
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
      } else if (event.key.toLowerCase() === 'r') {
        // As the button: off the road, R walks back too.
        walkRef.current = NO_WALK
        setOffRoadMeters(0)
        setWalkHeld(false)
        setView({ yaw: 0, tilt: 0 })
      } else if (event.key.startsWith('Arrow')) {
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
  // Where the eye walks back to: the road, or the spot a viewpoint stands it on.
  const home = props.spot ? 'viewpoint' : 'road'
  const offRoad =
    offRoadMeters > 0
      ? `${offRoadMeters} m off the ${home}${walkHeld ? ' · the loaded ground ends here' : ''}. Red ground is still the ${props.spot ? 'viewpoint' : 'nearest road station'}'s view, not this spot's.`
      : null
  const resetLook = () => {
    walkRef.current = NO_WALK
    setOffRoadMeters(0)
    setWalkHeld(false)
    setView({ yaw: 0, tilt: 0 })
  }
  const statusText =
    status === 'waiting-for-terrain'
      ? 'Waiting for terrain at the camera. Playback is held.'
      : status === 'invalid-camera'
        ? 'This camera pose is invalid. Reset the look or return to the map.'
        : null
  return (
    <MapOverlay
      position="bottom-center"
      clearChrome
      // Full width on a phone; a centred bar on wider screens.
      className="left-3 right-3 translate-x-0 rounded-lg bg-background/95 px-2.5 py-2 text-xs shadow-lg md:left-1/2 md:right-auto md:w-[min(46rem,calc(100%-6rem))] md:-translate-x-1/2"
      role="region"
      aria-label="Road view controls"
    >
      {/* Row 1: the player. Nothing to drive at a single spot. */}
      {!props.spot && (
        <PlaybackControls
          mode="continuous"
          label="Playback"
          value={props.seekMeters}
          max={props.routeLengthMeters ?? 0}
          step={5}
          onValueChange={(metres) => props.onSeek?.(metres)}
          disabled={!props.onSeek && props.stations.length < 2}
          playing={props.playing}
          onPlayingChange={(play) => (play ? props.onPlay?.() : props.onPause?.())}
          canPlay={props.stations.length >= 2 && status === 'ready' && props.forestReady !== false}
          skip={props.onSeek ? 10 : undefined}
          skipLabel="10 m"
          seekLabel="Route position"
          pauseOnScrub={false}
          playButton="labelled"
          formatValue={km}
          valueText={`${km(props.seekMeters)} of ${km(props.routeLengthMeters ?? 0)} km`}
          valueLabel={
            <>
              {km(props.seekMeters)}
              <span className="max-sm:hidden"> / {km(props.routeLengthMeters ?? 0)}</span> km
            </>
          }
        />
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
            <StyledSelect
              aria-label="Driving speed"
              title="Preview speed; posted limits are not loaded"
              className="h-7 shrink-0 rounded-md border bg-background px-1 touch:h-10"
              value={props.speedKmh}
              onChange={(e) => props.onSpeedChange?.(Number(e.target.value))}
            >
              {DRIVE_SPEEDS_KMH.map((speed) => (
                <option key={speed} value={speed}>
                  {speed} km/h
                </option>
              ))}
            </StyledSelect>
          )}

          <Button
            variant="outline"
            size="xs"
            // Wherever the view is narrow, a phone or a pane beside the plan, not only below `md`.
            className={narrowView ? 'touch:h-10' : 'md:hidden touch:h-10'}
            aria-expanded={optionsExpanded}
            onClick={() => setOptionsChoice(!optionsExpanded)}
          >
            {optionsExpanded ? 'Hide options' : 'Show options'}
          </Button>
          {/* Off the road, the reset also walks back, and turns amber to say the
            red ground is still the nearest station's view rather than this spot's. */}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={offRoad ? `Back to the ${home} and reset the look. ${offRoad}` : 'Reset look'}
            title={offRoad ? `${offRoad}\nClick (or R) to go back to the ${home}.` : 'Reset look (R)'}
            data-off-road={offRoadMeters > 0 ? offRoadMeters : undefined}
            className={cn(
              'relative touch:h-10 touch:w-10',
              offRoadMeters > 0 &&
                'bg-warning-surface text-warning-foreground hover:bg-warning/15 hover:text-warning-foreground',
            )}
            onClick={resetLook}
          >
            {offRoadMeters > 0 ? <TriangleAlert className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
          </Button>
          <InfoTip label="Keys and gestures">
            Drag to look around. Arrow keys turn and tilt; R resets the look; Space plays or pauses; Escape returns to
            the map. While paused, hold W A S D to walk off the road along where you look (Shift to hurry); the eye
            stays on the same ground model, and stops where the loaded ground ends.
          </InfoTip>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Return to map"
            title="Return to map (Esc)"
            className="touch:h-10 touch:w-10"
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

      {(statusText || props.status) && (
        <div className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5 text-2xs leading-4" role="status">
          {statusText && <p>{statusText}</p>}
          {props.status}
        </div>
      )}
    </MapOverlay>
  )
}
