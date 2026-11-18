/**
 * Records the road view video that `roadVideo.ts` plans. Browser only: it needs the eye-level map, `MediaRecorder`
 * and a 2D canvas.
 *
 * The camera is never moved here. The page lends the take its drive camera (`RoadVideoHost.drive`): along the road
 * the road view's own `DriveController` plays from the start of the stretch at the chosen speed; through the views it
 * stands the eye at each view's place, facing its bearing through its lens, as it stands a lined-up field photo
 * (`standAt`, `fixedLook`, `horizontalFovDegrees` on `DriveCamera`). The controller places the eye on the road view's
 * fixed ground mosaic, sends every pitch through `horizonSafePitch` and gives `jumpTo` an explicit roll, and its pose
 * reports move the drawn stand with the eye. The page never stands at a view through its stand-at action, which would
 * run the assessment there.
 *
 * For the whole take the eye map is kept drawing (`triggerRepaint` every animation frame: the road view's frame loops
 * sleep when nothing moves, which would freeze the video), each frame is copied into the composed recorder from the
 * map's own `render` event (the canvas reads back blank at any other time), and the road view's guide layers are
 * hidden as every capture hides them (`hideRoadViewGuides`, checked again each second). In `finally`, on success,
 * Stop, an error or cancel, the guides come back, the frame loop and the `render` listener are taken off, and the
 * drive is handed back to the reviewer (`drive(null)`), which puts back their place on the road, look, lens and
 * vertical field of view.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useCallback, useEffect, useRef, useState } from 'react'

import { canvasRecordingSupported, createComposedRecorder } from '@/lib/mapRecording/canvasRecorder'
import {
  fitSourceInFrame,
  MAX_RECORDING_MS,
  pickRecordingMimeType,
  recordingExtension,
  recordingFrameSize,
} from '@/lib/mapRecording/recordingFormat'
import type { DrivePose } from './driveController'
import { hideRoadViewGuides } from './mapCapture'
import { formatVideoDuration, stopCaption, type RoadVideoPlan, type RoadVideoTakeFacts } from './roadVideo'
import { haversineMeters } from './visibility'

/**
 * What the take asks of the road view's drive camera; the page maps it onto `DriveCamera`'s props in place of the
 * reviewer's own. A new `serial` seeks the camera again (and resets the look); `null` hands the drive back.
 */
export type RoadVideoDrive =
  | {
      kind: 'road'
      serial: number
      fromMeters: number
      playing: boolean
      speedMetersPerSecond: number
      /** Along the road, or toward what the road view faces now. */
      facing: 'road' | 'view'
    }
  | {
      kind: 'view'
      serial: number
      lng: number
      lat: number
      /** Compass bearing, degrees. */
      bearing: number
      /** Degrees above the horizon. */
      pitch: number
      /** Degrees, a photo's (positive raises its right side). */
      roll: number
      /** The lens's field across, degrees. */
      hfov: number
    }

/** What the page lends a take. Rebuilt on every render; read through a ref at each step. */
export type RoadVideoHost = {
  /** The road view's own map, or null while it is closed. */
  eyeMap: () => MapLibreMap | null
  /** The drive's last pose (`drivePoseRef`). */
  pose: () => DrivePose | null
  /** The drive camera has placed the eye (`ready`) and the stand nearest it is drawn. */
  placed: () => boolean
  /** Hands the drive camera to the take, or back to the reviewer (`null`). */
  drive: (next: RoadVideoDrive | null) => void
}

export type RoadVideoTakeStatus = 'idle' | 'preparing' | 'recording' | 'stopping' | 'done' | 'cancelled' | 'error'

export type RoadVideoTakeState = {
  status: RoadVideoTakeStatus
  /** Whole seconds recorded. */
  elapsedSeconds: number
  /** What the take is doing, or how it ended, worded. */
  message: string | null
}

/** A recorded take: the file and what *What goes in* says of it. Its `url` lives as long as the take is kept. */
export type RoadVideoTake = RoadVideoTakeFacts & {
  /** The plan it was recorded from (`RoadVideoPlan.key`). */
  key: string
  blob: Blob
  url: string
  fileName: string
  mimeType: string
}

export const IDLE_ROAD_VIDEO: RoadVideoTakeState = { status: 'idle', elapsedSeconds: 0, message: null }

/** How long a take waits, ms, and how often it looks. */
export const ROAD_VIDEO_TIMING = {
  pollMs: 100,
  /** The start of the stretch drawn: the camera placed, the nearby timber grown, the tiles loaded. */
  placeMs: 60_000,
  /** One view drawn; past it the view is left out and named. */
  viewMs: 45_000,
  /** Readiness must hold this long: the timber's status lags the eye by a poll and an upload. */
  steadyMs: 700,
  /** The guide layers are looked at again this often. */
  guideCheckMs: 1000,
  /** The dialog's monitor is drawn at most this often. */
  monitorMs: 200,
} as const

/** The format this browser writes a video in, or null when it cannot record one. */
export function browserVideoFormat(): 'mp4' | 'webm' | null {
  if (!canvasRecordingSupported() || typeof MediaRecorder === 'undefined') return null
  const type = pickRecordingMimeType((candidate) => MediaRecorder.isTypeSupported(candidate))
  return type ? recordingExtension(type) : null
}

/** The road view's canvas at the display's own resolution, as the recorder frames it (even, capped), or null. */
export function roadVideoFrame(map: MapLibreMap | null): { width: number; height: number } | null {
  const canvas = map?.getCanvas()
  if (!canvas) return null
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return recordingFrameSize(canvas.clientWidth * ratio, canvas.clientHeight * ratio)
}

class TakeCancelled extends Error {
  constructor() {
    super('Cancelled: nothing was kept.')
    this.name = 'TakeCancelled'
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

const bearingGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

/** Resolves on the map's next drawn frame (or after 2 s). */
function nextFrame(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 2000)
    map.once('render', () => {
      window.clearTimeout(timer)
      resolve()
    })
    map.triggerRepaint()
  })
}

/**
 * One take: lends the drive to the plan, records the eye map, and hands everything back in `finally`. Resolves with
 * the take (ended by its plan, Stop, the time limit or a hidden tab); rejects on an error or a cancel, keeping nothing.
 */
export async function runRoadVideoTake(
  getHost: () => RoadVideoHost | null,
  plan: RoadVideoPlan,
  control: {
    stopRequested: () => boolean
    cancelled: () => boolean
    onState: (patch: Partial<RoadVideoTakeState>) => void
    /** The dialog's small live picture of what is recorded, when it shows one. */
    monitor?: () => HTMLCanvasElement | null
  },
): Promise<RoadVideoTake> {
  if (plan.problem) throw new Error(plan.problem)
  const host = getHost()
  const map = host?.eyeMap() ?? null
  const frameSize = roadVideoFrame(map)
  if (!host || !map || !frameSize)
    throw new Error('Open the road view and let its terrain load first: the video records it.')
  // Throws before anything is lent where the browser cannot record.
  const recorder = createComposedRecorder({
    width: frameSize.width,
    height: frameSize.height,
    caption: plan.mode === 'views' ? stopCaption(plan, 0) : plan.caption,
    // A drive that stalls (terrain still loading) runs past its plan by at most half again and a minute; a tour by
    // the longest each view may take to draw.
    maxDurationMs: Math.min(
      MAX_RECORDING_MS,
      plan.route ? plan.durationMs * 1.5 + 60_000 : plan.durationMs + plan.stops.length * ROAD_VIDEO_TIMING.viewMs,
    ),
    onElapsed: (seconds) => control.onState({ elapsedSeconds: seconds }),
  })
  let failure: unknown = null
  recorder.result.catch((error: unknown) => {
    failure = error
  })

  // Every frame the map draws goes into the video while `drawing`: between views it is off, so the video holds the
  // last view's picture until the next one has drawn.
  let drawing = false
  let lastMonitor = 0
  const onRender = () => {
    const source = map.getCanvas()
    if (drawing) recorder.drawFrame(source)
    const monitor = control.monitor?.()
    const now = performance.now()
    if (!monitor || now - lastMonitor < ROAD_VIDEO_TIMING.monitorMs) return
    lastMonitor = now
    const context = monitor.getContext('2d')
    const placed = fitSourceInFrame(source.width, source.height, monitor.width, monitor.height)
    if (!context || !placed) return
    context.fillStyle = '#000000'
    context.fillRect(0, 0, monitor.width, monitor.height)
    context.drawImage(source, placed.x, placed.y, placed.width, placed.height)
  }
  // Guides hidden for the whole take, as for every picture; looked at again each second in case one is shown.
  const guides: Array<() => void> = []
  let lastGuides = performance.now()
  let frame = 0
  const keepAwake = () => {
    frame = requestAnimationFrame(keepAwake)
    map.triggerRepaint()
    const now = performance.now()
    if (now - lastGuides >= ROAD_VIDEO_TIMING.guideCheckMs) {
      lastGuides = now
      guides.push(hideRoadViewGuides(map))
    }
  }

  const lend = (next: Parameters<RoadVideoHost['drive']>[0]) => getHost()?.drive(next)
  const check = () => {
    if (control.cancelled()) throw new TakeCancelled()
    if (failure) throw failure
    if (getHost()?.eyeMap() !== map) throw new Error('The road view closed during the recording, so nothing was kept.')
  }
  // The take ends early on Stop, a hidden tab (the browser stops drawing it) or the recorder's own time limit.
  const ended = () =>
    control.stopRequested() || document.hidden || recorder.state === 'stopping' || recorder.state === 'done'
  const until = async (test: () => boolean, timeoutMs = Infinity) => {
    const started = performance.now()
    for (;;) {
      check()
      if (test()) return true
      if (performance.now() - started > timeoutMs) return false
      await sleep(ROAD_VIDEO_TIMING.pollMs)
    }
  }
  /** `ready` held for `steadyMs` without a break. */
  const steady = (ready: () => boolean, timeoutMs: number) => {
    let since: number | null = null
    return until(() => {
      if (!ready()) {
        since = null
        return false
      }
      since ??= performance.now()
      return performance.now() - since >= ROAD_VIDEO_TIMING.steadyMs
    }, timeoutMs)
  }
  const placed = () => !!getHost()?.placed() && map.areTilesLoaded()

  const notes: string[] = []
  let serial = 0
  try {
    guides.push(hideRoadViewGuides(map))
    map.on('render', onRender)
    frame = requestAnimationFrame(keepAwake)
    if (plan.route) {
      const route = plan.route
      const start = {
        kind: 'road' as const,
        serial: ++serial,
        fromMeters: route.fromMeters,
        speedMetersPerSecond: route.speedMetersPerSecond,
        facing: route.facing,
        playing: false,
      }
      control.onState({ status: 'preparing', message: 'Placing the eye at the start of the stretch…' })
      lend(start)
      const atStart = await steady(() => {
        const pose = getHost()?.pose()
        return !!pose && Math.abs(pose.distanceMeters - route.fromMeters) < 1.5 && placed()
      }, ROAD_VIDEO_TIMING.placeMs)
      if (!atStart)
        throw new Error(
          `The road view did not draw the start of the stretch within ${ROAD_VIDEO_TIMING.placeMs / 1000} s: its terrain or timber was still loading. Try again.`,
        )
      drawing = true
      await nextFrame(map)
      recorder.start()
      control.onState({ status: 'recording', message: `Driving ${route.road} at ${route.speedKmh} km/h` })
      lend({ ...start, playing: true })
      // Pose reports come every 100 ms: the drive overruns the stretch's end by at most a tenth of a second.
      await until(() => ended() || (getHost()?.pose()?.distanceMeters ?? -Infinity) >= route.toMeters - 0.5)
      lend({ ...start, playing: false })
    } else {
      const total = plan.stops.length
      for (let index = 0; index < total && !ended(); index++) {
        const stop = plan.stops[index]
        control.onState({
          status: recorder.state === 'recording' ? 'recording' : 'preparing',
          message: `View ${index + 1} of ${total}: standing at ${stop.name}…`,
        })
        // A cut: nothing is drawn into the video until the view has drawn, so it holds the last view meanwhile.
        drawing = false
        lend({ kind: 'view', serial: ++serial, ...stop.look })
        const drawn = await steady(() => {
          const pose = getHost()?.pose()
          return (
            !!pose &&
            haversineMeters(pose, stop.look) < 3 &&
            bearingGap(pose.bearing, stop.look.bearing) < 1.5 &&
            placed()
          )
        }, ROAD_VIDEO_TIMING.viewMs)
        if (!drawn) {
          notes.push(
            `${stop.name} was left out: it did not finish drawing within ${ROAD_VIDEO_TIMING.viewMs / 1000} s.`,
          )
          continue
        }
        recorder.setCaption(stopCaption(plan, index))
        drawing = true
        if (recorder.state === 'idle') {
          await nextFrame(map)
          recorder.start()
        }
        control.onState({ status: 'recording', message: `View ${index + 1} of ${total}: ${stop.name}` })
        const holdUntil = performance.now() + stop.holdMs
        await until(() => ended() || performance.now() >= holdUntil)
      }
    }
    check()
    if (recorder.state === 'idle')
      throw new Error(notes.length ? `Nothing was recorded. ${notes.join(' ')}` : 'Nothing was recorded.')
    let endedEarly: string | null = control.stopRequested()
      ? `stopped at ${formatVideoDuration(recorder.elapsedMs)}, before the end`
      : document.hidden
        ? 'stopped when the page was hidden: a browser stops drawing a hidden tab'
        : null
    control.onState({ status: 'stopping', message: 'Finishing the file…' })
    const recording = await recorder.stop()
    if (recording.endedBy === 'time-limit')
      endedEarly = `stopped at its time limit, ${formatVideoDuration(recording.durationMs)}, before the end (the road view was slow to draw its terrain or timber)`
    return {
      key: plan.key,
      blob: recording.blob,
      url: URL.createObjectURL(recording.blob),
      // The plan's name with the extension the browser wrote.
      fileName: plan.fileName.replace(/\.[a-z0-9]+$/i, `.${recording.extension}`),
      mimeType: recording.mimeType,
      extension: recording.extension,
      durationMs: recording.durationMs,
      width: recorder.width,
      height: recorder.height,
      endedEarly,
      notes,
    }
  } catch (error) {
    recorder.cancel()
    throw error
  } finally {
    cancelAnimationFrame(frame)
    map.off('render', onRender)
    for (const show of guides.reverse()) show()
    map.triggerRepaint()
    // The drive back to the reviewer: their place on the road, look, lens and field of view (the page's `drive(null)`).
    lend(null)
  }
}

/** Records road view videos for Save & export: one take at a time, the last one kept. */
export function useRoadVideo(hostRef: { readonly current: RoadVideoHost | null }) {
  const [state, setState] = useState<RoadVideoTakeState>(IDLE_ROAD_VIDEO)
  const [take, setTake] = useState<RoadVideoTake | null>(null)
  const runningRef = useRef(false)
  const stopRef = useRef(false)
  const cancelRef = useRef(false)
  const monitorRef = useRef<HTMLCanvasElement | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelRef.current = true
    }
  }, [])
  // The kept take's address lives as long as the take does.
  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take.url)
    },
    [take],
  )

  const record = useCallback(
    async (plan: RoadVideoPlan) => {
      if (runningRef.current) return
      runningRef.current = true
      stopRef.current = false
      cancelRef.current = false
      // One take is kept: a new one replaces it.
      setTake(null)
      setState({ status: 'preparing', elapsedSeconds: 0, message: 'Getting the road view ready…' })
      try {
        const recorded = await runRoadVideoTake(() => hostRef.current, plan, {
          stopRequested: () => stopRef.current,
          cancelled: () => cancelRef.current,
          onState: (patch) => {
            if (mountedRef.current) setState((current) => ({ ...current, ...patch }))
          },
          monitor: () => monitorRef.current,
        })
        if (!mountedRef.current) {
          URL.revokeObjectURL(recorded.url)
          return
        }
        setTake(recorded)
        setState({
          status: 'done',
          elapsedSeconds: Math.round(recorded.durationMs / 1000),
          message: recorded.endedEarly ? `Recorded, ${recorded.endedEarly}.` : null,
        })
      } catch (error) {
        if (!mountedRef.current) return
        setState({
          status: cancelRef.current ? 'cancelled' : 'error',
          elapsedSeconds: 0,
          message: cancelRef.current
            ? 'Cancelled: nothing was kept.'
            : error instanceof Error
              ? error.message
              : 'The video could not be recorded.',
        })
      } finally {
        runningRef.current = false
      }
    },
    [hostRef],
  )
  /** Ends the take now, keeping what was recorded. */
  const stop = useCallback(() => {
    if (runningRef.current) stopRef.current = true
  }, [])
  /** Ends the take and keeps nothing (closing the dialog). */
  const cancel = useCallback(() => {
    if (runningRef.current) cancelRef.current = true
  }, [])
  const setMonitor = useCallback((canvas: HTMLCanvasElement | null) => {
    monitorRef.current = canvas
  }, [])
  return { state, take, record, stop, cancel, setMonitor }
}

export type RoadVideoApi = ReturnType<typeof useRoadVideo>
