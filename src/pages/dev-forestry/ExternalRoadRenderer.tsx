/**
 * Another engine drawing the road view (`externalRenderers.ts`): a worker drawing into a canvas over PGMaps' road
 * view, or its own page in a frame there (`EngineSurface`), fed the scene package and the drive camera. Neither takes
 * pointer input, so dragging to look round, driving and every control still go to PGMaps' map underneath, and the
 * engine follows it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { Loader2 } from 'lucide-react'
import type { MapRef } from '@/components/ui/map'
import { MapOverlay } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import { viewingGapToward } from './forest'
import type { PolygonGeometry } from './visibility'
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
import type { EngineChannel } from './engineChannel'
import { EngineSurface } from './EngineSurface'
import { captureTransfer, type EngineCaptureRequest } from './engineCapture'
import type { ScenePackage } from './scenePackage'
import { ACCEPTS_PACKED_ARRAYS, engineAccepts, packScene } from './scenePosting'
import { sceneForEngine } from './sceneComponents'
import { TREE_TILE_CAPABILITY, TREE_TILE_INTERVAL_MS, type createLiveTreeTiles } from './liveTreeTiles'
import { captureForEngine } from './engineRequests'
import { ACCEPTS_RENDER_OPTIONS, DEFAULT_ENGINE_RENDER_OPTIONS, type EngineRenderOptions } from './engineRenderOptions'

type Props = {
  renderer: Exclude<RoadRendererId, 'pgmaps'>
  url: string
  mapRef: RefObject<MapRef | null>
  poseRef: RefObject<DrivePose | null>
  viewingGapTarget: PolygonGeometry | null
  /** The scene package round an eye (the drive's current one when null), or null while the road view cannot make one. */
  buildScene: (eye: { lng: number; lat: number } | null, tileGeneration?: number) => ScenePackage | null
  openTreeTiles: (scene: ScenePackage) => ReturnType<typeof createLiveTreeTiles>
  /** A new object when the stand itself changes (harvest phase, forest records, openings, terrain): a new package. */
  stand: object
  /** The light and weather to draw; sent on its own, so a change never rebuilds the stand. */
  environment: EngineEnvironmentChoice
  renderOptions?: EngineRenderOptions
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
   * drawing `scene` afterwards. The request may be a promise: what it waits on (the frame's stand) is then built
   * while the engine builds the scene, not before the scene is sent.
   */
  capture: (
    scene: ScenePackage,
    request: (
      scene: ScenePackage,
      renderOptions?: EngineRenderOptions,
    ) => EngineCaptureRequest | Promise<EngineCaptureRequest>,
    renderOptions?: EngineRenderOptions,
  ) => Promise<unknown>
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
  viewingGapTarget,
  buildScene,
  openTreeTiles,
  stand,
  environment,
  renderOptions = DEFAULT_ENGINE_RENDER_OPTIONS,
  onUsePgmaps,
  captureRef,
}: Props) {
  const info = roadRendererInfo(renderer)
  const [channel, setChannel] = useState<EngineChannel | null>(null)
  const [phase, setPhase] = useState<Phase>('starting')
  const [message, setMessage] = useState<string | null>(null)
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  // The latest scene builder, for the bridge, which lives outside render.
  const gapTargetRef = useRef(viewingGapTarget)
  const buildRef = useRef(buildScene)
  const openTreeTilesRef = useRef(openTreeTiles)
  const environmentRef = useRef(environment)
  const renderOptionsRef = useRef(renderOptions)
  useLayoutEffect(() => {
    gapTargetRef.current = viewingGapTarget
    buildRef.current = buildScene
    openTreeTilesRef.current = openTreeTiles
    environmentRef.current = environment
    renderOptionsRef.current = renderOptions
  })
  // The bridge runs on every map move and must never re-render the page, so it is plain functions over refs.
  const bridgeRef = useRef<{
    sendScene: () => void
    sendEnvironment: () => void
    sendRenderOptions: () => void
    sendCamera: () => void
  } | null>(null)

  useEffect(() => {
    if (!channel) return
    let listening = false
    let current: ScenePackage | null = null
    let tiles: ReturnType<typeof createLiveTreeTiles> | null = null
    let generation = 0
    let tileReady = false
    let commitTiles: (() => void) | null = null
    let tileFailures = 0
    let tileTimer = 0
    let tileAckTimer = 0
    const pauseTiles = () => {
      tileReady = false
      commitTiles = null
      setMessage('Tree details paused. The coarse canopy is still visible.')
    }
    // A transfer list hands buffers over rather than copying them (a final capture's stand is tens of megabytes).
    const post = channel.post
    // What the engine page takes (its hello): one that takes packed arrays is handed the package's numbers as
    // buffers, not copied number by number on this page's main thread (`scenePosting.ts`).
    let accepts: unknown = null
    const postScene = (scene: ScenePackage) => {
      scene = sceneForEngine(scene, accepts)
      if (!engineAccepts(accepts, ACCEPTS_PACKED_ARRAYS)) {
        post({ type: 'pgmaps-scene', scene })
        return
      }
      const packed = packScene(scene)
      post({ type: 'pgmaps-scene', scene: packed.scene, key: packed.key }, packed.transfer)
    }
    const sendCamera = () => {
      const map = mapRef.current
      if (!map || !current || !listening) return
      const pose = poseRef.current
      const canvas = map.getCanvas()
      if (!canvas.clientWidth || !canvas.clientHeight) return
      const eye = pose
        ? { lng: pose.lng, lat: pose.lat, elevationMeters: pose.eyeElevationMeters }
        : { lng: current.origin.lng, lat: current.origin.lat, elevationMeters: current.camera.position[2] }
      const gap = gapTargetRef.current
      const camera = engineCamera(current.origin, eye, {
        bearingDegrees: map.getBearing(),
        // MapLibre's pitch is 90° at the horizon.
        pitchDegrees: map.getPitch() - 90,
        verticalFovDegrees: map.getVerticalFieldOfView(),
        viewport: {
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          pixelRatio: canvas.width / canvas.clientWidth,
        },
      })
      post({
        ...camera,
        ...(engineAccepts(accepts, 'viewing-gap-v1') ? { viewingGap: gap ? viewingGapToward(eye, gap) : null } : {}),
      })
      if (!tiles || !tileReady || commitTiles || tileTimer) return
      tileTimer = window.setTimeout(() => {
        tileTimer = 0
        sendCamera()
      }, TREE_TILE_INTERVAL_MS)
      const update = tiles.next(
        camera.position,
        camera.bearingDegrees,
        camera.projection?.horizontalFovDegrees ?? camera.verticalFovDegrees,
      )
      if (update) {
        commitTiles = update.commit
        tileAckTimer = window.setTimeout(pauseTiles, 30000)
        post(update.message, update.transfer)
      } else {
        window.clearTimeout(tileTimer)
        tileTimer = 0
      }
    }
    const sendEnvironment = () => {
      if (!listening) return
      const pose = poseRef.current
      const place = pose ?? current?.origin
      if (place) post(engineEnvironment(environmentRef.current, place, new Date()))
    }
    const sendRenderOptions = () => {
      if (listening && engineAccepts(accepts, ACCEPTS_RENDER_OPTIONS))
        post({ type: 'pgmaps-render-options', options: renderOptionsRef.current })
    }
    // The road view's terrain may still be loading when an engine is chosen: wait for it, retrying, rather than
    // stopping with an error the engine never recovers from.
    let waitTimer = 0
    let waitedMs = 0
    const sendScene = () => {
      if (!listening || captureFailure) return
      window.clearTimeout(waitTimer)
      const pose = poseRef.current
      let scene: ScenePackage | null = null
      try {
        scene = buildRef.current(
          pose ? { lng: pose.lng, lat: pose.lat } : null,
          engineAccepts(accepts, TREE_TILE_CAPABILITY) ? ++generation : undefined,
        )
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
      tiles = scene.liveTreeTiles ? openTreeTilesRef.current(scene) : null
      tileReady = false
      commitTiles = null
      tileFailures = 0
      window.clearTimeout(tileTimer)
      window.clearTimeout(tileAckTimer)
      tileTimer = 0
      setPhase('building')
      sendEnvironment()
      postScene(scene)
      sendCamera()
    }
    bridgeRef.current = { sendScene, sendEnvironment, sendRenderOptions, sendCamera }

    // Captures: the next `ready` after a capture's scene, then the reply with the request's id.
    let readyWaiter: (() => void) | null = null
    let captureFailure: ((error: Error) => void) | null = null
    const replies = new Map<string, (data: unknown) => void>()
    const capture: EngineCaptureHandle['capture'] = (scene, makeRequest, options = { ...renderOptionsRef.current }) =>
      new Promise((resolve, reject) => {
        if (!listening) {
          reject(new Error(`${info.label} is not running yet.`))
          return
        }
        if (captureFailure) {
          reject(new Error(`${info.label} is already capturing a view.`))
          return
        }
        let id: string | null = null
        let finished = false
        const timer = window.setTimeout(() => {
          captureFailure?.(new Error(`${info.label} did not finish the capture in ${CAPTURE_TIMEOUT_MS / 1000} s.`))
        }, CAPTURE_TIMEOUT_MS)
        captureFailure = (error) => {
          finished = true
          window.clearTimeout(timer)
          readyWaiter = null
          captureFailure = null
          if (id) replies.delete(id)
          reject(error)
          if (engineAccepts(accepts, TREE_TILE_CAPABILITY)) sendScene()
        }
        readyWaiter = () => {
          readyWaiter = null
          Promise.resolve()
            .then(() => makeRequest(scene, options))
            .then(
              (request) => {
                if (finished) return
                request = captureForEngine(request, accepts, options)
                id = request.id
                replies.set(request.id, (data) => {
                  window.clearTimeout(timer)
                  captureFailure = null
                  finished = true
                  resolve(data)
                  if (engineAccepts(accepts, TREE_TILE_CAPABILITY)) sendScene()
                })
                post(request, captureTransfer(request))
              },
              (error: unknown) => {
                captureFailure?.(error instanceof Error ? error : new Error(String(error)))
              },
            )
        }
        current = scene
        tiles = null
        tileReady = false
        commitTiles = null
        window.clearTimeout(tileAckTimer)
        setPhase('building')
        sendEnvironment()
        postScene(scene)
        sendCamera()
      })
    if (captureRef) captureRef.current = { renderer, label: info.label, capture }

    const onMessage = (message: unknown) => {
      const raw = message as { type?: unknown; id?: unknown; generation?: unknown; error?: unknown } | null
      if (raw?.type === 'pgmaps-tree-tiles-applied') {
        if (tiles && commitTiles && raw.generation === current?.liveTreeTiles?.generation) {
          window.clearTimeout(tileAckTimer)
          if (raw.error) {
            if (++tileFailures >= 2) {
              pauseTiles()
              return
            }
          } else {
            commitTiles()
            tileFailures = 0
          }
          commitTiles = null
          sendCamera()
        }
        return
      }
      if (raw?.type === 'pgmaps-engine-capture' && typeof raw.id === 'string') {
        const reply = replies.get(raw.id)
        replies.delete(raw.id)
        reply?.(raw)
        return
      }
      const data = readEngineMessage(message)
      if (!data) return
      if (data.type === 'pgmaps-engine-hello') {
        accepts = data.accepts
        listening = true
        sendRenderOptions()
        sendScene()
      } else if (data.type === 'pgmaps-engine-ready') {
        if (raw?.generation !== current?.liveTreeTiles?.generation) return
        tileReady = !!tiles
        setPhase('ready')
        setMessage(null)
        sendCamera()
        readyWaiter?.()
      } else if (data.type === 'pgmaps-engine-stats') {
        setStats(data)
      } else if (data.type === 'pgmaps-engine-error') {
        captureFailure?.(new Error(data.message ?? 'The engine stopped.'))
        setPhase('error')
        setMessage(data.message ?? 'The engine stopped.')
      }
    }
    const unlisten = channel.listen(onMessage)

    // The camera, once a frame at most; a new package once the eye has left the old one's stand.
    const map = mapRef.current
    let frame = 0
    const onMove = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const pose = poseRef.current
        if (
          current &&
          pose &&
          (tiles ? tiles.outside(pose) : needsNewPackage(current.origin, pose, current.treeRadiusMeters))
        )
          sendScene()
        else sendCamera()
      })
    }
    map?.on('move', onMove)
    map?.on('resize', onMove)

    // An engine that never answers (its server not running, a wrong address, a worker never built) says so rather
    // than spinning.
    const timer = window.setTimeout(() => {
      if (listening) return
      setPhase('error')
      setMessage(`no answer from ${new URL(url, window.location.href).origin}. Is it running?`)
    }, 20000)

    return () => {
      bridgeRef.current = null
      listening = false
      captureFailure?.(new Error(`${info.label} closed during the capture.`))
      window.clearTimeout(waitTimer)
      window.clearTimeout(tileTimer)
      window.clearTimeout(tileAckTimer)
      if (captureRef?.current?.capture === capture) captureRef.current = null
      replies.clear()
      readyWaiter = null
      unlisten()
      map?.off('move', onMove)
      map?.off('resize', onMove)
      if (frame) cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [channel, url, mapRef, poseRef, captureRef, renderer, info.label])

  // A new scene when the stand changes.
  useEffect(() => {
    bridgeRef.current?.sendScene()
  }, [stand])
  useEffect(() => {
    bridgeRef.current?.sendCamera()
  }, [viewingGapTarget])
  // The light and weather, on their own.
  useEffect(() => {
    bridgeRef.current?.sendEnvironment()
  }, [environment])
  useEffect(() => {
    bridgeRef.current?.sendRenderOptions()
  }, [renderOptions])

  return (
    <>
      <EngineSurface
        url={url}
        title={`Road view drawn by ${info.label}`}
        onConnect={setChannel}
        data-testid="road-view-engine"
        data-engine={renderer}
        data-engine-phase={phase}
        className="absolute inset-0 h-full w-full"
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
          <span>{message ?? engineStatsLine(info, stats)} · display only; figures are PGMaps&apos; own</span>
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
