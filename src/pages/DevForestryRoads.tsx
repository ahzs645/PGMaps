import { roadSelectionRange } from './dev-forestry-roads/roadSelection'
import { RoadNotifications } from './dev-forestry-roads/RoadNotifications'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  Download,
  FolderOpen,
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
import { FullscreenButton, FullscreenPanel, useElementFullscreen } from '@/components/ui/fullscreen-panel'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { AppSelect } from '@/components/ui/select'
import { ResizableSplit } from '@/components/ui/resizable-split'
import { TabBar } from '@/components/ui/tab-bar'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import './dev-forestry-roads/workspace.css'
import { downloadBlob, downloadText } from '@/lib/download'
import {
  CableChart,
  CrossSectionChart,
  formatRoadStation,
  MassHaulChart,
  ProfileChart,
} from './dev-forestry-roads/Charts'
import { DesignSidebar, type FileKind } from './dev-forestry-roads/DesignSidebar'
import type { PointCloudChoice } from './dev-forestry-roads/DesignSidebarBody'
import { PlanView, type DrawMode } from './dev-forestry-roads/PlanView'
import { TerrainPreview } from './dev-forestry-roads/TerrainPreview'
import { PeggingEditor } from './dev-forestry-roads/PeggingEditor'
import { EngineeringSummary } from './dev-forestry-roads/EngineeringSummary'
import { RadialDeflectionPanel } from './dev-forestry-roads/RadialDeflectionPanel'
import { DesignSchedules } from './dev-forestry-roads/DesignSchedules'
import { StationTable } from './dev-forestry-roads/StationTable'
import { CostBreakdown } from './dev-forestry-roads/CostBreakdown'
import { CompareAlternatives } from './dev-forestry-roads/CompareAlternatives'
import { DRAINAGE_SETTINGS_KEY, DrainagePanel, readDrainageSettings } from './dev-forestry-roads/DrainagePanel'
import { runDrainage, type DrainageRun, type DrainageSettings } from './dev-forestry-roads/drainageRun'
import { cableSummary, cableProfileCsv, cableProfileHtml, crossSectionCsv } from './dev-forestry-roads/profileOutputs'
import { analyzeCable, distance, nearestStation, offsetCoordinate } from './dev-forestry-roads/engine'
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
  loadLidarTerrain,
  loadLas,
  loadRaster,
  loadRegionalTerrain,
  exportGrid,
  localMetricGrid,
} from './dev-forestry-roads/terrain'
import { suggestRoutes, type RouteSearchOptions } from './dev-forestry-roads/routing'
import { hasCompleteCoverage, safeAnalyzeRoad } from './dev-forestry-roads/analysisResult'
import { useRoadWorkspace } from './dev-forestry-roads/useRoadWorkspace'
import { landXml, roadShapefileLayers, stakeoutCsv } from './dev-forestry-roads/designExports'
import { RoadPaneLayout, useRoadPanels, type RoadPaneId } from './dev-forestry-roads/RoadPaneLayout'
import { LayoutPicker, readSavedLayouts, resolveLayout, type SavedLayout } from './dev-forestry-roads/LayoutPicker'
import type { Alignment, Coordinate, RoadProject, RoadTemplate, TerrainSource } from './dev-forestry-roads/types'

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
const colors = ['#d97706', '#2563eb', '#7c3aed', '#16a34a', '#db2777']
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
const boundsOf = (p: RoadProject): [number, number, number, number] => {
  const coords = p.alignments.flatMap((a) => a.points.map((p) => p.coordinate))
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
  const { ref, fullscreen, toggle } = useElementFullscreen<HTMLDivElement>()
  const [dismissedBusyId, setDismissedBusyId] = useState<number | null>(null)
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
    'section' | 'terrain' | 'mass' | 'table' | 'compare' | 'cable' | 'pegs' | 'engineering' | 'landing' | 'drainage'
  >('section')
  const [drainageSettings, setDrainageSettings] = useState<DrainageSettings>(readDrainageSettings)
  // One run per road, with the inputs it was computed from: a run is stale when any of them changes.
  const [drainage, setDrainage] = useState<
    Map<
      string,
      {
        run: DrainageRun
        inputs: { alignment: Alignment; settings: RoadProject['settings']; source: TerrainSource; drainage: string }
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
  const { base: layout, storageId: layoutStorageId } = resolveLayout(layoutSelection, savedLayouts)
  const [hiddenPanels, setHiddenPanels] = useRoadPanels(layoutStorageId, layout)
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
  const planMap = useRef<MapLibreMap | null>(null)
  const onPlanReady = useCallback((map: MapLibreMap | null) => {
    planMap.current = map
  }, [])
  const [stationEntry, setStationEntry] = useState<{ value: number; text: string } | null>(null)
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
  useEffect(() => {
    const previous = document.title
    document.title = 'Forest road design · PGMaps'
    return () => {
      document.title = previous
      operation.current?.abort()
    }
  }, [])

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
    if (mode !== 'road' || !draft.length) return null
    const points =
      deferredHover && distance(draft[draft.length - 1], deferredHover) >= 0.2 ? [...draft, deferredHover] : draft
    if (points.length < 2) return null
    return {
      ...newAlignment(points, 'Road being pegged', alignment.template),
      id: 'pegging-preview',
      points: points.map((coordinate, index) => ({ id: `preview-${index}`, coordinate, radiusM: 0 })),
    }
  }, [mode, draft, deferredHover, alignment.template])
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
  const displayedAlignment = draftAlignment ?? terrainProfile ?? numericPegAlignment ?? templateAlignment ?? alignment
  const displayedAnalysis = useMemo(() => {
    if (displayedAlignment === alignment) return analysis
    const result = safeAnalyzeRoad(displayedAlignment, source, project.settings, [])
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
  }, [displayedAlignment, alignment, analysis, source, project.settings, terrainProfile])
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
  const at = nearestStation(displayedAnalysis.stations, w.station)
  const station = at?.chainage ?? 0
  // The header subtitle shows the latest notice briefly, in place of a status row.
  const { notice, setNotice } = w
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 8000)
    return () => window.clearTimeout(timer)
  }, [notice, setNotice])
  const planningBasis = [
    'Concept planning',
    project.terrain.verticalReference,
    project.terrain.kind === 'demo'
      ? 'Synthetic ground, not survey data; load BC LiDAR or your own DEM for site planning'
      : 'Native DEM sampling; missing ground stays missing',
    'earthworks use average end areas; field and engineering review required for construction.',
  ].join(' · ')
  const finishStationEntry = () => {
    if (stationEntry?.value === station && stationEntry.text.trim()) {
      const value = Number(stationEntry.text)
      if (Number.isFinite(value)) setStation(Math.max(0, Math.min(displayedAnalysis.length, value)))
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
      if (draftAlignment || numericPegAlignment || templatePreview)
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
    if (w.busy) return
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
  const finishDraw = () => {
    if (busy || draft.length < (mode === 'avoid' ? 3 : 2)) return
    if (mode === 'road') {
      const next = newAlignment(draft, `Road ${project.alignments.length + 1}`, alignment.template)
      if (!commitValidated({ ...project, alignments: [...project.alignments, next], activeAlignmentId: next.id }))
        return
      setSelectedPoint(next.points[0].id)
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
      const feature = {
        id: uid(),
        name: `${mode === 'stream' ? 'Stream' : 'Avoidance area'} ${project.context.length + 1}`,
        kind: mode,
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
  const run = async (message: string, action: (signal: AbortSignal) => Promise<void>) => {
    if (w.busy) return
    setMode('inspect')
    setDraft([])
    setPlaying(false)
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    w.setBusy(message)
    w.setError('')
    try {
      await action(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) w.setError(error instanceof Error ? error.message : 'Operation failed.')
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
      })
      // Keep runs only for roads that still exist, and at most three: each holds tens of
      // megabytes of grids, and an older run is a few seconds to recompute.
      setDrainage((runs) =>
        new Map(
          [...runs].filter(([id]) => id !== alignment.id && project.alignments.some((a) => a.id === id)).slice(-2),
        ).set(alignment.id, {
          run: result,
          inputs: {
            alignment,
            settings: project.settings,
            source,
            drainage: JSON.stringify(drainageSettings),
          },
        }),
      )
      const redirected = result.crossings.filter((c) => c.redirected && !c.throughCulvertId).length
      w.setNotice(
        `Drainage: ${result.crossings.length} stream crossing${result.crossings.length === 1 ? '' : 's'}, ${redirected} carried along the road, ${result.lowPoints.filter((p) => !p.throughCulvert).length} low points without a culvert.`,
      )
    })
  const drainageEntry = drainage.get(alignment.id)
  const drainageStale =
    !!drainageEntry &&
    (drainageEntry.inputs.alignment !== alignment ||
      drainageEntry.inputs.settings !== project.settings ||
      drainageEntry.inputs.source !== source ||
      drainageEntry.inputs.drainage !== JSON.stringify(drainageSettings))
  /** Drawn on the plan only while current, so an outdated run never reads as the present road. */
  const drainageOnPlan = drainageEntry && !drainageStale && !terrainProfile ? drainageEntry.run.plan : undefined
  const changeDrainageSettings = (next: DrainageSettings) => {
    setDrainageSettings(next)
    try {
      localStorage.setItem(DRAINAGE_SETTINGS_KEY, JSON.stringify(next))
    } catch {
      // Storage can be unavailable (private windows); the settings still apply to this session.
    }
  }
  const loadTerrain = (kind: 'lidar' | 'regional' | 'demo') =>
    void run('Loading terrain…', async (signal) => {
      if (kind === 'demo') {
        w.setSource(demoTerrain)
        w.commit(createDemoProject())
        w.setNotice('Synthetic training project loaded.')
      } else {
        const loaded =
          kind === 'lidar'
            ? await loadLidarTerrain(signal, w.setBusy)
            : await loadRegionalTerrain(boundsOf(project), signal)
        if (signal.aborted) return
        const replacingDemo = project.terrain.kind === 'demo' && kind === 'lidar'
        const alignments =
          replacingDemo && 'alignments' in loaded && loaded.alignments
            ? (loaded.alignments as Alignment[])
            : project.alignments
        w.setSource(loaded.source)
        w.commit({
          ...project,
          terrain: loaded.metadata,
          alignments,
          activeAlignmentId: alignments[0].id,
          ...(replacingDemo ? { context: [], cables: [], profiles: [], name: 'BC LiDAR road planning' } : {}),
        })
        w.setNotice(
          kind === 'lidar'
            ? 'Loaded the native 1 m LiDAR DTM. Example alignments remain unverified planning geometry.'
            : 'Regional reconnaissance DEM loaded. Quantities use this coarser source.',
        )
      }
      w.enablePersistence()
      beginMode('inspect')
      setActiveProfile(null)
      setFitRevision((n) => n + 1)
      w.setStation(0)
    })
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
              : '.json,.geojson,.zip'
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
              breaklines: breaklines?.data,
              signal,
              onProgress: (message) => w.setBusy(`${file.name}: ${message}`),
            })
          : { ...(await loadRaster(file, verticalReference)), summary: '' }
        if (signal.aborted) return
        w.setSource(loaded.source)
        w.commit({ ...project, terrain: loaded.metadata })
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
        } else raw = JSON.parse(await file.text())
        if (signal.aborted) return
        if (fileKind.current === 'project') await w.restore(parseProject(raw), signal)
        else if (fileKind.current === 'alignment') {
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
  const save = (kind: RoadExport) => {
    try {
      const safe = parseProject(project)
      if (kind !== 'project' && (draftAlignment || numericPegAlignment || templatePreview))
        throw Error('Finish or close the design preview before exporting calculated results.')
      if (kind !== 'project' && !displayedAnalysis.stations.length)
        throw Error('Calculated results are unavailable. Resolve the model errors before exporting results.')
      const basename = (safe.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'forest-road').slice(0, 70)
      if (kind === 'map-pdf' || kind === 'report-pdf') {
        void run(kind === 'map-pdf' ? 'Building map PDF…' : 'Building report PDF…', async () => {
          const { exportMapPdf, exportReportPdf } = await import('./dev-forestry-roads/pdf')
          if (kind === 'map-pdf') {
            if (hiddenPanels.includes('plan')) setHiddenPanels(hiddenPanels.filter((id) => id !== 'plan'))
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
            const map = planMap.current
            if (!map) throw Error('The plan map is still loading. Try again once it is ready.')
            map.resize()
            await exportMapPdf(
              map,
              safe.name,
              project.terrain.name,
              project.terrain.verticalReference,
              `${basename}-map.pdf`,
            )
          } else
            await exportReportPdf(
              terrainProfile
                ? terrainProfileReportHtml(terrainProfile.name, displayedAnalysis, project.terrain)
                : projectReportHtml(safe, analysis),
              `${basename}-report.pdf`,
            )
          w.setNotice(kind === 'map-pdf' ? 'Map PDF downloaded.' : 'Report PDF downloaded.')
        })
        return
      }
      if (kind === 'project') downloadText(serializeProject(safe), `${basename}.road.json`, 'application/json')
      else if (kind === 'geojson')
        downloadText(
          JSON.stringify(projectGeoJson(safe, w.analyses), null, 2),
          `${basename}.geojson`,
          'application/geo+json',
        )
      else if (kind === 'plotbook') {
        if (terrainProfile) throw Error('Return to the road before plotting design sheets.')
        void (async () => {
          try {
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
            downloadText(
              plotBookHtml({
                projectName: safe.name,
                alignment,
                analysis,
                terrain: project.terrain,
                contours,
                ...exportGrid(project.terrain, alignment.points[0].coordinate),
              }),
              `${basename}-plot-book.html`,
              'text/html;charset=utf-8',
            )
            w.setNotice(
              contourError
                ? `Plot book downloaded without contours (${contourError}). Open it and use Print / Save as PDF.`
                : 'Plot book downloaded. Open it and use Print / Save as PDF.',
            )
          } catch (error) {
            w.setError(error instanceof Error ? error.message : 'Could not build the plot book.')
          }
        })()
      } else if (kind === 'shapefile') {
        void (async () => {
          try {
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
            downloadBlob(await zip.generateAsync({ type: 'blob' }), `${basename}-shapefiles.zip`)
            w.setNotice(
              warnings.length
                ? `Shapefiles downloaded with ${warnings.length} field warning${warnings.length === 1 ? '' : 's'}: ${warnings.join(' ')}`
                : 'Shapefiles downloaded.',
            )
          } catch (error) {
            w.setError(error instanceof Error ? error.message : 'Could not write the shapefiles.')
          }
        })()
      } else if (kind === 'landxml' || kind === 'stakeout') {
        if (terrainProfile) throw Error('Return to the road before exporting design geometry.')
        const grid = exportGrid(project.terrain, alignment.points[0].coordinate)
        if (kind === 'landxml')
          downloadText(
            landXml({ name: safe.name, alignment, analysis, terrain: project.terrain, ...grid }),
            `${basename}.xml`,
            'application/xml',
          )
        else
          downloadText(
            stakeoutCsv({ alignment, analysis, ...grid }),
            `${basename}-stakeout.csv`,
            'text/csv;charset=utf-8',
          )
      } else if (kind === 'csv')
        downloadText(
          terrainProfile
            ? terrainProfileCsv(displayedAnalysis, project.terrain)
            : stationsCsv(displayedAnalysis, project.terrain),
          `${basename}-stations.csv`,
          'text/csv;charset=utf-8',
        )
      else
        downloadText(
          terrainProfile
            ? terrainProfileReportHtml(terrainProfile.name, displayedAnalysis, project.terrain)
            : projectReportHtml(safe, analysis),
          `${basename}-report.html`,
          'text/html;charset=utf-8',
        )
      // The plot book and shapefiles build asynchronously and report their own outcome.
      w.setNotice(
        kind === 'plotbook' || kind === 'shapefile'
          ? `Building the ${kind === 'plotbook' ? 'plot book' : 'shapefiles'}…`
          : kind === 'report'
            ? 'Report downloaded. Open it and use Print / Save as PDF.'
            : 'Export downloaded.',
      )
      w.setError('')
    } catch (error) {
      w.setError(error instanceof Error ? error.message : 'Could not export project.')
    }
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
        { ...options, alternatives: Math.min(options.alternatives, 20 - project.alignments.length) },
      )
      const created = result.routes.map((route, rank) =>
        newAlignment(
          route.coordinates,
          `${alignment.name} · terrain-cost ${result.routes.length > 1 ? `#${rank + 1} ` : ''}($${Math.round(route.cost).toLocaleString('en-CA')})`,
          alignment.template,
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
    if (busy || !at || at.designElevation === null || terrainProfile || draftAlignment || templatePreview) return
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
  const profileAnalysis = terrainProfile
    ? { ...displayedAnalysis, stations: displayedAnalysis.stations.map((s) => ({ ...s, designElevation: null })) }
    : displayedAnalysis
  return (
    <div
      ref={ref}
      data-fullscreen={fullscreen || undefined}
      className="road-workspace relative flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-muted/20 px-3 pb-3 pt-20 md:pt-3 [&[data-fullscreen]]:fixed [&[data-fullscreen]]:inset-0 [&[data-fullscreen]]:z-[1300] [&[data-fullscreen]]:h-dvh [&[data-fullscreen]]:bg-background [&[data-fullscreen]]:pt-3"
      data-testid="road-workspace"
      data-compact={compact || undefined}
      data-focus-mode={focusMode || undefined}
      data-tiny-height={tinyHeight || undefined}
      data-summary-open={summaryOpen || undefined}
    >
      <header
        className="flex shrink-0 flex-wrap items-center justify-between gap-2"
        data-testid="road-workspace-header"
      >
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <Link to="/dev/forestry" aria-label="Back to forestry tools">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="road-workspace-title min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">Forest road design</h1>
            <p
              role="status"
              aria-live="polite"
              title={w.notice || undefined}
              className={`max-w-[58vw] truncate text-xs ${w.notice ? 'text-teal-700 dark:text-teal-400' : 'text-muted-foreground'}`}
            >
              {w.notice}
            </p>
          </div>
          <span
            title={planningBasis}
            data-testid="road-planning-basis"
            className={`road-source-badge hidden cursor-help rounded-full border px-2 py-1 text-[10px] sm:block ${project.terrain.kind === 'demo' ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'}`}
          >
            {project.terrain.kind === 'demo'
              ? compact
                ? 'SYNTHETIC'
                : 'SYNTHETIC TRAINING'
              : `${project.terrain.resolutionM.toFixed(1)} m TERRAIN`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {tinyHeight && (
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
          <LayoutPicker
            compact={compact || focusMode}
            hiddenPanels={hiddenPanels}
            onHiddenPanels={setHiddenPanels}
            selection={layoutSelection}
            onSelect={(value) => {
              setLayoutSelection(value)
              if (resolveLayout(value, savedLayouts).base !== 'linked') setDetail('section')
            }}
            saved={savedLayouts}
            onSaved={setSavedLayouts}
            portalContainer={ref.current}
          />
          <span className="mx-1 hidden max-w-40 truncate text-[10px] text-muted-foreground xl:inline" title={w.saving}>
            {w.saving}
          </span>
          {/* Narrower headers keep the autosave state as a dot whose title and label carry the text. */}
          {w.saving && (
            <span
              role="img"
              aria-label={w.saving}
              title={w.saving}
              className="mx-1 size-2 shrink-0 rounded-full bg-muted-foreground/60 xl:hidden"
            />
          )}
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={controlsShown ? 'Hide road controls' : 'Show road controls'}
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
            disabled={!!busy || !w.canRedo}
            onClick={w.redo}
          >
            <Redo2 className="size-4" />
          </Button>
          {w.busy && dismissedBusyId === w.busyId && (
            <Button variant="outline" size="sm" onClick={() => setDismissedBusyId(null)}>
              Show loading notification
            </Button>
          )}
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
            onClick={() => setFilesOpen(true)}
          >
            <Download className="size-4 md:mr-1 md:size-3" />
            <span className="sr-only md:not-sr-only">Save</span>
          </Button>
          <FullscreenButton title="Road workspace" fullscreen={fullscreen} onClick={toggle} compact />
        </div>
      </header>
      <FilesDialog
        open={filesOpen}
        onOpenChange={setFilesOpen}
        name={project.name}
        onName={(name) => update((p) => ({ ...p, name }))}
        onFile={requestFile}
        onSave={save}
        busy={!!busy}
        portalContainer={ref.current}
      />
      <CostBreakdown
        open={costOpen && !!displayedAnalysis.stations.length}
        onOpenChange={setCostOpen}
        analysis={displayedAnalysis}
        alignment={displayedAlignment}
        settings={project.settings}
        portalContainer={ref.current}
        processMs={w.processMs}
        onSettings={(patch) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } }))}
        onHaul={
          busy || terrainProfile || draftAlignment || numericPegAlignment || templatePreview
            ? undefined
            : (patch) =>
                updateAlignment((a) =>
                  a.engineering
                    ? { ...a, engineering: { ...a.engineering, haul: { ...a.engineering.haul, ...patch } } }
                    : a,
                )
        }
        onMaterialRate={
          busy || terrainProfile || draftAlignment || numericPegAlignment || templatePreview
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
          ...(w.busy && dismissedBusyId !== w.busyId
            ? [
                {
                  id: `road-busy-${w.busyId}`,
                  tone: 'loading' as const,
                  message: w.busy,
                  action: w.busyCancel ? (
                    <Button size="sm" variant="ghost" onClick={w.busyCancel.onCancel}>
                      {w.busyCancel.label}
                    </Button>
                  ) : undefined,
                  onDismiss: () => setDismissedBusyId(w.busyId),
                },
              ]
            : []),
        ]}
      />
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
              terrainProfile ? 'Max ground grade' : 'Max design grade',
              terrainProfile ? 'Ground grade' : 'Max grade',
            ),
            value: grades.length ? `${number(displayedAnalysis.maxGradePercent)}%` : 'Missing',
            tone: displayedAnalysis.maxGradePercent > project.settings.maxGradePercent ? 'warning' : 'default',
          },
          ...(terrainProfile
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
                  label: summaryLabel(
                    'Covered estimate',
                    hasCompleteCoverage(displayedAnalysis) ? 'Est. cost' : 'Partial est.',
                  ),
                  value: displayedAnalysis.stations.length
                    ? summaryValue(
                        `$${number(displayedAnalysis.estimatedCost, 0)}`,
                        `$${compactNumber.format(Math.round(displayedAnalysis.estimatedCost))}`,
                      )
                    : 'Unavailable',
                  // Opens the calculation: quantities × editable rates.
                  onToggle: displayedAnalysis.stations.length ? () => setCostOpen((open) => !open) : undefined,
                  pressed: costOpen,
                  toggleLabel: 'Show how the covered estimate is calculated',
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
      <ResizableSplit
        direction="row"
        splitQuery="(min-width: 0px)"
        storageKey="pgmaps-road-panes:sidebar"
        className={`relative min-h-0 flex-1 ${focusMode ? 'road-focus-split' : ''}`}
        panes={[
          {
            id: 'sidebar',
            hidden: !controlsShown,
            label: 'road controls',
            size: 0.22,
            min: 240,
            max: 560,
            stackedHeight: 'auto' as const,
            className: focusMode ? 'absolute inset-y-0 left-0 z-40 w-[min(22rem,100%)] bg-card shadow-xl' : undefined,
            content: (
              <DesignSidebar
                workspace={{ ...w, station }}
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
                aria-label="Connected road views"
              >
                {focusMode && (
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
                {!displayedAnalysis.stations.length && (
                  <InlineAlert tone="error">{displayedAnalysis.warnings.join(' ')}</InlineAlert>
                )}
                {isDrawing && (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-600/40 bg-teal-600/10 px-3 py-2 text-xs"
                    data-testid="pegging-feedback"
                  >
                    <strong>{mode === 'road' ? 'Peg road' : `Draw ${mode}`}</strong>
                    <span>Click plan to add points · {draft.length} points</span>
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
                    <Button size="sm" onClick={finishDraw} disabled={draft.length < (mode === 'avoid' ? 3 : 2)}>
                      Finish {mode}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!draft.length}
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
                {numericPegAlignment && !draftAlignment && !terrainProfile && (
                  <div role="status" className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs">
                    Numeric peg preview · plan, profile, section and leg table use the proposed endpoint. Add peg to
                    save it, or cancel the preview in the peg controls.
                  </div>
                )}
                {templatePreview && (
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
                {selectedRange && !terrainProfile && (
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
                      title="Plan · alignment & terrain"
                      compact
                      className="flex min-h-0 flex-1 flex-col"
                      actions={
                        <>
                          {' '}
                          <span className="road-plan-hint text-[10px] text-muted-foreground">
                            {drainageOnPlan
                              ? 'Blue design streams · dashed existing · red redirected · amber low point'
                              : drainageStale && !terrainProfile
                                ? 'Drainage out of date · re-run it to show flow'
                                : 'Orange road · red grade flag'}
                          </span>
                          {closePanel('plan')}
                        </>
                      }
                    >
                      {() => (
                        <div className="min-h-0 flex-1">
                          <PlanView
                            selectedRange={terrainProfile ? undefined : selectedRange}
                            onMapReady={onPlanReady}
                            selectedCulvertId={currentCulvertId}
                            onSelectCulvert={selectCulvert}
                            project={displayProject}
                            alignment={displayedAlignment}
                            analyses={displayAnalyses}
                            source={source}
                            station={station}
                            onStation={w.setStation}
                            onSelectAlignment={selectAlignment}
                            mode={mode}
                            draft={draft}
                            onDraw={onDraw}
                            onMovePoint={movePoint}
                            onInsertPoint={(afterId, coordinate) => {
                              if (busy || alignment.points.length >= 2000) return
                              const index = alignment.points.findIndex((point) => point.id === afterId)
                              if (index < 0 || index === alignment.points.length - 1) return
                              const point = { id: uid(), coordinate, radiusM: 0 }
                              updateAlignment((road) => ({
                                ...road,
                                points: [...road.points.slice(0, index + 1), point, ...road.points.slice(index + 1)],
                              }))
                              setSelectedPoint(point.id)
                              setMode('edit')
                              w.setNotice('Middle control added. Drag it to choose the road pathway.')
                            }}
                            onHover={setHover}
                            onSelectPoint={setSelectedPoint}
                            selectedPoint={selectedPoint}
                            fitRevision={fitRevision}
                            terrainOnly={!!terrainProfile}
                            activeCableId={detail === 'cable' ? cableLine?.id : undefined}
                            onSelectCable={selectCable}
                            cableDistance={cableDistance}
                            onCableDistance={setCableDistance}
                            overlay={overlay}
                            drainage={drainageOnPlan}
                            onOverlaySelect={(properties) => {
                              if (properties?.spokeId) setSelectedSpokeId(String(properties.spokeId))
                            }}
                          />
                        </div>
                      )}
                    </FullscreenPanel>
                  }
                  profile={
                    <FullscreenPanel
                      actions={closePanel('profile')}
                      title={
                        terrainProfile ? 'Terrain profile · elevation & distance' : 'Road profile · ground & formation'
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
                            onStation={w.setStation}
                            onVerticalChange={
                              busy || terrainProfile || draftAlignment || numericPegAlignment || templatePreview
                                ? undefined
                                : (vertical) => w.updateAlignment((a) => ({ ...a, vertical }))
                            }
                          />
                        </div>
                      )}
                    </FullscreenPanel>
                  }
                  detail={
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
                                          : 'D-line clearance'
                      }
                      actions={
                        <>
                          <AppSelect
                            className="min-w-0"
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
                            ]}
                            triggerAriaLabel="Road detail view"
                            triggerClassName="h-8 w-32 max-w-full text-xs"
                            contentClassName="z-[1500] text-xs"
                          />
                          {detail === 'section' && !terrainProfile && (
                            <Button size="sm" variant="outline" disabled={!at || !!busy} onClick={saveSection}>
                              Section CSV
                            </Button>
                          )}
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
                                  busy || terrainProfile || draftAlignment || numericPegAlignment || templatePreview
                                    ? undefined
                                    : shiftSection
                                }
                                onVerticalShift={
                                  busy || terrainProfile || draftAlignment || numericPegAlignment || templatePreview
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
                              />
                            )}
                            {detail === 'mass' && !terrainProfile && (
                              <MassHaulChart
                                selectedRange={selectedRange}
                                viewRange={sharedProfileRange}
                                analysis={displayedAnalysis}
                                station={station}
                                onStation={w.setStation}
                              />
                            )}
                            {detail === 'table' && (
                              <DesignSchedules
                                alignment={displayedAlignment}
                                analysis={displayedAnalysis}
                                station={station}
                                onStation={setStation}
                                terrainOnly={!!terrainProfile}
                                onVerticalChange={
                                  busy || draftAlignment || numericPegAlignment || terrainProfile || templatePreview
                                    ? undefined
                                    : (vertical) =>
                                        commitValidated({
                                          ...project,
                                          alignments: project.alignments.map((a) =>
                                            a.id === alignment.id ? { ...a, vertical } : a,
                                          ),
                                        })
                                }
                              >
                                <StationTable
                                  terrainOnly={!!terrainProfile}
                                  analysis={displayedAnalysis}
                                  station={station}
                                  onStation={w.setStation}
                                />
                              </DesignSchedules>
                            )}
                            {detail === 'pegs' && !terrainProfile && (
                              <PeggingEditor
                                alignment={draftAlignment ?? alignment}
                                analysis={displayedAnalysis}
                                source={source}
                                disabled={!!busy || mode === 'road' || !!templatePreview}
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
                                    if (draftAlignment || numericPegAlignment || templatePreview)
                                      throw Error(
                                        'Finish or close the design preview before exporting calculated results.',
                                      )
                                    downloadText(
                                      engineeringCsv(displayedAnalysis, project.terrain),
                                      'road-engineering-quantities.csv',
                                      'text/csv;charset=utf-8',
                                    )
                                  } catch (error) {
                                    w.setError(error instanceof Error ? error.message : 'Could not export quantities.')
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
                                stale={drainageStale}
                                settings={drainageSettings}
                                onSettings={changeDrainageSettings}
                                onRun={checkDrainage}
                                busy={!!busy}
                                onStation={(chainage) => {
                                  w.setStation(chainage)
                                  if (focusMode) setFocusPane('plan')
                                }}
                              />
                            )}
                            {detail === 'compare' && (
                              <CompareAlternatives
                                alignments={project.alignments}
                                analyses={w.analyses}
                                activeId={alignment.id}
                                onSelect={selectAlignment}
                              />
                            )}
                            {detail === 'cable' &&
                              (cableResult.error ? (
                                <InlineAlert tone="error">{cableResult.error}</InlineAlert>
                              ) : cableAnalysis ? (
                                <div className="flex h-full min-h-0 flex-col">
                                  <select
                                    aria-label="Active D-line"
                                    className="mb-1 rounded border bg-background text-xs"
                                    value={cableLine.id}
                                    onChange={(e) => selectCable(e.target.value)}
                                  >
                                    {project.cables.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                  {cableResult.summary && (
                                    <details
                                      className="mb-1 rounded border px-2 py-1 text-[11px]"
                                      data-testid="road-cable-summary"
                                    >
                                      <summary className="cursor-pointer">
                                        Horizontal span {number(cableResult.summary.horizontalSpanM)} m · assumed sag{' '}
                                        {number(cableResult.summary.assumedSagM)} m
                                      </summary>
                                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                                        <span>
                                          Support Δ elevation {number(cableResult.summary.supportElevationDifferenceM)}{' '}
                                          m
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
                                alignment={draftAlignment ?? alignment}
                                analysis={displayedAnalysis}
                                source={source}
                                disabled={!!busy || mode === 'road' || !!templatePreview}
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
                              <StationTable
                                terrainOnly={!!terrainProfile}
                                analysis={displayedAnalysis}
                                station={station}
                                onStation={w.setStation}
                              />
                            )}
                          </div>
                        )}
                      </FullscreenPanel>
                    )
                  }
                />
                <div
                  className="road-station-controller flex shrink-0 flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2"
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
                    className="rounded border px-2 py-1 text-xs"
                    aria-label="Previous road station"
                    onClick={() =>
                      w.setStation(
                        [...displayedAnalysis.stations].reverse().find((s) => s.chainage < station - 0.001)?.chainage ??
                          0,
                      )
                    }
                  >
                    ‹
                  </button>
                  <label className="flex items-center gap-1 text-xs">
                    Station{' '}
                    <input
                      aria-label="Selected station metres"
                      type="number"
                      min={0}
                      max={Math.ceil(displayedAnalysis.length * 10) / 10}
                      step="any"
                      className="w-20 rounded border bg-background px-1 py-1 font-mono"
                      title="Selects the nearest calculated station. Press Enter or leave the field to apply."
                      value={stationEntry?.value === station ? stationEntry.text : Number(station.toFixed(1))}
                      onChange={(e) => setStationEntry({ value: station, text: e.target.value })}
                      onBlur={finishStationEntry}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishStationEntry()
                      }}
                    />
                  </label>
                  <button
                    className="rounded border px-2 py-1 text-xs"
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
                    className="min-w-24 flex-1 accent-rose-600"
                    onChange={(e) => w.setStation(Number(e.target.value))}
                  />
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
              </main>
            ),
          },
        ]}
      />
    </div>
  )
}
