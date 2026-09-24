import { BarChart3, CalendarDays, Database } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { InlineAlert, SelectedItemCard, SidebarSection, ToggleChip } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { AppSelect } from '@/components/ui/select'
import { StatGroup } from '@/components/ui/stat-group'
import { formatNumber } from '@/lib/format'
import { formatNullableNumber, useJsonManifest } from './shared'
import { CANUE_V2_ENABLED, listCanueV2Selections, type CanueV2Catalog, type CanueVariableSelection } from './canueV2'
import {
  CANUE_BOUNDARY_SOURCE_OPTIONS,
  CANUE_MONTHS,
  CANUE_SUPPORTED_SOURCES,
  CanueHelpIcon,
  getCanueV2Cadence,
  getCanueV2GridVariableKey,
  getCanueV2MeasureKey,
  getCanueV2MonthKey,
  getCanueV2VariableLabel,
  getCanueVariableLabel,
  getDefaultCanueVariable,
  getPreferredCanueV2Selection,
  getSelectableCanueVariables,
  renderCanueDisplayLabel,
  type BoundaryFeatureCollection,
  type CanueBoundaryLevel,
  type CanueBoundarySource,
  type CanueDatasetGroup,
  type CanueFile,
  type CanueManifest,
  type CanuePostalMembership,
  type CanueV2Cadence,
  type CanueV2MetadataLookup,
  type CanueYearMode,
} from './canueCore'

// The header chips carry an icon, so they need a row layout and a finger-sized height on touch screens.
const CANUE_HEADER_CHIP_CLASS = 'inline-flex h-8 items-center gap-1.5 font-medium touch:h-9'

type SelectOption = { value: string; label: React.ReactNode }
type BoundaryDataStatus = {
  loading: boolean
  error: string | null
  validBoundaryCount: number
  minValue: number | null
  maxValue: number | null
}
type CanueBoundaryConfig = { label: string }
type CanueFamily = { id: string; label: string; layerCount: number; datasetCount?: number; years: number[] }
type CanueLayer = { year: number; features: number }
type CanueManifestResult<T> = ReturnType<typeof useJsonManifest<T>>
type CanuePmtilesStatus = {
  zoom: number | null
  tileCount: number
  capped: boolean
  decodedFeatureCount: number
  matchedFeatureCount: number
}

function getCanueFamilyDisplayLabel(family: CanueFamily): string {
  if (family.id === 'other' && family.datasetCount === 1) return 'Night-time Lights'
  return family.label
}

function getCanueFamilyOptionLabel(family: CanueFamily): string {
  return `${getCanueFamilyDisplayLabel(family)} (${family.datasetCount ?? 1})`
}

interface CanueSidebarProps {
  showCanueBoundaries: boolean
  canueBoundarySource: CanueBoundarySource
  canueBoundaryLevel: CanueBoundaryLevel
  canueBoundaryLevelOptions: Array<{ value: CanueBoundaryLevel; label: string }>
  canueBoundaryConfig: CanueBoundaryConfig
  canueTimelineAvailable: boolean
  canueTimelineActive: boolean
  canueGraphsAvailable: boolean
  showCanueGraphs: boolean
  canueV2Catalog: CanueManifestResult<CanueV2Catalog>
  canueV2Metadata: CanueManifestResult<CanueV2MetadataLookup>
  canueV2Families: CanueFamily[]
  selectedCanueV2FamilyEntry: CanueFamily | null
  selectedCanueV2FamilySelections: CanueVariableSelection[]
  selectedCanueV2GridVariableKey: string | null
  selectedCanueV2GridVariableSelections: CanueVariableSelection[]
  selectedCanueV2ResolvedCadence: CanueV2Cadence
  selectedCanueV2CadenceSelections: CanueVariableSelection[]
  selectedCanueV2MeasureKey: string | null
  selectedCanueV2ResolvedYear: number | null
  selectedCanueV2ResolvedMonth: string | null
  selectedCanueV2Layer: CanueLayer | null
  selectedCanueV2Selection: CanueVariableSelection | null
  selectedCanueV2DatasetHelp: string | null
  canueV2GridVariableOptions: SelectOption[]
  canueV2CadenceOptions: Array<{ value: CanueV2Cadence; label: string }>
  canueV2MeasureOptions: SelectOption[]
  canueV2YearOptions: number[]
  canueV2MonthOptions: Array<{ value: string; label: string }>
  activeCanueBoundaryData: BoundaryDataStatus
  canueV2AggregateData: BoundaryDataStatus & { matchedFeatureCount: number }
  canuePmtilesBoundaryData: CanuePmtilesStatus
  selectedCanueBoundary: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  selectedCanueDataset: CanueDatasetGroup | null
  selectedCanueFile: CanueFile | null
  selectedCanueVariable: string | null
  canueDatasetGroups: CanueDatasetGroup[]
  canueYearMode: CanueYearMode
  selectedCanueMonth: number
  canueRangeStartYear: number | null
  canueRangeEndYear: number | null
  canuePeriodLabel: string
  activeCanueBoundaryProperty: string
  canueManifest: CanueManifestResult<CanueManifest>
  canueMembership: CanueManifestResult<CanuePostalMembership>
  canueBoundaries: CanueManifestResult<BoundaryFeatureCollection>
  setShowCanueBoundaries: React.Dispatch<React.SetStateAction<boolean>>
  handleCanueBoundarySourceChange: (source: CanueBoundarySource) => void
  setCanueBoundaryLevel: (level: CanueBoundaryLevel) => void
  setCanueTimelineEnabled: React.Dispatch<React.SetStateAction<boolean>>
  setShowCanueGraphs: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedCanueV2Family: (family: string | null) => void
  setSelectedCanueV2Cadence: (cadence: CanueV2Cadence) => void
  setSelectedCanueV2Measure: (measure: string | null) => void
  setSelectedCanueV2Year: (year: number | null) => void
  setSelectedCanueV2Month: (month: string | null) => void
  setSelectedCanueV2Property: (property: string | null) => void
  setSelectedCanueDatasetId: (datasetId: string | null) => void
  setSelectedCanueYear: (year: number | null) => void
  setCanueYearMode: (mode: CanueYearMode) => void
  setCanueRangeStartYear: (year: number | null) => void
  setCanueRangeEndYear: (year: number | null) => void
  setSelectedCanueVariable: (variable: string | null) => void
  setSelectedCanueMonth: (month: number) => void
}

export function CanueSidebar({
  showCanueBoundaries,
  canueBoundarySource,
  canueBoundaryLevel,
  canueBoundaryLevelOptions,
  canueBoundaryConfig,
  canueTimelineAvailable,
  canueTimelineActive,
  canueGraphsAvailable,
  showCanueGraphs,
  canueV2Catalog,
  canueV2Metadata,
  canueV2Families,
  selectedCanueV2FamilyEntry,
  selectedCanueV2FamilySelections,
  selectedCanueV2GridVariableKey,
  selectedCanueV2GridVariableSelections,
  selectedCanueV2ResolvedCadence,
  selectedCanueV2CadenceSelections,
  selectedCanueV2MeasureKey,
  selectedCanueV2ResolvedYear,
  selectedCanueV2ResolvedMonth,
  selectedCanueV2Layer,
  selectedCanueV2Selection,
  selectedCanueV2DatasetHelp,
  canueV2GridVariableOptions,
  canueV2CadenceOptions,
  canueV2MeasureOptions,
  canueV2YearOptions,
  canueV2MonthOptions,
  activeCanueBoundaryData,
  canueV2AggregateData,
  canuePmtilesBoundaryData,
  selectedCanueBoundary,
  selectedCanueDataset,
  selectedCanueFile,
  selectedCanueVariable,
  canueDatasetGroups,
  canueYearMode,
  selectedCanueMonth,
  canueRangeStartYear,
  canueRangeEndYear,
  canuePeriodLabel,
  activeCanueBoundaryProperty,
  canueManifest,
  canueMembership,
  canueBoundaries,
  setShowCanueBoundaries,
  handleCanueBoundarySourceChange,
  setCanueBoundaryLevel,
  setCanueTimelineEnabled,
  setShowCanueGraphs,
  setSelectedCanueV2Family,
  setSelectedCanueV2Cadence,
  setSelectedCanueV2Measure,
  setSelectedCanueV2Year,
  setSelectedCanueV2Month,
  setSelectedCanueV2Property,
  setSelectedCanueDatasetId,
  setSelectedCanueYear,
  setCanueYearMode,
  setCanueRangeStartYear,
  setCanueRangeEndYear,
  setSelectedCanueVariable,
  setSelectedCanueMonth,
}: CanueSidebarProps) {
  return (
    <>
      <StudyAreaSelector<string, CanueBoundaryLevel>
        source={showCanueBoundaries ? canueBoundarySource : undefined}
        sourceOptions={CANUE_BOUNDARY_SOURCE_OPTIONS}
        level={canueBoundaryLevel}
        levelOptions={showCanueBoundaries ? canueBoundaryLevelOptions : []}
        onSourceChange={(value) => {
          if (CANUE_SUPPORTED_SOURCES.has(value)) {
            setShowCanueBoundaries(true)
            handleCanueBoundarySourceChange(value as CanueBoundarySource)
          }
        }}
        onSelectedSourceClick={() => setShowCanueBoundaries(false)}
        onLevelChange={setCanueBoundaryLevel}
        levelSelectId="canue-study-area-level"
      />

      <SidebarSection
        title="CANUE Boundary Map"
        icon={Database}
        iconClassName="shrink-0 text-cyan-600"
        actions={
          <>
            {canueTimelineAvailable && (
              <ToggleChip
                active={canueTimelineActive}
                onClick={() => setCanueTimelineEnabled((current) => !current)}
                tone="cyan"
                className={CANUE_HEADER_CHIP_CLASS}
              >
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                Timeline
              </ToggleChip>
            )}
            <ToggleChip
              active={showCanueGraphs}
              onClick={() => setShowCanueGraphs((current) => !current)}
              disabled={!canueGraphsAvailable}
              tone="cyan"
              className={CANUE_HEADER_CHIP_CLASS}
            >
              <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
              Graphs
            </ToggleChip>
          </>
        }
      >
        {CANUE_V2_ENABLED && selectedCanueV2FamilyEntry && selectedCanueV2Layer && selectedCanueV2Selection && (
          <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/15 p-3">
            <div>
              <div className="text-xs font-semibold text-foreground">R2 PMTiles Grid</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {canueV2Catalog.data
                  ? `${canueV2Catalog.data.families.length} families from Cloudflare R2`
                  : 'Loading R2 catalog...'}
              </div>
            </div>
            <label className="block text-xs font-medium text-foreground">
              Family
              <AppSelect
                value={selectedCanueV2FamilyEntry.id}
                onValueChange={(familyId) => {
                  const nextFamily = canueV2Families.find((family) => family.id === familyId)
                  const nextSelections =
                    nextFamily && canueV2Catalog.data
                      ? listCanueV2Selections(canueV2Catalog.data).filter(
                          (selection) => selection.family === nextFamily.id,
                        )
                      : []
                  const nextSelection = getPreferredCanueV2Selection(nextSelections)
                  const nextCadence = nextSelection ? getCanueV2Cadence(nextSelection) : selectedCanueV2ResolvedCadence
                  setSelectedCanueV2Family(familyId)
                  setSelectedCanueV2Cadence(nextCadence)
                  setSelectedCanueV2Measure(nextSelection ? getCanueV2MeasureKey(nextSelection) : null)
                  setSelectedCanueV2Year(nextFamily?.years[nextFamily.years.length - 1] ?? nextSelection?.year ?? null)
                  setSelectedCanueV2Month(nextSelection ? getCanueV2MonthKey(nextSelection.variable) : null)
                  setSelectedCanueV2Property(nextSelection?.property ?? null)
                }}
                options={canueV2Families.map((family) => ({
                  value: family.id,
                  label: getCanueFamilyOptionLabel(family),
                }))}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>
            <label className="block text-xs font-medium text-foreground">
              <span className="flex items-center gap-1.5">
                Grid variable
                <CanueHelpIcon label="Grid variable" help={selectedCanueV2DatasetHelp} />
              </span>
              <AppSelect
                value={selectedCanueV2GridVariableKey ?? ''}
                onValueChange={(gridVariable) => {
                  const nextSelections = selectedCanueV2FamilySelections.filter(
                    (selection) => getCanueV2GridVariableKey(selection, canueV2Metadata.data) === gridVariable,
                  )
                  const nextSelection = getPreferredCanueV2Selection(nextSelections)
                  const nextCadence = nextSelection ? getCanueV2Cadence(nextSelection) : selectedCanueV2ResolvedCadence
                  setSelectedCanueV2Cadence(nextCadence)
                  setSelectedCanueV2Measure(nextSelection ? getCanueV2MeasureKey(nextSelection) : null)
                  setSelectedCanueV2Year(nextSelection?.year ?? null)
                  setSelectedCanueV2Month(
                    nextCadence === 'monthly' && nextSelection ? getCanueV2MonthKey(nextSelection.variable) : null,
                  )
                  setSelectedCanueV2Property(nextSelection?.property ?? null)
                }}
                options={canueV2GridVariableOptions}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>
            {canueV2CadenceOptions.length > 1 && (
              <div className="block text-xs font-medium text-foreground">
                Time scale
                <SegmentedControl
                  label="Time scale"
                  size="sm"
                  className="mt-1"
                  value={selectedCanueV2ResolvedCadence}
                  options={canueV2CadenceOptions.map((option) => ({
                    ...option,
                    activeClassName: 'bg-cyan-600 text-white dark:bg-cyan-600',
                  }))}
                  onChange={(cadence) => {
                    const nextSelections = selectedCanueV2GridVariableSelections.filter(
                      (selection) => getCanueV2Cadence(selection) === cadence,
                    )
                    const nextSelection = getPreferredCanueV2Selection(nextSelections)
                    setSelectedCanueV2Cadence(cadence)
                    setSelectedCanueV2Measure(nextSelection ? getCanueV2MeasureKey(nextSelection) : null)
                    setSelectedCanueV2Year(nextSelection?.year ?? null)
                    setSelectedCanueV2Month(
                      cadence === 'monthly' && nextSelection ? getCanueV2MonthKey(nextSelection.variable) : null,
                    )
                    setSelectedCanueV2Property(nextSelection?.property ?? null)
                  }}
                />
              </div>
            )}
            {canueV2MeasureOptions.length > 1 && (
              <label className="block text-xs font-medium text-foreground">
                <span className="flex items-center gap-1.5">
                  Sub-variable
                  <CanueHelpIcon label="Sub-variable" help={selectedCanueV2DatasetHelp} />
                </span>
                <AppSelect
                  value={selectedCanueV2MeasureKey ?? ''}
                  onValueChange={(measure) => {
                    const nextSelection = selectedCanueV2CadenceSelections.find(
                      (selection) => getCanueV2MeasureKey(selection) === measure,
                    )
                    setSelectedCanueV2Measure(measure)
                    setSelectedCanueV2Year(nextSelection?.year ?? null)
                    setSelectedCanueV2Month(
                      selectedCanueV2ResolvedCadence === 'monthly' && nextSelection
                        ? getCanueV2MonthKey(nextSelection.variable)
                        : null,
                    )
                    setSelectedCanueV2Property(nextSelection?.property ?? null)
                  }}
                  options={canueV2MeasureOptions}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
            )}
            <label className="block text-xs font-medium text-foreground">
              Grid year
              <AppSelect
                value={selectedCanueV2ResolvedYear == null ? '' : String(selectedCanueV2ResolvedYear)}
                onValueChange={(year) => {
                  setSelectedCanueV2Year(Number(year))
                  setSelectedCanueV2Property(null)
                }}
                options={canueV2YearOptions.map((year) => ({
                  value: String(year),
                  label: String(year),
                }))}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>
            {canueV2MonthOptions.length > 0 && (
              <label className="block text-xs font-medium text-foreground">
                Grid month
                <AppSelect
                  value={selectedCanueV2ResolvedMonth ?? canueV2MonthOptions[0]?.value ?? ''}
                  onValueChange={(month) => {
                    setSelectedCanueV2Month(month)
                    setSelectedCanueV2Property(null)
                  }}
                  options={canueV2MonthOptions}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
            )}
            <StatGroup
              variant="tiles"
              size="sm"
              columns={2}
              items={[
                { label: 'grid cells', value: formatNumber(selectedCanueV2Layer.features) },
                {
                  label: 'tile range',
                  value: `${formatNullableNumber(selectedCanueV2Selection.min)}-${formatNullableNumber(selectedCanueV2Selection.max)}`,
                },
                { label: 'areas with values', value: formatNumber(activeCanueBoundaryData.validBoundaryCount) },
                canueV2AggregateData.validBoundaryCount > 0
                  ? { key: 'source', label: 'aggregate', value: 'R2' }
                  : {
                      key: 'source',
                      label: `${formatNumber(canuePmtilesBoundaryData.tileCount)} tiles${canuePmtilesBoundaryData.capped ? ' capped' : ''}`,
                      value: canuePmtilesBoundaryData.zoom == null ? '-' : `z${canuePmtilesBoundaryData.zoom}`,
                    },
              ]}
            />
            {activeCanueBoundaryData.loading && <InlineAlert loading>Loading CANUE boundary averages...</InlineAlert>}
            {activeCanueBoundaryData.error && <InlineAlert tone="error">{activeCanueBoundaryData.error}</InlineAlert>}
            {!activeCanueBoundaryData.loading && activeCanueBoundaryData.validBoundaryCount > 0 && (
              <InlineAlert>
                {canueV2AggregateData.validBoundaryCount > 0
                  ? `Using precomputed R2 aggregate values for ${canueBoundaryConfig.label}; ${formatNumber(canueV2AggregateData.matchedFeatureCount)} grid-cell values are represented.`
                  : `Experimental client-side score input from ${formatNumber(canuePmtilesBoundaryData.decodedFeatureCount)} decoded tile features; ${formatNumber(canuePmtilesBoundaryData.matchedFeatureCount)} matched to ${canueBoundaryConfig.label} boundaries by grid-cell centroid.`}
              </InlineAlert>
            )}
            {selectedCanueBoundary && (
              <SelectedItemCard
                title={String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary')}
                rows={[
                  {
                    label: renderCanueDisplayLabel(getCanueV2VariableLabel(selectedCanueV2Selection)),
                    value: formatNullableNumber(
                      Number(selectedCanueBoundary.properties?.[selectedCanueV2Selection.property]),
                    ),
                  },
                ]}
              >
                <div className="mt-1 text-muted-foreground">
                  {formatNumber(Number(selectedCanueBoundary.properties?.rowCount ?? 0))} decoded grid features
                </div>
              </SelectedItemCard>
            )}
          </div>
        )}
        {selectedCanueFile && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-foreground">
              Dataset
              <AppSelect
                value={selectedCanueDataset?.datasetId ?? ''}
                onValueChange={(datasetId) => {
                  const nextDataset = canueDatasetGroups.find((dataset) => dataset.datasetId === datasetId)
                  const nextFile = nextDataset?.files[nextDataset.files.length - 1] ?? null
                  setSelectedCanueDatasetId(datasetId)
                  setSelectedCanueYear(nextFile?.year ?? null)
                  setCanueYearMode('single')
                  setCanueRangeStartYear(nextDataset?.years[0] ?? null)
                  setCanueRangeEndYear(nextDataset?.years[nextDataset.years.length - 1] ?? null)
                  setSelectedCanueVariable(nextFile ? getDefaultCanueVariable(nextFile) : null)
                }}
                options={canueDatasetGroups.map((dataset) => ({
                  value: dataset.datasetId,
                  label:
                    dataset.years.length > 1
                      ? `${dataset.label} (${dataset.years[0]}-${dataset.years[dataset.years.length - 1]})`
                      : `${dataset.label} (${dataset.years[0]})`,
                }))}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>
            {selectedCanueDataset &&
              (selectedCanueDataset.years.length > 1 || selectedCanueFile.cadence === 'monthly') && (
                <div className="space-y-2 rounded-md border border-border bg-muted/15 p-2">
                  <label className="block text-xs font-medium text-foreground">
                    Time
                    <AppSelect
                      value={canueYearMode}
                      onValueChange={(value) => setCanueYearMode(value as CanueYearMode)}
                      options={[
                        {
                          value: 'single',
                          label: selectedCanueFile.cadence === 'monthly' ? 'Year average' : 'Single year',
                        },
                        ...(selectedCanueFile.cadence === 'monthly' ? [{ value: 'month', label: 'Single month' }] : []),
                        { value: 'all', label: 'All years average' },
                        { value: 'range', label: 'Year range average' },
                      ]}
                      className="mt-1"
                      triggerClassName="h-8 rounded-md text-xs"
                    />
                  </label>
                  {(canueYearMode === 'single' || canueYearMode === 'month') && (
                    <label className="block text-xs font-medium text-foreground">
                      Year
                      <AppSelect
                        value={String(selectedCanueFile.year)}
                        onValueChange={(year) => {
                          const nextYear = Number(year)
                          const nextFile = selectedCanueDataset.files.find((file) => file.year === nextYear)
                          setSelectedCanueYear(nextYear)
                          setSelectedCanueVariable(nextFile ? getDefaultCanueVariable(nextFile) : selectedCanueVariable)
                        }}
                        options={selectedCanueDataset.years.map((year) => ({
                          value: String(year),
                          label: String(year),
                        }))}
                        className="mt-1"
                        triggerClassName="h-8 rounded-md text-xs"
                      />
                    </label>
                  )}
                  {canueYearMode === 'month' && selectedCanueFile.cadence === 'monthly' && (
                    <label className="block text-xs font-medium text-foreground">
                      Month
                      <AppSelect
                        value={String(selectedCanueMonth)}
                        onValueChange={(month) => setSelectedCanueMonth(Number(month))}
                        options={CANUE_MONTHS.map((month) => ({
                          value: String(month.value),
                          label: month.label,
                        }))}
                        className="mt-1"
                        triggerClassName="h-8 rounded-md text-xs"
                      />
                    </label>
                  )}
                  {canueYearMode === 'range' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs font-medium text-foreground">
                        Start
                        <AppSelect
                          value={String(canueRangeStartYear ?? selectedCanueDataset.years[0])}
                          onValueChange={(year) => setCanueRangeStartYear(Number(year))}
                          options={selectedCanueDataset.years.map((year) => ({
                            value: String(year),
                            label: String(year),
                          }))}
                          className="mt-1"
                          triggerClassName="h-8 rounded-md text-xs"
                        />
                      </label>
                      <label className="block text-xs font-medium text-foreground">
                        End
                        <AppSelect
                          value={String(
                            canueRangeEndYear ?? selectedCanueDataset.years[selectedCanueDataset.years.length - 1],
                          )}
                          onValueChange={(year) => setCanueRangeEndYear(Number(year))}
                          options={selectedCanueDataset.years.map((year) => ({
                            value: String(year),
                            label: String(year),
                          }))}
                          className="mt-1"
                          triggerClassName="h-8 rounded-md text-xs"
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            <label className="block text-xs font-medium text-foreground">
              Map variable
              <AppSelect
                value={selectedCanueVariable ?? ''}
                onValueChange={setSelectedCanueVariable}
                options={getSelectableCanueVariables(selectedCanueFile).map((variable) => ({
                  value: variable,
                  label: (
                    <>
                      {renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, variable))} ({variable})
                    </>
                  ),
                }))}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>
            <StatGroup
              variant="tiles"
              size="sm"
              columns={2}
              items={[
                { label: 'with values', value: formatNumber(activeCanueBoundaryData.validBoundaryCount) },
                {
                  label: 'sample range',
                  value: `${formatNullableNumber(activeCanueBoundaryData.minValue)}-${formatNullableNumber(activeCanueBoundaryData.maxValue)}`,
                },
              ]}
            />
            {activeCanueBoundaryData.loading && <InlineAlert loading>Aggregating CANUE records...</InlineAlert>}
            {activeCanueBoundaryData.error && <InlineAlert tone="error">{activeCanueBoundaryData.error}</InlineAlert>}
            <InlineAlert>
              {renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable ?? ''))} is
              aggregated in the browser from raw boundary-clipped CANUE records for {canuePeriodLabel}.
            </InlineAlert>
            {selectedCanueBoundary && selectedCanueVariable && (
              <SelectedItemCard
                title={String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary')}
                rows={[
                  {
                    label: renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable)),
                    value: formatNullableNumber(Number(selectedCanueBoundary.properties?.[activeCanueBoundaryProperty])),
                  },
                ]}
              >
                <div className="mt-1 text-muted-foreground">
                  {formatNumber(Number(selectedCanueBoundary.properties?.rowCount ?? 0))} source records
                </div>
              </SelectedItemCard>
            )}
          </div>
        )}
        {canueManifest.error && <InlineAlert tone="error" className="mt-2">{canueManifest.error}</InlineAlert>}
        {canueMembership.error && <InlineAlert tone="error" className="mt-2">{canueMembership.error}</InlineAlert>}
        {canueBoundaries.error && <InlineAlert tone="error" className="mt-2">{canueBoundaries.error}</InlineAlert>}
      </SidebarSection>
    </>
  )
}
