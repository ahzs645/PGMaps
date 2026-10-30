import { NativeSelect } from '@/components/ui/form-field'
import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
import { useRef } from 'react'
import { CanopyHeatmapPanel } from './CanopyHeatmapPanel'
import { ForestryPanel } from './ForestryPanel'
import { ScreeningPanel } from './ScreeningPanel'
import { SpeciesPanel } from './SpeciesPanel'
import { TreeIsolationPanel, type TreePanelData } from './TreeIsolationPanel'
import { WorkflowDownloads } from './WorkflowDownloads'
import {
  ANALYSIS_MODES,
  type AnalysisMode,
  type BuildingModel,
  type ModelData,
  type WorkflowData,
  type WorkflowFeature,
  type WorkflowOptions,
} from './analysisWorkflows'
import { isHeatmapMode, type CanopyHeatmaps } from './canopyHeatmaps'
import { isForestMode, type ForestData, type ForestProperties } from './forestry'
import { isSpeciesMode, type SpeciesContext, type SpeciesData } from './species'
import type { CrownFeature } from './treeIsolation'

export interface WorkflowPanelProps {
  allowedModes?: AnalysisMode[]
  treeProduct?: TreePanelData
  selectedCrown?: CrownFeature | null
  onIsolateTree?: () => void
  onAllTrees?: () => void
  data: {
    workflows: WorkflowData
    models: ModelData
    forestry: ForestData
    heatmaps: CanopyHeatmaps
    species: SpeciesData
    speciesContext: SpeciesContext
  } | null
  error: string
  retry: () => void
  options: WorkflowOptions
  features: WorkflowFeature[]
  selected: WorkflowFeature | null
  model: BuildingModel | null
  meshVisible: boolean
  onMeshVisible: (visible: boolean) => void
  onMode: (mode: AnalysisMode) => void
  onOptions: (options: Partial<WorkflowOptions>) => void
  onSelect: (id: string) => void
  onPoints: () => void
  onForestPoints: (plot: ForestProperties) => void
}
export function WorkflowPanel(props: WorkflowPanelProps) {
  const { data, options, features, selected } = props
  const modes = props.allowedModes
    ? props.allowedModes.map((id) => ANALYSIS_MODES.find((m) => m.id === id)!).filter(Boolean)
    : ANALYSIS_MODES
  const root = useRef<HTMLDivElement>(null)
  const choose = (id: string) => {
    props.onSelect(id)
    root.current?.closest<HTMLElement>('[data-map-sidebar-scroll]')?.scrollTo({ top: 0 })
  }
  return (
    <div ref={root}>
      <SidebarSection title="Workspace analysis" subtitle="Processed from your tile · selectable parameters">
        <label className="block text-xs">
          <span className="sr-only">LiDAR workflow</span>
          <NativeSelect
            aria-label="LiDAR workflow"
            value={options.mode ?? ''}
            onChange={(event) => props.onMode(event.target.value as AnalysisMode)}
            className="h-9 w-full rounded border bg-background px-2 text-xs"
          >
            <option value="" disabled>
              Choose an analysis…
            </option>
            {modes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Map context and overlays follow the selected workflow.
        </p>
        {!data && options.mode !== 'trees' && (
          <p className="mt-3 text-xs" role="status">
            {props.error || 'Loading and checking workflow products…'}
          </p>
        )}
        {props.error && (
          <Button size="sm" variant="outline" onClick={props.retry}>
            Retry
          </Button>
        )}
      </SidebarSection>
      {options.mode === 'trees' && props.treeProduct && (
        <TreeIsolationPanel
          product={props.treeProduct}
          options={options}
          features={features}
          selected={props.selectedCrown ?? null}
          onOptions={props.onOptions}
          onSelect={choose}
          onIsolate={props.onIsolateTree!}
          onAll={props.onAllTrees!}
        />
      )}
      {data && isSpeciesMode(options.mode) && (
        <SpeciesPanel
          data={data.species}
          forest={data.forestry}
          context={data.speciesContext}
          features={features}
          onOptions={props.onOptions}
          onPoints={props.onForestPoints}
          options={options}
          selectedId={selected?.properties.id ?? null}
          onMode={props.onMode}
          onSelect={choose}
        />
      )}
      {data && isHeatmapMode(options.mode) && (
        <CanopyHeatmapPanel data={data.heatmaps} options={options} onOptions={props.onOptions} onMode={props.onMode} />
      )}
      {data && isForestMode(options.mode) && (
        <ForestryPanel
          data={data.forestry}
          options={options}
          features={features}
          selectedId={selected?.properties.id ?? null}
          onOptions={props.onOptions}
          onSelect={choose}
          onPoints={props.onForestPoints}
        />
      )}
      <ScreeningPanel props={props} choose={choose} />
      {data && options.mode !== 'trees' && <WorkflowDownloads mode={options.mode} />}
    </div>
  )
}
