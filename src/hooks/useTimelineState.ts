import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

export interface TimelineState {
  timelineEnabled: boolean
  setTimelineEnabled: Dispatch<SetStateAction<boolean>>
  /** null means "no explicit scrub yet"; sections derive a default from their data range. */
  timelineDate: Date | null
  setTimelineDate: Dispatch<SetStateAction<Date | null>>
  /** Window length in the section's own units (months, years). -1 means cumulative. */
  timelineWindowSize: number
  setTimelineWindowSize: Dispatch<SetStateAction<number>>
  /** Close the timeline and forget the scrub position, so reopening starts from the default. */
  disableTimeline: () => void
}

/**
 * The enabled / scrub-date / window-size triple every timeline-bearing section
 * used to declare as three separate useState calls plus its own disable handler.
 * Property names match what those sections already used, so destructuring this
 * is a drop-in replacement.
 */
export function useTimelineState(initialWindowSize = 1): TimelineState {
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(initialWindowSize)

  const disableTimeline = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  return useMemo(
    () => ({
      timelineEnabled,
      setTimelineEnabled,
      timelineDate,
      setTimelineDate,
      timelineWindowSize,
      setTimelineWindowSize,
      disableTimeline,
    }),
    [timelineEnabled, timelineDate, timelineWindowSize, disableTimeline],
  )
}
