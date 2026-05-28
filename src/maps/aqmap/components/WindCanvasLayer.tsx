import { useEffect, useMemo, useRef, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import { WIND_GRID_STEP, WIND_VECTORS } from '../lib/windData'

export type WindInteractionMode = 'live' | 'hide-while-moving'

type Particle = {
  lng: number
  lat: number
  age: number
  life: number
}

type WindSample = {
  u: number
  v: number
  speed: number
}

const PARTICLE_COUNT = 1400
const MAX_PARTICLE_AGE = 110
const VELOCITY_SCALE = 0.018

const SPEED_COLORS = [
  'rgba(80, 160, 255, 0.58)',
  'rgba(70, 220, 180, 0.66)',
  'rgba(250, 205, 85, 0.72)',
  'rgba(250, 120, 90, 0.78)',
  'rgba(230, 85, 190, 0.82)',
] as const

const LIGHT_BASEMAP_SPEED_COLORS = [
  'rgba(30, 105, 210, 0.68)',
  'rgba(0, 135, 120, 0.72)',
  'rgba(205, 145, 20, 0.78)',
  'rgba(220, 80, 40, 0.82)',
  'rgba(185, 45, 150, 0.86)',
] as const

function wrapLongitude(lng: number) {
  return ((lng % 360) + 360) % 360
}

function randomParticle(): Particle {
  return {
    lng: Math.random() * 360,
    lat: -68 + Math.random() * 136,
    age: Math.floor(Math.random() * MAX_PARTICLE_AGE),
    life: MAX_PARTICLE_AGE * (0.6 + Math.random() * 0.8),
  }
}

function colorForSpeed(speed: number, palette: readonly string[]) {
  if (speed < 4) return palette[0]
  if (speed < 8) return palette[1]
  if (speed < 13) return palette[2]
  if (speed < 19) return palette[3]
  return palette[4]
}

function buildWindSampler() {
  const index = new Map<string, { u: number; v: number }>()

  for (const row of WIND_VECTORS as unknown as ReadonlyArray<readonly number[]>) {
    const [lng, lat, u, v] = row
    index.set(`${lng}:${lat}`, { u: u as number, v: v as number })
  }

  return function sampleWind(lng: number, lat: number): WindSample | null {
    if (lat < -90 || lat > 90) return null

    const wrappedLng = wrapLongitude(lng)
    const lng0 = Math.floor(wrappedLng / WIND_GRID_STEP) * WIND_GRID_STEP
    const lng1 = (lng0 + WIND_GRID_STEP) % 360
    const lat0 = Math.floor(lat / WIND_GRID_STEP) * WIND_GRID_STEP
    const lat1 = Math.min(90, lat0 + WIND_GRID_STEP)

    const q11 = index.get(`${lng0}:${lat0}`)
    const q21 = index.get(`${lng1}:${lat0}`)
    const q12 = index.get(`${lng0}:${lat1}`)
    const q22 = index.get(`${lng1}:${lat1}`)

    if (!q11 || !q21 || !q12 || !q22) {
      const nearestLng = Math.round(wrappedLng / WIND_GRID_STEP) * WIND_GRID_STEP
      const nearestLat = Math.round(lat / WIND_GRID_STEP) * WIND_GRID_STEP
      const nearest = index.get(`${nearestLng % 360}:${nearestLat}`)
      if (!nearest) return null
      return {
        u: nearest.u,
        v: nearest.v,
        speed: Math.hypot(nearest.u, nearest.v),
      }
    }

    const tx = (wrappedLng - lng0) / WIND_GRID_STEP
    const ty = (lat - lat0) / Math.max(WIND_GRID_STEP, lat1 - lat0)
    const u =
      q11.u * (1 - tx) * (1 - ty) +
      q21.u * tx * (1 - ty) +
      q12.u * (1 - tx) * ty +
      q22.u * tx * ty
    const v =
      q11.v * (1 - tx) * (1 - ty) +
      q21.v * tx * (1 - ty) +
      q12.v * (1 - tx) * ty +
      q22.v * tx * ty

    return { u, v, speed: Math.hypot(u, v) }
  }
}

type WindCanvasLayerProps = {
  visible?: boolean
  interactionMode?: WindInteractionMode
  basemap?: 'light' | 'dark'
}

export function WindCanvasLayer({
  visible = true,
  interactionMode = 'live',
  basemap = 'dark',
}: WindCanvasLayerProps) {
  const { map, isLoaded } = useMap()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isMoving, setIsMoving] = useState(false)
  const sampler = useMemo(() => buildWindSampler(), [])

  useEffect(() => {
    if (!map || !isLoaded) return

    const handleMoveStart = () => setIsMoving(true)
    const handleMoveEnd = () => setIsMoving(false)

    map.on('movestart', handleMoveStart)
    map.on('moveend', handleMoveEnd)

    return () => {
      map.off('movestart', handleMoveStart)
      map.off('moveend', handleMoveEnd)
    }
  }, [map, isLoaded])

  useEffect(() => {
    if (!visible || !map || !isLoaded || !canvasRef.current) return

    const mapInstance = map
    const canvas = canvasRef.current
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) return
    const context = canvasContext
    const isLightBasemap = basemap === 'light'
    const speedColors = isLightBasemap ? LIGHT_BASEMAP_SPEED_COLORS : SPEED_COLORS

    let frame = 0
    let width = 0
    let height = 0
    const particles = Array.from({ length: PARTICLE_COUNT }, randomParticle)

    function resize() {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect.width * pixelRatio))
      height = Math.max(1, Math.floor(rect.height * pixelRatio))
      canvas.width = width
      canvas.height = height
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }

    function resetParticle(particle: Particle) {
      const next = randomParticle()
      particle.lng = next.lng
      particle.lat = next.lat
      particle.age = 0
      particle.life = next.life
    }

    function draw() {
      context.globalCompositeOperation = 'destination-in'
      context.fillStyle = 'rgba(0, 0, 0, 0.91)'
      context.fillRect(0, 0, width, height)
      context.globalCompositeOperation = isLightBasemap ? 'source-over' : 'lighter'
      context.lineWidth = isLightBasemap ? 1.35 : 1.15

      for (const particle of particles) {
        const wind = sampler(particle.lng, particle.lat)

        if (!wind || particle.age > particle.life || wind.speed < 0.4) {
          resetParticle(particle)
          continue
        }

        const start = mapInstance.project([
          particle.lng > 180 ? particle.lng - 360 : particle.lng,
          particle.lat,
        ])
        const nextLng = wrapLongitude(particle.lng + wind.u * VELOCITY_SCALE)
        const nextLat = Math.max(
          -78,
          Math.min(78, particle.lat + wind.v * VELOCITY_SCALE),
        )
        const end = mapInstance.project([
          nextLng > 180 ? nextLng - 360 : nextLng,
          nextLat,
        ])
        const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)

        if (
          segmentLength > 80 ||
          start.x < -50 ||
          start.y < -50 ||
          start.x > canvas.clientWidth + 50 ||
          start.y > canvas.clientHeight + 50
        ) {
          resetParticle(particle)
          continue
        }

        context.strokeStyle = colorForSpeed(wind.speed, speedColors)
        context.beginPath()
        context.moveTo(start.x, start.y)
        context.lineTo(end.x, end.y)
        context.stroke()

        particle.lng = nextLng
        particle.lat = nextLat
        particle.age += 1
      }

      frame = requestAnimationFrame(draw)
    }

    resize()
    frame = requestAnimationFrame(draw)
    mapInstance.on('resize', resize)

    return () => {
      cancelAnimationFrame(frame)
      mapInstance.off('resize', resize)
    }
  }, [visible, map, isLoaded, sampler, basemap])

  if (!visible) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 z-[2] h-full w-full transition-opacity duration-150',
        basemap === 'dark' && 'mix-blend-screen',
        interactionMode === 'hide-while-moving' && isMoving
          ? 'opacity-0'
          : 'opacity-100',
      )}
    />
  )
}

export const WIND_LEGEND_COLORS = ['#50a0ff', '#46dcb4', '#facd55', '#fa785a', '#e655be']
