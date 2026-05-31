import { useCallback, useMemo, useState } from 'react'
import { CANUE_V2_ENABLED, type CanueV2Family, type CanueVariableSelection } from './canueV2'
import { useCanueV2AggregatePrefetch } from './canueV2Aggregates'
import {
  getCanueV2MonthKey,
  getCanueV2SelectionDate,
  getCanueV2TimelineKey,
  type CanueBoundaryLevel,
  type CanueBoundarySource,
} from './canueCore'

interface UseCanueTimelineArgs {
  activeTab: string
  canueBoundaryLevel: CanueBoundaryLevel
  canueBoundarySource: CanueBoundarySource
  selectedCanueV2FamilyEntry: CanueV2Family | null
  selectedCanueV2MeasureSelections: CanueVariableSelection[]
  selectedCanueV2Selection: CanueVariableSelection | null
  setSelectedCanueV2Month: (month: string | null) => void
  setSelectedCanueV2Property: (property: string | null) => void
  setSelectedCanueV2Year: (year: number | null) => void
  showCanueBoundaries: boolean
}

export function useCanueTimeline({
  activeTab,
  canueBoundaryLevel,
  canueBoundarySource,
  selectedCanueV2FamilyEntry,
  selectedCanueV2MeasureSelections,
  selectedCanueV2Selection,
  setSelectedCanueV2Month,
  setSelectedCanueV2Property,
  setSelectedCanueV2Year,
  showCanueBoundaries,
}: UseCanueTimelineArgs) {
  const [canueTimelineEnabled, setCanueTimelineEnabled] = useState(false)
  const [canueTimelineWindowSize, setCanueTimelineWindowSize] = useState(1)
  const canueTimelineIsMonthly = selectedCanueV2MeasureSelections.some((selection) =>
    getCanueV2MonthKey(selection.variable),
  )
  const canueTimelineSelections = useMemo(() => {
    if (!selectedCanueV2MeasureSelections.length) return []
    return selectedCanueV2MeasureSelections
      .filter((selection) =>
        canueTimelineIsMonthly
          ? getCanueV2MonthKey(selection.variable)
          : getCanueV2MonthKey(selection.variable) == null,
      )
      .sort((left, right) => getCanueV2SelectionDate(left).getTime() - getCanueV2SelectionDate(right).getTime())
  }, [canueTimelineIsMonthly, selectedCanueV2MeasureSelections])
  const canueTimelineBucketKeys = useMemo(
    () => new Set(canueTimelineSelections.map((selection) => getCanueV2TimelineKey(selection, canueTimelineIsMonthly))),
    [canueTimelineIsMonthly, canueTimelineSelections],
  )
  const canueTimelineDateRange = useMemo(() => {
    const first = canueTimelineSelections[0]
    const last = canueTimelineSelections[canueTimelineSelections.length - 1]
    if (!first || !last) return null
    return {
      start: getCanueV2SelectionDate(first),
      end: getCanueV2SelectionDate(last),
    }
  }, [canueTimelineSelections])
  const canueTimelineDate = useMemo(() => {
    if (!selectedCanueV2Selection) return null
    return getCanueV2SelectionDate(selectedCanueV2Selection)
  }, [selectedCanueV2Selection])
  const canueTimelineBucketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const selection of canueTimelineSelections) {
      counts.set(
        getCanueV2TimelineKey(selection, canueTimelineIsMonthly),
        selection.count ??
          selectedCanueV2FamilyEntry?.layers.find((layer) => layer.year === selection.year)?.features ??
          1,
      )
    }
    return counts
  }, [canueTimelineIsMonthly, canueTimelineSelections, selectedCanueV2FamilyEntry?.layers])
  const canueTimelineAvailable =
    CANUE_V2_ENABLED && canueTimelineBucketKeys.size > 1 && selectedCanueV2Selection != null
  const canueTimelineActive = canueTimelineEnabled && canueTimelineAvailable
  const handleCanueTimelineDateChange = useCallback(
    (date: Date) => {
      const targetTime = date.getTime()
      const nextSelection =
        canueTimelineSelections.find((selection) => getCanueV2SelectionDate(selection).getTime() === targetTime) ??
        canueTimelineSelections.reduce<CanueVariableSelection | null>((closest, selection) => {
          if (!closest) return selection
          const currentDistance = Math.abs(getCanueV2SelectionDate(selection).getTime() - targetTime)
          const closestDistance = Math.abs(getCanueV2SelectionDate(closest).getTime() - targetTime)
          return currentDistance < closestDistance ? selection : closest
        }, null)
      if (!nextSelection) return
      setSelectedCanueV2Year(nextSelection.year)
      setSelectedCanueV2Month(getCanueV2MonthKey(nextSelection.variable))
      setSelectedCanueV2Property(nextSelection.property)
    },
    [canueTimelineSelections, setSelectedCanueV2Month, setSelectedCanueV2Property, setSelectedCanueV2Year],
  )
  const handleCanueTimelineDisable = useCallback(() => {
    setCanueTimelineEnabled(false)
  }, [])
  const canueTimelinePrefetch = useCanueV2AggregatePrefetch({
    source: canueBoundarySource,
    level: canueBoundaryLevel,
    selections: canueTimelineSelections,
    enabled: activeTab === 'canue' && showCanueBoundaries && canueTimelineActive,
  })

  return {
    canueTimelineEnabled,
    setCanueTimelineEnabled,
    canueTimelineWindowSize,
    setCanueTimelineWindowSize,
    canueTimelineIsMonthly,
    canueTimelineSelections,
    canueTimelineBucketKeys,
    canueTimelineDateRange,
    canueTimelineDate,
    canueTimelineBucketCounts,
    canueTimelineAvailable,
    canueTimelineActive,
    handleCanueTimelineDateChange,
    handleCanueTimelineDisable,
    canueTimelinePrefetch,
  }
}
