import { RoadSelect } from './dev-forestry-roads/Controls'
import { AccessHistoryPanel } from './dev-forestry-roads/AccessHistoryPanel'
import { loadBcAccessPilotScenario } from './dev-forestry-roads/bcAccessPilotScenario'
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
  isLoadableMappedRoad,
  isMappedRoad,
  loadableMappedRoads,
  loadMappedRoads,
  mappedRoadAlignment,
  mappedRoadInBounds,
  nextMappedRoadColor,
} from './dev-forestry-roads/mappedRoad'
import { extendAlignment, nearerEnd, sketchPoints, strokeContinuation } from './dev-forestry-roads/sketchRoad'
import { pathLengthM } from './dev-forestry-roads/mapNotes'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import { roadSelectionRange } from './dev-forestry-roads/roadSelection'
import { RoadNotifications } from './dev-forestry-roads/RoadNotifications'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Download,
  FolderOpen,
  LibraryBig,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Redo2,
  Undo2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { FilesDialog, type RoadExport } from './dev-forestry-roads/FilesDialog'
import { csvPreview, geoJsonPreview, textPreview, type ExportPreview } from './dev-forestry-roads/exportCatalog'
import { mapNotesGeoJson } from './dev-forestry-roads/mapNotes'
import { streamRegisterCsv } from './dev-forestry-roads/streamReports'
import { provincialEvidenceGeoJson } from './dev-forestry-roads/provincialStreamData'
import { FullscreenButton, FullscreenPanel, useElementFullscreen } from '@/components/ui/fullscreen-panel'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { ResizableSplit } from '@/components/ui/resizable-split'
import { TabBar } from '@/components/ui/tab-bar'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import './dev-forestry-roads/workspace.css'
import { downloadBlob, downloadText } from '@/lib/download'
import {
  CableChart,
  ChartHeader,
  CrossSectionChart,
  formatRoadStation,
  MassHaulChart,
  ProfileChart,
} from './dev-forestry-roads/Charts'
import { DesignSidebar, type FileKind } from './dev-forestry-roads/DesignSidebar'
import type { PointCloudChoice, SidebarTab } from './dev-forestry-roads/DesignSidebarBody'
import { FullCostPlanningDialog, type FullCostPreview } from './dev-forestry-roads/FullCostPlanningDialog'
import { NetworkPlanningDialog } from './dev-forestry-roads/NetworkPlanningDialog'
import { createTotalCostPlanningDefaults } from './dev-forestry-roads/fullCostPlanning'
import { isFullCostRecordCurrent } from './dev-forestry-roads/fullCostRecord'
import { PlanView, type DrawMode } from './dev-forestry-roads/PlanView'
import { TerrainPreview } from './dev-forestry-roads/TerrainPreview'
import { PeggingEditor } from './dev-forestry-roads/PeggingEditor'
import { EngineeringSummary } from './dev-forestry-roads/EngineeringSummary'
import { RadialDeflectionPanel } from './dev-forestry-roads/RadialDeflectionPanel'
import { DesignSchedules, type SweptPathProps } from './dev-forestry-roads/DesignSchedules'
import { analyzeSweptPath } from './dev-forestry-roads/sweptPath'
import { SweptPathPanel } from './dev-forestry-roads/SweptPathPanel'
import { StationTable } from './dev-forestry-roads/StationTable'
import { CostBreakdown } from './dev-forestry-roads/CostBreakdown'
import { CompareAlternatives } from './dev-forestry-roads/CompareAlternatives'
import { DRAINAGE_SETTINGS_KEY, DrainagePanel, readDrainageSettings } from './dev-forestry-roads/DrainagePanel'
import { runDrainage, type DrainageRun, type DrainageSettings } from './dev-forestry-roads/drainageRun'
import {
  createDrainageEvidence,
  drainageInputFingerprint,
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
import { roadStationAt } from './dev-forestry-roads/stationAt'
import {
  importAlignmentGeoJson,
  importContextGeoJson,
  engineeringCsv,
  parseProject,
  projectGeoJson,
  projectReportHtml,
  serializeProject,
  stationsCsv,
  terrainProfileCsv,
  terrainProfileReportHtml,
} from './dev-forestry-roads/project'
import {
  createDemoProject,
  DEFAULT_TEMPLATE,
  demoTerrain,
  loadLas,
  loadRaster,
  loadRegionalTerrain,
  exportGrid,
  localMetricGrid,
  starterAlignment,
  terrainBounds,
} from './dev-forestry-roads/terrain'
import { ProjectsDialog, type NewProject } from './dev-forestry-roads/ProjectsDialog'
import { loadRoadScenario, type RoadScenarioId } from './dev-forestry-roads/scenarios'
import type { AccessHistorySelection } from './dev-forestry-roads/AccessHistorySelection'
import { suggestRoutes, type RouteSearchOptions } from './dev-forestry-roads/routing'
import { resolvedGroundWindow } from './dev-forestry-roads/groundTrend'
import type { RoutePreviewLine } from './dev-forestry-roads/RouteFinder'
import { RoadSwitcher } from './dev-forestry-roads/RoadSwitcher'
import { reachedBlockCoordinates } from './dev-forestry-roads/planFit'
import { fitHorizontalRadii } from './dev-forestry-roads/horizontalTools'
import type { AccessMark } from './dev-forestry-roads/AccessReviewPanel'
import { loadNearestBcFsrs } from './dev-forestry-roads/fsrNetwork'
import { refreshExistingRoadFeature } from './dev-forestry-roads/existingRoadEvidence'
import { hasCompleteCoverage, safeAnalyzeRoad } from './dev-forestry-roads/analysisResult'
import { useRoadWorkspace } from './dev-forestry-roads/useRoadWorkspace'
import { landXml, roadShapefileLayers, stakeoutCsv } from './dev-forestry-roads/designExports'
import { RoadPaneLayout, useRoadPanels, type RoadPaneId } from './dev-forestry-roads/RoadPaneLayout'
import { LayoutPicker, readSavedLayouts, resolveLayout, type SavedLayout } from './dev-forestry-roads/LayoutPicker'
import type {
  Alignment,
  ContextFeature,
  Coordinate,
  RoadProject,
  RoadTemplate,
  TerrainSource,
} from './dev-forestry-roads/types'
import { resizeMap } from '@pgmaps/geo-toolkit/map/map-resize'
import {
  historyShortcut,
  historyShortcutLabels,
  isApplePlatform,
  keepsNativeUndo,
} from './dev-forestry-roads/historyShortcut'

const uid = () => crypto.randomUUID()
const number = (v: number | null | undefined, decimals = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: decimals })
const compactNumber = new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 1 })
const summaryLabel = (full: string, mobile: string) => (
  <span title={full}>
    <span className="md:hidden">{mobile}</span>
    <span className="hidden md:inline">{full}</span>
  </span>
)
const summaryValue = (full: string, mobile: string) => (
  <span title={full}>
    <span className="md:hidden" aria-hidden="true">
      {mobile}
    </span>
    <span className="sr-only md:not-sr-only">{full}</span>
  </span>
)
// Violet is left out: it marks a mapped road (MAPPED_ROAD_COLOR).
const colors = ['#d97706', '#2563eb', '#0891b2', '#16a34a', '#db2777']
function fitContextFeature(map: MapLibreMap, feature: ContextFeature) {
  const points =
    feature.geometry.type === 'LineString' ? feature.geometry.coordinates : feature.geometry.coordinates.flat()
  if (!points.length) return
  resizeMap(map)
  map.fitBounds(
    [
      [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))],
      [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))],
    ],
    { padding: 48, maxZoom: 16, duration: 350 },
  )
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
/** Roads the user has, not counting the hidden placeholder of a design with none yet. */
const roadCount = (p: RoadProject) => p.alignments.filter((a) => a.id !== p.designPlaceholderId).length
const pointsInUse = (p: RoadProject) =>
  p.alignments.filter((a) => a.id !== p.designPlaceholderId).reduce((n, a) => n + a.points.length, 0)
const MAX_PROJECT_POINTS = 2000
const MAX_PROJECT_ROADS = 20
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

export default function DevForestryRoads() {
  const w = useRoadWorkspace()
  const { project, analysis, alignment, source, update, updateAlignment, setStation, busy } = w
  const investigation = isAccessInvestigation(project)
  const { ref, fullscreen, toggle } = useElementFullscreen<HTMLDivElement>()
  const [collapsed, setCollapsed] = useState(false)
  const focusMode = useMediaQuery('(max-width: 1279px), (max-height: 620px)')
  const compact = useMediaQuery('(max-width: 767px), (max-height: 760px)')
  const tinyHeight = useMediaQuery('(max-height: 480px)')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const controlsShown = focusMode ? controlsOpen : !collapsed
  const [focusPane, setFocusPane] = useState<RoadPaneId>('plan')
  const [mode, setMode] = useState<DrawMode>('inspect')
  const [draft, setDraft] = useState<Coordinate[]>([])
  const [hover, setHover] = useState<Coordinate | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null)
  const [fitRevision, setFitRevision] = useState(0)
  const [verticalReference, setVerticalReference] = useState('')
  const [pointCloud, setPointCloud] = useState<PointCloudChoice>({ classify: 'auto', surface: 'mean' })
  const [breaklines, setBreaklines] = useState<{ name: string; data: unknown } | null>(null)
  const [detail, setDetail] = useState<
    | 'section'
    | 'terrain'
    | 'mass'
    | 'table'
    | 'compare'
    | 'cable'
    | 'pegs'
    | 'engineering'
    | 'landing'
    | 'drainage'
    | 'swept'
  >('section')
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
  const [layoutSelection, setLayoutSelection] = useState<string>(() => {
    try {
      return localStorage.getItem('pgmaps-road-layout') ?? 'linked'
    } catch {
      return 'linked'
    }
  })
  const savedLayout = resolveLayout(layoutSelection, savedLayouts)
  const layout = investigation ? 'plan' : savedLayout.base
  const layoutStorageId = investigation ? 'access-investigation' : savedLayout.storageId
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
    <Button
      size="icon"
      variant="ghost"
      className="size-8"
      aria-label={`Close ${id === 'detail' ? 'detail view' : id} panel`}
      disabled={visiblePanelCount <= 1}
      title="Close panel · restore in Screen presets & panels"
      onClick={() => setHiddenPanels([...hiddenPanels, id])}
    >
      <X className="size-3.5" />
    </Button>
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
  // Drawing an area makes an avoidance area unless "Draw block" asked for a harvest block.
  const [polygonKind, setPolygonKind] = useState<'avoid' | 'harvest'>('avoid')
  useEffect(() => {
    if (mode !== 'avoid') setPolygonKind('avoid')
  }, [mode])
  // One plan click asked for by a sidebar tool (the access review's end or start road).
  const [planPick, setPlanPick] = useState<{ prompt: string; onPick: (at: Coordinate) => void } | null>(null)
  const [accessMarks, setAccessMarks] = useState<AccessMark[] | null>(null)
  const drawnArea = polygonKind === 'harvest' ? 'harvest block' : 'avoidance area'
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
        ...(routeLines ?? []).map((line) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: line.coordinates },
          properties: { kind: 'route-comparison', color: line.color, selected: line.selected, label: line.label },
        })),
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
  const [costOpen, setCostOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [completeCostOpen, setCompleteCostOpen] = useState(false)
  const [networkOpen, setNetworkOpen] = useState(false)
  const [workflowTab, setWorkflowTab] = useState<SidebarTab>('design')
  const inspectHistoryEvidence = useCallback((selection: Omit<AccessHistorySelection, 'revision'>) => {
    setHistorySelection((previous) => ({ ...selection, revision: (previous?.revision ?? 0) + 1 }))
    setWorkflowTab('terrain')
    setCollapsed(false)
    setControlsOpen(true)
  }, [])
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
    setFilesOpen(false)
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
  }, [investigation, w.projectId])
  const [roadReviewRequest, setRoadReviewRequest] = useState<{ id?: string; sequence: number }>()
  const openCompleteCosts = () => {
    if (!project.totalCostPlanning)
      update((current) => ({ ...current, totalCostPlanning: createTotalCostPlanningDefaults() }))
    setCompleteCostOpen(true)
  }
  // Name of a project waiting for its terrain file; the import then starts it instead of retopping this one.
  const pendingProject = useRef<string | null>(null)
  const planMap = useRef<MapLibreMap | null>(null)
  const pendingLocate = useRef<ContextFeature | null>(null)
  const onPlanReady = useCallback((map: MapLibreMap | null) => {
    planMap.current = map
    if (map && pendingLocate.current) {
      fitContextFeature(map, pendingLocate.current)
      pendingLocate.current = null
    }
  }, [])
  /** Brings the plan forward and fits it to a context feature, once the plan map exists. */
  const showOnPlan = useCallback(
    (feature: ContextFeature) => {
      if (hiddenPanels.includes('plan')) setHiddenPanels(hiddenPanels.filter((panel) => panel !== 'plan'))
      setFocusPane('plan')
      if (focusMode) setControlsOpen(false)
      pendingLocate.current = feature
      requestAnimationFrame(() => {
        if (planMap.current && pendingLocate.current) {
          fitContextFeature(planMap.current, pendingLocate.current)
          pendingLocate.current = null
        }
      })
    },
    [hiddenPanels, setHiddenPanels, focusMode],
  )
  const locateRoad = useCallback(
    (road: ContextFeature) => {
      setReviewedRoad({ id: road.id, source })
      showOnPlan(road)
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
      showOnPlan(area)
    },
    [showOnPlan],
  )
  const locateHistory = useCallback(
    (coordinates: Coordinate[]) => {
      if (!coordinates.length) return
      showOnPlan({
        id: 'history-locate',
        name: 'Historical access evidence',
        kind: 'existing-road',
        geometry: {
          type: 'LineString',
          coordinates: coordinates.length === 1 ? [coordinates[0], coordinates[0]] : coordinates,
        },
      })
    },
    [showOnPlan],
  )
  const [stationEntry, setStationEntry] = useState<{ value: number; text: string } | null>(null)
  // A station typed into the station box is held exactly; every other selection takes a calculated station.
  const [typedStation, setTypedStation] = useState<{ station: number; entered: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const fileKind = useRef<FileKind>('project')
  const operation = useRef<AbortController | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem('pgmaps-road-layout', layoutSelection)
    } catch {
      /* View preferences are optional. */
    }
  }, [layoutSelection])
  useDocumentTitle('Forest road design · PGMaps')
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
  const completeCostRecord = displayedAlignment === alignment ? alignment.fullCostRecord : undefined
  /** A terrain profile or a mapped road: ground only, so no design quantities or cost in the summary. */
  const groundOnly = !!terrainProfile || (displayedAlignment === alignment && isMappedRoad(alignment))
  const completeCostCurrent = useMemo(
    () => !!completeCostRecord && isFullCostRecordCurrent(alignment, project),
    [completeCostRecord, alignment, project],
  )
  const displayedAnalysis = useMemo(() => {
    if (displayedAlignment === alignment) return analysis
    const result = safeAnalyzeRoad(displayedAlignment, source, project.settings, project.context, {
      referenceSurfaces: w.referenceSurfaces,
      verticalReference: project.terrain.verticalReference,
      sharedCrossingCosts: project.sharedCrossingCosts,
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
  // Any other selection (a chart, the slider, a table row) takes a calculated station again.
  if (typedStation && typedStation.station !== w.station) setTypedStation(null)
  const typedHere = typedStation?.station === w.station && !terrainProfile ? typedStation : null
  const stationSampler = useMemo(() => {
    if (!typedHere) return null
    try {
      return createRoadStationSampler(displayedAlignment, source, project.settings, {
        context: project.context,
        referenceSurfaces: w.referenceSurfaces,
        verticalReference: project.terrain.verticalReference,
      })
    } catch {
      // An alignment that cannot be compiled has no section to evaluate; the nearest station stands in.
      return null
    }
  }, [
    typedHere,
    displayedAlignment,
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
  // The header subtitle shows the latest notice briefly, in place of a status row.
  const { notice, setNotice } = w
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 8000)
    return () => window.clearTimeout(timer)
  }, [notice, setNotice])
  // A routine save shows nothing and a training session's is a dot; only a save that failed is spelled out.
  const trainingSave = !!w.saving?.startsWith('Training session saved')
  const saveNotice =
    !!w.saving && !trainingSave && w.saving !== 'Saved on this device' && w.saving !== 'Saving locally…'
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
    const bounded = Math.max(0, Math.min(displayedAnalysis.length, entered))
    setTypedStation({ station: bounded, entered })
    setStation(bounded)
    return bounded
  }
  const stationEntryText = stationEntry && Math.abs(stationEntry.value - station) < 0.001 ? stationEntry.text : null
  const finishStationEntry = () => {
    if (stationEntryText?.trim()) {
      const value = Number(stationEntryText)
      if (Number.isFinite(value)) selectTypedStation(value)
    }
    setStationEntry(null)
  }
  const selectCulvert = (id: string) => {
    setSelectedCulvertId(id)
    const culvert = displayedAnalysis.engineering?.culverts.find((c) => c.id === id)
    if (culvert) setStation(culvert.chainage)
  }
  const currentCulvertId = displayedAnalysis.engineering?.culverts.some((c) => c.id === selectedCulvertId)
    ? selectedCulvertId
    : undefined
  const selectedRange = useMemo(
    () => roadSelectionRange(displayedAlignment, w.featureSelection),
    [displayedAlignment, w.featureSelection],
  )
  const sharedProfileRange = profileRange?.alignmentId === displayedAlignment.id ? profileRange.range : undefined
  const onProfileRange = useCallback(
    (range: [number, number]) => setProfileRange({ alignmentId: displayedAlignment.id, range }),
    [displayedAlignment.id],
  )
  const cableLine = project.cables.find((c) => c.id === activeCable) ?? project.cables[0]
  const cableResult = useMemo(() => {
    try {
      const analysis = cableLine ? analyzeCable(cableLine, source) : null
      return { analysis, summary: cableLine && analysis ? cableSummary(cableLine, analysis) : null, error: '' }
    } catch (error) {
      return {
        analysis: null,
        summary: null,
        error: error instanceof Error ? error.message : 'Invalid D-line geometry.',
      }
    }
  }, [cableLine, source])
  const cableAnalysis = cableResult.analysis
  const saveCableProfile = (kind: 'csv' | 'report') => {
    if (!cableLine || !cableAnalysis) return
    try {
      downloadText(
        kind === 'csv'
          ? cableProfileCsv(cableLine, cableAnalysis, project.terrain)
          : cableProfileHtml(cableLine, cableAnalysis, project.terrain),
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
  const groundValues = displayedAnalysis.stations.map((s) => s.groundElevation).filter((x): x is number => x !== null)
  const grades = displayedAnalysis.stations.map((s) => s.gradePercent).filter((x): x is number => x !== null)
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
  const selectAlignment = useCallback(
    (id: string) => {
      if (busy) return
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
  /** Opens the culvert inputs, at a station when a crossing asked for it. */
  const showCulverts = useCallback(
    (chainage?: number) => {
      setWorkflowTab('engineering')
      setEngineeringRequest((n) => n + 1)
      if (chainage !== undefined) setStation(chainage)
    },
    [setStation],
  )
  const movePoint = useCallback(
    (id: string, coordinate: Coordinate) => {
      if (busy) return
      updateAlignment((a) => ({ ...a, points: a.points.map((p) => (p.id === id ? { ...p, coordinate } : p)) }))
    },
    [updateAlignment, busy],
  )
  const commitValidated = (next: RoadProject) => {
    if (busy) return false
    try {
      w.commit(parseProject(next))
      w.setError('')
      return true
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not apply this project edit.')
      return false
    }
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
  /** An editable design on the active mapped road's line. */
  const copyMappedRoad = () => {
    if (!isMappedRoad(alignment)) return
    if (roadCount(project) >= MAX_PROJECT_ROADS) {
      w.setError(`A project holds at most ${MAX_PROJECT_ROADS} roads. Remove one before copying this road.`)
      return
    }
    const copy = designFromMappedRoad(alignment, uid(), colors[project.alignments.length % colors.length])
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
    } else if (mode === 'stream' || mode === 'avoid') {
      const kind = mode === 'avoid' ? polygonKind : mode
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
    }
    setDraft([])
    setHover(null)
    setMode('inspect')
    w.setStation(0)
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
        resolutionM: project.terrain.resolutionM,
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
        `Drainage: ${result.crossings.length} stream crossing${result.crossings.length === 1 ? '' : 's'}, ${redirected} carried along the road, ${result.lowPoints.filter((p) => !p.throughCulvert).length} low points without a culvert.`,
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
  /** A new project on `terrain`, with one straight road at `centre` to drag or replace. */
  const startOn = (name: string, terrain: RoadProject['terrain'], terrainSource: TerrainSource, centre: Coordinate) => {
    const road = starterAlignment(centre)
    w.startProject(
      parseProject({
        ...createDemoProject(),
        name,
        terrain,
        alignments: [road],
        activeAlignmentId: road.id,
        context: [],
        cables: [],
        profiles: [],
        settings: project.settings,
      }),
      terrainSource,
    )
    setMode('edit')
  }
  const createProject = (start: NewProject) => {
    if (start.kind === 'import') {
      pendingProject.current = start.name
      requestFile('terrain')
      return
    }
    void run('Starting a new project…', async (signal) => {
      if (start.kind === 'training') {
        await w.flush()
        w.startProject({ ...createDemoProject(), name: start.name }, demoTerrain)
      } else if (start.kind === 'lidar') {
        const loaded = await loadRoadScenario('bc-lidar', { signal, onProgress: w.setBusy })
        if (signal.aborted) return
        await w.flush()
        if (signal.aborted) return
        w.startProject({ ...loaded.project, name: start.name }, loaded.source)
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
          ? `Started ${start.name}. Drag the ends of the first road, or use Peg road to draw your own.`
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
  const requestFile = (kind: FileKind) => {
    if (w.busy) return
    fileKind.current = kind
    if (fileRef.current) {
      fileRef.current.accept =
        kind === 'terrain'
          ? '.tif,.tiff,.las,.laz'
          : kind === 'project'
            ? '.json'
            : kind === 'breaklines'
              ? '.json,.geojson'
              : '.json,.geojson,.zip,.kml,.kmz'
      fileRef.current.value = ''
      fileRef.current.click()
    }
  }
  const importFile = (file: File) =>
    void run(`Opening ${file.name}…`, async (signal) => {
      if (fileKind.current === 'terrain') {
        const loaded = /\.la[sz]$/i.test(file.name)
          ? await loadLas(file, verticalReference, {
              ...pointCloud,
              preservePath: alignment.points.map((point) => point.coordinate),
              breaklines: breaklines?.data,
              signal,
              onProgress: (message) => w.setBusy(`${file.name}: ${message}`),
            })
          : { ...(await loadRaster(file, verticalReference)), summary: '' }
        if (signal.aborted) return
        const name = pendingProject.current
        pendingProject.current = null
        if (name !== null) {
          const bounds = terrainBounds(loaded.metadata)
          if (!bounds) throw Error('Could not locate the imported terrain.')
          await w.flush()
          startOn(name, loaded.metadata, loaded.source, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
          w.setNotice(
            `${loaded.summary ? `${loaded.summary} ` : ''}New project on ${file.name}. Drag the ends of the first road, or use Peg road to draw your own.`,
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
        const data: unknown = JSON.parse(await file.text())
        const { readBreaklines } = await import('./dev-forestry-roads/tinSurface')
        const lines = readBreaklines(data, (lon, lat) => [lon, lat])
        if (!lines.length) throw Error('No lines or polygon rings in that file to use as breaklines.')
        setBreaklines({ name: `${file.name} (${lines.length} line${lines.length === 1 ? '' : 's'})`, data })
        w.setNotice(
          `${lines.length} breakline${lines.length === 1 ? '' : 's'} from ${file.name} will be used by the next LAS/LAZ TIN import.`,
        )
        return
      } else {
        if (file.size > 120_000_000)
          throw Error('Import is too large. Use a cropped project or fewer context features.')
        let raw: unknown
        if (file.name.toLowerCase().endsWith('.zip')) {
          const shp = (await import('shpjs')).default
          const layers = await shp(await file.arrayBuffer())
          raw = Array.isArray(layers)
            ? { type: 'FeatureCollection', features: layers.flatMap((layer) => layer.features) }
            : layers
        } else if (/\.km[lz]$/i.test(file.name)) {
          const { readSpatialFile } = await import('./dev-forestry-roads/surveyInterchange')
          raw = await readSpatialFile(file)
        } else raw = JSON.parse(await file.text())
        if (signal.aborted) return
        if (fileKind.current === 'project') {
          const opened = parseProject(raw)
          await w.flush()
          // A project file opens as its own project; the one that was open stays saved.
          await w.restore(opened, signal)
        } else if (fileKind.current === 'alignment') {
          const lines = importAlignmentGeoJson(raw).map((a) => ({
            ...a,
            id: uid(),
            points: a.points.map((p) => ({ ...p, id: uid() })),
          }))
          if (project.alignments.length + lines.length > 20) throw Error('A project supports up to 20 road alignments.')
          w.commit(
            parseProject({ ...project, alignments: [...project.alignments, ...lines], activeAlignmentId: lines[0].id }),
          )
        } else {
          const features = importContextGeoJson(raw).map((c) => ({ ...c, id: uid() }))
          const next = parseProject({ ...project, context: [...project.context, ...features] })
          w.commit(next)
        }
        w.setNotice(`Opened ${file.name}.`)
      }
      w.enablePersistence()
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
    })
  /** The project as saved and the file name stem, after the checks every results export shares. */
  const exportBasis = (kind: RoadExport) => {
    const safe = parseProject(project)
    if (investigation && kind !== 'project' && kind !== 'notes')
      throw Error(
        'This is an access investigation. Export its evidence bundle or report in Access history; start a design before exporting engineering results.',
      )
    const calculated = kind !== 'project' && kind !== 'notes'
    if (calculated && (draftAlignment || numericPegAlignment || templatePreview || costPreview))
      throw Error('Finish or close the design preview before exporting calculated results.')
    if (calculated && !displayedAnalysis.stations.length)
      throw Error('Calculated results are unavailable. Resolve the model errors before exporting results.')
    const basename = (safe.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'forest-road').slice(0, 70)
    return { safe, basename }
  }
  const reportHtml = (safe: RoadProject) =>
    terrainProfile
      ? terrainProfileReportHtml(terrainProfile.name, displayedAnalysis, project.terrain)
      : projectReportHtml(safe, analysis, { drainageHasLiveRun: !!drainageEntry && !drainageStale })
  /**
   * One output's file, built the same way for its download and its preview. The PDFs are not here:
   * they render and download in one step, and preview through the report page and the plan map.
   */
  const exportFile = async (
    kind: Exclude<RoadExport, 'map-pdf' | 'report-pdf'>,
  ): Promise<{ content: string | Blob; filename: string; mime: string; notice: string }> => {
    const { safe, basename } = exportBasis(kind)
    const text = (content: string, filename: string, mime: string, notice = 'Export downloaded.') => ({
      content,
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
          JSON.stringify(projectGeoJson(safe, w.analyses), null, 2),
          `${basename}.geojson`,
          'application/geo+json',
        )
      case 'plotbook': {
        if (terrainProfile) throw Error('Return to the road before plotting design sheets.')
        const [{ plotBookHtml }, { buildTerrainDisplay }] = await Promise.all([
          import('./dev-forestry-roads/plotBook'),
          import('./dev-forestry-roads/terrainDisplay'),
        ])
        // Contours for the plan: the road's extent plus a margin, from the same terrain source.
        const lng = analysis.centerline.map((c) => c[0]),
          lat = analysis.centerline.map((c) => c[1])
        const margin = 0.002
        let contours: GeoJSON.FeatureCollection<GeoJSON.MultiLineString> | undefined,
          contourError = ''
        try {
          contours = buildTerrainDisplay(
            source,
            [
              Math.min(...lng) - margin,
              Math.min(...lat) - margin,
              Math.max(...lng) + margin,
              Math.max(...lat) + margin,
            ],
            256,
          ).contours
        } catch (error) {
          contours = undefined
          contourError = error instanceof Error ? error.message : 'unknown error'
        }
        return text(
          plotBookHtml({
            projectName: safe.name,
            settings: safe.reportSettings,
            alignment,
            analysis,
            terrain: project.terrain,
            contours,
            ...exportGrid(project.terrain, alignment.points[0].coordinate),
          }),
          `${basename}-plot-book.html`,
          'text/html;charset=utf-8',
          contourError
            ? `Plot book downloaded without contours (${contourError}). Open it and use Print / Save as PDF.`
            : 'Plot book downloaded. Open it and use Print / Save as PDF.',
        )
      }
      case 'shapefile': {
        const [{ default: JSZip }, { writeShapefileLayer }] = await Promise.all([
          import('jszip'),
          import('./dev-forestry-roads/shapefile'),
        ])
        const zip = new JSZip(),
          warnings: string[] = []
        for (const layer of roadShapefileLayers(safe.alignments, w.analyses, alignment.id)) {
          const written = writeShapefileLayer(layer)
          warnings.push(...written.warnings)
          for (const [name, bytes] of Object.entries(written.files)) zip.file(name, bytes)
        }
        return {
          content: await zip.generateAsync({ type: 'blob' }),
          filename: `${basename}-shapefiles.zip`,
          mime: 'application/zip',
          notice: warnings.length
            ? `Shapefiles downloaded with ${warnings.length} field warning${warnings.length === 1 ? '' : 's'}: ${warnings.join(' ')}`
            : 'Shapefiles downloaded.',
        }
      }
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
  const save = (kind: RoadExport) => {
    try {
      const { safe, basename } = exportBasis(kind)
      if (kind === 'map-pdf' || kind === 'report-pdf') {
        void run(kind === 'map-pdf' ? 'Building map PDF…' : 'Building report PDF…', async (signal) => {
          const { exportMapPdf, exportReportPdf } = await import('./dev-forestry-roads/pdf')
          if (kind === 'map-pdf') {
            if (hiddenPanels.includes('plan')) setHiddenPanels(hiddenPanels.filter((id) => id !== 'plan'))
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
            const map = planMap.current
            if (!map) throw Error('The plan map is still loading. Try again once it is ready.')
            resizeMap(map)
            await exportMapPdf(
              map,
              safe.name,
              project.terrain.name,
              project.terrain.verticalReference,
              `${basename}-map.pdf`,
              signal,
            )
          } else await exportReportPdf(reportHtml(safe), `${basename}-report.pdf`)
          w.setNotice(kind === 'map-pdf' ? 'Map PDF downloaded.' : 'Report PDF downloaded.')
        })
        return
      }
      const download = (file: Awaited<ReturnType<typeof exportFile>>) => {
        if (typeof file.content === 'string') downloadText(file.content, file.filename, file.mime)
        else downloadBlob(file.content, file.filename)
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
    () => ({ project, analyses: w.analyses, displayedAnalysis, terrainProfile, source, hiddenPanels }),
    [project, w.analyses, displayedAnalysis, terrainProfile, source, hiddenPanels],
  )
  /** What the Save & export dialog shows for one output, from the content its download writes. */
  const buildExportPreview = async (kind: RoadExport, signal: AbortSignal): Promise<ExportPreview> => {
    const { safe } = exportBasis(kind)
    if (kind === 'report-pdf') return { type: 'html', html: reportHtml(safe) }
    if (kind === 'map-pdf') {
      const map = planMap.current
      if (!map || hiddenPanels.includes('plan') || map.getCanvas().clientWidth < 1)
        throw Error('Show the plan panel to preview its map. The PDF opens it for you.')
      const { mapImage } = await import('./dev-forestry-roads/pdf')
      const capture = await mapImage(map, signal)
      return { type: 'image', src: capture.image, width: capture.width, height: capture.height }
    }
    if (kind === 'shapefile') {
      // The zip holds binary layers; preview the same layers' geometry instead.
      return {
        type: 'geometry',
        layers: roadShapefileLayers(safe.alignments, w.analyses, alignment.id).map((layer) =>
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
      const result = suggestRoutes(
        alignment.points[0].coordinate,
        alignment.points[alignment.points.length - 1].coordinate,
        source,
        project.settings,
        project.context,
        {
          ...options,
          alternatives: Math.min(options.alternatives, 20 - project.alignments.length),
          groundWindowM: resolvedGroundWindow(options, project.terrain.resolutionM),
        },
      )
      const created = result.routes.map((route, rank) =>
        generatedAlignment(
          route.coordinates,
          `${derivedRoadName(alignment)} · terrain-cost ${result.routes.length > 1 ? `#${rank + 1} ` : ''}($${Math.round(route.cost).toLocaleString('en-CA')})`,
          alignment.template,
          project.settings.minRadius,
        ),
      )
      const next = created[0]
      w.commit(
        parseProject({ ...project, alignments: [...project.alignments, ...created], activeAlignmentId: next.id }),
      )
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
      w.setNotice(result.message)
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
  // ⌘Z / Ctrl+Z undo outside text fields; while drawing they take back the last point first.
  const [applePlatform] = useState(isApplePlatform)
  const shortcutKeys = historyShortcutLabels(applePlatform)
  const historyKeys = useRef({ w, busy, isDrawing, draftPoints: draft.length })
  useEffect(() => {
    historyKeys.current = { w, busy, isDrawing, draftPoints: draft.length }
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = event.defaultPrevented ? null : historyShortcut(event, applePlatform)
      if (!action || keepsNativeUndo(event.target)) return
      event.preventDefault()
      const state = historyKeys.current
      if (state.isDrawing && state.draftPoints > 0) {
        if (action === 'undo') setDraft((points) => points.slice(0, -1))
        return
      }
      if (state.busy) return
      if (action === 'undo' && state.w.canUndo) state.w.undo()
      if (action === 'redo' && state.w.canRedo) state.w.redo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applePlatform])
  const profileAnalysis = terrainProfile
    ? { ...displayedAnalysis, stations: displayedAnalysis.stations.map((s) => ({ ...s, designElevation: null })) }
    : displayedAnalysis
  // The vehicle check follows the displayed road; deferring it keeps drags and typing responsive.
  const sweptAlignment = useDeferredValue(displayedAlignment)
  const [showSwept, setShowSwept] = useState(true)
  const sweptState = useMemo(() => {
    const check = sweptAlignment.vehicleCheck
    if (!check || terrainProfile) return { result: null, error: '' }
    try {
      return { result: analyzeSweptPath(sweptAlignment, check), error: '' }
    } catch (cause) {
      return { result: null, error: cause instanceof Error ? cause.message : 'The swept path could not be calculated.' }
    }
  }, [sweptAlignment, terrainProfile])
  const swept: SweptPathProps = {
    ...sweptState,
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
      onStation={setStation}
      terrainOnly={!!terrainProfile}
      swept={swept}
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
        analysis={displayedAnalysis}
        station={station}
        onStation={w.setStation}
      />
    </DesignSchedules>
  )
  return (
    <div
      ref={ref}
      data-fullscreen={fullscreen || undefined}
      className="road-workspace relative flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-muted/20 px-3 pb-3 pt-20 md:pt-3 [&[data-fullscreen]]:fixed [&[data-fullscreen]]:inset-0 [&[data-fullscreen]]:z-menu [&[data-fullscreen]]:h-dvh [&[data-fullscreen]]:bg-background [&[data-fullscreen]]:pt-3"
      data-testid="road-workspace"
      data-workspace-mode={investigation ? 'access-investigation' : 'design'}
      data-compact={compact || undefined}
      data-focus-mode={focusMode || undefined}
      data-tiny-height={tinyHeight || undefined}
      data-summary-open={summaryOpen || undefined}
    >
      <header
        className="flex shrink-0 flex-wrap items-center justify-between gap-2"
        data-testid="road-workspace-header"
      >
        <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
          <ForestryBackLink />
          <div className="road-workspace-title min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {investigation ? 'Forest access investigation' : 'Forest road design'}
            </h1>
            <p
              role="status"
              aria-live="polite"
              title={w.notice || undefined}
              className={`max-w-[58vw] truncate text-xs ${w.notice ? 'text-teal-700 dark:text-teal-400' : 'text-muted-foreground'}`}
            >
              {w.notice}
            </p>
          </div>
          {/* Only a warning earns header space: imported LiDAR or DEM terrain is listed in the Terrain tab. */}
          {project.terrain.kind !== 'geotiff' && (
            <span
              title={planningBasis}
              data-testid="road-planning-basis"
              className="road-source-badge hidden shrink-0 cursor-help whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-3xs text-amber-700 dark:text-amber-400 sm:block"
            >
              {project.terrain.kind === 'demo'
                ? compact
                  ? 'SYNTHETIC'
                  : 'SYNTHETIC TRAINING'
                : compact
                  ? `${Math.round(project.terrain.resolutionM)} m terrain`
                  : `Coarse terrain · ${Math.round(project.terrain.resolutionM)} m`}
            </span>
          )}
        </div>
        {!investigation && !awaitingFirstRoad(project) && (
          <RoadSwitcher
            className="order-last w-full md:order-none md:w-auto md:flex-[0_1_26rem]"
            alignments={project.alignments}
            analyses={w.analyses}
            activeId={project.activeAlignmentId}
            disabled={!!w.busy}
            onSelect={selectAlignment}
            onCompare={() => setDetail('compare')}
          />
        )}
        <div className="flex flex-wrap items-center gap-1">
          {investigation && (
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => {
                w.update((current) => startInvestigationDesign(current))
                setWorkflowTab('design')
                setCollapsed(false)
                setControlsOpen(true)
                w.setNotice('Design started with no road. Peg or sketch the first road, or load a mapped road.')
              }}
            >
              Start design
            </Button>
          )}
          {investigation && (
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              title="Load every mapped road in the plan's view as its own road, to read and compare their profiles"
              onClick={loadMappedRoadsInView}
            >
              Load roads in view
            </Button>
          )}
          {tinyHeight && !investigation && (
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label={summaryOpen ? 'Hide road summary' : 'Show road summary'}
              aria-expanded={summaryOpen}
              title="Road summary and cost estimate"
              onClick={() => setSummaryOpen(!summaryOpen)}
            >
              <BarChart3 className="size-4" />
            </Button>
          )}
          {!investigation && (
            <LayoutPicker
              compact={compact || focusMode}
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
          )}
          {/* On narrow headers a failed save is a dot too; its title and label carry the text. */}
          {saveNotice && (
            <span className="mx-1 hidden max-w-40 truncate text-3xs text-muted-foreground xl:inline" title={w.saving}>
              {w.saving}
            </span>
          )}
          {/* A routine autosave shows nothing: only a session that will not be kept, or a failed save. */}
          {(trainingSave || saveNotice) && (
            <span
              role="img"
              aria-label={w.saving}
              title={w.saving}
              className={`mx-1 size-2 shrink-0 rounded-full ${trainingSave ? 'bg-amber-500' : 'bg-red-500'} ${saveNotice ? 'xl:hidden' : ''}`}
            />
          )}
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={
              controlsShown
                ? investigation
                  ? 'Hide access evidence'
                  : 'Hide road controls'
                : investigation
                  ? 'Show access evidence'
                  : 'Show road controls'
            }
            aria-expanded={controlsShown}
            onClick={() => (focusMode ? setControlsOpen(!controlsOpen) : setCollapsed(!collapsed))}
          >
            {controlsShown ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Undo road edit"
            title={`Undo (${shortcutKeys.undo})`}
            aria-keyshortcuts={shortcutKeys.undoAria}
            disabled={!!busy || !w.canUndo}
            onClick={w.undo}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Redo road edit"
            title={`Redo (${shortcutKeys.redo})`}
            aria-keyshortcuts={shortcutKeys.redoAria}
            disabled={!!busy || !w.canRedo}
            onClick={w.redo}
          >
            <Redo2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="size-8 px-0 2xl:w-auto 2xl:max-w-[14rem] 2xl:px-3"
            aria-label="Projects"
            title={`Projects · ${project.name}`}
            disabled={!!w.busy}
            onClick={() => setProjectsOpen(true)}
          >
            <LibraryBig className="size-4 2xl:mr-1 2xl:size-3" />
            <span className="hidden truncate 2xl:inline">{project.name || 'Projects'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="size-8 px-0 md:w-auto md:px-3"
            title="Open project"
            disabled={!!w.busy}
            onClick={() => requestFile('project')}
          >
            <FolderOpen className="size-4 md:mr-1 md:size-3" />
            <span className="sr-only md:not-sr-only">Open</span>
          </Button>
          <Button
            size="sm"
            className="size-8 px-0 md:w-auto md:px-3"
            title="Save & export"
            disabled={!!w.busy}
            onClick={() => (investigation ? save('project') : setFilesOpen(true))}
          >
            <Download className="size-4 md:mr-1 md:size-3" />
            <span className="sr-only md:not-sr-only">Save</span>
          </Button>
          <FullscreenButton title="Road workspace" fullscreen={fullscreen} onClick={toggle} compact />
        </div>
      </header>
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
        onOpenFile={() => requestFile('project')}
        onCreate={createProject}
        onScenario={openScenario}
        onOpenBcOpening={openBcOpening}
        portalContainer={ref.current}
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
        open={!investigation && filesOpen}
        onOpenChange={setFilesOpen}
        name={project.name}
        onName={(name) => update((p) => ({ ...p, name }))}
        onFile={requestFile}
        onSave={save}
        reportSettings={project.reportSettings}
        onReportSettings={(reportSettings) => update((p) => ({ ...p, reportSettings }))}
        busy={!!busy}
        portalContainer={ref.current}
        context={{
          designPreview: !!(draftAlignment || numericPegAlignment || templatePreview || costPreview),
          hasResults: displayedAnalysis.stations.length > 0,
          terrainProfile: !!terrainProfile,
          hasTerrainGrid: !!project.terrain.raster,
          hasProvincialEvidence: !!project.provincialStreamData,
          hasNotes: !!project.notes?.length,
        }}
        buildPreview={buildExportPreview}
        previewVersion={exportPreviewVersion}
      />
      <CostBreakdown
        open={!investigation && costOpen && !!displayedAnalysis.stations.length}
        onOpenChange={setCostOpen}
        analysis={displayedAnalysis}
        alignment={displayedAlignment}
        settings={project.settings}
        portalContainer={ref.current}
        processMs={w.processMs}
        onSettings={(patch) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } }))}
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
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        data-testid="road-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) importFile(file)
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
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
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
      {investigation ? (
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
      ) : awaitingFirstRoad(project) ? null : (
        <StatGroup
          variant="tiles"
          size="sm"
          className="road-summary shrink-0"
          items={[
            { key: 'length', label: 'Length', value: `${number(displayedAnalysis.length, 0)} m` },
            {
              key: 'elevation',
              label: summaryLabel('Ground elevation', 'Elevation (m)'),
              value: groundValues.length
                ? summaryValue(
                    `${number(Math.min(...groundValues), 0)}–${number(Math.max(...groundValues), 0)} m`,
                    `${number(Math.min(...groundValues), 0)}–${number(Math.max(...groundValues), 0)}`,
                  )
                : 'Missing',
            },
            {
              key: 'grade',
              label: summaryLabel(
                groundOnly ? 'Max ground grade' : 'Max design grade',
                groundOnly ? 'Ground grade' : 'Max grade',
              ),
              value: grades.length ? `${number(displayedAnalysis.maxGradePercent)}%` : 'Missing',
              tone: displayedAnalysis.maxGradePercent > project.settings.maxGradePercent ? 'warning' : 'default',
            },
            ...(groundOnly
              ? [
                  {
                    key: 'grade-range',
                    label: 'Grade range',
                    value: grades.length
                      ? `${number(Math.min(...grades))} to ${number(Math.max(...grades))}%`
                      : 'Missing',
                  },
                ]
              : [
                  {
                    key: 'earthworks',
                    label: summaryLabel(
                      !hasCompleteCoverage(displayedAnalysis) ? 'Covered cut / fill' : 'Cut / fill',
                      !hasCompleteCoverage(displayedAnalysis) ? 'Partial C/F (m³)' : 'Cut / fill (m³)',
                    ),
                    value: displayedAnalysis.stations.length
                      ? summaryValue(
                          `${number(displayedAnalysis.cutVolumeM3, 0)} / ${number(displayedAnalysis.fillVolumeM3, 0)} m³`,
                          `${compactNumber.format(Math.round(displayedAnalysis.cutVolumeM3))}/${compactNumber.format(Math.round(displayedAnalysis.fillVolumeM3))}`,
                        )
                      : 'Unavailable',
                  },
                  {
                    key: 'cost',
                    label: costPreview
                      ? 'Candidate complete cost'
                      : completeCostRecord
                        ? 'Complete access cost'
                        : displayedAnalysis.engineering?.haul.optimizationStatus === 'infeasible'
                          ? 'Incomplete estimate'
                          : summaryLabel(
                              'Base engineering estimate',
                              hasCompleteCoverage(displayedAnalysis) ? 'Est. cost' : 'Partial est.',
                            ),
                    value: costPreview
                      ? costPreview.totalCost === null
                        ? costPreview.status === 'infeasible'
                          ? 'Not feasible'
                          : 'Unpriced'
                        : `$${number(costPreview.totalCost, 0)}`
                      : completeCostRecord
                        ? completeCostCurrent
                          ? `$${number(completeCostRecord.totalCost, 0)}`
                          : 'Recalculate'
                        : displayedAnalysis.engineering?.haul.optimizationStatus === 'infeasible'
                          ? 'Material plan infeasible'
                          : displayedAnalysis.stations.length
                            ? summaryValue(
                                `$${number(displayedAnalysis.estimatedCost, 0)}`,
                                `$${compactNumber.format(Math.round(displayedAnalysis.estimatedCost))}`,
                              )
                            : 'Unavailable',
                    // Opens the calculation: quantities × editable rates.
                    onToggle:
                      costPreview || completeCostRecord
                        ? openCompleteCosts
                        : displayedAnalysis.stations.length
                          ? () => setCostOpen((open) => !open)
                          : undefined,
                    pressed: costPreview || completeCostRecord ? completeCostOpen : costOpen,
                    toggleLabel:
                      costPreview || completeCostRecord
                        ? 'Review complete route costs'
                        : 'Show how the covered estimate is calculated',
                  },
                  {
                    key: 'coverage',
                    label: summaryLabel('Complete sections', 'Coverage'),
                    value: `${number(displayedAnalysis.coveragePercent)}%`,
                    tone: !hasCompleteCoverage(displayedAnalysis) ? ('warning' as const) : ('default' as const),
                  },
                ]),
          ]}
        />
      )}
      <ResizableSplit
        direction="row"
        splitQuery="(min-width: 0px)"
        storageKey={investigation ? 'pgmaps-access-investigation:sidebar' : 'pgmaps-road-panes:sidebar'}
        className={`relative min-h-0 flex-1 ${focusMode ? 'road-focus-split' : ''}`}
        panes={[
          {
            id: 'sidebar',
            hidden: !controlsShown,
            label: investigation ? 'access evidence' : 'road controls',
            size: investigation ? 0.34 : 0.22,
            min: investigation ? 340 : 240,
            max: 560,
            stackedHeight: 'auto' as const,
            className: focusMode ? 'absolute inset-y-0 left-0 z-40 w-[min(22rem,100%)] bg-card shadow-xl' : undefined,
            content: investigation ? (
              <div
                className="h-full min-h-0 overflow-y-auto rounded-lg border bg-card p-3"
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
              <DesignSidebar
                workspace={{ ...w, station }}
                workflowTab={workflowTab}
                onWorkflowTabChange={setWorkflowTab}
                roadReviewRequest={roadReviewRequest}
                onCompareCompleteCosts={openCompleteCosts}
                onPlanNetwork={() => setNetworkOpen(true)}
                readOnlyPreview={!!costPreview}
                mode={mode}
                onMode={(next) => {
                  beginMode(next)
                  if (focusMode) setControlsOpen(false)
                }}
                onFile={requestFile}
                onTerrain={loadTerrain}
                verticalReference={verticalReference}
                onVerticalReference={setVerticalReference}
                pointCloud={pointCloud}
                onPointCloud={setPointCloud}
                breaklines={breaklines?.name ?? null}
                onClearBreaklines={() => setBreaklines(null)}
                selectedPoint={selectedPoint}
                onPoint={setSelectedPoint}
                onProfile={selectProfile}
                activeProfile={activeProfile}
                onDuplicate={() => {
                  const a = structuredClone(alignment)
                  a.id = uid()
                  a.name = `${a.name} copy`
                  a.color = colors[project.alignments.length % colors.length]
                  a.points = a.points.map((p) => ({ ...p, id: uid() }))
                  a.vertical = a.vertical.map((p) => ({ ...p, id: uid() }))
                  a.overrides = a.overrides.map((p) => ({ ...p, id: uid() }))
                  if (
                    !commitValidated({
                      ...project,
                      alignments: [...project.alignments, a],
                      activeAlignmentId: a.id,
                    })
                  )
                    return
                  setActiveProfile(null)
                }}
                onRemoveAlignment={() =>
                  w.update((p) => ({
                    ...p,
                    alignments: p.alignments.filter((a) => a.id !== alignment.id),
                    activeAlignmentId: p.alignments.find((a) => a.id !== alignment.id)!.id,
                  }))
                }
                onSuggest={suggest}
                onLoadMappedRoad={loadMappedRoad}
                onLoadMappedRoadsInView={loadMappedRoadsInView}
                onCopyMappedRoad={copyMappedRoad}
                onLocateActiveRoad={() => locateHistory(alignment.points.map((point) => point.coordinate))}
                onLoadTerrainAroundRoad={() => loadTerrain('regional')}
                onLocateRoad={locateRoad}
                onOpenRoadHistory={openRoadReview}
                onLocateConstraint={locateConstraint}
                onLocateHistory={locateHistory}
                historySelection={historySelection}
                onInspectHistoryRecord={(kind, id) => inspectHistoryEvidence({ kind, id })}
                onSelectHistoryBlock={(id) => inspectHistoryEvidence({ kind: 'block', id })}
                focusedConstraintId={focusedConstraintId}
                cutblockReviewRequest={cutblockReviewRequest}
                onReviewRoad={reviewRoad}
                onPreviewRoute={previewRoute}
                onPreviewRoutes={setRouteLines}
                onPickOnPlan={pickOnPlan}
                onLoadFsrsNear={loadFsrsNear}
                onPreviewAccessMarks={setAccessMarks}
                onDrawBlock={() => {
                  setPolygonKind('harvest')
                  setMode('avoid')
                }}
                onShowCompare={() => setDetail('compare')}
                onShowDrainage={() => setDetail('drainage')}
                onSelectRoad={selectAlignment}
                onShowCulverts={showCulverts}
                engineeringRequest={engineeringRequest}
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
                onQuantities={() => setDetail('engineering')}
              />
            ),
          },
          {
            id: 'main',
            label: 'connected views',
            size: 0.78,
            min: 480,
            stackedHeight: 'auto' as const,
            content: (
              <main
                className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden"
                aria-label={investigation ? 'Access investigation map' : 'Connected road views'}
              >
                {focusMode && !investigation && (
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
                {!investigation && awaitingFirstRoad(project) && !isDrawing && (
                  <InlineAlert tone="info">
                    No road yet. Peg or sketch one from the Design tab, or click a mapped road and choose Load as road.
                  </InlineAlert>
                )}
                {!investigation && !awaitingFirstRoad(project) && !displayedAnalysis.stations.length && (
                  <InlineAlert tone="error">{displayedAnalysis.warnings.join(' ')}</InlineAlert>
                )}
                {!investigation && routePreview && (
                  <div
                    role="status"
                    data-testid="road-live-route-preview"
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs"
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
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-teal-600/40 bg-teal-600/10 px-3 py-2 text-xs"
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
                {!investigation && mode === 'sketch' && (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-600/40 bg-teal-600/10 px-3 py-2 text-xs"
                    data-testid="sketch-feedback"
                  >
                    <strong>Sketch road</strong>
                    <span>
                      Press and drag on the plan. A stroke that starts or ends at the active road&apos;s end continues
                      it; corners take the {project.settings.minRadius} m minimum radius where they fit.
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => beginMode('inspect')}>
                      Done sketching
                    </Button>
                  </div>
                )}
                {!investigation && isDrawing && mode !== 'sketch' && (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-600/40 bg-teal-600/10 px-3 py-2 text-xs"
                    data-testid="pegging-feedback"
                  >
                    <strong>
                      {mode === 'road'
                        ? 'Peg road'
                        : mode === 'extend'
                          ? `Extend ${alignment.name}`
                          : mode === 'avoid'
                            ? `Draw ${drawnArea}`
                            : `Draw ${mode}`}
                    </strong>
                    <span>
                      {mode === 'extend' ? 'Click plan to peg on from the nearer road end' : 'Click plan to add points'}{' '}
                      · {draft.length} points
                    </span>
                    <span className="font-mono">
                      Leg {number(leg)} m · ground {number(zb)} m · grade{' '}
                      <strong
                        className={
                          pegGrade !== null && Math.abs(pegGrade) > project.settings.maxGradePercent
                            ? 'text-red-600'
                            : ''
                        }
                      >
                        {number(pegGrade)}%
                      </strong>
                    </span>
                    <Button size="sm" onClick={finishDraw} disabled={draft.length < minimumDraftPoints(mode)}>
                      {mode === 'extend'
                        ? 'Finish extension'
                        : `Finish ${mode === 'avoid' ? (polygonKind === 'harvest' ? 'block' : 'area') : mode}`}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!draft.length}
                      title={`Undo point (${shortcutKeys.undo})`}
                      aria-keyshortcuts={shortcutKeys.undoAria}
                      onClick={() => setDraft((p) => p.slice(0, -1))}
                    >
                      Undo point
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => beginMode('inspect')}>
                      Cancel drawing
                    </Button>
                  </div>
                )}
                {terrainProfile && (
                  <div className="flex items-center justify-between rounded border border-sky-600/40 bg-sky-600/10 px-3 py-1 text-xs">
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
                  <div role="status" className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs">
                    Numeric peg preview · plan, profile, section and leg table use the proposed endpoint. Add peg to
                    save it, or cancel the preview in the peg controls.
                  </div>
                )}
                {!investigation && templatePreview && (
                  <div className="flex flex-wrap items-center justify-between gap-1 rounded border border-violet-600/40 bg-violet-600/10 px-3 py-1 text-xs">
                    <span>
                      Template preview: {templatePreview.name} · current terrain and station · assignments temporarily
                      omitted
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
                {!investigation && selectedRange && !terrainProfile && (
                  <div
                    role="status"
                    data-testid="road-feature-selection"
                    className="flex items-center justify-between gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs"
                  >
                    <span>
                      {selectedRange.label} · {formatRoadStation(selectedRange.start)}
                      {selectedRange.end !== selectedRange.start ? `–${formatRoadStation(selectedRange.end)}` : ''}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => w.setFeatureSelection(null)}>
                      Clear selection
                    </Button>
                  </div>
                )}
                <RoadPaneLayout
                  layout={layout}
                  focusedPane={focusMode ? focusedPane : undefined}
                  hidden={hiddenPanels}
                  storageId={layoutStorageId}
                  plan={
                    <FullscreenPanel
                      title={investigation ? 'Mapped blocks and road records' : 'Plan · alignment & terrain'}
                      compact
                      className="flex min-h-0 flex-1 flex-col"
                      actions={
                        <>
                          {' '}
                          <span className="road-plan-hint text-3xs text-muted-foreground">
                            {investigation
                              ? 'Mapped records · select a road to inspect its evidence'
                              : drainageOnPlan
                                ? 'Blue design streams · dashed existing · red redirected · amber low point'
                                : drainageStale && !terrainProfile
                                  ? 'Drainage out of date · re-run it to show flow'
                                  : isMappedRoad(alignment)
                                    ? 'Mapped road in its own colour · red over the grade limit'
                                    : 'Orange road · red grade flag'}
                          </span>
                          {!investigation && closePanel('plan')}
                        </>
                      }
                    >
                      {() => (
                        <div className="min-h-0 flex-1">
                          <PlanView
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
                            onHighlightRoad={(road) =>
                              investigation
                                ? inspectHistoryEvidence({ kind: 'road', id: road.id })
                                : reviewRoad(road, true)
                            }
                            alignment={displayedAlignment}
                            analyses={displayAnalyses}
                            source={source}
                            station={station}
                            selectedStation={at}
                            onStation={w.setStation}
                            onSelectAlignment={selectAlignment}
                            onMode={investigation || busy || costPreview ? undefined : beginMode}
                            mode={investigation || costPreview ? 'inspect' : mode}
                            draft={draft}
                            onDraw={onDraw}
                            onSketch={onSketch}
                            onLoadMappedRoad={busy ? undefined : loadMappedRoad}
                            onMovePoint={movePoint}
                            onInsertPoint={(afterId, coordinate) => {
                              if (busy || costPreview || alignment.points.length >= 2000) return
                              const index = alignment.points.findIndex((point) => point.id === afterId)
                              if (index < 0 || index === alignment.points.length - 1) return
                              const point = { id: uid(), coordinate, radiusM: project.settings.minRadius }
                              updateAlignment((road) => ({
                                ...road,
                                points: [...road.points.slice(0, index + 1), point, ...road.points.slice(index + 1)],
                              }))
                              setSelectedPoint(point.id)
                              setMode('edit')
                              w.setNotice('Bend added. Drag its number to adjust it, or Undo to remove it.')
                            }}
                            onBendHint={() => w.setNotice('Drag the + off the road to bend it there.')}
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
                            swept={!investigation && showSwept ? sweptState.result?.overlay : undefined}
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
                          actions={
                            <>
                              {chartSlot}
                              {closePanel('profile')}
                            </>
                          }
                          title={
                            terrainProfile
                              ? 'Terrain profile · elevation & distance'
                              : 'Road profile · ground & formation'
                          }
                          compact
                          className="flex min-h-0 flex-1 flex-col"
                        >
                          {() => (
                            <div className="min-h-0 flex-1">
                              <ProfileChart
                                selectedRange={terrainProfile ? undefined : selectedRange}
                                onViewRangeChange={onProfileRange}
                                selectedCulvertId={currentCulvertId}
                                onSelectCulvert={selectCulvert}
                                terrainOnly={!!terrainProfile}
                                analysis={profileAnalysis}
                                alignment={displayedAlignment}
                                station={station}
                                selectedStation={terrainProfile ? undefined : at}
                                onStation={w.setStation}
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
                              />
                            </div>
                          )}
                        </FullscreenPanel>
                      )}
                    </ChartHeader>
                  }
                  detail={
                    <ChartHeader storageKey="pgmaps-road-chart-view:detail">
                      {(chartSlot) => (
                        <FullscreenPanel
                          title={
                            detail === 'section'
                              ? 'Cross-section'
                              : detail === 'terrain'
                                ? '3D terrain'
                                : detail === 'mass'
                                  ? 'Mass haul'
                                  : detail === 'table'
                                    ? 'Station schedule'
                                    : detail === 'compare'
                                      ? 'Compare alternatives'
                                      : detail === 'pegs'
                                        ? 'Pegging data'
                                        : detail === 'engineering'
                                          ? 'Engineering quantities'
                                          : detail === 'landing'
                                            ? 'Landing deflection explorer'
                                            : detail === 'drainage'
                                              ? 'Drainage · existing vs design surface'
                                              : detail === 'swept'
                                                ? 'Design vehicle swept path'
                                                : 'D-line clearance'
                          }
                          actions={
                            <>
                              <RoadSelect
                                className="min-w-0 h-8 w-32"
                                value={detail}
                                onValueChange={(value) => setDetail(value as typeof detail)}
                                options={[
                                  { value: 'section', label: 'Section' },
                                  { value: 'terrain', label: '3D' },
                                  { value: 'mass', label: 'Mass haul', disabled: !!terrainProfile },
                                  { value: 'table', label: 'Stations' },
                                  { value: 'compare', label: 'Compare' },
                                  { value: 'cable', label: 'D-line' },
                                  { value: 'pegs', label: 'Pegs', disabled: !!terrainProfile },
                                  { value: 'engineering', label: 'Quantities', disabled: !!terrainProfile },
                                  { value: 'landing', label: 'Landing' },
                                  { value: 'drainage', label: 'Drainage', disabled: !!terrainProfile },
                                  { value: 'swept', label: 'Swept path', disabled: !!terrainProfile },
                                ]}
                                ariaLabel="Road detail view"
                              />
                              {detail === 'section' && !terrainProfile && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="shrink-0 px-2 min-[420px]:px-3"
                                  aria-label="Section CSV"
                                  title="Download section CSV"
                                  disabled={!at || !!busy}
                                  onClick={saveSection}
                                >
                                  {/* Phones keep room for the detail-view picker beside the chart controls. */}
                                  <Download className="size-3.5 min-[420px]:hidden" aria-hidden />
                                  <span className="sr-only min-[420px]:not-sr-only">Section CSV</span>
                                </Button>
                              )}
                              {chartSlot}
                              {closePanel('detail')}
                            </>
                          }
                          compact
                          className="flex min-h-0 flex-1 flex-col"
                        >
                          {() => (
                            <div className="flex min-h-0 flex-1 flex-col gap-2">
                              <div className="min-h-0 flex-1">
                                {detail === 'section' && (
                                  <CrossSectionChart
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
                                    terrainOnly={!!terrainProfile}
                                    sourceLabel={project.terrain.name}
                                    analysis={displayedAnalysis}
                                    terrain={source}
                                    station={station}
                                    onStation={w.setStation}
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
                                    onStation={w.setStation}
                                  />
                                )}
                                {detail === 'table' && designSchedules}
                                {detail === 'pegs' && !terrainProfile && (
                                  <PeggingEditor
                                    alignment={costPreview?.alignment ?? draftAlignment ?? alignment}
                                    analysis={displayedAnalysis}
                                    source={source}
                                    disabled={!!busy || mode === 'road' || !!templatePreview || !!costPreview}
                                    onStation={setStation}
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
                                    selectedCulvertId={currentCulvertId}
                                    onSelectCulvert={selectCulvert}
                                    analysis={displayedAnalysis}
                                    settings={project.settings}
                                    station={station}
                                    onStation={setStation}
                                    onExport={() => {
                                      try {
                                        parseProject(project)
                                        if (draftAlignment || numericPegAlignment || templatePreview || costPreview)
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
                                      w.setStation(chainage)
                                      if (focusMode) setFocusPane('plan')
                                    }}
                                  />
                                )}
                                {detail === 'swept' && !terrainProfile && (
                                  <div className="h-full overflow-auto overscroll-contain">
                                    <SweptPathPanel
                                      check={displayedAlignment.vehicleCheck}
                                      result={sweptState.result}
                                      error={sweptState.error}
                                      onChange={swept.onChange}
                                      onStation={setStation}
                                      showOnPlan={showSwept}
                                      onShowOnPlan={setShowSwept}
                                      onFocus={swept.onFocus}
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
                                        className="mb-1 rounded border bg-background text-xs"
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
                                          className="mb-1 rounded border px-2 py-1 text-2xs"
                                          data-testid="road-cable-summary"
                                        >
                                          <summary className="cursor-pointer">
                                            Horizontal span {number(cableResult.summary.horizontalSpanM)} m · assumed
                                            sag {number(cableResult.summary.assumedSagM)} m
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
                                            <span>Known ground {number(cableResult.summary.knownGroundPercent)}%</span>
                                          </div>
                                          <p className="mt-1 text-muted-foreground">
                                            Geometric lengths describe the entered sag model; equipment, tension and
                                            operating loads are not calculated.
                                          </p>
                                        </details>
                                      )}
                                      <div className="mb-1 flex gap-1">
                                        <Button size="sm" variant="outline" onClick={() => saveCableProfile('csv')}>
                                          D-line CSV
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => saveCableProfile('report')}>
                                          D-line report
                                        </Button>
                                      </div>
                                      <div className="min-h-0 flex-1">
                                        <CableChart
                                          analysis={cableAnalysis}
                                          distance={cableDistance}
                                          onDistance={setCableDistance}
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="p-4 text-sm text-muted-foreground">
                                      Draw a D-line in Review to inspect an assumed cable-clearance profile.
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                        </FullscreenPanel>
                      )}
                    </ChartHeader>
                  }
                  data={
                    !['engineering', 'pegging'].includes(layout) ? null : (
                      <FullscreenPanel
                        title={
                          layout === 'pegging' ? 'Pegging data · editable legs' : 'Station data · connected selection'
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
                                onStation={setStation}
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
                {!investigation && (
                  <div
                    className="road-station-controller flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border bg-card px-3 py-2 sm:gap-2"
                    data-testid="road-station-controller"
                  >
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-7"
                      aria-label={playing ? 'Pause station playback' : 'Play station playback'}
                      onClick={() => {
                        if (station >= displayedAnalysis.length) w.setStation(0)
                        setPlaying(!playing)
                      }}
                    >
                      {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
                    </Button>
                    <button
                      className="rounded border px-2 py-1 text-xs touch:min-h-10 touch:min-w-10"
                      aria-label="Previous road station"
                      onClick={() =>
                        w.setStation(
                          [...displayedAnalysis.stations].reverse().find((s) => s.chainage < station - 0.001)
                            ?.chainage ?? 0,
                        )
                      }
                    >
                      ‹
                    </button>
                    <label className="flex items-center gap-1 text-xs">
                      {/* Narrow phones keep the slider on the same row; the input stays named. */}
                      <span className="max-[399px]:sr-only">Station</span>{' '}
                      <input
                        aria-label="Selected station metres"
                        type="number"
                        min={0}
                        max={Math.ceil(displayedAnalysis.length * 10) / 10}
                        step="any"
                        className="w-[4.5rem] rounded border bg-background px-1 py-1 font-mono sm:w-20"
                        title="Shows the section at exactly the station you type. Arrow keys select the next or previous calculated station."
                        value={stationEntryText ?? Number(station.toFixed(1))}
                        onChange={(e) => {
                          const text = e.target.value
                          const value = Number(text)
                          if (text.trim() && Number.isFinite(value))
                            setStationEntry({ value: selectTypedStation(value), text })
                          else setStationEntry({ value: station, text })
                        }}
                        onBlur={finishStationEntry}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') finishStationEntry()
                          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                            e.preventDefault()
                            const next =
                              e.key === 'ArrowUp'
                                ? (displayedAnalysis.stations.find((s) => s.chainage > station + 0.001)?.chainage ??
                                  displayedAnalysis.length)
                                : ([...displayedAnalysis.stations].reverse().find((s) => s.chainage < station - 0.001)
                                    ?.chainage ?? 0)
                            setStationEntry(null)
                            setStation(next)
                          }
                        }}
                      />
                    </label>
                    <button
                      className="rounded border px-2 py-1 text-xs touch:min-h-10 touch:min-w-10"
                      aria-label="Next road station"
                      onClick={() =>
                        w.setStation(
                          displayedAnalysis.stations.find((s) => s.chainage > station + 0.001)?.chainage ??
                            displayedAnalysis.length,
                        )
                      }
                    >
                      ›
                    </button>
                    <input
                      aria-label="Linked road station"
                      type="range"
                      min={0}
                      max={Math.max(1, displayedAnalysis.length)}
                      step={1}
                      value={station}
                      className="min-w-16 flex-1 accent-rose-600 touch:h-10 sm:min-w-24"
                      onChange={(e) => w.setStation(Number(e.target.value))}
                    />
                    {typedHere && typedHere.entered !== typedHere.station && (
                      <span
                        role="status"
                        className="text-xs text-amber-800 dark:text-amber-300"
                        data-testid="road-station-limited"
                      >
                        {typedHere.entered < 0
                          ? `Station ${number(typedHere.entered)} is before the road's start; showing ${formatRoadStation(0)}.`
                          : `Station ${number(typedHere.entered)} is past the road's end; showing ${formatRoadStation(displayedAnalysis.length)}.`}
                      </span>
                    )}
                    <output className="font-mono text-xs" data-testid="road-selected-station">
                      {at && (at.groundElevation === null || at.section.some((p) => p.ground === null)) ? (
                        <span
                          className="font-sans text-amber-800 dark:text-amber-300"
                          data-testid="road-station-terrain-gap"
                          title="The selected terrain has missing data here. Hatched chart areas and holes in the 3D ground show those gaps."
                        >
                          {at.groundElevation === null ? 'No ground elevation' : 'Terrain gaps in the cross-section'} at{' '}
                          {formatRoadStation(station)}. Import a DEM with coverage here in Terrain.
                        </span>
                      ) : (
                        <>
                          {formatRoadStation(at?.chainage ?? 0)} · Z {number(at?.groundElevation)} m ·{' '}
                          {number(at?.gradePercent)}%
                        </>
                      )}
                    </output>
                  </div>
                )}
              </main>
            ),
          },
        ]}
      />
    </div>
  )
}
