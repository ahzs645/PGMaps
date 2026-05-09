import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

export interface TimelineWindowOption {
  value: number
  label: string
}

export interface TimelineWindowMode {
  size: number
  onSizeChange: (size: number) => void
  options?: TimelineWindowOption[]
  anchor?: 'start' | 'end'
}

interface TimelineProps {
  startDate: Date
  endDate: Date
  currentDate: Date
  onDateChange: (date: Date) => void
  onClose?: () => void
  monthCounts?: Map<string, number>
  windowMode?: TimelineWindowMode
  statsLabel?: string
}

const SPEED_OPTIONS = [
  { value: 2000, label: '0.5x' },
  { value: 1000, label: '1x' },
  { value: 500, label: '2x' },
  { value: 250, label: '4x' },
]

const DEFAULT_WINDOW_OPTIONS: TimelineWindowOption[] = [
  { value: 1, label: '1 mo' },
  { value: 3, label: '3 mo' },
  { value: 6, label: '6 mo' },
  { value: -1, label: 'Cumul.' },
]

// When the timeline has more buckets than this, the visible bars virtualize
// and the view shifts as the scrub crosses the threshold.
const MAX_VISIBLE_MONTHS = 84
const VIEW_SHIFT_TRIGGER = 0.8
const VIEW_SHIFT_TARGET = 0.3

function snapToMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function buildMonthBuckets(startDate: Date, endDate: Date) {
  const buckets: { key: string; label: string; shortLabel: string; start: Date; end: Date }[] = []
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const startYear = startDate.getFullYear()
  const startMonth = startDate.getMonth()
  const endYear = endDate.getFullYear()
  const endMonth = endDate.getMonth()

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
      })
    }
  }

  return buckets
}

export function Timeline({
  startDate,
  endDate,
  currentDate,
  onDateChange,
  onClose,
  monthCounts,
  windowMode,
  statsLabel,
}: TimelineProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1000)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const buckets = useMemo(() => buildMonthBuckets(startDate, endDate), [startDate, endDate])

  const isCumulative = windowMode?.size === -1
  const windowSize = windowMode && !isCumulative ? windowMode.size : 1
  const windowAnchor = windowMode?.anchor ?? 'start'

  const currentIndex = useMemo(() => {
    const currentKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth()).padStart(2, '0')}`
    const idx = buckets.findIndex((b) => b.key === currentKey)
    return idx >= 0 ? idx : 0
  }, [buckets, currentDate])

  const maxPosition = useMemo(() => {
    if (!windowMode || isCumulative || windowAnchor === 'end') {
      return Math.max(0, buckets.length - 1)
    }
    return Math.max(0, buckets.length - windowSize)
  }, [buckets.length, windowMode, isCumulative, windowAnchor, windowSize])

  useEffect(() => {
    if (currentIndex > maxPosition && buckets[maxPosition]) {
      onDateChange(buckets[maxPosition].start)
    }
  }, [maxPosition, currentIndex, onDateChange, buckets])

  const isVirtualized = buckets.length > MAX_VISIBLE_MONTHS
  const visibleSize = isVirtualized ? MAX_VISIBLE_MONTHS : buckets.length
  const [visibleStart, setVisibleStart] = useState(0)

  useEffect(() => {
    if (!isVirtualized) {
      if (visibleStart !== 0) setVisibleStart(0)
      return
    }
    const maxStart = Math.max(0, buckets.length - visibleSize)
    const positionInView = currentIndex - visibleStart
    let nextStart: number | null = null
    if (positionInView > visibleSize * VIEW_SHIFT_TRIGGER) {
      nextStart = currentIndex - Math.floor(visibleSize * VIEW_SHIFT_TARGET)
    } else if (positionInView < visibleSize * (1 - VIEW_SHIFT_TRIGGER)) {
      nextStart = currentIndex - Math.floor(visibleSize * (1 - VIEW_SHIFT_TARGET))
    }
    if (nextStart === null) return
    nextStart = Math.max(0, Math.min(maxStart, nextStart))
    if (nextStart !== visibleStart) setVisibleStart(nextStart)
  }, [currentIndex, isVirtualized, visibleSize, buckets.length, visibleStart])

  const visibleBuckets = useMemo(() => {
    if (!isVirtualized) return buckets
    return buckets.slice(visibleStart, visibleStart + visibleSize)
  }, [buckets, isVirtualized, visibleStart, visibleSize])

  const visibleOffset = isVirtualized ? visibleStart : 0

  const maxCount = useMemo(() => {
    if (!monthCounts) return 1
    let max = 1
    for (const v of monthCounts.values()) {
      if (v > max) max = v
    }
    return max
  }, [monthCounts])

  const formattedDate = useMemo(() => {
    if (!windowMode) {
      return currentDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    }
    if (isCumulative) {
      return `Through ${buckets[currentIndex]?.label ?? ''}`
    }
    if (windowSize === 1) {
      return buckets[currentIndex]?.label ?? ''
    }
    if (windowAnchor === 'end') {
      const startIdx = Math.max(0, currentIndex - windowSize + 1)
      if (startIdx === currentIndex) return buckets[currentIndex]?.label ?? ''
      return `${buckets[startIdx]?.label ?? ''} – ${buckets[currentIndex]?.label ?? ''}`
    }
    const endIdx = Math.min(currentIndex + windowSize - 1, buckets.length - 1)
    if (endIdx === currentIndex) return buckets[currentIndex]?.label ?? ''
    return `${buckets[currentIndex]?.label ?? ''} – ${buckets[endIdx]?.label ?? ''}`
  }, [currentDate, windowMode, isCumulative, windowSize, windowAnchor, buckets, currentIndex])

  const stepForward = useCallback(() => {
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() + 1)
    newDate.setDate(1)
    if (newDate <= endDate && currentIndex < maxPosition) {
      onDateChange(newDate)
    } else {
      setIsPlaying(false)
    }
  }, [currentDate, endDate, onDateChange, currentIndex, maxPosition])

  const stepBackward = useCallback(() => {
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() - 1)
    newDate.setDate(1)
    if (newDate >= startDate) {
      onDateChange(newDate)
    }
  }, [currentDate, startDate, onDateChange])

  const reset = useCallback(() => {
    onDateChange(snapToMonth(startDate))
    setIsPlaying(false)
  }, [startDate, onDateChange])

  const handleSliderChange = useCallback(
    ([idx]: number[]) => {
      if (buckets[idx]) {
        onDateChange(buckets[idx].start)
      }
      setIsPlaying(false)
    },
    [buckets, onDateChange]
  )

  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }

    intervalRef.current = setInterval(stepForward, speed)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPlaying, speed, stepForward])

  const isInWindow = useCallback(
    (i: number) => {
      if (!windowMode) return i === currentIndex
      if (isCumulative) return i <= currentIndex
      if (windowAnchor === 'end') {
        return i > currentIndex - windowSize && i <= currentIndex
      }
      return i >= currentIndex && i < currentIndex + windowSize
    },
    [windowMode, isCumulative, windowAnchor, windowSize, currentIndex]
  )

  if (buckets.length === 0) return null

  const windowOptions = windowMode?.options ?? DEFAULT_WINDOW_OPTIONS

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur">
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-foreground">{formattedDate}</div>
            {statsLabel && (
              <div className="text-xs text-muted-foreground">{statsLabel}</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {windowMode && (
              <div className="flex items-center gap-1 rounded-md border border-input p-0.5">
                {windowOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => windowMode.onSizeChange(opt.value)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                      windowMode.size === opt.value
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

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

            {onClose && (
              <button
                onClick={onClose}
                className="rounded border border-input px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {monthCounts ? (
          <div className="mb-1 flex h-10 items-end gap-px">
            {visibleBuckets.map((bucket, i) => {
              const count = monthCounts.get(bucket.key) ?? 0
              const height = Math.max(2, (count / maxCount) * 100)
              const inWindow = isInWindow(visibleOffset + i)
              return (
                <div
                  key={bucket.key}
                  className="flex-1 cursor-pointer transition-colors"
                  style={{
                    height: `${height}%`,
                    backgroundColor: inWindow ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
                    opacity: inWindow ? 1 : 0.2,
                    borderRadius: '1px 1px 0 0',
                    minWidth: '2px',
                  }}
                  title={`${bucket.label}: ${count}`}
                  onClick={() => {
                    onDateChange(bucket.start)
                    setIsPlaying(false)
                  }}
                />
              )
            })}
          </div>
        ) : (
          <div className="mb-1 flex h-4 items-end">
            {visibleBuckets.map((bucket, i) => {
              const inWindow = isInWindow(visibleOffset + i)
              const isJanuary = bucket.start.getMonth() === 0
              return (
                <div
                  key={bucket.key}
                  className="flex flex-1 cursor-pointer flex-col items-center"
                  onClick={() => {
                    onDateChange(bucket.start)
                    setIsPlaying(false)
                  }}
                >
                  {isJanuary && (
                    <span className="text-[9px] text-muted-foreground">{bucket.start.getFullYear()}</span>
                  )}
                  <div
                    className={cn(
                      'w-full transition-colors',
                      inWindow
                        ? 'h-3 bg-primary'
                        : isJanuary
                          ? 'h-2 bg-muted-foreground/30'
                          : 'h-1 bg-muted-foreground/15'
                    )}
                    style={{ borderRadius: '1px 1px 0 0', minWidth: '2px' }}
                  />
                </div>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Reset to start"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={stepBackward}
            disabled={currentIndex === 0}
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
            disabled={currentIndex >= maxPosition}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            aria-label="Next month"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>

          <Slider
            min={0}
            max={maxPosition}
            step={1}
            value={[Math.min(currentIndex, maxPosition)]}
            onValueChange={handleSliderChange}
            className="flex-1 py-2"
          />

          <div className="hidden text-[10px] text-muted-foreground sm:block">
            {buckets[currentIndex]?.shortLabel}
          </div>
        </div>
      </div>
    </div>
  )
}
