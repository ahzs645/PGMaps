import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

interface TimelineProps {
  startDate: Date
  endDate: Date
  currentDate: Date
  onDateChange: (date: Date) => void
  onClose?: () => void
}

const SPEED_OPTIONS = [
  { value: 2000, label: '0.5x' },
  { value: 1000, label: '1x' },
  { value: 500, label: '2x' },
  { value: 250, label: '4x' },
]

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

export function Timeline({ startDate, endDate, currentDate, onDateChange, onClose }: TimelineProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1000)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const buckets = useMemo(() => buildMonthBuckets(startDate, endDate), [startDate, endDate])

  const currentIndex = useMemo(() => {
    const currentKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth()).padStart(2, '0')}`
    const idx = buckets.findIndex((b) => b.key === currentKey)
    return idx >= 0 ? idx : 0
  }, [buckets, currentDate])

  const maxPosition = Math.max(0, buckets.length - 1)

  const formattedDate = useMemo(() => {
    return currentDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
    })
  }, [currentDate])

  const stepForward = useCallback(() => {
    const newDate = new Date(currentDate)
    newDate.setMonth(newDate.getMonth() + 1)
    newDate.setDate(1)
    if (newDate <= endDate) {
      onDateChange(newDate)
    } else {
      setIsPlaying(false)
    }
  }, [currentDate, endDate, onDateChange])

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

  // Auto-play
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

  if (buckets.length === 0) return null

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur">
      <div className="px-4 py-3">
        {/* Top row: label + controls */}
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-foreground">{formattedDate}</div>

          <div className="flex items-center gap-2">
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

        {/* Year tick marks */}
        <div className="mb-1 flex h-4 items-end">
          {buckets.map((bucket, i) => {
            const isCurrentMonth = i === currentIndex
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
                    isCurrentMonth ? 'h-3 bg-primary' : isJanuary ? 'h-2 bg-muted-foreground/30' : 'h-1 bg-muted-foreground/15'
                  )}
                  style={{ borderRadius: '1px 1px 0 0', minWidth: '2px' }}
                />
              </div>
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
            value={[currentIndex]}
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
