/**
 * Another engine drawing the road view (`externalRenderers.ts`): its own page in a frame over PGMaps' road view,
 * fed the scene package and the drive camera. The frame takes no pointer input, so dragging to look round, driving
 * and every control still go to PGMaps' map underneath, and the engine follows it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { Loader2 } from 'lucide-react'
import type { MapRef } from '@/components/ui/map'
import { MapOverlay } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import type { DrivePose } from './driveController'
import {
  engineCamera,
  engineEnvironment,
  type EngineEnvironmentChoice,
  engineStatsLine,
  needsNewPackage,
  readEngineMessage,
  roadRendererInfo,
  type RoadRendererId,
} from './externalRenderers'
import { captureTransfer, type EngineCaptureRequest } from './engineCapture'
import type { ScenePackage } from './scenePackage'

type Props = {
  renderer: Exclude<RoadRendererId, 'pgmaps'>
  url: string
  mapRef: RefObject<MapRef | null>
  poseRef: RefObject<DrivePose | null>
  /** The scene package round an eye (the drive's current one when null), or null while the road view cannot make one. */
  buildScene: (eye: { lng: number; lat: number } | null) => ScenePackage | null
  /** A new object when the stand itself changes (harvest phase, forest records, openings, terrain): a new package. */
  stand: object
  /** The light and weather to draw; sent on its own, so a change never rebuilds the stand. */
  environment: EngineEnvironmentChoice
  /** Back to PGMaps' own drawing. */
  onUsePgmaps: () => void
  /** Filled while the engine listens: asks it for an analysis sheet's frames (`engineCapture.ts`). */
  captureRef?: MutableRefObject<EngineCaptureHandle | null>
}

/** How the page asks the engine in the frame for a capture. */
export type EngineCaptureHandle = {
  renderer: Exclude<RoadRendererId, 'pgmaps'>
  label: string
  /**
   * Has the engine draw `scene` (a package sized for the capture), waits until it is ready, then sends the request
   * made for that package and resolves with the engine's reply, raw (`readCaptureReply` checks it). The engine keeps
   * drawing `scene` afterwards.
   */
  capture: (scene: ScenePackage, request: (scene: ScenePackage) => EngineCaptureRequest) => Promise<unknown>
}

/** How often, and how long, the bridge retries a scene the road view cannot build yet (its terrain still loading). */
const SCENE_RETRY_MS = 1000
const SCENE_WAIT_MS = 120_000

/** Longest an engine has to build a capture's scene and draw its frames. */
const CAPTURE_TIMEOUT_MS = 180_000

type Phase = 'starting' | 'building' | 'ready' | 'error'

export function ExternalRoadRenderer({
  renderer,
  url,
  mapRef,
  poseRef,
  buildScene,
  stand,
  environment,
  onUsePgmaps,
  captureRef,
}: Props) {
  const info = roadRendererInfo(renderer)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [phase, setPhase] = useState<Phase>('starting')
  const [message, setMessage] = useState<string | null>(null)
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const origin = new URL(url, window.location.href).origin
  // The latest scene builder, for the bridge, which lives outside render.
  const buildRef = useRef(buildScene)
  const environmentRef = useRef(environment)
  useLayoutEffect(() => {
    buildRef.current = buildScene
    environmentRef.current = environment
  })
  // The bridge runs on every map move and must never re-render the page, so it is plain functions over refs.
  const bridgeRef = useRef<{ sendScene: () => void; sendEnvironment: () => void } | null>(null)

  useEffect(() => {
    let listening = false
    let current: ScenePackage | null = null
    // A transfer list hands buffers over rather than copying them (a final capture's stand is tens of megabytes).
    const post = (data: unknown, transfer: Transferable[] = []) =>
      frameRef.current?.contentWindow?.postMessage(data, { targetOrigin: origin, transfer })
    const sendCamera = () => {
      const map = mapRef.current
      if (!map || !current || !listening) return
      const pose = poseRef.current
      const canvas = map.getCanvas()
      if (!canvas.clientWidth || !canvas.clientHeight) return
      const eye = pose
        ? { lng: pose.lng, lat: pose.lat, elevationMeters: pose.eyeElevationMeters }
        : { lng: current.origin.lng, lat: current.origin.lat, elevationMeters: current.camera.position[2] }
      post(
        engineCamera(current.origin, eye, {
          bearingDegrees: map.getBearing(),
          // MapLibre's pitch is 90° at the horizon.
          pitchDegrees: map.getPitch() - 90,
          verticalFovDegrees: map.getVerticalFieldOfView(),
          viewport: {
            width: canvas.clientWidth,
            height: canvas.clientHeight,
            pixelRatio: canvas.width / canvas.clientWidth,
          },
        }),
      )
    }
    const sendEnvironment = () => {
      if (!listening) return
      const pose = poseRef.current
      const place = pose ?? current?.origin
      if (place) post(engineEnvironment(environmentRef.current, place, new Date()))
    }
    // The road view's terrain may still be loading when an engine is chosen: wait for it, retrying, rather than
    // stopping with an error the engine never recovers from.
    let waitTimer = 0
    let waitedMs = 0
    const sendScene = () => {
      if (!listening) return
      window.clearTimeout(waitTimer)
      const pose = poseRef.current
      let scene: ScenePackage | null = null
      try {
        scene = buildRef.current(pose ? { lng: pose.lng, lat: pose.lat } : null)
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        if (waitedMs < SCENE_WAIT_MS) {
          setPhase('starting')
          setMessage(null)
          waitedMs += SCENE_RETRY_MS
          waitTimer = window.setTimeout(sendScene, SCENE_RETRY_MS)
          return
        }
        setPhase('error')
        setMessage(text)
        return
      }
      waitedMs = 0
      if (!scene) return
      current = scene
      setPhase('building')
      sendEnvironment()
      post({ type: 'pgmaps-scene', scene })
      sendCamera()
    }
    bridgeRef.current = { sendScene, sendEnvironment }

    // Captures: the next `ready` after a capture's scene, then the reply with the request's id.
    let readyWaiter: (() => void) | null = null
    const replies = new Map<string, (data: unknown) => void>()
    const capture: EngineCaptureHandle['capture'] = (scene, makeRequest) =>
      new Promise((resolve, reject) => {
        if (!listening) {
          reject(new Error(`${info.label} is not running yet.`))
          return
        }
        let id: string | null = null
        const timer = window.setTimeout(() => {
          readyWaiter = null
          if (id) replies.delete(id)
          reject(new Error(`${info.label} did not finish the capture in ${CAPTURE_TIMEOUT_MS / 1000} s.`))
        }, CAPTURE_TIMEOUT_MS)
        readyWaiter = () => {
          readyWaiter = null
          const request = makeRequest(scene)
          id = request.id
          replies.set(request.id, (data) => {
            window.clearTimeout(timer)
            resolve(data)
          })
          post(request, captureTransfer(request))
        }
        current = scene
        setPhase('building')
        sendEnvironment()
        post({ type: 'pgmaps-scene', scene })
        sendCamera()
      })
    if (captureRef) captureRef.current = { renderer, label: info.label, capture }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== origin) return
      const raw = event.data as { type?: unknown; id?: unknown } | null
      if (raw?.type === 'pgmaps-engine-capture' && typeof raw.id === 'string') {
        const reply = replies.get(raw.id)
        replies.delete(raw.id)
        reply?.(raw)
        return
      }
      const data = readEngineMessage(event.data)
      if (!data) return
      if (data.type === 'pgmaps-engine-hello') {
        listening = true
        sendScene()
      } else if (data.type === 'pgmaps-engine-ready') {
        setPhase('ready')
        setMessage(null)
        sendCamera()
        readyWaiter?.()
      } else if (data.type === 'pgmaps-engine-stats') {
        setStats(data)
      } else if (data.type === 'pgmaps-engine-error') {
        setPhase('error')
        setMessage(data.message ?? 'The engine stopped.')
      }
    }
    window.addEventListener('message', onMessage)

    // The camera, once a frame at most; a new package once the eye has left the old one's stand.
    const map = mapRef.current
    let frame = 0
    const onMove = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const pose = poseRef.current
        if (current && pose && needsNewPackage(current.origin, pose, current.treeRadiusMeters)) sendScene()
        else sendCamera()
      })
    }
    map?.on('move', onMove)
    map?.on('resize', onMove)

    // An engine page that never answers (its server not running, a wrong address) says so rather than spinning.
    const timer = window.setTimeout(() => {
      if (listening) return
      setPhase('error')
      setMessage(`no answer from ${origin}. Is its page running?`)
    }, 20000)

    return () => {
      bridgeRef.current = null
      window.clearTimeout(waitTimer)
      if (captureRef?.current?.capture === capture) captureRef.current = null
      replies.clear()
      readyWaiter = null
      window.removeEventListener('message', onMessage)
      map?.off('move', onMove)
      map?.off('resize', onMove)
      if (frame) cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [origin, mapRef, poseRef, captureRef, renderer, info.label])

  // A new scene when the stand changes.
  useEffect(() => {
    bridgeRef.current?.sendScene()
  }, [stand])
  // The light and weather, on their own.
  useEffect(() => {
    bridgeRef.current?.sendEnvironment()
  }, [environment])

  return (
    <>
      <iframe
        ref={frameRef}
        src={url}
        title={`Road view drawn by ${info.label}`}
        allow="webgpu"
        data-testid="road-view-engine"
        data-engine={renderer}
        data-engine-phase={phase}
        className="pointer-events-none absolute inset-0 h-full w-full border-0"
      />
      <MapOverlay
        position="top-center"
        clearChrome
        role="status"
        className="flex max-w-[22rem] items-center gap-1.5 px-2.5 py-1.5 text-xs"
        data-testid="road-view-engine-status"
      >
        {phase === 'error' ? (
          <span className="text-warning">
            {info.label}: {message} <TextButton onClick={onUsePgmaps}>Use PGMaps</TextButton>
          </span>
        ) : phase === 'ready' ? (
          <span>{engineStatsLine(info, stats)} · display only; figures are PGMaps&apos; own</span>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            {phase === 'starting' ? `Starting ${info.label}…` : `${info.label} is building the stand…`}
          </>
        )}
      </MapOverlay>
    </>
  )
}
