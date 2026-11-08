import { useEffect, useRef, useState } from 'react'
import { ClipboardCheck, HardHat, Mountain, Route, SlidersHorizontal } from 'lucide-react'
import { TabBar } from '@/components/ui/tab-bar'
import { EngineeringControls } from './EngineeringControls'
import { StreamCrossingsPanel } from './StreamCrossingsPanel'
import { DesignTab } from './sidebar/DesignTab'
import { ReviewTab } from './sidebar/ReviewTab'
import { SectionTab } from './sidebar/SectionTab'
import { TerrainTab } from './sidebar/TerrainTab'
import { ExistingRoadsPanel } from './ExistingRoadsPanel'
import type { RoadOptimizationObjective } from './corridorOptimizer'
import type { RouteSearchOptions } from './routing'
import type { BlockAccessState } from './BlockAccessPanel'
import type { RoutePreviewLine } from './RouteFinder'
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
  onPlanNetwork?: () => void
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
  onPreviewRoutes?: (lines: RoutePreviewLine[] | null) => void
  /** Block access: proposed roads from a harvest block to nearby FSRs, previewed on the plan. */
  blockAccess?: BlockAccessState | null
  onFindBlockAccess?: (blockId: string) => void
  onSelectBlockAccess?: (index: number) => void
  onAdoptBlockAccess?: () => void
  onClearBlockAccess?: () => void
  onDrawBlock?: () => void
  onShowCompare?: () => void
  onShowDrainage?: () => void
  onSelectRoad?: (id: string) => void
  onShowCulverts?: (chainage?: number) => void
  /** The saved drainage check no longer matches the road, its culverts or the terrain. */
  drainageStale?: boolean
  /** Rises each time the culvert inputs are asked for. */
  engineeringRequest?: number
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
  onOpenRoadHistory?: (id: string) => void
  /** Shows a constraint on the plan; the sidebar marks `focusedConstraintId` as the one shown. */
  onLocateConstraint?: (area: ContextFeature) => void
  focusedConstraintId?: string | null
  cutblockReviewRequest?: { id: string; sequence: number }
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
  const [existingRoadsOpen, setExistingRoadsOpen] = useState(false)
  const existingRoads = useRef<HTMLDivElement>(null)
  const [reviewRequest, setReviewRequest] = useState(p.roadReviewRequest)
  if (p.roadReviewRequest !== reviewRequest) {
    setReviewRequest(p.roadReviewRequest)
    if (p.roadReviewRequest) setExistingRoadsOpen(true)
  }
  useEffect(() => {
    if (p.roadReviewRequest) requestAnimationFrame(() => existingRoads.current?.scrollIntoView({ block: 'start' }))
  }, [p.roadReviewRequest])
  const showExistingRoads = () => {
    setTab('terrain')
    setExistingRoadsOpen(true)
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
        {/* A stable gutter: opening a section must not bring in a scrollbar that narrows and shifts everything. */}
        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
          data-testid="road-sidebar-content"
          data-map-sidebar-scroll="true"
        >
          <div hidden={tab !== 'terrain'}>
            <TerrainTab
              {...p}
              existingRoads={
                <div ref={existingRoads}>
                  <ExistingRoadsPanel
                    key={p.roadReviewRequest?.sequence ?? 0}
                    initialSelectedRoadId={p.roadReviewRequest?.id}
                    workspace={p.workspace}
                    onLocateRoad={p.onLocateRoad}
                    onReviewRoad={tab === 'terrain' ? p.onReviewRoad : undefined}
                    open={existingRoadsOpen}
                    onOpenChange={setExistingRoadsOpen}
                  />
                </div>
              }
            />
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
            <StreamCrossingsPanel workspace={p.workspace} />
            <EngineeringControls
              workspace={p.workspace}
              onPreviewTemplate={p.onPreviewTemplate}
              onClosePreview={p.onCloseTemplatePreview}
              onQuantities={p.onQuantities}
              previewActive={p.templatePreviewActive}
              aggregateOpen={aggregateOpen}
              onAggregateOpenChange={setAggregateOpen}
              culvertRequest={p.engineeringRequest}
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
