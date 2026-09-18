import { useEffect, useRef } from 'react'

import { useMap } from '@/components/ui/map'

import { bearingDegrees, haversineMeters } from './visibility'

/**
 * MapLibre treats pitch as the angle from straight down, so 90° is the horizon.
 * Past 85° the renderer is documented as experimental, so views that would look
 * further up a hillside are clamped here instead.
 */
const MAX_PITCH = 85
const MIN_PITCH = 30

export type DriveStation = {
  lng: number
  lat: number
  groundElevationMeters: number
  distanceAlongMeters: number
}

export type DriveLookAt = {
  lng: number
  lat: number
  elevationMeters: number
}

type DriveCameraProps = {
  active: boolean
  playing: boolean
  stations: DriveStation[]
  /** Metres from the start of the corridor to start at, or resume from after a seek. */
  seekMeters: number
  /** Bumped by the caller to force a jump to `seekMeters`. */
  seekVersion: number
  speedMetersPerSecond: number
  eyeHeightMeters: number
  /** Where to face. Null looks along the direction of travel. */
  lookAt: DriveLookAt | null
  /** Compass bearing used when `lookAt` is null and the corridor is a single spot. */
  spotBearing: number
  onPosition: (position: { distanceMeters: number; stationIndex: number }) => void
  onReachEnd?: () => void
}

type Placement = {
  lng: number
  lat: number
  groundElevationMeters: number
  travelBearing: number
  stationIndex: number
}

/** Position, ground height, and direction of travel at a distance along the corridor. */
function placementAt(stations: DriveStation[], distanceMeters: number): Placement | null {
  if (stations.length === 0) return null
  if (stations.length === 1) {
    const only = stations[0]
    return { ...only, travelBearing: 0, stationIndex: 0 }
  }

  const total = stations[stations.length - 1].distanceAlongMeters
  const clamped = Math.max(0, Math.min(total, distanceMeters))

  let index = 1
  while (index < stations.length - 1 && stations[index].distanceAlongMeters < clamped) index += 1
  const previous = stations[index - 1]
  const next = stations[index]
  const span = next.distanceAlongMeters - previous.distanceAlongMeters
  const fraction = span > 0 ? (clamped - previous.distanceAlongMeters) / span : 0

  return {
    lng: previous.lng + (next.lng - previous.lng) * fraction,
    lat: previous.lat + (next.lat - previous.lat) * fraction,
    groundElevationMeters:
      previous.groundElevationMeters + (next.groundElevationMeters - previous.groundElevationMeters) * fraction,
    travelBearing: bearingDegrees(previous, next),
    // The station whose precomputed visibility applies here.
    stationIndex: fraction < 0.5 ? index - 1 : index,
  }
}

/**
 * Drives the map camera along the corridor at eye height.
 *
 * The camera is placed from an explicit position, altitude, and rotation rather
 * than by framing a point at some zoom: standing on a road needs a real eye
 * height above the terrain, not a distance derived from zoom. Bearing and pitch
 * are worked out here and clamped before they are handed over, so a view that
 * wants to look further up a hillside than MapLibre allows still keeps the
 * camera exactly on the road.
 *
 * Playback runs from `requestAnimationFrame` and keeps its own position in a
 * ref, reporting back only a few times a second, so a frame of camera work
 * never costs a React render of the whole page.
 */
export function DriveCamera({
  active,
  playing,
  stations,
  seekMeters,
  seekVersion,
  speedMetersPerSecond,
  eyeHeightMeters,
  lookAt,
  spotBearing,
  onPosition,
  onReachEnd,
}: DriveCameraProps) {
  const { map, isLoaded } = useMap()
  const distanceRef = useRef(seekMeters)
  const propsRef = useRef({
    playing,
    stations,
    speedMetersPerSecond,
    eyeHeightMeters,
    lookAt,
    spotBearing,
    onPosition,
    onReachEnd,
  })
  // The animation frame reads the latest props without being torn down and
  // rebuilt on every render, which would restart playback each time.
  useEffect(() => {
    propsRef.current = {
      playing,
      stations,
      speedMetersPerSecond,
      eyeHeightMeters,
      lookAt,
      spotBearing,
      onPosition,
      onReachEnd,
    }
  })

  useEffect(() => {
    distanceRef.current = seekMeters
  }, [seekMeters, seekVersion])

  useEffect(() => {
    if (!active || !isLoaded || !map) return

    // Looking across a valley needs more pitch than the default 60° allows, and
    // the camera has to be free of the ground to sit at eye height above it.
    const previousMaxPitch = map.getMaxPitch()
    const previousClamped = map.getCenterClampedToGround()
    map.setMaxPitch(MAX_PITCH)
    map.setCenterClampedToGround(false)

    let frame = 0
    let lastFrameAt = performance.now()
    let lastReportAt = 0

    const render = (now: number) => {
      frame = requestAnimationFrame(render)
      const elapsedSeconds = Math.min(0.25, (now - lastFrameAt) / 1000)
      lastFrameAt = now

      const current = propsRef.current
      const total = current.stations.length > 0 ? current.stations[current.stations.length - 1].distanceAlongMeters : 0

      if (current.playing && total > 0) {
        distanceRef.current += current.speedMetersPerSecond * elapsedSeconds
        if (distanceRef.current >= total) {
          distanceRef.current = total
          current.onReachEnd?.()
        }
      }

      const placement = placementAt(current.stations, distanceRef.current)
      if (!placement) return

      // Prefer the elevation MapLibre is actually rendering, so the camera sits
      // on the terrain the viewer sees rather than slightly through it. It
      // answers NaN as well as null while terrain tiles are still arriving, and
      // a NaN altitude reaches MapLibre's matrix maths as a broken camera.
      const renderedElevation = map.queryTerrainElevation([placement.lng, placement.lat])
      const groundElevation = Number.isFinite(renderedElevation)
        ? (renderedElevation as number)
        : Number.isFinite(placement.groundElevationMeters)
          ? placement.groundElevationMeters
          : 0
      const eyeElevation = groundElevation + current.eyeHeightMeters

      let bearing = current.lookAt
        ? bearingDegrees(placement, current.lookAt)
        : current.stations.length > 1
          ? placement.travelBearing
          : current.spotBearing
      let pitch = MAX_PITCH

      if (current.lookAt) {
        const groundDistance = haversineMeters(placement, current.lookAt)
        if (groundDistance > 1) {
          const riseAngle = (Math.atan2(current.lookAt.elevationMeters - eyeElevation, groundDistance) * 180) / Math.PI
          pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, 90 + riseAngle))
        }
      }
      if (!Number.isFinite(bearing)) bearing = 0

      // Roll has to be passed: MapLibre copies the argument through as
      // `roll: undefined`, and `jumpTo` treats the key as present and
      // normalises it to NaN, which leaves the transform's projection matrices
      // null for every later frame.
      const camera = map.calculateCameraOptionsFromCameraLngLatAltRotation(
        { lng: placement.lng, lat: placement.lat },
        eyeElevation,
        bearing,
        pitch,
        0,
      )
      // A non-finite zoom or elevation would corrupt the transform the same way.
      if (!Number.isFinite(camera.zoom) || !Number.isFinite(camera.elevation ?? 0)) return
      map.jumpTo(camera)

      if (now - lastReportAt > 120) {
        lastReportAt = now
        current.onPosition({
          distanceMeters: distanceRef.current,
          stationIndex: placement.stationIndex,
        })
      }
    }

    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame)
      map.setMaxPitch(previousMaxPitch)
      map.setCenterClampedToGround(previousClamped)
    }
  }, [active, isLoaded, map])

  return null
}
