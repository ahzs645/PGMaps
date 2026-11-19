import { TerrainLayerSelect, type TerrainLayer } from './TerrainLayerSelect'
import { PdfClassInspector } from './PdfClassInspector'
import type { FitRequest, usePlanDisplay } from './usePlanDisplay'
import type { RoadSelectionRange } from './roadSelection'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import type {
  ExpressionSpecification,
  Map as MapLibreMap,
  GeoJSONSource,
  ImageSource,
  MapMouseEvent,
  MapTouchEvent,
} from 'maplibre-gl'
import {
  CircleHelp,
  LocateFixed,
  MessageSquarePlus,
  Mountain,
  Plus,
  Radius,
  Settings2,
  Table2,
  Waves,
  X,
} from 'lucide-react'
import { Map, MapControls, MapLayersControl, MapMarker, MapScaleBar, MarkerContent, useMap } from '@/components/ui/map'
import { IMAGERY_BASEMAPS, SatelliteImagery, useStoredImageryBasemap } from '@/components/ui/map-satellite-imagery'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MapSketchDraft, MapSketchLayers } from '@/components/ui/map-sketch'
import { canFinishSketch, nearFirstVertex } from '@/lib/geo/mapSketch'
import { AnchoredPopover } from '@/components/ui/anchored-popover'
import { Button } from '@/components/ui/button'
import { StyledSelect } from '@/components/ui/styled-select'
import { MapIconButton } from '@/components/ui/map-icon-button'
import { PlanLegend } from './PlanLegend'
import { RoadMapTools } from './RoadMapTools'
import { NOTE_LAYER_IDS, NotesLayer, NotesToolbar, type NoteTool } from './PlanNotes'
import {
  REFERENCE_FILL_OPACITY,
  REFERENCE_ICON_LAYER_ID,
  REFERENCE_LAYERS,
  REFERENCE_LINEWORK_LAYER_IDS,
  REFERENCE_POINT_LAYER_ID,
  REFERENCE_SOURCE,
  ReferenceLabels,
  ReferenceSheets,
  referenceLegend,
  referenceLineDash,
  referenceLineWidth,
  referencePlanData,
} from './ReferenceLayer'
import { referenceLayerKey, referenceLayers, type ReferenceFeature } from './referenceFeatures'
import { referenceCustomDashes, referenceStyleSymbols, type ReferenceLayerStyle } from './referenceStyles'
import { CUTBLOCK_BUFFER_COLOR, cutblockBufferFeatures, cutblockBufferKey } from './cutblockBuffers'
import { CutblockCard } from './CutblockCard'
import { ExistingRoadCard } from './ExistingRoadCard'
import { MAP_NOTE_COLORS, type MapNote } from './mapNotes'
import {
  buildPlanLegend,
  PLAN_CONTEXT_STYLES,
  PLAN_DRAINAGE_STYLES,
  PLAN_LINE_DASHES,
  STREAM_ZOOM_STOPS,
  GROUND_DRAINAGE_STYLES,
} from './planLegendModel'
import { distinctRoadColors } from './roadColors'
import { planHover, type ScreenStation } from './planHover'
import { ROAD_HISTORY_STYLES } from './roadHistory'
import { contextHistoryProperties, historyTableSources } from './historyPresentation'
import { MapTableBridge, useMapTable } from '@/components/map/useMapTable'
import {
  distance,
  horizontalCurveFits,
  horizontalCurveSummary,
  isBeyondReachFlag,
  nearestStation,
  offsetCoordinate,
  positionAt,
} from './engine'
import { checkPlanEdit } from './planEditCheck'
import { bendThrough, curveGrip, curveThrough, type CurveThrough } from './bendArc'
import {
  horizontalCurveEvents,
  labelChainages,
  labelOffset,
  metresPerPixel,
  stationLabelInterval,
  tickChainages,
} from './planAnnotations'
import { terrainBounds } from './terrain'
import { isLocalPlane, localPlaneGrid } from './localPlane'
import { roadPlanFitCoordinates } from './planFit'
import { investigationAnalysis, investigationCoordinates, isAccessInvestigation } from './investigationWorkspace'
import { MAPPED_ROAD_COLOR } from './mappedRoad'
import { buildTerrainDisplay, PLAN_TERRAIN_DISPLAY_SIDE } from './terrainDisplay'
import { terrainCoverShare } from './tinGround'
import { formatRoadStation } from './Charts'
import { cableCoordinateAtDistance, resolvedCableLine } from './cableGeometry'
import { sectionCodePoints } from './sectionGeometry'
import { safeAnalyzeRoad } from './analysisResult'
import { TerrainRasterLayers } from './TerrainRasterLayers'
import { MapRasterHandoff, useMapLayerHandoff } from '@/components/ui/map-raster-handoff'
import { commandDef } from '@/components/interfaces/workspaceCommands'
import { waybackCredit } from '@/lib/wayback'
import { waybackTimelineAvailable, useWaybackTimeline, WaybackTimeline } from './WaybackTimeline'
import { SENTINEL_ANCHOR_LAYER_ID } from './sentinel/planOrder'
import { usePlanImageryOrder } from './usePlanImageryOrder'
import { Sentinel2Layer } from './sentinel/Sentinel2Layer'
import { Sentinel2Panel } from './sentinel/Sentinel2Panel'
import { useSentinel2 } from './sentinel/useSentinel2'
import { useSentinelViewWindow } from './sentinel/useSentinelViewWindow'
import { CanopyHeightLayer } from './canopy/CanopyHeightLayer'
import { CanopyHeightPanel } from './canopy/CanopyHeightPanel'
import { useCanopyHeight } from './canopy/useCanopyHeight'
import { useCanopyView } from './canopy/useCanopyView'
import { META_CHM_CREDIT } from '@/lib/forestry/canopy/metaChm'
import { areaFromFeature, useSentinelAreaDrawing } from './sentinel/useSentinelAreaDrawing'
import { RegionalDemLayer } from './RegionalDemLayer'
import { RegionalContourLayer } from './RegionalContourLayer'
import { HrdemReliefLayer } from './HrdemReliefLayer'
import { HRDEM_RELIEF_NAME } from './hrdem'
import { ProvincialStreamLayers } from './ProvincialStreamLayers'
import { SightlinePlanLayers } from './SightlinePlanLayers'
import { AccessHistoryLayers } from './AccessHistoryLayers'
import { historicalMapFeatures } from './accessHistoryMap'
import type { AccessHistorySelection } from './AccessHistorySelection'
import { riparianMapFeatures, RIPARIAN_MAP_COLORS } from './riparian'
import { mergeRiparianZones } from './riparianDisplay'
import { areaPatternId, keepSymbolImages, symbolImages, type SymbolImageMap } from '@/lib/mapSheet/mapSymbols'
import type { AreaSymbol, SheetSymbol } from '@/lib/mapSheet/symbols'
import { cutblockBufferSymbol } from './cutblockBufferStyle'
import { keepAttributionFolded } from '@/components/ui/map-attribution'
import { CULVERTS_TOGETHER_M, CulvertCard } from './CulvertCard'
import { culvertFlowArrow } from './culvertFlowArrow'
import { planSheetLayerSet, riparianSheetKey, sheetProperties, type PlanSheetLayerSet } from './planSheetSymbols'
import { roleOverrides } from './styleLibrary'
import { readStoredStyleLibrary, STYLE_LIBRARY_CHANGED } from './StyleLibraryPanel'
import { CLEARING_LINE_COLOR, clearingLineFeatures, preparationMarginFeatures } from './preparationFootprint'
import { ROAD_COLOUR_OPTIONS, usePlanTools, type RoadColourMode } from './PlanTools'
import { crossDrainMarks } from './crossDrainMarks'
import { gradeClassRoadLines } from './gradeClasses'
import { costColourHeading, costColourLines } from './costColours'
import type { CostAttribution, CostSeriesId } from './costAttribution'
import type {
  Alignment,
  ContextFeature,
  Coordinate,
  RoadAnalysis,
  RoadProject,
  RoadStation,
  TerrainSource,
} from './types'
import { mercatorMetresPerPixel, snapIndex, snapToRoads, type DrawSnap, type SnapLine } from './drawSnap'

/** `sketch` takes one freehand stroke; `extend` pegs on from the active road's nearer end. */
export type DrawMode =
  | 'inspect'
  | 'edit'
  | 'road'
  | 'sketch'
  | 'extend'
  | 'profile'
  | 'cable'
  | 'stream'
  | 'avoid'
  | 'trace'
/** A sketch stroke keeps detail down to this many screen pixels before it becomes a road. */
export const SKETCH_CAPTURE_PX = 1.5
const CONTEXT_LABELS: Record<ContextFeature['kind'], string> = {
  stream: 'Streams',
  'existing-road': 'Existing roads',
  harvest: 'Harvest areas',
  avoid: 'Review areas',
}
interface PlanProps {
  detailArea?: Coordinate[][] | null
  /** Joint refinement's movement boxes (`movementBoxFeatures`): drawn only, never picked. */
  refineBoxes?: GeoJSON.FeatureCollection | null
  /** A drawing tool's card (`MapToolPanel`), shown in the corner the plan tools use. */
  toolPanel?: ReactNode
  /** A tool's card in the plan's top-right corner, stacked with the Sentinel-2 card (existing-ground drainage). */
  cornerPanel?: ReactNode
  display: ReturnType<typeof usePlanDisplay>
  selectedRange?: RoadSelectionRange
  onMapReady?: (map: MapLibreMap | null) => void
  project: RoadProject
  alignment: Alignment
  analyses: Map<string, RoadAnalysis>
  source: TerrainSource
  station: number
  /** The selected station's record, when it was typed and lies between calculated stations. */
  selectedStation?: RoadStation
  onStation: (station: number) => void
  /** Playback owns the station until a click; pointer movement must not redirect it. */
  stationHover?: boolean
  onSelectAlignment: (id: string) => void
  mode: DrawMode
  onMode?: (mode: DrawMode) => void
  draft: Coordinate[]
  onDraw: (coordinate: Coordinate) => void
  /**
   * Closes a drawn area (Draw area / Draw block): a click on its first point or a double-click, as
   * the shared sketch (`map-sketch.tsx`) closes a measured polygon.
   */
  onFinishDraw?: () => void
  /** The pointer while drawing, for the area's rubber band back to its first point. */
  drawHover?: Coordinate | null
  /**
   * Roads a pegged point snaps onto while drawing a road (`drawSnap.ts`). A click within
   * `DRAW_SNAP_PX` of one lands exactly on its line, so the new road starts or ends on it.
   */
  snapLines?: SnapLine[]
  /** A pegged point landed on another road; `first` when it is the road's first point. */
  onSnap?: (snap: DrawSnap, first: boolean) => void
  /** A finished freehand stroke in `sketch` mode, with the ground size of a screen pixel when it ended. */
  onSketch?: (stroke: Coordinate[], metresPerPixel: number) => void
  onMovePoint: (id: string, coordinate: Coordinate) => void
  onInsertPoint?: (afterId: string, coordinate: Coordinate) => void
  /** A bend handle was clicked or barely moved, so nothing changed. */
  onBendHint?: () => void
  /** The selected point's curve handle was let go: the radius whose arc passes where it was dragged to. */
  onCurveRadius?: (id: string, radiusM: number, limitedBy: CurveThrough['limitedBy']) => void
  onHover: (coordinate: Coordinate | null) => void
  onSelectPoint: (id: string) => void
  selectedPoint: string | null
  fitRevision: number
  terrainOnly?: boolean
  activeCableId?: string
  onSelectCable?: (id: string) => void
  cableDistance?: number
  onCableDistance?: (distance: number) => void
  overlay?: GeoJSON.FeatureCollection
  /** Drainage results: features carry `role` ('stream-existing' | 'stream-design' | 'diversion' | 'pond' | 'low-point'). */
  drainage?: GeoJSON.FeatureCollection
  /**
   * Existing-ground drainage over an analysis area, with no road (`groundDrainagePlan`): features
   * carry a `ground-*` role. Kept apart from `drainage`, the road's own before/after check.
   */
  groundDrainage?: GeoJSON.FeatureCollection
  /**
   * Design-vehicle swept path: features carry `role` ('swept-wheels' | 'swept-body' | 'swept-deficit',
   * and from the vehicle tools 'swept-area' | 'vehicle-outline' | 'vehicle-trace' | 'vehicle-template' | 'vehicle-lock').
   */
  swept?: GeoJSON.FeatureCollection
  /** Consume a plan click as a drain-to-point selection rather than changing road chainage. */
  pourPointPicking?: boolean
  onPourPoint?: (coordinate: Coordinate) => void
  onOverlaySelect?: (properties: GeoJSON.GeoJsonProperties) => void
  selectedCulvertId?: string
  /** Draft culverts of a cross-drain batch preview, drawn on the culvert layer (`crossDrainBatchPlan.ts`). */
  draftCulverts?: GeoJSON.Feature[]
  onSelectCulvert?: (id: string) => void
  /** Inspect the source/history of a mapped cutblock or existing road. */
  onContextSelect?: (feature: ContextFeature, at?: Coordinate) => void
  onHistorySelect?: (selection: Omit<AccessHistorySelection, 'revision'>) => void
  /** Loads a mapped road as a road whose formation follows the ground, to read its profile. */
  onLoadMappedRoad?: (featureId: string) => void
  historySelection?: AccessHistorySelection
  /** Saves the project's map notes; without it notes show but cannot be drawn or edited. */
  onNotesChange?: (notes: MapNote[]) => void
  /** The reference feature the sidebar last located; the plan draws it heavier. */
  focusedReferenceId?: string | null
  hiddenReferenceLayers?: readonly string[]
  onReferenceVisibility?: (keys: readonly string[], visible: boolean) => void
  layersButton?: ReactNode
  /** Set while a note tool is in hand, so the plan's own clicks stand aside. */
  noteTool?: NoteTool
  /** Highlights an existing road clicked on the plan, as picking it in the sidebar does. */
  onHighlightRoad?: (road: ContextFeature) => void
  /** Appends pegs to the active road's end; returns false if refused. Without it the peg tool is off. */
  onPeg?: (coordinates: Coordinate[]) => boolean
  /** Selects exactly this station, as the station box does, and returns it held to the road. */
  onTypeStation?: (station: number) => number
  /** Sightlines from the Sight distance section (`sightPresentation.ts`); absent draws none. */
  sightlines?: GeoJSON.FeatureCollection | null
  /**
   * The active road's cost spread along it (`costAttribution.ts`), for "Colour road by → Cost per
   * metre". Absent: the cost choice draws the road plain. Keep it one object while it is unchanged,
   * so a station scrub does not re-send the road source.
   */
  costColours?: PlanCostColours
}
export interface PlanCostColours {
  attribution: CostAttribution
  /** A cost row's id, or the whole estimate. */
  rowId: CostSeriesId
  /** Goes back from one row to the whole estimate; offered in the legend while a row is shown. */
  onWholeEstimate?: () => void
}
const ROAD_HISTORY_LAYER_IDS = Object.keys(ROAD_HISTORY_STYLES).map((key) => `road-history-${key}`)
/** What the plan's context draws with (Map settings, *Legend and map symbols*), kept in this browser. */
type PlanSymbolStyle = 'road-plan' | 'block-sheet' | 'saved-styles'
const planSymbolStyle = (value: string | null): PlanSymbolStyle =>
  value === 'road-plan' || value === 'saved-styles' ? value : 'block-sheet'
/** The sheet symbols as PGMaps defines them: what the plan draws unless saved styles are asked for. */
const PLAN_SHEET_SET = planSheetLayerSet('road-context')
/** The plan's own context colours, hidden while the block sheet's symbols draw the context. */
const PLAN_CONTEXT_LINE_LAYER_IDS = ['road-context-line', ...ROAD_HISTORY_LAYER_IDS]
const CONTEXT_FILL_OPACITY = 0.18
const CUTBLOCK_BUFFER_SOURCE = 'road-cutblock-buffers'
const CUTBLOCK_BUFFER_LAYERS = [
  'road-cutblock-buffer-fill',
  'road-cutblock-buffer-pattern',
  'road-cutblock-buffer-edge',
]
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const line = (
  coordinates: Coordinate[],
  properties: GeoJSON.GeoJsonProperties = {},
): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties,
})

/** Project a map click onto the same great-circle span used by the cable profile. */
function cableDistanceAt(start: Coordinate, end: Coordinate, coordinate: Coordinate) {
  const rad = Math.PI / 180
  const heading = (a: Coordinate, b: Coordinate) =>
    Math.atan2(
      Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad),
      Math.cos(a[1] * rad) * Math.sin(b[1] * rad) -
        Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad),
    )
  const angularDistance = distance(start, coordinate) / 6371008.8
  const along =
    Math.atan2(
      Math.sin(angularDistance) * Math.cos(heading(start, coordinate) - heading(start, end)),
      Math.cos(angularDistance),
    ) * 6371008.8
  return Math.max(0, Math.min(distance(start, end), along))
}

function placeOn(alignment: Alignment, chainage: number) {
  try {
    return positionAt(alignment, chainage)
  } catch {
    return null
  }
}

/** The DEM display over the basemap; a hillshade over satellite imagery is lighter. */
const TERRAIN_OPACITY = 0.82
const IMAGERY_HILLSHADE_OPACITY = 0.5
/**
 * Dark theme: the plan's relief image (flat ground near white) is dimmed through
 * `raster-brightness-max`, so the relief keeps its lighting and the image itself stays light.
 * Slope, aspect and elevation are read by colour against the legend, so they are left as drawn.
 */
const DARK_HILLSHADE_BRIGHTNESS_MAX = 0.2
const CONTOUR_PAINT = {
  light: { color: '#57534e', opacity: 0.45 },
  dark: { color: '#d6d3d1', opacity: 0.32 },
} as const

/** The plan's drawing colour: a pegged road's draft line and a drawn area's sketch. */
const DRAFT_COLOR = '#0d9488'
const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
/** Covers the basemap under a project on the flat plane. */
const PLANE_BACKGROUND: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-180, -85],
            [180, -85],
            [180, 85],
            [-180, 85],
            [-180, -85],
          ],
        ],
      },
    },
  ],
}

function Layers(
  props: PlanProps & {
    terrainLayer: TerrainLayer
    /** Satellite imagery under the plan: the hillshade is lightened so the imagery reads through. */
    imagery?: boolean
    showContours: boolean
    showLabels: boolean
    showEarthwork: boolean
    /** Draw the context with the block sheet's symbols (`planSheetSymbols.ts`). */
    sheetSymbols: boolean
    /** The sheet layers to draw: PGMaps' symbols, or this browser's saved styles over them. */
    sheetLayerSet: PlanSheetLayerSet
    hiddenContextKinds: ContextFeature['kind'][]
    visibleContext: ContextFeature[]
    visibleBufferData: GeoJSON.FeatureCollection
    bufferSymbols: readonly AreaSymbol[]
    visibleReference: readonly ReferenceFeature[]
    /** The looks the person gave reference layers, and the pattern tiles those looks need. */
    referenceStyles?: readonly ReferenceLayerStyle[]
    referenceSymbols: readonly SheetSymbol[]
    onPointDragStart: (id: string) => void
    onBendPreview: (afterId: string, coordinate: Coordinate | null) => void
    /** The curve handle of point `id` is at `coordinate`; `commit` when it was let go there. */
    onCurvePull: (id: string, coordinate: Coordinate, commit: boolean) => void
    /** The road with a point drag but without a bend preview. A handle in use has to stay mounted, so handles follow this. */
    savedAlignment: Alignment
    onPointDragEnd: (id: string, coordinate: Coordinate) => void
    fitRequest: FitRequest
    /** A plan tool is in hand (`PlanTools.tsx`): the plan's own clicks stand aside. */
    planToolActive?: boolean
    /** The previewed edit would be refused on drop (`planEditCheck.ts`): draw the road as refused. */
    refusedEdit?: boolean
    /** What the active road is coloured by. */
    roadColour?: RoadColourMode
    /** The strip under the map that takes the legend when it is placed below. */
    legendSlot: HTMLElement | null
  },
) {
  const { map, isLoaded } = useMap()
  const { resolvedTheme, forcedTheme } = useTheme()
  const dark = (forcedTheme ?? resolvedTheme) === 'dark'
  const investigation = isAccessInvestigation(props.project)
  const selectedMappedRoad = useMemo(() => {
    const feature =
      props.historySelection?.kind === 'road'
        ? props.visibleContext.find(
            (candidate) => candidate.id === props.historySelection?.id && candidate.kind === 'existing-road',
          )
        : undefined
    return fc(
      feature
        ? [{ type: 'Feature', geometry: feature.geometry, properties: { id: feature.id, name: feature.name } }]
        : [],
    )
  }, [props.historySelection, props.visibleContext])
  const historicalMap = useMemo(
    () => historicalMapFeatures(props.visibleContext, props.project.accessHistory),
    [props.visibleContext, props.project.accessHistory],
  )
  const onMapReady = props.onMapReady
  useEffect(() => {
    if (!map || !isLoaded) return
    onMapReady?.(map)
    return () => onMapReady?.(null)
  }, [map, isLoaded, onMapReady])
  const {
    mode,
    onDraw,
    snapLines,
    onSnap,
    onStation,
    onSelectAlignment,
    onHover,
    onSelectCable,
    onCableDistance,
    onOverlaySelect,
    onSelectCulvert,
    onContextSelect,
    onHistorySelect,
    noteTool,
    pourPointPicking,
    onPourPoint,
    planToolActive,
  } = props
  const draftLength = props.draft.length
  // An area is drawn with the shared sketch: its vertices, rubber band and closing click.
  const areaDrawing = mode === 'avoid'
  const latestDraw = useRef({ draft: props.draft, onFinishDraw: props.onFinishDraw })
  useEffect(() => {
    latestDraw.current = { draft: props.draft, onFinishDraw: props.onFinishDraw }
  })
  // Pegging a new road snaps to every road; extending one snaps to every road but itself.
  const snapRoads = useMemo(
    () =>
      snapLines && (mode === 'road' || mode === 'extend')
        ? snapIndex(snapLines.filter((line) => !(mode === 'extend' && line.id === props.alignment.id)))
        : undefined,
    [snapLines, mode, props.alignment.id],
  )
  const projectCables = useMemo(
    () => (investigation ? [] : props.project.cables),
    [investigation, props.project.cables],
  )
  const resolvedCables = useMemo(
    () =>
      projectCables.flatMap((cable) => {
        try {
          return [resolvedCableLine(cable)]
        } catch {
          return []
        }
      }),
    [projectCables],
  )
  const activeAlignmentId = props.alignment.id
  const previousFit = useRef('')
  const previousManualFit = useRef(0)
  const analysis = props.analyses.get(props.alignment.id)!
  useEffect(() => {
    if (!map || !isLoaded) return
    const range = props.selectedRange
    const samples = range
      ? analysis.stations.filter((s) => s.chainage > range.start && s.chainage < range.end).map((s) => s.coordinate)
      : []
    const start = range ? placeOn(props.alignment, range.start)?.coordinate : null
    const end = range ? placeOn(props.alignment, range.end)?.coordinate : null
    const coordinates = start && end ? [start, ...samples, end] : []
    const data = fc(
      coordinates.length && range?.highlight !== false
        ? [
            line(coordinates, { label: range?.label, outline: range?.highlight === 'outline' }),
            ...(range?.start === range?.end && start
              ? [
                  {
                    type: 'Feature' as const,
                    properties: { label: range?.label },
                    geometry: { type: 'Point' as const, coordinates: start },
                  },
                ]
              : []),
          ]
        : [],
    )
    const source = map.getSource('road-selection') as GeoJSONSource | undefined
    if (source) source.setData(data)
    else map.addSource('road-selection', { type: 'geojson', data })
    if (!map.getLayer('road-selection-highlight'))
      map.addLayer({
        id: 'road-selection-highlight',
        type: 'line',
        source: 'road-selection',
        // An outlined range is a line either side of the road (a gap as wide as the road), so the
        // road's own colours stay readable inside it.
        paint: {
          'line-color': '#e11d48',
          'line-width': ['case', ['==', ['get', 'outline'], true], 2.5, 12],
          'line-gap-width': ['case', ['==', ['get', 'outline'], true], 7, 0],
          'line-opacity': ['case', ['==', ['get', 'outline'], true], 0.95, 0.65],
        },
      })
    if (!map.getLayer('road-selection-point'))
      map.addLayer({
        id: 'road-selection-point',
        type: 'circle',
        source: 'road-selection',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#e11d48',
          'circle-radius': 10,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
    map.moveLayer('road-selection-highlight')
    map.moveLayer('road-selection-point')
    if (range && start && end)
      map.fitBounds(
        [
          [
            Math.min(start[0], end[0], ...samples.map((p) => p[0])),
            Math.min(start[1], end[1], ...samples.map((p) => p[1])),
          ],
          [
            Math.max(start[0], end[0], ...samples.map((p) => p[0])),
            Math.max(start[1], end[1], ...samples.map((p) => p[1])),
          ],
        ],
        { padding: 70, maxZoom: range.maxZoom ?? 17, duration: 350 },
      )
  }, [map, isLoaded, analysis, props.alignment, props.selectedRange])

  const bounds = useMemo(() => terrainBounds(props.project.terrain), [props.project.terrain])
  // A RoadEng TIN covers a few percent of its box along a long road: its pixels are sized from that.
  const coverShare = useMemo(() => terrainCoverShare(props.project.terrain), [props.project.terrain])
  const display = useMemo(
    () => (bounds ? buildTerrainDisplay(props.source, bounds, PLAN_TERRAIN_DISPLAY_SIDE, { coverShare }) : null),
    [bounds, props.source, coverShare],
  )
  const chosen = props.selectedStation ?? nearestStation(analysis.stations, props.station)
  const activeCable = resolvedCables.find((c) => c.id === props.activeCableId)
  const originalCable = projectCables.find((c) => c.id === props.activeCableId)
  const cableCursor = useMemo(() => {
    if (!activeCable || props.cableDistance === undefined) return null
    try {
      return cableCoordinateAtDistance(activeCable, props.cableDistance)
    } catch {
      return null
    }
  }, [activeCable, props.cableDistance])
  // Labels and ticks follow the zoom: an overview shows a few stations, zooming in adds more. They
  // follow it during the gesture too, read once a frame and only re-rendered when the eighth-of-a-zoom
  // step or the whole-degree bearing changes; waiting for zoomend left a deep zoom's labels piled up.
  const [view, setView] = useState<{ zoom: number; bearing: number } | null>(null)
  const [culvertCardId, setCulvertCardId] = useState<string | null>(null)
  useEffect(() => {
    if (!map || !isLoaded) return
    let frame = 0
    const update = () => {
      frame = 0
      const zoom = Math.round(map.getZoom() * 8) / 8,
        bearing = Math.round(map.getBearing())
      setView((previous) => (previous?.zoom === zoom && previous.bearing === bearing ? previous : { zoom, bearing }))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    map.on('zoom', schedule)
    map.on('rotate', schedule)
    map.on('zoomend', update)
    map.on('rotateend', update)
    return () => {
      cancelAnimationFrame(frame)
      map.off('zoom', schedule)
      map.off('rotate', schedule)
      map.off('zoomend', update)
      map.off('rotateend', update)
    }
  }, [map, isLoaded])
  // The credits stay behind the ⓘ button rather than covering the plan (and the map PDF) until dragged.
  useEffect(() => {
    if (!map || !isLoaded) return
    return keepAttributionFolded(map.getContainer())
  }, [map, isLoaded])
  // Remounts the handles after a drag, because a marker stays where it was dropped.
  const [bendRevision, setBendRevision] = useState(0)
  /** The browser still sends a click when a drag ends on its handle. */
  const bendDragged = useRef(false)
  // The tangent each end curve already takes from a leg, so a bend handle only shows where one fits.
  const bendTangents = useMemo(() => {
    try {
      return new globalThis.Map(
        horizontalCurveFits(props.savedAlignment).map((fit) => [
          fit.point - 1,
          fit.status === 'fitted' ? fit.tangentM : 0,
        ]),
      )
    } catch {
      return new globalThis.Map<number, number>()
    }
  }, [props.savedAlignment])
  const bendRoom = (legStart: number, length: number) =>
    length - (bendTangents.get(legStart) ?? 0) - (bendTangents.get(legStart + 1) ?? 0) >=
    MIN_BEND_ROOM_RADII * props.project.settings.minRadius
  // Where the selected point's curve is taken hold of. It follows a point drag, like the bend
  // handles, but not its own pull: the handle in use has to stay mounted.
  const curveHandle = useMemo(() => {
    if (props.mode !== 'edit' || !props.onCurveRadius || !props.selectedPoint) return null
    const grip = curveGrip(props.savedAlignment, props.selectedPoint)
    return grip ? { id: props.selectedPoint, ...grip } : null
  }, [props.mode, props.onCurveRadius, props.selectedPoint, props.savedAlignment])
  const pixelMetres =
    view && analysis.stations.length ? metresPerPixel(view.zoom, analysis.stations[0].coordinate[1]) : null
  const labelInterval = pixelMetres === null ? null : stationLabelInterval(pixelMetres)
  const annotationStations = useMemo(() => {
    if (!analysis.stations.length || labelInterval === null) return []
    return labelChainages(analysis.length, labelInterval).flatMap((chainage) => {
      const at = placeOn(props.alignment, chainage)
      return at ? [{ chainage, ...at }] : []
    })
  }, [analysis, labelInterval, props.alignment])
  const ticks = useMemo(() => {
    if (!props.showLabels || !analysis.stations.length || labelInterval === null || pixelMetres === null) return fc([])
    return fc(
      tickChainages(analysis.length, labelInterval, pixelMetres).flatMap(({ chainage, major }) => {
        const at = placeOn(props.alignment, chainage)
        if (!at) return []
        const half = (major ? 7 : 3.5) * pixelMetres
        return [
          line(
            [
              offsetCoordinate(at.coordinate, at.bearing - 90, half),
              offsetCoordinate(at.coordinate, at.bearing + 90, half),
            ],
            { major },
          ),
        ]
      }),
    )
  }, [analysis, labelInterval, pixelMetres, props.alignment, props.showLabels])
  const radiusLabels = useMemo(() => {
    if (props.terrainOnly || pixelMetres === null) return []
    try {
      return horizontalCurveSummary(props.alignment).flatMap((curve, index) => {
        // A curve label appears once its arc is long enough on screen to belong to it.
        if (curve.length / pixelMetres < 28) return []
        const at = placeOn(props.alignment, (curve.start + curve.end) / 2)
        const name = `C${index + 1}`
        const events = horizontalCurveEvents(curve)
          .map((event) => `${event.label} ${formatRoadStation(event.chainage)}`)
          .join('; ')
        return at
          ? [
              {
                id: `curve-${index}`,
                // RoadEng's plan label: name and radius. The turn's direction is in the title.
                label: `${name} R=${curve.radius.toFixed(1)}`,
                title: `Horizontal curve ${name}: ${curve.direction} turn, radius ${curve.radius.toFixed(1)} m, full deflection ${curve.deflectionDegrees.toFixed(1)}°, circular arc ${curve.length.toFixed(1)} m, full curve ${curve.fullLength.toFixed(1)} m; ${events}`,
                at,
                curve,
              },
            ]
          : []
      })
    } catch {
      return []
    }
  }, [props.alignment, props.terrainOnly, pixelMetres])
  // Curve points (BC/EC, or TS/SC/CS/ST with spirals) labelled with their stations along the road, on
  // the radius label's side, once the whole curve is long enough on screen for its labels not to touch.
  const curvePointLabels = useMemo(
    () =>
      radiusLabels.flatMap(({ id, curve }) =>
        pixelMetres !== null && curve.fullLength / pixelMetres >= CURVE_POINT_LABEL_MIN_PX
          ? horizontalCurveEvents(curve).flatMap((event) => {
              const at = placeOn(props.alignment, event.chainage)
              return at
                ? [
                    {
                      id: `${id}-${event.label}`,
                      label: `${event.label} ${formatRoadStation(event.chainage)}`,
                      at,
                      event,
                    },
                  ]
                : []
            })
          : [],
      ),
    [radiusLabels, pixelMetres, props.alignment],
  )
  const allLines = useMemo(() => {
    if (investigation) return fc([])
    const colors = distinctRoadColors(props.project.alignments)
    return fc(
      props.project.alignments.flatMap((a) => {
        const result = props.analyses.get(a.id)
        if (!result) return []
        if (a.id !== props.alignment.id)
          return [line(result.centerline, { id: a.id, color: colors.get(a.id)!, selected: false })]
        return result.stations.slice(1).map((p, i) =>
          line([result.stations[i].coordinate, p.coordinate], {
            id: a.id,
            selected: true,
            chainage: p.chainage,
            color:
              props.terrainOnly && a.id === props.alignment.id
                ? '#0284c7'
                : p.groundElevation === null
                  ? '#9ca3af'
                  : p.gradePercent !== null && Math.abs(p.gradePercent) > props.project.settings.maxGradePercent
                    ? '#dc2626'
                    : a.mappedRoad
                      ? (colors.get(a.id) ?? MAPPED_ROAD_COLOR)
                      : '#d97706',
          }),
        )
      }),
    )
  }, [
    investigation,
    props.project.alignments,
    props.project.settings.maxGradePercent,
    props.analyses,
    props.alignment.id,
    props.terrainOnly,
  ])
  const costColours = props.roadColour === 'cost' && !props.terrainOnly ? props.costColours : undefined
  const costAttribution = costColours?.attribution
  const costRowId = costColours?.rowId
  const roadLines = useMemo(() => {
    const lines = props.terrainOnly
      ? allLines
      : props.roadColour === 'grade'
        ? gradeClassRoadLines(allLines, analysis.stations, props.project.settings.maxGradePercent)
        : costAttribution && costRowId !== undefined
          ? costColourLines(allLines, costAttribution, costRowId)
          : allLines
    if (!props.refusedEdit) return lines
    return fc(
      lines.features.map((feature) =>
        feature.properties?.selected
          ? { ...feature, properties: { ...feature.properties, color: REFUSED_EDIT_COLOR } }
          : feature,
      ),
    )
  }, [
    allLines,
    analysis.stations,
    props.roadColour,
    costAttribution,
    costRowId,
    props.terrainOnly,
    props.project.settings.maxGradePercent,
    props.refusedEdit,
  ])
  // The legend names the row the road is coloured by and the average its classes are read against.
  const costHeading = useMemo(
    () => (costAttribution && costRowId !== undefined ? costColourHeading(costAttribution, costRowId) : undefined),
    [costAttribution, costRowId],
  )
  const onWholeEstimate = costColours?.onWholeEstimate
  const costAction = useMemo(
    () =>
      costHeading && costRowId !== 'total' && onWholeEstimate
        ? { label: 'Whole estimate', onClick: onWholeEstimate }
        : undefined,
    [costHeading, costRowId, onWholeEstimate],
  )
  const corridor = useMemo(() => {
    const reach = props.project.settings.crossSectionHalfWidth
    // A side whose batter ran past the section reach is drawn out to the reach, in red, rather
    // than dropped: the road is still there, the section just cannot close it.
    const extent = (s: RoadStation, side: 'Left' | 'Right') => {
      const daylight = side === 'Left' ? s.leftDaylightM : s.rightDaylightM
      if (daylight !== null) return { offset: Math.abs(daylight), beyond: false }
      if (s.groundElevation === null || !s.flags.some((f) => f.startsWith(side) && isBeyondReachFlag(f))) return null
      return { offset: reach, beyond: true }
    }
    const footprint = (props.terrainOnly ? [] : analysis.stations.slice(1)).flatMap((b, i) => {
      const a = analysis.stations[i]
      const al = extent(a, 'Left'),
        bl = extent(b, 'Left'),
        br = extent(b, 'Right'),
        ar = extent(a, 'Right')
      if (!al || !bl || !br || !ar) return []
      const beyond = al.beyond || bl.beyond || br.beyond || ar.beyond
      if (!beyond && (!a.complete || !b.complete)) return []
      const points = [
        offsetCoordinate(a.coordinate, a.bearing - 90, al.offset),
        offsetCoordinate(b.coordinate, b.bearing - 90, bl.offset),
        offsetCoordinate(b.coordinate, b.bearing + 90, br.offset),
        offsetCoordinate(a.coordinate, a.bearing + 90, ar.offset),
      ]
      return [
        ...preparationMarginFeatures(a, b),
        {
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [[...points, points[0]]] },
          properties: {
            chainage: (a.chainage + b.chainage) / 2,
            beyond,
            color: beyond
              ? '#dc2626'
              : (a.cutAreaM2 ?? 0) + (b.cutAreaM2 ?? 0) >= (a.fillAreaM2 ?? 0) + (b.fillAreaM2 ?? 0)
                ? '#d97706'
                : '#3b82f6',
          },
        },
      ]
    })
    return fc([...footprint, ...(props.terrainOnly ? [] : clearingLineFeatures(analysis.stations))])
  }, [analysis, props.terrainOnly, props.project.settings.crossSectionHalfWidth])
  const formation = useMemo(
    () =>
      fc(
        (props.terrainOnly ? [] : analysis.stations.slice(1)).flatMap((b, i) => {
          const a = analysis.stations[i]
          if (
            a.groundElevation === null ||
            b.groundElevation === null ||
            a.designElevation === null ||
            b.designElevation === null
          )
            return []
          const coordinates = [
            offsetCoordinate(a.coordinate, a.bearing - 90, a.leftWidth),
            offsetCoordinate(b.coordinate, b.bearing - 90, b.leftWidth),
            offsetCoordinate(b.coordinate, b.bearing + 90, b.rightWidth),
            offsetCoordinate(a.coordinate, a.bearing + 90, a.rightWidth),
          ]
          return [
            {
              type: 'Feature' as const,
              geometry: { type: 'Polygon' as const, coordinates: [[...coordinates, coordinates[0]]] },
              properties: { chainage: (a.chainage + b.chainage) / 2 },
            },
          ]
        }),
      ),
    [analysis, props.terrainOnly],
  )
  const roadEdges = useMemo(
    () =>
      fc(
        (props.terrainOnly ? [] : analysis.stations.slice(1)).flatMap((b, i) => {
          const a = analysis.stations[i]
          if (
            a.groundElevation === null ||
            b.groundElevation === null ||
            a.designElevation === null ||
            b.designElevation === null
          )
            return []
          return [-1, 1].map((side) =>
            line(
              [
                offsetCoordinate(a.coordinate, a.bearing + side * 90, side < 0 ? a.leftWidth : a.rightWidth),
                offsetCoordinate(b.coordinate, b.bearing + side * 90, side < 0 ? b.leftWidth : b.rightWidth),
              ],
              { chainage: (a.chainage + b.chainage) / 2 },
            ),
          )
        }),
      ),
    [analysis, props.terrainOnly],
  )
  const context = useMemo(
    () =>
      fc([
        // Riparian screens are drawn dissolved by band (`riparianDisplay.ts`); clicks never read them.
        ...mergeRiparianZones(riparianMapFeatures(props.visibleContext)).features.map((feature) => ({
          ...feature,
          properties: { ...feature.properties, sheetKey: riparianSheetKey(feature.properties?.riparianBand) },
        })),
        ...props.visibleContext.map((feature) => ({
          type: 'Feature' as const,
          geometry: feature.geometry,
          properties: {
            ...feature,
            geometry: undefined,
            ...contextHistoryProperties(feature, props.project.harvestHistoryYear ?? new Date().getFullYear()),
            ...sheetProperties(feature),
          },
        })),
      ]),
    [props.visibleContext, props.project.harvestHistoryYear],
  )
  const ditches = useMemo(() => {
    if (props.terrainOnly) return fc([])
    const templates = new globalThis.Map(analysis.engineering?.stations.map((s) => [s.chainage, s.template]))
    const points = analysis.stations.map((s) =>
      sectionCodePoints(s, templates.get(s.chainage) ?? props.alignment.template),
    )
    return fc(
      analysis.stations.slice(1).flatMap((b, index) => {
        const a = analysis.stations[index]
        return (['left', 'right'] as const).flatMap((side) => {
          const pa = points[index].find((p) => p.code === `${side}-ditch-bottom`),
            pb = points[index + 1].find((p) => p.code === `${side}-ditch-bottom`)
          if (!pa || !pb || pa.ground === null || pb.ground === null || pa.design === null || pb.design === null)
            return []
          return [
            line(
              [
                offsetCoordinate(a.coordinate, a.bearing + (side === 'left' ? -90 : 90), Math.abs(pa.offset)),
                offsetCoordinate(b.coordinate, b.bearing + (side === 'left' ? -90 : 90), Math.abs(pb.offset)),
              ],
              { chainage: (a.chainage + b.chainage) / 2, kind: `${side}-ditch-bottom` },
            ),
          ]
        })
      }),
    )
  }, [analysis, props.alignment.template, props.terrainOnly])
  const cable = useMemo(
    () =>
      fc(
        resolvedCables.map((c) =>
          line([c.start, c.end], { id: c.id, name: c.name, selected: c.id === props.activeCableId }),
        ),
      ),
    [resolvedCables, props.activeCableId],
  )
  const draft = useMemo(
    () => fc(props.draft.length > 1 && props.mode !== 'avoid' ? [line(props.draft)] : []),
    [props.draft, props.mode],
  )
  // Cross-drain sites become a band along the road and a tick across it, drawn in metres.
  const drainage = useMemo(
    () => (props.drainage ? crossDrainMarks(props.drainage, analysis) : fc([])),
    [props.drainage, analysis],
  )
  const structures = useMemo(
    () =>
      fc([
        ...(props.terrainOnly ? [] : (analysis.engineering?.culverts ?? [])).flatMap((culvert) => {
          const properties = {
            id: culvert.id,
            chainage: culvert.chainage,
            name: culvert.name,
            // Blue as RoadEng draws a culvert; red when it has warnings. Never amber, the road's own colour.
            // Selection widens it (the layer's paint), so a selected culvert keeps its warning colour.
            color: culvert.warnings.length ? '#dc2626' : '#0284c7',
            selected: culvert.id === props.selectedCulvertId,
          }
          // The profile runs inlet (distance 0) to outlet; the arrow leaves the outlet.
          const inlet = culvert.profile[0]?.coordinate ?? culvert.start,
            outlet = culvert.profile[culvert.profile.length - 1]?.coordinate ?? culvert.end
          return [
            line([culvert.start, culvert.end], { ...properties, kind: 'barrel' }),
            ...culvertFlowArrow(inlet, outlet, distance(inlet, outlet)).map((part) =>
              line(part, { ...properties, kind: 'arrow' }),
            ),
          ]
        }),
        // Draft culverts from a cross-drain batch preview (`crossDrainBatchPlan.ts`).
        ...(props.terrainOnly ? [] : (props.draftCulverts ?? [])),
      ]),
    [analysis, props.terrainOnly, props.selectedCulvertId, props.draftCulverts],
  )
  const section = useMemo(
    () =>
      fc(
        chosen
          ? [
              line([
                offsetCoordinate(chosen.coordinate, chosen.bearing - 90, props.project.settings.crossSectionHalfWidth),
                offsetCoordinate(chosen.coordinate, chosen.bearing + 90, props.project.settings.crossSectionHalfWidth),
              ]),
              { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: chosen.coordinate } },
            ]
          : [],
      ),
    [chosen, props.project.settings.crossSectionHalfWidth],
  )
  const latestSection = useRef(section)
  // The sheet layers on the map now, so another set of symbols can take their place.
  const drawnSheetSet = useRef<PlanSheetLayerSet | null>(null)
  useLayoutEffect(() => {
    latestSection.current = section
  }, [section])
  // Reference features change rarely. Their source is created with the plan's other sources, where
  // its layers take their place in the ordered group, and updated by its own effect below, so a
  // road edit does not send up to 50,000 reference vertices through MapLibre's worker again.
  const reference = useMemo(
    () => referencePlanData(props.visibleReference, props.referenceStyles),
    [props.visibleReference, props.referenceStyles],
  )
  const latestReference = useRef(reference)
  const latestBuffers = useRef(props.visibleBufferData)
  const bufferImages = useRef(new Set<string>())
  useLayoutEffect(() => {
    latestReference.current = reference
  }, [reference])
  useLayoutEffect(() => {
    latestBuffers.current = props.visibleBufferData
  }, [props.visibleBufferData])
  // The stroke being sketched has its own source: it changes on every pointer move, and sending it
  // with the other sources would queue all of them behind each move.
  const [stroke, setStroke] = useState<Coordinate[]>([])
  const sketchLine = useMemo(() => fc(stroke.length > 1 ? [line(stroke)] : []), [stroke])
  const latestSketch = useRef(sketchLine)
  /** Whether a plan hover is following the road, and where the pointer last was (planHover.ts). */
  const hoverState = useRef<{ engaged: boolean; lastPointer: { x: number; y: number } | null; alignmentId: string }>({
    engaged: false,
    lastPointer: null,
    alignmentId: '',
  })
  useLayoutEffect(() => {
    latestSketch.current = sketchLine
  }, [sketchLine])
  useEffect(() => {
    if (!map || !isLoaded) return
    ;(map.getSource('road-sketch') as GeoJSONSource | undefined)?.setData(sketchLine)
  }, [map, isLoaded, sketchLine])
  const onSketch = props.onSketch
  useEffect(() => {
    if (!map || !isLoaded || mode !== 'sketch' || !onSketch) return
    // Press, drag, release. The map stops panning while the pencil is in hand.
    map.dragPan.disable()
    map.touchZoomRotate.disableRotation()
    let current: Coordinate[] | null = null
    const at = (e: MapMouseEvent | MapTouchEvent): Coordinate => [e.lngLat.lng, e.lngLat.lat]
    const down = (e: MapMouseEvent | MapTouchEvent) => {
      if ('points' in e && e.points.length > 1) return
      e.preventDefault()
      current = [at(e)]
      setStroke(current)
    }
    const move = (e: MapMouseEvent | MapTouchEvent) => {
      if (!current) return
      const next = at(e)
      const last = current[current.length - 1]
      if (map.project(last).dist(map.project(next)) < SKETCH_CAPTURE_PX) return
      current = [...current, next]
      setStroke(current)
    }
    const up = () => {
      if (!current) return
      const finished = current
      current = null
      setStroke([])
      const metresPerPixel = (40075016.7 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())
      if (finished.length > 1) onSketch(finished, metresPerPixel)
    }
    map.on('mousedown', down)
    map.on('touchstart', down)
    map.on('mousemove', move)
    map.on('touchmove', move)
    map.on('mouseup', up)
    map.on('touchend', up)
    return () => {
      map.off('mousedown', down)
      map.off('touchstart', down)
      map.off('mousemove', move)
      map.off('touchmove', move)
      map.off('mouseup', up)
      map.off('touchend', up)
      map.dragPan.enable()
      map.touchZoomRotate.enableRotation()
      setStroke([])
    }
  }, [map, isLoaded, mode, onSketch])

  useEffect(() => {
    if (!map || !isLoaded) return
    const key = `${props.project.terrain.sha256 ?? props.project.terrain.name}:${props.fitRevision}:${props.fitRequest.revision}`
    if (key === previousFit.current) return
    const activeCoordinates = props.alignment.points.map((p) => p.coordinate)
    const extent = (coordinates: Coordinate[]) =>
      [
        [Math.min(...coordinates.map((p) => p[0])), Math.min(...coordinates.map((p) => p[1]))],
        [Math.max(...coordinates.map((p) => p[0])), Math.max(...coordinates.map((p) => p[1]))],
      ] as [Coordinate, Coordinate]
    const activeBounds = activeCoordinates.length ? extent(activeCoordinates) : null
    const intersects =
      bounds &&
      activeBounds &&
      activeBounds[0][0] <= bounds[2] &&
      activeBounds[1][0] >= bounds[0] &&
      activeBounds[0][1] <= bounds[3] &&
      activeBounds[1][1] >= bounds[1]
    const manual = previousManualFit.current !== props.fitRequest.revision
    // A new DEM may be hundreds of kilometres from the existing roads. Reveal its
    // coverage rather than silently refitting those unrelated controls.
    const target =
      investigation && !manual
        ? 'roads'
        : manual
          ? props.fitRequest.target
          : bounds && !intersects
            ? 'terrain'
            : props.project.totalCostPlanning
              ? 'roads'
              : 'active'
    const coordinates = target === 'terrain' ? [] : roadPlanFitCoordinates(props.project, target, props.alignment)
    const fitBounds =
      target === 'terrain' && bounds
        ? ([
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ] as [Coordinate, Coordinate])
        : coordinates.length
          ? extent(coordinates)
          : null
    const launch = new URLSearchParams(window.location.search)
    if (
      !previousFit.current &&
      launch.get('example') === 'training' &&
      launch.get('lesson') === 'sketch-road' &&
      props.project.terrain.kind === 'demo'
    ) {
      map.jumpTo({ center: [-122.7265, 53.887], zoom: 16.7 })
    } else if (fitBounds) map.fitBounds(fitBounds, { padding: 45, maxZoom: 16, duration: 0 })
    previousFit.current = key
    previousManualFit.current = props.fitRequest.revision
  }, [map, isLoaded, bounds, props.alignment, props.project, props.fitRevision, props.fitRequest, investigation])

  // Hatch tiles and marker icons for the sheet symbols. MapLibre drops images on a style reload;
  // `keepSymbolImages` adds them back when the style asks for them.
  useEffect(() => {
    if (!map || !isLoaded) return
    return keepSymbolImages(
      map as unknown as SymbolImageMap,
      Object.values(props.sheetLayerSet.symbols),
      window.devicePixelRatio || 1,
    )
  }, [map, isLoaded, props.sheetLayerSet])

  useEffect(() => {
    if (!map || !isLoaded) return
    const inputs: Record<string, GeoJSON.FeatureCollection> = {
      roads: roadLines,
      corridor,
      formation,
      edges: roadEdges,
      ditches,
      context,
      cable,
      structures,
      draft,
      section: latestSection.current,
      sketch: latestSketch.current,
      ticks,
      contours: display?.contours ?? fc([]),
      overlay: props.overlay ?? fc([]),
      drainage,
      'ground-drainage': props.groundDrainage ?? fc([]),
      swept: props.swept ?? fc([]),
    }
    for (const [name, data] of Object.entries(inputs)) {
      const id = `road-${name}`
      const existing = map.getSource(id) as GeoJSONSource | undefined
      if (existing) existing.setData(data)
      else map.addSource(id, { type: 'geojson', data })
    }
    if (!map.getSource(REFERENCE_SOURCE))
      map.addSource(REFERENCE_SOURCE, { type: 'geojson', data: latestReference.current })
    if (!map.getSource(CUTBLOCK_BUFFER_SOURCE))
      map.addSource(CUTBLOCK_BUFFER_SOURCE, { type: 'geojson', data: latestBuffers.current })
    if (display && props.terrainLayer !== 'none') {
      // Over the map the hillshade is drawn as the relief around it is; over imagery it stays the grey hillshade.
      const url = props.terrainLayer === 'hillshade' && !props.imagery ? display.relief : display[props.terrainLayer]
      const existing = map.getSource('road-terrain') as ImageSource | undefined
      const coordinates = display.coordinates as [Coordinate, Coordinate, Coordinate, Coordinate]
      if (existing) existing.updateImage({ url, coordinates })
      else map.addSource('road-terrain', { type: 'image', url, coordinates })
      if (!map.getLayer('road-terrain'))
        map.addLayer({
          id: 'road-terrain',
          type: 'raster',
          source: 'road-terrain',
          paint: { 'raster-opacity': TERRAIN_OPACITY, 'raster-fade-duration': 0 },
        })
    }
    const add = (layer: Parameters<typeof map.addLayer>[0]) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer)
    }
    add({
      id: 'road-contours',
      type: 'line',
      source: 'road-contours',
      paint: { 'line-width': 0.65 },
    })
    for (const layer of REFERENCE_LAYERS) add(layer)
    add({
      id: CUTBLOCK_BUFFER_LAYERS[0],
      type: 'fill',
      source: CUTBLOCK_BUFFER_SOURCE,
      filter: ['!', ['has', 'pattern']],
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.09 },
    })
    add({
      id: CUTBLOCK_BUFFER_LAYERS[1],
      type: 'fill',
      source: CUTBLOCK_BUFFER_SOURCE,
      filter: ['has', 'pattern'],
      paint: { 'fill-pattern': ['get', 'pattern'] },
    })
    add({
      id: CUTBLOCK_BUFFER_LAYERS[2],
      type: 'line',
      source: CUTBLOCK_BUFFER_SOURCE,
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [3, 2] },
    })
    add({
      id: 'road-context-fill',
      type: 'fill',
      source: 'road-context',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': [
          'match',
          ['get', 'riparianBand'],
          'reserve',
          RIPARIAN_MAP_COLORS.reserve,
          'management',
          RIPARIAN_MAP_COLORS.management,
          'uncertain',
          RIPARIAN_MAP_COLORS.uncertain,
          [
            'coalesce',
            ['get', 'historyColor'],
            ['match', ['get', 'kind'], 'harvest', PLAN_CONTEXT_STYLES.harvest.color, PLAN_CONTEXT_STYLES.avoid.color],
          ],
        ],
        'fill-opacity': CONTEXT_FILL_OPACITY,
      },
    })
    add({
      id: 'road-context-line',
      type: 'line',
      source: 'road-context',
      filter: ['!=', ['get', 'kind'], 'existing-road'],
      paint: {
        'line-color': [
          'match',
          ['get', 'riparianBand'],
          'reserve',
          RIPARIAN_MAP_COLORS.reserve,
          'management',
          RIPARIAN_MAP_COLORS.management,
          'uncertain',
          RIPARIAN_MAP_COLORS.uncertain,
          [
            'coalesce',
            ['get', 'historyColor'],
            [
              'match',
              ['get', 'kind'],
              'stream',
              PLAN_CONTEXT_STYLES.stream.color,
              'harvest',
              PLAN_CONTEXT_STYLES.harvest.color,
              PLAN_CONTEXT_STYLES.avoid.color,
            ],
          ],
        ],
        'line-width': 2,
        'line-dasharray': PLAN_LINE_DASHES.context,
      },
    })
    for (const [key, style] of Object.entries(ROAD_HISTORY_STYLES))
      add({
        id: `road-history-${key}`,
        type: 'line',
        source: 'road-context',
        filter: ['all', ['==', ['get', 'kind'], 'existing-road'], ['==', ['get', 'historyKey'], key]],
        paint: { 'line-color': style.color, 'line-width': 2.5, 'line-dasharray': style.dasharray },
      })
    // Another set of sheet symbols replaces the layers: the same ids can carry a different paint.
    const sheetSet = props.sheetLayerSet
    if (drawnSheetSet.current !== sheetSet) {
      for (const id of drawnSheetSet.current?.ids ?? []) if (map.getLayer(id)) map.removeLayer(id)
      drawnSheetSet.current = sheetSet
    }
    for (const layer of sheetSet.layers) add(layer)
    add({
      id: 'road-corridor',
      type: 'fill',
      source: 'road-corridor',
      // The clearing lines share the source; a fill layer would close each one into an area.
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.28 },
    })
    add({
      id: 'road-clearing',
      type: 'line',
      source: 'road-corridor',
      filter: ['==', ['get', 'role'], 'clearing'],
      paint: { 'line-color': CLEARING_LINE_COLOR, 'line-width': 1.4, 'line-dasharray': [4, 2] },
    })
    add({
      id: 'road-corridor-reach',
      type: 'line',
      source: 'road-corridor',
      filter: ['==', ['get', 'beyond'], true],
      paint: { 'line-color': '#dc2626', 'line-width': 1.2, 'line-dasharray': [2, 2] },
    })
    add({
      id: 'road-formation',
      type: 'fill',
      source: 'road-formation',
      paint: { 'fill-color': '#fef3c7', 'fill-opacity': 0.55 },
    })
    add({
      id: 'road-edges',
      type: 'line',
      source: 'road-edges',
      paint: { 'line-color': '#78716c', 'line-width': 1.2 },
    })
    add({
      id: 'road-alignments-halo',
      type: 'line',
      source: 'road-roads',
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.7 },
    })
    add({
      id: 'road-ditches',
      type: 'line',
      source: 'road-ditches',
      paint: { 'line-color': '#0f766e', 'line-width': 2, 'line-dasharray': PLAN_LINE_DASHES.ditch },
    })
    add({
      id: 'road-alignments',
      type: 'line',
      source: 'road-roads',
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 4, 2.5] },
    })
    add({
      id: 'road-ticks',
      type: 'line',
      source: 'road-ticks',
      paint: {
        'line-color': '#1c1917',
        'line-width': ['case', ['get', 'major'], 1.6, 1],
        'line-opacity': 0.8,
      },
    })
    add({
      id: 'road-cable',
      type: 'line',
      source: 'road-cable',
      paint: { 'line-color': '#7c3aed', 'line-width': ['case', ['get', 'selected'], 4, 2], 'line-dasharray': [2, 2] },
    })
    add({
      id: 'road-section',
      type: 'line',
      source: 'road-section',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#e11d48', 'line-width': 2 },
    })
    add({
      id: 'road-section-point',
      type: 'circle',
      source: 'road-section',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': '#e11d48',
        'circle-radius': 4,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    add({
      id: 'road-structures',
      type: 'line',
      source: 'road-structures',
      filter: ['==', ['get', 'kind'], 'barrel'],
      // Two thin lines either side of a gap, the pipe's walls across the road, as RoadEng draws a
      // culvert. Its name and size are in the card a click opens (CulvertCard.tsx).
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['==', ['get', 'selected'], true], 2.5, 1.75],
        // A draft culvert's flow arrow is one line, not two walls.
        'line-gap-width': ['case', ['==', ['get', 'arrow'], true], 0, ['==', ['get', 'selected'], true], 6, 4],
      },
    })
    // The flow arrow out of each culvert's outlet (culvertFlowArrow.ts), a single line.
    add({
      id: 'road-structures-arrow',
      type: 'line',
      source: 'road-structures',
      filter: ['==', ['get', 'kind'], 'arrow'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'selected'], true], 2.5, 1.75] },
    })
    add({
      id: 'road-draft',
      type: 'line',
      source: 'road-draft',
      paint: { 'line-color': DRAFT_COLOR, 'line-width': 3, 'line-dasharray': [2, 1] },
    })
    add({
      id: 'road-sketch',
      type: 'line',
      source: 'road-sketch',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0d9488', 'line-width': 4, 'line-opacity': 0.85 },
    })
    // Existing-ground streams dashed and pale, design-surface streams solid and widening with
    // contributing area, so a stream the road turns shows as the two lines parting.
    // Flow lines join as the map zooms in: larger and convergent ones first (`STREAM_ZOOM_STOPS`).
    // A line saved without these properties (an older run) always shows; a diversion always shows.
    const shown = (atLeastRatio: number, atLeastWidth: number): ExpressionSpecification => [
      'case',
      [
        'any',
        ['==', ['get', 'role'], 'diversion'],
        [
          'all',
          ['>=', ['coalesce', ['get', 'thresholdRatio'], 1_000_000], atLeastRatio],
          ['>=', ['coalesce', ['get', 'widthCells'], 1_000_000], atLeastWidth],
        ],
      ],
      1,
      0,
    ]
    const streamZoomOpacity = [
      'interpolate',
      ['linear'],
      ['zoom'],
      ...STREAM_ZOOM_STOPS.flatMap(([zoom, ratio, width]) => [zoom, shown(ratio, width)]),
    ] as ExpressionSpecification
    add({
      id: 'road-drainage-catchment-fill',
      type: 'fill',
      source: 'road-drainage',
      filter: ['in', ['get', 'role'], ['literal', ['catchment', 'watershed']]],
      paint: {
        'fill-color': [
          'match',
          ['get', 'role'],
          'catchment',
          PLAN_DRAINAGE_STYLES.catchment.color,
          PLAN_DRAINAGE_STYLES.watershed.color,
        ],
        'fill-opacity': ['match', ['get', 'role'], 'catchment', 0.2, 0.08],
      },
    })
    add({
      id: 'road-drainage-catchment-outline',
      type: 'line',
      source: 'road-drainage',
      filter: ['in', ['get', 'role'], ['literal', ['catchment', 'watershed']]],
      paint: {
        'line-color': [
          'match',
          ['get', 'role'],
          'catchment',
          PLAN_DRAINAGE_STYLES.catchment.color,
          PLAN_DRAINAGE_STYLES.watershed.color,
        ],
        'line-width': ['match', ['get', 'role'], 'catchment', 2, 1],
      },
    })
    add({
      id: 'road-drainage-existing',
      type: 'line',
      source: 'road-drainage',
      filter: ['==', ['get', 'role'], 'stream-existing'],
      paint: {
        'line-color': PLAN_DRAINAGE_STYLES['stream-existing'].color,
        'line-width': 1.5,
        'line-dasharray': [2, 1.5],
        'line-opacity': streamZoomOpacity,
      },
    })
    add({
      id: 'road-drainage-line',
      type: 'line',
      source: 'road-drainage',
      filter: [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        ['!', ['in', ['get', 'role'], ['literal', ['stream-existing', 'cross-drain-band', 'cross-drain-tick']]]],
      ],
      paint: {
        'line-color': [
          'match',
          ['get', 'role'],
          'diversion',
          PLAN_DRAINAGE_STYLES.diversion.color,
          PLAN_DRAINAGE_STYLES['stream-design'].color,
        ],
        'line-width': [
          'case',
          ['==', ['get', 'role'], 'diversion'],
          3,
          ['interpolate', ['linear'], ['coalesce', ['get', 'areaHa'], 0], 0, 1.2, 5, 2.5, 50, 4.5],
        ],
        'line-opacity': streamZoomOpacity,
      },
    })
    // Cross-drain candidates: a sleeve (two thin lines either side of the road, by line-gap) over
    // the stretch where flow leaves the road, stronger for more area draining off, and once zoomed
    // in a dashed tick across the road where a culvert would go. The sleeve reads on any road
    // colour, and both marks follow the road, so zoomed out they never become a field of dots.
    add({
      id: 'road-drainage-cross-drain-band',
      type: 'line',
      source: 'road-drainage',
      filter: ['==', ['get', 'role'], 'cross-drain-band'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': PLAN_DRAINAGE_STYLES['cross-drain-band'].color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 3],
        'line-gap-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 6, 15, 10, 18, 40],
        'line-opacity': ['interpolate', ['linear'], ['coalesce', ['get', 'areaHa'], 0], 0.05, 0.55, 2, 1],
      },
    })
    add({
      id: 'road-drainage-cross-drain-tick',
      type: 'line',
      source: 'road-drainage',
      minzoom: 14.5,
      filter: ['==', ['get', 'role'], 'cross-drain-tick'],
      paint: {
        'line-color': PLAN_DRAINAGE_STYLES['cross-drain-band'].color,
        'line-width': 2.5,
        'line-dasharray': [1.5, 1],
      },
    })
    add({
      id: 'road-drainage-point',
      type: 'circle',
      source: 'road-drainage',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': [
          'match',
          ['get', 'role'],
          'pond',
          PLAN_DRAINAGE_STYLES.pond.color,
          'low-point',
          PLAN_DRAINAGE_STYLES['low-point'].color,
          'pour-point',
          PLAN_DRAINAGE_STYLES['pour-point'].color,
          '#dc2626',
        ],
        'circle-radius': ['match', ['get', 'role'], 'pond', 3, 6],
        'circle-stroke-width': ['match', ['get', 'role'], 'pond', 0, 2],
        'circle-stroke-color': '#ffffff',
      },
    })
    // Existing-ground drainage over an analysis area, before any road: its own source and colours,
    // so it never reads as the road's before/after check. Streams thin by zoom as the road's do.
    const groundRole = (role: string): ExpressionSpecification => ['==', ['get', 'role'], role]
    add({
      id: 'road-ground-drainage-watershed-fill',
      type: 'fill',
      source: 'road-ground-drainage',
      filter: groundRole('ground-watershed'),
      paint: { 'fill-color': GROUND_DRAINAGE_STYLES['ground-watershed'].color, 'fill-opacity': 0.06 },
    })
    add({
      id: 'road-ground-drainage-watershed-line',
      type: 'line',
      source: 'road-ground-drainage',
      filter: groundRole('ground-watershed'),
      paint: { 'line-color': GROUND_DRAINAGE_STYLES['ground-watershed'].color, 'line-width': 1, 'line-opacity': 0.7 },
    })
    add({
      id: 'road-ground-drainage-catchment-fill',
      type: 'fill',
      source: 'road-ground-drainage',
      filter: groundRole('ground-catchment'),
      paint: { 'fill-color': GROUND_DRAINAGE_STYLES['ground-catchment'].color, 'fill-opacity': 0.18 },
    })
    add({
      id: 'road-ground-drainage-catchment-line',
      type: 'line',
      source: 'road-ground-drainage',
      filter: groundRole('ground-catchment'),
      paint: { 'line-color': GROUND_DRAINAGE_STYLES['ground-catchment'].color, 'line-width': 2 },
    })
    add({
      id: 'road-ground-drainage-area',
      type: 'line',
      source: 'road-ground-drainage',
      filter: groundRole('ground-area'),
      paint: {
        'line-color': GROUND_DRAINAGE_STYLES['ground-area'].color,
        'line-width': 2,
        'line-dasharray': [3, 1.5],
      },
    })
    add({
      id: 'road-ground-drainage-stream',
      type: 'line',
      source: 'road-ground-drainage',
      filter: groundRole('ground-stream'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': GROUND_DRAINAGE_STYLES['ground-stream'].color,
        'line-width': ['interpolate', ['linear'], ['coalesce', ['get', 'areaHa'], 0], 0, 1.2, 5, 2.5, 50, 4.5],
        'line-opacity': streamZoomOpacity,
      },
    })
    add({
      id: 'road-ground-drainage-snap',
      type: 'line',
      source: 'road-ground-drainage',
      filter: groundRole('ground-outlet-snap'),
      paint: {
        'line-color': GROUND_DRAINAGE_STYLES['ground-outlet'].color,
        'line-width': 1.5,
        'line-dasharray': [1, 1],
      },
    })
    add({
      id: 'road-ground-drainage-point',
      type: 'circle',
      source: 'road-ground-drainage',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['match', ['get', 'role'], 'ground-outlet', 6, 5],
        'circle-color': [
          'match',
          ['get', 'role'],
          'ground-outlet',
          GROUND_DRAINAGE_STYLES['ground-outlet'].color,
          '#ffffff',
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': [
          'match',
          ['get', 'role'],
          'ground-outlet',
          '#ffffff',
          GROUND_DRAINAGE_STYLES['ground-outlet-requested'].color,
        ],
      },
    })
    // Swept path: body and load dashed under the solid wheel paths; red where wheels leave the formation.
    add({
      id: 'road-swept-body',
      type: 'line',
      source: 'road-swept',
      filter: ['==', ['get', 'role'], 'swept-body'],
      paint: { 'line-color': '#7c3aed', 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
    })
    add({
      id: 'road-swept-wheels',
      type: 'line',
      source: 'road-swept',
      filter: ['==', ['get', 'role'], 'swept-wheels'],
      paint: { 'line-color': '#ea580c', 'line-width': 2 },
    })
    add({
      id: 'road-swept-deficit',
      type: 'line',
      source: 'road-swept',
      filter: ['==', ['get', 'role'], 'swept-deficit'],
      paint: { 'line-color': '#dc2626', 'line-width': 5, 'line-opacity': 0.85 },
    })
    // Overlay areas that ask for a fill (`fill: true`), such as extraction-reach distance classes.
    add({
      id: 'road-exploration-fill',
      type: 'fill',
      source: 'road-overlay',
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'fill'], true]],
      paint: { 'fill-color': ['coalesce', ['get', 'color'], '#7c3aed'], 'fill-opacity': 0.3 },
    })
    // Vehicle tools: swept area filled under everything, then templates, traces, lock runs and the vehicle itself.
    add({
      id: 'road-swept-area',
      type: 'fill',
      source: 'road-swept',
      filter: ['all', ['==', ['get', 'role'], 'swept-area'], ['==', ['geometry-type'], 'Polygon']],
      paint: { 'fill-color': ['coalesce', ['get', 'color'], '#7c3aed'], 'fill-opacity': 0.18 },
    })
    add({
      id: 'road-swept-area-line',
      type: 'line',
      source: 'road-swept',
      filter: ['all', ['==', ['get', 'role'], 'swept-area'], ['==', ['geometry-type'], 'Polygon']],
      paint: { 'line-color': ['coalesce', ['get', 'color'], '#7c3aed'], 'line-width': 1 },
    })
    add({
      id: 'road-vehicle-template',
      type: 'line',
      source: 'road-swept',
      filter: ['==', ['get', 'role'], 'vehicle-template'],
      paint: { 'line-color': ['coalesce', ['get', 'color'], '#475569'], 'line-width': 1.5, 'line-dasharray': [3, 2] },
    })
    add({
      id: 'road-vehicle-trace',
      type: 'line',
      source: 'road-swept',
      filter: ['==', ['get', 'role'], 'vehicle-trace'],
      paint: { 'line-color': ['coalesce', ['get', 'color'], '#0891b2'], 'line-width': 1.5 },
    })
    add({
      id: 'road-vehicle-lock',
      type: 'line',
      source: 'road-swept',
      filter: ['==', ['get', 'role'], 'vehicle-lock'],
      paint: { 'line-color': '#dc2626', 'line-width': 5, 'line-opacity': 0.85 },
    })
    add({
      id: 'road-vehicle-outline',
      type: 'line',
      source: 'road-swept',
      filter: ['==', ['get', 'role'], 'vehicle-outline'],
      paint: { 'line-color': ['coalesce', ['get', 'color'], '#0f172a'], 'line-width': 1.5 },
    })
    add({
      id: 'road-exploration-line',
      type: 'line',
      source: 'road-overlay',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#7c3aed'],
        'line-width': ['case', ['==', ['get', 'selected'], true], 5, 3],
        'line-offset': ['match', ['get', 'pathRole'], 'loaded', 3, 'return', -3, 0],
        'line-dasharray': [3, 1],
      },
    })
    add({
      id: 'road-exploration-point',
      type: 'circle',
      source: 'road-overlay',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], '#7c3aed'],
        'circle-radius': 5,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
    if (map.getLayer('road-terrain')) {
      map.setLayoutProperty('road-terrain', 'visibility', props.terrainLayer === 'none' ? 'none' : 'visible')
      // Slope, aspect and elevation are read by colour, so they stay opaque over imagery.
      map.setPaintProperty(
        'road-terrain',
        'raster-opacity',
        props.imagery && props.terrainLayer === 'hillshade' ? IMAGERY_HILLSHADE_OPACITY : TERRAIN_OPACITY,
      )
      map.setPaintProperty(
        'road-terrain',
        'raster-brightness-max',
        dark && !props.imagery && props.terrainLayer === 'hillshade' ? DARK_HILLSHADE_BRIGHTNESS_MAX : 1,
      )
    }
    const contourPaint = CONTOUR_PAINT[dark ? 'dark' : 'light']
    map.setPaintProperty('road-contours', 'line-color', contourPaint.color)
    map.setPaintProperty('road-contours', 'line-opacity', contourPaint.opacity)
    // Sheet symbols replace the plan's context colours. The context fill stays, transparent, so a
    // click on a harvest area still finds it.
    for (const id of sheetSet.ids) map.setLayoutProperty(id, 'visibility', props.sheetSymbols ? 'visible' : 'none')
    for (const id of PLAN_CONTEXT_LINE_LAYER_IDS)
      map.setLayoutProperty(id, 'visibility', props.sheetSymbols ? 'none' : 'visible')
    map.setPaintProperty('road-context-fill', 'fill-opacity', props.sheetSymbols ? 0 : CONTEXT_FILL_OPACITY)
    map.setLayoutProperty('road-contours', 'visibility', props.showContours ? 'visible' : 'none')
    for (const id of [
      'road-corridor',
      'road-corridor-reach',
      'road-clearing',
      'road-formation',
      'road-edges',
      'road-ditches',
    ])
      map.setLayoutProperty(id, 'visibility', props.showEarthwork && !props.terrainOnly ? 'visible' : 'none')
    // Keep all analytical overlays above a replaced terrain image/style.
    for (const id of [
      'road-contours',
      ...CUTBLOCK_BUFFER_LAYERS,
      // Reference linework is background: under streams, constraints and every road.
      ...REFERENCE_LINEWORK_LAYER_IDS,
      'road-context-fill',
      'road-context-line',
      ...ROAD_HISTORY_LAYER_IDS,
      ...sheetSet.ids,
      // Ground drainage is evidence under the roads, so pegging over it keeps the road on top.
      'road-ground-drainage-watershed-fill',
      'road-ground-drainage-watershed-line',
      'road-ground-drainage-catchment-fill',
      'road-ground-drainage-catchment-line',
      'road-ground-drainage-area',
      'road-ground-drainage-stream',
      'road-ground-drainage-snap',
      'road-ground-drainage-point',
      'road-corridor',
      'road-corridor-reach',
      'road-formation',
      'road-edges',
      'road-ditches',
      'road-clearing',
      // A named point shows through the earthwork footprint and sits under the road that ends on it.
      REFERENCE_POINT_LAYER_ID,
      REFERENCE_ICON_LAYER_ID,
      'road-alignments-halo',
      'road-alignments',
      'road-ticks',
      'road-cable',
      'road-structures',
      'road-structures-arrow',
      'road-section',
      'road-draft',
      'road-sketch',
      'road-drainage-existing',
      'road-drainage-catchment-fill',
      'road-drainage-catchment-outline',
      'road-drainage-line',
      'road-drainage-cross-drain-band',
      'road-drainage-cross-drain-tick',
      'road-drainage-point',
      'road-swept-area',
      'road-swept-area-line',
      'road-swept-body',
      'road-swept-wheels',
      'road-swept-deficit',
      'road-exploration-fill',
      'road-vehicle-template',
      'road-vehicle-trace',
      'road-vehicle-lock',
      'road-vehicle-outline',
      'road-exploration-line',
      'road-exploration-point',
    ])
      map.moveLayer(id)
    for (const id of ['road-selection-highlight', 'road-selection-point']) if (map.getLayer(id)) map.moveLayer(id)
    map.moveLayer('road-section-point')
  }, [
    map,
    isLoaded,
    roadLines,
    corridor,
    formation,
    roadEdges,
    ditches,
    context,
    cable,
    structures,
    draft,
    ticks,
    display,
    props.terrainLayer,
    props.imagery,
    dark,
    props.showContours,
    props.showEarthwork,
    props.terrainOnly,
    props.overlay,
    drainage,
    props.groundDrainage,
    props.swept,
    props.sheetSymbols,
    props.sheetLayerSet,
  ])

  // The selected station changes on every frame of a scrub. Each setData is a trip through
  // MapLibre's worker, so sending only this source keeps the other fourteen from queueing ahead of
  // it. The dot and its section line share the source so they land on the same frame.
  useEffect(() => {
    if (!map || !isLoaded) return
    ;(map.getSource('road-section') as GeoJSONSource | undefined)?.setData(section)
  }, [map, isLoaded, section])

  // The reference source and legend read the same visible features. The selected one draws heavier.
  useEffect(() => {
    if (!map || !isLoaded) return
    ;(map.getSource(REFERENCE_SOURCE) as GeoJSONSource | undefined)?.setData(reference)
    // A custom dash is matched by key, so the line layer's dash follows the project's looks.
    if (map.getLayer('road-reference-line'))
      map.setPaintProperty(
        'road-reference-line',
        'line-dasharray',
        referenceLineDash(referenceCustomDashes(props.referenceStyles)),
      )
  }, [map, isLoaded, reference, props.referenceStyles])
  useEffect(() => {
    if (!map || !isLoaded) return
    const images = new globalThis.Map(
      [...props.bufferSymbols, ...props.referenceSymbols]
        .flatMap((symbol) => symbolImages(symbol, window.devicePixelRatio || 1))
        .map((image) => [image.id, image]),
    )
    for (const id of bufferImages.current) {
      if (!images.has(id) && map.hasImage(id)) map.removeImage(id)
    }
    const add = (id: string) => {
      const image = images.get(id)
      if (image && !map.hasImage(id)) map.addImage(id, image.image, { pixelRatio: image.pixelRatio })
    }
    for (const id of images.keys()) add(id)
    bufferImages.current = new Set(images.keys())
    const onMissing = (event: { id: string }) => add(event.id)
    map.on('styleimagemissing', onMissing)
    ;(map.getSource(CUTBLOCK_BUFFER_SOURCE) as GeoJSONSource | undefined)?.setData(props.visibleBufferData)
    return () => {
      map.off('styleimagemissing', onMissing)
    }
  }, [map, isLoaded, props.visibleBufferData, props.bufferSymbols, props.referenceSymbols])
  useEffect(() => {
    if (!map || !isLoaded) return
    const located: ExpressionSpecification = ['==', ['get', 'id'], props.focusedReferenceId ?? '']
    if (map.getLayer('road-reference-line'))
      map.setPaintProperty('road-reference-line', 'line-width', referenceLineWidth(0, props.focusedReferenceId))
    if (map.getLayer('road-reference-fill'))
      map.setPaintProperty('road-reference-fill', 'fill-opacity', ['case', located, 0.3, REFERENCE_FILL_OPACITY])
    if (map.getLayer(REFERENCE_POINT_LAYER_ID))
      map.setPaintProperty(REFERENCE_POINT_LAYER_ID, 'circle-radius', ['case', located, 9, 6])
  }, [map, isLoaded, props.focusedReferenceId])

  useEffect(() => {
    if (!map || !isLoaded) return
    // Only road pegging snaps; streams, areas and profiles are drawn where they are clicked.
    const snapAt = (e: MapMouseEvent) =>
      snapRoads
        ? snapToRoads([e.lngLat.lng, e.lngLat.lat], snapRoads, mercatorMetresPerPixel(map.getZoom(), e.lngLat.lat))
        : null
    const click = (e: MapMouseEvent) => {
      // A note tool, or a click on a drawn note, belongs to the notes layer.
      if (noteTool || planToolActive) return
      const noteLayers = NOTE_LAYER_IDS.filter((id) => map.getLayer(id))
      if (noteLayers.length && map.queryRenderedFeatures(e.point, { layers: [...noteLayers] }).length) return
      if (pourPointPicking && onPourPoint) {
        onPourPoint([e.lngLat.lng, e.lngLat.lat])
        return
      }
      if (mode === 'sketch') return
      if (areaDrawing) {
        // The second click of a double-click adds nothing; the double-click closes the area.
        if (e.originalEvent.detail > 1) return
        const { draft, onFinishDraw } = latestDraw.current
        if (onFinishDraw && canFinishSketch('polygon', draft) && nearFirstVertex(map.project(draft[0]), e.point)) {
          onFinishDraw()
          return
        }
        onDraw([e.lngLat.lng, e.lngLat.lat])
        return
      }
      if (!['inspect', 'edit'].includes(mode)) {
        const snap = snapAt(e)
        onDraw(snap?.coordinate ?? [e.lngLat.lng, e.lngLat.lat])
        if (snap) onSnap?.(snap, draftLength === 0)
        return
      }
      if ((e.originalEvent.target as Element)?.closest('.maplibregl-marker')) return
      // The culvert card closes on a click anywhere else; a click on a culvert below opens it again.
      setCulvertCardId(null)
      if (mode === 'inspect' && onHistorySelect) {
        const historyLayers = map
          .getStyle()
          .layers.filter(
            (layer) =>
              'source' in layer &&
              ['circle-shared-road-access-history-structures', 'line-shared-road-access-history-route'].includes(
                String(layer.source),
              ),
          )
          .map((layer) => layer.id)
        const historyHits = historyLayers.length ? map.queryRenderedFeatures(e.point, { layers: historyLayers }) : []
        const historyHit =
          historyHits.find((feature) => feature.source === 'circle-shared-road-access-history-structures') ??
          historyHits[0]
        if (historyHit?.properties?.id) {
          onHistorySelect({
            kind: historyHit.source === 'circle-shared-road-access-history-structures' ? 'structure' : 'path',
            id: String(historyHit.properties.id),
          })
          return
        }
      }
      const preview = map.queryRenderedFeatures(e.point, {
        layers: ['road-exploration-line', 'road-exploration-point'],
      })[0]
      if (preview && onOverlaySelect) {
        onOverlaySelect(preview.properties)
        return
      }
      // A few pixels' grace: the culvert is drawn as two hairlines.
      const structure = map.queryRenderedFeatures(
        [
          [e.point.x - 5, e.point.y - 5],
          [e.point.x + 5, e.point.y + 5],
        ],
        { layers: ['road-structures'] },
      )[0]?.properties
      if (structure?.chainage !== undefined) {
        if (structure.id) {
          onSelectCulvert?.(String(structure.id))
          setCulvertCardId(String(structure.id))
        }
        onStation(Number(structure.chainage))
        return
      }
      const hits = map.queryRenderedFeatures(e.point, { layers: ['road-alignments'] })
      const hit = hits[0]?.properties
      if (hit?.id && hit.id !== activeAlignmentId) onSelectAlignment(String(hit.id))
      else if (hit?.chainage !== undefined) onStation(Number(hit.chainage))
      else if (onSelectCable && map.queryRenderedFeatures(e.point, { layers: ['road-cable'] })[0]?.properties?.id) {
        const cableId = String(map.queryRenderedFeatures(e.point, { layers: ['road-cable'] })[0].properties.id)
        onSelectCable(cableId)
        const selected = resolvedCables.find((c) => c.id === cableId)
        if (selected && onCableDistance) {
          onCableDistance(cableDistanceAt(selected.start, selected.end, [e.lngLat.lng, e.lngLat.lat]))
        }
      } else if (mode === 'inspect') {
        if (onContextSelect) {
          const contextHit = map
            .queryRenderedFeatures(e.point, {
              layers: [...ROAD_HISTORY_LAYER_IDS, ...props.sheetLayerSet.roadHitIds, 'road-context-fill'],
            })
            .find((feature) => ['existing-road', 'harvest'].includes(String(feature.properties?.kind)))
          const feature = props.project.context.find((candidate) => candidate.id === contextHit?.properties?.id)
          if (feature) {
            onContextSelect(feature, [e.lngLat.lng, e.lngLat.lat])
            return
          }
        }
        if (!analysis.stations.length) return
        const nearest = analysis.stations.reduce((best, s) =>
          distance(s.coordinate, [e.lngLat.lng, e.lngLat.lat]) < distance(best.coordinate, [e.lngLat.lng, e.lngLat.lat])
            ? s
            : best,
        )
        onStation(nearest.chainage)
      }
    }
    // The active road's stations on screen, re-projected only after the view moves.
    let screenStations: ScreenStation[] | null = null
    const stationsOnScreen = () =>
      (screenStations ??= analysis.stations.map((s) => {
        const p = map.project(s.coordinate as [number, number])
        return { x: p.x, y: p.y, chainage: s.chainage }
      }))
    const viewMoved = () => {
      screenStations = null
    }
    // Hover near the road, not exactly on it: see planHover.ts. The hover's state lives in a ref,
    // because this effect re-runs on most page renders, a station change among them.
    const hover = hoverState.current
    const hoverMode =
      props.stationHover !== false &&
      ['inspect', 'edit'].includes(mode) &&
      !noteTool &&
      !planToolActive &&
      !pourPointPicking
    if (!hoverMode || investigation || hover.alignmentId !== activeAlignmentId) {
      hover.engaged = false
      hover.lastPointer = null
    }
    hover.alignmentId = activeAlignmentId
    const setHoverCursor = (engaged: boolean) => {
      hover.engaged = engaged
      map.getCanvas().style.cursor = engaged ? 'pointer' : ''
    }
    const leave = () => {
      hover.lastPointer = null
      if (hoverMode) setHoverCursor(false)
    }
    const move = (e: MapMouseEvent) => {
      if (pourPointPicking || noteTool || planToolActive) return
      if (!['inspect', 'edit'].includes(mode)) onHover(snapAt(e)?.coordinate ?? [e.lngLat.lng, e.lngLat.lat])
      else {
        if (!hoverMode) return
        const previous = hover.lastPointer
        hover.lastPointer = { x: e.point.x, y: e.point.y }
        // A press is a pan (or a bend-handle drag); the station is not scrubbed under it.
        if (e.originalEvent.buttons) return
        // Match click precedence: hovering a spoke above the road must not
        // move the landing station and invalidate the fan before its click.
        if (
          onOverlaySelect &&
          map.queryRenderedFeatures(e.point, { layers: ['road-exploration-line', 'road-exploration-point'] }).length
        ) {
          setHoverCursor(false)
          return
        }
        // An access investigation draws no road to follow.
        if (investigation) return
        const next = planHover(stationsOnScreen(), e.point, previous, hover.engaged)
        if (next.engaged !== hover.engaged) setHoverCursor(next.engaged)
        if (next.chainage !== null) onStation(next.chainage)
      }
    }
    if (!noteTool && !planToolActive)
      map.getCanvas().style.cursor =
        pourPointPicking || !['inspect', 'edit'].includes(mode) ? 'crosshair' : hover.engaged ? 'pointer' : ''
    const doubleClick = (e: MapMouseEvent) => {
      const { draft, onFinishDraw } = latestDraw.current
      if (!areaDrawing || !onFinishDraw || !canFinishSketch('polygon', draft)) return
      e.preventDefault()
      onFinishDraw()
    }
    map.doubleClickZoom.disable()
    map.on('click', click)
    map.on('dblclick', doubleClick)
    map.on('mousemove', move)
    map.on('mouseout', leave)
    map.on('move', viewMoved)
    return () => {
      map.off('click', click)
      map.off('dblclick', doubleClick)
      map.off('mousemove', move)
      map.off('mouseout', leave)
      map.off('move', viewMoved)
      map.getCanvas().style.cursor = ''
    }
  }, [
    map,
    isLoaded,
    mode,
    areaDrawing,
    investigation,
    onDraw,
    snapRoads,
    onSnap,
    draftLength,
    onStation,
    onSelectAlignment,
    onHover,
    activeAlignmentId,
    analysis,
    onSelectCable,
    onCableDistance,
    resolvedCables,
    onOverlaySelect,
    onSelectCulvert,
    onContextSelect,
    onHistorySelect,
    props.project.context,
    pourPointPicking,
    onPourPoint,
    noteTool,
    planToolActive,
    props.stationHover,
    props.sheetLayerSet.roadHitIds,
  ])

  return (
    <>
      <TerrainRasterLayers layers={props.project.terrain.backgrounds ?? []} />
      <ReferenceSheets features={props.visibleReference} />
      <PdfClassInspector
        features={props.visibleReference}
        enabled={props.mode === 'inspect' && !props.planToolActive && !props.noteTool && !props.pourPointPicking}
      />
      <ProvincialStreamLayers data={props.project.provincialStreamData} />
      {props.overlay?.features
        .filter((feature): feature is GeoJSON.Feature<GeoJSON.Point> => feature.geometry.type === 'Point')
        .map((feature, index) => (
          <MapMarker
            key={`overlay-${feature.id ?? index}`}
            longitude={feature.geometry.coordinates[0]}
            latitude={feature.geometry.coordinates[1]}
            offset={
              feature.properties?.marker === 'dot'
                ? undefined
                : // A failed search's stop label goes above its point; below, it met the map attribution.
                  feature.properties?.kind === 'route-search-stop'
                  ? LABEL_ABOVE_PX
                  : LABEL_BELOW_PX
            }
          >
            <MarkerContent>
              {feature.properties?.marker === 'dot' ? (
                // Many points close together (cable supports): a dot, its label on hover.
                <button
                  type="button"
                  className="block size-2.5 rounded-full border border-white shadow-sm"
                  style={{ background: String(feature.properties?.color ?? '#475569') }}
                  onClick={() => props.onOverlaySelect?.(feature.properties)}
                  title={String(feature.properties?.label ?? 'Planning candidate')}
                  aria-label={String(feature.properties?.label ?? 'Planning candidate')}
                />
              ) : (
                <button
                  className={`rounded-sm border bg-background/95 px-1 py-0.5 text-3xs shadow-sm ${feature.properties?.selected === true ? 'font-semibold ring-2 ring-red-600' : ''}`}
                  data-route-stop={
                    feature.properties?.kind === 'route-search-stop' ? feature.properties.role : undefined
                  }
                  aria-pressed={
                    feature.properties?.kind === 'route-search-stop' ? feature.properties.selected === true : undefined
                  }
                  onClick={() => props.onOverlaySelect?.(feature.properties)}
                  title={String(feature.properties?.label ?? 'Planning candidate')}
                >
                  {String(feature.properties?.label ?? 'Candidate')}
                </button>
              )}
            </MarkerContent>
          </MapMarker>
        ))}
      {cableCursor && (
        <MapMarker longitude={cableCursor[0]} latitude={cableCursor[1]}>
          <MarkerContent>
            <div
              className="pointer-events-none rounded-sm border-2 border-white bg-violet-700 px-1 py-0.5 text-3xs text-white shadow"
              data-testid="road-active-cable-position"
              data-distance={props.cableDistance}
            >
              D-line {props.cableDistance?.toFixed(1)} m
            </div>
          </MarkerContent>
        </MapMarker>
      )}
      {activeCable &&
        [
          {
            coordinate: activeCable.start,
            distance: 0,
            role: originalCable?.yarderAt === 'end' ? 'Tailhold' : 'Yarder',
            height: activeCable.startHeight,
          },
          {
            coordinate: activeCable.end,
            distance: distance(activeCable.start, activeCable.end),
            role: originalCable?.yarderAt === 'end' ? 'Yarder' : 'Tailhold',
            height: activeCable.endHeight,
          },
        ].map((support, index) => (
          <MapMarker
            key={`cable-support-${index}`}
            longitude={support.coordinate[0]}
            latitude={support.coordinate[1]}
            offset={LABEL_ABOVE_PX}
          >
            <MarkerContent>
              <button
                className="rounded-sm border border-violet-400 bg-violet-50 px-1 py-0.5 text-3xs text-violet-800 shadow-sm"
                title={`${support.role}: ${support.height.toFixed(1)} m above the selected terrain`}
                aria-label={`Inspect ${support.role.toLowerCase()} support`}
                onClick={() => props.onCableDistance?.(support.distance)}
              >
                {support.role}
                {props.showLabels ? ` · ${support.height.toFixed(1)} m` : ''}
              </button>
            </MarkerContent>
          </MapMarker>
        ))}
      {props.showLabels &&
        annotationStations
          .filter((s) => Math.abs(s.chainage - (chosen?.chainage ?? -1)) > (labelInterval ?? 0) * 0.3)
          .map((s) => {
            const text = formatRoadStation(s.chainage).replace(/\.0$/, '')
            const [dx, dy] = labelOffset(s.bearing, view?.bearing ?? 0, text.length)
            return (
              <MapMarker
                key={`station-${s.chainage}`}
                longitude={s.coordinate[0]}
                latitude={s.coordinate[1]}
                offset={[dx, dy]}
              >
                <MarkerContent>
                  <button
                    className="whitespace-nowrap rounded-sm bg-background/80 px-1 text-3xs font-medium leading-4 tabular-nums text-foreground"
                    aria-label={`Inspect plan station ${s.chainage.toFixed(1)} metres`}
                    data-plan-station-label={s.chainage}
                    onClick={() => props.onStation(s.chainage)}
                  >
                    {text}
                  </button>
                </MarkerContent>
              </MapMarker>
            )
          })}
      {props.showLabels &&
        radiusLabels.map(({ id, label, title, at, curve }) => {
          const [dx, dy] = labelOffset(at.bearing, view?.bearing ?? 0, label.length, -1)
          return (
            <MapMarker key={`radius-${id}`} longitude={at.coordinate[0]} latitude={at.coordinate[1]} offset={[dx, dy]}>
              <MarkerContent>
                <button
                  className="whitespace-nowrap rounded-sm bg-violet-50/85 px-1 text-3xs font-medium leading-4 text-violet-800"
                  title={title}
                  aria-label={`Inspect horizontal curve radius ${curve.radius.toFixed(1)} metres`}
                  onClick={() => props.onStation((curve.start + curve.end) / 2)}
                >
                  {label}
                </button>
              </MarkerContent>
            </MapMarker>
          )
        })}
      {props.showLabels &&
        curvePointLabels.map(({ id, label, at, event }) => {
          const [dx, dy] = labelOffset(at.bearing, view?.bearing ?? 0, label.length, -1)
          return (
            <MapMarker
              key={`curve-point-${id}`}
              longitude={at.coordinate[0]}
              latitude={at.coordinate[1]}
              offset={[dx, dy]}
            >
              <MarkerContent>
                <button
                  className="whitespace-nowrap rounded-sm bg-violet-50/85 px-1 text-3xs leading-4 tabular-nums text-violet-800"
                  data-plan-curve-point={event.label}
                  aria-label={`Inspect curve point ${event.label} at ${formatRoadStation(event.chainage)}`}
                  onClick={() => props.onStation(event.chainage)}
                >
                  {label}
                </button>
              </MarkerContent>
            </MapMarker>
          )
        })}
      {props.mode === 'edit' &&
        props.alignment.points.map((p, index, points) => {
          // A point closer than a handle's width to a neighbour shrinks to a dot, so a dense
          // generated road stays readable; ends and the selected point keep their numbered handle.
          const gap = Math.min(
            index > 0 ? distance(points[index - 1].coordinate, p.coordinate) : Infinity,
            index < points.length - 1 ? distance(p.coordinate, points[index + 1].coordinate) : Infinity,
          )
          const compact =
            pixelMetres !== null &&
            gap / pixelMetres < MIN_HANDLE_SPACING_PX &&
            index > 0 &&
            index < points.length - 1 &&
            props.selectedPoint !== p.id
          return (
            <MapMarker
              key={p.id}
              className="z-10"
              longitude={p.coordinate[0]}
              latitude={p.coordinate[1]}
              draggable
              onDragStart={() => props.onPointDragStart(p.id)}
              onDrag={({ lng, lat }) => props.onMovePoint(p.id, [lng, lat])}
              onDragEnd={({ lng, lat }) => props.onPointDragEnd(p.id, [lng, lat])}
              onClick={() => props.onSelectPoint(p.id)}
            >
              <MarkerContent>
                <button
                  aria-label={`Horizontal point ${index + 1}`}
                  title={`${index === 0 ? 'Start' : index === props.alignment.points.length - 1 ? 'End' : `Control ${index + 1}`} · drag to move`}
                  aria-pressed={props.selectedPoint === p.id}
                  data-compact={compact || undefined}
                  className={`cursor-grab touch-none rounded-full border-2 bg-background font-bold shadow active:cursor-grabbing ${compact ? 'size-3 border-amber-600 touch:size-4' : `size-7 text-3xs ${props.selectedPoint === p.id ? 'border-rose-500 text-rose-600' : 'border-amber-600 text-warning'}`}`}
                >
                  {compact ? null : index + 1}
                </button>
              </MarkerContent>
            </MapMarker>
          )
        })}
      {props.mode === 'edit' &&
        props.onInsertPoint &&
        props.savedAlignment.points.length < 2000 &&
        props.savedAlignment.points.slice(1).map((end, index) => {
          const start = props.savedAlignment.points[index]
          const length = distance(start.coordinate, end.coordinate)
          if (length <= 0.4) return null
          // A handle needs room beside its neighbours: zoom in to bend a short segment.
          if (pixelMetres !== null && length / pixelMetres < MIN_BEND_SEGMENT_PX) return null
          // Nor on a leg whose straight, after its end curves, is too short for a bend to fit.
          if (!bendRoom(index, length)) return null
          const coordinate = positionAt({ ...props.savedAlignment, points: [start, end] }, length / 2).coordinate
          return (
            <MapMarker
              className="z-10"
              key={`insert-${start.id}-${end.id}-${bendRevision}`}
              longitude={coordinate[0]}
              latitude={coordinate[1]}
              draggable
              onDrag={({ lng, lat }) => props.onBendPreview(start.id, [lng, lat])}
              onDragEnd={({ lng, lat }) => {
                props.onBendPreview(start.id, null)
                setBendRevision((n) => n + 1)
                bendDragged.current = true
                const moved = distance(coordinate, [lng, lat]) / (pixelMetres ?? 1)
                if (moved >= MIN_BEND_DRAG_PX) props.onInsertPoint?.(start.id, [lng, lat])
                else props.onBendHint?.()
              }}
            >
              <MarkerContent>
                <MapIconButton
                  tone="blue"
                  aria-label={`Add control between points ${index + 1} and ${index + 2}`}
                  title="Drag to bend the road here"
                  className="size-5 cursor-grab touch-none rounded-full border-dashed opacity-70 hover:opacity-100 active:cursor-grabbing"
                  onClick={(event) => {
                    event.stopPropagation()
                    // Only a key press arrives with no pointer: it has no way to drag.
                    if (event.detail === 0) props.onInsertPoint?.(start.id, coordinate)
                    else if (!bendDragged.current) props.onBendHint?.()
                    bendDragged.current = false
                  }}
                >
                  <Plus aria-hidden="true" />
                </MapIconButton>
              </MarkerContent>
            </MapMarker>
          )
        })}
      {curveHandle &&
        (() => {
          // Drawn a little inside the curve, so it never sits under the point's own handle.
          const turned = ((curveHandle.inwardBearing - (view?.bearing ?? 0)) * Math.PI) / 180
          const { id, coordinate } = curveHandle
          return (
            <MapMarker
              className="z-10"
              key={`curve-${id}`}
              longitude={coordinate[0]}
              latitude={coordinate[1]}
              offset={[Math.sin(turned) * CURVE_HANDLE_OFFSET_PX, -Math.cos(turned) * CURVE_HANDLE_OFFSET_PX]}
              draggable
              onDrag={({ lng, lat }) => props.onCurvePull(id, [lng, lat], false)}
              onDragEnd={({ lng, lat }) => props.onCurvePull(id, [lng, lat], true)}
            >
              <MarkerContent>
                <span
                  data-testid="road-curve-handle"
                  data-radius={curveHandle.radiusM}
                  title="Drag toward the inside of the curve to widen it, toward the point to tighten it"
                  className="flex size-5 cursor-grab touch-none items-center justify-center rounded-full border border-violet-700 bg-violet-50 text-violet-800 shadow-sm active:cursor-grabbing [&_svg]:size-3"
                >
                  <Radius aria-hidden="true" />
                </span>
              </MarkerContent>
            </MapMarker>
          )
        })()}
      {chosen && (
        <MapMarker className="pointer-events-none" longitude={chosen.coordinate[0]} latitude={chosen.coordinate[1]}>
          <MarkerContent>
            <div
              data-testid="road-active-map-station"
              data-chainage={chosen.chainage}
              className="pointer-events-none relative size-3"
            >
              {props.showLabels && (
                <span
                  data-testid="road-active-map-label"
                  className="absolute left-1/2 top-1/2 whitespace-nowrap rounded-sm border border-rose-500 bg-background/95 px-1 text-3xs font-medium leading-4 tabular-nums text-rose-700 shadow-sm dark:text-rose-300"
                  style={(() => {
                    const text = `${formatRoadStation(chosen.chainage)} · ${chosen.gradePercent === null ? '—' : chosen.gradePercent.toFixed(1)}% · Z ${chosen.groundElevation === null ? '—' : chosen.groundElevation.toFixed(1)}`
                    const [dx, dy] = labelOffset(chosen.bearing, view?.bearing ?? 0, text.length, -1, 12)
                    return { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` }
                  })()}
                >
                  {formatRoadStation(chosen.chainage)} ·{' '}
                  {chosen.gradePercent === null ? '—' : `${chosen.gradePercent.toFixed(1)}%`} · Z{' '}
                  {chosen.groundElevation === null ? '—' : chosen.groundElevation.toFixed(1)}
                </span>
              )}
            </div>
          </MarkerContent>
        </MapMarker>
      )}
      {props.mode === 'avoid' ? (
        <MapSketchLayers
          shape="polygon"
          mode="drawing"
          points={props.draft}
          cursor={props.drawHover ?? null}
          // The plan's own click handler places the points, so a pick, a note or a tool can still
          // take the click first; the sketch draws them.
          capture={false}
          onAdd={props.onDraw}
          onFinish={() => props.onFinishDraw?.()}
          color={DRAFT_COLOR}
          testId="road-area-draft"
        />
      ) : (
        props.draft.map((coordinate, i) => (
          <MapMarker key={i} longitude={coordinate[0]} latitude={coordinate[1]}>
            <MarkerContent>
              <span className="fixed-palette block size-3 rounded-full border-2 border-white bg-teal-600" />
            </MarkerContent>
          </MapMarker>
        ))
      )}
      {analysis.crossings
        .filter((c) => c.kind === 'stream' && !props.hiddenContextKinds.includes('stream'))
        .map((crossing) => (
          <MapMarker key={crossing.id} longitude={crossing.coordinate[0]} latitude={crossing.coordinate[1]}>
            <MarkerContent>
              <MapIconButton
                tone="sky"
                title={`${crossing.name} — crossing review`}
                aria-label={`Select crossing ${crossing.name}`}
                onClick={() => props.onStation(crossing.chainage)}
              >
                <Waves aria-hidden="true" />
              </MapIconButton>
            </MarkerContent>
          </MapMarker>
        ))}
      <span data-testid="road-map-ready" data-ready={isLoaded} className="sr-only">
        {isLoaded ? 'Road map ready' : 'Loading road map'}
      </span>
      {/* The line across the road is the culvert; this is its keyboard and click target only, so
          the plan carries no label boxes. Name and size open in its card. */}
      {!props.terrainOnly &&
        analysis.engineering?.culverts.map((culvert) => {
          const selected = props.selectedCulvertId === culvert.id
          return (
            <MapMarker key={`culvert-${culvert.id}`} longitude={culvert.coordinate[0]} latitude={culvert.coordinate[1]}>
              <MarkerContent>
                <button
                  type="button"
                  className="block size-4 rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  aria-label={`Inspect structure ${culvert.name}`}
                  aria-pressed={selected}
                  onClick={() => {
                    props.onSelectCulvert?.(culvert.id)
                    props.onStation(culvert.chainage)
                    setCulvertCardId(culvert.id)
                  }}
                  title={`${culvert.name} · ${formatRoadStation(culvert.chainage)}`}
                />
              </MarkerContent>
            </MapMarker>
          )
        })}
      {(() => {
        const culvert = culvertCardId ? analysis.engineering?.culverts.find((c) => c.id === culvertCardId) : undefined
        if (!culvert || props.terrainOnly) return null
        const designOf = (id: string) => props.alignment.engineering?.culverts.find((c) => c.id === id)
        return (
          <CulvertCard
            culvert={culvert}
            design={designOf(culvert.id)}
            together={(analysis.engineering?.culverts ?? [])
              .filter((c) => c.id !== culvert.id && Math.abs(c.chainage - culvert.chainage) < CULVERTS_TOGETHER_M)
              .map((c) => ({ culvert: c, design: designOf(c.id) }))}
            onPick={(id) => {
              const picked = analysis.engineering?.culverts.find((c) => c.id === id)
              if (!picked) return
              props.onSelectCulvert?.(id)
              props.onStation(picked.chainage)
              setCulvertCardId(id)
            }}
            onClose={() => setCulvertCardId(null)}
          />
        )
      })()}
      <AccessHistoryLayers data={historicalMap} selection={props.historySelection} />
      <SightlinePlanLayers data={props.sightlines} />
      <MapLineLayer
        sourceKey="road-access-history-selected-road"
        data={selectedMappedRoad}
        color="#0891b2"
        width={6}
        opacity={1}
        layerOrder={65}
      />
      <PlanLegend
        sections={[
          ...buildPlanLegend({
            sources: {
              roads: roadLines,
              context,
              corridor,
              formation,
              edges: roadEdges,
              ditches,
              cable,
              structures,
              draft,
              section,
              ticks,
              overlay: props.overlay,
              drainage: props.drainage ? drainage : undefined,
              groundDrainage: props.groundDrainage,
              swept: props.swept,
            },
            alignments: props.project.alignments,
            maxGradePercent: props.project.settings.maxGradePercent,
            terrainOnly: !!props.terrainOnly,
            showEarthwork: props.showEarthwork,
            sheetSymbols: props.sheetSymbols,
            sheetSymbolSet: props.sheetLayerSet,
            selection:
              !!props.selectedRange &&
              !!placeOn(props.alignment, props.selectedRange.start) &&
              !!placeOn(props.alignment, props.selectedRange.end),
            draftPoints: props.draft.length > 0,
            editing: props.mode === 'edit' && props.alignment.points.length > 0,
            insertControls:
              props.mode === 'edit' &&
              !!props.onInsertPoint &&
              props.alignment.points
                .slice(1)
                .some((point, index) => distance(props.alignment.points[index].coordinate, point.coordinate) > 0.4),
            crossingMarkers:
              !props.hiddenContextKinds.includes('stream') &&
              analysis.crossings.some((crossing) => crossing.kind === 'stream'),
            curveLabels: props.showLabels && radiusLabels.length > 0,
            curveHandle: !!curveHandle,
            cableCursor: !!cableCursor,
            cableSupports: !!activeCable,
            roadsHeading: costHeading,
          }).map((section) => (section.id === 'roads' && costAction ? { ...section, action: costAction } : section)),
          ...historicalMap.legend,
          ...referenceLegend(props.visibleReference, props.referenceStyles),
          ...(props.visibleBufferData.features.length
            ? [
                {
                  id: 'cutblock-buffers',
                  title: 'Cutblocks',
                  entries: props.bufferSymbols.map((symbol, i) => ({
                    id: `cutblock-buffer-${i}`,
                    label: symbol.label,
                    color: symbol.fill ?? CUTBLOCK_BUFFER_COLOR,
                    shape: 'area' as const,
                    sheetSymbol: symbol,
                  })),
                },
              ]
            : []),
          ...(selectedMappedRoad.features.length
            ? [
                {
                  id: 'selected-mapped-road',
                  title: 'Selected record',
                  entries: [
                    {
                      id: 'selected-mapped-road',
                      label: 'Selected mapped road · association unverified',
                      color: '#0891b2',
                      shape: 'line' as const,
                    },
                  ],
                },
              ]
            : []),
        ]}
        display={display}
        terrainLayer={props.terrainLayer}
        showContours={props.showContours}
        terrainName={props.project.terrain.name}
        toolOpen={!!planToolActive}
        expanded={props.display.legendOpen}
        onExpandedChange={props.display.setLegendOpen}
        placement={props.display.legendPlacement}
        belowSlot={props.legendSlot}
      />
    </>
  )
}

/**
 * Labels set off their point move the marker itself (MapLibre's `offset`), never the content with a
 * CSS transform: the marker's box stays where it was put, and the plan ignores clicks on a marker,
 * so a transformed label left a dead box over the line it labels.
 */
const LABEL_BELOW_PX: [number, number] = [0, 20]
const LABEL_ABOVE_PX: [number, number] = [0, -20]

/** On-screen length a segment needs before it offers a bend handle. */
const MIN_BEND_SEGMENT_PX = 48
/**
 * A bend handle shows only on a leg with this many minimum radii of straight left after its end
 * curves: less, and almost any bend placed there is refused (`planEditCheck.ts`).
 */
const MIN_BEND_ROOM_RADII = 1
/** The active road's colour while a dragged edit would be refused. */
const REFUSED_EDIT_COLOR = '#e11d48'
/** Numbered handles are 28 px; closer than this to a neighbour, a point shows as a dot. */
const MIN_HANDLE_SPACING_PX = 34
/** On-screen length (px) a whole horizontal curve needs before its BC/EC labels show. */
const CURVE_POINT_LABEL_MIN_PX = 90
/** A handle moved less than this was a slip, so no point is added. */
const MIN_BEND_DRAG_PX = 10
/** How far inside its arc the selected point's curve handle is drawn, clear of the point's own handle. */
const CURVE_HANDLE_OFFSET_PX = 26

/** A shared empty list, so a project without notes does not re-send the notes source every render. */
const NO_NOTES: MapNote[] = []
const NO_REFERENCE: ReferenceFeature[] = []

export function PlanView(input: PlanProps) {
  const investigation = isAccessInvestigation(input.project)
  const analyses = useMemo(
    () =>
      investigation
        ? new globalThis.Map(input.project.alignments.map((alignment) => [alignment.id, investigationAnalysis()]))
        : input.analyses,
    [investigation, input.project.alignments, input.analyses],
  )
  // A caller cannot accidentally expose the internal draft through stale mode or preview props.
  const props: PlanProps = investigation
    ? {
        ...input,
        analyses,
        mode: 'inspect',
        onMode: undefined,
        draft: [],
        selectedRange: undefined,
        terrainOnly: true,
        activeCableId: undefined,
        overlay: undefined,
        drainage: undefined,
        groundDrainage: undefined,
        swept: undefined,
      }
    : input
  const [drag, setDrag] = useState<{ original: Alignment; id: string; coordinate: Coordinate } | null>(null)
  const [bend, setBend] = useState<{ original: Alignment; afterId: string; coordinate: Coordinate } | null>(null)
  const [pull, setPull] = useState<{ original: Alignment; id: string; radiusM: number; at: Coordinate } | null>(null)
  const newPointRadius = props.project.settings.minRadius
  const previewAlignment = useMemo(() => {
    if (props.mode !== 'edit') return null
    if (drag && drag.original === props.alignment)
      return {
        ...props.alignment,
        points: props.alignment.points.map((point) =>
          point.id === drag.id ? { ...point, coordinate: drag.coordinate } : point,
        ),
      }
    if (bend && bend.original === props.alignment) {
      // The road is drawn through the handle: the new point goes beyond it, with the curve that fits.
      const { coordinate, radiusM } = bendThrough(props.alignment, bend.afterId, bend.coordinate, newPointRadius)
      return {
        ...props.alignment,
        points: props.alignment.points.flatMap((point) =>
          point.id === bend.afterId ? [point, { id: 'bend-preview', coordinate, radiusM }] : [point],
        ),
      }
    }
    if (pull && pull.original === props.alignment)
      return {
        ...props.alignment,
        points: props.alignment.points.map((point) =>
          point.id === pull.id ? { ...point, radiusM: pull.radiusM } : point,
        ),
      }
    return null
  }, [drag, bend, pull, props.alignment, props.mode, newPointRadius])
  // The edit the drag would make is checked as it moves, so a refusal shows before the drop.
  const previewRefusal = useMemo(
    () =>
      previewAlignment
        ? checkPlanEdit(props.alignment, previewAlignment, newPointRadius, { context: props.project.context })
        : null,
    [previewAlignment, props.alignment, newPointRadius, props.project.context],
  )
  const dragAt = drag?.coordinate ?? bend?.coordinate ?? pull?.at
  // Bend handles follow a point drag, which keeps every point id and so every handle's key, but
  // never a bend preview: its extra point re-keys the handle in use, and remounting it loses the drop.
  const handleAlignment = (drag && previewAlignment) || props.alignment
  const previewAnalyses = useMemo(() => {
    if (!previewAlignment) return props.analyses
    const analyses = new globalThis.Map(props.analyses)
    analyses.set(
      previewAlignment.id,
      safeAnalyzeRoad(previewAlignment, props.source, props.project.settings, props.project.context, {
        sharedCrossingCosts: props.project.sharedCrossingCosts,
      }),
    )
    return analyses
  }, [
    previewAlignment,
    props.analyses,
    props.source,
    props.project.settings,
    props.project.context,
    props.project.sharedCrossingCosts,
  ])
  const { terrainLayer, setTerrainLayer, settingsOpen, setSettingsOpen } = props.display
  // The same Map / Satellite choice as the visual-quality maps, under the plan's own layers.
  const [basemap, setBasemap] = useStoredImageryBasemap('pgmaps-road-basemap')
  const { showContours, setShowContours, showLabels, setShowLabels, showEarthwork, setShowEarthwork, fitRequest, fit } =
    props.display
  // Block-sheet symbols by default, as printed block-map sheets draw them; a saved choice of
  // the standard road plan stays this browser's choice.
  const [symbolStyle, setSymbolStyle] = useState<PlanSymbolStyle>(() => {
    try {
      return planSymbolStyle(localStorage.getItem('pgmaps-road-symbol-style'))
    } catch {
      return 'block-sheet'
    }
  })
  const sheetSymbols = symbolStyle !== 'road-plan'
  // Saved styles: the block sheet's symbols with this browser's style library over the features it
  // names, read again whenever the library is edited (Save & export, Styles).
  const [styleLibraryRevision, setStyleLibraryRevision] = useState(0)
  useEffect(() => {
    const changed = () => setStyleLibraryRevision((n) => n + 1)
    window.addEventListener(STYLE_LIBRARY_CHANGED, changed)
    return () => window.removeEventListener(STYLE_LIBRARY_CHANGED, changed)
  }, [])
  const sheetLayerSet = useMemo(
    () =>
      symbolStyle === 'saved-styles'
        ? planSheetLayerSet('road-context', roleOverrides(readStoredStyleLibrary()))
        : PLAN_SHEET_SET,
    // The revision is the library's: the memo reads storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbolStyle, styleLibraryRevision],
  )
  const chooseSymbolStyle = (value: string) => {
    const style = planSymbolStyle(value)
    setSymbolStyle(style)
    try {
      localStorage.setItem('pgmaps-road-symbol-style', style)
    } catch {
      /* Keep the choice for this session when browser storage is unavailable. */
    }
  }
  const [editHelpVisible, setEditHelpVisible] = useState(() => {
    try {
      return localStorage.getItem('pgmaps-road-edit-help') !== 'hidden'
    } catch {
      return true
    }
  })
  const showEditHelp = (visible: boolean) => {
    setEditHelpVisible(visible)
    try {
      localStorage.setItem('pgmaps-road-edit-help', visible ? 'visible' : 'hidden')
    } catch {
      /* The preference still works when browser storage is unavailable. */
    }
  }
  const [hiddenContextKinds, setHiddenContextKinds] = useState<ContextFeature['kind'][]>([])
  const visibleContext = useMemo(
    () =>
      props.project.context.filter(
        ({ kind, layerSource }) =>
          !hiddenContextKinds.includes(kind) && (!layerSource || !props.hiddenReferenceLayers?.includes(layerSource)),
      ),
    [props.project.context, hiddenContextKinds, props.hiddenReferenceLayers],
  )
  // Map notes: their own project collection, drawn with the notes bar and hidden as one layer.
  const notes = props.project.notes ?? NO_NOTES
  // Reference features: imported points, lines and areas that only the plan draws.
  const reference = props.project.reference ?? NO_REFERENCE
  const bufferSettings = props.project.cutblockBuffers
  const attachedBufferSources = useMemo(
    () => new Set(bufferSettings?.flatMap((setting) => ('source' in setting ? [setting.source] : []))),
    [bufferSettings],
  )
  const visibleReference = useMemo(
    () =>
      reference.filter((feature) => {
        const key = referenceLayerKey(feature)
        return !attachedBufferSources.has(key) && !props.hiddenReferenceLayers?.includes(key)
      }),
    [reference, attachedBufferSources, props.hiddenReferenceLayers],
  )
  const referenceSymbols = useMemo(
    () => referenceStyleSymbols(visibleReference, props.project.referenceStyles),
    [visibleReference, props.project.referenceStyles],
  )
  const bufferData = useMemo(() => {
    const visible =
      bufferSettings?.filter(
        (setting) =>
          !hiddenContextKinds.includes('harvest') &&
          !props.hiddenReferenceLayers?.includes(setting.layer) &&
          !props.hiddenReferenceLayers?.includes(cutblockBufferKey(setting.layer)),
      ) ?? []
    const symbols: AreaSymbol[] = []
    const features = visible.flatMap((setting) => {
      const symbol = cutblockBufferSymbol(setting)
      const pattern = areaPatternId(symbol)
      const color = symbol.fill
      const polygons = cutblockBufferFeatures(setting, props.project.context, reference)
      if (polygons.length) {
        const name = setting.layer
          .split('/')
          .at(-1)
          ?.replace(/\.[^.]+$/, '')
        symbols.push({ ...symbol, label: `${name ?? setting.layer} buffer` })
      }
      return polygons.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, color, ...(pattern ? { pattern } : {}) },
      }))
    })
    return { data: fc(features), symbols }
  }, [bufferSettings, hiddenContextKinds, props.hiddenReferenceLayers, props.project.context, reference])
  const { notesOpen, setNotesOpen, showSentinel, setShowSentinel, showCanopy, setShowCanopy } = props.display
  const sentinelView = useSentinelViewWindow(props.display.navigationMap, showSentinel)
  const sentinel = useSentinel2({
    visible: showSentinel && !sentinelView.paused,
    window: sentinelView.window,
    moving: sentinelView.moving,
  })
  const canopyView = useCanopyView(props.display.navigationMap, showCanopy)
  const canopyAnalysis = props.analyses.get(props.alignment.id)
  const canopyStations = useMemo(() => canopyAnalysis?.stations ?? [], [canopyAnalysis])
  const canopy = useCanopyHeight({
    visible: showCanopy,
    view: canopyView,
    stations: canopyStations,
    roadKey: `${props.alignment.id}:${canopyStations.length}:${canopyAnalysis?.length ?? 0}`,
  })
  const [noteTool, setNoteTool] = useState<NoteTool>(null)
  const [noteColor, setNoteColor] = useState<string>(MAP_NOTE_COLORS[0])
  const [noteArrow, setNoteArrow] = useState(true)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [notesVisible, setNotesVisibleState] = useState(() => {
    try {
      return localStorage.getItem('pgmaps-road-notes-visible') !== 'hidden'
    } catch {
      return true
    }
  })
  const setNotesVisible = (visible: boolean) => {
    setNotesVisibleState(visible)
    if (!visible) {
      setNoteTool(null)
      setSelectedNoteId(null)
    }
    try {
      localStorage.setItem('pgmaps-road-notes-visible', visible ? 'visible' : 'hidden')
    } catch {
      /* The choice still holds for this session. */
    }
  }
  // A road drawing tool and a note tool never run together: picking one puts the other down.
  const roadDrawing = !['inspect', 'edit'].includes(props.mode)
  if ((!notesOpen || roadDrawing) && noteTool) setNoteTool(null)
  const tools = usePlanTools({
    project: props.project,
    alignment: props.alignment,
    analysis: props.analyses.get(props.alignment.id),
    source: props.source,
    station: props.station,
    selectedStation: props.selectedStation,
    mode: props.mode,
    onMode: props.onMode,
    noteTool,
    onClearNoteTool: () => setNoteTool(null),
    pourPointPicking: props.pourPointPicking,
    investigation,
    terrainOnly: props.terrainOnly,
    onPeg: props.onPeg,
    snapLines: props.snapLines,
    onStation: props.onStation,
    onTypeStation: props.onTypeStation,
  })
  // A Sentinel-2 area is drawn with the shared sketch; the plan's own clicks stand aside meanwhile.
  const sentinelArea = useSentinelAreaDrawing({
    canStart: !tools.tool && !noteTool && !props.pourPointPicking && ['inspect', 'edit'].includes(props.mode),
    onArea: sentinel.setArea,
  })
  const pickNoteTool = (tool: NoteTool) => {
    if (tool && roadDrawing) props.onMode?.('inspect')
    if (tool && !notesVisible) setNotesVisible(true)
    setSelectedNoteId(null)
    setNoteTool(tool)
  }
  const [cutblockCard, setCutblockCard] = useState<{ id: string; at: Coordinate } | null>(null)
  const [roadCard, setRoadCard] = useState<{ id: string; at: Coordinate } | null>(null)
  const cardRoad = roadCard
    ? visibleContext.find((feature) => feature.id === roadCard.id && feature.kind === 'existing-road')
    : undefined
  const cutblock = cutblockCard
    ? visibleContext.find((feature) => feature.id === cutblockCard.id && feature.kind === 'harvest')
    : undefined
  const [selectedHistoryRowId, setSelectedHistoryRowId] = useState<string | null>(null)
  const selectedHistoryFeature = visibleContext.find((feature) => feature.id === selectedHistoryRowId)
  const contextKinds = (Object.keys(CONTEXT_LABELS) as ContextFeature['kind'][]).filter((kind) =>
    props.project.context.some((feature) => feature.kind === kind),
  )
  const tableSources = useMemo(
    () => historyTableSources(visibleContext, props.project.harvestHistoryYear ?? new Date().getFullYear()),
    [visibleContext, props.project.harvestHistoryYear],
  )
  const table = useMapTable({
    sources: tableSources,
    // Never placed by a layout: the map settings popover opens the table instead of a toolbar button.
    inlineButton: true,
    url: false,
    selectedRowId: selectedHistoryFeature?.id ?? null,
    defaultSourceId:
      selectedHistoryFeature?.kind === 'existing-road'
        ? 'road-history'
        : selectedHistoryFeature?.kind === 'harvest'
          ? 'cutblock-history'
          : tableSources[0]?.id,
    onSelectRow: (feature: ContextFeature) => {
      setSelectedHistoryRowId(feature.id)
      props.onContextSelect?.(feature)
    },
  })
  const selectContext = (feature: ContextFeature, at?: Coordinate) => {
    setSelectedHistoryRowId(feature.id)
    table.follow(feature.kind === 'existing-road' ? 'road-history' : 'cutblock-history')
    // A cutblock clicked on the map shows its details there; its full history is one button away.
    if (feature.kind === 'harvest' && at) {
      setRoadCard(null)
      setCutblockCard({ id: feature.id, at })
    } else if (feature.kind === 'existing-road' && at) {
      // A road clicked on the map is highlighted and summarised there; Review road opens its record.
      setCutblockCard(null)
      setRoadCard({ id: feature.id, at })
      props.onHighlightRoad?.(feature)
    } else props.onContextSelect?.(feature)
  }
  const hasTerrainBounds = !!terrainBounds(props.project.terrain)
  const { resolvedTheme: planTheme, forcedTheme: planForcedTheme } = useTheme()
  const dark = (planForcedTheme ?? planTheme) === 'dark'
  // A project on the flat plane has no place on Earth: no basemap, online relief or imagery, and
  // a grid at round file coordinates instead.
  const plane = isLocalPlane(props.project.terrain) ? (props.project.terrain.localPlane ?? null) : null
  const waybackAvailable = waybackTimelineAvailable(props.project.terrain)
  const waybackActive = waybackAvailable && props.display.showWayback
  const timeline = useWaybackTimeline(waybackActive)
  const waybackRelease = waybackActive ? timeline.release : undefined
  const wayback = useMapLayerHandoff(
    'road-wayback',
    waybackRelease ? { key: waybackRelease.id, value: waybackRelease } : null,
  )
  // Only the shown release is ordered: the one loading is drawn at opacity 0, and ordering both
  // would have each move the other above itself on every style change.
  usePlanImageryOrder(props.display.navigationMap, !!wayback.shownLayerId, wayback.shownLayerId ?? 'road-wayback')
  const planeGrid = useMemo(() => {
    if (!plane) return EMPTY_COLLECTION
    const b = terrainBounds(props.project.terrain)
    if (!b) return EMPTY_COLLECTION
    // A square around the project, so a long narrow road still sits in a grid.
    const half = Math.max(b[2] - b[0], b[3] - b[1]),
      cx = (b[0] + b[2]) / 2,
      cy = (b[1] + b[3]) / 2
    return localPlaneGrid(plane, [cx - half, cy - half, cx + half, cy + half])
  }, [plane, props.project.terrain])
  const settingsButton = useRef<HTMLButtonElement>(null)
  // The toolbar wraps on narrow plans; what sits below it follows its measured height.
  const planView = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const bar = toolbar.current
    const view = planView.current
    if (!bar || !view || typeof ResizeObserver === 'undefined') return
    const sync = () => {
      view.style.setProperty('--road-plan-toolbar-height', `${bar.offsetHeight}px`)
      view.style.setProperty('--road-plan-toolbar-width', `${bar.offsetWidth}px`)
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])
  // The strip under the map that the legend moves into when it is placed below (`PlanLegend`).
  const [legendSlot, setLegendSlot] = useState<HTMLDivElement | null>(null)
  const { legendPlacement, setLegendPlacement, toolbarLayout, setToolbarLayout } = props.display
  const settingsPanel = useRef<HTMLDivElement>(null)
  const closeSettings = useCallback(() => setSettingsOpen(false), [setSettingsOpen])
  useEffect(() => {
    if (!settingsOpen) return
    const document = settingsButton.current?.ownerDocument ?? globalThis.document
    const window = document.defaultView ?? globalThis.window
    // The panel renders at the end of the body, so Tab from the button no longer reaches it.
    const frame = requestAnimationFrame(() => settingsPanel.current?.querySelector('button')?.focus())
    // An expanded plan traps Tab from a capture listener that treats the portal as outside it.
    const keepTabInPanel = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && settingsPanel.current?.contains(document.activeElement)) event.stopPropagation()
    }
    window.addEventListener('keydown', keepTabInPanel, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', keepTabInPanel, true)
    }
  }, [settingsOpen])
  const drawing = props.pourPointPicking || roadDrawing || !!noteTool || !!tools.tool
  const center = (investigation
    ? investigationCoordinates(props.project)[0]
    : props.alignment.points[0]?.coordinate) ?? [-122.82, 53.89]
  return (
    // The map takes what the legend strip under it leaves; with the legend on the map the strip is empty.
    <div className="road-plan-frame flex h-full min-h-0 flex-col">
      <div
        ref={planView}
        className={`road-plan-view isolate relative min-h-0 flex-1 overflow-hidden rounded-lg ${drawing ? '[&_.maplibregl-marker]:pointer-events-none [&_.maplibregl-marker_*]:pointer-events-none' : ''}`}
        data-testid="road-plan-view"
        data-drawing={drawing}
      >
        <Map
          center={center}
          zoom={14}
          // Markers are placed in pixels, so scaling the canvas during a pane drag leaves them behind.
          deferResize={false}
          controls={
            <>
              <div className="road-plan-fit absolute right-2 top-2 z-30 flex gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8 bg-background shadow-sm"
                  aria-label={investigation ? 'Fit mapped study records' : 'Fit road alignments'}
                  title={investigation ? 'Fit all mapped blocks and road records' : 'Fit all road alignments'}
                  onClick={() => fit('roads')}
                >
                  <LocateFixed className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8 bg-background shadow-sm"
                  aria-label="Fit terrain coverage"
                  title="Fit the loaded DEM coverage"
                  disabled={!hasTerrainBounds}
                  onClick={() => fit('terrain')}
                >
                  <Mountain className="size-4" />
                </Button>
              </div>
              <MapControls position="top-right" showZoom showCompass={false} className="road-map-controls">
                <MapLayersControl
                  label="Basemap"
                  basemaps={IMAGERY_BASEMAPS}
                  basemap={basemap}
                  onBasemapChange={setBasemap}
                  overlays={[
                    {
                      id: 'hrdem-relief',
                      label: HRDEM_RELIEF_NAME,
                      description: 'Where NRCan publishes it',
                      checked: props.display.showHrdem,
                      onCheckedChange: props.display.setShowHrdem,
                      disabled: props.display.terrainLayer === 'none' || !!plane,
                    },
                  ]}
                />
              </MapControls>
            </>
          }
          showLoadingOverlay={false}
        >
          <MapTableBridge table={table} />
          {/* Mounted first, so it stays under every road layer, and always mounted, so it never moves. */}
          <MapFillLayer
            sourceKey="road-local-plane"
            data={PLANE_BACKGROUND}
            fillColor={dark ? '#111827' : '#f5f5f2'}
            fillOpacity={1}
            lineOpacity={0}
            interactive={false}
            visible={!!plane}
          />
          <MapLineLayer
            sourceKey="road-local-plane-grid"
            data={planeGrid}
            color={dark ? '#334155' : '#d4d4cf'}
            width={1}
            interactive={false}
            visible={!!plane}
          />
          <SatelliteImagery visible={basemap === 'satellite' && !plane} />
          <RegionalDemLayer
            visible={props.display.terrainLayer !== 'none' && !plane}
            imagery={basemap === 'satellite'}
          />
          <HrdemReliefLayer
            visible={props.display.showHrdem && props.display.terrainLayer !== 'none' && !plane}
            dark={dark}
            imagery={basemap === 'satellite'}
          />
          <RegionalContourLayer
            visible={showContours && props.display.terrainLayer !== 'none' && !plane}
            dark={dark}
            imagery={basemap === 'satellite'}
          />
          {props.detailArea && (
            <MapLineLayer
              interactive={false}
              sourceKey="road-detail-area"
              data={{
                type: 'FeatureCollection',
                features: props.detailArea.map((quad, i) => ({
                  type: 'Feature',
                  properties: { id: i },
                  geometry: { type: 'LineString', coordinates: [...quad, quad[0]] },
                })),
              }}
              color="#0d9488"
              width={2}
              dashArray={[3, 2]}
            />
          )}
          {props.refineBoxes && (
            <>
              {/* A set limit is solid; the step schedule's reach and a fixed point's cross are dashed. */}
              <MapLineLayer
                interactive={false}
                sourceKey="road-refine-boxes"
                data={props.refineBoxes}
                filter={['==', ['get', 'role'], 'box']}
                color="#c026d3"
                width={2}
                opacity={0.9}
              />
              <MapLineLayer
                interactive={false}
                sourceKey="road-refine-reach"
                data={props.refineBoxes}
                filter={['!=', ['get', 'role'], 'box']}
                color={['match', ['get', 'role'], 'fixed', '#64748b', '#c026d3']}
                width={1.5}
                opacity={0.8}
                dashArray={[2, 2]}
              />
            </>
          )}
          {showSentinel && !plane && <Sentinel2Layer image={sentinel.image} credit={sentinel.credit} />}
          {showCanopy && !plane && <CanopyHeightLayer credit={META_CHM_CREDIT} />}
          {showSentinel && !plane && sentinel.area && (
            <MapLineLayer
              data={{
                type: 'FeatureCollection',
                features: [{ type: 'Feature', properties: {}, geometry: sentinel.area.geometry }],
              }}
              color="#2563eb"
              width={2}
              dashArray={[2, 1.5]}
              interactive={false}
            />
          )}
          {showSentinel && !plane && sentinelArea.draft && (
            <MapSketchDraft
              shape="polygon"
              points={sentinelArea.draft}
              onAdd={sentinelArea.add}
              onFinish={sentinelArea.finish}
              color="#2563eb"
              testId="road-sentinel2-sketch"
            />
          )}
          <Layers
            {...props}
            legendSlot={legendSlot}
            onContextSelect={selectContext}
            alignment={previewAlignment ?? props.alignment}
            savedAlignment={handleAlignment}
            analyses={previewAnalyses}
            // The cost was spread over the saved road's stations: a dragged preview draws plain until it lands.
            costColours={previewAlignment ? undefined : props.costColours}
            onPointDragStart={(id) => props.onSelectPoint(id)}
            onBendPreview={(afterId, coordinate) =>
              setBend(coordinate ? { original: props.alignment, afterId, coordinate } : null)
            }
            onCurvePull={(id, coordinate, commit) => {
              const through = curveThrough(props.alignment, id, coordinate, newPointRadius)
              if (!commit)
                return setPull(through && { original: props.alignment, id, radiusM: through.radiusM, at: coordinate })
              setPull(null)
              if (through) props.onCurveRadius?.(id, through.radiusM, through.limitedBy)
            }}
            onMovePoint={(id, coordinate) => setDrag({ original: props.alignment, id, coordinate })}
            onPointDragEnd={(id, coordinate) => {
              setDrag(null)
              props.onMovePoint(id, coordinate)
            }}
            fitRequest={fitRequest}
            terrainLayer={terrainLayer}
            imagery={basemap === 'satellite'}
            showContours={showContours}
            showLabels={showLabels}
            showEarthwork={showEarthwork}
            sheetSymbols={sheetSymbols}
            sheetLayerSet={sheetLayerSet}
            hiddenContextKinds={hiddenContextKinds}
            visibleContext={visibleContext}
            visibleBufferData={bufferData.data}
            bufferSymbols={bufferData.symbols}
            visibleReference={visibleReference}
            referenceStyles={props.project.referenceStyles}
            referenceSymbols={referenceSymbols}
            noteTool={noteTool}
            planToolActive={!!tools.tool || !!sentinelArea.draft}
            roadColour={tools.roadColour}
            refusedEdit={!!previewRefusal}
          />
          {previewRefusal && dragAt && (
            <>
              <MapMarker
                longitude={previewRefusal.at[0]}
                latitude={previewRefusal.at[1]}
                className="pointer-events-none z-20"
              >
                <MarkerContent>
                  <span aria-hidden="true" className="block size-5 rounded-full border-2 border-danger bg-danger/20" />
                </MarkerContent>
              </MapMarker>
              <MapMarker
                longitude={dragAt[0]}
                latitude={dragAt[1]}
                anchor="bottom"
                offset={[0, -18]}
                className="pointer-events-none z-30"
              >
                <MarkerContent>
                  <span
                    role="status"
                    data-plan-edit-refusal={previewRefusal.kind}
                    className="whitespace-nowrap rounded-sm border border-danger-border bg-background px-1.5 py-0.5 text-2xs font-medium text-danger shadow-sm"
                  >
                    Not allowed · {previewRefusal.label}
                  </span>
                </MarkerContent>
              </MapMarker>
            </>
          )}
          {/* The shown release stays until the next has its tiles, so stepping and playback never blank the imagery. */}
          <MapRasterHandoff
            handoff={wayback}
            layer={(release) => ({
              tiles: [release.tiles],
              beforeId: SENTINEL_ANCHOR_LAYER_ID,
              attribution: waybackCredit(release),
              fadeDuration: 0,
              // As the satellite basemap (`map-satellite-imagery.tsx`): past z18 rural BC gets Esri's grey placeholder.
              maxZoom: 18,
            })}
          />
          {tools.mapLayer}
          <ReferenceLabels features={visibleReference} />
          <NotesLayer
            notes={notes}
            visible={notesVisible}
            tool={noteTool}
            color={noteColor}
            arrow={noteArrow}
            selectedId={selectedNoteId}
            onSelect={setSelectedNoteId}
            onChange={props.onNotesChange}
            onToolDone={() => setNoteTool(null)}
          />
          {cardRoad && roadCard && (
            <ExistingRoadCard
              road={cardRoad}
              at={roadCard.at}
              onClose={() => setRoadCard(null)}
              onLoadAsRoad={
                props.onLoadMappedRoad && cardRoad.geometry.type === 'LineString'
                  ? () => {
                      setRoadCard(null)
                      props.onLoadMappedRoad?.(cardRoad.id)
                    }
                  : undefined
              }
              onAccessHistory={
                props.onHistorySelect
                  ? () => {
                      setRoadCard(null)
                      props.onHistorySelect?.({ kind: 'road', id: cardRoad.id })
                    }
                  : undefined
              }
              onReview={
                props.onContextSelect
                  ? () => {
                      setRoadCard(null)
                      props.onContextSelect?.(cardRoad)
                    }
                  : undefined
              }
            />
          )}
          {cutblock && cutblockCard && (
            <CutblockCard
              feature={cutblock}
              at={cutblockCard.at}
              year={props.project.harvestHistoryYear ?? new Date().getFullYear()}
              onClose={() => setCutblockCard(null)}
              onAccessHistory={
                props.onHistorySelect
                  ? () => {
                      setCutblockCard(null)
                      props.onHistorySelect?.({ kind: 'block', id: cutblock.id })
                    }
                  : undefined
              }
              onOpenHistory={
                props.onContextSelect
                  ? () => {
                      setCutblockCard(null)
                      props.onContextSelect?.(cutblock)
                    }
                  : undefined
              }
              onSentinelSeries={
                plane || !areaFromFeature(cutblock)
                  ? undefined
                  : () => {
                      setCutblockCard(null)
                      sentinelArea.drawing.cancel()
                      sentinel.setArea(areaFromFeature(cutblock))
                      setShowSentinel(true)
                    }
              }
            />
          )}
          <MapScaleBar
            position="bottom-left"
            className="road-map-scale left-2 bottom-[calc(var(--map-bottom-left-controls-height,0px)+0.5rem)]"
          />
          {table.layout.bottomPane && (
            <div
              className="absolute inset-x-0 bottom-0 z-30 max-h-[70%] overflow-hidden border-t bg-background"
              style={{ height: table.layout.bottomPaneHeight }}
              data-testid="road-history-table"
            >
              {table.layout.bottomPane}
            </div>
          )}
        </Map>
        <div
          ref={toolbar}
          className="road-plan-toolbar absolute left-2 top-2 z-30"
          data-layout={toolbarLayout}
          data-map-export-ignore
        >
          <div className="road-plan-display">
            <TerrainLayerSelect value={terrainLayer} onChange={setTerrainLayer} />
            <Button
              ref={settingsButton}
              size="icon"
              variant="outline"
              className="size-8 bg-background/95 shadow-sm"
              aria-label="Map display settings"
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Settings2 className="size-4" />
            </Button>
            <AnchoredPopover
              anchorRef={settingsButton}
              panelRef={settingsPanel}
              open={settingsOpen}
              onClose={closeSettings}
              role="dialog"
              ariaLabel="Map display settings"
              // Above an expanded plan pane (z-overlay), like the Terrain display list next to it.
              className="z-workspace-popover w-60 max-w-[calc(100vw-3rem)] rounded-lg p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold">Map settings</h3>
                <Button
                  size="icon-2xs"
                  variant="ghost"
                  aria-label="Close map settings"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X className="size-3" />
                </Button>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mb-2 w-full"
                onClick={() => {
                  fit('active')
                  setSettingsOpen(false)
                }}
              >
                Fit selected road
              </Button>
              {(
                [
                  ['Contours', showContours, setShowContours],
                  ['Labels', showLabels, setShowLabels],
                  ['Sentinel-2 imagery', showSentinel, setShowSentinel],
                  ['Canopy height (CHM v2)', showCanopy, setShowCanopy],
                  ...(waybackAvailable
                    ? [[commandDef('waybackTimeline').label, waybackActive, props.display.setShowWayback] as const]
                    : []),
                  ...(notes.length ? [['Map notes', notesVisible, setNotesVisible] as const] : []),
                  ...(reference.length && props.onReferenceVisibility
                    ? [
                        [
                          'Reference layers',
                          visibleReference.length > 0,
                          (visible: boolean) =>
                            props.onReferenceVisibility?.(
                              referenceLayers(reference).map((layer) => layer.key),
                              visible,
                            ),
                        ] as const,
                      ]
                    : []),
                  ...(!props.terrainOnly ? [['Earthworks', showEarthwork, setShowEarthwork] as const] : []),
                  ...tools.settingsRows,
                ] as const
              ).map(([label, checked, set]) => (
                <label key={label} className="flex items-center justify-between py-2 text-xs">
                  {label}
                  <input type="checkbox" checked={checked} onChange={(event) => set(event.target.checked)} />
                </label>
              ))}
              {tools.setRoadColour && (
                <label className="grid gap-1 py-2 text-xs">
                  Colour road by
                  <StyledSelect
                    value={tools.roadColour}
                    onValueChange={(value) => tools.setRoadColour?.(value as RoadColourMode)}
                    aria-label="Colour road by"
                  >
                    {ROAD_COLOUR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </StyledSelect>
                  {tools.roadColour === 'cost' && (
                    <span className="text-2xs text-muted-foreground">
                      Against the road&apos;s average $/m. Covered estimate → a row&apos;s colour button picks one cost.
                    </span>
                  )}
                </label>
              )}
              <label className="mt-2 grid gap-1 border-t pt-2 text-xs">
                Legend and map symbols
                <StyledSelect
                  value={symbolStyle}
                  onChange={(event) => chooseSymbolStyle(event.target.value)}
                  aria-label="Legend and map symbols"
                >
                  <option value="road-plan">Standard road plan</option>
                  <option value="block-sheet">Block sheet forestry</option>
                  <option value="saved-styles">Block sheet, my saved styles</option>
                </StyledSelect>
                <span className="text-2xs text-muted-foreground">
                  {symbolStyle === 'saved-styles'
                    ? 'Block sheet symbols, with the styles saved in this browser for the features they are chosen for (Save & export, a GIS output or the block sheet, Styles). The Map PDF prints the plan as shown.'
                    : 'The map and legend use the same symbols, and the Map PDF prints them. Choice saved in this browser.'}
                </span>
              </label>
              <fieldset className="mt-2 grid gap-2 border-t pt-2" data-testid="road-plan-layout">
                <legend className="text-xs font-medium">Layout</legend>
                <label className="grid gap-1 text-xs">
                  Legend
                  <StyledSelect
                    value={legendPlacement}
                    onValueChange={(value) => setLegendPlacement(value === 'below' ? 'below' : 'map')}
                    aria-label="Legend placement"
                  >
                    <option value="map">On the map, folded</option>
                    <option value="below">Below the map</option>
                  </StyledSelect>
                </label>
                <label className="grid gap-1 text-xs">
                  Toolbar
                  <StyledSelect
                    value={toolbarLayout}
                    onValueChange={(value) => setToolbarLayout(value === 'top' || value === 'side' ? value : 'wrap')}
                    aria-label="Toolbar layout"
                  >
                    <option value="wrap">Wrap to fit</option>
                    <option value="top">All along the top</option>
                    <option value="side">All down the side</option>
                  </StyledSelect>
                </label>
                <span className="text-2xs text-muted-foreground">Saved in this browser.</span>
              </fieldset>
              {contextKinds.length > 0 && (
                <fieldset className="mt-2 border-t pt-2" data-testid="road-context-visibility">
                  <legend className="text-xs font-medium">Context</legend>
                  {contextKinds.map((kind) => (
                    <label key={kind} className="flex items-center justify-between gap-2 py-2 text-xs">
                      {CONTEXT_LABELS[kind]}
                      <input
                        type="checkbox"
                        aria-label={`Show ${CONTEXT_LABELS[kind].toLowerCase()} context`}
                        checked={!hiddenContextKinds.includes(kind)}
                        onChange={(event) =>
                          setHiddenContextKinds((previous) =>
                            event.target.checked ? previous.filter((value) => value !== kind) : [...previous, kind],
                          )
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              )}
              {/* The history table opens from here rather than a toolbar button of its own. */}
              {tableSources.length > 0 && !table.activeSource && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full"
                  onClick={() => {
                    table.open()
                    closeSettings()
                  }}
                >
                  <Table2 className="size-3.5" />
                  Cutblock & road history table
                </Button>
              )}
            </AnchoredPopover>
            {!investigation && props.layersButton}
          </div>
          <div className="road-plan-actions">
            {!investigation && (
              <RoadMapTools mode={props.mode} disabled={!props.onMode} onMode={(mode) => props.onMode?.(mode)} />
            )}
            {tools.toolbar}
            <Button
              size="icon"
              variant="outline"
              className={`size-8 shrink-0 shadow-sm ${notesOpen ? 'bg-accent text-accent-foreground' : 'bg-background/95'}`}
              aria-label="Map notes"
              aria-pressed={notesOpen}
              title={`Map notes${notes.length ? ` · ${notes.length}` : ''}`}
              onClick={() => setNotesOpen(!notesOpen)}
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </div>
        </div>
        {notesOpen && (
          <div className="road-plan-below-toolbar absolute left-2 z-30 max-w-[calc(100%-4rem)]">
            <NotesToolbar
              tool={noteTool}
              onTool={pickNoteTool}
              color={noteColor}
              onColor={setNoteColor}
              arrow={noteArrow}
              onArrow={setNoteArrow}
              visible={notesVisible}
              onVisible={setNotesVisible}
              count={notes.length}
              disabled={!props.onNotesChange}
              onClose={() => setNotesOpen(false)}
            />
          </div>
        )}
        {(showSentinel || showCanopy || props.cornerPanel) && (
          <div className="absolute right-12 top-12 z-30 flex max-h-[calc(100%-6rem)] max-w-[calc(100%-4rem)] flex-col items-end gap-2 overflow-hidden">
            {props.cornerPanel && (
              <div className="flex min-h-0 max-w-full shrink" style={{ maxHeight: 'inherit' }}>
                {props.cornerPanel}
              </div>
            )}
            {showSentinel && (
              <Sentinel2Panel
                state={sentinel}
                paused={sentinelView.paused}
                onClose={() => {
                  sentinelArea.drawing.cancel()
                  setShowSentinel(false)
                }}
                drawing={sentinelArea.drawing}
              />
            )}
            {showCanopy && (
              <CanopyHeightPanel
                state={canopy}
                paused={canopyView.paused}
                roadName={props.alignment.name || 'the road'}
                onClose={() => setShowCanopy(false)}
              />
            )}
          </div>
        )}
        {tools.panelSlot}
        {props.toolPanel && (
          <div
            className="absolute bottom-9 left-2 z-30 max-h-[calc(100%-5.5rem)] w-80 max-w-[calc(100%-1rem)] overflow-y-auto overscroll-none"
            data-map-export-ignore
          >
            {props.toolPanel}
          </div>
        )}
        {props.mode === 'edit' &&
          !notesOpen &&
          (editHelpVisible ? (
            <div
              className="road-plan-below-toolbar absolute left-2 z-20 flex max-w-[calc(100%-4rem)] items-center gap-2 rounded-md border bg-background/95 px-2 py-1 text-2xs shadow"
              data-testid="road-edit-help"
            >
              <span className="min-w-0 flex-1">Drag a number to move that point. Drag a + to bend the road.</span>
              <Button
                size="icon-2xs"
                variant="ghost"
                className="shrink-0"
                aria-label="Hide editing hint"
                title="Hide editing hint"
                onClick={() => showEditHelp(false)}
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <Button
              size="icon-xs"
              variant="outline"
              className="road-plan-below-toolbar absolute left-2 z-20 bg-background/95 shadow-sm"
              aria-label="Show editing hint"
              title="Show editing hint"
              onClick={() => showEditHelp(true)}
            >
              <CircleHelp className="size-4" />
            </Button>
          ))}
      </div>
      {waybackActive && <WaybackTimeline timeline={timeline} onClose={() => props.display.setShowWayback(false)} />}
      <div
        ref={setLegendSlot}
        className="road-plan-legend-slot flex max-h-[45%] min-h-0 shrink-0 flex-col pb-2 empty:hidden"
        data-testid="road-plan-legend-slot"
      />
    </div>
  )
}
