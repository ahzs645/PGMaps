import { BarChart3, CalendarDays, Database } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
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

type SelectOption = { value: string; label: React.ReactNode }
type BoundaryDataStatus = {
  loading: boolean
  error: string | null
  validBoundaryCount: number
  minValue: number | null
  maxValue: number | null
}
type CanueBoundaryConfig = { label: string }
type CanueFamily = { id: string; label: string; layerCount: number; years: number[] }
type CanueLayer = { year: number; features: number }
type CanueManifestResult<T> = ReturnType<typeof useJsonManifest<T>>
type CanuePmtilesStatus = {
  zoom: number | null
  tileCount: number
  capped: boolean
  decodedFeatureCount: number
  matchedFeatureCount: number
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

      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-cyan-600" />
            <h2 className="truncate text-sm font-semibold text-foreground">CANUE Boundary Map</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {canueTimelineAvailable && (
              <button
                type="button"
                onClick={() => setCanueTimelineEnabled((current) => !current)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                  canueTimelineActive
                    ? 'border-cyan-600 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/30 dark:text-cyan-100'
                    : 'border-input text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={canueTimelineActive}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                Timeline
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCanueGraphs((current) => !current)}
              disabled={!canueGraphsAvailable}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-pressed={showCanueGraphs}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Graphs
            </button>
          </div>
        </div>
        {CANUE_V2_ENABLED && selectedCanueV2FamilyEntry && selectedCanueV2Layer && selectedCanueV2Selection && (
          <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/15 p-3">
            <div>
              <div className="text-xs font-semibold text-foreground">R2 PMTiles Grid</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
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
                  label: `${family.label} (${family.layerCount})`,
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
                <div className="mt-1 grid grid-cols-2 rounded-md border border-input bg-background p-0.5">
                  {canueV2CadenceOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        const nextSelections = selectedCanueV2GridVariableSelections.filter(
                          (selection) => getCanueV2Cadence(selection) === option.value,
                        )
                        const nextSelection = getPreferredCanueV2Selection(nextSelections)
                        setSelectedCanueV2Cadence(option.value)
                        setSelectedCanueV2Measure(nextSelection ? getCanueV2MeasureKey(nextSelection) : null)
                        setSelectedCanueV2Year(nextSelection?.year ?? null)
                        setSelectedCanueV2Month(
                          option.value === 'monthly' && nextSelection
                            ? getCanueV2MonthKey(nextSelection.variable)
                            : null,
                        )
                        setSelectedCanueV2Property(nextSelection?.property ?? null)
                      }}
                      className={cn(
                        'h-7 rounded px-2 text-xs font-medium transition-colors',
                        selectedCanueV2ResolvedCadence === option.value
                          ? 'bg-cyan-600 text-white shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      aria-pressed={selectedCanueV2ResolvedCadence === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
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
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded border border-border p-2">
                <div className="text-sm font-bold text-foreground">
                  {selectedCanueV2Layer.features.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">grid cells</div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-sm font-bold text-foreground">
                  {formatNullableNumber(selectedCanueV2Selection.min)}-
                  {formatNullableNumber(selectedCanueV2Selection.max)}
                </div>
                <div className="text-[10px] text-muted-foreground">tile range</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded border border-border p-2">
                <div className="text-sm font-bold text-foreground">
                  {activeCanueBoundaryData.validBoundaryCount.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">areas with values</div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-sm font-bold text-foreground">
                  {canueV2AggregateData.validBoundaryCount > 0
                    ? 'R2'
                    : canuePmtilesBoundaryData.zoom == null
                      ? '-'
                      : `z${canuePmtilesBoundaryData.zoom}`}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {canueV2AggregateData.validBoundaryCount > 0
                    ? 'aggregate'
                    : `${canuePmtilesBoundaryData.tileCount.toLocaleString()} tiles${canuePmtilesBoundaryData.capped ? ' capped' : ''}`}
                </div>
              </div>
            </div>
            {activeCanueBoundaryData.loading && (
              <div className="text-xs text-muted-foreground">Loading CANUE boundary averages...</div>
            )}
            {activeCanueBoundaryData.error && (
              <div className="text-xs text-red-500">{activeCanueBoundaryData.error}</div>
            )}
            {!activeCanueBoundaryData.loading && activeCanueBoundaryData.validBoundaryCount > 0 && (
              <div className="rounded-md border border-border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
                {canueV2AggregateData.validBoundaryCount > 0
                  ? `Using precomputed R2 aggregate values for ${canueBoundaryConfig.label}; ${canueV2AggregateData.matchedFeatureCount.toLocaleString()} grid-cell values are represented.`
                  : `Experimental client-side score input from ${canuePmtilesBoundaryData.decodedFeatureCount.toLocaleString()} decoded tile features; ${canuePmtilesBoundaryData.matchedFeatureCount.toLocaleString()} matched to ${canueBoundaryConfig.label} boundaries by grid-cell centroid.`}
              </div>
            )}
            {selectedCanueBoundary && (
              <div className="rounded-md border border-border bg-background p-3 text-xs">
                <div className="font-semibold text-foreground">
                  {String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary')}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {renderCanueDisplayLabel(getCanueV2VariableLabel(selectedCanueV2Selection))}
                  </span>
                  <span className="font-semibold text-foreground">
                    {formatNullableNumber(
                      Number(selectedCanueBoundary.properties?.[selectedCanueV2Selection.property]),
                    )}
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {Number(selectedCanueBoundary.properties?.rowCount ?? 0).toLocaleString()} decoded grid features
                </div>
              </div>
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
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded border border-border p-2">
                <div className="text-sm font-bold text-foreground">
                  {activeCanueBoundaryData.validBoundaryCount.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">with values</div>
              </div>
              <div className="rounded border border-border p-2">
                <div className="text-sm font-bold text-foreground">
                  {formatNullableNumber(activeCanueBoundaryData.minValue)}-
                  {formatNullableNumber(activeCanueBoundaryData.maxValue)}
                </div>
                <div className="text-[10px] text-muted-foreground">sample range</div>
              </div>
            </div>
            {activeCanueBoundaryData.loading && (
              <div className="text-xs text-muted-foreground">Aggregating CANUE records...</div>
            )}
            {activeCanueBoundaryData.error && (
              <div className="text-xs text-red-500">{activeCanueBoundaryData.error}</div>
            )}
            <div className="rounded-md border border-border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
              {renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable ?? ''))} is
              aggregated in the browser from raw boundary-clipped CANUE records for {canuePeriodLabel}.
            </div>
            {selectedCanueBoundary && selectedCanueVariable && (
              <div className="rounded-md border border-border bg-background p-3 text-xs">
                <div className="font-semibold text-foreground">
                  {String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary')}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable))}
                  </span>
                  <span className="font-semibold text-foreground">
                    {formatNullableNumber(Number(selectedCanueBoundary.properties?.[activeCanueBoundaryProperty]))}
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {Number(selectedCanueBoundary.properties?.rowCount ?? 0).toLocaleString()} source records
                </div>
              </div>
            )}
          </div>
        )}
        {canueManifest.error && <div className="mb-2 text-xs text-red-500">{canueManifest.error}</div>}
        {canueMembership.error && <div className="mb-2 text-xs text-red-500">{canueMembership.error}</div>}
        {canueBoundaries.error && <div className="mb-2 text-xs text-red-500">{canueBoundaries.error}</div>}
      </div>
    </>
  )
}
