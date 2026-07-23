import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY } from '@/components/ui/mobile-feature-card'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { calculatePercentageChange, formatPercentChange, type PercentageChangeResult } from '@/lib/calculations'
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

export type TimelineGranularity = 'week' | 'month' | 'year' | 'decade'

export interface TimelinePercentChangeMode {
  enabled: boolean
  label?: string
  previousOffset?: number
}

interface TimelineProps {
  startDate: Date
  endDate: Date
  currentDate: Date
  onDateChange: (date: Date) => void
  onClose?: () => void
  bucketCounts?: Map<string, number>
  bucketValueFormatter?: (value: number) => string
  bucketValueLabel?: string
  windowMode?: TimelineWindowMode
  statsLabel?: string
  granularity?: TimelineGranularity
  compactBars?: boolean
  overflowBuckets?: boolean
  percentChangeMode?: TimelinePercentChangeMode
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

const COMPACT_BUCKET_WIDTH = 30
const BAR_BUCKET_WIDTH = 8

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Shorten a "Mon YYYY – Mon YYYY" range so it fits inline on narrow screens:
 * same year collapses to "Oct–Dec 2022", cross-year drops the spaces to
 * "Nov 2022–Jan 2023". Non-range labels pass through untouched.
 */
function toCompactRangeLabel(label: string): string {
  const match = label.match(/^(\w{3,}) (\d{4}) – (\w{3,}) (\d{4})$/)
  if (!match) return label
  const [, startMonth, startYear, endMonth, endYear] = match
  if (startYear === endYear) return `${startMonth}–${endMonth} ${endYear}`
  return `${startMonth} ${startYear}–${endMonth} ${endYear}`
}

interface Bucket {
  key: string
  label: string
  shortLabel: string
  start: Date
  end: Date
}

function snapToBucket(date: Date, granularity: TimelineGranularity): Date {
  if (granularity === 'decade') return new Date(Math.floor(date.getFullYear() / 10) * 10, 0, 1)
  if (granularity === 'year') return new Date(date.getFullYear(), 0, 1)
  if (granularity === 'week') {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    next.setDate(next.getDate() - next.getDay())
    return next
  }
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function bucketKeyFromDate(date: Date, granularity: TimelineGranularity): string {
  if (granularity === 'decade') return String(Math.floor(date.getFullYear() / 10) * 10)
  if (granularity === 'year') return String(date.getFullYear())
  if (granularity === 'week') return snapToBucket(date, 'week').toISOString().slice(0, 10)
  return `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`
}

function buildBuckets(startDate: Date, endDate: Date, granularity: TimelineGranularity): Bucket[] {
  const buckets: Bucket[] = []
  const startYear = startDate.getFullYear()
  const endYear = endDate.getFullYear()

  if (granularity === 'decade') {
    const firstDecade = Math.floor(startYear / 10) * 10
    const lastDecade = Math.floor(endYear / 10) * 10
    for (let y = firstDecade; y <= lastDecade; y += 10) {
      buckets.push({
        key: String(y),
        label: `${y}s`,
        shortLabel: `${y}s`,
        start: new Date(y, 0, 1),
        end: new Date(y + 9, 11, 31, 23, 59, 59, 999),
      })
    }
    return buckets
  }

  if (granularity === 'year') {
    for (let y = startYear; y <= endYear; y++) {
      buckets.push({
        key: String(y),
        label: String(y),
        shortLabel: String(y),
        start: new Date(y, 0, 1),
        end: new Date(y, 11, 31, 23, 59, 59, 999),
      })
    }
    return buckets
  }

  if (granularity === 'week') {
    const cursor = snapToBucket(startDate, 'week')
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
    while (cursor <= end) {
      const bucketStart = new Date(cursor)
      const bucketEnd = new Date(cursor)
      bucketEnd.setDate(bucketEnd.getDate() + 6)
      bucketEnd.setHours(23, 59, 59, 999)
      const label = bucketStart.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
      buckets.push({
        key: bucketStart.toISOString().slice(0, 10),
        label,
        shortLabel:
          bucketStart.getDate() <= 7
            ? `${MONTH_NAMES[bucketStart.getMonth()]} ${bucketStart.getFullYear()}`
            : String(bucketStart.getDate()),
        start: bucketStart,
        end: bucketEnd,
      })
      cursor.setDate(cursor.getDate() + 7)
    }
    return buckets
  }

  const startMonth = startDate.getMonth()
  const endMonth = endDate.getMonth()
  for (let y = startYear; y <= endYear; y++) {
    const mStart = y === startYear ? startMonth : 0
    const mEnd = y === endYear ? endMonth : 11
    for (let m = mStart; m <= mEnd; m++) {
      buckets.push({
        key: `${y}-${String(m).padStart(2, '0')}`,
        label: `${MONTH_NAMES[m]} ${y}`,
        shortLabel: m === 0 ? String(y) : MONTH_NAMES[m],
        start: new Date(y, m, 1),
        end: new Date(y, m + 1, 0, 23, 59, 59, 999),
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
  bucketCounts,
  bucketValueFormatter,
  bucketValueLabel = 'value',
  windowMode,
  statsLabel,
  granularity = 'month',
  compactBars = false,
  overflowBuckets = false,
  percentChangeMode,
}: TimelineProps) {
  const isMobile = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1000)
  const [barViewportWidth, setBarViewportWidth] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const barViewportRef = useRef<HTMLDivElement>(null)

  const buckets = useMemo(() => buildBuckets(startDate, endDate, granularity), [startDate, endDate, granularity])

  const isCumulative = windowMode?.size === -1
  const windowSize = windowMode && !isCumulative ? windowMode.size : 1
  const windowAnchor = windowMode?.anchor ?? 'start'
  const unitLabel =
    granularity === 'decade' ? 'decade' : granularity === 'year' ? 'year' : granularity === 'week' ? 'week' : 'month'
  const shouldUseCompactBars = compactBars || granularity === 'week'
  const usesCompactStrip = !bucketCounts || shouldUseCompactBars
  const formatBucketValue = useCallback(
    (value: number) => bucketValueFormatter?.(value) ?? String(value),
    [bucketValueFormatter],
  )

  const currentIndex = useMemo(() => {
    const currentKey = bucketKeyFromDate(currentDate, granularity)
    const idx = buckets.findIndex((b) => b.key === currentKey)
    return idx >= 0 ? idx : 0
  }, [buckets, currentDate, granularity])

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

  const bucketWidth = usesCompactStrip ? COMPACT_BUCKET_WIDTH : BAR_BUCKET_WIDTH
  const barStripWidth = Math.max(barViewportWidth, buckets.length * bucketWidth)
  const barScrollMax = Math.max(0, barStripWidth - barViewportWidth)
  const barScrollLeft =
    overflowBuckets && barViewportWidth > 0
      ? Math.max(0, Math.min(barScrollMax, currentIndex * bucketWidth + bucketWidth / 2 - barViewportWidth / 2))
      : 0
  const showPercentChange = Boolean(percentChangeMode?.enabled && bucketCounts)
  const percentChangeOffset = Math.max(1, Math.floor(percentChangeMode?.previousOffset ?? 1))

  const maxCount = useMemo(() => {
    if (!bucketCounts) return 1
    let max = 1
    for (const v of bucketCounts.values()) {
      if (v > max) max = v
    }
    return max
  }, [bucketCounts])

  const percentChanges = useMemo(() => {
    if (!showPercentChange || !bucketCounts) return new Map<string, PercentageChangeResult>()

    return new Map(
      buckets.map((bucket, index) => {
        const previousBucket = buckets[index - percentChangeOffset]
        const change = calculatePercentageChange(
          previousBucket ? (bucketCounts.get(previousBucket.key) ?? 0) : null,
          bucketCounts.get(bucket.key) ?? 0,
        )

        return [bucket.key, change]
      }),
    )
  }, [bucketCounts, buckets, percentChangeOffset, showPercentChange])

  const currentPercentChange = showPercentChange ? (percentChanges.get(buckets[currentIndex]?.key ?? '') ?? null) : null
  const currentPercentChangeLabel = currentPercentChange
    ? `${percentChangeMode?.label ?? 'Change'} ${formatPercentChange(currentPercentChange.percentChange)}`
    : null

  const formattedDate = useMemo(() => {
    if (!windowMode) {
      return buckets[currentIndex]?.label ?? ''
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
  }, [windowMode, isCumulative, windowSize, windowAnchor, buckets, currentIndex])

  const stepForward = useCallback(() => {
    const newDate = new Date(currentDate)
    if (granularity === 'decade') {
      newDate.setFullYear(newDate.getFullYear() + 10)
      newDate.setMonth(0)
    } else if (granularity === 'year') {
      newDate.setFullYear(newDate.getFullYear() + 1)
      newDate.setMonth(0)
    } else if (granularity === 'week') {
      newDate.setDate(newDate.getDate() + 7)
    } else {
      newDate.setMonth(newDate.getMonth() + 1)
    }
    if (granularity !== 'week') newDate.setDate(1)
    if (newDate <= endDate && currentIndex < maxPosition) {
      onDateChange(newDate)
    } else {
      setIsPlaying(false)
    }
  }, [currentDate, endDate, onDateChange, currentIndex, maxPosition, granularity])

  const stepBackward = useCallback(() => {
    const newDate = new Date(currentDate)
    if (granularity === 'decade') {
      newDate.setFullYear(newDate.getFullYear() - 10)
      newDate.setMonth(0)
    } else if (granularity === 'year') {
      newDate.setFullYear(newDate.getFullYear() - 1)
      newDate.setMonth(0)
    } else if (granularity === 'week') {
      newDate.setDate(newDate.getDate() - 7)
    } else {
      newDate.setMonth(newDate.getMonth() - 1)
    }
    if (granularity !== 'week') newDate.setDate(1)
    if (newDate >= startDate) {
      onDateChange(newDate)
    }
  }, [currentDate, startDate, onDateChange, granularity])

  const reset = useCallback(() => {
    onDateChange(snapToBucket(startDate, granularity))
    setIsPlaying(false)
  }, [startDate, onDateChange, granularity])

  const jumpToEnd = useCallback(() => {
    const endBucket = buckets[maxPosition]
    if (endBucket) {
      onDateChange(endBucket.start)
      setIsPlaying(false)
    }
  }, [buckets, maxPosition, onDateChange])

  const speedLabel = SPEED_OPTIONS.find((opt) => opt.value === speed)?.label ?? '1x'
  const cycleSpeed = useCallback(() => {
    setSpeed((current) => {
      const idx = SPEED_OPTIONS.findIndex((opt) => opt.value === current)
      return SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length].value
    })
  }, [])

  const windowOptions = windowMode?.options ?? DEFAULT_WINDOW_OPTIONS
  const windowLabel = windowOptions.find((opt) => opt.value === windowMode?.size)?.label ?? windowOptions[0]?.label
  const cycleWindow = () => {
    if (!windowMode) return
    const idx = windowOptions.findIndex((opt) => opt.value === windowMode.size)
    windowMode.onSizeChange(windowOptions[(idx + 1) % windowOptions.length].value)
  }

  const scrubbingRef = useRef(false)
  const scrubToClientX = useCallback(
    (clientX: number) => {
      const viewport = barViewportRef.current
      if (!viewport || buckets.length === 0) return
      const rect = viewport.getBoundingClientRect()
      const perBucket = overflowBuckets && barViewportWidth > 0 ? bucketWidth : rect.width / buckets.length
      const idx = Math.max(0, Math.min(maxPosition, Math.floor((clientX - rect.left + barScrollLeft) / perBucket)))
      if (buckets[idx] && idx !== currentIndex) {
        onDateChange(buckets[idx].start)
        setIsPlaying(false)
      }
    },
    [buckets, overflowBuckets, barViewportWidth, bucketWidth, barScrollLeft, currentIndex, maxPosition, onDateChange],
  )

  const handleSliderChange = useCallback(
    ([idx]: number[]) => {
      if (buckets[idx]) {
        onDateChange(buckets[idx].start)
      }
      setIsPlaying(false)
    },
    [buckets, onDateChange],
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
    [windowMode, isCumulative, windowAnchor, windowSize, currentIndex],
  )

  useLayoutEffect(() => {
    const timeline = timelineRef.current
    const container = timeline?.closest<HTMLElement>('[data-map-layout-root="true"]') ?? timeline?.parentElement
    if (!timeline || !container) return

    const syncTimelineHeight = () => {
      container.style.setProperty('--map-timeline-height', `${timeline.getBoundingClientRect().height}px`)
    }

    syncTimelineHeight()
    const observer = new ResizeObserver(syncTimelineHeight)
    observer.observe(timeline)
    window.addEventListener('resize', syncTimelineHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncTimelineHeight)
      container.style.removeProperty('--map-timeline-height')
    }
  }, [])

  useLayoutEffect(() => {
    const viewport = barViewportRef.current
    if (!viewport) return

    const syncViewportWidth = () => {
      setBarViewportWidth(viewport.getBoundingClientRect().width)
    }

    syncViewportWidth()
    const observer = new ResizeObserver(syncViewportWidth)
    observer.observe(viewport)
    window.addEventListener('resize', syncViewportWidth)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncViewportWidth)
    }
  }, [])

  if (buckets.length === 0) return null

  const barStripStyle = {
    width: overflowBuckets && barStripWidth > 0 ? `${barStripWidth}px` : '100%',
    transform: `translateX(-${barScrollLeft}px)`,
  } satisfies CSSProperties
  const controlButtonClass =
    'flex size-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 sm:size-8'
  const mobileControlButtonClass =
    'flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30'

  return (
    <div
      ref={timelineRef}
      data-map-timeline="true"
      className="absolute inset-x-2 z-20 sm:inset-x-3 md:inset-x-6"
      style={
        {
          bottom: 'calc(var(--map-mobile-sheet-visible-height, 0px) + var(--map-safe-bottom-offset, 0px) + 0.5rem)',
        } as CSSProperties
      }
    >
      <div className="rounded-lg border border-border/60 bg-background/95 p-2.5 shadow-xl backdrop-blur-sm sm:rounded-xl sm:p-3 md:p-4">
        {isMobile ? (
          <div className="mb-2 flex items-center gap-1.5">
            <button
              onClick={() => setIsPlaying((p) => !p)}
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors',
                isPlaying
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
            <button
              onClick={stepBackward}
              disabled={currentIndex === 0}
              className={mobileControlButtonClass}
              aria-label={`Previous ${unitLabel}`}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={stepForward}
              disabled={currentIndex >= maxPosition}
              className={mobileControlButtonClass}
              aria-label={`Next ${unitLabel}`}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1 rounded-md border border-primary/50 bg-primary/10 px-1.5 py-2 text-xs font-semibold text-primary">
              <span className="block truncate text-center">{toCompactRangeLabel(formattedDate)}</span>
            </div>
            {windowMode && (
              <button
                onClick={cycleWindow}
                className="flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-border/60 px-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={`Time window ${windowLabel}, tap to change`}
              >
                {windowLabel}
              </button>
            )}
            <button
              onClick={cycleSpeed}
              className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md border border-border/60 px-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={`Playback speed ${speedLabel}, tap to change`}
            >
              {speedLabel}
            </button>
            {onClose && (
              <button onClick={onClose} className={mobileControlButtonClass} aria-label="Close timeline">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="mb-3 flex flex-col gap-2 sm:mb-3 sm:gap-2 lg:flex-row lg:items-center lg:gap-3">
            <div className="flex min-w-0 items-center gap-1.5 lg:flex-wrap lg:gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={reset}
                  className={controlButtonClass}
                  aria-label="Reset to start"
                  title="Reset to start"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={stepBackward}
                  disabled={currentIndex === 0}
                  className={controlButtonClass}
                  aria-label={`Previous ${unitLabel}`}
                  title={`Previous ${unitLabel}`}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setIsPlaying((p) => !p)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full border transition-colors',
                    isPlaying
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                    'size-9 sm:size-9',
                  )}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                </button>
                <button
                  onClick={stepForward}
                  disabled={currentIndex >= maxPosition}
                  className={controlButtonClass}
                  aria-label={`Next ${unitLabel}`}
                  title={`Next ${unitLabel}`}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={jumpToEnd}
                  disabled={currentIndex >= maxPosition}
                  className={controlButtonClass}
                  aria-label="Jump to end"
                  title="Jump to end"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="min-w-0 flex-1 rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary sm:text-sm lg:flex-none">
                <span className="block truncate">{formattedDate}</span>
              </div>

              {onClose && (
                <button
                  onClick={onClose}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:size-8"
                  aria-label="Close timeline"
                  title="Close timeline"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {(statsLabel || currentPercentChangeLabel) && (
                <div className="hidden text-xs text-muted-foreground sm:block">
                  {[statsLabel, currentPercentChangeLabel].filter(Boolean).join(' | ')}
                </div>
              )}
            </div>

            <div className="flex min-w-0 items-center gap-1.5 sm:flex-wrap sm:gap-2 lg:ml-auto lg:justify-end">
              {windowMode && (
                <div className="flex min-w-0 items-center gap-1 rounded-md border border-input p-0.5">
                  {windowOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => windowMode.onSizeChange(opt.value)}
                      className={cn(
                        'whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium transition-colors',
                        windowMode.size === opt.value
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1 rounded-md border border-input p-0.5">
                {SPEED_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSpeed(opt.value)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-xs font-medium transition-colors',
                      speed === opt.value
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!isMobile && bucketCounts && !shouldUseCompactBars ? (
          <div
            ref={barViewportRef}
            className={cn(
              'mb-1 hidden h-10 overflow-y-visible sm:block',
              overflowBuckets ? 'overflow-x-hidden' : 'overflow-visible',
            )}
          >
            <div
              className="flex h-full items-end gap-px transition-transform duration-200 ease-out"
              style={barStripStyle}
            >
              {buckets.map((bucket, i) => {
                const count = bucketCounts.get(bucket.key) ?? 0
                const height = Math.max(2, (count / maxCount) * 100)
                const inWindow = isInWindow(i)
                const change = percentChanges.get(bucket.key)
                const formattedCount = formatBucketValue(count)
                const title =
                  showPercentChange && change
                    ? `${bucket.label}: ${formattedCount} ${bucketValueLabel} (${formatPercentChange(change.percentChange)} from previous ${unitLabel})`
                    : `${bucket.label}: ${formattedCount} ${bucketValueLabel}`
                return (
                  <div
                    key={bucket.key}
                    className={cn('cursor-pointer transition-colors', overflowBuckets ? 'shrink-0' : 'flex-1')}
                    style={{
                      width: overflowBuckets ? `${bucketWidth}px` : undefined,
                      height: `${height}%`,
                      backgroundColor: inWindow ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
                      opacity: inWindow ? 1 : 0.2,
                      borderRadius: '1px 1px 0 0',
                      minWidth: '2px',
                    }}
                    title={title}
                    onClick={() => {
                      onDateChange(bucket.start)
                      setIsPlaying(false)
                    }}
                  />
                )
              })}
            </div>
          </div>
        ) : (
          <div
            ref={barViewportRef}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={maxPosition}
            aria-valuenow={Math.min(currentIndex, maxPosition)}
            aria-valuetext={formattedDate}
            aria-label="Timeline date"
            tabIndex={isMobile ? 0 : -1}
            onPointerDown={(event) => {
              scrubbingRef.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              scrubToClientX(event.clientX)
            }}
            onPointerMove={(event) => {
              if (scrubbingRef.current) scrubToClientX(event.clientX)
            }}
            onPointerUp={() => {
              scrubbingRef.current = false
            }}
            onPointerCancel={() => {
              scrubbingRef.current = false
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                stepBackward()
              } else if (event.key === 'ArrowRight') {
                event.preventDefault()
                stepForward()
              }
            }}
            className={cn(
              'touch-none overflow-y-visible',
              isMobile ? 'h-10' : 'mb-1 h-6',
              overflowBuckets ? 'overflow-x-hidden' : 'overflow-visible',
            )}
          >
            <div className="flex h-full items-end transition-transform duration-200 ease-out" style={barStripStyle}>
              {buckets.map((bucket, i) => {
                const inWindow = isInWindow(i)
                const isJanuary = bucket.start.getMonth() === 0
                const isPeriodStart = granularity === 'week' ? bucket.start.getDate() <= 7 : isJanuary
                const count = bucketCounts?.get(bucket.key) ?? 0
                const change = percentChanges.get(bucket.key)
                const formattedCount = formatBucketValue(count)
                const title = bucketCounts
                  ? showPercentChange && change
                    ? `${bucket.label}: ${formattedCount} ${bucketValueLabel} (${formatPercentChange(change.percentChange)} from previous ${unitLabel})`
                    : `${bucket.label}: ${formattedCount} ${bucketValueLabel}`
                  : undefined
                // On mobile, scale the bar by its bucket count so the strip reads
                // as a mini density histogram rather than a flat tick row.
                const mobileScaledHeight =
                  isMobile && bucketCounts ? Math.max(4, Math.round((count / maxCount) * 32)) : undefined
                return (
                  <div
                    key={bucket.key}
                    className={cn('flex cursor-pointer flex-col items-center', overflowBuckets ? 'shrink-0' : 'flex-1')}
                    style={{ width: overflowBuckets ? `${bucketWidth}px` : undefined }}
                    title={title}
                    onClick={() => {
                      onDateChange(bucket.start)
                      setIsPlaying(false)
                    }}
                  >
                    {isPeriodStart &&
                      (isMobile ? (
                        <span className="text-xs leading-none text-muted-foreground">
                          {granularity === 'week'
                            ? MONTH_NAMES[bucket.start.getMonth()]
                            : granularity === 'decade'
                              ? bucket.shortLabel
                              : bucket.start.getFullYear()}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {granularity === 'week' || granularity === 'decade'
                            ? bucket.shortLabel
                            : bucket.start.getFullYear()}
                        </span>
                      ))}
                    <div
                      className={cn(
                        'w-full transition-colors',
                        mobileScaledHeight != null
                          ? inWindow
                            ? 'bg-primary'
                            : 'bg-muted-foreground/40'
                          : inWindow
                            ? cn('bg-primary', isMobile ? 'h-6' : 'h-3')
                            : isPeriodStart
                              ? cn('bg-muted-foreground/30', isMobile ? 'h-4' : 'h-2')
                              : cn('bg-muted-foreground/15', isMobile ? 'h-2' : 'h-1'),
                      )}
                      style={{
                        borderRadius: '1px 1px 0 0',
                        minWidth: '2px',
                        ...(mobileScaledHeight != null
                          ? { height: `${mobileScaledHeight}px`, opacity: inWindow ? 1 : 0.6 }
                          : {}),
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!isMobile && (
          <div className="flex items-center gap-2">
            <Slider
              min={0}
              max={maxPosition}
              step={1}
              value={[Math.min(currentIndex, maxPosition)]}
              onValueChange={handleSliderChange}
              className="flex-1 py-2"
              aria-label="Timeline date"
            />

            <div className="hidden text-xs text-muted-foreground sm:block">{buckets[currentIndex]?.shortLabel}</div>
          </div>
        )}
      </div>
    </div>
  )
}
