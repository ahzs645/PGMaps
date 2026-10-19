import { Button } from '@/components/ui/button'
import { SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { ResultRow } from '@/components/ui/result-list'
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
    <label className="mt-3 block text-xs">
      {label} · {value}
      <input
        aria-label={label}
        className="mt-1 block w-full"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
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
        <details open={mode === 'species'} className="text-xs">
          <summary className="cursor-pointer font-medium">Explore all forestry views</summary>
          <div className="mt-2 grid grid-cols-2 gap-1" aria-label="Species view gallery">
            {SPECIES_VIEWS.map((v) => (
              <Button
                key={v.id}
                size="sm"
                variant={mode === v.id ? 'secondary' : 'outline'}
                className="h-auto min-h-10 whitespace-normal px-2 py-1 text-left text-[10px]"
                onClick={() => onMode(v.id)}
              >
                {v.label}
              </Button>
            ))}
          </div>
        </details>
        <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
          Species: BC inventory records · structure: measured LiDAR proxies · model: experimental held-out estimates.
          Species colours do not identify individual trees.
        </p>
        {mode === 'species-share' && (
          <>
            <label className="mt-3 block text-xs">
              Species share
              <select
                aria-label="Species share"
                className="mt-1 w-full rounded border bg-background p-2"
                value={options.speciesCode}
                onChange={(e) => set({ speciesCode: e.target.value })}
              >
                {Object.entries(data.species).map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} · {name}
                  </option>
                ))}
              </select>
            </label>
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
          <label className="mt-3 block text-xs">
            Composition to compare
            <select
              aria-label="Species comparison metric"
              className="mt-1 w-full rounded border bg-background p-2"
              value={options.speciesCompare}
              onChange={(e) => set({ speciesCompare: e.target.value })}
            >
              <option value="broadleaf">Broadleaf · EP + AT + AC</option>
              {Object.entries(data.species).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} · {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="mt-3 block text-xs">
          Filter by leading inventory species
          <select
            aria-label="Leading species filter"
            className="mt-1 w-full rounded border bg-background p-2"
            value={options.speciesFilter}
            onChange={(e) => set({ speciesFilter: e.target.value })}
          >
            <option value="all">All · include unknown context</option>
            {Object.entries(data.species).map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
          </select>
        </label>
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
            <p className="mt-2 text-[10px] text-muted-foreground">
              Low height may represent shrubs, lawns, openings or young trees. No regeneration age, survival or stocking
              is inferred. Review imagery and visit the site.
            </p>
          </>
        )}
        {isPlot && (
          <>
            <label className="mt-3 block text-xs">
              Structure metric
              <select
                aria-label="Species structure metric"
                className="mt-1 w-full rounded border bg-background p-2"
                value={options.speciesStructureMetric}
                onChange={(e) =>
                  set({ speciesStructureMetric: e.target.value as WorkflowOptions['speciesStructureMetric'] })
                }
              >
                <option value="height">Surface P95 height</option>
                <option value="density">Canopy cover above 5 m</option>
                <option value="texture">Mean 5 m surface texture</option>
                <option value="layers">Return-height dispersion</option>
              </select>
            </label>
            <label className="mt-3 block text-xs">
              Map colour
              <select
                aria-label="Species structure map colour"
                className="mt-1 w-full rounded border bg-background p-2"
                value={options.speciesColour}
                onChange={(e) => onOptions({ speciesColour: e.target.value as 'species' | 'metric' })}
              >
                <option value="species">Leading inventory species</option>
                <option value="metric">Selected LiDAR metric</option>
              </select>
            </label>
            <p className="mt-2 text-[10px] text-muted-foreground">
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
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              {Object.entries(SPECIES_COLOURS).map(([code, colour]) => (
                <span key={code} className="flex items-center gap-1">
                  <i className="size-3 shrink-0 rounded" style={{ backgroundColor: colour }} />
                  {code} · {data.species[code]}
                </span>
              ))}
              <span>Grey · unknown / unlabelled</span>
            </div>
          ) : (
            <>
              <div
                className="h-2 rounded"
                style={{ background: `linear-gradient(to right,${legend.colors.join(',')})` }}
              />
              <div className="mt-1 flex justify-between text-[10px]">
                <span>
                  {legend.min}
                  {legend.unit}
                </span>
                <span>
                  {legend.max}
                  {legend.unit}
                </span>
              </div>
              <p className="mt-1 text-[10px]">{legend.label} · grey: unavailable</p>
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
          <p className="mt-2 text-[10px] text-muted-foreground">
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
          <p className="mt-2 text-[10px]">
            Return proportions describe laser returns; they do not measure vegetation volume or biodiversity.
          </p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => onPoints(plot)}>
            Inspect original 3D points
          </Button>
          <Button className="mt-3 ml-2" size="sm" variant="outline" onClick={() => onSelect(plot.id)}>
            Focus selected plot
          </Button>
        </SidebarSection>
      )}
      {stand && (
        <SidebarSection title={stand.id} subtitle="Selected inventory stand · recorded mixture">
          <div className="flex h-4 overflow-hidden rounded" aria-label="Recorded species composition">
            {composition(stand.composition).map(([code, value]) => (
              <div
                key={code}
                title={`${data.species[code]} ${value}%`}
                style={{ width: `${value}%`, backgroundColor: SPECIES_COLOURS[code] }}
              />
            ))}
          </div>
          <div className="mt-2 space-y-1">
            {data.species_order.map((code) => (
              <div key={code} className="flex justify-between gap-1 text-[10px]">
                <span className="flex items-center gap-1">
                  <i className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: SPECIES_COLOURS[code] }} />
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
        {!features.length && <p className="text-xs">No matches. Adjust the filters to broaden the search.</p>}
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
        <div className="flex h-3 overflow-hidden rounded">
          {composition(data.area_weighted_inventory_index).map(([code, value]) => (
            <div key={code} style={{ width: `${value}%`, backgroundColor: SPECIES_COLOURS[code] }} />
          ))}
        </div>
        {composition(data.area_weighted_inventory_index).map(([code, value]) => (
          <p key={code} className="mt-1 text-xs">
            {code} · {data.species[code]}: {value.toFixed(1)}%
          </p>
        ))}
        <p className="mt-2 text-[10px] text-muted-foreground">
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
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          The model does not beat the broadleaf baseline. Differences are disagreement with historical inventory, not
          proven inventory errors or calibrated uncertainty. Geographic transfer and independent field accuracy remain
          unvalidated. No species-model retraining occurs when changing views or saving notes.
        </p>
        <a href={speciesUrl} download="species-model-experiment.json" className="mt-3 block text-xs underline">
          Download predictions, folds & provenance
        </a>
        <a href={contextUrl} download="species-plot-context.json" className="mt-2 block text-xs underline">
          Download plot links & review coordinates
        </a>
        <a
          href="https://github.com/ahzs645/PGMaps/blob/codex/lidar-explorer/docs/research/lidar-species.md"
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-xs underline"
        >
          Methods, interpretation & rerun ↗
        </a>
      </SidebarSection>
    </>
  )
}
