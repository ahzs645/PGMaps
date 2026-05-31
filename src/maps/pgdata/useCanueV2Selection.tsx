import { useMemo, useState, type ReactNode } from 'react'
import { listCanueV2Selections, type CanueV2Catalog, type CanueVariableSelection } from './canueV2'
import {
  CANUE_MONTH_BY_KEY,
  getCanueV2Cadence,
  getCanueV2DatasetHelp,
  getCanueV2DatasetTitle,
  getCanueV2GridVariableKey,
  getCanueV2GridVariableLabel,
  getCanueV2MeasureKey,
  getCanueV2MonthKey,
  getCanueV2VariableLabel,
  getCanueV2VariableOptionLabel,
  getPreferredCanueV2MeasureKey,
  getPreferredCanueV2Selection,
  renderCanueDisplayLabel,
  type CanueV2Cadence,
  type CanueV2MetadataLookup,
} from './canueCore'

interface UseCanueV2SelectionArgs {
  catalog: CanueV2Catalog | null
  metadata: CanueV2MetadataLookup | null
  searchParams: URLSearchParams
}

export function useCanueV2Selection({ catalog, metadata, searchParams }: UseCanueV2SelectionArgs) {
  const [requestedCanueV2Family, setSelectedCanueV2Family] = useState<string | null>(() => searchParams.get('family'))
  const [requestedCanueV2Year, setSelectedCanueV2Year] = useState<number | null>(() => {
    if (!searchParams.has('gridYear')) return null
    const year = Number(searchParams.get('gridYear'))
    return Number.isFinite(year) && year > 0 ? year : null
  })
  const [requestedCanueV2Measure, setSelectedCanueV2Measure] = useState<string | null>(() =>
    searchParams.get('measure'),
  )
  const [requestedCanueV2Cadence, setSelectedCanueV2Cadence] = useState<CanueV2Cadence>(() =>
    searchParams.get('cadence') === 'monthly' || searchParams.has('gridMonth') ? 'monthly' : 'annual',
  )
  const [requestedCanueV2Month, setSelectedCanueV2Month] = useState<string | null>(() => searchParams.get('gridMonth'))
  const [requestedCanueV2Property, setSelectedCanueV2Property] = useState<string | null>(() =>
    searchParams.get('property'),
  )

  const canueV2Families = useMemo(() => catalog?.families ?? [], [catalog?.families])
  const selectedCanueV2FamilyEntry = useMemo(() => {
    if (!canueV2Families.length) return null
    return (
      canueV2Families.find((family) => family.id === requestedCanueV2Family) ??
      canueV2Families.find((family) => family.id === 'air-quality') ??
      canueV2Families[0]
    )
  }, [canueV2Families, requestedCanueV2Family])
  const selectedCanueV2FamilySelections = useMemo<CanueVariableSelection[]>(() => {
    if (!catalog || !selectedCanueV2FamilyEntry) return []
    return listCanueV2Selections(catalog).filter((selection) => selection.family === selectedCanueV2FamilyEntry.id)
  }, [catalog, selectedCanueV2FamilyEntry])
  const canueV2GridVariableOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: ReactNode; sortLabel: string; title: string }>()
    for (const selection of selectedCanueV2FamilySelections) {
      const value = getCanueV2GridVariableKey(selection, metadata)
      if (!options.has(value)) {
        const label = getCanueV2GridVariableLabel(selection, metadata)
        const help = getCanueV2DatasetHelp(selection, metadata)
        options.set(value, {
          value,
          label: renderCanueDisplayLabel(label),
          sortLabel: label,
          title: `${getCanueV2DatasetTitle(selection, metadata)} | ${help}`,
        })
      }
    }
    return Array.from(options.values()).sort((left, right) => left.sortLabel.localeCompare(right.sortLabel))
  }, [metadata, selectedCanueV2FamilySelections])
  const selectedCanueV2GridVariableKey = useMemo(() => {
    if (requestedCanueV2Measure) {
      const measureSelection = selectedCanueV2FamilySelections.find(
        (selection) => getCanueV2MeasureKey(selection) === requestedCanueV2Measure,
      )
      if (measureSelection) return getCanueV2GridVariableKey(measureSelection, metadata)
    }
    if (requestedCanueV2Property) {
      const propertySelection = selectedCanueV2FamilySelections.find(
        (selection) => selection.property === requestedCanueV2Property,
      )
      if (propertySelection) return getCanueV2GridVariableKey(propertySelection, metadata)
    }
    const preferredSelection = getPreferredCanueV2Selection(selectedCanueV2FamilySelections)
    return preferredSelection
      ? getCanueV2GridVariableKey(preferredSelection, metadata)
      : (canueV2GridVariableOptions[0]?.value ?? null)
  }, [
    canueV2GridVariableOptions,
    metadata,
    selectedCanueV2FamilySelections,
    requestedCanueV2Measure,
    requestedCanueV2Property,
  ])
  const selectedCanueV2GridVariableSelections = useMemo(
    () =>
      selectedCanueV2GridVariableKey
        ? selectedCanueV2FamilySelections.filter(
            (selection) => getCanueV2GridVariableKey(selection, metadata) === selectedCanueV2GridVariableKey,
          )
        : [],
    [metadata, selectedCanueV2FamilySelections, selectedCanueV2GridVariableKey],
  )
  const canueV2CadenceOptions = useMemo(() => {
    const available = new Set(selectedCanueV2GridVariableSelections.map(getCanueV2Cadence))
    return [
      { value: 'annual' as const, label: 'Annual' },
      { value: 'monthly' as const, label: 'Monthly' },
    ].filter((option) => available.has(option.value))
  }, [selectedCanueV2GridVariableSelections])
  const selectedCanueV2ResolvedCadence = useMemo<CanueV2Cadence>(() => {
    if (requestedCanueV2Property) {
      const propertySelection = selectedCanueV2GridVariableSelections.find(
        (selection) => selection.property === requestedCanueV2Property,
      )
      if (propertySelection) return getCanueV2Cadence(propertySelection)
    }
    if (requestedCanueV2Measure) {
      const measureSelection = selectedCanueV2GridVariableSelections.find(
        (selection) => getCanueV2MeasureKey(selection) === requestedCanueV2Measure,
      )
      if (measureSelection) return getCanueV2Cadence(measureSelection)
    }
    if (canueV2CadenceOptions.some((option) => option.value === requestedCanueV2Cadence)) return requestedCanueV2Cadence
    return canueV2CadenceOptions[0]?.value ?? 'annual'
  }, [
    canueV2CadenceOptions,
    requestedCanueV2Cadence,
    selectedCanueV2GridVariableSelections,
    requestedCanueV2Measure,
    requestedCanueV2Property,
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
        const label = getCanueV2VariableOptionLabel(selection, metadata)
        const variableLabel = getCanueV2VariableLabel(selection)
        const help = getCanueV2DatasetHelp(selection, metadata)
        options.set(value, {
          value,
          label: renderCanueDisplayLabel(label),
          sortLabel: label,
          title: `${variableLabel}: ${help}`,
        })
      }
    }
    return Array.from(options.values()).sort((left, right) => left.sortLabel.localeCompare(right.sortLabel))
  }, [metadata, selectedCanueV2CadenceSelections])
  const selectedCanueV2MeasureKey = useMemo(() => {
    if (requestedCanueV2Measure && canueV2MeasureOptions.some((option) => option.value === requestedCanueV2Measure))
      return requestedCanueV2Measure
    if (requestedCanueV2Property) {
      const propertySelection = selectedCanueV2CadenceSelections.find(
        (selection) => selection.property === requestedCanueV2Property,
      )
      if (propertySelection) return getCanueV2MeasureKey(propertySelection)
    }
    return getPreferredCanueV2MeasureKey(canueV2MeasureOptions)
  }, [canueV2MeasureOptions, selectedCanueV2CadenceSelections, requestedCanueV2Measure, requestedCanueV2Property])
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
      requestedCanueV2Year != null && canueV2YearOptions.includes(requestedCanueV2Year)
        ? requestedCanueV2Year
        : (canueV2YearOptions[canueV2YearOptions.length - 1] ?? null),
    [canueV2YearOptions, requestedCanueV2Year],
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
    if (requestedCanueV2Month && canueV2MonthOptions.some((option) => option.value === requestedCanueV2Month))
      return requestedCanueV2Month
    if (requestedCanueV2Property) {
      const propertySelection = selectedCanueV2MeasureSelections.find(
        (selection) => selection.property === requestedCanueV2Property,
      )
      const propertyMonth = propertySelection ? getCanueV2MonthKey(propertySelection.variable) : null
      if (propertyMonth && canueV2MonthOptions.some((option) => option.value === propertyMonth)) return propertyMonth
    }
    return canueV2MonthOptions[0].value
  }, [canueV2MonthOptions, selectedCanueV2MeasureSelections, requestedCanueV2Month, requestedCanueV2Property])
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
    () => (selectedCanueV2Selection ? getCanueV2DatasetHelp(selectedCanueV2Selection, metadata) : null),
    [metadata, selectedCanueV2Selection],
  )

  const selectedCanueV2Family = selectedCanueV2FamilyEntry?.id ?? requestedCanueV2Family
  const selectedCanueV2Year = selectedCanueV2Layer?.year ?? selectedCanueV2ResolvedYear ?? requestedCanueV2Year
  const selectedCanueV2Measure = selectedCanueV2MeasureKey ?? requestedCanueV2Measure
  const selectedCanueV2Cadence = selectedCanueV2ResolvedCadence
  const selectedCanueV2Month = selectedCanueV2ResolvedMonth
  const selectedCanueV2Property = selectedCanueV2Selection?.property ?? requestedCanueV2Property

  return {
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
  }
}
