import { useState } from 'react'
import { ClipboardCheck, HardHat, Mountain, Route, SlidersHorizontal } from 'lucide-react'
import { TabBar } from '@/components/ui/tab-bar'
import { EngineeringControls } from './EngineeringControls'
import { DesignTab } from './sidebar/DesignTab'
import { ReviewTab } from './sidebar/ReviewTab'
import { SectionTab } from './sidebar/SectionTab'
import { TerrainTab } from './sidebar/TerrainTab'
import type { RoadOptimizationObjective } from './corridorOptimizer'
import type { RouteSearchOptions } from './routing'
import type { DrawMode } from './PlanView'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { RoadTemplate } from './types'

export type FileKind = 'project' | 'terrain' | 'alignment' | 'context' | 'breaklines'
export interface PointCloudChoice {
  classify: boolean | 'auto'
  surface: 'mean' | 'tin'
}
export interface SidebarProps {
  workspace: RoadWorkspace
  mode: DrawMode
  onMode: (mode: DrawMode) => void
  onFile: (kind: FileKind) => void
  onTerrain: (kind: 'lidar' | 'regional' | 'demo') => void
  verticalReference: string
  onVerticalReference: (value: string) => void
  pointCloud: PointCloudChoice
  onPointCloud: (choice: PointCloudChoice) => void
  /** Name of the loaded breakline file, used by the next TIN import. */
  breaklines: string | null
  onClearBreaklines: () => void
  selectedPoint: string | null
  onPoint: (id: string | null) => void
  onDuplicate: () => void
  onRemoveAlignment: () => void
  onSuggest: (options: RouteSearchOptions) => void
  onOptimize: (objective: RoadOptimizationObjective, corridorHalfWidthM: number) => void
  onProfile: (id: string) => void
  activeProfile: string | null
  onPreviewTemplate: (template: RoadTemplate, name: string) => void
  onCloseTemplatePreview: () => void
  onQuantities: () => void
}
export type SidebarTab = 'terrain' | 'design' | 'template' | 'engineering' | 'review'

/** The road workflow's tab strip; each tab's panel stays mounted and is `hidden` when not shown. */
export function DesignSidebar(p: SidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('design')
  return (
    <aside aria-label="Road design controls" className="flex h-full min-h-0 min-w-0 flex-col rounded-xl border bg-card">
      <fieldset disabled={!!p.workspace.busy} className="contents">
        <div className="border-b p-1.5">
          <TabBar
            label="Road workflow"
            value={tab}
            onChange={setTab}
            stretch
            stacked
            options={[
              { value: 'terrain', label: 'Terrain', icon: Mountain },
              { value: 'design', label: 'Design', icon: Route },
              { value: 'template', label: 'Section', icon: SlidersHorizontal },
              { value: 'engineering', label: 'Engineering', icon: HardHat },
              { value: 'review', label: 'Review', icon: ClipboardCheck },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div hidden={tab !== 'terrain'}>
            <TerrainTab {...p} />
          </div>
          <div hidden={tab !== 'design'}>
            <DesignTab {...p} />
          </div>
          <div hidden={tab !== 'template'}>
            <SectionTab {...p} onTab={setTab} />
          </div>
          <div hidden={tab !== 'engineering'}>
            <EngineeringControls
              workspace={p.workspace}
              onPreviewTemplate={p.onPreviewTemplate}
              onClosePreview={p.onCloseTemplatePreview}
              onQuantities={p.onQuantities}
            />
          </div>
          <div hidden={tab !== 'review'}>
            <ReviewTab {...p} onTab={setTab} />
          </div>
        </div>
      </fieldset>
    </aside>
  )
}
