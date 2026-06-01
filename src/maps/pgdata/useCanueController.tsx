import { useCallback, useMemo, useState } from 'react'
import { PG_CENTER } from '@/components/ui/map-styles'
import { useJsonManifest } from './shared'
import { CANUE_V2_CATALOG_URL, CANUE_V2_ENABLED, type CanueV2Catalog } from './canueV2'
import { useCanueV2AggregateData } from './canueV2Aggregates'
import { useCanuePmtilesBoundaryData } from './canuePmtilesAggregate'
import { useCanueBoundaryLayer } from './useCanueBoundaryLayer'
import { useCanueGraphs } from './useCanueGraphs'
import { useCanueTimeline } from './useCanueTimeline'
import { useCanueV1Selection } from './useCanueV1Selection'
import { useCanueV2Selection } from './useCanueV2Selection'
import {
  BC_CENTER,
  CANUE_BOUNDARY_CONFIG,
  CANUE_BOUNDARY_LEVEL_TO_SOURCE,
  CANUE_CENSUS_LEVEL_OPTIONS,
  CANUE_CITY_LEVEL_OPTIONS,
  CANUE_HEALTH_LEVEL_OPTIONS,
  CANUE_NR_ADMIN_LEVEL_OPTIONS,
  CANUE_REGIONAL_DISTRICT_LEVEL_OPTIONS,
  CANUE_WATERSHED_LEVEL_OPTIONS,
  getDefaultCanueBoundaryLevel,
  parseCanueBoundaryLevel,
  resolveCanueV2AssetUrl,
  useCanueBoundaryData,
  type BoundaryFeatureCollection,
  type CanueBoundaryLevel,
  type CanueBoundarySource,
  type CanueManifest,
  type CanuePostalMembership,
  type CanueV2MetadataLookup,
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
  const [selectedCanueBoundarySelection, setSelectedCanueBoundarySelection] = useState<{
    id: string
    scope: string
  } | null>(null)
  const [showCanueGraphs, setShowCanueGraphs] = useState(false)
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

  const {
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
  } = useCanueV1Selection({ manifest: canueManifest.data, searchParams })
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
  const {
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
  } = useCanueV2Selection({ catalog: canueV2Catalog.data, metadata: canueV2Metadata.data, searchParams })
  const {
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
  } = useCanueTimeline({
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
  })
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
  const selectedCanueBoundaryScope = [
    canueBoundaryLevel,
    canuePeriodLabel,
    selectedCanueDatasetId ?? '',
    selectedCanueVariable ?? '',
  ].join(':')
  const selectedCanueBoundaryId =
    selectedCanueBoundarySelection?.scope === selectedCanueBoundaryScope ? selectedCanueBoundarySelection.id : null
  const setSelectedCanueBoundaryId = useCallback(
    (id: string | null) => {
      setSelectedCanueBoundarySelection(id ? { id, scope: selectedCanueBoundaryScope } : null)
    },
    [selectedCanueBoundaryScope],
  )
  const {
    selectedCanueBoundary,
    selectedCanueBoundaryCard,
    canueBoundaryLayerReady,
    stableCanueBoundaryLayer,
    renderedCanueBoundaryLayer,
    renderedCanueFillColor,
  } = useCanueBoundaryLayer({
    activeCanueBoundaryData,
    activeCanueBoundaryProperty,
    canueBoundaryLevel,
    selectedCanueBoundaryId,
    selectedCanueFile,
    selectedCanueV2Selection,
    selectedCanueVariable,
  })
  const {
    selectedCanueGraphKeys,
    canueGraphVariableOptions,
    activeCanueGraphRows,
    canueGraphsAvailable,
    handleCanueGraphVariableToggle,
  } = useCanueGraphs({
    activeCanueBoundaryData,
    activeCanueBoundaryProperty,
    activeTab,
    canueV2AggregateData,
    canueV2Metadata: canueV2Metadata.data,
    selectedCanueFile,
    selectedCanueV2FamilySelections,
    selectedCanueV2Layer,
    selectedCanueVariable,
    showCanueBoundaries,
  })

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
      (showCanueBoundaries && activeCanueBoundaryData.loading && !renderedCanueBoundaryLayer)
    : (!canueManifest.data && !canueManifest.error) ||
      (!canueMembership.data && !canueMembership.error) ||
      (!canueBoundaries.data && !canueBoundaries.error) ||
      (showCanueBoundaries && activeCanueBoundaryData.loading && !renderedCanueBoundaryLayer)

  const handleCanueBoundarySourceChange = (source: CanueBoundarySource) => {
    setCanueBoundarySource(source)
    setCanueBoundaryLevel(getDefaultCanueBoundaryLevel(source))
    setSelectedCanueBoundaryId(null)
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
