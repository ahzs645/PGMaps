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
import type { RoutePreviewLine } from './RouteFinder'
import type { DrawMode } from './PlanView'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { ContextFeature, Coordinate, RoadTemplate } from './types'
import type { AccessHistorySelection } from './AccessHistorySelection'

export type FileKind =
  | 'project'
  | 'terrain'
  | 'breaklines'
  /** Spatial files: road lines, the streams import, cutblocks, existing roads, reference layers. */
  | 'alignment'
  | 'context'
  | 'cutblocks'
  | 'mapped-roads'
  | 'reference'
export interface PointCloudChoice {
  classify: boolean | 'auto'
  surface: 'mean' | 'tin'
  preserveCorridorM?: number
  retainTin?: boolean
}
export interface RoadDrawing {
  /** A new road, or more points on the active one. */
  kind: 'road' | 'extend'
  points: number
  /** False until the line has enough points to keep. */
  canFinish: boolean
  onFinish: () => void
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
  /**
   * The road line being pegged on the plan, when one is. Until it is finished the plan, profile and
   * header show it while the project still holds the saved road, so a search has to wait for it.
   */
  drawing?: RoadDrawing | null
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
  /** Loads a mapped road from context as a road whose formation follows the ground. */
  onLoadMappedRoad?: (featureId: string) => void
  /** Loads every mapped road with a part in the plan's view, each as its own road. */
  onLoadMappedRoadsInView?: () => void
  /** Copies the active mapped road as an editable design on the same line. */
  onCopyMappedRoad?: () => void
  /** Fits the plan to the active road. */
  onLocateActiveRoad?: () => void
  /** Loads regional terrain over the active road's extent. */
  onLoadTerrainAroundRoad?: () => void
  onRemoveAlignment: () => void
  onSuggest: (options: RouteSearchOptions) => void
  onPreviewRoute?: (options: RouteSearchOptions | null) => void
  onPreviewRoutes?: (lines: RoutePreviewLine[] | null) => void
  onDrawBlock?: () => void
  /**
   * Asks the plan for one click: shows `prompt` and hands the clicked point to `onPick`. A null
   * prompt cancels a pending pick.
   */
  onPickOnPlan?: (prompt: string | null, onPick?: (at: Coordinate) => void) => void
  /** Loads active FSRs around a point when the source needs them; resolves to the context to search. */
  onLoadFsrsNear?: (
    at: Coordinate,
    signal: AbortSignal,
  ) => Promise<{ context: ContextFeature[]; scope: string } | undefined>
  /** Points the access review shows on the plan: its end and the junctions it would start from. */
  onPreviewAccessMarks?: (marks: import('./AccessReviewPanel').AccessMark[] | null) => void
  onShowCompare?: () => void
  onShowDrainage?: () => void
  onSelectRoad?: (id: string) => void
  onShowCulverts?: (chainage?: number) => void
  /** Opens the design vehicle's swept-path view. */
  onShowSwept?: () => void
  /** The swept-path result for the active road, reduced for the Review list; null when none was run. */
  vehicleFit?: import('./readiness').VehicleFit | null
  /** The saved drainage check no longer matches the road, its culverts or the terrain. */
  drainageStale?: boolean
  /** Rises each time the culvert inputs are asked for. */
  engineeringRequest?: number
  onLocateRoad?: (road: ContextFeature) => void
  onOpenRoadHistory?: (id: string) => void
  /** Shows a constraint on the plan; the sidebar marks `focusedConstraintId` as the one shown. */
  onLocateConstraint?: (area: ContextFeature) => void
  /** Fits a saved historical path or structure without changing current road reuse. */
  onLocateHistory?: (coordinates: Coordinate[]) => void
  historySelection?: AccessHistorySelection
  onInspectHistoryRecord?: (kind: 'road' | 'structure', id: string) => void
  onSelectHistoryBlock?: (id: string) => void
  focusedConstraintId?: string | null
  /** Reads a spatial file a panel's own picker was given; the intent says what that picker is for. */
  onImportSpatial?: (file: File, intent: import('./spatialImport').ImportIntent) => void
  /** Asks for a CRS or vertical datum a terrain file does not state; null when the question is cancelled. */
  onAskTerrain?: (
    needs: import('./terrain').TerrainImportNeeds,
  ) => Promise<import('./terrain').TerrainImportAnswers | null>
  /** Shows a reference feature on the plan; the sidebar marks `focusedReferenceId` as the one shown. */
  onLocateReference?: (feature: import('./referenceFeatures').ReferenceFeature) => void
  focusedReferenceId?: string | null
  /** Starts pegging a road at a named point, or pegs the point next while a road is being pegged. */
  onPegAt?: (at: Coordinate, name: string) => void
  /** Moves the active road's start or end onto a named point. */
  onRoadEndAt?: (at: Coordinate, name: string, end: 'start' | 'end') => void
  cutblockReviewRequest?: { id: string; sequence: number }
  onReviewRoad?: (road: ContextFeature | null, picked?: boolean) => void
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
  // A template created from the Section tab opens in the library editor on the Engineering tab.
  const [templateRequest, setTemplateRequest] = useState<{ id: string; sequence: number }>()
  const [inputsRequest, setInputsRequest] = useState<{ tab: 'templates' | 'materials' | 'haul'; sequence: number }>()
  const showEngineeringInputs = (inputs: 'templates' | 'materials' | 'haul') => {
    setTab('engineering')
    setAggregateOpen(false)
    setInputsRequest((previous) => ({ tab: inputs, sequence: (previous?.sequence ?? 0) + 1 }))
  }
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
                    onImportFile={p.onImportSpatial ? (file) => p.onImportSpatial!(file, 'mapped-road') : undefined}
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
              onShowExistingRoads={showExistingRoads}
              onShowEngineering={() => {
                setTab('engineering')
                setAggregateOpen(true)
              }}
            />
          </div>
          <div hidden={tab !== 'template'}>
            <SectionTab
              {...p}
              onTab={setTab}
              onOpenTemplate={(id) => {
                setAggregateOpen(false)
                setTemplateRequest((previous) => ({ id, sequence: (previous?.sequence ?? 0) + 1 }))
                setTab('engineering')
              }}
            />
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
              templateRequest={templateRequest}
              inputsRequest={inputsRequest}
              onShowDrainage={p.onShowDrainage}
            />
          </div>
          <div hidden={tab !== 'review'}>
            <ReviewTab {...p} onTab={setTab} onEngineeringInputs={showEngineeringInputs} />
          </div>
        </div>
      </fieldset>
    </aside>
  )
}
