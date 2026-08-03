import { useEffect, useMemo, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import type { ScalePosition } from './types'
import { DEFAULT_LOCALE } from '@/lib/format'

interface ScaleProps {
  className?: string
  position?: ScalePosition
  leftDistanceLabel?: string
  rightDistanceLabel?: string
  sources?: string[]
}

const MAX_SCALE_WIDTH = 148
const METERS_PER_FOOT = 0.3048
const METERS_PER_MILE = 1609.344
const NICE_STEPS = [1, 2, 5]

const positionClasses: Record<ScalePosition, string> = {
  'top-left': 'left-3 top-3 items-start',
  'top-center': 'left-1/2 top-3 -translate-x-1/2 items-center',
  'top-right': 'right-3 top-3 items-end',
  'bottom-left': 'bottom-3 left-3 items-start',
  'bottom-center': 'bottom-3 left-1/2 -translate-x-1/2 items-center',
  'bottom-right': 'bottom-3 right-3 items-end',
}

function haversineMeters(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const radius = 6371008.8
  const toRadians = (value: number) => value * Math.PI / 180
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const deltaLat = toRadians(b.lat - a.lat)
  const deltaLng = toRadians(b.lng - a.lng)
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function niceDistance(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (let index = NICE_STEPS.length - 1; index >= 0; index -= 1) {
    const candidate = NICE_STEPS[index] * magnitude
    if (candidate <= value) return candidate
  }
  return magnitude / 2
}

function formatScaleDistance(meters: number) {
  const miles = meters / METERS_PER_MILE
  if (miles >= 1) {
    return `${niceDistance(miles).toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 0 })}mi`
  }

  const feet = meters / METERS_PER_FOOT
  return `${niceDistance(feet).toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 0 })}ft`
}

function scaleDistanceMetersFromLabel(label: string) {
  const value = Number.parseFloat(label.replace(/,/g, ''))
  if (!Number.isFinite(value)) return 0
  return label.endsWith('mi') ? value * METERS_PER_MILE : value * METERS_PER_FOOT
}

export function Scale({
  className,
  position = 'bottom-center',
  leftDistanceLabel,
  rightDistanceLabel,
  sources = ['City of Oakland'],
}: ScaleProps) {
  const { map, isLoaded } = useMap()
  const [zoom, setZoom] = useState(() => map?.getZoom() ?? 0)
  const [scale, setScale] = useState({ label: leftDistanceLabel ?? '50mi', width: MAX_SCALE_WIDTH })

  useEffect(() => {
    if (!map) return
    const updateScale = () => {
      setZoom(map.getZoom())

      if (leftDistanceLabel) {
        setScale({ label: leftDistanceLabel, width: MAX_SCALE_WIDTH })
        return
      }

      const canvas = map.getCanvas()
      const centerY = canvas.clientHeight / 2
      const start = map.unproject([0, centerY])
      const end = map.unproject([MAX_SCALE_WIDTH, centerY])
      const maxMeters = haversineMeters(start, end)
      const label = formatScaleDistance(maxMeters)
      const distanceMeters = scaleDistanceMetersFromLabel(label)
      setScale({
        label,
        width: Math.max(48, Math.min(MAX_SCALE_WIDTH, Math.round(MAX_SCALE_WIDTH * distanceMeters / maxMeters))),
      })
    }

    updateScale()
    map.on('zoom', updateScale)
    map.on('move', updateScale)
    map.on('resize', updateScale)
    return () => {
      map.off('zoom', updateScale)
      map.off('move', updateScale)
      map.off('resize', updateScale)
    }
  }, [leftDistanceLabel, map])

  const zoomLabel = useMemo(() => `${zoom.toFixed(1)}z`, [zoom])

  if (!isLoaded) return null

  return (
    <div
      className={cn(
        'pointer-events-none absolute z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-2',
        positionClasses[position],
        className,
      )}
      aria-label="Map scale and attribution"
    >
      <div className="relative h-7 text-xs font-medium text-slate-950" style={{ width: MAX_SCALE_WIDTH }}>
        <button
          type="button"
          tabIndex={-1}
          className="absolute top-1 h-5 -translate-x-full rounded-sm bg-white/80 px-1 text-left text-xs font-medium leading-5 shadow-sm backdrop-blur"
          style={{ left: `calc(${scale.width / 2}px - 4px)` }}
          data-status="idle"
          data-tint="paneBg"
        >
          {zoomLabel}
        </button>

        <div className="absolute left-0 top-[19px] h-px bg-slate-950/90" style={{ width: scale.width }} />
        <div className="absolute left-0 top-[14px] h-2.5 w-px bg-slate-950/90" />
        <div className="absolute top-[14px] h-2.5 w-px bg-slate-950/90" style={{ left: scale.width }} />

        <div className="absolute top-1 rounded-sm bg-white/80 px-1 text-xs leading-5 shadow-sm backdrop-blur" style={{ left: `calc(${scale.width / 2}px + 4px)` }}>
          {scale.label}
        </div>
        {rightDistanceLabel && (
          <div className="absolute right-0 top-1 rounded-sm bg-white/80 px-1 text-xs leading-5 shadow-sm backdrop-blur">
            {rightDistanceLabel}
          </div>
        )}
      </div>

      <div className="max-w-[min(92vw,680px)] rounded-sm bg-white/80 px-1.5 py-0.5 text-center text-xs leading-4 text-slate-950 shadow-sm backdrop-blur">
        <a className="pointer-events-auto font-medium underline-offset-2 hover:underline" href="https://felt.com" title="Made with Felt." target="_blank" rel="noopener noreferrer">
          Made with Felt.
        </a>{' '}
        <span title="Data from">Data from</span>{' '}
        <a className="pointer-events-auto font-medium underline-offset-2 hover:underline" href="https://www.openstreetmap.org/copyright" title="OpenStreetMap" target="_blank" rel="noopener noreferrer">
          OpenStreetMap
        </a>
        {sources.map((source) => (
          <span key={source}>
            {' · '}
            <span title={source}>{source}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
