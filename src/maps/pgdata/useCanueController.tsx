import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PG_CENTER } from '@/components/ui/map-styles'
import { formatNullableNumber, useJsonManifest } from './shared'
import { CANUE_V2_CATALOG_URL, CANUE_V2_ENABLED, listCanueV2Selections, type CanueV2Catalog, type CanueVariableSelection } from './canueV2'
import { useCanueV2AggregateData, useCanueV2AggregatePrefetch, type CanueAggregateRow } from './canueV2Aggregates'
import { useCanuePmtilesBoundaryData } from './canuePmtilesAggregate'
import type { CanueGraphVariableOption } from './CanueGraphDrawer'
import {
  BC_CENTER,
  CANUE_BOUNDARY_CONFIG,
  CANUE_BOUNDARY_LEVEL_TO_SOURCE,
  CANUE_CENSUS_LEVEL_OPTIONS,
  CANUE_CITY_LEVEL_OPTIONS,
  CANUE_HEALTH_LEVEL_OPTIONS,
  CANUE_MONTH_BY_KEY,
  CANUE_NR_ADMIN_LEVEL_OPTIONS,
  CANUE_REGIONAL_DISTRICT_LEVEL_OPTIONS,
  CANUE_WATERSHED_LEVEL_OPTIONS,
  canueBoundaryPaint,
  formatCanueDisplayLabel,
  getCanuePeriodLabel,
  getCanueV2Cadence,
  getCanueV2DatasetHelp,
  getCanueV2DatasetTitle,
  getCanueV2GraphVariableLabel,
  getCanueV2GridVariableKey,
  getCanueV2GridVariableLabel,
  getCanueV2MeasureKey,
  getCanueV2MonthKey,
  getCanueV2SelectionDate,
  getCanueV2TimelineKey,
  getCanueV2VariableLabel,
  getCanueV2VariableOptionLabel,
  getCanueVariableLabel,
  getDefaultCanueBoundaryLevel,
  getDefaultCanueVariable,
  getPreferredCanueV2MeasureKey,
  getPreferredCanueV2Selection,
  getSelectableCanueVariables,
  parseCanueBoundaryLevel,
  renderCanueDisplayLabel,
  resolveCanueV2AssetUrl,
  useCanueBoundaryData,
  type BoundaryFeatureCollection,
  type CanueBoundaryFeatureCardData,
  type CanueBoundaryLevel,
  type CanueBoundarySource,
  type CanueDatasetGroup,
  type CanueManifest,
  type CanuePostalMembership,
  type CanueV2Cadence,
  type CanueV2MetadataLookup,
  type CanueYearMode,
} from './canueCore'

interface UseCanueControllerArgs {
  activeTab: string
  searchParams: URLSearchParams
}

export function useCanueController({ activeTab, searchParams }: UseCanueControllerArgs) {
const [canueBoundaryLevel, setCanueBoundaryLevel] = useState<CanueBoundaryLevel>(() =>
  parseCanueBoundaryLevel(searchParams.get('boundary')),
)
const [canueBoundarySource, setCanueBoundarySource] = useState<CanueBoundarySource>(
  () => CANUE_BOUNDARY_LEVEL_TO_SOURCE[parseCanueBoundaryLevel(searchParams.get('boundary'))],
)
const [showCanueBoundaries, setShowCanueBoundaries] = useState(true)
const [selectedCanueDatasetId, setSelectedCanueDatasetId] = useState<string | null>(() => searchParams.get('dataset'))
const [selectedCanueYear, setSelectedCanueYear] = useState<number | null>(() => {
  if (!searchParams.has('year')) return null
  const year = Number(searchParams.get('year'))
  return Number.isFinite(year) && year > 0 ? year : null
})
const [canueYearMode, setCanueYearMode] = useState<CanueYearMode>(
  () => (searchParams.get('years') as CanueYearMode) || 'single',
)
const [canueRangeStartYear, setCanueRangeStartYear] = useState<number | null>(null)
const [canueRangeEndYear, setCanueRangeEndYear] = useState<number | null>(null)
const [selectedCanueMonth, setSelectedCanueMonth] = useState<number>(() => {
  const month = Number(searchParams.get('month'))
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1
})
const [selectedCanueVariable, setSelectedCanueVariable] = useState<string | null>(null)
const [selectedCanueV2Family, setSelectedCanueV2Family] = useState<string | null>(() => searchParams.get('family'))
const [selectedCanueV2Year, setSelectedCanueV2Year] = useState<number | null>(() => {
  if (!searchParams.has('gridYear')) return null
  const year = Number(searchParams.get('gridYear'))
  return Number.isFinite(year) && year > 0 ? year : null
})
const [selectedCanueV2Measure, setSelectedCanueV2Measure] = useState<string | null>(() => searchParams.get('measure'))
const [selectedCanueV2Cadence, setSelectedCanueV2Cadence] = useState<CanueV2Cadence>(() =>
  searchParams.get('cadence') === 'monthly' || searchParams.has('gridMonth') ? 'monthly' : 'annual',
)
const [selectedCanueV2Month, setSelectedCanueV2Month] = useState<string | null>(() => searchParams.get('gridMonth'))
const [selectedCanueV2Property, setSelectedCanueV2Property] = useState<string | null>(() =>
  searchParams.get('property'),
)
const [selectedCanueBoundaryId, setSelectedCanueBoundaryId] = useState<string | null>(null)
const [showCanueGraphs, setShowCanueGraphs] = useState(false)
const [canueTimelineEnabled, setCanueTimelineEnabled] = useState(false)
const [canueTimelineWindowSize, setCanueTimelineWindowSize] = useState(1)
const [selectedCanueGraphKeys, setSelectedCanueGraphKeys] = useState<string[]>([])
const canueManifest = useJsonManifest<CanueManifest>(
  CANUE_V2_ENABLED ? null : '/data/canue/bc/annual-gzip/manifest.json',
)
const canueV2Catalog = useJsonManifest<CanueV2Catalog>(CANUE_V2_ENABLED ? CANUE_V2_CATALOG_URL : null)
const canueV2MetadataUrl = useMemo(
  () => resolveCanueV2AssetUrl(canueV2Catalog.data?.metadataLookup),
  [canueV2Catalog.data?.metadataLookup],
)
const canueV2Metadata = useJsonManifest<CanueV2MetadataLookup>(CANUE_V2_ENABLED ? canueV2MetadataUrl : null)
const canueMembership = useJsonManifest<CanuePostalMembership>(
  CANUE_V2_ENABLED ? null : '/data/canue/bc/postal-boundary-membership.json',
)
const canueBoundaryConfig = CANUE_BOUNDARY_CONFIG[canueBoundaryLevel]
const canueBoundaries = useJsonManifest<BoundaryFeatureCollection>(canueBoundaryConfig.path)

const canueFiles = canueManifest.data?.files ?? []
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
const canueBoundaryLevelOptions =
  canueBoundarySource === 'bcHealth'
    ? CANUE_HEALTH_LEVEL_OPTIONS
    : canueBoundarySource === 'regionalDistrict'
      ? CANUE_REGIONAL_DISTRICT_LEVEL_OPTIONS
      : canueBoundarySource === 'cityPG'
        ? CANUE_CITY_LEVEL_OPTIONS
        : canueBoundarySource === 'watershed'
          ? CANUE_WATERSHED_LEVEL_OPTIONS
          : canueBoundarySource === 'nrAdmin'
            ? CANUE_NR_ADMIN_LEVEL_OPTIONS
            : CANUE_CENSUS_LEVEL_OPTIONS
const selectedCanueDataset = useMemo(() => {
  if (!canueDatasetGroups.length) return null
  if (selectedCanueDatasetId) {
    const selected = canueDatasetGroups.find((dataset) => dataset.datasetId === selectedCanueDatasetId)
    if (selected) return selected
  }
  return canueDatasetGroups.find((dataset) => dataset.datasetId === 'pm25dale_a') ?? canueDatasetGroups[0]
}, [canueDatasetGroups, selectedCanueDatasetId])
const selectedCanueFile = useMemo(() => {
  if (!selectedCanueDataset) return null
  if (selectedCanueYear != null) {
    const selected = selectedCanueDataset.files.find((file) => file.year === selectedCanueYear)
    if (selected) return selected
  }
  return selectedCanueDataset.files[selectedCanueDataset.files.length - 1] ?? null
}, [selectedCanueDataset, selectedCanueYear])
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
const canueV2Families = canueV2Catalog.data?.families ?? []
const selectedCanueV2FamilyEntry = useMemo(() => {
  if (!canueV2Families.length) return null
  return (
    canueV2Families.find((family) => family.id === selectedCanueV2Family) ??
    canueV2Families.find((family) => family.id === 'air-quality') ??
    canueV2Families[0]
  )
}, [canueV2Families, selectedCanueV2Family])
const selectedCanueV2FamilySelections = useMemo<CanueVariableSelection[]>(() => {
  if (!canueV2Catalog.data || !selectedCanueV2FamilyEntry) return []
  return listCanueV2Selections(canueV2Catalog.data).filter(
    (selection) => selection.family === selectedCanueV2FamilyEntry.id,
  )
}, [canueV2Catalog.data, selectedCanueV2FamilyEntry])
const canueV2GridVariableOptions = useMemo(() => {
  const options = new Map<string, { value: string; label: ReactNode; sortLabel: string; title: string }>()
  for (const selection of selectedCanueV2FamilySelections) {
    const value = getCanueV2GridVariableKey(selection, canueV2Metadata.data)
    if (!options.has(value)) {
      const label = getCanueV2GridVariableLabel(selection, canueV2Metadata.data)
      const help = getCanueV2DatasetHelp(selection, canueV2Metadata.data)
      options.set(value, {
        value,
        label: renderCanueDisplayLabel(label),
        sortLabel: label,
        title: `${getCanueV2DatasetTitle(selection, canueV2Metadata.data)} | ${help}`,
      })
    }
  }
  return Array.from(options.values()).sort((left, right) => left.sortLabel.localeCompare(right.sortLabel))
}, [canueV2Metadata.data, selectedCanueV2FamilySelections])
const selectedCanueV2GridVariableKey = useMemo(() => {
  if (selectedCanueV2Measure) {
    const measureSelection = selectedCanueV2FamilySelections.find(
      (selection) => getCanueV2MeasureKey(selection) === selectedCanueV2Measure,
    )
    if (measureSelection) return getCanueV2GridVariableKey(measureSelection, canueV2Metadata.data)
  }
  if (selectedCanueV2Property) {
    const propertySelection = selectedCanueV2FamilySelections.find(
      (selection) => selection.property === selectedCanueV2Property,
    )
    if (propertySelection) return getCanueV2GridVariableKey(propertySelection, canueV2Metadata.data)
  }
  const preferredSelection = getPreferredCanueV2Selection(selectedCanueV2FamilySelections)
  return preferredSelection
    ? getCanueV2GridVariableKey(preferredSelection, canueV2Metadata.data)
    : (canueV2GridVariableOptions[0]?.value ?? null)
}, [
  canueV2GridVariableOptions,
  canueV2Metadata.data,
  selectedCanueV2FamilySelections,
  selectedCanueV2Measure,
  selectedCanueV2Property,
])
const selectedCanueV2GridVariableSelections = useMemo(
  () =>
    selectedCanueV2GridVariableKey
      ? selectedCanueV2FamilySelections.filter(
          (selection) =>
            getCanueV2GridVariableKey(selection, canueV2Metadata.data) === selectedCanueV2GridVariableKey,
        )
      : [],
  [canueV2Metadata.data, selectedCanueV2FamilySelections, selectedCanueV2GridVariableKey],
)
const canueV2CadenceOptions = useMemo(() => {
  const available = new Set(selectedCanueV2GridVariableSelections.map(getCanueV2Cadence))
  return [
    { value: 'annual' as const, label: 'Annual' },
    { value: 'monthly' as const, label: 'Monthly' },
  ].filter((option) => available.has(option.value))
}, [selectedCanueV2GridVariableSelections])
const selectedCanueV2ResolvedCadence = useMemo<CanueV2Cadence>(() => {
  if (selectedCanueV2Property) {
    const propertySelection = selectedCanueV2GridVariableSelections.find(
      (selection) => selection.property === selectedCanueV2Property,
    )
    if (propertySelection) return getCanueV2Cadence(propertySelection)
  }
  if (selectedCanueV2Measure) {
    const measureSelection = selectedCanueV2GridVariableSelections.find(
      (selection) => getCanueV2MeasureKey(selection) === selectedCanueV2Measure,
    )
    if (measureSelection) return getCanueV2Cadence(measureSelection)
  }
  if (canueV2CadenceOptions.some((option) => option.value === selectedCanueV2Cadence)) return selectedCanueV2Cadence
  return canueV2CadenceOptions[0]?.value ?? 'annual'
}, [
  canueV2CadenceOptions,
  selectedCanueV2Cadence,
  selectedCanueV2GridVariableSelections,
  selectedCanueV2Measure,
  selectedCanueV2Property,
])
const selectedCanueV2CadenceSelections = useMemo(
  () =>
    selectedCanueV2GridVariableSelections.filter(
      (selection) => getCanueV2Cadence(selection) === selectedCanueV2ResolvedCadence,
    ),
  [selectedCanueV2GridVariableSelections, selectedCanueV2ResolvedCadence],
)
const canueV2MeasureOptions = useMemo(() => {
  const options = new Map<string, { value: string; label: ReactNode; sortLabel: string; title: string }>()
  for (const selection of selectedCanueV2CadenceSelections) {
    const value = getCanueV2MeasureKey(selection)
    if (!options.has(value)) {
      const label = getCanueV2VariableOptionLabel(selection, canueV2Metadata.data)
      const variableLabel = getCanueV2VariableLabel(selection)
      const help = getCanueV2DatasetHelp(selection, canueV2Metadata.data)
      options.set(value, {
        value,
        label: renderCanueDisplayLabel(label),
        sortLabel: label,
        title: `${variableLabel}: ${help}`,
      })
    }
  }
  return Array.from(options.values()).sort((left, right) => left.sortLabel.localeCompare(right.sortLabel))
}, [canueV2Metadata.data, selectedCanueV2CadenceSelections])
const selectedCanueV2MeasureKey = useMemo(() => {
  if (selectedCanueV2Measure && canueV2MeasureOptions.some((option) => option.value === selectedCanueV2Measure))
    return selectedCanueV2Measure
  if (selectedCanueV2Property) {
    const propertySelection = selectedCanueV2CadenceSelections.find(
      (selection) => selection.property === selectedCanueV2Property,
    )
    if (propertySelection) return getCanueV2MeasureKey(propertySelection)
  }
  return getPreferredCanueV2MeasureKey(canueV2MeasureOptions)
}, [canueV2MeasureOptions, selectedCanueV2CadenceSelections, selectedCanueV2Measure, selectedCanueV2Property])
const selectedCanueV2MeasureSelections = useMemo(
  () =>
    selectedCanueV2MeasureKey
      ? selectedCanueV2CadenceSelections.filter(
          (selection) => getCanueV2MeasureKey(selection) === selectedCanueV2MeasureKey,
        )
      : [],
  [selectedCanueV2CadenceSelections, selectedCanueV2MeasureKey],
)
const canueV2YearOptions = useMemo(
  () =>
    Array.from(new Set(selectedCanueV2MeasureSelections.map((selection) => selection.year))).sort(
      (left, right) => left - right,
    ),
  [selectedCanueV2MeasureSelections],
)
const selectedCanueV2ResolvedYear = useMemo(
  () =>
    selectedCanueV2Year != null && canueV2YearOptions.includes(selectedCanueV2Year)
      ? selectedCanueV2Year
      : (canueV2YearOptions[canueV2YearOptions.length - 1] ?? null),
  [canueV2YearOptions, selectedCanueV2Year],
)
const canueV2MonthOptions = useMemo(() => {
  const options = new Map<string, { value: string; label: string }>()
  for (const selection of selectedCanueV2MeasureSelections) {
    if (selectedCanueV2ResolvedYear != null && selection.year !== selectedCanueV2ResolvedYear) continue
    const monthKey = getCanueV2MonthKey(selection.variable)
    if (monthKey && !options.has(monthKey)) {
      options.set(monthKey, {
        value: monthKey,
        label: CANUE_MONTH_BY_KEY.get(monthKey)?.label ?? monthKey.toUpperCase(),
      })
    }
  }
  return Array.from(options.values()).sort((left, right) => {
    const leftMonth = CANUE_MONTH_BY_KEY.get(left.value)?.value ?? 99
    const rightMonth = CANUE_MONTH_BY_KEY.get(right.value)?.value ?? 99
    return leftMonth - rightMonth
  })
}, [selectedCanueV2MeasureSelections, selectedCanueV2ResolvedYear])
const selectedCanueV2ResolvedMonth = useMemo(() => {
  if (!canueV2MonthOptions.length) return null
  if (selectedCanueV2Month && canueV2MonthOptions.some((option) => option.value === selectedCanueV2Month))
    return selectedCanueV2Month
  if (selectedCanueV2Property) {
    const propertySelection = selectedCanueV2MeasureSelections.find(
      (selection) => selection.property === selectedCanueV2Property,
    )
    const propertyMonth = propertySelection ? getCanueV2MonthKey(propertySelection.variable) : null
    if (propertyMonth && canueV2MonthOptions.some((option) => option.value === propertyMonth)) return propertyMonth
  }
  return canueV2MonthOptions[0].value
}, [canueV2MonthOptions, selectedCanueV2MeasureSelections, selectedCanueV2Month, selectedCanueV2Property])
const selectedCanueV2Layer = useMemo(() => {
  if (!selectedCanueV2FamilyEntry || selectedCanueV2ResolvedYear == null) return null
  return (
    selectedCanueV2FamilyEntry.layers.find((layer) => layer.year === selectedCanueV2ResolvedYear) ??
    selectedCanueV2FamilyEntry.layers[selectedCanueV2FamilyEntry.layers.length - 1] ??
    null
  )
}, [selectedCanueV2FamilyEntry, selectedCanueV2ResolvedYear])
const selectedCanueV2Selection = useMemo<CanueVariableSelection | null>(() => {
  if (!selectedCanueV2Layer || !selectedCanueV2MeasureKey) return null
  return (
    selectedCanueV2MeasureSelections.find(
      (selection) =>
        selection.year === selectedCanueV2Layer.year &&
        getCanueV2MeasureKey(selection) === selectedCanueV2MeasureKey &&
        (selectedCanueV2ResolvedMonth
          ? getCanueV2MonthKey(selection.variable) === selectedCanueV2ResolvedMonth
          : getCanueV2MonthKey(selection.variable) == null),
    ) ??
    selectedCanueV2MeasureSelections.find((selection) => selection.year === selectedCanueV2Layer.year) ??
    null
  )
}, [selectedCanueV2Layer, selectedCanueV2MeasureKey, selectedCanueV2MeasureSelections, selectedCanueV2ResolvedMonth])
const selectedCanueV2DatasetHelp = useMemo(
  () => (selectedCanueV2Selection ? getCanueV2DatasetHelp(selectedCanueV2Selection, canueV2Metadata.data) : null),
  [canueV2Metadata.data, selectedCanueV2Selection],
)
const canueTimelineIsMonthly = canueV2MonthOptions.length > 0
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
  [canueTimelineSelections],
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
const canuePeriodLabel = getCanuePeriodLabel(selectedCanueFiles, canueYearMode, selectedCanueMonth)
const canueBoundaryData = useCanueBoundaryData(
  selectedCanueFiles,
  selectedCanueVariable,
  canueBoundaries.data,
  canueBoundaryLevel,
  canueMembership.data,
  canueYearMode,
  selectedCanueMonth,
)
const canuePmtilesBoundaryData = useCanuePmtilesBoundaryData({
  selection: selectedCanueV2Selection,
  boundaries: canueBoundaries.data,
  idField: canueBoundaryConfig.idField,
  nameField: canueBoundaryConfig.nameField,
  enabled: activeTab === 'canue' && showCanueBoundaries && CANUE_V2_ENABLED,
})
const canueV2AggregateData = useCanueV2AggregateData({
  source: canueBoundarySource,
  level: canueBoundaryLevel,
  selection: selectedCanueV2Selection,
  boundaries: canueBoundaries.data,
  idField: canueBoundaryConfig.idField,
  nameField: canueBoundaryConfig.nameField,
  enabled: activeTab === 'canue' && showCanueBoundaries && CANUE_V2_ENABLED,
})
const activeCanueBoundaryData =
  CANUE_V2_ENABLED && selectedCanueV2Selection
    ? canueV2AggregateData.validBoundaryCount > 0 || canueV2AggregateData.loading || !canueV2AggregateData.error
      ? canueV2AggregateData
      : canuePmtilesBoundaryData
    : canueBoundaryData
const activeCanueBoundaryProperty = selectedCanueV2Selection?.property ?? selectedCanueVariable ?? ''
const selectedCanueBoundary = useMemo(() => {
  if (!selectedCanueBoundaryId) return null
  return (
    activeCanueBoundaryData.data.features.find((feature) => {
      const featureId = feature.properties?.boundaryId ?? feature.id
      return featureId != null && String(featureId) === selectedCanueBoundaryId
    }) ?? null
  )
}, [activeCanueBoundaryData.data.features, selectedCanueBoundaryId])
const selectedCanueBoundaryCard = useMemo<CanueBoundaryFeatureCardData | null>(() => {
  if (!selectedCanueBoundary) return null

  if (CANUE_V2_ENABLED && selectedCanueV2Selection) {
    return {
      title: String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary'),
      metricLabel: renderCanueDisplayLabel(getCanueV2VariableLabel(selectedCanueV2Selection)),
      metricValue: formatNullableNumber(
        Number(selectedCanueBoundary.properties?.[selectedCanueV2Selection.property]),
      ),
      recordCount: Number(selectedCanueBoundary.properties?.rowCount ?? 0),
      recordLabel: 'decoded grid features',
    }
  }

  if (selectedCanueFile && selectedCanueVariable) {
    return {
      title: String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary'),
      metricLabel: renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable)),
      metricValue: formatNullableNumber(Number(selectedCanueBoundary.properties?.[activeCanueBoundaryProperty])),
      recordCount: Number(selectedCanueBoundary.properties?.rowCount ?? 0),
      recordLabel: 'source records',
    }
  }

  return null
}, [
  activeCanueBoundaryProperty,
  selectedCanueBoundary,
  selectedCanueFile,
  selectedCanueV2Selection,
  selectedCanueVariable,
])
const canueGraphVariableOptions = useMemo<CanueGraphVariableOption[]>(() => {
  if (CANUE_V2_ENABLED && selectedCanueV2Layer && selectedCanueV2FamilySelections.length) {
    const options = new Map<string, CanueGraphVariableOption>()
    for (const selection of selectedCanueV2FamilySelections) {
      if (selection.year !== selectedCanueV2Layer.year) continue
      options.set(selection.property, {
        key: selection.property,
        label: formatCanueDisplayLabel(getCanueV2GraphVariableLabel(selection, canueV2Metadata.data)),
      })
    }
    return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label))
  }

  if (selectedCanueFile && selectedCanueVariable) {
    return [
      {
        key: selectedCanueVariable,
        label: formatCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable)),
      },
    ]
  }

  return []
}, [
  canueV2Metadata.data,
  selectedCanueFile,
  selectedCanueV2FamilySelections,
  selectedCanueV2Layer,
  selectedCanueVariable,
])
const activeCanueGraphRows = useMemo<CanueAggregateRow[]>(() => {
  if (canueV2AggregateData.aggregateRows.length) return canueV2AggregateData.aggregateRows
  return activeCanueBoundaryData.data.features.flatMap((feature, index) => {
    const boundaryId = String(feature.properties?.boundaryId ?? feature.id ?? index)
    const boundaryName = String(feature.properties?.boundaryName ?? feature.properties?.name ?? feature.id ?? index)
    const value = Number(feature.properties?.[activeCanueBoundaryProperty])
    if (!Number.isFinite(value)) return []
    return [
      {
        boundaryId,
        boundaryName,
        values: { [activeCanueBoundaryProperty]: value },
      },
    ]
  })
}, [activeCanueBoundaryData.data.features, activeCanueBoundaryProperty, canueV2AggregateData.aggregateRows])
const canueGraphsAvailable = activeTab === 'canue' && showCanueBoundaries && canueGraphVariableOptions.length > 0
const canueBoundaryLayerReady = useMemo(
  () =>
    activeCanueBoundaryData.data.features.some((feature) =>
      Number.isFinite(Number(feature.properties?.[activeCanueBoundaryProperty])),
    ),
  [activeCanueBoundaryData.data.features, activeCanueBoundaryProperty],
)
const [stableCanueBoundaryLayer, setStableCanueBoundaryLayer] = useState<{
  data: BoundaryFeatureCollection
  property: string
  minValue: number | null
  maxValue: number | null
  boundaryLevel: CanueBoundaryLevel
} | null>(null)

useEffect(() => {
  if (canueBoundaryLayerReady) {
    setStableCanueBoundaryLayer({
      data: activeCanueBoundaryData.data,
      property: activeCanueBoundaryProperty,
      minValue: activeCanueBoundaryData.minValue,
      maxValue: activeCanueBoundaryData.maxValue,
      boundaryLevel: canueBoundaryLevel,
    })
    return
  }

  const waitingForNextCanueAggregate =
    CANUE_V2_ENABLED &&
    selectedCanueV2Selection &&
    activeCanueBoundaryData === canueV2AggregateData &&
    canueV2AggregateData.property != null &&
    canueV2AggregateData.property !== activeCanueBoundaryProperty

  if (!activeCanueBoundaryData.loading && !waitingForNextCanueAggregate) {
    setStableCanueBoundaryLayer(null)
  }
}, [
  activeCanueBoundaryData.data,
  activeCanueBoundaryData.loading,
  activeCanueBoundaryData.maxValue,
  activeCanueBoundaryData.minValue,
  activeCanueBoundaryProperty,
  canueBoundaryLayerReady,
  canueBoundaryLevel,
  canueV2AggregateData,
  selectedCanueV2Selection,
])

useEffect(() => {
  if (!canueTimelineAvailable && canueTimelineEnabled) {
    setCanueTimelineEnabled(false)
  }
}, [canueTimelineAvailable, canueTimelineEnabled])

const renderedCanueBoundaryLayer =
  stableCanueBoundaryLayer?.boundaryLevel === canueBoundaryLevel ? stableCanueBoundaryLayer : null
const renderedCanueFillColor = useMemo(() => {
  if (!renderedCanueBoundaryLayer) return '#e5e7eb'
  return canueBoundaryPaint(
    renderedCanueBoundaryLayer.property,
    renderedCanueBoundaryLayer.minValue,
    renderedCanueBoundaryLayer.maxValue,
  )
}, [renderedCanueBoundaryLayer])
const canueMapCenter =
  canueBoundarySource === 'bcHealth' ||
  canueBoundarySource === 'regionalDistrict' ||
  canueBoundarySource === 'watershed' ||
  canueBoundarySource === 'nrAdmin'
    ? BC_CENTER
    : PG_CENTER
const canueMapZoom =
  canueBoundarySource === 'bcHealth' ||
  canueBoundarySource === 'regionalDistrict' ||
  canueBoundarySource === 'watershed' ||
  canueBoundarySource === 'nrAdmin'
    ? 4.4
    : canueBoundarySource === 'cityPG'
      ? 10.2
      : 9.4
const mapLoadingCanue = CANUE_V2_ENABLED
  ? (!canueV2Catalog.data && !canueV2Catalog.error) ||
    (!canueV2Metadata.data && !canueV2Metadata.error) ||
    (showCanueBoundaries && activeCanueBoundaryData.loading)
  : (!canueManifest.data && !canueManifest.error) ||
    (!canueMembership.data && !canueMembership.error) ||
    (!canueBoundaries.data && !canueBoundaries.error) ||
    (showCanueBoundaries && activeCanueBoundaryData.loading)

useEffect(() => {
  if (!selectedCanueDataset || !selectedCanueFile) return
  if (selectedCanueDatasetId !== selectedCanueDataset.datasetId)
    setSelectedCanueDatasetId(selectedCanueDataset.datasetId)
  if (selectedCanueYear !== selectedCanueFile.year) setSelectedCanueYear(selectedCanueFile.year)
  if (selectedCanueFile.cadence !== 'monthly' && canueYearMode === 'month') setCanueYearMode('single')
  if (selectedCanueDataset.years.length <= 1 && canueYearMode !== 'single' && canueYearMode !== 'month')
    setCanueYearMode('single')
  if (canueRangeStartYear == null) setCanueRangeStartYear(selectedCanueDataset.years[0])
  if (canueRangeEndYear == null)
    setCanueRangeEndYear(selectedCanueDataset.years[selectedCanueDataset.years.length - 1])
  const selectableVariables = getSelectableCanueVariables(selectedCanueFile)
  if (!selectedCanueVariable || !selectableVariables.includes(selectedCanueVariable)) {
    setSelectedCanueVariable(getDefaultCanueVariable(selectedCanueFile))
  }
}, [
  canueRangeEndYear,
  canueRangeStartYear,
  canueYearMode,
  selectedCanueDataset,
  selectedCanueDatasetId,
  selectedCanueFile,
  selectedCanueVariable,
  selectedCanueYear,
])

useEffect(() => {
  if (!selectedCanueV2FamilyEntry || !selectedCanueV2Layer || !selectedCanueV2Selection) return
  if (selectedCanueV2Family !== selectedCanueV2FamilyEntry.id) setSelectedCanueV2Family(selectedCanueV2FamilyEntry.id)
  if (selectedCanueV2Cadence !== selectedCanueV2ResolvedCadence)
    setSelectedCanueV2Cadence(selectedCanueV2ResolvedCadence)
  if (selectedCanueV2Measure !== selectedCanueV2MeasureKey) setSelectedCanueV2Measure(selectedCanueV2MeasureKey)
  if (selectedCanueV2Month !== selectedCanueV2ResolvedMonth) setSelectedCanueV2Month(selectedCanueV2ResolvedMonth)
  if (selectedCanueV2Year !== selectedCanueV2Layer.year) setSelectedCanueV2Year(selectedCanueV2Layer.year)
  if (selectedCanueV2Property !== selectedCanueV2Selection.property)
    setSelectedCanueV2Property(selectedCanueV2Selection.property)
}, [
  selectedCanueV2Family,
  selectedCanueV2FamilyEntry,
  selectedCanueV2Cadence,
  selectedCanueV2Layer,
  selectedCanueV2Measure,
  selectedCanueV2MeasureKey,
  selectedCanueV2Month,
  selectedCanueV2Property,
  selectedCanueV2ResolvedCadence,
  selectedCanueV2ResolvedMonth,
  selectedCanueV2Selection,
  selectedCanueV2Year,
])

useEffect(() => {
  const availableKeys = new Set(canueGraphVariableOptions.map((option) => option.key))
  const nextKeys = selectedCanueGraphKeys.filter((key) => availableKeys.has(key)).slice(0, 4)
  if (!nextKeys.length) {
    const preferredKeys = [
      activeCanueBoundaryProperty,
      ...canueGraphVariableOptions.map((option) => option.key),
    ].filter((key, index, keys) => key && availableKeys.has(key) && keys.indexOf(key) === index)
    nextKeys.push(...preferredKeys.slice(0, 3))
  }
  if (nextKeys.join('|') !== selectedCanueGraphKeys.join('|')) {
    setSelectedCanueGraphKeys(nextKeys)
  }
}, [activeCanueBoundaryProperty, canueGraphVariableOptions, selectedCanueGraphKeys])

useEffect(() => {
  setSelectedCanueBoundaryId(null)
}, [canueBoundaryLevel, canuePeriodLabel, selectedCanueDatasetId, selectedCanueVariable])

const handleCanueBoundarySourceChange = (source: CanueBoundarySource) => {
  setCanueBoundarySource(source)
  setCanueBoundaryLevel(getDefaultCanueBoundaryLevel(source))
  setSelectedCanueBoundaryId(null)
}

const handleCanueGraphVariableToggle = (key: string) => {
  setSelectedCanueGraphKeys((current) => {
    if (current.includes(key)) return current.filter((item) => item !== key)
    return [...current, key].slice(-4)
  })
}


  return {
    canueBoundaryLevel,
    setCanueBoundaryLevel,
    canueBoundarySource,
    showCanueBoundaries,
    setShowCanueBoundaries,
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
    selectedCanueV2Family,
    setSelectedCanueV2Family,
    selectedCanueV2Year,
    setSelectedCanueV2Year,
    selectedCanueV2Measure,
    setSelectedCanueV2Measure,
    selectedCanueV2Cadence,
    setSelectedCanueV2Cadence,
    selectedCanueV2Month,
    setSelectedCanueV2Month,
    selectedCanueV2Property,
    setSelectedCanueV2Property,
    selectedCanueBoundaryId,
    setSelectedCanueBoundaryId,
    showCanueGraphs,
    setShowCanueGraphs,
    canueTimelineEnabled,
    setCanueTimelineEnabled,
    canueTimelineWindowSize,
    setCanueTimelineWindowSize,
    selectedCanueGraphKeys,
    canueManifest,
    canueV2Catalog,
    canueV2Metadata,
    canueMembership,
    canueBoundaryConfig,
    canueBoundaries,
    canueDatasetGroups,
    canueBoundaryLevelOptions,
    selectedCanueDataset,
    selectedCanueFile,
    selectedCanueFiles,
    canueV2Families,
    selectedCanueV2FamilyEntry,
    selectedCanueV2FamilySelections,
    canueV2GridVariableOptions,
    selectedCanueV2GridVariableKey,
    selectedCanueV2GridVariableSelections,
    canueV2CadenceOptions,
    selectedCanueV2ResolvedCadence,
    selectedCanueV2CadenceSelections,
    canueV2MeasureOptions,
    selectedCanueV2MeasureKey,
    selectedCanueV2MeasureSelections,
    canueV2YearOptions,
    selectedCanueV2ResolvedYear,
    canueV2MonthOptions,
    selectedCanueV2ResolvedMonth,
    selectedCanueV2Layer,
    selectedCanueV2Selection,
    selectedCanueV2DatasetHelp,
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
    canuePeriodLabel,
    canueBoundaryData,
    canuePmtilesBoundaryData,
    canueV2AggregateData,
    activeCanueBoundaryData,
    activeCanueBoundaryProperty,
    selectedCanueBoundary,
    selectedCanueBoundaryCard,
    canueGraphVariableOptions,
    activeCanueGraphRows,
    canueGraphsAvailable,
    canueBoundaryLayerReady,
    stableCanueBoundaryLayer,
    renderedCanueBoundaryLayer,
    renderedCanueFillColor,
    canueMapCenter,
    canueMapZoom,
    mapLoadingCanue,
    handleCanueBoundarySourceChange,
    handleCanueGraphVariableToggle,
  }
}
