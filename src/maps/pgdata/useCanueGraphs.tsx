import { useMemo, useState } from 'react'
import { CANUE_V2_ENABLED, type CanueV2Layer, type CanueVariableSelection } from './canueV2'
import type { CanueGraphVariableOption } from './CanueGraphDrawer'
import type { CanueAggregateRow, CanueV2AggregateResult } from './canueV2Aggregates'
import {
  formatCanueDisplayLabel,
  getCanueV2GraphVariableLabel,
  getCanueVariableLabel,
  type CanueBoundaryResult,
  type CanueFile,
  type CanueV2MetadataLookup,
} from './canueCore'

type BoundaryLayerData = Pick<CanueBoundaryResult, 'data'>

interface UseCanueGraphsArgs {
  activeCanueBoundaryData: BoundaryLayerData
  activeCanueBoundaryProperty: string
  activeTab: string
  canueV2AggregateData: CanueV2AggregateResult
  canueV2Metadata: CanueV2MetadataLookup | null
  selectedCanueFile: CanueFile | null
  selectedCanueV2FamilySelections: CanueVariableSelection[]
  selectedCanueV2Layer: CanueV2Layer | null
  selectedCanueVariable: string | null
  showCanueBoundaries: boolean
}

export function useCanueGraphs({
  activeCanueBoundaryData,
  activeCanueBoundaryProperty,
  activeTab,
  canueV2AggregateData,
  canueV2Metadata,
  selectedCanueFile,
  selectedCanueV2FamilySelections,
  selectedCanueV2Layer,
  selectedCanueVariable,
  showCanueBoundaries,
}: UseCanueGraphsArgs) {
  const [requestedCanueGraphKeys, setRequestedCanueGraphKeys] = useState<string[]>([])

  const canueGraphVariableOptions = useMemo<CanueGraphVariableOption[]>(() => {
    if (CANUE_V2_ENABLED && selectedCanueV2Layer && selectedCanueV2FamilySelections.length) {
      const options = new Map<string, CanueGraphVariableOption>()
      for (const selection of selectedCanueV2FamilySelections) {
        if (selection.year !== selectedCanueV2Layer.year) continue
        options.set(selection.property, {
          key: selection.property,
          label: formatCanueDisplayLabel(getCanueV2GraphVariableLabel(selection, canueV2Metadata)),
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
  }, [canueV2Metadata, selectedCanueFile, selectedCanueV2FamilySelections, selectedCanueV2Layer, selectedCanueVariable])

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

  const selectedCanueGraphKeys = useMemo(() => {
    const availableKeys = new Set(canueGraphVariableOptions.map((option) => option.key))
    const nextKeys = requestedCanueGraphKeys.filter((key) => availableKeys.has(key)).slice(0, 4)
    if (!nextKeys.length) {
      const preferredKeys = [
        activeCanueBoundaryProperty,
        ...canueGraphVariableOptions.map((option) => option.key),
      ].filter((key, index, keys) => key && availableKeys.has(key) && keys.indexOf(key) === index)
      nextKeys.push(...preferredKeys.slice(0, 3))
    }
    return nextKeys
  }, [activeCanueBoundaryProperty, canueGraphVariableOptions, requestedCanueGraphKeys])

  const handleCanueGraphVariableToggle = (key: string) => {
    setRequestedCanueGraphKeys((current) => {
      const selectedKeys = selectedCanueGraphKeys.length ? selectedCanueGraphKeys : current
      if (selectedKeys.includes(key)) return selectedKeys.filter((item) => item !== key)
      return [...selectedKeys, key].slice(-4)
    })
  }

  return {
    selectedCanueGraphKeys,
    canueGraphVariableOptions,
    activeCanueGraphRows,
    canueGraphsAvailable,
    handleCanueGraphVariableToggle,
  }
}
