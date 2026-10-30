import { useIsMobile } from '@/hooks/useIsMobile'
import type { ColorSchemeType, ElevationProfile } from 'maplibre-gl-lidar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Basemap } from './basemaps'
import { useLidarSummary } from './useLidarSummary'
import { type TransectControl } from './NativeTransect'
import { REVIEW_WORKFLOWS, type ReviewWorkflow } from './reviewWorkflows'
import { defaultRoofOrigin, roofCentre, type RoofFeature, type RoofInspection } from './roofInspection'
import { isSpeciesMode, speciesLegend } from './species'
import { type BenchmarkPreview } from './TreeBenchmarks'
import { inProfile, revealCrown, sliceOverlay } from './treeInspection'
import type { IsolatedPoint } from './treeIsolation'
import { treeFeatures } from './treeIsolation'
import type { RasterKey } from './types'
import { useTreeInspection } from './useTreeInspection'
import { useTreeCrop, useTreeIsolation } from './useTreeIsolation'

import {
  analysisPresentation,
  featureCentre,
  INITIAL_ANALYSIS,
  sortedWorkflowFeatures,
  type AnalysisMode,
} from './analysisWorkflows'
import { heatmapLegend, isHeatmapMode } from './canopyHeatmaps'
import { FOREST_PALETTES, isForestMode } from './forestry'
import { useWorkflowData } from './useWorkflowData'

import type { WorkflowOptions } from './analysisWorkflows'
import { useLidarNavigation } from './useLidarNavigation'
import { toolForMode, type LidarToolId } from './workspaceTools'
export type PanelTab = 'layers' | 'analysis' | 'results' | 'buildings' | 'methods' | 'files'
export function useLidarWorkspace({ analysisBase, cloudBase }: { analysisBase: string; cloudBase: string }) {
  const navigation = useLidarNavigation()
  const tool = navigation.tool
  const isLibrary = !tool
  const [remembered, setRemembered] = useState(() => new Map<string, WorkflowOptions>())
  const [lastModes, setLastModes] = useState(() => new Map<LidarToolId, AnalysisMode>())
  const [owner, setOwner] = useState<string | undefined>()
  const [firstTreeFocus, setFirstTreeFocus] = useState(navigation.tool?.id === 'trees')
  const [treesRequested, setTreesRequested] = useState(false)
  const { summary, error, retrySummary } = useLidarSummary(analysisBase)
  const [raster, setRaster] = useState<RasterKey>('height')
  const [trees, setTrees] = useState(false)
  const [buildings, setBuildings] = useState(false)
  const [cloud, setCloud] = useState(false)
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
  const [analysisOptions, setAnalysisOptions] = useState(INITIAL_ANALYSIS)
  const [workflowsRequested, setWorkflowsRequested] = useState(false)
  const [meshVisible, setMeshVisible] = useState(true)
  const [pickedReturn, setPickedReturn] = useState<IsolatedPoint | null>(null)
  const [transectControl, setTransectControl] = useState<TransectControl>({ active: false, width: 2, revision: 0 })
  const [transectProfile, setTransectProfile] = useState<ElevationProfile | null>(null)
  const [benchmarkPreview, setBenchmarkPreview] = useState<BenchmarkPreview | null>(null)
  const [inspectorWidth, setInspectorWidth] = useState(44)
  const [treeView, setTreeView] = useState<'top' | '3d'>('top')
  const focusBenchmark = useCallback((centre: [number, number], ground: number) => {
    setSceneGround(ground)
    setCloud(false)
    setFocus((p) => ({ index: -1, revision: p.revision + 1, center: centre, zoom: 19 }))
  }, [])
  const workflowProducts = useWorkflowData(workflowsRequested, analysisBase, summary?.source_sha256 ?? '')
  const treeProduct = useTreeIsolation(treesRequested, analysisBase, summary?.source_sha256 ?? '')
  const workflowRows = useMemo(
    () =>
      analysisOptions.mode === 'trees'
        ? treeProduct.data
          ? treeFeatures(treeProduct.data, analysisOptions)
          : []
        : workflowProducts.data
          ? sortedWorkflowFeatures(
              workflowProducts.data.workflows,
              analysisOptions,
              workflowProducts.data.forestry,
              workflowProducts.data.species,
              workflowProducts.data.speciesContext,
            )
          : [],
    [workflowProducts.data, treeProduct.data, analysisOptions],
  )
  const selectedWorkflow =
    workflowRows.find((f) => f.properties.id === analysisOptions.selectedId) ?? workflowRows[0] ?? null
  const selectedCrown = useMemo(
    () => treeProduct.data?.crowns.features.find((f) => f.properties.id === selectedWorkflow?.properties.id) ?? null,
    [treeProduct.data, selectedWorkflow?.properties.id],
  )
  const treeCrop = useTreeCrop(
    treeProduct.data,
    selectedCrown,
    analysisOptions.mode === 'trees' && analysisOptions.treeShowPoints && !transectControl.active,
    analysisBase,
    new URL('ept.json', cloudBase).href,
  )
  const activeTreeCrop = treeCrop.crop?.id === selectedCrown?.properties.id ? treeCrop.crop : null
  const inspection = useTreeInspection(
    treeProduct.data,
    activeTreeCrop,
    analysisBase,
    new URL('ept.json', cloudBase).href,
  )
  const visibleTreeCrop = useMemo(
    () =>
      activeTreeCrop
        ? {
            ...activeTreeCrop,
            points: activeTreeCrop.points.filter((p) =>
              inProfile(p, activeTreeCrop, inspection.state.settings, inspection.state.assignments),
            ),
          }
        : null,
    [activeTreeCrop, inspection.state.settings, inspection.state.assignments],
  )
  const {
    mode: profileMode,
    angle: profileAngle,
    width: profileWidth,
    offset: profileOffset,
  } = inspection.state.settings
  const cutOverlay = useMemo(
    () =>
      sliceOverlay(activeTreeCrop, {
        mode: profileMode,
        angle: profileAngle,
        width: profileWidth,
        offset: profileOffset,
      }),
    [activeTreeCrop, profileMode, profileAngle, profileWidth, profileOffset],
  )
  const treeContext = useMemo(
    () => [analysisOptions.mode, selectedCrown, transectControl.active, analysisOptions.treeShowPoints],
    [analysisOptions.mode, selectedCrown, transectControl.active, analysisOptions.treeShowPoints],
  )
  const [previousTreeContext, setPreviousTreeContext] = useState<unknown>(null)
  if (previousTreeContext !== treeContext) {
    setPreviousTreeContext(treeContext)
    if (
      analysisOptions.mode === 'trees' &&
      selectedCrown &&
      !transectControl.active &&
      analysisOptions.treeShowPoints
    ) {
      setSceneGround(selectedCrown.properties.ground_m)
      setCloud(false)
      setSurfaceVisible(false)
      if (firstTreeFocus) {
        setFirstTreeFocus(false)
        setFocus((previous) => ({
          index: -1,
          revision: previous.revision + 1,
          center: selectedCrown.properties.centre,
          zoom: treeView === '3d' ? 19 : 20,
        }))
      }
    }
  }
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
  const applyAnalysis = (mode: AnalysisMode) => {
    setWorkflowsRequested(true)
    setAnalysisOptions((previous) => ({
      ...(remembered.get(mode) ?? previous),
      mode,
      selectedId: remembered.get(mode)?.selectedId ?? null,
      treeShowPoints: mode === 'trees',
      treeOnlySelected: false,
    }))
    setTransectControl((previous) => ({ ...previous, active: false }))
    const presentation = analysisPresentation(mode)
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
    setTab('analysis')
    if (isMobile) setPanelOpen(false)
  }
  const selectWorkflow = (id: string) => {
    const restoreCrown =
      analysisOptions.mode === 'trees' ? treeProduct.data?.crowns.features.find((f) => f.properties.id === id) : null
    setAnalysisOptions((previous) =>
      restoreCrown
        ? revealCrown(previous, restoreCrown)
        : {
            ...previous,
            selectedId: id,
            ...(previous.mode === 'trees' ? { treeShowPoints: true, treeOnlySelected: false } : {}),
          },
    )
    const selectedModel = workflowProducts.data?.models.records.find((row) => row.id === id)
    const feature =
      workflowRows.find((row) => row.properties.id === id) ??
      (restoreCrown
        ? { ...restoreCrown, properties: { ...restoreCrown.properties, focus: restoreCrown.properties.centre } }
        : null)
    if (analysisOptions.mode === 'models' && selectedModel) {
      setSceneGround(selectedModel.ground_m)
      setFocus((previous) => ({ index: -1, revision: previous.revision + 1, center: selectedModel.centre, zoom: 19 }))
    } else if (feature) {
      if (analysisOptions.mode === 'trees' && analysisOptions.treeShowPoints) {
        const crown = treeProduct.data?.crowns.features.find((f) => f.properties.id === id)
        if (crown) setSceneGround(crown.properties.ground_m)
      }
      setFocus((previous) => ({
        index: -1,
        revision: previous.revision + 1,
        center: featureCentre(feature),
        zoom: analysisOptions.mode === 'trees' ? 20 : analysisOptions.mode === 'clearance' ? 19 : 17.5,
      }))
    }
    if (isMobile) setPanelOpen(false)
  }
  // These are React input transitions, so adjust owned state before commit instead
  // of first rendering a previous tool's controls and resetting them in an effect.
  const [recordedOptions, setRecordedOptions] = useState({ options: analysisOptions, toolId: tool?.id, owner })
  if (
    recordedOptions.options !== analysisOptions ||
    recordedOptions.toolId !== tool?.id ||
    recordedOptions.owner !== owner
  ) {
    setRecordedOptions({ options: analysisOptions, toolId: tool?.id, owner })
    if (owner === tool?.id && analysisOptions.mode) {
      const mode = analysisOptions.mode
      setRemembered((current) => new Map(current).set(mode, analysisOptions))
      const ownerTool = toolForMode(mode)
      if (ownerTool) setLastModes((current) => new Map(current).set(ownerTool.id, mode))
    }
  }
  const routeContext = useMemo(
    () => [summary, tool?.id, navigation.mode, navigation.panel],
    [summary, tool?.id, navigation.mode, navigation.panel],
  )
  const [enteredRouteContext, setEnteredRouteContext] = useState<unknown>(null)
  if (summary && enteredRouteContext !== routeContext) {
    setEnteredRouteContext(routeContext)
    setOwner(tool?.id)
    setPickedReturn(null)
    setBenchmarkPreview(null)
    setSceneGround(null)
    setSurfaceVisible(false)
    setTrees(false)
    setBuildings(false)
    setReference(false)
    setToolsOpen(false)
    if (tool?.id === 'trees' || tool?.id === 'transects') setTreesRequested(true)
    if (navigation.mode) applyAnalysis(navigation.mode)
    else {
      setAnalysisOptions((p) => ({ ...p, mode: null }))
      setCloud(tool?.id === 'transects')
      setTransectControl((p) => ({ ...p, active: tool?.id === 'transects' }))
      setTab(tool?.id === 'transects' ? 'layers' : 'analysis')
    }
    if (navigation.panel === 'buildings' && tool?.id === 'buildings') setTab('buildings')
  }
  useEffect(() => {
    if (summary) document.title = `${tool?.title ?? 'Tools'} · LiDAR · PGMaps`
  }, [summary, tool?.title])
  const openTool = (id?: LidarToolId) => {
    const mode = id ? lastModes.get(id) : undefined
    if (mode) navigation.openMode(mode)
    else navigation.openTool(id)
  }
  const startAnalysis = (mode: AnalysisMode) => {
    if (!tool?.modes.includes(mode)) return
    if (navigation.mode === mode) applyAnalysis(mode)
    else navigation.openMode(mode)
  }
  const displayedSurface = isSpeciesMode(analysisOptions.mode)
    ? analysisOptions.speciesOpacity > 0
    : isHeatmapMode(analysisOptions.mode)
      ? analysisOptions.heatOpacity > 0
      : surfaceVisible
  const toggleDisplayedSurface = () => {
    if (isSpeciesMode(analysisOptions.mode))
      setAnalysisOptions((previous) => ({ ...previous, speciesOpacity: previous.speciesOpacity > 0 ? 0 : 0.72 }))
    else if (isHeatmapMode(analysisOptions.mode))
      setAnalysisOptions((previous) => ({ ...previous, heatOpacity: previous.heatOpacity > 0 ? 0 : 0.8 }))
    else setSurfaceVisible((previous) => !previous)
  }
  const forestLegend = isSpeciesMode(analysisOptions.mode)
    ? speciesLegend(analysisOptions)
    : isHeatmapMode(analysisOptions.mode)
      ? heatmapLegend(analysisOptions)
      : isForestMode(analysisOptions.mode)
        ? FOREST_PALETTES[analysisOptions.mode]
        : null
  const legend = summary?.rasters[raster]

  return {
    summary,
    error,
    retrySummary,
    raster,
    setRaster,
    trees,
    setTrees,
    buildings,
    setBuildings,
    cloud,
    setCloud,
    reference,
    setReference,
    minTreeHeight,
    setMinTreeHeight,
    focus,
    setFocus,
    sceneGround,
    setSceneGround,
    color,
    setColor,
    tab,
    setTab,
    panelOpen,
    setPanelOpen,
    toolsOpen,
    setToolsOpen,
    basemap,
    setBasemap,
    labels,
    setLabels,
    surfaceVisible,
    setSurfaceVisible,
    surfaceOpacity,
    setSurfaceOpacity,
    analysisOptions,
    setAnalysisOptions,
    workflowsRequested,
    setWorkflowsRequested,
    meshVisible,
    setMeshVisible,
    pickedReturn,
    setPickedReturn,
    transectControl,
    setTransectControl,
    transectProfile,
    setTransectProfile,
    benchmarkPreview,
    setBenchmarkPreview,
    inspectorWidth,
    setInspectorWidth,
    treeView,
    setTreeView,
    focusBenchmark,
    workflowProducts,
    treeProduct,
    workflowRows,
    selectedWorkflow,
    selectedCrown,
    treeCrop,
    activeTreeCrop,
    inspection,
    visibleTreeCrop,
    cutOverlay,
    model,
    sidebar,
    isMobile,
    showPanel,
    go,
    selectRaster,
    openTools,
    review,
    inspectRoof,
    startAnalysis,
    selectWorkflow,
    displayedSurface,
    toggleDisplayedSurface,
    forestLegend,
    legend,
    analysisBase,
    cloudBase,
    openTool,
    navigation,
    tool,
    isLibrary,
  }
}
export type LidarController = ReturnType<typeof useLidarWorkspace>
