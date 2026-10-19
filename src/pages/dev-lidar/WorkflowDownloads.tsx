import { SidebarSection } from '@/components/ui/map-panels'
import type { AnalysisMode } from './analysisWorkflows'
import { isHeatmapMode } from './canopyHeatmaps'
import { isForestMode } from './forestry'
import { isSpeciesMode } from './species'
import { cityJsonUrl, contextUrl, forestUrl, heatmapUrl, modelUrl, speciesUrl, workflowUrl } from './useWorkflowData'
export function WorkflowDownloads({ mode }: { mode: AnalysisMode | null }) {
  const model = mode === 'models'
  const links = model
    ? [
        [modelUrl, 'Models, triangles and run provenance'],
        [cityJsonUrl, 'Roofer CityJSONSequence · LoD1.2 + LoD2.2'],
      ]
    : isSpeciesMode(mode)
      ? [
          [speciesUrl, 'Species inventory and held-out experiment'],
          [contextUrl, 'Source-checked species plot context'],
        ]
      : isHeatmapMode(mode)
        ? [[heatmapUrl, 'Canopy heatmap products']]
        : isForestMode(mode)
          ? [[forestUrl, 'Forestry profiles, texture and edge products']]
          : [[workflowUrl, 'Gap, plot and proximity products']]
  return (
    <SidebarSection title="Reproduce & download">
      <div className="space-y-2 text-xs underline">
        {links.map(([url, label]) => (
          <a key={url} className="block" href={url} download>
            {label}
          </a>
        ))}
        <a
          className="block"
          href={`https://github.com/ahzs645/PGMaps/blob/codex/lidar-explorer/docs/research/${model ? 'lidar-building-inspection' : isSpeciesMode(mode) ? 'lidar-species' : isHeatmapMode(mode) ? 'lidar-tree-isolation-and-detail' : 'lidar-forestry-explorer'}.md`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Methods and rerun instructions ↗
        </a>
      </div>
      <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
        {model
          ? 'Roofer used height-screened points within unverified patches. Review decisions are browser-local and do not change model geometry.'
          : 'Original LiDAR classifications contain no building or vegetation classes. Results retain source provenance and remain exploratory.'}
      </p>
    </SidebarSection>
  )
}
