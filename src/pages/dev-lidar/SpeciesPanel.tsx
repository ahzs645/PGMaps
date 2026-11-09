import { SelectField } from '@/components/ui/form-field'
import { Button } from '@/components/ui/button'
import {
  CollapsibleSection,
  KeyValueRows,
  MapGradientLegendItem,
  MapSwatch,
  SidebarSection,
} from '@/components/ui/map-panels'
import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { EmptyHint, ResultRow } from '@/components/ui/result-list'
import { StackedShareBar } from '@/components/ui/share-bars'
import { ExternalLink } from '@/components/ui/text-button'
import { Download } from 'lucide-react'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { downloadText } from '@/lib/download'
import { speciesUrl, contextUrl } from './useWorkflowData'
import type { AnalysisMode, WorkflowFeature, WorkflowOptions } from './analysisWorkflows'
import type { ForestData, ForestProperties } from './forestry'
import {
  fieldShortlistCSV,
  SPECIES_COLOURS,
  SPECIES_VIEWS,
  effectiveSpecies,
  isSpeciesPlotMode,
  speciesLegend,
  disagreement,
  predictedShare,
  inventoryShare,
  type SpeciesData,
  type SpeciesContext,
} from './species'
import { SpeciesReviewPanel } from './SpeciesReviewPanel'
function Range({
  label,
  value,
  min = 0,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <NumericRangeField
      className="mt-3 text-xs"
      label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
    />
  )
}
export function SpeciesPanel({
  data,
  context,
  forest,
  options,
  features,
  selectedId,
  onMode,
  onOptions,
  onSelect,
  onPoints,
}: {
  data: SpeciesData
  context: SpeciesContext
  forest: ForestData
  options: WorkflowOptions
  features: WorkflowFeature[]
  selectedId: string | null
  onMode: (mode: AnalysisMode) => void
  onOptions: (options: Partial<WorkflowOptions>) => void
  onSelect: (id: string) => void
  onPoints: (plot: ForestProperties) => void
}) {
  const mode = options.mode,
    view = SPECIES_VIEWS.find((v) => v.id === mode)!,
    legend = speciesLegend(options)
  const plot = forest.plots.features.find((f) => f.properties.id === selectedId)?.properties
  const standId = plot ? context.plots[plot.id]?.stand_id : selectedId
  const stand = data.stands.features.find((f) => f.properties.id === standId)?.properties
  const isPlot = isSpeciesPlotMode(mode)
  const isComparison = mode === 'species-model' || mode === 'species-disagreement' || mode === 'species-field'
  const composition = (values: Record<string, number>) =>
    Object.entries(values)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
  const set = (next: Partial<WorkflowOptions>) => onOptions({ ...next, selectedId: null })
  const exportShown = () =>
    downloadText(
      JSON.stringify(
        {
          type: 'FeatureCollection',
          features,
          metadata: {
            source_sha256: data.source_sha256,
            inventory_sha256: data.inventory_sha256,
            forestry_sha256: data.forestry_sha256,
            context_species_sha256: context.species_sha256,
            view: mode,
            options,
            interpretation: view.note,
          },
        },
        null,
        2,
      ),
      `${mode}.geojson`,
      'application/geo+json',
    )
  const visitCSV = () =>
    downloadText(fieldShortlistCSV(data, context, options), 'species-field-shortlist.csv', 'text/csv')
  return (
    <>
      <SidebarSection title={view.label} subtitle={view.note}>
        <CollapsibleSection
          key={String(mode === 'species')}
          label="Explore all forestry views"
          defaultOpen={mode === 'species'}
          className="-mx-3 -mt-1 border-b-0 bg-transparent"
          contentClassName="px-3"
        >
          <div className="grid grid-cols-2 gap-1" aria-label="Species view gallery">
            {SPECIES_VIEWS.map((v) => (
              <Button
                key={v.id}
                size="sm"
                variant={mode === v.id ? 'secondary' : 'outline'}
                className="h-auto min-h-10 whitespace-normal px-2 py-1 text-left text-3xs"
                onClick={() => onMode(v.id)}
              >
                {v.label}
              </Button>
            ))}
          </div>
        </CollapsibleSection>
        <p className="mt-3 text-3xs leading-4 text-muted-foreground">
          Species: BC inventory records · structure: measured LiDAR proxies · model: experimental held-out estimates.
          Species colours do not identify individual trees.
        </p>
        {mode === 'species-share' && (
          <>
            <SelectField
              aria-label="Species share"
              label="Species share"
              fieldClassName="mt-3"
              value={options.speciesCode}
              onChange={(e) => set({ speciesCode: e.target.value })}
            >
              {Object.entries(data.species).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} · {name}
                </option>
              ))}
            </SelectField>
            <Range
              label="Minimum recorded species share (%)"
              value={options.speciesShareMinimum}
              max={100}
              step={5}
              onChange={(v) => set({ speciesShareMinimum: v })}
            />
          </>
        )}
        {isComparison && (
          <SelectField
            aria-label="Species comparison metric"
            label="Composition to compare"
            fieldClassName="mt-3"
            value={options.speciesCompare}
            onChange={(e) => set({ speciesCompare: e.target.value })}
          >
            <option value="broadleaf">Broadleaf · EP + AT + AC</option>
            {Object.entries(data.species).map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField
          aria-label="Leading species filter"
          label="Filter by leading inventory species"
          fieldClassName="mt-3"
          value={options.speciesFilter}
          onChange={(e) => set({ speciesFilter: e.target.value })}
        >
          <option value="all">All · include unknown context</option>
          {Object.entries(data.species).map(([code, name]) => (
            <option key={code} value={code}>
              {code} · {name}
            </option>
          ))}
        </SelectField>
        {mode === 'species-disagreement' && (
          <Range
            label="Minimum model disagreement (pp)"
            value={options.speciesDifferenceMinimum}
            max={100}
            step={5}
            onChange={(v) => set({ speciesDifferenceMinimum: v })}
          />
        )}
        {mode === 'species-structure' && (
          <>
            <Range
              label="Minimum plot P95 height (m)"
              value={options.speciesHeightMinimum}
              max={40}
              onChange={(v) => set({ speciesHeightMinimum: v })}
            />
            <Range
              label="Minimum canopy cover above 5 m (%)"
              value={options.speciesCoverMinimum}
              max={100}
              step={5}
              onChange={(v) => set({ speciesCoverMinimum: v })}
            />
          </>
        )}
        {mode === 'species-regeneration' && (
          <>
            <Range
              label="Maximum plot P95 height (m)"
              value={options.speciesLowMaximum}
              max={30}
              onChange={(v) => set({ speciesLowMaximum: v })}
            />
            <Range
              label="Maximum canopy cover above 5 m (%)"
              value={options.speciesLowCoverMaximum}
              max={100}
              step={5}
              onChange={(v) => set({ speciesLowCoverMaximum: v })}
            />
            <p className="mt-2 text-3xs text-muted-foreground">
              Low height may represent shrubs, lawns, openings or young trees. No regeneration age, survival or stocking
              is inferred. Review imagery and visit the site.
            </p>
          </>
        )}
        {isPlot && (
          <>
            <SelectField
              aria-label="Species structure metric"
              label="Structure metric"
              fieldClassName="mt-3"
              value={options.speciesStructureMetric}
              onChange={(e) =>
                set({ speciesStructureMetric: e.target.value as WorkflowOptions['speciesStructureMetric'] })
              }
            >
              <option value="height">Surface P95 height</option>
              <option value="density">Canopy cover above 5 m</option>
              <option value="texture">Mean 5 m surface texture</option>
              <option value="layers">Return-height dispersion</option>
            </SelectField>
            <SelectField
              aria-label="Species structure map colour"
              label="Map colour"
              fieldClassName="mt-3"
              value={options.speciesColour}
              onChange={(e) => onOptions({ speciesColour: e.target.value as 'species' | 'metric' })}
            >
              <option value="species">Leading inventory species</option>
              <option value="metric">Selected LiDAR metric</option>
            </SelectField>
            <p className="mt-2 text-3xs text-muted-foreground">
              Plots require ≥95% eligible support. Species context requires ≥80% overlap with one supported inventory
              stand. Unmatched plots stay grey when colouring by species.
            </p>
          </>
        )}
        <Range
          label="Species overlay opacity (%)"
          value={Math.round(options.speciesOpacity * 100)}
          max={100}
          step={5}
          onChange={(v) => onOptions({ speciesOpacity: v / 100 })}
        />
        <div className="mt-3" aria-label="Species mix source">
          {legend.categorical ? (
            <div className="grid grid-cols-2 gap-2 text-3xs">
              {Object.entries(SPECIES_COLOURS).map(([code, colour]) => (
                <span key={code} className="flex items-center gap-1">
                  <MapSwatch color={colour} className="size-3" />
                  {code} · {data.species[code]}
                </span>
              ))}
              <span>Grey · unknown / unlabelled</span>
            </div>
          ) : (
            <>
              <MapGradientLegendItem
                barClassName="rounded border-0"
                labelClassName="text-3xs text-foreground"
                colors={legend.colors}
                minLabel={`${legend.min}${legend.unit}`}
                maxLabel={`${legend.max}${legend.unit}`}
              />
              <p className="mt-1 text-3xs">{legend.label} · grey: unavailable</p>
            </>
          )}
        </div>
        <p className="mt-3 text-xs font-medium" role="status">
          {features.length} matching {isPlot ? 'LiDAR plots' : 'inventory stands'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!features.length} onClick={exportShown}>
            Download shown GeoJSON
          </Button>
          {mode === 'species-field' && (
            <Button size="sm" variant="outline" disabled={!features.length} onClick={visitCSV}>
              Download field shortlist CSV
            </Button>
          )}
        </div>
        {mode === 'species-field' && (
          <p className="mt-2 text-3xs text-muted-foreground">
            Coordinates lie inside supported stand geometry. They are map review points, not confirmed access or safe
            survey locations. The shortlist is purposive and cannot estimate an unbiased forest-wide mean.
          </p>
        )}
      </SidebarSection>
      {plot && (
        <SidebarSection title={plot.id} subtitle={stand ? `Inventory context: ${stand.id}` : 'Unknown species context'}>
          <KeyValueRows
            size="sm"
            rows={[
              {
                label: 'Surface P95 / SD',
                value: `${plot.surface_p95_m.toFixed(1)} / ${plot.surface_sd_m.toFixed(1)} m`,
              },
              { label: 'Canopy cover above 5 m', value: `${plot.canopy_percent.toFixed(1)}%` },
              {
                label: 'Mean 5 m texture',
                value: plot.rugosity_m === null ? 'Unavailable' : `${plot.rugosity_m.toFixed(2)} m`,
              },
              {
                label: 'All-return height dispersion',
                value: plot.profiles.all.height_entropy?.toFixed(3) ?? 'Unavailable',
              },
              {
                label: 'Elevated returns in 2–5 m',
                value:
                  plot.profiles.all.low_layer_percent === null
                    ? 'Unavailable'
                    : `${plot.profiles.all.low_layer_percent.toFixed(1)}%`,
              },
              { label: 'Eligible plot area', value: `${plot.sampled_m2} m² (${plot.support_percent}%)` },
            ]}
          />
          <p className="mt-2 text-3xs">
            Return proportions describe laser returns; they do not measure vegetation volume or biodiversity.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onPoints(plot)}>
              Inspect original 3D points
            </Button>
            <Button size="sm" variant="outline" onClick={() => onSelect(plot.id)}>
              Focus selected plot
            </Button>
          </div>
        </SidebarSection>
      )}
      {stand && (
        <SidebarSection title={stand.id} subtitle="Selected inventory stand · recorded mixture">
          <StackedShareBar
            className="h-4"
            aria-label="Recorded species composition"
            segments={composition(stand.composition).map(([code, value]) => ({
              key: code,
              value,
              color: SPECIES_COLOURS[code],
              title: `${data.species[code]} ${value}%`,
            }))}
          />
          <div className="mt-2 space-y-1">
            {data.species_order.map((code) => (
              <div key={code} className="flex justify-between gap-1 text-3xs">
                <span className="flex items-center gap-1">
                  <MapSwatch color={SPECIES_COLOURS[code]} className="size-2" />
                  {code} · {data.species[code]}
                </span>
                <span className="shrink-0">
                  {stand.labelled ? `${stand.composition[code]}%` : 'Unknown'}
                  {stand.model ? ` · model ${stand.model.predicted[data.species_order.indexOf(code)].toFixed(1)}%` : ''}
                </span>
              </div>
            ))}
          </div>
          <KeyValueRows
            size="sm"
            rows={[
              { label: 'Supported intersection', value: `${(stand.area_m2 / 10000).toFixed(2)} ha` },
              {
                label: 'Effective recorded species',
                value: effectiveSpecies(stand.composition)?.toFixed(2) ?? 'Unavailable',
              },
              {
                label: 'Reference / interpretation',
                value: `${stand.reference_year ?? 'Unknown'} / ${stand.interpretation_date?.slice(0, 10) ?? 'Unknown'}`,
              },
              { label: 'Projected date', value: stand.projected_date?.slice(0, 10) ?? 'Unknown' },
              {
                label: 'Held-out validation plots',
                value: stand.model ? String(stand.model.plots) : 'No eligible plots',
              },
              ...(isComparison
                ? [
                    {
                      label: 'Recorded / predicted composition',
                      value: `${inventoryShare(stand, options.speciesCompare)?.toFixed(1) ?? 'Unknown'} / ${predictedShare(data, stand, options.speciesCompare)?.toFixed(1) ?? 'Unknown'}%`,
                    },
                    {
                      label: 'Model minus inventory',
                      value:
                        disagreement(data, stand, options.speciesCompare) === null
                          ? 'Unavailable'
                          : `${disagreement(data, stand, options.speciesCompare)!.toFixed(1)} pp`,
                    },
                  ]
                : []),
            ]}
          />
          <Button size="sm" variant="outline" className="mt-3" onClick={() => onSelect(selectedId!)}>
            Focus selected stand
          </Button>
        </SidebarSection>
      )}
      {(mode === 'species-field' || mode === 'species-disagreement') && (
        <SpeciesReviewPanel data={data} standId={stand?.id ?? null} />
      )}
      <SidebarSection
        title={isPlot ? 'Matching plots' : 'Inventory stands'}
        subtitle={`${features.length} shown · select to inspect`}
      >
        {!features.length && (
          <EmptyHint variant="plain">No matches. Adjust the filters to broaden the search.</EmptyHint>
        )}
        <VirtualResultList items={features} getKey={(f) => f.properties.id} label="Species results" estimateSize={60}>
          {(f) => (
            <ResultRow
              key={f.properties.id}
              title={f.properties.id}
              subtitle={
                isPlot
                  ? `${f.properties.leading ?? 'Unknown'} context · metric ${f.properties.map_value?.toFixed(2) ?? 'unavailable'}`
                  : `${f.properties.leading ?? 'Unknown'} leading · ${((f.properties.area_m2 ?? 0) / 10000).toFixed(2)} ha`
              }
              selected={selectedId === f.properties.id}
              onClick={() => onSelect(f.properties.id)}
            />
          )}
        </VirtualResultList>
      </SidebarSection>
      <SidebarSection title="Tile inventory summary" subtitle="Area-weighted recorded composition · labelled area only">
        <StackedShareBar
          aria-label="Area-weighted recorded composition"
          segments={composition(data.area_weighted_inventory_index).map(([code, value]) => ({
            key: code,
            value,
            color: SPECIES_COLOURS[code],
            title: `${data.species[code]} ${value.toFixed(1)}%`,
          }))}
        />
        {composition(data.area_weighted_inventory_index).map(([code, value]) => (
          <p key={code} className="mt-1 text-xs">
            {code} · {data.species[code]}: {value.toFixed(1)}%
          </p>
        ))}
        <p className="mt-2 text-3xs text-muted-foreground">
          {(data.coverage.labelled_m2 / 10000).toFixed(1)} ha labelled; {(data.coverage.other_m2 / 10000).toFixed(1)} ha
          other/unlabelled. This area-weighted index is not the tile’s measured fraction of stems, biomass or crown
          area.
        </p>
      </SidebarSection>
      <SidebarSection title="Model experiment" subtitle="Random forest · weak inventory labels · whole-stand holdouts">
        <p className="text-xs">
          {data.experiment.plots} plots / {data.experiment.stands} stands. Broadleaf mean absolute error:{' '}
          {data.experiment.model.broadleaf_mae_pp.toFixed(1)} pp; training-stand mean baseline:{' '}
          {data.experiment.baseline.broadleaf_mae_pp.toFixed(1)} pp.
        </p>
        <p className="mt-2 text-3xs leading-4 text-muted-foreground">
          The model does not beat the broadleaf baseline. Differences are disagreement with historical inventory, not
          proven inventory errors or calibrated uncertainty. Geographic transfer and independent field accuracy remain
          unvalidated. No species-model retraining occurs when changing views or saving notes.
        </p>
        <div className="mt-3 flex flex-col items-start gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={speciesUrl} download="species-model-experiment.json">
              <Download className="size-3.5" aria-hidden="true" />
              Download predictions, folds & provenance
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={contextUrl} download="species-plot-context.json">
              <Download className="size-3.5" aria-hidden="true" />
              Download plot links & review coordinates
            </a>
          </Button>
          <ExternalLink href="https://github.com/ahzs645/PGMaps/blob/codex/lidar-explorer/docs/research/lidar-species.md">
            Methods, interpretation & rerun
          </ExternalLink>
        </div>
      </SidebarSection>
    </>
  )
}
