import { useMemo } from 'react'
import type { ExplorerDateRange } from './useExplorerFilters'

/**
 * Parse the timeline date-range strings into epoch-millisecond bounds used by
 * the temporal item filters. `dateTo` is extended to the end of its day.
 */
export function useExplorerTimeline(dateRange: ExplorerDateRange) {
  const dateFrom = useMemo(() => (dateRange.from ? new Date(dateRange.from).getTime() : null), [dateRange.from])
  const dateTo = useMemo(() => {
    if (!dateRange.to) return null
    const date = new Date(dateRange.to)
    date.setHours(23, 59, 59, 999)
    return date.getTime()
  }, [dateRange.to])

  return { dateFrom, dateTo }
}
