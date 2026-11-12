import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { StyledSelect } from '@/components/ui/form-field'
import { useRouteViewshed } from './dev-forestry/useRouteViewshed'
import { RouteViewshedPanel } from './dev-forestry/RouteViewshedPanel'
import { visibilityOutline } from '@/features/terrain-viewshed'
import { sampleAlongLine } from './dev-forestry/visibility'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { TabBar } from '@/components/ui/tab-bar'
import { MapViewerCone, type MapViewer } from '@/components/ui/map-viewer-cone'
import { horizontalFov } from '@/lib/geo/viewerCone'
import {
  TilePane,
  TilePaneClose,
  TiledWorkspace,
  findPreset,
  tilePaneKey,
  useTilePanels,
} from '@/components/ui/tiled-workspace'
import { TileLayoutPicker, readSavedTileLayouts, resolveTileLayout } from '@/components/ui/tile-layout-picker'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { MapTableBridge } from '@/components/map/useMapTable'
import { Button } from '@/components/ui/button'
import { Map, WORKSPACE_MAP_CONTROLS, type MapRef } from '@/components/ui/map'
import { MapOverlay } from '@/components/ui/map-panels'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { TextButton } from '@/components/ui/text-button'
import { PG_CENTER } from '@/components/ui/map-styles'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { downloadBlob, downloadText } from '@/lib/download'
import { Bookmark, ImageDown } from 'lucide-react'
import { InfoTip } from '@/components/ui/info-tip'

import {
  clampQueryBounds,
  fetchCanopyStands,
  fetchHarvestedAreas,
  unitsToGeoJson,
  type BcSensitivityUnit,
} from './dev-forestry/bcVisualInventory'
import { queryVisualInventory } from './dev-forestry/visualInventoryQuery'
import { usePersistentScene } from './dev-forestry/usePersistentScene'
import { useAssessmentTools } from './dev-forestry/useAssessmentTools'
import { assessmentAlterationClipper } from './dev-forestry/assessmentMaskGeometry'
import { ToolSourcesPanel } from './dev-forestry/ToolSourcesPanel'
import { LandformDesignPanel } from './dev-forestry/LandformDesignPanel'
import { LandformSuggestions } from './dev-forestry/LandformSuggestions'
import { TerrainLandformFinder, type LandformMethod, type TerrainCandidate } from './dev-forestry/TerrainLandformFinder'
import type { RidgeLayer } from './dev-forestry/ridgeLayers'
import type { CanopyStand } from './dev-forestry/canopy'
import { createRoadsideDriveScene, ROADSIDE_DEMO_ID, roadsideDriveCue } from './dev-forestry/driveScenario'
import { createPurdenLakeScene } from './dev-forestry/purdenLakeScenario'
import { PreviewWorkflow } from './dev-forestry/PreviewWorkflow'
import {
  candidateDriveViews,
  parsePreview,
  PREVIEW_STORAGE_KEY,
  previewInputError,
  serializePreview,
  type SavedDriveView,
} from './dev-forestry/previewState'
import type { DriveStatus } from './dev-forestry/driveController'
import { DriveCamera } from './dev-forestry/DriveCamera'
import { AssessmentPanel } from './dev-forestry/AssessmentPanel'
import { buildSceneInput, sceneFingerprint, findSceneLandform } from './dev-forestry/sceneInput'
import { alterationWeight, resultMatchesInput } from './dev-forestry/integrity'
import { useForestHistory } from './dev-forestry/useForestHistory'
import { RegrowthControls } from './dev-forestry/RegrowthControls'
import { buildRegrowthStands, DEFAULT_REGROWTH, type ForestHistoryRecord } from './dev-forestry/regrowth'
import { useDriveTerrain } from './dev-forestry/useDriveTerrain'
import type { ForestStatus } from './dev-forestry/ForestOverlay'
import type { TreeInstance } from './dev-forestry/forest'
import {
  blockThinning,
  bufferLine,
  speciesFromCode,
  speciesMixFromInventory,
  type InventoryStand,
} from './dev-forestry/forest'
import { roadScar } from './dev-forestry/harvestedGround'
import { buildScenePackage } from './dev-forestry/scenePackage'
import type { BasemapContext } from './dev-forestry/BasemapContextProbe'
import { FieldPhotoPanel, PhotoOverlay, StreetPhotoInset } from './dev-forestry/FieldPhoto'
import { useFieldPhoto } from './dev-forestry/useFieldPhoto'
import type { MapillaryImage } from './dev-forestry/mapillary'
import { clearingWidthForRoadClass } from './dev-forestry/basemapContext'
import { buildReport } from './dev-forestry/report'
import { reverseRoadsToGeoJson, type ReverseRoadResult } from './dev-forestry/reverseViewshed'
import {
  collectRoadsFromMap,
  nearestPointOnLine,
  snapCorridorToRoad,
  type RoadCandidate,
} from './dev-forestry/roadSnap'
import { Sidebar, type DrawMode, type DriveState } from './dev-forestry/Sidebar'
import { TerrainSupport } from './dev-forestry/TerrainSupport'
import { readShapeFile } from './dev-forestry/shapeImport'
import { SATELLITE_ATTRIBUTION } from './dev-forestry/SatelliteImagery'
import {
  VIEWPOINT_ROAD_CLASSES,
  arrowLabel,
  ViewpointFinderPanel,
  type ViewpointInventoryState,
} from './dev-forestry/ViewpointFinderPanel'
import { VisualsParagraphPanel, type BlockNoteParts } from './dev-forestry/VisualsParagraphPanel'
import {
  blockNoteFileName,
  blockNotePdf,
  blockNoteWorkbook,
  type BlockNote,
  type NoteImage,
  type ViewpointPage,
} from './dev-forestry/blockNote'
import { captureImageUrl, captureMapImage, capturePlanMap } from './dev-forestry/mapCapture'
import { matchingDesign } from './dev-forestry/assessmentTools'
import {
  fetchViewpointInventory,
  pulloutThrough,
  PULLOUT_METERS,
  viewpointsNearBlock,
  VIEWPOINT_SEARCH_METERS,
  type CandidateArrow,
  type ViewpointCandidate,
} from './dev-forestry/viewpointInventory'
import { EVQO_CODE_FOR_CLASS, viewCaption, type ViewpointFinding } from './dev-forestry/visualsNarrative'
import { distanceAlongRoad, hazeRings, roadPath, roadPlacement } from './dev-forestry/driveMath'
import { metersPerDegree, polygonInteriorPoint } from './dev-forestry/visibility'
import {
  createEmptyScene,
  createId,
  createSampleScene,
  corridorExposureToGeoJson,
  draftLineToGeoJson,
  loadStoredScene,
  pointsToGeoJson,
  samplesToGeoJson,
  sceneBounds,
  serializeScene,
  stationsToGeoJson,
  targetBounds,
  targetsToGeoJson,
  type ForestryScene,
} from './dev-forestry/scene'
import type { ReverseInput, TargetPolygon, Viewpoint } from './dev-forestry/types'
import { DEFAULT_PLAN_SHOW, PlanMapLegend, type PlanShow } from './dev-forestry/PlanMapLegend'
import { useVisibilityAnalysis } from './dev-forestry/useVisibilityAnalysis'
import { useVisualQualityTable } from './dev-forestry/useVisualQualityTable'
import { ViewpointSummary, useViewpointSummaryPreferences } from './dev-forestry/ViewpointSummary'
import { viewpointSummaryMetrics } from './dev-forestry/viewpointSummaryRows'
import { VisualQualityLayers, type SceneLayerData } from './dev-forestry/VisualQualityLayers'
import {
  VISUALS_COLUMNS,
  VISUALS_LAYOUT_KEY,
  VISUALS_WORKSPACE,
  readVisualsLayoutSelection,
  visibleVisualsPanes,
  type VisualsPane,
} from './dev-forestry/visualsWorkspace'
import { assessVia, fs1252ReviewFromVia, viaStepStatuses, type ViaReview } from './dev-forestry/via'
import { DEFAULT_VISUAL_QUALITY_CLASS_ID, visualQualityClass } from './dev-forestry/vqo'
import { bearingDegrees, lineLengthMeters, polygonBounds } from './dev-forestry/visibility'

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const NO_TARGETS: TargetPolygon[] = []
const NO_CANDIDATES: ViewpointCandidate[] = []

const DEFAULT_DRIVE: DriveState = {
  existingForest: true,
  ...DEFAULT_REGROWTH,
  active: false,
  playing: false,
  speedKmh: 60,
  positionMeters: 0,
  lookAtTargetId: null,
  lookBearing: null,
  exaggeration: 1,
  forest: false,
  // The region's mature median (REGIONAL_STAND, from VRI).
  treeHeightMeters: 25,
  // Illustrative clearing only; this control never changes sightline screening.
  roadClearWidthMeters: 20,
  // Facing a block from the road otherwise shows the roadside trees, not the block.
  viewingGap: true,
  treeStyle: 'hybrid',
  treeLook: 'lit',
  // Stopped, the nearest trees are drawn in full; moving, every tree is a card.
  detailRadiusMeters: 150,
  harvestPhase: 'after',
  showAnalysis: false,
  quality: 'auto',
  imagery: false,
  reportLook: false,
  showEvqo: false,
  showLandform: false,
  haze: false,
}

const HARVEST_PHASE_OPTIONS = [
  { value: 'before', label: 'Before harvest' },
  { value: 'after', label: 'After harvest' },
] as const satisfies ReadonlyArray<{ value: DriveState['harvestPhase']; label: string }>

const FIT_PADDING = { top: 72, bottom: 72, left: 48, right: 48 }

/**
 * Cleared width assumed for a road added as site disturbance. A forest service
 * road's running surface plus its cut-and-fill slopes is wider than the
 * driving surface, and it is the cleared ground that reads as alteration.
 */
const ROAD_DISTURBANCE_WIDTH_METERS = 20

/** An inventory viewpoint this close to the run's own road is that road's view, not another viewpoint. */
const INVENTORY_POINT_ON_ROAD_METERS = 300

type InventoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  units: BcSensitivityUnit[]
  error: string | null
  truncated: boolean
  harvestCount: number
  /** Surveyed stands, for drawing the 3D timber as what is recorded there. */
  stands: CanopyStand[]
}

/** Marks openings pulled from DataBC, so a re-lookup replaces them cleanly. */
const HARVEST_SOURCE = 'BC consolidated cutblocks'

/** Closes a traced ring and rejects anything too small to be a polygon. */
function ringToPolygon(coordinates: Array<[number, number]>): GeoJSON.Polygon | null {
  if (coordinates.length < 3) return null
  const ring = [...coordinates]
  const [firstLng, firstLat] = ring[0]
  const [lastLng, lastLat] = ring[ring.length - 1]
  if (firstLng !== lastLng || firstLat !== lastLat) ring.push([firstLng, firstLat])
  return { type: 'Polygon', coordinates: [ring] }
}

/**
 * The last scene the browser saved, or the worked example — the page opening on
 * a blank map teaches nothing about what it does.
 */
function loadInitialScene(): ForestryScene {
  const stored = loadStoredScene()
  return stored &&
    (stored.targets.length > 0 || (stored.viewpoint.mode === 'corridor' && stored.viewpoint.coordinates.length >= 2))
    ? stored
    : createSampleScene()
}

function DevForestryVisuals() {
  useDocumentTitle('Visual quality · PGMaps')
  /** The 2D plan map; the eye-level road view has its own (`eyeMapRef`), mounted while it is open. */
  const mapRef = useRef<MapRef>(null)
  const eyeMapRef = useRef<MapRef>(null)
  const { scene, setScene, warning: sceneStorageWarning } = usePersistentScene(loadInitialScene)
  const [drawMode, setDrawMode] = useState<DrawMode>('none')
  const [draftCoordinates, setDraftCoordinates] = useState<Array<[number, number]>>([])
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    () => scene.targets.find((target) => target.role === 'block')?.id ?? null,
  )
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [pendingPreview, setPendingPreview] = useState<{ key: string; view?: SavedDriveView } | null>(null)
  const [saved, setSaved] = useState<{ key: string | null; views: SavedDriveView[] }>(() => {
    try {
      const stored = parsePreview(JSON.parse(localStorage.getItem(PREVIEW_STORAGE_KEY) ?? 'null'))
      if (stored) return { key: sceneFingerprint(stored.scene), views: stored.views }
    } catch {
      /* Unavailable or old storage is recoverable by importing a preview. */
    }
    return { key: sceneFingerprint(scene), views: [] }
  })
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [previewMessage, setPreviewMessage] = useState<string | null>(null)
  const [cameraStatus, setCameraStatus] = useState<DriveStatus>('waiting-for-terrain')
  const [lowFrameRate, setLowFrameRate] = useState(false)
  const [restoreLook, setRestoreLook] = useState({ yaw: 0, tilt: 0 })
  const cameraLook = useRef({ yaw: 0, tilt: 0 })
  const [preliminaryDrive, setPreliminaryDrive] = useState(false)
  const [drive, setDrive] = useState<DriveState>(DEFAULT_DRIVE)
  const driveRef = useRef(drive)
  driveRef.current = drive
  const [cameraEye, setCameraEye] = useState<{ lng: number; lat: number } | null>(null)
  const runSnapshotRef = useRef<{ scene: ForestryScene; inventoryUnits: BcSensitivityUnit[]; key: string } | null>(null)
  const [inventory, setInventory] = useState<InventoryState>({
    status: 'idle',
    units: [],
    error: null,
    truncated: false,
    harvestCount: 0,
    stands: [],
  })
  const [showInventory, setShowInventory] = useState(true)
  const [driveStationIndex, setDriveStationIndex] = useState(0)
  const [seekVersion, setSeekVersion] = useState(0)
  const [snapMessage, setSnapMessage] = useState<string | null>(null)
  const [forestStatus, setForestStatus] = useState<ForestStatus | null>(null)
  // The roads the last reverse run was scored against, so a result can be
  // turned back into a corridor without re-querying a map that has since moved.
  const reverseRoadsRef = useRef<RoadCandidate[]>([])
  // The blocks the last reverse run was scored for, so its viewpoint rows feed only their paragraph.
  const reverseBlocksRef = useRef<string[]>([])
  // BC's own viewpoints, arrows, rec sites, screenings and tenure road names around a block.
  const [viewpointInventory, setViewpointInventory] = useState<ViewpointInventoryState>({
    status: 'idle',
    data: null,
    error: null,
    blockId: null,
  })

  const analysis = useVisibilityAnalysis()
  const { run: runAnalysis, cancel: cancelAnalysis } = analysis
  const rawResult = analysis.state.result
  const key = useMemo(() => sceneFingerprint(scene), [scene])
  const isStale = useMemo(
    () =>
      !!rawResult &&
      (!key || runSnapshotRef.current?.key !== key || !resultMatchesInput(rawResult, buildSceneInput(scene))),
    [rawResult, key, scene],
  )
  const result = isStale ? null : rawResult
  const savedViews = useMemo(() => (saved.key === key ? saved.views : []), [saved, key])
  // Handbook step 2 is done once the road has been looked at from eye level,
  // or a view saved from it. A visit belongs to the road and the proposal, not
  // to one run: re-running with other settings does not undo it, while moving
  // the road or a cutblock does.
  const visitKey = JSON.stringify([
    scene.viewpoint.coordinates,
    scene.targets.filter((target) => target.role === 'block').map((target) => target.geometry),
  ])
  const [visitedKey, setVisitedKey] = useState<string | null>(null)
  if (drive.active && !preliminaryDrive && result && visitedKey !== visitKey) setVisitedKey(visitKey)
  // Water and the road's class, read from the basemap while the overview shows.
  // Timber is kept off mapped water, and the roadside clearing follows the
  // road's class until the reviewer sets a width of their own.
  const [basemap, setBasemap] = useState<BasemapContext>({ water: [], roadClass: null })
  // The plan map's own Show switches (its legend); the road view keeps its set on `drive`.
  const [planShow, setPlanShow] = useState<PlanShow>(DEFAULT_PLAN_SHOW)
  const [seenRoadClass, setSeenRoadClass] = useState<string | null>(null)
  const [autoClearing, setAutoClearing] = useState(DEFAULT_DRIVE.roadClearWidthMeters)
  if (basemap.roadClass !== seenRoadClass) {
    setSeenRoadClass(basemap.roadClass)
    const width = clearingWidthForRoadClass(basemap.roadClass)
    if (drive.roadClearWidthMeters === autoClearing)
      setDrive((current) => ({ ...current, roadClearWidthMeters: width }))
    setAutoClearing(width)
  }
  const basemapBounds = useMemo(() => {
    const bounds = sceneBounds(scene)
    return bounds
      ? ([bounds[0] - 0.12, bounds[1] - 0.07, bounds[2] + 0.12, bounds[3] + 0.07] as [number, number, number, number])
      : null
  }, [scene])
  const sceneLandform = findSceneLandform(scene)
  const viaAssessment = useMemo(
    () =>
      sceneLandform
        ? assessVia({
            objectiveId: sceneLandform.objectiveId,
            result,
            review: scene.viaReview,
            blocks: scene.targets.filter((target) => target.role === 'block'),
          })
        : null,
    [sceneLandform, result, scene.viaReview, scene.targets],
  )
  const viaStatuses = viaStepStatuses({
    hasViewpoint: scene.viewpoint.coordinates.length > 0,
    blockCount: scene.targets.filter((target) => target.role === 'block').length,
    hasLandform: !!sceneLandform,
    hasResult: !!result,
    visited: !!result && (visitedKey === visitKey || savedViews.length > 0),
    numericalReady: !!result?.quality?.numericalReady,
    assessment: viaAssessment,
  })
  const updateViaReview = useCallback(
    (patch: Partial<ViaReview>) => {
      setScene((current) => ({ ...current, viaReview: { ...current.viaReview, ...patch } }))
    },
    [setScene],
  )
  useEffect(() => {
    if (saved.key !== key) return
    try {
      localStorage.setItem(PREVIEW_STORAGE_KEY, serializePreview(scene, saved.views))
      setStorageWarning(null)
    } catch {
      setStorageWarning('Browser storage is unavailable. Download the preview to keep your comparisons.')
    }
  }, [key, saved, scene])
  useEffect(() => {
    if (isStale) setDrive((current) => ({ ...current, active: false, playing: false }))
  }, [isStale])

  const fitBounds = useCallback((bounds: [number, number, number, number] | null, maxZoom = 13) => {
    const map = mapRef.current
    if (!map || !bounds) return
    map.fitBounds(bounds, { padding: FIT_PADDING, duration: 700, maxZoom })
  }, [])

  const sceneRef = useRef(scene)
  useEffect(() => {
    sceneRef.current = scene
  })

  useEffect(() => {
    // The map needs a frame to mount before it can be fitted, and this runs
    // once for the scene the page opened with.
    const timer = window.setTimeout(() => fitBounds(sceneBounds(sceneRef.current)), 350)
    return () => window.clearTimeout(timer)
  }, [fitBounds])

  const updateDrive = useCallback(
    (patch: Partial<DriveState>, preliminary = false) => {
      if (patch.active && !result && !preliminary) return
      if (patch.active) setPreliminaryDrive(preliminary)
      if (
        patch.positionMeters !== undefined ||
        patch.lookAtTargetId !== undefined ||
        patch.lookBearing !== undefined ||
        patch.active
      )
        setRestoreLook({ yaw: 0, tilt: preliminary || preliminaryDrive ? -25 : 0 })
      if (patch.active) {
        setDrawMode('none')
        setDraftCoordinates([])
      }
      setDrive((current) => {
        const entering = patch.active === true && !current.active
        return {
          ...current,
          ...patch,
          // Facing a block replaces facing an arrow's bearing.
          ...(patch.lookAtTargetId ? { lookBearing: null } : {}),
          exaggeration: 1,
          ...(entering && (result || preliminary)
            ? {
                positionMeters:
                  patch.positionMeters ??
                  (scene.viewpoint.id === ROADSIDE_DEMO_ID
                    ? 200
                    : (result?.stations[result.assessmentStationIndex]?.distanceAlongMeters ?? 0)),
                lookAtTargetId: patch.lookAtTargetId ?? null,
                lookBearing: patch.lookAtTargetId ? null : (patch.lookBearing ?? null),
                // The note screenshot look draws no timber; entering keeps it that way.
                forest: !preliminary && !current.reportLook,
              }
            : {}),
        }
      })
      if (patch.positionMeters !== undefined || patch.active) setSeekVersion((version) => version + 1)
    },
    [result, scene.viewpoint.id, preliminaryDrive],
  )

  const setViewpoint = useCallback(
    (viewpoint: Viewpoint) => {
      setScene((current) => ({ ...current, viewpoint }))
      setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
    },
    [setScene],
  )

  const addTarget = useCallback(
    (target: TargetPolygon) => {
      setScene((current) => ({
        ...current,
        targets: [...current.targets, target],
        activeLandformId: target.role === 'landscape' ? target.id : current.activeLandformId,
      }))
      setSelectedTargetId(target.id)
    },
    [setScene],
  )

  const handleMapPoint = useCallback(
    (position: [number, number]) => {
      if (drawMode === 'spot') {
        setScene((current) => ({
          ...current,
          viewpoint: { ...current.viewpoint, mode: 'spot', coordinates: [position] },
        }))
        setDrawMode('none')
        return
      }
      if (drawMode === 'none') return
      setDraftCoordinates((current) => [...current, position])
    },
    [drawMode, setScene],
  )

  const finishDraft = useCallback(() => {
    if (drawMode === 'corridor') {
      if (draftCoordinates.length >= 2) {
        setScene((current) => ({
          ...current,
          viewpoint: { ...current.viewpoint, mode: 'corridor', coordinates: draftCoordinates },
        }))
      }
    } else if (drawMode === 'block' || drawMode === 'landscape') {
      const geometry = ringToPolygon(draftCoordinates)
      if (geometry) {
        addTarget({
          id: createId(drawMode),
          name: drawMode === 'block' ? 'Traced block' : 'Traced landform',
          role: drawMode,
          objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
          vac: null,
          harvestYear: null,
          clearcutPercent: null,
          geometry,
          source: 'Drawn here',
        })
      }
    }
    setDraftCoordinates([])
    setDrawMode('none')
  }, [addTarget, draftCoordinates, drawMode, setScene])

  const handleDrawModeChange = useCallback((mode: DrawMode) => {
    setDrive((current) => ({ ...current, active: false, playing: false }))
    setDraftCoordinates([])
    setDrawMode(mode)
  }, [])

  const handleImportFile = useCallback(
    async (file: File) => {
      setImportMessage('Reading…')
      try {
        const imported = await readShapeFile(file)
        if (imported.polygons.length === 0 && imported.lines.length === 0) {
          setImportMessage(`Could not find any polygons or lines in ${file.name}.`)
          return
        }

        const newTargets: TargetPolygon[] = imported.polygons.map((polygon) => ({
          id: createId('block'),
          name: polygon.name,
          role: 'block' as const,
          objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
          vac: null,
          harvestYear: null,
          clearcutPercent: null,
          geometry: polygon.geometry,
          source: file.name,
          ...(polygon.planning ? { planning: polygon.planning } : {}),
        }))

        // A planning package often carries the road as well as the blocks. The
        // longest line becomes the corridor, but only when none is set yet.
        const longestLine = imported.lines.reduce<(typeof imported.lines)[number] | null>(
          (longest, line) =>
            !longest || lineLengthMeters(line.coordinates) > lineLengthMeters(longest.coordinates) ? line : longest,
          null,
        )

        let usedLine = false
        setScene((current) => {
          const takeLine = longestLine !== null && current.viewpoint.coordinates.length === 0
          usedLine = takeLine
          return {
            ...current,
            targets: [...current.targets, ...newTargets],
            viewpoint: takeLine
              ? {
                  ...current.viewpoint,
                  name: longestLine.name,
                  mode: 'corridor',
                  coordinates: longestLine.coordinates,
                }
              : current.viewpoint,
          }
        })

        if (newTargets.length > 0) setSelectedTargetId(newTargets[0].id)
        const parts = [
          newTargets.length > 0 && `${newTargets.length} polygon${newTargets.length === 1 ? '' : 's'}`,
          usedLine && 'a road centreline',
          imported.skippedCount > 0 && `${imported.skippedCount} skipped`,
        ].filter(Boolean)
        setImportMessage(`Imported ${parts.join(', ')} from ${file.name}.`)

        const bounds = newTargets.length > 0 ? polygonBounds(newTargets[0].geometry) : null
        window.setTimeout(() => fitBounds(bounds as [number, number, number, number] | null), 50)
      } catch (error) {
        setImportMessage(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [fitBounds, setScene],
  )

  /**
   * Asks DataBC what the inventory says about the area on screen. Coverage is
   * patchy, so "nothing here" is a real and common answer rather than a fault.
   */
  const lookupEpoch = useRef(0)
  const handleLookupInventory = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    if (driveRef.current.active) {
      setImportMessage('Return to the plan map before looking up inventory.')
      return
    }
    const epoch = ++lookupEpoch.current
    const sceneAtStart = sceneRef.current
    const view = map.getBounds()
    const bounds = clampQueryBounds([view.getWest(), view.getSouth(), view.getEast(), view.getNorth()])
    setInventory((current) => ({ ...current, status: 'loading', error: null }))
    setShowInventory(true)
    const abort = new AbortController()
    const timer = window.setTimeout(() => abort.abort(), 30000)
    const results = await Promise.allSettled([
      queryVisualInventory(bounds, abort.signal),
      fetchHarvestedAreas(bounds, { signal: abort.signal }),
      fetchCanopyStands(bounds, { signal: abort.signal }),
    ])
    window.clearTimeout(timer)
    if (epoch !== lookupEpoch.current) return
    if (sceneRef.current !== sceneAtStart) {
      setInventory((current) => ({
        ...current,
        status: 'error',
        error: 'Scene changed during lookup. Previous data retained; look up again.',
      }))
      return
    }
    const [units, harvest, stands] = results
    const errors = results.flatMap((r, i) =>
      r.status === 'rejected'
        ? [
            `${['Visual inventory', 'Existing harvest', 'Forest cover'][i]} unavailable: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
          ]
        : [],
    )
    setScene((current) => {
      if (current !== sceneAtStart) return current
      if (harvest.status !== 'fulfilled')
        return {
          ...current,
          harvestInventory: {
            status: 'unavailable',
            bounds,
            source: HARVEST_SOURCE,
            retrievedAt: new Date().toISOString(),
          },
        }
      const kept = current.targets.filter((t) => !(t.role === 'harvested' && t.source === HARVEST_SOURCE))
      return {
        ...current,
        harvestInventory: {
          status: harvest.value.truncated ? 'partial' : 'complete',
          bounds,
          source: HARVEST_SOURCE,
          retrievedAt: new Date().toISOString(),
        },
        targets: [
          ...kept,
          ...harvest.value.areas.map((area) => ({
            id: createId('harvested'),
            name: area.name,
            role: 'harvested' as const,
            objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
            vac: null,
            harvestYear: area.harvestYear,
            clearcutPercent: area.clearcutPercent,
            geometry: area.geometry,
            source: HARVEST_SOURCE,
          })),
        ],
      }
    })
    setInventory((current) => ({
      ...current,
      status: errors.length ? 'error' : 'ready',
      error: errors.length ? errors.join(' · ') + '. Existing data are retained for failed sources.' : null,
      units: units.status === 'fulfilled' ? units.value.units : current.units,
      truncated: results.some((r) => r.status === 'fulfilled' && r.value.truncated),
      harvestCount: harvest.status === 'fulfilled' ? harvest.value.areas.length : current.harvestCount,
      stands: stands.status === 'fulfilled' ? stands.value.stands : current.stands,
    }))
  }, [setScene])

  /** Adopts an inventory polygon as the landform, carrying its rating across. */
  const adoptCandidate = useCallback(
    (unit: BcSensitivityUnit) => {
      setInventory((current) => ({ ...current, units: [...current.units.filter((u) => u.id !== unit.id), unit] }))
      const existing = sceneRef.current.targets.find((t) => t.role === 'landscape' && t.inventoryUnitId === unit.id)
      if (existing) {
        setScene((current) => ({ ...current, activeLandformId: existing.id }))
        setSelectedTargetId(existing.id)
        return
      }
      const objectiveId = unit.objectiveId ?? unit.recommendedId ?? DEFAULT_VISUAL_QUALITY_CLASS_ID
      const label = unit.objectiveId ? 'established' : unit.recommendedId ? 'recommended' : 'unrated'
      const adoptedId = createId('landform')
      addTarget({
        id: adoptedId,
        name: `${unit.name} · ${visualQualityClass(objectiveId).code} (${label})`,
        role: 'landscape',
        objectiveId,
        vac: unit.vac,
        harvestYear: null,
        clearcutPercent: null,
        geometry: unit.geometry,
        source: 'BC visual landscape inventory',
        inventoryUnitId: unit.id,
      })
      setSelectedTargetId(adoptedId)
    },
    [addTarget, setScene],
  )
  const handleAdoptUnit = useCallback(
    (id: string) => {
      const unit = inventory.units.find((entry) => entry.id === id)
      if (unit) adoptCandidate(unit)
    },
    [inventory.units, adoptCandidate],
  )
  // Landforms read from the terrain — the ridge layer and the face, side by
  // side — shown dashed until the reviewer adopts one. The one in front is
  // drawn solid, with its ridge layers.
  const [storedTerrainCandidates, setTerrainCandidates] = useState<TerrainCandidate[]>([])
  const [terrainFocus, setTerrainFocus] = useState<LandformMethod>('ridge-layer')
  // Only while their block is still there as it was read: a candidate for a
  // block since moved, edited or deleted is not one to adopt.
  const terrainCandidates = useMemo(
    () =>
      storedTerrainCandidates.filter(
        (candidate) =>
          scene.targets.find((target) => target.id === candidate.blockId)?.geometry === candidate.blockGeometry,
      ),
    [storedTerrainCandidates, scene.targets],
  )
  const terrainCandidate =
    terrainCandidates.find((candidate) => (candidate.method ?? 'facing') === terrainFocus) ??
    terrainCandidates[0] ??
    null
  const terrainCandidateCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: terrainCandidates.map((candidate) => ({
        type: 'Feature',
        properties: {
          method: candidate.method ?? 'facing',
          selected: candidate === terrainCandidate ? 1 : 0,
        },
        geometry: candidate.geometry,
      })),
    }),
    [terrainCandidates, terrainCandidate],
  )
  // One click on the map for a tool that asked for a point (the landform's vantage).
  const [mapPick, setMapPick] = useState<{ onPoint: (point: [number, number]) => void } | null>(null)
  // The bands of an adopted ridge-layer landform, kept while that landform is
  // in the scene so the road view can drape them.
  const [adoptedRidge, setAdoptedRidge] = useState<{ landformId: string; layers: RidgeLayer[] } | null>(null)
  const adoptedRidgeLayers = useMemo(
    () =>
      adoptedRidge && scene.targets.some((target) => target.id === adoptedRidge.landformId) ? adoptedRidge.layers : [],
    [adoptedRidge, scene.targets],
  )
  // A ridge-layer candidate's other bands, outlined so the stack reads as the road sees it.
  const ridgeLayerCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (terrainCandidate?.layers ?? adoptedRidgeLayers).map((layer, index) => ({
        type: 'Feature',
        properties: { index: index + 1, own: layer.containsBlock ? 1 : 0, area: Math.round(layer.areaHectares) },
        geometry: layer.geometry,
      })),
    }),
    [terrainCandidate, adoptedRidgeLayers],
  )
  // The landform a terrain suggestion replaced, kept until the next scene
  // change so the reviewer can put it back.
  const [replacedLandform, setReplacedLandform] = useState<{ previous: TargetPolygon; adoptedId: string } | null>(null)
  const adoptTerrainCandidate = useCallback(
    (candidate: TerrainCandidate) => {
      // It replaces the landform the reviewer was assessing against — two
      // overlapping landforms of the same colour read as one muddle — and
      // inherits that one's objective and VAC.
      const current = findSceneLandform(sceneRef.current)
      const adopted: TargetPolygon = {
        id: createId('landform'),
        name:
          candidate.method === 'ridge-layer'
            ? `Ridge layer around ${candidate.blockName}`
            : `Terrain landform around ${candidate.blockName}`,
        role: 'landscape',
        objectiveId: current?.objectiveId ?? DEFAULT_VISUAL_QUALITY_CLASS_ID,
        vac: current?.vac ?? null,
        harvestYear: null,
        clearcutPercent: null,
        geometry: candidate.geometry,
        source:
          candidate.method === 'ridge-layer'
            ? `Ridge layer seen from ${candidate.vantageName ?? 'the road'}; review against the view`
            : `Face turned to ${candidate.vantageName ?? 'the road'}, from terrain; review against the view`,
      }
      setScene((scene) => ({
        ...scene,
        targets: [...scene.targets.filter((target) => target.id !== current?.id), adopted],
        activeLandformId: adopted.id,
      }))
      setSelectedTargetId(adopted.id)
      setAdoptedRidge(candidate.layers?.length ? { landformId: adopted.id, layers: candidate.layers } : null)
      setReplacedLandform(current ? { previous: current, adoptedId: adopted.id } : null)
      setTerrainCandidates([])
    },
    [setScene],
  )
  const undoTerrainLandform = useCallback(() => {
    if (!replacedLandform) return
    const { previous, adoptedId } = replacedLandform
    setScene((scene) => ({
      ...scene,
      targets: [...scene.targets.filter((target) => target.id !== adoptedId), previous],
      activeLandformId: previous.id,
    }))
    setSelectedTargetId(previous.id)
    setReplacedLandform(null)
  }, [replacedLandform, setScene])

  const showCandidate = useCallback(
    (unit: BcSensitivityUnit) => {
      setInventory((current) => ({ ...current, units: [...current.units.filter((u) => u.id !== unit.id), unit] }))
      setShowInventory(true)
      fitBounds(polygonBounds(unit.geometry))
    },
    [fitBounds],
  )

  const runForScene = useCallback(
    (nextScene: ForestryScene) => {
      try {
        const input = buildSceneInput(nextScene)
        const nextKey = sceneFingerprint(nextScene)
        if (!nextKey) throw new Error('The scenario contains invalid numeric inputs.')
        runSnapshotRef.current = {
          scene: structuredClone(nextScene),
          inventoryUnits: structuredClone(inventory.units),
          key: nextKey,
        }
        setCameraEye(null)
        setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
        runAnalysis(input)
      } catch (error) {
        setPendingPreview(null)
        setImportMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [runAnalysis, inventory.units],
  )
  const handleRun = useCallback(() => {
    setPendingPreview(null)
    runForScene(scene)
  }, [runForScene, scene])
  const cancelPreview = useCallback(() => {
    setPendingPreview(null)
    cancelAnalysis()
  }, [cancelAnalysis])
  const openPreview = useCallback(
    (view?: SavedDriveView) => {
      const error = previewInputError(scene)
      if (error || !key) {
        setPreviewMessage(error ?? 'Check the scenario geometry.')
        return
      }
      setPreviewMessage(null)
      if (result) {
        updateDrive({ active: true, playing: false, ...(view ?? {}) })
        if (view) setRestoreLook({ yaw: view.yaw, tilt: view.tilt })
      } else {
        setPendingPreview({ key, view })
        runForScene(scene)
      }
    },
    [scene, key, result, updateDrive, runForScene],
  )
  useEffect(() => {
    if (!pendingPreview) return
    if (pendingPreview.key !== key) {
      cancelPreview()
      return
    }
    if (analysis.state.status === 'error') {
      setPendingPreview(null)
      return
    }
    if (!result) return
    updateDrive({ active: true, playing: false, ...(pendingPreview.view ?? {}) })
    if (pendingPreview.view) setRestoreLook({ yaw: pendingPreview.view.yaw, tilt: pendingPreview.view.tilt })
    setPendingPreview(null)
  }, [pendingPreview, key, result, analysis.state.status, updateDrive, cancelPreview])

  /**
   * Replaces the drawn viewpoint with the road it was tracing.
   *
   * A hand-drawn line puts viewing stations wherever the click landed, which in
   * steep ground is often over the bank or in the ditch — and a station in the
   * ditch reports seeing nothing. The road the basemap draws is where a driver
   * actually is.
   */
  const handleSnapToRoad = useCallback(() => {
    const map = mapRef.current
    if (!map || scene.viewpoint.coordinates.length === 0 || driveRef.current.active) return

    const roads = collectRoadsFromMap(map)
    if (roads.length === 0) {
      setSnapMessage('No roads drawn at this zoom. Zoom in until the road shows, then try again.')
      return
    }

    const snapped = snapCorridorToRoad(scene.viewpoint.coordinates, roads)
    if (!snapped) {
      setSnapMessage('Nothing within 250 m of the line. Draw closer to the road, or zoom in.')
      return
    }

    setScene((current) => ({
      ...current,
      viewpoint: {
        ...current.viewpoint,
        name: snapped.road.name,
        mode: 'corridor',
        coordinates: snapped.coordinates,
      },
    }))
    setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
    setSnapMessage(
      `Locked onto ${snapped.road.name} — ${(lineLengthMeters(snapped.coordinates) / 1000).toFixed(2)} km, ` +
        `moved about ${snapped.meanOffsetMeters.toFixed(0)} m.`,
    )
  }, [scene.viewpoint.coordinates, setScene])

  // The block the viewpoint inventory is read around: the selected one, else the first.
  const viewpointBlock =
    scene.targets.find((target) => target.id === selectedTargetId && target.role === 'block') ??
    scene.targets.find((target) => target.role === 'block') ??
    null
  const viewpointCandidates = useMemo<ViewpointCandidate[]>(
    () =>
      viewpointInventory.data && viewpointBlock
        ? viewpointsNearBlock(viewpointBlock.geometry, viewpointInventory.data)
        : [],
    [viewpointInventory.data, viewpointBlock],
  )
  const loadViewpoints = useCallback(async () => {
    const block = viewpointBlock
    if (!block) return
    const [west, south, east, north] = polygonBounds(block.geometry)
    const scale = metersPerDegree((south + north) / 2)
    const padLng = VIEWPOINT_SEARCH_METERS / scale.lng,
      padLat = VIEWPOINT_SEARCH_METERS / scale.lat
    setViewpointInventory((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const data = await fetchViewpointInventory(
        [west - padLng, south - padLat, east + padLng, north + padLat],
        AbortSignal.timeout(30000),
      )
      setViewpointInventory({ status: 'ready', data, error: null, blockId: block.id })
      setShowInventory(true)
    } catch (error) {
      setViewpointInventory((current) => ({
        ...current,
        status: 'error',
        error: `DataBC viewpoints unavailable: ${error instanceof Error ? error.message : String(error)}`,
      }))
    }
  }, [viewpointBlock])

  /** Scores every road on screen by how much of the selected block it can see. */
  const handleRunReverse = useCallback(() => {
    const map = mapRef.current
    if (!map || driveRef.current.active) return

    const selected = scene.targets.find((target) => target.id === selectedTargetId && target.role === 'block')
    const blocks = selected ? [selected] : scene.targets.filter((target) => target.role === 'block')
    if (blocks.length === 0) return

    const roads = collectRoadsFromMap(map)
    reverseRoadsRef.current = roads

    // Inventory viewpoints and rec sites ride along as one-point "roads".
    const points = viewpointCandidates.slice(0, 15).map((candidate) => ({
      id: candidate.key,
      name: candidate.name,
      roadClass: candidate.kind === 'rec-site' ? 'rec-site' : 'vli-viewpoint',
      coordinates: [[candidate.lng, candidate.lat]] as Array<[number, number]>,
    }))
    const input: ReverseInput = {
      blocks: blocks.map((block) => ({ id: block.id, name: block.name, geometry: block.geometry })),
      roads: [
        ...roads.map((road) => ({
          id: road.id,
          name: road.name,
          roadClass: road.roadClass,
          coordinates: road.coordinates,
        })),
        ...points,
      ],
      settings: scene.settings,
    }
    setDrive((current) => ({ ...current, active: false, playing: false }))
    reverseBlocksRef.current = blocks.map((block) => block.id)
    analysis.runReverse(input)
  }, [analysis, scene.settings, scene.targets, selectedTargetId, viewpointCandidates])

  /** Turns one of the ranked roads into the corridor the assessment runs along. */
  /** Makes an inventory viewpoint or rec site the spot the assessment runs from. */
  // Standing at an inventory viewpoint or rec site: the viewpoint becomes a
  // 30 m pullout through it, square to the block, and the road view opens
  // there facing the block. The road it replaced is kept to step back to, and
  // each place's saved views are shelved while you are elsewhere.
  const [standing, setStanding] = useState<{ previous: Viewpoint; name: string; point: [number, number] } | null>(null)
  const [shelvedViews, setShelvedViews] = useState<Array<{ key: string; views: SavedDriveView[] }>>([])
  // Back to a design (or a road) whose views were shelved: they come back.
  useEffect(() => {
    if (!key || saved.key === key) return
    const arriving = shelvedViews.find((entry) => entry.key === key)
    if (!arriving) return
    setShelvedViews((current) => [
      ...current.filter((entry) => entry.key !== key && entry.key !== saved.key),
      ...(saved.key && saved.views.length ? [{ key: saved.key, views: saved.views }] : []),
    ])
    setSaved({ key, views: arriving.views })
  }, [key, saved, shelvedViews])
  // Screenshots taken when views were saved, by view id, for the block note. This session only.
  // Each carries its viewpoint record (design, settings, any lined-up field photo) for the report's
  // per-viewpoint pages.
  const [viewImages, setViewImages] = useState<
    Record<string, NoteImage & { savedAt: number; viewpoint?: Omit<ViewpointPage, 'simulation'> }>
  >({})
  // Where the road view opens after a stand or a step back. Entering the view
  // resets position and facing unless they arrive as a view, as a saved one does.
  const [standRequest, setStandRequest] = useState<{
    serial: number
    positionMeters: number
    lookAtTargetId: string | null
    /** Face this bearing instead of a block: the inventory arrow chosen at a viewpoint. */
    lookBearing?: number | null
  } | null>(null)
  const handledStand = useRef(0)
  useEffect(() => {
    if (!standRequest || standRequest.serial === handledStand.current) return
    handledStand.current = standRequest.serial
    openPreview({
      id: 'stand',
      name: 'Stand',
      positionMeters: standRequest.positionMeters,
      lookAtTargetId: standRequest.lookAtTargetId,
      lookBearing: standRequest.lookBearing ?? null,
      yaw: 0,
      tilt: 0,
      treeHeightMeters: driveRef.current.treeHeightMeters,
      roadClearWidthMeters: driveRef.current.roadClearWidthMeters,
      harvestPhase: driveRef.current.harvestPhase,
    })
  }, [standRequest, openPreview])
  /** Moves to another viewpoint, shelving this one's saved views and restoring the next one's. */
  const moveViewpoint = useCallback(
    (next: Viewpoint) => {
      const nextScene = { ...sceneRef.current, viewpoint: next }
      const nextKey = sceneFingerprint(nextScene)
      const arriving = shelvedViews.find((entry) => entry.key === nextKey)
      setShelvedViews((current) => [
        ...current.filter((entry) => entry.key !== key && entry.key !== nextKey),
        ...(key && savedViews.length ? [{ key, views: savedViews }] : []),
      ])
      if (nextKey && arriving) setSaved({ key: nextKey, views: arriving.views })
      setScene(nextScene)
    },
    [key, savedViews, shelvedViews, setScene],
  )
  const handleUseViewpoint = useCallback(
    /** Stands at an inventory viewpoint, facing the block, or along one of its arrows when given. */
    (candidate: ViewpointCandidate, arrow?: CandidateArrow | null) => {
      const block = viewpointBlock
      const centre = block ? polygonInteriorPoint(block.geometry) : null
      if (!block || !centre) return
      if (!standing)
        setStanding({
          previous: sceneRef.current.viewpoint,
          name: candidate.name,
          point: [candidate.lng, candidate.lat],
        })
      else setStanding({ ...standing, name: candidate.name, point: [candidate.lng, candidate.lat] })
      moveViewpoint({
        id: `stand-${candidate.key}`,
        name: candidate.name,
        mode: 'corridor',
        coordinates: pulloutThrough(candidate, centre),
      })
      setDrive((current) => ({ ...current, active: false, playing: false }))
      setSnapMessage(null)
      setStandRequest((current) => ({
        serial: (current?.serial ?? 0) + 1,
        positionMeters: PULLOUT_METERS / 2,
        lookAtTargetId: arrow ? null : block.id,
        lookBearing: arrow ? arrow.bearing : null,
      }))
    },
    [viewpointBlock, standing, moveViewpoint],
  )
  // Drawing or snapping another road ends the stand; there is nothing to step back to.
  const standingNow = standing && scene.viewpoint.id.startsWith('stand-') ? standing : null
  /** The block note as Excel or PDF: the panel's text, every saved view's screenshot, and the plan map. */
  const exportBlockNote = useCallback(
    async (format: 'xlsx' | 'pdf', parts: BlockNoteParts) => {
      const views = [...shelvedViews.flatMap((entry) => entry.views), ...savedViews]
      const map = mapRef.current
      const block = scene.targets.find((target) => target.id === parts.blockId)
      let planMap: NoteImage | null = null
      const notes = [
        'Terrain: AWS Open Data (CDEM/SRTM), shown at true scale (1×).',
        'Road views: illustrative timber and road surface; satellite imagery © Esri where shown.',
        'A screening assessment, not a completed field VIA.',
      ]
      if (map && block) {
        const bounds = polygonBounds(block.geometry)
        for (const [lng, lat] of scene.viewpoint.coordinates) {
          bounds[0] = Math.min(bounds[0], lng)
          bounds[1] = Math.min(bounds[1], lat)
          bounds[2] = Math.max(bounds[2], lng)
          bounds[3] = Math.max(bounds[3], lat)
        }
        try {
          const image = await capturePlanMap(map as unknown as import('maplibre-gl').Map, bounds)
          planMap = { ...image, caption: `Plan: ${block.name} and ${scene.viewpoint.name || 'the viewpoint'}.` }
        } catch {
          notes.push('The plan map could not be captured.')
        }
      }
      const note: BlockNote = {
        blockName: block?.name ?? 'Block',
        header: parts.header,
        visuals: parts.visuals,
        sentences: parts.sentences,
        landform: parts.landform,
        // In the order they were saved, whichever place they were saved at.
        views: views
          .flatMap((view) => (viewImages[view.id] ? [viewImages[view.id]] : []))
          .sort((a, b) => a.savedAt - b.savedAt),
        missingViews: views.filter((view) => !viewImages[view.id]).map((view) => view.name),
        // A page per view that carries its viewpoint record, in the order saved.
        viewpoints: views
          .flatMap((view) => {
            const image = viewImages[view.id]
            if (!image?.viewpoint) return []
            const { viewpoint, savedAt, ...simulation } = image
            return [{ savedAt, page: { ...viewpoint, simulation } }]
          })
          .sort((a, b) => a.savedAt - b.savedAt)
          .map((entry) => entry.page),
        planMap,
        notes,
        generatedAt: new Date(),
      }
      if (format === 'xlsx') {
        const ExcelJS = await import('exceljs')
        const buffer = await blockNoteWorkbook(note, ExcelJS)
        downloadBlob(
          new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          blockNoteFileName(note, 'xlsx'),
        )
      } else {
        const jspdf = await import('jspdf')
        downloadBlob(new Blob([blockNotePdf(note, jspdf)], { type: 'application/pdf' }), blockNoteFileName(note, 'pdf'))
      }
      return { views: note.views.length, missing: note.missingViews.length, planMap: !!planMap }
    },
    [scene, savedViews, shelvedViews, viewImages],
  )
  /** Back to the road the first stand replaced, at the point on it nearest where you stood. */
  const handleBackToRoad = useCallback(() => {
    if (!standing) return
    const road = standing.previous.coordinates
    const nearest =
      road.length > 1 ? nearestPointOnLine(road, { lng: standing.point[0], lat: standing.point[1] }) : null
    moveViewpoint(standing.previous)
    setStanding(null)
    setDrive((current) => ({ ...current, active: false, playing: false }))
    setStandRequest((current) => ({
      serial: (current?.serial ?? 0) + 1,
      positionMeters: nearest?.distanceAlongMeters ?? 0,
      lookAtTargetId: driveRef.current.lookAtTargetId,
    }))
  }, [standing, moveViewpoint])

  const handleUseRoad = useCallback(
    (roadId: string) => {
      const candidate = viewpointCandidates.find((entry) => entry.key === roadId)
      if (candidate) return handleUseViewpoint(candidate)
      const road = reverseRoadsRef.current.find((entry) => entry.id === roadId)
      if (!road || road.coordinates.length < 2) return

      setScene((current) => ({
        ...current,
        viewpoint: { ...current.viewpoint, name: road.name, mode: 'corridor', coordinates: road.coordinates },
      }))
      setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
      setSnapMessage(`Corridor set to ${road.name}. Run the visibility assessment for the full figures.`)
      fitBounds(
        road.coordinates.reduce<[number, number, number, number]>(
          (box, [lng, lat]) => [
            Math.min(box[0], lng),
            Math.min(box[1], lat),
            Math.max(box[2], lng),
            Math.max(box[3], lat),
          ],
          [Infinity, Infinity, -Infinity, -Infinity],
        ),
      )
    },
    [fitBounds, setScene, viewpointCandidates, handleUseViewpoint],
  )

  const handleZoomToTarget = useCallback(
    (targetId: string) => {
      const target = scene.targets.find((entry) => entry.id === targetId)
      if (target) {
        setDrive((current) => ({ ...current, active: false, playing: false }))
        window.setTimeout(() => fitBounds(targetBounds(target), 14), 50)
      }
    },
    [fitBounds, scene.targets],
  )

  const handleExport = useCallback(() => {
    downloadText(serializeScene(scene), 'forestry-visual-quality-scene.json', 'application/json')
  }, [scene])

  /**
   * Adds the roads the basemap is drawing inside the landform as site
   * disturbance — FS1252 line 2.3.2 (b), which the worksheet otherwise leaves
   * blank. A road is a line, so it is buffered to a right-of-way width; that
   * width is an assumption and is named in the polygon so it travels with it.
   */
  const handleAddRoadDisturbance = useCallback(() => {
    const map = mapRef.current
    const landform = findSceneLandform(scene)
    if (!map || !landform || driveRef.current.active) {
      setSnapMessage('Add a landform first — site disturbance is measured against it.')
      return
    }

    const roads = collectRoadsFromMap(map)
    if (roads.length === 0) {
      setSnapMessage('No roads drawn at this zoom. Zoom in until they show, then try again.')
      return
    }

    // Only the parts inside the landform matter: the figure divides by it.
    const bounds = polygonBounds(landform.geometry)
    const inside = roads.filter((road) =>
      road.coordinates.some(
        ([lng, lat]) => lng >= bounds[0] && lng <= bounds[2] && lat >= bounds[1] && lat <= bounds[3],
      ),
    )
    if (inside.length === 0) {
      setSnapMessage('No roads on screen fall inside the landform.')
      return
    }

    const added = inside.flatMap((road) => {
      const polygon = bufferLine(road.coordinates, ROAD_DISTURBANCE_WIDTH_METERS / 2)
      if (!polygon) return []
      return [
        {
          id: createId('disturbance'),
          name: `${road.name || road.roadClass || 'Road'} — ${ROAD_DISTURBANCE_WIDTH_METERS} m right-of-way`,
          role: 'harvested' as const,
          objectiveId: landform.objectiveId,
          vac: null,
          harvestYear: null,
          clearcutPercent: 100,
          siteDisturbance: true,
          geometry: polygon,
          source: 'Basemap roads',
        },
      ]
    })
    if (added.length === 0) {
      setSnapMessage('Those roads were too short to buffer into polygons.')
      return
    }

    setScene((current) => ({ ...current, targets: [...current.targets, ...added] }))
    setSnapMessage(
      `Added ${added.length} road${added.length === 1 ? '' : 's'} as site disturbance at ${ROAD_DISTURBANCE_WIDTH_METERS} m wide. Run again to count them on line (b).`,
    )
  }, [scene, setScene])

  /** The run written up on FS1252, for somebody to check every figure in. */
  const handleExportReport = useCallback(() => {
    const saved = runSnapshotRef.current
    if (!result || !saved || saved.key !== sceneFingerprint(scene)) return
    const landform = findSceneLandform(saved.scene)
    const unit = landform?.inventoryUnitId
      ? saved.inventoryUnits.find((entry) => entry.id === landform.inventoryUnitId)
      : null
    downloadText(
      buildReport({
        result,
        targets: saved.scene.targets,
        thresholds: saved.scene.thresholds,
        viewpointName: saved.scene.viewpoint.name || 'Unnamed viewpoint',
        generatedAt: new Date(),
        inventorySource: unit ? 'BC visual landscape inventory (DataBC)' : null,
        inventoryUnit: unit ? { polygonNumber: unit.polygonNumber, vsc: unit.vsc, scenicArea: unit.scenicArea } : null,
      }),
      `visual-quality-worksheet-${new Date().toISOString().slice(0, 10)}.md`,
      'text/markdown',
    )
  }, [result, scene])

  const importPreviewGeometry = useCallback(
    async (file: File, kind: 'road' | 'blocks' | 'preview') => {
      setImportMessage('Reading file…')
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error('Use a file smaller than 30 MB.')
        if (kind === 'preview') {
          const restored = parsePreview(JSON.parse(await file.text()))
          if (!restored) throw new Error('Choose a file made with Download preview.')
          cancelPreview()
          setDrive(DEFAULT_DRIVE)
          setCameraEye(null)
          setScene(restored.scene)
          setSaved({ key: sceneFingerprint(restored.scene), views: restored.views })
          setSelectedTargetId(restored.scene.targets.find((t) => t.role === 'block')?.id ?? null)
          setImportMessage(`Opened ${file.name}. Choose Preview drive or a saved comparison.`)
          window.setTimeout(() => fitBounds(sceneBounds(restored.scene)), 50)
          return
        }
        const imported = await readShapeFile(file)
        const road = imported.lines.reduce<(typeof imported.lines)[number] | null>(
          (best, line) =>
            !best || lineLengthMeters(line.coordinates) > lineLengthMeters(best.coordinates) ? line : best,
          null,
        )
        if (kind === 'road' && !road) throw new Error('No road line was found. Use a LineString or a line shapefile.')
        if (kind === 'blocks' && !imported.polygons.length) throw new Error('No cutblock polygons were found.')
        const targets: TargetPolygon[] = imported.polygons.map((p) => ({
          id: createId('block'),
          name: p.name,
          role: 'block',
          objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
          vac: null,
          harvestYear: null,
          clearcutPercent: null,
          geometry: p.geometry,
          source: file.name,
          ...(p.planning ? { planning: p.planning } : {}),
        }))
        const base =
          scene.targets.length &&
          scene.targets.every((t) => t.source === 'Sample scenario' || t.source.startsWith('Illustrative driving demo'))
            ? createEmptyScene()
            : scene
        const next =
          kind === 'road'
            ? {
                ...base,
                viewpoint: {
                  id: createId('road'),
                  name: road!.name,
                  mode: 'corridor' as const,
                  coordinates: road!.coordinates,
                },
              }
            : { ...base, targets: [...base.targets.filter((t) => t.role !== 'block'), ...targets] }
        cancelPreview()
        setScene(next)
        setCameraEye(null)
        if (kind === 'blocks') setSelectedTargetId(targets[0].id)
        setImportMessage(
          kind === 'road'
            ? `Road imported from ${file.name}.${imported.lines.length > 1 ? ' Used the longest line; import a single route to choose another.' : ''}`
            : `${targets.length} cutblocks imported from ${file.name}.`,
        )
        window.setTimeout(() => fitBounds(sceneBounds(next)), 50)
      } catch (error) {
        setImportMessage(`Could not import: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [scene, cancelPreview, setScene, fitBounds],
  )

  const handleLoadSample = useCallback(
    (kind: 'tabor' | 'roadside' | 'purden' = 'tabor', preview = false) => {
      const roadside = kind === 'roadside'
      const sample =
        kind === 'roadside'
          ? createRoadsideDriveScene()
          : kind === 'purden'
            ? createPurdenLakeScene()
            : createSampleScene()
      analysis.reset()
      setTerrainCandidates([])
      setReplacedLandform(null)
      setPendingPreview(null)
      setPreviewMessage(null)
      setScene(sample)
      setSelectedTargetId(sample.targets.find((target) => target.role === 'block')?.id ?? null)
      setDrive({ ...DEFAULT_DRIVE, speedKmh: roadside ? 40 : 60 })
      setCameraEye(null)
      setImportMessage(null)
      window.setTimeout(() => fitBounds(sceneBounds(sample)), 50)
      if (preview) {
        setPendingPreview({ key: sceneFingerprint(sample)! })
        runForScene(sample)
      }
    },
    [analysis, fitBounds, runForScene, setScene],
  )

  const handleClearScene = useCallback(() => {
    analysis.reset()
    setTerrainCandidates([])
    setReplacedLandform(null)
    setPendingPreview(null)
    setPreviewMessage(null)
    setCameraEye(null)
    setScene(createEmptyScene())
    setSelectedTargetId(null)
    setDrive(DEFAULT_DRIVE)
    setImportMessage(null)
    setDrawMode('none')
    setDraftCoordinates([])
  }, [analysis, setScene])

  const blockCollection = useMemo(() => targetsToGeoJson(scene.targets, 'block'), [scene.targets])
  // Haze rings around the eye, redrawn when it has moved about 50 m.
  const hazeCentre =
    drive.active && drive.haze && cameraEye
      ? `${(Math.round(cameraEye.lng * 2000) / 2000).toFixed(4)},${(Math.round(cameraEye.lat * 2000) / 2000).toFixed(4)}`
      : null
  const hazeCollection = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!hazeCentre) return EMPTY_COLLECTION
    const [lng, lat] = hazeCentre.split(',').map(Number)
    return hazeRings({ lng, lat })
  }, [hazeCentre])
  // The established VQO polygons around the scene, coloured by class when the
  // road view drapes them. Read from the inventory only once switched on.
  // The plan map and the road view each drape EVQO by their own switch; either one loads it.
  const showEvqo = planShow.evqo || (drive.active && drive.showEvqo)
  const evqoKey = useMemo(() => {
    if (!showEvqo) return null
    const bounds = sceneBounds(scene)
    return bounds
      ? [bounds[0] - 0.08, bounds[1] - 0.05, bounds[2] + 0.08, bounds[3] + 0.05].map((v) => v.toFixed(3)).join(',')
      : null
  }, [showEvqo, scene])
  const [evqoDisplay, setEvqoDisplay] = useState<{
    key: string
    collection: GeoJSON.FeatureCollection
    error: string | null
  } | null>(null)
  useEffect(() => {
    if (!evqoKey || evqoDisplay?.key === evqoKey) return
    const abort = new AbortController()
    const bounds = evqoKey.split(',').map(Number) as [number, number, number, number]
    queryVisualInventory(bounds, abort.signal)
      .then(({ units }) => {
        if (abort.signal.aborted) return
        setEvqoDisplay({
          key: evqoKey,
          error: null,
          collection: {
            type: 'FeatureCollection',
            features: units.flatMap((unit) =>
              unit.objectiveId
                ? [
                    {
                      type: 'Feature' as const,
                      id: unit.id,
                      geometry: unit.geometry,
                      properties: { id: unit.id, code: EVQO_CODE_FOR_CLASS[unit.objectiveId] },
                    },
                  ]
                : [],
            ),
          },
        })
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          setEvqoDisplay({
            key: evqoKey,
            error: error instanceof Error ? error.message : String(error),
            collection: { type: 'FeatureCollection', features: [] },
          })
      })
    return () => abort.abort()
  }, [evqoKey, evqoDisplay?.key])
  const landscapeCollection = useMemo(() => targetsToGeoJson(scene.targets, 'landscape'), [scene.targets])
  const harvestedCollection = useMemo(() => targetsToGeoJson(scene.targets, 'harvested'), [scene.targets])
  const corridorCollection = useMemo(
    () =>
      scene.viewpoint.mode === 'corridor'
        ? draftLineToGeoJson(scene.viewpoint.coordinates)
        : { type: 'FeatureCollection' as const, features: [] },
    [scene.viewpoint],
  )
  const spotCollection = useMemo(
    () =>
      scene.viewpoint.mode === 'spot'
        ? pointsToGeoJson(scene.viewpoint.coordinates, { kind: 'viewpoint' })
        : { type: 'FeatureCollection' as const, features: [] },
    [scene.viewpoint],
  )
  const draftLine = useMemo(() => draftLineToGeoJson(draftCoordinates), [draftCoordinates])
  const draftVertices = useMemo(() => pointsToGeoJson(draftCoordinates), [draftCoordinates])
  const stationCollection = useMemo(() => stationsToGeoJson(result), [result])
  const landformClues = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (result?.landformDesign?.markers ?? []).map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { position: p.position },
      })),
    }),
    [result],
  )
  const inventoryCollection = useMemo(() => unitsToGeoJson(inventory.units), [inventory.units])
  // The reverse run scores roads and inventory viewpoints together; each panel shows its own.
  const reverseForRoads = useMemo(() => {
    const state = analysis.reverseState
    return state.result
      ? {
          ...state,
          result: {
            ...state.result,
            roads: state.result.roads.filter((road) => !VIEWPOINT_ROAD_CLASSES.has(road.roadClass ?? '')),
          },
        }
      : state
  }, [analysis.reverseState])
  // A visibility run resets the shared worker's reverse state, so the viewpoint
  // rows are kept here, with the block they were checked against, until the next check.
  const [viewpointChecks, setViewpointChecks] = useState<{
    source: unknown
    blockIds: string[]
    rows: ReadonlyMap<string, ReverseRoadResult>
  }>({ source: null, blockIds: [], rows: new globalThis.Map() })
  const reverseResult = analysis.reverseState.result
  if (reverseResult && reverseResult !== viewpointChecks.source) {
    const rows = reverseResult.roads.filter((road) => VIEWPOINT_ROAD_CLASSES.has(road.roadClass ?? ''))
    // `Map` here is the map component; the collection is the global one.
    setViewpointChecks({
      source: reverseResult,
      blockIds: rows.length ? reverseBlocksRef.current : viewpointChecks.blockIds,
      rows: rows.length ? new globalThis.Map(rows.map((road) => [road.roadId, road])) : viewpointChecks.rows,
    })
  }
  const reverseViewpointRows = viewpointChecks.rows
  // Inventory viewpoints the block is in view from, for the Visuals paragraph: the two that see most.
  const inventoryFindings = useMemo<ViewpointFinding[]>(() => {
    if (viewpointChecks.blockIds.length !== 1) return []
    // A point standing on the run's own road only repeats "from the road".
    const road = scene.viewpoint.coordinates
    const kindOf = (key: string) => viewpointCandidates.find((entry) => entry.key === key)
    const rank = (row: ReverseRoadResult) =>
      row.roadClass === 'rec-site' ? 0 : kindOf(row.roadId)?.name.includes('major') ? 1 : 2
    return [...reverseViewpointRows.values()]
      .filter((row) => row.maxVisiblePercent > 0)
      .filter((row) => {
        const candidate = kindOf(row.roadId)
        if (!candidate || road.length === 0) return true
        return (nearestPointOnLine(road, candidate)?.offsetMeters ?? Infinity) > INVENTORY_POINT_ON_ROAD_METERS
      })
      .sort((a, b) => rank(a) - rank(b) || b.maxVisiblePercent - a.maxVisiblePercent)
      .slice(0, 2)
      .map((row) => {
        const visible = row.maxVisiblePercent / 100,
          screened = row.screenedPercentAtMax / 100
        return {
          name: row.name,
          kind: row.roadClass === 'rec-site' ? ('rec-site' as const) : ('viewpoint' as const),
          shares: { visible, screened, hidden: Math.max(0, 1 - visible - screened), unknown: 0 },
          elevationAngleDegrees: row.elevationAngleAtMax,
          // The reverse check reads bare earth only.
          screeningModelled: false,
        }
      })
  }, [reverseViewpointRows, viewpointChecks.blockIds, viewpointCandidates, scene.viewpoint.coordinates])
  const viewpointLayers = useMemo(() => {
    const data = viewpointInventory.data
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    if (!data) return { points: empty, arrows: empty, screenings: empty }
    return {
      points: {
        type: 'FeatureCollection',
        features: [
          ...data.viewpoints.map((viewpoint) => ({
            type: 'Feature' as const,
            id: `vli:${viewpoint.id}`,
            properties: {
              id: `vli:${viewpoint.id}`,
              kind: 'vli',
              name: viewpoint.typeLabel + (viewpoint.number !== null ? ` ${viewpoint.number}` : ''),
            },
            geometry: { type: 'Point' as const, coordinates: [viewpoint.lng, viewpoint.lat] },
          })),
          ...data.recSites.map((site) => ({
            type: 'Feature' as const,
            id: `rec:${site.id}`,
            properties: { id: `rec:${site.id}`, kind: 'rec-site', name: site.name },
            geometry: { type: 'Point' as const, coordinates: [site.lng, site.lat] },
          })),
        ],
      } satisfies GeoJSON.FeatureCollection,
      arrows: {
        type: 'FeatureCollection',
        features: data.arrows.map((arrow) => ({
          type: 'Feature' as const,
          id: `arrow:${arrow.id}`,
          properties: {
            id: `arrow:${arrow.id}`,
            arrowId: arrow.id,
            viewpoint: `vli:${arrow.viewpointId}`,
            size: arrow.size,
            bearing: Math.round(arrow.bearing),
          },
          geometry: arrow.geometry,
        })),
      } satisfies GeoJSON.FeatureCollection,
      screenings: {
        type: 'FeatureCollection',
        features: data.screenings.map((screening) => ({
          type: 'Feature' as const,
          id: `screen:${screening.id}`,
          properties: { id: `screen:${screening.id}`, type: screening.type ?? '' },
          geometry: screening.geometry,
        })),
      } satisfies GeoJSON.FeatureCollection,
    }
  }, [viewpointInventory.data])
  // The inventory viewpoint stood at, if any: its arrows drape in the road
  // view, the one faced drawn solid, and the sidebar offers each as a direction.
  const standingCandidate = standingNow
    ? (viewpointCandidates.find((candidate) => `stand-${candidate.key}` === scene.viewpoint.id) ?? null)
    : null
  const standingArrows = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!standingCandidate?.arrows.length) return EMPTY_COLLECTION
    const faced = standingCandidate.arrows.find(
      (arrow) => drive.lookBearing !== null && Math.abs(arrow.bearing - drive.lookBearing) < 0.5,
    )
    return {
      type: 'FeatureCollection',
      features: viewpointLayers.arrows.features
        .filter((feature) => feature.properties?.viewpoint === standingCandidate.key)
        .map((feature) => ({
          ...feature,
          properties: { ...feature.properties, faced: feature.properties?.arrowId === faced?.id ? 1 : 0 },
        })),
    }
  }, [standingCandidate, viewpointLayers.arrows, drive.lookBearing])
  // Facing an arrow, the viewing gap opens the timber along it, as it would toward a block.
  const facedArrowGeometry =
    (standingArrows.features.find((feature) => feature.properties?.faced === 1)?.geometry as
      | GeoJSON.Polygon
      | undefined) ?? null
  const viewpointHoverHtml = useCallback((properties: Record<string, unknown>) => {
    const kind = properties.kind === 'rec-site' ? 'Recreation site' : 'VLI viewpoint'
    return mapTooltipHtml({ title: String(properties.name ?? kind), subtitle: kind, footer: 'Click to stand here' })
  }, [])
  const reverseRoadCollection = useMemo(
    () => reverseRoadsToGeoJson(analysis.reverseState.result),
    [analysis.reverseState.result],
  )
  // The road graded by what it sees, rather than the stations it was sampled at.
  const corridorExposureCollection = useMemo(
    () => corridorExposureToGeoJson(result, selectedTargetId),
    [result, selectedTargetId],
  )

  // Where the eye is on the road. The map's centre is no use for this: pitched
  // at the horizon from ground level, it sits kilometres out at the skyline.
  const driveEye = useMemo(() => {
    if (drive.active && cameraEye) return cameraEye
    const station = result?.stations[driveStationIndex]
    return station ? { lng: station.lng, lat: station.lat } : null
  }, [cameraEye, drive.active, driveStationIndex, result])

  const routeViewshed = useRouteViewshed(
    scene.viewpoint.coordinates,
    drive.positionMeters,
    drive.active && drive.playing,
    scene.settings.observerHeightMeters,
  )
  const routeOutline = useMemo(
    () => visibilityOutline(routeViewshed.analysis.overlayResult, 'standing'),
    [routeViewshed.analysis.overlayResult],
  )
  const preliminaryStations = useMemo(
    () =>
      sampleAlongLine(scene.viewpoint.coordinates, 50, 400).map((station) => ({
        ...station,
        groundElevationMeters: NaN,
      })),
    [scene.viewpoint.coordinates],
  )
  const activeStations = preliminaryDrive ? preliminaryStations : (result?.stations ?? preliminaryStations)
  const activeRouteLength = preliminaryDrive ? routeViewshed.length : (result?.corridorLengthMeters ?? 0)
  useEffect(() => {
    if (!drive.active) setPreliminaryDrive(false)
  }, [drive.active])
  const previewPolygons = useMemo(
    () => (preliminaryDrive ? [] : scene.targets.map((target) => target.geometry)),
    [scene.targets, preliminaryDrive],
  )
  const preparePreview = drive.active || !!pendingPreview || !!result
  const previewTerrain = useDriveTerrain(preparePreview, scene.viewpoint.coordinates, previewPolygons)
  // A street-level field photo to line the road view up with (handbook 3.2, 3.3.4).
  const fieldPhoto = useFieldPhoto({
    scene,
    result,
    ground: previewTerrain.source,
    eyeHeightMeters: result?.settings.observerHeightMeters ?? 1.6,
  })
  // The comparison holds the view on the photo's pose, so it ends when the
  // drive plays on or is closed.
  if (fieldPhoto.match && (drive.playing || (!drive.active && !pendingPreview && analysis.state.status !== 'running')))
    fieldPhoto.setMatch(null)
  const photoLook = drive.active ? fieldPhoto.look : null
  const [lookBearing, setLookBearing] = useState(0)
  const [viewerFov, setViewerFov] = useState(60)
  // The road view's viewer on the plan: the viewing station (the pose's ground position, never the
  // eye map's centre, which sits on the skyline), to about 10 m, so the plan redraws a few times a
  // second while driving rather than every frame.
  const viewerKey = drive.active && cameraEye ? `${cameraEye.lng.toFixed(4)},${cameraEye.lat.toFixed(4)}` : null
  const planViewer = useMemo<MapViewer | null>(() => {
    if (!viewerKey) return null
    const [lng, lat] = viewerKey.split(',').map(Number)
    return { lng, lat, bearing: lookBearing, fovDegrees: viewerFov }
  }, [viewerKey, lookBearing, viewerFov])
  const lineUpPhoto = (image: MapillaryImage | null = fieldPhoto.image) => {
    const onRoad =
      image && scene.viewpoint.coordinates.length > 1 ? nearestPointOnLine(scene.viewpoint.coordinates, image) : null
    if (!image || !onRoad) return
    fieldPhoto.setMatch(fieldPhoto.startMatch(image))
    openPreview({
      id: 'field-photo',
      name: 'Field photo',
      positionMeters: onRoad.distanceAlongMeters,
      lookAtTargetId: null,
      yaw: 0,
      tilt: 0,
      treeHeightMeters: drive.treeHeightMeters,
      roadClearWidthMeters: drive.roadClearWidthMeters,
      harvestPhase: 'before',
    })
  }
  const liveForest = useForestHistory(
    preparePreview && !preliminaryDrive && drive.existingForest,
    scene.viewpoint.coordinates,
    previewPolygons,
    drive.playing,
  )
  const visualYear = scene.assessmentYear ?? new Date().getFullYear()
  const regrowth = useMemo(() => {
    const supplied: ForestHistoryRecord[] = scene.targets
      .filter((t) => t.role === 'harvested' && !t.siteDisturbance)
      .map((t) => ({
        id: `scene-${t.id}`,
        kind: 'harvest',
        geometry: t.geometry,
        year: t.harvestYear,
        clearcutPercent: t.clearcutPercent,
        heightMeters: null,
        speciesCode: null,
      }))
    return buildRegrowthStands([...supplied, ...(liveForest.data?.records ?? [])], {
      year: visualYear,
      growthMetersPerYear: drive.growthMetersPerYear,
      regenerationLagYears: drive.regenerationLagYears,
      matureHeightMeters: drive.treeHeightMeters,
      projectRecordedHeights: drive.projectRecordedHeights,
    })
  }, [
    scene.targets,
    liveForest.data,
    visualYear,
    drive.growthMetersPerYear,
    drive.regenerationLagYears,
    drive.treeHeightMeters,
    drive.projectRecordedHeights,
  ])

  // The road's cut bank and fill slope, bare ground either side of it on a
  // side slope (`roadScar`). Display only.
  const previewRoadScar = useMemo(() => {
    const ground = previewTerrain.source
    if (scene.viewpoint.mode !== 'corridor' || !ground || scene.viewpoint.coordinates.length < 2) return []
    return roadScar(
      scene.viewpoint.coordinates as Array<[number, number]>,
      (lng, lat) => ground.elevationAt(lng, lat),
      { roadWidthMeters: 2 * Math.min(8, drive.roadClearWidthMeters / 2) },
    )
  }, [scene.viewpoint.mode, scene.viewpoint.coordinates, previewTerrain.source, drive.roadClearWidthMeters])
  const previewRoadScarCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: previewRoadScar.map((strip) => ({
        type: 'Feature',
        properties: { kind: strip.kind },
        geometry: strip.geometry,
      })),
    }),
    [previewRoadScar],
  )

  const previewRoad = useMemo<GeoJSON.FeatureCollection>(() => {
    const shape = bufferLine(scene.viewpoint.coordinates, Math.min(8, drive.roadClearWidthMeters / 2))
    return { type: 'FeatureCollection', features: shape ? [{ type: 'Feature', properties: {}, geometry: shape }] : [] }
  }, [scene.viewpoint.coordinates, drive.roadClearWidthMeters])

  // Timber fills the view and the openings take it off. Not the landform: that
  // is an assessment unit drawn around a hill, not a stand boundary, and the
  // road an assessment is written from is usually outside it.
  const forestStands = useMemo<GeoJSON.Polygon[]>(() => [], [])
  // What the province recorded on this ground, reduced to what the drawing
  // needs. Coverage is managed openings only, so most of a view falls through
  // to the regional mix — which is why the panel reports how much did not.
  const forestInventory = useMemo<InventoryStand[]>(
    () => [
      ...regrowth.stands,
      ...(result?.renderStands ?? inventory.stands).map((stand) => ({
        geometry: stand.geometry,
        species: speciesFromCode(stand.speciesCode),
        heightMeters: stand.heightMeters > 0 ? stand.heightMeters : null,
        crownClosurePercent: stand.crownClosurePercent,
        stemsPerHa: 'stemsPerHa' in stand ? stand.stemsPerHa : null,
        // The stand's whole recorded composition, so a mixed stand is drawn mixed.
        speciesMix:
          'speciesComposition' in stand && stand.speciesComposition
            ? speciesMixFromInventory(
                stand.speciesComposition.map((entry) => ({
                  code: entry.code,
                  percent: entry.percent,
                  heightMeters: entry.heightMeters,
                })),
              )
            : undefined,
      })),
      // Lakes, rock, meadow and shrub the inventory recorded: no regional mix
      // is grown on them.
      ...(result?.renderCover ?? []).map((ground) => ({
        geometry: ground.geometry,
        species: null,
        heightMeters: null,
        cover: ground.cover,
      })),
    ],
    [regrowth.stands, inventory.stands, result?.renderStands, result?.renderCover],
  )

  const clipAlteration = useMemo(() => assessmentAlterationClipper(scene.masks ?? []), [scene.masks])
  const previewBlockCollection = useMemo(
    () =>
      targetsToGeoJson(
        scene.targets.flatMap((target) => {
          if (target.role !== 'block') return []
          const geometry = clipAlteration(target.geometry)
          return geometry ? [{ ...target, geometry }] : []
        }),
        'block',
      ),
    [scene.targets, clipAlteration],
  )

  // Retention and partial-cut blocks are thinned in the road view, not cleared.
  const forestThinnings = useMemo(
    () =>
      drive.harvestPhase === 'after'
        ? scene.targets.flatMap((target) => {
            const thinning = target.role === 'block' ? blockThinning(target) : null
            const geometry = thinning ? clipAlteration(thinning.geometry) : null
            return thinning && geometry ? [{ ...thinning, geometry }] : []
          })
        : [],
    [drive.harvestPhase, scene.targets, clipAlteration],
  )

  // Ground actually cut: the block after harvest, and disturbance still counting.
  const forestOpenings = useMemo<Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>>(
    () =>
      scene.targets
        .filter(
          (target) =>
            (target.role === 'block' && drive.harvestPhase === 'after' && !blockThinning(target)) ||
            (target.role === 'harvested' &&
              target.siteDisturbance &&
              alterationWeight(
                target,
                result?.inputSnapshot?.assessmentYear ?? scene.assessmentYear ?? new Date().getFullYear(),
                scene.settings.greenUpAgeYears,
              ) >= 1),
        )
        .flatMap((target) => {
          const geometry = clipAlteration(target.geometry)
          return geometry ? [geometry] : []
        }),
    [drive.harvestPhase, scene.targets, scene.assessmentYear, scene.settings.greenUpAgeYears, result, clipAlteration],
  )

  const forestClearings = useMemo(() => {
    const openings = forestOpenings

    // The road is a clearing too. Without it the camera stands inside the timber
    // and the drive shows a trunk, which is not what a road looks like.
    const corridor =
      scene.viewpoint.mode === 'corridor'
        ? bufferLine(scene.viewpoint.coordinates, drive.roadClearWidthMeters / 2)
        : null
    return [
      ...openings,
      ...basemap.water,
      ...(scene.masks ?? []).filter((m) => m.kind === 'natural').map((m) => m.geometry),
      ...(corridor ? [corridor] : []),
      // A fresh cut bank or fill slope grows no timber.
      ...previewRoadScar.map((strip) => strip.geometry),
    ]
  }, [forestOpenings, drive.roadClearWidthMeters, scene.viewpoint, scene.masks, basemap.water, previewRoadScar])

  const forestConfiguration = useMemo(
    () => ({
      anchorLatitude: scene.viewpoint.coordinates[0]?.[1],
      stands: forestStands,
      clearings: forestClearings,
      openings: forestOpenings,
      thinnings: forestThinnings,
      standHeightMeters: drive.treeHeightMeters,
      inventory: forestInventory,
      style:
        drive.quality === 'fast'
          ? ('billboard' as const)
          : drive.quality === 'detailed'
            ? ('hybrid' as const)
            : drive.treeStyle,
      look: drive.treeLook,
      // Faster means cards only, stopped or not.
      detailRadiusMeters: drive.quality === 'fast' ? 0 : drive.detailRadiusMeters,
      elevation: previewTerrain.source,
      farRadiusMeters: previewTerrain.radius,
    }),
    [
      scene.viewpoint.coordinates,
      forestStands,
      forestClearings,
      forestOpenings,
      forestThinnings,
      drive.treeHeightMeters,
      forestInventory,
      drive.quality,
      drive.treeStyle,
      drive.treeLook,
      drive.detailRadiusMeters,
      previewTerrain.source,
      previewTerrain.radius,
    ],
  )
  const currentForestStatus = forestStatus?.configuration === forestConfiguration ? forestStatus : null

  // Harvested ground in the road view: bare soil under a clearcut; under
  // retention or a partial cut, disturbed but still vegetated forest floor.
  const harvestedGroundColor = useMemo(() => {
    const thinned = scene.targets
      .filter((target) => target.role === 'block' && blockThinning(target))
      .map((target) => target.id)
    return thinned.length ? ['match', ['get', 'id'], thinned, '#6f6a4b', '#b69a70'] : '#b69a70'
  }, [scene.targets])

  // From across a valley the ground between crowns is shaded forest floor, not
  // the pale basemap. However far out the cards thin, the stand's ground is
  // drawn dark where the stand is, bare soil in its clearings, water as water.
  // Water is drawn whenever the road view is open, timber or not: a lake is a
  // lake. Floor and soil are the drawn stand's ground, so they go with it.
  const forestGround = useMemo(() => {
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    const bounds = sceneBounds(scene)
    if (!drive.active || !bounds) return { floor: empty, soil: empty, water: empty, cover: empty }
    const padLat = previewTerrain.radius / 111_320
    const padLng = padLat / Math.max(0.2, Math.cos((((bounds[1] + bounds[3]) / 2) * Math.PI) / 180))
    const [w, s, e, n] = [bounds[0] - padLng, bounds[1] - padLat, bounds[2] + padLng, bounds[3] + padLat]
    const feature = (geometry: GeoJSON.Geometry): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry })
    return {
      floor: {
        type: 'FeatureCollection',
        features: [
          feature({
            type: 'Polygon',
            coordinates: [
              [
                [w, s],
                [e, s],
                [e, n],
                [w, n],
                [w, s],
              ],
            ],
          }),
        ],
      } as GeoJSON.FeatureCollection,
      // Soil on cut ground only. The road clearing is a viewing aid, not a
      // cutblock: widened to see past the roadside timber it stays forest floor.
      soil: { type: 'FeatureCollection', features: forestOpenings.map(feature) } as GeoJSON.FeatureCollection,
      water: { type: 'FeatureCollection', features: basemap.water.map(feature) } as GeoJSON.FeatureCollection,
      // Non-forest ground the inventory recorded — meadow, rock, wetland,
      // shrub, and water the basemap may not carry — in its own colour, so an
      // open slope reads as open ground rather than as dark forest floor.
      cover: {
        type: 'FeatureCollection',
        features: (result?.renderCover ?? []).map((ground) => ({
          type: 'Feature',
          properties: { cover: ground.cover },
          geometry: ground.geometry,
        })),
      } as GeoJSON.FeatureCollection,
    }
  }, [drive.active, scene, previewTerrain.radius, forestOpenings, basemap.water, result?.renderCover])

  // On the map, show what the whole road can see. Driving narrows it to the one
  // point the camera is standing at, which is the thing worth watching change.
  // The plan shows what any station sees; the road view what its own station sees.
  const sampleCollection = useMemo(() => samplesToGeoJson(result, { stationIndex: null }), [result])
  const eyeSampleCollection = useMemo(
    () => (drive.active ? samplesToGeoJson(result, { stationIndex: driveStationIndex }) : EMPTY_COLLECTION),
    [driveStationIndex, drive.active, result],
  )

  const lookAtTarget = useMemo(() => {
    // Facing an arrow: a point 5 km out along its bearing, level with the eye.
    if (!drive.lookAtTargetId && drive.lookBearing !== null && result?.stations.length) {
      const station = result.stations[Math.min(driveStationIndex, result.stations.length - 1)]
      const radians = (drive.lookBearing * Math.PI) / 180
      const scale = metersPerDegree(station.lat)
      return {
        lng: station.lng + (Math.sin(radians) * 5000) / scale.lng,
        lat: station.lat + (Math.cos(radians) * 5000) / scale.lat,
        elevationMeters: station.groundElevationMeters + result.settings.observerHeightMeters,
      }
    }
    if (!drive.lookAtTargetId || !result) return null
    const target = result.targets.find((entry) => entry.targetId === drive.lookAtTargetId)
    if (!target || target.sampleCount === 0) return null

    let lngTotal = 0
    let latTotal = 0
    let elevationTotal = 0
    let counted = 0
    for (let index = 0; index < target.sampleCount; index += 1) {
      lngTotal += target.positions[index * 2]
      latTotal += target.positions[index * 2 + 1]
      const elevation = target.elevations[index]
      if (Number.isFinite(elevation)) {
        elevationTotal += elevation
        counted += 1
      }
    }
    if (counted === 0) return null
    return {
      lng: lngTotal / target.sampleCount,
      lat: latTotal / target.sampleCount,
      elevationMeters: counted > 0 ? elevationTotal / counted : 0,
    }
  }, [drive.lookAtTargetId, drive.lookBearing, driveStationIndex, result])

  // A spot viewpoint has no direction of travel, so it faces the first block.
  const spotBearing = useMemo(() => {
    if (!result || result.stations.length === 0) return 0
    const block = result.targets.find((target) => target.role === 'block' && target.sampleCount > 0)
    if (!block) return 0
    return bearingDegrees(result.stations[0], {
      lng: block.positions[0],
      lat: block.positions[1],
    })
  }, [result])

  const inventoryHoverHtml = useCallback((properties: Record<string, unknown>) => {
    const objective = String(properties.objectiveId ?? '')
    const vac = String(properties.vac ?? '')
    const vsc = String(properties.vsc ?? '')
    return mapTooltipHtml({
      title: String(properties.name ?? 'Sensitivity unit'),
      subtitle: Number(properties.scenicArea) === 1 ? 'Scenic area' : undefined,
      rows: [
        ['Objective', objective ? visualQualityClass(objective as never).label : 'None established'],
        ['VAC', vac || 'Not rated'],
        ['Sensitivity class', vsc || null],
      ],
      footer: 'Click to use as the landform',
    })
  }, [])

  const targetHoverHtml = useCallback(
    (properties: Record<string, unknown>) =>
      mapTooltipHtml({
        title: String(properties.name ?? 'Polygon'),
        subtitle: `${Number(properties.areaHectares ?? 0).toFixed(1)} ha`,
      }),
    [],
  )

  const handleTargetChange = useCallback(
    (targetId: string, patch: Partial<TargetPolygon>) => {
      setScene((current) => ({
        ...current,
        targets: current.targets.map((target) => (target.id === targetId ? { ...target, ...patch } : target)),
        // A target re-roled to a landform becomes the active one; the active landform re-roled to anything else is dropped.
        activeLandformId:
          patch.role === 'landscape'
            ? targetId
            : current.activeLandformId === targetId && patch.role
              ? null
              : current.activeLandformId,
      }))
    },
    [setScene],
  )

  const handleRemoveTarget = useCallback(
    (targetId: string) => {
      setScene((current) => ({
        ...current,
        targets: current.targets.filter((target) => target.id !== targetId),
        activeLandformId: current.activeLandformId === targetId ? null : current.activeLandformId,
      }))
      setSelectedTargetId((current) => (current === targetId ? null : current))
    },
    [setScene],
  )

  const stops = useMemo(
    () => candidateDriveViews(result, drive.lookAtTargetId ?? selectedTargetId),
    [result, drive.lookAtTargetId, selectedTargetId],
  )
  const exposureTarget =
    result?.targets.find((t) => t.targetId === (drive.lookAtTargetId ?? selectedTargetId) && t.role === 'block') ??
    result?.targets.find((t) => t.role === 'block')
  const currentExposure = exposureTarget?.stations[driveStationIndex]
  const exposureName = scene.targets.find((target) => target.id === exposureTarget?.targetId)?.name ?? 'the block'
  const summaryControls = useViewpointSummaryPreferences()
  const summaryStation = drive.active && !preliminaryDrive ? driveStationIndex : (result?.assessmentStationIndex ?? 0)
  const summaryUnit = sceneLandform?.inventoryUnitId
    ? inventory.units.find((unit) => unit.id === sceneLandform.inventoryUnitId)
    : undefined
  const objectiveSource: 'established' | 'recommended' | 'chosen' = !sceneLandform?.inventoryUnitId
    ? 'chosen'
    : summaryUnit
      ? summaryUnit.objectiveId === sceneLandform.objectiveId
        ? 'established'
        : summaryUnit.recommendedId === sceneLandform.objectiveId
          ? 'recommended'
          : 'chosen'
      : // The adopted name records the inventory's word when the units are not loaded this session.
        ((/\((established|recommended)\)$/.exec(sceneLandform.name)?.[1] as
          | 'established'
          | 'recommended'
          | undefined) ?? 'chosen')
  const summaryMetrics = useMemo(
    () =>
      result
        ? viewpointSummaryMetrics({
            result,
            stationIndex: summaryStation,
            driving: drive.active && !preliminaryDrive,
            viewpointName: standingNow ? `Standing at ${standingNow.name}` : scene.viewpoint.name,
            block: exposureTarget ? { targetId: exposureTarget.targetId, name: exposureName } : null,
            landform: sceneLandform ?? null,
            objectiveSource,
            thresholds: scene.thresholds,
            via: viaAssessment,
          })
        : [],
    [
      result,
      summaryStation,
      drive.active,
      preliminaryDrive,
      standingNow,
      scene.viewpoint.name,
      exposureTarget,
      exposureName,
      sceneLandform,
      objectiveSource,
      scene.thresholds,
      viaAssessment,
    ],
  )
  const canSaveView =
    !preliminaryDrive &&
    drive.active &&
    !liveForest.loading &&
    !liveForest.pendingUpdate &&
    cameraStatus === 'ready' &&
    // Without drawn timber (the note screenshot look) there is no forest to wait for.
    (!drive.forest || (!!currentForestStatus?.ready && !currentForestStatus.error))
  /** "View from Hwy 97 going north." — the caption a planning note puts under the screenshot. */
  const captionForView = (lookBearing: number | null) => {
    const coordinates = scene.viewpoint.coordinates
    // A stood-at viewpoint's 30 m pullout is one spot, not a road driven along.
    const corridor =
      scene.viewpoint.mode === 'corridor' &&
      coordinates.length > 1 &&
      lineLengthMeters(coordinates) > 2 * PULLOUT_METERS
    let travel: number | null = null
    if (corridor)
      try {
        travel = roadPlacement(roadPath(coordinates), drive.positionMeters)?.travelBearing ?? null
      } catch {
        travel = null
      }
    const target = scene.targets.find((entry) => entry.id === drive.lookAtTargetId)
    return viewCaption({
      viewpointName: scene.viewpoint.name || (corridor ? 'the road' : 'the viewpoint'),
      linear: corridor,
      travelBearing: travel,
      lookBearing,
      targetNames: target ? [target.name] : [],
    })
  }
  const saveView = () => {
    if (!canSaveView) return
    if (savedViews.length >= 12) {
      setPreviewMessage('Twelve comparisons are saved. Remove one or download this preview before starting another.')
      return
    }
    // Which saved design alternative this is, so the report can set it beside the same view under another.
    const design = matchingDesign(scene, tools.designOptions)
    const view: SavedDriveView = {
      id: createId('view'),
      ...(design ? { designName: design.name } : {}),
      // The caption without its full stop: it is also the option label "… · 0.60 km".
      name: captionForView(eyeMapRef.current?.getBearing() ?? null).replace(/\.$/, ''),
      positionMeters: drive.positionMeters,
      lookAtTargetId: drive.lookAtTargetId,
      ...cameraLook.current,
      treeHeightMeters: drive.treeHeightMeters,
      roadClearWidthMeters: drive.roadClearWidthMeters,
      harvestPhase: drive.harvestPhase,
      existingForest: drive.existingForest,
      projectRecordedHeights: drive.projectRecordedHeights,
      growthMetersPerYear: drive.growthMetersPerYear,
      regenerationLagYears: drive.regenerationLagYears,
    }
    // The screenshot for the block note, taken from the frame being saved, with
    // what produced it and, where a field photo is lined up, the photo itself.
    const map = eyeMapRef.current
    if (map) {
      const caption = `${view.name}.`
      const savedAt = Date.now()
      const bearing = ((Math.round(map.getBearing()) % 360) + 360) % 360
      const photo = fieldPhoto.match && fieldPhoto.image?.thumbUrl ? fieldPhoto.image : null
      const viewpoint: Omit<ViewpointPage, 'simulation'> = {
        title: view.name,
        design: design?.name ?? null,
        harvestPhase: view.harvestPhase,
        positionMeters: view.positionMeters,
        bearingDegrees: bearing,
        photo: null,
        settings: [
          {
            label: 'Position',
            value: `${(view.positionMeters / 1000).toFixed(2)} km along ${scene.viewpoint.name || 'the road'}`,
          },
          { label: 'Facing', value: `${bearing}°, tilt ${Math.round(view.tilt)}°` },
          { label: 'Eye height', value: `${result?.settings.observerHeightMeters ?? '—'} m above the road` },
          { label: 'Lens', value: `${Math.round(map.getVerticalFieldOfView())}° vertical field of view` },
          {
            label: 'Timber',
            value: `VRI species mix and heights where recorded; ${view.treeHeightMeters} m elsewhere`,
          },
          {
            label: 'Tree drawing',
            value: `${drive.treeLook === 'lit' ? 'Lit' : 'Flat'} shading${drive.detailRadiusMeters > 0 && drive.quality !== 'fast' ? `, full 3D trees within ${drive.detailRadiusMeters} m` : ''}`,
          },
          { label: 'Terrain', value: 'AWS Open Data (CDEM/SRTM) at 1×' },
        ],
      }
      captureMapImage(map)
        .then((image) =>
          setViewImages((current) => ({ ...current, [view.id]: { ...image, caption, savedAt, viewpoint } })),
        )
        .catch(() => setPreviewMessage(`Saved ${view.name}, but its screenshot could not be taken.`))
      if (photo?.thumbUrl) {
        void captureImageUrl(photo.thumbUrl).then((image) => {
          if (!image) return
          const photoCaption = `Mapillary ${photo.capturedAt?.slice(0, 10) ?? 'photo'}${photo.creator ? ` by ${photo.creator}` : ''}, facing ${Math.round(photo.bearing)}°.`
          setViewImages((current) => {
            const entry = current[view.id]
            const withPhoto = { ...viewpoint, photo: { ...image, caption: photoCaption } }
            return entry ? { ...current, [view.id]: { ...entry, viewpoint: withPhoto } } : current
          })
        })
      }
    }
    updateDrive({ playing: false, positionMeters: view.positionMeters })
    setRestoreLook({ yaw: view.yaw, tilt: view.tilt })
    // Views saved under another design (or another road) are shelved, not
    // overwritten: the report sets the same view under two designs side by side.
    if (saved.key && saved.key !== key && saved.views.length) {
      const previous = { key: saved.key, views: saved.views }
      setShelvedViews((current) => [...current.filter((entry) => entry.key !== previous.key), previous])
    }
    setSaved({ key, views: [...savedViews, view] })
    setPreviewMessage(`Saved ${view.name}. Download preview to keep or share this comparison.`)
  }
  /** The road view's scene for the renderer trials (`scenePackage.ts`). */
  const downloadScenePackage = () => {
    const map = eyeMapRef.current
    const ground = previewTerrain.source
    if (!map || !ground || !driveEye) {
      setPreviewMessage('Open the road view and let its terrain load before downloading the 3D scene.')
      return
    }
    const scenePackage = buildScenePackage({
      eye: driveEye,
      eyeHeightMeters: result?.settings.observerHeightMeters ?? 1.5,
      bearingDegrees: map.getBearing(),
      // MapLibre's pitch is 90° at the horizon.
      pitchDegrees: map.getPitch() - 90,
      verticalFovDegrees: map.getVerticalFieldOfView(),
      forest: forestConfiguration,
      elevation: ground,
      roadScars: previewRoadScar,
      notes: [
        `${scene.viewpoint.name || 'Viewpoint'}, ${(drive.positionMeters / 1000).toFixed(2)} km along the road, ${drive.harvestPhase} harvest.`,
        'Terrain: the road view’s drawn ground (AWS Open Data CDEM/SRTM). Trees: VRI where recorded, the regional stand elsewhere.',
      ],
    })
    downloadText(JSON.stringify(scenePackage), 'forestry-scene-package.json', 'application/json')
    setPreviewMessage(`Downloaded the 3D scene: ${scenePackage.trees.count.toLocaleString()} trees.`)
  }
  const reopenPreviousPreview = () => {
    try {
      const previous = localStorage.getItem(PREVIEW_STORAGE_KEY)
      if (!previous) throw new Error('No saved preview is available in this browser.')
      void importPreviewGeometry(new File([previous], 'saved-preview.json', { type: 'application/json' }), 'preview')
    } catch {
      setPreviewMessage('The previous preview could not be read. Open a downloaded preview file instead.')
    }
  }
  const exportPreview = () =>
    downloadText(serializePreview(scene, savedViews), 'forestry-driving-preview.json', 'application/json')
  const saveImage = () => {
    const map = eyeMapRef.current
    if (!map || !canSaveView) return
    updateDrive({ playing: false })
    const capture = () => {
      try {
        const canvas = document.createElement('canvas'),
          source = map.getCanvas()
        canvas.width = source.width
        canvas.height = source.height + 90
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(source, 0, 0)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, source.height, canvas.width, 90)
        ctx.fillStyle = '#111827'
        ctx.font = '18px sans-serif'
        ctx.fillText(
          `${captionForView(map.getBearing())} ${drive.harvestPhase === 'before' ? 'Before' : 'After'} harvest · ${(drive.positionMeters / 1000).toFixed(2)} km.`,
          16,
          source.height + 28,
          canvas.width - 32,
        )
        ctx.font = '14px sans-serif'
        ctx.fillText(
          'Illustrative forest; recorded heights + age estimates. Not a calibrated impact assessment.',
          16,
          source.height + 55,
          canvas.width - 32,
        )
        ctx.fillText(
          `Terrain: AWS Open Data / SRTM / CDEM. Basemap © CARTO, © OpenStreetMap contributors.${drive.imagery ? ` ${SATELLITE_ATTRIBUTION}.` : ''}`,
          16,
          source.height + 78,
          canvas.width - 32,
        )
        const a = document.createElement('a')
        a.href = canvas.toDataURL('image/png')
        a.download = `forestry-${drive.harvestPhase}-${Math.round(drive.positionMeters)}m.png`
        a.click()
        setPreviewMessage('Image downloaded. Save this viewpoint to replay the comparison later.')
      } catch {
        setPreviewMessage('The browser could not capture this map. Download preview to preserve the viewpoint instead.')
      }
    }
    map.once('render', capture)
    map.triggerRepaint()
  }

  const previewProps = {
    scene,
    analysis: analysis.state,
    active: drive.active,
    preparing: !!pendingPreview,
    onPreview: () => openPreview(),
    onCancel: cancelPreview,
    onSample: () => handleLoadSample('roadside', true),
    onNew: handleClearScene,
    onImport: importPreviewGeometry,
    onDraw: handleDrawModeChange,
    drawMode,
    pointCount: draftCoordinates.length,
    onFinish: finishDraft,
    onReopenPrevious: saved.key !== key && saved.views.length ? reopenPreviousPreview : undefined,
    message: previewMessage ?? importMessage,
    views: savedViews,
    onRestore: openPreview,
    onExport: exportPreview,
    storageWarning: sceneStorageWarning ?? storageWarning,
    onRemoveView: (id: string) => setSaved({ key, views: savedViews.filter((v) => v.id !== id) }),
  }
  const assessmentProps = {
    scene,
    onChange: setScene,
    result,
    stale: isStale,
    snapshot: result ? (runSnapshotRef.current?.scene ?? null) : null,
    currentStation: driveStationIndex,
  }
  const tools = useAssessmentTools({
    scene,
    result,
    currentStation: drive.active ? driveStationIndex : (result?.assessmentStationIndex ?? 0),
    onChange: (next) => {
      setScene(next)
      setDrive((current) => ({ ...current, active: false, playing: false }))
    },
    onRun: runForScene,
    onImportScene: (next) => {
      analysis.reset()
      runSnapshotRef.current = null
      setPendingPreview(null)
      setScene(next)
      setDrive((current) => ({ ...current, active: false, playing: false }))
      fitBounds(sceneBounds(next))
    },
    analysisRunning: analysis.state.status === 'running' || analysis.reverseState.status === 'running',
  })
  const maskCollection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: (scene.masks ?? []).map((mask) => ({
      type: 'Feature',
      id: mask.id,
      geometry: mask.geometry,
      properties: { id: mask.id, name: mask.name, kind: mask.kind },
    })),
  }
  // The shared table of what the plan map draws. Not in the road view, and not
  // while drawing, when the corner it sits in belongs to the drawing controls.
  const planTableShown = !drive.active && drawMode === 'none'
  const table = useVisualQualityTable({
    targets: planTableShown ? scene.targets : NO_TARGETS,
    candidates: planTableShown && showInventory ? viewpointCandidates : NO_CANDIDATES,
    checks: reverseViewpointRows,
    result: planTableShown && !preliminaryDrive ? result : null,
    selectedTargetId,
    onSelectTarget: setSelectedTargetId,
  })
  // The tiled workspace: the plan map, the road view while it is open, and the viewpoint summary.
  const [layoutSelection, setLayoutSelection] = useState(readVisualsLayoutSelection)
  const [savedLayouts, setSavedLayouts] = useState(() => readSavedTileLayouts(VISUALS_WORKSPACE))
  const workspaceLayout = resolveTileLayout(VISUALS_WORKSPACE, layoutSelection, savedLayouts)
  const [storedHiddenPanes, setStoredHiddenPanes, restorePreset] = useTilePanels(
    VISUALS_WORKSPACE,
    workspaceLayout.storageId,
    workspaceLayout.base,
  )
  const phone = useMediaQuery('(max-width: 767px)')
  const [phonePane, setPhonePane] = useState<VisualsPane>('map')
  const paneAvailable = { road: drive.active, summary: !!result }
  const leaveRoadView = () => {
    setPreliminaryDrive(false)
    setDrive((current) => ({ ...current, active: false, playing: false }))
  }
  // Opening the road view shows its pane, whatever the layout last hid; on a phone it takes the screen.
  const [seenRoadView, setSeenRoadView] = useState(drive.active)
  if (seenRoadView !== drive.active) {
    setSeenRoadView(drive.active)
    setPhonePane(drive.active ? 'road' : 'map')
    if (drive.active && storedHiddenPanes.includes('road'))
      setStoredHiddenPanes(storedHiddenPanes.filter((id) => id !== 'road'))
  }
  // A layout without the road view closes it: the road view has no life off screen.
  const changeHiddenPanes = (hidden: VisualsPane[]) => {
    setStoredHiddenPanes(hidden)
    if (hidden.includes('road') && drive.active) leaveRoadView()
  }
  const selectLayout = (value: string, saved = savedLayouts) => {
    const next = resolveTileLayout(VISUALS_WORKSPACE, value, saved)
    setLayoutSelection(value)
    try {
      localStorage.setItem(VISUALS_LAYOUT_KEY, value)
    } catch {
      /* A device preference. */
    }
    if (!value.startsWith('saved:')) {
      restorePreset(next.base)
      if (findPreset(VISUALS_WORKSPACE, next.base).hidden.includes('road') && drive.active) leaveRoadView()
    }
  }
  const hiddenPanes = phone
    ? visibleVisualsPanes([], paneAvailable)
    : visibleVisualsPanes(storedHiddenPanes, paneAvailable)
  const phonePaneOptions = VISUALS_WORKSPACE.panes
    .filter((pane) => !hiddenPanes.includes(pane.id))
    .map((pane) => ({ value: pane.id, label: pane.id === 'summary' ? 'Summary' : pane.label }))
  const focusedPane: VisualsPane | undefined = phone
    ? phonePaneOptions.some((option) => option.value === phonePane)
      ? phonePane
      : 'map'
    : undefined
  const choosePhonePane = (pane: VisualsPane) => {
    // The road view stops with its pane, so playback pauses rather than running unseen.
    if (pane !== 'road') setDrive((current) => (current.playing ? { ...current, playing: false } : current))
    setPhonePane(pane)
  }
  // The eye-level map exists only while it can be seen: a second WebGL context costs the drive frames.
  const eyeMapShown = drive.active && !hiddenPanes.includes('road') && (!phone || focusedPane === 'road')
  // Closing it takes two commits: its layers, terrain, timber and camera unmount first, while the map
  // still exists, and the map one commit later. React runs a removed tree's cleanups parent first, so
  // removing them together removed MapLibre before MapTerrain and ForestOverlay could clean up, and
  // they threw on the removed map, taking the page down.
  const [eyeMapLingers, setEyeMapLingers] = useState(false)
  useEffect(() => setEyeMapLingers(eyeMapShown), [eyeMapShown])
  const eyeMapMounted = eyeMapShown || eyeMapLingers
  const paneClose = (pane: VisualsPane) =>
    phone ? null : pane === 'road' ? (
      // Closing the road view's pane leaves the road view, as Return to map does; it comes back
      // with Look from the road. It is never the last pane: the map takes the screen.
      <TilePaneClose label="road view" title="Close the road view (Esc)" onClose={leaveRoadView} />
    ) : (
      <TilePaneClose
        label={pane === 'map' ? 'map' : 'viewpoint summary'}
        disabled={VISUALS_WORKSPACE.panes.filter((option) => !hiddenPanes.includes(option.id)).length <= 1}
        onClose={() => changeHiddenPanes([...storedHiddenPanes, pane])}
      />
    )
  // A click on the plan's road line takes the road view there; nothing to seek at a single spot.
  const driveRoad = preliminaryDrive ? scene.viewpoint.coordinates : result?.inputSnapshot?.viewpoint.coordinates
  const seekFromPlan =
    drive.active && driveRoad && driveRoad.length > 1 && activeRouteLength > 2 * PULLOUT_METERS
      ? (lngLat: [number, number]) => {
          const distance = distanceAlongRoad(roadPath(driveRoad), { lng: lngLat[0], lat: lngLat[1] })
          if (distance !== null) updateDrive({ positionMeters: distance, playing: false })
        }
      : undefined
  // The road view's map unmounts when it closes; the stand it placed outlives it, so reopening reuses it.
  const forestPatches = useMemo(() => {
    void forestConfiguration
    return new globalThis.Map<string, TreeInstance[]>()
  }, [forestConfiguration])
  // The legend folds while the map shares the screen with the road view or the summary, where it
  // would cover much of a half-width map; a click opens it, until the arrangement changes again.
  const mapSharesScreen =
    !phone && !hiddenPanes.includes('map') && (!hiddenPanes.includes('road') || !hiddenPanes.includes('summary'))
  const [legendChoice, setLegendChoice] = useState<{ shared: boolean; collapsed: boolean } | null>(null)
  const legendCollapsed =
    legendChoice && legendChoice.shared === mapSharesScreen
      ? legendChoice.collapsed
      : phone
        ? undefined
        : mapSharesScreen
  const layerData: SceneLayerData = {
    drive,
    scene,
    result,
    preliminaryDrive,
    planShow,
    showInventory,
    inventory,
    selectedTargetId,
    drawMode,
    driveStationIndex,
    driveEye,
    routeViewshed,
    routeOutline,
    forestConfiguration,
    forestPatches,
    facedArrowGeometry,
    previewTerrainMessage: previewTerrain.message,
    forestGround,
    previewRoad,
    previewRoadScar: previewRoadScarCollection,
    basemapBounds,
    mapPick,
    inventoryCollection,
    terrainCandidateCollection,
    ridgeLayerCollection,
    viewpointLayers,
    standingArrows,
    viewpointCandidates,
    landformClues,
    landscapeCollection,
    evqoDisplay,
    harvestedCollection,
    previewBlockCollection,
    blockCollection,
    harvestedGroundColor,
    maskCollection,
    hazeCollection,
    sampleCollection,
    eyeSampleCollection,
    reverseRoadCollection,
    corridorCollection,
    corridorExposureCollection,
    stationCollection,
    spotCollection,
    draftLine,
    draftVertices,
    inventoryHoverHtml,
    viewpointHoverHtml,
    targetHoverHtml,
    setForestStatus,
    setBasemap,
    setMapPick,
    setSelectedTargetId,
    handleMapPoint,
    finishDraft,
    handleAdoptUnit,
    handleUseViewpoint,
    onInspectSample: tools.inspect,
    onRoadClick: seekFromPlan,
  }
  const sidebar = (
    <Sidebar
      via={{
        assessment: viaAssessment,
        stale: isStale,
        statuses: viaStatuses,
        review: scene.viaReview ?? {},
        onReviewChange: updateViaReview,
        landformName: sceneLandform?.name ?? null,
      }}
      setup={<PreviewWorkflow part="setup" {...previewProps} />}
      landformFinder={
        !drive.active && (
          <>
            <TerrainLandformFinder
              scene={scene}
              result={result}
              water={basemap.water}
              candidates={terrainCandidates}
              focused={terrainFocus}
              onFocus={setTerrainFocus}
              onCandidates={(candidates) => {
                setTerrainCandidates(candidates)
                // Frame both readings at once, so they can be compared.
                if (candidates.length) {
                  const boxes = candidates.map((candidate) => polygonBounds(candidate.geometry))
                  fitBounds([
                    Math.min(...boxes.map((box) => box[0])),
                    Math.min(...boxes.map((box) => box[1])),
                    Math.max(...boxes.map((box) => box[2])),
                    Math.max(...boxes.map((box) => box[3])),
                  ])
                }
              }}
              vantages={viewpointCandidates.map(({ key, name, lng, lat }) => ({ key, name, lng, lat }))}
              onPickPoint={(onPoint) => setMapPick(onPoint ? { onPoint } : null)}
              onAdopt={adoptTerrainCandidate}
              replaced={
                replacedLandform && scene.targets.some((target) => target.id === replacedLandform.adoptedId)
                  ? replacedLandform.previous.name
                  : null
              }
              onUndo={undoTerrainLandform}
            />
            <LandformSuggestions scene={scene} onShow={showCandidate} onAdopt={adoptCandidate} />
          </>
        )
      }
      visit={
        <>
          <PreviewWorkflow part="visit" {...previewProps} />
          <RouteViewshedPanel
            preview={routeViewshed}
            driving={drive.active}
            position={drive.positionMeters}
            onRetryTerrain={previewTerrain.retry}
            onSeek={(distance) => updateDrive({ positionMeters: distance, playing: false })}
            onDrive={() => {
              routeViewshed.setEnabled(true)
              updateDrive(
                {
                  active: true,
                  playing: false,
                  positionMeters:
                    routeViewshed.mode === 'point'
                      ? Math.min(drive.positionMeters, routeViewshed.length)
                      : Math.max(
                          routeViewshed.selected.from,
                          Math.min(drive.positionMeters, routeViewshed.selected.to),
                        ),
                },
                true,
              )
            }}
          />
          {tools.field}
        </>
      }
      landformScope={<AssessmentPanel part="scope" {...assessmentProps} />}
      localSources={<ToolSourcesPanel scene={scene} onChange={setScene} selectedTargetId={selectedTargetId} />}
      designReview={
        <>
          <LandformDesignPanel
            result={result}
            onView={(station, blockId) =>
              updateDrive({
                active: true,
                playing: false,
                lookAtTargetId: blockId,
                positionMeters: result?.stations[station].distanceAlongMeters ?? 0,
              })
            }
          />
          {tools.design}
        </>
      }
      fieldPhoto={
        <FieldPhotoPanel
          photo={fieldPhoto}
          canLineUp={
            !!fieldPhoto.image &&
            !!fieldPhoto.onRoad &&
            fieldPhoto.onRoad.offsetMeters <= 60 &&
            !previewInputError(scene)
          }
          onLineUp={() => lineUpPhoto()}
        />
      }
      report={
        <AssessmentPanel
          part="report"
          {...assessmentProps}
          viaReview={viaAssessment ? fs1252ReviewFromVia(viaAssessment, scene.viaReview) : null}
        />
      }
      evidence={tools.report}
      scene={scene}
      onViewpointChange={setViewpoint}
      onSettingsChange={(settings) => setScene((current) => ({ ...current, settings }))}
      onThresholdsChange={(thresholds) => setScene((current) => ({ ...current, thresholds }))}
      onTargetChange={handleTargetChange}
      onRemoveTarget={handleRemoveTarget}
      onZoomToTarget={handleZoomToTarget}
      drawMode={drawMode}
      onDrawModeChange={handleDrawModeChange}
      onSnapToRoad={handleSnapToRoad}
      snapMessage={snapMessage}
      analysis={{ ...analysis.state, result }}
      onRun={() => {
        tools.cancel()
        handleRun()
      }}
      onCancel={cancelPreview}
      reverse={reverseForRoads}
      onRunReverse={handleRunReverse}
      roadViewJump={
        !preliminaryDrive && (
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-2xs font-medium text-muted-foreground">
              Go to a view of the block
              <InfoTip label="About these views">
                Places on the road where the terrain shows the most of the block, by the share of its ground in view.
                Trees in the foreground can still hide the opening.
              </InfoTip>
            </span>
            <StyledSelect
              aria-label="Candidate viewpoint"
              className="h-7 w-full rounded-md border border-border bg-background px-1.5 text-2xs"
              value=""
              disabled={!stops.length}
              onChange={(e) => {
                const stop = stops[Number(e.target.value)]
                if (stop)
                  updateDrive({ positionMeters: stop.positionMeters, lookAtTargetId: stop.targetId, playing: false })
              }}
            >
              <option value="">{stops.length ? 'Choose…' : 'None: the terrain hides the block from the road'}</option>
              {stops.map((stop, i) => (
                <option key={stop.index} value={i}>
                  {(stop.positionMeters / 1000).toFixed(2)} km · {Math.round(stop.visiblePercent)}% of the block in view
                </option>
              ))}
            </StyledSelect>
          </label>
        )
      }
      roadViewForest={
        !preliminaryDrive && (
          <RegrowthControls
            drive={drive}
            update={updateDrive}
            year={visualYear}
            loading={liveForest.loading}
            data={liveForest.data}
            stands={regrowth.stands}
            unknown={regrowth.unknown}
            retry={liveForest.retry}
          />
        )
      }
      viewpointFinder={
        !drive.active && (
          <ViewpointFinderPanel
            blockName={viewpointBlock?.name ?? null}
            state={viewpointInventory}
            candidates={viewpointCandidates}
            reverseRows={reverseViewpointRows}
            reverseRunning={analysis.reverseState.status === 'running'}
            onLoad={() => void loadViewpoints()}
            onCheck={handleRunReverse}
            onUse={handleUseViewpoint}
            standingName={standingNow?.name ?? null}
            backName={standingNow ? standingNow.previous.name || 'the road' : null}
            onBack={handleBackToRoad}
            onShow={(candidate) =>
              mapRef.current?.flyTo({
                center: [candidate.lng, candidate.lat],
                zoom: Math.max(13, mapRef.current.getZoom()),
              })
            }
          />
        )
      }
      visualsParagraph={
        <VisualsParagraphPanel
          scene={scene}
          result={result}
          stale={isStale}
          review={scene.viaReview ?? {}}
          onReviewChange={updateViaReview}
          selectedTargetId={selectedTargetId}
          inventory={viewpointInventory.data}
          otherViewpoints={inventoryFindings}
          otherViewpointsBlockId={viewpointChecks.blockIds.length === 1 ? viewpointChecks.blockIds[0] : null}
          captions={[...shelvedViews.flatMap((entry) => entry.views), ...savedViews].map((view) =>
            view.name.endsWith('.') ? view.name : `${view.name}.`,
          )}
          landform={sceneLandform}
          onExportNote={exportBlockNote}
        />
      }
      onUseRoad={handleUseRoad}
      forestStatus={forestStatus}
      selectedTargetId={selectedTargetId}
      onSelectTarget={setSelectedTargetId}
      drive={preliminaryDrive ? { ...drive, active: false } : drive}
      onDriveChange={updateDrive}
      onDownloadScenePackage={downloadScenePackage}
      onImportFile={(file) => void handleImportFile(file)}
      importMessage={importMessage}
      inventory={inventory}
      showInventory={showInventory}
      onToggleInventory={() => setShowInventory((current) => !current)}
      onLookupInventory={() => void handleLookupInventory()}
      onAdoptUnit={handleAdoptUnit}
      onLoadSample={() => handleLoadSample()}
      // A road-view demo with no landform to assess: straight into the drive.
      onLoadDriveSample={() => handleLoadSample('roadside', true)}
      onLoadHighwaySample={() => handleLoadSample('purden')}
      onImportRoad={(file) => void importPreviewGeometry(file, 'road')}
      onActivateLandform={(id) => setScene((current) => ({ ...current, activeLandformId: id }))}
      roadViewOpening={!!pendingPreview || drive.active}
      onClearScene={handleClearScene}
      onExport={handleExport}
      onExportReport={result ? handleExportReport : null}
      onAddRoadDisturbance={handleAddRoadDisturbance}
      roadClearing={{ roadClass: basemap.roadClass, widthMeters: autoClearing, waterPolygons: basemap.water.length }}
      lookArrows={(standingCandidate?.arrows ?? []).map((arrow, index) => ({
        id: arrow.id,
        label: arrowLabel(arrow, index),
        bearing: arrow.bearing,
      }))}
    />
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      table={table}
      desktopSidebarWidth={400}
      mobileInitialSheetState="full"
      // On a phone the sheet covers the map, so entering the road view with it
      // up looks like nothing happened. Drop it to the peek for the drive and
      // hand the sidebar back on the way out.
      mobileSnapTo={drive.active || drawMode !== 'none' ? 'collapsed' : 'full'}
      mobileSnapKey={drive.active ? 'road-view' : drawMode !== 'none' ? 'drawing' : 'setup'}
      // The collapsed sheet's line on a phone. (selectedFeatureMobilePeek shows only
      // while a feature card is open, which this page never opens.)
      mobilePeekTitle="Visual quality"
      mobilePeekSubtitle={
        viaAssessment?.rating
          ? `${viaAssessment.rating.label} · ${viaAssessment.objective.code} objective`
          : result
            ? `${result.targets.filter((target) => target.role === 'block').length} block(s) simulated · not rated yet`
            : 'Choose a road and cutblock'
      }
    >
      <div
        className="flex h-full min-h-0 flex-col gap-2 p-2 max-md:pt-[calc(var(--map-mobile-toolbar-height,0px)_+_0.5rem)]"
        data-testid="visuals-workspace"
        data-layout={workspaceLayout.base}
      >
        {(phone ? phonePaneOptions.length > 1 : true) && (
          <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
            {phone ? (
              <TabBar
                label="Visible view"
                value={focusedPane ?? 'map'}
                onChange={(value) => choosePhonePane(value as VisualsPane)}
                options={phonePaneOptions}
                stretch
              />
            ) : (
              <TileLayoutPicker
                config={VISUALS_WORKSPACE}
                selection={layoutSelection}
                onSelect={selectLayout}
                saved={savedLayouts}
                onSaved={setSavedLayouts}
                hiddenPanels={storedHiddenPanes}
                onHiddenPanels={changeHiddenPanes}
                selectLabel="Visual quality layout"
                dialogTestId="visuals-layouts-dialog"
              />
            )}
          </div>
        )}
        {/* The panes already sit below the phone's floating toolbar, so overlays in them need not clear it. */}
        <div className="flex min-h-0 flex-1 [--map-mobile-toolbar-height:0px]">
          <TiledWorkspace
            columns={VISUALS_COLUMNS}
            hidden={hiddenPanes}
            focusedPane={focusedPane}
            storageKey={(split) => tilePaneKey(VISUALS_WORKSPACE.namespace, workspaceLayout.storageId, split)}
            contents={{
              map: (
                <TilePane title="Map" actions={paneClose('map')}>
                  {() => (
                    <div className="relative min-h-0 flex-1 overflow-hidden rounded-md" data-testid="visuals-plan-map">
                      <Map
                        ref={mapRef}
                        center={PG_CENTER}
                        zoom={9}
                        maxPitch={85}
                        controls={WORKSPACE_MAP_CONTROLS}
                        deferResize={table.deferResize}
                      >
                        <MapTableBridge table={table} />
                        <TerrainSupport terrain={false} exaggeration={1} hillshade hillshadeIntensity={0.45} />
                        <VisualQualityLayers mode="plan" data={layerData} />
                        <MapViewerCone viewer={planViewer} />
                        {drawMode !== 'none' && (
                          <MapOverlay
                            position="top-left"
                            clearChrome
                            className="right-14 p-3 md:hidden"
                            role="region"
                            aria-label="Map drawing controls"
                          >
                            <p className="text-xs">
                              Tap the map to trace the{' '}
                              {drawMode === 'corridor' ? 'road' : drawMode === 'spot' ? 'viewpoint' : 'polygon'}.{' '}
                              {draftCoordinates.length} points added.
                            </p>
                            <div className="mt-2 flex gap-2">
                              {drawMode !== 'spot' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="touch:h-10"
                                  disabled={draftCoordinates.length < (drawMode === 'corridor' ? 2 : 3)}
                                  onClick={finishDraft}
                                >
                                  Finish drawing
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                className="touch:h-10"
                                onClick={() => handleDrawModeChange('none')}
                              >
                                Cancel drawing
                              </Button>
                            </div>
                          </MapOverlay>
                        )}
                      </Map>
                      {
                        <PlanMapLegend
                          collapsed={legendCollapsed}
                          onCollapsedChange={(collapsed) => setLegendChoice({ shared: mapSharesScreen, collapsed })}
                          blocks={{
                            count: blockCollection.features.length,
                            customColors: scene.targets.some(
                              (target) => target.role === 'block' && !!target.displayColor,
                            ),
                          }}
                          landform={landscapeCollection.features.length > 0}
                          existingOpenings={harvestedCollection.features.length > 0}
                          road={scene.viewpoint.coordinates.length ? scene.viewpoint.mode : null}
                          run={!!result}
                          reverseRoads={reverseRoadCollection.features.length > 0}
                          sensitivityUnits={
                            showInventory ? [...new Set(inventory.units.map((unit) => unit.objectiveId ?? null))] : []
                          }
                          terrainCandidates={[
                            ...new Set(terrainCandidates.map((candidate) => candidate.method ?? 'facing')),
                          ]}
                          otherRidgeLayers={ridgeLayerCollection.features.some(
                            (feature) => feature.properties?.own === 0,
                          )}
                          landformClues={landformClues.features.length > 0}
                          inventory={
                            showInventory && viewpointInventory.data
                              ? {
                                  viewpoints: viewpointInventory.data.viewpoints.length > 0,
                                  arrows: viewpointInventory.data.arrows.length > 0,
                                  recSites: viewpointInventory.data.recSites.length > 0,
                                  screenings: viewpointInventory.data.screenings.length > 0,
                                }
                              : null
                          }
                          masks={[...new Set((scene.masks ?? []).map((mask) => mask.kind))]}
                          show={{
                            state: planShow,
                            onToggle: (key) => setPlanShow((current) => ({ ...current, [key]: !current[key] })),
                          }}
                        />
                      }
                    </div>
                  )}
                </TilePane>
              ),
              road: (
                <TilePane title="Road view" actions={paneClose('road')}>
                  {() => (
                    <div className="relative min-h-0 flex-1 overflow-hidden rounded-md" data-testid="visuals-road-view">
                      {eyeMapMounted && (
                        <>
                          <Map
                            ref={eyeMapRef}
                            center={driveEye ? [driveEye.lng, driveEye.lat] : PG_CENTER}
                            zoom={14}
                            maxPitch={85}
                            controls={WORKSPACE_MAP_CONTROLS}
                          >
                            {eyeMapShown && (
                              <>
                                <TerrainSupport terrain exaggeration={1} hillshade hillshadeIntensity={0.25} />
                                <VisualQualityLayers mode="eye" data={layerData} />
                                {photoLook && <PhotoOverlay photo={fieldPhoto} />}
                                {
                                  <StreetPhotoInset
                                    photo={fieldPhoto}
                                    positionMeters={drive.positionMeters}
                                    lookBearing={lookBearing}
                                    onLineUp={(id) => {
                                      setDrive((current) => ({ ...current, playing: false }))
                                      void fieldPhoto.load(id, { onLoaded: (image) => lineUpPhoto(image) })
                                    }}
                                  />
                                }
                                {(result || preliminaryDrive) && (
                                  <DriveCamera
                                    actions={
                                      preliminaryDrive ? null : (
                                        <>
                                          <SegmentedControl
                                            label="Harvest phase"
                                            variant="solid"
                                            size="sm"
                                            fullWidth={false}
                                            value={drive.harvestPhase}
                                            options={HARVEST_PHASE_OPTIONS}
                                            onChange={(phase) =>
                                              updateDrive({ harvestPhase: phase, playing: false, forest: true })
                                            }
                                          />
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 px-2 touch:h-10"
                                            disabled={!canSaveView}
                                            aria-label="Save viewpoint"
                                            title="Save this spot, look and harvest phase; it is captioned for the planning note"
                                            onClick={saveView}
                                          >
                                            <Bookmark className="h-3.5 w-3.5" />
                                            <span className="max-sm:hidden">Save</span>
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 px-2 touch:h-10"
                                            disabled={!canSaveView}
                                            aria-label="Download image"
                                            title="Download this view as a captioned PNG"
                                            onClick={saveImage}
                                          >
                                            <ImageDown className="h-3.5 w-3.5" />
                                            <span className="max-sm:hidden">Image</span>
                                          </Button>
                                        </>
                                      )
                                    }
                                    status={
                                      preliminaryDrive ? (
                                        (previewTerrain.loading || previewTerrain.message) && (
                                          <p>
                                            {previewTerrain.loading
                                              ? `Loading road terrain · ${previewTerrain.progress}%`
                                              : previewTerrain.message}
                                            {!previewTerrain.loading && previewTerrain.message && (
                                              <TextButton
                                                className="ml-2"
                                                onClick={() => {
                                                  previewTerrain.retry()
                                                  routeViewshed.retry()
                                                }}
                                              >
                                                Retry terrain
                                              </TextButton>
                                            )}
                                          </p>
                                        )
                                      ) : (
                                        <>
                                          {liveForest.loading && (
                                            <p>
                                              Preliminary forest — existing records are loading; saving waits for them.
                                            </p>
                                          )}
                                          {liveForest.pendingUpdate && !liveForest.loading && (
                                            <p>New forest records are ready. Pause to apply them.</p>
                                          )}
                                          {!!liveForest.data?.issues.length && (
                                            <p>
                                              Existing forest records are incomplete; retry under Road view in the
                                              sidebar.
                                            </p>
                                          )}
                                          {(previewTerrain.loading ||
                                            previewTerrain.message ||
                                            (drive.forest && !currentForestStatus?.ready)) && (
                                            <p>
                                              {previewTerrain.loading
                                                ? `Loading terrain · ${previewTerrain.progress}%`
                                                : (previewTerrain.message ??
                                                  currentForestStatus?.error ??
                                                  `Preparing forest${currentForestStatus?.totalPatches ? ` · ${Math.round((100 * (currentForestStatus.patchCount ?? 0)) / currentForestStatus.totalPatches)}%` : '…'}${currentForestStatus?.nearbyReady ? ' · nearby view ready' : ''}`)}
                                              {!previewTerrain.loading && previewTerrain.message && (
                                                <TextButton className="ml-2" onClick={previewTerrain.retry}>
                                                  Retry terrain
                                                </TextButton>
                                              )}
                                            </p>
                                          )}
                                          {lowFrameRate && drive.quality === 'auto' && (
                                            <p>
                                              Frame rate is low: pause to inspect, or set display quality to Faster in
                                              the sidebar.
                                            </p>
                                          )}
                                          {drive.showEvqo && evqoDisplay?.key === evqoKey && evqoDisplay.error && (
                                            <p>EVQO polygons unavailable: {evqoDisplay.error}</p>
                                          )}
                                          {drive.showEvqo &&
                                            evqoDisplay?.key === evqoKey &&
                                            !evqoDisplay.error &&
                                            !evqoDisplay.collection.features.length && (
                                              <p>No established VQO polygons around these blocks.</p>
                                            )}
                                          {previewMessage && <p>{previewMessage}</p>}
                                        </>
                                      )
                                    }
                                    preliminary={preliminaryDrive}
                                    spot={!preliminaryDrive && activeRouteLength <= 2 * PULLOUT_METERS}
                                    restoredLook={restoreLook}
                                    onLookChange={(look) => {
                                      cameraLook.current = look
                                    }}
                                    onStatusChange={setCameraStatus}
                                    onSlowFrames={drive.quality === 'auto' ? () => setLowFrameRate(true) : undefined}
                                    forestReady={!drive.forest || !!currentForestStatus?.nearbyReady}
                                    routeLengthMeters={activeRouteLength}
                                    onSeek={(distance) => updateDrive({ positionMeters: distance, playing: false })}
                                    speedKmh={drive.speedKmh}
                                    onSpeedChange={(speedKmh) => updateDrive({ speedKmh })}
                                    fixedLook={photoLook}
                                    verticalFovDegrees={photoLook ? fieldPhoto.viewFov : null}
                                    elevation={previewTerrain.source}
                                    active={drive.active}
                                    playing={drive.playing}
                                    stations={activeStations}
                                    roadCoordinates={
                                      preliminaryDrive
                                        ? scene.viewpoint.coordinates
                                        : result?.inputSnapshot?.viewpoint.coordinates
                                    }
                                    seekMeters={drive.positionMeters}
                                    seekVersion={seekVersion}
                                    speedMetersPerSecond={(drive.speedKmh * 1000) / 3600}
                                    eyeHeightMeters={
                                      preliminaryDrive
                                        ? 150
                                        : (result?.settings.observerHeightMeters ?? scene.settings.observerHeightMeters)
                                    }
                                    lookAt={preliminaryDrive ? null : lookAtTarget}
                                    spotBearing={spotBearing}
                                    onPosition={({ distanceMeters, stationIndex, lng, lat, bearing }) => {
                                      setDriveStationIndex(stationIndex)
                                      // Rounded, so a slow turn does not re-render the page every report.
                                      setLookBearing((current) =>
                                        Math.abs(((bearing - current + 540) % 360) - 180) < 5
                                          ? current
                                          : Math.round(bearing),
                                      )
                                      setCameraEye((current) =>
                                        current?.lng === lng && current?.lat === lat ? current : { lng, lat },
                                      )
                                      // The plan's view cone is as wide as the road view's frame.
                                      const eyeMap = eyeMapRef.current
                                      if (eyeMap) {
                                        const canvas = eyeMap.getCanvas()
                                        const fov = Math.round(
                                          horizontalFov(
                                            eyeMap.getVerticalFieldOfView(),
                                            canvas.clientWidth / Math.max(1, canvas.clientHeight),
                                          ),
                                        )
                                        setViewerFov((current) => (current === fov ? current : fov))
                                      }
                                      setDrive((current) =>
                                        Math.abs(current.positionMeters - distanceMeters) < 0.0001
                                          ? current
                                          : { ...current, positionMeters: distanceMeters },
                                      )
                                    }}
                                    onPause={() => setDrive((current) => ({ ...current, playing: false }))}
                                    onPlay={() => setDrive((current) => ({ ...current, playing: true }))}
                                    onExit={leaveRoadView}
                                    onReachEnd={() => setDrive((current) => ({ ...current, playing: false }))}
                                  />
                                )}
                              </>
                            )}
                          </Map>
                          {eyeMapShown && (
                            <MapOverlay
                              position="top-left"
                              clearChrome
                              className="max-w-[20rem] px-2.5 py-1.5"
                              aria-label="Road view status"
                            >
                              {preliminaryDrive ? (
                                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                  Route overview · raised 150 m
                                  <InfoTip label="About the route overview">
                                    Red is ground seen from driver-height samples along the road; pause for a detailed
                                    calculation at the stopped position. Terrain only, at true scale: no trees,
                                    buildings or cutblock figures. Return to the map to add cutblocks and run the
                                    assessment.
                                  </InfoTip>
                                </p>
                              ) : (
                                <p className="flex items-center gap-1.5 whitespace-nowrap text-xs text-foreground">
                                  <span className="font-medium">
                                    {drive.harvestPhase === 'before' ? 'Before harvest' : 'After harvest'}
                                  </span>
                                  {currentExposure &&
                                    ((currentExposure.unknownPercent ?? 0) > 0 ? (
                                      <span className="text-amber-700 dark:text-amber-300">
                                        · terrain incomplete here
                                      </span>
                                    ) : (
                                      <span>
                                        ·{' '}
                                        <span className="font-semibold tabular-nums" data-ground-visible>
                                          {currentExposure.visiblePercent.toFixed(0)}%
                                        </span>{' '}
                                        of {exposureName.length <= 16 ? exposureName : 'the block'} in view
                                      </span>
                                    ))}
                                  <InfoTip label="About this view">
                                    {currentExposure ? `${exposureName}: the` : 'The'} percentage is the share of the
                                    block&rsquo;s ground the terrain lets you see from the nearest calculated station —
                                    not the share of your screen, and the drawn trees do not change it.
                                    {drive.showAnalysis ? ' Red points are that same ground visibility.' : ''}{' '}
                                    {drive.harvestPhase === 'before'
                                      ? 'Before harvest, the proposed openings are filled with the same illustrative forest.'
                                      : 'After harvest, trees inside the proposed cutblocks are removed, showing the opening and its edges.'}{' '}
                                    Terrain is at true scale (1×). Tree positions are illustrative; heights and species{' '}
                                    {forestInventory.length
                                      ? 'use dated inventory and labelled regrowth estimates, with a regional fallback.'
                                      : 'use an assumed regional stand.'}{' '}
                                    Road width and forest layout are assumptions and do not change the assessment.
                                    {scene.viewpoint.id === ROADSIDE_DEMO_ID
                                      ? ' This demo is a hypothetical harvest on real terrain.'
                                      : ''}
                                  </InfoTip>
                                </p>
                              )}
                              {standingNow && !preliminaryDrive && (
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 whitespace-normal text-2xs text-muted-foreground">
                                  <span>Standing at {standingNow.name}</span>
                                  <TextButton onClick={handleBackToRoad}>
                                    Back to {standingNow.previous.name || 'the road'}
                                  </TextButton>
                                </p>
                              )}
                              {scene.viewpoint.id === ROADSIDE_DEMO_ID && !preliminaryDrive && (
                                <div className="mt-1 whitespace-normal text-2xs leading-4 text-muted-foreground">
                                  <p>{roadsideDriveCue(drive.positionMeters)}</p>
                                  <div className="mt-1 flex gap-1.5">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-2xs touch:h-9"
                                      onClick={() =>
                                        updateDrive({
                                          positionMeters: 600,
                                          lookAtTargetId: scene.targets.find((t) => t.role === 'block')?.id ?? null,
                                          playing: false,
                                        })
                                      }
                                    >
                                      View opening
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-2xs touch:h-9"
                                      onClick={() =>
                                        updateDrive({ positionMeters: 200, lookAtTargetId: null, playing: true })
                                      }
                                    >
                                      Replay approach
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </MapOverlay>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </TilePane>
              ),
              summary: (
                <ViewpointSummary
                  variant="pane"
                  metrics={summaryMetrics}
                  controls={summaryControls}
                  empty="Run visibility in step 3 for the figures from this viewpoint."
                />
              ),
            }}
          />
        </div>
      </div>
    </MapSectionLayout>
  )
}

export default DevForestryVisuals
