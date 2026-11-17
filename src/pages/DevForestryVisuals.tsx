import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { StyledSelect } from '@/components/ui/form-field'
import { useRouteViewshed } from './dev-forestry/useRouteViewshed'
import { EXPORT_TIMING_PREFIX, timed } from './dev-forestry/exportTiming'
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
import { Map, MapControls, MapLayersControl, type MapRef } from '@/components/ui/map'
import { MapMeasureControl, MapMeasurePanel, useMeasureKeys } from '@/components/ui/map-measure'
import { MapSketch, useMapSketch } from '@/components/ui/map-sketch'
import { MapOverlay } from '@/components/ui/map-panels'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { FileButton } from '@/components/ui/file-button'
import { TextButton } from '@/components/ui/text-button'
import { PG_CENTER } from '@/components/ui/map-styles'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Bookmark, Crosshair, Download, ImageDown, Loader2 } from 'lucide-react'
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
import { WildlifeTreePatchPanel } from './dev-forestry/WildlifeTreePatchPanel'
import { withDrawnMask } from './dev-forestry/assessmentMasks'
import { LandformDesignPanel } from './dev-forestry/LandformDesignPanel'
import { LandformSuggestions } from './dev-forestry/LandformSuggestions'
import {
  TerrainLandformFinder,
  type LandformMethod,
  type LandformVantagePoint,
  type TerrainCandidate,
} from './dev-forestry/TerrainLandformFinder'
import type { RidgeLayer } from './dev-forestry/ridgeLayers'
import type { CanopyStand } from './dev-forestry/canopy'
import { createRoadsideDriveScene, ROADSIDE_DEMO_ID, roadsideDriveCue } from './dev-forestry/driveScenario'
import { createPurdenLakeScene } from './dev-forestry/purdenLakeScenario'
import { lensHfovDeg, viewCaptureKey, type ViewOfInterest } from './dev-forestry/viewsOfInterest'
import { AssessFromView } from './dev-forestry/AssessFromView'
import { useViewCapture, type ViewCaptureHost, type ViewSaveOutcome } from './dev-forestry/useViewCapture'
import {
  MAX_SAVED_VIEWS,
  figurePlanFor,
  lensApplied,
  standFacing,
  standPlace,
  viewLensHfov,
  withoutPlannedView,
  type CaptureFacts,
} from './dev-forestry/viewCapturePlan'
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
import { carryFieldGreenUp } from './dev-forestry/greenUp'
import { useForestHistory } from './dev-forestry/useForestHistory'
import { RegrowthControls } from './dev-forestry/RegrowthControls'
import { buildRegrowthStands, DEFAULT_REGROWTH, type ForestHistoryRecord } from './dev-forestry/regrowth'
import { useDriveTerrain } from './dev-forestry/useDriveTerrain'
import type { ForestStatus } from './dev-forestry/ForestOverlay'
import { treeSunDirection, type TreeInstance } from './dev-forestry/forest'
import {
  blockThinning,
  bufferLine,
  speciesFromCode,
  speciesMixFromInventory,
  type InventoryStand,
  type Thinning,
} from './dev-forestry/forest'
import { buildStand, buildStandFromImport, type Stand, type StandBuild } from './dev-forestry/stand/standTrees'
import { packImportedTrees, unpackImportedTrees, type PackedImportedTrees } from './dev-forestry/stand/treeListImport'
import {
  DEFAULT_PRESCRIPTION,
  KEPT,
  applyPrescription,
  type PrescriptionResult,
  type StandPrescription,
} from './dev-forestry/stand/prescription'
import {
  prescribedCells,
  treatedStems,
  treatmentTints,
  type TreatedStemKind,
} from './dev-forestry/stand/prescribedCells'

const PRESCRIPTION_LINE_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const PRESCRIPTION_ORDER_LABELS: Record<StandPrescription['order'], string> = {
  fromBelow: 'Thinned from below',
  fromAbove: 'Thinned from above',
  proportional: 'Thinned evenly',
}

/** A block's stand from its saved tree list, or why the list cannot be read. */
function importedStand(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  packed: PackedImportedTrees,
  inventory: ReadonlyArray<InventoryStand>,
  anchorLatitude: number,
): StandBuild {
  try {
    return buildStandFromImport({ geometry, trees: unpackImportedTrees(packed), inventory, anchorLatitude })
  } catch (error) {
    return { stand: null, error: `The imported tree list cannot be read: ${String(error)}` }
  }
}

/** A prescribed block's stand and what its prescription takes; `error` says why there is none. */
type StandPrescriptionState = { stand: Stand | null; result: PrescriptionResult | null; error: string | null }
import { roadScar } from './dev-forestry/harvestedGround'
import { buildScenePackage } from './dev-forestry/scenePackage'
import { fetchSceneCover } from './dev-forestry/bcVegetationInventory'
import type { SceneCoverSource } from './dev-forestry/sceneCover'
import { buildFinalStand, finalStandBearings, finalStandRadius, moveStandOrigin } from './dev-forestry/finalStand'
import { ExternalRoadRenderer, type EngineCaptureHandle } from './dev-forestry/ExternalRoadRenderer'
import { useBackgroundRenders, type RenderJob } from './dev-forestry/BackgroundRenders'
import type { RenderEngineId } from './dev-forestry/renderEstimate'
import {
  engineClassPalette,
  cameraMismatch,
  captureRequest,
  captureTerrain,
  depthSummary,
  FINAL_SAMPLES,
  readCaptureReply,
  type EngineCaptureRequest,
  type FigureIllustration,
} from './dev-forestry/engineCapture'
import { joinEngineCapture } from './dev-forestry/engineFramedCapture'
import { loadSkylineTerrain } from './dev-forestry/skylineTerrain'
import { frameBearingRange } from './dev-forestry/skylineReach'
import { demResolutionMeters, type ElevationSource } from '@/lib/forestry/terrain/terrain'
import {
  DEFAULT_ENGINE_ENVIRONMENT,
  engineEnvironment,
  roadRendererInfo,
  roadRendererUrl,
} from './dev-forestry/externalRenderers'
import { useEngineBrowserOptions } from './dev-forestry/engineBrowserOptions'
import { engineCaptureOptionsKey } from './dev-forestry/engineRenderOptions'
import { beforeHarvestCells } from './dev-forestry/stand/beforeHarvestCells'
import type { BasemapContext } from './dev-forestry/BasemapContextProbe'
import { FieldPhotoPanel, PhotoOverlay, StreetPhotoInset } from './dev-forestry/FieldPhoto'
import { useFieldPhoto } from './dev-forestry/useFieldPhoto'
import type { MapillaryImage } from './dev-forestry/mapillary'
import {
  clearingWidthForRoadClass,
  collectPlacesFromMap,
  type BasemapQueryMap,
  type PlaceLabel,
} from './dev-forestry/basemapContext'
import { reportSetting, type ReportSetting } from './dev-forestry/viaReport/setting'
import { buildReport } from './dev-forestry/report'
import { reverseRoadsToGeoJson, type ReverseRoadResult } from './dev-forestry/reverseViewshed'
import {
  collectRoadsFromMap,
  nearestPointOnLine,
  snapCorridorToRoad,
  type RoadCandidate,
} from './dev-forestry/roadSnap'
import { StandPrescriptionDialog } from './dev-forestry/stand/StandPrescriptionDialog'
import { ScreenHeightPanel } from './dev-forestry/ScreenHeightPanel'
import { screenHeightSteps, type ScreenHeightReading } from './dev-forestry/screenHeight'
import { runCooperatively } from './dev-forestry-roads/cooperative'
import type { PrescribedStandFile } from './dev-forestry/stand/standExport'
import { profileStripPolygon, type ProfileStripChoice } from './dev-forestry/stand/profileStrip'
import { snagFates, snagStatesAt } from './dev-forestry/stand/snagDecay'
import { Sidebar, type DrawMode, type DriveState, type StandPrescriptionLine } from './dev-forestry/Sidebar'
import { TerrainSupport } from './dev-forestry/TerrainSupport'
import { readShapeFile } from './dev-forestry/shapeImport'
import { IMAGERY_BASEMAPS, SATELLITE_ATTRIBUTION, SatelliteImagery } from '@/components/ui/map-satellite-imagery'
import {
  VIEWPOINT_ROAD_CLASSES,
  arrowLabel,
  ViewpointFinderPanel,
  type CandidateViewRequest,
  type ViewpointInventoryState,
} from './dev-forestry/ViewpointFinderPanel'
import { VisualsParagraphPanel, type BlockNoteParts } from './dev-forestry/VisualsParagraphPanel'
import { FieldBriefPanel } from './dev-forestry/FieldBriefPanel'
import { KeyViewpointFields, renamedViewpointRecords, ViewpointRecordFields } from './dev-forestry/ReviewRecordFields'
import { viewpointTypeEstimate } from './dev-forestry/ViaPanels'
import { otherPlannedName } from './dev-forestry/viaDocument/resolve'
import { DrawnTimberButton, OptionRow, RoadViewOptionsButton } from './dev-forestry/RoadViewOptions'
import { useExportOpener, useVisualsExport, type BlockNoteChoices } from './dev-forestry/useVisualsExport'
import type { BuiltFile } from './dev-forestry/VisualsExportDialog'
import { layoutStageLabel, layoutStageOf } from './dev-forestry/fieldChecklist'
import {
  blockNoteFileName,
  blockNotePdf,
  blockNoteWorkbook,
  type BlockNote,
  type NoteImage,
  type ViewpointPage,
} from './dev-forestry/blockNote'
import {
  captureAtCamera,
  captureClassPass,
  captureFramed,
  FRAMED_WIDTH,
  captureImageUrl,
  captureMapImage,
  capturePlanMap,
} from './dev-forestry/mapCapture'
import {
  captureFrame,
  DEFAULT_OVERVIEW_SHEET_STYLE,
  fitCamera,
  overviewSheetAspect,
  planFigurePageMaps,
  planOverviewSheet,
  planReportMaps,
  REPORT_MAP_ASPECT,
  reportMapFeatures,
  type OverviewSheetStyle,
  type ReportMapPlan,
  type ReportViewpoint,
} from './dev-forestry/reportMaps'
import { captureReportMap, waitUntil } from './dev-forestry/reportMapCapture'
import type { ReportImages } from './dev-forestry/viaReport/parts'
import { DEFAULT_OBLIQUE_PITCH } from './dev-forestry/viaReport/recipes'
import type { ReportFigure } from './dev-forestry/viaReport/model'
import { matchingDesign, plannedToolViews } from './dev-forestry/assessmentTools'
import {
  focalForHfov,
  landformAngularExtent,
  projectToFrames,
  savedFigureFraming,
  terrainDetailNote,
  type FigureFrame,
  type FramingPlan,
} from './dev-forestry/figureFraming'
import { inventoryBadge, thinPoints, type InventoryBadgeInput } from './dev-forestry/inventoryBadge'
import type { DrivePose } from './dev-forestry/driveController'
import {
  blocksInLandform,
  CLASS_PASS_BACKGROUND,
  classPassLayers,
  MAX_LANDFORM_PASSES,
  paintsPartialCut,
  zonePassLayers,
  type ClassPassInput,
  type ClassPassLayer,
} from './dev-forestry/figureClassPass'
import { blockCallouts, type BlockSight } from './dev-forestry/figureCallouts'
import type { FigureStyleData } from './dev-forestry/FigureStyleLayers'
import { DEFAULT_FIGURE_STYLE, figureNoteImage, type SavedFigure } from './dev-forestry/FigureSheetPanel'
import { PrivateLandPanel } from './dev-forestry/PrivateLandPanel'
import { NetFootprintPanel } from './dev-forestry/NetFootprintPanel'
import { reserveMaskFields } from './dev-forestry/resultsReserves'
import { parcelMaskFields } from './dev-forestry/parcelMapPrivateLand'
import {
  classPaletteEntries,
  countClasses,
  decodeClassRaster,
  inLandform,
  landformCropRows,
  traceLandform,
  type Overlay,
  visibleLineParts,
  ZONE_PALETTE,
  zoneColor,
} from '@/lib/forestry/viaFigure/composeFigure'
import { findPreset as findFigurePreset, VQO_ZONE_ROLES } from '@/lib/forestry/viaFigure/presets'
import { TIMBER_ABSENT } from '@/lib/forestry/viaFigure/timberScreen'
import { splitLandform, subLandformDividers } from './dev-forestry/subLandforms'
import { terrainLines } from './dev-forestry/terrainLines'
import {
  fetchViewpointInventory,
  pulloutThrough,
  PULLOUT_METERS,
  viewpointsNearBlock,
  viewpointCandidateSummary,
  VIEWPOINT_SEARCH_METERS,
  type CandidateArrow,
  type ViewpointCandidate,
} from './dev-forestry/viewpointInventory'
import { EVQO_CODE_FOR_CLASS, viewCaption, type EvqoCode, type ViewpointFinding } from './dev-forestry/visualsNarrative'
import { distanceAlongRoad, hazeRings, roadPath, roadPlacement } from './dev-forestry/driveMath'
import {
  haversineMeters,
  metersPerDegree,
  pointInPolygon,
  polygonInteriorPoint,
  type PolygonGeometry,
} from './dev-forestry/visibility'
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
  stationsToGeoJson,
  targetBounds,
  targetsToGeoJson,
  type ForestryScene,
} from './dev-forestry/scene'
import type { ReverseInput, TargetPolygon, Viewpoint } from './dev-forestry/types'
import { PlanMapLegend } from './dev-forestry/PlanMapLegend'
import { PlanClickToMove, PlanViewerHandles } from './dev-forestry/PlanViewerHandles'
import { ViewsOfInterestLayers } from './dev-forestry/ViewsOfInterestLayers'
import { ViewsOfInterestPanel } from './dev-forestry/ViewsOfInterestPanel'
import { addViews, handSaveLink, viewAtPoint, viewsForCandidate } from './dev-forestry/viewsOfInterest'
import {
  DEFAULT_VIEWPOINT_CLEARING,
  MAX_TREE_FREE_AREAS,
  treeFreeAreasToGeoJson,
  viewpointClearingArea,
} from './dev-forestry/treeFreeAreas'
import { standingPoint, surveyedEyeElevation } from './dev-forestry/viewpointStand'
import { StoodViewpointPanel } from './dev-forestry/StoodViewpointPanel'
import { DEFAULT_PLAN_SHOW, togglePlanLegendKey, type PlanBasemap, type PlanShow } from './dev-forestry/planLayers'
import { useVisibilityAnalysis } from './dev-forestry/useVisibilityAnalysis'
import { useVisualQualityTable } from './dev-forestry/useVisualQualityTable'
import { ViewpointSummary, useViewpointSummaryPreferences } from './dev-forestry/ViewpointSummary'
import { currentPlannedView, steppedView, viewForBlockHere, viewPosition } from './dev-forestry/summaryViewSwitch'
import { ViewLandformControl } from './dev-forestry/ViewLandformControl'
import {
  adoptViewLandform,
  clearViewLandform,
  landformTargetFromCandidate,
  viewLandformName,
} from './dev-forestry/viewLandform'
import { runResultMetrics, viewpointSummaryMetrics } from './dev-forestry/viewpointSummaryRows'
import { landCheckMetrics } from './dev-forestry/landStatusChecks'
import { useLandChecks } from './dev-forestry/useLandChecks'
import { VisualQualityLayers, type SceneLayerData } from './dev-forestry/VisualQualityLayers'
import {
  VISUALS_COLUMNS,
  VISUALS_LAYOUT_KEY,
  VISUALS_WORKSPACE,
  readVisualsLayoutSelection,
  visibleVisualsPanes,
  type VisualsPane,
} from './dev-forestry/visualsWorkspace'
import {
  assessVia,
  fs1252ReviewFromVia,
  partialCutEntries,
  hasStep4,
  movedStation,
  reviewAtStation,
  routeStep4Patch,
  topLevelStep4,
  table2Class,
  viaStepStatuses,
  type ViaReview,
} from './dev-forestry/via'
import { groupLeadOf, groupMembers } from './dev-forestry/viewGroups'
import { DEFAULT_VISUAL_QUALITY_CLASS_ID, visualQualityClass } from './dev-forestry/vqo'
import { bearingDegrees, lineLengthMeters, polygonAreaMeters, polygonBounds } from './dev-forestry/visibility'

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
  // Cards taken from each tree's own 3D model (`impostorBake.ts`): the default since 16 November 2026.
  treeStyle: 'baked',
  treeLook: 'lit',
  treeSun: 'fixed',
  treeShadows: true,
  movingResolution: 'full',
  treeColours: 'natural',
  renderer: 'pgmaps',
  engineEnvironment: DEFAULT_ENGINE_ENVIRONMENT,
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
  figureStyle: null,
  labelStyle: null,
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

/**
 * Development only: `?captureSamples=8` asks an engine's final capture for fewer jittered samples (draft runs of the
 * VIA reference-library harness). Absent or invalid, the capture keeps `FINAL_SAMPLES` (24).
 */
function captureSamplesFromUrl(): number | undefined {
  if (!import.meta.env.DEV) return undefined
  const samples = Number(new URLSearchParams(window.location.search).get('captureSamples'))
  return Number.isInteger(samples) && samples >= 1 && samples <= 256 ? samples : undefined
}

/** Where a saved view's figure is taken from: the station, the eye and the drive's exact pose, the lens. */
type FigureAt = {
  stationIndex: number
  eye: { lng: number; lat: number } | null
  fov: number
  name: string
  /** The drive's own pose: the eye's exact place and height. */
  pose: DrivePose | null
  /** A field photo's horizontal field, when the view is lined up on one. */
  photoHfov: number | null
  /**
   * The scene's fixed figure frame when the view was saved (`scene.figureFrame`), null when it was framed on the
   * landform. A view drawn again (a before render, a background render) is framed with it, never with the frame of
   * whatever scene is open by then. Absent only on a view saved before it was kept: the open scene's is used.
   */
  figureFrame?: FigureFrame | null
  /** The landform the view was saved against, which frames it and splits its class pass; absent as `figureFrame`. */
  landform?: { geometry: PolygonGeometry; name: string; inventoryUnitId: string | null } | null
  /** The lens the view was saved with (View options → *Lens*, or a planned view's), horizontal degrees. */
  lensHfov?: number
  /** A planned view's framing (`viewCapturePlan.ts`'s `figurePlanFor`): `single` is one frame of the lens. */
  framing?: 'landform' | 'single'
}

/** Where the reviewer stood before a capture of planned views (`useViewCapture`), to step back to afterwards. */
type ViewCaptureReturn = {
  viewpoint: Viewpoint
  activeLandformId: string | null | undefined
  standing: { previous: Viewpoint; name: string; point: [number, number] } | null
  roadViewOpen: boolean
  hadRun: boolean
  positionMeters: number
  lookAtTargetId: string | null
  lookBearing: number | null
  lens: number | null
}

/** Longest a background render waits for the road view and its terrain to come back (a reload after a run). */
const ROAD_VIEW_SETTLE_MS = 90_000

/** A bearing in [0, 360). */
const wrapBearing = (degrees: number) => ((degrees % 360) + 360) % 360

type HarvestPhase = DriveState['harvestPhase']
type AlterationClip = (geometry: PolygonGeometry) => PolygonGeometry | null

/**
 * Ground actually cut in a harvest phase: the clearcut blocks after harvest, and existing disturbance still counting
 * in either. In the scene's order, so the stand and slash grown from it are the same however it is asked for.
 */
function forestOpeningsFor(
  targets: readonly TargetPolygon[],
  phase: HarvestPhase,
  clip: AlterationClip,
  assessmentYear: number,
  greenUpAgeYears: number,
): PolygonGeometry[] {
  return targets
    .filter(
      (target) =>
        (target.role === 'block' && phase === 'after' && !blockThinning(target)) ||
        (target.role === 'harvested' &&
          target.siteDisturbance &&
          alterationWeight(target, assessmentYear, greenUpAgeYears) >= 1),
    )
    .flatMap((target) => {
      const geometry = clip(target.geometry)
      return geometry ? [geometry] : []
    })
}

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
/**
 * The hidden map the VIA report's maps are captured on, CSS pixels: a fixed size, so every report frames its maps the
 * same whatever the plan pane's size, and the reviewer's plan never moves while they are taken.
 */
const REPORT_CAPTURE_MAP_SIZE = { width: 1600, height: 1100 }
/** How many areas' visual inventory reads the page keeps, so returning to one reads nothing again. */
const SCENE_INVENTORY_AREAS_KEPT = 8

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
  // The engine drawing the road view, while one is chosen and listening (`ExternalRoadRenderer`).
  const engineCaptureRef = useRef<EngineCaptureHandle | null>(null)
  const { scene, setScene, warning: sceneStorageWarning } = usePersistentScene(loadInitialScene)
  const [drawMode, setDrawMode] = useState<DrawMode>('none')
  // Views of interest on the plan: the row open in step 2 (highlighted on the map), the block the next plan click
  // places a view for (`drawMode === 'view'`), the arrows step 1's finder row would add, and the last add's outcome.
  const [openViewId, setOpenViewId] = useState<string | null>(null)
  const viewPlacementBlockRef = useRef<string | null>(null)
  const [finderArrowIds, setFinderArrowIds] = useState<string[]>([])
  const highlightFinderArrows = useCallback(
    (ids: string[]) => setFinderArrowIds((current) => (current.join(',') === ids.join(',') ? current : ids)),
    [],
  )
  const [viewsMessage, setViewsMessage] = useState<string | null>(null)
  // Step 1's *Assess from: A view* places a view and then assesses from it: the flag says the next placement is one,
  // the pending id waits for the view to be listed before standing there.
  const assessOnPlaceRef = useRef(false)
  const [assessViewPending, setAssessViewPending] = useState<string | null>(null)
  const [assessAddBlockId, setAssessAddBlockId] = useState<string | null>(null)
  // The shared measure tool (`map-measure.tsx`) on the plan map; drawing a shape puts it down.
  const measure = useMapSketch()
  const measuring = measure.state.mode !== 'idle'
  const { clear: clearMeasure, start: startMeasure } = measure
  const [draftCoordinates, setDraftCoordinates] = useState<Array<[number, number]>>([])
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    () => scene.targets.find((target) => target.role === 'block')?.id ?? null,
  )
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [pendingPreview, setPendingPreview] = useState<{ key: string; view?: SavedDriveView } | null>(null)
  // Swapping viewpoints with the road view open keeps its map (WebGL context, style, tiles, terrain and
  // the drawn stand) while the new run is made, rather than closing it and building it all again.
  const [roadViewHeld, setRoadViewHeld] = useState(false)
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
  // The drive's last pose, exactly: the analysis sheet's framed capture stands the eye here. A ref,
  // never state, so a pose report does not re-render the page.
  const drivePoseRef = useRef<DrivePose | null>(null)
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
  // The plan map's basemap and overlays (its Layers button) and the legend rows hidden;
  // the road view keeps its set on `drive`.
  const [planShow, setPlanShow] = useState<PlanShow>(DEFAULT_PLAN_SHOW)
  // The VIA report's maps are captured on a hidden map of their own (`REPORT_CAPTURE_MAP_SIZE`), mounted only while
  // they are taken: it draws only the basemap the map asks for (the figure draws the rest), so the reviewer's plan
  // neither moves nor changes its look, and the road view's renders can run at the same time. `topo` is the vector
  // map with hillshade, for the 11 × 17 overview sheet. `reportBasemapShown` follows once it has rendered.
  const reportMapRef = useRef<MapRef>(null)
  const [reportMapOn, setReportMapOn] = useState(false)
  const [reportBasemap, setReportBasemap] = useState<ReportMapPlan['basemap'] | null>(null)
  const reportBasemapShown = useRef<ReportMapPlan['basemap'] | null>(null)
  useEffect(() => {
    reportBasemapShown.current = reportBasemap
  }, [reportBasemap])
  const planLook: PlanShow = planShow
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
      if (drawMode === 'view') {
        // One view of interest where the plan was clicked, facing its block; its row opens in step 2.
        const current = sceneRef.current
        const block =
          current.targets.find((target) => target.id === viewPlacementBlockRef.current && target.role === 'block') ??
          current.targets.find((target) => target.role === 'block')
        setDrawMode('none')
        if (!block) return
        const existing = current.viewsOfInterest ?? []
        const view = viewAtPoint({ lng: position[0], lat: position[1] }, block, existing)
        const added = addViews(existing, [view])
        if (added.views.length === existing.length) {
          setViewsMessage(added.overLimit ? 'The list is full: remove a view to add another.' : 'Already listed.')
          return
        }
        setScene((latest) => ({ ...latest, viewsOfInterest: addViews(latest.viewsOfInterest ?? [], [view]).views }))
        setOpenViewId(view.id)
        setViewsMessage(`Added ${view.name}.`)
        // Placed from step 1's *Assess from: A view*: the assessment runs from it once it is listed.
        if (assessOnPlaceRef.current) setAssessViewPending(view.id)
        assessOnPlaceRef.current = false
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
    } else if (drawMode === 'wildlife-tree-patch') {
      // A retained mask, checked by the same parser a saved scene goes through.
      const geometry = ringToPolygon(draftCoordinates)
      const id = createId('mask')
      if (geometry)
        setScene((current) => {
          try {
            return { ...current, masks: withDrawnMask(current.masks ?? [], { id, kind: 'retained', geometry }) }
          } catch {
            return current
          }
        })
    } else if (drawMode === 'tree-free') {
      const geometry = ringToPolygon(draftCoordinates)
      if (geometry)
        setScene((current) => {
          const areas = current.treeFreeAreas ?? []
          return {
            ...current,
            treeFreeAreas: [
              ...areas,
              { id: createId('tree-free'), name: `Tree-free area ${areas.length + 1}`, geometry },
            ].slice(-MAX_TREE_FREE_AREAS),
          }
        })
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

  const handleDrawModeChange = useCallback(
    (mode: DrawMode) => {
      if (mode !== 'none') clearMeasure()
      // A tree-free area is drawn on the plan while the road view stays open, to see the timber go.
      // So is a view of interest: placing one needs no road view, but need not close it either.
      setDrive((current) =>
        mode === 'tree-free' || mode === 'wildlife-tree-patch' || mode === 'view'
          ? { ...current, playing: false }
          : { ...current, active: false, playing: false },
      )
      setDraftCoordinates([])
      setDrawMode(mode)
    },
    [clearMeasure],
  )

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
          // A field green-up check follows its opening across the refresh (`carryFieldGreenUp`).
          ...carryFieldGreenUp(
            current.targets.filter((t) => t.role === 'harvested' && t.source === HARVEST_SOURCE),
            harvest.value.areas.map(
              (area): TargetPolygon => ({
                id: createId('harvested'),
                name: area.name,
                role: 'harvested' as const,
                objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
                vac: null,
                harvestYear: area.harvestYear,
                clearcutPercent: area.clearcutPercent,
                geometry: area.geometry,
                source: HARVEST_SOURCE,
              }),
            ),
          ),
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
  // A sidebar tool that asks for a point on the plan takes the click from the measure tool.
  if (mapPick && measuring) clearMeasure()
  const toggleMeasure = () => {
    if (measuring) {
      clearMeasure()
      return
    }
    setMapPick(null)
    startMeasure('line')
  }
  useMeasureKeys(measure, { active: measuring, onClose: clearMeasure })
  // Where "Find a landform from the terrain" reads from, marked on the plan.
  const [landformVantage, setLandformVantage] = useState<LandformVantagePoint | null>(null)
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
      const adopted = landformTargetFromCandidate(candidate, { id: createId('landform'), inherit: current })
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
    setRoadViewHeld(false)
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
      setRoadViewHeld(false)
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
  const loadViewpoints = useCallback(
    async (forBlock?: TargetPolygon, options: { show?: boolean } = {}) => {
      const block = forBlock ?? viewpointBlock
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
        if (options.show !== false) setShowInventory(true)
      } catch (error) {
        setViewpointInventory((current) => ({
          ...current,
          status: 'error',
          error: `DataBC viewpoints unavailable: ${error instanceof Error ? error.message : String(error)}`,
        }))
      }
    },
    [viewpointBlock],
  )

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
  // `landform`: a planned view's landform the stand made the run's active one (`set`), and the reviewer's own active
  // landform before it (`reviewer`), which going back to the road restores while the view's is still active.
  const [standing, setStanding] = useState<{
    previous: Viewpoint
    name: string
    point: [number, number]
    landform?: { reviewer: string | null | undefined; set: string | null }
  } | null>(null)
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
  // With each, the class pass, callouts and run figures its VIA figure is composed from (`FigureSheetPanel`),
  // and its viewpoint record (design, settings, any lined-up field photo) for the report's per-viewpoint pages.
  const [viewImages, setViewImages] = useState<
    Record<
      string,
      NoteImage & {
        savedAt: number
        figure?: SavedFigure
        viewpoint?: Omit<ViewpointPage, 'simulation'>
        /** Where the view's figure was taken from, so another engine can draw it again later (`useBackgroundRenders`). */
        figureAt?: FigureAt
      }
    >
  >({})
  // Development only: the saved and shelved views as plain data (`window.__visualsSavedViews`), so the VIA
  // reference-library harness can confirm each save without reading React state, as it reads `__viaReport*`.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const describe = (view: SavedDriveView, shelved: boolean) => {
      const image = viewImages[view.id]
      const at = image?.figureAt
      return {
        id: view.id,
        name: view.name,
        // Shelved: saved at another viewpoint or design, kept while this one is open.
        shelved,
        harvestPhase: view.harvestPhase,
        positionMeters: view.positionMeters,
        stationIndex: at?.stationIndex ?? null,
        pose: at?.pose
          ? {
              lng: at.pose.lng,
              lat: at.pose.lat,
              eyeElevationMeters: at.pose.eyeElevationMeters,
              bearing: wrapBearing(at.pose.bearing),
              pitch: at.pose.pitch,
            }
          : null,
        eye: at?.eye ?? null,
        figureFrame: at?.figureFrame ?? null,
        landform: at?.landform?.name ?? null,
        savedAt: image?.savedAt ?? null,
        // The analysis sheet is taken after the screenshot: true once it is ready.
        figure: !!image?.figure,
        renderer: image?.figure?.illustration?.renderer ?? (image?.figure ? 'PGMaps' : null),
      }
    }
    ;(window as unknown as { __visualsSavedViews?: unknown }).__visualsSavedViews = {
      viewpoint: scene.viewpoint.name ?? null,
      saved: savedViews.map((view) => describe(view, false)),
      shelved: shelvedViews.flatMap((entry) => entry.views.map((view) => describe(view, true))),
    }
  }, [savedViews, shelvedViews, viewImages, scene.viewpoint.name])
  // The saved views' figures drawn again by another engine in the background, by view, engine and scene.
  const [engineFigures, setEngineFigures] = useState<Record<string, SavedFigure>>({})
  // The block note's views as composed VIA figures (FigureSheetPanel) rather than plain screenshots.
  const [noteFigures, setNoteFigures] = useState(false)
  // Save & export: where it opens, the note's text from the Visuals panel, and the field brief's block.
  const exportOpener = useExportOpener()
  const [blockNoteParts, setBlockNoteParts] = useState<BlockNoteParts | null>(null)
  const [briefBlockId, setBriefBlockId] = useState<string | null>(null)
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
    /** `patch` changes the scene with it (a planned view's landform); returns the scene key the move runs for. */
    (next: Viewpoint, patch: Partial<ForestryScene> = {}) => {
      const nextScene = { ...sceneRef.current, ...patch, viewpoint: next }
      const nextKey = sceneFingerprint(nextScene)
      // The same place again: its saved views stay where they are (shelving them too would list them twice).
      if (nextKey && nextKey === key) {
        setScene(nextScene)
        return nextKey
      }
      const arriving = shelvedViews.find((entry) => entry.key === nextKey)
      setShelvedViews((current) => [
        ...current.filter((entry) => entry.key !== key && entry.key !== nextKey),
        ...(key && savedViews.length ? [{ key, views: savedViews }] : []),
      ])
      if (nextKey && arriving) setSaved({ key: nextKey, views: arriving.views })
      setScene(nextScene)
      return nextKey
    },
    [key, savedViews, shelvedViews, setScene],
  )
  /**
   * Stands at a place (an inventory viewpoint, a rec site, a planned view's map point): a 30 m pullout through it,
   * square to the block, and the road view opens there facing the block or a bearing. Returns the scene key the
   * stand runs for, or null when the block has no centre.
   */
  const standAtPlace = useCallback(
    (
      place: { key: string; name: string; lng: number; lat: number },
      block: TargetPolygon,
      look: { lookAtTargetId: string | null; lookBearing: number | null },
      patch: Partial<ForestryScene> = {},
      /** `roadView: false` runs the assessment from the place and leaves the road view closed. */
      options: { roadView?: boolean } = {},
    ) => {
      const centre = polygonInteriorPoint(block.geometry)
      if (!centre) return null
      // A planned view's landform made active here is remembered with the reviewer's own, for the way back.
      // The reviewer's value is kept as it was (absent or null), so restoring it gives back the same scene key.
      const activeNow = sceneRef.current.activeLandformId
      const landform =
        'activeLandformId' in patch && (patch.activeLandformId ?? null) !== (activeNow ?? null)
          ? {
              reviewer: standing?.landform ? standing.landform.reviewer : activeNow,
              set: patch.activeLandformId ?? null,
            }
          : standing?.landform
      if (!standing)
        setStanding({
          previous: sceneRef.current.viewpoint,
          name: place.name,
          point: [place.lng, place.lat],
          ...(landform ? { landform } : {}),
        })
      else
        setStanding({ ...standing, name: place.name, point: [place.lng, place.lat], ...(landform ? { landform } : {}) })
      const viewpoint: Viewpoint = {
        id: `stand-${place.key}`,
        name: place.name,
        mode: 'corridor',
        coordinates: pulloutThrough(place, centre),
      }
      const nextKey = moveViewpoint(viewpoint, patch)
      setSnapMessage(null)
      if (options.roadView === false) {
        // Assessed from here with the road view closed: the run starts now, as *Run* would.
        runForScene({ ...sceneRef.current, ...patch, viewpoint })
        return nextKey
      }
      if (driveRef.current.active) setRoadViewHeld(true)
      setDrive((current) => ({ ...current, active: false, playing: false }))
      setStandRequest((current) => ({
        serial: (current?.serial ?? 0) + 1,
        positionMeters: PULLOUT_METERS / 2,
        lookAtTargetId: look.lookAtTargetId,
        lookBearing: look.lookAtTargetId ? null : look.lookBearing,
      }))
      return nextKey
    },
    [standing, moveViewpoint, runForScene],
  )
  const handleUseViewpoint = useCallback(
    /** Stands at an inventory viewpoint, facing the block, or along one of its arrows when given. */
    (candidate: ViewpointCandidate, arrow?: CandidateArrow | null, forBlock?: TargetPolygon) => {
      const block = forBlock ?? viewpointBlock
      if (!block) return
      standAtPlace(
        candidate,
        block,
        arrow ? { lookAtTargetId: null, lookBearing: arrow.bearing } : { lookAtTargetId: block.id, lookBearing: null },
      )
    },
    [viewpointBlock, standAtPlace],
  )
  // Drawing or snapping another road ends the stand; there is nothing to step back to.
  const standingNow = standing && scene.viewpoint.id.startsWith('stand-') ? standing : null
  // Step 1's *Assess from: A view* chosen while the road is still assessed: the road stays until a view is chosen or
  // added, so the stand keeps it to go back to. Any change of viewpoint (standing at the view, another scene) ends it.
  const [assessFromViewChosen, setAssessFromViewChosen] = useState(false)
  useEffect(() => setAssessFromViewChosen(false), [scene.viewpoint])
  // ---------------------------------------------------------------------------------------------------------------
  // Views of interest (`viewsOfInterest.ts`): planned on the plan, captured as saved views by `useViewCapture`.
  const viewsOfInterest = useMemo(() => scene.viewsOfInterest ?? [], [scene.viewsOfInterest])
  const setViewsOfInterest = useCallback(
    (update: (views: ViewOfInterest[]) => ViewOfInterest[]) =>
      setScene((current) => {
        const next = update(current.viewsOfInterest ?? [])
        return next.length ? { ...current, viewsOfInterest: next } : { ...current, viewsOfInterest: undefined }
      }),
    [setScene],
  )
  /** Step 1's finder adds inventory viewpoints and rec sites for its block; returns what it did, in a line. */
  const addCandidateViews = useCallback(
    (requests: CandidateViewRequest[]): string | null => {
      const block = viewpointBlock
      if (!block) return 'Add a cutblock first.'
      const added = requests.flatMap((request) =>
        viewsForCandidate(request.candidate, block, { arrowIds: request.arrowIds }),
      )
      const result = addViews(viewsOfInterest, added)
      const count = result.views.length - viewsOfInterest.length
      if (count > 0) setViewsOfInterest(() => result.views)
      const parts = [
        count > 0
          ? `Added ${count} view${count === 1 ? '' : 's'} for ${block.name} to the views of interest.`
          : 'Nothing added.',
        result.duplicates ? `${result.duplicates} already listed.` : '',
        result.overLimit ? `${result.overLimit} left out: the list holds ${result.views.length}.` : '',
      ]
      const line = parts.filter(Boolean).join(' ')
      setViewsMessage(line)
      return line
    },
    [viewpointBlock, viewsOfInterest, setViewsOfInterest],
  )
  // The finder's rows already planned, the scene's blocks the views can be for, and every saved view (here and
  // shelved) a planned view's capture is read from.
  // A row is listed for the block the finder is ranked for: the same viewpoint planned for another block is not.
  const listedViewKeys = useMemo(
    () =>
      new Set(
        viewsOfInterest.flatMap((view) =>
          view.source.kind === 'map' || view.blockId !== viewpointBlock?.id ? [] : [view.source.key],
        ),
      ),
    [viewsOfInterest, viewpointBlock?.id],
  )
  const viewBlocks = useMemo(() => scene.targets.filter((target) => target.role === 'block'), [scene.targets])
  const capturedViewSources = useMemo(
    () => [...shelvedViews.flatMap((entry) => entry.views), ...savedViews],
    [shelvedViews, savedViews],
  )
  // Whether a saved view has its analysis sheet: a planned view saved without one reads *Saved, no analysis sheet*
  // and is captured again (`viewCaptureState`).
  const savedViewHasFigure = useCallback((savedViewId: string) => !!viewImages[savedViewId]?.figure, [viewImages])
  // The road view's lens (View options → *Lens*; a capture sets each planned view's): display only, never in the scene.
  const [roadViewLens, setRoadViewLens] = useState<number | null>(null)
  // Filled in on every render once `saveView` is defined, so each capture step reads the page as it is then.
  const viewCaptureHostRef = useRef<ViewCaptureHost<ViewCaptureReturn> | null>(null)
  // The landform active when a batch started: a planned view without one of its own is captured against it, never
  // against the landform the previous place's view made active.
  const captureBaseLandform = useRef<{ id: string | null | undefined } | null>(null)
  const viewCapture = useViewCapture(viewCaptureHostRef)
  // A view placed (or a spot kept) from step 1 is assessed from as soon as the list holds it, road view closed.
  useEffect(() => {
    if (!assessViewPending || !viewsOfInterest.some((view) => view.id === assessViewPending)) return
    setAssessViewPending(null)
    viewCapture.standAt(assessViewPending, { roadView: false })
  }, [assessViewPending, viewsOfInterest, viewCapture])
  // Before-harvest renders taken during a capture (`capture(ids, { before: true })`), by saved view id, with the planned
  // view's capture key they were taken under: an export pairs a view away from where the reviewer stands from here.
  const [capturedBefore, setCapturedBefore] = useState<
    Record<
      string,
      { plannedKey: string | null; render: { dataUrl: string; width: number; height: number; caption: string } }
    >
  >({})
  // "Landform seen from here" for one planned view (`ViewLandformControl`, `viewLandform.ts`): the finder's visible
  // face read from the view's place, drawn with the finder's candidates, adopted only on the reviewer's click and then
  // for that view alone; the run's landform stays as it was. Rendered by `ViewsOfInterestPanel`'s `landformControl`.
  const showViewLandform = useCallback(
    (candidate: TerrainCandidate) => {
      setTerrainCandidates([candidate])
      setTerrainFocus('visible-face')
      fitBounds(polygonBounds(candidate.geometry))
    },
    [fitBounds],
  )
  const hideViewLandform = useCallback(
    (candidate: TerrainCandidate) => setTerrainCandidates((current) => current.filter((entry) => entry !== candidate)),
    [],
  )
  const adoptLandformForView = useCallback(
    (view: ViewOfInterest, candidate: TerrainCandidate) => {
      const id = createId('landform')
      setScene((current) =>
        adoptViewLandform(
          current,
          view.id,
          landformTargetFromCandidate(candidate, {
            id,
            inherit: findSceneLandform(current),
            name: viewLandformName(candidate, view),
          }),
        ),
      )
    },
    [setScene],
  )
  const clearLandformForView = useCallback(
    (view: ViewOfInterest) => setViewsOfInterest((views) => clearViewLandform(views, view.id)),
    [setViewsOfInterest],
  )
  const renderViewLandform = useCallback(
    (view: ViewOfInterest) => (
      <ViewLandformControl
        view={view}
        scene={scene}
        water={basemap.water}
        onShowCandidate={showViewLandform}
        onHideCandidate={hideViewLandform}
        onAdopt={adoptLandformForView}
        onClear={clearLandformForView}
      />
    ),
    [scene, basemap.water, showViewLandform, hideViewLandform, adoptLandformForView, clearLandformForView],
  )
  // ---------------------------------------------------------------------------------------------------------------
  /** The block note as Excel or PDF: the panel's text, every saved view's screenshot, and the plan map. */
  const buildBlockNote = useCallback(
    async (format: 'xlsx' | 'pdf', parts: BlockNoteParts, choices: BlockNoteChoices): Promise<BuiltFile> => {
      // Every saved view, wherever it was saved, less those the reviewer left out in Save & export.
      const views = [...shelvedViews.flatMap((entry) => entry.views), ...savedViews].filter(
        (view) => !choices.excludedViews.has(view.id),
      )
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
        // The VIA's stage after the block's own rows (`fieldChecklist.ts`).
        header: [...parts.header, { label: 'VIA stage', value: layoutStageLabel(layoutStageOf(scene.viaReview)) }],
        visuals: parts.visuals,
        sentences: parts.sentences,
        measures: parts.measures,
        landform: parts.landform,
        // In the order they were saved, whichever place they were saved at; as composed figures
        // when the analysis sheet panel asks for them.
        views: await Promise.all(
          views
            .flatMap((view) => (viewImages[view.id] ? [viewImages[view.id]] : []))
            .sort((a, b) => a.savedAt - b.savedAt)
            .map((image) =>
              noteFigures
                ? figureNoteImage(image, drive.figureStyle ?? DEFAULT_FIGURE_STYLE, {
                    labelStyle: drive.labelStyle,
                    sceneDenominator: scene.settings,
                  }).catch(() => image)
                : image,
            ),
        ),
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
        ...(choices.landStatus ? { landStatus: choices.landStatus } : {}),
        notes,
        generatedAt: new Date(),
      }
      if (format === 'xlsx') {
        const ExcelJS = await import('exceljs')
        const buffer = await blockNoteWorkbook(note, ExcelJS)
        return {
          blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          fileName: blockNoteFileName(note, 'xlsx'),
        }
      }
      const jspdf = await import('jspdf')
      return {
        blob: new Blob([blockNotePdf(note, jspdf)], { type: 'application/pdf' }),
        fileName: blockNoteFileName(note, 'pdf'),
      }
    },
    [scene, savedViews, shelvedViews, viewImages, noteFigures, drive.figureStyle, drive.labelStyle],
  )
  /** Back to the road the first stand replaced, at the point on it nearest where you stood. */
  const handleBackToRoad = useCallback(() => {
    if (!standing) return
    const road = standing.previous.coordinates
    const nearest =
      road.length > 1 ? nearestPointOnLine(road, { lng: standing.point[0], lat: standing.point[1] }) : null
    // A planned view's landform the stand made active gives way to the reviewer's own again, unless the reviewer
    // chose another landform since.
    const landform = standing.landform
    const restoreLandform = !!landform && (sceneRef.current.activeLandformId ?? null) === landform.set
    moveViewpoint(standing.previous, restoreLandform ? { activeLandformId: landform.reviewer } : {})
    setStanding(null)
    if (driveRef.current.active) setRoadViewHeld(true)
    setDrive((current) => ({ ...current, active: false, playing: false }))
    setStandRequest((current) => ({
      serial: (current?.serial ?? 0) + 1,
      positionMeters: nearest?.distanceAlongMeters ?? 0,
      lookAtTargetId: driveRef.current.lookAtTargetId,
    }))
  }, [standing, moveViewpoint])
  /** *Assess from*: a view (standing at one) or a length of road; leaving a view goes back to the road it left. */
  const handleAssessModeChange = useCallback(
    (mode: Viewpoint['mode']) => {
      // Choosing *A view* keeps the road: it is what the stand goes back to.
      if (mode === 'spot' && sceneRef.current.viewpoint.mode === 'corridor') return setAssessFromViewChosen(true)
      if (mode === 'corridor' && assessFromViewChosen) return setAssessFromViewChosen(false)
      if (mode === 'corridor' && standing && sceneRef.current.viewpoint.id.startsWith('stand-')) {
        const previous = standing.previous
        if (previous.mode === 'corridor' && previous.coordinates.length >= 2) return handleBackToRoad()
        setStanding(null)
        moveViewpoint({ ...previous, mode: 'corridor', coordinates: [] })
        return
      }
      setViewpoint({ ...sceneRef.current.viewpoint, mode, coordinates: [] })
    },
    [standing, assessFromViewChosen, moveViewpoint, handleBackToRoad, setViewpoint],
  )

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
  /** The worked figures of the current run as Markdown, or null while it is stale or absent. */
  const worksheetFile = useCallback((): BuiltFile | null => {
    const saved = runSnapshotRef.current
    if (!result || !saved || saved.key !== sceneFingerprint(scene)) return null
    const landform = findSceneLandform(saved.scene)
    const unit = landform?.inventoryUnitId
      ? saved.inventoryUnits.find((entry) => entry.id === landform.inventoryUnitId)
      : null
    const text = buildReport({
      result,
      targets: saved.scene.targets,
      thresholds: saved.scene.thresholds,
      viewpointName: saved.scene.viewpoint.name || 'Unnamed viewpoint',
      generatedAt: new Date(),
      inventorySource: unit ? 'BC visual landscape inventory (DataBC)' : null,
      inventoryUnit: unit ? { polygonNumber: unit.polygonNumber, vsc: unit.vsc, scenicArea: unit.scenicArea } : null,
    })
    return {
      blob: new Blob([text], { type: 'text/markdown' }),
      fileName: `visual-quality-worksheet-${new Date().toISOString().slice(0, 10)}.md`,
    }
  }, [result, scene])

  const importPreviewGeometry = useCallback(
    async (file: File, kind: 'road' | 'blocks' | 'preview') => {
      setImportMessage('Reading file…')
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error('Use a file smaller than 30 MB.')
        if (kind === 'preview') {
          const restored = parsePreview(JSON.parse(await file.text()))
          if (!restored) throw new Error('Choose a file saved as Saved views in Save & export.')
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
  // A figure style that tints the VQO zones needs them too, for its road-view drape and zone pass.
  const figureZones = (() => {
    const preset = findFigurePreset(drive.figureStyle)
    return !!preset && VQO_ZONE_ROLES.some(([role]) => preset.symbols[role])
  })()
  const showEvqo = planShow.evqo || (drive.active && (drive.showEvqo || figureZones))
  // The scene's visual inventory: one live read around the scene, which the EVQO drapes, the saved views' inventory
  // units and Save & export's reports all use. Read once a drape is on or an export asks (`readSceneInventory`); a
  // failed read stays an error until asked again, never an empty inventory.
  const sceneInventoryKey = useMemo(() => {
    const bounds = sceneBounds(scene)
    return bounds
      ? [bounds[0] - 0.08, bounds[1] - 0.05, bounds[2] + 0.08, bounds[3] + 0.05].map((v) => v.toFixed(3)).join(',')
      : null
  }, [scene])
  const [sceneInventoryAsked, setSceneInventoryAsked] = useState(false)
  const [sceneInventoryAttempt, setSceneInventoryAttempt] = useState(0)
  const sceneInventoryRequest =
    sceneInventoryKey && (showEvqo || sceneInventoryAsked) ? `${sceneInventoryKey}#${sceneInventoryAttempt}` : null
  const [sceneInventoryRead, setSceneInventoryRead] = useState<{
    request: string
    key: string
    units: BcSensitivityUnit[]
    error: string | null
    retrievedAt: string | null
  } | null>(null)
  // Successful reads by area: the scene's bounds take in the viewpoint, so a capture standing at a view of interest
  // and stepping back read the inventory twice more and turned it to loading under an export being written, which
  // then threw its finished file away and wrote it again. Coming back to an area read before takes that read.
  const sceneInventoryKept = useRef(new globalThis.Map<string, NonNullable<typeof sceneInventoryRead>>())
  useEffect(() => {
    if (!sceneInventoryRequest || sceneInventoryRead?.request === sceneInventoryRequest) return
    const key = sceneInventoryRequest.slice(0, sceneInventoryRequest.indexOf('#'))
    const kept = sceneInventoryKept.current.get(key)
    if (kept) {
      setSceneInventoryRead({ ...kept, request: sceneInventoryRequest })
      return
    }
    const abort = new AbortController()
    let timedOut = false
    const timer = window.setTimeout(() => {
      timedOut = true
      abort.abort()
    }, 30000)
    const bounds = key.split(',').map(Number) as [number, number, number, number]
    queryVisualInventory(bounds, abort.signal)
      .then(({ units, retrievedAt }) => {
        if (abort.signal.aborted) return
        const read = { request: sceneInventoryRequest, key, units, error: null, retrievedAt }
        const kept = sceneInventoryKept.current
        kept.delete(key)
        kept.set(key, read)
        // A few areas: the scene's own and the places its views of interest stand.
        for (const old of kept.keys()) if (kept.size > SCENE_INVENTORY_AREAS_KEPT) kept.delete(old)
        setSceneInventoryRead(read)
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted || timedOut)
          setSceneInventoryRead({
            request: sceneInventoryRequest,
            key,
            units: [],
            error: timedOut
              ? 'DataBC did not answer for the visual landscape inventory within 30 s. Retry in a moment.'
              : error instanceof Error
                ? error.message
                : String(error),
            retrievedAt: null,
          })
      })
      .finally(() => window.clearTimeout(timer))
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
  }, [sceneInventoryRequest, sceneInventoryRead?.request])
  const sceneInventory = useMemo(() => {
    const read = sceneInventoryRead?.key === sceneInventoryKey ? sceneInventoryRead : null
    const status: 'idle' | 'loading' | 'ready' | 'error' =
      read && !read.error
        ? 'ready'
        : read?.error && read.request === sceneInventoryRequest
          ? 'error'
          : sceneInventoryRequest
            ? 'loading'
            : read?.error
              ? 'error'
              : 'idle'
    return {
      status,
      units: read && !read.error ? read.units : null,
      error: read?.error ?? null,
      retrievedAt: read?.retrievedAt ?? null,
    }
  }, [sceneInventoryRead, sceneInventoryKey, sceneInventoryRequest])
  const sceneInventoryRef = useRef(sceneInventory)
  sceneInventoryRef.current = sceneInventory
  /** Starts the scene's inventory read, or reads it again after a failure; a read that holds stays. */
  const readSceneInventory = useCallback(() => {
    setSceneInventoryAsked(true)
    if (sceneInventoryRef.current.status === 'error') setSceneInventoryAttempt((attempt) => attempt + 1)
  }, [])
  const evqoKey = showEvqo ? sceneInventoryKey : null
  const evqoDisplay = useMemo(
    () =>
      sceneInventoryRead
        ? {
            key: sceneInventoryRead.key,
            error: sceneInventoryRead.error,
            collection: {
              type: 'FeatureCollection' as const,
              features: sceneInventoryRead.units.flatMap((unit) =>
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
            } as GeoJSON.FeatureCollection,
          }
        : null,
    [sceneInventoryRead],
  )
  const evqoCurrent = evqoKey && evqoDisplay?.key === evqoKey ? evqoDisplay : null
  const planEvqoCodes = useMemo(
    () =>
      planShow.evqo && evqoCurrent
        ? [...new Set(evqoCurrent.collection.features.map((feature) => feature.properties?.code as EvqoCode))]
        : [],
    [planShow.evqo, evqoCurrent],
  )
  const landscapeCollection = useMemo(() => targetsToGeoJson(scene.targets, 'landscape'), [scene.targets])
  // A stood-at viewpoint (a spot, or Stand here's pullout) is a maintained lookout: the drawn stand
  // leaves a fan open toward the block it faces, and a circle round the eye. Display only.
  const standPoint = useMemo(() => standingPoint(scene.viewpoint), [scene.viewpoint])
  const viewpointClearingSetting = scene.viewpointClearing ?? DEFAULT_VIEWPOINT_CLEARING
  const clearingFacing = useMemo(() => {
    if (!standPoint) return null
    if (typeof drive.lookBearing === 'number') return Math.round(drive.lookBearing)
    const faced =
      scene.targets.find((target) => target.id === drive.lookAtTargetId) ??
      scene.targets.find((target) => target.id === selectedTargetId && target.role === 'block') ??
      scene.targets.find((target) => target.role === 'block') ??
      sceneLandform
    const centre = faced ? polygonInteriorPoint(faced.geometry) : null
    // Whole degrees, so the stand is not regrown for a fraction of one.
    return centre ? Math.round(bearingDegrees(standPoint, centre)) : null
  }, [standPoint, drive.lookBearing, drive.lookAtTargetId, scene.targets, selectedTargetId, sceneLandform])
  const privateLandClearing = useMemo(() => {
    const lots = (scene.masks ?? []).filter((mask) => mask.kind === 'private')
    if (!lots.length) return null
    const hectares = lots.reduce((sum, mask) => sum + polygonAreaMeters(mask.geometry) / 10_000, 0)
    return { cleared: !!scene.clearPrivateLand, hectares }
  }, [scene.masks, scene.clearPrivateLand])
  const viewpointClearing = useMemo(
    () => (standPoint ? viewpointClearingArea(standPoint, clearingFacing, viewpointClearingSetting) : null),
    [standPoint, clearingFacing, viewpointClearingSetting],
  )
  // The surveyed eye that applies now; the road view, the run and the captures all stand there.
  const surveyedEye = surveyedEyeElevation(scene.viewpoint) !== null ? (scene.viewpoint.surveyedEye ?? null) : null
  const treeFreeCollection = useMemo(
    () => treeFreeAreasToGeoJson([...(viewpointClearing ? [viewpointClearing] : []), ...(scene.treeFreeAreas ?? [])]),
    [scene.treeFreeAreas, viewpointClearing],
  )
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
  // The finder's rows read a check only for the block they are ranked for: another block's "Hidden" says nothing here.
  const finderReverseRows = useMemo(
    () =>
      viewpointBlock && viewpointChecks.blockIds.includes(viewpointBlock.id)
        ? viewpointChecks.rows
        : new globalThis.Map<string, ReverseRoadResult>(),
    [viewpointBlock, viewpointChecks],
  )
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
  // The own photo laid on the plan for one candidate camera (Field photo → Find the camera), with its landmark and
  // paired points: a check of the camera that needs neither the skyline nor the road view.
  const photoDrape = fieldPhoto.photoDrape
  const photoMarks = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [
        ...(fieldPhoto.landmark
          ? [
              {
                type: 'Feature' as const,
                properties: { kind: 'landmark' },
                geometry: { type: 'Point' as const, coordinates: [fieldPhoto.landmark.lng, fieldPhoto.landmark.lat] },
              },
            ]
          : []),
        ...fieldPhoto.pairs.map((pair) => ({
          type: 'Feature' as const,
          properties: { kind: 'pair' },
          geometry: { type: 'Point' as const, coordinates: [pair.lng, pair.lat] },
        })),
      ],
    }),
    [fieldPhoto.landmark, fieldPhoto.pairs],
  )
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const DRAPE = 'own-photo-drape',
      MARKS = 'own-photo-marks'
    // isStyleLoaded() is false while tiles load; the style itself can take layers as soon as it exists.
    const apply = () => {
      const source = map.getSource(DRAPE) as import('maplibre-gl').ImageSource | undefined
      if (!photoDrape) {
        if (map.getLayer(DRAPE)) map.removeLayer(DRAPE)
        if (source) map.removeSource(DRAPE)
      } else {
        const [w, s, e, n] = photoDrape.bounds
        const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
          [w, n],
          [e, n],
          [e, s],
          [w, s],
        ]
        if (source) source.updateImage({ url: photoDrape.url, coordinates })
        else {
          map.addSource(DRAPE, { type: 'image', url: photoDrape.url, coordinates })
          map.addLayer({ id: DRAPE, type: 'raster', source: DRAPE, paint: { 'raster-opacity': 0.85 } })
        }
      }
      const marks = map.getSource(MARKS) as import('maplibre-gl').GeoJSONSource | undefined
      if (marks) marks.setData(photoMarks)
      else if (photoMarks.features.length) {
        map.addSource(MARKS, { type: 'geojson', data: photoMarks })
        map.addLayer({
          id: MARKS,
          type: 'circle',
          source: MARKS,
          paint: {
            'circle-radius': 6,
            'circle-color': ['match', ['get', 'kind'], 'landmark', '#f59e0b', '#2563eb'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        })
      }
    }
    const safely = () => {
      try {
        apply()
      } catch {
        // The style is still being built: try again once the map is idle.
        map.once('idle', safely)
      }
    }
    safely()
    map.on('styledata', safely)
    return () => {
      map.off('styledata', safely)
      map.off('idle', safely)
    }
  }, [photoDrape, photoMarks])
  // Show the whole laid photo when a new one arrives.
  useEffect(() => {
    if (!photoDrape) return
    const [w, s, e, n] = photoDrape.bounds
    mapRef.current?.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 40, duration: 600 },
    )
  }, [photoDrape])
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
  // The reviewer's own photo: the road view seeks to the nearest road point and
  // DriveCamera's `standAt` stands the eye on the photo's spot, off the road if need be.
  const lineUpOwnPhoto = (at: { lng: number; lat: number }) => {
    const onRoad = nearestPointOnLine(scene.viewpoint.coordinates, at)
    if (!fieldPhoto.own || !onRoad) return
    if (!fieldPhoto.match) fieldPhoto.startOwnMatch()
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
        quadMeanDiameterCm:
          'quadMeanDiameterCm' in stand && typeof stand.quadMeanDiameterCm === 'number'
            ? stand.quadMeanDiameterCm
            : null,
        basalAreaM2PerHa:
          'basalAreaM2PerHa' in stand && typeof stand.basalAreaM2PerHa === 'number' ? stand.basalAreaM2PerHa : null,
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

  // Ground actually cut: the block after harvest, and disturbance still counting.
  const openingYear = result?.inputSnapshot?.assessmentYear ?? scene.assessmentYear ?? new Date().getFullYear()
  const forestOpenings = useMemo<Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>>(
    () =>
      forestOpeningsFor(scene.targets, drive.harvestPhase, clipAlteration, openingYear, scene.settings.greenUpAgeYears),
    [drive.harvestPhase, scene.targets, openingYear, scene.settings.greenUpAgeYears, clipAlteration],
  )

  // Ground that grows no timber whatever is harvested: the clearings less the cut blocks. A stand
  // prescription reads its trees with these, so its trees are the ones the road view draws.
  const standClearings = useMemo(() => {
    // The road is a clearing too. Without it the camera stands inside the timber
    // and the drive shows a trunk, which is not what a road looks like.
    const corridor =
      scene.viewpoint.mode === 'corridor'
        ? bufferLine(scene.viewpoint.coordinates, drive.roadClearWidthMeters / 2)
        : null
    return [
      ...basemap.water,
      ...(scene.masks ?? [])
        .filter((m) => m.kind === 'natural' || (scene.clearPrivateLand && m.kind === 'private'))
        .map((m) => m.geometry),
      ...(scene.treeFreeAreas ?? []).map((area) => area.geometry),
      ...(viewpointClearing ? [viewpointClearing.geometry] : []),
      ...(corridor ? [corridor] : []),
      // A fresh cut bank or fill slope grows no timber.
      ...previewRoadScar.map((strip) => strip.geometry),
    ]
  }, [
    drive.roadClearWidthMeters,
    scene.viewpoint,
    scene.masks,
    scene.clearPrivateLand,
    scene.treeFreeAreas,
    viewpointClearing,
    basemap.water,
    previewRoadScar,
  ])
  const forestClearings = useMemo(() => [...forestOpenings, ...standClearings], [forestOpenings, standClearings])

  // Each prescribed block's stand, read tree by tree from the stems the road view draws there, and
  // what its prescription takes (`stand/`). Display only: no figure the run reports reads it. A
  // block's stand is kept while its shape and the stand's inputs are unchanged, so editing the
  // prescription re-runs only the prescription.
  const standCache = useRef(new globalThis.Map<string, { inputs: unknown[]; build: StandBuild }>())
  const standPrescriptions = useMemo(() => {
    const out = new globalThis.Map<string, StandPrescriptionState>()
    const anchor = scene.viewpoint.coordinates[0]?.[1]
    if (anchor == null) return out
    for (const target of scene.targets) {
      if (target.role !== 'block' || !target.prescription) continue
      if (target.harvestSystem !== 'retention' && target.harvestSystem !== 'partial') continue
      const imported = target.prescription.imported ?? null
      const inputs = [
        target.geometry,
        clipAlteration,
        forestStands,
        standClearings,
        forestInventory,
        drive.treeHeightMeters,
        anchor,
        imported,
      ]
      const cached = standCache.current.get(target.id)
      let build = cached && cached.inputs.every((value, i) => value === inputs[i]) ? cached.build : null
      if (!build) {
        const geometry = clipAlteration(target.geometry)
        build = !geometry
          ? { stand: null, error: 'Wildlife tree patches cover the whole block.' }
          : imported
            ? importedStand(geometry, imported.packed, forestInventory, anchor)
            : buildStand({
                geometry,
                stands: forestStands,
                clearings: standClearings,
                inventory: forestInventory,
                heightMeters: drive.treeHeightMeters,
                anchorLatitude: anchor,
              })
        standCache.current.set(target.id, { inputs, build })
      }
      out.set(
        target.id,
        build.stand
          ? { stand: build.stand, result: applyPrescription(build.stand, target.prescription, target), error: null }
          : { stand: null, result: null, error: build.error },
      )
    }
    return out
  }, [
    scene.targets,
    scene.viewpoint.coordinates,
    clipAlteration,
    forestStands,
    standClearings,
    forestInventory,
    drive.treeHeightMeters,
  ])

  // Prescribed trees on the plan, by what their prescription does with each (`VisualQualityLayers`).
  const standTreeCollection = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = []
    for (const [targetId, entry] of standPrescriptions) {
      if (!entry.stand || !entry.result) continue
      const { removed, keptBecause } = entry.result
      entry.stand.trees.forEach((tree, i) => {
        features.push({
          type: 'Feature',
          properties: {
            targetId,
            key: tree.key,
            status: removed[i] ? 'removed' : keptBecause[i] === KEPT.protected ? 'protected' : 'kept',
            species: tree.species,
            dbhCm: Math.round(tree.dbhCm * 10) / 10,
            heightMeters: Math.round(tree.heightMeters * 10) / 10,
          },
          geometry: { type: 'Point', coordinates: [tree.lng, tree.lat] },
        })
      })
    }
    return { type: 'FeatureCollection', features }
  }, [standPrescriptions])

  // The prescribed blocks as files can carry them (Save & export, *Prescribed trees*).
  const prescribedStands = useMemo<PrescribedStandFile[]>(
    () =>
      scene.targets.flatMap((target) => {
        const entry = standPrescriptions.get(target.id)
        return entry?.stand && entry.result && target.prescription
          ? [{ blockName: target.name, stand: entry.stand, result: entry.result, prescription: target.prescription }]
          : []
      }),
    [scene.targets, standPrescriptions],
  )

  // One line per prescribed block for its sidebar row.
  const prescriptionLines = useMemo(() => {
    const lines = new globalThis.Map<string, StandPrescriptionLine>()
    for (const target of scene.targets) {
      const entry = standPrescriptions.get(target.id)
      if (!entry || !target.prescription) continue
      if (!entry.result) {
        lines.set(target.id, { text: entry.error ?? 'Reading the stand…', tone: 'warning' })
        continue
      }
      const kept = 100 - entry.result.removedBasalAreaPercent
      const pattern =
        target.prescription.pattern === 'grouped'
          ? `Groups of ${PRESCRIPTION_LINE_FORMAT.format(entry.result.clumps.retained.meanClumpSize)}`
          : PRESCRIPTION_ORDER_LABELS[target.prescription.order]
      lines.set(target.id, {
        text: `${pattern} · ${Math.round(kept)}% basal area kept · ${Math.round(entry.result.summaries.retained.stemsPerHa)} stems/ha`,
        tone: entry.result.reached ? 'default' : 'warning',
      })
    }
    return lines
  }, [scene.targets, standPrescriptions])

  // Retention and partial-cut blocks are thinned in the road view, not cleared. A block with a stand
  // prescription keeps exactly the trees its prescription chose (`stand/prescribedCells.ts`). Imported
  // stems remain the source before harvest too; treatment colours only mark them without cutting.
  const thinningsAt = useCallback(
    (phase: HarvestPhase): Thinning[] =>
      scene.targets.flatMap((target) => {
        const thinning = target.role === 'block' ? blockThinning(target) : null
        const geometry = thinning ? clipAlteration(thinning.geometry) : null
        if (!thinning || !geometry) return []
        const prescribed = standPrescriptions.get(target.id)
        const ready = prescribed?.stand && prescribed.result ? prescribed : null
        const coloured = drive.treeColours === 'treatment'
        if (phase === 'before') {
          const before = ready ? beforeHarvestCells(ready.stand!, ready.result!, coloured) : null
          return before ? [{ geometry, keepFraction: 1, prescribed: before }] : []
        }
        if (!ready) return [{ ...thinning, geometry }]
        const kept =
          ready.stand!.trees.length - ready.result!.removed.reduce((sum: number, flag: number) => sum + flag, 0)
        return [
          {
            geometry,
            keepFraction: ready.stand!.trees.length ? kept / ready.stand!.trees.length : thinning.keepFraction,
            prescribed: prescribedCells(
              ready.stand!,
              ready.result!,
              coloured ? { tints: treatmentTints(ready.stand!, ready.result!, 'after') } : {},
            ),
          },
        ]
      }),
    [drive.treeColours, scene.targets, clipAlteration, standPrescriptions],
  )
  const forestThinnings = useMemo(() => thinningsAt(drive.harvestPhase), [thinningsAt, drive.harvestPhase])

  // What a prescription leaves of each tree it takes: stumps, and felled stems or logs where it leaves them.
  const treatedStemsAt = useCallback(
    (phase: HarvestPhase) => {
      if (phase !== 'after') return null
      const out: Record<TreatedStemKind, TreeInstance[]> = { stump: [], felled: [], log: [], snag: [] }
      for (const target of scene.targets) {
        const prescribed = standPrescriptions.get(target.id)
        if (!prescribed?.stand || !prescribed.result || !target.prescription) continue
        const stems = treatedStems(
          prescribed.stand,
          prescribed.result,
          target.prescription.outcome,
          target.prescription.snags.heightMeters,
          snagStatesAt(snagFates(prescribed.stand, prescribed.result), target.prescription.snags.yearsAfterHarvest),
        )
        out.stump.push(...stems.stump)
        out.felled.push(...stems.felled)
        out.log.push(...stems.log)
        out.snag.push(...stems.snag)
      }
      return out.stump.length || out.snag.length ? out : null
    },
    [scene.targets, standPrescriptions],
  )
  const treatedStemsAfterHarvest = useMemo(
    () => treatedStemsAt(drive.harvestPhase),
    [treatedStemsAt, drive.harvestPhase],
  )

  const forestConfiguration = useMemo(
    () => ({
      anchorLatitude: scene.viewpoint.coordinates[0]?.[1],
      stands: forestStands,
      clearings: forestClearings,
      openings: forestOpenings,
      thinnings: forestThinnings,
      treated: treatedStemsAfterHarvest,
      standHeightMeters: drive.treeHeightMeters,
      inventory: forestInventory,
      style:
        drive.quality === 'fast'
          ? ('billboard' as const)
          : drive.quality === 'detailed'
            ? ('baked' as const)
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
      treatedStemsAfterHarvest,
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
  /**
   * The road view's forest in a harvest phase without switching the road view to it: what an engine's render of a
   * saved view is built from (its own phase, or before harvest for a report's before picture), so a background render
   * never moves the road view under the reviewer.
   */
  const forestFor = (phase: HarvestPhase): typeof forestConfiguration => {
    if (phase === drive.harvestPhase) return forestConfiguration
    const openings = forestOpeningsFor(
      scene.targets,
      phase,
      clipAlteration,
      openingYear,
      scene.settings.greenUpAgeYears,
    )
    return {
      ...forestConfiguration,
      openings,
      thinnings: thinningsAt(phase),
      treated: treatedStemsAt(phase),
      clearings: [...openings, ...standClearings],
    }
  }
  // The trees' light: the sun where the site's clock puts it (the clock the other renderers are
  // given), or the fixed light. Kept out of `forestConfiguration`, so an hour's change never
  // regrows the stand.
  const treeSunPlace = scene.viewpoint.coordinates[0]
  const treeSun = useMemo(() => {
    if (drive.treeSun !== 'site' || !treeSunPlace) return null
    const place = { lng: treeSunPlace[0], lat: treeSunPlace[1] }
    return treeSunDirection(engineEnvironment(drive.engineEnvironment, place, new Date()).sunPosition)
  }, [drive.treeSun, drive.engineEnvironment, treeSunPlace])
  const currentForestStatus = forestStatus?.configuration === forestConfiguration ? forestStatus : null
  // The stand another renderer is given: a new package when any of this changes, and not for display switches.
  const engineStand = useMemo(
    () => ({
      forestStands,
      forestClearings,
      forestOpenings,
      forestThinnings,
      forestInventory,
      treeHeightMeters: drive.treeHeightMeters,
      terrain: previewTerrain.source,
      roadScar: previewRoadScar,
      water: basemap.water,
    }),
    [
      forestStands,
      forestClearings,
      forestOpenings,
      forestThinnings,
      forestInventory,
      drive.treeHeightMeters,
      previewTerrain.source,
      previewRoadScar,
      basemap.water,
    ],
  )
  // This browser's engine choices (View options): on the engine's address, so a change loads its page again.
  const engineBrowserOptions = useEngineBrowserOptions()
  const engineUrl =
    drive.renderer === 'pgmaps' ? null : roadRendererUrl(drive.renderer, import.meta.env, engineBrowserOptions)

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
  // Floor, cover, soil and water are drawn whenever the road view is open,
  // timber or not: switching the trees off leaves the ground as it is.
  const forestGround = useMemo(() => {
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    const bounds = sceneBounds(scene)
    if (!drive.active || !bounds) return { floor: empty, shade: empty, soil: empty, water: empty, cover: empty }
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
      // The floor under each surveyed stand, darker the more its canopy closes. Treed stands only:
      // open ground has its own colour below.
      shade: {
        type: 'FeatureCollection',
        features: forestInventory
          .filter((stand) => !stand.cover && (stand.crownClosurePercent ?? 0) > 0)
          .map((stand) => ({
            type: 'Feature',
            properties: { closure: stand.crownClosurePercent },
            geometry: stand.geometry,
          })),
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
  }, [drive.active, scene, previewTerrain.radius, forestInventory, forestOpenings, basemap.water, result?.renderCover])

  // On the map, show what the whole road can see. Driving narrows it to the one
  // point the camera is standing at, which is the thing worth watching change.
  // The plan shows what any station sees; the road view what its own station sees.
  const sampleCollection = useMemo(() => samplesToGeoJson(result, { stationIndex: null }), [result])
  const eyeSampleCollection = useMemo(
    () => (drive.active ? samplesToGeoJson(result, { stationIndex: driveStationIndex }) : EMPTY_COLLECTION),
    [driveStationIndex, drive.active, result],
  )

  // VIA figure classes (docs/forestry-visual-quality.md, "Figure styles and analysis sheets"): the
  // landform, the blocks, openings still counting, private-land masks and VRI non-vegetated land.
  // Display only: none of it reaches the run.
  const figureClassInput = useMemo<ClassPassInput>(() => {
    const year = result?.inputSnapshot?.assessmentYear ?? scene.assessmentYear ?? new Date().getFullYear()
    return {
      landform: sceneLandform?.geometry ?? null,
      // A partial cut is not cleared ground (handbook 3.4.4): its own class, outlined but counted apart.
      blocks: scene.targets
        .filter((target) => target.role === 'block' && target.harvestSystem !== 'partial')
        .map((target) => target.geometry),
      partialCuts: scene.targets
        .filter((target) => target.role === 'block' && target.harvestSystem === 'partial')
        .map((target) => target.geometry),
      existing: scene.targets
        .filter(
          (target) => target.role === 'harvested' && alterationWeight(target, year, scene.settings.greenUpAgeYears) > 0,
        )
        .map((target) => target.geometry),
      privateLand: (scene.masks ?? []).filter((mask) => mask.kind === 'private').map((mask) => mask.geometry),
      rock: result?.nonVegetatedGround ?? [],
      retained: (scene.masks ?? []).filter((mask) => mask.kind === 'retained').map((mask) => mask.geometry),
    }
  }, [scene.targets, scene.masks, scene.assessmentYear, scene.settings.greenUpAgeYears, sceneLandform, result])
  const figureClasses = useMemo(() => classPassLayers(figureClassInput), [figureClassInput])
  // Terrain candidates a figure style can draw: sub-landform dividers at the VSU boundaries in the
  // landform, and lines of force from the road view's DEM. Designer aids: never adopted, never a figure.
  const figurePreset = findFigurePreset(drive.figureStyle)
  const wantsDividers = !!figurePreset?.symbols.subLandform
  const wantsForces = !!(figurePreset?.symbols.forceConvex || figurePreset?.symbols.forceConcave)
  const figureLines = useMemo(() => {
    const lines: Array<{ role: 'subLandform' | 'forceConvex' | 'forceConcave'; points: [number, number][] }> = []
    if (!sceneLandform) return lines
    if (wantsDividers && inventory.units.length) {
      const [lng, lat] = scene.viewpoint.coordinates[0] ?? polygonBounds(sceneLandform.geometry).slice(0, 2)
      try {
        const split = splitLandform({
          landform: sceneLandform.geometry,
          landformName: '1',
          vsus: inventory.units.map((unit) => ({
            id: unit.polygonNumber,
            evqo: unit.objectiveId,
            geometry: unit.geometry,
          })),
          barriers: [],
          viewpoint: { lng, lat },
          cellMeters: 30,
        })
        for (const points of subLandformDividers(split)) lines.push({ role: 'subLandform', points })
      } catch {
        // A landform the grid cannot hold draws no dividers.
      }
    }
    const ground = previewTerrain.source
    if (wantsForces && ground) {
      const [w, s, e, n] = polygonBounds(sceneLandform.geometry)
      try {
        const found = terrainLines(ground, {
          bounds: [w - 0.005, s - 0.005, e + 0.005, n + 0.005],
          inside: (x, y) => pointInPolygon(sceneLandform.geometry, x, y),
        })
        for (const line of found.lines)
          lines.push({
            role: line.kind === 'convex' ? 'forceConvex' : 'forceConcave',
            points: line.points.map((p) => [p.lng, p.lat]),
          })
      } catch {
        // No lines of force where the terrain cannot be read.
      }
    }
    return lines
  }, [sceneLandform, wantsDividers, wantsForces, inventory.units, scene.viewpoint.coordinates, previewTerrain.source])
  const figureStyleData = useMemo<FigureStyleData>(() => {
    if (!drive.figureStyle) return {}
    const multi = (geometries: ReadonlyArray<GeoJSON.Polygon | GeoJSON.MultiPolygon>): GeoJSON.FeatureCollection => ({
      type: 'FeatureCollection',
      features: geometries.map((geometry, i) => ({ type: 'Feature', id: i, properties: {}, geometry })),
    })
    const rock = figureClasses.layers.find((layer) => layer.id === 'rock')?.data
    return {
      landform: multi(figureClassInput.landform ? [figureClassInput.landform] : []),
      proposedBlock: blockCollection,
      treatedGround: blockCollection,
      existingNonVeg: multi(figureClassInput.existing),
      privateLand: multi(figureClassInput.privateLand),
      ...(rock ? { rockNonVeg: rock } : {}),
      vsuLine: inventoryCollection,
      // Each established objective's polygons, for the styles that tint the zones.
      ...Object.fromEntries(
        VQO_ZONE_ROLES.map(([role, code]) => [
          role,
          {
            type: 'FeatureCollection',
            features: (evqoCurrent?.collection.features ?? []).filter((feature) => feature.properties?.code === code),
          } satisfies GeoJSON.FeatureCollection,
        ]),
      ),
      ...Object.fromEntries(
        (['subLandform', 'forceConvex', 'forceConcave'] as const).map((role) => [
          role,
          {
            type: 'FeatureCollection',
            features: figureLines
              .filter((line) => line.role === role)
              .map((line, i) => ({
                type: 'Feature',
                id: i,
                properties: {},
                geometry: { type: 'LineString', coordinates: line.points },
              })),
          } satisfies GeoJSON.FeatureCollection,
        ]),
      ),
    }
  }, [
    drive.figureStyle,
    figureClassInput,
    figureClasses,
    blockCollection,
    inventoryCollection,
    figureLines,
    evqoCurrent,
  ])
  /** Existing openings still counting, by their sightlines: a saved view's secondary labels. */
  const openingSights = useMemo<BlockSight[]>(
    () =>
      (result?.targets ?? []).flatMap((target) => {
        const opening = scene.targets.find((entry) => entry.id === target.targetId && entry.role === 'harvested')
        if (!opening || !(target.alterationWeight > 0)) return []
        return [
          {
            id: opening.id,
            name: opening.name,
            positions: target.positions,
            elevations: target.elevations,
            sampleCount: target.sampleCount,
            visibleByStation: target.visibleByStation,
            interior: null,
          },
        ]
      }),
    [result, scene.targets],
  )
  /** Each block's sightlines, for the callouts of a saved view. */
  const blockSights = useMemo<BlockSight[]>(
    () =>
      (result?.targets ?? []).flatMap((target) => {
        const block = scene.targets.find((entry) => entry.id === target.targetId && entry.role === 'block')
        if (!block) return []
        const interior = polygonInteriorPoint(block.geometry)
        let elevation = 0
        for (let i = 0; i < target.sampleCount; i++) elevation += target.elevations[i] / Math.max(1, target.sampleCount)
        return [
          {
            id: block.id,
            name: block.name,
            positions: target.positions,
            elevations: target.elevations,
            sampleCount: target.sampleCount,
            visibleByStation: target.visibleByStation,
            interior: interior ? { lng: interior.lng, lat: interior.lat, elevation } : null,
            apparentByStation: target.visibleApparentSolidAngleByStation,
          },
        ]
      }),
    [result, scene.targets],
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

  // A block's stand prescription: the dialog open on one block, and protecting trees from the plan.
  const [prescriptionTargetId, setPrescriptionTargetId] = useState<string | null>(null)
  // The stand profile's strip, while the dialog's Graphs tab shows it; drawn on the plan.
  const [profileStrip, setProfileStrip] = useState<ProfileStripChoice | null>(null)
  const handleOpenPrescription = useCallback(
    (targetId: string) => {
      setScene((current) => ({
        ...current,
        targets: current.targets.map((target) =>
          target.id === targetId && !target.prescription ? { ...target, prescription: DEFAULT_PRESCRIPTION } : target,
        ),
      }))
      setPrescriptionTargetId(targetId)
    },
    [setScene],
  )
  const handleToggleProtectedTree = useCallback(
    (targetId: string, key: number) => {
      setScene((current) => ({
        ...current,
        targets: current.targets.map((target) => {
          if (target.id !== targetId || !target.prescription) return target
          const keys = new Set(target.prescription.protectedKeys)
          if (keys.has(key)) keys.delete(key)
          else keys.add(key)
          return { ...target, prescription: { ...target.prescription, protectedKeys: [...keys] } }
        }),
      }))
    },
    [setScene],
  )

  const standStripCollection = useMemo<GeoJSON.FeatureCollection>(() => {
    const stand = prescriptionTargetId ? standPrescriptions.get(prescriptionTargetId)?.stand : null
    const polygon = stand && profileStrip ? profileStripPolygon(stand, profileStrip) : null
    return {
      type: 'FeatureCollection',
      features: polygon ? [{ type: 'Feature', properties: {}, geometry: polygon }] : [],
    }
  }, [prescriptionTargetId, profileStrip, standPrescriptions])

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
  // Land status checks (treaty land, reserves, private land, parks, …) for the blocks and landform,
  // read live from DataBC; cards in the summary, never inputs to the run.
  const checkBlocks = useMemo(() => scene.targets.filter((target) => target.role === 'block'), [scene.targets])
  const landChecks = useLandChecks(checkBlocks, sceneLandform)
  // The planned view of interest the reviewer stands at (`summaryViewSwitch.ts`), for the summary's ◀ ▶: matched by
  // the road view's look, then the block the road view faces or the sidebar's selection.
  const summaryView = useMemo(
    () =>
      currentPlannedView(viewsOfInterest, standingNow?.point ?? null, {
        look: { targetId: drive.lookAtTargetId, bearing: drive.lookBearing },
        blockId: drive.lookAtTargetId ?? selectedTargetId,
        centreOf: (id) => {
          const target = checkBlocks.find((entry) => entry.id === id)
          return target ? polygonInteriorPoint(target.geometry) : null
        },
      }),
    [viewsOfInterest, standingNow, drive.lookAtTargetId, drive.lookBearing, selectedTargetId, checkBlocks],
  )
  // Step 4 is made per group of views (`viewGroups.ts`): assessing from a view of interest reads and writes its
  // group's record, led by `assessStationId`; on a road, or a place that is no view of interest, the review's own.
  const assessStationId = summaryView ? groupLeadOf(summaryView, viewsOfInterest).id : null
  const viaReviewNow = useMemo(
    () => reviewAtStation(scene.viaReview, assessStationId),
    [scene.viaReview, assessStationId],
  )
  const updateViaReviewNow = useCallback(
    (patch: Partial<ViaReview>) =>
      setScene((current) => ({
        ...current,
        viaReview: { ...current.viaReview, ...routeStep4Patch(current.viaReview, assessStationId, patch) },
      })),
    [setScene, assessStationId],
  )
  const viaAssessment = useMemo(
    () =>
      sceneLandform
        ? assessVia({
            objectiveId: sceneLandform.objectiveId,
            result,
            review: viaReviewNow,
            blocks: scene.targets.filter((target) => target.role === 'block'),
          })
        : null,
    [sceneLandform, result, viaReviewNow, scene.targets],
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
  // The block the summary reads: at a planned view, that view's block (an arrow's view faces a bearing, not its
  // block); else the one the road view faces, else the sidebar's selection, else the first. The summary's block
  // switcher sets the selection. A block the run does not hold reads as not in the run.
  // At a view, a block picked in the summary that has no view here is read until the reviewer stands elsewhere.
  const [summaryBlockAtView, setSummaryBlockAtView] = useState<{ viewId: string; blockId: string } | null>(null)
  const viewBlockId = summaryView
    ? summaryBlockAtView?.viewId === summaryView.id
      ? summaryBlockAtView.blockId
      : summaryView.blockId
    : null
  const summaryBlock =
    checkBlocks.find((target) => target.id === (viewBlockId ?? drive.lookAtTargetId ?? selectedTargetId)) ??
    checkBlocks[0] ??
    null
  // That view's own landform, when it is not the one the run assessed: the rows say whose figures they are.
  const summaryViewLandformName =
    summaryView?.landformId && summaryView.landformId !== sceneLandform?.id
      ? (scene.targets.find((target) => target.id === summaryView.landformId)?.name ?? null)
      : null
  const captureRunning = viewCapture.state.status === 'running'
  const summaryViewSwitcher = viewsOfInterest.length
    ? {
        label: summaryView?.name ?? (standingNow ? standingNow.name : scene.viewpoint.name || 'The road'),
        position: viewPosition(viewsOfInterest, summaryView?.id ?? null),
        onStep: (step: 1 | -1) => {
          const next = steppedView(viewsOfInterest, summaryView?.id ?? null, step)
          if (next) viewCapture.standAt(next.id)
        },
        disabledReason: captureRunning ? 'Wait for the capture of the planned views to finish' : null,
      }
    : null
  const summaryBlockSwitcher = {
    blocks: checkBlocks,
    value: summaryBlock?.id ?? null,
    onChange: (blockId: string) => {
      setSelectedTargetId(blockId)
      // A planned view here for that block is stood at (the current one when it is already for it); otherwise a
      // road view facing a block turns to this one.
      setSummaryBlockAtView(null)
      if (summaryView?.blockId === blockId) return
      const here = viewForBlockHere(viewsOfInterest, standingNow?.point ?? null, blockId)
      if (here && here.id !== summaryView?.id && !captureRunning) return viewCapture.standAt(here.id)
      if (summaryView) setSummaryBlockAtView({ viewId: summaryView.id, blockId })
      if (drive.lookAtTargetId && drive.lookAtTargetId !== blockId) updateDrive({ lookAtTargetId: blockId })
    },
  }
  const summaryMetrics = useMemo(
    () => [
      ...(result
        ? [
            ...viewpointSummaryMetrics({
              result,
              stationIndex: summaryStation,
              driving: drive.active && !preliminaryDrive,
              viewpointName: standingNow ? `Standing at ${standingNow.name}` : scene.viewpoint.name,
              block: summaryBlock ? { targetId: summaryBlock.id, name: summaryBlock.name } : null,
              plannedViewName: summaryView?.name ?? null,
              viewLandformName: summaryViewLandformName,
              landform: sceneLandform ?? null,
              objectiveSource,
              thresholds: scene.thresholds,
              via: viaAssessment,
            }),
            ...runResultMetrics({
              result,
              block: summaryBlock ? { targetId: summaryBlock.id, name: summaryBlock.name } : null,
              landform: sceneLandform ?? null,
              thresholds: scene.thresholds,
            }),
          ]
        : []),
      ...landCheckMetrics(landChecks.states, { unchecked: landChecks.unchecked }),
    ],
    [
      landChecks.states,
      landChecks.unchecked,
      result,
      summaryStation,
      drive.active,
      preliminaryDrive,
      standingNow,
      scene.viewpoint.name,
      summaryBlock,
      summaryView,
      summaryViewLandformName,
      sceneLandform,
      objectiveSource,
      scene.thresholds,
      viaAssessment,
    ],
  )
  // What a view still waits for before it can be saved, in words, or null once it can: the road view, the forest
  // records, the camera, the drawn timber. A capture that times out names it, and each change is a
  // `pgmaps-export:` timing mark, so a trace shows which one held an export up.
  const saveBlocker = preliminaryDrive
    ? 'the road view opening'
    : !drive.active
      ? 'the road view, closed'
      : liveForest.loading
        ? 'the forest records (RESULTS, openings, VRI) loading'
        : liveForest.pendingUpdate
          ? 'a forest records update waiting to apply'
          : cameraStatus !== 'ready'
            ? `the camera (${cameraStatus ?? 'not placed'})`
            : // Without drawn timber (the note screenshot look) there is no forest to wait for.
              drive.forest && currentForestStatus?.error
              ? `the drawn timber (${currentForestStatus.error})`
              : drive.forest && !currentForestStatus?.ready
                ? `the drawn timber (${
                    currentForestStatus
                      ? `${currentForestStatus.patchCount ?? 0} of ${currentForestStatus.totalPatches ?? '?'} patches`
                      : `no stand for this configuration yet`
                  })`
                : null
  const canSaveView = saveBlocker === null
  useEffect(() => {
    try {
      performance.mark(`${EXPORT_TIMING_PREFIX}road view waits for ${saveBlocker ?? 'nothing'}`)
    } catch {
      // Marks are only for traces.
    }
  }, [saveBlocker])
  // The VIA report's before-harvest renders wait on it after switching the harvest phase.
  const canSaveViewRef = useRef(canSaveView)
  canSaveViewRef.current = canSaveView
  const saveBlockerRef = useRef(saveBlocker)
  saveBlockerRef.current = saveBlocker
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
  /**
   * Where a saved view's figure is framed from: the eye at the drive's exact pose and the frames that put the landform
   * (or, with none, the blocks) mid-frame as the reference sheets crop it (figureFraming.ts). The VIA report's
   * before-harvest render takes the same frames, so it lines up with the view's figure.
   */
  const figureFramingFor = (at: FigureAt) => {
    const ground = previewTerrain.source
    const eye = at.pose ? { lng: at.pose.lng, lat: at.pose.lat, elevation: at.pose.eyeElevationMeters } : null
    const blocksOnly = scene.targets.filter((target) => target.role === 'block')
    // The frame and landform the view was saved with; the open scene's only for a view saved before they were kept.
    const { landform, figureFrame } = savedFraming(at)
    const subject: PolygonGeometry | null =
      landform?.geometry ??
      (blocksOnly.length
        ? {
            type: 'MultiPolygon',
            coordinates: blocksOnly.flatMap((block) =>
              block.geometry.type === 'Polygon' ? [block.geometry.coordinates] : block.geometry.coordinates,
            ),
          }
        : null)
    const extent = eye && ground && subject ? landformAngularExtent(ground, eye, subject) : null
    // A planned view's single frame of its lens; else a fixed frame (a reference VIA's panorama) when the scene set
    // one; else framed on the landform with the view's lens (`figurePlanFor`).
    const plan = figurePlanFor(at, extent, figureFrame)
    return { ground, eye, plan, landform, figureFrame }
  }
  /** What a view is framed and split by: what it was saved with, else (an older save) the open scene's. */
  const savedFraming = (at: FigureAt) =>
    savedFigureFraming(at, {
      figureFrame: scene.figureFrame ?? null,
      landform: sceneLandform
        ? {
            geometry: sceneLandform.geometry,
            name: sceneLandform.name,
            inventoryUnitId: sceneLandform.inventoryUnitId ?? null,
          }
        : null,
    })
  /** The class pass's layers for a view: the open scene's, split at the landform the view was saved with. */
  const classLayersFor = (landform: ReturnType<typeof savedFraming>['landform']) =>
    (landform?.geometry ?? null) === (sceneLandform?.geometry ?? null)
      ? figureClasses
      : classPassLayers({ ...figureClassInput, landform: landform?.geometry ?? null })
  /** The partial-cut blocks a figure states, with the Table 6 figure the run adds to X for each (via.ts). */
  const figurePartialCuts = (): NonNullable<SavedFigure['partialCuts']> =>
    partialCutEntries(
      scene.targets.filter((target) => target.role === 'block'),
      result,
    ).map((entry) => {
      const block = scene.targets.find((target) => target.id === entry.id)
      return {
        id: entry.id,
        name: entry.name,
        visible: entry.visible,
        equivalentPercent: entry.equivalentPercent,
        volumeRemovedPercent: block?.volumeRemovedPercent ?? null,
        residualHeightMeters: block?.residualHeightMeters ?? null,
      }
    })
  /**
   * The class pass of the road view as it stands, and what its VIA figure prints: callouts from the
   * run's own sightlines at this station, the run's perspective figure there, the lens and facts.
   */
  const captureViewFigure = async (
    map: NonNullable<typeof eyeMapRef.current>,
    at: FigureAt,
    /** Who draws the frames: the road view's engine when it has one, else PGMaps; a background render passes its own. */
    engine: EngineCaptureHandle | null = drive.renderer !== 'pgmaps' ? engineCaptureRef.current : null,
    /**
     * The harvest phase an engine draws the stand in (`forestFor`): a background render passes the view's own, or
     * before harvest for a report's before picture. PGMaps' own capture draws the road view as it stands.
     */
    phase: HarvestPhase = drive.harvestPhase,
  ): Promise<SavedFigure> => {
    // Frame the landform (or, with none, the blocks), then put the reviewer's camera back (captureFramed).
    const { ground, eye, plan, landform, figureFrame } = figureFramingFor(at)
    const visibleBlockPoints = blockSights.flatMap((sight) => {
      const row = at.stationIndex * sight.sampleCount
      const points: Array<[number, number]> = []
      for (let i = 0; i < sight.sampleCount; i++)
        if (sight.visibleByStation[row + i] === 1) points.push([sight.positions[i * 2], sight.positions[i * 2 + 1]])
      return points
    })
    const classLayers = classLayersFor(landform)
    // A partial cut paints its own class, which the decode then needs (`classPaletteEntries`).
    const partialPass = paintsPartialCut(classLayers.layers)
    // The scene's other landforms (sub-landforms, or the whole landform beside an active sub-landform), each split
    // from a class pass of its own at the same frames, for the sheet's further columns and the report's rows. Only
    // for a view saved against the open scene's landform, and on PGMaps' own map: an engine takes one class pass.
    const otherLandforms =
      !engine && sceneLandform && (landform?.geometry ?? null) === sceneLandform.geometry
        ? scene.targets
            .filter((target) => target.role === 'landscape' && target.id !== sceneLandform.id)
            .slice(0, MAX_LANDFORM_PASSES)
        : []
    const otherPasses = otherLandforms.map(
      (target) => classPassLayers({ ...figureClassInput, landform: target.geometry }).layers,
    )
    let otherRasters: Array<{ data: Uint8ClampedArray; width: number; height: number } | null> = []
    let classes: ReturnType<typeof decodeClassRaster>
    let frameImage: NoteImage | undefined
    let project: (lng: number, lat: number, elevation: number) => [number, number] | null
    let lens: string
    let hfovDeg = at.fov
    let zones: ReturnType<typeof decodeClassRaster> | null = null
    // The crop to the landform is kept, not applied: each style decides (FigureSheetPanel).
    let crop: { y: number; height: number } | null = null
    // Where the landform lies in the frame whatever the crop: what a report's panorama centres on.
    let landformRows: { y: number; height: number } | null = null
    let frames = 1
    let azimuth = map.getBearing()
    const zoneLayers = evqoCurrent ? zonePassLayers(evqoCurrent.collection) : []
    // With another engine drawing the road view, the frames come from it (`engineCapture.ts`): its picture, its
    // class pass (its trees in front) and its depth, from one camera and one scene.
    let illustration: FigureIllustration | null = null
    let engineTreeHeight: number | null | undefined
    // The engine's pass with its trees drawn, for the screened pixel figure beside the ground one.
    let screened: ReturnType<typeof decodeClassRaster> | null = null
    // PGMaps' own capture: the DEM detail the map drew the seen blocks from, beside the run's (`terrainDetailNote`).
    let terrainDetail: NonNullable<SavedFigure['terrainDetail']> | null = null
    if (plan && eye) {
      let framed: Pick<Awaited<ReturnType<typeof captureFramed>>, 'image' | 'classes' | 'zones' | 'frameWidth'>
      if (engine) {
        const shot = await engineFigureCapture(engine, plan, eye, zoneLayers, classLayers.layers, phase)
        framed = shot.framed
        illustration = shot.illustration
        engineTreeHeight = shot.maxTreeHeightMeters
        if (shot.screened)
          screened = decodeClassRaster(
            shot.screened.data,
            shot.screened.width,
            shot.screened.height,
            engineClassPalette(partialPass),
          )
      } else {
        const pgmaps = await captureFramed(
          map,
          plan,
          eye,
          classLayers.layers,
          zoneLayers.length ? zoneLayers : null,
          thinPoints(visibleBlockPoints),
          otherPasses,
        )
        framed = pgmaps
        otherRasters = pgmaps.landforms
        // The detail the map drew the seen blocks' ground from, beside the run's: far ground is drawn coarser.
        const drawnZoom = pgmaps.drawnDemZoom
        if (drawnZoom !== null && result) {
          const lat = visibleBlockPoints.reduce((sum, point) => sum + point[1], 0) / visibleBlockPoints.length
          terrainDetail = {
            drawnCellMeters: demResolutionMeters(lat, drawnZoom),
            runCellMeters: result.demResolutionMeters,
          }
        }
      }
      if (!framed.classes) throw new Error('The class pass of the framed view could not be taken.')
      classes = decodeClassRaster(
        framed.classes.data,
        framed.classes.width,
        framed.classes.height,
        illustration ? engineClassPalette(partialPass) : classPaletteEntries(partialPass),
      )
      if (framed.zones)
        zones = decodeClassRaster(framed.zones.data, framed.zones.width, framed.zones.height, ZONE_PALETTE)
      project = projectToFrames(plan.frames, eye, { frameWidth: framed.frameWidth, height: framed.image.height })
      // A fixed frame keeps its own rows (water and sky as the reference shows them).
      crop = figureFrame ? null : landformCropRows(classes)
      landformRows = landformCropRows(classes)
      frameImage = { ...framed.image, caption: `${at.name}.` }
      const terrainNote = terrainDetailNote(terrainDetail)
      // The note as a clause of the view line: "The map draws …" reads "; the map draws …".
      lens = `framed: ${plan.label}${terrainNote ? `; ${terrainNote[0].toLowerCase()}${terrainNote.slice(1, -1)}` : ''}`
      hfovDeg = plan.totalHfovDeg
      frames = plan.frames.length
      // The centre line of all the frames together, in [0, 360): a first frame left of north would read 372.5°.
      azimuth = wrapBearing(plan.frames[0].bearingDeg + (plan.totalHfovDeg - plan.frames[0].hfovDeg) / 2)
    } else {
      // No pose or no terrain yet: the class pass of the view as it stands.
      const pass = await captureClassPass(map, classLayers.layers)
      classes = decodeClassRaster(pass.data, pass.width, pass.height, classPaletteEntries(partialPass))
      for (const layers of otherPasses) otherRasters.push(await captureClassPass(map, layers).catch(() => null))
      const canvas = map.getCanvas()
      const scale = pass.width / Math.max(1, canvas.clientWidth)
      const bearing = map.getBearing()
      // MapLibre projects a point behind the camera onto the screen too; those are left out.
      project = (lng, lat) => {
        if (at.eye) {
          const turn = ((bearingDegrees(at.eye, { lng, lat }) - bearing + 540) % 360) - 180
          if (Math.abs(turn) > 89) return null
        }
        const point = map.project([lng, lat])
        return [point.x * scale, point.y * scale]
      }
      const focal = 18 / Math.tan((at.fov * Math.PI) / 360)
      lens = `road view, ${Math.round(at.fov)}° horizontal (${Math.round(focal)} mm full-frame equivalent), facing ${Math.round((bearing + 360) % 360)}°`
    }
    // Blocks the view sees (or may glimpse, or cannot tell) are called out; the rest are listed once in the facts,
    // not as a pile of "Likely Not Visible" labels over the skyline.
    const allBlockCallouts = blockCallouts(
      blockSights,
      at.stationIndex,
      project,
      classes,
      'Block ',
      eye ?? at.eye ?? null,
    )
    const hiddenBlocks = allBlockCallouts.filter((callout) => callout.status === 'not visible')
    // Each other landform's counts, through the same decode and tally as the landform's own; one the view does not
    // see is left out.
    const blockTargets = scene.targets.filter((target) => target.role === 'block')
    // The blocks with ground in the figure's own landform, read as the other landforms' are: the report cites each
    // block on the landform it lies in, never on this one by default.
    const landformBlocks = landform ? blocksInLandform(blockTargets, landform.geometry) : null
    const landformReadings: NonNullable<SavedFigure['landforms']> = otherLandforms.flatMap((target, i) => {
      const raster = otherRasters[i]
      if (!raster) return []
      const decoded = decodeClassRaster(raster.data, raster.width, raster.height, classPaletteEntries(partialPass))
      const counts = countClasses(decoded)
      // Its outline and the place for its name, traced from its own pass (only the pass carries occlusion); the
      // name is placed in the rows the sheet keeps round the figure's own landform.
      return counts.landform > 0
        ? [
            {
              id: target.id,
              name: target.name,
              objective: EVQO_CODE_FOR_CLASS[target.objectiveId] ?? null,
              counts,
              blocks: blocksInLandform(blockTargets, target.geometry),
              ...traceLandform(decoded, landformRows),
            },
          ]
        : []
    })
    const callouts = [
      ...allBlockCallouts
        .filter((callout) => callout.status !== 'not visible')
        .map((callout) => ({ ...callout, priority: callout.visiblePercent })),
      // Existing openings the station sees, as secondary labels (small and plain in the boxless styles).
      ...blockCallouts(openingSights, at.stationIndex, project, classes, '')
        .filter((callout) => callout.status === 'visible' || callout.status === 'possible glimpses')
        .slice(0, 6)
        .map((callout) => ({ ...callout, body: undefined, secondary: true })),
    ]
    // Dividers and lines of force, cut to where the picture shows the landform. Their ground height
    // comes from the terrain, so the pinhole projector of a framed capture places them on it.
    // Drawn from the open scene's landform: a view saved against another landform takes none.
    const sameLandform = (landform?.geometry ?? null) === (sceneLandform?.geometry ?? null)
    const lines: Overlay[] = (sameLandform ? figureLines : []).flatMap((line) => {
      const parts = visibleLineParts(
        line.points.map(([lng, lat]) => project(lng, lat, ground?.elevationAt(lng, lat) ?? 0)),
        classes,
        inLandform,
      )
      return parts.length ? [{ role: line.role, parts }] : []
    })
    const breakdown = result?.perspectiveByStation[at.stationIndex] ?? null
    const percent = breakdown ? breakdown.cumulativePercent : null
    const station = result?.stations[at.stationIndex]
    // Step 1's lookup and the scene's own read (the EVQO drape's, Save & export's), whichever has been made.
    const sceneUnits = sceneInventoryRef.current.units
    const badgeUnits =
      inventory.status === 'ready'
        ? [...inventory.units, ...(sceneUnits ?? []).filter((unit) => !inventory.units.some((u) => u.id === unit.id))]
        : (sceneUnits ?? [])
    const inventoryRead = inventory.status === 'ready' || !!sceneUnits
    const inventoryAt: InventoryBadgeInput = {
      visibleBlockPoints: thinPoints(visibleBlockPoints),
      landformUnitId: landform?.inventoryUnitId ?? null,
      landform: landform?.geometry ?? null,
    }
    const badge = inventoryBadge(badgeUnits, { ...inventoryAt, read: inventoryRead })
    const partialCuts = figurePartialCuts()
    const nearest = callouts
      .filter((callout) => !callout.secondary)
      .map((callout) => result?.targets.find((target) => target.targetId === callout.blockId))
      .flatMap((target) => (target?.nearestVisibleDistanceMeters != null ? [target.nearestVisibleDistanceMeters] : []))
    return {
      classes,
      ...(frameImage ? { frameImage } : {}),
      callouts,
      stationIndex: at.stationIndex,
      sightlinePercent: percent,
      sightlineClass: percent === null ? null : (table2Class(percent)?.label ?? null),
      lens,
      distanceKm: nearest.length ? Math.min(...nearest) / 1000 : null,
      hfovDeg,
      facts: [
        {
          label: 'Viewpoint',
          value: `${scene.viewpoint.name || 'Road'}${station ? `, ${(station.distanceAlongMeters / 1000).toFixed(2)} km` : ''}`,
        },
        ...(at.eye ? [{ label: 'Location', value: `${at.eye.lat.toFixed(5)}, ${at.eye.lng.toFixed(5)}` }] : []),
        ...(nearest.length
          ? [{ label: 'Distance to block', value: `${(Math.min(...nearest) / 1000).toFixed(1)} km` }]
          : []),
        ...(hiddenBlocks.length
          ? [
              {
                label: 'Not visible from here',
                value:
                  hiddenBlocks.length <= 3
                    ? hiddenBlocks.map((callout) => callout.title.replace(/^Block /, '')).join(', ')
                    : `${hiddenBlocks.length} blocks (${hiddenBlocks
                        .slice(0, 2)
                        .map((callout) => callout.title.replace(/^Block /, ''))
                        .join(', ')} and ${hiddenBlocks.length - 2} more)`,
              },
            ]
          : []),
      ],
      rating: badge.unit ? badge.values : null,
      ratingNote: badge.note,
      inventoryAt,
      area: landform?.name ?? 'Landform',
      viewpoint: at.name,
      ...(scene.viewpoint.name ? { place: scene.viewpoint.name } : {}),
      ...(hiddenBlocks.length ? { hidden: hiddenBlocks } : {}),
      inventoryRead,
      splitFailed: classLayers.failed,
      lines,
      ...(zones ? { zones } : {}),
      ...(crop ? { crop } : {}),
      ...(landformRows ? { landformRows } : {}),
      camera: {
        frames,
        focalMm: focalForHfov(hfovDeg / frames),
        fovDeg: hfovDeg,
        observerHeightM: scene.settings.observerHeightMeters,
        above: eye && basemap.water.some((water) => pointInPolygon(water, eye.lng, eye.lat)) ? 'lake level' : 'ground',
        lng: eye?.lng ?? at.eye?.lng ?? scene.viewpoint.coordinates[0]?.[0] ?? 0,
        lat: eye?.lat ?? at.eye?.lat ?? scene.viewpoint.coordinates[0]?.[1] ?? 0,
        elevationM: eye?.elevation ?? 0,
        ...(at.pose?.eyeSurveyed ? { surveyed: true } : {}),
        azimuthDeg: azimuth,
        maxTreeHeightM:
          engineTreeHeight !== undefined
            ? engineTreeHeight
            : drive.forest && result?.renderStands?.length
              ? Math.max(...result.renderStands.map((stand) => stand.heightMeters))
              : null,
        renderedOn: new Date(),
      },
      ...(illustration ? { illustration } : {}),
      ...(screened ? { screened } : {}),
      ...(partialCuts.length ? { partialCuts } : {}),
      ...(landformReadings.length ? { landforms: landformReadings } : {}),
      ...(landformBlocks ? { landformBlocks } : {}),
      ...(terrainDetailNote(terrainDetail) ? { terrainDetail: terrainDetail! } : {}),
    }
  }
  /**
   * The sheet's frames drawn by the engine in the road view: a scene with terrain out past the landform and blocks
   * (`captureTerrain`), then the capture of the plan's frames at the eye, checked against what was asked.
   */
  const engineFigureCapture = async (
    engine: EngineCaptureHandle,
    plan: FramingPlan,
    eye: { lng: number; lat: number; elevation: number },
    zoneLayers: readonly ClassPassLayer[],
    layers: readonly ClassPassLayer[],
    phase: HarvestPhase,
  ) => {
    const forest = forestFor(phase)
    // Real ground out to the frames' skyline: the preview's own terrain where it has posts, coarser mosaics past it,
    // out to the farthest skyline point the frames show (`skylineReach`), then the package's grids sized from it.
    const look = plan.frames.map((frame) => frameBearingRange(frame))
    const nearTerrain = captureTerrain(eye, layers)
    // VRI's open ground over the capture's terrain out to `farTerrain`, read beside the skyline (never rejects).
    const coverRead = fetchSceneCover(eye, nearTerrain.farTerrainRadiusMeters)
    const skyline = await loadSkylineTerrain(previewTerrain.source, eye, nearTerrain.farTerrainRadiusMeters, { look })
    const terrain = captureTerrain(eye, layers, undefined, skyline.reach)
    const first = plan.frames[0]
    const frameWidth = Math.floor(FRAMED_WIDTH / plan.frames.length)
    const height = Math.round(
      frameWidth * (Math.tan((first.vfovDeg * Math.PI) / 360) / Math.tan((first.hfovDeg * Math.PI) / 360)),
    )
    const scenePackage = currentScenePackage(eye, {
      includeModels: false,
      forest,
      harvestPhase: phase,
      cover: await coverRead,
      terrainRadiusMeters: terrain.terrainRadiusMeters,
      terrainSpacingMeters: terrain.terrainSpacingMeters,
      treeRadiusMeters: terrain.treeRadiusMeters,
      ...(skyline.source
        ? {
            farTerrainRadiusMeters: terrain.farTerrainRadiusMeters,
            farTerrainSpacingMeters: terrain.farTerrainSpacingMeters,
            skylineTerrainRadiusMeters: terrain.skylineTerrainRadiusMeters,
            skylineTerrainSpacingMeters: terrain.skylineTerrainSpacingMeters,
            elevation: skyline.source,
          }
        : {}),
    })
    // The report's still: the frame's forest regrown at real density with the road view's own near-band rules
    // (`finalStand.ts`), out past the landform within the frames' bearings. An engine that ignores `quality` draws
    // the active capture and reports no `final`.
    // It grows (in slices, on this thread) while the engine builds the scene in its own process: the scene is sent
    // first and the request waits for the stand, where the stand used to hold the scene back by its whole build.
    const standGround = skyline.source ?? previewTerrain.source
    const growing = standGround
      ? buildFinalStand({
          origin: eye,
          eye,
          radiusMeters: finalStandRadius(terrain.reachMeters),
          bearings: finalStandBearings(plan.frames),
          forest,
          elevation: standGround,
        })
      : Promise.resolve(null)
    // A capture that fails before its request is made must not leave the stand's own failure unhandled.
    growing.catch(() => {})
    const asked: { request: EngineCaptureRequest | null } = { request: null }
    const raw = await engine.capture(scenePackage, async (pkg, renderOptions) => {
      const stand = await growing
      asked.request = captureRequest({
        origin: pkg.origin,
        eye,
        frames: plan.frames,
        frameWidth,
        height,
        layers,
        terrainColour: CLASS_PASS_BACKGROUND,
        zones: zoneLayers.length ? { layers: zoneLayers, terrainColour: zoneColor(6) } : null,
        final: {
          stand: stand ? moveStandOrigin(stand, eye, pkg.origin) : null,
          samples: captureSamplesFromUrl(),
          canopyCutoffPx: renderOptions?.dissolvePixels,
        },
      })
      return asked.request
    })
    const request = asked.request
    if (!request) throw new Error(`${engine.label} did not take the capture.`)
    const stand = await growing
    const reply = readCaptureReply(raw, request)
    const mismatch = cameraMismatch(reply, request)
    if (mismatch) throw new Error(`${engine.label}: ${mismatch}`)
    const joined = await joinEngineCapture(reply, request)
    const km = (metres: number) => `${(metres / 1000).toFixed(1)} km`
    const illustration: FigureIllustration = {
      renderer: engine.label,
      version: reply.version,
      capturedAt: new Date().toISOString(),
      sceneCreatedAt: reply.scene.createdAt,
      environment: reply.environment,
      ...(reply.renderOptions ? { renderOptions: reply.renderOptions } : {}),
      ...(reply.representation ? { representation: reply.representation } : {}),
      ...(reply.dissolve ? { dissolve: reply.dissolve } : {}),
      depth: depthSummary(joined.depth.data),
      missingDetail: reply.missingDetail,
      missing: [
        ...reply.missing,
        ...(terrain.clipped ? [`landform past ${km(terrain.terrainRadiusMeters)} cut`] : []),
        ...(skyline.source ? [] : ['skyline terrain not loaded']),
      ],
      final: reply.final ?? null,
      stand: stand
        ? { stems: stand.count, radiusMeters: stand.radiusMeters, clipped: stand.clipped, millis: stand.millis }
        : null,
    }
    return {
      framed: { image: joined.image, classes: joined.classes, zones: joined.zones, frameWidth: joined.frameWidth },
      screened: joined.screened,
      illustration,
      maxTreeHeightMeters: reply.maxTreeHeightMeters,
    }
  }
  /**
   * *Save viewpoint*, and a planned view's capture (`useViewCapture`, with `planned`): saves the road view as it
   * stands, takes its screenshot, then its framed class pass. Resolves once the analysis sheet is drawn (or could not
   * be), which is when the eye camera is the reviewer's again; a capture waits for it before turning the camera.
   */
  const saveView = (
    planned: {
      /** The planned view's name, id and `viewCaptureKey`, its lens (horizontal degrees) and framing. */
      name: string
      plannedViewId: string
      plannedKey: string
      lensHfov: number
      framing: 'landform' | 'single'
    } | null = null,
  ): Promise<ViewSaveOutcome> => {
    if (!canSaveView) return Promise.resolve({ error: 'The road view was not ready to save.' })
    // A view saved by hand is a view of interest too (`handSaveLink`): the capture of the planned view stood at, or
    // a view listed where the eye stands. It is tagged as that view's capture; its picture is framed as before.
    const caption = captionForView(eyeMapRef.current?.getBearing() ?? null).replace(/\.$/, '')
    const hand = planned
      ? null
      : handSaveLink({
          views: viewsOfInterest,
          standingView: summaryView,
          pose: drivePoseRef.current,
          blocks: viewBlocks,
          lookAtTargetId: drive.lookAtTargetId,
          fallbackBlockId: summaryBlock?.id ?? selectedTargetId,
          focalMm: roadViewLens,
          name: caption,
        })
    const link = planned
      ? { plannedViewId: planned.plannedViewId, plannedKey: planned.plannedKey }
      : hand && hand.kind !== 'none'
        ? { plannedViewId: hand.view.id, plannedKey: viewCaptureKey(hand.view) }
        : null
    // A recapture replaces the planned view's earlier saves, wherever they were saved. A hand save replaces only
    // those under this scene: one under another design stays, for the design comparison.
    const replaced = planned
      ? withoutPlannedView(savedViews, shelvedViews, planned.plannedViewId)
      : hand?.kind === 'update'
        ? withoutPlannedView(savedViews, [], hand.view.id)
        : null
    const keptViews = replaced?.saved ?? savedViews
    if (keptViews.length >= MAX_SAVED_VIEWS) {
      const reason = 'Twelve comparisons are saved. Remove one or download this preview before starting another.'
      setPreviewMessage(reason)
      return Promise.resolve({ error: reason })
    }
    // Which saved design alternative this is, so the report can set it beside the same view under another.
    const design = matchingDesign(scene, tools.designOptions)
    const view: SavedDriveView = {
      id: createId('view'),
      ...(design ? { designName: design.name } : {}),
      // The caption without its full stop: it is also the option label "… · 0.60 km".
      name: planned?.name ?? (hand && hand.kind !== 'none' ? hand.view.name : caption),
      positionMeters: drive.positionMeters,
      lookAtTargetId: drive.lookAtTargetId,
      ...(drive.lookBearing !== null ? { lookBearing: drive.lookBearing } : {}),
      ...(link ?? {}),
      ...cameraLook.current,
      treeHeightMeters: drive.treeHeightMeters,
      roadClearWidthMeters: drive.roadClearWidthMeters,
      harvestPhase: drive.harvestPhase,
      existingForest: drive.existingForest,
      projectRecordedHeights: drive.projectRecordedHeights,
      growthMetersPerYear: drive.growthMetersPerYear,
      regenerationLagYears: drive.regenerationLagYears,
    }
    // The screenshot for the block note, taken from the frame being saved, with what produced it
    // and, where a field photo is lined up, the photo itself; then the class pass of the same camera
    // for its VIA figure (FigureSheetPanel).
    const map = eyeMapRef.current
    // The lens the view is saved with: the planned view's, else the road view's own when one is set.
    const lensHfov = planned?.lensHfov ?? (roadViewLens ? lensHfovDeg(roadViewLens) : undefined)
    let finished: Promise<ViewSaveOutcome> = Promise.resolve({ viewId: view.id })
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
          {
            label: 'Lens',
            value: lensHfov
              ? `${Math.round(focalForHfov(lensHfov))} mm full-frame equivalent, ${lensHfov.toFixed(1)}° across`
              : `${Math.round(map.getVerticalFieldOfView())}° vertical field of view`,
          },
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
      const at = {
        stationIndex: driveStationIndex,
        eye: cameraEye,
        fov: viewerFov,
        name: view.name,
        pose: drivePoseRef.current,
        // A planned view is framed with its own lens, never a field photo's.
        photoHfov: photoLook && !planned ? fieldPhoto.viewHfov : null,
        ...(lensHfov ? { lensHfov } : {}),
        ...(planned ? { framing: planned.framing } : {}),
        // The frame and landform it is saved with: an earlier view keeps its own after the viewpoint changes.
        figureFrame: scene.figureFrame ?? null,
        landform: sceneLandform
          ? {
              geometry: sceneLandform.geometry,
              name: sceneLandform.name,
              inventoryUnitId: sceneLandform.inventoryUnitId ?? null,
            }
          : null,
      }
      finished = (async (): Promise<ViewSaveOutcome> => {
        let image: Awaited<ReturnType<typeof captureMapImage>>
        try {
          image = await captureMapImage(map)
        } catch {
          setPreviewMessage(`Saved ${view.name}, but its screenshot could not be taken.`)
          return { viewId: view.id, warning: 'Saved, but its screenshot could not be taken.' }
        }
        setViewImages((current) => ({
          ...current,
          [view.id]: { ...image, caption, savedAt, viewpoint, figureAt: at },
        }))
        // Another engine takes seconds to draw the sheet's frames: say so, and say who drew them.
        const engine = drive.renderer !== 'pgmaps' ? engineCaptureRef.current : null
        if (engine) setPreviewMessage(`Saved ${view.name}. ${engine.label} is drawing its analysis sheet…`)
        try {
          // Tried twice: under load the framed view's terrain can take longer to settle than one read waits, and the
          // second try finds its tiles loaded. The camera is the drive's again between tries (`captureFramed`).
          let figure: SavedFigure
          try {
            figure = await captureViewFigure(map, at)
          } catch (first) {
            // Another engine's capture has its own budget and reports why; it is not drawn twice.
            if (engine) throw first
            setPreviewMessage(`Saved ${view.name}. Drawing its analysis sheet again…`)
            figure = await captureViewFigure(map, at)
          }
          setViewImages((current) =>
            current[view.id] ? { ...current, [view.id]: { ...current[view.id], figure } } : current,
          )
          if (figure.illustration)
            setPreviewMessage(`Saved ${view.name}. Its analysis sheet is drawn by ${figure.illustration.renderer}.`)
          else setPreviewMessage(`Saved ${view.name}. Its analysis sheet is ready.`)
          return { viewId: view.id }
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error)
          const warning = engine
            ? `${engine.label} could not draw its analysis sheet: ${why}`
            : `Its analysis sheet could not be drawn: ${why}`
          // Kept with the view: the files that draw figures name it with this reason (`unprintedViews`).
          setViewImages((current) =>
            current[view.id] ? { ...current, [view.id]: { ...current[view.id], figureError: why } } : current,
          )
          setPreviewMessage(`Saved ${view.name}, but ${warning[0].toLowerCase()}${warning.slice(1)}`)
          return { viewId: view.id, warning: `Saved, but ${warning[0].toLowerCase()}${warning.slice(1)}` }
        }
      })()
      if (photo?.thumbUrl) {
        void captureImageUrl(photo.thumbUrl).then((image) => {
          if (!image) return
          const photoCaption = `Mapillary ${photo.capturedAt?.slice(0, 10) ?? 'photo'}${photo.creator ? ` by ${photo.creator}` : ''}, facing ${Math.round(photo.bearing)}°.`
          setViewImages((current) => {
            const entry = current[view.id]
            const withPhoto = {
              ...viewpoint,
              photo: { ...image, caption: photoCaption, takenOn: photo.capturedAt?.slice(0, 10) ?? null },
            }
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
    if (planned) setShelvedViews((current) => withoutPlannedView([], current, planned.plannedViewId).shelved)
    const removed = new Set(replaced?.removed)
    if (removed.size)
      setViewImages((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removed.has(id))))
    if (hand?.kind === 'add') setViewsOfInterest((current) => addViews(current, [hand.view]).views)
    setSaved({ key, views: [...keptViews, view] })
    setPreviewMessage(
      hand?.kind === 'none'
        ? `Saved ${view.name}. ${hand.reason}`
        : hand
          ? `Saved ${view.name} with the views of interest. Save & export keeps or shares it.`
          : `Saved ${view.name}. Save & export keeps or shares it.`,
    )
    return finished
  }
  // What a capture of planned views (`useViewCapture`) reads and does, rebuilt on every render so each step of a
  // batch acts on the page as it is then (its closures hold this render's scene, run and saved views).
  viewCaptureHostRef.current = {
    views: viewsOfInterest,
    facts: (): CaptureFacts => {
      const pose = drivePoseRef.current
      const eyeMap = eyeMapRef.current
      const canvas = eyeMap?.getCanvas()
      return {
        key,
        runFresh: !!result,
        runRunning: analysis.state.status === 'running',
        runError: analysis.state.status === 'error' ? (analysis.state.error ?? 'the run failed.') : null,
        roadViewOpen: drive.active && !preliminaryDrive,
        canSave: canSaveViewRef.current,
        saveBlocker: saveBlockerRef.current,
        lookAtTargetId: drive.lookAtTargetId,
        lookBearing: drive.lookBearing,
        poseBearing: pose ? wrapBearing(pose.bearing) : null,
        blockBearing: pose && lookAtTarget && drive.lookAtTargetId ? bearingDegrees(pose, lookAtTarget) : null,
        lensMm: roadViewLens,
        // A lined-up field photo's lens holds the road view while it is compared (`DriveCamera`).
        lensApplied:
          !photoLook &&
          lensApplied(
            roadViewLens,
            eyeMap && canvas
              ? {
                  verticalFovDeg: eyeMap.getVerticalFieldOfView(),
                  width: canvas.clientWidth,
                  height: canvas.clientHeight,
                }
              : null,
          ),
      }
    },
    stand: (view, options) => {
      const block = scene.targets.find((target) => target.id === view.blockId && target.role === 'block')
      if (!block) return { error: 'Its block is no longer in the scene.' }
      if (view.landformId && !scene.targets.some((t) => t.id === view.landformId && t.role === 'landscape'))
        return { error: 'Its landform is no longer in the scene.' }
      const source = view.source
      const candidate = source.kind === 'map' ? null : viewpointCandidates.find((entry) => entry.key === source.key)
      // A field photo's lens would hold the road view: standing elsewhere ends the comparison.
      if (fieldPhoto.match) fieldPhoto.setMatch(null)
      setRoadViewLens(view.focalMm)
      // A view with no landform of its own reads the landform the reviewer chose: the one active when a batch
      // started, or, standing at views one after another, the one active before the first view's was made active.
      const base = captureBaseLandform.current ?? (standing?.landform ? { id: standing.landform.reviewer } : null)
      const nextKey = standAtPlace(
        { ...standPlace(view, candidate?.name), lng: view.lng, lat: view.lat },
        block,
        standFacing(view),
        view.landformId ? { activeLandformId: view.landformId } : base ? { activeLandformId: base.id } : {},
        options,
      )
      return nextKey ? { key: nextKey } : { error: 'Its block has no centre to face.' }
    },
    face: (view) => {
      setRoadViewLens(view.focalMm)
      updateDrive({ ...standFacing(view), playing: false })
    },
    save: (view) =>
      saveView({
        name: view.name,
        plannedViewId: view.id,
        plannedKey: viewCaptureKey(view),
        lensHfov: viewLensHfov(view),
        framing: view.framing,
      }),
    savedViewIds: () => [...savedViews, ...shelvedViews.flatMap((entry) => entry.views)].map((view) => view.id),
    // Each view's before-harvest render, taken while the road view still stands at its place; `captureBeforeRenders`
    // puts the harvest phase back. Kept by saved view id with the planned view's key it was taken under.
    before: async (saved) => {
      const { renders, notes } = await captureBeforeRenders(saved)
      const taken = saved.filter((entry) => renders[entry.id])
      if (taken.length)
        setCapturedBefore((current) => ({
          ...current,
          ...Object.fromEntries(
            taken.map((entry) => [entry.id, { plannedKey: entry.plannedKey, render: renders[entry.id] }]),
          ),
        }))
      return { taken: taken.map((entry) => entry.id), notes }
    },
    snapshot: () => {
      // Standing at a planned view whose landform the stand made active, the reviewer's own is the batch's base.
      captureBaseLandform.current = {
        id:
          standing?.landform && (scene.activeLandformId ?? null) === standing.landform.set
            ? standing.landform.reviewer
            : scene.activeLandformId,
      }
      return {
        viewpoint: scene.viewpoint,
        activeLandformId: scene.activeLandformId,
        standing,
        roadViewOpen: drive.active && !preliminaryDrive,
        hadRun: !!result,
        positionMeters: drive.positionMeters,
        lookAtTargetId: drive.lookAtTargetId,
        lookBearing: drive.lookBearing,
        lens: roadViewLens,
      }
    },
    restore: (back) => {
      captureBaseLandform.current = null
      setRoadViewLens(back.lens)
      const nextKey = moveViewpoint(back.viewpoint, { activeLandformId: back.activeLandformId })
      setStanding(back.standing)
      if (back.roadViewOpen) {
        if (driveRef.current.active) setRoadViewHeld(true)
        setDrive((current) => ({ ...current, active: false, playing: false }))
        setStandRequest((current) => ({
          serial: (current?.serial ?? 0) + 1,
          positionMeters: back.positionMeters,
          lookAtTargetId: back.lookAtTargetId,
          lookBearing: back.lookAtTargetId ? null : back.lookBearing,
        }))
      } else {
        setRoadViewHeld(false)
        setDrive((current) => ({ ...current, active: false, playing: false }))
        // The run the reviewer had is made again for where they stood. None is started where there was none, and the
        // last place's run is let go: kept, it read as the reviewer's scene changed ("Scene changed — rerun").
        if (back.hadRun && nextKey !== key)
          runForScene({ ...sceneRef.current, activeLandformId: back.activeLandformId, viewpoint: back.viewpoint })
        else if (!back.hadRun) analysis.reset()
      }
    },
  }
  /** The road view's scene for other renderers (`scenePackage.ts`), round an eye or the drive's own. */
  const currentScenePackage = (
    at: { lng: number; lat: number } | null = null,
    size: {
      terrainRadiusMeters?: number
      terrainSpacingMeters?: number
      treeRadiusMeters?: number
      farTerrainRadiusMeters?: number
      farTerrainSpacingMeters?: number
      skylineTerrainRadiusMeters?: number
      skylineTerrainSpacingMeters?: number
      /** Ground to read in place of the preview's own (a capture's, reaching the skyline). */
      elevation?: ElevationSource
      /** A capture's own VRI read for `terrain.cover`, beside the run's. */
      cover?: SceneCoverSource
      /** The stand in another harvest phase than the road view's (`forestFor`), with that phase. */
      forest?: typeof forestConfiguration
      harvestPhase?: HarvestPhase
      includeModels?: boolean
    } = {},
  ) => {
    const {
      elevation: groundOverride,
      cover: coverRead,
      forest = forestConfiguration,
      harvestPhase = drive.harvestPhase,
      ...sized
    } = size
    const map = eyeMapRef.current
    const ground = groundOverride ?? previewTerrain.source
    const pose = drivePoseRef.current
    const eye = at ?? pose ?? driveEye
    if (!map || !ground || !eye) throw new Error('Open the road view and let its terrain load first.')
    const canvas = map.getCanvas()
    const createdAt = new Date()
    return buildScenePackage({
      eye,
      eyeHeightMeters: result?.settings.observerHeightMeters ?? 1.5,
      ...(pose && eye.lng === pose.lng && eye.lat === pose.lat ? { eyeElevationMeters: pose.eyeElevationMeters } : {}),
      bearingDegrees: map.getBearing(),
      // MapLibre's pitch is 90° at the horizon.
      pitchDegrees: map.getPitch() - 90,
      verticalFovDegrees: map.getVerticalFieldOfView(),
      viewport: {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        pixelRatio: canvas.width / canvas.clientWidth,
      },
      environment: engineEnvironment(drive.engineEnvironment, eye, createdAt),
      createdAt,
      forest,
      elevation: ground,
      roadScars: previewRoadScar,
      water: basemap.water,
      cover: [...(coverRead ? [coverRead] : []), ...(result?.sceneCover ? [result.sceneCover] : [])],
      // Each opening's age and retention, aged to the year the regrowth is drawn for.
      targets: scene.targets,
      assessmentYear: visualYear,
      greenUpAgeYears: scene.settings.greenUpAgeYears,
      ...sized,
      notes: [
        `${scene.viewpoint.name || 'Viewpoint'}, ${(drive.positionMeters / 1000).toFixed(2)} km along the road, ${harvestPhase} harvest.`,
        'Terrain: the road view’s drawn ground (AWS Open Data CDEM/SRTM). Trees: VRI where recorded, the regional stand elsewhere.',
      ],
    })
  }
  const scenePackageFile = (): BuiltFile => {
    const scenePackage = currentScenePackage()
    return {
      blob: new Blob([JSON.stringify(scenePackage)], { type: 'application/json' }),
      fileName: 'forestry-scene-package.json',
    }
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
        setPreviewMessage(
          'The browser could not capture this map. Save the views in Save & export to keep the viewpoint instead.',
        )
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
    // A view listed with the views of interest is reopened from its row there; this lists only the rest.
    views: savedViews.filter(
      (view) => !view.plannedViewId || !viewsOfInterest.some((planned) => planned.id === view.plannedViewId),
    ),
    listedWithViews: savedViews.filter(
      (view) => view.plannedViewId && viewsOfInterest.some((planned) => planned.id === view.plannedViewId),
    ).length,
    onRestore: openPreview,
    onExport: () => exportOpener.openExport('views'),
    storageWarning: sceneStorageWarning ?? storageWarning,
    onRemoveView: (id: string) => setSaved({ key, views: savedViews.filter((v) => v.id !== id) }),
  }
  const assessmentProps = { scene, onChange: setScene }
  // The road view's View options (`RoadViewOptions.tsx`): the jump to a view of the block and the
  // arrows of the viewpoint stood at.
  const roadViewJump = !preliminaryDrive && (
    <OptionRow
      label="Go to a view"
      info={
        <InfoTip label="About these views">
          Places on the road where the terrain shows the most of the block, by the share of its ground in view. Trees in
          the foreground can still hide the opening.
        </InfoTip>
      }
    >
      <StyledSelect
        aria-label="Candidate viewpoint"
        className="h-7 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-2xs"
        value=""
        disabled={!stops.length}
        onChange={(e) => {
          const stop = stops[Number(e.target.value)]
          if (stop) updateDrive({ positionMeters: stop.positionMeters, lookAtTargetId: stop.targetId, playing: false })
        }}
      >
        <option value="">{stops.length ? 'Choose…' : 'None: the terrain hides the block'}</option>
        {stops.map((stop, i) => (
          <option key={stop.index} value={i}>
            {(stop.positionMeters / 1000).toFixed(2)} km · {Math.round(stop.visiblePercent)}% in view
          </option>
        ))}
      </StyledSelect>
    </OptionRow>
  )
  const lookArrows = (standingCandidate?.arrows ?? []).map((arrow, index) => ({
    id: arrow.id,
    label: arrowLabel(arrow, index),
    bearing: arrow.bearing,
  }))
  // The views of interest are the tools' viewpoints: runs and photographs are filed under them by id.
  const plannedViews = useMemo(
    () => plannedToolViews(viewsOfInterest, viewBlocks, scene.viaReview),
    [viewsOfInterest, viewBlocks, scene.viaReview],
  )
  /** Lists a view of interest at a point (a photo's place, an earlier viewpoint), facing a block; its id, or null. */
  const listViewAt = (
    point: { lng: number; lat: number },
    name: string,
    extra: { id?: string; landformId?: string | null } = {},
  ): string | null => {
    const current = sceneRef.current.viewsOfInterest ?? []
    const blocks = sceneRef.current.targets.filter((target) => target.role === 'block')
    const block = blocks.find((target) => target.id === selectedTargetId) ?? blocks[0]
    if (!block) return null
    const landform =
      extra.landformId && sceneRef.current.targets.some((t) => t.id === extra.landformId && t.role === 'landscape')
        ? { landformId: extra.landformId }
        : {}
    const view = { ...viewAtPoint(point, block, current), name, ...(extra.id ? { id: extra.id } : {}), ...landform }
    const added = addViews(current, [view])
    if (added.views.length === current.length) return null
    setViewsOfInterest(() => added.views)
    return view.id
  }
  const tools = useAssessmentTools({
    plannedViews,
    onAddViewAt: (point, name) => listViewAt(point, name),
    onListView: (earlier) => {
      const spot = earlier.viewpoint.mode === 'spot' ? earlier.viewpoint.coordinates[0] : null
      if (!spot) return null
      const id = listViewAt({ lng: spot[0], lat: spot[1] }, earlier.name, {
        id: earlier.id,
        landformId: earlier.landformId,
      })
      // Its significance notes become the view's reason, unless the view's record already gives one.
      const notes = earlier.notes.trim()
      const records = sceneRef.current.viaReview?.viewpointRecords
      if (id && notes && !records?.[earlier.name]?.reason)
        updateViaReview({
          viewpointRecords: { ...records, [earlier.name]: { ...records?.[earlier.name], reason: notes } },
        })
      return id
    },
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
    onOpenExport: exportOpener.openExport,
  })
  /** Everything in progress as one file (`projectFile.ts`), for Save & export's Project. */
  const buildProjectFile = async () => {
    const { serializeProject, PROJECT_FILE_EXTENSION } = await import('./dev-forestry/projectFile')
    const text = await serializeProject({
      scene,
      views: savedViews,
      shelved: shelvedViews.filter((entry) => entry.key !== key && entry.views.length),
      images: viewImages,
      capturedBefore,
      engineFigures,
      workspace: tools.evidence.loaded ? tools.evidence.storedWorkspaceJson() : null,
      pkg: { renderer: exportOpener.figureRenderer, recipeId: exportOpener.packageRecipeId },
    })
    const name =
      scene.targets
        .find((target) => target.role === 'block')
        ?.name.replace(/[^\w-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'visual-quality'
    return {
      blob: new Blob([text], { type: 'application/json' }),
      fileName: `${name}-project${PROJECT_FILE_EXTENSION}`,
    }
  }
  /** Opens a project file: the scene, the saved views with their pictures, the workspace and the package's choices. */
  const openProjectFile = async (file: File) => {
    setImportMessage('Reading the project…')
    try {
      const { parseProject, projectOpenedLine, MAX_PROJECT_FILE_BYTES } = await import('./dev-forestry/projectFile')
      if (file.size > MAX_PROJECT_FILE_BYTES)
        throw new Error(`Use a project file smaller than ${Math.round(MAX_PROJECT_FILE_BYTES / 1024 / 1024)} MB.`)
      const { state, summary } = await parseProject(await file.text())
      cancelPreview()
      analysis.reset()
      runSnapshotRef.current = null
      setTerrainCandidates([])
      setReplacedLandform(null)
      setPendingPreview(null)
      setPreviewMessage(null)
      setCameraEye(null)
      setDrive(DEFAULT_DRIVE)
      setDrawMode('none')
      setDraftCoordinates([])
      setStanding(null)
      setScene(state.scene)
      setSaved({ key: sceneFingerprint(state.scene), views: state.views })
      setShelvedViews(state.shelved)
      setViewImages(state.images as typeof viewImages)
      setCapturedBefore(state.capturedBefore as typeof capturedBefore)
      setEngineFigures(state.engineFigures as typeof engineFigures)
      setSelectedTargetId(state.scene.targets.find((target) => target.role === 'block')?.id ?? null)
      if (state.pkg.renderer === 'pgmaps' || state.pkg.renderer === 'worldgen' || state.pkg.renderer === 'nanite')
        exportOpener.setFigureRenderer(state.pkg.renderer)
      exportOpener.setPackageRecipeId(state.pkg.recipeId)
      let workspaceNote = ''
      if (state.workspace) {
        try {
          tools.restoreWorkspace(state.workspace)
        } catch (error) {
          workspaceNote = ` The assessment workspace was not read: ${error instanceof Error ? error.message : 'it is not a workspace'}.`
        }
      }
      setImportMessage(projectOpenedLine(file.name, summary) + workspaceNote)
      window.setTimeout(() => fitBounds(sceneBounds(state.scene)), 50)
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'The project could not be opened.')
    }
  }
  // Saved views drawn again by another engine at final quality, in the background (`BackgroundRenders.tsx`).
  const captureViewFigureRef = useRef(captureViewFigure)
  captureViewFigureRef.current = captureViewFigure
  const viewImagesRef = useRef(viewImages)
  viewImagesRef.current = viewImages
  const roadTerrainRef = useRef(previewTerrain.source)
  roadTerrainRef.current = previewTerrain.source
  const backgroundRenders = useBackgroundRenders({
    urlFor: (engine) => roadRendererUrl(engine, import.meta.env, engineBrowserOptions),
    environment: drive.engineEnvironment,
    renderOptions: engineBrowserOptions.render,
    run: async (job, handle) => {
      const image = viewImagesRef.current[job.viewId]
      if (!image?.figureAt) throw new Error('its camera was not kept: save the view again.')
      // The road view's terrain reloads whenever the scene's polygons change (a report's run, an import): a job
      // started in that window had no terrain to frame on and drew the unframed road view instead of the engine's
      // frames. Wait it out; `captureViewFigureRef` is read after, so it holds the reloaded terrain.
      await waitUntil(() => !!eyeMapRef.current && !!roadTerrainRef.current, ROAD_VIEW_SETTLE_MS)
      const map = eyeMapRef.current
      if (!map) throw new Error('the road view is closed: open it, the engine draws from its terrain.')
      if (!roadTerrainRef.current) throw new Error('the road view’s terrain did not load: open the road view again.')
      // The view in its own harvest phase; a report's before picture before harvest, from the same engine as the
      // view's figure, so a before/after pair never compares two renderers.
      const phase = job.phase ?? image.viewpoint?.harvestPhase
      const figure = await captureViewFigureRef.current(map, image.figureAt, handle, phase)
      if (job.phase === 'before' && !(figure.illustration && figure.frameImage))
        throw new Error('the before picture could not be framed: the view has no pose or no terrain under it.')
      setEngineFigures((current) => ({ ...current, [job.key]: figure }))
    },
  })
  /**
   * The render job for a saved view by `engine`, sized from the figure it already has: its figure, or (`before`) the
   * same framing before harvest for a report's before picture. No before job for a view saved before harvest (its
   * figure is already one), one with a lined-up field photo (the photo is its before) or one without the drive's pose
   * (nothing to frame it on). None for a view saved at another place: an engine draws from the road view's terrain and
   * the run where the reviewer stands, which are not that view's (`ENGINE_ELSEWHERE`); its figures stay PGMaps'.
   */
  const renderJobFor = (viewId: string, engine: RenderEngineId, phase?: 'before'): RenderJob | null => {
    const image = viewImages[viewId]
    const figure = image?.figure
    if (!image?.figureAt || !figure) return null
    if (!savedViews.some((view) => view.id === viewId)) return null
    if (
      phase === 'before' &&
      (image.viewpoint?.harvestPhase === 'before' || image.viewpoint?.photo || !image.figureAt.pose)
    )
      return null
    const frames = figure.camera?.frames ?? 1
    const name = savedViews.find((view) => view.id === viewId)?.name ?? image.caption.replace(/\.$/, '')
    return {
      key: `${viewId}|${engine}|${key ?? ''}${phase ? `|${phase}` : ''}|${engineCaptureOptionsKey(engineBrowserOptions.render[engine])}`,
      viewId,
      viewName: phase ? `${name}, before harvest` : name,
      engine,
      renderOptions: { ...engineBrowserOptions.render[engine] },
      ...(phase ? { phase } : {}),
      work: {
        frames,
        width: Math.floor(FRAMED_WIDTH / frames),
        height: figure.frameImage?.height ?? figure.classes.height,
        samples: captureSamplesFromUrl() ?? FINAL_SAMPLES,
      },
    }
  }
  /** Shows the road view in a harvest phase and waits until its regrown stand could be saved; false on a timeout. */
  const showHarvestPhase = async (phase: 'before' | 'after') => {
    if (driveRef.current.harvestPhase === phase) return true
    return timed(`harvest phase ${phase}`, async () => {
      updateDrive({ harvestPhase: phase })
      await waitUntil(() => driveRef.current.harvestPhase === phase, 5000)
      // The stand is regrown for the phase: give it a moment to start, then wait until the view could be saved.
      await new Promise((resolve) => window.setTimeout(resolve, 600))
      return waitUntil(() => canSaveViewRef.current, 60_000)
    })
  }
  /**
   * Before-harvest renders of saved views from their own framed poses (`captureFramed`, the figure's framing, no class
   * pass), keyed by view id: the before pictures of the VIA report and the with-timber pixel figure
   * (`timberMeasureFor`), which compares each with the view's after picture. The harvest phase is put back in
   * `finally`. A view that cannot be rendered gets its reason in `absent` and a note.
   * A render a capture took where the view stands (`capturedBefore`, under the view's current planned key) is used
   * first. The road view draws only where the reviewer stands, so a view saved at another place without one is
   * absent, with why, rather than framed on terrain that is not under it.
   */
  const captureBeforeRenders = async (
    views: ReadonlyArray<{ id: string; name: string }>,
  ): Promise<{
    renders: Record<string, { dataUrl: string; width: number; height: number; caption: string }>
    absent: Record<string, string>
    notes: string[]
  }> => {
    const renders: Record<string, { dataUrl: string; width: number; height: number; caption: string }> = {}
    const absent: Record<string, string> = {}
    const notes: string[] = []
    const toRender: Array<{ id: string; name: string; at: FigureAt }> = []
    const shelved = shelvedViews.flatMap((entry) => entry.views)
    for (const view of views) {
      const image = viewImages[view.id]
      const saved = [...savedViews, ...shelved].find((entry) => entry.id === view.id)
      const kept = capturedBefore[view.id]
      if (image?.viewpoint?.harvestPhase === 'before') absent[view.id] = TIMBER_ABSENT.savedBefore
      else if (kept && kept.plannedKey === (saved?.plannedKey ?? null)) renders[view.id] = kept.render
      else if (!image?.figureAt?.pose) absent[view.id] = TIMBER_ABSENT.noBefore
      else if (shelved.some((entry) => entry.id === view.id)) {
        absent[view.id] = TIMBER_ABSENT.elsewhere
        notes.push(`${view.name}: ${TIMBER_ABSENT.elsewhere}.`)
      } else toRender.push({ id: view.id, name: view.name, at: image.figureAt })
    }
    if (!toRender.length) return { renders, absent, notes }
    const eyeMap = eyeMapRef.current as unknown as import('maplibre-gl').Map | null
    if (!eyeMap || !driveRef.current.active || !previewTerrain.source) {
      for (const entry of toRender) absent[entry.id] = TIMBER_ABSENT.roadViewClosed
      return { renders, absent, notes }
    }
    const phaseBefore = driveRef.current.harvestPhase
    try {
      if (!(await showHarvestPhase('before'))) {
        notes.push('The road view did not finish drawing before harvest, so the before renders were left out.')
        for (const entry of toRender) absent[entry.id] = TIMBER_ABSENT.noBefore
        return { renders, absent, notes }
      }
      for (const entry of toRender) {
        const framing = figureFramingFor(entry.at)
        if (!framing.plan || !framing.eye) {
          notes.push(`${entry.name}: the before render could not be framed (no terrain under the view yet).`)
          absent[entry.id] = TIMBER_ABSENT.noBefore
          continue
        }
        try {
          const shot = await captureFramed(eyeMap, framing.plan, framing.eye, null)
          renders[entry.id] = {
            ...shot.image,
            caption: `Before harvest: the road view from ${entry.name}, framed as its analysis figure (${framing.plan.label}), drawn without the proposed blocks.`,
          }
        } catch (error) {
          notes.push(
            `${entry.name}: the before render could not be taken: ${error instanceof Error ? error.message : String(error)}`,
          )
          absent[entry.id] = TIMBER_ABSENT.noBefore
        }
      }
    } finally {
      if (driveRef.current.harvestPhase !== phaseBefore) updateDrive({ harvestPhase: phaseBefore })
    }
    return { renders, absent, notes }
  }
  /**
   * The VIA report's maps and extra pictures, captured while the report file is built (Save & export, `via-report`):
   * the overview, the overview again as an 11 × 17 topographic sheet, a location map per viewpoint and the regional map
   * from the plan map (`reportMaps.ts`), each view's
   * before picture (its lined-up field photo, else a before-harvest render from the view's own framed pose) and
   * overhead and oblique renders of the blocks from the road view. Every capture puts the maps, the plan's look and the
   * harvest phase back in `finally`, and none writes to the scene. What cannot be captured is left out, with a note.
   */
  const captureReportImages = async (request: {
    /** The saved views the report prints, with the name the report gives each viewpoint. */
    views: ReadonlyArray<{ id: string; name: string }>
    /**
     * How the 11 × 17 overview sheet is drawn (`OverviewSheetStyle`), and the portrait end map's title block: the
     * printed logo and the project line. The landscape topographic sheet when absent.
     */
    overviewSheet?: {
      style: OverviewSheetStyle
      logo: import('@/lib/mapSheet/drawOps').RasterImage | null
      project: string | null
    }
    /** Map pitch of the oblique renders of the blocks, degrees (`ReportRecipe.obliquePitch`); 60 when absent. */
    obliquePitch?: number
    /** The report prints 26's figure page: also capture its own location and regional maps (`planFigurePageMaps`). */
    figurePageMaps?: boolean
    /**
     * Which groups to capture, when not all (the draft draws one at a time, and a build captures only the groups it
     * has not kept): the plan map's maps, each view's before picture, the overhead and oblique renders.
     */
    only?: { maps?: boolean; before?: boolean; renders?: boolean }
  }): Promise<{
    images: ReportImages
    notes: string[]
    /** The before-harvest renders by view id, for the with-timber pixel figure, and why a view has none. */
    beforeRenders: Awaited<ReturnType<typeof captureBeforeRenders>>
  }> => {
    const notes: string[] = []
    const images: {
      overviewMap?: ReportFigure
      overviewSheet?: ReportFigure
      regionalMap?: ReportFigure
      locationMaps: Record<string, ReportFigure>
      figurePageMaps?: {
        location: Record<string, ReportFigure>
        regional: ReportFigure | null
        regionalFor?: Record<string, ReportFigure>
      }
      before: Record<string, ReportFigure & { source: 'photo' | 'render'; takenOn?: string | null }>
      overhead: ReportFigure[]
    } = { locationMaps: {}, before: {}, overhead: [] }
    const viewpoints: ReportViewpoint[] = request.views.flatMap((view) => {
      const image = viewImages[view.id]
      const camera = image?.figure?.camera
      const pose = image?.figureAt?.pose
      const lng = camera?.lng ?? pose?.lng ?? image?.figureAt?.eye?.lng
      const lat = camera?.lat ?? pose?.lat ?? image?.figureAt?.eye?.lat
      if (lng === undefined || lat === undefined) return []
      return [
        {
          name: view.name,
          lng,
          lat,
          bearingDeg:
            camera?.azimuthDeg != null ? wrapBearing(camera.azimuthDeg) : (image?.viewpoint?.bearingDegrees ?? null),
          fovDeg: camera?.fovDeg ?? image?.figure?.hfovDeg ?? null,
        },
      ]
    })
    const features = reportMapFeatures({
      targets: scene.targets,
      units: inventory.status === 'ready' ? inventory.units : [],
      evqo: evqoCurrent && !evqoCurrent.error ? evqoCurrent.collection : null,
      road: scene.viewpoint.mode === 'corridor' ? (scene.viewpoint.coordinates as Array<[number, number]>) : null,
      viewpoints,
      masks: scene.masks ?? [],
    })
    const sheetStyle = request.overviewSheet?.style ?? DEFAULT_OVERVIEW_SHEET_STYLE
    const wants = (group: 'maps' | 'before' | 'renders') => !request.only || !!request.only[group]

    // The plan map: on imagery for the overview and location maps, on the vector map for the regional one, and on
    // the vector map with its hillshade for the 11 × 17 overview sheet (17:11, its own window of the canvas).
    let plan: import('maplibre-gl').Map | null = null
    if (wants('maps')) {
      setReportMapOn(true)
      const loaded = await waitUntil(() => {
        const map = reportMapRef.current as unknown as import('maplibre-gl').Map | null
        return !!map && !!map.isStyleLoaded()
      }, 30_000)
      plan = loaded ? (reportMapRef.current as unknown as import('maplibre-gl').Map) : null
    }
    const canvas = plan?.getCanvas()
    const frame = canvas
      ? captureFrame({ width: canvas.clientWidth, height: canvas.clientHeight }, REPORT_MAP_ASPECT.overview)
      : null
    const sheetFrame = canvas
      ? captureFrame({ width: canvas.clientWidth, height: canvas.clientHeight }, overviewSheetAspect(sheetStyle))
      : null
    if (!wants('maps')) {
      // Another group only: the plan map is not moved.
    } else if (!plan || !frame) {
      notes.push('The report’s capture map did not load, so the report has no overview, location or regional map.')
      setReportMapOn(false)
    } else if (frame.width < 240 || frame.height < 180)
      notes.push('The plan map pane is too small to capture the report’s maps; widen it and build the report again.')
    else {
      const sheet = sheetFrame ? planOverviewSheet(features, sheetFrame, sheetStyle) : null
      // 26's figure page draws its location and regional maps its own way, each from its own window of the canvas.
      const figurePagePlans =
        request.figurePageMaps && canvas
          ? planFigurePageMaps(features, { width: canvas.clientWidth, height: canvas.clientHeight })
          : []
      if (figurePagePlans.length) images.figurePageMaps = { location: {}, regional: null }
      const plans = [...planReportMaps(features, frame), ...(sheet ? [sheet] : []), ...figurePagePlans]
      try {
        for (const basemap of ['satellite', 'map', 'topo'] as const) {
          const group = plans.filter((entry) => entry.basemap === basemap)
          if (!group.length) continue
          setReportBasemap(basemap)
          if (!(await waitUntil(() => reportBasemapShown.current === basemap, 5000))) {
            notes.push(
              `The plan map did not switch to its ${basemap === 'satellite' ? 'imagery' : basemap === 'topo' ? 'topographic map' : 'vector map'} in time.`,
            )
            continue
          }
          for (const entry of group) {
            try {
              const {
                notes: mapNotes = [],
                byViewpoint,
                ...figure
              } = await captureReportMap(
                plan,
                entry,
                features,
                entry.frame ?? (entry.kind === 'sheet' && sheetFrame ? sheetFrame : frame),
                request.overviewSheet,
              )
              notes.push(...mapNotes)
              if (entry.style === 'figure-page' && images.figurePageMaps) {
                if (entry.kind === 'regional') {
                  images.figurePageMaps.regional = figure
                  if (byViewpoint) images.figurePageMaps.regionalFor = byViewpoint
                } else images.figurePageMaps.location[entry.key] = figure
              } else if (entry.kind === 'overview') images.overviewMap = figure
              else if (entry.kind === 'sheet') images.overviewSheet = figure
              else if (entry.kind === 'regional') images.regionalMap = figure
              else images.locationMaps[entry.key] = figure
            } catch (error) {
              notes.push(
                `The ${entry.style === 'figure-page' ? 'figure page’s ' : ''}${entry.kind === 'location' ? `location map for ${entry.key}` : entry.kind === 'sheet' ? '11 × 17 overview sheet' : `${entry.kind} map`} could not be captured: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }
      } finally {
        setReportBasemap(null)
        setReportMapOn(false)
      }
    }

    // Before pictures: a lined-up field photo, a view saved before harvest, else a render from the view's framed pose.
    // Every view saved after harvest is rendered before harvest, a photographed one too: the with-timber pixel figure
    // compares the render with the view's own after picture, which a photograph's framing cannot.
    const beforeRenders = wants('before')
      ? await captureBeforeRenders(request.views)
      : { renders: {}, absent: {}, notes: [] }
    notes.push(...beforeRenders.notes)
    for (const view of wants('before') ? request.views : []) {
      const image = viewImages[view.id]
      const photo = image?.viewpoint?.photo
      const render = beforeRenders.renders[view.id]
      if (photo) {
        images.before[view.name] = {
          view: view.name,
          caption: `Before: the lined-up field photograph from ${view.name}. ${photo.caption}`,
          dataUrl: photo.dataUrl,
          width: photo.width,
          height: photo.height,
          source: 'photo',
          takenOn: photo.takenOn ?? null,
        }
      } else if (image?.viewpoint?.harvestPhase === 'before' && image.figure?.frameImage) {
        const frameImage = image.figure.frameImage
        images.before[view.name] = {
          view: view.name,
          caption: `Before harvest: the road view from ${view.name} as saved, before harvest.`,
          dataUrl: frameImage.dataUrl,
          width: frameImage.width,
          height: frameImage.height,
          source: 'render',
        }
      } else if (render) images.before[view.name] = { view: view.name, ...render, source: 'render' }
      else if (!image?.figureAt?.pose)
        notes.push(`${view.name} has no before picture: no field photo was lined up and its camera was not kept.`)
    }
    const eyeMap = eyeMapRef.current as unknown as import('maplibre-gl').Map | null
    const roadViewReady = !!eyeMap && driveRef.current.active && !!previewTerrain.source
    const blocks = scene.targets.filter((target) => target.role === 'block')
    if (blocks.length && !roadViewReady && wants('renders'))
      notes.push(
        'The road view is closed, so the report has no before-harvest renders (field photos only) and no overhead renders: open it and build the report again.',
      )
    if (roadViewReady && eyeMap && wants('renders')) {
      const phaseBefore = driveRef.current.harvestPhase
      try {
        // Overhead and oblique renders of the blocks after harvest, as the road view draws them (01 p7).
        if (blocks.length && (await showHarvestPhase('after'))) {
          const ground = previewTerrain.source
          const eyeCanvas = eyeMap.getCanvas()
          const window_ = captureFrame({ width: eyeCanvas.clientWidth, height: eyeCanvas.clientHeight }, 4 / 3)
          const box = blocks.reduce<[number, number, number, number]>(
            (acc, block) => {
              const b = polygonBounds(block.geometry)
              return [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])]
            },
            [Infinity, Infinity, -Infinity, -Infinity],
          )
          const elevationAt = (lng: number, lat: number) => {
            const value = ground?.elevationAt(lng, lat)
            return value !== undefined && Number.isFinite(value) ? value : undefined
          }
          const overhead = fitCamera(box, window_, 0.08)
          try {
            const shot = await captureAtCamera(
              eyeMap,
              { ...overhead, elevation: elevationAt(...overhead.center) },
              window_,
            )
            images.overhead.push({
              view: 'overhead',
              caption: `Overhead render: ${blocks.length === 1 ? 'the proposed block' : `the ${blocks.length} proposed blocks`} after harvest, as the road view draws them on the terrain.`,
              dataUrl: shot.dataUrl,
              width: shot.width,
              height: shot.height,
            })
          } catch (error) {
            notes.push(
              `The overhead render could not be taken: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
          // Obliques of the blocks nearest the first viewpoint, looked at the way that viewpoint looks, at the
          // recipe's pitch: 60° looks down on the blocks (01 p7), about 75° stands near eye level on the viewpoint's
          // side (02's obliques).
          const obliquePitch = request.obliquePitch ?? DEFAULT_OBLIQUE_PITCH
          const from = viewpoints[0] ?? null
          const ranked = blocks
            .map((block) => ({ block, centre: polygonInteriorPoint(block.geometry) }))
            .filter((entry): entry is { block: TargetPolygon; centre: { lng: number; lat: number } } => !!entry.centre)
            .sort((a, b) => (from ? haversineMeters(from, a.centre) - haversineMeters(from, b.centre) : 0))
            .slice(0, 4)
          for (const { block, centre } of ranked) {
            const b = polygonBounds(block.geometry)
            const padX = (b[2] - b[0]) * 0.6,
              padY = (b[3] - b[1]) * 0.6
            const camera = fitCamera([b[0] - padX, b[1] - padY, b[2] + padX, b[3] + padY], window_, 0.05)
            const bearing = from ? bearingDegrees(from, centre) : 0
            try {
              const shot = await captureAtCamera(
                eyeMap,
                {
                  center: [centre.lng, centre.lat],
                  zoom: camera.zoom,
                  bearing,
                  // Through `horizonSafePitch` and with roll 0 in `captureAtCamera`, which puts the camera back.
                  pitch: obliquePitch,
                  elevation: elevationAt(centre.lng, centre.lat),
                },
                window_,
              )
              images.overhead.push({
                view: block.name,
                caption: `Oblique render: ${block.name} after harvest, looking ${Math.round(bearing)}°${from ? ` (from ${from.name}'s side)` : ''}.`,
                dataUrl: shot.dataUrl,
                width: shot.width,
                height: shot.height,
              })
            } catch (error) {
              notes.push(
                `The oblique render of ${block.name} could not be taken: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }
      } finally {
        if (driveRef.current.harvestPhase !== phaseBefore) updateDrive({ harvestPhase: phaseBefore })
      }
    }
    return {
      images: {
        overviewMap: images.overviewMap ?? null,
        overviewSheet: images.overviewSheet ?? null,
        regionalMap: images.regionalMap ?? null,
        locationMaps: images.locationMaps,
        figurePageMaps: images.figurePageMaps ?? null,
        before: images.before,
        overhead: images.overhead,
      },
      notes,
      beforeRenders,
    }
  }
  // The VIA report's setting (named places around the blocks, their ground, the stands): read from the run and the plan
  // map's loaded labels once per run, so the export dialog can ask on every render.
  const reportSettingCache = useRef<{ result: unknown; targets: unknown; value: ReportSetting } | null>(null)
  const getReportSetting = () => {
    const cached = reportSettingCache.current
    if (cached && cached.result === result && cached.targets === scene.targets) return cached.value
    const plan = mapRef.current as unknown as BasemapQueryMap | null
    let places: PlaceLabel[] = []
    try {
      places = plan ? collectPlacesFromMap(plan) : []
    } catch {
      places = []
    }
    const value = reportSetting({
      blocks: scene.targets.filter((target) => target.role === 'block').map((target) => target.geometry),
      targets: result?.targets ?? null,
      stands: result?.renderStands ?? null,
      places,
    })
    // A map that has not drawn its labels yet is asked again next time.
    if (places.length || !plan) reportSettingCache.current = { result, targets: scene.targets, value }
    return value
  }
  const prescriptionTarget = prescriptionTargetId
    ? (scene.targets.find((target) => target.id === prescriptionTargetId) ?? null)
    : null
  const prescriptionEntry = prescriptionTarget ? standPrescriptions.get(prescriptionTarget.id) : undefined
  const prescriptionDialog =
    prescriptionTarget?.prescription &&
    (prescriptionTarget.harvestSystem === 'retention' || prescriptionTarget.harvestSystem === 'partial') ? (
      <StandPrescriptionDialog
        open
        onClose={() => {
          setPrescriptionTargetId(null)
          setProfileStrip(null)
        }}
        blockName={prescriptionTarget.name}
        harvestSystem={prescriptionTarget.harvestSystem}
        block={prescriptionTarget}
        prescription={prescriptionTarget.prescription}
        onChange={(prescription) => handleTargetChange(prescriptionTarget.id, { prescription })}
        onRemove={() => {
          handleTargetChange(prescriptionTarget.id, { prescription: null })
          setPrescriptionTargetId(null)
        }}
        stand={prescriptionEntry?.stand ?? null}
        result={prescriptionEntry?.result ?? null}
        error={prescriptionEntry?.error ?? null}
        onAdopt={(figures) => handleTargetChange(prescriptionTarget.id, figures)}
        importedSource={prescriptionTarget.prescription.imported?.source ?? null}
        blockGeometry={prescriptionTarget.geometry}
        onImportTrees={(trees, source) =>
          handleTargetChange(prescriptionTarget.id, {
            // Protected trees were the old stand's: a new list starts with none.
            prescription: {
              ...prescriptionTarget.prescription!,
              imported: { source, packed: packImportedTrees(trees) },
              protectedKeys: [],
            },
          })
        }
        onClearImport={() =>
          handleTargetChange(prescriptionTarget.id, {
            prescription: { ...prescriptionTarget.prescription!, imported: null, protectedKeys: [] },
          })
        }
        onStripChange={setProfileStrip}
        onClearProtected={() =>
          handleTargetChange(prescriptionTarget.id, {
            prescription: { ...prescriptionTarget.prescription!, protectedKeys: [] },
          })
        }
      />
    ) : null

  const exportDialog = useVisualsExport({
    opener: exportOpener,
    prescribedStands,
    scene,
    setScene,
    sceneKey: key ?? '',
    result,
    stale: isStale,
    snapshot: result ? (runSnapshotRef.current?.scene ?? null) : null,
    assessment: viaAssessment,
    fs1252Review: viaAssessment ? fs1252ReviewFromVia(viaAssessment, viaReviewNow) : null,
    savedViews,
    otherViews: shelvedViews.flatMap((entry) => entry.views),
    images: viewImages,
    roadView: { styleId: drive.figureStyle ?? null, labelStyle: drive.labelStyle ?? null },
    currentStation: driveStationIndex,
    blockNoteParts,
    noteFigures,
    onNoteFigures: setNoteFigures,
    buildBlockNote,
    analysis: {
      status: analysis.state.status,
      progress: analysis.state.progress,
      error: analysis.state.error,
      blocker: !key
        ? 'The scene has an invalid input: check it in step 1.'
        : !scene.viewpoint.coordinates.length
          ? 'Draw or import the road or viewpoint in step 1 first.'
          : !scene.targets.some((target) => target.role === 'block' || target.role === 'landscape')
            ? 'Add a cutblock or landform in step 1 first.'
            : null,
      run: () => {
        tools.cancel()
        handleRun()
      },
    },
    landChecks,
    visualInventory: {
      status: sceneInventory.status,
      units: sceneInventory.units,
      error: sceneInventory.error,
      read: readSceneInventory,
    },
    viewpointInventory,
    onLoadInventory: (block, options) => void loadViewpoints(block, options),
    onStandAt: (candidate, block) => handleUseViewpoint(candidate, null, block),
    onOpenRoadView: () => openPreview(),
    worksheet: worksheetFile,
    scenePackage: { ready: drive.active && !!previewTerrain.source && !!driveEye, build: scenePackageFile },
    project: { build: buildProjectFile },
    evidence: tools.evidence,
    renders: {
      figures: engineFigures,
      jobs: backgroundRenders.jobs,
      history: backgroundRenders.history,
      leftMs: backgroundRenders.status.leftMs,
      enqueue: backgroundRenders.enqueue,
      jobFor: renderJobFor,
      ready: !!eyeMapRef.current && !!previewTerrain.source,
    },
    briefBlockId: briefBlockId ?? selectedTargetId,
    onBriefBlockId: setBriefBlockId,
    captureReportImages,
    captureBeforeRenders,
    reportSetting: getReportSetting,
    // The package's views of interest: its checklist writes `include`, and Preview/Download capture what is missing.
    viewsOfInterest,
    setViewsOfInterest,
    viewCapture,
    // Before renders a capture took where each view stands: the report pairs a view away from here from them.
    capturedBefore,
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
  // Held through a viewpoint swap until the new run opens it again (or fails, or is cancelled).
  if (roadViewHeld && drive.active) setRoadViewHeld(false)
  const roadViewOpen = drive.active || roadViewHeld
  const paneAvailable = { road: roadViewOpen, summary: !!result }
  const leaveRoadView = () => {
    setRoadViewHeld(false)
    setPreliminaryDrive(false)
    setDrive((current) => ({ ...current, active: false, playing: false }))
  }
  // Opening the road view shows its pane, whatever the layout last hid; on a phone it takes the screen.
  const [seenRoadView, setSeenRoadView] = useState(roadViewOpen)
  if (seenRoadView !== roadViewOpen) {
    setSeenRoadView(roadViewOpen)
    setPhonePane(roadViewOpen ? 'road' : 'map')
    if (roadViewOpen && storedHiddenPanes.includes('road'))
      setStoredHiddenPanes(storedHiddenPanes.filter((id) => id !== 'road'))
  }
  // A layout without the road view closes it: the road view has no life off screen.
  const changeHiddenPanes = (hidden: VisualsPane[]) => {
    setStoredHiddenPanes(hidden)
    if (hidden.includes('road') && roadViewOpen) leaveRoadView()
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
  const eyeMapOnScreen = !hiddenPanes.includes('road') && (!phone || focusedPane === 'road')
  const eyeMapShown = drive.active && eyeMapOnScreen
  // Through a swap the map, its terrain and its layers stay; only the camera waits for the new run.
  const eyeMapKept = roadViewOpen && eyeMapOnScreen
  // Closing it takes two commits: its layers, terrain, timber and camera unmount first, while the map
  // still exists, and the map one commit later. React runs a removed tree's cleanups parent first, so
  // removing them together removed MapLibre before MapTerrain and ForestOverlay could clean up, and
  // they threw on the removed map, taking the page down.
  const [eyeMapLingers, setEyeMapLingers] = useState(false)
  useEffect(() => setEyeMapLingers(eyeMapKept), [eyeMapKept])
  const eyeMapMounted = eyeMapKept || eyeMapLingers
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
  // Kept for as long as the stand is placed the same way: how a stem is drawn, shaded or detailed
  // moves none, so changing those redraws the stand it has instead of growing it again (half a
  // minute at a far view).
  const forestPatches = useMemo(() => {
    void [
      forestConfiguration.anchorLatitude,
      forestConfiguration.stands,
      forestConfiguration.clearings,
      forestConfiguration.openings,
      forestConfiguration.thinnings,
      forestConfiguration.inventory,
      forestConfiguration.standHeightMeters,
      forestConfiguration.elevation,
      forestConfiguration.farRadiusMeters,
    ]
    return new globalThis.Map<string, TreeInstance[]>()
  }, [
    forestConfiguration.anchorLatitude,
    forestConfiguration.stands,
    forestConfiguration.clearings,
    forestConfiguration.openings,
    forestConfiguration.thinnings,
    forestConfiguration.inventory,
    forestConfiguration.standHeightMeters,
    forestConfiguration.elevation,
    forestConfiguration.farRadiusMeters,
  ])
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
    planShow: planLook,
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
    treeSun,
    treeShadows: drive.treeShadows,
    facedArrowGeometry,
    previewTerrainMessage: previewTerrain.message,
    treeFreeCollection,
    landformVantage,
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
    figureStyleData,
    sampleCollection,
    eyeSampleCollection,
    reverseRoadCollection,
    corridorCollection,
    corridorExposureCollection,
    stationCollection,
    spotCollection,
    draftCoordinates,
    measuring,
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
    standTreeCollection,
    standStripCollection,
    onToggleProtectedTree: handleToggleProtectedTree,
  }
  // How tall a screen of timber must be to hide a block from the station (`screenHeight.ts`): a
  // design aid run on the road view's terrain, never a run figure.
  const screenBlocks = useMemo(
    () => scene.targets.filter((target) => target.role === 'block').map(({ id, name }) => ({ id, name })),
    [scene.targets],
  )
  const [screenBlockChoice, setScreenBlockChoice] = useState<string | null>(null)
  const screenBlockId = screenBlocks.find((block) => block.id === screenBlockChoice)?.id ?? screenBlocks[0]?.id ?? null
  const screenStationIndex = result
    ? drive.active
      ? Math.min(driveStationIndex, result.stations.length - 1)
      : result.assessmentStationIndex
    : null
  const screenStation =
    result && screenStationIndex != null && result.stations[screenStationIndex]
      ? {
          station: result.stations[screenStationIndex],
          label: drive.active
            ? `Road view at ${(result.stations[screenStationIndex].distanceAlongMeters / 1000).toFixed(2)} km`
            : 'Assessment viewpoint',
        }
      : null
  const screenKey = `${screenBlockId}|${screenStationIndex}|${result ? (key ?? '') : ''}`
  const [screenHeight, setScreenHeight] = useState<{
    key: string
    reading: ScreenHeightReading | null
    running: { progress: number } | null
    error: string | null
  }>({ key: '', reading: null, running: null, error: null })
  const screenAbort = useRef<AbortController | null>(null)
  const screenUnavailable = !result
    ? 'Run the visibility assessment first: the reading stands at its stations.'
    : isStale
      ? 'The run is out of date. Run it again first.'
      : !previewTerrain.source
        ? 'The terrain is still loading.'
        : !screenBlockId
          ? 'Add a proposed block first.'
          : null
  const screenStandHeight = (() => {
    const stand = screenBlockId ? standPrescriptions.get(screenBlockId)?.stand : null
    if (stand?.trees.length) return stand.trees.reduce((sum, tree) => sum + tree.heightMeters, 0) / stand.trees.length
    return drive.treeHeightMeters
  })()
  const runScreenHeight = () => {
    const block = scene.targets.find((target) => target.id === screenBlockId)
    const ground = previewTerrain.source
    if (!block || !ground || !screenStation || screenUnavailable) return
    screenAbort.current?.abort()
    const controller = new AbortController()
    screenAbort.current = controller
    const runKey = screenKey
    const eyeHeight = result?.settings.observerHeightMeters ?? 1.5
    setScreenHeight({ key: runKey, reading: null, running: { progress: 0 }, error: null })
    const geometry = clipAlteration(block.geometry) ?? block.geometry
    runCooperatively(
      screenHeightSteps({
        eye: {
          lng: screenStation.station.lng,
          lat: screenStation.station.lat,
          heightAboveGroundMeters: eyeHeight,
          ...(Number.isFinite(screenStation.station.groundElevationMeters)
            ? { eyeElevationMeters: screenStation.station.groundElevationMeters + eyeHeight }
            : {}),
        },
        block: geometry,
        elevation: ground,
      }),
      {
        signal: controller.signal,
        onProgress: (progress) =>
          setScreenHeight((current) =>
            current.key === runKey ? { ...current, running: { progress: progress.fraction } } : current,
          ),
      },
    ).then(
      (reading) => setScreenHeight({ key: runKey, reading, running: null, error: null }),
      (error: unknown) =>
        setScreenHeight({
          key: runKey,
          reading: null,
          running: null,
          error: error instanceof DOMException && error.name === 'AbortError' ? null : String(error),
        }),
    )
  }

  // The street-level or own photo the road view lines up with: in the stood-at view's row, else in step 2.
  const fieldPhotoPanel = (
    <FieldPhotoPanel
      photo={fieldPhoto}
      canLineUp={
        !!fieldPhoto.image && !!fieldPhoto.onRoad && fieldPhoto.onRoad.offsetMeters <= 60 && !previewInputError(scene)
      }
      onLineUp={() => lineUpPhoto()}
      own={{
        records: tools.photoRecords,
        roadView:
          drive.active && cameraEye
            ? { lng: cameraEye.lng, lat: cameraEye.lat, bearing: lookBearing, hfov: viewerFov }
            : null,
        canLineUp: !previewInputError(scene),
        onLineUp: lineUpOwnPhoto,
        onPickPoint: (onPoint) => setMapPick(onPoint ? { onPoint } : null),
        pickActive: !!mapPick,
        onSaveToRecord: tools.updateFieldRecord,
      }}
    />
  )
  // Where the eye stands and the surveyed eye there: in the row of the view of interest stood at, else in step 2.
  const stoodViewpointPanel = (bare: boolean) => (
    <StoodViewpointPanel
      bare={bare}
      viewpoint={scene.viewpoint}
      terrainGroundMeters={
        standPoint && previewTerrain.source ? previewTerrain.source.elevationAt(standPoint.lng, standPoint.lat) : null
      }
      observerHeightMeters={scene.settings.observerHeightMeters}
      onSurveyedEyeChange={(eye) => {
        setScene((current) => {
          const viewpoint = { ...current.viewpoint }
          if (eye) viewpoint.surveyedEye = eye
          else delete viewpoint.surveyedEye
          return { ...current, viewpoint }
        })
        // A run input: the run goes stale and closes the road view, so, as for a stand, it is
        // held open and reopens where it was once the run is made again.
        const open = driveRef.current
        if (!open.active) return
        setRoadViewHeld(true)
        setStandRequest((request) => ({
          serial: (request?.serial ?? 0) + 1,
          positionMeters: open.positionMeters,
          lookAtTargetId: open.lookAtTargetId,
          lookBearing: open.lookBearing ?? null,
        }))
      }}
    />
  )
  const sidebar = (
    <Sidebar
      via={{
        assessment: viaAssessment,
        stale: isStale,
        statuses: viaStatuses,
        review: viaReviewNow,
        onReviewChange: updateViaReviewNow,
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
              vantages={viewpointCandidates.map((candidate) => ({
                key: candidate.key,
                name: candidate.name,
                lng: candidate.lng,
                lat: candidate.lat,
                summary: viewpointCandidateSummary(candidate),
              }))}
              vantagesStatus={viewpointInventory.status}
              onLoadVantages={() => void loadViewpoints()}
              onVantagePoint={setLandformVantage}
              onPickPoint={(onPoint) => setMapPick(onPoint ? { onPoint } : null)}
              pickActive={!!mapPick}
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
          {!summaryView && stoodViewpointPanel(false)}
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
          {tools.fieldDialog}
        </>
      }
      landformScope={<AssessmentPanel part="scope" {...assessmentProps} />}
      localSources={<ToolSourcesPanel scene={scene} onChange={setScene} selectedTargetId={selectedTargetId} />}
      wildlifeTreePatches={
        <WildlifeTreePatchPanel
          masks={scene.masks ?? []}
          drawing={drawMode === 'wildlife-tree-patch'}
          onDraw={(on) => handleDrawModeChange(on ? 'wildlife-tree-patch' : 'none')}
          drawControls={<PreviewWorkflow part="setup" {...previewProps} />}
          onRemove={(id) =>
            setScene((current) => ({ ...current, masks: (current.masks ?? []).filter((mask) => mask.id !== id) }))
          }
          stale={isStale}
        />
      }
      privateLand={
        <PrivateLandPanel
          landform={sceneLandform?.geometry ?? null}
          masks={scene.masks ?? []}
          onAdd={(parcels) =>
            setScene((current) => {
              let masks = current.masks ?? []
              for (const parcel of parcels)
                masks = withDrawnMask(masks, {
                  id: createId('mask'),
                  kind: 'private',
                  geometry: parcel.geometry,
                  ...parcelMaskFields(parcel),
                })
              return { ...current, masks }
            })
          }
          onRemove={(id) =>
            setScene((current) => ({ ...current, masks: (current.masks ?? []).filter((mask) => mask.id !== id) }))
          }
          stale={isStale}
        />
      }
      netFootprints={
        <NetFootprintPanel
          blocks={scene.targets.filter((target) => target.role === 'block')}
          masks={scene.masks ?? []}
          onAdd={(reserves) => {
            const ids = reserves.map(() => createId('mask'))
            setScene((current) => {
              let masks = current.masks ?? []
              reserves.forEach((reserve, i) => {
                masks = withDrawnMask(masks, {
                  id: ids[i],
                  kind: 'retained',
                  geometry: reserve.geometry,
                  ...reserveMaskFields(reserve),
                })
              })
              return { ...current, masks }
            })
          }}
          stale={isStale}
        />
      }
      runRevision={tools.revision}
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
          <ScreenHeightPanel
            blocks={screenBlocks}
            blockId={screenBlockId}
            onBlockChange={setScreenBlockChoice}
            stationLabel={screenStation?.label ?? null}
            reading={screenHeight.key === screenKey ? screenHeight.reading : null}
            running={screenHeight.key === screenKey ? screenHeight.running : null}
            error={screenHeight.key === screenKey ? screenHeight.error : null}
            unavailable={screenUnavailable}
            onRun={runScreenHeight}
            onCancel={() => screenAbort.current?.abort()}
            standHeightMeters={screenStandHeight}
          />
        </>
      }
      designComparisons={tools.design}
      fieldPhoto={summaryView ? undefined : fieldPhotoPanel}
      showViewpointType={!summaryView}
      fieldBrief={
        <FieldBriefPanel
          scene={scene}
          result={result}
          stale={isStale}
          review={scene.viaReview ?? {}}
          onReviewChange={updateViaReview}
          selectedTargetId={selectedTargetId}
          savedViews={savedViews}
          otherViews={shelvedViews.flatMap((entry) => entry.views)}
          blockId={briefBlockId}
          onBlockId={setBriefBlockId}
          onOpenExport={() => exportOpener.openExport('field-brief')}
        />
      }
      evidence={tools.report}
      scene={scene}
      onViewpointChange={setViewpoint}
      onSettingsChange={(settings) => setScene((current) => ({ ...current, settings }))}
      onThresholdsChange={(thresholds) => setScene((current) => ({ ...current, thresholds }))}
      onTargetChange={handleTargetChange}
      onOpenPrescription={handleOpenPrescription}
      prescriptionLines={prescriptionLines}
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
      assessGroup={
        summaryView && assessStationId
          ? {
              leadName: viewsOfInterest.find((view) => view.id === assessStationId)?.name ?? summaryView.name,
              standingName: summaryView.name,
              memberNames: groupMembers(assessStationId, viewsOfInterest).map((view) => view.name),
              // A step 4 made before groups is taken into this group's only on the reviewer's click.
              onUseEarlier:
                hasStep4(topLevelStep4(scene.viaReview)) && !hasStep4(scene.viaReview?.stations?.[assessStationId])
                  ? () =>
                      updateViaReview({
                        stations: { ...scene.viaReview?.stations, [assessStationId]: topLevelStep4(scene.viaReview) },
                      })
                  : undefined,
            }
          : null
      }
      assessMode={standingNow || assessFromViewChosen ? 'spot' : scene.viewpoint.mode}
      onAssessModeChange={handleAssessModeChange}
      assessFromView={
        <AssessFromView
          views={viewsOfInterest}
          blocks={viewBlocks}
          currentViewId={summaryView?.id ?? null}
          standingName={standingNow && !summaryView ? standingNow.name : null}
          legacySpot={
            !standingNow && scene.viewpoint.mode === 'spot' && scene.viewpoint.coordinates.length
              ? { lng: scene.viewpoint.coordinates[0][0], lat: scene.viewpoint.coordinates[0][1] }
              : null
          }
          disabled={viewCapture.state.status === 'running'}
          adding={drawMode === 'view' && assessOnPlaceRef.current}
          addBlockId={
            viewBlocks.find((block) => block.id === (assessAddBlockId ?? selectedTargetId))?.id ??
            viewBlocks[0]?.id ??
            null
          }
          onAddBlockChange={setAssessAddBlockId}
          onAdd={() => {
            const blockId =
              viewBlocks.find((block) => block.id === (assessAddBlockId ?? selectedTargetId))?.id ?? viewBlocks[0]?.id
            if (!blockId) return
            viewPlacementBlockRef.current = blockId
            assessOnPlaceRef.current = true
            setViewsMessage(null)
            handleDrawModeChange('view')
          }}
          onCancelAdd={() => {
            assessOnPlaceRef.current = false
            handleDrawModeChange('none')
          }}
          onChoose={(viewId) => viewCapture.standAt(viewId, { roadView: false })}
          onKeepSpot={() => {
            const spot = scene.viewpoint.coordinates[0]
            const block =
              scene.targets.find(
                (target) => target.role === 'block' && target.id === (assessAddBlockId ?? selectedTargetId),
              ) ?? scene.targets.find((target) => target.role === 'block')
            if (!spot || !block) return
            const view = viewAtPoint({ lng: spot[0], lat: spot[1] }, block, viewsOfInterest)
            const added = addViews(viewsOfInterest, [view])
            if (added.views.length === viewsOfInterest.length) {
              setViewsMessage(added.overLimit ? 'The list is full: remove a view to add another.' : 'Already listed.')
              return
            }
            setViewsOfInterest((current) => addViews(current, [view]).views)
            setAssessViewPending(view.id)
          }}
        />
      }
      viewpointFinder={
        // In step 2 under the views of interest, open with the road view too: adding a view never needs it closed.
        <ViewpointFinderPanel
          blockName={viewpointBlock?.name ?? null}
          state={viewpointInventory}
          candidates={viewpointCandidates}
          reverseRows={finderReverseRows}
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
          block={viewpointBlock}
          listedKeys={listedViewKeys}
          onAddViews={addCandidateViews}
          onHighlightArrows={highlightFinderArrows}
        />
      }
      viewsOfInterest={
        <ViewsOfInterestPanel
          views={viewsOfInterest}
          onChange={setViewsOfInterest}
          blocks={viewBlocks}
          targets={scene.targets}
          savedViews={capturedViewSources}
          hasFigure={savedViewHasFigure}
          capture={viewCapture}
          openViewId={openViewId}
          onOpenView={setOpenViewId}
          adding={drawMode === 'view'}
          onStartAdding={(blockId) => {
            viewPlacementBlockRef.current = blockId
            setViewsMessage(null)
            handleDrawModeChange('view')
          }}
          onCancelAdding={() => handleDrawModeChange('none')}
          defaultBlockId={selectedTargetId}
          inventory={viewpointInventory.data}
          onOpenExport={() => exportOpener.openExport()}
          renderer={roadRendererInfo(exportOpener.figureRenderer)}
          onChangeRenderer={exportOpener.openPackage}
          capturedHere={(viewId) => savedViews.some((saved) => saved.plannedViewId === viewId)}
          canReopenSaved={(viewId) => savedViews.some((saved) => saved.plannedViewId === viewId)}
          onReopenSaved={(viewId) => {
            const latest = savedViews.filter((saved) => saved.plannedViewId === viewId).at(-1)
            if (latest) openPreview(latest)
          }}
          onShowView={(view) =>
            mapRef.current?.flyTo({
              center: [view.lng, view.lat],
              zoom: Math.max(12, mapRef.current.getZoom()),
            })
          }
          landformControl={renderViewLandform}
          recordControl={(view) => (
            <ViewpointRecordFields
              name={view.name}
              review={scene.viaReview ?? {}}
              onReviewChange={updateViaReview}
              // The run's 3.2.1 estimate belongs to the view it stands at, and to no other.
              typeEstimate={view.id === summaryView?.id ? viewpointTypeEstimate(result, drive.speedKmh) : undefined}
            />
          )}
          keyControl={(view) => {
            const review = scene.viaReview ?? {}
            const reportBlocks = viewBlocks.filter((block) => !otherPlannedName(block.name)).map((block) => block.name)
            const own = viewBlocks.find((block) => block.id === view.blockId)?.name
            // Its own block, and any block the review already gives it, so an earlier choice stays in sight.
            const blocks = reportBlocks.filter(
              (name) => name === own || review.keyViewpoints?.blocks?.[name]?.view === view.name,
            )
            if (!blocks.length && reportBlocks.length < 2) return null
            return (
              <KeyViewpointFields
                name={view.name}
                blocks={blocks}
                group={reportBlocks.length > 1}
                review={review}
                onReviewChange={updateViaReview}
              />
            )
          }}
          photoControl={(view) => {
            const filed = tools.fieldsFor(view.id)
            return {
              count: filed.length,
              node: (
                <div className="space-y-1.5">
                  {filed.map((record) => (
                    <TextButton
                      key={record.id}
                      className="block min-w-0 max-w-full truncate text-left text-2xs"
                      onClick={() => tools.openField(record.id)}
                    >
                      {record.name} · {record.kind}
                    </TextButton>
                  ))}
                  <FileButton
                    label={`Add a field photo of ${view.name}`}
                    accept="image/jpeg,image/png,image/webp"
                    size="2xs"
                    disabled={tools.fieldBusy}
                    onFiles={([file]) => tools.importField(file, 'photo', view.id)}
                  >
                    Add a field photo…
                  </FileButton>
                </div>
              ),
            }
          }}
          assessedGroups={
            new Set(
              Object.entries(scene.viaReview?.stations ?? {}).flatMap(([id, record]) => (hasStep4(record) ? [id] : [])),
            )
          }
          onLeadChanged={(from, to) => {
            const moved = movedStation(sceneRef.current.viaReview, from, to)
            if (moved) updateViaReview(moved)
          }}
          standingViewId={summaryView?.id ?? null}
          standingControl={() => (
            <>
              {stoodViewpointPanel(true)}
              <div className="space-y-1.5 border-t border-border/60 pt-2">
                <p className="text-2xs font-medium text-foreground">Field photo</p>
                {fieldPhotoPanel}
              </div>
            </>
          )}
          onRenamed={(from, to) => {
            const moved = renamedViewpointRecords(sceneRef.current.viaReview ?? {}, from, to)
            if (moved) updateViaReview(moved)
          }}
          message={viewsMessage}
        />
      }
      visualsParagraph={
        <VisualsParagraphPanel
          scene={scene}
          result={result}
          stale={isStale}
          review={viaReviewNow}
          onReviewChange={updateViaReviewNow}
          selectedTargetId={selectedTargetId}
          inventory={viewpointInventory.data}
          otherViewpoints={inventoryFindings}
          otherViewpointsBlockId={viewpointChecks.blockIds.length === 1 ? viewpointChecks.blockIds[0] : null}
          captions={[...shelvedViews.flatMap((entry) => entry.views), ...savedViews].map((view) =>
            view.name.endsWith('.') ? view.name : `${view.name}.`,
          )}
          landform={sceneLandform}
          assessment={viaAssessment}
          onParts={setBlockNoteParts}
          onOpenExport={() => exportOpener.openExport('block-note')}
        />
      }
      onUseRoad={handleUseRoad}
      selectedTargetId={selectedTargetId}
      onSelectTarget={setSelectedTargetId}
      drive={preliminaryDrive ? { ...drive, active: false } : drive}
      onDriveChange={updateDrive}
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
      onOpenProject={(file) => void openProjectFile(file)}
      onOpenExport={exportOpener.openExport}
      onAddRoadDisturbance={handleAddRoadDisturbance}
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
        <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
          {phone ? (
            phonePaneOptions.length > 1 && (
              <TabBar
                label="Visible view"
                value={focusedPane ?? 'map'}
                onChange={(value) => choosePhonePane(value as VisualsPane)}
                options={phonePaneOptions}
                stretch
              />
            )
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
          {/* Every file the page writes, with what goes into each: one place, as in the road designer. */}
          <Button
            // 32 px, the layout select's and the panels button's height beside it.
            size="field"
            data-command="export"
            title="Save & export"
            onClick={() => exportOpener.openExport()}
          >
            <Download className="size-3.5" aria-hidden="true" />
            Save &amp; export
          </Button>
        </div>
        {exportDialog}
        {prescriptionDialog}
        {backgroundRenders.tray}
        {reportMapOn && (
          // Off screen but laid out and drawn (never `display: none`, which leaves MapLibre a 0 × 0 canvas).
          <div
            aria-hidden="true"
            data-testid="visuals-report-capture-map"
            className="pointer-events-none fixed top-0"
            style={{ left: -REPORT_CAPTURE_MAP_SIZE.width - 1000, ...REPORT_CAPTURE_MAP_SIZE }}
          >
            <Map ref={reportMapRef} center={PG_CENTER} zoom={9} maxPitch={85} essentials={false} controls={null}>
              <TerrainSupport
                terrain={false}
                exaggeration={1}
                hillshade={reportBasemap === 'topo'}
                hillshadeIntensity={0.45}
              />
              <SatelliteImagery visible={reportBasemap === 'satellite'} />
            </Map>
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
                        controls={
                          <MapControls position="top-right" showZoom showCompass showFullscreen>
                            <MapMeasureControl
                              active={measuring}
                              onToggle={toggleMeasure}
                              disabled={drawMode !== 'none'}
                              title={
                                drawMode !== 'none'
                                  ? 'Measure · finish or cancel the drawing first'
                                  : 'Measure a distance, an area or a circle'
                              }
                            />
                            <MapLayersControl
                              basemaps={IMAGERY_BASEMAPS}
                              basemap={planShow.basemap}
                              onBasemapChange={(value: PlanBasemap) =>
                                setPlanShow((current) => ({ ...current, basemap: value }))
                              }
                              overlays={[
                                {
                                  id: 'hillshade',
                                  label: 'Hillshade',
                                  checked: planShow.hillshade,
                                  onCheckedChange: (checked) =>
                                    setPlanShow((current) => ({ ...current, hillshade: checked })),
                                },
                                {
                                  id: 'evqo',
                                  label: 'Established VQO polygons',
                                  description: !planShow.evqo
                                    ? 'BC visual landscape inventory'
                                    : !evqoCurrent
                                      ? 'Loading…'
                                      : evqoCurrent.error
                                        ? `Unavailable: ${evqoCurrent.error}`
                                        : evqoCurrent.collection.features.length
                                          ? `${evqoCurrent.collection.features.length} polygons around the scene`
                                          : 'None established around the scene',
                                  checked: planShow.evqo,
                                  onCheckedChange: (checked) =>
                                    setPlanShow((current) => ({ ...current, evqo: checked })),
                                },
                              ]}
                            />
                          </MapControls>
                        }
                        deferResize={table.deferResize}
                      >
                        <MapTableBridge table={table} />
                        <TerrainSupport
                          terrain={false}
                          exaggeration={1}
                          hillshade={planLook.hillshade}
                          hillshadeIntensity={0.45}
                        />
                        <VisualQualityLayers mode="plan" data={layerData} />
                        <MapViewerCone viewer={planViewer} />
                        {/* Planned views of interest; their points take clicks only while nothing else owns the plan's. */}
                        <ViewsOfInterestLayers
                          views={viewsOfInterest}
                          blocks={viewBlocks}
                          openViewId={openViewId}
                          arrows={viewpointLayers.arrows}
                          previewArrowIds={finderArrowIds}
                          hidden={planLook.hidden}
                          visible
                          onSelect={
                            !drive.active && drawMode === 'none' && !mapPick && !measuring ? setOpenViewId : null
                          }
                          onMove={
                            !drive.active && drawMode === 'none' && !mapPick && !measuring
                              ? (id, point) =>
                                  setViewsOfInterest((views) =>
                                    views.map((view) =>
                                      view.id === id ? { ...view, lng: point.lng, lat: point.lat } : view,
                                    ),
                                  )
                              : null
                          }
                          onTurn={
                            drawMode === 'none' && !mapPick && !measuring
                              ? (id, bearing) =>
                                  setViewsOfInterest((views) =>
                                    views.map((view) =>
                                      view.id === id
                                        ? { ...view, facing: { kind: 'bearing', degrees: Math.round(bearing) % 360 } }
                                        : view,
                                    ),
                                  )
                              : null
                          }
                          standingViewId={drive.active ? (summaryView?.id ?? null) : null}
                        />
                        <MapSketch sketch={measure} testId="visuals-measure" />
                        {measuring && (
                          <MapOverlay
                            position="top-left"
                            clearChrome
                            className="w-72 max-w-[calc(100%-4.5rem)] border-0 bg-transparent shadow-none backdrop-blur-none"
                          >
                            <MapMeasurePanel sketch={measure} onClose={clearMeasure} />
                          </MapOverlay>
                        )}
                        <PlanClickToMove
                          onMove={
                            drive.active && seekFromPlan && drawMode === 'none' && !mapPick && !measuring
                              ? (point) => seekFromPlan([point.lng, point.lat])
                              : null
                          }
                        />
                        {drive.active && cameraEye && !preliminaryDrive && (
                          <PlanViewerHandles
                            eye={cameraEye}
                            bearing={lookBearing}
                            onMove={seekFromPlan ? (point) => seekFromPlan([point.lng, point.lat]) : null}
                            onLook={(bearing) => {
                              const degrees = Math.round(bearing) % 360
                              updateDrive({ lookAtTargetId: null, lookBearing: degrees })
                              // Standing at a planned view, the road view is that view: turning it turns the view.
                              const standingAt = summaryView
                              if (standingAt)
                                setViewsOfInterest((views) =>
                                  views.map((view) =>
                                    view.id === standingAt.id
                                      ? { ...view, facing: { kind: 'bearing', degrees } }
                                      : view,
                                  ),
                                )
                            }}
                          />
                        )}
                        {drawMode !== 'none' && (
                          <MapOverlay
                            position="top-left"
                            clearChrome
                            className="right-14 p-3 md:hidden"
                            role="region"
                            aria-label="Map drawing controls"
                          >
                            <p className="text-xs">
                              {drawMode === 'view' ? (
                                'Tap the map where the view of interest stands.'
                              ) : (
                                <>
                                  Tap the map to trace the{' '}
                                  {drawMode === 'corridor' ? 'road' : drawMode === 'spot' ? 'viewpoint' : 'polygon'}.{' '}
                                  {draftCoordinates.length} points added.
                                </>
                              )}
                            </p>
                            <div className="mt-2 flex gap-2">
                              {drawMode !== 'spot' && drawMode !== 'view' && (
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
                        {mapPick && drawMode === 'none' && (
                          <MapOverlay
                            position="top-left"
                            clearChrome
                            className="flex items-center gap-2 px-3 py-2"
                            role="status"
                            data-testid="map-pick-hint"
                          >
                            <Crosshair className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
                            <span className="text-xs">Click the map to pick the point</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-2xs touch:h-10"
                              onClick={() => setMapPick(null)}
                            >
                              Cancel
                            </Button>
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
                          treeFreeAreas={(scene.treeFreeAreas ?? []).length > 0 || !!viewpointClearing}
                          standTrees={standTreeCollection.features.length > 0}
                          standStrip={standStripCollection.features.length > 0}
                          evqo={planEvqoCodes}
                          viewsOfInterest={{
                            views: viewsOfInterest.length > 0,
                            arrows:
                              !!viewpointInventory.data?.arrows.length &&
                              (finderArrowIds.length > 0 ||
                                viewsOfInterest.some(
                                  (view) => view.facing.kind === 'bearing' && !!view.facing.arrowId,
                                )),
                          }}
                          hidden={planShow.hidden}
                          onToggle={(key) => setPlanShow((current) => togglePlanLegendKey(current, key))}
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
                            // The drive camera owns this view: N/U/R or a right-click menu would move it off the road.
                            essentials={false}
                            center={driveEye ? [driveEye.lng, driveEye.lat] : PG_CENTER}
                            zoom={14}
                            maxPitch={85}
                            controls={
                              <MapControls position="top-right" showZoom showCompass showFullscreen>
                                <MapLayersControl
                                  basemaps={IMAGERY_BASEMAPS}
                                  basemap={drive.imagery ? 'satellite' : 'map'}
                                  onBasemapChange={(value: PlanBasemap) =>
                                    setDrive((current) => ({ ...current, imagery: value === 'satellite' }))
                                  }
                                />
                              </MapControls>
                            }
                          >
                            {eyeMapKept && (
                              <>
                                {/* Stronger than it was at 0.25: the relief now lies over the drawn ground
                                  (`GroundRelief`), where it has a hillside's form to carry. */}
                                <TerrainSupport terrain exaggeration={1} hillshade hillshadeIntensity={0.5} />
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
                                            size="xs"
                                            className="touch:h-10"
                                            disabled={!canSaveView}
                                            aria-label="Save viewpoint"
                                            title="Save this spot, look and harvest phase; it is captioned for the planning note"
                                            onClick={() => void saveView()}
                                          >
                                            <Bookmark className="h-3.5 w-3.5" />
                                            <span className="max-sm:hidden">Save</span>
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="xs"
                                            className="touch:h-10"
                                            disabled={!canSaveView}
                                            aria-label="Download image"
                                            title="Download this view as a captioned PNG"
                                            onClick={saveImage}
                                          >
                                            <ImageDown className="h-3.5 w-3.5" />
                                            <span className="max-sm:hidden">Image</span>
                                          </Button>
                                          <RoadViewOptionsButton
                                            drive={drive}
                                            onDriveChange={updateDrive}
                                            blocks={scene.targets.filter((target) => target.role === 'block')}
                                            lookArrows={lookArrows}
                                            jump={roadViewJump}
                                            lensMm={roadViewLens}
                                            onLensChange={setRoadViewLens}
                                          />
                                          <DrawnTimberButton
                                            drive={drive}
                                            onDriveChange={updateDrive}
                                            viewpointClearing={{
                                              stood: !!standPoint,
                                              setting: viewpointClearingSetting,
                                              area: viewpointClearing,
                                            }}
                                            onViewpointClearingChange={(setting) =>
                                              setScene((current) => ({ ...current, viewpointClearing: setting }))
                                            }
                                            privateLandClearing={privateLandClearing}
                                            onPrivateLandClearingChange={(cleared) =>
                                              setScene((current) => {
                                                const next = { ...current }
                                                if (cleared) next.clearPrivateLand = true
                                                else delete next.clearPrivateLand
                                                return next
                                              })
                                            }
                                            drawMode={drawMode}
                                            onDrawModeChange={handleDrawModeChange}
                                            scene={scene}
                                            onRemoveTreeFreeArea={(areaId) =>
                                              setScene((current) => ({
                                                ...current,
                                                treeFreeAreas: (current.treeFreeAreas ?? []).filter(
                                                  (area) => area.id !== areaId,
                                                ),
                                              }))
                                            }
                                            forestStatus={forestStatus}
                                            inventory={inventory}
                                            roadClearing={{
                                              roadClass: basemap.roadClass,
                                              widthMeters: autoClearing,
                                              waterPolygons: basemap.water.length,
                                            }}
                                          />
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
                                    horizontalFovDegrees={roadViewLens ? lensHfovDeg(roadViewLens) : null}
                                    standAt={photoLook ? fieldPhoto.standAt : null}
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
                                        : ((photoLook ? fieldPhoto.standEyeHeightMeters : null) ??
                                          result?.settings.observerHeightMeters ??
                                          scene.settings.observerHeightMeters)
                                    }
                                    surveyedEye={preliminaryDrive || photoLook ? null : surveyedEye}
                                    lookAt={preliminaryDrive ? null : lookAtTarget}
                                    spotBearing={spotBearing}
                                    onPosition={(pose) => {
                                      drivePoseRef.current = pose
                                      const { distanceMeters, stationIndex, lng, lat, bearing } = pose
                                      setDriveStationIndex(stationIndex)
                                      // Rounded, so a slow turn does not re-render the page every report.
                                      setLookBearing((current) =>
                                        Math.abs(((bearing - current + 540) % 360) - 180) < 5
                                          ? current
                                          : Math.round(bearing),
                                      )
                                      // To about 10 m: every consumer (the plan's viewer, the stand's centre, haze)
                                      // works at that grain, and a raw position re-rendered the page every report.
                                      const eyeLng = Math.round(lng * 1e4) / 1e4,
                                        eyeLat = Math.round(lat * 1e4) / 1e4
                                      setCameraEye((current) =>
                                        current?.lng === eyeLng && current?.lat === eyeLat
                                          ? current
                                          : { lng: eyeLng, lat: eyeLat },
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
                          {eyeMapKept && drive.active && engineUrl && drive.renderer !== 'pgmaps' && (
                            <ExternalRoadRenderer
                              key={`${drive.renderer} ${engineUrl}`}
                              renderer={drive.renderer}
                              url={engineUrl}
                              mapRef={eyeMapRef}
                              poseRef={drivePoseRef}
                              buildScene={(at) => currentScenePackage(at, { includeModels: false })}
                              captureRef={engineCaptureRef}
                              stand={engineStand}
                              environment={drive.engineEnvironment}
                              renderOptions={engineBrowserOptions.render[drive.renderer]}
                              onUsePgmaps={() => setDrive((current) => ({ ...current, renderer: 'pgmaps' }))}
                            />
                          )}
                          {eyeMapKept && !drive.active && (
                            <MapOverlay
                              position="top-left"
                              clearChrome
                              className="flex max-w-[20rem] items-center gap-1.5 px-2.5 py-1.5 text-xs"
                              role="status"
                              data-testid="road-view-moving"
                            >
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                              Moving to {scene.viewpoint.name || 'the new viewpoint'}…
                            </MapOverlay>
                          )}
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
                                      <span className="text-warning">· terrain incomplete here</span>
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
                                      size="xs"
                                      className="text-2xs touch:h-9"
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
                                      size="xs"
                                      className="text-2xs touch:h-9"
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
                  viewSwitcher={summaryViewSwitcher}
                  blockSwitcher={summaryBlockSwitcher}
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
