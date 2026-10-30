import { useEffect, useRef, useState } from 'react'
import { ClipboardCheck, HardHat, Mountain, Route, SlidersHorizontal } from 'lucide-react'
import { TabBar } from '@/components/ui/tab-bar'
import { EngineeringControls } from './EngineeringControls'
import { DesignTab } from './sidebar/DesignTab'
import { ReviewTab } from './sidebar/ReviewTab'
import { SectionTab } from './sidebar/SectionTab'
import { TerrainTab } from './sidebar/TerrainTab'
import { ExistingRoadsPanel } from './ExistingRoadsPanel'
import type { RoadOptimizationObjective } from './corridorOptimizer'
import type { RouteSearchOptions } from './routing'
import type { DrawMode } from './PlanView'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { Alignment, ContextFeature, Coordinate, RoadTemplate, TerrainSource } from './types'

export type FileKind = 'project' | 'terrain' | 'alignment' | 'context' | 'breaklines'
export interface PointCloudChoice {
  classify: boolean | 'auto'
  surface: 'mean' | 'tin'
  preserveCorridorM?: number
  retainTin?: boolean
}
export interface SidebarProps {
  workspace: RoadWorkspace
  onCompareCompleteCosts?: () => void
  readOnlyPreview?: boolean
  workflowTab?: SidebarTab
  onWorkflowTabChange?: (tab: SidebarTab) => void
  roadReviewRequest?: { id?: string; sequence: number }
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
  onPreviewRoute?: (options: RouteSearchOptions | null) => void
  onConnectFsr?: (
    options: RouteSearchOptions,
    preference: 'nearest' | 'lowest-cost',
    endpoint: 'start' | 'end',
    terrain?: 'current' | 'regional',
    targetFeatureId?: string,
  ) => void
  onDiscoverFsrs?: (endpoint: 'start' | 'end') => void
  onPreviewFsrTarget?: (featureId: string | null, endpoint: 'start' | 'end') => void
  fsrDiscovery?: { guide: Alignment; source: TerrainSource; origin: Coordinate; scope: string } | null
  onLocateRoad?: (road: ContextFeature) => void
  onReviewRoad?: (road: ContextFeature | null) => void
  onShowExistingRoads?: () => void
  onShowEngineering?: () => void
  templatePreviewActive?: boolean
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
  const [internalTab, setInternalTab] = useState<SidebarTab>('design')
  const tab = p.workflowTab ?? internalTab
  const setTab = (next: SidebarTab) => {
    setInternalTab(next)
    p.onWorkflowTabChange?.(next)
  }
  const [aggregateOpen, setAggregateOpen] = useState(false)
  const existingRoads = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (p.roadReviewRequest) requestAnimationFrame(() => existingRoads.current?.scrollIntoView({ block: 'start' }))
  }, [p.roadReviewRequest])
  const showExistingRoads = () => {
    setTab('terrain')
    requestAnimationFrame(() => existingRoads.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  return (
    <aside
      aria-label="Road design controls"
      className="road-design-sidebar flex h-full min-h-0 min-w-0 flex-col rounded-xl border bg-card"
    >
      <fieldset disabled={!!p.workspace.busy || p.readOnlyPreview} className="contents">
        <div className="border-b p-1.5">
          <TabBar
            label="Road workflow"
            value={tab}
            onChange={setTab}
            stretch
            stacked
            getTabProps={(option) => ({ title: option.label })}
            options={[
              { value: 'terrain', label: 'Terrain', icon: Mountain },
              { value: 'design', label: 'Design', icon: Route },
              { value: 'template', label: 'Section', icon: SlidersHorizontal },
              { value: 'engineering', label: 'Engineering', icon: HardHat },
              { value: 'review', label: 'Review', icon: ClipboardCheck },
            ]}
          />
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain" data-testid="road-sidebar-content">
          <div hidden={tab !== 'terrain'}>
            <TerrainTab {...p} />
            <div ref={existingRoads}>
              <ExistingRoadsPanel
                key={p.roadReviewRequest?.sequence ?? 0}
                initialSelectedRoadId={p.roadReviewRequest?.id}
                workspace={p.workspace}
                onLocateRoad={p.onLocateRoad}
                onReviewRoad={tab === 'terrain' ? p.onReviewRoad : undefined}
              />
            </div>
          </div>
          <div hidden={tab !== 'design'}>
            <DesignTab
              {...p}
              onPreviewFsrTarget={tab === 'design' ? p.onPreviewFsrTarget : undefined}
              onShowExistingRoads={showExistingRoads}
              onShowEngineering={() => {
                setTab('engineering')
                setAggregateOpen(true)
              }}
            />
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
              previewActive={p.templatePreviewActive}
              aggregateOpen={aggregateOpen}
              onAggregateOpenChange={setAggregateOpen}
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
