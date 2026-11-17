import { ribbonFields } from './dev-forestry-roads/SharedRoadFields'
import { groundAlong } from './dev-forestry-roads/roadSummaryMetrics'
import { LOCAL_PLANE_EPSG } from '@/lib/geo/projectedCrs'
import { MAX_PROJECT_ROADS, roadCount } from './dev-forestry-roads/roadLimits'
import {
  detailTitle,
  parseProfileView,
  roadDetailViews,
  roadProfileViews,
  type DetailView,
  type ProfileView,
} from './dev-forestry-roads/detailViews'
import { useGradeAverage } from './dev-forestry-roads/GradeAverageOptions'
import { useChartMeasurement } from './dev-forestry-roads/ChartMeasurement'
import { roadSnapLines, snapNotice, type DrawSnap } from './dev-forestry-roads/drawSnap'
import { createPortal } from 'react-dom'
import { PanelWindowProvider, PanelWindowLayoutRestore } from '@pgmaps/geo-toolkit/ui/panel-window-workspace'
import { PanelWindowControls } from '@/components/ui/panel-window-controls'
import { useWorkflowPlacement } from '@/components/interfaces/useWorkflowPlacement'
import { RibbonPaneColumns, RibbonPaneHost } from '@/components/interfaces/RibbonTaskPane'
import { CustomizeRibbonPane } from '@/components/interfaces/CustomizeRibbonPane'
import { useRibbonPreferences } from '@/components/interfaces/ribbonPreferences'
import { InterfaceChooser } from '@/components/interfaces/InterfaceChooser'
import { useWorkspaceLayout } from '@/components/interfaces/useWorkspaceLayout'
import { DEFAULT_INTERFACE_NAME, workspaceHelpSearch } from '@/components/interfaces/interfacePreference'
import { layoutIcons, type WorkspaceLayout, type WorkspaceWidget } from '@/components/interfaces/workspaceLayouts'
import {
  commandRecord,
  ribbonExports,
  commandDef,
  designOnlyCommands,
  workspaceCommandIds,
  type EditorCommand,
  type WorkspaceCommand,
} from '@/components/interfaces/workspaceCommands'
import { AccessLockup } from '@/components/interfaces/AccessLockup'
import { ThemeModeButton, useThemeModeItems } from '@/components/interfaces/ThemeModeButton'
import type { ActionMenuItem } from '@/components/ui/action-menu'
import { BrandingDialog } from '@/branding/BrandingDialog'
import { useBranding } from '@/branding/useBranding'
import { exportBrand } from '@/branding/store'
import { brandedHtml } from '@/branding/presentation'
import { DEFAULT_HEADER_TOOLS, WorkspaceHeader } from '@/components/interfaces/WorkspaceHeader'
import { CommandButton, type CommandPresentation } from '@/components/interfaces/CommandButton'
import { revealEditorSection } from '@/components/interfaces/ribbonEditorSections'
import { type CommandState, WorkspaceTools } from '@/components/interfaces/WorkspaceTools'
import { TerrainLayerSelect } from './dev-forestry-roads/TerrainLayerSelect'
import { RoadSelect } from './dev-forestry-roads/Controls'
import { AccessHistoryPanel } from './dev-forestry-roads/AccessHistoryPanel'
import { loadBcAccessPilotScenario } from './dev-forestry-roads/bcAccessPilotScenario'
import { loadBcPlannedBlockScenario } from './dev-forestry-roads/bcPlannedBlockScenario'
import {
  awaitingFirstRoad,
  isAccessInvestigation,
  mappedRoadRecordCount,
  startInvestigationDesign,
  withAddedAlignments,
} from './dev-forestry-roads/investigationWorkspace'
import {
  derivedRoadName,
  designFromMappedRoad,
  type DesignPoints,
  isLoadableMappedRoad,
  isMappedRoad,
  loadableMappedRoads,
  loadMappedRoads,
  mappedRoadAlignment,
  mappedRoadInBounds,
  nextMappedRoadColor,
} from './dev-forestry-roads/mappedRoad'
import { extendAlignment, nearerEnd, sketchPoints, strokeContinuation } from './dev-forestry-roads/sketchRoad'
import { describeLineOrigin, roadLineFeature } from './dev-forestry-roads/terrainRoadLines'
import { TraceFeedback } from './dev-forestry-roads/TraceFeedback'
import { useRoadTrace } from './dev-forestry-roads/useRoadTrace'
import { pathLengthM } from './dev-forestry-roads/mapNotes'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import { roadSelectionRange } from './dev-forestry-roads/roadSelection'
import { InfoTip } from '@/components/ui/info-tip'
import { RoadNotifications } from './dev-forestry-roads/RoadNotifications'
import { OpenSampleDialog, ProjectFileConflictDialog, RoadRemovedNotice } from './dev-forestry-roads/LifecycleNotices'
import { distinctProjectName, removeRoad, restoreRoad, type RemovedRoad } from './dev-forestry-roads/roadLifecycle'
import type { LibraryEntry } from './dev-forestry-roads/projectLibrary'
import {
  ExampleStartNotice,
  HeaderStatus,
  ProjectName,
  SaveStateLine,
  SessionRestoredNotice,
} from './dev-forestry-roads/ProjectHeader'
import { saveStateText } from './dev-forestry-roads/saveState'
import { createTourActionStream } from '@/lib/tours/tourActions'
import { readTourLaunch, tourLaunchSearch, type TourLaunch } from '@/lib/tours/tourLaunch'
import { ROAD_LESSON_IDS } from './dev-forestry-roads/tours/roadLessons'
import {
  ROAD_TOUR_ACTIONS,
  createRoadTourExecutor,
  createRoadTourSnapshotMemo,
  roadAnchorPlacement,
} from './dev-forestry-roads/tours/roadTour'
import { synchronizeCrossingRecords } from './dev-forestry-roads/crossingPlan'
import { TEMPLATE_FIELDS } from './dev-forestry-roads/roadFieldDefinitions'
import { SectionOpenReporterContext } from '@/components/ui/section-open-reporter'
import { withBase } from '@/lib/dataUrl'
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ChartNoAxesCombined,
  CircleQuestionMark,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  PencilLine,
  Play,
  Plus,
  Route,
  Shapes,
  Spline,
  Waves,
  Waypoints,
  Maximize,
  Minimize,
  X,
  type LucideIcon,
} from 'lucide-react'
import { measureHint, measureReadout } from '@/components/ui/map-measure'
import { sketchStats } from '@/lib/geo/mapSketch'
import { MapToolPanel } from '@/components/ui/map-tool-panel'
import { leavesDrawingOnEscape, useRoadColourMode } from './dev-forestry-roads/PlanTools'
import { attributeCosts, type CostSeriesId } from './dev-forestry-roads/costAttribution'
import { costBreakdownRows } from './dev-forestry-roads/costBreakdownRows'
import { hasCostSeries } from './dev-forestry-roads/costColours'
import type { CostStretchFocus } from './dev-forestry-roads/CostWhereItFalls'
import { ReadoutGrid } from '@/components/ui/readout-grid'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { FilesDialog, type RoadExport } from './dev-forestry-roads/FilesDialog'
import { UndoHistoryButton } from './dev-forestry-roads/UndoHistoryMenu'
import { isoDate, issueLine, issueStamp, PLANNING_CAVEAT } from './dev-forestry-roads/projectIssue'
import {
  csvPreview,
  EXPORT_ITEMS,
  exportRoads,
  exportUnavailable,
  geoJsonPreview,
  INVALID_INPUT_RULES,
  MULTI_ROAD_EXPORTS,
  optimalHaulUnavailable,
  STYLE_LIBRARY_EXPORTS,
  textPreview,
  type ExportPreview,
  type RoadScope,
} from './dev-forestry-roads/exportCatalog'
import { SoftreeLocationOptions } from './dev-forestry-roads/SoftreeLocationOptions'
import type { LocationAsciiOptions } from './dev-forestry-roads/softreeExports'
import { mapNotesGeoJson } from './dev-forestry-roads/mapNotes'
import { streamRegisterCsv } from './dev-forestry-roads/streamReports'
import { buildCulvertSchedule, culvertScheduleCsv } from './dev-forestry-roads/culverts/culvertSchedule'
import { provincialEvidenceGeoJson } from './dev-forestry-roads/provincialStreamData'
import { FullscreenPanel, useElementFullscreen } from '@/components/ui/fullscreen-panel'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { RoadSummary, RoadSummarySettings } from './dev-forestry-roads/RoadSummary'
import { formatRoadNumber as number } from './dev-forestry-roads/roadFormat'
import { formatNumber } from '@/lib/format'
import { roadSummaryMetrics } from './dev-forestry-roads/roadSummaryMetrics'
import { parseRoadReportSettings } from './dev-forestry-roads/reportSettings'
import { useSummaryPreferences } from './dev-forestry-roads/summaryPreferences'
import { MetricSummaryLayout } from '@/components/ui/metric-summary'
import { TilePaneClose } from '@/components/ui/tiled-workspace'
import { ResizableSplit } from '@/components/ui/resizable-split'
import { PanelCorner } from '@/components/ui/panel-corner'
import { TabBar } from '@/components/ui/tab-bar'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import './dev-forestry-roads/workspace.css'
import { downloadBlob, downloadText } from '@/lib/download'
import { cn } from '@/lib/utils'
import {
  CableChart,
  ChartHeader,
  type ChartHeaderHandle,
  CrossSectionChart,
  formatRoadStation,
  MassHaulChart,
  GradeChart,
  ProfileChart,
} from './dev-forestry-roads/Charts'
import { shownLayoutResult, useCableLayoutOverlay } from './dev-forestry-roads/cableLayout/useCableLayout'
import { useCableLayoutChartEdit, useLayoutFocusFollower } from './dev-forestry-roads/cableLayout/useLayoutEdit'
import { cableGroundSource } from './dev-forestry-roads/dline/fieldProfile'
import { dLineFrame } from './dev-forestry-roads/dline/frame'
import { dLineExtras } from './dev-forestry-roads/dline/outputs'
import { dLineSheetUnavailable } from './dev-forestry-roads/dline/sheetExport'
import { dLineSupportPlanFeatures, supportStakeoutCsv } from './dev-forestry-roads/dline/supports'
import { DesignSidebar, type FileKind } from './dev-forestry-roads/DesignSidebar'
import { RoadStationProvider } from './dev-forestry-roads/roadStation'
import { memoWithLatestHandlers } from '@/lib/memoWithLatestHandlers'
import { SpatialImportDialog } from './dev-forestry-roads/SpatialImportDialog'
import { TerrainImportDialog } from './dev-forestry-roads/TerrainImportDialog'
import { PlaceOnMapDialog } from './dev-forestry-roads/PlaceOnMapDialog'
// Loaded on first use: it carries the Softree file readers.
const SoftreeCompareDialog = lazy(() =>
  import('./dev-forestry-roads/SoftreeCompareDialog').then((m) => ({ default: m.SoftreeCompareDialog })),
)
// Loaded only when the address asks for a lesson: it carries Tourkit's player.
const RoadLessonPlayer = lazy(() => import('./dev-forestry-roads/tours/RoadLessonPlayer'))
/** What the person does in the designer, for a running lesson (`docs/forestry-road-design/live-lessons.md`). */
const roadTourActions = createTourActionStream()
import {
  applySpatialImport,
  buildSpatialImport,
  proposeRoles,
  readSpatialImport,
  SpatialCrsQuestion,
  SPATIAL_ACCEPT,
  spatialFeatureName,
  type ImportIntent,
  type RoleChoice,
  type SpatialFile,
} from './dev-forestry-roads/spatialImport'
import { combinedReferenceBounds, referenceLayerKey, type LayerFeature } from './dev-forestry-roads/referenceFeatures'
import { ReferencePanel } from './dev-forestry-roads/ReferencePanel'
import { LayerImportDialog, type LayerImportOptions } from './dev-forestry-roads/LayerImportDialog'
import { DetailAreaDialog, type DetailSource, type DetailWindow } from './dev-forestry-roads/DetailAreaDialog'
import { LIDAR_BC_VERTICAL_REFERENCE } from './dev-forestry-roads/lidarBcDem'
import { readLocalDemWindow } from './dev-forestry-roads/localDemWindow'
import {
  HRDEM_RELIEF_DESCRIPTION,
  HRDEM_RELIEF_NAME,
  loadHrdemArea,
  downloadHrdemBoxes,
  demBoxesGeoJson,
  projectDetailAreas,
  type DemBox,
  type DetailArea,
} from './dev-forestry-roads/hrdem'
import { loadDetailFsrs } from './dev-forestry-roads/detailFsr'
import {
  applyLayerImport,
  designExtent,
  layersExtent,
  loadImportedProposedRoads,
  defaultHiddenReferenceLayers,
  readReferenceImport,
  suggestedLayerRole,
  removeImportedLayer,
  type LayerImportChoice,
} from './dev-forestry-roads/referenceImport'
import {
  cutblockBufferFeatures,
  cutblockBufferKey,
  layerFitPoints,
  type CutblockBuffer,
} from './dev-forestry-roads/cutblockBuffers'
import { withReferenceStyle } from './dev-forestry-roads/referenceStyles'
import type { SymbolStyle } from '@/lib/mapSheet/symbolStyle'
import type { PickedFile } from '@/components/ui/picked-files'
import type { EngineeringInputTab, PointCloudChoice, SidebarTab } from './dev-forestry-roads/DesignSidebarBody'
import { FullCostPlanningDialog, type FullCostPreview } from './dev-forestry-roads/FullCostPlanningDialog'
import { NetworkPlanningDialog } from './dev-forestry-roads/NetworkPlanningDialog'
import { isFullCostRecordCurrent } from './dev-forestry-roads/fullCostRecord'
import { PlanView, type DrawMode } from './dev-forestry-roads/PlanView'
import { usePlanSightlines } from './dev-forestry-roads/planSightlines'
import { usePlanDisplay, type FitRequest } from './dev-forestry-roads/usePlanDisplay'
import { TerrainPreview } from './dev-forestry-roads/TerrainPreview'
import { PeggingEditor } from './dev-forestry-roads/PeggingEditor'
import { EngineeringSummary } from './dev-forestry-roads/EngineeringSummary'
import { RadialDeflectionPanel } from './dev-forestry-roads/RadialDeflectionPanel'
import { DesignSchedules, type SweptPathProps } from './dev-forestry-roads/DesignSchedules'
import { analyzeSweptPath } from './dev-forestry-roads/sweptPath'
import { withJunctionOverlay } from './dev-forestry-roads/junctionTurn'
import { projectProfileJunctions, withVerticalControl } from './dev-forestry-roads/profileJunctions'
import { DEFAULT_DESIGN_STANDARDS, gradeRule } from './dev-forestry-roads/designStandards'
import {
  applyJobStandardsToNewProject,
  startingJobStandards,
  type JobStandards,
} from './dev-forestry-roads/jobStandards'
import { vehicleFit } from './dev-forestry-roads/readiness'
import { SweptPathPanel } from './dev-forestry-roads/SweptPathPanel'
import { StationTable } from './dev-forestry-roads/StationTable'
import { CostBreakdown } from './dev-forestry-roads/CostBreakdown'
import { CompareAlternatives } from './dev-forestry-roads/CompareAlternatives'
import { DRAINAGE_SETTINGS_KEY, DrainagePanel, readDrainageSettings } from './dev-forestry-roads/DrainagePanel'
import { runDrainage, type DrainageRun, type DrainageSettings } from './dev-forestry-roads/drainageRun'
import { terrainGridCellM } from './dev-forestry-roads/tinGround'
import { GroundDrainagePanel, type AreaChoice } from './dev-forestry-roads/GroundDrainagePanel'
import { useGroundDrainage } from './dev-forestry-roads/useGroundDrainage'
import {
  DEFAULT_GROUND_DRAINAGE_SETTINGS,
  type GroundDrainageArea,
  type GroundDrainageState,
} from './dev-forestry-roads/groundDrainage'
import {
  createDrainageEvidence,
  drainageInputFingerprint,
  drainageTerrainFingerprint,
  drainageEvidenceGeoJson,
  drainageEvidenceNeedsRecompute,
  parseDrainageComparisons,
} from './dev-forestry-roads/drainageEvidence'
import {
  createDrainageComparison,
  drainageComparisonId,
  drainageComparisonsExport,
} from './dev-forestry-roads/drainageSensitivity'
import type { PourPoint } from './dev-forestry-roads/drainageCatchments'
import { cableSummary, cableProfileCsv, cableProfileHtml, crossSectionCsv } from './dev-forestry-roads/profileOutputs'
import { analyzeCable, createRoadStationSampler, distance, offsetCoordinate } from './dev-forestry-roads/engine'
import { checkPlanEdit } from './dev-forestry-roads/planEditCheck'
import { roadStationAt, typedStationNote } from './dev-forestry-roads/stationAt'
import {
  hasStationing,
  resolveTypedStation,
  setScreenStationing,
  withStationing,
} from './dev-forestry-roads/roadStationing'
import { StationBox } from './dev-forestry-roads/StationBox'
import { StationJumpMenu } from './dev-forestry-roads/StationJumpMenu'
import { SectionPaneTools, useSectionTools } from './dev-forestry-roads/SectionPaneTools'
import {
  engineeringCsv,
  parseProject,
  projectGeoJson,
  projectReportHtml,
  reportReview,
  serializeProject,
  stationsCsv,
  terrainProfileCsv,
  terrainProfileReportHtml,
} from './dev-forestry-roads/project'
import { shareUnchanged } from './dev-forestry-roads/shareUnchanged'
import {
  createDemoProject,
  DEFAULT_ROAD_SETTINGS,
  DEFAULT_TEMPLATE,
  demoTerrain,
  importTerrainWithAnswers,
  loadLas,
  loadRaster,
  loadRegionalTerrain,
  exportGrid,
  localMetricGrid,
  starterAlignment,
  terrainBounds,
  terrainFromMetadata,
  TerrainImportQuestion,
  type TerrainImportAnswers,
  type TerrainImportNeeds,
} from './dev-forestry-roads/terrain'
import { terrainCellLabel, terrainDisplayName } from './dev-forestry-roads/terrainName'
import { ProjectsDialog, type NewProject } from './dev-forestry-roads/ProjectsDialog'
import { loadRoadScenario, type RoadScenarioId } from './dev-forestry-roads/scenarios'
import type { AccessHistorySelection } from './dev-forestry-roads/AccessHistorySelection'
import { suggestRoutes, type RouteSearchOptions } from './dev-forestry-roads/routing'
import { replaceableRouteAlternatives, terrainCostAlternatives } from './dev-forestry-roads/routeAlternatives'
import { ProfileSwitcher } from './dev-forestry-roads/ProfileSwitcher'
import { resolvedGroundWindow } from './dev-forestry-roads/groundTrend'
import type { RoutePreviewLine } from './dev-forestry-roads/RouteFinder'
import { routePreviewFeature } from './dev-forestry-roads/routePreviewFeatures'
import { RoadSwitcher } from './dev-forestry-roads/RoadSwitcher'
import { reachedBlockCoordinates } from './dev-forestry-roads/planFit'
import { fitHorizontalRadii, profileKeptNotice } from './dev-forestry-roads/horizontalTools'
import type { AccessMark } from './dev-forestry-roads/AccessReviewPanel'
import { loadNearestBcFsrs } from './dev-forestry-roads/fsrNetwork'
import { refreshExistingRoadFeature } from './dev-forestry-roads/existingRoadEvidence'
import { calculatedAlignment, safeAnalyzeRoad } from './dev-forestry-roads/analysisResult'
import { invalidInputNotice, invalidInputRefusal, refuseInvalidResults } from './dev-forestry-roads/inputErrors'
import { incompleteReasonSummary } from './dev-forestry-roads/sectionCompleteness'
import { unpricedQuantities } from './dev-forestry-roads/costReadiness'
import { useRoadWorkspace } from './dev-forestry-roads/useRoadWorkspace'
import { landXml, roadShapefileLayers, stakeoutCsv } from './dev-forestry-roads/designExports'
import { exportedRoadStyles } from './dev-forestry-roads/exportStyles'
import { roleOverrides } from './dev-forestry-roads/styleLibrary'
import { readStoredStyleLibrary, StyleLibraryPanel } from './dev-forestry-roads/StyleLibraryPanel'
import type { StyledExportKind } from './dev-forestry-roads/styledExports'
import { RoadPaneLayout, roadPaneKey, useRoadPanels, type RoadPaneId } from './dev-forestry-roads/RoadPaneLayout'
import { useBlockSheet } from './dev-forestry-roads/BlockSheetSetup'
import { SHEET_PRESETS } from '@/lib/forestry/blockSheet/sheets'
import { LayoutPicker, readSavedLayouts, resolveLayout, type SavedLayout } from './dev-forestry-roads/LayoutPicker'
import type {
  Alignment,
  ContextFeature,
  Coordinate,
  RoadAnalysis,
  RoadProject,
  RoadTemplate,
  TerrainMetadata,
  TerrainSource,
} from './dev-forestry-roads/types'
import { resizeMap } from '@pgmaps/geo-toolkit/map/map-resize'
import { fitMapToPoints } from '@pgmaps/geo-toolkit/map/map-fit'
import {
  historyShortcut,
  historyShortcutLabels,
  isRemoveKey,
  isApplePlatform,
  keepsNativeUndo,
} from './dev-forestry-roads/historyShortcut'

const uid = () => crypto.randomUUID()
/** What each spatial picker is for; the reader asks about anything in the file outside it. */
const SPATIAL_INTENTS: Record<
  Exclude<FileKind, 'project' | 'terrain' | 'breaklines' | 'landxml' | 'roadeng'>,
  ImportIntent
> = {
  alignment: 'road',
  context: 'streams',
  cutblocks: 'cutblocks',
  'mapped-roads': 'mapped-road',
}
// Violet is left out: it marks a mapped road (MAPPED_ROAD_COLOR).
const colors = ['#d97706', '#2563eb', '#0891b2', '#16a34a', '#db2777']
function fitPlanPoints(map: MapLibreMap, points: readonly Coordinate[]) {
  if (!points.length) return
  resizeMap(map)
  fitMapToPoints(map, points, { minSpan: 0, pad: 0, padding: 48, maxZoom: 16, duration: 350 })
}
function contextPoints(feature: ContextFeature): Coordinate[] {
  return feature.geometry.type === 'LineString'
    ? (feature.geometry.coordinates as Coordinate[])
    : (feature.geometry.coordinates.flat() as Coordinate[])
}
function newAlignment(points: Coordinate[], name: string, template = DEFAULT_TEMPLATE): Alignment {
  return {
    id: uid(),
    name,
    color: colors[Math.floor(Math.random() * colors.length)],
    points: points.map((coordinate) => ({ id: uid(), coordinate, radiusM: 0 })),
    vertical: [],
    template: { ...template },
    overrides: [],
  }
}
/** Points a drawing needs before Finish: an extension continues from a road end, so one is enough. */
const minimumDraftPoints = (mode: DrawMode) => (mode === 'avoid' ? 3 : mode === 'extend' ? 1 : 2)
const pointsInUse = (p: RoadProject) =>
  p.alignments.filter((a) => a.id !== p.designPlaceholderId).reduce((n, a) => n + a.points.length, 0)
const MAX_PROJECT_POINTS = 2000
/**
 * A searched route as a road: its corners get the project's minimum radius, reduced where the
 * tangents are too short to hold it, so a generated road turns on curves rather than at points.
 */
function generatedAlignment(points: Coordinate[], name: string, template: RoadTemplate, minRadiusM: number) {
  const road = newAlignment(points, name, template)
  if (minRadiusM > 0) road.points = fitHorizontalRadii(road.points, { kind: 'radius', radiusM: minRadiusM }).points
  return road
}
const boundsOf = (p: RoadProject): [number, number, number, number] => {
  const coords = [
    ...p.alignments.flatMap((a) => a.points.map((p) => p.coordinate)),
    ...reachedBlockCoordinates(p.context, p.alignments),
  ]
  return [
    Math.min(...coords.map((p) => p[0])) - 0.001,
    Math.min(...coords.map((p) => p[1])) - 0.001,
    Math.max(...coords.map((p) => p[0])) + 0.001,
    Math.max(...coords.map((p) => p[1])) + 0.001,
  ]
}

/** What New project's design standards start from: the workspace limits and the starting template's width. */
const STARTING_JOB_STANDARDS = startingJobStandards(
  DEFAULT_ROAD_SETTINGS,
  DEFAULT_TEMPLATE.leftWidth + DEFAULT_TEMPLATE.rightWidth,
)

/** The sidebar skips the page's renders that change only the station (a hover along the road); see roadStation.tsx. */
const StationIndependentSidebar = memoWithLatestHandlers(DesignSidebar, { bags: ['workspace'] })

/** The ribbon's icon for each drawing mode, on the drawing card. */
const DRAW_MODE_ICONS: Partial<Record<DrawMode, LucideIcon>> = {
  road: Plus,
  extend: Waypoints,
  trace: Route,
  profile: ChartNoAxesCombined,
  cable: Spline,
  stream: Waves,
  avoid: Shapes,
}

/** How many frames a lesson's anchor move waits for its anchor to be drawn. */
const ANCHOR_SETTLE_FRAMES = 20
export default function DevForestryRoads({
  initialInterface,
  layouts,
  layoutsFallback = false,
}: {
  initialInterface: WorkspaceLayout
  layouts: WorkspaceLayout[]
  /** The served layout file could not be read, so only the built-in workbench is offered. */
  layoutsFallback?: boolean
}) {
  const {
    active,
    selectLayout,
    layoutSelection,
    setLayoutSelection,
    focusMode,
    collapsed,
    setCollapsed,
    controlsOpen,
    setControlsOpen,
    focusPane,
    setFocusPane,
  } = useWorkspaceLayout(initialInterface)
  const [choosingInterface, setChoosingInterface] = useState(false)
  const [brandingOpen, setBrandingOpen] = useState(false)
  // Bumped when the browser's style library changes, so a styled export's preview is rebuilt.
  const [styleLibraryRevision, setStyleLibraryRevision] = useState(0)
  const branding = useBranding()
  const selectedExportBrand = exportBrand(branding)
  // The user's own logo (Your details), printed in place of the brand's on every document (`printedLogo`).
  const printLogo = branding.logo
  const [customizingRibbon, setCustomizingRibbon] = useState(false)
  const [paneHost, setPaneHost] = useState<HTMLDivElement | null>(null)
  const [taskPaneDocked, setTaskPaneDocked] = useState(false)
  const ribbonPreferences = useRibbonPreferences(active)
  const w = useRoadWorkspace()
  // A live lesson the address asks for (`?tour=station-200&tourMode=practice`).
  const [tourLaunch, setTourLaunch] = useState<TourLaunch | null>(() =>
    readTourLaunch(window.location.search, ROAD_LESSON_IDS),
  )
  const [tourSnapshot] = useState(createRoadTourSnapshotMemo)
  // What a lesson's checks read that the page did not keep: the sections open (by label), the
  // output shown in Save & export, the last file saved, and whether a project was opened from a file.
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set())
  const reportSection = useCallback((label: string, open: boolean) => {
    setOpenSections((current) => {
      if (current.has(label) === open) return current
      const next = new Set(current)
      if (open) next.add(label)
      else next.delete(label)
      return next
    })
  }, [])
  const [lastExport, setLastExport] = useState<string | null>(null)
  const [openedFromFile, setOpenedFromFile] = useState(false)
  // The project file a lesson's Watch saved, which its next step reopens without a download.
  const lessonSavedCopy = useRef<string | null>(null)
  // The detail pane's chart header, so a lesson can unfold the readouts a short pane folds away.
  const detailChart = useRef<ChartHeaderHandle | null>(null)
  const { project, analysis, alignment, source, update, updateAlignment, setStation, busy } = w
  const investigation = isAccessInvestigation(project)
  const blockSheet = useBlockSheet(project, source)
  const { ref, fullscreen, toggle } = useElementFullscreen<HTMLDivElement>()
  const compact = useMediaQuery('(max-width: 767px), (max-height: 760px)')
  const dockLayers = useMediaQuery('(min-width: 900px)')
  const wideHeader = useMediaQuery('(min-width: 1024px)')
  const mobileWorkspace = useMediaQuery('(max-width: 767px)')
  const tinyHeight = useMediaQuery('(max-height: 480px)')
  const shortRibbon = tinyHeight && active.toolbar?.dock === 'top' && active.toolbar.compact
  const shortPanePicker =
    shortRibbon || (tinyHeight && active.toolbar?.dock === 'side' && active.panelFrame?.resizeCorners)
  const smallSummary = useMediaQuery('(max-width: 767px), (max-height: 480px)')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryTarget, setSummaryTarget] = useState<string | null>(null)
  const summaryControls = useSummaryPreferences(active)
  const controlsShown = focusMode ? controlsOpen : !collapsed
  const [mode, setMode] = useState<DrawMode>('inspect')
  const [draft, setDraft] = useState<Coordinate[]>([])
  const [hover, setHover] = useState<Coordinate | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null)
  const [fitRevision, setFitRevision] = useState(0)
  const planDisplay = usePlanDisplay()
  const [verticalReference, setVerticalReference] = useState('')
  const [pointCloud, setPointCloud] = useState<PointCloudChoice>({ classify: 'auto', surface: 'mean' })
  const [breaklines, setBreaklines] = useState<{ name: string; data: unknown } | null>(null)
  const [detail, setDetail] = useState<DetailView>('section')
  // What the profile pane draws, remembered in this browser; display only, never in the project.
  const [profileView, setStoredProfileView] = useState<ProfileView>(() => {
    try {
      return parseProfileView(localStorage.getItem('pgmaps-road-profile-view'))
    } catch {
      return 'profile'
    }
  })
  const setProfileView = (view: ProfileView) => {
    setStoredProfileView(view)
    try {
      localStorage.setItem('pgmaps-road-profile-view', view)
    } catch {
      // Private windows can refuse storage; the choice still holds for this session.
    }
  }
  // One rolling-average setting for every grade chart, so the profile strip and the detail view agree.
  const [gradeAverage, setGradeAverage] = useGradeAverage()
  const [fallbackDrainageSettings] = useState<DrainageSettings>(readDrainageSettings)
  const drainageSettings = project.drainage?.settings ?? fallbackDrainageSettings
  const [drainagePicking, setDrainagePicking] = useState<Pick<
    PourPoint,
    'surface' | 'snapRadiusM' | 'snapPolicy'
  > | null>(null)
  const drainageInput = useMemo(
    () => ({
      alignment,
      roadSettings: project.settings,
      terrain: project.terrain,
      settings: drainageSettings,
      pourPoint: project.drainage?.pourPoint,
      watershedMinAreaHa: project.drainage?.watershedMinAreaHa,
    }),
    [
      alignment,
      project.settings,
      project.terrain,
      drainageSettings,
      project.drainage?.pourPoint,
      project.drainage?.watershedMinAreaHa,
    ],
  )
  const drainageFingerprint = useMemo(() => drainageInputFingerprint(drainageInput), [drainageInput])
  // Existing-ground drainage needs no road: an area, the terrain and its own settings.
  const [groundDrainageOpen, setGroundDrainageOpen] = useState(false)
  const [groundImportChoices, setGroundImportChoices] = useState<{
    fileName: string
    choices: AreaChoice[]
  } | null>(null)
  const groundTerrainFingerprint = useMemo(() => drainageTerrainFingerprint(project.terrain), [project.terrain])
  const groundDrainage = useGroundDrainage({
    state: project.groundDrainage,
    source,
    terrainName: project.terrain.name,
    terrainFingerprint: groundTerrainFingerprint,
    sourceM: terrainGridCellM(project.terrain),
  })
  const changeGroundDrainage = (next: GroundDrainageState) => update((p) => ({ ...p, groundDrainage: next }))
  const setGroundDrainageArea = (area: GroundDrainageArea) => {
    // A new area drops the old outlet: it was picked on ground that may no longer be routed.
    update((p) => ({
      ...p,
      groundDrainage: { settings: p.groundDrainage?.settings ?? DEFAULT_GROUND_DRAINAGE_SETTINGS, area },
    }))
    setGroundImportChoices(null)
    setGroundDrainageOpen(true)
    w.setNotice(`Drainage area: ${area.name}. Route flow to draw it on the plan.`)
  }
  // One run per road, with the inputs it was computed from: a run is stale when any of them changes.
  const [drainage, setDrainage] = useState<
    Map<
      string,
      {
        run: DrainageRun
        inputs: { fingerprint: string; source: TerrainSource }
      }
    >
  >(() => new Map())
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>(readSavedLayouts)
  const savedLayout = resolveLayout(layoutSelection, savedLayouts)
  const layout = investigation ? 'plan' : savedLayout.base
  const layoutStorageId = investigation ? 'access-investigation' : savedLayout.storageId
  const panelFrame = active.panelFrame
  const cornerKey = (id: string) => roadPaneKey(layoutStorageId, `corner:${active.id}:${id}`)
  const panelCorner = (id: RoadPaneId | 'guide' | 'controls', label: string) =>
    panelFrame?.resizeCorners && <PanelCorner storageKey={cornerKey(id)} label={label} />
  const [savedHiddenPanels, setHiddenPanels, restorePreset] = useRoadPanels(layoutStorageId, layout)
  const hiddenPanels = useMemo<RoadPaneId[]>(
    () => (investigation ? ['profile', 'detail', 'data'] : savedHiddenPanels),
    [investigation, savedHiddenPanels],
  )
  const focusOptions = [
    { value: 'plan' as const, label: 'Plan' },
    { value: 'profile' as const, label: 'Profile' },
    { value: 'detail' as const, label: 'Detail' },
    ...(['engineering', 'pegging'].includes(layout) ? [{ value: 'data' as const, label: 'Data' }] : []),
  ].filter((option) => !hiddenPanels.includes(option.value))
  const focusedPane = focusOptions.some((option) => option.value === focusPane) ? focusPane : focusOptions[0]?.value
  const visiblePanelCount = [
    'plan',
    'profile',
    'detail',
    ...(['engineering', 'pegging'].includes(layout) ? ['data'] : []),
  ].filter((id) => !hiddenPanels.includes(id as RoadPaneId)).length
  const closePanel = (id: RoadPaneId) => (
    <TilePaneClose
      label={id === 'detail' ? 'detail view' : id}
      disabled={visiblePanelCount <= 1}
      onClose={() => setHiddenPanels([...hiddenPanels, id])}
    />
  )
  const [overlay, setOverlay] = useState<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })
  const [networkPreview, setNetworkPreview] = useState<{
    project: RoadProject
    source: TerrainSource
    overlay: GeoJSON.FeatureCollection
  } | null>(null)
  const networkOverlay =
    networkPreview?.project === project && networkPreview.source === source ? networkPreview.overlay : null
  const [completeCostPreview, setCompleteCostPreview] = useState<{
    project: RoadProject
    source: TerrainSource
    preview: FullCostPreview
  } | null>(null)
  const costPreview =
    completeCostPreview?.project === project && completeCostPreview.source === source
      ? completeCostPreview.preview
      : null
  const [reviewedRoad, setReviewedRoad] = useState<{ id: string; source: TerrainSource } | null>(null)
  const [focusedConstraintId, setFocusedConstraintId] = useState<string | null>(null)
  const [focusedReferenceId, setFocusedReferenceId] = useState<string | null>(null)
  const [layersOpen, setLayersOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  // Where Load 1 m DEM starts when something other than its button opens it (the section fixes).
  const [detailStart, setDetailStart] = useState<{ source: DetailSource; areaId?: string } | null>(null)
  const [detailBox, setDetailBox] = useState<Coordinate[][] | null>(null)
  const [importedDetailAreas, setImportedDetailAreas] = useState<DetailArea[] | null>(null)
  const [detailView, setDetailView] = useState<Coordinate[]>([])
  const [layerImportFiles, setLayerImportFiles] = useState<SpatialFile[] | null>(null)
  const [layerToDelete, setLayerToDelete] = useState<{ key: string; name: string } | null>(null)
  const [hiddenReference, setHiddenReference] = useState<{ opened: number; keys: string[] }>({ opened: -1, keys: [] })
  const defaultHiddenLayers = defaultHiddenReferenceLayers(project)
  const hiddenLayerKeys = hiddenReference.opened === w.openedCount ? hiddenReference.keys : defaultHiddenLayers
  const changeLayerVisibility = (keys: readonly string[], visible: boolean) =>
    setHiddenReference((previous) => {
      const hidden = new Set(previous.opened === w.openedCount ? previous.keys : defaultHiddenLayers)
      for (const key of keys) {
        if (visible) hidden.delete(key)
        else hidden.add(key)
      }
      return { opened: w.openedCount, keys: [...hidden] }
    })
  // A file whose features the reader could not settle: the dialog asks, and nothing is added until then.
  const [spatialChoice, setSpatialChoice] = useState<{
    file: SpatialFile
    roles: RoleChoice
    intent: ImportIntent
  } | null>(null)
  // A terrain import waiting to be told a CRS or vertical datum its files do not state.
  const [placingOnMap, setPlacingOnMap] = useState(false)
  const [comparingRoadEng, setComparingRoadEng] = useState(false)
  const [terrainQuestion, setTerrainQuestion] = useState<{
    needs: TerrainImportNeeds
    resolve: (answers: TerrainImportAnswers | null) => void
  } | null>(null)
  const [cutblockReviewRequest, setCutblockReviewRequest] = useState<{ id: string; sequence: number }>()
  const [historySelection, setHistorySelection] = useState<AccessHistorySelection>()
  const reviewRoad = useCallback(
    (road: ContextFeature | null, picked = false) => {
      // A road the reviewer picks, in the panel or on the map, is highlighted. The panel's own
      // first selection only moves a highlight that is already showing.
      setReviewedRoad((previous) =>
        road && picked
          ? { id: road.id, source }
          : previous?.source === source
            ? road
              ? { id: road.id, source }
              : null
            : null,
      )
    },
    [source],
  )
  const [routeLines, setRouteLines] = useState<RoutePreviewLine[] | null>(null)
  const trace = useRoadTrace({ active: mode === 'trace', clicks: draft, source, terrain: project.terrain })
  const [terrainRoadOverlay, setTerrainRoadOverlay] = useState<GeoJSON.FeatureCollection | null>(null)
  const [terrainRoadsOverlay, setTerrainRoadsOverlay] = useState<GeoJSON.FeatureCollection | null>(null)
  // Drawing an area makes an avoidance area unless "Draw block" asked for a harvest block.
  const [polygonKind, setPolygonKind] = useState<'avoid' | 'harvest' | 'drainage'>('avoid')
  useEffect(() => {
    if (mode !== 'avoid') setPolygonKind('avoid')
  }, [mode])
  // One plan click asked for by a sidebar tool (the access review's end or start road).
  const [planPick, setPlanPick] = useState<{ prompt: string; onPick: (at: Coordinate) => void } | null>(null)
  const [accessMarks, setAccessMarks] = useState<AccessMark[] | null>(null)
  const [skidReachFeatures, setSkidReachFeatures] = useState<GeoJSON.Feature[] | null>(null)
  const drawnArea =
    polygonKind === 'harvest' ? 'harvest block' : polygonKind === 'drainage' ? 'drainage area' : 'avoidance area'
  const [routePreviewState, setRoutePreviewState] = useState<{
    guide: Alignment
    source: TerrainSource
    settings: RoadProject['settings']
    context: RoadProject['context']
    options: RoadProject['routeSearch']
    route?: ReturnType<typeof suggestRoutes>['routes'][number]
    error?: string
  } | null>(null)
  const previewRoute = useCallback(
    (options: RouteSearchOptions | null) => {
      if (!options) {
        setRoutePreviewState(null)
        return
      }
      const inputs = {
        guide: alignment,
        source,
        settings: project.settings,
        context: project.context,
        options: project.routeSearch,
      }
      try {
        const result = suggestRoutes(
          alignment.points[0].coordinate,
          alignment.points.at(-1)!.coordinate,
          source,
          project.settings,
          project.context,
          {
            ...options,
            alternatives: 1,
            groundWindowM: resolvedGroundWindow(options, project.terrain.resolutionM),
          },
        )
        setRoutePreviewState({ ...inputs, route: result.routes[0] })
      } catch (cause) {
        setRoutePreviewState({ ...inputs, error: cause instanceof Error ? cause.message : 'No route preview found.' })
      }
    },
    [alignment, source, project.settings, project.context, project.routeSearch, project.terrain.resolutionM],
  )
  const routePreview =
    routePreviewState?.guide === alignment &&
    routePreviewState.source === source &&
    routePreviewState.settings === project.settings &&
    routePreviewState.context === project.context &&
    routePreviewState.options === project.routeSearch
      ? routePreviewState
      : null
  // A saved FSR connection marks its junction, unless a road under review has the highlight.
  const mapFsrTarget = useMemo(() => {
    if (reviewedRoad?.source === source) return null
    const record = alignment.fsrConnection
    if (
      !record ||
      distance(alignment.points[0].coordinate, record.originCoordinate) > 0.1 ||
      distance(alignment.points.at(-1)!.coordinate, record.targetCoordinate) > 0.1
    )
      return null
    if (!project.context.some((road) => road.id === record.targetFeatureId && road.kind === 'existing-road'))
      return null
    return { featureId: record.targetFeatureId, coordinate: record.targetCoordinate, name: record.targetName }
  }, [alignment, source, reviewedRoad, project.context])
  const planOverlay = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [
        ...overlay.features,
        ...(mode === 'trace' ? trace.overlay : []),
        ...(terrainRoadOverlay?.features ?? []),
        ...(terrainRoadsOverlay?.features ?? []),
        ...(networkOverlay?.features ?? []),
        ...(costPreview?.overlay.features ?? []),
        ...project.context
          .filter((road) =>
            mapFsrTarget
              ? road.id === mapFsrTarget.featureId
              : reviewedRoad?.source === source && reviewedRoad.id === road.id,
          )
          .map((road) => ({
            type: 'Feature' as const,
            geometry: road.geometry,
            properties: { kind: 'reviewed-existing-road', color: '#db2777', selected: true, label: road.name },
          })),
        // The access review's end and the junctions it would start from, labelled on the plan.
        ...(accessMarks ?? []).map((mark) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: mark.coordinate },
          properties: { kind: 'access-mark', color: mark.color, label: mark.label },
        })),
        // A focused constraint is outlined ring by ring: the overlay draws lines, not fills.
        ...project.context
          .filter((area) => area.id === focusedConstraintId && area.geometry.type === 'Polygon')
          .flatMap((area) =>
            (area.geometry as GeoJSON.Polygon).coordinates.map((ring) => ({
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: ring },
              properties: { kind: 'focused-constraint', color: '#0f172a', selected: true, label: area.name },
            })),
          ),
        ...(mapFsrTarget
          ? [
              {
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: mapFsrTarget.coordinate },
                properties: { kind: 'fsr-target', color: '#0284c7', label: `FSR junction: ${mapFsrTarget.name}` },
              },
            ]
          : []),
        ...(routeLines ?? []).map(routePreviewFeature),
        // Skid reach: beyond-reach outlines, spur candidates and landing footprints.
        ...(skidReachFeatures ?? []),
        // Every D-line's saved intermediate supports: dots, labelled on hover.
        ...(investigation ? [] : dLineSupportPlanFeatures(project.cables)),
        ...(routePreview?.route
          ? [
              {
                type: 'Feature' as const,
                geometry: { type: 'LineString' as const, coordinates: routePreview.route.coordinates },
                properties: { kind: 'live-route-preview', color: '#e11d48', label: 'Live route preview' },
              },
            ]
          : []),
      ],
    }),
    [
      overlay,
      networkOverlay,
      costPreview,
      routePreview,
      routeLines,
      project.context,
      mapFsrTarget,
      reviewedRoad,
      source,
      focusedConstraintId,
      accessMarks,
      mode,
      trace.overlay,
      terrainRoadOverlay,
      terrainRoadsOverlay,
      skidReachFeatures,
      investigation,
      project.cables,
    ],
  )
  const [selectedSpokeId, setSelectedSpokeId] = useState<string | null>(null)
  const [templatePreview, setTemplatePreview] = useState<{ template: RoadTemplate; name: string } | null>(null)
  const [pegPreview, setPegPreview] = useState<{ base: Alignment; preview: Alignment; source: TerrainSource } | null>(
    null,
  )
  const [selectedCulvertId, setSelectedCulvertId] = useState<string>()
  const [profileRange, setProfileRange] = useState<{ alignmentId: string; range: [number, number] } | null>(null)
  const [activeProfile, setActiveProfile] = useState<string | null>(null)
  const [activeCable, setActiveCable] = useState('')
  const [cableDistance, setCableDistance] = useState(0)
  const deferredHover = useDeferredValue(hover)
  const [playing, setPlaying] = useState(false)
  // An intentional selection takes control from playback; hover is disabled on the plan while it runs.
  const selectStation = useCallback(
    (chainage: number) => {
      setPlaying(false)
      setStation(chainage)
    },
    [setStation],
  )
  const [costOpen, setCostOpen] = useState(false)
  const [exportOutput, setExportOutput] = useState<RoadExport | null>(null)
  const [filesSelected, setFilesSelected] = useState<RoadExport>('project')
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [completeCostOpen, setCompleteCostOpen] = useState(false)
  const [networkOpen, setNetworkOpen] = useState(false)
  const {
    groupName,
    workflow: workflowTab,
    inRibbon: inlineWorkflow,
    selectGroup,
    folded,
    toggleFold,
    minimized,
    toggleMinimized,
    minimizeForCanvas,
    selectWorkflow: setWorkflowTab,
    editorHost,
    attachEditor,
  } = useWorkflowPlacement(active, investigation)
  const inspectHistoryEvidence = useCallback(
    (selection: Omit<AccessHistorySelection, 'revision'>) => {
      setHistorySelection((previous) => ({ ...selection, revision: (previous?.revision ?? 0) + 1 }))
      setWorkflowTab('terrain')
      setCollapsed(false)
      setControlsOpen(true)
    },
    [setWorkflowTab, setCollapsed, setControlsOpen],
  )
  useEffect(() => {
    if (!investigation) return
    setMode('inspect')
    setDraft([])
    setActiveProfile(null)
    setPlaying(false)
    setCollapsed(false)
    setControlsOpen(true)
    setFocusPane('plan')
    setCostOpen(false)
    setExportOutput(null)
    setCompleteCostOpen(false)
    setNetworkOpen(false)
    setTemplatePreview(null)
    setPegPreview(null)
    setCompleteCostPreview(null)
    setRoutePreviewState(null)
    setNetworkPreview(null)
    setRouteLines(null)
    setOverlay({ type: 'FeatureCollection', features: [] })
    setSelectedPoint(null)
    setSelectedCulvertId(undefined)
    setProfileRange(null)
    setFitRevision((revision) => revision + 1)
  }, [investigation, w.projectId, setCollapsed, setControlsOpen, setFocusPane])
  const [roadReviewRequest, setRoadReviewRequest] = useState<{ id?: string; sequence: number }>()
  // Opening the comparison is not an edit: the dialog shows the defaults and writes them only when one is changed.
  const openCompleteCosts = () => setCompleteCostOpen(true)
  // Name of a project waiting for its terrain file; the import then starts it instead of retopping this one.
  const pendingProject = useRef<string | null>(null)
  const pendingStandards = useRef<JobStandards | null>(null)
  // A deleted road and the project it came from: its notice and Undo end when another project opens.
  const [removedRoad, setRemovedRoad] = useState<{ removed: RemovedRoad; opened: number } | null>(null)
  if (removedRoad && removedRoad.opened !== w.openedCount) setRemovedRoad(null)
  const removedHere = removedRoad?.opened === w.openedCount ? removedRoad.removed : null
  const [fileConflict, setFileConflict] = useState<{
    opened: RoadProject
    fileName: string
    existing: LibraryEntry
    keepBothName: string
    openedAt: number
  } | null>(null)
  // A file for someone else carries the road on screen unless every road is asked for.
  const [roadScope, setRoadScope] = useState<RoadScope>('active')
  // A report package is the project's document: it starts with every road, other files with the one in view.
  const [packageScope, setPackageScope] = useState<RoadScope>('all')
  // The Softree location ASCII file's options as set in Save & export; null follows the project.
  const [locationAscii, setLocationAscii] = useState<LocationAsciiOptions | null>(null)
  // The preliminary estimate is a project document too, and shares the package's choice.
  const scopeFor = (kind: RoadExport) =>
    kind === 'report-package' || kind === 'estimate-pdf' ? packageScope : roadScope
  // Read when Save & export opens: the date its documents print while no date of issue is entered.
  const [exportDay, setExportDay] = useState('')
  const [newProjectRequest, setNewProjectRequest] = useState(0)
  const planMap = useRef<MapLibreMap | null>(null)
  const pendingLocate = useRef<Coordinate[] | null>(null)
  const { setNavigationMap } = planDisplay
  const applyPendingFit = useCallback(() => {
    const map = planMap.current
    if (!map || !pendingLocate.current) return
    const container = map.getContainer()
    if (!container.clientWidth || !container.clientHeight) return
    fitPlanPoints(map, pendingLocate.current)
    pendingLocate.current = null
  }, [])
  const onPlanReady = useCallback(
    (map: MapLibreMap | null) => {
      planMap.current = map
      setNavigationMap(map)
      if (map && pendingLocate.current) requestAnimationFrame(applyPendingFit)
    },
    [setNavigationMap, applyPendingFit],
  )
  /** Brings the plan forward and fits it to a context feature, once the plan map exists. */
  const showOnPlan = useCallback(
    (points: Coordinate[]) => {
      if (hiddenPanels.includes('plan')) setHiddenPanels(hiddenPanels.filter((panel) => panel !== 'plan'))
      setFocusPane('plan')
      if (focusMode) setControlsOpen(false)
      pendingLocate.current = points
      requestAnimationFrame(applyPendingFit)
    },
    [hiddenPanels, setHiddenPanels, focusMode, setFocusPane, setControlsOpen, applyPendingFit],
  )
  const locateRoad = useCallback(
    (road: ContextFeature) => {
      setReviewedRoad({ id: road.id, source })
      showOnPlan(contextPoints(road))
    },
    [source, showOnPlan],
  )
  // Stable, so a sidebar tool can cancel its pick on unmount without cancelling it every render.
  const pickHelpers = useRef({ notice: w.setNotice, focusPlan: () => {} })
  useEffect(() => {
    pickHelpers.current = {
      notice: w.setNotice,
      focusPlan: () => {
        setFocusPane('plan')
        if (focusMode) setControlsOpen(false)
      },
    }
  })
  const pickOnPlan = useCallback((prompt: string | null, onPick?: (at: Coordinate) => void) => {
    setPlanPick(prompt && onPick ? { prompt, onPick } : null)
    if (prompt && onPick) {
      pickHelpers.current.notice(prompt)
      pickHelpers.current.focusPlan()
    }
  }, [])
  const locateConstraint = useCallback(
    (area: ContextFeature) => {
      setFocusedConstraintId(area.id)
      showOnPlan(contextPoints(area))
    },
    [showOnPlan],
  )
  const locateReference = (features: readonly LayerFeature[], selectedId: string | null = null) => {
    const keys = new Set(features.map(referenceLayerKey))
    const buffers = selectedId ? [] : (project.cutblockBuffers ?? []).filter(({ layer }) => keys.has(layer))
    setFocusedReferenceId(selectedId)
    changeLayerVisibility([...keys, ...buffers.map(({ layer }) => cutblockBufferKey(layer))], true)
    if (!dockLayers) setLayersOpen(false)
    showOnPlan(
      layerFitPoints([
        ...features,
        ...buffers.flatMap((setting) => cutblockBufferFeatures(setting, project.context, project.reference ?? [])),
      ]),
    )
  }
  const locateHistory = useCallback(
    (coordinates: Coordinate[]) => {
      if (!coordinates.length) return
      showOnPlan(coordinates)
    },
    [showOnPlan],
  )
  // A station typed into the station box is held exactly; every other selection takes a calculated station.
  const [typedStation, setTypedStation] = useState<{ station: number; entered: number; committed: boolean } | null>(
    null,
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const fileKind = useRef<FileKind>('project')
  /** A file picked while the workspace was busy, opened as soon as it is free. */
  const pendingFiles = useRef<{ files: File[]; kind: FileKind } | null>(null)
  const operation = useRef<AbortController | null>(null)
  useDocumentTitle(`${w.project.name} · Forest road design · PGMaps`)
  const themeModeItems = useThemeModeItems()
  useEffect(() => () => operation.current?.abort(), [])

  const terrainProfile = useMemo(() => {
    const saved = project.profiles?.find((p) => p.id === activeProfile)
    const context = project.context.find((p) => p.id === activeProfile && p.geometry.type === 'LineString')
    const points =
      saved?.points ?? (context?.geometry.type === 'LineString' ? (context.geometry.coordinates as Coordinate[]) : null)
    if (!points || points.length < 2) return null
    const a = newAlignment(points, saved?.name ?? context!.name)
    a.id = activeProfile!
    a.points = points.map((coordinate, i) => ({ id: `${activeProfile}-${i}`, coordinate, radiusM: 0 }))
    a.color = '#0284c7'
    return a
  }, [project.profiles, project.context, activeProfile])
  const draftAlignment = useMemo(() => {
    if ((mode !== 'road' && mode !== 'extend') || !draft.length) return null
    let points =
      deferredHover && distance(draft[draft.length - 1], deferredHover) >= 0.2 ? [...draft, deferredHover] : draft
    // An extension previews the whole road it would make, so the profile shows the joined grade.
    if (mode === 'extend' && alignment.points.length >= 2) {
      const road = alignment.points.map((p) => p.coordinate)
      points = nearerEnd(alignment, draft[0]) === 'end' ? [...road, ...points] : [...[...points].reverse(), ...road]
    }
    if (points.length < 2) return null
    return {
      ...newAlignment(
        points,
        mode === 'extend' ? `${alignment.name} · extending` : 'Road being pegged',
        alignment.template,
      ),
      id: 'pegging-preview',
      points: points.map((coordinate, index) => ({ id: `preview-${index}`, coordinate, radiusM: 0 })),
    }
  }, [mode, draft, deferredHover, alignment])
  const templateAlignment = useMemo(
    () =>
      templatePreview
        ? {
            ...alignment,
            template: templatePreview.template,
            engineering: alignment.engineering ? { ...alignment.engineering, assignments: [] } : undefined,
          }
        : null,
    [alignment, templatePreview],
  )
  const numericPegAlignment = pegPreview?.base === alignment && pegPreview.source === source ? pegPreview.preview : null
  const previewPeg = useCallback(
    (preview: Alignment | null) => setPegPreview(preview ? { base: alignment, preview, source } : null),
    [alignment, source],
  )
  const displayedAlignment = investigation
    ? alignment
    : (draftAlignment ??
      terrainProfile ??
      numericPegAlignment ??
      costPreview?.alignment ??
      templateAlignment ??
      alignment)
  // Station labels on screen follow the road's start station and equations (`roadStationing.ts`);
  // a terrain profile and a road being pegged are stationed by chainage.
  const shownStationing = terrainProfile || draftAlignment ? undefined : displayedAlignment.stationing
  setScreenStationing(shownStationing)
  useEffect(() => () => setScreenStationing(undefined), [])
  const completeCostRecord = displayedAlignment === alignment ? alignment.fullCostRecord : undefined
  /** A terrain profile or a mapped road: ground only, so no design quantities or cost in the summary. */
  const groundOnly = !!terrainProfile || (displayedAlignment === alignment && isMappedRoad(alignment))
  const completeCostCurrent = useMemo(
    () => !!completeCostRecord && isFullCostRecordCurrent(alignment, project),
    [completeCostRecord, alignment, project],
  )
  // Drawn while the Sight distance section is open (`planSightlines.ts`).
  const planSightlines = usePlanSightlines()
  // The profile's sight distance band reads the project's design speed and station spacing.
  const sightBand = useMemo(
    () => ({ standards: project.standards, stationIntervalM: project.settings.stationInterval }),
    [project.standards, project.settings.stationInterval],
  )
  // The profile draws tangents over the project's grade rule red.
  const profileGradeLimits = useMemo(
    () => ({ rule: gradeRule(project.settings, project.standards) }),
    [project.settings, project.standards],
  )
  const displayedAnalysis = useMemo(() => {
    if (displayedAlignment === alignment) return analysis
    const result = safeAnalyzeRoad(displayedAlignment, source, project.settings, project.context, {
      referenceSurfaces: w.referenceSurfaces,
      verticalReference: project.terrain.verticalReference,
      sharedCrossingCosts: project.sharedCrossingCosts,
      gradeStandards: project.standards,
    })
    if (!terrainProfile) return result
    const completeLength = result.stations.slice(1).reduce((length, station, index) => {
      const previous = result.stations[index]
      return previous.groundElevation !== null && station.groundElevation !== null
        ? length + station.chainage - previous.chainage
        : length
    }, 0)
    return {
      ...result,
      completeLength,
      coveragePercent: result.length > 0 ? (completeLength / result.length) * 100 : 0,
      maxGradePercent: Math.max(0, ...result.stations.map((s) => Math.abs(s.groundGradePercent ?? 0))),
      cutVolumeM3: 0,
      fillVolumeM3: 0,
      balanceM3: 0,
      estimatedCost: 0,
      surfaceVolumeM3: 0,
      clearingAreaM2: 0,
      stations: result.stations.map((s) => ({
        ...s,
        complete: s.groundElevation !== null,
        designElevation: null,
        gradePercent: s.groundGradePercent,
        cutAreaM2: null,
        fillAreaM2: null,
        cutVolumeM3: null,
        fillVolumeM3: null,
        massM3: null,
        leftDaylightM: null,
        rightDaylightM: null,
        section: s.section.map((x) => ({ ...x, design: null })),
        flags: s.groundElevation === null ? ['No terrain coverage'] : [],
      })),
      warnings: ['Ground-only terrain transect. No formation, earthwork or cost design is assigned.'],
    }
  }, [
    displayedAlignment,
    alignment,
    analysis,
    source,
    project.settings,
    project.context,
    project.terrain.verticalReference,
    project.sharedCrossingCosts,
    project.standards,
    terrainProfile,
    w.referenceSurfaces,
  ])
  useEffect(() => {
    setStation((s) =>
      draftAlignment || numericPegAlignment ? displayedAnalysis.length : Math.min(s, displayedAnalysis.length),
    )
  }, [displayedAnalysis.length, draftAlignment, numericPegAlignment, setStation])
  const displayProject = useMemo(
    () =>
      displayedAlignment === alignment
        ? project
        : {
            ...project,
            alignments:
              displayedAlignment.id === alignment.id
                ? project.alignments.map((a) => (a.id === alignment.id ? displayedAlignment : a))
                : [...project.alignments, displayedAlignment],
            activeAlignmentId: displayedAlignment.id,
          },
    [project, displayedAlignment, alignment],
  )
  const displayAnalyses = useMemo(
    () => new Map([...w.analyses, [displayedAlignment.id, displayedAnalysis]]),
    [w.analyses, displayedAlignment, displayedAnalysis],
  )
  const incompleteReasons = useMemo(() => incompleteReasonSummary(displayedAnalysis.stations), [displayedAnalysis])
  // The cost dialog's "Where it falls" and the plan's "Colour road by → Cost per metre" read one
  // spread of the estimate (`costAttribution.ts`), made only while either is in use.
  const [roadColour, setRoadColour] = useRoadColourMode()
  const [costSeries, setCostSeries] = useState<CostSeriesId>('total')
  const costSpreadWanted =
    !investigation && !terrainProfile && displayedAnalysis.stations.length > 1 && (costOpen || roadColour === 'cost')
  const costAttribution = useMemo(
    () =>
      costSpreadWanted
        ? attributeCosts({
            analysis: displayedAnalysis,
            alignment: displayedAlignment,
            breakdown: costBreakdownRows({
              analysis: displayedAnalysis,
              alignment: displayedAlignment,
              settings: project.settings,
            }),
          })
        : undefined,
    [costSpreadWanted, displayedAnalysis, displayedAlignment, project.settings],
  )
  // A row an edit removed falls back to the whole estimate.
  const shownCostSeries = costAttribution && hasCostSeries(costAttribution, costSeries) ? costSeries : 'total'
  const showWholeEstimate = useCallback(() => setCostSeries('total'), [])
  const planCostColours = useMemo(
    () =>
      costAttribution && roadColour === 'cost'
        ? { attribution: costAttribution, rowId: shownCostSeries, onWholeEstimate: showWholeEstimate }
        : undefined,
    [costAttribution, roadColour, shownCostSeries, showWholeEstimate],
  )
  const colourRoadByCost = (id: CostSeriesId) => {
    setCostSeries(id)
    setRoadColour('cost')
  }
  // A stretch picked in "Where it falls": framed and outlined on the plan, its costliest section
  // selected, the road coloured by that row, and the dialog closed so the plan shows.
  const focusCostStretch = (focus: CostStretchFocus) => {
    w.setFeatureSelection({
      alignmentId: displayedAlignment.id,
      kind: 'range',
      id: `cost-${focus.rowId}-${focus.start}`,
      start: focus.start,
      end: focus.end,
      label: focus.label,
      highlight: 'outline',
    })
    selectStation(focus.peakChainage ?? (focus.start + focus.end) / 2)
    colourRoadByCost(focus.rowId)
    planDisplay.setLegendOpen(true)
    setCostOpen(false)
  }
  const unpricedCount = useMemo(
    () =>
      displayedAnalysis.stations.length
        ? unpricedQuantities(displayedAnalysis, displayedAlignment, project.settings).length
        : 0,
    [displayedAnalysis, displayedAlignment, project.settings],
  )
  // Any other selection (a chart, the slider, a table row) takes a calculated station again.
  if (typedStation && typedStation.station !== w.station) setTypedStation(null)
  const typedHere = typedStation?.station === w.station ? typedStation : null
  // A terrain profile has ground at its calculated stations only, so a typed station takes the nearest.
  const evaluatesTyped = !!typedHere && !terrainProfile
  // The road the displayed analysis was calculated from: its last valid inputs while one is invalid.
  const sampledAlignment = displayedAlignment === alignment ? w.calculatedAlignment : displayedAlignment
  const stationSampler = useMemo(() => {
    if (!evaluatesTyped) return null
    try {
      return createRoadStationSampler(sampledAlignment, source, project.settings, {
        context: project.context,
        referenceSurfaces: w.referenceSurfaces,
        verticalReference: project.terrain.verticalReference,
      })
    } catch {
      // An alignment that cannot be compiled has no section to evaluate; the nearest station stands in.
      return null
    }
  }, [
    evaluatesTyped,
    sampledAlignment,
    source,
    project.settings,
    project.context,
    project.terrain.verticalReference,
    w.referenceSurfaces,
  ])
  const at = useMemo(
    () => roadStationAt(displayedAnalysis, w.station, stationSampler ? (s) => stationSampler.at(s) : undefined),
    [displayedAnalysis, w.station, stationSampler],
  )
  const station = at?.chainage ?? 0
  const stationReadout = {
    station: formatRoadStation(station),
    elevation: formatNumber(at?.groundElevation, { minimumFractionDigits: 1, maximumFractionDigits: 1, fallback: '—' }),
    grade: formatNumber(at?.gradePercent, { minimumFractionDigits: 1, maximumFractionDigits: 1, fallback: '—' }),
  }
  // The memoized sidebar reads the station through RoadStationProvider: live for what it shows,
  // and through this reader for what a click does.
  const committedStation = useRef(station)
  useLayoutEffect(() => {
    committedStation.current = station
  }, [station])
  const readStation = useCallback(() => committedStation.current, [])
  // The header subtitle shows the latest notice briefly, in place of a status row.
  const { notice, setNotice } = w
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 8000)
    return () => window.clearTimeout(timer)
  }, [notice, setNotice])
  // The save line under the title states where the project is kept. Beside the buttons a dot marks
  // a session that will not be kept and a save that failed, in the line's own words, for a header
  // too small to show the line.
  const saveState = saveStateText(w.browserSave, w.fileSave, Date.now())
  const trainingSave = w.browserSave.kind === 'training'
  const saveNotice = w.browserSave.kind === 'failed' || w.browserSave.kind === 'invalid'
  const incompleteSections = useMemo(() => analysis.stations.filter((s) => !s.complete).length, [analysis.stations])
  const planningBasis = [
    ...(project.terrain.kind === 'regional'
      ? [
          `Coarse regional terrain: one ground sample every ${number(project.terrain.resolutionM, 0)} m, enough to screen corridors but not to design from. Load BC LiDAR or your own DEM for site planning`,
        ]
      : []),
    'Concept planning',
    project.terrain.verticalReference,
    project.terrain.kind === 'demo'
      ? 'Synthetic ground, not survey data; load BC LiDAR or your own DEM for site planning'
      : 'Native DEM sampling; missing ground stays missing',
    'earthworks use average end areas; field and engineering review required for construction.',
  ].join(' · ')
  /** Selects exactly the station typed, held to the road, and returns it. */
  const selectTypedStation = (entered: number) => {
    // A station name goes to its chainage: the occurrence nearest the selected station where an
    // equation names it twice, the nearest place where an equation skips it.
    const bounded = hasStationing(shownStationing)
      ? resolveTypedStation(entered, shownStationing, displayedAnalysis.length, { near: station }).chainage
      : Math.max(0, Math.min(displayedAnalysis.length, entered))
    setTypedStation({ station: bounded, entered, committed: false })
    selectStation(bounded)
    return bounded
  }
  // A value outside the line is explained at once; the nearest station only once the entry is finished.
  const typedNote =
    typedHere && (typedHere.committed || typedHere.entered !== typedHere.station)
      ? typedStationNote(
          typedHere.entered,
          at?.chainage ?? null,
          displayedAnalysis.length,
          terrainProfile ? 'terrain profile' : 'road',
          { value: number, station: formatRoadStation },
          shownStationing,
        )
      : null
  const selectCulvert = (id: string) => {
    setSelectedCulvertId(id)
    const culvert = displayedAnalysis.engineering?.culverts.find((c) => c.id === id)
    if (culvert) selectStation(culvert.chainage)
  }
  const currentCulvertId = displayedAnalysis.engineering?.culverts.some((c) => c.id === selectedCulvertId)
    ? selectedCulvertId
    : undefined
  const selectedRange = useMemo(
    () => roadSelectionRange(displayedAlignment, w.featureSelection),
    [displayedAlignment, w.featureSelection],
  )
  const sharedProfileRange = profileRange?.alignmentId === displayedAlignment.id ? profileRange.range : undefined
  // The project's grid for the section readout's centreline easting and northing.
  const sectionGrid = useMemo(() => {
    try {
      return displayedAlignment.points.length
        ? exportGrid(project.terrain, displayedAlignment.points[0].coordinate)
        : undefined
    } catch {
      return undefined
    }
  }, [project.terrain, displayedAlignment.points])
  // Hold scale, the pinned section and Use this section for… (`SectionPaneTools.tsx`).
  const sectionTools = useSectionTools({ alignment, displayedAlignment, analysis: displayedAnalysis })
  const onProfileRange = useCallback(
    (range: [number, number]) => setProfileRange({ alignmentId: displayedAlignment.id, range }),
    [displayedAlignment.id],
  )
  const cableLine = project.cables.find((c) => c.id === activeCable) ?? project.cables[0]
  // A D-line with field shots in use reads them in place of the terrain along it.
  const cableGround = cableLine ? cableGroundSource(cableLine, source) : source
  const cableResult = useMemo(() => {
    try {
      const analysis = cableLine ? analyzeCable(cableLine, cableGround) : null
      return { analysis, summary: cableLine && analysis ? cableSummary(cableLine, analysis) : null, error: '' }
    } catch (error) {
      return {
        analysis: null,
        summary: null,
        error: error instanceof Error ? error.message : 'Invalid D-line geometry.',
      }
    }
  }, [cableLine, cableGround])
  const cableAnalysis = cableResult.analysis
  const cableLayoutOverlay = useCableLayoutOverlay(cableLine, cableGround)
  type CableLineOf = (typeof project.cables)[number]
  const editCable = useCallback(
    (change: (line: CableLineOf) => CableLineOf) => update((p) => ({ ...p, cables: p.cables.map(change) })),
    [update],
  )
  const cableLayoutEdit = useCableLayoutChartEdit(cableLine, cableGround, editCable)
  const saveCableProfile = (kind: 'csv' | 'report' | 'stakeout') => {
    if (!cableLine || !cableAnalysis) return
    try {
      // Supports, their stake-out, a field profile and the rigging set ride after the existing columns.
      const frame = dLineFrame(cableLine)
      const extras = dLineExtras({
        line: cableLine,
        analysis: cableAnalysis,
        terrain: source,
        ground: cableGround,
        layout: shownLayoutResult(cableLine, cableGround),
        grid: frame ? exportGrid(project.terrain, frame.yarder) : undefined,
        riggingSets: project.riggingSets,
      })
      if (kind === 'stakeout') {
        if (!extras.supports || !extras.stakeout) throw Error('This D-line has no supports to stake out.')
        return downloadText(
          supportStakeoutCsv(cableLine.name, extras.supports, extras.stakeout.rows, extras.stakeout.epsg),
          'd-line-supports-stakeout.csv',
          'text/csv;charset=utf-8',
        )
      }
      downloadText(
        kind === 'csv'
          ? cableProfileCsv(cableLine, cableAnalysis, project.terrain, extras)
          : brandedHtml(
              cableProfileHtml(cableLine, cableAnalysis, project.terrain, extras),
              selectedExportBrand,
              printLogo,
            ),
        kind === 'csv' ? 'd-line-profile.csv' : 'd-line-profile.html',
        kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8',
      )
    } catch (error) {
      w.setError(error instanceof Error ? error.message : 'Could not export the D-line profile.')
    }
  }
  const saveSection = () => {
    if (!at) return
    try {
      if (draftAlignment || numericPegAlignment || templatePreview || costPreview)
        throw Error('Finish or close the design preview before exporting calculated results.')
      refuseInvalidResults('Selected-section CSV', displayedAnalysis)
      const template =
        displayedAnalysis.engineering?.stations.find((s) => s.chainage === at.chainage)?.template ??
        displayedAlignment.template
      downloadText(
        crossSectionCsv(at, template, project.terrain, displayedAlignment.name),
        `road-section-${at.chainage.toFixed(3)}m.csv`,
        'text/csv;charset=utf-8',
      )
    } catch (error) {
      w.setError(error instanceof Error ? error.message : 'Could not export the selected section.')
    }
  }
  useEffect(() => setCableDistance((d) => Math.min(d, cableAnalysis?.length ?? 0)), [cableAnalysis?.length])
  useEffect(() => {
    setOverlay({ type: 'FeatureCollection', features: [] })
    setTemplatePreview(null)
    setSelectedSpokeId(null)
    setReviewedRoad(null)
  }, [project.activeAlignmentId, source])
  const selectCable = (id: string) => {
    setActiveCable(id)
    setCableDistance(0)
    setDetail('cable')
    setOverlay({ type: 'FeatureCollection', features: [] })
  }
  // A limit or span picked under Intermediate supports shows its D-line and moves both cursors there.
  useLayoutFocusFollower((cableId, x) => {
    if (cableId !== cableLine?.id || detail !== 'cable') selectCable(cableId)
    if (x !== null) setCableDistance(x)
  })
  const selectProfile = (id: string) => {
    const context = project.context.find((feature) => feature.id === id)
    if (context?.geometry.type === 'LineString' && context.geometry.coordinates.length > 2000) {
      w.setError('Crop this feature to at most 2,000 vertices for a terrain profile.')
      return
    }
    setActiveProfile(id || null)
    w.setStation(0)
    setMode('inspect')
    setDraft([])
    if (id && detail === 'mass') setDetail('section')
  }
  const beginMode = (next: DrawMode) => {
    if (w.busy || (investigation && next !== 'inspect')) return
    if ((next === 'edit' || next === 'extend') && (isMappedRoad(alignment) || awaitingFirstRoad(project))) {
      w.setNotice(
        awaitingFirstRoad(project)
          ? 'Add a road first: peg, sketch or load a mapped road.'
          : 'A mapped road is held as recorded. Copy it as a design to edit or extend it.',
      )
      return
    }
    setMode(next)
    setPegPreview(null)
    setDraft([])
    setHover(null)
    setPlaying(false)
    setOverlay({ type: 'FeatureCollection', features: [] })
    setTemplatePreview(null)
    if (next !== 'inspect') setActiveProfile(null)
  }

  const onDraw = useCallback(
    (coordinate: Coordinate) => {
      if (busy) return
      setDraft((previous) => {
        if (previous.length >= 2000 || (previous.length && distance(previous[previous.length - 1], coordinate) < 0.2))
          return previous
        return [...previous, coordinate]
      })
    },
    [busy],
  )
  // Roads a peg snaps onto (`drawSnap.ts`): every design road as drawn and every existing road line.
  const snapLines = useMemo(() => roadSnapLines(project, w.analyses), [project, w.analyses])
  // Stable, so the plan does not re-register its pointer handlers on every render.
  const setNoticeRef = useRef(w.setNotice)
  useLayoutEffect(() => {
    setNoticeRef.current = w.setNotice
  })
  const onSnap = useCallback(
    (snap: DrawSnap, first: boolean) =>
      setNoticeRef.current(`${snapNotice(snap, first)} Click the next point, or Finish road.`),
    [],
  )
  const selectAlignment = useCallback(
    (id: string) => {
      if (busy) return
      setPlaying(false)
      update((p) => ({ ...p, activeAlignmentId: id }))
      setActiveProfile(null)
      setTemplatePreview(null)
      setOverlay({ type: 'FeatureCollection', features: [] })
      setStation(0)
    },
    [update, setStation, busy],
  )
  /** Brings the Terrain tab's existing-road review forward, on one road when given. */
  const openRoadReview = (id?: string) => {
    setWorkflowTab('terrain')
    setCollapsed(false)
    setControlsOpen(true)
    setRoadReviewRequest((previous) => ({ id, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const [engineeringRequest, setEngineeringRequest] = useState(0)
  const [engineeringInputsRequest, setEngineeringInputsRequest] = useState<{
    tab: EngineeringInputTab
    sequence: number
  }>()
  function showEngineeringInputs(tab: EngineeringInputTab) {
    showControls('engineering')
    setEngineeringInputsRequest((previous) => ({ tab, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  /** Opens the culvert inputs, at a station when a crossing asked for it. */
  const showCulverts = useCallback(
    (chainage?: number) => {
      setWorkflowTab('engineering')
      setEngineeringRequest((n) => n + 1)
      if (chainage !== undefined) setStation(chainage)
    },
    [setStation, setWorkflowTab],
  )
  /** Refuses a plan edit the road could not be built to (`planEditCheck.ts`), and says why. */
  const refusedPlanEdit = useCallback(
    (next: Alignment) => {
      const refusal = checkPlanEdit(alignment, next, project.settings.minRadius, { context: project.context })
      if (refusal) setNotice(refusal.message)
      return !!refusal
    },
    [alignment, project.settings.minRadius, project.context, setNotice],
  )
  const movePoint = useCallback(
    (id: string, coordinate: Coordinate) => {
      if (busy) return
      const moved = (a: Alignment) => ({
        ...a,
        points: a.points.map((p) => (p.id === id ? { ...p, coordinate } : p)),
      })
      if (refusedPlanEdit(moved(alignment))) return
      updateAlignment(moved)
      const kept = profileKeptNotice(alignment.vertical.length)
      if (kept) setNotice(kept)
    },
    [updateAlignment, busy, alignment, refusedPlanEdit, setNotice],
  )
  const commitValidated = (next: RoadProject) => {
    if (busy) return false
    try {
      // Keep unchanged parts as they were, so the undo history names only what this edit changed.
      w.commit(shareUnchanged(project, parseProject(next)))
      w.setError('')
      return true
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not apply this project edit.')
      return false
    }
  }
  /** Pegs from the plan's grade-held peg tool, added to the active road's end in one edit. */
  const pegOnPlan =
    busy || costPreview || displayedAlignment !== alignment || isMappedRoad(alignment) || awaitingFirstRoad(project)
      ? undefined
      : (coordinates: Coordinate[]) => {
          const pegs = coordinates.map((coordinate) => ({ id: uid(), coordinate, radiusM: 0 }))
          if (refusedPlanEdit({ ...alignment, points: [...alignment.points, ...pegs] })) return false
          const added = commitValidated({
            ...project,
            alignments: project.alignments.map((a) =>
              a.id === alignment.id ? { ...a, points: [...a.points, ...pegs] } : a,
            ),
          })
          if (added) {
            const edit = `${pegs.length} ${pegs.length === 1 ? 'peg' : 'pegs'} added`
            w.setNotice(profileKeptNotice(alignment.vertical.length, edit) ?? `${edit}. Undo removes them.`)
          }
          return added
        }
  const showLoadedRoads = () => {
    setMode('inspect')
    setDraft([])
    setActiveProfile(null)
    setSelectedPoint(null)
    setWorkflowTab('design')
    setCollapsed(false)
    setControlsOpen(true)
    w.setStation(0)
  }
  /**
   * Loads every mapped road with a part in the plan's view as its own road, each in its own colour,
   * so the road switcher moves between them. From an investigation this starts the design.
   */
  const loadMappedRoadsInView = () => {
    if (w.busy) return
    const view = planMap.current?.getBounds()
    const bounds: [number, number, number, number] | null = view
      ? [view.getWest(), view.getSouth(), view.getEast(), view.getNorth()]
      : null
    const already = new Set(investigation ? [] : project.alignments.flatMap((a) => a.mappedRoad?.contextIds ?? []))
    const seeds = loadableMappedRoads(project.context)
      .map((group) => group.feature)
      .filter((feature) => !bounds || mappedRoadInBounds(feature, project.context, bounds))
      .filter((feature) => !already.has(feature.id))
    if (!seeds.length) {
      w.setNotice(
        bounds
          ? 'No mapped road in view that is not already loaded. Pan or zoom out to take in more.'
          : 'No mapped roads to load.',
      )
      return
    }
    const existing = investigation ? [] : project.alignments.filter((a) => a.id !== project.designPlaceholderId)
    const result = loadMappedRoads({
      seeds,
      context: project.context,
      template: alignment.template,
      terrainResolutionM: project.terrain.resolutionM,
      pointBudget: MAX_PROJECT_POINTS - existing.reduce((n, a) => n + a.points.length, 0),
      roadBudget: MAX_PROJECT_ROADS - existing.length,
      newId: uid,
      usedColors: existing.map((a) => a.color),
    })
    if (!result.alignments.length) {
      w.setError(`No road could be loaded: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`)
      return
    }
    // Start on the road the terrain covers best, then the one nearest the middle of the view — not
    // the first by name: a long FSR that runs off the terrain would open with an empty profile.
    const centre = planMap.current?.getCenter()
    const terrainBox = terrainBounds(project.terrain)
    const covered = (a: Alignment) =>
      terrainBox
        ? a.points.filter(
            ({ coordinate: [lng, lat] }) =>
              lng >= terrainBox[0] && lng <= terrainBox[2] && lat >= terrainBox[1] && lat <= terrainBox[3],
          ).length / a.points.length
        : 1
    const nearest = (a: Alignment) =>
      centre ? Math.min(...a.points.map((p) => distance([centre.lng, centre.lat], p.coordinate))) : 0
    const activeId = [...result.alignments].sort((a, b) => covered(b) - covered(a) || nearest(a) - nearest(b))[0].id
    if (
      !commitValidated(
        investigation
          ? { ...startInvestigationDesign(project, result.alignments), activeAlignmentId: activeId }
          : withAddedAlignments(project, result.alignments, activeId),
      )
    )
      return
    showLoadedRoads()
    const skipped = result.skipped.length
      ? ` Not loaded: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`
      : ''
    w.setNotice(
      `Loaded ${result.alignments.length} mapped road${result.alignments.length === 1 ? '' : 's'} in view, each in its own colour. Switch between them with Viewing road.${skipped}`,
    )
  }
  /** Loads a mapped road as a road held as recorded; from an investigation, this starts the design. */
  const loadMappedRoad = (featureId: string) => {
    if (w.busy) return
    const feature = project.context.find((candidate) => candidate.id === featureId)
    if (!isLoadableMappedRoad(feature)) {
      w.setError('Only a mapped road line can be loaded as a road.')
      return
    }
    const loaded = project.alignments.find((a) => a.mappedRoad?.contextIds.includes(featureId))
    if (loaded && !investigation) {
      selectAlignment(loaded.id)
      setWorkflowTab('design')
      setFitRevision((n) => n + 1)
      w.setNotice(`${loaded.name} is already loaded; it is now the active road.`)
      return
    }
    if (!investigation && roadCount(project) >= MAX_PROJECT_ROADS) {
      w.setError(`A project holds at most ${MAX_PROJECT_ROADS} roads. Remove one before loading another.`)
      return
    }
    try {
      const road = mappedRoadAlignment({
        seed: feature,
        context: project.context,
        id: uid(),
        template: alignment.template,
        terrainResolutionM: project.terrain.resolutionM,
        pointBudget: MAX_PROJECT_POINTS - (investigation ? 0 : pointsInUse(project)),
        color: nextMappedRoadColor(investigation ? [] : project.alignments.map((a) => a.color)),
      })
      if (
        !commitValidated(
          investigation ? startInvestigationDesign(project, [road]) : withAddedAlignments(project, [road]),
        )
      )
        return
      showLoadedRoads()
      setFitRevision((n) => n + 1)
      const origin = road.mappedRoad!
      w.setNotice(
        `Loaded ${feature.name} as mapped: ${road.points.length} points from ${origin.sourceVertexCount} vertices` +
          `${origin.contextIds.length > 1 ? ` in ${origin.contextIds.length} parts` : ''}. Its formation follows the ground; it is not a proposed design.`,
      )
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not load this mapped road.')
    }
  }
  /** An editable design on the active mapped road's line, or on a fitted alignment of it. */
  const copyMappedRoad = (points?: DesignPoints) => {
    if (!isMappedRoad(alignment)) return
    if (roadCount(project) >= MAX_PROJECT_ROADS) {
      w.setError(`A project holds at most ${MAX_PROJECT_ROADS} roads. Remove one before copying this road.`)
      return
    }
    const copy = designFromMappedRoad(alignment, uid(), colors[project.alignments.length % colors.length], points)
    if (!commitValidated(withAddedAlignments(project, [copy]))) return
    setActiveProfile(null)
    w.setNotice(`${copy.name} is an editable design on the mapped line. The mapped road is kept for comparison.`)
  }
  /**
   * A finished pencil stroke: it continues the active road when it starts or ends at one of its
   * ends, and is otherwise a new road. The pencil stays in hand for the next stroke.
   */
  const finishSketch = (stroke: Coordinate[], metresPerPixel: number) => {
    if (w.busy) return
    const points = sketchPoints(stroke, metresPerPixel)
    if (points.length < 2 || pathLengthM(points) < 5) {
      w.setNotice('Drag further to sketch a road.')
      return
    }
    const extendable = !awaitingFirstRoad(project) && !isMappedRoad(alignment)
    const continuation = extendable ? strokeContinuation(alignment, points, metresPerPixel) : null
    if (continuation) {
      try {
        const next = extendAlignment(alignment, continuation.added, continuation.end, uid, project.settings.minRadius)
        if (!commitValidated({ ...project, alignments: project.alignments.map((a) => (a.id === next.id ? next : a)) }))
          return
        w.setNotice(`Extended ${alignment.name} from its ${continuation.end}. Sketch again to keep going.`)
      } catch (cause) {
        w.setError(cause instanceof Error ? cause.message : 'Could not extend this road.')
      }
      return
    }
    if (roadCount(project) >= MAX_PROJECT_ROADS) {
      w.setError(`A project holds at most ${MAX_PROJECT_ROADS} roads. Remove one before sketching another.`)
      return
    }
    const road = generatedAlignment(
      points,
      `Sketched road ${roadCount(project) + 1}`,
      alignment.template,
      project.settings.minRadius,
    )
    if (!commitValidated(withAddedAlignments(project, [road]))) return
    setActiveProfile(null)
    w.setStation(0)
    w.setNotice(
      `Sketched a road with ${road.points.length} points and ${project.settings.minRadius} m curves where they fit. Start a stroke at its end to continue it.`,
    )
  }
  // The plan holds its stroke listeners for the whole sketch; a stable handler keeps it from
  // dropping a stroke when the page re-renders mid-drag.
  const finishSketchRef = useRef(finishSketch)
  useLayoutEffect(() => {
    finishSketchRef.current = finishSketch
  })
  const onSketch = useCallback((stroke: Coordinate[], metresPerPixel: number) => {
    finishSketchRef.current(stroke, metresPerPixel)
  }, [])
  // A road held as recorded, or a design with no road, has no points to edit.
  useEffect(() => {
    if ((mode === 'edit' || mode === 'extend') && (isMappedRoad(alignment) || awaitingFirstRoad(project)))
      setMode('inspect')
  }, [mode, alignment, project])
  const finishDraw = () => {
    if (busy || draft.length < minimumDraftPoints(mode)) return
    if (mode === 'road') {
      const next = newAlignment(draft, `Road ${roadCount(project) + 1}`, alignment.template)
      if (!commitValidated(withAddedAlignments(project, [next]))) return
      setSelectedPoint(next.points[0].id)
    } else if (mode === 'extend') {
      try {
        const end = nearerEnd(alignment, draft[0])
        const next = extendAlignment(alignment, draft, end, uid, project.settings.minRadius)
        if (!commitValidated({ ...project, alignments: project.alignments.map((a) => (a.id === next.id ? next : a)) }))
          return
        w.setNotice(
          `Extended ${alignment.name} from its ${end} by ${draft.length} point${draft.length === 1 ? '' : 's'}.`,
        )
      } catch (cause) {
        w.setError(cause instanceof Error ? cause.message : 'Could not extend this road.')
        return
      }
    } else if (mode === 'profile') {
      const next = { id: uid(), name: `Terrain profile ${(project.profiles?.length ?? 0) + 1}`, points: draft }
      if (!commitValidated({ ...project, profiles: [...(project.profiles ?? []), next] })) return
      setActiveProfile(next.id)
      if (detail === 'mass') setDetail('section')
    } else if (mode === 'cable') {
      const next = {
        id: uid(),
        name: `D-line ${project.cables.length + 1}`,
        start: draft[0],
        end: draft[draft.length - 1],
        startHeight: 18,
        endHeight: 8,
        deflectionPercent: 5,
      }
      if (!commitValidated({ ...project, cables: [...project.cables, next] })) return
      setActiveCable(next.id)
      setDetail('cable')
    } else if (mode === 'avoid' && polygonKind === 'drainage') {
      setGroundDrainageArea({
        source: 'drawn',
        name: 'Drawn area',
        geometry: { type: 'Polygon', coordinates: [[...draft, draft[0]]] },
      })
    } else if (mode === 'stream' || mode === 'avoid') {
      const kind = mode === 'avoid' ? (polygonKind === 'drainage' ? 'avoid' : polygonKind) : mode
      const feature = {
        id: uid(),
        name: `${kind === 'stream' ? 'Stream' : kind === 'harvest' ? 'Harvest block' : 'Avoidance area'} ${project.context.length + 1}`,
        kind,
        ...(kind === 'harvest'
          ? {
              harvestEvidence: { source: 'user' as const, status: 'proposed' as const, yearMethod: 'unknown' as const },
            }
          : {}),
        geometry:
          mode === 'stream'
            ? { type: 'LineString' as const, coordinates: draft }
            : { type: 'Polygon' as const, coordinates: [[...draft, draft[0]]] },
      }
      if (!commitValidated({ ...project, context: [...project.context, feature] })) return
    } else if (mode === 'trace') {
      try {
        const { coordinates, origin } = trace.resolve()
        const name = `Traced road ${project.context.filter((f) => f.roadEvidence?.lineOrigin && f.roadEvidence.lineOrigin.method !== 'terrain-relocation').length + 1}`
        const feature = roadLineFeature({ id: uid(), name, coordinates, origin })
        if (!commitValidated({ ...project, context: [...project.context, feature] })) return
        w.setNotice(
          `Added ${name} as an existing road (${describeLineOrigin(origin)}). Its condition is unknown; pick it as the road to connect to under Access from FSR.`,
        )
      } catch (cause) {
        w.setError(cause instanceof Error ? cause.message : 'Could not trace this road.')
        return
      }
    }
    setDraft([])
    setHover(null)
    setMode('inspect')
    w.setStation(0)
  }
  /** A named point as a road point: the first peg of a new road, or the next peg of the one being drawn. */
  const pegAt = (at: Coordinate, name: string) => {
    if (w.busy || investigation) return
    if (mode === 'road' || mode === 'extend') {
      onDraw(at)
      w.setNotice(`Pegged ${name}. Click the next point, or Finish road.`)
      return
    }
    if (roadCount(project) >= MAX_PROJECT_ROADS) {
      w.setError(`A project holds at most ${MAX_PROJECT_ROADS} roads. Delete one first.`)
      return
    }
    beginMode('road')
    setDraft([at])
    if (focusMode) setControlsOpen(false)
    w.setNotice(`Pegging a road from ${name}. Click the next points on the plan, then Finish road.`)
  }
  /** Puts the active road's start or end exactly on a named point. */
  const moveRoadEnd = (at: Coordinate, name: string, end: 'start' | 'end') => {
    if (w.busy || investigation || isMappedRoad(alignment) || awaitingFirstRoad(project)) return
    const point = end === 'start' ? alignment.points[0] : alignment.points[alignment.points.length - 1]
    if (
      !commitValidated({
        ...project,
        alignments: project.alignments.map((a) =>
          a.id === alignment.id
            ? { ...a, points: a.points.map((p) => (p.id === point.id ? { ...p, coordinate: at } : p)) }
            : a,
        ),
      })
    )
      return
    w.setNotice(`${alignment.name} now ${end === 'start' ? 'starts' : 'ends'} at ${name}.`)
  }
  const run = async (
    message: string,
    action: (signal: AbortSignal) => Promise<void>,
    cancellation?: { label: string; notice: string },
    propagateError = false,
  ) => {
    if (w.busy) {
      if (propagateError) throw Error('Wait for the current operation to finish.')
      return
    }
    setMode('inspect')
    setDraft([])
    setPlaying(false)
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    w.setBusy(message)
    if (cancellation)
      w.setBusyCancel({
        label: cancellation.label,
        onCancel: () => {
          controller.abort()
          w.setNotice(cancellation.notice)
        },
      })
    w.setError('')
    try {
      await action(controller.signal)
      if (propagateError && controller.signal.aborted)
        throw controller.signal.reason ?? new DOMException('Loading cancelled.', 'AbortError')
    } catch (error) {
      if (!controller.signal.aborted) w.setError(error instanceof Error ? error.message : 'Operation failed.')
      if (propagateError) throw error
    } finally {
      if (operation.current === controller) w.setBusy('')
    }
  }
  const checkDrainage = () =>
    void run('Routing flow on the existing and design surfaces…', async () => {
      // Let the busy state paint before a second or two of synchronous routing.
      await new Promise((resolve) => setTimeout(resolve, 30))
      const grid = localMetricGrid(alignment.points[0].coordinate)
      const result = runDrainage({
        terrain: source,
        analysis,
        culverts: alignment.engineering?.culverts ?? [],
        toGrid: grid.toGrid,
        toLonLat: grid.toLonLat,
        // A RoadEng TIN is routed at its own spacing, not at the cell of the grid kept over its box.
        resolutionM: terrainGridCellM(project.terrain),
        settings: drainageSettings,
        pourPoint: project.drainage?.pourPoint,
        watershedMinAreaHa: project.drainage?.watershedMinAreaHa,
      })
      // Keep runs only for roads that still exist, and at most three: each holds tens of
      // megabytes of grids, and an older run is a few seconds to recompute.
      setDrainage((runs) =>
        new Map(
          [...runs].filter(([id]) => id !== alignment.id && project.alignments.some((a) => a.id === id)).slice(-2),
        ).set(alignment.id, {
          run: result,
          inputs: {
            fingerprint: drainageFingerprint,
            source,
          },
        }),
      )
      const evidence = createDrainageEvidence(result, drainageInput)
      update((p) => ({
        ...p,
        drainage: {
          ...p.drainage,
          settings: drainageSettings,
          records: [
            ...(p.drainage?.records ?? []).filter(
              (r) => r.alignmentId !== alignment.id && p.alignments.some((a) => a.id === r.alignmentId),
            ),
            evidence,
          ],
        },
      }))
      const redirected = result.crossings.filter((c) => c.redirected && !c.throughCulvertId).length
      w.setNotice(
        `Drainage: ${result.crossings.length} stream crossing${result.crossings.length === 1 ? '' : 's'}, ${redirected} carried along the road, ${result.lowPoints.filter((p) => !p.throughCulvert).length} cross-drain candidates without a culvert.`,
      )
    })
  const drainageEntry = drainage.get(alignment.id)
  const drainageEvidence = project.drainage?.records.find((record) => record.alignmentId === alignment.id)
  const drainageStale =
    !!(drainageEntry || drainageEvidence) &&
    (drainageEntry
      ? drainageEntry.inputs.fingerprint !== drainageFingerprint || drainageEntry.inputs.source !== source
      : !drainageEvidence ||
        drainageEvidence.fingerprint !== drainageFingerprint ||
        drainageEvidenceNeedsRecompute(drainageEvidence, project.terrain))
  /** Drawn on the plan only while current, so an outdated run never reads as the present road. */
  const drainageOnPlan =
    !drainageStale && !terrainProfile ? (drainageEntry?.run.plan ?? drainageEvidence?.features) : undefined
  const changeDrainageSettings = (next: DrainageSettings) => {
    update((p) => ({ ...p, drainage: { ...p.drainage, settings: next, records: p.drainage?.records ?? [] } }))
    try {
      localStorage.setItem(DRAINAGE_SETTINGS_KEY, JSON.stringify(next))
    } catch {
      // Storage can be unavailable (private windows); the settings still apply to this session.
    }
  }
  const changePourPoint = (pourPoint: PourPoint | undefined) => {
    update((p) => ({
      ...p,
      drainage: { ...p.drainage, settings: drainageSettings, records: p.drainage?.records ?? [], pourPoint },
    }))
    setDrainagePicking(null)
  }
  const exportDrainage = (kind: 'geojson' | 'evidence') => {
    try {
      if (!drainageEvidence) throw Error('Run drainage before exporting its evidence.')
      if (drainageStale) throw Error('Drainage evidence is out of date. Re-run before exporting current results.')
      const content =
        kind === 'geojson'
          ? drainageEvidenceGeoJson(drainageEvidence, drainageFingerprint, { hasLiveRun: !!drainageEntry })
          : drainageEvidence
      downloadText(
        JSON.stringify(content, null, 2),
        `${project.name.replace(/[^a-z0-9_-]+/gi, '-')}-drainage.${kind === 'geojson' ? 'geojson' : 'json'}`,
        'application/json',
      )
    } catch (error) {
      w.setError(error instanceof Error ? error.message : 'Could not export drainage evidence.')
    }
  }
  const saveDrainageComparison = (label: string) => {
    try {
      if (!drainageEvidence || drainageStale)
        throw Error('Run drainage with the current inputs before saving a comparison.')
      const snapshot = createDrainageComparison(drainageEvidence, label)
      const comparisons = parseDrainageComparisons([
        ...(project.drainage?.comparisons ?? []).filter((r) => project.alignments.some((a) => a.id === r.alignmentId)),
        snapshot,
      ])
      update((p) => ({ ...p, drainage: { ...p.drainage!, comparisons } }))
      w.setNotice(`Saved drainage comparison: ${snapshot.label}.`)
    } catch (error) {
      w.setError(error instanceof Error ? error.message : 'Could not save drainage comparison.')
    }
  }
  const exportDrainageComparisons = (baselineId: string) => {
    try {
      const records = (project.drainage?.comparisons ?? []).filter((r) => r.alignmentId === alignment.id)
      const content = drainageComparisonsExport(records, baselineId)
      downloadText(
        JSON.stringify(content, null, 2),
        `${project.name.replace(/[^a-z0-9_-]+/gi, '-')}-drainage-comparisons.json`,
        'application/json',
      )
    } catch (error) {
      w.setError(error instanceof Error ? error.message : 'Could not export drainage comparisons.')
    }
  }
  // A sample replaces the open project, so it is asked first; the regional DEM only changes this one's terrain.
  const [sampleRequest, setSampleRequest] = useState<'lidar' | 'demo' | null>(null)
  const requestTerrain = (kind: 'lidar' | 'regional' | 'demo') =>
    kind === 'regional' ? loadTerrain(kind) : setSampleRequest(kind)
  const loadTerrain = (kind: 'lidar' | 'regional' | 'demo') =>
    void run('Loading terrain…', async (signal) => {
      if (kind === 'demo') {
        await w.flush()
        w.startProject(createDemoProject(), demoTerrain)
        w.setNotice('Opened the training example as a new project. Your previous project is under Projects.')
      } else if (kind === 'lidar') {
        const loaded = await loadRoadScenario('bc-lidar', { signal, onProgress: w.setBusy })
        if (signal.aborted) return
        await w.flush()
        if (signal.aborted) return
        w.startProject(loaded.project, loaded.source)
        w.setNotice(loaded.notice)
      } else {
        const loaded = await loadRegionalTerrain(boundsOf(project), signal)
        if (signal.aborted) return
        w.setSource(loaded.source)
        w.commit({
          ...project,
          terrain: loaded.metadata,
          scenario: undefined,
        })
        w.setNotice('Regional reconnaissance DEM loaded. Quantities use this coarser source.')
      }
      w.enablePersistence()
      beginMode('inspect')
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
      w.setStation(0)
    })
  const openDetailArea = (start?: { source: DetailSource; areaId?: string }) => {
    setDetailStart(start ?? null)
    setImportedDetailAreas(null)
    showPane('plan')
    const bounds = planMap.current?.getBounds()
    setDetailView(
      bounds
        ? [
            [bounds.getWest(), bounds.getSouth()],
            [bounds.getEast(), bounds.getSouth()],
            [bounds.getEast(), bounds.getNorth()],
            [bounds.getWest(), bounds.getNorth()],
          ]
        : [],
    )
    setDetailOpen(true)
  }
  const loadDetailArea = (area: DetailWindow, nearbyFsr: boolean) => {
    setDetailOpen(false)
    setDetailBox(null)
    void run('Loading 1 m DEM…', async (signal) => {
      const [terrain, roads] = await Promise.allSettled([
        loadHrdemArea(area, signal),
        nearbyFsr
          ? loadDetailFsrs([{ id: 'area', name: 'Selected area', window: area }], signal)
          : Promise.resolve({ roads: [], failures: [] }),
      ])
      if (signal.aborted) return
      if (terrain.status === 'rejected') throw terrain.reason
      const fsrs = roads.status === 'fulfilled' ? roads.value.roads : []
      w.setSource(terrain.value.source)
      w.update((current) => {
        const context = new Map(current.context.map((f) => [f.id, f]))
        for (const road of fsrs) context.set(road.id, refreshExistingRoadFeature(road, context.get(road.id)))
        return { ...current, terrain: terrain.value.metadata, scenario: undefined, context: [...context.values()] }
      }, 'Load 1 m DEM')
      w.enablePersistence()
      planDisplay.fit('terrain')
      w.setNotice(
        `NRCan 1 m DEM loaded · ${terrain.value.coveragePercent.toFixed(1)}% coverage.${nearbyFsr ? (roads.status === 'fulfilled' ? ` ${fsrs.length} nearby active FSR records loaded for review.${roads.value.failures.length ? ' Some FSR areas were not read.' : ''}` : ` Nearby FSRs not read: ${roads.reason instanceof Error ? roads.reason.message : 'the road service failed'}.`) : ''}`,
      )
    })
  }
  const loadLidarBcFiles = (
    area: { coordinates: Coordinate[]; bufferM: number },
    files: File[],
    cellFactor: number,
  ) => {
    setDetailOpen(false)
    setDetailBox(null)
    void run('Reading LidarBC DEM files…', async () => {
      const loaded = await readLocalDemWindow(files, area, {
        name: 'LidarBC · bare-earth terrain',
        verticalReference: LIDAR_BC_VERTICAL_REFERENCE,
        sourceLabel: 'LidarBC DEM tiles downloaded from lidar.gov.bc.ca',
        cellFactor,
      })
      w.setSource(loaded.source)
      w.update((current) => ({ ...current, terrain: loaded.metadata, scenario: undefined }), 'Load LidarBC DEM')
      w.enablePersistence()
      planDisplay.fit('terrain')
      const empty = loaded.read.filter((r) => !r.hadData).map((r) => r.name)
      w.setNotice(
        `LidarBC DEM loaded · ${loaded.coveragePercent.toFixed(1)}% of the area has elevations.${empty.length ? ` No elevations here in ${empty.join(', ')}.` : ''}${loaded.outside.length ? ` Outside this area: ${loaded.outside.join(', ')}.` : ''}`,
      )
    })
  }
  const loadCdedFiles = (area: { coordinates: Coordinate[]; bufferM: number }, files: File[]) => {
    setDetailOpen(false)
    setDetailBox(null)
    void run('Reading CDED files…', async () => {
      const { cdedFromDownload, cdedWindow } = await import('./dev-forestry-roads/cdedDem')
      const bytes = await Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())))
      const grids = bytes.map((b, i) => cdedFromDownload(b, files[i].name))
      const loaded = await cdedWindow(grids, area, bytes)
      w.setSource(loaded.source)
      w.update((current) => ({ ...current, terrain: loaded.metadata, scenario: undefined }), 'Load BC CDED terrain')
      w.enablePersistence()
      planDisplay.fit('terrain')
      w.setNotice(
        `BC CDED terrain loaded from ${loaded.used.join(', ')} · ${loaded.coveragePercent.toFixed(1)}% of the area has elevations. It is about as coarse as regional terrain: screening only.`,
      )
    })
  }
  const downloadDetailAreas = (boxes: DemBox[], nearbyFsr: boolean) => {
    setDetailOpen(false)
    setDetailBox(boxes.map((b) => b.window.quad))
    void run(
      'Preparing 1 m DEM download…',
      async (signal) => {
        const [archive, records] = await Promise.allSettled([
          downloadHrdemBoxes(boxes, signal, w.setBusy),
          nearbyFsr ? loadDetailFsrs(boxes, signal) : Promise.resolve({ roads: [], failures: [] }),
        ])
        if (signal.aborted) return
        if (archive.status === 'rejected') throw archive.reason
        const roads = records.status === 'fulfilled' ? records.value.roads : []
        if (roads.length)
          w.update((current) => {
            const context = new Map(current.context.map((f) => [f.id, f]))
            for (const road of roads) context.set(road.id, refreshExistingRoadFeature(road, context.get(road.id)))
            return { ...current, context: [...context.values()] }
          }, 'Load nearby FSR records')
        downloadBlob(
          new Blob([Uint8Array.from(archive.value.bytes)], { type: 'application/zip' }),
          'nrcan-1m-dem-areas.zip',
        )
        w.setNotice(
          `${archive.value.succeeded} 1 m DEMs downloaded; ${archive.value.failed} boxes not read (see coverage report).${nearbyFsr ? ` ${roads.length} active FSR records loaded.${records.status === 'rejected' || records.value.failures.length ? ' Some FSR areas were not read.' : ''}` : ''}`,
        )
      },
      { label: 'Cancel DEM download', notice: 'DEM download cancelled.' },
    )
  }
  /** The standards entered in New project, written into the project it creates. */
  const withNewProjectStandards = (created: RoadProject) => {
    const job = pendingStandards.current
    pendingStandards.current = null
    return job ? parseProject(applyJobStandardsToNewProject(created, job)) : created
  }
  /**
   * A new project on `terrain` with no road. A project file always holds one alignment, so the
   * design keeps a hidden placeholder at `centre` (`designPlaceholderId`) until the first road is
   * pegged, sketched or loaded; it is never drawn, analysed or counted.
   */
  const startOn = (name: string, terrain: RoadProject['terrain'], terrainSource: TerrainSource, centre: Coordinate) => {
    const placeholder = starterAlignment(centre)
    w.startProject(
      withNewProjectStandards(
        parseProject({
          ...createDemoProject(),
          name,
          terrain,
          alignments: [placeholder],
          activeAlignmentId: placeholder.id,
          workspaceMode: 'design',
          designPlaceholderId: placeholder.id,
          context: [],
          cables: [],
          profiles: [],
          settings: project.settings,
        }),
      ),
      terrainSource,
    )
    setMode('inspect')
  }
  const createProject = (start: NewProject) => {
    pendingStandards.current = start.standards ?? null
    if (start.kind === 'import') {
      requestFile('terrain', start.name)
      return
    }
    if (start.kind === 'files') {
      // Placed on the files: the regional DEM under their roads and blocks, then the same import
      // review as Layers → Add folder, on the new project.
      void run('Reading map layers…', async (signal) => {
        const decoded = await readReferenceImport(start.files, signal)
        if (signal.aborted) return
        const extent =
          designExtent(
            decoded.filter((file) => file.selected ?? true).map((file) => ({ file, role: suggestedLayerRole(file) })),
          ) ?? layersExtent(decoded)
        if (!extent)
          throw Error(
            'None of these files says where the block is. Choose its shapefiles, GeoJSON, KML or company map PDFs.',
          )
        const centre: Coordinate = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]
        w.setBusy('Loading regional terrain…')
        const loaded = await loadRegionalTerrain(
          [extent[0] - 0.006, extent[1] - 0.004, extent[2] + 0.006, extent[3] + 0.004],
          signal,
        )
        if (signal.aborted) return
        await w.flush()
        startOn(start.name, loaded.metadata, loaded.source, centre)
        // A regional terrain: the sheet's contours, where offered, start chosen.
        setLayerImportFiles(decoded.map((file) => (file.pdf?.contourSurface ? { ...file, selected: true } : file)))
        w.setNotice(`Started ${start.name} on the regional DEM. Choose what to import from the files.`)
        setActiveProfile(null)
        setFitRevision((n) => n + 1)
      })
      return
    }
    void run('Starting a new project…', async (signal) => {
      if (start.kind === 'training') {
        await w.flush()
        w.startProject(withNewProjectStandards({ ...createDemoProject(), name: start.name }), demoTerrain)
      } else if (start.kind === 'lidar') {
        const loaded = await loadRoadScenario('bc-lidar', { signal, onProgress: w.setBusy })
        if (signal.aborted) return
        await w.flush()
        if (signal.aborted) return
        w.startProject(withNewProjectStandards({ ...loaded.project, name: start.name }), loaded.source)
      } else {
        const [lon, lat] = start.centre
        const dLat = start.sizeKm / 2 / 111.32,
          dLon = dLat / Math.cos((lat * Math.PI) / 180)
        w.setBusy('Loading regional terrain…')
        const loaded = await loadRegionalTerrain([lon - dLon, lat - dLat, lon + dLon, lat + dLat], signal)
        if (signal.aborted) return
        await w.flush()
        startOn(start.name, loaded.metadata, loaded.source, start.centre)
      }
      w.setNotice(
        start.kind === 'regional'
          ? `Started ${start.name}. Peg or sketch the first road, or load a mapped road.`
          : `Started ${start.name}.`,
      )
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
    })
  }
  const switchProject = (id: string) =>
    void run('Opening project…', async (signal) => {
      await w.openProject(id, signal)
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
      w.setNotice('Opened from this browser’s projects.')
    })
  const openScenario = (id: RoadScenarioId) =>
    void run(
      'Loading scenario terrain and context…',
      async (signal) => {
        const loaded = await loadRoadScenario(id, { signal, onProgress: w.setBusy })
        if (signal.aborted) return
        await w.flush()
        if (signal.aborted) return
        w.startProject(loaded.project, loaded.source)
        beginMode('inspect')
        setActiveProfile(null)
        setSelectedPoint(null)
        setRoutePreviewState(null)
        setFitRevision((n) => n + 1)
        w.setNotice(loaded.notice)
        if (isAccessInvestigation(loaded.project)) {
          const block = loaded.project.context.find((feature) => feature.kind === 'harvest')
          if (block) {
            inspectHistoryEvidence({ kind: 'block', id: block.id })
            // Keep the evidence visible beside the map on desktop; on phones the controls
            // are the first useful view because no historical path has been established yet.
            setControlsOpen(true)
          }
        }
      },
      { label: 'Cancel scenario loading', notice: 'Scenario loading cancelled. The current project was kept.' },
    )
  const openBcOpening = async (openingId: string) =>
    run(
      'Loading the selected BC opening…',
      async (signal) => {
        const loaded = await loadBcAccessPilotScenario({ openingId, signal, onProgress: w.setBusy })
        if (signal.aborted) return
        await w.flush()
        if (signal.aborted) return
        w.startProject(loaded.project, loaded.source)
        setSelectedPoint(null)
        setRoutePreviewState(null)
        setFitRevision((revision) => revision + 1)
        const block = loaded.project.context.find((feature) => feature.kind === 'harvest')
        if (block) inspectHistoryEvidence({ kind: 'block', id: block.id })
        w.setNotice(loaded.notice)
      },
      { label: 'Cancel opening study', notice: 'Opening study cancelled. The current project was kept.' },
      true,
    )
  /** An FTEN block with no opening ID has nothing to investigate, so it starts a design with no road yet. */
  const openBcPlannedBlock = async (cutblockSKey: string) =>
    run(
      'Loading the selected BC cutblock…',
      async (signal) => {
        const loaded = await loadBcPlannedBlockScenario({ cutblockSKey, signal, onProgress: w.setBusy })
        if (signal.aborted) return
        await w.flush()
        if (signal.aborted) return
        w.startProject(loaded.project, loaded.source)
        beginMode('inspect')
        setActiveProfile(null)
        setSelectedPoint(null)
        setRoutePreviewState(null)
        setFitRevision((revision) => revision + 1)
        w.setNotice(loaded.notice)
      },
      { label: 'Cancel loading the cutblock', notice: 'Cutblock loading cancelled. The current project was kept.' },
      true,
    )
  /** Opens the file picker for `kind`. `newProject` names the project a terrain file is to start. */
  const requestFile = (kind: FileKind, newProject: string | null = null) => {
    if (w.busy) return
    fileKind.current = kind
    // Set on every request, so a cancelled picker cannot leave a later terrain import starting a project.
    pendingProject.current = newProject
    if (fileRef.current) {
      fileRef.current.accept =
        kind === 'terrain'
          ? '.tif,.tiff,.las,.laz,.terx,.txt,.csv'
          : kind === 'project'
            ? '.json,.dsnx,.terx,.zip,.ilt,.tr1,.tr2'
            : kind === 'landxml'
              ? '.xml,application/xml,text/xml'
              : kind === 'alignment'
                ? `${SPATIAL_ACCEPT},.xml,application/xml,text/xml,.dsnx,.txt,.csv`
                : SPATIAL_ACCEPT
      // Several LAS/LAZ tiles of one job import together as one surface; a RoadEng design comes
      // with its terrain files.
      fileRef.current.multiple = kind === 'terrain' || kind === 'project' || kind === 'alignment'
      fileRef.current.value = ''
      fileRef.current.click()
    }
  }
  /** Asks for what a terrain file does not state; resolves to null when the question is cancelled. */
  const askTerrain = useCallback(
    (needs: TerrainImportNeeds) =>
      new Promise<TerrainImportAnswers | null>((resolve) => setTerrainQuestion({ needs, resolve })),
    [],
  )
  /**
   * A RoadEng project, design or terrain (`roadEngProject.ts`). `newProject` set: it opens as a new
   * project (named after the files, or the name given), on its terrain's CRS or a flat plane. Null:
   * its terrain replaces this project's and its drawn features join it, in the terrain's CRS, the
   * project's own plane, or a CRS asked for.
   */
  const importRoadEng = async (files: File[], target: { newProject: string | null } | null, signal: AbortSignal) => {
    const { collectRoadEngFiles, roadEngProject, MAX_ROADENG_PROJECT_BYTES } =
      await import('./dev-forestry-roads/roadEngProject')
    const { isLocalPlane } = await import('./dev-forestry-roads/localPlane')
    const big = files.find((f) => f.size > MAX_ROADENG_PROJECT_BYTES)
    if (big) throw Error(`${big.name} is over 300 MB.`)
    const read = await Promise.all(
      files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
    )
    const collected = collectRoadEngFiles(read)
    if (!target && !collected.terrains.length)
      throw Error('Choose a RoadEng terrain (.terx). Bring a design in with Import line, or open it as a project.')
    const hashes = new Map<Uint8Array, string>()
    for (const terrain of collected.terrains)
      hashes.set(
        terrain.bytes,
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(terrain.bytes))), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      )
    const plane = !target && isLocalPlane(project.terrain) ? project.terrain.localPlane : undefined
    // Only ground needs a datum: a terrain with no TIN gives drawn features and no levels.
    const { readRoadEngTerrainArchive } = await import('./dev-forestry-roads/roadEngTerrain')
    const withGround = collected.terrains.filter((t) => readRoadEngTerrainArchive(t.bytes).terrain.tin)
    const result = await importTerrainWithAnswers(async (answers) => {
      // RoadEng records no vertical datum; with ground to state it for, it is asked.
      if (withGround.length && answers.verticalReference === undefined)
        throw new TerrainImportQuestion('RoadEng does not record what its elevations are measured from.', {
          verticalDatum: { files: withGround.map((t) => t.name) },
        })
      try {
        return roadEngProject(
          [...collected.designs, ...collected.terrains, ...collected.layouts, ...collected.surveys],
          {
            newId: uid,
            color: (index) => colors[((target ? 0 : project.alignments.length) + index) % colors.length],
            template: { ...alignment.template },
            verticalReference: answers.verticalReference ?? '',
            sha256Of: (file) => hashes.get(file.bytes),
            noCrs: target ? 'plane' : (plane ?? 'ask'),
            ...(answers.epsg !== undefined ? { epsg: answers.epsg } : {}),
          },
        )
      } catch (error) {
        const { AlignmentCrsQuestion } = await import('./dev-forestry-roads/landXmlImport')
        if (error instanceof AlignmentCrsQuestion)
          throw new TerrainImportQuestion(error.message, {
            crs: { files: collected.terrains.map((t) => t.name), bounds: error.bounds, subject: 'alignment' },
          })
        throw error
      }
    }, askTerrain)
    if (signal.aborted) return
    if (!result) {
      w.setNotice('RoadEng import cancelled. Nothing was changed.')
      return
    }
    // RoadEng's own Terrain1.ter goes to this browser's file store, and the project names it by checksum.
    let keptFile = ''
    if (result.originalTer) {
      const [{ sha256Hex }, { storeRoadEngOriginal }, { withRoadEngOriginal }] = await Promise.all([
        import('./dev-forestry-roads/roadEngTerrainOriginal'),
        import('./dev-forestry-roads/roadEngTerrainStore'),
        import('./dev-forestry-roads/roadEngProject'),
      ])
      const sha256 = await sha256Hex(result.originalTer.bytes)
      try {
        await storeRoadEngOriginal(sha256, result.originalTer.bytes)
        keptFile = 'Its Terrain1.ter is kept in this browser, so the terrain goes back to RoadEng as read.'
      } catch {
        keptFile =
          'Its Terrain1.ter could not be kept in this browser, so a RoadEng project written from here takes the grid as its ground.'
      }
      if (signal.aborted) return
      result.terrain = withRoadEngOriginal(result.terrain, { record: result.originalTer.record, sha256 })
    }
    const label = files.map((f) => f.name).join(', ')
    const notice = [...result.notes, keptFile].filter(Boolean).join(' ')
    if (target) {
      const name = target.newProject ?? result.name
      const roads = result.roads.map((road) => road.alignment)
      const bounds = terrainBounds(result.terrain)
      const centre: Coordinate = bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : [0, 0]
      const placeholder = roads.length ? null : starterAlignment(centre)
      const opened = withNewProjectStandards(
        parseProject({
          ...createDemoProject(),
          name,
          terrain: result.terrain,
          alignments: placeholder ? [placeholder] : roads,
          activeAlignmentId: (placeholder ?? roads[0]).id,
          workspaceMode: 'design',
          ...(placeholder ? { designPlaceholderId: placeholder.id } : {}),
          context: result.context,
          cables: result.cables,
          reference: result.reference,
          ...(result.riggingSets.length ? { riggingSets: result.riggingSets } : {}),
          ...(result.mapNotes.length ? { notes: result.mapNotes } : {}),
          ...(result.referenceStyles.length ? { referenceStyles: result.referenceStyles } : {}),
          profiles: [],
          settings: result.fillRate === null ? project.settings : { ...project.settings, fillRate: result.fillRate },
        }),
      )
      const existing = w.library.find((entry) => entry.name === opened.name)
      if (existing) {
        setFileConflict({
          opened,
          fileName: label,
          existing,
          keepBothName: distinctProjectName(
            opened.name,
            w.library.map((entry) => entry.name),
          ),
          openedAt: Date.now(),
        })
        return
      }
      await w.flush()
      await w.restore(opened, signal)
      w.setNotice(`Opened ${label} as a new project. ${notice}`)
    } else {
      const source = terrainFromMetadata(result.terrain)
      if (!source) throw Error('The RoadEng terrain could not be read as ground.')
      const { mergeRoadEngParts } = await import('./dev-forestry-roads/roadEngProject')
      if (
        !commitValidated({
          ...project,
          terrain: result.terrain,
          context: [...project.context, ...result.context],
          cables: [...project.cables, ...result.cables],
          reference: [...(project.reference ?? []), ...result.reference],
          ...mergeRoadEngParts(project, result),
          scenario: undefined,
        })
      )
        return
      w.setSource(source)
      w.setNotice(`Imported ${label}. ${notice}`)
    }
    w.enablePersistence()
    setActiveProfile(null)
    setFitRevision((n) => n + 1)
  }
  /** Where a Softree ASCII file's metres go: the CRS asked for, or this project's flat plane. */
  const softreePlacement = async (answers: TerrainImportAnswers) => {
    const { gridToLonLat } = await import('./dev-forestry-roads/landXmlImport')
    const { localPlaneProjection } = await import('./dev-forestry-roads/localPlane')
    const plane = project.terrain.epsg === LOCAL_PLANE_EPSG ? project.terrain.localPlane : undefined
    if (plane) return { plane, toLonLat: localPlaneProjection(plane.offsetM).toLonLat }
    return answers.epsg === undefined ? null : { epsg: answers.epsg, toLonLat: gridToLonLat(answers.epsg) }
  }
  /**
   * A Softree terrain ASCII file as the terrain (`softreeImport.ts`). It states no units, coordinate
   * system or vertical datum, so each is asked; a project on a flat plane takes it in its plane.
   */
  const loadSoftreeTerrain = async (file: File, answers: TerrainImportAnswers) => {
    const { softreeTerrainAsciiGround, softreeTerrainExtent } = await import('./dev-forestry-roads/softreeImport')
    const { parseSoftreeTerrainAscii } = await import('./dev-forestry-roads/softreeAscii')
    const text = await file.text()
    const placement = await softreePlacement(answers)
    const needs: TerrainImportNeeds = {
      ...(answers.unitM === undefined ? { units: { files: [file.name], stated: null } } : {}),
      ...(placement
        ? {}
        : {
            crs: {
              files: [file.name],
              bounds: softreeTerrainExtent(parseSoftreeTerrainAscii(text)),
              subject: 'drawing' as const,
            },
          }),
      ...(answers.verticalReference?.trim() ? {} : { verticalDatum: { files: [file.name] } }),
    }
    if (!placement || answers.unitM === undefined || !answers.verticalReference?.trim())
      throw new TerrainImportQuestion(
        `${file.name} is a Softree terrain ASCII file, which states no units, coordinate system or vertical datum.`,
        needs,
      )
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    const { metadata, notes } = softreeTerrainAsciiGround(text, {
      fileName: file.name,
      unitM: answers.unitM,
      placement,
      verticalReference: answers.verticalReference,
      sha256,
    })
    const source = terrainFromMetadata(metadata)
    if (!source) throw Error(`${file.name} could not be read as ground.`)
    return { metadata, source, summary: notes.join(' ') }
  }
  /** A Softree location ASCII coordinate file as a new road (`softreeImport.ts`), units and CRS asked. */
  const importSoftreeLocation = async (file: File, signal: AbortSignal) => {
    const { softreeLocationRoad, softreeLocationExtent } = await import('./dev-forestry-roads/softreeImport')
    const { parseSoftreeLocationAscii } = await import('./dev-forestry-roads/softreeAscii')
    const text = await file.text()
    const imported = await importTerrainWithAnswers(async (answers) => {
      const placement = await softreePlacement(answers)
      if (!placement || answers.unitM === undefined)
        throw new TerrainImportQuestion(
          `${file.name} is a Softree location coordinate file, which states no units or coordinate system.`,
          {
            ...(answers.unitM === undefined ? { units: { files: [file.name], stated: null } } : {}),
            ...(placement
              ? {}
              : {
                  crs: {
                    files: [file.name],
                    bounds: softreeLocationExtent(parseSoftreeLocationAscii(text)),
                    subject: 'alignment' as const,
                  },
                }),
          },
        )
      return softreeLocationRoad(text, {
        fileName: file.name,
        unitM: answers.unitM,
        placement,
        id: uid(),
        color: colors[project.alignments.length % colors.length],
        template: { ...alignment.template },
      })
    }, askTerrain)
    if (signal.aborted) return
    if (!imported) {
      w.setNotice(`Import of ${file.name} cancelled. Nothing was changed.`)
      return
    }
    if (roadCount(project) + 1 > MAX_PROJECT_ROADS)
      throw Error(`A project holds at most ${MAX_PROJECT_ROADS} roads. Remove one before importing another.`)
    // A new road only: an import never replaces the active road.
    if (!commitValidated(withAddedAlignments(project, [imported.alignment]))) return
    w.setNotice(`Imported from ${file.name}. ${imported.notes.join(' ')}`)
    w.enablePersistence()
    setFitRevision((n) => n + 1)
  }
  const importFile = (files: File[]) => {
    const file = files[0]
    const label = files.length > 1 ? `${files.length} point-cloud tiles` : file.name
    return run(`Opening ${label}…`, async (signal) => {
      // RoadEng designs, terrains and zipped projects are read by their content, whichever button chose them.
      if (fileKind.current === 'project' || fileKind.current === 'terrain') {
        const { isRoadEngTerrain } = await import('./dev-forestry-roads/roadEngTerrain')
        const heads = await Promise.all(files.map(async (f) => new Uint8Array(await f.slice(0, 4096).arrayBuffer())))
        const zip = (h: Uint8Array) => h[0] === 0x50 && h[1] === 0x4b
        if (fileKind.current === 'project' ? heads.some(zip) : heads.some(isRoadEngTerrain)) {
          const name = pendingProject.current
          pendingProject.current = null
          await importRoadEng(
            files,
            fileKind.current === 'project' || name !== null ? { newProject: name } : null,
            signal,
          )
          return
        }
      }
      if (fileKind.current === 'alignment') {
        // The content decides the reader, never the file's name.
        const { isLandXml } = await import('./dev-forestry-roads/landXmlImport')
        const { isRoadEngDesign } = await import('./dev-forestry-roads/roadEngImport')
        if (isRoadEngDesign(new Uint8Array(await file.slice(0, 4096).arrayBuffer()))) fileKind.current = 'roadeng'
        else if (isLandXml(await file.slice(0, 4096).text())) fileKind.current = 'landxml'
        else {
          const { isSoftreeLocationAscii } = await import('./dev-forestry-roads/softreeAscii')
          if (isSoftreeLocationAscii(await file.slice(0, 64_000).text())) {
            await importSoftreeLocation(file, signal)
            return
          }
        }
      }
      if (fileKind.current === 'terrain') {
        const name = pendingProject.current
        pendingProject.current = null
        const clouds = files.filter((f) => /\.la[sz]$/i.test(f.name))
        // A Softree terrain ASCII file is known by its content, whatever its name.
        const softree =
          files.length === 1 &&
          !/\.(la[sz]|tiff?)$/i.test(file.name) &&
          (await import('./dev-forestry-roads/softreeAscii')).isSoftreeTerrainAscii(await file.slice(0, 64_000).text())
        const unknown = softree ? undefined : files.find((f) => !/\.(la[sz]|tiff?)$/i.test(f.name))
        if (unknown)
          throw Error(
            `${unknown.name} is not terrain this import reads. Use a GeoTIFF (.tif), LAS, LAZ or a Softree terrain ASCII file.`,
          )
        if (files.length > 1 && clouds.length !== files.length)
          throw Error(
            'Choose one GeoTIFF, or one or more LAS/LAZ tiles. To join GeoTIFFs, use Prepare and combine terrain → Add GeoTIFFs to ground mosaic.',
          )
        // Whatever the files do not state is asked for here, for this import only.
        const loaded = await importTerrainWithAnswers(
          (answers) =>
            softree
              ? loadSoftreeTerrain(file, answers)
              : clouds.length
                ? loadLas(file, answers.verticalReference ?? '', {
                    ...pointCloud,
                    additionalFiles: files.slice(1),
                    assumedEpsg: answers.epsg,
                    preservePath: alignment.points.map((point) => point.coordinate),
                    breaklines: breaklines?.data,
                    signal,
                    onProgress: (message) => w.setBusy(`${label}: ${message}`),
                  })
                : loadRaster(file, answers.verticalReference ?? '').then((raster) => ({ ...raster, summary: '' })),
          askTerrain,
          { verticalReference },
        )
        if (signal.aborted) return
        if (!loaded) {
          w.setNotice('Terrain import cancelled. Nothing was changed.')
          return
        }
        if (name !== null) {
          const bounds = terrainBounds(loaded.metadata)
          if (!bounds) throw Error('Could not locate the imported terrain.')
          await w.flush()
          startOn(name, loaded.metadata, loaded.source, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
          w.setNotice(
            `${loaded.summary ? `${loaded.summary} ` : ''}New project on ${label}. Peg or sketch the first road, or load a mapped road.`,
          )
          w.enablePersistence()
          setFitRevision((n) => n + 1)
          return
        }
        w.setSource(loaded.source)
        w.commit({ ...project, terrain: loaded.metadata, scenario: undefined })
        w.setNotice(
          `${loaded.summary ? `${loaded.summary} ` : ''}Imported terrain is now used by every analysis view. Alignments outside its footprint have missing elevations.`,
        )
      } else if (fileKind.current === 'breaklines') {
        if (file.size > 50_000_000) throw Error('Breakline file is too large; the limit is 50 MB.')
        // Heights are what a breakline is for, so this one read keeps the third coordinate.
        const data: unknown = (await readSpatialImport(file, { keepHeights: true })).collection
        const { readBreaklines } = await import('./dev-forestry-roads/tinSurface')
        const lines = readBreaklines(data, (lon, lat) => [lon, lat])
        if (!lines.length) throw Error('No lines or polygon rings in that file to use as breaklines.')
        setBreaklines({ name: `${file.name} (${lines.length} line${lines.length === 1 ? '' : 's'})`, data })
        w.setNotice(
          `${lines.length} breakline${lines.length === 1 ? '' : 's'} from ${file.name} will be used by the next LAS/LAZ TIN import.`,
        )
        return
      } else if (fileKind.current === 'landxml' || fileKind.current === 'roadeng') {
        const xml = await import('./dev-forestry-roads/landXmlImport')
        const native = await import('./dev-forestry-roads/roadEngImport')
        const isNative = fileKind.current === 'roadeng'
        if (file.size > (isNative ? native.MAX_ROADENG_BYTES : xml.MAX_LANDXML_BYTES))
          throw Error(`${file.name} is over 50 MB.`)
        // A RoadEng design takes its CRS from a terrain chosen with it, or this project's flat plane.
        const roadEngExtras = isNative
          ? await Promise.all(
              files.slice(1).map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
            )
          : []
        const { isLocalPlane } = await import('./dev-forestry-roads/localPlane')
        const plane = isLocalPlane(project.terrain) ? project.terrain.localPlane : undefined
        const contents = isNative ? new Uint8Array(await file.arrayBuffer()) : await file.text()
        const options = {
          newId: uid,
          color: (index: number) => colors[(project.alignments.length + index) % colors.length],
          template: { ...alignment.template },
        }
        // A design that names no CRS is asked for one, never placed in the open terrain's.
        const imported = await importTerrainWithAnswers(async ({ epsg }) => {
          try {
            if (typeof contents === 'string') {
              const { roads } = xml.landXmlRoads(contents, { ...options, epsg })
              return { alignments: roads.map((road) => road.alignment), summary: roads.map(xml.landXmlImportSummary) }
            }
            const { roadEngProject } = await import('./dev-forestry-roads/roadEngProject')
            const placed = roadEngProject([{ name: file.name, bytes: contents }, ...roadEngExtras], {
              ...options,
              verticalReference: '',
              noCrs: plane ?? 'ask',
              ...(epsg !== undefined ? { epsg } : {}),
            })
            return { alignments: placed.roads.map((road) => road.alignment), summary: placed.roadNotes }
          } catch (error) {
            if (error instanceof xml.AlignmentCrsQuestion)
              throw new TerrainImportQuestion(error.message, {
                crs: { files: [file.name], bounds: error.bounds, subject: 'alignment' },
              })
            throw error
          }
        }, askTerrain)
        if (signal.aborted) return
        if (!imported) {
          w.setNotice(`Import of ${file.name} cancelled. Nothing was changed.`)
          return
        }
        if (roadCount(project) + imported.alignments.length > MAX_PROJECT_ROADS)
          throw Error(
            `A project holds at most ${MAX_PROJECT_ROADS} roads. Remove some before importing ${imported.alignments.length}.`,
          )
        // New roads only: an import never replaces the active road.
        if (!commitValidated(withAddedAlignments(project, imported.alignments))) return
        w.setNotice(`Imported from ${file.name}. ${imported.summary.join(' ')}`)
        w.enablePersistence()
        setFitRevision((n) => n + 1)
        return
      } else if (fileKind.current === 'project') {
        if (file.size > 120_000_000) throw Error(`${file.name} is over 120 MB. Open a cropped project.`)
        let raw: unknown
        try {
          raw = JSON.parse(await file.text())
        } catch {
          throw Error(
            `${file.name} is not a road project file. Open a .road.json saved from this workspace; bring layers in with an Import button.`,
          )
        }
        if (signal.aborted) return
        const opened = parseProject(raw)
        // A project of the same name is already saved here: ask which one is meant, open nothing yet.
        const existing = w.library.find((entry) => entry.name === opened.name)
        if (existing) {
          setFileConflict({
            opened,
            fileName: file.name,
            existing,
            keepBothName: distinctProjectName(
              opened.name,
              w.library.map((entry) => entry.name),
            ),
            openedAt: Date.now(),
          })
          return
        }
        await w.flush()
        // A project file opens as its own project; the one that was open stays saved.
        await w.restore(opened, signal)
        w.markFileSaved()
        setOpenedFromFile(true)
        w.setNotice(`Opened ${file.name}.`)
      } else {
        await readSpatial(file, SPATIAL_INTENTS[fileKind.current], signal)
        return
      }
      w.enablePersistence()
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
    })
  }
  // A file picked while busy opens once the workspace is free (the picker's change handler queued it).
  const busyNow = !!w.busy
  const openFiles = useRef(importFile)
  useEffect(() => {
    openFiles.current = importFile
  })
  useEffect(() => {
    if (busyNow || !pendingFiles.current) return
    const { files, kind } = pendingFiles.current
    pendingFiles.current = null
    fileKind.current = kind
    openFiles.current(files)
  }, [busyNow])
  /** Adds what the chosen roles make of a spatial file, then brings what was created forward. */
  const commitSpatial = (file: SpatialFile, roles: RoleChoice, intent: ImportIntent) => {
    const result = buildSpatialImport(file, roles, intent)
    const next = applySpatialImport(project, result, uid)
    w.commit(next)
    w.enablePersistence()
    w.setNotice(result.notice)
    setActiveProfile(null)
    setSpatialChoice(null)
    // Show the import where it landed: it may be far from the roads the plan was fitted to.
    const points = combinedReferenceBounds([
      ...result.alignments.map((road) => ({
        geometry: { type: 'LineString' as const, coordinates: road.points.map((point) => point.coordinate) },
      })),
      ...result.context,
      ...result.reference,
    ])
    const before = new Set(project.context.map((feature) => feature.id))
    const block = result.context.find((feature) => feature.kind === 'harvest')
    const mapped = next.context.find((feature) => feature.kind === 'existing-road' && !before.has(feature.id))
    if (result.alignments.length) {
      setWorkflowTab('design')
      w.setStation(0)
    } else if (block) {
      setCutblockReviewRequest((previous) => ({ id: block.id, sequence: (previous?.sequence ?? 0) + 1 }))
      setWorkflowTab('terrain')
    } else if (mapped) openRoadReview(mapped.id)
    // Fit the plan without changing which panes show: the sidebar is where the import is reviewed.
    if (planMap.current) fitPlanPoints(planMap.current, points)
  }
  /** A spatial file read through `readSpatialImport`, its CRS and units asked when it states none; null if cancelled. */
  const readSpatialAnswered = (file: File) => {
    // A CAD drawing states no CRS and often not its units: it is asked, or on a flat-plane project
    // read in the plane's own file coordinates (a plan from the same job shares them).
    const plane = project.terrain.epsg === LOCAL_PLANE_EPSG ? project.terrain.localPlane : undefined
    return importTerrainWithAnswers(async (answers) => {
      try {
        return await readSpatialImport(file, {
          ...(answers.epsg !== undefined ? { crs: { epsg: answers.epsg } } : plane ? { crs: { plane } } : {}),
          ...(answers.unitM !== undefined ? { unitM: answers.unitM } : {}),
        })
      } catch (error) {
        if (!(error instanceof SpatialCrsQuestion)) throw error
        throw new TerrainImportQuestion(
          error.message,
          error.reason === 'units'
            ? { units: { files: [error.fileName], stated: error.unitName } }
            : { crs: { files: [error.fileName], bounds: error.bounds, subject: 'drawing' } },
        )
      }
    }, askTerrain)
  }
  const readSpatial = async (file: File, intent: ImportIntent, signal?: AbortSignal) => {
    const read = await readSpatialAnswered(file)
    if (!read) {
      w.setNotice(`Import of ${file.name} cancelled. Nothing was changed.`)
      return
    }
    if (signal?.aborted) return
    const proposal = proposeRoles(read, intent)
    if (proposal.ask) setSpatialChoice({ file: read, roles: proposal.roles, intent })
    else commitSpatial(read, proposal.roles, intent)
  }
  /**
   * An analysis area for existing-ground drainage from a spatial file. The picker is for an area,
   * so its polygons are the candidates; lines and points are left out and said so. Several
   * polygons are listed for the person to choose one, or all as one area.
   */
  const importGroundDrainageArea = (file: File) =>
    void run(`Reading ${file.name}…`, async (signal) => {
      const read = await readSpatialAnswered(file)
      if (!read || signal.aborted) {
        if (!read) w.setNotice(`Import of ${file.name} cancelled. Nothing was changed.`)
        return
      }
      const choices: AreaChoice[] = read.collection.features.flatMap((feature, i) =>
        feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'
          ? [{ name: spatialFeatureName(feature.properties) ?? `Polygon ${i + 1}`, geometry: feature.geometry }]
          : [],
      )
      const skipped = read.collection.features.length - choices.length
      if (!choices.length) throw Error(`${file.name} holds no polygons to use as a drainage area.`)
      if (skipped) w.setNotice(`${skipped} line or point feature${skipped === 1 ? '' : 's'} in ${file.name} left out.`)
      if (choices.length === 1)
        setGroundDrainageArea({
          source: 'imported',
          name: choices[0].name,
          fileName: file.name,
          geometry: choices[0].geometry,
        })
      else setGroundImportChoices({ fileName: file.name, choices })
    })
  /** One importer for every spatial picker; the intent only sets what the picker is for. */
  const importSpatial = (file: File, intent: ImportIntent) =>
    void run(`Reading ${file.name}…`, (signal) => readSpatial(file, intent, signal))
  const importReferenceFiles = (files: PickedFile[]) =>
    run('Reading map layers…', async (signal) => {
      const decoded = await readReferenceImport(files, signal)
      if (signal.aborted) return
      // Contours beat the sample and the regional terrain, and any terrain that does not cover the
      // roads and blocks coming in. An imported terrain over them stays unless the person picks the contours.
      const extent = designExtent(
        decoded.filter((file) => file.selected ?? true).map((file) => ({ file, role: suggestedLayerRole(file) })),
      )
      const covered = terrainBounds(project.terrain)
      const coversDesign =
        !!extent &&
        !!covered &&
        covered[0] <= extent[0] &&
        covered[1] <= extent[1] &&
        covered[2] >= extent[2] &&
        covered[3] >= extent[3]
      const preferContours = project.terrain.kind !== 'geotiff' || !coversDesign
      setLayerImportFiles(
        preferContours
          ? decoded.map((file) => (file.pdf?.contourSurface ? { ...file, selected: true } : file))
          : decoded,
      )
    })
  const commitLayerImport = (choices: LayerImportChoice[], options?: LayerImportOptions) => {
    const terrainChoice = choices.find((choice) => choice.role === 'terrain')
    if (!terrainChoice) return applyLayerChoices(choices, options)
    setLayerImportFiles(null)
    const surface = terrainChoice.file.pdf?.contourSurface,
      source = terrainChoice.file.pdf?.source
    void run('Building terrain from contours…', async (signal) => {
      if (!surface || !source) throw Error('That layer has no contour surface.')
      const { contourTerrain } = await import('./dev-forestry-roads/contourTerrain')
      // The sheet prints no vertical datum: always ask, never reuse the open terrain's.
      let loaded = await importTerrainWithAnswers(
        async (answers) => contourTerrain(surface, source, answers.verticalReference ?? ''),
        askTerrain,
      )
      if (signal.aborted) return
      const others = choices.filter((choice) => choice !== terrainChoice)
      // A sheet's contours stop at its frame; roads that run off it take the regional DEM there.
      const extent = loaded && options?.fillBeyondContours ? designExtent(others) : null
      if (loaded && extent) {
        // The regional tiles are read a little wider than the grid's 100 m margin.
        const padded: [number, number, number, number] = [
          extent[0] - 0.003,
          extent[1] - 0.002,
          extent[2] + 0.003,
          extent[3] + 0.002,
        ]
        w.setBusy('Filling past the contours from the regional DEM…')
        try {
          const regional = await loadRegionalTerrain(padded, signal)
          const { fillBeyondContours } = await import('./dev-forestry-roads/contourTerrain')
          loaded = await fillBeyondContours(
            loaded,
            extent,
            {
              source: regional.source,
              resolutionM: regional.metadata.resolutionM,
              name: 'the regional DEM',
            },
            signal,
          )
        } catch (cause) {
          if (signal.aborted) return
          // The contours alone are still a terrain; say what is missing rather than refuse the import.
          loaded = {
            ...loaded,
            summary: `${loaded.summary} The regional DEM could not fill past them (${cause instanceof Error ? cause.message : 'not loaded'}).`,
          }
        }
        if (signal.aborted) return
      }
      if (!loaded) {
        if (others.length) applyLayerChoices(others, options)
        w.setNotice(
          `Terrain from contours cancelled; the current terrain is unchanged.${others.length ? ' The other layers were loaded.' : ''}`,
        )
        return
      }
      w.setSource(loaded.source)
      applyLayerChoices(others, options, { terrain: loaded.metadata, summary: loaded.summary })
    })
  }
  const applyLayerChoices = (
    choices: LayerImportChoice[],
    options?: LayerImportOptions,
    terrain?: { terrain: TerrainMetadata; summary: string },
  ) => {
    const result = applyLayerImport(project, choices, uid)
    if (options?.loadRoads) result.project = loadImportedProposedRoads(result.project, result.imported, uid)
    if (terrain) result.project = { ...result.project, terrain: terrain.terrain, scenario: undefined }
    w.commit(
      shareUnchanged(project, result.project),
      true,
      terrain ? 'Terrain from contours' : 'Import map layers',
      true,
    )
    w.enablePersistence()
    w.setNotice(
      [
        terrain?.summary,
        choices.length ? `Loaded ${choices.length} ${choices.length === 1 ? 'map layer' : 'map layers'}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
    setLayerImportFiles(null)
    setFocusedReferenceId(null)
    if (options?.prepareDem) {
      // Boxes for what is being designed: proposed roads and planned blocks, not reference layers.
      const ids = new Set(
        result.imported
          .filter((f) => ('role' in f && f.role === 'proposed-road') || ('kind' in f && f.kind === 'harvest'))
          .map((f) => f.id),
      )
      setImportedDetailAreas(
        projectDetailAreas(result.project).filter((a) => ids.has(a.id.slice(a.id.indexOf(':') + 1))),
      )
      setDetailView([])
      setDetailOpen(true)
    }
    const keys = choices.map(({ file }) => file.fileName)
    const buffers = (result.project.cutblockBuffers ?? []).filter(({ layer }) => keys.includes(layer))
    const hidden = choices
      .filter((choice) => choice.role === 'reference' || (options?.loadRoads && choice.role === 'proposed-road'))
      .map(({ file }) => file.fileName)
    changeLayerVisibility(hidden, false)
    changeLayerVisibility(
      [...keys.filter((key) => !hidden.includes(key)), ...buffers.map(({ layer }) => cutblockBufferKey(layer))],
      true,
    )
    showOnPlan(
      layerFitPoints([
        ...result.imported,
        ...buffers.flatMap((setting) =>
          cutblockBufferFeatures(setting, result.project.context, result.project.reference ?? []),
        ),
      ]),
    )
  }
  const changeCutblockBuffer = (key: string, setting?: CutblockBuffer) => {
    const next = parseProject({
      ...project,
      cutblockBuffers: [
        ...(project.cutblockBuffers ?? []).filter(({ layer }) => layer !== key),
        ...(setting ? [setting] : []),
      ],
    })
    w.commit(shareUnchanged(project, next), true, 'Change cutblock buffer', true)
    if (setting) changeLayerVisibility([key, cutblockBufferKey(key)], true)
  }
  const changeReferenceStyle = (key: string, style: SymbolStyle) => {
    const next = parseProject({ ...project, referenceStyles: withReferenceStyle(project.referenceStyles, key, style) })
    w.commit(shareUnchanged(project, next), true, 'Change layer look', true)
  }
  const copyLayerRoad = (feature: LayerFeature) => {
    const file: SpatialFile = {
      fileName: feature.source ?? feature.name,
      format: 'GeoJSON',
      crs: 'WGS84 longitude/latitude',
      collection: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: feature.name },
            geometry: feature.geometry,
          },
        ],
      },
    }
    try {
      const result = buildSpatialImport(file, { line: 'road', point: null, polygon: null }, 'road')
      const next = applySpatialImport(project, result, uid)
      w.commit(shareUnchanged(project, next), true, 'Copy proposed road as design', true)
      w.enablePersistence()
      w.setError('')
      w.setNotice(`Copied ${feature.name} as an editable road.`)
      w.setStation(0)
      setActiveProfile(null)
      if (!dockLayers) setLayersOpen(false)
      showOnPlan(combinedReferenceBounds([feature]))
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not copy the proposed road.')
    }
  }
  /** Opens the project file held by the name conflict, in the saved project's place or beside it. */
  const resolveFileConflict = (choice: 'replace' | 'both') => {
    const conflict = fileConflict
    if (!conflict) return
    setFileConflict(null)
    void run(`Opening ${conflict.fileName}…`, async (signal) => {
      await w.flush()
      if (choice === 'replace') await w.restore(conflict.opened, signal, conflict.existing.id)
      else await w.restore(parseProject({ ...conflict.opened, name: conflict.keepBothName }), signal)
      if (signal.aborted) return
      w.markFileSaved()
      setOpenedFromFile(true)
      w.setNotice(
        choice === 'replace'
          ? `Opened ${conflict.fileName} in place of the saved ${conflict.existing.name}.`
          : `Opened ${conflict.fileName} as ${conflict.keepBothName}. The saved ${conflict.existing.name} is unchanged.`,
      )
      w.enablePersistence()
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
    })
  }
  /** The invalid input the roads an output would write leave out, by `INVALID_INPUT_RULES`. */
  const exportInvalidInput = (kind: RoadExport) => {
    // A terrain profile is ground only: no section or engineering input reaches it.
    if (INVALID_INPUT_RULES[kind] === 'unaffected' || (terrainProfile && !MULTI_ROAD_EXPORTS.includes(kind)))
      return undefined
    const roads = MULTI_ROAD_EXPORTS.includes(kind)
      ? exportRoads(project.alignments, alignment.id, scopeFor(kind))
      : [alignment]
    return roads.map((road) => w.analyses.get(road.id)?.invalidInput).find((invalid) => invalid)
  }
  /** The project as saved and the file name stem, after the checks every results export shares. */
  const exportBasis = (kind: RoadExport) => {
    // The symbol library is the catalogue: like the project file and notes, it holds no calculated result.
    const calculated = kind !== 'project' && kind !== 'notes' && kind !== 'symbol-library'
    // The project file holds the inputs as entered. A results file holds the inputs its results were
    // calculated from, so a stamped report never prints an invalid value beside the old quantities.
    const safe = parseProject(
      calculated
        ? {
            ...project,
            alignments: project.alignments.map((road) => calculatedAlignment(road, w.analyses.get(road.id))),
          }
        : project,
    )
    if (investigation && calculated)
      throw Error(
        'This is an access investigation. Export its evidence bundle or report in Access history; start a design before exporting engineering results.',
      )
    if (calculated && (draftAlignment || numericPegAlignment || templatePreview || costPreview))
      throw Error('Finish or close the design preview before exporting calculated results.')
    // A RoadEng terrain opened on its own goes back whole, with no road to calculate.
    const terrainOnlyRoadEng =
      kind === 'roadeng-project' && project.alignments.every((road) => road.id === project.designPlaceholderId)
    if (calculated && !terrainOnlyRoadEng && !displayedAnalysis.stations.length)
      throw Error('Calculated results are unavailable. Resolve the model errors before exporting results.')
    const invalid = exportInvalidInput(kind)
    if (invalid && INVALID_INPUT_RULES[kind] === 'refuse')
      throw Error(invalidInputRefusal(EXPORT_ITEMS.find((item) => item.kind === kind)?.label ?? 'This file', invalid))
    const basename = (safe.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'forest-road').slice(0, 70)
    return { safe, basename }
  }
  const reportHtml = (safe: RoadProject) =>
    brandedHtml(
      terrainProfile
        ? terrainProfileReportHtml(terrainProfile.name, displayedAnalysis, project.terrain)
        : projectReportHtml(safe, analysis, {
            drainageHasLiveRun: !!drainageEntry && !drainageStale,
            analyses: w.analyses,
          }),
      selectedExportBrand,
      printLogo,
    )
  /** The grid a RoadEng file is written in: the export grid, or a flat-plane project's own file coordinates. */
  const roadEngGrid = async () => {
    const { roadEngExportGrid } = await import('./dev-forestry-roads/roadEngProjectExport')
    return roadEngExportGrid(project.terrain, exportGrid(project.terrain, alignment.points[0].coordinate))
  }
  /**
   * The roads an export covers as a RoadEng design, in the same grid as LandXML and DXF. A road read
   * from RoadEng goes back in its own grid and station frame with its kept settings and the edits
   * made here (`roadEngDesignRoads`).
   */
  const roadEngFile = async (safe: RoadProject) => {
    const [{ roadEngDesign }, { roadEngDesignRoads }] = await Promise.all([
      import('./dev-forestry-roads/roadEngExport'),
      import('./dev-forestry-roads/roadEngProjectExport'),
    ])
    const roads = exportRoads(safe.alignments, alignment.id, roadScope)
    const grid = await roadEngGrid()
    const designSpeedKmh = project.standards?.designSpeedKmh ?? undefined
    const prepared = roadEngDesignRoads(
      roads.map((road) => ({ alignment: road, analysis: w.analyses.get(road.id) })),
      grid.toGrid,
      grid.epsg,
      { fillRate: safe.settings.fillRate, designSpeedKmh, gridFor: roadEngGridFor },
    )
    const written = roadEngDesign(prepared.roads, grid.toGrid, { designSpeedKmh })
    return { ...written, notes: [...prepared.notes, ...written.notes], roads: roads.length, epsg: grid.epsg }
  }
  /** A grid for a CRS a road was read from RoadEng in, when it is not the export grid's. */
  const roadEngGridFor = (epsg: number) => {
    try {
      return exportGrid({ ...project.terrain, epsg }, alignment.points[0].coordinate).toGrid
    } catch {
      return null
    }
  }
  /**
   * The same roads with their terrain and the project's drawn layers, rigging sets, map notes and
   * reference looks, as a zipped RoadEng project; a terrain read from RoadEng keeps its own parts,
   * and goes back over its own Terrain1.ter (from this browser's file store) while it is unchanged.
   */
  const roadEngProjectFile = async (safe: RoadProject) => {
    const { roadEngProjectExport } = await import('./dev-forestry-roads/roadEngProjectExport')
    const roads = exportRoads(safe.alignments, alignment.id, roadScope)
    const grid = await roadEngGrid()
    const originalRef = safe.terrain.roadEngSource?.original
    const originalTer = originalRef
      ? await (await import('./dev-forestry-roads/roadEngTerrainStore')).readRoadEngOriginal(originalRef)
      : null
    // A project that is only its terrain (a placeholder road) writes the whole terrain.
    const terrainOnly = roads.every((road) => road.id === safe.designPlaceholderId)
    const written = roadEngProjectExport({
      name: safe.name,
      roads: terrainOnly ? [] : roads.map((road) => ({ alignment: road, analysis: w.analyses.get(road.id) })),
      grid,
      context: safe.context,
      cables: safe.cables,
      reference: safe.reference ?? [],
      elevationAt: (c) => source.elevationAt(c[0], c[1]),
      designSpeedKmh: project.standards?.designSpeedKmh ?? undefined,
      fillRate: safe.settings.fillRate,
      riggingSets: safe.riggingSets ?? [],
      notes: safe.notes ?? [],
      referenceStyles: safe.referenceStyles ?? [],
      terrainSource: safe.terrain.roadEngSource ?? null,
      terrain: safe.terrain,
      originalTer,
      gridFor: roadEngGridFor,
      wholeTerrain: terrainOnly,
    })
    return { ...written, roads: terrainOnly ? 0 : roads.length, epsg: grid.epsg }
  }
  /** One road's plot book page, with contours over the road's extent from the same terrain source. */
  const plotBookFor = async (
    safe: RoadProject,
    road: Alignment,
    roadAnalysis: RoadAnalysis,
    settings: RoadProject['reportSettings'],
  ) => {
    const [{ plotBookHtml }, { buildTerrainDisplay }] = await Promise.all([
      import('./dev-forestry-roads/plotBook'),
      import('./dev-forestry-roads/terrainDisplay'),
    ])
    const lng = roadAnalysis.centerline.map((c) => c[0]),
      lat = roadAnalysis.centerline.map((c) => c[1])
    const margin = 0.002
    let contours: GeoJSON.FeatureCollection<GeoJSON.MultiLineString> | undefined,
      contourError = ''
    try {
      contours = buildTerrainDisplay(
        source,
        [Math.min(...lng) - margin, Math.min(...lat) - margin, Math.max(...lng) + margin, Math.max(...lat) + margin],
        256,
      ).contours
    } catch (error) {
      contours = undefined
      contourError = error instanceof Error ? error.message : 'unknown error'
    }
    const html = plotBookHtml({
      branding: selectedExportBrand,
      logo: printLogo,
      projectName: safe.name,
      settings,
      issue: safe.issue,
      alignment: road,
      analysis: roadAnalysis,
      terrain: project.terrain,
      contours,
      ...exportGrid(project.terrain, road.points[0].coordinate),
      gradeLimits: { rule: gradeRule(project.settings, project.standards) },
    })
    return { html, contourError }
  }
  /** The files of a styled GIS export, from the same shapefile layers the Shapefile output writes. */
  const styledBundle = async (kind: StyledExportKind, safe: RoadProject) => {
    const [{ styledExportBundle }, { contextShapefileLayers }, { encodePng }, { loadSqlJs }] = await Promise.all([
      import('./dev-forestry-roads/styledExports'),
      import('./dev-forestry-roads/exportStyles'),
      import('@/lib/mapSheet/png'),
      import('@/lib/browserSqlite'),
    ])
    const needsSql = kind === 'arcgis-pro' || kind === 'symbol-library'
    const roads = kind === 'symbol-library' ? [] : exportRoads(safe.alignments, alignment.id, roadScope)
    const layers =
      kind === 'symbol-library'
        ? []
        : [...contextShapefileLayers(safe.context), ...roadShapefileLayers(roads, w.analyses, alignment.id)]
    return styledExportBundle(
      kind,
      {
        name: safe.name,
        layers,
        roads: exportedRoadStyles({ alignments: roads }),
        overrides: roleOverrides(readStoredStyleLibrary()),
      },
      { encodePng, SQL: needsSql ? await loadSqlJs() : undefined },
    )
  }
  /**
   * The location ASCII file's options: as set in Save & export, else the project's unit from the
   * road's start station (0 without one). RoadEng's L-stations run on through station equations.
   */
  const locationAsciiOptions = (): LocationAsciiOptions =>
    locationAscii ?? {
      unitM: Math.abs((project.terrain.localPlane?.unitM ?? 1) - 0.3048) < 1e-9 ? 0.3048 : 1,
      startStationM: alignment.stationing?.startStation ?? 0,
      delimiter: ',',
      singleLine: false,
    }
  /** The Softree Optimal API inputs of the road on screen (`softreeExports.ts`), one CSV each. */
  const optimalInputs = async (safe: RoadProject, basename: string) => {
    const s = await import('./dev-forestry-roads/softreeExports')
    const road = safe.alignments.find((a) => a.id === alignment.id) ?? alignment
    return s.optimalInputFiles(road.engineering, safe.settings, s.softreeUnits(project.terrain), basename)
  }
  /**
   * A Softree file of the road on screen (`softreeExports.ts`), in the project's units: RoadEng's haul
   * exports, the Optimal files, and the location and terrain ASCII files, in the RoadEng export's grid.
   */
  const softreeFile = async (
    kind: Extract<
      RoadExport,
      | 'mass-haul-csv'
      | 'optimal-haul-csv'
      | 'optimal-areas-csv'
      | 'optimal-inputs'
      | 'softree-location-ascii'
      | 'softree-terrain-ascii'
    >,
    safe: RoadProject,
    basename: string,
  ): Promise<{ content: string | Blob; filename: string; mime: string; notice: string }> => {
    const s = await import('./dev-forestry-roads/softreeExports')
    const road = safe.alignments.find((a) => a.id === alignment.id) ?? alignment
    const units = s.softreeUnits(project.terrain)
    const inUnits = units === 'imperial' ? ' in feet and cubic yards, as the project’s RoadEng design' : ''
    const csvFile = (content: string, suffix: string, notice: string) => ({
      content,
      filename: `${basename}-${suffix}.csv`,
      mime: 'text/csv;charset=utf-8',
      notice,
    })
    switch (kind) {
      case 'mass-haul-csv':
        return csvFile(
          s.massHaulCsvFile(analysis, road.engineering, units),
          'mass-haul',
          `RoadEng mass haul downloaded${inUnits}.`,
        )
      case 'optimal-haul-csv': {
        const written = s.optimalHaulCsvFile(analysis, road.engineering, units)
        return csvFile(
          written.text,
          'optimal-haul',
          [`RoadEng optimal haul downloaded${inUnits}.`, ...written.leftOut].join(' '),
        )
      }
      case 'optimal-areas-csv': {
        const grid = await roadEngGrid()
        return csvFile(
          s.optimalAreasCsvFile(analysis, road.engineering, grid.toGrid, units),
          'optimal-areas',
          `Softree Optimal areas downloaded${inUnits}, in ${grid.epsg === null ? 'the design file’s own coordinates' : `EPSG:${grid.epsg} grid coordinates`}.`,
        )
      }
      case 'optimal-inputs': {
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        for (const file of await optimalInputs(safe, basename)) zip.file(file.path, file.content)
        return {
          content: await zip.generateAsync({ type: 'blob' }),
          filename: `${basename}-optimal-inputs.zip`,
          mime: 'application/zip',
          notice: `Softree Optimal materials, pits and cost model downloaded${inUnits}.`,
        }
      }
      case 'softree-location-ascii': {
        const grid = await roadEngGrid()
        const options = locationAsciiOptions()
        return {
          content: s.locationAsciiFile(road, analysis, grid.toGrid, options),
          filename: `${basename}-location.txt`,
          mime: 'text/plain',
          notice: `Softree location ASCII downloaded in ${options.unitM === 1 ? 'metres' : 'feet'}, ${grid.epsg === null ? 'in the design file’s own coordinates' : `in EPSG:${grid.epsg} grid coordinates`}, from station ${options.startStationM.toFixed(3)} m.`,
        }
      }
      case 'softree-terrain-ascii': {
        const zipped = await roadEngProjectFile(safe)
        const written = s.terrainAsciiFromRoadEngProject(zipped.bytes)
        return {
          content: written.text,
          filename: `${basename}-terrain.txt`,
          mime: 'text/plain',
          notice: [
            `Softree terrain ASCII downloaded, ${zipped.epsg === null ? 'in the design file’s own coordinates' : `in EPSG:${zipped.epsg} grid coordinates`}: the RoadEng project's terrain.`,
            ...written.notes,
          ].join(' '),
        }
      }
    }
  }
  /**
   * One output's file, built the same way for its download and its preview. The PDFs are not here:
   * they render and download in one step, and preview through the report page and the plan map.
   */
  const exportFile = async (
    kind: Exclude<
      RoadExport,
      | 'map-pdf'
      | 'report-pdf'
      | 'report-package'
      | 'estimate-pdf'
      | 'block-sheet-pdf'
      | 'dline-sheet-pdf'
      | 'plotbook-pdf'
    >,
  ): Promise<{ content: string | Blob; filename: string; mime: string; notice: string }> => {
    const { safe, basename } = exportBasis(kind)
    const text = (content: string, filename: string, mime: string, notice = 'Export downloaded.') => ({
      content:
        mime.startsWith('text/html') && !content.includes('id="pgmaps-export-brand"')
          ? brandedHtml(content, selectedExportBrand, printLogo)
          : content,
      filename,
      mime,
      notice,
    })
    switch (kind) {
      case 'terrain-landxml':
      case 'terrain-ascii': {
        const raster = safe.terrain.raster
        if (!raster) throw Error('Import or prepare an embedded terrain surface before exporting its grid.')
        const { terrainSurfaceLandXml, terrainAscii } = await import('./dev-forestry-roads/terrainPreparation')
        return text(
          kind === 'terrain-landxml'
            ? terrainSurfaceLandXml(raster, safe.terrain.preparation?.tin)
            : terrainAscii(raster),
          `${basename}-terrain.${kind === 'terrain-landxml' ? 'xml' : 'asc'}`,
          kind === 'terrain-landxml' ? 'application/xml' : 'text/plain',
          'Terrain surface exported with its source grid coordinates and datum notes.',
        )
      }
      case 'project':
        return text(serializeProject(safe), `${basename}.road.json`, 'application/json')
      case 'notes':
        return text(
          JSON.stringify(mapNotesGeoJson(safe.notes ?? []), null, 2),
          `${basename}-notes.geojson`,
          'application/geo+json',
          'Map notes exported.',
        )
      case 'streams-csv':
        return text(streamRegisterCsv(safe, w.analyses), `${basename}-streams.csv`, 'text/csv;charset=utf-8')
      case 'culvert-schedule-csv':
        // The road's own stationing names its stations, whatever the screen shows.
        return text(
          withStationing(alignment.stationing, () =>
            culvertScheduleCsv(
              buildCulvertSchedule({
                alignment,
                analysis,
                place: project.costLocation?.place,
                drainage: { record: drainageEvidence, stale: drainageStale },
              }),
            ),
          ),
          `${basename}-culverts.csv`,
          'text/csv;charset=utf-8',
          'Culvert schedule exported. Its appraisal columns are the manual’s figures, not part of the estimate.',
        )
      case 'provincial-evidence':
        if (!safe.provincialStreamData)
          throw Error('Load provincial stream evidence before exporting its source records.')
        return text(
          JSON.stringify(provincialEvidenceGeoJson(safe.provincialStreamData), null, 2),
          `${basename}-provincial-stream-evidence.geojson`,
          'application/geo+json',
        )
      case 'geojson':
        return text(
          JSON.stringify(
            projectGeoJson(
              { ...safe, alignments: exportRoads(safe.alignments, safe.activeAlignmentId, roadScope) },
              w.analyses,
            ),
            null,
            2,
          ),
          `${basename}.geojson`,
          'application/geo+json',
        )
      case 'plotbook': {
        if (terrainProfile) throw Error('Return to the road before plotting design sheets.')
        const book = await plotBookFor(safe, alignment, analysis, safe.reportSettings)
        return text(
          book.html,
          `${basename}-plot-book.html`,
          'text/html;charset=utf-8',
          book.contourError
            ? `Plot book downloaded without contours (${book.contourError}). Open it and use Print / Save as PDF.`
            : 'Plot book downloaded. Open it and use Print / Save as PDF.',
        )
      }
      case 'shapefile': {
        const [{ default: JSZip }, { writeShapefileLayer }, { shapefileStyleSidecars }] = await Promise.all([
          import('jszip'),
          import('./dev-forestry-roads/shapefile'),
          import('./dev-forestry-roads/styledExports'),
        ])
        const zip = new JSZip(),
          warnings: string[] = []
        const roads = exportRoads(safe.alignments, alignment.id, roadScope)
        const layers = roadShapefileLayers(roads, w.analyses, alignment.id)
        for (const layer of layers) {
          const written = writeShapefileLayer(layer)
          warnings.push(...written.warnings)
          for (const [name, bytes] of Object.entries(written.files)) zip.file(name, bytes)
        }
        // A style of each kind beside each layer, so it opens in QGIS or ArcGIS Pro looking as it does here.
        const styles = shapefileStyleSidecars(
          safe.name,
          layers,
          exportedRoadStyles({ alignments: roads }),
          roleOverrides(readStoredStyleLibrary()),
        )
        for (const file of styles.files) zip.file(file.path, file.content)
        return {
          content: await zip.generateAsync({ type: 'blob' }),
          filename: `${basename}-shapefiles.zip`,
          mime: 'application/zip',
          notice: warnings.length
            ? `Shapefiles downloaded with ${warnings.length} field warning${warnings.length === 1 ? '' : 's'}: ${warnings.join(' ')}`
            : 'Shapefiles downloaded with QGIS, SLD and ArcGIS Pro styles.',
        }
      }
      case 'qgis-project':
      case 'arcgis-pro':
      case 'web-map-style':
      case 'symbol-library': {
        const [{ default: JSZip }, bundle] = await Promise.all([import('jszip'), styledBundle(kind, safe)])
        const zip = new JSZip()
        for (const file of bundle.files) zip.file(file.path, file.content)
        const label = EXPORT_ITEMS.find((item) => item.kind === kind)?.label ?? 'Export'
        const approximations = bundle.diagnostics.filter((d) => d.severity !== 'info').length
        return {
          content: await zip.generateAsync({ type: 'blob' }),
          filename: `${basename}-${kind}.zip`,
          mime: 'application/zip',
          notice: [
            `${label} downloaded.`,
            approximations
              ? `${approximations} symbol part${approximations === 1 ? ' is' : 's are'} approximated; README.txt lists ${approximations === 1 ? 'it' : 'them'}.`
              : '',
            bundle.dataWarnings.length ? `Field warnings: ${bundle.dataWarnings.join(' ')}` : '',
          ]
            .filter(Boolean)
            .join(' '),
        }
      }
      case 'dxf': {
        if (terrainProfile) throw Error('Return to the road before exporting design geometry.')
        const { roadDxf } = await import('./dev-forestry-roads/dxfExport')
        const grid = exportGrid(project.terrain, alignment.points[0].coordinate)
        return text(
          roadDxf({ name: safe.name, alignment, analysis, terrain: project.terrain, ...grid }),
          `${basename}.dxf`,
          'application/dxf',
          `DXF downloaded: plan in EPSG:${grid.epsg} grid metres, profile and sections at true scale below it.`,
        )
      }
      case 'roadeng-project': {
        if (terrainProfile) throw Error('Return to the road before exporting design geometry.')
        const written = await roadEngProjectFile(safe)
        return {
          content: new Blob([Uint8Array.from(written.bytes)], { type: 'application/zip' }),
          filename: written.fileName,
          mime: 'application/zip',
          notice: [
            `RoadEng project downloaded: ${written.roads ? `${written.roads} road${written.roads === 1 ? '' : 's'} with terrain and layers` : 'its terrain and layers'}, in ${written.epsg === null ? 'the design file’s own coordinates' : `EPSG:${written.epsg} grid metres`}.`,
            ...written.notes,
          ].join(' '),
        }
      }
      case 'roadeng': {
        if (terrainProfile) throw Error('Return to the road before exporting design geometry.')
        const written = await roadEngFile(safe)
        return {
          content: new Blob([Uint8Array.from(written.bytes)], { type: 'application/octet-stream' }),
          filename: `${basename}.dsnx`,
          mime: 'application/octet-stream',
          notice: [
            `RoadEng design downloaded: ${written.roads} road${written.roads === 1 ? '' : 's'} in ${written.epsg === null ? 'the design file’s own coordinates' : `EPSG:${written.epsg} grid metres`}.`,
            ...written.notes,
          ].join(' '),
        }
      }
      case 'mass-haul-csv':
      case 'optimal-haul-csv':
      case 'optimal-areas-csv':
      case 'optimal-inputs':
      case 'softree-location-ascii':
      case 'softree-terrain-ascii':
        if (terrainProfile) throw Error('Return to the road before exporting design geometry.')
        return softreeFile(kind, safe, basename)
      case 'landxml':
      case 'stakeout': {
        if (terrainProfile) throw Error('Return to the road before exporting design geometry.')
        const grid = exportGrid(project.terrain, alignment.points[0].coordinate)
        return kind === 'landxml'
          ? text(
              landXml({ name: safe.name, alignment, analysis, terrain: project.terrain, ...grid }),
              `${basename}.xml`,
              'application/xml',
            )
          : text(stakeoutCsv({ alignment, analysis, ...grid }), `${basename}-stakeout.csv`, 'text/csv;charset=utf-8')
      }
      case 'csv':
        return text(
          terrainProfile
            ? terrainProfileCsv(displayedAnalysis, project.terrain)
            : stationsCsv(displayedAnalysis, project.terrain),
          `${basename}-stations.csv`,
          'text/csv;charset=utf-8',
        )
      case 'report':
        return text(
          reportHtml(safe),
          `${basename}-report.html`,
          'text/html;charset=utf-8',
          'Report downloaded. Open it and use Print / Save as PDF.',
        )
    }
  }
  /** The block sheet's run: the calculated roads, the issue stamp and any invalid-input notice. */
  const blockSheetRun = (kind: RoadExport, safe: RoadProject) => {
    const stamp = issueStamp(safe.issue)
    const invalid = exportInvalidInput(kind)
    return {
      settings: blockSheet.settings,
      project: safe,
      analyses: w.analyses,
      terrain: source,
      terrainName: `${project.terrain.name}, ${project.terrain.resolutionM} m`,
      terrainResolutionM: project.terrain.resolutionM,
      canopy: blockSheet.canopy,
      issue: {
        date: stamp.date,
        preparedBy: stamp.preparedBy,
        organisation: stamp.organisation,
        revision: stamp.revision,
      },
      logo: blockSheet.logo,
      stamp: invalid ? `NOT CURRENT: ${invalidInputNotice(invalid)}` : undefined,
      caveat: PLANNING_CAVEAT,
    }
  }
  /** What the package's summary page is drawn from: each road's analysis and readiness rows. */
  /** Estimate ranges already worked out, per road analysis and per assumptions (`estimateRange.ts`). */
  const estimateRanges = useRef(
    new WeakMap<RoadAnalysis, Map<string, import('./dev-forestry-roads/estimateRange').RoadEstimateRange>>(),
  )
  const summaryInputFor = async () => {
    const [
      { isEmptyFile, slopeSheetMode, includesContingency },
      { costRates, baseCosts },
      sheetCheck,
      { slopeSheetCase },
      { roadEstimateRange },
    ] = await Promise.all([
      import('./dev-forestry-roads/reportPackage'),
      import('./dev-forestry-roads/costRates'),
      import('./dev-forestry-roads/slopeSheetCheck'),
      import('./dev-forestry-roads/slopeSheetCase'),
      import('./dev-forestry-roads/estimateRange'),
    ])
    return (
      safe: RoadProject,
      plan: import('./dev-forestry-roads/reportPackage').PackagePlan,
      stampLines: string[],
      contents: { label: string; page: number | null }[],
      /** The Preliminary estimate export: the range always, its own contingency choice, no slope-sheet section. */
      forEstimate = false,
    ) => {
      const settings = parseRoadReportSettings(safe.reportSettings)
      const mode = forEstimate ? 'check' : slopeSheetMode(settings.package)
      const sheets = mode === 'off' ? [] : sheetCheck.slopeSheets(safe.reference)
      const estimate = settings.estimate ?? {}
      const contingency = forEstimate ? estimate.contingency !== false : includesContingency(settings.package)
      // The high case and its base are analysed the same way, so their difference is the benching alone.
      const analyse = (road: Alignment) =>
        safeAnalyzeRoad(road, source, safe.settings, safe.context, {
          referenceSurfaces: w.referenceSurfaces,
          verticalReference: safe.terrain.verticalReference,
          sharedCrossingCosts: safe.sharedCrossingCosts,
          gradeStandards: safe.standards,
        })
      const roads = exportRoads(safe.alignments, alignment.id, packageScope).flatMap((road) => {
        const roadAnalysis = w.analyses.get(road.id)
        if (!roadAnalysis?.stations.length) return []
        const check = sheets.length ? sheetCheck.bestSlopeSheetCheck(roadAnalysis.stations, sheets) : undefined
        const high = (() => {
          if (mode !== 'range' || !check?.stretches.length) return undefined
          const made = slopeSheetCase(road, roadAnalysis.stations, check.stretches, uid)
          return 'error' in made ? made : { base: analyse(road), case: analyse(made.alignment), change: made.change }
        })()
        // The low, medium and high estimate: each level analyses copies of the road, so it is kept per
        // analysis and assumptions and a preview does not run it again.
        const range = (() => {
          if (!forEstimate && !settings.package?.range) return undefined
          const key = JSON.stringify([estimate, contingency, check?.stretches ?? [], safe.settings])
          const kept = estimateRanges.current.get(roadAnalysis)?.get(key)
          if (kept) return kept
          const made = roadEstimateRange(road, {
            source,
            settings: safe.settings,
            context: safe.context,
            analysisOptions: {
              referenceSurfaces: w.referenceSurfaces,
              verticalReference: safe.terrain.verticalReference,
              sharedCrossingCosts: safe.sharedCrossingCosts,
              gradeStandards: safe.standards,
            },
            assumptions: {
              crossDrainSpacingM: estimate.crossDrainSpacingM ?? null,
              crossDrainCost: estimate.crossDrainCost ?? null,
              endHaulRate: estimate.endHaulRate ?? null,
            },
            contingency,
            slopeStretches: check?.stretches ?? [],
            id: uid,
          })
          const byKey = estimateRanges.current.get(roadAnalysis) ?? new Map()
          byKey.set(key, made)
          estimateRanges.current.set(roadAnalysis, byKey)
          return made
        })()
        const review = reportReview({ ...safe, activeAlignmentId: road.id }, roadAnalysis, {
          drainageHasLiveRun: road.id === alignment.id && !!drainageEntry && !drainageStale,
        }).review
        // The road as calculated (`safe` holds calculated inputs), so each rate is the one its cost used.
        return [
          {
            name: road.name,
            analysis: roadAnalysis,
            review: review?.rows ?? null,
            rates: costRates(road, safe.settings, roadAnalysis),
            ...(roadAnalysis.engineering ? {} : { baseCosts: baseCosts(roadAnalysis, safe.settings) }),
            ...(check === undefined || forEstimate
              ? {}
              : { slopeSheet: { check, ...(high ? { highCase: high } : {}) } }),
            ...(range ? { range } : {}),
          },
        ]
      })
      return {
        projectName: safe.name,
        roads,
        // The estimate counts contingency by its own choice; the package by the package's.
        settings: forEstimate ? { parts: {}, contingency, range: true } : settings.package,
        estimate,
        rule: gradeRule(safe.settings, safe.standards),
        terrain: safe.terrain,
        stamp: stampLines,
        contents,
        appendices: plan.appendices
          .filter((a) => !isEmptyFile(a))
          .map((a) => ({ filename: a.filename, title: a.title })),
        omitted: plan.omitted.map((part) => part.label),
      }
    }
  }
  /** The Preliminary estimate export's page (`estimateHtml`), as its PDF and its preview print it. */
  const estimatePageHtml = async (safe: RoadProject) => {
    const [{ estimateHtml }, { packagePlan }, summaryInput] = await Promise.all([
      import('./dev-forestry-roads/packageSummary'),
      import('./dev-forestry-roads/reportPackage'),
      summaryInputFor(),
    ])
    const plan = packagePlan(undefined, '')
    const input = summaryInput(safe, plan, [issueLine(issueStamp(safe.issue)), PLANNING_CAVEAT], [], true)
    return brandedHtml(estimateHtml({ ...input, appendices: [], omitted: [] }), selectedExportBrand, printLogo)
  }
  /**
   * The report package (`reportPackage.ts`): a main PDF and one PDF per appendix part, each with a
   * cover whose contents give the page every part starts on. One file downloads as itself; more
   * than one go in a zip.
   */
  const buildReportPackage = async (safe: RoadProject, basename: string, signal: AbortSignal) => {
    const [
      { packagePlan, describeFile, isEmptyFile, omittedFor, packageReportNotice, packageFront },
      { assemblePackageFile, mergePackageFile, entryStarts, pdfPageCount },
      { reportPdfBlob },
      { plotBookPdf },
      { blockSheetPdf },
      { createReportChapter, chartsOptions, chartsTitle },
      { packageSummaryHtml },
      packageSummaryInput,
    ] = await Promise.all([
      import('./dev-forestry-roads/reportPackage'),
      import('./dev-forestry-roads/reportPackagePdf'),
      import('./dev-forestry-roads/pdf'),
      import('./dev-forestry-roads/plotBookPdf'),
      import('./dev-forestry-roads/blockSheet'),
      import('./dev-forestry-roads/reportSettings'),
      import('./dev-forestry-roads/packageSummary'),
      summaryInputFor(),
    ])
    const settings = parseRoadReportSettings(safe.reportSettings)
    const plan = packagePlan(settings.package, basename)
    const summaryFront = packageFront(settings.package) === 'summary'
    const roads = exportRoads(safe.alignments, alignment.id, packageScope)
    // A summary front page is content of its own, so the main file is written even with no part in it.
    const files = [plan.main, ...plan.appendices].filter(
      (file) => !isEmptyFile(file) || (file === plan.main && summaryFront),
    )
    if (!files.length) throw Error('Every part is left out of the report package. Put at least one in it.')
    const invalid = exportInvalidInput('report-package')
    if (invalid && files.some((file) => file.plotbook.length))
      throw Error(invalidInputRefusal('A report package with plot-book sheets', invalid))
    const stamp = issueLine(issueStamp(safe.issue))
    const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
    const roadNames = roads.map((road) => road.name)
    const missing: string[] = []
    const written: { filename: string; bytes: Uint8Array; pages: number }[] = []
    for (const file of files) {
      const entries: { label: string; pdf: Uint8Array }[] = []
      for (const kind of file.sheets) {
        signal.throwIfAborted()
        const sheet = await blockSheetPdf({
          ...blockSheetRun('report-package', safe),
          settings: { ...blockSheet.settings, kind },
          signal,
          branding: selectedExportBrand,
        })
        missing.push(...sheet.built.missing)
        entries.push({ label: `Block map sheet · ${SHEET_PRESETS[kind].label}`, pdf: await bytes(sheet.blob) })
      }
      for (const road of roads) {
        const roadAnalysis = w.analyses.get(road.id)
        if (!roadAnalysis?.stations.length) {
          missing.push(`${road.name} has no calculated results and is left out.`)
          continue
        }
        if (file.report.length) {
          signal.throwIfAborted()
          const html = brandedHtml(
            projectReportHtml(
              {
                ...safe,
                activeAlignmentId: road.id,
                reportSettings: { ...settings, omittedSections: omittedFor(file) },
              },
              roadAnalysis,
              {
                drainageHasLiveRun: road.id === alignment.id && !!drainageEntry && !drainageStale,
                packageNotice: packageReportNotice(plan, file),
                analyses: w.analyses,
              },
            ),
            selectedExportBrand,
            printLogo,
          )
          entries.push({
            label: `${road.name} · report`,
            pdf: await bytes(await reportPdfBlob(html, selectedExportBrand, printLogo)),
          })
        }
        if (file.plotbook.length) {
          signal.throwIfAborted()
          const chapters = file.plotbook.flatMap((kind) => {
            const own = settings.chapters.filter((chapter) => chapter.kind === kind)
            const chosen = own.length ? own : [createReportChapter(kind, kind)]
            // The package's chart choices sit over the plot book's own for its charts sheets.
            return kind === 'charts' && settings.package?.charts
              ? chosen.map((chapter) => {
                  const charts = { ...chartsOptions(chapter), ...settings.package!.charts }
                  // A chapter still under its default title is renamed for the panels it now shows.
                  const title =
                    chapter.title === createReportChapter('charts', 'charts').title
                      ? chartsTitle(charts.panels)
                      : chapter.title
                  return { ...chapter, title, charts }
                })
              : chosen
          })
          const book = await plotBookFor(safe, road, roadAnalysis, { ...settings, chapters })
          if (book.contourError) missing.push(`${road.name}: plot book without contours (${book.contourError}).`)
          entries.push({
            label: `${road.name} · plot book`,
            pdf: await bytes(await plotBookPdf(book.html, settings.paper, signal, selectedExportBrand)),
          })
        }
      }
      const isMain = file === plan.main
      if (!entries.length && !(isMain && summaryFront)) continue
      const stampLines = [stamp, PLANNING_CAVEAT, ...(invalid ? [`NOT CURRENT: ${invalidInputNotice(invalid)}`] : [])]
      const meta = { title: `${safe.name} · ${isMain ? 'report package' : file.title}`, subject: PLANNING_CAVEAT }
      if (isMain && summaryFront) {
        // The summary opens the file in place of the cover; its contents list needs its own length first.
        const summaryPdf = async (contents: { label: string; page: number | null }[]) =>
          bytes(
            await reportPdfBlob(
              brandedHtml(
                packageSummaryHtml(packageSummaryInput(safe, plan, stampLines, contents)),
                selectedExportBrand,
                printLogo,
              ),
              selectedExportBrand,
              printLogo,
            ),
          )
        let front = await summaryPdf(entries.map((e) => ({ label: e.label, page: 999 })))
        const starts = await entryStarts(await pdfPageCount(front), entries)
        front = await summaryPdf(starts)
        const merged = await mergePackageFile(front, entries, meta)
        written.push({ filename: file.filename, bytes: merged.bytes, pages: merged.pages })
        continue
      }
      const assembled = await assemblePackageFile(
        {
          eyebrow: 'PGMaps forest road design · report package',
          title: `${safe.name} · ${isMain ? 'report package' : file.title}`,
          subtitle: roadNames.length === 1 ? roadNames[0] : `${roadNames.length} roads: ${roadNames.join(', ')}`,
          stamp: stampLines,
          holds: describeFile(file),
          appendices: isMain
            ? plan.appendices.filter((a) => !isEmptyFile(a)).map((a) => ({ filename: a.filename, title: a.title }))
            : [{ filename: plan.main.filename, title: 'Report package (the main file)' }],
          omitted: plan.omitted.map((part) => part.label),
        },
        entries,
        meta,
      )
      written.push({ filename: file.filename, bytes: assembled.bytes, pages: assembled.pages })
    }
    if (!written.length) throw Error('The report package came out empty: no road has calculated results.')
    const notice = [
      written.length === 1
        ? `Report package downloaded (${written[0].pages} pages).`
        : `Report package downloaded: ${written.map((f) => `${f.filename} (${f.pages} pages)`).join(', ')}.`,
      ...new Set(missing),
    ].join(' ')
    if (written.length === 1)
      return {
        blob: new Blob([written[0].bytes as BlobPart], { type: 'application/pdf' }),
        filename: written[0].filename,
        notice,
      }
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    for (const file of written) zip.file(file.filename, file.bytes)
    return {
      blob: await zip.generateAsync({ type: 'blob' }),
      filename: `${basename}-report-package.zip`,
      notice,
    }
  }
  /** The active D-line's sheet, with the project's issue stamp. */
  const dLineSheetRequest = (safe: RoadProject) => {
    // The live D-line, so a support layout found or checked on screen is the one printed.
    const line = cableLine
    if (!line) throw Error('Draw a D-line in Review first.')
    const stamp = issueStamp(safe.issue)
    return {
      project: safe,
      line,
      terrain: source,
      issue: {
        date: stamp.date,
        preparedBy: stamp.preparedBy,
        organisation: stamp.organisation,
        revision: stamp.revision,
      },
      caveat: PLANNING_CAVEAT,
    }
  }
  const save = (kind: RoadExport) => {
    try {
      const { safe, basename } = exportBasis(kind)
      if (kind === 'dline-sheet-pdf') {
        void run('Building the D-line sheet…', async (signal) => {
          const { dLineSheetPdf } = await import('./dev-forestry-roads/dline/sheetExport')
          const blob = await dLineSheetPdf({
            ...dLineSheetRequest(safe),
            signal,
            branding: selectedExportBrand,
            logo: printLogo,
          })
          const name = (cableLine?.name ?? 'd-line').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'd-line'
          downloadBlob(blob, `${basename}-${name.slice(0, 40)}-sheet.pdf`)
          w.setNotice('D-line sheet downloaded.')
        })
        return
      }
      if (kind === 'plotbook-pdf') {
        void run('Building the plot book PDF…', async (signal) => {
          const [book, { plotBookPdf }] = await Promise.all([
            exportFile('plotbook'),
            import('./dev-forestry-roads/plotBookPdf'),
          ])
          const paper = parseRoadReportSettings(safe.reportSettings).paper
          downloadBlob(
            await plotBookPdf(book.content as string, paper, signal, selectedExportBrand),
            `${basename}-plot-book.pdf`,
          )
          w.setNotice(
            book.notice
              .replace(/^Plot book downloaded/, 'Plot book PDF downloaded')
              .replace(/ Open it and use Print \/ Save as PDF\.$/, ''),
          )
        })
        return
      }
      if (kind === 'estimate-pdf') {
        void run('Pricing each road three ways…', async (signal) => {
          const html = await estimatePageHtml(safe)
          signal.throwIfAborted()
          const { reportPdfBlob } = await import('./dev-forestry-roads/pdf')
          downloadBlob(
            await reportPdfBlob(html, selectedExportBrand, printLogo),
            `${basename}-preliminary-estimate.pdf`,
          )
          w.setNotice('Preliminary estimate downloaded.')
        })
        return
      }
      if (kind === 'report-package') {
        void run('Building the report package…', async (signal) => {
          const built = await buildReportPackage(safe, basename, signal)
          downloadBlob(built.blob, built.filename)
          w.setNotice(built.notice)
        })
        return
      }
      if (kind === 'block-sheet-pdf') {
        void run('Building block map sheet…', async (signal) => {
          const { blockSheetPdf } = await import('./dev-forestry-roads/blockSheet')
          const { blob, built } = await blockSheetPdf({
            ...blockSheetRun(kind, safe),
            signal,
            branding: selectedExportBrand,
          })
          downloadBlob(blob, `${basename}-${blockSheet.settings.kind}.pdf`)
          w.setNotice(['Block map sheet downloaded.', ...built.missing].join(' '))
        })
        return
      }
      if (kind === 'map-pdf' || kind === 'report-pdf') {
        void run(kind === 'map-pdf' ? 'Building map PDF…' : 'Building report PDF…', async (signal) => {
          const { exportMapPdf, exportReportPdf } = await import('./dev-forestry-roads/pdf')
          if (kind === 'map-pdf') {
            if (hiddenPanels.includes('plan')) setHiddenPanels(hiddenPanels.filter((id) => id !== 'plan'))
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
            const map = planMap.current
            if (!map) throw Error('The plan map is still loading. Try again once it is ready.')
            resizeMap(map)
            // The stamp and the caveat ride on the page's source line, under the project name.
            await exportMapPdf(
              map,
              safe.name,
              project.terrain.name,
              `${project.terrain.verticalReference} | ${issueLine(issueStamp(safe.issue))} | ${PLANNING_CAVEAT}${
                exportInvalidInput(kind) ? ` | NOT CURRENT: ${invalidInputNotice(exportInvalidInput(kind)!)}` : ''
              }`,
              `${basename}-map.pdf`,
              signal,
              selectedExportBrand,
              printLogo,
            )
          } else await exportReportPdf(reportHtml(safe), `${basename}-report.pdf`, selectedExportBrand, printLogo)
          w.setNotice(kind === 'map-pdf' ? 'Map PDF downloaded.' : 'Report PDF downloaded.')
        })
        return
      }
      const download = (file: Awaited<ReturnType<typeof exportFile>>) => {
        if (typeof file.content === 'string') downloadText(file.content, file.filename, file.mime)
        else downloadBlob(file.content, file.filename)
        if (kind === 'project') w.markFileSaved()
        setLastExport(kind)
        w.setNotice(file.notice)
        w.setError('')
      }
      if (kind === 'terrain-landxml' || kind === 'terrain-ascii')
        void run('Exporting the terrain surface…', async () => download(await exportFile(kind)))
      else {
        if (kind === 'plotbook' || kind === 'shapefile')
          w.setNotice(`Building the ${kind === 'plotbook' ? 'plot book' : 'shapefiles'}…`)
        void exportFile(kind)
          .then(download)
          .catch((error) => w.setError(error instanceof Error ? error.message : 'Could not export project.'))
      }
    } catch (error) {
      w.setError(error instanceof Error ? error.message : 'Could not export project.')
    }
  }
  // A preview is rebuilt when anything its file is made from changes.
  const exportPreviewVersion = useMemo(
    () => ({
      project,
      analyses: w.analyses,
      displayedAnalysis,
      terrainProfile,
      source,
      hiddenPanels,
      roadScope,
      packageScope,
      sheet: blockSheet.settings,
      logo: blockSheet.logo,
      branding,
      styleLibraryRevision,
      locationAscii,
    }),
    [
      project,
      w.analyses,
      displayedAnalysis,
      terrainProfile,
      source,
      hiddenPanels,
      roadScope,
      packageScope,
      blockSheet.settings,
      blockSheet.logo,
      branding,
      styleLibraryRevision,
      locationAscii,
    ],
  )
  /** What the Save & export dialog shows for one output, from the content its download writes. */
  const buildExportPreview = async (kind: RoadExport, signal: AbortSignal): Promise<ExportPreview> => {
    const { safe } = exportBasis(kind)
    if (kind === 'report-pdf') return { type: 'html', html: reportHtml(safe) }
    if (kind === 'estimate-pdf') return { type: 'html', html: await estimatePageHtml(safe) }
    if (kind === 'report-package') {
      const [{ packagePlan, packagePreviewHtml, packageFront }, { packageSummaryHtml }, summaryInput] =
        await Promise.all([
          import('./dev-forestry-roads/reportPackage'),
          import('./dev-forestry-roads/packageSummary'),
          summaryInputFor(),
        ])
      const { basename } = exportBasis(kind)
      const settings = parseRoadReportSettings(safe.reportSettings)
      const plan = packagePlan(settings.package, basename)
      const files = packagePreviewHtml(
        plan,
        exportRoads(safe.alignments, alignment.id, packageScope).map((road) => road.name),
        `${basename}-report-package.zip`,
      )
      if (packageFront(settings.package) !== 'summary') return { type: 'html', html: files }
      // The summary page as it prints (page numbers are set when the file is laid out), then the files.
      const summary = packageSummaryHtml(
        summaryInput(safe, plan, [issueLine(issueStamp(safe.issue)), PLANNING_CAVEAT], []),
      )
      const filesBody = /<body>([\s\S]*)<\/body>/.exec(files)?.[1] ?? ''
      return {
        type: 'html',
        html: brandedHtml(
          summary.replace('</body>', `<hr style="margin:28px 0">${filesBody}</body>`),
          selectedExportBrand,
          printLogo,
        ),
      }
    }
    // The PDF draws the same sheets, so it previews the plot book page.
    if (kind === 'plotbook-pdf') return { type: 'html', html: (await exportFile('plotbook')).content as string }
    if (kind === 'dline-sheet-pdf') {
      const { dLineSheetPreview } = await import('./dev-forestry-roads/dline/sheetExport')
      const preview = await dLineSheetPreview({
        ...dLineSheetRequest(safe),
        signal,
        branding: selectedExportBrand,
        logo: printLogo,
      })
      return { type: 'image', src: preview.src, width: preview.width, height: preview.height }
    }
    if (kind === 'block-sheet-pdf') {
      const { blockSheetPreview } = await import('./dev-forestry-roads/blockSheet')
      const preview = await blockSheetPreview({ ...blockSheetRun(kind, safe), signal, branding: selectedExportBrand })
      return { type: 'image', src: preview.src, width: preview.width, height: preview.height }
    }
    if (kind === 'map-pdf') {
      const map = planMap.current
      if (!map || hiddenPanels.includes('plan') || map.getCanvas().clientWidth < 1)
        throw Error('Show the plan panel to preview its map. The PDF opens it for you.')
      const { mapImage } = await import('./dev-forestry-roads/pdf')
      const capture = await mapImage(map, signal)
      return { type: 'image', src: capture.image, width: capture.width, height: capture.height }
    }
    if (kind === 'optimal-inputs') {
      // The zip holds three CSV files; preview each under its name.
      const files = await optimalInputs(safe, exportBasis(kind).basename)
      return textPreview(files.map((file) => `${file.path}\n${file.content}`).join('\n'))
    }
    if (kind === 'roadeng-project') {
      // The zip is binary: preview what goes back to RoadEng unchanged, rewritten and left out.
      const [written, { roadEngCarryOverHtml }] = await Promise.all([
        roadEngProjectFile(safe),
        import('./dev-forestry-roads/roadEngTerrainOriginal'),
      ])
      return { type: 'html', html: roadEngCarryOverHtml(written.carryOver, written.notes) }
    }
    if (kind === 'roadeng') {
      // The archive is binary; preview the first road's line records, as written.
      return textPreview((await roadEngFile(safe)).parts['Location1.ds2'])
    }
    if (kind === 'qgis-project' || kind === 'arcgis-pro' || kind === 'web-map-style' || kind === 'symbol-library') {
      // The zip holds binary layers and other programs' styles: preview its legend, files and approximations.
      const [bundle, { styledExportPreviewHtml }] = await Promise.all([
        styledBundle(kind, safe),
        import('./dev-forestry-roads/styledExportPreview'),
      ])
      const label = EXPORT_ITEMS.find((item) => item.kind === kind)?.label ?? 'Export'
      return { type: 'html', html: styledExportPreviewHtml(label, bundle) }
    }
    if (kind === 'shapefile') {
      // The zip holds binary layers; preview the same layers' geometry instead.
      return {
        type: 'geometry',
        layers: roadShapefileLayers(
          exportRoads(safe.alignments, alignment.id, roadScope),
          w.analyses,
          alignment.id,
        ).map((layer) =>
          layer.type === 'point'
            ? { name: layer.name, points: layer.features.map((f) => f.point), lines: [] }
            : { name: layer.name, points: [], lines: layer.features.flatMap((f) => f.parts) },
        ),
      }
    }
    const file = await exportFile(kind)
    const content = typeof file.content === 'string' ? file.content : await file.content.text()
    if (file.mime.startsWith('text/html')) return { type: 'html', html: content }
    if (file.mime.startsWith('text/csv')) return csvPreview(content)
    if (file.mime === 'application/geo+json') return geoJsonPreview(JSON.parse(content))
    return textPreview(content)
  }
  const suggest = (options: RouteSearchOptions) =>
    void run('Searching terrain-cost routes…', async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      // A search replaces the roads of an earlier one that nobody changed, so those leave room for it.
      const replaceable = replaceableRouteAlternatives(project.alignments, alignment.id).length
      const result = suggestRoutes(
        alignment.points[0].coordinate,
        alignment.points[alignment.points.length - 1].coordinate,
        source,
        project.settings,
        project.context,
        {
          ...options,
          alternatives: Math.min(options.alternatives, 20 - project.alignments.length + replaceable),
          groundWindowM: resolvedGroundWindow(options, project.terrain.resolutionM),
        },
      )
      const found = terrainCostAlternatives({
        source: alignment,
        baseName: derivedRoadName(alignment),
        roads: project.alignments,
        routes: result.routes,
        terrain: source,
        context: project.context,
        minRadiusM: project.settings.minRadius,
        make: (coordinates, name) => newAlignment(coordinates, name, alignment.template),
      })
      w.commit(parseProject({ ...project, alignments: found.roads, activeAlignmentId: found.created[0].id }))
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
      w.setNotice([result.message, ...found.notes].join(' '))
    })
  const findFsrContext = async (origin: Coordinate, signal: AbortSignal, minimumCandidates = 1) => {
    let context = project.context
    const importedFsrNetwork = context.some(
      (feature) =>
        feature.kind === 'existing-road' &&
        feature.roadEvidence?.roadClass === 'fsr' &&
        feature.roadEvidence.source === 'user',
    )
    let networkScope = importedFsrNetwork
      ? 'The search used the identified FSRs in the user-provided network loaded in this project.'
      : 'The search used the loaded synthetic scenario FSR network.'
    if (project.terrain.kind !== 'demo' && !importedFsrNetwork) {
      const network = await loadNearestBcFsrs(origin, signal, minimumCandidates)
      if (signal.aborted) return
      networkScope = `Active BC FSR sections were queried within ${network.searchedRadiusM / 1000} km of the selected endpoint.`
      const merged = new Map(context.map((feature) => [feature.id, feature]))
      for (const road of network.roads) {
        const previous = merged.get(road.id)
        merged.set(road.id, refreshExistingRoadFeature(road, previous))
      }
      context = parseProject({ ...project, context: [...merged.values()] }).context
      w.commit({ ...project, context })
      if (!network.nearest.length)
        throw Error(
          `${networkScope} No active mapped FSR was found within the 10 km discovery limit. Import a wider local FSR network to search farther.`,
        )
    }
    return { context, scope: networkScope }
  }
  /** The access review's FSR loading: bounded BC FSR discovery around its end. */
  const loadFsrsNear = (at: Coordinate, signal: AbortSignal) => findFsrContext(at, signal, 3)
  const shiftSection = (metres: number) => {
    if (busy || !at || terrainProfile || draftAlignment) return
    const target = offsetCoordinate(at.coordinate, at.bearing + 90, metres)
    const nearest = alignment.points.reduce((a, b) =>
      distance(a.coordinate, at.coordinate) < distance(b.coordinate, at.coordinate) ? a : b,
    )
    if (distance(nearest.coordinate, at.coordinate) < 2) movePoint(nearest.id, target)
    else {
      let insert = 1,
        closest = Infinity
      for (let i = 1; i < alignment.points.length; i++) {
        const a = alignment.points[i - 1].coordinate,
          b = alignment.points[i].coordinate
        const score = distance(a, at.coordinate) + distance(at.coordinate, b) - distance(a, b)
        if (score < closest) {
          closest = score
          insert = i
        }
      }
      const shifted = {
        ...alignment,
        points: [
          ...alignment.points.slice(0, insert),
          { id: uid(), coordinate: target, radiusM: 0 },
          ...alignment.points.slice(insert),
        ],
      }
      if (
        !refusedPlanEdit(shifted) &&
        commitValidated({
          ...project,
          alignments: project.alignments.map((a) => (a.id === alignment.id ? shifted : a)),
        })
      )
        w.setNotice(
          'Added a horizontal control at this section. Review neighbouring curve radii and the revised profile.',
        )
    }
  }
  const shiftFormation = (delta: number) => {
    if (
      busy ||
      !at ||
      at.designElevation === null ||
      terrainProfile ||
      draftAlignment ||
      templatePreview ||
      costPreview
    )
      return
    const vertical = [...alignment.vertical]
    if (!vertical.length) {
      const first = analysis.stations[0],
        last = analysis.stations.at(-1)
      if (first?.groundElevation === null || last?.groundElevation == null) {
        w.setError('Add valid endpoint design elevations before shifting this section.')
        return
      }
      vertical.push(
        { id: uid(), chainage: 0, elevation: first.groundElevation, curveLength: 0 },
        { id: uid(), chainage: analysis.length, elevation: last.groundElevation, curveLength: 0 },
      )
    }
    const existing = vertical.find((v) => Math.abs(v.chainage - at.chainage) < 0.001)
    const changed = existing
      ? vertical.map((v) => (v.id === existing.id ? { ...v, elevation: v.elevation + delta } : v))
      : [...vertical, { id: uid(), chainage: at.chainage, elevation: at.designElevation + delta, curveLength: 0 }]
    const next = { ...alignment, vertical: changed.sort((a, b) => a.chainage - b.chainage) }
    commitValidated({ ...project, alignments: project.alignments.map((a) => (a.id === next.id ? next : a)) })
  }
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(
      () =>
        setStation((previous) => {
          const next = previous + project.settings.stationInterval
          if (next >= displayedAnalysis.length) {
            setPlaying(false)
            return displayedAnalysis.length
          }
          return next
        }),
      140,
    )
    return () => window.clearInterval(timer)
  }, [playing, displayedAnalysis.length, project.settings.stationInterval, setStation])
  const previewCoordinate = hover ?? draft[draft.length - 1]
  const previousCoordinate = hover ? draft[draft.length - 1] : draft[draft.length - 2]
  const leg = previousCoordinate && previewCoordinate ? distance(previousCoordinate, previewCoordinate) : 0
  const za = previousCoordinate ? source.elevationAt(...previousCoordinate) : NaN,
    zb = previewCoordinate ? source.elevationAt(...previewCoordinate) : NaN
  const pegGrade = leg > 0 && Number.isFinite(za + zb) ? ((zb - za) / leg) * 100 : null
  const isDrawing = !['inspect', 'edit'].includes(mode)
  const hasDraftPoint = isDrawing && draft.length > 0
  const undo = hasDraftPoint ? () => setDraft((points) => points.slice(0, -1)) : w.undo
  const canUndo = !busy && (hasDraftPoint || w.canUndo)
  const canRedo = !busy && !hasDraftPoint && w.canRedo
  // ⌘Z / Ctrl+Z undo outside text fields; while drawing they take back the last point first.
  const [applePlatform] = useState(isApplePlatform)
  const shortcutKeys = historyShortcutLabels(applePlatform)
  // The tool in hand draws its card on the plan (`MapToolPanel`), so starting one moves nothing.
  const overGradeLimit = pegGrade !== null && Math.abs(pegGrade) > project.settings.maxGradePercent
  const drawToolPanel: ReactNode = investigation ? null : mode === 'sketch' ? (
    <MapToolPanel
      title="Sketch road"
      icon={PencilLine}
      aria-label="Sketch road"
      data-testid="sketch-feedback"
      hint="Press and drag on the plan."
      help={
        <>
          A stroke that starts or ends at the active road&apos;s end continues it; corners take the{' '}
          {project.settings.minRadius} m minimum radius where they fit.
        </>
      }
      helpLabel="About sketching a road"
      onClose={() => beginMode('inspect')}
      closeLabel="Done sketching"
      closeTutorialId="road.sketch.done"
    />
  ) : isDrawing ? (
    <MapToolPanel
      title={
        mode === 'road'
          ? 'Peg road'
          : mode === 'trace'
            ? 'Trace road'
            : mode === 'extend'
              ? `Extend ${alignment.name}`
              : mode === 'avoid'
                ? `Draw ${drawnArea}`
                : `Draw ${mode}`
      }
      icon={DRAW_MODE_ICONS[mode] ?? PencilLine}
      aria-label="Drawing"
      data-testid="pegging-feedback"
      hint={
        mode === 'avoid'
          ? measureHint('polygon', true, draft.length, shortRibbon)
          : draft.length
            ? undefined
            : `${shortRibbon ? 'Tap' : 'Click'} the plan to add points${mode === 'extend' ? ' from the nearer road end' : ''}.`
      }
      onClose={() => beginMode('inspect')}
      closeLabel="Cancel drawing"
      actions={
        <>
          <Button
            size="xs"
            variant="ghost"
            className="mr-auto"
            disabled={!draft.length}
            title={`Undo point (${shortcutKeys.undo})`}
            aria-keyshortcuts={shortcutKeys.undoAria}
            onClick={() => setDraft((p) => p.slice(0, -1))}
          >
            Undo point
          </Button>
          <Button size="xs" onClick={finishDraw} disabled={draft.length < minimumDraftPoints(mode)}>
            {mode === 'extend'
              ? 'Finish extension'
              : `Finish ${mode === 'avoid' ? (polygonKind === 'harvest' ? 'block' : 'area') : mode}`}
          </Button>
        </>
      }
    >
      {mode === 'trace' && <TraceFeedback trace={trace} />}
      <ReadoutGrid
        data-testid="pegging-readout"
        minColumnWidth="6.5rem"
        items={
          mode === 'avoid'
            ? [
                { label: 'Points', value: draft.length },
                // As the measure tool reads a polygon: the perimeter so far, the area closed back to the first point.
                ...measureReadout('polygon', sketchStats('polygon', draft, false)),
              ]
            : [
                { label: 'Points', value: draft.length },
                draft.length > 0 && { label: 'Leg', value: `${number(leg)} m` },
                draft.length > 0 && { label: 'Ground', value: `${number(zb)} m` },
                draft.length > 0 && {
                  label: 'Grade',
                  value: `${number(pegGrade)}%`,
                  tone: overGradeLimit ? 'warning' : 'default',
                  title: overGradeLimit ? `Over the ${project.settings.maxGradePercent}% grade limit` : undefined,
                },
              ]
        }
      />
    </MapToolPanel>
  ) : null
  // Delete removes the point selected for editing, as the sidebar's Remove selected point does.
  const removablePoint =
    mode === 'edit' && displayedAlignment === alignment && !isMappedRoad(alignment) && alignment.points.length > 2
      ? (selectedPoint ?? null)
      : null
  // Escape puts down the drawing tool in hand, as its card's Cancel drawing / Done sketching does.
  const leaveDrawing = mode !== 'inspect' && !investigation ? () => beginMode('inspect') : null
  const historyKeys = useRef({ w, busy, undo, canUndo, canRedo, removablePoint, leaveDrawing })
  useEffect(() => {
    historyKeys.current = { w, busy, undo, canUndo, canRedo, removablePoint, leaveDrawing }
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { leaveDrawing: leave } = historyKeys.current
      if (leave && leavesDrawingOnEscape(event)) {
        event.preventDefault()
        leave()
        return
      }
      if (!event.defaultPrevented && isRemoveKey(event) && !keepsNativeUndo(event.target)) {
        const { w: workspace, busy: working, removablePoint: id } = historyKeys.current
        const index = workspace.alignment.points.findIndex((point) => point.id === id)
        if (working || index < 0) return
        event.preventDefault()
        workspace.updateAlignment((a) =>
          a.points.length > 2 ? { ...a, points: a.points.filter((point) => point.id !== id) } : a,
        )
        setSelectedPoint(null)
        workspace.setNotice(
          profileKeptNotice(workspace.alignment.vertical.length, `Point ${index + 1} removed`) ??
            `Point ${index + 1} removed. Undo brings it back.`,
        )
        return
      }
      const action = event.defaultPrevented ? null : historyShortcut(event, applePlatform)
      if (!action || keepsNativeUndo(event.target)) return
      event.preventDefault()
      const state = historyKeys.current
      if (action === 'undo' && state.canUndo) state.undo()
      if (action === 'redo' && state.canRedo) state.w.redo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applePlatform])
  // Other project roads meeting this one, marked on its profile with their level there.
  const profileJunctions = useMemo(
    () =>
      terrainProfile
        ? []
        : projectProfileJunctions(displayedAlignment, displayedAnalysis, project.alignments, w.analyses).junctions,
    [terrainProfile, displayedAlignment, displayedAnalysis, project.alignments, w.analyses],
  )
  const profileAnalysis = terrainProfile
    ? { ...displayedAnalysis, stations: displayedAnalysis.stations.map((s) => ({ ...s, designElevation: null })) }
    : displayedAnalysis
  // Profile + grade: one Shift-click measurement spans both charts, and the profile prints its readout.
  const profileGradeMeasurement = useChartMeasurement(
    `${displayedAlignment.id}:${profileAnalysis.length}:${!!terrainProfile}:profile-grade`,
  )
  // The vehicle check follows the displayed road; deferring it keeps drags and typing responsive.
  const sweptAlignment = useDeferredValue(displayedAlignment)
  const [showSwept, setShowSwept] = useState(true)
  const [junctionOverlay, setJunctionOverlay] = useState<GeoJSON.FeatureCollection | null>(null)
  const [vehicleToolOverlay, setVehicleToolOverlay] = useState<GeoJSON.FeatureCollection | null>(null)
  const sweptState = useMemo(() => {
    const check = sweptAlignment.vehicleCheck
    if (!check || terrainProfile) return { result: null, error: '' }
    try {
      return { result: analyzeSweptPath(sweptAlignment, check), error: '' }
    } catch (cause) {
      return { result: null, error: cause instanceof Error ? cause.message : 'The swept path could not be calculated.' }
    }
  }, [sweptAlignment, terrainProfile])
  const sweptOnPlan = useMemo(
    () => withJunctionOverlay(withJunctionOverlay(sweptState.result?.overlay, junctionOverlay), vehicleToolOverlay),
    [sweptState.result, junctionOverlay, vehicleToolOverlay],
  )
  // Review reads the result only once it is for the road on screen, never a deferred earlier one.
  const vehicleFitOnRoad = useMemo(
    () => (sweptState.result && sweptAlignment === alignment ? vehicleFit(sweptState.result) : null),
    [sweptState.result, sweptAlignment, alignment],
  )
  const swept: SweptPathProps = {
    ...sweptState,
    junctions: { alignments: project.alignments, context: project.context, onOverlay: setJunctionOverlay },
    tools: {
      onOverlay: setVehicleToolOverlay,
      notes: project.notes,
      reference: project.reference,
      alignments: project.alignments,
      library: project.vehicleLibrary ?? [],
      onLibraryChange:
        busy || draftAlignment || numericPegAlignment || terrainProfile || templatePreview || costPreview
          ? undefined
          : (library) => {
              const { vehicleLibrary: _old, ...rest } = project
              void _old
              commitValidated(library.length ? { ...rest, vehicleLibrary: library } : rest)
            },
    },
    showOnPlan: showSwept,
    onShowOnPlan: setShowSwept,
    onFocus: (turn) => {
      setShowSwept(true)
      w.setFeatureSelection({
        alignmentId: alignment.id,
        kind: 'range',
        id: `swept-${turn.id}`,
        start: turn.start,
        end: turn.end,
        label: `${turn.id} swept path`,
      })
      setStation(turn.worstChainage)
    },
    onChange:
      busy || draftAlignment || numericPegAlignment || terrainProfile || templatePreview || costPreview
        ? undefined
        : (vehicleCheck) =>
            commitValidated({
              ...project,
              alignments: project.alignments.map((a) => {
                if (a.id !== alignment.id) return a
                const { vehicleCheck: _old, ...rest } = a
                void _old
                return vehicleCheck ? { ...rest, vehicleCheck } : rest
              }),
            }),
  }
  // One schedule element serves the detail pane's Stations view and the four-pane data region,
  // so curve review and vertical controls are reachable beside plan, profile and section.
  const designSchedules = (
    <DesignSchedules
      alignment={displayedAlignment}
      analysis={displayedAnalysis}
      terrain={project.terrain}
      station={station}
      onStation={selectStation}
      terrainOnly={!!terrainProfile}
      swept={swept}
      clearingLimitM={project.standards?.maxClearingWidthM ?? null}
      onVerticalChange={
        busy || draftAlignment || numericPegAlignment || terrainProfile || templatePreview || costPreview
          ? undefined
          : (vertical) =>
              commitValidated({
                ...project,
                alignments: project.alignments.map((a) => (a.id === alignment.id ? { ...a, vertical } : a)),
              })
      }
    >
      <StationTable
        terrainOnly={!!terrainProfile}
        roadName={displayedAlignment.name}
        alignment={displayedAlignment}
        terrain={project.terrain}
        analysis={displayedAnalysis}
        station={station}
        onStation={selectStation}
      />
    </DesignSchedules>
  )
  function showPane(pane: RoadPaneId) {
    if (hiddenPanels.includes(pane)) setHiddenPanels(hiddenPanels.filter((id) => id !== pane))
    setFocusPane(pane)
    if (focusMode) setControlsOpen(false)
    if (shortRibbon) minimizeForCanvas()
  }

  function showControls(tab: SidebarTab) {
    setWorkflowTab(tab)
    setCollapsed(false)
    setControlsOpen(true)
  }

  function showDetailPane(next: typeof detail) {
    setDetail(next)
    showPane('detail')
  }
  function drawFromRibbon(next: DrawMode) {
    beginMode(next)
    showPane('plan')
  }
  function drawArea(kind: typeof polygonKind) {
    setPolygonKind(kind)
    drawFromRibbon('avoid')
  }
  function zoomPlan(step: number) {
    showPane('plan')
    planDisplay.zoom?.(step)
  }
  function fitPlan(target: FitRequest['target']) {
    showPane('plan')
    planDisplay.fit(target)
  }
  function togglePlanOption(set: (update: (shown: boolean) => boolean) => void) {
    showPane('plan')
    set((shown) => !shown)
  }
  function openExport(kind: RoadExport) {
    setExportDay(isoDate(new Date()))
    setExportOutput(kind)
    setFilesSelected(kind)
  }
  function openNewProject() {
    w.dismissExampleStart()
    setNewProjectRequest((n) => n + 1)
    setProjectsOpen(true)
  }
  /** Deletes the active road; the neighbour is shown, or an empty design after the last one, with Undo. */
  function deleteRoad() {
    if (mode !== 'inspect' && mode !== 'edit') beginMode('inspect')
    const result = removeRoad(project, alignment.id)
    if (!result) return
    w.update(() => result.project)
    setRemovedRoad({ removed: result.removed, opened: w.openedCount })
    setSelectedPoint(null)
    if (awaitingFirstRoad(result.project)) setMode('inspect')
  }
  function duplicateRoad() {
    if (isMappedRoad(alignment)) return copyMappedRoad()
    const copy = structuredClone(alignment)
    copy.id = uid()
    copy.name = `${copy.name} copy`
    copy.color = colors[project.alignments.length % colors.length]
    copy.points = copy.points.map((point) => ({ ...point, id: uid() }))
    copy.vertical = copy.vertical.map((point) => ({ ...point, id: uid() }))
    copy.overrides = copy.overrides.map((override) => ({ ...override, id: uid() }))
    if (commitValidated(withAddedAlignments(project, [copy]))) setActiveProfile(null)
  }
  const toolbar = investigation && active.toolbar?.header !== 'controls' ? undefined : ribbonPreferences.toolbar
  const noRoad = awaitingFirstRoad(project)
  const summaryAvailable = !investigation && !noRoad
  const summaryTab = toolbar?.groups.find(
    (group) =>
      group.commands?.includes('summarySettings') ||
      group.sections?.some(
        (section) => section.items.includes('summarySettings') || section.more?.includes('summarySettings'),
      ),
  )
  const summaryMetrics = summaryAvailable
    ? roadSummaryMetrics({
        analysis: displayedAnalysis,
        alignment: displayedAlignment,
        settings: project.settings,
        groundOnly,
        preview: costPreview,
        record: completeCostRecord,
        recordCurrent: completeCostCurrent,
        unpriced: unpricedCount,
        incomplete: incompleteReasons,
        costOpen: costPreview || completeCostRecord ? completeCostOpen : costOpen,
        curveNote: summaryControls.preferences.curveNote,
        onCost: costPreview || completeCostRecord ? openCompleteCosts : () => setCostOpen((open) => !open),
        onIncomplete: (chainage) => {
          setStation(chainage)
          setDetail('section')
        },
      })
    : []
  function showSummarySettings(key = '') {
    if (toolbar?.dock === 'top' && summaryTab && (summaryTab.label !== groupName || minimized)) {
      selectGroup(summaryTab.label)
    }
    setSummaryTarget(key)
  }
  // Commands that open a workflow editor are derived from the registry, not listed by hand.
  const editorCommands = Object.fromEntries(
    workspaceCommandIds.flatMap((id) => {
      const editor = commandDef(id).editor
      return editor ? [[id, () => showControls(editor)]] : []
    }),
  ) as Record<EditorCommand, () => void>
  const exportContext = {
    designPreview: !!(draftAlignment || numericPegAlignment || templatePreview || costPreview),
    hasResults: displayedAnalysis.stations.length > 0,
    invalidInput: exportInvalidInput,
    terrainProfile: !!terrainProfile,
    hasTerrainGrid: !!project.terrain.raster,
    hasProvincialEvidence: !!project.provincialStreamData,
    hasNotes: !!project.notes?.length,
    terrainOnly:
      !!project.terrain.raster && project.alignments.every((road) => road.id === project.designPlaceholderId),
    hasStreams: project.context.some((feature) => feature.kind === 'stream'),
    hasCulverts: !!alignment.engineering?.culverts.length,
    dLineSheetUnavailable: dLineSheetUnavailable(cableLine),
    optimalHaulUnavailable: optimalHaulUnavailable(analysis.engineering?.haul),
  }
  const commands: Record<WorkspaceCommand, () => void> = {
    branding: () => setBrandingOpen(true),
    ...commandRecord(ribbonExports, (output) => () => openExport(output.kind)),
    ...commandRecord(roadDetailViews, (view) => () => showDetailPane(view.value)),
    zoomIn: () => zoomPlan(1),
    zoomOut: () => zoomPlan(-1),
    mapSettings: () => {
      showPane('plan')
      planDisplay.setSettingsOpen(true)
    },
    mapLegend: () => togglePlanOption(planDisplay.setLegendOpen),
    haulInputs: () => showEngineeringInputs('haul'),
    customizeRibbon: () => setCustomizingRibbon(true),
    newProject: openNewProject,
    saveProject: () => save('project'),
    fieldNotes: () => togglePlanOption(planDisplay.setNotesOpen),
    importReference: () => {
      showPane('plan')
      setLayersOpen((open) => !open)
    },
    drawBlock: () => drawArea('harvest'),
    drawStream: () => drawFromRibbon('stream'),
    drawAvoid: () => drawArea('avoid'),
    drawProfile: () => drawFromRibbon('profile'),
    groundDrainage: () => {
      showPane('plan')
      setGroundDrainageOpen((open) => !open)
    },
    importAlignment: () => requestFile('alignment'),
    duplicateRoad,
    deleteRoad,
    traceRoad: () => drawFromRibbon('trace'),
    inspect: () => drawFromRibbon('inspect'),
    sectionCsv: saveSection,
    templates: () => showEngineeringInputs('templates'),
    materials: () => showEngineeringInputs('materials'),
    fullCosts: openCompleteCosts,
    network: () => setNetworkOpen(true),
    cable: () => drawFromRibbon('cable'),
    fitRoad: () => fitPlan('active'),
    fitAll: () => fitPlan('roads'),
    fitTerrain: () => fitPlan('terrain'),
    contours: () => togglePlanOption(planDisplay.setShowContours),
    stationLabels: () => togglePlanOption(planDisplay.setShowLabels),
    sentinel2: () => togglePlanOption(planDisplay.setShowSentinel),
    earthworks: () => togglePlanOption(planDisplay.setShowEarthwork),
    lidar: () => requestTerrain('lidar'),
    regional: () => loadTerrain('regional'),
    detailedDem: () => openDetailArea(),
    placeOnMap: () => setPlacingOnMap(true),
    compareRoadEng: () => setComparingRoadEng(true),
    peg: () => drawFromRibbon('road'),
    extend: () => drawFromRibbon('extend'),
    editPoints: () => drawFromRibbon('edit'),
    culverts: () => showCulverts(),
    startDesign: () => {
      w.update((current) => startInvestigationDesign(current))
      setWorkflowTab('design')
      setCollapsed(false)
      setControlsOpen(true)
      w.setNotice('Design started with no road. Peg or sketch the first road, or load a mapped road.')
    },
    loadMapped: loadMappedRoadsInView,
    undo,
    redo: w.redo,
    controls: () => (focusMode ? setControlsOpen(!controlsOpen) : setCollapsed(!collapsed)),
    summary: () => {
      summaryControls.change({ visible: !summaryControls.preferences.visible })
      setSummaryOpen(!summaryControls.preferences.visible)
    },
    summarySettings: () => showSummarySettings(),
    fullscreen: toggle,
    plan: () => showPane('plan'),
    projects: () => setProjectsOpen(true),
    open: () => requestFile('project'),
    export: () => (investigation ? save('project') : openExport('project')),
    import: () => requestFile('terrain'),
    ...editorCommands,
    findRoute: () => {
      showControls('design')
      // The design editor is mounted while hidden; reveal its section once the slot is shown.
      requestAnimationFrame(() => {
        const target = ref.current?.querySelector<HTMLElement>('[data-workflow-section="Find the best route"]')
        if (target) revealEditorSection(target)
      })
    },
    chooseInterface: () => setChoosingInterface(true),
    profile: () => showPane('profile'),
    sketch: () => drawFromRibbon('sketch'),
  }
  const runCommand = (id: WorkspaceCommand) => {
    commands[id]()
    roadTourActions.observe(ROAD_TOUR_ACTIONS.command, { command: id })
  }
  // Watch runs the same operations, and reports nothing: the stream carries only what the person did.
  // As Find the best route does: open the editor, then the section by its own toggle.
  function revealWorkflowSection(editor: string, section: string, scroll: boolean) {
    showControls(editor as SidebarTab)
    requestAnimationFrame(() => {
      const target = ref.current?.querySelector<HTMLElement>(`[data-workflow-section="${CSS.escape(section)}"]`)
      if (!target) return
      if (scroll) {
        revealEditorSection(target)
        // The section's own heading, which the step points at, wholly in the sidebar's scroll port.
        requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest' }))
      }
      // Opened where it is, so the control the step points at stays on screen.
      else if (target.matches('button[aria-expanded="false"]')) target.click()
    })
  }
  // A lesson's anchor, wherever this interface keeps it (`roadAnchorPlacement`): the moves are the
  // controls' own, skipped when the anchor is already drawn, and the anchor is then brought into its
  // scroll port, so a step never pauses on a control that is only scrolled away.
  function showTourAnchor(anchor: string, panes: boolean) {
    const selector = `[data-tutorial-id="${CSS.escape(anchor)}"], [data-tutorial-aliases~="${CSS.escape(anchor)}"]`
    const drawn = () =>
      [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.getClientRects().length > 0)
    // A drawn anchor needs no moves, except a readout's unfold: a chart can draw its readout for a frame
    // before its measured height folds it away, so that one is always asked for.
    const placement = roadAnchorPlacement(anchor, active.toolbar)
    const moves = drawn() ? placement.filter((move) => move.kind === 'details') : placement
    for (const move of moves) {
      if (move.kind === 'group') {
        if (move.group !== groupName) selectGroup(move.group)
      } else if (move.kind === 'controls') {
        if (focusMode) setControlsOpen(true)
        else setCollapsed(false)
      } else if (move.kind === 'editor') showControls(move.editor as SidebarTab)
      else if (move.kind === 'section') revealWorkflowSection(move.editor, move.section, false)
      else if (move.kind === 'details') detailChart.current?.showDetails()
      // "Take me back" shows the pane with its view; before a step a pane is only brought forward
      // (a Guided map tab), never reopened after the person closed it: the step's context offers that.
      else if (panes) commands[move.command as WorkspaceCommand]()
      else if (!hiddenPanels.includes(move.pane)) showPane(move.pane)
    }
    // A pane opened by a move mounts its chart header a frame or two later, so the readout's unfold is
    // asked again until the anchor is drawn; then it is brought into its scroll port.
    const unfold = moves.some((move) => move.kind === 'details')
    let frames = 0
    const settle = () => {
      const element = drawn()
      if (element) return element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      if (unfold) detailChart.current?.showDetails()
      if (++frames < ANCHOR_SETTLE_FRAMES) requestAnimationFrame(settle)
    }
    requestAnimationFrame(settle)
  }
  const executeTourAction = createRoadTourExecutor({
    isCommand: (id) => Object.prototype.hasOwnProperty.call(commands, id),
    runCommand: (id) => commands[id as WorkspaceCommand](),
    selectStation,
    selectRoad: selectAlignment,
    // The PVI level field's own update: the road's PVIs stay in station order.
    setPviLevel: (pvi, elevation) =>
      updateAlignment((a) => ({
        ...a,
        vertical: a.vertical.map((v, i) => (i === pvi - 1 ? { ...v, elevation } : v)),
      })),
    setTemplateField: (field, value) => {
      if (!TEMPLATE_FIELDS.some(([key]) => key === field)) throw new Error(`The template has no field "${field}".`)
      updateAlignment((a) => ({ ...a, template: { ...a.template, [field]: value } }))
    },
    revealSection: revealWorkflowSection,
    sketch: (stroke, metresPerPixel) => finishSketchRef.current(stroke, metresPerPixel),
    setImportDatum: setVerticalReference,
    // The file chooser's path, with the lesson's own sample in place of the chosen file.
    importFile: async (kind, path) => {
      const response = await fetch(withBase(`/${path}`))
      if (!response.ok) throw new Error(`The lesson's sample ${path} could not be read.`)
      const file = new File([await response.blob()], path.split('/').pop()!)
      fileKind.current = kind
      pendingProject.current = null
      await importFile([file])
    },
    selectInterface: (id) => {
      const next = layouts.find((layout) => layout.id === id)
      if (!next) throw new Error(`There is no interface "${id}".`)
      setChoosingInterface(false)
      setCustomizingRibbon(false)
      setSummaryTarget(null)
      setSummaryOpen(false)
      selectLayout(next, investigation)
    },
    selectLayoutPreset: (preset) => {
      const next = resolveLayout(preset, savedLayouts)
      setLayoutSelection(preset)
      if (!preset.startsWith('saved:')) restorePreset(next.base)
      if (next.base !== 'linked') setDetail('section')
    },
    setFilesOutput: (kind) => setFilesSelected(kind as RoadExport),
    // Save & export's Save, without the download: Watch keeps the project file for the next step.
    saveFile: async (kind) => {
      const file = await exportFile(kind as Parameters<typeof exportFile>[0])
      if (kind === 'project' && typeof file.content === 'string') {
        lessonSavedCopy.current = file.content
        w.markFileSaved()
      }
      setLastExport(kind)
      w.setNotice(`${file.filename} prepared for the lesson (Watch does not download it).`)
    },
    closeDialog: () => {
      setExportOutput(null)
      setChoosingInterface(false)
    },
    // Open's path for the copy Watch saved, kept in the training session (no library slot).
    reopenSavedCopy: async () => {
      if (openedFromFile) return
      const content = lessonSavedCopy.current ?? (await exportFile('project')).content
      if (typeof content !== 'string') throw new Error('The saved project is not a project file.')
      await w.restore(parseProject(JSON.parse(content)), undefined, null, { training: true })
      w.markFileSaved()
      setOpenedFromFile(true)
      w.setNotice('Opened the copy saved in this lesson.')
    },
    recordCrossings: () =>
      updateAlignment((a) => ({
        ...a,
        crossingRecords: synchronizeCrossingRecords(a, w.analysis.crossings, project.context),
      })),
    showAnchor: showTourAnchor,
  })
  const endTour = () => {
    setTourLaunch(null)
    // The address keeps the rest of its parameters; a reload then does not start the lesson again.
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${tourLaunchSearch(window.location.search, null)}${window.location.hash}`,
    )
  }
  const distributed = toolbar?.header === 'controls'
  // The desktop header line draws its tools as quiet, borderless buttons grouped on one strip
  // (`WorkspaceHeader`); the phone's row and the ribbon keep bordered ones.
  const quietHeader = !distributed && !mobileWorkspace
  const detachedControlsPlaced =
    (!distributed && (active.headerTools ?? DEFAULT_HEADER_TOOLS).includes('detachedPanels')) ||
    !!toolbar?.tabTools?.includes('detachedPanels') ||
    !!toolbar?.groups.some((group) =>
      group.sections?.some((section) => [...section.items, ...(section.more ?? [])].includes('detachedPanels')),
    )
  const editLocked = !!busy || !!costPreview
  const roadLimitReached = roadCount(project) >= MAX_PROJECT_ROADS
  const designResultsUnavailable = editLocked || noRoad || !!terrainProfile
  // Why a command is unavailable, in the order a user would have to clear them; shown in its tooltip.
  const busyReason = busy ? 'Wait for the current task to finish.' : undefined
  // A road with no terrain ground anywhere is a design-only road: its station bar reads the
  // design file's centreline ground where there is one ('none' without), never a missing-data warning.
  const designOnlyGround: number | 'none' | null = displayedAnalysis.stations.some((s) => s.groundElevation !== null)
    ? null
    : (groundAlong(alignment.fileGround?.points ?? [], station) ?? 'none')
  // A project opened from a design without a coordinate system: on the flat plane until placed.
  const onFlatPlane = project.terrain.epsg === LOCAL_PLANE_EPSG && !!project.terrain.localPlane
  const lockedReason = busyReason ?? (costPreview ? 'Close the cost preview first.' : undefined)
  const noRoadReason = noRoad ? 'Peg or sketch a road first.' : undefined
  const roadLimitReason = roadLimitReached ? `A project holds at most ${MAX_PROJECT_ROADS} roads.` : undefined
  const mappedReason = isMappedRoad(alignment)
    ? 'A mapped road is a record: copy it as a design to edit it.'
    : undefined
  const resultsReason =
    lockedReason ?? noRoadReason ?? (terrainProfile ? 'Not available while a terrain profile is open.' : undefined)
  const commandStates: Partial<Record<WorkspaceCommand, CommandState>> = {
    branding: { disabled: false },
    ...commandRecord(ribbonExports, (output) => ({
      disabled: !!busy || !!exportUnavailable(output.kind, exportContext),
    })),
    ...commandRecord(roadDetailViews, (view) => ({
      disabled: 'roadOnly' in view ? designResultsUnavailable : editLocked,
    })),
    zoomIn: { disabled: !planDisplay.zoom },
    zoomOut: { disabled: !planDisplay.zoom },
    mapSettings: { disabled: false },
    mapLegend: { disabled: false, pressed: planDisplay.legendOpen },
    haulInputs: { disabled: editLocked || noRoad },
    customizeRibbon: { hidden: !toolbar?.groups.some((group) => group.sections?.length), disabled: false },
    newProject: { disabled: !!busy, reason: busyReason },
    saveProject: { disabled: !!busy, reason: busyReason },
    duplicateRoad: {
      disabled: editLocked || noRoad || roadLimitReached,
      reason: lockedReason ?? noRoadReason ?? roadLimitReason,
      label: isMappedRoad(alignment) ? 'Copy as design' : undefined,
    },
    deleteRoad: { disabled: editLocked || investigation || noRoad, reason: lockedReason ?? noRoadReason },
    importAlignment: { disabled: editLocked || roadLimitReached, reason: lockedReason ?? roadLimitReason },
    fitRoad: { disabled: noRoad, reason: noRoadReason },
    fitTerrain: { disabled: !terrainBounds(project.terrain) },
    fitAll: { label: investigation ? 'Fit study records' : undefined },
    contours: { disabled: false, pressed: planDisplay.showContours },
    fieldNotes: { pressed: planDisplay.notesOpen },
    stationLabels: { disabled: false, pressed: planDisplay.showLabels },
    sentinel2: { disabled: false, pressed: planDisplay.showSentinel },
    earthworks: { hidden: !!terrainProfile, disabled: false, pressed: planDisplay.showEarthwork },
    drawBlock: { pressed: mode === 'avoid' && polygonKind === 'harvest' },
    drawAvoid: { pressed: mode === 'avoid' && polygonKind === 'avoid' },
    drawStream: { pressed: mode === 'stream' },
    drawProfile: { pressed: mode === 'profile' },
    groundDrainage: { pressed: groundDrainageOpen },
    traceRoad: { pressed: mode === 'trace' },
    inspect: { pressed: mode === 'inspect' },
    sectionCsv: {
      disabled: designResultsUnavailable || !at || !!(draftAlignment || numericPegAlignment || templatePreview),
    },
    templates: { disabled: editLocked || noRoad, reason: lockedReason ?? noRoadReason },
    materials: { disabled: editLocked || noRoad, reason: lockedReason ?? noRoadReason },
    culverts: { disabled: editLocked || noRoad, reason: lockedReason ?? noRoadReason },
    massHaul: { disabled: designResultsUnavailable, reason: resultsReason },
    sweptPath: { disabled: designResultsUnavailable, reason: resultsReason },
    peg: {
      disabled: editLocked || roadLimitReached,
      reason: lockedReason ?? roadLimitReason,
      pressed: mode === 'road',
    },
    sketch: { disabled: editLocked, reason: lockedReason, pressed: mode === 'sketch' },
    findRoute: {
      disabled: !!busy || isMappedRoad(alignment),
      reason: busyReason ?? (isMappedRoad(alignment) ? 'A mapped road compares routes from its own panel.' : undefined),
    },
    extend: {
      disabled: editLocked || isMappedRoad(alignment) || noRoad,
      reason: lockedReason ?? noRoadReason ?? mappedReason,
      pressed: mode === 'extend',
    },
    editPoints: {
      disabled: editLocked || isMappedRoad(alignment) || noRoad,
      reason: lockedReason ?? noRoadReason ?? mappedReason,
      pressed: mode === 'edit',
    },
    undo: {
      disabled: !canUndo,
      reason: 'Nothing to undo.',
      shortcut: shortcutKeys.undo,
      label: hasDraftPoint ? 'Undo point' : undefined,
    },
    redo: { disabled: !canRedo, reason: 'Nothing to redo.', shortcut: shortcutKeys.redo },
    projects: { disabled: !!busy },
    chooseInterface: { disabled: false },
    // Views and files of a road's results need a road; a terrain profile has its own stations and section.
    stations: { disabled: noRoad && !terrainProfile, reason: noRoadReason },
    crossSection: { disabled: noRoad && !terrainProfile, reason: noRoadReason },
    profile: { disabled: noRoad && !terrainProfile, reason: noRoadReason },
    landing: { disabled: designResultsUnavailable, reason: resultsReason },
    compare: { disabled: roadCount(project) < 2, reason: 'Needs two or more roads.' },
    compareRoadEng: {
      disabled: designResultsUnavailable || !analysis.stations.length,
      reason: resultsReason ?? 'The road has no calculated results yet.',
      pressed: comparingRoadEng,
    },
    cable: { disabled: editLocked, reason: lockedReason, pressed: mode === 'cable' },
    network: { disabled: noRoad, reason: noRoadReason },
    fullCosts: { disabled: editLocked || noRoad, reason: lockedReason ?? noRoadReason },
    stakeout: { disabled: !!busy || noRoad, reason: busyReason ?? noRoadReason },
    plotbook: { disabled: !!busy || noRoad, reason: busyReason ?? noRoadReason },
    reportPdf: { disabled: !!busy || noRoad, reason: busyReason ?? noRoadReason },
    exportGis: { disabled: !!busy || noRoad, reason: busyReason ?? noRoadReason },
    import: { disabled: !!busy, reason: busyReason },
    importReference: { pressed: layersOpen },
    lidar: { disabled: !!busy, reason: busyReason },
    regional: { disabled: !!busy, reason: busyReason },
    detailedDem: { disabled: !!busy, reason: busyReason, pressed: detailOpen },
    placeOnMap: {
      disabled: !!busy || !onFlatPlane || editLocked,
      reason: !onFlatPlane
        ? 'This project is on the map already. Place on map is for a design opened without a coordinate system.'
        : (lockedReason ?? busyReason),
      pressed: placingOnMap,
    },

    open: { disabled: !!busy },
    export: { disabled: !!busy, label: investigation ? 'Save project' : undefined },
    startDesign: { hidden: !investigation },
    loadMapped: {
      hidden: !investigation && !project.context.some(isLoadableMappedRoad),
      disabled: !!busy || (!investigation && roadLimitReached),
    },
    controls: {
      disabled: false,
      hidden: inlineWorkflow,
      pressed: controlsShown,
      label: investigation ? 'Access evidence' : 'Road controls',
    },
    summary: { disabled: !summaryAvailable, pressed: summaryControls.preferences.visible },
    summarySettings: { disabled: !summaryAvailable },
    fullscreen: { disabled: false, pressed: fullscreen, label: fullscreen ? 'Exit full screen' : 'Full screen' },
    drainage: { disabled: designResultsUnavailable, reason: resultsReason },
    quantities: { disabled: designResultsUnavailable, reason: resultsReason },
  }
  // An access investigation has evidence but no design yet: only commands the registry marks for it stay.
  if (investigation) for (const id of designOnlyCommands) commandStates[id] = { hidden: true }
  const saveMark = (trainingSave || saveNotice) && (
    <span
      role="img"
      aria-label={saveState.detail}
      title={saveState.detail}
      data-testid="road-save-mark"
      className={`mx-1 size-2 shrink-0 rounded-full ${trainingSave ? 'bg-warning' : 'bg-danger'}`}
    />
  )
  const InterfaceIcon = layoutIcons[active.icon]
  // The registry's Switch interface command, showing the interface in use. The header line names
  // it only on the widest screens, so the page title keeps its room beside the road switcher.
  const interfaceSwitch = (captionFrom: 'lg' | '2xl', surface: 'header' | 'toolbar' = 'header') => (
    <CommandButton
      id="chooseInterface"
      surface={surface}
      state={commandStates.chooseInterface}
      presentation={{
        ariaLabel: 'Switch workspace interface',
        title: `Switch workspace · ${active.name}`,
        captionFrom,
        caption: active.shortName ?? active.name,
        icon: (
          <InterfaceIcon
            className={
              surface === 'toolbar'
                ? 'size-4'
                : captionFrom === 'lg'
                  ? 'size-4 lg:mr-1 lg:size-3'
                  : 'size-4 2xl:mr-1 2xl:size-3'
            }
            aria-hidden="true"
          />
        ),
      }}
      onRun={runCommand}
    />
  )
  // On the header's strip the switch names the interface in use from a laptop width up.
  const interfaceSwitcher = quietHeader ? interfaceSwitch('lg', 'toolbar') : interfaceSwitch('2xl')
  const helpLayout = workspaceHelpSearch(active)
  const toggleStationPlayback = () => {
    if (station >= displayedAnalysis.length) w.setStation(0)
    setPlaying(!playing)
  }
  const workflowHelpHref = `${import.meta.env.BASE_URL}help?${helpLayout}`
  const workflowHelp = (
    <a
      data-workflow-help
      className={`inline-flex shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline ${
        quietHeader ? 'size-7 text-foreground/80 hover:text-foreground' : 'size-8'
      }`}
      href={workflowHelpHref}
      target="_blank"
      rel="noopener"
      aria-label="Workflow help (opens in a new tab)"
      title="Workflow help"
    >
      {/* Its own glyph: the Project library's books stand beside it on the header and the ribbon. */}
      <CircleQuestionMark aria-hidden="true" className="size-4" />
    </a>
  )
  // Below the width where the tab row has room for them, the colour scheme and help join the More menu.
  const narrowMenuExtras: ActionMenuItem[] = [
    ...themeModeItems,
    { type: 'separator', id: 'help-separator' },
    {
      id: 'workflow-help',
      label: 'Workflow help',
      icon: <CircleQuestionMark className="size-4" aria-hidden="true" />,
      onSelect: () => window.open(workflowHelpHref, '_blank', 'noopener'),
    },
  ]
  const projectNameControl = (
    <ProjectName name={project.name} disabled={!!busy} onRename={(name) => update((p) => ({ ...p, name }))} />
  )
  const projectStatus = (
    <HeaderStatus notice={w.notice} idle={w.ready && <SaveStateLine browser={w.browserSave} file={w.fileSave} />} />
  )
  const roadSwitcher = (
    <RoadSwitcher
      // On the header's project line it follows the project's name, as the next step of a path.
      className={distributed ? 'w-full' : 'flex-1 md:w-[clamp(9rem,17vw,17rem)] md:flex-none'}
      alignments={project.alignments}
      analyses={w.analyses}
      activeId={project.activeAlignmentId}
      disabled={!!w.busy}
      onSelect={selectAlignment}
      onCompare={distributed ? undefined : commands.compare}
    />
  )
  const presetPicker = (
    <LayoutPicker
      defaultWindows={active.panelWindows}
      compact={!distributed && (compact || focusMode)}
      showButtonLabel={distributed}
      size={distributed ? 'ribbon' : quietHeader ? 'toolbar' : 'default'}
      hiddenPanels={hiddenPanels}
      onHiddenPanels={setHiddenPanels}
      selection={layoutSelection}
      onSelect={(value, saved = savedLayouts) => {
        const next = resolveLayout(value, saved)
        setLayoutSelection(value)
        if (!value.startsWith('saved:')) restorePreset(next.base)
        if (next.base !== 'linked') setDetail('section')
      }}
      saved={savedLayouts}
      onSaved={setSavedLayouts}
      portalContainer={ref.current}
    />
  )
  const summarySettingsButton = summaryAvailable && (
    <CommandButton id="summarySettings" surface="header" state={commandStates.summarySettings} onRun={runCommand} />
  )
  const undoHistory = (
    <UndoHistoryButton
      rows={w.historyRows}
      onGo={w.goToHistory}
      checkpoints={w.checkpoints}
      onSaveCheckpoint={w.saveCheckpoint}
      onRestoreCheckpoint={w.restoreCheckpoint}
      onDeleteCheckpoint={w.deleteCheckpoint}
      disabled={!!busy}
      quiet={quietHeader}
    />
  )
  const workspaceTitle = investigation ? 'Forest access investigation' : 'Forest road design'
  // Each widget is rendered once; the header, ribbon and guide only decide where it sits.
  const workspaceWidgets: Partial<Record<WorkspaceWidget, ReactNode>> = {
    ...ribbonFields(
      w,
      { verticalReference, onVerticalReference: setVerticalReference, pointCloud, onPointCloud: setPointCloud },
      !noRoad,
      investigation,
      !terrainProfile && !noRoad ? { settings: drainageSettings, onSettings: changeDrainageSettings } : undefined,
    ),
    projectInfo: (
      <div className="lp-project-field">
        <h1>{workspaceTitle}</h1>
        {projectNameControl}
        {projectStatus}
      </div>
    ),
    // The road's name is its own field beside this one, so a lone road says so rather than repeating it.
    roadSelector: investigation ? null : project.alignments.length >= 2 ? (
      roadSwitcher
    ) : (
      <span className="lp-ribbon-note">
        {awaitingFirstRoad(project) ? 'No road yet' : 'The only road in this project'}
      </span>
    ),
    presets: investigation ? null : presetPicker,
    terrainDisplay: <TerrainLayerSelect value={planDisplay.terrainLayer} onChange={planDisplay.setTerrainLayer} />,
    terrainSource: (
      <div className="lp-source-field" title={`${project.terrain.name}\n\n${planningBasis}`}>
        {(() => {
          // "Regional Terrarium DEM · coarse screening" reads as a name, then what it is good for.
          const [name, ...qualifiers] = terrainDisplayName(project.terrain.name).split(' · ')
          const detail =
            project.terrain.kind === 'demo'
              ? 'Synthetic training surface'
              : terrainCellLabel(project.terrain.resolutionM)
          return (
            <>
              <strong>{name}</strong>
              <span>{[...qualifiers, detail].join(' · ')}</span>
            </>
          )
        })()}
      </div>
    ),
    interfaceSwitch: interfaceSwitcher,
    history: undoHistory,
    saveState: saveMark,
    detachedPanels: (
      <PanelWindowControls
        className={
          quietHeader
            ? 'road-detached-panels h-7 border-transparent bg-transparent px-2 text-xs shadow-none'
            : 'road-detached-panels h-7 text-xs'
        }
      />
    ),
  }
  // From the tablet width up the header is two lines (`WorkspaceHeader`) beside the brand, which
  // has its column to itself: the project line (the back link, the project's name, the road
  // switcher, then the warnings, the save line and the file buttons) over one strip of tools.
  const heading = (
    <>
      <div className="road-mobile-brand flex shrink-0 items-center md:hidden">
        <AccessLockup compact />
      </div>
      <h1 className="sr-only md:hidden">{workspaceTitle}</h1>
      <div className="road-workspace-heading hidden min-w-0 items-center gap-1 md:flex">
        <ForestryBackLink />
        <div className="road-workspace-title flex min-w-0 items-center gap-1">
          {/* The project's name is the line's title; the tool's name stays a heading for screen readers. */}
          <h1 className="sr-only">{workspaceTitle}</h1>
          {projectNameControl}
        </div>
      </div>
    </>
  )
  const headerFlags = (
    <>
      {/* Only a warning earns header space: imported LiDAR or DEM terrain is listed in the Terrain tab. */}
      {project.terrain.kind !== 'geotiff' && (
        <span
          title={planningBasis}
          data-testid="road-planning-basis"
          data-tutorial-id="road.header.basis"
          className="road-source-badge hidden shrink-0 cursor-help whitespace-nowrap rounded-full border border-warning-border bg-warning-surface px-2 py-0 text-3xs leading-4 text-warning-foreground sm:block"
        >
          {/* One wording at a time, so the badge's text is what it shows: the short one on a
            header narrower than a wide desktop. */}
          {compact || !wideHeader
            ? project.terrain.kind === 'demo'
              ? 'SYNTHETIC'
              : `${Math.round(project.terrain.resolutionM)} m terrain`
            : project.terrain.kind === 'demo'
              ? 'SYNTHETIC TRAINING'
              : `Coarse terrain · ${Math.round(project.terrain.resolutionM)} m`}
        </span>
      )}
      {/* From the moment a road opens: sections left out of quantities, and where their fixes are. */}
      {incompleteSections > 0 && (
        <button
          type="button"
          data-testid="road-incomplete-badge"
          title={`${incompleteSections} section${incompleteSections === 1 ? '' : 's'} on ${alignment.name} are left out of quantities. Open Review for why, and the fixes that would close them.`}
          onClick={() => {
            setWorkflowTab('review')
            setCollapsed(false)
            setControlsOpen(true)
            requestAnimationFrame(() =>
              // The Design tab keeps its own copy mounted but hidden; scroll to the one in view.
              Array.from(document.querySelectorAll<HTMLElement>('[data-testid="road-section-reach-alert"]'))
                .find((element) => element.offsetParent !== null)
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
            )
          }}
          className="road-source-badge hidden shrink-0 whitespace-nowrap rounded-full border border-warning-border bg-warning-surface px-2 py-0 text-3xs leading-4 text-warning-foreground hover:bg-warning-surface/80 sm:block"
        >
          {/* Short in every header: the title carries the sentence. */}
          {incompleteSections} incomplete
        </button>
      )}
      {layoutsFallback && (
        <p role="status" className="min-w-0 truncate text-2xs text-warning">
          Workspace layouts could not be loaded: using the built-in {DEFAULT_INTERFACE_NAME}.
        </p>
      )}
    </>
  )
  // How the header line presents registry commands; their labels, icons and behaviour stay in the registry.
  const controlsCaption = commandStates.controls?.label ?? 'Road controls'
  const headerPresentations: Partial<Record<WorkspaceCommand, CommandPresentation>> = {
    startDesign: { captionFrom: 'always' },
    loadMapped: { captionFrom: 'always' },
    controls: {
      ariaLabel: `${controlsShown ? 'Hide' : 'Show'} ${controlsCaption.toLowerCase()}`,
      // The strip's first button names the panel it folds, where there is room for the word.
      captionFrom: 'xl',
      shortLabel: investigation ? 'Evidence' : 'Controls',
      expanded: controlsShown,
      icon: controlsShown ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />,
    },
    undo: { ariaLabel: 'Undo road edit', keyShortcuts: shortcutKeys.undoAria },
    redo: { ariaLabel: 'Redo road edit', keyShortcuts: shortcutKeys.redoAria },
    // Icon only: the project's name is already the title beside it, and as a caption it took the
    // road switcher's room on a wide desktop.
    projects: {
      ariaLabel: 'Projects',
      title: `Projects · ${project.name}`,
    },
    open: { title: 'Open project', captionFrom: 'lg', shortLabel: 'Open' },
    export: { title: 'Save & export', captionFrom: 'lg', shortLabel: 'Save', emphasis: 'primary' },
    fullscreen: {
      ariaLabel: `${fullscreen ? 'Exit fullscreen' : 'Fullscreen'} Road workspace`,
      icon: fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />,
    },
  }
  const headerStates: Partial<Record<WorkspaceCommand, CommandState>> = {
    ...commandStates,
    // The header keeps its pressed-free look and shows these only where they apply on its line.
    controls: { ...commandStates.controls, pressed: undefined, hidden: false },
    fullscreen: { ...commandStates.fullscreen, pressed: undefined },
    undo: { ...commandStates.undo, label: undefined },
    loadMapped: { ...commandStates.loadMapped, hidden: !investigation },
    summarySettings: { ...commandStates.summarySettings, hidden: !summaryAvailable },
  }
  const projectHeader = (
    <WorkspaceHeader
      heading={heading}
      brand={<AccessLockup compact />}
      status={projectStatus}
      flags={headerFlags}
      // Only with a second road to switch to: one road leaves the path at the project's name.
      roadSwitcher={!investigation && project.alignments.length >= 2 && roadSwitcher}
      help={workflowHelp}
      projectInfo={
        <>
          {projectNameControl}
          {projectStatus}
        </>
      }
      tools={active.headerTools ?? DEFAULT_HEADER_TOOLS}
      widgets={workspaceWidgets}
      states={headerStates}
      presentations={headerPresentations}
      disabled={!!busy}
      onCommand={runCommand}
    />
  )
  const workspaceTools = toolbar && (
    <>
      <WorkspaceTools
        key={active.id}
        toolbar={toolbar}
        groupName={groupName}
        folded={folded}
        onToggleFold={toggleFold}
        minimized={minimized}
        onToggleMinimized={toggleMinimized}
        onGroupChange={selectGroup}
        onReorderTabs={(labels) => {
          if (ribbonPreferences.reorderTabs(labels) === false)
            w.setNotice('Ribbon tabs reordered for this session. Browser storage is unavailable.')
        }}
        editorsAvailable={!investigation}
        editorHost={editorHost}
        editorMount={inlineWorkflow ? attachEditor : undefined}
        disabled={editLocked}
        states={commandStates}
        leading={distributed && <ForestryBackLink />}
        quickTools={distributed && undoHistory}
        narrowMenu={distributed ? ['chooseInterface'] : undefined}
        narrowMenuExtras={distributed ? narrowMenuExtras : undefined}
        switcher={
          distributed && (
            <>
              {!summaryTab && summarySettingsButton}
              {/* A fixed slot: the mark coming and going never moves the tools beside it. */}
              <span className="lp-status-slot">{saveMark}</span>
              {interfaceSwitch('lg')}
              <ThemeModeButton />
              {workflowHelp}
            </>
          )
        }
        widgets={workspaceWidgets}
        onCommand={runCommand}
      >
        {toolbar.includeProjectHeader && projectHeader}
      </WorkspaceTools>
      {customizingRibbon && ribbonPreferences.defaults && (
        <CustomizeRibbonPane
          toolbar={toolbar}
          defaults={ribbonPreferences.defaults}
          currentTab={groupName}
          onClose={() => setCustomizingRibbon(false)}
          onApply={(draft) => {
            const saved = ribbonPreferences.save(draft)
            setCustomizingRibbon(false)
            if (saved === false) w.setNotice('Ribbon updated for this session. Browser storage is unavailable.')
          }}
        />
      )}
    </>
  )

  const workspace = (
    <div
      data-interface={active.id}
      data-panel-background={panelFrame?.background}
      data-panel-inset={panelFrame?.inset !== undefined || undefined}
      style={
        {
          '--workspace-panel-gray': panelFrame?.grayPercent !== undefined ? `${panelFrame.grayPercent}%` : undefined,
          '--workspace-panel-inset': panelFrame?.inset !== undefined ? `${panelFrame.inset}px` : undefined,
          '--workspace-panel-gap': panelFrame?.gap !== undefined ? `${panelFrame.gap}px` : undefined,
        } as CSSProperties
      }
      data-tool-dock={toolbar?.dock}
      ref={ref}
      data-fullscreen={fullscreen || undefined}
      className="road-workspace relative flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-muted/20 py-3 [&[data-fullscreen]]:fixed [&[data-fullscreen]]:inset-0 [&[data-fullscreen]]:z-menu [&[data-fullscreen]]:h-dvh [&[data-fullscreen]]:bg-background [&[data-fullscreen]]:pt-3"
      data-testid="road-workspace"
      data-workspace-mode={investigation ? 'access-investigation' : 'design'}
      data-compact={compact || undefined}
      data-focus-mode={focusMode || undefined}
      data-tiny-height={tinyHeight || undefined}
    >
      {brandingOpen && branding.ready && (
        <BrandingDialog onClose={() => setBrandingOpen(false)} portalContainer={ref.current} />
      )}
      {!distributed && !toolbar?.includeProjectHeader && projectHeader}
      {toolbar?.dock === 'top' && workspaceTools}
      {choosingInterface && (
        <InterfaceChooser
          layouts={layouts}
          current={active}
          onCancel={() => setChoosingInterface(false)}
          onChoose={(next) => {
            setChoosingInterface(false)
            setCustomizingRibbon(false)
            setSummaryTarget(null)
            setSummaryOpen(false)
            selectLayout(next, investigation)
          }}
        />
      )}
      <ProjectsDialog
        open={projectsOpen}
        onOpenChange={setProjectsOpen}
        library={w.library}
        activeId={w.projectId}
        centre={(() => {
          const [x0, y0, x1, y1] = boundsOf(project)
          return [(x0 + x1) / 2, (y0 + y1) / 2]
        })()}
        busy={!!busy}
        onOpen={switchProject}
        onDuplicate={(id) =>
          void w.duplicateProject(id).then(
            () => w.setNotice('Duplicated. The copy is in Projects.'),
            (cause) => w.setError(cause instanceof Error ? cause.message : 'Could not duplicate the project.'),
          )
        }
        onDelete={(id) =>
          void w
            .removeProject(id)
            .catch((cause) => w.setError(cause instanceof Error ? cause.message : 'Could not delete the project.'))
        }
        onOpenFile={commands.open}
        onCreate={createProject}
        onScenario={openScenario}
        onOpenBcOpening={openBcOpening}
        onOpenBcPlannedBlock={openBcPlannedBlock}
        portalContainer={ref.current}
        newProjectRequest={newProjectRequest}
        startingStandards={STARTING_JOB_STANDARDS}
      />
      <NetworkPlanningDialog
        workspace={w}
        open={!investigation && networkOpen}
        onOpenChange={setNetworkOpen}
        onReviewRoad={(id) => {
          setNetworkOpen(false)
          openRoadReview(id)
        }}
        portalContainer={ref.current}
        onPreview={(next) => {
          setNetworkPreview(next ? { project, source, overlay: next } : null)
          if (next) {
            setMode('inspect')
            setDraft([])
            setFocusPane('plan')
          }
        }}
        onAdopt={(candidate) => {
          const next = parseProject({
            ...project,
            alignments: [...project.alignments, candidate],
            activeAlignmentId: candidate.id,
          })
          update(() => next)
          setNetworkPreview(null)
          setCompleteCostPreview(null)
          setTemplatePreview(null)
          setPegPreview(null)
          setActiveProfile(null)
          setSelectedPoint(null)
          setMode('inspect')
          setDraft([])
          setStation(0)
          setNetworkOpen(false)
          setWorkflowTab('design')
          setFitRevision((revision) => revision + 1)
          w.setNotice(
            'Network branch added as an editable alignment. Review exact junctions, curves, switchbacks, vertical design and road footprint before using engineering quantities.',
          )
        }}
      />
      <FullCostPlanningDialog
        workspace={w}
        open={!investigation && completeCostOpen}
        onOpenChange={setCompleteCostOpen}
        portalContainer={ref.current}
        onPreview={(preview) => {
          setCompleteCostPreview(preview ? { project, source, preview } : null)
          if (preview) {
            setControlsOpen(false)
            setActiveProfile(null)
            setTemplatePreview(null)
            setPegPreview(null)
            setMode('inspect')
            setDraft([])
            setSelectedPoint(null)
            setStation(0)
            setFitRevision((revision) => revision + 1)
          }
        }}
        onAdopt={() => {
          setCompleteCostPreview(null)
          setActiveProfile(null)
          setTemplatePreview(null)
          setPegPreview(null)
          setMode('inspect')
          setDraft([])
          setSelectedPoint(null)
          setFitRevision((revision) => revision + 1)
        }}
        onReviewRoads={openRoadReview}
      />
      <FilesDialog
        open={!investigation && exportOutput !== null}
        initialOutput={exportOutput ?? 'project'}
        selected={filesSelected}
        onSelectedChange={setFilesSelected}
        onOpenChange={(open) => {
          if (!open) setExportOutput(null)
        }}
        name={project.name}
        onName={(name) => update((p) => ({ ...p, name }))}
        onSave={save}
        reportSettings={project.reportSettings}
        onReportSettings={(reportSettings) => update((p) => ({ ...p, reportSettings }))}
        slopeSheet={(project.reference ?? []).some((feature) => feature.classGrid?.kind === 'slope')}
        issue={project.issue}
        onIssue={(issue) => update((p) => ({ ...p, issue }))}
        today={exportDay}
        roads={{
          count: project.alignments.filter((road) => road.id !== project.designPlaceholderId).length,
          activeName: alignment.name,
        }}
        baselineRoads={project.alignments
          .filter((road) => road.id !== alignment.id && road.id !== project.designPlaceholderId)
          .map((road) => ({ id: road.id, name: road.name }))}
        roadScope={scopeFor}
        onRoadScope={(scope, kind) =>
          (kind === 'report-package' || kind === 'estimate-pdf' ? setPackageScope : setRoadScope)(scope)
        }
        busy={!!busy}
        portalContainer={ref.current}
        context={exportContext}
        buildPreview={buildExportPreview}
        previewVersion={exportPreviewVersion}
        setupViews={{
          'block-sheet-pdf': blockSheet.setup,
          'softree-location-ascii': (
            <SoftreeLocationOptions
              value={locationAsciiOptions()}
              onChange={setLocationAscii}
              projectUnitM={project.terrain.localPlane?.unitM ?? 1}
            />
          ),
          ...Object.fromEntries(
            STYLE_LIBRARY_EXPORTS.map((kind) => [
              kind,
              <StyleLibraryPanel key="styles" onChange={() => setStyleLibraryRevision((n) => n + 1)} />,
            ]),
          ),
        }}
        setupLabels={{
          ...Object.fromEntries(STYLE_LIBRARY_EXPORTS.map((kind) => [kind, 'Styles'])),
          'softree-location-ascii': 'Options',
        }}
        blockSheetSettings={{ value: blockSheet.settings, onApply: blockSheet.apply }}
      />
      <CostBreakdown
        open={!investigation && costOpen && !!displayedAnalysis.stations.length}
        onOpenChange={setCostOpen}
        analysis={displayedAnalysis}
        alignment={displayedAlignment}
        settings={project.settings}
        portalContainer={ref.current}
        attribution={costAttribution}
        onFocusStretch={focusCostStretch}
        colourBy={roadColour === 'cost' ? shownCostSeries : null}
        onColourBy={colourRoadByCost}
        onSettings={(patch) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } }))}
        project={project}
        // Each cost-dialog write (location, adoption, build-up, budget, scenarios) is its own undo step.
        onProjectEdit={(edit, label) => update(edit, label, { ownStep: true })}
        runCase={(caseAlignment, caseSettings) =>
          safeAnalyzeRoad(caseAlignment, source, caseSettings, project.context, {
            referenceSurfaces: w.referenceSurfaces,
            verticalReference: project.terrain.verticalReference,
            sharedCrossingCosts: project.sharedCrossingCosts,
            gradeStandards: project.standards,
          })
        }
        onHaul={
          busy || terrainProfile || draftAlignment || numericPegAlignment || templatePreview || costPreview
            ? undefined
            : (patch) =>
                updateAlignment((a) =>
                  a.engineering
                    ? { ...a, engineering: { ...a.engineering, haul: { ...a.engineering.haul, ...patch } } }
                    : a,
                )
        }
        onMaterialRate={
          busy || terrainProfile || draftAlignment || numericPegAlignment || templatePreview || costPreview
            ? undefined
            : (id, cutRate) =>
                updateAlignment((a) =>
                  a.engineering
                    ? {
                        ...a,
                        engineering: {
                          ...a.engineering,
                          materials: a.engineering.materials.map((m) => (m.id === id ? { ...m, cutRate } : m)),
                        },
                      }
                    : a,
                )
        }
      />
      {detailOpen && (
        <DetailAreaDialog
          project={project}
          view={detailView}
          importedAreas={importedDetailAreas}
          portalContainer={ref.current}
          onClose={() => {
            setDetailOpen(false)
            setDetailBox(null)
          }}
          onPreview={(boxes) => {
            setDetailBox(boxes.map((b) => b.window.quad))
            showOnPlan(boxes.flatMap((b) => b.window.quad))
          }}
          onDownload={downloadDetailAreas}
          onDownloadBoxes={(boxes) =>
            downloadText(
              JSON.stringify(demBoxesGeoJson(boxes), null, 2),
              'dem-download-boxes.geojson',
              'application/geo+json',
            )
          }
          onLoad={loadDetailArea}
          onLoadFiles={loadLidarBcFiles}
          onLoadCded={loadCdedFiles}
          initialSource={detailStart?.source}
          initialAreaId={detailStart?.areaId}
        />
      )}
      {layerImportFiles && (
        <LayerImportDialog
          files={layerImportFiles}
          buffers={project.cutblockBuffers}
          portalContainer={ref.current}
          onCancel={() => setLayerImportFiles(null)}
          onImport={commitLayerImport}
        />
      )}
      {layerToDelete && (
        <PanelDialog
          title="Delete layer?"
          subtitle={layerToDelete.name}
          portalContainer={ref.current}
          onClose={() => setLayerToDelete(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setLayerToDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const next = removeImportedLayer(project, layerToDelete.key)
                  w.commit(shareUnchanged(project, next), true, 'Delete layer', true)
                  setLayerToDelete(null)
                  setFocusedReferenceId(null)
                  w.setNotice(`Deleted ${layerToDelete.name}. Use Undo to restore it.`)
                }}
              >
                Delete layer
              </Button>
            </div>
          }
        >
          <p className="text-sm">Removes the imported layer and its buffer setting from this project.</p>
        </PanelDialog>
      )}
      {spatialChoice && (
        <SpatialImportDialog
          key={spatialChoice.file.fileName}
          file={spatialChoice.file}
          intent={spatialChoice.intent}
          initial={spatialChoice.roles}
          portalContainer={ref.current}
          onCancel={() => {
            setSpatialChoice(null)
            w.setNotice(`Nothing was imported from ${spatialChoice.file.fileName}.`)
          }}
          onImport={(roles) => {
            try {
              commitSpatial(spatialChoice.file, roles, spatialChoice.intent)
            } catch (cause) {
              w.setError(cause instanceof Error ? cause.message : 'Could not import this file.')
            }
          }}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        data-testid="road-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          // Cleared so picking the same file again (after a refusal or a wait) opens it again.
          e.target.value = ''
          if (!files.length) return
          if (w.busy) {
            // Opened while something else runs: it opens when that finishes, never silently dropped.
            pendingFiles.current = { files, kind: fileKind.current }
            // A project of one's own replaces the first visit's example: stop loading it rather than wait.
            if (fileKind.current === 'project' && w.skipExampleLoad()) return
            w.setNotice(
              `${files.length > 1 ? `${files.length} files` : files[0].name} will open when the current task finishes.`,
            )
            return
          }
          void importFile(files)
        }}
      />
      {comparingRoadEng && (
        <Suspense fallback={null}>
          <SoftreeCompareDialog
            alignment={alignment}
            analysis={analysis}
            terrain={project.terrain}
            portalContainer={ref.current}
            onStation={setStation}
            onClose={() => setComparingRoadEng(false)}
          />
        </Suspense>
      )}
      {tourLaunch && w.ready && (
        <Suspense fallback={null}>
          <RoadLessonPlayer
            launch={tourLaunch}
            snapshot={tourSnapshot({
              training: w.training,
              interfaceId: active.id,
              roadName: displayedAlignment.name,
              roadLength: displayedAnalysis.length,
              station: w.station,
              visiblePanes: focusMode ? (focusedPane ? [focusedPane] : []) : focusOptions.map((option) => option.value),
              detail,
              workflow: { editor: workflowTab, shown: inlineWorkflow ? !folded && !minimized : controlsShown },
              toolMode: mode,
              roadId: alignment.id,
              roadCount: project.alignments.length,
              groundShare: displayedAnalysis.stations.length
                ? (100 * displayedAnalysis.stations.filter((s) => Number.isFinite(s.groundElevation ?? NaN)).length) /
                  displayedAnalysis.stations.length
                : 0,
              pviLevels: alignment.vertical.map((v) => v.elevation),
              template: { leftWidth: alignment.template.leftWidth, rightWidth: alignment.template.rightWidth },
              section: at
                ? {
                    formationZ: at.designElevation,
                    groundZ: at.groundElevation,
                    widthLeft: at.leftWidth,
                    widthRight: at.rightWidth,
                  }
                : null,
              terrain: {
                name: project.terrain.name,
                kind: project.terrain.kind,
                cellM: project.terrain.resolutionM ?? null,
                epsg: project.terrain.epsg ?? null,
                verticalReference: project.terrain.verticalReference ?? '',
              },
              importDatum: verticalReference,
              busy: !!busy,
              layoutPreset: layoutSelection,
              dialog: choosingInterface ? 'interface' : exportOutput !== null ? 'files' : null,
              filesOutput: filesSelected,
              fileSaved: !!w.fileSave,
              lastExport,
              openedFromFile,
              openSections: [...openSections],
              crossingRecords: alignment.crossingRecords?.length ?? 0,
            })}
            execute={executeTourAction}
            actions={roadTourActions}
            onEnd={endTour}
          />
        </Suspense>
      )}
      {placingOnMap && project.terrain.localPlane && (
        <PlaceOnMapDialog
          project={project}
          portalContainer={ref.current}
          onCancel={() => setPlacingOnMap(false)}
          onPlace={(placement) => {
            setPlacingOnMap(false)
            void run('Placing the project on the map…', async () => {
              const { placeProject } = await import('./dev-forestry-roads/localPlane')
              const placed = placeProject(project, placement)
              const source = terrainFromMetadata(placed.project.terrain)
              if (!source) throw Error('The placed terrain could not be read.')
              if (!commitValidated(placed.project)) return
              w.setSource(source)
              w.setNotice(
                `Placed on the map in EPSG:${placed.epsg}. ${placed.notes.join(' ')} Undo puts it back on the plane.`,
              )
              setFitRevision((n) => n + 1)
            })
          }}
        />
      )}
      {terrainQuestion && (
        <TerrainImportDialog
          needs={terrainQuestion.needs}
          current={project.terrain}
          portalContainer={ref.current}
          onAnswer={(answers) => {
            setTerrainQuestion(null)
            terrainQuestion.resolve(answers)
          }}
          onCancel={() => {
            setTerrainQuestion(null)
            terrainQuestion.resolve(null)
          }}
        />
      )}
      <SessionRestoredNotice restored={w.sessionRestored} onDismiss={w.dismissSessionRestored} />
      <RoadRemovedNotice
        removed={removedHere}
        shownName={
          removedHere?.shownId === project.designPlaceholderId
            ? null
            : (project.alignments.find((road) => road.id === removedHere?.shownId)?.name ?? alignment.name)
        }
        onDismiss={() => setRemovedRoad(null)}
        onUndo={() => {
          if (removedHere) w.update((p) => parseProject(restoreRoad(p, removedHere)))
          setRemovedRoad(null)
        }}
      />
      <OpenSampleDialog
        sample={sampleRequest}
        projectName={project.name}
        portalContainer={ref.current}
        onCancel={() => setSampleRequest(null)}
        onOpen={() => {
          const kind = sampleRequest
          setSampleRequest(null)
          if (kind) loadTerrain(kind)
        }}
      />
      <ProjectFileConflictDialog
        conflict={fileConflict}
        portalContainer={ref.current}
        onCancel={() => setFileConflict(null)}
        onReplace={() => resolveFileConflict('replace')}
        onKeepBoth={() => resolveFileConflict('both')}
      />
      <ExampleStartNotice
        show={w.exampleStart && !busy && !layersOpen && !layerImportFiles}
        onDismiss={w.dismissExampleStart}
        onNewProject={openNewProject}
        onOpenFile={() => {
          w.dismissExampleStart()
          requestFile('project')
        }}
      />
      <RoadNotifications
        items={[
          ...(w.error
            ? [{ id: 'road-error', tone: 'error' as const, message: w.error, onDismiss: () => w.setError('') }]
            : []),
          ...(w.busy
            ? [
                {
                  id: `road-busy-${w.busyId}`,
                  tone: 'loading' as const,
                  message: w.busy,
                  title: w.busyCancel?.title,
                  progress: w.busyProgress ?? undefined,
                  action: w.busyCancel ? (
                    <Button
                      size="xs"
                      variant="outline"
                      className="shrink-0"
                      aria-label={w.busyCancel.label}
                      onClick={w.busyCancel.onCancel}
                    >
                      Cancel
                    </Button>
                  ) : undefined,
                },
              ]
            : []),
        ]}
      />
      {investigation && (
        <StatGroup
          variant="tiles"
          size="sm"
          className="shrink-0"
          items={[
            { key: 'opening', label: 'Opening', value: project.investigation?.openingId ?? 'Unknown' },
            {
              key: 'blocks',
              label: 'Mapped block parts',
              value: project.context.filter((feature) => feature.kind === 'harvest').length,
            },
            {
              key: 'records',
              label: 'Tenure road records',
              value: mappedRoadRecordCount(project),
            },
            { key: 'routes', label: 'Saved access assertions', value: project.accessHistory?.paths.length ?? 0 },
          ]}
        />
      )}
      <div className={toolbar?.dock === 'side' ? 'lp-guided-frame' : 'lp-canvas-frame'}>
        {toolbar?.dock === 'side' && (
          <div className={panelFrame?.resizeCorners ? 'lp-guide-window' : 'contents'}>
            {workspaceTools}
            {panelCorner('guide', 'road guide')}
          </div>
        )}
        <RibbonPaneColumns
          docked={taskPaneDocked}
          storageKey={roadPaneKey(layoutStorageId, `task-column:${active.id}`)}
          slotRef={setPaneHost}
        >
          <ResizableSplit
            direction="row"
            splitQuery="(min-width: 0px)"
            storageKey={investigation ? 'pgmaps-access-investigation:sidebar' : 'pgmaps-road-panes:sidebar'}
            className={`relative min-h-0 flex-1 ${focusMode ? 'road-focus-split' : ''}`}
            panes={[
              {
                id: 'sidebar',
                hidden: inlineWorkflow || !controlsShown,
                label: investigation ? 'access evidence' : 'road controls',
                size: investigation ? 0.34 : 0.22,
                min: investigation ? 340 : 240,
                max: 560,
                stackedHeight: 'auto' as const,
                className: focusMode
                  ? 'absolute inset-y-0 left-0 z-40 w-[min(22rem,100%)] bg-card shadow-xl'
                  : undefined,
                content: (
                  <div className={panelFrame?.resizeCorners && !inlineWorkflow ? 'lp-controls-window' : 'contents'}>
                    {investigation ? (
                      <div
                        className="h-full min-h-0 overflow-y-auto overscroll-none rounded-lg border bg-card p-3"
                        data-testid="access-investigation-sidebar"
                      >
                        <AccessHistoryPanel
                          workspace={w}
                          defaultOpen
                          onLocate={locateHistory}
                          selection={historySelection}
                          onInspectRecord={(kind, id) => inspectHistoryEvidence({ kind, id })}
                          onSelectBlock={(id) => inspectHistoryEvidence({ kind: 'block', id })}
                          onLoadAsRoad={loadMappedRoad}
                        />
                      </div>
                    ) : (
                      <>
                        {!inlineWorkflow && <div className="contents" ref={attachEditor} />}
                        {createPortal(
                          <RoadStationProvider station={station} read={readStation}>
                            <StationIndependentSidebar
                              embedded={inlineWorkflow}
                              // NaN, not the station: a sidebar part that read it here would go stale.
                              workspace={{ ...w, station: Number.NaN }}
                              workflowTab={workflowTab}
                              onWorkflowTabChange={showControls}
                              roadReviewRequest={roadReviewRequest}
                              onCompareCompleteCosts={openCompleteCosts}
                              onPlanNetwork={() => setNetworkOpen(true)}
                              readOnlyPreview={!!costPreview}
                              mode={mode}
                              onMode={(next) => {
                                beginMode(next)
                                if (inlineWorkflow) showPane('plan')
                                if (focusMode) setControlsOpen(false)
                              }}
                              drawing={
                                mode === 'road' || mode === 'extend'
                                  ? {
                                      kind: mode,
                                      points: draft.length,
                                      canFinish: draft.length >= minimumDraftPoints(mode),
                                      onFinish: finishDraw,
                                    }
                                  : null
                              }
                              onFile={requestFile}
                              onTerrain={requestTerrain}
                              verticalReference={verticalReference}
                              onVerticalReference={setVerticalReference}
                              pointCloud={pointCloud}
                              onPointCloud={setPointCloud}
                              breaklines={breaklines?.name ?? null}
                              onClearBreaklines={() => setBreaklines(null)}
                              selectedPoint={selectedPoint}
                              onPoint={setSelectedPoint}
                              onProfile={selectProfile}
                              commandStates={commandStates}
                              onCommand={runCommand}
                              onFindTerrain={(id) => openDetailArea({ source: 'lidarbc', areaId: `road:${id}` })}
                              onRemoveAlignment={deleteRoad}
                              onSuggest={suggest}
                              onLoadMappedRoad={loadMappedRoad}
                              onLoadMappedRoadsInView={loadMappedRoadsInView}
                              onCopyMappedRoad={copyMappedRoad}
                              onPreviewTerrainRoad={setTerrainRoadOverlay}
                              onPreviewTerrainRoads={setTerrainRoadsOverlay}
                              onLocateActiveRoad={() =>
                                locateHistory(alignment.points.map((point) => point.coordinate))
                              }
                              onLoadTerrainAroundRoad={() => loadTerrain('regional')}
                              onLocateRoad={locateRoad}
                              onOpenRoadHistory={openRoadReview}
                              onLocateConstraint={locateConstraint}
                              onLocateHistory={locateHistory}
                              historySelection={historySelection}
                              onInspectHistoryRecord={(kind, id) => inspectHistoryEvidence({ kind, id })}
                              onSelectHistoryBlock={(id) => inspectHistoryEvidence({ kind: 'block', id })}
                              focusedConstraintId={focusedConstraintId}
                              onImportSpatial={importSpatial}
                              onAskTerrain={askTerrain}
                              cutblockReviewRequest={cutblockReviewRequest}
                              onReviewRoad={reviewRoad}
                              onPreviewRoute={previewRoute}
                              onPreviewRoutes={setRouteLines}
                              onPickOnPlan={pickOnPlan}
                              onLoadFsrsNear={loadFsrsNear}
                              onPreviewAccessMarks={setAccessMarks}
                              onPreviewSkidReach={setSkidReachFeatures}
                              onDrawBlock={() => drawArea('harvest')}
                              onShowCompare={() => showDetailPane('compare')}
                              onShowDrainage={() => showDetailPane('drainage')}
                              onSelectRoad={selectAlignment}
                              onShowCulverts={showCulverts}
                              onShowSwept={() => showDetailPane('swept')}
                              vehicleFit={vehicleFitOnRoad}
                              engineeringRequest={engineeringRequest}
                              engineeringInputsRequest={engineeringInputsRequest}
                              onEngineeringInputs={showEngineeringInputs}
                              drainageStale={drainageStale}
                              templatePreviewActive={!!templatePreview}
                              onPreviewTemplate={(template, name) => {
                                setPegPreview(null)
                                setTemplatePreview({ template: structuredClone(template), name })
                                setActiveProfile(null)
                                setDetail('section')
                                setMode('inspect')
                                setDraft([])
                              }}
                              onCloseTemplatePreview={() => setTemplatePreview(null)}
                              onQuantities={() => showDetailPane('engineering')}
                            />
                          </RoadStationProvider>,
                          editorHost,
                        )}
                      </>
                    )}
                    {!inlineWorkflow &&
                      panelCorner('controls', investigation ? 'access evidence panel' : 'road controls panel')}
                  </div>
                ),
              },
              {
                id: 'main',
                label: 'connected views',
                size: 0.78,
                min: 480,
                stackedHeight: 'auto' as const,
                content: (
                  <MetricSummaryLayout
                    placement={summaryControls.preferences.placement}
                    small={smallSummary}
                    resize={
                      summaryAvailable &&
                      summaryControls.preferences.visible &&
                      summaryMetrics.some((metric) => summaryControls.preferences.metrics[metric.key] !== 'hidden')
                        ? {
                            storageKey: `pgmaps-road-summary:${active.id}:width`,
                            label: 'road summary',
                            controls: 'road-summary-measurements',
                          }
                        : undefined
                    }
                    summary={
                      summaryAvailable && (
                        <RoadSummary
                          metrics={summaryMetrics}
                          preferences={summaryControls.preferences}
                          small={smallSummary}
                          expanded={summaryOpen}
                          onExpand={() => setSummaryOpen((open) => !open)}
                          onSettings={showSummarySettings}
                        />
                      )
                    }
                  >
                    <main
                      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden"
                      aria-label={investigation ? 'Access investigation map' : 'Connected road views'}
                    >
                      {focusMode && !investigation && !shortPanePicker && (
                        <TabBar
                          label="Visible road pane"
                          value={focusedPane ?? 'plan'}
                          onChange={(value) => {
                            setFocusPane(value as RoadPaneId)
                            setControlsOpen(false)
                          }}
                          options={focusOptions}
                          stretch
                        />
                      )}
                      {!investigation && !awaitingFirstRoad(project) && !displayedAnalysis.stations.length && (
                        <InlineAlert tone="error">{displayedAnalysis.warnings.join(' ')}</InlineAlert>
                      )}
                      {!investigation && displayedAnalysis.stations.length > 0 && displayedAnalysis.invalidInput && (
                        <div data-testid="road-invalid-input">
                          <InlineAlert
                            tone="warning"
                            title="The charts, quantities and cost leave out an invalid input"
                          >
                            {invalidInputNotice(displayedAnalysis.invalidInput)} Correct it where it was typed; its
                            field shows the message.
                          </InlineAlert>
                        </div>
                      )}
                      {!investigation && routePreview && (
                        <div
                          role="status"
                          data-testid="road-live-route-preview"
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs"
                        >
                          <span>
                            {routePreview.error
                              ? `Live route preview: ${routePreview.error}`
                              : `Live route preview · ${number(routePreview.route?.lengthM)} m · search score $${number(routePreview.route?.cost, 0)} · dashed pink on plan. Use Suggest to save an alternative; profile and quantities show the active road.`}
                          </span>
                        </div>
                      )}
                      {!investigation && costPreview && (
                        <div
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-teal-600/40 bg-teal-600/10 px-3 py-2 text-xs"
                          data-testid="full-cost-map-preview"
                        >
                          <span>
                            <strong>Complete-cost candidate preview: {costPreview.alignment.name}.</strong> Teal: reused
                            access; gold: loaded supply haul; purple: empty return. Profile and sections show this exact
                            connector.
                          </span>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={openCompleteCosts}>
                              Return to comparison
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setCompleteCostPreview(null)}>
                              Close preview
                            </Button>
                          </div>
                        </div>
                      )}
                      {terrainProfile && (
                        <div className="flex items-center justify-between rounded-md border border-sky-600/40 bg-sky-600/10 px-3 py-1 text-xs">
                          <span>Terrain profile: {terrainProfile.name} · ground elevations and slopes only</span>
                          <Button size="sm" variant="outline" onClick={() => save('csv')}>
                            Profile CSV
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => save('report')}>
                            Profile report
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => selectProfile('')}>
                            Return to road
                          </Button>
                        </div>
                      )}
                      {!investigation && numericPegAlignment && !draftAlignment && !terrainProfile && (
                        <div
                          role="status"
                          className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs"
                        >
                          Numeric peg preview · plan, profile, section and leg table use the proposed endpoint. Add peg
                          to save it, or cancel the preview in the peg controls.
                        </div>
                      )}
                      {!investigation && templatePreview && (
                        <div className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-violet-600/40 bg-violet-600/10 px-3 py-1 text-xs">
                          <span>
                            Template preview: {templatePreview.name} · current terrain and station · assignments
                            temporarily omitted
                          </span>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (
                                  commitValidated({
                                    ...project,
                                    alignments: project.alignments.map((a) =>
                                      a.id === alignment.id ? { ...a, template: templatePreview.template } : a,
                                    ),
                                  })
                                )
                                  setTemplatePreview(null)
                              }}
                            >
                              Set as base section
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setTemplatePreview(null)}>
                              Close preview
                            </Button>
                          </div>
                        </div>
                      )}
                      <RoadPaneLayout
                        layout={layout}
                        focusedPane={focusMode ? focusedPane : undefined}
                        onFocusedPaneChange={setFocusPane}
                        windowControls={detachedControlsPlaced ? 'external' : 'inline'}
                        hidden={hiddenPanels}
                        storageId={layoutStorageId}
                        plan={
                          <FullscreenPanel
                            detachable
                            resizeHandle={panelCorner('plan', 'plan panel')}
                            title={investigation ? 'Mapped blocks and road records' : 'Plan · alignment & terrain'}
                            compact
                            className="flex min-h-0 flex-1 flex-col"
                            actions={investigation ? undefined : closePanel('plan')}
                          >
                            {() => (
                              <div className="min-h-0 flex-1" data-tutorial-id="road.plan">
                                <PlanView
                                  display={planDisplay}
                                  toolPanel={drawToolPanel}
                                  selectedRange={investigation || terrainProfile ? undefined : selectedRange}
                                  onMapReady={onPlanReady}
                                  selectedCulvertId={currentCulvertId}
                                  onHistorySelect={inspectHistoryEvidence}
                                  historySelection={historySelection}
                                  onSelectCulvert={selectCulvert}
                                  onContextSelect={(feature) => {
                                    if (investigation)
                                      inspectHistoryEvidence({
                                        kind: feature.kind === 'harvest' ? 'block' : 'road',
                                        id: feature.id,
                                      })
                                    else if (feature.kind === 'existing-road') openRoadReview(feature.id)
                                    else if (feature.kind === 'harvest') {
                                      setFocusedConstraintId(feature.id)
                                      setCutblockReviewRequest((previous) => ({
                                        id: feature.id,
                                        sequence: (previous?.sequence ?? 0) + 1,
                                      }))
                                      setWorkflowTab('terrain')
                                      setCollapsed(false)
                                      setControlsOpen(true)
                                    }
                                  }}
                                  project={displayProject}
                                  // Notes are their own collection; a note edit is an ordinary, undoable project edit.
                                  onNotesChange={busy ? undefined : (notes) => update((p) => ({ ...p, notes }))}
                                  focusedReferenceId={focusedReferenceId}
                                  hiddenReferenceLayers={hiddenLayerKeys}
                                  onReferenceVisibility={changeLayerVisibility}
                                  detailArea={detailBox}
                                  layersButton={
                                    <>
                                      <CommandButton
                                        id="detailedDem"
                                        surface="header"
                                        state={commandStates.detailedDem}
                                        onRun={commands.detailedDem}
                                      />
                                      <CommandButton
                                        id="importReference"
                                        surface="header"
                                        state={commandStates.importReference}
                                        presentation={{ expanded: layersOpen }}
                                        onRun={commands.importReference}
                                      />
                                    </>
                                  }
                                  onHighlightRoad={(road) =>
                                    investigation
                                      ? inspectHistoryEvidence({ kind: 'road', id: road.id })
                                      : reviewRoad(road, true)
                                  }
                                  alignment={displayedAlignment}
                                  analyses={displayAnalyses}
                                  costColours={planCostColours}
                                  source={source}
                                  station={station}
                                  selectedStation={at}
                                  onStation={selectStation}
                                  stationHover={!playing}
                                  onSelectAlignment={selectAlignment}
                                  onMode={investigation || busy || costPreview ? undefined : beginMode}
                                  mode={investigation || costPreview ? 'inspect' : mode}
                                  draft={draft}
                                  onDraw={onDraw}
                                  onFinishDraw={finishDraw}
                                  drawHover={mode === 'avoid' ? hover : null}
                                  snapLines={snapLines}
                                  onSnap={onSnap}
                                  onSketch={onSketch}
                                  onLoadMappedRoad={busy ? undefined : loadMappedRoad}
                                  onMovePoint={movePoint}
                                  onInsertPoint={(afterId, coordinate) => {
                                    if (busy || costPreview || alignment.points.length >= 2000) return
                                    const index = alignment.points.findIndex((point) => point.id === afterId)
                                    if (index < 0 || index === alignment.points.length - 1) return
                                    const point = { id: uid(), coordinate, radiusM: project.settings.minRadius }
                                    const bent = (road: Alignment) => ({
                                      ...road,
                                      points: [
                                        ...road.points.slice(0, index + 1),
                                        point,
                                        ...road.points.slice(index + 1),
                                      ],
                                    })
                                    if (refusedPlanEdit(bent(alignment))) return
                                    updateAlignment(bent)
                                    setSelectedPoint(point.id)
                                    setMode('edit')
                                    w.setNotice('Bend added. Drag its number to adjust it, or Undo to remove it.')
                                  }}
                                  onBendHint={() => w.setNotice('Drag the + off the road to bend it there.')}
                                  onPeg={pegOnPlan}
                                  onTypeStation={terrainProfile ? undefined : selectTypedStation}
                                  onHover={setHover}
                                  onSelectPoint={setSelectedPoint}
                                  selectedPoint={selectedPoint}
                                  fitRevision={fitRevision}
                                  terrainOnly={investigation || !!terrainProfile}
                                  activeCableId={detail === 'cable' ? cableLine?.id : undefined}
                                  onSelectCable={selectCable}
                                  cableDistance={cableDistance}
                                  onCableDistance={setCableDistance}
                                  overlay={investigation ? undefined : planOverlay}
                                  drainage={investigation ? undefined : drainageOnPlan}
                                  groundDrainage={
                                    !investigation && groundDrainageOpen ? groundDrainage.plan : undefined
                                  }
                                  cornerPanel={
                                    !investigation && groundDrainageOpen ? (
                                      <GroundDrainagePanel
                                        state={project.groundDrainage}
                                        onChange={changeGroundDrainage}
                                        blocks={project.context.flatMap((feature) =>
                                          feature.kind === 'harvest' && feature.geometry.type === 'Polygon'
                                            ? [{ id: feature.id, name: feature.name, geometry: feature.geometry }]
                                            : [],
                                        )}
                                        drawing={mode === 'avoid' && polygonKind === 'drainage'}
                                        onDraw={() =>
                                          mode === 'avoid' && polygonKind === 'drainage'
                                            ? beginMode('inspect')
                                            : drawArea('drainage')
                                        }
                                        onImport={importGroundDrainageArea}
                                        importChoices={groundImportChoices}
                                        onChooseImport={(choice) => {
                                          if (!choice || !groundImportChoices) return setGroundImportChoices(null)
                                          const { fileName, choices } = groundImportChoices
                                          setGroundDrainageArea(
                                            choice === 'all'
                                              ? {
                                                  source: 'imported',
                                                  name: `${fileName} (${choices.length} polygons)`,
                                                  fileName,
                                                  geometry: {
                                                    type: 'MultiPolygon',
                                                    coordinates: choices.flatMap((c) =>
                                                      c.geometry.type === 'Polygon'
                                                        ? [c.geometry.coordinates]
                                                        : c.geometry.coordinates,
                                                    ),
                                                  },
                                                }
                                              : {
                                                  source: 'imported',
                                                  name: choice.name,
                                                  fileName,
                                                  geometry: choice.geometry,
                                                },
                                          )
                                        }}
                                        picking={!!planPick}
                                        onPickOutlet={() =>
                                          planPick
                                            ? pickOnPlan(null)
                                            : pickOnPlan('Click the plan where the drainage outlet is.', (coordinate) =>
                                                update((p) => ({
                                                  ...p,
                                                  groundDrainage: {
                                                    ...p.groundDrainage,
                                                    settings:
                                                      p.groundDrainage?.settings ?? DEFAULT_GROUND_DRAINAGE_SETTINGS,
                                                    outlet: coordinate,
                                                  },
                                                })),
                                              )
                                        }
                                        drainage={groundDrainage}
                                        sourceM={terrainGridCellM(project.terrain)}
                                        onClose={() => setGroundDrainageOpen(false)}
                                      />
                                    ) : undefined
                                  }
                                  swept={!investigation && showSwept ? sweptOnPlan : undefined}
                                  sightlines={investigation ? undefined : planSightlines}
                                  // The drainage pour point and the sidebar's plan picks share the plan's one-click pick.
                                  pourPointPicking={!!drainagePicking || !!planPick}
                                  onPourPoint={
                                    drainagePicking
                                      ? (coordinate) => {
                                          changePourPoint({ ...drainagePicking, coordinate })
                                          setDetail('drainage')
                                          if (focusMode) setFocusPane('detail')
                                        }
                                      : planPick
                                        ? (coordinate) => {
                                            setPlanPick(null)
                                            planPick.onPick(coordinate)
                                          }
                                        : undefined
                                  }
                                  onOverlaySelect={(properties) => {
                                    if (properties?.spokeId) setSelectedSpokeId(String(properties.spokeId))
                                    // A failed route search's mark selects the row that explains it.
                                    if (properties?.routeLineId)
                                      routeLines?.find((line) => line.id === properties.routeLineId)?.onSelect?.()
                                    if (properties?.kind === 'dline-support' && properties.cableId) {
                                      selectCable(String(properties.cableId))
                                      setCableDistance(Number(properties.chartDistance) || 0)
                                    }
                                  }}
                                />
                              </div>
                            )}
                          </FullscreenPanel>
                        }
                        profile={
                          <ChartHeader storageKey="pgmaps-road-chart-view:profile">
                            {(chartSlot) => (
                              <FullscreenPanel
                                detachable
                                resizeHandle={panelCorner('profile', 'profile panel')}
                                // The picker names the view, so it stands in the title's place; the title
                                // stays the pane's accessible name and window title.
                                heading={
                                  <RoadSelect
                                    className="min-w-0 h-8 w-36"
                                    value={profileView}
                                    onValueChange={(value) => setProfileView(value as ProfileView)}
                                    options={roadProfileViews.map((view) => ({
                                      value: view.value,
                                      label: view.label,
                                    }))}
                                    ariaLabel="Road profile view"
                                  />
                                }
                                actions={
                                  <>
                                    {!terrainProfile && profileView !== 'grade' && (
                                      <ProfileSwitcher workspace={w} disabled={!!busy} />
                                    )}
                                    {chartSlot}
                                    {closePanel('profile')}
                                  </>
                                }
                                title={(() => {
                                  const view = roadProfileViews.find((item) => item.value === profileView)!
                                  return terrainProfile ? view.terrainTitle : view.title
                                })()}
                                compact
                                className="flex min-h-0 flex-1 flex-col"
                              >
                                {() => (
                                  <div className="flex min-h-0 flex-1 flex-col" data-tutorial-id="road.profile">
                                    {profileView !== 'grade' && (
                                      <div
                                        className={
                                          profileView === 'profile-grade' ||
                                          (profileView === 'profile-mass' && !terrainProfile)
                                            ? 'min-h-0 flex-[3]'
                                            : 'min-h-0 flex-1'
                                        }
                                      >
                                        <ProfileChart
                                          sharedXAxis={profileView === 'profile-grade'}
                                          sharedMeasurement={
                                            profileView === 'profile-grade' ? profileGradeMeasurement : undefined
                                          }
                                          selectedRange={terrainProfile ? undefined : selectedRange}
                                          onViewRangeChange={onProfileRange}
                                          selectedCulvertId={currentCulvertId}
                                          onSelectCulvert={selectCulvert}
                                          terrainOnly={!!terrainProfile}
                                          sight={sightBand}
                                          gradeLimits={profileGradeLimits}
                                          analysis={profileAnalysis}
                                          alignment={displayedAlignment}
                                          station={station}
                                          selectedStation={terrainProfile ? undefined : at}
                                          onStation={selectStation}
                                          rangePick={terrainProfile ? undefined : sectionTools.rangePick}
                                          onVerticalChange={
                                            busy ||
                                            terrainProfile ||
                                            draftAlignment ||
                                            numericPegAlignment ||
                                            templatePreview ||
                                            costPreview
                                              ? undefined
                                              : (vertical) => w.updateAlignment((a) => ({ ...a, vertical }))
                                          }
                                          onEditGesture={w.editGesture}
                                          junctions={profileJunctions}
                                          onAddControl={(control) =>
                                            w.updateAlignment((a) => {
                                              const verticalControls = withVerticalControl(a.verticalControls, control)
                                              return verticalControls ? { ...a, verticalControls } : a
                                            })
                                          }
                                        />
                                      </div>
                                    )}
                                    {profileView === 'profile-mass' && !terrainProfile && (
                                      // The mass haul under the profile follows the profile's zoom, as RoadEng's
                                      // profile and mass-haul windows do.
                                      <div className="min-h-32 flex-[2] border-t" data-testid="road-profile-mass-strip">
                                        <MassHaulChart
                                          selectedRange={selectedRange}
                                          viewRange={sharedProfileRange}
                                          analysis={displayedAnalysis}
                                          engineeringInputs={displayedAlignment.engineering}
                                          station={station}
                                          onStation={selectStation}
                                        />
                                      </div>
                                    )}
                                    {(profileView === 'profile-grade' || profileView === 'grade') && (
                                      // Under the profile the strip takes the profile's zoom and station; its
                                      // readouts are the profile's own.
                                      <div
                                        className={
                                          profileView === 'profile-grade' ? 'min-h-24 flex-[2]' : 'min-h-0 flex-1'
                                        }
                                        data-testid={
                                          profileView === 'profile-grade' ? 'road-profile-grade-strip' : undefined
                                        }
                                      >
                                        <GradeChart
                                          strip={profileView === 'profile-grade'}
                                          sharedMeasurement={
                                            profileView === 'profile-grade' ? profileGradeMeasurement : undefined
                                          }
                                          selectedRange={terrainProfile ? undefined : selectedRange}
                                          viewRange={sharedProfileRange}
                                          analysis={profileAnalysis}
                                          alignment={displayedAlignment}
                                          rule={profileGradeLimits.rule}
                                          terrainOnly={!!terrainProfile}
                                          station={station}
                                          onStation={selectStation}
                                          average={gradeAverage}
                                          onAverageChange={setGradeAverage}
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </FullscreenPanel>
                            )}
                          </ChartHeader>
                        }
                        detail={
                          <ChartHeader storageKey="pgmaps-road-chart-view:detail" handleRef={detailChart}>
                            {(chartSlot) => (
                              <FullscreenPanel
                                detachable
                                resizeHandle={panelCorner('detail', 'detail panel')}
                                title={detailTitle(detail)}
                                // The picker's value names the view, so it stands in the title's place;
                                // the title stays the pane's accessible name and window title.
                                heading={
                                  <RoadSelect
                                    className="min-w-0 h-8 w-36"
                                    value={detail}
                                    onValueChange={(value) => {
                                      setDetail(value as typeof detail)
                                      // The same operation as the view's registry command, for a lesson.
                                      const view = roadDetailViews.find((item) => item.value === value)
                                      if (view)
                                        roadTourActions.observe(ROAD_TOUR_ACTIONS.command, { command: view.command })
                                    }}
                                    options={roadDetailViews.map((view) => ({
                                      value: view.value,
                                      label: view.label,
                                      disabled: 'roadOnly' in view && !!terrainProfile,
                                    }))}
                                    ariaLabel="Road detail view"
                                    tutorialId="road.detail.view"
                                  />
                                }
                                actions={
                                  <>
                                    {detail === 'mass' && (
                                      <InfoTip label="About mass haul">
                                        Mass haul is the running total of usable cut minus fill, from the road&apos;s
                                        start. The line rises through cut and falls through fill. Where it comes back to
                                        zero the earthwork balances up to that station; where it ends is the surplus
                                        (above zero) or the shortfall (below) for the whole road.
                                      </InfoTip>
                                    )}
                                    {detail === 'section' && !terrainProfile && (
                                      <Button
                                        size="field"
                                        variant="outline"
                                        className="shrink-0 px-2 [@container(min-width:34rem)]:px-3"
                                        aria-label="Section CSV"
                                        title="Download section CSV"
                                        disabled={!at || !!busy}
                                        onClick={saveSection}
                                      >
                                        {/* A narrow panel keeps room for the view picker beside the chart controls:
                                            the panel is the container, so this follows the pane, not the window. */}
                                        <Download
                                          className="size-3.5 [@container(min-width:34rem)]:hidden"
                                          aria-hidden
                                        />
                                        <span className="sr-only [@container(min-width:34rem)]:not-sr-only">
                                          Section CSV
                                        </span>
                                      </Button>
                                    )}
                                    {chartSlot}
                                    {closePanel('detail')}
                                  </>
                                }
                                compact
                                // An inline-size container, so header controls can fold by the panel's width.
                                className="flex min-h-0 flex-1 flex-col [container-type:inline-size]"
                              >
                                {() => (
                                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                                    {/* The section keeps 7 rem under the section tools, which scroll past it. */}
                                    <div
                                      className={`${detail === 'section' && !tinyHeight ? 'min-h-28' : 'min-h-0'} flex-1`}
                                    >
                                      {detail === 'section' && (
                                        <CrossSectionChart
                                          grid={terrainProfile ? undefined : sectionGrid}
                                          holdScale={sectionTools.holdScale}
                                          roadScale={sectionTools.roadScale}
                                          showSideSlopes={sectionTools.sideSlopes}
                                          pinnedStation={sectionTools.pinnedStation}
                                          selectedCulvertId={currentCulvertId}
                                          onSelectCulvert={selectCulvert}
                                          alignment={displayedAlignment}
                                          analysis={displayedAnalysis}
                                          terrainOnly={!!terrainProfile}
                                          station={
                                            terrainProfile && at
                                              ? {
                                                  ...at,
                                                  section: at.section.map((s) => ({ ...s, design: null })),
                                                  cutAreaM2: null,
                                                  fillAreaM2: null,
                                                  leftDaylightM: null,
                                                  rightDaylightM: null,
                                                }
                                              : at
                                          }
                                          onShift={
                                            busy ||
                                            terrainProfile ||
                                            draftAlignment ||
                                            numericPegAlignment ||
                                            templatePreview ||
                                            costPreview
                                              ? undefined
                                              : shiftSection
                                          }
                                          onVerticalShift={
                                            busy ||
                                            terrainProfile ||
                                            draftAlignment ||
                                            numericPegAlignment ||
                                            templatePreview ||
                                            costPreview
                                              ? undefined
                                              : shiftFormation
                                          }
                                        />
                                      )}
                                      {detail === 'terrain' && (
                                        <TerrainPreview
                                          selectedRange={terrainProfile ? undefined : selectedRange}
                                          selectedCulvertId={currentCulvertId}
                                          onSelectCulvert={selectCulvert}
                                          culvertDesigns={displayedAlignment.engineering?.culverts}
                                          terrainOnly={!!terrainProfile}
                                          sourceLabel={project.terrain.name}
                                          analysis={displayedAnalysis}
                                          terrain={source}
                                          station={station}
                                          onStation={selectStation}
                                          playing={playing}
                                          maxGradePercent={project.settings.maxGradePercent}
                                        />
                                      )}
                                      {detail === 'mass' && !terrainProfile && (
                                        <MassHaulChart
                                          selectedRange={selectedRange}
                                          viewRange={sharedProfileRange}
                                          analysis={displayedAnalysis}
                                          engineeringInputs={displayedAlignment.engineering}
                                          station={station}
                                          onStation={selectStation}
                                        />
                                      )}
                                      {detail === 'grade' && (
                                        <GradeChart
                                          selectedRange={terrainProfile ? undefined : selectedRange}
                                          viewRange={sharedProfileRange}
                                          analysis={displayedAnalysis}
                                          alignment={displayedAlignment}
                                          rule={profileGradeLimits.rule}
                                          terrainOnly={!!terrainProfile}
                                          station={station}
                                          onStation={selectStation}
                                          average={gradeAverage}
                                          onAverageChange={setGradeAverage}
                                        />
                                      )}
                                      {detail === 'table' && designSchedules}
                                      {detail === 'pegs' && !terrainProfile && (
                                        <PeggingEditor
                                          alignment={costPreview?.alignment ?? draftAlignment ?? alignment}
                                          analysis={displayedAnalysis}
                                          source={source}
                                          disabled={!!busy || mode === 'road' || !!templatePreview || !!costPreview}
                                          onStation={selectStation}
                                          onPoint={setSelectedPoint}
                                          onPreview={setOverlay}
                                          onPreviewAlignment={previewPeg}
                                          onChange={(next) =>
                                            commitValidated({
                                              ...project,
                                              alignments: project.alignments.map((a) => (a.id === next.id ? next : a)),
                                            })
                                          }
                                        />
                                      )}
                                      {detail === 'engineering' && !terrainProfile && (
                                        <EngineeringSummary
                                          alignment={displayedAlignment}
                                          equipment={project.standards?.equipment}
                                          onEquipmentChange={
                                            busy
                                              ? undefined
                                              : (equipment) =>
                                                  commitValidated({
                                                    ...project,
                                                    standards: (({ equipment: _old, ...rest }) => {
                                                      void _old
                                                      return equipment.length ? { ...rest, equipment } : rest
                                                    })(project.standards ?? DEFAULT_DESIGN_STANDARDS),
                                                  })
                                          }
                                          selectedCulvertId={currentCulvertId}
                                          onSelectCulvert={selectCulvert}
                                          analysis={displayedAnalysis}
                                          settings={project.settings}
                                          station={station}
                                          onStation={selectStation}
                                          onExport={() => {
                                            try {
                                              parseProject(project)
                                              if (
                                                draftAlignment ||
                                                numericPegAlignment ||
                                                templatePreview ||
                                                costPreview
                                              )
                                                throw Error(
                                                  'Finish or close the design preview before exporting calculated results.',
                                                )
                                              downloadText(
                                                engineeringCsv(displayedAnalysis, project.terrain),
                                                'road-engineering-quantities.csv',
                                                'text/csv;charset=utf-8',
                                              )
                                            } catch (error) {
                                              w.setError(
                                                error instanceof Error ? error.message : 'Could not export quantities.',
                                              )
                                            }
                                          }}
                                        />
                                      )}
                                      {detail === 'landing' && (
                                        <RadialDeflectionPanel
                                          source={source}
                                          center={at?.coordinate ?? null}
                                          centerLabel={formatRoadStation(at?.chainage ?? 0)}
                                          sourceLabel={project.terrain.name}
                                          onPreview={setOverlay}
                                          selectedSpokeId={selectedSpokeId}
                                          onSelectSpoke={setSelectedSpokeId}
                                          onAdopt={(line) => {
                                            if (commitValidated({ ...project, cables: [...project.cables, line] })) {
                                              selectCable(line.id)
                                              w.setNotice(
                                                'Selected landing spoke saved as an editable D-line. Its map and profile now share the same span cursor.',
                                              )
                                            }
                                          }}
                                        />
                                      )}
                                      {detail === 'drainage' && !terrainProfile && (
                                        <DrainagePanel
                                          run={drainageEntry?.run ?? null}
                                          onShowCulverts={showCulverts}
                                          stale={drainageStale}
                                          settings={drainageSettings}
                                          onSettings={changeDrainageSettings}
                                          onRun={checkDrainage}
                                          busy={!!busy}
                                          pourPoint={project.drainage?.pourPoint}
                                          onPourPointChange={changePourPoint}
                                          pourPointPicking={!!drainagePicking}
                                          onPickPourPoint={(options) => {
                                            setDrainagePicking((current) => (current ? null : options))
                                            setMode('inspect')
                                            setDraft([])
                                            if (!drainagePicking && focusMode) {
                                              setFocusPane('plan')
                                              setControlsOpen(false)
                                            }
                                            w.setNotice(
                                              drainagePicking
                                                ? 'Drainage point selection cancelled.'
                                                : 'Tap the plan to choose the drainage pour point.',
                                            )
                                          }}
                                          watershedMinAreaHa={project.drainage?.watershedMinAreaHa}
                                          onWatershedMinAreaChange={(watershedMinAreaHa) =>
                                            update((p) => ({
                                              ...p,
                                              drainage: {
                                                ...p.drainage,
                                                settings: drainageSettings,
                                                records: p.drainage?.records ?? [],
                                                watershedMinAreaHa,
                                              },
                                            }))
                                          }
                                          evidence={drainageEvidence}
                                          onExport={exportDrainage}
                                          comparisons={(project.drainage?.comparisons ?? []).filter(
                                            (record) => record.alignmentId === alignment.id,
                                          )}
                                          totalComparisonRecords={
                                            (project.drainage?.comparisons ?? []).filter((r) =>
                                              project.alignments.some((a) => a.id === r.alignmentId),
                                            ).length
                                          }
                                          onSaveComparison={saveDrainageComparison}
                                          onRemoveComparison={(id) =>
                                            update((p) => ({
                                              ...p,
                                              drainage: {
                                                ...p.drainage!,
                                                comparisons: (p.drainage?.comparisons ?? []).filter(
                                                  (record) => drainageComparisonId(record) !== id,
                                                ),
                                              },
                                            }))
                                          }
                                          onExportComparisons={exportDrainageComparisons}
                                          onStation={(chainage) => {
                                            selectStation(chainage)
                                            if (focusMode) setFocusPane('plan')
                                          }}
                                        />
                                      )}
                                      {detail === 'swept' && !terrainProfile && (
                                        <div className="h-full overflow-auto overscroll-none">
                                          <SweptPathPanel
                                            check={displayedAlignment.vehicleCheck}
                                            result={sweptState.result}
                                            error={sweptState.error}
                                            onChange={swept.onChange}
                                            onStation={selectStation}
                                            showOnPlan={showSwept}
                                            onShowOnPlan={setShowSwept}
                                            onFocus={swept.onFocus}
                                            alignment={displayedAlignment}
                                            junctions={swept.junctions}
                                            tools={swept.tools}
                                          />
                                        </div>
                                      )}
                                      {detail === 'compare' && (
                                        <CompareAlternatives
                                          alignments={project.alignments}
                                          analyses={w.analyses}
                                          activeId={alignment.id}
                                          onSelect={selectAlignment}
                                          project={project}
                                          terrain={source}
                                          onAlignmentChange={(next) => updateAlignment(() => next)}
                                          onCompareCompleteCosts={openCompleteCosts}
                                        />
                                      )}
                                      {detail === 'cable' &&
                                        (cableResult.error ? (
                                          <InlineAlert tone="error">{cableResult.error}</InlineAlert>
                                        ) : cableAnalysis ? (
                                          <div className="flex h-full min-h-0 flex-col">
                                            <RoadSelect
                                              ariaLabel="Active D-line"
                                              className="mb-1 rounded-md border bg-background text-xs"
                                              value={cableLine.id}
                                              onValueChange={(value) => selectCable(value)}
                                            >
                                              {project.cables.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                  {c.name}
                                                </option>
                                              ))}
                                            </RoadSelect>
                                            {cableResult.summary && (
                                              <details
                                                className={cn(insetBox({ padding: 'none' }), 'mb-1 px-2 py-1 text-2xs')}
                                                data-testid="road-cable-summary"
                                              >
                                                <summary className="cursor-pointer">
                                                  Horizontal span {number(cableResult.summary.horizontalSpanM)} m ·{' '}
                                                  {cableAnalysis.mechanics?.span
                                                    ? 'rope and load'
                                                    : `assumed sag ${number(cableResult.summary.assumedSagM)} m`}
                                                </summary>
                                                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                                                  <span>
                                                    Support Δ elevation{' '}
                                                    {number(cableResult.summary.supportElevationDifferenceM)} m
                                                  </span>
                                                  <span>
                                                    Straight chord {number(cableResult.summary.straightSupportChordM)} m
                                                  </span>
                                                  <span>
                                                    Sampled cable geometry{' '}
                                                    {number(cableResult.summary.sampledGeometricCableLengthM)} m
                                                  </span>
                                                  <span>
                                                    Known ground {number(cableResult.summary.knownGroundPercent)}%
                                                  </span>
                                                </div>
                                                <p className="mt-1 text-muted-foreground">
                                                  {cableAnalysis.mechanics?.span
                                                    ? 'These geometric lengths use the assumed sag %. The profile below solves the rope and load for tension and the loaded carriage path; equipment and anchors are not checked.'
                                                    : 'Geometric lengths describe the entered sag model; equipment, tension and operating loads are not calculated.'}
                                                </p>
                                              </details>
                                            )}
                                            <div className="mb-1 flex gap-1">
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => saveCableProfile('csv')}
                                              >
                                                D-line CSV
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => saveCableProfile('report')}
                                              >
                                                D-line report
                                              </Button>
                                              {(cableLine.supportLayout?.saved || cableLine.supportLayout?.edited) && (
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={() => saveCableProfile('stakeout')}
                                                >
                                                  Stake-out CSV
                                                </Button>
                                              )}
                                            </div>
                                            <div className="min-h-0 flex-1">
                                              <CableChart
                                                analysis={cableAnalysis}
                                                distance={cableDistance}
                                                onDistance={setCableDistance}
                                                layout={cableLayoutOverlay}
                                                edit={cableLayoutEdit}
                                              />
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="p-4 text-sm text-muted-foreground">
                                            Draw a D-line in Review to inspect an assumed cable-clearance profile.
                                          </div>
                                        ))}
                                    </div>
                                    {detail === 'section' && (
                                      <SectionPaneTools
                                        tools={sectionTools}
                                        station={at}
                                        terrainOnly={!!terrainProfile}
                                        editable={
                                          !busy &&
                                          !terrainProfile &&
                                          !draftAlignment &&
                                          !numericPegAlignment &&
                                          !templatePreview &&
                                          !costPreview
                                        }
                                        updateAlignment={w.updateAlignment}
                                        onStation={selectStation}
                                        onNotice={w.setNotice}
                                      />
                                    )}
                                  </div>
                                )}
                              </FullscreenPanel>
                            )}
                          </ChartHeader>
                        }
                        data={
                          !['engineering', 'pegging'].includes(layout) ? null : (
                            <FullscreenPanel
                              detachable
                              resizeHandle={panelCorner('data', 'data panel')}
                              title={
                                layout === 'pegging'
                                  ? 'Pegging data · editable legs'
                                  : 'Station data · connected selection'
                              }
                              actions={closePanel('data')}
                              compact
                              className="flex min-h-0 flex-1 flex-col"
                            >
                              {() => (
                                <div className="min-h-0 flex-1">
                                  {layout === 'pegging' && !terrainProfile ? (
                                    <PeggingEditor
                                      alignment={costPreview?.alignment ?? draftAlignment ?? alignment}
                                      analysis={displayedAnalysis}
                                      source={source}
                                      disabled={!!busy || mode === 'road' || !!templatePreview || !!costPreview}
                                      onStation={selectStation}
                                      onPoint={setSelectedPoint}
                                      onPreview={setOverlay}
                                      onPreviewAlignment={previewPeg}
                                      onChange={(next) =>
                                        commitValidated({
                                          ...project,
                                          alignments: project.alignments.map((a) => (a.id === next.id ? next : a)),
                                        })
                                      }
                                    />
                                  ) : (
                                    designSchedules
                                  )}
                                </div>
                              )}
                            </FullscreenPanel>
                          )
                        }
                      />
                      {!investigation && !(shortPanePicker && isDrawing && focusedPane === 'plan') && (
                        <div
                          className="road-station-controller flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-card-foreground sm:gap-2"
                          data-testid="road-station-controller"
                        >
                          {focusMode && shortPanePicker && (
                            <RoadSelect
                              ariaLabel="Visible road pane"
                              title="Switch the visible road pane"
                              className="w-20"
                              value={focusedPane ?? 'plan'}
                              onValueChange={(value) => showPane(value as RoadPaneId)}
                              options={focusOptions}
                            />
                          )}
                          <Button
                            size="icon-xs"
                            variant="outline"
                            className="road-station-icon max-md:hidden"
                            aria-label={playing ? 'Pause station playback' : 'Play station playback'}
                            onClick={toggleStationPlayback}
                          >
                            {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
                          </Button>
                          <StationBox
                            selected={w.station}
                            shown={station}
                            length={displayedAnalysis.length}
                            stationing={shownStationing}
                            onType={selectTypedStation}
                            onCommit={() => {
                              setTypedStation((typed) => (typed ? { ...typed, committed: true } : typed))
                              roadTourActions.observe(ROAD_TOUR_ACTIONS.station, {
                                chainage: Math.round(w.station * 10) / 10,
                              })
                            }}
                            onStep={(direction) =>
                              selectStation(
                                direction > 0
                                  ? (displayedAnalysis.stations.find((s) => s.chainage > station + 0.001)?.chainage ??
                                      displayedAnalysis.length)
                                  : ([...displayedAnalysis.stations].reverse().find((s) => s.chainage < station - 0.001)
                                      ?.chainage ?? 0),
                              )
                            }
                          />
                          <StationJumpMenu
                            project={project}
                            alignment={displayedAlignment}
                            analysis={displayedAnalysis}
                            station={w.station}
                            onJump={(target) =>
                              target.culvertId ? selectCulvert(target.culvertId) : selectStation(target.chainage)
                            }
                            onNotice={w.setNotice}
                            mobileTools={
                              mobileWorkspace
                                ? {
                                    playing,
                                    onPlayback: toggleStationPlayback,
                                    readout: `${stationReadout.station} · Z ${stationReadout.elevation} m · ${stationReadout.grade}%`,
                                  }
                                : undefined
                            }
                          />
                          {/* A selected feature reads beside the station it spans, in the plan's selection colour,
                              rather than as a full-width row above the panes. */}
                          {selectedRange && !terrainProfile && (
                            <div
                              role="status"
                              data-testid="road-feature-selection"
                              className="flex min-w-0 max-w-[24rem] shrink items-center gap-1 rounded-full border border-rose-500/50 bg-rose-500/10 py-0.5 pl-2 pr-0.5 text-xs"
                            >
                              <span className="size-2 shrink-0 rounded-full bg-rose-500" aria-hidden="true" />
                              <button
                                type="button"
                                className="min-w-0 truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                title={`Go to the start of ${selectedRange.label}`}
                                onClick={() => selectStation(selectedRange.start)}
                              >
                                <span className="font-medium">{selectedRange.label}</span>
                                <span className="tabular-nums text-muted-foreground">
                                  {' · '}
                                  {formatRoadStation(selectedRange.start)}
                                  {selectedRange.end !== selectedRange.start
                                    ? `–${formatRoadStation(selectedRange.end)}`
                                    : ''}
                                </span>
                              </button>
                              <Button
                                size="icon-2xs"
                                variant="ghost"
                                className="shrink-0 rounded-full"
                                aria-label="Clear selection"
                                title="Clear selection"
                                onClick={() => w.setFeatureSelection(null)}
                              >
                                <X className="size-3" />
                              </Button>
                            </div>
                          )}
                          <input
                            aria-label="Linked road station"
                            type="range"
                            min={0}
                            max={Math.max(1, displayedAnalysis.length)}
                            step={1}
                            value={station}
                            className="min-w-16 flex-1 accent-primary focus-visible:outline-ring sm:min-w-24"
                            onChange={(e) => selectStation(Number(e.target.value))}
                          />
                          {typedNote && (
                            <span role="status" className="text-xs text-warning" data-testid="road-station-limited">
                              {typedNote}
                            </span>
                          )}
                          {/* Reserve the readout's width, including grouping commas and a minus sign, so changing digits cannot resize the slider. */}
                          <output
                            className="w-[34ch] shrink-0 text-left font-mono text-xs tabular-nums"
                            data-testid="road-selected-station"
                          >
                            {at && at.groundElevation === null && designOnlyGround !== null ? (
                              // A design without terrain is a mode: its ground, if the file gave any, is shown plainly.
                              <span
                                className="block text-left font-sans text-muted-foreground"
                                data-testid="road-station-design-only"
                              >
                                {designOnlyGround === 'none'
                                  ? `Design only at ${formatRoadStation(station)}: no terrain under this road.`
                                  : `${formatRoadStation(station)} · ground ${designOnlyGround.toFixed(2)} m, from the design file`}
                              </span>
                            ) : at && (at.groundElevation === null || at.section.some((p) => p.ground === null)) ? (
                              <span
                                className="block text-left font-sans text-warning"
                                data-testid="road-station-terrain-gap"
                                title="The selected terrain has missing data here. Hatched chart areas and holes in the 3D ground show those gaps."
                              >
                                {at.groundElevation === null
                                  ? 'No ground elevation'
                                  : 'Terrain gaps in the cross-section'}{' '}
                                at {formatRoadStation(station)}. Import a DEM with coverage here in Terrain.
                              </span>
                            ) : (
                              <span className="grid grid-cols-[9ch_15ch_10ch] whitespace-nowrap">
                                <span className="truncate" data-station-reading="station" title="Station">
                                  {stationReadout.station}
                                </span>
                                <span
                                  className="truncate border-l border-border pl-2"
                                  data-station-reading="elevation"
                                  title="Ground elevation"
                                >
                                  Z {stationReadout.elevation} m
                                </span>
                                <span
                                  className="truncate border-l border-border pl-2"
                                  data-station-reading="grade"
                                  title="Grade"
                                >
                                  {stationReadout.grade}%
                                </span>
                              </span>
                            )}
                          </output>
                        </div>
                      )}
                    </main>
                  </MetricSummaryLayout>
                ),
              },
            ]}
          />
        </RibbonPaneColumns>
      </div>
      {!investigation && (
        <ReferencePanel
          key={w.openedCount}
          open={layersOpen}
          onClose={() => setLayersOpen(false)}
          workspace={w}
          mode={mode}
          disabled={!w.ready || !!busy || !!costPreview}
          onFiles={importReferenceFiles}
          onReadError={(error) => w.setError(error instanceof Error ? error.message : 'Could not read the folder.')}
          onLocate={locateReference}
          focusedId={focusedReferenceId}
          hiddenKeys={hiddenLayerKeys}
          onVisibilityChange={changeLayerVisibility}
          onCopyRoad={copyLayerRoad}
          onShowRoad={(road) => {
            if (road.id !== project.activeAlignmentId) selectAlignment(road.id)
            if (!dockLayers) setLayersOpen(false)
            showOnPlan(
              w.analyses.get(road.id)?.centerline?.length
                ? w.analyses.get(road.id)!.centerline
                : road.points.map(({ coordinate }) => coordinate),
            )
          }}
          onRemoveLayer={(key, name) => setLayerToDelete({ key, name })}
          onBufferChange={changeCutblockBuffer}
          onLayerStyleChange={changeReferenceStyle}
          onFitBuffer={(setting) => {
            changeLayerVisibility([setting.layer, cutblockBufferKey(setting.layer)], true)
            if (!dockLayers) setLayersOpen(false)
            showOnPlan(layerFitPoints(cutblockBufferFeatures(setting, project.context, project.reference ?? [])))
          }}
          onPegAt={(at, name) => {
            if (!dockLayers) setLayersOpen(false)
            pegAt(at, name)
          }}
          onRoadEndAt={moveRoadEnd}
          baseLayers={[
            {
              key: 'hrdem-relief',
              name: HRDEM_RELIEF_NAME,
              description: HRDEM_RELIEF_DESCRIPTION,
              visible: planDisplay.showHrdem,
              unavailable:
                project.terrain.epsg === LOCAL_PLANE_EPSG
                  ? 'A project on the flat plane has no place on the map yet.'
                  : planDisplay.terrainLayer === 'none'
                    ? 'Terrain display is set to Basemap.'
                    : undefined,
              onVisibleChange: planDisplay.setShowHrdem,
            },
          ]}
        />
      )}
      {summaryAvailable && summaryTarget !== null && (
        <RoadSummarySettings
          metrics={summaryMetrics}
          controls={summaryControls}
          selected={summaryTarget}
          onReveal={() => setSummaryOpen(true)}
          onClose={() => setSummaryTarget(null)}
        />
      )}
    </div>
  )
  return (
    <PanelWindowProvider>
      <PanelWindowLayoutRestore
        layout={savedLayouts.find((item) => `saved:${item.id}` === layoutSelection)?.windows ?? active.panelWindows}
        layoutKey={`road:${layoutSelection}`}
      />
      <RibbonPaneHost.Provider
        value={{
          slot: paneHost,
          docked: taskPaneDocked,
          resizeKey: panelFrame?.resizeCorners ? cornerKey('settings') : undefined,
          onDockChange: setTaskPaneDocked,
        }}
      >
        {/* Only a running lesson listens to which sections are open (`section-open-reporter.ts`). */}
        <SectionOpenReporterContext.Provider value={tourLaunch ? reportSection : null}>
          {workspace}
        </SectionOpenReporterContext.Provider>
      </RibbonPaneHost.Provider>
    </PanelWindowProvider>
  )
}
