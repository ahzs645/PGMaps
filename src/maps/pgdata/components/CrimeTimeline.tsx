import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CrimeIncident } from '../types'

export interface TimelineRange {
  start: Date
  end: Date
}

interface CrimeTimelineProps {
  incidents: CrimeIncident[]
  onChange: (range: TimelineRange) => void
  onDisable: () => void
}

interface MonthBucket {
  key: string
  label: string
  shortLabel: string
  start: Date
  end: Date
  count: number
}

const WINDOW_OPTIONS = [
  { value: 1, label: '1 mo' },
  { value: 3, label: '3 mo' },
  { value: 6, label: '6 mo' },
  { value: -1, label: 'Cumul.' },
]

const SPEED_OPTIONS = [
  { value: 1500, label: '0.5x' },
  { value: 800, label: '1x' },
  { value: 400, label: '2x' },
]

function buildMonthBuckets(incidents: CrimeIncident[]): MonthBucket[] {
  if (incidents.length === 0) return []

  const dates = incidents.map((inc) => inc.date)
  const min = new Date(Math.min(...dates.map((d) => d.getTime())))
  const max = new Date(Math.max(...dates.map((d) => d.getTime())))

  const startYear = min.getFullYear()
  const startMonth = min.getMonth()
  const endYear = max.getFullYear()
  const endMonth = max.getMonth()

  const countByKey = new Map<string, number>()
  incidents.forEach((inc) => {
    const key = `${inc.date.getFullYear()}-${String(inc.date.getMonth()).padStart(2, '0')}`
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1)
  })

  const buckets: MonthBucket[] = []
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  for (let y = startYear; y <= endYear; y++) {
    const mStart = y === startYear ? startMonth : 0
    const mEnd = y === endYear ? endMonth : 11
    for (let m = mStart; m <= mEnd; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      const start = new Date(y, m, 1)
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999)
      buckets.push({
        key,
        label: `${monthNames[m]} ${y}`,
        shortLabel: m === 0 ? `${y}` : monthNames[m],
        start,
        end,
        count: countByKey.get(key) ?? 0,
      })
    }
  }

  return buckets
}

export function CrimeTimeline({ incidents, onChange, onDisable }: CrimeTimelineProps) {
  const [position, setPosition] = useState(0)
  const [windowSize, setWindowSize] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(800)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const buckets = useMemo(() => buildMonthBuckets(incidents), [incidents])
  const isCumulative = windowSize === -1
  const effectiveWindowSize = isCumulative ? position + 1 : windowSize
  const maxPosition = Math.max(0, isCumulative ? buckets.length - 1 : buckets.length - windowSize)
  const maxCount = useMemo(() => Math.max(1, ...buckets.map((b) => b.count)), [buckets])

  // Clamp position when window size changes
  useEffect(() => {
    setPosition((p) => Math.min(p, maxPosition))
  }, [maxPosition])

  // Emit range when position or window changes
  useEffect(() => {
    if (buckets.length === 0) return
    const startIdx = isCumulative ? 0 : Math.min(position, buckets.length - 1)
    const endIdx = Math.min(isCumulative ? position : position + windowSize - 1, buckets.length - 1)
    onChange({
      start: buckets[startIdx].start,
      end: buckets[endIdx].end,
    })
  }, [position, windowSize, isCumulative, buckets, onChange])

  // Auto-play
  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }

    intervalRef.current = setInterval(() => {
      setPosition((p) => {
        if (p >= maxPosition) {
          setIsPlaying(false)
          return p
        }
        return p + 1
      })
    }, speed)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPlaying, speed, maxPosition])

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    setPosition(val)
    setIsPlaying(false)
  }, [])

  const stepBack = useCallback(() => {
    setPosition((p) => Math.max(0, p - 1))
    setIsPlaying(false)
  }, [])

  const stepForward = useCallback(() => {
    setPosition((p) => Math.min(maxPosition, p + 1))
    setIsPlaying(false)
  }, [maxPosition])

  const reset = useCallback(() => {
    setPosition(0)
    setIsPlaying(false)
  }, [])

  if (buckets.length === 0) return null

  const startIdx = isCumulative ? 0 : Math.min(position, buckets.length - 1)
  const endIdx = Math.min(isCumulative ? position : position + effectiveWindowSize - 1, buckets.length - 1)
  const rangeLabel = isCumulative
    ? `Start - ${buckets[endIdx].label}`
    : effectiveWindowSize === 1
      ? buckets[startIdx].label
      : `${buckets[startIdx].label} - ${buckets[endIdx].label}`

  const windowCount = buckets
    .slice(startIdx, endIdx + 1)
    .reduce((sum, b) => sum + b.count, 0)

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur md:bottom-0">
      <div className="px-4 py-3">
        {/* Top row: label + controls */}
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-foreground">{rangeLabel}</div>
            <div className="text-xs text-muted-foreground">
              {windowCount.toLocaleString()} incidents
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Window size */}
            <div className="flex items-center gap-1 rounded-md border border-input p-0.5">
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setWindowSize(opt.value)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                    windowSize === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Speed */}
            <div className="hidden items-center gap-1 rounded-md border border-input p-0.5 sm:flex">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSpeed(opt.value)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                    speed === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Close */}
            <button
              onClick={onDisable}
              className="rounded border border-input px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Close
            </button>
          </div>
        </div>

        {/* Histogram */}
        <div className="mb-1 flex h-10 items-end gap-px">
          {buckets.map((bucket, i) => {
            const inWindow = isCumulative ? i <= position : (i >= startIdx && i <= endIdx)
            const height = Math.max(2, (bucket.count / maxCount) * 100)
            return (
              <div
                key={bucket.key}
                className="flex-1 cursor-pointer transition-colors"
                style={{
                  height: `${height}%`,
                  backgroundColor: inWindow
                    ? 'var(--color-primary)'
                    : 'var(--color-muted-foreground)',
                  opacity: inWindow ? 1 : 0.2,
                  borderRadius: '1px 1px 0 0',
                  minWidth: '2px',
                }}
                title={`${bucket.label}: ${bucket.count}`}
                onClick={() => {
                  setPosition(Math.min(i, maxPosition))
                  setIsPlaying(false)
                }}
              />
            )
          })}
        </div>

        {/* Slider + play controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Reset to start"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={stepBack}
            disabled={position === 0}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className={cn(
              'rounded p-1 transition-colors',
              isPlaying
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={stepForward}
            disabled={position >= maxPosition}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            aria-label="Next month"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>

          <input
            type="range"
            min={0}
            max={maxPosition}
            value={position}
            onChange={handleSliderChange}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />

          <div className="hidden text-[10px] text-muted-foreground sm:block">
            {buckets[startIdx].shortLabel}
            {windowSize > 1 && ` - ${buckets[endIdx].shortLabel}`}
          </div>
        </div>
      </div>
    </div>
  )
}
