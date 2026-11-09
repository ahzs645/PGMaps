import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
import { ExternalLink } from '@/components/ui/text-button'
import { Download } from 'lucide-react'
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
      <div className="flex flex-col items-start gap-2">
        {links.map(([url, label]) => (
          <Button key={url} asChild size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal text-left">
            <a href={url} download>
              <Download className="size-3.5" aria-hidden="true" />
              {label}
            </a>
          </Button>
        ))}
        <ExternalLink
          href={`https://github.com/ahzs645/PGMaps/blob/codex/lidar-explorer/docs/research/${model ? 'lidar-building-inspection' : isSpeciesMode(mode) ? 'lidar-species' : isHeatmapMode(mode) ? 'lidar-tree-isolation-and-detail' : 'lidar-forestry-explorer'}.md`}
        >
          Methods and rerun instructions
        </ExternalLink>
      </div>
      <p className="mt-3 text-3xs leading-4 text-muted-foreground">
        {model
          ? 'Roofer used height-screened points within unverified patches. Review decisions are browser-local and do not change model geometry.'
          : 'Original LiDAR classifications contain no building or vegetation classes. Results retain source provenance and remain exploratory.'}
      </p>
    </SidebarSection>
  )
}
