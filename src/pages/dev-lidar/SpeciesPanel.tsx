import { Button } from '@/components/ui/button'
import { SidebarSection, KeyValueRows } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ResultRow } from '@/components/ui/result-list'
import { downloadText } from '@/lib/download'
import { speciesUrl } from './useWorkflowData'
import type { AnalysisMode, WorkflowOptions } from './analysisWorkflows'
import type { SpeciesData } from './species'
export function SpeciesPanel({
  data,
  options,
  selectedId,
  onMode,
  onSelect,
}: {
  data: SpeciesData
  options: WorkflowOptions
  selectedId: string | null
  onMode: (mode: AnalysisMode) => void
  onSelect: (id: string) => void
}) {
  const experiment = data.experiment
  const selected = data.stands.features.find((f) => f.properties.id === selectedId)?.properties
  const model = options.mode === 'species-model'
  const better = experiment.model.broadleaf_mae_pp < experiment.baseline.broadleaf_mae_pp
  const composition = (values: Record<string, number>) =>
    Object.entries(values)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
  return (
    <>
      <SidebarSection title="Species mix" subtitle="Inventory context + experimental LiDAR model">
        <SegmentedControl
          value={options.mode as 'species' | 'species-model'}
          options={[
            { value: 'species', label: 'Inventory' },
            { value: 'species-model', label: 'Held-out model' },
          ]}
          onChange={onMode}
          label="Species mix source"
          size="sm"
        />
        <p className="mt-3 text-xs leading-5">
          {model
            ? 'Colours show experimental broadleaf composition inferred from LiDAR. Every coloured stand was excluded from its model’s training. Grey stands had no eligible validation plots.'
            : 'Colours show broadleaf composition recorded in BC VRI. Click a stand for all recorded species. These labels come from inventory, not identification of individual LiDAR trees.'}
        </p>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Purple: conifer-rich · green: broadleaf-rich · grey: unavailable. Inventory percentages describe recorded
          stand composition; they are not canopy density or a count of trees.
        </p>
        <KeyValueRows
          size="sm"
          rows={[
            { label: 'Labelled supported area', value: `${(data.coverage.labelled_m2 / 10000).toFixed(1)} ha` },
            { label: 'Other / unlabelled area', value: `${(data.coverage.other_m2 / 10000).toFixed(1)} ha` },
            { label: 'Unmapped area', value: `${(data.coverage.unmapped_m2 / 10000).toFixed(1)} ha` },
            { label: 'Inventory retrieved', value: data.inventory_metadata.retrieved_utc },
          ]}
        />
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() =>
            downloadText(JSON.stringify(data.stands), 'vri-species-context.geojson', 'application/geo+json')
          }
        >
          Download inventory GeoJSON
        </Button>
      </SidebarSection>
      <SidebarSection
        title="Area-weighted inventory index"
        subtitle="Species proportions weighted by labelled stand area"
      >
        {composition(data.area_weighted_inventory_index).map(([code, value]) => (
          <div key={code} className="mb-2 text-xs">
            <div className="flex justify-between">
              <span>
                {data.species[code]} · {code}
              </span>
              <span>{value.toFixed(1)}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-muted">
              <div className="h-full rounded bg-emerald-600" style={{ width: `${value}%` }} />
            </div>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground">
          An area-weighted inventory summary, not the measured fraction of trees, basal area, biomass or species cover
          across this tile.
        </p>
      </SidebarSection>
      <SidebarSection title="Model experiment" subtitle="Random forest · weak inventory labels · whole-stand holdouts">
        <p className="text-xs">
          {experiment.plots} plots / {experiment.stands} stands. Canopy structure predicts the seven recorded species
          percentages; no coordinates or inventory attributes enter the model.
        </p>
        <KeyValueRows
          size="sm"
          rows={[
            {
              label: 'Broadleaf error / baseline',
              value: `${experiment.model.broadleaf_mae_pp.toFixed(1)} / ${experiment.baseline.broadleaf_mae_pp.toFixed(1)} pp`,
            },
            {
              label: 'Mean species error / baseline',
              value: `${experiment.model.species_mae_pp.toFixed(1)} / ${experiment.baseline.species_mae_pp.toFixed(1)} pp`,
            },
          ]}
        />
        <p className="mt-2 text-xs">
          {better
            ? 'The model improves on the training-stand mean for broadleaf composition in this experiment.'
            : 'The model does not beat the training-stand mean for broadleaf composition. Keep the inventory view as the useful context.'}
        </p>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Errors are mean absolute differences in percentage points, averaged equally across held-out stands. This tests
          agreement with VRI, not field accuracy. Adjacent stands still share local conditions. One tile and historical
          photo-interpreted labels cannot establish transfer to another forest or reliable tree species identification.
        </p>
        <a href={speciesUrl} download="species-model-experiment.json" className="mt-3 block text-xs underline">
          Download predictions, folds & provenance
        </a>
      </SidebarSection>
      {selected && (
        <SidebarSection title={selected.id} subtitle="Selected inventory stand">
          <KeyValueRows
            size="sm"
            rows={[
              { label: 'Supported intersection', value: `${(selected.area_m2 / 10000).toFixed(2)} ha` },
              { label: 'Reference year', value: String(selected.reference_year ?? 'Unknown') },
              { label: 'Interpretation date', value: selected.interpretation_date?.slice(0, 10) ?? 'Unknown' },
              { label: 'Projected date', value: selected.projected_date?.slice(0, 10) ?? 'Unknown' },
              {
                label: 'Broadleaf inventory',
                value:
                  selected.broadleaf_percent === null ? 'Unavailable' : `${selected.broadleaf_percent.toFixed(1)}%`,
              },
              {
                label: 'Held-out model',
                value: selected.model
                  ? `${selected.model.broadleaf_percent.toFixed(1)}% · ${selected.model.plots} plots`
                  : 'No eligible validation plots',
              },
            ]}
          />
          {composition(selected.composition).map(([code, value]) => (
            <p key={code} className="mt-1 text-xs">
              {code} · {data.species[code]}: {value}%
              {selected.model
                ? ` · model ${selected.model.predicted[data.species_order.indexOf(code)].toFixed(1)}%`
                : ''}
            </p>
          ))}
          <Button size="sm" variant="outline" className="mt-3" onClick={() => onSelect(selected.id)}>
            Focus selected stand
          </Button>
        </SidebarSection>
      )}
      <SidebarSection
        title="Inventory stands"
        subtitle={`${data.stands.features.length} intersections · select to inspect`}
      >
        {data.stands.features.map((f) => (
          <ResultRow
            key={f.properties.id}
            title={f.properties.id}
            subtitle={
              f.properties.labelled
                ? `${f.properties.leading} leading · ${(f.properties.area_m2 / 10000).toFixed(2)} ha`
                : 'Other / unlabelled inventory'
            }
            selected={selectedId === f.properties.id}
            onClick={() => onSelect(f.properties.id)}
          />
        ))}
      </SidebarSection>
      <SidebarSection title="How to improve species modelling">
        <p className="text-xs leading-5">
          Pair labelled field plots or reviewed crowns with normalized LiDAR, then add co-registered leaf-on imagery or
          multispectral data. Use geographic holdouts and report per-species errors before mapping a new area.
        </p>
        <div className="mt-3 space-y-2 text-xs underline">
          <a className="block" href="https://huggingface.co/datasets/IGNF/PureForest" target="_blank" rel="noreferrer">
            PureForest · airborne stand classification ↗
          </a>
          <a className="block" href="https://github.com/stefp/FOR-species20K" target="_blank" rel="noreferrer">
            FOR-species20K · segmented individual trees ↗
          </a>
          <a className="block" href={data.inventory_metadata.catalogue} target="_blank" rel="noreferrer">
            BC VRI source & licence ↗
          </a>
          <a
            className="block"
            href="https://github.com/ahzs645/PGMaps/blob/codex/lidar-explorer/docs/research/lidar-species.md"
            target="_blank"
            rel="noreferrer"
          >
            Methods, model suitability & rerun ↗
          </a>
        </div>
      </SidebarSection>
    </>
  )
}
