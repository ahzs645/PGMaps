/**
 * Another engine drawing the road view (`externalRenderers.ts`): its own page in a frame over PGMaps' road view,
 * fed the scene package and the drive camera. The frame takes no pointer input, so dragging to look round, driving
 * and every control still go to PGMaps' map underneath, and the engine follows it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
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
}

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
    const post = (data: unknown) => frameRef.current?.contentWindow?.postMessage(data, origin)
    const sendCamera = () => {
      const map = mapRef.current
      if (!map || !current || !listening) return
      const pose = poseRef.current
      const eye = pose
        ? { lng: pose.lng, lat: pose.lat, elevationMeters: pose.eyeElevationMeters }
        : { lng: current.origin.lng, lat: current.origin.lat, elevationMeters: current.camera.position[2] }
      post(
        engineCamera(current.origin, eye, {
          bearingDegrees: map.getBearing(),
          // MapLibre's pitch is 90° at the horizon.
          pitchDegrees: map.getPitch() - 90,
          verticalFovDegrees: map.getVerticalFieldOfView(),
        }),
      )
    }
    const sendEnvironment = () => {
      if (!listening) return
      const pose = poseRef.current
      const place = pose ?? current?.origin
      if (place) post(engineEnvironment(environmentRef.current, place, new Date()))
    }
    const sendScene = () => {
      if (!listening) return
      const pose = poseRef.current
      let scene: ScenePackage | null = null
      try {
        scene = buildRef.current(pose ? { lng: pose.lng, lat: pose.lat } : null)
      } catch (error) {
        setPhase('error')
        setMessage(error instanceof Error ? error.message : String(error))
        return
      }
      if (!scene) return
      current = scene
      setPhase('building')
      sendEnvironment()
      post({ type: 'pgmaps-scene', scene })
      sendCamera()
    }
    bridgeRef.current = { sendScene, sendEnvironment }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== origin) return
      const data = readEngineMessage(event.data)
      if (!data) return
      if (data.type === 'pgmaps-engine-hello') {
        listening = true
        sendScene()
      } else if (data.type === 'pgmaps-engine-ready') {
        setPhase('ready')
        setMessage(null)
        sendCamera()
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

    // An engine page that never answers (its server not running, a wrong address) says so rather than spinning.
    const timer = window.setTimeout(() => {
      if (listening) return
      setPhase('error')
      setMessage(`no answer from ${origin}. Is its page running?`)
    }, 20000)

    return () => {
      bridgeRef.current = null
      window.removeEventListener('message', onMessage)
      map?.off('move', onMove)
      if (frame) cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [origin, mapRef, poseRef])

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
