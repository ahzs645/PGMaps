import { useCallback, useMemo } from 'react'
import {
  buildTimelineBuckets,
  timelineBucketKey,
  type TimelineBucket,
  type TimelineGranularity,
  type TimelineWindowSize,
} from '@pgmaps/geo-toolkit/calculations/timeline'
import { MapTimeline, type MapTimelineWindow } from '@pgmaps/geo-toolkit/ui/map-timeline'

/**
 * PG Maps adapter for the toolkit's `MapTimeline`: pages keep passing dates and
 * a `-1` cumulative window, and the toolkit draws the timeline from bucket
 * indices. New pages can use `MapTimeline` directly.
 */

export type { TimelineGranularity }

export interface TimelineWindowOption {
  /** Buckets in the window; -1 means cumulative. */
  value: number
  label: string
}

export interface TimelineWindowMode {
  size: number
  onSizeChange: (size: number) => void
  options?: TimelineWindowOption[]
  anchor?: 'start' | 'end'
}

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
  /** Relabel buckets, e.g. fiscal years ("2024/25") on year buckets. */
  formatBucketLabel?: (bucket: TimelineBucket) => string
  /** @deprecated The track always fits every bucket; this has no effect. */
  compactBars?: boolean
  /** @deprecated The track always fits every bucket; this has no effect. */
  overflowBuckets?: boolean
  percentChangeMode?: TimelinePercentChangeMode
  /** Room per axis label before the axis thins out. */
  minLabelPx?: number
}

const DEFAULT_WINDOW_OPTIONS: TimelineWindowOption[] = [
  { value: 1, label: '1 mo' },
  { value: 3, label: '3 mo' },
  { value: 6, label: '6 mo' },
  { value: -1, label: 'Cumul.' },
]

const toSize = (size: number): TimelineWindowSize => (size === -1 ? 'cumulative' : size)
const fromSize = (size: TimelineWindowSize): number => (size === 'cumulative' ? -1 : size)

export function Timeline({
  startDate,
  endDate,
  currentDate,
  onDateChange,
  onClose,
  bucketCounts,
  bucketValueFormatter,
  bucketValueLabel,
  windowMode,
  statsLabel,
  granularity = 'month',
  formatBucketLabel,
  percentChangeMode,
  minLabelPx,
}: TimelineProps) {
  // Pages often pass fresh Date objects every render; key on their times.
  const startTime = startDate.getTime()
  const endTime = endDate.getTime()
  const buckets = useMemo(
    () =>
      buildTimelineBuckets({
        start: new Date(startTime),
        end: new Date(endTime),
        granularity,
        formatLabel: formatBucketLabel,
      }),
    [startTime, endTime, granularity, formatBucketLabel],
  )

  const currentKey = timelineBucketKey(currentDate, granularity)
  const value = Math.max(
    0,
    buckets.findIndex((bucket) => bucket.key === currentKey),
  )

  const handleValueChange = useCallback(
    (index: number) => {
      const bucket = buckets[index]
      if (bucket) onDateChange(bucket.start)
    },
    [buckets, onDateChange],
  )

  const window = useMemo<MapTimelineWindow | undefined>(() => {
    if (!windowMode) return undefined
    return {
      size: toSize(windowMode.size),
      anchor: windowMode.anchor,
      options: (windowMode.options ?? DEFAULT_WINDOW_OPTIONS).map((option) => ({
        value: toSize(option.value),
        label: option.label,
      })),
      onSizeChange: (size) => windowMode.onSizeChange(fromSize(size)),
    }
  }, [windowMode])

  return (
    <MapTimeline
      buckets={buckets}
      value={value}
      onValueChange={handleValueChange}
      granularity={granularity}
      values={bucketCounts}
      formatValue={bucketValueFormatter}
      valueLabel={bucketValueLabel}
      window={window}
      change={
        percentChangeMode?.enabled
          ? { label: percentChangeMode.label, offset: percentChangeMode.previousOffset }
          : undefined
      }
      summary={statsLabel}
      onClose={onClose}
      minLabelPx={minLabelPx}
    />
  )
}
