import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Crosshair, Eye, EyeOff, Layers3, PanelLeft, Settings2, TreePine, X } from 'lucide-react'
import type { ColorSchemeType } from 'maplibre-gl-lidar'
import { Button } from '@/components/ui/button'
import { FullscreenPanel } from '@/components/ui/fullscreen-panel'
import { MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TabBar } from '@/components/ui/tab-bar'
import { useIsMobile } from '@/hooks/useIsMobile'
import { NativeLidarMap } from './NativeLidarMap'
import { LidarDownloads, LidarMethods, LidarResults } from './AnalysisPanels'
import type { AnalysisSummary, RasterKey } from './types'
import { checkAnalysisSummary } from './data'
import type { Basemap } from './basemaps'
import { ImageryProvenance } from './ImageryProvenance'
import { REVIEW_WORKFLOWS, type ReviewWorkflow } from './reviewWorkflows'
import { RoofInspectionPanel } from './RoofInspectionPanel'
import { defaultRoofOrigin, roofCentre, type RoofFeature, type RoofInspection } from './roofInspection'

import { isForestMode, FOREST_PALETTES } from './forestry'
import { WorkflowPanel } from './WorkflowPanel'
import { useWorkflowData } from './useWorkflowData'
import {
  ANALYSIS_MODES,
  analysisPresentation,
  INITIAL_ANALYSIS,
  sortedWorkflowFeatures,
  featureCentre,
  type AnalysisMode,
} from './analysisWorkflows'

type PanelTab = 'layers' | 'analysis' | 'results' | 'buildings' | 'methods' | 'files'
const PANEL_TABS = [
  { value: 'layers', label: 'Map' },
  { value: 'analysis', label: 'Analyze' },
  { value: 'results', label: 'Stats' },
  { value: 'buildings', label: 'Roofs', ariaLabel: 'Buildings and roof candidates' },
  { value: 'methods', label: 'About' },
  { value: 'files', label: 'Files' },
] as const

export function LidarWorkspace({ analysisBase, cloudBase }: { analysisBase: string; cloudBase: string }) {
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [raster, setRaster] = useState<RasterKey>('height')
  const [trees, setTrees] = useState(true)
  const [buildings, setBuildings] = useState(true)
  const [cloud, setCloud] = useState(true)
  const [reference, setReference] = useState(false)
  const [minTreeHeight, setMinTreeHeight] = useState(5)
  const [focus, setFocus] = useState<{ index: number; revision: number; center?: [number, number]; zoom?: number }>({
    index: -1,
    revision: 0,
  })
  const [sceneGround, setSceneGround] = useState<number | null>(null)
  const [color, setColor] = useState<ColorSchemeType>('elevation')
  const [tab, setTab] = useState<PanelTab>('layers')
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>('vector')
  const [labels, setLabels] = useState(true)
  const [surfaceVisible, setSurfaceVisible] = useState(false)
  const [surfaceOpacity, setSurfaceOpacity] = useState(0.65)
  const [reviewNote, setReviewNote] = useState(
    'Choose a review workflow to compare the measured data with its context.',
  )
  const [analysisOptions, setAnalysisOptions] = useState(INITIAL_ANALYSIS)
  const [workflowsRequested, setWorkflowsRequested] = useState(false)
  const [meshVisible, setMeshVisible] = useState(true)
  const workflowProducts = useWorkflowData(workflowsRequested, analysisBase, summary?.source_sha256 ?? '')
  const workflowRows = useMemo(
    () =>
      workflowProducts.data
        ? sortedWorkflowFeatures(workflowProducts.data.workflows, analysisOptions, workflowProducts.data.forestry)
        : [],
    [workflowProducts.data, analysisOptions],
  )
  const selectedWorkflow =
    workflowRows.find((f) => f.properties.id === analysisOptions.selectedId) ?? workflowRows[0] ?? null
  const model = useMemo(() => {
    const records = workflowProducts.data?.models.records
    if (!records?.length) return null
    return (
      records.find((row) => row.id === analysisOptions.selectedId) ??
      records.reduce((a, b) => (a.area_m2 > b.area_m2 ? a : b))
    )
  }, [workflowProducts.data, analysisOptions.selectedId])
  const sidebar = useRef<HTMLElement>(null)
  const isMobile = useIsMobile()
  const showPanel = panelOpen ?? !isMobile

  useEffect(() => {
    const content = sidebar.current?.querySelector<HTMLElement>('[data-map-sidebar-scroll]')
    if (content) content.scrollTop = 0
  }, [tab])

  useEffect(() => {
    document.title = 'LiDAR · Forest & structures · PGMaps'
    const controller = new AbortController()
    let timedOut = false
    let active = true
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 20_000)
    setError('')
    fetch(new URL('summary.json', analysisBase), { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error('The processed analysis is not available in this deployment.')
        const data = await r.json()
        checkAnalysisSummary(data)
        setSummary(data)
      })
      .catch((e) => {
        if (!active) return
        if (timedOut) setError('The analysis request timed out.')
        else if (!controller.signal.aborted) setError(String(e))
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [analysisBase, attempt])

  const go = (index: number) => {
    setSceneGround(null)
    setFocus((previous) => ({ index, revision: previous.revision + 1 }))
  }
  const selectRaster = (key: RasterKey) => {
    setAnalysisOptions((previous) => ({ ...previous, mode: null }))
    setRaster(key)
    setCloud(false)
    setSurfaceVisible(true)
    if (isMobile) setPanelOpen(false)
  }
  const openTools = () => {
    setCloud(true)
    setToolsOpen(true)
    if (isMobile) setPanelOpen(false)
  }
  const review = (workflow: ReviewWorkflow) => {
    setAnalysisOptions((previous) => ({ ...previous, mode: null }))
    setBasemap(workflow.basemap)
    setRaster(workflow.raster)
    setSurfaceVisible(workflow.surfaceVisible)
    setSurfaceOpacity(workflow.surfaceOpacity)
    setTrees(workflow.trees)
    setBuildings(workflow.buildings)
    setCloud(workflow.cloud)
    setLabels(workflow.labels)
    setReference(false)
    setToolsOpen(false)
    setColor('elevation')
    setMinTreeHeight(5)
    setReviewNote(workflow.note)
    go(summary?.highlights.findIndex((place) => place.label === workflow.highlight) ?? -1)
    setSceneGround(workflow.cloud ? defaultRoofOrigin : null)
    if (isMobile) setPanelOpen(false)
  }
  const inspectRoof = (feature: RoofFeature, mode: '2d' | '3d', record: RoofInspection | null) => {
    review(REVIEW_WORKFLOWS.find((workflow) => workflow.id === (mode === '3d' ? 'structure' : 'roofs'))!)
    setSceneGround(mode === '3d' && record ? record.terrain_median_m : null)
    setFocus((previous) => ({
      index: -1,
      revision: previous.revision + 1,
      center: roofCentre(feature),
      zoom: mode === '3d' ? 18 : 19,
    }))
  }
  const startAnalysis = (mode: AnalysisMode) => {
    const preset = ANALYSIS_MODES.find((item) => item.id === mode)!
    setWorkflowsRequested(true)
    setAnalysisOptions((previous) => ({ ...previous, mode, selectedId: null }))
    const presentation = analysisPresentation(mode)
    setBasemap(presentation.basemap)
    setLabels(presentation.labels)
    setSurfaceVisible(presentation.surfaceVisible)
    setSurfaceOpacity(presentation.surfaceOpacity)
    setCloud(presentation.cloud)
    setTrees(presentation.trees)
    setBuildings(presentation.buildings)
    setReference(presentation.reference)
    setToolsOpen(presentation.toolsOpen)
    setMinTreeHeight(presentation.minTreeHeight)
    setColor(presentation.color)
    setMeshVisible(true)
    setReviewNote(preset.note)
    setTab('analysis')
    const url = new URL(window.location.href)
    url.searchParams.set('view', mode)
    window.history.replaceState(null, '', url)
    go(-1)
    if (isMobile) setPanelOpen(false)
  }
  const selectWorkflow = (id: string) => {
    setAnalysisOptions((previous) => ({ ...previous, selectedId: id }))
    const selectedModel = workflowProducts.data?.models.records.find((row) => row.id === id)
    const feature = workflowRows.find((row) => row.properties.id === id)
    if (analysisOptions.mode === 'models' && selectedModel) {
      setSceneGround(selectedModel.ground_m)
      setFocus((previous) => ({ index: -1, revision: previous.revision + 1, center: selectedModel.centre, zoom: 19 }))
    } else if (feature) {
      setFocus((previous) => ({
        index: -1,
        revision: previous.revision + 1,
        center: featureCentre(feature),
        zoom: analysisOptions.mode === 'clearance' ? 19 : 17.5,
      }))
    }
    if (isMobile) setPanelOpen(false)
  }
  useEffect(() => {
    if (analysisOptions.mode !== 'models' || !model) return
    setSceneGround(model.ground_m)
    setFocus((previous) => ({ index: -1, revision: previous.revision + 1, center: model.centre, zoom: 19 }))
  }, [analysisOptions.mode, model])
  const initialViewApplied = useRef(false)
  useEffect(() => {
    if (!summary || initialViewApplied.current) return
    initialViewApplied.current = true
    const view = new URL(window.location.href).searchParams.get('view')
    if (ANALYSIS_MODES.some((item) => item.id === view)) startAnalysis(view as AnalysisMode)
    else if (view === 'inspection') {
      setTab('buildings')
      review(REVIEW_WORKFLOWS.find((item) => item.id === 'roofs')!)
    } else if (view === 'analysis') {
      setTab('analysis')
      setWorkflowsRequested(true)
    }
  }, [summary])
  const forestLegend = isForestMode(analysisOptions.mode) ? FOREST_PALETTES[analysisOptions.mode] : null
  const legend = summary?.rasters[raster]
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground" data-lidar-workspace>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        <Button asChild variant="ghost" size="icon" className="size-8 shrink-0">
          <a href="https://pgmaps.ahmadjalil.com/dev/" aria-label="Back to PGMaps Dev" title="Back to PGMaps Dev">
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <TreePine className="hidden size-5 shrink-0 text-emerald-700 sm:block" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            Forest & structures <span className="hidden font-normal text-muted-foreground lg:inline">/ BC 093G086</span>
          </h1>
        </div>
        <label className="shrink-0">
          <span className="sr-only">Basemap</span>
          <select
            value={basemap}
            onChange={(event) => setBasemap(event.target.value as Basemap)}
            className="h-8 w-[100px] rounded-md border bg-background px-2 text-xs"
            aria-label="Basemap"
          >
            <option value="vector">Vector</option>
            <option value="satellite">Satellite</option>
            <option value="none">None</option>
          </select>
        </label>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-2 text-xs"
          aria-expanded={showPanel}
          aria-controls="lidar-sidebar"
          onClick={() => setPanelOpen(!showPanel)}
          disabled={!summary}
        >
          <PanelLeft className="size-3.5" />
          {showPanel ? 'Hide panel' : 'Panels'}
        </Button>
      </header>
      {!summary ? (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center"
          role="status"
        >
          <Layers3 className="size-8 text-muted-foreground" />
          <p className="text-sm">{error || 'Loading the completed LiDAR analysis…'}</p>
          {error && <Button onClick={() => setAttempt((v) => v + 1)}>Retry</Button>}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <aside
            ref={sidebar}
            id="lidar-sidebar"
            aria-label="LiDAR controls and results"
            hidden={!showPanel}
            className={`${showPanel ? 'flex' : 'hidden'} order-2 h-[42%] min-h-0 w-full shrink-0 flex-col overflow-hidden border-t md:order-1 md:h-full md:w-[310px] md:border-t-0`}
          >
            <MapSidebarShell
              title="Analysis workspace"
              headerClassName="shrink-0 p-2.5"
              titleClassName="text-xs"
              className="border-r-0 shadow-none md:border-r"
              scrollClassName="overscroll-contain"
              contentProps={{ tabIndex: 0, 'aria-label': `${tab} panel content` }}
              actions={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label="Close side panel"
                  onClick={() => setPanelOpen(false)}
                >
                  <X className="size-3.5" />
                </Button>
              }
              metadata={
                <TabBar
                  value={tab}
                  options={PANEL_TABS}
                  onChange={(value) => {
                    setTab(value)
                    if (value === 'analysis') setWorkflowsRequested(true)
                  }}
                  label="LiDAR analysis panels"
                  idPrefix="lidar"
                  variant="underline"
                  stretch
                  className="shrink-0"
                />
              }
            >
              <div id="lidar-panel-layers" role="tabpanel" aria-labelledby="lidar-tab-layers" hidden={tab !== 'layers'}>
                <SidebarSection title="Analysis workflows" className="p-3">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setTab('analysis')
                      setWorkflowsRequested(true)
                    }}
                  >
                    Forestry lab · gaps · plots · 3D models
                  </Button>
                </SidebarSection>
                <SidebarSection title="Review workflows" className="p-3">
                  <div className="grid grid-cols-2 gap-2">
                    {REVIEW_WORKFLOWS.map((workflow) => (
                      <Button key={workflow.id} variant="outline" size="sm" onClick={() => review(workflow)}>
                        {workflow.label}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{reviewNote}</p>
                </SidebarSection>
                <SidebarSection title="Map comparison" className="p-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={surfaceVisible}
                      onChange={(event) => setSurfaceVisible(event.target.checked)}
                    />
                    Show processed surface
                  </label>
                  <label className="mt-3 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={labels}
                      onChange={(event) => setLabels(event.target.checked)}
                      disabled={basemap === 'none'}
                    />
                    Basemap labels
                  </label>
                  <label className="mt-3 block text-xs">
                    Surface opacity · {Math.round(surfaceOpacity * 100)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={surfaceOpacity}
                      onChange={(event) => setSurfaceOpacity(Number(event.target.value))}
                      className="mt-2 w-full"
                    />
                  </label>
                  <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                    {basemap === 'vector'
                      ? 'OpenFreeMap vector roads, buildings and labels. OSM footprints are context, not verified building truth.'
                      : basemap === 'satellite'
                        ? 'Esri satellite/aerial imagery. Hide the surface to see imagery beneath candidate features.'
                        : 'Basemap geometry and labels are hidden to isolate the measured data.'}{' '}
                    The eye button toggles the surface without hiding candidates.
                  </p>
                  {basemap === 'satellite' && <ImageryProvenance bounds={summary.bounds_wgs84} />}
                </SidebarSection>
                <SidebarSection title="Surface layers" className="p-3">
                  <div className="space-y-1">
                    {(Object.entries(summary.rasters) as [RasterKey, AnalysisSummary['rasters'][RasterKey]][]).map(
                      ([key, layer]) => (
                        <label
                          key={key}
                          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs ${raster === key ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'hover:bg-muted'}`}
                        >
                          <input
                            type="radio"
                            name="surface"
                            checked={raster === key}
                            onChange={() => selectRaster(key)}
                          />
                          {layer.title}
                        </label>
                      ),
                    )}
                  </div>
                </SidebarSection>
                <SidebarSection title="Candidate overlays" className="p-3">
                  <div className="space-y-3 text-xs">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={trees} onChange={(e) => setTrees(e.target.checked)} />
                      Dominant crown candidates
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={buildings} onChange={(e) => setBuildings(e.target.checked)} />
                      Roof-like planar patches
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} />
                      GeoLibre tree test · 1 ha (pink)
                    </label>
                    <label className="block text-muted-foreground">
                      Show crown candidates ≥ {minTreeHeight} m
                      <input
                        className="mt-2 w-full"
                        type="range"
                        min={5}
                        max={40}
                        step={1}
                        value={minTreeHeight}
                        onChange={(e) => setMinTreeHeight(Number(e.target.value))}
                      />
                    </label>
                    <p className="text-[10px] leading-4 text-muted-foreground">
                      Filters displayed candidates; detection is not rerun. Green markers are crowns; amber outlines are
                      roof-like patches.
                    </p>
                  </div>
                </SidebarSection>
                <SidebarSection title="GeoLibre point cloud" className="p-3">
                  <label className="block text-xs">
                    Point colour
                    <select
                      value={color}
                      onChange={(e) => setColor(e.target.value as ColorSchemeType)}
                      className="mt-1 w-full rounded border bg-background p-2"
                    >
                      <option value="elevation">Absolute elevation</option>
                      <option value="intensity">Intensity</option>
                      <option value="classification">Source classification</option>
                    </select>
                  </label>
                  <Button className="mt-2 h-8 w-full text-xs" variant="outline" onClick={openTools}>
                    Open native LiDAR tools
                  </Button>
                  <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                    84.6 million source points; display budget 750,000. Drag to pan; right-drag to orbit. Native point
                    size, colour and inspection tools open on demand.
                  </p>
                </SidebarSection>
                <SidebarSection title="Explore key places" className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => go(-1)}>
                      Whole tile
                    </Button>
                    {summary.highlights.map((place, i) => (
                      <Button key={place.label} variant="outline" size="sm" onClick={() => go(i)} title={place.note}>
                        {place.label}
                      </Button>
                    ))}
                  </div>
                </SidebarSection>
              </div>
              <div
                id="lidar-panel-analysis"
                role="tabpanel"
                aria-labelledby="lidar-tab-analysis"
                hidden={tab !== 'analysis'}
              >
                <WorkflowPanel
                  data={workflowProducts.data}
                  error={workflowProducts.error}
                  retry={workflowProducts.retry}
                  options={analysisOptions}
                  features={workflowRows}
                  selected={selectedWorkflow}
                  model={model}
                  meshVisible={meshVisible}
                  onMeshVisible={setMeshVisible}
                  onMode={startAnalysis}
                  onOptions={(patch) => setAnalysisOptions((previous) => ({ ...previous, ...patch }))}
                  onSelect={selectWorkflow}
                  onForestPoints={(plot) => {
                    setCloud(true)
                    setSurfaceVisible(false)
                    setToolsOpen(true)
                    setSceneGround(plot.ground_m)
                    const feature = workflowRows.find((row) => row.properties.id === plot.id)
                    if (feature)
                      setFocus((previous) => ({
                        index: -1,
                        revision: previous.revision + 1,
                        center: featureCentre(feature),
                        zoom: 18,
                      }))
                    if (isMobile) setPanelOpen(false)
                  }}
                  onPoints={() => {
                    setCloud(true)
                    setToolsOpen(true)
                    if (model) setSceneGround(model.ground_m)
                    if (isMobile) setPanelOpen(false)
                  }}
                />
              </div>
              <div
                id="lidar-panel-results"
                role="tabpanel"
                aria-labelledby="lidar-tab-results"
                hidden={tab !== 'results'}
              >
                <LidarResults summary={summary} analysisBase={analysisBase} selectRaster={selectRaster} />
              </div>
              <div
                id="lidar-panel-buildings"
                role="tabpanel"
                aria-labelledby="lidar-tab-buildings"
                hidden={tab !== 'buildings'}
              >
                <RoofInspectionPanel
                  analysisBase={analysisBase}
                  sourceHash={summary.source_sha256}
                  active={tab === 'buildings'}
                  onView={inspectRoof}
                />
              </div>
              <div
                id="lidar-panel-methods"
                role="tabpanel"
                aria-labelledby="lidar-tab-methods"
                hidden={tab !== 'methods'}
              >
                <LidarMethods summary={summary} />
              </div>
              <div id="lidar-panel-files" role="tabpanel" aria-labelledby="lidar-tab-files" hidden={tab !== 'files'}>
                <LidarDownloads summary={summary} analysisBase={analysisBase} />
              </div>
            </MapSidebarShell>
          </aside>
          <FullscreenPanel
            title={analysisOptions.mode === 'models' ? 'Experimental 3D model' : cloud ? '3D LiDAR' : 'Processed map'}
            compact
            dialogOptions={{ onOpenEffect: () => undefined }}
            className="order-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 p-0 md:order-2 [&>div:first-child]:mb-0 [&>div:first-child]:shrink-0 [&>div:first-child]:border-b [&>div:first-child]:px-2 [&>div:first-child]:py-1 max-sm:[&>div:first-child>h2]:sr-only [&[data-fullscreen]]:overflow-hidden [&[data-fullscreen]]:p-0"
            actions={
              <>
                <SegmentedControl
                  value={cloud ? 'cloud' : 'processed'}
                  options={[
                    { value: 'processed', label: 'Layers' },
                    { value: 'cloud', label: '3D LiDAR' },
                  ]}
                  onChange={(value) => {
                    setCloud(value === 'cloud')
                    if (value === 'processed') setSurfaceVisible(true)
                  }}
                  label="Map display"
                  size="sm"
                  fullWidth={false}
                />
                <Button
                  variant={surfaceVisible ? 'secondary' : 'ghost'}
                  size="icon"
                  className="size-8"
                  title={surfaceVisible ? 'Hide processed surface' : 'Show processed surface'}
                  aria-label={surfaceVisible ? 'Hide processed surface' : 'Show processed surface'}
                  aria-pressed={surfaceVisible}
                  onClick={() => setSurfaceVisible((visible) => !visible)}
                >
                  {surfaceVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </Button>
                <Button
                  variant={toolsOpen && cloud ? 'secondary' : 'ghost'}
                  size="icon"
                  className="size-8"
                  title="Native GeoLibre LiDAR tools"
                  aria-label="Native GeoLibre LiDAR tools"
                  aria-pressed={toolsOpen && cloud}
                  onClick={() => {
                    if (toolsOpen && cloud) setToolsOpen(false)
                    else openTools()
                  }}
                >
                  <Settings2 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  title="Fit whole tile"
                  aria-label="Fit whole tile"
                  onClick={() => go(-1)}
                >
                  <Crosshair className="size-4" />
                </Button>
              </>
            }
          >
            {() => (
              <>
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <NativeLidarMap
                    workflowOptions={analysisOptions}
                    workflowFeatures={workflowRows}
                    selectedWorkflowId={selectedWorkflow?.properties.id ?? null}
                    onWorkflowSelect={selectWorkflow}
                    buildingModel={analysisOptions.mode === 'models' && meshVisible ? model : null}
                    modelActive={analysisOptions.mode === 'models'}
                    summary={summary}
                    analysisBase={analysisBase}
                    cloudUrl={new URL('ept.json', cloudBase).href}
                    raster={raster}
                    trees={trees}
                    buildings={buildings}
                    reference={reference}
                    cloud={cloud}
                    minTreeHeight={minTreeHeight}
                    focus={focus}
                    color={color}
                    toolsOpen={toolsOpen}
                    onToolsOpenChange={setToolsOpen}
                    basemap={basemap}
                    surfaceVisible={surfaceVisible}
                    surfaceOpacity={surfaceOpacity}
                    labels={labels}
                    sceneGround={sceneGround}
                  />
                </div>
                {legend && (
                  <div
                    className="flex shrink-0 items-center gap-3 border-t px-3 py-2 text-[10px]"
                    aria-label="Processed surface legend"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium" title={forestLegend?.label ?? legend.title}>
                      {forestLegend
                        ? forestLegend.label
                        : analysisOptions.mode
                          ? ANALYSIS_MODES.find((item) => item.id === analysisOptions.mode)?.note
                          : surfaceVisible
                            ? legend.title
                            : `${basemap === 'vector' ? 'Vector context' : basemap === 'satellite' ? 'Satellite context' : 'Basemap hidden'} · surface hidden`}
                    </span>
                    {(surfaceVisible || forestLegend) && (
                      <div className="w-20 shrink-0 sm:w-32">
                        <div
                          className="h-1.5 rounded"
                          style={{
                            background: `linear-gradient(to right, ${(forestLegend?.colors ?? legend.colors).join(',')})`,
                          }}
                        />
                        <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-muted-foreground">
                          {forestLegend ? (
                            <>
                              <span>{forestLegend.min}</span>
                              <span>
                                {forestLegend.max}
                                {analysisOptions.mode === 'texture'
                                  ? ' m'
                                  : analysisOptions.mode === 'edges'
                                    ? '%'
                                    : ''}
                              </span>
                            </>
                          ) : raster === 'crowns' ? (
                            <span>Categorical regions</span>
                          ) : (
                            <>
                              <span>{legend.min.toFixed(0)}</span>
                              <span>
                                {legend.max.toFixed(0)} {legend.unit}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    <span className="hidden text-muted-foreground lg:inline">
                      Click map to inspect height · candidates unvalidated
                    </span>
                  </div>
                )}
              </>
            )}
          </FullscreenPanel>
        </div>
      )}
    </div>
  )
}
