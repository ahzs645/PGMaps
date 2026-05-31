import { useMemo, useState } from 'react'
import {
  getCanuePeriodLabel,
  getDefaultCanueVariable,
  getSelectableCanueVariables,
  type CanueDatasetGroup,
  type CanueManifest,
  type CanueYearMode,
} from './canueCore'

interface UseCanueV1SelectionArgs {
  manifest: CanueManifest | null
  searchParams: URLSearchParams
}

export function useCanueV1Selection({ manifest, searchParams }: UseCanueV1SelectionArgs) {
  const [requestedCanueDatasetId, setSelectedCanueDatasetId] = useState<string | null>(() =>
    searchParams.get('dataset'),
  )
  const [requestedCanueYear, setSelectedCanueYear] = useState<number | null>(() => {
    if (!searchParams.has('year')) return null
    const year = Number(searchParams.get('year'))
    return Number.isFinite(year) && year > 0 ? year : null
  })
  const [requestedCanueYearMode, setCanueYearMode] = useState<CanueYearMode>(
    () => (searchParams.get('years') as CanueYearMode) || 'single',
  )
  const [requestedCanueRangeStartYear, setCanueRangeStartYear] = useState<number | null>(null)
  const [requestedCanueRangeEndYear, setCanueRangeEndYear] = useState<number | null>(null)
  const [selectedCanueMonth, setSelectedCanueMonth] = useState<number>(() => {
    const month = Number(searchParams.get('month'))
    return Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1
  })
  const [requestedCanueVariable, setSelectedCanueVariable] = useState<string | null>(null)

  const canueFiles = useMemo(() => manifest?.files ?? [], [manifest?.files])
  const canueDatasetGroups = useMemo<CanueDatasetGroup[]>(() => {
    const groups = new Map<string, CanueDatasetGroup>()
    for (const file of canueFiles) {
      const group = groups.get(file.datasetId)
      if (group) {
        group.files.push(file)
        group.years.push(file.year)
      } else {
        groups.set(file.datasetId, {
          datasetId: file.datasetId,
          label: file.label,
          category: file.category,
          files: [file],
          years: [file.year],
        })
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        files: group.files.slice().sort((left, right) => left.year - right.year),
        years: Array.from(new Set(group.years)).sort((left, right) => left - right),
      }))
      .sort((left, right) => {
        if (left.datasetId === 'pm25dale_a') return -1
        if (right.datasetId === 'pm25dale_a') return 1
        return left.label.localeCompare(right.label)
      })
  }, [canueFiles])
  const selectedCanueDataset = useMemo(() => {
    if (!canueDatasetGroups.length) return null
    if (requestedCanueDatasetId) {
      const selected = canueDatasetGroups.find((dataset) => dataset.datasetId === requestedCanueDatasetId)
      if (selected) return selected
    }
    return canueDatasetGroups.find((dataset) => dataset.datasetId === 'pm25dale_a') ?? canueDatasetGroups[0]
  }, [canueDatasetGroups, requestedCanueDatasetId])
  const selectedCanueFile = useMemo(() => {
    if (!selectedCanueDataset) return null
    if (requestedCanueYear != null) {
      const selected = selectedCanueDataset.files.find((file) => file.year === requestedCanueYear)
      if (selected) return selected
    }
    return selectedCanueDataset.files[selectedCanueDataset.files.length - 1] ?? null
  }, [selectedCanueDataset, requestedCanueYear])
  const selectedCanueDatasetId = selectedCanueDataset?.datasetId ?? requestedCanueDatasetId
  const selectedCanueYear = selectedCanueFile?.year ?? requestedCanueYear
  const canueYearMode =
    selectedCanueFile?.cadence !== 'monthly' && requestedCanueYearMode === 'month'
      ? 'single'
      : selectedCanueDataset?.years.length != null &&
          selectedCanueDataset.years.length <= 1 &&
          requestedCanueYearMode !== 'single' &&
          requestedCanueYearMode !== 'month'
        ? 'single'
        : requestedCanueYearMode
  const canueRangeStartYear = requestedCanueRangeStartYear ?? selectedCanueDataset?.years[0] ?? null
  const canueRangeEndYear =
    requestedCanueRangeEndYear ?? selectedCanueDataset?.years[selectedCanueDataset.years.length - 1] ?? null
  const selectedCanueVariable = useMemo(() => {
    if (!selectedCanueFile) return requestedCanueVariable
    const selectableVariables = getSelectableCanueVariables(selectedCanueFile)
    return requestedCanueVariable && selectableVariables.includes(requestedCanueVariable)
      ? requestedCanueVariable
      : getDefaultCanueVariable(selectedCanueFile)
  }, [requestedCanueVariable, selectedCanueFile])
  const selectedCanueFiles = useMemo(() => {
    if (!selectedCanueDataset) return []
    if (canueYearMode === 'all') return selectedCanueDataset.files
    if (canueYearMode === 'range') {
      const start = canueRangeStartYear ?? selectedCanueDataset.years[0]
      const end = canueRangeEndYear ?? selectedCanueDataset.years[selectedCanueDataset.years.length - 1]
      const [minYear, maxYear] = start <= end ? [start, end] : [end, start]
      return selectedCanueDataset.files.filter((file) => file.year >= minYear && file.year <= maxYear)
    }
    return selectedCanueFile ? [selectedCanueFile] : []
  }, [canueRangeEndYear, canueRangeStartYear, canueYearMode, selectedCanueDataset, selectedCanueFile])
  const canuePeriodLabel = getCanuePeriodLabel(selectedCanueFiles, canueYearMode, selectedCanueMonth)

  return {
    selectedCanueDatasetId,
    setSelectedCanueDatasetId,
    selectedCanueYear,
    setSelectedCanueYear,
    canueYearMode,
    setCanueYearMode,
    canueRangeStartYear,
    setCanueRangeStartYear,
    canueRangeEndYear,
    setCanueRangeEndYear,
    selectedCanueMonth,
    setSelectedCanueMonth,
    selectedCanueVariable,
    setSelectedCanueVariable,
    canueDatasetGroups,
    selectedCanueDataset,
    selectedCanueFile,
    selectedCanueFiles,
    canuePeriodLabel,
  }
}
